// Independent verifier, round 2 (docs/motion-verification-round-2.md). Written from docs/motion-contract.md; uses only the public pipeline
// API, the real parser and the real validator. Does NOT import test-support/motion/*, tools/replay-*.mjs or tools/verify-round-1/*.
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const P = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const imp = (rel) => import(pathToFileURL(`${P}/${rel}`).href);
export const parse = await imp('public/js/input/joycon2-parse.js');
export const motion = await imp('public/js/motion/index.js');
export const validate = await imp('public/js/shared/validate.js');
export const { createMotionPipeline, MOTION_CONFIG } = motion;
export const FIELD = { w: 1920, h: 1080, cx: 960, cy: 540 };

export function rng(seed) {
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = () => Math.sqrt(-2 * Math.log(Math.max(u(), 1e-12))) * Math.cos(2 * Math.PI * u());
  return { u, n };
}
export const sorted = (a) => [...a].sort((x, y) => x - y);
export const quant = (a, q) => { if (!a.length) return NaN; const b = sorted(a); const i = (b.length - 1) * q; const lo = Math.floor(i); return b[lo] + (b[Math.min(b.length - 1, lo + 1)] - b[lo]) * (i - lo); };
export const median = (a) => quant(a, 0.5);
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const range = (a) => { let lo = Infinity; let hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; } return a.length ? hi - lo : NaN; };
export const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
export const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));

const REC = `${P}/recordings/imu-2026-09-30T18-42-24.jsonl`;
let cache = null;
/** steps[name] = [{t (ms from the step's first report), dt (ms or null), g {x,y,z} dps raw, a {x,y,z} g, hex, buttons}] */
export function loadRecording() {
  if (cache) return cache;
  const rows = readFileSync(REC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const steps = {}; const order = []; const stepsHex = {};
  let prevUs = null; let prevStep = null; let t = 0; let n = 0; let active = 0;
  for (const r of rows) {
    if (!r.hex || !r.step) continue;
    n++;
    const p = parse.parseInputReport(parse.hexToBytes(r.hex));
    if (!p || !p.imuActive) continue;
    active++;
    if (r.step !== prevStep) { steps[r.step] = []; order.push(r.step); prevStep = r.step; prevUs = null; t = 0; }
    const dt = prevUs === null ? null : parse.imuDeltaUs(prevUs, p.imuTimestampUs) / 1000;
    prevUs = p.imuTimestampUs;
    if (dt !== null) t += dt;
    steps[r.step].push({
      t, dt, hex: r.hex,
      g: { x: p.gyroRaw.x * parse.GYRO_DPS_PER_LSB, y: p.gyroRaw.y * parse.GYRO_DPS_PER_LSB, z: p.gyroRaw.z * parse.GYRO_DPS_PER_LSB },
      a: { x: p.accelRaw.x / 4096, y: p.accelRaw.y / 4096, z: p.accelRaw.z / 4096 },
    });
  }
  cache = { steps, order, n, active, stepsHex };
  return cache;
}
export const stepList = (name) => loadRecording().steps[name];

/** Own bias: median of rest_table from 4 s on (the owner handled the device in the first seconds). */
export function ownBias() {
  const l = stepList('rest_table').filter((s) => s.t >= 4000);
  return { x: median(l.map((s) => s.g.x)), y: median(l.map((s) => s.g.y)), z: median(l.map((s) => s.g.z)) };
}
export function calibration(bias = ownBias(), extra = {}) {
  return {
    version: 1, side: 'R', createdAt: 0,
    frame: { right: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 1, z: 0 }, up: { x: 0, y: 0, z: 1 } },
    gyroBiasDps: { ...bias }, gyroSign: 1, gyroScale: 1, gyroScaleSource: 'default', accelG0: 1,
    quality: { poseAngleDeg: 90, stillPeakDps: 1, warnings: [] }, ...extra,
  };
}

/**
 * ImuSamples from a list of step rows. o: from/to (s); loss (probability, never the first); jitter (sigma ms on the DEVICE time);
 * arrivalJitter (sigma ms on t only); dtArrival; timeScale (multiplies time); rateScale (multiplies the gyro); mapG(g, tMs); mapA.
 */
export function makeSamples(list, o = {}) {
  const from = (o.from ?? 0) * 1000; const to = (o.to ?? Infinity) * 1000;
  const r = rng(o.seed ?? 1);
  const l = list.filter((s) => s.t >= from && s.t < to);
  const t0 = l[0].t;
  const out = []; let prevDev = null; let prevArr = null; let seq = 0;
  for (const s of l) {
    if (o.loss && seq > 0 && r.u() < o.loss) continue;
    const base = (s.t - t0) * (o.timeScale ?? 1);
    const dev0 = base + (o.jitter ? r.n() * o.jitter : 0);
    const dev = prevDev === null ? dev0 : Math.max(dev0, prevDev + 0.5);
    const arr0 = dev + (o.arrivalJitter ? r.n() * o.arrivalJitter : 0);
    const arr = prevArr === null ? arr0 : Math.max(arr0, prevArr + 0.1);
    let g = { ...s.g };
    if (o.rateScale) g = { x: g.x * o.rateScale, y: g.y * o.rateScale, z: g.z * o.rateScale };
    if (o.mapG) g = o.mapG(g, base);
    const a = o.mapA ? o.mapA({ ...s.a }, base) : { ...s.a };
    out.push({
      seq: seq++, t: o.dtArrival ? arr : dev, arrivedAt: arr,
      dtMs: o.dtArrival ? (prevArr === null ? null : arr - prevArr) : (prevDev === null ? null : dev - prevDev),
      dtSource: o.dtArrival ? 'arrival' : 'device',
      accel: a, gyro: g, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true, _dev: dev, _orig: s.t,
    });
    prevDev = dev; prevArr = arr;
  }
  return out;
}

export function mkPipe({ settings, pointerModel = 'relative', cal, config } = {}) {
  const pipe = createMotionPipeline({ pointerModel, settings, config });
  pipe.setCalibration(cal === undefined ? calibration() : cal);
  return pipe;
}

/** Feed samples to the pipeline; per sample: the blade event, the drained segments, optional recent() snapshot. */
export function replay(pipe, samples, opts = {}) {
  const res = { rows: [], segs: [], recenters: [], warnings: [], violations: [], snapshots: [] };
  let cur = null;
  pipe.on('blade', (b) => { if (cur) cur.push({ ...b }); });
  pipe.on('recenter', (e) => res.recenters.push(e));
  pipe.on('warning', (e) => res.warnings.push(e));
  if (opts.reanchor) pipe.reanchor(opts.reanchor.x, opts.reanchor.y);
  for (const s of samples) {
    cur = [];
    pipe.pushImu(s);
    if (opts.poll !== false) pipe.poll(s.t);
    const segs = pipe.drainSegments();
    if (opts.check) {
      try { for (const b of cur) validate.assertValid('BladeSample', b); for (const g of segs) validate.assertValid('BladeSegment', g); } catch (e) { res.violations.push(String(e.message).slice(0, 200)); }
    }
    for (const g of segs) res.segs.push(g);
    const b = cur.at(-1) ?? null;
    const row = { s, b, dev: s._dev ?? s.t, segs, state: opts.state ? pipe.getState() : null };
    res.rows.push(row);
    if (opts.onSample) opts.onSample(pipe, s, row, res);
  }
  return res;
}

/** Hard strokes per the contract 5.1 definition, implemented again. */
export function hardStrokes(name, bias = ownBias()) {
  const l = stepList(name);
  const v = l.map((s) => Math.hypot(s.g.x - bias.x, s.g.y - bias.y, s.g.z - bias.z));
  const peaks = [];
  for (let i = 1; i < l.length - 1; i++) if (v[i] >= 150 && v[i] >= v[i - 1] && v[i] > v[i + 1]) peaks.push(i);
  const merged = [];
  for (const i of peaks) {
    const last = merged.at(-1);
    if (last !== undefined && l[i].t - l[last].t < 250) { if (v[i] > v[last]) merged[merged.length - 1] = i; } else merged.push(i);
  }
  const out = [];
  for (const pk of merged) {
    let ap = 0;
    for (let i = Math.max(0, pk - 3); i <= Math.min(l.length - 1, pk + 3); i++) ap = Math.max(ap, Math.hypot(l[i].a.x, l[i].a.y, l[i].a.z));
    if (ap < 2.0) continue;
    let a = pk; while (a > 0 && v[a - 1] > 100 && !(v[a - 1] > v[a] && v[a] < 0.5 * v[pk])) a--;
    let b = pk; while (b < l.length - 1 && v[b + 1] > 100 && !(v[b + 1] > v[b] && v[b] < 0.5 * v[pk])) b++;
    out.push({ peak: v[pk], tPeak: l[pk].t, t0: l[a].t, t1: l[b].t });
  }
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/**
 * Per stroke: is there a CUTTING sample within 60 ms of the peak, and what share of the cursor path inside the extent lies in emitted segments?
 * `samples` (from makeSamples) carry _orig (original step time) so this works with loss, jitter and time scaling (windows are in original time).
 */
export function evalStrokes(res, strokes, T = 300) {
  const rows = res.rows.filter((r) => r.b);
  const out = [];
  for (const st of strokes) {
    const inExt = rows.filter((r) => r.s._orig > st.t0 && r.s._orig <= st.t1);
    let pathLen = 0; let segLen = 0;
    for (const r of inExt) {
      const i = rows.indexOf(r); const prev = rows[i - 1];
      if (prev && !r.b.discontinuity) pathLen += dist(prev.b, r.b);
      for (const g of r.segs) segLen += Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    }
    const cutNear = rows.some((r) => Math.abs(r.s._orig - st.tPeak) <= 60 + 1e-9 && r.b.cutting);
    const firstAbove = rows.find((r) => r.s._orig >= st.t0 - 60 && r.s._orig <= st.t1 && r.b.speedDps >= T);
    const firstCut = firstAbove ? rows.find((r) => r.s._orig >= firstAbove.s._orig && r.b.cutting) : null;
    const onset = firstAbove && firstCut ? firstCut.s._orig - firstAbove.s._orig : null;
    let retro = false;
    if (firstAbove) {
      const i = rows.indexOf(firstAbove); const prev = rows[i - 1];
      const tb = (prev ?? firstAbove).s.t;
      retro = res.segs.some((g) => g.t0 <= tb + 0.5 && g.t1 > tb);
    }
    out.push({ peak: st.peak, cutNear, share: pathLen > 1e-6 ? Math.min(1, segLen / pathLen) : 0, onset, retro });
  }
  return out;
}
export const onEdge = (b) => b.x <= 0.5 || b.x >= FIELD.w - 0.5 || b.y <= 0.5 || b.y >= FIELD.h - 0.5;
export function stats(res) {
  const b = res.rows.filter((r) => r.b).map((r) => r.b);
  return {
    n: b.length, rx: range(b.map((q) => q.x)), ry: range(b.map((q) => q.y)),
    xPct: 100 * range(b.map((q) => q.x)) / FIELD.w, yPct: 100 * range(b.map((q) => q.y)) / FIELD.h,
    boundary: 100 * b.filter(onEdge).length / Math.max(1, b.length), cut: 100 * b.filter((q) => q.cutting).length / Math.max(1, b.length),
  };
}
export const cutSeq = (res) => res.rows.map((r) => (r.b && r.b.cutting ? 1 : 0)).join('');
