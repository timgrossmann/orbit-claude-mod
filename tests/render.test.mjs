import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, advanceGame } from '../game/simulation.js';
import { layout, scene } from '../render/scene.js';
import { terminalFrame } from '../render/terminal.js';
import { desktopFrame } from '../render/desktop.js';

test('terminal frames encode opaque cells in the documented byte layout', () => {
  const game = createGame();
  const frame = terminalFrame(game, 24, 22);
  const bytes = Buffer.from(frame.cells, 'base64');
  assert.equal(bytes.length, 24 * 22 * 12);
  const colors = new Set();
  for (let i = 0; i < bytes.length; i += 12) {
    assert.ok(bytes.readUInt32LE(i) >= 0x20 && bytes.readUInt32LE(i) <= 0xffff);
    assert.ok(bytes.readUInt32LE(i + 4) <= 0xffffff);
    assert.ok(bytes.readUInt32LE(i + 8) <= 0xffffff);
    colors.add(bytes.readUInt32LE(i + 4)); colors.add(bytes.readUInt32LE(i + 8));
  }
  assert.ok(colors.has(0x26232b), 'Pip body is visible');
  assert.ok(colors.has(0xc64d34), 'Pip scarf is visible');
});

test('Desktop frames are self-contained SVG with moving geometry', () => {
  const game = createGame(); const ready = desktopFrame(game);
  act(game); advanceGame(game, .1); const playing = desktopFrame(game);
  assert.notEqual(playing, ready); assert.ok(playing.length < 131072);
  assert.doesNotMatch(playing, /NaN|Infinity|<script|https?:\/\/(?!www.w3.org)/);
  assert.match(playing, /viewBox="0 0 160 302"/);
});

test('the forest stays fixed as the camera follows gameplay', () => {
  const game = createGame(); game.gates = [];
  const raster = terminalFrame(game, 34, 33), svg = desktopFrame(game);
  for (const camera of [100, 999, 5000]) {
    game.camera = camera; game.player.x = 106.848 + camera;
    assert.deepEqual(terminalFrame(game, 34, 33), raster);
    assert.equal(desktopFrame(game), svg);
  }
});

test('drawing and resizing cannot change a run or its collision geometry', () => {
  const game = createGame(); act(game); advanceGame(game, .1);
  const before = structuredClone(game);
  for (const [columns, rows] of [[24, 22], [40, 38], [1, 1], [999999, 999999]]) {
    terminalFrame(game, columns, rows); desktopFrame(game); layout(columns, rows);
  }
  assert.deepEqual(game, before);
  const branch = scene(game).find(shape => shape.role === 'branch');
  if (branch) assert.equal(branch.width, 47);
});

test('tiny, invalid and huge layout inputs are bounded and request a readable size', () => {
  for (const size of [0, -1, NaN, Infinity]) assert.equal(layout(size, size).playable, false);
  assert.equal(layout(40, 40).playable, true);
  assert.equal(layout(12, 10).playable, false);
  const huge = layout(100000, 100000);
  assert.ok(huge.rows <= 90 && huge.columns <= 100);
});
