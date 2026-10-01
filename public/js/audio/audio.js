// WebAudio engine: synthesised sound effects, no sample files. OWNER: Presentation engineer (restyle round: Audio engineer).
// docs/architecture.md 8.6, docs/game-design.md 10, docs/restyle-direction.md 4.
//
// Signal chain (design 10.1, restyle direction 4):
//   voice mix (trim) -> [pan] -> sliceBus | eventBus | uiBus (gain 1, duckable) -> sfxBus (gain 1.0)
//          -> DynamicsCompressor (-14 dB, knee 12, ratio 4, attack 3 ms, release 120 ms)
//          -> masterFilter (lowpass 20000 Hz, Q 0.7) -> safety soft clip (x0.5, WaveShaper) -> masterGain (0.8 * volume^2) -> destination
//   voices with `wet` also feed a shared reverb: send -> reverbIn -> ConvolverNode (one generated 0.9 s stereo room) -> reverbOut -> sfxBus
//
// Rules: silent before unlock() (the context is created inside the first user gesture, autoplay policy); never throws (every
// public method is wrapped, a broken sound is dropped); at most 24 voices with priority bomb > life > combo > power-up > slice
// > UI (the oldest voice of the lowest priority is dropped), a per-sound cap for the chatty ones (`maxVoices`) and a per-sound
// rate limit (`minGapMs`, uiMove one per 40 ms); fully playable with volume 0; createContext is injectable so the tests use a fake
// AudioContext that records nodes. Buffers are shared (one 2 s noise buffer, one reverb impulse), the buses and the two continuous
// voices are built once, and every finished voice is disconnected on the next prune (play(), and update() every 250 ms).
// Safety soft clip: linear up to 0.7, then a tanh knee that never exceeds 1.0, so even a pile-up of loud sounds (bomb in an x7 combo with the
// fanfare) leaves the engine at or below 1.0 before the master gain (at most 0.8 after it): the output never clips. Normal levels (every
// sound peaks at -4 dBFS or lower, see recipes.js LEVEL_DB) never reach the knee, so it is inaudible.
// Ducking: bombBoom, gameOver and rankStamp pull the slice and UI buses to 0.4 for 350 ms; golden and comboChime n >= 4 pull the
// slice bus to 0.6 for 250 ms (setTargetAtTime, tau 40 ms in, 120 ms out).
//
// SOUNDS (play(id, params); every id also has a named function on the engine, see NAMED below):
//   gameplay  slice{r,k,jitter,ci,fruit,x} comboStep{n} comboChime{n} bombBoom bombNear bombWarn lifeLost miss golden goldenSpawn slowmo
//   power-ups freezeSpawn freezeActivate freezeCrack freezeEnd frenzySpawn frenzyActivate frenzyEnd doubleSpawn doubleActivate doubleEnd
//             clockSpawn clockActivate
//   round     countdown{n} go tick{urgent} gameOver timeUp record rankStamp resultsFanfare{rank} countTick{progress}
//   UI        uiMove uiSelect uiBack uiError uiWhoosh{reverse} recenter connectOk disconnect calStep calHold{ms} calOk calFail
// NAMED functions for the UI engineer (each is play(id, params) with the arguments below; all are safe before unlock() and when muted):
//   audio.uiMove()  audio.uiSelect()  audio.uiBack()  audio.uiError()  audio.uiWhoosh(reverse = false)
//   audio.countdown(n)  audio.go()  audio.countTick(progress01)  audio.rankStamp()  audio.resultsFanfare(rank)  audio.comboStep(n)
//   audio.duck(group, amount, ms)   group is 'slice' | 'ui' | 'event'
// UNVERIFIED-ON-HARDWARE: latency and loudness of the real output path (speakers, Bluetooth headphones) are not known.

import { CONFIG } from '../game/config.js';
import { BUS_OF, PRIORITY, RECIPES, buildRecipe, pentatonicSemitone, swooshTargets } from './recipes.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const SILENT = 0.0001;
const PRUNE_EVERY_S = 0.25;
const REVERB_S = 0.9; // length of the generated room
const REVERB_RETURN = 0.32; // wet return level into sfxBus
const COUNTDOWN_RESET_S = 1.7; // a countdown number more than this after the previous one starts the 3-2-1 ladder again

/** Master gain for a volume 0..1 (design: 0.8 * v^2). */
export function masterGainFor(volume, audioConfig = CONFIG.audio) {
  return audioConfig.masterCurve ? audioConfig.masterCurve(volume) : 0.8 * volume * volume;
}

/** Soft clip curve over the input range [-2, 2] (the stage halves the signal first): linear to 0.7, tanh knee above, bounded by 1. */
export function softClip(x) {
  const a = Math.abs(x);
  if (a <= 0.7) return x;
  return Math.sign(x) * (0.7 + 0.3 * Math.tanh((a - 0.7) / 0.3));
}

/** The names of the simple per-sound functions the engine exposes: name -> [sound id, how the arguments map to params]. */
export const NAMED = Object.freeze({
  uiMove: ['uiMove', () => ({})],
  uiSelect: ['uiSelect', () => ({})],
  uiBack: ['uiBack', () => ({})],
  uiError: ['uiError', () => ({})],
  uiWhoosh: ['uiWhoosh', (reverse) => ({ reverse: !!reverse })],
  countdown: ['countdown', (n) => (Number.isFinite(n) ? { n } : {})],
  go: ['go', () => ({})],
  countTick: ['countTick', (progress) => ({ progress })],
  rankStamp: ['rankStamp', () => ({})],
  resultsFanfare: ['resultsFanfare', (rank) => ({ rank })],
  comboStep: ['comboStep', (n, x) => ({ n, x })],
});

/**
 * @param {{clock?:any, createContext?:()=>any, mute?:boolean, config?:any, random?:()=>number}} [opts]
 *   mute: the engine never creates a context (?mute=1, tests). random: cosmetic randomness (default Math.random).
 * @returns {import('../shared/contracts.js').AudioEngine & {stop:(id:string)=>void, getDebug:()=>object, dispose:()=>void}}
 */
export function createAudio(opts = {}) {
  const config = opts.config ?? CONFIG;
  const A = config.audio;
  const random = opts.random ?? Math.random;
  const makeContext = opts.createContext ?? (() => {
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Ctor) throw new Error('no AudioContext');
    return new Ctor({ latencyHint: 'interactive' });
  });

  let ctx = null;
  let bus = null; // sfxBus
  const buses = { slice: null, event: null, ui: null };
  let reverbIn = null;
  let compressor = null;
  let masterFilter = null;
  let masterGain = null;
  let noiseBuffer = null;
  let volume = A.volumeDefault;
  let muted = false; // runtime mute (the M key); not persisted, volume keeps its own value
  let mode = null;
  const voices = []; // {id, prio, endAt, nodes: any[], sources: any[], out: GainNode}
  const retiring = []; // voices that were stopped or evicted: fading out, nodes released by the next prune once the fade is done
  const stats = { played: 0, dropped: 0, evicted: 0, errors: 0, ducked: 0, rateLimited: 0 };
  const freezeState = { active: false, iceDone: false };
  const duckState = { slice: { until: 0, amount: 1 }, ui: { until: 0, amount: 1 }, event: { until: 0, amount: 1 } };
  const lastPlayAt = new Map(); // sound id -> context time of its last start (minGapMs)
  const seq = { flip: false, countdownAt: -1, countdownIdx: 0, lastPrune: 0 };
  let swoosh = null; // persistent continuous voice
  let fuse = null;
  let lastSwoosh = { gain: -1, hz: -1, pan: 9 };

  const running = () => !!ctx && ctx.state !== 'closed' && ctx.state !== 'suspended';
  const now = () => ctx.currentTime;

  function safe(fn) {
    try {
      return fn();
    } catch {
      stats.errors++;
      return undefined;
    }
  }

  // ---------------------------------------------------------------- graph construction
  /** A short stereo room: exponentially decaying noise that gets darker over time (one pole low-pass, seeded randomness). */
  function buildImpulse() {
    const len = Math.max(64, Math.floor(ctx.sampleRate * REVERB_S));
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const a = 0.55 + 0.4 * t; // low-pass coefficient: brighter early, darker late
        lp = a * lp + (1 - a) * (random() * 2 - 1);
        d[i] = lp * (1 - t) ** 3.2 * (i < 48 ? i / 48 : 1);
      }
    }
    return ir;
  }

  function buildChain() {
    bus = ctx.createGain();
    bus.gain.value = 1;
    compressor = ctx.createDynamicsCompressor();
    const c = A.compressor;
    compressor.threshold.value = c.threshold;
    compressor.knee.value = c.knee;
    compressor.ratio.value = c.ratio;
    compressor.attack.value = c.attack;
    compressor.release.value = c.release;
    masterFilter = ctx.createBiquadFilter();
    masterFilter.type = 'lowpass';
    masterFilter.frequency.value = 20000;
    masterFilter.Q.value = 0.7;
    bus.connect(compressor);
    compressor.connect(masterFilter);
    // safety soft clip: halve, shape over [-2, 2], then the master gain (the shaper clamps what is beyond, so the output is always <= 1)
    const preClip = ctx.createGain();
    preClip.gain.value = 0.5;
    let clipOut = null;
    if (typeof ctx.createWaveShaper === 'function') {
      clipOut = ctx.createWaveShaper();
      const n = 4097;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) curve[i] = softClip(((i / (n - 1)) * 2 - 1) * 2);
      clipOut.curve = curve;
      clipOut.oversample = 'none';
    }
    for (const k of ['slice', 'event', 'ui']) {
      buses[k] = ctx.createGain();
      buses[k].gain.value = 1;
      buses[k].connect(bus);
    }
    // shared reverb: built only where the context supports it (the tests' fake contexts may not)
    if (typeof ctx.createConvolver === 'function') {
      reverbIn = ctx.createGain();
      reverbIn.gain.value = 1;
      const conv = ctx.createConvolver();
      conv.buffer = buildImpulse();
      const reverbOut = ctx.createGain();
      reverbOut.gain.value = REVERB_RETURN;
      reverbIn.connect(conv);
      conv.connect(reverbOut);
      reverbOut.connect(bus);
    }
    masterGain = ctx.createGain(); // created last on purpose: the tests (and the debug hook) find it as the last gain of an idle engine
    masterGain.gain.value = muted ? 0 : masterGainFor(volume, A);
    if (clipOut) {
      masterFilter.connect(preClip);
      preClip.connect(clipOut);
      clipOut.connect(masterGain);
    } else {
      preClip.gain.value = 1; // no shaper available: the stage is a plain pass-through
      masterFilter.connect(preClip);
      preClip.connect(masterGain);
    }
    masterGain.connect(ctx.destination);
    // one shared 2 s white-noise buffer (cosmetic randomness: Math.random is fine here)
    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = random() * 2 - 1;
  }

  function unlock() {
    if (opts.mute) return;
    safe(() => {
      if (!ctx) {
        ctx = makeContext();
        buildChain();
      }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        const p = ctx.resume();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      }
    });
  }

  const panFor = (x) => clamp(((x - 960) / 960) * A.panMax, -A.panMax, A.panMax);

  function makePanner(x) {
    if (typeof ctx.createStereoPanner !== 'function') return null;
    const p = ctx.createStereoPanner();
    p.pan.value = panFor(x);
    return p;
  }

  /** Apply a glide or constant to an AudioParam. */
  function setParam(param, spec, t0, exponential = true) {
    if (typeof spec === 'number') {
      param.setValueAtTime(spec, t0);
    } else {
      param.setValueAtTime(spec.from, t0);
      if (exponential) param.exponentialRampToValueAtTime(Math.max(1, spec.to), t0 + spec.ms / 1000);
      else param.linearRampToValueAtTime(spec.to, t0 + spec.ms / 1000);
    }
  }

  // ---------------------------------------------------------------- voices
  /** Take a voice out of the live list: a short fade (no click), its sources stop, its nodes are released by a later prune. */
  function retire(v) {
    const t = now();
    if (v.out && v.out.gain && typeof v.out.gain.setTargetAtTime === 'function') {
      v.out.gain.cancelScheduledValues(t);
      v.out.gain.setTargetAtTime(SILENT, t, 0.006);
    }
    for (const s of v.sources) safe(() => s.stop(t + 0.04));
    v.releaseAt = t + 0.06;
    retiring.push(v);
  }

  function releaseNodes(v) {
    for (const n of v.nodes) safe(() => n.disconnect());
    v.nodes.length = 0;
  }

  /** Release the nodes of every voice that has ended and of every retired voice whose fade is over. */
  function prune() {
    const t = now();
    seq.lastPrune = t;
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].endAt <= t) {
        releaseNodes(voices[i]);
        voices.splice(i, 1);
      }
    }
    for (let i = retiring.length - 1; i >= 0; i--) {
      if (retiring[i].releaseAt <= t) {
        releaseNodes(retiring[i]);
        retiring.splice(i, 1);
      }
    }
  }

  /** Enforce the per-sound cap and the voice limit. Returns false when the new voice loses against every existing voice. */
  function admit(recipe) {
    prune();
    if (recipe.maxVoices) {
      let count = 0;
      let oldest = -1;
      for (let i = 0; i < voices.length; i++) {
        if (voices[i].id !== recipe.id) continue;
        count++;
        if (oldest < 0 || voices[i].endAt < voices[oldest].endAt) oldest = i;
      }
      if (count >= recipe.maxVoices) {
        retire(voices[oldest]);
        voices.splice(oldest, 1);
        stats.evicted++;
      }
    }
    if (voices.length < A.voices) return true;
    let victim = -1;
    for (let i = 0; i < voices.length; i++) {
      if (victim < 0 || voices[i].prio < voices[victim].prio || (voices[i].prio === voices[victim].prio && voices[i].endAt < voices[victim].endAt)) victim = i;
    }
    if (voices[victim].prio > recipe.priority) {
      stats.dropped++;
      return false;
    }
    retire(voices[victim]);
    voices.splice(victim, 1);
    stats.evicted++;
    return true;
  }

  function playRecipe(recipe, params) {
    if (!admit(recipe)) return;
    const t0 = now() + 0.005;
    const nodes = [];
    const voice = { id: recipe.id, prio: recipe.priority, endAt: t0 + recipe.durationMs / 1000 + 0.05, nodes, sources: [], out: null };
    // one mix gain (trim) per voice; one panner per voice when any layer is positional and the cue has an x
    const out = ctx.createGain();
    out.gain.value = recipe.trim ?? 1;
    nodes.push(out);
    voice.out = out;
    let head = out;
    if (params && typeof params.x === 'number' && recipe.layers.some((l) => l.pan)) {
      const p = makePanner(params.x);
      if (p) {
        out.connect(p);
        nodes.push(p);
        head = p;
      }
    }
    head.connect(buses[BUS_OF[recipe.category]] ?? bus);
    if (recipe.wet > 0 && reverbIn) {
      const send = ctx.createGain();
      send.gain.value = recipe.wet;
      head.connect(send);
      send.connect(reverbIn);
      nodes.push(send);
    }
    for (const layer of recipe.layers) {
      const start = t0 + layer.startMs / 1000;
      const end = start + layer.endMs / 1000;
      let src;
      if (layer.type === 'osc') {
        src = ctx.createOscillator();
        src.type = layer.wave;
        setParam(src.frequency, layer.freq, start);
        if (layer.detuneCents) src.detune.value = layer.detuneCents;
      } else {
        src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        src.loop = true;
      }
      let node = src;
      if (layer.filter) {
        const f = ctx.createBiquadFilter();
        f.type = layer.filter.type;
        setParam(f.frequency, layer.filter.freq, start);
        f.Q.value = layer.filter.Q ?? 0.7;
        node.connect(f);
        node = f;
        nodes.push(f);
      }
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(SILENT, start);
      gain.gain.linearRampToValueAtTime(layer.gain, start + Math.min(layer.attackMs, layer.endMs) / 1000);
      gain.gain.exponentialRampToValueAtTime(SILENT, Math.max(end, start + 0.006));
      node.connect(gain);
      nodes.push(gain);
      if (layer.lfo) {
        const lfoOsc = ctx.createOscillator();
        lfoOsc.frequency.value = layer.lfo.freq;
        const depth = ctx.createGain();
        depth.gain.value = layer.gain * layer.lfo.depth;
        lfoOsc.connect(depth);
        depth.connect(gain.gain);
        lfoOsc.start(start);
        lfoOsc.stop(end + 0.03);
        voice.sources.push(lfoOsc);
        nodes.push(lfoOsc, depth);
      }
      gain.connect(out);
      if (layer.type === 'noise') src.start(start, random() * 1.5);
      else src.start(start);
      src.stop(end + 0.03);
      voice.sources.push(src);
      nodes.push(src);
    }
    voices.push(voice);
    stats.played++;
    if (recipe.masterFilter) applyMasterFilter(recipe.masterFilter);
    if (recipe.duck) for (const d of recipe.duck) for (const g of d.groups) duckGroup(g, d.amount, d.ms);
  }

  // ---------------------------------------------------------------- ducking
  /** Pull a sub-bus to `amount` for `ms`: setTargetAtTime in (tau 40 ms), back to 1 afterwards (tau 120 ms). A deeper active duck wins. */
  function duckGroup(group, amount, ms) {
    const g = buses[group];
    const st = duckState[group];
    if (!g || !st) return;
    const t = now();
    const a = clamp(Number.isFinite(amount) ? amount : 1, 0, 1);
    const until = t + Math.max(0, ms) / 1000;
    if (st.until > t) {
      st.amount = Math.min(st.amount, a);
      st.until = Math.max(st.until, until);
    } else {
      st.amount = a;
      st.until = until;
    }
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(st.amount, t, 0.04);
    g.gain.setTargetAtTime(1, st.until, 0.12);
    stats.ducked++;
  }

  // ---------------------------------------------------------------- master filter (slow motion dip, Freeze hold)
  function applyMasterFilter(mf) {
    const f = masterFilter.frequency;
    const t = now();
    if (mf.dipHz !== undefined) {
      if (freezeState.active) return; // Freeze holds its own filter
      f.cancelScheduledValues(t);
      f.setValueAtTime(20000, t);
      f.linearRampToValueAtTime(mf.dipHz, t + mf.downMs / 1000);
      f.linearRampToValueAtTime(20000, t + (mf.downMs + mf.upMs) / 1000);
    } else if (mf.holdHz !== undefined) {
      freezeState.active = true;
      freezeState.iceDone = false;
      f.cancelScheduledValues(t);
      f.setValueAtTime(20000, t);
      f.linearRampToValueAtTime(mf.holdHz, t + mf.rampMs / 1000);
    }
  }

  function releaseFreeze() {
    if (!freezeState.active) return;
    freezeState.active = false;
    const f = masterFilter.frequency;
    const t = now();
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value ?? 2500, t);
    f.linearRampToValueAtTime(20000, t + 0.3);
  }

  // ---------------------------------------------------------------- public API
  /** Per-sound parameter state that the callers cannot know: the stick tick alternates pitch, the countdown climbs 3-2-1. */
  function resolveParams(id, params) {
    if (id === 'uiMove') {
      seq.flip = !seq.flip;
      return { ...params, flip: seq.flip };
    }
    if (id === 'countdown') {
      if (params && Number.isFinite(params.n)) return params;
      const t = now();
      if (seq.countdownAt < 0 || t - seq.countdownAt > COUNTDOWN_RESET_S) seq.countdownIdx = 0;
      seq.countdownAt = t;
      const n = Math.max(1, 3 - seq.countdownIdx);
      seq.countdownIdx++;
      return { ...params, n };
    }
    if (id === 'go') {
      seq.countdownAt = -1;
      seq.countdownIdx = 0;
    }
    return params ?? {};
  }

  function play(id, params) {
    safe(() => {
      if (!running()) return;
      if (volume <= 0 || muted) return; // fully playable with volume 0 or muted: nothing to synthesise
      const rc = RECIPES[id];
      if (!rc) return;
      const p = resolveParams(id, params);
      const recipe = buildRecipe(id, p);
      if (recipe.continuous) return;
      if (recipe.minGapMs) {
        const t = now();
        const last = lastPlayAt.get(id);
        if (last !== undefined && (t - last) * 1000 < recipe.minGapMs) {
          stats.rateLimited++;
          return;
        }
        lastPlayAt.set(id, t);
      }
      playRecipe(recipe, p);
    });
  }

  /** Public ducking hook: pull `group` ('slice' | 'ui' | 'event') to `amount` (0..1) for `ms`. */
  function duck(group, amount, ms) {
    safe(() => {
      if (!running()) return;
      duckGroup(group, amount, ms);
    });
  }

  /** Stop every voice of a sound id (calHold stops the moment the sword moves). */
  function stop(id) {
    safe(() => {
      if (!ctx) return;
      for (let i = voices.length - 1; i >= 0; i--) {
        if (voices[i].id === id) {
          retire(voices[i]);
          voices.splice(i, 1);
        }
      }
    });
  }

  function handleGameEvent(ev) {
    safe(() => {
      if (!running()) return;
      switch (ev.type) {
        case 'cut':
          if (ev.kind === 'golden') play('golden', { x: ev.x });
          else play('slice', { r: ev.r, k: pentatonicSemitone(Math.max(0, ev.comboIndex - 1)), x: ev.x, jitter: 0.94 + random() * 0.12, ci: ev.comboIndex, fruit: ev.objType });
          break;
        case 'combo':
          if (ev.n >= 2) {
            if (ev.phase === 'close') play('comboChime', { n: ev.n });
            else if (ev.phase === 'update') play('comboStep', { n: ev.n });
          }
          break;
        case 'bomb': play('bombBoom', { x: ev.x }); break;
        case 'nearMiss': play('bombNear', { x: ev.x }); break;
        case 'telegraph': play('bombWarn', { x: ev.x }); break;
        case 'enter':
          if (ev.kind === 'golden') play('goldenSpawn', { x: ev.x });
          else if (ev.kind === 'powerup') play(`${ev.objType}Spawn`, { x: ev.x });
          break;
        case 'powerup':
          if (ev.phase === 'end') {
            play(`${ev.powerupId}End`);
            if (ev.powerupId === 'freeze') releaseFreeze();
          } else {
            play(`${ev.powerupId}Activate`);
          }
          break;
        case 'lifeLost': play('lifeLost'); break;
        case 'miss':
          // Classic only; a life-costing miss is followed by lifeLost, which plays its own sound
          if (mode === 'classic' && !ev.costsLife) play('miss');
          break;
        case 'slowmo':
          if (ev.reason !== 'freeze' && ev.reason !== 'hitStop') play('slowmo');
          break;
        case 'tick': play('tick', { urgent: ev.secondsLeft <= 3 }); break;
        case 'gameOver': play('gameOver'); break;
        case 'timeUp': play('timeUp'); break;
        default: break;
      }
    });
  }

  function ensureContinuous() {
    if (swoosh || !ctx) return;
    // swoosh: noise -> bandpass (Q 1.2) -> gain -> panner -> sliceBus
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 500;
    f.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    src.connect(f);
    f.connect(g);
    if (p) { g.connect(p); p.connect(buses.slice); } else g.connect(buses.slice);
    src.start(now(), random() * 1.5);
    swoosh = { src, f, g, p };
    // bomb fuse: noise -> bandpass 5000 Hz Q 8 -> gain with a 30 Hz tremolo (depth 0.5) -> panner -> eventBus
    const src2 = ctx.createBufferSource();
    src2.buffer = noiseBuffer;
    src2.loop = true;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 5000;
    f2.Q.value = 8;
    const g2 = ctx.createGain();
    g2.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 30;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0;
    lfo.connect(lfoGain);
    lfoGain.connect(g2.gain);
    const p2 = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    src2.connect(f2);
    f2.connect(g2);
    if (p2) { g2.connect(p2); p2.connect(buses.event); } else g2.connect(buses.event);
    src2.start(now(), random() * 1.5);
    lfo.start(now());
    fuse = { src: src2, g: g2, lfo, lfoGain, p: p2, level: 0 };
  }

  function update(dtS, c) {
    safe(() => {
      if (!running()) return;
      if (c.snapshot) mode = c.snapshot.mode;
      ensureContinuous();
      const t = now();
      if (t - seq.lastPrune > PRUNE_EVERY_S || t < seq.lastPrune) prune(); // release the nodes of finished voices even when nothing new plays
      const blade = c.blade;
      // swoosh: only while cutting, smoothed with a 20 ms time constant, 120 ms release tail
      const T = blade.cutThreshold;
      const tg = swooshTargets(blade.speed, T, blade.cutting && blade.trackingOk);
      const x = blade.head ? blade.head.x : 960;
      const audible = volume > 0 && !muted;
      const targetGain = audible ? tg.gain : 0;
      if (Math.abs(targetGain - lastSwoosh.gain) > 0.004 || (targetGain === 0 && lastSwoosh.gain !== 0)) {
        swoosh.g.gain.setTargetAtTime(targetGain, t, targetGain > lastSwoosh.gain ? 0.02 : 0.04);
        lastSwoosh.gain = targetGain;
      }
      if (targetGain > 0 && Math.abs(tg.centerHz - lastSwoosh.hz) > 30) {
        swoosh.f.frequency.setTargetAtTime(tg.centerHz, t, 0.02);
        lastSwoosh.hz = tg.centerHz;
      }
      if (swoosh.p && Math.abs(x - lastSwoosh.pan) > 8) {
        swoosh.p.pan.setTargetAtTime(panFor(x), t, 0.02);
        lastSwoosh.pan = x;
      }
      // bomb fuse: quiet sizzle while a bomb is on screen during play, panned to the nearest bomb
      let bombX = null;
      if (c.snapshot && c.screen === 'playing') {
        let best = Infinity;
        for (const o of c.snapshot.objects) {
          if (o.kind === 'bomb') {
            const d = Math.abs(o.x - 960);
            if (d < best) { best = d; bombX = o.x; }
          }
        }
      }
      const want = bombX !== null && audible ? 1 : 0;
      if (want !== fuse.level) {
        fuse.level = want;
        fuse.g.gain.setTargetAtTime(want ? 0.03 : 0, t, 0.05); // gain 0.03 ...
        fuse.lfoGain.gain.setTargetAtTime(want ? 0.03 * 0.5 : 0, t, 0.05); // ... with a 30 Hz tremolo of depth 0.5
      }
      if (bombX !== null && fuse.p) fuse.p.pan.setTargetAtTime(panFor(bombX), t, 0.05);
      // Freeze: three ice-crack ticks one second before the end; the filter is restored when Freeze is gone. "Gone" is also: no snapshot (the round was
      // ended or quit; the game emits no 'end' event then, and the low-pass used to stay at 2.5 kHz over every menu sound) and any screen that is not the
      // round itself (the results screen keeps the last snapshot, Freeze still in it).
      let fz = null;
      if (c.snapshot) for (const p of c.snapshot.powerups) if (p.id === 'freeze') fz = p;
      if (fz && (c.screen === 'playing' || c.screen === 'paused')) {
        if (fz.remainingS <= 1.0 && !freezeState.iceDone) {
          freezeState.iceDone = true;
          play('freezeCrack');
        }
      } else if (freezeState.active) {
        releaseFreeze();
      }
    });
    void dtS;
  }

  const engine = {
    unlock,
    get ready() { return !!ctx && ctx.state !== 'closed'; },
    setVolume(v01) {
      safe(() => {
        volume = clamp(Number.isFinite(v01) ? v01 : A.volumeDefault, 0, 1);
        if (ctx && masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : masterGainFor(volume, A), now(), 0.02);
      });
    },
    /** Runtime mute: silences everything at once (master gain 0) and stops synthesising until unmuted. */
    setMuted(on) {
      safe(() => {
        muted = !!on;
        if (ctx && masterGain) masterGain.gain.setTargetAtTime(muted ? 0 : masterGainFor(volume, A), now(), 0.02);
      });
    },
    get muted() { return muted; },
    play,
    stop,
    duck,
    handleGameEvent,
    update,
    suspend() { safe(() => { if (ctx && typeof ctx.suspend === 'function') ctx.suspend(); }); },
    resume() { safe(() => { if (ctx && typeof ctx.resume === 'function') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } }); },
    dispose() {
      safe(() => {
        for (const v of voices) { for (const src of v.sources) safe(() => src.stop()); releaseNodes(v); }
        for (const v of retiring) releaseNodes(v);
        voices.length = 0;
        retiring.length = 0;
        if (ctx && typeof ctx.close === 'function') ctx.close();
      });
    },
    /** Test / debug hook: voice list and counters. */
    getDebug() {
      return {
        voices: voices.map((v) => ({ id: v.id, prio: v.prio })),
        voiceCount: voices.length,
        retiring: retiring.length,
        stats: { ...stats },
        volume,
        muted,
        masterGain: masterGain ? masterGain.gain.value : null,
        freeze: freezeState.active,
        buses: { slice: buses.slice ? buses.slice.gain.value : null, event: buses.event ? buses.event.gain.value : null, ui: buses.ui ? buses.ui.gain.value : null },
        reverb: !!reverbIn,
      };
    },
    PRIORITY,
  };
  // the simple named functions of the header: engine.uiMove(), engine.countdown(3), engine.resultsFanfare(5), ...
  for (const [name, [id, toParams]] of Object.entries(NAMED)) {
    engine[name] = (...args) => play(id, toParams(...args));
  }
  return engine;
}
