import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, WIDTH } from '../game/simulation.js';
import { pixelFrame, imageFrame } from '../render/pixels.js';
import { terminalFrame, encodeQuadrants } from '../render/terminal.js';
import { WORLDS } from '../game/catalog.js';

const glyphs = [0x20, 0x2598, 0x259d, 0x2580, 0x2596, 0x258c, 0x259e, 0x259b,
  0x2597, 0x259a, 0x2590, 0x259c, 0x2584, 0x2599, 0x259f, 0x2588];
function decode(frame) {
  const bytes = Buffer.from(frame.cells, 'base64'), pixels = new Uint32Array(frame.columns * frame.rows * 4);
  for (let y = 0; y < frame.rows; y++) for (let x = 0; x < frame.columns; x++) {
    const at = (y * frame.columns + x) * 12, mask = glyphs.indexOf(bytes.readUInt32LE(at));
    assert.ok(mask >= 0);
    for (let q = 0; q < 4; q++) pixels[(y * 2 + (q >> 1)) * frame.columns * 2 + x * 2 + (q & 1)] =
      bytes.readUInt32LE(at + (mask & (1 << q) ? 4 : 8));
  }
  return pixels;
}

test('quadrants preserve all sixteen arrangements of four two-color pixels', () => {
  for (let mask = 0; mask < 16; mask++) {
    const pixels = Uint32Array.from([0, 1, 2, 3].map(bit => mask & (1 << bit) ? 0xffffff : 0x112233));
    assert.deepEqual(decode(encodeQuadrants(pixels, 1, 1)), pixels);
  }
});

test('moving bars have straight sides even when block glyphs leave space between text rows', () => {
  for (const world of Object.keys(WORLDS)) for (const columns of [24, 36, 60, 76]) {
    const game = createGame(0, { world });
    game.gates = [{ x: 150, width: 47, top: 215, bottom: 475 }];
    const colors = [WORLDS[world].branch, WORLDS[world].bark];
    for (let camera = 0; camera < 24; camera++) {
      game.camera = camera;
      const frame = terminalFrame(game, columns, 34), bytes = Buffer.from(frame.cells, 'base64');
      const pixels = decode(frame);
      // In the leading between glyph rows, only the cell background is visible.
      // Its bar silhouette must match both pixel columns drawn by the glyph.
      for (let row = 0; row < 8; row++) for (let col = 0; col < columns; col++) {
        const background = bytes.readUInt32LE((row * columns + col) * 12 + 8);
        for (let q = 0; q < 4; q++) {
          const color = pixels[(row * 2 + (q >> 1)) * columns * 2 + col * 2 + (q & 1)];
          assert.equal(colors.includes(background), colors.includes(color),
            `${world}: ${columns} columns, camera ${camera}, cell ${col},${row} leaves a bar tooth or notch`);
        }
      }
    }
  }
});

test('lower obstacles reach the last pixel at every supported drawing size and theme', () => {
  for (const world of Object.keys(WORLDS)) {
    const game = createGame(0, { world });
    game.gates = [{ x: 146, width: 47, top: 142, bottom: 374 }];
    const allowed = [WORLDS[world].branch, WORLDS[world].bark];
    for (const [columns, rows] of [[24, 22], [34, 33], [60, 57], [76, 72]]) {
      const frame = terminalFrame(game, columns, rows), pixels = decode(frame);
      const col = Math.floor(169 / WIDTH * frame.columns * 2);
      assert.ok(allowed.includes(pixels[(frame.rows * 2 - 1) * frame.columns * 2 + col]));
    }
    const frame = pixelFrame(game);
    assert.ok(allowed.includes(frame.pixels[(frame.height - 1) * frame.width + Math.floor(169 / WIDTH * frame.width)]));
  }
});

test('the native image contains actual opaque pixels and stays within the host limit', () => {
  const source = imageFrame(createGame());
  const rgba = Buffer.from(source.rgba, 'base64');
  assert.equal(rgba.length, source.width * source.height * 4);
  assert.ok(rgba.length < 2 * 1024 * 1024);
  assert.ok(source.width >= 160 && source.height >= 300);
  for (let at = 3; at < rgba.length; at += 4) assert.equal(rgba[at], 255);
});

test('sub-cell character motion produces intermediate drawings instead of whole-cell jumps', () => {
  const game = createGame(); game.gates = []; game.player.x = 100;
  const frames = new Set();
  for (let i = 0; i < 20; i++) {
    game.player.x += 2;
    frames.add(terminalFrame(game, 40, 38).cells);
  }
  assert.ok(frames.size >= 7, `only ${frames.size} distinct positions`);
});

test('all themes and companions have distinct pixel artwork without mutating state', () => {
  const frames = new Set();
  for (const world of Object.keys(WORLDS)) for (const character of ['pip', 'moss', 'ember']) {
    const game = createGame(0, { world, character }), before = structuredClone(game);
    frames.add(imageFrame(game).rgba);
    assert.deepEqual(game, before);
  }
  assert.equal(frames.size, 9);
});
