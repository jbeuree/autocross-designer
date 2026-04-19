// cones.js — Cone placement, dragging, deletion, rendering

const POINTER_SNAP_OFFSET_DEG = 0.000014; // ~5ft offset

const Cones = {
  cones: [],
  _nextId: 1,
  _map: null,
  _onSelect: null,   // callback when a cone is selected
  _onUpdate: null,    // callback when cones change
  _onViewUpdate: null, // callback when view changes (zoom/move)

  init(map, { onSelect, onUpdate, onViewUpdate }) {
    this._map = map;
    this._onSelect = onSelect;
    this._onUpdate = onUpdate;
    this._onViewUpdate = onViewUpdate;

    // Update element scales on zoom so trailer/staging-grid scale with the map
    map.on('zoom', () => this._updateAllElementScales());
    map.on('move', () => this._updateAllElementScales());
  },

  /** Find the nearest regular (non-pointer) cone to a given [lng, lat] */
  _findNearestRegularCone(lngLat) {
    let nearest = null;
    let minDist = Infinity;
    for (const c of this.cones) {
      if (c.type === 'pointer') continue;
      const dx = c.lngLat[0] - lngLat[0];
      const dy = c.lngLat[1] - lngLat[1];
      const dist = dx * dx + dy * dy;
      if (dist < minDist) {
        minDist = dist;
        nearest = c;
      }
    }
    return nearest;
  },

  /** Compute rotation angle (degrees) from pointer to target cone */
  _computePointerRotation(cone) {
    let target = null;

    // If locked to a specific target, use it (if it still exists)
    if (cone.lockedTargetId != null) {
      target = this.cones.find(c => c.id === cone.lockedTargetId && c.type !== 'pointer');
      if (!target) {
        // Locked target was deleted — clear lock
        cone.lockedTargetId = null;
      }
    }

    // Fall back to nearest regular cone
    if (!target) {
      target = this._findNearestRegularCone(cone.lngLat);
    }

    if (!target) return 0;
    const dx = target.lngLat[0] - cone.lngLat[0];
    const dy = target.lngLat[1] - cone.lngLat[1];

    if (App.mode === 'image') {
      // Image mode: pixel coords, Y increases downward
      return Math.atan2(dx, -dy) * (180 / Math.PI);
    } else {
      // Map mode: correct for latitude projection distortion
      // At a given latitude, 1° lng covers less distance than 1° lat
      const cosLat = Math.cos(cone.lngLat[1] * Math.PI / 180);
      const correctedDx = dx * cosLat;
      return Math.atan2(correctedDx, dy) * (180 / Math.PI);
    }
  },

  /** Apply rotation CSS to a pointer cone's marker element */
  _applyPointerRotation(cone) {
    if (cone.type !== 'pointer') return;
    const angle = this._computePointerRotation(cone);
    const inner = cone.marker.getElement().querySelector('.marker-pointer');
    if (inner) {
      inner.style.transformOrigin = 'center 66%';
      inner.style.transform = `rotate(${angle}deg)`;
    }
  },

  /** Apply rotation for a finish cone marker */
  _applyFinishConeRotation(cone) {
    if (cone.type !== 'finish-cone') return;
    const inner = cone.marker.getElement().querySelector('.marker-finish');
    if (inner) {
      inner.style.transformOrigin = 'center center';
      inner.style.transform = `rotate(${cone.rotation || 0}deg)`;
    }
  },

  _applyStartBeamRotation(cone) {
    if (cone.type !== 'start-beam') return;
    const inner = cone.marker.getElement().querySelector('.marker-start-beam');
    if (inner) {
      inner.style.transformOrigin = 'center center';
      inner.style.transform = `rotate(${cone.rotation || 0}deg)`;
    }
  },

  /** Update rotation for all pointer cones */
  _updateAllPointerRotations() {
    for (const c of this.cones) {
      if (c.type === 'pointer') {
        this._applyPointerRotation(c);
      }
    }
  },

  /** Update rotation for all finish cone markers */
  _updateAllFinishConeRotations() {
    for (const c of this.cones) {
      if (c.type === 'finish-cone') {
        this._applyFinishConeRotation(c);
      }
    }
  },

  /** Update rotation for all start-beam markers */
  _updateAllStartBeamRotations() {
    for (const c of this.cones) {
      if (c.type === 'start-beam') {
        this._applyStartBeamRotation(c);
      }
    }
  },


  /** Place a cone of the given type at lngLat. If exactLngLat is provided, skip snap logic and use those exact coordinates. */
  place(type, lngLat, exactLngLat) {
    const id = this._nextId++;

    let placeLng, placeLat;

    if (exactLngLat) {
      // Use exact coordinates (e.g. restoring from saved data)
      placeLng = exactLngLat[0];
      placeLat = exactLngLat[1];
    } else {
      placeLng = lngLat.lng;
      placeLat = lngLat.lat;

      // Snap pointer cones near the nearest regular cone
      if (type === 'pointer') {
        const nearest = this._findNearestRegularCone([lngLat.lng, lngLat.lat]);
        if (nearest) {
          const dx = lngLat.lng - nearest.lngLat[0];
          const dy = lngLat.lat - nearest.lngLat[1];

          if (App.mode === 'image') {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0) {
              const snapOffset = ImageMap.hasScale() ? (5 / ImageMap.getScale()) : 15;
              placeLng = nearest.lngLat[0] + (dx / dist) * snapOffset;
              placeLat = nearest.lngLat[1] + (dy / dist) * snapOffset;
            }
          } else {
            // Correct for latitude projection so pointers orbit in a true circle
            const cosLat = Math.cos(nearest.lngLat[1] * Math.PI / 180);
            const dxMeters = dx * cosLat;
            const dist = Math.sqrt(dxMeters * dxMeters + dy * dy);
            if (dist > 0) {
              const snapOffset = POINTER_SNAP_OFFSET_DEG;
              // Apply offset in corrected space, then convert back to degrees
              placeLng = nearest.lngLat[0] + (dxMeters / dist) * snapOffset / cosLat;
              placeLat = nearest.lngLat[1] + (dy / dist) * snapOffset;
            }
          }
        }
      }
    }

    const el = this._createElement(type);

    const marker = window.createMarker({ element: el, draggable: true })
      .setLngLat([placeLng, placeLat])
      .addTo(this._map);

    const cone = { id, type, lngLat: [placeLng, placeLat], marker, lockedTargetId: null, width: null, height: null, rotation: 0 };
    this.cones.push(cone);

    // Add resize and rotate handles for resizable elements
    if (type === 'trailer' || type === 'staging-grid') {
      const defaults = type === 'trailer' ? { w: 40, h: 20 } : { w: 80, h: 50 };
      cone.width = defaults.w;
      cone.height = defaults.h;
      // Store base zoom so element scales proportionally with the map
      if (App.mode !== 'image') {
        cone.baseZoom = this._map.getZoom();
      }
      this._addResizeHandle(cone, el);
      this._addRotateHandle(cone, el);
      this._updateElementTransform(cone);
    }

    // Group drag: start tracking when drag begins on a multi-selected cone
    marker.on('dragstart', () => {
      if (typeof Selection !== 'undefined' && Selection.isSelected('cone', cone.id) && Selection.count() > 1) {
        Selection.startGroupDrag('cone', cone.id);
      }
    });

    // Group drag: move all selected items during drag
    marker.on('drag', () => {
      const pos = marker.getLngLat();
      if (typeof Selection !== 'undefined' && Selection.isSelected('cone', cone.id) && Selection.count() > 1) {
        Selection.updateGroupDrag(pos);
      }
      // Live-update any measurements anchored to this cone
      if (typeof Measurements !== 'undefined') {
        Measurements.updateConePosition(cone.id, [pos.lng, pos.lat]);
      }
    });

    // Update lngLat on drag
    marker.on('dragend', () => {
      const pos = marker.getLngLat();
      cone.lngLat = [pos.lng, pos.lat];

      // If part of a group drag, finalize all positions
      if (typeof Selection !== 'undefined' && Selection.isSelected('cone', cone.id) && Selection.count() > 1) {
        Selection.endGroupDrag();
      }

      // Update any measurements anchored to this cone
      if (typeof Measurements !== 'undefined') {
        Measurements.updateConePosition(cone.id, cone.lngLat);
      }

      // Drag-to-lock: if pointer cone dropped near a regular cone, lock onto it
      if (cone.type === 'pointer') {
        cone.lockedTargetId = null; // clear previous lock
        const screenPos = this._map.project(pos);
        let bestDist = 25; // pixel threshold
        let bestTarget = null;
        for (const c of this.cones) {
          if (c.type === 'pointer' || c.id === cone.id) continue;
          const cScreen = this._map.project(c.lngLat);
          const dx = cScreen.x - screenPos.x;
          const dy = cScreen.y - screenPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < bestDist) {
            bestDist = dist;
            bestTarget = c;
          }
        }
        if (bestTarget) {
          cone.lockedTargetId = bestTarget.id;
        }
      }

      this._updateAllPointerRotations();
      if (cone.type === 'finish-cone' && typeof App !== 'undefined' && App._updateFinishConePairRotation) {
        App._updateFinishConePairRotation();
      }
      if (cone.type === 'start-beam' && typeof App !== 'undefined' && App._updateStartBeamPairRotation) {
        App._updateStartBeamPairRotation();
      }
      if (this._onUpdate) this._onUpdate();
    });

    // Click to select
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._onSelect) this._onSelect(cone);
    });

    // Right-click to delete
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      App.handleConeDelete(id);
      // this.remove(id);
    });

    this._updateAllPointerRotations();
    if (this._onUpdate) this._onUpdate();
    return cone;
  },

  /** Remove a cone by id */
  remove(id) {
    console.log('Removing cone with id in cones.js remove:', id);
    const idx = this.cones.findIndex(c => c.id === id);
    if (idx === -1) return;
    this.cones[idx].marker.remove();
    this.cones.splice(idx, 1);

    // Detach any measurements anchored to this cone
    if (typeof Measurements !== 'undefined') {
      Measurements.detachCone(id);
    }

    this._updateAllPointerRotations();
    if (this._onUpdate) this._onUpdate();
  },

  /** Clear all cones */
  clearAll() {
    this.cones.forEach(c => c.marker.remove());
    this.cones = [];
    if (this._onUpdate) this._onUpdate();
  },

  /** Highlight a cone as selected */
  setSelected(cone) {
    // Remove previous selection
    this.cones.forEach(c => c.marker.getElement().classList.remove('selected'));
    if (cone) {
      cone.marker.getElement().classList.add('selected');
    }
  },

  /** Get cones data for serialization */
  getData() {
    return this.cones.map(c => {
      const d = { id: c.id, type: c.type, lngLat: c.lngLat, lockedTargetId: c.lockedTargetId || null };
      if (c.width != null) d.width = c.width;
      if (c.height != null) d.height = c.height;
      if (c.rotation) d.rotation = c.rotation;
      if (c.baseZoom != null) d.baseZoom = c.baseZoom;
      return d;
    });
  },

  /** Load cones from saved data */
  loadData(data) {
    this.clearAll();
    // First pass: place all cones
    const idMap = {};
    data.forEach(d => {
      const cone = this.place(d.type, { lng: d.lngLat[0], lat: d.lngLat[1] }, d.lngLat);
      idMap[d.id] = cone.id; // Map old ID to new ID
      // Restore size, rotation, and base zoom for resizable elements
      if (d.width != null && d.height != null) {
        cone.width = d.width;
        cone.height = d.height;
      }
      if (d.rotation) {
        cone.rotation = d.rotation;
      }
      if (d.baseZoom != null) {
        cone.baseZoom = d.baseZoom;
      }
      if (cone.width || cone.rotation) {
        this._applySize(cone);
      }
    });
    // Second pass: restore locked targets (map old IDs to new IDs)
    data.forEach(d => {
      if (d.lockedTargetId != null && idMap[d.id] && idMap[d.lockedTargetId]) {
        const cone = this.cones.find(c => c.id === idMap[d.id]);
        if (cone) {
          cone.lockedTargetId = idMap[d.lockedTargetId];
        }
      }
    });
    this._updateAllPointerRotations();
    this._updateAllFinishConeRotations();
    this._updateAllStartBeamRotations();
    return idMap; // Return the ID mapping
  },

  /** Get cone count (only actual cone types) */
  count() {
    const coneTypes = ['regular', 'pointer', 'start-cone', 'start-beam', 'finish-cone'];
    return this.cones.filter(c => coneTypes.includes(c.type)).length;
  },

  /** Get element count (non-cone placeable items) */
  elementCount() {
    const coneTypes = ['regular', 'pointer', 'start-cone', 'start-beam', 'finish-cone'];
    return this.cones.filter(c => !coneTypes.includes(c.type)).length;
  },

  /** Add a resize handle to a resizable element */
  _addResizeHandle(cone, el) {
    const handle = document.createElement('div');
    handle.className = 'resize-handle';
    el.appendChild(handle);
    el.classList.add('resizable');

    let resizing = false;
    let startX, startY, startW, startH;

    const inner = el.querySelector('.marker-trailer, .marker-staging-grid');

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = cone.width;
      startH = cone.height;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!resizing) return;
      // Account for both the map/image zoom and the element's own scale
      const elemScale = this._getElementScale(cone);
      const mapScale = (App.mode === 'image') ? (ImageMap._scale || 1) : 1;
      const totalScale = mapScale * elemScale;
      const dx = (e.clientX - startX) / totalScale;
      const dy = (e.clientY - startY) / totalScale;
      cone.width = Math.max(20, startW + dx);
      cone.height = Math.max(12, startH + dy);
      if (inner) {
        inner.style.width = cone.width + 'px';
        inner.style.height = cone.height + 'px';
      }
    };

    const onMouseUp = () => {
      resizing = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (this._onUpdate) this._onUpdate();
    };

    handle.addEventListener('mousedown', onMouseDown);
  },

  /** Add a rotation handle to a resizable element */
  _addRotateHandle(cone, el) {
    const handle = document.createElement('div');
    handle.className = 'rotate-handle';
    handle.title = 'Drag to rotate';
    el.appendChild(handle);

    const inner = el.querySelector('.marker-trailer, .marker-staging-grid');
    let rotating = false;
    let centerX, centerY;

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      rotating = true;

      // Get the center of the element on screen
      const rect = el.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e) => {
      if (!rotating) return;
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;
      let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      // Snap to 15-degree increments when holding shift
      if (e.shiftKey) {
        angle = Math.round(angle / 15) * 15;
      }
      cone.rotation = angle;
      this._updateElementTransform(cone);
    };

    const onMouseUp = () => {
      rotating = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (this._onUpdate) this._onUpdate();
    };

    handle.addEventListener('mousedown', onMouseDown);
  },

  /** Get the current zoom-based scale factor for a resizable element */
  _getElementScale(cone) {
    if (cone.type === 'trailer') {
      // Trailers don't scale with map zoom, but do scale in image mode
      return 1;
    }
    if (App.mode === 'image') {
      return ImageMap._scale;
    } else {
      if (cone.baseZoom == null) return 1;
      return Math.pow(2, this._map.getZoom() - cone.baseZoom);
    }
  },

  /** Update the transform (rotation + scale) on a resizable element */
  _updateElementTransform(cone) {
    const inner = cone.marker.getElement().querySelector('.marker-trailer, .marker-staging-grid');
    if (!inner) return;
    const s = this._getElementScale(cone);
    const r = cone.rotation || 0;
    inner.style.transform = `rotate(${r}deg) scale(${s})`;
  },

  /** Update scale for all trailer/staging-grid elements */
  _updateAllElementScales() {
    for (const c of this.cones) {
      if (c.type === 'trailer' || c.type === 'staging-grid') {
        this._updateElementTransform(c);
      }
    }
    // Notify about view changes for elements that need redrawing
    if (this._onViewUpdate) this._onViewUpdate();
  },

  /** Apply stored size and rotation to a resizable element */
  _applySize(cone) {
    const inner = cone.marker.getElement().querySelector('.marker-trailer, .marker-staging-grid');
    if (!inner) return;
    if (cone.width && cone.height) {
      inner.style.width = cone.width + 'px';
      inner.style.height = cone.height + 'px';
    }
    this._updateElementTransform(cone);
  },

  /** Create the HTML element for a cone marker */
  _createElement(type) {
    const el = document.createElement('div');
    const zClass = type === 'pointer' ? 'cone-marker-pointer' : 'cone-marker-regular';
    el.className = 'cone-marker ' + zClass;

    switch (type) {
      case 'regular':
        el.innerHTML = '<div class="marker-regular"></div>';
        break;
      case 'pointer':
        el.innerHTML = '<div class="marker-pointer"></div>';
        break;
      case 'start-cone':
        el.innerHTML = '<div class="marker-start"></div>';
        break;
      case 'start-beam':
        el.innerHTML = '<div class="marker-start-beam"></div>';
        break;
      case 'finish-cone':
        el.innerHTML = '<div class="marker-finish"></div>';
        break;
      case 'trailer':
        el.innerHTML = '<div class="marker-trailer"></div>';
        break;
      case 'staging-grid':
        el.innerHTML = '<div class="marker-staging-grid">GRID</div>';
        break;
      default:
        el.innerHTML = '<div class="marker-regular"></div>';
    }

    return el;
  },
};
