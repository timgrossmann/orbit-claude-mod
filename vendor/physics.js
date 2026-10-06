// Constant-speed circular motion, integrated exactly rather than with Euler steps.
export function advance(p, seconds) {
  const angularSpeed = p.turn * p.speed / p.radius;
  const next = p.heading + angularSpeed * seconds;
  p.x += p.speed / angularSpeed * (Math.sin(next) - Math.sin(p.heading));
  p.y += p.speed / angularSpeed * (Math.cos(p.heading) - Math.cos(next));
  p.heading = next;
  // Heavier companions sink, lighter ones float: a constant pull added after the exact circular step.
  p.y += (p.weight || 0) * seconds;
}
export function flip(p) { p.turn *= -1; }
export function orbitCenter(p) {
  return { x: p.x - p.turn * p.radius * Math.sin(p.heading), y: p.y + p.turn * p.radius * Math.cos(p.heading) };
}
export function circleHitsRect(x, y, radius, rect) {
  const dx = x - Math.max(rect.x, Math.min(x, rect.x + rect.width));
  const dy = y - Math.max(rect.y, Math.min(y, rect.y + rect.height));
  return dx * dx + dy * dy <= radius * radius;
}
