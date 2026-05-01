// imageMode.js — Startup banner for choosing Map or Image mode + image gallery

const ImageMode = {
  _bundledImages: [],

  /**
   * Load the bundled image manifest from assets/courses/manifest.json.
   * Silently returns an empty list if the file is missing or invalid.
   */
  async _loadManifest() {
    try {
      const resp = await fetch('assets/courses/manifest.json?t=' + Date.now());
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  /**
   * Show the mode selection banner.
   * Returns a Promise that resolves with:
   *   { mode: 'map' } — user chose live map
   *   { mode: 'image', imageSrc: '<dataURL or path>', fileName: '<name>' } — user chose an image
   */
  /**
   * Show the mode selection banner.
   * @param {string} [autoMode] - If 'map', skip the banner and resolve immediately with map mode.
   *                               If 'image', skip the two-button choice and go straight to the gallery.
   * Returns a Promise that resolves with:
   *   { mode: 'map' } — user chose live map
   *   { mode: 'image', imageSrc: '<dataURL or path>', fileName: '<name>' } — user chose an image
   */
  showBanner(autoMode) {
    return new Promise((resolve) => {
      // Auto-select map mode (skip banner entirely)
      if (autoMode === 'map') {
        resolve({ mode: 'map' });
        return;
      }

      const banner = document.getElementById('mode-banner');
      const gallery = document.getElementById('image-gallery');
      const uploadInput = document.getElementById('image-upload');

      banner.classList.remove('hidden');

      // Auto-select image mode (skip choice screen, go straight to gallery)
      if (autoMode === 'image') {
        document.getElementById('mode-choices').classList.add('hidden');
        gallery.classList.remove('hidden');
        this._loadManifest().then(images => {
          this._bundledImages = images;
          this._buildGallery(gallery, uploadInput, resolve, banner);
        });
        return;
      }

      // "Draw on Live Map" button
      document.getElementById('btn-mode-map').addEventListener('click', () => {
        banner.classList.add('hidden');
        resolve({ mode: 'map' });
      });

      // "Load Image" button — reveals gallery
      document.getElementById('btn-mode-image').addEventListener('click', async () => {
        document.getElementById('mode-choices').classList.add('hidden');
        gallery.classList.remove('hidden');
        this._bundledImages = await this._loadManifest();
        console.log('Manifest loaded:', JSON.stringify(this._bundledImages));
        this._buildGallery(gallery, uploadInput, resolve, banner);
      });

      // "Blank Canvas" button — generate a white 800×1280 image
      document.getElementById('btn-mode-blank').addEventListener('click', () => {
        const c = document.createElement('canvas');
        c.width = 800;
        c.height = 1280;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 800, 1280);
        banner.classList.add('hidden');
        resolve({ mode: 'image', imageSrc: c.toDataURL('image/png'), fileName: 'Blank Canvas' });
      });
    });
  },

  /** Build the image gallery grid */
  _buildGallery(gallery, uploadInput, resolve, banner) {
    gallery.innerHTML = '';

    // Gallery header
    const header = document.createElement('h2');
    header.className = 'gallery-header';
    header.textContent = 'Choose a Course Image';
    gallery.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'gallery-grid';
    gallery.appendChild(grid);

    // Bundled images from manifest
    for (const img of this._bundledImages) {
      const filePath = 'assets/courses/' + img.file;
      const thumb = document.createElement('div');
      thumb.className = 'gallery-thumb';
      const thumbImg = document.createElement('img');
      thumbImg.src = filePath;
      thumbImg.alt = img.name;
      const thumbLabel = document.createElement('span');
      thumbLabel.textContent = img.name;
      thumb.appendChild(thumbImg);
      thumb.appendChild(thumbLabel);
      thumb.addEventListener('click', () => {
        banner.classList.add('hidden');
        resolve({ mode: 'image', imageSrc: filePath, fileName: img.name });
      });
      grid.appendChild(thumb);
    }

    // "Upload your own" card
    const uploadCard = document.createElement('div');
    uploadCard.className = 'gallery-thumb gallery-upload-btn';
    uploadCard.innerHTML = '<div class="upload-icon">+</div><span>Upload Image</span>';
    uploadCard.addEventListener('click', () => uploadInput.click());
    grid.appendChild(uploadCard);

    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'gallery-back-btn';
    backBtn.textContent = '\u2190 Back';
    backBtn.addEventListener('click', () => {
      gallery.classList.add('hidden');
      document.getElementById('mode-choices').classList.remove('hidden');
    });
    gallery.appendChild(backBtn);

    // Handle file upload
    uploadInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        banner.classList.add('hidden');
        resolve({ mode: 'image', imageSrc: ev.target.result, fileName: file.name });
      };
      reader.readAsDataURL(file);
    });
  },
};
