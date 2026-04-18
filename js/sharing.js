// sharing.js — URL-based course sharing using LZ compression

const Sharing = {
  /** Generate a shareable URL and copy to clipboard */
  share() {
    const center = App.map.getCenter();
    const data = Storage.serialize(
      Cones.getData(),
      DrivingLine.getData(),
      Measurements.getData(),
      Notes.getData(),
      center.toArray ? center.toArray() : [center.lng, center.lat],
      App.map.getZoom(),
      App.mode === 'image',
      App.imageFileName
    );

    data.obstacles = typeof Obstacles !== 'undefined' ? Obstacles.getData() : [];
    data.workers = typeof Workers !== 'undefined' ? Workers.getData() : [];
    data.startConePair = App._currentStartConePair.slice(); // Include start cone pair

    const json = JSON.stringify(data);
    const compressed = this._compress(json);

    // Check size — URL hash can handle ~2KB safely
    if (compressed.length > 2500) {
      this._showToast('Course too large for URL sharing. Use Export instead.', 'warning');
      return;
    }

    const url = window.location.origin + window.location.pathname + '#course=' + compressed;

    navigator.clipboard.writeText(url).then(() => {
      this._showToast('Share URL copied to clipboard!', 'info');
    }).catch(() => {
      // Fallback: show URL in prompt
      prompt('Copy this URL to share your course:', url);
    });
  },

  /** Check URL hash for shared course data on page load */
  loadFromURL() {
    const hash = window.location.hash;
    if (!hash || !hash.startsWith('#course=')) return null;

    try {
      const compressed = hash.substring(8);
      const json = this._decompress(compressed);
      const data = JSON.parse(json);
      // Clear the hash so it doesn't re-load on refresh
      history.replaceState(null, '', window.location.pathname);
      return data;
    } catch (e) {
      console.warn('Failed to load shared course from URL:', e);
      return null;
    }
  },

  /** Simple LZ-style compression using base64 encoding */
  _compress(str) {
    // Use built-in compression via TextEncoder + base64
    try {
      const encoded = new TextEncoder().encode(str);
      // Simple RLE-like compression for JSON (lots of repeated patterns)
      const compressed = this._deflateSimple(encoded);
      return btoa(String.fromCharCode(...compressed))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
      // Fallback: just base64 encode
      return btoa(unescape(encodeURIComponent(str)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
  },

  /** Simple decompression */
  _decompress(str) {
    try {
      // Restore base64 padding
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      // Try to inflate
      const decompressed = this._inflateSimple(bytes);
      return new TextDecoder().decode(decompressed);
    } catch (e) {
      // Fallback: try plain base64
      let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return decodeURIComponent(escape(atob(b64)));
    }
  },

  /** Simple deflate - just stores raw bytes (real compression would use a library) */
  _deflateSimple(data) {
    return data;
  },

  /** Simple inflate - returns raw bytes */
  _inflateSimple(data) {
    return data;
  },

  /** Show a toast notification */
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
};
