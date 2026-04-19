// layers.js — Layer visibility management

const Layers = {
  _layers: {},

  init() {
    this._layers = {
      cones:       { label: 'Cones',        visible: true },
      startLine:   { label: 'Start Line',   visible: true },
      obstacles:   { label: 'Obstacles',    visible: true },
      workers:     { label: 'Workers',      visible: true },
      drivingLine: { label: 'Driving Line', visible: true },
      drivingLine2: { label: 'Driving Line 2', visible: true },
      measurements:{ label: 'Measurements', visible: true },
      notes:       { label: 'Notes',        visible: true },
      courseOutline:{ label: 'Course Outline', visible: true },
      grid:        { label: 'Grid',         visible: true },
    };

    this._renderPanel();
  },

  /** Render the layer toggles in the sidebar */
  _renderPanel() {
    const container = document.getElementById('layers-list');
    if (!container) return;

    container.innerHTML = '';
    for (const [key, layer] of Object.entries(this._layers)) {
      const row = document.createElement('label');
      row.className = 'layer-toggle';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = layer.visible;
      cb.addEventListener('change', () => {
        layer.visible = cb.checked;
        this._applyVisibility(key, cb.checked);
      });

      const span = document.createElement('span');
      span.textContent = layer.label;

      row.appendChild(cb);
      row.appendChild(span);
      container.appendChild(row);
    }
  },

  /** Apply visibility for a specific layer */
  _applyVisibility(key, visible) {
    switch (key) {
      case 'cones':
        Cones.cones.forEach(c => {
          // Skip start-cone and start-beam (they have their own layer)
          if (c.type === 'start-cone' || c.type === 'start-beam') return;
          c.marker.getElement().style.display = visible ? '' : 'none';
          if (c.marker._container) c.marker._container.style.display = visible ? '' : 'none';
        });
        break;
      case 'startLine':
        Cones.cones.forEach(c => {
          // Only show start-cone and start-beam
          if (c.type !== 'start-cone' && c.type !== 'start-beam') return;
          c.marker.getElement().style.display = visible ? '' : 'none';
          if (c.marker._container) c.marker._container.style.display = visible ? '' : 'none';
        });
        break;
      case 'obstacles':
        if (typeof Obstacles !== 'undefined') {
          visible ? Obstacles.show() : Obstacles.hide();
        }
        break;
      case 'workers':
        if (typeof Workers !== 'undefined') {
          visible ? Workers.show() : Workers.hide();
        }
        break;
      case 'drivingLine':
        DrivingLine.waypoints.forEach(wp => {
          wp.marker.getElement().style.display = visible ? '' : 'none';
          if (wp.marker._container) wp.marker._container.style.display = visible ? '' : 'none';
        });
        // Toggle the line layer visibility
        if (App.mode === 'map') {
          try {
            App.map.setPaintProperty('driving-line-layer', 'line-opacity', visible ? 1 : 0);
          } catch (e) {}
        } else {
          const lineCanvas = ImageMap._lineCanvas;
          if (lineCanvas) lineCanvas.style.display = visible ? '' : 'none';
        }
        break;
      case 'drivingLine2':
        DrivingLine2.waypoints.forEach(wp => {
          wp.marker.getElement().style.display = visible ? '' : 'none';
          if (wp.marker._container) wp.marker._container.style.display = visible ? '' : 'none';
        });
        if (App.mode === 'map') {
          try {
            App.map.setPaintProperty('driving-line2-layer', 'line-opacity', visible ? 1 : 0);
          } catch (e) {}
        }
        break;
      case 'measurements':
        Measurements.measurements.forEach(m => {
          const display = visible ? '' : 'none';
          m.markers.forEach(mk => {
            mk.getElement().style.display = display;
            if (mk._container) mk._container.style.display = display;
          });
          if (m.labelEl) m.labelEl.style.display = display;
          if (m.svgEl) m.svgEl.style.display = display;
        });
        break;
      case 'courseOutline':
        if (typeof CourseOutline !== 'undefined') {
          const display = visible ? '' : 'none';
          CourseOutline.segments.forEach(seg => {
            seg.markers.forEach(mk => {
              mk.getElement().style.display = display;
              if (mk._container) mk._container.style.display = display;
            });
            if (seg.svgEl) seg.svgEl.style.display = display;
          });
        }
        break;
      case 'notes':
        Notes.notes.forEach(n => {
          n.marker.getElement().style.display = visible ? '' : 'none';
          if (n.marker._container) n.marker._container.style.display = visible ? '' : 'none';
        });
        break;
      case 'grid':
        const gridCanvas = document.getElementById('grid-canvas');
        if (gridCanvas && Grid.isActive()) {
          gridCanvas.style.display = visible ? 'block' : 'none';
        }
        break;
    }
  },

  /** Check if a layer is visible */
  isVisible(key) {
    return this._layers[key] ? this._layers[key].visible : true;
  },
};
