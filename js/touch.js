import { touchPair, pinchCamera } from './viewport.js';

const TAP_SLOP = 10; // Screen pixels, independent of board zoom.

export class TouchInput {
  constructor(element, viewport, drawing, text, options) {
    this.element = element;
    this.viewport = viewport;
    this.drawing = drawing;
    this.text = text;
    this.options = options;
    this.pointers = new Map();
    this.gesture = null;
    this.navigating = false;

    // Capture phase also sees fingers placed on text and its drag handle.
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      element.addEventListener(type, event => {
        if (event.pointerType !== 'touch') return;
        if (type === 'lostpointercapture' && event.target !== element) return;
        event.stopPropagation();
        if (type === 'pointerdown') this.down(event);
        else if (type === 'pointermove') this.move(event);
        else this.up(event);
      }, { capture: true });
    }
    // A synthesized click after pointerup must not steal focus from a new editor.
    element.addEventListener('click', event => {
      if (event.pointerType === 'touch' && event.target !== document.activeElement) event.preventDefault();
    }, { capture: true });
  }

  get active() { return this.pointers.size > 0; }

  down(event) {
    if (!this.options.available()) { event.preventDefault(); return; }
    const point = this.viewport.point(event);
    this.pointers.set(event.pointerId, point);
    document.documentElement.dataset.input = 'touch';
    if (this.pointers.size >= 2) {
      event.preventDefault();
      this.drawing.cancel();
      this.text.endDrag(true);
      this.text.commit();
      this.navigating = true;
      this.startNavigation();
      for (const id of this.pointers.keys()) this.element.setPointerCapture(id);
      return;
    }
    if (this.navigating) { event.preventDefault(); return; }

    const { tool, size, color } = this.options.tool();
    const block = tool === 'text' ? event.target.closest('.text-block') : null;
    const editor = block?.querySelector('.text-editor');
    if (event.target === editor && !editor.readOnly && document.activeElement === editor) {
      // Preserve native caret placement and selection in an already focused editor.
      this.gesture = { type: 'edit' };
      return;
    }
    event.preventDefault();
    this.element.setPointerCapture(event.pointerId);
    const boardPoint = this.viewport.boardPoint(event);
    if (block && event.target.closest('.text-handle')) {
      this.text.startDrag(block.dataset.id, event);
      this.gesture = { type: 'text-drag' };
    } else if (tool === 'text') {
      this.gesture = { type: 'tap', start: point, moved: false, id: block?.dataset.id };
    } else {
      this.text.deselect();
      if (this.viewport.contains(boardPoint)) {
        this.drawing.begin(boardPoint, size, tool === 'eraser', color);
        this.gesture = { type: 'draw' };
      }
    }
  }

  startNavigation() {
    const ids = [...this.pointers.keys()].slice(0, 2);
    this.gesture = {
      type: 'navigate', ids,
      start: touchPair(ids.map(id => this.pointers.get(id))),
      camera: { ...this.viewport.camera },
    };
  }

  move(event) {
    if (!this.pointers.has(event.pointerId)) return;
    const point = this.viewport.point(event);
    this.pointers.set(event.pointerId, point);
    const gesture = this.gesture;
    if (!gesture || gesture.type === 'edit') return;
    event.preventDefault();
    if (this.navigating) {
      if (this.pointers.size < 2) return;
      const current = touchPair(gesture.ids.map(id => this.pointers.get(id)));
      this.viewport.camera = pinchCamera(gesture.camera, gesture.start, current, this.viewport.minimumScale());
      this.viewport.render();
    } else if (gesture.type === 'draw') {
      const samples = event.getCoalescedEvents?.();
      for (const sample of samples?.length ? samples : [event]) this.drawing.move(this.viewport.boardPoint(sample));
    } else if (gesture.type === 'text-drag') this.text.moveDrag(event);
    else if (gesture.type === 'tap' && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > TAP_SLOP) {
      gesture.moved = true;
    }
  }

  up(event) {
    if (!this.pointers.has(event.pointerId)) return;
    const canceled = event.type !== 'pointerup';
    const gesture = this.gesture;
    this.pointers.delete(event.pointerId);
    if (!this.navigating) {
      if (gesture?.type === 'draw') {
        if (canceled) this.drawing.cancel();
        else {
          this.drawing.move(this.viewport.boardPoint(event));
          this.drawing.finish();
          this.options.changed();
        }
      } else if (gesture?.type === 'text-drag') this.text.endDrag(canceled);
      else if (gesture?.type === 'tap' && !canceled && !gesture.moved &&
          Math.hypot(this.viewport.point(event).x - gesture.start.x, this.viewport.point(event).y - gesture.start.y) <= TAP_SLOP) {
        event.preventDefault();
        const point = this.viewport.boardPoint(event);
        if (gesture.id) this.text.edit(gesture.id);
        else {
          this.text.deselect();
          if (this.viewport.contains(point)) this.text.create(point, this.options.tool().size);
        }
      }
    }
    if (!this.pointers.size) {
      this.gesture = null;
      this.navigating = false;
    } else if (this.navigating && this.pointers.size >= 2) this.startNavigation();
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId);
  }

  cancel() {
    if (!this.active) return;
    this.drawing.cancel();
    this.text.endDrag(true);
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.gesture = null;
    this.navigating = false;
    for (const id of ids) if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id);
  }
}
