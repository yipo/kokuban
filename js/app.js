import { SIZES } from './config.js';
import { Drawing, toPNG } from './drawing.js';
import { Viewport } from './viewport.js';
import { TextLayer } from './text.js';
import { Autosave, openDatabase, readBoard, writeBoard } from './storage.js';

const element = document.querySelector('#viewport');
const canvas = document.querySelector('#drawing');
const viewport = new Viewport(element, document.querySelector('#board'), document.querySelector('#zoom'));
const drawing = new Drawing(canvas);
const statusElement = document.querySelector('#save-status');
const toolButtons = [...document.querySelectorAll('[data-tool]')];
const sizeButtons = [...document.querySelectorAll('[data-size]')];
const sizes = { pencil: 1, eraser: 1, text: 1 };
let tool = 'pencil';
let ready = false;
let gesture = null;
let database;
let loadFailed = false;
// GitHub Pages projects share an origin, so keep their boards separate by path.
const boardKey = new URL('./', location.href).pathname;

function status(state, message, detail = '') {
  statusElement.dataset.state = state;
  statusElement.textContent = message;
  statusElement.title = detail || 'Your board is stored only in this browser.';
}

const textLayer = new TextLayer(document.querySelector('#text-layer'), viewport,
  () => saver.schedule(),
  index => { if (index >= 0) sizes.text = index; updateTools(); });

const saver = new Autosave(async () => {
  // Capture text and bitmap before the first asynchronous boundary.
  const texts = textLayer.serialize().filter(text => text.text.trim());
  const bitmap = await toPNG(canvas);
  return { version: 1, bitmap, texts };
}, async record => {
  if (loadFailed) throw new Error('The saved board could not be opened. Reload to retry, or Clear board to replace it.');
  database ||= await openDatabase();
  await writeBoard(database, boardKey, record);
}, status);

function updateTools() {
  element.dataset.tool = tool;
  toolButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.tool === tool));
  document.querySelector('#sizes').setAttribute('aria-label', `${tool} size`);
  sizeButtons.forEach((button, index) => {
    button.setAttribute('aria-pressed', index === sizes[tool]);
    const name = ['Small', 'Medium', 'Large'][index];
    button.setAttribute('aria-label', `${name}: ${SIZES[tool][index]} pixels`);
    button.title = `${name} · ${SIZES[tool][index]} px`;
  });
}

toolButtons.forEach(button => button.addEventListener('click', () => {
  textLayer.deselect();
  tool = button.dataset.tool;
  updateTools();
}));
sizeButtons.forEach(button => {
  // Size selection should not blur and discard an empty text block.
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    sizes[tool] = Number(button.dataset.size);
    if (tool === 'text') textLayer.resize(SIZES.text[sizes.text]);
    updateTools();
  });
});

element.addEventListener('contextmenu', event => event.preventDefault());
element.addEventListener('pointerdown', event => {
  if (!ready || event.pointerType === 'touch' || gesture) return;
  if (event.button === 2) {
    event.preventDefault();
    textLayer.commit();
    gesture = { type: 'pan', id: event.pointerId, x: event.clientX, y: event.clientY };
    element.classList.add('panning');
  } else if (event.button === 0) {
    const point = viewport.boardPoint(event);
    textLayer.deselect();
    if (!viewport.contains(point)) return;
    if (tool === 'text') {
      event.preventDefault();
      textLayer.create(point, SIZES.text[sizes.text]);
      return;
    }
    event.preventDefault();
    element.focus({ preventScroll: true });
    drawing.begin(point, SIZES[tool][sizes[tool]], tool === 'eraser');
    gesture = { type: 'draw', id: event.pointerId };
  } else return;
  element.setPointerCapture(event.pointerId);
});

element.addEventListener('pointermove', event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  if (gesture.type === 'pan') {
    viewport.pan(event.clientX - gesture.x, event.clientY - gesture.y);
    gesture.x = event.clientX;
    gesture.y = event.clientY;
  } else {
    const samples = event.getCoalescedEvents?.();
    for (const sample of samples?.length ? samples : [event]) drawing.move(viewport.boardPoint(sample));
  }
});

function finishGesture(event) {
  if (!gesture || (event && gesture.id !== event.pointerId)) return;
  if (gesture.type === 'draw') {
    if (event?.type === 'pointerup') drawing.move(viewport.boardPoint(event));
    drawing.finish();
    saver.schedule(0);
  }
  const id = gesture.id;
  gesture = null;
  element.classList.remove('panning');
  if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
}
element.addEventListener('pointerup', finishGesture);
element.addEventListener('pointercancel', finishGesture);
element.addEventListener('lostpointercapture', finishGesture);
window.addEventListener('blur', () => finishGesture());

document.addEventListener('keydown', event => {
  if (!ready || event.isComposing || event.target.matches('textarea, input, [contenteditable]')) return;
  if (event.key === 'Delete' && tool === 'text' && textLayer.selected) {
    event.preventDefault();
    textLayer.removeSelected();
  } else if (event.key === 'Escape') textLayer.deselect();
});

document.querySelector('#clear').addEventListener('click', () => {
  if (!window.confirm('Clear all drawing and text? This cannot be undone.')) return;
  finishGesture();
  textLayer.clear();
  drawing.clear();
  loadFailed = false;
  saver.schedule(0);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    finishGesture();
    textLayer.commit();
    if (saver.pending) saver.flush();
  }
});
window.addEventListener('beforeunload', event => {
  if (saver.pending || drawing.stroke) {
    event.preventDefault();
    event.returnValue = '';
  }
});

const installButton = document.querySelector('#install');
let installPrompt;
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  installPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  await prompt.prompt();
});
window.addEventListener('appinstalled', () => { installPrompt = null; installButton.hidden = true; });

updateTools();
try {
  database = await openDatabase();
  const record = await readBoard(database, boardKey);
  if (record) {
    await drawing.restore(record.bitmap);
    textLayer.restore(record.texts);
  }
  status('saved', 'Saved locally');
} catch (error) {
  loadFailed = true;
  status('error', 'Storage unavailable', `${error.message} Reload to retry, or Clear board to start a new saved board.`);
} finally {
  ready = true;
  element.setAttribute('aria-busy', 'false');
  document.querySelectorAll('button:disabled').forEach(button => { button.disabled = false; });
}
