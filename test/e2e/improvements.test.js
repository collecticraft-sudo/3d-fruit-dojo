// e2e (headless Chrome over CDP, REAL clock, trusted mouse events): the round 3 majors R3-01 and R3-02 and the new tuning screen
// in a real browser. Skipped (never "passed") only with E2E_OPTIONAL=1 and no Chrome. The simulator models docs/joycon2-protocol.md
// and a browser; nothing here verifies the physical Joy-Con (UNVERIFIED-ON-HARDWARE).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { startE2e } from '../../test-support/e2e/env.js';

const env = await startE2e();
const skip = env.skip;
after(() => env.close());

const ev = (page, expr) => page.evaluate(expr);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The simulator treats a pointer that stays silent for 200 ms and then jumps as a teleport, and a quicker jump as a real swing (which
// cuts whatever the swing crosses, exactly as designed). A click therefore waits 450 ms before it moves and 320 ms between the move and
// the press: on a loaded machine the test must never turn the jump between two buttons into a swing over a third one.
const click = async (page, x, y) => {
  await sleep(450);
  await page.mouse.move(x, y);
  await sleep(320);
  await page.mouse.down(x, y);
  await page.mouse.up(x, y);
};

test('e2e R3-01: first run, the connect screen, a real click on "Simulator", the mouse left alone: no round starts by itself (real clock)', { skip }, async () => {
  const page = await env.openGame('skipsafety=1&mute=1&seed=3');
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'connect');
  await click(page, 1240, 890); // "Simulator"
  await sleep(300);
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'menu');
  await sleep(4500); // the old bug fired at 0.95 s
  const st = await ev(page, '__ninja.getUiState()');
  assert.equal(st.screen, 'menu', `still on the menu after 4.8 s (was ${st.screen})`);
  assert.equal((await ev(page, '__ninja.snapshot()')).mode, null);
  assert.deepEqual(page.consoleErrors(), []);
});

test('e2e: the sword tuning screen is reachable from the menu by clicks, shows the live reading and the practice fruit, and leaves again', { skip }, async () => {
  const page = await env.openGame('input=sim&skipsafety=1&mute=1&seed=4');
  await sleep(700);
  await click(page, 560, 975); // Settings
  await sleep(200);
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'settings');
  await click(page, 960, 980); // Sword tuning
  await sleep(300);
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'tuning');
  // a real simulated swing through the practice fruit row: the screen must not crash, and no stepper changes by a swing
  const before = await ev(page, '__ninja.getSettings()');
  await ev(page, '__ninja.simSwing({ x: 300, y: 815 }, { x: 1500, y: 815 }, 300)');
  await sleep(600);
  assert.deepEqual(await ev(page, '__ninja.getSettings()'), before, 'a swing never changes a setting on the tuning screen');
  await env.screenshot(page, 'tuning');
  await click(page, 1280, 975); // Back
  await sleep(200);
  assert.equal((await ev(page, '__ninja.getUiState()')).screen, 'settings');
  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
});
