import { advance, flip, circleHitsRect } from '../vendor/physics.js';
import { gateShape } from '../vendor/progression.js';
import { CHARACTERS } from '../vendor/discovery.js';
import { validWorld } from './catalog.js';

export const WIDTH = 381.6, HEIGHT = 720, STEP = 1 / 120;
export function validBest(value) {
  return Number.isInteger(value) && value >= 0 && value <= 999999 ? value : 0;
}

export function createGame(best = 0, options = {}) {
  const character = Object.hasOwn(CHARACTERS, options.character) ? options.character : 'pip';
  const companion = CHARACTERS[character];
  const player = { x: WIDTH * .28, y: HEIGHT * .48, heading: -.48, turn: 1,
    speed: 200 * companion.pace, radius: companion.radius, weight: companion.weight, hitRadius: 14 };
  const game = { phase: 'ready', player, gates: [], camera: 0, score: 0, best: validBest(best),
    character, world: validWorld(options.world),
    elapsed: 0, accumulator: 0, trail: [], trailTime: 0, gateIndex: 0,
    nextGate: player.x + 335, reason: '', taps: 0 };
  spawnGates(game);
  return game;
}

export function restart(game) {
  Object.assign(game, createGame(game.best, game));
  game.phase = 'playing';
}

export function act(game) {
  if (game.phase === 'ready' || game.phase === 'dead') restart(game);
  else if (game.phase === 'paused') {
    game.phase = 'playing'; game.reason = ''; game.accumulator = 0;
  } else { flip(game.player); game.taps++; }
}

export function pause(game, reason = 'Take your time.') {
  if (game.phase !== 'playing') return;
  game.phase = 'paused'; game.reason = reason; game.accumulator = 0;
}

function die(game, reason) {
  game.phase = 'dead'; game.reason = reason;
  game.best = Math.max(game.best, game.score); game.accumulator = 0;
}

function spawnGates(game) {
  while (game.nextGate < game.camera + WIDTH + 600) {
    const index = game.gateIndex++;
    const shape = gateShape(index, 'classic');
    game.gates.push({ x: game.nextGate, width: 47, top: shape.center - shape.gap / 2,
      bottom: shape.center + shape.gap / 2, passed: false, index });
    game.nextGate += shape.spacing;
  }
  game.gates = game.gates.filter(g => g.x + g.width > game.camera - 120);
}

function step(game, dt) {
  const p = game.player;
  game.elapsed += dt; advance(p, dt);
  game.camera = Math.max(game.camera + (67 + Math.min(25, game.score * 1.1)) * CHARACTERS[game.character].pace * dt,
    p.x - WIDTH * .35);
  if (p.x - game.camera < -p.hitRadius) { die(game, 'The forest got ahead of you.'); return; }
  if (p.y < p.hitRadius || p.y > HEIGHT - p.hitRadius) { die(game, 'You wandered out of the clearing.'); return; }
  spawnGates(game);
  for (const gate of game.gates) {
    if (circleHitsRect(p.x, p.y, p.hitRadius, { x: gate.x, y: 0, width: gate.width, height: gate.top }) ||
        circleHitsRect(p.x, p.y, p.hitRadius, { x: gate.x, y: gate.bottom, width: gate.width, height: HEIGHT - gate.bottom })) {
      die(game, 'You met a branch.'); return;
    }
    if (!gate.passed && p.x - p.hitRadius > gate.x + gate.width) {
      gate.passed = true; game.score = Math.min(999999, game.score + 1);
    }
  }
  game.trailTime += dt;
  if (game.trailTime >= .025) {
    game.trailTime = 0; game.trail.push({ x: p.x, y: p.y });
    if (game.trail.length > 42) game.trail.shift();
  }
}

export function advanceGame(game, seconds) {
  if (game.phase !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return;
  game.accumulator += Math.min(seconds, .1);
  while (game.accumulator + 1e-12 >= STEP && game.phase === 'playing') {
    step(game, STEP);
    game.accumulator = Math.max(0, game.accumulator - STEP);
  }
}
