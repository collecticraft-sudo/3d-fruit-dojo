#!/usr/bin/env node
// Replay of the first REAL Joy-Con 2 recording through the INTEGRATED app path and the contract metrics with real numbers.
// OWNER: integrator. docs/motion-contract.md section 5.2, test-support/app/replay-rig.js, test-support/app/replay-metrics.js.
//
//   node tools/replay-integrated.mjs            the whole table (about a minute)
//   node tools/replay-integrated.mjs --json     the same numbers as JSON
//   node tools/replay-integrated.mjs --mode=zen the same in a Zen round (threshold 240 deg/s); the default is a Classic round (300)
//
// Every recorded 63-byte report is delivered, byte for byte, to the REAL Bluetooth provider (through the fake Web Bluetooth characteristic), goes through
// the REAL parser, app.js, the motion pipeline in the relative model, the real game (Zen round, hover-probe apples) and the real UI state machine, with
// 60 fps frames of app.step() in between on a manual clock. Not included: Bluetooth itself, the canvas drawing (test-support/e2e/replay-browser.mjs
// does that in a real browser), and the calibration wizard (the recording has no wizard poses, so the recording's own calibration is installed).
// UNVERIFIED-ON-HARDWARE: one controller, one person, hand-timed steps; nothing here says how the sword feels.
import {
  runWindow, WINDOWS, holdStats, coverage, strokesWithProbes, noTunnelling, frameSmoothness, autoCentreRun, injectPosture, windowReports, median, quantile, mean, share, range,
  refDrivenWhileSwinging, FIELD,
} from '../test-support/app/replay-metrics.js';

const json = process.argv.includes('--json');
const modeArg = process.argv.find((a) => a.startsWith('--mode='));
const MODE = modeArg ? modeArg.slice(7) : 'classic'; // classic and arcade cut at 300 deg/s, zen at 240 (x 0.8); the contract numbers are for 300
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
const out = {};
const say = (...a) => { if (!json) console.log(...a); };
const t00 = Date.now();

say(`=== Integrated replay of recordings/imu-2026-09-30T18-42-24.jsonl (one Joy-Con 2 Right, the owner's handling), ${MODE} round ===`);
say('Path: recorded hex -> fake characteristic -> BLE provider -> parser -> app.js -> motion (relative) -> game + UI, 60 fps frames on a manual clock.\n');

// A1
out.A1 = {};
for (const k of ['hold', 'still']) {
  const [n, a, b] = WINDOWS[k];
  const w = await runWindow(n, a, b, { probes: 'cursor', app: { mode: MODE } });
  out.A1[k] = holdStats(w);
  say(`A1 ${n} from ${a} s: cursor range ${f1(out.A1[k].rangeX)} x ${f1(out.A1[k].rangeY)} px, CUTTING ${f1(out.A1[k].cutting)} %, apples cut by the game ${out.A1[k].falseCuts} of ${w.spawned} hung under the cursor (n=${out.A1[k].n})`);
}

// A2 and A3
out.A2 = {};
for (const k of ['yaw', 'pitch']) {
  const [n, a, b] = WINDOWS[k];
  const w = await runWindow(n, a, b, { probes: 'cursor', app: { mode: MODE } });
  out.A2[k] = { ...coverage(w), falseCuts: w.fruitCut, spawned: w.spawned, n: w.rows.length };
  say(`A2 ${n} ${a}-${b} s: x range ${f1(out.A2[k].xPct)} %, y range ${f1(out.A2[k].yPct)} %, on the boundary ${f1(out.A2[k].boundary)} %, CUTTING ${f1(out.A2[k].cutting)} %, apples cut ${out.A2[k].falseCuts} of ${out.A2[k].spawned}`);
}
out.A3 = {};
for (const sens of [0.3, 1.0, 2.0]) {
  out.A3[sens] = {};
  const seq = {};
  for (const k of ['hold', 'still', 'yaw', 'pitch', 'roll', 'spin']) {
    const [n, a, b] = WINDOWS[k];
    const w = await runWindow(n, a, b, { app: { sensitivity: sens, mode: MODE } });
    out.A3[sens][k] = share(w.rows, (r) => r.cutting);
    seq[k] = w.rows.map((r) => (r.cutting ? 1 : 0)).join('');
  }
  out.A3[sens].seq = seq;
  say(`A3 sensitivity ${sens}: CUTTING share ${Object.entries(out.A3[sens]).filter(([k]) => k !== 'seq').map(([k, v]) => `${k} ${f1(v)} %`).join(', ')}`);
}
out.A3.identical = ['hold', 'still', 'yaw', 'pitch', 'roll', 'spin'].every((k) => out.A3[0.3].seq[k] === out.A3[1].seq[k] && out.A3[1].seq[k] === out.A3[2].seq[k]);
say(`A3 CUTTING sequences identical at sensitivity 0.3, 1.0 and 2.0 (sample by sample, 6 windows): ${out.A3.identical}`);
for (const s of [0.3, 1.0, 2.0]) delete out.A3[s].seq;

// A4, A9, A6, A7 on the two fast steps
out.A4 = {};
out.A6 = {};
out.A7 = {};
out.A9 = {};
for (const [key, name] of [['H', 'fast_swings_h'], ['V', 'fast_swings_v']]) {
  const r = await strokesWithProbes(name, { mode: MODE });
  const st = r.strokes;
  out.A4[key] = {
    strokes: st.length, motionCuts: st.filter((s) => s.cut).length, gameCuts: st.filter((s) => s.gameCuts > 0).length, totalAppleCuts: r.gameCutsTotal,
    pathShareMedian: median(st.map((s) => s.pathShare)), pathShareMin: Math.min(...st.map((s) => s.pathShare)),
    peakMin: Math.min(...st.map((s) => s.peakDps)), peakMedian: median(st.map((s) => s.peakDps)), peakMax: Math.max(...st.map((s) => s.peakDps)),
  };
  out.A9[key] = { onsetMax: Math.max(...st.filter((s) => s.onsetMs !== null).map((s) => s.onsetMs)), onsetMedian: median(st.filter((s) => s.onsetMs !== null).map((s) => s.onsetMs)), retro: st.filter((s) => s.retro).length, n: st.length };
  out.A6[key] = noTunnelling(r.w);
  const fr = st.flatMap((s) => s.frames);
  out.A7[key] = frameSmoothness(r.w, fr);
  out.A4[key].refDrivenWhileSwinging = refDrivenWhileSwinging(r.w);
  say(`A4 ${name}: ${out.A4[key].motionCuts}/${st.length} strokes cut by the motion rule, ${out.A4[key].gameCuts}/${st.length} hover-apples cut by the GAME (apples cut in total ${out.A4[key].totalAppleCuts}), path share median ${f1(out.A4[key].pathShareMedian)} % min ${f1(out.A4[key].pathShareMin)} %, peaks ${f1(out.A4[key].peakMin)} / ${f1(out.A4[key].peakMedian)} / ${f1(out.A4[key].peakMax)} deg/s (min/median/max)`);
  say(`A9 ${name}: cut onset median ${f1(out.A9[key].onsetMedian)} ms, max ${f1(out.A9[key].onsetMax)} ms after the first sample at or above 300 deg/s; retroactive chord present for ${out.A9[key].retro}/${out.A9[key].n}`);
  say(`A6 ${name}: ${out.A6[key].segments} chords, longest ${f1(out.A6[key].longestChord)} px, ${out.A6[key].gaps} gaps, worst dense-path distance to the chords ${f1(out.A6[key].worstDenseDistance)} px, largest cursor step between two reports ${f1(out.A6[key].maxSampleStep)} px, peak cursor speed ${Math.round(out.A6[key].peakCursorPxS)} px/s`);
  say(`A7 ${name} (60 fps frames inside strokes, ${fr.length} frames): extrapolated head error mean ${f1(out.A7[key].headErrMean)} p95 ${f1(out.A7[key].headErrP95)} max ${f1(out.A7[key].headErrMax)} px; hold-last-sample error mean ${f1(out.A7[key].holdErrMean)} p95 ${f1(out.A7[key].holdErrP95)} max ${f1(out.A7[key].holdErrMax)} px; step variation (CV) head ${f2(out.A7[key].stutterHead)} vs hold ${f2(out.A7[key].stutterHold)}; frames where it stands still: head ${f1(out.A7[key].stalledHead)} % vs hold ${f1(out.A7[key].stalledHold)} %`);
}

// A5
out.A5 = [];
for (const from of [{ x: 60, y: 60 }, { x: 1860, y: 540 }, { x: 960, y: 1040 }, { x: 1100, y: 600 }]) {
  const r = await autoCentreRun(from, { mode: MODE });
  out.A5.push(r);
  say(`A5 auto-centre from (${from.x}, ${from.y}): within 100 px after ${f2(r.t100)} s, within 20 px after ${f2(r.t20)} s; 'auto' recenter events ${r.autoEvents}; frames dragged while swinging ${r.refDrivenWhileFast}; start offset ${f1(r.startOffset)} px`);
}
const off = await autoCentreRun({ x: 60, y: 60 }, { autoCenter: false, mode: MODE });
out.A5off = off;
say(`A5 with autoCenter off: cursor range after the first samples ${f1(off.rangeAfterStart)} px, 'auto' events ${off.autoEvents}`);

// A5b on the four motion steps
out.A5b = {};
for (const k of ['yaw', 'pitch', 'fastH', 'fastV']) {
  const [n, a, b] = WINDOWS[k];
  const w = await runWindow(n, a, b, { app: { mode: MODE } });
  out.A5b[k] = refDrivenWhileSwinging(w);
}
say(`A5b frames with the cursor dragged by the glide while cutting or above 21 deg/s: ${JSON.stringify(out.A5b)}`);

// A8
const base = windowReports('return_still', 2, Infinity);
const w8 = await runWindow('return_still', 2, Infinity, { reports: injectPosture(base), app: { mode: MODE } });
const after = w8.rows.filter((r) => r.t >= 2800);
out.A8 = { offsetPx: after.length ? Math.hypot(after[0].x - FIELD.cx, after[0].y - FIELD.cy) : null, dx: after[0].x - FIELD.cx, dy: after[0].y - FIELD.cy };
say(`A8 posture change (30 degrees yaw and 20 degrees pitch in 2 s): cursor ${f1(out.A8.offsetPx)} px from the centre 300 ms after it ended (dx ${f1(out.A8.dx)}, dy ${f1(out.A8.dy)})`);

out.problems = [];
out.seconds = (Date.now() - t00) / 1000;
say(`\n(${f1(out.seconds)} s of wall time)`);
if (json) console.log(JSON.stringify(out, null, 1));
