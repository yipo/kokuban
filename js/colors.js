import { COLORS, clamp } from './config.js';

export class ColorPicker {
  constructor(toolbar, toggle, panel, onChange = () => {}) {
    this.toolbar = toolbar;
    this.toggle = toggle;
    this.panel = panel;
    this.selected = 0;
    this.tool = 'pencil';
    this.compact = false;
    this.open = false;
    this.events = new AbortController();
    const listen = (element, type, handler, options = {}) => element.addEventListener(type, handler, { ...options, signal: this.events.signal });

    this.buttons = COLORS.map((color, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = toggle.disabled;
      button.dataset.color = index;
      button.title = color.name;
      button.setAttribute('aria-label', `${color.name} pencil color`);
      const swatch = document.createElement('span');
      swatch.className = 'color-swatch';
      swatch.style.background = color.value;
      swatch.setAttribute('aria-hidden', 'true');
      button.append(swatch);
      // Pointer selection must not blur an active text editor or close its keyboard.
      listen(button, 'pointerdown', event => event.preventDefault());
      listen(button, 'click', event => {
        this.selected = index;
        this.updateSelection();
        onChange(this.value);
        this.close(event.detail === 0);
      });
      panel.append(button);
      return button;
    });

    listen(toggle, 'pointerdown', event => event.preventDefault());
    listen(toggle, 'click', event => this.open ? this.close() : this.show(event.detail === 0));
    listen(toggle, 'keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.show(true);
      }
    });
    listen(panel, 'keydown', event => {
      const index = this.buttons.indexOf(document.activeElement);
      if (index < 0) return;
      const columns = this.compact ? 3 : 1;
      const targets = {
        ArrowLeft: (index + COLORS.length - 1) % COLORS.length,
        ArrowRight: (index + 1) % COLORS.length,
        ArrowUp: Math.max(0, index - columns),
        ArrowDown: Math.min(COLORS.length - 1, index + columns),
        Home: 0, End: COLORS.length - 1,
      };
      if (event.key in targets) {
        event.preventDefault();
        this.buttons[targets[event.key]].focus();
      }
    });
    listen(document, 'keydown', event => {
      if (this.open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close(true);
      }
    }, { capture: true });
    const outside = event => {
      if (!panel.contains(event.target) && !toggle.contains(event.target)) this.close();
    };
    listen(document, 'pointerdown', outside);
    listen(document, 'focusin', outside);
    this.updateSelection();
  }

  get value() { return COLORS[this.selected].value; }

  // Tool/block selection updates the UI without applying a new color.
  setColor(value, tool = this.tool) {
    const index = COLORS.findIndex(color => color.value === value);
    if (index < 0) return;
    this.selected = index;
    this.tool = tool;
    this.updateSelection();
  }

  updateSelection() {
    this.buttons.forEach((button, index) => {
      button.setAttribute('aria-pressed', index === this.selected);
      button.setAttribute('aria-label', `${COLORS[index].name} ${this.tool} color`);
    });
    const name = this.tool === 'text' ? 'Text' : 'Pencil';
    this.panel.setAttribute('aria-label', `${name} color`);
    this.toggle.querySelector('.color-swatch').style.background = this.value;
    const label = `${name} color: ${COLORS[this.selected].name}`;
    this.toggle.setAttribute('aria-label', label);
    this.toggle.title = label;
  }

  show(keyboard = false) {
    if (!this.compact || this.toggle.disabled) return;
    this.open = true;
    this.panel.hidden = false;
    this.toggle.setAttribute('aria-expanded', 'true');
    this.positionPanel();
    if (keyboard) this.buttons[this.selected].focus();
  }

  close(returnFocus = false) {
    if (!this.open) return;
    this.open = false;
    this.panel.hidden = this.compact;
    this.toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) this.toggle.focus({ preventScroll: true });
  }

  updateLayout() {
    // Measure an inert expanded copy, never the collapsed toolbar: its height must
    // not change the breakpoint or move focus out of the real color controls.
    const measure = this.toolbar.cloneNode(true);
    measure.querySelector('[aria-controls]').remove();
    measure.querySelector('.color-palette')?.remove();
    const palette = this.panel.cloneNode(true);
    palette.classList.remove('color-popup');
    palette.hidden = false;
    palette.removeAttribute('style');
    measure.append(palette);
    measure.removeAttribute('id');
    measure.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    measure.inert = true;
    measure.setAttribute('aria-hidden', 'true');
    Object.assign(measure.style, { visibility: 'hidden', pointerEvents: 'none', maxHeight: 'none', overflow: 'visible' });
    document.body.append(measure);
    const expandedHeight = measure.getBoundingClientRect().height;
    measure.remove();
    const compact = expandedHeight > (window.visualViewport?.height || window.innerHeight) - 160;
    if (compact !== this.compact) {
      const panelFocused = this.panel.contains(document.activeElement);
      const toggleFocused = document.activeElement === this.toggle;
      this.close();
      this.compact = compact;
      this.toggle.hidden = !compact;
      this.panel.classList.toggle('color-popup', compact);
      this.panel.hidden = compact;
      this.panel.removeAttribute('style');
      // A body-level popup is not constrained by the toolbar's transform/scroll.
      (compact ? document.body : this.toolbar).append(this.panel);
      if (compact && panelFocused) this.toggle.focus({ preventScroll: true });
      if (!compact && (panelFocused || toggleFocused)) this.buttons[this.selected].focus({ preventScroll: true });
    }
    if (this.open) this.positionPanel();
  }

  positionPanel() {
    const visible = window.visualViewport;
    const left = (visible?.offsetLeft || 0) + 8;
    const top = (visible?.offsetTop || 0) + 8;
    const width = (visible?.width || window.innerWidth) - 16;
    const height = (visible?.height || window.innerHeight) - 16;
    this.panel.style.maxWidth = `${width}px`;
    this.panel.style.maxHeight = `${height}px`;
    const button = this.toggle.getBoundingClientRect();
    const panel = this.panel.getBoundingClientRect();
    this.panel.style.left = `${clamp(button.left - panel.width - 12, left, left + Math.max(0, width - panel.width))}px`;
    this.panel.style.top = `${clamp(button.top, top, top + Math.max(0, height - panel.height))}px`;
  }

  destroy() {
    this.events.abort();
    this.panel.remove();
  }
}
