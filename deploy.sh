#!/bin/bash

# Script de despliegue para PDF Local Editor

echo "🚀 Iniciando despliegue de PDF Local Editor..."

# Comprobar si Docker está disponible
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "🐳 Docker y Docker Compose detectados. Desplegando en contenedor..."
    docker-compose down
    docker-compose up --build -d
    echo "✅ Despliegue con Docker completado con éxito."
    echo "🌐 Aplicación disponible en: http://localhost:5000"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    echo "🐳 Docker detectado. Desplegando con 'docker compose'..."
    docker compose down
    docker compose up --build -d
    echo "✅ Despliegue con Docker completado con éxito."
    echo "🌐 Aplicación disponible en: http://localhost:5000"
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
