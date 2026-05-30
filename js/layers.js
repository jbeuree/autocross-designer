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
      measurements:{ label: 'Measurements', visible: true },
      notes:       { label: 'Notes',        visible: true },
      grid:        { label: 'Grid',         visible: true },
      statsOverlay:{ label: 'Stats',         visible: true },
      scaleOverlay:{ label: 'Scale Bar',      visible: true },
    };

    this._renderPanel();
  },

  /** Render the layer toggles in the sidebar */
  _renderPanel() {
    const container = document.getElementById('layers-list');
    if (!container) return;

    container.innerHTML = '';

    // collect extra driving line keys and sort them numerically
    const extraKeys = Object.keys(this._layers)
      .filter(k => k.startsWith('drivingLineExtra'))
      .sort((a, b) => {
        const ai = parseInt(a.slice('drivingLineExtra'.length), 10);
        const bi = parseInt(b.slice('drivingLineExtra'.length), 10);
        return ai - bi;
      });

    let extrasRendered = false;

    const buildRow = (key, layer) => {
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

      if (key.startsWith('imageLayer_')) {
        span.contentEditable = 'true';
        span.spellcheck = false;
        span.className = 'layer-label-editable';
        span.title = 'Click to rename';
        span.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
          if (e.key === 'Escape') { span.textContent = layer.label; span.blur(); }
        });
        span.addEventListener('blur', () => {
          const newLabel = span.textContent.trim() || layer.label;
          span.textContent = newLabel;
          this.renameImageLayer(key, newLabel);
        });
        // Prevent label click from toggling the checkbox when editing the name
        span.addEventListener('mousedown', (e) => e.stopPropagation());
        span.addEventListener('click', (e) => e.preventDefault());
      }

      if (key.startsWith('highlightArea_')) {
        span.contentEditable = 'true';
        span.spellcheck = false;
        span.className = 'layer-label-editable';
        span.title = 'Click to rename';
        span.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
          if (e.key === 'Escape') { span.textContent = layer.label; span.blur(); }
        });
        span.addEventListener('blur', () => {
          const newLabel = span.textContent.trim() || layer.label;
          span.textContent = newLabel;
          layer.label = newLabel;
          const id = parseInt(key.slice('highlightArea_'.length), 10);
          const area = typeof Highlights !== 'undefined' ? Highlights._areas.find(a => a.id === id) : null;
          if (area) area.label = newLabel;
        });
        span.addEventListener('mousedown', (e) => e.stopPropagation());
        span.addEventListener('click', (e) => e.preventDefault());
      }

      row.appendChild(cb);
      row.appendChild(span);

      if (key.startsWith('highlightArea_')) {
        const areaId = parseInt(key.slice('highlightArea_'.length), 10);
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.className = 'highlight-color-input';
        colorInput.title = 'Pick area color';
        const areaRef = typeof Highlights !== 'undefined' ? Highlights._areas.find(a => a.id === areaId) : null;
        colorInput.value = (areaRef && areaRef.bgColor) || '#b4b4b4';
        colorInput.addEventListener('mousedown', e => e.stopPropagation());
        colorInput.addEventListener('input', e => {
          const area = typeof Highlights !== 'undefined' ? Highlights._areas.find(a => a.id === areaId) : null;
          if (!area) return;
          area.bgColor = e.target.value;
          Highlights._updateAreaColor(area);
          if (Highlights._onUpdate) Highlights._onUpdate();
        });
        colorInput.addEventListener('change', () => {
          try { if (typeof History !== 'undefined') History.push(); } catch (ex) {}
        });
        row.appendChild(colorInput);

        const opacitySlider = document.createElement('input');
        opacitySlider.type = 'range';
        opacitySlider.className = 'highlight-opacity-slider';
        opacitySlider.min = '0';
        opacitySlider.max = '1';
        opacitySlider.step = '0.05';
        opacitySlider.title = 'Area opacity';
        opacitySlider.value = (areaRef && areaRef.bgOpacity != null) ? areaRef.bgOpacity : 0.3;
        opacitySlider.addEventListener('mousedown', e => e.stopPropagation());
        opacitySlider.addEventListener('input', e => {
          const area = typeof Highlights !== 'undefined' ? Highlights._areas.find(a => a.id === areaId) : null;
          if (!area) return;
          area.bgOpacity = parseFloat(e.target.value);
          Highlights._updateAreaColor(area);
          if (Highlights._onUpdate) Highlights._onUpdate();
        });
        opacitySlider.addEventListener('change', () => {
          try { if (typeof History !== 'undefined') History.push(); } catch (ex) {}
        });
        row.appendChild(opacitySlider);
      }

      return row;
    };

    // Render layers, but skip the extra driving-line keys in the main pass.
    for (const [key, layer] of Object.entries(this._layers)) {
      if (key.startsWith('drivingLineExtra')) continue;
      container.appendChild(buildRow(key, layer));
      // Immediately after the main Driving Line entry, insert extras (sorted)
      if (key === 'drivingLine') {
        extraKeys.forEach(k => {
          const l = this._layers[k];
          if (!l) return;
          container.appendChild(buildRow(k, l));
        });
        extrasRendered = true;
      }
    }

    // If there was no `drivingLine` key, append extras at the end.
    if (extraKeys.length && !extrasRendered) {
      extraKeys.forEach(k => {
        const l = this._layers[k];
        if (!l) return;
        container.appendChild(buildRow(k, l));
      });
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
          ImageMap._redrawLineCanvas();
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
      // courseOutline layer removed
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
      case 'statsOverlay':
        if (typeof StatsOverlay !== 'undefined') {
          StatsOverlay.setVisible(visible);
        }
        break;
      case 'scaleOverlay':
        if (typeof ScaleOverlay !== 'undefined') {
          ScaleOverlay.setVisible(visible);
        }
        break;
      default:
        if (key.startsWith('imageLayer_')) {
          const id = parseInt(key.slice('imageLayer_'.length), 10);
          if (typeof ImageLayers !== 'undefined') {
            ImageLayers.setVisible(id, visible);
          }
        } else if (key.startsWith('highlightArea_')) {
          const id = parseInt(key.slice('highlightArea_'.length), 10);
          if (typeof Highlights !== 'undefined') {
            Highlights.setVisible(id, visible);
          }
        } else if (key.startsWith('drivingLineExtra')) {
          // Extra optional driving line — find instance by index
          const idx = parseInt(key.slice('drivingLineExtra'.length), 10);
          if (typeof App !== 'undefined' && Array.isArray(App._extraDrivingLines)) {
            const line = App._extraDrivingLines.find(l => l.index === idx);
            if (line) {
              line.waypoints.forEach(wp => {
                wp.marker.getElement().style.display = visible ? '' : 'none';
                if (wp.marker._container) wp.marker._container.style.display = visible ? '' : 'none';
              });
              if (App.mode === 'map') {
                try { App.map.setPaintProperty(line.layerId, 'line-opacity', visible ? 1 : 0); } catch (e) {}
              } else if (typeof ImageMap !== 'undefined' && ImageMap._redrawLineCanvas) {
                ImageMap._redrawLineCanvas();
              }
            }
          }
        }
        break;
    }
  },

  /** Check if a layer is visible */
  isVisible(key) {
    return this._layers[key] ? this._layers[key].visible : true;
  },

  /** Add a dynamic highlight area entry to the panel */
  addHighlightAreaLayer(id, label) {
    this._layers[`highlightArea_${id}`] = { label: label || `Highlight Area ${id}`, visible: true };
    this._renderPanel();
  },

  /** Remove a dynamic highlight area entry from the panel */
  removeHighlightAreaLayer(id) {
    delete this._layers[`highlightArea_${id}`];
    this._renderPanel();
  },

  /** Add a dynamic image layer entry to the panel */
  addImageLayer(id, label) {
    this._layers[`imageLayer_${id}`] = { label: label || `Image ${id}`, visible: true };
    this._renderPanel();
  },

  /** Add a dynamic extra driving line entry to the panel */
  addExtraDrivingLineLayer(index, lineObj) {
    this._layers[`drivingLineExtra${index}`] = { label: `Driving Line ${index}`, visible: true };
    this._renderPanel();
  },

  /** Remove all dynamic extra driving line entries from the panel */
  clearExtraDrivingLineLayers() {
    Object.keys(this._layers).forEach((key) => {
      if (key.startsWith('drivingLineExtra')) {
        delete this._layers[key];
      }
    });
    this._renderPanel();
  },

  /** Remove a specific dynamic extra driving line entry from the panel */
  removeExtraDrivingLineLayer(index) {
    const key = `drivingLineExtra${index}`;
    if (this._layers[key]) {
      delete this._layers[key];
      this._renderPanel();
    }
  },

  /** Remove a dynamic image layer entry from the panel */
  removeImageLayer(id) {
    delete this._layers[`imageLayer_${id}`];
    this._renderPanel();
  },

  /** Rename a dynamic image layer entry */
  renameImageLayer(key, newLabel) {
    if (!this._layers[key]) return;
    this._layers[key].label = newLabel;
    const id = parseInt(key.slice('imageLayer_'.length), 10);
    if (typeof ImageLayers !== 'undefined') {
      ImageLayers.renameLayer(id, newLabel);
    }
  },

  /** Return a plain {key: visible} map for all current layers */
  getVisibility() {
    const map = {};
    for (const [key, layer] of Object.entries(this._layers)) {
      map[key] = layer.visible;
    }
    return map;
  },

  /** Restore layer visibility from a saved {key: visible} map.
   *  Unknown keys (e.g. dynamic layers not yet created) are ignored. */
  loadVisibility(map) {
    if (!map || typeof map !== 'object') return;
    for (const [key, visible] of Object.entries(map)) {
      if (!this._layers[key]) continue;
      this._layers[key].visible = !!visible;
      this._applyVisibility(key, !!visible);
    }
    this._renderPanel();
  },
};
