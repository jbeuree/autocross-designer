// storage.js — Save/load/export/import courses via localStorage + JSON files

const Storage = {
  STORAGE_KEY: 'autocross-courses',

  /** Get all saved courses as { name: courseData } */
  getAll() {
    try {
      return JSON.parse(localStorage.getItem(this.STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  },

  /** Save a course by name */
  save(name, data) {
    const all = this.getAll();
    all[name] = data;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
  },

  /** Load a course by name, returns null if not found */
  load(name) {
    return this.getAll()[name] || null;
  },

  /** Delete a course by name */
  remove(name) {
    const all = this.getAll();
    delete all[name];
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all));
  },

  /** List all saved course names */
  list() {
    return Object.keys(this.getAll());
  },

  /** Serialize current state to a plain object for saving */
  serialize(cones, drivingLine, measurements, notes, mapCenter, mapZoom, imageMode, imageFileName, solidDrivingLine) {
    const data = {
      cones: cones.map(c => {
        const d = { id: c.id, type: c.type, lngLat: c.lngLat, lockedTargetId: c.lockedTargetId || null };
        if (c.width != null) d.width = c.width;
        if (c.height != null) d.height = c.height;
        if (c.rotation) d.rotation = c.rotation;
        if (c.text != null) d.text = c.text;
        return d;
      }),
      drivingLine: drivingLine.map(wp => ({ lngLat: wp.lngLat })),
      measurements: measurements,
      notes: notes,
      mapCenter,
      mapZoom,
      solidDrivingLine: !!solidDrivingLine,
    };
    if (imageMode) {
      data.imageMode = true;
      data.imageFileName = imageFileName || null;
      if (ImageMap.hasScale()) {
        data.imageScale = ImageMap.getScale();
      }
    }
    return data;
  },

  /** Export current course as a downloadable JSON file */
  exportJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'autocross-course.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /** Import a JSON file, returns a Promise that resolves with parsed data */
  importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          resolve(JSON.parse(e.target.result));
        } catch (err) {
          reject(new Error('Invalid JSON file'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  },
};
