// Procedural art smoke tests: every painter runs against the fake 2D context without throwing, never uses shadowBlur or filter,
// and is deterministic (no Math.random: sprites must look the same in every run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { FRUIT_ART, FRUIT_IDS, POWERUP_ART, fontString, juiceColorOf } from '../../public/js/render/palette.js';
import { bodyPath, paintBackground, paintBomb, paintBrushBand, paintFruit, paintGolden, paintHalf, paintLifeApple, paintMedallion, paintPaperGrain, paintSplat, paintVignette } from '../../public/js/render/painters.js';
import { CONFIG } from '../../public/js/game/config.js';
import { FakeCanvas, FakeContext } from '../../test-support/render/fake-canvas.js';

const fresh = () => new FakeContext({});

test('palette: the ten fruit match the design table and the game config (radius, juice colour)', () => {
  assert.equal(FRUIT_IDS.length, 10);
  for (const f of CONFIG.fruits) {
    assert.ok(FRUIT_ART[f.id], `art for ${f.id}`);
    assert.equal(FRUIT_ART[f.id].r, f.r, `${f.id} radius`);
    assert.equal(FRUIT_ART[f.id].juice.toLowerCase(), f.juice.toLowerCase(), `${f.id} juice colour`);
  }
  assert.equal(juiceColorOf('golden'), '#F2B134');
  assert.equal(juiceColorOf('freeze'), POWERUP_ART.freeze.color);
  // the UI face is the shipped "DojoUI" first, then the old system rounded sans stack (restyle round: docs/typography.md)
  assert.equal(fontString('body'), `600 34px ${'"DojoUI", ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'}`);
});

test('every fruit paints (whole and both halves at several angles) without forbidden properties', () => {
  for (const id of FRUIT_IDS) {
    const ctx = fresh();
    paintFruit(ctx, id, FRUIT_ART[id].r);
    assert.ok(ctx.counts.fill >= 3, `${id} fills`);
    assert.ok(ctx.calls.length > 20);
    for (const angle of [0, 0.7, 2.4, -1.9]) {
      for (const sign of [1, -1]) {
        const c = fresh();
        paintHalf(c, id, FRUIT_ART[id].r, 0.6, angle, sign);
        assert.equal(c.counts.clip >= 3, true, 'half-plane, strip and edge clips');
        assert.deepEqual(c.forbidden, []);
        assert.equal(c.stack.length, 0, 'save/restore balanced');
      }
    }
    assert.deepEqual(ctx.forbidden, []);
    assert.equal(ctx.stack.length, 0);
  }
});

test('golden apple, bomb, medallions, life apples, splats, vignette and the brush band paint', () => {
  const list = [
    (c) => paintGolden(c, 64), (c) => paintBomb(c, 64), (c) => paintLifeApple(c, 34, true), (c) => paintLifeApple(c, 34, false),
    (c) => paintSplat(c, '#E8455A', 0, false), (c) => paintSplat(c, '#14141C', 2, true), (c) => paintVignette(c, 384, 216, '#7FD1F0'),
    (c) => paintBrushBand(c, 1180, 170), (c) => paintPaperGrain(c, 512), (c) => paintHalf(c, 'golden', 64, 0, 0.5, 1),
    ...Object.keys(POWERUP_ART).map((id) => (c) => paintMedallion(c, id, 62)),
  ];
  for (const paint of list) {
    const ctx = fresh();
    paint(ctx);
    assert.ok(ctx.calls.length > 0);
    assert.deepEqual(ctx.forbidden, []);
  }
  assert.throws(() => paintFruit(fresh(), 'banana', 50), /unknown fruit/);
  assert.throws(() => paintMedallion(fresh(), 'nope'), /unknown power-up/);
});

test('the background paints all six layers (gradient, sun, mountains, bamboo, paper grain multiply, vignette)', () => {
  const ctx = fresh();
  const tiles = [];
  paintBackground(ctx, 1920, 1080, 56, (w, h) => { const c = new FakeCanvas(w, h); tiles.push(c); return c; });
  assert.equal(tiles.length, 1, 'one 512 x 512 grain tile');
  assert.ok(ctx.counts.arc >= 3, 'sun and its two rings');
  assert.ok(ctx.counts.lineTo > 700, 'three ridgelines sampled every 8 px');
  assert.ok(ctx.counts.fillRect >= 8 + 3, 'eight bamboo stalks, base and vignette rectangles');
  assert.deepEqual(ctx.forbidden, []);
  assert.equal(ctx.globalCompositeOperation, 'source-over', 'multiply is restored');
});

test('painters are deterministic (no Math.random): identical call logs on two runs', () => {
  const original = Math.random;
  Math.random = () => { throw new Error('painters must not use Math.random'); };
  try {
    for (const id of ['kiwi', 'strawberry', 'watermelon']) {
      const a = fresh();
      const b = fresh();
      paintFruit(a, id, FRUIT_ART[id].r);
      paintFruit(b, id, FRUIT_ART[id].r);
      assert.deepEqual(a.calls, b.calls);
    }
    const s1 = fresh();
    const s2 = fresh();
    paintSplat(s1, '#7BC043', 1, false);
    paintSplat(s2, '#7BC043', 1, false);
    assert.deepEqual(s1.calls, s2.calls);
    const g1 = fresh();
    const g2 = fresh();
    paintBackground(g1, 1920, 1080, 56, (w, h) => new FakeCanvas(w, h));
    paintBackground(g2, 1920, 1080, 56, (w, h) => new FakeCanvas(w, h));
    assert.equal(g1.calls.length, g2.calls.length);
  } finally {
    Math.random = original;
  }
});

test('bodyPath: the silhouette grows and shrinks with the outline offset (circle radius r + g)', () => {
  const grown = fresh();
  bodyPath(grown, 'apple', 68, 2.5);
  const shrunk = fresh();
  bodyPath(shrunk, 'apple', 68, -2.5);
  assert.equal(grown.calls.find((c) => c[0] === 'arc')[3], 70.5);
  assert.equal(shrunk.calls.find((c) => c[0] === 'arc')[3], 65.5);
  // compound shapes are unions of same-winding subpaths (pear: two circles and a hull, strawberry: circle and triangle)
  const pear = fresh();
  bodyPath(pear, 'pear', 66, 0);
  assert.equal(pear.counts.arc, 2);
  assert.ok(pear.counts.lineTo >= 3);
});
