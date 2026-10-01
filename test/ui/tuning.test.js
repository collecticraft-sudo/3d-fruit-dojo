// The sword tuning screen "Sword tuning" (improvements round, docs/improvements.md item 2; units and layout of the sword-tuning round,
// docs/motion-contract.md 3): navigation, steppers and the two preset rows, swing peak and verdict in deg/s, reach test with the four corners,
// the crosshair-speed line, practice fruit, rendering with legal text sizes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MOTION_CONFIG } from '../../public/js/motion/motion-config.js';
import { UI_TIMING } from '../../public/js/ui/ui.js';
import {
  TUNING_CORNERS, TUNING_DEFAULTS, TUNING_FRUIT, TUNING_METER, TUNING_POINTER_PRESETS, TUNING_PRESETS, TUNING_PRESET_Y, TUNING_ROWS, screenTargets, settingsRowGeometry,
} from '../../public/js/ui/layout-data.js';
import { gainText, pointerGain, swingVerdict } from '../../public/js/ui/screens/tuning.js';
import { STRINGS } from '../../public/js/ui/strings.en.js';
import { actionFact, makeBlade, makeUiHarness, seg } from '../../test-support/ui/fixtures.js';
import { makeRenderRig } from '../../test-support/render/rig.js';

/** A blade at (x, y) with a tip speed in deg/s (`dps`) or a px/s-equivalent `speed`; makeBlade keeps the two consistent when only one is given. */
const at = (x, y, over = {}) => makeBlade({ head: { x, y }, trackingOk: true, ...over });
const SENS = settingsRowGeometry(TUNING_ROWS[0]); // left column: Sensitivity
const CUT = settingsRowGeometry(TUNING_ROWS[1]); // right column: Slice threshold
const preset = (list, name) => list.find((p) => p.id.endsWith(name));

/** Menu -> Settings -> Sword tuning by clicks, the way a player does it. */
function toTuning() {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  h.ui.pointerClick(560, 975); // Settings
  assert.equal(h.state().screen, 'settings');
  h.ui.pointerClick(960, 980); // Sword tuning
  assert.equal(h.state().screen, 'tuning');
  h.advance(700); // the cut lock of a new screen is over
  return h;
}

test('navigation: settings has the Sword tuning button; Back and back return to settings, and settings still returns to its origin', () => {
  const h = makeUiHarness();
  h.toPlaying('zen');
  h.advance(400);
  h.ui.notify(actionFact('pause'));
  h.advance(300);
  h.ui.activate('pause.settings');
  assert.equal(h.state().screen, 'settings');
  assert.ok(h.ui.findTarget('set.tune'));
  h.ui.activate('set.tune');
  assert.equal(h.state().screen, 'tuning');
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'settings', 'the back action leaves the tuning screen');
  h.ui.activate('set.tune');
  h.ui.pointerClick(1280, 975); // Back
  assert.equal(h.state().screen, 'settings');
  h.ui.activate('set.back');
  assert.equal(h.state().screen, 'paused', 'settings still returns to where it was opened from');
  const m = toTuning();
  m.ui.notify(actionFact('confirm'));
  assert.equal(m.state().screen, 'settings', 'Enter with no target under the cursor = Back');
});

test('steppers, both preset rows and "Default values" change the two settings that are persisted; the defaults come back', () => {
  const h = toTuning();
  const s = () => h.storage.getSettings();
  h.ui.pointerClick(CUT.plus.x, CUT.plus.y); // Slice threshold "+" (right column, 25 deg/s a step)
  assert.equal(s().cutThreshold, 325);
  h.ui.pointerClick(CUT.minus.x, CUT.minus.y);
  h.ui.pointerClick(CUT.minus.x, CUT.minus.y);
  assert.equal(s().cutThreshold, 275);
  h.ui.pointerClick(SENS.plus.x, SENS.plus.y); // Sensitivity "+" (left column, 0.1 a step)
  assert.equal(s().sensitivity, 1.1);
  const click = (list, name) => { const p = preset(list, name); h.ui.pointerClick(p.x, TUNING_PRESET_Y); };
  click(TUNING_PRESETS, 'easy');
  assert.equal(s().cutThreshold, 225);
  click(TUNING_PRESETS, 'hard');
  assert.equal(s().cutThreshold, 450);
  click(TUNING_PRESETS, 'normal');
  assert.equal(s().cutThreshold, 300);
  click(TUNING_POINTER_PRESETS, 'relaxed');
  assert.equal(s().sensitivity, 0.6);
  click(TUNING_POINTER_PRESETS, 'fast');
  assert.equal(s().sensitivity, 1.5);
  click(TUNING_POINTER_PRESETS, 'standard');
  assert.equal(s().sensitivity, 1);
  h.ui.pointerClick(SENS.plus.x, SENS.plus.y);
  h.ui.pointerClick(CUT.plus.x, CUT.plus.y);
  h.ui.pointerClick(640, 975); // Default values
  assert.deepEqual([s().sensitivity, s().cutThreshold], [TUNING_DEFAULTS.sensitivity, TUNING_DEFAULTS.cutThreshold]);
  assert.deepEqual([s().sensitivity, s().cutThreshold], [1, 300]);
  assert.ok(h.intents.filter((i) => i.type === 'settingsChanged').length >= 13, 'every change reaches Motion through settingsChanged');
  assert.deepEqual(h.intents.filter((i) => i.type === 'settingsChanged').at(-1).patch, { sensitivity: 1, cutThreshold: 300 });
});

test('the steppers reach both ends of the new ranges: sensitivity 0.3 to 2.0 and slice threshold 100 to 700 deg/s, one click at a time', () => {
  const h = toTuning();
  const s = () => h.storage.getSettings();
  for (let i = 0; i < 30; i += 1) h.ui.pointerClick(SENS.minus.x, SENS.minus.y);
  assert.equal(s().sensitivity, 0.3);
  for (let i = 0; i < 30; i += 1) h.ui.pointerClick(SENS.plus.x, SENS.plus.y);
  assert.equal(s().sensitivity, 2);
  for (let i = 0; i < 30; i += 1) h.ui.pointerClick(CUT.minus.x, CUT.minus.y);
  assert.equal(s().cutThreshold, 100);
  for (let i = 0; i < 30; i += 1) h.ui.pointerClick(CUT.plus.x, CUT.plus.y);
  assert.equal(s().cutThreshold, 700);
});

test('the preset cell of the current value is the highlighted one (equal value), none when the value is between presets; every cell is 250 x 84', () => {
  const h = toTuning();
  const cells = screenTargets(h.view).filter((t) => t.id.startsWith('tune.preset.') || t.id.startsWith('tune.pointer.'));
  assert.equal(cells.length, 6);
  for (const c of cells) assert.deepEqual([c.w, c.h, c.y, c.cut, c.dwell, c.enabled], [250, 84, TUNING_PRESET_Y, false, true, true], c.id);
  const values = (list, key) => list.filter((p) => p.value === h.storage.getSettings()[key]).map((p) => p.id);
  assert.deepEqual([values(TUNING_POINTER_PRESETS, 'sensitivity'), values(TUNING_PRESETS, 'cutThreshold')], [['tune.pointer.standard'], ['tune.preset.normal']], 'the defaults are Standard and Normal');
  h.ui.pointerClick(CUT.plus.x, CUT.plus.y);
  h.ui.pointerClick(SENS.plus.x, SENS.plus.y);
  assert.deepEqual([values(TUNING_POINTER_PRESETS, 'sensitivity'), values(TUNING_PRESETS, 'cutThreshold')], [[], []], '325 deg/s and 1.1 are between presets: no cell is lit');
});

test('a swing across the tuning page never presses a stepper, preset or button (only the practice fruit can be cut)', () => {
  const h = toTuning();
  const before = JSON.stringify(h.storage.getSettings());
  // a fast sweep through every stepper, preset and button of the page
  for (const y of [309, TUNING_PRESET_Y, 975]) h.advance(16, { blade: at(1700, y, { cutting: true, speed: 3000 }), segments: [seg(80, y, 1800, y)] });
  assert.equal(JSON.stringify(h.storage.getSettings()), before, 'no setting changed');
  assert.equal(h.state().screen, 'tuning');
  for (const t of screenTargets(h.view)) {
    if (t.id.startsWith('tune.fruit')) assert.equal(t.cut, true, t.id);
    else assert.equal(t.cut, false, `${t.id} is not cuttable`);
  }
});

test('dwell on a stepper still works on the tuning page (rest 0.9 s), a slow pass over it does not', () => {
  const h = toTuning();
  h.advance(400, { blade: at(1000, 700) });
  const base = h.storage.getSettings().cutThreshold;
  h.advance(1300, { blade: at(CUT.plus.x, CUT.plus.y) });
  assert.equal(h.storage.getSettings().cutThreshold, base + 25, 'one dwell step of 25 deg/s');
  const g = makeUiHarness();
  g.toMenuWithSim();
  g.ui.force('tuning');
  g.advance(700, { blade: at(1000, 700) });
  for (let x = 1500; x <= 1800; x += 6) g.advance(16, { blade: at(x, CUT.plus.y) }); // ~375 px/s across the "+" button
  assert.equal(g.storage.getSettings().cutThreshold, 300);
  // the pointer presets dwell like the threshold ones
  const fast = preset(TUNING_POINTER_PRESETS, 'fast');
  g.advance(400, { blade: at(1000, 700) });
  g.advance(1300, { blade: at(fast.x, TUNING_PRESET_Y) });
  assert.equal(g.storage.getSettings().sensitivity, 1.5);
});

test('last swing: the peak of one swing is held in deg/s, the verdict compares it with the threshold (plain English, numbers from the settings)', () => {
  const h = toTuning();
  h.advance(100, { blade: at(960, 540, { speedDps: 40 }) });
  assert.equal(h.view.tune.lastPeak, null);
  assert.deepEqual(swingVerdict(h.view.tune.lastPeak, 300), { key: 'tune.verdict.none', params: {}, tone: 'none' });
  // a firm swing peaking at 820 deg/s
  for (const sp of [100, 300, 600, 820, 500, 200]) h.advance(16, { blade: at(960, 540, { speedDps: sp, cutting: sp >= 300 }) });
  assert.equal(h.view.tune.swinging, true);
  assert.equal(h.view.tune.swingPeak, 820);
  h.advance(UI_TIMING.tuneQuietMs + 40, { blade: at(960, 540, { speedDps: 30 }) });
  assert.equal(h.view.tune.swinging, false);
  assert.equal(h.view.tune.lastPeak, 820);
  assert.equal(swingVerdict(820, h.storage.getSettings().cutThreshold).tone, 'cut');
  // a lazy swing that stays under the threshold of 300
  for (const sp of [160, 220, 260, 180]) h.advance(16, { blade: at(960, 540, { speedDps: sp }) });
  h.advance(UI_TIMING.tuneQuietMs + 40, { blade: at(960, 540, { speedDps: 30 }) });
  assert.equal(h.view.tune.lastPeak, 260);
  const v = swingVerdict(260, 300);
  assert.deepEqual([v.key, v.params, v.tone], ['tune.verdict.slow', { n: 300 }, 'slow']);
  assert.equal(swingVerdict(300, 300).tone, 'cut', 'a peak equal to the threshold slices');
  assert.ok(STRINGS['tune.verdict.slow'].includes('{n}'));
  assert.equal(STRINGS['tune.verdict.slow'], 'Too slow: {n} °/s needed');
  assert.equal(STRINGS['tune.last'], 'Last swing: {n} °/s');
  // aim movements below 150 deg/s are not swings at all (the owner's slow aiming sweeps peak near 100, hard slashes start at 630)
  assert.equal(UI_TIMING.tuneSwingMinDps, 150);
  for (let i = 0; i < 30; i += 1) h.advance(16, { blade: at(960, 540, { speedDps: 120 }) });
  assert.equal(h.view.tune.lastPeak, 260);
  // entering the screen again starts clean
  h.ui.force('settings');
  h.ui.force('tuning');
  assert.equal(h.view.tune.lastPeak, null);
});

test('the swing reading follows the deg/s fields of the BladeView, and derives them from the px/s-equivalent when a view lacks them (10/3 px/s per deg/s)', () => {
  const h = toTuning();
  // a view with only `speed` (px/s-equivalent, the old fields): 3000 px/s is 900 deg/s
  const { speedDps, cutThresholdDps, ...old } = makeBlade({ head: { x: 960, y: 540 }, speed: 3000 });
  void speedDps; void cutThresholdDps;
  h.advance(16, { blade: old });
  assert.equal(h.view.blade.speedDps, 900);
  assert.equal(h.view.blade.cutThresholdDps, 300);
  assert.equal(h.view.tune.swingPeak, 900);
  // a view that has them: they win (the cut decision of the relative pointer is in deg/s, never derived from the path)
  h.advance(16, { blade: at(960, 540, { speed: 3000, speedDps: 410, cutThresholdDps: 240 }) });
  assert.equal(h.view.blade.speedDps, 410);
  assert.equal(h.view.blade.cutThresholdDps, 240);
  h.advance(16, { blade: at(960, 540, { speedDps: Number.NaN, speed: 600 }) });
  assert.equal(h.view.blade.speedDps, 180, 'a non-number falls back to the derived value instead of reaching the meter');
});

test('reach test: the four corner rings light up when touched, the covered area grows, and a sensitivity change starts it over', () => {
  const h = toTuning();
  assert.deepEqual(h.view.tune.corners, [false, false, false, false]);
  h.advance(100, { blade: at(960, 540) });
  TUNING_CORNERS.slice(0, 3).forEach((c) => h.advance(50, { blade: at(c.x + 20, c.y - 15) }));
  assert.deepEqual(h.view.tune.corners, [true, true, true, false]);
  assert.equal(h.view.tune.cornersDone, false);
  assert.ok(h.view.tune.reachW >= 85 && h.view.tune.reachH >= 80, `covered ${h.view.tune.reachW}% x ${h.view.tune.reachH}%`);
  h.advance(50, { blade: at(1830 - 50, 990 + 30) });
  assert.equal(h.view.tune.cornersDone, true);
  // 69 px from the ring centre counts (70), 75 px does not
  const g = toTuning();
  g.advance(50, { blade: at(90 + 75, 90) });
  assert.equal(g.view.tune.corners[0], false);
  g.advance(50, { blade: at(90 + 69, 90) });
  assert.equal(g.view.tune.corners[0], true);
  // a new sensitivity means a new mapping: what was covered before says nothing (the stepper, a pointer preset and "Default values" all start it over)
  h.ui.pointerClick(SENS.plus.x, SENS.plus.y);
  assert.deepEqual(h.view.tune.corners, [false, false, false, false]);
  assert.equal(h.view.tune.reachW, 0);
  h.advance(50, { blade: at(90 + 20, 90) });
  assert.equal(h.view.tune.corners[0], true);
  h.ui.pointerClick(preset(TUNING_POINTER_PRESETS, 'relaxed').x, TUNING_PRESET_Y);
  assert.equal(h.view.tune.corners[0], false, 'a pointer preset starts the reach test over');
  h.advance(50, { blade: at(90 + 20, 90) });
  h.ui.pointerClick(preset(TUNING_PRESETS, 'easy').x, TUNING_PRESET_Y);
  assert.equal(h.view.tune.corners[0], true, 'a threshold preset does not: the mapping did not change');
  // the cursor moved by the references (re-centre ease) is not the player reaching anywhere
  const r = toTuning();
  r.advance(50, { blade: at(1830, 990, { refDriven: true }) });
  assert.equal(r.view.tune.corners[3], false);
});

test('the crosshair speed line: Joy-Con = the pointer curve times the sensitivity, simulator = 27.4 px per degree times the sensitivity, mouse = no line', () => {
  const { gLoPxDeg, gHiPxDeg } = MOTION_CONFIG.pointer;
  assert.deepEqual([gLoPxDeg, gHiPxDeg], [5, 14], 'the contract numbers (docs/motion-contract.md 2.2)');
  assert.deepEqual(pointerGain(1, 'joycon'), { lo: 5, hi: 14 });
  assert.deepEqual(pointerGain(1, null), { lo: 5, hi: 14 }, 'nothing connected yet: the relative pointer is the default');
  const slow = pointerGain(0.6, 'joycon');
  const fast = pointerGain(1.5, 'joycon');
  assert.ok(Math.abs(slow.lo - 3) < 1e-9 && Math.abs(slow.hi - 8.4) < 1e-9, JSON.stringify(slow));
  assert.ok(Math.abs(fast.lo - 7.5) < 1e-9 && Math.abs(fast.hi - 21) < 1e-9, JSON.stringify(fast));
  const sim = pointerGain(2, 'sim');
  assert.ok(Math.abs(sim.lo - 54.8) < 1e-9 && sim.lo === sim.hi, 'the simulator does not use the curve');
  assert.equal(pointerGain(1, 'mouse'), null);
  assert.equal(gainText(1, 'joycon'), 'Crosshair speed: 5.0 px per degree when aiming slowly, 14.0 px per degree in a fast swing');
  assert.equal(gainText(0.6, 'joycon'), 'Crosshair speed: 3.0 px per degree when aiming slowly, 8.4 px per degree in a fast swing');
  assert.equal(gainText(1.5, 'joycon'), 'Crosshair speed: 7.5 px per degree when aiming slowly, 21.0 px per degree in a fast swing');
  assert.equal(gainText(1, 'sim'), 'Crosshair speed: 27.4 px per degree when aiming slowly, 27.4 px per degree in a fast swing');
  assert.equal(gainText(1, 'mouse'), null);
  assert.equal(gainText(0.3, 'joycon'), 'Crosshair speed: 1.5 px per degree when aiming slowly, 4.2 px per degree in a fast swing', 'the lowest sensitivity');
});

test('practice fruit: a fast segment cuts every fruit it crosses at once, a slow blade never cuts, they come back after 1.4 s', () => {
  const h = toTuning();
  h.clearRecords();
  // an apple, a kiwi and a lemon on one line: one swing
  h.advance(16, { blade: at(300, 815, { cutting: true, speed: 2500 }), segments: [seg(300, 815, 1500, 815)] });
  assert.equal(h.view.tune.fruit.filter((f) => !f.ready).length, 3, 'one swing, three fruit');
  const cuts = h.effects.filter((e) => e[0] === 'tuneCut');
  assert.equal(cuts.length, 3);
  assert.deepEqual(cuts.map((c) => c[1].fruit), TUNING_FRUIT.map((f) => f.fruit));
  assert.ok(Math.abs(cuts[0][1].angle) < 0.01, 'the halves separate along the blade direction');
  assert.equal(h.ui.findTarget('tune.fruit0').enabled, false, 'a fruit that is being cut cannot be cut again');
  assert.equal(h.state().screen, 'tuning', 'cutting practice fruit selects nothing else');
  // nothing is cut while they are away
  h.advance(16, { blade: at(300, 815, { cutting: true, speed: 2500 }), segments: [seg(300, 815, 1500, 815)] });
  assert.equal(h.effects.filter((e) => e[0] === 'tuneCut').length, 3);
  h.advance(UI_TIMING.tuneFruitRespawnMs + 50);
  assert.equal(h.view.tune.fruit.every((f) => f.ready), true);
  assert.equal(h.ui.findTarget('tune.fruit1').enabled, true);
  // a slow blade produces no segments (Motion only emits them while cutting): nothing happens
  h.clearRecords();
  h.advance(2000, { blade: at(960, 815, { speed: 400 }) });
  assert.equal(h.effects.length, 0);
  // the second fruit alone, with a short swing, plays the slice sound through the effect and leaves the others
  h.advance(16, { blade: at(900, 815, { cutting: true, speed: 2500 }), segments: [seg(900, 790, 1020, 840)] });
  assert.deepEqual(h.view.tune.fruit.map((f) => f.ready), [true, false, true]);
});

test('the tuning page draws with legal text sizes, the threshold marker, corner rings, both preset rows and practice fruit', () => {
  const rig = makeRenderRig();
  const h = toTuning();
  h.view.provider = { ...h.view.provider, kind: 'joycon' };
  h.advance(300, { blade: at(1800, 1000) });
  h.advance(16, { blade: at(1000, 815, { cutting: true, speed: 2600 }), segments: [seg(900, 815, 1050, 815)] });
  for (let i = 0; i < 4; i += 1) h.advance(16, { blade: at(1000, 540, { speedDps: 780 }) });
  rig.trail.updateCursor(makeBlade(), 0.016);
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade({ speed: 2600 }), nowMs: h.clock.now() });
  assert.deepEqual(rig.ctx.forbidden, []);
  const texts = rig.ctx.texts.map((x) => x.text);
  for (const key of ['tune.title', 'tune.intro', 'tune.preset', 'tune.pointer', 'tune.pointer.relaxed', 'tune.pointer.standard', 'tune.pointer.fast', 'tune.defaults', 'settings.cut.easy', 'settings.cut.normal', 'settings.cut.hard']) {
    assert.ok(texts.includes(STRINGS[key]), key);
  }
  assert.ok(texts.some((x) => x.startsWith('Slice the practice')), 'the practice fruit caption (wrapped in the left margin)');
  assert.ok(texts.includes('Blade speed: 780 °/s'), 'the live meter reads the deg/s field');
  assert.ok(texts.includes('300 °/s (Normal)'), 'the threshold value in deg/s with its label');
  assert.ok(texts.includes('1.0'));
  assert.ok(texts.some((x) => x.startsWith('Last swing:')));
  assert.ok(texts.some((x) => x.startsWith('Crosshair speed: 5.0')), 'the crosshair speed line (it wraps into two lines; the first starts with it)');
  assert.ok(!texts.some((x) => /screen spans/.test(x)), 'the old "screen spans" line is gone');
  assert.ok(!texts.some((x) => /px\/s/.test(x)), 'no blade speed in px/s is shown any more');
  for (const x of rig.ctx.texts) assert.ok(x.size >= 28, `"${x.text}" is ${x.size}px`);
  assert.equal(rig.ctx.stack.length, 0, 'save/restore balanced');
});

test('the tuning page for the mouse has no crosshair-speed line, and the meter and the marker are on the bar for the whole threshold range', () => {
  const rig = makeRenderRig();
  const h = toTuning();
  h.view.provider = { ...h.view.provider, kind: 'mouse' };
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: h.clock.now() });
  assert.ok(!rig.ctx.texts.some((x) => x.text.startsWith('Crosshair speed')));
  assert.equal(TUNING_METER.max, 900);
  for (const t of [100, 300, 700]) assert.ok(t / TUNING_METER.max <= 1, `${t} deg/s is on the bar`);
  assert.ok(TUNING_METER.x1 - TUNING_METER.x0 >= 780);
});
