// Sprite cache: sprites are rasterised once; half sprites once per cut, recycled through a free list (docs/architecture.md 8.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_MARGIN, createSprites, extentFor } from '../../public/js/render/sprites.js';
import { FRUIT_ART, JUICE_COLORS } from '../../public/js/render/palette.js';
import { createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { cutEvent, makeHalf } from '../../test-support/ui/fixtures.js';

const mk = () => {
  const f = createFakeCanvasFactory();
  return { f, sprites: createSprites({ createCanvas: f.createCanvas, density: 2 }) };
};

test('extentFor covers decorations: cherry stem and pineapple crown reach higher than the body radius', () => {
  assert.ok(extentFor('cherry', 48) > 48 * 2);
  assert.ok(extentFor('pineapple', 82) > 82 * 1.5);
  assert.ok(extentFor('golden', 64) >= 64 * 1.7, 'glow ring at 1.5 r fits');
  assert.ok(extentFor('bomb', 64) >= 64 * 1.7, 'fuse fits');
  assert.ok(extentFor('watermelon', 92) > 92 + 5);
});

test('fruit sprites are created once and cached (2x density)', () => {
  const { sprites, f } = mk();
  const a = sprites.fruit('apple');
  const before = f.created.length;
  assert.equal(sprites.fruit('apple'), a);
  assert.equal(f.created.length, before, 'no new canvas on the second request');
  assert.equal(a.canvas.width, Math.ceil(a.size * 2));
  assert.equal(a.half * 2, a.size);
  assert.throws(() => sprites.fruit('banana'), /unknown fruit/);
});

test('warmUp creates every regular sprite: 10 fruit, golden (+ body without glow), bomb, 4 medallions, 2 life icons, splats, band, rays, smoke puff, 2 edge streaks', () => {
  const { sprites, f } = mk();
  sprites.warmUp();
  const n = 10 + 2 + 1 + 4 + 2 + JUICE_COLORS.length * 3 + 3 + 1 + 4; // + rays, puff, two edge streaks (restyle effects)
  assert.equal(sprites.stats.created, n);
  assert.equal(f.created.length, n);
  const again = f.created.length;
  sprites.warmUp();
  assert.equal(f.created.length, again, 'nothing is recreated');
});

test('splat sprites: 256 x 256, three variants per colour, soot variant', () => {
  const { sprites } = mk();
  const a = sprites.splat('#E8455A', 0);
  assert.equal(a.canvas.width, 256);
  assert.equal(a.canvas.height, 256);
  assert.notEqual(sprites.splat('#E8455A', 1), a);
  assert.equal(sprites.splat('#E8455A', 3), a, 'variant wraps modulo 3');
  assert.notEqual(sprites.splat('#14141C', 0, true), a);
});

test('background: painted once per density step (1, 1.5, 2), the old one is released, overscan margin present', () => {
  const { sprites } = mk();
  const bg = sprites.background(1);
  assert.equal(bg.density, 1);
  assert.equal(bg.margin, BACKGROUND_MARGIN);
  assert.equal(bg.canvas.width, 1920 + 2 * BACKGROUND_MARGIN);
  assert.equal(sprites.background(1), bg);
  const hi = sprites.background(1.4);
  assert.equal(hi.density, 1.5);
  assert.equal(sprites.background(2.9).density, 2, 'never above 2x');
  assert.equal(sprites.background(0.4).density, 1, 'never below 1x');
});

test('HALF SPRITES: rasterised once per cut, keyed by GameHalf id, drawn every frame without repainting', () => {
  const { sprites } = mk();
  const ev = cutEvent({ halfIds: [1000001, 1000002], objType: 'watermelon', r: 92 });
  sprites.registerCut(ev, 0.4);
  const a = makeHalf({ id: 1000001, side: 1, parentType: 'watermelon', r: 92, rot: 0.9 });
  const b = makeHalf({ id: 1000002, side: -1, parentType: 'watermelon', r: 92, rot: 0.9 });
  for (let frame = 0; frame < 120; frame++) {
    sprites.beginHalfFrame();
    sprites.ensureHalf(a);
    sprites.ensureHalf(b);
    sprites.pruneHalves();
  }
  assert.equal(sprites.stats.halvesRasterised, 2, 'two halves, each painted exactly once');
  assert.equal(sprites.halfSprites.get(1000001).rot0, 0.9, 'rot0 = rotation when first seen');
  // the two sides get different bitmaps
  assert.notEqual(sprites.halfSprites.get(1000001).canvas, sprites.halfSprites.get(1000002).canvas);
});

test('halves that leave the snapshot are released and their canvases are recycled', () => {
  const { sprites } = mk();
  const cut = (i) => {
    const ids = [2000000 + i * 2, 2000001 + i * 2];
    sprites.registerCut(cutEvent({ halfIds: ids, objType: 'apple', r: 68 }), 0);
    return ids.map((id, k) => makeHalf({ id, side: k === 0 ? 1 : -1, r: 68 }));
  };
  let halves = cut(0);
  sprites.beginHalfFrame();
  halves.forEach((h) => sprites.ensureHalf(h));
  sprites.pruneHalves();
  const allocated = sprites.stats.canvasesAllocated;
  for (let i = 1; i < 40; i++) {
    halves = cut(i);
    sprites.beginHalfFrame();
    halves.forEach((h) => sprites.ensureHalf(h));
    sprites.pruneHalves();
  }
  assert.equal(sprites.halfSprites.size, 2, 'only the current cut is alive');
  assert.ok(sprites.stats.canvasesAllocated - allocated <= 4, `canvases are recycled, allocated ${sprites.stats.canvasesAllocated - allocated} new ones for 39 cuts`);
  assert.equal(sprites.stats.halvesRasterised, 80);
});

test('menu fruit sprites are cached per density and released when the menu is left', () => {
  const { sprites, f } = mk();
  const a = sprites.menuFruit('watermelon', 1.9, 1.5);
  assert.equal(sprites.menuFruit('watermelon', 1.9, 1.5), a);
  const big = extentFor('watermelon', 92) * 1.9;
  assert.equal(a.half, big);
  assert.equal(a.canvas.width, Math.ceil(2 * big * 1.5));
  const before = f.created.length;
  const b = sprites.menuFruit('watermelon', 1.9, 2);
  assert.notEqual(b, a);
  assert.equal(f.created.length, before + 1);
  assert.equal(sprites.menuFruit('watermelon', 1.9, 2), b, 'the old density was released, the new one is cached');
  sprites.releaseMenu();
  assert.notEqual(sprites.menuFruit('watermelon', 1.9, 2), b, 'recreated after release');
  assert.throws(() => sprites.menuFruit('banana', 1, 1), /unknown fruit/);
});

test('a half without a registered cut still gets a sprite from its own fields (defensive)', () => {
  const { sprites } = mk();
  sprites.beginHalfFrame();
  const e = sprites.ensureHalf(makeHalf({ id: 77, parentType: 'golden', r: 64, cutAngleRad: 1 }));
  assert.ok(e.canvas);
  assert.equal(sprites.stats.halvesRasterised, 1);
});

test('vignette and band sprites are cached per colour', () => {
  const { sprites } = mk();
  assert.equal(sprites.vignette('#7FD1F0'), sprites.vignette('#7FD1F0'));
  assert.notEqual(sprites.vignette('#7FD1F0'), sprites.vignette('#F26A21'));
  assert.equal(sprites.band(), sprites.band());
  assert.ok(Object.keys(FRUIT_ART).every((id) => sprites.fruit(id).size > 2 * FRUIT_ART[id].r));
});
