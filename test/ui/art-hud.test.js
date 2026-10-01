// The HUD with art (docs/assets-integration.md 5.1, 5.5): the timer ring picture with the arc on its band, the power-up icons in the tray, the
// life apples unchanged, and the caching rules. The procedural HUD (no art) is pinned by test/ui/art-fallback.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../../public/js/render/palette.js';
import { HUD, drawHud, timerRingArt } from '../../public/js/render/hud.js';
import { createArtStub, SEED } from '../../test-support/ui/art-stub.js';
import { makeFxStub, makeG, makeRecordingCanvas, makeSpriteStub, runScene } from '../../test-support/ui/art-scenes.js';
import { readDrawn } from '../../test-support/ui/art-geometry.js';
import { makeSnapshot, makeUiHarness } from '../../test-support/ui/fixtures.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
/** The size of the single characters drawn on the centre line of the timer (y 98): the timer digits. */
const chars0Size = (drawn) => drawn.texts.find((t) => t.text.length === 1 && Math.abs(t.cy - 98) < 1e-9)?.size;
const RING = SEED.timer_ring.ring;
const BOX = SEED.timer_ring.contentBox;

/** Draw the HUD of a snapshot with the given assets; returns the calls and the drawn images. */
function hud(snapshotOver, { assets, density = 2, hint = false, sprites = makeSpriteStub() } = {}) {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.view.hint.show = hint;
  const canvas = makeRecordingCanvas(1920, 1080, { widthFactor: 0.6 });
  const g = makeG({ view: h.view, assets, density, snapshot: makeSnapshot(snapshotOver), sprites, fx: makeFxStub(), canvas });
  drawHud(g, { scorePop: 1 });
  return { g, ctx: canvas.ctx, calls: canvas.ctx.calls, drawn: readDrawn(canvas.ctx.calls), sprites };
}

const ARCADE = { mode: 'arcade', lives: null, timeLeft: 42, timeTotal: 60 };
const ZEN = { mode: 'zen', lives: null, timeLeft: 88, timeTotal: 90 };

test('HUD constants: the first version stays for the procedural ring (y 92, r 70), the picture has its own (centre y 96, band radius 72)', () => {
  assert.deepEqual([HUD.timer.x, HUD.timer.y, HUD.timer.r], [960, 92, 70]);
  assert.deepEqual([HUD.timerArt.x, HUD.timerArt.y, HUD.timerArt.r], [960, 96, 72]);
  assert.equal(HUD.timerArt.digitPx, 40, 'the contract says 44: too wide for the hole when measured in Chrome (see the constant)');
});

test('timer ring (Arcade): the band middle has radius 72 around (960, 96): the picture is scaled by 72 / bandMid and placed by its ring centre', () => {
  const assets = createArtStub();
  const { drawn, calls } = hud(ARCADE, { assets });
  const s = 72 / RING.bandMid;
  const call = assets.scaledLog.find((c) => c.id === 'timer_ring');
  assert.ok(near(call.boxW, BOX.w * s) && near(call.boxH, BOX.h * s), 'requested at the scale that puts bandMid at 72');
  const [ring] = drawn.images.filter((i) => i.id === 'timer_ring');
  assert.ok(near(ring.w, BOX.w * s) && near(ring.h, BOX.h * s));
  // the ring centre of the file lands on (960, 96)
  assert.ok(near(ring.x + (RING.cx - BOX.x) * s, 960, 1e-6), `ring centre x ${ring.x + (RING.cx - BOX.x) * s}`);
  assert.ok(near(ring.y + (RING.cy - BOX.y) * s, 96, 1e-6), `ring centre y ${ring.y + (RING.cy - BOX.y) * s}`);
  // the top of the ring stays on the canvas (that is why the centre moved from 92 to 96)
  assert.ok(96 - RING.outer * s >= 0, `outer top ${96 - RING.outer * s}`);
  assert.ok(ring.y >= 0 && ring.x >= 0 && ring.x + ring.w <= 1920);
  // the remaining-time arc runs on the band: radius = bandMid * s, width 60 percent of the band, round caps, teal
  const arc = calls.find((c) => c[0] === 'arc' && c[4] !== 0 && c[3] !== undefined && c[4] === -Math.PI / 2);
  assert.ok(arc, 'the time arc is drawn from 12 o\'clock');
  assert.deepEqual([arc[1], arc[2]], [960, 96]);
  assert.ok(near(arc[3], RING.bandMid * s, 1e-9), `arc radius ${arc[3]}`);
  const arcIdx = calls.indexOf(arc);
  // the styles are set after the path and before the stroke
  const strokeIdx = calls.findIndex((c, i) => i > arcIdx && c[0] === 'stroke');
  const before = (name) => calls.slice(arcIdx, strokeIdx).filter((c) => c[0] === name).at(-1)[1];
  assert.ok(near(before('=lineWidth'), 2 * RING.bandHalf * s * 0.6, 1e-9), `arc width ${before('=lineWidth')}`);
  assert.equal(before('=lineCap'), 'round');
  assert.equal(before('=strokeStyle'), COLORS.teal);
  assert.ok(near(before('=lineWidth'), 13, 1), 'about 13 px');
  // the arc lies inside the drawn band (band = bandMid +- bandHalf, in px)
  assert.ok(before('=lineWidth') / 2 < RING.bandHalf * s);
});

test('timer ring: the ring picture replaces the faint track circle (no 10 px track stroke) and is drawn before the arc', () => {
  const { calls, drawn } = hud(ARCADE, { assets: createArtStub() });
  const idxRing = calls.findIndex((c) => c[0] === 'drawImage' && c[1].artId === 'timer_ring');
  const idxArc = calls.findIndex((c) => c[0] === 'arc' && c[4] === -Math.PI / 2);
  assert.ok(idxRing >= 0 && idxRing < idxArc);
  assert.equal(calls.filter((c) => c[0] === 'arc' && c[4] === 0 && c[5] === 2 * Math.PI).length, 0, 'no full-circle track arc');
  assert.equal(drawn.images.filter((i) => i.id === 'timer_ring').length, 1);
});

test('timer ring: the digits are 40 px in the hole (34 in Zen, never below 28), leave room to the ink ring at their widest ("0:00"); the TIME caption sits below the ring at y + outer * s + 30', () => {
  for (const [name, snap, r] of [['Arcade', ARCADE, 72], ['Zen', ZEN, 72 * 0.86]]) {
    const { drawn } = hud(snap, { assets: createArtStub() });
    const s = r / RING.bandMid;
    // the time is drawn digit by digit in fixed cells (docs/restyle-direction.md 1.5): read the characters back as one text, centred between the first and the last
    const chars = drawn.texts.filter((t) => t.text.length === 1 && Math.abs(t.cy - 98) < 1e-9 && t.size === chars0Size(drawn));
    const digits = chars.length === 4 ? { text: chars.map((c) => c.text).join(''), size: chars[0].size, cx: (chars[0].cx + chars[3].cx) / 2, cy: chars[0].cy } : null;
    assert.ok(digits && /^\d:\d\d$/.test(digits.text), `${name}: the digits are drawn`);
    assert.ok(digits.size >= 28, `${name}: ${digits.size} px`);
    assert.equal(digits.size, name === 'Arcade' ? 40 : 34, `${name}: the size`);
    // "0:00" is the widest text the timer shows: 2.31 em in the sans style at weight 800 (101.2 px at 44 px, measured in Chrome on macOS)
    const widest = digits.size * 2.31 + HUD.timerArt.digitStroke;
    const hole = 2 * RING.hole * s;
    assert.ok(widest <= hole - 8, `${name}: "0:00" with its stroke is ${widest.toFixed(1)} px in a hole of ${hole.toFixed(1)} px (4 px of room on each side)`);
    assert.ok(near(digits.cx, 960) && near(digits.cy, 96 + 2), `${name}: centred in the ring`);
    const caption = drawn.texts.find((t) => t.text === 'TIME');
    assert.ok(near(caption.cy, 96 + RING.outer * s + 30, 1e-9), `${name}: caption baseline ${caption.cy}`);
  }
});

test('timer ring (Zen): a smaller ring (0.86 of the Arcade radius), drawn at 0.85 alpha like the procedural one', () => {
  const assets = createArtStub();
  const { drawn, calls } = hud(ZEN, { assets });
  const s = 72 * 0.86 / RING.bandMid;
  const [ring] = drawn.images.filter((i) => i.id === 'timer_ring');
  assert.ok(near(ring.w, BOX.w * s));
  const idx = calls.findIndex((c) => c[0] === 'drawImage' && c[1].artId === 'timer_ring');
  assert.equal(calls.slice(0, idx).filter((c) => c[0] === '=globalAlpha').at(-1)[1], 0.85);
  assert.equal(calls.filter((c) => c[0] === '=globalAlpha').at(-1)[1], 1, 'and the alpha is restored');
});

test('timer ring: in the last 10 seconds of Arcade the arc turns deep vermilion and the digits pulse, as before', () => {
  const { calls } = hud({ ...ARCADE, timeLeft: 7.4 }, { assets: createArtStub() });
  const arc = calls.find((c) => c[0] === 'arc' && c[4] === -Math.PI / 2);
  const strokeIdx = calls.findIndex((c, i) => i > calls.indexOf(arc) && c[0] === 'stroke');
  assert.equal(calls.slice(calls.indexOf(arc), strokeIdx).filter((c) => c[0] === '=strokeStyle').at(-1)[1], COLORS.vermilionDeep);
  assert.ok(calls.some((c) => c[0] === 'scale' && Math.abs(c[1] - 1.06) < 1e-9), 'the pulse scale of fx.timerPulseScale()');
});

test('timer ring: no time left means no arc but the ring picture stays', () => {
  const { calls, drawn } = hud({ ...ARCADE, timeLeft: 0 }, { assets: createArtStub() });
  assert.equal(drawn.images.filter((i) => i.id === 'timer_ring').length, 1);
  assert.equal(calls.filter((c) => c[0] === 'arc').length, 0);
});

test('timer ring: the density is the stepped density of the frame, the result is cached per radius, density and generation', () => {
  const assets = createArtStub();
  const a = timerRingArt(assets, 72, 2);
  assert.ok(a && a.img.canvas.width === Math.ceil(a.img.w * 2));
  assert.equal(timerRingArt(assets, 72, 2), a, 'the same object again');
  const b = timerRingArt(assets, 72 * 0.86, 2);
  assert.notEqual(b, a);
  assert.equal(timerRingArt(assets, 72, 2), a, 'Arcade and Zen sizes live side by side');
  const one = timerRingArt(assets, 72, 1);
  assert.equal(one.img.canvas.width, Math.ceil(one.img.w));
  assets.resetStats();
  for (let i = 0; i < 100; i++) { timerRingArt(assets, 72, 2); timerRingArt(assets, 72 * 0.86, 2); }
  assert.equal(assets.stats.scaled + assets.stats.has + assets.stats.meta, 0, 'no Assets call per frame');
  assets.bump();
  const again = timerRingArt(assets, 72, 2);
  assert.notEqual(again, a, 'a new generation rebuilds');
  assert.equal(timerRingArt(assets, 72, 2), again);
});

test('timer ring: without the picture, its ring metadata, or with a broken assets object the procedural ring is drawn where it always was (y 92, r 70)', () => {
  for (const assets of [undefined, createArtStub({ missing: ['timer_ring'] }), createArtStub({ meta: { timer_ring: { ring: undefined } } }), createArtStub({ noMeta: ['timer_ring'] })]) {
    const { calls, drawn } = hud(ARCADE, { assets });
    assert.equal(drawn.images.filter((i) => i.id === 'timer_ring').length, 0);
    const track = calls.find((c) => c[0] === 'arc' && c[4] === 0 && c[5] === 2 * Math.PI);
    assert.ok(track, 'the faint track circle');
    assert.deepEqual([track[1], track[2], track[3]], [960, 92, 70]);
    assert.equal(readDrawn(calls).texts.find((t) => t.text === 'TIME').cy, 92 + 70 + 34);
  }
});

test('power-up tray: the small icon_<id> art in a 68 px box at the tray positions, at the frame density; the shrinking ink ring stays; the medallion sprite is not drawn', () => {
  const assets = createArtStub();
  const snap = { ...ARCADE, powerups: ['freeze', 'frenzy', 'double', 'clock'].map((id) => ({ id, remainingS: 3, durationS: 5 })) };
  const { drawn, calls, sprites } = hud(snap, { assets, density: 1.5 });
  const icons = drawn.images.filter((i) => i.id.startsWith('icon_'));
  assert.deepEqual(icons.map((i) => i.id), ['icon_freeze', 'icon_frenzy', 'icon_double', 'icon_clock']);
  icons.forEach((im, i) => {
    assert.ok(near(im.x + im.w / 2, HUD.tray.x + i * HUD.tray.pitch) && near(im.y + im.h / 2, HUD.tray.y), `${im.id} centred on the tray slot`);
    assert.ok(im.w <= 68 + 1e-9 && im.h <= 68 + 1e-9 && (near(im.w, 68) || near(im.h, 68)), `${im.id} contained in 68 x 68`);
    assert.ok(im.h >= 44, 'never a tiny icon (no icon is below 44 px)');
  });
  for (const c of assets.scaledLog.filter((c) => c.id.startsWith('icon_'))) assert.deepEqual([c.boxW, c.boxH, c.density], [68, 68, 1.5]);
  const rings = calls.filter((c) => c[0] === 'arc' && c[3] === HUD.tray.r + 8 && c[4] === -Math.PI / 2);
  assert.equal(rings.length, 4, 'four shrinking rings (each over a faint full-circle track since the restyle)');
  assert.equal(calls.filter((c) => c[0] === 'arc' && c[3] === HUD.tray.r + 8 && c[4] === 0).length, 4, 'and four tracks');
  assert.equal(sprites.calls.filter((c) => c[0] === 'medallion').length, 0);
  assert.ok(!calls.some((c) => c[0] === 'drawImage' && c[1] && c[1].spriteKey && c[1].spriteKey.startsWith('medal:')), 'no medallion sprite in the tray');
});

test('power-up tray: an icon that is missing turns only that slot back to the medallion sprite', () => {
  const assets = createArtStub({ missing: ['icon_double'] });
  const snap = { ...ARCADE, powerups: ['freeze', 'double', 'clock'].map((id) => ({ id, remainingS: 3, durationS: 5 })) };
  const { drawn, calls } = hud(snap, { assets });
  assert.deepEqual(drawn.images.filter((i) => i.id && i.id.startsWith('icon_')).map((i) => i.id), ['icon_freeze', 'icon_clock']);
  const medallions = calls.filter((c) => c[0] === 'drawImage' && c[1].spriteKey && c[1].spriteKey.startsWith('medal:'));
  assert.deepEqual(medallions.map((c) => c[1].spriteKey), ['medal:double']);
  assert.ok(near(medallions[0][2] + medallions[0][4] / 2, HUD.tray.x + 1 * HUD.tray.pitch), 'in the second slot');
});

test('power-up tray: the icons are cached (no Assets call per frame) and rebuilt on a new generation', () => {
  const assets = createArtStub();
  const snap = { ...ARCADE, powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }] };
  hud(snap, { assets });
  assets.resetStats();
  const h = makeUiHarness();
  h.toMenuWithSim();
  const canvas = makeRecordingCanvas();
  const g = makeG({ view: h.view, assets, density: 2, snapshot: makeSnapshot(snap), sprites: makeSpriteStub(), fx: makeFxStub(), canvas });
  for (let i = 0; i < 60; i++) drawHud(g, { scorePop: 1 });
  assert.deepEqual({ ...assets.stats }, { scaled: 0, sliced: 0, has: 0, get: 0, meta: 0 });
  assets.bump();
  drawHud(g, { scorePop: 1 });
  assert.ok(assets.stats.scaled >= 1 && assets.stats.scaled <= 3, 'one rebuild of the ring and the icon');
});

test('lives: the life apples are exactly what they were (sprites.lifeApple), with or without art in the HUD', () => {
  const snap = { lives: 2, lifeRegen: { progress: 10, per: 25 } };
  const withArt = hud(snap, { assets: createArtStub() });
  const without = hud(snap, { assets: undefined });
  const apples = (calls) => calls.filter((c) => c[0] === 'drawImage' && c[1].spriteKey && c[1].spriteKey.startsWith('life:')).map((c) => [c[1].spriteKey, c[2], c[3], c[4], c[5]]);
  assert.deepEqual(apples(withArt.calls), apples(without.calls));
  assert.deepEqual(apples(withArt.calls).map((a) => a[0]), ['life:full', 'life:full', 'life:empty']);
});

test('the rest of the HUD (score, best, hint) is identical with and without art', () => {
  const snap = { lives: 3, score: 340 };
  const sig = (calls) => calls.filter((c) => c[0] === 'fillText' || c[0] === 'strokeText').map((c) => [c[0], c[1], c[2], c[3]]);
  assert.deepEqual(sig(hud(snap, { assets: createArtStub(), hint: true }).calls), sig(hud(snap, { assets: undefined, hint: true }).calls));
});

test('the HUD draws nothing outside a round (practice or no snapshot) with art, like before', () => {
  assert.equal(runScene('hud-practice', { assets: createArtStub() }).calls.length, 0);
  const h = makeUiHarness();
  const canvas = makeRecordingCanvas();
  drawHud(makeG({ view: h.view, assets: createArtStub(), snapshot: null, fx: makeFxStub(), canvas }), { scorePop: 1 });
  assert.equal(canvas.ctx.calls.length, 0);
});
