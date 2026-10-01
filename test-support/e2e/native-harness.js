// End-to-end harness of the native Bluetooth bridge: the REAL game in headless Chrome, the REAL server (server.js with its bridge manager) and the
// FAKE helper process (test-support/bridge/fake-helper.mjs) instead of the CoreBluetooth helper. Nothing here touches Bluetooth or a Joy-Con: the fake
// models docs/native-bridge.md and the protocol document, not the device (UNVERIFIED-ON-HARDWARE).
//
// The fake helper plays a virtual sword (the simulator's physics through the real packet builder). This module is the person holding it: it
// writes commands to the helper's control file (`sword.*`) exactly where a human would move the Joy-Con, and it clicks the game's own targets with real
// pointer events. It is used by test/e2e/native.test.js and by test-support/e2e/native-screens.mjs (the screenshots of docs/img).
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startE2e } from './env.js';
import { FAKE_HELPER } from '../bridge/server-harness.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} [o]
 * @param {Record<string,string>} [o.helper]  environment of the fake helper (FAKE_HELPER_STEP_MS, ..._WAIT_MS, ..._SCAN_MS, ..._HELLO_MS, ..._STREAM_MS, ..._SCENARIO ...)
 * @param {{width?:number, height?:number}} [o.viewport]
 */
export async function startNativeE2e(o = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'joycon-native-e2e-'));
  const control = join(dir, 'control.json');
  const logFile = join(dir, 'helper.log');
  const helperEnv = {
    ...process.env,
    FAKE_HELPER_MOTION: 'model',
    FAKE_HELPER_CONTROL: control,
    FAKE_HELPER_LOG: logFile,
    FAKE_HELPER_STEP_MS: '120',
    FAKE_HELPER_WAIT_MS: '250',
    FAKE_HELPER_SCAN_MS: '1200',
    FAKE_HELPER_STREAM_MS: '300',
    ...(o.helper ?? {}),
  };
  delete helperEnv.JOYCON_BRIDGE_BIN; // a developer's own override must never leak into the tests
  const env = await startE2e({
    ...(o.viewport ?? {}),
    server: { bridge: { bin: FAKE_HELPER, env: helperEnv, helloTimeoutMs: 8000, stopGraceMs: 300, log: () => {} } },
  });
  if (env.skip) return { ...env, cleanupDir: () => rmSync(dir, { recursive: true, force: true }) };

  let seq = 0;
  const send = async (doc) => {
    seq += 1;
    writeFileSync(control, JSON.stringify({ seq, ...doc }));
    await sleep(45); // the helper polls about every 15 ms and reads one document at a time
  };
  const sword = {
    /** the scenario of the NEXT connect (permission, bluetooth_off, no_device, connect_failed, crash1, crash134, happy ...) */
    scenario: (name) => send({ scenario: name }),
    commands: (commands) => send({ commands }),
    pose: (name, transitionMs = 0) => send({ commands: [{ pose: name, transitionMs }] }),
    clearPose: () => send({ commands: [{ clearPose: true }] }),
    moveTo: (x, y, ms = 0) => send({ commands: [{ moveTo: { x, y, ms } }] }),
    button: (name, ms = 150) => send({ commands: [{ button: name, ms }] }),
    /** hold the RIGHT stick at a raw 12-bit position for `ms` (it rests at 1998 / 2007 in the fake, the centre measured on the real recording) */
    stick: (x, y, ms = 220) => send({ commands: [{ stick: { x, y, ms } }] }),
    /** one flick of the stick in a direction (a full push, 1400 LSB from the rest position) held for `ms`, then let go */
    flick: (dir, ms = 220) => send({ commands: [{ stick: { x: 1998 + (dir === 'right' ? 1400 : dir === 'left' ? -1400 : 0), y: 2007 + (dir === 'up' ? 1400 : dir === 'down' ? -1400 : 0), ms } }] }),
    crash: (code = 1) => send({ commands: [{ crash: code }] }),
    drop: () => send({ commands: [{ drop: true }] }),
  };

  const bridgeLog = () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

  const h = {
    ...env,
    dir,
    sword,
    bridgeLog,
    helperCommands: () => bridgeLog().filter((e) => e.event === 'command').map((e) => e.cmd),
    helperStarts: () => bridgeLog().filter((e) => e.event === 'start').length,

    /** The game on the real clock (the bridge speaks in real time) with the safety screen skipped and the sound off. */
    async openNative(query = 'skipsafety=1&mute=1') {
      const page = await env.newPage();
      await page.goto(`${env.url}/?${query}`);
      await page.evaluate('window.__ninja.ready');
      return page;
    },
    view: (page) => page.evaluate('__ninja.debug.getUiView()'),
    /** Click the centre of a target of the current screen with real pointer events (the same path as the owner's mouse). */
    async click(page, id) {
      const v = await h.view(page);
      const tg = v.targets.find((t) => t.id === id);
      if (!tg) throw new Error(`no target "${id}" on this screen (have: ${v.targets.map((t) => t.id).join(', ')})`);
      await page.mouse.move(tg.x - 3, tg.y - 3);
      await sleep(30);
      await page.mouse.move(tg.x, tg.y);
      await page.mouse.down(tg.x, tg.y);
      await page.mouse.up(tg.x, tg.y);
    },
    /** Record every distinct progress line of the connect screen (one sample per animation frame) until stopProgress(). */
    startProgress: (page) => page.evaluate(`(() => {
      window.__seen = [];
      window.__seenStop = false;
      const sample = () => {
        const c = __ninja.debug.getUiView().connect;
        const text = c.mode === 'busy' ? c.progressText || c.pillText : c.pillText;
        const last = window.__seen[window.__seen.length - 1];
        if (text && (!last || last.text !== text || last.countdownS !== c.countdownS)) window.__seen.push({ text, mode: c.mode, countdownS: c.countdownS, cancel: c.cancel, at: Math.round(performance.now()) });
        if (!window.__seenStop) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })()`),
    stopProgress: (page) => page.evaluate('(() => { window.__seenStop = true; return window.__seen; })()'),
    ui: (page) => page.evaluate('__ninja.getUiState()'),
    async waitScreen(page, screen, timeoutMs = 30000) {
      await page.waitFor((s) => __ninja.getUiState().screen === s, { timeoutMs, message: `screen ${screen}` }, screen);
    },
    async waitConnect(page, predicateSource, timeoutMs = 30000, message = 'the connect screen state') {
      await page.waitFor(`(() => { const c = __ninja.debug.getUiView().connect; return ${predicateSource}; })()`, { timeoutMs, message });
    },
    async close() {
      await env.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return h;
}

/**
 * The person at the sword: walks through the four steps of the calibration wizard with the virtual sword, the way the screen tells (tip up and still,
 * then a smooth turn to point at the screen, still, centre with the ZR button, then cut the practice apple). Returns when the wizard is over.
 */
export async function playCalibration(h, page, { timeoutMs = 60000 } = {}) {
  await h.waitScreen(page, 'calibration', timeoutMs);
  // step 1: the virtual sword stands tip up and still (the fake starts in that pose): wait until the wizard asks for the next pose
  await page.waitFor(() => __ninja.getUiState().calibrationStep >= 2, { timeoutMs, message: 'wizard step 2' });
  await h.sword.pose('pointScreen', 1200);
  await page.waitFor(() => __ninja.getUiState().calibrationStep >= 3, { timeoutMs, message: 'wizard step 3' });
  await sleep(300);
  await h.sword.button('ZR', 200); // "press ZR": a real button press in the report
  await page.waitFor(() => __ninja.getUiState().calibrationStep === 4, { timeoutMs, message: 'wizard step 4 (the practice round)' });
  // step 4: the real sword points like a MOUSE in the local frame of the sword (docs/motion-contract.md 1): the cursor has no absolute position, so the
  // person places it with the test hook (__ninja.reanchor) and then slashes at a real angular speed. The virtual sword aims from the left edge to the
  // right edge of the playfield in 100 ms (70 degrees, about 700 degrees per second at the tip, above the 300 deg/s threshold), which drags the cursor
  // about 970 px across the apple. The idle glide is switched off for the practice (a setting of the game) so that the cursor stays where it was placed
  // while the test waits for the apple; the setting is restored afterwards.
  await h.sword.clearPose();
  await page.evaluate("__ninja.setSetting('autoCenter', false)");
  let cut = false;
  for (let attempt = 0; attempt < 8 && !cut; attempt++) {
    await h.sword.moveTo(0, 400, 500); // the wind-up: a slow turn to the left edge (70 deg/s)
    await sleep(650);
    await page.evaluate('__ninja.reanchor(520, 400)');
    await sleep(200);
    await page.waitFor(() => {
      const o = __ninja.snapshot().objects.find((x) => x.kind === 'fruit');
      return !!o && Math.abs(o.vy) < 160 && o.y < 520;
    }, { timeoutMs: 8000, pollMs: 16, message: 'the practice apple near its apex' });
    await h.sword.moveTo(1920, 400, 100);
    await sleep(500);
    cut = (await page.evaluate('__ninja.getUiState().screen')) === 'menu';
  }
  await page.evaluate("__ninja.setSetting('autoCenter', true)");
  await page.waitFor(() => __ninja.getUiState().screen === 'menu', { timeoutMs: 15000, message: 'the menu after the practice cut' });
}
