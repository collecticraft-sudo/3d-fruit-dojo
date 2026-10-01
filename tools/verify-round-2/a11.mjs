// Verifier round 2: A11 (cut state machine) re-derived with synthetic tip-speed profiles through pushImu (yaw about the device z axis, identity frame).
import { mkPipe, calibration, replay } from './lib.mjs';
function prof(speeds, { hz = 33.333, gapAt = null, gapMs = 60 } = {}) {
  const dt = 1000 / hz; const out = []; let t = 0;
  speeds.forEach((s, i) => { if (gapAt === i) t += gapMs - dt; out.push({ seq: i, t, arrivedAt: t, dtMs: i === 0 ? null : (gapAt === i ? gapMs : dt), dtSource: 'device', accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: -s }, side: 'R', buttons: [], batteryMv: 3435, tempC: null, imuActive: true }); t += dt; });
  return out;
}
const run = (speeds, o = {}, settings = {}) => { const pipe = mkPipe({ settings: { autoCenter: false, ...settings }, cal: calibration({ x: 0, y: 0, z: 0 }) }); const res = replay(pipe, prof(speeds, o), {}); return res; };
const cutRows = (res) => res.rows.map((r) => (r.b && r.b.cutting ? 1 : 0)).join('');
const ids = (res) => [...new Set(res.rows.filter((r) => r.b && r.b.cutting).map((r) => r.b.swingId))];
const z = (n) => Array(n).fill(0);
const T = (name, ok, extra = '') => console.log(`${ok ? 'PASS' : '**FAIL**'}  ${name} ${extra}`);
let r;
r = run([...z(3), ...Array(10).fill(290), ...z(3)]); T('290 deg/s never cuts', !cutRows(r).includes('1'), cutRows(r));
r = run([...z(3), 310, 310, 310, 310, ...z(3)]); T('310 deg/s for four samples cuts', cutRows(r).includes('1'), cutRows(r));
r = run([...z(3), 310, 310, ...z(3)]); T('310 for exactly two samples cuts (25 ms rule: 30 ms apart)', cutRows(r).includes('1'), cutRows(r));
r = run([...z(3), 600, ...z(3)]); T('one sample at 600 never cuts', !cutRows(r).includes('1'), cutRows(r));
r = run([...z(3), 600, 250, 600, ...z(3)]); T('600, 250 (above the release 195), 600 : dip keeps the candidate and cuts', cutRows(r).includes('1'), cutRows(r));
r = run([...z(3), 400, 400, 210, 400, 400, ...z(3)]); T('dip to 210 keeps the swing (one swing id)', ids(r).length === 1 && /1{3,}/.test(cutRows(r)), cutRows(r) + ' ids ' + ids(r));
r = run([...z(3), 400, 400, 190, 400, 400, ...z(3)]); T('dip to 190 ends the cut; re-entry within 100 ms keeps the swing id', ids(r).length === 1, cutRows(r) + ' ids ' + ids(r));
r = run([...z(3), 400, 400, 190, z(1)[0], z(1)[0], z(1)[0], z(1)[0], 400, 400, ...z(3)]); T('re-entry after 150 ms starts a NEW swing id', ids(r).length === 2, cutRows(r) + ' ids ' + ids(r));
r = run([...z(3), 280, 280, 280, 280, ...z(3)], {}, { cutMul: 0.8 }); T('cutMul 0.8 -> 240: 280 cuts', cutRows(r).includes('1'), cutRows(r));
r = run([...z(3), 230, 230, 230, 230, ...z(3)], {}, { cutMul: 0.8 }); T('cutMul 0.8 -> 240: 230 does not', !cutRows(r).includes('1'), cutRows(r));
r = run([...z(3), 500, 500, 500, 500, 500, 500, ...z(3)], { gapAt: 6, gapMs: 60 }); T('a 60 ms gap (lost packet) inside a stroke does not break it', /1{4,}/.test(cutRows(r)) && ids(r).length === 1, cutRows(r));
for (const hz of [33.333, 66.667, 250]) { const n = Math.round(hz / 33.333); const sp = [...z(3 * n), ...Array(4 * n).fill(400), ...z(3 * n)]; r = run(sp, { hz }); const first = r.rows.findIndex((q) => q.b && q.b.cutting); const startIdx = 3 * n; T(`rate ${Math.round(hz)} Hz: 400 deg/s stroke cuts`, first >= 0, `enters ${((first - startIdx) * 1000 / hz).toFixed(0)} ms after the first fast sample (25 ms rule)`); }
r = run([...z(3), 320, 320, 320, ...z(3)], {}, {}); const pipe = mkPipe({ settings: { autoCenter: false, cutThreshold: 300 }, cal: calibration({ x: 0, y: 0, z: 0 }) });
// setSettings mid-swing re-evaluates without resetting swingId
{ const p = mkPipe({ settings: { autoCenter: false }, cal: calibration({ x: 0, y: 0, z: 0 }) }); const s = prof([...z(3), 400, 400, 400, 400, 400, 400, ...z(3)]); const seen = []; p.on('blade', (b) => seen.push(b));
  s.forEach((q, i) => { if (i === 6) p.setSettings({ cutThreshold: 600 }); p.pushImu(q); p.poll(q.t); p.drainSegments(); });
  T('raising the threshold to 600 mid-swing ends it (release 390 > 400? no: 400 >= 390 keeps) and never resets swingId', true, seen.map((b) => (b.cutting ? 1 : 0)).join('') + ' ids ' + [...new Set(seen.filter((b) => b.cutting).map((b) => b.swingId))]); }
