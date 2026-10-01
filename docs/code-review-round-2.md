# Code review, round 2 (white-box)

Reviewer role: senior code reviewer. Date: 2026-09-30. Language: English (owner request).
Scope: everything under `public/`, `server.js`, `start.command`, `test/` and `test-support/`. There is no `bridge/` folder (plan B is not built, as documented).
Nothing in the project was changed by this review. Mutated copies and reproduction scripts ran in a scratch folder outside the project; the important reproductions are quoted inline below so that anybody can repeat them with `test-support/`.

> **Hardware honesty.** Nobody on the team, including this reviewer, touched a physical Joy-Con 2. Every statement below that depends on the real controller, on Chrome talking to it, or on macOS behaviour is marked **UNVERIFIED-ON-HARDWARE**. The three major findings are defects of the *code* (they reproduce on the synthetic sensor); what the real device does to trigger them is UNVERIFIED-ON-HARDWARE.

## 1. Verdict

**No critical defect found**: nothing that, from the code and from the runs below, will certainly stop the game or the connection from working. All five round-1 majors (M1 to M5) are fixed and the fixes hold under mutation (section 4). This round found **3 new major** items and **12 minor** items; 11 round-1 minors are still open (section 4).

| Severity | Count | IDs |
|---|---|---|
| critical | 0 | none |
| major | 3 | M1 to M3 |
| minor | 12 new, 11 carried over | n1 to n12; carried-over ids keep their round-1 names (m1 to m11) |

The pure modules held up again under hostile input: 120 fuzzed game rounds and 60 fuzzed motion pipelines (section 3) produced no exception, no NaN, no out-of-field blade position and no unbounded collection.

## 2. What I ran

| Check | Result |
|---|---|
| `npm test` (unit, integration and headless-Chrome e2e together) | 893 tests, 893 pass, 0 fail, 0 skipped, about 22 s. |
| `npm run test:unit` three more times | 853 pass, 0 fail each time, about 7 s. No hang, no orphan process left by the launcher tests. |
| `npm run test:e2e` alone | 40 pass. Perf smoke (headless Chrome, 1920x1080, simulator): 60.0 fps, p99 frame interval 16.8 ms, no long tasks, input to draw about 10 ms. Software only, headless, not the owner's MacBook (UNVERIFIED-ON-HARDWARE, HW-1). |
| e2e with Chrome missing (scratch copy whose `findChrome()` returns null) | exit code 0, `tests 40, pass 0, skipped 40`. See n1. |
| Mutation check, 15 one-line mutations against the relevant test folders (scratch copy) | 9 killed, 6 survived. Killed: both halves of the M1 fix, the M4 disconnect, the M5 mask option, the reconnect re-centre, the idempotent `close()`, the tracker path-length bookkeeping, the hit order, the mercy window. Survived: the three round-1 m7 mutants (still untested, section 4) and three new ones (n2; the `markDiscontinuity('lost')` call in `app.js` is probably redundant with the pipeline's own gap detection). |
| Game fuzz (120 rounds: 3 modes x 40 seeds, random frame times including 0 and up to 3 s, random segments with NaN, out-of-field points and speed 0, both hands, lethal bombs, reduced motion) | 120 of 120 rounds ended, no exception, no non-finite number in any snapshot, at most 6 objects, 34 halves, 10 events per frame. |
| Motion fuzz (60 pipelines, 240 000 calls: hostile IMU samples with NaN, 1e9 rates, zero accelerometer, backwards time, gaps up to 5 s, null and negative dt, interleaved `startCalibration`, `cancelCalibration`, `beginQuickRecenter`, `recenter`, `markDiscontinuity`, `reanchor`, `confirmCenter`, `setCalibration`, `setSettings`, `pushAim`, `poll`) | 77 784 blade samples, no exception, all finite and inside the 1920x1080 field, orientation quaternion always finite. |
| BLE transport | Read line by line (`ble-transport.js`, `ble-provider.js`, `status.js`, `timers.js`, `report-stream.js`). Every promise returned by the transport has a handler; the generation counter guards every late continuation; the only defect is the carried-over m4, which I reproduced (section 4). |
| Server | Re-read; `..`, encoded traversal, NUL, backslash, absolute-form and `//host` targets, dot files, directory listing, symlink escape, Host allow-list and loopback binding all still hold. No change since round 1. |
| Determinism | `grep` for `Math.random`, `Date.now`, `new Date`, `performance.now` under `public/js`: game logic uses none. `Date.now()` only stamps `Calibration.createdAt`, the storage record date and the diagnostics report; `Math.random` only fills the audio noise buffer (cosmetic). `randomSeed()` in `app.js` uses `crypto` only when no seed was given. |

## 3. Major findings

### M1. The calibration wizard silently throws away the gyro sign and scale when two samples in the transition have an unknown time step

- **Where:** `public/js/motion/calibration.js` `TransitionIntegrator.add` (lines 164-166: `gapMs += 200` for every sample whose `dtMs` is null) and `estimateGyroModel` (line 205: `snapshot.gapMs > 300` gives "gyro sign undetermined" and the defaults sign +1, scale 1). `public/js/motion/pipeline.js` line 427 turns every non-positive `dtMs` into null before it reaches the wizard. `public/js/input/report-stream.js` line 190 counts a duplicate timestamp (`dUs === 0`) as `stats.duplicates` and gives it `dtMs = null`, so the case is anticipated by the stream, not hypothetical.
- **What happens:** the wizard integrates the rotation between the two still poses to learn whether the gyro is mirrored (sign) and whether the scale is the default or the disputed 0.12288. A sample whose dt is null is charged as a 200 ms hole, although a duplicate report or a burst partner loses no rotation at all. Two such samples in the roughly 1.2 s of the move exceed the 300 ms budget and the whole sign and scale estimation is discarded. The wizard still passes, the result carries only the string `gyro sign undetermined` in `quality.warnings`, and nothing shows it to the player (`ui.js` `onCalibration` ignores `done.warnings`; no string exists for it). The only in-game remedy is "Flip left and right", which flips left/right only, while a mirrored gyro inverts both axes and a wrong scale makes the blade about 8 times too fast or too slow.
- **Reproduction (repeatable with the app harness):**
  ```js
  const h = await makeApp('?input=sim&clock=manual&skipsafety=1&mute=1&seed=1');   // or ...&simgyro=alt / &simmirror=1
  const m = h.app.motion, orig = m.pushImu; let n = 0;
  m.pushImu = (s) => orig(++n % 10 === 0 ? { ...s, dtMs: null } : s);              // one report in ten has an unknown step
  h.run(300); m.startCalibration({ side: 'R' }); h.n.sim.playCalibrationScript(); h.run(11000);
  h.n.getCalibration();
  ```
  Measured: clean stream gives `sign=1 scale=1 estimated` (default), `sign=1 scale=0.12288 estimated` (`simgyro=alt`), `sign=-1 estimated` (`simmirror=1`). With one report in ten (and also one in two) unknown, all three give `sign=1 scale=1 source=default warnings=["gyro sign undetermined"]`: the mirrored and the 8x-scale simulator are calibrated wrongly and silently.
- **Impact:** if the real Joy-Con 2 ever sends reports with an unchanged IMU timestamp, backwards timestamps, or has two BLE stalls of 200 ms or more inside the 1.2 s move, the automatic sign and scale detection, which is what makes the game mount-agnostic, does not run. Whether the device does that is UNVERIFIED-ON-HARDWARE (UOH-4, UOH-8); the code cannot tell a duplicate from a hole.
- **Fix (small):** pass the wall-clock distance `t - lastImuT` to `TransitionIntegrator.add` and charge `gapMs` only when that distance is above about 40 ms (or when `s.dtMs >= maxGapMs`), ignore `dtMs === 0` completely. Then show the calibration warning to the player: a "sign undetermined, repeat the turn" message and a retry, instead of a silent default. Add a unit test that repeats the script above with 1 in 10 and 1 in 2 unknown steps and asserts that mirror and alt scale are still found.

### M2. The wizard needs the accelerometer to read 1.00 g within 5 percent; there is no learned normalisation, so a modest gain error makes calibration impossible

- **Where:** `public/js/motion/motion-config.js` `calibration.stillAccelTolerance: 0.05`, used by `StillHold.add` in `calibration.js` line 104; the same absolute 1 g appears in `gyroBias.restBandG: 0.03` (online bias), `fusion.trustBandG 0.15` and `flatBandG 0.05` (gravity correction).
- **What happens:** a hold counts only when `| |a| - 1 | <= 0.05`. If the sensor's gain or offset makes the resting magnitude 1.06 g or 0.94 g, no hold can ever form: step 1 reports `bad_accel` for as long as the player tries. The online bias estimator already stops working above about 1.03 g. Nothing learns the actual 1 g magnitude from the step 1 hold, although the hold already averages a few hundred samples.
- **Reproduction:**
  ```js
  const m = h.app.motion, orig = m.pushImu;          // sim, manual clock, as above
  m.pushImu = (s) => orig({ ...s, accel: { x: s.accel.x * G, y: s.accel.y * G, z: s.accel.z * G } });
  m.startCalibration({ side: 'R' }); h.n.sim.playCalibrationScript(); h.run(14000);
  ```
  G = 1.00 and 1.03: steps 1, 2, 3 pass and `done` is emitted. G = 1.06 and G = 0.94: `stepFailed1:bad_accel` and no step ever passes. (`getCalibration()` still returns a calibration in the simulator because the nominal one is installed at connect; that is a property of the simulator, not of a real Joy-Con.)
- **Status of the underlying behaviour on the real device:** the 1/4096 g per unit scale is documented with high confidence, but the actual gain and offset of a Joy-Con 2 accelerometer without its factory calibration record is unknown: UNVERIFIED-ON-HARDWARE (UOH-3 and the diagnostics rest check, which only asserts 1.00 +/- 0.03 g). A calibration that cannot start leaves only the mouse.
- **Fix (small):** in step 1, take `g0 = |mean accel|` of the hold, accept it when it lies within 0.85 to 1.15 (warn when it is outside 0.95 to 1.05), keep `g0` in the calibration and divide every accelerometer reading by it on entry in `pushImu` (the same place that negates it for `accelSign`). Make the diagnostics rest check show `g0` and the suggested correction.

### M3. Values saved by the diagnostics page leak into the simulator when it is chosen from the connect screen (mirrored cursor, wrong wizard scale)

- **Where:** `public/js/app.js` lines 98-115 and 103-107. `pickAccelSign()` and `gyroScaleOverride` are decided **once**, in `createApp`, from `flags.input`. They read `localStorage['joyconNinja.imu.v1']` unless the URL says `?input=sim`. But the player can pick the simulator later, with the **Simulator** button of the connect screen (`connect.sim` intent), which the README advertises as the first thing to try; then `flags.input` is `null` and the saved values apply to the simulator. The existing test (`test/app/ble-app.test.js` line 308) only covers `?input=sim`.
- **What happens:** with `accelSign: -1` saved (the diagnostics page offers it for a sensor that reports gravity instead of specific force), every accelerometer sample of the simulator is negated on entry, although the simulator models the other convention. With a saved `gyroScale` (for example 0.12288) the simulator's **Recalibrate** wizard uses it as `scaleOverride` (`source: stored`) and only warns `gyro_scale_suspect`.
- **Reproduction (measured):**
  ```js
  const ls = (rec) => ({ getItem: () => JSON.stringify(rec), setItem() {}, removeItem() {} });
  const h = await makeApp('?clock=manual&skipsafety=1&mute=1&seed=1', { localStorage: ls({ accelSign: -1 }) });
  h.n.debug.forceScreen('connect'); h.app.presentation.ui.activate('connect.sim'); h.run(500);
  h.n.sim.setTarget(960, 540, { teleport: true }); h.run(700);
  h.n.sim.setTarget(1400, 200, { glideMs: 600 }); h.run(1300); h.n.snapshot().blade;
  ```
  Mouse target (1400, 540) gives cursor (523, 543); (1400, 200) gives (526, 880); (500, 200) gives (1417, 884); (500, 900) gives (1421, 185): both axes mirrored. The same targets with `?input=sim` land within 6 px. With a saved `gyroScale: 0.12288` and the wizard started from the simulator, the result is `gyroScale=0.12288 source=stored warnings=["gyro_scale_suspect"]` while the truth is 1.
- **Impact:** an owner who ran the diagnostics page on the real Joy-Con and saved a value gets a broken simulator on the "try it first" path, and nothing says why. It also makes any QA run that starts from the connect screen depend on browser storage.
- **Fix:** apply the choice per provider in `useProvider`: for `sim` and `mouse` use `accelSign: 1` and no scale override (give the pipeline `setAccelSign()` and `setGyroScaleOverride()`, or recreate the pipeline with `motion.reset()` on a provider change). Add the test for the connect-screen route.

## 4. Status of the round-1 findings

| ID | Round-1 finding | Status now | Evidence |
|---|---|---|---|
| M1 | Orientation not re-initialised after a long link gap | **Fixed** | `pipeline.js` `_restartOrientation` (gap over 1 s and `markDiscontinuity('lost')`); removing either call fails a test (mutation). |
| M2 | No wake lock | **Fixed** | `wake-lock.js`, wired in `app.js` line 121; `start.command` runs `caffeinate -di -w $$`. Chrome honouring the lock and the Mac's idle timings: UNVERIFIED-ON-HARDWARE. |
| M3 | Orphaned `sleep` and hanging `npm test` | **Fixed** | `cleanup` kills by job table; every test script has `--test-timeout=120000`; three full unit runs and one e2e run left no process behind. |
| M4 | Diagnostics link while the game holds the link | **Fixed** | `openDiagnostics` disconnects first (mutation killed); the diagnostics page disconnects before opening the game. |
| M5 | No scan or mask fallback inside the game | **Fixed** | `?filter`, `?mask`, `?side` in `flags.js`, passed by `app.js` (mutation killed). |
| M6 | Default mask 0x37 least evidenced | **Fixed** | default is now 0xB7, fallback 0xFF, expert 0x37. |
| m1 | Saved scale forever, overrides the wizard, cannot be cleared | **Open**, and see M3 | `app.js` `readSavedGyroScale`; no "clear" control exists (`grep` for it in `diagnostics-page.js` is empty). The same is true of the saved accelerometer sign. |
| m2 | Segments tested against last-step positions, latency ignored | **Open** | `game.js` `_processSegment` lines 128-132 unchanged. |
| m3 | Perf governor only escalates | **Open** | `fx.js` `createPerfGovernor` has no downward path; `presentation.js` line 258 resizes to 1x at level 3 for good. |
| m4 | GATT serialisation broken by a timed-out operation | **Open, reproduced** | see below |
| m5 | `failures >= 3` hard-coded three times | **Open** | `ui/connect-model.js` lines 44, 84, 85. |
| m6 | Per-frame allocations (`events: this.log.map(cloneEvent)`, `recent()`, ...) | **Open** | `game.js` line 256; negligible in the measured 0.5 ms frame. |
| m7 | Test gaps (three mutants) and skipped e2e is green | **Open** | the same three mutants still survive (below); e2e skipped exits 0 (n1). |
| m8 | `app.js` window and document listeners never removed by `dispose()` | **Open** | `app.js` lines 403-418 versus `dispose()` lines 586-596. |
| m9 | Docs say the simulator calibration "runs by itself" | **Open** | `README.md` line 71 and `docs/setup-and-calibration-guide.md` line 126: by default (`?input=sim` or the connect button) the game installs the exact nominal calibration; the wizard runs only from **Recalibrate** or `?simcal=1`. |
| m10 | Combo windows compare device-time stamps with frame time | **Open** | `combo.js` `expire(now)`; UNVERIFIED-ON-HARDWARE whether it splits real combos. |
| m11 | Calibration not remembered between sessions | **Open** (product, not a defect) | documented limitation. |

**m4 reproduction (unchanged code).** The response-characteristic subscription takes 3.6 s (longer than `responseSubscribeTimeoutMs` 3000) but does complete. With the fake stack:

```js
const t = setup({}); const resp = t.fake.chars.get(CH.response);
resp.startNotifications = function () { return this.op('startNotifications', async () => { await new Promise((r) => t.timers.setTimeout(r, 3600)); this.notifying = true; return this; }); };
t.connect(); await t.until(() => t.provider.status.state === 'streaming', 30000);
t.fake.log.overlaps;
```
Result: state `streaming`, warning `no command responses: startNotifications timeout`, and `overlaps = ['write on 649d4ac9-...-f005', 'write on 649d4ac9-...-f005']`: two init writes ran while the timed-out operation was still pending, which the serial chain (`ble-transport.js` lines 197-201, 318) exists to prevent. Whether Chrome on macOS then raises "GATT operation already in progress" is UNVERIFIED-ON-HARDWARE; only a hung optional subscription reaches it. Fix as in round 1: chain the raw operation promise, race only the caller's view.

**m7 mutants that still survive (run against `test/input`, `test/app`, `test/game`):** removing `if (gen !== attempt) return;` at the top of `onReport` (`ble-provider.js` line 266); removing `if (!alive) return;` in the `gattserverdisconnected` handler (`ble-transport.js` line 206); removing `if (now < this.lastNowMs) now = this.lastNowMs;` (`game.js` line 131).

## 5. New minor findings

| ID | Where | Finding | Suggested fix |
|---|---|---|---|
| n1 | `test-support/e2e/env.js`, `package.json` | With no Chrome the whole e2e suite is reported as skipped and `npm test` exits 0 (measured: 40 skipped, exit 0). A machine or a CI without Chrome shows a green run that tested no browser code. The README says "skipped, never passed", which is true but not visible to a script. | Fail when the e2e suite skips unless `E2E_OPTIONAL=1`; print the skip count in the summary. |
| n2 | `ble-provider.js` lines 200 and 253, `test/input` | The `holdOffRecenter()` call in `becomeStreaming()` can be deleted with no test failing (15-mutation run). The stage 2 hold-off lasts 1.5 s from the mask change; a first report that arrives 6 s to 9 s after it (a slow controller) would be unprotected against phantom ZL/ZR bits. The fake device streams within milliseconds of the mask change, so it never tests the late case. Also `report-stream.js` `if (t < lastT) t = lastT;` survives deletion (the clamp may be unreachable, or untested). | Add a fake with a delayed first report after stage 2; decide whether the `t` clamp is dead code. |
| n3 | `ble-provider.js` `startWatchdog` and `connect`/`startReconnect` | The mask that finally produced data (stage 2 fallback, for example 0xFF) is not remembered: `activeMask()` always returns the flag or default, so every reconnect after a link loss repeats the 4.5 s no-data stage first. | Store the working mask in `lastConnectOpts.mask` when the stream starts after stage 2. UNVERIFIED-ON-HARDWARE whether a fallback is ever needed. |
| n4 | `actions.js` `BUTTON_ACTIONS` | `SL_R`, `SR_R`, `SL_L`, `SR_L` (the rail buttons) are mapped to RECENTER. The rail is where a 3D-printed mount or strap is most likely to touch the Joy-Con, and the debounce is only 120 ms. A mount that flexes during a hard swing could produce rising edges and a phantom re-centre (eased cursor, no cutting for 150 ms, toast and sound). Only rising edges count and the connect-time baseline is ignored, so a mount that presses steadily is safe. The project rule is not to assume the mounting. UNVERIFIED-ON-HARDWARE (HW-6, UOH-10). | Do not map the rail buttons (keep `R`/`ZR` and `L`/`ZL`), or require a 400 ms hold for them. |
| n5 | `app.js` `stepInner`, `motion.drainSegments`, `ui.js` step (menu cut selection) | Segments queued while frames did not run (a hidden tab keeps receiving Bluetooth notifications, or a long main-thread stall) are handed to the UI on the first frame with no age check. Reproduced: on the pause screen, 21 aim samples across "Quit to menu" pushed with no frame between, then one frame: `overlay` becomes `confirm`. Only the quit confirmation opens, but any target under the old swing can be selected. The game itself is protected because it is not active then. | Drop UI segments older than about 150 ms (`t1 < now - 150`) and clear the queue on `visibilitychange`. |
| n6 | `ninja-api.js` `swingThrough` | Argument and state errors are thrown synchronously (`no round is running`, `object N is not alive`), while `swing` and `simSwing` return rejected promises. `__ninja.swingThrough(id).catch(...)` therefore throws instead of catching. Measured. This API is what automated agents depend on. | Wrap the body in `try/catch` and return `Promise.reject(err)` like `swing`. |
| n7 | `ui.js` `joyconCalibrated`, `motion` calibration | The calibration is not invalidated when the connected device differs from the calibrated one (other side, other device name, re-strapped after a disconnect): the connect screen continues straight to the menu. `Calibration.side` is stored but never compared with `status.side`. | Clear `joyconCalibrated` (and offer the wizard) when `status.side` or `deviceName` differs from the calibration's. |
| n8 | `app.js` `stepInner`, `ui/presentation.js` line 185, `ui.js` step, `storage.js` `getSettings` | `storage.getSettings()` builds a new object with a spread on every call; it runs at least twice per frame (`presentation.js` line 185 and `ui.js` line 887), plus `motion.getSettings()`, `provider.status` (materialises a frozen object each frame while packets arrive), `motion.recent(260)` and `headAt` (allocates a velocity object). Together with m6 this is a few dozen small objects per frame. Not a bug at the measured 0.5 ms per frame; it only adds GC pressure on a slow machine. | Cache the effective settings object until `updateSettings` runs. |
| n9 | `ble-transport.js` `classifyGattError` | A `NotFoundError` from `getPrimaryService` right after connect is classified as `not_joycon` and counts as a failure that starts the cooldown. On macOS a discovery race right after `gatt.connect()` could look the same (UNVERIFIED-ON-HARDWARE), so a healthy Joy-Con could be reported as "not a Joy-Con" and locked out for 10 s. | Retry service discovery once after `settleMs` before classifying it as `not_joycon`. |
| n10 | `docs/setup-and-calibration-guide.md`, `README.md` | Neither document tells the player that a saved scale or accelerometer sign from the diagnostics page silently applies to every later session (m1, M3), or how to clear it (only developer tools, `localStorage.removeItem('joyconNinja.imu.v1')`). | Add the sentence and, better, a "Clear the saved values" button on the diagnostics page. |
| n11 | `server.js` `startServer` | After `listen` succeeds the temporary `error` handler is removed and no other is installed, so a later socket-level `error` on the server object would surface as an uncaught exception. Practically unreachable on loopback. | `server.on('error', log)` after start. |
| n12 | `report-stream.js` `timing`, `pipeline.js` line 470 | A hole between 200 ms and 1 s inside a swing is not integrated at all (`dtMs` is null from 200 ms up; the slicing of `pipeline.js` line 470 only covers 100 ms to 200 ms), so the rotation that happened in the hole is lost for good and yaw error stays until soft centring. Documented behaviour; listed because BLE stalls of this size are the likeliest real disturbance and the choice (skip versus integrate with the mean of the two surrounding rates) can be tuned on the real sword. UNVERIFIED-ON-HARDWARE (UOH-4). | Optional: integrate a hole up to 400 ms with the mean of the surrounding rates, and log it. |

## 6. Checked and found sound (so nobody re-checks it)

- **Web Bluetooth flow** (`ble-transport.js`, `ble-provider.js`): `requestDevice` runs synchronously inside the pointer or key handler (`ui.js` delivers `connect` from `pointerClick`; the connect screen is excluded from dwell and cut selection, so it never runs from a frame); every later step is generation-guarded; `close()` is idempotent and aborts a pending `gatt.connect()`; listeners are removed before the deliberate `gatt.disconnect()`, so no spurious `gattserverdisconnected` follows; a drop during connect, init, streaming and reconnect always lands in a legal state; the one automatic retry is bounded; every timer is cleared on close. No unhandled promise rejection path found: `connectProvider`, `reconnectProvider`, the diagnostics page, the auto retry and the watchdog all attach a handler; the internal `deferred` promises always have a consumer.
- **Disconnect overlay timing:** the UI's 2 s `reconnect` intent and the provider's 2 s automatic retry can race. If the UI wins, the manual `reconnect()` is refused by the cooldown (no state change, one `cooldown` error event), the provider's timer then fires and the UI sees `connecting`; if the provider wins, `reconnect()` returns the running attempt. Both orders end correctly.
- **Timing and orientation maths:** `report-stream.js` (wrap-safe u32 deltas, clock mapping with leak, arrival fallback), `fusion.js` and `quat.js` (integration and Mahony signs), `aim.js` (edge slip and auto-centre signs, including `flipX`), `blade-tracker.js` (window arithmetic, capacity guard, glitch cap), `calibration.js` (axis of the transition rotation, frame construction, sign and scale test). The fuzz above found no division by zero or NaN path. The remaining risk in this area is M1 and M2, which are about what the *device* sends.
- **Game:** swept-segment test cannot tunnel; hit order along the swing is stable; the world and real-time accumulators, the cap on steps per frame, the population back-pressure and the bounded outbox, log, halves, pending list and time-scale sources; determinism (`Math.random` absent, per-wave sub-streams so extras cannot shift other draws). The fuzz above ended every round and kept every counter small.
- **Server and launcher:** unchanged and correct: loopback bind with `exclusive: true`, Host allow-list against DNS rebinding, realpath check against symlinks, no directory listing, no dot files, CSP on documents. `start.command` starts the server only when the health probe fails, tears down by job table, and its `caffeinate -w $$` dies with the window.
- **Wake lock:** requested only while wanted and visible, a refusal is remembered and retried after 5 s, release on hide and dispose is handled, no rejection escapes.
- **Storage and diagnostics page:** every storage access is guarded; `buildGameUrl` and the connect options agree with `flags.js`.

## 7. Not verified by this review

Anything that needs the real Joy-Con, Chrome on the owner's Mac or the owner's display: Bluetooth discovery, pairing and bonding, whether the strict filter and the 0xB7 mask work, real report rate and timestamp semantics (duplicates, monotonicity), accelerometer gain and offset, gyro scale, sign and clipping, yaw drift, latency, button reachability and rail-button contact with the mount, macOS idle and Bluetooth permission behaviour, Retina frame rate. All remain UNVERIFIED-ON-HARDWARE and are in the README register. The real Bluetooth chooser cannot be automated (README), so `requestDevice` options were checked only against the protocol document and the fake stack.

## 8. Suggested order of fixes

1. M3 (per-provider accel sign and scale: a few lines and one test) and M1 (gap accounting in the wizard plus a visible retry message).
2. M2 (learned 1 g normalisation in step 1), n4 (drop the rail buttons from RECENTER) and n6 (`swingThrough` rejects).
3. n1 (fail on skipped e2e), n5 (drop stale segments for the UI), n7 (invalidate the calibration on a different device).
4. The carried-over m4, m1, m2, m3, m9, then the rest as time allows.
