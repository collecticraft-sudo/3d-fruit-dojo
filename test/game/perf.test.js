import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../public/js/game/index.js';
import { createRng } from '../../public/js/shared/rng.js';
import { perfectBot, makeSegment } from '../../test-support/game/helpers.js';

// Informational performance smoke (architecture 7.8): 60 simulated seconds of the worst case, Classic stage 8, with
// 10 segments per frame. The threshold (2 s of CPU for 60 s of game time) is deliberately loose; the real cost is
// printed as a diagnostic. This measures the Game only (not the bot, not the harness).
test('PERF SMOKE: 60 simulated seconds of Classic S8 with 10 segments per frame run in well under real time', (t) => {
  const game = createGame('classic', 8080);
  const fake = { snapshot: () => game.snapshot() };
  const bot = perfectBot(fake);
  const rng = createRng(1);
  let now = 0;
  const frame = 1 / 60;
  // warm up to stage 8 (240 s) with the bot, untimed
  while (game.snapshot().t < 245 && !game.isOver()) {
    now += frame * 1000;
    game.update(frame, bot(now), now);
    game.drainEvents();
  }
  assert.equal(game.isOver(), false);
  assert.equal(game.snapshot().stage, 8);
  let cpuNs = 0n;
  let frames = 0;
  const T1 = game.snapshot().t + 60;
  while (game.snapshot().t < T1 && !game.isOver()) {
    now += frame * 1000;
    const segs = bot(now);
    for (let i = 0; i < 10; i++) {
      const y = rng.range(0, 1080);
      segs.push(makeSegment(-400, y, -300, y, now, { swingId: 90000 + frames * 10 + i })); // off-screen: pure iteration cost
    }
    const t0 = process.hrtime.bigint();
    game.update(frame, segs, now);
    game.drainEvents();
    game.snapshot(); // the renderer takes one snapshot per frame
    cpuNs += process.hrtime.bigint() - t0;
    frames++;
  }
  const ms = Number(cpuNs) / 1e6;
  t.diagnostic(`Classic S8: ${frames} frames, ${ms.toFixed(1)} ms CPU for 60 s of game time (${((ms * 1000) / frames).toFixed(1)} us per frame incl. snapshot)`);
  assert.ok(game.snapshot().stage === 8);
  assert.ok(ms < 2000, `${ms} ms of CPU for 60 simulated seconds`);
  assert.ok((ms * 1000) / frames < 2000, 'less than 2 ms per frame on average (the frame budget is 16.7 ms)');
});
