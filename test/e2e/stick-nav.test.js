// e2e (headless Chrome over CDP): the REAL game on the native Bluetooth bridge path against the REAL server and the FAKE helper process (test-support/bridge/fake-helper.mjs),
// walked with the controller's stick and buttons only: the fake helper writes a stick position and button bits into real 63-byte reports, which travel through the server,
// the browser, the real parser, the real report stream and the real UI. Menu -> settings -> back, edge-triggering, the sword that selects nothing by default.
// What this proves: the wiring in a real browser. What it CANNOT prove: the stick of the physical Joy-Con (centre, direction, travel, A and B): UNVERIFIED-ON-HARDWARE.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { startNativeE2e, playCalibration, sleep } from '../../test-support/e2e/native-harness.js';

const h = await startNativeE2e({ helper: { FAKE_HELPER_HELLO_MS: '200', FAKE_HELPER_WAIT_MS: '150', FAKE_HELPER_SCAN_MS: '400', FAKE_HELPER_STEP_MS: '100', FAKE_HELPER_STREAM_MS: '200' } });
const skip = h.skip;
after(() => h.close());

const focus = async (page) => (await h.view(page)).focus;
const hint = async (page) => (await h.view(page)).navHint;
const waitFocus = (page, id) => page.waitFor((want) => __ninja.debug.getUiView().focus.id === want, { timeoutMs: 6000, pollMs: 30, message: `focus on ${id}` }, id);
const waitScreenNow = (page, screen) => h.waitScreen(page, screen, 8000);

test('e2e stick 1: connect, calibrate, then menu -> settings -> back with the stick, A and B; the sword selects nothing; "Sword selection in menus" On brings it back', { skip, timeout: 240000 }, async () => {
  const page = await h.openNative();
  await h.waitConnect(page, 'c.native === true && c.buttonEnabled', 15000, 'the native layout');
  await h.click(page, 'connect.main');
  await h.waitConnect(page, "c.mode === 'connected'", 40000, 'Connected');
  await playCalibration(h, page);
  await h.waitScreen(page, 'menu', 20000);
  await page.mouse.move(10, 1070); // the mouse pointer that clicked "Connect" must not rest on a mode fruit
  await sleep(500);

  // the menu: focus on Arcade with a ring, the hint line for the Right unit
  let f = await focus(page);
  assert.equal(f.id, 'menu.arcade');
  assert.equal(f.visible, true);
  assert.equal((await hint(page)).text, 'Stick: move   A: select');
  await h.screenshot(page, 'stick-1-menu');

  // down, left: "Settings"; a long push is ONE move (hold the stick for 700 ms, far longer than a flick)
  await h.sword.flick('down', 700);
  await waitFocus(page, 'menu.recalibrate');
  await sleep(900); // the push is still held for about 600 ms: it must not move again, and the stick must be back at rest before the next flick
  assert.equal((await focus(page)).id, 'menu.recalibrate', 'a long push moved once');
  await h.sword.flick('left');
  await waitFocus(page, 'menu.settings');
  await sleep(350); // the stick is back at rest
  await h.sword.button('A', 200);
  await waitScreenNow(page, 'settings');
  assert.equal((await focus(page)).id, 'set.back');
  assert.equal((await hint(page)).text, 'Stick: move   A: select   R: other column   B: back');
  await sleep(300);
  await h.screenshot(page, 'stick-2-settings');

  // up to a value row and change it: "Sword selection in menus" is the row above the buttons
  await h.sword.flick('left');
  await waitFocus(page, 'set.tune');
  await sleep(350);
  await h.sword.flick('left');
  await waitFocus(page, 'set.reset');
  await sleep(350);
  await h.sword.flick('up');
  await waitFocus(page, 'row:swordSelect');
  await sleep(350);
  assert.equal(await page.evaluate("__ninja.getSettings().swordSelect"), false, 'Off by default');
  assert.equal((await hint(page)).text, 'Stick: up and down to move, left and right to change   R: other column   B: back');
  await h.sword.flick('left'); // the "On" cell is on the left
  await page.waitFor(() => __ninja.getSettings().swordSelect === true, { timeoutMs: 6000, pollMs: 30, message: 'swordSelect On' });
  await sleep(350);
  await h.sword.flick('right');
  await page.waitFor(() => __ninja.getSettings().swordSelect === false, { timeoutMs: 6000, pollMs: 30, message: 'swordSelect Off again' });
  await h.screenshot(page, 'stick-3-sword-row');

  // B goes back to the menu, B on the root menu does nothing
  await sleep(300);
  await h.sword.button('B', 200);
  await waitScreenNow(page, 'menu');
  await sleep(400);
  await h.sword.button('B', 200);
  await sleep(500);
  assert.equal((await h.ui(page)).screen, 'menu', 'B on the root menu does nothing');

  // the sword cursor on a mode for four seconds starts nothing (a real Joy-Con, setting Off)
  await page.evaluate('__ninja.reanchor(960, 520)');
  await sleep(4000);
  assert.equal((await h.ui(page)).screen, 'menu');
  assert.equal((await h.view(page)).hover, null, 'inert: no hover');

  assert.deepEqual(page.consoleErrors(), []);
  assert.deepEqual(page.exceptions, []);
  assert.deepEqual(page.failedRequests, []);
  await page.close();
});
