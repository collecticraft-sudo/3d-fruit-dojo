#!/usr/bin/env node
// Takes the first ten screenshots of docs/img (01 to 10: safety, connect, menu, calibration steps 1, 3 and 4, a combo, settings, the sword tuning
// screen and the diagnostics page) used by README.md and docs/GUIDE.md. The native bridge pictures (11 to 22) come from native-screens.mjs.
// It drives the REAL game in headless Chrome against the REAL server with the built-in simulator and the manual clock, so the pictures show the screens
// in English exactly as the game draws them (the simulator stands in for a real Joy-Con: a mouse-style hint such as "double click" is expected).
// Nothing here is a test; `node test-support/e2e/guide-screens.mjs [outputFolder]` (default docs/img) rewrites the files.
//
// PNG files from Chrome are converted to JPEG with macOS `sips` (1280 px wide, quality 78) to keep the repository small; without `sips` the PNG files are kept.
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startE2e } from './env.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'docs', 'img'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = await startE2e();
if (env.skip) {
  console.error(`cannot take screenshots: ${env.skip}`);
  process.exit(1);
}

const hasSips = spawnSync('sips', ['--version'], { stdio: 'ignore' }).status === 0;
/** Paint the current state, save it, and convert the game pictures to 1280 px wide JPEG files. */
async function shot(page, name, { resize = true } = {}) {
  await page.evaluate('window.__ninja && __ninja.debug.draw()');
  const png = join(OUT, `${name}.png`);
  await page.screenshot(png);
  if (hasSips) {
    const args = resize ? ['-Z', '1280'] : [];
    spawnSync('sips', [...args, '-s', 'format', 'jpeg', '-s', 'formatOptions', '78', png, '--out', join(OUT, `${name}.jpg`)], { stdio: 'ignore' });
    rmSync(png);
  }
  console.log(`wrote ${name}.${hasSips ? 'jpg' : 'png'}`);
}
const run = (page, code) => page.evaluate(`(async () => { const n = window.__ninja; ${code} })()`);
/**
 * With the generated art the backdrop of a screen loads in REAL time and dissolves in over 400 ms of GAME time (the manual clock only moves when the
 * script advances it), so wait for the group of the stage, then advance with a draw every 50 ms until the dissolve is over. Without art it does nothing.
 */
const artReady = async (page, stage = 'menu') => {
  await page.evaluate(`(async () => {
    const t0 = performance.now();
    __ninja.advance(50); __ninja.debug.draw();
    while (performance.now() - t0 < 8000) {
      const a = __ninja.getAssets();
      if (!a.enabled || (a.groups['stage:${stage}'] && a.groups['stage:${stage}'].state === 'ready')) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    for (let i = 0; i < 14; i++) { __ninja.advance(50); __ninja.debug.draw(); }
  })()`);
};
const open = async (query) => {
  const page = await env.newPage();
  await page.goto(`${env.url}/?${query}`);
  await page.evaluate('window.__ninja.ready');
  await artReady(page, 'menu');
  return page;
};
const BASE = 'input=sim&skipsafety=1&clock=manual&mute=1';

try {
  // 01: the safety screen with its button unlocked
  let page = await open('input=sim&clock=manual&mute=1');
  await run(page, 'n.advance(2600);');
  await shot(page, '01-safety-screen');
  await page.close();

  // 02: the connect screen of the Web Bluetooth layout (the native bridge layout is picture 11)
  page = await open('input=joycon&skipsafety=1&clock=manual&mute=1');
  await run(page, 'n.advance(400);');
  await shot(page, '02-connect-screen');
  await page.close();

  // 03: the menu; 08 settings; 09 the sword tuning screen
  page = await open(BASE);
  await run(page, 'n.advance(1600);');
  await shot(page, '03-menu');
  await run(page, "n.debug.forceScreen('settings'); n.advance(200);");
  await shot(page, '08-settings');
  await run(page, "n.debug.forceScreen('tuning'); n.advance(200);");
  await shot(page, '09-tuning-screen');
  // 04, 05, 06: calibration steps 1, 3 and 4 (step 4 shows the practice apple)
  await run(page, "n.debug.forceScreen('calibration', { step: 1 }); n.advance(300);");
  await shot(page, '04-calibration-step1');
  await run(page, "n.debug.forceScreen('calibration', { step: 3 }); n.advance(300);");
  await shot(page, '05-calibration-step3');
  await page.close();
  // step 4 is a practice round whose apple belongs to a real round: run the real wizard against the simulator instead of forcing the screen
  page = await open(`${BASE}&simcal=1`);
  await run(page, "for (let i = 0; i < 4000 && n.snapshot().mode !== 'practice'; i++) n.advance(50); n.advance(1800);");
  await shot(page, '06-calibration-step4');
  await page.close();

  // 07: a four-fruit swing gives a combo (Classic, so the lives are on the screen)
  page = await open(BASE);
  await run(page, `
    n.start('classic', { seed: 21 });
    n.debug.wavesEnabled(false);`);
  await artReady(page, 'classic');
  await run(page, `
    n.advance(1000);
    const spec = [['watermelon', 420], ['orange', 740], ['kiwi', 1060], ['apple', 1380]];
    for (const [type, x] of spec) n.debug.spawn({ kind: 'fruit', type, apexX: x, apexY: 500, atApex: true });
    n.advance(30);
    await n.swing({ x: 250, y: 500 }, { x: 1650, y: 500 }, 170);
    n.advance(200);`);
  await shot(page, '07-combo');
  await page.close();

  // 10: the diagnostics page with the simulator (1100 px wide like the original picture)
  page = await env.newPage({ width: 1100, height: 970 });
  await page.goto(`${env.url}/diagnostics.html?input=sim`);
  await page.evaluate("document.getElementById('btn-connect').click()");
  await page.waitFor("document.getElementById('st-state').textContent === 'streaming'", { timeoutMs: 15000, message: 'streaming' });
  await sleep(5000);
  await page.evaluate('window.scrollTo(0, 0)');
  await shot(page, '10-diagnostics-page', { resize: false });
  await page.close();
} finally {
  await env.close();
}
