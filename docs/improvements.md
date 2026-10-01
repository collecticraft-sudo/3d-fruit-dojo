# Joy-Con Ninja: improvements round (game feel director)

| Item | Value |
|---|---|
| Role | Game feel director and improver |
| Input | `docs/game-design.md`, the QA reports of rounds 1 to 3, the code reviews, and a backlog of about 60 minor findings (many of them repeated across QA rounds) |
| Build before | 919 of 919 tests green, but the round 3 QA report ended **FAIL** with two major findings that were still open (R3-01, R3-02) |
| Build after | 977 tests green with the Chrome e2e suite running (0 skipped), 60.0 fps and 0.33 ms of JavaScript per frame in headless Chrome at 1080p |
| Language | English. In-game text is English too. |

**Read this first, honestly.**

- **Nobody played with a real Joy-Con 2, and I did not either.** Everything that depends on the physical device stays **UNVERIFIED-ON-HARDWARE**. Every new number of this round is a starting value for the owner to tune (the new tuning screen is exactly the tool for that).
- **What I actually did to "play" the game.** (1) I drove all three modes to the end with a scripted bot through `window.__ninja` in Chrome's built-in browser pane under the manual clock (`?clock=manual`), and took screenshots of the menu, settings, tuning screen, countdown, combo banner, power-up banners, pause panel, results, disconnect overlay, safety screen and calibration steps. (2) I ran headless Chrome end to end tests on the **real clock** with **trusted mouse events** (the two round 3 majors, the tuning screen, the 60 fps smoke). (3) I wrote a small physical-demand probe (a bot with a finite cursor speed and a reaction delay playing the real `Game`, scratch code, not shipped) to look at the difficulty curve. No human played. I heard nothing: the audio was muted or synthetic, so **sound was not judged**. The browser pane renders at about 20 fps (software), so **real-time feel was not judged there**; the 60 fps figure comes from headless Chrome on the development Mac and says nothing about the owner's machine.
- Bot numbers below are estimates about the *shape* of the curve, never claims about a human or about the sword.

## 1. Critique of the build against the design

| Question | Honest answer |
|---|---|
| **Is cutting satisfying?** | On screen, yes and readable: every cut gives two halves with flesh, seeds and skin, a juice stain on the paper, droplets, a score popup and a slash mark; a combo gets a brush-stroke banner, ink stars and slow motion (screenshot of a four-fruit swing: `COMBO x4!` with `+60`). Two things spoiled it: the **near-miss slow motion and "So close!" fired before every real bomb hit** (QA-02), and the small `COMBO` label landed on the big banner word. Fixed. The hit feel in real time and all audio are not judged. |
| **Difficulty curve and arm fatigue** | The design tables are fair for a 2 to 4 minute Classic run. The probe (Classic, bot with a 2500 px/s cursor, 250 ms reaction) cuts 100 % of 536 fruit in 240 s and needs only about **35 degrees per second of arm travel on average** and about 2.2 separate swings per second when it ignores combos; a slower bot (1500 px/s, 400 ms) dies at about 176 s in stage 6, which matches the design's "median 2:00 to 4:00". The steepest part for a **cold arm** was the start of **Arcade**: 1.79 fruit/s from the first wave and bombs from 5 s. Softened to 1.5 fruit/s for the first 15 s (section 3, item 10). Arcade stages A3 and A4 (3.0 to 3.3 fruit/s for 30 s) remain the part to watch for fatigue with a heavy sword: levers are `CONFIG.modes.arcade.stages` and the threshold preset "Easy". |
| **Are the hit boxes forgiving?** | *(Quoted from the improvements round of 2026-09-30, measured with the OLD hit radii: 1.25 x the drawn radius, no blade width. Since 2026-10-01 the fruit circles are 1.55 x plus a 14 px blade half width, after the owner found the boxes too small on the real sword; those numbers were not re-measured, so read them as a lower bound for fruit. `docs/contract-notes.md`, gameplay engineer entry of 2026-10-01.)* Yes for the fruit. The same probe with a deliberate aim error (cursor off the predicted centre in a random direction), OLD radii: 0 px 100 %, 40 px 100 %, 70 px 100 %, 100 px 98 %, 140 px 91 % of fruit cut. The 1.25 x hit circle was enough at the time; I left it. The bomb circle (0.85 x, 54 px) is tight on purpose and a slow touch never explodes it. What was NOT forgiving was latency: a fruit that moves at 1300 px/s was tested 40 to 80 px ahead of the circle the blade actually crossed (m2). Fixed. |
| **Is the feedback juicy but readable?** | Mostly. Readability problems found and fixed: power-up banner subtitles straddled the lower edge of the brush band (QA-04), the combo label over the banner word, toasts landing on the menu title and on the mode name, the pause title sitting on the timer ring, the pause panel showing through the disconnect overlay. |
| **Are the in-game texts clear?** | Yes. Two fixes: calibration step 1 said "you may also rest the sword" without saying that the tip must stay up (a player could lay it flat and get "The two poses are too similar"), and the refusal text for an unusual sensor reading blamed the player for what can be a sensor property (R3-06). New texts are listed in `docs/contract-notes.md`. |
| **Do the connect and calibration screens make sense to a first-time user?** | The four wizard steps each have one illustration, one sentence and a progress ring, and "Just recenter" is offered for the same grip. They make sense. The real problem was the **first contact after the wizard**: the practice cut ended on the menu in mid-swing and the menu started "Arcade" by itself (R3-02), and on the simulator path a click on "Simulator" started "Arcade" by itself 0.95 s later (R3-01). Both major, both fixed. The wizard is still repeated at every launch (not changed, see section 5, m11). |
| **Is the visual polish consistent?** | It was, apart from about ten collisions: results buttons on the panel border, disconnect buttons touching, menu names touching the fruit, safety toggle against the button, toast on the title, countdown title on the timer ring, rank word as wide as its seal. All fixed and checked on screenshots (section 3, item 7). |

## 2. Test evidence

| Run | Result |
|---|---|
| `npm test` before | 919 tests, 0 fail, e2e ran (0 skipped) |
| `npm test` after | **977 tests, 0 fail, 0 skipped** (58 new tests; about a dozen old ones were adjusted because they pinned numbers or coordinates that changed on purpose: the 100 ms combo grace, the 1.2 s results lockout, the results and settings button positions, the Arcade A1 fruit rate, the menu fruit height, the rest needed before a dwell arms) |
| Mutation checks | Each new regression test was run against the old behaviour (guard removed or old code restored) and fails there: R3-01 and R3-02 (app level and UI level), the near-miss rule, the back-projection, the monotonic clock, the GATT chain, the mask memory, the late first report hold-off, the `t < lastT` clamp, the repeated disconnect event, the stale menu segments, the g0 in step 3. The two guards that cannot be reached through the public API (see section 5, n2) are documented instead of tested. |
| Real browser | `test/e2e/improvements.test.js` (real clock, trusted mouse): R3-01 does not start a round for 4.8 s after the click; the tuning screen opens from the menu by clicks and a simulated swing changes no setting. `test/e2e/perf.test.js`: 1210 frames in 20 s, 60.0 fps, p99 16.8 ms, JavaScript 0.33 ms per frame on average, degrade level 0. |
| Play-through | All three modes played with the bot in Chrome under the manual clock, once in the middle of the work and again on the final code through the real countdown (Zen to the results screen at 90.6 s, Arcade to the results screen at 64.3 s, Classic stopped at 150 s with 2 lives left; the one bomb the bot hit came with no near-miss event before it). No console error and no `frame failed` in the app log; only the expected wake-lock refusal of an unattended tab. |

## 3. Change list, most valuable first

Each entry: what it was, what it is now, why. File names are relative to the project.

### 1. Menu dwell counts REST, not time in a target (R3-01, R3-02, R3-04, R3-03)

- **Before.** (R3-01) On the connect screen a click on "Simulator" made the pointer the cursor, then the simulator's first sample landed on the "Arcade" fruit and its dwell ran 0.9 s: a round started by itself, 8 of 8 times. (R3-02) The last practice cut of the wizard ended on the menu in mid-swing; its follow-through moved the cursor more than 100 px, which re-armed the dwell, and the cursor came to rest on "Arcade": a round started by itself about 1 s after every calibration. (R3-04) The dwell counted time inside a target, so a slow aim across a mode fruit (100 to 500 px/s) selected it. (R3-03) "Connection" flashed the connect screen and went back after 211 ms when the provider was the simulator.
- **After.** The UI keeps a displacement based **rest** tracker (the cursor stays within 70 px of where the rest began: tremor-proof, unlike a speed gate, and a slow aim always breaks it). The dwell runs from the later of "entered the target" and "began to rest". A disarmed dwell arms after 300 ms of rest, never while the blade is cutting or carried by the references, and, when resting on a target, only if the player moved the cursor by hand more than 100 px. A change of cursor source (pointer to sword) disarms. On the connect screen reached from the menu, only the provider the player picked there sends the player back.
- **Why.** The QA report calls these major because they break design pillar 4 (fair failure) at the very first contact, on the README's own first step. The rest definition is what the README and the design always said ("rest the cursor").
- **Files.** `public/js/ui/ui.js`; docs: README, design 12.6, architecture 8.3. **Tests.** `test/ui/dwell-rest.test.js` (7 tests, including a tremor of +-15 px that must still select), `test/app/improvements.test.js` (R3-01 and R3-02 through the real app), `test/e2e/improvements.test.js` (R3-01 in Chrome, real clock).
- **Constants to tune on the sword.** `UI_TIMING.restRadiusPx` 70, `armRestMs` 300, `armMovePx` 100. UNVERIFIED-ON-HARDWARE (HW-3, HW-9): if the real hand trembles more than 70 px (2.5 degrees) the dwell will keep restarting; raise the radius.

### 2. Sword tuning screen "Sword tuning" (did not exist)

- **Before.** The settings screen had two steppers and a thin speed bar. There was no way to see what the last swing measured against the threshold, whether the screen corners were reachable at the chosen sensitivity, or to feel the threshold on a fruit, which is the only thing the owner can tune on the real sword.
- **After.** Settings has a third button, "Sword tuning". The page shows: the two steppers with presets Easy 700 / Normal 1000 / Hard 1500 and "Default values"; a live speed bar with the threshold marker and a peak-hold tick; "Last swing: N px/s" with a plain verdict ("Slices: above the threshold" or "Too slow: 1000 px/s needed"); a **reach test** (four corner rings that light up, the covered percentage of width and height, and what the screen width means in degrees of rotation, 70 at sensitivity 1.0); and three **practice fruit** to cut (a swing through all three cuts all three, they return after 1.4 s). Only the practice fruit react to a cut: the steppers and buttons on this page are selected by dwell, click or Enter, because the player swings all over the screen here and a stepper that a swing could press would change the values being tuned (I saw exactly that happen in my first browser session). A hint line in the menu points first-time players to it until they open it once.
- **Why.** The task asked for it "if it does not exist". It turns HW-2, HW-3 and HW-9 from guesses into two minutes of work for the owner. The page writes the two settings the game already has and adds no gameplay rule.
- **Files.** `public/js/ui/screens/tuning.js` (new), `public/js/ui/ui.js`, `public/js/ui/layout-data.js`, `public/js/ui/screens/settings.js`, `screens/index.js`, `presentation.js` (tuneCut effect), `strings.en.js`. Docs: README "Sword tuning screen", guide section 7 ("Tuning the sword on the real hardware"), design 12.7.1. **Tests.** `test/ui/tuning.test.js` (8 tests: navigation, steppers, swing not pressing buttons, dwell, peak and verdict, reach and corners, practice fruit, drawing with legal text sizes), plus the layout test now covers the page (84 px targets, no overlaps) and an e2e test.

### 3. "So close!" only after the swing has passed the bomb (QA-02, both backlog copies)

- **Before.** The approach segments of a swing that really hit a bomb were inside the 54 to 120 px band, so `nearMiss` (popup, 0.5x slow motion, sting) fired 33 to 75 ms before the explosion, for every hit speed, angle and offset that was measured.
- **After.** A bomb in the band is only judged when the swing has passed it: the closest point of the chord is behind the chord's end (for a swing that was seen closing in inside the band) or in the middle of the chord. While the blade is still approaching nothing is decided; a swing that starts inside the band and moves away earns nothing. Passes at 60, 80 and 110 px still earn exactly one near miss, 130 px none, 45 px and closer hit.
- **Why.** Design 9.3 says the near miss "rewards a swing that misses". It must not precede the explosion it is meant to contrast with.
- **Files.** `public/js/game/game.js`. **Tests.** `test/game/feel.test.js` (hits at 1500, 3000, 6000 px/s and offsets 0, 30, 45 px give no near miss; passes give one; moving away gives none). Design 9.3 updated.

### 4. Hits are judged where the fruit was when the blade crossed (m2) and combo clocks run on arrival time (m10, R3-n4)

- **Before.** Objects are at the last simulated tick but blade segments are stamped up to the input latency in the past: a 1300 px/s fruit was tested 40 to 80 px ahead of the circle the player swung through. The combo grace (100 ms) and window (250 ms) compared the frame clock with those older stamps, so a 40 to 60 ms Bluetooth latency silently shortened them and a 100 ms delivery hiccup could split a swing's combo.
- **After.** A segment rewinds the objects along their arc by `simNowMs - segment.t1`, capped at 100 ms and scaled by the current time scale (reported positions stay the drawn ones). Combo windows are measured from the **arrival** of the last cut and segment, and the close grace is 150 ms instead of 100 so that a 100 ms hiccup inside a swing keeps the group. `__ninja.swing()` now waits 180 ms (was 120) for the combo close event.
- **Why.** Both are latency effects that only show with a real link, exactly where nobody can measure. The fixes are deterministic, cheap, and do nothing when latency is zero, which is why the existing tests passed unchanged except those that pinned the 100 ms grace and the 120 ms swing tail.
- **Files.** `public/js/game/game.js`, `combo.js`, `config.js` (`time.maxBackProjectMs`, `combo.closeGraceMs`), `public/js/ninja-api.js`. Constant names are in `docs/contract-notes.md`. UNVERIFIED-ON-HARDWARE (HW-1, UOH-4, UOH-8): the real latency and whether the device stamps are stable. **Tests.** `test/game/feel.test.js` (back-projection including the cap, arrival clocks, a 120 ms hiccup, the monotonic clock).

### 5. Results and round flow (QA-03, QA-06)

- **Before.** The 1.2 s input lockout started with the 400 ms slide-in, so buttons were live 0.8 s after the panel was fully visible. The two buttons straddled the panel's bottom border and the break banner touched them.
- **After.** The lockout starts when the panel is in (inputs are accepted 1.6 s after the screen starts). The panel is 1240 x 880 and the buttons (380 x 120) are inside it, with the lockout bar; the break banner sits above them. The rank seal is 230 px so that "Apprentice" (the word every new player sees) clears its inner border (R2-02).
- **Files.** `layout-data.js`, `screens/results.js`, `widgets.js`, `ui.js`, `config.js` (`results.slideInMs`). **Tests.** `ui-play.test.js` (lockout numbers), `test/render/polish.test.js` (buttons inside the panel).

### 6. Readability fixes (QA-04, QA-05, QA-06, R3-05)

- Power-up banner: a taller band (ink y -78 to +78) and the title and subtitle placed inside its ink (subtitle baseline +56): "Time slows down", "Points ×2" and "Fruit only, no bombs" are now light text fully on the dark band (screenshot checked).
- The small `COMBO` label above the bonus is no longer drawn while the combo banner already says it.
- Toasts: on the menu at y 302 (between tagline and fruit) instead of 200, where "Crosshair recentered" landed on the title; countdown mode title at y 330 instead of 190, where it sat on the timer ring and its "TIME" label; pause title at y 270 (was 190), clear of the timer ring and its label.
- The pause panel is not drawn behind the disconnect overlay (its title and tip used to show through).
- **Tests.** `test/render/polish.test.js` (9 tests checking where things are drawn).

### 7. Layout collisions (QA-06)

Menu fruit 20 px higher, names 20 px lower, descriptions 16 px lower and records 11 px lower (the names no longer touch the fruit); disconnect panel 900 x 640 with three 84 px buttons and 16 px gaps; results buttons inside the panel (item 5); safety toggle moved 10 px up and the confirm button shortened to 120 px, so they no longer almost touch; pause title clear of the ring. Every selectable target stays at least 84 x 84 px and no two overlap (`test/ui/layout-data.test.js`).

### 8. Performance governor recovers (m3), GATT chain waits for the real operation (m4), remembered working mask (n3), discovery retry (n9)

- **Governor before.** It only escalated: one slow 2 s window (JIT, a pairing prompt, Energy Saver) halved the particles for the whole session and, at level 3, dropped the canvas to 1x. **After.** Three consecutive windows at 57 fps or better lower the level by one; after two flaps (re-escalation within 30 s of a recovery) it stops recovering, so a machine that genuinely needs the lower level does not oscillate. `presentation.js` resizes the canvas when the level crosses 3 in either direction.
- **GATT before.** `serial()` chained the timed wrapper, so after the response subscription timed out at 3 s while still pending, the next write could overlap it ("GATT operation already in progress"). **After.** The chain waits for the raw operation, capped at 10 s (`INPUT_CONFIG.serialHangCapMs`) so a dead link cannot block every later write. The fake device models a slow subscription (3.6 s) and records overlaps: zero now.
- **Mask.** After watchdog stage 2 found that a fallback mask works, every reconnect repeated the 4.5 s no-data stage first. The mask that worked is remembered in `lastConnectOpts.mask`; a fresh `connect()` still starts from the default.
- **Discovery.** A `NotFoundError` at service discovery was classified "not a Joy-Con" and started the cooldown. It is now asked once more after the settle time before the verdict (UNVERIFIED-ON-HARDWARE whether Chrome on macOS has such a race).
- **Tests.** `fx.test.js` (governor), `ble-transport.test.js`, `ble-provider.test.js` (`serviceNotFoundFirst`, `streamStartDelayMs`, `respSubscribeMs` are new fake-device behaviours).

### 9. Calibration and diagnostics honesty (n7, R3-06, R3-n1, m1, n10, F5, R3-n2, step 1 text)

- A calibration now belongs to the unit and side it was made with: connecting another device name or the other side clears it (new UI intent `clearCalibration`) and the wizard runs from the connect screen, instead of silently pointing the cursor wrongly.
- The refusal text for an unusual resting |a| says "or reads an unusual value" and tells the player to rest the sword on a flat surface (R3-06); calibration step 1 says the tip must stay up even when resting it.
- The diagnostics rest check no longer shows a red cross for a sensor the game accepts: verdicts **OK**, **OK for the game** (|a| inside 0.85 to 1.15 g, the game divides by it) and **KO**; the sign test starts at a resting 1.09 g (it waited for ever above about 1.08 g). The page lists the saved gyro scale and accelerometer sign and has **"Clear the saved values"** (before: only `localStorage.removeItem` in the developer tools). It shows the IMU marker byte at 0x29 (expected 0x01) and warns when it differs.
- `getDebug().accelG0` is exposed and a test pins that step 3 already uses the learned g0 (a mutant survived before).
- **Tests.** `calibration-device.test.js`, `diagnostics-tools.test.js`, `calibration.test.js`, `test/e2e/diagnostics.test.js`.

### 10. Tuning of numbers

| Number | Before | After | Reason |
|---|---|---|---|
| Arcade stage A1 (0 to 15 s) | 1.40 s interval, 2 or 3 fruit (50/50), 1.79 fruit/s | 1.60 s, 2 or 3 fruit (60/40), **1.50 fruit/s** | warm-up for a cold arm; a full round throws about 154 fruit instead of 158. Ranks unchanged. Design 3.2 updated. |
| Combo close grace | 100 ms from the stamp | 150 ms from the arrival | item 4 |
| Results lockout | 1.2 s from the screen start | 1.2 s from the panel fully in | item 5 |
| Rail buttons SL and SR | re-centre | not mapped (n4) | the rail is where a 3D-printed mount or strap touches the Joy-Con; a phantom re-centre mid-swing is the worst accidental action. R, ZR, L, ZL still re-centre; Space, double click and the automatic soft centring too. UNVERIFIED-ON-HARDWARE (HW-6, UOH-10). |
| Dwell | 900 ms inside the target | 900 ms of rest, see item 1 | item 1 |

I did **not** change the cut threshold (1000 px/s), the sensitivity (1.0, 70 degrees across the screen), the hit multipliers, the bomb rules or the life rules: there is no honest basis for moving them without the real sword, which is what the tuning screen is for.

### 11. Small hygiene that the backlog listed

`swingThrough` returns a rejected promise for every failure (n6); menu segments older than 250 ms are dropped, and the queue is drained when a tab becomes visible again (n5: 21 aim samples across "Quit to menu" used to open its dialog); page-level listeners are removed in `dispose()` (m8); `snapshot().events` is rebuilt only when an event was emitted, with frozen shared elements (m6, n8); `storage.getSettings()` returns one shared frozen object until a setting changes (n8); `connect-model.js` reads `INPUT_CONFIG.longCooldownAfterFailures` (m5); the server has an error handler after `listen` (n11); the menu "Recalibrate" with the mouse provider answers "No calibration is needed with the mouse." (QA-07); `npm test` **fails** when Chrome is missing unless `E2E_OPTIONAL=1` (n1, m7).

## 4. How to tune on the real sword (the short version)

1. Menu, "Settings", "Sword tuning".
2. Reach: touch the four rings. If you cannot, raise the sensitivity; if the cursor is nervous, lower it.
3. Threshold: swing as in the game, read "Last swing" and the verdict; keep the aiming speed clearly under the gold mark and a relaxed flick clearly over it.
4. Cut the three practice fruit.
5. If menu selection by resting feels jumpy, `UI_TIMING.restRadiusPx` (70) is the number to raise; if a swing of the wizard still selects something, `armRestMs`.

## 5. Backlog disposition (every item, nothing silently dropped)

Legend: **fixed** = changed and tested; **docs** = the documents now say the true thing; **no** = not done, with the reason.

| ID | Status | Note |
|---|---|---|
| QA-02 / "So close! before every hit" (both copies) | fixed | item 3 |
| QA-03 / results lockout | fixed | item 5 |
| QA-04 / banner subtitles | fixed | item 6 |
| QA-05 / countdown shorter and title on the timer | partly | title moved (item 6). The duration is unchanged: 3 x 0.8 s and GO 0.6 s as the design table says; the separate 1 s mode-name phase of design 12.8 was never built and I did not add it (it would only lengthen the wait of a player who wants to take position). |
| QA-06 / layout collisions, R2-02 | fixed | items 5, 6, 7 |
| QA-07 / "Recalibrate" dead with the mouse | fixed | toast |
| QA-08 / simulator re-centre undone after a pointer pause | no | simulator only. The simulator maps the mouse to an **absolute** orientation and treats 200 ms of silence as a teleport; a relative re-centre would need a different model. The real Joy-Con path is not affected; listed in README known limitations. |
| QA-09 / simulated loss: Try again not locked, no cooldown text | no | simulator only (QA round 3 confirmed the Bluetooth path shows "Try again in 9 s"). Listed in README. |
| R2-03, m9 / docs say the simulator calibration "runs by itself" | docs | README and guide |
| R2-04 / pause "Recalibrate" resumes the round | docs | recorded as deliberate in `docs/contract-notes.md` |
| m1, n10 / saved values cannot be cleared, no docs | fixed, docs | diagnostics button, README and guide; the game itself still does not show that a saved value is in use |
| m2 | fixed | item 4 |
| m3 | fixed | item 8 |
| m4 | fixed | item 8 |
| m5 | fixed | item 11 |
| m6, n8 | partly | `snapshot().events` and `getSettings()` no longer allocate per frame. `motion.recent(260)`, `headAt`, the provider status copy and `Emitter.emit`'s slice are unchanged: measured cost 0.33 ms per frame, cleanup only. |
| m7, n1, n2 | fixed, partly | e2e fails without Chrome (item 11). Mutants now caught: `t < lastT` in report-stream, the monotonic clock in `Game.update`, the `holdOffRecenter` call in `becomeStreaming` (a slow controller: late first report), the `alive` guard of `gattserverdisconnected` (a repeated event). **Not caught, on purpose:** the `gen` guard in `onReport` of `ble-provider.js`: `close()` removes the link's listeners before a newer attempt can exist, so no report of an old attempt can arrive through the public API; it is defence in depth and I would not write a test that reaches into the closure to prove it. |
| m8 | fixed | item 11 |
| m10, R3-n4 | fixed | item 4 |
| m11 / calibration not persisted | no | a product feature, not a tuning: it needs a stored calibration with validation, a "use the last one" path and a hint when the strap moved. The design (12.5) says the strap may have moved and the result is not trusted across sessions. Recommended next step once the owner knows the mount is rigid. "Just recenter" stays the quick path. |
| F4 / gyro scale disputed (8.14x) | no | cannot be settled in software; the wizard and the one-revolution tool pick either (UOH-6). Unchanged. |
| F5 / marker byte 0x29 | fixed | shown and warned on the diagnostics page; the parser still never rejects a report for it (every source carries only report 0x05 on that characteristic). |
| F6 / vibration unconfirmed | no change needed | it is only sent with `?haptics=1` (default off), to the whitelisted command characteristic, rate limited, errors swallowed. Keep it off until the owner tests it (UOH-13). |
| n3 | fixed | item 8 |
| n4 | fixed | item 10 |
| n5, n6, n7, n9, n11 | fixed | items 8, 9, 11 |
| n12 / holes of 200 ms to 1 s are not integrated | no | documented behaviour, tunable on the real sword (UOH-4) |
| R3-01, R3-02 (majors) | fixed | item 1 |
| R3-03, R3-04, R3-05 | fixed | items 1, 6 |
| R3-06 | partly | the text now names both causes; the flow still refuses a sensor outside 0.85 to 1.15 g, as designed (UOH-3) |
| R3-n1, R3-n2 | fixed | item 9 |
| R3-n3 / the sign-unknown notice is lost after the practice cut | no | the notice string is too long for a toast pill and there is no place for it on the menu; the player still gets it on the practice screen with the "Redo" button. |

## 6. Risks and what is still UNVERIFIED-ON-HARDWARE

- **Dwell radius and arm time (HW-3, HW-9).** 70 px and 300 ms were chosen for a tremor of a few pixels; a heavy sword with a real hand may need more. The tuning screen cannot measure tremor directly; raise the constant if the progress arc keeps restarting.
- **Back-projection and the 150 ms combo grace assume a constant input latency** (HW-1, UOH-4, UOH-8). If the real link has jitter above about 100 ms the cap and the grace are the two numbers to revisit.
- **The rail buttons no longer re-centre.** If the owner prefers a rail button for re-centring, it must be a deliberate choice after testing that the mount does not press it (HW-6).
- **Tuning screen numbers** (250 px/s swing minimum, 0.25 s quiet, ring radius 46 and reach 70 px, the 4000 px/s bar) are starting values.
- **The probe bot is a model.** It says that the curve is smooth and that the OLD hit circles (1.25 x, replaced by 1.55 x plus 14 px on 2026-10-01) forgave aim errors up to about 100 px; it does not say how tiring a real sword is.
- **Sound, real-time feel and the physical Joy-Con were not judged.**
- **Design documents changed in this round:** `docs/game-design.md` (3.2 A1, 5.4, 9.3, 12.6, 12.7, new 12.7.1, 12.8, 12.10, 12.11, 13.3 `cal.s1.text`, Appendix A), `docs/architecture.md` (recenter table, UI states, `clearCalibration` intent, `cutCount` window), `docs/contract-notes.md` (two new entries), README and the setup guide.

## 7. Re-verify

```bash
cd joycon-ninja
npm test                          # 977 tests, Chrome e2e included
npm run test:unit                 # without the browser
node --test test/ui/dwell-rest.test.js test/ui/tuning.test.js test/game/feel.test.js test/render/polish.test.js
npm start                         # http://localhost:8137/?input=sim  then Settings, Sword tuning
```
