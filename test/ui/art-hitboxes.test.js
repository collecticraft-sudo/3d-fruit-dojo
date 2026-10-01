// Hit boxes, focus order, dwell and cut flags, the 84 x 84 minimum and the layout constants are exactly what they were before the art work
// (docs/assets-integration.md 5 intro, 5.8, 8.5). The reference files were recorded from the code BEFORE layout-data.js got its art layout:
// test-support/ui/target-rects.json (every target of every screen and state) and test-support/ui/layout-constants.json (every layout constant).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../../public/js/ui/layout-data.js';
import { pointInTarget, segmentHitsTarget, segmentParam } from '../../public/js/ui/hit.js';
import { drawButton, drawStepButton, drawToggle } from '../../public/js/ui/widgets.js';
import { createArtStub } from '../../test-support/ui/art-stub.js';
import { makeRecordingCanvas } from '../../test-support/ui/art-scenes.js';
import { TARGET_VIEWS } from '../../test-support/ui/target-views.js';

const read = (name) => JSON.parse(readFileSync(new URL(`../../test-support/ui/${name}`, import.meta.url), 'utf8'));
const RECTS = read('target-rects.json');
const CONSTANTS = read('layout-constants.json');

const plain = (t) => {
  const { id, shape, x, y, w, h, r, enabled, cut, dwell } = t;
  return shape === 'circle' ? { id, shape, x, y, r, enabled, cut, dwell } : { id, shape, x, y, w, h, enabled, cut, dwell };
};

test('every target of every screen and state has the id, order, shape, centre, size, enabled, cut and dwell flags of before the art work', () => {
  assert.deepEqual(Object.keys(TARGET_VIEWS), Object.keys(RECTS), 'the same matrix of views');
  let total = 0;
  for (const [name, view] of Object.entries(TARGET_VIEWS)) {
    const now = L.screenTargets(view).map(plain);
    assert.deepEqual(now, RECTS[name], name);
    total += now.length;
  }
  assert.ok(total > 90, `${total} targets compared`);
});

test('every layout constant is what it was (mode fruit, buttons, settings rows, tuning, panels, native connect column)', () => {
  const same = (name) => assert.deepEqual(JSON.parse(JSON.stringify(L[name])), CONSTANTS[name], name);
  for (const name of ['MENU_MODES', 'MENU_BUTTONS', 'PAUSE_BUTTONS', 'SETTINGS_COL', 'SETTINGS_ROWS', 'TUNING_ROWS', 'TUNING_PRESET_Y', 'TUNING_PRESETS', 'TUNING_METER',
    'TUNING_CORNERS', 'TUNING_CORNER', 'TUNING_FRUIT', 'TUNING_DEFAULTS', 'RESULTS_PANEL', 'DISCONNECT_PANEL', 'CONFIRM_PANEL', 'CONNECT_NATIVE']) same(name);
  const geo = Object.fromEntries([...L.SETTINGS_ROWS, ...L.TUNING_ROWS].map((r) => [`${r.type}:${r.key}:${r.y}`, L.settingsRowGeometry(r)]));
  assert.deepEqual(JSON.parse(JSON.stringify(geo)), CONSTANTS.rowGeometry);
});

test('the art layout constants are additive: new names only, all frozen data', () => {
  for (const name of ['MENU_LOGO', 'MENU_TAGLINE_Y', 'BOOT_ART', 'CONNECT_GLYPHS', 'RESULTS_ART', 'GLYPH_DEFAULT_IDS']) {
    assert.ok(Object.isFrozen(L[name]), `${name} is frozen`);
    assert.equal(name in CONSTANTS, false, `${name} did not exist before`);
  }
  assert.deepEqual({ ...L.MENU_LOGO }, { cx: 960, top: 10, h: 226, w: 443 }, 'the contract: centred at 960, top 10, height 226 (width 443)');
});

test('anything the sword can select (cut or dwell) is still at least 84 x 84 px, in every state of the matrix', () => {
  for (const [name, view] of Object.entries(TARGET_VIEWS)) {
    for (const t of L.screenTargets(view).filter((x) => x.cut || x.dwell)) {
      const w = t.shape === 'circle' ? t.r * 2 : t.w;
      const h = t.shape === 'circle' ? t.r * 2 : t.h;
      assert.ok(w >= 84 && h >= 84, `${name}/${t.id} is ${w} x ${h}`);
    }
  }
});

test('the art is drawn on top of the same targets: drawing every widget with art leaves the target objects untouched and the two toggle cells at their rectangles', () => {
  const assets = createArtStub();
  const canvas = makeRecordingCanvas();
  for (const view of Object.values(TARGET_VIEWS)) {
    const targets = L.screenTargets(view);
    const before = JSON.stringify(targets);
    for (const t of targets) {
      if (t.shape !== 'rect') continue;
      if (/\.(minus|plus)$/.test(t.id)) drawStepButton(canvas.ctx, t, t.id.endsWith('plus') ? '+' : '-', true, { assets, density: 2 });
      else if (!/\.(on|off|left|right)$/.test(t.id)) drawButton(canvas.ctx, t, 'Label', { assets, hovered: true, density: 2, inset: 6 });
    }
    assert.equal(JSON.stringify(targets), before, 'no target was modified');
  }
  // a toggle is drawn over the union of its two cells, and the cells (the hit boxes) stay 210 x 84
  const settings = L.screenTargets(TARGET_VIEWS.settings);
  for (const key of ['reduceFlash', 'reduceMotion', 'autoCenter', 'dwellSelect']) {
    const a = settings.find((t) => t.id === `set.${key}.on`);
    const b = settings.find((t) => t.id === `set.${key}.off`);
    assert.deepEqual([a.w, a.h, b.w, b.h], [210, 84, 210, 84]);
    drawToggle(canvas.ctx, a, b, 'On', 'Off', true, false, false, { assets, density: 2 });
    assert.deepEqual([a.w, a.h, b.w, b.h], [210, 84, 210, 84]);
  }
});

test('hit testing is unchanged: point in target and blade segment against target for rectangles and circles', () => {
  const rect = { shape: 'rect', x: 960, y: 540, w: 620, h: 120 };
  const circle = { shape: 'circle', x: 480, y: 520, r: 175 };
  assert.equal(pointInTarget(rect, 960 + 310, 540 + 60), true);
  assert.equal(pointInTarget(rect, 960 + 311, 540), false);
  assert.equal(pointInTarget(circle, 480 + 175, 520), true);
  assert.equal(pointInTarget(circle, 480 + 176, 520), false);
  assert.equal(segmentHitsTarget(rect, 0, 540, 1920, 540), true);
  assert.equal(segmentHitsTarget(rect, 0, 0, 1920, 100), false);
  assert.equal(segmentHitsTarget(circle, 0, 520, 320, 520), true);
  assert.equal(segmentHitsTarget(circle, 0, 100, 100, 100), false);
  assert.equal(segmentParam(rect, 0, 540, 1920, 540), 0.5);
});
