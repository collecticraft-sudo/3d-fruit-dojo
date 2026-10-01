// Independent verifier library (motion verification round 1, docs/motion-verification-round-1.md). Written from docs/motion-contract.md only; uses the public pipeline API and the real parser.
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const P = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const imp = (rel) => import(pathToFileURL(`${P}/${rel}`).href);
export const parse = await imp('public/js/input/joycon2-parse.js');
export const motion = await imp('public/js/motion/index.js');
export const validate = await imp('public/js/shared/validate.js');
export const { createMotionPipeline, MOTION_CONFIG } = motion;

export const FIELD = { w: 1920, h: 1080, cx: 960, cy: 540 };

// ---- seeded rng
export function rng(seed) {
  let s = seed >>> 0;
  const u = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const n = () => { const a = Math.max(u(), 1e-12); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * u()); };
  return { u, n };
}

export const median = (a) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : 0.5 * (b[m - 1] + b[m]); };
export const quant = (a, q) => { if (!a.length) return NaN; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.max(0, Math.round(q * (b.length - 1))))]; };
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const range = (a) => (a.length ? Math.max(...a) - Math.min(...a) : NaN);

// ---- recording
const REC = `${P}/recordings/imu-2026-09-30T18-42-24.jsonl`;
let cache = null;
export function loadRecording() {
  if (cache) return cache;
  const rows = readFileSync(REC, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const steps = {}; const order = [];
  let prevUs = null; let prevStep = null; let t = 0; let total = 0; let active = 0;
  for (const r of rows) {
    if (!r.hex || !r.step) continue;
    total++;
    const p = parse.parseInputReport(parse.hexToBytes(r.hex));
    if (!p || !p.imuActive) continue;
    active++;
    if (r.step !== prevStep) { steps[r.step] = []; order.push(r.step); prevStep = r.step; prevUs = null; t = 0; }
    const dt = prevUs === null ? null : ((p.imuTimestampUs - prevUs) >>> 0) / 1000;
    prevUs = p.imuTimestampUs;
    if (dt !== null) t += dt;
    steps[r.step].push({ t, dt, g: { x: p.gyroRaw.x * parse.GYRO_DPS_PER_LSB, y: p.gyroRaw.y * parse.GYRO_DPS_PER_LSB, z: p.gyroRaw.z * parse.GYRO_DPS_PER_LSB }, a: { x: p.accelRaw.x / 4096, y: p.accelRaw.y / 4096, z: p.accelRaw.z / 4096 }, raw: p.gyroRaw });
  }
  cache = { steps, order, total, active };
  return cache;
}

/** My own bias: median of the rest_table window 4 s .. end (trimmed: the owner handled the device at the start). */
export function ownBias() {
  const l = loadRecording().steps.rest_table.filter((s) => s.t >= 4000);
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
 * Build ImuSamples from a list of {t, g, a} (device ms from window start). Options:
 *   from, to seconds window; loss: probability of dropping a sample; jitter: sigma ms added to the DEVICE timestamp (t and dt consistent);
 *   arrivalJitter: sigma ms added to t only (dt = device delta, what the real stream does: device dt is kept);
 *   dtArrival: use arrival-delta dt with dtSource 'arrival' (the fallback path); timeScale: multiply time by k;
 *   rateScale: multiply the gyro vector by k (physical speed scaling together with timeScale = 1/k); mapG: fn(g, tMs) -> g.
 */
export function makeSamples(list, o = {}) {
  const from = (o.from ?? 0) * 1000; const to = (o.to ?? Infinity) * 1000;
  const r = rng(o.seed ?? 1);
  let l = list.filter((s) => s.t >= from && s.t < to);
  const t0 = l[0].t;
  const out = []; let prevDev = null; let prevArr = null; let seq = 0;
  for (const s of l) {
    if (o.loss && seq > 0 && r.u() < o.loss) continue; // dropped packet (never the first)
    const devBase = (s.t - t0) * (o.timeScale ?? 1);
    const dev = devBase + (o.jitter ? r.n() * o.jitter : 0);
    const devT = prevDev === null ? dev : Math.max(dev, prevDev + 0.5);
    const arr = devT + (o.arrivalJitter ? r.n() * o.arrivalJitter : 0);
    const arrT = prevArr === null ? arr : Math.max(arr, prevArr + 0.1);
    let g = { ...s.g };
    if (o.rateScale) g = { x: g.x * o.rateScale, y: g.y * o.rateScale, z: g.z * o.rateScale };
    if (o.mapG) g = o.mapG(g, devBase);
    const dtDev = prevDev === null ? null : devT - prevDev;
    const dtArr = prevArr === null ? null : arrT - prevArr;
    out.push({
      seq: seq++, t: o.dtArrival ? arrT : devT, arrivedAt: arrT,
      dtMs: o.dtArrival ? dtArr : dtDev, dtSource: o.dtArrival ? 'arrival' : 'device',
      accel: { ...s.a }, gyro: g, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true,
      _dev: devT,
    });
    prevDev = devT; prevArr = arrT;
  }
  return out;
}

export function stepList(name) { return loadRecording().steps[name]; }

// ---- replay through the real pipeline
export function mkPipe({ settings, pointerModel = 'relative', cal, config } = {}) {
  const pipe = createMotionPipeline({ pointerModel, settings, config });
  pipe.setCalibration(cal === undefined ? calibration() : cal);
  return pipe;
}

/**
 * Feed samples. Collects per sample: blade (event), segments drained right after, optional headAt probes.
 * opts.check: validate every BladeSample/BladeSegment with the project's validator; opts.reanchor {x,y} before the first sample;
 * opts.onSample(pipe, s, rowsSoFar) hook; opts.poll default true.
 */
export function replay(pipe, samples, opts = {}) {
  const res = { rows: [], segs: [], recenters: [], warnings: [], violations: [] };
  let cur = null;
  pipe.on('blade', (b) => { if (cur) cur.push(b); });
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
    const row = { s, b, dev: s._dev ?? s.t, segs };
    res.rows.push(row);
    if (opts.onSample) opts.onSample(pipe, s, row, res);
  }
  return res;
}

// ---- hard strokes (contract 5.1 definition, written again)
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
    out.push({ peak: v[pk], tPeak: l[pk].t, t0: l[a].t, t1: l[b].t, idx: pk });
  }
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Stroke evaluation on a replay of a whole step (device time = row.dev, not jittered when jitter is 0). `devOf` maps replay time to step time. */
export function evalStrokes(res, strokes, o = {}) {
  const tScale = o.timeScale ?? 1;
  const out = [];
  // map device time of a row back to original step time via rows' sample order is not available with loss; use row.dev / tScale
  const rows = res.rows.filter((r) => r.b);
  for (const st of strokes) {
    const t0 = st.t0 * tScale; const t1 = st.t1 * tScale; const tp = st.tPeak * tScale;
    const inExt = rows.filter((r) => r.dev > t0 && r.dev <= t1);
    let pathLen = 0;
    for (const r of inExt) {
      const i = rows.indexOf(r); const prev = rows[i - 1];
      if (prev && !r.b.discontinuity) pathLen += dist(prev.b, r.b);
    }
    let segLen = 0;
    for (const r of rows) for (const g of r.segs) { if (r.dev > t0 && r.dev <= t1 + 1) segLen += Math.hypot(g.x1 - g.x0, g.y1 - g.y0); }
    const near = rows.filter((r) => Math.abs(r.dev - tp) <= 60 * tScale + 1e-9 && r.b.cutting);
    // also the retroactive one: rows whose segments come from candidate chords are counted through segLen
    const share = pathLen > 1e-6 ? Math.min(1, segLen / pathLen) : 0;
    // onset: first row with speedDps >= 300 inside [t0-60, t1]; first cutting row after
    const firstAbove = rows.find((r) => r.dev >= t0 - 60 * tScale && r.dev <= t1 && r.b.speedDps >= (o.T ?? 300));
    const firstCut = firstAbove ? rows.find((r) => r.dev >= firstAbove.dev && r.b.cutting) : null;
    const onset = firstAbove && firstCut ? (firstCut.dev - firstAbove.dev) / tScale : null;
    let retro = false;
    if (firstAbove) {
      const i = rows.indexOf(firstAbove); const prev = rows[i - 1];
      const tBefore = prev ? prev.dev : firstAbove.dev;
      retro = res.segs.some((g) => g.t0 <= (prev ? prev.s.t : firstAbove.s.t) + 0.5 && g.t1 > (prev ? prev.s.t : firstAbove.s.t));
      void tBefore;
    }
    out.push({ peak: st.peak, cutNear: near.length > 0, share, segLen, pathLen, onset, retro });
  }
  return out;
}

export const inField = (b) => b.x <= 0.5 || b.x >= FIELD.w - 0.5 || b.y <= 0.5 || b.y >= FIELD.h - 0.5;
export function holdStats(res) {
  const xs = res.rows.filter((r) => r.b).map((r) => r.b.x); const ys = res.rows.filter((r) => r.b).map((r) => r.b.y);
  const cut = res.rows.filter((r) => r.b && r.b.cutting).length / Math.max(1, xs.length);
  return { rx: range(xs), ry: range(ys), cut: 100 * cut, n: xs.length };
}
export function coverage(res) {
  const b = res.rows.filter((r) => r.b).map((r) => r.b);
  return { xPct: 100 * range(b.map((q) => q.x)) / FIELD.w, yPct: 100 * range(b.map((q) => q.y)) / FIELD.h, boundary: 100 * b.filter(inField).length / b.length, cut: 100 * b.filter((q) => q.cutting).length / b.length };
}
