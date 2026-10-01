// e2e (headless Chrome over CDP) for the generated art (docs/assets-integration.md 8.6): the real files of public/assets/ through the real server,
// then the fallbacks: ?assets=0, a manifest that fails, files that are missing (404), and a manifest that arrives late.
// Skipped (never "passed") when Chrome is missing. Screenshots for a human go to E2E_SCREENSHOTS when it is set (never into public/ or design/).
// Nothing here says anything about the physical Joy-Con (UNVERIFIED-ON-HARDWARE); the numbers of a headless Chrome are not the owner's Mac.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startE2e } from '../../test-support/e2e/env.js';

const env = await startE2e();
const skip = env.skip;
after(() => env.close());

const REAL = 'input=sim&skipsafety=1&mute=1';
const MANUAL = 'input=sim&clock=manual&skipsafety=1&mute=1';
const manifest = JSON.parse(readFileSync(new URL('../../public/assets/manifest.json', import.meta.url), 'utf8'));
const CORE_TOTAL = manifest.groups.core.length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `expression` in the page until it is truthy (real time). */
async function until(page, expression, message, timeoutMs = 10000) {
  return page.waitFor(expression, { timeoutMs, pollMs: 40, message });
}

/** Answer requests under /assets/ by hand: {match: RegExp, status?: number, fail?: true, delayMs?: number}. Everything else goes through. */
async function intercept(page, rules) {
  const seen = [];
  page.conn.on('Fetch.requestPaused', async (p) => {
    const url = p.request.url;
    const rule = rules.find((r) => r.match.test(url));
    try {
      if (rule) seen.push({ url, rule, at: Date.now() });
      if (rule?.delayMs) await sleep(rule.delayMs);
      if (rule && rule.status) await page.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: rule.status, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '' });
      else if (rule && rule.fail) await page.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'Failed' });
      else await page.send('Fetch.continueRequest', { requestId: p.requestId });
    } catch {
      /* the page was closed while a request was paused */
    }
  }, page.sessionId);
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/assets/*' }] });
  return seen;
}

/** Count the pixels of the logo box (playfield x 740 to 1180, y 10 to 236) that are the logo's vermilion "3D": 0 on the painted title (gold letters since the restyle). */
const LOGO_PIXELS = `(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const k = c.width / 1920;
  const x0 = Math.round(740 * k), y0 = Math.round(10 * k), w = Math.round(440 * k), h = Math.round(226 * k);
  const d = ctx.getImageData(x0, y0, w, h).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] < 80) n++;
  return n;
})()`;

/** Mean and spread of a coarse grid of the canvas: a blank frame has a spread of 0. */
const CANVAS_STATS = `(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const vals = [];
  for (let i = 0; i < 32; i++) for (let j = 0; j < 18; j++) {
    const d = ctx.getImageData(Math.floor(((i + 0.5) * c.width) / 32), Math.floor(((j + 0.5) * c.height) / 18), 1, 1).data;
    vals.push(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]);
  }
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
  return { mean, sd, colours: __helpers.canvasColours() };
})()`;

/** How many pixels of the bottom row of the playfield have the vermilion of the thin loading bar (0 when there is no bar). */
const BAR_PIXELS = `(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const k = c.width / 1920;
  const d = ctx.getImageData(0, Math.round(1077 * k), c.width, 1).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 140 && d[i + 1] < 90 && d[i + 2] < 90) n++;
  return n;
})()`;

const onlyBrowserNetworkLines = (lines) => lines.filter((l) => !/Failed to load resource/.test(l));

/** Visit every screen and overlay with the manual clock and check that each one paints a real frame. */
async function visitEveryScreen(page, label) {
  const shots = [];
  // an overlay dims the frozen frame under a paper panel, so it legitimately has fewer colours and less spread
  const visit = async (name, setup, { colours = 12, spread = 8 } = {}) => {
    await page.evaluate(setup);
    await page.evaluate('__ninja.advance(200); __ninja.debug.draw();');
    const stats = await page.evaluate(CANVAS_STATS);
    assert.ok(stats.colours > colours, `${label} ${name}: ${stats.colours} colours`);
    assert.ok(stats.sd > spread, `${label} ${name}: the frame is not flat (spread ${stats.sd.toFixed(1)})`);
    await env.screenshot(page, `${label}-${name}`);
    shots.push(name);
  };
  await visit('menu', "__ninja.debug.forceScreen('menu')");
  await visit('settings', "__ninja.debug.forceScreen('settings')");
  await visit('tuning', "__ninja.debug.forceScreen('tuning')");
  await visit('connect', "__ninja.debug.forceScreen('connect')");
  await visit('safety', "__ninja.debug.forceScreen('safety')");
  for (const step of [1, 2, 3, 4]) await visit(`calibration-${step}`, `__ninja.debug.forceScreen('calibration', { step: ${step} })`);
  await visit('countdown', "__ninja.start('classic', { seed: 4, skipCountdown: false })");
  await visit('classic', "__ninja.start('classic', { seed: 4 }); __ninja.advance(1600)");
  await visit('arcade', "__ninja.start('arcade', { seed: 4 }); __ninja.advance(1600)");
  await visit('zen', "__ninja.start('zen', { seed: 4 }); __ninja.advance(1600)");
  await visit('paused', "__ninja.press('pause')");
  await visit('results', "__ninja.debug.forceScreen('results', { roundMode: 'arcade' })");
  await visit('disconnected', "__ninja.start('classic', { seed: 4 }); __ninja.advance(300); __ninja.sim.simulateLoss()", { colours: 5, spread: 2 });
  assert.equal(await page.evaluate("__ninja.getUiState().overlay"), 'disconnected');
  return shots;
}

test('e2e art 1: with the real files the art loads (core, then the night stage), the stage follows the mode, at most two stages stay decoded, and the art is on screen', { skip }, async (t) => {
  const page = await env.openGame(`${REAL}&seed=5`);
  const a0 = await page.evaluate('__ninja.getAssets()');
  assert.equal(a0.enabled, true);
  assert.equal(a0.manifest, 'ready');
  await until(page, "__ninja.getAssets().groups.core.state === 'ready'", 'core ready');
  const a1 = await page.evaluate('__ninja.getAssets()');
  assert.equal(a1.groups.core.loaded, CORE_TOTAL);
  assert.equal(a1.groups.core.failed, 0);
  await until(page, "__ninja.getAssets().stage && __ninja.getAssets().stage.shown === 'menu'", 'the night stage is on screen');
  // a round stage loads when it is needed; the only early one is the mode fruit the (centred) cursor rests on, which the menu prefetches
  const early = ['stage:classic', 'stage:arcade', 'stage:zen'].filter((g) => a1.groups[g].state !== 'idle');
  assert.ok(early.length <= 1, `at most the hovered stage is loaded before a round: ${early}`);
  // both web fonts are loaded and registered before the menu is shown (the boot wait covers them), and the page asked for nothing outside the server
  assert.deepEqual(a1.fonts.loaded.sort(), ['DojoDisplay', 'DojoUI'], 'both fonts are usable');
  assert.equal(a1.fonts.state, 'ready');
  assert.equal(await page.evaluate("document.fonts.check('32px DojoDisplay')"), true);
  // the logo picture is on the canvas (the painted title has no vermilion 3D)
  await sleep(700);
  assert.ok((await page.evaluate(LOGO_PIXELS)) > 500, 'the logo art is drawn on the menu');
  await env.screenshot(page, 'art1-menu');

  let maxResident = 0;
  for (const mode of ['classic', 'arcade', 'zen']) {
    await page.evaluate(`__ninja.start('${mode}', { seed: 5 })`);
    const t0 = Date.now();
    for (;;) {
      const st = await page.evaluate('__ninja.getAssets().stage');
      maxResident = Math.max(maxResident, st.resident.length);
      if (st.shown === mode && !st.fading) break;
      assert.ok(Date.now() - t0 < 6000, `the ${mode} stage did not arrive (${JSON.stringify(st)})`);
      await sleep(30);
    }
    t.diagnostic(`${mode}: stage on screen ${Date.now() - t0} ms after start (headless Chrome, loopback)`);
    const stats = await page.evaluate(CANVAS_STATS);
    assert.ok(stats.colours > 20 && stats.sd > 8, `${mode}: ${JSON.stringify(stats)}`);
    await env.screenshot(page, `art1-${mode}`);
    await page.evaluate("__ninja.debug.forceScreen('menu')");
    await until(page, "__ninja.getAssets().stage.shown === 'menu'", 'back to the night stage');
  }
  assert.ok(maxResident <= 2, `at most two stages resident, saw ${maxResident}`);
  const a2 = await page.evaluate('__ninja.getAssets()');
  assert.equal(a2.stage.failed.length, 0);
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
  assert.deepEqual(page.failedRequests, []);
  assert.deepEqual(page.badResponses, []);
  const asset = page.requests.filter((r) => r.url.includes('/assets/'));
  assert.ok(asset.length > CORE_TOTAL, `${asset.length} asset requests`);
  assert.equal(asset.every((r) => r.url.startsWith(env.url)), true, 'every asset comes from the game server');
  assert.equal(page.console.filter((c) => c.type === 'warning').length, 0, 'no loader warning when everything loads');
});

test('e2e art 2: every screen and overlay draws a real frame with the art (manual clock), no console error, no page error', { skip }, async () => {
  const page = await env.openGame(`${MANUAL}&seed=6`);
  await until(page, "__ninja.getAssets().groups.core.state === 'ready'", 'core ready');
  await sleep(500);
  const shots = await visitEveryScreen(page, 'art');
  assert.equal(shots.length, 16);
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
  assert.deepEqual(page.badResponses, []);
  const log = await page.evaluate('__ninja.debug.getLog()');
  assert.deepEqual(log.filter((l) => l.level === 'error'), []);
});

test('e2e art 3: ?assets=0 is the painted game: no request under /assets/, the loader is off, every screen still draws', { skip }, async () => {
  const page = await env.openGame(`${MANUAL}&seed=6&assets=0`);
  const a = await page.evaluate('__ninja.getAssets()');
  assert.equal(a.enabled, false);
  assert.deepEqual(a.groups, {});
  assert.equal(a.stage, null);
  assert.equal(a.fonts.state, 'off', '?assets=0 also keeps the system fonts');
  assert.equal(page.requests.filter((r) => r.url.includes('/assets/')).length, 0, 'nothing under /assets/ is requested');
  await page.evaluate('__ninja.advance(500); __ninja.debug.draw();');
  assert.equal(await page.evaluate(LOGO_PIXELS), 0, 'no logo art: the painted title');
  await visitEveryScreen(page, 'painted');
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
  assert.equal(page.requests.filter((r) => r.url.includes('/assets/')).length, 0);
});

test('e2e art 3b: ?fonts=0 keeps the art but asks for no font file; the text is drawn with the system fonts', { skip }, async () => {
  const page = await env.openGame(`${MANUAL}&seed=6&fonts=0`);
  const a = await page.evaluate('__ninja.getAssets()');
  assert.equal(a.enabled, true);
  assert.equal(a.fonts.state, 'off');
  assert.equal(page.requests.filter((r) => r.url.includes('/assets/fonts/')).length, 0, 'no font file is requested');
  await page.evaluate('__ninja.advance(500); __ninja.debug.draw();');
  await visitEveryScreen(page, 'nofonts');
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
});

test('e2e art 4: a manifest that fails (network error) leaves the painted game, one warning line, and every screen still draws', { skip }, async () => {
  const page = await env.newPage();
  const seen = await intercept(page, [{ match: /\/assets\/manifest\.json$/, fail: true }]);
  await page.goto(`${env.url}/?${MANUAL}&seed=6`);
  await page.evaluate('window.__ninja.ready');
  const a = await page.evaluate('__ninja.getAssets()');
  assert.equal(a.enabled, true, 'the loader exists');
  assert.equal(a.manifest, 'failed');
  assert.equal(seen.length, 1);
  assert.equal(await page.evaluate("__ninja.getUiState().screen"), 'menu');
  await page.evaluate('__ninja.advance(500); __ninja.debug.draw();');
  assert.equal(await page.evaluate(LOGO_PIXELS), 0, 'painted title');
  await visitEveryScreen(page, 'nomanifest');
  assert.deepEqual(onlyBrowserNetworkLines(page.consoleErrors()), [], 'only the browser\'s own line about the blocked file');
  assert.equal(page.consoleErrors().filter((l) => /manifest\.json/.test(l)).length <= 1, true);
  assert.deepEqual(page.exceptions, []);
  const warns = page.console.filter((c) => c.type === 'warning' && /^\[joycon-ninja\] the asset manifest/.test(c.text));
  assert.equal(warns.length, 1, `one loader warning: ${JSON.stringify(page.console)}`);
});

test('e2e art 5: missing files (a fruit sprite, a stage layer and a UI image answer 404): the game runs, only those pictures are painted, one warning per group', { skip }, async () => {
  const page = await env.newPage();
  const rules = [
    { match: /\/assets\/sprites\/fruit_apple_whole\.png$/, status: 404 },
    { match: /\/assets\/backgrounds\/bg_classic_far\.jpg$/, status: 404 },
    { match: /\/assets\/ui\/button_primary_default\.png$/, status: 404 },
  ];
  const seen = await intercept(page, rules);
  await page.goto(`${env.url}/?${REAL}&seed=7`);
  await page.evaluate('window.__ninja.ready');
  await until(page, "__ninja.getAssets().groups.core.state === 'partial'", 'core partial');
  const a = await page.evaluate('__ninja.getAssets()');
  assert.equal(a.groups.core.failed, 2, 'the sprite and the button');
  assert.equal(a.groups.core.loaded, CORE_TOTAL - 2);
  // play a classic round: its far layer is the missing one
  await page.evaluate("__ninja.start('classic', { seed: 7 })");
  await until(page, "__ninja.getAssets().groups['stage:classic'].state === 'partial'", 'classic stage partial');
  const st = await page.evaluate('__ninja.getAssets()');
  assert.equal(st.groups['stage:classic'].failed, 1);
  assert.deepEqual(st.stage.failed, ['classic'], 'a stage without its far layer is marked failed: the painted background is used');
  // the game plays: cut fruit, pause, results, and visit the screens that use the button
  const cuts = await page.evaluate(async () => {
    const n = window.__ninja;
    let cuts = 0;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const s = n.snapshot();
      const o = s.objects.filter((q) => q.kind === 'fruit' && q.y > 200 && q.y < 850 && q.x > 200 && q.x < 1720)[0];
      if (o) cuts += (await n.swingThrough(o.id, { angleDeg: 15 })).cutCount;
    }
    return cuts;
  });
  assert.ok(cuts >= 1, `the bot cut ${cuts} fruit`);
  assert.equal((await page.evaluate('__ninja.getPerf()')).degradeLevel, 0);
  for (const s of ['paused', 'results']) {
    await page.evaluate(s === 'paused' ? "__ninja.press('pause')" : "__ninja.debug.forceScreen('results', { roundMode: 'classic' })");
    await sleep(200);
    const stats = await page.evaluate(CANVAS_STATS);
    assert.ok(stats.colours > 12 && stats.sd > 8, `${s}: ${JSON.stringify(stats)}`);
  }
  await env.screenshot(page, 'missing-files-results');
  // the arcade round still gets its own stage
  await page.evaluate("__ninja.start('arcade', { seed: 7 })");
  await until(page, "__ninja.getAssets().stage.shown === 'arcade' && !__ninja.getAssets().stage.fading", 'the arcade stage still loads');
  assert.equal(seen.length >= 3, true, `the three files were requested: ${seen.map((s) => s.url)}`);
  const netLines = page.consoleErrors().filter((l) => /Failed to load resource/.test(l));
  assert.deepEqual(onlyBrowserNetworkLines(page.consoleErrors()), [], 'no error from the game itself');
  assert.ok(netLines.length <= 3, `the browser's own 404 lines: ${netLines.length}`);
  assert.deepEqual(page.exceptions, []);
  const warns = page.console.filter((c) => c.type === 'warning' && /^\[joycon-ninja\] asset group/.test(c.text));
  assert.equal(warns.length, 2, `one warning for core and one for stage:classic: ${JSON.stringify(warns.map((w) => w.text))}`);
  assert.ok(warns.some((w) => /"core"/.test(w.text)) && warns.some((w) => /"stage:classic"/.test(w.text)));
});

test('e2e art 6: a manifest that arrives late does not hold the game: it starts after the boot wait (2.5 s), the art comes in afterwards', { skip }, async () => {
  const page = await env.newPage();
  const seen = await intercept(page, [{ match: /\/assets\/manifest\.json$/, delayMs: 3300 }]);
  await page.goto(`${env.url}/?${REAL}&seed=8`);
  await page.evaluate('window.__ninja.ready');
  // measured from the moment the manifest was asked for (page load time on a busy machine is not the boot wait; the request can also reach the
  // browser's network stack a few hundred ms after the fetch call when the machine is loaded): the game starts about 2.5 s after the fetch, well
  // before the 3.3 s the manifest takes
  const readyAfter = Date.now() - seen[0].at;
  assert.ok(readyAfter >= 1700 && readyAfter < 3200, `ready ${readyAfter} ms after the manifest was requested: the boot wait is 2.5 s, not the 3.3 s the manifest took`);
  const early = await page.evaluate('({ screen: __ninja.getUiState().screen, manifest: __ninja.getAssets().manifest })');
  assert.equal(early.screen, 'menu', 'the game is playable');
  assert.equal(early.manifest, 'loading');
  // the thin loading bar is up along the bottom edge while the art is on its way (the sliding segment is drawn by the frames that follow)
  // (the segment slides across in 1.6 s and can be mostly off screen at one instant: take the best of a few readings)
  let best = 0;
  for (let i = 0; i < 6; i++) {
    await sleep(140);
    await page.evaluate('__ninja.debug.draw()');
    best = Math.max(best, await page.evaluate(BAR_PIXELS));
  }
  assert.ok(best > 50, `the loading bar is on screen (${best} px)`);
  await env.screenshot(page, 'late-manifest-bar');
  // input is not blocked: a round starts right away on the painted game
  await page.evaluate("__ninja.start('classic', { seed: 8 })");
  await until(page, "__ninja.getAssets().groups.core && __ninja.getAssets().groups.core.state === 'ready'", 'core ready after the manifest', 15000);
  await until(page, "__ninja.getAssets().stage.shown === 'classic' && !__ninja.getAssets().stage.fading", 'the classic stage after the art arrived', 15000);
  // on a screen with nothing red near the bottom edge (a falling cherry or apple could cross the row of a round)
  await page.evaluate("__ninja.debug.forceScreen('settings')");
  await sleep(200);
  await page.evaluate('__ninja.debug.draw()');
  assert.equal(await page.evaluate(BAR_PIXELS), 0, 'the bar is gone once core is loaded');
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
});

test('e2e art 7: the art is a skin: the same seeded rounds end in the same state with the art and with ?assets=0 (score, counters, fingerprint of the snapshot)', { skip }, async () => {
  const run = async (extra) => {
    const page = await env.openGame(`${MANUAL}&seed=9${extra}`);
    if (!extra) await until(page, "__ninja.getAssets().groups.core.state === 'ready'", 'core ready');
    const out = [];
    for (const mode of ['classic', 'arcade', 'zen']) {
      // real art frames are drawn between the game steps of the bot (the rAF loop paints under the manual clock too)
      const r = await page.evaluate(async (m) => {
        const r0 = await window.__helpers.botRound(m, { seed: 9, maxS: 40, stepMs: 40 });
        return { ...r0, fp: window.__helpers.fingerprint(window.__ninja.snapshot().game) };
      }, mode);
      out.push({ mode, stats: r.stats, score: r.score, lives: r.lives, t: Math.round(r.t * 1000), snapStats: r.snapStats, fp: r.fp });
    }
    assert.deepEqual(page.consoleErrors(), []);
    return out;
  };
  const withArt = await run('');
  const painted = await run('&assets=0');
  assert.ok(withArt.every((r) => r.score > 0), 'the bot scored in every mode');
  assert.deepEqual(withArt, painted);
});
