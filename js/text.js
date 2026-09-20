import { BOARD_SIZE, FONT, SIZES, clamp } from './config.js';

export class TextLayer {
  constructor(layer, viewport, onChange, onSelect) {
    this.layer = layer;
    this.viewport = viewport;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.blocks = new Map();
    this.selected = null;
    this.drag = null;
    this.measure = document.createElement('canvas').getContext('2d');
  }

  serialize() { return [...this.blocks.values()].map(({ data }) => ({ ...data })); }

  restore(records) {
    for (const record of records) this.add({ ...record });
  }

  create(point, size) {
    this.commit();
    const id = crypto.randomUUID();
    this.add({ id, x: point.x, y: point.y, size, text: '' });
    this.edit(id);
  }

  add(data) {
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
        this.commit();
        if (!this.blocks.has(data.id)) return;
        this.select(data.id);
        handle.focus({ preventScroll: true });
        const point = this.viewport.boardPoint(event);
        this.drag = { id: data.id, pointerId: event.pointerId, x: point.x - data.x, y: point.y - data.y, moved: false };
        handle.setPointerCapture(event.pointerId);
      } else {
        if (editor.readOnly) event.preventDefault();
        this.edit(data.id);
      }
    });
    handle.addEventListener('pointermove', event => {
      if (!this.drag || this.drag.pointerId !== event.pointerId) return;
      const point = this.viewport.boardPoint(event);
      data.x = point.x - this.drag.x;
      data.y = point.y - this.drag.y;
      this.layout(block);
      this.drag.moved = true;
    });
    const finishDrag = () => {
      if (this.drag?.id !== data.id) return;
      const moved = this.drag.moved;
      this.drag = null;
      if (moved) this.onChange();
    };
    handle.addEventListener('pointerup', finishDrag);
    handle.addEventListener('pointercancel', finishDrag);
    handle.addEventListener('lostpointercapture', finishDrag);
    editor.addEventListener('input', () => {
      data.text = editor.value;
      this.layout(block);
      this.onChange();
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
    editor.style.height = '0px';
    const height = Math.min(BOARD_SIZE, Math.max(lineHeight + 4, editor.scrollHeight));
    editor.style.height = `${height}px`;
    data.y = clamp(data.y, 0, BOARD_SIZE - height);
    element.style.left = `${data.x}px`;
    element.style.top = `${data.y}px`;
    // Keep the handle reachable for text at the top edge.
    element.querySelector('.text-handle').style.transform = data.y < 24 ? 'none' : 'translateY(-100%)';
  }

  select(id) {
    this.selected = id;
    for (const block of this.blocks.values()) block.element.classList.toggle('selected', block.data.id === id);
    if (id) this.onSelect(SIZES.text.indexOf(this.blocks.get(id).data.size));
  }

  edit(id) {
    if (this.selected !== id) this.commit();
    const block = this.blocks.get(id);
    if (!block) return;
    this.select(id);
    block.editor.readOnly = false;
    block.editor.focus({ preventScroll: true });
  }

  commit() {
    const block = this.blocks.get(this.selected);
    if (!block) return;
    const wasEditing = !block.editor.readOnly;
    block.editor.readOnly = true;
    if (document.activeElement === block.editor) block.editor.blur();
    if (!block.data.text.trim()) this.removeSelected();
    else if (wasEditing) this.onChange();
  }

  deselect() { this.commit(); this.select(null); }

  resize(size) {
    const block = this.blocks.get(this.selected);
    if (!block) return;
    block.data.size = size;
    this.layout(block);
    this.onChange();
  }

  removeSelected() {
    const block = this.blocks.get(this.selected);
    if (!block) return;
    this.selected = null;
    this.blocks.delete(block.data.id);
    block.element.remove();
    this.onChange();
  }

  clear() {
    this.selected = null;
    this.blocks.clear();
    this.layer.replaceChildren();
  }
}
