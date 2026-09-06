#!/bin/bash

# Script de despliegue para PDF Local Editor (Nginx + HTTPS + Gunicorn)

echo "🚀 Iniciando despliegue de PDF Local Editor..."

# Crear directorio de certificados si no existe
mkdir -p nginx/certs

# Comprobar/generar certificados SSL si no existen
if [ ! -f "nginx/certs/fullchain.pem" ] || [ ! -f "nginx/certs/privkey.pem" ]; then
    echo "🔑 No se encontraron certificados SSL en nginx/certs/."
    echo "⚡ Generando certificados SSL autofirmados iniciales para HTTPS..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout nginx/certs/privkey.pem \
        -out nginx/certs/fullchain.pem \
        -subj "/C=ES/ST=Madrid/L=Madrid/O=PDFTools/CN=localhost" \
        2>/dev/null
    echo "💡 Nota: Puedes reemplazar fullchain.pem y privkey.pem en nginx/certs/ con tus certificados reales de Let's Encrypt o tu dominio."
fi

# Comprobar si Docker está disponible
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "🐳 Docker y Docker Compose detectados. Desplegando en contenedor..."
    docker-compose down
    docker-compose up --build -d
    echo "✅ Despliegue con Nginx + HTTPS completado con éxito."
    echo "🌐 Aplicación disponible en: https://localhost (o el dominio apuntado a este servidor)"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    echo "🐳 Docker detectado. Desplegando con 'docker compose'..."
    docker compose down
    docker compose up --build -d
    echo "✅ Despliegue con Nginx + HTTPS completado con éxito."
    echo "🌐 Aplicación disponible en: https://localhost (o el dominio apuntado a este servidor)"
else
    echo "💻 Docker no detectado. Desplegando mediante entorno virtual local (Gunicorn)..."
    if [ ! -d "venv" ]; then
        echo "📦 Creando entorno virtual..."
        python3 -m venv venv
    fi
    source venv/bin/activate
    pip install -r requirements.txt
    
    echo "⚡ Iniciando servidor Gunicorn..."
    pkill -f gunicorn || true
    nohup gunicorn --bind 0.0.0.0:5000 --workers 4 app:app > app.log 2>&1 &
    
    echo "✅ Servidor desplegado en segundo plano."
    echo "🌐 Aplicación disponible en: http://127.0.0.1:5000"
    echo "📝 Logs guardados en app.log"
fi
