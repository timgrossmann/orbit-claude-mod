import { WIDTH, HEIGHT } from '../game/simulation.js';
import { scene } from './scene.js';
import { validWorld } from '../game/catalog.js';

export function base64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    result += alphabet[n >>> 18] + alphabet[(n >>> 12) & 63] +
      (i + 1 < bytes.length ? alphabet[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? alphabet[n & 63] : '=');
  }
  return result;
}
const backgrounds = new Map();
const bounded = (value, max) => Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : 1;
function paint(pixels, width, height, shapes) {
  const sx = width / WIDTH, sy = height / HEIGHT;
  const span = (y, left, right, color) => {
    if (y < 0 || y >= height) return;
    const x0 = Math.max(0, Math.round(left)), x1 = Math.min(width, Math.round(right));
    if (x1 > x0) pixels.fill(color, y * width + x0, y * width + x1);
  };
  for (const s of shapes) {
    if (s.type === 'rect') {
      const top = Math.round(s.y * sy), bottom = Math.round((s.y + s.height) * sy);
      // A thin scarf may fall entirely between raster rows. Keep one pixel of
      // color instead of enlarging the sprite to make the band survive sampling.
      const y0 = Math.max(0, top), y1 = Math.min(height, s.role === 'scarf' ? Math.max(top + 1, bottom) : bottom);
      for (let y = y0; y < y1; y++) span(y, s.x * sx, (s.x + s.width) * sx, s.color);
    } else if (s.type === 'ellipse') {
      const cy = s.y * sy, rx = s.rx * sx, ry = s.ry * sy;
      for (let y = Math.max(0, Math.floor(cy - ry)); y < Math.min(height, Math.ceil(cy + ry)); y++) {
        const d = (y + .5 - cy) / ry;
        if (Math.abs(d) <= 1) { const r = rx * Math.sqrt(1 - d * d); span(y, s.x * sx - r, s.x * sx + r, s.color); }
      }
    } else if (s.type === 'poly') {
      const points = s.points.map(([x, y]) => [x * sx, y * sy]);
      for (let y = Math.max(0, Math.floor(Math.min(...points.map(p => p[1])))); y < Math.min(height, Math.ceil(Math.max(...points.map(p => p[1])))); y++) {
        const intersections = [];
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const a = points[i], b = points[j], at = y + .5;
          if ((a[1] > at) !== (b[1] > at)) intersections.push(a[0] + (at - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        intersections.sort((a, b) => a - b);
        for (let i = 0; i + 1 < intersections.length; i += 2) span(y, intersections[i], intersections[i + 1], s.color);
      }
    }
  }
}

export function pixelFrame(game, width = 160, height = 302, { gateGrid = 0 } = {}) {
  width = bounded(width, 200); height = bounded(height, 360);
  const key = `${validWorld(game.world)}:${width}:${height}`;
  if (!backgrounds.has(key)) {
    const pixels = new Uint32Array(width * height);
    paint(pixels, width, height, scene({ ...game, gates: [] }, { actors: false }));
    if (backgrounds.size >= 6) backgrounds.delete(backgrounds.keys().next().value);
    backgrounds.set(key, pixels);
  }
  const pixels = backgrounds.get(key).slice();
  paint(pixels, width, height, scene(game, { background: false, gateGrid }));
  return { width, height, pixels };
}

export function imageFrame(game) {
  const { width, height, pixels } = pixelFrame(game);
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    rgba[i * 4] = pixels[i] >>> 16; rgba[i * 4 + 1] = pixels[i] >>> 8;
    rgba[i * 4 + 2] = pixels[i]; rgba[i * 4 + 3] = 255;
  }
  return { rgba: base64(rgba), width, height };
}
