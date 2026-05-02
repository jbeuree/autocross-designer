// imageLayers.js — Draggable/resizable reference image overlays

const ImageLayers = {
  _layers: [],  // { id, src, lngLat, halfW, halfH, visible, el, label }
  _map: null,
  _mode: null,
  _nextId: 1,
  _mapContainer: null,  // dedicated container in #map (map mode only)

  init(map, mode) {
    this._map = map;
    this._mode = mode;
    this._layers = [];
    this._nextId = 1;
    this._mapContainer = null;

    if (mode === 'map') {
      // Insert a container right after .mapboxgl-canvas-container so overlays
      // appear above map tiles but below marker elements Mapbox appends after init.
      const mapEl = document.getElementById('map');
      const canvasContainer = mapEl.querySelector('.mapboxgl-canvas-container');
      this._mapContainer = document.createElement('div');
      this._mapContainer.style.cssText =
        'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;overflow:visible;';
      if (canvasContainer && canvasContainer.nextSibling) {
        mapEl.insertBefore(this._mapContainer, canvasContainer.nextSibling);
      } else {
        mapEl.appendChild(this._mapContainer);
      }

      map.on('move', () => this._repositionAll());
      map.on('zoom', () => this._repositionAll());
    }
    // In image mode, overlays live inside .image-wrapper and inherit its CSS
    // transform automatically — no repositioning needed on pan/zoom.
  },

  /**
   * Add a new image layer.
   * @param {string} src - data URL of the image
   * @param {string} label - display name for the layer list
   * @param {number} [naturalWidth] - image natural width (used for aspect ratio)
   * @param {number} [naturalHeight] - image natural height (used for aspect ratio)
   */
  add(src, label, naturalWidth, naturalHeight) {
    const id = this._nextId++;
    const ar = (naturalWidth && naturalHeight) ? naturalHeight / naturalWidth : 1;

    let lngLat, halfW, halfH;

    if (this._mode === 'image') {
      const iw = ImageMap._imageWidth || 800;
      halfW = iw / 4;
      halfH = halfW * ar;
      lngLat = [iw / 2, (ImageMap._imageHeight || 600) / 2];
    } else {
      // Center of the current viewport; initial size is ~300px wide
      const center = this._map.getCenter();
      lngLat = [center.lng, center.lat];
      const mapEl = document.getElementById('map');
      const rect = mapEl.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const tlGeo = this._map.unproject({ x: cx - 150, y: cy - 150 * ar });
      const brGeo = this._map.unproject({ x: cx + 150, y: cy + 150 * ar });
      halfW = Math.abs(brGeo.lng - tlGeo.lng) / 2;
      halfH = Math.abs(tlGeo.lat - brGeo.lat) / 2;
    }

    const layer = {
      id,
      src,
      lngLat,
      halfW,
      halfH,
      visible: true,
      el: null,
      label: label || `Image ${id}`,
    };

    this._createElement(layer);
    this._layers.push(layer);

    if (typeof Layers !== 'undefined') {
      Layers.addImageLayer(id, layer.label);
    }

    return layer;
  },

  _createElement(layer) {
    const el = document.createElement('div');
    el.className = 'image-layer-overlay';
    el.dataset.layerId = layer.id;

    const img = document.createElement('img');
    img.src = layer.src;
    img.draggable = false;
    el.appendChild(img);

    // Bottom-right resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'image-layer-resize-handle';
    el.appendChild(resizeHandle);

    // Top-right delete button
    const deleteBtn = document.createElement('div');
    deleteBtn.className = 'image-layer-delete-btn';
    deleteBtn.textContent = '\u00D7';
    el.appendChild(deleteBtn);

    layer.el = el;

    this._setupDrag(el, layer);
    this._setupResize(resizeHandle, layer);

    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove(layer.id);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.remove(layer.id);
    });

    // Insert into the correct container
    if (this._mode === 'image') {
      // Place below the line canvas and marker container so cones/lines stay on top
      const wrapper = document.querySelector('.image-wrapper');
      const lineCanvas = wrapper && wrapper.querySelector('.image-line-canvas');
      if (lineCanvas) {
        wrapper.insertBefore(el, lineCanvas);
      } else {
        const markerContainer = wrapper && wrapper.querySelector('.image-marker-container');
        if (markerContainer) {
          wrapper.insertBefore(el, markerContainer);
        } else if (wrapper) {
          wrapper.appendChild(el);
        }
      }
    } else {
      // Append to the dedicated container between the Mapbox canvas and markers.
      if (this._mapContainer) {
        this._mapContainer.appendChild(el);
      } else {
        document.getElementById('map').appendChild(el);
      }
    }

    this._positionElement(layer);
  },

  /** Set element position/size from the layer's coordinate data */
  _positionElement(layer) {
    if (!layer.el) return;

    if (this._mode === 'image') {
      // Coordinates are image pixels; .image-wrapper's CSS transform handles pan/zoom
      layer.el.style.left   = (layer.lngLat[0] - layer.halfW) + 'px';
      layer.el.style.top    = (layer.lngLat[1] - layer.halfH) + 'px';
      layer.el.style.width  = (layer.halfW * 2) + 'px';
      layer.el.style.height = (layer.halfH * 2) + 'px';
    } else {
      // Project geographic corners to screen pixels within #map
      const tl = this._map.project({ lng: layer.lngLat[0] - layer.halfW, lat: layer.lngLat[1] + layer.halfH });
      const br = this._map.project({ lng: layer.lngLat[0] + layer.halfW, lat: layer.lngLat[1] - layer.halfH });
      layer.el.style.left   = tl.x + 'px';
      layer.el.style.top    = tl.y + 'px';
      layer.el.style.width  = Math.max(10, br.x - tl.x) + 'px';
      layer.el.style.height = Math.max(10, br.y - tl.y) + 'px';
    }
  },

  /** Reproject all overlays (called on map move/zoom in map mode) */
  _repositionAll() {
    for (const layer of this._layers) {
      this._positionElement(layer);
    }
  },

  /** Rename a layer by id */
  renameLayer(id, label) {
    const layer = this._layers.find(l => l.id === id);
    if (!layer) return;
    layer.label = label;
  },

  /** Set up drag-to-move on the overlay element */
  _setupDrag(el, layer) {
    let dragging = false;
    let startX, startY;
    let startLngLat;

    const onMouseDown = (e) => {
      if (e.target.classList.contains('image-layer-resize-handle')) return;
      if (e.target.classList.contains('image-layer-delete-btn')) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (typeof App !== 'undefined') App._setActiveTool('select');
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startLngLat = layer.lngLat.slice();
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (this._mode === 'image') {
        const scale = ImageMap._scale || 1;
        layer.lngLat = [startLngLat[0] + dx / scale, startLngLat[1] + dy / scale];
      } else {
        // Convert pixel delta to geographic delta via project/unproject
        const origScreen = this._map.project({ lng: startLngLat[0], lat: startLngLat[1] });
        const newPt = this._map.unproject({ x: origScreen.x + dx, y: origScreen.y + dy });
        layer.lngLat = [newPt.lng, newPt.lat];
      }
      this._positionElement(layer);
    };

    const onMouseUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    el.addEventListener('mousedown', onMouseDown);
  },

  /** Set up drag-to-resize on the bottom-right corner handle */
  _setupResize(handle, layer) {
    let resizing = false;
    let startX, startY;
    let startHalfW, startHalfH, startAR;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      if (typeof App !== 'undefined') App._setActiveTool('select');
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startHalfW = layer.halfW;
      startHalfH = layer.halfH;
      startAR = layer.halfH / layer.halfW;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (this._mode === 'image') {
        const scale = ImageMap._scale || 1;
        let newHalfW = Math.max(10, startHalfW + dx / scale);
        let newHalfH = Math.max(10, startHalfH + dy / scale);
        if (e.shiftKey) {
          // Drive from whichever axis moved more
          if (Math.abs(dx) >= Math.abs(dy)) {
            newHalfH = newHalfW * startAR;
          } else {
            newHalfW = newHalfH / startAR;
          }
        }
        layer.halfW = newHalfW;
        layer.halfH = newHalfH;
      } else {
        // Move the bottom-right geographic corner
        const origBR = { lng: layer.lngLat[0] + startHalfW, lat: layer.lngLat[1] - startHalfH };
        const origBRScreen = this._map.project(origBR);
        const newBR = this._map.unproject({ x: origBRScreen.x + dx, y: origBRScreen.y + dy });
        let newHalfW = Math.max(1e-6, Math.abs(newBR.lng - layer.lngLat[0]));
        let newHalfH = Math.max(1e-6, Math.abs(layer.lngLat[1] - newBR.lat));
        if (e.shiftKey) {
          if (Math.abs(dx) >= Math.abs(dy)) {
            newHalfH = newHalfW * startAR;
          } else {
            newHalfW = newHalfH / startAR;
          }
        }
        layer.halfW = newHalfW;
        layer.halfH = newHalfH;
      }
      this._positionElement(layer);
    };

    const onMouseUp = () => {
      resizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', onMouseDown);
  },

  /** Remove a layer by id */
  remove(id) {
    const idx = this._layers.findIndex(l => l.id === id);
    if (idx === -1) return;
    const layer = this._layers[idx];
    if (layer.el && layer.el.parentNode) {
      layer.el.parentNode.removeChild(layer.el);
    }
    this._layers.splice(idx, 1);
    if (typeof Layers !== 'undefined') {
      Layers.removeImageLayer(id);
    }
  },

  /** Show or hide a layer */
  setVisible(id, visible) {
    const layer = this._layers.find(l => l.id === id);
    if (!layer) return;
    layer.visible = visible;
    if (layer.el) {
      layer.el.style.display = visible ? '' : 'none';
    }
  },

  /** Serialize layer data for save/export */
  getData() {
    return this._layers.map(l => ({
      id: l.id,
      src: l.src,
      lngLat: l.lngLat.slice(),
      halfW: l.halfW,
      halfH: l.halfH,
      visible: l.visible,
      label: l.label,
    }));
  },

  /** Restore layers from saved data */
  loadData(data) {
    // Remove all existing image layers first
    for (const layer of this._layers.slice()) {
      this.remove(layer.id);
    }
    for (const d of data) {
      const layer = {
        id: d.id,
        src: d.src,
        lngLat: d.lngLat.slice(),
        halfW: d.halfW,
        halfH: d.halfH,
        visible: d.visible !== false,
        el: null,
        label: d.label || `Image ${d.id}`,
      };
      this._nextId = Math.max(this._nextId, d.id + 1);
      this._createElement(layer);
      this._layers.push(layer);
      if (typeof Layers !== 'undefined') {
        Layers.addImageLayer(layer.id, layer.label);
      }
      if (!layer.visible && layer.el) {
        layer.el.style.display = 'none';
      }
    }
  },
};
