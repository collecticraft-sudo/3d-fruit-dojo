#!/usr/bin/env node
// Final QA run (docs/FINAL-STATUS.md): plays the REAL game in headless Chrome against the REAL server with the built-in simulator and the manual
// clock, and writes its evidence to docs/qa/final/ (or the folder given as the first argument): screenshots of every screen, FILMSTRIPS (frames at
// 0, 100, 200, 300 and 400 ms) of the screen transitions, of a combo, a bomb, Freeze and Frenzy, a bot that plays Classic, Arcade and Zen, and
// measurements of the JavaScript cost of a frame and of the heap in the heaviest scene (report.json).
// Nothing here is a test. The simulator stands in for a real Joy-Con: nothing in the output says anything about the physical sword.
//
//   node test-support/e2e/qa-final.mjs [outputFolder]
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startE2e } from './env.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'docs', 'qa', 'final'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { chrome: null, when: new Date().toISOString().slice(0, 10), steps: {}, problems: [] };

const env = await startE2e();
if (env.skip) {
  console.error(`cannot run: ${env.skip}`);
  process.exit(1);
}
report.chrome = env.chrome;

const BASE = 'input=sim&skipsafety=1&clock=manual&mute=1';
const run = (page, code) => page.evaluate(`(async () => { const n = window.__ninja; ${code} })()`);
const save = (name, dataUrl) => writeFileSync(join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

/** Wait for the group of a stage, then advance with a draw every 50 ms until the dissolve is over. */
const artReady = (page, stage) => page.evaluate(`(async () => {
  const t0 = performance.now();
  __ninja.advance(50); __ninja.debug.draw();
  while (performance.now() - t0 < 8000) {
    const a = __ninja.getAssets();
    if (!a.enabled || (a.groups['stage:${stage}'] && a.groups['stage:${stage}'].state === 'ready')) break;
    await new Promise((r) => setTimeout(r, 30));
  }
  for (let i = 0; i < 14; i++) { __ninja.advance(50); __ninja.debug.draw(); }
})()`);

async function open(query = BASE, stage = 'menu', pageOpts = {}) {
  const page = await env.newPage(pageOpts);
  await page.goto(`${env.url}/?${query}`);
  await page.evaluate('window.__ninja.ready');
  await artReady(page, stage);
  return page;
}

async function shot(page, name) {
  await page.evaluate('__ninja.debug.draw()');
  await page.screenshot(join(OUT, `${name}.png`));
  console.log(`wrote ${name}.png`);
}

/**
 * A filmstrip: `action` (JS run in the page, may press keys or swing) then frames at `times` ms after it (the clock advances between the
 * frames by the difference, in steps of 16 ms, with a draw per step). The strip is composed inside the page: 480 x 270 per frame.
 */
async function filmstrip(page, name, action, times = [0, 100, 200, 300, 400]) {
  const url = await page.evaluate(`(async () => {
    const n = window.__ninja;
    const c = document.getElementById('stage');
    const frames = [];
    const grab = () => { n.debug.draw(); const t = document.createElement('canvas'); t.width = 480; t.height = 270; t.getContext('2d').drawImage(c, 0, 0, 480, 270); return t; };
    ${action}
    let at = 0;
    for (const ms of ${JSON.stringify(times)}) {
      while (at < ms) { const d = Math.min(16, ms - at); n.advance(d); n.debug.draw(); at += d; }
      frames.push(grab());
    }
    const strip = document.createElement('canvas');
    strip.width = 480 * frames.length; strip.height = 270 + 22;
    const g = strip.getContext('2d');
    g.fillStyle = '#14141c'; g.fillRect(0, 0, strip.width, strip.height);
    g.font = '15px system-ui, sans-serif'; g.fillStyle = '#f4ebd9';
    frames.forEach((f, i) => { g.drawImage(f, i * 480, 22); g.fillText(${JSON.stringify(times)}[i] + ' ms', i * 480 + 8, 16); });
    return strip.toDataURL('image/png');
  })()`);
  save(`${name}.png`, url);
  console.log(`wrote ${name}.png`);
}

const step = async (name, fn) => {
  try {
    report.steps[name] = (await fn()) ?? 'ok';
  } catch (err) {
    report.steps[name] = `FAILED: ${err.message}`;
    report.problems.push(`${name}: ${err.message}`);
    console.error(`step ${name} failed:`, err.message);
  }
};

try {
  // ---------------------------------------------------------------- the screens, the transitions
  await step('menu-and-transitions', async () => {
    const page = await open();
    await run(page, 'n.advance(1700);');
    await shot(page, 'menu');
    // the real menu entrance (logo drop, splash, fruit and buttons rising) only runs at boot, a forced screen has none: film a fresh page right after `ready`
    const boot = await env.newPage();
    await boot.goto(`${env.url}/?${BASE}`);
    await boot.evaluate('window.__ninja.ready');
    await boot.evaluate(`(async () => { const t0 = performance.now(); while (performance.now() - t0 < 6000) { const a = __ninja.getAssets(); if (a.groups['stage:menu'] && a.groups['stage:menu'].state === 'ready') break; await new Promise((r) => setTimeout(r, 30)); } })()`);
    await filmstrip(boot, 'film-menu-entrance', 'n.advance(0);', [0, 100, 200, 300, 600]);
    await boot.close();
    // menu -> settings with real activations: first arrow key shows the ring, then a move, then confirm
    await run(page, "for (const d of ['down', 'down', 'left']) { n.nav(d, 'down'); n.nav(d, 'up'); n.advance(300); }");
    const focus = await page.evaluate('JSON.stringify(__ninja.getUiState().focus ?? null)');
    await filmstrip(page, 'film-wipe-menu-to-settings', "n.press('confirm');");
    await run(page, 'n.advance(500);');
    await shot(page, 'settings');
    await filmstrip(page, 'film-wipe-back-settings-to-menu', "n.press('back');");
    await run(page, 'n.advance(500);');
    await run(page, "n.debug.forceScreen('tuning'); n.advance(300);");
    await shot(page, 'tuning');
    await run(page, "n.debug.forceScreen('calibration', { step: 1 }); n.advance(300);");
    await shot(page, 'calibration-1');
    await page.close();
    // step 4 is a practice round (its apple is part of a real round): run the real wizard against the simulator instead of forcing the screen
    const cal = await open(`${BASE}&simcal=1`);
    await run(cal, "for (let i = 0; i < 4000 && n.snapshot().mode !== 'practice'; i++) n.advance(50); n.advance(1800);");
    await shot(cal, 'calibration-4');
    await cal.close();
    return { focusAfterTwoMoves: focus, screen: 'see files' };
  });

  await step('connect-and-safety', async () => {
    let page = await open('input=joycon&skipsafety=1&clock=manual&mute=1');
    await run(page, 'n.advance(400);');
    await shot(page, 'connect-webble');
    await page.close();
    page = await open('input=sim&clock=manual&mute=1');
    await run(page, 'n.advance(2600);');
    await shot(page, 'safety');
    await page.close();
  });

  await step('countdown-filmstrip', async () => {
    const page = await open();
    await run(page, "n.start('classic', { seed: 3, skipCountdown: false });");
    await artReady(page, 'classic');
    await filmstrip(page, 'film-countdown', "n.debug.forceScreen('countdown', { roundMode: 'classic' });", [0, 100, 200, 300, 400]);
    await filmstrip(page, 'film-countdown-3', 'n.advance(500);', [0, 100, 200, 300, 400]);
    await page.close();
  });

  // ---------------------------------------------------------------- the effects: combo, bomb, freeze, frenzy
  await step('effects', async () => {
    const page = await open(BASE, 'arcade');
    await run(page, "n.start('arcade', { seed: 21 }); n.debug.wavesEnabled(false);");
    await artReady(page, 'arcade');
    await run(page, 'n.advance(800);');
    const spawnLine = (types, y = 500) => `const xs = [420, 740, 1060, 1380]; ${JSON.stringify(types)}.forEach((t, i) => n.debug.spawn({ kind: 'fruit', type: t, apexX: xs[i], apexY: ${y}, atApex: true })); n.advance(30);`;
    // combo: four fruit on a line, one swing
    await run(page, spawnLine(['watermelon', 'orange', 'kiwi', 'apple']));
    await filmstrip(page, 'film-combo', "await n.swing({ x: 250, y: 500 }, { x: 1650, y: 500 }, 170);", [0, 100, 200, 300, 400]);
    await shot(page, 'combo-after');
    await run(page, 'n.advance(1500);');
    // bomb
    await run(page, "n.debug.spawn({ kind: 'bomb', apexX: 960, apexY: 520, atApex: true }); n.advance(30);");
    await filmstrip(page, 'film-bomb', "await n.swing({ x: 700, y: 520 }, { x: 1220, y: 520 }, 120);", [0, 100, 200, 300, 400]);
    await run(page, 'n.advance(2500);');
    // freeze
    await run(page, "n.debug.spawn({ kind: 'powerup', type: 'freeze', apexX: 960, apexY: 520, atApex: true }); n.advance(30);");
    await filmstrip(page, 'film-freeze', "await n.swing({ x: 700, y: 520 }, { x: 1220, y: 520 }, 120);", [0, 100, 200, 300, 400]);
    await shot(page, 'freeze-active');
    await run(page, 'n.advance(6000);');
    // frenzy
    await run(page, "n.debug.spawn({ kind: 'powerup', type: 'frenzy', apexX: 960, apexY: 520, atApex: true }); n.advance(30);");
    await filmstrip(page, 'film-frenzy', "await n.swing({ x: 700, y: 520 }, { x: 1220, y: 520 }, 120);", [0, 100, 200, 300, 400]);
    await run(page, 'n.advance(800);');
    await shot(page, 'frenzy-active');
    // golden apple
    await run(page, "n.debug.spawn({ kind: 'golden', apexX: 960, apexY: 520, atApex: true }); n.advance(30);");
    await filmstrip(page, 'film-golden', "await n.swing({ x: 700, y: 520 }, { x: 1220, y: 520 }, 120);", [0, 100, 200, 300, 400]);
    const errs = page.consoleErrors();
    await page.close();
    return { consoleErrors: errs };
  });

  // ---------------------------------------------------------------- pause
  await step('pause', async () => {
    const page = await open(BASE, 'classic');
    await run(page, "n.start('classic', { seed: 8 }); n.advance(1500);");
    await artReady(page, 'classic');
    await filmstrip(page, 'film-pause', "n.press('pause');", [0, 100, 200, 300, 400]);
    await shot(page, 'pause');
    await filmstrip(page, 'film-resume', "n.press('confirm');", [0, 500, 1000, 1500, 2000]);
    await page.close();
  });

  // ---------------------------------------------------------------- the three modes played by a bot (through the simulator sensor chain)
  for (const mode of ['classic', 'arcade', 'zen']) {
    await step(`bot-${mode}`, async () => {
      const page = await open(BASE, mode);
      const t0 = Date.now();
      const r = await page.evaluate(`window.__helpers.botRound('${mode}', { seed: 11, maxS: 70, skipBombs: false, viaSim: false })`);
      await shot(page, `bot-${mode}-end`);
      const st = await page.evaluate('JSON.stringify({ui: __ninja.getUiState().screen, perf: __ninja.getPerf(), log: __ninja.debug.getLog().filter(l => l.level !== "info").slice(-5)})');
      // the bot never loses: let the round run out (no swings) so that the results screen of every mode is looked at too
      await page.evaluate(`(() => { const n = __ninja; let g = 0; while (n.snapshot().screen === 'playing' && g++ < 12000) n.advance(16); })()`);
      const ui = await page.evaluate('__ninja.getUiState().screen');
      let resultsShot = null;
      if (ui === 'results') {
        // the film starts at the moment the results screen appears (the panel slides in, the score counts up, the seal slams, the ribbon follows)
        await filmstrip(page, `film-results-${mode}`, 'n.advance(0);', [0, 400, 1000, 1800, 2600]);
        await run(page, 'n.advance(1500);');
        await shot(page, `results-${mode}`);
        resultsShot = true;
      }
      const errs = page.consoleErrors();
      await page.close();
      return { wallMs: Date.now() - t0, round: r, state: JSON.parse(st), resultsShot, consoleErrors: errs };
    });
  }

  // ---------------------------------------------------------------- the same round with ?assets=0 and ?fonts=0
  await step('fallbacks', async () => {
    const out = {};
    for (const [label, q] of [['assets0', `${BASE}&assets=0`], ['fonts0', `${BASE}&fonts=0`]]) {
      const page = await env.newPage();
      await page.goto(`${env.url}/?${q}`);
      await page.evaluate('window.__ninja.ready');
      await run(page, 'n.advance(1700);');
      await shot(page, `fallback-${label}-menu`);
      const a = await page.evaluate('JSON.stringify(__ninja.getAssets())');
      await run(page, "n.start('classic', { seed: 4 }); n.advance(2500);");
      await shot(page, `fallback-${label}-classic`);
      out[label] = { assets: JSON.parse(a), requestsUnderAssets: page.requests.filter((r) => r.url.includes('/assets/')).map((r) => r.url.replace(env.url, '')), consoleErrors: page.consoleErrors() };
      await page.close();
    }
    return out;
  });

  // ---------------------------------------------------------------- performance: the heaviest scene
  await step('perf-heaviest-scene', async () => {
    const page = await open(BASE, 'arcade');
    const res = await page.evaluate(`(async () => {
      const n = window.__ninja;
      n.start('arcade', { seed: 31 });
      n.debug.wavesEnabled(true);
      n.advance(600);
      const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : null);
      const heap0 = mem();
      const times = [];
      let cuts = 0;
      // heavy: frenzy on, many fruit in the air, a bot that cuts, combos and splats everywhere
      n.debug.spawn({ kind: 'powerup', type: 'frenzy', apexX: 960, apexY: 520, atApex: true });
      n.advance(30);
      await n.swing({ x: 700, y: 520 }, { x: 1220, y: 520 }, 120);
      const frame = (ms) => { const a = performance.now(); n.advance(ms); n.debug.draw(); times.push(performance.now() - a); };
      for (let f = 0; f < 1800; f++) {
        frame(16);
        if (f % 24 === 0) {
          const s = n.snapshot();
          const ts = s.objects.filter((q) => q.kind !== 'bomb' && q.y > 200 && q.y < 900).slice(0, 4);
          if (s.screen === 'playing') for (const t of ts) { try { const r = await n.swingThrough(t.id, { angleDeg: 15 }); cuts += r.cutCount; } catch { /* the fruit fell or was cut by the previous swing */ } }
          if (n.snapshot().screen !== 'playing') break;
        }
      }
      times.sort((a, b) => a - b);
      const pick = (p) => times[Math.min(times.length - 1, Math.floor(times.length * p))];
      const heap1 = mem();
      const objs = n.debug.getCounters();
      return { frames: times.length, cuts, avgMs: times.reduce((a, b) => a + b, 0) / times.length, p50: pick(0.5), p95: pick(0.95), p99: pick(0.99), maxMs: times[times.length - 1], heap0, heap1, counters: objs, screen: n.snapshot().screen };
    })()`);
    await shot(page, 'perf-heaviest-scene');
    await page.close();
    return res;
  });

  await step('perf-realtime-raf', async () => {
    // real clock: how fast does requestAnimationFrame run while a round with the bot plays (the same measure as test/e2e/perf.test.js)
    const page = await env.newPage();
    await page.goto(`${env.url}/?input=sim&skipsafety=1&mute=1&seed=9`);
    await page.evaluate('window.__ninja.ready');
    await sleep(800);
    await page.evaluate("__ninja.start('classic', { seed: 9 })");
    const r = await page.evaluate(`new Promise((resolve) => {
      const iv = []; let last = performance.now(); const t0 = last; let n = 0;
      const tick = (t) => { iv.push(t - last); last = t; n++; if (t - t0 < 10000) requestAnimationFrame(tick); else { iv.sort((a, b) => a - b); resolve({ frames: n, avg: iv.reduce((a, b) => a + b, 0) / iv.length, p95: iv[Math.floor(iv.length * 0.95)], p99: iv[Math.floor(iv.length * 0.99)], max: iv[iv.length - 1], heap: performance.memory ? performance.memory.usedJSHeapSize : null }); } };
      requestAnimationFrame(tick);
    })`);
    const perf = await page.evaluate('__ninja.getPerf()');
    await page.close();
    return { raf: r, perf };
  });
} finally {
  // PNG to JPEG (macOS sips, quality 80, at most 1600 px wide for the single frames) to keep the repository small
  if (spawnSync('sips', ['--version'], { stdio: 'ignore' }).status === 0) {
    for (const f of readdirSync(OUT).filter((x) => x.endsWith('.png'))) {
      const film = f.startsWith('film-');
      const args = film ? [] : ['-Z', '1600'];
      const r = spawnSync('sips', [...args, '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', join(OUT, f), '--out', join(OUT, f.replace(/\.png$/, '.jpg'))], { stdio: 'ignore' });
      if (r.status === 0) rmSync(join(OUT, f));
    }
  }
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await env.close();
}
console.log(report.problems.length ? `PROBLEMS:\n${report.problems.join('\n')}` : 'no step failed');
