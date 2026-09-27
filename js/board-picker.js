import { BOARD_SIZE } from './config.js';
import { TextLayer } from './text.js';
import { validateRecord } from './storage.js';

export function formatCreatedAt(timestamp) {
  const date = new Date(timestamp);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export class BoardPicker {
  constructor(dialog, opener, { load, remove }) {
    this.dialog = dialog;
    dialog.tabIndex = -1;
    this.opener = opener;
    this.list = dialog.querySelector('.board-list');
    this.error = dialog.querySelector('.board-picker-error');
    this.loadButton = dialog.querySelector('[data-action="load"]');
    this.removeButton = dialog.querySelector('[data-action="remove"]');
    this.closeButton = dialog.querySelector('[data-action="close"]');
    this.selected = null;
    this.busy = false;
    this.generation = 0;
    this.previews = new ResizeObserver(entries => {
      for (const { target, contentRect } of entries) {
        target.firstElementChild.style.transform = `scale(${contentRect.width / BOARD_SIZE})`;
      }
    });
    this.closeButton.addEventListener('click', () => dialog.close());
    dialog.addEventListener('cancel', event => { if (this.busy) event.preventDefault(); });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const selected = this.list.querySelector('[aria-checked="true"]');
      const targets = [this.busy ? null : selected, this.removeButton, this.closeButton, this.loadButton]
        .filter(button => button && !button.disabled);
      const first = targets[0];
      const last = targets.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener('close', () => {
      this.generation++;
      this.previews.disconnect();
      this.list.replaceChildren();
      this.opener.focus({ preventScroll: true });
    });
    this.loadButton.addEventListener('click', () => this.perform(async () => {
      await load(this.selected);
      dialog.close();
    }));
    this.removeButton.addEventListener('click', () => this.perform(async () => {
      const { records, activeId } = await remove(this.selected);
      this.render(records, activeId);
    }));
    this.list.addEventListener('keydown', event => {
      const items = [...this.list.querySelectorAll('[role="radio"]')];
      const index = items.indexOf(event.target);
      if (index < 0 || this.busy) return;
      const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      let next;
      if (event.key in moves) next = (index + moves[event.key] + items.length) % items.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else return;
      event.preventDefault();
      this.select(items[next].dataset.id);
      items[next].focus();
    });
  }

  get open() { return this.dialog.open; }

  show(records, activeId) {
    this.error.hidden = true;
    this.dialog.showModal();
    this.render(records, activeId);
    (this.list.querySelector('[aria-checked="true"]') || this.closeButton).focus();
  }

  select(id) {
    this.selected = id;
    for (const item of this.list.querySelectorAll('[role="radio"]')) {
      const selected = item.dataset.id === id;
      item.setAttribute('aria-checked', selected);
      item.tabIndex = selected ? 0 : -1;
    }
    this.updateButtons();
  }

  updateButtons() {
    this.loadButton.disabled = this.removeButton.disabled = this.busy || !this.selected;
    this.closeButton.disabled = this.busy;
    this.list.inert = this.busy;
    this.dialog.setAttribute('aria-busy', this.busy);
    if (this.busy) this.dialog.focus({ preventScroll: true });
  }

  async perform(action) {
    if (this.busy || !this.selected) return;
    this.busy = true;
    this.error.hidden = true;
    this.updateButtons();
    try { await action(); }
    catch (error) {
      this.error.textContent = error.message;
      this.error.hidden = false;
    } finally {
      this.busy = false;
      this.updateButtons();
      // Buttons temporarily disabled during an action can lose focus.
      if (this.open && (document.activeElement === this.dialog || !this.dialog.contains(document.activeElement))) {
        (this.list.querySelector('[aria-checked="true"]') || this.closeButton).focus();
      }
    }
  }

  render(records, activeId) {
    const generation = ++this.generation;
    this.previews.disconnect();
    this.list.replaceChildren();
    const ordered = [...records].sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    for (const record of ordered) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'board-item';
      item.dataset.id = record.id;
      item.setAttribute('role', 'radio');
      const preview = document.createElement('span');
      preview.className = 'board-preview';
      preview.setAttribute('aria-hidden', 'true');
      preview.inert = true;
      const board = document.createElement('span');
      board.className = 'board-preview-content';
      preview.append(board);
      const timestamp = document.createElement('time');
      timestamp.dateTime = new Date(record.createdAt).toISOString();
      timestamp.textContent = formatCreatedAt(record.createdAt);
      const current = document.createElement('span');
      current.className = 'board-current';
      current.textContent = record.id === activeId ? 'Current board' : '';
      item.append(preview, timestamp, current);
      item.addEventListener('click', () => this.select(record.id));
      this.list.append(item);
      this.previews.observe(preview);
      this.preview(record, board, generation);
    }
    if (!records.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No saved boards.';
      this.list.append(empty);
    }
    const selected = records.some(record => record.id === this.selected) ? this.selected
      : records.some(record => record.id === activeId) ? activeId : ordered[0]?.id || null;
    this.select(selected);
  }

  async preview(record, board, generation) {
    try {
      validateRecord(record);
      const bitmap = await createImageBitmap(record.bitmap, { resizeWidth: 256, resizeHeight: 256 });
      try {
        if (generation !== this.generation || !this.open) return;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const texts = document.createElement('div');
        texts.className = 'board-preview-texts';
        board.append(canvas, texts);
        // The same DOM layout preserves textarea wrapping, fonts and padding.
        const layer = new TextLayer(texts, {}, () => {}, () => {});
        layer.restore(record.texts);
        for (const handle of texts.querySelectorAll('.text-handle')) handle.remove();
      } finally { bitmap.close(); }
    } catch {
      if (generation !== this.generation || !this.open) return;
      board.parentElement.classList.add('preview-unavailable');
      board.parentElement.setAttribute('aria-label', 'Preview unavailable');
      board.textContent = 'Preview unavailable';
    }
  }
}
