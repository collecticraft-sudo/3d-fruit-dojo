// Test helpers for the Game module (Gameplay engineer). No DOM, no wall clock: a harness owns a manual `nowMs`.
import { createHash } from 'node:crypto';
import { createGame, CONFIG } from '../../public/js/game/index.js';
import { assertValid } from '../../public/js/shared/validate.js';

export const DT = CONFIG.time.dt;
export const DT_MS = DT * 1000;

/** A BladeSegment ending at t1 (ms) and travelling from (x0,y0) to (x1,y1) at `speed` px/s. */
export function makeSegment(x0, y0, x1, y1, t1, { speed = 3000, swingId = 1, spanMs = 8 } = {}) {
  return { t0: t1 - spanMs, x0, y0, t1: t1, x1, y1, speed, swingId };
}

/**
 * Harness: a game plus a manual clock and an event collector.
 *   h.step(dtS, segs)   segs = array or (nowMs) => array; the clock advances by dtS first
 *   h.run(seconds)      runs `seconds` of game time in 1/60 s frames (optionally with a per-frame segment source)
 */
export function createHarness(mode = 'zen', seed = 1, options, { validate = false, waves = true } = {}) {
  const game = createGame(mode, seed, options);
  if (!waves) game.debugSetWavesEnabled(false);
  const h = {
    game,
    now: 0,
    events: [],
    swing: 0,
    snap: () => game.snapshot(),
    step(dtS = DT, segs = []) {
      h.now += dtS * 1000;
      const list = typeof segs === 'function' ? segs(h.now) : segs;
      game.update(dtS, list, h.now);
      const ev = game.drainEvents();
      for (const e of ev) h.events.push(e);
      if (validate) {
        assertValid('GameSnapshot', game.snapshot());
        for (const e of ev) assertValid('GameEvent', e);
      }
      return ev;
    },
    /** Run one update at an explicit clock value (ms), for tests that need exact timestamps. */
    at(nowMs, segs = [], dtS = Math.max(0, (nowMs - h.now) / 1000)) {
      h.now = nowMs;
      const list = typeof segs === 'function' ? segs(h.now) : segs;
      game.update(dtS, list, h.now);
      const ev = game.drainEvents();
      for (const e of ev) h.events.push(e);
      return ev;
    },
    run(seconds, { frameS = 1 / 60, segs = [] } = {}) {
      const frames = Math.round(seconds / frameS);
      for (let i = 0; i < frames; i++) {
        h.step(frameS, segs);
        if (game.isOver()) break;
      }
    },
    /** One frame with one segment (t1 = the frame's now). */
    cut(x0, y0, x1, y1, opts = {}) {
      return h.step(opts.dtS ?? DT, (now) => [makeSegment(x0, y0, x1, y1, now, { swingId: opts.swingId ?? ++h.swing, speed: opts.speed ?? 3000 })]);
    },
    /** Spawn at apex and cut through the centre with a short horizontal segment. */
    spawn: (spec) => game.debugSpawn({ atApex: true, ...spec }),
    ofType: (type) => h.events.filter((e) => e.type === type),
    clearEvents: () => { h.events.length = 0; },
    obj: (id) => game.snapshot().objects.find((o) => o.id === id),
  };
  return h;
}

/** Segment through the centre of a snapshot object (horizontal by default), length `len`. */
export function segmentThrough(o, now, { len = 80, angleDeg = 0, speed = 3000, swingId = 1 } = {}) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a) * len / 2;
  const dy = Math.sin(a) * len / 2;
  return makeSegment(o.x - dx, o.y - dy, o.x + dx, o.y + dy, now, { speed, swingId });
}

/**
 * A bot that never lets a round end: every frame it cuts every fruit, golden apple and medallion that is inside the
 * screen, with a short segment through the centre, choosing an angle that keeps clear of bombs.
 */
export function perfectBot(game) {
  let swing = 1000;
  const angles = [0, 90, 45, 135, 22, 112];
  return (now) => {
    const snap = game.snapshot();
    const bombs = snap.objects.filter((o) => o.kind === 'bomb');
    const segs = [];
    for (const o of snap.objects) {
      if (o.kind === 'bomb' || o.y > 900 || o.y < 40 || o.x < 40 || o.x > 1880) continue;
      for (const angle of angles) {
        const s = segmentThrough(o, now, { angleDeg: angle, swingId: ++swing });
        const clear = bombs.every((b) => distToSegment(s, b.x, b.y) > b.hitR + 25);
        if (clear) { segs.push(s); break; }
      }
    }
    return segs;
  };
}

export function distToSegment(s, cx, cy) {
  const dx = s.x1 - s.x0;
  const dy = s.y1 - s.y0;
  const len2 = dx * dx + dy * dy;
  let u = len2 > 0 ? ((cx - s.x0) * dx + (cy - s.y0) * dy) / len2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(s.x0 + u * dx - cx, s.y0 + u * dy - cy);
}

/** Order-sensitive digest of any JSON-able values (determinism tests). */
export function digest(values) {
  const hash = createHash('sha1');
  for (const v of values) hash.update(JSON.stringify(v));
  return hash.digest('hex');
}

/** Every number in a JSON-able value is finite. */
export function allFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allFinite);
  if (value && typeof value === 'object') return Object.values(value).every(allFinite);
  return true;
}

/**
 * Seeded chaos: 0 to 3 random segments per frame with random positions (also outside the screen), lengths from 6 px to
 * 3e6 px and speeds from 1 px/s to 1e9 px/s. Deterministic given the rng.
 */
export function chaosSegments(rng, now, state = { swing: 1 }) {
  const out = [];
  if (rng.next() < 0.45) {
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      if (rng.next() < 0.35) state.swing += 1;
      const len = 10 ** rng.range(0.8, 6.5);
      const ang = rng.range(0, Math.PI * 2);
      const x0 = rng.range(-300, 2200);
      const y0 = rng.range(-200, 1300);
      out.push(makeSegment(x0, y0, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len, now - rng.range(0, 8), {
        speed: 10 ** rng.range(0, 9), swingId: state.swing, spanMs: rng.range(1, 30),
      }));
    }
  }
  return out;
}

/** Bot that cuts only regular fruit and the golden apple (never bombs or medallions), so no timed power-up ever starts. */
export function fruitOnlyBot(game, { skipEvery = 0 } = {}) {
  let swing = 5000;
  const skipped = new Set();
  return (now) => {
    const snap = game.snapshot();
    const bombs = snap.objects.filter((o) => o.kind === 'bomb');
    const segs = [];
    for (const o of snap.objects) {
      if ((o.kind !== 'fruit' && o.kind !== 'golden') || o.y > 900 || o.y < 40 || o.x < 40 || o.x > 1880) continue;
      if (skipEvery > 0 && o.kind === 'fruit' && o.id % skipEvery === 0) { skipped.add(o.id); continue; }
      const s = segmentThrough(o, now, { angleDeg: 0, swingId: ++swing });
      if (bombs.every((b) => distToSegment(s, b.x, b.y) > b.hitR + 25)) segs.push(s);
    }
    return segs;
  };
}
