// selection.js — Multi-select & bulk move

const Selection = {
  _selected: [],       // array of { type, id, module } objects
  _boxEl: null,        // selection rectangle element
  _boxStart: null,     // {x, y} screen coords
  _draggingBulk: false,
  _dragOffsets: [],

  // Group drag state
  _groupDragRef: null,     // { lng, lat } reference start position of dragged item
  _groupDragItems: [],     // array of { type, id, startLngLat: [lng, lat] }

  init() {
    // Create selection box element
    this._boxEl = document.createElement('div');
    this._boxEl.className = 'selection-box hidden';
    document.body.appendChild(this._boxEl);
  },

  /** Clear the selection */
  clear() {
    for (const item of this._selected) {
      const el = this._getMarkerElement(item);
      if (el) el.classList.remove('multi-selected');
    }
    this._selected = [];
  },

  /** Toggle an item in the selection (Shift+click) */
  toggle(type, id) {
    const idx = this._selected.findIndex(s => s.type === type && s.id === id);
    if (idx !== -1) {
      // Remove from selection
      const item = this._selected[idx];
      const el = this._getMarkerElement(item);
      if (el) el.classList.remove('multi-selected');
      this._selected.splice(idx, 1);
    } else {
      // Add to selection
      const item = { type, id };
      this._selected.push(item);
      const el = this._getMarkerElement(item);
      if (el) el.classList.add('multi-selected');
    }
  },

  /** Select all items */
  selectAll() {
    this.clear();
    // Select all cones
    for (const c of Cones.cones) {
      this._selected.push({ type: 'cone', id: c.id });
      c.marker.getElement().classList.add('multi-selected');
    }
    // Select all obstacles
    if (typeof Obstacles !== 'undefined') {
      for (const o of Obstacles.obstacles) {
        this._selected.push({ type: 'obstacle', id: o.id });
        o.marker.getElement().classList.add('multi-selected');
      }
    }
    // Select all workers
    if (typeof Workers !== 'undefined') {
      for (const w of Workers.stations) {
        this._selected.push({ type: 'worker', id: w.id });
        w.marker.getElement().classList.add('multi-selected');
      }
    }
  },

  /** Delete all selected items */
  deleteSelected() {
    if (this._selected.length === 0) return;
    History.push();

    console.log('Deleting selected items:', this._selected);
    for (const item of this._selected) {
      switch (item.type) {
        case 'cone':
          App._handleConeDelete(item.id);
          break;
        case 'obstacle':
          if (typeof Obstacles !== 'undefined') Obstacles.removeObstacle(item.id);
          break;
        case 'worker':
          if (typeof Workers !== 'undefined') Workers.removeStation(item.id);
          break;
      }
    }
    this._selected = [];
  },

  /** Check if an item is selected */
  isSelected(type, id) {
    return this._selected.some(s => s.type === type && s.id === id);
  },

  /** Get count of selected items */
  count() {
    return this._selected.length;
  },

  // ===== Group Drag =====

  /** Start a group drag — record starting positions of all selected items */
  startGroupDrag(type, id) {
    const obj = this._getItemObject(type, id);
    if (!obj) return;

    this._groupDragRef = { lng: obj.lngLat[0], lat: obj.lngLat[1] };
    this._groupDragItems = [];

    for (const sel of this._selected) {
      // Skip the item being directly dragged (Mapbox handles it)
      if (sel.type === type && sel.id === id) continue;
      const itemObj = this._getItemObject(sel.type, sel.id);
      if (itemObj) {
        this._groupDragItems.push({
          type: sel.type,
          id: sel.id,
          startLngLat: itemObj.lngLat.slice(),
        });
      }
    }
  },

  /** Update group drag — apply delta from reference to all other selected items */
  updateGroupDrag(newLngLat) {
    if (!this._groupDragRef) return;

    const dLng = newLngLat.lng - this._groupDragRef.lng;
    const dLat = newLngLat.lat - this._groupDragRef.lat;

    for (const item of this._groupDragItems) {
      const obj = this._getItemObject(item.type, item.id);
      if (!obj) continue;
      const newPos = [item.startLngLat[0] + dLng, item.startLngLat[1] + dLat];
      obj.marker.setLngLat(newPos);
    }
  },

  /** End group drag — finalize all lngLat positions and update dependents */
  endGroupDrag() {
    if (!this._groupDragRef) return;

    // Finalize positions for all items that were moved
    for (const item of this._groupDragItems) {
      const obj = this._getItemObject(item.type, item.id);
      if (!obj) continue;
      const pos = obj.marker.getLngLat();
      obj.lngLat = [pos.lng, pos.lat];

      // Update measurements for cones
      if (item.type === 'cone' && typeof Measurements !== 'undefined') {
        Measurements.updateConePosition(obj.id, obj.lngLat);
      }
    }

    // Update pointer rotations after all cones have moved
    Cones._updateAllPointerRotations();

    this._groupDragRef = null;
    this._groupDragItems = [];
  },

  /** Get the underlying data object for a selected item */
  _getItemObject(type, id) {
    switch (type) {
      case 'cone':
        return Cones.cones.find(c => c.id === id) || null;
      case 'obstacle':
        if (typeof Obstacles === 'undefined') return null;
        return Obstacles.obstacles.find(o => o.id === id) || null;
      case 'worker':
        if (typeof Workers === 'undefined') return null;
        return Workers.stations.find(w => w.id === id) || null;
    }
    return null;
  },

  // ===== Box Selection =====

  /** Start box selection */
  startBox(screenX, screenY) {
    this._boxStart = { x: screenX, y: screenY };
    this._boxEl.classList.remove('hidden');
    this._updateBox(screenX, screenY);
  },

  /** Update box selection during drag */
  updateBox(screenX, screenY) {
    if (!this._boxStart) return;
    this._updateBox(screenX, screenY);
  },

  /** End box selection */
  endBox(screenX, screenY) {
    if (!this._boxStart) return;

    const x1 = Math.min(this._boxStart.x, screenX);
    const y1 = Math.min(this._boxStart.y, screenY);
    const x2 = Math.max(this._boxStart.x, screenX);
    const y2 = Math.max(this._boxStart.y, screenY);

    // Only select if the box is at least 5px in both dimensions
    if (x2 - x1 > 5 && y2 - y1 > 5) {
      this.clear();
      this._selectInBox(x1, y1, x2, y2);
    }

    this._boxEl.classList.add('hidden');
    this._boxStart = null;
  },

  /** Update the visual selection box */
  _updateBox(screenX, screenY) {
    const x1 = Math.min(this._boxStart.x, screenX);
    const y1 = Math.min(this._boxStart.y, screenY);
    const w = Math.abs(screenX - this._boxStart.x);
    const h = Math.abs(screenY - this._boxStart.y);
    this._boxEl.style.left = x1 + 'px';
    this._boxEl.style.top = y1 + 'px';
    this._boxEl.style.width = w + 'px';
    this._boxEl.style.height = h + 'px';
  },

  /** Select all items within a screen-space bounding box */
  _selectInBox(x1, y1, x2, y2) {
    const project = (lngLat) => App.map.project(lngLat);

    // Check cones
    for (const c of Cones.cones) {
      const p = project(c.lngLat);
      if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) {
        this._selected.push({ type: 'cone', id: c.id });
        c.marker.getElement().classList.add('multi-selected');
      }
    }
    // Check obstacles
    if (typeof Obstacles !== 'undefined') {
      for (const o of Obstacles.obstacles) {
        const p = project(o.lngLat);
        if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) {
          this._selected.push({ type: 'obstacle', id: o.id });
          o.marker.getElement().classList.add('multi-selected');
        }
      }
    }
    // Check workers
    if (typeof Workers !== 'undefined') {
      for (const w of Workers.stations) {
        const p = project(w.lngLat);
        if (p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2) {
          this._selected.push({ type: 'worker', id: w.id });
          w.marker.getElement().classList.add('multi-selected');
        }
      }
    }
  },

  /** Get the marker element for a selected item */
  _getMarkerElement(item) {
    switch (item.type) {
      case 'cone': {
        const c = Cones.cones.find(c => c.id === item.id);
        return c ? c.marker.getElement() : null;
      }
      case 'obstacle': {
        if (typeof Obstacles === 'undefined') return null;
        const o = Obstacles.obstacles.find(o => o.id === item.id);
        return o ? o.marker.getElement() : null;
      }
      case 'worker': {
        if (typeof Workers === 'undefined') return null;
        const w = Workers.stations.find(w => w.id === item.id);
        return w ? w.marker.getElement() : null;
      }
    }
    return null;
  },
};
