// scaleOverlay.js — Draggable scale bar overlay

const ScaleOverlay = {
  _el: null,
  _canvas: null,
  _map: null,
  _mode: null,
  // Position: image pixels (image mode) or screen pixels relative to #map (map mode)
  _pos: [10, 10],

  // Layout constants (logical/CSS pixels)
  _BAR_W:   200,
  _BAR_H:   8,
  _PADDING: 6,
  _LABEL_H: 18,

  init(map, mode) {
    this._map = map;
    this._mode = mode;
    // Default: bottom-center (computed from container dimensions).
    // loadData() will override this when restoring a saved course.
    const barTotalW = this._BAR_W + this._PADDING * 2 + 12;  // ~224
    const barTotalH = this._LABEL_H + this._PADDING * 2 + this._BAR_H + 4; // ~42
    if (mode === 'image') {
      const w = ImageMap._imageWidth  || 800;
      const h = ImageMap._imageHeight || 600;
      this._pos = [Math.round((w - barTotalW) / 2), h - barTotalH - 10];
    } else {
      const rect = document.getElementById('map').getBoundingClientRect();
      this._pos = [Math.round((rect.width - barTotalW) / 2), rect.height - barTotalH - 10];
    }
    this._createElement();
    this.update();

    // Map mode: redraw label whenever zoom changes (meters-per-pixel changes)
    if (mode !== 'image') {
      map.on('move', () => this.update());
      map.on('zoom', () => this.update());
    }
  },

  /** Recompute and redraw the canvas element */
  update() {
    this._drawCanvas();
  },

  // ── Internals ────────────────────────────────────────────────────────────

  /** Returns { niceDist, adjustedBarW } or null if no scale is available */
  _getBarInfo() {
    let distFeet;
    if (this._mode === 'image') {
      if (typeof ImageMap === 'undefined' || !ImageMap.hasScale()) return null;
      distFeet = this._BAR_W * ImageMap.getScale();
    } else {
      if (typeof Grid === 'undefined') return null;
      const mpp = Grid._metersPerPixel();
      if (!mpp) return null;
      distFeet = this._BAR_W * mpp * 3.28084;
    }

    const niceValues = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    let niceDist = niceValues[0];
    for (const v of niceValues) {
      if (v <= distFeet) niceDist = v;
    }
    return { niceDist, adjustedBarW: this._BAR_W * (niceDist / distFeet) };
  },

  _drawCanvas() {
    if (!this._canvas) return;
    const info = this._getBarInfo();

    let canvasW, canvasH;
    if (!info) {
      canvasW = 100;
      canvasH = this._LABEL_H + this._PADDING * 2;
    } else {
      canvasW = Math.ceil(info.adjustedBarW + this._PADDING * 2 + 12);
      canvasH = this._LABEL_H + this._PADDING * 2 + this._BAR_H + 4;
    }

    this._canvas.width  = canvasW;
    this._canvas.height = canvasH;
    this._el.style.width  = canvasW + 'px';
    this._el.style.height = canvasH + 'px';

    const ctx = this._canvas.getContext('2d');
    ctx.clearRect(0, 0, canvasW, canvasH);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvasW, canvasH, 4);
    ctx.fill();

    if (!info) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No scale set', canvasW / 2, canvasH / 2);
      return;
    }

    const { niceDist, adjustedBarW } = info;
    const barX = this._PADDING + 6;
    const barY = this._LABEL_H + this._PADDING;
    const barH = this._BAR_H;

    ctx.fillStyle = '#fff';
    ctx.fillRect(barX, barY, adjustedBarW, barH);
    ctx.fillRect(barX, barY - 4, 2, barH + 4);
    ctx.fillRect(barX + adjustedBarW - 2, barY - 4, 2, barH + 4);
    ctx.fillRect(barX + adjustedBarW / 2 - 1, barY - 2, 2, barH + 2);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${niceDist} ft`, barX + adjustedBarW / 2, barY - 4);
  },

  /** Counter-scale the element in image mode so it stays a constant screen size */
  _updateScale() {
    // No-op: scale overlay intentionally scales with the background image.
  },

  // ── DOM ──────────────────────────────────────────────────────────────────

  _createElement() {
    const el = document.createElement('div');
    el.className = 'scale-overlay';
    el.style.left = this._pos[0] + 'px';
    el.style.top  = this._pos[1] + 'px';

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    el.appendChild(canvas);

    this._el     = el;
    this._canvas = canvas;
    this._setupDrag(el);

    if (this._mode === 'image') {
      const wrapper    = document.querySelector('.image-wrapper');
      const lineCanvas = wrapper && wrapper.querySelector('.image-line-canvas');
      if (lineCanvas) wrapper.insertBefore(el, lineCanvas);
      else if (wrapper) wrapper.appendChild(el);
    } else {
      el.style.zIndex = '20';
      document.getElementById('map').appendChild(el);
    }
  },

  // ── Drag ─────────────────────────────────────────────────────────────────

  _setupDrag(el) {
    let dragging = false;
    let startX, startY, startPosX, startPosY;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (typeof App !== 'undefined') App._setActiveTool('select');
      dragging  = true;
      startX    = e.clientX;
      startY    = e.clientY;
      startPosX = this._pos[0];
      startPosY = this._pos[1];
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (this._mode === 'image') {
        const scale = (typeof ImageMap !== 'undefined' ? ImageMap._scale : null) || 1;
        this._pos = [startPosX + dx / scale, startPosY + dy / scale];
      } else {
        this._pos = [startPosX + dx, startPosY + dy];
      }
      el.style.left = this._pos[0] + 'px';
      el.style.top  = this._pos[1] + 'px';
    };

    const onMouseUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
  },

  // ── Export ───────────────────────────────────────────────────────────────

  /**
   * Draw the scale bar onto the export canvas.
   * Called before ctx.restore() — ctx has translate(originOffsetX, originOffsetY) active.
   * Image mode: _pos is in image pixel coordinates, dpr=1.
   * Map mode:   originOffset=0 so translate is a no-op; _pos is screen pixels, scale by dpr.
   */
  drawOnCanvas(ctx, dpr, mode) {
    let distFeet;
    if (mode === 'image') {
      if (typeof ImageMap === 'undefined' || !ImageMap.hasScale()) return;
      distFeet = this._BAR_W * ImageMap.getScale();
    } else {
      if (typeof Grid === 'undefined') return;
      const mpp = Grid._metersPerPixel();
      if (!mpp) return;
      distFeet = this._BAR_W * mpp * 3.28084;
    }

    const niceValues = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    let niceDist = niceValues[0];
    for (const v of niceValues) {
      if (v <= distFeet) niceDist = v;
    }

    // s scales everything to physical canvas pixels
    const s              = mode === 'map' ? dpr : 1;
    const barWidthPx     = this._BAR_W * s;
    const adjustedBarW   = barWidthPx * (niceDist / distFeet);
    const x              = this._pos[0] * s;
    const y              = this._pos[1] * s;
    const padding        = this._PADDING * s;
    const labelH         = this._LABEL_H * s;
    const barH           = this._BAR_H * s;
    const barX           = x + padding + 6 * s;
    const barY           = y + labelH + padding;
    const totalW         = adjustedBarW + (this._PADDING * 2 + 12) * s;
    const totalH         = (this._LABEL_H + this._PADDING * 2 + this._BAR_H + 4) * s;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.beginPath();
    ctx.roundRect(x, y, totalW, totalH, 4 * s);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.fillRect(barX, barY, adjustedBarW, barH);
    ctx.fillRect(barX, barY - 4 * s, 2 * s, barH + 4 * s);
    ctx.fillRect(barX + adjustedBarW - 2 * s, barY - 4 * s, 2 * s, barH + 4 * s);
    ctx.fillRect(barX + adjustedBarW / 2 - s, barY - 2 * s, 2 * s, barH + 2 * s);

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${11 * s}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${niceDist} ft`, barX + adjustedBarW / 2, barY - 4 * s);
    ctx.restore();
  },

  // ── Visibility ───────────────────────────────────────────────────────────

  setVisible(visible) {
    if (this._el) this._el.style.display = visible ? '' : 'none';
  },

  // ── Persistence ──────────────────────────────────────────────────────────

  getData() {
    return { pos: this._pos.slice() };
  },

  loadData(data) {
    if (!data || !Array.isArray(data.pos)) return;
    this._pos = data.pos.slice();
    if (this._el) {
      this._el.style.left = this._pos[0] + 'px';
      this._el.style.top  = this._pos[1] + 'px';
    }
  },
};
