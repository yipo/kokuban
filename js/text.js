import { BOARD_SIZE, FONT, SIZES, clamp } from './config.js';

export class TextLayer {
  constructor(layer, viewport, onChange, onSelect, actions = null) {
    this.layer = layer;
    this.viewport = viewport;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.actions = actions;
    this.blocks = new Map();
    this.selected = null;
    this.drag = null;
    this.measure = document.createElement('canvas').getContext('2d');
    if (actions) {
      actions.addEventListener('pointerdown', event => event.preventDefault());
      actions.querySelector('[data-action="done"]').addEventListener('click', () => this.deselect());
      actions.querySelector('[data-action="delete"]').addEventListener('click', () => this.removeSelected());
    }
  }

  serialize() {
    return [...this.blocks.values()].map(({ data }) => ({
      ...data,
      ...(this.drag?.id === data.id ? this.drag.original : {}),
    }));
  }

  restore(records) {
    for (const record of records) this.add({ ...record });
  }

  create(point, size, color = '#fff') {
    this.commit();
    const id = crypto.randomUUID();
    this.add({ id, x: point.x, y: point.y, size, color, text: '' });
    this.edit(id);
  }

  add(data) {
    data.color ??= '#fff';
    const element = document.createElement('div');
    element.className = 'text-block';
    element.dataset.id = data.id;
    const handle = document.createElement('button');
    handle.className = 'text-handle';
    handle.textContent = '⠿';
    handle.setAttribute('aria-label', 'Select or drag text');
    handle.title = 'Drag to move · Delete to remove';
    const editor = document.createElement('textarea');
    editor.className = 'text-editor';
    editor.setAttribute('aria-label', 'Board text');
    editor.spellcheck = false;
    editor.readOnly = true;
    editor.tabIndex = -1;
    editor.value = data.text;
    element.append(handle, editor);
    const block = { data, element, editor };
    this.blocks.set(data.id, block);
    this.layer.append(element);
    this.layout(block);

    element.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.stopPropagation();
      if (event.target === handle) {
        event.preventDefault();
        if (!this.startDrag(data.id, event)) return;
        handle.focus({ preventScroll: true });
        handle.setPointerCapture(event.pointerId);
      } else {
        if (editor.readOnly) event.preventDefault();
        this.edit(data.id);
      }
    });
    handle.addEventListener('pointermove', event => this.moveDrag(event));
    const finishDrag = event => {
      if (this.drag?.pointerId === event.pointerId) this.endDrag(event.type !== 'pointerup');
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('lostpointercapture', finishDrag);
    editor.addEventListener('input', () => {
      data.text = editor.value;
      this.layout(block);
      this.onChange();
      this.keepEditorVisible();
    });
    editor.addEventListener('blur', () => this.commit());
    editor.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        this.commit();
        this.viewport.element.focus({ preventScroll: true });
      }
    });
  }

  layout(block) {
    const { data, element, editor } = block;
    const lineHeight = data.size * 1.25;
    data.x = clamp(data.x, 0, BOARD_SIZE - data.size - 4);
    this.measure.font = `${data.size}px ${FONT}`;
    const longest = Math.max(0, ...data.text.split('\n').map(line => this.measure.measureText(line).width));
    const width = Math.min(BOARD_SIZE - data.x, Math.max(data.size + 4, Math.ceil(longest) + 6));
    element.style.width = `${width}px`;
    editor.style.fontSize = `${data.size}px`;
    editor.style.color = data.color;
    editor.style.height = '0px';
    const height = Math.min(BOARD_SIZE, Math.max(lineHeight + 4, editor.scrollHeight));
    editor.style.height = `${height}px`;
    data.y = clamp(data.y, 0, BOARD_SIZE - height);
    element.style.left = `${data.x}px`;
    element.style.top = `${data.y}px`;
    element.style.setProperty('--text-top', `${data.y}px`);
    element.style.setProperty('--text-left', `${data.x}px`);
  }

  select(id) {
    this.selected = id;
    for (const block of this.blocks.values()) block.element.classList.toggle('selected', block.data.id === id);
    if (this.actions) this.actions.hidden = !id;
    if (id) {
      const { size, color } = this.blocks.get(id).data;
      this.onSelect(SIZES.text.indexOf(size), color);
    }
  }

  edit(id) {
    if (this.selected !== id) this.commit();
    const block = this.blocks.get(id);
    if (!block) return;
    this.select(id);
    block.editor.readOnly = false;
    block.editor.focus({ preventScroll: true });
    this.keepEditorVisible();
  }

  startDrag(id, event) {
    this.commit();
    const block = this.blocks.get(id);
    if (!block) return false;
    this.select(id);
    const point = this.viewport.boardPoint(event);
    const { x, y } = block.data;
    this.drag = { id, pointerId: event.pointerId, x: point.x - x, y: point.y - y, original: { x, y }, moved: false };
    return true;
  }

  moveDrag(event) {
    if (!this.drag || this.drag.pointerId !== event.pointerId) return;
    const block = this.blocks.get(this.drag.id);
    const point = this.viewport.boardPoint(event);
    block.data.x = point.x - this.drag.x;
    block.data.y = point.y - this.drag.y;
    this.layout(block);
    this.drag.moved = true;
  }

  endDrag(cancel = false) {
    if (!this.drag) return;
    const { id, original, moved } = this.drag;
    this.drag = null;
    const block = this.blocks.get(id);
    if (cancel && block) { Object.assign(block.data, original); this.layout(block); }
    else if (moved) this.onChange();
  }

  keepEditorVisible() {
    const block = this.blocks.get(this.selected);
    if (!block || document.activeElement !== block.editor || !this.viewport.pan) return;
    const visible = window.visualViewport;
    if (!visible) return;
    const bounds = block.editor.getBoundingClientRect();
    const left = visible.offsetLeft + 80;
    const right = visible.offsetLeft + visible.width - 80;
    const actionsBottom = this.actions && !this.actions.hidden ? this.actions.getBoundingClientRect().bottom + 16 : 0;
    const top = Math.max(visible.offsetTop + 80, actionsBottom);
    const bottom = visible.offsetTop + visible.height - 40;
    const dx = bounds.left < left ? left - bounds.left : bounds.right > right ? Math.max(left - bounds.left, right - bounds.right) : 0;
    const dy = bounds.top < top ? top - bounds.top : bounds.bottom > bottom ? Math.max(top - bounds.top, bottom - bounds.bottom) : 0;
    if (dx || dy) this.viewport.pan(dx, dy);
  }

  commit() {
    const block = this.blocks.get(this.selected);
    if (!block) return;
    block.editor.readOnly = true;
    if (document.activeElement === block.editor) block.editor.blur();
    if (!block.data.text.trim()) this.removeSelected();
  }

  deselect() { this.commit(); this.select(null); }

  recolor(color) {
    const block = this.blocks.get(this.selected);
    if (!block || block.data.color === color) return;
    block.data.color = color;
    block.editor.style.color = color;
    this.onChange();
  }

  resize(size) {
    const block = this.blocks.get(this.selected);
    if (!block) return;
    block.data.size = size;
    this.layout(block);
    this.keepEditorVisible();
    this.onChange();
  }

  removeSelected() {
    const block = this.blocks.get(this.selected);
    if (!block) return;
    this.select(null);
    this.drag = null;
    this.blocks.delete(block.data.id);
    block.element.remove();
    this.onChange();
  }

  clear() {
    this.select(null);
    this.drag = null;
    this.blocks.clear();
    this.layer.replaceChildren();
  }
}
