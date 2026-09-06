/**
 * Signature Pad Manager
 * Handles HTML5 Canvas signature drawing and localStorage persistence
 */
class SignatureManager {
    constructor() {
        this.canvas = document.getElementById('signature-canvas');
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.isDrawing = false;
        this.strokes = [];
        this.currentStroke = [];
        
        this.currentColor = '#000000';
        this.currentWidth = 3;
        
        this.STORAGE_KEY = 'pdftools_saved_signatures';
        
        if (this.canvas) {
            this.initCanvas();
        }
    }

    initCanvas() {
        // High DPI scaling
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        // Event listeners for drawing
        this.canvas.addEventListener('mousedown', (e) => this.startDrawing(e));
        this.canvas.addEventListener('mousemove', (e) => this.draw(e));
        this.canvas.addEventListener('mouseup', () => this.stopDrawing());
        this.canvas.addEventListener('mouseleave', () => this.stopDrawing());

        // Touch events for mobile/tablets
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousemove', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this.canvas.dispatchEvent(mouseEvent);
        });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            const mouseEvent = new MouseEvent('mouseup', {});
            this.canvas.dispatchEvent(mouseEvent);
        });
    }

    resizeCanvas() {
        if (!this.canvas) return;
        const rect = this.canvas.parentElement.getBoundingClientRect();
        
        // Save current canvas content before resize
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = this.canvas.width;
        tempCanvas.height = this.canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(this.canvas, 0, 0);

        this.canvas.width = rect.width;
        this.canvas.height = rect.height;

        this.redrawAll();
    }

    getPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    startDrawing(e) {
        this.isDrawing = true;
        const pos = this.getPos(e);
        this.currentStroke = [{
            x: pos.x,
            y: pos.y,
            color: this.currentColor,
            width: this.currentWidth
        }];
    }

    draw(e) {
        if (!this.isDrawing) return;
        const pos = this.getPos(e);
        
        this.ctx.beginPath();
        const lastPoint = this.currentStroke[this.currentStroke.length - 1];
        this.ctx.moveTo(lastPoint.x, lastPoint.y);
        this.ctx.lineTo(pos.x, pos.y);
        this.ctx.strokeStyle = this.currentColor;
        this.ctx.lineWidth = this.currentWidth;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.stroke();

        this.currentStroke.push({
            x: pos.x,
            y: pos.y,
            color: this.currentColor,
            width: this.currentWidth
        });
    }

    stopDrawing() {
        if (this.isDrawing && this.currentStroke.length > 0) {
            this.strokes.push([...this.currentStroke]);
            this.currentStroke = [];
        }
        this.isDrawing = false;
    }

    clear() {
        this.strokes = [];
        this.currentStroke = [];
        if (this.ctx) {
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }
    }

    undo() {
        this.strokes.pop();
        this.redrawAll();
    }

    redrawAll() {
        if (!this.ctx) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        for (const stroke of this.strokes) {
            if (stroke.length < 2) continue;
            this.ctx.beginPath();
            this.ctx.moveTo(stroke[0].x, stroke[0].y);
            this.ctx.strokeStyle = stroke[0].color;
            this.ctx.lineWidth = stroke[0].width;
            this.ctx.lineCap = 'round';
            this.ctx.lineJoin = 'round';

            for (let i = 1; i < stroke.length; i++) {
                this.ctx.lineTo(stroke[i].x, stroke[i].y);
            }
            this.ctx.stroke();
        }
    }

    setColor(color) {
        this.currentColor = color;
    }

    setWidth(width) {
        this.currentWidth = width;
    }

    isEmpty() {
        return this.strokes.length === 0;
    }

    // Crop signature canvas to remove white space around signature
    getTrimmedDataURL() {
        if (this.isEmpty()) return null;

        // Find bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of this.strokes) {
            for (const point of stroke) {
                if (point.x < minX) minX = point.x;
                if (point.y < minY) minY = point.y;
                if (point.x > maxX) maxX = point.x;
                if (point.y > maxY) maxY = point.y;
            }
        }

        // Add padding
        const padding = 10;
        minX = Math.max(0, minX - padding);
        minY = Math.max(0, minY - padding);
        maxX = Math.min(this.canvas.width, maxX + padding);
        maxY = Math.min(this.canvas.height, maxY + padding);

        const width = maxX - minX;
        const height = maxY - minY;

        if (width <= 0 || height <= 0) return null;

        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = width;
        trimmedCanvas.height = height;
        const trimmedCtx = trimmedCanvas.getContext('2d');

        // Draw cropped portion
        trimmedCtx.drawImage(
            this.canvas,
            minX, minY, width, height,
            0, 0, width, height
        );

        return trimmedCanvas.toDataURL('image/png');
    }

    // LocalStorage Methods
    saveToLocalStorage(name = 'Firma') {
        const dataUrl = this.getTrimmedDataURL();
        if (!dataUrl) return null;

        const saved = this.getSavedSignatures();
        const newSig = {
            id: 'sig_' + Date.now(),
            name: name,
            dataUrl: dataUrl,
            createdAt: new Date().toLocaleDateString('es-ES', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: '2-digit'
            })
        };

        saved.unshift(newSig); // Put at top
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(saved));
        return newSig;
    }

    getSavedSignatures() {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return [];
        try {
            return JSON.parse(raw);
        } catch (e) {
            return [];
        }
    }

    deleteFromLocalStorage(id) {
        let saved = this.getSavedSignatures();
        saved = saved.filter(sig => sig.id !== id);
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(saved));
    }
}

// Global instance
window.signatureManager = new SignatureManager();
