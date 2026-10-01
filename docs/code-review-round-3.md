# Code review, round 3 (white-box)

Reviewer role: senior code reviewer. Date: 2026-09-30. Language: English (owner request).
Scope: everything under `public/`, `server.js`, `start.command`, `test/` and `test-support/`. There is no `bridge/` folder (plan B is not built, as documented).
Nothing in the project was changed by this review. Mutated copies and reproduction scripts ran in a scratch folder outside the project; every reproduction that matters is quoted inline.

> **Hardware honesty.** Nobody on the team, including this reviewer, touched a physical Joy-Con 2. Every statement below that depends on the real controller, on Chrome talking to it, or on macOS behaviour is marked **UNVERIFIED-ON-HARDWARE**. The one major finding is a defect of the *code* (it reproduces on the fake Bluetooth stack); what the real sensor does to make it matter is UNVERIFIED-ON-HARDWARE.

## 1. Verdict

**No critical defect found.** Nothing that, from the code and from the runs below, will certainly stop the game or the connection from working.
All three round-2 majors (M1 gyro-sign accounting in the wizard, M2 accelerometer normalisation, M3 per-provider sensor conventions) are fixed and the fixes hold under mutation (section 4), with one small gap (n2 below).
This round found **1 new major** item and **4 new minor** items. Of the round-2 minors, 12 are still open unchanged (section 4); none of them got worse.

| Severity | Count | IDs |
|---|---|---|
| critical | 0 | none |
| major | 1 | R3-M1 |
| minor | 4 new, 12 carried over | R3-n1 to R3-n4; carried-over ids keep their earlier names (m1 to m11, n1 to n12) |

## 2. What I ran

| Check | Result |
|---|---|
| `npm test` (unit, integration and headless-Chrome e2e together) | 919 tests, 919 pass, 0 fail, 0 skipped, about 22 s (run twice). |
| `npm run test:unit`, twice | 879 pass, 0 fail each time, about 7 s. No hang. |
| `npm run test:e2e` alone | 40 pass, 0 skipped, about 22 s. No headless Chrome of this suite was left behind (checked with `ps` right after the run). |
| Mutation check of the round-2 fixes and of the server, 16 one-line mutations in a scratch copy | 13 killed, 2 survived as equivalent mutants (the server traversal segment check and `signKnown = false`, see below), 1 survived for real (R3-n2). Details below. |
| Reproductions | R3-M1 (measured, section 3), diagnostics tools at 1.04, 1.06 and 1.09 g (measured, R3-n1), `swingThrough` synchronous throw (measured, carried n6). |
| Code read line by line | `app.js`, `motion/pipeline.js`, `calibration.js`, `aim.js`, `fusion.js`, `quat.js`, `blade-tracker.js`, `motion-config.js`, `ui/ui.js`, `ui/presentation.js`, `ui/storage.js`, `screens/calibration.js`, `input/ble-transport.js`, `ble-provider.js`, `report-stream.js`, `joycon2-parse.js`, `joycon2-build.js`, `input-config.js`, `status.js`, `timers.js`, `actions.js`, `sim-provider.js`, `mouse-provider.js`, `pointer-util.js`, `flags.js`, `ninja-api.js`, `wake-lock.js`, `audio/audio.js`, `game/game.js`, `game/combo.js`, `render/layout.js`, `ui/hit.js`, `server.js`, `start.command`, the diagnostics tools. `render/fx.js`, `painters.js`, `renderer.js` and `sprites.js` were only checked for unbounded collections (all are fixed-size pools or capped maps). |

**Mutations, in one table** (scratch copy, relevant test folders only):

| Mutation | Result |
|---|---|
| `app.js`: do not call `motion.setAccelSign(accelSignFor(kind))` in `useProvider` (M3) | killed (2 tests fail) |
| `app.js`: `gyroScaleFor` ignores the provider kind (M3) | killed |
| `app.js`: do not call `motion.setGyroScaleOverride(...)` (M3) | killed |
| `calibration.js`: charge every unknown step to `gapMs` again (M1) | killed |
| `pipeline.js`: do not divide by g0 (M2) | killed |
| `calibration.js`: accept any step 1 mean |a| (M2 range) | killed |
| `calibration.js`: drop the steadiness rule of `_accelOk` (M2) | killed |
| `ui.js`: do not set `cal.notice` (M1 notice) | killed |
| `ui.js`: do not set `cal.tryAgain` (M1 retry) | killed |
| `calibration.js`: `signKnown = false` next to the warning | equivalent (it is the initial value), survives by construction |
| **`pipeline.js`: `_applyWizardParams` uses `g0: 1` instead of the learned g0** | **survived, see R3-n2** |
| `server.js`: `HOST = '0.0.0.0'` | killed (assertion `server.address().address === '127.0.0.1'`; the mutated run also left a child server behind and did not finish by itself, irrelevant for the real code) |
| `server.js`: no `..` or `.` segment check | survived, **equivalent**: `new URL()` already collapses dots and the `path.resolve` plus `startsWith(root + sep)` check after it still refuses an encoded `%2e%2e`; defence in depth, not a gap |
| `server.js`: no `realpath` symlink check | killed |
| `server.js`: no Host allow-list | killed |
| `server.js`: serve dot files | killed |

## 3. Major finding

### R3-M1. The diagnostics values (accelerometer sign, gyro scale) are read only the FIRST time the Bluetooth provider is chosen; the "connect, open Diagnostics, save, come back, connect again" flow silently keeps the old convention

- **Where:** `public/js/app.js` `useProvider` (line 288: `if (provider === next) return next;` comes before `motion.setAccelSign(accelSignFor(kind))` and `motion.setGyroScaleOverride(gyroScaleFor(kind))`), `makeProvider('joycon')` (the Bluetooth provider lives for the whole page, `providers.joycon`), `handleIntent 'openDiagnostics'` (disconnects but keeps `provider` pointing at the same instance).
- **What happens:** the round-2 fix for M3 reads the saved record "when the provider is chosen, not once at page load" (comment in `app.js`, and `docs/setup-and-calibration-guide.md` line 97: "The game reads it when the Bluetooth Joy-Con is chosen"). That is only true when the active provider *changes*. The connect screen has a **Diagnostics** button whose whole purpose is this flow: connect once, open the diagnostics page in a second tab, measure, press "Save the measured sign" or "Save scale", return to the game tab and press connect again. On that second connect `provider === next`, `useProvider` returns at once, and the pipeline keeps the sign and scale it had at the first connect. The calibration wizard then runs against the old convention, and, as `test/motion/accelsign.test.js` itself documents, **a wrong accelerometer sign passes the wizard and only turns the frame round (forward and up point the wrong way)**: no warning is raised anywhere.
- **Reproduction (measured, fake Bluetooth stack, repeatable with `test-support/`):**
  ```js
  let rec = null;
  const ls = { getItem: (k) => (k === 'joyconNinja.imu.v1' ? rec : null), setItem() {}, removeItem() {} };
  const clock = createManualClock(1000), timers = createFakeTimers(clock);
  const fake = createFakeBluetooth({ clock, timers, behaviour: {} });
  const h = await makeApp('?clock=manual&skipsafety=1&mute=1', { localStorage: ls, env: { clock, timers, bluetooth: fake.bluetooth } });
  h.n.debug.forceScreen('connect'); h.key('Enter');  /* run 15 s */       // accelSign 1, gyroScale 1
  h.app.presentation.ui.activate('connect.diagnostics');                  // game lets go of the Joy-Con
  rec = JSON.stringify({ accelSign: -1, gyroScale: 0.12288 });            // what the diagnostics tab saved
  h.n.debug.forceScreen('connect'); h.key('Enter');  /* run 15 s */
  h.n.debug.getMotionDebug();   // accelSign 1, gyroScale 1  <- the saved values were NOT applied
  ```
  Output: `accelSign 1 gyroScale 1` after the second connect (the provider was `streaming` both times).
- **Impact:** the exact first-run flow the UI promotes leaves the game on the wrong sensor convention until the page is reloaded; nothing tells the player to reload (the diagnostics page says "next start", the setup guide says "when the Joy-Con is chosen", its troubleshooting table says "then reload the game": three different statements). If the real accelerometer reports the gravity vector, which is UNVERIFIED-ON-HARDWARE (protocol audit F3, UOH-20), the owner's first calibration ends with a cursor that is silently wrong and the owner has just "fixed" it in the diagnostics page.
- **Fix (small):** in `connectProvider` (or at the top of `useProvider` when `provider === next && kind === 'joycon'` and the link is not streaming), compare `accelSignFor('joycon')` and `gyroScaleFor('joycon')` with what the pipeline holds (`motion.getDebug().accelSign` and the override) and, when they differ, apply them and run `motion.reset()` plus `motion.setCalibration(null)`; tell the UI that the calibration is gone (clear `joyconCalibrated`, see carried n7) so the wizard runs again. Add the test above. Make the three documents say the same thing.

## 4. Status of the round-2 findings

| ID | Round-2 finding | Status now | Evidence |
|---|---|---|---|
| M1 | Wizard discards gyro sign and scale when two samples have an unknown step | **Fixed** | `TransitionIntegrator.add(g, dtMs, t)` charges `gapMs` only above 40 ms of wall-clock distance; killed by mutation; the player sees the notice and the retry (but see R3-n3). |
| M2 | Wizard needs |a| within 5 % of 1 g | **Fixed in the game** | `accelG0` learned in step 1, validated 0.5 to 2, every reading divided by it, warn band 0.95 to 1.05; killed by 3 mutations. One gap (R3-n2) and a diagnostics inconsistency (R3-n1). |
| M3 | Saved diagnostics values leak into the simulator | **Fixed for provider changes** | `accelSignFor(kind)` and `gyroScaleFor(kind)` in `useProvider`; killed by 3 mutations. **Not applied on a reconnect of the same provider: R3-M1.** |
| m1 | Saved scale forever, cannot be cleared | **Open** | no "clear" control (`grep removeItem` in `diagnostics-page.js` is empty); the guide still says "developer tools". |
| m2 | Segments tested against last-step positions | **Open** | `game.js` line 135: `_processSegments` runs before the real-time ticks, unchanged. |
| m3 | Perf governor only escalates | **Open** | `createPerfGovernor` unchanged. |
| m4 | GATT serialisation broken by a timed-out operation | **Open** | `ble-transport.js` line 318 still races the raw promise inside `serial`. |
| m5 | `failures >= 3` hard-coded three times | **Open** | `connect-model.js` lines 44, 84, 85. |
| m6 | Per-frame allocations | **Open** | `game.js` line 256, `snapshot()` maps the whole log each frame. Measured frame cost stays small. |
| m7 | Three surviving mutants and skipped e2e is green | **Open** | the three code sites are unchanged. |
| m8 | `app.js` listeners never removed by `dispose()` | **Open** | `app.js` lines 414 to 427 versus `dispose()` line 597. |
| m9 | Docs say the simulator calibration "runs by itself" | **Open** | `README.md` line 71 still says it. |
| m10 | Combo windows compare device stamps with frame time | **Open** | see R3-n4, which sharpens it. |
| m11 | Calibration not remembered between sessions | **Open** (product) | documented limitation. |
| n1 | Skipped e2e exits 0 | **Open** | `test-support/e2e/env.js` returns `skip`, unchanged. |
| n2 | Two mutants in `ble-provider.js` and `report-stream.js` survive | **Open** | code unchanged. |
| n3 | The mask that produced data is not remembered | **Open** | `activeMask()` still reads the flag or the default. |
| n4 | Rail buttons map to RECENTER | **Open** | `actions.js` lines 21 and 29 unchanged. |
| n5 | Stale segments reach the UI after a stall | **Open** | `app.js` `stepInner`: `segsForUi = segs` with no age check. |
| n6 | `swingThrough` throws synchronously | **Open, re-measured** | `h.n.swingThrough(9999).catch(...)` throws `swingThrough: object 9999 is not alive` (and `no round is running`) instead of returning a rejected promise, while `swing` and `simSwing` do reject. |
| n7 | Calibration not invalidated for a different device | **Open** | `useProvider` keeps the calibration when the Bluetooth provider is reused; `joyconCalibrated` is never compared with `status.side` or `deviceName`. It also matters for the R3-M1 fix. |
| n8 | Per-frame small allocations | **Open** | `storage.getSettings()` spreads a new object several times per frame. |
| n9 | `NotFoundError` at discovery is "not a Joy-Con" | **Open** | `classifyGattError` unchanged. |
| n10 | Docs silent about saved values | **Partly fixed, see R3-M1** | the setup guide now documents them but contradicts the code. |
| n11 | No `server.on('error')` after listen | **Open** | `server.js` `startServer`. |
| n12 | A hole of 200 ms to 1 s inside a swing is not integrated | **Open** | documented behaviour, UNVERIFIED-ON-HARDWARE (UOH-4). |

## 5. New minor findings

| ID | Where | Finding | Suggested fix |
|---|---|---|---|
| R3-n1 | `input/diagnostics-tools.js` `createStillWindow` (`accelBandG = 0.08`), `createRestCheck` (`passAccel` at 1 +- 0.03 g) | The game now accepts a resting |a| from 0.85 to 1.15 g, the diagnostics page does not. Measured with a still sensor (`createRestCheck(3000)` and `createSignTest()` fed 400 samples): at 1.00 g rest check passes and the sign test starts; at 1.04 and 1.06 g the rest check **fails** (`passAccel false`) although the game would calibrate fine; at 1.09 g the **sign test never leaves the first hold** (no message, the ring just never fills). The rest-check threshold is a documented statement about the sensor (contract-notes, round 2), but the page neither shows the learned g0 nor says that the game tolerates more, and the stalled sign test is silent. On the owner's first check of a real Joy-Con a red cross here reads as "hardware broken". UNVERIFIED-ON-HARDWARE whether the real sensor is off by that much (UOH-3). | Show "|a| = 1.06 g, the game divides by it" as a warning, not a failure, between 0.95 and 1.15 g; give `createStillWindow` the same 0.85 to 1.15 band (steady relative to its own mean); print a hint when the sign test has not started after 10 s. |
| R3-n2 | `motion/pipeline.js` `_applyWizardParams` (`g0: result.accelG0 ?? 1`) | Test gap: replacing the learned g0 by 1 in this line makes no test fail (mutation run). Between the end of step 2 and the end of step 3 (up to 3 s) the orientation filter then runs with an un-normalised accelerometer; the final calibration (`paramsFromCalibration`) is right again. Impact is small (a 1.14 g sensor gets a gravity trust of about 0.1 for those seconds, and the filter was just initialised exactly from gravity), so this is a coverage hole, not a bug. | Assert `getDebug()` exposes the g0 in use (add it, it is not in `getDebug()` today) and check it right after step 2 in `test/motion/calibration.test.js`. |
| R3-n3 | `ui/ui.js` `practiceSucceeded`, `onCalibration` `'done'` | The "sign unknown" notice (`cal.signUnknown`) only lives on the practice screen. If the player cuts the practice fruit within the first seconds (the normal case), `practiceSucceeded` shows the plain "cal.ok" toast, goes to the menu and the notice is gone; the calibration stays in use with the default gyro sign and nothing is left behind (`cal.tryAgain` stays true but `cal.step` is 1). Read from the code path; a clean test of it does not exist (`test/ui/ui-flow.test.js` line 331 only checks the notice while it is shown). | Keep a flag in the UI (`calWarning`) and show the notice on the menu and in the first round too, or refuse the practice success until the player either accepted or repeated. |
| R3-n4 | `game/combo.js` `expire(nowMs)` against `lastSegT1`, `config.js` `combo.closeGraceMs: 100` | Sharpens carried m10. `beforeCut` compares two device stamps (robust), but `expire` compares the frame time with the newest segment stamp. Segment stamps are device time mapped onto the clock (they trail the arrival by the delivery delay), so with bursty delivery `now - lastSegT1` can pass 100 ms in the middle of a swing whenever the link stalls for about 100 ms (the pipeline's own `sliceOverMs` is 100 ms, so stalls of that size are expected). The group then closes, the next cut of the same swing finds `!this.open` and starts a new group, and the player loses the combo bonus and the combo slow motion for that swing. UNVERIFIED-ON-HARDWARE (UOH-4, UOH-8). | Base the time-out on `blade`/segment `arrivedAt` or add the current delivery lag (`now - newest segment arrival`) to the grace; or widen `closeGraceMs` to 200 ms while keeping `windowMs` at 250. |

## 6. Checked and found sound (so nobody re-checks it)

- **Web Bluetooth flow** (`ble-transport.js`, `ble-provider.js`): `requestDevice` runs synchronously in the pointer or key handler (for a mouse the `pointerup` is inside the transient activation opened by the `mousedown`); every step after it is generation-guarded; `close()` is idempotent and aborts a pending `gatt.connect()`; listeners are removed before the deliberate disconnect; every promise from the transport has a handler (`withTimeout` swallows the late rejection of the loser, `waitFor` waits on a promise that never rejects); `startNotifications` failures on both characteristics end in a classified error, never an unhandled rejection; the automatic retry is bounded to one; every timer is cleared on close; `state` transitions checked against the table in `status.js` (same-state allowed, `failAttempt` from `lost` stays `lost`).
- **Report parsing and timing** (`joycon2-parse.js`, `report-stream.js`): field offsets match the protocol document, 60 bytes are enough for every field read, u32 timestamp deltas are wrap-safe (`>>> 0`), a duplicate or backwards stamp restarts the estimate, the arrival fallback and the running-minimum clock offset cannot run away, `t` is non-decreasing and never after the arrival.
- **Motion maths**: quaternion product and integration (right-multiplied body rates), the Mahony correction sign, the coning term, the edge-slip and auto-centre signs (including `flipX`), the inverse mapping used by `reanchor`, the blade tracker window bookkeeping (`_popOldest` keeps `_pathLen` exact), the glitch cap, and the g0 paths (`invG0` cannot be 0: the calibration validator bounds it to 0.5 to 2, the wizard to 0.85 to 1.15, the default is 1). No divide by zero or NaN path found in the new code.
- **Game**: swept-segment test cannot tunnel, hit order along the swing is stable, all collections are capped (objects, halves 40, pending, outbox, log, slow-motion sources), no `Math.random` and no wall clock in game logic (`Date.now` only stamps `Calibration.createdAt`, the storage record date and the diagnostics report; `Math.random` only fills the audio noise buffer; `randomSeed()` uses `crypto` only when no seed was given).
- **Audio**: the context is created inside the first pointer or key gesture, `resume()` has a catch, at most 24 voices, `safe()` around everything; no node leak seen (`prune()` and `dropVoice()` disconnect).
- **Server and launcher**: loopback bind with `exclusive: true`, Host allow-list (DNS rebinding), realpath symlink check, no directory listing, no dot files, NUL, backslash, absolute-form and `//host` targets refused, CSP on documents. `start.command` starts the server only when the health probe fails, tears down through the job table, `caffeinate -w $$` ends with the window. Unchanged since round 2.
- **Wake lock, storage**: a refusal is remembered and retried after 5 s, release on hide and dispose handled; every storage access is guarded and clamped. Two game tabs would overwrite each other's best scores (last writer wins); not a realistic case.
- **Tests that do test something**: the new M1, M2 and M3 tests were each attacked by a mutation and all but one line were caught (table in section 2); the server tests catch every real weakening.

## 7. Not verified by this review

Anything that needs the real Joy-Con, Chrome on the owner's Mac or the owner's display: Bluetooth discovery, pairing and bonding (the strict filter matches pairing-mode adverts only, so a bonded Joy-Con needs SYNC held or `?filter=lenient`), whether the 0xB7 mask works, real report rate and timestamp semantics, accelerometer gain, offset and sign, gyro scale and sign, yaw drift, latency, rail-button contact with the mount, macOS idle and Bluetooth permission behaviour, Retina frame rate, hand tremor against the 15 dps wizard limit with a hand-held sword. All remain UNVERIFIED-ON-HARDWARE and are in the README register.

## 8. Suggested order of fixes

1. R3-M1 (re-apply the sensor conventions and drop the calibration when they change on a reconnect, plus the test, plus one consistent sentence in README, guide and diagnostics page).
2. R3-n1 (diagnostics tolerance and a visible g0) and R3-n3 (keep the sign-unknown notice after the practice round).
3. Carried n1 (fail on skipped e2e), n5 (drop stale segments for the UI), n6 (`swingThrough` rejects), n7 (invalidate the calibration for a different device), n4 (rail buttons).
4. R3-n4 and carried m10 together, then m4, m1, m2, m3, m9 and the rest as time allows.
