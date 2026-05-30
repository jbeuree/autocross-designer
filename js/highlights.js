// highlights.js — Highlight area drawing tool

const Highlights = {
  _areas: [],           // completed areas: { id, label, vertices, visible, _markers, _sourceId, _layerId, _outlineLayerId }
  _currentVertices: [], // [[lng, lat], ...] for the area being drawn
  _currentMarkers: [],  // marker instances for in-progress vertices
  _nextId: 1,
  _map: null,
  _mode: 'map',
  _onUpdate: null,
  _previewSourceId: 'highlight-preview-source',
  _previewLayerId: 'highlight-preview-layer',

  init(map, mode, { onUpdate } = {}) {
    this._map = map;
    this._mode = mode;
    this._onUpdate = onUpdate || null;

    if (mode === 'map') {
      const setup = () => {
        if (map.getSource(this._previewSourceId)) return;
        map.addSource(this._previewSourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });
        map.addLayer({
          id: this._previewLayerId,
          type: 'line',
          source: this._previewSourceId,
          paint: {
            'line-color': 'rgba(130,130,130,0.8)',
            'line-width': 1.5,
            'line-dasharray': [4, 3],
          },
        }, this._getBeforeLayerId(map));
      };
      if (map.loaded()) { setup(); } else { map.on('load', setup); }
    }
  },

  /** Return the Mapbox layer ID to insert before, so highlights render below driving lines */
  _getBeforeLayerId(map) {
    try {
      if (map.getLayer('driving-line-layer')) return 'driving-line-layer';
    } catch (e) {}
    return undefined;
  },

  /** Add a vertex to the in-progress polygon.
   *  screenPoint is {x, y} from the map click event (e.point). */
  addVertex(lngLat, screenPoint) {
    const coords = [lngLat.lng, lngLat.lat];

    // Check proximity to first vertex to close the polygon (requires >= 3 vertices)
    if (this._currentVertices.length >= 3 && screenPoint && this._currentMarkers.length > 0) {
      const firstEl = this._currentMarkers[0].getElement();
      const firstRect = firstEl.getBoundingClientRect();
      const markerCX = firstRect.left + firstRect.width / 2;
      const markerCY = firstRect.top + firstRect.height / 2;

      // Convert click point to screen coords (map mode uses canvas-relative; image mode uses clientX/Y)
      let clickScreenX, clickScreenY;
      if (this._mode === 'map') {
        try {
          const canvasRect = this._map.getCanvas().getBoundingClientRect();
          clickScreenX = canvasRect.left + screenPoint.x;
          clickScreenY = canvasRect.top + screenPoint.y;
        } catch (e) {
          clickScreenX = screenPoint.x;
          clickScreenY = screenPoint.y;
        }
      } else {
        clickScreenX = screenPoint.x;
        clickScreenY = screenPoint.y;
      }

      const dx = clickScreenX - markerCX;
      const dy = clickScreenY - markerCY;
      if (Math.sqrt(dx * dx + dy * dy) <= 20) {
        this._finalizeArea();
        return;
      }
    }

    // Place a dot marker for this vertex
    const el = document.createElement('div');
    el.className = 'waypoint-marker';
    if (this._currentVertices.length === 0) {
      el.classList.add('highlight-first-vertex');
    }

    const marker = window.createMarker({ element: el, draggable: false })
      .setLngLat(lngLat)
      .addTo(this._map);

    this._currentVertices.push(coords);
    this._currentMarkers.push(marker);
    this._updatePreview();
  },

  /** Refresh the dashed preview outline of the in-progress polygon */
  _updatePreview() {
    if (this._mode !== 'map') {
      if (typeof ImageMap !== 'undefined') ImageMap._redrawLineCanvas();
      return;
    }
    const src = this._map.getSource(this._previewSourceId);
    if (!src) return;
    if (this._currentVertices.length < 2) {
      src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    src.setData({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: this._currentVertices.slice() },
        properties: {},
      }],
    });
  },

  /** Complete the current in-progress polygon into a saved highlight area */
  _finalizeArea() {
    if (this._currentVertices.length < 3) return;

    const id = this._nextId++;
    const label = `Highlight Area ${id}`;
    const vertices = this._currentVertices.slice();

    // Remove in-progress vertex markers
    this._currentMarkers.forEach(m => m.remove());
    this._currentMarkers = [];
    this._currentVertices = [];
    this._clearPreview();

    const area = {
      id,
      label,
      vertices,
      visible: true,
      bgColor: null,
      bgOpacity: null,
      _markers: [],
      _sourceId: `highlight-area-${id}-source`,
      _layerId: `highlight-area-${id}-layer`,
      _outlineLayerId: `highlight-area-${id}-outline-layer`,
    };

    this._placeAreaMarkers(area);
    this._areas.push(area);

    if (this._mode === 'map') {
      this._createAreaMapLayers(area);
    } else if (typeof ImageMap !== 'undefined') {
      ImageMap._redrawLineCanvas();
    }

    if (typeof Layers !== 'undefined') {
      Layers.addHighlightAreaLayer(id, label);
    }

    if (this._onUpdate) this._onUpdate();
  },

  /** Place permanent dot markers on a completed area.
   *  Each marker is draggable (updates the vertex position) and
   *  right-clicking removes that vertex (or the whole area if < 3 remain). */
  _placeAreaMarkers(area) {
    area.vertices.forEach((coords, index) => {
      this._placeOneAreaMarker(area, index);
    });
  },

  /** Create and add a single vertex marker for a completed area at the given index. */
  _placeOneAreaMarker(area, index) {
    const el = document.createElement('div');
    el.className = 'waypoint-marker highlight-area-vertex';

    // Absorb clicks so they don't propagate to the map as new-vertex events
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    // Right-click: remove this vertex (or the whole area if < 3 would remain)
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._removeVertex(area, index);
    });

    const marker = window.createMarker({ element: el, draggable: true })
      .setLngLat({ lng: area.vertices[index][0], lat: area.vertices[index][1] })
      .addTo(this._map);

    // Drag: update the stored vertex and refresh the fill
    marker.on('dragend', () => {
      const pos = marker.getLngLat();
      area.vertices[index] = [pos.lng, pos.lat];
      this._refreshArea(area);
      if (this._onUpdate) this._onUpdate();
    });

    // Insert at the correct position (markers array mirrors vertices array)
    area._markers[index] = marker;
  },

  /** Remove a single vertex from a completed area.
   *  If fewer than 3 vertices would remain, removes the entire area. */
  _removeVertex(area, index) {
    if (area.vertices.length <= 3) {
      this._removeArea(area);
      return;
    }

    // Remove the marker at this index
    area._markers[index].remove();
    area.vertices.splice(index, 1);
    area._markers.splice(index, 1);

    // Re-index all remaining markers so their contextmenu handlers have the right index
    area._markers.forEach(m => m.remove());
    area._markers = [];
    area.vertices.forEach((_, i) => this._placeOneAreaMarker(area, i));

    this._refreshArea(area);
    if (this._onUpdate) this._onUpdate();
  },

  /** Refresh a completed area's fill after vertices change (map source or canvas). */
  _refreshArea(area) {
    if (this._mode === 'map') {
      try {
        this._map.getSource(area._sourceId).setData(this._buildAreaGeoJSON(area));
      } catch (e) {}
    } else if (typeof ImageMap !== 'undefined') {
      ImageMap._redrawLineCanvas();
    }
  },

  /** Convert area.bgColor + bgOpacity into resolved fill+outline RGBA strings */
  _resolveAreaColors(area) {
    const hex = area.bgColor || '#b4b4b4';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const fillA = area.bgOpacity != null ? area.bgOpacity : 0.3;
    const outlineA = Math.min(1, fillA + 0.3);
    return {
      fill: `rgba(${r},${g},${b},${fillA})`,
      outline: `rgba(${r},${g},${b},${outlineA})`,
    };
  },

  /** Apply area.bgColor to existing map layers or trigger canvas redraw */
  _updateAreaColor(area) {
    if (this._mode === 'map') {
      const { fill, outline } = this._resolveAreaColors(area);
      try { this._map.setPaintProperty(area._layerId, 'fill-color', fill); } catch (e) {}
      try { this._map.setPaintProperty(area._outlineLayerId, 'line-color', outline); } catch (e) {}
    } else if (typeof ImageMap !== 'undefined') {
      ImageMap._redrawLineCanvas();
    }
  },

  /** Add Mapbox GL fill + outline layers for a completed area */
  _createAreaMapLayers(area) {
    const map = this._map;
    if (map.getSource(area._sourceId)) return;

    map.addSource(area._sourceId, {
      type: 'geojson',
      data: this._buildAreaGeoJSON(area),
    });

    const beforeId = this._getBeforeLayerId(map);
    const { fill, outline } = this._resolveAreaColors(area);

    map.addLayer({
      id: area._layerId,
      type: 'fill',
      source: area._sourceId,
      paint: { 'fill-color': fill },
    }, beforeId);

    map.addLayer({
      id: area._outlineLayerId,
      type: 'line',
      source: area._sourceId,
      paint: { 'line-color': outline, 'line-width': 1.5 },
    }, beforeId);
  },

  _buildAreaGeoJSON(area) {
    if (area.vertices.length < 3) return { type: 'FeatureCollection', features: [] };
    // Close the ring
    const ring = [...area.vertices, area.vertices[0]];
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      }],
    };
  },

  /** Remove a completed area entirely */
  _removeArea(area) {
    area._markers.forEach(m => m.remove());
    area._markers = [];

    if (this._mode === 'map') {
      try { this._map.removeLayer(area._outlineLayerId); } catch (e) {}
      try { this._map.removeLayer(area._layerId); } catch (e) {}
      try { this._map.removeSource(area._sourceId); } catch (e) {}
    }

    this._areas = this._areas.filter(a => a.id !== area.id);

    if (typeof Layers !== 'undefined' && Layers.removeHighlightAreaLayer) {
      Layers.removeHighlightAreaLayer(area.id);
    }

    if (this._mode === 'image' && typeof ImageMap !== 'undefined') {
      ImageMap._redrawLineCanvas();
    }

    if (this._onUpdate) this._onUpdate();
  },

  /** Clear the dashed preview from the map */
  _clearPreview() {
    if (this._mode !== 'map') return;
    const src = this._map.getSource(this._previewSourceId);
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  },

  /** Cancel the current in-progress polygon (e.g. when switching tools) */
  cancelCurrent() {
    this._currentMarkers.forEach(m => m.remove());
    this._currentMarkers = [];
    this._currentVertices = [];
    this._clearPreview();
    if (this._mode === 'image' && typeof ImageMap !== 'undefined') {
      ImageMap._redrawLineCanvas();
    }
  },

  /** Set visibility for a completed area by id */
  setVisible(id, visible) {
    const area = this._areas.find(a => a.id === id);
    if (!area) return;
    area.visible = visible;

    area._markers.forEach(m => {
      m.getElement().style.display = visible ? '' : 'none';
      if (m._container) m._container.style.display = visible ? '' : 'none';
    });

    if (this._mode === 'map') {
      const { fill } = this._resolveAreaColors(area);
      try {
        this._map.setPaintProperty(area._layerId, 'fill-color',
          visible ? fill : 'rgba(0,0,0,0)');
      } catch (e) {}
      try {
        this._map.setPaintProperty(area._outlineLayerId, 'line-opacity', visible ? 1 : 0);
      } catch (e) {}
    } else if (typeof ImageMap !== 'undefined') {
      ImageMap._redrawLineCanvas();
    }
  },

  /** Remove all highlight areas and cancel any in-progress drawing */
  clearAll() {
    this.cancelCurrent();
    [...this._areas].forEach(area => this._removeArea(area));
  },

  /** Serialize all areas */
  getData() {
    return this._areas.map(area => {
      const d = {
        id: area.id,
        label: area.label,
        vertices: area.vertices.slice(),
        visible: area.visible,
      };
      if (area.bgColor != null) d.bgColor = area.bgColor;
      if (area.bgOpacity != null) d.bgOpacity = area.bgOpacity;
      return d;
    });
  },

  /** Restore areas from saved data */
  loadData(data) {
    this.clearAll();
    if (!Array.isArray(data)) return;

    data.forEach(d => {
      if (!Array.isArray(d.vertices) || d.vertices.length < 3) return;

      const id = d.id || this._nextId;
      if (id >= this._nextId) this._nextId = id + 1;

      const area = {
        id,
        label: d.label || `Highlight Area ${id}`,
        vertices: d.vertices.slice(),
        visible: d.visible !== false,
        bgColor: d.bgColor || null,
        bgOpacity: d.bgOpacity != null ? d.bgOpacity : null,
        _markers: [],
        _sourceId: `highlight-area-${id}-source`,
        _layerId: `highlight-area-${id}-layer`,
        _outlineLayerId: `highlight-area-${id}-outline-layer`,
      };

      this._placeAreaMarkers(area);
      this._areas.push(area);

      if (this._mode === 'map') {
        this._createAreaMapLayers(area);
        if (!area.visible) {
          try { this._map.setPaintProperty(area._layerId, 'fill-color', 'rgba(0,0,0,0)'); } catch (e) {}
          try { this._map.setPaintProperty(area._outlineLayerId, 'line-opacity', 0); } catch (e) {}
        }
      }

      if (typeof Layers !== 'undefined') {
        Layers.addHighlightAreaLayer(id, area.label);
      }
    });

    if (this._areas.length > 0 && this._mode === 'image' && typeof ImageMap !== 'undefined') {
      ImageMap._redrawLineCanvas();
    }
  },

  /** Draw completed fills and in-progress preview onto a 2D canvas (image mode).
   *  Call this at the START of _redrawLineCanvas so fills appear below driving lines. */
  drawOnCanvas(ctx) {
    // Draw completed area fills
    for (const area of this._areas) {
      if (!area.visible || area.vertices.length < 3) continue;
      ctx.beginPath();
      ctx.moveTo(area.vertices[0][0], area.vertices[0][1]);
      for (let i = 1; i < area.vertices.length; i++) {
        ctx.lineTo(area.vertices[i][0], area.vertices[i][1]);
      }
      ctx.closePath();
      const { fill, outline } = this._resolveAreaColors(area);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.stroke();
    }

    // Draw dashed preview of in-progress polygon
    if (this._currentVertices.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(this._currentVertices[0][0], this._currentVertices[0][1]);
      for (let i = 1; i < this._currentVertices.length; i++) {
        ctx.lineTo(this._currentVertices[i][0], this._currentVertices[i][1]);
      }
      ctx.strokeStyle = 'rgba(180,180,180,0.8)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },
};
