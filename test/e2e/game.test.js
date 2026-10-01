// e2e (headless Chrome over CDP): boot, offline proof, rounds and modes, determinism, keyboard, storage failure, visual smoke.
// Skipped (never "passed") when Chrome is missing. The simulator and Chrome model docs/joycon2-protocol.md and a browser;
// nothing here verifies the physical Joy-Con (UNVERIFIED-ON-HARDWARE).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2e } from '../../test-support/e2e/env.js';

const env = await startE2e();
const skip = env.skip;
after(() => env.close());

const Q = 'input=sim&clock=manual&skipsafety=1&mute=1';
const ev = (page, expr) => page.evaluate(expr);

test('e2e 1: boot reaches the menu, no console errors, no failed requests, every request is localhost (offline proof)', { skip }, async (t) => {
  const page = await env.openGame(`${Q}&seed=1&debug=1`);
  const s = await ev(page, '__ninja.snapshot()');
  assert.equal(s.screen, 'menu');
  assert.deepEqual({ kind: s.provider.kind, state: s.provider.state }, { kind: 'sim', state: 'streaming' });
  assert.equal(await ev(page, 'document.title'), '3D Fruit Dojo');
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
  assert.deepEqual(page.failedRequests, []);
  assert.deepEqual(page.badResponses, []);
  const origin = new URL(env.url).origin;
  const foreign = page.requests.filter((r) => !r.url.startsWith(origin) && !r.url.startsWith('data:') && r.url !== 'about:blank');
  assert.deepEqual(foreign, [], 'nothing is fetched from outside localhost');
  assert.ok(page.requests.filter((r) => r.url.endsWith('.js')).length > 60, 'the ES module graph was loaded over HTTP');
  t.diagnostic(`Chrome ${env.chrome}: ${page.requests.length} requests, all ${origin}`);
});

test('e2e 1c: the Content-Security-Policy makes the browser refuse any external fetch and any inline script', { skip }, async () => {
  const page = await env.openGame(`${Q}&seed=1`);
  const r = await page.evaluate(async () => {
    const ext = await fetch('https://example.com/').then(() => 'allowed', () => 'blocked');
    let inline = 'allowed';
    window.__inlineRan = false;
    const el = document.createElement('script');
    el.textContent = 'window.__inlineRan = true';
    document.head.append(el);
    await new Promise((res) => setTimeout(res, 50));
    if (!window.__inlineRan) inline = 'blocked';
    return { ext, inline };
  });
  assert.deepEqual(r, { ext: 'blocked', inline: 'blocked' });
  assert.ok(page.console.some((c) => /Content Security Policy/i.test(c.text)), 'Chrome reported the violations');
});

test('e2e 1b: the canvas really draws (menu, then a round): many distinct colours, not a blank or single-colour frame', { skip }, async () => {
  const page = await env.openGame(`${Q}&seed=1`);
  await ev(page, '__ninja.debug.draw()');
  const menu = await ev(page, '__helpers.canvasColours()');
  assert.ok(menu > 20, `menu shows ${menu} colours`);
  await env.screenshot(page, 'menu');
  await ev(page, "__ninja.start('classic', {seed: 1}); __ninja.advance(1500); __ninja.debug.draw();");
  const play = await ev(page, '__helpers.canvasColours()');
  assert.ok(play > 20, `round shows ${play} colours`);
  await env.screenshot(page, 'playing');
});

test('e2e 2: round basics: first wave at 0.8 s, snapshots pass the contract validators', { skip }, async () => {
  const page = await env.openGame(`${Q}&debug=1`);
  const r = await page.evaluate(async () => {
    const { assertValid } = await import('/js/shared/validate.js');
    __ninja.start('classic', { seed: 1 });
    const out = { waveAt: null, maxObjects: 0, bad: [] };
    for (let i = 0; i < 100; i++) {
      __ninja.advance(50);
      const s = __ninja.snapshot();
      try { assertValid('GameSnapshot', s.game); } catch (e) { out.bad.push(e.message); }
      if (out.waveAt === null && s.waveIndex >= 0) out.waveAt = s.t;
      out.maxObjects = Math.max(out.maxObjects, s.objects.length);
    }
    return out;
  });
  assert.deepEqual(r.bad, []);
  assert.ok(r.waveAt >= 0.75 && r.waveAt <= 0.95, `first wave at ${r.waveAt}`);
  assert.ok(r.maxObjects >= 2);
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e 3: threshold: 900 px/s does not cut, 1100 px/s does', { skip }, async () => {
  const page = await env.openGame(Q);
  const r = await page.evaluate(async () => {
    const spawn = () => __ninja.debug.spawn({ kind: 'fruit', type: 'watermelon', apexX: 960, apexY: 540, atApex: true });
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    const slow = await __ninja.swingThrough(spawn(), { speed: 900, length: 600 });
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    const fast = await __ninja.swingThrough(spawn(), { speed: 1100, length: 600 });
    return { slow: slow.cutCount, slowMax: slow.maxSpeed, fast: fast.cutCount, fastMin: fast.minSpeed };
  });
  assert.equal(r.slow, 0);
  assert.ok(r.slowMax < 1000);
  assert.equal(r.fast, 1);
  assert.ok(r.fastMin > 1000);
});

test('e2e 4: bomb: slow contact does not explode, a fast crossing does, the near miss triggers once', { skip }, async () => {
  const page = await env.openGame(Q);
  const r = await page.evaluate(async () => {
    const bomb = () => __ninja.debug.spawn({ kind: 'bomb', apexX: 960, apexY: 540, atApex: true });
    const count = (res, type) => res.events.filter((e) => e.type === type).length;
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    const slow = await __ninja.swingThrough(bomb(), { speed: 800, length: 600 });
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    bomb();
    const fast = await __ninja.swing({ x: 660, y: 540 }, { x: 1260, y: 540 }, 100);
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    bomb();
    const near1 = await __ninja.swing({ x: 660, y: 450 }, { x: 1260, y: 450 }, 100);
    const near2 = await __ninja.swing({ x: 660, y: 450 }, { x: 1260, y: 450 }, 100);
    return { slowBombs: count(slow, 'bomb'), fastBombs: count(fast, 'bomb'), near1: count(near1, 'nearMiss'), near1Bombs: count(near1, 'bomb'), near2: count(near2, 'nearMiss') };
  });
  assert.deepEqual(r, { slowBombs: 0, fastBombs: 1, near1: 1, near1Bombs: 0, near2: 0 });
});

test('e2e 5: combo: three fruit on a line and one swing award a combo of 3 (+30)', { skip }, async () => {
  const page = await env.openGame(Q);
  const r = await page.evaluate(async () => {
    __ninja.start('classic', { seed: 1, wavesEnabled: false });
    for (const [x, type] of [[700, 'apple'], [960, 'orange'], [1220, 'pear']]) __ninja.debug.spawn({ kind: 'fruit', type, apexX: x, apexY: 540, atApex: true });
    const res = await __ninja.swing({ x: 400, y: 540 }, { x: 1500, y: 540 }, 110);
    const close = res.events.find((e) => e.type === 'combo' && e.phase === 'close');
    return { cuts: res.cutCount, n: close && close.n, bonus: close && close.bonus };
  });
  assert.deepEqual(r, { cuts: 3, n: 3, bonus: 30 });
});

test('e2e 6: determinism: two page loads with the same seed and scripted swings give identical snapshot hash sequences over 20 s', { skip }, async () => {
  const play = async (seed) => {
    const page = await env.openGame(`${Q}&seed=${seed}`);
    const prints = await page.evaluate(async () => {
      __ninja.start('classic');
      const out = [];
      for (let i = 0; i < 400; i++) {
        __ninja.advance(50);
        const s = __ninja.snapshot();
        out.push(__helpers.fingerprint(s.game));
        if (i % 6 === 0) {
          const o = s.objects.find((q) => q.kind === 'fruit' && q.y > 250 && q.y < 850);
          if (o) await __ninja.swingThrough(o.id, { angleDeg: 20 });
        }
      }
      return out;
    });
    await page.close();
    return prints;
  };
  const a = await play(5);
  const b = await play(5);
  const c = await play(6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(new Set(a).size > 150);
});

test('e2e 12: keyboard and safety: the safety screen is locked for 2 s, Enter confirms, Escape pauses in play, P too', { skip }, async () => {
  const page = await env.openGame('input=sim&clock=manual&mute=1');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'safety');
  await page.key('Enter');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'safety', 'locked');
  await ev(page, '__ninja.advance(2100)');
  await page.key('Enter');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'menu');
  await ev(page, "__ninja.start('classic', {seed: 1}); __ninja.advance(800)");
  await page.key('Escape');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'paused');
  await page.key('Enter'); // Resume
  await ev(page, '__ninja.advance(2300)');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'playing');
  await page.key('p', 'KeyP');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'paused');
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e 13: Arcade: a bot plays the 60 s round to the results screen with a timer end; bombs cost 5 s', { skip }, async () => {
  const page = await env.openGame(Q);
  const r = await page.evaluate(() => __helpers.botRound('arcade', { seed: 7, maxS: 90 }));
  assert.equal(r.screen, 'results');
  assert.equal(r.endReason, 'timer');
  assert.ok(r.t >= 59 && r.t < 90, `duration ${r.t}`);
  assert.ok(r.score > 1500, `score ${r.score}`);
  const pen = await page.evaluate(async () => {
    __ninja.start('arcade', { seed: 1, wavesEnabled: false });
    __ninja.advance(1000);
    const before = __ninja.snapshot().timeLeft;
    __ninja.debug.spawn({ kind: 'bomb', apexX: 960, apexY: 540, atApex: true });
    const res = await __ninja.swing({ x: 660, y: 540 }, { x: 1260, y: 540 }, 100);
    const bomb = res.events.find((e) => e.type === 'bomb');
    return { before, after: __ninja.snapshot().timeLeft, timeDeltaS: bomb && bomb.timeDeltaS };
  });
  assert.equal(pen.timeDeltaS, -5);
  assert.ok(pen.after < pen.before - 4.5);
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e 13: Zen: 90 s with no bomb; Classic: three missed lives end the round, the results screen locks input for 1.2 s', { skip }, async () => {
  const page = await env.openGame(Q);
  const z = await page.evaluate(() => __helpers.botRound('zen', { seed: 11, maxS: 130 }));
  assert.equal(z.screen, 'results');
  assert.equal(z.endReason, 'timer');
  assert.equal(z.stats.bombsSeen, 0);
  assert.ok(z.t >= 89);
  const c = await page.evaluate(async () => {
    __ninja.start('classic', { seed: 9 });
    let g = 0;
    while (__ninja.snapshot().screen !== 'results' && g++ < 4000) __ninja.advance(50);
    const s = __ninja.snapshot();
    __ninja.press('confirm');
    const locked = __ninja.getUiState().screen;
    __ninja.advance(1800);
    __ninja.press('confirm');
    return { lives: s.lives, endReason: s.endReason, phase: s.phase, locked, after: __ninja.getUiState() };
  });
  assert.equal(c.lives, 0);
  assert.equal(c.endReason, 'lives');
  assert.equal(c.locked, 'results');
  assert.equal(c.after.screen, 'countdown');
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e 10: storage failure: with every Storage call throwing the game boots, plays and records the score in memory', { skip }, async () => {
  const init = `
    for (const m of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[m] = function () { throw new Error('storage blocked'); };
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('storage blocked'); } });
  `;
  const page = await env.openGame(Q, { init: [init] });
  const r = await page.evaluate(() => __helpers.botRound('arcade', { seed: 3, maxS: 90 }));
  assert.equal(r.screen, 'results');
  assert.ok(r.score > 0);
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
  // settings still work (in memory)
  const s = await page.evaluate(() => __ninja.setSetting('sensitivity', 1.5));
  assert.equal(s.sensitivity, 1.5);
});

test('e2e: a real-clock session runs on requestAnimationFrame: the simulator streams, frames tick, the menu can be left with a click', { skip }, async () => {
  const page = await env.openGame('input=sim&skipsafety=1&mute=1&seed=2');
  await new Promise((r) => setTimeout(r, 1200));
  const before = await ev(page, '__ninja.now()');
  await new Promise((r) => setTimeout(r, 500));
  const after = await ev(page, '__ninja.now()');
  assert.ok(after - before > 400 && after - before < 700, `the real clock ran ${after - before} ms in 500 ms`);
  const m = await ev(page, '__ninja.getMotionState()');
  assert.ok(m.sampleRateHz > 40, `sample rate ${m.sampleRateHz}`);
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'menu', 'the boot cursor on the centre fruit does not select it by itself');
  await page.mouse.move(480, 300);
  await new Promise((r) => setTimeout(r, 150));
  await page.mouse.down(480, 540);
  await page.mouse.up(480, 540);
  await new Promise((r) => setTimeout(r, 300));
  const st = await ev(page, '__ninja.getUiState()');
  assert.equal(st.screen, 'countdown');
  assert.equal(st.roundMode, 'classic');
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e audio: without ?mute the sound engine unlocks on the first click, plays a real-time round of effects and never errors', { skip }, async () => {
  const page = await env.openGame('input=sim&skipsafety=1&seed=5');
  assert.equal((await ev(page, '__ninja.debug.getAudio()')).ready, false, 'silent until the first user gesture (browser autoplay rule)');
  await page.mouse.move(900, 200);
  await page.mouse.down(900, 200); // a click on no target: only the unlock matters
  await page.mouse.up(900, 200);
  await page.waitFor('__ninja.debug.getAudio().ready === true', { timeoutMs: 3000, message: 'the audio engine to unlock' });
  await ev(page, "__ninja.start('classic', { seed: 5 })");
  // real time: cut whatever is reachable for 8 s
  const r = await page.evaluate(async () => {
    const t0 = performance.now();
    let cuts = 0;
    let maxVoices = 0;
    while (performance.now() - t0 < 8000) {
      await new Promise((res) => setTimeout(res, 300));
      const s = __ninja.snapshot();
      maxVoices = Math.max(maxVoices, __ninja.debug.getAudio().voiceCount ?? 0);
      const o = s.objects.find((q) => q.kind === 'fruit' && q.y > 250 && q.y < 850 && q.x > 250 && q.x < 1650);
      if (o) cuts += (await __ninja.swingThrough(o.id, { angleDeg: 15 })).cutCount;
    }
    return { cuts, maxVoices, audio: __ninja.debug.getAudio() };
  });
  assert.ok(r.cuts >= 2, `cuts ${r.cuts}`);
  assert.equal(r.audio.ready, true);
  assert.equal(r.audio.stats.errors, 0);
  assert.ok(r.audio.stats.played >= r.cuts, `sounds played ${r.audio.stats.played} for ${r.cuts} cuts`);
  assert.ok(r.maxVoices <= 24, 'the voice limit holds');
  assert.deepEqual(page.consoleErrors(), []);
});
