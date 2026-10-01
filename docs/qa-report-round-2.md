# Joy-Con Ninja: QA report, validation round 2

| Item | Value |
|---|---|
| Role | QA tester, black-box, player's view |
| Date | 2026-09-30 |
| Build under test | `joycon-ninja` 0.1.0 after the round-1 fixes, served by `node server.js` on `http://localhost:8137` (no project code was modified by QA) |
| Reference documents | `docs/game-design.md` (numbers and rules), `README.md`, `docs/setup-and-calibration-guide.md`, `docs/architecture.md` section 9.8 (`window.__ninja`), `docs/qa-report-round-1.md` |
| Language | This report and all project documents are in English (owner request). In-game text is English as well |
| **Verdict** | **FAIL** (1 major, 11 minor, 0 critical) |

The verdict follows the round rule "fail if any critical or major finding exists". The major finding of round 1 (QA-01, one click on a Settings stepper changed the value twice) is **fixed**. One new major finding was made (R2-01): with a real Joy-Con the automatic soft re-centring drags the resting cursor onto the "Arcade" fruit in the menu, and the dwell selection then starts an Arcade round by itself. It was reproduced through the real Bluetooth provider, motion pipeline and UI with a software model of the device, so the size of the effect on the real controller is **UNVERIFIED-ON-HARDWARE**, but the mechanism is certain from the code.

Everything else that was checked against `docs/game-design.md` behaved as specified: 93 scripted rule checks all pass, `npm test` is fully green (893 of 893), and the game held 60.0 frames per second with no frame above 20 ms in every run of up to 25 minutes, with a flat JavaScript heap. None of the eight minor findings of round 1 was fixed (they were not in the fixer's scope): they are re-verified below with unchanged numbers.

Nothing in this report was verified on a physical Joy-Con 2. Everything about the real device stays **UNVERIFIED-ON-HARDWARE** (see the reminders at the end of section 6).

---

## 1. Findings

Severity: **critical** = crash, unplayable, data loss, wrong core rule. **major** = clearly wrong behaviour or bad experience. **minor** = polish. "Screenshot" numbers refer to `docs/qa/round-2/` (section 9).

### 1.1 New findings of round 2

| ID | Severity | Title |
|---|---|---|
| R2-01 | **major** | Soft re-centring slides a resting cursor onto the "Arcade" fruit and dwell then starts an Arcade round by itself (real Joy-Con path; UNVERIFIED-ON-HARDWARE in size) |
| R2-02 | minor | Rank word "Apprentice" is wider than its seal and runs over the seal's inner border |
| R2-03 | minor | README and setup guide say the simulator's calibration "runs by itself"; step 4 waits for the player to cut the practice apple |
| R2-04 | minor | Pause panel, "Recalibrate": after the quick re-centre the round resumes (with the 2.1 s countdown) instead of returning to the pause panel as design 12.1 says |

### 1.2 Round-1 findings, re-verified

| ID | Round-1 severity | Status in round 2 |
|---|---|---|
| QA-01 | major | **Fixed.** One click is exactly one step (evidence below) |
| QA-02 | minor | **Still open.** "So close!" and the near-miss slow motion still come 33 to 75 ms before every actual bomb hit |
| QA-03 | minor | **Still open.** Results buttons accept input 1.2 s after the results screen starts, not after the panel is fully visible |
| QA-04 | minor | **Still open.** Banner subtitles still straddle the band edge (Freeze, Frenzy, Double) |
| QA-05 | minor | **Still open.** Countdown is 3.0 s after the selection (design 4.0 s) and the Arcade/Zen title still overlaps the timer ring and its "TIME" label |
| QA-06 | minor | **Still open.** Same layout collisions (results buttons, disconnect panel, menu names, combo label, pause title over the timer ring) |
| QA-07 | minor | **Still open.** "Recalibrate" gives no feedback with the plain mouse provider |
| QA-08 | minor (simulator only) | **Still open.** A manual re-centre does not stick after a pointer pause |
| QA-09 | minor | **Still open, and now also seen on the real Bluetooth provider path.** "Try again" looks enabled while its clicks are ignored during the cooldown; no cooldown text is shown |

### R2-01 (major): the resting cursor is dragged onto "Arcade" and dwell starts a round

- **What happens.** With a Bluetooth Joy-Con the setting "Auto-recenter" (default on) slews the cursor to the screen centre at 3 degrees per second (about 82 px/s) after the sword has rested for 1 s. The code gates it only by provider kind (`app.js` line 168: `autoCenter: s.autoCenter && provider?.kind !== 'sim'`), by cutting and by edge slip (`motion/aim.js` lines 135 to 160), so it runs on every screen, the menu included. The menu's "Arcade" fruit is centred on the very same point (960, 540, radius 170). The menu dwell arms as soon as the cursor is over no target (`ui/ui.js` lines 1051 to 1064) and then starts the 0.9 s timer for whatever target the cursor enters, also when the cursor entered it because of the slew. Result: a player who simply rests the sword in the menu gets an Arcade round.
- **Expected.** Design 12.6: a mode is selected by a cut, a click or by keeping the cursor on the target on purpose. Nothing may start because the reference drifted.
- **Repro (real Bluetooth provider and motion pipeline, fake device).** Script `docs/qa/round-2/scripts/t23_consistent.mjs` (needs `node server.js` and `node launch.mjs`, see the header of `lib.mjs`). It connects the project's own fake Joy-Con (`test-support/input/fake-bluetooth.js`, injected in the page), streams a physically consistent IMU signal (gravity follows the integrated pitch), runs the four calibration steps, cuts the practice apple, moves the cursor to the top edge of the menu and then keeps the device perfectly still. Observed cursor y and screen: 0 for about 4 s (the raw aim was beyond the edge, so the reference first had to slew back), then 69, 152, 236, 319, 402 at one-second steps (83 px/s, exactly the design's 3 degrees per second), the cursor enters the Arcade fruit at y of about 370 and **the Arcade countdown starts 9.9 s after the last movement** with nobody having done anything (`ROUND STARTED BY ITSELF after 9893 ms of resting in the menu: countdown [arcade]`). Settings at the time: `autoCenter` true, `dwellSelect` true (both defaults).
- **Second trigger, right after calibration.** The practice apple of calibration step 4 has its apex at (960, 400), inside the Arcade fruit's circle, so the cursor is likely to be on "Arcade" when the menu appears after the wizard. With the fake device the Arcade countdown started about 0.9 s after the wizard ended in one run, because the cursor rested at (960, 427) to (960, 460) after the practice cut. (With the simulator the same happened in a scripted run, but there the scripted swing had left the blade at the centre, so that one is only indicative.)
- **Repro with the simulator (no device needed).** The simulator has soft centring switched off, but its manual re-centre lands on the same point. `?input=sim`, menu, park the mouse at an empty spot (701, 92) for 1.5 s, press Space: the cursor eases to the centre and the Arcade countdown starts **1.04 s after the key press** (`menu`, then `countdown [arcade]`, blade at (960, 519); screenshot 97). The real Joy-Con has the same manual re-centre on several buttons, and the same result is expected (UNVERIFIED-ON-HARDWARE).
- **The team has met this family of bug before.** `docs/contract-notes.md` (entries about the dwell arming rule, around lines 315 and 385) records that the boot cursor sitting on the centre fruit used to start Arcade after 0.9 s and that only the "no cursor yet" case was fixed. A cursor that arrives on the centre by soft centring or by a re-centre is the remaining path.
- **Also affected: the pause panel.** Its centre lies on "Recalibrate" (960, 540). Simulator, Zen round paused with the cursor parked at (298, 286), Space pressed: the cursor goes to the centre, **1.13 s later the quick re-centre starts by itself and 1.4 s after that the round continues** (`paused`, `calibration step3` at 1.13 s, `playing` at 2.58 s; screenshot 98). A player who re-centres while paused loses the pause. Settings, results and connect are not affected (no target at the centre, or no dwell).
- **Impact.** The most natural behaviour in the menu (lower the arm, read, wait) starts a round the player did not choose; in the first minutes of a real session this will happen at once after every calibration and every return to the menu unless the player keeps the cursor moving. The player can pause and quit, so nothing is lost, but it breaks the "fair failure" and "accidental menu selections at most 1 per 20 minutes" targets of design 1.4. The real drift, rest threshold and sensitivity are UNVERIFIED-ON-HARDWARE (HW-3), the interaction itself is not.
- **Suggested directions.** Do not run soft centring outside `playing`, `countdown` and calibration; or keep dwell disarmed while the cursor is being slewed or re-centred and until the player moves it by hand; or move the "Arcade" fruit and the pause buttons off the centre.

### R2-02 (minor): rank word overflows its seal

The results seal shows the rank in the display serif at a fixed size. "Apprentice" (the lowest rank, seen by every new player) is as wide as the whole seal and touches or crosses the white inner frame on both sides (screenshots 23 and 87, zoom of screenshot 23). The other ranks fit comfortably: "Warrior", "Ninja", "Master" and "Legend" were forced with scripted Zen scores of 600, 1200, 1920 and 2610 (screenshots 99).

### R2-03 (minor, documentation): the simulator wizard does not finish by itself

`README.md` ("Calibration runs by itself (scripted sword)") and `docs/setup-and-calibration-guide.md` section 6 ("With the simulator provider the whole wizard runs by itself in about 9 seconds") are not exact. With `?input=sim&simcal=1` or the menu button "Recalibrate" steps 1 to 3 run by themselves and step 4 starts after 8.4 s, then it waits for the player to cut the practice apple (a "Redo" hint appears after 20 s). With plain `?input=sim` there is no wizard at all (the exact nominal calibration is installed, as code review m9 already said in round 1 and again in `docs/code-review-round-2.md`, where it is still open).

### R2-04 (minor): "Recalibrate" on the pause panel resumes the round

Design 12.1 and 12.9: from `paused`, "Recalibrate" runs the quick re-centre only and then goes back to `paused`. Observed with trusted clicks (simulator, Zen): pause, click "Recalibrate", `calibration step 3` for 0.9 s, then `playing` with the resume countdown (`resuming`, 2.16 s) and the round continues; the pause panel is not shown again. It may be a deliberate choice (the round continues after a short countdown) but it differs from the design table and is not in `docs/contract-notes.md`; the guide says only that "Recalibrate" does the quick re-centre. The other pause buttons behave as designed: "Settings" then "Back" returns to the pause panel, "Quit to menu" asks for confirmation, Esc in the dialog returns to the panel.

### QA-01 (was major): now fixed

Real trusted mouse clicks through the DevTools protocol, dwell on (default), pointer left resting on the button:

| Provider | Control | Result |
|---|---|---|
| mouse and simulator | Volume +, Volume -, Sensitivity +, -, Slice threshold +, - | exactly one step each time; the value did not change again during the following 1.6 s |

Repeated 5 more times for the simulator's Volume "+" and 12 times in a second script: every click is one step. One single click in the very first simulator trial of the day produced no step at all (volume stayed 0.3); it could not be reproduced in 17 further trials and two complete re-runs, so it is mentioned but not counted as a finding.

### Round-1 findings that are unchanged (evidence)

- **QA-02.** Manual clock, bomb at (960, 450), `swingThrough` head-on. Events: at 3000 px/s `nearMiss@0.308 slowmo@0.308 bomb@0.342`; at 1500 px/s `nearMiss@0.375 bomb@0.425`; at 6000 px/s `nearMiss@0.308 bomb@0.325`; the same with a 45 degree swing, a swing 30 and 45 px off centre, and in Arcade. A pass 60 and 100 px away gives a near miss only, 130 px nothing, 45 px hits (band correct). Screenshots 54 and 96 show "So close!" above "BOMB!".
- **QA-03.** Manual clock, `press('confirm')` after the results screen began: ignored at +100, +500, +900, +1100 and +1190 ms, accepted at +1210 ms. The design asks for 1.2 s after the panel is fully visible (about +1600 ms).
- **QA-04.** Screenshots 58 to 60: "Time slows down", "Fruit only, no bombs" and "Points ×2" sit on the lower edge of the brush band.
- **QA-05.** Real clock: 3364 ms from the click on a mode fruit to the first frame of play (350 ms cut effect plus "3", "2", "1" and "GO!" without the separate 1 s mode title of design 12.8). Screenshot 80: "Arcade" is drawn over the timer ring and the "TIME" label.
- **QA-06.** Screenshots 04, 11, 23, 56, 69, 73: "Play again" and "Menu" straddle the bottom border of the results panel, the three buttons of the failed-disconnect panel touch each other and the panel border, the "Paused" title shows through the disconnect overlay and sits on the timer ring, mode names touch the lower edge of the mode fruit, the small "COMBO" label lands on the big "COMBO" word, the break banner touches the results buttons (screenshot 92). The pause tip and safety screen were not re-checked for spacing (screenshot 03: toggle and button still nearly touch).
- **QA-07.** `?input=mouse`, menu, click "Recalibrate": nothing changes (screenshot 50). With `?input=sim` the wizard starts.
- **QA-08.** `?input=sim`: mouse at (1500, 300), Space (blade goes to (960, 540)), 0.7 s pause, mouse to (1700, 300): blade at (1700, 293) instead of about (1160, 540).
- **QA-09.** Simulator: `sim.simulateLoss()`, after the failed automatic reconnect "Try again" is enabled and no cooldown text is shown (screenshot 69). Real Bluetooth provider with the fake device: after a failed reconnect the provider is in cooldown (`cooldownUntil` set, 8.7 s left, `failures` 2), the overlay looks the same (screenshot 75), and three clicks on "Try again" changed nothing (`failures` stayed 2, no state change, no message; screenshot 76). The click is silently ignored, which is what the cooldown should do, but the button does not say so ("Try again in N s" of design 12.11 and 13.6).

---

## 2. Coverage summary

| Area | Result |
|---|---|
| `npm test` | Pass. 893 tests, 893 passed, 0 failed, 0 skipped, 22.2 s. The suite includes the headless-Chrome e2e tests, which ran (none skipped) |
| Cold start | Pass. First load with empty storage shows the safety screen; 81 requests, all to `localhost:8137`, none failed; no console message; ready 62 ms after the navigation started (screenshots 01 to 03) |
| Safety screen | Pass. Enter and click ignored before 2 s; "Reduce flashes" toggles and persists; a 1.5 s dwell on the button does not confirm; Enter confirms and stores `safetyAck` |
| Menu | Pass. Cut, click and dwell select modes and buttons; a slow swing (509 px/s) over a mode fruit selects nothing; records shown; provider chip; a cut at 3500 to 4200 px/s selects a mode fruit and a button with the mouse and simulator providers. See R2-01 for a dwell problem |
| Connect screen | Pass with the project's fake Bluetooth device injected in the page (section 6): chooser cancelled (no cooldown), connection failure (button "Try again in N s" counting down from 10, red error line), connected (real BLE provider streams at 66 Hz, battery level "ok" from 3700 mV), diagnostics link, `?filter`, `?mask`, `?side` flags produce the documented `requestDevice` options and command frames, illegal values are ignored with a console warning; a device without the Joy-Con service gives `not_joycon` after 0.5 s (screenshot 100); a chooser that never answers stays in "requesting" without error (101); a connected device that never sends data triggers the retry with mask 0xFF at 4.5 s and the error "The Joy-Con is connected but is not sending data" with the 10 s cooldown at 9.8 s (102) |
| Calibration | Pass. Real wizard with the fake device: step 1 after 2 s, step 2 waits for a real change of pose, poses 30 and 150 degrees away give "The two poses are too similar..." and return to step 1, shaking during a hold gives "You moved. Let's start over.", a hand-made 90 degree pose passes, step 3 by stillness, step 4 practice apple cut returns to the menu. Real wizard against the simulator for three mounts (`faceUp` R, `sideRail` L with mirrored gyro, `upsideDown` with the alternate gyro scale): discovered frame equal to the simulator's truth within 0.03 degrees |
| Modes | Pass. Classic, Arcade and Zen each played start to finish (section 5.1) |
| Scoring, combos, lives, timers, bombs, power-ups | Pass against the design tables (section 3), except QA-02 |
| Pause and resume | Pass except R2-04 and the R2-01 side effect. P, Esc, middle click and the API pause; "Resume" and Enter resume with the 3-2-1 countdown (2.16 s), the world stays frozen while paused and while resuming; window blur pauses with the right message and does not resume by itself; "Settings" and "Quit to menu" (with its confirm dialog) work |
| Game over, results, records | Pass except QA-03 and R2-02. "NEW RECORD!" only for a strictly greater score (equal 60 and lower 30 did not update the record or its date, 90 did); records persist across reload; the 10-minute break banner shows after 10 minutes of session play (round 10 of a session, 643 s) and not before (round 9, 576 s); Classic 6:00 soft-break toast shows |
| Storage failure | Pass. `Storage` throwing on every call: menu, settings in memory, a full Arcade round to the results screen, no console output. Corrupted JSON: boots to the safety screen with defaults. Out-of-range stored settings are clamped |
| Window resize | Pass. 1920x1080, 1280x720, 1024x768, 800x600, 600x1000, 360x640, 2560x1080, 3840x2160, 1440x900 at DPR 2 and 1920x1080 at DPR 2, plus four live resizes during play: aspect-fit with ink bars, clicks land on the right targets, no page scroll, 59.7 to 60.4 fps |
| Settings | Pass. Every control changes and persists; limits clamp at 0.5 to 2.0, 400 to 2400 and 0 to 100 percent; "Reset high scores" with Esc and with the confirm button; Esc goes back |
| Disconnect and reconnect | Pass except QA-09. Simulator and real Bluetooth provider (fake device): loss pauses under the overlay and freezes the world, one automatic reconnect at 2.0 s, streaming again at 2.7 s, quick re-centre, resume countdown, play continues from the frozen state (7.4 s in total) |
| Sustained play, frame rate, memory | Pass. 60.0 fps, no frame above 20 ms, flat JavaScript heap (section 5.3). Renderer RSS rises during the first 12 minutes and then stays flat, see the note there |
| Input latency, simulator path | Pass with a note (section 5.4) |
| Fast-swing tunnelling | Pass (section 5.5) |
| Determinism | Pass. Same seed and the same scripted swings gave identical snapshot hashes for 30 s (simulator, Classic) and 20 s (mouse, Arcade) in two separate page loads; a different seed differed |
| Diagnostics page | Pass. `diagnostics.html?input=sim` shows raw packet, converted accelerometer and gyro values, `|a|` 1.0025 g, 66.0 Hz packet rate with histogram, battery 3700 mV "ok", state "streaming fresh data", side and name; no console message, no external request (screenshot 77) |
| Server and launcher | Pass. Static files 200 with the right MIME types; `/nope`, `..`, `%2e%2e`, `.git`, a directory and dot segments 404; `//etc/passwd` 400; POST 405; a foreign `Host` header 403; loopback only; CSP header present. `start.command` was run with shims for `open` and `caffeinate`: starts the server on a free port, calls `open -a "Google Chrome" http://localhost:8199`, runs `caffeinate -di -w <pid>`, exits with code 0 on SIGINT and leaves no server behind. The real Chrome was never opened |
| Wake lock | Pass. `debug.getWakeLock()`: requested and granted when a round starts, held while paused, released at the menu, the results and the settings; a fake wake lock object saw `request:screen`, `release`, `request:screen`, `release` in that order |
| Console | No error and no exception in any run. Only warnings: the deliberately failing connect tests, the simulated link loss, the three illegal flags that were passed on purpose, and one `sample_gap` warning in the hidden built-in browser pane. `?debug=1` (which validates every sample, status, snapshot and event against the contracts) gave no violation over a 6 s Arcade round and over the whole 93-check rule run |
| Audio | Partly checked. No `AudioContext` before the first click (`ready:false`), created and running after it with `masterGain` 0.392 for volume 0.7 (= 0.8 x 0.7 squared), voices `slice` and `comboChime` created on a cut, no errors, key `M` sets `muted` and `masterGain` 0. Nothing was listened to |

---

## 3. Rules checked against `docs/game-design.md`

All values were read back through `window.__ninja.snapshot()` and its events on the manual clock (`?clock=manual`), in a private headless Chrome (section 6). 93 checks, 93 pass (the scripts are in `docs/qa/round-2/scripts/`).

| Rule (design section) | Expected | Observed |
|---|---|---|
| Base score, radius and hit radius of the 10 fruit (4.1) | 10/10/15/15/15/15/20/20/25/30; hit radius 1.25 x r | 10 of 10 exact, for example watermelon r 92 hit 115, cherry r 48 hit 60 |
| Combo bonus (5.4) | 5 n (n - 1), capped at n = 10 | n = 2 to 12 in one swing: 10, 30, 60, 100, 150, 210, 280, 360, 450, 450, 450 on top of the base points (totals 70, 120, 180, 250, 330, 420, 520, 630, 750, 780, 810 with cherries) |
| Double (4.4) | Doubles fruit points and combo bonus, 10.0 s, refresh to full, no stacking, penalties not doubled | n = 2 to 12 exactly doubled (140 to 1620); 9.8 s at pick-up, 0.77 s left after 9 s, second medallion back to 9.78 s with one entry, gone after 10 s; bomb still -50 |
| Combo window (5.4) | Cuts 250 ms apart or less join | 208 and 242 ms apart joined (70 points); 258, 275 and 308 ms apart did not (60 points) |
| Golden apple (4.2, 6) | +100, counts in combos; Classic +1 life if below 3; Arcade +3 s; Zen score only | cherry + golden + cherry = 190 (30 + 100 + 30 + 30); Classic 2 to 3 lives with a `lifeGained` event, stays 3 at 3; Arcade +3.00 s and +100; Zen +100 and time unchanged; doubled = 200; slow motion 0.4 for 350 ms |
| Cut threshold (5.2, 14) | 1000 px/s inclusive, Zen x0.8 | Classic and Arcade: 900 and 990 no, 1000, 1005, 1010, 1100 yes; Zen 790 no, 800, 810 yes |
| Bomb (4.3, 5.3, 6) | Slow contact never explodes; cutting-speed hit within 54 px; near miss 54 to 120 px | 500 px/s contact: nothing, lives 3; 30 and 45 px offsets hit; 60 and 100 px near miss only; 130 px nothing (but see QA-02) |
| Bomb in Classic (7.1) | -1 life, closes combo | 3 lives to 2; 3 cherries then a bomb in one swing kept the +30 combo (score 120) |
| Bomb in Arcade (7.2) | -50 points (floor 0), -5 s; at 5 s or less the round ends | -50 and -5.0 s (measured -5.3 s including 0.3 s of play); from 0 points stays 0; with 4.6 s left the timer goes to 0, phase `ending`, reason `timer` |
| Lives and mercy (7.1) | 3 misses within 1.2 s cost 1 life; a bomb always costs a life | 3 simultaneous misses: 3 to 2 lives; a miss 3 s later: 2 to 1 lives; bomb inside the mercy window: another life; 3 spaced misses: results screen |
| Life regeneration (7.1) | +1 life per 25 fruit, max 3, bomb resets the counter | 24 cuts progress 24, the 25th restores a life; 20 cuts, bomb, 24 cuts: no life, the 25th: +1 |
| Timers (7.2, 7.3) | Arcade 60 s, Zen 90 s, no Classic timer, pause freezes | Arcade 59.0, 50.0 and 10.0 s at 1, 10 and 50 s; ends at 0 with phase `ending` and the results screen after the end sequence; Zen 89.0 s at 1 s and ends at 0; Classic `timeLeft` null; pause froze the timer and resume continued it |
| Freeze (4.4, 2.2) | timeScale 0.40 for 5.0 s real, timers unaffected, ease in and out | 0.40 during the effect; over 2.0 s of real time the round timer advanced 2.00 s and the world 0.80 s; ease out 0.40, 0.74, 1.00 at 4.3, 4.6, 5.2 s; gone at 5.0 s |
| Clock (4.4, 7.2) | +4 s (Arcade), remaining time capped at 90 s | +3.983 s against a control round with the same timing (the missing 0.017 s is the timer running during the cut); 12 medallions in a row: 89.52 s |
| Frenzy (3.4, 4.4) | 6.0 s, waves about every 0.42 s, no bombs, cap 16 | 5.8 s remaining at pick-up; 14 waves with gaps 0.38 to 0.45 s; no bomb spawned; at most 13 uncut fruit; gone after 6 s |
| Stages and first wave (3) | First wave 0.8 s after "GO!"; stage boundaries near 15/30/45 s (Arcade), 30/60 s (Zen), 20/45/75/105/140/180/240 s (Classic) | First wave at 0.8 s in every mode; Arcade stages at 15.3, 30.1, 46.1 s; Zen 31.1, 60.2 s; Classic 20.8, 45.6, 75.8, 106.1, 140.6, 180.6, 240.2 s (each on the next wave) |
| Spawn rules in played rounds (2.4, 3.4) | No bomb in Zen; no early bomb; arcs inside 100 to 1820 | Zen round: 0 bombs in 65 waves; first bomb at 8.4 s (Arcade) and 66.9 s (Classic); no spawn with `apexX` outside 100 to 1820 in any round |
| Hand setting (14) | Shifts the spawn bands by 80 px toward the hand | Zen, same seed, 121 fruit: mean apex x 985 (right) and 884 (left) |
| High score (7.4, 7.5) | Strictly greater score only, stored per mode | 60, then 60 (equal): unchanged including the date; 30: unchanged; 90: updated |

---

## 4. Screens, flows and visuals

Seen and judged from screenshots (real Chrome 154 on macOS, 1920x1080 unless the name says otherwise): safety, menu, settings with values at both limits, countdown, HUD in the three modes, combo banner with stars and slow motion, bomb with danger ring and explosion, Double, Freeze, Frenzy and Clock banners and tray icons, golden apple on screen and cut, Arcade last 10 seconds and "Time's up!", pause, resume countdown, quit dialog, reset dialog, results (with and without "NEW RECORD!", with the break banner), connect screen (idle, cancelled, failed, cooldown), the four calibration steps and their feedback lines, the disconnect overlay in its waiting and failed phases, the diagnostics page and the debug overlay. Apart from the findings above no rendering defect was seen. The reduced flash and reduced motion flags visibly remove the zoom and the flash overlay (screenshots 95 and 96).

---

## 5. Modes played, performance and latency

### 5.1 Modes played to the end (scripted swings, manual clock, simulator provider)

| Round | Result |
|---|---|
| Arcade, seed 11, accurate bot | 186 fruit cut, 0 missed, score 4525 (rank "Legend"), 4 stages, 62 waves, 7 bombs spawned and avoided, 4 power-ups (one of each), ended by the timer at 68.3 s (two time bonuses), "NEW RECORD!" shown |
| Zen, seed 12, accurate bot | 159 fruit cut, score 3405, ended at 90.6 s, 3 stages, no bomb, 2 power-ups |
| Classic, seed 13, 300 s | 684 fruit cut, score 17315, all 8 stages, 3 lives throughout, 29 bomb telegraphs, 10 power-ups; when the bot stopped the round ended by lives after 14 misses and the results screen showed 98 percent accuracy |
| Classic, no cutting (real clock, mouse) | First life lost at 2.9 s of play, second at 5.1 s, third (game over) at 6.7 s, then the game-over sequence and the results screen |
| Zen and Arcade, no cutting (natural waves, seed 7) | Both rounds end by the timer with score 0 and no penalty: Arcade 152 fruit missed, Zen 125 missed, no bomb hit, no power-up taken |
| Multi-round soak | 9 rounds in a row (Arcade, Zen, Classic, three times) on one page load: all started and ended correctly |

### 5.2 Score economy remark

As in round 1: an accurate bot reaches the top rank quickly (Arcade 4525 points against a 3200 threshold, Classic 7000 in about 140 s). The design calls the ranks untuned, so this is tuning data, not a defect.

### 5.3 Frame rate and memory (real clock, headless Chrome 154, simulator provider, a real-time bot with about 340 swings per 200 s)

| Run | Frames | Mean fps | p50 / p99.9 / max frame | Frames over 20 / 33 / 50 ms | Memory |
|---|---|---|---|---|---|
| Classic 206 s, 1920x1080 at DPR 1 | 12367 | 60.00 | 16.7 / 16.8 / 16.8 ms | 0 / 0 / 0 | JS heap after forced GC 3.88 MB at 20 s, 4.20 MB at 100 s, 4.12 MB at the end; sampled heap 6.8 MB first fifth, 7.6 MB last fifth, peak 9.1 MB; game counters bounded (objects 2 to 4, halves 0 to 7, log 32, outbox 0) |
| Classic 160 s, 1920x1080 at DPR 2 (3840x2160 backing store) | 9603 | 60.00 | 16.7 / 16.8 / 16.8 ms | 0 / 0 / 0 | renderer RSS 166 MB to 211 MB |
| Classic 240 s, DPR 2 | not recorded | 59.8 to 60.4 per 9 s sample | n/a | n/a | renderer RSS 175 MB to 226 MB, 194 MB first third, 224 MB last third |
| 12.3 minutes, DPR 2, 9 rounds (Arcade, Zen, Classic x 3) | 44426 | 60.00 | 16.7 / 16.8 / 16.8 ms | 0 / 0 / 0 | JS heap after forced GC 4.01 MB; renderer RSS 201 MB to 260 MB (first third average 228, middle 244, last third 253) |
| 25 minutes, DPR 2, 18 rounds (Arcade, Zen, Classic x 6) | 90825 | 60.00 | 16.7 / 16.8 / 16.8 ms | 0 / 0 / 0 | JS heap after forced GC 4.18 MB; renderer RSS 198 MB to 266 MB (first third 236, middle 258, last third 265), flat at 260 to 266 MB for the last 13 minutes |

The auto-degrade level stayed 0 in every run. The JavaScript heap is flat and the game's own collections are bounded, so there is no sign of a JavaScript leak. The renderer's resident memory (RSS) grows in small steps while new content appears for the first time (fruit and half sprites, new modes) and the slope shrinks over time; in the 25 minute run it reached a plateau of 260 to 266 MB after about 12 minutes (+5 MB over the last 13 minutes, 18 rounds). Whether the plateau holds for longer sessions, and what a real GPU and a Retina canvas do to it, is **UNVERIFIED-ON-HARDWARE**.

This is headless Chrome on the development Mac. It says nothing about the owner's display path or GPU: 60 fps on the owner's MacBook, especially at DPR 2, is **UNVERIFIED-ON-HARDWARE**.

### 5.4 Input latency of the simulator path

Measured in the page: a stroke of 12 pointer events at 125 Hz (40 px steps), time from the first event until the first animation frame in which the blade position has moved more than 4 px (the measure is quantised to whole 16.7 ms frames). Synthetic `PointerEvent`s on the canvas.

| Provider | Trials | Mean | p50 | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| Simulator, 66 Hz packets (default) | 120 | 22.0 ms | 17.1 ms | 34.7 ms | 49.5 ms | 50.2 ms (1 trial over 50, 3 over 40) |
| Simulator, 250 Hz packets | 40 | 17.1 ms | 16.7 ms | 18.7 ms | n/a | 33.8 ms |
| Plain mouse | 40 | 16.7 ms | 16.7 ms | 18.6 ms | n/a | 18.6 ms |

The game's own `getPerf().inputToDrawMs` read 7.9 ms (simulator 66 Hz), 14.6 ms (250 Hz) and 10.8 ms (mouse). The mean and the 95th percentile are well below the 50 ms target; at the default 66 Hz packet rate about 1 trial in 100 reaches 50 ms in this synthetic chain (one packet interval of 15 ms plus jitter plus a frame). These numbers exclude the display scan-out and, above all, the Bluetooth link: the 50 ms budget on the real device is **UNVERIFIED-ON-HARDWARE** (HW-1).

### 5.5 Fast-swing tunnelling

A row of 8 fruit 200 px apart (cherries, hit radius 60, and watermelons, hit radius 115) swept along the row by `__ninja.swing` at increasing speed, mouse and simulator providers give identical results:

| Swing speed (px/s) | Cherries cut | Watermelons cut |
|---|---|---|
| 5000, 10000, 20000, 40000, 55000, 59000 | 8 of 8, in order | 8 of 8, in order |
| 3000 | 6 of 8 | 8 of 8 (the swing takes 0.57 s and the fruit fall out of the line: not tunnelling) |
| 1500 | 2 of 8 | 3 of 8 (same reason) |
| 65000 and 100000 | 0 | 0 (the sample is dropped by the 60000 px/s safety cap, by design 5.1) |

Through the complete simulated sensor chain (`simSwing`: mouse model, packet bytes, parser, fusion) at 66 and at 250 Hz: 8 of 8 cherries and 8 of 8 watermelons at 6000, 10000, 20000 and 30000 px/s (measured peak 26000 to 28000 px/s). A single cherry crossed at 30000 px/s from 12 angles (every 15 degrees) was cut 12 times out of 12. No tunnelling was found up to the safety cap. With real trusted mouse events (about 30 Hz) a 3900 px/s sweep cut 3 of 3 watermelons, 1175 px/s cut 1 of 3 and 405 px/s cut none.

---

## 6. How the testing was done, and what could not be run

- **Browsers.** The built-in browser pane was reachable and loaded the game (screenshot 01), but as in round 1 it was hidden (`document.hidden` true, no focus), so the page ran at about 1 frame per second and produced one `sample_gap` warning; it was used only for that first look and to read its console. Everything else ran in a **private headless Google Chrome 154** that a small helper starts with a fresh profile folder inside the scratchpad and an operating-system assigned DevTools port (`--remote-debugging-port=0`, port read from that profile's own `DevToolsActivePort` file), and that creates and drives only its own tabs. Storage of that profile was cleared before every page except where a test needed it. See section 7 for why this matters.
- **Input.** Clicks and keys are real (trusted) DevTools events. Bulk pointer movement for the simulator and mouse providers is mostly synthetic `PointerEvent`s at 125 Hz, because trusted events arrive at about 30 Hz. Scripted swings use `__ninja.swing`, `swingThrough` and `simSwing` as documented. Note for automation authors: after a `swing` under the simulator provider the blade goes back to the simulator's own pointing direction, which can itself cut or dwell on a menu target (it cost some time in round 2).
- **Web Bluetooth.** No Joy-Con and no chooser UI. The real `navigator.bluetooth.requestDevice` was never called (in round 1 it hung and killed a headless Chrome). The connect, calibration and disconnect flows were exercised through the **real game code** (BLE provider, packet parser, motion pipeline, UI) against `test-support/input/fake-bluetooth.js`, the project's own fake device, injected into the page by `docs/qa/round-2/scripts/fakebt.mjs`. That fake models `docs/joycon2-protocol.md`; a pass proves conformance to the document, never to a physical Joy-Con.
- **Screenshots.** PNG at 1920x1080 from `Page.captureScreenshot`, converted to JPEG for the repository. Under the manual clock `__ninja.debug.draw()` paints the frame before the capture.
- **Not run:** the real `?input=joycon` device path, pairing, real drift and tremor, the real cursor feel, sword comfort, the display and GPU of the owner's Mac, macOS idle and Bluetooth prompts, audio by ear, Retina rendering on a real GPU. Colour contrast and visual polish were judged by eye. `start.command` was run only with shims (the real launcher would open the owner's Chrome).

### UNVERIFIED-ON-HARDWARE reminders

Everything that touches the physical controller was not tested and is not claimed: pairing steps and cooldown (HW-4, HW-5), BLE latency and packet rate (HW-1), gyro scale, sign and saturation (HW-10, HW-11), yaw drift and soft re-centring (HW-3, and with it the size of R2-01), the two-pose mount calibration with real hands (HW-7), battery reading (HW-8), button reachability (HW-6), the 1000 px/s threshold against real tremor (HW-9), sword comfort (HW-12), screen wake lock and the Mac's idle timings, and 60 fps on the owner's MacBook.

---

## 7. Process note

In round 1 the QA tester by mistake drove a tab of the owner's own Chrome (a debugging port clash). To avoid a repeat this round: before doing anything the running processes and listening ports were listed; the owner's Chrome (which listens on 127.0.0.1:9333) was never contacted, the private Chrome used an operating-system assigned port and its own profile, only tabs created by the helper were attached to, and the only things started were `npm test`, the game server on port 8137, a `start.command` run with shims on port 8199 (stopped again) and the private Chrome. The private Chrome was stopped at the end; the game server on port 8137 was stopped last, after the final `npm test`.

## 8. Suggested checks for round 3

1. R2-01: in the menu with a Bluetooth provider (or the fake device script), rest the sword: no round may start; after a manual re-centre in the menu (Space, double click) the cursor may sit on "Arcade" without starting it until it is moved by hand; same for the "Recalibrate" pause button.
2. QA-02, QA-03, QA-05 to QA-09 and R2-02 to R2-04 if they are taken up.
3. Re-run `npm test` and the rule scripts of `docs/qa/round-2/scripts/` (`run_rules.mjs`), which should stay identical (93 of 93).
4. On the real machine and the real Joy-Con, follow the setup guide and the diagnostics page to turn the UNVERIFIED-ON-HARDWARE items into facts; watch the menu for the R2-01 behaviour with the real drift.

## 9. Screenshot index (`docs/qa/round-2/`)

| File | Shows |
|---|---|
| 01 | Cold start, safety screen, built-in browser pane (800x450, hidden tab) |
| 02, 03, 06 | Safety screen locked, unlocked, "Reduce flashes" on |
| 04, 05, 07 | Menu (mouse provider), settings, menu (simulator) |
| 08, 09, 10 | Countdown "3" and "2" with mode title (Classic), first seconds of play |
| 11, 12, 13, 14, 15 | Pause panel, resume countdown, quit dialog, pause after a window blur, quit dialog again |
| 16, 17 | First life lost with the first-run tip; game over in slow motion |
| 18, 19 | Results, count-up at 0.5 s and settled (Classic, score 0) |
| 20, 21, 24, 25 | Menu with a stored record, and after reload |
| 22, 23 | Classic with the real-time bot; results with "NEW RECORD!" (the "Apprentice" seal, R2-02) |
| 26, 27, 28, 29 | Settings at both limits, settings changed, reset-records dialog, menu after reset |
| 30-* | Resize matrix: 1024x768, 1280x720, 1440x900 at DPR 2, 1920x1080, 2560x1080, 360x640, 3840x2160, 600x1000, 800x600 |
| 31 | Live resize during play (1000x700) |
| 32, 33, 34, 35 | Connect screen: idle, chooser cancelled, connection failed, cooldown countdown (fake device) |
| 36 to 45 | Calibration with the fake device: start, step 2 waiting, unchanged pose, pose 2 reached, step 4 practice apple, pose 30 and 150 degrees "too similar", step 1 moved, ring filling, "You moved" |
| 46, 47, 48, 49 | Simulator wizard step 4 for three mounts; step 4 before the cut |
| 50 | Plain mouse, click on "Recalibrate": nothing happens (QA-07) |
| 51, 52 | Practice apple just cut; Arcade countdown started by resting in the menu (R2-01, fake device) |
| 53 to 57 | Bomb with danger ring, explosion with "So close!" and "BOMB!" (QA-02), aftermath, combo x4 banner with the "COMBO" label collision (QA-06), later |
| 58 to 62 | Double, Freeze, Frenzy (QA-04), Frenzy active, Clock banners |
| 63, 64 | Golden apple on screen and cut |
| 65, 66 | Arcade last 10 seconds, "Time's up!" |
| 67 to 70 | Simulated link loss: overlay text, after 9 s, failed phase with three buttons (QA-06, QA-09), recovery re-centring |
| 71 to 76 | Real Bluetooth provider (fake device): drop overlay, after recovery, failed phase with cooldown, later, before and after three "Try again" clicks (QA-09) |
| 77 | Diagnostics page with the simulator |
| 78 | Sustained play at 100 s |
| 80, 81 | Arcade countdown with the title over the timer ring (QA-05) and first frame of play |
| 82 | Debug overlay (`?debug=1`) in Arcade |
| 83 to 85 | Records: Arcade run 1 (new record), run 2, run 3 (score 0) |
| 86 to 89 | Zen records: 60, equal 60 (no banner), lower 30, higher 90 |
| 90 | Classic at 6:00 with the soft-break toast |
| 91, 92 | Results with the 10-minute break banner; rounds 9 (no banner), 10 and 11 of one session |
| 93, 94 | Connect screen while streaming; after the diagnostics link was clicked (provider idle) |
| 95, 96 | Bomb with reduced flash and motion, and normal |
| 97, 98 | Menu and pause panel after a manual re-centre (R2-01) |
| 99 | Rank seals Warrior, Ninja, Master, Legend |
| 100, 101, 102 | Connect errors with the fake device: not a Joy-Con, chooser pending, connected but no data |
| 103 to 106 | Arcade seed 11 at 10, 30, 51 s and its results |
| 107 to 110 | Zen seed 12 at 10, 31, 51 s and its results |
| 111 to 115 | Classic seed 13 at 20, 61, 121, 242 s (stage 8) and the game-over results |

## 10. Scripts (`docs/qa/round-2/scripts/`)

Not part of the product and not run by `npm test`. Every `t*.mjs` file is the script that produced a number or a screenshot of this report, in the order of the work (some early ones were superseded by a later version, for example `t22*` by `t23_consistent.mjs`). `lib.mjs` and `launch.mjs` explain how to start the private Chrome. The main ones:

- `run_rules.mjs` with `rules_page.js`, `rules2_page.js`, `rules3_page.js`: the 93 rule checks of section 3 (`EXTRA=rules2_page.js,rules3_page.js node run_rules.mjs baseScores combos combos:true comboWindow threshold golden bombs livesTest regen timers powerups frenzy`).
- `t04_qa01.mjs`, `t05_qa02.mjs`, `t06_qa03.mjs`: re-checks of the round-1 findings QA-01 to QA-03.
- `t23_consistent.mjs` (with `fakebt.mjs`, `blehelp.mjs`) and `t46_simrecenter.mjs`: R2-01 with the fake device and with the simulator.
- `t26_ble_disconnect.mjs`, `t27_try-again.mjs`, `t25_disconnect.mjs`: disconnect flows and QA-09.
- `t29_sustained.mjs`, `t34_dpr2.mjs`, `t35_rss.mjs`, `t36_long.mjs`, `t30_latency.mjs`, `t31_tunnel.mjs`, `t31b_simswing.mjs`: frame rate, memory, latency and tunnelling.
- `t08_modes.mjs`: plays a mode to the end with the bot.
