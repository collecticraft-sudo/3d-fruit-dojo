// Text fits the plate (docs/assets-integration.md 5.2, 8.5): every real label of strings.en.js, on every button target of every screen, in every
// state the screens can show, is at least 28 px, at most 85 percent of the plate height (or 28), and no wider than the plate at the font it ends
// up with. The width is 0.53 em per character: what Chrome on macOS measures for the serif button style (Hiragino Mincho ProN, weight 800) on
// these labels (0.51 to 0.53, measured 2026-09-30 in the visual harness; "Reset high scores" is 243 px and "No, keep playing" 236 px at 28 px).
// A wider fallback font would be condensed by the maxWidth safety net of the label (see the last tests). Also every scene of
// test-support/ui/art-scenes.js is drawn with art and every label the art path draws is checked in place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawButton, resetWidgetArt } from '../../public/js/ui/widgets.js';
import { screenTargets } from '../../public/js/ui/layout-data.js';
import { TEXT_STYLES } from '../../public/js/render/palette.js';
import { SEED, createArtStub } from '../../test-support/ui/art-stub.js';
import { SCENES, makeRecordingCanvas, runScene } from '../../test-support/ui/art-scenes.js';
import { TARGET_VIEWS } from '../../test-support/ui/target-views.js';
import { BUTTONS, CONNECT } from '../../test-support/ui/art-checks.js';
import { readDrawn } from '../../test-support/ui/art-geometry.js';

/** Em per character of the serif button style in Chrome on macOS (measured, see above). */
const WIDTH_FACTOR = 0.53;
const styleFor = (h) => (h >= 120 ? 'button' : h >= 96 ? 'buttonSmall' : 'buttonTiny');
const sizeOfFont = (font) => Number(/(\d+(?:\.\d+)?)px/.exec(font)[1]);

test('the button table of this test is the game: every target it names exists with that size (so the fit checks below are about real buttons)', () => {
  const found = new Map();
  for (const view of Object.values(TARGET_VIEWS)) for (const tg of screenTargets(view)) if (tg.shape === 'rect') found.set(`${tg.id}|${tg.w}|${tg.h}`, tg);
  for (const [id, w, h] of BUTTONS) {
    const bare = id.replace(/ \(native\)$/, '');
    assert.ok(found.has(`${bare}|${w}|${h}`), `${id} ${w} x ${h} is a target of layout-data.js`);
  }
  assert.ok(CONNECT.main.length >= 4 && CONNECT.mainNative.length >= 4 && CONNECT.secondary.length >= 2 && CONNECT.fallback.length >= 1 && CONNECT.cancel.length >= 1, 'the connect model matrix produced the labels');
});

test('every real label fits the plate of its button at a font of 28 px or more (0.53 em per character, as measured in Chrome)', () => {
  const problems = [];
  let checked = 0;
  for (const [id, w, h, inset, style, labels, glyphH] of BUTTONS) {
    for (const label of labels) {
      resetWidgetArt();
      const assets = createArtStub();
      const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: WIDTH_FACTOR });
      const tg = { id, shape: 'rect', x: 960, y: 540, w, h, enabled: true };
      drawButton(canvas.ctx, tg, label, { assets, inset, style, density: 1, icon: glyphH ? { id: 'glyph_mouse', h: glyphH } : undefined });
      const call = canvas.ctx.calls.find((c) => c[0] === 'fillText');
      if (!call) { problems.push(`${id} "${label}": the art path did not draw`); continue; }
      checked++;
      const size = sizeOfFont(call.font);
      const frameH = h - 2 * inset;
      const variant = h >= 120 ? 'primary' : 'secondary';
      const plateH = frameH - (SEED[`button_${variant}_default`].label.t + SEED[`button_${variant}_default`].label.b) * (frameH / SEED[`button_${variant}_default`].contentBox.h);
      const maxSize = Math.max(28, Math.floor(0.85 * plateH));
      const base = TEXT_STYLES[style ?? styleFor(frameH)].size;
      const width = label.length * size * WIDTH_FACTOR;
      if (size < 28) problems.push(`${id} "${label}": ${size} px is below 28`);
      if (size > maxSize) problems.push(`${id} "${label}": ${size} px is above 85 percent of the plate (${maxSize})`);
      if (size > base) problems.push(`${id} "${label}": ${size} px is above the style size ${base}`);
      if (width > call[4] + 0.5) problems.push(`${id} "${label}": ${width.toFixed(0)} px wide at ${size} px does not fit ${call[4].toFixed(0)} px`);
    }
  }
  assert.ok(checked > 45, `checked ${checked} label and button pairs`);
  assert.deepEqual(problems, []);
});

test('the labels are not squeezed by the maxWidth in the game: at a plate width the text is at its natural width (the condensing is only a safety net)', () => {
  // list the labels that end up at 28 px because they are long: they are the ones to watch when a string is edited
  const floorLabels = [];
  for (const [id, w, h, inset, style, labels] of BUTTONS) {
    for (const label of labels) {
      resetWidgetArt();
      const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: WIDTH_FACTOR });
      drawButton(canvas.ctx, { id, shape: 'rect', x: 0, y: 0, w, h, enabled: true }, label, { assets: createArtStub(), inset, style });
      const call = canvas.ctx.calls.find((c) => c[0] === 'fillText');
      if (sizeOfFont(call.font) === 28 && label.length * 28 * WIDTH_FACTOR > call[4]) floorLabels.push(`${id}: ${label}`);
    }
  }
  assert.deepEqual(floorLabels, [], 'no label needs the condensing safety net');
});

test('a label longer than its plate at 28 px is drawn at 28 px with a maxWidth (the browser condenses it), never smaller and never over the frame', () => {
  resetWidgetArt();
  const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: WIDTH_FACTOR });
  const long = 'A very long label that cannot possibly fit a small button plate at any legal size';
  drawButton(canvas.ctx, { id: 'x', shape: 'rect', x: 960, y: 540, w: 400, h: 100, enabled: true }, long, { assets: createArtStub(), style: 'buttonSmall' });
  const call = canvas.ctx.calls.find((c) => c[0] === 'fillText');
  assert.equal(sizeOfFont(call.font), 28);
  const { texts } = readDrawn(canvas.ctx.calls);
  assert.ok(texts[0].w <= call[4], 'the box of the text is the plate width, not the natural width');
});

test('every scene drawn with art: every label the art path draws sits inside its plate and is at least 28 px', () => {
  const problems = [];
  let labels = 0;
  for (const name of Object.keys(SCENES)) {
    const r = runScene(name, { assets: createArtStub(), widthFactor: WIDTH_FACTOR });
    for (const c of r.calls) {
      if (c[0] !== 'fillText' || c.length !== 5) continue;
      labels++;
      const size = sizeOfFont(c.font);
      if (size < 28) problems.push(`${name} "${c[1]}": ${size}`);
      if (String(c[1]).length * size * WIDTH_FACTOR > c[4] + 0.5) problems.push(`${name} "${c[1]}": wider than its plate ${c[4]}`);
    }
    for (const c of r.calls) if (c[0] === 'fillText' || c[0] === 'strokeText') assert.ok(sizeOfFont(c.font ?? '28px') >= 28, `${name} "${c[1]}": text is 28 px or more`);
  }
  assert.ok(labels >= 30, `${labels} art labels found`);
  assert.deepEqual(problems, []);
});

test('with the art the smallest label is 28 px on the smallest plate (frame 60 px high: plate 29.6 px, cap = max(28, 25) = 28)', () => {
  resetWidgetArt();
  const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: WIDTH_FACTOR });
  drawButton(canvas.ctx, { id: 'connect.cancel', shape: 'rect', x: 1440, y: 700, w: 400, h: 72, enabled: true }, 'Cancel', { assets: createArtStub(), inset: 6, style: 'buttonSmall' });
  assert.equal(sizeOfFont(canvas.ctx.calls.find((c) => c[0] === 'fillText').font), 28);
});
