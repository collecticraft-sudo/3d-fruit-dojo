// Storage: defaults, validation and clamping, best-score rules, survival of every kind of broken storage, and the version 1 -> 2 migration of the
// sword-tuning round (docs/architecture.md 8.7, docs/game-design.md 7.5 and 14, docs/motion-contract.md 3.1 and 3.3, invariant 16.5 item 12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION_CONFIG } from '../../public/js/motion/motion-config.js';
import { DEFAULT_STORAGE_KEY, NOTICE_MOTION_2, STORAGE_VERSION, SETTINGS_DEFAULTS, createStorage, sanitizeSettings, snapToSpec, SETTINGS_SPEC } from '../../public/js/ui/storage.js';
import { memoryBackend, throwingBackend } from '../../test-support/ui/fixtures.js';

const noMotionPref = () => ({ matches: false });
const mk = (opts = {}) => createStorage({ backend: memoryBackend(), matchMedia: noMotionPref, ...opts });

test('the storage key is joyconNinja.v1 and the defaults are those of design section 14', () => {
  assert.equal(DEFAULT_STORAGE_KEY, 'joyconNinja.v1');
  const s = mk().getSettings();
  assert.deepEqual(s, { sensitivity: 1, cutThreshold: 300, volume: 0.7, reduceFlash: false, reduceMotion: false, hand: 'right', autoCenter: true, dwellSelect: true, swordSelect: false, lethalBombs: false, flipX: false });
  assert.equal(STORAGE_VERSION, 2, 'the document inside the unchanged key is version 2 since the sword-tuning round');
  assert.equal(mk().getNotice(), null, 'a first run has nothing to announce');
  assert.deepEqual(SETTINGS_DEFAULTS, s);
  assert.equal(mk().getSafetyAck(), false);
  assert.equal(mk().getBest('classic'), null);
  assert.equal(mk().isPersistent(), true);
});

test('reduceMotion defaults to true when the browser reports prefers-reduced-motion, but a stored choice wins', () => {
  const yes = () => ({ matches: true });
  assert.equal(createStorage({ backend: memoryBackend(), matchMedia: yes }).getSettings().reduceMotion, true);
  const st = createStorage({ backend: memoryBackend(), matchMedia: yes });
  st.updateSettings({ reduceMotion: false });
  assert.equal(st.getSettings().reduceMotion, false);
  const stored = memoryBackend({ [DEFAULT_STORAGE_KEY]: JSON.stringify({ v: 2, settings: { reduceMotion: false } }) });
  assert.equal(createStorage({ backend: stored, matchMedia: yes }).getSettings().reduceMotion, false, 'a stored false is not overridden by the media query');
  let asked = null;
  createStorage({ backend: memoryBackend(), matchMedia: (q) => { asked = q; return { matches: false }; } });
  assert.equal(asked, '(prefers-reduced-motion: reduce)');
  assert.doesNotThrow(() => createStorage({ backend: memoryBackend(), matchMedia: () => { throw new Error('nope'); } }));
});

test('settings are validated: values snap to the nearest legal step and clamp to the range (sensitivity 0.3 to 2.0, slice threshold 100 to 700 deg/s in steps of 25)', () => {
  const st = mk();
  st.updateSettings({ sensitivity: 3.7, cutThreshold: 50, volume: -2 });
  assert.deepEqual([st.getSettings().sensitivity, st.getSettings().cutThreshold, st.getSettings().volume], [2, 100, 0]);
  st.updateSettings({ sensitivity: 0.1, cutThreshold: 1400 });
  assert.deepEqual([st.getSettings().sensitivity, st.getSettings().cutThreshold], [0.3, 700], 'the sensitivity minimum is 0.3 now, and an old px/s value clamps to the 700 deg/s maximum');
  st.updateSettings({ sensitivity: 1.26, cutThreshold: 349, volume: 0.66 });
  assert.deepEqual([st.getSettings().sensitivity, st.getSettings().cutThreshold, st.getSettings().volume], [1.3, 350, 0.7]);
  st.updateSettings({ sensitivity: 'fast', cutThreshold: NaN, volume: null, hand: 'both', reduceFlash: 'yes', autoCenter: 1 });
  const s = st.getSettings();
  assert.deepEqual([s.sensitivity, s.cutThreshold, s.volume, s.hand, s.reduceFlash, s.autoCenter], [1.3, 350, 0.7, 'right', false, true], 'illegal values keep the current legal ones');
  assert.equal(snapToSpec(0.94, SETTINGS_SPEC.sensitivity, 1), 0.9);
  assert.equal(snapToSpec(0.25, SETTINGS_SPEC.sensitivity, 1), 0.3);
  assert.equal(snapToSpec(Infinity, SETTINGS_SPEC.sensitivity, 1), 1);
  assert.equal(Number.isInteger(snapToSpec(300.4, SETTINGS_SPEC.cutThreshold, 300)), true);
  // the threshold lands on multiples of 25 counted from 100
  for (const [input, want] of [[100, 100], [111, 100], [112.4, 100], [113, 125], [299, 300], [310, 300], [313, 325], [437, 425], [699, 700], [-5, 100]]) {
    assert.equal(snapToSpec(input, SETTINGS_SPEC.cutThreshold, 300), want, `${input}`);
  }
  assert.equal(st.updateSettings({ hand: 'left' }).hand, 'left');
  assert.equal(st.updateSettings(null).hand, 'left', 'a null patch changes nothing');
});

test('every legal step value survives a round trip exactly (no float drift): sensitivity and volume 0.1 steps, threshold 25 deg/s steps', () => {
  const st = mk();
  for (let i = 3; i <= 20; i++) {
    const v = Number((i / 10).toFixed(1));
    st.updateSettings({ sensitivity: v });
    assert.equal(st.getSettings().sensitivity, v);
  }
  for (let i = 0; i <= 10; i++) {
    const v = i / 10;
    st.updateSettings({ volume: v });
    assert.equal(st.getSettings().volume, v);
  }
  for (let v = 100; v <= 700; v += 25) {
    st.updateSettings({ cutThreshold: v });
    assert.equal(st.getSettings().cutThreshold, v);
  }
});

test('SETTINGS_SPEC and MOTION_CONFIG agree on the two retuned settings (range, step, default), so the pipeline clamps exactly what the UI offers', () => {
  const [sMin, sMax, sStep] = MOTION_CONFIG.input.sensitivityRange;
  assert.deepEqual({ ...SETTINGS_SPEC.sensitivity }, { min: sMin, max: sMax, step: sStep }, 'sensitivity: SETTINGS_SPEC = MOTION_CONFIG.input.sensitivityRange');
  const [cMin, cMax, cStep] = MOTION_CONFIG.cut.thresholdRange;
  assert.deepEqual({ ...SETTINGS_SPEC.cutThreshold }, { min: cMin, max: cMax, step: cStep }, 'cutThreshold: SETTINGS_SPEC = MOTION_CONFIG.cut.thresholdRange');
  assert.equal(SETTINGS_DEFAULTS.sensitivity, MOTION_CONFIG.input.sensitivityDefault);
  assert.equal(SETTINGS_DEFAULTS.cutThreshold, MOTION_CONFIG.cut.thresholdDefault);
  assert.deepEqual([SETTINGS_SPEC.cutThreshold.min, SETTINGS_SPEC.cutThreshold.max, SETTINGS_SPEC.cutThreshold.step, SETTINGS_DEFAULTS.cutThreshold], [100, 700, 25, 300], 'the contract numbers (docs/motion-contract.md 3.1)');
});

test('persistence: settings, best scores, safety flag and play time survive a reload', () => {
  const backend = memoryBackend();
  const a = createStorage({ backend, matchMedia: noMotionPref, now: () => '2026-09-30T10:00:00.000Z' });
  a.updateSettings({ sensitivity: 1.5, hand: 'left', dwellSelect: false });
  a.recordResult('arcade', { score: 1500, combo: 4 });
  a.setSafetyAck();
  a.addPlayMs(120000);
  const b = createStorage({ backend, matchMedia: noMotionPref });
  assert.equal(b.getSettings().sensitivity, 1.5);
  assert.equal(b.getSettings().hand, 'left');
  assert.equal(b.getSettings().dwellSelect, false);
  assert.deepEqual(b.getBest('arcade'), { score: 1500, combo: 4, date: '2026-09-30T10:00:00.000Z' });
  assert.equal(b.getSafetyAck(), true);
  assert.equal(b.addPlayMs(30000), 150000);
  const doc = JSON.parse(backend.getItem('joyconNinja.v1'));
  assert.equal(doc.v, 2);
  assert.equal(doc.notice, null);
  assert.deepEqual(Object.keys(doc).sort(), ['best', 'notice', 'playMsTotal', 'safetyAck', 'settings', 'v']);
  assert.deepEqual(Object.keys(doc.best).sort(), ['arcade', 'classic', 'zen']);
});

test('best score rule: a new best only when strictly greater and above 0; best combo tracked separately', () => {
  const st = mk({ now: () => 'D' });
  let r = st.recordResult('classic', { score: 0, combo: 0 });
  assert.equal(r.isNewBest, false);
  assert.equal(st.getBest('classic'), null, 'a score of 0 is never a record');
  r = st.recordResult('classic', { score: 500, combo: 3 });
  assert.equal(r.isNewBest, true);
  assert.deepEqual(r.best, { score: 500, combo: 3, date: 'D' });
  r = st.recordResult('classic', { score: 500, combo: 6 });
  assert.equal(r.isNewBest, false, 'equal is not strictly greater');
  assert.equal(st.getBest('classic').score, 500);
  assert.equal(st.getBest('classic').combo, 6, 'a better combo is kept even without a better score');
  r = st.recordResult('classic', { score: 400, combo: 1 });
  assert.equal(r.isNewBest, false);
  assert.equal(r.best.score, 500);
  r = st.recordResult('classic', { score: 501, combo: 2 });
  assert.equal(r.isNewBest, true);
  assert.equal(st.getBest('classic').combo, 6, 'the best combo never goes down');
  assert.equal(st.getBest('zen'), null, 'modes are independent');
  assert.equal(st.recordResult('practice', { score: 9, combo: 1 }).isNewBest, false, 'unknown modes are ignored');
  assert.equal(st.recordResult('classic', { score: 'x', combo: -3 }).isNewBest, false);
});

test('getBest returns copies; resetBest clears the records only (settings and safety stay)', () => {
  const st = mk();
  st.recordResult('zen', { score: 700, combo: 2 });
  st.setSafetyAck();
  st.updateSettings({ hand: 'left' });
  const b = st.getBest('zen');
  b.score = 1;
  assert.equal(st.getBest('zen').score, 700);
  st.resetBest();
  assert.equal(st.getBest('zen'), null);
  assert.equal(st.getSafetyAck(), true);
  assert.equal(st.getSettings().hand, 'left');
});

test('STORAGE FAILURE: every access throws -> nothing throws, everything lives in memory, isPersistent() is false', () => {
  const st = createStorage({ backend: throwingBackend(), matchMedia: noMotionPref });
  assert.equal(st.isPersistent(), false);
  assert.doesNotThrow(() => {
    st.updateSettings({ volume: 0.2 });
    st.recordResult('classic', { score: 1000, combo: 5 });
    st.setSafetyAck();
    st.addPlayMs(5000);
    st.resetBest();
  });
  assert.equal(st.getSettings().volume, 0.2);
  st.recordResult('arcade', { score: 42, combo: 1 });
  assert.equal(st.getBest('arcade').score, 42, 'kept in memory for the session');
  assert.equal(st.getSafetyAck(), true);
  assert.equal(st.isPersistent(), false);
});

test('a backend that fails only on write: the session continues from memory', () => {
  const inner = memoryBackend();
  const backend = { getItem: (k) => inner.getItem(k), setItem: () => { throw new Error('QuotaExceededError'); } };
  const st = createStorage({ backend, matchMedia: noMotionPref });
  assert.equal(st.isPersistent(), true, 'reading worked');
  st.updateSettings({ hand: 'left' });
  assert.equal(st.isPersistent(), false);
  assert.equal(st.getSettings().hand, 'left');
});

test('missing backend (undefined or null) and a blocked localStorage getter are survived', () => {
  const none = createStorage({ backend: null, matchMedia: noMotionPref });
  assert.equal(none.isPersistent(), false);
  none.updateSettings({ volume: 0.5 });
  assert.equal(none.getSettings().volume, 0.5);
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  try {
    const blocked = createStorage({ matchMedia: noMotionPref });
    assert.equal(blocked.isPersistent(), false);
    blocked.setSafetyAck();
    assert.equal(blocked.getSafetyAck(), true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('corrupted JSON and wrong shapes fall back to defaults without throwing, and a later save repairs the key', () => {
  for (const junk of ['{not json', 'null', '42', '"text"', '[]', '{"settings": 5, "best": "x"}']) {
    const backend = memoryBackend({ [DEFAULT_STORAGE_KEY]: junk });
    const st = createStorage({ backend, matchMedia: noMotionPref });
    assert.deepEqual(st.getSettings(), SETTINGS_DEFAULTS, junk);
    assert.equal(st.getBest('classic'), null);
    st.updateSettings({ hand: 'left' });
    assert.doesNotThrow(() => JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY)), 'repaired');
    assert.equal(JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY)).v, 2, 'and the repaired document is version 2');
  }
  // no notice for text that is not a document (nothing of the player's was lost); only a genuine object of an older version raises it
  for (const junk of ['{not json', 'null', '42', '"text"', '[]']) {
    assert.equal(createStorage({ backend: memoryBackend({ [DEFAULT_STORAGE_KEY]: junk }), matchMedia: noMotionPref }).getNotice(), null, `${junk}: no notice`);
  }
});

test('stored values are validated on load: out-of-range settings snap, bad best entries are dropped', () => {
  const doc = {
    v: 2,
    best: { classic: { score: 1234.9, combo: 4, date: '2026-01-01' }, arcade: { score: 'x' }, zen: { score: -50, combo: 'a', date: 5 } },
    settings: { sensitivity: 9, cutThreshold: 123, volume: 5, hand: 'up', reduceFlash: 'true', dwellSelect: false, unknown: 1 },
    safetyAck: 'yes', playMsTotal: -5,
  };
  const st = createStorage({ backend: memoryBackend({ [DEFAULT_STORAGE_KEY]: JSON.stringify(doc) }), matchMedia: noMotionPref });
  const s = st.getSettings();
  assert.deepEqual([s.sensitivity, s.cutThreshold, s.volume, s.hand, s.reduceFlash, s.dwellSelect], [2, 125, 1, 'right', false, false]);
  assert.deepEqual(st.getBest('classic'), { score: 1234, combo: 4, date: '2026-01-01' });
  assert.equal(st.getBest('arcade'), null);
  assert.deepEqual(st.getBest('zen'), { score: 0, combo: 0, date: '' }, 'negative scores are clamped to 0');
  assert.equal(st.getSafetyAck(), false, 'only a real boolean true counts');
  assert.equal(st.addPlayMs(0), 0);
  assert.equal('unknown' in s, false);
});

test('overrides are forced on top of the stored settings and are never persisted (?reducemotion=1, ?reduceflash=1)', () => {
  const backend = memoryBackend();
  const st = createStorage({ backend, matchMedia: noMotionPref, overrides: { reduceMotion: true, reduceFlash: true } });
  assert.equal(st.getSettings().reduceMotion, true);
  st.updateSettings({ reduceMotion: false });
  assert.equal(st.getSettings().reduceMotion, true, 'still forced');
  assert.equal(JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY)).settings.reduceMotion, false, 'the stored choice is untouched');
});

test('sanitizeSettings drops unknown keys and keeps a complete object', () => {
  const s = sanitizeSettings({ hand: 'left', foo: 1, sensitivity: 1.04 });
  assert.equal(s.hand, 'left');
  assert.equal(s.sensitivity, 1);
  assert.equal(s.foo, undefined);
  assert.equal(Object.keys(s).length, Object.keys(SETTINGS_DEFAULTS).length);
});

test('addPlayMs accumulates and ignores nonsense', () => {
  const st = mk();
  assert.equal(st.addPlayMs(1000), 1000);
  assert.equal(st.addPlayMs(-500), 1000);
  assert.equal(st.addPlayMs(NaN), 1000);
  assert.equal(st.addPlayMs(2500), 3500);
});

test('n8: getSettings() returns one shared frozen object until a setting changes (no allocation per frame), updateSettings() gives a new one', () => {
  const st = mk();
  const a = st.getSettings();
  assert.equal(st.getSettings(), a, 'same object while nothing changed');
  assert.ok(Object.isFrozen(a));
  assert.throws(() => { a.sensitivity = 2; }, TypeError);
  const b = st.updateSettings({ sensitivity: 1.4 });
  assert.notEqual(b, a);
  assert.equal(st.getSettings(), b);
  assert.equal(a.sensitivity, 1, 'the old snapshot is untouched');
  assert.equal(b.sensitivity, 1.4);
  assert.equal(st.getSettings().cutThreshold, 300);
  // an override (?reducemotion) is part of the shared object and never persisted
  const o = createStorage({ backend: memoryBackend(), matchMedia: () => ({ matches: false }), overrides: { reduceMotion: true } });
  assert.equal(o.getSettings().reduceMotion, true);
  assert.equal(o.getSettings(), o.getSettings());
});

// ---------------------------------------------------------------------------------------------------------------- migration v1 -> v2

const V1_DOC = {
  v: 1,
  best: { classic: { score: 4200, combo: 9, date: '2026-09-30T08:00:00.000Z' }, arcade: { score: 1500, combo: 4, date: '2026-09-30T09:00:00.000Z' }, zen: null },
  settings: { sensitivity: 1.5, cutThreshold: 1400, volume: 0.3, reduceFlash: true, reduceMotion: false, hand: 'left', autoCenter: false, dwellSelect: false, lethalBombs: false, flipX: true },
  safetyAck: true,
  playMsTotal: 754321,
};
const withDoc = (doc) => memoryBackend({ [DEFAULT_STORAGE_KEY]: JSON.stringify(doc) });

test('MIGRATION: a v1 document keeps everything except the two retuned settings, which go back to 1.0 and 300 deg/s, and raises the one-time notice', () => {
  const backend = withDoc(V1_DOC);
  const st = createStorage({ backend, matchMedia: noMotionPref });
  assert.equal(JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY)).v, 1, 'nothing is written by loading: the migration is idempotent until the first save');
  const s = st.getSettings();
  assert.deepEqual([s.sensitivity, s.cutThreshold], [1, 300], 'the old px/s value would read as 1400 deg/s and the old sensitivity has another meaning');
  assert.deepEqual([s.volume, s.reduceFlash, s.reduceMotion, s.hand, s.autoCenter, s.dwellSelect, s.lethalBombs, s.flipX], [0.3, true, false, 'left', false, false, false, true], 'every other setting is intact');
  assert.deepEqual(st.getBest('classic'), V1_DOC.best.classic);
  assert.deepEqual(st.getBest('arcade'), V1_DOC.best.arcade);
  assert.equal(st.getBest('zen'), null);
  assert.equal(st.getSafetyAck(), true);
  assert.equal(st.getNotice(), NOTICE_MOTION_2);
  assert.equal(NOTICE_MOTION_2, 'motion-2');
  assert.equal(st.addPlayMs(0), 754321, 'the play time of the old document is kept (addPlayMs saves, which upgrades the document)');
  assert.equal(JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY)).v, 2);
});

test('MIGRATION: ackNotice() clears the notice and saves; the document on disk is version 2 with the new defaults, and a reload shows no notice', () => {
  const backend = withDoc(V1_DOC);
  const st = createStorage({ backend, matchMedia: noMotionPref });
  st.ackNotice();
  assert.equal(st.getNotice(), null);
  const doc = JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY));
  assert.equal(doc.v, 2);
  assert.equal(doc.notice, null);
  assert.deepEqual([doc.settings.sensitivity, doc.settings.cutThreshold, doc.settings.volume, doc.settings.hand], [1, 300, 0.3, 'left']);
  assert.deepEqual(doc.best.classic, V1_DOC.best.classic);
  assert.equal(doc.safetyAck, true);
  assert.equal(doc.playMsTotal, 754321);
  const again = createStorage({ backend, matchMedia: noMotionPref });
  assert.equal(again.getNotice(), null, 'the notice is shown once');
  assert.deepEqual([again.getSettings().sensitivity, again.getSettings().cutThreshold, again.getSettings().volume], [1, 300, 0.3]);
  backend.map.set(DEFAULT_STORAGE_KEY, backend.getItem(DEFAULT_STORAGE_KEY));
  again.ackNotice();
  assert.equal(backend.getItem(DEFAULT_STORAGE_KEY), JSON.stringify(doc), 'a second acknowledgement is a no-op (nothing rewritten)');
});

test('MIGRATION: the first ordinary save also upgrades the document, and the notice survives it until it is acknowledged', () => {
  const backend = withDoc(V1_DOC);
  const st = createStorage({ backend, matchMedia: noMotionPref });
  st.updateSettings({ volume: 0.5 });
  const doc = JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY));
  assert.deepEqual([doc.v, doc.notice, doc.settings.cutThreshold, doc.settings.sensitivity, doc.settings.volume], [2, 'motion-2', 300, 1, 0.5]);
  const reload = createStorage({ backend, matchMedia: noMotionPref });
  assert.equal(reload.getNotice(), 'motion-2', 'not shown yet, so it is still pending after a reload');
  assert.deepEqual([reload.getSettings().cutThreshold, reload.getSettings().sensitivity, reload.getSettings().volume], [300, 1, 0.5], 'the reset is not repeated over a value the player changed since');
  reload.updateSettings({ cutThreshold: 450, sensitivity: 0.6 });
  const third = createStorage({ backend, matchMedia: noMotionPref });
  assert.deepEqual([third.getSettings().cutThreshold, third.getSettings().sensitivity], [450, 0.6], 'a v2 document is never reset again, whatever notice it carries');
  assert.equal(third.getNotice(), 'motion-2');
});

test('MIGRATION: a document without a version counts as version 1; version 2 and later documents are read as they are (clamped), with no reset', () => {
  const noVersion = { ...V1_DOC };
  delete noVersion.v;
  const a = createStorage({ backend: withDoc(noVersion), matchMedia: noMotionPref });
  assert.deepEqual([a.getSettings().sensitivity, a.getSettings().cutThreshold, a.getNotice()], [1, 300, 'motion-2']);
  const weird = createStorage({ backend: withDoc({ ...V1_DOC, v: 'two' }), matchMedia: noMotionPref });
  assert.equal(weird.getNotice(), 'motion-2', 'a version that is not a number is an old document');
  for (const v of [2, 3]) {
    const doc = { ...V1_DOC, v, settings: { ...V1_DOC.settings, sensitivity: 1.5, cutThreshold: 450 }, notice: null };
    const st = createStorage({ backend: withDoc(doc), matchMedia: noMotionPref });
    assert.deepEqual([st.getSettings().sensitivity, st.getSettings().cutThreshold, st.getNotice()], [1.5, 450, null], `v${v}`);
  }
  const out = createStorage({ backend: withDoc({ ...V1_DOC, v: 2, settings: { ...V1_DOC.settings, sensitivity: 9, cutThreshold: 1400 } }), matchMedia: noMotionPref });
  assert.deepEqual([out.getSettings().sensitivity, out.getSettings().cutThreshold], [2, 700], 'an out-of-range value of a v2 document is clamped, not reset');
  const kept = createStorage({ backend: withDoc({ ...V1_DOC, v: 2, notice: 'motion-2' }), matchMedia: noMotionPref });
  assert.equal(kept.getNotice(), 'motion-2', 'the stored notice of a v2 document is kept');
  const junkNotice = createStorage({ backend: withDoc({ ...V1_DOC, v: 2, notice: 'something else' }), matchMedia: noMotionPref });
  assert.equal(junkNotice.getNotice(), null, 'an unknown notice is dropped');
});

test('MIGRATION: a v1 document with nothing in it, or with a settings block of junk, migrates to the new defaults with the notice', () => {
  for (const doc of [{ v: 1 }, { v: 1, settings: 5 }, { v: 1, settings: {} }, { v: 1, settings: { sensitivity: 'x', cutThreshold: null } }]) {
    const st = createStorage({ backend: withDoc(doc), matchMedia: noMotionPref });
    assert.deepEqual([st.getSettings().sensitivity, st.getSettings().cutThreshold, st.getNotice()], [1, 300, 'motion-2'], JSON.stringify(doc));
  }
  // and the defaults the migration resets to are the ones a fresh profile gets
  assert.deepEqual([SETTINGS_DEFAULTS.sensitivity, SETTINGS_DEFAULTS.cutThreshold], [1, 300]);
});

test('MIGRATION: a player who had the OLD DEFAULTS is told too (the unit of the threshold changed even if the number on screen did not), and an old default never survives as 1000 deg/s', () => {
  const doc = { v: 1, settings: { sensitivity: 1, cutThreshold: 1000 } };
  const st = createStorage({ backend: withDoc(doc), matchMedia: noMotionPref });
  assert.equal(st.getSettings().cutThreshold, 300);
  assert.equal(st.getNotice(), 'motion-2');
});

test('MIGRATION: storage that cannot be written still works: the notice lives in memory, ackNotice never throws, overrides are not persisted', () => {
  const inner = withDoc(V1_DOC);
  const backend = { getItem: (k) => inner.getItem(k), setItem: () => { throw new Error('QuotaExceededError'); } };
  const st = createStorage({ backend, matchMedia: noMotionPref });
  assert.equal(st.getNotice(), 'motion-2');
  assert.doesNotThrow(() => st.ackNotice());
  assert.equal(st.getNotice(), null);
  assert.equal(st.isPersistent(), false);
  const o = createStorage({ backend: withDoc(V1_DOC), matchMedia: noMotionPref, overrides: { reduceMotion: true } });
  assert.equal(o.getNotice(), 'motion-2', 'overrides do not interfere');
  const blocked = createStorage({ backend: throwingBackend(), matchMedia: noMotionPref });
  assert.equal(blocked.getNotice(), null);
  assert.doesNotThrow(() => blocked.ackNotice());
});
