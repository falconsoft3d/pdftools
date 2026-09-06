// Helper function to decode base64 DataURL to Uint8Array safely without fetch
function dataUrlToBytes(dataUrl) {
    try {
        const base64 = dataUrl.split(',')[1];
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return bytes;
    } catch (e) {
        console.error('Error decoding base64 DataURL:', e);
        return null;
    }
}

// Sanitize text for StandardFonts.Helvetica (WinAnsi encoding)
function sanitizeTextForPdf(str) {
    if (!str) return '';
    return str
        .replace(/[\u201C\u201D\u201E]/g, '"')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2022\u2023\u2043]/g, '*')
        .replace(/[^\x20-\xFF\n\r\t]/g, '?');
}

// Parse hex/name colors to PDFLib rgb()
function parseRgbColor(colorStr) {
    if (!window.PDFLib) return undefined;
    const { rgb } = window.PDFLib;
    if (!colorStr || colorStr === 'transparent' || colorStr === 'none') return undefined;
    if (colorStr.startsWith('#')) {
        let hex = colorStr.replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        const r = parseInt(hex.substring(0, 2), 16) / 255;
        const g = parseInt(hex.substring(2, 4), 16) / 255;
        const b = parseInt(hex.substring(4, 6), 16) / 255;
        return rgb(r, g, b);
    }
    if (colorStr === 'white' || colorStr === '#ffffff') return rgb(1, 1, 1);
    if (colorStr === 'black' || colorStr === '#000000') return rgb(0, 0, 0);
    return rgb(0, 0, 0);
}

// Render any placed element (text, whiteout, signature, shape, table) to a PDFLib page
async function renderPlacedElementToPdfPage(pdfDoc, page, elem, pdfWidth, pdfHeight, htmlWidth, htmlHeight, helveticaFont) {
    const { rgb } = window.PDFLib;

    if (elem.type === 'whiteout') {
        const elemW = (elem.width / htmlWidth) * pdfWidth;
        const elemH = (elem.height / htmlHeight) * pdfHeight;
        const elemX = (elem.x / htmlWidth) * pdfWidth;
        const elemY = pdfHeight - ((elem.y + elem.height) / htmlHeight) * pdfHeight;

        page.drawRectangle({
            x: elemX,
            y: elemY,
            width: elemW,
            height: elemH,
            color: rgb(1, 1, 1),
        });
    } else if (elem.type === 'signature' && elem.dataUrl) {
        const imgBytes = dataUrlToBytes(elem.dataUrl);
        if (!imgBytes) return;

        let image;
        if (elem.dataUrl.includes('image/jpeg') || elem.dataUrl.includes('image/jpg')) {
            image = await pdfDoc.embedJpg(imgBytes);
        } else {
            image = await pdfDoc.embedPng(imgBytes);
        }

        const elemW = (elem.width / htmlWidth) * pdfWidth;
        const elemH = (elem.height / htmlHeight) * pdfHeight;
        const elemX = (elem.x / htmlWidth) * pdfWidth;
        const elemY = pdfHeight - ((elem.y + elem.height) / htmlHeight) * pdfHeight;

        page.drawImage(image, {
            x: elemX,
            y: elemY,
            width: elemW,
            height: elemH,
        });
    } else if (elem.type === 'text' && elem.text) {
        const elemW = ((elem.width || 120) / htmlWidth) * pdfWidth;
        const elemH = ((elem.height || 30) / htmlHeight) * pdfHeight;
        const elemX = (elem.x / htmlWidth) * pdfWidth;
        const elemY = pdfHeight - ((elem.y + (elem.height || 30)) / htmlHeight) * pdfHeight;
        const fontSize = Math.max(8, ((elem.fontSize || 16) / htmlHeight) * pdfHeight);

        if (elem.bgWhite) {
            page.drawRectangle({
                x: elemX,
                y: elemY,
                width: elemW,
                height: elemH,
                color: rgb(1, 1, 1),
            });
        }

        const textColorRgb = parseRgbColor(elem.color) || rgb(0, 0, 0);
        const cleanText = sanitizeTextForPdf(elem.text);
        const lines = cleanText.split(/\r?\n/);
        const lineHeight = fontSize * 1.2;

        lines.forEach((lineText, idx) => {
            if (!lineText) return;
            page.drawText(lineText, {
                x: elemX + 2,
                y: elemY + elemH - ((idx + 1) * lineHeight),
                size: fontSize,
                font: helveticaFont,
                color: textColorRgb
            });
        });
    } else if (elem.type === 'shape') {
        const elemW = (elem.width / htmlWidth) * pdfWidth;
        const elemH = (elem.height / htmlHeight) * pdfHeight;
        const elemX = (elem.x / htmlWidth) * pdfWidth;
        const elemY = pdfHeight - ((elem.y + elem.height) / htmlHeight) * pdfHeight;

        const fillColor = parseRgbColor(elem.fillColor);
        const strokeColor = parseRgbColor(elem.strokeColor) || rgb(0, 0, 0);
        const strokeWidth = (elem.strokeWidth || 2) * (pdfWidth / htmlWidth);

        if (elem.shapeType === 'rectangle') {
            page.drawRectangle({
                x: elemX,
                y: elemY,
                width: elemW,
                height: elemH,
                color: fillColor,
                borderColor: strokeColor,
                borderWidth: strokeWidth
            });
        } else if (elem.shapeType === 'circle') {
            page.drawEllipse({
                x: elemX + elemW / 2,
                y: elemY + elemH / 2,
                xScale: elemW / 2,
                yScale: elemH / 2,
                color: fillColor,
                borderColor: strokeColor,
                borderWidth: strokeWidth
            });
        } else {
            // Arrow / Star via Canvas PNG render
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = Math.max(100, Math.round((elem.width || 100) * 2));
            tempCanvas.height = Math.max(100, Math.round((elem.height || 100) * 2));
            const ctx = tempCanvas.getContext('2d');
            const w = tempCanvas.width;
            const h = tempCanvas.height;

            ctx.strokeStyle = elem.strokeColor || '#000000';
            ctx.lineWidth = (elem.strokeWidth || 2) * 2;
            ctx.fillStyle = (elem.fillColor && elem.fillColor !== 'transparent') ? elem.fillColor : 'transparent';

            if (elem.shapeType === 'arrow') {
                ctx.beginPath();
                ctx.moveTo(10, h / 2);
                ctx.lineTo(w - 30, h / 2);
                ctx.lineTo(w - 30, h / 2 - 20);
                ctx.lineTo(w - 5, h / 2);
                ctx.lineTo(w - 30, h / 2 + 20);
                ctx.lineTo(w - 30, h / 2);
                ctx.closePath();
                if (elem.fillColor && elem.fillColor !== 'transparent') ctx.fill();
                ctx.stroke();
            } else if (elem.shapeType === 'star') {
                ctx.beginPath();
                const cx = w / 2, cy = h / 2, outerR = Math.min(w, h) / 2 - 10, innerR = outerR / 2.2;
                for (let i = 0; i < 10; i++) {
                    const r = i % 2 === 0 ? outerR : innerR;
                    const angle = (i * Math.PI) / 5 - Math.PI / 2;
                    const xPos = cx + r * Math.cos(angle);
                    const yPos = cy + r * Math.sin(angle);
                    if (i === 0) ctx.moveTo(xPos, yPos);
                    else ctx.lineTo(xPos, yPos);
                }
                ctx.closePath();
                if (elem.fillColor && elem.fillColor !== 'transparent') ctx.fill();
                ctx.stroke();
            }

            const shapeDataUrl = tempCanvas.toDataURL('image/png');
            const shapeBytes = dataUrlToBytes(shapeDataUrl);
            if (shapeBytes) {
                const shapeImg = await pdfDoc.embedPng(shapeBytes);
                page.drawImage(shapeImg, {
                    x: elemX,
                    y: elemY,
                    width: elemW,
                    height: elemH
                });
            }
        }
    } else if (elem.type === 'table') {
        const elemW = (elem.width / htmlWidth) * pdfWidth;
        const elemH = (elem.height / htmlHeight) * pdfHeight;
        const elemX = (elem.x / htmlWidth) * pdfWidth;
        const elemY = pdfHeight - ((elem.y + elem.height) / htmlHeight) * pdfHeight;

        const cellW = elemW / (elem.cols || 1);
        const cellH = elemH / (elem.rows || 1);
        const headerRgb = parseRgbColor(elem.headerBg) || rgb(0.12, 0.16, 0.23);
        const borderRgb = rgb(0.55, 0.6, 0.7);

        for (let r = 0; r < (elem.rows || 1); r++) {
            for (let c = 0; c < (elem.cols || 1); c++) {
                const cx = elemX + c * cellW;
                const cy = elemY + (elem.rows - 1 - r) * cellH;

                page.drawRectangle({
                    x: cx,
                    y: cy,
                    width: cellW,
                    height: cellH,
                    color: r === 0 ? headerRgb : rgb(1, 1, 1),
                    borderColor: borderRgb,
                    borderWidth: 1
                });

                const cellText = (elem.data[r] && elem.data[r][c]) ? sanitizeTextForPdf(elem.data[r][c]) : '';
                if (cellText) {
                    const fontSize = Math.max(7, Math.min(cellH * 0.45, 11));
                    page.drawText(cellText, {
                        x: cx + 5,
                        y: cy + cellH / 2 - fontSize / 3,
                        size: fontSize,
                        font: helveticaFont,
                        color: r === 0 ? rgb(1, 1, 1) : rgb(0, 0, 0)
                    });
                }
            }
        }
    } else if (elem.type === 'image' && elem.dataUrl) {
        const imgBytes = dataUrlToBytes(elem.dataUrl);
        if (!imgBytes) return;

        let image;
        if (elem.dataUrl.includes('image/jpeg') || elem.dataUrl.includes('image/jpg')) {
            image = await pdfDoc.embedJpg(imgBytes);
        } else {
            image = await pdfDoc.embedPng(imgBytes);
        }

        const elemW = (elem.width / htmlWidth) * pdfWidth;
        const elemH = (elem.height / htmlHeight) * pdfHeight;
        const elemX = (elem.x / htmlWidth) * pdfWidth;
        const elemY = pdfHeight - ((elem.y + elem.height) / htmlHeight) * pdfHeight;

        page.drawImage(image, {
            x: elemX,
            y: elemY,
            width: elemW,
            height: elemH,
        });
    }
}

/**
 * PDF Editor Manager
 * Manages PDF.js rendering, pdf-lib modification, overlay elements (signatures & text)
 */
class PDFEditor {
    constructor() {
        this.pdfDoc = null; // pdfjs document
        this.pdfBytes = null; // Uint8Array of current working PDF
        this.originalPdfBytes = null; // Uint8Array copy of original untouched PDF
        this.filename = 'document.pdf';
        
        this.currentPage = 1;
        this.totalPages = 0;
        this.zoom = 1.0;
        
        // Page state tracking
        this.pageRotations = {}; // pageNum -> degrees (0, 90, 180, 270)
        this.deletedPages = new Set();
        
        // Placed elements: pageNum -> Array of { id, type: 'signature'|'text'|'whiteout', x, y, width, height, ... }
        this.elements = {};
        
        this.selectedElement = null;
        this.clipboardElement = null; // Clipboard object for Ctrl+C / Ctrl+V
        this.activeTool = 'select'; // 'select', 'signature', 'text'
        this.pendingSignatureData = null; // Signature dataURL ready to be placed

        // Drawing tool state
        this.currentTool = 'select'; // 'select', 'draw', 'highlighter'
        this.drawColor = '#000000';
        this.drawSize = 2;
        this.drawings = {}; // pageNum -> Array of stroke objects
        this.isDrawingOnCanvas = false;
        this.currentStroke = null;

        // Photoshop-style Layers state
        this.pdfLayerVisible = true;
        this.drawLayerVisible = true;
        this.customLayers = {}; // pageNum -> Array of { id, name, hidden }

        // Grid, Margins & Rulers state
        this.gridActive = false;
        this.marginsActive = false;
        this.rulersActive = false;

        // Custom paper sizes per page
        this.paperSizes = {}; // pageNum -> preset name ('a4', 'a3', 'letter', 'legal', 'a5', 'square')

        // Step-by-step History Stack
        this.historyStack = [];
        this.redoStack = [];

        this.initUI();
    }

    initUI() {
        // Configure PDF.js worker
        if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // Initialize Markdown Presentation modal & side panel
        this.initMarkdownModal();
        this.initMarkdownSidePanel();

        // File upload listeners
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        const selectPdfBtn = document.getElementById('select-pdf-btn');
        const headerOpenPdfBtn = document.getElementById('btn-header-open-pdf');

        const openFilePicker = (e) => {
            if (e) e.stopPropagation();
            if (fileInput) {
                fileInput.value = '';
                fileInput.click();
            }
        };

        if (selectPdfBtn) selectPdfBtn.addEventListener('click', openFilePicker);
        if (headerOpenPdfBtn) headerOpenPdfBtn.addEventListener('click', openFilePicker);

        if (dropZone && fileInput) {
            dropZone.addEventListener('click', (e) => {
                if (e.target !== selectPdfBtn) {
                    openFilePicker(e);
                }
            });

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                if (e.dataTransfer.files.length > 0) {
                    this.loadPDFFile(e.dataTransfer.files[0]);
                }
            });

            fileInput.addEventListener('change', (e) => {
                if (e.target.files.length > 0) {
                    this.loadPDFFile(e.target.files[0]);
                    e.target.value = '';
                }
            });
        }

        // Page navigation buttons
        document.getElementById('btn-prev-page')?.addEventListener('click', () => this.changePage(-1));
        document.getElementById('btn-next-page')?.addEventListener('click', () => this.changePage(1));
        document.getElementById('page-num-input')?.addEventListener('change', (e) => {
            const val = parseInt(e.target.value);
            if (val >= 1 && val <= this.totalPages) {
                this.goToPage(val);
            }
        });

        // Zoom buttons
        document.getElementById('btn-zoom-in')?.addEventListener('click', () => this.setZoom(this.zoom + 0.15));
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.setZoom(this.zoom - 0.15));

        // Page rotation & delete
        document.getElementById('btn-rotate-left')?.addEventListener('click', () => this.rotateCurrentPage(-90));
        document.getElementById('btn-rotate-right')?.addEventListener('click', () => this.rotateCurrentPage(90));
        document.getElementById('btn-delete-page')?.addEventListener('click', () => this.deleteCurrentPage());

        // Window-wide Drag and Drop support to open PDF anytime
        window.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
            const dropCard = document.getElementById('drop-zone');
            if (dropCard) dropCard.classList.add('dragover');
        });

        window.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (e.clientX <= 0 || e.clientY <= 0) {
                const dropCard = document.getElementById('drop-zone');
                if (dropCard) dropCard.classList.remove('dragover');
            }
        });

        window.addEventListener('drop', (e) => {
            e.preventDefault();
            const dropCard = document.getElementById('drop-zone');
            if (dropCard) dropCard.classList.remove('dragover');

            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    this.loadPDFFile(file);
                } else {
                    showToast('Por favor selecciona o arrastra un archivo PDF válido.', 'danger');
                }
            }
        });

        // Add Text & Whiteout buttons
        document.getElementById('btn-add-text')?.addEventListener('click', () => this.addTextToCurrentPage());
        document.getElementById('btn-add-whiteout')?.addEventListener('click', () => this.addWhiteoutToCurrentPage());

        // Blank PDF & Page buttons
        document.getElementById('btn-create-blank-pdf')?.addEventListener('click', () => {
            document.getElementById('template-modal')?.classList.add('show');
        });
        document.getElementById('create-blank-pdf-card-btn')?.addEventListener('click', () => {
            document.getElementById('template-modal')?.classList.add('show');
        });
        document.getElementById('btn-add-blank-page')?.addEventListener('click', () => this.addBlankPage());

        // Shapes & Table Buttons
        document.getElementById('btn-add-table')?.addEventListener('click', () => this.addTableToCurrentPage());
        document.getElementById('btn-add-shape-rect')?.addEventListener('click', () => this.addShapeToCurrentPage('rectangle'));
        document.getElementById('btn-add-shape-circle')?.addEventListener('click', () => this.addShapeToCurrentPage('circle'));
        document.getElementById('btn-add-shape-arrow')?.addEventListener('click', () => this.addShapeToCurrentPage('arrow'));
        document.getElementById('btn-add-shape-star')?.addEventListener('click', () => this.addShapeToCurrentPage('star'));

        // Insert Image button
        const btnAddImage = document.getElementById('btn-add-image');
        const imageFileInput = document.getElementById('image-file-input');
        if (btnAddImage && imageFileInput) {
            btnAddImage.addEventListener('click', () => {
                imageFileInput.value = '';
                imageFileInput.click();
            });

            imageFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.handleImageUpload(e.target.files[0]);
                }
            });
        }

        // Grid, Margins, Rulers & Paper Size listeners
        document.getElementById('btn-toggle-grid')?.addEventListener('click', () => this.toggleGrid());
        document.getElementById('btn-toggle-margins')?.addEventListener('click', () => this.toggleMargins());
        document.getElementById('btn-toggle-rulers')?.addEventListener('click', () => this.toggleRulers());
        document.getElementById('btn-add-custom-layer')?.addEventListener('click', () => this.addCustomLayer());
        document.getElementById('paper-size-select')?.addEventListener('change', (e) => {
            this.changePaperSize(e.target.value);
        });

        // Mode Tool Switching (Mover, Dibujar, Resaltar)
        document.getElementById('tool-select-btn')?.addEventListener('click', () => this.setTool('select'));
        document.getElementById('tool-draw-btn')?.addEventListener('click', () => this.setTool('draw'));
        document.getElementById('tool-highlight-btn')?.addEventListener('click', () => this.setTool('highlighter'));

        // Color Dots
        document.querySelectorAll('.draw-color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                document.querySelectorAll('.draw-color-dot').forEach(d => d.classList.remove('active'));
                dot.classList.add('active');
                this.drawColor = dot.dataset.color;
            });
        });

        // Size Picker
        document.querySelectorAll('.draw-size-picker button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.draw-size-picker button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.drawSize = parseInt(btn.dataset.size);
            });
        });

        // Undo & Clear Drawings
        document.getElementById('btn-undo-draw')?.addEventListener('click', () => this.undoLastDraw());
        document.getElementById('btn-clear-draw')?.addEventListener('click', () => this.clearDrawings());

        // Export/Save buttons
        document.getElementById('btn-export-pdf')?.addEventListener('click', () => this.exportPDF());
        document.getElementById('btn-export-split-pdf')?.addEventListener('click', () => this.exportSplitPDF());
        document.getElementById('btn-revert-changes')?.addEventListener('click', () => this.revertChanges());
        document.getElementById('btn-undo-step')?.addEventListener('click', () => this.undoStep());
        document.getElementById('btn-redo-step')?.addEventListener('click', () => this.redoStep());
        document.getElementById('btn-fullscreen')?.addEventListener('click', () => this.toggleFullscreen());
        document.getElementById('btn-screenshot')?.addEventListener('click', () => this.captureScreenAndInsert());

        // Setup draw canvas listeners
        this.setupDrawCanvasListeners();

        // Keyboard Shortcuts (Ctrl+C / Ctrl+V / Cmd+C / Cmd+V / Delete / Backspace)
        window.addEventListener('keydown', (e) => {
            // Ignore shortcuts if typing inside an editable field or input box
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            const isEditingText = document.activeElement && (
                activeTag === 'input' || 
                activeTag === 'textarea' || 
                document.activeElement.isContentEditable
            );

            const isCmdOrCtrl = e.metaKey || e.ctrlKey;

            // Copy: Ctrl+C / Cmd+C
            if (isCmdOrCtrl && e.key.toLowerCase() === 'c') {
                if (!isEditingText && this.selectedElement) {
                    e.preventDefault();
                    this.copySelectedElement();
                }
            }

            // Paste: Ctrl+V / Cmd+V
            if (isCmdOrCtrl && e.key.toLowerCase() === 'v') {
                if (!isEditingText && this.clipboardElement) {
                    e.preventDefault();
                    this.pasteClipboardElement();
                }
            }

            // Delete: Supr / Backspace
            if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditingText) {
                if (this.selectedElement) {
                    e.preventDefault();
                    this.removeElement(this.selectedElement.id);
                }
            }
        });

        // Deselect element when clicking outside
        document.getElementById('viewport-container')?.addEventListener('click', (e) => {
            if (e.target.id === 'viewport-container' || e.target.classList.contains('annotation-layer')) {
                this.deselectElement();
            }
        });
    }

    setupDrawCanvasListeners() {
        const canvas = document.getElementById('draw-canvas');
        if (!canvas) return;

        const getPos = (e) => {
            const rect = canvas.getBoundingClientRect();
            const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (canvas.width / rect.width),
                y: (clientY - rect.top) * (canvas.height / rect.height)
            };
        };

        const startDrawing = (e) => {
            if (this.currentTool === 'select') return;
            e.preventDefault();
            this.isDrawingOnCanvas = true;
            const pos = getPos(e);

            this.currentStroke = {
                tool: this.currentTool,
                color: this.drawColor,
                size: this.currentTool === 'highlighter' ? Math.max(12, this.drawSize * 2.5) : this.drawSize,
                opacity: this.currentTool === 'highlighter' ? 0.35 : 1.0,
                points: [pos]
            };

            if (!this.drawings[this.currentPage]) {
                this.drawings[this.currentPage] = [];
            }
        };

        const draw = (e) => {
            if (!this.isDrawingOnCanvas || !this.currentStroke) return;
            e.preventDefault();
            const pos = getPos(e);
            this.currentStroke.points.push(pos);

            const ctx = canvas.getContext('2d');
            const pts = this.currentStroke.points;
            if (pts.length >= 2) {
                ctx.beginPath();
                ctx.strokeStyle = this.currentStroke.color;
                ctx.lineWidth = this.currentStroke.size;
                ctx.globalAlpha = this.currentStroke.opacity;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
                ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
                ctx.stroke();
                ctx.globalAlpha = 1.0;
            }
        };

        const stopDrawing = (e) => {
            if (this.isDrawingOnCanvas && this.currentStroke && this.currentStroke.points.length > 0) {
                this.drawings[this.currentPage].push(this.currentStroke);
                this.currentStroke = null;
                this.saveHistoryState();
            }
            this.isDrawingOnCanvas = false;
        };

        canvas.addEventListener('mousedown', startDrawing);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDrawing);
        canvas.addEventListener('mouseleave', stopDrawing);

        canvas.addEventListener('touchstart', startDrawing);
        canvas.addEventListener('touchmove', draw);
        canvas.addEventListener('touchend', stopDrawing);
    }

    setTool(toolName) {
        this.currentTool = toolName;

        const selectBtn = document.getElementById('tool-select-btn');
        const drawBtn = document.getElementById('tool-draw-btn');
        const highlightBtn = document.getElementById('tool-highlight-btn');

        if (selectBtn) {
            selectBtn.classList.toggle('active', toolName === 'select');
            selectBtn.classList.toggle('btn-primary', toolName === 'select');
            selectBtn.classList.toggle('btn-secondary', toolName !== 'select');
        }
        if (drawBtn) {
            drawBtn.classList.toggle('active', toolName === 'draw');
            drawBtn.classList.toggle('btn-primary', toolName === 'draw');
            drawBtn.classList.toggle('btn-secondary', toolName !== 'draw');
        }
        if (highlightBtn) {
            highlightBtn.classList.toggle('active', toolName === 'highlighter');
            highlightBtn.classList.toggle('btn-primary', toolName === 'highlighter');
            highlightBtn.classList.toggle('btn-secondary', toolName !== 'highlighter');
        }

        const drawOptionsGroup = document.getElementById('draw-options-group');
        if (drawOptionsGroup) {
            drawOptionsGroup.style.opacity = toolName === 'select' ? '0.5' : '1.0';
        }

        this.redrawDrawCanvas();
    }

    undoLastDraw() {
        if (this.drawings[this.currentPage] && this.drawings[this.currentPage].length > 0) {
            this.drawings[this.currentPage].pop();
            this.redrawDrawCanvas();
            showToast('Último trazo deshecho.', 'info');
        }
    }

    clearDrawings() {
        if (this.drawings[this.currentPage] && this.drawings[this.currentPage].length > 0) {
            this.drawings[this.currentPage] = [];
            this.redrawDrawCanvas();
            showToast('Dibujos de la página borrados.', 'info');
        }
    }

    redrawDrawCanvas() {
        const canvas = document.getElementById('draw-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (this.currentTool === 'select') {
            canvas.classList.remove('active');
        } else {
            canvas.classList.add('active');
        }

        const pageStrokes = this.drawings[this.currentPage] || [];
        pageStrokes.forEach(stroke => {
            if (!stroke.points || stroke.points.length < 1) return;
            ctx.beginPath();
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.size;
            ctx.globalAlpha = stroke.opacity || 1.0;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
            for (let i = 1; i < stroke.points.length; i++) {
                ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
            }
            ctx.stroke();
            ctx.globalAlpha = 1.0;
        });
    }

    handleImageUpload(file) {
        if (!file || !file.type.startsWith('image/')) {
            showToast('Por favor selecciona un archivo de imagen válido (PNG, JPG, WebP).', 'danger');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            const img = new Image();
            img.onload = () => {
                if (!this.elements[this.currentPage]) {
                    this.elements[this.currentPage] = [];
                }

                let width = img.width || 200;
                let height = img.height || 200;
                const maxW = 280;
                if (width > maxW) {
                    height = (maxW / width) * height;
                    width = maxW;
                }

                const newElem = {
                    id: 'elem_' + Date.now(),
                    type: 'image',
                    dataUrl: dataUrl,
                    name: file.name,
                    x: 100,
                    y: 100,
                    width: Math.round(width),
                    height: Math.round(height)
                };

                this.elements[this.currentPage].push(newElem);
                this.saveHistoryState();
                this.renderAnnotations();
                this.selectElement(newElem);
                showToast('Imagen insertada correctamente. Puedes moverla y redimensionarla.', 'success');
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    }

    toggleGrid() {
        this.gridActive = !this.gridActive;
        const gridOverlay = document.getElementById('grid-overlay');
        const btn = document.getElementById('btn-toggle-grid');
        if (gridOverlay) gridOverlay.classList.toggle('active', this.gridActive);
        if (btn) {
            btn.classList.toggle('btn-primary', this.gridActive);
            btn.classList.toggle('btn-secondary', !this.gridActive);
        }
        showToast(this.gridActive ? '🏁 Malla de cuadros activada (Ajuste a cuadrícula activo)' : 'Malla desactivada', 'info');
    }

    toggleMargins() {
        this.marginsActive = !this.marginsActive;
        const marginsOverlay = document.getElementById('margins-overlay');
        const btn = document.getElementById('btn-toggle-margins');
        if (marginsOverlay) marginsOverlay.classList.toggle('active', this.marginsActive);
        if (btn) {
            btn.classList.toggle('btn-primary', this.marginsActive);
            btn.classList.toggle('btn-secondary', !this.marginsActive);
        }
        showToast(this.marginsActive ? '📐 Márgenes de impresión (15mm) activados' : 'Márgenes desactivados', 'info');
    }

    toggleRulers() {
        this.rulersActive = !this.rulersActive;
        const viewport = document.getElementById('viewport-container');
        const corner = document.getElementById('ruler-corner');
        const hRuler = document.getElementById('ruler-horizontal');
        const vRuler = document.getElementById('ruler-vertical');
        const btn = document.getElementById('btn-toggle-rulers');

        if (viewport) viewport.classList.toggle('has-rulers', this.rulersActive);
        if (corner) corner.style.display = this.rulersActive ? 'block' : 'none';
        if (hRuler) hRuler.style.display = this.rulersActive ? 'block' : 'none';
        if (vRuler) vRuler.style.display = this.rulersActive ? 'block' : 'none';
        if (btn) {
            btn.classList.toggle('btn-primary', this.rulersActive);
            btn.classList.toggle('btn-secondary', !this.rulersActive);
        }

        if (this.rulersActive) {
            this.renderRulers();
        }
        showToast(this.rulersActive ? '📏 Reglas de borde activadas' : 'Reglas desactivadas', 'info');
    }

    renderRulers() {
        const hRuler = document.getElementById('ruler-horizontal');
        const vRuler = document.getElementById('ruler-vertical');
        if (!hRuler || !vRuler) return;

        hRuler.innerHTML = '';
        vRuler.innerHTML = '';

        const pageContainer = document.getElementById('page-container');
        const width = pageContainer ? pageContainer.offsetWidth : 800;
        const height = pageContainer ? pageContainer.offsetHeight : 1000;

        for (let x = 0; x < width + 200; x += 50) {
            const tick = document.createElement('div');
            tick.className = 'ruler-tick';
            tick.style.left = `${x}px`;
            tick.style.top = '8px';
            tick.innerText = `${x}`;
            hRuler.appendChild(tick);
        }

        for (let y = 0; y < height + 200; y += 50) {
            const tick = document.createElement('div');
            tick.className = 'ruler-tick';
            tick.style.top = `${y}px`;
            tick.style.left = '4px';
            tick.innerText = `${y}`;
            vRuler.appendChild(tick);
        }
    }

    async changePaperSize(preset) {
        if (!this.pdfBytes) return;

        const paperDimensions = {
            'a4': [595.28, 841.89],
            'a3': [841.89, 1190.55],
            'letter': [612.00, 792.00],
            'legal': [612.00, 1008.00],
            'a5': [419.53, 595.28],
            'square': [566.93, 566.93]
        };

        const targetSize = paperDimensions[preset] || paperDimensions['a4'];
        showToast(`Cambiando tamaño de página a ${preset.toUpperCase()}...`, 'info');

        try {
            const { PDFDocument } = window.PDFLib;
            const doc = await PDFDocument.load(this.pdfBytes.slice(0), { ignoreEncryption: true });
            const pages = doc.getPages();
            if (pages[this.currentPage - 1]) {
                pages[this.currentPage - 1].setSize(targetSize[0], targetSize[1]);
            }
            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, this.filename, false);
            this.saveHistoryState();
            showToast(`Tamaño de página cambiado a ${preset.toUpperCase()}.`, 'success');
        } catch (err) {
            console.error('Error cambiando tamaño de papel:', err);
            showToast('Error al cambiar el tamaño del papel.', 'danger');
        }
    }

    addCustomLayer() {
        if (!this.pdfBytes) {
            showToast('Primero debes cargar un archivo PDF.', 'danger');
            return;
        }

        if (!this.customLayers[this.currentPage]) {
            this.customLayers[this.currentPage] = [];
        }

        const layerNum = this.customLayers[this.currentPage].length + 1;
        const layerName = prompt('Nombre de la nueva capa:', `Capa ${layerNum}`);
        if (!layerName || !layerName.trim()) return;

        const newLayer = {
            id: 'layer_' + Date.now(),
            name: layerName.trim(),
            hidden: false
        };

        this.customLayers[this.currentPage].push(newLayer);
        this.saveHistoryState();
        this.renderLayersPanel();
        showToast(`Capa "${newLayer.name}" creada.`, 'success');
    }

    saveHistoryState() {
        if (!this.pdfBytes) return;
        const snapshotStr = JSON.stringify({
            elements: this.elements,
            drawings: this.drawings,
            customLayers: this.customLayers,
            pageRotations: this.pageRotations,
            deletedPages: Array.from(this.deletedPages),
            pdfLayerVisible: this.pdfLayerVisible,
            drawLayerVisible: this.drawLayerVisible
        });

        if (this.historyStack.length > 0 && this.historyStack[this.historyStack.length - 1] === snapshotStr) {
            return;
        }

        this.historyStack.push(snapshotStr);
        if (this.historyStack.length > 40) {
            this.historyStack.shift();
        }
        this.redoStack = [];
        this.updateUndoRedoButtons();
    }

    undoStep() {
        if (this.historyStack.length <= 1) {
            showToast('No hay más cambios anteriores para deshacer.', 'info');
            return;
        }

        const currentStr = this.historyStack.pop();
        this.redoStack.push(currentStr);

        const prevStr = this.historyStack[this.historyStack.length - 1];
        this.restoreSnapshot(JSON.parse(prevStr));
        showToast('↩️ Cambio deshecho (paso a paso).', 'info');
    }

    redoStep() {
        if (this.redoStack.length === 0) {
            showToast('No hay cambios para rehacer.', 'info');
            return;
        }

        const nextStr = this.redoStack.pop();
        this.historyStack.push(nextStr);

        this.restoreSnapshot(JSON.parse(nextStr));
        showToast('↪️ Cambio rehecho.', 'info');
    }

    restoreSnapshot(snapshot) {
        this.elements = snapshot.elements || {};
        this.drawings = snapshot.drawings || {};
        this.customLayers = snapshot.customLayers || {};
        this.pageRotations = snapshot.pageRotations || {};
        this.deletedPages = new Set(snapshot.deletedPages || []);
        this.pdfLayerVisible = snapshot.pdfLayerVisible !== undefined ? snapshot.pdfLayerVisible : true;
        this.drawLayerVisible = snapshot.drawLayerVisible !== undefined ? snapshot.drawLayerVisible : true;

        this.selectedElement = null;
        this.renderCurrentPage();
        this.updateUndoRedoButtons();
    }

    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('btn-undo-step');
        const redoBtn = document.getElementById('btn-redo-step');
        if (undoBtn) {
            undoBtn.style.opacity = this.historyStack.length > 1 ? '1.0' : '0.4';
        }
        if (redoBtn) {
            redoBtn.style.opacity = this.redoStack.length > 0 ? '1.0' : '0.4';
        }
    }

    renderLayersPanel() {
        const container = document.getElementById('layers-container');
        if (!container) return;
        container.innerHTML = '';

        if (!this.pdfBytes) {
            container.innerHTML = `
                <div style="color: var(--text-muted); font-size: 0.78rem; text-align: center; padding: 0.5rem 0;">
                    Carga un PDF para ver y gestionar sus capas.
                </div>
            `;
            return;
        }

        // Layer 1: Base PDF Layer
        const pdfItem = document.createElement('div');
        pdfItem.className = `layer-item ${!this.pdfLayerVisible ? 'hidden-layer' : ''}`;
        pdfItem.innerHTML = `
            <button class="layer-eye-btn ${this.pdfLayerVisible ? 'visible' : ''}" title="${this.pdfLayerVisible ? 'Ocultar PDF base' : 'Mostrar PDF base'}">
                <i class="fas ${this.pdfLayerVisible ? 'fa-eye' : 'fa-eye-slash'}"></i>
            </button>
            <div class="layer-info">
                <i class="fas fa-file-pdf" style="color: #3b82f6;"></i>
                <span class="layer-title">Fondo PDF Original</span>
            </div>
        `;
        pdfItem.querySelector('.layer-eye-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.pdfLayerVisible = !this.pdfLayerVisible;
            this.renderCurrentPage();
        });
        container.appendChild(pdfItem);

        // Layer 2: Freehand Drawings Layer
        const drawItem = document.createElement('div');
        drawItem.className = `layer-item ${!this.drawLayerVisible ? 'hidden-layer' : ''}`;
        drawItem.innerHTML = `
            <button class="layer-eye-btn ${this.drawLayerVisible ? 'visible' : ''}" title="${this.drawLayerVisible ? 'Ocultar dibujos' : 'Mostrar dibujos'}">
                <i class="fas ${this.drawLayerVisible ? 'fa-eye' : 'fa-eye-slash'}"></i>
            </button>
            <div class="layer-info">
                <i class="fas fa-pen-nib" style="color: #f59e0b;"></i>
                <span class="layer-title">Dibujos a Mano Alzada</span>
            </div>
        `;
        drawItem.querySelector('.layer-eye-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            this.drawLayerVisible = !this.drawLayerVisible;
            this.renderCurrentPage();
        });
        container.appendChild(drawItem);

        // Render Custom User Created Layers
        const userLayers = this.customLayers[this.currentPage] || [];
        userLayers.forEach((cLayer, cIdx) => {
            const item = document.createElement('div');
            item.className = `layer-item ${cLayer.hidden ? 'hidden-layer' : ''}`;
            item.innerHTML = `
                <button class="layer-eye-btn ${!cLayer.hidden ? 'visible' : ''}" title="${cLayer.hidden ? 'Mostrar capa' : 'Ocultar capa'}">
                    <i class="fas ${!cLayer.hidden ? 'fa-eye' : 'fa-eye-slash'}"></i>
                </button>
                <div class="layer-info">
                    <i class="fas fa-layer-group" style="color: #3b82f6;"></i>
                    <span class="layer-title">${cLayer.name}</span>
                </div>
                <div class="layer-actions">
                    <button class="layer-eye-btn btn-del-layer delete" title="Eliminar capa"><i class="fas fa-trash"></i></button>
                </div>
            `;

            item.querySelector('.layer-eye-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                cLayer.hidden = !cLayer.hidden;
                this.renderLayersPanel();
            });

            item.querySelector('.btn-del-layer')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm(`¿Eliminar la capa "${cLayer.name}"?`)) {
                    this.customLayers[this.currentPage].splice(cIdx, 1);
                    this.saveHistoryState();
                    this.renderLayersPanel();
                    showToast('Capa eliminada.', 'info');
                }
            });

            container.appendChild(item);
        });

        // Layers 3+: Placed Elements on Current Page
        const pageElems = this.elements[this.currentPage] || [];
        pageElems.forEach((elem, index) => {
            const item = document.createElement('div');
            const isSelected = this.selectedElement?.id === elem.id;
            item.className = `layer-item ${isSelected ? 'active-layer' : ''} ${elem.hidden ? 'hidden-layer' : ''}`;

            let icon = 'fa-cube';
            let label = 'Objeto';
            if (elem.type === 'text') { icon = 'fa-font'; label = elem.text ? `Texto: "${elem.text.substring(0, 15)}..."` : 'Texto'; }
            else if (elem.type === 'image') { icon = 'fa-image'; label = elem.name ? `Imagen (${elem.name})` : 'Imagen'; }
            else if (elem.type === 'signature') { icon = 'fa-signature'; label = 'Firma Digital'; }
            else if (elem.type === 'shape') { icon = 'fa-shapes'; label = `Figura (${elem.shapeType})`; }
            else if (elem.type === 'table') { icon = 'fa-table'; label = `Tabla (${elem.rows}x${elem.cols})`; }
            else if (elem.type === 'whiteout') { icon = 'fa-eraser'; label = 'Borrador / Tipex'; }

            item.innerHTML = `
                <button class="layer-eye-btn ${!elem.hidden ? 'visible' : ''}" title="${elem.hidden ? 'Mostrar capa' : 'Ocultar capa'}">
                    <i class="fas ${!elem.hidden ? 'fa-eye' : 'fa-eye-slash'}"></i>
                </button>
                <div class="layer-info">
                    <i class="fas ${icon}" style="color: #94a3b8;"></i>
                    <span class="layer-title">${label}</span>
                </div>
                <div class="layer-actions">
                    <button class="layer-eye-btn btn-move-up" title="Traer al frente" ${index === pageElems.length - 1 ? 'disabled' : ''}>▲</button>
                    <button class="layer-eye-btn btn-move-down" title="Enviar al fondo" ${index === 0 ? 'disabled' : ''}>▼</button>
                </div>
            `;

            item.querySelector('.layer-eye-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                elem.hidden = !elem.hidden;
                this.renderAnnotations();
                this.renderLayersPanel();
            });

            item.querySelector('.btn-move-up')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (index < pageElems.length - 1) {
                    const temp = pageElems[index];
                    pageElems[index] = pageElems[index + 1];
                    pageElems[index + 1] = temp;
                    this.saveHistoryState();
                    this.renderAnnotations();
                    this.renderLayersPanel();
                }
            });

            item.querySelector('.btn-move-down')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (index > 0) {
                    const temp = pageElems[index];
                    pageElems[index] = pageElems[index - 1];
                    pageElems[index - 1] = temp;
                    this.saveHistoryState();
                    this.renderAnnotations();
                    this.renderLayersPanel();
                }
            });

            item.addEventListener('click', () => {
                this.selectElement(elem);
            });

            container.appendChild(item);
        });
    }

    async loadPDFBytes(bytes, filename = 'documento.pdf', isInitialLoad = true) {
        this.filename = filename;
        this.pdfBytes = new Uint8Array(bytes);
        if (isInitialLoad) {
            this.originalPdfBytes = new Uint8Array(bytes);
        }

        const loadingTask = window.pdfjsLib.getDocument({ data: this.pdfBytes.slice(0) });
        this.pdfDoc = await loadingTask.promise;

        this.totalPages = this.pdfDoc.numPages;
        this.currentPage = 1;
        this.pageRotations = {};
        this.deletedPages.clear();
        this.elements = {};
        if (!this.drawings) this.drawings = {};

        document.getElementById('drop-zone-overlay').style.display = 'none';
        document.getElementById('editor-workspace').style.display = 'flex';
        document.getElementById('template-modal')?.classList.remove('show');
        document.getElementById('header-file-title').innerText = filename;

        await this.renderThumbnails();
        await this.renderCurrentPage();
    }

    async loadPDFFile(file) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            showToast('Por favor selecciona un archivo PDF válido.', 'danger');
            return;
        }

        showToast(`Cargando ${file.name}...`, 'info');

        try {
            const arrayBuffer = await file.arrayBuffer();
            await this.loadPDFBytes(arrayBuffer, file.name);
            showToast('PDF cargado correctamente', 'success');
        } catch (err) {
            console.error('Error cargando PDF:', err);
            showToast('Error al procesar el archivo PDF.', 'danger');
        }
    }

    async revertChanges() {
        if (!this.originalPdfBytes || this.originalPdfBytes.length === 0) {
            showToast('No hay documento original cargado para revertir.', 'danger');
            return;
        }

        if (confirm('¿Estás seguro de que deseas revertir todos los cambios y restaurar el archivo original? Se eliminarán los textos, firmas, dibujos y rotaciones agregados.')) {
            showToast('Revirtiendo cambios y restaurando el documento original...', 'info');
            try {
                this.elements = {};
                this.drawings = {};
                this.pageRotations = {};
                this.deletedPages.clear();
                
                await this.loadPDFBytes(this.originalPdfBytes, this.filename, false);
                this.setTool('select');
                showToast('Documento restaurado a su estado original.', 'success');
            } catch (err) {
                console.error('Error al revertir cambios:', err);
                showToast('Error al revertir los cambios.', 'danger');
            }
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => {
                showToast('Pantalla completa activada.', 'info');
            }).catch(err => {
                showToast('No se pudo activar pantalla completa: ' + (err.message || err), 'danger');
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().then(() => {
                    showToast('Pantalla completa desactivada.', 'info');
                });
            }
        }
    }

    async captureScreenAndInsert() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            showToast('Tu navegador no soporta la captura de pantalla directa.', 'danger');
            return;
        }

        showToast('Selecciona la ventana o pantalla a capturar...', 'info');

        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: 'browser' },
                audio: false
            });

            const video = document.createElement('video');
            video.srcObject = stream;
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    video.play();
                    resolve();
                };
            });

            // Wait a moment for video frame to render
            await new Promise((resolve) => setTimeout(resolve, 300));

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth || 1280;
            canvas.height = video.videoHeight || 720;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const pngDataUrl = canvas.toDataURL('image/png');

            // Stop screen capture stream tracks
            stream.getTracks().forEach(track => track.stop());

            // Check if we have a PDF loaded, if not create one
            if (!this.pdfBytes) {
                await this.createNewBlankPDF();
            }

            // Check current page screenshots count
            let pageElems = this.elements[this.currentPage] || [];
            let currentCaptures = pageElems.filter(e => e.isScreenshot);

            // If current page already has 2 screenshots, navigate to or add next page
            if (currentCaptures.length >= 2) {
                if (this.currentPage < this.totalPages && !this.deletedPages.has(this.currentPage + 1)) {
                    this.goToPage(this.currentPage + 1);
                } else {
                    await this.addBlankPage();
                }
                pageElems = this.elements[this.currentPage] || [];
                currentCaptures = pageElems.filter(e => e.isScreenshot);
            }

            const slotIndex = currentCaptures.length; // 0 (top) or 1 (bottom)
            const captureNum = (this.currentPage - 1) * 2 + slotIndex + 1;

            const headerY = slotIndex === 0 ? 30 : 330;
            const imageY = slotIndex === 0 ? 60 : 360;

            // 1. Add Editable Header Text Element
            const headerTextElem = {
                id: 'elem_' + Date.now() + '_hdr',
                type: 'text',
                text: `Captura ${captureNum}: Título de la imagen (haz doble clic para cambiar)`,
                x: 35,
                y: headerY,
                fontSize: 14,
                color: '#1d4ed8',
                width: 500,
                height: 25,
                bgWhite: false
            };

            // 2. Add Screenshot Image Element
            const imageElem = {
                id: 'elem_' + Date.now() + '_img',
                type: 'image',
                isScreenshot: true,
                dataUrl: pngDataUrl,
                name: `Captura_${captureNum}`,
                x: 35,
                y: imageY,
                width: 520,
                height: 250
            };

            if (!this.elements[this.currentPage]) {
                this.elements[this.currentPage] = [];
            }

            this.elements[this.currentPage].push(headerTextElem);
            this.elements[this.currentPage].push(imageElem);

            this.saveHistoryState();
            this.renderAnnotations();
            this.selectElement(imageElem);

            showToast(`📸 Captura #${captureNum} insertada en la página con cabecera editable.`, 'success');
        } catch (err) {
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showToast('Captura de pantalla cancelada.', 'info');
            } else {
                console.error('Error al capturar pantalla:', err);
                showToast('Error al realizar la captura de pantalla.', 'danger');
            }
        }
    }

    async createFromTemplate(type) {
        if (!type || type === 'blank') {
            await this.createNewBlankPDF();
            return;
        }

        this.currentTemplateType = type;
        const mdText = this.getMarkdownSampleForType(type);
        this.currentMarkdownText = mdText;
        localStorage.setItem('saved_presentation_md', mdText);

        // Sync dropdown selectors and textareas
        const modalSelect = document.getElementById('modal-md-template-select');
        if (modalSelect) modalSelect.value = type;
        const sideSelect = document.getElementById('side-md-template-select');
        if (sideSelect) sideSelect.value = type;

        const modalTextarea = document.getElementById('md-editor-textarea');
        if (modalTextarea) modalTextarea.value = mdText;
        const sideTextarea = document.getElementById('md-side-textarea');
        if (sideTextarea) sideTextarea.value = mdText;

        await this.createPDFFromMarkdown(mdText, type);
    }

    async createNewBlankPDF() {
        showToast('Creando nuevo documento PDF en blanco...', 'info');
        try {
            const { PDFDocument } = window.PDFLib;
            const blankDoc = await PDFDocument.create();
            blankDoc.addPage([595.28, 841.89]); // Standard A4
            const bytes = await blankDoc.save();
            await this.loadPDFBytes(bytes, 'nuevo_documento.pdf');
            showToast('Documento PDF en blanco creado. ¡Ya puedes escribir y dibujar!', 'success');
        } catch (err) {
            console.error('Error al crear PDF en blanco:', err);
            showToast('Error al crear el documento PDF en blanco.', 'danger');
        }
    }

    getMdVal(mdText, keyPattern, defaultVal = '') {
        if (!mdText) return defaultVal;
        const regex = new RegExp(`^(?:${keyPattern})\\s*:\\s*(.*)$`, 'im');
        const match = mdText.match(regex);
        if (match && match[1].trim()) {
            return match[1].trim().replace(/\\n/g, '\n');
        }
        return defaultVal;
    }

    getMarkdownSampleForType(type) {
        if (type === 'invoice') {
            return `# FACTURA
EMISOR: Empresa Ejemplo S.L.\\nNIF: B-12345678\\nCalle Mayor 100, Madrid
CLIENTE: Cliente Ejemplo S.A.\\nNIF: A-87654321\\nAv. Diagonal 45, Barcelona
NUMERO: FAC-2026-001
FECHA: 06 / 09 / 2026

## CONCEPTOS
| Concepto | Cantidad | Precio | Total |
| Desarrollo Web Application | 1 | 800.00 | 800.00 |
| Diseño UI/UX y Consultoría | 1 | 350.00 | 350.00 |

SUBTOTAL: 1150.00 EUR
IVA: 241.50 EUR
TOTAL: 1391.50 EUR
PAGO: Transferencia Bancaria IBAN: ES12 3456 7890 1234 5678`;
        } else if (type === 'diploma') {
            return `# DIPLOMA DE ACREDITACION
OTORGADO_A: Juan Pérez Gómez
CURSO: CURSO DE ESPECIALIZACION EN DESARROLLO WEB Y PDF TOOLS
FECHA: Expedido a 06 de Septiembre de 2026
INSTRUCTOR: Marlon Falcón Hernández
DIRECTOR: Dirección Académica`;
        } else if (type === 'sale') {
            return `# SE VENDE
TITULO: PISO LUMINOSO EN EL CENTRO
DESCRIPCION: Excelente oportunidad de compra en zona residencial tranquila.
PRECIO: 250.000 EUR
TELEFONO: 600 000 000

## CARACTERISTICAS
- Estado excelente / Seminuevo
- 3 Habitaciones, 2 Baños, Terraza y Garaje
- Incluye todos los accesorios y documentación
- Precio negociable / Oportunidad única`;
        } else if (type === 'business-cards') {
            return `# TARJETA DE PRESENTACION
NOMBRE: MARLON FALCON
CARGO: Consultor & Desarrollador Software
EMPRESA: Falcón Solutions
TELEFONO: Tel: +34 600 000 000
EMAIL: Email: contacto@marlonfalcon.com
WEB: Web: www.marlonfalcon.com
DIRECCION: Dirección: Calle Ejemplo 123, Madrid`;
        } else if (type === 'book-labels') {
            return `# ETIQUETA ESCOLAR
NOMBRE: Alejandro Falcón
ASIGNATURA: Matemáticas / Ciencias
CURSO: 4º Educación Primaria
COLEGIO: Colegio San José`;
        } else if (type === 'qr-poster') {
            return `# ESCANEE EL CODIGO QR
SUBTITULO: Accede de forma rápida desde tu teléfono móvil
URL_QR: https://www.marlonfalcon.com
INFORMACION: Abre la cámara de tu móvil y apunta hacia el código QR para abrir directamente la página web o catálogo.
UBICACION: Ubicación: Calle Principal 100 | Horario: 09:00 - 20:00 h`;
        } else if (type === 'mobile-wireframe') {
            return `# PROTOTIPO APP MOVIL
TITULO_APP: PROTOTIPO Y WIREFRAME DE APP MOVIL
PANTALLA_1: 1. Pantalla Login / Home
PANTALLA_2: 2. Pantalla Principal
PANTALLA_3: 3. Detalle / Perfil`;
        } else if (type === 'desktop-wireframe') {
            return `# PROTOTIPO APP DESKTOP
TITULO_VENTANA: https://mi-aplicacion-desktop.com/dashboard
NOMBRE_APP: MI APP DESKTOP
MENUS: Dashboard, Proyectos, Analítica, Usuarios, Ajustes
PANEL: PANEL PRINCIPAL DE TRABAJO`;
        } else if (type === 'job-offer') {
            return `# OFERTA DE EMPLEO
PUESTO: DESARROLLADOR / CONSULTOR SOFTWARE SENIOR
EMPRESA: Falcon Tech Solutions
UBICACION: Madrid, España / Híbrido
JORNADA: Tiempo Completo (40h/semana)
SALARIO: 35.000 EUR - 45.000 EUR Brutos / Año

## REQUISITOS
- Experiencia mínima de 3-5 años en desarrollo web.
- Dominio de Python, JavaScript, HTML5 y CSS3.
- Capacidad de trabajo en equipo y proactividad.

CONTACTO: Email: rrhh@empresa.com | Web: www.marlonfalcon.com`;
        } else if (type === 'money-receipt') {
            return `# COMPROBANTE DE RECEPCION
NUMERO: REC-2026-001
FECHA: 06/09/2026
PAGADOR: Nombre / Razón Social del cliente que entrega dinero
COBRADOR: Marlon Falcón Hernández / Empresa que recibe
IMPORTE: 500.00 EUR
CONCEPTO: Pago por concepto de servicios prestados / anticipo
FORMA_PAGO: [X] Efectivo   [ ] Transferencia Bancaria   [ ] Tarjeta`;
        } else if (type === 'whatsapp-status') {
            return `# ESTADO DE WHATSAPP / STORY
ESTILO: 1
TITULO: NUEVO PROYECTO 2026
SUBTITULO: Transformación Digital & Innovación
MENSAJE: Desarrollamos soluciones ágiles, modernas y 100% locales sin dependencias externas en la nube.
AUTOR: Marlon Falcón
SITIO_WEB: www.marlonfalcon.com
CONTACTO: +34 600 000 000
HASHTAG: #SoftwareDev #Tech2026 #PDFTools`;
        } else if (type === 'todo-list') {
            return `# LISTA DE TAREAS / TODO LIST
TITULO: OBJETIVOS Y TAREAS PENDIENTES 2026
FECHA: 06 / 09 / 2026
CATEGORIA: PROYECTO & PRODUCTIVIDAD

## TAREAS PRIORITARIAS
- [X] Definir arquitectura y requerimientos funcionales
- [X] Crear módulo de exportación PDF local
- [ ] Implementar plantillas editables con Markdown
- [ ] Realizar pruebas de rendimiento e integración
- [ ] Configurar servidor Nginx y despliegue Docker

## TAREAS SECUNDARIAS
- [X] Revisar diseño visual y contraste de colores
- [ ] Optimizar almacenamiento en localStorage
- [ ] Redactar documentación y guía de usuario

NOTAS: Priorizar el desarrollo local sin dependencias externas en la nube.`;
        } else if (type === 'resume-cv') {
            return `# CURRICULUM VITAE
NOMBRE: MARLON FALCON HERNANDEZ
TITULO_PROFESIONAL: Desarrollador Senior / Consultor de Software
EMAIL: contacto@marlonfalcon.com
TELEFONO: +34 600 000 000
UBICACION: Madrid, España
SITIO_WEB: www.marlonfalcon.com

## PERFIL PROFESIONAL
Ingeniero y desarrollador de software apasionado por la creación de soluciones digitales eficientes, escalables y 100% locales. Más de 10 años de experiencia liderando proyectos web.

## EXPERIENCIA LABORAL
- 2022 - Presente | Lead Software Engineer @ Tech Solutions | Desarrollo de aplicaciones web, arquitectura de sistemas y optimización de rendimiento.
- 2018 - 2022 | Senior Fullstack Developer @ Global Systems | Implementación de APIs REST, bases de datos SQL/NoSQL y frontends interactivos.

## EDUCACION & CERTIFICACIONES
- Graduado en Ingeniería Informática | Universidad Politécnica (2014 - 2018)
- Certificación Profesional en Arquitectura Cloud & DevOps (2020)

## HABILIDADES
- Lenguajes: Python, JavaScript, TypeScript, HTML5, CSS3, SQL
- Herramientas: Flask, Node.js, Docker, Git, Linux, Nginx
- Idiomas: Español (Nativo), Inglés (Avanzado C1)`;
        } else {
            return this.getDefaultMarkdownSample();
        }
    }

    async createInvoiceTemplate(mdText) {
        showToast('Generando plantilla de Factura...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 595.28;
            const H = 841.89;

            const emisor = this.getMdVal(mdText, 'EMISOR', 'Empresa Ejemplo S.L.\nNIF: B-12345678\nCalle Mayor, 100, Madrid');
            const cliente = this.getMdVal(mdText, 'CLIENTE', 'Cliente Ejemplo S.A.\nNIF: A-87654321\nAv. Diagonal 45, Barcelona');
            const numero = this.getMdVal(mdText, 'NUMERO|N. FACTURA|FACTURA', 'FAC-2026-001');
            const fecha = this.getMdVal(mdText, 'FECHA', '06 / 09 / 2026');
            const subtotal = this.getMdVal(mdText, 'SUBTOTAL', '1150.00 EUR');
            const iva = this.getMdVal(mdText, 'IVA', '241.50 EUR');
            const total = this.getMdVal(mdText, 'TOTAL', '1391.50 EUR');
            const pago = this.getMdVal(mdText, 'PAGO|FORMA DE PAGO', 'Transferencia Bancaria IBAN: ES12 3456 7890 1234 5678');

            // Header bar
            page.drawRectangle({
                x: 0,
                y: H - 80,
                width: W,
                height: 80,
                color: rgb(0.06, 0.09, 0.16)
            });

            page.drawText('FACTURA', {
                x: 35,
                y: H - 52,
                size: 26,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            page.drawText(`N. FACTURA: ${numero}`, { x: W - 220, y: H - 38, size: 10, font: fontBold, color: rgb(1, 1, 1) });
            page.drawText(`FECHA: ${fecha}`, { x: W - 220, y: H - 54, size: 10, font: fontReg, color: rgb(0.8, 0.8, 0.8) });

            // Issuer Box
            page.drawText('DATOS DEL EMISOR', { x: 35, y: H - 110, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
            page.drawText(emisor, {
                x: 35,
                y: H - 128,
                size: 9,
                font: fontReg,
                color: rgb(0.3, 0.3, 0.3),
                lineHeight: 14
            });

            // Client Box
            page.drawText('DATOS DEL CLIENTE', { x: 320, y: H - 110, size: 10, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
            page.drawText(cliente, {
                x: 320,
                y: H - 128,
                size: 9,
                font: fontReg,
                color: rgb(0.3, 0.3, 0.3),
                lineHeight: 14
            });

            // Separator
            page.drawLine({
                start: { x: 35, y: H - 195 },
                end: { x: W - 35, y: H - 195 },
                thickness: 1,
                color: rgb(0.85, 0.85, 0.85)
            });

            // Table Header
            const tableY = H - 230;
            page.drawRectangle({
                x: 35,
                y: tableY - 5,
                width: W - 70,
                height: 24,
                color: rgb(0.93, 0.95, 0.98)
            });

            page.drawText('DESCRIPCION / CONCEPTO', { x: 45, y: tableY + 2, size: 9, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText('CANT.', { x: 340, y: tableY + 2, size: 9, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText('PRECIO', { x: 410, y: tableY + 2, size: 9, font: fontBold, color: rgb(0.2, 0.2, 0.2) });
            page.drawText('TOTAL', { x: 490, y: tableY + 2, size: 9, font: fontBold, color: rgb(0.2, 0.2, 0.2) });

            // Parse Table Rows from Markdown if present
            const mdItems = [];
            if (mdText) {
                const lines = mdText.split('\n');
                lines.forEach(line => {
                    if (line.includes('|') && !line.includes('---') && !line.toLowerCase().includes('concepto')) {
                        const parts = line.split('|').map(p => p.trim()).filter(p => p.length > 0);
                        if (parts.length >= 1) {
                            mdItems.push({
                                desc: parts[0] || 'Concepto',
                                cant: parts[1] || '1',
                                precio: parts[2] || '0.00',
                                total: parts[3] || '0.00'
                            });
                        }
                    }
                });
            }

            // Table Rows
            let rowY = tableY - 30;
            const maxRows = Math.max(5, mdItems.length || 2);
            for (let i = 0; i < maxRows; i++) {
                if (mdItems[i]) {
                    page.drawText(mdItems[i].desc, { x: 45, y: rowY, size: 9, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
                    page.drawText(mdItems[i].cant, { x: 345, y: rowY, size: 9, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
                    page.drawText(mdItems[i].precio, { x: 410, y: rowY, size: 9, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
                    page.drawText(mdItems[i].total, { x: 490, y: rowY, size: 9, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
                }
                page.drawLine({
                    start: { x: 35, y: rowY - 5 },
                    end: { x: W - 35, y: rowY - 5 },
                    thickness: 0.5,
                    color: rgb(0.88, 0.88, 0.88)
                });
                rowY -= 32;
            }

            // Vertical Table Lines
            page.drawLine({ start: { x: 325, y: tableY + 19 }, end: { x: 325, y: rowY + 27 }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });
            page.drawLine({ start: { x: 395, y: tableY + 19 }, end: { x: 395, y: rowY + 27 }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });
            page.drawLine({ start: { x: 475, y: tableY + 19 }, end: { x: 475, y: rowY + 27 }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });

            // Totals
            const totalsY = rowY - 20;
            page.drawText('Subtotal:', { x: 380, y: totalsY, size: 10, font: fontReg, color: rgb(0.3, 0.3, 0.3) });
            page.drawText(subtotal, { x: 470, y: totalsY, size: 10, font: fontReg, color: rgb(0.3, 0.3, 0.3) });

            page.drawText('IVA:', { x: 380, y: totalsY - 20, size: 10, font: fontReg, color: rgb(0.3, 0.3, 0.3) });
            page.drawText(iva, { x: 470, y: totalsY - 20, size: 10, font: fontReg, color: rgb(0.3, 0.3, 0.3) });

            page.drawRectangle({
                x: 360,
                y: totalsY - 55,
                width: 200,
                height: 28,
                color: rgb(0.23, 0.51, 0.96)
            });
            page.drawText('TOTAL FACTURA:', { x: 370, y: totalsY - 47, size: 10, font: fontBold, color: rgb(1, 1, 1) });
            page.drawText(total, { x: 470, y: totalsY - 47, size: 10, font: fontBold, color: rgb(1, 1, 1) });

            // Payment Notes
            page.drawText(`FORMA DE PAGO: ${pago}`, {
                x: 35,
                y: totalsY - 30,
                size: 8,
                font: fontReg,
                color: rgb(0.4, 0.4, 0.4),
                lineHeight: 12
            });

            page.drawLine({ start: { x: 35, y: 100 }, end: { x: 200, y: 100 }, thickness: 1, color: rgb(0.7, 0.7, 0.7) });
            page.drawText('Firma / Sello del Emisor', { x: 55, y: 85, size: 8, font: fontReg, color: rgb(0.5, 0.5, 0.5) });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'factura.pdf');
            showToast('Plantilla de Factura actualizada desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar plantilla de factura:', err);
            showToast('Error al generar plantilla de factura.', 'danger');
        }
    }

    async createDiplomaTemplate(mdText) {
        showToast('Generando plantilla de Diploma...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([841.89, 595.28]); // A4 Landscape
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 841.89;
            const H = 595.28;

            const titulo = this.getMdVal(mdText, 'TITULO|DIPLOMA', 'DIPLOMA DE ACREDITACION');
            const alumno = this.getMdVal(mdText, 'OTORGADO_A|OTORGADO A|ALUMNO|NOMBRE', 'NOMBRE Y APELLIDOS DEL ALUMNO');
            const curso = this.getMdVal(mdText, 'POR_COMPLETAR|POR COMPLETAR|CURSO', 'CURSO DE ESPECIALIZACION PROFESIONAL');
            const fecha = this.getMdVal(mdText, 'FECHA', 'Expedido a 06 de Septiembre de 2026');
            const instructor = this.getMdVal(mdText, 'INSTRUCTOR', 'Firma del Instructor');
            const director = this.getMdVal(mdText, 'DIRECTOR', 'Firma del Director / Centro');

            // Outer decorative border
            page.drawRectangle({
                x: 20,
                y: 20,
                width: W - 40,
                height: H - 40,
                borderWidth: 3,
                borderColor: rgb(0.85, 0.65, 0.13), // Gold
                color: rgb(0.99, 0.99, 0.97)
            });

            // Inner border
            page.drawRectangle({
                x: 28,
                y: 28,
                width: W - 56,
                height: H - 56,
                borderWidth: 1,
                borderColor: rgb(0.2, 0.25, 0.35)
            });

            // Title
            page.drawText(titulo, {
                x: W / 2 - Math.min(220, titulo.length * 7),
                y: H - 90,
                size: 24,
                font: fontBold,
                color: rgb(0.12, 0.18, 0.28)
            });

            page.drawText('OTORGADO A:', {
                x: W / 2 - 50,
                y: H - 150,
                size: 12,
                font: fontReg,
                color: rgb(0.5, 0.5, 0.5)
            });

            // Recipient Name
            page.drawText(alumno, {
                x: W / 2 - Math.min(240, alumno.length * 6),
                y: H - 200,
                size: 20,
                font: fontBold,
                color: rgb(0.85, 0.65, 0.13)
            });

            page.drawLine({
                start: { x: 150, y: H - 210 },
                end: { x: W - 150, y: H - 210 },
                thickness: 1,
                color: rgb(0.85, 0.65, 0.13)
            });

            // Subtitle
            page.drawText('Por haber completado con exito la formacion especializada en:', {
                x: W / 2 - 200,
                y: H - 250,
                size: 13,
                font: fontReg,
                color: rgb(0.3, 0.3, 0.3)
            });

            // Course Name
            page.drawText(curso, {
                x: W / 2 - Math.min(260, curso.length * 5),
                y: H - 300,
                size: 17,
                font: fontBold,
                color: rgb(0.12, 0.18, 0.28)
            });

            page.drawText('Con aprovechamiento satisfactorio y cumplimiento de requisitos academicos.', {
                x: W / 2 - 220,
                y: H - 340,
                size: 10,
                font: fontReg,
                color: rgb(0.4, 0.4, 0.4)
            });

            page.drawText(fecha, {
                x: W / 2 - Math.min(140, fecha.length * 3.5),
                y: H - 380,
                size: 10,
                font: fontReg,
                color: rgb(0.4, 0.4, 0.4)
            });

            // Signatures at bottom
            page.drawLine({ start: { x: 180, y: 90 }, end: { x: 340, y: 90 }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
            page.drawText(instructor, { x: 190, y: 75, size: 9, font: fontReg, color: rgb(0.4, 0.4, 0.4) });

            page.drawLine({ start: { x: W - 340, y: 90 }, end: { x: W - 180, y: 90 }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
            page.drawText(director, { x: W - 330, y: 75, size: 9, font: fontReg, color: rgb(0.4, 0.4, 0.4) });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'diploma.pdf');
            showToast('Plantilla de Diploma actualizada desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar plantilla de diploma:', err);
            showToast('Error al generar plantilla de diploma.', 'danger');
        }
    }

    async createSaleSignTemplate(mdText) {
        showToast('Generando cartel SE VENDE...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 595.28;
            const H = 841.89;

            const titulo = this.getMdVal(mdText, 'TITULO|ARTICULO', 'ARTICULO / PROPIEDAD / VEHICULO');
            const desc = this.getMdVal(mdText, 'DESCRIPCION|DETALLES', 'Añade aquí el título o descripción principal del objeto en venta.');
            const precio = this.getMdVal(mdText, 'PRECIO', '250.000 EUR');
            const tel = this.getMdVal(mdText, 'TELEFONO|TEL', '600 000 000');

            // Top Banner Red
            page.drawRectangle({
                x: 20,
                y: H - 180,
                width: W - 40,
                height: 160,
                color: rgb(0.86, 0.15, 0.15)
            });

            page.drawText('SE VENDE', {
                x: W / 2 - 160,
                y: H - 125,
                size: 56,
                font: fontBold,
                color: rgb(1, 1, 1)
            });

            // Main Item Box
            page.drawRectangle({
                x: 20,
                y: H - 320,
                width: W - 40,
                height: 120,
                borderWidth: 2,
                borderColor: rgb(0.2, 0.2, 0.2),
                color: rgb(0.97, 0.97, 0.97)
            });

            page.drawText(titulo, {
                x: 40,
                y: H - 230,
                size: 18,
                font: fontBold,
                color: rgb(0.1, 0.1, 0.1)
            });

            page.drawText(desc, {
                x: 40,
                y: H - 260,
                size: 12,
                font: fontReg,
                color: rgb(0.3, 0.3, 0.3)
            });

            // Characteristics box
            page.drawRectangle({
                x: 20,
                y: H - 540,
                width: W - 40,
                height: 200,
                borderWidth: 2,
                borderColor: rgb(0.8, 0.8, 0.8)
            });

            page.drawText('CARACTERISTICAS Y DETALLES:', {
                x: 40,
                y: H - 365,
                size: 14,
                font: fontBold,
                color: rgb(0.2, 0.2, 0.2)
            });

            let features = [
                '* Estado excelente / Seminuevo',
                '* Año / Modelo: 2026',
                '* Incluye todos los accesorios y documentación',
                '* Precio negociable / Oportunidad única'
            ];
            if (mdText) {
                const lines = mdText.split('\n').map(l => l.trim()).filter(l => l.startsWith('- ') || l.startsWith('* '));
                if (lines.length > 0) {
                    features = lines.map(l => l.replace(/^[-*]\s+/, '* '));
                }
            }

            let fy = H - 400;
            features.forEach(ft => {
                page.drawText(ft, { x: 50, y: fy, size: 12, font: fontReg, color: rgb(0.25, 0.25, 0.25) });
                fy -= 25;
            });

            // Price Banner
            page.drawRectangle({
                x: 20,
                y: H - 650,
                width: W - 40,
                height: 90,
                color: rgb(0.06, 0.09, 0.16)
            });

            page.drawText('PRECIO:', {
                x: 40,
                y: H - 605,
                size: 20,
                font: fontBold,
                color: rgb(1, 1, 1)
            });

            page.drawText(precio, {
                x: W - 260,
                y: H - 610,
                size: 32,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            // Contact Phone Box
            page.drawRectangle({
                x: 20,
                y: 30,
                width: W - 40,
                height: 140,
                borderWidth: 3,
                borderColor: rgb(0.86, 0.15, 0.15),
                color: rgb(1, 0.96, 0.96)
            });

            page.drawText('INFORMACION Y CONTACTO:', {
                x: W / 2 - 120,
                y: 135,
                size: 12,
                font: fontBold,
                color: rgb(0.86, 0.15, 0.15)
            });

            page.drawText(`TEL: ${tel}`, {
                x: W / 2 - Math.min(180, tel.length * 10),
                y: 75,
                size: 34,
                font: fontBold,
                color: rgb(0.1, 0.1, 0.1)
            });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'cartel_se_vende.pdf');
            showToast('Cartel SE VENDE actualizado desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar cartel se vende:', err);
            showToast('Error al generar el cartel SE VENDE.', 'danger');
        }
    }

    async createBusinessCardsTemplate(mdText) {
        showToast('Generando plantilla de Tarjetas de Presentación (8 por página)...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const cardW = 241;
            const cardH = 156;
            const marginX = 40;
            const marginY = 50;
            const gapX = 33;
            const gapY = 32;

            const nombre = this.getMdVal(mdText, 'NOMBRE', 'MARLON FALCON');
            const cargo = this.getMdVal(mdText, 'CARGO|PUESTO', 'Consultor & Desarrollador Software');
            const empresa = this.getMdVal(mdText, 'EMPRESA', 'Falcón Solutions');
            const tel = this.getMdVal(mdText, 'TELEFONO|TEL', 'Tel: +34 600 000 000');
            const email = this.getMdVal(mdText, 'EMAIL', 'Email: contacto@marlonfalcon.com');
            const web = this.getMdVal(mdText, 'WEB|SITIO WEB', 'Web: www.marlonfalcon.com');
            const dir = this.getMdVal(mdText, 'DIRECCION', 'Dirección: Calle Ejemplo 123, Madrid');

            // 2 columns, 4 rows = 8 cards total per A4 page
            for (let row = 0; row < 4; row++) {
                for (let col = 0; col < 2; col++) {
                    const x = marginX + col * (cardW + gapX);
                    const y = 841.89 - marginY - (row + 1) * cardH - row * gapY;

                    // Card Outer Border
                    page.drawRectangle({
                        x: x,
                        y: y,
                        width: cardW,
                        height: cardH,
                        borderWidth: 1,
                        borderColor: rgb(0.8, 0.82, 0.88),
                        color: rgb(0.98, 0.99, 1)
                    });

                    // Left Accent Color Bar
                    page.drawRectangle({
                        x: x,
                        y: y,
                        width: 8,
                        height: cardH,
                        color: rgb(0.23, 0.51, 0.96)
                    });

                    // Header / Name
                    page.drawText(nombre, {
                        x: x + 22,
                        y: y + cardH - 32,
                        size: 12,
                        font: fontBold,
                        color: rgb(0.09, 0.14, 0.24)
                    });

                    // Job Title
                    page.drawText(cargo, {
                        x: x + 22,
                        y: y + cardH - 46,
                        size: 8,
                        font: fontBold,
                        color: rgb(0.23, 0.51, 0.96)
                    });

                    // Thin separator line
                    page.drawLine({
                        start: { x: x + 22, y: y + cardH - 55 },
                        end: { x: x + cardW - 15, y: y + cardH - 55 },
                        thickness: 0.5,
                        color: rgb(0.88, 0.88, 0.88)
                    });

                    // Details / Contact
                    page.drawText(tel, {
                        x: x + 22,
                        y: y + cardH - 74,
                        size: 8,
                        font: fontReg,
                        color: rgb(0.3, 0.35, 0.45)
                    });

                    page.drawText(email, {
                        x: x + 22,
                        y: y + cardH - 88,
                        size: 8,
                        font: fontReg,
                        color: rgb(0.3, 0.35, 0.45)
                    });

                    page.drawText(web, {
                        x: x + 22,
                        y: y + cardH - 102,
                        size: 8,
                        font: fontBold,
                        color: rgb(0.15, 0.2, 0.3)
                    });

                    page.drawText(dir, {
                        x: x + 22,
                        y: y + cardH - 116,
                        size: 7.5,
                        font: fontReg,
                        color: rgb(0.5, 0.55, 0.65)
                    });

                    // Small Cut Crop Marks on Corners
                    const cm = 6;
                    page.drawLine({ start: { x: x - cm, y: y }, end: { x: x, y: y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
                    page.drawLine({ start: { x: x, y: y - cm }, end: { x: x, y: y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });

                    page.drawLine({ start: { x: x + cardW, y: y - cm }, end: { x: x + cardW, y: y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
                    page.drawLine({ start: { x: x + cardW, y: y }, end: { x: x + cardW + cm, y: y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
                }
            }

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'tarjetas_presentacion.pdf');
            showToast('Plantilla de Tarjetas de Presentación (8 por página) actualizada desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar tarjetas de presentación:', err);
            showToast('Error al generar la plantilla de tarjetas de presentación.', 'danger');
        }
    }

    async createBookLabelsTemplate(mdText) {
        showToast('Generando plantilla de Etiquetas para Libros...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const labelW = 240;
            const labelH = 210;
            const marginX = 35;
            const marginY = 45;
            const gapX = 45;
            const gapY = 30;

            const colors = [
                rgb(0.23, 0.51, 0.96), // Azul
                rgb(0.86, 0.15, 0.15), // Rojo
                rgb(0.05, 0.65, 0.41), // Verde
                rgb(0.96, 0.62, 0.04), // Amarillo
                rgb(0.55, 0.27, 0.85), // Purpura
                rgb(0.88, 0.35, 0.62)  // Rosa
            ];

            const alumno = this.getMdVal(mdText, 'NOMBRE|ALUMNO|ALUMNO/A', 'Nombre del Alumno/a');
            const asignatura = this.getMdVal(mdText, 'ASIGNATURA', 'Asignatura / Materia');
            const curso = this.getMdVal(mdText, 'CURSO|CURSO / GRUPO', 'Curso / Grupo');
            const colegio = this.getMdVal(mdText, 'COLEGIO|CENTRO|COLEGIO / CENTRO', 'Colegio / Centro');

            for (let row = 0; row < 3; row++) {
                for (let col = 0; col < 2; col++) {
                    const idx = row * 2 + col;
                    const x = marginX + col * (labelW + gapX);
                    const y = 841.89 - marginY - (row + 1) * labelH - row * gapY;
                    const accentColor = colors[idx % colors.length];

                    // Outer Card Border
                    page.drawRectangle({
                        x: x,
                        y: y,
                        width: labelW,
                        height: labelH,
                        borderWidth: 2,
                        borderColor: accentColor,
                        color: rgb(0.99, 0.99, 1)
                    });

                    // Top Banner Header
                    page.drawRectangle({
                        x: x,
                        y: y + labelH - 35,
                        width: labelW,
                        height: 35,
                        color: accentColor
                    });

                    page.drawText('ETIQUETA ESCOLAR / LIBRO', {
                        x: x + 18,
                        y: y + labelH - 22,
                        size: 11,
                        font: fontBold,
                        color: rgb(1, 1, 1)
                    });

                    // Form Lines with values
                    const fields = [
                        { label: 'ALUMNO/A:', val: alumno },
                        { label: 'ASIGNATURA:', val: asignatura },
                        { label: 'CURSO / GRUPO:', val: curso },
                        { label: 'COLEGIO / CENTRO:', val: colegio }
                    ];
                    let fy = y + labelH - 65;

                    fields.forEach(f => {
                        page.drawText(f.label, {
                            x: x + 15,
                            y: fy,
                            size: 8.5,
                            font: fontBold,
                            color: rgb(0.2, 0.25, 0.35)
                        });

                        page.drawText(f.val, {
                            x: x + 15,
                            y: fy - 14,
                            size: 9.5,
                            font: fontBold,
                            color: rgb(0.1, 0.15, 0.25)
                        });

                        page.drawLine({
                            start: { x: x + 15, y: fy - 18 },
                            end: { x: x + labelW - 15, y: fy - 18 },
                            thickness: 0.8,
                            color: rgb(0.8, 0.82, 0.88)
                        });

                        fy -= 38;
                    });
                }
            }

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'etiquetas_libros.pdf');
            showToast('Plantilla de Etiquetas para Libros (6 por página) actualizada desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar etiquetas para libros:', err);
            showToast('Error al generar plantilla de etiquetas para libros.', 'danger');
        }
    }

    async createQrPosterTemplate(mdText) {
        showToast('Generando Cartel con Texto y Código QR...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 595.28;
            const H = 841.89;

            const titulo = this.getMdVal(mdText, 'TITULO|HEADER', 'ESCANEA EL CODIGO QR');
            const subtitulo = this.getMdVal(mdText, 'SUBTITULO', 'Accede de forma rápida desde tu teléfono móvil');
            const urlQr = this.getMdVal(mdText, 'URL_QR|URL|SITIO WEB', 'https://www.marlonfalcon.com');
            const info = this.getMdVal(mdText, 'INFORMACION|DESCRIPCION', 'Abre la cámara de tu móvil y apunta hacia el código QR para acceder directamente.');
            const ubicacion = this.getMdVal(mdText, 'UBICACION|HORARIO', 'Ubicación: Calle Principal 100 | Horario: 09:00 - 20:00 h');

            // Top Header Dark
            page.drawRectangle({
                x: 0,
                y: H - 140,
                width: W,
                height: 140,
                color: rgb(0.06, 0.09, 0.16)
            });

            page.drawText(titulo, {
                x: W / 2 - Math.min(220, titulo.length * 6),
                y: H - 85,
                size: 24,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            page.drawText(subtitulo, {
                x: W / 2 - Math.min(200, subtitulo.length * 3.5),
                y: H - 115,
                size: 11,
                font: fontReg,
                color: rgb(0.8, 0.8, 0.8)
            });

            // Simulated High Resolution Vector QR Code
            const qrX = W / 2 - 120;
            const qrY = H - 430;
            const qrSize = 240;

            // White Background Box
            page.drawRectangle({
                x: qrX - 15,
                y: qrY - 15,
                width: qrSize + 30,
                height: qrSize + 30,
                borderWidth: 2,
                borderColor: rgb(0.8, 0.8, 0.8),
                color: rgb(1, 1, 1)
            });

            // QR Outer Squares (Corners)
            const drawQrFinderPattern = (fx, fy) => {
                page.drawRectangle({ x: fx, y: fy, width: 50, height: 50, color: rgb(0, 0, 0) });
                page.drawRectangle({ x: fx + 7, y: fy + 7, width: 36, height: 36, color: rgb(1, 1, 1) });
                page.drawRectangle({ x: fx + 14, y: fy + 14, width: 22, height: 22, color: rgb(0, 0, 0) });
            };

            drawQrFinderPattern(qrX + 10, qrY + qrSize - 60);
            drawQrFinderPattern(qrX + qrSize - 60, qrY + qrSize - 60);
            drawQrFinderPattern(qrX + 10, qrY + 10);

            // Grid pattern
            const gridCells = 16;
            const cellSize = qrSize / gridCells;
            for (let r = 0; r < gridCells; r++) {
                for (let c = 0; c < gridCells; c++) {
                    if ((r < 4 && c < 4) || (r < 4 && c > 11) || (r > 11 && c < 4)) continue;
                    if ((r + c * 3 + (r * c)) % 3 === 0 || (r * 2 + c) % 5 === 0) {
                        page.drawRectangle({
                            x: qrX + c * cellSize,
                            y: qrY + r * cellSize,
                            width: cellSize,
                            height: cellSize,
                            color: rgb(0, 0, 0)
                        });
                    }
                }
            }

            // Descriptive Message Box
            page.drawRectangle({
                x: 40,
                y: 80,
                width: W - 80,
                height: 280,
                borderWidth: 2,
                borderColor: rgb(0.23, 0.51, 0.96),
                color: rgb(0.97, 0.98, 1)
            });

            page.drawText('INFORMACION DEL ANUNCIO O EVENTO', {
                x: 60,
                y: 325,
                size: 15,
                font: fontBold,
                color: rgb(0.1, 0.15, 0.25)
            });

            page.drawText(info, {
                x: 60,
                y: 280,
                size: 10.5,
                font: fontReg,
                color: rgb(0.3, 0.35, 0.45),
                lineHeight: 16
            });

            page.drawText('SITIO WEB / ENLACE:', { x: 60, y: 220, size: 12, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
            page.drawText(urlQr, { x: 60, y: 195, size: 15, font: fontBold, color: rgb(0.1, 0.1, 0.1) });

            page.drawText(ubicacion, {
                x: 60,
                y: 130,
                size: 10,
                font: fontReg,
                color: rgb(0.4, 0.4, 0.4)
            });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'cartel_qr.pdf');
            showToast('Cartel con QR actualizado desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar cartel con QR:', err);
            showToast('Error al generar el cartel con QR.', 'danger');
        }
    }

    async createMobileWireframeTemplate(mdText) {
        showToast('Generando Prototipo de App Móvil...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([841.89, 595.28]); // A4 Landscape
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 841.89;
            const H = 595.28;

            const tituloApp = this.getMdVal(mdText, 'TITULO_APP|TITULO', 'PROTOTIPO Y WIREFRAME DE APP MOVIL');
            const p1 = this.getMdVal(mdText, 'PANTALLA_1', '1. Pantalla Login / Home');
            const p2 = this.getMdVal(mdText, 'PANTALLA_2', '2. Pantalla Principal');
            const p3 = this.getMdVal(mdText, 'PANTALLA_3', '3. Detalle / Perfil');

            // Title
            page.drawText(tituloApp, {
                x: 40,
                y: H - 45,
                size: 18,
                font: fontBold,
                color: rgb(0.1, 0.15, 0.25)
            });

            page.drawText('Diseño de pantallas y flujo de navegación para iOS / Android', {
                x: 40,
                y: H - 65,
                size: 10,
                font: fontReg,
                color: rgb(0.5, 0.55, 0.65)
            });

            // 3 Smartphone Frames
            const phoneW = 210;
            const phoneH = 430;
            const gap = 45;
            const startX = 40;
            const startY = 50;

            const screenTitles = [p1, p2, p3];

            for (let i = 0; i < 3; i++) {
                const px = startX + i * (phoneW + gap);
                const py = startY;

                // Outer Phone Shell
                page.drawRectangle({
                    x: px,
                    y: py,
                    width: phoneW,
                    height: phoneH,
                    borderWidth: 3,
                    borderColor: rgb(0.2, 0.25, 0.35),
                    color: rgb(0.98, 0.99, 1)
                });

                // Top Notch / Speaker
                page.drawRectangle({
                    x: px + phoneW / 2 - 30,
                    y: py + phoneH - 18,
                    width: 60,
                    height: 8,
                    color: rgb(0.2, 0.25, 0.35)
                });

                // Screen Header Bar
                page.drawRectangle({
                    x: px + 4,
                    y: py + phoneH - 55,
                    width: phoneW - 8,
                    height: 30,
                    color: rgb(0.23, 0.51, 0.96)
                });

                page.drawText('App Title', {
                    x: px + 15,
                    y: py + phoneH - 43,
                    size: 9,
                    font: fontBold,
                    color: rgb(1, 1, 1)
                });

                // Bottom Home Bar Line
                page.drawRectangle({
                    x: px + phoneW / 2 - 35,
                    y: py + 10,
                    width: 70,
                    height: 4,
                    color: rgb(0.3, 0.3, 0.3)
                });

                // Screen Title above Phone
                page.drawText(screenTitles[i], {
                    x: px,
                    y: py + phoneH + 12,
                    size: 10.5,
                    font: fontBold,
                    color: rgb(0.23, 0.51, 0.96)
                });
            }

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'prototipo_mobile.pdf');
            showToast('Prototipo de App Móvil actualizado desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar prototipo mobile:', err);
            showToast('Error al generar prototipo mobile.', 'danger');
        }
    }

    async createDesktopWireframeTemplate(mdText) {
        showToast('Generando Prototipo de App Desktop / Web...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([841.89, 595.28]); // A4 Landscape
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 841.89;
            const H = 595.28;

            const urlWin = this.getMdVal(mdText, 'TITULO_VENTANA|URL', 'https://mi-aplicacion-desktop.com/dashboard');
            const nomApp = this.getMdVal(mdText, 'NOMBRE_APP|APP', 'MI APP DESKTOP');
            const menusStr = this.getMdVal(mdText, 'MENUS', 'Dashboard, Proyectos, Analítica, Usuarios, Ajustes');
            const panel = this.getMdVal(mdText, 'PANEL|TITULO_PANEL', 'PANEL PRINCIPAL DE TRABAJO');

            // Desktop Window Frame
            const winX = 35;
            const winY = 35;
            const winW = W - 70;
            const winH = H - 70;

            page.drawRectangle({
                x: winX,
                y: winY,
                width: winW,
                height: winH,
                borderWidth: 2,
                borderColor: rgb(0.2, 0.25, 0.35),
                color: rgb(0.98, 0.99, 1)
            });

            // Window Title Bar
            page.drawRectangle({
                x: winX,
                y: winY + winH - 35,
                width: winW,
                height: 35,
                color: rgb(0.12, 0.18, 0.28)
            });

            // Red, Yellow, Green Window Buttons
            page.drawCircle({ x: winX + 18, y: winY + winH - 17, size: 5, color: rgb(0.93, 0.35, 0.35) });
            page.drawCircle({ x: winX + 34, y: winY + winH - 17, size: 5, color: rgb(0.93, 0.73, 0.35) });
            page.drawCircle({ x: winX + 50, y: winY + winH - 17, size: 5, color: rgb(0.35, 0.78, 0.45) });

            // URL Bar
            page.drawRectangle({
                x: winX + 75,
                y: winY + winH - 26,
                width: 380,
                height: 18,
                color: rgb(0.2, 0.25, 0.38)
            });

            page.drawText(urlWin, {
                x: winX + 85,
                y: winY + winH - 21,
                size: 8,
                font: fontReg,
                color: rgb(0.8, 0.85, 0.95)
            });

            // Sidebar Left
            const sidebarW = 160;
            const bodyH = winH - 35;

            page.drawRectangle({
                x: winX,
                y: winY,
                width: sidebarW,
                height: bodyH,
                color: rgb(0.08, 0.12, 0.2)
            });

            page.drawText(nomApp, {
                x: winX + 15,
                y: winY + bodyH - 30,
                size: 10.5,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            const navItems = menusStr.split(',').map(m => m.trim());
            let ny = winY + bodyH - 70;
            navItems.forEach(item => {
                page.drawText(`- ${item}`, {
                    x: winX + 15,
                    y: ny,
                    size: 9.5,
                    font: fontReg,
                    color: rgb(0.8, 0.85, 0.95)
                });
                ny -= 28;
            });

            // Main Content Area Wireframe
            const contentX = winX + sidebarW + 20;
            const contentY = winY + 20;
            const contentW = winW - sidebarW - 40;
            const contentH = bodyH - 40;

            page.drawText(panel, {
                x: contentX,
                y: contentY + contentH - 25,
                size: 15,
                font: fontBold,
                color: rgb(0.1, 0.15, 0.25)
            });

            // 3 Mock Cards/Widgets
            const cardW = (contentW - 30) / 3;
            for (let c = 0; c < 3; c++) {
                const cx = contentX + c * (cardW + 15);
                page.drawRectangle({
                    x: cx,
                    y: contentY + contentH - 120,
                    width: cardW,
                    height: 80,
                    borderWidth: 1,
                    borderColor: rgb(0.8, 0.82, 0.88),
                    color: rgb(1, 1, 1)
                });

                page.drawText(`Métrica ${c + 1}`, { x: cx + 12, y: contentY + contentH - 60, size: 9, font: fontReg, color: rgb(0.5, 0.5, 0.5) });
                page.drawText('0.000', { x: cx + 12, y: contentY + contentH - 90, size: 18, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
            }

            // Big Wireframe Placeholder Box
            page.drawRectangle({
                x: contentX,
                y: contentY,
                width: contentW,
                height: contentH - 140,
                borderWidth: 1,
                borderColor: rgb(0.8, 0.82, 0.88),
                color: rgb(1, 1, 1)
            });

            page.drawText('ZONA DE GRAFICOS / CONTENIDO PRINCIPAL', {
                x: contentX + contentW / 2 - 120,
                y: contentY + (contentH - 140) / 2,
                size: 10,
                font: fontBold,
                color: rgb(0.6, 0.65, 0.75)
            });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'prototipo_desktop.pdf');
            showToast('Prototipo App Desktop actualizado desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar prototipo desktop:', err);
            showToast('Error al generar prototipo desktop.', 'danger');
        }
    }

    async createJobOfferTemplate(mdText) {
        showToast('Generando plantilla de Oferta de Empleo...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 595.28;
            const H = 841.89;

            const puesto = this.getMdVal(mdText, 'PUESTO|VACANTE', 'DESARROLLADOR / CONSULTOR SOFTWARE SENIOR');
            const empresa = this.getMdVal(mdText, 'EMPRESA', 'Falcon Tech Solutions');
            const ubi = this.getMdVal(mdText, 'UBICACION', 'Madrid, España / Híbrido');
            const jornada = this.getMdVal(mdText, 'JORNADA', 'Tiempo Completo (40h/semana)');
            const salario = this.getMdVal(mdText, 'SALARIO|SUELDO', '35.000 EUR - 45.000 EUR Brutos / Año');
            const contacto = this.getMdVal(mdText, 'CONTACTO|ENVIO DE CV', 'Email: rrhh@empresa.com | Web: www.marlonfalcon.com/empleo');

            // Header Dark Blue Bar
            page.drawRectangle({
                x: 0,
                y: H - 120,
                width: W,
                height: 120,
                color: rgb(0.08, 0.12, 0.22)
            });

            page.drawText('OFERTA DE EMPLEO / VACANTE LABORAL', {
                x: 35,
                y: H - 65,
                size: 22,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            page.drawText('Buscamos talento para unirse a nuestro equipo profesional', {
                x: 35,
                y: H - 95,
                size: 11,
                font: fontReg,
                color: rgb(0.8, 0.85, 0.95)
            });

            // Job Title Banner
            page.drawRectangle({
                x: 35,
                y: H - 190,
                width: W - 70,
                height: 50,
                color: rgb(0.93, 0.95, 0.99),
                borderColor: rgb(0.23, 0.51, 0.96),
                borderWidth: 1.5
            });

            page.drawText(`PUESTO: ${puesto}`, {
                x: 50,
                y: H - 170,
                size: 12,
                font: fontBold,
                color: rgb(0.09, 0.14, 0.24)
            });

            // Company & Details Box
            page.drawText('INFORMACION GENERAL:', { x: 35, y: H - 225, size: 12, font: fontBold, color: rgb(0.2, 0.25, 0.35) });
            page.drawText(`Empresa: ${empresa}\nUbicación: ${ubi}\nJornada: ${jornada}`, {
                x: 35,
                y: H - 245,
                size: 10,
                font: fontReg,
                color: rgb(0.3, 0.35, 0.45),
                lineHeight: 16
            });

            // Requirements Box
            page.drawRectangle({
                x: 35,
                y: H - 460,
                width: W - 70,
                height: 130,
                borderWidth: 1,
                borderColor: rgb(0.85, 0.88, 0.92),
                color: rgb(0.99, 0.99, 1)
            });

            page.drawText('REQUISITOS DEL PUESTO:', { x: 50, y: H - 350, size: 12, font: fontBold, color: rgb(0.1, 0.15, 0.25) });

            let reqs = [
                '* Experiencia mínima de 3-5 años en desarrollo web y herramientas digitales.',
                '* Dominio de Python, JavaScript, HTML5, CSS3 y entornos de servidor.',
                '* Capacidad de trabajo en equipo, resolución de problemas y proactividad.'
            ];

            if (mdText) {
                const lines = mdText.split('\n').map(l => l.trim()).filter(l => l.startsWith('- ') || l.startsWith('* '));
                if (lines.length > 0) {
                    reqs = lines.map(l => l.replace(/^[-*]\s+/, '* '));
                }
            }

            let ry = H - 375;
            reqs.forEach(req => {
                page.drawText(req, { x: 50, y: ry, size: 9.5, font: fontReg, color: rgb(0.3, 0.3, 0.3) });
                ry -= 22;
            });

            // Salary & Benefits
            page.drawRectangle({
                x: 35,
                y: H - 580,
                width: W - 70,
                height: 100,
                color: rgb(0.05, 0.65, 0.41)
            });

            page.drawText('CONDICIONES Y BENEFICIOS:', { x: 50, y: H - 505, size: 12, font: fontBold, color: rgb(1, 1, 1) });
            page.drawText(`Rango Salarial: ${salario}\nBeneficios: Teletrabajo parcial, seguro médico privado, horario flexible.`, {
                x: 50,
                y: H - 530,
                size: 10,
                font: fontReg,
                color: rgb(0.95, 1, 0.98),
                lineHeight: 16
            });

            // Contact / Application Instructions
            page.drawRectangle({
                x: 35,
                y: 45,
                width: W - 70,
                height: 120,
                borderWidth: 2,
                borderColor: rgb(0.23, 0.51, 0.96),
                color: rgb(0.97, 0.98, 1)
            });

            page.drawText('COMO POSTULARSE / ENVIO DE CV:', { x: 50, y: 140, size: 12, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
            page.drawText(`Enviános tu Curriculum Vitae actualizado:\n${contacto}`, {
                x: 50,
                y: 115,
                size: 10,
                font: fontReg,
                color: rgb(0.2, 0.25, 0.35),
                lineHeight: 16
            });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'oferta_empleo.pdf');
            showToast('Plantilla de Oferta de Empleo actualizada desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar oferta de empleo:', err);
            showToast('Error al generar plantilla de oferta de empleo.', 'danger');
        }
    }

    async createMoneyReceiptTemplate(mdText) {
        showToast('Generando Comprobante de Recepción de Dinero...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 595.28;
            const H = 841.89;

            const numero = this.getMdVal(mdText, 'NUMERO|RECIBO', 'REC-2026-001');
            const fecha = this.getMdVal(mdText, 'FECHA', new Date().toLocaleDateString('es-ES'));
            const pagador = this.getMdVal(mdText, 'PAGADOR|DE', 'Nombre / Razón Social del cliente que entrega dinero');
            const cobrador = this.getMdVal(mdText, 'COBRADOR|RECIBE', 'Marlon Falcón Hernández / Empresa que recibe');
            const importe = this.getMdVal(mdText, 'IMPORTE', '500.00 EUR');
            const concepto = this.getMdVal(mdText, 'CONCEPTO', 'Pago por concepto de servicios prestados / anticipo');
            const formaPago = this.getMdVal(mdText, 'FORMA_PAGO|FORMA DE PAGO', '[X] Efectivo     [ ] Transferencia Bancaria     [ ] Tarjeta');

            const startY = H - 40;

            // Header Bar
            page.drawRectangle({
                x: 35,
                y: startY - 60,
                width: W - 70,
                height: 60,
                color: rgb(0.08, 0.12, 0.22)
            });

            page.drawText('COMPROBANTE DE RECEPCION', {
                x: 50,
                y: startY - 36,
                size: 15,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            page.drawText(`RECIBO N: ${numero}`, {
                x: W - 220,
                y: startY - 26,
                size: 10,
                font: fontBold,
                color: rgb(1, 1, 1)
            });

            page.drawText(`FECHA DE EMISION: ${fecha}`, {
                x: W - 220,
                y: startY - 44,
                size: 9.5,
                font: fontReg,
                color: rgb(0.8, 0.85, 0.95)
            });

            // Main Info Box
            const boxH = 340;
            const boxY = startY - 80 - boxH;
            page.drawRectangle({
                x: 35,
                y: boxY,
                width: W - 70,
                height: boxH,
                borderWidth: 1.5,
                borderColor: rgb(0.23, 0.51, 0.96),
                color: rgb(0.98, 0.99, 1)
            });

            // Row 1: De (Pagador)
            let currY = startY - 125;
            page.drawText('DE (PAGADOR):', { x: 55, y: currY, size: 11, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
            page.drawText(pagador, { x: 175, y: currY, size: 10.5, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
            page.drawLine({ start: { x: 170, y: currY - 4 }, end: { x: W - 55, y: currY - 4 }, thickness: 0.8, color: rgb(0.7, 0.75, 0.85) });

            // Row 2: Recibe (Beneficiario)
            currY -= 50;
            page.drawText('RECIBE (COBRADOR):', { x: 55, y: currY, size: 11, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
            page.drawText(cobrador, { x: 205, y: currY, size: 10.5, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
            page.drawLine({ start: { x: 200, y: currY - 4 }, end: { x: W - 55, y: currY - 4 }, thickness: 0.8, color: rgb(0.7, 0.75, 0.85) });

            // Row 3: Importe (Monto numerico con fondo blanco)
            currY -= 55;
            page.drawText('IMPORTE:', { x: 55, y: currY + 4, size: 12, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
            
            page.drawRectangle({
                x: 140,
                y: currY - 8,
                width: 180,
                height: 32,
                color: rgb(1, 1, 1),
                borderColor: rgb(0.23, 0.51, 0.96),
                borderWidth: 1.5
            });
            page.drawText(importe, { x: 155, y: currY, size: 15, font: fontBold, color: rgb(0.23, 0.51, 0.96) });

            // Row 4: Concepto
            currY -= 65;
            page.drawText('EN CONCEPTO DE:', { x: 55, y: currY, size: 11, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
            page.drawText(concepto, { x: 180, y: currY, size: 10, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
            page.drawLine({ start: { x: 175, y: currY - 4 }, end: { x: W - 55, y: currY - 4 }, thickness: 0.8, color: rgb(0.7, 0.75, 0.85) });

            // Row 5: Forma de Pago
            currY -= 55;
            page.drawText('FORMA DE PAGO:', { x: 55, y: currY, size: 11, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
            page.drawText(formaPago, {
                x: 180,
                y: currY,
                size: 10,
                font: fontReg,
                color: rgb(0.3, 0.35, 0.45)
            });

            // Signatures Section
            const sigY = boxY - 100;
            page.drawLine({ start: { x: 65, y: sigY }, end: { x: 250, y: sigY }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
            page.drawText('Firma / Nombre de Quien Entrega (De)', { x: 75, y: sigY - 18, size: 9, font: fontReg, color: rgb(0.4, 0.4, 0.4) });

            page.drawLine({ start: { x: W - 250, y: sigY }, end: { x: W - 65, y: sigY }, thickness: 1, color: rgb(0.6, 0.6, 0.6) });
            page.drawText('Firma / Nombre de Quien Recibe (Recibe)', { x: W - 240, y: sigY - 18, size: 9, font: fontReg, color: rgb(0.4, 0.4, 0.4) });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'comprobante_recibo_dinero.pdf');
            showToast('Comprobante de Dinero actualizado desde Markdown.', 'success');
        } catch (err) {
            console.error('Error al generar comprobante de dinero:', err);
            showToast('Error al generar el comprobante de dinero.', 'danger');
        }
    }

    async createWhatsAppStatusTemplate(mdText) {
        showToast('Generando Estado de WhatsApp / Story vertical...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            // Vertical Story 9:16 canvas (432 x 768 pt)
            const W = 432;
            const H = 768;
            const page = doc.addPage([W, H]);

            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);
            const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

            const estiloVal = parseInt(this.getMdVal(mdText, 'ESTILO|STYLE|TIPO', '1')) || 1;
            const estilo = Math.max(1, Math.min(10, estiloVal));

            const titulo = this.getMdVal(mdText, 'TITULO|HEADER', 'NUEVO PROYECTO 2026');
            const subtitulo = this.getMdVal(mdText, 'SUBTITULO', 'Transformación Digital & Innovación');
            const mensaje = this.getMdVal(mdText, 'MENSAJE|DESCRIPCION|TEXTO', 'Desarrollamos soluciones ágiles, modernas y 100% locales sin dependencias externas en la nube.');
            const autor = this.getMdVal(mdText, 'AUTOR|NOMBRE', 'Marlon Falcón');
            const web = this.getMdVal(mdText, 'SITIO_WEB|WEB|LINK', 'www.marlonfalcon.com');
            const contacto = this.getMdVal(mdText, 'CONTACTO|TEL|TELEFONO', '+34 600 000 000');
            const hashtag = this.getMdVal(mdText, 'HASHTAG|TAGS', '#SoftwareDev #Tech2026 #PDFTools');

            const wrapText = (text, maxChars = 38) => {
                if (!text || text.length <= maxChars) return [text];
                const words = text.split(' ');
                const lines = [];
                let currentLine = '';
                for (const word of words) {
                    if ((currentLine + ' ' + word).trim().length <= maxChars) {
                        currentLine = (currentLine + ' ' + word).trim();
                    } else {
                        if (currentLine) lines.push(currentLine);
                        currentLine = word;
                    }
                }
                if (currentLine) lines.push(currentLine);
                return lines;
            };

            // RENDER ACCORDING TO STYLE (1 to 10)
            if (estilo === 1) {
                // Style 1: Neon Cyberpunk (Dark background, glowing cyan & purple borders)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.04, 0.06, 0.12) });

                // Top Badge
                page.drawRectangle({ x: 20, y: H - 50, width: W - 40, height: 26, color: rgb(0.08, 0.12, 0.22), borderColor: rgb(0.23, 0.51, 0.96), borderWidth: 1 });
                page.drawText('ESTADO - NEON CYBERPUNK (1/10)', { x: 32, y: H - 42, size: 9, font: fontBold, color: rgb(0.23, 0.51, 0.96) });

                // Title Banner
                page.drawRectangle({ x: 20, y: H - 190, width: W - 40, height: 125, color: rgb(0.08, 0.12, 0.22), borderColor: rgb(0.7, 0.2, 0.9), borderWidth: 2 });
                page.drawText(titulo, { x: 35, y: H - 110, size: 20, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
                page.drawText(subtitulo, { x: 35, y: H - 145, size: 12, font: fontReg, color: rgb(0.8, 0.85, 0.95) });

                // Main Message Box
                page.drawRectangle({ x: 20, y: 160, width: W - 40, height: 380, color: rgb(0.06, 0.08, 0.16), borderColor: rgb(0.23, 0.51, 0.96), borderWidth: 1.5 });
                let my = H - 240;
                const lines = wrapText(mensaje, 34);
                lines.forEach(l => {
                    page.drawText(l, { x: 40, y: my, size: 13, font: fontReg, color: rgb(1, 1, 1) });
                    my -= 24;
                });

                // Footer Box
                page.drawRectangle({ x: 20, y: 30, width: W - 40, height: 110, color: rgb(0.08, 0.12, 0.22), borderColor: rgb(0.7, 0.2, 0.9), borderWidth: 1 });
                page.drawText(`AUTOR: ${autor}`, { x: 35, y: 105, size: 10.5, font: fontBold, color: rgb(1, 1, 1) });
                page.drawText(`WEB: ${web}  |  TEL: ${contacto}`, { x: 35, y: 82, size: 9.5, font: fontReg, color: rgb(0.23, 0.51, 0.96) });
                page.drawText(hashtag, { x: 35, y: 55, size: 9, font: fontOblique, color: rgb(0.7, 0.2, 0.9) });

            } else if (estilo === 2) {
                // Style 2: Gradient Sunset (Warm Dark Purple to Magenta/Orange)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.18, 0.08, 0.28) });
                page.drawRectangle({ x: 0, y: H - 220, width: W, height: 220, color: rgb(0.85, 0.2, 0.5) });
                page.drawRectangle({ x: 0, y: 0, width: W, height: 90, color: rgb(0.96, 0.45, 0.2) });

                // Top Badge
                page.drawText('ESTADO - GRADIENT SUNSET (2/10)', { x: 25, y: H - 35, size: 9, font: fontBold, color: rgb(1, 1, 1) });

                // Title
                page.drawText(titulo, { x: 25, y: H - 110, size: 22, font: fontBold, color: rgb(1, 1, 1) });
                page.drawText(subtitulo, { x: 25, y: H - 150, size: 13, font: fontReg, color: rgb(0.98, 0.85, 0.9) });

                // Content Box
                page.drawRectangle({ x: 20, y: 120, width: W - 40, height: 410, color: rgb(0.1, 0.04, 0.16) });
                let my = 490;
                const lines = wrapText(mensaje, 32);
                lines.forEach(l => {
                    page.drawText(l, { x: 40, y: my, size: 14, font: fontReg, color: rgb(0.98, 0.98, 0.98) });
                    my -= 26;
                });

                // Footer
                page.drawText(autor.toUpperCase(), { x: 25, y: 55, size: 12, font: fontBold, color: rgb(1, 1, 1) });
                page.drawText(`${web}  *  ${contacto}`, { x: 25, y: 35, size: 9.5, font: fontReg, color: rgb(0.1, 0.04, 0.16) });

            } else if (estilo === 3) {
                // Style 3: Minimalist Clean (Editorial White with Double Frame & Gold Accent)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.98, 0.98, 0.98) });

                // Double Frame
                page.drawRectangle({ x: 15, y: 15, width: W - 30, height: H - 30, borderWidth: 2, borderColor: rgb(0.1, 0.1, 0.1) });
                page.drawRectangle({ x: 22, y: 22, width: W - 44, height: H - 44, borderWidth: 1, borderColor: rgb(0.85, 0.68, 0.2) });

                // Top Badge
                page.drawText('ESTADO - MINIMALIST CLEAN (3/10)', { x: 40, y: H - 50, size: 8.5, font: fontBold, color: rgb(0.85, 0.68, 0.2) });

                // Header
                page.drawText(titulo, { x: 40, y: H - 110, size: 20, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
                page.drawText(subtitulo, { x: 40, y: H - 140, size: 11.5, font: fontOblique, color: rgb(0.4, 0.4, 0.4) });

                page.drawLine({ start: { x: 40, y: H - 165 }, end: { x: W - 40, y: H - 165 }, thickness: 1, color: rgb(0.85, 0.68, 0.2) });

                // Body Message
                let my = H - 210;
                const lines = wrapText(mensaje, 34);
                lines.forEach(l => {
                    page.drawText(l, { x: 40, y: my, size: 13, font: fontReg, color: rgb(0.2, 0.2, 0.2) });
                    my -= 24;
                });

                page.drawLine({ start: { x: 40, y: 120 }, end: { x: W - 40, y: 120 }, thickness: 1, color: rgb(0.85, 0.68, 0.2) });

                // Footer
                page.drawText(autor, { x: 40, y: 90, size: 11, font: fontBold, color: rgb(0.1, 0.1, 0.1) });
                page.drawText(`${web}  |  ${contacto}`, { x: 40, y: 68, size: 9, font: fontReg, color: rgb(0.4, 0.4, 0.4) });
                page.drawText(hashtag, { x: 40, y: 48, size: 8.5, font: fontOblique, color: rgb(0.85, 0.68, 0.2) });

            } else if (estilo === 4) {
                // Style 4: Business Promo (Navy & Bright Blue Card)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.08, 0.12, 0.22) });

                // Top Banner
                page.drawRectangle({ x: 0, y: H - 160, width: W, height: 160, color: rgb(0.23, 0.51, 0.96) });

                page.drawText('ESTADO - BUSINESS PROMO (4/10)', { x: 25, y: H - 30, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
                page.drawText(titulo, { x: 25, y: H - 85, size: 21, font: fontBold, color: rgb(1, 1, 1) });
                page.drawText(subtitulo, { x: 25, y: H - 120, size: 12, font: fontReg, color: rgb(0.9, 0.95, 1) });

                // Center White Box
                page.drawRectangle({ x: 20, y: 160, width: W - 40, height: 420, color: rgb(0.98, 0.99, 1), borderWidth: 2, borderColor: rgb(0.23, 0.51, 0.96) });

                let my = 540;
                const lines = wrapText(mensaje, 32);
                lines.forEach(l => {
                    page.drawText(l, { x: 40, y: my, size: 13, font: fontReg, color: rgb(0.15, 0.2, 0.3) });
                    my -= 24;
                });

                // Call to action box at bottom
                page.drawRectangle({ x: 20, y: 30, width: W - 40, height: 110, color: rgb(0.12, 0.18, 0.32), borderColor: rgb(0.23, 0.51, 0.96), borderWidth: 1 });
                page.drawText(`CONTACTO: ${autor}`, { x: 35, y: 102, size: 11, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
                page.drawText(`Web: ${web}`, { x: 35, y: 80, size: 9.5, font: fontReg, color: rgb(0.9, 0.95, 1) });
                page.drawText(`Tel: ${contacto}`, { x: 35, y: 60, size: 9.5, font: fontReg, color: rgb(0.9, 0.95, 1) });
                page.drawText(hashtag, { x: 35, y: 42, size: 8.5, font: fontOblique, color: rgb(0.6, 0.7, 0.8) });

            } else if (estilo === 5) {
                // Style 5: Nature Eco (Emerald Forest Green & Cream)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.05, 0.2, 0.15) });

                // Top Badge
                page.drawRectangle({ x: 20, y: H - 45, width: W - 40, height: 24, color: rgb(0.1, 0.3, 0.22) });
                page.drawText('ESTADO - NATURE ECO (5/10)', { x: 32, y: H - 38, size: 8.5, font: fontBold, color: rgb(0.3, 0.85, 0.55) });

                // Main Title Box
                page.drawRectangle({ x: 20, y: H - 180, width: W - 40, height: 120, color: rgb(0.1, 0.3, 0.22), borderColor: rgb(0.3, 0.85, 0.55), borderWidth: 1.5 });
                page.drawText(titulo, { x: 35, y: H - 110, size: 20, font: fontBold, color: rgb(0.95, 0.96, 0.92) });
                page.drawText(subtitulo, { x: 35, y: H - 145, size: 12, font: fontReg, color: rgb(0.3, 0.85, 0.55) });

                // Body Message
                page.drawRectangle({ x: 20, y: 150, width: W - 40, height: 380, color: rgb(0.08, 0.25, 0.18) });
                let my = H - 230;
                const lines = wrapText(mensaje, 34);
                lines.forEach(l => {
                    page.drawText(l, { x: 40, y: my, size: 13, font: fontReg, color: rgb(0.95, 0.96, 0.92) });
                    my -= 24;
                });

                // Footer Box
                page.drawRectangle({ x: 20, y: 30, width: W - 40, height: 100, color: rgb(0.1, 0.3, 0.22) });
                page.drawText(autor, { x: 35, y: 98, size: 11, font: fontBold, color: rgb(0.3, 0.85, 0.55) });
                page.drawText(`${web}  |  ${contacto}`, { x: 35, y: 76, size: 9.5, font: fontReg, color: rgb(0.9, 0.95, 0.9) });
                page.drawText(hashtag, { x: 35, y: 52, size: 8.5, font: fontOblique, color: rgb(0.6, 0.8, 0.7) });

            } else if (estilo === 6) {
                // Style 6: Luxury Gold (Jet Black & Gold Accents)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.05, 0.05, 0.05) });

                // Gold Frame
                page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderWidth: 2, borderColor: rgb(0.85, 0.68, 0.2) });

                // Top Badge
                page.drawText('ESTADO - LUXURY GOLD (6/10)', { x: 35, y: H - 45, size: 8.5, font: fontBold, color: rgb(0.85, 0.68, 0.2) });

                // Gold Banner Title
                page.drawRectangle({ x: 30, y: H - 180, width: W - 60, height: 120, color: rgb(0.12, 0.11, 0.08), borderColor: rgb(0.85, 0.68, 0.2), borderWidth: 1 });
                page.drawText(titulo, { x: 45, y: H - 110, size: 20, font: fontBold, color: rgb(0.85, 0.68, 0.2) });
                page.drawText(subtitulo, { x: 45, y: H - 145, size: 12, font: fontReg, color: rgb(0.9, 0.9, 0.9) });

                // Body Message Box
                page.drawRectangle({ x: 30, y: 150, width: W - 60, height: 380, color: rgb(0.08, 0.08, 0.08) });
                let my = H - 230;
                const lines = wrapText(mensaje, 32);
                lines.forEach(l => {
                    page.drawText(l, { x: 45, y: my, size: 13, font: fontReg, color: rgb(0.95, 0.95, 0.95) });
                    my -= 24;
                });

                // Footer
                page.drawLine({ start: { x: 35, y: 130 }, end: { x: W - 35, y: 130 }, thickness: 1, color: rgb(0.85, 0.68, 0.2) });
                page.drawText(autor.toUpperCase(), { x: 35, y: 100, size: 11, font: fontBold, color: rgb(0.85, 0.68, 0.2) });
                page.drawText(`${web}  |  ${contacto}`, { x: 35, y: 78, size: 9, font: fontReg, color: rgb(0.8, 0.8, 0.8) });
                page.drawText(hashtag, { x: 35, y: 55, size: 8.5, font: fontOblique, color: rgb(0.6, 0.5, 0.3) });

            } else if (estilo === 7) {
                // Style 7: Pastel Aesthetic (Soft Lavender & White Card)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.92, 0.9, 0.98) });

                // Top Badge
                page.drawText('ESTADO - PASTEL AESTHETIC (7/10)', { x: 30, y: H - 40, size: 8.5, font: fontBold, color: rgb(0.55, 0.35, 0.85) });

                // Big White Floating Card
                page.drawRectangle({ x: 25, y: 40, width: W - 50, height: H - 100, color: rgb(1, 1, 1), borderWidth: 2, borderColor: rgb(0.82, 0.78, 0.92) });

                // Title Inside Card
                page.drawRectangle({ x: 40, y: H - 180, width: W - 80, height: 100, color: rgb(0.96, 0.94, 0.99) });
                page.drawText(titulo, { x: 55, y: H - 120, size: 19, font: fontBold, color: rgb(0.4, 0.2, 0.7) });
                page.drawText(subtitulo, { x: 55, y: H - 150, size: 11.5, font: fontReg, color: rgb(0.55, 0.35, 0.85) });

                // Body Message
                let my = H - 220;
                const lines = wrapText(mensaje, 30);
                lines.forEach(l => {
                    page.drawText(l, { x: 55, y: my, size: 12.5, font: fontReg, color: rgb(0.25, 0.2, 0.35) });
                    my -= 24;
                });

                // Footer inside card
                page.drawLine({ start: { x: 40, y: 130 }, end: { x: W - 40, y: 130 }, thickness: 1, color: rgb(0.9, 0.85, 0.95) });
                page.drawText(autor, { x: 55, y: 102, size: 11, font: fontBold, color: rgb(0.4, 0.2, 0.7) });
                page.drawText(`${web}  |  ${contacto}`, { x: 55, y: 82, size: 9, font: fontReg, color: rgb(0.5, 0.45, 0.6) });
                page.drawText(hashtag, { x: 55, y: 62, size: 8.5, font: fontOblique, color: rgb(0.65, 0.45, 0.85) });

            } else if (estilo === 8) {
                // Style 8: Bold High Impact (Bright Yellow & Thick Black Typography)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.98, 0.82, 0.1) });

                // Top Badge
                page.drawRectangle({ x: 0, y: H - 45, width: W, height: 45, color: rgb(0.08, 0.08, 0.08) });
                page.drawText('ESTADO - BOLD HIGH IMPACT (8/10)', { x: 20, y: H - 28, size: 9, font: fontBold, color: rgb(0.98, 0.82, 0.1) });

                // Giant Black Title Box
                page.drawRectangle({ x: 20, y: H - 210, width: W - 40, height: 140, color: rgb(0.08, 0.08, 0.08) });
                page.drawText(titulo, { x: 35, y: H - 120, size: 21, font: fontBold, color: rgb(0.98, 0.82, 0.1) });
                page.drawText(subtitulo, { x: 35, y: H - 160, size: 13, font: fontBold, color: rgb(1, 1, 1) });

                // Message Box
                page.drawRectangle({ x: 20, y: 160, width: W - 40, height: 370, color: rgb(1, 1, 1), borderWidth: 3, borderColor: rgb(0.08, 0.08, 0.08) });
                let my = 490;
                const lines = wrapText(mensaje, 30);
                lines.forEach(l => {
                    page.drawText(l, { x: 40, y: my, size: 14, font: fontBold, color: rgb(0.08, 0.08, 0.08) });
                    my -= 26;
                });

                // Footer Box
                page.drawRectangle({ x: 20, y: 30, width: W - 40, height: 110, color: rgb(0.08, 0.08, 0.08) });
                page.drawText(autor.toUpperCase(), { x: 35, y: 102, size: 12, font: fontBold, color: rgb(0.98, 0.82, 0.1) });
                page.drawText(`${web}  |  ${contacto}`, { x: 35, y: 78, size: 9.5, font: fontBold, color: rgb(1, 1, 1) });
                page.drawText(hashtag, { x: 35, y: 54, size: 9, font: fontBold, color: rgb(0.98, 0.82, 0.1) });

            } else if (estilo === 9) {
                // Style 9: Dark Quote / Inspiration (Charcoal Gray & Quotation Style)
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.12, 0.14, 0.18) });

                // Top Badge
                page.drawText('ESTADO - DARK INSPIRATION (9/10)', { x: 30, y: H - 40, size: 8.5, font: fontBold, color: rgb(0.23, 0.51, 0.96) });

                // Giant Quotation Mark
                page.drawText('“', { x: 30, y: H - 130, size: 90, font: fontBold, color: rgb(0.23, 0.51, 0.96) });

                // Title
                page.drawText(titulo, { x: 30, y: H - 170, size: 20, font: fontBold, color: rgb(1, 1, 1) });
                page.drawText(subtitulo, { x: 30, y: H - 200, size: 12, font: fontOblique, color: rgb(0.23, 0.51, 0.96) });

                // Body Quote Box
                page.drawRectangle({ x: 25, y: 140, width: W - 50, height: 370, color: rgb(0.08, 0.09, 0.12), borderColor: rgb(0.2, 0.25, 0.35), borderWidth: 1 });
                let my = 470;
                const lines = wrapText(mensaje, 32);
                lines.forEach(l => {
                    page.drawText(l, { x: 45, y: my, size: 13.5, font: fontOblique, color: rgb(0.9, 0.92, 0.96) });
                    my -= 26;
                });

                // Signature / Author Line
                page.drawText(`- ${autor}`, { x: 45, y: my - 10, size: 12, font: fontBold, color: rgb(0.23, 0.51, 0.96) });

                // Footer
                page.drawText(`${web}  |  ${contacto}`, { x: 30, y: 80, size: 9.5, font: fontReg, color: rgb(0.7, 0.75, 0.85) });
                page.drawText(hashtag, { x: 30, y: 55, size: 8.5, font: fontOblique, color: rgb(0.4, 0.5, 0.6) });

            } else {
                // Style 10: Tech IDE Developer Code Theme
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.02, 0.08, 0.16) });

                // Window Header Bar
                page.drawRectangle({ x: 15, y: H - 45, width: W - 30, height: 30, color: rgb(0.08, 0.14, 0.25) });
                page.drawCircle({ x: 30, y: H - 30, size: 4, color: rgb(0.93, 0.35, 0.35) });
                page.drawCircle({ x: 44, y: H - 30, size: 4, color: rgb(0.93, 0.73, 0.35) });
                page.drawCircle({ x: 58, y: H - 30, size: 4, color: rgb(0.35, 0.78, 0.45) });

                page.drawText('status_2026.js - ESTADO TECH (10/10)', { x: 80, y: H - 34, size: 8.5, font: fontBold, color: rgb(0.8, 0.85, 0.95) });

                // Window Content Body
                page.drawRectangle({ x: 15, y: 25, width: W - 30, height: H - 75, color: rgb(0.05, 0.1, 0.2), borderWidth: 1, borderColor: rgb(0.15, 0.25, 0.4) });

                // Code/Terminal Header
                page.drawText('// TITLE & SUBTITLE', { x: 30, y: H - 80, size: 9, font: fontOblique, color: rgb(0.4, 0.5, 0.6) });
                page.drawText(`const title = "${titulo}";`, { x: 30, y: H - 102, size: 12, font: fontBold, color: rgb(0.2, 0.8, 0.4) });
                page.drawText(`const subtitle = "${subtitulo}";`, { x: 30, y: H - 122, size: 10.5, font: fontBold, color: rgb(0.23, 0.7, 0.96) });

                page.drawLine({ start: { x: 30, y: H - 140 }, end: { x: W - 30, y: H - 140 }, thickness: 1, color: rgb(0.15, 0.25, 0.4) });

                // Code Message Body
                page.drawText('// MESSAGE CONTENT', { x: 30, y: H - 162, size: 9, font: fontOblique, color: rgb(0.4, 0.5, 0.6) });
                let my = H - 188;
                const lines = wrapText(mensaje, 32);
                lines.forEach(l => {
                    page.drawText(l, { x: 30, y: my, size: 12, font: fontReg, color: rgb(0.9, 0.95, 1) });
                    my -= 24;
                });

                // Developer Specs Box at Bottom
                page.drawRectangle({ x: 25, y: 40, width: W - 50, height: 110, color: rgb(0.02, 0.06, 0.12), borderColor: rgb(0.23, 0.7, 0.96), borderWidth: 1 });
                page.drawText(`developer: "${autor}"`, { x: 38, y: 125, size: 10, font: fontBold, color: rgb(0.2, 0.8, 0.4) });
                page.drawText(`website: "${web}"`, { x: 38, y: 105, size: 9.5, font: fontReg, color: rgb(0.23, 0.7, 0.96) });
                page.drawText(`phone: "${contacto}"`, { x: 38, y: 85, size: 9.5, font: fontReg, color: rgb(0.85, 0.85, 0.95) });
                page.drawText(`tags: "${hashtag}"`, { x: 38, y: 62, size: 8.5, font: fontOblique, color: rgb(0.6, 0.5, 0.8) });
            }

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'estado_whatsapp.pdf');
            showToast(`Estado de WhatsApp generado con éxito (Estilo ${estilo} de 10).`, 'success');
        } catch (err) {
            console.error('Error al generar estado de whatsapp:', err);
            showToast('Error al generar el estado de WhatsApp.', 'danger');
        }
    }

    async createTodoListTemplate(mdText) {
        showToast('Generando Lista de Tareas / TODO List...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);

            const W = 595.28;
            const H = 841.89;

            const titulo = this.getMdVal(mdText, 'TITULO|HEADER', 'MIS OBJETIVOS Y TAREAS PENDIENTES');
            const fecha = this.getMdVal(mdText, 'FECHA', new Date().toLocaleDateString('es-ES'));
            const categoria = this.getMdVal(mdText, 'CATEGORIA|PROYECTO', 'PROYECTO & PRODUCTIVIDAD');
            const notas = this.getMdVal(mdText, 'NOTAS|NOTA', '');

            // Top Header Bar
            page.drawRectangle({
                x: 35,
                y: H - 95,
                width: W - 70,
                height: 65,
                color: rgb(0.08, 0.12, 0.22)
            });

            page.drawText('LISTA DE TAREAS / TODO LIST', {
                x: 50,
                y: H - 52,
                size: 10,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            page.drawText(titulo, {
                x: 50,
                y: H - 75,
                size: 14,
                font: fontBold,
                color: rgb(1, 1, 1)
            });

            page.drawText(`FECHA: ${fecha}`, { x: W - 180, y: H - 52, size: 9, font: fontReg, color: rgb(0.8, 0.85, 0.95) });
            page.drawText(`CAT: ${categoria}`, { x: W - 180, y: H - 72, size: 8.5, font: fontBold, color: rgb(0.23, 0.51, 0.96) });

            let currY = H - 120;

            // Parse Sections & Checklist Items
            if (mdText) {
                const lines = mdText.split('\n').map(l => l.trim());
                lines.forEach(line => {
                    if (currY < 120) return;

                    if (line.startsWith('## ')) {
                        const secTitle = line.replace(/^##\s+/, '').toUpperCase();
                        currY -= 15;
                        page.drawRectangle({
                            x: 35,
                            y: currY - 5,
                            width: W - 70,
                            height: 24,
                            color: rgb(0.93, 0.95, 0.98),
                            borderColor: rgb(0.82, 0.86, 0.92),
                            borderWidth: 1
                        });
                        page.drawText(secTitle, { x: 45, y: currY + 2, size: 10.5, font: fontBold, color: rgb(0.09, 0.14, 0.24) });
                        currY -= 32;
                    } else if (line.startsWith('- ') || line.startsWith('* ')) {
                        const itemText = line.replace(/^[-*]\s+/, '').trim();
                        const isChecked = /^\[x\]/i.test(itemText);
                        const cleanText = itemText.replace(/^\[[ xX]\]\s*/i, '');

                        // Draw Checkbox Square
                        page.drawRectangle({
                            x: 45,
                            y: currY - 2,
                            width: 14,
                            height: 14,
                            borderWidth: 1.5,
                            borderColor: isChecked ? rgb(0.05, 0.65, 0.41) : rgb(0.5, 0.55, 0.65),
                            color: isChecked ? rgb(0.92, 0.98, 0.94) : rgb(1, 1, 1)
                        });

                        if (isChecked) {
                            page.drawText('X', { x: 48, y: currY + 1, size: 10, font: fontBold, color: rgb(0.05, 0.65, 0.41) });
                        }

                        // Draw Item Text
                        page.drawText(cleanText, {
                            x: 68,
                            y: currY + 1,
                            size: 10.5,
                            font: fontReg,
                            color: isChecked ? rgb(0.45, 0.5, 0.55) : rgb(0.15, 0.2, 0.3)
                        });

                        // Dotted underline
                        page.drawLine({
                            start: { x: 68, y: currY - 5 },
                            end: { x: W - 35, y: currY - 5 },
                            thickness: 0.5,
                            color: rgb(0.88, 0.9, 0.94)
                        });

                        currY -= 26;
                    }
                });
            }

            // Notes Box at Bottom
            if (notas) {
                const notesY = Math.max(50, currY - 20);
                page.drawRectangle({
                    x: 35,
                    y: 40,
                    width: W - 70,
                    height: Math.min(100, notesY - 30),
                    borderWidth: 1.5,
                    borderColor: rgb(0.23, 0.51, 0.96),
                    color: rgb(0.97, 0.98, 1)
                });
                page.drawText('NOTAS & OBSERVACIONES:', { x: 48, y: Math.min(125, notesY - 10), size: 10, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
                page.drawText(notas, { x: 48, y: Math.min(100, notesY - 30), size: 9.5, font: fontReg, color: rgb(0.2, 0.25, 0.35) });
            }

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'lista_tareas_todo.pdf');
            showToast('Lista de Tareas / TODO List lista para imprimir o completar.', 'success');
        } catch (err) {
            console.error('Error al generar lista de tareas:', err);
            showToast('Error al generar la lista de tareas.', 'danger');
        }
    }

    async createResumeCvTemplate(mdText) {
        showToast('Generando Currículum Vitae (CV)...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const page = doc.addPage([595.28, 841.89]); // A4 Portrait
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);
            const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

            const W = 595.28;
            const H = 841.89;

            const nombre = this.getMdVal(mdText, 'NOMBRE', 'MARLON FALCON HERNANDEZ');
            const tituloProf = this.getMdVal(mdText, 'TITULO_PROFESIONAL|TITULO', 'Desarrollador Senior / Consultor de Software');
            const email = this.getMdVal(mdText, 'EMAIL', 'contacto@marlonfalcon.com');
            const tel = this.getMdVal(mdText, 'TELEFONO|TEL', '+34 600 000 000');
            const ubi = this.getMdVal(mdText, 'UBICACION', 'Madrid, España');
            const web = this.getMdVal(mdText, 'SITIO_WEB|WEB', 'www.marlonfalcon.com');

            // Header Banner
            page.drawRectangle({
                x: 0,
                y: H - 110,
                width: W,
                height: 110,
                color: rgb(0.08, 0.12, 0.22)
            });

            // Accent Left Bar
            page.drawRectangle({
                x: 0,
                y: H - 110,
                width: 10,
                height: 110,
                color: rgb(0.23, 0.51, 0.96)
            });

            page.drawText(nombre, {
                x: 35,
                y: H - 50,
                size: 20,
                font: fontBold,
                color: rgb(1, 1, 1)
            });

            page.drawText(tituloProf, {
                x: 35,
                y: H - 72,
                size: 12,
                font: fontBold,
                color: rgb(0.23, 0.51, 0.96)
            });

            page.drawText(`${email}  |  ${tel}  |  ${ubi}  |  ${web}`, {
                x: 35,
                y: H - 95,
                size: 9,
                font: fontReg,
                color: rgb(0.8, 0.85, 0.95)
            });

            let currY = H - 140;

            const wrapText = (text, maxChars = 82) => {
                if (!text || text.length <= maxChars) return [text];
                const words = text.split(' ');
                const lines = [];
                let currentLine = '';
                for (const word of words) {
                    if ((currentLine + ' ' + word).trim().length <= maxChars) {
                        currentLine = (currentLine + ' ' + word).trim();
                    } else {
                        if (currentLine) lines.push(currentLine);
                        currentLine = word;
                    }
                }
                if (currentLine) lines.push(currentLine);
                return lines;
            };

            // Parse Markdown Sections
            if (mdText) {
                const lines = mdText.split('\n').map(l => l.trim());
                lines.forEach(line => {
                    if (currY < 50) return;

                    if (line.startsWith('## ')) {
                        const secTitle = line.replace(/^##\s+/, '').toUpperCase();
                        currY -= 10;

                        // Section Title Header
                        page.drawText(secTitle, {
                            x: 35,
                            y: currY,
                            size: 12,
                            font: fontBold,
                            color: rgb(0.23, 0.51, 0.96)
                        });

                        page.drawLine({
                            start: { x: 35, y: currY - 4 },
                            end: { x: W - 35, y: currY - 4 },
                            thickness: 1.2,
                            color: rgb(0.23, 0.51, 0.96)
                        });

                        currY -= 22;
                    } else if (line.startsWith('- ') || line.startsWith('* ')) {
                        const itemText = line.replace(/^[-*]\s+/, '').trim();
                        const wrapped = wrapText(itemText, 80);

                        wrapped.forEach((wLine, idx) => {
                            if (idx === 0) {
                                page.drawText('•', { x: 45, y: currY, size: 10, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
                                page.drawText(wLine, { x: 58, y: currY, size: 10, font: fontReg, color: rgb(0.2, 0.25, 0.35) });
                            } else {
                                page.drawText(wLine, { x: 58, y: currY, size: 10, font: fontReg, color: rgb(0.2, 0.25, 0.35) });
                            }
                            currY -= 16;
                        });
                        currY -= 4;
                    } else if (line.length > 0 && !line.startsWith('#') && !/^[A-Z_]+:/i.test(line)) {
                        const wrapped = wrapText(line, 86);
                        wrapped.forEach(wLine => {
                            page.drawText(wLine, { x: 35, y: currY, size: 10, font: fontReg, color: rgb(0.3, 0.35, 0.45) });
                            currY -= 16;
                        });
                        currY -= 4;
                    }
                });
            }

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'curriculum_vitae.pdf');
            showToast('Currículum Vitae (CV) generado correctamente.', 'success');
        } catch (err) {
            console.error('Error al generar CV:', err);
            showToast('Error al generar el Currículum Vitae.', 'danger');
        }
    }

    initMarkdownModal() {
        const modal = document.getElementById('markdown-modal');
        const openHeaderBtn = document.getElementById('btn-open-markdown-modal');
        const closeBtn = document.getElementById('btn-close-markdown-modal');
        const cancelBtn = document.getElementById('btn-cancel-markdown-modal');
        const generateBtn = document.getElementById('btn-generate-markdown-pdf');
        const textarea = document.getElementById('md-editor-textarea');
        const fileInput = document.getElementById('md-file-input');
        const uploadBtn = document.getElementById('btn-upload-md-file');
        const resetSampleBtn = document.getElementById('btn-reset-sample-md');

        const openModal = () => {
            if (!textarea) return;
            const savedMd = localStorage.getItem('saved_presentation_md');
            if (savedMd && savedMd.trim()) {
                textarea.value = savedMd;
            } else {
                textarea.value = this.getDefaultMarkdownSample();
            }
            modal?.classList.add('show');
        };

        const closeModal = () => {
            modal?.classList.remove('show');
        };

        openHeaderBtn?.addEventListener('click', openModal);
        closeBtn?.addEventListener('click', closeModal);
        cancelBtn?.addEventListener('click', closeModal);

        uploadBtn?.addEventListener('click', () => {
            if (fileInput) {
                fileInput.value = '';
                fileInput.click();
            }
        });

        fileInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const text = evt.target.result;
                    if (textarea) textarea.value = text;
                    localStorage.setItem('saved_presentation_md', text);
                    showToast(`Archivo "${file.name}" cargado en el editor Markdown.`, 'success');
                };
                reader.readAsText(file);
            }
        });

        resetSampleBtn?.addEventListener('click', () => {
            if (textarea) {
                textarea.value = this.getDefaultMarkdownSample();
                localStorage.setItem('saved_presentation_md', textarea.value);
                showToast('Plantilla Markdown de ejemplo cargada.', 'info');
            }
        });

        const modalSelect = document.getElementById('modal-md-template-select');
        const sideSelect = document.getElementById('side-md-template-select');

        modalSelect?.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            this.currentTemplateType = selectedType;
            if (sideSelect) sideSelect.value = selectedType;
            const newMd = this.getMarkdownSampleForType(selectedType);
            if (textarea) textarea.value = newMd;
        });

        generateBtn?.addEventListener('click', async () => {
            const mdText = textarea?.value || '';
            if (!mdText.trim()) {
                showToast('El contenido Markdown está vacío.', 'warning');
                return;
            }
            const selType = modalSelect ? modalSelect.value : (this.currentTemplateType || 'presentation');
            this.currentMarkdownText = mdText;
            localStorage.setItem('saved_presentation_md', mdText);
            closeModal();
            await this.createPDFFromMarkdown(mdText, selType);
        });

        this.openMarkdownModal = openModal;
        this.closeMarkdownModal = closeModal;
    }

    initMarkdownSidePanel() {
        const toggleBtn = document.getElementById('btn-toggle-md-side-panel');
        const sidePanel = document.getElementById('md-side-panel');
        const closeBtn = document.getElementById('btn-close-md-side-panel');
        const updateBtn = document.getElementById('btn-update-from-side-md');
        const sideTextarea = document.getElementById('md-side-textarea');
        const sideSelect = document.getElementById('side-md-template-select');
        const modalSelect = document.getElementById('modal-md-template-select');
        const uploadBtn = document.getElementById('btn-upload-side-md-file');
        const sideFileInput = document.getElementById('side-md-file-input');

        sideSelect?.addEventListener('change', (e) => {
            const selectedType = e.target.value;
            this.currentTemplateType = selectedType;
            if (modalSelect) modalSelect.value = selectedType;
            const newMd = this.getMarkdownSampleForType(selectedType);
            if (sideTextarea) sideTextarea.value = newMd;
            handleUpdate();
        });

        const togglePanel = (show) => {
            if (!sidePanel) return;
            const isVisible = sidePanel.style.display === 'flex';
            const shouldShow = show !== undefined ? show : !isVisible;

            if (shouldShow) {
                sidePanel.style.display = 'flex';
                toggleBtn?.classList.add('active');
                if (sideSelect && this.currentTemplateType) {
                    sideSelect.value = this.currentTemplateType;
                }
                const textToUse = this.currentMarkdownText || localStorage.getItem('saved_presentation_md') || this.getMarkdownSampleForType(this.currentTemplateType || 'presentation');
                if (sideTextarea) sideTextarea.value = textToUse;
            } else {
                sidePanel.style.display = 'none';
                toggleBtn?.classList.remove('active');
            }
        };

        toggleBtn?.addEventListener('click', () => togglePanel());
        closeBtn?.addEventListener('click', () => togglePanel(false));

        uploadBtn?.addEventListener('click', () => {
            if (sideFileInput) {
                sideFileInput.value = '';
                sideFileInput.click();
            }
        });

        sideFileInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                const file = e.target.files[0];
                const reader = new FileReader();
                reader.onload = (evt) => {
                    const text = evt.target.result;
                    if (sideTextarea) sideTextarea.value = text;
                    this.currentMarkdownText = text;
                    localStorage.setItem('saved_presentation_md', text);
                    showToast(`Archivo "${file.name}" cargado en el panel Markdown.`, 'success');
                    handleUpdate();
                };
                reader.readAsText(file);
            }
        });

        const handleUpdate = async () => {
            const mdText = sideTextarea?.value || '';
            if (!mdText.trim()) return;
            const selType = sideSelect ? sideSelect.value : (this.currentTemplateType || 'presentation');
            await this.createPDFFromMarkdown(mdText, selType);
        };

        updateBtn?.addEventListener('click', handleUpdate);

        let debounceTimer = null;
        sideTextarea?.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                handleUpdate();
            }, 300);
        });

        sideTextarea?.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleUpdate();
            }
        });

        this.toggleMarkdownSidePanel = togglePanel;
    }

    getDefaultMarkdownSample() {
        return `# PRESENTACION DE PROYECTO
## Informe de Resultados, Objetivos Estrategicos y Hoja de Ruta 2026
AUTOR: Marlon Falcon Hernandez
SITIO WEB: www.marlonfalcon.com
FECHA: 06 de Septiembre de 2026

---

# SLIDE 2: CONTENIDO PRINCIPAL Y DETALLES
## TITULO DE LA SECCION / TEMA PRINCIPAL

Este apartado esta disenado para presentar un texto explicativo claro y directo.

PUNTOS DESTACADOS DEL PROYECTO:
- Primer objetivo: Definir el alcance y requerimientos funcionales.
- Segundo objetivo: Implementar una solucion modular sin dependencias externas.
- Tercer objetivo: Garantizar la maxima calidad para los usuarios.

Conclusion preliminar: Esta plantilla ofrece maxima legibilidad tanto para presentaciones como para impresion.

---

# SLIDE 3: CONCLUSIONES Y PROXIMOS PASOS
## RESUMEN Y CONCLUSIONES CLAVE

1. La ejecucion 100% local garantiza la privacidad absoluta de los archivos PDF.
2. El rendimiento de renderizado y edicion se mantiene fluido sin dependencia de la nube.
3. La plataforma integra todas las herramientas necesarias para firma, edicion y diseno.

> "La simplicidad y el procesamiento local ofrecen la mejor experiencia de usuario."`;
    }

    async createPresentationTemplate() {
        if (typeof this.openMarkdownModal === 'function') {
            this.openMarkdownModal();
        } else {
            await this.createPDFFromMarkdown(this.getDefaultMarkdownSample(), 'presentation');
        }
    }

    async createPDFFromMarkdown(mdText, templateType = 'presentation') {
        if (!mdText || !mdText.trim()) {
            showToast('El contenido Markdown está vacío.', 'warning');
            return;
        }

        this.currentTemplateType = templateType;
        this.currentMarkdownText = mdText;
        localStorage.setItem('saved_presentation_md', mdText);

        // Sync textareas if present
        const modalTextarea = document.getElementById('md-editor-textarea');
        if (modalTextarea && modalTextarea.value !== mdText) {
            modalTextarea.value = mdText;
        }
        const sideTextarea = document.getElementById('md-side-textarea');
        if (sideTextarea && sideTextarea.value !== mdText) {
            sideTextarea.value = mdText;
        }

        if (templateType === 'invoice') {
            await this.createInvoiceTemplate(mdText);
            return;
        } else if (templateType === 'diploma') {
            await this.createDiplomaTemplate(mdText);
            return;
        } else if (templateType === 'sale') {
            await this.createSaleSignTemplate(mdText);
            return;
        } else if (templateType === 'business-cards') {
            await this.createBusinessCardsTemplate(mdText);
            return;
        } else if (templateType === 'book-labels') {
            await this.createBookLabelsTemplate(mdText);
            return;
        } else if (templateType === 'qr-poster') {
            await this.createQrPosterTemplate(mdText);
            return;
        } else if (templateType === 'mobile-wireframe') {
            await this.createMobileWireframeTemplate(mdText);
            return;
        } else if (templateType === 'desktop-wireframe') {
            await this.createDesktopWireframeTemplate(mdText);
            return;
        } else if (templateType === 'job-offer') {
            await this.createJobOfferTemplate(mdText);
            return;
        } else if (templateType === 'money-receipt') {
            await this.createMoneyReceiptTemplate(mdText);
            return;
        } else if (templateType === 'whatsapp-status') {
            await this.createWhatsAppStatusTemplate(mdText);
            return;
        } else if (templateType === 'todo-list') {
            await this.createTodoListTemplate(mdText);
            return;
        } else if (templateType === 'resume-cv') {
            await this.createResumeCvTemplate(mdText);
            return;
        }

        await this.createPresentationFromMarkdown(mdText);
    }

    async createPresentationFromMarkdown(mdText) {
        if (!mdText || !mdText.trim()) {
            showToast('El contenido Markdown está vacío.', 'warning');
            return;
        }

        this.currentMarkdownText = mdText;
        localStorage.setItem('saved_presentation_md', mdText);

        // Sync textareas if present
        const modalTextarea = document.getElementById('md-editor-textarea');
        if (modalTextarea && modalTextarea.value !== mdText) {
            modalTextarea.value = mdText;
        }
        const sideTextarea = document.getElementById('md-side-textarea');
        if (sideTextarea && sideTextarea.value !== mdText) {
            sideTextarea.value = mdText;
        }

        showToast('Generando presentación PDF desde Markdown...', 'info');
        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const doc = await PDFDocument.create();
            const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
            const fontReg = await doc.embedFont(StandardFonts.Helvetica);
            const fontOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

            const W = 841.89; // A4 Landscape
            const H = 595.28;

            const slideBlocks = mdText.split(/\n\s*---\s*\n|^\s*---\s*$/m).map(b => b.trim()).filter(b => b.length > 0);
            const totalSlides = slideBlocks.length || 1;

            const wrapText = (text, maxChars = 90) => {
                if (!text || text.length <= maxChars) return [text];
                const words = text.split(' ');
                const lines = [];
                let currentLine = '';
                for (const word of words) {
                    if ((currentLine + ' ' + word).trim().length <= maxChars) {
                        currentLine = (currentLine + ' ' + word).trim();
                    } else {
                        if (currentLine) lines.push(currentLine);
                        currentLine = word;
                    }
                }
                if (currentLine) lines.push(currentLine);
                return lines;
            };

            slideBlocks.forEach((block, index) => {
                const page = doc.addPage([W, H]);
                const slideNum = index + 1;

                // Base Background
                page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(1, 1, 1) });

                // Left Accent Stripe
                page.drawRectangle({ x: 0, y: 0, width: 12, height: H, color: rgb(0.23, 0.51, 0.96) });

                // Footer Bar
                page.drawRectangle({ x: 0, y: 0, width: W, height: 28, color: rgb(0.96, 0.97, 0.99) });
                page.drawLine({ start: { x: 0, y: 28 }, end: { x: W, y: 28 }, thickness: 0.8, color: rgb(0.85, 0.88, 0.92) });

                page.drawText('PDF Local Editor - Presentacion Markdown', {
                    x: 35,
                    y: 9,
                    size: 8.5,
                    font: fontReg,
                    color: rgb(0.45, 0.5, 0.6)
                });

                page.drawText(`Diapositiva ${slideNum} de ${totalSlides}`, {
                    x: W - 110,
                    y: 9,
                    size: 8.5,
                    font: fontBold,
                    color: rgb(0.23, 0.51, 0.96)
                });

                const rawLines = block.split('\n').map(l => l.trim());

                let h1Title = '';
                let h2Subtitle = '';
                const bodyContent = [];
                const metaFields = [];

                rawLines.forEach(line => {
                    if (!line) {
                        bodyContent.push({ type: 'empty' });
                        return;
                    }

                    if (line.startsWith('# ')) {
                        h1Title = line.replace(/^#\s+/, '').trim();
                    } else if (line.startsWith('## ')) {
                        h2Subtitle = line.replace(/^##\s+/, '').trim();
                    } else if (line.startsWith('### ')) {
                        bodyContent.push({ type: 'h3', text: line.replace(/^###\s+/, '').trim() });
                    } else if (/^(AUTOR|FECHA|SITIO WEB|PROYECTO|VERSION|EMAIL|CONTACTO):/i.test(line)) {
                        metaFields.push(line);
                    } else if (line.startsWith('- ') || line.startsWith('* ')) {
                        bodyContent.push({ type: 'bullet', text: line.replace(/^[-*]\s+/, '').trim() });
                    } else if (/^\d+\.\s+/.test(line)) {
                        bodyContent.push({ type: 'numbered', text: line.trim() });
                    } else if (line.startsWith('> ')) {
                        bodyContent.push({ type: 'quote', text: line.replace(/^>\s+/, '').trim() });
                    } else {
                        bodyContent.push({ type: 'p', text: line });
                    }
                });

                // Render Header if present
                let currY = H - 55;

                if (h1Title) {
                    const headerH = h2Subtitle ? 65 : 50;
                    page.drawRectangle({ x: 35, y: H - 25 - headerH, width: W - 70, height: headerH, color: rgb(0.96, 0.97, 1), borderColor: rgb(0.85, 0.9, 0.98), borderWidth: 1 });
                    page.drawText(h1Title, { x: 55, y: H - 52, size: 20, font: fontBold, color: rgb(0.09, 0.14, 0.24) });
                    if (h2Subtitle) {
                        page.drawText(h2Subtitle, { x: 55, y: H - 72, size: 11, font: fontReg, color: rgb(0.23, 0.51, 0.96) });
                    }
                    currY = H - 40 - headerH;
                } else if (h2Subtitle) {
                    page.drawText(h2Subtitle, { x: 35, y: H - 45, size: 16, font: fontBold, color: rgb(0.09, 0.14, 0.24) });
                    currY = H - 70;
                }

                // Render Metadata Box if present
                if (metaFields.length > 0) {
                    const metaH = metaFields.length * 22 + 16;
                    page.drawRectangle({
                        x: 35,
                        y: currY - metaH,
                        width: W - 70,
                        height: metaH,
                        color: rgb(0.98, 0.99, 1),
                        borderColor: rgb(0.23, 0.51, 0.96),
                        borderWidth: 1.2
                    });

                    let metaY = currY - 22;
                    metaFields.forEach(mf => {
                        const idx = mf.indexOf(':');
                        const key = (idx !== -1 ? mf.substring(0, idx) : mf).trim() + ':';
                        const val = (idx !== -1 ? mf.substring(idx + 1) : '').trim();
                        page.drawText(key, { x: 55, y: metaY, size: 11, font: fontBold, color: rgb(0.1, 0.15, 0.25) });
                        page.drawText(val, { x: 55 + key.length * 7 + 10, y: metaY, size: 10.5, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
                        metaY -= 22;
                    });

                    currY -= (metaH + 20);
                }

                // Render Body Content
                let y = currY;

                bodyContent.forEach(item => {
                    if (y < 50) return;

                    if (item.type === 'empty') {
                        y -= 10;
                    } else if (item.type === 'h3') {
                        y -= 6;
                        page.drawText(item.text, { x: 35, y: y, size: 13, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
                        y -= 22;
                    } else if (item.type === 'bullet') {
                        const wrapped = wrapText(item.text, 88);
                        wrapped.forEach((wLine, idx) => {
                            if (idx === 0) {
                                page.drawText('*', { x: 45, y: y, size: 14, font: fontBold, color: rgb(0.23, 0.51, 0.96) });
                                page.drawText(wLine, { x: 60, y: y, size: 11, font: fontReg, color: rgb(0.2, 0.25, 0.35) });
                            } else {
                                page.drawText(wLine, { x: 60, y: y, size: 11, font: fontReg, color: rgb(0.2, 0.25, 0.35) });
                            }
                            y -= 18;
                        });
                    } else if (item.type === 'numbered') {
                        const wrapped = wrapText(item.text, 88);
                        wrapped.forEach(wLine => {
                            page.drawText(wLine, { x: 45, y: y, size: 11, font: fontReg, color: rgb(0.2, 0.25, 0.35) });
                            y -= 18;
                        });
                    } else if (item.type === 'quote') {
                        const wrapped = wrapText(item.text, 82);
                        const qH = wrapped.length * 18 + 12;
                        page.drawRectangle({
                            x: 35,
                            y: y - qH + 12,
                            width: W - 70,
                            height: qH,
                            color: rgb(0.96, 0.97, 0.99)
                        });
                        page.drawRectangle({
                            x: 35,
                            y: y - qH + 12,
                            width: 4,
                            height: qH,
                            color: rgb(0.23, 0.51, 0.96)
                        });

                        wrapped.forEach(qLine => {
                            page.drawText(qLine, { x: 50, y: y, size: 10.5, font: fontOblique, color: rgb(0.15, 0.2, 0.3) });
                            y -= 18;
                        });
                        y -= 8;
                    } else if (item.type === 'p') {
                        const wrapped = wrapText(item.text, 92);
                        wrapped.forEach(wLine => {
                            page.drawText(wLine, { x: 35, y: y, size: 11, font: fontReg, color: rgb(0.25, 0.3, 0.4) });
                            y -= 18;
                        });
                    }
                });
            });

            const bytes = await doc.save();
            await this.loadPDFBytes(bytes, 'presentacion_markdown.pdf');
            showToast(`Presentación PDF de ${totalSlides} diapositiva(s) generada con éxito desde Markdown.`, 'success');
        } catch (err) {
            console.error('Error al generar presentación desde Markdown:', err);
            showToast('Error al generar la presentación en PDF.', 'danger');
        }
    }

    async createNewBlankPDF() {
        showToast('Creando nuevo documento PDF en blanco...', 'info');
        try {
            const { PDFDocument } = window.PDFLib;
            const blankDoc = await PDFDocument.create();
            blankDoc.addPage([595.28, 841.89]); // Standard A4
            const bytes = await blankDoc.save();
            await this.loadPDFBytes(bytes, 'nuevo_documento.pdf');
            showToast('Documento PDF en blanco creado. ¡Ya puedes escribir y dibujar!', 'success');
        } catch (err) {
            console.error('Error al crear PDF en blanco:', err);
            showToast('Error al crear el documento PDF en blanco.', 'danger');
        }
    }

    async addBlankPage() {
        if (!this.pdfBytes) {
            await this.createNewBlankPDF();
            return;
        }

        showToast('Añadiendo página en blanco...', 'info');
        try {
            const { PDFDocument } = window.PDFLib;
            const doc = await PDFDocument.load(this.pdfBytes.slice(0), { ignoreEncryption: true });
            doc.addPage([595.28, 841.89]);
            const bytes = await doc.save();
            const newTotalPages = doc.getPageCount();
            await this.loadPDFBytes(bytes, this.filename, false);
            this.goToPage(newTotalPages);
            showToast('Página en blanco añadida al PDF.', 'success');
        } catch (err) {
            console.error('Error al añadir página en blanco:', err);
            showToast('Error al añadir la página en blanco.', 'danger');
        }
    }

    async renderThumbnails() {
        const container = document.getElementById('thumbnails-container');
        if (!container) return;
        container.innerHTML = '';

        for (let i = 1; i <= this.totalPages; i++) {
            if (this.deletedPages.has(i)) continue;

            const item = document.createElement('div');
            item.className = `thumbnail-item ${i === this.currentPage ? 'active' : ''}`;
            item.dataset.page = i;

            const canvas = document.createElement('canvas');
            item.appendChild(canvas);

            const label = document.createElement('div');
            label.className = 'thumbnail-page-number';
            label.innerText = `Pág. ${i}`;
            item.appendChild(label);

            item.addEventListener('click', () => this.goToPage(i));
            container.appendChild(item);

            // Render thumbnail page asynchronously
            this.pdfDoc.getPage(i).then(async (page) => {
                const rotation = (this.pageRotations[i] || 0) + page.rotate;
                const viewport = page.getViewport({ scale: 0.2, rotation: rotation });
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                const ctx = canvas.getContext('2d');
                await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            });
        }
    }

    async renderCurrentPage() {
        if (!this.pdfDoc || this.deletedPages.has(this.currentPage)) return;

        // Update nav state
        document.getElementById('page-num-input').value = this.currentPage;
        document.getElementById('total-pages-label').innerText = `/ ${this.totalPages}`;
        document.getElementById('zoom-percentage').innerText = `${Math.round(this.zoom * 100)}%`;

        // Highlight active thumbnail
        document.querySelectorAll('.thumbnail-item').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.page) === this.currentPage);
        });

        const page = await this.pdfDoc.getPage(this.currentPage);
        const rotation = (this.pageRotations[this.currentPage] || 0) + page.rotate;
        const viewport = page.getViewport({ scale: 1.5 * this.zoom, rotation: rotation });

        const pageContainer = document.getElementById('page-container');
        const pdfCanvas = document.getElementById('pdf-canvas');
        const drawCanvas = document.getElementById('draw-canvas');
        const annotationLayer = document.getElementById('annotation-layer');

        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        if (drawCanvas) {
            drawCanvas.width = viewport.width;
            drawCanvas.height = viewport.height;
        }
        pageContainer.style.width = `${viewport.width}px`;
        pageContainer.style.height = `${viewport.height}px`;

        pdfCanvas.style.display = this.pdfLayerVisible ? 'block' : 'none';
        if (drawCanvas) drawCanvas.style.display = this.drawLayerVisible ? 'block' : 'none';

        const ctx = pdfCanvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;

        // Render PDF text layer for interactive double-click text editing
        await this.renderPDFTextLayer(page, viewport);

        // Redraw freehand drawings
        this.redrawDrawCanvas();

        // Render annotations / elements placed on this page
        this.renderAnnotations();

        // Render layers panel in sidebar
        this.renderLayersPanel();

        // Update rulers if active
        if (this.rulersActive) this.renderRulers();
    }

    async renderPDFTextLayer(page, viewport) {
        let textLayerDiv = document.getElementById('text-layer');
        if (!textLayerDiv) {
            textLayerDiv = document.createElement('div');
            textLayerDiv.id = 'text-layer';
            textLayerDiv.className = 'pdf-text-layer';
            const pageContainer = document.getElementById('page-container');
            const annotationLayer = document.getElementById('annotation-layer');
            pageContainer.insertBefore(textLayerDiv, annotationLayer);
        }
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.display = this.pdfLayerVisible ? 'block' : 'none';

        try {
            const textContent = await page.getTextContent();
            
            textContent.items.forEach((item) => {
                if (!item.str || !item.str.trim()) return;

                // Use PDF.js transform to map PDF coords to viewport
                const tx = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
                const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
                
                const x = tx[4];
                const y = tx[5] - fontSize;
                const width = item.width * viewport.scale;
                const height = (item.height || fontSize) * viewport.scale;

                const span = document.createElement('span');
                span.className = 'pdf-text-item';
                span.innerText = item.str;
                span.title = 'Doble clic para editar este texto';
                span.style.left = `${x}px`;
                span.style.top = `${y}px`;
                span.style.fontSize = `${fontSize}px`;
                span.style.width = `${Math.max(width, 25)}px`;
                span.style.height = `${Math.max(height, fontSize * 1.2)}px`;

                // Double click on original PDF text -> convert to editable overlay!
                span.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    this.convertPDFTextToEditable(item.str, x, y, width || (fontSize * item.str.length * 0.6), Math.max(height, fontSize * 1.3), fontSize);
                });

                textLayerDiv.appendChild(span);
            });
        } catch (err) {
            console.warn('Error al procesar capas de texto del PDF:', err);
        }
    }

    convertPDFTextToEditable(text, x, y, width, height, fontSize) {
        if (!this.elements[this.currentPage]) {
            this.elements[this.currentPage] = [];
        }

        const newElem = {
            id: 'elem_' + Date.now(),
            type: 'text',
            text: text,
            x: Math.max(0, x - 2),
            y: Math.max(0, y - 2),
            width: Math.max(40, width + 8),
            height: Math.max(20, height + 4),
            fontSize: Math.round(fontSize * 10) / 10,
            color: '#000000',
            bgWhite: true
        };

        this.elements[this.currentPage].push(newElem);
        this.renderAnnotations();
        this.selectElement(newElem);

        // Focus & select text for editing
        setTimeout(() => {
            const node = document.querySelector(`.placed-element[data-id="${newElem.id}"] .placed-text-content`);
            if (node) {
                node.focus();
                const range = document.createRange();
                range.selectNodeContents(node);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 50);

        showToast('Texto listo para edición. Su estilo y tamaño se mantendrán intactos.', 'success');
    }

    renderAnnotations() {
        const annotationLayer = document.getElementById('annotation-layer');
        if (!annotationLayer) return;
        annotationLayer.innerHTML = '';

        const pageElems = this.elements[this.currentPage] || [];
        pageElems.forEach(elem => {
            const elemNode = this.createOverlayNode(elem);
            annotationLayer.appendChild(elemNode);
        });
    }

    createOverlayNode(elem) {
        const div = document.createElement('div');
        div.className = `placed-element ${this.selectedElement?.id === elem.id ? 'selected' : ''}`;
        div.dataset.id = elem.id;

        if (elem.hidden) {
            div.style.display = 'none';
        }
        if (elem.type === 'whiteout') {
            div.classList.add('whiteout-box');
        }
        if (elem.bgWhite) {
            div.classList.add('bg-white');
        }

        div.style.left = `${elem.x}px`;
        div.style.top = `${elem.y}px`;
        div.style.width = elem.width ? `${elem.width}px` : 'auto';
        div.style.height = elem.height ? `${elem.height}px` : 'auto';

        if (elem.type === 'signature') {
            const img = document.createElement('img');
            img.src = elem.dataUrl;
            div.appendChild(img);
        } else if (elem.type === 'image') {
            div.classList.add('type-image');
            const img = document.createElement('img');
            img.src = elem.dataUrl;
            img.alt = elem.name || 'Imagen';
            div.appendChild(img);
        } else if (elem.type === 'text') {
            const textContent = document.createElement('div');
            textContent.className = 'placed-text-content';
            textContent.contentEditable = true;
            textContent.innerText = elem.text || 'Texto aquí';
            textContent.style.color = elem.color || '#000000';
            textContent.style.fontSize = `${elem.fontSize || 16}px`;

            textContent.addEventListener('input', () => {
                elem.text = textContent.innerText || textContent.textContent;
            });

            textContent.addEventListener('paste', (e) => {
                e.preventDefault();
                const plainText = (e.clipboardData || window.clipboardData).getData('text/plain');
                if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
                    document.execCommand('insertText', false, plainText);
                } else {
                    const sel = window.getSelection();
                    if (sel.rangeCount) {
                        sel.getRangeAt(0).insertNode(document.createTextNode(plainText));
                    }
                }
            });

            textContent.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
                    e.preventDefault();
                }
            });

            div.appendChild(textContent);
        } else if (elem.type === 'shape') {
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'placed-shape-svg');
            svg.setAttribute('viewBox', '0 0 100 100');
            svg.setAttribute('preserveAspectRatio', 'none');

            let shapeEl;
            if (elem.shapeType === 'circle') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
                shapeEl.setAttribute('cx', '50');
                shapeEl.setAttribute('cy', '50');
                shapeEl.setAttribute('rx', '46');
                shapeEl.setAttribute('ry', '46');
            } else if (elem.shapeType === 'arrow') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                shapeEl.setAttribute('d', 'M 5 50 L 65 50 L 65 25 L 95 50 L 65 75 L 65 50 Z');
            } else if (elem.shapeType === 'star') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                shapeEl.setAttribute('points', '50,5 63,35 95,38 71,60 78,92 50,75 22,92 29,60 5,38 37,35');
            } else { // rectangle
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                shapeEl.setAttribute('x', '2');
                shapeEl.setAttribute('y', '2');
                shapeEl.setAttribute('width', '96');
                shapeEl.setAttribute('height', '96');
                shapeEl.setAttribute('rx', '2');
            }

            shapeEl.setAttribute('fill', elem.fillColor || 'transparent');
            shapeEl.setAttribute('stroke', elem.strokeColor || '#000000');
            shapeEl.setAttribute('stroke-width', (elem.strokeWidth || 2) * 1.5);
            svg.appendChild(shapeEl);
            div.appendChild(svg);
        } else if (elem.type === 'table') {
            const container = document.createElement('div');
            container.className = 'placed-table-container';

            const table = document.createElement('table');
            table.className = 'placed-table';

            for (let r = 0; r < (elem.rows || 1); r++) {
                const tr = document.createElement('tr');
                for (let c = 0; c < (elem.cols || 1); c++) {
                    const cell = r === 0 ? document.createElement('th') : document.createElement('td');
                    cell.contentEditable = true;
                    cell.innerText = (elem.data && elem.data[r] && elem.data[r][c] !== undefined) ? elem.data[r][c] : '';
                    if (r === 0 && elem.headerBg) {
                        cell.style.backgroundColor = elem.headerBg;
                    }
                    cell.addEventListener('input', () => {
                        if (!elem.data) elem.data = [];
                        if (!elem.data[r]) elem.data[r] = [];
                        elem.data[r][c] = cell.innerText;
                    });
                    tr.appendChild(cell);
                }
                table.appendChild(tr);
            }
            container.appendChild(table);
            div.appendChild(container);
        }

        // Element Controls Bar
        const controls = document.createElement('div');
        controls.className = 'element-controls';

        if (elem.type === 'text') {
            const bgBtn = document.createElement('button');
            bgBtn.className = `element-btn ${elem.bgWhite ? 'active' : ''}`;
            bgBtn.innerHTML = elem.bgWhite ? '<i class="fas fa-check-square"></i> Fondo Blanco' : '<i class="fas fa-square"></i> Fondo Transparente';
            bgBtn.title = elem.bgWhite ? 'Desactivar fondo blanco' : 'Activar fondo blanco (Cubrir texto previo)';
            bgBtn.style.color = elem.bgWhite ? '#10b981' : '#94a3b8';
            bgBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                elem.bgWhite = !elem.bgWhite;
                div.classList.toggle('bg-white', elem.bgWhite);
                bgBtn.innerHTML = elem.bgWhite ? '<i class="fas fa-check-square"></i> Fondo Blanco' : '<i class="fas fa-square"></i> Fondo Transparente';
                bgBtn.style.color = elem.bgWhite ? '#10b981' : '#94a3b8';
            });
            controls.appendChild(bgBtn);

            const incFontBtn = document.createElement('button');
            incFontBtn.className = 'element-btn';
            incFontBtn.innerText = 'A+';
            incFontBtn.title = 'Aumentar letra';
            incFontBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                elem.fontSize = (elem.fontSize || 16) + 2;
                const textElem = div.querySelector('.placed-text-content');
                if (textElem) textElem.style.fontSize = `${elem.fontSize}px`;
            });
            controls.appendChild(incFontBtn);

            const decFontBtn = document.createElement('button');
            decFontBtn.className = 'element-btn';
            decFontBtn.innerText = 'A-';
            decFontBtn.title = 'Reducir letra';
            decFontBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                elem.fontSize = Math.max(10, (elem.fontSize || 16) - 2);
                const textElem = div.querySelector('.placed-text-content');
                if (textElem) textElem.style.fontSize = `${elem.fontSize}px`;
            });
            controls.appendChild(decFontBtn);

            // Brocha 1: Copiar Estilo de Texto
            const copyStyleBtn = document.createElement('button');
            copyStyleBtn.className = 'element-btn';
            copyStyleBtn.innerHTML = '<i class="fas fa-paint-brush"></i> Copiar Estilo';
            copyStyleBtn.title = 'Copiar formato de este texto (tamaño, color, fondo)';
            copyStyleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copiedTextStyle = {
                    fontSize: elem.fontSize || 16,
                    color: elem.color || '#000000',
                    bgWhite: !!elem.bgWhite
                };
                showToast('🖌️ Estilo de texto copiado. Haz clic en "Pegar Estilo" en otro texto para aplicarlo.', 'info');
                this.renderAnnotations();
            });
            controls.appendChild(copyStyleBtn);

            // Pegar Estilo
            if (this.copiedTextStyle) {
                const pasteStyleBtn = document.createElement('button');
                pasteStyleBtn.className = 'element-btn';
                pasteStyleBtn.innerHTML = '<i class="fas fa-paint-roller"></i> Pegar Estilo';
                pasteStyleBtn.title = 'Aplicar el formato de texto copiado a este elemento';
                pasteStyleBtn.style.color = '#10b981';
                pasteStyleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    elem.fontSize = this.copiedTextStyle.fontSize;
                    elem.color = this.copiedTextStyle.color;
                    elem.bgWhite = this.copiedTextStyle.bgWhite;
                    this.renderAnnotations();
                    showToast('🎨 Estilo aplicado a este texto.', 'success');
                });
                controls.appendChild(pasteStyleBtn);
            }

            // Brocha 2: Copiar Estilo y Texto
            const cloneAllBtn = document.createElement('button');
            cloneAllBtn.className = 'element-btn';
            cloneAllBtn.innerHTML = '<i class="fas fa-clone"></i> Copiar Estilo y Texto';
            cloneAllBtn.title = 'Duplicar texto con exactamente el mismo contenido y formato';
            cloneAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.copySelectedElement(elem);
                this.pasteClipboardElement();
            });
            controls.appendChild(cloneAllBtn);
        } else if (elem.type === 'shape') {
            const fillBtn = document.createElement('button');
            fillBtn.className = 'element-btn';
            fillBtn.innerHTML = `<i class="fas fa-fill-drip"></i> ${elem.fillColor === 'transparent' ? 'Sin Relleno' : 'Relleno'}`;
            fillBtn.title = 'Cambiar color de relleno';
            fillBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const fillPalette = ['transparent', '#ffffff', '#3b82f6', '#dc2626', '#059669', '#f59e0b', '#1e293b'];
                const currentIdx = fillPalette.indexOf(elem.fillColor || 'transparent');
                elem.fillColor = fillPalette[(currentIdx + 1) % fillPalette.length];
                this.renderAnnotations();
            });
            controls.appendChild(fillBtn);

            const strokeBtn = document.createElement('button');
            strokeBtn.className = 'element-btn';
            strokeBtn.innerHTML = '<i class="fas fa-palette"></i> Borde';
            strokeBtn.title = 'Cambiar color de borde';
            strokeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const strokePalette = ['#000000', '#1d4ed8', '#dc2626', '#059669', '#ffffff'];
                const currentIdx = strokePalette.indexOf(elem.strokeColor || '#000000');
                elem.strokeColor = strokePalette[(currentIdx + 1) % strokePalette.length];
                this.renderAnnotations();
            });
            controls.appendChild(strokeBtn);
        } else if (elem.type === 'table') {
            const addRowBtn = document.createElement('button');
            addRowBtn.className = 'element-btn';
            addRowBtn.innerHTML = '<i class="fas fa-plus"></i> Fila';
            addRowBtn.title = 'Añadir fila a la tabla';
            addRowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                elem.rows = (elem.rows || 1) + 1;
                if (!elem.data) elem.data = [];
                const newRow = [];
                for (let c = 0; c < (elem.cols || 1); c++) {
                    newRow.push(`Dato ${elem.rows}-${c + 1}`);
                }
                elem.data.push(newRow);
                elem.height += 28;
                this.renderAnnotations();
            });
            controls.appendChild(addRowBtn);

            const delRowBtn = document.createElement('button');
            delRowBtn.className = 'element-btn';
            delRowBtn.innerHTML = '<i class="fas fa-minus"></i> Fila';
            delRowBtn.title = 'Eliminar última fila';
            delRowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (elem.rows > 1) {
                    elem.rows -= 1;
                    if (elem.data) elem.data.pop();
                    elem.height = Math.max(40, elem.height - 28);
                    this.renderAnnotations();
                }
            });
            controls.appendChild(delRowBtn);

            const addColBtn = document.createElement('button');
            addColBtn.className = 'element-btn';
            addColBtn.innerHTML = '<i class="fas fa-plus"></i> Col';
            addColBtn.title = 'Añadir columna a la tabla';
            addColBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                elem.cols = (elem.cols || 1) + 1;
                if (!elem.data) elem.data = [];
                for (let r = 0; r < elem.rows; r++) {
                    if (!elem.data[r]) elem.data[r] = [];
                    elem.data[r].push(r === 0 ? `Col ${elem.cols}` : `Dato ${r}-${elem.cols}`);
                }
                elem.width += 70;
                this.renderAnnotations();
            });
            controls.appendChild(addColBtn);

            const delColBtn = document.createElement('button');
            delColBtn.className = 'element-btn';
            delColBtn.innerHTML = '<i class="fas fa-minus"></i> Col';
            delColBtn.title = 'Eliminar última columna';
            delColBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (elem.cols > 1) {
                    elem.cols -= 1;
                    if (elem.data) {
                        for (let r = 0; r < elem.rows; r++) {
                            if (elem.data[r]) elem.data[r].pop();
                        }
                    }
                    elem.width = Math.max(70, elem.width - 70);
                    this.renderAnnotations();
                }
            });
            controls.appendChild(delColBtn);
        }

        // Duplicate button
        const copyBtn = document.createElement('button');
        copyBtn.className = 'element-btn';
        copyBtn.innerHTML = '<i class="fas fa-copy"></i> Duplicar';
        copyBtn.title = 'Copiar / Duplicar elemento (Ctrl+C / Ctrl+V)';
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.copySelectedElement(elem);
            this.pasteClipboardElement();
        });
        controls.appendChild(copyBtn);
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'element-btn delete';
        deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
        deleteBtn.title = 'Eliminar';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.removeElement(elem.id);
        });

        controls.appendChild(deleteBtn);
        div.appendChild(controls);

        // Resize Handle
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        div.appendChild(resizeHandle);

        // Event Listeners for Dragging & Resizing
        this.makeDraggableAndResizable(div, elem, resizeHandle);

        div.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectElement(elem);
        });

        // Double Click to Edit or Replace!
        div.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (elem.type === 'signature') {
                this.replacingElementId = elem.id;
                showToast('Dibuja o selecciona una nueva firma para reemplazar esta.', 'info');
                document.getElementById('signature-modal')?.classList.add('show');
                window.signatureManager?.resizeCanvas();
            } else if (elem.type === 'text') {
                const textElem = div.querySelector('.placed-text-content');
                if (textElem) {
                    textElem.focus();
                    const range = document.createRange();
                    range.selectNodeContents(textElem);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                }
            }
        });

        return div;
    }

    makeDraggableAndResizable(node, elem, resizeHandle) {
        let isDragging = false;
        let isResizing = false;
        let startX, startY, startW, startH, startElemX, startElemY;

        const onMouseDown = (e) => {
            // Do not drag if clicking inside element-controls bar
            if (e.target.closest('.element-controls')) {
                return;
            }

            if (e.target === resizeHandle) {
                isResizing = true;
            } else if (e.target.classList.contains('placed-text-content') && document.activeElement === e.target) {
                return; // editing text
            } else {
                isDragging = true;
            }

            e.stopPropagation();

            startX = e.clientX;
            startY = e.clientY;
            startW = elem.width || node.offsetWidth;
            startH = elem.height || node.offsetHeight;
            startElemX = elem.x;
            startElemY = elem.y;

            this.selectElement(elem);

            const onMouseMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;

                if (isDragging) {
                    let nextX = Math.max(0, startElemX + dx);
                    let nextY = Math.max(0, startElemY + dy);
                    if (this.gridActive) {
                        nextX = Math.round(nextX / 10) * 10;
                        nextY = Math.round(nextY / 10) * 10;
                    }
                    elem.x = nextX;
                    elem.y = nextY;
                    node.style.left = `${elem.x}px`;
                    node.style.top = `${elem.y}px`;
                } else if (isResizing) {
                    let nextW = Math.max(30, startW + dx);
                    let nextH = Math.max(15, startH + dy);
                    if (this.gridActive) {
                        nextW = Math.round(nextW / 10) * 10;
                        nextH = Math.round(nextH / 10) * 10;
                    }
                    elem.width = nextW;
                    elem.height = nextH;
                    node.style.width = `${elem.width}px`;
                    node.style.height = `${elem.height}px`;
                }
            };

            const onMouseUp = () => {
                if (isDragging || isResizing) {
                    this.saveHistoryState();
                }
                isDragging = false;
                isResizing = false;
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        node.addEventListener('mousedown', onMouseDown);
    }

    copySelectedElement(elemToCopy = null) {
        const target = elemToCopy || this.selectedElement;
        if (!target) return;

        // Deep clone object
        this.clipboardElement = JSON.parse(JSON.stringify(target));
        showToast('Elemento copiado al portapapeles (Ctrl+C). Usa Ctrl+V para pegar.', 'info');
    }

    pasteClipboardElement() {
        if (!this.clipboardElement) {
            showToast('No hay ningún elemento en el portapapeles.', 'danger');
            return;
        }

        if (!this.elements[this.currentPage]) {
            this.elements[this.currentPage] = [];
        }

        // Clone element with new ID and offset position
        const newElem = JSON.parse(JSON.stringify(this.clipboardElement));
        newElem.id = 'elem_' + Date.now();
        newElem.x = (newElem.x || 100) + 20;
        newElem.y = (newElem.y || 100) + 20;

        this.elements[this.currentPage].push(newElem);
        this.saveHistoryState();
        this.renderAnnotations();
        this.selectElement(newElem);
        showToast('Elemento pegado (Ctrl+V).', 'success');
    }

    selectElement(elem) {
        this.selectedElement = elem;
        document.querySelectorAll('.placed-element').forEach(node => {
            if (elem && node.dataset.id === elem.id) {
                node.classList.add('selected');
            } else {
                node.classList.remove('selected');
            }
        });
    }

    deselectElement() {
        this.selectedElement = null;
        document.querySelectorAll('.placed-element').forEach(node => {
            node.classList.remove('selected');
        });
    }

    placeSignature(dataUrl) {
        if (!this.elements[this.currentPage]) {
            this.elements[this.currentPage] = [];
        }

        // If replacing an existing signature via double click
        if (this.replacingElementId) {
            const target = this.elements[this.currentPage].find(e => e.id === this.replacingElementId);
            if (target) {
                target.dataUrl = dataUrl;
                this.renderAnnotations();
                this.selectElement(target);
                this.replacingElementId = null;
                showToast('Firma reemplazada correctamente.', 'success');
                return;
            }
        }

        const newElem = {
            id: 'elem_' + Date.now(),
            type: 'signature',
            dataUrl: dataUrl,
            x: 100,
            y: 100,
            width: 180,
            height: 80
        };

        this.elements[this.currentPage].push(newElem);
        this.saveHistoryState();
        this.renderAnnotations();
        this.selectElement(newElem);
        showToast('Firma colocada en la página actual.', 'success');
    }

    addTextToCurrentPage() {
        if (!this.elements[this.currentPage]) {
            this.elements[this.currentPage] = [];
        }

        const newElem = {
            id: 'elem_' + Date.now(),
            type: 'text',
            text: 'Escribe tu texto...',
            x: 100,
            y: 100,
            fontSize: 18,
            color: '#000000',
            width: 180,
            height: 40,
            bgWhite: false
        };

        this.elements[this.currentPage].push(newElem);
        this.saveHistoryState();
        this.renderAnnotations();
        this.selectElement(newElem);
        showToast('Texto añadido. Haz clic sobre él para ver los controles ("Fondo Blanco", A+, A-).', 'info');
    }

    addWhiteoutToCurrentPage() {
        if (!this.elements[this.currentPage]) {
            this.elements[this.currentPage] = [];
        }

        const newElem = {
            id: 'elem_' + Date.now(),
            type: 'whiteout',
            x: 100,
            y: 100,
            width: 160,
            height: 30
        };

        this.elements[this.currentPage].push(newElem);
        this.saveHistoryState();
        this.selectElement(newElem);
        showToast('Borrador (Tipex) añadido. Muévelo y ajústalo sobre el texto existente que desees borrar/cubrir.', 'success');
    }

    addShapeToCurrentPage(shapeType = 'rectangle') {
        if (!this.elements[this.currentPage]) {
            this.elements[this.currentPage] = [];
        }

        const newElem = {
            id: 'elem_' + Date.now(),
            type: 'shape',
            shapeType: shapeType,
            x: 120,
            y: 120,
            width: shapeType === 'circle' ? 100 : (shapeType === 'arrow' ? 160 : 140),
            height: shapeType === 'circle' ? 100 : (shapeType === 'arrow' ? 50 : 90),
            fillColor: shapeType === 'star' ? '#f59e0b' : 'transparent',
            strokeColor: '#000000',
            strokeWidth: 2
        };

        this.elements[this.currentPage].push(newElem);
        this.saveHistoryState();
        this.renderAnnotations();
        this.selectElement(newElem);
        showToast(`Figura (${shapeType}) añadida. Muévela y ajusta sus propiedades.`, 'success');
    }

    addTableToCurrentPage(rows = 3, cols = 3) {
        if (!this.elements[this.currentPage]) {
            this.elements[this.currentPage] = [];
        }

        const initialData = [];
        for (let r = 0; r < rows; r++) {
            const rowData = [];
            for (let c = 0; c < cols; c++) {
                if (r === 0) {
                    rowData.push(`Columna ${c + 1}`);
                } else {
                    rowData.push(`Dato ${r}-${c + 1}`);
                }
            }
            initialData.push(rowData);
        }

        const newElem = {
            id: 'elem_' + Date.now(),
            type: 'table',
            x: 100,
            y: 100,
            width: 320,
            height: 110,
            rows: rows,
            cols: cols,
            data: initialData,
            headerBg: '#1e293b'
        };

        this.elements[this.currentPage].push(newElem);
        this.saveHistoryState();
        this.renderAnnotations();
        this.selectElement(newElem);
        showToast('Tabla personalizada creada. Puedes editar sus celdas y filas/columnas.', 'success');
    }

    removeElement(id) {
        if (!this.elements[this.currentPage]) return;
        this.elements[this.currentPage] = this.elements[this.currentPage].filter(e => e.id !== id);
        if (this.selectedElement?.id === id) {
            this.selectedElement = null;
        }
        this.saveHistoryState();
        this.renderAnnotations();
    }

    changePage(delta) {
        let target = this.currentPage + delta;
        while (target >= 1 && target <= this.totalPages && this.deletedPages.has(target)) {
            target += delta;
        }
        if (target >= 1 && target <= this.totalPages) {
            this.goToPage(target);
        }
    }

    goToPage(pageNum) {
        this.currentPage = pageNum;
        this.renderCurrentPage();
    }

    setZoom(newZoom) {
        this.zoom = Math.min(2.5, Math.max(0.5, newZoom));
        this.renderCurrentPage();
    }

    rotateCurrentPage(degrees) {
        const currentRot = this.pageRotations[this.currentPage] || 0;
        this.pageRotations[this.currentPage] = (currentRot + degrees + 360) % 360;
        this.saveHistoryState();
        this.renderCurrentPage();
        this.renderThumbnails();
    }

    deleteCurrentPage() {
        if (this.totalPages - this.deletedPages.size <= 1) {
            showToast('No puedes eliminar la única página del PDF.', 'danger');
            return;
        }

        if (confirm(`¿Deseas eliminar la página ${this.currentPage}?`)) {
            this.deletedPages.add(this.currentPage);
            this.saveHistoryState();
            this.changePage(1);
            if (this.deletedPages.has(this.currentPage)) {
                this.changePage(-1);
            }
            this.renderThumbnails();
            showToast('Página eliminada.', 'info');
        }
    }

    async exportPDF() {
        if (!this.pdfBytes || this.pdfBytes.length === 0) {
            showToast('No se encontró el archivo PDF en memoria.', 'danger');
            return;
        }

        showToast('Generando PDF firmado...', 'info');

        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const pdfDoc = await PDFDocument.load(this.pdfBytes.slice(0), { ignoreEncryption: true });
            const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

            const numPages = pdfDoc.getPageCount();

            // Handle page deletions in reverse to maintain indices
            for (let i = numPages - 1; i >= 0; i--) {
                const pageNum = i + 1;
                if (this.deletedPages.has(pageNum)) {
                    pdfDoc.removePage(i);
                }
            }

            // Map remaining pages
            let activePageIndex = 0;
            for (let i = 0; i < numPages; i++) {
                const pageNum = i + 1;
                if (this.deletedPages.has(pageNum)) continue;

                const page = pdfDoc.getPage(activePageIndex);

                // Apply rotation if needed
                const rotationAngle = this.pageRotations[pageNum] || 0;
                if (rotationAngle !== 0) {
                    const currentAngle = page.getRotation().angle;
                    page.setRotation(window.PDFLib.degrees(currentAngle + rotationAngle));
                }

                // Get page dimensions in points
                const { width: pdfWidth, height: pdfHeight } = page.getSize();
                
                // Get rendered HTML viewport dimensions for this specific page
                let htmlWidth = pdfWidth;
                let htmlHeight = pdfHeight;
                try {
                    const pdfJsPage = await this.pdfDoc.getPage(pageNum);
                    const pageViewport = pdfJsPage.getViewport({ 
                        scale: 1.5 * this.zoom, 
                        rotation: (rotationAngle + pdfJsPage.rotate) % 360 
                    });
                    htmlWidth = pageViewport.width || pdfWidth;
                    htmlHeight = pageViewport.height || pdfHeight;
                } catch (vpErr) {
                    console.warn('Could not calculate exact viewport, fallback to pdf size:', vpErr);
                }

                // Handle Base PDF layer visibility
                if (!this.pdfLayerVisible) {
                    page.drawRectangle({
                        x: 0,
                        y: 0,
                        width: pdfWidth,
                        height: pdfHeight,
                        color: rgb(1, 1, 1),
                    });
                }

                // Embed freehand drawings if drawing layer is visible
                if (this.drawLayerVisible) {
                    const pageStrokes = this.drawings[pageNum] || [];
                    if (pageStrokes.length > 0) {
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = htmlWidth;
                        tempCanvas.height = htmlHeight;
                        const tempCtx = tempCanvas.getContext('2d');

                        pageStrokes.forEach(stroke => {
                            if (!stroke.points || stroke.points.length < 1) return;
                            tempCtx.beginPath();
                            tempCtx.strokeStyle = stroke.color;
                            tempCtx.lineWidth = stroke.size;
                            tempCtx.globalAlpha = stroke.opacity || 1.0;
                            tempCtx.lineCap = 'round';
                            tempCtx.lineJoin = 'round';

                            tempCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
                            for (let p = 1; p < stroke.points.length; p++) {
                                tempCtx.lineTo(stroke.points[p].x, stroke.points[p].y);
                            }
                            tempCtx.stroke();
                            tempCtx.globalAlpha = 1.0;
                        });

                        const drawDataUrl = tempCanvas.toDataURL('image/png');
                        const drawImgBytes = dataUrlToBytes(drawDataUrl);
                        if (drawImgBytes) {
                            const drawImg = await pdfDoc.embedPng(drawImgBytes);
                            page.drawImage(drawImg, {
                                x: 0,
                                y: 0,
                                width: pdfWidth,
                                height: pdfHeight
                            });
                        }
                    }
                }

                // Embed annotations/placed elements if not hidden
                const pageElems = this.elements[pageNum] || [];
                for (const elem of pageElems) {
                    if (!elem.hidden) {
                        await renderPlacedElementToPdfPage(pdfDoc, page, elem, pdfWidth, pdfHeight, htmlWidth, htmlHeight, helveticaFont);
                    }
                }

                activePageIndex++;
            }

            const modifiedPdfBytes = await pdfDoc.save();
            const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
            
            // Download file locally in browser
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `editado_${this.filename}`;
            link.click();

            showToast('¡PDF exportado y descargado exitosamente!', 'success');
        } catch (err) {
            console.error('Error al exportar PDF:', err);
            showToast(`Error al generar el PDF final: ${err.message || err}`, 'danger');
        }
    }

    async exportSplitPDF() {
        if (!this.pdfBytes || this.pdfBytes.length === 0) {
            showToast('No se encontró el archivo PDF en memoria.', 'danger');
            return;
        }

        showToast('Generando PDFs por páginas...', 'info');

        try {
            const { PDFDocument, rgb, StandardFonts } = window.PDFLib;
            const activePageNums = [];
            for (let i = 1; i <= this.totalPages; i++) {
                if (!this.deletedPages.has(i)) {
                    activePageNums.push(i);
                }
            }

            if (activePageNums.length === 0) {
                showToast('No hay páginas para exportar.', 'danger');
                return;
            }

            for (let idx = 0; idx < activePageNums.length; idx++) {
                const pageNum = activePageNums[idx];

                // Load source PDF to copy page
                const srcPdfDoc = await PDFDocument.load(this.pdfBytes.slice(0), { ignoreEncryption: true });
                const singleDoc = await PDFDocument.create();
                
                // Copy original page (0-indexed)
                const [copiedPage] = await singleDoc.copyPages(srcPdfDoc, [pageNum - 1]);
                singleDoc.addPage(copiedPage);

                const helveticaFont = await singleDoc.embedFont(StandardFonts.Helvetica);
                const page = singleDoc.getPage(0);

                // Apply rotation
                const rotationAngle = this.pageRotations[pageNum] || 0;
                if (rotationAngle !== 0) {
                    const currentAngle = page.getRotation().angle;
                    page.setRotation(window.PDFLib.degrees(currentAngle + rotationAngle));
                }

                // Get page dimensions in points
                const { width: pdfWidth, height: pdfHeight } = page.getSize();

                // Get rendered HTML viewport dimensions
                let htmlWidth = pdfWidth;
                let htmlHeight = pdfHeight;
                try {
                    const pdfJsPage = await this.pdfDoc.getPage(pageNum);
                    const pageViewport = pdfJsPage.getViewport({ 
                        scale: 1.5 * this.zoom, 
                        rotation: (rotationAngle + pdfJsPage.rotate) % 360 
                    });
                    htmlWidth = pageViewport.width || pdfWidth;
                    htmlHeight = pageViewport.height || pdfHeight;
                } catch (vpErr) {
                    console.warn('Fallback to pdf size:', vpErr);
                }

                // Handle Base PDF layer visibility
                if (!this.pdfLayerVisible) {
                    page.drawRectangle({
                        x: 0,
                        y: 0,
                        width: pdfWidth,
                        height: pdfHeight,
                        color: rgb(1, 1, 1),
                    });
                }

                // Embed freehand drawings if drawing layer is visible
                if (this.drawLayerVisible) {
                    const pageStrokes = this.drawings[pageNum] || [];
                    if (pageStrokes.length > 0) {
                        const tempCanvas = document.createElement('canvas');
                        tempCanvas.width = htmlWidth;
                        tempCanvas.height = htmlHeight;
                        const tempCtx = tempCanvas.getContext('2d');

                        pageStrokes.forEach(stroke => {
                            if (!stroke.points || stroke.points.length < 1) return;
                            tempCtx.beginPath();
                            tempCtx.strokeStyle = stroke.color;
                            tempCtx.lineWidth = stroke.size;
                            tempCtx.globalAlpha = stroke.opacity || 1.0;
                            tempCtx.lineCap = 'round';
                            tempCtx.lineJoin = 'round';

                            tempCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
                            for (let p = 1; p < stroke.points.length; p++) {
                                tempCtx.lineTo(stroke.points[p].x, stroke.points[p].y);
                            }
                            tempCtx.stroke();
                            tempCtx.globalAlpha = 1.0;
                        });

                        const drawDataUrl = tempCanvas.toDataURL('image/png');
                        const drawImgBytes = dataUrlToBytes(drawDataUrl);
                        if (drawImgBytes) {
                            const drawImg = await singleDoc.embedPng(drawImgBytes);
                            page.drawImage(drawImg, {
                                x: 0,
                                y: 0,
                                width: pdfWidth,
                                height: pdfHeight
                            });
                        }
                    }
                }

                // Embed annotations/placed elements if not hidden
                const pageElems = this.elements[pageNum] || [];
                for (const elem of pageElems) {
                    if (!elem.hidden) {
                        await renderPlacedElementToPdfPage(singleDoc, page, elem, pdfWidth, pdfHeight, htmlWidth, htmlHeight, helveticaFont);
                    }
                }

                const singlePdfBytes = await singleDoc.save();
                const blob = new Blob([singlePdfBytes], { type: 'application/pdf' });
                
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                const baseName = this.filename.replace(/\.pdf$/i, '');
                link.download = `pagina_${pageNum}_${baseName}.pdf`;
                link.click();

                // Small delay between downloads
                if (idx < activePageNums.length - 1) {
                    await new Promise(r => setTimeout(r, 250));
                }
            }

            showToast(`¡Exportadas ${activePageNums.length} páginas individualmente!`, 'success');
        } catch (err) {
            console.error('Error al exportar páginas:', err);
            showToast(`Error al exportar por páginas: ${err.message || err}`, 'danger');
        }
    }
}

// Helper Toast Notification
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'danger') icon = 'fa-exclamation-triangle';

    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

window.pdfEditor = new PDFEditor();
