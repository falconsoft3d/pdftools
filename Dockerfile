FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Expose Flask default port
EXPOSE 5000

# Environment variables
ENV FLASK_APP=app.py
ENV PYTHONUNBUFFERED=1

# Command to run production WSGI server
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "4", "app:app"]
