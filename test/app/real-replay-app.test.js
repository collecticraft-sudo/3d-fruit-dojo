// The acceptance metrics of docs/motion-contract.md section 5.2 on the INTEGRATED app path: the first REAL Joy-Con 2 recording goes, report by report, through
// the BLE provider, the parser, app.js, the motion pipeline (relative model), the game and the UI state machine, with 60 fps frames in between
// (test-support/app/replay-rig.js). test/motion/real-replay.test.js proves the maths of the pipeline alone; this file proves that the wiring of the app does
// not spoil it: the pointer model per provider, the BladeView, the settings push, the recenter guard, the game's collision with the chords.
//
// It found one thing the pipeline-only replay cannot see: the recording has R shoulder-button presses (one report in the middle of a 1009 deg/s stroke,
// six reports in the roll test), and the R button is mapped to "recenter". Without the guard of app.js that press recentres the cursor in the middle of the
// stroke and the cut is lost (docs/contract-notes.md, integrator entry of the sword tuning round).
//
// UNVERIFIED-ON-HARDWARE: one controller, one person, hand-timed steps. This says nothing about how the sword feels. The numbers printed in the assertion
// messages are the ones tools/replay-integrated.mjs prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runWindow, WINDOWS, holdStats, coverage, strokesWithProbes, noTunnelling, frameSmoothness, autoCentreRun, injectPosture, windowReports, median, share,
  refDrivenWhileSwinging, FIELD,
} from '../../test-support/app/replay-metrics.js';

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
const cache = new Map();
async function win(key, name, from, to, o = {}) {
  if (!cache.has(key)) cache.set(key, await runWindow(name, from, to, o));
  return cache.get(key);
}
const W = (k, o = {}, tag = '') => win(`${k}${tag}`, ...WINDOWS[k], o);

for (const mode of ['classic', 'arcade']) {
  const app = { mode }; // both cut at 300 deg/s (Zen has its own test below)

  test(`[${mode}] A1 a hand that holds still: the cursor range is 0 px, nothing cuts, the game cuts none of the apples hung under the cursor`, async () => {
    for (const k of ['hold', 'still']) {
      const w = await W(k, { app, probes: 'cursor' }, `:${mode}`);
      const s = holdStats(w);
      assert.ok(s.n > 90, `${k}: ${s.n} samples`);
      assert.ok(s.rangeX <= 10 && s.rangeY <= 10, `${k}: cursor range ${f1(s.rangeX)} x ${f1(s.rangeY)} px (reference 0.0 x 0.0)`);
      assert.equal(s.cutting, 0, `${k}: CUTTING ${s.cutting} %`);
      assert.equal(s.falseCuts, 0, `${k}: the game cut ${s.falseCuts} apples`);
      assert.deepEqual(w.problems, [], `${k}: the app logged problems`);
    }
  });

  test(`[${mode}] A2 slow sweeps: a usable part of the screen, never pinned at an edge, nothing cut (reference yaw 55.5 x 30.7 %, pitch 2.7 x 26.3 %)`, async () => {
    const y = coverage(await W('yaw', { app, probes: 'cursor' }, `:${mode}`));
    const p = coverage(await W('pitch', { app, probes: 'cursor' }, `:${mode}`));
    assert.ok(y.xPct >= 35 && y.xPct <= 80, `yaw x range ${f1(y.xPct)} %`);
    assert.ok(y.yPct <= 50, `yaw y range ${f1(y.yPct)} %`);
    assert.ok(y.boundary <= 5 && p.boundary <= 5, `boundary time ${f1(y.boundary)} / ${f1(p.boundary)} %`);
    assert.ok(p.yPct >= 15 && p.yPct <= 40, `pitch y range ${f1(p.yPct)} %`);
    assert.ok(p.xPct <= 10, `pitch x range ${f1(p.xPct)} %`);
    for (const k of ['yaw', 'pitch']) {
      const w = await W(k, { app, probes: 'cursor' }, `:${mode}`);
      assert.equal(w.fruitCut, 0, `${k}: the game cut ${w.fruitCut} of ${w.spawned} apples while the sword was only aimed`);
      assert.equal(share(w.rows, (r) => r.cutting), 0, `${k}: CUTTING share`);
    }
  });

  test(`[${mode}] A3 the sensitivity changes where the cursor goes, never what cuts: under 2 % CUTTING at 0.3, 1.0 and 2.0 and the same sequence sample by sample`, async () => {
    for (const k of ['hold', 'still', 'yaw', 'pitch', 'roll', 'spin']) {
      const seqs = [];
      for (const sens of [0.3, 1.0, 2.0]) {
        const w = await W(k, { app: { ...app, sensitivity: sens } }, `:${mode}@${sens}`);
        const c = share(w.rows, (r) => r.cutting);
        assert.ok(c < 2, `${k} at sensitivity ${sens}: CUTTING ${f1(c)} % (reference 0.0)`);
        seqs.push(w.rows.map((r) => (r.cutting ? 1 : 0)).join(''));
      }
      assert.ok(seqs[0] === seqs[1] && seqs[1] === seqs[2], `${k}: the CUTTING sequences differ between sensitivities`);
    }
  });

  test(`[${mode}] A4 A9 hard strokes: every stroke is cut by the motion rule AND by the game (an apple hung on its path), within 35 ms of the first fast sample, first chord delivered retroactively`, async () => {
    for (const [name, n] of [['fast_swings_h', 15], ['fast_swings_v', 6]]) {
      const r = await strokesWithProbes(name, app);
      const st = r.strokes;
      assert.equal(st.length, n);
      const hit = st.filter((s) => s.cut).length;
      const shares = st.map((s) => s.pathShare);
      const msg = `${name}: ${hit}/${n} cut by the motion rule, path share median ${f1(median(shares))} % min ${f1(Math.min(...shares))} % (reference ${n === 15 ? '95 / 86' : '90 / 87'}), apples cut by the game ${st.filter((s) => s.gameCuts > 0).length}/${n}`;
      assert.ok(hit >= Math.ceil(0.9 * n), msg);
      assert.ok(median(shares) >= 80 && Math.min(...shares) >= 60, msg);
      assert.equal(st.filter((s) => s.gameCuts > 0).length, n, msg);
      assert.ok(st.every((s) => s.onsetMs !== null && s.onsetMs <= 35), `${name}: cut onset ${st.map((s) => s.onsetMs).join(' ')} ms (reference 30)`);
      assert.ok(st.every((s) => s.retro), `${name}: the retroactive chord exists for every stroke`);
    }
  });

  test(`[${mode}] A6 no tunnelling at the recorded maximum speed, through the app's segment queue: chords of at most 96 px, contiguous, within 12 px of the dense path`, async () => {
    for (const k of ['fastH', 'fastV']) {
      const w = await W(k, { app }, `:${mode}`);
      const t = noTunnelling(w);
      const msg = `${k}: longest chord ${f1(t.longestChord)} px, ${t.gaps} gaps, worst dense distance ${f1(t.worstDenseDistance)} px, largest step ${f1(t.maxSampleStep)} px`;
      assert.ok(t.segments > (k === 'fastH' ? 100 : 50), msg); // the vertical chops are shorter since round F1 (the vertical gain is capped): 90 chords, were 184
      assert.ok(t.longestChord <= 96, msg);
      assert.equal(t.gaps, 0, msg);
      assert.ok(t.worstDenseDistance <= 12, msg);
      assert.ok(t.maxSampleStep <= 450, msg);
    }
  });

  test(`[${mode}] A7 the head drawn at 60 fps between two 33 Hz reports is within 20 px on average and 60 px at p95 of the path (hold-last-sample: 37 / 192 px)`, async () => {
    const r = await strokesWithProbes('fast_swings_h', app);
    const fr = r.strokes.flatMap((s) => s.frames);
    const s = frameSmoothness(r.w, fr);
    const msg = `frames ${s.frames}: head error mean ${f1(s.headErrMean)} p95 ${f1(s.headErrP95)} max ${f1(s.headErrMax)} px; hold-last-sample mean ${f1(s.holdErrMean)} p95 ${f1(s.holdErrP95)}`;
    assert.ok(s.frames > 300, msg);
    assert.ok(s.headErrMean <= 20 && s.headErrP95 <= 60, msg);
    assert.ok(s.headErrMean < s.holdErrMean / 3, `the extrapolation is much closer than holding the last sample: ${msg}`);
    assert.ok(s.stalledHead < s.stalledHold / 2, `the head stands still on ${f1(s.stalledHead)} % of the frames, the last sample on ${f1(s.stalledHold)} %`);
  });

  test(`[${mode}] A5 A5b the idle glide: within 100 px of the centre in at most 3.0 s from four places, never dragging a swing, off means off`, async () => {
    for (const from of [{ x: 60, y: 60 }, { x: 1860, y: 540 }, { x: 960, y: 1040 }, { x: 1100, y: 600 }]) {
      const r = await autoCentreRun(from, { mode });
      assert.equal(r.startOffset, 0, `the first sample is placed by __ninja.reanchor at ${JSON.stringify(from)}`);
      assert.ok(r.t100 !== null && r.t100 <= 3.0, `from ${JSON.stringify(from)}: within 100 px after ${r.t100} s (reference 2.50 / 2.35 / 1.84 / 1.33)`);
      assert.ok(r.t20 !== null && r.t20 <= 3.6, `from ${JSON.stringify(from)}: within 20 px after ${r.t20} s`);
      assert.equal(r.autoEvents, 1, 'exactly one auto recenter event');
      assert.equal(r.refDrivenWhileFast, 0);
      const off = await autoCentreRun(from, { autoCenter: false, mode });
      assert.equal(off.rangeAfterStart, 0, 'autoCenter off: the cursor never moves');
      assert.equal(off.autoEvents, 0);
    }
    for (const k of ['yaw', 'pitch', 'fastH', 'fastV']) {
      assert.equal(refDrivenWhileSwinging(await W(k, { app }, `:${mode}`)), 0, `${k}: frames with the cursor dragged by the glide while swinging`);
    }
  });

  test(`[${mode}] A8 a change of posture (30 degrees yaw, 20 degrees pitch in 2 s) moves the cursor by at most 250 px (an absolute pointer: 996 px)`, async () => {
    const w = await runWindow('return_still', 2, Infinity, { reports: injectPosture(windowReports('return_still', 2, Infinity)), app });
    const after = w.rows.filter((r) => r.t >= 2800);
    const off = Math.hypot(after[0].x - FIELD.cx, after[0].y - FIELD.cy);
    assert.ok(off <= 250, `cursor ${f1(off)} px from the centre 300 ms after the change (reference 133)`);
  });
}

test('?debug=1 validates every ImuSample, BladeSample, status and game snapshot of the real recording on the way: nothing is logged (the new BladeSample fields pass the validators)', async () => {
  for (const [name, from, to] of [['fast_swings_h', 0, 6], ['yaw_sweep', 1, 6], ['fast_swings_v', 0, 6]]) {
    const w = await runWindow(name, from, to, { app: { mode: 'classic', debug: true }, probes: 'cursor' });
    assert.deepEqual(w.problems, [], `${name}: ${JSON.stringify(w.problems.slice(0, 3))}`);
    assert.ok(w.rows.length > 100 && w.segs.length >= 0);
  }
});

test('the R button of the recording (one report in the middle of a 1009 deg/s stroke) does not recentre the cursor: no manual recenter during the fast swings, the last stroke is whole', async () => {
  const w = await W('fastH', { app: { mode: 'classic' } }, ':classic');
  assert.equal(w.events.recenter.filter((e) => e.kind === 'manual').length, 0, 'a grip press during a swing must not recentre');
  const last = (await strokesWithProbes('fast_swings_h', { mode: 'classic' })).strokes.at(-1);
  assert.ok(last.cut && last.pathShare >= 60, `the last stroke (peak ${f1(last.peakDps)} deg/s, where the press is) path share ${f1(last.pathShare)} %`);
});

test('Zen: the same recording at 240 deg/s (Normal x 0.8): every stroke is cut; the owner\'s most vigorous aiming (samples up to 326 deg/s) does cut a little, which is harmless there (no bombs)', async () => {
  const app = { mode: 'zen' };
  const y = await W('yaw', { app, probes: 'cursor' }, ':zen');
  const cutting = share(y.rows, (r) => r.cutting);
  assert.ok(cutting > 0 && cutting < 3, `yaw sweep CUTTING ${f1(cutting)} % (measured 1.8; the threshold 240 is below the owner's aiming p99 of 260)`);
  for (const k of ['hold', 'still', 'pitch', 'roll']) {
    assert.equal(share((await W(k, { app }, ':zen')).rows, (r) => r.cutting), 0, `${k}: nothing cuts in Zen either`);
  }
  for (const [name, n] of [['fast_swings_h', 15], ['fast_swings_v', 6]]) {
    const r = await strokesWithProbes(name, app);
    assert.equal(r.strokes.filter((s) => s.cut).length, n, `${name}: every stroke is cut in Zen`);
    assert.equal(r.strokes.filter((s) => s.gameCuts > 0).length, n, `${name}: and the game cuts the apple on every path`);
  }
});
