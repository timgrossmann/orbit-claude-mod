// Version links whenever course geometry or scoring rules change.
export const COURSE_VERSION = '6';
export const MEDALS = [
  { name: 'Bronze', score: 5, color: '#b76c3e' },
  { name: 'Silver', score: 10, color: '#778d91' },
  { name: 'Gold', score: 20, color: '#c19a37' },
  { name: 'Forest legend', score: 35, color: '#477259' },
];
export const dailyCourse = (date = new Date()) => date.toISOString().slice(0, 10);
export function safeBest(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 999999 ? n : 0;
}
function hash(text) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
}
export function gateShape(index, course = 'classic') {
  const difficulty = Math.min(1, Math.max(0, index - 1) / 8);
  let wave = index % 2 === 0 ? 1 : -1;
  if (course !== 'classic') {
    const patterns = [[1, -1, 1, -1, .5, -.5], [.65, 1, .25, -.65, -1, -.25], [-1, -.4, .5, 1, .4, -.5]];
    const section = hash(`${course}:${Math.floor(index / 6)}`);
    wave = patterns[section % patterns.length][index % 6] * (section % 2 ? 1 : -1);
  }
  return {
    center: 720 * .48 + wave * difficulty * 160,
    gap: 285 - difficulty * 95,
    spacing: 350 - difficulty * 30 + Math.sin(index * 3) * 28 * (1 - difficulty * .6),
  };
}
export function medalFor(score) { return MEDALS.findLast((medal) => score >= medal.score) || null; }
export function nextGoal(score, best, target) {
  const goals = MEDALS.map((medal) => ({ value: medal.score, label: `${medal.name} medal` }));
  if (best > 0) goals.push({ value: best + 1, label: 'Personal best' });
  if (target !== null) goals.unshift({ value: target + 1, label: 'Beat the challenge' });
  return goals.filter((g) => g.value > score).sort((a, b) => a.value - b.value)[0]
    || { value: (Math.floor(score / 10) + 1) * 10, label: 'Keep exploring' };
}
export function centeredCrossing(before, after, gate) {
  const mid = gate.x + gate.width / 2;
  if (before.x >= mid || after.x < mid) return null;
  const y = before.y + (after.y - before.y) * (mid - before.x) / (after.x - before.x);
  return Math.abs(y - (gate.top + gate.bottom) / 2) <= 28;
}
export function updateFlow(flow, perfect) {
  const streak = perfect ? flow.streak + 1 : 0;
  return { streak, longest: Math.max(flow.longest, streak), perfect: flow.perfect + Number(perfect) };
}
export function parseChallenge(search) {
  const p = new URLSearchParams(search);
  if (p.get('v') !== COURSE_VERSION || !/^(0|[1-9]\d{0,5})$/.test(p.get('beat') || '')) return null;
  const character = p.get('character') || 'pip';
  if (!['pip', 'moss', 'ember'].includes(character)) return null;
  let course = 'classic';
  if (p.get('run') === 'daily') {
    course = p.get('day') || '';
    const date = new Date(`${course}T00:00:00Z`);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(course) || !Number.isFinite(+date) || dailyCourse(date) !== course) return null;
  } else if (p.get('run') !== 'classic') return null;
  const world = ['amberwood', 'inkwild', 'wildwood'].includes(p.get('world')) ? p.get('world') : 'wildwood';
  return { course, target: Number(p.get('beat')), world, character };
}
export function challengeURL(base, { course, score, world, character = 'pip' }) {
  const url = new URL(base);
  url.search = ''; url.hash = '';
  url.searchParams.set('v', COURSE_VERSION);
  url.searchParams.set('run', course === 'classic' ? 'classic' : 'daily');
  if (course !== 'classic') url.searchParams.set('day', course);
  url.searchParams.set('beat', String(safeBest(score)));
  url.searchParams.set('world', world);
  url.searchParams.set('character', character);
  return url.href;
}
