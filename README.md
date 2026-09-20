# Kokuban

A small whiteboard for mouse, stylus, and touchscreen input. Plain HTML, CSS, and JavaScript; no dependencies, build step, account, or backend.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Use HTTP rather than opening `index.html` directly: the app uses JavaScript modules and browser storage.

## Controls

- **Pencil / eraser:** choose a tool on the left and draw with the left mouse button. Choose small, medium, or large on the right.
- **Text:** choose the text tool and click the board to type. Click existing text to edit. Enter adds a line; Escape finishes editing. Drag the selected block's handle to move it; select the handle or press Escape, then Delete to remove it.
- **Zoom:** scroll at the point you want to zoom toward, from whole-board fit to 800%.
- **Pan:** drag with the right mouse button. A small part of the board always remains visible.
- **Clear board:** removes drawing and text after confirmation. There is no application undo/redo; normal text-editor shortcuts still work while typing.

On a touchscreen:

- **One finger:** draw or erase with the selected tool.
- **Two fingers:** drag to pan and pinch to zoom around the fingers' midpoint, with any tool selected. Adding a second finger cancels the provisional stroke or text movement so navigation leaves no accidental marks. Lift all fingers before drawing again.
- **Text:** tap to create or edit; swipe and pinch do not create text. Drag the selected block's handle to move it. Use **Done** to finish editing or **Delete text** to remove it.
- Tool buttons and touch drag handles remain finger-sized. Text controls sit at the top center (below the header on narrow screens), follow the visible viewport when the keyboard opens, and the board pans to keep the editor clear of the controls.

Mouse controls remain available on devices with both mouse and touch input. Stylus drawing uses the selected fixed width; pressure sensitivity and device-specific palm rejection are not implemented.

The board is 2048 × 2048 pixels. The initial view shows its centered quarter. Tool sizes are board pixels:

| Tool | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Pencil diameter | 2 | 6 | 12 |
| Eraser diameter | 16 | 32 | 64 |
| Text font size | 24 | 48 | 72 |

## Saving and themes

Drawing is a transparent bitmap with white strokes and antialiased alpha edges. Dark mode displays it on black; light mode inverts only the canvas and displays it on white. Erasing removes opacity. Saved pixels never change with the system theme. Zooming in can reveal pixels.

The browser autosaves a transparent PNG and separate editable text blocks in IndexedDB. The status at the top reports saving, saved, or errors. Wait for **Saved locally** before closing the app. There is one board per browser profile and app path; another browser or device has a separate board. Browser data clearing removes the saved board. Multiple tabs are not synchronized; the last save wins.

If a saved board cannot be read, the app keeps it intact and reports an error. Reload to retry. **Clear board** explicitly replaces that saved board. The app remains usable if storage is unavailable, but changes cannot be retained until saving succeeds.

## GitHub Pages and installation

1. Push these files to a GitHub repository.
2. In **Settings → Pages**, select **Deploy from a branch**, your branch, and **/(root)**.
3. Open the published HTTPS URL. All assets, the manifest, and its scope use relative paths, including for project sites such as `/kokuban/`.

In desktop Chrome, use **Install app** when available or Chrome's own installation menu. The manifest includes standalone mode and local 192 px / 512 px icons. Chrome controls when installation is offered. No service worker is registered, so offline loading is not guaranteed. Installation is optional; the website works normally without it.

## Code map

- `js/app.js`: application setup, tool state, input routing, and installation.
- `js/drawing.js`: temporary active-stroke smoothing, bitmap drawing/erasing, and PNG handling.
- `js/viewport.js`: board/screen coordinates, pointer-anchored zoom, and panning bounds.
- `js/touch.js`: finger tracking, tap recognition, and transitions between drawing and two-finger navigation.
- `js/text.js`: editable text, wrapping, selection, sizing, and movement.
- `js/storage.js`: versioned IndexedDB records and serialized autosave.
- `js/config.js`: board dimensions and tool presets.

Only the committed bitmap and text are persisted. Stroke samples exist only during the active gesture; provisional drawing and text movement are excluded from autosave until completed. There is no drawing history, server, external font, or analytics.

## Verification

With the static server running, open `/tests/` (or `/kokuban/tests/` on a project site). The dependency-free browser checks exercise coordinates, zoom anchoring, panning limits, white/transparent pixels, antialiasing, erasing, PNG restoration, text layout, IndexedDB, and save ordering/errors. Touch checks also cover pinch math, cancellation, third-finger transitions, tap recognition, and excluding provisional edits from saves. They use a temporary database and never modify your board.

Manual acceptance checks:

- Draw dots, fast curves, and strokes that leave the board; verify endpoints and clipping at all sizes.
- Erase across text and confirm text remains. Zoom and resize without losing drawing.
- Switch the system theme and inspect stroke edges for halos.
- Edit multiline text, move it near board edges, resize it, and check Delete inside and outside editing.
- Reload after saving; confirm both drawing and text return. Cancel and accept Clear board.
- Verify a GitHub Pages project path and Chrome installation/standalone launch.
- On a phone/tablet, draw and erase with one finger, add a second finger mid-stroke, then pan/pinch. Confirm no stray marks remain and a remaining finger cannot resume drawing until all fingers lift.
- Tap text, use Done/Delete, and drag its handle at different zoom levels. Verify the native keyboard, caret selection, orientation changes, and controls above the keyboard on Android Chrome and iOS Safari.

Import/export, collaboration, manual theme controls, and offline caching are intentionally deferred.
