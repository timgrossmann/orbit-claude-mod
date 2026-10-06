import { CLIPS } from './clips.js';

// The host owns playback; no audio work is awaited by the animation or input
// path. Every voice has a cancellation signal owned by this game instance.
export function createAudio() {
  const beds = new Set(), voices = new Set(), lastPlayed = new Map();
  const pending = new Set(), blocked = new Set();
  let queue = [], previous = null, context = {}, bedWorld = '', record = null, runBest = 0;
  const cancel = group => {
    for (const controller of group) controller.abort();
    group.clear(); queue = queue.filter(job => !job.controller.signal.aborted);
  };
  const stopBeds = () => { bedWorld = ''; cancel(beds); };
  function stopEffects() {
    record?.cancel(); record = null; cancel(voices); lastPlayed.clear();
  }
  function unavailable(controller, host, channel) {
    if (controller.signal.aborted || blocked.has(channel)) return;
    blocked.add(channel);
    if (channel === 'music') stopBeds(); else stopEffects();
    host.unavailable([...blocked]);
  }
  function drain() {
    // Claude Code 2.1.291 allows four plays per plugin, including loops.
    // Aborted requests keep their slots until the host has finished stopping
    // its players. This also covers immediate pause/resume and pane reopening.
    while (queue.length && pending.size < 4) {
      const { controller, group, output, host, channel } = queue.shift();
      pending.add(controller);
      output().catch(() => unavailable(controller, host, channel)).finally(() => {
        pending.delete(controller); group.delete(controller); drain();
      });
    }
  }
  async function sampleTime(host) {
    try { const now = await host.now(); return Number.isFinite(now) ? now : null; }
    catch { return null; }
  }
  function play(host, name, loop = false) {
    const channel = loop ? 'music' : 'effects';
    if (blocked.has(channel) || !CLIPS[name]) return;
    const controller = new AbortController(), group = loop ? beds : voices;
    group.add(controller);
    const { asset, gain, durationMs } = CLIPS[name];
    async function output() {
      const started = loop ? null : await sampleTime(host);
      if (controller.signal.aborted) return;
      await host.play({ asset }, { shouldLoop: loop, gain, signal: controller.signal });
      if (controller.signal.aborted) return;
      // A loop only ends when cancelled. One-shots have no supported/skipped
      // result, so an implausibly short completion is a best-effort skip check.
      // A missing clock sample is inconclusive; it must not disable sound.
      if (loop) unavailable(controller, host, channel);
      else {
        const finished = await sampleTime(host);
        if (controller.signal.aborted) return;
        if (started !== null && finished !== null && finished - started < durationMs / 2) unavailable(controller, host, channel);
      }
    }
    queue.push({ controller, group, output, host, channel }); drain();
  }
  function effect(host, name, now) {
    if (blocked.has('effects') || !context.active || !context.effects || context.phase === 'paused') return;
    const gap = name === 'warn' ? 600 : 45;
    if (now - (lastPlayed.get(name) ?? -Infinity) < gap || beds.size + voices.size >= 4) return;
    lastPlayed.set(name, now); play(host, `effect.${name}`);
  }
  function stop() { stopBeds(); stopEffects(); context = {}; previous = null; }
  return {
    stop,
    reset() { stop(); blocked.clear(); },
    retry() { blocked.clear(); },
    sync(host, game, { active, music, effects, now }) {
      const before = previous;
      previous = { phase: game.phase, world: game.world, character: game.character, score: game.score, taps: game.taps };
      context = { active, music, effects, phase: game.phase };
      const newRun = game.phase === 'playing' && (!before || before.phase === 'ready' || before.phase === 'dead');
      if (newRun) runBest = game.best;
      if (!active || game.phase === 'paused') { stopBeds(); stopEffects(); return; }
      if (before?.phase !== game.phase || before?.world !== game.world) stopEffects();
      if (game.phase !== 'playing' || !music || blocked.has('music')) stopBeds();
      else if (bedWorld !== game.world) {
        stopBeds(); bedWorld = game.world;
        play(host, `ambience.${game.world}`, true); play(host, `music.${game.world}`, true);
      }
      if (!effects) { stopEffects(); return; }
      if (game.phase === 'playing') {
        if (newRun) effect(host, 'start', now);
        else if (before.phase === 'playing' && game.taps > before.taps) effect(host, 'flip', now);
        if (before?.phase === 'playing' && game.score > before.score) effect(host, 'score', now);
        if (game.player.x - game.camera < 75) effect(host, 'warn', now);
      } else if (game.phase === 'dead' && before?.phase === 'playing') {
        effect(host, 'death', now);
        if (game.score > runBest) record = host.after(900, () => { record = null; effect(host, 'best', now + 900); });
      } else if (before && (before.world !== game.world || before.character !== game.character)) effect(host, 'select', now);
    },
  };
}
