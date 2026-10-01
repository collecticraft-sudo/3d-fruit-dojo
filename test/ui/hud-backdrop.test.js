// Integration fix: with a stage backdrop under the frame (g.backdropArt, set by the renderer when a stage layer was drawn) the small HUD labels
// (SCORE, BEST, TIME, LIVES and the first-seconds hint) get the paper outline the big digits already have, because lanterns and bamboo can sit
// behind them. Without a backdrop the HUD draws exactly what it drew before (pinned by test/ui/art-fallback.test.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../../public/js/render/palette.js';
import { drawHud } from '../../public/js/render/hud.js';
import { createArtStub } from '../../test-support/ui/art-stub.js';
import { makeFxStub, makeG, makeRecordingCanvas, makeSpriteStub } from '../../test-support/ui/art-scenes.js';
import { makeSnapshot, makeUiHarness } from '../../test-support/ui/fixtures.js';

function draw(snapshotOver, { backdropArt, assets = createArtStub(), hint = true } = {}) {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.view.hint.show = hint;
  const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: 0.6 });
  const g = makeG({ view: h.view, assets, density: 2, snapshot: makeSnapshot(snapshotOver), sprites: makeSpriteStub(), fx: makeFxStub(), canvas });
  if (backdropArt !== undefined) g.backdropArt = backdropArt;
  drawHud(g, { scorePop: 1 });
  return canvas.ctx;
}

const outlined = (ctx, text) => ctx.texts.some((t) => t.text === text && t.op === 'strokeText');

test('with a stage backdrop the small labels are outlined in paper and the timer caption too; the hint sits on a paper label instead (art review round 1, M4)', () => {
  const ctx = draw({ mode: 'arcade', lives: null, timeLeft: 42, timeTotal: 60 }, { backdropArt: true });
  for (const label of ['SCORE', 'TIME']) assert.equal(outlined(ctx, label), true, label);
  assert.equal(ctx.texts.some((t) => /^BEST /.test(t.text) && t.op === 'strokeText'), true, 'BEST');
  // the hint: a rounded paper plate is filled first, then the text is drawn at full strength, without the outline
  const hintAt = ctx.calls.findIndex((c) => c[0] === 'fillText' && /Pause|Recenter/i.test(c[1]));
  assert.ok(hintAt > 0, 'the hint is drawn');
  assert.equal(ctx.calls.some((c) => c[0] === 'strokeText' && /Pause|Recenter/i.test(c[1])), false, 'no outline on the hint any more');
  const before = ctx.calls.slice(0, hintAt);
  const fillAt = before.map((c, i) => [c, i]).filter(([c]) => c[0] === 'fill').at(-1)[1];
  const fillStyle = before.slice(0, fillAt).filter((c) => c[0] === '=fillStyle').at(-1)[1];
  assert.equal(fillStyle, COLORS.paperLight, 'the plate is paper');
  assert.ok(before.slice(fillAt - 8, fillAt).filter((c) => c[0] === 'arcTo').length === 4, 'a rounded rectangle');
  const alphaAt = before.filter((c) => c[0] === '=globalAlpha').at(-1)[1];
  assert.equal(alphaAt, 1, 'the text itself is not dimmed to 0.6 on a plate');
  const stroke = ctx.calls.filter((c) => c[0] === 'strokeText' && c[1] === 'SCORE');
  assert.equal(stroke.length, 1);
  const styleIdx = ctx.calls.findIndex((c) => c[0] === 'strokeText' && c[1] === 'SCORE');
  const sty = ctx.calls.slice(0, styleIdx).filter((c) => c[0] === '=strokeStyle').at(-1);
  assert.equal(sty[1], COLORS.paperLight);
});

test('Classic: the LIVES caption is outlined too', () => {
  const ctx = draw({ mode: 'classic', lives: 3 }, { backdropArt: true });
  assert.equal(outlined(ctx, 'LIVES'), true);
});

test('without a backdrop (painted background, no flag, false) no small label is outlined: the frame is what it was before the art', () => {
  for (const backdropArt of [undefined, false]) {
    for (const snap of [{ mode: 'arcade', lives: null, timeLeft: 42, timeTotal: 60 }, { mode: 'classic', lives: 3 }]) {
      const ctx = draw(snap, { backdropArt });
      for (const label of ['SCORE', 'TIME', 'LIVES']) assert.equal(outlined(ctx, label), false, `${label} (${backdropArt})`);
      assert.equal(ctx.texts.some((t) => /^BEST /.test(t.text) && t.op === 'strokeText'), false);
    }
  }
});
