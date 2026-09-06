# PDF Local Editor & Firma Digital

Aplicación web desarrollada con **Flask** para cargar, visualizar, editar y firmar documentos PDF **100% de forma local** (sin subir nada a la nube).

## 🚀 Características
- **Privacidad total**: Tus archivos PDF y firmas nunca se suben a servidores externos ni a la nube.
- **Gestión de Firmas con `localStorage`**:
  - Panel táctil/canvas para dibujar tu firma a mano alzada.
  - Opciones de color de tinta, grosor de trazo, limpiar y deshacer.
  - Guarda tus firmas en el `localStorage` de tu navegador para reutilizarlas en el futuro.
- **Edición e inserción en el PDF**:
  - Arrastra la firma a cualquier posición de la página.
  - Cambia el tamaño de la firma de forma dinámica.
  - Añade textos personalizados en el documento.
  - Rota y elimina páginas del PDF.
- **Descarga instantánea**: Genera y descarga el PDF final editado.

## 🛠️ Requisitos
- Python 3.10+
- Flask y PyPDF

## � Despliegue en un solo comando

Puedes ejecutar el despliegue automático ejecutando:

```bash
./deploy.sh
```

El script detectará automáticamente si tienes **Docker** instalado para levantar el contenedor en producción o, en su defecto, iniciará el servidor WSGI **Gunicorn** en segundo plano en tu entorno local.

---

## 💻 Ejecución Manual

1. Activa el entorno virtual e instala dependencias:
```bash
source venv/bin/activate
pip install -r requirements.txt
```

2. Inicia el servidor Flask:
```bash
python app.py
```

3. Abre en tu navegador:
```text
http://127.0.0.1:5000
```

