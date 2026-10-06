import { test, expect, mock } from 'claude-code/testing';

const props = { title: 'ORBIT', isFocused: true, bodyColumns: 40,
  placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} };

function host(on, surface = 'terminal', saved = 7) {
  const clock = mock.clock(on);
  const state = { shown: true, focused: true, opened: false, failRead: false, failWrite: false,
    saved, delayRead: false, scores: {}, preferences: undefined, audioPreferences: undefined, autoPreferences: undefined,
    opens: [],
    audio: [], failAudio: false, failMusic: false, skipAudio: false, activeAudio: 0, refusedAudio: 0,
    program: '', frames: [], denyImages: false, renders: 0 };
  on('session.start', ($, e) => ({ cwd: e.cwd }));
  on('session.end', () => ({ sessionId: 'test' }));
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  on('turn.complete', ($, e) => ({ text: e.answer }));
  on('session.surface', () => ({ value: surface }));
  on('env.get', ($, e) => ({ value: e.name === 'TERM_PROGRAM' ? state.program : undefined }));
  // Playback is an external host boundary. Keep loop promises pending until
  // the mod cancels them, just like the real player, without making test noise.
  on('audio.play', async ($, e, next) => {
    if (state.activeAudio >= 4) {
      state.refusedAudio++;
      throw new Error('refused: 4 plays are going at once');
    }
    state.activeAudio++;
    state.audio.push({ ...e, signal: next.signal });
    try {
      if (state.failAudio || (state.failMusic && e.shouldLoop)) throw new Error('audio device unavailable');
      if (!state.skipAudio && !next.signal.aborted) {
        const stopped = new Promise(resolve => next.signal.addEventListener('abort', resolve, { once: true }));
        const duration = { start: 600, flip: 120, score: 400, death: 900, best: 900, select: 300, warn: 400 }[e.clip.asset?.split('.').at(-2)] ?? 1000;
        await (e.shouldLoop ? stopped : Promise.race([stopped, clock.sleep(duration)]));
      }
      return { value: undefined };
    } finally { state.activeAudio--; }
  });
  // The native runner validates Image/Raster mounts but has no ui.blit implementation.
  on('ui.blit', ($, e) => { state.frames.push(e); return { value: state.denyImages && e.source ? { deny: 'images unavailable' } : {} }; });
  on('command.register', ($, e) => ({ value: { command: e.name } }));
  on('ui.open', ($, e) => { state.opened = true; state.opens.push(e); return { value: { isPlaced: true } }; });
  on('ui.close', () => { state.opened = false; return { value: undefined }; });
  on('ui.panes', async () => {
    const value = state.opened ? [{ id: 'orbit', title: 'ORBIT', isShown: state.shown,
      isFocused: state.focused, isPlaced: true }] : [];
    if (state.delayRead) { state.delayRead = false; await clock.sleep(100); }
    return { value };
  });
  on('store.get', ($, e) => { if (state.failRead) throw new Error('read-only disk'); return {
    value: e.key === 'preferences-v2' ? state.preferences : e.key === 'audio-v1' ? state.audioPreferences : e.key === 'auto-open-v1' ? state.autoPreferences : state.scores[e.key] ?? (e.key === 'classic-pip-v1' ? state.saved : 0),
  }; });
  on('store.set', ($, e) => {
    if (state.failWrite) throw new Error('disk full');
    if (e.key === 'preferences-v2') state.preferences = e.value;
    else if (e.key === 'audio-v1') state.audioPreferences = e.value;
    else if (e.key === 'auto-open-v1') state.autoPreferences = e.value;
    else state.scores[e.key] = e.value;
    return { value: undefined };
  });
  return { clock, state };
}

async function start($, surface = 'terminal') {
  await $.session.start({ cwd: '/tmp', surface, isInteractive: true });
  return $.command.run({ command: 'orbit', args: '', origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 140 } });
}
const mount = ($, surface = 'terminal', nextProps = props) => $.ui.mount({ plugin: 'orbit', surface,
  component: 'Pane', requestId: 'orbit', props: nextProps, viewport: { columns: 140, rows: 50 } });

for (const surface of ['terminal', 'desktop']) test(`${surface}: play, pause, resume, retry and close through native controls`, async ($, on) => {
  const { clock } = host(on, surface);
  await start($, surface); const ui = await mount($, surface);
  expect(await ui.find({ type: surface === 'terminal' ? 'Raster' : 'Svg' })).toBeDefined();
  expect(await ui.find({ text: /Best 7/ })).toBeDefined();
  await ui.press({ key: 'primary' });
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
  const first = await ui.drawn(); await clock.advance(102); await ui.redraw(props);
  expect(await ui.drawn()).not.toEqual(first);
  await ui.press({ key: 'pause' }); const held = await ui.drawn();
  await clock.advance(340); expect(await ui.drawn()).toEqual(held);
  await ui.press({ key: 'primary' });
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
  await ui.press({ key: 'pause' }); await ui.press({ key: 'restart' });
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
  await ui.press({ key: 'close' }); await ui.unmount();
  await clock.advance(340);
  await $.command.run({ command: 'orbit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } });
  const reopened = await mount($, surface);
  expect((await reopened.find({ key: 'primary' }))?.text).toMatch(/Play/);
});

for (const surface of ['terminal', 'desktop']) test(`${surface}: a long turn opens Orbit after 30 seconds without focus or sound`, async ($, on) => {
  const { clock, state } = host(on, surface);
  await $.session.start({ cwd: '/tmp', surface, isInteractive: true });
  await $.turn.start({ turnId: 'slow', text: 'work' });
  await clock.advance(29999); expect(state.opens.length).toBe(0);
  await clock.advance(1); expect(state.opens.length).toBe(1);
  expect(state.opens[0].focus).toBeUndefined();
  const ui = await mount($, surface, { ...props, isFocused: false });
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Play/);
  expect(state.audio.length).toBe(0);
  await clock.advance(30000); expect(state.opens.length).toBe(1);
  await $.session.end({ reason: 'clear' });
});

for (const reason of ['answer', 'aborted', 'error']) test(`${reason}: a completed turn cancels the delayed opening`, async ($, on) => {
  const { clock, state } = host(on);
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true });
  await $.turn.start({ turnId: 'short', text: 'work' }); await clock.advance(1000);
  await $.turn.complete({ turnId: 'short', answer: '', durationMs: 1000, isAborted: reason === 'aborted', reason });
  await clock.advance(30000); expect(state.opens.length).toBe(0);
});

test('closing a long-turn pane suppresses reopening until the next main turn', async ($, on) => {
  const { clock, state } = host(on);
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true });
  await $.turn.start({ turnId: 'first', text: 'work' }); await clock.advance(30000);
  expect(state.opens.length).toBe(1);
  const ui = await mount($); await ui.press({ key: 'close' });
  await clock.advance(60000); expect(state.opens.length).toBe(1);
  await $.turn.start({ turnId: 'second', text: 'work' });
  await $.turn.complete({ turnId: 'first', answer: '', durationMs: 90000, isAborted: false, reason: 'answer' });
  await $.turn.complete({ turnId: 'second', agentId: 'child', answer: '', durationMs: 100, isAborted: false, reason: 'answer' });
  await clock.advance(30000); expect(state.opens.length).toBe(2);
  await $.session.end({ reason: 'clear' });
});

test('auto-open can be disabled persistently without disabling manual play', async ($, on) => {
  const { clock, state } = host(on); state.autoPreferences = { enabled: false };
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true });
  await $.turn.start({ turnId: 'disabled', text: 'work' }); await clock.advance(30000);
  expect(state.opens.length).toBe(0);
  const command = args => $.command.run({ command: 'orbit', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } });
  await command('auto on'); expect(state.autoPreferences).toEqual({ enabled: true });
  expect(state.opens.length).toBe(0);
  await $.turn.start({ turnId: 'enabled', text: 'work' }); await clock.advance(1000);
  await command('auto off'); expect(state.autoPreferences).toEqual({ enabled: false });
  await clock.advance(30000); expect(state.opens.length).toBe(0);
  await command(''); expect(state.opens.length).toBe(1); expect(state.opens[0].focus).toBe(true);
  await $.session.end({ reason: 'clear' });
});

test('headless work and a cleared session cannot auto-open a pane', async ($, on) => {
  const { clock, state } = host(on, null);
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false });
  await $.turn.start({ turnId: 'headless', text: 'work' }); await clock.advance(30000);
  expect(state.opens.length).toBe(0);
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true });
  await $.turn.start({ turnId: 'cleared', text: 'work' }); await $.session.end({ reason: 'clear' });
  await clock.advance(30000); expect(state.opens.length).toBe(0);
});

test('returning to the prompt or hiding the pane pauses without an automatic resume', async ($, on) => {
  const { clock, state } = host(on); await start($); const ui = await mount($);
  await ui.press({ key: 'primary' }); await clock.advance(68);
  state.focused = false; await ui.redraw({ ...props, isFocused: false });
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Resume/);
  const held = await ui.drawn(); await clock.advance(340); expect(await ui.drawn()).toEqual(held);
  state.focused = true; await ui.redraw(props); await clock.advance(68);
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Resume/);
  await ui.press({ key: 'primary' }); state.shown = false; await clock.advance(68);
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Resume/);
});

test('tiny viewports pause and cannot start a hidden game', async ($, on) => {
  const { clock } = host(on); await start($); const ui = await mount($);
  await ui.press({ key: 'primary' });
  await ui.redraw({ ...props, bodyColumns: 8, scroll: { offset: 0, bodyRows: 10 } });
  expect(await ui.find({ text: /enlarge/i })).toBeDefined();
  expect(await ui.find({ key: 'primary' })).toBeUndefined();
  await clock.advance(340); await ui.redraw(props);
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Resume/);
});

test('read failure is visible and leaves a playable game', async ($, on) => {
  const { state } = host(on); state.failRead = true;
  await start($); const ui = await mount($);
  expect(await ui.find({ text: /session only/i })).toBeDefined();
  await ui.press({ key: 'primary' }); expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
});

test('a failed score save leaves retry usable and reports the limitation', async ($, on) => {
  const { clock, state } = host(on); state.failWrite = true;
  await start($); const ui = await mount($); await ui.press({ key: 'primary' });
  await clock.advance(12000);
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Retry/);
  expect(await ui.find({ text: /session only/i })).toBeDefined();
  await ui.press({ key: 'primary' }); expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
});

test('corrupt saved values are discarded and ready views do not animate', async ($, on) => {
  const { clock } = host(on, 'terminal', { wrong: 'value' });
  await start($); const ui = await mount($); expect(await ui.find({ text: /Best 0/ })).toBeDefined();
  const ready = await ui.drawn(); await clock.advance(500); expect(await ui.drawn()).toEqual(ready);
});

test('headless command explains supported surfaces', async ($, on) => {
  host(on, null); const result = await start($, null);
  expect(result.text).toMatch(/terminal.*Desktop/);
});

test('session clear releases the old game and opening works again', async ($, on) => {
  const { clock } = host(on); await start($); const ui = await mount($); await ui.press({ key: 'primary' });
  await $.session.end({ reason: 'clear' }); await ui.unmount(); await clock.advance(340);
  await $.command.run({ command: 'orbit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } });
  const reopened = await mount($); expect((await reopened.find({ key: 'primary' }))?.text).toMatch(/Play/);
  await reopened.press({ key: 'primary' }); const first = await reopened.drawn(); await clock.advance(102); await reopened.redraw(props);
  expect(await reopened.drawn()).not.toEqual(first);
});

test('a timer finishing after close and reopen cannot mutate the fresh game', async ($, on) => {
  const { clock, state } = host(on); await start($); const ui = await mount($); await ui.press({ key: 'primary' });
  state.delayRead = true;
  await clock.advance(34);
  await ui.press({ key: 'close' });
  await $.command.run({ command: 'orbit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } });
  await clock.advance(204);
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Play/);
});

test('unrelated panes pass through to the host', async ($, on) => {
  host(on); on('ui.render', ($, e) => ({ type: 'Text', props: {}, children: ['Another pane'] }));
  const ui = await $.ui.mount({ plugin: 'orbit', surface: 'terminal', component: 'Pane', requestId: 'other', props });
  expect(await ui.find({ text: 'Another pane' })).toBeDefined();
});

test('native selectors expose all companions and worlds, preserve choices and separate bests', async ($, on) => {
  const { state } = host(on); await start($); const ui = await mount($);
  await ui.press({ key: 'character' });
  expect(await ui.find({ text: /Moss/ })).toBeDefined();
  expect(await ui.find({ text: /Best 0/ })).toBeDefined();
  await ui.press({ key: 'world' });
  expect(await ui.find({ text: /Amberwood/ })).toBeDefined();
  await ui.press({ key: 'character' }); await ui.press({ key: 'world' });
  expect(await ui.find({ text: /Ember/ })).toBeDefined();
  expect(await ui.find({ text: /Inkwild/ })).toBeDefined();
  await ui.press({ key: 'close' });
  await $.command.run({ command: 'orbit', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } });
  expect(await ui.find({ text: /Ember/ })).toBeDefined();
  await ui.press({ key: 'character' });
  expect(await ui.find({ text: /Best 7/ })).toBeDefined();
  expect(state.preferences?.world).toBe('inkwild');
});

test('playing emits paint requests every 17 ms and stops them when paused', async ($, on) => {
  const { clock, state } = host(on); await start($); const ui = await mount($);
  await ui.press({ key: 'primary' }); await clock.advance(340);
  expect(state.frames.length).toBeGreaterThanOrEqual(18);
  expect(state.frames[0].cells).not.toEqual(state.frames.at(-1).cells);
  await ui.press({ key: 'pause' }); const count = state.frames.length;
  await clock.advance(340); expect(state.frames.length).toBe(count);
});

test('rapid flips keep the native pane mounted while fast frames continue', async ($, on) => {
  const { clock, state } = host(on);
  on('ui.render', ($, e, next) => { if (e.requestId === 'orbit') state.renders++; return next(e); });
  await start($); const ui = await mount($);
  await ui.press({ key: 'primary' }); const renders = state.renders;
  for (let i = 0; i < 8; i++) { await clock.advance(17); await ui.press({ key: 'primary' }); }
  expect(state.renders).toBe(renders);
  expect(state.frames.length).toBeGreaterThanOrEqual(7);
  expect(state.frames[0].cells).not.toEqual(state.frames.at(-1).cells);
});

test('compatible terminals get a real pixel image and can switch back to cells', async ($, on) => {
  const { state } = host(on); state.program = 'ghostty';
  await start($); const ui = await mount($);
  expect(await ui.find({ type: 'Image' })).toBeDefined();
  await ui.press({ key: 'graphics' });
  expect(await ui.find({ type: 'Raster' })).toBeDefined();
});


test('a denied native image paint falls back to a playable cell drawing', async ($, on) => {
  const { clock, state } = host(on); state.program = 'ghostty'; state.denyImages = true;
  await start($); const ui = await mount($); await ui.press({ key: 'primary' });
  await clock.advance(51);
  expect(await ui.find({ type: 'Raster' })).toBeDefined();
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
});

test('large panes use the extra cells while staying within native drawing limits', async ($, on) => {
  host(on); await start($);
  const ui = await mount($, 'terminal', { ...props, bodyColumns: 100, scroll: { offset: 0, bodyRows: 100 } });
  expect(await ui.find({ type: 'Raster' })).toBeDefined();
  expect(await ui.find({ text: /Could not draw/ })).toBeUndefined();
});

test('stored choices load safely with the selected companion best', async ($, on) => {
  const { state } = host(on);
  state.preferences = { character: 'moss', world: 'amberwood' };
  state.scores['classic-moss-v1'] = 12;
  await start($); const ui = await mount($);
  expect(await ui.find({ text: /Moss/ })).toBeDefined();
  expect(await ui.find({ text: /Amberwood/ })).toBeDefined();
  expect(await ui.find({ text: /Best 12/ })).toBeDefined();
});

for (const surface of ['terminal', 'desktop']) test(`${surface}: audio starts with play and stops on pause, focus loss and close`, async ($, on) => {
  const { clock, state } = host(on, surface);
  await start($, surface); const ui = await mount($, surface);
  expect(state.audio.length).toBe(0);
  await ui.press({ key: 'primary' });
  const loops = state.audio.filter(e => e.shouldLoop);
  expect(loops.map(e => e.clip.asset).sort()).toEqual(['assets/audio/ambience.wildwood.m4a', 'assets/audio/music.wildwood.m4a']);
  expect(state.audio.some(e => e.clip.asset === 'assets/audio/effect.start.m4a')).toBe(true);
  await clock.advance(68); await ui.press({ key: 'primary' });
  expect(state.audio.some(e => e.clip.asset === 'assets/audio/effect.flip.m4a')).toBe(true);
  await ui.press({ key: 'pause' });
  expect(loops.every(e => e.signal.aborted)).toBe(true);
  await ui.press({ key: 'primary' });
  expect(state.audio.filter(e => e.shouldLoop && !e.signal.aborted).length).toBe(2);
  state.focused = false; await ui.redraw({ ...props, isFocused: false });
  expect(state.audio.filter(e => e.shouldLoop && !e.signal.aborted).length).toBe(0);
  state.focused = true; await ui.redraw(props); await ui.press({ key: 'primary' });
  await ui.press({ key: 'close' });
  expect(state.audio.filter(e => e.shouldLoop).every(e => e.signal.aborted)).toBe(true);
});

test('music and effects preferences are independent, saved, and applied to the selected forest', async ($, on) => {
  const { state } = host(on);
  state.preferences = { character: 'moss', world: 'amberwood' };
  state.audioPreferences = { music: false, effects: true };
  await start($); const ui = await mount($); await ui.press({ key: 'primary' });
  expect(state.audio.some(e => e.shouldLoop)).toBe(false);
  expect(state.audio.some(e => e.clip.asset === 'assets/audio/effect.start.m4a')).toBe(true);
  await ui.press({ key: 'music' });
  expect(state.audio.filter(e => e.shouldLoop).map(e => e.clip.asset).sort()).toEqual(['assets/audio/ambience.amberwood.m4a', 'assets/audio/music.amberwood.m4a']);
  await ui.press({ key: 'effects' });
  const before = state.audio.length;
  await ui.press({ key: 'primary' }); expect(state.audio.length).toBe(before);
  expect(state.audioPreferences).toEqual({ music: true, effects: false });
  expect(state.preferences).toEqual({ character: 'moss', world: 'amberwood' });
  await ui.press({ key: 'close' });
});

for (const failure of ['failAudio', 'skipAudio']) for (const music of [true, false]) test(`${failure}, music ${music}: unavailable playback leaves the game responsive without repeated audio requests`, async ($, on) => {
  const { clock, state } = host(on); state[failure] = true;
  state.audioPreferences = { music, effects: true };
  await start($); const ui = await mount($); await ui.press({ key: 'primary' });
  await clock.advance(34);
  expect(await ui.find({ text: /Sounds unavailable/i })).toBeDefined();
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
  const attempts = state.audio.length;
  await clock.advance(102); await ui.press({ key: 'primary' });
  expect(state.audio.length).toBe(attempts);
  expect(state.frames.length).toBeGreaterThan(0);
  await ui.press({ key: 'close' });
});

test('rapid flips with music enabled stay within the native four-play limit', async ($, on) => {
  const { clock, state } = host(on); await start($); const ui = await mount($);
  await ui.press({ key: 'primary' });
  for (let i = 0; i < 4; i++) { await clock.advance(51); await ui.press({ key: 'primary' }); }
  expect(state.refusedAudio).toBe(0);
  expect(await ui.find({ text: /unavailable/i })).toBeUndefined();
  expect(state.audio.filter(e => e.shouldLoop && !e.signal.aborted).length).toBe(2);
  expect(state.audio.some(e => e.clip.asset === 'assets/audio/effect.flip.m4a')).toBe(true);
  await ui.press({ key: 'close' });
});

test('a music failure reports only music and leaves the flip sound working', async ($, on) => {
  const { clock, state } = host(on); state.failMusic = true;
  await start($); const ui = await mount($); await ui.press({ key: 'primary' });
  await clock.advance(51); await ui.press({ key: 'primary' });
  expect(await ui.find({ text: /Music unavailable/i })).toBeDefined();
  expect(state.audio.some(e => e.clip.asset === 'assets/audio/effect.flip.m4a')).toBe(true);
  expect((await ui.find({ key: 'primary' }))?.text).toMatch(/Flip/);
  await ui.press({ key: 'close' });
});

test('session end cancels music and game-over effects are emitted once', async ($, on) => {
  const { clock, state } = host(on); await start($); const ui = await mount($);
  await ui.press({ key: 'primary' }); await clock.advance(12000);
  expect(state.audio.filter(e => e.clip.asset === 'assets/audio/effect.death.m4a').length).toBe(1);
  expect(state.audio.filter(e => e.shouldLoop && !e.signal.aborted).length).toBe(0);
  await ui.press({ key: 'primary' }); await $.session.end({ reason: 'clear' });
  expect(state.audio.filter(e => e.shouldLoop).every(e => e.signal.aborted)).toBe(true);
});
