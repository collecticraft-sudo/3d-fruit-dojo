// Audio engine with a fake AudioContext: autoplay policy, signal chain, voice limit and priority, event mapping,
// pentatonic slices, Freeze filter, swoosh and fuse, and "never throws" (docs/architecture.md 8.6, docs/game-design.md 10).
// The fake models the Web Audio API surface, not a real output device (UNVERIFIED-ON-HARDWARE: real playback).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio, masterGainFor, softClip } from '../../public/js/audio/audio.js';
import { CONFIG } from '../../public/js/game/config.js';
import { FakeAudioContext } from '../../test-support/audio/fake-audio-context.js';
import { bombEvent, comboEvent, cutEvent, gameOverEvent, lifeLostEvent, makeBlade, makeObject, makeSnapshot, missEvent, nearMissEvent, powerupEvent, slowmoEvent, telegraphEvent, tickEvent, timeUpEvent } from '../../test-support/ui/fixtures.js';

function rig(opts = {}) {
  const made = [];
  const audio = createAudio({ createContext: () => { const c = new FakeAudioContext(opts.ctx); made.push(c); return c; }, random: () => 0.5, ...opts.audio });
  return { audio, made, get ctx() { return made[0]; } };
}
const unlocked = (opts) => { const r = rig(opts); r.audio.unlock(); return r; };
const voiceIds = (r) => r.audio.getDebug().voices.map((v) => v.id);

test('silent before unlock(): no context is created and nothing throws', () => {
  const r = rig();
  assert.equal(r.audio.ready, false);
  assert.doesNotThrow(() => {
    r.audio.play('slice', { r: 68 });
    r.audio.handleGameEvent(cutEvent());
    r.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot(), screen: 'playing' });
    r.audio.setVolume(0.3);
    r.audio.suspend();
    r.audio.resume();
    r.audio.stop('calHold');
  });
  assert.equal(r.made.length, 0);
  assert.equal(r.audio.ready, false);
});

test('mute: unlock never creates a context', () => {
  const r = rig({ audio: { mute: true } });
  r.audio.unlock();
  assert.equal(r.made.length, 0);
  assert.equal(r.audio.ready, false);
});

test('unlock builds the chain: voices -> sub-buses -> sfxBus -> compressor -> lowpass 20000 Hz -> safety soft clip -> masterGain (0.8 v^2) -> destination; idempotent', () => {
  const r = unlocked();
  r.audio.unlock();
  r.audio.unlock();
  assert.equal(r.made.length, 1, 'one context only');
  assert.equal(r.audio.ready, true);
  const ctx = r.ctx;
  const comp = ctx.nodes.find((n) => n.kind === 'compressor');
  assert.deepEqual([comp.threshold.value, comp.knee.value, comp.ratio.value, comp.attack.value, comp.release.value], [-14, 12, 4, 0.003, 0.12]);
  const filter = ctx.nodes.find((n) => n.kind === 'filter');
  assert.equal(filter.type, 'lowpass');
  assert.equal(filter.frequency.value, 20000);
  assert.equal(filter.Q.value, 0.7);
  const gains = ctx.nodes.filter((n) => n.kind === 'gain');
  const master = gains.at(-1);
  const sfxBus = gains[0];
  const shaper = ctx.nodes.find((n) => n.kind === 'waveshaper');
  assert.ok(Math.abs(master.gain.value - 0.8 * 0.7 * 0.7) < 1e-9, `master gain ${master.gain.value}`);
  assert.ok(sfxBus.outputs.length === 1 && sfxBus.outputs[0] === comp, 'sfxBus -> compressor');
  assert.ok(comp.outputs.length === 1 && comp.outputs[0] === filter, 'compressor -> master lowpass');
  const pre = filter.outputs[0];
  assert.ok(filter.outputs.length === 1 && pre.kind === 'gain' && pre.gain.value === 0.5, 'lowpass -> x0.5');
  assert.ok(pre.outputs.length === 1 && pre.outputs[0] === shaper, 'x0.5 -> soft clip');
  assert.ok(shaper.outputs.length === 1 && shaper.outputs[0] === master, 'soft clip -> master gain');
  assert.ok(master.outputs.length === 1 && master.outputs[0] === ctx.destination, 'master gain -> destination');
  // three sub-buses (slice, event, ui) feed sfxBus
  const subBuses = gains.filter((g) => g.outputs.length === 1 && g.outputs[0] === sfxBus);
  assert.equal(subBuses.length, 4, 'sliceBus, eventBus, uiBus and the reverb return feed sfxBus');
  assert.ok(subBuses.every((g) => g.gain.value === 1 || Math.abs(g.gain.value - 0.32) < 1e-9));
  const dbg = r.audio.getDebug();
  assert.deepEqual(dbg.buses, { slice: 1, event: 1, ui: 1 });
  assert.equal(dbg.reverb, true);
});

test('the soft clip is linear to 0.7, bounded by 1, odd and monotonic; the engine survives a context without WaveShaper or Convolver', () => {
  assert.equal(softClip(0.5), 0.5);
  assert.equal(softClip(-0.7), -0.7);
  assert.equal(softClip(0), 0);
  let prev = -Infinity;
  for (let x = -2; x <= 2; x += 0.01) {
    const y = softClip(x);
    assert.ok(Math.abs(y) <= 1 + 1e-12, `bounded at ${x}`);
    assert.ok(y >= prev - 1e-12, 'monotonic');
    assert.ok(Math.abs(softClip(-x) + y) < 1e-12, 'odd');
    prev = y;
  }
  assert.ok(softClip(2) > 0.97 && softClip(2) <= 1);
  const ctx = new FakeAudioContext();
  ctx.createWaveShaper = undefined;
  ctx.createConvolver = undefined;
  const audio = createAudio({ createContext: () => ctx, random: () => 0.5 });
  audio.unlock();
  const master = ctx.nodes.filter((n) => n.kind === 'gain').at(-1);
  assert.doesNotThrow(() => { audio.play('bombBoom'); audio.play('go'); });
  assert.equal(audio.getDebug().stats.errors, 0);
  assert.equal(audio.getDebug().reverb, false);
  assert.equal(master.outputs[0], ctx.destination);
  assert.equal(audio.getDebug().voiceCount, 2);
});

test('volume curve is squared: masterGain = 0.8 * v^2; volume 0 is silent but fully playable', () => {
  assert.equal(masterGainFor(1), 0.8);
  assert.ok(Math.abs(masterGainFor(0.5) - 0.2) < 1e-12);
  assert.equal(masterGainFor(0), 0);
  const r = unlocked();
  r.audio.setVolume(0.5);
  const master = r.ctx.nodes.filter((n) => n.kind === 'gain').at(-1);
  assert.ok(Math.abs(master.gain.calls.at(-1)[1] - 0.2) < 1e-12);
  r.audio.setVolume(0);
  const before = r.audio.getDebug().stats.played;
  assert.doesNotThrow(() => { r.audio.play('bombBoom'); r.audio.handleGameEvent(bombEvent()); r.audio.update(0.016, { blade: makeBlade({ cutting: true, speed: 3000 }), snapshot: makeSnapshot(), screen: 'playing' }); });
  assert.equal(r.audio.getDebug().stats.played, before, 'nothing is synthesised at volume 0');
  r.audio.setVolume(NaN);
  assert.ok(r.audio.getDebug().volume > 0, 'invalid volume falls back to the default');
});

test('runtime mute: master gain goes to 0, nothing is synthesised, continuous sounds stay silent; unmuting restores the volume curve', () => {
  const r = unlocked();
  const master = r.ctx.nodes.filter((n) => n.kind === 'gain').at(-1);
  assert.equal(r.audio.muted, false);
  r.audio.setMuted(true);
  assert.equal(r.audio.muted, true);
  assert.equal(master.gain.calls.at(-1)[1], 0);
  const before = r.audio.getDebug().stats.played;
  r.audio.play('bombBoom');
  r.audio.handleGameEvent(bombEvent());
  assert.equal(r.audio.getDebug().stats.played, before);
  r.audio.update(0.016, { blade: makeBlade({ cutting: true, speed: 3000 }), snapshot: makeSnapshot({ objects: [makeObject({ kind: 'bomb' })] }), screen: 'playing' });
  const targets = r.ctx.nodes.filter((n) => n.kind === 'gain').flatMap((g) => g.gain.calls.filter((c) => c[0] === 'target').map((c) => c[1]));
  assert.ok(targets.every((v) => v === 0 || v === 0.7 * 0 || Math.abs(v - 0.8 * 0.49) < 1e-9), 'no continuous voice was opened while muted');
  r.audio.setMuted(false);
  assert.ok(Math.abs(master.gain.calls.at(-1)[1] - 0.8 * 0.49) < 1e-9);
  r.audio.play('uiSelect');
  assert.ok(r.audio.getDebug().stats.played > before);
  r.audio.setMuted(true);
  r.audio.setVolume(0.9);
  assert.equal(master.gain.calls.at(-1)[1], 0, 'changing the volume while muted keeps it muted');
});

test('a suspended context is resumed by unlock() and sounds wait until it runs', () => {
  const r = rig({ ctx: { state: 'suspended' } });
  r.audio.unlock();
  assert.equal(r.ctx.resumeCalls, 1);
  assert.equal(r.ctx.state, 'running'); // the fake resumes synchronously
  const s = rig({ ctx: { state: 'suspended' } });
  s.audio.unlock();
  s.ctx.state = 'suspended';
  const before = s.audio.getDebug().stats.played;
  s.audio.play('uiSelect');
  assert.equal(s.audio.getDebug().stats.played, before);
  s.audio.suspend();
  assert.equal(s.ctx.suspendCalls, 1);
  s.audio.resume();
  assert.equal(s.ctx.resumeCalls >= 2, true);
});

test('envelope: 4 ms linear attack then exponential decay to 0.0001 at the recipe end (slice crack: 3 ms, 90 ms)', () => {
  const r = unlocked();
  r.audio.play('slice', { r: 48, k: 0, x: 960, jitter: 1 });
  const gains = r.ctx.nodes.filter((n) => n.kind === 'gain');
  const crack = gains.find((g) => g.gain.calls.some((c) => c[0] === 'linear' && c[1] === 0.45));
  assert.ok(crack, 'crack layer gain 0.45');
  const t0 = 0.005;
  assert.deepEqual(crack.gain.calls[0], ['set', 0.0001, t0]);
  const lin = crack.gain.calls.find((c) => c[0] === 'linear');
  assert.ok(Math.abs(lin[2] - (t0 + 0.003)) < 1e-9);
  const exp = crack.gain.calls.find((c) => c[0] === 'exp');
  assert.equal(exp[1], 0.0001);
  assert.ok(Math.abs(exp[2] - (t0 + 0.09)) < 1e-9);
  const pop = r.ctx.nodes.find((n) => n.kind === 'osc');
  assert.equal(pop.type, 'sine');
  assert.equal(pop.frequency.calls[0][1], 660, 'cherry pop pitch');
  assert.ok(Math.abs(pop.frequency.calls[1][1] - 660 * 0.28) < 1e-9);
  assert.ok(pop.stoppedAt > pop.startedAt);
});

test('pan = clamp((x - 960) / 960 * 0.7, -0.7, 0.7) for positional cues', () => {
  const pans = [];
  for (const x of [-500, 0, 960, 1920, 3000]) {
    const r = unlocked();
    r.audio.play('bombWarn', { x });
    pans.push(r.ctx.nodes.find((n) => n.kind === 'panner').pan.value);
  }
  assert.deepEqual(pans.map((p) => Math.round(p * 1000) / 1000), [-0.7, -0.7, 0, 0.7, 0.7]);
  const none = unlocked();
  none.audio.play('bombWarn');
  assert.equal(none.ctx.nodes.some((n) => n.kind === 'panner'), false, 'no x, no panner');
});

test('VOICE LIMIT 24 with priority: the oldest voice of the lowest priority is dropped; a lower priority sound loses', () => {
  const r = unlocked();
  for (let i = 0; i < 30; i++) r.audio.play('slice', { r: 60, x: 900 });
  assert.equal(r.audio.getDebug().voiceCount, 24, 'never more than 24');
  assert.equal(r.audio.getDebug().stats.evicted, 6);
  // a bomb boom arrives: it evicts a slice, never the other way round
  r.audio.play('bombBoom');
  assert.equal(r.audio.getDebug().voiceCount, 24);
  assert.ok(voiceIds(r).includes('bombBoom'));
  assert.equal(voiceIds(r).filter((v) => v === 'slice').length, 23);
  // fill the bus with high priority voices; a UI blip is dropped, an equal priority one evicts the oldest
  const busy = unlocked();
  for (let i = 0; i < 24; i++) busy.audio.play('bombBoom');
  busy.audio.play('uiMove');
  assert.equal(voiceIds(busy).includes('uiMove'), false);
  assert.equal(busy.audio.getDebug().stats.dropped, 1);
  busy.audio.play('bombNear');
  assert.equal(voiceIds(busy).includes('bombNear'), true, 'equal priority evicts the oldest');
  assert.equal(busy.audio.getDebug().voiceCount, 24);
});

test('finished voices are pruned so the limit only counts sounds that are still playing', () => {
  const r = unlocked();
  for (let i = 0; i < 24; i++) r.audio.play('uiMove');
  r.ctx.currentTime = 5;
  r.audio.play('uiSelect');
  assert.equal(r.audio.getDebug().voiceCount, 1);
});

test('handleGameEvent maps events to sounds', () => {
  const r = unlocked();
  r.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot({ mode: 'classic' }), screen: 'playing' });
  const table = [
    [cutEvent(), ['slice']],
    [cutEvent({ kind: 'golden', objType: 'golden' }), ['golden']],
    [comboEvent({ phase: 'close', n: 3 }), ['comboChime']],
    [comboEvent({ phase: 'update', n: 3 }), ['comboStep']],
    [comboEvent({ phase: 'update', n: 1 }), []],
    [comboEvent({ phase: 'close', n: 1 }), []],
    [bombEvent(), ['bombBoom']],
    [nearMissEvent(), ['bombNear']],
    [telegraphEvent(), ['bombWarn']],
    [{ seq: 1, t: 0, type: 'enter', id: 3, kind: 'golden', objType: 'golden', x: 500 }, ['goldenSpawn']],
    [{ seq: 1, t: 0, type: 'enter', id: 4, kind: 'powerup', objType: 'frenzy', x: 500 }, ['frenzySpawn']],
    [{ seq: 1, t: 0, type: 'enter', id: 5, kind: 'fruit', objType: 'apple', x: 500 }, []],
    [powerupEvent({ powerupId: 'double' }), ['doubleActivate']],
    [powerupEvent({ powerupId: 'double', phase: 'refresh' }), ['doubleActivate']],
    [powerupEvent({ powerupId: 'frenzy', phase: 'end' }), ['frenzyEnd']],
    [powerupEvent({ powerupId: 'clock' }), ['clockActivate']],
    [lifeLostEvent(), ['lifeLost']],
    [missEvent({ costsLife: false }), ['miss']],
    [missEvent({ costsLife: true }), []],
    [slowmoEvent({ reason: 'combo4' }), ['slowmo']],
    [slowmoEvent({ reason: 'freeze' }), []],
    [slowmoEvent({ reason: 'hitStop' }), []],
    [tickEvent({ secondsLeft: 2 }), ['tick']],
    [gameOverEvent(), ['gameOver']],
    [timeUpEvent(), ['timeUp']],
    [{ seq: 1, t: 0, type: 'phase', phase: 'over' }, []],
    [{ seq: 1, t: 0, type: 'wave', index: 1, formation: 'RAIN', count: 2, hasBomb: false, hasPowerup: false, hasGolden: false }, []],
    [{ seq: 1, t: 0, type: 'spawn', id: 1, kind: 'fruit', objType: 'apple', x: 1, y: 2, apexX: 3, apexY: 4 }, []],
  ];
  for (const [ev, expected] of table) {
    const total = r.audio.getDebug().stats.played;
    r.audio.handleGameEvent(ev);
    const n = r.audio.getDebug().stats.played - total;
    const ids = n ? voiceIds(r).slice(-n) : [];
    assert.deepEqual(ids, expected, `${ev.type}${ev.phase ? `/${ev.phase}` : ''}${ev.reason ? `/${ev.reason}` : ''}${ev.powerupId ? `/${ev.powerupId}` : ''}`);
    r.ctx.currentTime += 3; // let earlier voices finish so the table is not affected by the voice limit
  }
});

test('the miss sound is Classic only (Arcade and Zen misses are silent)', () => {
  for (const [mode, expected] of [['classic', 1], ['arcade', 0], ['zen', 0]]) {
    const r = unlocked();
    r.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot({ mode }), screen: 'playing' });
    r.audio.handleGameEvent(missEvent({ costsLife: false }));
    assert.equal(voiceIds(r).filter((v) => v === 'miss').length, expected, mode);
  }
});

test('slice pitch follows the pentatonic scale by the fruit index in the combo group', () => {
  const freqs = [];
  for (const comboIndex of [1, 2, 3, 4, 10, 30]) {
    const r = unlocked();
    r.audio.handleGameEvent(cutEvent({ comboIndex, r: 68, objType: 'apple' }));
    const pop = r.ctx.nodes.find((n) => n.kind === 'osc');
    freqs.push(pop.frequency.calls[0][1]);
  }
  const base = 900 - 5 * 68;
  const jit = 0.94 + 0.5 * 0.12; // the test's random() is 0.5
  const semis = [0, 2, 4, 7, 21, 21];
  freqs.forEach((f, i) => assert.ok(Math.abs(f - base * 2 ** (semis[i] / 12) * jit) < 1e-6, `comboIndex ${i}: ${f}`));
});

test('Freeze: master low-pass ramps to 2500 Hz over 150 ms and is held; ice ticks 1 s before the end; released at the end', () => {
  const r = unlocked();
  const filter = r.ctx.nodes.find((n) => n.kind === 'filter');
  r.audio.handleGameEvent(powerupEvent({ powerupId: 'freeze' }));
  const ramp = filter.frequency.calls.filter((c) => c[0] === 'linear').at(-1);
  assert.equal(ramp[1], 2500);
  assert.ok(Math.abs(ramp[2] - 0.15) < 1e-9, 'the ramp lasts 150 ms');
  assert.equal(r.audio.getDebug().freeze, true);
  // a slow-motion dip must not fight the Freeze filter
  const callsBefore = filter.frequency.calls.length;
  r.audio.handleGameEvent(slowmoEvent({ reason: 'combo4' }));
  assert.equal(filter.frequency.calls.length, callsBefore, 'the dip is skipped while Freeze holds the filter');
  // ice cracks
  const snap = (rem) => makeSnapshot({ powerups: [{ id: 'freeze', remainingS: rem, durationS: 5 }] });
  const playedBefore = r.audio.getDebug().stats.played;
  r.audio.update(0.016, { blade: makeBlade(), snapshot: snap(1.5), screen: 'playing' });
  assert.equal(r.audio.getDebug().stats.played, playedBefore);
  r.audio.update(0.016, { blade: makeBlade(), snapshot: snap(0.95), screen: 'playing' });
  assert.equal(voiceIds(r).includes('freezeCrack'), true);
  const after = r.audio.getDebug().stats.played;
  r.audio.update(0.016, { blade: makeBlade(), snapshot: snap(0.5), screen: 'playing' });
  assert.equal(r.audio.getDebug().stats.played, after, 'ice ticks play once');
  // Freeze ends: the shatter plays and the filter returns to 20000 Hz over 300 ms
  r.audio.handleGameEvent(powerupEvent({ powerupId: 'freeze', phase: 'end' }));
  assert.equal(voiceIds(r).at(-1), 'freezeEnd', 'the shatter');
  const back = filter.frequency.calls.filter((c) => c[0] === 'linear').at(-1);
  assert.equal(back[1], 20000);
  assert.equal(r.audio.getDebug().freeze, false);
});

test('Freeze filter is also released when the snapshot no longer has it (missed end event)', () => {
  const r = unlocked();
  r.audio.handleGameEvent(powerupEvent({ powerupId: 'freeze' }));
  assert.equal(r.audio.getDebug().freeze, true);
  r.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot({ powerups: [] }), screen: 'playing' });
  assert.equal(r.audio.getDebug().freeze, false);
});

test('Freeze filter is released when the round ends or is quit during Freeze: snapshot null in the menu, or the results screen with the old snapshot', () => {
  const frozen = () => makeSnapshot({ powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }] });
  const lastTarget = (r) => r.ctx.nodes.find((n) => n.kind === 'filter').frequency.calls.filter((c) => c[0] === 'linear').at(-1);
  // quit from the pause panel, or endRound: the snapshot is gone and no 'end' event was ever emitted
  const quit = unlocked();
  quit.audio.handleGameEvent(powerupEvent({ powerupId: 'freeze' }));
  quit.audio.update(0.016, { blade: makeBlade(), snapshot: frozen(), screen: 'playing' });
  assert.equal(quit.audio.getDebug().freeze, true, 'held while Freeze runs');
  for (let i = 0; i < 20; i++) {
    quit.ctx.currentTime += 1;
    quit.audio.update(0.016, { blade: makeBlade(), snapshot: null, screen: 'menu' });
  }
  assert.equal(quit.audio.getDebug().freeze, false, 'released in the menu');
  assert.equal(lastTarget(quit)[1], 20000, 'the master low-pass is back to 20000 Hz');
  // the round ends during Freeze: the results screen still carries the snapshot with Freeze in it
  const over = unlocked();
  over.audio.handleGameEvent(powerupEvent({ powerupId: 'freeze' }));
  over.audio.update(0.016, { blade: makeBlade(), snapshot: frozen(), screen: 'results' });
  assert.equal(over.audio.getDebug().freeze, false, 'released on the results screen');
  assert.equal(over.audio.getDebug().voices.some((v) => v.id === 'freezeCrack'), false, 'and no ice-crack on the results screen');
  // a slow-motion dip works again afterwards
  const filter = over.ctx.nodes.find((n) => n.kind === 'filter');
  const before = filter.frequency.calls.length;
  over.audio.handleGameEvent(slowmoEvent({ reason: 'nearMiss' }));
  assert.ok(filter.frequency.calls.length > before, 'the dip is no longer skipped');
  // pausing during Freeze keeps the hold (the round resumes)
  const pause = unlocked();
  pause.audio.handleGameEvent(powerupEvent({ powerupId: 'freeze' }));
  pause.audio.update(0.016, { blade: makeBlade(), snapshot: frozen(), screen: 'paused' });
  assert.equal(pause.audio.getDebug().freeze, true);
});

test('slow motion dips the master low-pass 20000 -> 1800 Hz over 60 ms and back over 300 ms', () => {
  const r = unlocked();
  const filter = r.ctx.nodes.find((n) => n.kind === 'filter');
  r.audio.handleGameEvent(slowmoEvent({ reason: 'nearMiss' }));
  const lin = filter.frequency.calls.filter((c) => c[0] === 'linear');
  assert.deepEqual(lin.map((c) => c[1]), [1800, 20000]);
  assert.ok(Math.abs(lin[0][2] - 0.06) < 1e-9, 'down in 60 ms');
  assert.ok(Math.abs(lin[1][2] - lin[0][2] - 0.3) < 1e-9, 'back up over 300 ms');
});

test('swoosh: one continuous voice; gain 0.08 + 0.20 k while cutting (20 ms time constant), silent otherwise, panned by blade x', () => {
  const r = unlocked();
  const cutting = makeBlade({ cutting: true, speed: 3000, cutThreshold: 1000, head: { x: 1920, y: 500 } });
  r.audio.update(0.016, { blade: cutting, snapshot: null, screen: 'menu' });
  const gains = r.ctx.nodes.filter((n) => n.kind === 'gain');
  const swoosh = gains.find((g) => g.gain.calls.some((c) => c[0] === 'target' && Math.abs(c[1] - 0.18) < 1e-9));
  assert.ok(swoosh, 'target gain 0.18 at v = T + 2000');
  assert.equal(swoosh.gain.calls.find((c) => c[0] === 'target')[3], 0.02);
  const bp = r.ctx.nodes.find((n) => n.kind === 'filter' && n.type === 'bandpass' && n.Q.value === 1.2);
  assert.ok(Math.abs(bp.frequency.calls.find((c) => c[0] === 'target')[1] - 1850) < 1e-9);
  const pan = r.ctx.nodes.filter((n) => n.kind === 'panner')[0];
  assert.ok(Math.abs(pan.pan.calls.find((c) => c[0] === 'target')[1] - 0.7) < 1e-9);
  r.audio.update(0.016, { blade: makeBlade({ cutting: false, speed: 300 }), snapshot: null, screen: 'menu' });
  const off = swoosh.gain.calls.filter((c) => c[0] === 'target').at(-1);
  assert.equal(off[1], 0);
  assert.equal(off[3], 0.04, 'about a 120 ms release tail');
  const noiseSources = r.ctx.nodes.filter((n) => n.kind === 'noise' && n.startedAt !== null);
  assert.equal(noiseSources.length, 2, 'swoosh and fuse are created once and never again');
  r.audio.update(0.016, { blade: cutting, snapshot: null, screen: 'menu' });
  assert.equal(r.ctx.nodes.filter((n) => n.kind === 'noise').length, 2);
});

test('bomb fuse sizzle: quiet loop with a 30 Hz tremolo only while a bomb is on screen during play, panned to it', () => {
  const r = unlocked();
  const snap = makeSnapshot({ objects: [makeObject({ id: 1, kind: 'bomb', x: 1400 })] });
  r.audio.update(0.016, { blade: makeBlade(), snapshot: snap, screen: 'playing' });
  const lfo = r.ctx.nodes.find((n) => n.kind === 'osc' && n.frequency.value === 30);
  assert.ok(lfo, '30 Hz tremolo oscillator');
  const fuseGain = r.ctx.nodes.filter((n) => n.kind === 'gain').find((g) => g.gain.calls.some((c) => c[0] === 'target' && c[1] === 0.03));
  assert.ok(fuseGain, 'gain 0.03');
  const fusePan = r.ctx.nodes.filter((n) => n.kind === 'panner')[1];
  assert.ok(Math.abs(fusePan.pan.calls.at(-1)[1] - ((1400 - 960) / 960) * 0.7) < 1e-9);
  r.audio.update(0.016, { blade: makeBlade(), snapshot: snap, screen: 'paused' });
  assert.equal(fuseGain.gain.calls.filter((c) => c[0] === 'target').at(-1)[1], 0, 'silent while paused');
  const none = unlocked();
  none.audio.update(0.016, { blade: makeBlade(), snapshot: makeSnapshot(), screen: 'playing' });
  assert.equal(none.ctx.nodes.filter((n) => n.kind === 'gain').some((g) => g.gain.calls.some((c) => c[1] === 0.03)), false);
});

test('stop(id) silences and removes the voices of that sound (calHold stops when the sword moves)', () => {
  const r = unlocked();
  r.audio.play('calHold', { ms: 2000 });
  assert.equal(voiceIds(r).includes('calHold'), true);
  r.audio.stop('calHold');
  assert.equal(voiceIds(r).includes('calHold'), false);
  const osc = r.ctx.nodes.find((n) => n.kind === 'osc');
  assert.ok(osc.stoppedAt <= 0.06 + 1e-9, 'stopped almost at once');
  assert.doesNotThrow(() => r.audio.stop('nothing'));
});

test('play() with an unknown sound id is ignored', () => {
  const r = unlocked();
  assert.doesNotThrow(() => r.audio.play('doesNotExist'));
  assert.equal(r.audio.getDebug().stats.played, 0);
});

test('NEVER THROWS, even when the AudioContext is broken', () => {
  const broken = createAudio({ createContext: () => { throw new Error('no audio here'); } });
  assert.doesNotThrow(() => { broken.unlock(); broken.play('slice'); broken.handleGameEvent(cutEvent()); broken.update(0.016, { blade: makeBlade(), snapshot: null, screen: 'menu' }); });
  assert.equal(broken.ready, false);
  const evil = new FakeAudioContext();
  evil.createOscillator = () => { throw new Error('boom'); };
  evil.createBufferSource = () => { throw new Error('boom'); };
  const a = createAudio({ createContext: () => evil });
  a.unlock();
  assert.doesNotThrow(() => {
    a.play('bombBoom');
    a.handleGameEvent(bombEvent());
    a.update(0.016, { blade: makeBlade({ cutting: true, speed: 3000 }), snapshot: makeSnapshot({ objects: [makeObject({ kind: 'bomb' })] }), screen: 'playing' });
    a.setVolume(0.2);
    a.dispose();
  });
  assert.ok(a.getDebug().stats.errors > 0, 'errors are counted, not thrown');
});

test('dispose closes the context; suspend and resume follow visibility', () => {
  const r = unlocked();
  r.audio.suspend();
  assert.equal(r.ctx.suspendCalls, 1);
  r.audio.resume();
  assert.ok(r.ctx.resumeCalls >= 1);
  r.audio.dispose();
  assert.equal(r.ctx.closed, true);
});

test('the shared noise buffer is 2 s of white noise, created once', () => {
  const r = unlocked({ ctx: { sampleRate: 8000 } });
  r.audio.play('bombBoom');
  r.audio.play('bombBoom');
  const sources = r.ctx.nodes.filter((n) => n.kind === 'noise');
  assert.ok(sources.length >= 4);
  const buf = sources[0].buffer;
  assert.equal(buf.length, 16000);
  assert.ok(sources.every((s) => s.buffer === buf), 'one shared buffer');
  assert.ok(sources.every((s) => s.loop === true && s.startOffset >= 0 && s.startOffset < 1.6), 'random start offsets inside the buffer');
  assert.equal(CONFIG.audio.compressor.threshold, -14);
});
