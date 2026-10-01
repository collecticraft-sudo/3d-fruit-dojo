// Blade trail geometry and the cursor (docs/game-design.md 8.4, 8.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/config.js';
import { bladeColors, createTrail, trailHeadWidth, trailWindowMs } from '../../public/js/render/trail.js';
import { FakeContext } from '../../test-support/render/fake-canvas.js';
import { bladeSample, makeBlade } from '../../test-support/ui/fixtures.js';

const T = 1000;
const stops = CONFIG.blade.stops;
const rgb = (a) => a.map(Math.round);
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** A straight run of samples at 4 ms spacing ending at time `endT`. */
function run(endT, count, dx = 6, opts = {}) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(bladeSample({ t: endT - (count - 1 - i) * 4, x: 300 + i * dx, y: 500, cutting: true, speed: 1500, ...opts }));
  return out;
}

test('colour ramp: vermilion at T, gold edge at T + 1200, cream core at T + 3000 and beyond', () => {
  let c = bladeColors(0, stops);
  assert.deepEqual(rgb(c.core), hex('#14141C'));
  assert.deepEqual(rgb(c.edge), hex('#D9432B'));
  c = bladeColors(1200, stops);
  assert.deepEqual(rgb(c.core), hex('#14141C'));
  assert.deepEqual(rgb(c.edge), hex('#F2B134'));
  c = bladeColors(3000, stops);
  assert.deepEqual(rgb(c.core), hex('#FFF3D1'));
  assert.deepEqual(rgb(c.edge), hex('#F2B134'));
  c = bladeColors(9000, stops);
  assert.deepEqual(rgb(c.core), hex('#FFF3D1'), 'clamped at the top');
  c = bladeColors(-500, stops);
  assert.deepEqual(rgb(c.edge), hex('#D9432B'), 'clamped at the bottom');
  c = bladeColors(600, stops);
  const mid = hex('#D9432B').map((v, i) => Math.round((v + hex('#F2B134')[i]) / 2));
  assert.deepEqual(rgb(c.edge), mid, 'linear interpolation in RGB between the stops');
});

test('history window 160-240 ms while cutting, head width 16-30 px, idle 120 ms / 4 px', () => {
  assert.equal(trailWindowMs(T, T), 160);
  assert.equal(trailWindowMs(T + 2500, T), 240);
  assert.equal(trailWindowMs(T + 9999, T), 240);
  assert.equal(trailWindowMs(T + 1250, T), 200);
  assert.equal(trailHeadWidth(T, T), 16);
  assert.equal(trailHeadWidth(T + 3000, T), 30);
  assert.ok(Math.abs(trailHeadWidth(T + 1500, T) - 23) < 1e-9);
  const trail = createTrail();
  trail.update(makeBlade({ samples: run(1000, 10), cutting: false, speed: 300 }), 1000);
  assert.equal(trail.style.W, 120);
  assert.equal(trail.style.headWidth, 4);
  assert.equal(trail.style.bodyAlpha, 0.6, 'the idle trail is a steel line');
  assert.equal(trail.style.edge, '#9FB4D0');
  assert.equal(trail.style.cutting, false);
});

test('taper: width at age a = headWidth * (1 - a / W)^1.6 (direction 2.7), zero at the tail', () => {
  const trail = createTrail();
  const samples = run(1000, 40, 5);
  trail.update(makeBlade({ samples, cutting: true, speed: T + 3000, head: null }), 1000);
  const W = trail.style.W;
  assert.equal(W, 240, 'window comes from the speed (T + 3000 is above the 2500 needed for the maximum)');
  for (const p of trail.getPoints()) {
    const expected = trail.style.headWidth * Math.max(0, 1 - p.age / W) ** 1.6;
    assert.ok(Math.abs(p.width - expected) < 1e-4, `age ${p.age}: ${p.width} vs ${expected}`);
  }
  const pts = trail.getPoints();
  assert.ok(pts[0].width < pts[pts.length - 1].width, 'thin tail, thick head');
});

test('aging uses nowMs: a stale trail fades and disappears even when no new samples arrive', () => {
  const trail = createTrail();
  const samples = run(1000, 30, 8);
  trail.update(makeBlade({ samples, cutting: false, speed: 100, head: null }), 1000);
  const n0 = trail.n;
  assert.ok(n0 > 10);
  trail.update(makeBlade({ samples, cutting: false, speed: 100, head: null }), 1060);
  assert.ok(trail.n < n0, 'older points dropped');
  trail.update(makeBlade({ samples, cutting: false, speed: 100, head: null }), 1200);
  assert.equal(trail.n, 0, 'nothing left after the window');
});

test('a discontinuity sample clears the trail: nothing before it is drawn', () => {
  const trail = createTrail();
  const samples = [...run(980, 10, 20), bladeSample({ t: 984, x: 1700, y: 100, discontinuity: true, cutting: false }), bladeSample({ t: 988, x: 1710, y: 100 }), bladeSample({ t: 992, x: 1720, y: 100 })];
  trail.update(makeBlade({ samples, cutting: false, speed: 0, head: null }), 995);
  const pts = trail.getPoints();
  assert.equal(pts.length, 3);
  assert.ok(pts.every((p) => p.x >= 1700), 'no point before the teleport');
});

test('at most 48 points, newest kept', () => {
  const trail = createTrail();
  const samples = run(1000, 120, 2, {});
  samples.forEach((s, i) => { s.t = 1000 - (119 - i) * 1; }); // 1 ms spacing: 120 samples inside the window
  trail.update(makeBlade({ samples, cutting: true, speed: T + 500, head: null }), 1000);
  assert.equal(trail.n, CONFIG.blade.maxPoints);
  assert.equal(trail.getPoints().at(-1).x, samples.at(-1).x);
});

test('the head is drawn from the newest position (headAt) at render time', () => {
  const trail = createTrail();
  const samples = run(1000, 10, 6);
  trail.update(makeBlade({ samples, cutting: true, speed: 2000, head: { x: samples.at(-1).x + 30, y: 500 }, trackingOk: true }), 1004);
  const last = trail.getPoints().at(-1);
  assert.equal(last.x, samples.at(-1).x + 30);
  assert.equal(last.age, 0);
  assert.ok(Math.abs(last.width - trail.style.headWidth) < 1e-4, 'the head has the full width');
});

test('after the swing ends the cutting style lingers only until the points have aged out (<= 240 ms)', () => {
  const trail = createTrail();
  const samples = run(1000, 20, 8);
  trail.update(makeBlade({ samples, cutting: true, speed: 2000, head: null }), 1000);
  const W = trail.style.W;
  assert.equal(trail.style.cutting, true);
  trail.update(makeBlade({ samples, cutting: false, speed: 100, head: null }), 1000 + W - 5);
  assert.equal(trail.style.cutting, true, 'still the swing that is fading');
  trail.update(makeBlade({ samples, cutting: false, speed: 100, head: null }), 1000 + W + 5);
  assert.equal(trail.style.cutting, false);
  assert.ok(W <= 240);
});

test('Freeze / Frenzy glow override replaces the edge colour', () => {
  const trail = createTrail();
  trail.update(makeBlade({ samples: run(1000, 10), cutting: true, speed: 1500, head: null }), 1000, '#7FD1F0');
  assert.equal(trail.style.edge, '#7FD1F0');
});

test('draw: cutting = glow (3.2 x the head width) + 6 px ink outline + body + core + streaks; idle = outline and body only; no shadowBlur', () => {
  const ctx = new FakeContext({});
  const trail = createTrail();
  trail.update(makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: 2000, head: null }), 1000);
  trail.draw(ctx);
  const widths = ctx.calls.filter((c) => c[0] === 'stroke').length;
  assert.ok(widths >= 3, 'glow, outline and the streaks are stroked');
  assert.equal(ctx.counts.fill, 2, 'body and core are filled');
  assert.ok(ctx.counts.quadraticCurveTo >= 40, 'polygons through quadratic mid-points (body and core)');
  assert.deepEqual(ctx.forbidden, []);
  const idle = new FakeContext({});
  const t2 = createTrail();
  t2.update(makeBlade({ samples: run(1000, 12, 8), cutting: false, speed: 100, head: null }), 1000);
  t2.draw(idle);
  assert.equal(idle.counts.stroke, 1, 'a thin outline only');
  assert.equal(idle.counts.fill, 2);
});

test('layers: the outline is 6 px wide ink at alpha 0.55, the glow 3.2 x the head width, the core is 0.38 of the width', () => {
  const trail = createTrail();
  trail.update(makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: 2000, head: null }), 1000);
  const ctx = new FakeContext({});
  const seen = [];
  const origStroke = ctx.stroke;
  ctx.stroke = (...a) => { seen.push({ w: ctx.lineWidth, alpha: ctx.globalAlpha, style: ctx.strokeStyle }); origStroke(...a); };
  trail.draw(ctx);
  const glow = seen[0];
  assert.ok(Math.abs(glow.w - 3.2 * trail.style.headWidth) < 1e-6, 'glow width');
  assert.ok(glow.alpha > 0.05 && glow.alpha < 0.2, `glow alpha ${glow.alpha}`);
  const outline = seen[1];
  assert.equal(outline.w, 6);
  assert.equal(outline.style, '#14141C');
  assert.equal(outline.alpha, 0.55);
});

test('the colour ramp is a table of 16 precomputed strings: no string is built per update', () => {
  const trail = createTrail();
  const blade = makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: T + 1500, head: null });
  trail.update(blade, 1000);
  const a = trail.style.edge;
  trail.update(blade, 1004);
  assert.equal(trail.style.edge, a);
  assert.equal(typeof a, 'string');
  const fast = createTrail();
  fast.update(makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: T + 5000, head: null }), 1000);
  assert.equal(fast.style.edge.toLowerCase(), 'rgb(255,106,74)', 'very fast: the hot vermilion edge');
  assert.equal(fast.style.core, 'rgb(255,255,255)');
});

test('blade particles: sparks at the head while cutting, capped at 24, none while idle, deterministic after reset', () => {
  const run1 = () => {
    const trail = createTrail();
    trail.reset(5);
    const blade = makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: 3000, head: null });
    trail.update(blade, 1000);
    for (let i = 0; i < 120; i++) trail.tick(0.016, { reduceFlash: false, reduceMotion: false });
    return trail;
  };
  const a = run1();
  assert.ok(a.particleCount > 0 && a.particleCount <= 24, `sparks live: ${a.particleCount}`);
  const b = run1();
  assert.equal(a.particleCount, b.particleCount);
  const idle = createTrail();
  idle.update(makeBlade({ samples: run(1000, 12, 8), cutting: false, speed: 10, head: null }), 1000);
  for (let i = 0; i < 60; i++) idle.tick(0.016, {});
  assert.equal(idle.particleCount, 0);
});

test('blade particles: Reduce flashes cuts the sparks by 70 percent, Reduce motion halves them', () => {
  const count = (settings) => {
    const trail = createTrail();
    trail.reset(5);
    const blade = makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: 3000, head: null });
    trail.update(blade, 1000);
    for (let i = 0; i < 60; i++) trail.tick(0.03, settings);
    return trail.spawned;
  };
  const normal = count({ reduceFlash: false, reduceMotion: false });
  const rf = count({ reduceFlash: true, reduceMotion: false });
  const rm = count({ reduceFlash: false, reduceMotion: true });
  assert.ok(rf < normal * 0.5, `Reduce flashes: ${rf} against ${normal}`);
  assert.ok(rm < normal * 0.75 && rm > 0, `Reduce motion (halved): ${rm} against ${normal}`);
});

test('power-up auras: Freeze throws ice shards (cap 40), Frenzy flame wisps, Double glints; none once the aura is off', () => {
  const live = (powerup) => {
    const trail = createTrail();
    trail.reset(3);
    trail.setAura({ powerup, k: 1 });
    trail.update(makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: 3000, head: null }), 1000);
    for (let i = 0; i < 90; i++) trail.tick(0.02, { reduceFlash: false, reduceMotion: false });
    return trail.particleCount;
  };
  assert.ok(live('freeze') > live('none'), 'ice shards on top of the sparks');
  assert.ok(live('frenzy') > live('none'), 'flame wisps');
  assert.ok(live('double') > live('none'), 'glints');
  assert.ok(live('freeze') <= 24 + 40);
  const ctx = new FakeContext({});
  const trail = createTrail();
  trail.setAura({ powerup: 'frenzy', k: 1 });
  trail.update(makeBlade({ samples: run(1000, 12, 8), cutting: true, speed: 2000, head: null }), 1000);
  trail.draw(ctx);
  const widths = new Set();
  const strokes = ctx.calls.filter((c) => c[0] === 'stroke').length;
  assert.ok(strokes >= 5, 'the flame polyline adds two strokes');
  assert.deepEqual(ctx.forbidden, []);
  widths.clear();
});

test('nothing is drawn for fewer than two points', () => {
  const ctx = new FakeContext({});
  const trail = createTrail();
  trail.update(makeBlade({ samples: [bladeSample({ t: 1000 })], head: null }), 1000);
  trail.draw(ctx);
  assert.equal(ctx.calls.length, 0);
});

test('cursor: idle ring, cutting disc 22 -> 26 px over 60 ms, tracking lost = alpha 0.35 + three dots, dwell arc, recenter pulse', () => {
  const trail = createTrail();
  const view = makeBlade({ cutting: false, head: { x: 400, y: 300 } });
  trail.updateCursor(view, 0.016, {});
  const ring = new FakeContext({});
  trail.drawCursor(ring);
  assert.equal(ring.counts.arc, 2, 'ring + centre dot');
  assert.equal(ring.calls.filter((c) => c[0] === 'arc')[0][3], CONFIG.cursor.ringR);
  // cutting
  const cutting = makeBlade({ cutting: true, speed: 2000, head: { x: 400, y: 300 } });
  trail.updateCursor(cutting, 0, {});
  assert.equal(trail.cutDiscRadius(), 22);
  trail.updateCursor(cutting, 0.03, {});
  assert.ok(Math.abs(trail.cutDiscRadius() - 24) < 1e-9);
  trail.updateCursor(cutting, 0.05, {});
  assert.equal(trail.cutDiscRadius(), 26);
  const disc = new FakeContext({});
  trail.drawCursor(disc);
  assert.equal(disc.counts.arc, 1);
  // tracking lost
  trail.updateCursor(makeBlade({ trackingOk: false, head: { x: 400, y: 300 } }), 0.016, {});
  const lost = new FakeContext({});
  trail.drawCursor(lost);
  assert.equal(lost.counts.arc, 2 + 3, 'three small dots under the ring');
  // dwell progress arc grows around the ring
  trail.updateCursor(view, 0.016, { dwell: 0.5 });
  const dwell = new FakeContext({});
  trail.drawCursor(dwell);
  const arcs = dwell.calls.filter((c) => c[0] === 'arc');
  assert.equal(arcs.length, 3);
  assert.ok(Math.abs(arcs[2][5] - arcs[2][4] - Math.PI) < 1e-9, 'half a turn at 50%');
  // recenter pulse shrinks the ring
  trail.updateCursor(view, 0.016, { pulse: 0.6 });
  const pulse = new FakeContext({});
  trail.drawCursor(pulse);
  assert.ok(Math.abs(pulse.calls.filter((c) => c[0] === 'arc')[0][3] - CONFIG.cursor.ringR * 0.6) < 1e-9);
});

test('no cursor without a position', () => {
  const trail = createTrail();
  trail.updateCursor(makeBlade({ head: null, latest: null }), 0.016, {});
  const ctx = new FakeContext({});
  trail.drawCursor(ctx);
  assert.equal(ctx.calls.length, 0);
});
