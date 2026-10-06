import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, pause, restart, advanceGame, STEP } from '../game/simulation.js';
import { steer, SAMPLE_STEPS } from './helpers/pilot.js';

test('a flip preserves position and velocity heading, and reverses curvature', () => {
  const game = createGame(); act(game); advanceGame(game, .05);
  const before = { ...game.player }; act(game);
  assert.equal(game.player.turn, -before.turn);
  assert.equal(game.player.x, before.x); assert.equal(game.player.heading, before.heading);
  advanceGame(game, .05); assert.notEqual(game.player.x, before.x);
});

test('pause freezes the run and resuming does not flip or catch up', () => {
  const game = createGame(); act(game); advanceGame(game, .05);
  pause(game, 'Back to Claude'); const held = structuredClone(game);
  advanceGame(game, 10); assert.deepEqual(game, held);
  act(game); assert.equal(game.player.turn, held.player.turn);
  advanceGame(game, STEP); assert.ok(game.elapsed - held.elapsed < .009);
});

test('30 and 60 Hz render clocks produce the same simulation', () => {
  const a = createGame(), b = createGame(); act(a); act(b);
  for (let i = 0; i < 18; i++) advanceGame(a, 1 / 30);
  for (let i = 0; i < 36; i++) advanceGame(b, 1 / 60);
  assert.deepEqual(a.player, b.player); assert.equal(a.elapsed, b.elapsed);
});

test('long frames are bounded and invalid durations do not corrupt a run', () => {
  const a = createGame(), b = createGame(); act(a); act(b);
  advanceGame(a, 20); advanceGame(b, .1); assert.deepEqual(a, b);
  for (const invalid of [NaN, Infinity, -1]) advanceGame(a, invalid);
  assert.deepEqual(a, b);
});

test('a cleared gate scores once and a branch collision ends the run', () => {
  const game = createGame(); act(game);
  game.gates = [{ x: 50, width: 20, top: 100, bottom: 600, passed: false }];
  game.nextGate = 2000;
  advanceGame(game, STEP); assert.equal(game.score, 1);
  advanceGame(game, STEP); assert.equal(game.score, 1);
  game.gates = [{ x: game.player.x - 10, width: 47, top: 500, bottom: 600, passed: false }];
  advanceGame(game, STEP); assert.equal(game.phase, 'dead'); assert.equal(game.best, 1);
  const dead = structuredClone(game); advanceGame(game, .1); assert.deepEqual(game, dead);
});

test('leaving the clearing or falling behind the camera ends the run', () => {
  for (const kind of ['top', 'bottom', 'behind']) {
    const game = createGame(); act(game);
    if (kind === 'top') game.player.y = 1;
    if (kind === 'bottom') game.player.y = 719;
    if (kind === 'behind') game.camera = game.player.x + 30;
    advanceGame(game, STEP); assert.equal(game.phase, 'dead', kind);
  }
});

test('the death result celebrates a beaten best, never a tie, and resets on retry', () => {
  for (const [best, score, newBest] of [[7, 8, true], [7, 7, false], [7, 3, false], [0, 0, false]]) {
    const game = createGame(best); act(game); game.score = score;
    game.player.y = 1; advanceGame(game, STEP);
    assert.equal(game.phase, 'dead');
    assert.equal(game.newBest, newBest, `score ${score} against best ${best}`);
    assert.equal(game.best, Math.max(best, score));
    restart(game);
    assert.equal(game.newBest, false);
  }
});

test('retry restores the original course and retains only the best', () => {
  const game = createGame(8); act(game); advanceGame(game, .1); pause(game);
  restart(game);
  const fresh = createGame(8); act(fresh);
  assert.deepEqual(game, fresh);
});

test('malformed stored scores never become game state', () => {
  for (const value of [-1, Infinity, NaN, {}, '25', 1.5, 1000000]) assert.equal(createGame(value).best, 0);
  assert.equal(createGame(25).best, 25);
});

test('every companion uses its original movement and survives retry with its chosen world', () => {
  for (const [character, speed, radius, weight] of [
    ['pip', 216, 76, 0], ['moss', 172.8, 88, 20], ['ember', 259.2, 66, -10],
  ]) {
    const game = createGame(9, { character, world: 'amberwood' }); act(game);
    assert.equal(game.character, character); assert.equal(game.world, 'amberwood');
    assert.equal(game.player.speed, speed); assert.equal(game.player.radius, radius);
    assert.equal(game.player.weight, weight);
    advanceGame(game, .1); restart(game);
    assert.equal(game.character, character); assert.equal(game.world, 'amberwood');
    assert.equal(game.best, 9);
  }
});

test('the actual mod simulation permits twenty gates with bounded scene storage', () => {
  const game = createGame(); act(game);
  for (let tick = 0; tick < 15000 && game.phase === 'playing' && game.score < 20; tick++) {
    const gate = game.gates.find(g => !g.passed);
    if (tick % SAMPLE_STEPS === 0) steer(game.player, gate);
    advanceGame(game, STEP);
    assert.ok(game.trail.length <= 42); assert.ok(game.gates.length < 10);
  }
  assert.equal(game.score, 20, `${game.reason} at ${game.score}`);
});
