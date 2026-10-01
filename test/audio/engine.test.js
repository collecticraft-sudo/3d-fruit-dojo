// Audio engine, restyle round: sub-buses and ducking, reverb sends, trims, voice caps and rate limits, the countdown ladder, the named
// functions, volume and mute for the new sounds, no leaked nodes, determinism (docs/restyle-direction.md 4, public/js/audio/audio.js header).
import test from 'node:test';
import assert from 'node:assert/strict';
import { NAMED, createAudio } from '../../public/js/audio/audio.js';
import { CONFIG } from '../../public/js/game/config.js';
import { SOUND_IDS, buildRecipe } from '../../public/js/audio/recipes.js';
import { FakeAudioContext } from '../../test-support/audio/fake-audio-context.js';
import { bombEvent, comboEvent, cutEvent, makeBlade, makeSnapshot } from '../../test-support/ui/fixtures.js';

function rig(opts = {}) {
  const made = [];
  const audio = createAudio({ createContext: () => { const c = new FakeAudioContext(opts.ctx); made.push(c); return c; }, random: opts.random ?? (() => 0.5) });
  audio.unlock();
  const ctx = made[0];
  const gains = ctx.nodes.filter((n) => n.kind === 'gain');
  const sfxBus = gains[0];
  const buses = { slice: null, event: null, ui: null };
  // the gains that feed sfxBus, in creation order: sliceBus, eventBus, uiBus, then the reverb return
  [buses.slice, buses.event, buses.ui] = gains.filter((g) => g.outputs.length === 1 && g.outputs[0] === sfxBus);
  return { audio, ctx, sfxBus, buses, baseline: ctx.nodes.length };
}
const ids = (r) => r.audio.getDebug().voices.map((v) => v.id);
/** The first node a voice creates is its mix gain (trim); it feeds [panner ->] bus. */
function playAndGetOut(r, id, params) {
  const before = r.ctx.nodes.length;
  r.audio.play(id, params);
  const out = r.ctx.nodes[before];
  assert.ok(out && out.kind === 'gain', `${id} created a voice mix gain`);
  return out;
}
const finalBus = (node) => (node.outputs.find((o) => o.kind === 'panner') ?? node).outputs.find((o) => o.kind === 'gain' && o.outputs.length === 1 && o.outputs[0] === o.ctx.nodes.filter((n) => n.kind === 'gain')[0]) ?? null;
const targets = (param) => param.calls.filter((c) => c[0] === 'target');

test('every category plays on its sub-bus: slice -> sliceBus, UI -> uiBus, everything else -> eventBus; the sub-buses feed sfxBus', () => {
  const r = rig();
  assert.ok(finalBus(playAndGetOut(r, 'slice', { r: 68, x: 960 })) === r.buses.slice, 'slice');
  assert.ok(finalBus(playAndGetOut(r, 'uiSelect')) === r.buses.ui, 'uiSelect');
  assert.ok(finalBus(playAndGetOut(r, 'bombBoom')) === r.buses.event, 'bombBoom');
  assert.ok(finalBus(playAndGetOut(r, 'comboStep', { n: 3 })) === r.buses.event, 'comboStep');
  assert.ok(finalBus(playAndGetOut(r, 'freezeActivate')) === r.buses.event, 'freezeActivate');
  assert.ok(finalBus(playAndGetOut(r, 'lifeLost')) === r.buses.event, 'lifeLost');
  for (const b of Object.values(r.buses)) assert.ok(b.outputs.length === 1 && b.outputs[0] === r.sfxBus);
});

test('the voice mix gain is the recipe trim; a positional cue gets ONE panner per voice (not one per layer)', () => {
  const r = rig();
  const out = playAndGetOut(r, 'slice', { r: 68, x: 1920, fruit: 'apple' });
  assert.equal(out.gain.value, buildRecipe('slice', { r: 68, fruit: 'apple' }).trim);
  const panners = r.ctx.nodes.filter((n) => n.kind === 'panner');
  assert.equal(panners.length, 1);
  assert.ok(Math.abs(panners[0].pan.value - 0.7) < 1e-9);
  assert.ok(r.ctx.nodes.filter((n) => n.kind === 'osc').length >= 3 && r.ctx.nodes.filter((n) => n.kind === 'noise').length >= 3, 'layers: several sources, one panner');
  const centred = rig();
  centred.audio.play('comboStep', { n: 3, x: 1800 });
  assert.equal(centred.ctx.nodes.some((n) => n.kind === 'panner'), false, 'comboStep is centred (pan 0)');
});

test('ducking: bombBoom, gameOver and rankStamp pull the slice and UI buses to 0.4 for 350 ms (tau 40 ms in, 120 ms out); the event bus is untouched', () => {
  for (const play of [(a) => a.handleGameEvent(bombEvent()), (a) => a.handleGameEvent({ type: 'gameOver' }), (a) => a.rankStamp()]) {
    const r = rig();
    r.ctx.currentTime = 2;
    play(r.audio);
    for (const g of [r.buses.slice, r.buses.ui]) {
      const t = targets(g.gain);
      assert.equal(t.length, 2);
      assert.deepEqual(t[0].slice(1), [0.4, 2, 0.04], 'in');
      assert.ok(Math.abs(t[1][2] - 2.35) < 1e-9 && t[1][1] === 1 && t[1][3] === 0.12, 'out after 350 ms');
    }
    assert.equal(targets(r.buses.event.gain).length, 0);
    assert.equal(r.audio.getDebug().buses.slice, 1, 'the fake records the last target (1 = restored)');
  }
});

test('ducking: golden and comboChime n >= 4 duck only the slice bus to 0.6 for 250 ms; a small combo does not duck', () => {
  const r = rig();
  r.ctx.currentTime = 1;
  r.audio.handleGameEvent(cutEvent({ kind: 'golden', objType: 'golden' }));
  assert.deepEqual(targets(r.buses.slice.gain)[0].slice(1), [0.6, 1, 0.04]);
  assert.ok(Math.abs(targets(r.buses.slice.gain)[1][2] - 1.25) < 1e-9);
  assert.equal(targets(r.buses.ui.gain).length, 0);
  const small = rig();
  small.audio.handleGameEvent(comboEvent({ phase: 'close', n: 3 }));
  assert.equal(targets(small.buses.slice.gain).length, 0);
  const big = rig();
  big.audio.handleGameEvent(comboEvent({ phase: 'close', n: 4 }));
  assert.equal(targets(big.buses.slice.gain).length, 2);
  assert.equal(targets(big.buses.slice.gain)[0][1], 0.6);
});

test('ducking: a deeper active duck wins and stretches to the later end; an expired duck is forgotten; audio.duck() works and ignores bad groups', () => {
  const r = rig();
  r.ctx.currentTime = 5;
  r.audio.rankStamp(); // 0.4 until 5.35
  r.ctx.currentTime = 5.1;
  r.audio.handleGameEvent(cutEvent({ kind: 'golden', objType: 'golden' })); // 0.6 until 5.35: the deeper 0.4 stays
  const t = targets(r.buses.slice.gain);
  assert.equal(t.at(-2)[1], 0.4, 'still 0.4');
  assert.equal(t.at(-1)[1], 1);
  r.ctx.currentTime = 9; // long after: the golden duck is a fresh 0.6
  r.audio.handleGameEvent(cutEvent({ kind: 'golden', objType: 'golden' }));
  assert.equal(targets(r.buses.slice.gain).at(-2)[1], 0.6);
  // the public hook
  r.audio.duck('ui', 0.2, 100);
  assert.equal(targets(r.buses.ui.gain).at(-2)[1], 0.2);
  assert.doesNotThrow(() => { r.audio.duck('nope', 0.5, 100); r.audio.duck('slice', NaN, 100); r.audio.duck('slice', -3, 100); });
  assert.equal(r.audio.getDebug().stats.errors, 0);
  assert.equal(targets(r.buses.slice.gain).at(-2)[1], 0, 'amount is clamped to 0..1');
});

test('a wet voice sends to the shared reverb (one generated 0.9 s stereo room); a dry voice does not; the return feeds sfxBus', () => {
  let seed = 7;
  const lcg = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const r = rig({ ctx: { sampleRate: 8000 }, random: lcg });
  const conv = r.ctx.nodes.find((n) => n.kind === 'convolver');
  assert.ok(conv && conv.buffer, 'a convolver with an impulse response');
  assert.equal(conv.buffer.numberOfChannels, 2);
  assert.equal(conv.buffer.length, Math.floor(8000 * 0.9));
  const data = conv.buffer.getChannelData(0);
  assert.ok(data.some((v) => v !== 0) && data.every((v) => Math.abs(v) <= 1), 'non-silent and normalised');
  const reverbOut = conv.outputs[0];
  assert.ok(reverbOut.outputs.length === 1 && reverbOut.outputs[0] === r.sfxBus);
  const reverbIn = r.ctx.nodes.find((n) => n.kind === 'gain' && n.outputs.length === 1 && n.outputs[0] === conv);
  assert.ok(reverbIn);
  const wet = playAndGetOut(r, 'bombBoom');
  const send = wet.outputs.find((n) => n.outputs.includes(reverbIn));
  assert.ok(send, 'bombBoom feeds the reverb');
  assert.equal(send.gain.value, buildRecipe('bombBoom').wet);
  const dry = playAndGetOut(r, 'slice', { r: 68 });
  assert.equal(dry.outputs.some((n) => n.outputs.includes(reverbIn)), false, 'a slice stays dry');
  // an impulse response made from the same seed is the same
  const a = rig({ random: () => 0.25 });
  const b = rig({ random: () => 0.25 });
  assert.deepEqual([...a.ctx.nodes.find((n) => n.kind === 'convolver').buffer.getChannelData(1).slice(0, 64)], [...b.ctx.nodes.find((n) => n.kind === 'convolver').buffer.getChannelData(1).slice(0, 64)]);
});

test('uiMove: at most one per 40 ms and the pitch alternates +-3 percent so repeats do not machine-gun', () => {
  const r = rig();
  const freqOf = () => r.ctx.nodes.filter((n) => n.kind === 'osc').at(-1).frequency.calls[0][1];
  r.audio.uiMove();
  r.audio.uiMove(); // same instant
  assert.equal(ids(r).filter((v) => v === 'uiMove').length, 1);
  assert.equal(r.audio.getDebug().stats.rateLimited, 1);
  const first = freqOf();
  r.ctx.currentTime = 0.03;
  r.audio.uiMove();
  assert.equal(ids(r).filter((v) => v === 'uiMove').length, 1, 'still inside 40 ms');
  r.ctx.currentTime = 0.045;
  r.audio.uiMove();
  assert.equal(ids(r).filter((v) => v === 'uiMove').length, 2);
  const second = freqOf();
  assert.ok(Math.abs(first / 1500 - 1.03) < 1e-9 && Math.abs(second / 1500 - 0.97) < 1e-9, `${first} then ${second}`);
  r.ctx.currentTime = 0.1;
  r.audio.uiMove();
  assert.ok(Math.abs(freqOf() / 1500 - 1.03) < 1e-9, 'and back again');
  // other sounds are not rate limited
  r.audio.uiSelect(); r.audio.uiSelect();
  assert.equal(ids(r).filter((v) => v === 'uiSelect').length, 2);
});

test('per-sound voice caps: comboStep at most 6 and countTick at most 4 live voices (the oldest is replaced), uiMove at most 3', () => {
  const r = rig();
  for (let i = 0; i < 12; i++) r.audio.comboStep(2 + (i % 9));
  assert.equal(ids(r).filter((v) => v === 'comboStep').length, 6);
  assert.equal(r.audio.getDebug().stats.evicted, 6);
  for (let i = 0; i < 9; i++) r.audio.countTick(i / 9);
  assert.equal(ids(r).filter((v) => v === 'countTick').length, 4);
  for (let i = 0; i < 6; i++) { r.ctx.currentTime += 0.045; r.audio.uiMove(); }
  assert.ok(ids(r).filter((v) => v === 'uiMove').length <= 3);
  assert.equal(buildRecipe('uiMove').maxVoices, 3);
  assert.ok(r.audio.getDebug().voiceCount <= CONFIG.audio.voices);
});

test('the countdown climbs 3-2-1 by itself (523, 659, 784 Hz base), restarts after a pause or after go, and honours an explicit number', () => {
  const r = rig();
  const wood = () => r.ctx.nodes.filter((n) => n.kind === 'osc').at(-2).frequency.calls[0][1]; // layers: wood osc, tick noise, thump osc
  const beat = () => { r.audio.countdown(); return wood(); };
  const a = beat();
  r.ctx.currentTime += 1;
  const b = beat();
  r.ctx.currentTime += 1;
  const c = beat();
  assert.ok(Math.abs(a - 523.25 * 1.68) < 0.5 && Math.abs(b - 659.25 * 1.68) < 0.5 && Math.abs(c - 783.99 * 1.68) < 0.5, `${a} ${b} ${c}`);
  r.ctx.currentTime += 1;
  r.audio.go();
  r.ctx.currentTime += 1;
  assert.ok(Math.abs(beat() - a) < 1e-6, 'after go the ladder starts at 3 again');
  r.ctx.currentTime += 5;
  assert.ok(Math.abs(beat() - a) < 1e-6, 'after a pause too');
  r.ctx.currentTime += 1;
  r.audio.countdown(1);
  assert.ok(Math.abs(wood() - 783.99 * 1.68) < 0.5, 'an explicit number wins');
  // the UI's own call (sfx('countdown') with no params) goes through play()
  const u = rig();
  u.audio.play('countdown');
  u.ctx.currentTime += 1;
  u.audio.play('countdown');
  const woods = u.ctx.nodes.filter((n) => n.kind === 'osc' && n.frequency.calls[0][1] > 800).map((n) => n.frequency.calls[0][1]);
  assert.ok(woods[1] > woods[0]);
});

test('named functions for the UI engineer: every name plays its sound, safe with any arguments', () => {
  assert.deepEqual(Object.keys(NAMED).sort(), ['comboStep', 'countTick', 'countdown', 'go', 'rankStamp', 'resultsFanfare', 'uiBack', 'uiError', 'uiMove', 'uiSelect', 'uiWhoosh']);
  for (const [name, [id]] of Object.entries(NAMED)) {
    assert.ok(SOUND_IDS.includes(id), `${name} -> ${id}`);
    const r = rig();
    assert.equal(typeof r.audio[name], 'function', name);
    r.audio[name](3, 4);
    assert.equal(ids(r).at(-1), id, name);
  }
  const r = rig();
  assert.doesNotThrow(() => { r.audio.uiWhoosh(true); r.audio.uiWhoosh(); r.audio.resultsFanfare('S'); r.audio.resultsFanfare(); r.audio.countTick(); r.audio.comboStep(); r.audio.countdown(NaN); });
  assert.equal(r.audio.getDebug().stats.errors, 0);
  // reverse and the rank reach the recipe
  const w = rig();
  w.audio.uiWhoosh(true);
  assert.equal(w.ctx.nodes.find((n) => n.kind === 'filter' && n.type === 'bandpass').frequency.calls[0][1], 2400);
  const f1 = rig();
  f1.audio.resultsFanfare(1);
  const f5 = rig();
  f5.audio.resultsFanfare(5);
  assert.ok(f5.ctx.nodes.filter((n) => n.kind === 'osc').length > f1.ctx.nodes.filter((n) => n.kind === 'osc').length);
});

test('named functions are silent before unlock(), at volume 0 and while muted (no node is created, nothing throws)', () => {
  const idle = createAudio({ createContext: () => new FakeAudioContext() });
  assert.doesNotThrow(() => { for (const name of Object.keys(NAMED)) idle[name](1); idle.duck('slice', 0.5, 100); });
  const r = rig();
  r.audio.setVolume(0);
  const n0 = r.ctx.nodes.length;
  for (const name of Object.keys(NAMED)) r.audio[name](2);
  assert.equal(r.ctx.nodes.length, n0, 'volume 0: nothing synthesised');
  r.audio.setVolume(0.7);
  r.audio.setMuted(true);
  for (const name of Object.keys(NAMED)) r.audio[name](2);
  r.audio.handleGameEvent(bombEvent());
  r.audio.handleGameEvent(comboEvent({ phase: 'update', n: 5 }));
  assert.equal(r.ctx.nodes.length, n0, 'muted: nothing synthesised');
  assert.equal(r.audio.getDebug().masterGain, 0);
  r.audio.setMuted(false);
  r.audio.rankStamp();
  assert.ok(r.ctx.nodes.length > n0);
  assert.ok(Math.abs(r.audio.getDebug().masterGain - 0.8 * 0.49) < 1e-9, 'unmuting restores the volume curve');
});

test('events: a cut carries the fruit and its combo index to the slice; combo update plays comboStep(n); close plays comboChime(n)', () => {
  const count = (e) => { const r = rig(); r.audio.handleGameEvent(e); return r.ctx.nodes.filter((n) => n.kind === 'osc').length; };
  const base = count(cutEvent({ comboIndex: 1, objType: 'cherry', r: 48 }));
  assert.equal(count(cutEvent({ comboIndex: 3, objType: 'cherry', r: 48 })), base + 1, 'the ting from combo index 2');
  assert.equal(count(cutEvent({ comboIndex: 1, objType: 'apple', r: 68 })), base - 1, 'an apple has no small-fruit tick');
  assert.equal(count(cutEvent({ comboIndex: 1, objType: 'watermelon', r: 92 })), base, 'the watermelon has a thump instead of the tick');
  const r = rig();
  r.audio.handleGameEvent(comboEvent({ phase: 'update', n: 7 }));
  assert.deepEqual(ids(r), ['comboStep']);
  assert.ok(r.ctx.nodes.filter((n) => n.kind === 'osc').some((o) => o.frequency.calls[0][1] === 196), 'x7 has the gong');
  assert.equal(r.audio.getDebug().voices[0].prio, CONFIG.audio ? 4 : 4);
});

test('NO LEAKS: after a long mixed session every voice node is disconnected once its sound has ended', () => {
  const r = rig();
  r.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot(), screen: 'playing' });
  const persistent = r.ctx.nodes.length; // buses, master chain, reverb, swoosh and fuse
  let t = 0;
  for (let i = 0; i < 400; i++) {
    t += 0.05;
    r.ctx.currentTime = t;
    r.audio.play(SOUND_IDS[i % SOUND_IDS.length], { n: 2 + (i % 8), r: 48 + (i % 40), x: (i * 97) % 1920, rank: 1 + (i % 5), progress: (i % 10) / 10 });
    r.audio.handleGameEvent(cutEvent({ comboIndex: 1 + (i % 6) }));
    if (i % 7 === 0) r.audio.stop('calHold');
    r.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot(), screen: 'playing' });
    assert.ok(r.audio.getDebug().voiceCount <= CONFIG.audio.voices);
  }
  r.ctx.currentTime = t + 10; // everything has ended
  r.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot(), screen: 'playing' });
  const dbg = r.audio.getDebug();
  assert.equal(dbg.voiceCount, 0, 'no live voices');
  assert.equal(dbg.retiring, 0, 'no retiring voices');
  const leaked = r.ctx.nodes.slice(persistent).filter((n) => !n.disconnected);
  assert.equal(leaked.length, 0, `${leaked.length} voice nodes were never disconnected`);
  assert.ok(r.ctx.nodes.length - persistent > 2000, 'plenty of nodes were created and released');
});

test('NO LEAKS: evicted, stopped and disposed voices are released too (after their 10 ms fade)', () => {
  const r = rig();
  for (let i = 0; i < 30; i++) r.audio.play('slice', { r: 60, x: 900 });
  assert.equal(r.audio.getDebug().stats.evicted, 6);
  assert.equal(r.audio.getDebug().retiring, 6, 'fading out, not cut off');
  const retiredSources = r.ctx.nodes.filter((n) => (n.kind === 'osc' || n.kind === 'noise') && n.stoppedAt !== null && n.stoppedAt < 0.06);
  assert.ok(retiredSources.length > 0, 'an evicted voice stops within a few tens of ms (a fade, not a click)');
  r.ctx.currentTime = 0.5; // the fade is over and the 24 slices have ended
  r.audio.play('uiSelect');
  assert.equal(r.audio.getDebug().retiring, 0, 'released after the fade');
  r.audio.play('calHold', { ms: 2000 });
  r.audio.stop('calHold');
  assert.equal(ids(r).includes('calHold'), false);
  assert.equal(r.audio.getDebug().retiring, 1);
  r.ctx.currentTime = 1;
  r.audio.update(0.016, { blade: makeBlade(), snapshot: null, screen: 'menu' });
  assert.equal(r.audio.getDebug().retiring, 0);
  r.audio.dispose();
  assert.equal(r.audio.getDebug().voiceCount, 0);
  assert.equal(r.ctx.closed, true);
});

test('VOICE CAP under a randomised storm: never more than 24 live voices, bombs are never dropped for lower priorities, counters add up', () => {
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const r = rig({ random: rnd });
  let t = 0;
  let bombs = 0;
  for (let i = 0; i < 3000; i++) {
    t += rnd() * 0.04;
    r.ctx.currentTime = t;
    const id = SOUND_IDS[Math.floor(rnd() * SOUND_IDS.length)];
    if (id === 'bombBoom') bombs++;
    r.audio.play(id, { n: 2 + Math.floor(rnd() * 9), r: 48 + Math.floor(rnd() * 44), x: rnd() * 1920, rank: 1 + Math.floor(rnd() * 5) });
    const d = r.audio.getDebug();
    assert.ok(d.voiceCount <= 24, `voice count ${d.voiceCount} at step ${i}`);
    assert.ok(d.retiring <= 24 + 6, `retiring ${d.retiring}`);
  }
  const d = r.audio.getDebug();
  assert.equal(d.stats.errors, 0);
  assert.ok(d.stats.played > 1500, `${d.stats.played} played`);
  assert.ok(d.stats.evicted > 0 && d.stats.rateLimited > 0);
  assert.ok(bombs > 20);
});

test('determinism: the same seed gives the same graph and the same automation, call for call', () => {
  const run = () => {
    let seed = 99;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const r = rig({ random: rnd });
    r.ctx.currentTime = 1;
    for (const id of SOUND_IDS) r.audio.play(id, { n: 5, r: 70, x: 400, rank: 4 });
    r.audio.handleGameEvent(cutEvent({ comboIndex: 4 }));
    r.audio.handleGameEvent(bombEvent());
    return JSON.stringify(r.ctx.nodes.map((n) => [n.kind, n.type ?? null, n.startedAt ?? null, n.startOffset ?? null, n.gain?.calls ?? null, n.frequency?.calls ?? null, n.outputs.length]));
  };
  assert.equal(run(), run());
});

test('the per-frame update() does not allocate nodes while idle and prunes at most every 250 ms', () => {
  const r = rig();
  const c = { blade: makeBlade(), snapshot: makeSnapshot(), screen: 'playing' };
  r.audio.update(0.016, c);
  const n = r.ctx.nodes.length;
  for (let i = 0; i < 600; i++) { r.ctx.currentTime += 0.016; r.audio.update(0.016, c); }
  assert.equal(r.ctx.nodes.length, n, 'idle frames create no nodes');
});
