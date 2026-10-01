# 3D Fruit Dojo: final QA report (black box, the player's view)

| Item | Value |
|---|---|
| Role | QA tester, black box, player's view (final push) |
| Date | 2026-10-01 |
| Build under test | the project folder as it was at the start of this run. The checksums of `public/`, `server.js`, `bridge/manager.js`, `test-support/` and `design/` (452 files) were taken before the first test and again after the last one: **identical**. So every result below is about one stable build |
| Served by | `node server.js` on port **8302** (started and stopped by this role). For the native path the server was started with `JOYCON_BRIDGE_BIN` pointing at `test-support/bridge/fake-helper.mjs` (the fake helper, model sword, control file) and was stopped at the end; its helper exited by itself (log: `quit`, exit 0) |
| Browsers | the desktop app's built-in browser pane (real clock, real mouse and key events sent by the tool, 1024 x 768 at device pixel ratio 2), and a private headless Google Chrome 154 (over the DevTools protocol, started and closed by the scripts; software rasteriser) |
| Reference documents | `docs/FINAL-STATUS.md`, `docs/architecture.md` (9.8 `window.__ninja`), `docs/GUIDE.md`, `README.md`, `docs/game-design.md`, `docs/qa-report-round-3.md` |
| Evidence | `docs/qa/final-qa/` (158 pictures, 22 result files `t*.json`, the scripts in `docs/qa/final-qa/scripts/`) |
| **Verdict** | **PASS**. 0 critical, 0 major, 9 minor or nit findings (section 1). `npm test`: 2033 of 2033 pass |

The verdict follows the rule "fail if any critical or major finding exists". Nothing found here is a crash, a blank or frozen screen, a wrong core rule, unreadable text or a frame rate below 50.

## 0. What this report does and does not claim

- **Nobody played by hand.** Every "play" below is either a scripted bot (swings injected through `window.__ninja`, which go through the same blade, motion and game code as a player's swing, and, with `simSwing`, through the whole simulated IMU chain), or scripted real mouse and keyboard events (DevTools protocol, or the desktop app's browser tools), or the fake helper acting as a person who holds a virtual sword. A short real-time session in the desktop app's browser pane was driven the same way (real clicks and key presses by the tool, swings by the in-page bot).
- **Nothing here was verified on a physical Joy-Con 2, a real sword, the real CoreBluetooth helper or the owner's display.** Everything about the controller stays **UNVERIFIED-ON-HARDWARE** (the list is in `docs/FINAL-STATUS.md`). The fake helper models the protocol document, not the device.
- **Checks that could not run, and why:**
  - Chrome's real device chooser (`navigator.bluetooth.requestDevice`): headless Chrome terminates on it (documented in the README; it happened once in this run, when a script clicked "Not working? Try Chrome's Bluetooth"). The path was checked only with a stub that models "the player closes the chooser".
  - Sound by ear: only the engine state was read (first click creates the context, 21 voices played, 0 errors, 0 dropped in 12 s of play). Nobody listened.
  - `start.command` was not run (it opens the owner's Chrome), the macOS Bluetooth permission prompt cannot appear without the real helper, Safari and Firefox were not tried.
  - Frame rate and memory on a real GPU: the numbers come from headless Chrome with a software rasteriser, on a machine with a load average of 4 to 7 (other agents were working). One real-time reading from the desktop app's browser pane (60.3 fps at 1024 x 768, device pixel ratio 2) agrees.
- **Pictures looked at one by one** (the rest were captured and are in the folder, but only measured or sampled): `02`, `04`, `11`, `13`, `16`, `17`, `22`, `23`, `24`, `30`, `31`, `34`, `41-arcade-countdown`, `42-arcade-playing`, `44-classic/arcade/zen-results-settled`, `50`, `55`, `60`, `62`, `62b`, `64`, `70`, `72`, `80-wipe-normal`, `80-wipe-reducemotion`, `90-resize-menu-360x640@2`, `90-resize-menu-2560x1080@1`, `95-assets0-menu`, `95-fonts0-menu`, `98-assets0-objects`, `9b`, `a6`, `b4`, `c04`, `c10`, `c24`, `f2` and the six `pane-*` pictures.

## 1. Findings

Severity: **critical** = crash, blank or frozen screen, wrong core rule. **major** = clearly wrong look or behaviour, unreadable text, fps below 50 at 1080p. **minor** = polish. **nit** = taste.

| ID | Severity | Title |
|---|---|---|
| FQ-01 | minor | With the simulator, pressing P and then Enter opens "Recalibrate" instead of resuming |
| FQ-02 | minor | The one-time toasts on the menu ("Calibration complete!", "Sensitivity and Slice threshold were reset.") cut the bottom of the tagline |
| FQ-03 | minor | The red lockout bar under the results buttons stays on screen after the lock has ended |
| FQ-04 | minor | Where the browser refuses the screen wake lock, the same console warning repeats about every 7.5 seconds while a round runs |
| FQ-05 | minor | Fast swings print `motion: accel_saturated: accelerometer at full scale` in the console |
| FQ-06 | minor | Sword tuning: the practice fruit and their halves are drawn over the "Crosshair speed" text |
| FQ-07 | minor | The "Paused" title overlaps the faded tutorial toast "Swing the sword fast to slice!" |
| FQ-08 | nit | The hyphen of "Joy-Con" in the display font reads as a long dash in headings |
| FQ-09 | nit | The "Simulator" button carries the Enter-key picture, but Enter selects the native bridge button |

No finding needs a fix before the owner uses the game. FQ-01 and FQ-03 are one-line fixes if time allows.

### FQ-01 (minor): P then Enter with the simulator opens "Recalibrate"

- **Repro (no device).** `http://localhost:8302/?input=sim&skipsafety=1&mute=1` (or the connect screen button "Simulator"), start Arcade, press `P`, press `Enter`. The pause panel's focus goes to the button under the cursor, and the simulator's cursor rests at the screen centre, which is the "Recalibrate" button (`getUiView().focus.id` is `pause.recalibrate`, `hover` is `pause.recalibrate`). Enter then runs "Recalibrate" (the quick calibration), not "Resume". With `?input=mouse` the same keys resume (focus `pause.resume`), and with the native path the focus is on "Resume" too.
- **Why minor.** The highlighted button is the one Enter activates, nothing is lost (the round resumes after the wizard), and the player can press Esc or click. It is the same family as the old R2-04. A fix would put the focus on "Resume" whenever the pause panel is opened from the keyboard.
- Evidence: `docs/qa/final-qa/t27_pause_enter.json` (simulator: focus and hover `pause.recalibrate`, Enter gives calibration step 3; mouse: focus `pause.resume`, Enter gives the resume countdown), pictures `g0-pause-sim.jpg` and `g0-pause-mouse.jpg`; `24-pause-native.jpg` shows the native case.

### FQ-02 (minor): toasts cut the tagline

- **Repro.** Finish a calibration (native path through the fake helper, or `?input=sim&simcal=1`), or load the game with an old stored document (section 3, migration). On the first menu the toast pill (centre 960, 302) overlaps the bottom of "Slice the fruit. Avoid the bombs." (the baseline and descenders are hidden). It is the old R3-05, narrowed: the text stays readable, the pill is on screen for a few seconds (7 s for the migration notice).
- Evidence: `17-menu-after-calibration.jpg`, `70-migration-toast-0.5s.jpg`.

### FQ-03 (minor): the lockout bar stays

- **Repro.** Finish any round. On the results screen a red line under "Play again" and "Menu" (x 510 to 1410, y about 935) is still drawn 5 seconds later, when the buttons have been live since 1.2 s. Already listed as "seen, left as it is" in `docs/FINAL-STATUS.md`.
- Evidence: `44-classic-results-settled.jpg`, `44-arcade-results-settled.jpg`, `44-zen-results-settled.jpg`, `9b-soak-results.jpg`.

### FQ-04 (minor): repeated wake-lock warning

- **Repro.** Open the game in a browser that denies the screen wake lock (the desktop app's browser pane does). Play one Arcade round: the console gets `[joycon-ninja] screen wake lock refused (NotAllowedError: Wake Lock permission request denied)...` 8 times in 60 s (`getWakeLock().requests` 8, `grants` 0). Chrome itself grants it, so the owner will most likely never see this. A single warning per page would be enough.

### FQ-05 (minor): `accel_saturated` warnings

- **Repro.** `?input=sim`, Settings, "Sword tuning", swing the practice fruit with `__ninja.simSwing({x:200,y:700},{x:600,y:700},90)` (about 4400 px/s): the console shows `[joycon-ninja] motion: accel_saturated: accelerometer at full scale` (1 to 3 times per run; also seen with the fake helper in the native runs). It is a diagnostic, not an error, and nothing changes in play. With a real hard swing (median peak 831 deg/s in the owner's recording) it may print too.

### FQ-06 (minor): tuning screen overlap

- **Repro.** Settings, "Sword tuning", cut the left practice fruit: its halves fly over the two lines "Crosshair speed: ..." (y 640 to 690). Readable before and after the cut, overlapped for about a second. Evidence: `55-tuning-practice-cut.jpg`.

### FQ-07 (minor): pause title over the tutorial toast

- **Repro.** First round ever (no stored best): start Zen or Classic, press `+` (native) or `P` within the first seconds. The dimmed toast "Swing the sword fast to slice!" sits at y 200 and the title "Paused" at y 245, so the title's top edge touches the toast's lower edge. Evidence: `24-pause-native.jpg`. Old QA-06 family.

### FQ-08 and FQ-09 (nits)

- FQ-08: `Connect your Joy-Con`, `Joy-Con disconnected`: the display font's hyphen is long, so it reads "Joy–Con". Body text (Fredoka) is fine. Evidence: `11-connect-native-scanning.jpg`, `b4-native-disconnected.jpg`.
- FQ-09: the "Simulator" button's picture is `glyph_keyboard_enter.png`. Enter selects the big native bridge button, not "Simulator". Evidence: `04-connect-after-safety.jpg`.

### Seen and not counted as defects

- The sim cursor is drawn over the "NEW RECORD!" ribbon and over labels on some screens (it is the simulator's pointer).
- A combo of 8 to 10 fruit in one row puts the score popups on the combo banner (`31-fruit-cut-row-a-90ms.jpg`, `c10-combo-x10.jpg`): a stress case, the banner is drawn behind the objects on purpose.
- The first arrow key press on a menu or on settings only shows the focus ring; the second one moves it. The settings screens start with the focus on "Back".
- On the native path with a Right Joy-Con, `R` cycles the two columns and the (physically absent) `L` does nothing, as designed.
- Esc during the 3-2-1 countdown does nothing; blur during it pauses.
- A key pressed within the first second after the page loads is ignored by the first screen (a person cannot do that).

## 2. Re-check of the open items of round 3

| Round-3 item | Status in this run |
|---|---|
| R3-01 "Simulator" button starts Arcade by itself | **Fixed.** Connect screen, click "Simulator", no mouse movement: menu after 2.5 s and still the menu after 5 s. Same for "Mouse only" (`t19_safety_connect.json`) |
| R3-02 the wizard's last cut arms the dwell, Arcade starts by itself | **Fixed.** `?input=sim&simcal=1`, three real mouse sweeps over the practice apple (down to (960, 520), down to (960, 450), left to right through it), 6 s of rest each: the menu stayed (`t26_simcal_tail.json`). With the native path and the fake helper the menu also stayed after the practice cut |
| R3-03 menu "Connection" is a no-op with the simulator | **Fixed.** The connect screen stays, with a "Back" button (`a6-connection-button-with-sim.jpg`) |
| R3-05 toasts on other text | Still there, smaller (FQ-02) |
| QA-06 overlaps at the edges of panels | Partly still there (FQ-03, FQ-06, FQ-07); the three disconnect buttons now have clear gaps (`b4-native-disconnected.jpg`) |

## 3. Coverage

| Area | Result |
|---|---|
| `npm test` | **Pass.** 2033 tests, 2033 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo, 140.6 s (run once, with the desktop app's browser pane open on one idle game page during its first minute, and other agents' work on the machine) |
| Cold start | Pass. Time to `__ninja.ready` 278 to 288 ms (546 ms in a freshly started Chrome, which also transferred 20.2 MB: the art is 24 MB on disk), art ready (core 90 of 90 pictures, menu backdrop) after 314 to 330 ms, 194 requests, all to `localhost`, 0 console messages. The first screen is the safety screen |
| Loading of fonts and art | Pass. `DojoDisplay` and `DojoUI` both `loaded`, `getAssets().fonts.state` `ready`. On a slowed network (700 KB/s, 25 ms latency) the boot screen reads "Loading...", the game goes on after the grace time with the pictures still arriving (`f2-loading-2851ms.jpg`, `f9-loaded.jpg`), no console message |
| First-run safety screen | Pass. A click on the locked button (0.8 s) and Enter before 2 s are ignored; the "Reduce flashes" toggle turns on and off; resting the pointer on the unlocked button 1.8 s does not confirm; a click confirms; the agreement is stored; a reload goes straight to the connect screen |
| Connect screen | Pass. Native path through the fake helper: Enter presses the big button, every progress line in order (checking, starting, waiting for Bluetooth, looking, found, services, preparing, first data, Connected), "Time left" counts from 45 s. Failure scenarios: permission (red text, button live), Bluetooth off (live), no device (live), connect failed (button greyed "Try again in 9 s", Enter during it does nothing). "Simulator" and "Mouse only" by click, keyboard focus order of the five buttons, Chrome's Bluetooth path with a stub chooser ("No Joy-Con chosen. Try again when you are ready."), the diagnostics page (`e0-diagnostics-sim.jpg`, no console message, no external request) |
| Calibration | Pass. Native path: step 1 (still), 2 (point), 3 (centre with ZR), 4 (practice apple, cut), then the menu. Simulator wizard with `?simcal=1` (step 4 shows the apple). Screens `13` to `16`, `c23`, `c24` |
| Menu, keyboard | Pass. Arrows walk Classic, Arcade, Zen and the three buttons, Enter starts a mode or opens a button, Esc in the menu does nothing |
| Menu, stick, A and B (fake helper) | Pass. One flick is one move (a 1.2 s push moved once), A opens Settings and Calibration, B goes back from calibration, tuning and settings and resumes from the pause panel, `+` pauses |
| Settings, every row | Pass. By keyboard (all nine rows reached; left cell On and right cell Off for the switches), by mouse (every cell), by stick with R hopping the columns (all nine rows). Limits clamp: sensitivity 0.3 to 2.0, slice threshold 100 to 700, volume 0 to 100 %. One click on a stepper is one step. Values persist in `localStorage`. Reset high scores asks first and Esc cancels |
| Presets and sword tuning | Pass. Relaxed 0.6, Standard 1.0, Fast 1.5; Easy 225, Normal 300, Hard 450; practice fruit cut by `simSwing`; PageUp/PageDown and R hop the columns; Esc and B leave |
| "Sword selection in menus" | Pass. Off: a fast swing over a mode fruit selects nothing. On: the same swing starts Classic (native path, relative pointer) |
| Three modes, countdown to results | Pass. From a menu cut: transition, 3-2-1-GO (`41-*-countdown.jpg`), play, results. Classic ends by 3 lives at 20 s (Game over), Arcade ends at 64.0 s (60 s plus one Clock), Zen at 90.0 s. Results show score, best, rank, five or six statistics, "NEW RECORD!", "Play again" and "Menu" |
| Every fruit whole and cut, Golden Apple, bomb, power-ups | Pass. All 16 object types spawned side by side and cut (`30` to `35`). Hit radius equals round(r x 1.55) + 14 for the 10 fruit, 1.6 for the Golden Apple, 1.5 for medallions, 0.85 and no blade width for the bomb (16 of 16). Base scores 10/10/15/15/15/15/20/20/25/30 |
| Rules (section 4) | Pass, 0 failures |
| Combos | Pass. n = 2, 3, 4, 5, 7, 10 give exactly base + 5 n (n - 1); banner tiers pictured (`c02` to `c10`) |
| Pause and resume | Pass. P pauses, the world and the timer are frozen for 3 s, Enter resumes through the 3-2-1, Settings from the pause panel and Back returns to it, "Quit to menu" asks and Esc cancels; blur pauses a round and a countdown and focus does not resume it |
| One-time settings migration notice | Pass. A stored document of version 1 (sensitivity 1.7, threshold 1200, volume 0.4, hand left, best 1234): boots to the menu, sensitivity and threshold reset to 1.0 and 300, the other settings and the best score kept, the document becomes version 2, the toast shows once (7 s), not after returning to the menu and not after a reload |
| Reduce flashes and Reduce motion | Pass as far as measured. Both flags set the settings; the ink wipe becomes a cross-fade with Reduce motion (`80-wipe-*`); a scripted burst (combo x5, bomb, Golden Apple) never gave more than one whole-screen luminance jump per 500 ms in any of the four variants (the measure is coarse: `t15_reduce.json`). Not judged by an eye: a frame-by-frame comparison of the effect strength |
| Window sizes, device pixel ratio 1 and 2 | Pass. 10 sizes from 360 x 640 to 3840 x 2160 (including 1920 x 1080 at ratio 1 and 2, 1440 x 900 at 2, 2560 x 1080, portrait 600 x 1000): the canvas fills the window at the right backing size, the game is letterboxed inside with ink bars, no scrollbars, a click on "Classic" lands, 60.0 fps in each. Live resize during play through six sizes: no break |
| `?assets=0` and `?fonts=0` | Pass. `assets=0` and `assets=off`: no image or font request, paper-and-ink drawing of the menu, fruit, bomb, medallions, halves, stains (`95-assets0-menu.jpg`, `98-assets0-objects.jpg`). `fonts=0`: art on, system fonts. `assets=maybe`: ignored with one console warning, art stays on. Three art files blocked on purpose (apple, a backdrop, a button): the game plays and draws the missing ones procedurally with one warning per partial group |
| 3 minutes of sustained play | Pass (section 5) |
| Console | No error and no exception in any run. Warnings seen: FQ-04, FQ-05, the fake helper's "IMU bytes are all zero" at the start of a connection (by design), `lost_signal` after a scripted drop or crash, the cancelled stub chooser, the illegal flag |
| Network | Pass. 196 requests in a 3-minute soak, 194 in a cold start, 28 on the diagnostics page: all to `localhost`; no external URL anywhere in `public/js`, `public/css`, `public/index.html`, `public/diagnostics.html` (searched) |
| Native path after the connection | Pass. A scripted link drop in a Zen round: the panel opens with "Reconnect in 10 s", "Continue with the mouse", "Back to menu"; the world is frozen (2.4917 s before and after 3.5 s); after 10 s "Reconnect" works, the progress lines run, then "recentering", and the round resumes; a crash of the helper in the round shows "The Bluetooth bridge stopped suddenly..." |
| Mouse provider | Pass. Real mouse moves over a falling fruit cut it (3 cuts in 2 swings, `d2-mouse-real-swings.jpg`) |
| Audio engine | Pass as far as the state goes: none before the first click, running after it (master gain 0.392 at volume 0.7), 21 voices in 12 s of play, 0 errors, 0 dropped |

## 4. Rules checked (window.__ninja, simulator, manual clock)

| Rule | Expected | Observed |
|---|---|---|
| Hit area | cut inside, no cut just outside | cherry (hit radius 88): a swing 80 px from the centre cuts, 100 px misses; kiwi (104): 96 cuts, 116 misses; watermelon (157): 149 cuts, 169 misses |
| Bomb is strict | slow contact never explodes; fast swing 54 px or closer explodes | 200 px/s through it: nothing; fast swing at 70 px: near miss and slow motion only; at 40 px: bomb, slow motion, life lost |
| Classic life | uncut fruit -1 life; bomb -1 life; Golden Apple +1 life below 3, +100 | 3 to 2 at 1.43 s after a fruit fell; bomb 3 to 2; Golden Apple 2 to 3 and +100, at 3 lives stays 3 and +100 |
| Arcade | bomb -50 (floor 0) and -5 s; Golden Apple +3 s; Clock +4 s; never above 90 s | score 30 to 0 (floor), time 59.45 to 54.18 (the extra 0.3 s is play); Golden Apple +2.74 s and Clock +3.74 s measured while the round clock kept running (3.00 and 4.00 minus the play time of the swing); 89.76 s after twelve Clocks |
| Freeze | world at 0.4 for 5 s, round timer in real time | per second of real time: world 0.400 s, timer 1.000 s; over after 5 s |
| Double | x2 for 10 s | a cherry gives 60 instead of 30, over after 10 s; a combo bonus paid while it is on is doubled too |
| Frenzy | 6 s of fruit waves, no bombs | 35 fruit and 0 bombs in 5.8 s |
| Zen | no bombs, threshold 20 % lower | 0 bombs in 60 s of waves (66 objects); a 900 px/s swing (270 deg/s) cuts in Zen (threshold 240) and not in Classic (300) |
| Combo | 5 n (n - 1), n up to 10 | n = 2: 65, 3: 105, 4: 155, 5: 210, 7: 350, 10: 625 (with the fruit's base points); a row of 8 gave 120 + 280 |
| Timers | Classic ends by lives, Arcade 60 s, Zen 90 s | results at 20.8 s (lives), 65.3 s (timer 60 s plus 4 s Clock plus the end), 90.6 s |

## 5. Performance, memory

Headless Chrome 154, 1920 x 1080, art and fonts loaded, the simulator through the whole IMU chain, real clock, a bot cutting about 3 fruit a second, Arcade rounds replayed through "Play again" (a real click). Load average 4 to 7 during the runs.

| Measure | Device pixel ratio 1 | Device pixel ratio 2 (3840 x 2160 backing store) |
|---|---|---|
| Length, frames | 3 minutes, 11 070 frames | 3 minutes, 10 839 frames |
| Frame interval | average 16.67 ms (**60.0 fps**), p50 16.7, p95 16.8, p99 16.8, max 16.8 ms | average 16.67 ms (**60.0 fps**), p99 16.8, max 16.8 ms |
| Frames over 33 ms, 50 ms, 100 ms | 0, 0, 0 | 0, 0, 0 |
| JS heap after a forced collection | 3.25 MB in the menu, 5.86 MB at the end (+2.6 MB, after two full rounds) | 3.21 MB, 5.78 MB |
| Live heap between collections | 4.9 to 11.1 MB, sawtooth | same |
| Whole browser process tree (RSS) | not sampled | 1.75 GB at the start (start-up transient), 1.48 to 1.54 GB from 30 s to the end, no trend beyond that noise |
| DOM nodes | 13, constant | 13, constant |
| Game objects alive | 0 to 7, bounded | same |
| Rounds | 3640 and 3135 points (Master rank) | 3000 and 3220 |
| Requests, external, console | 196, 0, 0 | 196, 0, 0 |
| Real-time reading in the desktop app's browser pane | 59.9 to 60.5 fps at 1024 x 768, device pixel ratio 2, `inputToDrawMs` 7.9 to 11.4 ms (software only, no Bluetooth, no display latency) | |

No frame rate or memory growth finding. These numbers say nothing about the owner's Mac, GPU or display (UNVERIFIED-ON-HARDWARE).

## 6. How to repeat

```bash
# game server for the QA role, with the fake helper behind the native bridge (control file for the person at the sword)
echo '{"seq":0}' > /tmp/qa-control.json
PORT=8302 JOYCON_BRIDGE_BIN="$PWD/test-support/bridge/fake-helper.mjs" FAKE_HELPER_MOTION=model \
  FAKE_HELPER_CONTROL=/tmp/qa-control.json FAKE_HELPER_REPORTS=100000 FAKE_HELPER_STEP_MS=300 FAKE_HELPER_SCAN_MS=1500 node server.js &
export QA_CONTROL=/tmp/qa-control.json          # only the scripts that move the virtual sword need it
cd docs/qa/final-qa/scripts
node t01b_cold_fast.mjs                         # cold start numbers
node t11_modes.mjs && node t13_rules.mjs        # three modes, rules
node t02_native.mjs && node t03_native_menu.mjs # native path: connect, calibration, stick menus
SOAK_DPR=1 node t18_soak.mjs                    # 3 minutes of play, frame intervals, heap
npm test                                        # the whole suite
```

Each script writes its pictures into `docs/qa/final-qa/` and a `t*.json` with its checks. The scripts only read the game: none writes into `public/`, `design/` or `server.js` (checked by checksum). Script `lib.mjs` holds the shared helpers; every script launches and closes its own private headless Chrome.

## 7. Deviations

None recorded in `docs/contract-notes.md` by this role: no contract, document or code was changed. This report and the folder `docs/qa/final-qa/` are the only files written.
