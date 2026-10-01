// Screen layouts as data: every selectable target is inside the playfield, big enough for the sword (84 x 84 px), and no two
// selectable targets of one screen overlap (docs/game-design.md 12, 11.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MENU_BUTTONS, MENU_MODES, PAUSE_BUTTONS, SETTINGS_ROWS, TUNING_DEFAULTS, TUNING_METER, TUNING_POINTER_PRESETS, TUNING_PRESETS, TUNING_PRESET_Y, TUNING_ROWS,
  settingsRowGeometry, screenTargets,
} from '../../public/js/ui/layout-data.js';
import { actionFact, makeUiHarness, providerFact, roundResult } from '../../test-support/ui/fixtures.js';

const bounds = (t) => (t.shape === 'circle' ? { l: t.x - t.r, r: t.x + t.r, t: t.y - t.r, b: t.y + t.r } : { l: t.x - t.w / 2, r: t.x + t.w / 2, t: t.y - t.h / 2, b: t.y + t.h / 2 });
const overlap = (a, b) => {
  if (a.shape === 'circle' && b.shape === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r;
  const p = bounds(a);
  const q = bounds(b);
  const boxes = p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
  if (!boxes) return false;
  if (a.shape === 'circle' || b.shape === 'circle') {
    const c = a.shape === 'circle' ? a : b;
    const r = a.shape === 'circle' ? bounds(b) : bounds(a);
    const nx = Math.max(r.l, Math.min(c.x, r.r));
    const ny = Math.max(r.t, Math.min(c.y, r.b));
    return Math.hypot(c.x - nx, c.y - ny) < c.r;
  }
  return true;
};

/** Every distinct target set of the UI, gathered by driving the real state machine. */
function allTargetSets() {
  const sets = [];
  const grab = (name, h) => sets.push([name, h.ui.getTargets()]);
  const h = makeUiHarness();
  h.ui.notify({ type: 'ready' });
  h.advance(2100);
  grab('safety', h);
  h.ui.force('connect');
  grab('connect', h);
  h.ui.notify(providerFact('joycon', 'streaming'));
  grab('connect (connected)', h);
  h.ui.force('connect');
  h.ui.notify(providerFact('joycon', 'idle'));
  h.ui.notify(providerFact('joycon', 'idle', { error: { code: 'cancelled', message: 'x', retryable: true, at: 0 } }));
  grab('connect (chooser closed: extended search offered)', h);
  const m = makeUiHarness();
  m.toMenuWithSim();
  grab('menu', m);
  m.ui.force('settings');
  grab('settings', m);
  m.ui.force('tuning');
  grab('tuning', m);
  m.ui.force('paused', { roundMode: 'classic' });
  grab('paused', m);
  m.ui.force('calibration', { step: 1 });
  grab('calibration 1', m);
  m.ui.force('calibration', { step: 3 });
  grab('calibration 3', m);
  m.ui.force('calibration', { step: 4 });
  m.view.cal.tryAgain = true;
  m.ui.force('calibration', { step: 4 });
  const c4 = makeUiHarness();
  c4.toMenuWithSim();
  c4.ui.force('calibration', { step: 4 });
  c4.step({ snapshot: { ...{ v: 1 }, practice: { cut: false, elapsedS: 30 }, powerups: [], objects: [], halves: [], telegraphs: [], events: [], mode: 'practice' } });
  grab('calibration 4 (retry)', c4);
  const r = makeUiHarness();
  r.toPlaying('classic');
  r.ui.notify({ type: 'roundOver', result: roundResult() });
  r.advance(1300);
  grab('results', r);
  const o = makeUiHarness();
  o.toPlaying('classic');
  o.ui.force('paused', { roundMode: 'classic' });
  o.ui.activate('pause.quit');
  grab('confirm', o);
  const d = makeUiHarness();
  d.storage.setSafetyAck();
  d.ui.notify(providerFact('joycon', 'streaming'));
  d.ui.notify({ type: 'ready' });
  d.ui.notify(providerFact('joycon', 'lost'));
  d.view.disc.phase = 'failed';
  d.view.disc.retryEnabled = true;
  d.ui.force('menu');
  d.ui.notify(providerFact('joycon', 'streaming'));
  d.ui.notify(providerFact('joycon', 'lost'));
  d.advance(2100);
  d.ui.notify(providerFact('joycon', 'connecting'));
  d.ui.notify(providerFact('joycon', 'lost'));
  d.advance(50);
  grab('disconnect (failed)', d);
  return sets;
}

test('every target is inside the 1920 x 1080 playfield', () => {
  for (const [name, targets] of allTargetSets()) {
    assert.ok(targets.length > 0 || name === 'x', `${name} has targets`);
    for (const t of targets) {
      const b = bounds(t);
      assert.ok(b.l >= 0 && b.t >= 0 && b.r <= 1920 && b.b <= 1080, `${name}/${t.id} is inside the playfield: ${JSON.stringify(b)}`);
    }
  }
});

test('anything the sword can select (cut or dwell) is at least 84 x 84 px; main buttons are far larger', () => {
  for (const [name, targets] of allTargetSets()) {
    for (const t of targets.filter((x) => x.cut || x.dwell)) {
      const w = t.shape === 'circle' ? t.r * 2 : t.w;
      const h = t.shape === 'circle' ? t.r * 2 : t.h;
      assert.ok(w >= 84 && h >= 84, `${name}/${t.id} is ${w} x ${h}`);
    }
  }
  for (const b of [...MENU_BUTTONS, ...PAUSE_BUTTONS]) assert.ok(b.w >= 400 && b.h >= 100);
  for (const m of MENU_MODES) assert.ok(m.r >= 170);
});

test('no two enabled targets of one screen overlap', () => {
  for (const [name, targets] of allTargetSets()) {
    const live = targets.filter((t) => t.enabled);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) assert.equal(overlap(live[i], live[j]), false, `${name}: ${live[i].id} overlaps ${live[j].id}`);
    }
  }
});

test('menu positions follow design 12.6 and the settings rows follow 12.7', () => {
  assert.deepEqual(MENU_MODES.map((m) => [m.id, m.x, m.y, m.r, m.fruit]), [['classic', 480, 520, 175, 'watermelon'], ['arcade', 960, 520, 170, 'orange'], ['zen', 1440, 520, 172, 'pear']]);
  assert.deepEqual(MENU_BUTTONS.map((b) => [b.x, b.y, b.w, b.h]), [[560, 975, 400, 100], [960, 975, 400, 100], [1360, 975, 400, 100]]);
  assert.deepEqual(PAUSE_BUTTONS.map((b) => [b.x, b.y, b.w, b.h]), [[960, 380, 620, 120], [960, 540, 620, 120], [960, 700, 620, 120], [960, 860, 620, 120]]);
  const left = SETTINGS_ROWS.filter((r) => r.col === 'left').map((r) => [r.key, r.y]);
  const right = SETTINGS_ROWS.filter((r) => r.col === 'right').map((r) => [r.key, r.y]);
  assert.deepEqual(left, [['sensitivity', 250], ['cutThreshold', 400], ['volume', 550], ['reduceFlash', 700], ['swordSelect', 806]], 'the ninth row ("Sword selection in menus") sits in the free band under the left column');
  assert.deepEqual(right, [['reduceMotion', 250], ['hand', 400], ['autoCenter', 550], ['dwellSelect', 700]]);
  const g = settingsRowGeometry(SETTINGS_ROWS[0]);
  assert.equal(g.cy, 314, 'control centred 64 px below the label baseline');
  assert.ok(g.minus.w >= 84 && g.plus.w >= 84);
  assert.equal(g.minus.x - g.minus.w / 2, 140, 'left column starts at x = 140');
  assert.equal(g.plus.x + g.plus.w / 2, 930);
});

test('the connect screen target set with the extended search has the button, inside the right column and clear of every other target', () => {
  const sets = Object.fromEntries(allTargetSets());
  const t = sets['connect (chooser closed: extended search offered)'];
  const fb = t.find((x) => x.id === 'connect.fallback');
  assert.ok(fb, 'connect.fallback is a target');
  assert.deepEqual([fb.shape, fb.enabled, fb.cut, fb.dwell], ['rect', true, false, false]);
  assert.ok(fb.w >= 560 && fb.h >= 84, 'as big as a finger-sized button');
  assert.ok(t.find((x) => x.id === 'connect.main'), 'the main button is still there');
  assert.equal(sets.connect.find((x) => x.id === 'connect.fallback'), undefined, 'and absent before any attempt');
  assert.equal(sets['connect (connected)'].find((x) => x.id === 'connect.fallback'), undefined);
});

test('screenTargets is pure: the same view gives the same targets, unknown screens give none', () => {
  const view = { screen: 'menu', overlay: null };
  assert.deepEqual(screenTargets(view), screenTargets(view));
  assert.deepEqual(screenTargets({ screen: 'boot', overlay: null }), []);
  assert.deepEqual(screenTargets({ screen: 'playing', overlay: null }), []);
  assert.ok(actionFact('confirm'));
});

test('sword tuning layout (docs/motion-contract.md 3.2 and 3.5): presets in deg/s and in pointer speeds, meter to 900 deg/s, defaults 1.0 and 300, two columns', () => {
  assert.deepEqual(TUNING_PRESETS.map((p) => [p.id, p.value, p.labelKey]), [['tune.preset.easy', 225, 'settings.cut.easy'], ['tune.preset.normal', 300, 'settings.cut.normal'], ['tune.preset.hard', 450, 'settings.cut.hard']]);
  assert.deepEqual(TUNING_POINTER_PRESETS.map((p) => [p.id, p.value]), [['tune.pointer.relaxed', 0.6], ['tune.pointer.standard', 1], ['tune.pointer.fast', 1.5]]);
  assert.equal(TUNING_METER.max, 900);
  assert.deepEqual({ ...TUNING_DEFAULTS }, { sensitivity: 1, cutThreshold: 300 });
  for (const list of [TUNING_PRESETS, TUNING_POINTER_PRESETS]) {
    assert.ok(list.every(Object.isFrozen));
    assert.ok(Object.isFrozen(list));
  }
  // every preset value is a value the settings allow (range and step), so a lit cell is always reachable with the stepper
  assert.ok(TUNING_PRESETS.every((p) => p.value >= 100 && p.value <= 700 && (p.value - 100) % 25 === 0));
  assert.ok(TUNING_POINTER_PRESETS.every((p) => p.value >= 0.3 && p.value <= 2 && Math.abs(Math.round(p.value * 10) - p.value * 10) < 1e-9));
  // the two steppers: Sensitivity in the left column, Slice threshold in the right one, same label line
  assert.deepEqual(TUNING_ROWS.map((r) => [r.key, r.col, r.y]), [['sensitivity', 'left', 245], ['cutThreshold', 'right', 245]]);
  const [a, b] = TUNING_ROWS.map(settingsRowGeometry);
  assert.deepEqual([a.minus.w, a.minus.h, b.plus.w, b.plus.h], [84, 84, 84, 84]);
  assert.ok(b.minus.x - 42 >= 930 && b.plus.x + 42 <= 1780, 'the right group stays in the right column');
});

test('sword tuning targets: two preset rows of three 250 x 84 cells under their steppers, in their columns, selectable by dwell, click and Enter but never by a cut (only the practice fruit)', () => {
  const view = { screen: 'tuning', overlay: null, tune: null };
  const targets = screenTargets(view);
  assert.deepEqual(targets.map((t) => t.id), [
    'set.sensitivity.minus', 'set.sensitivity.plus', 'set.cutThreshold.minus', 'set.cutThreshold.plus',
    'tune.pointer.relaxed', 'tune.pointer.standard', 'tune.pointer.fast', 'tune.preset.easy', 'tune.preset.normal', 'tune.preset.hard',
    'tune.fruit0', 'tune.fruit1', 'tune.fruit2', 'tune.defaults', 'tune.back',
  ], 'the order of the targets (first match wins when two touch) keeps steppers, presets, fruit, buttons');
  const cells = targets.filter((t) => /^tune\.(pointer|preset)\./.test(t.id));
  for (const c of cells) {
    assert.deepEqual([c.w, c.h, c.y, c.cut, c.dwell], [250, 84, TUNING_PRESET_Y, false, true], c.id);
    assert.ok(c.x - c.w / 2 >= 0 && c.x + c.w / 2 <= 1920);
  }
  const left = cells.filter((c) => c.id.startsWith('tune.pointer.'));
  const right = cells.filter((c) => c.id.startsWith('tune.preset.'));
  assert.ok(left.every((c) => c.x + 125 <= 930 && c.x - 125 >= 140), 'pointer presets inside the left column (x 140 to 930)');
  assert.ok(right.every((c) => c.x + 125 <= 1780 && c.x - 125 >= 990), 'threshold presets inside the right column (x 990 to 1780)');
  assert.ok(Math.min(...cells.map((c) => c.y)) - 42 > settingsRowGeometry(TUNING_ROWS[0]).plus.y + 42, 'the cells sit below the steppers');
  for (const t of targets) assert.equal(t.cut, t.id.startsWith('tune.fruit'), `${t.id}: only the practice fruit can be cut`);
});
