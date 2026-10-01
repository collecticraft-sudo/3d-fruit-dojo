# 3D Fruit Dojo: art QA, round 1 (black box, the player's view)

| Item | Value |
|---|---|
| Role | QA tester, round 1 of the art integration (docs/assets-integration.md) |
| Build under test | the project folder as found on 2026-09-30 (no source file was changed by QA; `public/` and `design/` were hashed before and after and are identical) |
| Server | `node server.js` on port 8221, started and stopped by QA (servers on 8200 and 8210 were not touched); a copy of the project under the scratchpad served the missing-image tests |
| Screenshots | `docs/qa/art-round-1/` (62 files, 12 MB): single frames plus contact sheets named `sheet-*.jpg`, all JPEG |
| Verdict | **PASS**: 0 critical, 0 major, 9 minor |

> **HARDWARE HONESTY.** Nobody touched a Joy-Con. Every run used the simulator (`?input=sim`), the mouse path or `window.__ninja`. Nothing below says anything about the real controller. Frame rates are from a headless Google Chrome 154 (GPU: Apple M5 through ANGLE Metal) and from the Claude desktop app's browser pane (Chromium 152) on the development Mac, not from the owner's display. The machine was not idle (load average 7 to 8 from other processes during the runs), which makes the frame numbers conservative if anything.

---

## 1. Summary

The art is on screen everywhere it should be: logo, panels, buttons, steppers, toggles, timer ring, lives, power-up tray, cursor, blade brush, every fruit whole and cut, the golden apple, the bomb with its explosion, the four medallions, the splash stains, the four stage backdrops and the controller glyphs. Three full rounds (Classic, Arcade, Zen) were played from the menu through the countdown to the results screen through real pointer clicks. The game held 60 fps for 3 minutes at 1080p (device pixel ratio 1) and at a 3840 x 2160 canvas (ratio 2), with a flat memory curve, no console error, no exception and no network request outside `localhost`. Every fallback that was tried (one image missing, a whole group missing, corrupt files, a dead manifest, slow and hanging files) ended in the painted drawing for that piece and a playable game. Seeded rounds play out to the same score and the same snapshot fingerprint with and without the art.

What needs a decision or a touch-up is small (section 3): the secondary text on the night menu misses the project's own 3:1 contrast target by about 5 percent on three lines, the HUD sits on busy art in Arcade and Zen, and a few alignment and failure-case looks.

`npm test`: 1665 tests, 1665 pass, 0 fail, run twice (before and after all other work). The task text said 1199 at the start; the workstream has added tests since.

## 2. What was run, how, and what was not

| Tool | Used for |
|---|---|
| Headless Google Chrome 154.0.8037.58 driven over the DevTools protocol with the project's own `test-support/e2e/cdp.js` and `chrome-launcher.js` | almost everything: screens, rounds, measurements, fallbacks, resize, dpr, network and console capture, canvas read-back |
| The Claude desktop app's built-in browser pane (Chromium 152) | one live 67 s Classic round at dpr 2 (3840 x 2160 canvas) and two screenshots; the pane reports `document.hidden = true` yet ran the loop at 60 fps |
| Two clocks | real clock for timing, fps, loading and memory; `?clock=manual` with `__ninja.advance()` for deterministic play and frame-by-frame captures |
| Input | real CDP pointer and keyboard events for the UI path (safety, menu, pause, quit, settings), the in-page `__ninja.swing/swingThrough` bot for play, `__ninja.sim.setTarget` for frame-stepped cuts |

Induced conditions are labelled where they appear: request interception added delays (boot screen, slow core, slow stage) and failures (404, hang); the copy of the project had files deleted, truncated or replaced.

**Not verified, and why**

* The real Joy-Con, its latency, the native Bluetooth bridge, and the disconnect panel variant that shows the sync glyph (it needs the fake helper of `test-support/bridge`, which would need a second server port; not run).
* Sound was not listened to (headless, `--mute-audio`). The audio engine was checked for state only: it became ready, played the slice and bomb voices, reported 0 errors, and the volume setting is stored and applied.
* Other browsers, touch input, a real 4K display, a slow spinning disk (only simulated by delays).
* Headroom above 60 fps: the loop is capped by the display refresh, so "60" is a ceiling. Main-thread busy share was measured instead (section 5).

## 3. Findings

No critical and no major finding. Severity uses the scale of the brief. Each item has a repro.

| # | Sev | Area | Finding | Repro |
|---|---|---|---|---|
| F1 | minor | Night menu, readability | The three mode descriptions on the menu ("3 lives. Don't let the fruit get away!", "60 seconds. Bonuses and bombs.", "90 seconds. No bombs, no stress.") are drawn in `inkText2` (#4E4740) on the veiled night stage at a contrast of **2.85, 2.85 and 2.89 to 1**. The project's own target is 3 to 1 (docs/assets-integration.md 4.2, `veil.menu` 0.58). The tagline (3.13) and the connect, tuning and calibration texts (3.3 to 3.6) pass; the footer hint passes (4.8). The lines are readable in the screenshots, hence minor. | Open `/?input=sim&skipsafety=1`, wait 1 s for the stage, read the canvas at x 262 to 698, y 812 to 842 (or see `04-menu.jpg`): darkest text pixel (78, 71, 64) against a background of relative luminance 0.278. The guard test measures a different spot, which is why it passes. Fix options: a stronger veil near the bottom or ink instead of `inkText2` for those lines. |
| F2 | minor | HUD over the near layers | In Arcade the SCORE and BEST texts and the power-up tray icon (Freeze, Frenzy, Double) sit directly on the lantern cluster, and in Zen on the cherry branch. The paper halo keeps every glyph legible, but the tray ring merges with the lantern outlines. | Start Arcade (`sheet-powerup-hud-tray.jpg`, `sheet-arcade-play.jpg`) or Zen (`sheet-zen-play.jpg`), look at the top-left corner. |
| F3 | minor | Pause screen | A tip toast ("Slice several fruits in one swing to make a COMBO.") can sit behind the "Paused" title and touches the "TIME" caption of the ring above it. Not caused by the art (the toast and the title positions are older) but visible in the art build. | Play Arcade in real time for about 20 s, pause with a middle click (`sheet-real-time-player-path.jpg`, frame 5; `pause-1-paused.jpg`). |
| F4 | minor | Settings, alignment | The toggle picture is narrower than its row and is centred at `col.x0 + 220`, so the four toggles do not start under their labels (Reduce flashes: label at x 140, picture from x 215). Hit boxes are larger than the picture, so nothing is lost. Hand (Right / Left) stays painted and looks different from the art toggles, as designed. | `05-settings.jpg`, `sheet-settings-toggles-before-after.jpg`. |
| F5 | minor | Night stage look | The night stage is veiled with 58 to 62 percent paper so the ink text stays readable. The result reads as a flat blue-grey fog; the moon, stars and the indigo of the art are faint. Owner taste, not a defect. | `04-menu.jpg`. |
| F6 | minor | Fallback look | When only the far layer of a stage is missing, the loaded mid and near layers are drawn over the painted classic-style background (sun, bamboo). Example: Arcade lanterns over painted bamboo. It works and is documented (docs/assets-integration.md 4.4), but the mix is incoherent. A full painted fallback for that mode would look better. | Delete `backgrounds/bg_arcade_far.jpg` in a copy, start Arcade (`sheet-fallback-one-image-missing-2.jpg`, top right). |
| F7 | minor | Memory (informational) | The art costs process memory compared with `?assets=0`: about +290 MB in total while playing (renderer about +190 MB, GPU process about +80 MB), and up to +390 MB at the menu while the hovered Arcade stage is prefetched next to the night stage. It is not a leak (flat after 12 stage cycles), and it is in line with docs/assets-integration.md 1.7 (two stages resident plus the composite), but a little above that document's "about 100 MB" peak for layers alone. | `mem.mjs` numbers in section 5. |
| F8 | minor | Test environment, not the game | Headless Chrome 154 dies (CDP connection closed) when it captures a **PNG** screenshot of a 3840 x 2160 surface while a page holds this much decoded art. A synthetic control page without any game code (all core and two stage images as bitmaps plus a 4K canvas) crashes it the same way, so it is a Chrome headless capture limit, not a game defect. JPEG capture, clipped capture, `canvas.toBlob` and `?assets=0` are fine. The game itself ran 3 minutes at that size at 60 fps. Unverified whether a weaker GPU would struggle at that size. | Open the game at dpr 2 with a 1920 x 1080 viewport in headless Chrome, wait 1.5 s, `Page.captureScreenshot {format: "png"}`. |
| F9 | minor | Out of the art scope (simulator) | With `?input=sim` a second visit in the same browser profile is sent to calibration step 1 after the safety screen (`calibrated` false), while the first visit goes straight to the menu. The same happens with `?assets=0`, so the art is not involved. Not investigated further; it may be intended. | Open `/?input=sim&clock=manual&mute=1`, advance 6 s, click the safety button: menu. Open the same URL again in the same profile and repeat: calibration. |

Observations that are not findings

* The fx slice flash is a thin tapered gold streak (about 10 px wide, 2.2 r long). It is drawn (frame-stepped captures show it where the procedural slash was) but it is subtle next to the blade trail. See `sheet-slice-flash-real-time.jpg`.
* The Arcade mid layer ends in a torn edge about 50 px above the bottom, leaving a pale paper strip where the controls hint sits. It is the art's own edge.
* The controller glyphs (`glyph_joycon_l`, `glyph_joycon_r`) are visible on the connect screen because `ART_CONFIG.glyphs.enabled` is true; they are close to the look of a real Joy-Con. The owner decision named in docs/assets-integration.md 9.1 is still open.
* Console lines seen, none from the art: `accel_saturated` (simulator hit with huge mouse jumps by the harness), `gyro_scale_suspect` (stale storage from an earlier visit in the same profile), `provider: lost_signal` and `reconnect failed` (the disconnect test on purpose).

## 4. Coverage matrix

| Area asked for | Result | Evidence |
|---|---|---|
| Cold start and load time | Pass. Cold cache, localhost: page script running at 0.06 to 0.10 s, manifest 0.1 s, core group (90 images) ready at **0.28 s**, night stage ready at 0.30 s, crossfade finished at 0.70 s; warm: 0.23 s and 0.68 s. Boot screen shows the logo and a progress bar. | section 5, `sheet-boot-and-overlays.jpg` (boot frame is an induced 120 ms delay per image) |
| Every screen and overlay | Pass: boot, safety, connect, calibration 1 to 4, menu, settings, tuning, countdown, playing, paused, resume countdown, results (plain and "New record" with the medal), disconnected overlay, confirm overlays (quit, delete scores) | `sheet-screens-overview.jpg`, `sheet-boot-and-overlays.jpg`, `sheet-countdowns.jpg`, `sheet-results-and-menu-hover.jpg` |
| Classic, Arcade, Zen from countdown to results, with each stage | Pass through real clicks on the menu fruit: the stage of the mode is shown from the countdown (prefetched while the cursor rests on the fruit), the round ends correctly (Classic on lives at 51 s, Arcade and Zen on the timer at 63 s and 91 s of game time), results show on the same stage, "Menu" crossfades back to the night stage | `sheet-classic-play.jpg`, `sheet-arcade-play.jpg`, `sheet-zen-play.jpg`, `14-*-results.jpg` |
| Night menu | Pass (see F1, F5) | `04-menu.jpg` |
| Every fruit whole and cut | Pass: 10 fruit and the golden apple, whole and as two face-on halves, at dpr 2 on Classic and at dpr 1 on Zen; silhouettes stay distinct; no fringes at 3x magnification | `fruits-classic-d2-*.jpg`, `fruits-zen-d1-*.jpg` |
| Golden apple | Pass: glow ring and sparkles not clipped, smaller body than its box, "GOLDEN APPLE" banner and +450 | `fruits-classic-d2-01a-row1.jpg`, `fruits-classic-d2-02a-row1-halves.jpg` |
| Bombs and the explosion | Pass: danger ring, fuse spark, `fx_bomb_explosion` scales up and fades over about 480 ms, soot stain, "-5 s" in Arcade; Reduce flashing gives a static, shorter, fainter explosion | `sheet-bomb-explosion-normal.jpg`, `sheet-bomb-explosion-reduce-flashing.jpg` |
| Every power-up medallion | Pass: Freeze, Frenzy, Double and Clock medallions on the field, pick-up effects (Freeze tint, Double x2 chip, Clock +4 s), tray icons, expiry after 5, 6, 10 s | `sheet-powerup-hud-tray.jpg`, `sheet-powerup-active-freeze-frenzy-double-clock.jpg` |
| Combos | Pass: banner with the combo burst icon, popups, stars; combo of 11 in one swing | `combo-1-banner.jpg`, `sheet-pause-resume-combo.jpg` |
| Stains piling up and fading | Pass: 48 fruit were cut in a few seconds; the pile stays readable (the design cap is 24, not counted directly), holds about 1.5 s and fades to nothing by about 7 s (mean luminance of the frame returns from 171.3 to 201.5 against a clean 202.1) | `sheet-stains-pile-and-fade.jpg` |
| Pause and resume | Pass: game time frozen while paused (8.98 s and the 0:51 timer unchanged after 4 s of paused time, and 2 s in the real-time run), "Resuming in 3..." countdown after the Resume click, play continues; keyboard `P` and middle click both pause, Quit asks for confirmation and returns to the menu | `sheet-pause-resume-combo.jpg`, `sheet-real-time-player-path.jpg` |
| Reduce flashing and Reduce motion, on and off | Pass. Reduce motion on: night-stage drift is zero (pixel difference 0, 0, 0, 0, 0 over 5 s against 0.10 to 0.57 with it off), stage change is a cut (0 fading observations against 15 polls, about 0.4 s, with it off). Reduce flashing on: explosion static, shorter and fainter (see bomb sheets). Both toggles work from the settings screen by clicking. | bomb sheets, `sheet-settings-toggles-before-after.jpg` |
| Window resize, dpr 1 and 2 | Pass: 13 size and ratio combinations (1920 x 1080 at 1, 1.25, 1.5, 2; 1280 x 720 at 1 and 2; 1366 x 768; 1440 x 900 at 2; 2560 x 1080; 800 x 600; 600 x 900; 3840 x 2160; 640 x 360), each with a non-blank menu and a non-blank round; live resize through six sizes during a round with no exception; letterbox bars are the ink colour | `sheet-window-sizes-and-dpr.jpg` |
| On and Off toggles | Pass: all four (Reduce flashes, Reduce motion, Auto-recenter, Hold to select) switch both ways by clicking and show the right cell in vermilion; the focused toggle shows the amber halo and is mirrored when the left cell is selected | `sheet-settings-toggles-before-after.jpg`, `sheet-toggle-focused.jpg` |
| Title rename everywhere | Pass. `<title>` and canvas `aria-label` read "3D Fruit Dojo", the `<noscript>` line starts with it, the menu shows the logo picture (and "3D FRUIT DOJO" text when the logo is missing), the diagnostics page title is "Joy-Con Diagnostics - 3D Fruit Dojo", the fatal-error text says "Could not start 3D Fruit Dojo.", the server prints "3D Fruit Dojo is running at ...". The code name stays where it should (`[joycon-ninja]` console prefix, `/__health`, storage key `joyconNinja.v1`). One header comment in `bridge/joycon-bridge.m` still says the old title (not visible to players). | live checks, `sheet-fallback-menus.jpg` (text fallback) |
| One image missing, in a copy | Pass, 11 variants, section 6 | `sheet-fallback-*.jpg` |
| 3 minutes of sustained play, fps and memory | Pass, section 5 | `perf-d1-1080p`, `perf-d2-1080p` numbers |
| Console errors and warnings | Pass: zero console errors and zero exceptions in every run; warnings only the ones listed under "Observations" plus one `[joycon-ninja] asset group ... is partial` line per failed group in the fallback runs | per-run summaries |
| Network requests | Pass: 181 to 199 requests per session, all to `localhost:8221`; no external host, no CSP violation, no 4xx/5xx except the deliberate missing files; the art is served with `ETag` and revalidated (warm visit transfers 1.08 MB, all of it script) | network capture of every run |
| `npm test` | Pass: 1665 of 1665, twice | `npm-test` logs in the scratchpad |
| Sound setting | Engine ready after the first click, the slice and bomb voices played with 0 errors while the art was on, the volume setting is stored and applied to the engine state; not listened to (headless, muted output) | `audio` check |
| Assets never influence game state | Pass: seeded bot rounds (Classic seed 7, Arcade seed 11, Zen seed 5, bombs included) end with the same score, time, cut count and snapshot fingerprint with the art on and with `?assets=0`; the 11 fallback variants all ended with score 260 at t 61.3 s | `det.mjs` output below |
| 28 px text, 84 px targets, silhouette-distinct fruit | Pass as far as seen. HUD captions look about 28 px (cap height about 20 px in the crops; judged by eye, not measured with a font probe). Every target the sword can select (cut or dwell) is at least 84 x 84 on every screen (steppers 84 x 84, toggle cells 210 x 84, buttons 380 x 100 to 620 x 120, menu fruit circles 340). Four click-only affordances are smaller by design and were not changed by the art: `safety.toggle` 520 x 72, `connect.diagnostics` 360 x 56, `cal.quick` 500 x 70, `cal.flip` 560 x 70. Ten fruit stay distinguishable by outline, not colour only. | `getUiView().targets` on every screen, `sheet-stepper-states.jpg` |

Seeded rounds with the art on and off:

| Mode | Seed | Score | Game time | Cuts | Fingerprint on | Fingerprint off |
|---|---|---|---|---|---|---|
| Classic | 7 | 5020 | 118.8 s | 229 | 1614036504 | 1614036504 |
| Arcade | 11 | 1720 | 45.7 s | 98 | 3501053078 | 3501053078 |
| Zen | 5 | 2755 | 90.6 s | 138 | 2099406693 | 2099406693 |

## 5. Measurements

Headless Chrome 154, Apple M5, localhost, one bot round of each mode for 60 s in a row (Classic, Arcade, Zen, with countdowns), real clock, `?mute=1`.

| Metric | 1080p, ratio 1 (1920 x 1080 canvas) | ratio 2 (3840 x 2160 canvas) | Browser pane, ratio 2 (Classic, 67 s) |
|---|---|---|---|
| Duration | 182 s | 182 s | 67 s |
| Frames per second, mean / lowest second / 5th percentile | 60.0 / 59.3 / 59.6 | 60.0 / 58.9 / 59.5 | 60.0 |
| Frame interval, median / 99th percentile | 16.7 / 16.8 ms | 16.7 / 16.8 ms | 16.7 / 18.7 ms |
| Frames over 20 ms | 0 | 2 of about 10,900 (worst 50 ms) | 0 |
| Long tasks (over 50 ms) | 0 | 0 | not measured |
| Auto-degrade level reached | 0 | 0 | 0 |
| Main-thread busy share during Arcade (task / script) | 9.7 % / 5.0 % | 10.7 % / 5.5 % | not measured |
| JS heap after forced GC, start to end | 2.7 to 4.3 MB (+1.6) | 2.8 to 4.2 MB (+1.4) | 12.4 MB live |
| Canvases created after the first 20 s | 11 (first power-up icons, first stage switches) | 7 | not measured |
| Console errors, exceptions, external requests | 0, 0, 0 | 0, 0, 0 | not measured |

Loading (cold cache, headless Chrome, no throttling unless stated):

| Case | Numbers |
|---|---|
| Cold, ratio 1 | core 90 of 90 images at 0.28 s, menu stage at 0.30 s, crossfade done at 0.70 s; 181 requests, 19.8 MB (PNG 18.5 MB, JPEG 0.15 MB, scripts 1.05 MB, manifest 27 KB) |
| Warm (conditional requests) | core ready at 0.23 s; 1.08 MB transferred (scripts only, every image answers 304 with no body) |
| Induced: every core image delayed 350 ms | menu on screen at **2.58 s** (the 2.5 s boot cap), playable at once, core complete at 8.4 s; 3,017 frames, p99 16.8 ms, none over 50 ms |
| Induced: one core image never answers | menu at 2.58 s; that image is marked failed at 15.1 s (the 15 s timeout); one warning line; the rest unaffected |
| Induced: manifest delayed 6 s | menu at 2.58 s; manifest marked failed after its 4 s timeout; fully painted game |
| Induced: stage layers delayed 1.5 s | round starts on the painted background, art fades in, no blank frame (frame spread never below 50) |
| Induced: every `/assets/` request answers 404 | menu at 0.08 s, fully painted, 3 s of Zen played |
| Shipped weight | 102 images, 24.3 MB in total (budget 40 MB); largest file 1.4 MB (budget 3 MB) |

Memory by process (resident size, headless Chrome, ratio 1, after a forced GC):

| State | Art on | `?assets=0` |
|---|---|---|
| Menu, idle | 1741 MB total (renderer 1009, GPU 300) | 1353 MB (renderer 788, GPU 154) |
| Classic, 4 s in | 1645 MB (renderer 984, GPU 230) | 1357 MB (renderer 794, GPU 149) |
| Arcade, 4 s in | 1648 MB | 1359 MB |
| Zen, 4 s in | 1560 MB | 1269 MB |
| Back at the menu | 1604 MB | not measured |
| After 12 more stage switches | **1460 MB** (no growth; never more than 2 stages resident) | not measured |

The baseline renderer is large in this harness (about 790 MB with no art); only the differences are meaningful.

## 6. Fallback matrix (copy of the project, files deleted or damaged, real files untouched)

Every variant: boot, menu, a full Arcade round through the pause screen and the results screen, no exception, no console error other than the browser's own "Failed to load resource" lines for the missing files, one `[joycon-ninja]` warning line per failed group, and the same final state (score 260 at 61.3 s for the same seed).

| Variant | Group state | What the player sees |
|---|---|---|
| Apple whole missing | core partial 89 of 90 | apple painted, everything else art |
| Apple halves missing | core partial 88 of 90 | cut apples show painted halves among art halves |
| `button_primary_default` missing | core partial 89 of 90 | primary buttons painted (pause, results), secondary buttons art |
| Focused button images missing | core partial 88 of 90 | buttons lose only the hover halo art |
| Near layers of Classic and Arcade missing | `stage:arcade` partial 2 of 3 | Arcade without lanterns |
| Far layers of Arcade and menu missing | partial | mixed painted and art backdrop (F6) |
| `manifest.json` missing | manifest failed | fully painted game, one warning |
| Orange truncated, kiwi replaced by text, lemon replaced by a wrong-size image, Arcade mid empty | core partial 87 of 90, `stage:arcade` partial | painted orange, kiwi, lemon; Arcade without its mid layer |
| `sprites/`, `fx/`, `icons/` folders gone | core partial 24 of 90 | painted fruit, bombs, medallions, icons; art UI kit and stages still there |
| `ui/` folder gone | core partial 66 of 90 | painted buttons, panels, toggles, title text instead of the logo |
| `backgrounds/` folder gone | stages failed | painted background, art sprites and UI |
| whole `assets/` folder gone | manifest failed | fully painted game |

## 7. Files and scripts

Screenshots: `docs/qa/art-round-1/` (see the index of sheet names in section 4). The driving scripts were kept in the QA scratchpad and read the project only through its public `test-support/e2e` modules; nothing was written into `public/`, `design/`, `tools/`, `test/` or any source file.

## 8. Suggested next steps for round 2 (not done here)

1. F1: raise the contrast of the three menu descriptions to 3:1 or more and make the stage-readability test measure those lines.
2. F2 and F3: decide whether the HUD and the pause toast need a small paper plate on the busy stages.
3. Run the same matrix on the owner's Mac with the pane visible and a real display at 4K, and record the real frame numbers here.
