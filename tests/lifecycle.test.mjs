import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, act, advanceGame } from '../game/simulation.js';
import { desktopFrame } from '../render/desktop.js';
import { terminalFrame } from '../render/terminal.js';

let instance = 0;
async function host(surface = 'desktop') {
  const { register } = await import(`../hooks/register.js?test=${instance++}`);
  const hooks = new Map(), timers = new Set(), delayed = new Set(), gates = new Map();
  const state = { now: 0, openCalls: 0, shown: false, invalidations: 0, frames: [] };
  async function boundary(name) {
    const gate = gates.get(name);
    if (gate) { gates.delete(name); gate.enter(); await gate.pending; }
  }
  const node = type => props => ({ type, props });
  const $ = {
    command: { register: async () => {} },
    session: { surface: async () => { await boundary('surface'); return surface; } },
    env: { get: async () => undefined },
    store: { get: async () => { await boundary('store'); return 0; }, set: async () => {} },
    clock: {
      now: async () => { const now = state.now; await boundary('clock'); return now; },
      every: (_ms, callback) => {
        timers.add(callback);
        return { cancel: () => timers.delete(callback) };
      },
      after: (_ms, callback) => { delayed.add(callback); return { cancel: () => delayed.delete(callback) }; },
    },
    ui: {
      open: async options => { state.openCalls++; state.lastOpen = options; state.shown = true; await boundary('open'); },
      close: async () => { state.shown = false; },
      panes: async () => state.shown ? [{ id: 'orbit', isShown: true, isFocused: true }] : [],
      invalidate: () => { state.invalidations++; },
      blit: async frame => { state.frames.push(frame); return {}; },
      resolve: () => Object.fromEntries(['Box', 'Text', 'Button', 'Svg', 'Raster'].map(type => [type, node(type)])),
    },
  };
  register((event, ...args) => { hooks.set(event, args.at(-1)); return { catch() {} }; });
  const run = (event, data = {}) => hooks.get(event)($, data, async () => ({}));
  const draw = () => run('ui.render', { requestId: 'orbit', surface, props: {
    bodyColumns: 40, scroll: { bodyRows: 40 }, isFocused: true,
  } });
  const find = (tree, predicate) => predicate(tree) ? tree :
    (tree.props?.children || []).map(child => find(child, predicate)).find(Boolean);
  return {
    state, timers, run,
    auto: async () => { for (const callback of [...delayed]) { delayed.delete(callback); await callback(); } },
    open: () => run('command.run'),
    end: async () => { await run('session.end'); state.shown = false; },
    press: async key => find(await draw(), tree => tree.props?.key === key).props.onPress(),
    svg: async () => find(await draw(), tree => tree.type === 'Svg').props.source,
    raster: async () => find(await draw(), tree => tree.type === 'Raster').props,
    primaryLabel: async () => find(await draw(), tree => tree.props?.key === 'primary').props.label,
    tick: async () => { for (const callback of timers) await callback(); },
    defer: name => {
      let release, enter;
      const pending = new Promise(resolve => { release = resolve; });
      const entered = new Promise(resolve => { enter = resolve; });
      gates.set(name, { pending, enter });
      return { entered, release };
    },
  };
}

for (const boundary of ['surface', 'store', 'clock', 'open']) {
  test(`ending a session during the opening ${boundary} await cannot revive its timer`, async () => {
    const h = await host(), gate = h.defer(boundary);
    const opening = h.open(); await gate.entered;
    await h.end(); gate.release(); await opening;
    assert.equal(h.timers.size, 0);
    assert.equal(h.state.openCalls, boundary === 'open' ? 1 : 0);
    assert.equal(h.state.invalidations, 0);
    await h.open();
    assert.equal(h.timers.size, 1, 'a fresh command can still open');
    assert.equal(await h.svg(), desktopFrame(createGame()));
    await h.end();
  });
}

for (const boundary of ['surface', 'store', 'clock']) test(`a turn ending during auto-open's ${boundary} lookup cannot open a stale pane`, async () => {
  const h = await host();
  await h.run('session.start', { isInteractive: true, surface: 'desktop' });
  await h.run('turn.start', { turnId: 'slow' });
  const gate = h.defer(boundary), pending = h.auto(); await gate.entered;
  await h.run('turn.complete', { turnId: 'slow' }); gate.release(); await pending;
  assert.equal(h.state.openCalls, 0); assert.equal(h.timers.size, 0);
  await h.open(); assert.equal(h.state.openCalls, 1, 'manual opening still works');
  await h.end();
});

test('a manual opening takes over a pending automatic opening and retains keyboard focus', async () => {
  const h = await host();
  await h.run('session.start', { isInteractive: true, surface: 'desktop' });
  await h.run('turn.start', { turnId: 'slow' });
  const gate = h.defer('surface'), pending = h.auto(); await gate.entered;
  await h.open(); gate.release(); await pending;
  assert.equal(h.state.openCalls, 1);
  assert.equal(h.state.lastOpen.focus, true);
  assert.equal(h.timers.size, 1);
  await h.end();
});

for (const boundary of ['surface', 'store', 'clock']) test(`a new turn still gets its timer during the old auto-open's ${boundary} lookup`, async () => {
  const h = await host();
  await h.run('session.start', { isInteractive: true, surface: 'desktop' });
  await h.run('turn.start', { turnId: 'first' });
  const gate = h.defer(boundary), pending = h.auto(); await gate.entered;
  await h.run('turn.complete', { turnId: 'first' });
  await h.run('turn.start', { turnId: 'second' });
  gate.release(); await pending;
  assert.equal(h.state.openCalls, 0);
  await h.auto(); assert.equal(h.state.openCalls, 1, 'the second turn must not lose its delayed opening');
  await h.end();
});

test('flips apply at the input timestamp without changing movement before the press', async () => {
  const h = await host(), expected = createGame();
  await h.open(); await h.press('primary'); act(expected);
  for (let i = 0; i < 10; i++) {
    h.state.now += 34;
    await h.press('primary'); advanceGame(expected, .034); act(expected);
    await h.tick();
  }
  assert.equal(await h.svg(), desktopFrame(expected));
  assert.ok(expected.elapsed > .33);
  await h.end();
});

test('a running flip keeps the pane mounted and reaches the next fast paint', async () => {
  const h = await host('terminal'), expected = createGame();
  await h.open(); await h.press('primary'); act(expected);
  const frame = await h.raster(), invalidations = h.state.invalidations;
  h.state.now = 25;
  await h.press('primary'); advanceGame(expected, .025); act(expected);
  assert.equal(h.state.invalidations, invalidations, 'flip must not rebuild the pane');
  h.state.now = 34;
  await h.tick(); advanceGame(expected, .009);
  assert.equal(h.state.frames.at(-1).cells, terminalFrame(expected, frame.columns, frame.rows).cells);
  await h.end();
});

test('a late clock response cannot rewind time after a newer input has been applied', async () => {
  const h = await host(), expected = createGame();
  await h.open(); await h.press('primary'); act(expected);
  h.state.now = 17;
  const gate = h.defer('clock'), pending = h.tick(); await gate.entered;
  h.state.now = 34;
  await h.press('primary'); advanceGame(expected, .034); act(expected);
  gate.release(); await pending;
  h.state.now = 51;
  await h.tick(); advanceGame(expected, .017);
  assert.equal(await h.svg(), desktopFrame(expected));
  await h.end();
});

test('a flip arriving after a collision shows game over instead of silently starting another run', async () => {
  const h = await host(), expected = createGame();
  await h.open(); await h.press('primary'); act(expected);
  for (let step = 0; step < 1000; step++) {
    advanceGame(expected, .017); h.state.now += 17;
    if (expected.phase === 'dead') {
      await h.press('primary');
      assert.match(await h.primaryLabel(), /Retry/);
      assert.equal(await h.svg(), desktopFrame(expected));
      await h.end(); return;
    }
    await h.tick();
  }
  assert.fail('fixture did not reach its collision');
});

test('a delayed flip cannot become a retry when a timer reaches game over first', async () => {
  const h = await host(); let expected = createGame();
  await h.open(); await h.press('primary'); act(expected);
  for (let step = 0; step < 1000; step++) {
    const next = structuredClone(expected); advanceGame(next, .017); h.state.now += 17;
    if (next.phase === 'dead') {
      const gate = h.defer('clock'), press = h.press('primary'); await gate.entered;
      await h.tick(); assert.match(await h.primaryLabel(), /Retry/);
      gate.release(); await press;
      assert.match(await h.primaryLabel(), /Retry/, 'the pending flip must not start another run');
      await h.end(); return;
    }
    expected = next; await h.tick();
  }
  assert.fail('fixture did not reach its collision');
});
