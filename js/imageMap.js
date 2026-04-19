// imageMap.js — Fake map adapter (ImageMap) + ImageMarker for image mode

/**
 * ImageMarker — drop-in replacement for mapboxgl.Marker in image mode.
 * Positions an element inside the image wrapper using CSS left/top.
 * Supports dragging, setLngLat/getLngLat (using image pixel coords),
 * addTo, remove, getElement, and on('dragend').
 */
class ImageMarker {
  constructor(opts = {}) {
    this._element = opts.element || document.createElement('div');
    this._draggable = opts.draggable || false;
    this._lngLat = null;       // image pixel coords [x, y]
    this._map = null;
    this._dragCallbacks = [];
    this._added = false;

    // Wrapper div for positioning inside the image wrapper
    this._container = document.createElement('div');
    this._container.style.position = 'absolute';
    this._container.style.pointerEvents = 'auto';
    this._container.style.transform = 'translate(-50%, -50%)';
    this._container.appendChild(this._element);

    if (this._draggable) {
      this._setupDrag();
    }
  }

  setLngLat(coords) {
    if (Array.isArray(coords)) {
      this._lngLat = { lng: coords[0], lat: coords[1] };
    } else {
      this._lngLat = { lng: coords.lng, lat: coords.lat };
    }
    this._updatePosition();
    return this;
  }

  getLngLat() {
    return this._lngLat ? { lng: this._lngLat.lng, lat: this._lngLat.lat } : null;
  }

  addTo(map) {
    this._map = map;
    if (map._markerContainer) {
      map._markerContainer.appendChild(this._container);
    }
    if (map._markers) {
      map._markers.push(this);
    }
    this._added = true;
    this._updatePosition();
    return this;
  }

  remove() {
    if (this._container.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    if (this._map && this._map._markers) {
      const idx = this._map._markers.indexOf(this);
      if (idx !== -1) this._map._markers.splice(idx, 1);
    }
    this._added = false;
    return this;
  }

  getElement() {
    return this._element;
  }

  on(event, callback) {
    if (event === 'dragend') {
      this._dragCallbacks.push(callback);
    }
    return this;
  }

  _updatePosition() {
    if (!this._lngLat) return;
    // Position in image pixel coordinates — the wrapper's CSS transform handles pan/zoom
    this._container.style.left = this._lngLat.lng + 'px';
    this._container.style.top = this._lngLat.lat + 'px';
    // Counter-scale so markers stay a constant screen size regardless of zoom
    // const scale = this._map ? (this._map._scale || 1) : 1;
    const scale = 2;
    this._container.style.transform = `translate(-50%, -50%) scale(${1/scale})`;
  }

  _setupDrag() {
    let dragging = false;
    let startX, startY;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      e.stopPropagation();
      dragging = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    };

    const onMouseMove = (e) => {
      if (!dragging || !this._map) return;
      const scale = this._map._scale || 1;
      const dx = (e.clientX - startX) / scale;
      const dy = (e.clientY - startY) / scale;
      startX = e.clientX;
      startY = e.clientY;
      this._lngLat.lng += dx;
      this._lngLat.lat += dy;
      this._updatePosition();
    };

    const onTouchMove = (e) => {
      if (!dragging || !this._map || e.touches.length !== 1) return;
      e.preventDefault();
      const scale = this._map._scale || 1;
      const dx = (e.touches[0].clientX - startX) / scale;
      const dy = (e.touches[0].clientY - startY) / scale;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      this._lngLat.lng += dx;
      this._lngLat.lat += dy;
      this._updatePosition();
    };

    const onMouseUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this._fireDragEnd();
    };

    const onTouchEnd = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      this._fireDragEnd();
    };

    this._element.addEventListener('mousedown', onMouseDown);
    this._element.addEventListener('touchstart', onTouchStart, { passive: false });
  }

  _fireDragEnd() {
    for (const cb of this._dragCallbacks) {
      cb();
    }
  }
}


/**
 * ImageMap — fake map adapter that exposes the same API surface as mapboxgl.Map.
 * Coordinates are [x, y] image pixels instead of [lng, lat].
 * Pan/zoom is handled via CSS transforms on a wrapper div.
 */
const ImageMap = {
  _container: null,
  _wrapper: null,         // inner div that gets transformed (holds image + markers)
  _markerContainer: null, // child of _wrapper for marker elements
  _lineCanvas: null,      // canvas overlay for driving line
  _image: null,
  _markers: [],           // all ImageMarkers added to this map
  _scale: 1,
  _offsetX: 0,
  _offsetY: 0,
  _imageWidth: 0,
  _imageHeight: 0,
  _listeners: {},
  _sources: {},
  _layers: {},
  _loaded: false,
  _feetPerPixel: 0,      // calibrated scale (0 = not set)
  _suppressNextClick: false,

  /**
   * Initialize image mode in the given container with the given image src.
   * Returns a reference to this (for compatibility).
   */
  init(containerId, imageSrc) {
    this._container = document.getElementById(containerId);
    this._container.classList.add('image-mode');
    this._container.innerHTML = '';

    this._listeners = {};
    this._sources = {};
    this._layers = {};
    this._markers = [];
    this._scale = 1;
    this._offsetX = 0;
    this._offsetY = 0;

    // Create wrapper (transformed for pan/zoom)
    this._wrapper = document.createElement('div');
    this._wrapper.className = 'image-wrapper';
    this._container.appendChild(this._wrapper);

    // Create line canvas (inside wrapper, above image, below markers)
    this._lineCanvas = document.createElement('canvas');
    this._lineCanvas.className = 'image-line-canvas';
    this._wrapper.appendChild(this._lineCanvas);

    // Create marker container (inside wrapper)
    this._markerContainer = document.createElement('div');
    this._markerContainer.className = 'image-marker-container';
    this._wrapper.appendChild(this._markerContainer);

    // Load image
    this._image = new Image();
    this._image.onerror = () => {
      console.error('ImageMap: Failed to load image:', imageSrc);
      alert('Failed to load image: ' + imageSrc);
    };
    this._image.onload = () => {
      this._imageWidth = this._image.naturalWidth;
      this._imageHeight = this._image.naturalHeight;

      this._wrapper.style.width = this._imageWidth + 'px';
      this._wrapper.style.height = this._imageHeight + 'px';
      // Quote the URL to handle spaces and special characters in filenames
      this._wrapper.style.backgroundImage = `url("${this._image.src}")`;
      this._wrapper.style.backgroundSize = 'cover';

      this._lineCanvas.width = this._imageWidth;
      this._lineCanvas.height = this._imageHeight;

      // Center the image in the viewport
      const containerRect = this._container.getBoundingClientRect();
      const scaleX = containerRect.width / this._imageWidth;
      const scaleY = containerRect.height / this._imageHeight;
      this._scale = Math.min(scaleX, scaleY) * 0.9;
      this._offsetX = (containerRect.width - this._imageWidth * this._scale) / 2;
      this._offsetY = (containerRect.height - this._imageHeight * this._scale) / 2;
      this._applyTransform();

      this._loaded = true;
      this.fire('load');
    };
    this._image.src = imageSrc;

    this._setupPanZoom();
    this._setupClickEvents();

    // Handle window resize
    window.addEventListener('resize', () => {
      this.fire('resize');
    });

    return this;
  },

  /** Apply CSS transform to wrapper */
  _applyTransform() {
    this._wrapper.style.transform =
      `translate(${this._offsetX}px, ${this._offsetY}px) scale(${this._scale})`;
    this._wrapper.style.transformOrigin = '0 0';
    // Update all markers so they counter-scale to stay constant screen size
    for (const marker of this._markers) {
      marker._updatePosition();
    }
  },

  /** Set up pan (drag) and zoom (wheel) handlers on the container */
  _setupPanZoom() {
    let panning = false;
    let startX, startY;
    let totalDragDist = 0;

    this._container.addEventListener('mousedown', (e) => {
      // Only pan if left button and not on a marker
      if (e.button !== 0) return;
      if (e.target.closest('.cone-marker, .waypoint-marker, .note-marker, .arrow-marker, .obstacle-marker, .worker-marker, .measurement-endpoint, .measurement-label')) return;
      panning = true;
      totalDragDist = 0;
      startX = e.clientX;
      startY = e.clientY;
    });

    document.addEventListener('mousemove', (e) => {
      if (!panning) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      totalDragDist += Math.abs(dx) + Math.abs(dy);
      this._offsetX += dx;
      this._offsetY += dy;
      startX = e.clientX;
      startY = e.clientY;
      this._applyTransform();
      this.fire('move');
    });

    document.addEventListener('mouseup', () => {
      if (panning) {
        // If dragged more than a few pixels, suppress the upcoming click
        if (totalDragDist > 4) {
          this._suppressNextClick = true;
        }
        panning = false;
      }
    });

    // Touch pan
    let touchStartX, touchStartY;
    this._container.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (e.target.closest('.cone-marker, .waypoint-marker, .note-marker, .arrow-marker, .obstacle-marker, .worker-marker, .measurement-endpoint, .measurement-label')) return;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }, { passive: true });

    this._container.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 1) return;
      if (e.target.closest('.cone-marker, .waypoint-marker, .note-marker, .arrow-marker, .obstacle-marker, .worker-marker, .measurement-endpoint, .measurement-label')) return;
      const dx = e.touches[0].clientX - touchStartX;
      const dy = e.touches[0].clientY - touchStartY;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      this._offsetX += dx;
      this._offsetY += dy;
      this._applyTransform();
      this.fire('move');
    }, { passive: true });

    // Wheel zoom
    this._container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this._container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Zoom towards mouse position
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.05, Math.min(20, this._scale * zoomFactor));

      // Adjust offset so the point under cursor stays fixed
      this._offsetX = mouseX - (mouseX - this._offsetX) * (newScale / this._scale);
      this._offsetY = mouseY - (mouseY - this._offsetY) * (newScale / this._scale);
      this._scale = newScale;

      this._applyTransform();
      this.fire('move');
      this.fire('zoom');
    }, { passive: false });
  },

  /** Set up click and mousemove events that convert to image pixel coordinates */
  _setupClickEvents() {
    this._container.addEventListener('click', (e) => {
      if (this._suppressNextClick) {
        this._suppressNextClick = false;
        return;
      }
      if (e.target.closest('.cone-marker, .waypoint-marker, .note-marker, .arrow-marker, .obstacle-marker, .worker-marker, .measurement-endpoint, .measurement-label')) return;
      const coords = this._screenToImage(e.clientX, e.clientY);
      this.fire('click', {
        lngLat: { lng: coords[0], lat: coords[1] },
        point: { x: e.clientX, y: e.clientY },
      });
    });

    this._container.addEventListener('mousemove', (e) => {
      const coords = this._screenToImage(e.clientX, e.clientY);
      this.fire('mousemove', {
        lngLat: { lng: coords[0], lat: coords[1] },
        point: { x: e.clientX, y: e.clientY },
      });
    });
  },

  /** Convert screen coordinates to image pixel coordinates */
  _screenToImage(clientX, clientY) {
    const rect = this._container.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const imgX = (sx - this._offsetX) / this._scale;
    const imgY = (sy - this._offsetY) / this._scale;
    return [imgX, imgY];
  },

  /** Convert image pixel coords to screen coords — matches mapboxgl.Map.project() */
  project(coords) {
    let x, y;
    if (Array.isArray(coords)) {
      x = coords[0];
      y = coords[1];
    } else if (coords.lng !== undefined) {
      x = coords.lng;
      y = coords.lat;
    } else {
      x = coords.x || 0;
      y = coords.y || 0;
    }
    const rect = this._container.getBoundingClientRect();
    return {
      x: x * this._scale + this._offsetX,
      y: y * this._scale + this._offsetY,
    };
  },

  /** Convert screen coords to image pixel coords — matches mapboxgl.Map.unproject() */
  unproject(point) {
    const imgX = (point.x - this._offsetX) / this._scale;
    const imgY = (point.y - this._offsetY) / this._scale;
    return { lng: imgX, lat: imgY };
  },

  // --- Event system ---
  on(event, callback) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(callback);
    return this;
  },

  off(event, callback) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
  },

  fire(event, data) {
    const cbs = this._listeners[event];
    if (cbs) {
      for (const cb of cbs) cb(data);
    }
  },

  // --- Map API stubs ---
  getCanvas() {
    // Render image + line canvas to a result canvas
    const canvas = document.createElement('canvas');
    canvas.width = this._imageWidth;
    canvas.height = this._imageHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this._image, 0, 0);
    // Draw the line canvas on top
    if (this._lineCanvas) {
      ctx.drawImage(this._lineCanvas, 0, 0);
    }
    return canvas;
  },

  getCenter() {
    const cx = this._imageWidth / 2;
    const cy = this._imageHeight / 2;
    return {
      lng: cx,
      lat: cy,
      toArray() { return [cx, cy]; },
    };
  },

  getZoom() {
    return Math.log2(this._scale) + 17; // offset to roughly match mapbox zoom levels
  },

  getBearing() {
    return 0;
  },

  loaded() {
    return this._loaded;
  },

  // --- GeoJSON source/layer stubs ---
  addSource(id, config) {
    this._sources[id] = {
      _data: config.data || null,
      setData: (data) => {
        this._sources[id]._data = data;
        this._redrawLineCanvas();
      },
    };
    // Redraw if initial data has features
    if (config.data && config.data.features && config.data.features.length > 0) {
      this._redrawLineCanvas();
    }
  },

  getSource(id) {
    return this._sources[id] || null;
  },

  addLayer(config) {
    this._layers[config.id] = config;
  },

  removeLayer(id) {
    delete this._layers[id];
  },

  removeSource(id) {
    delete this._sources[id];
  },

  setPaintProperty(layerId, prop, value) {
    // Stub for compatibility — image mode lines are SVG-based
  },

  /** Set the calibrated scale: feet per image pixel */
  setScale(feetPerPixel) {
    this._feetPerPixel = feetPerPixel;
  },

  /** Get the calibrated scale (0 if not set) */
  getScale() {
    return this._feetPerPixel;
  },

  /** Whether scale has been calibrated */
  hasScale() {
    return this._feetPerPixel > 0;
  },

  /** Redraw driving line spline on the line canvas */
  _redrawLineCanvas() {
    if (!this._lineCanvas) return;
    const ctx = this._lineCanvas.getContext('2d');
    ctx.clearRect(0, 0, this._lineCanvas.width, this._lineCanvas.height);

    const lineSources = [
      { sourceId: 'driving-line-source',  color: '#060707' },
      { sourceId: 'driving-line2-source', color: '#060707' },
    ];

    for (const { sourceId, color } of lineSources) {
      const src = this._sources[sourceId];
      if (!src || !src._data || !src._data.features) continue;

      for (const feature of src._data.features) {
        if (feature.geometry && feature.geometry.type === 'LineString') {
          const coords = feature.geometry.coordinates;
          if (coords.length < 2) continue;

          ctx.beginPath();
          ctx.moveTo(coords[0][0], coords[0][1]);
          for (let i = 1; i < coords.length; i++) {
            ctx.lineTo(coords[i][0], coords[i][1]);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash([6, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  },
};
