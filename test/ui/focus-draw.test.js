// What the focus looks like (ui/widgets.js drawFocusRing, drawNavHint, isLit; the screens that react to them): a strong double ring around the focused unit, the
// focused art state on its cells, one hint line on a paper text plate that never touches a button or another text, and no change at all for a view without focus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFocusRing, drawNavHint, isLit } from '../../public/js/ui/widgets.js';
import { FOCUS_RING, NAV_HINT } from '../../public/js/ui/layout-data.js';
import { COLORS } from '../../public/js/render/palette.js';
import { makeRecordingCanvas, makeSpriteStub, runScene } from '../../test-support/ui/art-scenes.js';
import { readDrawn } from '../../test-support/ui/art-geometry.js';

const callsOf = (fn) => {
  const canvas = makeRecordingCanvas();
  fn(canvas.ctx);
  return canvas.ctx.calls;
};
const focusView = (over = {}) => ({
  hover: { id: null }, screen: 'menu', overlay: null,
  focus: { id: 'set.back', ids: ['set.back'], visible: true, valueRow: null, shape: 'rect', ring: { x0: 1250, y0: 930, x1: 1650, y1: 1030 } },
  navHint: { show: true, kind: 'joycon', text: 'Stick: move   A: select   B: back', canBack: true },
  ...over,
});

test('the ring: ink outside (14 px) and gold inside (7 px), 12 px off the rectangle, two strokes of one path; a circle gets one 30 px off its radius', () => {
  const calls = callsOf((ctx) => drawFocusRing(ctx, focusView()));
  const strokes = calls.filter((c) => c[0] === 'stroke').length;
  assert.equal(strokes, 2);
  const widths = calls.filter((c) => c[0] === '=lineWidth').map((c) => c[1]);
  assert.deepEqual(widths, [FOCUS_RING.inkW, FOCUS_RING.goldW]);
  assert.deepEqual(calls.filter((c) => c[0] === '=strokeStyle').map((c) => c[1]), [COLORS.ink, COLORS.gold]);
  assert.ok(calls.some((c) => c[0] === 'save') && calls.some((c) => c[0] === 'restore'), 'the context is left as it was');
  const circle = callsOf((ctx) => drawFocusRing(ctx, focusView({ focus: { id: 'menu.arcade', ids: ['menu.arcade'], visible: true, shape: 'circle', ring: { x0: 790, y0: 350, x1: 1130, y1: 690 } } })));
  const arc = circle.find((c) => c[0] === 'arc');
  assert.deepEqual([arc[1], arc[2], arc[3]], [960, 520, 170 + FOCUS_RING.circlePad]);
});

test('no ring and no hint when the focus is not visible, absent, or the view has none of it (old fixtures, mouse and simulator before a key)', () => {
  assert.deepEqual(callsOf((ctx) => drawFocusRing(ctx, focusView({ focus: { ...focusView().focus, visible: false } }))), []);
  assert.deepEqual(callsOf((ctx) => drawFocusRing(ctx, focusView({ focus: { id: null, ids: [], visible: true, ring: null } }))), []);
  assert.deepEqual(callsOf((ctx) => drawFocusRing(ctx, { hover: { id: null } })), []);
  assert.deepEqual(callsOf((ctx) => drawNavHint(ctx, focusView({ navHint: { show: false, text: '' } }))), []);
  assert.deepEqual(callsOf((ctx) => drawNavHint(ctx, { hover: { id: null } })), []);
});

test('the hint line: the text on a paper plate at the bottom edge, on the safety page beside the "Got it" button, 28 px or more', () => {
  const calls = callsOf((ctx) => drawNavHint(ctx, focusView()));
  const text = calls.filter((c) => c[0] === 'fillText' && c[1] === 'Stick: move   A: select   B: back');
  assert.equal(text.length, 1);
  assert.deepEqual([text[0][2], text[0][3]], [NAV_HINT.x, NAV_HINT.y]);
  const fills = calls.filter((c) => c[0] === 'fill').length;
  assert.ok(fills >= 1, 'the plate is filled before the text');
  assert.ok(calls.findIndex((c) => c[0] === 'fill') < calls.findIndex((c) => c[0] === 'fillText'));
  assert.ok(Number(/(\d+)px/.exec(text[0].font)[1]) >= 28, text[0].font);
  const safety = callsOf((ctx) => drawNavHint(ctx, focusView({ screen: 'safety' })));
  const st = safety.find((c) => c[0] === 'fillText');
  assert.deepEqual([st[2], st[3]], [NAV_HINT.safety.x, NAV_HINT.safety.y]);
  const dialog = callsOf((ctx) => drawNavHint(ctx, focusView({ screen: 'safety', overlay: 'confirm' })));
  assert.deepEqual([dialog.find((c) => c[0] === 'fillText')[2], dialog.find((c) => c[0] === 'fillText')[3]], [NAV_HINT.x, NAV_HINT.y], 'a dialog over any screen uses the bottom edge');
});

test('isLit: the pointer or the focused unit lights a widget, both cells of a focused row light, an invisible focus lights nothing', () => {
  const v = focusView({ hover: { id: 'set.reset' }, focus: { id: 'row:volume', ids: ['set.volume.minus', 'set.volume.plus'], visible: true } });
  assert.deepEqual(['set.reset', 'set.volume.minus', 'set.volume.plus', 'set.back'].map((id) => isLit(v, id)), [true, true, true, false]);
  v.focus.visible = false;
  assert.deepEqual(['set.reset', 'set.volume.minus'].map((id) => isLit(v, id)), [true, false]);
  assert.equal(isLit({ hover: { id: 'x' } }, 'x'), true, 'a view without focus is hover only');
});

test('screens: a focused settings row draws its explanation under the title, the menu hint line replaces the alternating slice line, the results rest line steps aside', () => {
  const settings = runScene('settings', { sprites: makeSpriteStub(), view: (v) => { v.focus = { id: 'row:swordSelect', ids: ['set.swordSelect.on', 'set.swordSelect.off'], visible: true, valueRow: { key: 'swordSelect', type: 'toggle' } }; } });
  const { texts } = readDrawn(settings.calls);
  const help = texts.find((x) => x.text.startsWith('Real Joy-Con. Off:'));
  assert.ok(help, 'the help of the ninth row');
  assert.ok(help.y < 223, `under the title and above the first row (y ${help.y})`);
  const rowLabel = texts.find((x) => x.text === 'Sword selection in menus');
  assert.ok(rowLabel && rowLabel.x === 140);
  const plain = runScene('menu', { sprites: makeSpriteStub() });
  const withHint = runScene('menu', { sprites: makeSpriteStub(), view: (v) => { v.navHint = { show: true, text: 'Stick: move   A: select' }; } });
  const bottom = (r) => readDrawn(r.calls).texts.filter((x) => x.y > 1030).map((x) => x.text);
  assert.equal(bottom(plain).length, 1, 'the alternating line');
  assert.deepEqual(bottom(withHint), [], 'the menu draws no bottom line of its own while the hint line (drawn by the renderer) shows');
  const resultsPlain = runScene('results-classic', { sprites: makeSpriteStub() });
  const resultsHint = runScene('results-classic', { sprites: makeSpriteStub(), view: (v) => { v.navHint = { show: true, text: 'Stick: move   A: select   B: back' }; } });
  const rest = (r) => readDrawn(r.calls).texts.find((x) => x.text.startsWith('Take a'))?.y ?? readDrawn(r.calls).texts.filter((x) => x.y > 980).at(-1)?.y;
  assert.ok(rest(resultsHint) < rest(resultsPlain), 'the rest line moved up');
});
