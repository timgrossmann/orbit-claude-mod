import { pixelFrame, base64 } from './pixels.js';
import { WIDTH } from '../game/simulation.js';

const GLYPHS = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b,
  0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588];
const distance = (a, b) => ((a >>> 16) - (b >>> 16)) ** 2 +
  2 * (((a >>> 8) & 255) - ((b >>> 8) & 255)) ** 2 + ((a & 255) - (b & 255)) ** 2;

export function encodeQuadrants(pixels, columns, rows) {
  const bytes = new Uint8Array(columns * rows * 12), data = new DataView(bytes.buffer);
  for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
    const at = y * 2 * columns * 2 + x * 2;
    const background = pixels[at], right = pixels[at + 1];
    const bottom = pixels[at + columns * 2], corner = pixels[at + columns * 2 + 1];
    const address = (y * columns + x) * 12;
    // Most forest cells are flat colors. No palette search or allocations needed.
    if (background === right && background === bottom && background === corner) {
      data.setUint32(address, 0x20, true); data.setUint32(address + 4, background, true);
      data.setUint32(address + 8, background, true); continue;
    }
    const cell = [background, right, bottom, corner];
    // Anchor the background to the upper-left pixel. This avoids a detached
    // upper half-block at horizontal edges in fonts with extra line spacing.
    let foreground = background, mask = 0, best = Infinity;
    for (const candidate of new Set(cell)) {
      let error = 0, bits = 0;
      for (let q = 0; q < 4; q++) {
        const back = distance(cell[q], background), front = distance(cell[q], candidate);
        if (front < back) { bits |= 1 << q; error += front; } else error += back;
      }
      if (error < best) { best = error; mask = bits; foreground = candidate; }
    }
    data.setUint32(address, GLYPHS[mask], true); data.setUint32(address + 4, foreground, true);
    data.setUint32(address + 8, background, true);
  }
  return { columns, rows, cells: base64(bytes) };
}

export function terminalFrame(game, columns, rows) {
  columns = Number.isFinite(columns) ? Math.max(1, Math.min(100, Math.floor(columns))) : 1;
  rows = Number.isFinite(rows) ? Math.max(1, Math.min(90, Math.floor(rows))) : 1;
  return encodeQuadrants(pixelFrame(game, columns * 2, rows * 2, { gateGrid: WIDTH / columns }).pixels, columns, rows);
}
