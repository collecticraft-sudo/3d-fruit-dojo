# Joy-Con Ninja: QA report, validation round 3

| Item | Value |
|---|---|
| Role | QA tester, black-box, player's view |
| Date | 2026-09-30 |
| Build under test | `joycon-ninja` 0.1.0 after the round-2 fixes (R2-01, M1, M2, M3), served by `node server.js` on `http://localhost:8137`. No project file was modified by QA (checked by file time stamps at the end) |
| Reference documents | `docs/game-design.md` (numbers and rules), `README.md`, `docs/setup-and-calibration-guide.md`, `docs/architecture.md` section 9.8 (`window.__ninja`), `docs/qa-report-round-2.md` |
| Language | This report and all project documents are in English (owner request). In-game text is English as well |
| **Verdict** | **FAIL** (2 major, 4 minor new findings, 0 critical; the round-2 minors that were not in the fixer's scope are unchanged) |

The verdict follows the round rule "fail if any critical or major finding exists".

**What changed since round 2.** The R2-01 fix works for the two cases it targeted: soft centring that drags a resting cursor onto "Arcade", and a manual re-centre (Space, double click) in the menu and in the pause panel. Nothing started by itself in any of those runs (section 3). The wizard changes M1 (time accounting), M2 (learned resting magnitude) and M3 (sensor conventions per provider) behave as documented from the player's side. `npm test` is green with 919 of 919 tests (round 2: 893). Rules, scores, timers, frame rate and memory are unchanged and fine (93 of 93 rule checks, 60.0 fps with no frame above 16.8 ms for 206 s and for 7.2 minutes).

**What is still wrong.** The same family of bug as R2-01 is still reachable in two very ordinary situations, both found in this round with real (trusted) input and both reproduced several times:

- **R3-01 (major).** On the connect screen, click **"Simulator"** and leave the mouse alone: the **Arcade countdown starts by itself 0.95 s later**. This is the first-run path that `README.md` recommends. 8 of 8 runs without a pointer move.
- **R3-02 (major).** Finish the calibration wizard by cutting the practice apple, then just rest: **Arcade starts by itself about 1 s after the wizard** (R2-01's "second trigger", which the fix did not cover). 6 of 6 runs with the project's fake Joy-Con (real Bluetooth provider, real motion pipeline), 3 of 3 with the simulator and real mouse events.

Both make a round start that the player did not choose, right at the first contact with the game. The player can pause and quit, so nothing is lost, but it breaks design pillar 4 (fair failure) and the tuning target "at most 1 accidental menu selection per 20 minutes" (design 1.4). They were classed major for the same reason R2-01 was.

Nothing in this report was verified on a physical Joy-Con 2. Everything about the real device stays **UNVERIFIED-ON-HARDWARE** (see the reminders at the end of section 6). Nobody played by hand: every "play" below is a scripted bot (`window.__ninja` swings) or scripted trusted mouse / keyboard events through the DevTools protocol.

---

## 1. Findings

Severity: **critical** = crash, unplayable, data loss, wrong core rule. **major** = clearly wrong behaviour or bad experience. **minor** = polish. "Screenshot" names refer to `docs/qa/round-3/` (section 9).

### 1.1 New findings of round 3

| ID | Severity | Title |
|---|---|---|
| R3-01 | **major** | "Simulator" on the connect screen: Arcade starts by itself 0.95 s after the click (first-run path of the README) |
| R3-02 | **major** | R2-01 is not fully fixed: after the practice cut of the wizard the swing's follow-through arms the dwell, and Arcade starts by itself about 1 s later |
| R3-03 | minor | Menu button "Connection" does nothing useful with the simulator provider (the connect screen flashes for 0.2 s and the menu returns) |
| R3-04 | minor | The dwell counts time inside a target, not rest: a cursor moving slowly across a mode fruit selects it (README says "rest the cursor") |
| R3-05 | minor | Two toasts land on other text: "Crosshair recentered" on the menu title and tagline, "Calibration complete!" on the Arcade mode title at the start of the countdown |
| R3-06 | minor, hardware-dependent | A sensor that reads outside 0.85 to 1.15 g at rest is refused in step 1 with "The sensor does not seem to be still...", which blames the player for what is a sensor property |

### R3-01 (major): "Simulator" starts Arcade by itself

- **What happens.** The simulator is created when the button is clicked. Until its first sample arrives the UI uses the last real mouse pointer as the cursor; the pointer is on the button, which is not a menu target, so the dwell arms at once on the first menu frame. A few milliseconds later the simulator's first blade sample arrives at its default direction, the screen centre (960, 540), which is the middle of the "Arcade" fruit. The dwell timer then runs 0.9 s and selects Arcade.
- **Expected.** Design 12.6: a mode is selected by a cut, a click, or by keeping the cursor on the target on purpose. A cursor that first appears on a target must not select it (the round-1 and round-2 dwell fixes were about exactly this).
- **Repro (no device needed).** Open `http://localhost:8137/?mute=1&skipsafety=1` (connect screen). Move the mouse onto **"Simulator"**, click, and do not touch the mouse. `getUiState()` and `snapshot().blade` every 40 ms (script `t52_simbtn.mjs`): menu with blade (960, 540) at 1 ms, **`countdown[arcade]` at 947 to 984 ms**, `playing[arcade]` at 4.3 s. Screenshots `r3-01-a`, `r3-01-b` (dwell arc on the Arcade fruit, 0.45 s after the click) and `r3-01-c` (Arcade cut and the countdown "3", with no click).
- **Variants.** The same happens on the first visit (safety screen, Enter, connect screen, click "Simulator": `countdown[arcade]` at 959 ms), and for a mouse-provider player who goes menu, "Connection", "Simulator" (955 ms). It does **not** happen with `?input=sim` loaded directly (menu stays for the whole 4.5 s, with and without the safety screen and with the safety button clicked by mouse), with "Mouse only" (no cursor before the first pointer move), with "Hold to select" off, or when the pointer is moved by about 6 px in the first 0.2 s (the virtual sword then jumps to the pointer).
- **Cause (read from `public/js/ui/ui.js` after the black-box repro).** `cursorPosition()` (line 851) falls back to the pointer while `blade.trackingOk` is false. On the screen change the dwell is disarmed, and the re-arm rule (lines 1065 to 1075 of `ui.js`) arms as soon as the cursor is on no target: that is the pointer, not the sword. Nothing disarms it when the cursor source then changes from pointer to blade.
- **Impact.** The README's own first step ("choose Simulator") starts a round the player did not choose unless the mouse is moved within about 0.9 s. The player can pause and quit.
- **Suggested directions.** Disarm the dwell whenever the cursor source changes (pointer to blade, or `trackingOk` turns true); or never use the pointer as dwell cursor when a provider is active; or seed the simulator's virtual sword with the pointer position when it is created.

### R3-02 (major): the wizard's practice cut arms the dwell, Arcade starts by itself

- **What happens.** The wizard ends at the moment the practice apple is cut, so the menu appears **in the middle of the swing**. The follow-through (the swing continues for several hundred px, up to 8300 px/s in the trace) happens on the menu and moves the cursor by more than 100 px from where it was on the first menu frame, which is the re-arm condition. The cursor then comes to rest at about (960, 415 to 540) on the Arcade fruit (centre 960, 540, radius 170; the practice apple's apex is (960, 400), so a swing through it very likely ends there or returns to the centre). The dwell runs 0.9 s and starts Arcade.
- **Expected.** Design 12.6, as updated after round 2: the dwell "re-arms only after the cursor has come to rest and the player then moves it by hand". The code does not require the rest: `armPos` is the first cursor position after the screen change and any later position more than 100 px away arms (lines 1069 to 1071 of `ui.js`), also while the blade is still cutting.
- **Repro A, real Bluetooth provider, real motion pipeline, fake device** (`t57_trace_after_cal.mjs`, `t56_after_cal_rest.mjs`, `t59_evidence.mjs`). Connect, pose 1, pose 2, stillness, then cut the practice apple with one short up-and-down pitch pulse (as `blehelp.mjs` does), and leave the sword alone. Trace every frame: calibration at 1209 ms, **menu at 1264 ms while `cutting` is 1 and the blade moves at 1416 to 8308 px/s**, at rest on (960, 415) from 1508 ms, **`countdown[arcade]` at 2292 ms** (1.03 s after the menu appeared). `t56_after_cal_rest.mjs`, four runs: `countdown [arcade]` at 620, 619, 622 and 624 ms after the start of the observation. Screenshots `r3-02-a`, `r3-02-b` (the orange is already cut and the toast "Calibration complete!" is still on screen) and `r3-02-c`.
- **Repro B, simulator with real mouse events, no device** (`t68_simcal_mouse_tail.mjs`). `?input=sim&simcal=1` (or the menu button "Recalibrate" with the simulator). Steps 1 to 3 run by themselves (8.4 s). At step 4 sweep the mouse from (960, 250) down to (960, 520) in about 100 ms and stop. Menu at 150 to 178 ms, **`countdown[arcade]` at 1091, 1117 and 1570 ms**. A sweep that stops at (1250, 400) (outside Arcade) or at (1000, 450) left the menu alone for 5 s, so it depends on where the swing ends, as expected.
- **Why it matters.** Every calibration ends with this swing, for every player, and the practice apple sits inside the Arcade fruit. Round 2 reported this as the "second trigger" of R2-01; only the soft-centring and re-centre half was fixed.
- **Suggested directions.** Require a real rest before `armPos` is taken (for example blade speed below 100 px/s for 300 ms) and do not arm while the blade is in the `CUTTING` state; or keep the dwell disarmed for the first 1.5 s after the wizard; or move the practice apple's apex out of the Arcade circle (for example to y = 280).

### R3-03 (minor): "Connection" is a no-op with the simulator

Menu, click "Connection": with `?input=mouse` the connect screen stays; with `?input=sim` the screen is `connect` at 0 ms and **`menu` again at 211 ms** (`t55_connection.mjs`, screenshots `55-connection-*`). `ui.js` lines 765 to 768 return to the menu on every provider status fact of a streaming simulator or mouse while the connect screen is shown, and the simulator publishes facts continuously. A player who started with the simulator cannot reach "Connect Joy-Con" from the menu; a page reload is the only way. Not a blocker, the real-device flow starts from a clean load.

### R3-04 (minor): the dwell counts time inside a target, not rest

`README.md` says "rest the cursor on it for 0.9 s"; the code (and design 12.6, "keep the cursor on the target") measures time inside the target. A slow aim across a mode fruit selects it: with the pointer moving at 750 px/s from (300, 250) to the button "Recalibrate" (960, 975), **Classic was selected at 2282 ms** while the sword moved at 100 to 576 px/s (simulator), and the same with the mouse provider (331 px/s at the moment of selection) and with 375 px/s (`t66_dwell.mjs`, `t67_dwell_trace.mjs`). Deliberate dwell works (Zen 442 ms after arrival, Settings 755 ms, Classic 638 ms; off when "Hold to select" is off). With the real sword a careful, slow aim from the title to the bottom buttons has to cross the Arcade fruit in the middle of the screen. Suggested: gate the dwell timer on blade speed (for example below 150 px/s) so that only rest counts.

### R3-05 (minor): toasts on top of other text

Screenshot `97-menu-after-recenter-space-cursor-on-arcade`: the toast "Crosshair recentered" (centre 960, 200) overlaps the bottom of the title "JOY-CON NINJA" and the tagline "Slice the fruit. Avoid the bombs." in the menu. Screenshot `r3-02-b`: "Calibration complete!" overlaps the Arcade mode title at the start of the countdown. Both are short-lived (0.8 s and 2.5 s).

### R3-06 (minor, UNVERIFIED-ON-HARDWARE): gain refusal is worded as a motion problem

With the fake device reporting |a| of 1.00, 1.08, 1.13 and 0.90 g at rest, step 1 passes (the last three with the warnings `accel_gain_off`; `accelG0` 1.080, 1.130, 0.900 in the calibration), as documented. At 1.18 g and 0.82 g the ring fills, then resets and the text says **"The sensor does not seem to be still. Put the sword down and try again."** for as long as the sensor reads like that (screenshot `50-accelgain-1.18-stuck-step1`). The guide lists both causes, the screen does not. Whether the real Joy-Con 2 is ever this far from 1 g is unknown (UOH-3).

### 1.2 Round-2 findings, re-verified

| ID | Round-2 severity | Status in round 3 |
|---|---|---|
| R2-01 | major | **Half fixed.** Verified fixed: soft centring onto "Arcade" (fake device at rest for 40.6 s in the menu: the cursor slewed from the top edge at 83 px/s to (960, 540) at 11 s and rested on the fruit for 29 s, no round), Space and double click in the menu with the cursor parked elsewhere (6 s, no round, screenshot 97), the pause panel (cursor parked, Space: blade to (961, 541), panel stays, screenshot 98), and the cursor resting on "Recalibrate" in the pause panel for 1.8 s. **Not fixed:** the post-wizard case, now R3-02 |
| R2-02 | minor | **Still open.** "Apprentice" is as wide as the seal (screenshot 23) |
| R2-03 | minor (docs) | **Still open.** `README.md` line 71 ("Calibration runs by itself") and the guide section 6, last bullet ("the whole wizard runs by itself in about 9 seconds"); step 4 waits for a cut and plain `?input=sim` has no wizard |
| R2-04 | minor | **Still open.** Pause, "Recalibrate": `calibration step3` 0.96 s, then `playing resuming` (2.06 s countdown) instead of the pause panel (`t47_ranks_misc.mjs`) |
| QA-01 | (was major) | **Still fixed.** One click is one step for Volume, Sensitivity and Slice threshold, with mouse and simulator (`t04_qa01.mjs`) |
| QA-02 | minor | **Still open.** "So close!" and the near-miss slow motion come 33 to 75 ms before every bomb hit (for example `nearMiss@0.308 slowmo@0.308 bomb@0.342`) |
| QA-03 | minor | **Still open.** Results input is accepted at +1210 ms, ignored at +1190 ms |
| QA-04 | minor | **Still open.** The subtitle "Time slows down" straddles the lower edge of the band (screenshot 59) |
| QA-05 | minor | **Still open.** 3383 ms from the click on a mode fruit to the first frame of play; the Arcade title overlaps the timer ring (screenshot 80, `r3-02-b`) |
| QA-06 | minor | **Still open.** Results buttons straddle the panel border (23, 92), the three disconnect buttons touch each other and the border (69, 75), the pause title sits on the timer ring (11), the small "COMBO" label lands on the big word (56), mode names touch the lower edge of the fruit (97) |
| QA-07 | minor | **Still open.** Mouse provider, menu "Recalibrate": nothing happens (screenshot 50-mouse-recalibrate-click) |
| QA-08 | minor (simulator) | **Still open.** Re-centre with a parked pointer, then a 200 px move: blade (1701, 292) instead of about (1160, 540) |
| QA-09 | minor | **Fixed on the Bluetooth path.** After a failed reconnect the button now reads "Try again in 9 s" and is greyed (screenshot 75); the simulator has no cooldown, so "Try again" is correctly active (screenshot 69) |

---

## 2. Coverage summary

| Area | Result |
|---|---|
| `npm test` | Pass. 919 tests, 919 passed, 0 failed, 0 skipped, 21.9 s at the start and again 22.0 s at the end of the round. The headless-Chrome e2e tests ran (none skipped) |
| Cold start | Pass. Built-in browser pane and private Chrome: safety screen first, all requests to `localhost:8137` and answered 200 (81 in Chrome, 83 lines in the pane), no console message, ready 68 ms after navigation started, no external URL in `public/` (screenshots 01, 02, 03) |
| Safety screen | Pass. Enter and click ignored before 2 s, the "Reduce flashes" toggle works twice, a 1.5 s dwell on the button does not confirm, Enter confirms and stores `safetyAck` |
| Menu | Pass with R3-01, R3-02, R3-04. Cut, click and dwell select modes and buttons; a slow swing of 509 px/s over a mode fruit selects nothing (simulator and mouse); `Enter` starts the default mode; Esc, P and Space in the menu are harmless; a double click on a mode starts one round; clicking Arcade then Zen 60 ms later starts only Arcade |
| Connect screen | Pass with the project's fake Bluetooth device injected in the page: idle, chooser cancelled (no cooldown), connection failure (red line, button "Try again in N s", countdown 10 s, screenshot 35), not-a-Joy-Con (0.46 s), chooser that never answers ("requesting"), connected-but-silent (mask 0xB7, retry with 0xFF at 5.2 s, `no_data` error at 9.8 s), `?filter`, `?mask`, `?side` flags produce the documented requests and command frames, illegal flag values are ignored with a console warning |
| Calibration | Pass. Fake device: step 1 after 2 s, step 2 waits for a real change, poses 30 and 150 degrees away give the "too similar" line and go back to step 1, shaking gives "You moved", step 3 by stillness, step 4 practice apple. With a physically consistent 1 s move between steps 1 and 2 the wizard measures gyro sign +1 with scale 1 (no warning) and sign -1 with `gyro_sign_flipped`. Simulator wizard (three mounts incl. mirrored and alternate scale): frame equal to the simulator's truth within 0.03 degrees. M2: accepted at 0.90, 1.00, 1.08, 1.13 g, refused at 0.82 and 1.18 g (R3-06). "Flip left and right" on the practice screen flips the horizontal direction (+40 dps for 0.2 s: -233 px before, +219 px after), is saved, and leaves the vertical direction alone |
| M3, sensor conventions per provider | Pass. Saved diagnostics values (`joyconNinja.imu.v1` with gyroScale 2 or 0.5 and accelSign -1) do not change the simulator, started by `?input=sim` or by the connect-screen button: blade follows the mouse within 10 px, `accelSign` 1, `gyroScale` 1, `simSwing` cuts |
| Modes | Pass. Classic, Arcade and Zen each played start to finish (section 5.1) |
| Scoring, combos, lives, timers, bombs, power-ups | Pass against the design tables (section 3), except QA-02 |
| Pause and resume | Pass except R2-04. P, Esc, middle click; "Resume" and Enter resume with the 3-2-1 countdown (2.16 s); the world is frozen while paused; window blur pauses in play and during the countdown and does not resume by itself; a hidden tab (visibilitychange) pauses and stays paused; 12 presses of P end in a consistent state; "Settings" then "Back" returns to the pause panel; "Quit to menu" asks first, Esc in the dialog goes back |
| Game over, results, records | Pass except QA-03 and R2-02. Classic with no cutting: lives 3 to 2 at 2.9 s, to 1 at 5.1 s, game over at 6.7 s, slow motion, results; "NEW RECORD!" only for a strictly greater score (Zen 60, equal 60, lower 30, higher 90); records survive a reload; break banner after 10 minutes of session play (round 10 at 643 s, not round 9 at 576 s); Classic soft-break toast at 6:00 |
| Storage failure | Pass. `Storage` throwing on every call: menu, settings in memory, a full Arcade round to the results screen (score 4815), no console output. Corrupted JSON boots to the safety screen with defaults. Out-of-range stored settings are clamped (2.0, 400, 100%) |
| Window resize | Pass. 1920x1080, 1280x720, 1024x768, 800x600, 600x1000, 360x640, 2560x1080, 1440x900 at DPR 2, 1920x1080 at DPR 2 and a 240x120 window (plays at 59.7 fps), plus live resizes during play (1000x700, 700x900, 1600x900, 1920x1080): aspect-fit with ink bars, no page scroll, 59.9 to 60.5 fps, no console message. The 3840x2160 step of `t14_resize.mjs` closed the DevTools socket of the script (see section 7); DPR 2 at 1920x1080 has the same 3840x2160 backing store and ran fine |
| Settings | Pass. Every control changes and persists; limits clamp at 0.5 to 2.0, 400 to 2400 and 0 to 100 percent; "Reset high scores" with Esc (nothing cleared) and with the confirm button (cleared); Esc goes back; `prefers-reduced-motion: reduce` makes `reduceMotion` default true |
| Disconnect and reconnect | Pass with QA-09 fixed. Simulator: loss pauses under the overlay and freezes the world (3.50 s before and during the loss, 3.55 s after recovery), failed phase with three buttons, recovery gives quick re-centre and the resume countdown (4.7 s in total). Bluetooth provider with the fake device: drop, automatic reconnect at 2.0 s, streaming again at 2.7 s, resume countdown, play continues; failed reconnect shows "Try again in 9 s" greyed; "Continue with the mouse" switches to the mouse provider and resumes with a countdown (2.2 s); "Back to menu" goes to the menu with the provider idle |
| Sustained play, frame rate, memory | Pass (section 5.3) |
| Input latency, simulator path | Pass with a note (section 5.4) |
| Fast-swing tunnelling | Pass (section 5.5) |
| Determinism | Pass. Same seed and the same scripted swings: identical snapshot hashes for 30 s (simulator, Classic, 150 hashes) and 20 s (mouse, Arcade, 110 hashes) in two separate page loads; a different seed differs |
| Diagnostics page | Pass. `diagnostics.html?input=sim`: raw packet, converted accelerometer and gyro values, |a| 1.0025 g, 66.0 Hz packet rate with histogram, battery 3700 mV "ok", side and name; no console message, no external request (screenshot 77). Following its game link from the connect screen leaves the game's provider idle |
| Server and launcher | Pass. Static files 200 with the right MIME types; `/nope`, `/.git/config`, a directory and `%2e%2e` 404; `..%2f`, `//etc/passwd` and a NUL byte 400; POST 405; `Host: evil.example` 403; loopback only (`127.0.0.1:8137`); CSP header present. No `node_modules`, no `dependencies`. `start.command`: `bash -n` passes and its shim-based test is part of the green `npm test`; the real launcher was **not** run (it would open the owner's Chrome) |
| Wake lock | Pass. Requested when a round starts, held while paused, released at results and menu; a fake wake-lock object saw `request:screen` then `release` |
| Console | No error and no exception in any run. Only warnings that the tests provoke on purpose (cancelled chooser, failed connection, not-a-Joy-Con, no data, simulated link loss, three illegal flags). `?debug=1` (contract validation of every sample, status, snapshot and event) gave no violation |
| Audio | Partly checked. No `AudioContext` before the first click, created and running after it (`masterGain` 0.392 at volume 0.7), voices `slice` and `comboChime` on a cut, key `M` sets `muted` and `masterGain` 0, no errors. Nothing was listened to |

---

## 3. Rules checked against `docs/game-design.md`

Read back through `window.__ninja.snapshot()` and its events on the manual clock (`?clock=manual`), private headless Chrome. **93 checks, 93 pass** (`run_rules.mjs`; the page scripts are in `docs/qa/round-3/scripts/`).

| Rule (design section) | Expected | Observed |
|---|---|---|
| Base score, radius, hit radius of the 10 fruit (4.1) | 10/10/15/15/15/15/20/20/25/30; hit radius 1.25 x r | 10 of 10 exact (watermelon r 92, hit 115; cherry r 48, hit 60) |
| Combo bonus (5.4) | 5 n (n - 1), cap n = 10 | n = 2 to 12 in one swing: totals 70, 120, 180, 250, 330, 420, 520, 630, 750, 780, 810 with cherries (bonus 10 to 450) |
| Double (4.4) | Doubles fruit points and combo bonus, 10 s, refresh, no stacking, penalty not doubled | n = 2 to 12 exactly doubled (140 to 1620); 9.8 s at pick-up, 0.77 s left after 9 s, second medallion back to 9.78 s with one entry, bomb still -50 |
| Combo window (5.4) | 250 ms or less joins | 208 and 242 ms joined (70), 258 and 308 ms did not (60) |
| Golden apple (4.2, 6) | +100, member of combos; Classic +1 life below 3; Arcade +3 s; Zen score only | cherry + golden + cherry = 190; Classic 2 to 3 lives, stays 3 at 3; Arcade +3.00 s; Zen +100, time unchanged; doubled 200; slow motion 0.4 for 350 ms |
| Cut threshold (5.2, 14) | 1000 px/s inclusive, Zen x0.8 | Classic and Arcade: 900 and 990 no, 1010 and 1100 yes; Zen 790 no, 810 yes |
| Bomb (4.3, 5.3, 6, 7.1, 7.2) | Slow contact never explodes; Classic -1 life and keeps earlier combo; Arcade -50 (floor 0) and -5 s | 500 px/s contact: nothing; Classic 3 to 2 lives; 3 cherries then a bomb kept the +30 combo (120); Arcade -50 and -5.3 s (0.3 s of play included), 0 stays 0, at 4.6 s left the round ends with phase `ending`, reason `timer`. Near miss 60 and 100 px away, nothing at 130 px, hit at 30 and 45 px (but see QA-02) |
| Lives and mercy (7.1) | 3 misses within 1.2 s cost 1 life; a bomb always costs one | 3 simultaneous misses: 3 to 2; a miss after the window: 2 to 1; a bomb inside the window: one more life; 3 spaced misses: results |
| Life regeneration (7.1) | +1 per 25 fruit, max 3, bomb resets | 24 cuts progress 24, the 25th restores a life; 20 cuts, bomb, 24 cuts: no life, the 25th: +1 |
| Timers (7.2, 7.3) | Arcade 60 s, Zen 90 s, no Classic timer, pause freezes | Arcade 59, 50, 10 s at 1, 10, 50 s, ends at 0 with phase `ending`, results within 2.5 s; Zen 89 s at 1 s, ends at 0; Classic `timeLeft` null; pause froze and resume continued |
| Freeze (4.4, 2.2) | timeScale 0.40 for 5 s real; timers unaffected; eased | 0.40 during the effect; in 2.0 s real the round timer moved 2.00 s and the world 0.80 s; ease out 0.40, 0.74, 1.00; gone at 5 s |
| Clock (4.4, 7.2) | +4 s, remaining time capped at 90 s | +3.983 s against a control round with the same timing (`t47_ranks_misc.mjs`); 12 medallions in a row: 89.52 s |
| Frenzy (3.4, 4.4) | 6 s, waves about 0.42 s apart, no bombs, cap 16 | 5.8 s at pick-up; 14 waves, gaps 0.38 to 0.45 s; no bomb; at most 13 uncut fruit; gone after 6 s |
| Stages and first wave (3) | First wave 0.8 s after "GO!"; stage boundaries | Arcade 15.3, 30.1, 46.1 s; Zen 31.1, 60.2 s; Classic 20.8, 45.6, 75.8, 106.1, 140.6, 180.6, 240.2 s; first wave at 0.8 s in every mode; no spawn outside x 100 to 1820; no bomb in Zen; first bomb 8.4 s (Arcade) and 66.9 s (Classic) |
| Hand setting (14) | Spawn bands shifted by 80 px toward the hand | Same seed, 121 fruit: mean apex x 985 (right) and 884 (left) |
| High score (7.4, 7.5) | Strictly greater only, stored per mode | 60, equal 60 (date unchanged), lower 30 (unchanged), 90 (updated) |

---

## 4. Screens, flows and visuals

Judged from screenshots (real Chrome 154 on macOS, 1920x1080 unless the name says otherwise): safety, menu (first visit, with records, after a re-centre), settings (defaults, both limits, changed), countdown, HUD in the three modes, combo banner with stars, bomb with danger ring and explosion, Double, Freeze, Frenzy and Clock banners and tray icons, golden apple on screen and cut, Arcade last 10 seconds and "Time's up!", pause, resume countdown, quit dialog, reset dialog, results (with and without "NEW RECORD!", with the break banner), connect screen (idle, cancelled, failed, cooldown), the four calibration steps and their feedback lines, the practice screen with the new notice and the "Flip left and right" button, the disconnect overlay (waiting and failed, simulator and Bluetooth), the diagnostics page and the debug overlay. Apart from the findings above no new rendering defect was seen. The in-game text is English everywhere, `lang="en"` is set, the tab has a title and an icon.

---

## 5. Modes played, performance and latency

### 5.1 Modes played to the end (scripted swings, manual clock, simulator provider)

Same seeds as round 2: the numbers are identical, so the round-2 changes did not touch the game rules.

| Round | Result |
|---|---|
| Arcade, seed 11, accurate bot | 186 fruit cut, 0 missed, score 4525 (rank "Legend"), 4 stages, 62 waves, 7 bombs spawned and avoided, 4 power-ups (one of each), ended by the timer at 68.3 s (two time bonuses), record stored |
| Zen, seed 12, accurate bot | 159 fruit cut, score 3405, ended at 90.6 s, 3 stages, no bomb, 2 power-ups |
| Classic, seed 13, 300 s | 684 fruit cut, score 17315, all 8 stages, 3 lives throughout, 29 bomb telegraphs, 10 power-ups; when the bot stopped the round ended by lives after 14 misses |
| Classic, no cutting, real clock | First life lost at 2.9 s, second at 5.1 s, game over at 6.7 s, then the game-over sequence and results |
| Zen and Arcade, no cutting (seed 7) | Both end by the timer with score 0 and no penalty: Arcade 152 fruit missed, Zen 125 missed |
| Real-time bot rounds | In the 7.2 minute run below: Arcade 73 s, 4430 points; Zen 91 s, 3415; Classic 100 s, 3670 (ended by the script); Arcade 75 s, 4840 |

Also played in the built-in browser pane (manual clock, since the pane is hidden): an Arcade round with 25 cuts, a Double medallion and a combo x2 (screenshot 02-builtin-pane).

### 5.2 Score economy remark

As before: an accurate bot reaches the top rank quickly (Arcade 4525 against 3200, Classic 7000 in about 140 s). The design calls the ranks untuned; this is tuning data, not a defect.

### 5.3 Frame rate and memory (real clock, headless Chrome 154, simulator provider, a real-time bot; no other test run was active, machine load average about 2 from unrelated applications)

| Run | Frames | Mean fps | p50 / p99.9 / max frame | Frames over 20 / 33 / 50 ms | Memory |
|---|---|---|---|---|---|
| Classic 206 s, 1920x1080 at DPR 1 (bot about 330 swings) | 12365 | 60.00 | 16.7 / 16.8 / 16.8 ms | 0 / 0 / 0 | JS heap after forced GC 3.87 MB at 20 s, 4.23 MB at 100 s, 4.15 MB at the end; sampled heap 6.55 MB (first fifth), 7.39 MB (last fifth), peak 8.9 MB; counters bounded (objects 2 to 9, halves 0 to 19, log 32, outbox 0); lowest 5 s sample 59.7 fps |
| 7.2 minutes, DPR 2 (3840x2160 backing store), Arcade, Zen, Classic, Arcade, Zen | 25884 | 60.00 | 16.7 / 16.8 / 16.8 ms | 0 / 0 / 0 | JS heap after forced GC 3.97 MB; renderer RSS 201 MB at 21 s, 227 MB at 81 s, 238 MB at 172 s, 246 MB from 353 s to the end (first third 220, middle 239, last third 245); fps between 59.8 and 60.5 in every 15 s sample; auto-degrade level 0 throughout |

The JavaScript heap is flat and the game's own collections are bounded: no sign of a leak in 206 s and 7.2 minutes. The renderer's resident memory grows while new content appears for the first time and flattens at about 246 MB. This is headless Chrome on the development Mac; 60 fps on the owner's MacBook, the real GPU and a Retina display are **UNVERIFIED-ON-HARDWARE**.

### 5.4 Input latency of the simulator path

Synthetic `PointerEvent`s at 125 Hz (12 events, 40 px steps), time from the first event to the first animation frame in which the blade moved more than 4 px (quantised to whole 16.7 ms frames).

| Provider | Trials | Mean | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| Simulator, 66 Hz packets (default) | 40 | 20.7 ms | 17.2 ms | 34.2 ms | n/a | 35.3 ms |
| Simulator, 66 Hz, second run | 120 | 21.4 ms | 17.1 ms | 34.6 ms | 36.5 ms | 48.6 ms (none over 50, one over 40) |
| Simulator, 250 Hz packets | 40 | 16.6 ms | 16.6 ms | 18.4 ms | n/a | 18.5 ms |
| Plain mouse | 40 | 16.5 ms | 16.5 ms | 18.8 ms | n/a | 19.0 ms |

The game's own `getPerf().inputToDrawMs` read 10.5 ms (simulator 66 Hz), 14.6 ms (250 Hz) and 11.9 ms (mouse). All are below the 50 ms target. They exclude the display and, above all, the Bluetooth link: the 50 ms budget on the real device is **UNVERIFIED-ON-HARDWARE** (HW-1).

### 5.5 Fast-swing tunnelling

A row of 8 fruit 200 px apart (cherries, hit radius 60, and watermelons, hit radius 115) swept by `__ninja.swing`, mouse and simulator providers give identical results:

| Swing speed (px/s) | Cherries cut | Watermelons cut |
|---|---|---|
| 5000, 10000, 20000, 40000, 55000, 59000 | 8 of 8, in order | 8 of 8, in order |
| 3000 | 6 of 8 | 8 of 8 (the swing takes 0.57 s and the fruit fall out of the line: not tunnelling) |
| 1500 | 2 of 8 | 3 of 8 (same reason) |
| 65000 and 100000 | 0 | 0 (dropped by the 60000 px/s safety cap, design 5.1) |

Through the complete simulated sensor chain (`simSwing`: mouse model, packet bytes, parser, fusion) at 66 and 250 Hz: 3 of 8 cherries and 7 of 8 watermelons at 3000 px/s (same reason as above) and 8 of 8 of both at 6000, 10000, 20000 and 30000 px/s (measured peak 26000 to 28000). A single cherry crossed at 30000 px/s from 12 angles was cut 12 of 12 times. With real trusted mouse events (about 30 Hz) a sweep of 3869 px/s cut 3 of 3 watermelons, 1176 px/s cut 1 of 3 and 406 px/s cut none. No tunnelling up to the safety cap.

---

## 6. How the testing was done, and what could not be run

- **Built-in browser pane.** Tool tab `tab-2` (own tab; the two tabs that already existed were left alone) loaded `http://localhost:8137/?input=sim`: cold start, safety screen, console (empty) and network list (all `localhost`, all 200), and a scripted Arcade round on the manual clock with a screenshot. As in rounds 1 and 2 the pane is hidden (`document.hidden` true, `innerHeight` 0), so the page runs at about 1 frame per second and real-time behaviour cannot be judged there; no tool can show the pane.
- **Private headless Google Chrome 154** for everything in real time. `launch.mjs` starts it with a fresh profile folder and an operating-system assigned DevTools port; the scripts create and drive only their own tabs. The owner's Chrome was never contacted. Storage was cleared before every page except where a test needed it.
- **Input.** Clicks, key presses and most pointer moves are real (trusted) DevTools events (about 30 Hz). Fast bulk motion uses synthetic `PointerEvent`s at 125 Hz or `__ninja.swing`, `swingThrough` and `simSwing`. After a `swing` under the simulator provider the virtual sword returns to its own pointing direction; the scripts account for that.
- **Web Bluetooth.** No Joy-Con and no chooser UI. The real `navigator.bluetooth.requestDevice` was never called (in round 1 it killed a headless Chrome). Connect, calibration, disconnect and the R3-02 reproduction ran through the **real game code** (BLE provider, packet parser, motion pipeline, UI) against `test-support/input/fake-bluetooth.js` injected into the page by `fakebt.mjs`. That fake models `docs/joycon2-protocol.md`; a pass proves conformance to the document, never to a physical Joy-Con.
- **Screenshots.** PNG from `Page.captureScreenshot`, converted to JPEG; under the manual clock `__ninja.debug.draw()` paints the frame first.
- **Not run:** the real `?input=joycon` device path, pairing, real drift and tremor, the real cursor feel and whether the practice swing of R3-02 ends where the scripted one does, sword comfort, the display and GPU of the owner's Mac, macOS idle and Bluetooth prompts, audio by ear, the real `start.command`, Retina rendering on a real GPU. Colour contrast and visual polish were judged by eye.

### UNVERIFIED-ON-HARDWARE reminders

Everything that touches the physical controller was not tested and is not claimed: pairing steps and cooldown (HW-4, HW-5), BLE latency and packet rate (HW-1), gyro scale, sign and saturation (HW-10, HW-11), accelerometer gain and sign (UOH-3, UOH-20), yaw drift and soft centring (HW-3), the two-pose mount calibration with real hands (HW-7), battery reading (HW-8), button reachability (HW-6), the 1000 px/s threshold against real tremor (HW-9), sword comfort (HW-12), the screen wake lock and the Mac's idle timings, and 60 fps on the owner's MacBook. The mechanisms of R3-01 and R3-02 are certain from the code and were reproduced; how often a real swing ends on the Arcade fruit is not known.

---

## 7. Process note

- Before starting, running processes and listening ports were listed; the owner's Chrome and another local Python server were not touched. Started by QA: `npm test` (at the start and at the end), `node server.js` on port 8137, one private Chrome (relaunched once, see below). The private Chrome and the game server were stopped at the end (nothing listens on port 8137 any more).
- **The first private Chrome died by itself** while a script was waiting in its last step (no crash report was written, cause unknown; another agent was running `npm test` with its own headless Chromes at that time, which do not touch other profiles). The script was re-run on a new private Chrome with the same result as the earlier steps. A second, unrelated `CDP connection closed` came at the 3840x2160 step of `t14_resize.mjs` (the Chrome process was still alive; most likely an oversized screenshot message for the script's DevTools socket); that step was not repeated because the same backing store ran at DPR 2.
- A parallel agent wrote `docs/code-review-round-3.md` while this round ran; it does not mention the dwell findings above. No project file other than that one changed, and QA changed none.

## 8. Suggested checks for round 4

1. R3-01: connect screen, "Simulator", mouse untouched: the menu stays for 10 s. Same from menu, "Connection", "Simulator" (R3-03 must be fixed first for the simulator case).
2. R3-02: `t57_trace_after_cal.mjs`, `t56_after_cal_rest.mjs` and `t68_simcal_mouse_tail.mjs`: no round may start after the wizard, whatever the swing's end point; a deliberate dwell (move onto a target by hand, rest 0.9 s) must still start it (`t66_dwell.mjs`: 442, 755 and 638 ms).
3. R3-04 if taken up: a pointer crossing Classic at 300 to 600 px/s must not select it.
4. R2-02 to R2-04, QA-02 to QA-08 if they are taken up.
5. Re-run `npm test` (919 expected), `run_rules.mjs` (93 of 93) and `t29_sustained.mjs`.
6. On the real machine: follow the setup guide and the diagnostics page to turn the UNVERIFIED-ON-HARDWARE items into facts, and watch the menu right after the first calibration with the real sword.

## 9. Screenshot index (`docs/qa/round-3/`)

| File | Shows |
|---|---|
| 01, 02-builtin-pane-* | Built-in browser pane: cold start safety screen; Arcade round driven on the manual clock (Double, combo x2) |
| 02-cold-start-safety-locked, 03, 06 | Safety screen locked, unlocked, "Reduce flashes" on |
| 04, 05, 07 | Menu (mouse), settings, menu (simulator) |
| 08, 09, 10 | Countdown "3" and "2", first seconds of play |
| 11 to 15 | Pause panel, resume countdown, quit dialog, pause after a window blur, quit dialog again |
| 16, 17 | First life lost with the first-run tip; game over in slow motion |
| 18, 19, 22, 23 | Results (count-up, settled, real-time bot, "NEW RECORD!" with the "Apprentice" seal, R2-02) |
| 20, 21, 24, 25 | Menu with a stored record, and after reload |
| 26 to 29 | Settings at both limits, settings changed, reset-records dialog, menu after reset |
| 30-* | Resize matrix: 1024x768, 1280x720, 1920x1080, 2560x1080, 360x640, 600x1000, 800x600 |
| r3-08, r3-09 | Live resize during play (700x900); re-centre toast during play |
| 32 to 35, 100 to 102 | Connect screen: idle, cancelled, failed, cooldown countdown; not a Joy-Con, chooser pending, connected but silent |
| 36 to 43 | Calibration with the fake device: start, step 2 waiting, unchanged pose, pose 2 reached, step 4 practice with the `gyro sign undetermined` notice and "Redo", 30 and 150 degrees, step 1 moved |
| 46 to 49, 50-mouse-recalibrate-click | Simulator wizard step 4 for three mounts; after the wizard; plain mouse "Recalibrate" does nothing (QA-07) |
| 50-accelgain-* | M2: step 2 reached at gain 1, 1.08, 1.13, 0.9; stuck at step 1 at 1.18 and 0.82 (R3-06) |
| 52-after-sim-click, 52-after-mouse-click, r3-01-a, b, c | R3-01: connect screen, menu with the dwell arc 0.45 s after the click, Arcade cut and countdown with no click |
| r3-02-a, b, c | R3-02: menu just after the practice cut with the cursor on Arcade, dwell arc / Arcade cut with the toast "Calibration complete!", countdown |
| 55-connection-sim, -mouse | R3-03: "Connection" with the simulator and the mouse provider |
| 53 to 57 | Bomb with danger ring, explosion with "So close!" and "BOMB!" (QA-02), aftermath, combo x4 banner with the "COMBO" label collision (QA-06), later |
| 58 to 62 | Double, Freeze (QA-04), Frenzy, Frenzy active, Clock banners |
| 63, 64 | Golden apple on screen and cut |
| 65, 66 | Arcade last 10 seconds, "Time's up!" |
| 67 to 70 | Simulated link loss: overlay, after 9 s, failed phase (QA-06), recovery re-centring |
| 71 to 76 | Bluetooth provider (fake device): drop overlay, after recovery, failed phase with cooldown, later, before and after three "Try again" clicks (QA-09 fixed) |
| r3-63-after-mouse, r3-63-after-menu | After "Continue with the mouse" and "Back to menu" |
| 77 | Diagnostics page with the simulator |
| 78 | Sustained play at 100 s |
| 80, 81 | Arcade countdown with the title over the timer ring (QA-05) and first frame of play |
| 82 | Debug overlay (`?debug=1`) in Arcade |
| 83 to 89 | Records: Arcade runs 1 to 3; Zen 60, equal 60, lower 30, higher 90 |
| 90 | Classic at 6:00 with the soft-break toast |
| 91, 92-* | Results with the 10-minute break banner; rounds 9 (no banner), 10 and 11 of one session |
| 93, 94 | Connect screen while streaming; after the diagnostics link was clicked |
| 95, 96 | Bomb with reduced flash and motion, and normal |
| 97 (space, dblclick), 98 | Menu and pause panel after a manual re-centre (R2-01 fixed; toast over the title, R3-05) |
| 99-rank-seal-* | Rank seals Warrior, Ninja, Master, Legend |
| r3-flipx-a, b | Practice screen before and after "Flip left and right" |
| r3-62-smooth-wizard-* | Practice screen after a physically consistent wizard (normal and mirrored gyro) |
| arcade-s11-*, zen-s12-*, classic-s13-* | Mode runs at 10 to 242 s and their results screens |

## 10. Scripts (`docs/qa/round-3/scripts/`)

Not part of the product and not run by `npm test`. The folder holds the round-2 scripts (`lib.mjs` with the screenshot folder switched to `round-3`, `launch.mjs`, `fakebt.mjs`, `blehelp.mjs`, `run_rules.mjs`, `t01` to `t49`) and the new round-3 ones. To re-run: copy the folder outside the project (`launch.mjs` creates a `./profile` folder next to itself), start the game with `node server.js`, run `node launch.mjs`, then a script.

- `run_rules.mjs` with `EXTRA=rules2_page.js,rules3_page.js` and `baseScores combos combos:true comboWindow threshold golden bombs livesTest regen timers powerups frenzy`: the 93 rule checks of section 3. `t08_modes.mjs <mode> <seed> <seconds> <tag>`: a mode played with the bot. `t29_sustained.mjs 200`, `t36_long.mjs 420 2`, `t30_latency.mjs`, `t30b.mjs`, `t31_tunnel.mjs`, `t31b_simswing.mjs`: performance, latency, tunnelling.
- New in round 3: `t50_accelgain.mjs` (M2 gains), `t51_savedimu.mjs` (M3), `t52_simbtn.mjs`, `t53_bootcursor.mjs`, `t54_provider_switch.mjs`, `t59_evidence.mjs` (R3-01), `t55_connection.mjs` (R3-03), `t56_after_cal_rest.mjs`, `t57_trace_after_cal.mjs`, `t58_simcal_tail.mjs`, `t68_simcal_mouse_tail.mjs` (R3-02), `t60_edge.mjs` (edge cases: double click, blur, hidden tab, key spam, reduced motion, tiny window, live resize), `t61_flipx.mjs`, `t62_smooth_wizard.mjs`, `t63_disc_buttons.mjs`, `t64_safety_click.mjs`, `t65_determinism.mjs`, `t66_dwell.mjs`, `t67_dwell_trace.mjs` (R3-04). `t33_wakelock.mjs` had its API name corrected (`__ninja.debug.forceScreen`).
