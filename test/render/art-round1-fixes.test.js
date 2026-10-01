// Regression tests for the blocking findings of art review round 1 (docs/contract-notes.md, "Art round 1 fixes"). Stub images and the fake
// 2D context only; nothing here reads a browser. One section per finding.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArtStub } from '../../test-support/render/art-stub.js';
import { FakeCanvas, createFakeCanvasFactory } from '../../test-support/render/fake-canvas.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { makeBlade, makeObject, makeSnapshot, makeUiHarness, roundResult } from '../../test-support/ui/fixtures.js';
import { makeG, makeRecordingCanvas } from '../../test-support/ui/art-scenes.js';
import { createArtStub as createUiArtStub } from '../../test-support/ui/art-stub.js';
import { BOMB_RIM_PX, createSprites } from '../../public/js/render/sprites.js';
import { BOMB_ART, COLORS } from '../../public/js/render/palette.js';
import { drawTextPlate, secondaryInk } from '../../public/js/render/draw-util.js';
import { draw as drawPause } from '../../public/js/ui/screens/pause.js';
import { draw as drawResults } from '../../public/js/ui/screens/results.js';
import { draw as drawMenu } from '../../public/js/ui/screens/menu.js';
import { draw as drawTuning } from '../../public/js/ui/screens/tuning.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------------------------------------------------ F6: countdown must not re-bake halves

/** The real manifest entries (contentBox, halfScale ...) as the stub wants them: the numbers that decide the baked canvas sizes. */
function realManifestStub() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public', 'assets', 'manifest.json'), 'utf8'));
  const entries = Array.isArray(manifest) ? manifest : (manifest.assets ?? manifest.entries ?? Object.values(manifest.images ?? manifest));
  return createArtStub({ manifest: entries, ids: entries.map((e) => e.id) });
}

/** Click the Classic menu fruit, then draw `frames` frames through renderer.draw(). Returns the canvases created per frame. */
function countdownFromMenu({ assets, frames = 90, dpr = 1.5 }) {
  const rig = makeRenderRig({ cssW: 1920 * dpr, cssH: 1080 * dpr, dpr, assets });
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(100);
  const blade = makeBlade();
  // a few menu frames first: the menu fruit are baked there, exactly like the player sees them before the click
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade, nowMs: h.clock.now() });
  assert.equal(h.ui.pointerClick(480, 520), true, 'the Classic menu fruit starts the round');
  const perFrame = [];
  const screens = [];
  for (let i = 0; i < frames; i++) {
    h.advance(16);
    const v = h.view;
    screens.push(v.screen);
    const snap = v.screen === 'countdown' ? makeSnapshot({ mode: 'classic', objects: [] }) : null;
    const n0 = rig.factory.created.length;
    rig.draw({ view: v, uiState: h.ui.getState(), snapshot: snap, blade, nowMs: h.clock.now() });
    perFrame.push(rig.factory.created.length - n0);
  }
  return { rig, h, perFrame, screens };
}

test('COUNTDOWN from a menu target: the sliced mode fruit is baked once, not on every frame (no per-frame canvas allocation)', () => {
  for (const [name, assets] of [['seed manifest', createArtStub()], ['real manifest', realManifestStub()]]) {
    const { perFrame, screens, rig } = countdownFromMenu({ assets });
    assert.equal(screens[0], 'countdown', `${name}: the click opened the countdown`);
    const inCountdown = screens.filter((s) => s === 'countdown').length;
    assert.ok(inCountdown >= 60, `${name}: the sliced fruit animation (about 1 s) runs inside the countdown, saw ${inCountdown} frames`);
    const halves = rig.sprites.stats.created;
    assert.ok(halves > 0, `${name}: art halves were baked`);
    // frame 0 bakes the two halves (plus the halving steps); every later frame must reuse them
    assert.deepEqual(perFrame.slice(1), new Array(perFrame.length - 1).fill(0), `${name}: no canvas is created after the first countdown frame`);
    assert.ok(perFrame[0] > 0, `${name}: the one-time bake happens on the first frame`);
  }
});

test('COUNTDOWN: the menu slots are still released once the round is on screen (memory comes back), and stay out of the countdown frames', () => {
  const { rig, h, screens } = countdownFromMenu({ assets: createArtStub(), frames: 300 });
  assert.ok(screens.includes('playing') || screens.at(-1) !== 'countdown', 'the countdown ended within 300 frames of 16 ms');
  // the screen is no longer menu, tuning or countdown: the slots were dropped, so asking again bakes a new bitmap
  const before = rig.sprites.stats.created;
  rig.sprites.menuHalf('watermelon', 1, 1.9, rig.renderer.drawContext.density);
  const again = rig.sprites.menuHalf('watermelon', 1, 1.9, rig.renderer.drawContext.density);
  assert.ok(again, 'a half can be baked again');
  assert.ok(rig.sprites.stats.created > before, 'the slot of the countdown was released after the countdown');
  assert.notEqual(h.view.screen, 'countdown');
});

test('COUNTDOWN resume after a pause (no sliced fruit) and the tuning screen draw without creating canvases per frame', () => {
  const rig = makeRenderRig({ assets: createArtStub() });
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('tuning', {});
  h.advance(300);
  const blade = makeBlade();
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade, nowMs: h.clock.now() });
  const n0 = rig.factory.created.length;
  for (let i = 0; i < 30; i++) {
    h.advance(16);
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade, nowMs: h.clock.now() });
  }
  assert.equal(rig.factory.created.length, n0, 'tuning: nothing is re-baked per frame');
});

// ------------------------------------------------------------------------------------------------ M2: the bomb silhouette (rim, ring)

/** A canvas factory whose contexts also remember every globalCompositeOperation they were given. */
function instrumentedFactory() {
  const base = createFakeCanvasFactory();
  const createCanvas = (w, h) => {
    const c = base.createCanvas(w, h);
    const ops = [];
    let cur = 'source-over';
    Object.defineProperty(c.ctx, 'globalCompositeOperation', { get: () => cur, set: (v) => { cur = v; ops.push(v); }, configurable: true });
    c.compositeOps = ops;
    return c;
  };
  return { created: base.created, createCanvas };
}

test('BOMB RIM: the art bomb is baked with a paper rim outside its outline: its silhouette is filled with the rim colour and stamped around a circle, then the art goes on top', () => {
  const f = instrumentedFactory();
  const assets = createArtStub({ createCanvas: f.createCanvas });
  const D = 2;
  const sprites = createSprites({ createCanvas: f.createCanvas, density: D, assets });
  const b = sprites.bomb();
  assert.equal(b.art, true);
  assert.equal(b.rim, BOMB_RIM_PX);
  assert.ok(BOMB_RIM_PX >= 4 && BOMB_RIM_PX <= 8, 'a rim of 4 to 8 logical px');
  const scratch = f.created.find((c) => c.compositeOps.includes('source-in'));
  assert.ok(scratch, 'a scratch canvas was filled through source-in (the silhouette in the rim colour)');
  assert.equal(scratch.ctx.fillStyle, COLORS.paperLight, 'in paper');
  assert.equal(scratch.ctx.calls.filter((c) => c[0] === 'fillRect').length, 1);
  assert.equal(scratch.ctx.calls.filter((c) => c[0] === 'drawImage').length, 1, 'the art is drawn into it once');
  const draws = b.canvas.ctx.calls.filter((c) => c[0] === 'drawImage');
  assert.equal(draws.length, 17, '16 stamps of the silhouette and the art itself');
  const stamps = draws.slice(0, 16);
  assert.ok(stamps.every((d) => d[1] === scratch), 'the stamps come first (under the art)');
  for (const d of stamps) assert.ok(Math.abs(Math.hypot(d[2], d[3]) - BOMB_RIM_PX * D) < 1e-9, `a stamp at ${BOMB_RIM_PX} logical px = ${BOMB_RIM_PX * D} device px`);
  assert.equal(new Set(stamps.map((d) => `${d[2].toFixed(3)},${d[3].toFixed(3)}`)).size, 16, 'at 16 different angles');
  assert.equal(draws[16][1].isStub, true, 'and the art last');
  assert.equal(f.created.length, 2 + 0, 'the bomb canvas and one scratch canvas, nothing else');
  assert.equal(sprites.bomb(), b, 'cached: nothing is baked again');
  assert.equal(f.created.length, 2);
});

test('BOMB RIM: only the bomb has one; fruit, medallions and the painted bomb are as before', () => {
  const f = instrumentedFactory();
  const assets = createArtStub({ createCanvas: f.createCanvas });
  const sprites = createSprites({ createCanvas: f.createCanvas, density: 2, assets });
  assert.equal(sprites.fruit('apple').rim, undefined);
  assert.equal(sprites.golden().rim, undefined);
  assert.equal(sprites.medallion('freeze').rim, undefined);
  const painted = createSprites({ createCanvas: createFakeCanvasFactory().createCanvas, density: 2 }).bomb();
  assert.equal(painted.rim, undefined);
  assert.equal(painted.art, undefined);
  // and a bomb without usable art falls back to the painted one: a throwing bake never leaves a hole
  const broken = createArtStub({ createCanvas: f.createCanvas });
  broken.throwOn.add('bomb_whole');
  const s2 = createSprites({ createCanvas: f.createCanvas, density: 2, assets: broken });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(s2.bomb().art, undefined);
  } finally {
    console.warn = warn;
  }
});

/** A rig whose stage stub says it drew a backdrop (so the renderer sets g.backdropArt and g.nightArt like it does with the real stage). */
function rigWithStage(draws = true, assets = createArtStub()) {
  const stage = { setMode() {}, needsFallback: () => !draws, draw: () => draws, resize() {}, prefetch() {} };
  return makeRenderRig({ assets, stage });
}

/** Stroke calls of the frame with the line width, colour and alpha in force. */
function strokesOf(rig) {
  const out = [];
  const orig = rig.ctx.stroke;
  rig.ctx.stroke = (...a) => {
    out.push({ lw: rig.ctx.lineWidth, style: rig.ctx.strokeStyle, alpha: rig.ctx.globalAlpha, at: rig.ctx.calls.length });
    orig(...a);
  };
  return out;
}

function bombFrame({ backdrop, reduceFlash }) {
  const rig = rigWithStage(backdrop);
  const h = makeUiHarness();
  h.toPlaying('classic');
  const view = { ...h.view, settings: { ...h.view.settings, reduceFlash } };
  const snap = makeSnapshot({ objects: [makeObject({ kind: 'bomb', x: 960, y: 800, px: 960, py: 800 })], alpha: 0.5, tWorld: 0.1 });
  rig.trail.updateCursor(makeBlade(), 0.016);
  const strokes = strokesOf(rig);
  rig.draw({ view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
  const ringArcs = rig.ctx.calls.map((c, i) => [c, i]).filter(([c]) => c[0] === 'arc' && Math.abs(c[3] - 64 * 1.2) < 1e-9);
  assert.equal(ringArcs.length, 1, 'one danger ring');
  const ringAt = ringArcs[0][1];
  const next = rig.ctx.calls.findIndex((c, i) => i > ringAt && c[0] === 'beginPath');
  const ring = strokes.filter((st) => st.at > ringAt && (next < 0 || st.at <= next));
  return { rig, ring };
}

test('DANGER RING over a stage backdrop: a paper underlay and an opaque, thicker vermilion ring (it was 6 px and 0.5 to 0.9 alpha)', () => {
  const { ring } = bombFrame({ backdrop: true, reduceFlash: false });
  assert.equal(ring.length, 2, 'underlay and ring');
  assert.deepEqual([ring[0].lw, ring[0].style, ring[0].alpha], [14, COLORS.paperLight, 0.85]);
  assert.equal(ring[1].lw, 8);
  assert.equal(ring[1].style, BOMB_ART.ring);
  assert.ok(ring[1].alpha >= 0.9 && ring[1].alpha <= 1, `opaque: ${ring[1].alpha}`);
  assert.ok(ring[1].lw > 6, 'thicker than before');
  const still = bombFrame({ backdrop: true, reduceFlash: true }).ring;
  assert.equal(still[1].alpha, 1, 'Reduce flashing: static, fully opaque');
});

test('DANGER RING without a stage backdrop (the painted background): exactly the old ring, one 6 px stroke at 0.5 to 0.9 alpha', () => {
  const { ring } = bombFrame({ backdrop: false, reduceFlash: false });
  assert.equal(ring.length, 1);
  assert.deepEqual([ring[0].lw, ring[0].style], [6, BOMB_ART.ring]);
  assert.ok(ring[0].alpha >= 0.5 - 1e-9 && ring[0].alpha <= 0.9 + 1e-9);
  assert.equal(bombFrame({ backdrop: false, reduceFlash: true }).ring[0].alpha, 0.7);
});

// ------------------------------------------------------------------------------------------------ M3: secondary text on the night art

test('NIGHT ART: the renderer sets g.nightArt only while the night stage is really under the frame (not on round stages, not without a stage, not when it drew nothing)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  const cases = [
    ['menu with a stage that draws', 'menu', true, true, true],
    ['menu, the stage drew nothing (still loading)', 'menu', false, false, false],
    ['a round screen with a stage', 'playing', true, true, false],
  ];
  for (const [name, screen, draws, backdropArt, nightArt] of cases) {
    const rig = rigWithStage(draws);
    const hh = makeUiHarness();
    if (screen === 'playing') hh.toPlaying('classic'); else hh.toMenuWithSim();
    const snap = screen === 'playing' ? makeSnapshot({ objects: [] }) : null;
    rig.trail.updateCursor(makeBlade(), 0.016);
    rig.draw({ view: hh.view, uiState: hh.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
    assert.equal(rig.renderer.drawContext.backdropArt, backdropArt, `${name}: backdropArt`);
    assert.equal(rig.renderer.drawContext.nightArt, nightArt, `${name}: nightArt`);
  }
  const bare = makeRenderRig({});
  const hb = makeUiHarness();
  hb.toMenuWithSim();
  bare.draw({ view: hb.view, uiState: hb.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 1000 });
  assert.equal(bare.renderer.drawContext.nightArt, false, 'no stage at all: the procedural drawing');
});

test('secondaryInk: ink on the night art, inkText2 everywhere else (an undefined flag counts as everywhere else)', () => {
  assert.equal(secondaryInk({ nightArt: true }), COLORS.ink);
  assert.equal(secondaryInk({ nightArt: false }), COLORS.inkText2);
  assert.equal(secondaryInk({}), COLORS.inkText2);
  assert.equal(secondaryInk({ nightArt: 1 }), COLORS.inkText2, 'only a real true');
});

/** fillText calls of a frame with the fill colour in force: [{text, fill}]. */
function textColours(ctx) {
  const out = [];
  const orig = ctx.fillText;
  ctx.fillText = (...a) => { out.push({ text: a[0], fill: ctx.fillStyle }); orig(...a); };
  return out;
}

test('NIGHT ART: the menu and tuning captions are drawn in ink on the night art and in inkText2 on the painted background', () => {
  for (const nightArt of [true, false]) {
    const expected = nightArt ? COLORS.ink : COLORS.inkText2;
    // menu: tagline, the three descriptions, the hint
    const h = makeUiHarness();
    h.toMenuWithSim();
    h.advance(1500); // past the menu entrance: the descriptions rise in with their fruit
    const canvas = new FakeCanvas(1920, 1080);
    const g = makeG({ view: h.view, assets: undefined, canvas });
    g.nightArt = nightArt;
    const seen = textColours(canvas.ctx);
    drawMenu(g);
    for (const start of [/^Slice the fruit/, /^3 lives/, /^60 seconds/, /^90 seconds/]) {
      const hit = seen.find((x) => start.test(x.text)); // the descriptions are wrapped: the first line starts the sentence
      assert.ok(hit, `menu shows ${start}`);
      assert.equal(hit.fill, expected, `menu ${start} with nightArt ${nightArt}`);
    }
    // tuning: the intro and the practice label
    const h2 = makeUiHarness();
    h2.toMenuWithSim();
    h2.ui.force('tuning', {});
    h2.advance(300);
    const c2 = new FakeCanvas(1920, 1080);
    const g2 = makeG({ view: h2.view, assets: undefined, canvas: c2 });
    g2.nightArt = nightArt;
    const seen2 = textColours(c2.ctx);
    drawTuning(g2);
    const intro = seen2.find((x) => /Move the sword as you would/.test(x.text));
    assert.ok(intro);
    assert.equal(intro.fill, expected, `tuning intro with nightArt ${nightArt}`);
    const verdict = seen2.find((x) => x.text === 'Make a firm swing');
    assert.equal(verdict.fill, expected, 'the verdict "Make a firm swing" too');
  }
});

// ------------------------------------------------------------------------------------------------ M4: the hint lines on a paper label

test('drawTextPlate: a rounded paper rectangle around a centred line, drawn before the text, measured once per text, alpha restored', () => {
  const ctx = new FakeCanvas(1920, 1080).ctx;
  let measured = 0;
  const m = ctx.measureText.bind(ctx);
  ctx.measureText = (t) => { measured++; return m(t); };
  ctx.globalAlpha = 0.5;
  drawTextPlate(ctx, 'A unique plate test line', 960, 1050, { style: 'small', align: 'center' });
  drawTextPlate(ctx, 'A unique plate test line', 960, 1050, { style: 'small', align: 'center' });
  assert.equal(measured, 1, 'measured once');
  assert.equal(ctx.globalAlpha, 0.5, 'the alpha in force is restored');
  assert.equal(ctx.fillStyle, COLORS.paperLight);
  const arcs = ctx.calls.filter((c) => c[0] === 'arcTo');
  assert.equal(arcs.length, 8, 'two plates of four corners');
  const first = ctx.calls.filter((c) => c[0] === 'moveTo')[0];
  const width = ctx.measureText('A unique plate test line').width;
  // centred: the path starts at the left edge of the plate (centre - (text + 2 x 22) / 2) plus the corner radius 16
  assert.ok(Math.abs(first[1] - (960 - (width + 44) / 2 + 16)) < 1e-6, 'centred on x 960');
  assert.equal(ctx.calls.filter((c) => c[0] === 'fill').length, 2);
  assert.equal(ctx.texts.length, 0, 'the plate draws no text');
  assert.ok(ctx.canvas && ctx.forbidden.length === 0, 'no shadow, no filter');
});

test('drawTextPlate: left and right alignment, and the plate is at least as wide as the text', () => {
  const ctx = new FakeCanvas(1920, 1080).ctx;
  const text = 'A second unique plate test line, longer than the first one.';
  for (const align of ['left', 'center', 'right']) {
    ctx.reset();
    drawTextPlate(ctx, text, 500, 600, { font: '600 28px sans-serif', align });
    const tw = ctx.measureText(text).width;
    const top = ctx.calls.filter((c) => c[0] === 'moveTo')[0];
    const right = ctx.calls.filter((c) => c[0] === 'arcTo')[0]; // arcTo(x + w, y, ...): the right edge
    const left = top[1] - 16;
    const rightEdge = right[1];
    assert.ok(rightEdge - left >= tw + 40, `${align}: plate ${rightEdge - left} wide for text ${tw}`);
    const cx = (left + rightEdge) / 2;
    if (align === 'center') assert.ok(Math.abs(cx - 500) < 1e-6);
    if (align === 'left') assert.ok(left < 500 && Math.abs(left - (500 - 22)) < 1e-6);
    if (align === 'right') assert.ok(Math.abs(rightEdge - 500) < 1e-6);
  }
});

function pauseGeometry(backdropArt) {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('paused', { roundMode: 'arcade' });
  h.advance(300);
  const canvas = makeRecordingCanvas();
  const g = makeG({ view: h.view, assets: createUiArtStub(), canvas });
  if (backdropArt !== undefined) g.backdropArt = backdropArt;
  drawPause(g);
  return canvas.ctx;
}

function resultsGeometry(backdropArt) {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('results', { roundMode: 'arcade' });
  h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'arcade' }) });
  h.advance(2500);
  const canvas = makeRecordingCanvas();
  const g = makeG({ view: h.view, assets: createUiArtStub(), canvas });
  if (backdropArt !== undefined) g.backdropArt = backdropArt;
  drawResults(g);
  return canvas.ctx;
}

const plateBefore = (ctx, textRe) => {
  const at = ctx.calls.findIndex((c) => c[0] === 'fillText' && textRe.test(c[1]));
  assert.ok(at > 0, `${textRe} is drawn`);
  // the last fill() before the text, with the fillStyle set just before it
  const before = ctx.calls.slice(0, at);
  const fillAt = before.map((c, i) => [c, i]).filter(([c]) => c[0] === 'fill').at(-1);
  if (!fillAt) return null;
  const style = before.slice(0, fillAt[1]).filter((c) => c[0] === '=fillStyle').at(-1);
  const arcs = before.slice(Math.max(0, fillAt[1] - 8), fillAt[1]).filter((c) => c[0] === 'arcTo').length;
  return { style: style && style[1], arcs, distance: at - fillAt[1] };
};

test('PAUSE tip and RESULTS rest line sit on a paper label over a stage backdrop, and are drawn exactly as before without one', () => {
  for (const [name, geo, re] of [['pause tip', pauseGeometry, /Slice several fruits|arm|hand/i], ['results rest line', resultsGeometry, /Rest your arm before/]]) {
    const on = geo(true);
    const plate = plateBefore(on, re);
    assert.ok(plate, `${name}: a fill before the text`);
    assert.equal(plate.style, COLORS.paperLight, `${name}: paper`);
    assert.equal(plate.arcs, 4, `${name}: rounded`);
    for (const backdropArt of [false, undefined]) {
      const off = geo(backdropArt);
      const p = plateBefore(off, re);
      assert.ok(!p || p.arcs !== 4 || p.distance > 20, `${name}: no label without a backdrop (${backdropArt})`);
    }
  }
});
