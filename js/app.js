// app.js — App init, state management, event wiring

const finishConeSize = 16;
const startBeamConeSize = 16;
const startLineColor = '#000000';
const startBeamColor = '#0d6326';
const finishLineColor = '#000000';
const App = {
  activeTool: 'regular',  // current tool
  selectedCone: null,
  map: null,
  mode: 'map',           // 'map' or 'image'
  imageFileName: null,    // name of loaded image file (image mode only)
  courseTitle: 'Autocross', // editable course title / default filename
  _solidDrivingLine: true,
  _scalePoints: [],       // temp array for scale calibration clicks [{x,y}]
  _scaleMarkers: [],      // temp DOM elements for scale point display
  _scaleLine: null,       // temp SVG line overlay
  _slalomStart: null,     // first click for slalom tool
  _slalomEnd: null,       // second click for slalom tool
  _leanerSetStart: null,  // first click for leaner-set tool
  _leanerSetEnd: null,    // second click for leaner-set tool
  _gateCenter: null,      // first click for gate tool
  _startConeStart: null,  // first cone lngLat for start-cone tool
  _startConeCone1Id: null, // cone id of the first cone placed during start-cone placement
  _previewLine: null,     // SVG element for rubber-band preview line
  _previewLabel: null,    // distance label element for preview
  _boxSelecting: false,   // box selection state
  _previousTool: 'regular', // tool to revert to after one-shot select
  _drawStartFinishLines: false, // whether to draw start/finish lines on the map
  _currentStartConePair: [], // IDs of the current start-cone pair [id1, id2]
  _startConeLineElement: null, // SVG line connecting the start-cone pair
  _currentStartBeamPair: [], // IDs of the current start-beam pair [id1, id2]
  _startBeamLineElement: null, // SVG line connecting the start-beam pair
  _startBeamStart: null,  // first pylon lngLat for start-beam tool
  _startBeamPylon1Id: null, // cone id of the first pylon placed during start-beam placement
  _leanerStart: null,     // first click for leaner tool
  _pointerStart: null,    // first click state for pointer tool: {lngLat, regularConeId}
  _currentFinishConePair: [], // IDs of the current finish-cone pair [id1, id2]
  _extraDrivingLines: [],   // dynamically-added driving line instances
  _nextExtraLineIndex: 2,   // counter for line numbering
  // Color palette cycling for extra driving lines (index 0 = Line 2, etc.)
  _extraLineColors: ['#22c55e','#ef4444','#a855f7','#ec4899','#14b8a6','#eab308'],
  _finishConeLineElement: null, // SVG line connecting the finish-cone pair
  _finishConeStart: null,  // first cone lngLat for finish-cone tool
  _finishConeCone1Id: null, // cone id of the first cone placed during finish-cone placement
  _backgroundDPI: 96,      // DPI of the loaded background image (detected from PNG metadata)
  
  async init() {
    // Check for shared course in URL
    const sharedCourse = Sharing.loadFromURL();

    // If a pending background was set by the "Load Background" flow,
    // honor it and initialize directly into the chosen mode.
    const pendingBgRaw = sessionStorage.getItem('autocross-pending-background');
    if (pendingBgRaw) {
      try {
        const pendingBg = JSON.parse(pendingBgRaw);
        sessionStorage.removeItem('autocross-pending-background');
        this.mode = pendingBg.mode || 'map';
        if (this.mode === 'map') {
          this._initMapMode();
        } else {
          this._initImageMode(pendingBg.imageSrc, pendingBg.fileName);
        }
        // Store shared course for loading after init and exit early.
        this._sharedCourse = sharedCourse;
        return;
      } catch (e) {
        sessionStorage.removeItem('autocross-pending-background');
      }
    }

    // Check for pending cross-mode import
    const pendingRaw = sessionStorage.getItem('autocross-pending-import');
    let autoMode = undefined;
    if (pendingRaw) {
      try {
        const pending = JSON.parse(pendingRaw);
        autoMode = pending.imageMode ? 'image' : 'map';
      } catch {
        sessionStorage.removeItem('autocross-pending-import');
      }
    }

    // If configured, skip the initial banner and auto-start with a Blank Canvas.
    // This only applies when there's no pending import to process.
    if (window.AUTO_START_BLANK) {
      if (!pendingRaw) {
        const c = document.createElement('canvas');
        c.width = 800;
        c.height = 1280;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        this.mode = 'image';
        this._initImageMode(c.toDataURL('image/png'), 'Blank Canvas');
        this._sharedCourse = sharedCourse;
        return;
      }
    }

    // Show mode selection banner (may auto-select based on pending import)
    const choice = await ImageMode.showBanner(autoMode);
    this.mode = choice.mode;

    if (this.mode === 'map') {
      this._initMapMode();
    } else {
      this._initImageMode(choice.imageSrc, choice.fileName);
    }

    // Store shared course for loading after init
    this._sharedCourse = sharedCourse;
  },

  /** Initialize in normal Mapbox map mode */
  _initMapMode() {
    // Set marker factory to real Mapbox markers
    window.createMarker = (opts) => new mapboxgl.Marker(opts);

    this.map = MapModule.init();

    this.map.on('load', () => {
      this._initModules();

      // Scale cone markers with zoom level
      const BASE_ZOOM = 17;
      const updateMarkerScale = () => {
        const zoom = this.map.getZoom();
        const scale = Math.pow(2, (zoom - BASE_ZOOM) / 2) * 0.75;
        document.documentElement.style.setProperty('--marker-scale', scale);
      };
      this.map.on('zoom', updateMarkerScale);
      updateMarkerScale();
    });
  },

  /** Set up collapsible toolbar sections */
  _setupToolbarSections() {
    const STORAGE_KEY = 'toolbarSectionsCollapsed';
    let collapsed = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) collapsed = JSON.parse(raw);
    } catch (e) {
      collapsed = [];
    }

    document.querySelectorAll('#toolbar .toolbar-section').forEach((section, idx) => {
      const key = section.dataset.section || `toolbar-${idx}`;
      const label = section.querySelector('.toolbar-label');
      if (!label) return;

      label.setAttribute('role', 'button');
      label.tabIndex = 0;

      const isCollapsed = collapsed.includes(key);
      if (isCollapsed) {
        section.classList.add('collapsed');
        label.setAttribute('aria-expanded', 'false');
      } else {
        label.setAttribute('aria-expanded', 'true');
      }

      const toggle = () => {
        const nowCollapsed = section.classList.toggle('collapsed');
        label.setAttribute('aria-expanded', String(!nowCollapsed));
        try {
          if (nowCollapsed) {
            if (!collapsed.includes(key)) collapsed.push(key);
          } else {
            collapsed = collapsed.filter(k => k !== key);
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
        } catch (e) {}
      };

      label.addEventListener('click', (e) => {
        toggle();
      });

      label.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  },

  /** Initialize in image mode with a static image */
  _initImageMode(imageSrc, fileName) {
    this.imageFileName = fileName || 'Untitled';

    // Set marker factory to ImageMarker
    window.createMarker = (opts) => new ImageMarker(opts);

    // Hide search bar (no geo in image mode)
    document.getElementById('search-bar').classList.add('hidden');

    // Show image-mode-only toolbar sections
    document.querySelectorAll('.image-mode-only').forEach(el => el.classList.remove('hidden'));

    // Initialize the fake map adapter
    this.map = ImageMap;
    ImageMap.init('map', imageSrc);

    // Detect DPI from the background image's PNG metadata (async, best-effort)
    this._backgroundDPI = 96;
    fetch(imageSrc)
      .then(r => r.arrayBuffer())
      .then(buf => { this._backgroundDPI = this._parsePNGDPI(buf); })
      .catch(() => {});

    ImageMap.on('load', () => {
      this._initModules();

      // Restore saved scale for this image
      const savedScale = this._loadImageScale();
      if (savedScale) {
        this._setImageScale(savedScale, 'Calibrated (saved)');
      } else {
        // Auto-activate scale tool so user calibrates first
        this._setActiveTool('scale');
      }
    });
  },

  /** Shared module initialization (called after map/image loads) */
  _initModules() {
    Cones.init(this.map, {
      onSelect: (cone) => this._handleConeSelect(cone),
      onUpdate: () => {
        this._redrawStartConeConnectingLine();
        this._redrawStartBeamConnectingLine();
        this._redrawFinishConeConnectingLine();
        this._updateInfo();
      },
      onViewUpdate: () => {
        this._redrawStartConeConnectingLine();
        this._redrawStartBeamConnectingLine();
        this._redrawFinishConeConnectingLine();
      },
    });

    Distance.init(this.map);

    DrivingLine.init(this.map, {
      onUpdate: () => this._updateInfo(),
    });

    // Restore any extra driving lines created before init (e.g. during _loadCourseData)
    // — handled lazily inside _addExtraDrivingLine via the map reference being ready here.

    Measurements.init(this.map);

    Notes.init(this.map, {
      onUpdate: () => this._updateInfo(),
    });

    Grid.init(this.map);

    Obstacles.init(this.map, {
      onUpdate: () => this._updateInfo(),
    });

    Workers.init(this.map, {
      onUpdate: () => this._updateInfo(),
    });

    Layers.init();
    ImageLayers.init(this.map, this.mode);
    Highlights.init(this.map, this.mode, { onUpdate: () => this._updateInfo() });
    StatsOverlay.init(this.map, this.mode);
    ScaleOverlay.init(this.map, this.mode);
    if (this.mode === 'image') ImageCrop.init();
    Selection.init();

    // Wire up map click
    this.map.on('click', (e) => this._handleMapClick(e));

    // Wire up mousemove for distance measurement
    this.map.on('mousemove', (e) => this._handleMouseMove(e));

    // Track shift key state for snap features
    this._shiftDown = false;
    document.addEventListener('keydown', (e) => { if (e.key === 'Shift') this._shiftDown = true; });
    document.addEventListener('keyup',   (e) => { if (e.key === 'Shift') this._shiftDown = false; });

    // Wire up toolbar buttons
    this._setupToolbar();

    // Wire up collapsible toolbar sections
    this._setupToolbarSections();

    // Wire up sidebar
    this._setupSidebar();

    // Wire up collapsible sidebar sections
    this._setupSidebarSections();

    // Wire up course options
    this._setupOptions();

    // Title UI (editable course name)
    this._setupTitleUI();

    // Wire up grid controls
    this._setupGrid();

    // Wire up help dialog
    this._setupHelp();

    // Wire up print
    this._setupPrint();

    // Wire up save/export/import
    this._setupStorage();

    // Wire up keyboard shortcuts
    this._setupKeyboardShortcuts();

    // Wire up map opacity control
    this._setupMapOpacity();

    // Wire up obstacle type selector
    this._setupObstacleSelector();

    // Wire up box selection
    this._setupBoxSelection();

    // Wire up venue buttons
    this._setupVenue();

    // Load saved courses list
    this._refreshSavedList();

    // Set default tool active
    this._setActiveTool('regular');

    // Take initial history snapshot
    History.push();

    // Restore autosaved session if no pending import or shared course
    const pendingImport = sessionStorage.getItem('autocross-pending-import');
    if (!pendingImport && !this._sharedCourse) {
      History.restoreAutosave();
    }

    // Apply pending cross-mode import if present
    const pendingRaw = sessionStorage.getItem('autocross-pending-import');
    if (pendingRaw) {
      sessionStorage.removeItem('autocross-pending-import');
      try {
        const data = JSON.parse(pendingRaw);
        this._loadCourseData(data);
      } catch {}
    }

    // Load shared course if present
    if (this._sharedCourse) {
      this._loadCourseData(this._sharedCourse);
      this._sharedCourse = null;
    }
  },

  _setupOptions() {
    const solidCheckbox = document.getElementById('opt-solid-driving-line');
    if (!solidCheckbox) return;

    solidCheckbox.checked = !!this._solidDrivingLine;
    solidCheckbox.addEventListener('change', () => {
      this._solidDrivingLine = solidCheckbox.checked;
      this._applyDrivingLineStyle();
    });

    this._applyDrivingLineStyle();
  },

  _applyDrivingLineStyle() {
    const solid = !!this._solidDrivingLine;
    const solidCheckbox = document.getElementById('opt-solid-driving-line');
    if (solidCheckbox) {
      solidCheckbox.checked = solid;
    }

    if (typeof DrivingLine !== 'undefined' && DrivingLine.setSolid) {
      DrivingLine.setSolid(solid);
    }
    this._extraDrivingLines.forEach(l => l.setSolid(solid));
    if (typeof ImageMap !== 'undefined' && ImageMap._redrawLineCanvas) {
      ImageMap._redrawLineCanvas();
    }
  },

  /**
   * Factory: create a new extra driving line object (Line 2, Line 3, …).
   * Inline so no extra <script> is needed.
   */
  _makeExtraDrivingLine(index, color) {
    const self = this;
    const sourceId = `driving-line${index}-source`;
    const layerId = `driving-line${index}-layer`;
    const line = {
      index,
      color,
      sourceId,
      layerId,
      waypoints: [],
      _map: null,
      _onUpdate: null,
      _isSolid: false,
      _defaultDashArray: [2, 2],

      init(map, { onUpdate }) {
        this._map = map;
        this._onUpdate = onUpdate;
        const addIt = () => this._addLayer();
        if (map.loaded && map.loaded()) { addIt(); }
        else { map.on('load', addIt); }
      },

      _addLayer() {
        if (this._map.getSource(this.sourceId)) return;
        this._map.addSource(this.sourceId, {
          type: 'geojson',
          data: this._buildGeoJSON(),
        });
        this._map.addLayer({
          id: this.layerId,
          type: 'line',
          paint: {
            'line-color': this.color,
              'line-width': 3,
            'line-dasharray': this._defaultDashArray.slice(),
          },
        });
        this.setSolid(this._isSolid);
      },

      addWaypoint(lngLat) {
        const el = document.createElement('div');
        el.className = 'waypoint-marker-extra';
        const marker = window.createMarker({ element: el, draggable: true })
          .setLngLat(lngLat)
          .addTo(this._map);
        const wp = { lngLat: [lngLat.lng, lngLat.lat], marker };
        marker.on('dragend', () => {
          const pos = marker.getLngLat();
          wp.lngLat = [pos.lng, pos.lat];
          this._updateLine();
          if (this._onUpdate) this._onUpdate();
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          marker.remove();
          const idx = this.waypoints.indexOf(wp);
          if (idx !== -1) this.waypoints.splice(idx, 1);
          this._updateLine();
          if (this._onUpdate) this._onUpdate();
        });
        this.waypoints.push(wp);
        this._updateLine();
        if (this._onUpdate) this._onUpdate();
      },

      clear() {
        this.waypoints.forEach(wp => wp.marker.remove());
        this.waypoints = [];
        this._updateLine();
        if (this._onUpdate) this._onUpdate();
      },

      getData() {
        return this.waypoints.map(wp => ({ lngLat: wp.lngLat }));
      },

      loadData(data) {
        this.clear();
        data.forEach(d => {
          this.addWaypoint({ lng: d.lngLat[0], lat: d.lngLat[1] });
        });
      },

      setSolid(solid) {
        this._isSolid = !!solid;
        if (!this._map || !this._map.getLayer || !this._map.getLayer(this.layerId)) return;
        this._map.setPaintProperty(
          this.layerId,
          'line-dasharray',
          this._isSolid ? null : this._defaultDashArray.slice()
        );
      },

      _updateLine() {
        const src = this._map && this._map.getSource(this.sourceId);
        if (src) src.setData(this._buildGeoJSON());
      },

      destroy() {
        // Remove markers and clear internal state
        try { this.clear(); } catch (e) {}
        // Remove map layer/source if present (mapbox)
        try {
          if (this._map && this._map.getLayer && this._map.getLayer(this.layerId)) {
            this._map.removeLayer(this.layerId);
          }
        } catch (e) {}
        try {
          if (this._map && this._map.getSource && this._map.getSource(this.sourceId)) {
            this._map.removeSource(this.sourceId);
          }
        } catch (e) {}
      },

      _buildGeoJSON() {
        if (this.waypoints.length < 2) return { type: 'FeatureCollection', features: [] };
        const raw = this.waypoints.map(wp => wp.lngLat);
        const smooth = this._catmullRomSpline(raw, 20);
        return {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: smooth } }],
        };
      },

      _catmullRomSpline(points, numSegments) {
        if (points.length < 2) return points.slice();
        const result = [];
        for (let i = 0; i < points.length - 1; i++) {
          const p0 = points[i === 0 ? 0 : i - 1];
          const p1 = points[i];
          const p2 = points[i + 1];
          const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];
          for (let t = 0; t < numSegments; t++) {
            const s = t / numSegments, s2 = s * s, s3 = s2 * s;
            result.push([
              0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*s + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*s2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*s3),
              0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*s + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*s2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*s3),
            ]);
          }
        }
        result.push(points[points.length - 1]);
        return result;
      },
    };
    return line;
  },

  /** Remove all dynamically-added optional driving lines and their UI */
  _resetExtraDrivingLines() {
    this._extraDrivingLines.forEach(line => line.clear());
    this._extraDrivingLines = [];
    this._nextExtraLineIndex = 2;

    document.querySelectorAll('[id^="btn-clear-line"]').forEach((btn) => {
      const index = parseInt(btn.id.replace('btn-clear-line', ''), 10);
      if (!Number.isNaN(index) && index >= 2) btn.remove();
    });
    document.querySelectorAll('.tool-btn[data-tool^="drivingline"]').forEach((btn) => {
      const index = parseInt(btn.dataset.tool.replace('drivingline', ''), 10);
      if (!Number.isNaN(index) && index >= 2) btn.remove();
    });

    if (typeof Layers !== 'undefined' && Layers.clearExtraDrivingLineLayers) {
      Layers.clearExtraDrivingLineLayers();
    }
    if (this.activeTool && this.activeTool.startsWith('drivingline') && this.activeTool !== 'drivingline') {
      this._setActiveTool('drivingline');
    }
  },

  /** Dynamically add a new optional driving line (Line 2, 3, …) */
  _addExtraDrivingLine() {
    // Pick the smallest unused index >= 2 so deleted numbers get reused
    const used = new Set(this._extraDrivingLines.map(l => l.index));
    let idx = 2;
    while (used.has(idx)) idx++;
    const color = this._extraLineColors[(idx - 2) % this._extraLineColors.length];
    const line = this._makeExtraDrivingLine(idx, color);
    this._extraDrivingLines.push(line);
    // Keep nextExtraLineIndex at least one past the highest seen (for compatibility)
    this._nextExtraLineIndex = Math.max(this._nextExtraLineIndex || 2, idx + 1);

    // Init with current map — map is always ready by the time a user clicks the button
    line.init(this.map, { onUpdate: () => this._updateInfo() });
    line.setSolid(this._solidDrivingLine);

    // Inject toolbar buttons
    const section = document.querySelector('.toolbar-section[data-section="driving-line"]');
    const drawBtn = document.createElement('button');
    drawBtn.className = 'tool-btn';
    drawBtn.dataset.tool = `drivingline${idx}`;
    drawBtn.title = `Draw Driving Line ${idx}`;
    drawBtn.innerHTML = `<span class="tool-icon" style="color:${color}">&#10137;</span> Line ${idx}`;
    drawBtn.addEventListener('click', () => this._setActiveTool(`drivingline${idx}`));

    const clearBtn = document.createElement('button');
    clearBtn.className = 'tool-btn';
    clearBtn.id = `btn-clear-line${idx}`;
    clearBtn.title = `Delete Driving Line ${idx}`;
    clearBtn.innerHTML = `<span class="tool-icon" style="color:${color}">&#10060;</span> Delete Line ${idx}`;
    clearBtn.addEventListener('click', () => {
      History.push();
      // Destroy the line (remove markers, layer, source)
      try { if (line && typeof line.destroy === 'function') line.destroy(); else if (line && typeof line.clear === 'function') line.clear(); } catch (e) {}
      // Remove the layer entry from Layers panel
      if (typeof Layers !== 'undefined' && Layers.removeExtraDrivingLineLayer) {
        try { Layers.removeExtraDrivingLineLayer(idx); } catch (e) {}
      }
      // Remove toolbar buttons
      try { drawBtn.remove(); } catch (e) {}
      try { clearBtn.remove(); } catch (e) {}
      // Remove from App state
      try { this._extraDrivingLines = this._extraDrivingLines.filter(l => l.index !== idx); } catch (e) {}
      // Revert active tool if it was the deleted line
      try { if (this.activeTool === `drivingline${idx}`) this._setActiveTool('drivingline'); } catch (e) {}
      // Redraw image-mode canvas if applicable
      try { if (typeof ImageMap !== 'undefined' && ImageMap._redrawLineCanvas) ImageMap._redrawLineCanvas(); } catch (e) {}
    });

    // Insert buttons under the "Add optional line" button (#btn-add-optional-line)
    // Keep extras in ascending numeric order (lowest -> highest) immediately after that add button.
    const addBtn = section.querySelector('#btn-add-optional-line');
    if (addBtn) {
      let insertBeforeEl = null;
      let lastExtraEl = null;
      let el = addBtn.nextElementSibling;
      while (el) {
        let n = NaN;
        const t = el.dataset && el.dataset.tool ? el.dataset.tool : '';
        if (t && t.startsWith('drivingline')) {
          n = parseInt(t.slice('drivingline'.length), 10);
        } else if (el.id && el.id.startsWith('btn-clear-line')) {
          n = parseInt(el.id.slice('btn-clear-line'.length), 10);
        }
        if (!Number.isNaN(n)) {
          lastExtraEl = el;
          if (n > idx) { insertBeforeEl = el; break; }
        }
        el = el.nextElementSibling;
      }

      if (insertBeforeEl) {
        section.insertBefore(drawBtn, insertBeforeEl);
        section.insertBefore(clearBtn, insertBeforeEl);
      } else if (lastExtraEl) {
        const ref = lastExtraEl.nextElementSibling;
        if (ref) { section.insertBefore(drawBtn, ref); section.insertBefore(clearBtn, ref); }
        else { section.appendChild(drawBtn); section.appendChild(clearBtn); }
      } else {
        const ref = addBtn.nextElementSibling;
        if (ref) { section.insertBefore(drawBtn, ref); section.insertBefore(clearBtn, ref); }
        else { section.appendChild(drawBtn); section.appendChild(clearBtn); }
      }
    } else {
      // Fallback: add button not found — append in numeric order across the section
      let found = false;
      const buttons = Array.from(section.querySelectorAll('.tool-btn'));
      for (const b of buttons) {
        const t = b.dataset && b.dataset.tool ? b.dataset.tool : '';
        if (t && t.startsWith('drivingline')) {
          const n = parseInt(t.slice('drivingline'.length), 10);
          if (!Number.isNaN(n) && n > idx) { section.insertBefore(drawBtn, b); section.insertBefore(clearBtn, b); found = true; break; }
        }
        if (b.id && b.id.startsWith('btn-clear-line')) {
          const n = parseInt(b.id.slice('btn-clear-line'.length), 10);
          if (!Number.isNaN(n) && n > idx) { section.insertBefore(drawBtn, b); section.insertBefore(clearBtn, b); found = true; break; }
        }
      }
      if (!found) { section.appendChild(drawBtn); section.appendChild(clearBtn); }
    }

    // Add to layers panel
    if (typeof Layers !== 'undefined' && Layers.addExtraDrivingLineLayer) {
      Layers.addExtraDrivingLineLayer(idx, line);
    }

    return line;
  },

  /** Handle click on the map */
  _handleMapClick(e) {
    // Guard against spurious clicks fired by Mapbox after a rotation handle mouseup
    if (this._suppressNextClick) { this._suppressNextClick = false; return; }
    const lngLat = e.lngLat;

    switch (this.activeTool) {
      case 'regular':
      case 'trailer':
      case 'cleartext':
      case 'staging-grid':
        History.push();
        const cone = Cones.place(this.activeTool, lngLat);
        if (this.activeTool === 'trailer' || this.activeTool === 'cleartext') {
          const text = prompt('Enter text to display:', '');
          if ((text === null) || (this.activeTool === 'cleartext' && text.trim() === '')) {
            Cones.remove(cone.id);
            History.undo();
            break;
          }
          cone.text = text;
          Cones._updateTrailerText(cone);
        }
        break;

      case 'start-beam':
        this._handleStartBeamClick(lngLat);
        break;

      case 'finish-cone':
        this._handleFinishConeClick(lngLat);
        break;

      case 'start-cone':
        this._handleStartConeClick(lngLat);
        break;

      case 'gate':
        this._handleGateClick(lngLat);
        break;

      case 'pointer':
        this._handlePointerClick(lngLat, this._shiftDown);
        break;

      case 'leaner':
        this._handleLeanerClick(lngLat, this._shiftDown);
        break;

      case 'leaner-set':
        this._handleLeanerSetClick(lngLat, this._shiftDown);
        break;

      case 'slalom':
        this._handleSlalomClick(lngLat, this._shiftDown);
        break;

      case 'obstacle':
        History.push();
        Obstacles.placeObstacle(lngLat);
        break;

      case 'worker':
        History.push();
        Workers.placeStation(lngLat);
        this._updateInfo();
        break;

      case 'select':
        // Clicking on empty map deselects without switching tools
        this._deselectCone();
        Selection.clear();
        break;

      case 'drivingline':
        History.push();
        DrivingLine.addWaypoint(lngLat, e.point);
        break;

      default:
        // Handle dynamically-created extra driving line tools (drivinglineN for N >= 2)
        if (this.activeTool && this.activeTool.startsWith('drivingline')) {
          const extraIdx = parseInt(this.activeTool.slice('drivingline'.length), 10);
          if (extraIdx >= 2) {
            const extraLine = this._extraDrivingLines.find(l => l.index === extraIdx);
            if (extraLine) {
              History.push();
              extraLine.addWaypoint(lngLat, e.point);
            }
          }
        }
        break;

      case 'measure':
        Measurements.handleClick(lngLat, e.point);
        break;
      case 'note':
        History.push();
        Notes.addNote(lngLat);
        break;

      case 'highlight':
        Highlights.addVertex(lngLat, e.point);
        break;

      case 'scale':
        this._handleScaleClick(lngLat, e.point);
        break;
    }
  },

  /** Handle cone selection */
  _handleConeSelect(cone) {
    if (this.activeTool === 'measure') {
      // Use the cone's exact position for measurement
      Measurements.handleClick({ lng: cone.lngLat[0], lat: cone.lngLat[1] }, null);
      return;
    }

    if (this.activeTool === 'select') {
      // Toggle selection
      if (this.selectedCone && this.selectedCone.id === cone.id) {
        this._deselectCone();
      } else {
        this.selectedCone = cone;
        Cones.setSelected(cone);
        Distance.setSelected(cone);
      }
    }
  },

  /** Deselect current cone */
  _deselectCone() {
    this.selectedCone = null;
    Cones.setSelected(null);
    Distance.setSelected(null);
    Distance.hideLabel();
  },

  /** Handle deletion of a cone, removing pairs and lines if necessary */
  handleConeDelete(coneId) {
    console.log('Deleting cone with ID:', coneId);
    // Check if this cone is part of a start cone pair
    if (this._currentStartConePair.includes(coneId)) {
      const idsToRemove = [...this._currentStartConePair];
      this._currentStartConePair = [];
      this._removeStartConeConnectingLine();
      for (const id of idsToRemove) {
        Cones.remove(id);
      }
      return;
    }

    // Check if this cone is part of a start beam pair
    if (this._currentStartBeamPair.includes(coneId)) {
      const idsToRemove = [...this._currentStartBeamPair];
      this._currentStartBeamPair = [];
      this._removeStartBeamConnectingLine();
      for (const id of idsToRemove) {
        Cones.remove(id);
      }
      return;
    }

    // Check if this cone is part of a finish cone pair
    if (this._currentFinishConePair.includes(coneId)) {
      const idsToRemove = [...this._currentFinishConePair];
      this._currentFinishConePair = [];
      this._removeFinishConeConnectingLine();
      for (const id of idsToRemove) {
        Cones.remove(id);
      }
      return;
    }

    // Regular cone deletion
    Cones.remove(coneId);
  },

  /** Handle mousemove for distance labels and preview lines */
  _handleMouseMove(e) {
    const lngLat = e.lngLat;

    // Slalom preview line
    if (this.activeTool === 'slalom' && this._slalomStart) {
      const previewEnd = this._shiftDown ? this._snapSlalomAngle(this._slalomStart, lngLat) : lngLat;
      this._showPreviewLine(this._slalomStart, previewEnd);
      const dist = this._calcDistanceFeet(this._slalomStart, previewEnd);
      if (dist !== null) {
        this._showPreviewLabel(e.point, `${dist.toFixed(1)} ft`);
      }
      return;
    }

    // Leaner Set preview line
    if (this.activeTool === 'leaner-set' && this._leanerSetStart) {
      const previewEnd = this._shiftDown ? this._snapSlalomAngle(this._leanerSetStart, lngLat) : lngLat;
      this._showPreviewLine(this._leanerSetStart, previewEnd);
      const dist = this._calcDistanceFeet(this._leanerSetStart, previewEnd);
      if (dist !== null) {
        this._showPreviewLabel(e.point, `${dist.toFixed(1)} ft`);
      }
      return;
    }

    // Pointer preview line
    if (this.activeTool === 'pointer' && this._pointerStart) {
      const previewEnd = this._shiftDown ? this._snapSlalomAngle(this._pointerStart.lngLat, lngLat) : lngLat;
      this._showPreviewLine(this._pointerStart.lngLat, previewEnd);
      return;
    }

    // Leaner preview line
    if (this.activeTool === 'leaner' && this._leanerStart) {
      const previewEnd = this._shiftDown ? this._snapSlalomAngle(this._leanerStart, lngLat) : lngLat;
      this._showPreviewLine(this._leanerStart, previewEnd);
      return;
    }

    // Gate preview line
    if (this.activeTool === 'gate' && this._gateCenter) {
      this._showPreviewLine(this._gateCenter, lngLat);
      return;
    }

    // Start-cone preview line
    if (this.activeTool === 'start-cone' && this._startConeStart) {
      this._showPreviewLine(this._startConeStart, lngLat);
      return;
    }

    // Start-beam preview line
    if (this.activeTool === 'start-beam' && this._startBeamStart) {
      this._showPreviewLine(this._startBeamStart, lngLat);
      return;
    }

    // Finish-cone preview line
    if (this.activeTool === 'finish-cone' && this._finishConeStart) {
      this._showPreviewLine(this._finishConeStart, lngLat);
      return;
    }

    // Measure tool preview line + real-time distance
    if (this.activeTool === 'measure' && Measurements._pendingPoint) {
      const from = { lng: Measurements._pendingPoint[0], lat: Measurements._pendingPoint[1] };
      this._showPreviewLine(from, lngLat);
      const dist = this._calcDistanceFeet(from, lngLat);
      if (dist !== null) {
        this._showPreviewLabel(e.point, `${dist.toFixed(1)} ft`);
      }
      return;
    }

    // CourseOutline tool removed; no outline preview

    if (this.activeTool !== 'select' || !this.selectedCone) return;
    if (this.mode === 'image' && !ImageMap.hasScale()) return;

    // Find if hovering near another cone
    const hoverCone = this._findConeNear(e.point);
    if (hoverCone && hoverCone.id !== this.selectedCone.id) {
      Distance.showDistanceTo(hoverCone.lngLat);
    } else {
      Distance.hideLabel();
    }
  },

  /** Find a cone near a screen point (within ~20px) */
  _findConeNear(point) {
    let closest = null;
    let minDist = 25; // pixel threshold

    for (const cone of Cones.cones) {
      const projected = this.map.project(cone.lngLat);
      const dx = projected.x - point.x;
      const dy = projected.y - point.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < minDist) {
        minDist = dist;
        closest = cone;
      }
    }
    return closest;
  },

  // ===== Preview Line Helper =====

  /** Show a rubber-band preview line between two lngLat points */
  _showPreviewLine(from, to) {
    const p1 = this.map.project(from);
    const p2 = this.map.project(to);

    if (!this._previewLine) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:15;pointer-events:none;';
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('stroke', '#3b82f6');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6,4');
      svg.appendChild(line);
      document.body.appendChild(svg);
      this._previewLine = svg;
    }

    const line = this._previewLine.querySelector('line');
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', p2.y);
  },

  /** Show a floating label near the cursor for preview */
  _showPreviewLabel(point, text) {
    const label = document.getElementById('distance-label');
    label.textContent = text;
    label.style.left = (point.x + 15) + 'px';
    label.style.top = (point.y - 10) + 'px';
    label.classList.remove('hidden');
  },

  /** Hide the preview line and label */
  _hidePreviewLine() {
    if (this._previewLine) {
      this._previewLine.remove();
      this._previewLine = null;
    }
    Distance.hideLabel();
  },

  /** Draw a thin black line connecting two cones by their lngLat positions */
  /** Create and insert a connecting line SVG, handling map vs image mode */
  _createLineSVG(lngLat1, lngLat2, color) {
    let x1, y1, x2, y2, container, cssText;
    if (this.mode === 'image') {
      // Use raw image pixel coords inside .image-wrapper (before marker container)
      x1 = lngLat1[0]; y1 = lngLat1[1];
      x2 = lngLat2[0]; y2 = lngLat2[1];
      container = document.querySelector('.image-wrapper');
      cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;';
    } else {
      const p1 = this.map.project(lngLat1);
      const p2 = this.map.project(lngLat2);
      x1 = p1.x; y1 = p1.y;
      x2 = p2.x; y2 = p2.y;
      container = document.getElementById('map');
      cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;';
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = cssText;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '1');
    svg.appendChild(line);
    if (this.mode === 'image') {
      // Insert before .image-marker-container so markers stay on top
      const markerContainer = container && container.querySelector('.image-marker-container');
      if (markerContainer) {
        container.insertBefore(svg, markerContainer);
      } else if (container) {
        container.appendChild(svg);
      }
    } else {
      container.prepend(svg);
    }
    return svg;
  },

  _drawStartConeConnectingLine(cone1LngLat, cone2LngLat) {
    // Remove existing line (ensure any drag handlers are cleaned up)
    if (this._startConeLineElement) {
      try { if (this._startConeLineElement._startConeDragCleanup) this._startConeLineElement._startConeDragCleanup(); } catch (e) {}
      this._startConeLineElement.remove();
      this._startConeLineElement = null;
    }

    // const toXY = (lngLat) => this.mode === 'image'
    //   ? { x: lngLat[0] ?? lngLat.lng, y: lngLat[1] ?? lngLat.lat }
    //   : this.map.project(lngLat);

    // const p1 = toXY(cone1LngLat);
    // const p2 = toXY(cone2LngLat);
    // const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    // const inset = 4;

    // this._startConeLineElement = this._createLineSVG(
    //   [p1.x + Math.cos(angle) * inset, p1.y + Math.sin(angle) * inset],
    //   [p2.x - Math.cos(angle) * inset, p2.y - Math.sin(angle) * inset],
    //   startLineColor
    // );
    this._startConeLineElement = this._createLineSVG(
      Array.isArray(cone1LngLat) ? cone1LngLat : [cone1LngLat.lng, cone1LngLat.lat],
      Array.isArray(cone2LngLat) ? cone2LngLat : [cone2LngLat.lng, cone2LngLat.lat],
      startLineColor
    );

    // Make the start-line interactive so dragging it moves both cones and hover shows rotate handle.
    try {
      const svg = this._startConeLineElement;
      svg.style.pointerEvents = 'none';
      svg.style.cursor = 'default';
      const lineEl = svg.querySelector('line');
      if (lineEl) {
        lineEl.style.cursor = 'move';
        lineEl.style.pointerEvents = 'auto';
      }

      if (svg._startConeDragCleanup) {
        svg._startConeDragCleanup();
        svg._startConeDragCleanup = null;
      }

      const mapAdapter = (this.mode === 'image') ? ImageMap : this.map;

      let startX = 0, startY = 0;
      let p1Screen = null, p2Screen = null;
      let p1Cone = null, p2Cone = null;

      const onMove = (clientX, clientY) => {
        if (!p1Screen || !p2Screen) return;
        const dx = clientX - startX;
        const dy = clientY - startY;

        const newP1 = { x: p1Screen.x + dx, y: p1Screen.y + dy };
        const newP2 = { x: p2Screen.x + dx, y: p2Screen.y + dy };

        const lngLat1 = mapAdapter.unproject ? mapAdapter.unproject(newP1) : this.map.unproject(newP1);
        const lngLat2 = mapAdapter.unproject ? mapAdapter.unproject(newP2) : this.map.unproject(newP2);

        try {
          if (p1Cone && p1Cone.marker && typeof p1Cone.marker.setLngLat === 'function') {
            p1Cone.marker.setLngLat(lngLat1);
            p1Cone.lngLat = [lngLat1.lng, lngLat1.lat];
          }
          if (p2Cone && p2Cone.marker && typeof p2Cone.marker.setLngLat === 'function') {
            p2Cone.marker.setLngLat(lngLat2);
            p2Cone.lngLat = [lngLat2.lng, lngLat2.lat];
          }
        } catch (e) {}

        const proj1 = mapAdapter.project ? mapAdapter.project(p1Cone.lngLat) : this.map.project(p1Cone.lngLat);
        const proj2 = mapAdapter.project ? mapAdapter.project(p2Cone.lngLat) : this.map.project(p2Cone.lngLat);
        try {
          const ln = svg.querySelector('line');
          if (ln) {
            ln.setAttribute('x1', proj1.x);
            ln.setAttribute('y1', proj1.y);
            ln.setAttribute('x2', proj2.x);
            ln.setAttribute('y2', proj2.y);
          }
        } catch (e) {}

        if (typeof Measurements !== 'undefined') {
          Measurements.updateConePosition(p1Cone.id, p1Cone.lngLat);
          Measurements.updateConePosition(p2Cone.id, p2Cone.lngLat);
        }
      };

      const onMouseMove = (e) => { e.preventDefault(); onMove(e.clientX, e.clientY); };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (this._onUpdate) this._onUpdate();
        try { this._redrawStartConeConnectingLine(); } catch (ex) {}
        this._suppressNextClick = true;
        try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = true; } catch (ex) {}
        setTimeout(() => {
          this._suppressNextClick = false;
          try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = false; } catch (ex) {}
        }, 300);
      };

      const onTouchMove = (e) => {
        if (!e.touches || e.touches.length === 0) return;
        e.preventDefault();
        onMove(e.touches[0].clientX, e.touches[0].clientY);
      };
      const onTouchEnd = () => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        if (this._onUpdate) this._onUpdate();
        try { this._redrawStartConeConnectingLine(); } catch (ex) {}
        this._suppressNextClick = true;
        try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = true; } catch (ex) {}
        setTimeout(() => {
          this._suppressNextClick = false;
          try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = false; } catch (ex) {}
        }, 300);
      };

      const startDrag = (e) => {
        if (e.type === 'mousedown' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();

        if (!this._currentStartConePair || this._currentStartConePair.length !== 2) return;
        p1Cone = Cones.cones.find(c => c.id === this._currentStartConePair[0]);
        p2Cone = Cones.cones.find(c => c.id === this._currentStartConePair[1]);
        if (!p1Cone || !p2Cone) return;

        p1Screen = mapAdapter.project ? mapAdapter.project(p1Cone.lngLat) : this.map.project(p1Cone.lngLat);
        p2Screen = mapAdapter.project ? mapAdapter.project(p2Cone.lngLat) : this.map.project(p2Cone.lngLat);

        if (e.type === 'mousedown') {
          startX = e.clientX;
          startY = e.clientY;
          try { History.push(); } catch (ex) {}
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        } else if (e.type === 'touchstart') {
          if (!e.touches || e.touches.length === 0) return;
          startX = e.touches[0].clientX;
          startY = e.touches[0].clientY;
          try { History.push(); } catch (ex) {}
          document.addEventListener('touchmove', onTouchMove, { passive: false });
          document.addEventListener('touchend', onTouchEnd);
        }
      };

      if (lineEl) {
        lineEl.addEventListener('mousedown', startDrag);
        lineEl.addEventListener('touchstart', startDrag, { passive: false });
      }

      svg._startConeDragCleanup = () => {
        try { if (lineEl) lineEl.removeEventListener('mousedown', startDrag); } catch (e) {}
        try { if (lineEl) lineEl.removeEventListener('touchstart', startDrag); } catch (e) {}
        try { document.removeEventListener('mousemove', onMouseMove); } catch (e) {}
        try { document.removeEventListener('mouseup', onMouseUp); } catch (e) {}
        try { document.removeEventListener('touchmove', onTouchMove); } catch (e) {}
        try { document.removeEventListener('touchend', onTouchEnd); } catch (e) {}
      };
    } catch (e) {}

  },

  /** Remove the start-cone connecting line */
  _removeStartConeConnectingLine() {
    if (this._startConeLineElement) {
      try {
        if (this._startConeLineElement._startConeDragCleanup) this._startConeLineElement._startConeDragCleanup();
      } catch (e) {}
      this._startConeLineElement.remove();
      this._startConeLineElement = null;
    }
  },

  /** Draw a blue line connecting two start-beam pylons by their lngLat positions */
  _drawStartBeamConnectingLine(pylon1LngLat, pylon2LngLat) {
    // Remove existing line (ensure any drag handlers are cleaned up)
    if (this._startBeamLineElement) {
      try { if (this._startBeamLineElement._startBeamDragCleanup) this._startBeamLineElement._startBeamDragCleanup(); } catch (e) {}
      this._startBeamLineElement.remove();
      this._startBeamLineElement = null;
    }

    this._startBeamLineElement = this._createLineSVG(
      Array.isArray(pylon1LngLat) ? pylon1LngLat : [pylon1LngLat.lng, pylon1LngLat.lat],
      Array.isArray(pylon2LngLat) ? pylon2LngLat : [pylon2LngLat.lng, pylon2LngLat.lat],
      startBeamColor
    );

    // Make the start-beam connecting line interactive so dragging it moves both pylons
    try {
      const svg = this._startBeamLineElement;
      // Let clicks pass through the SVG except on the actual line element.
      svg.style.pointerEvents = 'none';
      svg.style.cursor = 'default';
      const lineEl = svg.querySelector('line');
      if (lineEl) {
        lineEl.style.cursor = 'move';
        lineEl.style.pointerEvents = 'auto';
      }

      // Clean up any previous handlers
      if (svg._startBeamDragCleanup) {
        svg._startBeamDragCleanup();
        svg._startBeamDragCleanup = null;
      }

      const mapAdapter = (this.mode === 'image') ? ImageMap : this.map;

      let startX = 0, startY = 0;
      let p1Screen = null, p2Screen = null;
      let p1Cone = null, p2Cone = null;

      const onMove = (clientX, clientY) => {
        if (!p1Screen || !p2Screen) return;
        const dx = clientX - startX;
        const dy = clientY - startY;

        const newP1 = { x: p1Screen.x + dx, y: p1Screen.y + dy };
        const newP2 = { x: p2Screen.x + dx, y: p2Screen.y + dy };

        // Convert back to lng/lat (or image pixel coords)
        const lngLat1 = mapAdapter.unproject ? mapAdapter.unproject(newP1) : this.map.unproject(newP1);
        const lngLat2 = mapAdapter.unproject ? mapAdapter.unproject(newP2) : this.map.unproject(newP2);

        // Update cone markers and internal positions
        try {
          if (p1Cone && p1Cone.marker && typeof p1Cone.marker.setLngLat === 'function') {
            p1Cone.marker.setLngLat(lngLat1);
            p1Cone.lngLat = [lngLat1.lng, lngLat1.lat];
          }
          if (p2Cone && p2Cone.marker && typeof p2Cone.marker.setLngLat === 'function') {
            p2Cone.marker.setLngLat(lngLat2);
            p2Cone.lngLat = [lngLat2.lng, lngLat2.lat];
          }
        } catch (e) {}

        // Update the SVG line positions (use projected screen coords)
        const proj1 = mapAdapter.project ? mapAdapter.project(p1Cone.lngLat) : this.map.project(p1Cone.lngLat);
        const proj2 = mapAdapter.project ? mapAdapter.project(p2Cone.lngLat) : this.map.project(p2Cone.lngLat);
        try {
          const ln = svg.querySelector('line');
          if (ln) {
            ln.setAttribute('x1', proj1.x);
            ln.setAttribute('y1', proj1.y);
            ln.setAttribute('x2', proj2.x);
            ln.setAttribute('y2', proj2.y);
          }
        } catch (e) {}

        if (typeof Measurements !== 'undefined') {
          Measurements.updateConePosition(p1Cone.id, p1Cone.lngLat);
          Measurements.updateConePosition(p2Cone.id, p2Cone.lngLat);
        }
      };

      const onMouseMove = (e) => { e.preventDefault(); onMove(e.clientX, e.clientY); };
      const onMouseUp = (e) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // finalize
        if (this._onUpdate) this._onUpdate();
        try { this._redrawStartBeamConnectingLine(); } catch (ex) {}
        // Suppress the synthetic click after drag so a new start-beam isn't created.
        this._suppressNextClick = true;
        try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = true; } catch (ex) {}
        setTimeout(() => { this._suppressNextClick = false; try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = false; } catch (ex) {} }, 300);
      };

      const onTouchMove = (e) => { if (!e.touches || e.touches.length === 0) return; e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); };
      const onTouchEnd = (e) => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        if (this._onUpdate) this._onUpdate();
        try { this._redrawStartBeamConnectingLine(); } catch (ex) {}
        this._suppressNextClick = true;
        try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = true; } catch (ex) {}
        setTimeout(() => { this._suppressNextClick = false; try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = false; } catch (ex) {} }, 300);
      };

      const startDrag = (e) => {
        // Only start on left mouse or single touch
        if (e.type === 'mousedown' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();

        // Identify cones
        if (!this._currentStartBeamPair || this._currentStartBeamPair.length !== 2) return;
        p1Cone = Cones.cones.find(c => c.id === this._currentStartBeamPair[0]);
        p2Cone = Cones.cones.find(c => c.id === this._currentStartBeamPair[1]);
        if (!p1Cone || !p2Cone) return;

        // Record starting positions in screen coords
        p1Screen = (mapAdapter.project) ? mapAdapter.project(p1Cone.lngLat) : this.map.project(p1Cone.lngLat);
        p2Screen = (mapAdapter.project) ? mapAdapter.project(p2Cone.lngLat) : this.map.project(p2Cone.lngLat);

        if (e.type === 'mousedown') {
          startX = e.clientX; startY = e.clientY;
          // push history snapshot for undo
          try { History.push(); } catch (ex) {}
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        } else if (e.type === 'touchstart') {
          if (!e.touches || e.touches.length === 0) return;
          startX = e.touches[0].clientX; startY = e.touches[0].clientY;
          try { History.push(); } catch (ex) {}
          document.addEventListener('touchmove', onTouchMove, { passive: false });
          document.addEventListener('touchend', onTouchEnd);
        }
      };

      if (lineEl) {
        lineEl.addEventListener('mousedown', startDrag);
        lineEl.addEventListener('touchstart', startDrag, { passive: false });
      }

      // Provide a cleanup function in case the SVG is removed/replaced
      svg._startBeamDragCleanup = () => {
        try { if (lineEl) lineEl.removeEventListener('mousedown', startDrag); } catch (e) {}
        try { if (lineEl) lineEl.removeEventListener('touchstart', startDrag); } catch (e) {}
        try { document.removeEventListener('mousemove', onMouseMove); } catch (e) {}
        try { document.removeEventListener('mouseup', onMouseUp); } catch (e) {}
        try { document.removeEventListener('touchmove', onTouchMove); } catch (e) {}
        try { document.removeEventListener('touchend', onTouchEnd); } catch (e) {}
      };
    } catch (e) {}
  },

  /** Remove the start-beam connecting line */
  _removeStartBeamConnectingLine() {
    if (this._startBeamLineElement) {
      try {
        if (this._startBeamLineElement._startBeamDragCleanup) this._startBeamLineElement._startBeamDragCleanup();
      } catch (e) {}
      this._startBeamLineElement.remove();
      this._startBeamLineElement = null;
    }
  },

  /** Redraw the start-beam connecting line if a pair exists */
  _redrawStartBeamConnectingLine() {
    if (this._currentStartBeamPair && this._currentStartBeamPair.length === 2) {
      const pylon1 = Cones.cones.find(c => c.id === this._currentStartBeamPair[0]);
      const pylon2 = Cones.cones.find(c => c.id === this._currentStartBeamPair[1]);
      if (pylon1 && pylon2) {
        this._drawStartBeamConnectingLine(pylon1.lngLat, pylon2.lngLat);
      }
    }
  },

  /** Draw a blue line connecting two finish cones by their lngLat positions */
  _drawFinishConeConnectingLine(cone1LngLat, cone2LngLat) {
    // Remove existing line (ensure any drag handlers are cleaned up)
    if (this._finishConeLineElement) {
      try { if (this._finishConeLineElement._finishConeDragCleanup) this._finishConeLineElement._finishConeDragCleanup(); } catch (e) {}
      this._finishConeLineElement.remove();
      this._finishConeLineElement = null;
    }

    this._finishConeLineElement = this._createLineSVG(
      Array.isArray(cone1LngLat) ? cone1LngLat : [cone1LngLat.lng, cone1LngLat.lat],
      Array.isArray(cone2LngLat) ? cone2LngLat : [cone2LngLat.lng, cone2LngLat.lat],
      finishLineColor
    );

    // Make the finish-cone connecting line interactive so dragging it moves both cones
    try {
      const svg = this._finishConeLineElement;
      // Let clicks pass through the SVG except on the actual line element.
      svg.style.pointerEvents = 'none';
      svg.style.cursor = 'default';
      const lineEl = svg.querySelector('line');
      if (lineEl) {
        lineEl.style.cursor = 'move';
        lineEl.style.pointerEvents = 'auto';
      }

      // Clean up any previous handlers
      if (svg._finishConeDragCleanup) {
        svg._finishConeDragCleanup();
        svg._finishConeDragCleanup = null;
      }

      const mapAdapter = (this.mode === 'image') ? ImageMap : this.map;

      let startX = 0, startY = 0;
      let p1Screen = null, p2Screen = null;
      let p1Cone = null, p2Cone = null;

      const onMove = (clientX, clientY) => {
        if (!p1Screen || !p2Screen) return;
        const dx = clientX - startX;
        const dy = clientY - startY;

        const newP1 = { x: p1Screen.x + dx, y: p1Screen.y + dy };
        const newP2 = { x: p2Screen.x + dx, y: p2Screen.y + dy };

        // Convert back to lng/lat (or image pixel coords)
        const lngLat1 = mapAdapter.unproject ? mapAdapter.unproject(newP1) : this.map.unproject(newP1);
        const lngLat2 = mapAdapter.unproject ? mapAdapter.unproject(newP2) : this.map.unproject(newP2);

        // Update cone markers and internal positions
        try {
          if (p1Cone && p1Cone.marker && typeof p1Cone.marker.setLngLat === 'function') {
            p1Cone.marker.setLngLat(lngLat1);
            p1Cone.lngLat = [lngLat1.lng, lngLat1.lat];
          }
          if (p2Cone && p2Cone.marker && typeof p2Cone.marker.setLngLat === 'function') {
            p2Cone.marker.setLngLat(lngLat2);
            p2Cone.lngLat = [lngLat2.lng, lngLat2.lat];
          }
        } catch (e) {}

        // Update the SVG line positions (use projected screen coords)
        const proj1 = mapAdapter.project ? mapAdapter.project(p1Cone.lngLat) : this.map.project(p1Cone.lngLat);
        const proj2 = mapAdapter.project ? mapAdapter.project(p2Cone.lngLat) : this.map.project(p2Cone.lngLat);
        try {
          const ln = svg.querySelector('line');
          if (ln) {
            ln.setAttribute('x1', proj1.x);
            ln.setAttribute('y1', proj1.y);
            ln.setAttribute('x2', proj2.x);
            ln.setAttribute('y2', proj2.y);
          }
        } catch (e) {}

        if (typeof Measurements !== 'undefined') {
          Measurements.updateConePosition(p1Cone.id, p1Cone.lngLat);
          Measurements.updateConePosition(p2Cone.id, p2Cone.lngLat);
        }
      };

      const onMouseMove = (e) => { e.preventDefault(); onMove(e.clientX, e.clientY); };
      const onMouseUp = (e) => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        // finalize
        if (this._onUpdate) this._onUpdate();
        try { this._redrawFinishConeConnectingLine(); } catch (ex) {}
        // Suppress the synthetic click after drag so a new finish-beam isn't created.
        this._suppressNextClick = true;
        try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = true; } catch (ex) {}
        setTimeout(() => { this._suppressNextClick = false; try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = false; } catch (ex) {} }, 300);
      };

      const onTouchMove = (e) => { if (!e.touches || e.touches.length === 0) return; e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); };
      const onTouchEnd = (e) => {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        if (this._onUpdate) this._onUpdate();
        try { this._redrawFinishConeConnectingLine(); } catch (ex) {}
        this._suppressNextClick = true;
        try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = true; } catch (ex) {}
        setTimeout(() => { this._suppressNextClick = false; try { if (mapAdapter && typeof mapAdapter._suppressNextClick !== 'undefined') mapAdapter._suppressNextClick = false; } catch (ex) {} }, 300);
      };

      const startDrag = (e) => {
        // Only start on left mouse or single touch
        if (e.type === 'mousedown' && e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();

        // Identify cones
        if (!this._currentFinishConePair || this._currentFinishConePair.length !== 2) return;
        p1Cone = Cones.cones.find(c => c.id === this._currentFinishConePair[0]);
        p2Cone = Cones.cones.find(c => c.id === this._currentFinishConePair[1]);
        if (!p1Cone || !p2Cone) return;

        // Record starting positions in screen coords
        p1Screen = (mapAdapter.project) ? mapAdapter.project(p1Cone.lngLat) : this.map.project(p1Cone.lngLat);
        p2Screen = (mapAdapter.project) ? mapAdapter.project(p2Cone.lngLat) : this.map.project(p2Cone.lngLat);

        if (e.type === 'mousedown') {
          startX = e.clientX; startY = e.clientY;
          // push history snapshot for undo
          try { History.push(); } catch (ex) {}
          document.addEventListener('mousemove', onMouseMove);
          document.addEventListener('mouseup', onMouseUp);
        } else if (e.type === 'touchstart') {
          if (!e.touches || e.touches.length === 0) return;
          startX = e.touches[0].clientX; startY = e.touches[0].clientY;
          try { History.push(); } catch (ex) {}
          document.addEventListener('touchmove', onTouchMove, { passive: false });
          document.addEventListener('touchend', onTouchEnd);
        }
      };

      if (lineEl) {
        lineEl.addEventListener('mousedown', startDrag);
        lineEl.addEventListener('touchstart', startDrag, { passive: false });
      }

      // Provide a cleanup function in case the SVG is removed/replaced
      svg._finishConeDragCleanup = () => {
        try { if (lineEl) lineEl.removeEventListener('mousedown', startDrag); } catch (e) {}
        try { if (lineEl) lineEl.removeEventListener('touchstart', startDrag); } catch (e) {}
        try { document.removeEventListener('mousemove', onMouseMove); } catch (e) {}
        try { document.removeEventListener('mouseup', onMouseUp); } catch (e) {}
        try { document.removeEventListener('touchmove', onTouchMove); } catch (e) {}
        try { document.removeEventListener('touchend', onTouchEnd); } catch (e) {}
      };
    } catch (e) {}
  },

  /** Remove the finish-cone connecting line */
  _removeFinishConeConnectingLine() {
    if (this._finishConeLineElement) {
      this._finishConeLineElement.remove();
      this._finishConeLineElement = null;
    }
  },

  /** Redraw the finish-cone connecting line if a pair exists */
  _redrawFinishConeConnectingLine() {
    if (this._currentFinishConePair && this._currentFinishConePair.length === 2) {
      const cone1 = Cones.cones.find(c => c.id === this._currentFinishConePair[0]);
      const cone2 = Cones.cones.find(c => c.id === this._currentFinishConePair[1]);
      if (cone1 && cone2) {
        this._drawFinishConeConnectingLine(cone1.lngLat, cone2.lngLat);
      }
    }
  },

  /** Redraw the start-cone connecting line if a pair exists */
  _redrawStartConeConnectingLine() {
    if (this._currentStartConePair && this._currentStartConePair.length === 2) {
      const cone1 = Cones.cones.find(c => c.id === this._currentStartConePair[0]);
      const cone2 = Cones.cones.find(c => c.id === this._currentStartConePair[1]);
      if (cone1 && cone2) {
        this._drawStartConeConnectingLine(cone1.lngLat, cone2.lngLat);
      }
    }
  },

  /** Calculate distance in feet between two lngLat points */
  _calcDistanceFeet(from, to) {
    if (this.mode === 'image') {
      if (!ImageMap.hasScale()) return null;
      const fromArr = [from.lng !== undefined ? from.lng : from[0], from.lat !== undefined ? from.lat : from[1]];
      const toArr = [to.lng !== undefined ? to.lng : to[0], to.lat !== undefined ? to.lat : to[1]];
      return Distance._pixelDistFeet(fromArr, toArr);
    } else {
      const lat1 = from.lat !== undefined ? from.lat : from[1];
      const lng1 = from.lng !== undefined ? from.lng : from[0];
      const lat2 = to.lat !== undefined ? to.lat : to[1];
      const lng2 = to.lng !== undefined ? to.lng : to[0];
      return Distance._haversine(lat1, lng1, lat2, lng2) * 3.28084;
    }
  },

  // ===== Gate Tool (Two-Click) =====

  /** Handle gate click — first click sets center, second click sets driving direction */
  _handleGateClick(lngLat) {
    if (!this._gateCenter) {
      this._gateCenter = lngLat;
      this._showToast('Click to set driving direction through the gate', 'info');
    } else {
      const center = this._gateCenter;
      this._gateCenter = null;
      this._hidePreviewLine();

      History.push();

      // Calculate angle from center to second click (driving direction)
      const gateWidth = parseFloat(document.getElementById('gate-width-input').value) || 20;
      const halfWidth = gateWidth / 2;

      if (this.mode === 'image') {
        const scale = ImageMap.hasScale() ? ImageMap.getScale() : 1;
        const offsetPx = halfWidth / scale;
        // Angle from center to direction click
        const dx = lngLat.lng - center.lng;
        const dy = lngLat.lat - center.lat;
        const angle = Math.atan2(dy, dx);
        // Perpendicular offsets (±90°)
        const perpX = Math.cos(angle + Math.PI / 2) * offsetPx;
        const perpY = Math.sin(angle + Math.PI / 2) * offsetPx;
        Cones.place('regular', center, [center.lng + perpX, center.lat + perpY]);
        Cones.place('regular', center, [center.lng - perpX, center.lat - perpY]);
      } else {
        // Map mode: compute offset in degrees
        const metersPerDegLng = 111320 * Math.cos(center.lat * Math.PI / 180);
        const metersPerDegLat = 110540;
        const halfMeters = halfWidth / 3.28084;

        // Angle in degrees (lng/lat space, adjusted for projection)
        const dx = (lngLat.lng - center.lng) * metersPerDegLng;
        const dy = (lngLat.lat - center.lat) * metersPerDegLat;
        const angle = Math.atan2(dy, dx);

        // Perpendicular offsets
        const perpAngle = angle + Math.PI / 2;
        const offsetLng = Math.cos(perpAngle) * halfMeters / metersPerDegLng;
        const offsetLat = Math.sin(perpAngle) * halfMeters / metersPerDegLat;

        Cones.place('regular', center, [center.lng + offsetLng, center.lat + offsetLat]);
        Cones.place('regular', center, [center.lng - offsetLng, center.lat - offsetLat]);
      }
    }
  },

  // ===== Pointer Tool (Two-Click) =====

  /** Handle pointer click — first click places the regular cone, second click places the pointer snapped to its edge */
  _handlePointerClick(lngLat, shiftKey) {
    if (!this._pointerStart) {
      // First click: place the regular cone immediately
      History.push();
      const regularCone = Cones.place('regular', lngLat, [lngLat.lng, lngLat.lat]);
      this._pointerStart = { lngLat, regularConeId: regularCone.id };
      this._showToast('Move cursor around the cone and click to set where the pointer appears (hold Shift to snap to 45°)', 'info');
    } else {
      const center = this._pointerStart.lngLat;
      const regularConeId = this._pointerStart.regularConeId;
      this._pointerStart = null;
      this._hidePreviewLine();

      // Snap the pointer tip to just touch the regular cone's visual edge.
      // Measure the cone's actual rendered diameter via getBoundingClientRect() —
      // this automatically accounts for wrapper zoom scale (image mode) or CSS
      // scale (map mode) without needing to know the zoom formula.
      // Regular cone CSS diameter = 8px, pointer center-to-tip = 4.5px (ratio 9/16 of diameter).
      // So snap = cone_radius + tip_offset = (4 + 4.5) / 8 * visual_diameter = 8.5/8 * diameter.
      const regCone = Cones.cones.find(c => c.id === regularConeId);
      const regEl = regCone?.marker.getElement();
      const regRect = regEl ? regEl.getBoundingClientRect() : null;
      const POINTER_SNAP_PX = regRect && regRect.width > 0 ? regRect.width * (8.5 / 8) : 8.5;
      const centerPx = this.map.project(center);
      const clickPx = this.map.project(lngLat);
      const dpx = clickPx.x - centerPx.x;
      const dpy = clickPx.y - centerPx.y;
      const distPx = Math.sqrt(dpx * dpx + dpy * dpy);

      // Normalized direction (default to north if click is exactly on the cone)
      let ndpx = 0, ndpy = -1;
      if (distPx > 0) {
        let angle = Math.atan2(dpy, dpx);
        if (shiftKey) angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        ndpx = Math.cos(angle);
        ndpy = Math.sin(angle);
      }

      // Pointer position: snap to just outside the regular cone's edge, opposite the click direction
      const pointerPx = { x: centerPx.x - ndpx * POINTER_SNAP_PX, y: centerPx.y - ndpy * POINTER_SNAP_PX };
      const pointerPos = this.map.unproject(pointerPx);

      History.push();
      const pointer = Cones.place('pointer', { lng: pointerPos.lng, lat: pointerPos.lat }, [pointerPos.lng, pointerPos.lat]);
      // Lock to its companion regular cone so it auto-aims at it
      pointer.lockedTargetId = regularConeId;
      Cones._applyPointerRotation(pointer);

      // --- SNAP DIAGNOSTIC (remove after fix) ---
      setTimeout(() => {
        const regCone2 = Cones.cones.find(c => c.id === regularConeId);
        if (!regCone2 || !pointer) return;
        const regEl2 = regCone2.marker.getElement();
        const ptrEl = pointer.marker.getElement();
        const regRect2 = regEl2.getBoundingClientRect();
        const ptrRect = ptrEl.getBoundingClientRect();
        const regCx = regRect2.left + regRect2.width / 2;
        const regCy = regRect2.top + regRect2.height / 2;
        const ptrCx = ptrRect.left + ptrRect.width / 2;
        const ptrCy = ptrRect.top + ptrRect.height / 2;
        const vizDist = Math.sqrt((ptrCx - regCx) ** 2 + (ptrCy - regCy) ** 2);
        console.log('POINTER SNAP DIAG', {
          zoom: this.map.getZoom().toFixed(2),
          POINTER_SNAP_PX: POINTER_SNAP_PX.toFixed(2),
          regRect_wh: `${regRect2.width.toFixed(1)}x${regRect2.height.toFixed(1)}`,
          ptrRect_wh: `${ptrRect.width.toFixed(1)}x${ptrRect.height.toFixed(1)}`,
          vizDist_centers: vizDist.toFixed(2),
          regPos: `(${regCx.toFixed(1)}, ${regCy.toFixed(1)})`,
          ptrPos: `(${ptrCx.toFixed(1)}, ${ptrCy.toFixed(1)})`,
        });
      }, 50);
      // --- END DIAGNOSTIC ---
    }
  },

  // ===== Leaner Tool (Two-Click) =====

  /** Handle leaner click — first click places the cone, second click sets the pointing direction */
  _handleLeanerClick(lngLat, shiftKey) {
    if (!this._leanerStart) {
      this._leanerStart = lngLat;
      this._showToast('Click to set the direction the cone is pointing (hold Shift to snap to 45°)', 'info');
    } else {
      const center = this._leanerStart;
      this._leanerStart = null;
      this._hidePreviewLine();

      History.push();

      const cone = Cones.place('leaner', center, [center.lng, center.lat]);

      // Compute pointing angle (same convention as pointer: 0° = north/up)
      let rotation;
      if (this.mode === 'image') {
        const dx = lngLat.lng - center.lng;
        const dy = lngLat.lat - center.lat;
        rotation = Math.atan2(dx, -dy) * (180 / Math.PI);
      } else {
        const cosLat = Math.cos(center.lat * Math.PI / 180);
        const dx = (lngLat.lng - center.lng) * cosLat;
        const dy = lngLat.lat - center.lat;
        rotation = Math.atan2(dx, dy) * (180 / Math.PI);
      }

      if (shiftKey) rotation = Math.round(rotation / 45) * 45;
      cone.rotation = rotation;

      Cones._applyLeanerRotation(cone);
    }
  },

  // ===== Start-Beam Tool (Two-Click) =====

  /** Handle start-beam click — first click places pylon 1, second click places pylon 2 */
  _handleStartBeamClick(lngLat) {
    if (!this._startBeamStart) {
      // If there's an existing start-beam pair and the user clicked near its center,
      // treat this as a move of the existing gate (preserve direction) instead of starting a new placement.
      if (this._currentStartBeamPair && this._currentStartBeamPair.length === 2) {
        const p1 = Cones.cones.find(c => c.id === this._currentStartBeamPair[0]);
        const p2 = Cones.cones.find(c => c.id === this._currentStartBeamPair[1]);
        if (p1 && p2) {
          const mapAdapter = (this.mode === 'image') ? ImageMap : this.map;
          try {
            const screen1 = mapAdapter.project ? mapAdapter.project(p1.lngLat) : this.map.project(p1.lngLat);
            const screen2 = mapAdapter.project ? mapAdapter.project(p2.lngLat) : this.map.project(p2.lngLat);
            const centerScreen = { x: (screen1.x + screen2.x) / 2, y: (screen1.y + screen2.y) / 2 };
            const clickScreen = mapAdapter.project ? mapAdapter.project(lngLat) : this.map.project(lngLat);
            const dx = clickScreen.x - centerScreen.x;
            const dy = clickScreen.y - centerScreen.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const THRESH_PX = 30;
            if (dist <= THRESH_PX) {
              // Move existing gate to the clicked center while preserving orientation
              History.push();
              const oldCenter = { lng: (p1.lngLat[0] + p2.lngLat[0]) / 2, lat: (p1.lngLat[1] + p2.lngLat[1]) / 2 };
              const newCenterLng = (lngLat.lng !== undefined) ? lngLat.lng : lngLat[0];
              const newCenterLat = (lngLat.lat !== undefined) ? lngLat.lat : lngLat[1];
              const deltaLng = newCenterLng - oldCenter.lng;
              const deltaLat = newCenterLat - oldCenter.lat;
              // Apply translation to both pylons
              [p1, p2].forEach((p) => {
                const newLng = p.lngLat[0] + deltaLng;
                const newLat = p.lngLat[1] + deltaLat;
                try { p.marker.setLngLat({ lng: newLng, lat: newLat }); } catch (e) {}
                p.lngLat = [newLng, newLat];
              });
              // Redraw connecting line
              this._drawStartBeamConnectingLine(p1.lngLat, p2.lngLat);
              if (typeof Measurements !== 'undefined') {
                Measurements.updateConePosition(p1.id, p1.lngLat);
                Measurements.updateConePosition(p2.id, p2.lngLat);
              }
              if (this._updateInfo) this._updateInfo();
              return;
            }
          } catch (e) {}
        }
      }

      // First click: place the first pylon immediately at the clicked position.
      History.push();

      // Remove previous start-beam pair before starting a new one
      for (const id of this._currentStartBeamPair) {
        Cones.remove(id);
      }
      this._currentStartBeamPair = [];

      const pylon1 = Cones.place('start-beam', lngLat, [lngLat.lng, lngLat.lat]);
      this._startBeamStart = lngLat;
      this._startBeamPylon1Id = pylon1.id;
      this._showToast('Click to place the other side of the start beam', 'info');
    } else {
      // Second click: place the second pylon at the clicked position.
      const pylon1Id = this._startBeamPylon1Id;
      this._startBeamStart = null;
      this._startBeamPylon1Id = null;
      this._hidePreviewLine();

      const pylon2 = Cones.place('start-beam', lngLat, [lngLat.lng, lngLat.lat]);
      this._currentStartBeamPair = [pylon1Id, pylon2.id];

      const pylon1Cone = Cones.cones.find(c => c.id === pylon1Id);
      if (pylon1Cone) {
        this._drawStartBeamConnectingLine(pylon1Cone.lngLat, pylon2.lngLat);
      }
    }
  },

  // ===== Start-Cone Tool (Two-Click) =====

  /** Handle start-cone click — first click places cone 1, second click places cone 2 */
  _handleStartConeClick(lngLat) {
    if (!this._startConeStart) {
      // First click: place the first cone immediately at the clicked position.
      History.push();

      // Remove previous start-cone pair before starting a new one
      for (const id of this._currentStartConePair) {
        Cones.remove(id);
      }
      this._currentStartConePair = [];

      const cone1 = Cones.place('start-cone', lngLat, [lngLat.lng, lngLat.lat]);
      this._startConeStart = lngLat;
      this._startConeCone1Id = cone1.id;
      this._showToast('Click to place the other side of the start line', 'info');
    } else {
      // Second click: place the second cone at the clicked position.
      const cone1Id = this._startConeCone1Id;
      this._startConeStart = null;
      this._startConeCone1Id = null;
      this._hidePreviewLine();

      const cone2 = Cones.place('start-cone', lngLat, [lngLat.lng, lngLat.lat]);
      this._currentStartConePair = [cone1Id, cone2.id];

      const cone1Cone = Cones.cones.find(c => c.id === cone1Id);
      if (cone1Cone) {
        this._drawStartConeConnectingLine(cone1Cone.lngLat, cone2.lngLat);
      }
    }
  },

  // ===== Finish-Cone Tool (Two-Click) =====

  /** Handle finish-cone click — first click places cone 1, second click places cone 2 */
  _handleFinishConeClick(lngLat) {
    if (!this._finishConeStart) {
      // First click: place the first cone immediately at the clicked position.
      History.push();

      // Remove previous finish-cone pair before starting a new one
      for (const id of this._currentFinishConePair) {
        Cones.remove(id);
      }
      this._currentFinishConePair = [];

      const cone1 = Cones.place('finish-cone', lngLat, [lngLat.lng, lngLat.lat]);
      this._finishConeStart = lngLat;
      this._finishConeCone1Id = cone1.id;
      this._showToast('Click to place the other side of the finish line', 'info');
    } else {
      // Second click: place the second cone at the clicked position.
      const cone1Id = this._finishConeCone1Id;
      this._finishConeStart = null;
      this._finishConeCone1Id = null;
      this._hidePreviewLine();

      const cone2 = Cones.place('finish-cone', lngLat, [lngLat.lng, lngLat.lat]);
      this._currentFinishConePair = [cone1Id, cone2.id];

      const cone1Cone = Cones.cones.find(c => c.id === cone1Id);
      if (cone1Cone) {
        this._drawFinishConeConnectingLine(cone1Cone.lngLat, cone2.lngLat);
      }
    }
  },

  // ===== Slalom Tool =====

  /**
   * Snap an end lngLat to the nearest 45-degree angle from start (in screen space).
   * Used when Shift is held during slalom placement.
   */
  _snapSlalomAngle(startLngLat, endLngLat) {
    const startPx = this.map.project(startLngLat);
    const endPx   = this.map.project(endLngLat);
    const dx = endPx.x - startPx.x;
    const dy = endPx.y - startPx.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return endLngLat;
    const snapRad = Math.PI / 4; // 45 degrees
    const snappedAngle = Math.round(Math.atan2(dy, dx) / snapRad) * snapRad;
    return this.map.unproject({
      x: startPx.x + dist * Math.cos(snappedAngle),
      y: startPx.y + dist * Math.sin(snappedAngle),
    });
  },

  /** Handle slalom click (two-click with dialog) */
  _handleSlalomClick(lngLat, shiftKey) {
    // Ignore clicks while dialog is open
    if (!document.getElementById('slalom-dialog').classList.contains('hidden')) return;

    if (!this._slalomStart) {
      this._slalomStart = lngLat;
      this._showToast('Click the end position for the slalom (hold Shift to snap to 45°)', 'info');
    } else {
      this._slalomEnd = shiftKey ? this._snapSlalomAngle(this._slalomStart, lngLat) : lngLat;
      this._hidePreviewLine();
      this._showSlalomDialog();
    }
  },

  /** Show the slalom configuration dialog */
  _showSlalomDialog() {
    const start = this._slalomStart;
    const end = this._slalomEnd;
    const clickedFeet = this._calcDistanceFeet(start, end);
    const hasDist = clickedFeet !== null && clickedFeet > 0;

    // Direction unit vector in coordinate space (fixed by the two clicks)
    const dLng = end.lng - start.lng;
    const dLat = end.lat - start.lat;
    const lineLenCoord = Math.sqrt(dLng * dLng + dLat * dLat);
    const uLng = lineLenCoord > 0 ? dLng / lineLenCoord : 1;
    const uLat = lineLenCoord > 0 ? dLat / lineLenCoord : 0;
    // Coordinate units per foot along this direction
    const coordPerFoot = hasDist ? lineLenCoord / clickedFeet : 0;

    const dialog = document.getElementById('slalom-dialog');
    const lengthInput = document.getElementById('slalom-length-input');
    const spacingInput = document.getElementById('slalom-spacing-input');
    const countInput = document.getElementById('slalom-count-input');
    const confirmBtn = document.getElementById('slalom-confirm');
    const cancelBtn = document.getElementById('slalom-cancel');

    lengthInput.value = hasDist ? clickedFeet.toFixed(1) : '';
    spacingInput.value = '';
    countInput.value = '5';

    // Track which input was last edited to determine placement behavior
    let lastEdited = 'count'; // 'length', 'spacing', or 'count'

    const getLength = () => parseFloat(lengthInput.value) || 0;
    const getSpacing = () => parseFloat(spacingInput.value) || 0;
    const getCount = () => parseInt(countInput.value) || 0;

    const updateFromLength = () => {
      lastEdited = 'length';
      const len = getLength();
      const spacing = getSpacing();
      if (len > 0 && spacing > 0) {
        countInput.value = Math.floor(len / spacing) + 1;
      } else {
        const count = getCount();
        if (count >= 2 && len > 0) {
          spacingInput.value = (len / (count - 1)).toFixed(1);
        }
      }
      this._updateSlalomPreview();
    };

    const updateFromSpacing = () => {
      lastEdited = 'spacing';
      const spacing = getSpacing();
      const len = getLength();
      if (spacing > 0 && len > 0) {
        countInput.value = Math.floor(len / spacing) + 1;
      }
      this._updateSlalomPreview();
    };

    const updateFromCount = () => {
      lastEdited = 'count';
      const count = getCount();
      const len = getLength();
      if (count >= 2 && len > 0) {
        spacingInput.value = (len / (count - 1)).toFixed(1);
      }
      this._updateSlalomPreview();
    };

    // Initial calc from default count
    updateFromCount();

    dialog.classList.remove('hidden');
    countInput.focus();

    const cleanup = () => {
      dialog.classList.add('hidden');
      lengthInput.removeEventListener('input', updateFromLength);
      spacingInput.removeEventListener('input', updateFromSpacing);
      countInput.removeEventListener('input', updateFromCount);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      lengthInput.removeEventListener('keydown', onKey);
      spacingInput.removeEventListener('keydown', onKey);
      countInput.removeEventListener('keydown', onKey);
    };

    const onConfirm = () => {
      const count = getCount();
      const spacing = getSpacing();
      const len = getLength();
      if (!count || count < 2) {
        countInput.focus();
        return;
      }
      cleanup();
      History.push();

      // Use spacing for exact placement; compute step in coord space
      const stepCoord = spacing > 0 && coordPerFoot > 0
        ? spacing * coordPerFoot
        : (len > 0 && coordPerFoot > 0 && count > 1)
          ? (len / (count - 1)) * coordPerFoot
          : (count > 1 ? lineLenCoord / (count - 1) : 0);

      for (let i = 0; i < count; i++) {
        const lng = start.lng + uLng * stepCoord * i;
        const lat = start.lat + uLat * stepCoord * i;
        Cones.place('regular', { lng, lat }, [lng, lat]);
      }

      this._slalomStart = null;
      this._slalomEnd = null;
    };

    const onCancel = () => {
      cleanup();
      this._slalomStart = null;
      this._slalomEnd = null;
    };

    const onKey = (e) => {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    };

    lengthInput.addEventListener('input', updateFromLength);
    spacingInput.addEventListener('input', updateFromSpacing);
    countInput.addEventListener('input', updateFromCount);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    lengthInput.addEventListener('keydown', onKey);
    spacingInput.addEventListener('keydown', onKey);
    countInput.addEventListener('keydown', onKey);
  },

  /** Update the slalom preview text in the dialog */
  _updateSlalomPreview() {
    const countInput = document.getElementById('slalom-count-input');
    const spacingInput = document.getElementById('slalom-spacing-input');
    const previewText = document.getElementById('slalom-preview-text');
    const count = parseInt(countInput.value) || 0;
    const spacing = parseFloat(spacingInput.value) || 0;
    if (count >= 2 && spacing > 0) {
      previewText.textContent = `Will place ${count} cones, ${spacing.toFixed(1)} ft apart`;
    } else if (count >= 2) {
      previewText.textContent = `Will place ${count} cones`;
    } else {
      previewText.textContent = 'Will place -- cones, -- ft apart';
    }
  },

  // ===== Leaner Set Tool =====

  /** Handle leaner-set click (two-click with dialog) */
  _handleLeanerSetClick(lngLat, shiftKey) {
    // Ignore clicks while dialog is open
    if (!document.getElementById('leaner-set-dialog').classList.contains('hidden')) return;

    if (!this._leanerSetStart) {
      this._leanerSetStart = lngLat;
      this._showToast('Click the end position for the leaner set (hold Shift to snap to 45°)', 'info');
    } else {
      this._leanerSetEnd = shiftKey ? this._snapSlalomAngle(this._leanerSetStart, lngLat) : lngLat;
      this._hidePreviewLine();
      this._showLeanerSetDialog();
    }
  },

  /** Show the leaner-set configuration dialog */
  _showLeanerSetDialog() {
    const start = this._leanerSetStart;
    const end = this._leanerSetEnd;
    const clickedFeet = this._calcDistanceFeet(start, end);
    const hasDist = clickedFeet !== null && clickedFeet > 0;

    // Direction unit vector in coordinate space
    const dLng = end.lng - start.lng;
    const dLat = end.lat - start.lat;
    const lineLenCoord = Math.sqrt(dLng * dLng + dLat * dLat);
    const uLng = lineLenCoord > 0 ? dLng / lineLenCoord : 1;
    const uLat = lineLenCoord > 0 ? dLat / lineLenCoord : 0;
    const coordPerFoot = hasDist ? lineLenCoord / clickedFeet : 0;

    // Compute rotation for all leaners (pointing from start toward end)
    let rotation;
    if (this.mode === 'image') {
      rotation = Math.atan2(dLng, -dLat) * (180 / Math.PI);
    } else {
      const cosLat = Math.cos(start.lat * Math.PI / 180);
      const correctedDx = dLng * cosLat;
      rotation = Math.atan2(correctedDx, dLat) * (180 / Math.PI);
    }

    const dialog = document.getElementById('leaner-set-dialog');
    const lengthInput = document.getElementById('leaner-set-length-input');
    const spacingInput = document.getElementById('leaner-set-spacing-input');
    const countInput = document.getElementById('leaner-set-count-input');
    const confirmBtn = document.getElementById('leaner-set-confirm');
    const cancelBtn = document.getElementById('leaner-set-cancel');

    lengthInput.value = hasDist ? clickedFeet.toFixed(1) : '';
    spacingInput.value = '';
    countInput.value = '5';

    let lastEdited = 'count';

    const getLength = () => parseFloat(lengthInput.value) || 0;
    const getSpacing = () => parseFloat(spacingInput.value) || 0;
    const getCount = () => parseInt(countInput.value) || 0;

    const updateFromLength = () => {
      lastEdited = 'length';
      const len = getLength();
      const spacing = getSpacing();
      if (len > 0 && spacing > 0) {
        countInput.value = Math.floor(len / spacing) + 1;
      } else {
        const count = getCount();
        if (count >= 2 && len > 0) {
          spacingInput.value = (len / (count - 1)).toFixed(1);
        }
      }
      this._updateLeanerSetPreview();
    };

    const updateFromSpacing = () => {
      lastEdited = 'spacing';
      const spacing = getSpacing();
      const len = getLength();
      if (spacing > 0 && len > 0) {
        countInput.value = Math.floor(len / spacing) + 1;
      }
      this._updateLeanerSetPreview();
    };

    const updateFromCount = () => {
      lastEdited = 'count';
      const count = getCount();
      const len = getLength();
      if (count >= 2 && len > 0) {
        spacingInput.value = (len / (count - 1)).toFixed(1);
      }
      this._updateLeanerSetPreview();
    };

    updateFromCount();

    dialog.classList.remove('hidden');
    countInput.focus();

    const cleanup = () => {
      dialog.classList.add('hidden');
      lengthInput.removeEventListener('input', updateFromLength);
      spacingInput.removeEventListener('input', updateFromSpacing);
      countInput.removeEventListener('input', updateFromCount);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      lengthInput.removeEventListener('keydown', onKey);
      spacingInput.removeEventListener('keydown', onKey);
      countInput.removeEventListener('keydown', onKey);
    };

    const onConfirm = () => {
      const count = getCount();
      const spacing = getSpacing();
      const len = getLength();
      if (!count || count < 2) {
        countInput.focus();
        return;
      }
      cleanup();
      History.push();

      const stepCoord = spacing > 0 && coordPerFoot > 0
        ? spacing * coordPerFoot
        : (len > 0 && coordPerFoot > 0 && count > 1)
          ? (len / (count - 1)) * coordPerFoot
          : (count > 1 ? lineLenCoord / (count - 1) : 0);

      for (let i = 0; i < count; i++) {
        const lng = start.lng + uLng * stepCoord * i;
        const lat = start.lat + uLat * stepCoord * i;
        const cone = Cones.place('leaner', { lng, lat }, [lng, lat]);
        cone.rotation = rotation;
        Cones._applyLeanerRotation(cone);
      }

      this._leanerSetStart = null;
      this._leanerSetEnd = null;
    };

    const onCancel = () => {
      cleanup();
      this._leanerSetStart = null;
      this._leanerSetEnd = null;
    };

    const onKey = (e) => {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    };

    lengthInput.addEventListener('input', updateFromLength);
    spacingInput.addEventListener('input', updateFromSpacing);
    countInput.addEventListener('input', updateFromCount);
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    lengthInput.addEventListener('keydown', onKey);
    spacingInput.addEventListener('keydown', onKey);
    countInput.addEventListener('keydown', onKey);
  },

  /** Update the leaner-set preview text in the dialog */
  _updateLeanerSetPreview() {
    const countInput = document.getElementById('leaner-set-count-input');
    const spacingInput = document.getElementById('leaner-set-spacing-input');
    const previewText = document.getElementById('leaner-set-preview-text');
    const count = parseInt(countInput.value) || 0;
    const spacing = parseFloat(spacingInput.value) || 0;
    if (count >= 2 && spacing > 0) {
      previewText.textContent = `Will place ${count} leaners, ${spacing.toFixed(1)} ft apart`;
    } else if (count >= 2) {
      previewText.textContent = `Will place ${count} leaners`;
    } else {
      previewText.textContent = 'Will place -- leaners, -- ft apart';
    }
  },

  // ===== Box Selection =====

  _setupBoxSelection() {
    const mapContainer = document.getElementById('map');
    let boxStartX, boxStartY;

    mapContainer.addEventListener('mousedown', (e) => {
      if (this.activeTool !== 'select') return;
      if (e.target.closest('.cone-marker, .waypoint-marker, .note-marker, .obstacle-marker, .worker-marker, .measurement-endpoint, .measurement-label, .outline-endpoint, .outline-control')) return;
      if (e.button !== 0) return;

      this._boxSelecting = true;
      boxStartX = e.clientX;
      boxStartY = e.clientY;
      Selection.startBox(boxStartX, boxStartY);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._boxSelecting) return;
      Selection.updateBox(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', (e) => {
      if (!this._boxSelecting) return;
      this._boxSelecting = false;
      Selection.endBox(e.clientX, e.clientY);
    });
  },

  /** Set up toolbar button clicks */
  _setupToolbar() {
    if (this._toolbarBound) return;
    this._toolbarBound = true;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._setActiveTool(btn.dataset.tool);
      });
    });

    document.getElementById('btn-clear-line').addEventListener('click', () => {
      History.push();
      DrivingLine.clear();
    });

    // "Add optional line" button — dynamically creates Line 2, Line 3, …
    document.getElementById('btn-add-optional-line').addEventListener('click', () => {
      this._addExtraDrivingLine();
    });

    // Undo/Redo buttons
    document.getElementById('btn-undo').addEventListener('click', () => History.undo());
    document.getElementById('btn-redo').addEventListener('click', () => History.redo());

    // Add Image Layer button (in sidebar Layers section)
    const imageLayerFileInput = document.getElementById('image-layer-file-input');
    document.getElementById('btn-add-image-layer').addEventListener('click', () => {
      imageLayerFileInput.click();
    });
    imageLayerFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const src = ev.target.result;
        const tmpImg = new Image();
        tmpImg.onload = () => {
          ImageLayers.add(src, file.name, tmpImg.naturalWidth, tmpImg.naturalHeight);
        };
        tmpImg.src = src;
      };
      reader.readAsDataURL(file);
      imageLayerFileInput.value = '';
    });

    // Load Background button (clears current course and prompts for new background)
    const loadBgBtn = document.getElementById('btn-load-background');
    if (loadBgBtn) {
      loadBgBtn.addEventListener('click', async () => {
        // Detect if any user-defined elements exist to decide whether to confirm
        const hasCones = typeof Cones !== 'undefined' && Array.isArray(Cones.cones) && Cones.cones.length > 0;
        const hasDL1 = typeof DrivingLine !== 'undefined' && Array.isArray(DrivingLine.waypoints) && DrivingLine.waypoints.length > 0;
        const hasExtraLines = this._extraDrivingLines.some(line => Array.isArray(line.waypoints) && line.waypoints.length > 0);
        const hasMeasurements = typeof Measurements !== 'undefined' && Array.isArray(Measurements.measurements) && Measurements.measurements.length > 0;
        const hasNotes = typeof Notes !== 'undefined' && Array.isArray(Notes.notes) && Notes.notes.length > 0;
        const hasObstacles = typeof Obstacles !== 'undefined' && Array.isArray(Obstacles.obstacles) && Obstacles.obstacles.length > 0;
        const hasWorkers = typeof Workers !== 'undefined' && Array.isArray(Workers.stations) && Workers.stations.length > 0;
        const hasArrows = typeof Arrows !== 'undefined' && Array.isArray(Arrows.arrows) && Arrows.arrows.length > 0;
        const hasImageLayers = typeof ImageLayers !== 'undefined' && Array.isArray(ImageLayers._layers) && ImageLayers._layers.length > 0;
        const hasHighlights = typeof Highlights !== 'undefined' && Array.isArray(Highlights._areas) && Highlights._areas.length > 0;

        const hasElements = hasCones || hasDL1 || hasExtraLines || hasMeasurements || hasNotes || hasObstacles || hasWorkers || hasArrows || hasImageLayers || hasHighlights;

        // Only ask for confirmation if there's something to clear
        if (hasElements) {
          if (!confirm('Clear the current course and choose a new background?')) return;
          History.push();
        }

        try {
          if (hasDL1 && typeof DrivingLine !== 'undefined' && DrivingLine.clear) DrivingLine.clear();
          this._resetExtraDrivingLines();
          if (hasCones && typeof Cones !== 'undefined' && Cones.clearAll) Cones.clearAll();
          if (hasObstacles && typeof Obstacles !== 'undefined' && Obstacles.clearAll) Obstacles.clearAll();
          if (hasNotes && typeof Notes !== 'undefined' && Notes.clearAll) Notes.clearAll();
          if (hasMeasurements && typeof Measurements !== 'undefined' && Measurements.clearAll) Measurements.clearAll();
          if (hasWorkers && typeof Workers !== 'undefined' && Workers.clearAll) Workers.clearAll();
          if (hasArrows && typeof Arrows !== 'undefined' && Arrows.clearAll) Arrows.clearAll();
          if (typeof ImageLayers !== 'undefined' && ImageLayers.loadData) ImageLayers.loadData([]);
          if (typeof Highlights !== 'undefined' && Highlights.clearAll) Highlights.clearAll();
        } catch (e) {}

        if (typeof Selection !== 'undefined' && Selection.clear) Selection.clear();
        if (typeof Layers !== 'undefined' && Layers.init) Layers.init();

        const choice = await ImageMode.showBanner('image');
        if (choice) {
          try {
            sessionStorage.setItem('autocross-pending-background', JSON.stringify(choice));
          } catch (e) {}
          location.reload();
        }
      });
    }

  },

  /** Set the active tool and update button styles */
  _setActiveTool(tool) {
    // Clean up previous scale tool state
    if (this.activeTool === 'scale' && tool !== 'scale') {
      this._clearScaleVisuals();
      document.getElementById('scale-hint').classList.add('hidden');
    }

    // Cancel pending measurement if switching away from measure tool
    if (this.activeTool === 'measure' && tool !== 'measure') {
      Measurements.cancelPending();
      this._hidePreviewLine();
    }

    // CourseOutline tool removed

    // Cancel slalom start if switching away
    if (this.activeTool === 'slalom' && tool !== 'slalom') {
      this._slalomStart = null;
      this._hidePreviewLine();
    }

    // Cancel gate if switching away
    if (this.activeTool === 'gate' && tool !== 'gate') {
      this._gateCenter = null;
      this._hidePreviewLine();
    }

    // Cancel pointer if switching away
    if (this.activeTool === 'pointer' && tool !== 'pointer') {
      this._pointerStart = null;
      this._hidePreviewLine();
    }

    // Cancel leaner if switching away
    if (this.activeTool === 'leaner' && tool !== 'leaner') {
      this._leanerStart = null;
      this._hidePreviewLine();
    }

    // Cancel leaner-set if switching away
    if (this.activeTool === 'leaner-set' && tool !== 'leaner-set') {
      this._leanerSetStart = null;
      this._leanerSetEnd = null;
      this._hidePreviewLine();
    }

    // Cancel start-cone preview if switching away (but keep existing cones and line)
    if (this.activeTool === 'start-cone' && tool !== 'start-cone') {
      this._startConeStart = null;
      this._startConeCone1Id = null;
      this._hidePreviewLine();
    }

    // Cancel start-beam preview if switching away (but keep existing cones and line)
    if (this.activeTool === 'start-beam' && tool !== 'start-beam') {
      this._startBeamStart = null;
      this._startBeamPylon1Id = null;
      this._hidePreviewLine();
    }

    // Cancel finish-cone preview if switching away (but keep existing cones and line)
    if (this.activeTool === 'finish-cone' && tool !== 'finish-cone') {
      this._finishConeStart = null;
      this._finishConeCone1Id = null;
      this._hidePreviewLine();
    }

    // Cancel in-progress highlight area if switching away
    if (this.activeTool === 'highlight' && tool !== 'highlight') {
      Highlights.cancelCurrent();
    }

    // Re-enable map dragging when leaving select mode
    if (this.activeTool === 'select' && tool !== 'select') {
      if (this.mode === 'map' && this.map.dragPan) {
        this.map.dragPan.enable();
      }
    }

    // Store previous tool before switching to select (for one-shot revert)
    if (tool === 'select' && this.activeTool !== 'select') {
      this._previousTool = this.activeTool;
      // Disable map dragging so plain drag starts box select
      if (this.mode === 'map' && this.map.dragPan) {
        this.map.dragPan.disable();
      }
    }

    this.activeTool = tool;
    this._deselectCone();
    Selection.clear();

    // Enable/disable image layer interactivity based on tool
    document.body.classList.toggle('image-layers-active', tool === 'select');

    // Update active button style
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    // Show scale hint when entering scale mode
    if (tool === 'scale') {
      this._scalePoints = [];
      this._clearScaleVisuals();
      const hint = document.getElementById('scale-hint');
      hint.textContent = 'Click the first point';
      hint.classList.remove('hidden');
    }

    // Change cursor
    if (this.mode === 'image') {
      // Always crosshair in image mode
      document.getElementById('map').style.cursor = 'crosshair';
    } else {
      const canvas = this.map.getCanvas();
      if (tool === 'select') {
        canvas.style.cursor = 'default';
      } else {
        canvas.style.cursor = 'crosshair';
      }
    }
  },

  /** Set up grid toggle and rotation */
  _setupGrid() {
    const toggleBtn = document.getElementById('btn-grid-toggle');
    const rotationControl = document.getElementById('grid-rotation-control');
    const rotationSlider = document.getElementById('grid-rotation');
    const rotationNumber = document.getElementById('grid-rotation-number');
    const linesBtn = document.getElementById('btn-grid-lines');

    toggleBtn.addEventListener('click', () => {
      const active = Grid.toggle();
      toggleBtn.classList.toggle('active', active);
      if (active) {
        rotationControl.classList.remove('hidden');
      } else {
        rotationControl.classList.add('hidden');
      }
    });

    // Slider updates number input
    rotationSlider.addEventListener('input', () => {
      const deg = parseInt(rotationSlider.value, 10);
      rotationNumber.value = deg;
      Grid.setRotation(deg);
    });

    // Number input updates slider
    rotationNumber.addEventListener('input', () => {
      let deg = parseInt(rotationNumber.value, 10);
      if (isNaN(deg)) return;
      deg = Math.max(0, Math.min(360, deg));
      rotationSlider.value = deg;
      Grid.setRotation(deg);
    });

    // Light/Dark grid lines toggle
    let gridLineMode = 'light';
    linesBtn.addEventListener('click', () => {
      gridLineMode = gridLineMode === 'light' ? 'dark' : 'light';
      Grid.setLineMode(gridLineMode);
      const label = gridLineMode === 'dark' ? 'Dark' : 'Light';
      linesBtn.innerHTML = '<span class="tool-icon">&#9681;</span> ' + label;
    });
  },

  /** Set up sidebar toggle */
  _setupSidebar() {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      toggle.textContent = sidebar.classList.contains('collapsed') ? '\u25B6' : '\u25C4';
    });
  },

  /** Set up help dialog */
  _setupHelp() {
    const dialog = document.getElementById('help-dialog');
    const closeBtn = document.getElementById('help-close');
    document.getElementById('btn-help').addEventListener('click', () => {
      dialog.classList.remove('hidden');
    });
    closeBtn.addEventListener('click', () => {
      dialog.classList.add('hidden');
    });
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.classList.add('hidden');
    });
  },

  /**
   * Parse the DPI from a PNG ArrayBuffer by reading the pHYs chunk.
   * Returns the DPI (pixels per inch) or 96 if not found / not a PNG.
   */
  _parsePNGDPI(buffer) {
    try {
      const view = new DataView(buffer);
      const len = buffer.byteLength;
      if (len < 8 || view.getUint32(0) !== 0x89504E47) return 96;
      let offset = 8;
      while (offset + 12 <= len) {
        const chunkLen = view.getUint32(offset);
        const type = String.fromCharCode(
          view.getUint8(offset + 4), view.getUint8(offset + 5),
          view.getUint8(offset + 6), view.getUint8(offset + 7)
        );
        if (type === 'pHYs' && chunkLen >= 9) {
          const ppuX = view.getUint32(offset + 8);
          const unit = view.getUint8(offset + 16);
          if (unit === 1 && ppuX > 0) {
            return Math.round(ppuX * 0.0254);
          }
          break;
        }
        if (type === 'IDAT') break;
        offset += 4 + 4 + chunkLen + 4;
      }
    } catch (_) {}
    return 96;
  },

  /** CRC-32 used for PNG chunk integrity. */
  _crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const b of bytes) {
      crc ^= b;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  },

  /**
   * Inject a pHYs chunk carrying the given DPI into a PNG Blob.
   * Returns a Promise that resolves with a new Blob.
   */
  _injectPNGDPI(blob, dpi) {
    return blob.arrayBuffer().then(buf => {
      const orig = new Uint8Array(buf);
      const ppm = Math.round(dpi / 0.0254);
      const typeBytes = [0x70, 0x48, 0x59, 0x73]; // "pHYs"
      const data = new Uint8Array(9);
      const dv = new DataView(data.buffer);
      dv.setUint32(0, ppm);
      dv.setUint32(4, ppm);
      data[8] = 1; // unit = metre
      const crc = this._crc32([...typeBytes, ...data]);
      const chunk = new Uint8Array(21);
      const cv = new DataView(chunk.buffer);
      cv.setUint32(0, 9);
      chunk.set(typeBytes, 4);
      chunk.set(data, 8);
      cv.setUint32(17, crc);

      // Strip any existing pHYs chunk then reassemble with our new one after IHDR
      let readOff = 8;
      const signature = orig.slice(0, 8);
      let ihdr = null;
      const rest = [];
      while (readOff + 12 <= orig.length) {
        const chunkLen = (orig[readOff] << 24 | orig[readOff+1] << 16 | orig[readOff+2] << 8 | orig[readOff+3]) >>> 0;
        const type = String.fromCharCode(orig[readOff+4], orig[readOff+5], orig[readOff+6], orig[readOff+7]);
        const total = 4 + 4 + chunkLen + 4;
        const slice = orig.slice(readOff, readOff + total);
        if (type === 'IHDR') { ihdr = slice; }
        else if (type !== 'pHYs') { rest.push(slice); }
        readOff += total;
      }
      const parts = [signature, ihdr || new Uint8Array(0), chunk, ...rest];
      const totalLen = parts.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(totalLen);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return new Blob([out], { type: 'image/png' });
    });
  },

  /** Set up print button */
  _setupPrint() {
    const printBtn = document.getElementById('btn-print');
    const dialog = document.getElementById('print-dialog');
    const includeGrid = document.getElementById('print-include-grid');
    const blackCones = document.getElementById('print-black-cones');
    const confirmBtn = document.getElementById('print-confirm');
    const cancelBtn = document.getElementById('print-cancel');
    const dpiRow = document.getElementById('print-dpi-row');
    const dpiInput = document.getElementById('print-dpi');

    printBtn.addEventListener('click', () => {
      includeGrid.checked = Grid.isActive();
      // Only show DPI option in image mode
      if (dpiRow) dpiRow.style.display = this.mode === 'image' ? '' : 'none';
      if (dpiInput) dpiInput.value = this._backgroundDPI || 96;
      dialog.classList.remove('hidden');
    });

    cancelBtn.addEventListener('click', () => {
      dialog.classList.add('hidden');
    });

    confirmBtn.addEventListener('click', () => {
      dialog.classList.add('hidden');
      const targetDPI = this.mode === 'image' ? (parseInt(dpiInput && dpiInput.value) || this._backgroundDPI || 96) : 96;
      if (this.mode === 'image' && targetDPI > 0) {
        this._backgroundDPI = targetDPI;
      }
      this._captureImage(includeGrid.checked, blackCones.checked, targetDPI);
    });
  },

  /** Capture the map + optional grid as a downloadable image */
  _captureImage(withGrid, blackCones, targetDPI = 96) {
    const mapCanvas = this.map.getCanvas();

    // In image mode, compute an expanded canvas if image layers extend outside the background.
    let originOffsetX = 0, originOffsetY = 0;
    let exportW = mapCanvas.width, exportH = mapCanvas.height;
    if (this.mode === 'image') {
      let minX = 0, minY = 0;
      let maxX = mapCanvas.width, maxY = mapCanvas.height;
      for (const layer of ImageLayers._layers) {
        if (!layer.visible) continue;
        if (layer.rotation) {
          const rad = layer.rotation * Math.PI / 180;
          const cos = Math.cos(rad), sin = Math.sin(rad);
          const cx = layer.lngLat[0], cy = layer.lngLat[1];
          [[-layer.halfW, -layer.halfH], [layer.halfW, -layer.halfH],
           [layer.halfW,  layer.halfH], [-layer.halfW,  layer.halfH]].forEach(([x, y]) => {
            const rx = cx + x * cos - y * sin;
            const ry = cy + x * sin + y * cos;
            minX = Math.min(minX, rx); minY = Math.min(minY, ry);
            maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry);
          });
        } else {
          minX = Math.min(minX, layer.lngLat[0] - layer.halfW);
          minY = Math.min(minY, layer.lngLat[1] - layer.halfH);
          maxX = Math.max(maxX, layer.lngLat[0] + layer.halfW);
          maxY = Math.max(maxY, layer.lngLat[1] + layer.halfH);
        }
      }
      originOffsetX = Math.floor(Math.max(0, -minX));
      originOffsetY = Math.floor(Math.max(0, -minY));
      exportW = Math.ceil(maxX + originOffsetX);
      exportH = Math.ceil(maxY + originOffsetY);
    }

    const resultCanvas = document.createElement('canvas');
    // In image mode, scale the output canvas by the DPI ratio so the pixel count
    // matches the requested DPI relative to the source image's native DPI.
    const dpiScale = this.mode === 'image' ? (targetDPI / (this._backgroundDPI || 96)) : 1;
    resultCanvas.width = Math.round(exportW * dpiScale);
    resultCanvas.height = Math.round(exportH * dpiScale);
    const ctx = resultCanvas.getContext('2d');

    const dpr = this.mode === 'image' ? 1 : window.devicePixelRatio;

    // Translate all coordinate-based drawing by the expansion offset.
    // In map mode originOffset is always 0 so this is a no-op.
    ctx.save();
    if (dpiScale !== 1) ctx.scale(dpiScale, dpiScale);
    ctx.translate(originOffsetX, originOffsetY);

    // Draw the map (or image in image mode)
    ctx.drawImage(mapCanvas, 0, 0);

    // Draw image layers — after background, before all course elements
    for (const layer of ImageLayers._layers) {
      if (!layer.visible) continue;
      const img = layer.el ? layer.el.querySelector('img') : null;
      if (!img || !img.complete) continue;
      ctx.save();
      if (layer.opacity != null && layer.opacity !== 1) ctx.globalAlpha = layer.opacity;
      if (this.mode === 'image') {
        const cx = layer.lngLat[0], cy = layer.lngLat[1];
        ctx.translate(cx, cy);
        if (layer.rotation) ctx.rotate(layer.rotation * Math.PI / 180);
        ctx.drawImage(img, -layer.halfW, -layer.halfH, layer.halfW * 2, layer.halfH * 2);
      } else {
        const tl = this.map.project({ lng: layer.lngLat[0] - layer.halfW, lat: layer.lngLat[1] + layer.halfH });
        const br = this.map.project({ lng: layer.lngLat[0] + layer.halfW, lat: layer.lngLat[1] - layer.halfH });
        const cx = (tl.x + br.x) / 2 * dpr;
        const cy = (tl.y + br.y) / 2 * dpr;
        const w = Math.max(1, (br.x - tl.x) * dpr);
        const h = Math.max(1, (br.y - tl.y) * dpr);
        ctx.translate(cx, cy);
        if (layer.rotation) ctx.rotate(layer.rotation * Math.PI / 180);
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
      ctx.restore();
    }

    // Draw connecting lines for cone pairs
    this._drawConnectingLinesForExport(ctx, dpr, blackCones);

    for (const cone of Cones.cones) {
      // Skip if cones layer is hidden
      if (!Layers.isVisible('cones')) continue;
      const pos = this.mode === 'image'
        ? { x: cone.lngLat[0], y: cone.lngLat[1] }
        : this.map.project(cone.lngLat);
      const x = pos.x * dpr;
      const y = pos.y * dpr;
      let scale = 0.2;

      ctx.save();
      ctx.translate(x, y);

      if (cone.type === 'pointer') {
        scale = 0.4;
        const angle = Cones._computePointerRotation(cone);
        ctx.rotate(angle * Math.PI / 180);
        ctx.beginPath();
        ctx.moveTo(0, -8 * scale);
        ctx.lineTo(-6 * scale, 6 * scale);
        ctx.lineTo(6 * scale, 6 * scale);
        ctx.closePath();
        ctx.fillStyle = blackCones ? '#000' : '#176b3a';
        ctx.fill();
      } else if (cone.type === 'regular') {
        scale = 0.2;
        ctx.beginPath();
        ctx.arc(0, 0, 7 * scale, 0, Math.PI * 2);
        ctx.fillStyle = blackCones ? '#000' : '#ff8c00';
        ctx.fill();
        ctx.strokeStyle = blackCones ? '#000' : '#cc7000';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
      } else if (cone.type === 'leaner') {
        scale = 0.4;
        ctx.rotate((cone.rotation || 0) * Math.PI / 180);
        ctx.beginPath();
        ctx.moveTo(0, -8 * scale);        // extended tip in pointing direction
        ctx.lineTo(-5 * scale, 5 * scale); // base left
        ctx.lineTo(5 * scale, 5 * scale);  // base right
        ctx.closePath();
        ctx.fillStyle = blackCones ? '#000' : '#ff8c00';
        ctx.fill();
        ctx.strokeStyle = blackCones ? '#000' : '#cc7000';
        ctx.lineWidth = 1 * scale;
        ctx.stroke();
      } else if (cone.type === 'start-beam') {
        scale = 0.3;
        const size = startBeamConeSize * scale;
        ctx.save();
        if (cone.rotation) ctx.rotate(cone.rotation * Math.PI / 180);
        ctx.beginPath();
        ctx.rect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = blackCones ? '#000' : '#22c55e';
        ctx.fill();
        ctx.strokeStyle = blackCones ? '#000' : '#16a34a';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
        ctx.restore();
      } else if (cone.type === 'start-cone') {
        scale = 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, 7 * scale, 0, Math.PI * 2);
        ctx.fillStyle = blackCones ? '#000' : '#ff8c00';
        ctx.fill();
        ctx.strokeStyle = blackCones ? '#000' : '#cc7000';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
      } else if (cone.type === 'finish-cone') {
        scale = 0.3;
        const size = finishConeSize * scale;
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = 8;
        patternCanvas.height = 8;
        const pctx = patternCanvas.getContext('2d');
        if (pctx) {
          pctx.fillStyle = '#000';
          pctx.fillRect(0, 0, 8, 8);
          pctx.fillStyle = '#fff';
          pctx.beginPath();
          pctx.moveTo(0, 0);
          pctx.lineTo(8, 0);
          pctx.lineTo(8, 4);
          pctx.closePath();
          pctx.fill();
          pctx.beginPath();
          pctx.moveTo(0, 4);
          pctx.lineTo(4, 8);
          pctx.lineTo(0, 8);
          pctx.closePath();
          pctx.fill();
        }
        const pattern = pctx ? ctx.createPattern(patternCanvas, 'repeat') : '#888';
        ctx.save();
        if (cone.rotation) ctx.rotate(cone.rotation * Math.PI / 180);
        ctx.beginPath();
        ctx.rect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = pattern;
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 1 * scale;
        ctx.stroke();
        ctx.restore();
      } else if (cone.type === 'trailer' || cone.type === 'cleartext') {
        if (cone.rotation) ctx.rotate(cone.rotation * Math.PI / 180);
        const elemScale = Cones._getElementScale(cone);
        // In image mode markers have a scale(0.5) counter-scale applied on screen,
        // so divide by 2 to match. In map mode CSS size == canvas size / dpr.
        const trailScale = this.mode === 'image' ? 0.5 : 1;
        const tw = (cone.width || 40) * elemScale * dpr * trailScale;
        const th = (cone.height || 20) * elemScale * dpr * trailScale;
        if (!cone.clearBackground) {
          ctx.beginPath();
          ctx.rect(-tw / 2, -th / 2, tw, th);
          ctx.fillStyle = Cones._buildTrailerBg(cone);
          ctx.fill();
          ctx.strokeStyle = '#666';
          ctx.lineWidth = 2 * dpr;
          ctx.stroke();
        }
        if (cone.text) {
          ctx.fillStyle = '#000';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          let fontSize = 65;
          const maxWidth = tw - 8 * dpr;
          const maxHeight = th - 6 * dpr;
          do {
            ctx.font = `bold ${fontSize}px sans-serif`;
            const metrics = ctx.measureText(cone.text);
            const textWidth = metrics.width;
            const textHeight = fontSize * 1.1;
            if (textWidth <= maxWidth && textHeight <= maxHeight) break;
            fontSize -= 1;
          } while (fontSize > 6);

          ctx.fillText(cone.text, 0, 0);
        }
      } else if (cone.type === 'staging-grid') {
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#000';
        ctx.fillText('T', 0, 0);
      } else if (cone.type === 'staging-grid') {
        if (cone.rotation) ctx.rotate(cone.rotation * Math.PI / 180);
        const elemScale = Cones._getElementScale(cone);
        const gw = (cone.width || 80) * elemScale * dpr / 2;
        const gh = (cone.height || 50) * elemScale * dpr / 2;
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.rect(-gw / 2, -gh / 2, gw, gh);
        ctx.strokeStyle = 'rgba(255, 200, 50, 0.8)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255, 200, 50, 0.9)';
        ctx.font = `bold ${11 * dpr}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('GRID', 0, 0);
      }
      ctx.restore();
    }

    // Draw obstacles
    if (Layers.isVisible('obstacles')) {
      for (const obs of Obstacles.obstacles) {
        const typeDef = OBSTACLE_TYPES.find(t => t.id === obs.type) || OBSTACLE_TYPES[5];
        const pos = this.mode === 'image'
          ? { x: obs.lngLat[0], y: obs.lngLat[1] }
          : this.map.project(obs.lngLat);
        const ox = pos.x * dpr;
        const oy = pos.y * dpr;

        ctx.save();
        ctx.fillStyle = 'rgba(30,30,30,0.85)';
        ctx.beginPath();
        ctx.roundRect(ox - 11 * dpr, oy - 11 * dpr, 22 * dpr, 22 * dpr, 4 * dpr);
        ctx.fill();
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.fillStyle = typeDef.color;
        ctx.font = `bold ${14 * dpr}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(typeDef.symbol, ox, oy);
        ctx.restore();
      }
    }

    // Draw worker stations
    if (Layers.isVisible('workers')) {
      for (const w of Workers.stations) {
        const pos = this.mode === 'image'
          ? { x: w.lngLat[0], y: w.lngLat[1] }
          : this.map.project(w.lngLat);
        const wx = pos.x * dpr;
        const wy = pos.y * dpr;

        const scale = 0.8;
        ctx.save();
        ctx.beginPath();
        ctx.arc(wx, wy, 12 * scale, 0, Math.PI * 2);
        ctx.fillStyle = blackCones ? '#000' :'#3b82f6';
        ctx.fill();
        ctx.strokeStyle = blackCones ? '#000' :'#1d4ed8';
        ctx.lineWidth = 2 * scale;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${11 * scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(w.number), wx, wy);
        ctx.restore();
      }
    }

    // Draw measurement lines
    if (Layers.isVisible('measurements')) {
      for (const m of Measurements.measurements) {
        const p1pos = this.mode === 'image'
          ? { x: m.points[0][0], y: m.points[0][1] }
          : this.map.project(m.points[0]);
        const p2pos = this.mode === 'image'
          ? { x: m.points[1][0], y: m.points[1][1] }
          : this.map.project(m.points[1]);
        const x1 = p1pos.x * dpr, y1 = p1pos.y * dpr;
        const x2 = p2pos.x * dpr, y2 = p2pos.y * dpr;

        ctx.save();
        ctx.setLineDash([4 * dpr, 3 * dpr]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.setLineDash([]);

        // Endpoints
        [{ x: x1, y: y1 }, { x: x2, y: y2 }].forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4 * dpr, 0, Math.PI * 2);
          ctx.fillStyle = '#f472b6';
          ctx.fill();
        });

        // Label at midpoint
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const label = Measurements._computeDistanceLabel(m.points[0], m.points[1]);
        ctx.font = `bold ${12 * dpr}px sans-serif`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(190, 24, 93, 0.9)';
        ctx.beginPath();
        ctx.roundRect(mx - tw / 2 - 4 * dpr, my - 16 * dpr, tw + 8 * dpr, 18 * dpr, 3 * dpr);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, mx, my - 7 * dpr);
        ctx.restore();
      }
    }

    // CourseOutline rendering removed

    // Draw note markers
    if (Layers.isVisible('notes')) {
      for (const n of Notes.notes) {
        const pos = this.mode === 'image'
          ? { x: n.lngLat[0], y: n.lngLat[1] }
          : this.map.project(n.lngLat);
        const nx = pos.x * dpr;
        const ny = pos.y * dpr;

        ctx.save();
        ctx.beginPath();
        ctx.arc(nx, ny, 12 * dpr, 0, Math.PI * 2);
        ctx.fillStyle = '#8b5cf6';
        ctx.fill();
        ctx.strokeStyle = '#6d28d9';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${11 * dpr}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n.number), nx, ny);
        ctx.restore();
      }
    }

    // Draw stats and scale overlays in coordinate-translated space (image coords for image
    // mode; map mode originOffset is always 0 so translate is a no-op).
    StatsOverlay.drawOnCanvas(ctx, dpr, this.mode);
    if (Layers.isVisible('scaleOverlay')) {
      ScaleOverlay.drawOnCanvas(ctx, dpr, this.mode);
    }

    // Restore coordinate translate; grid uses absolute canvas positions.
    ctx.restore();

    // Draw grid if requested
    if (withGrid && Grid.isActive()) {
      const gridCanvas = document.getElementById('grid-canvas');
      ctx.drawImage(gridCanvas, 0, 0, gridCanvas.width, gridCanvas.height,
        0, 0, resultCanvas.width, resultCanvas.height);
    }

    // Download
    resultCanvas.toBlob((blob) => {
      const base = this._sanitizeFileName(this.courseTitle || 'Autocross');
      const doDownload = (finalBlob) => {
        const url = URL.createObjectURL(finalBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = base + '.png';
        a.click();
        URL.revokeObjectURL(url);
      };
      // Embed the target DPI in the PNG metadata
      if (this.mode === 'image' && targetDPI) {
        this._injectPNGDPI(blob, targetDPI).then(doDownload).catch(() => doDownload(blob));
      } else {
        doDownload(blob);
      }
    }, 'image/png');
  },

  /** Draw connecting lines for start cone, start beam, and finish cone pairs on export */
  _drawConnectingLinesForExport(ctx, dpr, blackCones) {
    const drawLine = (cone1LngLat, cone2LngLat, color) => {
      const p1pos = this.mode === 'image'
        ? { x: cone1LngLat[0], y: cone1LngLat[1] }
        : this.map.project(cone1LngLat);
      const p2pos = this.mode === 'image'
        ? { x: cone2LngLat[0], y: cone2LngLat[1] }
        : this.map.project(cone2LngLat);
      
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p1pos.x * dpr, p1pos.y * dpr);
      ctx.lineTo(p2pos.x * dpr, p2pos.y * dpr);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 * dpr;
      ctx.stroke();
      ctx.restore();
    };

    // Draw start cone connecting line (black)
    if (this._currentStartConePair && this._currentStartConePair.length === 2) {
      const cone1 = Cones.cones.find(c => c.id === this._currentStartConePair[0]);
      const cone2 = Cones.cones.find(c => c.id === this._currentStartConePair[1]);
      if (cone1 && cone2) {
        drawLine(cone1.lngLat, cone2.lngLat, startLineColor);
      }
    }

    // Draw start beam connecting line (blue)
    if (this._currentStartBeamPair && this._currentStartBeamPair.length === 2) {
      const pylon1 = Cones.cones.find(c => c.id === this._currentStartBeamPair[0]);
      const pylon2 = Cones.cones.find(c => c.id === this._currentStartBeamPair[1]);
      if (pylon1 && pylon2) {
        drawLine(pylon1.lngLat, pylon2.lngLat, blackCones ? '#000000' : startBeamColor);
      }
    }

    // Draw finish cone connecting line (blue)
    if (this._currentFinishConePair && this._currentFinishConePair.length === 2) {
      const cone1 = Cones.cones.find(c => c.id === this._currentFinishConePair[0]);
      const cone2 = Cones.cones.find(c => c.id === this._currentFinishConePair[1]);
      if (cone1 && cone2) {
         drawLine(cone1.lngLat, cone2.lngLat, finishLineColor);
      }
    }
  },

  /** Draw a scale bar on the export canvas */
  _drawScaleBar(ctx, canvasWidth, canvasHeight, dpr) {
    const barWidthPx = 200 * dpr;
    const barX = 20 * dpr;
    const barY = canvasHeight - 30 * dpr;
    const barHeight = 8 * dpr;

    // Calculate real distance for barWidthPx
    let distFeet;
    if (this.mode === 'image') {
      if (!ImageMap.hasScale()) return;
      distFeet = (barWidthPx / dpr) * ImageMap.getScale();
    } else {
      const mpp = Grid._metersPerPixel();
      const distMeters = (barWidthPx / dpr) * mpp;
      distFeet = distMeters * 3.28084;
    }

    // Round to a nice number
    const niceValues = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    let niceDist = niceValues[0];
    for (const v of niceValues) {
      if (v <= distFeet) niceDist = v;
    }
    // Adjust bar width to match the nice distance
    const adjustedBarWidth = barWidthPx * (niceDist / distFeet);

    // Draw bar background
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.roundRect(barX - 6 * dpr, barY - 18 * dpr, adjustedBarWidth + 12 * dpr, barHeight + 26 * dpr, 4 * dpr);
    ctx.fill();

    // Draw bar
    ctx.fillStyle = '#fff';
    ctx.fillRect(barX, barY, adjustedBarWidth, barHeight);

    // Draw tick marks
    ctx.fillRect(barX, barY - 4 * dpr, 2 * dpr, barHeight + 4 * dpr);
    ctx.fillRect(barX + adjustedBarWidth - 2 * dpr, barY - 4 * dpr, 2 * dpr, barHeight + 4 * dpr);
    ctx.fillRect(barX + adjustedBarWidth / 2 - 1 * dpr, barY - 2 * dpr, 2 * dpr, barHeight + 2 * dpr);

    // Draw label
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${11 * dpr}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${niceDist} ft`, barX + adjustedBarWidth / 2, barY - 4 * dpr);
    ctx.restore();
  },

  /** Set up export/import buttons */
  _setupStorage() {
    // Export / Save
    document.getElementById('btn-export').addEventListener('click', () => {
      const data = this._serializeFull();
      const base = this._sanitizeFileName(this.courseTitle || 'Autocross');
      // Save to localStorage under the base name
      try {
        Storage.save(base, data);
        this._refreshSavedList();
        this._showToast(`Saved "${base}"`, 'info');
      } catch (e) {}
      // Also export as JSON file with .json extension
      const filename = base + '.json';
      Storage.exportJSON(data, filename);
    });

    // Import
    const importFile = document.getElementById('import-file');
    document.getElementById('btn-import').addEventListener('click', () => {
      importFile.click();
    });

    importFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      Storage.importJSON(file).then(data => {
        // Detect cross-mode mismatch: reload into the correct mode
        const importIsImage = !!data.imageMode;
        const currentIsImage = this.mode === 'image';
        if (importIsImage !== currentIsImage) {
          sessionStorage.setItem('autocross-pending-import', JSON.stringify(data));
          location.reload();
          return;
        }
        History.push();
        this._loadCourseData(data);
        importFile.value = ''; // reset
      }).catch(err => {
        alert(err.message);
      });
    });
  },

  /** Serialize all current state */
  _serializeFull() {
    const center = this.map.getCenter();
    const data = Storage.serialize(
      Cones.getData(),
      DrivingLine.getData(),
      Measurements.getData(),
      Notes.getData(),
      center.toArray ? center.toArray() : [center.lng, center.lat],
      this.map.getZoom(),
      this.mode === 'image',
      this.imageFileName,
      this._solidDrivingLine,
      this.courseTitle
    );
    data.obstacles = Obstacles.getData();
    data.workers = Workers.getData();
    data.startConePair = this._currentStartConePair.slice(); // Include start cone pair
    data.startBeamPair = this._currentStartBeamPair.slice(); // Include start beam pair
    data.finishConePair = this._currentFinishConePair.slice(); // Include finish cone pair
    data.layerVisibility = Layers.getVisibility();
    data.imageLayers = ImageLayers.getData();
    data.highlights = Highlights.getData();
    data.statsOverlay = StatsOverlay.getData();
    data.scaleOverlay = ScaleOverlay.getData();
    if (this.mode === 'image' && this._backgroundDPI && this._backgroundDPI !== 96) {
      data.backgroundDPI = this._backgroundDPI;
    }
    // Serialize extra driving lines
    if (this._extraDrivingLines.length > 0) {
      data.extraDrivingLines = this._extraDrivingLines.map(l => l.getData());
    }
    if (this.mode === 'image' && ImageMap._imageWidth > 0) {
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = ImageMap._imageWidth;
      bgCanvas.height = ImageMap._imageHeight;
      bgCanvas.getContext('2d').drawImage(ImageMap._bgCanvas || ImageMap._image, 0, 0);
      data.backgroundImage = bgCanvas.toDataURL('image/png');
    }
    return data;
  },

  /** Load course data (from save or import) */
  _loadCourseData(data) {
    if (Object.prototype.hasOwnProperty.call(data, 'solidDrivingLine')) {
      this._solidDrivingLine = !!data.solidDrivingLine;
    }
    if (data.backgroundDPI > 0) {
      this._backgroundDPI = data.backgroundDPI;
    }

    if (data.cones) {
      const idMap = Cones.loadData(data.cones);
      // Restore start cone pair with mapped IDs
      if (data.startConePair && Array.isArray(data.startConePair)) {
        this._currentStartConePair = data.startConePair.map(oldId => idMap[oldId]).filter(id => id != null);
        this._redrawStartConeConnectingLine();
      }
      // Restore start beam pair with mapped IDs
      if (data.startBeamPair && Array.isArray(data.startBeamPair)) {
        this._currentStartBeamPair = data.startBeamPair.map(oldId => idMap[oldId]).filter(id => id != null);
        this._redrawStartBeamConnectingLine();
      }
      // Restore finish cone pair with mapped IDs
      if (data.finishConePair && Array.isArray(data.finishConePair)) {
        this._currentFinishConePair = data.finishConePair.map(oldId => idMap[oldId]).filter(id => id != null);
        this._redrawFinishConeConnectingLine();
      }
    }
    if (data.drivingLine) DrivingLine.loadData(data.drivingLine);
    this._resetExtraDrivingLines();
    // Migrate legacy drivingLine2 saves into the first dynamic optional line.
    if (Array.isArray(data.drivingLine2) && data.drivingLine2.length > 0) {
      const legacyLine = this._addExtraDrivingLine();
      legacyLine.loadData(data.drivingLine2);
    }
    if (Array.isArray(data.extraDrivingLines) && data.extraDrivingLines.length > 0) {
      data.extraDrivingLines.forEach((wpData) => {
        const line = this._addExtraDrivingLine();
        line.loadData(wpData);
      });
    }
    if (data.measurements) Measurements.loadData(data.measurements);
    if (data.notes) Notes.loadData(data.notes);
    if (data.obstacles) Obstacles.loadData(data.obstacles);
    if (data.workers) Workers.loadData(data.workers);
    if (data.imageLayers) ImageLayers.loadData(data.imageLayers);
    if (data.highlights) Highlights.loadData(data.highlights);
    if (data.statsOverlay) StatsOverlay.loadData(data.statsOverlay);
    if (data.scaleOverlay) ScaleOverlay.loadData(data.scaleOverlay);
    // Restore layer visibility after all dynamic layers (imageLayers, extraDrivingLines, highlights)
    // have been created so their entries exist in Layers._layers.
    if (data.layerVisibility) Layers.loadVisibility(data.layerVisibility);
    if (data.backgroundImage && this.mode === 'image') {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        ImageMap.updateBackground(canvas, 0, 0);
        ImageMap.fitToView();
      };
      img.src = data.backgroundImage;
    }
    if (data.mapCenter && data.mapZoom && this.mode === 'map') {
      MapModule.flyTo(data.mapCenter, data.mapZoom);
    }
    // Restore image scale if present
    if (data.imageScale && this.mode === 'image') {
      this._setImageScale(data.imageScale, 'Calibrated (imported)');
    }
    // Restore optional saved course title
    if (data.title) {
      this.courseTitle = data.title;
      const titleEl = document.getElementById('course-title');
      if (titleEl) titleEl.textContent = data.title;
    }
    this._applyDrivingLineStyle();
    this._updateInfo();
  },

  /** Refresh the saved courses list in sidebar */
  _refreshSavedList() {
    const list = document.getElementById('saved-list');
    if (!list) return;
    const names = Storage.list();

    if (names.length === 0) {
      list.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.4)">No saved courses</div>';
      return;
    }

    list.innerHTML = names.map(name => `
      <div class="saved-item">
        <span data-name="${name}">${name}</span>
        <button data-delete="${name}" title="Delete">&times;</button>
      </div>
    `).join('');

    // Load on click
    list.querySelectorAll('span[data-name]').forEach(el => {
      el.addEventListener('click', () => {
        const data = Storage.load(el.dataset.name);
        if (data) {
          History.push();
          this._loadCourseData(data);
        }
      });
    });

    // Delete on click
    list.querySelectorAll('button[data-delete]').forEach(el => {
      el.addEventListener('click', () => {
        if (confirm(`Delete "${el.dataset.delete}"?`)) {
          Storage.remove(el.dataset.delete);
          this._refreshSavedList();
        }
      });
    });
  },

  /** Update course info in sidebar */
  _updateInfo() {
    document.getElementById('cone-count').textContent = `Cones: ${Cones.count()}`;

    const lineLen = Distance.totalLength(DrivingLine.waypoints);
    if (lineLen < 0) {
      document.getElementById('line-length').textContent = 'Line: N/A';
    } else {
      document.getElementById('line-length').textContent = lineLen > 0
        ? `Line: ${lineLen.toFixed(0)} ft`
        : 'Line: -- ft';
    }

    Notes.renderSidebar();
    Workers.renderSidebar();
    Venue.renderSidebar();
    StatsOverlay.update();
    ScaleOverlay.update();
  },

  // ===== Keyboard Shortcuts =====

  _setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      // Ctrl+Z — Undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        History.undo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z — Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        History.redo();
        return;
      }

      // Ctrl+A — Select all
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        Selection.selectAll();
        return;
      }

      // Delete / Backspace — Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (Selection.count() > 0) {
          Selection.deleteSelected();
        } else if (this.selectedCone) {
          History.push();
          this.handleConeDelete(this.selectedCone.id);
          this._deselectCone();
        }
        return;
      }

      // Escape — Deselect / cancel tool
      if (e.key === 'Escape') {
        this._deselectCone();
        Selection.clear();
        this._slalomStart = null;
        this._gateCenter = null;
        this._startConeStart = null;
        this._startConeCone1Id = null;
        this._hidePreviewLine();
        if (this.activeTool === 'measure') {
          Measurements.cancelPending();
        }
        // CourseOutline tool removed
        this._setActiveTool('select');
        return;
      }

      // Number keys 1-9 for quick tool select
      if (e.key >= '1' && e.key <= '9' && !e.ctrlKey && !e.metaKey) {
        const tools = ['regular', 'pointer', 'start-cone', 'finish-cone', 'select', 'drivingline', 'measure', 'note', 'gate'];
        const idx = parseInt(e.key) - 1;
        if (idx < tools.length) {
          this._setActiveTool(tools[idx]);
        }
        return;
      }
    });
  },

  // ===== Map Opacity =====

  _setupMapOpacity() {
    const slider = document.getElementById('map-opacity');
    slider.addEventListener('input', () => {
      const opacity = parseInt(slider.value) / 100;
      if (this.mode === 'map') {
        try {
          // Try setting satellite layer opacity
          this.map.setPaintProperty('satellite', 'raster-opacity', opacity);
        } catch (e) {
          // Try mapbox standard satellite style layers
          try {
            const style = this.map.getStyle();
            if (style && style.layers) {
              for (const layer of style.layers) {
                if (layer.type === 'raster') {
                  this.map.setPaintProperty(layer.id, 'raster-opacity', opacity);
                }
              }
            }
          } catch (e2) {}
        }
      } else {
        // Image mode: apply CSS filter
        const wrapper = ImageMap._wrapper;
        if (wrapper) {
          wrapper.style.opacity = opacity;
        }
      }
    });
  },

  /** Set up editable course title UI */
  _setupTitleUI() {
    const el = document.getElementById('course-title');
    if (!el) return;
    el.textContent = this.courseTitle || 'Autocross';
    el.contentEditable = 'true';
    el.spellcheck = false;

    // Prevent clicks from affecting toolbar
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());

    const original = { value: el.textContent };

    el.addEventListener('focus', () => {
      original.value = el.textContent;
    });

    // Block disallowed characters at keydown so the DOM is never rewritten
    // mid-edit (which would reset the caret). Also intercept Space so the
    // browser inserts a real space (U+0020) instead of NBSP (U+00A0).
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); return; }
      if (e.key === 'Escape') { el.textContent = original.value; el.blur(); return; }

      // Let control combos (Ctrl+A, Ctrl+C, etc.) and non-printable keys through.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length !== 1) return;

      // Space: prevent NBSP insertion, manually insert a real space.
      if (e.key === ' ') {
        e.preventDefault();
        document.execCommand('insertText', false, ' ');
        return;
      }

      // Block anything outside the allowed set.
      if (!/^[A-Za-z0-9_-]$/.test(e.key)) {
        e.preventDefault();
      }
    });

    // Handle pasted text: strip disallowed characters, insert as plain text.
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      const cleaned = text.replace(/[^A-Za-z0-9 _-]+/g, '');
      if (cleaned) document.execCommand('insertText', false, cleaned);
    });

    el.addEventListener('blur', () => {
      let newTitle = this._cleanTitle(el.textContent || '');
      newTitle = newTitle || 'Autocross';
      el.textContent = newTitle;
      this.courseTitle = newTitle;
      // Update saved list display if appropriate
      this._refreshSavedList();
    });

    // Positioning
    this._repositionCourseTitle();
    window.addEventListener('resize', () => this._repositionCourseTitle());
    const toolbar = document.getElementById('toolbar');
    if (toolbar && window.MutationObserver) {
      new MutationObserver(() => this._repositionCourseTitle()).observe(toolbar, { attributes: true, attributeFilter: ['class'] });
    }
  },

  _repositionCourseTitle() {
    const el = document.getElementById('course-title');
    const toolbar = document.getElementById('toolbar');
    if (!el || !toolbar) return;
    const rect = toolbar.getBoundingClientRect();
    const left = Math.max(rect.right + 12, 12);
    el.style.left = left + 'px';
    el.style.top = (rect.top + 8) + 'px';
  },

  _sanitizeFileName(name) {
    if (!name) return 'autocross-course';
    return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'autocross-course';
  },

  /** Clean a title string to only allow A-Z a-z 0-9, space, underscore, and dash */
_cleanTitle(name, applyTrim = true) {
    if (!name) return '';
    const normalized = String(name).replace(/\u00A0/g, ' ');
    const filtered = normalized.replace(/[^A-Za-z0-9 _-]+/g, '');
    return applyTrim ? filtered.trim() : filtered;
},

  // ===== Obstacle Type Selector =====

  _setupObstacleSelector() {
    const select = document.getElementById('obstacle-type-select');
    select.addEventListener('change', () => {
      Obstacles.setType(select.value);
    });
  },

  // ===== Venue =====

  _setupVenue() {
    const saveVenueButton = document.getElementById('btn-save-venue');
    if (saveVenueButton) {
      saveVenueButton.addEventListener('click', () => {
        Venue.saveVenue();
      });
    }
    Venue.renderSidebar();
  },

  // ===== Toast =====

  _showToast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type || 'info'}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  // ===== Scale Calibration (Image Mode) =====

  /** Handle a click while in scale tool mode */
  _handleScaleClick(lngLat, screenPoint) {
    const imgCoord = [lngLat.lng, lngLat.lat];

    if (this._scalePoints.length === 0) {
      // First point
      this._scalePoints.push(imgCoord);
      this._addScalePointMarker(imgCoord);
      document.getElementById('scale-hint').textContent = 'Click the second point';
    } else if (this._scalePoints.length === 1) {
      // Second point
      this._scalePoints.push(imgCoord);
      this._addScalePointMarker(imgCoord);
      this._drawScaleLine();
      document.getElementById('scale-hint').classList.add('hidden');
      this._showScaleDialog();
    }
  },

  /** Add a visual dot at a scale calibration point */
  _addScalePointMarker(imgCoord) {
    const dot = document.createElement('div');
    dot.className = 'scale-point';
    dot.style.left = imgCoord[0] + 'px';
    dot.style.top = imgCoord[1] + 'px';
    // Place inside the image wrapper so it transforms with pan/zoom
    ImageMap._markerContainer.appendChild(dot);
    this._scaleMarkers.push(dot);
  },

  /** Draw a line between the two scale points on an SVG overlay */
  _drawScaleLine() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('scale-line-overlay');
    svg.setAttribute('width', ImageMap._imageWidth);
    svg.setAttribute('height', ImageMap._imageHeight);
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', this._scalePoints[0][0]);
    line.setAttribute('y1', this._scalePoints[0][1]);
    line.setAttribute('x2', this._scalePoints[1][0]);
    line.setAttribute('y2', this._scalePoints[1][1]);
    line.setAttribute('stroke', '#f43f5e');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-dasharray', '6,4');
    svg.appendChild(line);

    ImageMap._markerContainer.appendChild(svg);
    this._scaleLine = svg;
  },

  /** Remove temp scale point markers and line */
  _clearScaleVisuals() {
    for (const el of this._scaleMarkers) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    this._scaleMarkers = [];
    if (this._scaleLine && this._scaleLine.parentNode) {
      this._scaleLine.parentNode.removeChild(this._scaleLine);
    }
    this._scaleLine = null;
    this._scalePoints = [];
  },

  /** Show the scale distance input dialog */
  _showScaleDialog() {
    const dialog = document.getElementById('scale-dialog');
    const input = document.getElementById('scale-distance-input');
    const confirmBtn = document.getElementById('scale-confirm');
    const cancelBtn = document.getElementById('scale-cancel');

    input.value = '';
    dialog.classList.remove('hidden');
    input.focus();

    const cleanup = () => {
      dialog.classList.add('hidden');
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    };

    const onConfirm = () => {
      const distFeet = parseFloat(input.value);
      if (!distFeet || distFeet <= 0) {
        input.focus();
        return;
      }
      this._applyScale(distFeet);
      cleanup();
    };

    const onCancel = () => {
      this._clearScaleVisuals();
      cleanup();
    };

    const onKey = (e) => {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    };

    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  },

  /** Apply the calibrated scale */
  _applyScale(distFeet) {
    const p1 = this._scalePoints[0];
    const p2 = this._scalePoints[1];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const pixelDist = Math.sqrt(dx * dx + dy * dy);

    if (pixelDist === 0) {
      alert('The two points are the same. Please try again.');
      this._clearScaleVisuals();
      return;
    }

    const feetPerPixel = distFeet / pixelDist;
    this._setImageScale(feetPerPixel, `${distFeet.toFixed(1)} ft reference`);

    // Clean up visuals
    this._clearScaleVisuals();
  },

  /** Apply a scale value and update all dependent UI/modules */
  _setImageScale(feetPerPixel, statusText) {
    ImageMap.setScale(feetPerPixel);

    // Update status indicator
    const status = document.getElementById('scale-status');
    status.textContent = statusText;
    status.classList.add('calibrated');

    // Persist to localStorage keyed by image filename
    this._saveImageScale(feetPerPixel);

    // Refresh info (line length may now be available)
    this._updateInfo();

    // Redraw grid if active (cell size changed)
    if (Grid.isActive()) {
      Grid.setRotation(Grid._userRotation);
    }
  },

  /** Save scale for the current image to localStorage */
  _saveImageScale(feetPerPixel) {
    if (!this.imageFileName) return;
    try {
      const all = JSON.parse(localStorage.getItem('autocross-image-scales') || '{}');
      all[this.imageFileName] = feetPerPixel;
      localStorage.setItem('autocross-image-scales', JSON.stringify(all));
    } catch {}
  },

  /** Load saved scale for the current image from localStorage */
  _loadImageScale() {
    if (!this.imageFileName) return null;
    try {
      const all = JSON.parse(localStorage.getItem('autocross-image-scales') || '{}');
      return all[this.imageFileName] || null;
    } catch {
      return null;
    }
  },

  /** Set up collapsible sidebar sections (right sidebar) */
  _setupSidebarSections() {
    const STORAGE_KEY = 'sidebarSectionsCollapsed';
    let collapsed = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) collapsed = JSON.parse(raw);
    } catch (e) {
      collapsed = [];
    }

    document.querySelectorAll('#sidebar-content .toolbar-section').forEach((section, idx) => {
      const key = section.dataset.section || `sidebar-${idx}`;
      const label = section.querySelector('.toolbar-label');
      if (!label) return;

      label.setAttribute('role', 'button');
      label.tabIndex = 0;

      const isCollapsed = collapsed.includes(key);
      if (isCollapsed) {
        section.classList.add('collapsed');
        label.setAttribute('aria-expanded', 'false');
      } else {
        label.setAttribute('aria-expanded', 'true');
      }

      const toggle = () => {
        const nowCollapsed = section.classList.toggle('collapsed');
        label.setAttribute('aria-expanded', String(!nowCollapsed));
        try {
          if (nowCollapsed) {
            if (!collapsed.includes(key)) collapsed.push(key);
          } else {
            collapsed = collapsed.filter(k => k !== key);
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
        } catch (e) {}
      };

      label.addEventListener('click', () => toggle());
      label.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    });
  },
};

// Boot the app
document.addEventListener('DOMContentLoaded', () => App.init());
