import { BOARD_SIZE, SIZES } from '../js/config.js';
import { toBoard, zoomAt, constrain } from '../js/viewport.js';
import { Drawing, paintStroke, toPNG } from '../js/drawing.js';
import { TextLayer } from '../js/text.js';
import { Autosave, openDatabase, readBoard, writeBoard } from '../js/storage.js';

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
  surface.style.filter = 'invert(1)';
  paintStroke(surface.getContext('2d'), [{ x: 50, y: 50 }], 12);
  const copy = canvas();
  await new Drawing(copy).restore(await toPNG(surface));
  assert(pixel(copy, 50, 50).join() === '255,255,255,255');
  assert(pixel(copy, 0, 0).join() === '0,0,0,0');
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

await test('IndexedDB round-trips PNG/text and rejects invalid records', async () => {
  const name = `kokuban-test-${crypto.randomUUID()}`;
  const database = await openDatabase(name);
  try {
    const surface = canvas();
    paintStroke(surface.getContext('2d'), [{ x: 25, y: 25 }], 6);
    const record = { version: 1, bitmap: await toPNG(surface), texts: [{ id: 'test', x: 40, y: 80, size: 48, text: 'Hello\n世界' }] };
    await writeBoard(database, '/test/', record);
    const restored = await readBoard(database, '/test/');
    assert(restored.texts[0].text === 'Hello\n世界');
    const copy = canvas();
    await new Drawing(copy).restore(restored.bitmap);
    assert(pixel(copy, 25, 25)[3] === 255);
    assert(await readBoard(database, '/different-path/') === null);
    await writeBoard(database, '/invalid/', { version: 99 });
    let rejected = false;
    try { await readBoard(database, '/invalid/'); } catch { rejected = true; }
    assert(rejected, 'Invalid records must reject instead of leaving loading pending');
  } finally {
    database.close();
    indexedDB.deleteDatabase(name);
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

window.testResults = results;
const failed = results.filter(result => !result.passed).length;
document.querySelector('#summary').textContent = `${results.length - failed}/${results.length} checks passed.`;
document.body.dataset.result = failed ? 'fail' : 'pass';
