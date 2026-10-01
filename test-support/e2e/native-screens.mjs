#!/usr/bin/env node
// Takes the screenshots of the native Bluetooth bridge screens for docs/GUIDE.md: the connect screen in every phase of an attempt, two errors, the
// disconnect panel and the diagnostics page in native mode. It drives the REAL game in headless Chrome against the REAL server and the FAKE helper
// (test-support/bridge/fake-helper.mjs) with slowed-down phases, so the pictures show the screens, not a real Joy-Con (the captions of the guide say
// so). Nothing here is a test; `node test-support/e2e/native-screens.mjs [outputFolder]` (default docs/img) rewrites the files.
//
// PNG files from Chrome are converted to JPEG with macOS `sips` (1280 px wide, quality 78) to keep the repository small; without `sips` the PNG files are kept.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNativeE2e, sleep } from './native-harness.js';
import { STRINGS } from '../../public/js/ui/strings.en.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'docs', 'img'));
mkdirSync(OUT, { recursive: true });

const h = await startNativeE2e({
  helper: {
    FAKE_HELPER_HELLO_MS: '1800', FAKE_HELPER_WAIT_MS: '1800', FAKE_HELPER_SCAN_MS: '5000', FAKE_HELPER_STEP_MS: '1800', FAKE_HELPER_STREAM_MS: '2200',
  },
});
if (h.skip) {
  console.error(`cannot take screenshots: ${h.skip}`);
  process.exit(1);
}

const hasSips = spawnSync('sips', ['--version'], { stdio: 'ignore' }).status === 0;
async function shot(page, name) {
  await page.evaluate('window.__ninja && __ninja.debug.draw()');
  const png = join(OUT, `${name}.png`);
  await page.screenshot(png);
  if (hasSips) {
    spawnSync('sips', ['-Z', '1280', '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', png, '--out', join(OUT, `${name}.jpg`)], { stdio: 'ignore' }); // 1280 px wide like the other pictures of docs/img
    rmSync(png);
  }
  console.log(`wrote ${name}.${hasSips ? 'jpg' : 'png'}`);
}
const P = (key) => STRINGS[`connect.native.progress.${key}`];
const waitText = (page, text, ms = 60000) => h.waitConnect(page, `c.progressText === ${JSON.stringify(text)}`, ms, text);

try {
  const page = await h.openNative();
  await h.waitConnect(page, 'c.native === true && c.buttonEnabled', 15000);
  await shot(page, '11-native-connect');
  await h.click(page, 'connect.main');
  await waitText(page, P('starting'));
  await shot(page, '12-native-progress-starting');
  await waitText(page, P('waitingBluetooth'));
  await shot(page, '13-native-progress-waiting-bluetooth');
  await waitText(page, P('scanning'));
  await h.waitConnect(page, 'c.countdownS !== null && c.countdownS <= 41', 20000, 'the countdown');
  await shot(page, '14-native-progress-scanning');
  await waitText(page, P('connecting'));
  await shot(page, '15-native-progress-connecting');
  await waitText(page, P('initialising'));
  await shot(page, '16-native-progress-initialising');
  await waitText(page, P('waitingData'));
  await shot(page, '17-native-progress-waiting-data');
  await h.waitConnect(page, "c.mode === 'connected'", 20000, 'Connected');
  await shot(page, '18-native-connected');
  await page.close();
  await sleep(1500);

  // two errors
  const errPage = await h.openNative();
  await h.waitConnect(errPage, 'c.native && c.buttonEnabled', 15000);
  await h.sword.scenario('permission');
  await h.click(errPage, 'connect.main');
  await h.waitConnect(errPage, "c.mode === 'error'", 30000, 'the permission error');
  await shot(errPage, '19-native-err-permission');
  await h.sword.scenario('no_device');
  await h.click(errPage, 'connect.main');
  await h.waitConnect(errPage, "c.mode === 'error' && c.pillText.startsWith('No Joy-Con found')", 60000, 'the no_device error');
  await shot(errPage, '20-native-err-no-device');
  await errPage.close();
  await sleep(1500);

  // the disconnect panel after a crash in the middle of a game
  await h.sword.scenario('happy');
  const gamePage = await h.openNative();
  await h.waitConnect(gamePage, 'c.native && c.buttonEnabled', 15000);
  await h.click(gamePage, 'connect.main');
  await h.waitConnect(gamePage, "c.mode === 'connected'", 60000);
  await gamePage.evaluate("__ninja.start('zen', { seed: 9 })");
  await sleep(1500);
  await h.sword.drop();
  await gamePage.waitFor(() => __ninja.getUiState().overlay === 'disconnected', { timeoutMs: 10000, message: 'the disconnect panel' });
  await sleep(300);
  await shot(gamePage, '21-native-disconnected');
  await gamePage.close();
  await sleep(1500);

  // the diagnostics page in native mode (with the quick fake timings)
  const diag = await h.newPage();
  await diag.goto(`${h.url}/diagnostics.html`);
  await diag.waitFor("document.getElementById('nb-status').textContent.startsWith('available')", { timeoutMs: 8000, message: 'the bridge status' });
  await diag.evaluate("document.getElementById('btn-connect').click()");
  await diag.waitFor("document.getElementById('st-state').textContent === 'streaming'", { timeoutMs: 60000, message: 'streaming' });
  await sleep(4000);
  await diag.evaluate('window.scrollTo(0, 0)');
  await shot(diag, '22-native-diagnostics');
  await diag.close();
} finally {
  await h.close();
}
