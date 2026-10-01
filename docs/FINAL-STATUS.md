# 3D Fruit Dojo: final status (2026-10-01)

Written by the final integrator. This is the one page to read before you trust any number in the repository. Rule of the project: **nothing is claimed about the real sword that was not measured**; everything that only the physical controller can settle is tagged **UNVERIFIED-ON-HARDWARE** and listed in one place below.

## 1. What is finished

- A dependency-free web game (HTML5 Canvas 2D, ES modules, `server.js`), three modes (Classic, Arcade, Zen), played with a Joy-Con 2 through a native Bluetooth bridge, with Chrome's Web Bluetooth, with a simulator, or with the mouse. Zero runtime npm dependencies.
- Menus are used with the stick, A and B on a real Joy-Con (R / L hop between the two columns of the settings screens); the sword selects nothing in the menus unless "Sword selection in menus" is on.
- The pointer is relative (a gyro pointer with dead zone, acceleration and auto-centre), and the cut decision is in degrees per second, both tuned on a real recording of the owner's Joy-Con (`docs/motion-findings.md`).
- The hit areas are larger and proportional to the fruit (1.55 x the drawn radius plus a 14 px blade half width; the bomb stays strict).
- AI-generated art (Higgsfield), two web fonts (Lilita One and Fredoka, SIL OFL, 36 KB), spectacular effects, synthesised audio with sub-buses and ducking, an ink-brush wipe between screens, animated menus, countdown, HUD and results. Every picture, both fonts and every sound recipe is optional: `?assets=0` and `?fonts=0` run the paper-and-ink drawing with the system fonts.
- What the final integration did (details: `docs/contract-notes.md`, "Final integration"): resolved every request to the Integrator and the UI engineer; made the whole suite green (three real test defects, one flaky test fixed at its timing assumption, one hardening of `start.command`, one banner defect found by playing); wired the fonts (MIME type, boot wait, `?fonts=0`, widget cache); retook the documentation screenshots; wrote the documents.

## 2. Tests

All run on the development Mac (Chrome 154, Node 24), with other work running on the same machine.

| Command | Result |
|---|---|
| `npm test` (every suite, five files at a time) | **2033 tests, 2033 passed, 0 failed, 0 skipped, 0 todo**, 136 s |
| unit and integration (Node only) | 1974 tests |
| end to end (headless Chrome over the DevTools protocol, `npm run test:e2e`) | 59 tests |
| `npm run build:assets -- --check` | exit 0: a fresh build of `design/` equals `public/assets/` (manifest, provenance, every image and font) |
| the English-only guard (`test/architecture/english-only.test.js`, `docs-sync.test.js`) | green, part of `npm test` |

Golden digests re-recorded in this integration, on purpose, and only these: `busy1`, `busy2`, `busy3` of `test/render/art-fallback.test.js` (the power-up banner is drawn differently, see 4). The UI digests (`test-support/ui/procedural-digests.json`) and the other render digests were re-recorded earlier by their owners, in the restyle round, and were green when this integration started.

What a green suite proves: the code follows the documents and the models of them. It does not prove anything about the physical Joy-Con (see 6).

## 3. Measured numbers

Headless Chrome 154, 1920 x 1080, the simulator, the generated art and both fonts loaded, a software rasteriser, 2026-10-01, other work running on the machine. They say nothing about the owner's display or GPU. Source: `test/e2e/perf.test.js` output and `docs/qa/final/report.json` (`node test-support/e2e/qa-final.mjs`).

| Measure | Value |
|---|---|
| Frame interval, real clock, a Classic round with a bot, 1251 frames in 20 s | 16.67 ms average (60.0 fps), p95 16.7, p99 16.8, max 16.8 ms, no long task |
| Frame interval, real clock, 601 frames of a bot round (`qa-final`, 10 s) | 16.64 ms average, p99 16.8 ms, max 16.8 ms |
| JavaScript cost of one frame (game step plus drawing), Classic with a bot | 0.41 ms average, p95 0.70, p99 1.30, max 6.5 ms |
| The same with `?assets=0` (painted) | 0.33 ms average |
| **Heaviest scene I could build**: Arcade, Frenzy on, waves on, a bot cutting up to four fruit every 24 frames, 1321 frames, 189 cuts, manual clock | 0.53 ms average, p50 0.20, p95 0.5, **p99 7.9 ms, max 82 ms** |
| Memory | JS heap about 7 MB in the menu and about 15 MB after 22 s of the heaviest scene (before any forced collection); the renderer process holds about 190 MB more with the art than with `?assets=0` (`docs/assets.md`, measured earlier at 2880 x 1800) |
| Input to draw (software only) | about 9 to 10 ms (`__ninja.getPerf().inputToDrawMs`) |
| A real-time check in the desktop app's browser pane (`http://localhost:8301/?input=sim`, 1024 x 768) | 59.8 fps, both fonts `ready`, no console error |

About the 82 ms: in the FIRST page of a fresh Chrome the heaviest scene had a few single frames of 30 to 80 ms (the draw call, not the game step); the next two pages of the same Chrome had none (one frame of 14 ms), and the real-clock runs above had no long task. I did not isolate the cause (a first-time bake, garbage collection and the load of the other agents on the machine are all possible). It is the reason the frame rate on the owner's Mac stays on the UNVERIFIED-ON-HARDWARE list.

## 4. What was played and looked at (headless Chrome, simulator, manual clock; evidence in `docs/qa/final/`)

Looked at in the pictures, by me: the menu (logo, three fruit, buttons), the settings screen, the sword tuning screen, the connect screen (Web Bluetooth layout) and the safety screen, calibration steps 1 and 4 (step 4 from the real wizard against the simulator, because it is a practice round: a forced screen shows no apple), the countdown (the numeral "2" filmed at 0 to 400 ms), the HUD of Classic, Arcade and Zen, the pause panel and the resume countdown, the results screen of Arcade, Classic and Zen (rank seal, NEW RECORD ribbon), the disconnect panel, the `?assets=0` and `?fonts=0` menus and rounds. Filmstrips (frames at 0, 100, 200, 300, 400 ms; `film-*.jpg`): the menu entrance, the ink wipe menu to settings and back, the countdown, a x4 combo, a bomb, Freeze, Frenzy, the Golden Apple, pause and the resume that follows a "Recalibrate" (the simulator's pointer rested on that button, so the film shows the quick re-centre step and then "Resuming in 3..."), the results screens (filmed from the moment the panel appears: count-up, seal slam, ribbon), and the real menu entrance at boot (logo drop, fruit rising). A bot (`window.__helpers.botRound`, which cuts the topmost reachable fruit through `__ninja.swingThrough`, bombs included, so it loses lives and time to them) played Classic and Zen for 70 s of game time (75 and 99 cuts) and Arcade to the results screen (98 cuts, 1790 points, rank "Ninja"), with no console error and no log warning in any of them.

**Defect found by looking and fixed**: the power-up banners (`FREEZE!`, `FRENZY!`, `DOUBLE!`) had the gold underline of the tier 3 ink plate drawn through their subtitle ("Time slows down"). Now the tier 2 plate (no underline) is drawn stretched to 214 px and the text moved (`docs/contract-notes.md`). **Seen, left as it is**: the results screen draws its lockout bar (a red line near the panel's bottom edge) after the lock has ended; the sim cursor is drawn over the "NEW RECORD!" ribbon (it is the simulator's pointer, a real Joy-Con selects with the stick); the Classic description wraps to two lines on the menu with the fonts.

**Not done**: no filmstrip of Reduce motion or Reduce flashes pictures (unit tests only); no picture of the petals of rank 4 and 5 (the bot reached "Ninja"); the pause panel entrance was filmed (`film-pause.jpg`) but with the sword cursor, not with a stick; the audio was not listened to by anybody (below); the machine was loaded, so no measurement here is a benchmark.

## 5. Verified on a real Joy-Con 2 (one Right unit, the owner's Mac)

| Item | Evidence |
|---|---|
| **Connection**: the unit connects and initialises (mask `0xB7`) through the native Bluetooth bridge; the owner confirmed that it connects and streams | the owner; `recordings/imu-2026-09-30T18-42-24.jsonl` (4744 reports over 142 s) was written through the bridge |
| **Streaming at 33 Hz**: a steady 33 Hz, median device step 30 ms, one lost packet in the file, 63-byte reports | native probe (485 packets in 14.5 s) and the recording, `docs/hardware-findings.md` 2 and 8 |
| **Accelerometer scale**: raw / 4096 = g (|a| = 1.026 g near rest) | native probe |
| **Gyro scale**: 0.06104 degrees per second per unit, within what a hand-timed test can show (four table turns read 3.99 turns); bias (0, -0.31, +0.73) deg/s, noise 0.12 deg/s | recording, `docs/motion-findings.md` 3 |
| **Stick centre estimate**: the right stick rests at x 1998.4, y 2006.8 (49 and 40 units below the nominal 2047, sd 0.6 and 0.5, 399 reports); the centre differs per unit (a second capture rests at 1983 / 2050), so the game estimates it per session from the first 12 consecutive agreeing reports; deflections up to x 726 to 2520 and y 1687 to 2984 were seen | recording, `docs/contract-notes.md` "Stick navigation" |
| Gyro axes (pitch, roll, yaw), hand tremor and slow-aim speeds, the owner's slash speeds (median peak 831 deg/s) | recording, `docs/motion-findings.md` |

The owner's qualitative feedback after playing (not measurements): it is great; the hit boxes were small (changed); the controls were too sensitive (changed from the recording); the fonts were terrible (replaced); the effects were not spectacular (rebuilt).

## UNVERIFIED-ON-HARDWARE: the one list

Nobody has observed any of the following on a real Joy-Con 2, a real sword or the owner's Mac. The numbered items are the ones of the index in `docs/GUIDE.md` 11 (the 10-minute hardware checklist, which is how each one gets settled).

1. **Sword feel.** Whether the relative pointer, the 300 deg/s cut threshold, Sensitivity 1.0, the idle glide, the 1.55 x hit areas and the difficulty feel right with the real sword, for the owner and for anybody else (the numbers come from ONE recording of ONE person). The 5-minute feel check of the guide settles it. (HW-2, HW-3, HW-9, HW-12)
2. **Latency.** The real delay from the swing to the picture: the 9 to 10 ms of `inputToDrawMs` is software only, and the Bluetooth part and the display are not measured. (HW-1, UOH-18)
3. **The Left Joy-Con** (its advert, its GATT table, its axes, its stick and its arrow buttons). (UOH-35)
4. **The stick's full travel**, the half range of 1500 units that the game assumes, and "up is the larger y, right is the larger x"; also whether the stick is reachable on a sword. (UOH-34)
5. **Audio by ear.** All levels were measured in offline renders and read from spectrograms; nobody listened: whether the slice sounds juicy, whether the gong is too bassy on laptop speakers, whether the combo ladder feels good. (`docs/contract-notes.md`, audio engineer entry)
6. **A and B (and R, L, ZR, ZL, +) on the sword.** Whether the buttons can be reached while holding the sword, and whether a grip presses R by accident (it did once in the recording, in the middle of a stroke, which is why R no longer re-centres). (HW-6, UOH-10)
7. **Frame rate, memory and the look on the owner's own display.** Every number in this repository comes from a headless Chrome on the development Mac. (HW-1)
8. **The rest of the native bridge**: the pairing preference, the keep-alive over many minutes (the recording is 142 s long), the behaviour after a disconnect and a reconnect, the cooldown, the exact error texts with a real controller. (UOH-22 to UOH-33; UOH-21, the macOS permission through `start.command`, is observed to work on the owner's Mac)
9. **Chrome's Web Bluetooth path.** On the owner's Mac Chrome's own chooser showed no device with the old default filter and the cause is unknown; the fallback path ("Not working? Try Chrome's Bluetooth") has never been run against a controller. (UOH-1 and the other Chrome items)
10. **Vibration, battery and button details** (`?haptics=1`, the battery bands, phantom ZL / ZR presses with mask `0xFF`) and every other `UOH-n` of the guide's index.

Everything else about the controller in the documents comes from community research and from software models of it.

## 6. How to repeat all of this

```bash
npm test                                    # the whole suite, about two minutes
npm run build:assets -- --check             # public/assets equals a fresh build of design/
node test-support/e2e/qa-final.mjs          # plays the game in headless Chrome, rewrites docs/qa/final/
node test-support/e2e/guide-screens.mjs && node test-support/e2e/native-screens.mjs   # retakes docs/img
```

Start the game with `start.command` (it opens Chrome; with the native bridge any browser will do) and do the hardware checklist of `docs/GUIDE.md` 11 with the real sword: ten minutes turn the list above into facts.
