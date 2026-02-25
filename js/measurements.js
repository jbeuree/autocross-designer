// measurements.js — Persistent distance measurements with two-click workflow

const Measurements = {
  measurements: [],     // { id, points: [[lng,lat],[lng,lat]], markers: [m1, m2], labelEl, sourceId, svgEl }
  _nextId: 1,
  _map: null,
  _visible: true,
  _pendingPoint: null,  // first click lngLat waiting for second
  _pendingMarker: null, // marker for first point

  init(map) {
    this._map = map;

    // Update label positions on pan/zoom
    map.on('move', () => this.updateAllLabels());
  },

  /** Handle a click while measure tool is active. screenPoint for cone snapping. */
  handleClick(lngLat, screenPoint) {
    // Snap to cone if within 25px
    let point = [lngLat.lng, lngLat.lat];
    if (screenPoint) {
      const nearCone = App._findConeNear(screenPoint);
      if (nearCone) {
        point = nearCone.lngLat.slice();
      }
    }

    if (!this._pendingPoint) {
      // First click — show endpoint and wait for second
      this._pendingPoint = point;
      this._pendingMarker = this._createEndpointMarker(point);
    } else {
      // Second click — create the measurement
      const p1 = this._pendingPoint;
      const p2 = point;

      // Remove pending marker (will be replaced by measurement's own markers)
      if (this._pendingMarker) {
        this._pendingMarker.remove();
        this._pendingMarker = null;
      }
      this._pendingPoint = null;

      this._createMeasurement(p1, p2);
    }
  },

  /** Cancel a pending first click */
  cancelPending() {
    if (this._pendingMarker) {
      this._pendingMarker.remove();
      this._pendingMarker = null;
    }
    this._pendingPoint = null;
  },

  /** Create a full measurement between two points */
  _createMeasurement(p1, p2) {
    const id = this._nextId++;
    const sourceId = 'measure-line-' + id;

    // Create endpoint markers
    const m1 = this._createEndpointMarker(p1, id);
    const m2 = this._createEndpointMarker(p2, id);

    // Create label
    const labelEl = document.createElement('div');
    labelEl.className = 'measurement-label';
    labelEl.textContent = this._computeDistanceLabel(p1, p2);

    // Right-click on label to delete
    labelEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.removeMeasurement(id);
    });

    // Draw line
    if (App.mode === 'image') {
      // SVG line inside the image wrapper
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('measurement-line-svg');
      svg.setAttribute('width', ImageMap._imageWidth);
      svg.setAttribute('height', ImageMap._imageHeight);
      svg.style.position = 'absolute';
      svg.style.top = '0';
      svg.style.left = '0';
      svg.style.pointerEvents = 'none';
      svg.style.zIndex = '2';
      svg.style.overflow = 'visible';

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', p1[0]);
      line.setAttribute('y1', p1[1]);
      line.setAttribute('x2', p2[0]);
      line.setAttribute('y2', p2[1]);
      line.setAttribute('stroke', '#f472b6');
      line.setAttribute('stroke-width', '3');
      line.setAttribute('stroke-dasharray', '8,5');
      svg.appendChild(line);

      ImageMap._wrapper.insertBefore(svg, ImageMap._markerContainer);

      // Label inside marker container at midpoint
      const midX = (p1[0] + p2[0]) / 2;
      const midY = (p1[1] + p2[1]) / 2;
      labelEl.style.position = 'absolute';
      labelEl.style.left = midX + 'px';
      labelEl.style.top = midY + 'px';
      labelEl.style.transform = `translate(-50%, -100%) scale(${1 / ImageMap._scale})`;
      labelEl.style.pointerEvents = 'auto';
      labelEl.style.zIndex = '10';
      ImageMap._markerContainer.appendChild(labelEl);

      const measurement = { id, points: [p1, p2], markers: [m1, m2], labelEl, svgEl: svg, sourceId: null };
      this.measurements.push(measurement);
    } else {
      // Map mode: draw line via a simple SVG overlay on screen, plus label
      // (Using DOM elements instead of GeoJSON layers for reliability)
      const svgOverlay = this._createMapLineSVG(p1, p2);
      document.body.appendChild(svgOverlay);

      // Position label on screen at midpoint
      labelEl.style.pointerEvents = 'auto';
      document.body.appendChild(labelEl);
      this._positionLabel(labelEl, p1, p2);

      const measurement = { id, points: [p1, p2], markers: [m1, m2], labelEl, svgEl: svgOverlay, sourceId: null };
      this.measurements.push(measurement);
    }
  },

  /** Create an SVG line overlay for map mode that we reposition on move */
  _createMapLineSVG(p1, p2) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '5';
    svg.style.overflow = 'visible';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', '#f472b6');
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-dasharray', '6,4');
    svg.appendChild(line);

    // Position the line
    const sp1 = this._map.project(p1);
    const sp2 = this._map.project(p2);
    line.setAttribute('x1', sp1.x);
    line.setAttribute('y1', sp1.y);
    line.setAttribute('x2', sp2.x);
    line.setAttribute('y2', sp2.y);

    return svg;
  },

  /** Create an endpoint marker dot */
  _createEndpointMarker(point, measureId) {
    const el = document.createElement('div');
    el.className = 'measurement-endpoint';

    if (measureId !== undefined) {
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.removeMeasurement(measureId);
      });
    }

    const marker = window.createMarker({ element: el, draggable: false })
      .setLngLat(point)
      .addTo(this._map);

    return marker;
  },

  /** Compute distance label string between two points */
  _computeDistanceLabel(p1, p2) {
    let feet;
    if (App.mode === 'image') {
      if (!ImageMap.hasScale()) {
        const dx = p1[0] - p2[0];
        const dy = p1[1] - p2[1];
        return Math.sqrt(dx * dx + dy * dy).toFixed(0) + ' px';
      }
      feet = Distance._pixelDistFeet(p1, p2);
    } else {
      const meters = Distance._haversine(p1[1], p1[0], p2[1], p2[0]);
      feet = meters * 3.28084;
    }
    return feet.toFixed(1) + ' ft';
  },

  /** Position a label element at the midpoint between two points (map mode) */
  _positionLabel(labelEl, p1, p2) {
    const sp1 = this._map.project(p1);
    const sp2 = this._map.project(p2);
    const mx = (sp1.x + sp2.x) / 2;
    const my = (sp1.y + sp2.y) / 2;
    labelEl.style.left = mx + 'px';
    labelEl.style.top = (my - 16) + 'px';
  },

  /** Update all label and line positions (called on pan/zoom) */
  updateAllLabels() {
    if (App.mode === 'image') {
      for (const m of this.measurements) {
        if (m.labelEl && m.labelEl.parentNode) {
          const midX = (m.points[0][0] + m.points[1][0]) / 2;
          const midY = (m.points[0][1] + m.points[1][1]) / 2;
          m.labelEl.style.left = midX + 'px';
          m.labelEl.style.top = midY + 'px';
          m.labelEl.style.transform = `translate(-50%, -100%) scale(${1 / ImageMap._scale})`;
        }
      }
      return;
    }

    // Map mode: reposition SVG lines and labels
    for (const m of this.measurements) {
      if (m.labelEl && m.labelEl.parentNode) {
        this._positionLabel(m.labelEl, m.points[0], m.points[1]);
      }
      if (m.svgEl && m.svgEl.parentNode) {
        const line = m.svgEl.querySelector('line');
        if (line) {
          const sp1 = this._map.project(m.points[0]);
          const sp2 = this._map.project(m.points[1]);
          line.setAttribute('x1', sp1.x);
          line.setAttribute('y1', sp1.y);
          line.setAttribute('x2', sp2.x);
          line.setAttribute('y2', sp2.y);
        }
      }
    }
  },

  /** Remove a measurement by id */
  removeMeasurement(id) {
    const idx = this.measurements.findIndex(m => m.id === id);
    if (idx === -1) return;
    const m = this.measurements[idx];

    // Remove markers
    m.markers.forEach(mk => mk.remove());

    // Remove label
    if (m.labelEl && m.labelEl.parentNode) {
      m.labelEl.parentNode.removeChild(m.labelEl);
    }

    // Remove line SVG
    if (m.svgEl && m.svgEl.parentNode) {
      m.svgEl.parentNode.removeChild(m.svgEl);
    }

    this.measurements.splice(idx, 1);
  },

  /** Toggle visibility of all measurements */
  toggleVisibility() {
    this._visible = !this._visible;
    for (const m of this.measurements) {
      const display = this._visible ? '' : 'none';
      m.markers.forEach(mk => {
        mk.getElement().style.display = display;
        if (mk._container) mk._container.style.display = display;
      });
      if (m.labelEl) m.labelEl.style.display = display;
      if (m.svgEl) m.svgEl.style.display = display;
    }
    return this._visible;
  },

  /** Clear all measurements */
  clearAll() {
    while (this.measurements.length > 0) {
      this.removeMeasurement(this.measurements[0].id);
    }
  },

  /** Get data for serialization */
  getData() {
    return this.measurements.map(m => ({
      p1: m.points[0],
      p2: m.points[1],
    }));
  },

  /** Load measurements from saved data */
  loadData(data) {
    this.clearAll();
    data.forEach(d => {
      this._createMeasurement(d.p1, d.p2);
    });
  },
};
