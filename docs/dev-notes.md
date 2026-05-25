# Developer Notes

Internal architecture notes and hard-won debugging findings.

---

## Image Mode vs Map Mode

### Modes

- **Map mode**: Uses Mapbox GL JS (`mapboxgl.Marker`). Satellite imagery, GPS coordinates.
- **Image mode**: Uses `ImageMap` + `ImageMarker` from `js/imageMap.js`. Static background image, pixel coordinates.
- `window.createMarker` is set to `mapboxgl.Marker` (map) or `ImageMarker` (image) at init time (`js/app.js`).

---

## ImageMarker DOM Structure (`js/imageMap.js`)

```
_markerContainer  (appended to map wrapper)
  └── _container  div, position:absolute
                  transform: translate(-50%,-50%) scale(0.5)   ← hardcoded counter-scale
        └── _element  div.cone-marker                          ← what marker.getElement() returns
                      transform: scale(var(--marker-scale,1))  ← --marker-scale is NEVER set in image mode
```

Key points:
- `marker.getElement()` returns `_element` (the inner `.cone-marker`), **not** `_container`.
- `--marker-scale` is set only in map mode via `updateMarkerScale()`. In image mode it stays at its CSS default of `1`.
- The `scale(0.5)` on `_container` is hardcoded (`const scale = 2` in `_updatePosition()`).

---

## Visual Scale Formula (image mode)

The map wrapper is scaled by `this._scale` (set in `_applyTransform()`):

```
wrapper transform = translate(offsetX, offsetY) scale(this._scale)
where this._scale = 2^(zoom - 17)
```

The marker container counter-scales by `0.5`:

```
_container transform = translate(-50%,-50%) scale(0.5)
```

Therefore the **true visual scale of any marker element** is:

```
visual_scale = 2^(zoom - 17) × 0.5 = 2^(zoom - 18)
```

This means a CSS element that is `8px` wide will render at `8 × 2^(zoom-18)` screen pixels.

### Why naive formulas fail

A formula like `8.5 * 2^((zoom-17)/2)` only equals `8.5 * 2^(zoom-18)` when `(zoom-17)/2 = zoom-18`, i.e. zoom = 19. This is why placements looked correct near zoom 19 but drifted at other zoom levels.

---

## Coordinate System (`ImageMap`)

| Method | Formula |
|---|---|
| `getZoom()` | `Math.log2(this._scale) + 17` |
| `project({lng,lat})` | `{ x: lng * scale + offsetX, y: lat * scale + offsetY }` |
| `unproject({x,y})` | `{ lng: (x - offsetX) / scale, lat: (y - offsetY) / scale }` |

Coordinates in image mode are pixel offsets from the image origin, stored as `[lng, lat]` = `[x, y]`.

---

## Mode-Agnostic Snap / Size Measurement

To measure the **actual rendered screen size** of a marker element regardless of mode, use `getBoundingClientRect()`. It accounts for all CSS and DOM transforms automatically:

```js
const el = cone.marker.getElement();
const rect = el.getBoundingClientRect();
// rect.width is the rendered screen width in CSS pixels
```

### Example: pointer cone snap

```js
// Regular cone CSS diameter = 8px. Pointer tip offset = 4.5px above center.
// snap = cone_radius + tip_offset = (4 + 4.5) = 8.5px at CSS scale 1.
// At any zoom: multiply rendered diameter by 8.5/8.
const regEl = regCone.marker.getElement();
const regRect = regEl.getBoundingClientRect();
const snapPx = regRect.width > 0 ? regRect.width * (8.5 / 8) : 8.5;
```

This works in both image mode (where `regRect.width = 8 × 2^(zoom-18)`) and map mode (where `regRect.width ≈ 8`).

---

## Relevant CSS Dimensions (`css/style.css`)

| Selector | Dimensions | Notes |
|---|---|---|
| `.cone-marker` | — | `transform: scale(var(--marker-scale,1)); position: relative` |
| `.marker-regular` | `8×8px`, `border-radius:50%` | Circle, radius = 4px |
| `.marker-pointer` | CSS triangle: `border-left:5px; border-right:5px; border-bottom:9px` | 10×9px visual; apex (tip) at top-center = 4.5px above center |
