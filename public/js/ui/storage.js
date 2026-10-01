// Persistent settings, best scores and flags. OWNER: Presentation engineer.
// docs/architecture.md 8.7, docs/game-design.md 7.5 and 14.
//
// Rules implemented here:
//   - ONE JSON document under one localStorage key ('joyconNinja.v1'): { v, best, settings, safetyAck, playMsTotal, notice }.
//     The key keeps its name; the version INSIDE the document is 2 since the sword-tuning round (docs/motion-contract.md 3.3).
//   - EVERY storage access is inside try/catch. Missing, blocked, throwing or corrupted storage never throws; the game keeps
//     everything in memory for the session and isPersistent() reports false.
//   - Values are validated and clamped on load and on every update (out-of-range settings snap to the nearest legal value).
//   - The separate key 'joyconNinja.imu.v1' (gyro scale tool) belongs to the diagnostics page and main.js, not to this module.
//   - MIGRATION v1 -> v2 (docs/motion-contract.md 3.3): `sensitivity` and `cutThreshold` changed their UNITS (the cut threshold went from
//     px/s to deg/s, the sensitivity became the multiplier of a speed-dependent pointer curve). A stored document whose `v` is missing or
//     below 2 keeps everything except those two settings, which are reset once to their new defaults, and raises a one-time notice
//     ('motion-2') that the UI shows as a toast and then acknowledges with ackNotice().

import { CONFIG } from '../game/config.js';

export const STORAGE_VERSION = 2;
export const DEFAULT_STORAGE_KEY = CONFIG?.storageKey ?? 'joyconNinja.v1';
export const MODES = Object.freeze(['classic', 'arcade', 'zen']);

/** The one notice the storage can raise: the sword controls were retuned and two settings were reset (see the migration above). */
export const NOTICE_MOTION_2 = 'motion-2';

/**
 * Legal ranges of the numeric settings (docs/motion-contract.md 3.1, docs/game-design.md 14).
 *   sensitivity  0.3 to 2.0, step 0.1: the multiplier of the whole pointer curve (MOTION_CONFIG.input.sensitivityRange agrees: test/ui/storage.test.js).
 *   cutThreshold 100 to 700 deg/s, step 25: the tip speed that slices (MOTION_CONFIG.cut.thresholdRange agrees).
 */
export const SETTINGS_SPEC = Object.freeze({
  sensitivity: Object.freeze({ min: 0.3, max: 2.0, step: 0.1 }),
  cutThreshold: Object.freeze({ min: 100, max: 700, step: 25 }),
  volume: Object.freeze({ min: 0, max: 1, step: 0.1 }),
});

export const SETTINGS_DEFAULTS = Object.freeze({
  sensitivity: 1.0,
  cutThreshold: 300,
  volume: 0.7,
  reduceFlash: false,
  reduceMotion: false,
  hand: 'right',
  autoCenter: true,
  dwellSelect: true,
  swordSelect: false, // "Sword selection in menus": Off = a real Joy-Con picks menu items with the stick and A only (no dwell, no cut); On = also by sword
  lethalBombs: false,
  flipX: false,
});

const BOOL_KEYS = ['reduceFlash', 'reduceMotion', 'autoCenter', 'dwellSelect', 'swordSelect', 'lethalBombs', 'flipX'];
/** The settings whose unit changed in version 2: a version 1 document loses exactly these two (they go back to SETTINGS_DEFAULTS). */
const V2_RESET_KEYS = Object.freeze(['sensitivity', 'cutThreshold']);

/** Snap a number to the nearest legal step inside [min, max]; non-finite input gives `fallback`. */
export function snapToSpec(value, spec, fallback) {
  const v = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(v)) return fallback;
  const clamped = Math.min(spec.max, Math.max(spec.min, v));
  const snapped = spec.min + Math.round((clamped - spec.min) / spec.step) * spec.step;
  return Number(Math.min(spec.max, Math.max(spec.min, snapped)).toFixed(6));
}

/**
 * Turn arbitrary input into a complete, legal Settings object. Unknown keys are dropped, illegal values fall back to
 * `base` (which is already legal).
 * @param {any} raw
 * @param {import('../shared/contracts.js').Settings} base
 */
export function sanitizeSettings(raw, base = SETTINGS_DEFAULTS) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = { ...base };
  for (const k of Object.keys(SETTINGS_SPEC)) out[k] = snapToSpec(src[k], SETTINGS_SPEC[k], base[k]);
  for (const k of BOOL_KEYS) out[k] = typeof src[k] === 'boolean' ? src[k] : base[k];
  out.hand = src.hand === 'left' || src.hand === 'right' ? src.hand : base.hand;
  return out;
}

function sanitizeBestEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const score = Number.isFinite(e.score) ? Math.max(0, Math.floor(e.score)) : Number.NaN;
  if (!Number.isFinite(score)) return null;
  const combo = Number.isFinite(e.combo) ? Math.max(0, Math.floor(e.combo)) : 0;
  const date = typeof e.date === 'string' ? e.date : '';
  return { score, combo, date };
}

function resolveBackend(explicit) {
  if (explicit !== undefined) return explicit;
  try {
    return globalThis.localStorage ?? null; // the getter itself throws when site data is blocked
  } catch {
    return null;
  }
}

function prefersReducedMotion(matchMedia) {
  try {
    const mm = matchMedia ?? globalThis.matchMedia;
    return typeof mm === 'function' ? !!mm.call(globalThis, '(prefers-reduced-motion: reduce)')?.matches : false;
  } catch {
    return false;
  }
}

/**
 * @param {{key?:string, backend?:{getItem:Function,setItem:Function}|null, matchMedia?:Function,
 *          now?:()=>string, overrides?:Partial<import('../shared/contracts.js').Settings>}} [deps]
 *   overrides (additive, logged in contract-notes): settings forced on top of the stored ones and never persisted
 *   (?reducemotion=1 and ?reduceflash=1 test flags).
 * @returns {import('../shared/contracts.js').StorageApi}
 */
export function createStorage(deps = {}) {
  const key = deps.key ?? DEFAULT_STORAGE_KEY;
  const backend = resolveBackend(deps.backend);
  const nowIso = deps.now ?? (() => new Date().toISOString());
  const overrides = deps.overrides ?? {};

  let persistent = backend !== null && backend !== undefined;
  const data = { v: STORAGE_VERSION, best: { classic: null, arcade: null, zen: null }, settings: null, safetyAck: false, playMsTotal: 0, notice: null };

  function load() {
    let text = null;
    try {
      if (!backend) throw new Error('no backend');
      text = backend.getItem(key);
    } catch {
      persistent = false;
      return;
    }
    if (text === null || text === undefined) return;
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return; // corrupted JSON: start from defaults; the next successful save overwrites it
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const best = parsed.best && typeof parsed.best === 'object' ? parsed.best : {};
    for (const m of MODES) data.best[m] = sanitizeBestEntry(best[m]);
    if (parsed.settings && typeof parsed.settings === 'object') {
      data.settings = parsed.settings;
    }
    data.safetyAck = parsed.safetyAck === true;
    data.playMsTotal = Number.isFinite(parsed.playMsTotal) ? Math.max(0, parsed.playMsTotal) : 0;
    if (Number.isFinite(parsed.v) && parsed.v >= STORAGE_VERSION) {
      // a current document: the notice it carries (still to be shown) is kept, anything else in that field is dropped
      data.notice = parsed.notice === NOTICE_MOTION_2 ? NOTICE_MOTION_2 : null;
    } else {
      // a version 1 document (or one without a version): the two retuned settings go back to their defaults, once, and the player is told
      if (data.settings) {
        data.settings = { ...data.settings };
        for (const k of V2_RESET_KEYS) delete data.settings[k];
      }
      data.notice = NOTICE_MOTION_2;
    }
  }

  const baseDefaults = () => ({ ...SETTINGS_DEFAULTS, reduceMotion: prefersReducedMotion(deps.matchMedia) });
  load();
  // A stored document without reduceMotion falls back to the prefers-reduced-motion default through `base`.
  let settings = sanitizeSettings(data.settings, baseDefaults());

  function save() {
    if (!backend) {
      persistent = false;
      return;
    }
    try {
      backend.setItem(
        key,
        JSON.stringify({ v: STORAGE_VERSION, best: data.best, settings, safetyAck: data.safetyAck, playMsTotal: data.playMsTotal, notice: data.notice }),
      );
      persistent = true;
    } catch {
      persistent = false; // keep working from memory
    }
  }

  // The merged settings are built once per change, not on every call (the UI reads them several times per frame; round 2 finding n8).
  // The object is frozen so that it can be shared: a caller that wants to change a setting uses updateSettings().
  let effectiveCache = null;
  let effectiveFor = null;
  const effective = () => {
    if (effectiveCache === null || effectiveFor !== settings) {
      effectiveCache = Object.freeze({ ...settings, ...overrides });
      effectiveFor = settings;
    }
    return effectiveCache;
  };
  const copyBest = (b) => (b ? { score: b.score, combo: b.combo, date: b.date } : null);

  return {
    getSettings: () => effective(),
    updateSettings(patch) {
      settings = sanitizeSettings({ ...settings, ...(patch && typeof patch === 'object' ? patch : {}) }, settings);
      save();
      return effective();
    },
    getBest: (mode) => copyBest(data.best[mode] ?? null),
    recordResult(mode, r) {
      if (!MODES.includes(mode)) return { isNewBest: false, best: { score: 0, combo: 0, date: '' } };
      const score = Number.isFinite(r?.score) ? Math.max(0, Math.floor(r.score)) : 0;
      const combo = Number.isFinite(r?.combo) ? Math.max(0, Math.floor(r.combo)) : 0;
      const prev = data.best[mode];
      const isNewBest = score > 0 && score > (prev ? prev.score : 0);
      if (isNewBest) {
        data.best[mode] = { score, combo: Math.max(combo, prev ? prev.combo : 0), date: nowIso() };
        save();
      } else if (prev && combo > prev.combo) {
        data.best[mode] = { ...prev, combo };
        save();
      }
      return { isNewBest, best: copyBest(data.best[mode]) ?? { score: 0, combo: 0, date: '' } };
    },
    resetBest() {
      for (const m of MODES) data.best[m] = null;
      save();
    },
    getNotice: () => data.notice,
    ackNotice() {
      if (data.notice === null) return;
      data.notice = null;
      save(); // the document on disk is version 2 from now on
    },
    getSafetyAck: () => data.safetyAck,
    setSafetyAck() {
      data.safetyAck = true;
      save();
    },
    addPlayMs(ms) {
      if (Number.isFinite(ms) && ms > 0) data.playMsTotal += ms;
      save();
      return data.playMsTotal;
    },
    isPersistent: () => persistent,
  };
}
