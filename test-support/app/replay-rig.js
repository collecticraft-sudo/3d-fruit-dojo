// Replay of the first REAL Joy-Con 2 recording through the INTEGRATED app path. OWNER: integrator. docs/motion-contract.md section 5, docs/contract-notes.md.
//
// test-support/motion/real-replay.js (the Motion engineer's) replays the recording through the motion pipeline alone. This rig replays the same file
// through everything the owner's browser runs, except Bluetooth and the canvas:
//
//   recorded 63-byte report (hex, byte for byte) -> fake Web Bluetooth characteristic -> the REAL BLE provider and transport -> the REAL parser
//   (joycon2-parse.js) -> app.js (onImu, pointer model per provider, settings) -> motion pipeline (relative model) -> segments -> the REAL game
//   (Zen round, hover-probe fruit) and the REAL UI state machine (menu dwell) -> 60 fps frames of app.step() on a manual clock
//
// The reports are injected at their recorded device times (33 Hz, real jitter, the one lost packet included) and the frames run at 60 fps in
// between, so the head extrapolation, the interpolated trail ring and the segment queue are exercised the way a browser exercises them.
//
// What is scaffolding, stated honestly: the calibration wizard is not in the recording (the controller lay flat on a table or was swung), so each
// replay installs the recording's own Calibration (identity frame, sign +1, scale 1, the median bias of the clean rest_table window) with
// motion.setCalibration(), exactly what the wizard would have produced for this mount. Every step is replayed from a fresh app (the countdowns
// between the steps are not in the file). The canvas is not drawn (no requestAnimationFrame under the manual clock); the art layer is checked in
// a real browser by test-support/e2e/replay-browser.mjs.
//
// UNVERIFIED-ON-HARDWARE: one controller, one person, hand-timed steps. Nothing here says how the sword feels.
import { readFileSync } from 'node:fs';
import { createManualClock } from '../../public/js/shared/clock.js';
import { createFakeTimers } from '../input/fake-timers.js';
import { createFakeBluetooth } from '../input/fake-bluetooth.js';
import { INPUT_CONFIG } from '../../public/js/input/input-config.js';
import { parseInputReport, hexToBytes, imuDeltaUs, GYRO_DPS_PER_LSB } from '../../public/js/input/joycon2-parse.js';
import { makeApp } from './harness.js';
import { RECORDING_FILE, REAL_BIAS_DPS, realCalibration, hardStrokes } from '../motion/real-recording.js';

export { REAL_BIAS_DPS, realCalibration, hardStrokes };
export const FRAME_MS = 1000 / 60;
const CH_INPUT = INPUT_CONFIG.characteristics.input;

let cache = null;
/** @returns {{steps: Record<string, Array<{hex:string, tMs:number, dtMs:number|null, gyroDps:{x:number,y:number,z:number}}>>, order:string[]}} tMs = device time from the first report of the step */
export function loadRawRecording() {
  if (cache) return cache;
  const rows = readFileSync(RECORDING_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const steps = {};
  const order = [];
  let prevStep = null;
  let prevUs = null;
  let t = 0;
  for (const r of rows) {
    if (!r.hex || !r.step) continue;
    const p = parseInputReport(hexToBytes(r.hex));
    if (!p || !p.imuActive) continue;
    if (r.step !== prevStep) {
      steps[r.step] = [];
      order.push(r.step);
      prevStep = r.step;
      prevUs = null;
      t = 0;
    }
    const dtMs = prevUs === null ? null : imuDeltaUs(prevUs, p.imuTimestampUs) / 1000;
    prevUs = p.imuTimestampUs;
    if (dtMs !== null) t += dtMs;
    steps[r.step].push({
      hex: r.hex, tMs: t, dtMs,
      gyroDps: { x: p.gyroRaw.x * GYRO_DPS_PER_LSB, y: p.gyroRaw.y * GYRO_DPS_PER_LSB, z: p.gyroRaw.z * GYRO_DPS_PER_LSB },
    });
  }
  cache = { steps, order };
  return cache;
}

/** Reports of a step between two times (seconds from the start of the step). */
export function windowReports(name, fromS = 0, toS = Infinity) {
  const all = loadRawRecording().steps[name];
  if (!all) throw new Error(`unknown step ${name}`);
  const l = all.filter((r) => r.tMs / 1000 >= fromS && r.tMs / 1000 < toS);
  if (!l.length) throw new Error(`step ${name} has no report in ${fromS}..${toS} s`);
  const t0 = l[0].tMs;
  return l.map((r) => ({ ...r, tMs: r.tMs - t0 }));
}

/**
 * A fresh integrated app on the Bluetooth provider with the recording's calibration installed, a Zen round running (no waves: the only fruit are
 * the probes) and the fake controller silenced, ready for `play()`.
 * @param {object} [o]
 * @param {number} [o.sensitivity] @param {number} [o.cutThreshold] @param {boolean} [o.autoCenter] @param {string} [o.mode] round mode (default zen)
 * @param {boolean} [o.debug] ?debug=1: every BladeSample, BladeSegment, ImuSample and game snapshot is validated on the way (problems are logged, never thrown)
 */
export async function openReplayApp(o = {}) {
  const clock = createManualClock(1000);
  const timers = createFakeTimers(clock);
  const fake = createFakeBluetooth({ clock, timers, behaviour: { rateHz: 66 } });
  const h = await makeApp(`?input=joycon&clock=manual&skipsafety=1&mute=1&seed=1${o.debug ? '&debug=1' : ''}`, { env: { clock, timers, bluetooth: fake.bluetooth } });
  const run = async (ms) => {
    for (let el = 0; el < ms; el += 16) {
      await timers.advance(16);
      h.app.step();
    }
  };
  h.key('Enter'); // the user gesture: chooser, connect, init, stream
  for (let el = 0; el < 20000 && h.snap().provider.state !== 'streaming'; el += 48) await run(48);
  if (h.snap().provider.state !== 'streaming') throw new Error('the fake controller did not reach streaming');
  fake.silence(true); // from here on only the recorded reports arrive
  const ic = fake.chars.get(CH_INPUT);
  h.app.motion.setCalibration(realCalibration()); // also cancels the wizard that the first connect started
  h.n.debug.forceScreen('menu');
  await run(100);
  const patch = { autoCenter: o.autoCenter ?? true };
  if (o.sensitivity !== undefined) patch.sensitivity = o.sensitivity;
  if (o.cutThreshold !== undefined) patch.cutThreshold = o.cutThreshold;
  for (const [k, v] of Object.entries(patch)) h.n.setSetting(k, v);
  h.n.start(o.mode ?? 'zen', { seed: 5, skipCountdown: true, wavesEnabled: false });
  await run(200);
  return { h, clock, timers, fake, ic, run, dispose: () => h.dispose() };
}

/**
 * Replay reports through the app. `onFrame(tMs)` runs after every 60 fps frame, `onReport(tMs, report)` just before a report is injected,
 * `onSample(blade)` for every real BladeSample Motion emits. Time `0` is the moment the first report arrives.
 * @returns {Promise<{frames:number, reports:number, durationMs:number, t0:number}>}  t0 = the clock time that `tMs` 0 was mapped to
 */
export async function play(rig, reports, { onFrame = null, onReport = null, onSample = null, onSegments = null } = {}) {
  const { h, clock, timers, ic } = rig;
  const motion = h.app.motion;
  const offSample = onSample ? motion.on('blade', onSample) : null;
  const realDrain = motion.drainSegments;
  if (onSegments) {
    motion.drainSegments = () => {
      const segs = realDrain();
      if (segs.length) onSegments(segs, clock.now() - t0);
      return segs;
    };
  }
  const t0 = clock.now() + 1; // the first report arrives 1 ms from now
  let nextFrame = t0;
  let frames = 0;
  const advanceTo = async (tAbs) => {
    while (nextFrame <= tAbs) {
      const d = nextFrame - clock.now();
      if (d > 0) await timers.advance(d);
      h.app.step();
      frames += 1;
      if (onFrame) onFrame(clock.now() - t0);
      nextFrame += FRAME_MS;
    }
    const d = tAbs - clock.now();
    if (d > 0) await timers.advance(d);
  };
  try {
    for (const r of reports) {
      await advanceTo(t0 + r.tMs);
      if (onReport) onReport(r.tMs, r);
      const bytes = hexToBytes(r.hex);
      ic.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      ic.dispatchEvent(new Event('characteristicvaluechanged'));
    }
    const last = reports[reports.length - 1];
    await advanceTo(t0 + last.tMs + 300); // let the last sample be drawn and the segments be consumed
  } finally {
    if (offSample) offSample();
    motion.drainSegments = realDrain;
  }
  return { frames, reports: reports.length, durationMs: clock.now() - t0, t0 };
}
