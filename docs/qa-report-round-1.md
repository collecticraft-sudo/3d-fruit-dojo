# Joy-Con Ninja: QA report, validation round 1

| Item | Value |
|---|---|
| Role | QA tester, black-box, player's view |
| Date | 2026-09-30 |
| Build under test | `joycon-ninja` 0.1.0, served by `node server.js` on `http://localhost:8137` (no code was modified by QA) |
| Reference documents | `docs/game-design.md` (numbers and rules), `README.md`, `docs/architecture.md` section 9.8 (`window.__ninja`) |
| Language | This report and all project documents are in English (owner request). In-game text is English as well |
| **Verdict** | **FAIL** (1 major and 8 minor findings, 0 critical) |

The verdict follows the round rule "fail if any critical or major finding exists". The single major finding (QA-01) is small and confined to the Settings screen, so the game is otherwise in very good shape: every rule, number and flow that was checked against `docs/game-design.md` behaved as specified, `npm test` is fully green and the game held 60 fps with flat memory over a 3.6 minute session.

Nothing in this report was verified on a physical Joy-Con 2. Everything about the real device stays **UNVERIFIED-ON-HARDWARE** (see section 6).

---

## 1. Findings

Severity: **critical** = crash, unplayable, data loss, wrong core rule. **major** = clearly wrong behaviour or bad experience. **minor** = polish. "Screenshot" numbers refer to `docs/qa/round-1/` (section 8).

| ID | Severity | Title |
|---|---|---|
| QA-01 | **major** | One click on a Settings "+" or "-" button changes the value twice (click, then dwell) with the mouse and simulator providers |
| QA-02 | minor | "So close!" (near miss) and its slow motion fire before every actual bomb hit |
| QA-03 | minor | Results-screen input lockout is 1.2 s from the start of the slide-in, not from "fully visible" |
| QA-04 | minor | Power-up banner subtitles sit on the edge of the brush band and are hard to read |
| QA-05 | minor | Countdown is shorter than specified and its mode title collides with the timer label |
| QA-06 | minor | Several layout collisions (results buttons, disconnect panel, menu titles, combo label) |
| QA-07 | minor | "Recalibrate" is a dead button with the plain mouse provider |
| QA-08 | minor | Simulator only: a manual re-centre is undone after any pointer pause of 200 ms or more |
| QA-09 | minor | Simulated link loss: "Try again" is not locked and no cooldown text is shown after the failed reconnect |

### QA-01 (major): click and dwell both activate the same Settings button

- **What happens.** With "Hold to select" on (the default), a single click on a "+" or "-" stepper applies the step immediately and then applies it a second time about 0.9 s later, because the pointer is still resting on the button and the dwell timer completes. Observed on Volume and Sensitivity (Slice threshold uses the same kind of control but was not separately timed). It happens with both `?input=mouse` and `?input=sim`, 6 out of 6 times in the final re-run. The second step does not repeat again.
- **Expected.** One click, one step. A click should consume the dwell for that target.
- **Repro.**
  1. Open `http://localhost:8137/?input=mouse&skipsafety=1&mute=1`, click "Settings" (560, 975).
  2. In the console run `__ninja.setSetting('volume', 0.3)`, then move the mouse to (1000, 800) and wait 1 s.
  3. Click the "+" next to Volume at (887, 613) once and do not move the mouse.
  4. `__ninja.getSettings().volume` is 0.4 after about 0.1 s and 0.5 after about 1.0 s. Log: `[[103, 0.4], [1001, 0.5]]`.
  5. Same result with `?input=sim`. With "Hold to select" switched off the second step does not happen.
- **Impact.** Sensitivity, cut threshold and volume jump by two steps when the owner tunes them with a mouse. Toggles are not affected (setting a value twice is idempotent). With the real sword the intended path is dwell or cut, which gives one step per activation, so the impact is on mouse and simulator users.

### QA-02 (minor): "So close!" appears together with "BOMB!"

- **What happens.** A swing that really hits a bomb first emits a `nearMiss` event, which shows the popup "So close!", starts the 0.5x slow motion and plays the near-miss sting, and then about 33 to 42 ms later the bomb explodes. The approach segments of the same swing are inside the 54 to 120 px band, so the swing that later hits the bomb is counted as a near miss first.
- **Expected.** Design 9.3: the near miss is a reward for a daring swing that misses the bomb. A swing that hits must not produce it.
- **Repro** (manual clock): `?input=sim&clock=manual&mute=1&skipsafety=1`, `__ninja.start('classic',{seed:1,wavesEnabled:false})`, `id = __ninja.debug.spawn({kind:'bomb',apexX:960,apexY:450,atApex:true})`, `await __ninja.swingThrough(id,{speed:3000,length:500})`. Events: `nearMiss@0.125 (d=112)`, `slowmo@0.125`, `bomb@0.158`, `lifeLost@0.158`. Same at 1500 px/s (nearMiss 42 ms before the bomb) and for a swing 45 px off centre. Screenshot 18 shows "So close!" above "BOMB!".
- The near-miss band itself is right: a pass 60, 70 or 100 px away gives a near miss only, a pass 130 px away gives nothing, a pass 45 px away hits.

### QA-03 (minor): results lockout is shorter than specified

- **What happens.** The results screen starts 800 ms after the last life is lost (and about 1.3 s after the timer ends in Arcade and Zen) and the panel then slides in for about 400 ms. Inputs are ignored for 1.2 s counted from the start of the results screen, so only about 0.8 s after the panel is fully visible.
- **Expected.** Design 7.4, 9.10 and 12.10: 1.2 s of lockout after the panel is fully visible.
- **Evidence.** Manual clock: `press('confirm')` ignored at +100, +500, +900, +1100 ms after the results screen began, accepted at +1200 ms. Real clock, real clicks on "Play again": ignored at +445 ms and +1063 ms, accepted at +1578 ms.

### QA-04 (minor): banner subtitles straddle the band edge

The subtitle under "DOUBLE!", "FREEZE!" and "FRENZY!" ("Points ×2", "Time slows down", "Fruit only, no bombs") is drawn across the lower edge of the dark brush band. The upper half of the light text is on the band, the lower half on the light paper, so it is hard to read (screenshots 21, 22). The big "FRENZY!" word is also largely hidden by fruit in front of it (screenshot 23); the design draws banners behind objects, so this is by design, but the two together make the Frenzy cue easy to miss.

### QA-05 (minor): countdown differs from design 12.8

- Measured on the real clock with `?mode=classic`: playing starts about 3.0 s after the countdown begins (numerals change once per second). The design gives the mode name 1 s, then "3", "2", "1" at 0.8 s each and "GO!" 0.6 s, about 3.4 s before the round.
- The mode title ("Arcade", "Zen") is shown at y of about 160 at the same time as the numerals, on top of the timer ring label "TIME" (screenshot 53).

### QA-06 (minor): layout collisions

These follow the coordinates written in the design (for example results panel 760 px tall centred at y 480 with buttons at y 900), so they may be design issues rather than implementation issues.

- Results screen: "Play again" and "Menu" straddle the bottom border of the panel (screenshots 11, 12, 13, 59b); the 10-minute break banner touches the buttons (59b).
- Disconnect overlay, failed phase: the three buttons touch each other and the panel's bottom edge, and the "Paused" title and pause tip of the pause panel show through behind the overlay (screenshot 49).
- Menu: the mode names ("Classic", "Arcade", "Zen") overlap the lower edge of the mode fruit (screenshot 05).
- Combo banner: the small "COMBO" label of the bonus popup lands on the big "COMBO" word of the banner (screenshot 16).
- Pause panel over Arcade/Zen: the timer ring is visible right behind the "Paused" title (screenshot 50).
- Safety screen: the "Reduce flashes" toggle and the confirm button are almost touching, and the wrapped fifth line sits tight against the sixth (screenshot 02).

### QA-07 (minor): "Recalibrate" does nothing with the plain mouse provider

Clicking "Recalibrate" on the menu with `?input=mouse` gives no feedback at all (no screen change, no toast; screenshot 68). With `?input=sim` the same button runs the scripted wizard and returns to the menu after about 9 s (screenshot 67). Suggest hiding or disabling the button for the mouse provider, or showing the "Crosshair recentered" toast.

### QA-08 (minor, simulator only): manual re-centre does not stick

- **What happens.** In "Simulator" mode, after pressing re-centre the blade goes to the centre. If the pointer then rests for 200 ms or more and moves again, the first move after the pause re-anchors the virtual sword to the absolute mouse position, so the re-centre is lost. Numbers (mouse at 1500, 300; re-centre; mouse then moves +200 px): blade (960, 537), then (1693, 305) instead of about (1160, 540). With a pointer stream that never pauses, or with `__ninja.sim.setTarget(...)` glides, the result is correct: (1162, 540).
- **Impact.** Only the simulator, which is a test tool. The real Joy-Con has no such re-anchor (UNVERIFIED-ON-HARDWARE), and re-centring itself works. Reported because the HUD shows "Recenter: double click" in simulator mode, and someone tuning re-centre with the simulator will be confused.

### QA-09 (minor): disconnect overlay, failed phase

After `__ninja.sim.simulateLoss()` and the failed automatic reconnect, the overlay shows "Can't reconnect. Check the battery and move closer to the Mac." with "Try again" enabled at 5 s and no "Wait about 10 seconds before trying again." line. Design 12.11 asks for `disc.cooldown` and a "Try again" button locked for the 10 s cooldown ("Try again in {s} s"). Only the simulated loss was exercised (the real BLE path cannot be run here), so this may be specific to the simulator provider.

### Observations that are not findings

- The console prints one `info` line per round start (`[joycon-ninja] round started: ...`). Harmless noise.
- The simulator's default packet rate is 66 Hz (documented in the README); the design text says 250 Hz for the simulator. Measured latency at 66 Hz is still well under target (section 4.4).
- After a large fast sweep the simulated cursor can sit up to about 100 to 175 px away from the simulated pointing direction for 0.2 to 0.8 s before it converges (fusion lag with the simulated gyro), and it converges to within a few pixels. Within the documented 3 degree tolerance of the pipeline tests; worth watching on the real device (HW-3).
- "Reduce motion" also raises the minimum slow-motion scale for Freeze (0.4 becomes 0.5). This is a documented and accepted deviation (`docs/contract-notes.md`), but it means a reduced-motion round is not the same round as a normal one for the same seed.
- First-run tips (`tip.swing` at 2 s, `tip.combo` at 12 s) show when a round is started from the menu (screenshots 56c, 57c). They do not show when a round is started through `__ninja.start()` or the `?mode=` shortcut.
- The diagnostics page has its own texts outside the strings module (allowed by the design); the setup guide contains a glossary of the on-screen texts.

---

## 2. Coverage summary

| Area | Result |
|---|---|
| `npm test` | Pass. 842 tests, 842 passed, 0 failed, 0 skipped, 21.6 s. The suite includes the e2e tests, which ran in their own headless Chrome |
| Cold start | Pass. First load with empty storage shows the safety screen; 79 requests, all to `localhost:8137`; no console errors |
| Safety screen | Pass. Button locked for 2 s; Enter, click, a sword cut across the button and a 1.3 s dwell all ignored while locked; sword and dwell never confirm; "Reduce flashes" toggles and persists |
| Menu | Pass. Cut, click and dwell each select a mode; menu buttons work; records shown; provider chip shows "Simulator" or "Mouse"; an idle cursor resting on a button does not select it |
| Connect screen | Pass with a test double for Web Bluetooth (section 5): cancelled chooser, connection failure (10 s cooldown with countdown), device that is not a Joy-Con, chooser that never answers, "Simulator" and "Mouse only" buttons |
| Calibration | Pass. Real wizard against the simulator (`?simcal=1`): steps 1 to 3 pass by themselves, step 4 shows the practice apple, the retry hint and "Redo" after 20 s, cutting the apple returns to the menu. Discovered frame matched the simulator truth within 0.03 degrees for 11 combinations of mount (`faceUp`, `faceSide`, `upsideDown`, `tipFlipped`, `tilted`, `sideRail`), side L/R, mirrored gyro and alternate gyro scale |
| Modes | Pass. Classic, Arcade and Zen each played start to finish (section 4.3) |
| Scoring, combos, lives, timers, bombs, power-ups | Pass against the design tables (section 4.2), except QA-02 |
| Pause and resume | Pass. P, Esc, middle click and the API pause; Esc or Enter or "Resume" resume with the 3-2-1 countdown (2.1 s); world frozen while paused and while resuming; window blur and hidden tab pause with the right message and do not resume by themselves |
| Game over, results, records | Pass except QA-03. "NEW RECORD!" only for a strictly higher score; records persist across reload; 10-minute break banner appears after 10 minutes of session play; Classic 6:00 soft-break toast appears |
| Storage failure | Pass. Corrupted JSON in storage: game boots on defaults. `Storage` throwing on every call: full Arcade and Zen rounds played to the results screen, no console output |
| Window resize | Pass. 1280x720, 1024x768, 800x600, 2560x1080, 600x1000, 360x640, 3840x2160, 1920x1080 at DPR 2 and a live resize during play: aspect-fit with ink bars, clicks land on the right targets, no page scroll, 60 fps everywhere |
| Settings | Pass except QA-01. Every control changes and persists; limits clamp at 0.5 to 2.0, 400 to 2400, 0 to 100 percent; "Reset high scores" with "Cancel" and "Yes, delete"; Esc goes back |
| Disconnect and reconnect (simulated) | Pass except QA-09. Loss pauses the game under the overlay and freezes the world; recovery runs the quick re-centre, then the resume countdown, and play continues from the frozen state |
| Sustained play | Pass (section 4.4) |
| Input latency, simulator path | Pass (section 4.4) |
| Fast-swing tunnelling | Pass (section 4.5) |
| Determinism | Pass. Same seed and scripted swings gave identical snapshot hashes over 30 s in two page loads |
| Diagnostics page | Pass. `diagnostics.html?input=sim` shows raw and converted IMU values, 66.0 Hz packet rate, `|a|` about 1.00 g, battery, connection state and the live interval histogram |
| Server | Pass. `/__health`, second instance reports "already running" and exits 0, path traversal attempts return 404, POST returns 405, listens on 127.0.0.1 only. `start.command` is executable and passes `bash -n` (not run, see section 5) |
| Console | Only the expected warnings from the deliberately failing connect tests. Debug mode (`?debug=1`, which validates every sample, status, snapshot and event against the contracts) gave no violations over a full Arcade round |
| Audio | Partly checked. No AudioContext before the first gesture; created and running after the first click; oscillator, noise, gain, filter and panner nodes are created during play; no errors. Nothing was listened to |

---

## 3. Rules checked against `docs/game-design.md`

All values below were read back through `window.__ninja.snapshot()` and its events on the manual clock, in a private headless Chrome (section 5).

| Rule (design section) | Expected | Observed |
|---|---|---|
| Base score, radius and hit radius of the 10 fruit (4.1) | 10/10/15/15/15/15/20/20/25/30; hit radius 1.25 x r | 10 of 10 fruit exact, for example watermelon r 92 hit 115, cherry r 48 hit 60 |
| Combo bonus (5.4) | 5 n (n - 1), capped at n = 10 | n = 2 to 12: exact (10, 30, 60, 100, 150, 210, 280, 360, 450, then 450) |
| Double (4.4) | Doubles fruit points and combo bonus, 10.0 s, refresh to full, no stacking | 24 of 24 combo cases doubled exactly; countdown 9.8 to 0 over 10.0 s; second medallion refreshes to 9.79 s |
| Combo window (5.4) | Cuts 250 ms apart or less join | 242 ms apart joined, 259 ms apart did not |
| Medallion in a swing (5.4) | Not a member, does not extend the window | 2 fruit, Double, 1 fruit in one swing: 3-combo, third fruit doubled, total 100 (10 + 10 + 20 + 60) |
| Golden apple (4.2, 6) | +100, counts in combos; Classic +1 life if below 3; Arcade +3 s; Zen score only | fruit + golden + fruit = 150 (10 + 100 + 10 + 30); Classic 2 to 3 lives; Arcade +3 s (52.63 from 49.95 after the swing); Zen +100 and no time or life change |
| Cut threshold (5.2, 14) | 1000 px/s, Zen x0.8 | 990 no, 1010 yes (Classic, Arcade); Zen 790 no, 810 yes |
| Hysteresis (5.2) | Release at 0.65 T, re-entry within 100 ms keeps the swing | Mouse provider, Zen: dip to 700 px/s keeps the swing; dip below release for 40 ms and back keeps `swingId` 1; a 200 ms slow stretch ends it and the next swing is `swingId` 2 |
| Bomb (4.3, 5.3) | Slow contact never explodes; cutting-speed hit within 54 px; near miss 54 to 120 px | 600 px/s contact: nothing; 45 px offset hits; 60, 70, 100 px offsets are near misses only; 130 px nothing (but see QA-02) |
| Bomb in Classic (7.1) | -1 life, closes combo, resets regen | Lives 3 to 2; 3 fruit then bomb in one swing kept the +30 combo (score 60) |
| Bomb in Arcade (7.2) | -50 points (floor 0), -5 s; at 5 s or less the round ends | 300 to 250 and 53.75 s to 48.47 s; from 0 points stays 0; with 3.95 s left the timer goes to 0 and the round ends after the end sequence |
| Lives and mercy (7.1) | 3 misses within 1.2 s cost 1 life; a bomb always costs a life | 3 simultaneous misses: 1 life lost; a miss 4 s later: another; bomb inside the mercy window: another; 3 spaced misses: game over, results 0.8 s later |
| Life regeneration (7.1) | +1 life per 25 fruit, max 3, bomb resets the counter | 24 cuts progress 24, the 25th restores a life; lives stay at 3; 20 cuts then a bomb then 24 cuts: no life, the 25th: +1 |
| Clock and cap (4.4, 7.2) | +4 s, remaining time capped at 90 s | 52.63 to 56.32 s; 12 clocks then 12 golden apples from a 60 s start: 89.72 s |
| Freeze (4.4, 2.2) | timeScale 0.40, 5.0 s real, timers unaffected, ease out | 0.40; timer advanced 4.0 s while the world advanced 1.6 s; scale 0.64 at 4.5 s; gone at 5.0 s |
| Frenzy (3.4, 4.4) | 6.0 s, waves every about 0.42 s, RAIN and LINE, no bombs, misses free | 15 waves, gaps 0.41 to 0.45 s, no bomb, up to 15 fruit alive (cap 16), lives stayed 3 during Frenzy and the next miss cost a life |
| Halves cap (2.6) | 40 | 72 cuts in a row: 40 halves alive at most |
| Slow motion (9.3) | Combo 4 gives 0.35 for 450 ms once per group | Single `combo4` slow motion for a 5-combo |
| Spawn rules over 6 seeds (2.4, 2.5, 3.4) | No early bomb (20 s Classic, 5 s Arcade), none in Zen, none in consecutive waves or in breathers or during Frenzy and Freeze, golden never with bomb or power-up, Clock only in Arcade, breather every 10th wave, arcs inside 100 to 1820, apex heights, power-up gaps (20 / 12 / 25 s) | Classic 240 s x 2, Arcade 70 s x 2, Zen 95 s x 2: no violation; first power-up at 26 to 43 s (Classic), 21 to 29 s (Arcade), 25 to 28 s (Zen); smallest gaps 21.3, 13.0, 31.9 s |
| Misses and off-screen (2.7) | Nothing leaves through the sides; max air time | No-cut soak of Zen x 2, Arcade x 2, Classic: 118 to 152 misses per round, all with x between 107 and 1817, max object age 2.54 s, no off-screen safety-net hits |
| Population (2.6) | 12 uncut fruit (16 in Frenzy) | Max 11 alive in bot runs, 15 in Frenzy |
| Accuracy on results (7.4) | cut / (cut + missed) | 84 cut, 5 missed shown as 94 percent |
| Hand setting (14) | Shifts the spawn bands by 80 px toward the hand | Mean fruit apex x 998 (right) and 886 (left) on the same seed |

## 4. Modes played, performance and latency

### 4.1 Modes played to the end (scripted swings, manual clock)

| Round | Result |
|---|---|
| Arcade, seed 3, accurate bot | 182 fruit cut, 0 missed, score 4010 (rank "Legend"), 66 waves, 4 stages, ended by the timer at 68.3 s because 2 time bonuses were collected, 3 power-ups |
| Zen, seed 4, accurate bot | 175 fruit cut, score 3515, ended at 90.6 s, 3 stages, no bombs |
| Classic, seed 5, accurate bot, 300 s | 746 fruit cut, 0 missed, score 17425, all 8 stages, 3 lives throughout, 25 bomb telegraphs avoided |
| Classic, seed 5, 360 s (second run) | Soft-break toast at 6:00 ("You have been playing for 6 minutes. Want to take a break?"), score 21280 |
| Classic, no cutting | Game over after 3 misses at about 7.6 s of play |
| Arcade and Zen, no cutting | Rounds end by the timer with the score 0 and no penalties (Zen) |

### 4.2 Score economy remark

An accurate bot reaches the top rank quickly (Classic "Legend" from 7000 points is passed at about 140 s of play; Arcade 4010 points against a 3200 threshold). The design already calls the ranks untuned (section 7.6, risk 8), so this is data for tuning, not a defect.

### 4.3 Frame rate and memory

Sustained real-time run: Classic, seed 77, simulator provider, a bot making 375 swings in real time, 1920x1080 at DPR 1, headless Google Chrome 154, 218.5 s (stages 1 to 7, score 10695, 3 lives, no errors).

| Measure | Value |
|---|---|
| Frames | 13102 over 218.5 s, mean 59.97 fps |
| Frame interval | p50 16.7 ms, p95 16.8 ms, p99 16.8 ms, p99.9 16.8 ms |
| Frames over 20 ms / 33 ms / 50 ms | 2 / 1 / 1. One frame took 133 ms. The test forced garbage collections through the DevTools protocol at about 20 s and at the end, which is the likely cause; this was not confirmed |
| Lowest one-second average fps | 56.3 |
| Auto-degrade level reached | 0 (never engaged) |
| JS heap after forced GC | 8.70 MB at 20 s, 4.33 MB at the end (no growth) |
| JS heap sampled, first fifth vs last fifth of the run | 11.79 MB vs 9.19 MB, peak 15.61 MB |
| Game's own counters at the end | objects 2, halves 7, pending 2, outbox 0, event log 32 (all bounded); at most 11 objects and 21 halves alive during the run |
| Other viewports (frame rate from `getPerf()`) | 3840x2160 at DPR 1, 1920x1080 at DPR 2 (3840x2160 backing store), 600x1000, 360x640: about 60 fps |

This is headless Chrome on the development Mac. It says nothing about the owner's display path or GPU: 60 fps on the owner's MacBook, especially at DPR 2, is **UNVERIFIED-ON-HARDWARE** for the machine (the README says the same).

### 4.4 Input latency of the simulator path

Measured in the page: a stroke of 12 pointer events at 125 Hz starts, and the time is taken until the first animation frame in which the blade position has moved more than 4 px. 40 trials each.

| Provider | Mean | p50 | p95 | Max |
|---|---|---|---|---|
| Simulator, 66 Hz packets (default) | 20.1 ms | 18.1 ms | 32.7 ms | 33.6 ms |
| Simulator, 250 Hz packets | 17.0 ms | 17.1 ms | 21.9 ms | 22.1 ms |
| Plain mouse | 3.7 ms | 3.7 ms | 5.4 ms | 5.4 ms |

The game's own `getPerf().inputToDrawMs` read 8 to 14 ms. All are below the 50 ms target. These numbers exclude the display scan-out and, above all, the Bluetooth link, so the 50 ms budget on the real device is **UNVERIFIED-ON-HARDWARE** (HW-1).

### 4.5 Fast-swing tunnelling

A row of 8 fruit 200 px apart (cherries and watermelons) was swept along the row by `__ninja.swing` at increasing speeds.

| Swing speed (px/s) | Cherries cut | Watermelons cut |
|---|---|---|
| 5000, 10000, 20000, 40000, 55000, 59000 | 8 of 8, in order | 8 of 8, in order |
| 2000 | 3 of 8 | 5 of 8 (the swing takes 0.9 s and the fruit fall out of the line: not tunnelling) |
| 61000 and above | 0 | 0 (the sample is dropped by the 60000 px/s safety cap, by design 5.1) |

A single small cherry crossed at 30000 px/s from six different angles was cut every time. No tunnelling was found up to the safety cap.

---

## 5. How the testing was done, and what could not be run

- **Browser.** The built-in browser pane was reachable, but it was hidden (`document.hidden` true), so the page ran at 1 to 3 frames per second and the game correctly pauses in a hidden tab. It was used only for a first look (screenshot 01). Everything else ran in **headless Google Chrome 154 on macOS**, driven over the DevTools protocol by a small helper written in the scratchpad (not part of the project). The final performance, latency, connect, calibration, disconnect and sustained-play checks were all done in that private instance. The core rule suites were also re-run there at the end and gave identical results to the first pass.
- **Input.** Clicks and keys are real (trusted) DevTools events. Pointer movement for the simulator and mouse providers is mostly synthetic `PointerEvent`s dispatched in the page at 125 Hz, because trusted DevTools mouse events arrive at only about 30 Hz and starve the simulator. Scripted swings use `__ninja.swing`, `swingThrough` and `simSwing` as documented.
- **Web Bluetooth.** No Joy-Con and no chooser UI. Clicking "Connect Joy-Con" with the real Web Bluetooth API in headless Chrome hung the page, and the headless browser process was gone afterwards; headless Chrome has no device chooser, so this is treated as an environment limit and is not counted as a defect. The connect screen was tested with a small test double for `navigator.bluetooth` (cancel, connection failure, non-Joy-Con device, hanging chooser). The real BLE provider, pairing, the packet stream from a device and battery reading were not exercised. The BLE path is covered only by the repository's own tests against a model of the protocol document.
- **Screenshots at DPR 2.** PNG capture of the 3840x2160 backing store timed out (70 s) while the page stayed responsive, and JPEG capture worked in 0.13 s. A control page with an animated 4K canvas captured fine. The cause was not found; I treat it as a capture limitation, not a game defect, but it was not investigated further. Frame rate at DPR 2 was read from `getPerf()` instead.
- **`start.command`** was syntax-checked only. Running it would open the owner's own Chrome.
- **Audio** was not listened to. Only node creation and context state were checked.
- **Not run:** the `?input=joycon` real device path, long-term drift, real hand tremor, the real cursor feel, sword comfort, the effect of the real display and GPU, and anything about the Bluetooth link. Colour contrast and visual polish were judged by eye from screenshots only.

### UNVERIFIED-ON-HARDWARE reminders

Everything that touches the physical controller was not tested and is not claimed: pairing steps and cooldown (HW-4, HW-5), BLE latency and packet rate (HW-1), gyro scale, sign and saturation (HW-10, HW-11), yaw drift and soft re-centring (HW-3), the two-pose mount calibration with real hands (HW-7), battery reading (HW-8), button reachability (HW-6), the 1000 px/s threshold against real tremor (HW-9), sword comfort (HW-12), and 60 fps on the owner's MacBook.

---

## 6. Process incident: I briefly drove a tab of the owner's Chrome

For transparency, this is a mistake in how I set up my test browser, not a product finding.

- I started a headless Chrome with `--remote-debugging-port=9333`. That port was already served on 127.0.0.1 by the owner's own Chrome instance (the "Chrome Diretto" instance that runs with `--remote-debugging-port=9333`). My Chrome only got `[::1]:9333`, and my helper connected to `127.0.0.1:9333`, so for roughly the first half of the session (screenshots 02 to 32 and the first functional checks) I was driving the first tab of the owner's Chrome, not my own instance.
- What I did in that tab: navigations to `localhost:8137` game URLs, viewport and focus emulation, synthetic mouse and keyboard events, screenshots, a temporary script that made `Storage` throw (removed again), and reading, clearing and seeding `localStorage` of the `http://localhost:8137` origin only. That tab was an empty `about:blank` tab (its history showed `about:blank` first, then only my navigations). I never attached to, read or changed the other tabs of that Chrome (they include a YouTube Studio tab and a Google Calendar tab, whose URLs I saw in the target list).
- When I noticed, I stopped and cleaned up: cleared the emulation overrides, cleared the `localhost:8137` site data in that profile, navigated the tab back to its original `about:blank` entry (the tab's back/forward history still contains my test URLs), and killed only my own headless process. I then moved to a private instance on port 9555 with a fresh profile, and changed my helper so that it creates its own tab and refuses to run if the browser has any non-blank page.
- The functional results from that first half are deterministic (manual clock) and were re-run in the private instance with identical results. All performance and latency numbers in this report come only from the private instance. The owner may want to know the tab history entries exist; nothing else in that browser was changed.

---

## 7. Suggested checks for round 2

1. QA-01: click once on each stepper with dwell on; expect exactly one step (mouse and simulator).
2. QA-02: a head-on bomb hit must not produce "So close!" or the near-miss slow motion; a pass 60 to 120 px away must still do so.
3. QA-03: results lockout measured from the fully visible panel.
4. Re-run `npm test` and the rule suites in section 3 (they should stay identical).
5. On the real machine and the real Joy-Con, follow the setup guide and the diagnostics page (`docs/setup-and-calibration-guide.md` section 5) to turn the UNVERIFIED-ON-HARDWARE items into facts.

---

## 8. Screenshot index (`docs/qa/round-1/`)

Screenshot 01 was taken in the built-in browser pane (800x450). Screenshots 02 to 32 were taken through the tab described in section 6 (real Chrome 154 window, viewport 1920x1080 except 07 and 08 which were captured at a wider window size); screenshots 33 to 68 were taken in the private headless Chrome at 1920x1080 unless the name says otherwise. All show the same game build.

| File | Shows |
|---|---|
| 01 | Cold start, safety screen |
| 02, 03, 04 | Safety screen locked (button reads "Read carefully…"), unlocked, "Reduce flashes" on |
| 05, 06 | Menu on first visit; menu after idling on a button |
| 07, 08 | Cutting the "Classic" target splits it and starts the countdown; countdown |
| 10 | Classic, stage 8, score 17425 |
| 11, 12, 13 | Results: mid count-up; Arcade with rank "Legend"; "NEW RECORD!" |
| 14, 30, 32 | Menu with records; menu with records before reset; menu after reset |
| 15, 16 | Fruit before a swing; "COMBO x4!" with slow motion |
| 17, 18, 19 | Bomb with danger ring; explosion with "BOMB!" and "So close!" (QA-02); aftermath |
| 20 | Arcade HUD with the four medallions and the golden apple |
| 21, 22, 23 | Double, Freeze, Frenzy banners (QA-04) |
| 24, 25 | Golden apple on screen and cut |
| 26 | Pause screen |
| 27, 29 | Settings; settings after changes |
| 31 | "Delete all high scores?" dialog |
| 33-* | Resize: 1024x768, 1280x720, 2560x1080, 360x640, 600x1000, 800x600 (the 62 file is a live resize during play at 1000x700) |
| 35 to 41 | Connect screen: initial, cancelled, failed with cooldown, cooldown countdown, chooser pending, not a Joy-Con, mouse provider menu |
| 42, 43, 44, 45 | Calibration step 1, step 4 practice apple, step 4 retry hint after 20 s, menu after calibration |
| 46, 47, 48, 49 | Disconnect overlay, re-centring after recovery, resume countdown, failed phase with buttons (QA-06, QA-09) |
| 50 | Pause caused by a window blur |
| 51 | Sustained play at about 205 s |
| 52 | Diagnostics page with the simulator |
| 53 | Countdown with mode title over the timer label (QA-05) |
| 56c, 57c | First-run tips at 2.4 s and 12.6 s through the menu flow |
| 58 | Debug overlay in Arcade |
| 59b, 60b | Results with the 10-minute break banner; Classic 6:00 soft-break toast |
| 63, 64 | Arcade last 10 seconds ("Last 10 seconds!", red digits); "Time's up!" |
| 66 | Menu right after selecting a mode |
| 67, 68 | "Recalibrate" with the simulator (wizard) and with the mouse (no feedback, QA-07) |
