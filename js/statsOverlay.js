// statsOverlay.js — Draggable stats box (cone count + driving line length)

const StatsOverlay = {
  _el: null,
  _map: null,
  _mode: null,
  // Position:
  //   image mode — image pixel coordinates (same convention as cones / image layers)
  //   map mode   — screen pixel coordinates relative to top-left of #map
  _pos: [10, 10],
  _coneCount: 0,
  _lineLen: 0,       // negative means unavailable; 0 means no line; >0 is feet

  init(map, mode) {
    this._map = map;
    this._mode = mode;
    this._createElement();
  },

  /** (Re)compute stats and refresh the visible element */
  update() {
    this._coneCount = typeof Cones !== 'undefined' ? Cones.count() : 0;
    if (typeof Distance !== 'undefined' && typeof DrivingLine !== 'undefined') {
      this._lineLen = Distance.totalLength(DrivingLine.waypoints);
    }
    this._renderContent();
  },

  // ── DOM ─────────────────────────────────────────────────────────────────

  _createElement() {
    const el = document.createElement('div');
    el.className = 'stats-overlay';
    this._el = el;
    this._renderContent();
    this._setupDrag(el);

    el.style.left = this._pos[0] + 'px';
    el.style.top  = this._pos[1] + 'px';

    if (this._mode === 'image') {
      // Place before .image-line-canvas so cones / lines stay on top
      const wrapper = document.querySelector('.image-wrapper');
      const lineCanvas = wrapper && wrapper.querySelector('.image-line-canvas');
      if (lineCanvas) {
        wrapper.insertBefore(el, lineCanvas);
      } else if (wrapper) {
        wrapper.appendChild(el);
      }
    } else {
      // Float above the map; high z-index keeps it above Mapbox elements
      el.style.zIndex = '20';
      document.getElementById('map').appendChild(el);
    }
  },

  _renderContent() {
    if (!this._el) return;
    const lineText = this._lineLen > 0
      ? `${this._lineLen.toFixed(0)} ft`
      : (this._lineLen < 0 ? 'N/A' : '--');
    this._el.innerHTML =
      `<div>Length: ${lineText}</div><div>Cones: ${this._coneCount}</div>`;
  },

  /** Counter-scale the element so it stays a constant screen size in image mode */
  _updateScale() {
    // No-op: stats overlay intentionally scales with the background image.
  },

  // ── Drag ────────────────────────────────────────────────────────────────

  _setupDrag(el) {
    let dragging = false;
    let startX, startY, startPosX, startPosY;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (typeof App !== 'undefined') App._setActiveTool('select');
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startPosX = this._pos[0];
      startPosY = this._pos[1];
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
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
      document.removeEventListener('mouseup', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
  },

  // ── Export ──────────────────────────────────────────────────────────────

  /**
   * Draw the stats box onto the export canvas.
   *
   * For image mode:  called while ctx has translate(originOffsetX, originOffsetY)
   *   active, so _pos (image pixel coords) maps directly.
   * For map mode:    called after ctx.restore() (absolute canvas space), so
   *   multiply _pos by dpr.
   */
  drawOnCanvas(ctx, dpr, mode) {
    const lineText = this._lineLen > 0
      ? `${this._lineLen.toFixed(0)} ft`
      : (this._lineLen < 0 ? 'N/A' : '--');
    const lines = [
      `Length: ${lineText}`,
      `Cones: ${this._coneCount}`,
    ];

    // In map mode scale all dimensions by dpr; image mode dpr is always 1
    const s         = mode === 'map' ? dpr : 1;
    const padding    = 8  * s;
    const lineHeight = 16 * s;
    const fontSize   = 13 * s;
    const boxW       = 110 * s;
    const boxH       = padding * 2 + lineHeight * lines.length;
    const x = this._pos[0] * (mode === 'map' ? dpr : 1);
    const y = this._pos[1] * (mode === 'map' ? dpr : 1);

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, 4 * s);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((line, i) => {
      ctx.fillText(line, x + padding, y + padding + lineHeight * i + lineHeight / 2);
    });
    ctx.restore();
  },

  // ── Visibility ──────────────────────────────────────────────────────────

  setVisible(visible) {
    if (this._el) this._el.style.display = visible ? '' : 'none';
  },

  // ── Persistence ─────────────────────────────────────────────────────────

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
