// Hit areas (owner feedback after the first real Joy-Con session: "the hitbox of the fruit seems a bit too small").
// hitR = round(r * hitMul[kind]) + hit.bladeHalfWidth[kind]: a proportional part and a constant part (a capsule: the blade chord is as wide
// as its drawn trail). The bomb stays strict. docs/game-design.md 4.1 to 4.4 and 5.3, docs/contract-notes.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/index.js';
import { hitRadius, hitCircleRadius, bladeHalfWidth } from '../../public/js/game/physics.js';
import { segmentHitsCircle } from '../../public/js/game/slicing.js';
import { createHarness } from '../../test-support/game/helpers.js';
import { measureBody } from '../../test-support/game/sprite-bodies.js';

const OLD_MUL = 1.25; // the hit multiplier of every fruit before this change (hitR = round(r * 1.25), no blade half width)
const FRUITS = CONFIG.fruits.map((f) => ({ kind: 'fruit', type: f.id, r: f.r }));
const GOLDEN = { kind: 'golden', type: 'golden', r: CONFIG.golden.r };
const MEDALLIONS = Object.keys(CONFIG.powerups).filter((k) => CONFIG.powerups[k].r).map((id) => ({ kind: 'powerup', type: id, r: CONFIG.powerups[id].r }));

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

test('the capsule rule: a chord cuts a fruit, the Golden Apple and a medallion exactly up to round(r x mul) + blade half width', () => {
  for (const spec of [...FRUITS, GOLDEN, ...MEDALLIONS.filter((m) => m.type !== 'clock')]) {
    const reach = hitCircleRadius(spec.kind, spec.r) + bladeHalfWidth(spec.kind);
    assert.equal(hitRadius(spec.kind, spec.r), reach, `${spec.type}: hitR is circle plus half width`);
    assert.equal(bladeHalfWidth(spec.kind), 14, `${spec.type}: half width`);
    const shot = (offset) => {
      const h = createHarness('zen', 1, undefined, { waves: false });
      h.spawn({ kind: spec.kind, type: spec.type, apexX: 900, apexY: 400 });
      h.cut(0, 400 + offset, 1900, 400 + offset); // a long horizontal chord, `offset` px below the centre
      return h.ofType('cut').length + h.ofType('powerup').length;
    };
    assert.equal(shot(reach), 1, `${spec.type}: exactly hitR (${reach}) cuts`);
    assert.equal(shot(-reach), 1, `${spec.type}: exactly hitR on the other side cuts`);
    assert.equal(shot(reach + 0.5), 0, `${spec.type}: hitR + 0.5 misses`);
    // the two parts: a chord at the old circle plus the half width still cuts, one pixel beyond does not
    assert.equal(shot(hitCircleRadius(spec.kind, spec.r) + 14), 1);
    assert.equal(shot(hitCircleRadius(spec.kind, spec.r) + 15), 0);
  }
  // the half width is never wider than what the player sees: the drawn blade trail is blade.headWidth.max wide at full speed
  assert.ok(CONFIG.hit.bladeHalfWidth.fruit <= CONFIG.blade.headWidth.max / 2);
  assert.ok(CONFIG.hit.bladeHalfWidth.golden <= CONFIG.blade.headWidth.max / 2);
  assert.ok(CONFIG.hit.bladeHalfWidth.powerup <= CONFIG.blade.headWidth.max / 2);
});

test('the snapshot reports the effective hit radius of every object (the debug overlay draws exactly that circle)', () => {
  const h = createHarness('classic', 1, undefined, { waves: false });
  const specs = [...FRUITS, GOLDEN, { kind: 'bomb', type: 'bomb', r: CONFIG.bomb.r }, ...MEDALLIONS];
  specs.forEach((s, i) => h.spawn({ kind: s.kind, type: s.type, apexX: 200 + i * 100, apexY: 300 + (i % 4) * 40 }));
  const objects = h.snap().objects;
  assert.equal(objects.length, specs.length);
  for (const o of objects) {
    assert.equal(o.hitR, hitRadius(o.kind, o.r), `${o.kind}:${o.type}`);
  }
  assert.equal(objects.find((o) => o.kind === 'bomb').hitR, 54);
  assert.equal(objects.find((o) => o.type === 'cherry').hitR, 88);
});

test('proportional: the multiplier part grows with the fruit, and the constant part gives the SMALL fruit the larger relative bonus', () => {
  const small = [...FRUITS].sort((a, b) => a.r - b.r); // cherry first
  for (const f of small) {
    const circle = hitCircleRadius('fruit', f.r);
    assert.ok(Math.abs(circle / f.r - CONFIG.hitMul.fruit) <= 0.5 / f.r + 1e-9, `${f.type}: the circle is proportional to r (x${CONFIG.hitMul.fruit})`);
    assert.equal(hitRadius('fruit', f.r) - circle, 14, `${f.type}: the same constant part for everybody`);
    const oldHitR = Math.round(f.r * OLD_MUL);
    assert.ok(hitRadius('fruit', f.r) >= oldHitR + 28, `${f.type}: clearly bigger than before (${oldHitR} to ${hitRadius('fruit', f.r)})`);
  }
  // walking from the smallest fruit to the biggest, the hit radius in units of r only ever shrinks (a constant bonus weighs less on a big
  // fruit), and so does the bonus 14 / r; the gain over the old radius shrinks too, up to the rounding of the old radius (0.01)
  for (let i = 1; i < small.length; i++) {
    const a = small[i - 1];
    const b = small[i];
    assert.ok(hitRadius('fruit', a.r) / a.r >= hitRadius('fruit', b.r) / b.r - 1e-9, `hitR / r: ${a.type} against ${b.type}`);
    assert.ok(14 / a.r >= 14 / b.r - 1e-9);
    const gainA = hitRadius('fruit', a.r) / Math.round(a.r * OLD_MUL);
    const gainB = hitRadius('fruit', b.r) / Math.round(b.r * OLD_MUL);
    assert.ok(gainA >= gainB - 0.01, `gain over the old radius: ${a.type} ${gainA.toFixed(3)} against ${b.type} ${gainB.toFixed(3)}`);
  }
  const cherry = FRUITS.find((f) => f.type === 'cherry');
  const watermelon = FRUITS.find((f) => f.type === 'watermelon');
  assert.ok(hitRadius('fruit', cherry.r) / cherry.r > hitRadius('fruit', watermelon.r) / watermelon.r + 0.1, 'cherry 1.83 r against watermelon 1.71 r');
  assert.ok(hitRadius('fruit', cherry.r) / Math.round(cherry.r * OLD_MUL) > hitRadius('fruit', watermelon.r) / Math.round(watermelon.r * OLD_MUL) + 0.05, 'cherry x1.47 against watermelon x1.37');
  // the big fruit still gain more pixels: the area scales with the fruit
  assert.ok(hitRadius('fruit', watermelon.r) - Math.round(watermelon.r * OLD_MUL) > hitRadius('fruit', cherry.r) - Math.round(cherry.r * OLD_MUL));
});

test('the bomb stays strict: no blade half width, the old 0.85 x r, a graze that cuts a neighbouring fruit does not explode it', () => {
  assert.equal(CONFIG.hit.bladeHalfWidth.bomb, 0);
  assert.equal(CONFIG.hitMul.bomb, 0.85);
  assert.equal(hitRadius('bomb', CONFIG.bomb.r), 54);
  assert.equal(hitRadius('bomb', CONFIG.bomb.r), Math.round(CONFIG.bomb.r * 0.85));
  // a bomb needs real contact: 54 hits, 54.5 does not (no capsule)
  const bombShot = (offset) => {
    const h = createHarness('classic', 1, undefined, { waves: false });
    h.spawn({ kind: 'bomb', apexX: 900, apexY: 400 });
    h.cut(0, 400 + offset, 1900, 400 + offset);
    return h.ofType('bomb').length;
  };
  assert.equal(bombShot(54), 1);
  assert.equal(bombShot(54.5), 0);
  assert.equal(bombShot(54 + 14), 0, 'the fruit half width does not apply to the bomb');
  // a swing that only just cuts an apple on its side towards the bomb (119 px) passes 280 px - 119 px = 161 px from a bomb at the preferred separation
  const h = createHarness('classic', 1, undefined, { waves: false });
  h.spawn({ kind: 'fruit', type: 'apple', apexX: 700, apexY: 400 });
  h.spawn({ kind: 'bomb', apexX: 700 + CONFIG.field.bombSeparationX, apexY: 400 });
  h.cut(700 + 119, 0, 700 + 119, 1000); // a vertical chord that grazes the apple at exactly its hit radius
  assert.equal(h.ofType('cut').length, 1, 'the apple is cut');
  assert.equal(h.ofType('bomb').length, 0, 'the bomb is not');
  assert.equal(h.ofType('nearMiss').length, 0, 'and it is not even a near miss');
  // the fruit and the bomb are not tied together by one big radius either: a chord that reaches the BOMB (54 px) cuts the apple only
  // when it is also within the apple's reach, which is the same geometry as before for the bomb
  const bombWithApple = (gap) => {
    const g = createHarness('classic', 1, undefined, { waves: false });
    g.spawn({ kind: 'fruit', type: 'apple', apexX: 700, apexY: 400 });
    g.spawn({ kind: 'bomb', apexX: 700 + gap, apexY: 400 });
    g.cut(700 + gap / 2, 0, 700 + gap / 2, 1000); // a vertical chord midway between them
    return [g.ofType('cut').length, g.ofType('bomb').length];
  };
  assert.deepEqual(bombWithApple(2 * 119 + 2), [0, 0], 'a chord midway between an apple and a bomb 240 px away touches neither');
  assert.deepEqual(bombWithApple(100), [1, 1], 'a chord between two touching objects hits both');
});

test('the bomb near-miss band and the bomb separation stay consistent with the new fruit sizes', () => {
  const largest = Math.max(...FRUITS.map((f) => hitRadius('fruit', f.r)));
  assert.equal(largest, 157, 'the watermelon');
  // a swing that just reaches the biggest neighbour fruit passes at least nearMissPx from the bomb centre
  assert.ok(CONFIG.field.bombSeparationX - largest >= CONFIG.bomb.nearMissPx, `${CONFIG.field.bombSeparationX} - ${largest} >= ${CONFIG.bomb.nearMissPx}`);
  assert.equal(CONFIG.bomb.nearMissPx, 120, 'the near-miss band belongs to the bomb and did not change');
  assert.ok(CONFIG.field.bombSeparationMinX < CONFIG.field.bombSeparationX);
  // the near miss itself: a pass at 100 px (inside the 120 px band, outside hitR 54) of a bomb still triggers it, as before
  const h = createHarness('classic', 1, undefined, { waves: false });
  h.spawn({ kind: 'bomb', apexX: 900, apexY: 400 });
  h.step(1 / 60);
  h.cut(0, 500, 1900, 500, { speed: 3000 }); // 100 px below the bomb, a long pass
  assert.equal(h.ofType('bomb').length, 0);
  assert.equal(h.ofType('nearMiss').length, 1);
});

test('neighbours: formation spacing keeps the cut regions of average neighbours apart, and a chord through one does not cut the other', () => {
  // LINE: twice the hitR of an average fruit (r 68 -> 119) is 238 px; the spacing is at least that for 3, 4 and 5 fruit
  for (const n of [3, 4, 5]) assert.ok(CONFIG.spawn.line.spacing[n] >= 2 * hitRadius('fruit', 68), `LINE of ${n}: ${CONFIG.spawn.line.spacing[n]}`);
  // PAIR: two DISTINCT types 300 px apart: the two biggest (watermelon and pineapple) just do not overlap
  const [a, b] = [...FRUITS].sort((x, y) => y.r - x.r);
  assert.ok(2 * CONFIG.spawn.pair.offset >= hitRadius('fruit', a.r) + hitRadius('fruit', b.r) - 2, `${2 * CONFIG.spawn.pair.offset} vs ${hitRadius('fruit', a.r) + hitRadius('fruit', b.r)}`);
  // two apples at the smallest LINE spacing: a vertical chord through one centre cuts one, a vertical chord midway cuts neither
  const gap = CONFIG.spawn.line.spacing[5];
  const run = (x) => {
    const h = createHarness('zen', 1, undefined, { waves: false });
    h.spawn({ kind: 'fruit', type: 'apple', apexX: 800, apexY: 400 });
    h.spawn({ kind: 'fruit', type: 'apple', apexX: 800 + gap, apexY: 400 });
    h.cut(x, 0, x, 1000);
    return h.ofType('cut').length;
  };
  assert.equal(run(800), 1, 'through the first apple');
  assert.equal(run(800 + gap), 1, 'through the second apple');
  assert.equal(run(800 + gap / 2), 0, `midway between them (${gap / 2} px from each centre, hitR 119)`);
  assert.equal(run(800 + gap / 2 - 1), 1, 'one pixel towards the first: exactly its hit radius');
});

// ---- against the drawn art -----------------------------------------------------------------------------------------------------------

const BODIES = [
  ...FRUITS.map((f) => ({ ...f, asset: `fruit_${f.type}_whole`, opts: {} })),
  { ...GOLDEN, asset: 'fruit_golden_whole', opts: { golden: true } },
  { kind: 'powerup', type: 'freeze', r: CONFIG.powerups.freeze.r, asset: 'medallion_freeze', opts: {} },
].map((b) => ({ ...b, body: measureBody(b.asset, b.r, b.opts) }));
const HAVE_ART = BODIES.every((b) => b.body !== null);
const artTest = HAVE_ART ? test : test.skip;

artTest('a stroke through the VISIBLE body of a fruit, the Golden Apple or a medallion always cuts it (measured on the sprites)', () => {
  const rnd = lcg(20260930);
  for (const b of BODIES) {
    const reach = hitRadius(b.kind, b.r);
    assert.ok(b.body.farthest <= reach, `${b.type}: the farthest body pixel (${b.body.farthest.toFixed(1)} px) lies inside hitR ${reach}`);
    // random chords of random length and angle through a random body pixel
    for (let i = 0; i < 4000; i++) {
      const [px, py] = b.body.pixels[Math.floor(rnd() * b.body.pixels.length)];
      const ang = rnd() * Math.PI;
      const half = 20 + rnd() * 900;
      const seg = { x0: px - Math.cos(ang) * half, y0: py - Math.sin(ang) * half, x1: px + Math.cos(ang) * half, y1: py + Math.sin(ang) * half };
      assert.ok(segmentHitsCircle(seg, 0, 0, reach), `${b.type}: a chord through the visible body at (${px.toFixed(1)}, ${py.toFixed(1)}) must cut`);
    }
  }
});

artTest('a stroke that passes within 20 px of the visible edge of a fruit also cuts it, at every angle (measured on the sprites)', () => {
  for (const b of BODIES) {
    const reach = hitRadius(b.kind, b.r);
    for (let deg = 0; deg < 360; deg += 2) {
      const a = (deg * Math.PI) / 180;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      let pmax = -Infinity;
      for (const [px, py] of b.body.pixels) pmax = Math.max(pmax, px * nx + py * ny);
      const d = pmax + 20; // 20 px outside the visible body, measured along the normal
      const seg = { x0: nx * d - ny * 1500, y0: ny * d + nx * 1500, x1: nx * d + ny * 1500, y1: ny * d - nx * 1500 }; // a long chord perpendicular to n
      assert.ok(segmentHitsCircle(seg, 0, 0, reach), `${b.type} at ${deg} degrees: ${d.toFixed(1)} px from the centre against hitR ${reach}`);
    }
    // and the reach is not absurd: at most 2.1 body radii (the old reach was 1.25 to 1.45)
    assert.ok(reach <= 2.1 * b.body.bodyRadius, `${b.type}: hitR ${reach} against a visible body radius of ${b.body.bodyRadius.toFixed(1)}`);
    assert.ok(reach >= 1.6 * b.body.bodyRadius, `${b.type}: hitR ${reach} is at least 1.6 body radii (${b.body.bodyRadius.toFixed(1)})`);
  }
});

artTest('the bomb needs real contact: its hit circle lies inside the visible body of the sprite', () => {
  const bomb = measureBody('bomb_whole', CONFIG.bomb.r);
  assert.ok(bomb);
  assert.ok(hitRadius('bomb', CONFIG.bomb.r) < bomb.nearestOutside, `hitR 54 against the nearest edge of the bomb at ${bomb.nearestOutside.toFixed(1)} px`);
});
