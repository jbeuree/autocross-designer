// map.js — Mapbox setup, satellite view, location search

// ====================================================
// PASTE YOUR MAPBOX ACCESS TOKEN BELOW
// ====================================================
const MAPBOX_TOKEN = 'REDACTED_MAPBOX_TOKEN';

const MapModule = {
  map: null,
  _lastGeocode: 0,        // timestamp of last geocode call (debounce)
  _sessionGeocodeCount: 0, // geocode calls this session (rate limit)
  _SESSION_LIMIT: 50,
  _DEBOUNCE_MS: 500,

  /** Initialize the Mapbox map */
  init() {
    mapboxgl.accessToken = MAPBOX_TOKEN;

    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [-121.1094, 37.4080], // San Jose, CA default
      zoom: 17,
      minZoom: 10,
      maxZoom: 19,
      preserveDrawingBuffer: true,
    });

    this.map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    this._setupSearch();
    return this.map;
  },

  /** Get the map instance */
  getMap() {
    return this.map;
  },

  /** Fly to a specific location */
  flyTo(lngLat, zoom) {
    this.map.flyTo({ center: lngLat, zoom: zoom || 17 });
  },

  /** Set up the search bar functionality */
  _setupSearch() {
    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');
    const suggestions = document.getElementById('search-suggestions');

    const doSearch = () => {
      const query = input.value.trim();
      if (!query) return;
      this._hideSuggestions();

      // Check if it's coordinates (lat, lng)
      const coordMatch = query.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
      if (coordMatch) {
        const lat = parseFloat(coordMatch[1]);
        const lng = parseFloat(coordMatch[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          this.flyTo([lng, lat]);
          return;
        }
      }

      // Debounce: ignore if called within cooldown period
      const now = Date.now();
      if (now - this._lastGeocode < this._DEBOUNCE_MS) {
        return;
      }

      // Session rate limit check
      if (this._sessionGeocodeCount >= this._SESSION_LIMIT) {
        this._showToast('Search limit reached — please reload or use cached suggestions', 'error');
        return;
      }

      // Disable button briefly for visual feedback
      btn.disabled = true;
      btn.style.opacity = '0.5';
      setTimeout(() => { btn.disabled = false; btn.style.opacity = ''; }, this._DEBOUNCE_MS);

      // Geocoding search
      this._geocode(query);
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSearch();
      if (e.key === 'Escape') this._hideSuggestions();
    });

    // Show cached suggestions on input
    input.addEventListener('input', () => {
      const prefix = input.value.trim();
      if (prefix.length < 2) {
        this._hideSuggestions();
        return;
      }

      const matches = GeoCache.suggest(prefix);
      if (matches.length === 0) {
        this._hideSuggestions();
        return;
      }

      suggestions.innerHTML = matches.map(m =>
        `<div class="suggestion-item" data-lng="${m.lngLat[0]}" data-lat="${m.lngLat[1]}">${m.displayName}</div>`
      ).join('');
      suggestions.classList.remove('hidden');

      suggestions.querySelectorAll('.suggestion-item').forEach(el => {
        el.addEventListener('click', () => {
          const lng = parseFloat(el.dataset.lng);
          const lat = parseFloat(el.dataset.lat);
          input.value = el.textContent;
          this._hideSuggestions();
          this.flyTo([lng, lat]);
        });
      });
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-bar') && !e.target.closest('#search-suggestions')) {
        this._hideSuggestions();
      }
    });
  },

  /** Hide the suggestion dropdown */
  _hideSuggestions() {
    document.getElementById('search-suggestions').classList.add('hidden');
  },

  /** Geocode a search query using Mapbox Geocoding API */
  _geocode(query) {
    // Check cache first (doesn't count against rate limit)
    const cached = GeoCache.lookup(query);
    if (cached) {
      this.flyTo(cached.lngLat);
      return;
    }

    // Track this API call
    this._lastGeocode = Date.now();
    this._sessionGeocodeCount++;

    // Warn when approaching limit
    if (this._sessionGeocodeCount === 40) {
      this._showToast('Approaching search limit (40/' + this._SESSION_LIMIT + ')', 'warning');
    }

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxgl.accessToken}&limit=1`;

    fetch(url)
      .then(res => {
        if (res.status === 429) {
          this._showToast('Rate limited by Mapbox — please wait a moment and try again', 'error');
          return null;
        }
        if (res.status === 401 || res.status === 403) {
          this._showToast('Mapbox token is invalid or expired — contact the site owner', 'error');
          return null;
        }
        if (!res.ok) {
          this._showToast('Search failed (HTTP ' + res.status + ')', 'error');
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (!data) return;
        if (data.message) {
          // Mapbox returns { message: "..." } for quota/auth errors
          this._showToast('Mapbox API: ' + data.message, 'error');
          return;
        }
        if (data.features && data.features.length > 0) {
          const feature = data.features[0];
          const [lng, lat] = feature.center;
          const displayName = feature.place_name || query;
          GeoCache.store(query, [lng, lat], displayName);
          this.flyTo([lng, lat]);
        } else {
          this._showToast('Location not found', 'warning');
        }
      })
      .catch(() => {
        this._showToast('Network error — check your connection and try again', 'error');
      });
  },

  /** Show a toast notification */
  _showToast(message, type) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.textContent = message;
    container.appendChild(toast);

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      toast.classList.add('toast-fade-out');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  },
};
