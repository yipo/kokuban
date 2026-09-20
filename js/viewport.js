import { BOARD_SIZE, clamp } from './config.js';

export function toBoard(point, camera) {
  return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale };
}

export function zoomAt(camera, point, scale) {
  const anchor = toBoard(point, camera);
  return { scale, x: point.x - anchor.x * scale, y: point.y - anchor.y * scale };
}

export function constrain(camera, width, height) {
  const extent = BOARD_SIZE * camera.scale;
  const visible = Math.min(64, extent, width, height);
  return { ...camera, x: clamp(camera.x, visible - extent, width - visible), y: clamp(camera.y, visible - extent, height - visible) };
}

export class Viewport {
  constructor(element, board, output) {
    this.element = element;
    this.board = board;
    this.output = output;
    this.width = element.clientWidth;
    this.height = element.clientHeight;
    const scale = Math.min(this.width, this.height) / 1024;
    this.camera = { scale, x: (this.width - BOARD_SIZE * scale) / 2, y: (this.height - BOARD_SIZE * scale) / 2 };
    this.render();
    element.addEventListener('wheel', event => {
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
      const scale = clamp(this.camera.scale * Math.exp(-event.deltaY * unit * .0015), this.minimumScale(), 8);
      this.camera = zoomAt(this.camera, this.point(event), scale);
      this.render();
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(element);
  }

  minimumScale() { return Math.min(this.width, this.height) / BOARD_SIZE; }

  point(event) {
    const bounds = this.element.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  boardPoint(event) { return toBoard(this.point(event), this.camera); }

  contains(point) {
    return point.x >= 0 && point.y >= 0 && point.x < BOARD_SIZE && point.y < BOARD_SIZE;
  }

  pan(dx, dy) {
    this.camera.x += dx;
    this.camera.y += dy;
    this.render();
  }

  resize() {
    const center = toBoard({ x: this.width / 2, y: this.height / 2 }, this.camera);
    this.width = this.element.clientWidth;
    this.height = this.element.clientHeight;
    this.camera.scale = clamp(this.camera.scale, this.minimumScale(), 8);
    this.camera.x = this.width / 2 - center.x * this.camera.scale;
    this.camera.y = this.height / 2 - center.y * this.camera.scale;
    this.render();
  }

  render() {
    this.camera = constrain(this.camera, this.width, this.height);
    const { x, y, scale } = this.camera;
    this.board.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.board.style.setProperty('--zoom', scale);
    this.output.value = `${Math.round(scale * 100)}%`;
  }
}
