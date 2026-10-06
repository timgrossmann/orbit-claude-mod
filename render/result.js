import { CHARACTERS, WORLDS } from '../game/catalog.js';

// Native text stays legible over the pixel forest on both surfaces. Keep the
// card inside the existing playfield so dying never pushes controls offscreen.
export function resultCard({ Box, Text }, game, size, retry) {
  const width = Math.min(38, size.columns - 2), inner = width - 4;
  const compact = width < 26 || size.rows < 20;
  const dark = game.world === 'inkwild';
  const paper = dark ? '#26322c' : '#f7f1df', ink = dark ? '#f2eedf' : '#253f36';
  const muted = dark ? '#bfccb9' : '#62715d';
  const text = (children, props = {}) => Text({ color: ink, wrap: 'wrap', ...props, children: [children] });
  const blank = () => text(' ');
  let children, height;
  if (compact) {
    const title = game.newBest ? 'New best!' : inner < 9 ? 'Oops.' : 'Too wild.';
    const score = `Score ${game.score}`, best = `Best ${game.best}`;
    children = [text(title, { bold: true }), blank(), text(score), text(best)];
    height = 5 + [title, score, best].reduce((rows, line) => rows + Math.ceil(line.length / inner), 0);
  } else {
    // Each reason is authored by the simulation; wrapping it explicitly keeps
    // the card's measured row count the same in Desktop and a text terminal.
    const lines = [''];
    for (const word of game.reason.split(' ')) {
      const last = lines.length - 1;
      if (lines[last] && lines[last].length + word.length + 1 > inner) lines.push(word);
      else lines[last] += (lines[last] ? ' ' : '') + word;
    }
    children = [
      text(game.newBest ? 'A NEW PERSONAL BEST' : `${WORLDS[game.world].name} · ${CHARACTERS[game.character].name}`, { color: muted }),
      blank(), text('A little\ntoo wild.', { bold: true }), blank(),
      ...lines.map(line => text(line, { color: muted })), blank(),
      text(`${game.score} ${game.score === 1 ? 'gap' : 'gaps'} cleared`, { bold: true }),
      text(`Personal best ${game.best}`, { color: muted }), blank(), retry,
    ];
    height = 14 + lines.length;
  }
  return {
    hasRetry: !compact,
    node: Box({ key: 'gameover', position: 'absolute',
      left: Math.floor((size.columns - width) / 2), top: Math.max(0, Math.floor((size.rows - height) / 2)),
      width, height, flexDirection: 'column', alignItems: 'center',
      paddingX: 1, paddingY: 1, borderStyle: 'round',
      borderColor: game.newBest ? '#c9944f' : muted, backgroundColor: paper, children }),
  };
}
