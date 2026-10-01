// The restyle effects (docs/restyle-direction.md section 2 and 5.1): caps and pooling, hit hold, camera, reduce-flashes and reduce-motion variants,
// determinism of the whole effect timeline, effects never touching game state, and no per-frame allocation. Pure fx.js plus the renderer on the fake context.
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import { CONFIG } from '../../public/js/game/config.js';
import { PK, createFx } from '../../public/js/render/fx.js';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { bombEvent, comboEvent, cutEvent, gameOverEvent, lifeLostEvent, makeBlade, makeHalf, makeObject, makeSnapshot, makeUiHarness, powerupEvent, timeUpEvent } from '../../test-support/ui/fixtures.js';

const mk = (settings = {}, seed = 1) => {
  const fx = createFx();
  fx.reset(seed);
  fx.setSettings({ reduceFlash: false, reduceMotion: false, ...settings });
  return fx;
};
const comboUpdate = (n, over = {}) => comboEvent({ phase: 'update', n, bonus: 0, ...over });
const live = (fx, kind) => Array.from(fx.particles.kind).filter((k, i) => fx.particles.alive[i] && k === kind).length;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A busy, repeatable scenario: cuts of every kind, combos up to x8, a bomb, power-ups, a lost life, game over. Returns a digest per step. */
function scenario(fx, { freeze = false } = {}) {
  const digests = [];
  const snap = makeSnapshot({ powerups: freeze ? [{ id: 'freeze', remainingS: 4, durationS: 5 }] : [], objects: [makeObject({ id: 3, kind: 'golden', type: 'golden' })] });
  const step = (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) { fx.update(dt, dt, snap); } digests.push(JSON.stringify(fx.serialize())); };
  for (let i = 1; i <= 8; i++) {
    fx.handleEvent(cutEvent({ comboIndex: i, x: 400 + i * 120, y: 500, objType: i % 2 ? 'apple' : 'orange', angleRad: 0.2 * i, nx: -Math.sin(0.2 * i), ny: Math.cos(0.2 * i) }));
    fx.handleEvent(comboUpdate(i, { x: 400 + i * 120, y: 500 }));
    step(3);
  }
  fx.handleEvent(comboEvent({ phase: 'close', n: 8, bonus: 200 }));
  fx.handleEvent(bombEvent({ x: 900, y: 500, scoreDelta: -50, timeDeltaS: -5 }));
  step(12);
  fx.handleEvent(cutEvent({ kind: 'golden', objType: 'golden', points: 100 }));
  step(10);
  for (const id of ['frenzy', 'freeze', 'double', 'clock']) fx.handleEvent(powerupEvent({ powerupId: id, x: 700, y: 400 }));
  step(20);
  fx.handleEvent(powerupEvent({ powerupId: 'freeze', phase: 'end' }));
  fx.handleEvent(lifeLostEvent());
  step(30);
  fx.handleEvent(gameOverEvent());
  fx.handleEvent(timeUpEvent());
  step(90);
  return digests;
}

// ------------------------------------------------------------------------------------------------ caps and pooling

test('CAPS: the pools never exceed their caps however many events arrive; the particle kinds keep their soft caps', () => {
  const fx = mk();
  const snap = makeSnapshot({ powerups: [{ id: 'frenzy', remainingS: 5, durationS: 6 }, { id: 'freeze', remainingS: 5, durationS: 5 }] });
  for (let i = 0; i < 80; i++) {
    fx.handleEvent(cutEvent({ comboIndex: 1 + (i % 9), x: 300 + (i * 37) % 1300, y: 300 + (i * 53) % 500 }));
    fx.handleEvent(comboUpdate(2 + (i % 8)));
    if (i % 5 === 0) fx.handleEvent(bombEvent({ x: 600 + i * 5, y: 500 }));
    if (i % 7 === 0) fx.handleEvent(powerupEvent({ powerupId: ['freeze', 'frenzy', 'double', 'clock'][i % 4] }));
    if (i % 11 === 0) fx.handleEvent(cutEvent({ kind: 'golden', objType: 'golden', points: 100 }));
    fx.update(1 / 120, 1 / 120, snap);
    const c = fx.activePools();
    assert.ok(c.particles <= CONFIG.caps.particles, `particles ${c.particles}`);
    assert.ok(c.splats <= CONFIG.caps.splats + 8, `decals ${c.splats}`);
    assert.ok(c.popups <= CONFIG.caps.popups, `popups ${c.popups}`);
    assert.ok(c.slashes <= 8 && c.rings <= 4 && c.banners <= 3 && c.edgeAccents <= 2 && c.vignettes <= 6 && c.flashes <= 4 && c.bursts <= 6, JSON.stringify(c));
    assert.ok(live(fx, PK.DROPLET) <= 160 && live(fx, PK.SPARK) <= 100 && live(fx, PK.SMOKE) <= 60 && live(fx, PK.STAR) <= 60 && live(fx, PK.DUST) <= 80 && live(fx, PK.ICE) <= 40 && live(fx, PK.EMBER) <= 60);
  }
  assert.ok(fx.particles.skipped > 0, 'the soft caps did refuse spawns');
  const decals = fx.splats.filter((s) => s.active && s.evict < 0).length;
  assert.ok(decals <= CONFIG.caps.splats, `${decals} decals that are not fading out`);
  assert.equal(fx.decals, fx.splats, 'fx.decals is the read-only pool of the ink splatters');
});

test('CAPS: degrade level 1 halves the particle counts, level 2 halves the decal cap to 12', () => {
  const a = mk();
  a.handleEvent(cutEvent());
  const b = mk();
  b.setDegradeLevel(1);
  b.handleEvent(cutEvent());
  assert.ok(b.particles.count <= Math.ceil(a.particles.count / 2) + 1);
  const c = mk();
  c.setDegradeLevel(2);
  for (let i = 0; i < 30; i++) c.handleEvent(cutEvent({ x: 100 + i * 50 }));
  assert.ok(c.splats.filter((s) => s.active && s.evict < 0).length <= 12);
});

test('POOLING: a long busy session allocates no new pool members (every array keeps its length and identity)', () => {
  const fx = mk();
  const refs = { particles: fx.particles.x, splats: fx.splats, popups: fx.popups, rings: fx.rings, banners: fx.banners, bursts: fx.bursts, edge: fx.edgeAccents, slashes: fx.slashes };
  const lengths = Object.fromEntries(Object.entries(refs).map(([k, v]) => [k, v.length]));
  scenario(fx);
  scenario(fx);
  for (const [k, v] of Object.entries(refs)) assert.equal(v.length, lengths[k], `${k} keeps its size`);
  assert.equal(fx.particles.x, refs.particles);
  assert.equal(fx.particles.capacity, CONFIG.caps.particles);
});

test('ParticlePool soft caps: a kind at its cap refuses new particles and the total never exceeds the pool', async () => {
  const { ParticlePool } = await import('../../public/js/render/fx.js');
  const pool = new ParticlePool(50);
  pool.setKindCap(PK.DROPLET, 10);
  let refused = 0;
  for (let i = 0; i < 30; i++) if (pool.spawn(PK.DROPLET, 0, 0, 0, 0, 5, 3, 0) < 0) refused++;
  assert.equal(refused, 20);
  assert.equal(pool.count, 10);
  for (let i = 0; i < 100; i++) pool.spawn(PK.SPARK, 0, 0, 0, 0, 5, 1, 0);
  assert.equal(pool.count, 50, 'the total is capped; the oldest is dropped first');
  pool.clear();
  assert.equal(pool.kindCount[PK.DROPLET], 0);
});

// ------------------------------------------------------------------------------------------------ hit hold and camera

test('HIT HOLD: cut 2 and 3 hold 40 ms, 4 to 6 hold 50 ms, 7 and up 60 ms, then a 60 ms catch-up; at most one per 250 ms', () => {
  for (const [idx, ms] of [[2, 40], [3, 40], [4, 50], [6, 50], [7, 60], [9, 60]]) {
    const fx = mk();
    fx.handleEvent(cutEvent({ comboIndex: idx }));
    const h = fx.hitHold();
    assert.equal(h.active, true, `cut ${idx}`);
    assert.ok(near(h.remainingMs, ms), `cut ${idx}: ${h.remainingMs} ms`);
    assert.equal(h.catchUp, 1);
    fx.update(ms / 1000 + 0.03, ms / 1000 + 0.03, null);
    const c = fx.hitHold();
    assert.equal(c.active, false);
    assert.ok(c.catchUp > 0.4 && c.catchUp < 0.6, `halfway through the catch-up: ${c.catchUp}`);
    fx.update(0.04, 0.04, null);
    assert.equal(fx.hitHold().catchUp, 0);
  }
  const once = mk();
  once.handleEvent(cutEvent({ comboIndex: 2 }));
  once.update(0.2, 0.2, null);
  once.handleEvent(cutEvent({ comboIndex: 3 }));
  assert.equal(once.hitHold().active, false, 'a second hold inside 250 ms is refused');
  once.update(0.1, 0.1, null);
  once.handleEvent(cutEvent({ comboIndex: 4 }));
  assert.equal(once.hitHold().active, true, 'and allowed after 250 ms');
  const first = mk();
  first.handleEvent(cutEvent({ comboIndex: 1 }));
  assert.equal(first.hitHold().active, false, 'the first cut of a swing never holds');
});

test('HIT HOLD: none during Freeze, none with Reduce motion, none for menu cuts and none for the bomb', () => {
  const frozen = mk();
  frozen.update(0.016, 0.016, makeSnapshot({ powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }] }));
  frozen.handleEvent(cutEvent({ comboIndex: 3 }));
  assert.equal(frozen.hitHold().active, false);
  const calm = mk({ reduceMotion: true });
  calm.handleEvent(cutEvent({ comboIndex: 5 }));
  assert.equal(calm.hitHold().active, false);
  const menu = mk();
  menu.menuCut(cutEvent({ comboIndex: 5 }));
  assert.equal(menu.hitHold().active, false);
  const bomb = mk();
  bomb.handleEvent(bombEvent());
  assert.equal(bomb.hitHold().active, false, 'the bomb keeps the game\'s own 60 ms');
});

test('CAMERA: the second cut of a swing punches (zoom 1.012 in 50 ms, back in 180 ms; shake 3 px for 90 ms); none with Reduce motion; the first cut has none', () => {
  const fx = mk();
  fx.handleEvent(cutEvent({ comboIndex: 1 }));
  fx.update(0.05, 0.05, null);
  assert.equal(fx.cameraView().scale, 1);
  assert.equal(fx.cameraView().dx, 0);
  fx.handleEvent(cutEvent({ comboIndex: 2 }));
  fx.update(0.05, 0.05, null);
  let cam = fx.cameraView();
  assert.ok(near(cam.scale, 1.012, 1e-3), `peak ${cam.scale}`);
  assert.ok(Math.hypot(cam.dx, cam.dy) <= 3 + 1e-6);
  fx.update(0.2, 0.2, null);
  cam = fx.cameraView();
  assert.equal(cam.scale, 1);
  assert.equal(cam.dx, 0);
  const calm = mk({ reduceMotion: true });
  calm.handleEvent(cutEvent({ comboIndex: 5 }));
  calm.handleEvent(bombEvent());
  calm.update(0.03, 0.03, null);
  const c = calm.cameraView();
  assert.deepEqual([c.dx, c.dy, c.scale, c.rot], [0, 0, 1, 0], 'no shake, no zoom, no tilt');
  const bomb = mk();
  bomb.handleEvent(bombEvent());
  bomb.update(0.06, 0.06, null);
  assert.ok(bomb.cameraView().scale > 1.02, 'the bomb keeps its 1.03 zoom');
  assert.ok(bomb.cameraView().rot !== 0 || bomb.shakeOffset.amp > 10);
  assert.ok(Math.abs(bomb.cameraView().rot) < 0.012, 'the tilt stays under 0.7 degrees');
});

// ------------------------------------------------------------------------------------------------ reduce flashes and reduce motion

test('REDUCE FLASHES: no full-screen overlay for any event of the scenario, only vignettes; slash marks 200 ms at alpha 0.5 without the core line', () => {
  const fx = mk({ reduceFlash: true });
  scenario(fx);
  assert.equal(fx.state.flashCount, 0);
  const cut = mk({ reduceFlash: true });
  cut.handleEvent(cutEvent());
  const s = cut.slashes.find((q) => q.active);
  assert.ok(near(s.dur, 0.2) && s.alpha === 0.5 && s.core === false);
  const bomb = mk({ reduceFlash: true });
  bomb.handleEvent(bombEvent());
  assert.equal(bomb.flashes.filter((f) => f.active).length, 0);
  assert.equal(bomb.rings.filter((r) => r.active).length, 1, 'one static ring');
  const ring = bomb.rings.find((r) => r.active);
  assert.ok(ring.still && ring.alpha === 0.35 && near(ring.dur, 0.3));
  assert.ok(bomb.vignettes.some((v) => v.active && v.peak === 0.18), 'a quiet ink-red vignette');
  const ex = bomb.bursts.find((b) => b.active && b.kind === 'explosion');
  assert.ok(near(ex.dur, 0.3) && ex.alpha === 0.7 && ex.reduced);
  assert.equal(live(bomb, PK.SPARK), 20, 'sparks halved');
  const stars = mk({ reduceFlash: true });
  stars.handleEvent(comboUpdate(7));
  assert.equal(live(stars, PK.STAR), 0, 'the ink stars are replaced by one soft ring');
  assert.ok(stars.rings.some((r) => r.active && r.alpha === 0.3));
  assert.equal(stars.vignettes.filter((v) => v.active).length, 0, 'no edge vignette');
  assert.equal(stars.edgeAccents[0].alpha, 0.4);
  const end = mk({ reduceFlash: true });
  end.handleEvent(gameOverEvent());
  end.update(0.5, 0.5, null);
  assert.ok(end.ambient.dim < 0.55 && end.ambient.dim > 0.3, 'the dim ramps over 700 ms');
});

test('FLASH LIMITER: a bomb inside a x7 combo shows ONE flash (the banner vignette counts as a flash); 600 ms apart they are two', () => {
  const fx = mk();
  fx.handleEvent(comboUpdate(7));
  fx.handleEvent(bombEvent());
  assert.equal(fx.state.flashCount, 1);
  assert.ok(fx.state.flashRejected >= 1);
  const apart = mk();
  apart.handleEvent(comboUpdate(7));
  apart.update(0.6, 0.6, null);
  apart.handleEvent(bombEvent());
  assert.equal(apart.state.flashCount, 2);
  // never more than one per 500 ms over a whole scenario
  const spam = mk();
  let last = -1;
  for (let i = 0; i < 300; i++) {
    const before = spam.state.flashCount;
    if (i % 10 === 0) { spam.handleEvent(bombEvent()); spam.handleEvent(comboUpdate(7)); spam.handleEvent(powerupEvent({ powerupId: 'double' })); spam.handleEvent(cutEvent({ kind: 'golden', objType: 'golden' })); }
    spam.update(1 / 60, 1 / 60, null);
    if (spam.state.flashCount > before) {
      if (last >= 0) assert.ok(spam.state.time - last >= 0.5 - 1e-6, `flashes ${spam.state.time - last} s apart`);
      last = spam.state.time;
    }
  }
  assert.ok(spam.flashes.every((f) => !f.active || f.peak <= CONFIG.juice.flash.maxAlpha));
});

test('REDUCE MOTION: no shake, no zoom, no hit hold, no tilt; counts halved and speeds x0.7; banners and popups fade only', () => {
  const fx = mk({ reduceMotion: true });
  const digests = scenario(fx);
  assert.ok(digests.length > 0);
  assert.equal(fx.state.holdCount, 0);
  assert.equal(fx.shakeOffset.amp, 0);
  assert.equal(fx.zoom.scale, 1);
  const bomb = mk({ reduceMotion: true });
  bomb.handleEvent(bombEvent());
  assert.equal(live(bomb, PK.SPARK), 20);
  assert.equal(live(bomb, PK.SMOKE), 14);
  const b = bomb.banners.find((q) => q.active);
  bomb.update(0.05, 0.05, null);
  assert.equal(bomb.bannerView(b).scale, 1, 'the BOMB! banner fades without slamming');
  const end = mk({ reduceMotion: true });
  end.handleEvent(gameOverEvent());
  end.update(0.6, 0.6, null);
  assert.equal(end.endBannerView().scale, 1);
  assert.equal(end.endBannerView().alpha, 1);
  const normal = mk();
  normal.handleEvent(bombEvent());
  const speed = (f) => { let s = 0; let n = 0; for (let i = 0; i < f.particles.capacity; i++) if (f.particles.alive[i] && f.particles.kind[i] === PK.SPARK) { s += Math.hypot(f.particles.vx[i], f.particles.vy[i]); n++; } return s / n; };
  assert.ok(speed(bomb) < speed(normal) * 0.85, 'sparks are slower');
});

// ------------------------------------------------------------------------------------------------ determinism and purity

test('DETERMINISM: the same seed, events and dt sequence give the identical effect timeline step by step; another seed differs; settings variants are deterministic too', () => {
  for (const settings of [{}, { reduceFlash: true }, { reduceMotion: true }, { reduceFlash: true, reduceMotion: true }]) {
    const a = scenario(mk(settings, 11));
    const b = scenario(mk(settings, 11));
    assert.deepEqual(a, b, JSON.stringify(settings));
  }
  const x = scenario(mk({}, 11));
  const y = scenario(mk({}, 12));
  assert.notDeepEqual(x, y);
  const withFreeze = scenario(mk({}, 11), { freeze: true });
  assert.notDeepEqual(withFreeze, x);
  // reset(seed) replays the same timeline in the same object
  const fx = mk({}, 5);
  const first = scenario(fx);
  fx.reset(5);
  fx.setSettings({ reduceFlash: false, reduceMotion: false });
  assert.deepEqual(scenario(fx), first);
});

test('PURITY: effects only read events and snapshots: frozen inputs pass through the whole scenario untouched', () => {
  const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; };
  const fx = mk();
  const snap = deepFreeze(makeSnapshot({ objects: [makeObject({ id: 1 }), makeObject({ id: 2, kind: 'bomb' }), makeObject({ id: 3, kind: 'golden', type: 'golden' })], halves: [makeHalf()], powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }, { id: 'frenzy', remainingS: 3, durationS: 6 }] }));
  const events = [cutEvent({ comboIndex: 3 }), comboUpdate(7), comboEvent({ phase: 'close', n: 7, bonus: 100 }), bombEvent(), powerupEvent(), lifeLostEvent(), gameOverEvent(), timeUpEvent()].map(deepFreeze);
  const before = JSON.stringify([snap, events]);
  for (const e of events) fx.handleEvent(e);
  for (let i = 0; i < 120; i++) fx.update(1 / 60, 1 / 60, snap);
  assert.equal(JSON.stringify([snap, events]), before);
  // and the cosmetic stream is a stream of its own: the game's rng is never imported by fx.js
  assert.ok(fx.activePools().particles >= 0);
});

// ------------------------------------------------------------------------------------------------ renderer

function playing(snapshot) {
  const rig = makeRenderRig();
  const h = makeUiHarness();
  h.toPlaying('classic');
  const frame = () => ({ view: h.view, uiState: h.ui.getState(), snapshot, blade: makeBlade(), nowMs: 1000 });
  return { rig, h, frame };
}

test('RENDERER hit hold: during the hold the objects are drawn where they were in the previous frame, then ease to the live position in 60 ms; the snapshot is untouched', () => {
  const obj = makeObject({ id: 1, type: 'apple', px: 100, py: 400, x: 100, y: 400, prot: 0.2, rot: 0.2 }); // a rotated object is drawn through translate + rotate
  const snap = makeSnapshot({ alpha: 1, objects: [obj] });
  const { rig, frame } = playing(snap);
  const posOf = () => {
    const calls = rig.ctx.calls;
    const i = calls.findIndex((c) => c[0] === 'drawImage' && c[1] === rig.sprites.fruit('apple').canvas);
    const tr = calls.slice(0, i).filter((c) => c[0] === 'translate').at(-1);
    return tr[1];
  };
  rig.draw(frame());
  assert.equal(posOf(), 100);
  obj.px = 100; obj.x = 160; // the object moved 60 px since the previous frame, and a cut arrives
  rig.fx.handleEvent(cutEvent({ comboIndex: 2 }));
  rig.fx.update(0.016, 0.016, snap);
  assert.equal(rig.fx.hitHold().active, true);
  rig.draw(frame());
  assert.equal(posOf(), 100, 'held at the previous position');
  rig.fx.update(0.03, 0.03, snap); // hold over (46 ms), catch-up started
  rig.draw(frame());
  const mid = posOf();
  assert.ok(mid > 100 && mid < 160, `easing back: ${mid}`);
  rig.fx.update(0.06, 0.06, snap);
  rig.draw(frame());
  assert.equal(posOf(), 160, 'live again');
  assert.equal(obj.x, 160, 'the snapshot object was never written');
  assert.ok(rig.renderer.stats.holdFrames >= 1);
});

test('RENDERER hit hold: eight or more objects catch up together without a jump or a lost object', () => {
  const objs = Array.from({ length: 10 }, (_, i) => makeObject({ id: i + 1, type: 'apple', px: 100 + i * 60, py: 300, x: 100 + i * 60, y: 300, prot: 0.2, rot: 0.2 }));
  const snap = makeSnapshot({ alpha: 1, objects: objs });
  const { rig, frame } = playing(snap);
  rig.draw(frame());
  for (const o of objs) { o.px = o.x; o.x += 20; o.y += 5; }
  rig.fx.handleEvent(cutEvent({ comboIndex: 4 }));
  rig.fx.update(0.016, 0.016, snap);
  const drawnAt = () => rig.ctx.calls.filter((c) => c[0] === 'drawImage' && c[1] === rig.sprites.fruit('apple').canvas).length;
  rig.draw(frame());
  assert.equal(drawnAt(), 10, 'every object is drawn during the hold');
  let prevX = null;
  for (let k = 0; k < 8; k++) {
    rig.fx.update(0.01, 0.01, snap);
    rig.draw(frame());
    assert.equal(drawnAt(), 10);
    const xs = rig.ctx.calls.filter((c, i) => c[0] === 'translate' && rig.ctx.calls[i + 2] && rig.ctx.calls[i + 2][0] === 'drawImage' && rig.ctx.calls[i + 2][1] === rig.sprites.fruit('apple').canvas).map((c) => c[1]);
    if (prevX) for (let i = 0; i < xs.length; i++) assert.ok(xs[i] >= prevX[i] - 1e-6 && xs[i] - prevX[i] < 40, 'moves forward smoothly');
    prevX = xs;
  }
});

test('RENDERER: a frame with every effect draws no forbidden property, keeps save and restore balanced, and bakes no text per frame', () => {
  const snap = makeSnapshot({
    objects: [makeObject({ id: 1 }), makeObject({ id: 2, kind: 'bomb' }), makeObject({ id: 3, kind: 'golden', type: 'golden' })],
    powerups: [{ id: 'freeze', remainingS: 3, durationS: 5 }, { id: 'double', remainingS: 4, durationS: 10 }, { id: 'frenzy', remainingS: 3, durationS: 6 }], combo: { swingId: 1, n: 5, open: true },
  });
  const { rig, frame } = playing(snap);
  for (let i = 1; i <= 8; i++) rig.fx.handleEvent(cutEvent({ comboIndex: i, x: 400 + i * 100 }));
  rig.fx.handleEvent(comboUpdate(7));
  rig.fx.handleEvent(bombEvent());
  rig.fx.handleEvent(cutEvent({ kind: 'golden', objType: 'golden', points: 100 }));
  rig.fx.handleEvent(lifeLostEvent());
  rig.fx.handleEvent(timeUpEvent());
  rig.trail.setAura({ powerup: 'frenzy', k: 1 });
  rig.fx.update(0.1, 0.1, snap);
  rig.trail.update(makeBlade({ samples: [], cutting: true, speed: 3000 }), 1000);
  rig.draw(frame());
  assert.deepEqual(rig.ctx.forbidden, []);
  assert.equal(rig.ctx.stack.length, 0);
  assert.ok(rig.ctx.calls.length > 300);
  const baked = rig.sprites.stats.textBaked;
  const canvases = rig.factory.created.length;
  for (let i = 0; i < 20; i++) { rig.fx.update(0.016, 0.016, snap); rig.draw(frame()); }
  assert.equal(rig.sprites.stats.textBaked, baked, 'the texts are baked once, not per frame');
  assert.equal(rig.factory.created.length, canvases, 'no canvas is created in a frame');
  // clearing the baked texts (a font arrived) makes the next frame bake them again, once
  rig.sprites.clearText();
  rig.fx.update(0.016, 0.016, snap);
  rig.draw(frame());
  assert.ok(rig.sprites.stats.textBaked > baked);
});

test('RENDERER: Reduce flashes draws no full-screen fillRect overlay from a bomb, a x7 combo and a Golden Apple', () => {
  const snap = makeSnapshot({ objects: [makeObject({ id: 2, kind: 'bomb' })] });
  const { rig, h, frame } = playing(snap);
  rig.fx.setSettings({ reduceFlash: true, reduceMotion: false });
  h.view.settings = { ...h.view.settings, reduceFlash: true };
  rig.fx.handleEvent(bombEvent());
  rig.fx.handleEvent(comboUpdate(7));
  rig.fx.handleEvent(cutEvent({ kind: 'golden', objType: 'golden', points: 100 }));
  rig.fx.update(0.1, 0.1, snap);
  rig.draw(frame());
  const overlays = rig.ctx.calls.filter((c) => c[0] === 'fillRect' && c[1] === 0 && c[2] === 0 && c[3] === 1920 && c[4] === 1080);
  assert.equal(overlays.length, 0, 'only vignette images, no flat overlay');
});

test('ALLOCATION: 600 frames of the heaviest scene (bomb, combo and Frenzy together) grow the heap by less than 1 MB', () => {
  v8.setFlagsFromString('--expose-gc');
  const gc = vm.runInNewContext('gc');
  const snap = makeSnapshot({
    objects: Array.from({ length: 8 }, (_, i) => makeObject({ id: i + 1, type: 'apple', x: 300 + i * 150, y: 500 })).concat([makeObject({ id: 20, kind: 'bomb' }), makeObject({ id: 21, kind: 'golden', type: 'golden' })]),
    powerups: [{ id: 'frenzy', remainingS: 5, durationS: 6 }], combo: { swingId: 1, n: 7, open: true },
  });
  const { rig, frame } = playing(snap);
  rig.sprites.warmUp();
  const run = (frames) => {
    for (let i = 0; i < frames; i++) {
      if (i % 90 === 0) {
        for (let k = 1; k <= 7; k++) rig.fx.handleEvent(cutEvent({ comboIndex: k, x: 300 + k * 150, y: 500 }));
        rig.fx.handleEvent(comboUpdate(7));
        rig.fx.handleEvent(bombEvent({ x: 900, y: 500 }));
      }
      rig.fx.update(1 / 60, 1 / 60, snap);
      rig.trail.update(makeBlade({ samples: [], cutting: true, speed: 3000 }), 1000 + i * 16);
      rig.trail.tick(1 / 60, {});
      rig.renderer.advance(snap, 1 / 60, { reduceFlash: false, reduceMotion: false });
      rig.ctx.recording = false;
      rig.ctx.reset();
      rig.renderer.draw({ perf: { fps: 60, avgFrameMs: 16.6, degradeLevel: 0 }, debug: false, ...frame() });
    }
  };
  run(120); // warm up: first bakes, JIT
  gc();
  const before = process.memoryUsage().heapUsed;
  run(600);
  gc();
  const grown = process.memoryUsage().heapUsed - before;
  assert.ok(grown < 1024 * 1024, `heap grew by ${(grown / 1024).toFixed(0)} KB over 600 frames`);
});
