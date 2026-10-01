# Code review, round 1 (white-box)

Reviewer role: senior code reviewer. Date: 2026-09-30. Language: English (owner request).
Scope: everything under `public/`, `server.js`, `start.command`, `test/` and `test-support/`. There is no `bridge/` folder (plan B is not built, as documented).
Nothing in the project was changed by this review; mutated copies of the code were run in a scratch folder outside the project.

> **Hardware honesty.** Nobody on the team, including this reviewer, touched a physical Joy-Con 2. Every statement below that depends on the real controller, on Chrome talking to it, or on macOS behaviour is marked **UNVERIFIED-ON-HARDWARE**. The independent protocol audit (`docs/protocol-audit.md`) already covers UUIDs, bytes, offsets and scales; this review does not repeat it and only cross-references it (items M5 and M6).

## 1. Verdict

**No critical defect found**: nothing that, from the code and from the runs below, will certainly stop the game or the connection from working. There are **5 major** items (likely bugs or serious risks, each with a concrete fix) and **11 minor** items. The code base is unusually disciplined: pure modules, injected clock and timers, generation counters against stale async work, bounded pools, seeded RNG only, CSP, loopback-only server. Most of what I tried to break held (section 5).

| Severity | Count | IDs |
|---|---|---|
| critical | 0 | none |
| major | 5 | M1 to M5 (M5 is a cross-reference to the protocol audit; the default feature mask F1 of the audit is M6, a pointer only) |
| minor | 11 | m1 to m11 |

## 2. What I ran

| Check | Result |
|---|---|
| `npm test` (unit, integration and headless-Chrome e2e in one run) | 842 tests, 842 pass, 0 fail, 0 skipped, about 22 s. |
| `npm run test:e2e` alone | 36 pass. Perf smoke in headless Chrome at 1920x1080 and 1x: 59.7 fps, JavaScript per frame avg 0.43 ms, p99 1.0 ms, input to draw about 8 ms (software only, headless, not the owner's Mac). |
| `npm run test:unit` five more times | 806 pass, 0 fail each time. **One earlier run of the same script hung forever** (see M3): a single stuck test file, no failure output. |
| Server probe (raw sockets) | `..`, `%2e%2e`, `%2f`, `..%2f`, NUL, backslash, `//host`, absolute-form target, dot files, directory listing, POST, wrong `Host` and DNS-rebinding style `Host: localhost:PORT.evil.com` are all refused (400/403/404/405) and nothing outside `public/` was ever served. Bound to `127.0.0.1` only. |
| Mutation check (22 one-line mutations of the logic, run against the relevant test folders) | 19 caught, 3 survived (m7). The tests are meaningful, not decorative. |
| Timestamp fuzz of `report-stream.js` (u32 wrap, bursts, stuck stamps, wrong units, 1000 ppm clock error, backwards jitter, 3 s stalls; 20 000 packets each) | `t` never goes backwards, never exceeds arrival time, `dtMs` is always null or finite and positive; wrong-unit and stuck timestamps fall back to arrival times within about 1 s. |
| Orientation and calibration maths read line by line | Signs of the gravity correction, the quaternion integration, the coning term, the `u2 x u1` sign test, the scale ratio 0.12288 and the wrap of yaw are correct as written. |

## 3. Major findings

### M1. The orientation filter is not re-initialised after a long link gap; the cursor drifts for seconds after a reconnect

- **Where:** `public/js/motion/pipeline.js` lines 406-413 (a gap only sets `gapDisc`, the filter keeps its old orientation), `markDiscontinuity()` line 342, `public/js/app.js` `onStatus` lines 211-225 (`motion.recenter('reconnect')`), `public/js/motion/calibration.js` (quick re-centre passes on raw accelerometer stillness, not on filter convergence).
- **What happens:** while the link is down nothing is integrated. When the stream returns, the filter still holds the pre-loss tilt and only converges through the gravity correction (time constant 1.5 s). If the sword's pitch changed while the link was down (very likely: the player lowers it during a 5 to 10 s outage), the cursor moves for several seconds. The re-centre that follows (automatic `recenter('reconnect')` at the `streaming` event, then the 1.5 s "hold still" quick re-centre) captures the reference while the filter is still mid-convergence, so the cursor slides away again after the re-centre.
- **Reproduction (script kept outside the project):** calibrated pipeline, 1 s at pitch 0, then a 10 s gap during which the sword is raised to pitch 25 degrees, then `markDiscontinuity('lost')` and `recenter('reconnect')` exactly as `app.js` does, then still samples at pitch 25. Measured raw pitch estimate: 6.96, 12.01, 15.67, 18.31, 20.24, 21.57, 22.54, 23.18 degrees at 0.5 s steps (truth 25). A quick re-centre taken at 1.5 s freezes the reference at 15.7 degrees and the cursor then creeps 9.3 degrees (about 255 px at 27.4 px per degree) further; auto-centring (3 degrees per second) needs about 3 more seconds to absorb it.
- **Impact:** after every reconnect the first seconds of play have a visibly wrong vertical position. Modest for small tilt changes, large for big ones. It compounds the yaw loss that is unavoidable across a gap.
- **Fix (small):** when the gap is longer than about 1 s (or in `markDiscontinuity('lost')` and on `reset`), call `this.filter.reset()`, set `this.havePw = false` and `this.haveAim = false`. The existing `pendingRecenter` path then re-references yaw and pitch on the first new sample from a tilt that is exact at rest (`initFromAccel`, boot boost). Add a unit test that repeats the script above and asserts the pitch error is below 2 degrees on the first sample after the gap.
- Status of the underlying behaviour on a real Joy-Con: UNVERIFIED-ON-HARDWARE (the bug is in the maths and reproduces on the synthetic sensor).

### M2. No screen wake lock: the Mac can dim or sleep the display in the middle of a session

- **Where:** nowhere in `public/js` (searched for `wakeLock`), and `start.command` does not run `caffeinate`.
- **What happens:** the Joy-Con is not an HID device to macOS in this design. Its data arrives through Web Bluetooth and does not reset the system idle timer, so a player who only swings the sword produces no mouse or keyboard activity. When macOS decides the machine is idle, the display dims and then sleeps; Chrome hides the tab, `requestAnimationFrame` stops, the game pauses itself (visibility and blur handling), the audio context is suspended and the Bluetooth keep-alive timers are throttled. Sessions of 15 minutes are exactly what the safety text recommends, and macOS on battery often sleeps the display after 2 to 5 minutes.
- **Status:** the exact idle timings on the owner's Mac are UNVERIFIED-ON-HARDWARE, but the missing inhibitor is certain from the code. Chrome inhibits display sleep for a page that holds a screen wake lock.
- **Fix:** request `navigator.wakeLock.request('screen')` while a round, a countdown, a calibration or a connection is active (re-request on `visibilitychange`, ignore rejection), and as a belt-and-braces measure start `caffeinate -di -w <server pid> &` from `start.command` (no dependency, stops with the server). Mention it in the guide.

### M3. `start.command` can leave an orphaned `sleep 3600`; together with the missing test timeout it makes `npm test` hang forever

- **Where:** `start.command` lines 37-49 and 88-92 (`sleep 3600 &` then `SLEEP_PID=$!`, `cleanup` kills `${SLEEP_PID}` only), `test/server/start-command.test.js` (spawns the launcher with piped stdio and sends SIGINT as soon as the fake `open` was called), `package.json` (`node --test` without `--test-timeout`).
- **Mechanism:** a trap runs between two commands. If SIGINT arrives after `sleep 3600 &` has forked but before `SLEEP_PID=$!` has run, the `INT` trap exits, `cleanup` sees an empty or stale `SLEEP_PID`, and the `sleep` survives, re-parented to launchd. It inherited the launcher's stdout and stderr pipes, so the Node test process never sees end-of-file and never exits; `node --test` waits for it without limit.
- **Evidence:** during this review one `npm run test:unit` hung for over 10 minutes; `ps` showed the test process idle, no child, and an orphan `sleep 3600` (PPID 1) holding the pipe; killing it let the run finish. Later runs (five full unit runs, ten isolated runs, eight isolated runs under CPU load) did not reproduce it, so it is rare. A replica of the loop (`race.sh`, in the scratch folder) receiving SIGINT at a pseudo-random moment in the first 25 ms leaves an orphan in **10 of 400** trials (2.5 %).
- **Impact:** for the owner the orphan is a harmless stray process (and the same tiny window exists for `SERVER_PID` after `node server.js &`). For the team it is a hang of the test command with no output, which blocks any automated reviewer or CI.
- **Fix:** in `cleanup` kill by job table, not by variable: `kill $(jobs -p) 2>/dev/null`. In the test, run the launcher with `stdio: ['ignore', 'ignore', 'ignore']` after the assertions that read stdout, give each test `{ timeout: 60000 }`, and add `--test-timeout=120000` to the `test`, `test:unit` and `test:e2e` scripts so that a stuck file fails instead of hanging.

### M4. The connect screen offers the diagnostics page while the game may own the Joy-Con link

- **Where:** `public/js/app.js` line 329 (`openDiagnostics` just calls `window.open`), `public/js/ui/screens/connect.js` line 62 (link always drawn), `docs/setup-and-calibration-guide.md` section 5.
- **What happens:** a BLE peripheral accepts one central. From Menu, "Connection", the connect screen is shown with the controller already streaming (the game deliberately does not auto-continue when it is already calibrated). The diagnostics link opens a second tab; its "Connect" then finds nothing in the chooser, or the game tab is pushed to the background and its keep-alive and watchdog timers are throttled until the link drops. Neither page tells the player why.
- **Status:** the single-connection behaviour and the throttling are UNVERIFIED-ON-HARDWARE, but the code path exists and is undocumented.
- **Fix:** on `openDiagnostics`, disconnect the Joy-Con provider first (or open the page only when the provider is not streaming), and add one sentence to the guide: "Close or disconnect the game before you open the diagnostics page; only one page can hold the controller."

### M5. The game cannot use any scan or feature-mask fallback (cross-reference: protocol audit F2)

- **Where:** `public/js/app.js` line 282 calls `p.connect()` with no options, so `requestJoyCon` always builds the strict pairing-mode filter and the connect always uses mask 0x37 (`ble-provider.js` line 396, `input-config.js`). The lenient and all-devices filters and the 0xFF mask exist only as controls on `diagnostics.html`, and a device chosen there is lost when that page is left.
- **Impact:** if the strict filter matches nothing on the owner's Mac (UOH-1, UOH-12: only one source measured the zero host address; some macOS scans may omit manufacturer data), the diagnostics page can prove the Joy-Con is visible but the game can never connect to it. There is no recovery inside the game.
- **Fix:** parse `?filter=strict|lenient|all`, `?mask=0x37|0xB7|0xFF` and `?side=L|R` in `flags.js` and pass them to `p.connect({ filter, mask, side })` in `connectProvider` (the provider already accepts them). Document them in the README flag table and the guide. No protocol byte changes.

### M6 (pointer only). The default feature mask 0x37 is the least evidenced choice (protocol audit F1)

I agree with the audit's reading of the transport: `featureMask: 0x37` in `input-config.js` and the 4.5 s watchdog stage that switches to 0xFF (which the audit says can create phantom ZL/ZR bits, mapped to RECENTER in `actions.js`). It is not repeated here. Practical hardening on the code side: also let the watchdog try 0xB7 before 0xFF and make `actions.js` ignore a re-centre edge that appears within 1.5 s of a mask change. UNVERIFIED-ON-HARDWARE (UOH-3, UOH-10).

## 4. Minor findings

| ID | Where | Finding | Suggested fix |
|---|---|---|---|
| m1 | `app.js` `readSavedGyroScale` (line 85), `calibration.js` line 252, `diagnostics-page.js` line 232 | The scale saved by the diagnostics page is applied forever and overrides the wizard's own estimate (the wizard only warns when the two differ by more than 30 %). The page also saves an arbitrary "other" measurement (a sloppy three-quarter turn gives 1.33). There is no way to clear it except developer tools, and the game never shows that a stored scale is active. | Only offer "Save scale" for the two candidates or after two consistent runs; add "Clear saved scale"; show the stored scale on the calibration screen; let the wizard's estimate win when the two differ by more than 15 %. |
| m2 | `game.js` `_processSegment` (line 580) | Segments are tested against object positions of the last world step, but a segment is stamped `t1` up to the input latency (BLE plus one frame, 30 to 60 ms) in the past. A fruit moving at 1300 px/s is therefore tested about 40 to 80 px away from where the blade actually crossed it; the hit radius (1.25 x r) hides most of it. | Back-project each object to `seg.t1` (`x - vx*d`, `y - vy*d - 0.5*g*d^2`, d = now - t1, capped at 80 ms) before `closestOnSegment`. Cheap; deterministic. UNVERIFIED-ON-HARDWARE whether it is noticeable. |
| m3 | `render/fx.js` `createPerfGovernor`, `ui/presentation.js` lines 255-263 | The auto-degrade level only goes up. Any sustained 2 s window above 20 ms per frame (first-load JIT, macOS Bluetooth pairing prompt, Chrome Energy Saver capping to 30 fps, screen recording) permanently halves particles, caps splats and, at level 3, drops the backing store to 1x on a Retina screen (blurry) until the page is reloaded. | Allow recovery (level down after 10 s under 14 ms) and re-run `resize()` when leaving level 3; ignore the first 5 s after load. |
| m4 | `input/ble-transport.js` lines 197-201, 318 | `serial()` serialises GATT operations by chaining promises, but `withTimeout` settles the chain when it times out while the underlying `startNotifications()` may still be pending. The next `write` can then overlap it, which is what the serialisation exists to prevent. Only reachable after a 3 s hang of the optional response subscription. | Chain the raw operation promise (not the timed-out wrapper) so the next operation waits for it, and race only the caller's view against the timeout; or, on timeout, mark the link degraded and hold further writes until the raw promise settles. |
| m5 | `ui/connect-model.js` lines 44, 84, 85 | `failures >= 3` is hard-coded three times; the rule lives in `INPUT_CONFIG.longCooldownAfterFailures`. Changing the config would make the provider and the screen disagree (the architecture test forbids magic numbers outside configs but does not catch this). | Import the config value or read it from the status object. |
| m6 | `game.js` `snapshot()` line 256, `motion.recent(260)`, `Emitter.emit`, `status.js` `materialize`, `pipeline.js` `_velocity` | Small per-frame or per-packet allocations. The worst is `events: this.log.map(cloneEvent)`: 32 cloned events every frame that no runtime consumer reads (`snapshot.events` is used only by tests and the debug API). Measured cost is negligible (0.43 ms per frame average) so this is cleanup, not a performance bug. | Make the event log part of `snapshot()` only when asked (`snapshot({events:true})`); reuse the `recent()` array. |
| m7 | `test/`, `test-support/` | Test gaps found by mutation: (a) removing the `if (!alive) return;` guard of the `gattserverdisconnected` handler in `ble-transport.js` breaks no test; (b) removing the generation guard `if (gen !== attempt) return;` at the top of `onReport` in `ble-provider.js` breaks no test (the transport's own `alive` check hides it); (c) removing the monotonic-time guard `if (now < this.lastNowMs) now = this.lastNowMs;` in `Game.update` (`game.js` line 131) breaks no test. Also: the e2e files report **skipped** when Chrome cannot start, which still exits 0, so `npm test` can be green without any browser test having run; the BLE tests run against `fake-bluetooth.js`, a model of the protocol document, so they prove conformance to the document only (already stated in the README). | Add the three missing tests (late notification from an abandoned attempt must not reach `stream.push`; duplicate `gattserverdisconnected` must not emit twice; `Game.update` with a backwards `nowMs` must not move time back). Make `npm test` fail when the e2e suite is skipped unless `E2E_OPTIONAL=1`. |
| m8 | `app.js` lines 355-370 | The `blur`, `pagehide` and `visibilitychange` listeners on `window` and `document` are added in `createApp` and never removed by `dispose()`. Harmless in the page, but a test or embedding that creates several apps accumulates listeners that call into disposed objects. | Store the three listeners and remove them in `dispose()`. |
| m9 | `docs/setup-and-calibration-guide.md` section 6, `README.md` "Input providers" | Both say the simulator's calibration "runs by itself". By default (`?input=sim`, or "Simulator" on the connect screen) the game installs the simulator's exact nominal calibration (`app.js` line 270) and goes straight to the menu; the real wizard runs only with `?simcal=1` or from the menu's "Recalibrate". The simulator path therefore does not exercise bias estimation by default. | Reword: "runs by itself when you start it from Recalibrate or with `?simcal=1`; by default the simulator uses its exact calibration". |
| m10 | `game.js` `_processSegments`, `combo.js` `expire` | Combo windows compare segment stamps `t1` (device time mapped onto the clock, so already older than arrival by the BLE latency) with `nowMs` from the frame. The 100 ms close grace after a swing's last segment and the 250 ms window between cuts therefore lose the latency (about 30 to 60 ms) and the frame time. A BLE hiccup over 100 ms mid-swing splits a combo. UNVERIFIED-ON-HARDWARE. | Compare against the newest segment stamp seen (`max t1`), not against `nowMs`, or add the measured latency to `closeGraceMs`. |
| m11 | Product | The calibration is not remembered between sessions (documented limitation). For a rigidly mounted sword the wizard (about 12 s of holding still plus a practice cut) is repeated at every launch. | Persist `frame`, `gyroSign`, `gyroScale` and the side in `localStorage` (validated with `validateCalibration`), keep bias online, and offer "Use the last calibration" plus the existing quick re-centre. Not a defect; a large comfort gain. |

## 5. Checked and found sound (so nobody re-checks it)

- **Server** (`server.js`): traversal, encoding, NUL, backslash, symlink escape (realpath check), directory listing, dot files, methods, `Host` allow-list, CSP, health probe and "already running" logic. Loopback only.
- **Web Bluetooth flow** (`ble-transport.js`, `ble-provider.js`): `requestDevice` is called synchronously from the click or key handler; every later step is async and generation-guarded; `close()` is idempotent and aborts a pending `gatt.connect()`; the input listener is registered before `startNotifications`; the response subscription is optional; writes go only to the command characteristic; disconnects during connect, init, streaming and reconnect all land in a legal state (`status.js` transition table); the auto-retry is bounded to one; cooldown cannot be bypassed by the UI except by reloading the page; the chooser being cancelled costs nothing. No unhandled promise rejection path found (every returned promise has a catch in `app.js`, `diagnostics-page.js` and the provider).
- **Timing** (`report-stream.js`): wrap-safe u32 deltas, device-versus-arrival trust window, arrival fallback with mean interval, running-minimum clock mapping with leak, ring buffers; all bounded.
- **Motion** (`fusion.js`, `pipeline.js`, `aim.js`, `blade-tracker.js`, `calibration.js`): no division by zero or NaN path found (inputs are finite-checked, thresholds are clamped, spans are guarded); the trapezoid plus coning integration and the Mahony sign are right; edge slip, auto-centre and recentre ease signs are right; the swept-segment collision (`closestOnSegment`) cannot tunnel; the tracker window arithmetic is right (mutation-verified).
- **Determinism:** no `Math.random` or wall clock in game logic (`Date.now()` only stamps `Calibration.createdAt`; audio jitter uses `Math.random`, cosmetic and documented); spawn streams are split per wave and per sub-stream so extras cannot shift other draws.
- **Bounded growth:** particles (fixed pool, oldest-first eviction), splats, popups, halves (cap 40), voices (24), segment queue (512), blade ring (128), event outbox (8192) and log (32), log ring (200), rate meters, diagnostics log. Soak tests exist and pass.
- **Storage:** every access guarded; corrupt JSON, blocked storage and out-of-range settings all recover.

## 6. Observations that are tuning risks, not defects

- Default cut threshold 1000 px/s is 36 degrees per second of sword rotation. Any brisk aiming move (a lazy wave of the sword at 115 degrees per second is 3150 px/s) is a cut, so a bomb can be cut while aiming. It is a starting value (HW-9) and is tunable in the settings; the bomb hit radius (0.85 x r) is the only protection. Watch it in the first real session.
- Auto-centring starts after 1 s below 8 degrees per second and moves the cursor at 82 px/s. A player who holds the sword still to wait for the next wave will see the cursor drift to the middle of the screen. Also HW-3; the setting "Auto-recenter" turns it off.
- After a recalibration or a reconnect, the yaw reference is only as good as the player's pose at that moment; nothing corrects yaw except re-centring (by design, no magnetometer).

## 7. Suggested order of fixes

1. M3 (test hang, five lines) and M1 (filter reset, ten lines plus one test).
2. M5 (flags for filter and mask; the diagnostics page already proves they are needed) and M2 (wake lock plus `caffeinate`).
3. M4 (disconnect before opening diagnostics; one guide sentence).
4. m1, m2, m3, m9, then the rest as time allows.

## 8. Not verified by this review

Anything that needs the real Joy-Con, Chrome on the owner's Mac or the owner's display: Bluetooth discovery, pairing and bonding behaviour, real report rate and timestamps, gyro scale and sign, accelerometer sign convention (audit F3), yaw drift, latency, button reachability, macOS idle and Bluetooth permission behaviour, Retina frame rate. All remain UNVERIFIED-ON-HARDWARE and are listed in the README register.
