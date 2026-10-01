// The art layer of trail.js (docs/assets-integration.md 3.7): the ink brush under the polygon and the two art cursors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/config.js';
import { NULL_ASSETS } from '../../public/js/render/assets.js';
import { createTrail } from '../../public/js/render/trail.js';
import { FakeContext } from '../../test-support/render/fake-canvas.js';
import { GAMEPLAY_ART_IDS, createArtStub } from '../../test-support/render/art-stub.js';
import { digestCalls } from '../../test-support/render/scenes.js';
import { bladeSample, makeBlade } from '../../test-support/ui/fixtures.js';

const C = CONFIG.cursor;

/** A context that also records the globalAlpha in force at every drawImage. */
function ctxWithAlphas() {
  const ctx = new FakeContext({ width: 1920, height: 1080 });
  const alphas = [];
  const orig = ctx.drawImage;
  ctx.drawImage = (...a) => { alphas.push(ctx.globalAlpha); orig(...a); };
  ctx.alphas = alphas;
  return ctx;
}

/** A straight run of `count` samples 4 ms apart ending at `endT`, `dx` px apart along +x. */
function run(endT, count, dx) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(bladeSample({ t: endT - (count - 1 - i) * 4, x: 300 + i * dx, y: 500, cutting: true, speed: 2500 }));
  return out;
}

function cuttingTrail(assets, { count = 30, dx = 9, now = 1000, speed = 2500 } = {}) {
  const trail = createTrail({ assets });
  trail.update(makeBlade({ samples: run(1000, count, dx), cutting: true, speed, head: null }), now);
  return trail;
}

const brushOf = (assets) => assets.lastScaled('fx_blade_trail_tex');

/** The brush pieces a draw made: {x, y, rot, len, width, sx, sy, sw, sh, alpha, index} in call order. */
function brushPieces(ctx, brush) {
  const out = [];
  let di = 0;
  ctx.calls.forEach((c, i) => {
    if (c[0] !== 'drawImage') return;
    if (c[1] === brush.canvas) {
      const before = ctx.calls.slice(0, i);
      const tr = before.filter((x) => x[0] === 'translate').at(-1);
      const rot = before.filter((x) => x[0] === 'rotate').at(-1);
      out.push({ x: tr[1], y: tr[2], rot: rot[1], sx: c[2], sy: c[3], sw: c[4], sh: c[5], dx: c[6], dy: c[7], len: c[8], width: c[9], alpha: ctx.alphas[di], index: i });
    }
    di++;
  });
  return out;
}

test('BRUSH: the ink brush picture is NOT drawn any more (it showed as a grey striped wing, direction 2.7); the loader is not asked for it', () => {
  const assets = createArtStub();
  const trail = cuttingTrail(assets);
  const ctx = ctxWithAlphas();
  trail.draw(ctx, 2);
  assert.ok(!assets.lastScaled('fx_blade_trail_tex'), 'the brush is never requested');
  assert.equal(ctx.counts.drawImage ?? 0, 0, 'no picture is drawn under the polygon');
  // the same polygon calls with or without art: the art layer of the trail is only the cursor now
  const bare = cuttingTrail(NULL_ASSETS);
  const b = new FakeContext({});
  bare.draw(b, 1);
  assert.equal(digestCalls(ctx.calls), digestCalls(b.calls));
});

test('THE LOADER IS NOT ASKED PER FRAME: scaled() is called once per (generation, density step), never from draw', () => {
  const assets = createArtStub();
  const trail = cuttingTrail(assets);
  trail.updateCursor(makeBlade({ head: { x: 500, y: 500 } }), 0.016);
  const ctx = new FakeContext({});
  trail.draw(ctx, 2);
  trail.drawCursor(ctx, 2);
  const first = assets.calls.scaled;
  assert.equal(first, 2, 'idle cursor, cutting cursor (the brush is not drawn any more)');
  for (let i = 0; i < 300; i++) { trail.draw(ctx, 2); trail.drawCursor(ctx, 2); }
  assert.equal(assets.calls.scaled, first);
  trail.draw(ctx, 1.5);
  assert.equal(assets.calls.scaled, first + 2, 'a new density step re-asks once');
  trail.draw(ctx, 1.5);
  assert.equal(assets.calls.scaled, first + 2);
  assets.add(['bg_classic_far']); // generation changes
  trail.draw(ctx, 1.5);
  assert.equal(assets.calls.scaled, first + 4, 'a new generation re-asks once');
});

test('CURSOR IDLE: the art ring with the aim dot on the sample, scale (ringR + 6) / body.r, times the recenter pulse, alpha 0.9', () => {
  const assets = createArtStub();
  const trail = createTrail({ assets });
  trail.updateCursor(makeBlade({ head: { x: 600, y: 400 } }), 0.016, { pulse: 1 });
  const ctx = ctxWithAlphas();
  trail.drawCursor(ctx, 2);
  const art = assets.lastScaled('cursor_idle');
  const m = assets.meta('cursor_idle');
  const s = (C.ringR + 6) / m.body.r;
  assert.ok(Math.abs(art.w - m.contentBox.w * s) < 1e-9, 'contentBox scaled by (ringR + 6) / body.r');
  const di = ctx.calls.find((c) => c[0] === 'drawImage');
  assert.equal(di[1], art.canvas);
  assert.ok(Math.abs(di[2] - (600 - (m.anchor.x - m.contentBox.x) * s)) < 1e-9, 'the aim dot is exactly on x');
  assert.ok(Math.abs(di[3] - (400 - (m.anchor.y - m.contentBox.y) * s)) < 1e-9, 'and on y');
  assert.ok(Math.abs(di[4] - art.w) < 1e-9 && Math.abs(di[5] - art.h) < 1e-9);
  assert.equal(ctx.alphas[0], 0.9);
  assert.equal(ctx.counts.arc ?? 0, 0, 'no painted ring, dot or disc');
  // the recenter pulse scales the art about the aim dot
  trail.updateCursor(makeBlade({ head: { x: 600, y: 400 } }), 0.016, { pulse: 0.7 });
  ctx.reset();
  trail.drawCursor(ctx, 2);
  const p = ctx.calls.find((c) => c[0] === 'drawImage');
  assert.ok(Math.abs(p[2] - (600 - (m.anchor.x - m.contentBox.x) * s * 0.7)) < 1e-9);
  assert.ok(Math.abs(p[4] - art.w * 0.7) < 1e-9);
});

test('CURSOR: the dwell arc stays painted over the art; tracking lost = alpha 0.35 and the three dots', () => {
  const assets = createArtStub();
  const trail = createTrail({ assets });
  trail.updateCursor(makeBlade({ head: { x: 600, y: 400 } }), 0.016, { pulse: 0.8, dwell: 0.5 });
  const ctx = ctxWithAlphas();
  trail.drawCursor(ctx, 1);
  const arcs = ctx.calls.filter((c) => c[0] === 'arc');
  assert.equal(arcs.length, 1);
  assert.equal(arcs[0][3], C.ringR * 0.8 + 9, 'the dwell arc keeps its radius');
  assert.ok(ctx.calls.findIndex((c) => c[0] === 'arc') > ctx.calls.findIndex((c) => c[0] === 'drawImage'), 'over the art');
  // lost
  const lost = createTrail({ assets });
  lost.updateCursor(makeBlade({ head: { x: 600, y: 400 }, trackingOk: false }), 0.016);
  const c2 = ctxWithAlphas();
  lost.drawCursor(c2, 1);
  assert.equal(c2.alphas[0], 0.35);
  const dots = c2.calls.filter((c) => c[0] === 'arc' && c[4] === 0 && c[3] === 3.5);
  assert.equal(dots.length, 3);
  assert.deepEqual(dots.map((c) => c[1]), [586, 600, 614]);
  assert.ok(dots.every((c) => c[2] === 400 + C.ringR + 22));
});

test('CURSOR CUTTING: the cutting art replaces the vermilion disc, scale (cutR + 8) / body.r, growing 22 -> 26 px over 60 ms', () => {
  const assets = createArtStub();
  const trail = createTrail({ assets });
  const cutting = makeBlade({ head: { x: 700, y: 300 }, cutting: true });
  trail.updateCursor(cutting, 0.001);
  const ctx = ctxWithAlphas();
  trail.drawCursor(ctx, 2);
  const art = assets.lastScaled('cursor_cutting');
  const m = assets.meta('cursor_cutting');
  const s0 = (C.cutR + 8) / m.body.r;
  assert.ok(Math.abs(art.w - m.contentBox.w * s0) < 1e-9);
  const di = ctx.calls.find((c) => c[0] === 'drawImage');
  const k0 = (trail.cutDiscRadius() + 8) / (C.cutR + 8);
  assert.ok(Math.abs(di[4] - art.w * k0) < 1e-9);
  assert.ok(Math.abs(di[2] - (700 - (m.anchor.x - m.contentBox.x) * s0 * k0)) < 1e-9, 'the aim dot stays on the sample');
  assert.equal(ctx.counts.arc ?? 0, 0, 'no painted disc');
  assert.equal(ctx.alphas[0], 0.9);
  trail.updateCursor(cutting, 0.06);
  ctx.reset();
  ctx.alphas.length = 0;
  trail.drawCursor(ctx, 2);
  const grown = ctx.calls.find((c) => c[0] === 'drawImage');
  assert.ok(Math.abs(grown[4] - art.w * ((C.cutR + 4 + 8) / (C.cutR + 8))) < 1e-6, 'full size after 60 ms: (26 + 8) / (22 + 8)');
  assert.ok(grown[4] > di[4]);
});

test('CURSOR: tracking lost while cutting shows the idle art (as the painted ring did), never the cutting art', () => {
  const assets = createArtStub();
  const trail = createTrail({ assets });
  trail.updateCursor(makeBlade({ head: { x: 500, y: 500 }, cutting: true, trackingOk: false }), 0.016);
  const ctx = new FakeContext({});
  trail.drawCursor(ctx, 1);
  assert.equal(ctx.calls.find((c) => c[0] === 'drawImage')[1], assets.lastScaled('cursor_idle').canvas);
});

test('per-state fallback: with only the idle art the cutting cursor is the painted vermilion disc, and the other way round', () => {
  const noCut = createArtStub({ ids: GAMEPLAY_ART_IDS.filter((id) => id !== 'cursor_cutting') });
  const t1 = createTrail({ assets: noCut });
  t1.updateCursor(makeBlade({ head: { x: 500, y: 500 }, cutting: true }), 0.1);
  const c1 = new FakeContext({});
  t1.drawCursor(c1, 1);
  assert.equal(c1.counts.drawImage ?? 0, 0);
  assert.ok(c1.calls.some((c) => c[0] === 'arc' && c[3] === C.cutR + 4), 'the painted disc');
  t1.updateCursor(makeBlade({ head: { x: 500, y: 500 } }), 0.016);
  c1.reset();
  t1.drawCursor(c1, 1);
  assert.equal(c1.counts.drawImage, 1, 'the idle art is used');
  const noIdle = createArtStub({ ids: GAMEPLAY_ART_IDS.filter((id) => id !== 'cursor_idle') });
  const t2 = createTrail({ assets: noIdle });
  t2.updateCursor(makeBlade({ head: { x: 500, y: 500 } }), 0.016);
  const c2 = new FakeContext({});
  t2.drawCursor(c2, 1);
  assert.equal(c2.counts.drawImage ?? 0, 0);
  assert.ok(c2.calls.some((c) => c[0] === 'arc' && c[3] === C.ringR), 'the painted ring');
});

test('no cursor without a position, art or not', () => {
  const trail = createTrail({ assets: createArtStub() });
  trail.updateCursor(makeBlade({ head: null, latest: null }), 0.016);
  const ctx = new FakeContext({});
  trail.drawCursor(ctx, 2);
  assert.equal(ctx.calls.length, 0);
});

test('a loader that throws (scaled, a broken manifest entry) leaves the painted trail and cursor, with one console.warn', () => {
  const warn = console.warn;
  let warned = 0;
  console.warn = () => { warned++; };
  try {
    const assets = createArtStub();
    assets.scaledThrows = true;
    const trail = cuttingTrail(assets);
    trail.updateCursor(makeBlade({ head: { x: 500, y: 500 } }), 0.016);
    const ctx = new FakeContext({});
    trail.draw(ctx, 1);
    trail.drawCursor(ctx, 1);
    trail.drawCursor(ctx, 1);
    assert.equal(warned, 1);
    assert.equal(ctx.counts.drawImage ?? 0, 0);
    assert.ok(ctx.calls.some((c) => c[0] === 'arc' && c[3] === C.ringR));
    // meta without body / contentBox: painted cursor, no exception
    const bad = createArtStub({ meta: { cursor_idle: { body: null }, cursor_cutting: { contentBox: null } } });
    const t2 = createTrail({ assets: bad });
    t2.updateCursor(makeBlade({ head: { x: 500, y: 500 }, cutting: true }), 0.1);
    const c2 = new FakeContext({});
    t2.drawCursor(c2, 1);
    assert.ok(c2.calls.some((c) => c[0] === 'arc'));
  } finally {
    console.warn = warn;
  }
});

test('no assets, NULL_ASSETS and an empty stub: the trail and the cursor draw exactly the same calls as before the art layer', () => {
  const make = (assets) => {
    const t = createTrail(assets === undefined ? {} : { assets });
    t.update(makeBlade({ samples: run(1000, 30, 9), cutting: true, speed: 2500, head: { x: 580, y: 560 } }), 1000);
    t.updateCursor(makeBlade({ head: { x: 580, y: 560 }, cutting: true }), 0.03, { pulse: 1 });
    const ctx = new FakeContext({});
    t.draw(ctx, 2);
    t.drawCursor(ctx, 2);
    return digestCalls(ctx.calls);
  };
  const plain = make(undefined);
  assert.equal(make(NULL_ASSETS), plain);
  assert.equal(make(createArtStub({ ids: [] })), plain);
});
