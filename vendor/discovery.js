import { COURSE_VERSION, safeBest } from './progression.js';

// `weight` is a constant vertical pull in world units per second, positive sinks.
export const CHARACTERS = {
  pip: { name: 'Pip', pace: 1.08, radius: 76, scarf: '#c64d34', weight: 0, description: 'Steady · the original wanderer' },
  moss: { name: 'Moss', pace: .864, radius: 88, scarf: '#819660', weight: 20, description: 'Slower · larger circle · sinks' },
  ember: { name: 'Ember', pace: 1.296, radius: 66, scarf: '#e59b46', weight: -10, description: 'Faster · smaller circle · floats' },
};
export const DISCOVERIES = [
  { key: 'moss', at: 10, name: 'Moss', description: 'A slower companion' },
  { key: 'amberwood', at: 20, name: 'Amberwood', description: 'A warmer forest' },
  { key: 'daily', at: 35, name: 'Daily trail', description: 'A new trail each day' },
  { key: 'ember', at: 55, name: 'Ember', description: 'A faster companion' },
  { key: 'inkwild', at: 80, name: 'Inkwild', description: 'A quieter shade of forest' },
];
export function isUnlocked(key, total) {
  if (['pip', 'classic', 'wildwood'].includes(key)) return true;
  const discovery = DISCOVERIES.find(d => d.key === key);
  return Boolean(discovery && safeBest(total) >= discovery.at);
}
export const newDiscoveries = (before, after) => DISCOVERIES.filter(d => d.at > before && d.at <= after);
export const recordGap = (total, stored = 0) => Math.min(999999, Math.max(safeBest(total), safeBest(stored)) + 1);

export function resolveLoadout(request = {}, total = 0) {
  const character = Object.hasOwn(CHARACTERS, request.character) && isUnlocked(request.character, total) ? request.character : 'pip';
  const world = ['wildwood', 'amberwood', 'inkwild'].includes(request.world) && isUnlocked(request.world, total) ? request.world : 'wildwood';
  const course = request.course && request.course !== 'classic' && isUnlocked('daily', total) ? request.course : 'classic';
  const target = character === (request.character || 'pip') && course === (request.course || 'classic') ? request.target ?? null : null;
  return { character, world, course, target };
}
export function recordKey(course, character) {
  return `orbit-v${COURSE_VERSION}-best-${course}-${character}`;
}
