# Autocross Course Designer

A web-based tool for designing autocross courses with cone placement, driving lines, and measurement tools. Supports both live satellite imagery (via Mapbox) and static image backgrounds.

**[Try it live](https://jrow3.github.io/autocross-designer/)** (if deployed via GitHub Pages)

---

## Features

### Two Design Modes
- **Map Mode** -- Design on live satellite imagery with GPS coordinates, location search, and adjustable zoom (up to 22x)
- **Image Mode** -- Upload a photo or select from a gallery, then calibrate the scale manually

### Course Elements
- **Cones** -- Standard (orange), pointer (with directional arrows), start (green), and finish (checkered)
- **Gates** -- Place two-cone gates with a single click
- **Slaloms** -- Generate evenly-spaced cone series
- **Obstacles & Hazards** -- Mark trailers, light poles, curbs, drains, and other lot features
- **Worker Stations** -- Position numbered worker/flagger locations
- **Staging Grid** -- Drop a pre-built staging area

### Drawing & Measurement
- **Driving Line** -- Trace the intended racing path through the course
- **Distance Tool** -- Measure point-to-point distances in feet
- **Notes** -- Add text annotations anywhere on the map
- **10 ft Grid Overlay** -- Toggle a rotatable reference grid

### Editing
- **Multi-Select** -- Box-select groups of elements and drag them together
- **Undo / Redo** -- Full edit history (Ctrl+Z / Ctrl+Y)
- **Layer Visibility** -- Toggle cones, driving line, grid, notes, workers, and obstacles independently

### Save & Share
- **JSON Export / Import** -- Save courses as `.json` files and reload them later
- **URL Sharing** -- Generate a shareable link that encodes the full course state
- **Session Autosave** -- Course state is saved to the browser automatically every 5 actions
- **Venue Layouts** -- Save and reuse obstacle/hazard configurations across courses

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1` | Cone tool |
| `2` | Pointer cone |
| `3` | Start cone |
| `4` | Finish cone |
| `5` | Gate tool |
| `6` | Slalom tool |
| `7` | Driving line |
| `8` | Measure tool |
| `9` | Note tool |
| `Delete` | Delete selected element(s) |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` | Redo |
| `Ctrl+A` | Select all |
| `Escape` | Cancel / deselect |

---

## Tech Stack

- Vanilla JavaScript (no frameworks)
- [Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/) v3.3.0 for satellite imagery and map interaction
- HTML5 Canvas overlays for drawing elements
- CSS with a dark theme, responsive layout
- Browser localStorage for persistence

---

## Project Structure

```
autocross-designer/
├── index.html                 Main application shell
├── css/
│   └── style.css              Styling (dark theme, toolbar, dialogs)
├── js/
│   ├── app.js                 Core state, initialization, toolbar wiring
│   ├── map.js                 Mapbox setup, location search
│   ├── imageMap.js            Map adapter for image mode
│   ├── imageMode.js           Image gallery and mode banner
│   ├── cones.js               Cone placement, dragging, deletion
│   ├── arrows.js              Pointer cone arrow rendering
│   ├── selection.js           Multi-select and box selection
│   ├── measurements.js        Distance measurement tool
│   ├── drivingline.js         Driving line drawing
│   ├── notes.js               Text annotations
│   ├── obstacles.js           Obstacles and hazards
│   ├── workers.js             Worker station management
│   ├── grid.js                10 ft grid overlay with rotation
│   ├── layers.js              Layer visibility toggles
│   ├── distance.js            Distance calculation utilities
│   ├── geocache.js            Location search result caching
│   ├── history.js             Undo/redo stack
│   ├── sharing.js             URL-based course sharing
│   ├── storage.js             localStorage helpers
│   └── venue.js               Reusable venue layouts
├── assets/
│   └── courses/               Sample course images and gallery manifest
└── update-courses.sh          Script to regenerate the image gallery manifest
```

---

## Getting Started

1. Clone the repository:
   ```bash
   git clone https://github.com/jrow3/autocross-designer.git
   ```
2. Open `index.html` in a browser -- no build step required.
3. Choose **Draw on Live Map** or **Load Image** to begin designing.

> **Note:** Map Mode requires a Mapbox access token. The app ships with a token in `js/map.js`. To use your own, replace the `mapboxgl.accessToken` value with your token from [mapbox.com](https://account.mapbox.com/).

---

## License

MIT
