// drivingline.js — Driving line drawing tool with smooth spline

const DrivingLine = {
  waypoints: [],    // { lngLat: [lng, lat], marker }
  _map: null,
  _sourceId: 'driving-line-source',
  _layerId: 'driving-line-layer',
  _onUpdate: null,
  _defaultDashArray: [2, 2],
  _isSolid: false,

  init(map, { onUpdate }) {
    this._map = map;
    this._onUpdate = onUpdate;

    // Add GeoJSON source and line layer once map is loaded
    map.on('load', () => {
      this._addLayer();
    });

    // If map is already loaded (unlikely but safe)
    if (map.loaded()) {
      this._addLayer();
    }
  },

  _addLayer() {
    if (this._map.getSource(this._sourceId)) return;

    this._map.addSource(this._sourceId, {
      type: 'geojson',
      data: this._buildGeoJSON(),
    });

    this._map.addLayer({
      id: this._layerId,
      type: 'line',
      source: this._sourceId,
      paint: {
        'line-color': '#60a5fa',
        'line-width': 3,
        'line-dasharray': this._defaultDashArray.slice(),
      },
    });

    this.setSolid(this._isSolid);
  },

  /** Add a waypoint at the given lngLat.
   *  If a screen-space point {x,y} is provided and falls near an existing
   *  segment (within 20px), the waypoint is inserted between the two nearest
   *  waypoints.  Otherwise it is appended to the end. */
  addWaypoint(lngLat, point) {
    const el = document.createElement('div');
    el.className = 'waypoint-marker';

    const marker = window.createMarker({ element: el, draggable: true })
      .setLngLat(lngLat)
      .addTo(this._map);

    const wp = {
      lngLat: [lngLat.lng, lngLat.lat],
      marker,
    };

    // Update on drag
    marker.on('dragend', () => {
      const pos = marker.getLngLat();
      wp.lngLat = [pos.lng, pos.lat];
      this._updateLine();
      if (this._onUpdate) this._onUpdate();
    });

    // Right-click to delete
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      marker.remove();
      const idx = this.waypoints.indexOf(wp);
      if (idx !== -1) this.waypoints.splice(idx, 1);
      this._updateLine();
      if (this._onUpdate) this._onUpdate();
    });

    // Insert between neighbors when clicking near an existing segment,
    // otherwise append to end.
    let insertIdx = this.waypoints.length;
    if (point && this.waypoints.length >= 2) {
      const closest = this._findClosestSegment(point);
      if (closest.dist < 20) {
        insertIdx = closest.segIdx + 1;
      }
    }
    this.waypoints.splice(insertIdx, 0, wp);

    this._updateLine();
    if (this._onUpdate) this._onUpdate();
  },

  /** Clear all waypoints and the line */
  clear() {
    this.waypoints.forEach(wp => wp.marker.remove());
    this.waypoints = [];
    this._updateLine();
    if (this._onUpdate) this._onUpdate();
  },

  /** Get data for serialization */
  getData() {
    return this.waypoints.map(wp => ({ lngLat: wp.lngLat }));
  },

  /** Load waypoints from saved data */
  loadData(data) {
    this.clear();
    data.forEach(d => {
      this.addWaypoint({ lng: d.lngLat[0], lat: d.lngLat[1] });
    });
  },

  /** Update the GeoJSON line on the map */
  _updateLine() {
    const source = this._map.getSource(this._sourceId);
    if (source) {
      source.setData(this._buildGeoJSON());
    }
  },

  /** Return the index of the segment [i, i+1] whose screen-space midline is
   *  closest to the given pixel point, plus the pixel distance to that segment. */
  _findClosestSegment(point) {
    let bestDist = Infinity;
    let bestSegIdx = this.waypoints.length - 1;
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = this._map.project(this.waypoints[i].lngLat);
      const b = this._map.project(this.waypoints[i + 1].lngLat);
      const dist = this._distPointToSegment(point, a, b);
      if (dist < bestDist) {
        bestDist = dist;
        bestSegIdx = i;
      }
    }
    return { segIdx: bestSegIdx, dist: bestDist };
  },

  /** Pixel distance from point p to the finite segment [a, b]. */
  _distPointToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
      return Math.hypot(p.x - a.x, p.y - a.y);
    }
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  },

  /** Catmull-Rom spline interpolation */
  _catmullRomSpline(points, numSegments) {
    if (points.length < 2) return points.slice();

    const result = [];

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];

      for (let t = 0; t < numSegments; t++) {
        const s = t / numSegments;
        const s2 = s * s;
        const s3 = s2 * s;

        const x = 0.5 * (
          (2 * p1[0]) +
          (-p0[0] + p2[0]) * s +
          (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * s2 +
          (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * s3
        );

        const y = 0.5 * (
          (2 * p1[1]) +
          (-p0[1] + p2[1]) * s +
          (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * s2 +
          (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * s3
        );

        result.push([x, y]);
      }
    }

    // Add the last point
    result.push(points[points.length - 1]);
    return result;
  },

  /** Build GeoJSON for the driving line */
  _buildGeoJSON() {
    if (this.waypoints.length < 2) {
      return { type: 'FeatureCollection', features: [] };
    }

    const rawCoords = this.waypoints.map(wp => wp.lngLat);
    const smoothCoords = this._catmullRomSpline(rawCoords, 20);

    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: smoothCoords,
        },
      }],
    };
  },

  setSolid(solid) {
    this._isSolid = !!solid;
    if (!this._map || !this._map.getLayer || !this._map.getLayer(this._layerId) || !this._map.setPaintProperty) {
      return;
    }

    this._map.setPaintProperty(
      this._layerId,
      'line-dasharray',
      this._isSolid ? null : this._defaultDashArray.slice()
    );
  },
};
