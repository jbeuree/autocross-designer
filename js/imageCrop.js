// imageCrop.js — Corner handles for cropping / extending the background image (image mode only)

const ImageCrop = {
  _handleContainer: null,
  _handles: [],   // div elements for the four corners
  _preview: null, // dashed-rect preview shown while dragging

  init() {
    const container = document.getElementById('map');
    if (!container) return;

    // Overlay container sits in absolute space over the map div
    this._handleContainer = document.createElement('div');
    this._handleContainer.className = 'image-crop-handle-container';
    container.appendChild(this._handleContainer);

    // Drag preview element (dashed outline showing the new image bounds)
    this._preview = document.createElement('div');
    this._preview.className = 'image-crop-preview';
    this._preview.style.display = 'none';
    container.appendChild(this._preview);

    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const el = document.createElement('div');
      el.className = 'image-crop-handle';
      el.dataset.corner = corner;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      this._handleContainer.appendChild(el);
      this._setupDrag(el, corner);
      this._handles.push(el);
    }

    // Show handles on proximity, hide on leave
    const PROXIMITY = 40;
    container.addEventListener('mousemove', (e) => {
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      for (const el of this._handles) {
        if (el.classList.contains('dragging')) continue;
        const dist = Math.hypot(mx - (parseFloat(el.style.left) || 0), my - (parseFloat(el.style.top) || 0));
        const near = dist <= PROXIMITY;
        el.style.opacity = near ? '1' : '0';
        el.style.pointerEvents = near ? 'auto' : 'none';
      }
    });
    container.addEventListener('mouseleave', () => {
      for (const el of this._handles) {
        if (!el.classList.contains('dragging')) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        }
      }
    });

    const reposition = () => this._repositionHandles();
    if (ImageMap._loaded) {
      reposition();
    } else {
      ImageMap.on('load', reposition);
    }
    ImageMap.on('move', reposition);
    ImageMap.on('zoom', reposition);
  },

  // ── Handle positioning ───────────────────────────────────────────────────

  _repositionHandles() {
    const w = ImageMap._imageWidth;
    const h = ImageMap._imageHeight;
    const corners = { tl: [0, 0], tr: [w, 0], bl: [0, h], br: [w, h] };
    for (const el of this._handles) {
      const [ix, iy] = corners[el.dataset.corner];
      const pt = ImageMap.project({ lng: ix, lat: iy });
      el.style.left = pt.x + 'px';
      el.style.top  = pt.y + 'px';
    }
  },

  // ── Drag ────────────────────────────────────────────────────────────────

  _setupDrag(el, corner) {
    let startClientX, startClientY, origImgX, origImgY;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (typeof App !== 'undefined') App._setActiveTool('select');

      startClientX = e.clientX;
      startClientY = e.clientY;
      origImgX = corner.includes('r') ? ImageMap._imageWidth  : 0;
      origImgY = corner.includes('b') ? ImageMap._imageHeight : 0;

      el.classList.add('dragging');
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      this._showPreview(corner, origImgX, origImgY);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup',   onMouseUp);
    };

    const onMouseMove = (e) => {
      const dx = (e.clientX - startClientX) / ImageMap._scale;
      const dy = (e.clientY - startClientY) / ImageMap._scale;
      const pt = ImageMap.project({ lng: origImgX + dx, lat: origImgY + dy });
      el.style.left = pt.x + 'px';
      el.style.top  = pt.y + 'px';
      this._updatePreview(corner, origImgX + dx, origImgY + dy);
    };

    const onMouseUp = (e) => {
      el.classList.remove('dragging');
      this._hidePreview();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup',   onMouseUp);

      const screenDx = e.clientX - startClientX;
      const screenDy = e.clientY - startClientY;

      // Suppress any follow-on click on the map
      ImageMap._suppressNextClick = true;

      // Ignore very small drags (accidental clicks)
      if (Math.abs(screenDx) < 3 && Math.abs(screenDy) < 3) {
        this._repositionHandles();
        return;
      }

      const dx = screenDx / ImageMap._scale;
      const dy = screenDy / ImageMap._scale;
      this._applyResize(corner, Math.round(origImgX + dx), Math.round(origImgY + dy));
    };

    el.addEventListener('mousedown', onMouseDown);
  },

  // ── Preview ──────────────────────────────────────────────────────────────

  /**
   * Compute screen-space bounds from the four image corners, overriding
   * the dragged corner with the current drag position.
   */
  _getBoundsForPreview(corner, newImgX, newImgY) {
    const w = ImageMap._imageWidth;
    const h = ImageMap._imageHeight;
    let left = 0, top = 0, right = w, bottom = h;
    if      (corner === 'tl') { left  = newImgX; top    = newImgY; }
    else if (corner === 'tr') { right = newImgX; top    = newImgY; }
    else if (corner === 'bl') { left  = newImgX; bottom = newImgY; }
    else if (corner === 'br') { right = newImgX; bottom = newImgY; }
    // Enforce minimum size
    if (right - left < 10) { if (corner.includes('r')) right = left + 10; else left = right - 10; }
    if (bottom - top  < 10) { if (corner.includes('b')) bottom = top  + 10; else top  = bottom - 10; }
    const tl = ImageMap.project({ lng: left,  lat: top    });
    const br = ImageMap.project({ lng: right, lat: bottom });
    return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
  },

  _showPreview(corner, imgX, imgY) {
    if (!this._preview) return;
    this._updatePreview(corner, imgX, imgY);
    this._preview.style.display = '';
  },

  _updatePreview(corner, imgX, imgY) {
    if (!this._preview) return;
    const b = this._getBoundsForPreview(corner, imgX, imgY);
    this._preview.style.left   = b.x + 'px';
    this._preview.style.top    = b.y + 'px';
    this._preview.style.width  = b.w + 'px';
    this._preview.style.height = b.h + 'px';
  },

  _hidePreview() {
    if (this._preview) this._preview.style.display = 'none';
  },

  // ── Resize logic ─────────────────────────────────────────────────────────

  _applyResize(corner, newImgX, newImgY) {
    const w = ImageMap._imageWidth;
    const h = ImageMap._imageHeight;

    // Each corner controls its two adjacent edges
    let left = 0, top = 0, right = w, bottom = h;
    if      (corner === 'tl') { left  = newImgX; top    = newImgY; }
    else if (corner === 'tr') { right = newImgX; top    = newImgY; }
    else if (corner === 'bl') { left  = newImgX; bottom = newImgY; }
    else if (corner === 'br') { right = newImgX; bottom = newImgY; }

    // Enforce minimum 10 px in each dimension
    if (right - left < 10) {
      if (corner.includes('r')) right = left + 10; else left = right - 10;
    }
    if (bottom - top < 10) {
      if (corner.includes('b')) bottom = top + 10; else top = bottom - 10;
    }

    const newW = right - left;
    const newH = bottom - top;

    // Draw current background to a canvas for pixel sampling
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width  = w;
    srcCanvas.height = h;
    srcCanvas.getContext('2d').drawImage(ImageMap._bgCanvas || ImageMap._image, 0, 0);

    // Detect fill colour if extending beyond current bounds
    const isExtending = left < 0 || top < 0 || right > w || bottom > h;
    const fillColor   = isExtending
      ? this._detectBgColor(srcCanvas.getContext('2d'), w, h, left, top, right, bottom)
      : null;

    // Build new canvas
    const dst    = document.createElement('canvas');
    dst.width    = newW;
    dst.height   = newH;
    const dstCtx = dst.getContext('2d');
    if (fillColor) { dstCtx.fillStyle = fillColor; dstCtx.fillRect(0, 0, newW, newH); }
    dstCtx.drawImage(srcCanvas, -left, -top);

    // Apply to ImageMap (updates wrapper, line canvas, markers, pan offset)
    ImageMap.updateBackground(dst, left, top);

    // Sync stored coordinate arrays in every module
    const dx = -left;
    const dy = -top;
    if (dx !== 0 || dy !== 0) {
      this._translateAllData(dx, dy);
    }

    this._repositionHandles();
    if (typeof App !== 'undefined') App._updateInfo();
  },

  // ── Coordinate translation ────────────────────────────────────────────────

  _translateAllData(dx, dy) {
    const shift = (arr) => { if (Array.isArray(arr)) { arr[0] += dx; arr[1] += dy; } };

    if (typeof DrivingLine !== 'undefined') {
      for (const wp of DrivingLine.waypoints) shift(wp.lngLat);
      DrivingLine._updateLine();
    }
    if (typeof DrivingLine2 !== 'undefined') {
      for (const wp of DrivingLine2.waypoints) shift(wp.lngLat);
      DrivingLine2._updateLine();
    }
    // Extra optional driving lines
    if (typeof App !== 'undefined' && Array.isArray(App._extraDrivingLines)) {
      for (const line of App._extraDrivingLines) {
        for (const wp of line.waypoints) shift(wp.lngLat);
        line._updateLine();
      }
    }
    if (typeof Cones !== 'undefined') {
      for (const c of Cones.cones) shift(c.lngLat);
    }
    if (typeof Notes !== 'undefined') {
      for (const n of Notes.notes) shift(n.lngLat);
      // Pending first-click position
      if (Notes._pendingPoint) shift(Notes._pendingPoint);
    }
    if (typeof Obstacles !== 'undefined') {
      for (const o of Obstacles.obstacles) shift(o.lngLat);
    }
    if (typeof Workers !== 'undefined') {
      for (const s of Workers.stations) shift(s.lngLat);
    }
    if (typeof Measurements !== 'undefined') {
      for (const m of Measurements.measurements) {
        shift(m.points[0]);
        shift(m.points[1]);
      }
      if (Measurements._pendingPoint) shift(Measurements._pendingPoint);
      Measurements.updateAllLabels();
    }
    // CourseOutline handling removed
    if (typeof ImageLayers !== 'undefined') {
      for (const layer of ImageLayers._layers) {
        layer.lngLat = [layer.lngLat[0] + dx, layer.lngLat[1] + dy];
        ImageLayers._positionElement(layer);
      }
    }
    for (const ov of [
      typeof StatsOverlay !== 'undefined' ? StatsOverlay : null,
      typeof ScaleOverlay !== 'undefined' ? ScaleOverlay : null,
    ]) {
      if (!ov || !ov._pos) continue;
      ov._pos = [ov._pos[0] + dx, ov._pos[1] + dy];
      if (ov._el) {
        ov._el.style.left = ov._pos[0] + 'px';
        ov._el.style.top  = ov._pos[1] + 'px';
      }
    }
  },

  // ── Background colour detection ──────────────────────────────────────────

  /**
   * Sample pixels from the edges that are being extended and return
   * the most common quantised colour as a CSS rgb() string.
   */
  _detectBgColor(ctx, w, h, left, top, right, bottom) {
    const STRIP = Math.max(1, Math.min(10, Math.floor(Math.min(w, h) * 0.03)));
    const counts = new Map();

    const sampleRegion = (rx, ry, rw, rh) => {
      rw = Math.min(rw, w - rx);
      rh = Math.min(rh, h - ry);
      if (rw <= 0 || rh <= 0) return;
      const data = ctx.getImageData(rx, ry, rw, rh).data;
      for (let i = 0; i < data.length; i += 4) {
        // Exact 24-bit RGB key — no quantisation, no averaging
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    };

    // Only sample from the edge(s) that will be extended
    if (left  < 0) sampleRegion(0,          0,          STRIP, h);
    if (right > w) sampleRegion(w - STRIP,   0,          STRIP, h);
    if (top   < 0) sampleRegion(0,          0,          w,     STRIP);
    if (bottom > h) sampleRegion(0,          h - STRIP,  w,     STRIP);

    // Fallback: sample all four edges
    if (counts.size === 0) {
      sampleRegion(0, 0,          w, STRIP);
      sampleRegion(0, h - STRIP,  w, STRIP);
      sampleRegion(0, 0,          STRIP, h);
      sampleRegion(w - STRIP, 0,  STRIP, h);
    }

    let bestKey = 0, bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) { bestCount = count; bestKey = key; }
    }

    const r = (bestKey >> 16) & 0xff;
    const g = (bestKey >>  8) & 0xff;
    const b =  bestKey        & 0xff;
    return `rgb(${r},${g},${b})`;
  },
};
