import { BOARD_SIZE, SIZES, COLORS } from '../js/config.js';
import { toBoard, zoomAt, constrain, touchPair, pinchCamera } from '../js/viewport.js';
import { Drawing, paintStroke, toPNG } from '../js/drawing.js';
import { TextLayer } from '../js/text.js';
import { Autosave, openDatabase, readBoard, writeBoard, validateRecord, createBoard, listBoards, readActiveBoard, rememberBoard, removeBoard } from '../js/storage.js';
import { TouchInput } from '../js/touch.js';
import { ColorPicker } from '../js/colors.js';
import { BoardSession, blankBoard } from '../js/boards.js';
import { BoardPicker, formatCreatedAt } from '../js/board-picker.js';

const results = [];
const assert = (condition, message = 'Assertion failed') => { if (!condition) throw new Error(message); };
const near = (a, b) => assert(Math.abs(a - b) < .00001, `${a} ≠ ${b}`);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function canvas() {
  const result = document.createElement('canvas');
  result.width = result.height = BOARD_SIZE;
  return result;
}
const pixel = (surface, x, y) => [...surface.getContext('2d').getImageData(x, y, 1, 1).data];
async function test(name, run) {
  const item = document.createElement('li');
  try {
    await run();
    item.textContent = `PASS — ${name}`;
    item.className = 'pass';
    results.push({ name, passed: true });
  } catch (error) {
    item.textContent = `FAIL — ${name}: ${error.message}`;
    item.className = 'fail';
    results.push({ name, passed: false, error: error.stack });
  }
  document.querySelector('#results').append(item);
}

await test('Coordinates and zoom preserve the point under the pointer', () => {
  const camera = { x: -314, y: 48, scale: .75 };
  const pointer = { x: 423, y: 217 };
  const before = toBoard(pointer, camera);
  for (const scale of [.25, 1, 3, 8]) {
    const after = toBoard(pointer, zoomAt(camera, pointer, scale));
    near(before.x, after.x); near(before.y, after.y);
  }
});

await test('Panning keeps 64 screen pixels visible on each axis', () => {
  const camera = constrain({ x: -10000, y: 10000, scale: .5 }, 1200, 800);
  near(camera.x + BOARD_SIZE * camera.scale, 64);
  near(800 - camera.y, 64);
});

await test('Drawing stores white interiors, transparent empty pixels, and alpha edges', () => {
  const surface = canvas();
  paintStroke(surface.getContext('2d'), [{ x: 100, y: 100 }], 12);
  assert(pixel(surface, 100, 100).join() === '255,255,255,255');
  assert(pixel(surface, 0, 0).join() === '0,0,0,0');
  const data = surface.getContext('2d').getImageData(93, 93, 14, 14).data;
  let edgeFound = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && data[i + 3] < 255) {
      edgeFound = true;
      assert(data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255, 'Edge must be white, not gray');
    }
  }
  assert(edgeFound, 'Expected antialiased pixels');
});

await test('Curves include their endpoints and erasing removes alpha', () => {
  const surface = canvas();
  const context = surface.getContext('2d');
  paintStroke(context, [{ x: 20, y: 20 }, { x: 80, y: 80 }, { x: 120, y: 20 }], 12);
  assert(pixel(surface, 20, 20)[3] === 255);
  assert(pixel(surface, 120, 20)[3] === 255);
  paintStroke(context, [{ x: 20, y: 20 }], 32, true);
  assert(pixel(surface, 20, 20).join() === '0,0,0,0');
  assert(pixel(surface, 120, 20)[3] === 255);
});

await test('Active stroke is flattened and releases its samples on completion', () => {
  const surface = canvas();
  const drawing = new Drawing(surface);
  drawing.begin({ x: 10, y: 10 }, 6, false);
  drawing.move({ x: 100, y: 40 });
  drawing.finish();
  assert(drawing.stroke === null);
  assert(pixel(surface, 100, 40)[3] === 255);
  drawing.clear();
  assert(pixel(surface, 100, 40)[3] === 0);
});

await test('PNG remains white-on-transparent regardless of the display filter', async () => {
  const surface = canvas();
  surface.style.filter = 'invert(1) hue-rotate(180deg)';
  paintStroke(surface.getContext('2d'), [{ x: 50, y: 50 }], 12);
  const copy = canvas();
  await new Drawing(copy).restore(await toPNG(surface));
  assert(pixel(copy, 50, 50).join() === '255,255,255,255');
  assert(pixel(copy, 0, 0).join() === '0,0,0,0');
});

await test('Every pencil color fills dots and curves, survives PNG, and erases to transparency', async () => {
  const surface = canvas();
  const context = surface.getContext('2d');
  // Use the browser's own solid fill as reference for OKLCH gamut mapping.
  const reference = canvas();
  const referenceContext = reference.getContext('2d');
  const expected = COLORS.map(({ value }, index) => {
    assert(CSS.supports('color', value), `Unsupported color: ${value}`);
    referenceContext.fillStyle = value;
    referenceContext.fillRect(index, 0, 1, 1);
    return pixel(reference, index, 0).join();
  });
  COLORS.forEach(({ value }, index) => {
    const y = 30 + index * 30;
    paintStroke(context, [{ x: 30, y }], 12, false, value);
    paintStroke(context, [{ x: 80, y }, { x: 120, y: y + 10 }, { x: 160, y }], 12, false, value);
    assert(pixel(surface, 30, y).join() === expected[index], 'Dot color differs');
    assert(pixel(surface, 160, y).join() === expected[index], 'Curve color differs');
  });
  surface.style.filter = 'invert(1) hue-rotate(180deg)';
  const copy = canvas();
  await new Drawing(copy).restore(await toPNG(surface));
  COLORS.forEach((color, index) => {
    const y = 30 + index * 30;
    assert(pixel(copy, 30, y).join() === expected[index], 'PNG changed color');
    paintStroke(context, [{ x: 30, y }], 20, true, COLORS.at(-1).value);
    assert(pixel(surface, 30, y).join() === '0,0,0,0', 'Color prevented erasing');
  });
  assert(pixel(copy, 0, 0).join() === '0,0,0,0');
});

await test('Stroke color remains fixed through rendering, snapshots, and cancellation', async () => {
  const surface = canvas();
  const drawing = new Drawing(surface);
  drawing.begin({ x: 50, y: 50 }, 12, false, COLORS[1].value);
  const red = pixel(surface, 50, 50).join();
  drawing.move({ x: 100, y: 50 });
  drawing.finish();
  assert(pixel(surface, 100, 50).join() === red);
  drawing.begin({ x: 150, y: 50 }, 12, false, COLORS[4].value);
  const restored = canvas();
  await new Drawing(restored).restore(await drawing.snapshot());
  assert(pixel(restored, 100, 50).join() === red);
  assert(pixel(restored, 150, 50)[3] === 0);
  drawing.cancel();
  assert(pixel(surface, 100, 50).join() === red && pixel(surface, 150, 50)[3] === 0);
  drawing.begin({ x: 100, y: 50 }, 20, true, COLORS.at(-1).value);
  drawing.cancel();
  assert(pixel(surface, 100, 50).join() === red);
});

await test('Color dropdown retains selection, navigates by keyboard, and dismisses accessibly', () => {
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar sizes';
  toolbar.innerHTML = '<button aria-controls="test-colors" aria-expanded="false"><span class="color-swatch"></span></button><div id="test-colors" class="color-palette"></div>';
  document.body.append(toolbar);
  const toggle = toolbar.querySelector('button');
  const panel = toolbar.querySelector('.color-palette');
  const selections = [];
  const picker = new ColorPicker(toolbar, toggle, panel, color => selections.push(color));
  const key = (target, value) => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  try {
    assert(picker.value === '#fff');
    picker.setColor(COLORS[4].value, 'text');
    assert(picker.value === COLORS[4].value && selections.length === 0);
    assert(panel.getAttribute('aria-label') === 'Text color');
    assert(picker.buttons[4].getAttribute('aria-label') === `${COLORS[4].name} text color`);
    assert(toggle.getAttribute('aria-label') === `Text color: ${COLORS[4].name}`);
    picker.buttons[2].click();
    assert(selections.join() === COLORS[2].value);
    picker.setColor(COLORS[2].value, 'pencil');
    assert(panel.getAttribute('aria-label') === 'Pencil color' && selections.length === 1);
    assert(picker.value === COLORS[2].value);
    assert(panel.querySelectorAll('[aria-pressed="true"]').length === 1);
    // Force insufficient room regardless of the test runner's viewport size.
    toolbar.style.minHeight = '100vh';
    picker.updateLayout();
    assert(picker.compact && panel.hidden && !toggle.hidden);
    for (let i = 0; i < 3; i++) picker.updateLayout();
    assert(picker.compact, 'Collapsed height must not change the breakpoint');
    toggle.focus();
    key(toggle, 'ArrowDown');
    assert(!panel.hidden && toggle.getAttribute('aria-expanded') === 'true');
    assert(document.activeElement === picker.buttons[2]);
    key(panel, 'ArrowDown');
    assert(document.activeElement === picker.buttons[5]);
    picker.buttons[5].click();
    assert(picker.value === COLORS[5].value && panel.hidden && document.activeElement === toggle);
    picker.show(true);
    key(panel, 'Escape');
    assert(panel.hidden && document.activeElement === toggle);
    picker.show();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    assert(panel.hidden && toggle.getAttribute('aria-expanded') === 'false');
    // A minimal expanded toolbar fits even in small test viewports.
    toolbar.style.minHeight = '';
    picker.buttons.forEach(button => button.style.height = '1px');
    panel.style.gap = '0px';
    picker.show(true);
    picker.updateLayout();
    assert(!picker.compact && !panel.hidden && toggle.hidden);
    assert(picker.value === COLORS[5].value && document.activeElement === picker.buttons[5]);
  } finally { picker.destroy(); toolbar.remove(); }
});

await test('Text wraps at the edge, remains editable, resizes, and discards empty blocks', () => {
  const fixture = document.querySelector('#fixture');
  const layer = new TextLayer(fixture, { element: fixture }, () => {}, () => {});
  layer.create({ x: 1950, y: 100 }, 48);
  const block = layer.blocks.get(layer.selected);
  block.editor.value = 'Long text that wraps\nSecond line';
  block.editor.dispatchEvent(new Event('input'));
  assert(block.element.offsetWidth <= BOARD_SIZE - block.data.x + 1);
  assert(block.editor.offsetHeight > 64);
  layer.resize(SIZES.text[0]);
  assert(block.data.size === 24);
  layer.commit();
  assert(block.editor.readOnly);
  assert(layer.serialize()[0].text.includes('\n'));
  layer.removeSelected();
  layer.create({ x: 0, y: 0 }, 24);
  layer.commit();
  assert(layer.blocks.size === 0);
  layer.clear();
});

await test('Text colors preserve editing and only actual recoloring schedules a change', () => {
  const fixture = document.querySelector('#fixture');
  let changes = 0;
  const selections = [];
  const layer = new TextLayer(fixture, { element: fixture }, () => changes++, (size, color) => selections.push({ size, color }));
  try {
    layer.restore([{ id: 'legacy', x: 40, y: 50, size: 48, text: 'Existing text' }]);
    assert(layer.serialize()[0].color === '#fff');
    layer.edit('legacy');
    const block = layer.blocks.get('legacy');
    block.editor.setSelectionRange(2, 7, 'backward');
    assert(changes === 0 && selections.at(-1).color === '#fff');
    layer.recolor(COLORS[1].value);
    assert(changes === 1 && block.data.color === COLORS[1].value);
    assert(document.activeElement === block.editor && !block.editor.readOnly);
    assert(block.editor.selectionStart === 2 && block.editor.selectionEnd === 7 && block.editor.selectionDirection === 'backward');
    assert(block.editor.value === 'Existing text');
    layer.recolor(COLORS[1].value);
    layer.commit();
    layer.select('legacy');
    assert(changes === 1, 'Same color, commit, and selection must not trigger redundant saves');
    assert(selections.at(-1).color === COLORS[1].value && selections.at(-1).size === 1);
    layer.deselect();
    layer.recolor(COLORS[2].value);
    assert(changes === 1, 'No selected text must not change the board');
    layer.create({ x: 50, y: 150 }, 24, COLORS[3].value);
    const fresh = layer.blocks.get(layer.selected);
    assert(fresh.data.color === COLORS[3].value && selections.at(-1).color === COLORS[3].value);
    layer.recolor(COLORS[4].value);
    assert(fresh.editor === document.activeElement && !fresh.editor.readOnly && fresh.data.text === '');
    fresh.editor.value = 'New text';
    fresh.editor.dispatchEvent(new Event('input'));
    const records = layer.serialize();
    layer.clear();
    layer.restore(records);
    assert(layer.blocks.get('legacy').data.color === COLORS[1].value);
    assert(layer.blocks.get(fresh.data.id).data.color === COLORS[4].value);
    assert(layer.blocks.get(fresh.data.id).editor.style.color !== '');
  } finally { layer.clear(); }
});

await test('Text color changes survive provisional drag cancellation and snapshots', () => {
  const fixture = document.querySelector('#fixture');
  const layer = new TextLayer(fixture, { element: fixture, boardPoint: event => ({ x: event.clientX, y: event.clientY }) }, () => {}, () => {});
  try {
    layer.restore([{ id: 'color-drag', x: 50, y: 50, size: 24, color: COLORS[1].value, text: 'Move me' }]);
    layer.startDrag('color-drag', { pointerId: 1, clientX: 50, clientY: 50 });
    layer.moveDrag({ clientX: 100, clientY: 100 });
    layer.recolor(COLORS[5].value);
    const record = layer.serialize()[0];
    assert(record.x === 50 && record.y === 50 && record.color === COLORS[5].value);
    layer.endDrag(true);
    assert(layer.blocks.get('color-drag').data.x === 50 && layer.blocks.get('color-drag').data.color === COLORS[5].value);
  } finally { layer.clear(); }
});

await test('Saved text accepts legacy and palette colors and rejects invalid colors', () => {
  const text = { id: 'validation', x: 0, y: 0, size: 24, text: 'Color' };
  const record = { version: 1, bitmap: new Blob(), texts: [text] };
  assert(validateRecord(record) === record);
  for (const { value } of COLORS) {
    text.color = value;
    assert(validateRecord(record) === record);
  }
  for (const color of [null, 0, {}, '', 'red', '#000', 'oklch(80% 70% 10)']) {
    text.color = color;
    let rejected = false;
    try { validateRecord(record); } catch { rejected = true; }
    assert(rejected, `Invalid color accepted: ${JSON.stringify(color)}`);
  }
});

await test('IndexedDB round-trips independent boards, immutable creation times, and path isolation', async () => {
  const name = `kokuban-test-${crypto.randomUUID()}`;
  const database = await openDatabase(name);
  try {
    const surface = canvas();
    paintStroke(surface.getContext('2d'), [{ x: 25, y: 25 }], 6);
    const record = { id: 'first', createdAt: 10, version: 1, bitmap: await toPNG(surface), texts: [{ id: 'test', x: 40, y: 80, size: 48, text: 'Hello\n世界' }] };
    await createBoard(database, '/test/', record);
    const restored = await readBoard(database, '/test/', record.id);
    assert(restored.texts[0].text === 'Hello\n世界');
    record.texts[0].color = COLORS[5].value;
    await writeBoard(database, '/test/', record.id, { ...record, createdAt: 99 });
    const colored = await readBoard(database, '/test/', record.id);
    assert(colored.texts[0].color === COLORS[5].value);
    assert(colored.createdAt === 10, 'Editing must preserve creation time');
    const copy = canvas();
    await new Drawing(copy).restore(restored.bitmap);
    assert(pixel(copy, 25, 25)[3] === 255);
    await createBoard(database, '/test/', { ...record, id: 'second', createdAt: 20 });
    await createBoard(database, '/different-path/', { ...record, createdAt: 30 });
    assert((await listBoards(database, '/test/')).map(record => record.id).join() === 'second,first');
    assert(await readBoard(database, '/different-path/', 'second') === null);
    await rememberBoard(database, '/test/', 'first');
    assert(await readActiveBoard(database, '/test/') === 'first');
    assert(await readActiveBoard(database, '/different-path/') === 'first');
  } finally {
    database.close();
    indexedDB.deleteDatabase(name);
  }
});

await test('Version 1 migration is lossless, path-scoped, and runs once', async () => {
  const name = `kokuban-test-${crypto.randomUUID()}`;
  const record = await blankBoard();
  delete record.id;
  delete record.createdAt;
  record.texts = [{ id: 'legacy', x: 40, y: 80, size: 48, text: 'Legacy', color: COLORS[2].value }];
  const surface = canvas();
  paintStroke(surface.getContext('2d'), [{ x: 20, y: 20 }], 8, false, COLORS[3].value);
  record.bitmap = await toPNG(surface);
  const before = Date.now();
  await new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('boards');
      store.put(record, '/one/');
      store.put(record, '/two/');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { request.result.close(); resolve(); };
  });
  let database = await openDatabase(name);
  try {
    const [migrated] = await listBoards(database, '/one/');
    assert(migrated.createdAt >= before && migrated.createdAt <= Date.now());
    assert(JSON.stringify(migrated.texts) === JSON.stringify(record.texts));
    assert(await migrated.bitmap.text() === await record.bitmap.text());
    assert(await readActiveBoard(database, '/one/') === migrated.id);
    assert((await listBoards(database, '/two/'))[0].id !== migrated.id);
    const legacyCount = await new Promise(resolve => {
      const request = database.transaction('boards').objectStore('boards').count();
      request.onsuccess = () => resolve(request.result);
    });
    assert(legacyCount === 0);
    database.close();
    database = await openDatabase(name);
    const again = await listBoards(database, '/one/');
    assert(again.length === 1 && again[0].id === migrated.id && again[0].createdAt === migrated.createdAt);
  } finally {
    database.close();
    indexedDB.deleteDatabase(name);
  }
});

await test('Board switching drains delayed saves and reload resumes the last open board', async () => {
  const name = `kokuban-test-${crypto.randomUUID()}`;
  const database = await openDatabase(name);
  let value = '';
  const bitmap = (await blankBoard()).bitmap;
  const session = new BoardSession('/session/', {
    snapshot: async () => {
      const texts = [{ id: 'text', x: 40, y: 80, size: 48, text: value }];
      await pause(15);
      return { version: 1, bitmap, texts };
    },
    prepare: async record => record,
    apply: record => { value = record.texts[0]?.text || ''; },
    status: () => {},
  }, database);
  try {
    await session.start();
    const first = session.active.id;
    value = 'First board';
    session.saver.schedule(1000);
    const saving = session.saver.flush();
    value = 'Latest first board';
    session.saver.schedule(1000);
    await session.create();
    await saving;
    const second = session.active.id;
    assert(first !== second && value === '');
    assert((await readBoard(database, '/session/', first)).texts[0].text === 'Latest first board');
    value = 'Second board';
    session.saver.schedule(1000);
    await session.load(first);
    assert(value === 'Latest first board');
    assert((await readBoard(database, '/session/', second)).texts[0].text === 'Second board');
    await session.start();
    assert(session.active.id === first, 'Reload must resume the older, last open board');
    await session.remove(first);
    assert(session.active.id === second && value === 'Second board');
    assert(await readActiveBoard(database, '/session/') === second);
    await session.remove(second);
    assert(session.active.id !== second && value === '');
    assert((await session.list()).length === 1, 'Deleting the final board must save a blank replacement');
    await session.create();
    const active = session.active.id;
    const inactive = (await session.list()).find(record => record.id !== active);
    await session.remove(inactive.id);
    assert(session.active.id === active, 'Removing an inactive board must not switch');
  } finally {
    clearTimeout(session.saver.timer);
    database.close();
    indexedDB.deleteDatabase(name);
  }
});

await test('Failed saves and invalid destinations preserve the current board and can retry', async () => {
  const name = `kokuban-test-${crypto.randomUUID()}`;
  const database = await openDatabase(name);
  let fail = false;
  const record = await blankBoard();
  const session = new BoardSession('/fail/', {
    snapshot: async () => { if (fail) throw new Error('Quota exceeded'); return record; },
    prepare: async record => { await new Drawing(canvas()).restore(record.bitmap); },
    apply: () => {}, status: () => {},
  }, database);
  try {
    await session.start();
    const first = session.active.id;
    fail = true;
    session.saver.schedule(1000);
    let rejected = false;
    try { await session.create(); } catch { rejected = true; }
    assert(rejected && session.active.id === first && session.saver.pending);
    assert((await session.list()).length === 1);
    fail = false;
    await session.create();
    assert(session.active.id !== first && !session.saver.pending);
    const current = session.active.id;
    await createBoard(database, '/fail/', { ...record, id: 'corrupt', bitmap: new Blob(['not an image']) });
    rejected = false;
    try { await session.load('corrupt'); } catch { rejected = true; }
    assert(rejected && session.active.id === current);
    await session.remove('corrupt');
    assert(session.active.id === current);
  } finally {
    clearTimeout(session.saver.timer);
    database.close();
    indexedDB.deleteDatabase(name);
  }
});

await test('Removed boards cannot be recreated by delayed writes and deletion is atomic', async () => {
  const name = `kokuban-test-${crypto.randomUUID()}`;
  const database = await openDatabase(name);
  try {
    const first = await blankBoard();
    const second = await blankBoard();
    await createBoard(database, '/delete/', first);
    await createBoard(database, '/delete/', second);
    await rememberBoard(database, '/delete/', first.id);
    let rejected = false;
    try { await removeBoard(database, '/delete/', first.id, second.id, second); } catch { rejected = true; }
    assert(rejected, 'Duplicate replacement must abort the entire deletion');
    assert(await readBoard(database, '/delete/', first.id));
    assert(await readActiveBoard(database, '/delete/') === first.id);
    await removeBoard(database, '/delete/', first.id, second.id);
    rejected = false;
    try { await writeBoard(database, '/delete/', first.id, first); } catch { rejected = true; }
    assert(rejected && await readBoard(database, '/delete/', first.id) === null);
    assert(await readActiveBoard(database, '/delete/') === second.id);
  } finally {
    database.close();
    indexedDB.deleteDatabase(name);
  }
});

await test('Board picker sorts, selects, previews wrapped text, reports errors, and closes without loading', async () => {
  const markup = new DOMParser().parseFromString(await (await fetch('../index.html')).text(), 'text/html');
  const dialog = markup.querySelector('#board-picker');
  const opener = document.createElement('button');
  opener.textContent = 'Open board';
  document.body.append(opener, dialog);
  let loaded = null;
  let removed = null;
  const first = await blankBoard();
  first.createdAt = new Date(2026, 8, 28, 1, 2, 3).getTime();
  first.texts = [{ id: 'preview', x: 1950, y: 20, size: 48, text: 'Long wrapped line\nSecond line', color: COLORS[3].value }];
  const second = { ...await blankBoard(), createdAt: first.createdAt + 1000 };
  const records = [first, second];
  const picker = new BoardPicker(dialog, opener, {
    load: async id => { loaded = id; await pause(30); throw new Error('Load failed'); },
    remove: async id => { removed = id; return { records: records.filter(record => record.id !== id), activeId: first.id }; },
  });
  try {
    picker.show(records, first.id);
    const items = [...dialog.querySelectorAll('[role="radio"]')];
    assert(items[0].dataset.id === second.id && items[1].getAttribute('aria-checked') === 'true');
    assert(formatCreatedAt(first.createdAt) === '2026-09-28 01:02:03');
    assert(items[1].querySelector('time').textContent === '2026-09-28 01:02:03');
    for (let i = 0; i < 50 && !items[1].querySelector('textarea'); i++) await pause(20);
    const preview = items[1].querySelector('textarea');
    assert(preview?.value === first.texts[0].text && preview.readOnly);
    assert(items[1].querySelector('canvas')?.width === 256);
    dialog.style.maxHeight = '300px';
    await pause(20);
    const bounds = items[1].querySelector('.board-preview').getBoundingClientRect();
    assert(Math.abs(bounds.width - bounds.height) < 2, 'Short dialogs must scroll, not squash previews');
    assert(picker.list.scrollHeight > picker.list.clientHeight);
    dialog.style.maxHeight = '';
    picker.loadButton.focus();
    picker.loadButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    assert(document.activeElement === items[1], 'Tab must wrap inside the dialog');
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    assert(document.activeElement === picker.loadButton, 'Shift+Tab must wrap inside the dialog');
    assert(parseFloat(preview.style.height) > 48 * 2.5, 'Text should wrap at the board edge');
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    assert(picker.selected === second.id && document.activeElement === items[0]);
    assert(loaded === null, 'Selection must not load a board');
    picker.loadButton.click();
    assert(document.activeElement === dialog && picker.closeButton.disabled);
    const busyTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(busyTab);
    const busyEscape = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(busyEscape);
    assert(busyTab.defaultPrevented && busyEscape.defaultPrevented, 'Pending operations must keep focus inside the dialog');
    await pause(50);
    assert(loaded === second.id && dialog.open && !picker.error.hidden);
    picker.removeButton.click();
    await pause(20);
    assert(removed === second.id && dialog.querySelectorAll('[role="radio"]').length === 1 && dialog.open);
    picker.closeButton.click();
    await pause(20);
    assert(!dialog.open && document.activeElement === opener);
    assert(!picker.list.children.length, 'Closing must release previews');
  } finally {
    dialog.close();
    picker.previews.disconnect();
    dialog.remove();
    opener.remove();
  }
});

await test('Autosave serializes writes and saves the newest revision', async () => {
  let value = 1;
  let active = 0;
  const saved = [];
  const saver = new Autosave(async () => value, async record => {
    assert(++active === 1, 'Concurrent write');
    await pause(15);
    saved.push(record);
    active--;
  }, () => {});
  saver.schedule(1000);
  const pending = saver.flush();
  await pause(2);
  value = 2;
  saver.schedule(1000);
  await pending;
  clearTimeout(saver.timer);
  assert(saved.join() === '1,2');
  assert(!saver.pending);
});

await test('Save failures remain dirty and can retry', async () => {
  let fail = true;
  let state;
  const saver = new Autosave(async () => ({}), async () => { if (fail) throw new Error('Quota exceeded'); }, next => { state = next; });
  saver.schedule(1000);
  await saver.flush();
  assert(state === 'error' && saver.pending);
  fail = false;
  await saver.flush();
  assert(state === 'saved' && !saver.pending);
});

await test('Pinch combines midpoint movement and scale while preserving its board anchor', () => {
  const camera = { x: -200, y: -50, scale: .5 };
  const start = touchPair([{ x: 100, y: 200 }, { x: 300, y: 200 }]);
  const current = touchPair([{ x: 80, y: 250 }, { x: 480, y: 250 }]);
  const result = pinchCamera(camera, start, current, .25);
  near(result.scale, 1);
  const before = toBoard(start.center, camera);
  const after = toBoard(current.center, result);
  near(before.x, after.x); near(before.y, after.y);
  near(pinchCamera(camera, start, { ...current, distance: 100000 }, .25).scale, 8);
  near(pinchCamera(camera, start, { ...current, distance: 0 }, .25).scale, .25);
});

await test('Canceling drawing or erasing restores the bitmap and excludes provisional pixels from saves', async () => {
  const surface = canvas();
  paintStroke(surface.getContext('2d'), [{ x: 50, y: 50 }], 12);
  const drawing = new Drawing(surface);
  drawing.begin({ x: 100, y: 100 }, 12, false);
  const restored = canvas();
  await new Drawing(restored).restore(await drawing.snapshot());
  assert(pixel(restored, 50, 50)[3] === 255);
  assert(pixel(restored, 100, 100)[3] === 0);
  drawing.cancel();
  assert(pixel(surface, 100, 100)[3] === 0);
  drawing.begin({ x: 50, y: 50 }, 32, true);
  assert(pixel(surface, 50, 50)[3] === 0);
  drawing.cancel();
  assert(pixel(surface, 50, 50)[3] === 255);
  assert(!drawing.stroke && !drawing.frame);
});

function touchFixture(tool = 'pencil', color = '#fff') {
  const element = document.createElement('div');
  const layer = document.createElement('div');
  document.querySelector('#fixture').append(element);
  element.append(layer);
  const captured = new Set();
  // Synthetic PointerEvents cannot obtain native capture; model capture for these state tests.
  element.setPointerCapture = id => captured.add(id);
  element.hasPointerCapture = id => captured.has(id);
  element.releasePointerCapture = id => captured.delete(id);
  const viewport = {
    element, camera: { x: 0, y: 0, scale: 1 },
    point: event => ({ x: event.clientX, y: event.clientY }),
    boardPoint(event) { return toBoard(this.point(event), this.camera); },
    contains: point => point.x >= 0 && point.y >= 0 && point.x < BOARD_SIZE && point.y < BOARD_SIZE,
    minimumScale: () => .25, render() {},
  };
  const drawing = new Drawing(canvas());
  const text = new TextLayer(layer, viewport, () => {}, () => {});
  let changes = 0;
  const input = new TouchInput(element, viewport, drawing, text, {
    available: () => true, tool: () => ({ tool, size: tool === 'text' ? 48 : 12, color }), changed: () => changes++,
  });
  const send = (type, id, x = 100, y = 100, target = element) => target.dispatchEvent(new PointerEvent(type, {
    pointerType: 'touch', pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true,
  }));
  return { input, viewport, drawing, text, send, changes: () => changes, cleanup: () => { input.cancel(); element.remove(); } };
}

await test('Second finger rolls back the stroke; one remaining finger cannot resume drawing', () => {
  const f = touchFixture();
  try {
    f.send('pointerdown', 1, 100, 100);
    assert(pixel(f.drawing.canvas, 100, 100)[3] === 255);
    f.send('pointerdown', 2, 200, 100);
    assert(pixel(f.drawing.canvas, 100, 100)[3] === 0);
    f.send('pointermove', 2, 300, 100);
    near(f.viewport.camera.scale, 2);
    f.send('pointerup', 2, 300, 100);
    const camera = JSON.stringify(f.viewport.camera);
    f.send('pointermove', 1, 120, 100);
    assert(JSON.stringify(f.viewport.camera) === camera && !f.drawing.stroke);
    f.send('pointerup', 1, 120, 100);
    assert(!f.input.active && f.changes() === 0);
    f.send('pointerdown', 3, 150, 150);
    f.send('pointerup', 3, 150, 150);
    assert(f.changes() === 1 && !f.drawing.stroke);
  } finally { f.cleanup(); }
});

await test('Touch uses the selected pencil color and a pinch rolls back only provisional color', () => {
  const f = touchFixture('pencil', COLORS[3].value);
  try {
    f.send('pointerdown', 1, 50, 50);
    f.send('pointerup', 1, 50, 50);
    const green = pixel(f.drawing.canvas, 50, 50).join();
    assert(green !== '255,255,255,255' && pixel(f.drawing.canvas, 50, 50)[3] === 255);
    f.send('pointerdown', 2, 100, 100);
    assert(pixel(f.drawing.canvas, 100, 100).join() === green);
    f.send('pointerdown', 3, 200, 100);
    assert(pixel(f.drawing.canvas, 100, 100)[3] === 0);
    assert(pixel(f.drawing.canvas, 50, 50).join() === green);
    assert(f.changes() === 1);
  } finally { f.cleanup(); }
});

await test('Third-finger changes, pointer cancellation, and capture loss leave no stuck gesture', () => {
  const f = touchFixture();
  try {
    f.send('pointerdown', 1, 100, 100);
    f.send('pointerdown', 2, 200, 100);
    f.send('pointerdown', 3, 300, 100);
    f.send('pointercancel', 1, 100, 100);
    f.send('pointermove', 3, 350, 100);
    assert(Number.isFinite(f.viewport.camera.scale));
    f.send('pointerup', 2, 200, 100);
    f.send('pointerup', 3, 350, 100);
    f.send('pointerdown', 4, 100, 100);
    f.send('lostpointercapture', 4, 100, 100);
    assert(!f.input.active && !f.drawing.stroke && f.changes() === 0);
    f.send('pointerdown', 5, 100, 100);
    f.input.cancel();
    assert(!f.input.active && !f.drawing.stroke);
  } finally { f.cleanup(); }
});

await test('Text opens only after a tap, never during a pinch or a swipe', () => {
  const f = touchFixture('text', COLORS[2].value);
  try {
    f.send('pointerdown', 1);
    assert(f.text.blocks.size === 0);
    f.send('pointerdown', 2, 200, 100);
    f.send('pointerup', 2, 200, 100);
    f.send('pointerup', 1);
    assert(f.text.blocks.size === 0);
    f.send('pointerdown', 3);
    f.send('pointermove', 3, 140, 100);
    f.send('pointerup', 3, 140, 100);
    assert(f.text.blocks.size === 0);
    f.send('pointerdown', 4);
    f.send('pointerup', 4);
    assert(f.text.blocks.size === 1);
    const block = f.text.blocks.get(f.text.selected);
    assert(block.data.color === COLORS[2].value, 'Touch creation must use the text color');
    assert(document.activeElement.matches('.text-editor'));
    block.editor.value = 'Touch color';
    block.editor.dispatchEvent(new Event('input'));
    f.text.recolor(COLORS[5].value);
    f.text.deselect();
    f.send('pointerdown', 5, 100, 100, block.editor);
    f.send('pointerup', 5, 100, 100, block.editor);
    assert(block.data.color === COLORS[5].value, 'Editing existing text must preserve its color');
  } finally { f.cleanup(); }
});

await test('A pinch started on a text handle cancels its provisional movement', () => {
  const f = touchFixture('text');
  try {
    f.text.restore([{ id: 'move', x: 100, y: 100, size: 48, text: 'Move me' }]);
    f.text.select('move');
    const handle = f.text.blocks.get('move').element.querySelector('.text-handle');
    f.send('pointerdown', 1, 100, 100, handle);
    f.send('pointermove', 1, 150, 150);
    assert(f.text.blocks.get('move').data.x === 150);
    assert(f.text.serialize()[0].x === 100, 'Autosave must not include a provisional drag');
    f.send('pointerdown', 2, 250, 150);
    assert(f.text.blocks.get('move').data.x === 100 && !f.text.drag);
    f.send('pointerup', 2, 250, 150);
    f.send('pointerup', 1, 150, 150);
  } finally { f.cleanup(); }
});

window.testResults = results;
const failed = results.filter(result => !result.passed).length;
document.querySelector('#summary').textContent = `${results.length - failed}/${results.length} checks passed.`;
document.body.dataset.result = failed ? 'fail' : 'pass';
