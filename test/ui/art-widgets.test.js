// The image path of every widget (docs/assets-integration.md 5.1 to 5.4): buttons in two variants and four states, steppers, the two-cell toggle,
// the nine-slice panel and the icon helper. A fake context records every call; the assets are the stub of test-support/ui/art-stub.js, whose
// scaled() and sliced() follow the contract's size formulas, so the tests check real geometry, not just "an image was drawn".
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../../public/js/render/palette.js';
import {
  BUTTON_STATE_NAMES, artImage, buttonOpts, buttonPlate, buttonStateIndex, buttonVariant, drawButton, drawPanel, drawStepButton, drawToggle,
  fitLabelFont, hasArt, plateTextPad, resetWidgetArt, widgetArtCacheSize,
} from '../../public/js/ui/widgets.js';
import { CONFIRM_PANEL, DISCONNECT_PANEL, RESULTS_PANEL, screenTargets } from '../../public/js/ui/layout-data.js';
import { NULL_ASSETS } from '../../public/js/render/assets.js';
import { SEED, createArtStub } from '../../test-support/ui/art-stub.js';
import { SCENES, makeRecordingCanvas, makeSpriteStub, runScene } from '../../test-support/ui/art-scenes.js';
import { TARGET_VIEWS } from '../../test-support/ui/target-views.js';
import { readDrawn } from '../../test-support/ui/art-geometry.js';

const tg = (id, x, y, w, h, enabled = true) => ({ id, shape: 'rect', x, y, w, h, enabled, cut: false, dwell: false });
const fresh = (o) => { resetWidgetArt(); return { assets: createArtStub(o), canvas: makeRecordingCanvas() }; };
const images = (ctx) => readDrawn(ctx.calls).images;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------------------------------------------------------- variant and state

test('variant: targets 120 px high and more are primary, everything below is secondary, opts.variant overrides', () => {
  assert.equal(buttonVariant({ h: 120 }), 'primary');
  assert.equal(buttonVariant({ h: 130 }), 'primary');
  assert.equal(buttonVariant({ h: 119 }), 'secondary');
  assert.equal(buttonVariant({ h: 84 }), 'secondary');
  assert.equal(buttonVariant({ h: 84 }, { variant: 'primary' }), 'primary');
  assert.equal(buttonVariant({ h: 200 }, { variant: 'secondary' }), 'secondary');
});

test('variant: the primary buttons of the game are exactly the ones the contract lists (safety.ok, connect main and continue, pause, results)', () => {
  const primary = new Set();
  const secondary = new Set();
  for (const view of Object.values(TARGET_VIEWS)) {
    for (const t of screenTargets(view)) {
      if (t.shape !== 'rect') continue;
      if (t.id.startsWith('set.') && /\.(minus|plus|on|off|left|right)$/.test(t.id)) continue; // steppers and toggles are not buttons
      if (t.id.startsWith('tune.preset')) continue; // segment cells
      if (t.id === 'safety.toggle') continue; // a checkbox row
      (buttonVariant(t) === 'primary' ? primary : secondary).add(t.id);
    }
  }
  assert.deepEqual([...primary].sort(), [
    'connect.continue', 'connect.main', 'pause.quit', 'pause.recalibrate', 'pause.resume', 'pause.settings', 'results.again', 'results.menu', 'safety.ok',
  ]);
  for (const id of ['menu.settings', 'menu.recalibrate', 'menu.connection', 'set.reset', 'set.tune', 'set.back', 'tune.defaults', 'tune.back', 'confirm.yes', 'confirm.no',
    'disc.retry', 'disc.mouse', 'disc.menu', 'disc.cancel', 'cal.flip', 'cal.quick', 'cal.retry', 'connect.sim', 'connect.mouse', 'connect.back', 'connect.secondary',
    'connect.fallback', 'connect.cancel']) assert.ok(secondary.has(id), `${id} is secondary`);
});

test('state mapping: disabled wins over everything, then pressed, then focused (hovered), else default; pressed is optional', () => {
  const on = { enabled: true };
  const off = { enabled: false };
  assert.deepEqual(BUTTON_STATE_NAMES, ['default', 'focused', 'pressed', 'disabled']);
  assert.equal(buttonStateIndex(on, {}), 0);
  assert.equal(buttonStateIndex(on, { hovered: true }), 1);
  assert.equal(buttonStateIndex(on, { pressed: true }), 2);
  assert.equal(buttonStateIndex(on, { hovered: true, pressed: true }), 2, 'pressed wins over focused');
  assert.equal(buttonStateIndex(off, {}), 3);
  assert.equal(buttonStateIndex(off, { hovered: true }), 3, 'disabled wins over hovered');
  assert.equal(buttonStateIndex(off, { hovered: true, pressed: true }), 3, 'disabled wins over pressed');
  assert.equal(buttonStateIndex(on), 0, 'no options at all');
});

test('state mapping in the frame options: view.hover.id gives focused, view.pressedId gives pressed, an absent pressedId never does', () => {
  const g = { v: { hover: { id: 'a' } }, assets: null, density: 2 };
  const t1 = tg('a', 0, 0, 10, 10);
  const t2 = tg('b', 0, 0, 10, 10);
  assert.deepEqual([buttonOpts(g, t1).hovered, buttonOpts(g, t1).pressed], [true, false]);
  assert.deepEqual([buttonOpts(g, t2).hovered, buttonOpts(g, t2).pressed], [false, false]);
  g.v.pressedId = 'b';
  assert.deepEqual([buttonOpts(g, t2).hovered, buttonOpts(g, t2).pressed], [false, true]);
  assert.equal(buttonOpts(g, t1).pressed, false);
  assert.equal(buttonOpts(g, t1, 'buttonSmall', 8).style, 'buttonSmall');
  assert.equal(buttonOpts(g, t1, 'buttonSmall', 8).inset, 8);
  assert.equal(buttonOpts(g, t1).density, 2);
});

test('every variant and every state draws the image of that state', () => {
  const ids = {
    primary: ['button_primary_default', 'button_primary_focused', 'button_primary_pressed', 'button_primary_disabled'],
    secondary: ['button_secondary_default', 'button_secondary_focused', 'button_secondary_pressed', 'button_secondary_disabled'],
  };
  for (const [variant, list] of Object.entries(ids)) {
    const h = variant === 'primary' ? 120 : 100;
    const cases = [[{}, true, 0], [{ hovered: true }, true, 1], [{ pressed: true }, true, 2], [{}, false, 3], [{ hovered: true, pressed: true }, false, 3]];
    for (const [opts, enabled, idx] of cases) {
      const { assets, canvas } = fresh();
      drawButton(canvas.ctx, tg('x', 960, 540, 400, h, enabled), 'Label', { ...opts, assets, density: 1 });
      const im = images(canvas.ctx);
      assert.equal(im.length, 1, `${variant}/${idx}: one image`);
      assert.equal(im[0].id, list[idx], `${variant} ${JSON.stringify(opts)} enabled=${enabled}`);
      assert.equal(im[0].kind, 'sliced');
    }
  }
});

test('an explicit opts.variant picks the art of that variant whatever the height', () => {
  const { assets, canvas } = fresh();
  drawButton(canvas.ctx, tg('x', 960, 540, 400, 200), 'Big', { assets, variant: 'secondary' });
  assert.equal(images(canvas.ctx)[0].id, 'button_secondary_default');
});

// ------------------------------------------------------------------------------------------------------------------- frame and plate

test('frame: the target inset by opts.inset is sliced at that size and density, and drawn centred on the target centre', () => {
  const { assets, canvas } = fresh();
  drawButton(canvas.ctx, tg('m', 560, 975, 400, 100), 'Settings', { assets, density: 1.5, inset: 8, style: 'buttonSmall' });
  const call = assets.slicedLog.at(-1);
  assert.deepEqual([call.id, call.w, call.h, call.density], ['button_secondary_default', 384, 84, 1.5]);
  const [im] = images(canvas.ctx);
  assert.ok(near(im.x + im.w / 2, 560) && near(im.y + im.h / 2, 975), 'centred on (560, 975)');
  assert.ok(near(im.w, 384) && near(im.h, 84), 'the default state is exactly the frame');
  assert.equal(im.canvas.width, Math.ceil(384 * 1.5), 'the canvas is made at the density');
  assert.equal(canvas.ctx.counts.rotate ?? 0, 0, 'no tilt with art');
  assert.equal(canvas.ctx.counts.save ?? 0, 0);
});

test('frame: all four states scale with the default state (a focused button is bigger by its halo, centred on the same point)', () => {
  const { assets, canvas } = fresh();
  const target = tg('m', 960, 540, 620, 120);
  const seen = {};
  for (const [name, opts] of [['default', {}], ['focused', { hovered: true }], ['pressed', { pressed: true }]]) {
    canvas.ctx.calls.length = 0;
    drawButton(canvas.ctx, target, 'Resume', { assets, density: 1, ...opts });
    seen[name] = images(canvas.ctx)[0];
  }
  const s = 120 / SEED.button_primary_default.contentBox.h;
  for (const [name, im] of Object.entries(seen)) {
    const box = SEED[`button_primary_${name}`].contentBox;
    assert.ok(near(im.h, box.h * s, 1e-6), `${name}: height = its content box x the default's factor`);
    assert.ok(near(im.x + im.w / 2, 960) && near(im.y + im.h / 2, 540), `${name}: centred on the target`);
  }
  assert.ok(seen.focused.h > seen.default.h + 8, 'the halo of the focused state grows outside the target');
  assert.ok(near(seen.pressed.h, seen.default.h), 'pressed has the height of default');
});

test('plate: label insets are the manifest ones scaled by frameH / defaultBox.h, from the frame edges', () => {
  const primary = buttonPlate(SEED.button_primary_default, 520, 120);
  const s = 120 / 256;
  assert.ok(near(primary.s, s));
  assert.ok(near(primary.pl, -260 + 110 * s) && near(primary.pr, 260 - 110 * s));
  assert.ok(near(primary.pt, -60 + 46 * s) && near(primary.pb, 60 - 46 * s));
  const secondary = buttonPlate(SEED.button_secondary_default, 384, 84);
  const s2 = 84 / 221;
  assert.ok(near(secondary.pl, -192 + 125 * s2) && near(secondary.pr, 192 - 120 * s2), 'secondary: 125 left, 120 right');
  assert.equal(buttonPlate({ contentBox: { x: 0, y: 0, w: 10, h: 10 } }, 100, 100), null, 'no label data: no plate');
  assert.equal(buttonPlate({ contentBox: { x: 0, y: 0, w: 10, h: 10 }, label: { l: 60, r: 60, t: 1, b: 1 } }, 100, 100), null, 'an empty plate: no plate');
  assert.equal(buttonPlate(null, 100, 100), null);
});

test('plate: the label is centred in the plate rectangle, inside the frame, with a maxWidth of the plate width', () => {
  for (const [target, inset, variant, style] of [
    [tg('a', 960, 976, 520, 120), 0, 'primary', undefined],
    [tg('b', 560, 975, 400, 100), 8, 'secondary', 'buttonSmall'],
    [tg('c', 1440, 700, 800, 72), 6, 'secondary', 'buttonSmall'],
    [tg('d', 960, 585, 620, 84), 0, 'secondary', 'buttonTiny'],
  ]) {
    const { assets, canvas } = fresh();
    drawButton(canvas.ctx, target, 'Label', { assets, inset, style, density: 1 });
    const fw = target.w - 2 * inset;
    const fh = target.h - 2 * inset;
    const plate = buttonPlate(SEED[`button_${variant}_default`], fw, fh);
    const text = canvas.ctx.calls.find((c) => c[0] === 'fillText');
    assert.ok(text, `${target.id}: the label is drawn`);
    const pad = plateTextPad(plate.pr - plate.pl);
    assert.ok(near(text[4], plate.pr - plate.pl - 2 * pad), `${target.id}: maxWidth is the plate width less the padding on both sides`);
    assert.ok(pad > 0 && pad <= 14 && pad <= 0.06 * (plate.pr - plate.pl) + 1e-9, `${target.id}: the padding is at most 14 px and 6 percent`);
    assert.ok(near(text[2], target.x + (plate.pl + plate.pr) / 2), `${target.id}: centred horizontally on the plate`);
    assert.ok(near(text[3], target.y + (plate.pt + plate.pb) / 2 + 2), `${target.id}: centred vertically on the plate`);
    const { texts } = readDrawn(canvas.ctx.calls);
    assert.equal(canvas.ctx.calls.filter((c) => c[0] === '=textAlign').at(-1)[1], 'center');
    assert.equal(canvas.ctx.calls.filter((c) => c[0] === '=textBaseline').at(-1)[1], 'middle');
    assert.ok(plate.pl > -fw / 2 && plate.pr < fw / 2 && plate.pt > -fh / 2 && plate.pb < fh / 2, 'the plate lies inside the frame');
    assert.ok(texts[0].x >= target.x - fw / 2 && texts[0].x + texts[0].w <= target.x + fw / 2, 'and so does the text');
  }
});

test('label font: the style size shrunk to fit the plate, never above 85 percent of the plate height, never below 28 px', () => {
  const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: 0.6 });
  const ctx = canvas.ctx;
  // plenty of room: the style size (56) is capped by the plate height 77 * 0.85 = 65 -> 56 stays
  const roomy = fitLabelFont(ctx, 'button', 'Go', 417, 65);
  assert.equal(roomy.size, 56);
  // the cap wins over the style size
  const capped = fitLabelFont(ctx, 'button', 'Go', 417, 40);
  assert.equal(capped.size, 40);
  // a long text shrinks in steps of 2 until it fits
  const shrunk = fitLabelFont(ctx, 'button', 'Connect Joy-Con (native bridge)', 617, 65);
  assert.ok(shrunk.size < 56 && shrunk.size >= 28 && shrunk.width <= 617, `shrunk to ${shrunk.size}`);
  assert.equal(shrunk.size % 2, 0);
  // never below 28, even when it cannot fit (the caller then condenses through maxWidth)
  const floor = fitLabelFont(ctx, 'buttonSmall', 'x'.repeat(80), 100, 10);
  assert.equal(floor.size, 28);
  assert.ok(floor.width > 100);
  assert.equal(fitLabelFont(ctx, 'buttonTiny', 'Go', 300, 5).size, 28, 'a tiny cap is lifted to 28');
});

test('label colour: primary plates carry paper text (also disabled), secondary plates ink text, grey when disabled', () => {
  const colourOf = (variantH, enabled) => {
    const { assets, canvas } = fresh();
    drawButton(canvas.ctx, tg('c', 960, 540, 400, variantH, enabled), 'Label', { assets });
    const i = canvas.ctx.calls.findIndex((c) => c[0] === 'fillText');
    return canvas.ctx.calls.slice(0, i).filter((c) => c[0] === '=fillStyle').at(-1)[1];
  };
  assert.equal(colourOf(120, true), COLORS.paperLight);
  assert.equal(colourOf(120, false), COLORS.paperLight);
  assert.equal(colourOf(100, true), COLORS.ink);
  assert.equal(colourOf(100, false), COLORS.inkGrey);
});

test('a button with an icon draws it at the left end of the plate and shifts the label right by its width plus 12 px', () => {
  const { assets, canvas } = fresh();
  const target = tg('connect.mouse', 1640, 890, 400, 100);
  drawButton(canvas.ctx, target, 'Mouse only', { assets, inset: 8, style: 'buttonSmall', density: 1, icon: { id: 'glyph_mouse', h: 64 } });
  const im = images(canvas.ctx);
  assert.deepEqual(im.map((i) => i.id), ['button_secondary_default', 'glyph_mouse']);
  const icon = im[1];
  assert.ok(near(icon.h, 64), 'the glyph is 64 px tall');
  const plate = buttonPlate(SEED.button_secondary_default, 384, 84);
  assert.ok(icon.x >= target.x + plate.pl, 'the glyph starts inside the plate');
  const text = canvas.ctx.calls.find((c) => c[0] === 'fillText');
  const textLeft = text[2] - text[4] / 2;
  assert.ok(near(textLeft - (icon.x + icon.w), 12), `the label starts 12 px after the glyph (${textLeft - (icon.x + icon.w)})`);
  assert.ok(near(text[2] + text[4] / 2, target.x + plate.pr - plateTextPad(plate.pr - plate.pl)), 'and ends at the plate end less the padding');
  assert.ok(icon.y >= target.y - 42 && icon.y + icon.h <= target.y + 42, 'the glyph stays inside the frame');
  // an icon whose image is missing: no glyph, and the label keeps the whole plate
  const missing = fresh({ missing: ['glyph_mouse'] });
  drawButton(missing.canvas.ctx, target, 'Mouse only', { assets: missing.assets, inset: 8, style: 'buttonSmall', icon: { id: 'glyph_mouse', h: 64 } });
  assert.deepEqual(images(missing.canvas.ctx).map((i) => i.id), ['button_secondary_default']);
  const t2 = missing.canvas.ctx.calls.find((c) => c[0] === 'fillText');
  assert.ok(near(t2[4], plate.pr - plate.pl - 2 * plateTextPad(plate.pr - plate.pl)));
});

test('an icon that would leave the label less than 40 px is left out: a label always beats a decoration', () => {
  const { assets, canvas } = fresh();
  drawButton(canvas.ctx, tg('narrow', 500, 500, 200, 100), 'Mouse', { assets, inset: 8, style: 'buttonSmall', icon: { id: 'glyph_mouse', h: 64 } });
  assert.deepEqual(images(canvas.ctx).map((i) => i.id), ['button_secondary_default']);
  const text = canvas.ctx.calls.find((c) => c[0] === 'fillText');
  assert.ok(text[4] >= 40);
});

test('a zero-size target (an id the view does not have) never reaches the art path', () => {
  const { assets, canvas } = fresh();
  drawButton(canvas.ctx, { id: '', shape: 'rect', x: 0, y: 0, w: 0, h: 0, enabled: false }, 'Ghost', { assets });
  assert.equal(images(canvas.ctx).length, 0);
  assert.equal(assets.stats.sliced, 0);
});

test('a widget never modifies its target', () => {
  const { assets, canvas } = fresh();
  const frozen = Object.freeze(tg('f', 960, 540, 620, 120));
  const opts = Object.freeze({ assets, hovered: true, density: 2 });
  assert.doesNotThrow(() => drawButton(canvas.ctx, frozen, 'Resume', opts));
  assert.doesNotThrow(() => drawStepButton(canvas.ctx, Object.freeze(tg('s', 100, 100, 84, 84)), '+', true, Object.freeze({ assets, density: 2 })));
});

// ------------------------------------------------------------------------------------------------------------------- caching

test('cache: after the first frame a widget asks the Assets object for nothing (no sliced, scaled, has or meta call per frame)', () => {
  const { assets, canvas } = fresh();
  const draw = () => {
    drawButton(canvas.ctx, tg('m', 960, 540, 620, 120), 'Resume', { assets, hovered: true, density: 2 });
    drawButton(canvas.ctx, tg('n', 560, 975, 400, 100), 'Settings', { assets, inset: 8, style: 'buttonSmall', density: 2 });
    drawStepButton(canvas.ctx, tg('s', 182, 314, 84, 84), '-', false, { assets, density: 2 });
    drawToggle(canvas.ctx, tg('a', 250, 764, 210, 84), tg('b', 470, 764, 210, 84), 'On', 'Off', true, false, false, { assets, density: 2 });
    drawPanel(canvas.ctx, 960, 540, 900, 420, { assets, density: 2 });
    artImage(assets, 'icon_trophy', 72, 72, 2);
  };
  draw();
  assets.resetStats();
  for (let i = 0; i < 50; i++) draw();
  assert.deepEqual({ ...assets.stats }, { scaled: 0, sliced: 0, has: 0, get: 0, meta: 0 });
});

test('cache: a new generation (an image became usable or was released) rebuilds once, a new density is its own size', () => {
  const { assets, canvas } = fresh();
  const draw = (density) => drawButton(canvas.ctx, tg('m', 960, 540, 620, 120), 'Resume', { assets, density });
  draw(1);
  assert.equal(assets.stats.sliced, 1);
  draw(1);
  assert.equal(assets.stats.sliced, 1, 'cached');
  draw(2);
  assert.equal(assets.stats.sliced, 2, 'the density is part of the key');
  draw(1);
  assert.equal(assets.stats.sliced, 2, 'and the first size is still cached');
  assets.bump();
  draw(1);
  assert.equal(assets.stats.sliced, 3, 'a generation change refetches');
  draw(1);
  assert.equal(assets.stats.sliced, 3);
});

test('cache: a missing image is remembered as missing (no Assets call per frame) until the generation changes', () => {
  const { assets, canvas } = fresh({ missing: ['button_primary_focused'] });
  const t = tg('m', 960, 540, 620, 120);
  for (let i = 0; i < 5; i++) drawButton(canvas.ctx, t, 'Resume', { assets, hovered: true });
  assert.equal(assets.stats.sliced, 0, 'has() said no: sliced is never called');
  const hasCalls = assets.stats.has;
  for (let i = 0; i < 5; i++) drawButton(canvas.ctx, t, 'Resume', { assets, hovered: true });
  assert.equal(assets.stats.has, hasCalls);
  assets.setMissing(['button_primary_focused'], false);
  canvas.ctx.calls.length = 0;
  drawButton(canvas.ctx, t, 'Resume', { assets, hovered: true });
  assert.equal(images(canvas.ctx)[0].id, 'button_primary_focused');
});

// ------------------------------------------------------------------------------------------------------------------- steppers

test('stepper: minus and plus, four states, the image of that state; disabled wins over pressed and hovered', () => {
  const cases = [
    ['-', true, {}, false, 'stepper_minus_default'], ['-', true, {}, true, 'stepper_minus_focused'], ['-', true, { pressed: true }, true, 'stepper_minus_pressed'],
    ['-', false, {}, true, 'stepper_minus_disabled'], ['+', true, {}, false, 'stepper_plus_default'], ['+', true, {}, true, 'stepper_plus_focused'],
    ['+', true, { pressed: true }, false, 'stepper_plus_pressed'], ['+', false, { pressed: true }, true, 'stepper_plus_disabled'],
  ];
  for (const [symbol, enabled, o, hovered, id] of cases) {
    const { assets, canvas } = fresh();
    drawStepButton(canvas.ctx, tg('s', 182, 314, 84, 84, enabled), symbol, hovered, { assets, density: 1, ...o });
    assert.deepEqual(images(canvas.ctx).map((i) => i.id), [id], `${symbol} enabled=${enabled} hovered=${hovered} ${JSON.stringify(o)}`);
  }
  // a target without an `enabled` field (the fallback rectangles of settings.js carry enabled: true) is not disabled
  const { assets, canvas } = fresh();
  drawStepButton(canvas.ctx, { x: 100, y: 100, w: 84, h: 84 }, '+', false, { assets });
  assert.equal(images(canvas.ctx)[0].id, 'stepper_plus_default');
});

test('stepper: an 84 x 84 target draws about 82 x 84, centred; the states share the default scale so the halo grows outside the target', () => {
  const { assets, canvas } = fresh();
  const t = tg('s', 182, 314, 84, 84);
  const sizes = {};
  for (const [state, hovered, pressed, enabled] of [['default', false, false, true], ['focused', true, false, true], ['pressed', false, true, true], ['disabled', false, false, false]]) {
    canvas.ctx.calls.length = 0;
    drawStepButton(canvas.ctx, { ...t, enabled }, '-', hovered, { assets, pressed });
    sizes[state] = images(canvas.ctx)[0];
  }
  const def = sizes.default;
  assert.ok(def.w > 80 && def.w <= 84 && near(def.h, 84), `default ${def.w} x ${def.h}`);
  assert.ok(near(def.x + def.w / 2, 182) && near(def.y + def.h / 2, 314));
  const scale = def.h / SEED.stepper_minus_default.contentBox.h;
  for (const [state, im] of Object.entries(sizes)) {
    assert.ok(near(im.h / SEED[`stepper_minus_${state}`].contentBox.h, scale, 1e-9), `${state} keeps the default's scale`);
    assert.ok(near(im.x + im.w / 2, 182, 1.5) && near(im.y + im.h / 2, 314, 3), `${state} stays centred on the target`);
  }
  assert.ok(sizes.focused.h > def.h, 'the focused halo is bigger');
});

test('stepper: the optional 5th parameter is optional (no opts: procedural, unchanged)', () => {
  const canvas = makeRecordingCanvas();
  drawStepButton(canvas.ctx, tg('s', 182, 314, 84, 84), '-', false);
  assert.equal(images(canvas.ctx).length, 0);
  assert.ok(canvas.ctx.counts.stroke >= 2, 'the procedural border and symbol');
});

// ------------------------------------------------------------------------------------------------------------------- toggles

const CELL_A = tg('set.reduceFlash.on', 250, 764, 210, 84);
const CELL_B = tg('set.reduceFlash.off', 470, 764, 210, 84);

function toggle({ activeA, hoverA = false, hoverB = false, missing, density = 1 }) {
  const { assets, canvas } = fresh({ missing });
  drawToggle(canvas.ctx, CELL_A, CELL_B, 'On', 'Off', activeA, hoverA, hoverB, { assets, density });
  return { assets, canvas, drawn: readDrawn(canvas.ctx.calls) };
}

test('toggle: On selected is the picture of toggle_off.png, Off selected the picture of toggle_on.png (red cell = selected cell)', () => {
  assert.deepEqual(toggle({ activeA: true }).drawn.images.map((i) => i.id), ['toggle_off']);
  assert.deepEqual(toggle({ activeA: false }).drawn.images.map((i) => i.id), ['toggle_on']);
});

test('toggle: hovering either cell shows toggle_focused; mirrored when the left cell is the selected one, never otherwise', () => {
  for (const hover of [{ hoverA: true }, { hoverB: true }]) {
    const off = toggle({ activeA: false, ...hover });
    assert.deepEqual(off.drawn.images.map((i) => [i.id, i.mirrored]), [['toggle_focused', false]]);
    assert.equal(off.canvas.ctx.counts.scale ?? 0, 0);
    const on = toggle({ activeA: true, ...hover });
    assert.deepEqual(on.drawn.images.map((i) => [i.id, i.mirrored]), [['toggle_focused', true]]);
    assert.deepEqual(on.canvas.ctx.calls.filter((c) => c[0] === 'scale'), [['scale', -1, 1]], 'a horizontal mirror through ctx.scale(-1, 1)');
    assert.equal(on.canvas.ctx.counts.save, 1);
    assert.equal(on.canvas.ctx.counts.restore, 1, 'the mirror is undone');
  }
});

test('toggle: the picture is 84 px high (contained in the union of the two cells), centred on the union, narrower than the union', () => {
  const { drawn } = toggle({ activeA: false });
  const [im] = drawn.images;
  const unionW = 430;
  assert.ok(near(im.h, 84), `height ${im.h}`);
  assert.ok(im.w < unionW, `width ${im.w} < ${unionW}`);
  assert.ok(near(im.x + im.w / 2, (CELL_A.x + CELL_B.x) / 2) && near(im.y + im.h / 2, 764));
  assert.ok(near(im.w / im.h, SEED.toggle_on.contentBox.w / SEED.toggle_on.contentBox.h, 1e-9));
});

test('toggle: the focused picture keeps the scale of the rest picture of the same selection (the halo grows, the toggle never shrinks)', () => {
  const rest = toggle({ activeA: false }).drawn.images[0];
  const focused = toggle({ activeA: false, hoverA: true }).drawn.images[0];
  const scaleOf = (im, id) => im.h / SEED[id].contentBox.h;
  assert.ok(near(scaleOf(rest, 'toggle_on'), scaleOf(focused, 'toggle_focused'), 1e-9));
  assert.ok(focused.h > rest.h);
  const restOn = toggle({ activeA: true }).drawn.images[0];
  const focusedOn = toggle({ activeA: true, hoverB: true }).drawn.images[0];
  assert.ok(near(scaleOf(restOn, 'toggle_off'), scaleOf(focusedOn, 'toggle_focused'), 1e-9));
});

test('toggle: On and Off are labelled at the centres of the two cells of the picture (meta.cells), the selected cell in paper text, the other in ink', () => {
  for (const activeA of [true, false]) {
    for (const hover of [false, true]) {
      const { canvas, drawn } = toggle({ activeA, hoverA: hover });
      const im = drawn.images[0];
      const cells = SEED.toggle_on.cells;
      const centre = (c) => im.x + (c.x + c.w / 2) * im.w;
      const leftCentre = centre(cells[0]);
      const rightCentre = centre(cells[1]);
      const on = drawn.texts.find((t) => t.text === 'On');
      const off = drawn.texts.find((t) => t.text === 'Off');
      assert.ok(on && off, 'both labels are drawn');
      assert.ok(near(on.cx, leftCentre, 1e-6) && near(off.cx, rightCentre, 1e-6), `activeA=${activeA} hover=${hover}: On left, Off right`);
      assert.ok(near(on.cy, 764 + 2) && near(off.cy, 764 + 2));
      assert.ok(on.size >= 28 && off.size >= 28);
      const order = canvas.ctx.calls.map((c, i) => [c, i]).filter(([c]) => c[0] === 'fillText');
      const fillBefore = (i) => canvas.ctx.calls.slice(0, i).filter((c) => c[0] === '=fillStyle').at(-1)[1];
      const onFill = fillBefore(order.find(([c]) => c[1] === 'On')[1]);
      const offFill = fillBefore(order.find(([c]) => c[1] === 'Off')[1]);
      assert.equal(onFill, activeA ? COLORS.paperLight : COLORS.ink, `On text colour (activeA=${activeA})`);
      assert.equal(offFill, activeA ? COLORS.ink : COLORS.paperLight, `Off text colour (activeA=${activeA})`);
      // each label fits the interior of its cell with room on both sides
      for (const t of [on, off]) assert.ok(t.w <= 0.45 * im.w - 16 + 1e-6, `${t.text} (${t.w}) fits its cell (${0.45 * im.w})`);
    }
  }
});

test('toggle: the mirrored picture is labelled the same way (On on the left, Off on the right)', () => {
  const { drawn } = toggle({ activeA: true, hoverB: true });
  const im = drawn.images[0];
  assert.equal(im.mirrored, true);
  const on = drawn.texts.find((t) => t.text === 'On');
  const off = drawn.texts.find((t) => t.text === 'Off');
  assert.ok(on.cx < off.cx);
  assert.ok(near((on.cx + off.cx) / 2, im.x + im.w / 2, 1e-6), 'symmetric about the picture centre');
});

test('toggle: a missing picture (or missing cell data) falls back to the two procedural cells, and the hit rectangles are the cells', () => {
  for (const o of [{ missing: ['toggle_on'] }, { missing: ['toggle_focused'], hoverA: true }, { meta: { toggle_on: { cells: undefined } } }]) {
    const { assets, canvas } = fresh(o.meta ? { meta: o.meta } : { missing: o.missing });
    drawToggle(canvas.ctx, CELL_A, CELL_B, 'On', 'Off', false, !!o.hoverA, false, { assets });
    assert.equal(images(canvas.ctx).length, 0, JSON.stringify(Object.keys(o)));
    assert.deepEqual(canvas.ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]), ['On', 'Off']);
    assert.equal(canvas.ctx.calls.filter((c) => c[0] === 'fillText').every((c) => c.length === 4), true, 'drawn by drawText, not by the art path');
  }
});

// ------------------------------------------------------------------------------------------------------------------- panels

test('panel: the five panels of the game are sliced at their size and density and drawn centred; no offset shadow', () => {
  const panels = [
    ['safety', 960, 540, 1800, 1064], ['connect steps', 560, 580, 880, 660], ['results', RESULTS_PANEL.x, RESULTS_PANEL.y, RESULTS_PANEL.w, RESULTS_PANEL.h],
    ['disconnect', DISCONNECT_PANEL.x, DISCONNECT_PANEL.y, DISCONNECT_PANEL.w, DISCONNECT_PANEL.h], ['confirm', CONFIRM_PANEL.x, CONFIRM_PANEL.y, CONFIRM_PANEL.w, CONFIRM_PANEL.h],
  ];
  for (const [name, cx, cy, w, h] of panels) {
    const { assets, canvas } = fresh();
    drawPanel(canvas.ctx, cx, cy, w, h, { assets, density: 2 });
    const call = assets.slicedLog.at(-1);
    assert.deepEqual([call.id, call.w, call.h, call.density], ['panel_9slice', w, h, 2], name);
    const [im] = images(canvas.ctx);
    assert.ok(near(im.x + im.w / 2, cx) && near(im.y + im.h / 2, cy), `${name}: centred`);
    assert.ok(near(im.w, w) && near(im.h, h), `${name}: exactly the panel size`);
    assert.equal(canvas.ctx.counts.fill ?? 0, 0, `${name}: no procedural fill or shadow`);
    assert.equal(canvas.ctx.counts.stroke ?? 0, 0);
  }
});

test('panel: a custom fill takes the procedural path even with art; a missing panel image falls back; alpha is reset like the procedural panel', () => {
  const { assets, canvas } = fresh();
  drawPanel(canvas.ctx, 500, 400, 600, 300, { assets, fill: '#ff0000' });
  assert.equal(images(canvas.ctx).length, 0);
  assert.equal(canvas.ctx.counts.fill, 2, 'shadow and body');
  const gone = fresh({ missing: ['panel_9slice'] });
  drawPanel(gone.canvas.ctx, 500, 400, 600, 300, { assets: gone.assets });
  assert.equal(images(gone.canvas.ctx).length, 0);
  assert.equal(gone.canvas.ctx.counts.fill, 2);
  const alpha = fresh();
  alpha.canvas.ctx.globalAlpha = 0.3;
  drawPanel(alpha.canvas.ctx, 500, 400, 600, 300, { assets: alpha.assets });
  assert.equal(alpha.canvas.ctx.globalAlpha, 1, 'drawPanel has always set the alpha to 1 (the results panel does not fade); the art path does the same');
});

// ------------------------------------------------------------------------------------------------------------------- icons and the switch

test('artImage: the content box contained in the box at the density, cached, null when the image is missing, the null assets or no assets', () => {
  const { assets } = fresh();
  const r = artImage(assets, 'icon_trophy', 72, 72, 2);
  const box = SEED.icon_trophy.contentBox;
  const s = Math.min(72 / box.w, 72 / box.h);
  assert.ok(near(r.w, box.w * s) && near(r.h, box.h * s));
  assert.equal(r.canvas.width, Math.ceil(r.w * 2));
  assert.equal(artImage(assets, 'icon_trophy', 72, 72, 2), r, 'the same object on the next call');
  assert.equal(artImage(createArtStub({ missing: ['icon_trophy'] }), 'icon_trophy', 72, 72), null);
  assert.equal(artImage(NULL_ASSETS, 'icon_trophy', 72, 72), null);
  assert.equal(artImage(undefined, 'icon_trophy', 72, 72), null);
  assert.equal(artImage(assets, 'no_such_icon', 72, 72), null);
});

test('hasArt: real assets only', () => {
  assert.equal(hasArt(createArtStub()), true);
  for (const bad of [undefined, null, NULL_ASSETS, {}, { has: () => true }, { isNull: true, has() {}, scaled() {}, sliced() {} }]) assert.equal(hasArt(bad), false);
});

test('cache: drawing every screen, overlay and the HUD again and again grows the cache once (the first frame of each) and never after', () => {
  resetWidgetArt();
  const assets = createArtStub();
  const sprites = makeSpriteStub({ withHalves: true });
  const pass = () => { for (const name of Object.keys(SCENES)) runScene(name, { assets, sprites }); };
  // the panel pictures are the one exception (only the last three stay held, see the memory test): count every other Assets call
  const others = () => assets.stats.scaled + assets.slicedLog.filter((c) => c.id !== 'panel_9slice').length;
  pass();
  const after1 = widgetArtCacheSize();
  assert.ok(after1 > 20 && after1 < 160, `${after1} entries after one pass`);
  const calls = others();
  pass();
  pass();
  assert.equal(widgetArtCacheSize(), after1, 'no growth on the next passes');
  assert.equal(others(), calls, 'and no new Assets call: one image per widget size, ever');
});

test('memory: only the last three panel pictures stay referenced (the safety panel alone is 30 MB at density 2); a panel drawn again is fetched again once', () => {
  const { assets, canvas } = fresh();
  const sizes = [[1800, 1064], [880, 660], [1240, 880], [900, 640], [900, 420]];
  for (const [w, h] of sizes) drawPanel(canvas.ctx, 960, 540, w, h, { assets, density: 2 });
  assert.equal(assets.stats.sliced, 5);
  // the last three (results, disconnect, confirm) are cached: drawing them again asks for nothing
  assets.resetStats();
  for (const [w, h] of sizes.slice(2)) drawPanel(canvas.ctx, 960, 540, w, h, { assets, density: 2 });
  assert.equal(assets.stats.sliced, 0, 'the last three panels are still held');
  // the first two were let go: one fetch each, then held again
  for (const [w, h] of sizes.slice(0, 2)) drawPanel(canvas.ctx, 960, 540, w, h, { assets, density: 2 });
  assert.equal(assets.stats.sliced, 2, 'the two older panels are fetched once more');
  // and every draw still put the whole panel on the canvas
  assert.equal(images(canvas.ctx).filter((i) => i.id === 'panel_9slice').length, 5 + 3 + 2);
  const before = assets.stats.sliced;
  for (const [w, h] of sizes.slice(0, 2)) drawPanel(canvas.ctx, 960, 540, w, h, { assets, density: 2 });
  assert.equal(assets.stats.sliced, before, 'held again');
});
