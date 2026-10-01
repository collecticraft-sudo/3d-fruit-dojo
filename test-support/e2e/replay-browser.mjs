// The first REAL Joy-Con 2 recording played INTO THE GAME IN A REAL BROWSER (headless Chrome over CDP, real clock, the generated art on, 1920 x 1080).
// OWNER: integrator. Used by test/e2e/real-replay.test.js and by `node test-support/e2e/replay-browser.mjs` (prints the numbers).
//
// Path, end to end: the recorded 63-byte reports -> the FAKE helper (test-support/bridge/fake-helper.mjs, command `replay`) plays them in real time at their
// recorded device timestamps (33 Hz with the real jitter and the lost packet) -> the REAL server and bridge manager -> Server-Sent Events -> the native
// provider in the page -> parser -> app.js -> motion pipeline (relative model) -> game (Classic, Arcade or Zen with its waves) -> presentation with the art
// layer and the canvas, at whatever frame rate headless Chrome gives.
//
// What is scaffolding, stated honestly: the calibration wizard is not in the recording, so the recording's own Calibration (identity frame, sign +1,
// scale 1, the median bias of the clean rest_table window) is installed with __ninja.debug.setCalibration, which is what the wizard would have produced for
// the recorded mount. What this does NOT prove: Bluetooth, macOS, the real Joy-Con, how the sword feels.
// UNVERIFIED-ON-HARDWARE: one controller, one person, hand-timed steps; headless Chrome is not the owner's Mac.
import { mkdirSync } from 'node:fs';
import { startNativeE2e, sleep } from './native-harness.js';
import { realCalibration } from '../motion/real-recording.js';

const PROBE = `(() => {
  window.__cpu = [];
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => orig((t) => {
    if (cb.__skip) return cb(t);
    const s = performance.now();
    cb(t);
    window.__cpu.push(performance.now() - s);
  });
})()`;

const MONITOR = `(mode) => {
  const m = window.__mon = { mode, frames: [], cpuStart: window.__cpu.length, cutFrames: 0, maxTip: 0, maxTipWhileNotCutting: 0, cutsTotal: 0, rounds: 1, lastCut: 0, minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, edge: 0, n: 0, stop: false, swings: 0, lastSwing: __ninja.getMotionState().swingId, probes: 0, lastProbe: -1e9 };
  let last = performance.now();
  const tick = (now) => {
    m.frames.push(now - last);
    last = now;
    const s = __ninja.getMotionState();
    m.n += 1;
    if (s.cutting) m.cutFrames += 1;
    if (s.speedDps > m.maxTip) m.maxTip = s.speedDps;
    if (!s.cutting && s.speedDps > m.maxTipWhileNotCutting) m.maxTipWhileNotCutting = s.speedDps;
    if (s.swingId > m.lastSwing) { m.swings += s.swingId - m.lastSwing; m.lastSwing = s.swingId; }
    if (s.x < m.minX) m.minX = s.x; if (s.x > m.maxX) m.maxX = s.x; if (s.y < m.minY) m.minY = s.y; if (s.y > m.maxY) m.maxY = s.y;
    if (s.x <= 0.5 || s.x >= 1919.5 || s.y <= 0.5 || s.y >= 1079.5) m.edge += 1;
    if (!m.stop) requestAnimationFrame(tick);
  };
  tick.__skip = true;
  requestAnimationFrame(tick);
  m.poll = setInterval(() => {
    const s = __ninja.snapshot();
    const cut = s.stats ? s.stats.fruitCut : 0;
    if (cut < m.lastCut) m.lastCut = 0; // a new round
    m.cutsTotal += cut - m.lastCut;
    m.lastCut = cut;
    if (s.screen === 'results' || s.phase === 'over') { __ninja.start(m.mode, { seed: 11 + m.rounds }); m.rounds += 1; m.lastCut = 0; }
  }, 250);
  // A hover apple under the cursor whenever the blade is nearly still (at most one every 500 ms): whatever the owner does next, a slash starts on an apple and
  // a slow aim drifts across one. The waves of the mode go on as usual.
  m.probe = setInterval(() => {
    const s = __ninja.getMotionState();
    const now = performance.now();
    if (s.speedDps < 60 && now - m.lastProbe > 500 && __ninja.snapshot().screen === 'playing') {
      m.lastProbe = now;
      try { __ninja.debug.spawn({ kind: 'fruit', type: 'apple', apexX: s.x, apexY: s.y, atApex: true, gScale: 0.03 }); m.probes += 1; } catch (e) { /* the round ended */ }
    }
  }, 50);
}`;

const READ = `() => {
  const m = window.__mon;
  m.stop = true;
  clearInterval(m.poll);
  clearInterval(m.probe);
  const f = m.frames.slice(5).sort((a, b) => a - b);
  const avg = f.reduce((a, b) => a + b, 0) / f.length;
  const pct = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
  const cpu = window.__cpu.slice(m.cpuStart + 5).sort((a, b) => a - b);
  const cpuAvg = cpu.reduce((a, b) => a + b, 0) / cpu.length;
  return {
    frames: f.length, avgMs: avg, fps: 1000 / avg, p95: pct(0.95), p99: pct(0.99), maxMs: f[f.length - 1], over33: f.filter((v) => v > 33.4).length, over50: f.filter((v) => v > 50).length,
    cpuAvg, cpuP95: cpu[Math.floor(cpu.length * 0.95)], cpuMax: cpu[cpu.length - 1],
    cutFrames: m.cutFrames, cutFramesPct: (100 * m.cutFrames) / m.n, maxTip: m.maxTip, maxTipWhileNotCutting: m.maxTipWhileNotCutting, swings: m.swings, probes: m.probes, cutsTotal: m.cutsTotal + (__ninja.snapshot().stats?.fruitCut ?? 0) - m.lastCut, rounds: m.rounds,
    xRangePct: (100 * (m.maxX - m.minX)) / 1920, yRangePct: (100 * (m.maxY - m.minY)) / 1080, edgePct: (100 * m.edge) / m.n,
    perf: __ninja.getPerf(), screen: __ninja.snapshot().screen,
  };
}`;

/**
 * @param {object} [o]
 * @param {Array<'classic'|'arcade'|'zen'>} [o.modes]
 * @param {{slow:Array<[string,number,number]>, fast:Array<[string,number,number]>}} [o.windows]  [step, fromS, toS] per phase
 * @param {string} [o.shotsDir]  save screenshots taken while the blade is cutting (a trail on screen)
 * @param {(line:string)=>void} [o.log]
 * @param {boolean} [o.art]      default true: the generated art on (false: ?assets=0, the painted art)
 */
export async function runBrowserReplay(o = {}) {
  const modes = o.modes ?? ['classic', 'arcade', 'zen'];
  const windows = o.windows ?? { slow: [['yaw_sweep', 1, 11]], fast: [['fast_swings_h', 0, 14]] };
  const log = o.log ?? (() => {});
  const h = await startNativeE2e({ helper: { FAKE_HELPER_HELLO_MS: '50', FAKE_HELPER_WAIT_MS: '50', FAKE_HELPER_SCAN_MS: '200', FAKE_HELPER_STEP_MS: '60', FAKE_HELPER_STREAM_MS: '100' } });
  if (h.skip) return { skip: h.skip };
  const out = { modes: {}, problems: {} };
  try {
    const page = await h.newPage();
    await page.addInitScript(PROBE);
    await page.goto(`${h.url}/?skipsafety=1&mute=1${o.art === false ? '&assets=0' : ''}`);
    await page.evaluate('window.__ninja.ready');
    await h.waitConnect(page, 'c.native === true && c.buttonEnabled', 15000, 'the native layout');
    await h.click(page, 'connect.main');
    await h.waitConnect(page, "c.mode === 'connected'", 40000, 'Connected');
    await page.waitFor("__ninja.debug.getProviderStatus().state === 'streaming'", { timeoutMs: 20000, message: 'streaming' });
    // the recording's own calibration instead of the wizard; then the menu (the wizard's screens are not what this run is about)
    await page.evaluate(`__ninja.debug.setCalibration(${JSON.stringify(realCalibration())})`);
    await page.evaluate("__ninja.debug.forceScreen('menu')");
    if (o.art !== false) await page.waitFor("__ninja.getAssets().groups.core?.state === 'ready'", { timeoutMs: 15000, message: 'the art (group core)' });
    out.assets = await page.evaluate('__ninja.getAssets().enabled');
    const replayDone = () => h.bridgeLog().filter((e) => e.event === 'replay' && e.phase === 'done').length;
    const play = async (list) => {
      const before = replayDone();
      await h.sword.commands([{ replay: { windows: list.map(([step, fromS, toS]) => ({ step, fromS, toS })), gapMs: 400 } }]);
      const t0 = Date.now();
      while (replayDone() === before && Date.now() - t0 < 120000) await sleep(100);
      if (replayDone() === before) throw new Error('the fake helper never finished the replay');
      await sleep(400);
    };
    let shots = 0;
    if (o.shotsDir) mkdirSync(o.shotsDir, { recursive: true });
    for (const mode of modes) {
      out.modes[mode] = {};
      for (const phase of ['slow', 'fast']) {
        await page.evaluate(`__ninja.start('${mode}', { seed: 5, skipCountdown: true, wavesEnabled: true })`);
        await page.evaluate('__ninja.reanchor(960, 540)'); // every phase starts from the centre, whatever the previous one left
        await sleep(600);
        await page.evaluate(`(${MONITOR})('${mode}')`);
        // a screenshot or two while the blade is cutting (the trail on the art)
        let watcher = null;
        if (o.shotsDir && phase === 'fast') {
          let on = true;
          watcher = (async () => {
            while (on && shots < 3) {
              const cutting = await page.evaluate('__ninja.getMotionState().cutting');
              if (cutting) {
                await page.screenshot(`${o.shotsDir}/replay-${mode}-cut-${shots}.png`);
                shots += 1;
                await sleep(1500);
              } else await sleep(15);
            }
          })();
          watcher.stop = () => { on = false; };
        }
        await play(windows[phase]);
        if (watcher) { watcher.stop(); await watcher; }
        out.modes[mode][phase] = await page.evaluate(`(${READ})()`);
        log(`${mode} ${phase}: ${JSON.stringify(out.modes[mode][phase])}`);
      }
    }
    out.problems = { console: page.consoleErrors(), exceptions: page.exceptions, failed: page.failedRequests, bad: page.badResponses };
    await page.close();
  } finally {
    await h.close();
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].split(' ').join('%20')}`).href;
if (isMain) {
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
  const modesArg = process.argv.find((a) => a.startsWith('--modes='));
  const shots = process.argv.find((a) => a.startsWith('--shots='));
  const r = await runBrowserReplay({ modes: modesArg ? modesArg.slice(8).split(',') : undefined, shotsDir: shots ? shots.slice(8) : undefined, art: !process.argv.includes('--no-art') });
  if (r.skip) { console.log(`skipped: ${r.skip}`); process.exit(0); }
  console.log(`art layer on: ${r.assets}`);
  for (const [mode, ph] of Object.entries(r.modes)) {
    for (const [phase, v] of Object.entries(ph)) {
      console.log(`${mode.padEnd(7)} ${phase.padEnd(4)}: cuts ${String(v.cutsTotal).padStart(3)} of ${v.probes} hover apples + waves (game), CUTTING frames ${f1(v.cutFramesPct)} %, swings ${v.swings}, peak tip ${Math.round(v.maxTip)} deg/s (fastest sample while not cutting ${Math.round(v.maxTipWhileNotCutting)}), cursor range ${f1(v.xRangePct)} x ${f1(v.yRangePct)} %, on an edge ${f1(v.edgePct)} % | ${v.frames} frames, ${f1(v.fps)} fps, p95 ${f1(v.p95)} ms, p99 ${f1(v.p99)} ms, max ${f1(v.maxMs)} ms, >33 ms: ${v.over33}, >50 ms: ${v.over50}, callback avg ${v.cpuAvg.toFixed(2)} ms p95 ${v.cpuP95.toFixed(2)} ms | rounds ${v.rounds}`);
    }
  }
  console.log('problems:', JSON.stringify(r.problems));
}
