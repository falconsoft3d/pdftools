import os
import io
import json
import sqlite3
import threading
import urllib.request
from flask import Flask, render_template, request, send_file, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
from pypdf import PdfReader, PdfWriter

app = Flask(__name__)
# Soporte para proxies inversos como Nginx para conservar HTTPS y headers
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Max upload size: 32MB
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024

DATABASE_FILE = os.path.join(os.path.dirname(__file__), 'pdftools.db')

def init_db():
    conn = sqlite3.connect(DATABASE_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS visits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT,
            country TEXT,
            country_code TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def country_code_to_flag(code):
    if not code or len(code) != 2:
        return '🌐'
    try:
        return chr(ord(code[0].upper()) + 127397) + chr(ord(code[1].upper()) + 127397)
    except Exception:
        return '🌐'

def get_ip_country(ip):
    if not ip or ip in ('127.0.0.1', '::1', 'localhost') or ip.startswith(('192.168.', '10.', '172.16.')):
        return 'España', 'ES'
    try:
        url = f'http://ip-api.com/json/{ip}?fields=status,country,countryCode'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=1.5) as response:
            data = json.loads(response.read().decode('utf-8'))
            if data.get('status') == 'success':
                return data.get('country', 'Desconocido'), data.get('countryCode', 'UN')
    except Exception as e:
        print("GeoIP lookup notice:", e)
    return 'España', 'ES'

def record_visit_bg(ip, user_agent):
    def _task():
        country, country_code = get_ip_country(ip)
        try:
            conn = sqlite3.connect(DATABASE_FILE)
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO visits (ip_address, country, country_code, user_agent, created_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ''', (ip, country, country_code, user_agent))
            conn.commit()
            conn.close()
        except Exception as e:
            print("DB Visit record error:", e)
            
    threading.Thread(target=_task, daemon=True).start()

def get_total_visits():
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM visits')
        total = cursor.fetchone()[0] or 0
        conn.close()
        return total
    except Exception:
        return 0

def get_full_stats():
    try:
        conn = sqlite3.connect(DATABASE_FILE)
        cursor = conn.cursor()
        
        cursor.execute('SELECT COUNT(*) FROM visits')
        total_visits = cursor.fetchone()[0] or 0
        
        cursor.execute('SELECT COUNT(DISTINCT country) FROM visits')
        total_countries = cursor.fetchone()[0] or 0

        cursor.execute('''
            SELECT country, country_code, COUNT(*) as count 
            FROM visits 
            GROUP BY country, country_code 
            ORDER BY count DESC
        ''')
        country_rows = cursor.fetchall()
        by_country = []
        for r in country_rows:
            pct = round((r[2] / total_visits * 100), 1) if total_visits > 0 else 0
            by_country.append({
                'country': r[0] or 'Desconocido',
                'country_code': r[1] or 'UN',
                'flag': country_code_to_flag(r[1]),
                'count': r[2],
                'percentage': pct
            })
            
        cursor.execute('''
            SELECT ip_address, country, country_code, user_agent, created_at
            FROM visits
            ORDER BY id DESC
            LIMIT 50
        ''')
        recent_visits = []
        for r in cursor.fetchall():
            recent_visits.append({
                'ip': r[0],
                'country': r[1],
                'country_code': r[2],
                'flag': country_code_to_flag(r[2]),
                'user_agent': r[3],
                'created_at': r[4]
            })
            
        conn.close()
        return {
            'total_visits': total_visits,
            'total_countries': total_countries,
            'by_country': by_country,
            'recent_visits': recent_visits
        }
    except Exception as e:
        print("Error getting full stats:", e)
        return {
            'total_visits': 0,
            'total_countries': 0,
            'by_country': [],
            'recent_visits': []
        }

@app.route('/')
def index():
    ip = request.headers.get('X-Forwarded-For', request.remote_addr)
    if ip and ',' in ip:
        ip = ip.split(',')[0].strip()
    user_agent = request.headers.get('User-Agent', '')
    
    record_visit_bg(ip, user_agent)
    total_visits = get_total_visits() + 1
    return render_template('index.html', total_visits=total_visits)

@app.route('/estadisticas')
@app.route('/stats')
def stats():
    stats_data = get_full_stats()
    return render_template('stats.html', stats=stats_data)

@app.route('/api/visit-count')
def api_visit_count():
    return jsonify({'total_visits': get_total_visits()})

@app.route('/api/stats')
def api_stats():
    return jsonify(get_full_stats())

@app.route('/api/pdf-info', methods=['POST'])
def pdf_info():
    """Analiza un PDF subido temporalmente en memoria sin guardar en disco ni nube."""
    if 'pdf' not in request.files:
        return jsonify({'error': 'No se envió ningún archivo PDF'}), 400
    
    file = request.files['pdf']
    if file.filename == '':
        return jsonify({'error': 'Nombre de archivo vacío'}), 400

    try:
        pdf_bytes = file.read()
        reader = PdfReader(io.BytesIO(pdf_bytes))
        num_pages = len(reader.pages)
        return jsonify({
            'filename': file.filename,
            'num_pages': num_pages,
            'size_bytes': len(pdf_bytes)
        })
    except Exception as e:
        return jsonify({'error': f'Error al leer el PDF: {str(e)}'}), 500

if __name__ == '__main__':
    # Ejecutar en localhost puerto 5000
    app.run(host='127.0.0.1', port=5000, debug=True)
