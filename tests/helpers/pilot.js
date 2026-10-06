import { flip } from '../../vendor/physics.js';

// The reference controller: it sees only the next opening and decides whether to flip.
// The playability test drives whole courses with it, and the ready screen plays its demo
// with it, so what the demo shows is a line the physics really allow.
//
// The controller knows its companion's weight and aims above where the pull will carry it.
// `reach` is the horizontal distance to the opening, floored so that a companion already
// level with the gate still steers and the compensation never changes sign. The deadband
// keeps it from flipping over a difference it is already close enough to.
export const SAMPLE_STEPS = 8;
export const DEADBAND = 0.35;

export function steer(player, gate) {
  const reach = Math.max(105, gate.x + gate.width / 2 - player.x);
  const desiredY = (gate.top + gate.bottom) / 2 - player.weight * (reach / player.speed);
  const desired = Math.max(-1.05, Math.min(1.05, Math.atan2((desiredY - player.y) * 2, reach)));
  const delta = Math.atan2(Math.sin(desired - player.heading), Math.cos(desired - player.heading));
  if (Math.abs(delta) <= DEADBAND || player.turn === Math.sign(delta)) return false;
  flip(player);
  return true;
}
