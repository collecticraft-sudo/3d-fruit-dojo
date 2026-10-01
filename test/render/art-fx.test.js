// One-shot art bursts of fx.js (docs/assets-integration.md 3.6): the bomb explosion and the slice flash. Pure state, no canvas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BURST, createFx } from '../../public/js/render/fx.js';
import { ART_CONFIG } from '../../public/js/render/art-config.js';
import { BOMB_ART } from '../../public/js/render/palette.js';
import { easeOutCubic, easeOutExpo } from '../../public/js/render/ease.js';
import { bombEvent, cutEvent, makeSnapshot } from '../../test-support/ui/fixtures.js';

const mkFx = (settings = {}, opts = {}) => {
  const fx = createFx(opts);
  fx.reset(7);
  fx.setSettings({ reduceFlash: false, reduceMotion: false, ...settings });
  return fx;
};
const active = (fx, kind) => fx.bursts.filter((b) => b.active && (!kind || b.kind === kind));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

test('the pool has the capacity of ART_CONFIG.fx.burstsCap and starts empty', () => {
  const fx = mkFx();
  assert.equal(fx.bursts.length, ART_CONFIG.fx.burstsCap);
  assert.equal(fx.bursts.length, 6);
  assert.equal(fx.activeBursts(), 0);
  assert.deepEqual(fx.serialize().bursts, []);
});

test('EXPLOSION: a bomb event starts one burst at the bomb centre, 8 bomb radii wide (direction 2.4), 700 ms, fully opaque', () => {
  const fx = mkFx();
  fx.handleEvent(bombEvent({ x: 700, y: 600 }));
  const [b] = active(fx, BURST.EXPLOSION);
  assert.ok(b);
  assert.equal(b.x, 700);
  assert.equal(b.y, 600);
  assert.equal(b.size, 8 * BOMB_ART.r);
  assert.equal(b.size, 512);
  assert.ok(near(b.dur, 0.7));
  assert.equal(b.alpha, 1);
  assert.equal(b.reduced, false);
  assert.equal(active(fx).length, 1);
});

test('EXPLOSION motion: scale 0.55 to 1 with easeOutExpo over 300 ms, alpha 1 until 480 ms, then linear to 0 at 700 ms', () => {
  const fx = mkFx();
  fx.handleEvent(bombEvent());
  const b = active(fx, BURST.EXPLOSION)[0];
  const at = (age) => { b.age = age; return fx.burstView(b); };
  assert.ok(near(at(0).scale, 0.55));
  assert.ok(near(at(0.15).scale, 0.55 + 0.45 * easeOutExpo(0.5)));
  assert.ok(near(at(0.3).scale, 1));
  assert.ok(near(at(0.4).scale, 1), 'stays at 1 after the growth');
  assert.equal(at(0).alpha, 1);
  assert.equal(at(0.48).alpha, 1, 'hold until 480 ms');
  assert.ok(near(at(0.59).alpha, 0.5), 'halfway through the fade');
  assert.ok(near(at(0.7).alpha, 0));
  const out = { scale: 9, alpha: 9, rot: 9 };
  assert.equal(fx.burstView(b, out), out, 'the caller can pass its own object: no allocation in the frame');
});

test('EXPLOSION with Reduce flashing: 300 ms, no scale animation (static 0.85), at most 0.7 opaque', () => {
  const fx = mkFx({ reduceFlash: true });
  fx.handleEvent(bombEvent());
  const b = active(fx, BURST.EXPLOSION)[0];
  assert.ok(near(b.dur, 0.3));
  assert.ok(b.alpha <= ART_CONFIG.fx.explosionAlphaReduced && near(b.alpha, 0.7));
  assert.equal(b.reduced, true);
  for (const age of [0, 0.05, 0.1, 0.2, 0.29]) {
    b.age = age;
    const v = fx.burstView(b);
    assert.equal(v.scale, 0.85, `static at age ${age}`);
    assert.ok(v.alpha <= 0.7 + 1e-12);
  }
  b.age = 0.3;
  assert.ok(near(fx.burstView(b).alpha, 0));
});

test('Reduce motion alone keeps the explosion\'s length and opacity but does not grow it (static 0.85); the settings are read when the burst starts', () => {
  const fx = mkFx({ reduceMotion: true });
  fx.handleEvent(bombEvent());
  const b = active(fx, BURST.EXPLOSION)[0];
  assert.ok(near(b.dur, 0.7));
  assert.equal(b.alpha, 1);
  assert.equal(b.reduced, false);
  assert.equal(b.still, true);
  for (const age of [0, 0.1, 0.3, 0.4]) {
    b.age = age;
    assert.equal(fx.burstView(b).scale, 0.85, `no scale animation at ${age}`);
  }
  b.age = 0.1;
  assert.equal(fx.burstView(b).alpha, 1);
  fx.setSettings({ reduceFlash: true, reduceMotion: true });
  assert.ok(near(b.dur, 0.7), 'a burst already running keeps its variant');
  const plain = mkFx();
  plain.handleEvent(bombEvent());
  assert.equal(active(plain, BURST.EXPLOSION)[0].still, false);
});

test('the explosion waits out the hit-stop (world time frozen) and is frozen with the world, then plays at real speed', () => {
  const fx = mkFx();
  const snap = makeSnapshot();
  fx.handleEvent(bombEvent());
  const b = active(fx, BURST.EXPLOSION)[0];
  fx.update(0.06, 0, snap); // the 60 ms hit-stop: dtWorld 0
  assert.equal(b.age, 0);
  fx.update(0.016, 0.016 * 0.3, snap); // slow motion: it still plays at REAL speed
  assert.ok(near(b.age, 0.016));
  fx.update(0.5, 0.5, snap);
  assert.equal(b.active, true, 'still fading at 516 ms');
  fx.update(0.3, 0.3, snap);
  assert.equal(b.active, false, 'gone after its 700 ms');
  // paused: frozen, and still there
  fx.handleEvent(bombEvent());
  const c = active(fx, BURST.EXPLOSION)[0];
  fx.update(5, 0, snap);
  assert.equal(c.active, true);
  assert.equal(c.age, 0);
});

test('SLICE FLASH: every cut event starts one, along the blade angle, the slash length (2.6 r) long, 140 ms, alpha 0.9, scale 0.6 to 1.0 in 70 ms', () => {
  const fx = mkFx();
  fx.handleEvent(cutEvent({ x: 500, y: 400, r: 68, angleRad: 0.7 }));
  const [b] = active(fx, BURST.SLICE);
  assert.ok(b);
  assert.equal(b.x, 500);
  assert.equal(b.y, 400);
  assert.equal(b.angle, 0.7);
  assert.ok(near(b.size, 2.6 * 68));
  assert.ok(near(b.dur, 0.14));
  assert.equal(b.alpha, 0.9);
  assert.equal(b.reduced, false);
  // it mirrors the slash line the fallback draws
  const s = fx.slashes.find((q) => q.active);
  assert.equal(s.len, b.size);
  assert.equal(s.dur, b.dur);
  assert.equal(s.alpha, b.alpha);
  assert.ok(near(fx.burstView(b).scale, 0.6), 'starts at 0.6');
  b.age = 0.07;
  assert.ok(near(fx.burstView(b).alpha, 0.45));
  assert.ok(near(fx.burstView(b).scale, 1), 'full size after 70 ms');
  fx.update(0.2, 0.2, makeSnapshot());
  assert.equal(b.active, false);
});

test('SLICE FLASH with Reduce flashing: 200 ms at alpha 0.5', () => {
  const fx = mkFx({ reduceFlash: true });
  fx.handleEvent(cutEvent());
  const b = active(fx, BURST.SLICE)[0];
  assert.ok(near(b.dur, 0.2));
  assert.equal(b.alpha, 0.5);
  assert.equal(b.reduced, true);
});

test('the slice flash ages in real time, also in slow motion and when the world is frozen (like the slash marks)', () => {
  const fx = mkFx();
  fx.handleEvent(cutEvent());
  const b = active(fx, BURST.SLICE)[0];
  fx.update(0.05, 0, makeSnapshot());
  assert.ok(near(b.age, 0.05));
});

test('menu cuts (fx.menuCut) get the flash too, without a popup', () => {
  const fx = mkFx();
  fx.menuCut(cutEvent({ id: -1, halfIds: [], x: 900, y: 500, r: 75, angleRad: 1.1 }));
  assert.equal(active(fx, BURST.SLICE).length, 1);
  assert.equal(fx.popups.some((p) => p.active), false);
});

test('the pool never exceeds its cap; a full pool recycles a slice flash and does not evict a running explosion', () => {
  const fx = mkFx();
  fx.handleEvent(bombEvent({ x: 100, y: 100 }));
  for (let i = 0; i < 12; i++) fx.handleEvent(cutEvent({ x: 200 + i, halfIds: [] }));
  assert.equal(active(fx).length, fx.bursts.length, 'full');
  assert.equal(active(fx, BURST.EXPLOSION).length, 1, 'the explosion is still there');
  assert.equal(active(fx, BURST.EXPLOSION)[0].x, 100);
  // a second bomb while the pool is full of flashes takes a flash slot
  fx.handleEvent(bombEvent({ x: 300, y: 300 }));
  assert.equal(active(fx, BURST.EXPLOSION).length, 2);
  assert.equal(active(fx).length, fx.bursts.length);
  // with only explosions left the most advanced one is recycled
  const only = mkFx();
  for (let i = 0; i < 6; i++) { only.handleEvent(bombEvent({ x: i })); only.update(0.01, 0.01, makeSnapshot()); }
  only.handleEvent(bombEvent({ x: 99 }));
  assert.equal(active(only).length, 6);
  assert.ok(active(only).some((b) => b.x === 99));
  assert.equal(active(only).some((b) => b.x === 0), false, 'the oldest went');
});

test('DETERMINISM: the bursts are a pure function of the events and the dt sequence (the random stream is never touched: see art-fallback.test.js)', () => {
  const run = () => {
    const fx = mkFx();
    const snap = makeSnapshot();
    fx.handleEvent(cutEvent({ x: 400, y: 300, angleRad: 0.3 }));
    fx.update(0.016, 0.016, snap);
    fx.handleEvent(bombEvent({ x: 900, y: 500 }));
    fx.update(0.06, 0, snap);
    fx.update(0.05, 0.05, snap);
    return JSON.stringify(fx.serialize());
  };
  assert.equal(run(), run());
  const bursts = JSON.parse(run()).bursts;
  assert.deepEqual(bursts.map((b) => b[0]).sort(), [BURST.EXPLOSION, BURST.SLICE]);
  // a different seed changes the particles but not the bursts: they use no random numbers
  const other = mkFx();
  other.reset(99);
  other.setSettings({ reduceFlash: false, reduceMotion: false });
  other.handleEvent(cutEvent({ x: 400, y: 300, angleRad: 0.3 }));
  other.update(0.016, 0.016, makeSnapshot());
  other.handleEvent(bombEvent({ x: 900, y: 500 }));
  other.update(0.06, 0, makeSnapshot());
  other.update(0.05, 0.05, makeSnapshot());
  assert.deepEqual(other.serialize().bursts, bursts);
});

test('reset() clears the bursts', () => {
  const fx = mkFx();
  fx.handleEvent(bombEvent());
  fx.handleEvent(cutEvent());
  assert.ok(fx.activeBursts() >= 2);
  fx.reset(3);
  assert.equal(fx.activeBursts(), 0);
});

test('the numbers come from the art config: a custom artConfig or assets.config changes width, life and cap', () => {
  const cfg = { fx: { explosionWidthInRadii: 4, explosionMs: 200, explosionMsReduced: 100, explosionAlphaReduced: 0.5, burstsCap: 3 } };
  for (const opts of [{ artConfig: cfg }, { assets: { config: cfg } }]) {
    const fx = mkFx({}, opts);
    assert.equal(fx.bursts.length, 3);
    fx.handleEvent(bombEvent());
    const b = active(fx, BURST.EXPLOSION)[0];
    assert.equal(b.size, 4 * BOMB_ART.r);
    assert.ok(near(b.dur, 0.2));
  }
  const soft = mkFx({ reduceFlash: true }, { artConfig: cfg });
  soft.handleEvent(bombEvent());
  assert.ok(near(active(soft, BURST.EXPLOSION)[0].dur, 0.1));
  assert.equal(active(soft, BURST.EXPLOSION)[0].alpha, 0.5);
});

test('activeCounts() keeps its shape (existing tests pin it): bursts are counted apart', () => {
  const fx = mkFx();
  fx.handleEvent(cutEvent());
  assert.deepEqual(Object.keys(fx.activeCounts()), ['particles', 'splats', 'popups', 'slashes', 'flashes']);
  assert.deepEqual(Object.keys(fx.activePools()), ['particles', 'splats', 'popups', 'slashes', 'flashes', 'rings', 'banners', 'edgeAccents', 'vignettes', 'bursts']);
  assert.equal(fx.activeCounts().slashes, 1);
  assert.equal(fx.activeBursts(), 1);
});
