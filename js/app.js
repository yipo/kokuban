import { BOARD_SIZE, SIZES } from './config.js';
import { Drawing } from './drawing.js';
import { Viewport } from './viewport.js';
import { TextLayer } from './text.js';
import { BoardSession } from './boards.js';
import { BoardPicker } from './board-picker.js';
import { TouchInput } from './touch.js';
import { ColorPicker } from './colors.js';

const element = document.querySelector('#viewport');
const canvas = document.querySelector('#drawing');
const viewport = new Viewport(element, document.querySelector('#board'), document.querySelector('#zoom'));
const drawing = new Drawing(canvas);
const statusElement = document.querySelector('#save-status');
const toolButtons = [...document.querySelectorAll('[data-tool]')];
const sizeButtons = [...document.querySelectorAll('[data-size]')];
const sizes = { pencil: 1, eraser: 1, text: 1 };
const toolColors = { pencil: '#fff', text: '#fff' };
let tool = 'pencil';
const colorPicker = new ColorPicker(document.querySelector('#sizes'), document.querySelector('#color-toggle'), document.querySelector('#colors'), color => {
  toolColors[tool === 'text' ? 'text' : 'pencil'] = color;
  if (tool === 'text') textLayer.recolor(color);
});
let ready = false;
let gesture = null;
let busy = false;
// GitHub Pages projects share an origin, so keep their boards separate by path.
const boardKey = new URL('./', location.href).pathname;

function status(state, message, detail = '') {
  statusElement.dataset.state = state;
  statusElement.textContent = message;
  statusElement.title = detail || 'Your board is stored only in this browser.';
}

const textLayer = new TextLayer(document.querySelector('#text-layer'), viewport,
  () => saver.schedule(),
  (index, color) => {
    if (index >= 0) sizes.text = index;
    toolColors.text = color;
    updateTools();
  },
  document.querySelector('#text-actions'));

const session = new BoardSession(boardKey, {
  snapshot: async () => {
    // Capture text and bitmap before the first asynchronous boundary.
    const texts = textLayer.serialize().filter(text => text.text.trim());
    const bitmap = await drawing.snapshot();
    return { version: 1, bitmap, texts };
  },
  prepare: async record => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = BOARD_SIZE;
    await new Drawing(canvas).restore(record.bitmap);
    return canvas;
  },
  apply: (record, prepared) => {
    drawing.clear();
    drawing.context.drawImage(prepared, 0, 0);
    textLayer.clear();
    textLayer.restore(record.texts);
    viewport.reset();
  },
  status,
});
const saver = session.saver;
const picker = new BoardPicker(document.querySelector('#board-picker'), document.querySelector('#open-board'), {
  load: id => transition(() => session.load(id)),
  remove: id => transition(async () => {
    await session.remove(id);
    return { records: await session.list(), activeId: session.active?.id };
  }),
});

function updateAvailability() {
  ready = !busy && !!session.active;
  element.inert = !ready;
  element.setAttribute('aria-busy', busy);
  document.querySelectorAll('#tools button, #sizes button, #colors button').forEach(button => {
    button.disabled = busy || (!session.active && !button.matches('#new-board, #open-board'));
  });
}

async function transition(action) {
  if (busy) throw new Error('Please wait for the current board operation.');
  busy = true;
  touch.cancel();
  textLayer.endDrag(true);
  finishGesture();
  textLayer.deselect();
  colorPicker.close();
  updateAvailability();
  try {
    const result = await action();
    status('saved', 'Saved locally');
    return result;
  } catch (error) {
    status('error', 'Board action failed', error.message);
    throw error;
  } finally {
    busy = false;
    updateAvailability();
  }
}

// Toolbar failures also need visible detail, not just a hover tooltip.
function showActionError(error) {
  status('error', error.message, error.message);
}

function updateTools() {
  element.dataset.tool = tool;
  toolButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.tool === tool));
  const colorTool = tool === 'text' ? 'text' : 'pencil';
  colorPicker.setColor(toolColors[colorTool], colorTool);
  document.querySelector('#sizes').setAttribute('aria-label', `${tool} size and ${colorTool} color`);
  sizeButtons.forEach((button, index) => {
    button.setAttribute('aria-pressed', index === sizes[tool]);
    const name = ['Small', 'Medium', 'Large'][index];
    button.setAttribute('aria-label', `${name}: ${SIZES[tool][index]} pixels`);
    button.title = `${name} · ${SIZES[tool][index]} px`;
  });
}

toolButtons.forEach(button => button.addEventListener('click', () => {
  touch.cancel();
  textLayer.deselect();
  tool = button.dataset.tool;
  updateTools();
}));
sizeButtons.forEach(button => {
  // Size selection should not blur and discard an empty text block.
  button.addEventListener('pointerdown', event => event.preventDefault());
  button.addEventListener('click', () => {
    touch.cancel();
    sizes[tool] = Number(button.dataset.size);
    if (tool === 'text') textLayer.resize(SIZES.text[sizes.text]);
    updateTools();
  });
});

const touch = new TouchInput(element, viewport, drawing, textLayer, {
  available: () => ready && !picker.open && !gesture,
  tool: () => ({ tool, size: SIZES[tool][sizes[tool]], color: colorPicker.value }),
  changed: () => saver.schedule(0),
});

function updateVisibleArea() {
  const visible = window.visualViewport;
  const style = document.documentElement.style;
  style.setProperty('--visible-top', `${visible?.offsetTop || 0}px`);
  style.setProperty('--visible-height', `${visible?.height || window.innerHeight}px`);
  style.setProperty('--visible-left', `${visible?.offsetLeft || 0}px`);
  style.setProperty('--visible-width', `${visible?.width || window.innerWidth}px`);
  colorPicker.updateLayout();
  textLayer.keepEditorVisible();
}
window.visualViewport?.addEventListener('resize', updateVisibleArea);
window.visualViewport?.addEventListener('scroll', updateVisibleArea);
window.addEventListener('resize', updateVisibleArea);
updateVisibleArea();

element.addEventListener('contextmenu', event => event.preventDefault());
element.addEventListener('pointerdown', event => {
  if (!ready || event.pointerType === 'touch' || touch.active || gesture) return;
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
      textLayer.create(point, SIZES.text[sizes.text], toolColors.text);
      return;
    }
    event.preventDefault();
    element.focus({ preventScroll: true });
    drawing.begin(point, SIZES[tool][sizes[tool]], tool === 'eraser', colorPicker.value);
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
window.addEventListener('blur', () => { touch.cancel(); textLayer.endDrag(true); finishGesture(); });

document.addEventListener('keydown', event => {
  if (!ready || picker.open || event.isComposing || event.target.matches('textarea, input, [contenteditable]')) return;
  if (event.key === 'Delete' && tool === 'text' && textLayer.selected) {
    event.preventDefault();
    textLayer.removeSelected();
  } else if (event.key === 'Escape') textLayer.deselect();
});

document.querySelector('#new-board').addEventListener('click', () => {
  transition(() => session.create()).catch(showActionError);
});
document.querySelector('#open-board').addEventListener('click', () => {
  transition(async () => {
    await session.flush();
    const records = await session.list();
    picker.selected = session.active?.id || null;
    picker.show(records, session.active?.id);
  }).catch(showActionError);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    touch.cancel();
    textLayer.endDrag(true);
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
  await transition(() => session.start());
} catch (error) {
  status('error', 'Could not open board', `${error.message} Use New board or Open board to retry; existing boards are preserved.`);
}
