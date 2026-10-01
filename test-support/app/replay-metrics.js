// The contract metrics of docs/motion-contract.md section 5.2, measured on the INTEGRATED app path (test-support/app/replay-rig.js): the real recording's
// reports go through the BLE provider, the parser, app.js, the motion pipeline, the game and the UI, with 60 fps frames in between. OWNER: integrator.
//
// Used by test/app/real-replay-app.test.js (assertions) and tools/replay-integrated.mjs (the table the Integrator reports). The numbers are what the
// owner's recording does to this code. UNVERIFIED-ON-HARDWARE: one controller, one person; nothing here says how the sword feels.
import { buildInputReport } from '../../public/js/input/joycon2-build.js';
import { parseInputReport, hexToBytes, bytesToHex } from '../../public/js/input/joycon2-parse.js';
import { openReplayApp, play, windowReports, hardStrokes, FRAME_MS } from './replay-rig.js';

export const FIELD = Object.freeze({ w: 1920, h: 1080, cx: 960, cy: 540 });
export const range = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
export const sum = (a) => a.reduce((x, y) => x + y, 0);
export const mean = (a) => (a.length ? sum(a) / a.length : NaN);
export const sortedCopy = (a) => [...a].sort((x, y) => x - y);
export const quantile = (a, q) => {
  const s = sortedCopy(a);
  if (!s.length) return NaN;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};
export const median = (a) => quantile(a, 0.5);
export const onEdge = (r) => r.x <= 0.5 || r.x >= FIELD.w - 0.5 || r.y <= 0.5 || r.y >= FIELD.h - 0.5;
export const share = (rows, pred) => (rows.length ? (100 * rows.filter(pred).length) / rows.length : 0);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The windows of the contract (step, from s, to s). */
export const WINDOWS = Object.freeze({
  hold: ['hold_still', 7, Infinity],
  still: ['return_still', 2, Infinity],
  yaw: ['yaw_sweep', 1, 21],
  pitch: ['pitch_sweep', 1, 21],
  roll: ['roll_360', 2, 14],
  spin: ['table_spin_360', 2, 16],
  fastH: ['fast_swings_h', 0, Infinity],
  fastV: ['fast_swings_v', 0, Infinity],
});

/**
 * Replay one window through a fresh integrated app and collect what the app and Motion did.
 * @param {string} name @param {number} fromS @param {number} toS
 * @param {object} [o]
 * @param {object} [o.app]        openReplayApp options (sensitivity, cutThreshold, autoCenter, mode)
 * @param {Array}  [o.reports]    replace the recorded reports (posture injection)
 * @param {{x:number,y:number}} [o.reanchor]  put the cursor there before the first report (the test hook of __ninja)
 * @param {'cursor'|Array<{tMs:number,x:number,y:number}>|null} [o.probes]  hover fruit for the game: one under the cursor every 400 ms, or at given places and times
 */
export async function runWindow(name, fromS, toS, o = {}) {
  const rig = await openReplayApp(o.app ?? {});
  const { h } = rig;
  const motion = h.app.motion;
  const reports = o.reports ?? windowReports(name, fromS, toS);
  if (o.reanchor) motion.reanchor(o.reanchor.x, o.reanchor.y);
  const rows = [];
  const segs = [];
  const frames = [];
  const events = { recenter: [] };
  motion.on('recenter', (e) => events.recenter.push(e));
  let t0 = null;
  const probeList = Array.isArray(o.probes) ? [...o.probes].sort((a, b) => a.tMs - b.tMs) : [];
  let nextProbe = 0;
  let lastProbeT = -1e9;
  let spawned = 0;
  const spawn = (x, y) => {
    try {
      h.n.debug.spawn({ kind: 'fruit', type: 'apple', apexX: x, apexY: y, atApex: true, gScale: 0.05 });
      spawned += 1;
    } catch {
      /* the round ended */
    }
  };
  const res = await play(rig, reports, {
    onSample: (b) => {
      rows.push({
        t: b.t, x: b.x, y: b.y, vx: b.vx, vy: b.vy, cutting: b.cutting, disc: b.discontinuity, tip: b.speedDps, total: b.angularSpeedDps, swingId: b.swingId,
        segmentValid: b.segmentValid, x0: b.x0, y0: b.y0, t0: b.t0, ok: b.trackingOk, source: b.source,
      });
    },
    onSegments: (list) => { for (const s of list) segs.push({ t0: s.t0, x0: s.x0, y0: s.y0, t1: s.t1, x1: s.x1, y1: s.y1, speed: s.speed, swingId: s.swingId }); },
    onFrame: (tRel) => {
      const now = rig.clock.now();
      const m = motion.getState();
      const head = motion.headAt(now);
      const latest = motion.latest();
      frames.push({
        tRel, now, head, latest: latest ? { x: latest.x, y: latest.y, t: latest.t } : null, cutting: m.cutting, tip: m.speedDps, refDriven: m.refDriven, x: m.x, y: m.y,
        cutsSoFar: o.probes ? h.n.snapshot().stats.fruitCut : 0,
      });
    },
    onReport: (tMs) => {
      if (t0 === null) t0 = tMs;
      if (o.probes === 'cursor') {
        if (tMs - lastProbeT >= 400) {
          lastProbeT = tMs;
          const m = motion.getState();
          spawn(m.x, m.y);
        }
      } else {
        while (nextProbe < probeList.length && probeList[nextProbe].tMs <= tMs) {
          spawn(probeList[nextProbe].x, probeList[nextProbe].y);
          nextProbe += 1;
        }
      }
    },
  });
  const base = res.t0;
  for (const r of rows) r.t -= base;
  for (const s of segs) { s.t0 -= base; s.t1 -= base; }
  for (const r of rows) r.t0 -= base;
  const stats = h.n.snapshot().stats;
  const out = {
    rows: rows.filter((r) => r.ok && r.source === 'imu'), // the synthetic "tracking lost" sample at the end is not a measurement
    segs, frames, events, spawned, fruitCut: stats.fruitCut, fruitMissed: stats.fruitMissed, problems: h.problems(), reports: reports.length, run: res,
    app: rig,
  };
  rig.dispose();
  return out;
}

/** Posture change (contract A8): add `zDps` to gyro z and `xDps` to gyro x from `fromMs` to `toMs`, through the real report layout. */
export function injectPosture(reports, { fromMs = 500, toMs = 2500, zDps = 15, xDps = 10 } = {}) {
  return reports.map((r) => {
    if (r.tMs < fromMs || r.tMs >= toMs) return r;
    const p = parseInputReport(hexToBytes(r.hex));
    const bytes = buildInputReport({
      counter: p.counter, imuTimestampUs: p.imuTimestampUs, batteryMv: p.batteryMv, temperatureRaw: p.temperatureRaw,
      accelRaw: p.accelRaw, gyroRaw: { x: p.gyroRaw.x + Math.round(xDps / 0.06103515625), y: p.gyroRaw.y, z: p.gyroRaw.z + Math.round(zDps / 0.06103515625) },
    });
    return { ...r, hex: bytesToHex(bytes) };
  });
}

// ---------------------------------------------------------------------------------------------------------------- per metric

/** A1: cursor range and CUTTING share in a window that holds still. */
export function holdStats(w) {
  return { n: w.rows.length, rangeX: range(w.rows.map((r) => r.x)), rangeY: range(w.rows.map((r) => r.y)), cutting: share(w.rows, (r) => r.cutting), falseCuts: w.fruitCut };
}

/** A2: coverage of a sweep. */
export function coverage(w) {
  return {
    xPct: (100 * range(w.rows.map((r) => r.x))) / FIELD.w,
    yPct: (100 * range(w.rows.map((r) => r.y))) / FIELD.h,
    boundary: share(w.rows, onEdge),
    cutting: share(w.rows, (r) => r.cutting),
  };
}

/**
 * A4 and A9 for the hard strokes of a fast-swing step. `w` is a whole-step replay (with probes at the strokes for the game-level result).
 * Cut = CUTTING within 60 ms of the peak and the emitted segments cover at least 50 % of the cursor path inside the stroke extent.
 */
export function strokeOutcomes(name, w, T = 300) {
  const strokes = hardStrokes(name);
  return strokes.map((s) => {
    const inExt = w.rows.filter((r) => r.t >= s.t0Ms - 30 && r.t <= s.t1Ms);
    let path = 0;
    for (let i = 1; i < inExt.length; i += 1) path += dist(inExt[i - 1], inExt[i]);
    const segs = w.segs.filter((g) => g.t1 >= s.t0Ms - 30 && g.t1 <= s.t1Ms + 35);
    const covered = sum(segs.map((g) => Math.hypot(g.x1 - g.x0, g.y1 - g.y0)));
    const cutNearPeak = w.rows.some((r) => Math.abs(r.t - s.tPeakMs) <= 60 && r.cutting);
    const share01 = path > 0 ? Math.min(1, covered / path) : 0;
    // A9: the first sample at or above T inside the extent, and the first CUTTING sample after it
    const first = inExt.find((r) => r.tip >= T);
    const firstCut = first ? w.rows.find((r) => r.t >= first.t && r.cutting) : null;
    const onsetMs = first && firstCut ? firstCut.t - first.t : null;
    const prevT = first ? (w.rows.filter((r) => r.t < first.t).at(-1)?.t ?? first.t) : null;
    const retro = first ? w.segs.some((g) => g.t0 <= prevT + 0.5 && g.t1 > prevT + 0.5) : false; // a chord that starts at or before the sample that preceded the first fast one
    return {
      peakDps: s.peakDps, tPeakMs: s.tPeakMs, cutNearPeak, pathShare: 100 * share01, cut: cutNearPeak && share01 >= 0.5, onsetMs, retro, path,
      frames: w.frames.filter((f) => f.tRel >= s.t0Ms - 200 && f.tRel <= s.t1Ms + 300),
    };
  });
}

/** Game-level result of the probes placed on the hard strokes: how many of them the game really cut. */
export function probeCuts(strokes, w) {
  return strokes.map((s) => {
    const before = [...w.frames].reverse().find((f) => f.tRel <= s.tPeakMs - 200) ?? w.frames[0];
    const after = w.frames.find((f) => f.tRel >= s.tPeakMs + 400) ?? w.frames.at(-1);
    return after.cutsSoFar - before.cutsSoFar;
  });
}

/** Cursor position at a time (ms from the start of the window), linear between samples. */
export function positionAt(rows, tMs) {
  let prev = rows[0];
  for (const r of rows) {
    if (r.t >= tMs) {
      if (r === prev || r.t === prev.t) return { x: r.x, y: r.y };
      const f = (tMs - prev.t) / (r.t - prev.t);
      return { x: prev.x + (r.x - prev.x) * f, y: prev.y + (r.y - prev.y) * f };
    }
    prev = r;
  }
  return { x: prev.x, y: prev.y };
}

/** A strokes replay in two passes: the first finds where the cursor is at every stroke peak, the second hangs an apple there before the stroke. */
export async function strokesWithProbes(name, app = {}) {
  const pass1 = await runWindow(name, 0, Infinity, { app });
  const strokes = hardStrokes(name);
  const probes = strokes.map((s) => ({ tMs: s.tPeakMs - 200, ...positionAt(pass1.rows, s.tPeakMs) }));
  const w = await runWindow(name, 0, Infinity, { app, probes });
  const out = strokeOutcomes(name, w);
  const cuts = probeCuts(strokes.map((s) => ({ tPeakMs: s.tPeakMs })), w);
  out.forEach((s, i) => { s.gameCuts = cuts[i]; });
  return { w, strokes: out, gameCutsTotal: w.fruitCut, spawned: w.spawned };
}

/** A6: the path between two samples. */
export function noTunnelling(w) {
  const segs = w.segs;
  const longest = Math.max(0, ...segs.map((g) => Math.hypot(g.x1 - g.x0, g.y1 - g.y0)));
  // contiguity inside a run: a segment that starts where the previous one ended, in time and in place, is contiguous; a different swing may start anywhere
  // (two chords with a non-cutting sample between them belong to two runs: a swing that resumes within the 100 ms grace keeps its id but is a new run)
  let gaps = 0;
  for (let i = 1; i < segs.length; i += 1) {
    const a = segs[i - 1];
    const b = segs[i];
    if (Math.abs(b.t0 - a.t1) <= 1e-6 && Math.hypot(b.x0 - a.x1, b.y0 - a.y1) <= 0.5) continue;
    if (w.rows.some((r) => r.t > a.t1 + 1e-6 && r.t <= b.t0 + 1e-6 && !r.cutting)) continue;
    gaps += 1;
  }
  // dense reference: the quadratic path between consecutive real samples (from x, y, vx, vy), 1 ms apart, inside the cut runs; the largest distance to the union of segments
  const pts = w.rows;
  let worst = 0;
  let maxStep = 0;
  const segAt = segs.slice();
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dtMs = b.t - a.t;
    if (b.disc || dtMs <= 0 || dtMs >= 200) continue;
    maxStep = Math.max(maxStep, dist(a, b));
    if (!(a.cutting && b.cutting)) continue;
    const dt = dtMs / 1000;
    for (let ms = 1; ms < dtMs; ms += 1) {
      const tau = ms / 1000;
      const x = Math.min(FIELD.w, Math.max(0, a.x + a.vx * tau + 0.5 * ((b.vx - a.vx) / dt) * tau * tau));
      const y = Math.min(FIELD.h, Math.max(0, a.y + a.vy * tau + 0.5 * ((b.vy - a.vy) / dt) * tau * tau));
      let best = Infinity;
      for (const g of segAt) {
        if (g.t1 < a.t - 1 || g.t0 > b.t + 1) continue;
        const vx = g.x1 - g.x0;
        const vy = g.y1 - g.y0;
        const L2 = vx * vx + vy * vy;
        const f = L2 > 0 ? Math.max(0, Math.min(1, ((x - g.x0) * vx + (y - g.y0) * vy) / L2)) : 0;
        best = Math.min(best, Math.hypot(x - (g.x0 + vx * f), y - (g.y0 + vy * f)));
      }
      if (best !== Infinity) worst = Math.max(worst, best);
    }
  }
  return { segments: segs.length, longestChord: longest, gaps, worstDenseDistance: worst, maxSampleStep: maxStep, peakCursorPxS: Math.max(0, ...pts.map((r) => Math.hypot(r.vx, r.vy))) };
}

/**
 * The 60 fps view: what the game's blade head does between two 33 Hz reports. `stroke` frames are those inside a hard stroke.
 * error = distance of the extrapolated head to the quadratic truth between the two real samples around the frame (A7);
 * stutter = coefficient of variation of the frame-to-frame step of the head, against the same number for "hold the last real sample" (what a pointer without
 * interpolation shows at 33 Hz on a 60 Hz screen).
 */
export function frameSmoothness(w, strokeFrames) {
  const rows = w.rows;
  const errs = [];
  for (const f of strokeFrames) {
    if (!f.head) continue;
    // the real samples around the frame time (frames run at the moment of the clock; the sample times are in device time from the window start)
    let k = -1;
    for (let i = 0; i < rows.length - 1; i += 1) if (rows[i].t <= f.tRel && rows[i + 1].t > f.tRel) { k = i; break; }
    if (k < 0) continue;
    const a = rows[k];
    const b = rows[k + 1];
    const dt = (b.t - a.t) / 1000;
    if (!(dt > 0) || b.disc || dt > 0.2) continue;
    const tau = (f.tRel - a.t) / 1000;
    const tx = Math.min(FIELD.w, Math.max(0, a.x + a.vx * tau + 0.5 * ((b.vx - a.vx) / dt) * tau * tau));
    const ty = Math.min(FIELD.h, Math.max(0, a.y + a.vy * tau + 0.5 * ((b.vy - a.vy) / dt) * tau * tau));
    // a frame that falls before the next sample cannot know it: the head is extrapolated from `a`, the truth comes from the path to `b`
    errs.push({ head: Math.hypot(f.head.x - tx, f.head.y - ty), hold: Math.hypot(a.x - tx, a.y - ty) });
  }
  const steps = (get) => {
    const out = [];
    for (let i = 1; i < strokeFrames.length; i += 1) {
      const p = get(strokeFrames[i - 1]);
      const q = get(strokeFrames[i]);
      if (p && q) out.push(dist(p, q));
    }
    return out;
  };
  const cv = (a) => (a.length && mean(a) > 0 ? Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2))) / mean(a) : NaN);
  const headSteps = steps((f) => f.head);
  const holdSteps = steps((f) => f.latest);
  return {
    frames: strokeFrames.length,
    headErrMean: mean(errs.map((e) => e.head)), headErrP95: quantile(errs.map((e) => e.head), 0.95), headErrMax: Math.max(0, ...errs.map((e) => e.head)),
    holdErrMean: mean(errs.map((e) => e.hold)), holdErrP95: quantile(errs.map((e) => e.hold), 0.95), holdErrMax: Math.max(0, ...errs.map((e) => e.hold)),
    stutterHead: cv(headSteps), stutterHold: cv(holdSteps),
    stalledHead: share(headSteps.map((v) => ({ v })), (r) => r.v < 1), stalledHold: share(holdSteps.map((v) => ({ v })), (r) => r.v < 1),
  };
}

/** A5: the idle glide from a placed cursor. Times from the first sample until the cursor is within 100 and 20 px of the centre. */
export async function autoCentreRun(from, { autoCenter = true, mode } = {}) {
  const w = await runWindow('return_still', 2, Infinity, { app: { autoCenter, mode }, reanchor: from });
  const rows = w.rows;
  const within = (px) => rows.find((r) => Math.hypot(r.x - FIELD.cx, r.y - FIELD.cy) <= px);
  const a = within(100);
  const b = within(20);
  return {
    from, t100: a ? a.t / 1000 : null, t20: b ? b.t / 1000 : null,
    rangeAfterStart: Math.max(range(rows.slice(2).map((r) => r.x)), range(rows.slice(2).map((r) => r.y))),
    autoEvents: w.events.recenter.filter((e) => e.kind === 'auto').length,
    refDrivenWhileFast: w.frames.filter((f) => f.refDriven && (f.cutting || f.tip > 21)).length,
    startOffset: rows.length ? dist(rows[0], from) : null,
  };
}

/** A5b: frames on which the cursor was being dragged by the idle glide or a recentre ease while the blade was cutting or moving at more than 21 deg/s. */
export const refDrivenWhileSwinging = (w) => w.frames.filter((f) => f.refDriven && (f.cutting || f.tip > 21)).length;

export { FRAME_MS, windowReports, hardStrokes };
