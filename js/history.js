// history.js — Undo/redo state management (snapshot-based)

const History = {
  _undoStack: [],
  _redoStack: [],
  _maxSnapshots: 50,
  _actionCount: 0,
  _autosaveInterval: 5,  // autosave every N actions
  _autosaveKey: 'autocross-autosave',

  /** Take a snapshot of the current app state and push to undo stack */
  push() {
    const snapshot = this._captureState();
    this._undoStack.push(snapshot);
    if (this._undoStack.length > this._maxSnapshots) {
      this._undoStack.shift();
    }
    // Any new action clears the redo stack
    this._redoStack = [];
    this._updateButtons();

    // Autosave to sessionStorage every N actions
    this._actionCount++;
    if (this._actionCount % this._autosaveInterval === 0) {
      this._autosave();
    }
  },

  /** Undo: restore previous state */
  undo() {
    if (this._undoStack.length === 0) return;
    // Save current state to redo stack
    this._redoStack.push(this._captureState());
    // Pop and restore
    const snapshot = this._undoStack.pop();
    this._restoreState(snapshot);
    this._updateButtons();
  },

  /** Redo: re-apply undone state */
  redo() {
    if (this._redoStack.length === 0) return;
    // Save current state to undo stack
    this._undoStack.push(this._captureState());
    // Pop and restore
    const snapshot = this._redoStack.pop();
    this._restoreState(snapshot);
    this._updateButtons();
  },

  /** Capture current state as a plain object */
  _captureState() {
    return {
      cones: Cones.getData(),
      drivingLine: DrivingLine.getData(),
      measurements: Measurements.getData(),
      notes: Notes.getData(),
      obstacles: typeof Obstacles !== 'undefined' ? Obstacles.getData() : [],
      workers: typeof Workers !== 'undefined' ? Workers.getData() : [],
    };
  },

  /** Restore state from a snapshot */
  _restoreState(snapshot) {
    if (snapshot.cones) Cones.loadData(snapshot.cones);
    if (snapshot.drivingLine) DrivingLine.loadData(snapshot.drivingLine);
    if (snapshot.measurements) Measurements.loadData(snapshot.measurements);
    if (snapshot.notes) Notes.loadData(snapshot.notes);
    if (snapshot.obstacles && typeof Obstacles !== 'undefined') Obstacles.loadData(snapshot.obstacles);
    if (snapshot.workers && typeof Workers !== 'undefined') Workers.loadData(snapshot.workers);

    // Update UI
    if (typeof App !== 'undefined') {
      App._updateInfo();
    }
  },

  /** Update undo/redo button states */
  _updateButtons() {
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.disabled = this._undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = this._redoStack.length === 0;
  },

  /** Clear all history */
  clear() {
    this._undoStack = [];
    this._redoStack = [];
    this._updateButtons();
  },

  /** Save current state to sessionStorage */
  _autosave() {
    try {
      const state = this._captureState();
      // Include mode and map position for full restore
      const center = App.map.getCenter();
      state._mode = App.mode;
      state._imageFileName = App.imageFileName;
      state._center = center.toArray ? center.toArray() : [center.lng, center.lat];
      state._zoom = App.map.getZoom();
      if (App.mode === 'image' && typeof ImageMap !== 'undefined' && ImageMap.hasScale()) {
        state._imageScale = ImageMap.getScale();
      }
      sessionStorage.setItem(this._autosaveKey, JSON.stringify(state));
    } catch (e) {
      // sessionStorage full or unavailable — silently ignore
    }
  },

  /** Check for and restore autosaved state. Returns true if restored. */
  restoreAutosave() {
    try {
      const raw = sessionStorage.getItem(this._autosaveKey);
      if (!raw) return false;
      const state = JSON.parse(raw);
      // Only restore if same mode
      if (state._mode && state._mode !== App.mode) return false;
      if (state.cones) Cones.loadData(state.cones);
      if (state.drivingLine) DrivingLine.loadData(state.drivingLine);
      if (state.measurements) Measurements.loadData(state.measurements);
      if (state.notes) Notes.loadData(state.notes);
      if (state.obstacles && typeof Obstacles !== 'undefined') Obstacles.loadData(state.obstacles);
      if (state.workers && typeof Workers !== 'undefined') Workers.loadData(state.workers);
      if (state._center && state._zoom && App.mode === 'map') {
        MapModule.flyTo(state._center, state._zoom);
      }
      if (state._imageScale && App.mode === 'image') {
        App._setImageScale(state._imageScale, 'Calibrated (restored)');
      }
      App._updateInfo();
      return true;
    } catch (e) {
      return false;
    }
  },

  /** Clear the autosave */
  clearAutosave() {
    try { sessionStorage.removeItem(this._autosaveKey); } catch (e) {}
  },
};
