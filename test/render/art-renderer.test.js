// The renderer with art (docs/assets-integration.md 3): sprite path, halves, warning icon, combo icon, bursts, draw order, per-piece
// fallback, late-loading art. Stub images and the fake 2D context only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOMB_ART } from '../../public/js/render/palette.js';
import { bombFuseTip } from '../../public/js/render/painters.js';
import { TAU } from '../../public/js/render/draw-util.js';
import { NULL_ASSETS } from '../../public/js/render/assets.js';
import { GAMEPLAY_ART_IDS, createArtStub } from '../../test-support/render/art-stub.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { busyScene, gameLayerCalls, plainScene } from '../../test-support/render/scenes.js';
import { artIdsFor } from '../../public/js/render/sprites.js';
import { bombEvent, makeBlade, makeHalf, makeObject, makeSnapshot, makeUiHarness, roundResult } from '../../test-support/ui/fixtures.js';

const without = (...ids) => createArtStub({ ids: GAMEPLAY_ART_IDS.filter((id) => !ids.includes(id)) });
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** Record the globalAlpha in force at every drawImage of the rig's context (parallel to ctx.calls filtered by drawImage). */
function trackAlpha(rig) {
  const alphas = [];
  const orig = rig.ctx.drawImage;
  rig.ctx.drawImage = (...a) => { alphas.push(rig.ctx.globalAlpha); orig(...a); };
  return alphas;
}

const drawImages = (calls) => calls.filter((c) => c[0] === 'drawImage');
const indexOfCanvas = (calls, canvas, from = 0) => calls.findIndex((c, i) => i >= from && c[0] === 'drawImage' && c[1] === canvas);

test('SPRITE PATH: every object is drawn from its art entry at lerp(previous, current, alpha) with the entry\'s own size', () => {
  const assets = createArtStub();
  const { rig, frame, snap } = busyScene({ assets });
  const calls = rig.draw(frame());
  for (const o of snap.objects) {
    const entry = o.kind === 'bomb' ? rig.sprites.bomb() : o.kind === 'golden' ? rig.sprites.golden() : o.kind === 'powerup' ? rig.sprites.medallion(o.type) : rig.sprites.fruit(o.type);
    assert.equal(entry.art, true, `${o.kind} ${o.type} is art`);
    const i = indexOfCanvas(calls, entry.canvas);
    assert.ok(i >= 0, `${o.kind} ${o.type} is drawn`);
    const di = calls[i];
    const x = (o.px + o.x) / 2;
    const y = (o.py + o.y) / 2;
    if (o.kind === 'powerup') {
      // medallions are not rotated: drawn straight at the position
      assert.deepEqual([di[2], di[3], di[4], di[5]], [x - entry.size / 2, y - entry.size / 2, entry.size, entry.size], 'medallion: centred on the body centre, the entry\'s size');
    } else {
      assert.deepEqual([di[2], di[3], di[4], di[5]], [-entry.size / 2, -entry.size / 2, entry.size, entry.size], 'centred on the body centre, the entry\'s size');
      const tr = calls.slice(0, i).filter((c) => c[0] === 'translate').at(-1);
      assert.ok(near(tr[1], x) && near(tr[2], y), `${o.type} at the interpolated position`);
    }
  }
});

test('art changes the bitmaps only: every object keeps the position, the rotation and the draw order it has when painted', () => {
  const art = busyScene({ assets: createArtStub() });
  const bare = busyScene();
  const a = art.rig.draw(art.frame()).slice();
  const b = bare.rig.draw(bare.frame()).slice();
  const entryOf = (rig, o) => (o.kind === 'bomb' ? rig.sprites.bomb() : o.kind === 'golden' ? rig.sprites.golden() : o.kind === 'powerup' ? rig.sprites.medallion(o.type) : rig.sprites.fruit(o.type));
  /** centre and rotation at which the object's bitmap was drawn, and where it sits in the frame */
  const placed = (rig, calls, o) => {
    const e = entryOf(rig, o);
    const i = indexOfCanvas(calls, e.canvas);
    assert.ok(i >= 0);
    const di = calls[i];
    const before = calls.slice(0, i);
    if (o.kind === 'powerup') return { i, x: di[2] + di[4] / 2, y: di[3] + di[5] / 2, rot: 0 };
    const tr = before.filter((c) => c[0] === 'translate').at(-1);
    const rot = before.filter((c) => c[0] === 'rotate').at(-1);
    return { i, x: tr[1], y: tr[2], rot: rot[1] };
  };
  let lastArt = -1;
  let lastBare = -1;
  for (const o of art.snap.objects) {
    const pa = placed(art.rig, a, o);
    const pb = placed(bare.rig, b, o);
    assert.ok(near(pa.x, pb.x) && near(pa.y, pb.y) && near(pa.rot, pb.rot), `${o.kind} ${o.type}: same place and turn`);
    assert.ok(pa.i > lastArt && pb.i > lastBare, 'objects come in snapshot order in both');
    lastArt = pa.i;
    lastBare = pb.i;
  }
  assert.equal(art.rig.sprites.fruit('apple').art, true);
  assert.equal(bare.rig.sprites.fruit('apple').art, undefined);
});

test('DRAW ORDER with art: background, stains, banner, halves, objects, telegraphs, bursts, HUD, popups, toast, cursor (design 11.3)', () => {
  const assets = createArtStub();
  const { rig, h, frame, snap } = busyScene({ assets });
  h.ui.notify({ type: 'recentered', kind: 'manual' });
  h.step({ snapshot: snap });
  rig.trail.updateCursor(makeBlade(), 0.016);
  const calls = rig.draw(frame());
  const bg = indexOfCanvas(calls, rig.sprites.background(1).canvas);
  const stain = indexOfCanvas(calls, rig.sprites.splat(artIdsFor('apple').juice, 0).canvas);
  const band = calls.findIndex((c) => c[0] === 'drawImage' && c[1] && c[1].height === 250 && c[1].width >= 900); // the tier 4 ink plate (baked 250 tall)
  const half = indexOfCanvas(calls, rig.sprites.halfArt('apple', 1).canvas);
  const melon = indexOfCanvas(calls, rig.sprites.fruit('watermelon').canvas);
  const warning = indexOfCanvas(calls, assets.lastScaled('icon_warning').canvas);
  const explosion = indexOfCanvas(calls, assets.lastScaled('fx_bomb_explosion').canvas);
  const flash = indexOfCanvas(calls, assets.lastScaled('fx_slice_flash').canvas);
  const hud = rig.indexOfText('SCORE');
  const popup = indexOfCanvas(calls, rig.fx.popups.find((p) => p.active && p.text === '+15').ref.canvas); // popups are baked text sprites
  const toast = rig.indexOfText('Crosshair recentered');
  const cursor = indexOfCanvas(calls, assets.lastScaled('cursor_idle').canvas);
  const order = { bg, stain, band, half, melon, warning, explosion, flash, hud, popup, toast, cursor };
  for (const [k, v] of Object.entries(order)) assert.ok(v >= 0, `${k} was drawn`);
  // the slice flash is brief and sits on top of the blade and the HUD, just under the popups (restyle: direction 2.1, docs/contract-notes.md)
  assert.ok(bg < stain && stain < band && band < half && half < melon && melon < warning && warning < explosion && explosion < hud && hud < flash && flash < popup && popup < toast && toast < cursor, JSON.stringify(order));
});

test('HALVES: the shared art half is drawn upright and rotated by the REAL half.rot (rot0 is 0), side +1 half_a, side -1 half_b', () => {
  const assets = createArtStub();
  const { rig, frame, halves } = busyScene({ assets });
  const calls = rig.draw(frame());
  const [a, b] = halves;
  const ea = rig.sprites.halfSprites.get(a.id);
  const eb = rig.sprites.halfSprites.get(b.id);
  assert.equal(ea.rot0, 0);
  assert.notEqual(ea.canvas, eb.canvas);
  assert.equal(rig.sprites.stats.halvesRasterised, 0, 'no per-cut painting');
  for (const [half, e] of [[a, ea], [b, eb]]) {
    const i = indexOfCanvas(calls, e.canvas);
    assert.ok(i >= 0);
    const before = calls.slice(0, i);
    assert.ok(near(before.filter((c) => c[0] === 'rotate').at(-1)[1], (half.prot + half.rot) / 2), 'rotated by lerp(prot, rot, alpha) with nothing subtracted');
    const tr = before.filter((c) => c[0] === 'translate').at(-1);
    assert.ok(near(tr[1], (half.px + half.x) / 2) && near(tr[2], (half.py + half.y) / 2));
    assert.deepEqual(calls[i].slice(2), [-e.half, -e.half, e.size, e.size]);
  }
  assert.equal(rig.sprites.halfArt('apple', 1).canvas, ea.canvas);
  assert.equal(rig.sprites.halfArt('apple', -1).canvas, eb.canvas);
});

test('ghost halves (evicted by the 40-halves cap) are drawn from the shared art too, fading over 150 ms', () => {
  const assets = createArtStub();
  const rig = makeRenderRig({ assets });
  const h = makeUiHarness();
  h.toPlaying('classic');
  const half = makeHalf({ id: 7000001, side: -1, parentType: 'pear', r: 66, rot: 1.1 });
  const snap = makeSnapshot({ halves: [] });
  rig.fx.addGhostHalf(half);
  rig.fx.update(0.05, 0.05, snap);
  rig.sprites.beginHalfFrame();
  rig.sprites.ensureHalf(half);
  const alphas = trackAlpha(rig);
  const calls = rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  const i = indexOfCanvas(calls, rig.sprites.halfArt('pear', -1).canvas);
  assert.ok(i >= 0, 'the ghost is drawn from half_b of the pear');
  assert.ok(alphas.length > 0);
  assert.ok(near(rig.fx.ghostAlpha(rig.fx.ghosts[0]), 1 - 0.05 / 0.15, 1e-9));
  assert.ok(near(calls.slice(0, i).filter((c) => c[0] === 'rotate').at(-1)[1], 1.1), 'rot - rot0 with rot0 = 0');
});

test('STAINS: juice colours with a splash use the art stain (320 px) at the splat\'s own size and alpha, multiply compositing kept', () => {
  const assets = createArtStub();
  const { rig, frame } = busyScene({ assets });
  const calls = rig.draw(frame());
  const stains = rig.fx.splats.filter((s) => s.active && !s.soot);
  assert.equal(stains.length, 2);
  for (const s of stains) {
    const sp = rig.sprites.splat(rig.fx.colorTable[s.color], s.variant, false);
    assert.equal(sp.art, true);
    const i = indexOfCanvas(calls, sp.canvas);
    assert.ok(i >= 0, 'drawn');
    assert.deepEqual(calls[i].slice(2), [-s.size / 2, -s.size / 2, s.size, s.size]);
  }
  const soot = rig.fx.splats.find((s) => s.active && s.soot);
  const sootSprite = rig.sprites.splat(rig.fx.colorTable[soot.color], soot.variant, true);
  assert.equal(sootSprite.art, undefined, 'the bomb soot stays painted');
  assert.ok(indexOfCanvas(calls, sootSprite.canvas) >= 0);
});

test('WARNING ICON: the telegraph is the art icon (contain in 72 x 72, bottom edge on y 1064, pulsing about its base), no vermilion triangle', () => {
  const assets = createArtStub();
  const { rig, frame, snap } = busyScene({ assets });
  const calls = rig.draw(frame());
  const log = assets.scaledLog.find((l) => l.id === 'icon_warning');
  assert.deepEqual([log.boxW, log.boxH], [72, 72]);
  const w = assets.lastScaled('icon_warning');
  const i = indexOfCanvas(calls, w.canvas);
  assert.ok(i >= 0);
  assert.deepEqual(calls[i].slice(2), [-w.w / 2, -w.h, w.w, w.h]);
  const tr = calls.slice(0, i).filter((c) => c[0] === 'translate').at(-1);
  assert.deepEqual([tr[1], tr[2]], [snap.telegraphs[0].x, 1064]);
  const sc = calls.slice(0, i).filter((c) => c[0] === 'scale').at(-1);
  const pulse = 1 + 0.12 * Math.sin((snap.telegraphs[0].remainingMs / 1000) * TAU * 3);
  assert.ok(near(sc[1], pulse) && near(sc[2], pulse));
  assert.equal(calls.filter((c) => c[0] === 'moveTo' && c[1] === 0 && c[2] === -30).length, 0, 'no painted triangle');
  assert.equal(rig.ctx.stack.length, 0);
});

test('WARNING ICON missing: the painted triangle with the "!" is drawn as before', () => {
  const { rig, frame } = busyScene({ assets: without('icon_warning') });
  const calls = rig.draw(frame());
  assert.equal(calls.filter((c) => c[0] === 'moveTo' && c[1] === 0 && c[2] === -30).length, 1);
  assert.ok(rig.ctx.texts.some((t) => t.text === '!'));
  assert.equal(rig.renderer.artState().warning, false);
});

test('WARNING ICON with Reduce flashing does not pulse (scale 1)', () => {
  const assets = createArtStub();
  const { rig, h, snap } = busyScene({ assets });
  h.view.settings = { ...h.view.settings, reduceFlash: true };
  const calls = rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  const i = indexOfCanvas(calls, assets.lastScaled('icon_warning').canvas);
  const sc = calls.slice(0, i).filter((c) => c[0] === 'scale').at(-1);
  assert.deepEqual([sc[1], sc[2]], [1, 1]);
});

test('COMBO ICON: drawn inside the banner transform 88 px from the left end of the ink plate, after the plate and before the words', () => {
  const assets = createArtStub();
  const { rig, frame } = busyScene({ assets });
  const calls = rig.draw(frame());
  const ic = assets.lastScaled('icon_combo');
  const log = assets.scaledLog.find((l) => l.id === 'icon_combo');
  assert.deepEqual([log.boxW, log.boxH], [104, 104]);
  const iBand = calls.findIndex((c) => c[0] === 'drawImage' && c[1] && c[1].height === 250 && c[1].width >= 900);
  const plate = calls[iBand];
  const iIcon = indexOfCanvas(calls, ic.canvas);
  assert.ok(iBand >= 0 && iIcon > iBand);
  assert.deepEqual(calls[iIcon].slice(2), [-plate[1].width / 2 + 88 - ic.w / 2, -ic.h / 2, ic.w, ic.h]); // the plate is baked at density 1: its canvas width is its logical width
  const word = rig.sprites.text({ text: 'COMBO', style: 'banner110', size: 160, tint: 'paper' });
  assert.ok(indexOfCanvas(calls, word.canvas) > iIcon, 'before the words');
});

test('COMBO ICON missing: the banner is drawn without it', () => {
  const { rig, frame } = busyScene({ assets: without('icon_combo') });
  const calls = rig.draw(frame());
  assert.equal(rig.renderer.artState().combo, false);
  assert.equal(calls.filter((c) => c[0] === 'drawImage' && c[1].width === 104 * 1).length, 0, 'no combo icon canvas');
  const word = rig.sprites.text({ text: 'COMBO', style: 'banner110', size: 160, tint: 'paper' });
  assert.ok(indexOfCanvas(calls, word.canvas) > 0);
});

test('BOMB: the spark sits on the art\'s own fuse tip (rotated with the bomb); the painted bomb keeps painters.bombFuseTip', () => {
  const art = busyScene({ assets: createArtStub() });
  const artCalls = art.rig.draw(art.frame());
  const bare = busyScene();
  const bareCalls = bare.rig.draw(bare.frame());
  const bomb = art.snap.objects.find((o) => o.kind === 'bomb');
  const x = (bomb.px + bomb.x) / 2;
  const y = (bomb.py + bomb.y) / 2;
  const rot = (bomb.prot + bomb.rot) / 2;
  const at = (tip) => [x + tip.x * Math.cos(rot) - tip.y * Math.sin(rot), y + tip.x * Math.sin(rot) + tip.y * Math.cos(rot)];
  const hasCore = (calls, p) => calls.some((c) => c[0] === 'arc' && c[3] === 5 && c[4] === 0 && near(c[1], p[0]) && near(c[2], p[1]));
  const tipArt = at(art.rig.sprites.bomb().fuseTip);
  const tipPainted = at(bombFuseTip(BOMB_ART.r));
  assert.ok(hasCore(artCalls, tipArt), 'art frame: spark core on the art tip');
  assert.equal(hasCore(artCalls, tipPainted), false, 'and not on the painted tip');
  assert.ok(hasCore(bareCalls, tipPainted), 'painted frame: spark core on painters.bombFuseTip');
  assert.equal(hasCore(bareCalls, tipArt), false);
  assert.ok(Math.hypot(tipArt[0] - tipPainted[0], tipArt[1] - tipPainted[1]) > 5, 'the two tips are in different places');
  // the halo is drawn around the same point
  assert.ok(artCalls.some((c) => c[0] === 'arc' && near(c[1], tipArt[0]) && near(c[2], tipArt[1]) && c[3] >= 9 && c[3] <= 12));
});

test('the danger ring, the golden sparkles, the medallion dots and extras stay procedural on top of the art', () => {
  const art = busyScene({ assets: createArtStub() });
  const bare = busyScene();
  const count = (calls, name) => calls.filter((c) => c[0] === name).length;
  const a = gameLayerCalls(art.rig.draw(art.frame()));
  const b = gameLayerCalls(bare.rig.draw(bare.frame()));
  // the danger ring (radius 1.2 r) and the eight orbiting dots of every medallion are arcs in both
  const ring = (calls) => calls.filter((c) => c[0] === 'arc' && Math.abs(c[3] - 64 * 1.2) < 1e-9).length;
  assert.equal(ring(a), 1);
  assert.equal(ring(b), 1);
  const dots = (calls) => calls.filter((c) => c[0] === 'arc' && c[3] === 5 && Math.abs(c[4]) === 0).length;
  assert.equal(dots(a), dots(b), 'the eight dots per medallion (and the bomb spark core)');
  assert.ok(count(a, 'arc') >= count(b, 'arc') - 40, 'no painted arcs disappeared other than the painted extras');
});

test('EXPLOSION: drawn after the objects at the bomb centre, anchored at its alpha centroid, 512 px (8 radii) wide x scale, alpha from the burst', () => {
  const assets = createArtStub();
  const { rig, frame } = busyScene({ assets });
  const alphas = trackAlpha(rig);
  const calls = rig.draw(frame());
  const ex = assets.lastScaled('fx_bomb_explosion');
  const meta = assets.meta('fx_bomb_explosion');
  const log = assets.scaledLog.find((l) => l.id === 'fx_bomb_explosion');
  assert.equal(log.boxW, 512);
  assert.ok(near(log.boxH, 512 * meta.contentBox.h / meta.contentBox.w));
  const b = rig.fx.bursts.find((x) => x.active && x.kind === 'explosion');
  const v = rig.fx.burstView(b);
  const k = (512 / ex.w) * v.scale;
  const ax = (meta.anchor.x - meta.contentBox.x) * (ex.w / meta.contentBox.w);
  const ay = (meta.anchor.y - meta.contentBox.y) * (ex.h / meta.contentBox.h);
  const imgs = drawImages(calls);
  const idx = imgs.findIndex((c) => c[1] === ex.canvas);
  assert.ok(idx >= 0);
  const di = imgs[idx];
  assert.ok(near(di[2], b.x - ax * k) && near(di[3], b.y - ay * k), 'the alpha centroid is on the bomb');
  assert.ok(near(di[4], ex.w * k) && near(di[5], ex.h * k));
  assert.ok(v.scale > 0.55 && v.scale < 1, `growing (${v.scale})`);
  assert.ok(near(alphas[idx], v.alpha), 'alpha 1 while the life is young');
  assert.equal(rig.ctx.globalAlpha, 1, 'the frame ends with alpha 1');
  assert.equal(rig.ctx.stack.length, 0);
});

test('EXPLOSION with Reduce flashing: static 0.85 and at most 0.7 opaque', () => {
  const assets = createArtStub();
  const rig = makeRenderRig({ assets });
  const h = makeUiHarness();
  h.toPlaying('classic');
  rig.fx.setSettings({ reduceFlash: true, reduceMotion: false });
  const snap = makeSnapshot({ objects: [makeObject({ id: 3, kind: 'bomb' })] });
  rig.fx.handleEvent(bombEvent({ x: 700, y: 600 }));
  rig.fx.update(0.1, 0.1, snap);
  const alphas = trackAlpha(rig);
  const calls = rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  const ex = assets.lastScaled('fx_bomb_explosion');
  const imgs = drawImages(calls);
  const idx = imgs.findIndex((c) => c[1] === ex.canvas);
  assert.ok(idx >= 0);
  assert.ok(near(imgs[idx][4], ex.w * 0.85), 'no scale animation: 0.85');
  assert.ok(alphas[idx] <= 0.7 + 1e-12);
});

test('EXPLOSION art missing: a painted fireball (two soft puffs) takes its place, so ?assets=0 keeps the centre of the blast', () => {
  const withAll = busyScene({ assets: createArtStub() });
  const noExplosion = busyScene({ assets: without('fx_bomb_explosion') });
  const a = withAll.rig.draw(withAll.frame());
  const b = noExplosion.rig.draw(noExplosion.frame());
  assert.equal(noExplosion.rig.renderer.artState().explosion, false);
  assert.equal(drawImages(b).length - drawImages(a).length, 1, 'two puffs instead of the one explosion image');
});

test('SLICE FLASH: drawn along the blade, its own axis length equals 2.6 r times its 0.6 to 1 growth, alpha from the burst; the slash lines are not drawn', () => {
  const assets = createArtStub();
  const { rig, frame } = busyScene({ assets });
  const alphas = trackAlpha(rig);
  const calls = rig.draw(frame());
  const fl = assets.lastScaled('fx_slice_flash');
  const meta = assets.meta('fx_slice_flash');
  const log = assets.scaledLog.find((l) => l.id === 'fx_slice_flash');
  assert.equal(log.boxW, 192);
  const k0 = fl.w / meta.contentBox.w;
  const axisLen = meta.axis.lengthPx * k0;
  const bursts = rig.fx.bursts.filter((x) => x.active && x.kind === 'slice');
  assert.equal(bursts.length, 2);
  const imgs = drawImages(calls);
  const flashIdx = imgs.map((c, i) => (c[1] === fl.canvas ? i : -1)).filter((i) => i >= 0);
  assert.equal(flashIdx.length, 2);
  for (let n = 0; n < 2; n++) {
    const b = bursts[n];
    const di = imgs[flashIdx[n]];
    const k = (b.size / axisLen) * rig.fx.burstView(b).scale;
    assert.ok(near(b.size, 2.6 * (n === 0 ? 68 : 68)), 'the slash length of the cut');
    assert.ok(near(di[2], -(meta.anchor.x - meta.contentBox.x) * k0 * k) && near(di[3], -(meta.anchor.y - meta.contentBox.y) * k0 * k), 'anchored at its alpha centroid');
    assert.ok(near(di[4], fl.w * k) && near(di[5], fl.h * k));
    assert.ok(near(alphas[flashIdx[n]], rig.fx.burstView(b).alpha));
    const at = imgs[flashIdx[n]];
    const pos = calls.indexOf(at);
    const rot = calls.slice(0, pos).filter((c) => c[0] === 'rotate').at(-1);
    assert.ok(near(rot[1], b.angle - meta.axis.angleRad), 'turned by the blade angle minus the streak\'s own angle');
    const tr = calls.slice(0, pos).filter((c) => c[0] === 'translate').at(-1);
    assert.deepEqual([tr[1], tr[2]], [b.x, b.y]);
  }
  // a streak drawn along the blade: the image's axis, turned by (angle - axisAngle), points along the blade angle
  const b0 = bursts[0];
  assert.ok(near(meta.axis.angleRad + (b0.angle - meta.axis.angleRad), b0.angle));
});

test('SLICE FLASH art missing: the slash lines are drawn (two strokes per slash), and with the art they are not', () => {
  const strokes = (calls) => calls.filter((c) => c[0] === 'stroke').length;
  const withArt = busyScene({ assets: createArtStub() });
  const noFlash = busyScene({ assets: without('fx_slice_flash') });
  const a = gameLayerCalls(withArt.rig.draw(withArt.frame()));
  const b = gameLayerCalls(noFlash.rig.draw(noFlash.frame()));
  const slashes = noFlash.rig.fx.slashes.filter((s) => s.active).length;
  assert.equal(slashes, 2);
  assert.equal(strokes(b) - strokes(a), 2 * slashes);
  assert.equal(noFlash.rig.renderer.artState().flash, false);
  assert.equal(withArt.rig.renderer.artState().flash, true);
});

test('an expired burst draws nothing and leaves the alpha at 1', () => {
  const assets = createArtStub();
  const { rig, frame, snap } = busyScene({ assets });
  for (let i = 0; i < 40; i++) rig.fx.update(0.05, 0.05, snap);
  assert.equal(rig.fx.activeBursts(), 0);
  const calls = rig.draw(frame());
  assert.equal(indexOfCanvas(calls, assets.lastScaled('fx_bomb_explosion').canvas), -1);
  assert.equal(indexOfCanvas(calls, assets.lastScaled('fx_slice_flash').canvas), -1);
  assert.equal(rig.ctx.globalAlpha, 1);
});

test('LATE ART: a loader that finishes while the game runs swaps the painted sprites for art, and no frame ever draws nothing', () => {
  const assets = createArtStub({ ids: [] });
  const { rig, frame, snap } = busyScene({ assets });
  rig.sprites.warmUp();
  const objectCanvases = (calls) => snap.objects.map((o) => {
    const e = o.kind === 'bomb' ? rig.sprites.bomb() : o.kind === 'golden' ? rig.sprites.golden() : o.kind === 'powerup' ? rig.sprites.medallion(o.type) : rig.sprites.fruit(o.type);
    return [e, indexOfCanvas(calls, e.canvas)];
  });
  let calls = rig.draw(frame());
  let list = objectCanvases(calls);
  assert.ok(list.every(([e, i]) => e.art === undefined && i >= 0), 'painted, all drawn');
  const painted = list.map(([e]) => e);
  assets.add(GAMEPLAY_ART_IDS);
  calls = rig.draw(frame());
  list = objectCanvases(calls);
  assert.ok(list.every(([e, i]) => e.art === true && i >= 0), 'art, all drawn, on the very next frame');
  assert.ok(list.every(([e], n) => e !== painted[n]));
  assert.equal(rig.renderer.artState().explosion, true, 'the renderer picked its own art up too');
  // and back (the loader released the group)
  assets.remove(GAMEPLAY_ART_IDS);
  calls = rig.draw(frame());
  list = objectCanvases(calls);
  assert.ok(list.every(([e, i]) => e.art === undefined && i >= 0), 'painted again, all drawn');
  assert.equal(rig.renderer.artState().explosion, false);
  assert.equal(rig.renderer.artState().warning, false);
});

test('PER-PIECE FALLBACK across the whole frame: one missing id turns only that thing painted', () => {
  const { rig, frame } = busyScene({ assets: without('fruit_watermelon_whole', 'medallion_double', 'fx_slice_flash') });
  rig.draw(frame());
  assert.equal(rig.sprites.fruit('watermelon').art, undefined);
  assert.equal(rig.sprites.fruit('cherry').art, true);
  assert.equal(rig.sprites.medallion('double').art, undefined);
  assert.equal(rig.sprites.medallion('freeze').art, true);
  assert.equal(rig.renderer.artState().flash, false);
  assert.equal(rig.renderer.artState().explosion, true);
});

test('the draw context handed to the screens has g.assets (the assets, or NULL_ASSETS when none) and g.density', () => {
  const assets = createArtStub();
  const withArt = plainScene({ assets, dpr: 2 });
  withArt.rig.draw(withArt.frame());
  assert.equal(withArt.rig.renderer.drawContext.assets, assets);
  assert.equal(withArt.rig.renderer.drawContext.density, 2);
  const bare = plainScene();
  bare.rig.draw(bare.frame());
  assert.equal(bare.rig.renderer.drawContext.assets, NULL_ASSETS);
  assert.equal(bare.rig.renderer.drawContext.assets.isNull, true);
  const nul = plainScene({ assets: null });
  nul.rig.draw(nul.frame());
  assert.equal(nul.rig.renderer.drawContext.assets, NULL_ASSETS);
});

test('EVERY SCREEN draws with art on: text of at least 28 px, no shadowBlur / filter, balanced save / restore, HUD and popups above the art', () => {
  const screens = [
    ['boot', {}], ['safety', {}], ['connect', {}], ['calibration', { step: 1 }], ['calibration', { step: 4 }],
    ['menu', {}], ['settings', {}], ['countdown', { roundMode: 'arcade' }], ['playing', { roundMode: 'arcade' }], ['paused', { roundMode: 'classic' }], ['results', { roundMode: 'classic' }],
  ];
  for (const [screen, opts] of screens) {
    const rig = makeRenderRig({ assets: createArtStub() });
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.ui.force(screen, opts);
    if (screen === 'results') h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'classic' }) });
    h.advance(300);
    const inRound = ['countdown', 'playing', 'paused', 'results'].includes(screen) || (screen === 'calibration' && opts.step === 4);
    const snap = inRound ? makeSnapshot({ mode: opts.roundMode ?? 'classic', lives: opts.roundMode === 'arcade' ? null : 3, timeLeft: opts.roundMode === 'arcade' ? 42 : null, timeTotal: opts.roundMode === 'arcade' ? 60 : null, objects: [makeObject()], telegraphs: [{ x: 400, remainingMs: 200 }] }) : null;
    rig.trail.updateCursor(makeBlade(), 0.016);
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: h.clock.now() });
    assert.deepEqual(rig.ctx.forbidden, [], `${screen}: no shadowBlur or filter`);
    for (const t of rig.ctx.texts) assert.ok(t.size >= 28 || t.text === '!' || /^x2$/.test(t.text), `${screen}: "${t.text}" is ${t.size}px`);
    assert.equal(rig.ctx.stack.length, 0, `${screen}: save / restore balanced`);
    assert.equal(rig.ctx.globalAlpha, 1);
  }
});

test('NO shadowBlur / filter in a frame with every effect on and every piece of art: explosion, flashes, brush, cursor', () => {
  const assets = createArtStub();
  const { rig, frame, snap } = busyScene({ assets });
  rig.trail.update(makeBlade({ samples: [], cutting: true, speed: 2500 }), 1000);
  rig.fx.update(0.02, 0.02, snap);
  rig.draw(frame());
  assert.deepEqual(rig.ctx.forbidden, []);
  assert.equal(rig.ctx.stack.length, 0);
  assert.ok(rig.ctx.calls.length > 200);
});

test('letterbox bars and the identity transform still close the frame with art', () => {
  const { rig, frame } = plainScene({ assets: createArtStub(), cssW: 1440, cssH: 900, dpr: 2 });
  rig.draw(frame());
  const calls = rig.ctx.calls;
  let last = -1;
  calls.forEach((c, i) => { if (c[0] === 'setTransform') last = i; });
  assert.deepEqual(calls[last].slice(1), [1, 0, 0, 1, 0, 0]);
  assert.equal(calls.slice(last + 1).filter((c) => c[0] === 'fillRect').length, 2);
});

test('the density step of the art is the inline formula: dpr 2 asks the loader for density 2, dpr 1 for density 1', () => {
  for (const [dpr, expected] of [[1, 1], [1.5, 1.5], [2, 2], [3, 2]]) {
    const assets = createArtStub();
    const { rig, frame } = plainScene({ assets, cssW: 1920, cssH: 1080, dpr });
    rig.draw(frame());
    const log = assets.scaledLog.find((l) => l.id === 'icon_warning');
    assert.equal(log.density, expected, `dpr ${dpr}`);
  }
});

test('a layout change (density step) re-asks the loader once and keeps the art', () => {
  const assets = createArtStub();
  const { rig, frame } = plainScene({ assets, dpr: 1 });
  rig.draw(frame());
  const n = assets.calls.scaled;
  rig.draw(frame());
  assert.equal(assets.calls.scaled, n, 'not per frame');
  rig.renderer.resize(1920, 1080, 2);
  rig.draw(frame());
  assert.equal(assets.calls.scaled, n + 6, 'once: the four pieces of the renderer and the two cursors of the trail');
  rig.draw(frame());
  assert.equal(assets.calls.scaled, n + 6, 'and not again');
  assert.equal(rig.renderer.artState().warning, true);
});

test('a loader that throws while the renderer prepares its pieces leaves the painted frame, with one console.warn', () => {
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const assets = createArtStub();
    assets.scaledThrows = true;
    const { rig, frame } = busyScene({ assets });
    rig.draw(frame());
    rig.draw(frame());
    assert.equal(warned >= 1, true);
    const st = rig.renderer.artState();
    assert.deepEqual([st.warning, st.combo, st.explosion, st.flash], [false, false, false, false]);
    assert.equal(rig.ctx.stack.length, 0);
  } finally {
    console.warn = warn;
  }
});

test('a loader object without the loader members is the same as no assets for the renderer and the trail too', () => {
  const rig = makeRenderRig({ assets: { hello: 1 } });
  const h = makeUiHarness();
  h.toPlaying('classic');
  const snap = makeSnapshot({ objects: [makeObject()] });
  rig.trail.updateCursor(makeBlade(), 0.016);
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  assert.equal(rig.renderer.drawContext.assets, NULL_ASSETS);
  assert.ok(rig.ctx.calls.some((c) => c[0] === 'arc' && c[3] === 24), 'the painted cursor ring');
  assert.equal(rig.renderer.artState().warning, false);
});
