// The settings side of the sword-tuning round (docs/motion-contract.md 3): the value texts and labels of the settings screen, the live meter in
// deg/s on the settings screen, the tuning page and calibration step 4, the one-time migration toast, and the geometry of the two pages (no text
// over a selectable target, everything on the playfield). The storage migration itself is in test/ui/storage.test.js, the tuning behaviour in
// test/ui/tuning.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../../public/js/render/palette.js';
import { MOTION_CONFIG } from '../../public/js/motion/motion-config.js';
import { SETTINGS_ROWS, TUNING_METER, TUNING_PRESETS, screenTargets } from '../../public/js/ui/layout-data.js';
import { CUT_LABEL_BOUNDS, cutThresholdLabel, settingValueText } from '../../public/js/ui/screens/settings.js';
import { createStorage, DEFAULT_STORAGE_KEY } from '../../public/js/ui/storage.js';
import { STRINGS, t } from '../../public/js/ui/strings.en.js';
import { UI_TIMING } from '../../public/js/ui/ui.js';
import { createManualClock } from '../../public/js/shared/clock.js';
import { createUi } from '../../public/js/ui/ui.js';
import { makeBlade, makeUiHarness, memoryBackend, providerFact } from '../../test-support/ui/fixtures.js';
import { readDrawn, targetRect, overlaps, inside, circleHitsRect } from '../../test-support/ui/art-geometry.js';
import { makeSpriteStub, runScene } from '../../test-support/ui/art-scenes.js';

const noMotionPref = () => ({ matches: false });

// ---------------------------------------------------------------------------------------------------------------------- value texts

test('slice threshold text: "{value} °/s ({label})", Easy for 250 or less, Normal for 251 to 375, Hard above 375, for every step the setting can take', () => {
  assert.deepEqual({ ...CUT_LABEL_BOUNDS }, { easyMax: 250, hardMin: 375 });
  assert.equal(cutThresholdLabel(225), '225 °/s (Easy)');
  assert.equal(cutThresholdLabel(300), '300 °/s (Normal)');
  assert.equal(cutThresholdLabel(450), '450 °/s (Hard)');
  const seen = { Easy: [], Normal: [], Hard: [] };
  for (let v = 100; v <= 700; v += 25) {
    const text = cutThresholdLabel(v);
    const m = text.match(/^(\d+) °\/s \((Easy|Normal|Hard)\)$/);
    assert.ok(m, text);
    assert.equal(Number(m[1]), v);
    seen[m[2]].push(v);
  }
  assert.deepEqual([seen.Easy[0], seen.Easy.at(-1)], [100, 250]);
  assert.deepEqual([seen.Normal[0], seen.Normal.at(-1)], [275, 375]);
  assert.deepEqual([seen.Hard[0], seen.Hard.at(-1)], [400, 700]);
  assert.equal(seen.Easy.length + seen.Normal.length + seen.Hard.length, 25, '100 to 700 in steps of 25 is 25 values');
  // the three presets fall in their own words: the value display and the preset cells agree
  assert.deepEqual(TUNING_PRESETS.map((p) => cutThresholdLabel(p.value).match(/\((\w+)\)/)[1]), ['Easy', 'Normal', 'Hard']);
  assert.deepEqual(TUNING_PRESETS.map((p) => t(p.labelKey)), ['Easy', 'Normal', 'Hard']);
});

test('settingValueText: sensitivity with one decimal, the threshold in deg/s with its label, volume as a percentage', () => {
  const s = { sensitivity: 0.3, cutThreshold: 100, volume: 0.7 };
  assert.equal(settingValueText('sensitivity', s), '0.3');
  assert.equal(settingValueText('sensitivity', { sensitivity: 1 }), '1.0');
  assert.equal(settingValueText('sensitivity', { sensitivity: 2 }), '2.0');
  assert.equal(settingValueText('cutThreshold', s), '100 °/s (Easy)');
  assert.equal(settingValueText('cutThreshold', { cutThreshold: 700 }), '700 °/s (Hard)');
  assert.equal(settingValueText('volume', s), '70%');
  assert.equal(settingValueText('hand', { hand: 'left' }), '');
});

test('the help texts of the two rows are still there (they stay valid), and the threshold row says what to do in plain words', () => {
  const rows = Object.fromEntries(SETTINGS_ROWS.map((r) => [r.key, r]));
  assert.equal(t(rows.sensitivity.hintKey), 'How far the crosshair moves when you rotate the sword.');
  assert.equal(t(rows.cutThreshold.hintKey), 'Minimum speed needed to slice. Lower = easier.');
  assert.equal(t(rows.sensitivity.labelKey), 'Sensitivity');
  assert.equal(t(rows.cutThreshold.labelKey), 'Slice threshold');
});

// ---------------------------------------------------------------------------------------------------------------------- the live meters

const fillRects = (calls, w, h) => calls.filter((c) => c[0] === 'fillRect' && c[3] === w && c[4] === h);
const assignedCount = (calls, prop, value) => calls.filter((c) => c[0] === `=${prop}` && c[1] === value).length;

test('settings screen: the meter reads the deg/s field, the bar spans 0 to 900, the gold marker is at the threshold setting and the bar turns vermilion at or above it', () => {
  const draw = (speedDps, cutThreshold = 300) => runScene('settings', {
    sprites: makeSpriteStub(),
    view: (view) => { view.blade.speedDps = speedDps; view.blade.speed = 99999; view.settings = { ...view.settings, cutThreshold }; },
  });
  const slow = draw(120);
  const texts = slow.ctx.texts.map((x) => x.text);
  assert.ok(texts.includes('Blade speed: 120 °/s'), 'the text reads speedDps, not the px/s-equivalent `speed`');
  assert.ok(!texts.some((x) => x.includes('99999')));
  // marker: fillRect(mx - 4, y - 10, 8, h + 20) with mx = 990 + 790 * 300 / 900 (the meter sits in the right half of the bottom band since the ninth row)
  const mx = 990 + 790 * (300 / 900);
  const marker = fillRects(slow.calls, 8, 34 + 20);
  assert.equal(marker.length, 1);
  assert.ok(Math.abs(marker[0][1] - (mx - 4)) < 1e-6, `marker at ${marker[0][1] + 4}, expected ${mx}`);
  // a different threshold moves it: 700 deg/s is at 990 + 790 * 700 / 900
  const hard = draw(120, 700);
  assert.ok(Math.abs(fillRects(hard.calls, 8, 54)[0][1] + 4 - (990 + 790 * (700 / 900))) < 1e-6);
  // the bar colour: vermilion from the threshold on, never below it
  const below = assignedCount(slow.calls, 'fillStyle', COLORS.vermilion);
  const at = assignedCount(draw(300).calls, 'fillStyle', COLORS.vermilion);
  const above = assignedCount(draw(650).calls, 'fillStyle', COLORS.vermilion);
  assert.equal(at, below + 1, 'exactly at the threshold the bar is vermilion');
  assert.equal(above, below + 1);
  assert.equal(assignedCount(draw(299).calls, 'fillStyle', COLORS.vermilion), below, 'one deg/s under it the bar stays ink');
  // a hard slash above the end of the bar is still shown as a number
  assert.ok(draw(1200).ctx.texts.some((x) => x.text === 'Blade speed: 1200 °/s'));
  for (const x of slow.ctx.texts) assert.ok(x.size >= 28, `"${x.text}" is ${x.size}px`);
});

test('calibration step 4: "Blade speed: {n} °/s" from the deg/s field and a bar of 520 px for 0 to 900 deg/s', () => {
  const draw = (speedDps) => runScene('calibration-4', { sprites: makeSpriteStub(), view: (view) => { view.blade.speedDps = speedDps; view.blade.speed = 12345; } });
  const half = draw(450);
  assert.ok(half.ctx.texts.some((x) => x.text === 'Blade speed: 450 °/s'));
  const bar = half.calls.filter((c) => c[0] === 'fillRect' && c[2] === 1052 && c[4] === 12);
  assert.deepEqual(bar.map((c) => c[3]), [520, 260], 'the track is 520 px and the fill is half of it at 450 deg/s');
  const full = draw(2000);
  assert.deepEqual(full.calls.filter((c) => c[0] === 'fillRect' && c[2] === 1052 && c[4] === 12).map((c) => c[3]), [520, 520], 'the bar never grows beyond its track');
  assert.ok(full.ctx.texts.some((x) => x.text === 'Blade speed: 2000 °/s'));
  assert.equal(STRINGS['cal.speed'], 'Blade speed: {n} °/s');
});

test('the BladeView fields: the UI view keeps `speed` and `threshold` in px/s-equivalent and adds `speedDps` and `cutThresholdDps` (deg/s)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.step({ blade: makeBlade({ speed: 1000, cutThreshold: 1000 }) });
  assert.deepEqual([h.view.blade.speed, h.view.blade.speedDps, h.view.blade.threshold, h.view.blade.cutThresholdDps], [1000, 300, 1000, 300]);
  h.step({ blade: makeBlade({ speed: 5000, speedDps: 1490, cutThreshold: 800, cutThresholdDps: 240 }) });
  assert.deepEqual([h.view.blade.speed, h.view.blade.speedDps, h.view.blade.threshold, h.view.blade.cutThresholdDps], [5000, 1490, 800, 240]);
  assert.equal('tuneSwingMinPxS' in UI_TIMING, false, 'the old swing threshold in px/s is gone');
  assert.equal(UI_TIMING.tuneSwingMinDps, 150);
});

// ---------------------------------------------------------------------------------------------------------------------- the pages' geometry

/** Text boxes (conservative widths) that touch a selectable target without being inside it: a label belongs to its own button, anything else is a collision. */
function collisions(name, over = {}) {
  const r = runScene(name, { sprites: makeSpriteStub(), ...over });
  const { texts } = readDrawn(r.calls);
  const targets = r.view.targets.filter((tg) => tg.enabled && (tg.cut || tg.dwell));
  const bad = [];
  for (const tx of texts) {
    assert.ok(tx.x >= 0 && tx.x + tx.w <= 1920 && tx.y >= 0 && tx.y + tx.h <= 1080, `${name}: "${tx.text}" is on the playfield (${Math.round(tx.x)}, ${Math.round(tx.y)}, ${Math.round(tx.w)} wide)`);
    for (const tg of targets) {
      const rect = targetRect(tg);
      const hit = tg.shape === 'circle' ? circleHitsRect(tg, tx) : overlaps(tx, rect);
      if (hit && !inside(tx, rect)) bad.push(`${name}: "${tx.text}" touches ${tg.id}`);
    }
  }
  return { bad, texts, view: r.view };
}

test('tuning page: no text touches a selectable target except the label of its own button, and every text is on the playfield (Joy-Con, simulator and mouse wording)', () => {
  for (const kind of ['joycon', 'sim', 'mouse']) {
    const { bad, texts } = collisions('tuning', { view: (view) => { view.provider = { ...view.provider, kind }; view.tune.cornersDone = false; view.tune.reachW = 100; view.tune.reachH = 100; view.tune.lastPeak = 1049; view.blade.speedDps = 899; } });
    assert.deepEqual(bad, [], kind);
    assert.ok(texts.length > 15);
  }
  // the worst case for the text lines: every number at its widest, the long verdict and the 'all corners' line
  const worst = collisions('tuning', { view: (view) => { view.provider = { ...view.provider, kind: 'joycon' }; view.settings = { ...view.settings, sensitivity: 2, cutThreshold: 700 }; view.tune.lastPeak = 1049; view.tune.cornersDone = true; view.blade.speedDps = 1049; } });
  assert.deepEqual(worst.bad, []);
  const slow = collisions('tuning', { view: (view) => { view.settings = { ...view.settings, cutThreshold: 700 }; view.tune.lastPeak = 450; } });
  assert.deepEqual(slow.bad, [], 'the "Too slow" verdict');
  assert.ok(slow.texts.some((x) => x.text === 'Too slow: 700 °/s needed'));
});

test('settings page: no text touches a selectable target except its own label, with the widest threshold text and the fastest meter reading', () => {
  const { bad, texts } = collisions('settings', { view: (view) => { view.settings = { ...view.settings, cutThreshold: 700, sensitivity: 2 }; view.blade.speedDps = 899; } });
  assert.deepEqual(bad, []);
  assert.ok(texts.some((x) => x.text === '700 °/s (Hard)'));
  assert.ok(texts.some((x) => x.text === 'Blade speed: 899 °/s'));
});

test('tuning page targets: every selectable one is at least 84 x 84 px, inside the playfield, and none overlaps another (focus order = target order)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('tuning');
  const targets = screenTargets(h.view).filter((tg) => tg.enabled);
  assert.equal(targets.length, 15);
  for (const tg of targets) {
    const w = tg.shape === 'circle' ? tg.r * 2 : tg.w;
    const hgt = tg.shape === 'circle' ? tg.r * 2 : tg.h;
    assert.ok(w >= 84 && hgt >= 84, `${tg.id} is ${w} x ${hgt}`);
    const b = targetRect(tg);
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 1920 && b.y + b.h <= 1080, tg.id);
  }
  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const a = targets[i];
      const b = targets[j];
      const hit = a.shape === 'circle' && b.shape === 'circle' ? Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r
        : a.shape === 'circle' ? circleHitsRect(a, targetRect(b)) : b.shape === 'circle' ? circleHitsRect(b, targetRect(a)) : overlaps(targetRect(a), targetRect(b));
      assert.equal(hit, false, `${a.id} overlaps ${b.id}`);
    }
  }
  // the meter bar keeps clear of the preset cells above it and of the fruit below it
  const M = TUNING_METER;
  const meterBox = { x: M.x0, y: M.y - 12, w: M.x1 - M.x0, h: M.h + 24 };
  for (const tg of targets) {
    const hit = tg.shape === 'circle' ? circleHitsRect(tg, meterBox) : overlaps(targetRect(tg), meterBox);
    assert.equal(hit, false, `the meter and its marker clear ${tg.id}`);
  }
});

// ---------------------------------------------------------------------------------------------------------------------- the one-time notice

const V1 = { v: 1, best: { classic: { score: 900, combo: 3, date: 'd' }, arcade: null, zen: null }, settings: { sensitivity: 1.4, cutThreshold: 1300, volume: 0.4 }, safetyAck: true, playMsTotal: 1000 };

function migratedHarness(doc = V1) {
  const backend = memoryBackend({ [DEFAULT_STORAGE_KEY]: JSON.stringify(doc) });
  const storage = createStorage({ backend, matchMedia: noMotionPref });
  const h = makeUiHarness({ storage });
  return { h, backend, storage };
}

test('migration notice: the first menu after boot shows the toast once for a player whose saved settings were reset, then acknowledges it', () => {
  const { h, backend, storage } = migratedHarness();
  assert.equal(storage.getNotice(), 'motion-2');
  h.ui.notify(providerFact('sim', 'streaming'));
  h.ui.notify({ type: 'ready' });
  assert.equal(h.state().screen, 'menu');
  assert.equal(h.view.toast.text, t('settings.migrated'));
  assert.equal(h.view.toast.text, 'Sensitivity and Slice threshold were reset.');
  assert.equal(h.view.toast.until - h.view.toast.from, UI_TIMING.migratedToastMs);
  assert.ok(UI_TIMING.migratedToastMs > UI_TIMING.toastMs, 'longer than a tip: there is something to read');
  assert.equal(storage.getNotice(), null, 'acknowledged as soon as it is shown');
  const doc = JSON.parse(backend.getItem(DEFAULT_STORAGE_KEY));
  assert.deepEqual([doc.v, doc.notice, doc.settings.sensitivity, doc.settings.cutThreshold, doc.settings.volume], [2, null, 1, 300, 0.4]);
  assert.equal(doc.best.classic.score, 900);
  // the toast goes away by itself
  h.advance(UI_TIMING.migratedToastMs + 100);
  assert.equal(h.view.toast.text, null);
  // and never comes back: not on the next menu visit, not after a reload
  h.ui.force('settings');
  h.ui.force('menu');
  assert.equal(h.view.toast.text, null);
  const again = makeUiHarness({ storage: createStorage({ backend, matchMedia: noMotionPref }) });
  again.ui.notify(providerFact('sim', 'streaming'));
  again.ui.notify({ type: 'ready' });
  assert.equal(again.view.toast.text, null);
});

test('migration notice: nothing for a first run, nothing on the screens before the menu, and the toast never blocks a selection', () => {
  const fresh = makeUiHarness();
  fresh.toMenuWithSim();
  assert.equal(fresh.view.toast.text, null, 'a new profile has nothing to announce');
  const { h, storage } = migratedHarness();
  h.ui.notify({ type: 'ready' }); // a Joy-Con provider is not connected yet: the connect screen
  assert.equal(h.state().screen, 'connect');
  assert.equal(h.view.toast.text, null);
  assert.equal(storage.getNotice(), 'motion-2', 'still pending: the menu has not been shown yet');
  h.ui.notify(providerFact('mouse', 'streaming'));
  h.ui.force('menu');
  assert.equal(h.view.toast.text, t('settings.migrated'));
  // the toast is a label only: a click on a mode starts the round right away
  h.advance(600);
  h.ui.activate('menu.arcade');
  assert.ok(h.intents.some((i) => i.type === 'startRound' && i.mode === 'arcade'));
});

test('migration notice: a storage without getNotice / ackNotice (an older stub) is tolerated, and a v2 profile with a pending notice still shows it once', () => {
  const plain = createStorage({ backend: memoryBackend(), matchMedia: noMotionPref });
  const stub = { ...plain, getNotice: undefined, ackNotice: undefined };
  const clock = createManualClock(0);
  const ui = createUi({ clock, storage: stub });
  assert.doesNotThrow(() => {
    ui.notify({ type: 'provider', ...providerFact('sim', 'streaming') });
    ui.notify({ type: 'ready', skipSafety: true });
  });
  const { h, storage } = migratedHarness({ ...V1, v: 2, settings: { sensitivity: 1.5, cutThreshold: 450 }, notice: 'motion-2' });
  assert.deepEqual([storage.getSettings().sensitivity, storage.getSettings().cutThreshold], [1.5, 450], 'the stored v2 values are not reset');
  h.ui.notify(providerFact('sim', 'streaming'));
  h.ui.notify({ type: 'ready' });
  assert.equal(h.view.toast.text, t('settings.migrated'), 'the notice that was saved but never shown is shown now');
});

test('the notice is short enough for the menu: a toast there is one line at y 302 and the mode fruit are drawn over its ends, so at most 50 characters (as long as the other menu toast, 40)', () => {
  const text = t('settings.migrated');
  assert.ok(text.length <= 50, `${text.length} characters`);
  assert.ok(t('menu.noCalibration').length <= 50, 'the other toast of the menu, for comparison');
  // the contract wording was 138 characters (about 2000 px in the game font, 15 px a character): wider than the screen, which is why the shipped text is shorter
  assert.ok(138 * 15 > 1920);
  assert.ok(text.length * 15 + 60 <= 900, 'the pill (text plus 60 px) stays inside x 510 to 1410, clear of the fruit');
});

// ---------------------------------------------------------------------------------------------------------------------- settings and Motion agree

test('the settings the UI offers are the ranges Motion clamps to, and Normal / Easy / Hard sit on legal steps', () => {
  const [lo, hi, step] = MOTION_CONFIG.cut.thresholdRange;
  assert.deepEqual([lo, hi, step], [100, 700, 25]);
  for (const p of TUNING_PRESETS) assert.ok(p.value >= lo && p.value <= hi && (p.value - lo) % step === 0, p.id);
  assert.deepEqual(MOTION_CONFIG.input.sensitivityRange, [0.3, 2.0, 0.1]);
});
