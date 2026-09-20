export const BOARD_SIZE = 2048;
export const SIZES = { pencil: [2, 4, 8], eraser: [16, 32, 64], text: [24, 48, 72] };
export const FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
