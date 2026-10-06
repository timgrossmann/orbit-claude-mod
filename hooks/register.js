import { createGame, act, pause, restart, advanceGame, validBest } from '../game/simulation.js';
import { CHARACTERS, WORLDS, validWorld } from '../game/catalog.js';
import { layout } from '../render/scene.js';
import { terminalFrame } from '../render/terminal.js';
import { desktopFrame } from '../render/desktop.js';
import { imageFrame } from '../render/pixels.js';
import { resultCard } from '../render/result.js';
import { createAudio } from '../audio/playback.js';

const PANE = 'orbit', PREFS = 'preferences-v2', AUDIO_PREFS = 'audio-v1', AUTO_PREFS = 'auto-open-v1';
const bestKey = character => `classic-${character}-v1`;
const bests = { pip: 0, moss: 0, ember: 0 };
let game = createGame(), opened = false, timer = null, busy = false, generation = 0;
let lastTime = 0, playable = false, focused = false, saveNotice = '', fault = '';
let saving = Promise.resolve(), mounted = null, graphics = 'cells', supportsImages = false;
let audioSettings = { music: true, effects: true }, audioNotice = '';
let interactive = false, autoEnabled = true, autoTimer = null, activeTurn = null, opening = null;
const audio = createAudio();

function syncAudio($) {
  audio.sync({
    play: (clip, options) => $.audio.play(clip, options),
    now: () => $.clock.now(),
    after: (ms, callback) => $.clock.after(ms, callback),
    unavailable: channels => {
      const label = channels.length === 2 ? 'Music and sounds' : channels[0] === 'music' ? 'Music' : 'Sounds';
      audioNotice = `${label} unavailable here. Toggle to retry.`;
      if (opened) $.ui.invalidate('ui.render');
    },
  }, game, { ...audioSettings, active: opened && focused && playable && !fault, now: lastTime });
}

function stop() {
  audio.stop();
  opening = null;
  generation++; timer?.cancel(); timer = null; busy = false; opened = false;
  focused = false; playable = false; lastTime = 0; mounted = null;
  bests[game.character] = Math.max(bests[game.character], game.best);
  game = createGame(bests[game.character], game);
}
async function loadBest($, version = generation) {
  const character = game.character;
  try {
    const saved = await $.store.get(bestKey(character));
    if (version !== generation || character !== game.character) return;
    bests[character] = Math.max(bests[character], validBest(saved));
    game.best = bests[character]; saveNotice = '';
  } catch { if (version === generation) saveNotice = 'Saved for this session only.'; }
}
async function loadPreferences($, version) {
  try {
    const saved = await $.store.get(PREFS);
    if (version !== generation || !saved || typeof saved !== 'object') return;
    const character = Object.hasOwn(CHARACTERS, saved.character) ? saved.character : 'pip';
    game = createGame(bests[character], { character, world: validWorld(saved.world) });
  } catch { if (version === generation) saveNotice = 'Saved for this session only.'; }
}
async function loadAudioPreferences($, version) {
  try {
    const saved = await $.store.get(AUDIO_PREFS);
    if (version !== generation || !saved || typeof saved !== 'object') return;
    audioSettings = { music: saved.music !== false, effects: saved.effects !== false };
  } catch { if (version === generation) saveNotice = 'Saved for this session only.'; }
}
async function loadAutoPreferences($, version) {
  try {
    const saved = await $.store.get(AUTO_PREFS);
    if (version === generation) autoEnabled = saved?.enabled !== false;
  } catch { if (version === generation) saveNotice = 'Saved for this session only.'; }
}
function cancelAutoOpen() {
  autoTimer?.cancel(); autoTimer = null; activeTurn = null;
  if (opening?.automaticTurn && !opened) stop();
}
async function persistBest($, character, score) {
  try {
    const stored = validBest(await $.store.get(bestKey(character)));
    const best = Math.max(stored, score, bests[character]);
    await $.store.set(bestKey(character), best);
    bests[character] = Math.max(bests[character], best);
    if (game.character === character) game.best = bests[character];
    saveNotice = '';
  } catch { saveNotice = 'Saved for this session only.'; }
  if (opened) $.ui.invalidate('ui.render');
}
async function persistPreferences($, preferences, key = PREFS) {
  try { await $.store.set(key, preferences); saveNotice = ''; }
  catch { saveNotice = 'Saved for this session only.'; }
  if (opened) $.ui.invalidate('ui.render');
}
async function detectGraphics($, version) {
  // Read only terminal identifiers; no file, process or network access.
  try {
    const program = await $.env.get('TERM_PROGRAM');
    const term = await $.env.get('TERM');
    const tmux = await $.env.get('TMUX');
    if (version !== generation) return;
    supportsImages = !tmux && (program === 'ghostty' || term === 'xterm-kitty');
    graphics = supportsImages ? 'pixels' : 'cells';
  } catch { if (version === generation) { supportsImages = false; graphics = 'cells'; } }
}
async function repaint($, version) {
  const target = mounted;
  if (!target) { $.ui.invalidate('ui.render'); return; }
  const content = target.kind === 'Image' ? { source: imageFrame(game) } : terminalFrame(game, target.columns, target.rows);
  const result = await $.ui.blit({ requestId: PANE, key: 'forest', columns: target.columns, rows: target.rows, ...content });
  if (version !== generation || !opened || mounted !== target) return;
  if (result.deny) {
    if (target.kind === 'Image') graphics = 'cells';
    mounted = null; $.ui.invalidate('ui.render');
  }
}
function advanceTo($, now) {
  // Clock replies can finish out of order when a key arrives during a tick.
  // Apply each interval once, up to the input time, before changing curvature.
  const nextTime = Math.max(lastTime, now), before = game.phase;
  advanceGame(game, (nextTime - lastTime) / 1000); lastTime = nextTime;
  syncAudio($);
  if (before === 'playing' && game.phase === 'dead') {
    const character = game.character, best = game.best;
    bests[character] = Math.max(bests[character], best);
    saving = saving.then(() => persistBest($, character, best));
  }
}
async function tick($) {
  if (busy || !opened) return;
  busy = true;
  const version = generation;
  try {
    const [now, panes] = await Promise.all([$.clock.now(), $.ui.panes()]);
    if (version !== generation || !opened) return;
    const pane = panes.find(p => p.id === PANE), before = game.phase, score = game.score;
    if (!pane?.isShown || !pane?.isFocused || !playable) pause(game, 'Paused while you work.');
    focused = Boolean(pane?.isShown && pane?.isFocused);
    advanceTo($, now);
    if (game.phase !== before || game.score !== score) $.ui.invalidate('ui.render');
    else if (game.phase === 'playing') await repaint($, version);
  } catch {
    if (version === generation) {
      pause(game, 'Game paused.'); fault = 'Could not update the pane. Close and reopen /orbit.';
      audio.stop();
      timer?.cancel(); timer = null; $.ui.invalidate('ui.render');
    }
  } finally { if (version === generation) busy = false; }
}
async function choose($, option) {
  if (!opened || !focused || (game.phase !== 'ready' && game.phase !== 'dead')) return;
  bests[game.character] = Math.max(bests[game.character], game.best);
  const keys = Object.keys(option === 'character' ? CHARACTERS : WORLDS);
  const value = keys[(keys.indexOf(game[option]) + 1) % keys.length];
  const selected = { character: game.character, world: game.world, [option]: value };
  generation++; busy = false; mounted = null;
  const version = generation;
  game = createGame(bests[selected.character], selected);
  syncAudio($);
  await loadBest($, version);
  if (version !== generation || !opened) return;
  saving = saving.then(() => persistPreferences($, selected));
  await saving;
  if (version === generation && opened) $.ui.invalidate('ui.render');
}
async function control($, action) {
  if (!opened || !playable || !focused || fault) return;
  const requestedPhase = game.phase;
  const version = generation, now = await $.clock.now();
  if (version !== generation || !opened || !focused || !playable || fault) return;
  // Preserve the meaning of the press across its await: a pending flip is not
  // a retry or a resume if a tick or another control changed the phase first.
  if (game.phase !== requestedPhase) return;
  const before = game.phase, score = game.score;
  if (before === 'playing') {
    advanceTo($, now);
    // A flip arriving after a collision must show game over, not retry unseen.
    if (game.phase === 'dead') { $.ui.invalidate('ui.render'); return; }
  }
  if (action === 'primary') act(game);
  else if (action === 'pause') {
    if (game.phase === 'playing') pause(game);
    else if (game.phase === 'paused') act(game);
  } else if (action === 'restart' && (game.phase === 'paused' || game.phase === 'dead')) restart(game);
  else if (action === 'graphics' && supportsImages) { graphics = graphics === 'pixels' ? 'cells' : 'pixels'; mounted = null; }
  if (before !== 'playing' || game.phase !== 'playing') lastTime = Math.max(lastTime, now);
  syncAudio($);
  // A normal flip changes no controls or labels. Keep the existing Raster/Image
  // mounted and let the next fast frame show it without rebuilding the pane.
  if (before !== game.phase || game.score !== score || action === 'graphics') $.ui.invalidate('ui.render');
}
async function toggleAudio($, kind) {
  if (!opened || !focused) return;
  audioSettings = { ...audioSettings, [kind]: !audioSettings[kind] };
  audioNotice = ''; audio.retry(); syncAudio($);
  const selected = { ...audioSettings };
  $.ui.invalidate('ui.render');
  saving = saving.then(() => persistPreferences($, selected, AUDIO_PREFS));
  await saving;
}
async function closePane($) { cancelAutoOpen(); stop(); await $.ui.close({ id: PANE }); }

async function openPane($, automaticTurn = null) {
  if (automaticTurn && (activeTurn !== automaticTurn || opened || opening)) return {};
  if (!opened) { stop(); audio.reset(); fault = ''; audioNotice = ''; }
  const attempt = { automaticTurn }, version = generation;
  opening = attempt;
  const current = () => opening === attempt && version === generation && (!automaticTurn || activeTurn === automaticTurn);
  try {
    const surface = await $.session.surface();
    if (!current()) return {};
    if (surface !== 'terminal' && surface !== 'desktop') return automaticTurn ? {} : {
      text: 'ORBIT needs an interactive Claude Code terminal or the Code tab in Claude Desktop.',
    };
    if (!opened) {
      await loadBest($, version);
      if (!current()) return {};
      if (surface === 'terminal') await detectGraphics($, version);
      if (!current()) return {};
      const now = await $.clock.now();
      if (!current()) return {};
      opened = true; lastTime = now;
    }
    // An automatic pane never asks for keyboard focus or begins a game.
    // Once requested while the turn is active, it stays available afterwards.
    await $.ui.open({ id: PANE, title: 'ORBIT', ...(!automaticTurn ? { focus: true } : {}), rows: 56, columns: 64 });
    if (opening !== attempt || version !== generation || !opened) return {};
    if (!timer) timer = $.clock.every(17, () => tick($));
    $.ui.invalidate('ui.render'); return {};
  } catch {
    if (opening === attempt && version === generation) stop();
    return automaticTurn ? {} : { text: 'Could not open ORBIT. Try /orbit again.' };
  } finally { if (opening === attempt) opening = null; }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    cancelAutoOpen();
    interactive = e.isInteractive && (e.surface === 'terminal' || e.surface === 'desktop');
    const version = generation;
    await loadPreferences($, version); await loadBest($, version); await loadAudioPreferences($, version); await loadAutoPreferences($, version);
    if (version !== generation) return next(e);
    await $.command.register({ name: 'orbit', description: 'Play ORBIT beside Claude — one key to flip your curve', argumentHint: '[auto on|off]' });
    return next(e);
  });
  on('turn.start', ($, e, next) => {
    cancelAutoOpen();
    if (interactive && autoEnabled && !opened && !opening) {
      const turn = { id: e.turnId }; activeTurn = turn;
      try {
        autoTimer = $.clock.after(30000, () => { autoTimer = null; return openPane($, turn); });
      } catch { cancelAutoOpen(); }
    }
    return next(e);
  });
  on('turn.complete', ($, e, next) => {
    if (!e.agentId && activeTurn?.id === e.turnId) cancelAutoOpen();
    return next(e);
  });
  on('command.run', { command: 'orbit' }, async ($, e) => {
    const args = (e.args ?? '').trim();
    if (args === 'auto on' || args === 'auto off') {
      autoEnabled = args === 'auto on'; cancelAutoOpen();
      const selected = { enabled: autoEnabled };
      saving = saving.then(() => persistPreferences($, selected, AUTO_PREFS));
      await saving;
      return { text: `ORBIT auto-open ${selected.enabled ? 'on: opens after 30 seconds on future turns' : 'off'}.${saveNotice ? ' Saved for this session only.' : ''}` };
    }
    if (args) return { text: 'Use /orbit to play, /orbit auto on, or /orbit auto off.' };
    cancelAutoOpen();
    return openPane($);
  });
  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    try {
      const wide = e.props.bodyColumns >= 34;
      const size = layout(e.props.bodyColumns, e.props.scroll.bodyRows - (wide ? 2 : 7));
      playable = size.playable; focused = e.props.isFocused;
      if (!focused || !playable) pause(game, 'Paused while you work.');
      syncAudio($);
      const close = Button({ key: 'close', label: 'Close x', hotkey: 'x', onPress: () => closePane($) });
      if (!playable || fault) {
        mounted = null;
        return Box({ flexDirection: 'column', children: [Text({ bold: true, children: ['ORBIT'] }),
          Text({ children: [fault || 'Please enlarge the pane to play.'] }), close] });
      }
      let picture; mounted = null;
      if (e.surface === 'terminal') {
        const { Raster, Image } = $.ui.resolve(e);
        if (graphics === 'pixels') {
          picture = Image({ key: 'forest', source: imageFrame(game), columns: size.columns, rows: size.rows,
            alt: 'ORBIT pixel view. Press v to switch to cells if the picture is unavailable.' });
          mounted = { kind: 'Image', ...size };
        } else {
          picture = Raster({ key: 'forest', ...terminalFrame(game, size.columns, size.rows) });
          mounted = { kind: 'Raster', ...size };
        }
      } else if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e);
        picture = Svg({ source: desktopFrame(game), alt: `${CHARACTERS[game.character].name} in ${WORLDS[game.world].name}. Score ${game.score}. ${game.phase}.`,
          width: size.columns * 8, height: size.rows * 16 });
      } else return Text({ children: ['ORBIT needs a Claude Code terminal or Claude Desktop.'] });
      const labels = { ready: 'Play', playing: 'Flip', paused: 'Resume', dead: 'One more try' };
      const primary = Button({ key: 'primary', label: `${labels[game.phase]} f`, hotkey: 'f', autoFocus: true,
        onPress: () => control($, 'primary') });
      const result = game.phase === 'dead' ? resultCard({ Box, Text }, game, size, primary) : null;
      if (result) {
        mounted = null;
        picture = Box({ width: size.columns, height: size.rows, position: 'relative',
          overflow: 'hidden', children: [picture, result.node] });
      }
      const controls = result?.hasRetry ? [] : [primary];
      if (game.phase === 'playing' || game.phase === 'paused') controls.push(Button({ key: 'pause',
        label: game.phase === 'paused' ? 'Resume p' : 'Pause p', hotkey: 'p', onPress: () => control($, 'pause') }));
      if (game.phase === 'paused' || game.phase === 'dead') controls.push(Button({ key: 'restart', label: 'Retry r', hotkey: 'r', onPress: () => control($, 'restart') }));
      if (e.surface === 'terminal' && supportsImages) controls.push(Button({ key: 'graphics', label: graphics === 'pixels' ? 'Cells v' : 'Pixels v', hotkey: 'v', onPress: () => control($, 'graphics') }));
      controls.push(close);
      const canChoose = game.phase === 'ready' || game.phase === 'dead';
      const choices = canChoose ? Box({ flexDirection: wide ? 'row' : 'column', columnGap: 1, children: [
        Button({ key: 'character', label: `${CHARACTERS[game.character].name} c`, hotkey: 'c', onPress: () => choose($, 'character') }),
        Button({ key: 'world', label: `${WORLDS[game.world].name} t`, hotkey: 't', onPress: () => choose($, 'world') }),
      ] }) : Box({ flexDirection: 'column', children: [Text({ dimColor: true, wrap: 'truncate', children: [`${CHARACTERS[game.character].name} · ${WORLDS[game.world].name}`] }),
        ...(!wide ? [Text({ children: [' '] })] : [])] });
      return Box({ flexDirection: 'column', children: [
        Text({ bold: true, wrap: 'truncate', children: ['ORBIT · PIXEL FOREST'] }),
        Text({ wrap: 'truncate', children: [`Score ${game.score}   Best ${game.best}`] }), choices,
        Box({ flexDirection: wide ? 'row' : 'column', columnGap: 1, children: [
          Button({ key: 'music', label: `Music ${audioSettings.music ? 'on' : 'off'} m`, hotkey: 'm', onPress: () => toggleAudio($, 'music') }),
          Button({ key: 'effects', label: `Sounds ${audioSettings.effects ? 'on' : 'off'} s`, hotkey: 's', onPress: () => toggleAudio($, 'effects') }),
        ] }), picture,
        Text({ wrap: 'truncate', children: [game.phase === 'ready' ? CHARACTERS[game.character].description : game.reason || 'Flip your curve. Find the gap.'] }),
        Box({ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', columnGap: 1, children: controls }),
        Text({ dimColor: true, wrap: 'truncate', children: [audioNotice || saveNotice || 'f flip · p pause · Esc back to Claude'] }),
      ] });
    } catch {
      pause(game, 'Game paused.'); fault = 'Could not draw the game. Close and reopen /orbit.';
      audio.stop();
      mounted = null; timer?.cancel(); timer = null;
      return Box({ flexDirection: 'column', children: [Text({ children: [fault] }), Button({ key: 'close', label: 'Close', onPress: () => closePane($) })] });
    }
  });
  on('ui.close', async ($, e, next) => { if (e.id === PANE) { cancelAutoOpen(); stop(); } return next(e); }).catch(($, e, next) => next(e));
  on('session.end', async ($, e, next) => { cancelAutoOpen(); stop(); return next(e); });
}
