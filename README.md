# Kokuban

A small whiteboard for mouse, stylus, and touchscreen input. Plain HTML, CSS, and JavaScript; no dependencies, build step, account, or backend.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. Use HTTP rather than opening `index.html` directly: the app uses JavaScript modules and browser storage.

## Controls

- **Pencil / eraser:** choose a tool on the left and draw with the left mouse button. Choose small, medium, or large on the right. Below the sizes, choose white/black or one of the pencil colors. On short screens the palette becomes a dropdown showing the selected color. Choosing a color keeps the current tool active. Pencil and eraser share the pencil color; text remembers its own color. Both selections last until reload and are preserved when creating or opening another board.
- **Text:** choose the text tool and click the board to type. Click existing text to edit; the palette shows its color. Choose a color to recolor the whole selected block and set the color for new text. With no block selected, only the new-text color changes. Each block’s color is saved with the board. Enter adds a line; Escape finishes editing. Drag the selected block's handle to move it; select the handle or press Escape, then Delete to remove it.
- **Zoom:** scroll at the point you want to zoom toward, from whole-board fit to 800%.
- **Pan:** drag with the right mouse button. A small part of the board always remains visible.
- **New board:** the first button on the left saves pending edits, creates a saved blank board, and opens it. Previous boards remain available.
- **Open board:** the second button opens the saved-board library. Select a thumbnail, then choose **Load** to edit it or **Remove** to delete it immediately. **Close** or Escape dismisses the dialog; removals already made remain applied. Arrow keys, Home, and End change selection. Closing returns keyboard focus to the Open board button.

There is no application undo/redo; normal text-editor shortcuts still work while typing.

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

Drawing is a transparent bitmap with white or colored strokes and antialiased alpha edges. Dark mode displays the original colors on black; light mode applies `filter: invert(1) hue-rotate(180deg)` to the canvas and displays it on white. Text editors and palette swatches use the same filter to match the drawing; text handles and selection outlines keep their normal UI colors. Older saved text defaults to white in dark mode and black in light mode. Erasing removes opacity. Saved pixels never change with the system theme. Zooming in can reveal pixels.

The browser autosaves a transparent PNG and separate editable text blocks in IndexedDB. The status at the top reports saving, saved, or errors. Wait for **Saved locally** before closing the app. Boards are kept separately for each browser profile and app path; another browser or device has a separate library. Reloading resumes the last open board. Browser data clearing removes all saved boards. Multiple tabs are not synchronized; the last save to a board wins, but saving from another tab cannot recreate a removed board.

The library shows full-board thumbnails, including text, sorted by creation time with the newest first. Timestamps use your browser's local timezone in `yyyy-mm-dd hh:mm:ss` format. Editing does not change a board's creation time. Existing single-board data migrates automatically; its timestamp is the migration time because older records did not store creation times.

Removing the current board opens the newest remaining board. Removing the final board creates a saved blank replacement. New or loaded boards open at the initial pan/zoom position; tool, size, and color choices stay selected. Removing an inactive board does not change the board being edited.

Switching boards waits for pending edits to save. If saving fails, the current board stays open with its edits intact; free browser storage if needed, then retry. If a saved board cannot be read, the app preserves it and reports an error. Reload to retry, or use New board or Open board to work with another board. Failed deletion leaves the saved board intact. Storage must be available to create or open boards.

## GitHub Pages and installation

1. Push these files to a GitHub repository.
2. In **Settings → Pages**, select **Deploy from a branch**, your branch, and **/(root)**.
3. Open the published HTTPS URL. All assets, the manifest, and its scope use relative paths, including for project sites such as `/kokuban/`.

In desktop Chrome, use **Install app** when available or Chrome's own installation menu. The manifest includes standalone mode and local 192 px / 512 px icons. Chrome controls when installation is offered. No service worker is registered, so offline loading is not guaranteed. Installation is optional; the website works normally without it.

## Code map

- `js/app.js`: application setup, tool state, input routing, and installation.
- `js/colors.js`: pencil/text palette, adaptive dropdown, and keyboard navigation.
- `js/drawing.js`: temporary active-stroke smoothing, bitmap drawing/erasing, and PNG handling.
- `js/viewport.js`: board/screen coordinates, pointer-anchored zoom, and panning bounds.
- `js/touch.js`: finger tracking, tap recognition, and transitions between drawing and two-finger navigation.
- `js/text.js`: editable text, wrapping, selection, sizing, and movement.
- `js/storage.js`: versioned IndexedDB records, legacy migration, atomic library updates, and serialized autosave.
- `js/boards.js`: board creation, switching, deletion, and save coordination.
- `js/board-picker.js`: accessible library dialog, timestamps, and drawing/text thumbnails.
- `js/config.js`: board dimensions and tool presets.

Only the committed bitmap and text are persisted. Stroke samples exist only during the active gesture; provisional drawing and text movement are excluded from autosave until completed. There is no drawing history, server, external font, or analytics.

## Verification

With the static server running, open `/tests/` (or `/kokuban/tests/` on a project site). The dependency-free browser checks exercise coordinates, zoom anchoring, panning limits, white/colored/transparent pixels, antialiasing, erasing, color-preserving PNG restoration, adaptive palette behavior, text colors and legacy record compatibility, text layout, IndexedDB migration, path isolation, board switching/deletion, library previews and selection, and save ordering/errors. Touch checks also cover pinch math, cancellation, third-finger transitions, tap recognition, and excluding provisional edits from saves. They use a temporary database and never modify your board.

Manual acceptance checks:

- Draw dots, fast curves, and strokes that leave the board; verify endpoints and clipping at all sizes.
- Erase across text and confirm text remains. Zoom and resize without losing drawing.
- Switch the system theme and inspect stroke edges for halos; check that every swatch matches its strokes.
- Resize between tall and short viewports, including with the color dropdown open. Check its three-column layout, keyboard navigation, selection, Escape, outside dismissal, and placement above the on-screen keyboard. Choosing colors must preserve the tool, text contents, caret, and active text editor. Verify separate pencil/text colors, selected-block recoloring, new-text defaults, and restored colors after reload.
- Edit multiline text, move it near board edges, resize it, and check Delete inside and outside editing.
- Create several boards containing drawing and multiline colored text, switch between them, then reload; confirm the last open board and editable contents return.
- Open the library and verify thumbnail wrapping/colors, creation timestamps, newest-first ordering, keyboard selection, and Close/Escape focus return. Repeat in light/dark themes and on phone/short-screen layouts.
- Remove an inactive board, the current board, and the final board; confirm only the selected board is deleted and the expected replacement opens. Close the dialog and confirm deletions persist.
- Simulate storage errors and delayed saves; confirm switching cannot discard unsaved edits or mix contents between boards.
- Verify a GitHub Pages project path and Chrome installation/standalone launch.
- On a phone/tablet, draw and erase with one finger, add a second finger mid-stroke, then pan/pinch. Confirm no stray marks remain and a remaining finger cannot resume drawing until all fingers lift.
- Tap text, use Done/Delete, and drag its handle at different zoom levels. Verify the native keyboard, caret selection, orientation changes, and controls above the keyboard on Android Chrome and iOS Safari.

Import/export, collaboration, manual theme controls, and offline caching are intentionally deferred.
