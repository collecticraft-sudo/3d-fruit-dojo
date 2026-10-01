// fx.js: particle pool, splats, popups, banners, shake, flash limiter, vignettes, degrade (docs/game-design.md 9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../public/js/game/config.js';
import { BURST, PK, ParticlePool, createFx, createPerfGovernor } from '../../public/js/render/fx.js';
import { assertValid } from '../../public/js/shared/validate.js';
import { bombEvent, comboEvent, cutEvent, gameOverEvent, lifeLostEvent, makeHalf, makeObject, makeSnapshot, missEvent, nearMissEvent, powerupEvent, tickEvent, timeBonusEvent, timeUpEvent } from '../../test-support/ui/fixtures.js';

const mk = (settings = {}) => {
  const fx = createFx();
  fx.reset(1);
  fx.setSettings({ reduceFlash: false, reduceMotion: false, ...settings });
  return fx;
};
const advance = (fx, seconds, snap = null, step = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += step) fx.update(step, step, snap);
};
const comboUpdate = (n, over = {}) => comboEvent({ phase: 'update', n, bonus: 0, ...over });

test('ParticlePool: capacity, oldest-first eviction, slot reuse', () => {
  const pool = new ParticlePool(400);
  for (let i = 0; i < 400; i++) pool.spawn(PK.DROPLET, i, 0, 0, 0, 5, 3, 0);
  assert.equal(pool.count, 400);
  const firstSeq = Math.min(...Array.from(pool.seq));
  const slotOfOldest = Array.from(pool.seq).indexOf(firstSeq);
  const slot = pool.spawn(PK.DROPLET, 999, 0, 0, 0, 5, 3, 0);
  assert.equal(pool.count, 400, 'never exceeds the cap');
  assert.equal(slot, slotOfOldest, 'the oldest particle is the one that was dropped');
  assert.equal(pool.x[slot], 999);
  assert.equal(pool.dropped, 1);
  pool.kill(5);
  assert.equal(pool.count, 399);
  const again = pool.spawn(PK.SPARK, 1, 2, 0, 0, 1, 1, 0);
  assert.equal(again, 5, 'freed slots are reused before anything is evicted');
  pool.clear();
  assert.equal(pool.count, 0);
});

test('ParticlePool.update: life, gravity, drag and the floor', () => {
  const pool = new ParticlePool(8);
  const a = pool.spawn(PK.DROPLET, 0, 0, 100, 0, 1, 3, 0, 1);
  const b = pool.spawn(PK.SPARK, 0, 0, 1000, 0, 1, 1, 0, 0);
  const c = pool.spawn(PK.DROPLET, 0, 2000, 0, 500, 5, 3, 0, 1);
  pool.update(0.5, 1300, 1340);
  assert.ok(pool.vy[a] > 600, 'gravity applies');
  assert.ok(pool.vx[b] < 1000, 'sparks lose speed');
  assert.equal(pool.alive[c], 0, 'falling below the floor kills the particle');
  pool.update(0.6, 1300, 1340);
  assert.equal(pool.count, 0, 'life expired');
});

test('a fruit cut spawns 18 droplets + 3 streaks + 8 flecks (29 particles), one decal, one slash mark and a popup (all seeded)', () => {
  const fx = mk();
  fx.handleEvent(cutEvent());
  const kinds = Array.from(fx.particles.kind).filter((_, i) => fx.particles.alive[i]);
  assert.equal(kinds.filter((k) => k === PK.DROPLET).length, 18);
  assert.equal(kinds.filter((k) => k === PK.STREAK).length, 3);
  assert.equal(kinds.filter((k) => k === PK.FLECK_SQ || k === PK.FLECK_CIRCLE).length, 8);
  assert.equal(fx.particles.count, 29, 'at most 30 new particles per cut (direction 2.1)');
  const c = fx.activeCounts();
  assert.equal(c.splats, 1);
  assert.equal(c.slashes, 1);
  assert.equal(c.popups, 1);
  assert.equal(fx.popups.find((p) => p.active).text, '+15');
  for (let i = 0; i < fx.particles.capacity; i++) {
    if (fx.particles.alive[i] && fx.particles.kind[i] === PK.DROPLET) assert.ok(fx.particles.size[i] >= 4 && fx.particles.size[i] <= 10, 'droplet radius 4 to 10 px');
  }
});

test('droplets: 80% of them fly inside a 50 degree cone around the blade normal (either side)', () => {
  const fx = mk();
  const ev = cutEvent({ angleRad: 0, nx: 0, ny: 1 });
  for (let i = 0; i < 40; i++) fx.handleEvent(ev);
  const p = fx.particles;
  let inCone = 0;
  let total = 0;
  for (let i = 0; i < p.capacity; i++) {
    if (!p.alive[i] || p.kind[i] !== PK.DROPLET) continue;
    total++;
    const ang = Math.atan2(p.vy[i], p.vx[i]);
    const off = Math.min(Math.abs(ang - Math.PI / 2), Math.abs(ang + Math.PI / 2));
    if (off <= (25 * Math.PI) / 180 + 1e-6) inCone++;
  }
  assert.ok(total > 100);
  assert.ok(inCone / total > 0.75, `cone share ${inCone / total}`);
});

test('decal: hold 1.0 s at full alpha (0.6), then linear fade to 0 over 2.5 s (3.5 s total; design 9.2 says 1.5 + 4.5, direction 2.1 shortens it)', () => {
  const fx = mk();
  fx.handleEvent(cutEvent());
  const s = fx.splats.find((x) => x.active);
  advance(fx, 0.95);
  assert.ok(Math.abs(fx.splatAlpha(s) - 0.6) < 1e-9);
  advance(fx, 1.3); // age 2.25 = 1.0 + 1.25 -> halfway through the fade
  assert.ok(Math.abs(fx.splatAlpha(s) - 0.3) < 0.02, `alpha ${fx.splatAlpha(s)}`);
  advance(fx, 1.3);
  assert.equal(s.active, false, 'gone after 3.5 s');
});

test('splats age in WORLD time: frozen while the world is frozen', () => {
  const fx = mk();
  fx.handleEvent(cutEvent());
  for (let i = 0; i < 600; i++) fx.update(1 / 60, 0, null);
  assert.equal(fx.activeCounts().splats, 1);
  assert.ok(fx.splats.find((x) => x.active).age === 0);
});

test('splat cap 24 (12 after degrade level 2); the oldest fades out over 300 ms instead of vanishing', () => {
  const fx = mk();
  for (let i = 0; i < 30; i++) fx.handleEvent(cutEvent({ x: 100 + i * 10 }));
  const fading = fx.splats.filter((s) => s.active && s.evict >= 0);
  const solid = fx.splats.filter((s) => s.active && s.evict < 0);
  assert.equal(solid.length, CONFIG.caps.splats);
  assert.ok(fading.length >= 1 && fading.every((s) => s.evict <= 0.3 + 1e-9));
  advance(fx, 0.35);
  assert.equal(fx.splats.filter((s) => s.active && s.evict >= 0).length, 0);
  fx.setDegradeLevel(2);
  advance(fx, 0.35);
  assert.equal(fx.splats.filter((s) => s.active).length, 12);
  for (let i = 0; i < 5; i++) fx.handleEvent(cutEvent());
  advance(fx, 0.35);
  assert.ok(fx.splats.filter((s) => s.active && s.evict < 0).length <= 12);
});

test('popups: cap 12 (oldest dropped) and the 60 px separation rule alternates sides', () => {
  const fx = mk();
  fx.handleEvent(cutEvent({ x: 900, y: 500 }));
  fx.handleEvent(cutEvent({ x: 905, y: 505, id: 2 }));
  fx.handleEvent(cutEvent({ x: 900, y: 500, id: 3 }));
  const xs = fx.popups.filter((p) => p.active).sort((a, b) => a.seq - b.seq).map((p) => p.x);
  assert.deepEqual(xs, [900, 955, 850], 'first shift goes right by 50 px, the next one left');
  for (let i = 0; i < 30; i++) fx.handleEvent(cutEvent({ x: 100 + i * 60, y: 300 + i * 20 }));
  assert.equal(fx.activeCounts().popups, CONFIG.caps.popups);
});

test('popup curves: base popup rises 90 px in 800 ms (alpha 1 until 520 ms); combo bonus rises 110 px in 1.0 s on a gold banner look', () => {
  const fx = mk();
  fx.handleEvent(cutEvent());
  const p = fx.popups.find((q) => q.active);
  assert.ok(Math.abs(p.dx) <= 14, 'x drift within +-14 px');
  fx.update(0.4, 0.4, null);
  assert.equal(fx.popupView(p).alpha, 1);
  fx.update(0.29, 0.29, null);
  const v = fx.popupView(p);
  assert.ok(v.dy < -85 && v.dy >= -90, `dy ${v.dy}`);
  assert.ok(v.alpha < 0.5);
  fx.update(0.15, 0.15, null);
  assert.equal(fx.activeCounts().popups, 0);
  fx.handleEvent(comboEvent({ n: 4, bonus: 60 }));
  const cp = fx.popups.find((q) => q.active);
  assert.equal(cp.text, '+60');
  assert.equal(cp.label, 'COMBO');
  assert.equal(cp.rise, 110);
  assert.equal(cp.dur, 1);
  assert.equal(cp.tint, 'gold');
  assert.equal(cp.size, 72);
});

test('popup pop: 0.5 to 1.15 in 100 ms, settles to 1.0 by 180 ms; Double makes it gold; penalties do not pop and rise 60 px', () => {
  const fx = mk();
  fx.handleEvent(cutEvent());
  const p = fx.popups.find((q) => q.active);
  assert.ok(Math.abs(fx.popupView(p).scale - 0.5) < 1e-9);
  fx.update(0.1, 0.1, null);
  assert.ok(Math.abs(fx.popupView(p).scale - 1.15) < 1e-6);
  fx.update(0.08, 0.08, null);
  assert.ok(Math.abs(fx.popupView(p).scale - 1) < 1e-6);
  const d = mk();
  d.handleEvent(cutEvent({ doubled: true, points: 30 }));
  assert.equal(d.popups.find((q) => q.active).tint, 'gold');
  const m = mk();
  m.handleEvent(missEvent({ costsLife: true }));
  const pen = m.popups.find((q) => q.active);
  assert.equal(pen.kind, 'penalty');
  assert.equal(pen.rise, 60);
  assert.equal(m.popupView(pen).scale, 1, 'no pop overshoot');
});

test('reduceMotion: popups do not rise or pop, they fade in place over 700 ms', () => {
  const fx = mk({ reduceMotion: true });
  fx.handleEvent(cutEvent());
  const p = fx.popups.find((q) => q.active);
  fx.update(0.35, 0.35, null);
  const v = fx.popupView(p);
  assert.equal(v.dy, 0);
  assert.equal(v.dx, 0);
  assert.equal(v.scale, 1);
  assert.ok(v.alpha > 0.4 && v.alpha < 0.65, `alpha ${v.alpha}`);
});

test('BOMB! banner: slams in 40 ms after the hit (scale 2.0 to 1.0 in 140 ms), holds 700 ms, fades in 200 ms; penalty popups for score and time', () => {
  const fx = mk();
  fx.handleEvent(bombEvent({ scoreDelta: -50, timeDeltaS: -5, x: 960, y: 500 }));
  const texts = fx.popups.filter((p) => p.active).map((p) => p.text);
  assert.ok(texts.includes('−50'));
  assert.ok(texts.includes('−5 s'));
  const b = fx.banners.find((q) => q.active && q.kind === 'bomb');
  assert.equal(b.text, 'BOMB!');
  assert.equal(b.size, 160);
  assert.equal(b.tint, 'vermilion');
  assert.equal(fx.bannerView(b).alpha, 0, 'not yet visible during the first 40 ms');
  fx.update(0.04, 0.04, null);
  assert.ok(Math.abs(fx.bannerView(b).scale - 2) < 1e-9, 'starts at 2.0');
  fx.update(0.14, 0.14, null);
  assert.ok(Math.abs(fx.bannerView(b).scale - 1) < 1e-9);
  fx.update(0.5, 0.5, null);
  assert.equal(fx.bannerView(b).alpha, 1);
  fx.update(0.26, 0.26, null); // 0.04 + 0.14 + 0.5 + 0.26: the fade has started
  assert.ok(fx.bannerView(b).alpha < 0.8);
  fx.update(0.2, 0.2, null);
  assert.equal(b.active, false);
  const edge = mk();
  edge.handleEvent(bombEvent({ x: 20, y: 1070 }));
  const e = edge.banners.find((q) => q.active);
  assert.equal(e.x, 200);
  assert.equal(e.y, 880, 'clamped inside 200 px of every edge');
});

test('a bomb time penalty is shown once even when both bomb and timeBonus(bomb) events arrive', () => {
  const fx = mk();
  fx.handleEvent(bombEvent({ timeDeltaS: -5 }));
  fx.handleEvent(timeBonusEvent({ cause: 'bomb', deltaS: -5 }));
  assert.equal(fx.popups.filter((p) => p.active && p.text === '−5 s').length, 1);
  const fx2 = mk();
  fx2.handleEvent(timeBonusEvent({ cause: 'clock', deltaS: 4 }));
  assert.equal(fx2.popups.find((p) => p.active).text, '+4 s');
});

test('shake takes the MAXIMUM amplitude, never the sum', () => {
  const fx = mk();
  fx.handleEvent(bombEvent()); // 22 px
  fx.handleEvent(comboUpdate(8)); // 12 px
  fx.handleEvent(comboUpdate(5)); // 8 px
  fx.update(0.001, 0.001, null);
  assert.ok(fx.shakeOffset.amp <= CONFIG.juice.shake.bomb[0] + 1e-6);
  assert.ok(fx.shakeOffset.amp > 20, `amp ${fx.shakeOffset.amp}`);
  assert.ok(Math.abs(fx.shakeOffset.x) <= 22 && Math.abs(fx.shakeOffset.y) <= 22);
  // after the bomb shake (500 ms) is over, nothing of the smaller ones remains either (they were shorter)
  advance(fx, 0.6);
  assert.equal(fx.shakeOffset.amp, 0);
});

test('shake decays linearly and reduceMotion disables shake, zoom punch and hit effects', () => {
  const fx = mk();
  fx.handleEvent(bombEvent());
  fx.update(0.25, 0.25, null);
  assert.ok(Math.abs(fx.shakeOffset.amp - 11) < 0.3, `half-way amplitude ${fx.shakeOffset.amp}`);
  const quiet = mk({ reduceMotion: true });
  quiet.handleEvent(bombEvent());
  quiet.handleEvent(comboUpdate(5));
  quiet.update(0.01, 0.01, null);
  assert.equal(quiet.shakeOffset.amp, 0);
  assert.equal(quiet.zoom.scale, 1);
});

test('zoom punch: 1.00 -> 1.03 in 60 ms and back in 240 ms', () => {
  const fx = mk();
  fx.handleEvent(comboUpdate(5));
  fx.update(0.06, 0.06, null);
  assert.ok(Math.abs(fx.zoom.scale - 1.03) < 1e-6);
  fx.update(0.24, 0.24, null);
  assert.equal(fx.zoom.scale, 1);
});

test('FLASH LIMITER: two bomb hits 300 ms apart produce ONE full-screen flash; 600 ms apart produce two', () => {
  const fx = mk();
  fx.handleEvent(bombEvent());
  advance(fx, 0.3);
  fx.handleEvent(bombEvent({ id: 10 }));
  assert.equal(fx.state.flashCount, 1);
  assert.equal(fx.state.flashRejected, 1);
  assert.equal(fx.flashes.filter((f) => f.active).length, 1);
  advance(fx, 0.31);
  fx.handleEvent(bombEvent({ id: 11 }));
  assert.equal(fx.state.flashCount, 2);
});

test('flash limits: alpha <= 0.6, at least 80 ms in and 250 ms out; other flash sources share the limiter', () => {
  const fx = mk();
  fx.handleEvent(bombEvent());
  const f = fx.flashes.find((x) => x.active);
  assert.ok(f.peak <= CONFIG.juice.flash.maxAlpha);
  assert.ok(f.inS >= 0.08 && f.outS >= 0.25);
  fx.handleEvent(powerupEvent({ powerupId: 'freeze' })); // 0 ms later: rejected
  assert.equal(fx.state.flashCount, 1);
  advance(fx, 0.6);
  fx.handleEvent(powerupEvent({ powerupId: 'frenzy' }));
  assert.equal(fx.state.flashCount, 2);
  fx.update(0.04, 0.04, null);
  assert.ok(fx.maxFlashAlpha() > 0 && fx.maxFlashAlpha() <= 0.6);
});

test('reduceFlash: no full-screen overlay at all, vignettes instead; rings and slash marks are toned down', () => {
  const fx = mk({ reduceFlash: true });
  fx.handleEvent(bombEvent());
  fx.handleEvent(powerupEvent({ powerupId: 'freeze' }));
  fx.handleEvent(cutEvent({ kind: 'golden', objType: 'golden' }));
  assert.equal(fx.state.flashCount, 0);
  assert.equal(fx.flashes.filter((f) => f.active).length, 0);
  assert.ok(fx.vignettes.some((v) => v.active));
  const bombVig = fx.vignettes.find((v) => v.active);
  assert.ok(bombVig.peak <= 0.18 + 1e-9, 'ink-red vignette alpha 0.18');
  const slash = fx.slashes.find((s) => s.active);
  assert.equal(slash.alpha, 0.5);
  assert.equal(slash.dur, 0.2);
  assert.equal(fx.timerPulseScale(), 1);
});

test('reduceFlash replaces the combo ink stars with one soft ring', () => {
  const fx = mk();
  fx.handleEvent(comboUpdate(4));
  assert.ok(Array.from(fx.particles.kind).filter((k, i) => fx.particles.alive[i] && k === PK.STAR).length >= 20);
  const quiet = mk({ reduceFlash: true });
  quiet.handleEvent(comboUpdate(4));
  assert.equal(Array.from(quiet.particles.kind).filter((k, i) => quiet.particles.alive[i] && k === PK.STAR).length, 0);
  assert.ok(quiet.rings.some((r) => r.active));
});

test('reduceMotion halves particle counts (droplets 9, streaks 2, flecks 4) and slows them to x0.7; degrade 1 halves again', () => {
  const normal = mk();
  normal.handleEvent(cutEvent());
  const calm = mk({ reduceMotion: true });
  calm.handleEvent(cutEvent());
  assert.equal(normal.particles.count, 29);
  assert.equal(calm.particles.count, 15);
  const speed = (fx) => {
    let s = 0;
    let n = 0;
    for (let i = 0; i < fx.particles.capacity; i++) if (fx.particles.alive[i] && fx.particles.kind[i] === PK.DROPLET) { s += Math.hypot(fx.particles.vx[i], fx.particles.vy[i]); n++; }
    return s / n;
  };
  assert.ok(speed(calm) < speed(normal), 'reduced motion slows the droplets');
  const degraded = mk();
  degraded.setDegradeLevel(1);
  degraded.handleEvent(cutEvent());
  assert.equal(degraded.particles.count, 15);
});

test('bomb explosion: 40 sparks, 28 smoke puffs, 12 ink droplets, two shock rings (the second 90 ms late), soot decal, red vignette with a hold, one flash', () => {
  const fx = mk();
  fx.handleEvent(bombEvent());
  const kinds = Array.from(fx.particles.kind).filter((_, i) => fx.particles.alive[i]);
  assert.equal(kinds.filter((k) => k === PK.SPARK).length, 40);
  assert.equal(kinds.filter((k) => k === PK.SMOKE).length, 28);
  assert.equal(kinds.filter((k) => k === PK.DROPLET).length, 12);
  const rings = fx.rings.filter((r) => r.active);
  assert.equal(rings.length, 2);
  assert.equal(rings[0].r1, 420);
  assert.equal(rings[1].r1, 300);
  assert.ok(rings[1].age < 0 && Math.abs(rings[1].age + 0.09) < 1e-9, 'the second ring starts 90 ms later');
  const soot = fx.splats.find((s) => s.active && s.soot);
  assert.ok(soot);
  assert.equal(fx.state.flashCount, 1);
  const v = fx.vignettes.find((q) => q.active);
  assert.equal(v.color, '#D9432B');
  assert.equal(v.peak, 0.35);
  assert.equal(v.holdS, 0.2);
  fx.update(0.2, 0.2, null);
  assert.equal(v.alpha, 0.35, 'held at its peak after the 80 ms in');
  // smoke drifts upwards on average
  let vy = 0;
  let n = 0;
  for (let i = 0; i < fx.particles.capacity; i++) if (fx.particles.alive[i] && fx.particles.kind[i] === PK.SMOKE) { vy += fx.particles.vy[i]; n++; }
  assert.ok(vy / n < -40);
});

test('combo banner (tier 2): scale 1.5 to 1.0 in 180 ms, holds 700 ms after the last member, exits in 250 ms; never above alpha 0.9', () => {
  const fx = mk();
  fx.handleEvent(comboUpdate(2));
  let v = fx.comboBannerView();
  assert.equal(v.tier, 2);
  assert.ok(Math.abs(v.scale - 1.5) < 1e-6);
  fx.update(0.18, 0.18, null);
  v = fx.comboBannerView();
  assert.ok(Math.abs(v.scale - 1) < 1e-6 && v.alpha === 0.9);
  fx.update(0.5, 0.5, null);
  assert.equal(fx.comboBannerView().alpha, 0.9);
  fx.update(0.13, 0.13, null); // 0.81 s after the last update: 0.11 s into the exit
  const fading = fx.comboBannerView();
  assert.ok(fading.alpha < 0.9 && fading.alpha > 0.4, `alpha ${fading.alpha}`);
  assert.ok(fading.scale < 1 && fading.scale > 0.92);
  fx.update(0.2, 0.2, null);
  assert.equal(fx.comboBannerView(), null);
  // a new member re-arms it with the live number; reaching the next tier plays the entrance again
  fx.handleEvent(comboUpdate(2));
  fx.update(0.5, 0.5, null);
  fx.handleEvent(comboUpdate(3));
  const again = fx.comboBannerView();
  assert.equal(again.n, 3);
  assert.equal(again.tier, 3);
  assert.ok(again.scale > 1.5, 'tier 3 enters from 1.8');
  assert.ok(again.rot > 0, 'tier 3 tips from +5 degrees');
  assert.ok(again.numScale >= 1);
});

test('combo banner tiers: size, entrance, hold and plate reveal by n (2 / 3 / 4 to 6 / 7 and up)', () => {
  const sizes = [[2, 96, 700], [3, 128, 750], [4, 160, 800], [5, 160, 800], [6, 160, 800], [7, 160, 900], [10, 160, 900]];
  for (const [n, size, hold] of sizes) {
    const fx = mk();
    fx.handleEvent(comboUpdate(n));
    const tier = n >= 7 ? 7 : n >= 4 ? 4 : n >= 3 ? 3 : 2;
    assert.equal(fx.TIERS[tier].size, size, `n ${n}: size`);
    assert.equal(fx.TIERS[tier].holdMs, hold, `n ${n}: hold`);
    assert.equal(fx.comboBannerView().tier, tier);
  }
  const t4 = mk();
  t4.handleEvent(comboUpdate(4));
  assert.equal(t4.comboBannerView().reveal, 0, 'plate and words fade in together over 120 ms (no clipped reveal)');
  t4.update(0.06, 0.06, null);
  assert.ok(Math.abs(t4.comboBannerView().reveal - 0.5) < 1e-6);
  t4.update(0.07, 0.07, null);
  assert.equal(t4.comboBannerView().reveal, 1);
  const pop = mk();
  pop.handleEvent(comboUpdate(2));
  pop.update(0.5, 0.5, null);
  pop.handleEvent(comboUpdate(2));
  pop.update(0.07, 0.07, null);
  assert.ok(Math.abs(pop.comboBannerView().numScale - 1.25) < 1e-6, 'each further member pops the number 1.0 to 1.25 in 70 ms');
  pop.update(0.12, 0.12, null);
  assert.ok(Math.abs(pop.comboBannerView().numScale - 1) < 1e-6, 'and back in 120 ms');
});

test('combo banner with reduceMotion: no scale, no rotation, no reveal, fade in over 120 ms', () => {
  const fx = mk({ reduceMotion: true });
  fx.handleEvent(comboUpdate(4));
  const v = fx.comboBannerView();
  assert.equal(v.scale, 1);
  assert.equal(v.rot, 0);
  assert.equal(v.reveal, 1);
  assert.equal(v.numScale, 1);
  assert.equal(v.alpha, 0);
  fx.update(0.06, 0.06, null);
  assert.ok(Math.abs(fx.comboBannerView().alpha - 0.45) < 1e-6);
});

test('combo effects per tier: ink stars at n = 3 (8), 4 (24) and 7 (48), gold edge streaks from tier 3, shakes at 5 and 8 (and 7)', () => {
  const stars = (fx) => Array.from(fx.particles.kind).filter((k, i) => fx.particles.alive[i] && k === PK.STAR).length;
  for (const [n, count] of [[3, 8], [4, 24], [7, 48]]) {
    const a = mk();
    a.handleEvent(comboUpdate(n));
    assert.equal(stars(a), count, `n ${n}`);
  }
  const two = mk();
  two.handleEvent(comboUpdate(2));
  assert.equal(stars(two), 0);
  assert.equal(two.activePools().edgeAccents, 0, 'tier 2 has no edge accent');
  const three = mk();
  three.handleEvent(comboUpdate(3));
  assert.equal(three.activePools().edgeAccents, 2);
  assert.equal(three.edgeAccents[0].alpha, 0.7);
  const four = mk();
  four.handleEvent(comboUpdate(4));
  assert.equal(four.edgeAccents[0].alpha, 0.85);
  const top = mk();
  top.handleEvent(comboUpdate(7));
  assert.ok(top.vignettes.some((v) => v.active && v.color === '#F2B134' && v.peak === 0.18), 'an edge vignette of gold alpha 0.18');
  const b = mk();
  b.handleEvent(comboUpdate(5));
  b.update(0.001, 0.001, null);
  assert.ok(b.shakeOffset.amp > 7 && b.shakeOffset.amp <= 8);
  const c = mk();
  c.handleEvent(comboUpdate(8));
  c.update(0.001, 0.001, null);
  assert.ok(c.shakeOffset.amp > 11 && c.shakeOffset.amp <= 12);
});

test('power-up banner: 1.2 s hold then 250 ms fade; the medallion shatters into 12 shards and Frenzy throws 24 flame sparks', () => {
  const fx = mk();
  fx.handleEvent(powerupEvent({ powerupId: 'frenzy' }));
  assert.equal(fx.powerupBannerAlpha(), 1);
  const count = (kind) => Array.from(fx.particles.kind).filter((k, i) => fx.particles.alive[i] && k === kind).length;
  assert.equal(count(PK.SHARD), 12);
  assert.equal(count(PK.SPARK), 24);
  fx.update(1.1, 1.1, null);
  assert.equal(fx.powerupBannerAlpha(), 1);
  fx.update(0.2, 0.2, null);
  assert.ok(fx.powerupBannerAlpha() < 1 && fx.powerupBannerAlpha() > 0);
  fx.update(0.2, 0.2, null);
  assert.equal(fx.powerupBannerAlpha(), 0);
});

test('power-up activations: Freeze 24 ice shards + an ice vignette, Double 16 gold stars + a gold flash, Clock a teal ring; the Freeze end cracks 12 shards', () => {
  const count = (fx, kind) => Array.from(fx.particles.kind).filter((k, i) => fx.particles.alive[i] && k === kind).length;
  const fz = mk();
  fz.handleEvent(powerupEvent({ powerupId: 'freeze' }));
  assert.equal(count(fz, PK.ICE), 24);
  assert.ok(fz.vignettes.some((v) => v.active && v.color === '#7FD1F0' && v.peak === 0.3));
  assert.equal(fz.state.flashCount, 0, 'the ice is a vignette, not a full-screen flash');
  const db = mk();
  db.handleEvent(powerupEvent({ powerupId: 'double' }));
  assert.equal(count(db, PK.STAR), 16);
  assert.equal(db.state.flashCount, 1);
  const ck = mk();
  ck.handleEvent(powerupEvent({ powerupId: 'clock' }));
  assert.ok(ck.rings.some((r) => r.active && r.r1 === 260));
  assert.ok(ck.timerBoostScale() === 1 || ck.timerBoostScale() > 1);
  const end = mk();
  end.handleEvent(powerupEvent({ powerupId: 'freeze', phase: 'end' }));
  assert.equal(count(end, PK.ICE), 12);
  const rf = mk({ reduceFlash: true });
  rf.handleEvent(powerupEvent({ powerupId: 'double' }));
  assert.equal(count(rf, PK.STAR), 5, 'stars reduced by 70 percent');
  assert.equal(rf.state.flashCount, 0);
});

test('golden apple cut: 36 gold dust, 5 sparkle stars, rays burst, golden popup (72 px, held 900 ms), gold flash; reduceFlash cuts the stars by 70%', () => {
  const fx = mk();
  fx.handleEvent(cutEvent({ kind: 'golden', objType: 'golden', points: 100, r: 64 }));
  const count = (f, kind) => Array.from(f.particles.kind).filter((k, i) => f.particles.alive[i] && k === kind).length;
  assert.equal(count(fx, PK.STAR), 5);
  assert.equal(count(fx, PK.DUST), 36);
  assert.ok(fx.bursts.some((b) => b.active && b.kind === BURST.RAYS), 'the rays burst');
  const gp = fx.popups.find((p) => p.active && p.kind === 'golden');
  assert.equal(gp.text, 'GOLDEN APPLE! +100');
  assert.equal(gp.size, 72);
  assert.equal(gp.tint, 'gold');
  assert.ok(Math.abs(fx.popupView(gp).scale - 1.4) < 1e-9, 'scale 1.4 to 1.0 in 140 ms');
  fx.update(0.14, 0.14, null);
  assert.ok(Math.abs(fx.popupView(gp).scale - 1) < 1e-9);
  fx.update(0.7, 0.7, null);
  assert.equal(fx.popupView(gp).alpha, 1, 'held until 900 ms');
  assert.equal(fx.state.flashCount, 1);
  const doubled = mk();
  doubled.handleEvent(cutEvent({ kind: 'golden', objType: 'golden', points: 200, doubled: true }));
  assert.equal(doubled.popups.find((p) => p.active && p.kind === 'golden').text, 'GOLDEN APPLE! +200');
  const quiet = mk({ reduceFlash: true });
  quiet.handleEvent(cutEvent({ kind: 'golden', objType: 'golden' }));
  assert.equal(count(quiet, PK.STAR), 2);
  assert.equal(quiet.state.flashCount, 0);
  const calm = mk({ reduceMotion: true });
  calm.handleEvent(cutEvent({ kind: 'golden', objType: 'golden' }));
  assert.equal(count(calm, PK.DUST), 18, 'dust halved');
  calm.update(0.001, 0.001, null);
  assert.equal(calm.shakeOffset.amp, 0, 'no shake');
});

test('miss marker only when a life is lost; lifeLost starts a vignette, a shake (misses only) and the HUD apple drop', () => {
  const fx = mk();
  fx.handleEvent(missEvent({ costsLife: false }));
  assert.equal(fx.activeCounts().popups, 0);
  fx.handleEvent(missEvent({ costsLife: true, x: 800 }));
  const p = fx.popups.find((q) => q.active);
  assert.equal(p.text, 'Missed!');
  assert.equal(p.y, 1020, 'clamped inside the screen (bottom marker at 1040 is pulled up to 1020)');
  fx.handleEvent(lifeLostEvent({ livesLeft: 2, cause: 'miss' }));
  assert.ok(fx.vignettes.some((v) => v.active));
  fx.update(0.001, 0.001, null);
  assert.ok(fx.shakeOffset.amp > 0);
  assert.equal(fx.lifeDrops.find((d) => d.active).x, 1680);
  const b = mk();
  b.handleEvent(lifeLostEvent({ livesLeft: 0, cause: 'bomb' }));
  b.update(0.001, 0.001, null);
  assert.equal(b.shakeOffset.amp, 0, 'the bomb event carries the shake, not the life');
  assert.equal(b.lifeDrops.find((d) => d.active).x, 1840);
});

test('game over dims to ink alpha 0.55 over 500 ms; time up shows the free-standing banner; near miss popup', () => {
  const fx = mk();
  fx.handleEvent(gameOverEvent());
  fx.update(0.25, 0.25, null);
  assert.ok(Math.abs(fx.ambient.dim - 0.275) < 0.01);
  fx.update(0.5, 0.5, null);
  assert.ok(Math.abs(fx.ambient.dim - 0.55) < 1e-6);
  const t = mk();
  t.update(0.016, 0.016, makeSnapshot({ mode: 'arcade' }));
  t.handleEvent(timeUpEvent());
  assert.equal(t.endBanner.active, true);
  const zen = mk();
  zen.update(0.016, 0.016, makeSnapshot({ mode: 'zen' }));
  zen.handleEvent(timeUpEvent());
  assert.equal(zen.endBanner.active, false, 'Zen ends softly, no banner');
  t.handleEvent(nearMissEvent());
  assert.equal(t.popups.find((p) => p.active).text, 'So close!');
});

test('timer pulse: 1.0 -> 1.15 over 200 ms on each tick, none with reduced flashing', () => {
  const fx = mk();
  assert.equal(fx.timerPulseScale(), 1);
  fx.handleEvent(tickEvent());
  fx.update(0.1, 0.1, null);
  assert.ok(Math.abs(fx.timerPulseScale() - 1.15) < 0.01);
  fx.update(0.11, 0.11, null);
  assert.equal(fx.timerPulseScale(), 1);
});

test('ambient overlays follow the game state smoothly: frost (Freeze, breathing 0.18 to 0.26), warm edge (Frenzy 0.10), slow-motion vignette; the aura follows the power-up', () => {
  const fx = mk();
  const snap = makeSnapshot({ powerups: [{ id: 'freeze', remainingS: 4, durationS: 5 }], timeScale: 0.4 });
  fx.update(0.01, 0.01, snap);
  assert.ok(fx.ambient.frost > 0 && fx.ambient.frost < 0.22, 'eases in, does not pop');
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 240; i++) {
    fx.update(1 / 60, 1 / 60, snap);
    if (i > 60) { lo = Math.min(lo, fx.ambient.frost); hi = Math.max(hi, fx.ambient.frost); }
  }
  assert.ok(lo >= 0.17 && hi <= 0.27 && hi - lo > 0.04, `breathing ${lo}..${hi}`);
  assert.ok(fx.ambient.slow > 0.1 && fx.ambient.slow <= 0.2);
  assert.equal(fx.auraView().powerup, 'freeze');
  assert.ok(fx.auraView().k > 0.9);
  const later = makeSnapshot({ powerups: [], timeScale: 1 });
  advance(fx, 3, later);
  assert.ok(fx.ambient.frost < 0.01 && fx.ambient.slow < 0.01);
  assert.equal(fx.auraView().powerup, 'none');
  assert.equal(fx.auraView().k, 0);
  const warm = makeSnapshot({ powerups: [{ id: 'frenzy', remainingS: 5, durationS: 6 }] });
  advance(fx, 1.5, warm);
  assert.ok(Math.abs(fx.ambient.warm - 0.1) < 0.01);
  assert.equal(fx.auraView().powerup, 'frenzy');
  // hit-stop (timeScale 0) must not flicker the slow-motion vignette
  const hit = makeSnapshot({ timeScale: 0 });
  const before = fx.ambient.slow;
  advance(fx, 0.06, hit);
  assert.ok(Math.abs(fx.ambient.slow - before) < 0.02);
  const rf = mk({ reduceFlash: true });
  advance(rf, 2, snap);
  assert.ok(Math.abs(rf.ambient.frost - 0.15) < 0.005, 'static 0.15 with Reduce flashes: no breathing');
});

test('continuous emitters: golden dust trail 1 particle per 25 ms', () => {
  const fx = mk();
  const snap = makeSnapshot({ objects: [makeObject({ id: 7, kind: 'golden', type: 'golden' })] });
  for (let i = 0; i < 25; i++) fx.update(0.01, 0.01, snap);
  const dust = Array.from(fx.particles.kind).filter((k, i) => fx.particles.alive[i] && k === PK.DUST).length;
  assert.ok(dust >= 8 && dust <= 11, `dust ${dust}`);
  // once the object is gone, the emitter stops
  const before = fx.particles.count;
  for (let i = 0; i < 30; i++) fx.update(0.01, 0.01, makeSnapshot());
  assert.ok(fx.particles.count <= before);
});

test('half drips: two droplets per 50 ms for 400 ms while the half is alive', () => {
  const fx = mk();
  fx.handleEvent(cutEvent({ halfIds: [1000001, 1000002] }));
  const base = fx.particles.count;
  const snap = makeSnapshot({ halves: [makeHalf({ id: 1000001 }), makeHalf({ id: 1000002, side: -1 })] });
  for (let i = 0; i < 24; i++) fx.update(1 / 60, 1 / 60, snap); // 0.4 s
  const drips = Array.from(fx.particles.kind).filter((k, i) => fx.particles.alive[i] && k === PK.DROPLET).length;
  assert.ok(drips > 14, 'new droplets were emitted from the halves');
  assert.ok(fx.particles.count >= base - 20);
  for (let i = 0; i < 60; i++) fx.update(1 / 60, 1 / 60, snap);
  const last = fx.particles.count;
  for (let i = 0; i < 30; i++) fx.update(1 / 60, 1 / 60, snap);
  assert.ok(fx.particles.count <= last, 'dripping stopped after 400 ms');
});

test('slash mark: 140 ms then gone', () => {
  const fx = mk();
  fx.handleEvent(cutEvent());
  assert.equal(fx.activeCounts().slashes, 1);
  fx.update(0.15, 0.15, null);
  assert.equal(fx.activeCounts().slashes, 0);
});

test('DETERMINISM: same seed + same events + same dt sequence = identical fx state; another seed differs', () => {
  const run = (seed) => {
    const fx = createFx();
    fx.reset(seed);
    fx.setSettings({ reduceFlash: false, reduceMotion: false });
    const snap = makeSnapshot({ halves: [makeHalf({ id: 1000001 })], objects: [makeObject({ id: 3, kind: 'golden', type: 'golden' })] });
    fx.handleEvent(cutEvent({ halfIds: [1000001, 1000002] }));
    fx.handleEvent(bombEvent());
    fx.handleEvent(comboEvent({ n: 5 }));
    for (let i = 0; i < 90; i++) fx.update(1 / 60, 1 / 60, snap);
    fx.handleEvent(cutEvent({ id: 4, x: 400, objType: 'kiwi', r: 58 }));
    for (let i = 0; i < 30; i++) fx.update(1 / 60, 1 / 60, snap);
    return JSON.stringify(fx.serialize());
  };
  assert.equal(run(42), run(42));
  assert.notEqual(run(42), run(43));
});

test('reset clears everything and reseed keeps existing effects', () => {
  const fx = mk();
  fx.handleEvent(cutEvent());
  fx.handleEvent(bombEvent());
  fx.reseed(5);
  assert.ok(fx.particles.count > 0 && fx.activeCounts().popups > 0);
  fx.reset(5);
  assert.deepEqual(fx.activeCounts(), { particles: 0, splats: 0, popups: 0, slashes: 0, flashes: 0 });
  assert.deepEqual(fx.activePools(), { particles: 0, splats: 0, popups: 0, slashes: 0, flashes: 0, rings: 0, banners: 0, edgeAccents: 0, vignettes: 0, bursts: 0 });
  assert.equal(fx.shakeOffset.amp, 0);
  assert.equal(fx.state.flashCount, 0);
  assert.equal(fx.hitHold().active, false);
});

test('every event of the contract is accepted without throwing (fixtures pass the validators)', () => {
  const fx = mk();
  const events = [cutEvent(), comboEvent(), bombEvent(), powerupEvent(), lifeLostEvent(), missEvent(), gameOverEvent(), timeUpEvent(), tickEvent(), nearMissEvent(), timeBonusEvent()];
  for (const e of events) {
    assertValid('GameEvent', e);
    assert.doesNotThrow(() => fx.handleEvent(e));
  }
  for (const type of ['spawn', 'enter', 'telegraph', 'lifeGained', 'slowmo', 'stage', 'wave', 'phase', 'practice']) {
    assert.doesNotThrow(() => fx.handleEvent({ seq: 1, t: 0, type }));
  }
  assert.doesNotThrow(() => advance(fx, 3));
});

test('perf governor: average frame time above 20 ms for 2 s raises the degrade level one step at a time, up to 3', () => {
  const g = createPerfGovernor();
  const levels = [];
  for (let i = 0; i < 400; i++) {
    const l = g.sample(0.025);
    if (l !== null) levels.push([i, l]);
  }
  assert.deepEqual(levels.map((x) => x[1]), [1, 2, 3]);
  assert.ok(levels[0][0] >= 79 && levels[0][0] <= 81, `first escalation after ~2 s, got frame ${levels[0][0]}`);
  assert.equal(g.level, 3);
  assert.equal(g.sample(0.05), null, 'never above 3');
  const fast = createPerfGovernor();
  for (let i = 0; i < 600; i++) assert.equal(fast.sample(1 / 60), null);
  assert.equal(fast.level, 0);
  assert.ok(Math.abs(fast.avgFrameMs - 16.67) < 0.1);
});

test('perf governor recovers (m3): three good 2 s windows lower the level by one; a transient slowdown is forgotten', () => {
  const g = createPerfGovernor();
  const seq = [];
  const run = (frames, dt) => { for (let i = 0; i < frames; i++) { const l = g.sample(dt); if (l !== null) seq.push(l); } };
  run(85, 0.025); // a 2 s stall (Energy Saver at 30 fps) -> level 1
  assert.deepEqual(seq, [1]);
  run(240, 1 / 60); // 4 s at 60 fps: two good windows are not enough
  assert.deepEqual(seq, [1]);
  run(120, 1 / 60); // the third good window: back to 0
  assert.deepEqual(seq, [1, 0]);
  assert.equal(g.level, 0);
  // a 40 fps machine never recovers and never drops below the level that it needs
  const slow = createPerfGovernor();
  const out = [];
  for (let i = 0; i < 4000; i++) { const l = slow.sample(0.025); if (l !== null) out.push(l); }
  assert.deepEqual(out, [1, 2, 3]);
  // 18 ms frames (55 fps) are neither slow enough to escalate nor good enough to recover
  const mid = createPerfGovernor();
  for (let i = 0; i < 320; i++) mid.sample(0.025);
  assert.equal(mid.level, 3);
  for (let i = 0; i < 4000; i++) assert.equal(mid.sample(0.018), null);
  assert.equal(mid.level, 3);
});

test('perf governor anti-flap: when the lower level is what keeps it fast, after two flaps it stops recovering', () => {
  const g = createPerfGovernor();
  let changes = 0;
  // slow at level 0, fast at level >= 1 (the degrade really helps), repeated
  for (let i = 0; i < 6000; i++) {
    const dt = g.level === 0 ? 0.025 : 1 / 60;
    if (g.sample(dt) !== null) changes++;
  }
  assert.ok(g.flaps >= 2, `flaps ${g.flaps}`);
  assert.ok(changes <= 7, `a bounded number of level changes (${changes})`);
  const before = g.level;
  for (let i = 0; i < 3000; i++) g.sample(1 / 60);
  assert.equal(g.level, before, 'sticky after the flaps');
});

test('bomb wobble on slow contact: a damped swing, only while the blade is not cutting, never for cutting speed or far away', () => {
  const fx = mk();
  const bomb = makeObject({ id: 9, kind: 'bomb', x: 700, y: 500, r: 64 });
  const snap = makeSnapshot({ objects: [bomb] });
  fx.checkBombContact(snap, { x: 900, y: 500 }, false);
  assert.equal(fx.wobbleAngle(9), 0, 'too far: nothing');
  fx.checkBombContact(snap, { x: 700, y: 500 }, true);
  assert.equal(fx.wobbleAngle(9), 0, 'a cutting blade explodes the bomb in the Game, it does not wobble it');
  fx.checkBombContact(snap, { x: 720, y: 500 }, false);
  fx.update(0.05, 0.05, snap);
  const a1 = fx.wobbleAngle(9);
  assert.ok(Math.abs(a1) > 0.05 && Math.abs(a1) <= 0.35, `angle ${a1}`);
  fx.update(0.3, 0.3, snap);
  fx.update(0.4, 0.4, snap);
  assert.equal(fx.wobbleAngle(9), 0, 'over after 700 ms');
  const calm = mk({ reduceMotion: true });
  calm.checkBombContact(snap, { x: 720, y: 500 }, false);
  assert.equal(calm.wobbleAngle(9), 0);
  fx.handleEvent(nearMissEvent({ id: 9 }));
  fx.update(0.05, 0.05, snap);
  assert.notEqual(fx.wobbleAngle(9), 0, 'a near miss also wobbles the bomb');
});

test('an evicted half that is still on screen fades out over 150 ms (ghost)', () => {
  const fx = mk();
  const half = makeHalf({ id: 1000009, x: 800, y: 500 });
  fx.addGhostHalf(half);
  assert.equal(fx.ghosts.filter((g) => g.active).length, 1);
  const g = fx.ghosts.find((x) => x.active);
  assert.equal(fx.ghostAlpha(g), 1);
  fx.update(0.075, 0.075, null);
  assert.ok(Math.abs(fx.ghostAlpha(g) - 0.5) < 1e-6);
  fx.update(0.08, 0.08, null);
  assert.equal(fx.ghosts.filter((x) => x.active).length, 0);
  for (let i = 0; i < 12; i++) fx.addGhostHalf(makeHalf({ id: 1000100 + i }));
  assert.equal(fx.ghosts.filter((x) => x.active).length, 8, 'at most 8 ghosts');
});
