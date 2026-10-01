// e2e (headless Chrome, real clock, the generated art on, 1920 x 1080): the first REAL Joy-Con 2 recording played into the game through the native bridge
// path (fake helper command `replay`, server, Server-Sent Events, native provider, parser, app.js, relative pointer, game, presentation, canvas).
// What it proves, with the owner's own motion: slow aiming (40 to 207 deg/s) never cuts in a live Classic, Arcade or Zen round with its waves and an apple
// hung under the cursor; the owner's fast slashes (up to 1048 deg/s) do cut; the frame rate stays at the display rate with the art on; nothing is logged.
// What it cannot prove: Bluetooth, macOS, the physical Joy-Con, how the sword feels (UNVERIFIED-ON-HARDWARE: one controller, one person; headless Chrome is
// not the owner's Mac). The node version of the metrics is test/app/real-replay-app.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runBrowserReplay } from '../../test-support/e2e/replay-browser.mjs';

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));

test('e2e real recording: slow aiming never cuts, the owner\'s slashes do, 60 fps with the art on (Classic and Zen, 8 s of yaw sweep and the 14 s of fast swings each)', { timeout: 240000 }, async (t) => {
  // The fast window is the whole step since round F1: the hover apples hang where the cursor rests, and with the vertical axis in the gravity frame the cursor no
  // longer sits pinned on the bottom edge (where a slash that starts on an apple stays on its line), so the next slash reaches an apple less often (about 50 %
  // of them against 65 %, replayed on 13 windows of 8 s); 8 s gave 2 to 3 cuts, the 14 s of the step give about 7 and the test keeps asking for 4.
  const windows = { slow: [['yaw_sweep', 1, 9]], fast: [['fast_swings_h', 0, 14]] };
  const r = await runBrowserReplay({ modes: ['classic', 'zen'], windows, log: (l) => t.diagnostic(l) });
  if (r.skip) {
    t.skip(r.skip);
    return;
  }
  assert.equal(r.assets, true, 'the art layer is on');
  for (const [mode, ph] of Object.entries(r.modes)) {
    const slow = ph.slow;
    const fast = ph.fast;
    const msg = (v) => `${mode}: cuts ${v.cutsTotal} (${v.probes} hover apples), CUTTING frames ${f1(v.cutFramesPct)} %, swings ${v.swings}, peak ${Math.round(v.maxTip)} deg/s, ${f1(v.fps)} fps, callback ${v.cpuAvg.toFixed(2)} ms`;
    // slow aiming: the sword sweeps across a third of the screen at up to 207 deg/s; the threshold is 300 (Zen 240)
    assert.ok(slow.maxTip > 100 && slow.maxTip < 240, `the slow window is what it claims to be: ${msg(slow)}`);
    assert.equal(slow.cutsTotal, 0, `slow aiming cut something: ${msg(slow)}`);
    assert.equal(slow.cutFrames, 0, `slow aiming was CUTTING: ${msg(slow)}`);
    assert.equal(slow.swings, 0, `slow aiming started a swing: ${msg(slow)}`);
    assert.ok(slow.probes >= 5, `there were apples under the cursor: ${msg(slow)}`);
    // fast slashes: peaks up to 1048 deg/s
    assert.ok(fast.maxTip > 600, `the fast window is what it claims to be: ${msg(fast)}`);
    assert.ok(fast.swings >= 6, `the slashes were recognised as swings: ${msg(fast)}`);
    assert.ok(fast.cutsTotal >= 4, `the slashes cut fruit: ${msg(fast)}`);
    assert.ok(fast.cutFramesPct > 5 && fast.cutFramesPct < 40, `CUTTING only during the slashes: ${msg(fast)}`);
    // the frame rate and the cost of a frame with the art on (the thresholds of test/e2e/perf.test.js: hard limits only, headless Chrome shares the CPU with the other tests)
    for (const v of [slow, fast]) {
      assert.ok(v.frames > 300, `${v.frames} frames`);
      assert.ok(v.avgMs < 33, `average frame interval ${f1(v.avgMs)} ms: ${msg(v)}`);
      assert.ok(v.cpuAvg < 6, `the step + draw callback averages ${v.cpuAvg.toFixed(2)} ms (budget 6): ${msg(v)}`);
    }
  }
  assert.deepEqual(r.problems, { console: [], exceptions: [], failed: [], bad: [] });
});
