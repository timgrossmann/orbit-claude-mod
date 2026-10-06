import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../audio/playback.js';
import { createGame, act, advanceGame } from '../game/simulation.js';

// The real host owns speakers and processes. Hold only that boundary open so
// we can verify the mod's playback requests and cancellation without sound.
function host({ deferAbort = false } = {}) {
  const calls = [], scheduled = new Set(), notices = [];
  const pending = new Set();
  const $ = {
    now: async () => 0,
    play: (clip, options) => {
      // CLI 2.1.291 limits the entire plugin to four unfinished plays,
      // including loops and players still shutting down after cancellation.
      if (pending.size >= 4) return Promise.reject(new Error('refused: 4 plays are going at once'));
      let call;
      const playback = new Promise((resolve, reject) => {
        call = { clip, ...options, resolve, reject }; calls.push(call); pending.add(call);
        if (!deferAbort) options.signal.addEventListener('abort', resolve, { once: true });
      });
      return playback.finally(() => pending.delete(call));
    },
    after: (_ms, callback) => {
      scheduled.add(callback); return { cancel: () => scheduled.delete(callback) };
    },
    unavailable: () => notices.push('unavailable'),
  };
  const audio = createAudio();
  return { $, audio, calls, scheduled, notices,
    sync: (game, now = 0, options = {}) => audio.sync($, game, { active: true, music: true, effects: true, now, ...options }),
  };
}
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('forest music is started once, layers with effects, and every voice stops on focus loss', async () => {
  const h = host(), game = createGame(0, { world: 'inkwild' });
  h.sync(game); assert.equal(h.calls.length, 0);
  act(game); h.sync(game); await settle();
  assert.deepEqual(h.calls.map(c => c.clip.asset), [
    'assets/audio/ambience.inkwild.m4a', 'assets/audio/music.inkwild.m4a', 'assets/audio/effect.start.m4a',
  ]);
  for (let i = 1; i < 20; i++) h.sync(game, i * 17);
  assert.equal(h.calls.length, 3, 'ticks must not restart the soundtrack');
  act(game); h.sync(game, 400); await settle();
  assert.equal(h.calls.at(-1).clip.asset, 'assets/audio/effect.flip.m4a');
  h.sync(game, 417, { active: false });
  assert.ok(h.calls.every(c => c.signal.aborted), 'includes unfinished effects, not only loops');
});

test('real scoring and collision transitions produce one cue and cancel a delayed record cue on close', async () => {
  const h = host(), game = createGame(); h.sync(game); act(game); h.sync(game);
  game.gates = [{ x: 50, width: 20, top: 100, bottom: 600, passed: false }]; game.nextGate = 2000;
  advanceGame(game, .017); h.sync(game, 17); h.sync(game, 34); await settle();
  assert.equal(h.calls.filter(c => c.clip.asset.endsWith('effect.score.m4a')).length, 1);
  game.gates = [{ x: game.player.x - 10, width: 47, top: 500, bottom: 600, passed: false }];
  advanceGame(game, .017); h.sync(game, 51); h.sync(game, 68); await settle();
  assert.equal(h.calls.filter(c => c.clip.asset.endsWith('effect.death.m4a')).length, 1);
  assert.ok(h.calls.filter(c => c.shouldLoop).every(c => c.signal.aborted));
  assert.equal(h.scheduled.size, 1);
  h.audio.stop(); assert.equal(h.scheduled.size, 0);
  assert.ok(h.calls.every(c => c.signal.aborted));
});

test('a saved mute does not play, and rapid flips cannot accumulate an unbounded number of voices', async () => {
  const h = host(), game = createGame(); h.sync(game, 0, { music: false, effects: false });
  act(game); h.sync(game, 17, { music: false, effects: false });
  assert.equal(h.calls.length, 0);
  for (let i = 1; i <= 100; i++) { act(game); h.sync(game, i * 17, { music: false }); }
  await settle();
  assert.ok(h.calls.length > 0 && h.calls.length <= 4, 'effects are capped while the host keeps them pending');
  h.audio.stop();
});

test('music, ambience and rapid effects share the host limit without disabling audio', async () => {
  const h = host(), game = createGame(); h.sync(game); act(game); h.sync(game); await settle();
  for (let i = 1; i <= 8; i++) { act(game); h.sync(game, i * 60); await settle(); }
  assert.equal(h.notices.length, 0, 'a busy mixer must not be treated as an unavailable device');
  assert.equal(h.calls.filter(c => c.shouldLoop && !c.signal.aborted).length, 2);
  assert.equal(h.calls.length, 4, 'two beds leave room for two effects');
  h.$.now = async () => 1000;
  h.calls.find(c => c.clip.asset.endsWith('effect.flip.m4a')).resolve(); await settle();
  act(game); h.sync(game, 1000); await settle();
  assert.equal(h.calls.length, 5, 'fresh effects play as soon as a slot becomes free');
  h.audio.stop();
});

test('reopening waits for cancelled players to finish before starting new forest tracks', async () => {
  const h = host({ deferAbort: true }), game = createGame();
  h.sync(game); act(game); h.sync(game); await settle();
  act(game); h.sync(game, 60); await settle();
  const old = [...h.calls]; assert.equal(old.length, 4);
  h.audio.reset(); game.world = 'inkwild'; h.sync(game, 120); await settle();
  assert.ok(old.every(c => c.signal.aborted));
  assert.equal(h.notices.length, 0, 'aborting is not the same as the host freeing its slot');
  old[0].resolve(); old[1].resolve(); await settle();
  assert.deepEqual(h.calls.filter(c => !c.signal.aborted).map(c => c.clip.asset), [
    'assets/audio/ambience.inkwild.m4a', 'assets/audio/music.inkwild.m4a',
  ]);
  h.audio.stop(); h.calls.forEach(c => c.resolve()); await settle();
});

test('a rejected music layer does not stop working sound effects', async () => {
  const h = host(), game = createGame(); h.sync(game); act(game); h.sync(game); await settle();
  h.calls[0].reject(new Error('music unavailable')); await settle();
  act(game); h.sync(game, 100); await settle();
  assert.equal(h.calls.at(-1).clip.asset, 'assets/audio/effect.flip.m4a');
  assert.equal(h.calls.at(-1).signal.aborted, false);
  assert.equal(h.calls.filter(c => c.shouldLoop && !c.signal.aborted).length, 0);
  assert.equal(h.notices.length, 1);
  h.audio.stop();
});

test('failed or silently skipped playback is bounded, and cancellation cannot poison a reopened game', async () => {
  for (const failure of ['reject', 'resolve']) {
    const h = host(), game = createGame(); h.sync(game); act(game); h.sync(game); await settle();
    h.calls[0][failure](new Error('no player'));
    h.calls.find(c => !c.shouldLoop)[failure](new Error('no player')); await settle();
    assert.equal(h.notices.length, 2, 'music and effects each report their own failure');
    assert.ok(h.calls.every(c => c.signal.aborted));
    const count = h.calls.length;
    for (let i = 0; i < 10; i++) { act(game); h.sync(game, i * 50); }
    assert.equal(h.calls.length, count);
    h.audio.reset(); h.sync(game, 1000); await settle();
    assert.equal(h.calls.filter(c => c.shouldLoop && !c.signal.aborted).length, 2);
    // Settling a cancelled request from the old run cannot stop new playback.
    h.calls[1].reject(new Error('old run stopped')); await settle();
    assert.equal(h.notices.length, 2);
    assert.equal(h.calls.filter(c => c.shouldLoop && !c.signal.aborted).length, 2);
    h.audio.stop();
  }
});

test('an effects failure leaves the music running and can be retried independently', async () => {
  const h = host(), game = createGame(); h.sync(game); act(game); h.sync(game); await settle();
  h.calls.find(c => !c.shouldLoop).reject(new Error('effect unavailable')); await settle();
  act(game); h.sync(game, 100); await settle();
  assert.equal(h.calls.length, 3, 'failed effects stay stopped');
  assert.equal(h.calls.filter(c => c.shouldLoop && !c.signal.aborted).length, 2);
  h.audio.retry(); act(game); h.sync(game, 200); await settle();
  assert.equal(h.calls.at(-1).clip.asset, 'assets/audio/effect.flip.m4a');
  assert.equal(h.calls.at(-1).signal.aborted, false);
  assert.equal(h.calls.filter(c => c.shouldLoop).length, 2, 'retry does not restart working music');
  h.audio.stop();
});

test('closing cancels tracks waiting for a slot, so late player shutdown cannot restart audio', async () => {
  const h = host({ deferAbort: true }), game = createGame();
  h.sync(game); act(game); h.sync(game); await settle();
  act(game); h.sync(game, 60); await settle();
  h.audio.reset(); game.world = 'amberwood'; h.sync(game, 120); await settle();
  h.audio.stop(); h.calls.forEach(c => c.resolve()); await settle();
  assert.equal(h.calls.length, 4, 'queued forest tracks never reach the host after close');
  assert.equal(h.notices.length, 0);
});

test('effects-only mode detects an implausibly short skipped clip but accepts a completed clip', async () => {
  for (const duration of [0, 600]) {
    const h = host(), game = createGame(); h.sync(game, 0, { music: false });
    act(game); h.sync(game, 0, { music: false }); await settle();
    h.$.now = async () => duration;
    h.calls[0].resolve(); await settle();
    assert.equal(h.notices.length, duration === 0 ? 1 : 0);
    const before = h.calls.length;
    act(game); h.sync(game, 700, { music: false }); await settle();
    assert.equal(h.calls.length, before + (duration === 0 ? 0 : 1));
    h.audio.stop();
  }
});

test('a missing timing sample is inconclusive, and turning effects on mid-run cannot invent a record', async () => {
  const h = host(), game = createGame(10); h.sync(game, 0, { effects: false });
  act(game); h.sync(game, 0, { effects: false });
  h.sync(game, 50); game.score = 1; game.phase = 'dead'; h.sync(game, 100);
  await settle();
  assert.equal(h.scheduled.size, 0, 'one point is not a new record over ten');
  h.$.now = async () => { throw new Error('clock unavailable'); };
  h.calls.at(-1).resolve(); await settle();
  assert.equal(h.notices.length, 0, 'a clock error is not evidence of a skipped clip');
  h.audio.stop();
});
