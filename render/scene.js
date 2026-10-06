import { WIDTH, HEIGHT } from '../game/simulation.js';
import { WORLDS, CHARACTERS, validWorld } from '../game/catalog.js';
import { sprite } from './sprites.js';

export const PALETTE = { ...WORLDS.wildwood, ink: 0x26232b, cream: 0xfff1cc, scarf: 0xc64d34 };
const bounded = (value, max) => Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
export function layout(columns, rows) {
  const available = bounded(columns, 100), height = Math.max(0, bounded(rows, 100) - 6);
  const sceneRows = Math.min(90, height, Math.floor(available * HEIGHT / WIDTH / 2));
  const sceneColumns = Math.floor(sceneRows * 2 * WIDTH / HEIGHT);
  return { columns: sceneColumns, rows: sceneRows, playable: sceneColumns >= 12 && sceneRows >= 14 };
}

export function scene(game, { actors = true, background = true, gateGrid = 0 } = {}) {
  const p = WORLDS[validWorld(game.world)], shapes = [];
  const rect = (x, y, width, height, color, role = '') => shapes.push({ type: 'rect', x, y, width, height, color, role });
  const ellipse = (x, y, rx, ry, color) => shapes.push({ type: 'ellipse', x, y, rx, ry, color });
  const poly = (points, color) => shapes.push({ type: 'poly', points, color });
  if (background) {
    rect(0, 0, WIDTH, HEIGHT, p.sky);
    ellipse(284, 118, 49, 49, p.sun);
    if (game.world === 'inkwild') ellipse(306, 102, 43, 43, p.sky);
    // Fixed layers: the camera moves through the course, never the backdrop.
    for (let i = -1; i < 6; i++) {
      const x = i * 92 + 15, top = 315 + Math.sin(i * 3) * 50;
      rect(x - 5, top + 60, 10, HEIGHT - top, p.distant);
      ellipse(x, top + 45, 44, 105, p.distant);
    }
    for (let i = -1; i < 5; i++) {
      const x = i * 116 + 32, top = 440 + Math.sin(i * 5) * 45;
      rect(x - 7, top + 70, 14, HEIGHT - top, p.leaves);
      if (game.world === 'amberwood') {
        for (let n = 0; n < 4; n++) poly([[x, top + n * 33 - 40], [x - 42 - n * 3, top + n * 33 + 50], [x + 42 + n * 3, top + n * 33 + 50]], p.leaves);
      } else {
        ellipse(x, top, 33, 51, p.leaves); ellipse(x - 16, top + 50, 40, 70, p.leaves);
        ellipse(x + 12, top + 93, 38, 60, p.leaves);
      }
      rect(x - 3, top + 100, 6, HEIGHT - top, p.tree);
    }
    rect(0, 665, WIDTH, 55, p.ground);
    for (let i = 0; i < 18; i++) {
      const x = (i * 67 + 17) % 382, y = 650 + (i * 29 % 54);
      rect(x, y, 5, 14, p.tree); rect(x + 5, y + 4, 7, 3, p.tree);
      if (i % 3 === 0) { rect(x + 1, y - 3, 6, 3, p.sun); rect(x - 2, y, 12, 3, p.sun); }
    }
  }
  for (const gate of game.gates) {
    // Text terminals need solid columns at moving edges: a half-column glyph
    // exposes the cell background in its line leading, making a comb-like edge.
    // Snap the whole gate and its details together; image/SVG keep exact pixels.
    const snap = value => gateGrid > 0 ? Math.round(value / gateGrid) * gateGrid : value;
    const x = snap(gate.x - game.camera), width = Math.max(gateGrid, snap(gate.width));
    if (x + width < 0 || x > WIDTH) continue;
    const bark = (offset, y, w, height) => {
      const left = Math.min(width, snap(offset));
      rect(x + left, y, Math.min(width - left, Math.max(gateGrid, snap(w))), height, p.bark);
    };
    rect(x, 0, width, gate.top, p.branch, 'branch');
    rect(x, gate.bottom, width, HEIGHT - gate.bottom, p.branch, 'branch');
    bark(5, 0, 5, gate.top);
    bark(5, gate.bottom, 5, HEIGHT - gate.bottom);
    rect(x, gate.top - 6, width, 6, p.bark);
    rect(x, gate.bottom, width, 6, p.bark);
    for (let y = 46; y < HEIGHT; y += 79) {
      if (y < gate.top - 20 || y > gate.bottom + 20) bark(26, y, 8, 3);
    }
  }
  if (!actors) return shapes;
  for (let i = 0; i < game.trail.length; i += 2) {
    const point = game.trail[i], size = 2 + i / game.trail.length * 3;
    rect(point.x - game.camera - size / 2, point.y - size / 2, size, size, p.trail);
  }
  const character = Object.hasOwn(CHARACTERS, game.character) ? game.character : 'pip';
  const mask = sprite(character), colors = [0, PALETTE.ink, PALETTE.cream, parseInt(CHARACTERS[character].scarf.slice(1), 16), 0x45414a];
  const unit = 3.2;
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const color = mask.pixels[y * mask.width + x];
    if (color && color !== 3) rect(game.player.x - game.camera + (x - mask.anchorX) * unit,
      game.player.y + (y - mask.anchorY) * unit, unit, unit, colors[color], 'sprite');
  }
  // Paint the narrow scarf as one strip so the rasterizer can preserve it
  // at low resolutions without making the authored character bulkier.
  const scarf = mask.scarf;
  rect(game.player.x - game.camera + (scarf.x - mask.anchorX) * unit,
    game.player.y + (scarf.y - mask.anchorY) * unit,
    scarf.width * unit, scarf.height * unit, colors[3], 'scarf');
  return shapes;
}
