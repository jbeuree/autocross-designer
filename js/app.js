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
  _scalePoints: [],       // temp array for scale calibration clicks [{x,y}]
  _scaleMarkers: [],      // temp DOM elements for scale point display
  _scaleLine: null,       // temp SVG line overlay
  _slalomStart: null,     // first click for slalom tool
  _slalomEnd: null,       // second click for slalom tool
  _gateCenter: null,      // first click for gate tool
  _startConeStart: null,  // first click for start-cone tool
  _previewLine: null,     // SVG element for rubber-band preview line
  _previewLabel: null,    // distance label element for preview
  _boxSelecting: false,   // box selection state
  _previousTool: 'regular', // tool to revert to after one-shot select
  _drawStartFinishLines: false, // whether to draw start/finish lines on the map
  _currentStartConePair: [], // IDs of the current start-cone pair [id1, id2]
  _startConeLineElement: null, // SVG line connecting the start-cone pair
  _currentStartBeamPair: [], // IDs of the current start-beam pair [id1, id2]
  _startBeamLineElement: null, // SVG line connecting the start-beam pair
  _startBeamStart: null,  // first click for start-beam tool
  _currentFinishConePair: [], // IDs of the current finish-cone pair [id1, id2]
  _finishConeLineElement: null, // SVG line connecting the finish-cone pair
  _finishConeStart: null,  // first click for finish-cone tool
  
  async init() {
    // Check for shared course in URL
    const sharedCourse = Sharing.loadFromURL();

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
        const scale = Math.pow(2, zoom - BASE_ZOOM);
        document.documentElement.style.setProperty('--marker-scale', scale);
      };
      this.map.on('zoom', updateMarkerScale);
      updateMarkerScale();
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

    Measurements.init(this.map);
    CourseOutline.init(this.map);

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
    Selection.init();

    // Wire up map click
    this.map.on('click', (e) => this._handleMapClick(e));

    // Wire up mousemove for distance measurement
    this.map.on('mousemove', (e) => this._handleMouseMove(e));

    // Wire up toolbar buttons
    this._setupToolbar();

    // Wire up sidebar
    this._setupSidebar();

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

  /** Handle click on the map */
  _handleMapClick(e) {
    const lngLat = e.lngLat;

    switch (this.activeTool) {
      case 'regular':
      case 'pointer':
      case 'trailer':
      case 'staging-grid':
        History.push();
        const cone = Cones.place(this.activeTool, lngLat);
        if (this.activeTool === 'trailer') {
          const text = prompt('Enter text to display on the trailer:', '');
          cone.text = text || '';
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

      case 'slalom':
        this._handleSlalomClick(lngLat);
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
        // Clicking on empty map deselects and reverts to previous tool
        this._deselectCone();
        Selection.clear();
        this._setActiveTool(this._previousTool);
        break;

      case 'drivingline':
        History.push();
        DrivingLine.addWaypoint(lngLat);
        break;

      case 'measure':
        Measurements.handleClick(lngLat, e.point);
        break;

      case 'courseoutline':
        CourseOutline.handleClick(lngLat);
        break;

      case 'note':
        History.push();
        Notes.addNote(lngLat);
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
      this._showPreviewLine(this._slalomStart, lngLat);
      const dist = this._calcDistanceFeet(this._slalomStart, lngLat);
      if (dist !== null) {
        this._showPreviewLabel(e.point, `${dist.toFixed(1)} ft`);
      }
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

    // Course outline preview line
    if (this.activeTool === 'courseoutline' && CourseOutline._pendingPoint) {
      const from = { lng: CourseOutline._pendingPoint[0], lat: CourseOutline._pendingPoint[1] };
      this._showPreviewLine(from, lngLat);
      return;
    }

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
  _drawStartConeConnectingLine(cone1LngLat, cone2LngLat) {
    // Remove existing line
    if (this._startConeLineElement) {
      this._startConeLineElement.remove();
    }

    const p1 = this.map.project(cone1LngLat);
    const p2 = this.map.project(cone2LngLat);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:5;pointer-events:none;';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', startLineColor);
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
    document.body.appendChild(svg);
    this._startConeLineElement = svg;
  },

  /** Remove the start-cone connecting line */
  _removeStartConeConnectingLine() {
    if (this._startConeLineElement) {
      this._startConeLineElement.remove();
      this._startConeLineElement = null;
    }
  },

  /** Draw a blue line connecting two start-beam pylons by their lngLat positions */
  _drawStartBeamConnectingLine(pylon1LngLat, pylon2LngLat) {
    // Remove existing line
    if (this._startBeamLineElement) {
      this._startBeamLineElement.remove();
    }

    const p1 = this.map.project(pylon1LngLat);
    const p2 = this.map.project(pylon2LngLat);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:5;pointer-events:none;';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', startBeamColor);
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
    document.body.appendChild(svg);
    this._startBeamLineElement = svg;
  },

  /** Remove the start-beam connecting line */
  _removeStartBeamConnectingLine() {
    if (this._startBeamLineElement) {
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
    // Remove existing line
    if (this._finishConeLineElement) {
      this._finishConeLineElement.remove();
    }

    const p1 = this.map.project(cone1LngLat);
    const p2 = this.map.project(cone2LngLat);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:5;pointer-events:none;';
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', p1.x);
    line.setAttribute('y1', p1.y);
    line.setAttribute('x2', p2.x);
    line.setAttribute('y2', p2.y);
    line.setAttribute('stroke', '#000000');
    line.setAttribute('stroke-width', '1.5');
    svg.appendChild(line);
    document.body.appendChild(svg);
    this._finishConeLineElement = svg;
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

  // ===== Start-Beam Tool (Two-Click) =====

  /** Handle start-beam click — first click sets start, second click sets direction and places pair */
  _handleStartBeamClick(lngLat) {
    if (!this._startBeamStart) {
      this._startBeamStart = lngLat;
      this._showToast('Click to set driving direction for the start beam', 'info');
    } else {
      const center = this._startBeamStart;
      this._startBeamStart = null;
      this._hidePreviewLine();

      History.push();

      // Remove previous start-beam pair before placing new one
      for (const id of this._currentStartBeamPair) {
        Cones.remove(id);
      }
      this._currentStartBeamPair = [];

      // Calculate angle from center to second click (driving direction)
      // Start beam width is 50% larger than start-cone width
      const startConeWidth = parseFloat(document.getElementById('start-cone-width-input').value) || 20;
      const startBeamWidth = startConeWidth * 1.5;
      const halfWidth = startBeamWidth / 2;

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
        const pylon1 = Cones.place('start-beam', center, [center.lng + perpX, center.lat + perpY]);
        const pylon2 = Cones.place('start-beam', center, [center.lng - perpX, center.lat - perpY]);
        this._currentStartBeamPair = [pylon1.id, pylon2.id];
        this._drawStartBeamConnectingLine(pylon1.lngLat, pylon2.lngLat);
        this._updateStartBeamPairRotation();
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

        const pylon1 = Cones.place('start-beam', center, [center.lng + offsetLng, center.lat + offsetLat]);
        const pylon2 = Cones.place('start-beam', center, [center.lng - offsetLng, center.lat - offsetLat]);
        this._currentStartBeamPair = [pylon1.id, pylon2.id];
        this._drawStartBeamConnectingLine(pylon1.lngLat, pylon2.lngLat);
        this._updateStartBeamPairRotation();
      }
    }
  },

  // ===== Start-Cone Tool (Two-Click) =====

  /** Handle start-cone click — first click sets start, second click sets direction and places pair */
  _handleStartConeClick(lngLat) {
    if (!this._startConeStart) {
      this._startConeStart = lngLat;
      this._showToast('Click to set driving direction for the start line', 'info');
    } else {
      const center = this._startConeStart;
      this._startConeStart = null;
      this._hidePreviewLine();

      History.push();

      // Remove previous start-cone pair before placing new one
      for (const id of this._currentStartConePair) {
        Cones.remove(id);
      }
      this._currentStartConePair = [];

      // Calculate angle from center to second click (driving direction)
      const startConeWidth = parseFloat(document.getElementById('start-cone-width-input').value) || 20;
      const halfWidth = startConeWidth / 2;

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
        const cone1 = Cones.place('start-cone', center, [center.lng + perpX, center.lat + perpY]);
        const cone2 = Cones.place('start-cone', center, [center.lng - perpX, center.lat - perpY]);
        this._currentStartConePair = [cone1.id, cone2.id];
        this._drawStartConeConnectingLine(cone1.lngLat, cone2.lngLat);
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

        const cone1 = Cones.place('start-cone', center, [center.lng + offsetLng, center.lat + offsetLat]);
        const cone2 = Cones.place('start-cone', center, [center.lng - offsetLng, center.lat - offsetLat]);
        this._currentStartConePair = [cone1.id, cone2.id];
        this._drawStartConeConnectingLine(cone1.lngLat, cone2.lngLat);
      }
    }
  },

  // ===== Finish-Cone Tool (Two-Click) =====

  /** Handle finish-cone click — first click sets start, second click sets direction and places pair */
  _handleFinishConeClick(lngLat) {
    if (!this._finishConeStart) {
      this._finishConeStart = lngLat;
      this._showToast('Click to set driving direction for the finish line', 'info');
    } else {
      const center = this._finishConeStart;
      this._finishConeStart = null;
      this._hidePreviewLine();

      History.push();

      // Remove previous finish-cone pair before placing new one
      for (const id of this._currentFinishConePair) {
        Cones.remove(id);
      }
      this._currentFinishConePair = [];

      // Calculate angle from center to second click (driving direction)
      // Finish cone width is 50% larger than start-cone width
      const startConeWidth = parseFloat(document.getElementById('start-cone-width-input').value) || 20;
      const finishConeWidth = startConeWidth * 1.5;
      const halfWidth = finishConeWidth / 2;

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
        const cone1 = Cones.place('finish-cone', center, [center.lng + perpX, center.lat + perpY]);
        const cone2 = Cones.place('finish-cone', center, [center.lng - perpX, center.lat - perpY]);
        this._currentFinishConePair = [cone1.id, cone2.id];
        this._drawFinishConeConnectingLine(cone1.lngLat, cone2.lngLat);
        this._updateFinishConePairRotation();
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

        const cone1 = Cones.place('finish-cone', center, [center.lng + offsetLng, center.lat + offsetLat]);
        const cone2 = Cones.place('finish-cone', center, [center.lng - offsetLng, center.lat - offsetLat]);
        this._currentFinishConePair = [cone1.id, cone2.id];
        this._drawFinishConeConnectingLine(cone1.lngLat, cone2.lngLat);
        this._updateFinishConePairRotation();
      }
    }
  },

  /** Update finish cone pair rotation so flat sides face each other */
  _updateStartBeamPairRotation() {
    if (!this._currentStartBeamPair || this._currentStartBeamPair.length !== 2) return;
    const pylon1 = Cones.cones.find(c => c.id === this._currentStartBeamPair[0]);
    const pylon2 = Cones.cones.find(c => c.id === this._currentStartBeamPair[1]);
    if (!pylon1 || !pylon2) return;

    const dx = pylon2.lngLat[0] - pylon1.lngLat[0];
    const dy = pylon2.lngLat[1] - pylon1.lngLat[1];
    let angle;
    if (this.mode === 'image') {
      angle = Math.atan2(dy, dx) * 180 / Math.PI;
    } else {
      const cosLat = Math.cos(pylon1.lngLat[1] * Math.PI / 180);
      const correctedDx = dx * cosLat;
      angle = Math.atan2(dy, correctedDx) * 180 / Math.PI;
    }

    pylon1.rotation = angle;
    pylon2.rotation = angle;
    if (typeof Cones !== 'undefined') {
      Cones._applyStartBeamRotation(pylon1);
      Cones._applyStartBeamRotation(pylon2);
    }
  },

  _updateFinishConePairRotation() {
    if (!this._currentFinishConePair || this._currentFinishConePair.length !== 2) return;
    const cone1 = Cones.cones.find(c => c.id === this._currentFinishConePair[0]);
    const cone2 = Cones.cones.find(c => c.id === this._currentFinishConePair[1]);
    if (!cone1 || !cone2) return;

    const dx = cone2.lngLat[0] - cone1.lngLat[0];
    const dy = cone2.lngLat[1] - cone1.lngLat[1];
    let angle;
    if (this.mode === 'image') {
      angle = Math.atan2(dy, dx) * 180 / Math.PI;
    } else {
      const cosLat = Math.cos(cone1.lngLat[1] * Math.PI / 180);
      const correctedDx = dx * cosLat;
      angle = Math.atan2(dy, correctedDx) * 180 / Math.PI;
    }

    cone1.rotation = angle;
    cone2.rotation = angle;
    if (typeof Cones !== 'undefined') {
      Cones._applyFinishConeRotation(cone1);
      Cones._applyFinishConeRotation(cone2);
    }
  },

  // ===== Slalom Tool =====

  /** Handle slalom click (two-click with dialog) */
  _handleSlalomClick(lngLat) {
    // Ignore clicks while dialog is open
    if (!document.getElementById('slalom-dialog').classList.contains('hidden')) return;

    if (!this._slalomStart) {
      this._slalomStart = lngLat;
      this._showToast('Click the end position for the slalom', 'info');
    } else {
      this._slalomEnd = lngLat;
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
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._setActiveTool(btn.dataset.tool);
      });
    });

    document.getElementById('btn-clear-line').addEventListener('click', () => {
      History.push();
      DrivingLine.clear();
    });

    // Undo/Redo buttons
    document.getElementById('btn-undo').addEventListener('click', () => History.undo());
    document.getElementById('btn-redo').addEventListener('click', () => History.redo());

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

    // Cancel pending outline if switching away
    if (this.activeTool === 'courseoutline' && tool !== 'courseoutline') {
      CourseOutline.cancelPending();
      this._hidePreviewLine();
    }

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

    // Cancel start-cone preview if switching away (but keep existing cones and line)
    if (this.activeTool === 'start-cone' && tool !== 'start-cone') {
      this._startConeStart = null;
      this._hidePreviewLine();
    }

    // Cancel start-beam preview if switching away (but keep existing cones and line)
    if (this.activeTool === 'start-beam' && tool !== 'start-beam') {
      this._startBeamStart = null;
      this._hidePreviewLine();
    }

    // Cancel finish-cone preview if switching away (but keep existing cones and line)
    if (this.activeTool === 'finish-cone' && tool !== 'finish-cone') {
      this._finishConeStart = null;
      this._hidePreviewLine();
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
    const startFinishCheckbox = document.getElementById('startfinishcheckbox');

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      toggle.textContent = sidebar.classList.contains('collapsed') ? '\u25B6' : '\u25C4';
    });

    if (startFinishCheckbox) {
      startFinishCheckbox.addEventListener('change', (e) => {
        this._handleStartFinishCheckboxChange(e.target.checked);
      });
    }
  },

  /** Handle changes to the start/finish lines checkbox */
  _handleStartFinishCheckboxChange(checked) {
    console.log("Start finish toggled to " + checked);
    this._drawStartFinishLines = checked;
    if (this.mode === 'map' && this.map && typeof this.map.triggerRepaint === 'function') {
      this.map.triggerRepaint();
    }
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

  /** Set up print button */
  _setupPrint() {
    const printBtn = document.getElementById('btn-print');
    const dialog = document.getElementById('print-dialog');
    const includeGrid = document.getElementById('print-include-grid');
    const blackCones = document.getElementById('print-black-cones');
    const confirmBtn = document.getElementById('print-confirm');
    const cancelBtn = document.getElementById('print-cancel');

    printBtn.addEventListener('click', () => {
      // Default: check grid if grid is currently active
      includeGrid.checked = Grid.isActive();
      dialog.classList.remove('hidden');
    });

    cancelBtn.addEventListener('click', () => {
      dialog.classList.add('hidden');
    });

    confirmBtn.addEventListener('click', () => {
      dialog.classList.add('hidden');
      this._captureImage(includeGrid.checked, blackCones.checked);
    });
  },

  /** Capture the map + optional grid as a downloadable image */
  _captureImage(withGrid, blackCones) {
    const mapCanvas = this.map.getCanvas();
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = mapCanvas.width;
    resultCanvas.height = mapCanvas.height;
    const ctx = resultCanvas.getContext('2d');

    // Draw the map (or image in image mode)
    ctx.drawImage(mapCanvas, 0, 0);

    const dpr = this.mode === 'image' ? 1 : window.devicePixelRatio;

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
        ctx.fillStyle = blackCones ? '#000' : '#a3e635';
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
        ctx.fillStyle = blackCones ? '#000' : '#22c55e';
        ctx.fill();
        ctx.strokeStyle = blackCones ? '#000' : '#16a34a';
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
      } else if (cone.type === 'trailer') {
        if (cone.rotation) ctx.rotate(cone.rotation * Math.PI / 180);
        const elemScale = Cones._getElementScale(cone);
        const tw = (cone.width || 40) * elemScale * dpr / 2;
        const th = (cone.height || 20) * elemScale * dpr / 2;
        ctx.beginPath();
        ctx.rect(-tw / 2, -th / 2, tw, th);
        ctx.fillStyle = 'rgba(120, 120, 140, 0.8)';
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
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

    // Draw course outline segments
    if (Layers.isVisible('courseOutline')) {
      for (const seg of CourseOutline.segments) {
        const p1pos = this.mode === 'image'
          ? { x: seg.points[0][0], y: seg.points[0][1] }
          : this.map.project(seg.points[0]);
        const p2pos = this.mode === 'image'
          ? { x: seg.points[1][0], y: seg.points[1][1] }
          : this.map.project(seg.points[1]);
        const cppos = this.mode === 'image'
          ? { x: seg.controlPoint[0], y: seg.controlPoint[1] }
          : this.map.project(seg.controlPoint);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p1pos.x * dpr, p1pos.y * dpr);
        ctx.quadraticCurveTo(cppos.x * dpr, cppos.y * dpr, p2pos.x * dpr, p2pos.y * dpr);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3 * dpr;
        ctx.stroke();
        ctx.restore();
      }
    }

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

    // Draw grid if requested
    if (withGrid && Grid.isActive()) {
      const gridCanvas = document.getElementById('grid-canvas');
      ctx.drawImage(gridCanvas, 0, 0, gridCanvas.width, gridCanvas.height,
        0, 0, resultCanvas.width, resultCanvas.height);
    }

    // Draw scale bar
    this._drawScaleBar(ctx, resultCanvas.width, resultCanvas.height, dpr);

    // Download
    resultCanvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'autocross-course.png';
      a.click();
      URL.revokeObjectURL(url);
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
    // Export
    document.getElementById('btn-export').addEventListener('click', () => {
      const data = this._serializeFull();
      Storage.exportJSON(data, 'autocross-course.json');
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
      this.imageFileName
    );
    data.obstacles = Obstacles.getData();
    data.workers = Workers.getData();
    data.courseOutline = CourseOutline.getData();
    data.startConePair = this._currentStartConePair.slice(); // Include start cone pair
    data.startBeamPair = this._currentStartBeamPair.slice(); // Include start beam pair
    data.finishConePair = this._currentFinishConePair.slice(); // Include finish cone pair
    return data;
  },

  /** Load course data (from save or import) */
  _loadCourseData(data) {
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
        this._updateStartBeamPairRotation();
      }
      // Restore finish cone pair with mapped IDs
      if (data.finishConePair && Array.isArray(data.finishConePair)) {
        this._currentFinishConePair = data.finishConePair.map(oldId => idMap[oldId]).filter(id => id != null);
        this._redrawFinishConeConnectingLine();
        this._updateFinishConePairRotation();
      }
    }
    if (data.drivingLine) DrivingLine.loadData(data.drivingLine);
    if (data.measurements) Measurements.loadData(data.measurements);
    if (data.notes) Notes.loadData(data.notes);
    if (data.obstacles) Obstacles.loadData(data.obstacles);
    if (data.workers) Workers.loadData(data.workers);
    if (data.courseOutline) CourseOutline.loadData(data.courseOutline);
    if (data.mapCenter && data.mapZoom && this.mode === 'map') {
      MapModule.flyTo(data.mapCenter, data.mapZoom);
    }
    // Restore image scale if present
    if (data.imageScale && this.mode === 'image') {
      this._setImageScale(data.imageScale, 'Calibrated (imported)');
    }
    this._updateInfo();
  },

  /** Refresh the saved courses list in sidebar */
  _refreshSavedList() {
    const list = document.getElementById('saved-list');
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
        this._hidePreviewLine();
        if (this.activeTool === 'measure') {
          Measurements.cancelPending();
        }
        if (this.activeTool === 'courseoutline') {
          CourseOutline.cancelPending();
        }
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

  // ===== Obstacle Type Selector =====

  _setupObstacleSelector() {
    const select = document.getElementById('obstacle-type-select');
    select.addEventListener('change', () => {
      Obstacles.setType(select.value);
    });
  },

  // ===== Venue =====

  _setupVenue() {
    document.getElementById('btn-save-venue').addEventListener('click', () => {
      Venue.saveVenue();
    });
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
};

// Boot the app
document.addEventListener('DOMContentLoaded', () => App.init());
