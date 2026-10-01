# Playbook for a new game: know-how from "3D Fruit Dojo"

Hand this file to a NEW session as its first context (or save it as `CLAUDE.md` of the new project). It is written for an AI coding agent that has to build
a new motion-controlled web game, here a **clay pigeon shooting game ("tiro al piattello")**, with a Nintendo Switch 2 Joy-Con 2 as the controller, reusing what
was learned and built in the previous project. Everything marked VERIFIED was measured on the owner's real hardware; everything marked UNVERIFIED was not.

---------------------------------------------------------------------------------------------------------------------------------------------------

## 0. How to use this document

1. Read sections 1 to 4 completely before writing code. They save days.
2. Do not re-derive the hardware facts (section 3) or re-run the failed experiments (section 3.5): reuse the working code (section 2).
3. Follow the method of section 5 (contracts first, parallel engineers on disjoint files, independent verifiers, real-data replay).
4. Section 9 is the concrete plan for the shooting game. Section 10 is a ready-to-paste first prompt.

The previous project lives in the GitHub repository `collecticraft-sudo/3d-fruit-dojo` (PRIVATE until the owner says to make it public; code MIT, art and video all rights
reserved; the presentation video is a release asset of v1.0.0) and, on the owner's Mac, in the folder `joycon-ninja/` (the code name that stays inside the project: package name, `window.__ninja`, URL flags,
`joyconNinja.*` storage keys). If the repository is available, START BY COPYING IT and replacing the game logic (see 2.1); do not start from an empty folder.

## 1. The owner and the working rules (important, they decide how you should behave)

- The owner is an Italian maker who prints 3D objects. Talk to them in ITALIAN. All code, comments, UI text and docs are in ENGLISH (their explicit decision:
  "the game must be all in English", docs in English).
- They want autonomy and speed: ask few questions, batch the unavoidable ones into ONE question call at the start, then work without interrupting. They get
  impatient when a task takes more than a day. Time-box scope and say what you cut.
- They want honesty: never claim something about the real hardware that was not measured. Label it `UNVERIFIED-ON-HARDWARE`. Report failures plainly.
- They test the real game with the real controller themselves and give short, practical feedback ("too sensitive", "fonts are terrible", "needs more
  spectacular effects"). Take it seriously, it is the real acceptance test. Always prepare a FROZEN COPY of the current build for them to try (never make them
  test a tree that agents are editing).
- Permissions: downloading files, publishing, spending paid credits and creating public content need EXPLICIT permission. Ask once, in one question, with the
  exact names, sources and sizes. GitHub: create the repository PRIVATE first and make it public only when they say so.
- They like a clean visual result: they asked for "the game of the year" level of polish, better fonts, spectacular effects, menus that are easy to navigate.

## 2. What already exists and can be reused (do not rewrite)

### 2.1 Repository map (folder `joycon-ninja/`)
| Path | What it is | Reuse for the shooting game |
|---|---|---|
| `bridge/joycon-bridge.m`, `bridge/build.sh`, `bridge/Info.plist`, `bridge/manager.js` | Native CoreBluetooth helper in Objective-C (built with clang), spawned by `server.js`, speaks JSON lines | Reuse as is. This is the ONLY way the controller connects on the owner's Mac (section 3.2) |
| `server.js` | Dependency-free local server (127.0.0.1) with the bridge endpoints `/__bridge/status|connect|disconnect|events|rumble`, security headers, CSP | Reuse as is |
| `start.command` | Double-click launcher: builds the helper, starts the server, opens Chrome | Reuse |
| `public/js/input/` | Parser (`joycon2-parse.js`), packet builder, native provider, Web Bluetooth provider (does NOT work on that Mac), simulator, mouse provider, actions map, diagnostics page | Reuse. Keep the simulator and mouse providers: they make automated testing possible |
| `public/js/motion/` | Motion pipeline: relative pointer with dead zone and acceleration, cut decision in deg/s, calibration, idle auto-centre, 33 Hz interpolation and extrapolation | Reuse the pointer core. REPLACE the "cut" logic with "trigger" logic (section 4.3) |
| `public/js/ui/` | Screens, widgets, focus and hit testing, settings with versioned storage and migration, sword tuning screen, strings | Reuse the framework and the stick, A, B menu navigation |
| `public/js/render/` | Canvas renderer, sprite loader with procedural fallback (`assets.js`), stage backdrops in 3 parallax layers (`stage.js`), particles, HUD, text plates | Reuse the infrastructure, replace the painters |
| `public/js/audio/` | WebAudio synthesised sound effects | Reuse the engine, write new sounds |
| `public/js/game/` | Pure game logic with a seeded RNG, fixed timestep, swept collision | REPLACE (the fruit game rules do not apply) but KEEP the architecture: pure, deterministic, no DOM, snapshot plus event stream |
| `tools/` | `record-imu.mjs` (guided hardware recording), `analyze-imu.mjs`, `replay-motion.mjs`, `replay-integrated.mjs`, `build-assets.mjs` (asset pipeline) | Reuse |
| `design/fonts/` | Font sources (Lilita One, Fredoka), their OFL texts, `build-fonts.py` (fontTools subsetting and renaming), the WOFF2 subsets and a specimen page | Reuse the method (section 12.2) |
| `design/tools/slice-sheet.mjs` | Cuts transparent sprite sheets into single sprites (no dependencies except ffmpeg) | Reuse |
| `test/`, `test-support/` | 2033 tests at the final run (1974 without the browser; `npm run test:unit` needs no Chrome), fake Bluetooth, fake helper that replays real packets, headless Chrome harness over CDP, golden digests of every screen | Reuse the harnesses, write new tests |
| `recordings/imu-*.jsonl` | The first real recording of a Joy-Con 2 R (hex reports, 9 labelled motion steps) | Reuse as ground truth fixtures; RECORD NEW SESSIONS for shooting (section 4.5) |
| `docs/` | `FINAL-STATUS.md` (the one page to trust), `restyle-direction.md` (effects catalogue with timings), `typography.md`, `GUIDE.md`, `architecture.md`, `joycon2-protocol.md`, `hardware-findings.md`, `native-bridge.md`, `motion-findings.md`, `motion-contract.md`, `assets*.md`, QA and review reports | Read `joycon2-protocol.md`, `hardware-findings.md`, `motion-findings.md` first |

### 2.2 Things that are generic and valuable
- Deterministic test hooks: seeded RNG, a manual clock that lets you step the game 1/60 s at a time, and a debug API `window.__ninja` (start a mode, read a
  snapshot, perform a scripted swing, pause, set the seed). They let agents and bots PLAY the game, take screenshots and make video footage. Rebuild the same
  idea in the new game from day one.
- URL flags: `?input=sim|mouse|native`, `?clock=manual`, `?mode=`, `?seed=`, `?mute=1`, `?assets=0` (forces the procedural fallback), `?debug=1`.
- Procedural fallback for every image: the game never depends on an asset being present.

## 3. Hardware facts (VERIFIED on a real Joy-Con 2 Right, macOS 26.6, Apple N1 Bluetooth, 2026-09-30)

### 3.1 Bluetooth identity
- BLE advertisement: manufacturer data company id `0x0553` (Nintendo). Data after the company id: bytes 5 and 6 are the product id little endian:
  Right = `0x2066`, Left = `0x2067` (Left is documented by third parties, not verified). Bytes 10 to 15 are the bonded host address, all zero in pairing mode.
- No local name, no service UUID in the advert. The controller NEVER appears in macOS Bluetooth settings: do not try to pair it there.
- Hold the small SYNC button at every session until the player lights sweep. Repeated connects in a short time make it refuse for a few minutes (cooldown).
- Services: primary service `ab7de9be-89fe-49ad-828f-118f09df7fd0`. Characteristics that matter: input report notify `ab7de9be-89fe-49ad-828f-118f09df7fd2`,
  command write without response `649d4ac9-8eb7-4e6c-af44-1ea54fe5f005`, command responses notify `c765a961-d9d8-4d36-a20a-5315b111836a`.
  Never write to `4147423d-fdae-4df7-a4f7-d23e5df59f8d` (firmware update channel).
- Init sequence that worked first try: subscribe to the responses characteristic, write the LED frame `09 91 01 07 00 08 00 00 01 00 00 00 00 00 00 00`, wait
  0.5 s, feature SET `0C 91 01 02 00 04 00 00 B7 00 00 00`, wait 0.5 s, feature ENABLE `0C 91 01 04 00 04 00 00 B7 00 00 00` (mask 0xB7 = buttons, sticks, IMU,
  magnetometer), then subscribe to the input characteristic. A 1 Hz keep-alive write keeps the link up (the link held for a 3 minute recording).
- Rumble preset frame (written by the bridge, UNVERIFIED on hardware): `0A 91 01 02 00 04 00 00 II 00 00 00`, preset ids 1 low buzz, 3 soft click, 5 stronger click,
  6 short high beep. Check if a short strong preset gives a believable "shotgun recoil".

### 3.2 What does NOT work on the owner's Mac (do not retry)
- Web Bluetooth in Chrome: the device chooser lists NO device at all, even with `acceptAllDevices`, although Chrome has the macOS Bluetooth permission. Cause unknown.
  Three filter variants and a fallback button were implemented, all useless on that Mac. USE THE NATIVE BRIDGE.
- Swift is broken on the machine (duplicate `SwiftBridging` modulemap in the Command Line Tools). Write native helpers in Objective-C and build them with clang.
- macOS kills a process that touches Bluetooth when it is started by an app without the Bluetooth permission (the agent shell tool). Start anything that touches
  Bluetooth from the owner's Terminal tab (use the terminal tool with `cd <dir> && command`, its `cwd` argument only accepts session folders).
- `ffmpeg` on the machine has libx264, libx265, aac but NO libwebp. Python has no Pillow and no NumPy. Use Node for image work (a small PNG decoder exists).

### 3.3 The input report (63 bytes, about 33 Hz, steady)
Offsets: counter 0x00, buttons 0x04 (bit tables in `joycon2-parse.js`), left stick 0x0A and right stick 0x0D (12-bit x and y packed in 3 bytes), IMU marker 0x29,
IMU timestamp 0x2A (uint32 microseconds, the only reliable clock for dt), temperature 0x2E, accelerometer 0x30 (3 x int16 little endian), gyroscope 0x36 (3 x int16).
- Accelerometer: raw / 4096 = g. VERIFIED (|a| = 1.00 at rest).
- Gyroscope: 0.06103515625 deg/s per LSB (2000 dps / 32768). VERIFIED within about 1 to 5 percent (four table turns integrate to 1435 degrees).
- The very first packet after streaming starts has the IMU fields at zero: treat `imuActive` false and skip.
- Rate 33 Hz (30 ms between samples), worst gap about 60 ms (one lost packet). Rendering at 60 fps needs interpolation and extrapolation (done in the motion pipeline).
- Battery voltage field: a reading of about 3.43 V means a LOW battery. Tell the owner to charge before long sessions.

### 3.4 Measured behaviour of the sensor and of a human hand (use these numbers, they are real)
- Rest (controller lying still): gyro bias (0, -0.31, +0.73) deg/s, median noise 0.12 deg/s, integrated drift 0.02 to 0.19 degrees in 8 s. The sensor is excellent.
  When you estimate bias, use MEDIANS over a settled window: the first seconds of any recording contain the human handling the device.
- Hand trying to hold still: median angular speed 1.7 to 3.1 deg/s, p90 4.7 to 12.6, p99 22 to 47. So a dead zone of about 5 deg/s is needed.
- Slow intentional aiming sweeps: median 41 to 51 deg/s, p90 66 to 164, p99 87 to 260.
- Fast slashes (sword game): horizontal peaks median 831 deg/s (max 1049); vertical peaks median 184 (max 855). Accelerometer in swings reaches 5.75 to 6.45 g.
- Axes with the controller held pointing at the screen: pitch (tip up and down) is mostly gyro x, roll about the long axis mostly gyro y, yaw mostly gyro z.
  The motion pipeline has a mount calibration for other mountings.

### 3.5 Failed or wrong ideas (and why), so you do not repeat them
- Absolute orientation pointing at 27.4 px per degree (screen spans 70 degrees): a normal change of arm posture of 20 to 40 degrees pins the cursor to a screen
  edge, so the player "has to re-centre all the time". Gyro bias was NOT the cause.
- A cut or action threshold expressed in px/s: it silently depends on sensitivity (1000 px/s was only 36 deg/s, so slow aiming triggered everything). Decide in
  ANGULAR speed (deg/s), independent of the sensitivity setting.
- Relative pointer with gravity decomposition: reverses direction near the zenith. Relative with roll tracking: worse. The winner: RELATIVE pointer in the local
  frame of the controller plane (no gravity), dead zone, acceleration curve, idle soft auto-centre, plus a gravity-stabilised vertical axis added after a bug where
  vigorous repeated swinging slid the cursor to the bottom edge (a verifier found it, a metric did not cover it: test long vigorous sequences).
- Selecting menu items with the pointer by dwell or by cutting: too easy to activate something by accident. Menus use the stick, A (confirm) and B (back).

### 3.6 The analog stick (measured centre, UNVERIFIED travel)
- VERIFIED: the right stick of the owner's unit rests at x = 1998.4 (sd 0.6), y = 2006.8 (sd 0.5), that is 49 and 40 units BELOW the nominal 12-bit centre 2047 (399 reports at
  rest on `recordings/imu-2026-09-30T18-42-24.jsonl`). The unused left field reads exactly 2047 / 2047. A third-party capture of another unit rests at 1983 / 2050, so the
  centre is PER UNIT: the game estimates it per session as the mean of the first 12 consecutive reports that agree within 24 units and lie within 450 of 2047 (about 0.4 s of
  stream). Never hard-code 2047.
- Seen while the owner handled the controller: x 726 to 2520, y 1687 to 2984.
- UNVERIFIED-ON-HARDWARE (UOH-34): the full travel. The game ASSUMES a half range of 1500 units and "up is the larger y, right is the larger x", and a flick fires when the
  normalised magnitude first reaches 0.55 (dead zone 0.35, re-arm below 0.3). Nobody pushed the stick to its stops on a recording. Do a labelled step "stick to every stop" in the
  next hardware session before trusting those numbers. Whether the stick is reachable while holding a sword (or a gun) is also unverified.

## 4. Control design for a shooter (derived from the data, adapt and verify)

### 4.1 Aiming
- Use the RELATIVE pointer of `public/js/motion/` (dead zone 5 deg/s, acceleration curve about 5 to 14 px/deg, idle soft auto-centre, 33 Hz interpolation).
  For a shooter you probably want a LOWER gain in the slow range for precision and a stronger curve for flicks. Make gain and curve presets in settings.
- A "re-centre" button (R or ZR on the right unit is already RECENTER in play) is still useful; with a relative pointer it is rarely needed.
- Show an unmistakable crosshair, and a faint aim "reticle lag" indicator if you extrapolate. Extrapolate no more than 35 ms.

### 4.2 Trigger and recoil
- A shotgun trigger is a button press: ZR (right unit) is the natural trigger, R the secondary; A, B, X, Y are reachable too. A button press makes the wrist
  jerk: MEASURE the angular jitter during button presses (section 4.5) and either low-pass the pointer for about 60 ms around the press, or fire at the position
  of the press time minus a small latency compensation. This is the single most important feel parameter of a shooting game.
- Rumble for recoil through the bridge (`POST /__bridge/rumble`), UNVERIFIED on hardware. Add a setting to disable it.

### 4.3 What to replace in the motion code
- The "cut tracker" (angular speed with hysteresis) becomes a trigger tracker (button edge). Keep the same structure and tests style: small pure modules, replay
  tests against recorded data.

### 4.4 Menus
- Stick moves the focus (edge-triggered, one flick equals one move), A confirms, B goes back, bottom hint line shows the keys. Mouse and keyboard still work.
  The framework is in `public/js/ui/`. Sword or pointer selection in menus is OFF by default with a real controller.

### 4.5 Record new real data BEFORE tuning (30 minutes, high value)
Use `node tools/record-imu.mjs --port <server port> --steps <json> --texts <json>` (it connects the controller through the running server, asks the owner in the
terminal to perform labelled steps with countdowns and beeps, writes JSON lines). Steps to add for shooting: aim at 5 fixed on-screen targets and hold 2 s each;
slow tracking of a moving object; 20 quick snap shots with the trigger; trigger pulls while holding still (measures trigger jerk); a long sequence of 50 shots;
pointing at the centre then lowering and raising the arm. Analyse with `tools/analyze-imu.mjs` and build replay tests with the recordings as fixtures.

## 5. The method that worked (and the pitfalls)

1. ASK ONCE, then work. Collect decisions and permissions in one multiple-choice question.
2. Research first, with sources and confidence levels (the BLE protocol was reverse engineered from community repositories; an independent protocol auditor
   re-derived it and compared line by line with the code).
3. Write a design bible (`docs/game-design.md`) with concrete numbers and an architecture document with EXACT contracts (typedefs, units, events, file ownership)
   BEFORE parallel coding.
4. Build with parallel engineers on DISJOINT files and DISJOINT test folders; any contract deviation goes to a log file (`docs/contract-notes.md`).
5. An integrator wires everything and runs the whole suite; then an independent validation loop: a QA tester that really plays the game in a browser, a visual critic
   that judges screenshots, a white-box code reviewer, specialised verifiers (protocol audit, motion verification by REPLAYING real recordings), a fixer that
   must first verify each finding is real. Cap the loop (1 to 2 rounds) and finish with a clean-room validator that copies the project and follows the README.
6. Everything is test-driven and deterministic: seeded RNG, manual clock, golden digests of every screen, mutation checks of tests, a leak scanner for forbidden
   words (the English-only guard), an architecture test of the import matrix.
7. Procedural fallback for every asset, performance budgets (60 fps, no per-frame allocation, cached scaled sprites, lazy layers), size budgets (ship backdrops
   as JPEG or PNG at 2560 wide, not 4k).
8. Honesty labels: `UNVERIFIED-ON-HARDWARE` everywhere something was not measured, and a hardware checklist the owner can run in 10 minutes.
9. Real data beats opinion: record, analyse, replay, then decide. Four pointer designs were rejected with numbers.

Pitfalls met:
- zsh expands `$i:v` inside strings: wrap ffmpeg filter graphs in `bash -c` or use `${i}`.
- Heavy parallel agents running headless Chrome tests saturate the Mac (load average 80 on 10 cores) and make tests flaky: use `--test-concurrency=3`, run the full
  suite rarely, one validation round, and expect long wall-clock times (earlier workflows took 10 to 17 hours). Say honestly what the time will be.
- Never run agents on the same files at once; never edit the tree while a validation workflow runs; take a frozen copy for the owner.
- Servers of the owner run on fixed ports: agents must use their own ports and NEVER kill processes they did not start.
- A mid-layer or near-layer image generated "on a transparent background" can still contain opaque paper-coloured patches: check every layer over magenta.
- Do not write the words "mist" or "mixed with paper" in prompts for transparent layers. Always say: "every pixel that is not X must be fully transparent".

## 6. Art with Higgsfield (the owner has an account connected)
- Best model for game assets: GPT Image 2.5 (`gpt_image_2_5`). Native `background: "transparent"` works and gives RGBA PNG, no chroma key needed.
  Cost per image: low quality 1k 0.25 credits, medium 1k 0.5, high 2k 2.75, high 4k 4.25. Recraft V4.1 cost 8 and was worse for this. Always preflight with `get_cost`.
- Workflow that produced 100+ consistent assets cheaply: one SHEET per subject (for example a whole object plus two identical halves, 3 to 5 items in a row),
  cut it with `design/tools/slice-sheet.mjs` into 512x512 sprites at a common scale, verify over light and dark backgrounds, then list everything in a CSV with the job id.
- Style: write ONE style formula first and get approval (see `design/higgsfield-brief.md`), split it into CORE (every prompt) and SCENE (backdrops only), otherwise
  scenery leaks into objects. Backdrops: far layer opaque, mid and near layers transparent, generated with the far layer as a reference image.
- There is NO sound-effect or music model usable for standalone audio on that account (the music and SFX models are restricted to Higgsfield's game pipeline); the
  speech model is fine. Game sounds are synthesised with WebAudio. Free music: bundled Ende.app tracks (CC BY 4.0, credit Sascha Ende) and Kenney sound effects (CC0).
- Fonts: the owner called the system fonts "terrible". Plan to embed 2 open-licence (OFL) fonts (display and UI) with the explicit download permission, and a central
  text-drawing helper. Do this early, it changes the whole look.

## 7. Video (promo of the finished game)
- Real gameplay footage is recorded frame by frame: run the game with the manual clock, step 1/60 s, screenshot every frame over CDP, encode with ffmpeg
  (`libx264`, crf 14). A scripted bot plays through `window.__ninja`. Compose with HyperFrames (renders HTML to video) and use the owner's art.
- Never present AI-made or illustrated footage as real gameplay, and never claim real-hardware feel that was not measured.
- Plan and tools: `video/PLAN.md`, `video/tools/capture-gameplay.mjs`, narration with Higgsfield speech, music CC BY 4.0 with credits.

## 8. Publishing
- Create the GitHub repository PRIVATE, with a repo-local git identity using the GitHub noreply email, MIT licence for code, art and video all rights reserved,
  curated tree (no raw art sheets, no QA evidence, no local paths, ids or secrets: scan and read the diff), video as a release asset, a CI job running `npm run test:unit`.
- A private repository link does not work for other people: invite collaborators, or make it public when the owner says so.
- What was done for `3d-fruit-dojo`: the curated tree was built in a separate folder (not inside the working project), sanitised with grep patterns for local paths, the owner's email,
  Higgsfield workspace and user ids, CDN URLs, session ids and token-like strings, and tested from a CLEAN COPY (`npm run test:unit`, start the server, curl the page and assets, no
  file over 20 MB, every relative link of README and GUIDE resolves). Asset tests that need the heavy sources (4k backdrops, raw sheets) SKIP with a clear message when
  `design/` is incomplete (`test-support/assets/design-sources.js`); keep that pattern: tests must never fail just because a heavy folder is not in git. The art sources that are kept
  (sprites, UI, effects, icons) are about 20 MB; the 4k backdrops (84 MB) and raw sheets (230 MB) and the QA evidence (239 MB) stay out. Higgsfield job ids stay in
  `design/assets.csv` and `public/assets/PROVENANCE.csv` as provenance (a test requires them); no URLs, user or workspace ids.
- The video is a release asset, not a git file; `video/` holds its plan, scripts and composition sources only.

## 9. Concrete plan for the clay pigeon shooting game (time-boxed, adapt freely)

### 9.1 Game design to propose (ask the owner only for the choices marked ?)
- Concept: skeet or trap shooting range. The player stands at a station, says "Pull", clay targets fly out of the houses, the player aims with the Joy-Con and pulls
  the trigger. Two shells in the gun, reload automatically after a pause or with a button. Rounds of 25 targets in stations, singles then doubles. ? Skeet versus trap
  versus an arcade mix (recommended: arcade mix with 3 stages of increasing difficulty).
- Camera: a first-person view down the range in 2.5D (parallax layers, targets scale with distance) is the most immersive and works with the layered backdrop
  pipeline. Targets are sprites scaled by depth. ? 2D side view is simpler: choose 2.5D unless time is tight.
- Scoring: hit = 1 point, centre hit bonus, streak multiplier, doubles bonus, accuracy and rank at the end, best score saved locally.
- Shot model: shotgun pattern = a small cluster of pellets inside a cone, the hit test is a circle of the pattern radius that grows with distance; a lead
  indicator is NOT shown (skill), but a slow-motion "kill cam" on perfect hits is.
- Physics: ballistic flight with drag, wind per stage, targets launched with seeded randomness (deterministic: same seed, same targets).
- Modes: Classic rounds, Time attack, Zen/practice (no scoring, infinite shells). Difficulty presets map to target speed, spread of angles and time limit.
- Juice (the owner wants spectacular effects): muzzle flash, gun recoil on screen, shell casing, smoke, clay shatter into fragments with dust, hit stop, slow motion on
  doubles, camera shake, combo banners, results screen with a stamped rank, screen transitions. Audio: boom with a low thump and a tail, clay crack, shell
  insert, "Pull!" voice-less cue (synth), crowd-less ambient wind and birds.
- Settings: aim sensitivity presets and a curve, trigger button choice, rumble on or off, aim assist (off by default), left or right unit, reduce flashing, reduce motion.

### 9.2 Architecture
Same as the previous game: pure deterministic `game/` (seeded RNG, fixed timestep, snapshot plus events), `input/` providers (native bridge, simulator, mouse),
`motion/` (relative pointer), `render/` (layered stage, sprites, particles, HUD), `ui/` (stick navigation, settings, tuning screen), `audio/` (WebAudio). A shot
event carries the pointer position and the press time. The simulator provider must be able to "aim and shoot" for bots and videos.

### 9.3 Order of work (aim for one working day of wall-clock time)
1. Fork the repository, rename, strip `public/js/game/` and the fruit art, keep input, motion, ui, render infrastructure, bridge, tools, tests that still apply.
2. Hardware session (30 min with the owner, section 4.5): record aim, snap shots and trigger jitter. Decide the trigger compensation from the data.
3. Game design bible and architecture contracts (one agent, short), then parallel engineers: game logic, motion and trigger, renderer and effects, UI and menus, audio,
   art with Higgsfield (backdrop layers, clay sprites and fragments, gun and HUD, muzzle flash, smoke, UI kit), fonts.
4. Integrator, then ONE validation round (QA bot plays, visual critic with filmstrips, code reviewer, motion verifier replaying recordings), fixer, clean-room validator.
5. Frozen copy for the owner to try with the real Joy-Con, then tune from their feedback.
6. Video and GitHub repository as in sections 7 and 8.

### 9.4 Acceptance criteria to write into the contract
- Aim stability while holding still: cursor movement under about 10 px over 10 s on the real recording.
- Trigger: the fired position equals the aimed position within a few pixels in at least 90 percent of recorded shots after the compensation.
- No accidental shots from jitter when no button is pressed. No accidental menu activation (menus use stick, A, B).
- 60 fps at 1080p with the effects on; every image optional with a procedural fallback; deterministic seeds; tests green; docs and hardware checklist truthful.

### 9.5 Risks
- 33 Hz input and a shotgun feel: use extrapolation carefully and measure the end-to-end delay. UNVERIFIED on hardware.
- The trigger press shakes the wrist (see 4.2). Needs real measurement.
- No absolute pointing reference: a relative pointer with auto-centre is the compromise, offer a re-centre button.
- Left Joy-Con is untested.
- Battery: warn the player when the battery voltage is low.

## 10. Ready-to-paste first prompt for the new session

> Read `NEW-GAME-PLAYBOOK.md` completely. We are building a clay pigeon shooting game ("tiro al piattello") played with a Nintendo Switch 2 Joy-Con 2 as the gun, in the
> browser, reusing the previous project "3D Fruit Dojo" (its repository is attached or in `../joycon-ninja`). Talk to me in Italian, write code, UI text and docs in English.
> Ask me ONE multiple-choice question about the game design choices of section 9.1 and the permissions of section 1 (font downloads, Higgsfield credits budget, GitHub),
> then work autonomously with parallel agents as in section 5, time-boxed to about one day. Start by forking the repository and recording a hardware session with me (section 4.5).
> Prepare a frozen copy for me to test, and never claim anything about the real hardware that was not measured.

## 11. Environment notes (the owner's Mac)
- macOS 26, Apple silicon, Node 24, npm 11, Google Chrome 154, ffmpeg with libx264 and aac, Xcode Command Line Tools (clang works, Swift does not), Python 3.14 without
  Pillow or NumPy, GitHub CLI logged in to the owner's account, Higgsfield connected (check the balance with the balance tool before spending).
- Start the game: double-click `start.command` (or `PORT=8231 ./start.command`); native bridge needs the Terminal Bluetooth permission the first time.
- Run tests: `npm test` (all), `npm run test:unit` (no Chrome needed), `node --test --test-concurrency=3 <files>` (under load).
- Rebuild assets: `npm run build:assets`. Record hardware data: `node tools/record-imu.mjs ...`. Analyse: `node tools/analyze-imu.mjs recordings/<file>.jsonl`.

## 12. Late lessons from the final push (2026-10-01), with the numbers

### 12.1 Hit areas: the owner said "the hit boxes are small"
- First numbers (a plausible guess, `hitMul` fruit 1.25, no blade width) gave a collision circle of 60 px (cherry) to 115 px (watermelon). Too small for a sword held by a hand with
  tremor and 33 Hz input. Final: `hitR = round(r x mul) + bladeHalfWidth`, `hitMul` fruit 1.55, Golden Apple 1.6, power-ups 1.5, bomb 0.85 (STRICT, unchanged), blade half width 14 px
  for everything except the bomb, which gives 88 px (cherry) to 157 px (watermelon), Golden Apple 116, medallion 107, bomb 54. It is a capsule written as a circle: proportional to the
  DRAWN radius, so a small fruit stays harder than a big one but nothing is a pixel hunt.
- The check that mattered: measure the worst case against the real sprite, not the circle. With 1.55 x r + 14 px the farthest body pixel of the worst fruit (the strawberry) is within
  27 px of the edge; `hitMul.fruit` 1.45 would still have kept 100 percent of the swings within 20 px of the edge (the fallback if it feels too generous). The swept-segment test means a
  fast swing never tunnels.
- Rules: size hit areas from the drawn radius, add the blade width, keep hazards strict (a bomb you "almost" hit must not explode), keep the numbers in one config object, and say that
  how generous it feels is UNVERIFIED-ON-HARDWARE (HW-3). For the shooting game the same lesson applies to the pellet pattern radius: be generous, then tighten with data.

### 12.2 Fonts: the owner called the system fonts terrible
- Chosen from a specimen page that shows REAL game strings at 28 to 160 px over paper, the night veil and the vermilion plate: **Lilita One** (display, Juan Montoreano) and **Fredoka**
  (UI, The Fredoka Project Authors), SIL OFL 1.1. Four candidates were rejected on the specimen (Titan One, Bowlby One, Paytone One, Nunito).
- Shipped as two WOFF2 files, 9 724 and 27 064 bytes (36 KB in total), Latin subset (`U+0020-007E, U+00A0-00FF`, dashes, quotes, bullet, ellipsis, minus), `kern` and `liga` only. Fredoka is a
  variable font: pin `wdth=100` and `wght` 500..700 with `fontTools.varLib.instancer`. The family names inside the files were RENAMED to "Dojo Display" and "Dojo UI" because the OFL does not
  let a modified version keep a Reserved Font Name. The licence texts are shipped next to the files and in the provenance file.
- Loading: `FontFace` with `display: swap`, raced against a 2.5 s timeout, never blocks the first frame, the canvas draws with the system fonts until they are ready, and `?fonts=0`
  keeps the art but skips the fonts. A central text helper (outline, shadow, tracking, plates, shrink-to-fit with a 28 px floor, a baked text-sprite cache) is what made the change cheap.
  Do this on day one of the next game; it changes the look more than any picture.

### 12.3 Effects: "not spectacular" became a timed catalogue (`docs/restyle-direction.md`)
Everything is a pure function of time driven by the renderer; game logic, RNG streams, hit boxes and snapshots did not change. The numbers that made it feel good:
- Slice: directional flash in 70 ms scale-up and 140 ms fade, ink splatter decal held 1000 ms then faded over 2500 ms, at most 30 new particles per cut (60 in 200 ms for a combo).
- Hit-stop on the render side only (draw the previous object positions): 40 ms for cut 2 and 3 of a swing, 50 ms for cuts 4 to 6, 60 ms from the 7th, at most one per 250 ms, none during Freeze.
- Camera punch on 2 or more cuts: zoom 1.012 in 50 ms and back in 180 ms, shake 3 px for 90 ms; 8 px / 160 ms at 5 cuts, 12 px / 220 ms at 8.
- Combo banner: scale 1.5 to 1.0 in 180 ms at 2 cuts up to 2.2 to 1.0 in 220 ms (overshoot 2.4) at 4 to 6, held 700 to 900 ms; the "x n" number pops 1.0 to 1.25 in 70 ms.
- Bomb: paper-white flash (in 60 ms, out 260 ms, peak 0.55), shockwave ring 0 to 420 px in 450 ms, shake 22 px for 500 ms, red vignette peak 0.35 over 1100 ms, "BOMB!" slam from 2.0 to 1.0
  in 140 ms at 40 ms, soot decal. Game over: slow motion 0.30 for 700 ms.
- UI: an ink-brush wipe between screens (PAPER coloured, not ink, so there is no dark flash): cover 180 ms, swap, reveal 180 ms; button press 1 to 0.94 in 70 ms and release in 160 ms with
  overshoot; results count-up 1200 ms; rank stamp slam 3.0 to 1.0 in 140 ms; countdown numerals 2.2 to 1.0 in 180 ms.
- Safety nets that must ship with effects: "Reduce flashes" and "Reduce motion" variants of every effect, no flash faster than 3 Hz, a particle cap, a flash limiter, and a perf budget
  (final: 0.41 ms of JavaScript per frame on average, 60 fps in headless Chrome, heaviest scene p99 7.9 ms).
- Audio the same way: synthesised (no files), sub-buses with ducking, a voice limit of 24, levels set by measurement (slice -12 dBFS, bomb -4), UNVERIFIED by ear.

### 12.4 What took how long (calendar time read from file timestamps and the documents; the owner's machine was often heavily loaded; durations that were not recorded are not guessed)
| Step | Timestamp evidence (local time) |
|---|---|
| Protocol research, design bible, architecture contracts | the protocol document was created 2026-09-30 01:44; earlier research time was not recorded |
| First complete build, integration, then QA, code-review and protocol-audit rounds | about 12.5 hours of calendar time from the protocol document to the first QA, review and audit reports (2026-09-30 14:11 to 14:14) |
| Art brief and Higgsfield phases (about 165 credits in total, see the brief) | brief last edited 2026-09-30 14:43; the art integration document was last updated 2026-10-01 14:57 |
| The owner's real recording | one session of 142 s, nine labelled steps, file written 2026-09-30 20:45 |
| Motion retune and verification rounds | motion findings last written 2026-09-30 23:58 |
| Restyle round (fonts, effects, audio, transitions, stick menus), final integration | restyle direction 2026-10-01 14:19, fonts and bridge documents 15:56, final status 20:04 |
| Presentation video and the curated repository | plan edited 2026-10-01 21:14, repository built the same evening |
In total about 43 hours of calendar time passed between the first protocol document and the repository build, most of it parallel agent work with the owner's real-hardware sessions in between.
Earlier notes of this playbook say single workflows ran 10 to 17 hours on the loaded Mac. For the shooting game, with this code to reuse, plan a first playable version in one working day
and a restyle in a second one, and do the real-hardware recording session FIRST.

### 12.5 Numbers worth remembering
- Final suite: 2033 tests (1974 Node-only, 59 end-to-end), about 136 s with five files in parallel; the repository copy runs `npm run test:unit` without Chrome and skips the asset-pipeline
  tests that need the heavy art sources.
- Repository: 678 files, about 62 MiB (65 MB), `collecticraft-sudo/3d-fruit-dojo`, the largest file 1.8 MB.
- Honesty: what is VERIFIED on hardware is listed in `docs/FINAL-STATUS.md` section 5; everything else is UNVERIFIED-ON-HARDWARE. Keep that discipline in the next project and in every
  video, README and message.
