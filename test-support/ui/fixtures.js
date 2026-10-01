// Fixtures for the Presentation tests: contract-conforming snapshots, events, blade views, provider facts, storage backends
// and a ready-made UI harness. OWNER: Presentation engineer. Every builder output passes assertValid (see the tests).

import { createManualClock } from '../../public/js/shared/clock.js';
import { createStorage } from '../../public/js/ui/storage.js';
import { createUi } from '../../public/js/ui/ui.js';

export const FRUIT_R = { watermelon: 92, pineapple: 82, apple: 68, orange: 68, pear: 66, peach: 64, lemon: 60, kiwi: 58, strawberry: 52, cherry: 48 };

export function makeObject(over = {}) {
  const type = over.type ?? 'apple';
  const kind = over.kind ?? 'fruit';
  const r = over.r ?? (kind === 'bomb' ? 64 : kind === 'powerup' ? 62 : kind === 'golden' ? 64 : FRUIT_R[type] ?? 68);
  return {
    id: 1, kind, type: kind === 'bomb' ? 'bomb' : type, x: 960, y: 500, px: 960, py: 505, rot: 0.2, prot: 0.18, vx: 0, vy: -100, r,
    hitR: Math.round(r * (kind === 'bomb' ? 0.85 : 1.25)), ageS: 0.5, ...over,
  };
}

export function makeHalf(over = {}) {
  return {
    id: 1000001, parentType: 'apple', side: 1, cutAngleRad: 0, x: 960, y: 500, px: 958, py: 498, rot: 0.3, prot: 0.28, vx: 100, vy: -50, r: 68, ...over,
  };
}

export function makeSnapshot(over = {}) {
  return {
    v: 1, mode: 'classic', seed: 1, phase: 'running', t: 5, tWorld: 5, waveIndex: 2, stage: 1, alpha: 0.5, timeScale: 1, score: 120,
    lives: 3, timeLeft: null, timeTotal: null, lifeRegen: { progress: 0, per: 25 }, combo: { swingId: 0, n: 0, open: false }, powerups: [],
    objects: [], halves: [], telegraphs: [], mercyActive: false, stats: { fruitCut: 8, fruitMissed: 1, bombsHit: 0, bestCombo: 2, powerupsTaken: 0 },
    practice: null, endReason: null, events: [], ...over,
  };
}

/**
 * A BladeView as app.js builds it (docs/motion-contract.md 4.4). `speed` and `cutThreshold` are in px/s-equivalent (1000 = 300 deg/s, D6); `speedDps` and
 * `cutThresholdDps` are in deg/s and follow `speed` unless a test sets them: a test that only says `speed: 2500` still gets a consistent deg/s reading.
 */
export function makeBlade(over = {}) {
  const blade = { samples: [], latest: null, head: { x: 960, y: 540 }, cutting: false, speed: 0, trackingOk: true, cutThreshold: 1000, ...over };
  if (!('speedDps' in over)) blade.speedDps = blade.speed * 0.3;
  if (!('cutThresholdDps' in over)) blade.cutThresholdDps = blade.cutThreshold * 0.3;
  return blade;
}

export function bladeSample(over = {}) {
  return {
    t: 0, x: 960, y: 540, speed: 0, cutting: false, swingId: 0, segmentValid: false, x0: 960, y0: 540, t0: 0, discontinuity: false, trackingOk: true,
    angularSpeedDps: null, source: 'aim', ...over,
  };
}

export const seg = (x0, y0, x1, y1, over = {}) => ({ t0: 0, x0, y0, t1: 1, x1, y1, speed: 3000, swingId: 1, ...over });

export function makeStep(over = {}) {
  return { nowMs: 0, dtS: 1 / 60, snapshot: null, events: [], blade: makeBlade(), segments: [], debug: false, ...over };
}

let seq = 0;
const ev = (type, fields) => ({ seq: ++seq, t: 1, type, ...fields });

export function cutEvent(over = {}) {
  return ev('cut', {
    id: 1, kind: 'fruit', objType: 'apple', x: 960, y: 500, r: 68, angleRad: 0.3, nx: -Math.sin(0.3), ny: Math.cos(0.3), points: 15, doubled: false,
    comboIndex: 1, swingId: 1, speed: 2500, halfIds: [1000001, 1000002], ...over,
  });
}
export const comboEvent = (over = {}) => ev('combo', { phase: 'close', n: 3, swingId: 1, bonus: 30, x: 900, y: 480, ...over });
export const bombEvent = (over = {}) => ev('bomb', { id: 9, x: 700, y: 600, lethal: false, scoreDelta: 0, timeDeltaS: 0, lifeLost: true, ...over });
export const powerupEvent = (over = {}) => ev('powerup', { phase: 'activate', powerupId: 'freeze', x: 960, y: 400, durationS: 5, ...over });
export const lifeLostEvent = (over = {}) => ev('lifeLost', { livesLeft: 2, cause: 'miss', ...over });
export const missEvent = (over = {}) => ev('miss', { id: 4, objType: 'apple', x: 800, costsLife: true, ...over });
export const gameOverEvent = (over = {}) => ev('gameOver', { reason: 'lives', score: 300, ...over });
export const timeUpEvent = (over = {}) => ev('timeUp', { score: 800, ...over });
export const tickEvent = (over = {}) => ev('tick', { secondsLeft: 9, ...over });
export const telegraphEvent = (over = {}) => ev('telegraph', { x: 500, inMs: 350, ...over });
export const practiceEvent = (over = {}) => ev('practice', { phase: 'cut', ...over });
export const slowmoEvent = (over = {}) => ev('slowmo', { reason: 'combo4', scale: 0.35, ms: 450, ...over });
export const nearMissEvent = (over = {}) => ev('nearMiss', { id: 9, x: 700, y: 600, dist: 90, ...over });
export const timeBonusEvent = (over = {}) => ev('timeBonus', { deltaS: 4, cause: 'clock', timeLeft: 40, ...over });

export function roundResult(over = {}) {
  return { mode: 'classic', score: 1234, fruitCut: 80, bestCombo: 4, accuracy: 0.9, bombsHit: 1, powerupsTaken: 2, durationS: 135, endReason: 'lives', ...over };
}

// ---------------------------------------------------------------- provider facts
export function makeStatus(over = {}) {
  return {
    kind: 'joycon', state: 'idle', side: '?', battery: { mv: null, level: 'unknown', pct: null }, trackingOk: false, error: null, cooldownUntil: null, failures: 0,
    deviceName: null, packetRateHz: null, lastPacketAt: null, featureMask: null, ...over,
  };
}

const LABELS = {
  joycon: { confirm: 'A', back: 'B', pause: '+', recenter: 'ZR', section: 'R' },
  keyboard: { confirm: 'Enter', back: 'Esc', pause: 'P', recenter: 'Space', section: 'PgUp/PgDn' },
};

export function providerFact(kind, state, over = {}) {
  const status = kind ? makeStatus({ kind, state, trackingOk: state === 'streaming', ...over }) : null;
  return {
    type: 'provider', kind, status, labels: kind === 'joycon' ? LABELS.joycon : LABELS.keyboard,
    capabilities: { imu: kind !== 'mouse', aim: kind === 'mouse', buttons: kind === 'joycon', needsUserGesture: kind === 'joycon', needsCalibration: kind === 'joycon', hasBattery: kind === 'joycon', canVibrate: kind === 'joycon' },
  };
}

export const actionFact = (action, source = 'keyboard') => ({ type: 'action', event: { t: 0, action, label: action, source } });

// ---------------------------------------------------------------- native Bluetooth bridge facts (docs/native-bridge.md)
/** A `provider` fact of the native bridge: kind 'joycon', transport 'native'. */
export const nativeFact = (state, over = {}) => ({ ...providerFact('joycon', state, over), transport: 'native' });
/** An InputErrorInfo of the native bridge: `code` is the InputErrorInfo code, `bridgeCode`/`key` the native part. */
export const nativeError = (code, bridgeCode, key) => ({ code, message: 'm', retryable: code !== 'unsupported_browser', at: 0, native: { code: bridgeCode, key } });
/** The `bridgeProbe` fact: the probe of GET /__bridge/status. */
export const probeFact = (phase, over = {}) => (phase === 'checking'
  ? { type: 'bridgeProbe', phase, preferred: over.preferred ?? null }
  : { type: 'bridgeProbe', phase: 'done', available: true, reason: null, canBuild: false, built: true, preferred: null, ...over });
/** The `bridge` fact: progress of an attempt (the provider's 'bridge' event). */
export const progressFact = (phase, over = {}) => ({
  type: 'bridge', phase, key: phase === 'waitingData' ? 'connect.native.progress.waitingData' : `connect.native.progress.${phase}`, scanStartedAt: null, scanSeconds: 45, ...over,
});

// ---------------------------------------------------------------- storage backends
export function memoryBackend(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } };
}

export function throwingBackend() {
  const boom = () => { throw new Error('storage blocked'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

// ---------------------------------------------------------------- UI harness
/**
 * A UI with a manual clock, a memory storage and recorders for intents and sounds.
 * `advance(ms)` steps the UI in 16 ms slices with an idle blade.
 */
export function makeUiHarness(opts = {}) {
  const clock = createManualClock(opts.startMs ?? 0);
  const storage = opts.storage ?? createStorage({ backend: memoryBackend(), matchMedia: () => ({ matches: false }) });
  const intents = [];
  const sounds = [];
  const stops = [];
  const effects = [];
  const ui = createUi({
    clock, storage, hasBluetooth: opts.hasBluetooth ?? true,
    sfx: (id, params) => sounds.push([id, params]), sfxStop: (id) => stops.push(id), onEffect: (n, p) => effects.push([n, p]),
  });
  ui.onIntent((i) => intents.push(i));
  const h = {
    ui, clock, storage, intents, sounds, stops, effects,
    view: ui.getView(),
    step(over = {}) {
      // default blade: no cursor position, so that a resting cursor never dwells on a target by accident
      ui.step(makeStep({ nowMs: clock.now(), blade: makeBlade({ head: null, trackingOk: false }), ...over }));
    },
    advance(ms, over = {}) {
      let left = ms;
      while (left > 0) {
        const d = Math.min(16, left);
        clock.advance(d);
        h.step(typeof over === 'function' ? over() : over);
        left -= d;
      }
    },
    intentTypes: () => intents.map((i) => i.type),
    lastIntent: () => intents[intents.length - 1],
    clearRecords() { intents.length = 0; sounds.length = 0; stops.length = 0; effects.length = 0; },
    soundIds: () => sounds.map((s) => s[0]),
    state: () => ui.getState(),
    /** Boot into the menu with a simulator provider (the ?input=sim path). */
    toMenuWithSim() {
      storage.setSafetyAck();
      ui.notify(providerFact('sim', 'streaming'));
      ui.notify({ type: 'ready' });
      return h;
    },
    toPlaying(mode = 'classic') {
      h.toMenuWithSim();
      ui.force('playing', { roundMode: mode });
      h.step();
      return h;
    },
  };
  return h;
}
