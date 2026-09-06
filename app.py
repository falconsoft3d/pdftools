import os
import io
from flask import Flask, render_template, request, send_file, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix
from pypdf import PdfReader, PdfWriter

app = Flask(__name__)
# Soporte para proxies inversos como Nginx para conservar HTTPS y headers
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)

# Max upload size: 32MB
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024

@app.route('/')
def index():
    return render_template('index.html')

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
