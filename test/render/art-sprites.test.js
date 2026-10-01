// The sprite path of sprites.js with stub art (docs/assets-integration.md 3.1 to 3.5): scale from the manifest, halves, splashes, refresh,
// per-object fallback, no work after the bake. Stub images and fake canvases only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSprites, extentFor, artIdsFor, ART_TYPES, BOMB_RIM_PX } from '../../public/js/render/sprites.js';
import { BOMB_ART, FRUIT_ART, GOLDEN_ART, JUICE_COLORS, POWERUP_ART } from '../../public/js/render/palette.js';
import { NULL_ASSETS } from '../../public/js/render/assets.js';
import { createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { GAMEPLAY_ART_IDS, createArtStub, seedMeta } from '../../test-support/render/art-stub.js';
import { cutEvent, makeHalf } from '../../test-support/ui/fixtures.js';

const D = 2;
const mk = (stubOpts = {}, spriteOpts = {}) => {
  const f = createFakeCanvasFactory();
  const assets = createArtStub({ createCanvas: f.createCanvas, ...stubOpts });
  const sprites = createSprites({ createCanvas: f.createCanvas, density: D, assets, ...spriteOpts });
  return { f, assets, sprites };
};
const R = (type) => (type === 'golden' ? GOLDEN_ART.r : FRUIT_ART[type].r);
const reachOf = (box, a) => Math.max(a.x - box.x, box.x + box.w - a.x, a.y - box.y, box.y + box.h - a.y);

/** What was drawn into a baked entry: the transform, the source id and the smoothing quality. */
function bakedInfo(entry) {
  const calls = entry.canvas.ctx.calls;
  const st = calls.find((c) => c[0] === 'setTransform');
  const di = calls.find((c) => c[0] === 'drawImage');
  return { k: st[1], tx: st[5], ty: st[6], id: di[1].id, quality: entry.canvas.ctx.imageSmoothingQuality };
}

test('WHOLE FRUIT: every fruit and the Golden Apple bake from art with scale R / body.r and the body centre on the canvas centre', () => {
  const { sprites, assets } = mk();
  for (const type of ART_TYPES) {
    const e = type === 'golden' ? sprites.golden() : sprites.fruit(type);
    const m = assets.meta(`fruit_${type}_whole`);
    const s = R(type) / m.body.r;
    const E = Math.ceil(reachOf(m.contentBox, m.anchor) * s) + 2;
    assert.equal(e.art, true, `${type} is art`);
    assert.equal(e.half, E, `${type}: half extent from the contentBox and the anchor`);
    assert.equal(e.size, 2 * E);
    assert.equal(e.density, D);
    assert.equal(e.canvas.width, Math.ceil(2 * E * D));
    const b = bakedInfo(e);
    assert.equal(b.id, `fruit_${type}_whole`);
    assert.ok(Math.abs(b.k - D * s) < 1e-9, `${type}: k = d * R / body.r`);
    assert.ok(Math.abs(b.tx + b.k * m.anchor.x - D * E) < 1e-9 && Math.abs(b.ty + b.k * m.anchor.y - D * E) < 1e-9, `${type}: the anchor lands on the canvas centre`);
    assert.equal(b.quality, 'high');
    // the visible body circle equals the collision radius
    assert.ok(Math.abs((b.k / D) * m.body.r - R(type)) < 1e-9);
    // nothing of the content is clipped (stems, crowns, the golden glow)
    const { x, y, w, h } = m.contentBox;
    assert.ok(b.tx + b.k * x >= 0 && b.ty + b.k * y >= 0, `${type}: top-left inside`);
    assert.ok(b.tx + b.k * (x + w) <= e.canvas.width && b.ty + b.k * (y + h) <= e.canvas.height, `${type}: bottom-right inside`);
  }
});

test('the Golden Apple is not clipped: the canvas covers the glow ring, which reaches about 1.45 body radii', () => {
  const { sprites, assets } = mk();
  const g = sprites.golden();
  const m = assets.meta('fruit_golden_whole');
  const s = GOLDEN_ART.r / m.body.r;
  assert.ok(g.half >= reachOf(m.contentBox, m.anchor) * s, 'covers the far corner of the contentBox');
  assert.ok(g.half > GOLDEN_ART.r * 1.4, `glow of ${Math.round(GOLDEN_ART.r * 1.45)} px fits in ${g.half}`);
  assert.equal(sprites.golden(), g, 'cached');
});

test('the bomb: art with its fuse tip in logical px relative to the body centre; the painted bomb has fuseTip null', () => {
  const { sprites, assets } = mk();
  const b = sprites.bomb();
  const m = assets.meta('bomb_whole');
  const s = BOMB_ART.r / m.body.r;
  assert.equal(b.art, true);
  assert.ok(Math.abs(b.fuseTip.x - (m.points.fuseTip.x - m.anchor.x) * s) < 1e-9);
  assert.ok(Math.abs(b.fuseTip.y - (m.points.fuseTip.y - m.anchor.y) * s) < 1e-9);
  assert.ok(b.fuseTip.y < 0 && Math.hypot(b.fuseTip.x, b.fuseTip.y) < b.half, 'up and inside the sprite');
  assert.equal(b.half, Math.ceil(reachOf(m.contentBox, m.anchor) * s) + 2 + BOMB_RIM_PX, 'the canvas also holds the light rim around the bomb (art review round 1, M2)');
  assert.equal(b.rim, BOMB_RIM_PX);
  const painted = createSprites({ createCanvas: createFakeCanvasFactory().createCanvas, density: D }).bomb();
  assert.equal(painted.fuseTip, null);
  assert.equal(painted.art, undefined);
});

test('medallions: art at 62 / 212 with the body centre on the canvas centre, one entry per power-up', () => {
  const { sprites, assets } = mk();
  for (const id of Object.keys(POWERUP_ART)) {
    const e = sprites.medallion(id);
    const m = assets.meta(`medallion_${id}`);
    const b = bakedInfo(e);
    assert.equal(e.art, true);
    assert.equal(b.id, `medallion_${id}`);
    assert.ok(Math.abs(b.k / D - POWERUP_ART[id].r / m.body.r) < 1e-9);
    assert.equal(sprites.medallion(id), e);
  }
});

test('life icons: the contentBox is fitted into 76 x 76 and centred on the same 88 x 88 canvas as the painted apple', () => {
  const { sprites, assets } = mk();
  for (const full of [true, false]) {
    const e = sprites.lifeApple(full);
    const m = assets.meta(full ? 'icon_life_full' : 'icon_life_empty');
    const b = bakedInfo(e);
    assert.equal(e.art, true);
    assert.equal(e.half, 44);
    assert.equal(e.size, 88);
    assert.equal(b.id, full ? 'icon_life_full' : 'icon_life_empty');
    assert.ok(Math.abs(b.k / D - Math.min(76 / m.contentBox.w, 76 / m.contentBox.h)) < 1e-9);
    const cx = m.contentBox.x + m.contentBox.w / 2;
    assert.ok(Math.abs(b.tx + b.k * cx - D * 44) < 1e-9, 'the box centre is on the canvas centre');
  }
  assert.notEqual(sprites.lifeApple(true), sprites.lifeApple(false));
});

test('splashes: one 320 x 320 stain per juice colour (contentBox fitted into 288), shared by the three variants; the soot stays painted', () => {
  const { sprites, assets } = mk();
  for (const type of ART_TYPES) {
    const juice = artIdsFor(type).juice;
    const a = sprites.splat(juice, 0);
    assert.equal(a.art, true, `${type}: art`);
    assert.equal(a.canvas.width, 320);
    assert.equal(a.canvas.height, 320);
    assert.equal(a.density, 1);
    assert.equal(sprites.splat(juice, 1), a);
    assert.equal(sprites.splat(juice, 5), a, 'variant wraps and shares');
    const m = assets.meta(`fx_splash_${type}`);
    const b = bakedInfo(a);
    assert.ok(Math.abs(b.k - Math.min(288 / m.contentBox.w, 288 / m.contentBox.h)) < 1e-9);
    assert.ok(Math.abs(b.tx + b.k * (m.contentBox.x + m.contentBox.w / 2) - 160) < 1e-9, 'centred on the canvas centre');
  }
  assert.equal(new Set(JUICE_COLORS.map((c) => sprites.splat(c, 0))).size, JUICE_COLORS.length, 'eleven different stains');
  const soot = sprites.splat('#14141C', 0, true);
  assert.equal(soot.art, undefined);
  assert.equal(soot.canvas.width, 256, 'the bomb soot is the painted 256 px blob');
  const unknown = sprites.splat('#123456', 0);
  assert.equal(unknown.canvas.width, 256, 'a colour that belongs to no fruit stays painted');
});

test('the juice colour of every fruit maps to its own splash (eleven distinct colours)', () => {
  assert.equal(new Set(ART_TYPES.map((t) => artIdsFor(t).juice)).size, ART_TYPES.length);
  assert.equal(artIdsFor('apple').splash, 'fx_splash_apple');
  assert.equal(artIdsFor('banana'), null);
});

test('HALVES SHARE THE WHOLE\'S SCALE: scale of the whole times halfScale (1, golden 0.91), pivot = the half\'s own anchor', () => {
  const { sprites, assets } = mk();
  for (const type of ART_TYPES) {
    const whole = bakedInfo(type === 'golden' ? sprites.golden() : sprites.fruit(type));
    for (const [side, suffix] of [[1, 'a'], [-1, 'b']]) {
      const h = sprites.halfArt(type, side);
      const hm = assets.meta(`fruit_${type}_half_${suffix}`);
      const b = bakedInfo(h);
      assert.equal(b.id, `fruit_${type}_half_${suffix}`, `${type}: side ${side} uses half_${suffix}`);
      assert.ok(Math.abs(b.k - whole.k * (type === 'golden' ? 0.91 : 1)) < 1e-9, `${type}: same scale as the whole${type === 'golden' ? ' times 0.91' : ''}`);
      assert.ok(Math.abs(b.tx + b.k * hm.anchor.x - D * h.half) < 1e-9, `${type}: the half's anchor is on the canvas centre`);
      assert.equal(h.half, Math.ceil(reachOf(hm.contentBox, hm.anchor) * (b.k / D)) + 2);
      assert.equal(h.rot0, 0);
      assert.equal(h.shared, true);
      assert.equal(h.art, true);
    }
    assert.notEqual(sprites.halfArt(type, 1).canvas, sprites.halfArt(type, -1).canvas, 'two sides, two bitmaps');
    assert.equal(sprites.halfArt(type, 1), sprites.halfArt(type, 1), 'baked once per type and side');
  }
});

test('ensureHalf with art: a small wrapper of the shared half (rot0 0, shared), 22 canvases for any number of cuts, no painting', () => {
  const { sprites, f } = mk();
  sprites.warmUp();
  const before = f.created.length;
  const rasterised = sprites.stats.halvesRasterised;
  for (let i = 0; i < 50; i++) {
    const ids = [3000000 + i * 2, 3000001 + i * 2];
    sprites.registerCut(cutEvent({ halfIds: ids, objType: 'apple', r: 68 }), 0.4);
    sprites.beginHalfFrame();
    const a = sprites.ensureHalf(makeHalf({ id: ids[0], side: 1, parentType: 'apple', r: 68, rot: 0.7 }));
    const b = sprites.ensureHalf(makeHalf({ id: ids[1], side: -1, parentType: 'apple', r: 68, rot: 0.7 }));
    assert.equal(a.rot0, 0, 'drawn upright then rotated by the real half.rot');
    assert.equal(a.shared, true);
    assert.equal(a.canvas, sprites.halfArt('apple', 1).canvas, 'side +1 is half_a');
    assert.equal(b.canvas, sprites.halfArt('apple', -1).canvas, 'side -1 is half_b');
    assert.equal(a.size, sprites.halfArt('apple', 1).size);
    assert.notEqual(a, b);
    sprites.pruneHalves();
  }
  assert.equal(f.created.length, before, 'no canvas at all for fifty cuts');
  assert.equal(sprites.stats.halvesRasterised, rasterised, 'nothing was rasterised per cut');
  assert.equal(sprites.stats.artHalfWrappers, 100);
});

test('pruneHalves never recycles a shared art canvas into the painted-half free list', () => {
  const { sprites, assets } = mk();
  sprites.warmUp();
  const shared = sprites.halfArt('apple', 1);
  const cut = makeHalf({ id: 4000001, side: 1, parentType: 'apple', r: 68 });
  sprites.beginHalfFrame();
  sprites.ensureHalf(cut);
  sprites.beginHalfFrame();
  sprites.pruneHalves(); // the half is gone
  assert.equal(sprites.halfSprites.size, 0);
  // pear loses its art; a painted pear half now takes a canvas from the free list or allocates: it must never be the shared apple one
  assets.remove(['fruit_pear_half_a', 'fruit_pear_half_b']);
  sprites.beginHalfFrame();
  const painted = sprites.ensureHalf(makeHalf({ id: 4000002, side: 1, parentType: 'pear', r: 66 }));
  assert.notEqual(painted.canvas, shared.canvas);
  assert.equal(painted.shared, undefined);
  assert.equal(painted.rot0, 0.3, 'a painted half keeps its rot0 (the rotation when first seen)');
  assert.equal(sprites.stats.halvesRasterised, 1);
});

test('a half whose radius is not the catalogue one keeps the painted half (defensive: the game never makes one)', () => {
  const { sprites } = mk();
  sprites.beginHalfFrame();
  const e = sprites.ensureHalf(makeHalf({ id: 5000001, side: 1, parentType: 'apple', r: 40 }));
  assert.equal(e.shared, undefined);
  assert.equal(sprites.stats.halvesRasterised, 1);
});

test('PER-OBJECT FALLBACK: one missing id turns only that object painted, the rest stay art', () => {
  const ids = GAMEPLAY_ART_IDS.filter((id) => id !== 'fruit_apple_whole' && id !== 'bomb_whole' && id !== 'medallion_clock');
  const { sprites } = mk({ ids });
  assert.equal(sprites.fruit('apple').art, undefined, 'apple is painted');
  assert.equal(sprites.fruit('orange').art, true, 'orange is art');
  assert.equal(sprites.bomb().art, undefined);
  assert.equal(sprites.bomb().fuseTip, null);
  assert.equal(sprites.medallion('clock').art, undefined);
  assert.equal(sprites.medallion('freeze').art, true);
  assert.equal(sprites.halfArt('apple', 1), null, 'no whole, no art halves');
  assert.equal(sprites.halfArt('orange', 1).art, true);
  sprites.beginHalfFrame();
  const painted = sprites.ensureHalf(makeHalf({ id: 6000001, side: 1, parentType: 'apple', r: 68 }));
  assert.equal(painted.shared, undefined, 'the apple half is painted');
  const art = sprites.ensureHalf(makeHalf({ id: 6000002, side: 1, parentType: 'orange', r: 68 }));
  assert.equal(art.shared, true);
  assert.equal(sprites.splat(artIdsFor('apple').juice, 0).canvas.width, 320, 'the apple splash id is still there');
});

test('a fruit whose halves are incomplete (one half missing) paints both halves: no mixed pair', () => {
  const { sprites } = mk({ ids: GAMEPLAY_ART_IDS.filter((id) => id !== 'fruit_kiwi_half_b') });
  assert.equal(sprites.halfArt('kiwi', 1), null);
  assert.equal(sprites.halfArt('kiwi', -1), null);
  assert.equal(sprites.menuHalf('kiwi', 1, 1.9, 2), null);
  assert.equal(sprites.fruit('kiwi').art, true, 'the whole kiwi is still art');
});

test('no assets, NULL_ASSETS and an empty stub give the same sprites as before: nothing is art, nothing throws', () => {
  for (const assets of [undefined, null, NULL_ASSETS, createArtStub({ ids: [] })]) {
    const f = createFakeCanvasFactory();
    const sprites = createSprites({ createCanvas: f.createCanvas, density: D, assets });
    sprites.warmUp();
    const expected = 10 + 2 + 1 + 4 + 2 + JUICE_COLORS.length * 3 + 3 + 1 + 4; // + rays, puff, two edge streaks (restyle effects)
    assert.equal(sprites.stats.created, expected);
    assert.equal(f.created.length, expected);
    assert.equal(sprites.stats.artBaked, 0);
    for (const t of Object.keys(FRUIT_ART)) assert.equal(sprites.fruit(t).art, undefined);
    assert.equal(sprites.halfArt('apple', 1), null);
    assert.equal(sprites.menuHalf('apple', 1, 1.9, 2), null);
    assert.equal(sprites.fruit('apple').half, extentFor('apple', 68));
  }
});

test('malformed art means painted, never an exception: no meta, no body, no contentBox, a throwing image', () => {
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const { sprites, assets } = mk({ noMeta: ['fruit_apple_whole'], meta: { fruit_pear_whole: { body: null }, fruit_peach_whole: { contentBox: { x: 0, y: 0, w: 0, h: 10 } }, fruit_lemon_whole: { body: { cx: 1, cy: 1, r: 0 } } } });
    assets.throwOn.add('fruit_kiwi_whole');
    for (const t of ['apple', 'pear', 'peach', 'lemon', 'kiwi']) assert.equal(sprites.fruit(t).art, undefined, `${t} is painted`);
    assert.equal(sprites.fruit('orange').art, true);
    assert.equal(sprites.stats.artFailures, 1, 'only the throwing image counts as a failure');
    assert.equal(warned, 1, 'one console.warn, never one per object');
    assert.equal(sprites.fruit('kiwi'), sprites.fruit('kiwi'), 'the painted fallback is cached: no retry per frame');
  } finally {
    console.warn = warn;
  }
});

test('an anchor missing from the manifest falls back to the contentBox centre', () => {
  const { sprites, assets } = mk({ meta: { fruit_apple_half_a: { anchor: undefined } } });
  const m = assets.meta('fruit_apple_half_a');
  assert.equal(m.anchor, undefined);
  const h = sprites.halfArt('apple', 1);
  const b = bakedInfo(h);
  assert.ok(Math.abs(b.tx + b.k * (m.contentBox.x + m.contentBox.w / 2) - D * h.half) < 1e-9);
});

test('REFRESH: art that arrives after the first (painted) sprites replaces them, on the group event, and warmUp is re-run', () => {
  const { sprites, assets, f } = mk({ ids: [] });
  sprites.warmUp();
  const painted = sprites.fruit('apple');
  const paintedBomb = sprites.bomb();
  assert.equal(painted.art, undefined);
  assert.equal(sprites.halfArt('apple', 1), null);
  const before = f.created.length;
  assets.add(GAMEPLAY_ART_IDS); // group event + generation
  assert.ok(f.created.length > before, 'the warm-up ran again from the refresh: the art was baked before the first cut');
  const art = sprites.fruit('apple');
  assert.notEqual(art, painted);
  assert.equal(art.art, true);
  assert.equal(sprites.bomb().art, true);
  assert.equal(sprites.bomb().fuseTip !== null, true);
  assert.notEqual(sprites.bomb(), paintedBomb);
  assert.equal(sprites.halfArt('apple', 1).art, true);
  assert.equal(sprites.splat(artIdsFor('apple').juice, 0).art, true);
  const settled = f.created.length;
  sprites.warmUp();
  assert.equal(f.created.length, settled, 'warmUp is idempotent');
});

test('REFRESH: a release drops the art entries and the painted versions come back; a later load bakes art again', () => {
  const { sprites, assets } = mk();
  sprites.warmUp();
  const art = sprites.fruit('orange');
  assert.equal(art.art, true);
  assets.remove(['fruit_orange_whole', 'fruit_orange_half_a', 'fruit_orange_half_b', 'fx_splash_orange']);
  const painted = sprites.fruit('orange');
  assert.equal(painted.art, undefined);
  assert.equal(sprites.halfArt('orange', 1), null);
  assert.equal(sprites.fruit('apple').art, true, 'other fruit are untouched');
  assets.add(['fruit_orange_whole', 'fruit_orange_half_a', 'fruit_orange_half_b', 'fx_splash_orange']);
  assert.equal(sprites.fruit('orange').art, true);
});

test('REFRESH without an event: a bump of assets.generation alone is noticed by the next accessor call', () => {
  const { sprites, assets } = mk({ ids: [] });
  assert.equal(sprites.fruit('pear').art, undefined);
  assets.addQuietly(GAMEPLAY_ART_IDS);
  assert.equal(sprites.fruit('pear').art, true);
});

test('REFRESH only drops what changed: a stage layer finishing (a generation bump for other ids) rebakes nothing', () => {
  const { sprites, assets, f } = mk();
  sprites.warmUp();
  const apple = sprites.fruit('apple');
  const created = f.created.length;
  assets.add(['bg_classic_far', 'bg_classic_mid']); // ids the sprites do not use
  assets.remove(['bg_classic_far']);
  assert.equal(sprites.fruit('apple'), apple);
  assert.equal(f.created.length, created);
});

test('refresh() is public, returns whether something changed, and dispose() unsubscribes from the loader', () => {
  const { sprites, assets } = mk({ ids: [] });
  assert.equal(assets.listenerCount('group'), 1);
  assert.equal(assets.listenerCount('release'), 1);
  assert.equal(sprites.refresh(), false);
  assets.addQuietly(['fruit_apple_whole']);
  assert.equal(sprites.refresh(), true);
  assert.equal(sprites.refresh(), false);
  sprites.dispose();
  assert.equal(assets.listenerCount('group'), 0);
  assert.equal(assets.listenerCount('release'), 0);
});

test('MENU FRUIT with art: baked at s * scale for the menu density, one per fruit, released with releaseMenu', () => {
  const { sprites, assets, f } = mk();
  const a = sprites.menuFruit('watermelon', 1.9, 2);
  const m = assets.meta('fruit_watermelon_whole');
  const s = (R('watermelon') / m.body.r) * 1.9;
  assert.equal(a.art, true);
  assert.equal(a.half, Math.ceil(reachOf(m.contentBox, m.anchor) * s) + 2);
  assert.ok(Math.abs(bakedInfo(a).k - 2 * s) < 1e-9);
  const n = f.created.length;
  assert.equal(sprites.menuFruit('watermelon', 1.9, 2), a, 'the same object every frame');
  assert.equal(f.created.length, n);
  const b = sprites.menuFruit('watermelon', 1.9, 1.5);
  assert.notEqual(b, a);
  assert.equal(b.density, 1.5);
  assert.equal(sprites.menuFruit('watermelon', 1.9, 1.5), b, 'the old density was released, the new one is cached');
  sprites.releaseMenu();
  assert.notEqual(sprites.menuFruit('watermelon', 1.9, 1.5), b, 'recreated after release');
});

test('MENU HALVES: menuHalf gives the shared half at menu scale, or null so that the screen keeps calling paintHalf', () => {
  const { sprites, assets } = mk();
  const a = sprites.menuHalf('orange', 1, 1.9, 2);
  const b = sprites.menuHalf('orange', -1, 1.9, 2);
  assert.equal(bakedInfo(a).id, 'fruit_orange_half_a');
  assert.equal(bakedInfo(b).id, 'fruit_orange_half_b');
  const whole = (R('orange') / assets.meta('fruit_orange_whole').body.r) * 1.9;
  assert.ok(Math.abs(bakedInfo(a).k - 2 * whole) < 1e-9, 'halves at the whole\'s menu scale');
  assert.equal(sprites.menuHalf('orange', 1, 1.9, 2), a);
  assert.notEqual(sprites.menuHalf('orange', 1, 2.6, 2), a, 'another scale is another bitmap');
  sprites.releaseMenu();
  assert.notEqual(sprites.menuHalf('orange', 1, 2.6, 2), null);
  assert.equal(mk({ ids: [] }).sprites.menuHalf('orange', 1, 1.9, 2), null);
});

test('AFTER THE BAKE NOTHING IS ASKED FROM THE LOADER: repeated accessor calls make no assets.get / meta / has / scaled call and no canvas', () => {
  const { sprites, assets, f } = mk();
  sprites.warmUp();
  sprites.menuFruit('apple', 1.9, 2);
  sprites.menuHalf('apple', 1, 1.9, 2);
  const calls = { ...assets.calls };
  const canvases = f.created.length;
  const created = sprites.stats.created;
  for (let i = 0; i < 500; i++) {
    for (const t of Object.keys(FRUIT_ART)) sprites.fruit(t);
    sprites.golden();
    sprites.bomb();
    for (const id of Object.keys(POWERUP_ART)) sprites.medallion(id);
    sprites.lifeApple(true);
    sprites.lifeApple(false);
    sprites.halfArt('apple', 1);
    sprites.halfArt('golden', -1);
    sprites.menuFruit('apple', 1.9, 2);
    sprites.menuHalf('apple', 1, 1.9, 2);
  }
  assert.deepEqual(assets.calls, calls);
  assert.equal(f.created.length, canvases);
  assert.equal(sprites.stats.created, created);
});

test('releaseMenu with nothing to release is free: it is called every frame outside the menu', () => {
  const { sprites, f } = mk();
  sprites.warmUp();
  const n = f.created.length;
  for (let i = 0; i < 100; i++) sprites.releaseMenu();
  assert.equal(f.created.length, n);
  assert.equal(sprites.fruit('apple').art, true, 'the regular sprites are not menu sprites and survive');
});

test('a source that shrinks by more than 2x is halved in steps first (density 1: the smallest fruit scale is about 0.32)', () => {
  const { sprites, f } = mk({}, { density: 1 });
  const before = f.created.length;
  const k = sprites.fruit('kiwi');
  const made = f.created.slice(before);
  assert.ok(made.length >= 2, `an intermediate canvas was used: ${made.length} canvases`);
  assert.equal(made[0], k.canvas, 'the entry canvas is created first, the halving canvases after it');
  const di = k.canvas.ctx.calls.find((c) => c[0] === 'drawImage');
  assert.equal(di[1].isFakeCanvas, true, 'the final draw comes from the halved canvas, not the 512 px image');
  assert.equal(di[1].width, 256);
  assert.equal(made[1].ctx.calls.find((c) => c[0] === 'drawImage')[1].id, 'fruit_kiwi_whole', 'the first step reads the 512 px image');
  const st = k.canvas.ctx.calls.find((c) => c[0] === 'setTransform');
  assert.ok(st[1] >= 0.5, `the last step shrinks by less than 2x (k ${st[1]})`);
  // at density 2 the same fruit is a single one-shot draw (k about 0.63)
  const two = mk();
  const b2 = two.f.created.length;
  two.sprites.fruit('kiwi');
  assert.equal(two.f.created.length - b2, 1);
});

test('clear() empties the art caches too; the next accessor bakes again', () => {
  const { sprites, f } = mk();
  sprites.warmUp();
  const a = sprites.fruit('apple');
  sprites.clear();
  const n = f.created.length;
  const b = sprites.fruit('apple');
  assert.notEqual(a, b);
  assert.equal(b.art, true);
  assert.equal(f.created.length, n + 1);
  assert.equal(sprites.halfArt('apple', 1).art, true);
});

test('seed manifest sanity: every fruit id used by the sprites exists in the stub', () => {
  const m = seedMeta();
  for (const type of ART_TYPES) {
    const row = artIdsFor(type);
    for (const id of [row.whole, row.halfA, row.halfB, row.splash]) assert.ok(m[id], id);
  }
});

// ---- the real manifest (public/assets/manifest.json, written by tools/build-assets.mjs); skipped, not passed, when it is absent ----
const MANIFEST_PATH = fileURLToPath(new URL('../../public/assets/manifest.json', import.meta.url));
const HAS_MANIFEST = existsSync(MANIFEST_PATH);

test('REAL MANIFEST: every sprite bakes from the shipped numbers, inside a sane canvas, with the body circle at the game radius', { skip: !HAS_MANIFEST && 'public/assets/manifest.json is absent' }, () => {
  const man = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  const { sprites, assets, f } = mk({ manifest: man.assets });
  sprites.warmUp();
  assert.equal(sprites.stats.artFailures, 0);
  for (const type of ART_TYPES) {
    const e = type === 'golden' ? sprites.golden() : sprites.fruit(type);
    const m = assets.meta(`fruit_${type}_whole`);
    assert.equal(e.art, true, type);
    assert.ok(e.half >= R(type) && e.half <= R(type) * 3.2, `${type}: half extent ${e.half} for a radius of ${R(type)}`);
    assert.ok(Math.abs(bakedInfo(e).k / D * m.body.r - R(type)) < 1e-9, `${type}: the body circle is the collision radius`);
    const h = sprites.halfArt(type, 1);
    const hm = assets.meta(`fruit_${type}_half_a`);
    assert.ok(Math.abs(bakedInfo(h).k / bakedInfo(e).k - (hm.halfScale ?? 1)) < 1e-9, `${type}: the half shares the whole's scale times halfScale`);
    assert.ok(h.half <= R(type) * 1.8, `${type}: a half is about as big as the whole body (${h.half})`);
    assert.equal(sprites.splat(artIdsFor(type).juice, 0).art, true);
  }
  const golden = sprites.golden();
  assert.ok(golden.half >= 92, 'the golden glow (about 93 px) fits');
  const bomb = sprites.bomb();
  assert.ok(bomb.fuseTip.x > 0 && bomb.fuseTip.y < -R('cherry'), 'the fuse tip is up and to the right of the body');
  // memory guard: every baked canvas of the warm-up (painted stains and the background excluded) stays well under the 64 MB budget of the scaled cache
  let bytes = 0;
  for (const c of f.created) bytes += c.width * c.height * 4;
  assert.ok(bytes < 40 * 1024 * 1024, `warm-up canvases: ${(bytes / 1048576).toFixed(1)} MB`);
});

test('a malformed loader never crashes the game: an object without the loader members counts as "no art", a loader whose has() throws switches the art off with one warning', () => {
  // no members at all
  const f = createFakeCanvasFactory();
  const bogus = createSprites({ createCanvas: f.createCanvas, density: D, assets: { hello: 1 } });
  assert.equal(bogus.fruit('apple').art, undefined);
  assert.equal(bogus.halfArt('apple', 1), null);
  bogus.warmUp();
  assert.equal(bogus.stats.artBaked, 0);
  // a loader that throws when asked what is available
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const g = createFakeCanvasFactory();
    const assets = createArtStub({ createCanvas: g.createCanvas });
    const sprites = createSprites({ createCanvas: g.createCanvas, density: D, assets });
    assert.equal(sprites.fruit('apple').art, true);
    const original = assets.has;
    assets.has = () => { throw new Error('loader broke'); };
    assets.addQuietly([]); // generation moves: the next accessor asks has() and it throws
    assert.equal(sprites.fruit('apple').art, undefined, 'painted from now on');
    assert.equal(sprites.golden().art, undefined);
    assert.equal(sprites.bomb().art, undefined);
    assert.equal(sprites.halfArt('apple', 1), null);
    assert.equal(sprites.menuFruit('apple', 1.9, 2).art, undefined);
    assert.equal(warned, 1);
    assert.equal(sprites.stats.artFailures, 1);
    assets.has = original;
    assets.add(GAMEPLAY_ART_IDS);
    assert.equal(sprites.fruit('pear').art, undefined, 'a loader that broke once is not trusted again this session');
  } finally {
    console.warn = warn;
  }
});
