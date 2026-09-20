import { BOARD_SIZE } from './config.js';

const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function paintStroke(context, points, size, erase = false) {
  if (!points.length) return;
  context.save();
  context.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  context.strokeStyle = context.fillStyle = '#fff';
  context.lineWidth = size;
  context.lineCap = context.lineJoin = 'round';
  context.beginPath();
  const first = points[0];
  if (points.length === 1) {
    context.arc(first.x, first.y, size / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.moveTo(first.x, first.y);
    for (let i = 1; i < points.length - 1; i++) {
      const end = midpoint(points[i], points[i + 1]);
      context.quadraticCurveTo(points[i].x, points[i].y, end.x, end.y);
    }
    const last = points.at(-1);
    context.lineTo(last.x, last.y);
    context.stroke();
  }
  context.restore();
}

export function toPNG(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode drawing.')), 'image/png'));
}

export class Drawing {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = BOARD_SIZE;
    this.baseContext = this.base.getContext('2d');
    this.stroke = null;
    this.frame = 0;
  }

  begin(point, size, erase) {
    this.baseContext.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    this.baseContext.drawImage(this.canvas, 0, 0);
    this.stroke = { points: [point], size, erase };
    this.render();
  }

  move(point) {
    if (!this.stroke) return;
    const last = this.stroke.points.at(-1);
    if (Math.hypot(last.x - point.x, last.y - point.y) < .25) return;
    this.stroke.points.push(point);
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.render(); });
  }

  render() {
    if (!this.stroke) return;
    // Redraw only the active gesture over a snapshot, avoiding alpha buildup at segment joins.
    this.context.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    this.context.drawImage(this.base, 0, 0);
    paintStroke(this.context, this.stroke.points, this.stroke.size, this.stroke.erase);
  }

  finish() {
    if (!this.stroke) return false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.render();
    this.stroke = null;
    this.baseContext.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    return true;
  }

  cancel() {
    if (!this.stroke) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.context.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
    this.context.drawImage(this.base, 0, 0);
    this.stroke = null;
    this.baseContext.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE);
  }

  // A provisional finger stroke may turn into a pinch; never autosave it early.
  snapshot() { return toPNG(this.stroke ? this.base : this.canvas); }

  clear() { this.finish(); this.context.clearRect(0, 0, BOARD_SIZE, BOARD_SIZE); }

  async restore(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width !== BOARD_SIZE || bitmap.height !== BOARD_SIZE) throw new Error('Invalid drawing dimensions.');
      this.clear();
      this.context.drawImage(bitmap, 0, 0);
    } finally { bitmap.close(); }
  }
}
