# 3D Fruit Dojo: Architecture and Module Contracts

| Item | Value |
|---|---|
| Name | **3D Fruit Dojo** (renamed on 2026-09-30 from the working title "Joy-Con Ninja"). The code name `joycon-ninja` stays in the folder, the package name, `window.__ninja`, the URL flags, the `/__health` body, the `X-Joycon-Ninja` header and the `joyconNinja.*` storage keys. |
| Version | 1.0 (contract freeze for parallel implementation) |
| Author role | Software architect |
| Audience | The four engineers (Input, Motion, Gameplay, Presentation), the Integrator, QA agents, the owner (CollectiCraft) |
| Language | English (owner request). All in-game UI text is English too and lives in `public/js/ui/strings.en.js` (owner decision of 2026-09-30: the first version of the game showed Italian text). |
| Inputs | `docs/joycon2-protocol.md` (protocol researcher), `docs/game-design.md` (game designer), `docs/joycon2-test-vectors.json` |
| Companion files | `docs/contract-notes.md` (deviation log), `public/js/shared/contracts.js` (canonical typedefs and enums), `public/js/shared/validate.js` (runtime contract validators); for the optional generated art (section 8.11): `docs/assets-integration.md` (the contract) and `docs/assets.md` (the shipped files, measurements and pipeline) |

> **HARDWARE HONESTY.** Nobody on the team can touch a real Joy-Con 2. Every statement in this document about how the physical controller, its BLE stack or the owner's Chrome/macOS Bluetooth path behaves is taken from the two source documents and is **UNVERIFIED-ON-HARDWARE**. Nothing here was observed on the device, except what `docs/hardware-findings.md` records from the owner's two native probes of 2026-09-30 (not Chrome, not this game). The native Bluetooth bridge (A-03, 5.11) was tested against a fake helper only. Section 13 lists the rules for labelling such things in code, docs and reports.

---

## 0. Read this first: the 14 rules

1. **Ownership is absolute.** You edit only the files you own (section 2). To change anything else, log a request in `docs/contract-notes.md` and implement against the contract as written.
2. **The contract is `public/js/shared/contracts.js` plus this document.** If the two differ, `contracts.js` wins for names, fields, units and enums; this document wins for behaviour. Typedefs are embedded verbatim in section 11.
3. **Import rules are enforced by `test/architecture/boundaries.test.js`** (section 2.3): modules see each other only through `shared/`, the three `*-config.js` data modules and, for `main.js`, each module's `index.js`.
4. **One time base.** Every timestamp is milliseconds on a `Clock` (`performance.now()` in the browser, a counter under `?clock=manual`). Nobody outside `shared/clock.js` calls `performance.now()`, and nobody calls `Date.now()` except Motion to stamp `Calibration.createdAt`. Modules receive the clock (or a time value) as an argument.
5. **`game/`, `motion/`, `shared/` are pure**: no DOM, no storage, no timers, no network, no `Math.random` (Game uses the seeded streams of `shared/rng.js`). They must be importable in Node with no globals.
6. **Every module is importable in Node.** No top-level access to `window`, `document`, `navigator`, `localStorage`, `AudioContext`. Guard with `typeof` or take the object as a parameter (dependency injection is how tests fake Web Bluetooth, the canvas, WebAudio and storage).
7. **Zero runtime dependencies, offline.** No npm packages, no CDN, no web fonts, no external URLs. The art is procedural and complete by itself; image files exist only as OPTIONAL generated art under `public/assets/` (section 8.11, `docs/assets-integration.md`): every image may be missing, and then the procedural drawing runs unchanged. ES modules with explicit `.js` extensions in every relative import.
8. **Language.** UI strings English, only in `ui/strings.en.js` (owner decision of 2026-09-30: the first version of the game used Italian text). Code, comments, docs, commit text English.
9. **Numbers live in config modules** (section 2.4). No magic numbers in logic. Gravity `1300` and spawn line `1190` appear only in `game/config.js` (guard test).
10. **Use the validators.** Every module's tests assert its outputs with `assertValid(kind, value)` from `shared/validate.js`. `?debug=1` makes `main.js` validate at module boundaries.
11. **Never write to the wrong Joy-Con characteristic.** The BLE provider writes only to the command characteristic `649d4ac9-8eb7-4e6c-af44-1ea54fe5f005` (protocol section 1 decision 13).
12. **Label what you cannot verify** with the exact tag `UNVERIFIED-ON-HARDWARE` (section 13). Never write "works on the Joy-Con". Report skipped checks honestly.
13. **Be deterministic.** Same seed + same scripted input + same manual-clock steps gives identical snapshots. Nothing in `game/` may depend on wall-clock time, frame rate or object identity order that is not seeded.
14. **Log deviations, do not silently deviate.** Any place where you could not follow this document goes into `docs/contract-notes.md` the same day (template inside).

---

## 1. Decisions (pick-one answers to every ambiguity)

The two source documents disagree or are silent in the places below. These decisions are final; do not re-litigate.

| ID | Topic | Decision | Reason |
|---|---|---|---|
| A-01 | Source paths | Both documents say `src/...`. The real tree is `public/js/...` (section 2). `src/game/config.js` -> `public/js/game/config.js`, `src/ui/strings.en.js` -> `public/js/ui/strings.en.js`, `src/input/ble-provider.js` -> `public/js/input/ble-provider.js`. The protocol's `joycon2-parse.mjs` is `public/js/input/joycon2-parse.js` (`.js` only, `"type":"module"`). | The server serves `public/`; no build step. |
| A-02 | Config modules | Appendix A of the design is split by owner: `game/config.js` exports `CONFIG` (everything except `input`, `cut`, `calibration`, `connect`); `motion/motion-config.js` exports `MOTION_CONFIG` (`input`, `cut`, `calibration` plus new fusion values, section 6.8); `input/input-config.js` exports `INPUT_CONFIG` (`connect` plus BLE ids and timings, section 5.6). All three are data-only and importable by every module. `CONFIG.modes.<mode>.cutMul` exists for all modes (classic 1, arcade 1, zen 0.8); the design's `CONFIG.cut.zenMul` is dropped. `window.__ninja.getConfig()` returns `{game, motion, input}`. | Disjoint file ownership. |
| A-03 | Transport | **Two transports behind one interface: the native Bluetooth bridge (recommended, built 2026-09-30) and Web Bluetooth.** The provider kind `'native'` (`createInputProvider('native')`, `?input=native`) talks to a CoreBluetooth helper through the game's own server; `'joycon'` is Web Bluetooth. Both report `kind: 'joycon'` (same controller), share the report pipeline and differ only in the transport. The old reserved name `bridge` is gone. See 5.11 for the decision and docs/native-bridge.md for the design. *(Until 2026-09-30 this row said plan B was not built; it was reversed after Chrome's chooser listed no device on the owner's Mac while a native probe worked.)* | Hardware evidence of 2026-09-30 (docs/hardware-findings.md); Swift is broken on the Mac, so the helper is Objective-C built with clang; zero npm dependencies. |
| A-04 | Who computes "cutting" | The **Motion pipeline** owns blade speed, the cut-state hysteresis and segment merging (`BladeTracker`). The Game never sees IMU or pixels, only `BladeSegment[]`. The mode multiplier (Zen x0.8) is applied by `main.js` through `MotionSettings.cutMul` when a round starts. | One place for the threshold; the same tracker serves IMU, mouse and the debug swing. |
| A-05 | Sample timestamps | `ImuSample.t` is the estimated instant of the measurement on the Clock; `ImuSample.dtMs` is the integration step (device-timestamp based when trusted). Motion integrates with `dtMs`, never with `t` differences. | Arrivals are bursty (protocol 7.3). |
| A-06 | Fixed timestep | Game runs a **real-time tick of 1/120 s**; each real tick adds `timeScale * dt` to a world accumulator and runs at most one world step (timeScale <= 1). Real-time systems (timers, blade processing, mercy, slow-mo durations) run on the real tick. Details and the interpolation formula in 7.3. | Design 2.2 says "accum += frameDt * timeScale"; this is the same thing made explicit and deterministic. |
| A-07 | Game clock input | `Game.update(frameDtS, segments, nowMs)` takes `nowMs` on the same Clock as `BladeSegment.t1`. Combo windows and swing-end detection compare segment stamps with `nowMs`; timers advance with ticks. | Segments are stamped with input time; the game must never read a clock itself. |
| A-08 | Snapshot and events | Two channels: `snapshot()` (state, includes the last 32 events for debugging) and `drainEvents()` (each event exactly once, for audio, particles, popups). | Renderer and audio must not miss or double-count events. |
| A-09 | Who says "the game is running" | `UiState.gameActive` (the UI state machine) is the single source of truth. `main.js` calls `game.update` if and only if `gameActive` is true. Pause, countdown, resume countdown and overlays all simply make it false. | No duplicated pause flags. |
| A-10 | Action routing | The **UI is the only consumer of `ActionEvent`**. `main.js` forwards every action with `ui.notify({type:'action'})` and executes the resulting `UiIntent`s (`recenter`, `confirmCenter`, `pause` effects, ...). | One place decides what a button means on each screen. |
| A-11 | Mouse clicks | The UI owns canvas pointer clicks (hit-test on `pointerup`, playfield coordinates from `shared/playfield.js`). The mouse/simulator provider emits only `back` (right click), `pause` (middle click), `recenter` (double click); **left click is not an action** (the UI handles it as "activate the target under the pointer"). Keyboard emits `confirm` (Enter), `back` (Esc), `pause` (P), `recenter` (Space). | Avoids double activation of buttons (design table 8.1 is satisfied at UI level). |
| A-12 | Simulator | Default **66 Hz** with +-3 ms jitter and occasional two-packet bursts, timestamps in microseconds, gyro bias and noise, everything quantised through `buildInputReport` -> `parseInputReport` (protocol Appendix A). `?simhz=250` selects the design's 250 Hz. The sim exposes `tick(now)` and an exact `nominalCalibration`. | The pipeline must be tested at the rate the hardware is expected to deliver (protocol 7.3, UNVERIFIED-ON-HARDWARE). |
| A-13 | Gyro scale | The parser converts with the default `2000/32768` deg/s per LSB (test vectors stay exact). Motion applies `Calibration.gyroScale` (multiplier). Sources of the multiplier, in priority order: (1) the diagnostics one-revolution tool result stored under localStorage key `joyconNinja.imu.v1` (read by `app.js` when the Bluetooth provider is chosen and passed to Motion with `setGyroScaleOverride`; the simulator and the mouse never use it, round 2 finding M3), (2) the automatic estimate during calibration steps 1 -> 2 (6.4), (3) 1. Candidates are 1 and 0.12288 (protocol D1). | Protocol 7.2 requires a check; the design wizard has four fixed steps, so the check is free (transition) plus optional (diagnostics). |
| A-14 | Cooldown | `INPUT_CONFIG.cooldownS = 10` after a failed connect or a lost link; after `longCooldownAfterFailures = 3` consecutive failures the cooldown is `longCooldownS = 180`. One silent automatic retry after 2 s re-uses the already-selected `BluetoothDevice` object (no chooser needed). Chooser cancellation never starts a cooldown. | Protocol 5.5 (mitigations 2-4) refines design 12.4 (HW-5). |
| A-15 | Battery | BLE gives millivolts only. `BatteryInfo.pct` is **null** for BLE (no trustworthy mV -> % mapping, protocol 7.6, UNVERIFIED-ON-HARDWARE); the level is `ok/low/critical/unknown` (thresholds 3550/3300 mV). The UI shows `connect.batteryLevel.*` instead of a percentage, and the low-battery toast fires on `low` or `critical`. | Do not invent a percentage. |
| A-16 | Practice round | Calibration step 4 is a real round with `mode: 'practice'` (`createGame('practice', seed)`): one apple every 3 s at apex (960, 400), gScale 1, no score, no lives, no bombs, no power-ups, `snapshot.practice = {cut, elapsedS}`, event `practice`. It keeps throwing after 20 s (the UI then shows `cal.tryAgain`). | Design 12.5 step 4 needs game physics. |
| A-17 | Horizontal flip | `MotionSettings.flipX` and `Settings.flipX` exist because yaw sign cannot be validated by gravity (protocol 7.4 point 3). The calibration screen (steps 3 and 4) shows a small button `cal.flipX.button`. | Protocol requires the toggle; the design has no place for it. |
| A-18 | Debug API defaults | `__ninja.start()` defaults to `skipCountdown: true` (design default is false; agents forget flags). `swing()` always returns a Promise; under the manual clock the effects are already applied when it returns. | Automation friendliness. |
| A-19 | Snapshot shape | The design's `objects[].cut` is dropped (a cut object is removed and replaced by two halves, so it would always be false). `NinjaSnapshot` flattens `GameSnapshot` and adds `screen`, `overlay`, `provider`, `calibrated`, `manualClock`, `nowMs`, `game`. | Honest schema. |
| A-20 | Haptics | `InputProvider.vibrate` exists (BLE, rate-limited to 10/s) but is wired only with `?haptics=1` (preset id 3 on `cut`, 6 on `bomb`). Off by default. | UOH-13; not in the design. |
| A-21 | Joy-Con button mapping | Fixed table in 5.7. `HOME` is never used. Shoulder-class buttons recenter, small system buttons pause. | Design 8.1 constraints + protocol 6.2 advice. |
| A-22 | Sensitivity in the simulator | The simulator maps the virtual mouse at the **fixed base** 27.4 px/deg, so `sensitivity = 1.0` makes cursor = mouse position. | Simple, testable. |
| A-23 | Round end timing | `CONFIG.ending` holds the delays after which `phase` becomes `'over'`: classic 800 ms after `gameOver`, arcade 1300 ms after `timeUp` (300 ms freeze + 1000 ms), zen 600 ms. Between the end trigger and `over` the phase is `'ending'`: objects keep flying (classic) or freeze (arcade), segments are ignored. | Design 7.2 and 9.10. |
| A-24 | Left Joy-Con axes | Not assumed to equal the right unit's. Motion discovers axes by calibration; the sim treats both sides identically and only reports `side`. | Protocol 7.4 (Left frame is L confidence). |
| A-25 | Test discovery | `npm test` = `node --test "test/**/*.test.js"` (quoted glob; Node 24 supports it). Helper modules live in `test-support/`, never in `test/` (a bare `node --test` would execute every `.js` under `test/` as a test file). | Verified on this machine (Node v24.15.0). |
| A-26 | Browser driver for e2e | No dependency: Node's built-in `WebSocket` + Chrome DevTools Protocol against a headless Chrome launched by `test-support/e2e/cdp.js`. If Chrome is missing the e2e suite reports `skipped`, never `passed`. | Zero-dependency rule. |

---

## 2. Directory layout and file ownership

### 2.1 Tree

```
joycon-ninja/                      (the folder keeps the code name; the game is called 3D Fruit Dojo)
  package.json                     (architect, done)  "type":"module"; scripts start, test, test:unit, test:e2e
  server.js                        Integrator         dependency-free static server, port 8137
  start.command                    Integrator         double-click launcher (bash, chmod +x)
  README.md                        Integrator         end-user README (English)
  tools/                           Asset engineer     build-assets.mjs and asset-spec.mjs: build public/assets/ from design/ (a developer tool, never needed to run the game)
  design/                          the art brief (higgsfield-brief.md), the asset list (assets.csv) and the raw generated sheets: provenance, the game never reads it
  docs/
    architecture.md                architect (this file)
    contract-notes.md              architect creates, EVERYONE appends
    joycon2-protocol.md            protocol researcher (read-only for us)
    joycon2-test-vectors.json      protocol researcher (read-only, normative hex)
    game-design.md                 game designer (read-only for us)
    GUIDE.md                       Integrator (later)   English guide for the owner, with the HARDWARE CHECKLIST
    native-bridge.md               Input, Integrator    the native Bluetooth bridge as built (design, protocols, security, string keys, open items)
    assets-integration.md          Art architect        the contract of the optional generated art (loader, sprites, stages, UI kit, tests)
    assets.md                      Asset engineer       the shipped art: pipeline, measurements, sizes, memory, provenance
  public/
    assets/                        Asset engineer     OPTIONAL generated art (sprites, fx, icons, ui, backgrounds) with manifest.json and PROVENANCE.csv (section 8.11)
    index.html                     Integrator         one <canvas id="stage">, module script
    diagnostics.html               Input
    css/                           Presentation       game.css (letterbox, cursor rules)
    js/
      main.js                      Integrator         boot, wiring, loop, window.__ninja
      shared/                      architect (frozen) contracts.js emitter.js clock.js rng.js playfield.js validate.js
      input/                       Input              providers (BLE, native bridge, simulator, mouse), parser, builder, actions, diagnostics-page.js, input-config.js, index.js
      motion/                      Motion             pipeline, calibration, fusion, blade tracker, motion-config.js, index.js
      game/                        Gameplay           pure logic, config.js, index.js
      render/                      Presentation       canvas renderer, sprites, fx; the art layer: assets.js (loader and scaled cache), stage.js (layered backdrops), art-config.js (data)
      audio/                       Presentation       WebAudio engine and recipes
      ui/                          Presentation       screens, state machine, strings.en.js, storage.js, presentation.js
  bridge/                          Input              the native Bluetooth bridge: joycon-bridge.m (CoreBluetooth helper, Objective-C), Info.plist, build.sh, manager.js (section 5.11, docs/native-bridge.md)
  test/
    shared/                        architect          (done) shared.test.js, validate.test.js
    architecture/                  architect, then Integrator   boundaries.test.js
    input/  motion/  game/  render/  audio/  ui/     the owning engineer
    e2e/                           Integrator
  test-support/
    input/ motion/ game/ render/ audio/ ui/          helpers and fakes of the owning engineer (fake navigator.bluetooth, synthetic IMU generator, fake canvas, fake AudioContext, ...)
    e2e/                           Integrator         cdp.js (minimal Chrome DevTools Protocol client), chrome-launcher.js
```

### 2.2 Ownership table

| Path | Owner | Notes |
|---|---|---|
| `public/js/input/**`, `public/diagnostics.html`, `test/input/**`, `test-support/input/**`, `bridge/**`, `test/bridge/**`, `test-support/bridge/**` | **Input engineer** | Includes the diagnostics page script `public/js/input/diagnostics-page.js` and the native Bluetooth bridge (the helper, its build script and the manager that `server.js` loads). |
| `public/js/motion/**`, `test/motion/**`, `test-support/motion/**` | **Motion engineer** | |
| `public/js/game/**`, `test/game/**`, `test-support/game/**` | **Gameplay engineer** | Zero DOM. |
| `public/js/render/**`, `public/js/audio/**`, `public/js/ui/**`, `public/css/**`, `test/render|audio|ui/**`, `test-support/render|audio|ui/**` | **Presentation engineer** | One person, one facade (`ui/presentation.js`). Internal split is theirs. |
| `public/index.html`, `public/js/main.js`, `server.js`, `start.command`, `README.md`, `docs/GUIDE.md`, `test/e2e/**`, `test-support/e2e/**`, `test/architecture/**` (after handover) | **Integrator (later)** | |
| `public/js/shared/**`, `test/shared/**`, `package.json`, `docs/architecture.md` | **Architect** | Frozen. After the freeze only the Integrator edits, and only via a `contract-notes.md` entry. |
| `docs/contract-notes.md` | everyone appends | Append only, never rewrite others' entries. |

The art layer of 2026-09-30 (section 8.11) was built by five roles working on disjoint files (asset pipeline and loader, gameplay renderer, stages, UI kit, copy and documents) and has its own ownership table in `docs/assets-integration.md`; the rows above keep describing who owns each directory. After that work the Integrator owns the wiring files again.

### 2.3 Import rules (enforced by `test/architecture/boundaries.test.js`)

| Module dir | May import |
|---|---|
| `shared/` | `shared/` only |
| `input/` | `shared/`, `input/`, and the data modules `game/config.js`, `motion/motion-config.js`, `input/input-config.js` |
| `motion/` | `shared/`, `motion/`, and the data modules |
| `game/` | `shared/`, `game/`, and the data modules |
| `render/`, `audio/`, `ui/` | `shared/`, `render/`, `audio/`, `ui/`, and the data modules |
| `main.js` | anything |
| tests | anything |

The art modules (`render/assets.js`, `render/stage.js`, `render/art-config.js`) are used only by `render/`, `ui/` and the wiring in `ui/presentation.js` and `app.js`: `game/`, `motion/`, `input/` and `shared/` never import them, and nothing outside `assets.js` touches `Image`, `fetch` or `createImageBitmap` for art (guard tests of the art layer, listed in `docs/assets-integration.md`).

Also enforced: relative imports only, `.js` extension, no `node:` or bare specifiers under `public/`, no `Math.random` in `game/`, no DOM/storage/network/timers/wall-clock in `game/`, `motion/`, `shared/`, no external URLs in `public/`, `1300`/`1190` only in `game/config.js`.

### 2.4 Config modules (data only)

| Module | Export | Contents |
|---|---|---|
| `public/js/game/config.js` | `CONFIG` | Appendix A of the design minus `input`, `cut`, `calibration`, `connect`; plus `modes.<mode>.cutMul`, `ending`, `practice`. Deep-frozen. |
| `public/js/motion/motion-config.js` | `MOTION_CONFIG` | design `input`, `cut`, `calibration` blocks plus section 6.8. Deep-frozen. |
| `public/js/input/input-config.js` | `INPUT_CONFIG` | design `connect` block plus section 5.6 values (UUIDs, timings, thresholds). Deep-frozen. |

### 2.5 Module entry points (the only names other modules may import)

| File | Exports |
|---|---|
| `input/index.js` | `createInputProvider(kind, opts)`, `createNativeProvider(opts)`, `createKeyboardActions(opts)`, `parseInputReport`, `buildInputReport`, `BUTTON_TABLE`, `SIM_MOUNTS`, `INPUT_CONFIG` |
| `motion/index.js` | `createMotionPipeline(opts)`, `MOTION_CONFIG` |
| `game/index.js` | `createGame(mode, seed, options)`, `rankFor(mode, score)`, `CONFIG` |
| `ui/presentation.js` | `createPresentation(deps)` |
| `ui/storage.js` | `createStorage(deps)` |
| `ui/strings.en.js` | `STRINGS`, `t(key, params)` |

`main.js` imports only these. Everything else in a module directory is private.

---

## 3. Global conventions

### 3.1 Time

- `Clock.now()` returns ms as a float, monotonic. Real clock = `performance.now()`. The manual clock (`?clock=manual`) starts at 0 and moves only through `advance(ms)`.
- Every event and sample carries `t` on that clock. Cross-module durations (combo window 250 ms, swing grace 100 ms) are differences of such `t` values.
- Game time in snapshots is **game seconds** (real time excluding pauses and the countdown). Field names with an `S` suffix are seconds, `Ms` suffix milliseconds.

### 3.2 Units

Playfield px (1920 x 1080, y down), ms/s as above, degrees for angles (radians only where a field name ends in `Rad` or inside private math), deg/s for angular rate, g for acceleration, px/s for speeds, mV for battery. Colours `#RRGGBB`.

### 3.3 Frames, signs and the mapping formula (the one place everything must agree)

- **Device frame D**: raw Joy-Con axes X, Y, Z in report order (protocol 6.1: accel at 0x30, gyro at 0x36). No swizzle, no sign change anywhere before Motion.
- **Accelerometer sign**: `ImuSample.accel` is the specific force. **At rest it equals +1 g pointing to world UP** (both real captures V1/V2 read about +1 g on raw Z lying face-up). So `up_D = normalize(accel)` when still.
- **Gyro sign**: `ImuSample.gyro` is assumed to follow the right-hand rule about +X, +Y, +Z of D. This is **not verified** (protocol 7.4: DS4-style mirroring is possible, UNVERIFIED-ON-HARDWARE). Motion measures it during calibration (`Calibration.gyroSign`).
- **World frame W**: `x` = player's right, `y` = forward (towards the screen), `z` = up. Right-handed (x cross y = z). World yaw zero is arbitrary (set at filter start); the centre reference removes it.
- **Sword frame S** (right-handed): `right x forward = up`. `forward` = blade tip direction, `up` = the direction that is up when the sword points horizontally at the screen. `Calibration.frame` stores the three axes as unit vectors **in device coordinates**. A vector with sword coordinates `v_S` has device coordinates `v_D = right*v_S.x + forward*v_S.y + up*v_S.z`.
- **Aim direction**: the sword's forward axis expressed in W, `a_W`. `yawDeg = atan2(a_W.x, a_W.y)`, `pitchDeg = asin(a_W.z)`. Roll about the sword's own axis is ignored (it does not change `a_W`).
- **Two pointer models (sword tuning round, 2026-09-30, `docs/motion-contract.md` section 1; this replaces the single absolute mapping).** Motion has a `pointerModel`, chosen per provider by `app.js` with `setPointerModel` (`'absolute'` for the simulator, `'relative'` for everything else; a real Joy-Con, over Web Bluetooth or the native bridge, is always relative).
  - **Relative (every real sensor, the default).** The cursor is a mouse in the local frame of the sword: there is no absolute orientation and no yaw reference, and only the VERTICAL axis looks at gravity (round F1, `docs/motion-contract.md` 2.9: the vertical rate is the rotation about the horizontal axis perpendicular to the blade, its gain the curve capped at 6 px/deg, used once a calm accelerometer reading has confirmed the filter's tilt, else the local rate below). Per IMU sample the tip velocity is `tv = w x forward` (deg/s, `w` = bias, sign and scale corrected gyro), its sword-frame components are `aR = tv . right`, `aU = tv . up`, the tip speed is `s = hypot(aR, aU)` (roll about the blade does not count), and the cursor moves by `F(s)` px/s in the direction `(aR, -aU)` (the vertical component as just said since round F1; identical for an upright sword below 75 deg/s) with `F(s) = sensitivity * e * (gLo + (gHi - gLo) * smoothstep(min(1, e / 300)))`, `e = s - 5` (dead zone 5 deg/s, gain 5 px/deg rising to 14 px/deg at 305 deg/s and above), trapezoid integration, clamped to the playfield. `flipX` mirrors x. Sensitivity scales the whole curve and nothing else.
  - **Absolute (the simulator, a mouse in disguise).** The original formula, with `ppd = 27.4 * sensitivity`, references `yawRef`, `pitchRef` set by (re)centering, `dYaw` wrapped to (-180, 180]:

```
x = 960 + (flipX ? -1 : 1) * dYaw * ppd        (yaw to the right moves the cursor right)
y = 540 - dPitch * ppd                          (pointing up moves the cursor up)
```

then clamped to 0..1920 and 0..1080.

### 3.4 Events, errors, promises

- Providers and the pipeline use `Emitter` from `shared/emitter.js`: `on(type, fn)` returns an unsubscribe function; handlers run synchronously; a throwing handler is isolated.
- **Rejections carry codes.** Every rejection from `InputProvider.connect/reconnect` is an `Error` with `.code` (an `InputErrorInfo.code`) and `.info` (the `InputErrorInfo`). Callers `catch` and read `.code`; no unhandled rejections may escape `main.js`.
- **Plain data across boundaries.** Snapshots, events, samples, statuses are JSON-serialisable. Interfaces (`InputProvider`, `MotionPipeline`, `Game`, `Presentation`) are the only function-bearing objects.
- **Immutable statuses.** A new `InputStatus` object per change, never mutated afterwards.

### 3.5 Purity and testability

`game/`, `motion/`, `shared/` are pure (rule 5). `input/`, `render/`, `audio/`, `ui/` touch browser APIs only through injected parameters or guarded `typeof` checks, so their logic is unit-testable with fakes in `test-support/`.

### 3.6 Language

Player-visible strings only in `ui/strings.en.js` (and the labels of `diagnostics.html`). Everything is English (owner decision of 2026-09-30; until then the game text was Italian).

---

## 4. Data flow and frame order

```
                      BLE notifications (63-byte reports)
 Joy-Con 2 --------> [input/ble-provider]  --ImuSample--+
 virtual mouse ----> [input/sim-provider]  --ImuSample--+--> main.js --pushImu--> [motion pipeline] --BladeSample--> recent() / latest() / headAt()
 real mouse -------> [input/mouse-provider]--AimSample--+ (pushAim)                    |
 debug swing ------------------------------ AimSample--+                              +--> drainSegments() --BladeSegment[]--> [game.update] --> snapshot(), drainEvents()
 keyboard ---------> [input/keyboard]      --ActionEvent--> main.js --ui.notify--> [ui state machine] --UiIntent--> main.js (connect, calibrate, start round, ...)
                                                                                                   |
 snapshot + events + BladeView + segments (menus only) --------> presentation.step()  ------------+--> canvas (draw), WebAudio
```

Per-frame order in `main.js` (the same `step()` is used by the real-clock `requestAnimationFrame` loop and by `__ninja.advance` under the manual clock):

1. `now = clock.now()`, `dtS = clamp((now - last) / 1000, 0, 0.05)`.
2. Inject due debug-swing samples into `motion.pushAim` (debug API only).
3. `provider.tick?.(now)` (simulator emits every sample due up to `now`; ImuSamples flow into `motion.pushImu` synchronously through the provider's `sample` event).
4. `motion.poll(now)`.
5. `segs = motion.drainSegments()`.
6. If `ui.getState().gameActive`: `game.update(dtS, segs, now)`, `events = game.drainEvents()`, `segsForUi = []`; if `game.isOver()` and not yet announced: `ui.notify({type:'roundOver', result})`. Otherwise `events = []`, `segsForUi = segs`.
7. Build `BladeView` (`motion.recent(260)`, `latest()`, `headAt(now)`, cutting, speed, `trackingOk` = provider AND motion, effective threshold).
8. `presentation.step({nowMs, dtS, snapshot, events, blade, segments: segsForUi, debug})`. UI intents fired inside are handled synchronously by `main.js` (may create/destroy the game, connect a provider, start calibration).
9. Real-clock loop only: `presentation.draw()`, then `requestAnimationFrame`. Under the manual clock `draw()` runs from its own `requestAnimationFrame` loop that does not step.

`connect` intents produced by a real DOM click must be handled **synchronously inside the click handler** (Web Bluetooth `requestDevice` needs the user gesture): `main.js` calls `provider.connect()` in the intent handler with no `await` before it.

---

## 5. Input contract (owner: Input engineer)

### 5.1 Responsibilities

Turn "something that moves" into the **same three streams**: `ImuSample` (Joy-Con and simulator), `AimSample` (mouse), `ActionEvent`; own the connection state machine and its errors; own the diagnostics page. Input knows nothing about the screen, the game or Motion.

Suggested internal files (only `index.js` exports are contract):

```
public/js/input/
  index.js              createInputProvider, createKeyboardActions, re-exports
  input-config.js       INPUT_CONFIG (UUIDs, timings, thresholds, cooldowns)
  joycon2-parse.js      parseInputReport, BUTTON_TABLE, constants   (protocol 7.7, normative layout)
  joycon2-build.js      buildInputReport (protocol Appendix A), command frame builders LED/FEATURE_SET/FEATURE_ENABLE/VIBRATE
  report-stream.js      transport-independent "bytes + arrival time -> ImuSample / ButtonsEvent / PacketEvent / battery" (time alignment, dt, side, buttons diff)
  ble-transport.js      requestJoyCon + openLink (protocol 5.6), no game knowledge
  ble-provider.js       InputProvider over ble-transport + report-stream + state machine
  native-link.js        fetch + EventSource towards the /__bridge/ endpoints of server.js (docs/native-bridge.md)
  native-provider.js    InputProvider over native-link + report-stream + the same state machine (helper states mapped onto it)
  sim-provider.js, sim-model.js    virtual sword physics, noise, jitter, bursts
  mouse-provider.js
  actions.js, keyboard.js          button -> action mapping (5.7), keyboard actions
  status.js             immutable status builder, state transition guard, cooldown logic
  diagnostics-page.js   script of public/diagnostics.html
```

`report-stream.js` must not know about Bluetooth: it takes `(bytes, arrivedAt)` and a `side`. That is what made the native bridge (a helper feeding hex over Server-Sent Events, 5.11) a drop-in: `native-provider.js` hands it the same bytes as `ble-provider.js`.

### 5.2 Factory and options

```js
createInputProvider(kind: 'joycon'|'native'|'sim'|'mouse', opts?: {
  clock: Clock,                                   // required
  bluetooth?: Bluetooth-like,                     // default globalThis.navigator?.bluetooth (inject a fake in tests)
  target?: EventTarget & {getBoundingClientRect}, // pointer events source (the canvas) for sim/mouse
  toPlayfield?: (clientX:number, clientY:number) => Point|null,   // default: clientToPlayfield(target.getBoundingClientRect(), ...)
  sim?: { hz?: 66|250|number, mount?: string|{frame:{right,forward,up}}, side?: 'L'|'R', mirrorGyro?: boolean,
          gyroScaleTrue?: 'default'|'alt', noise?: boolean, seed?: number, leverM?: number },
  log?: (level, message) => void,
  // 'native' only: fetch?, EventSource?, baseUrl?, native?: numbers, autoRetry? (default 0: no silent retry after a lost link)
}): InputProvider
createKeyboardActions(opts: { clock: Clock, target?: EventTarget }): { on, off, getLabels(): ActionLabels, dispose() }   // emits 'action' only
```

`connect(opts?: ConnectOptions)`: idempotent. If an attempt is in flight it returns the in-flight promise; if already `streaming` it resolves at once. `disconnect()` never throws.

Capabilities per kind:

| kind | imu | aim | buttons | needsUserGesture | needsCalibration | hasBattery | canVibrate |
|---|---|---|---|---|---|---|---|
| `joycon` | true | false | true | **true** | **true** | true | true |
| `native` | true | false | true | **false** (there is no chooser; the UI still connects from a click) | **true** | true | true |
| `sim` | true | false | false | false | false (it provides `nominalCalibration`) | false | false |
| `mouse` | false | true | false | false | false | false | false |

### 5.3 Connection state machine

States: `idle`, `requesting` (Chrome chooser open), `connecting` (GATT connect + discovery), `initializing` (init commands sent, waiting for the first valid report), `streaming`, `lost`, `error`. Design mapping: UI "connected" = `streaming`.

| From | To | Trigger | Notes |
|---|---|---|---|
| `idle` / `error` / `lost` | `requesting` | `connect()` (joycon) | User gesture required. Refused with `cooldown` (state unchanged) while `now < cooldownUntil`. |
| `requesting` | `connecting` | device chosen | |
| `requesting` | `idle` | chooser closed without choice | `error = cancelled`. **No cooldown.** `connect()` rejects with code `cancelled`. |
| `connecting` | `initializing` | service and characteristics found, side known | 15 s timeout on connect and on discovery. |
| `connecting` | `error` | connect/discovery failure, timeout, required characteristic missing | `gatt_failure`, or `not_joycon` if the service/side check fails. Starts cooldown. |
| `initializing` | `streaming` | first parsed report with `length >= 60` | `failures = 0`, `error = null`. `connect()` resolves. |
| `initializing` | `error` | watchdog stage 3 (9 s without a report, protocol 5.4 step 9) | `no_data`. Starts cooldown. |
| `streaming` | `lost` | `gattserverdisconnected`, or no report for `lostAfterMs` (2500) while `!document.hidden` | `lost_signal`. Starts cooldown. Emits `error` event. |
| `lost` | `connecting` | one automatic retry after `autoReconnectDelayS` (2 s), or `reconnect()` | Re-uses the known `BluetoothDevice`; no chooser. Allowed only when the cooldown has expired, except the single automatic retry, which is exempt from the short cooldown but counts as a failure if it fails. |
| `connecting` (entered from `lost`) | `lost` | the reconnect attempt failed or timed out | Back to `lost` (never `error`), `status.error` carries the specific code (`gatt_failure` or `no_data`), `failures += 1`, cooldown restarts. The UI's disconnect overlay depends on this. |
| any | `idle` | `disconnect()` | Also on `pagehide` (call `gatt.disconnect()`). |
| construction | `error` | `navigator.bluetooth` missing | `unsupported_browser`, `retryable: false`, no cooldown. |

`sim` and `mouse`: `idle -> streaming` synchronously inside `connect()`, never `lost` (except the sim debug hooks `simulateLoss()` / `simulateRecovery()`), `disconnect()` -> `idle`.

`native` (docs/native-bridge.md 4): the helper's statuses map onto the same table: a `connect` request is `requesting`, `scanning` stays `requesting`, `connecting` and `discovering` are `connecting`, `initialising` is `initializing`, and the provider becomes `streaming` at the first IMU-active sample exactly as the BLE one does. Differences: **no silent automatic retry after `lost`** (a Joy-Con that dropped is not advertising in pairing mode any more; the UI offers "Reconnect" after the player holds SYNC); only failures that involved the controller start the cooldown; a disconnect of a running attempt costs none; `status.error.native = {code, key}` carries the bridge's own code and the string key of its text.

**Cooldown rule.** `status.cooldownUntil = now + 1000 * INPUT_CONFIG.cooldownS` (10 s) when entering `error` with code `gatt_failure`/`no_data`/`not_joycon` and when entering `lost`. If `failures >= INPUT_CONFIG.longCooldownAfterFailures` (3) the interval is `longCooldownS` (180 s). While active, `connect()`/`reconnect()` reject with code `cooldown` (and emit the `error` event) without touching the radio. `cancelled` and `unsupported_browser` never start a cooldown. `failures` counts consecutive failed attempts and resets when `streaming` is reached. The controller-side cooldown itself is UNVERIFIED-ON-HARDWARE (protocol UOH-11).

`status` events are emitted on every state change, on every error, when battery level or `trackingOk` changes, and at most once per second for `packetRateHz`. Never emit a `status` from inside a hot path more than once per sample.

### 5.4 Error codes and their player-facing strings

The Input engineer emits codes and technical English `message`s (for logs). The Presentation engineer maps codes to the player-facing strings:

| `InputErrorInfo.code` | Meaning | Player-visible string key | Screen |
|---|---|---|---|
| `unsupported_browser` | no `navigator.bluetooth` | `connect.err.unsupported` | connect (button disabled) |
| `permission_denied` | `SecurityError`/permission refused | `connect.err.permission` (new) | connect |
| `cancelled` | chooser closed without a choice | `connect.err.cancelled` | connect |
| `not_joycon` | chosen device lacks the Joy-Con 2 service or characteristics | `connect.err.notJoycon` | connect |
| `cooldown` | attempt refused while cooling down | `connect.cooldown.wait` with `{s}`; after 3 failures `connect.cooldown.long` (new) | connect, disconnect overlay (`disc.wait`) |
| `gatt_failure` | connect/discovery/GATT operation failed or timed out | `connect.err.failed` | connect |
| `no_data` | connected but no reports within 9 s | `connect.err.noData` (new) | connect |
| `lost_signal` | link dropped or reports stopped while playing | `disc.title` + `disc.failed` after the auto retry failed | disconnect overlay |

The native bridge adds `status.error.native.key` (docs/native-bridge.md 9): when present the connect screen shows that text instead of the one of the `code` row (they say what to do next: start with `start.command`, hold SYNC, `xcode-select --install`, ...).

Chrome exception mapping (guidance): `NotFoundError` from `requestDevice` with no selection = `cancelled`; `SecurityError` = `permission_denied`; `NetworkError`, `InvalidStateError`, timeouts = `gatt_failure`; `NotSupportedError`/`SecurityError` on `getPrimaryService` for the vendor service = `not_joycon`.

### 5.5 Producing `ImuSample` (report stream rules)

Input per notification: `bytes` (a copy), `arrivedAt = clock.now()` taken **first thing** in the handler.

1. `report = parseInputReport(bytes, side)`; reject (emit `packet` with `report:null`, no sample) if `length < 60`. Layout, offsets, scales: `docs/joycon2-protocol.md` sections 6 and 7.7 (normative; the test vectors in `docs/joycon2-test-vectors.json` must pass exactly).
2. `accel = report.accelG`, `gyro = report.gyroDps` (default scale; Motion applies `gyroScale`).
3. **dt** (protocol 7.3, NORMATIVE): `dtUs = (ts[n] - ts[n-1]) >>> 0` (u32 wrap-safe). Accept `0 < dtUs < 200000`, else `dtMs = null` (and restart the estimate). Every 1 s compare `sum(dtUs)/1000` with the arrival span; ratio within 0.8..1.25 = trust device timestamps (`dtSource: 'device'`), otherwise fall back to arrival deltas (`'arrival'`) and log a warning (diagnostics shows it, Motion is told through `dtSource`). Never use the 0x00 counter.
4. **t**: map device time to the Clock with the running minimum of `(arrivedAt - ts/1000)` (removes burst jitter). `t = min(arrivedAt, offset + ts/1000)`, forced non-decreasing.
5. `side`: from the chosen device (PID at manufacturer data idx 5-6: Left 0x2067, Right 0x2066) confirmed after connecting by characteristic presence (vibration characteristic `289326cb-a471-485d-a8f4-240c14f18241` exists on the Left unit only, `fa19b0fb-cd1f-46a7-84a1-bbb09e00c149` on the Right unit only, protocol 3.2); if the two disagree prefer the characteristic; unknown = `'?'`. The simulator takes the side from its options.
6. `buttons`: names from `BUTTON_TABLE` (undocumented bits masked out); shared frozen empty array when none; emit a `buttons` event on every change (`down`/`up` computed against the previous report).
7. `batteryMv` from 0x1F; `BatteryInfo.level` thresholds 3550/3300 mV; `pct = null`.
8. `imuActive` false => no `sample` is emitted (Motion must never see an all-zero IMU), but the `packet` event still fires and the watchdog treats it as "no IMU data".
9. Emit order per report: `packet`, `buttons` (if changed), `sample`. Everything synchronous, no allocation beyond the sample object and the byte copy.

### 5.6 BLE provider requirements (protocol document is normative for bytes)

All of this is UNVERIFIED-ON-HARDWARE except what the two real captures V1/V2 prove about the packet layout.

- **Filter**: default `lenient` (`INPUT_CONFIG.defaultFilter`; it was `strict` until 2026-09-30) = `manufacturerData` company id `0x0553` with the PID bytes (idx 5-6) only, plus a second filter entry for company id `0x057E`, so the host-address bytes (idx 10-15) are ignored; `strict` = additionally the all-zero host address of a pairing-mode advert; `all` = `acceptAllDevices: true`. An unknown name means the default. Always `optionalServices: [SERVICE]`. Recipe: protocol 5.6 `requestJoyCon`. Do not filter by name or service UUID. Why the default changed, and what is and is not proven: `docs/hardware-findings.md` (on the first real test Chrome's chooser listed nothing with `strict`; the cause is UNVERIFIED-ON-HARDWARE). `app.js` resolves the filter of each chooser attempt as: the `connect` intent's `filter` (only the connect screen's "Extended search" button sets it, to `all`), then `?filter`, then the filter remembered from the last attempt that reached `streaming` (in memory and in localStorage key `joyconNinja.ble.v1`, every access in try/catch), then the default.
- **Constants** in `INPUT_CONFIG` (values from the protocol document): service `ab7de9be-89fe-49ad-828f-118f09df7fd0`; input `...7fd2`; command `649d4ac9-8eb7-4e6c-af44-1ea54fe5f005`; response `c765a961-d9d8-4d36-a20a-5315b111836a`; `featureMask 0xB7` (round 1 audit F1: 0x37 has no evidence on the plain command characteristic), `fallbackMask 0xFF`; `connectTimeoutMs 15000`; `discoveryTimeoutMs 15000`; `settleMs 300`; `initSpacingMs 500`; `keepAliveMs 1000`; watchdog stages 2000/4500/9000 ms; `lostAfterMs 2500`; `autoReconnectAttempts 1`, `autoReconnectDelayS 2`; `cooldownS 10`, `longCooldownS 180`, `longCooldownAfterFailures 3`; `hapticMinIntervalMs 100`; `batteryLowMv 3550`, `batteryCriticalMv 3300`.
- **Sequence** (protocol 5.4): chooser (user holds SYNC) -> `gatt.connect()` -> 300 ms -> `getPrimaryService` -> characteristics -> side -> subscribe to responses (non-fatal) -> LED -> SET(mask) -> ENABLE(mask) -> subscribe to the input characteristic -> keep-alive and watchdog.
- **Serialisation**: one GATT operation at a time (a promise chain), writes >= 100 ms apart, `writeValueWithoutResponse` when available. Whitelist: writes go only to the command characteristic. Never touch `4147423d-...` (firmware update) or `...7fdf`.
- **Keep-alive**: re-send the LED frame every 1000 ms when no write happened in the last 900 ms (macOS drops the link 10-17 s after the host's last write, single source, UOH-5). Expert flag `keepAlive:false` exists for the diagnostics experiment only.
- **Watchdog**: no report 2 s after enabling: re-send ENABLE; 4.5 s: SET+ENABLE with the fallback mask (0xFF; 0xB7 when the expert mask 0x37 was chosen; `featureMask` in status shows which), after which RECENTER edges are ignored for `action.recenterHoldOffMs` (phantom ZL/ZR bits); 9 s: fail with `no_data`.
- **Hidden tab**: timers are throttled; expose `document.hidden` through a `log` warning and let the UI show a warning. Do not count hidden time toward `lostAfterMs`.
- **Never loop `gatt.connect()`.** One attempt per user click, at most one silent automatic retry (5.3).
- **`vibrate(id)`**: rate limited (`hapticMinIntervalMs`), best effort, errors swallowed, no effect on streaming (UOH-13, UOH-15).
- **Testing without hardware**: `test-support/input/fake-bluetooth.js` implements `requestDevice`, GATT server, services, characteristics with `startNotifications`, `writeValueWithoutResponse`, `gattserverdisconnected`, configurable failures and delays, and replays the three vectors from `docs/joycon2-test-vectors.json` plus generated reports. The fake documents (in its header) that it models the protocol document, not the device.

### 5.7 Actions and labels

Every action has a no-button path (design 8.1); buttons on a strapped sword may be unreachable (HW-6). Mapping (rising edges only, side-specific because the two units have different buttons):

| Action | Right Joy-Con | Left Joy-Con | Keyboard | Mouse and simulator |
|---|---|---|---|---|
| `confirm` | `A`, `Y`, `X` | `DOWN`, `RIGHT`, `UP` | Enter | none (UI handles left click) |
| `back` | `B` | `LEFT` | Escape (`Esc`) | right click |
| `pause` | `PLUS` | `MINUS`, `CAPTURE` | `P` | middle click |
| `recenter` | `ZR` | `ZL` | Space | double click, plus keyboard Space |
| `section` | `R` | `L` | PageUp, PageDown | none |

`section` (added in the restyle round, `ACTION.SECTION` in `shared/contracts.js`) jumps to the other column of the settings and sword tuning screens and does nothing anywhere else; **`R` and `L` no longer re-centre** (the owner's real recording had the grip pressing R in the middle of a hard stroke, so a button that does nothing in play is the safer home for it). `HOME`, the stick clicks and the rail buttons are never mapped. The analog stick is not an action: it produces `nav` events (`input/stick.js`, `docs/contract-notes.md` "Stick navigation") that move the menu focus; A (`confirm`) and B (`back`) act on it. `ActionLabels` for `{button}` texts: Right Joy-Con `{confirm:'A', back:'B', pause:'+', recenter:'ZR', section:'R'}`, Left `{confirm:'Down', back:'Left', pause:'-', recenter:'ZL', section:'L'}` (the Left unit has arrow buttons instead of A/B/X/Y), keyboard `{confirm:'Enter', back:'Esc', pause:'P', recenter:'Space'}`, mouse `{confirm:'click', back:'right click', pause:'middle click', recenter:'double click'}`. `getActionLabels()` returns the active provider's set, falling back to the keyboard labels for missing entries. Escape during play is `back`; the UI turns it into pause.

Keyboard actions are independent of any provider and are active from page load (the safety screen needs Enter before any provider exists): `main.js` owns one `createKeyboardActions()` for the whole session and forwards its `action` events to `ui.notify`.

### 5.8 Simulator provider

Purpose: exercise the **real parser and the real Motion pipeline** with plausible synthetic data, on any machine, and let agents test everything without a Joy-Con.

- **Model**: a virtual sword with orientation `Q` (sword axes in world coordinates, columns) driven by the virtual mouse. Sword coordinates -> device coordinates through the mount frame `F = [right forward up]` (columns in device coordinates): `accel_D = F * (Q^T * (0,0,1))` (+ lever-arm linear acceleration, `leverM` default 0.45 m, see below), `gyro_D = F * omega_S` (times -1 when `mirrorGyro`). At the neutral pose (`Q = I`) `accel_D = frame.up`.
- **Aim from the mouse**: target yaw/pitch = `((mx - 960) / 27.4, (540 - my) / 27.4)` degrees, roll 0 (A-22), followed by a critically damped follower with time constant <= 6 ms so that steady mouse speed in px/s equals blade speed within 15% after the pipeline. `setTarget(x, y, {teleport})` sets the mouse position without pointer events (debug, tests); `teleport` re-anchors without producing angular velocity.
- **Rate and timing** (protocol Appendix A): default 66 Hz (`hz`), timestamps in microseconds advancing about 15000 per report with +-3 ms jitter (seeded), occasional two-packet bursts (arrival time equal, timestamps 15 ms apart), `counter` as a millisecond clock. Everything seeded (`sim.seed`, default 1) so runs are reproducible.
- **Noise and limits**: gyro bias uniform within +-1.5 dps per axis (constant per run), white noise sigma 0.15 dps, accel noise sigma 0.004 g, then quantised to int16 by `buildInputReport` (gyro raw = dps / trueScale; `gyroScaleTrue:'alt'` uses 0.0075 dps per LSB so that the parser's default scale makes the signal 8.138 times too large, exercising the calibration estimate), clipped at int16 like the real field. Lever-arm acceleration `a = alpha x r + omega x (omega x r)` along the sword axis is added to the accelerometer so the fusion is tested with contaminated gravity.
- **Data path**: sample model -> `buildInputReport` -> bytes -> `report-stream` (same code as BLE) -> `sample`. `packet` events fire as for BLE.
- **`tick(now)`** emits every report due up to `now` (deterministic). With the real clock the provider also self-schedules with a 4 ms interval so that samples do not wait for a frame; calls must be idempotent.
- **Mount presets** (normative table; Motion's tests use the same values). Each row is `right`, `forward`, `up` in device coordinates:

| preset | right | forward | up |
|---|---|---|---|
| `faceUp` (default) | (1, 0, 0) | (0, 1, 0) | (0, 0, 1) |
| `faceSide` | (0, 0, -1) | (0, 1, 0) | (1, 0, 0) |
| `upsideDown` | (-1, 0, 0) | (0, 1, 0) | (0, 0, -1) |
| `tipFlipped` | (-1, 0, 0) | (0, -1, 0) | (0, 0, 1) |
| `tilted` | (1, 0, 0) | (0, 0.866025, 0.5) | (0, -0.5, 0.866025) |
| `sideRail` | (0, -1, 0) | (1, 0, 0) | (0, 0, 1) |

  All six satisfy `right x forward = up`. `SIM_MOUNTS` exports them.
- **`nominalCalibration`**: a valid `Calibration` (`validateCalibration` passes) with the mount frame, the sim's true `gyroBiasDps`, `gyroSign` (-1 if `mirrorGyro`), `gyroScale` = true/default ratio (1 or 0.12288), `gyroScaleSource:'stored'`. `main.js` applies it to Motion when the provider is `sim` (unless `?simcal=1`).
- **Extras on the sim provider** (used by the Integrator's debug API):

| Method | Semantics |
|---|---|
| `setTarget(x, y, opts?: {teleport?: boolean})` | virtual mouse position, playfield px |
| `setPose(pose, opts?)`, `clearPose()` | `pose` = `'tipUp'` (sword forward = world up), `'pointScreen'` (neutral aim), `'flat'` or `{yawDeg, pitchDeg, rollDeg?}`; overrides the mouse until `clearPose()`; orientation changes are smooth over `opts.transitionMs` (default 0) |
| `playCalibrationScript(): Promise<void>` | on the provider clock: still `tipUp` 2.6 s, rotate to `pointScreen` over 1.2 s, still 2.2 s, hold 3.2 s at centre. Drives the real calibration wizard without human input (`?simcal=1`) |
| `simulateLoss()`, `simulateRecovery()` | `state -> lost` with `lost_signal`; afterwards `reconnect()` succeeds (allows the disconnect-overlay e2e) |
| `getTruth()` | `{frame, gyroBiasDps, gyroSign, gyroScaleTrue, side}` for tests |

- Pointer events on `opts.target`: `pointermove` (with coalesced events) updates the target; right/middle/double click produce actions (5.7); `pointerleave` sets `trackingOk:false`.

### 5.9 Mouse provider

`AimSample` per pointer event, including `getCoalescedEvents()`; `t = clock.now()` (real clock: `event.timeStamp` if it is on the `performance.now` timebase, else `clock.now()`); coordinates through `toPlayfield`, clamped to the playfield; first sample after the pointer enters the canvas, after `blur`, or after 200 ms of silence has `discontinuity:true`. Emits actions per 5.7. `trackingOk` false while the pointer is outside the canvas. Suppress the context menu on right click over the canvas.

### 5.10 Diagnostics page (`public/diagnostics.html` + `js/input/diagnostics-page.js`)

A standalone page (no game code, no Motion import) that lets the owner verify the real Joy-Con in 2 minutes and records what the two research documents could not. It uses `createInputProvider(kind)`, the `packet`/`sample`/`status`/`bridge`/`log` events, and its own maths. **Three modes**, chosen by `?input=` and by a selector at the top of the page: `native` ("Native bridge (recommended)", the default), `joycon` ("Real Joy-Con (Chrome's Bluetooth)") and `sim` (the simulator; this is how the page is tested without a Joy-Con). The native mode shows everything below plus a block for the bridge (its status from `GET /__bridge/status`, the phase and helper state, the adverts seen with RSSI and pairing flag, dropped notifications, the last bridge code), the option "Joy-Con choice" (`pairingOnly`), three more checklist steps (ids 10 to 12, UOH-21 to UOH-28) and the 60-second keep-alive experiment (UOH-5, UOH-25). Labels in English, technical terms and units as in the protocol document. Required content (protocol Appendix B and section 12):

1. **Connection panel**: Connect button (user gesture), side selector `L`/`R`/any, filter selector (lenient, the default and recommended / strict, labelled "stricter" / all), feature-mask selector (0xB7 default/0xFF/0x37), a link to the game with the chosen filter, mask, side and accelerometer sign (`?filter`, `?mask`, `?side`, `?accelsign`), a rest check with the buttons up that reads the accelerometer sign (raw Z), state and error code, cooldown countdown, timings (connect, discovery, first report), `featureMask` in use and which watchdog stage fired, keep-alive on/off (expert), "Disconnect".
2. **Live raw**: hex of the last packet, length, counter, IMU timestamp, all raw integers and converted units (accel g and `|a|`, gyro dps and `|omega|`, temperature C, battery mV with the three-band colour and the label "approximate"), `imuActive`, pressed buttons, side.
3. **Rates**: packets per second over 1 s and 10 s; inter-arrival min/median/p95/max histogram; IMU `dt` from device timestamps vs from arrivals and their ratio; dropped/burst count. This answers UOH-4.
4. **Tools**: (a) **one-revolution scale check**: "Start", rotate the sword one full turn flat on the desk, "Stop"; shows the integrated angle; about 360 degrees confirms the default scale, about 2930 degrees means 0.0075 dps/LSB; a "Save scale" button writes `{gyroScale, measuredAt}` to localStorage key `joyconNinja.imu.v1` (try/catch, in-memory fallback shown as a warning); (b) **gravity vs gyro sign test**: two still holds and a slow turn between them, shows `cos` between the accel-implied and gyro-implied rotation axes and the verdict "gyro sign OK / mirrored" (protocol 7.4 point 2); (c) **rest check**: hold still 3 s, shows `|a|`, gyro mean/stddev.
5. **Latency probe**: shows the age of the newest sample at each `requestAnimationFrame` (`now - sample.t`) as min/avg/max. This is the software part only (UOH-18).
6. **Expert**: vibration test buttons (presets 1, 3, 5, 6, UOH-13), report descriptor write experiment is NOT included (off by default in protocol UOH-9; not implemented).
7. **Owner checklist**: the 7 steps of protocol section 12 as ticks with pass/fail fields and a "Copy report" button that puts a JSON report on the clipboard (state timings, rates, scale result, which UOH items were confirmed). Every hardware-dependent statement on the page carries the text UNVERIFIED-ON-HARDWARE until the owner ticks it.

### 5.11 The native Bluetooth bridge (decision of 2026-09-30, which reversed the first decision not to build it)

**Decision: built.** The first decision (2026-09-29) was not to build a native bridge, on the strength of the protocol verdict that Web Bluetooth can do the whole flow (confidence M, UNVERIFIED-ON-HARDWARE) and because a bridge adds a second path nobody can test on hardware. On 2026-09-30 the owner's first real test showed Chrome's chooser listing **no device at all** on his Mac (even with `acceptAllDevices`), while a native CoreBluetooth probe connected in 0.6 s, initialised the controller and streamed 63-byte reports at about 33 Hz (`docs/hardware-findings.md`). Trigger 1 of the old list had happened, so the bridge was built; it is the recommended path, Web Bluetooth stays as the second one.

What exists (all described in `docs/native-bridge.md`): `bridge/joycon-bridge.m` (Objective-C, compiled by `bridge/build.sh` with `clang`: Swift is unusable on this Mac because of a stale module map), `bridge/manager.js` (spawns the helper lazily, fans its JSON lines out), the `/__bridge/` endpoints of `server.js` (9.5), `native-link.js` and `native-provider.js` (5.1) feeding the **same** `report-stream.js`, the connect screen (8.3) and the native mode of the diagnostics page (5.10). Zero npm dependencies; the helper is the only native code; it never connects without a `connect` command and never retries by itself.

**Security** (docs/native-bridge.md 5): any web page in the owner's browser can reach `http://localhost`, and the bridge can connect a Bluetooth device, so every `/__bridge/` request needs the server's own `Origin`, a `Sec-Fetch-Site` of same-origin or none and, for POST, the custom header `X-Joycon-Ninja: 1`; the server never answers a CORS preflight; bodies are validated field by field and reach the helper as JSON over a pipe (no shell).

**macOS permission**: Bluetooth permission goes to the *responsible process*, Terminal when the game is started from `start.command`; a server started from an app without a Bluetooth usage description is stopped by macOS at the first Bluetooth use (exit code 134, mapped to `bluetooth_permission`, whose player-facing text says to restart with `start.command`). UNVERIFIED-ON-HARDWARE (UOH-21, UOH-22).

**What is not proved**: the real helper has never been run against Bluetooth by the builders. Thirteen items (UOH-21 to UOH-33, `docs/native-bridge.md` 11) stay open; the browser tests use a fake helper that models the protocol document and the probe's captures, not the device.

**The old triggers remain useful** as the list of ways the Web Bluetooth path can fail (chooser never lists the controller; discovery times out; the link drops within 20 s with keep-alive; rate below 20 Hz; `startNotifications` fails), and the diagnostics page still measures all of them.

### 5.12 Input tests (`test/input/`, all `node --test`)

- **Parser**: every vector in `docs/joycon2-test-vectors.json` (V1, V2 real; V3 synthetic) field by field (exact for binary fractions, 1e-4 for temperature), `timestampDeltaChecks`, length < 60 rejected, unknown button bits masked (V3), sanity facts (`|a|` within 1% of 1 g for V1/V2).
- **Builder round trip**: 20 000 random reports `buildInputReport` -> `parseInputReport` lossless (protocol Appendix A).
- **Report stream**: u32 wrap dt (`4294965296 -> 2000` = 4000 us), gap handling (`dtMs:null`), ratio fallback to arrival times, `t` non-decreasing and never after `arrivedAt`, burst handling, `imuActive:false` yields no sample, side resolution.
- **State machine** with the fake Bluetooth: every row of 5.3, cooldown (10 s, then 180 s after 3 failures), `cancelled` has no cooldown, auto-retry once, `connect()` idempotency, in-flight promise sharing, writes only to the command characteristic (fake records every write), serialisation (never two overlapping operations), keep-alive cadence, watchdog stages, `pagehide` disconnect, unsupported browser.
- **Actions**: mapping table 5.7 for both sides, rising edge only, no auto-repeat, labels.
- **Simulator**: through the real parser; rate and jitter statistics within tolerance; `nominalCalibration` passes `validateCalibration`; determinism (same seed, same bytes); accel at rest equals `frame.up` for all six mounts; steady mouse motion at v px/s yields a pipeline-independent angular rate `v / 27.4` deg/s within 5%; saturation clipping; `simulateLoss/Recovery`.
- **Mouse**: coalesced events, discontinuity rules, clamping, `toPlayfield`.
- **Contract**: every emitted `ImuSample`, `AimSample`, `ActionEvent`, `InputStatus` passes `assertValid`.
- **Diagnostics page**: pure functions (histogram, scale integrator, sign test) unit-tested; the page itself is covered by the Integrator's e2e with `?input=sim`.

---

## 6. Motion contract (owner: Motion engineer)

### 6.1 Responsibilities and files

Motion turns `ImuSample`s (or `AimSample`s) into `BladeSample`s and `BladeSegment`s, runs the mount calibration, the drift management and the cut-state tracker. Pure module (rule 5): no DOM, no timers, no `Date.now` except `Calibration.createdAt`. Synchronous: `pushImu` returns after emitting the `blade` event.

```
public/js/motion/
  index.js            createMotionPipeline, MOTION_CONFIG
  motion-config.js    MOTION_CONFIG (6.8)
  vec.js quat.js      tiny vector/quaternion helpers
  fusion.js           orientation filter (gyro integration + gravity correction), online gyro bias
  calibration.js      the wizard state machine and the maths of 6.4
  aim.js              orientation -> yaw/pitch -> px, references, recentering, edge slip (the absolute model: simulator)
  blade-tracker.js    px/s speed, hysteresis, swing ids, segment merging, safety cap (aim path and absolute model)
  pointer.js          the relative model: tip velocity, dead zone and acceleration curve, idle soft auto-centre, chords, trail, head extrapolation
  angular-tracker.js  the cut decision of the relative model in deg/s: hysteresis, 25 ms minimum duration, retroactive first chord
  pipeline.js         wiring, events, MotionState
```

API: `MotionPipeline` in section 11 (typedef). `createMotionPipeline(opts?: {clock?: Clock, config?: DeepPartial<MOTION_CONFIG>, settings?: Partial<MotionSettings>, gyroScaleOverride?: number|null})`. `pointerModel?: 'relative'|'absolute'` (default `'relative'`; `setPointerModel` changes it). Default settings: sensitivity 1 (0.3 to 2.0), cutThreshold 300 (deg/s of tip speed, 100 to 700 step 25), cutMul 1, autoCenter true, flipX false.

### 6.2 Behavioural contract of the pipeline

- **Uncalibrated + IMU**: `pushImu` feeds calibration (if running) and the filter, but emits **no** `blade` events (`getState().calibrated === false`, `trackingOk === false`). With a calibration (from `setCalibration` or the wizard) it emits one `BladeSample` per `ImuSample`.
- **`pushAim`** bypasses orientation and calibration: position = the aim point, angular speed `null`, `source:'aim'`. Works in any state, also uncalibrated. The mouse provider and the debug swing use it. Only the safety cap differs (fixed 60 000 px/s, `MOTION_CONFIG.cut.safetyCapMousePxPerS`).
- **Discontinuities**: the next sample has `discontinuity:true` after `markDiscontinuity()` (reason `'lost'`, and any hole in the stream longer than `orientationResetGapMs` = 1 s, also restart the orientation filter from gravity and re-reference the cursor on the first new sample, round 1 finding M1), after a gap of `dtMs === null` or > 200 ms, after a recenter ease (6.6) and for the first sample of a swing injected by the debug API. A discontinuity clears the 50 ms speed window, sets `cutting:false`, `segmentValid:false` and (because of the 100 ms grace rule) the next entry gets a **new** `swingId`.
- **`poll(nowMs)`**: if `nowMs - lastSampleT > MOTION_CONFIG.trackingLostMs` (200) emit **one** synthetic `BladeSample` at the last position with `trackingOk:false`, `cutting:false`, `speed:0`, `segmentValid:false` and leave the cutting state; the first real sample afterwards has `discontinuity:true`. `poll` also flushes nothing else: segments are produced synchronously by `push*`.
- **`drainSegments()`** returns the segments since the last call as `BladeSegment` (`{t0,x0,y0,t1,x1,y1,speed,swingId}`), oldest first, and clears the queue. Absolute model and aim path: one per `BladeSample` with `segmentValid`. **Relative model: several contiguous chords of at most about 48 px per IMU sample while cutting** (the path between two 33 Hz samples is a quadratic, cut into chords, so a fast swing cannot tunnel through a fruit; the longest chord measured on the real recording is 61 px), `segment.speed` in the px/s-equivalent scale. The queue is bounded (1024); when full the oldest are dropped (never happens at normal frame rates).
- **`recent(windowMs)`**: samples with `t >= latest.t - windowMs` (relative to the newest sample), oldest first, from a ring of 384. In the relative model the ring also holds `interpolated: true` samples every 8 ms between two real ones (the `blade` event is still emitted once per real sample), so a trail drawn at 60 fps is smooth from 33 Hz data. `headAt(nowMs)`: relative model: the newest position extrapolated up to 35 ms with the last acceleration and never reversing; absolute model and aim path: `angular velocity x min(nowMs - lastSampleT, 15 ms)`; only while `trackingOk`, clamped to the playfield; `null` if no sample yet. Used to draw the blade head only, never for collision.
- **Units (D6)**: `BladeSample.speed`, `BladeSegment.speed` and `BladeView.cutThreshold` keep the old px/s scale, as **px/s-equivalent = tip speed in deg/s x 10/3** (300 deg/s = 1000 px/s), so nothing in `game/`, `render/` and `audio/` changed; `BladeSample.speedDps` and `MotionState.speedDps` / `cutThresholdDps` carry the real unit (deg/s) for the settings meter, the tuning page and calibration step 4.
- **Latency rule**: no smoothing may add more than 8 ms of lag at cutting speed. A speed-adaptive filter (1-euro shape: strong at rest, none at speed) is allowed on the aim point; the raw geometry feeds collision only through the `BladeSegment`s emitted, which use the filtered path consistently with what is drawn.
- **Settings** take effect on the next sample; changing `cutMul`/`cutThreshold` mid-swing re-evaluates the state machine on the next sample without resetting `swingId`.
- **`reset()`** clears filter, tracker, history, references (a new filter start; the calibration stays).

### 6.3 Blade tracker rules (NORMATIVE, design 5.1 and 5.2)

**Relative model (IMU samples of a real Joy-Con): the cut decision is made in ANGULAR tip speed (deg/s), independent of the sensitivity** (`docs/motion-contract.md` 2.4). `T = cutThreshold * cutMul` deg/s (Normal 300, Easy 225, Hard 450, Zen x 0.8 = 240); enter when two samples at or above `T` are at least 25 ms apart with none below `0.65 T` in between (a dip that stays above `0.65 T` keeps the candidate for up to 100 ms; one stray sample never cuts); leave below `0.65 T`; a re-entry within 100 ms keeps the `swingId`; the first chord is delivered retroactively with the ENTER sample (the cut starts one 33 Hz sample after the first fast one, but the delivered path starts at the sample before it: measured on the recording, 90 to 95 % of a stroke's path is inside segments); a sample above 2190 deg/s (`|w|`) is ignored and raises `gyro_saturated`. The rules below (1 to 5) are the **px tracker** and describe the aim path (mouse, `ninja.swing`) and the absolute model (simulator): there `T_px = cutThreshold * cutMul * 10/3`, so the default 300 deg/s is the old 1000 px/s.

Per input sample at position `P` (px, clamped) and time `t` (px tracker):

1. **Speed** = length of the polyline through all retained samples with `time >= t - 50 ms` (at least the last two samples) divided by the time span. Unit px/s.
2. **Safety cap**: a sample whose step from the previous one implies more than `2190 deg/s * ppd` px/s (IMU path; `ppd = 27.4 * sensitivity`) or 60 000 px/s (aim path) is a glitch: it updates the cursor position but is excluded from the speed window and from segments, and a `gyro_saturated` warning is raised at most once per second (UNVERIFIED-ON-HARDWARE, HW-10).
3. **Cutting state**: `T = cutThreshold * cutMul`. Enter when `speed >= T`; leave when `speed < 0.65 * T`. Re-entry within 100 ms of leaving keeps the same `swingId`, otherwise `swingId += 1`.
4. **Segments**: while not cutting, the anchor `(x0,y0,t0)` follows every sample. While cutting: if `|P - anchor| >= 6 px` the sample is a valid segment (`anchor -> P`) and the anchor moves to `P`; else if `t - anchor.t >= 8 ms` the accumulated movement is rest jitter (not valid) and the anchor moves to `P`; else the movement accumulates (not valid, anchor kept). The segment ending at the sample where CUTTING is entered is eligible (anchor = previous sample).
5. **Every** input sample yields a `BladeSample` (cursor freshness, trail); only `segmentValid` ones become segments. Invariants: `segmentValid => cutting && !discontinuity`.

### 6.4 Frames and calibration (mount-agnostic; Left and Right)

Nothing assumes how the Joy-Con sits on the sword (constraint 3). Calibration discovers the mount, the gyro sign and, when possible, the gyro scale. Conventions are in section 3.3. The four player-visible steps and their pass rules come from design 12.5; Motion owns steps 1 to 3, the game owns step 4 (practice round, A-16).

**Events** (`CalibrationEvent`, section 11): `started`, `progress` (about 10 per second per step, `progress` 0..1), `stepPassed`, `stepFailed` (with `reason`), `done` (with `Calibration` and `warnings`), `cancelled`. `startCalibration()` while running restarts; `cancelCalibration()` emits `cancelled`. `confirmCenter()` is only meaningful in step 3.

**Step rules** (constants in `MOTION_CONFIG.calibration`, design HW-7 starting values, UNVERIFIED-ON-HARDWARE):

| Step | Player action | Pass rule | Captures |
|---|---|---|---|
| 1 | sword still, tip up | 2.0 s continuous: mean angular speed < 6 deg/s, no sample > 15 deg/s, `|a|` steady (within 5 % of the hold's own running mean) and the hold's mean `|a|` between 0.85 and 1.15 g (round 2 finding M2: the resting magnitude is learned, not assumed to be exactly 1 g) | `u1` = mean accel direction (unit), gyro bias `b` = mean gyro, `g0` = mean `|a|` |
| transition | move to pointing at the screen | no requirement; integrate the gyro (bias removed, sign +1, scale 1) into `theta_gyro` (vector, device frame) from the end of step 1 to the start of step 2. A sample without a usable time step is integrated over its wall-clock distance to the previous sample when that is 40 ms or less, costs nothing when it is 0 (duplicate or backwards stamp), and is charged to a "lost time" budget only when it follows a real hole (round 2 finding M1). More than 300 ms of lost time: sign and scale are not estimated (`gyro sign undetermined`) | `theta_gyro` |
| 2 | sword still, pointing at the screen | 1.5 s stillness (same rule) and the angle between `u1` and `u2` in 65..115 deg, else `stepFailed('bad_pose')` and back to step 1 | `u2` = mean accel direction |
| 3 | point at the screen centre, press recenter/confirm or hold still 3.0 s | `confirmCenter()` or 3.0 s stillness | yaw/pitch references |

Any violation of a stillness rule resets the hold (`stepFailed('moved')` at most once per second, the ring restarts). Steps time out after 60 s of waiting (`timeout`). No IMU data for 1 s during a step: `no_data`. Steps 2 and 3 use the same steadiness rule for `|a|` (band 0.80 to 1.20 g per sample, steady within 5 % of the hold's mean): they do not compare against `g0`, because a real sensor can have different gains per axis and `|a|` then differs between the poses. A step 1 hold whose mean `|a|` is outside 0.85 to 1.15 g is refused as `bad_accel` (announced after the hold, or after 1 s of refused samples when the reading sits on the edge of the band).

**Accelerometer normalisation (round 2 finding M2).** `Calibration.accelG0` (additive) is `g0`, the mean resting `|a|` of step 1. `pushImu` divides every accelerometer reading by `params.g0` (after `accelSign`, after the wizard has seen the raw reading), so the gravity trust bands (`fusion.flatBandG`, `trustBandG`) and the online bias estimator (`gyroBias.restBandG`) keep working for a sensor that reads 1.06 g or 0.94 g. `g0` outside 0.95 to 1.05 raises the warning `accel_gain_off` (also in `quality.warnings`). The real gain and offset are UNVERIFIED-ON-HARDWARE (UOH-3).

**Computation (reference algorithm; you may replace it if the acceptance tests of 6.10 pass):**

```
forward = normalize(u1 - dot(u1,u2) * u2)      // tip direction in device coords: the projection of u1 on the plane perpendicular to u2
up      = normalize(u2 - dot(u2,forward) * forward)   // = u2 up to noise, made exactly orthogonal
right   = cross(forward, up)                    // right-handed: cross(right, forward) = up
frame   = { right, forward, up }
```

Reasoning: with the tip up, the accelerometer points along the blade (`forward = u1`); pointing horizontally, gravity is perpendicular to the blade (`dot(forward,u2) = 0`), so `forward` is `u1` corrected to be perpendicular to `u2`, and `up = u2`.

**Gyro sign self-test** (protocol 7.4 point 2): the device rotated between the two still holds by the vector `theta_exp = -angle(u1,u2) * normalize(cross(u1, u2))` (the body turns opposite to how its gravity vector turns, in device coordinates). If `cos(theta_gyro, theta_exp) < -0.5` set `gyroSign = -1` and raise `gyro_sign_flipped`; if `> 0.5` set `+1`; otherwise keep `+1` and add the warning `gyro sign undetermined` to `quality.warnings`.

**Gyro scale estimate** (A-13): if after the sign correction `cos >= 0.9` and `angle(u1,u2) >= 45 deg`, `ratio = angle(u1,u2) / |projection of theta_gyro on the expected axis|` (in degrees). Snap to a known candidate (1 or 0.12288) when within 12%; otherwise keep the raw ratio if it lies in 0.05..2 and add `gyro_scale_suspect`. If a `gyroScaleOverride` was given (diagnostics tool) it wins and `gyroScaleSource` is `'stored'`. Else if the estimate is accepted `'estimated'`, else `1` and `'default'`. A scale far from 1 is a **warning**, never a failure.

**Yaw sign** cannot be validated by gravity (protocol 7.4 point 3); the UI offers `flipX` (A-17).

`beginQuickRecenter()`: step 3 only, hold still 1.5 s (`calibration.holdS.quickCentre`) or `confirmCenter()`; frame unchanged; events use `quick:true` on `started` and `done`; without a calibration it emits `stepFailed` with `no_calibration`.

### 6.5 Orientation filter and mapping

Reference algorithm (private, replaceable): quaternion `q` (device to world) initialised from the accelerometer (yaw 0). Per sample with `dtMs`:

```
omega_D = (gyro - bias) * gyroSign * gyroScale * (pi/180)                       // rad/s, device frame
omega_c = (1/tau) * cross(u_m, u_p)   if accel is trusted, else 0                // Mahony proportional term
q       = normalize(q * exp((omega_D + omega_c) * dt / 2))
aim_W   = rotate(q, frame.forward)
```

where `u_m = normalize(accel)` (measured up in device coordinates) and `u_p = rotate(conj(q), (0,0,1))` (predicted up). The sign of `omega_c` was derived so that `u_p` converges to `u_m`; a unit test must show convergence from a wrong initial pitch (`|error| < 1 deg` after 5 tau).

- **Accel trust**: only when `abs(|a| - 1) <= fusion.trustBandG` (0.15), the blade is not cutting and has not been for `fusion.cutQuietMs` (200 ms), and angular speed <= `fusion.maxTrustDps`. During swings the pipeline relies on the gyro alone (linear acceleration from the swing contaminates gravity).
- **Yaw** is never corrected by the accelerometer (no magnetometer use, hard iron near a sword, protocol 5.3). It drifts; section 6.6 manages it.
- **Online bias**: while the sword is at rest (`abs(|a|-1) <= 0.03` and gyro spread <= 2.4 dps over a 1.0 s window) nudge `bias` towards the window mean (weight 0.25 per window). Re-estimated whenever still.
- **Mapping** as section 3.3: in the absolute model `ppd = 27.4 * sensitivity`; in the relative model the orientation filter is not needed for pointing (it still runs for `getDebug().q` and the bias estimator's rest detection), the pointer uses only the calibrated frame and the gyro.
- `dtMs > 100` is integrated in slices of <= 20 ms with the last gyro value and raises `sample_gap`; `dtMs === null` skips integration for that sample.
- `MotionState.yawDeg/pitchDeg` are relative to the current references in the absolute model and `null` in the relative model (there are no absolute angles).

### 6.6 Recentering (design 8.3, all constants in `MOTION_CONFIG.input`)

The table describes the **absolute model** (the simulator); the relative model of a real Joy-Con is described under the table.

| Mechanism | Behaviour |
|---|---|
| `recenter('manual')` | Sets `yawRef`/`pitchRef` to the current aim so that it maps to (960, 540). For `recenterEaseMs` (150 ms) the emitted samples ease from the old cursor position to the centre and carry `discontinuity:true` (no cutting). Emits `recenter`. Allowed at any time, also during play. |
| Auto soft centring (`autoCenter`) | When angular speed < 8 deg/s for 1.0 s and no cutting for the last 500 ms, slew the references so that the cursor moves towards the centre at 3 deg/s (82 px/s at default sensitivity); stop at the centre or when angular speed exceeds 12 deg/s. Never while cutting. Emits `recenter` with `kind:'auto'` when it arrives at the centre. |
| Edge slip | If the unclamped aim is beyond the playfield by more than 8 deg for more than 0.5 s, drag the references at 20 deg/s (`kind:'edge'` when it starts). |
| Who moved the cursor (`MotionState.refDriven`, round 2 finding R2-01) | `true` on a sample whose cursor position is being carried by the references and not by the sword: the soft-centring slew while the cursor is still travelling to the centre (not once it arrived and the references only follow the aim), the edge slip, the recentre ease, and the sample that applies a re-reference (end of the wizard, `recenter` before the first sample, the restart after a hole in the stream). The app copies it to `BladeView.refDriven`; the menu dwell never arms while it is true (design 12.6). The simulator's `reanchor` (the virtual mouse jumped) is not reference motion: the cursor lands where the player put the mouse. |
| Reconnect | `recenter('reconnect')` after a reconnect (the UI then runs `beginQuickRecenter`). |
| Calibration | Step 3 completion sets the references (`kind:'calibration'`). |

**Relative model (every real Joy-Con)**: there are no references, no edge slip and no drift to manage (the real recording: a hand that tries to hold still moves the cursor 0.0 px; a 30 + 20 degree change of posture moves it 133 px). `recenter('manual'|'reconnect')` puts the cursor at the centre and eases the emitted samples over 150 ms (discontinuity, no cutting). The idle soft auto-centre (`autoCenter`): after 1.0 s below 8 deg/s of tip speed and 500 ms without cutting the cursor glides to the centre at 120 to 800 px/s (2.5 per second of the distance, ramped in over 300 ms); it stops at once above 14 deg/s and never runs while cutting; `refDriven` is true on every sample the glide moved; `recenter` with `kind:'auto'` fires on arrival after a glide of at least 40 px. `markDiscontinuity('lost')` and a hole in the stream do not move the cursor. The end of the calibration puts the cursor at the centre. The app ignores a recenter press (`app.js`, `RECENTER_BLOCK_DPS` 100, `RECENTER_HOLDOFF_MS` 250) while the blade is cutting or moves at 100 deg/s or more, and for 250 ms afterwards: the owner's recording has a shoulder-button press in the middle of a 1009 deg/s stroke, and a recenter there breaks the cut.

All values are starting values, UNVERIFIED-ON-HARDWARE (HW-3).

### 6.7 Warnings

`warning` events (`MotionWarning`, at most once per second per code): `gyro_scale_suspect`, `gyro_sign_flipped`, `dt_fallback` (when samples say `dtSource:'arrival'`), `sample_gap`, `accel_saturated`, `gyro_saturated`, `low_sample_rate` (measured rate < 20 Hz for 2 s: protocol trigger 4 for plan B), `accel_gain_off` (the resting `|a|` learned by the wizard is outside 0.95 to 1.05 g). The UI shows nothing for most of them; the diagnostics page and `?debug=1` overlay list them. The one calibration warning the player does see is `gyro sign undetermined` in `done.warnings`: the practice screen then shows the notice `cal.signUnknown` and offers the retry button at once (round 2 finding M1).

### 6.8 `MOTION_CONFIG` (data, deep-frozen)

The design's `input`, `cut`, `calibration` blocks (Appendix A) verbatim, plus:

```js
fusion:   { tauS: 1.5, trustBandG: 0.15, maxTrustDps: 300, cutQuietMs: 200 },
gyroBias: { restBandG: 0.03, restSpreadDps: 2.4, windowS: 1.0, blend: 0.25 },
tracker:  { historySize: 384, segmentQueueMax: 1024 },       // was 128 / 512 (interpolated samples, chords)
trackingLostMs: 200, maxGapMs: 200, extrapolateMaxMs: 15,    // absolute model and aim path; the relative model uses pointer.extrapolateMaxMs 35
input:    { sensitivityDefault: 1.0, sensitivityRange: [0.3, 2.0, 0.1] },   // (absolute model unchanged otherwise)
pointer:  { deadDps: 5, rampDps: 300, gLoPxDeg: 5, gHiPxDeg: 14, idleDps: 8, idleBreakDps: 14, idleHoldS: 1.0, quietMs: 500,
            centreGain: 2.5, centreMinPxS: 120, centreMaxPxS: 800, centreRampMs: 300, maxChordPx: 48, maxSubSteps: 32, trailStepMs: 8, extrapolateMaxMs: 35 },
cut:      { thresholdDefault: 300, thresholdRange: [100, 700, 25], releaseRatio: 0.65, minDurationMs: 25, candidateMaxMs: 100, swingGraceMs: 100,
            aimPxPerDps: 10 / 3, safetyCapDegPerS: 2190, /* plus the px tracker's constants, unchanged */ },
calibration: { ...design block, holdS: { pose1: 2.0, pose2: 1.5, autoCentreS: 3.0, quickCentre: 1.5 },
               waitTimeoutS: 60, scaleAcceptCos: 0.9, scaleMinAngleDeg: 45, scaleSnapTolerance: 0.12, scaleCandidates: [1, 0.12288],
               signAcceptCos: 0.5, progressHz: 10 },
cut:      { ...design block (px tracker part), safetyCapMousePxPerS: 60000 },   // zenMul removed (A-02)
```

### 6.9 What Motion does NOT do

No rendering, no audio, no game rules, no menu selection (the UI does dwell/cut hit-testing on the samples it receives), no BLE, no storage. It never reads `Settings` from storage: `main.js` passes `MotionSettings`.

### 6.10 Motion tests (`test/motion/`)

Helper `test-support/motion/synth.js` (owned by Motion) generates synthetic `ImuSample` streams from a scripted orientation path for any mount frame (use the six presets of 5.8, both `side` values, optional `mirror`, gyro bias/noise, jitter, rate 33/66/250 Hz, optional `gyroScaleTrue:'alt'`). It must not import `input/`.

- **Calibration acceptance (per mount x side x rate)**: the wizard run on synthetic data recovers `frame.forward` within 3 deg and `frame.up` within 3 deg of the truth; `gyroSign` correct when the synthetic gyro is mirrored; `gyroScale` within 5% of the truth for both candidate scales (estimate accepted) or the corresponding warning; failing cases produce the documented `stepFailed` reasons (moving during a hold -> `moved`, poses 30 deg apart -> `bad_pose`, no data -> `no_data`).
- **Mapping**: after calibration and `confirmCenter()`, rotating the sword by +10 deg yaw right gives `x = 960 + 274 +- 15`, +5 deg pitch up gives `y = 540 - 137 +- 15`, roll about the blade changes nothing (+-2 px), `flipX` mirrors x, sensitivity 2.0 doubles the excursion. Holds for all mounts.
- **Fusion**: convergence from a wrong initial pitch; pitch stays within 2 deg of truth during a scripted 5-second sequence with lever-arm acceleration; no accel correction while cutting; yaw drift bounded by bias only; online bias estimation reduces a +1.5 dps bias below 0.3 dps within 10 s at rest.
- **Tracker (design 16.5 items 3 and 4)**: threshold and hysteresis with exact numbers (900 px/s does not cut at T=1000, 1100 does, a dip to 700 px/s for 50 ms keeps the swing, below 650 ends it, re-entry within 100 ms keeps `swingId`, later starts a new one), Zen multiplier via `cutMul`, merging (jitter below 6 px never becomes a segment; a 1800 px jump in one sample becomes one segment), safety cap, discontinuity rules, `segmentValid` invariants.
- **Pipeline**: `pushAim` path identical results to a synthetic pure-position stream; `poll` tracking loss; `headAt` clamps and never extrapolates more than 15 ms; `recent()` ordering; `drainSegments` drains once; events emitted synchronously; auto-centre and edge-slip constants; recenter easing flags discontinuity.
- **Rates**: 33, 66 and 250 Hz all pass the mapping and threshold tests (a 3000 px/s swing at 33 Hz produces about 90 px chords and must still register as one swing).
- **Relative model (sword tuning round)**: `pointer-curve`, `angular-tracker`, `relative-path`, `relative-pointer` and `real-replay` (`docs/motion-contract.md` section 5: the first REAL recording replayed through the pipeline, acceptance metrics A1 to A9); the legacy tests above build their pipelines with `createAbsolutePipeline` (`test-support/motion/harness.js`). The integrated version of the same metrics (recorded reports through the BLE provider, the parser, `app.js`, the game and the UI) is `test/app/real-replay-app.test.js`, and the same recording played into a real browser is `test/e2e/real-replay.test.js` (`test-support/e2e/replay-browser.mjs`, fake helper command `replay`).
- **Contract**: every emitted `BladeSample`, `BladeSegment`, `Calibration` passes `assertValid`.

---

## 7. Game contract (owner: Gameplay engineer)

### 7.1 Responsibilities and files

All gameplay rules of `docs/game-design.md` sections 2 to 7 and 9.3 (slow-motion rules; visual juice is the Presentation's), as **pure logic** with zero DOM access. The Game never reads a clock, never uses `Math.random`, never sees pixels of input beyond `BladeSegment`s.

```
public/js/game/
  index.js            createGame(mode, seed, options), rankFor(mode, score), CONFIG
  config.js           CONFIG (design Appendix A minus input/cut/calibration/connect, plus modes.*.cutMul, ending, practice)
  game.js             the Game object, tick loop, phases
  spawn.js            wave generation (formations, apex-first launch maths), extras, caps
  physics.js          fruit/half integration, cull
  slicing.js          swept segment vs circle, order along the segment, halves creation
  combo.js            combo groups, bonus formula
  rules.js            scoring, lives, mercy window, regen, arcade clock, bombs, power-ups, near miss, slow-mo scale stack
  modes.js            classic / arcade / zen / practice specifics, ending timeline
  ranks.js            rankFor
```

### 7.2 API

```js
createGame(mode: 'classic'|'arcade'|'zen'|'practice', seed: number, options?: GameOptions): Game
Game.update(frameDtS: number, segments: BladeSegment[], nowMs: number): void
Game.snapshot(): GameSnapshot            // plain JSON, does not mutate
Game.drainEvents(): GameEvent[]          // each event exactly once, oldest first, [] when none
Game.getResult(): RoundResult | null     // non-null once phase === 'over'
Game.isOver(): boolean                   // phase === 'over'
Game.setOptions(patch)                   // hand, reduceMotion, lethalBombs; takes effect for future spawns / events
Game.debugSpawn(spec): number            // test hook: spawn an object with the apex-first launch maths, returns its id
Game.debugSetWavesEnabled(enabled)       // test hook: stop/resume automatic waves (timers keep running)
rankFor(mode, score): 1|2|3|4|5          // design 7.6 tables (CONFIG.ranks)
```

`update` may be called with any `frameDtS >= 0`; it clamps to `CONFIG.time.maxFrameS` (0.05). `segments` may be empty; segments are consumed exactly once (the caller drained them from Motion). Calling `update` is the **only** way time advances. Not calling it is "pause".

### 7.3 Timing model (A-06, NORMATIVE)

```
DT = CONFIG.time.dt = 1/120
update(frameDtS, segments, nowMs):
  frameDtS = clamp(frameDtS, 0, maxFrameS)
  1. processSegments(segments, nowMs)            // once per call, against the object positions of the last world step
  2. realAccum += frameDtS
     steps = 0
     while realAccum >= DT - 1e-9 and steps < CONFIG.time.maxSteps (6):
        realAccum -= DT; steps += 1
        realTick()                                 // real-time systems advance by DT
        worldAccum += DT * timeScale               // timeScale in (0, 1]  (0 only during hit-stop: worldAccum unchanged)
        if worldAccum >= DT - 1e-9: worldAccum -= DT; worldStep()   // at most one world step per real tick
  3. after the loop, if steps hit the cap, drop the remaining realAccum (spiral-of-death guard)
snapshot.alpha = min(1, (worldAccum + timeScale * realAccum) / DT)     // interpolation factor between (px,py) and (x,y)
```

- **Real-time systems** (`realTick`): round timer, power-up remaining time, wave timer, mercy window, slow-motion durations and eases, bomb telegraph countdown, ending timeline, combo/swing closing (using `nowMs` and segment stamps), `game.t`.
- **World systems** (`worldStep`, scaled): fruit, bombs, medallions, golden apple and halves integration, world age `ageS`, `tWorld`, `enter`/miss/cull detection.
- **Effective `timeScale`** = min of all active scales (never a product): Freeze 0.40, combo4 0.35 (450 ms), combo7 0.25 (800 ms), near miss 0.50 (250 ms), golden 0.40 (350 ms), game over 0.30 (700 ms), hit-stop 0 (60 ms, skipped with `reduceMotion`). Ease in 60 ms, out 150 ms (Freeze 200 ms in, 400 ms out). With `reduceMotion` the minimum scale is raised to 0.5 (design 9.12). The three "juice" slow-motions share the 3 s cooldown and near miss its 2 s cooldown (design 9.3). A `slowmo` event is emitted whenever one **starts**.
- Fruit move at most 15.8 px per world step (design 2.2), so no tunnelling from object motion.
- `game.t` counts real seconds of `update` ticks only (excludes pauses, the countdown, and everything before the first call).

### 7.4 Processing blade segments (NORMATIVE, design 5.2 to 5.4, 9.3)

For each segment in ascending `t1` (stable), only while `phase === 'running'`:

1. Test against every cuttable object (fruit, golden apple, medallions, bombs) within the cuttable region: hit if the shortest distance from the object centre to the segment is `<= hitR`, where `hitR` is the capsule radius `round(r x CONFIG.hitMul[kind]) + CONFIG.hit.bladeHalfWidth[kind]` (fruit 1.55 x r + 14, golden 1.6 x r + 14, medallions 1.5 x r + 14, bomb 0.85 x r + 0; design 5.3), so the debug overlay's hit circles are the real cut region. Objects hit by the same segment are processed in ascending projection parameter along the segment (combo order follows the swing direction). An object is hit at most once.
2. Segments are already gated by Motion's cutting state; the Game additionally ignores a segment whose `speed` is 0 or non-finite.
3. **Bomb**: hit only through a `BladeSegment` (i.e. cutting speed): `bomb` event with the mode effect (design 4.3), closes the combo group at once. Near miss (design 9.3): distance in `(54, 120]`, bomb on screen, not triggered before by that bomb, 2 s since the last near miss.
4. **Fruit and golden apple**: `cut` event, two halves (design 5.5, blade normal `n = perp(d)` from the segment, half A on +n), score, combo membership. **Medallion**: activates its power-up, shatters (no halves), not a combo member.
5. **Combo groups** (design 5.4): opens at the first fruit cut of a `swingId`; a further cut joins if the same swing is still active (a segment of that swing at `t1 >= nowMs - 100`, or the swing ended less than 100 ms ago) and `t1 - lastCut.t1 <= 250` ms; closes when `nowMs - lastCut.t1 > 250`, or 100 ms after the swing's last segment, or immediately at a bomb. `combo` events: `update` on every join (bonus 0), `close` with `bonus = 5 n (n-1)` (n capped at 10), doubled by Double. `comboIndex` in the `cut` event is 1-based within the group.
6. All timing comparisons use `t1` stamps and `nowMs` only (A-07).

### 7.5 Snapshot, events, determinism

- `snapshot()` follows `GameSnapshot` exactly (section 11). `objects` are uncut objects in spawn order (id ascending); `halves` in creation order; no object is present in both. `events` holds the last 32 events in order; `drainEvents()` returns and clears the not-yet-delivered ones. `seq` increases by one per event for the whole round.
- **RNG (design 2.8, `shared/rng.js`)**: `rngWave(k) = createRng(hash32(seed, k))` for everything about wave k (count, formation, types, apex positions, bomb/power-up/golden rolls, delays); `rngFx = createRng(seed ^ SEED_XOR.gameFx)` only for cosmetic values kept inside the game (half spin). Wave k depends only on `(seed, k, stage, active flags)`. Power-up and golden pity counters advance per wave.
- **Determinism (design 16.4)**: identical `(mode, seed, options)` and identical `update` call sequences (dt, segments, nowMs) give identical `snapshot()` JSON and identical event streams. Changing anything only rendered (particles) cannot influence the object list because the Game does not know about them.
- `hand` biases the spawn bands by +-80 px (design 14). `lethalBombs` [P2].
- Snapshots must be cheap: called once per frame, allocate arrays but reuse nothing that the caller might mutate (return fresh plain objects).

### 7.6 Modes, phases, practice

- Modes and tables exactly as design sections 3, 6, 7. `CONFIG.modes.<mode>.cutMul` is read by `main.js`.
- **Phases**: `running` -> `ending` -> `over`. Classic: last life lost -> `gameOver` event, `slowmo` gameOver, `ending`; `over` after `CONFIG.ending.classicResultsMs` (800). Arcade: timer 0 -> `timeUp` event, world freezes 300 ms, `over` after `CONFIG.ending.arcadeResultsMs` (1300). Zen: timer 0 -> `timeUp`, `over` after `CONFIG.ending.zenResultsMs` (600). Entering each phase emits `phase`. In `ending`/`over`, segments are ignored and waves stop. `getResult()` is available in `over`. Duration in `RoundResult.durationS` is game seconds at the end trigger.
- **Practice** (`mode:'practice'`, A-16): no score, lives, timer, bombs, power-ups, golden apple; one apple (fixed arc, apex (960, 400), gScale 1.0) thrown at t = 0.8 s and every 3 s afterwards while none is alive and uncut; `snapshot.practice = {cut, elapsedS}`; events `practice` (`thrown`, `cut`, `timeout` at 20 s, after which throwing continues); never ends by itself (`phase` stays `running`); `endReason` null. The UI leaves the practice round when `practice.cut` is true or on the player's request.
- Stats per design 7.4; accuracy = cut / (cut + missed), null when nothing was thrown; misses that cost nothing still count as missed.

### 7.7 Config

`CONFIG` = design Appendix A (tables in the design body win over the code block if they disagree), minus `input`, `cut`, `calibration`, `connect`, plus:

```js
modes.<mode>.cutMul: classic 1, arcade 1, zen 0.8, practice 1
ending: { classicResultsMs: 800, arcadeFreezeMs: 300, arcadeResultsMs: 1300, zenResultsMs: 600 }
practice: { apexX: 960, apexY: 400, gScale: 1.0, firstThrowS: 0.8, everyS: 3.0, timeoutS: 20 }
```

Deep-frozen. Everything numeric in the Game comes from here.

### 7.8 Game tests (`test/game/`)

All 14 invariants of design 16.5 (each is a test), plus:

- **Contract**: every `snapshot()` passes `assertValid('GameSnapshot')`, every event `assertValid('GameEvent')`, `getResult()` passes `RoundResult`; `JSON.stringify(snapshot)` round-trips.
- **Determinism**: two games, same seed, scripted segments and dt sequence -> identical snapshot and event hashes for 60 simulated seconds in every mode; a different seed differs; feeding the same frames split into different `frameDtS` chunks (1/60 vs 1/30 vs irregular) changes the outcome only through fixed-step quantisation, never through wall-clock effects (test with tolerance on positions, exact on wave contents).
- **Timing model**: `alpha` in [0,1]; slow motion halves the number of world steps per second; `t` advances at real speed during Freeze; hit-stop freezes the world but not `t`; the spiral-of-death guard (a 10 s frame runs at most 6 steps).
- **Spawn invariants** (design 16.5 item 1) over 10 000 waves per mode and stage; formation rules (min separation 220/260 px, bomb telegraph 350 ms before launch, same fruit type at most twice per wave, `LINE`/`PAIR` distinct types).
- **Combos, scoring, lives, arcade clock, Freeze/Frenzy/Double/Clock, golden apple, near miss, mercy window** with `debugSpawn` and hand-made segments.
- **Halves** per design 5.5 (velocities average to parent + blade push; never cut, never missed).
- **Phases** and result for each mode; practice mode behaviour.
- **Purity**: covered by `test/architecture`.
- **Performance smoke**: 60 simulated seconds of Classic S8 (worst case) with 10 segments per frame completes in well under real time (informational threshold: < 2 s of CPU).

---

## 8. Presentation contract (owner: Presentation engineer)

### 8.1 Responsibilities and files

Everything the player sees and hears and every screen: renderer (canvas 2D, procedural art with optional generated art, section 8.11), fx (particles, splats, popups, banners, shake, flashes), HUD, screens and their state machine, menus operated by cut or dwell, settings, storage, WebAudio synthesis, CSS. Implements `docs/game-design.md` sections 8.4 to 15 (blade trail, cursor, juice, audio, visual style, screens, UI strings, settings, accessibility). It consumes snapshots, events and blade samples; it never changes gameplay.

```
public/css/game.css                 fullscreen canvas, letterbox colour #14141C, cursor rules, no scrollbars
public/js/ui/
  presentation.js     createPresentation(deps): the facade (8.2)
  ui.js               screen state machine, intents, timers (dwell, lockouts, countdowns, cooldown display)
  screens/*.js        one file per screen (layout data + draw calls)
  storage.js          createStorage (8.7)
  strings.en.js       STRINGS, t(key, params) (8.8)
public/js/render/
  renderer.js         frame composition and draw order (11.3 of the design)
  sprites.js          offscreen sprite cache: fruit, halves (rasterised at cut time), splats, medallions, background, vignette
  fx.js               PURE fx systems (no canvas): particles, splats, popups, banners, shake, zoom, flash limiter, hit vignettes
  trail.js            blade trail polygon and cursor (pure geometry + draw)
  layout.js           canvas sizing, backing scale min(devicePixelRatio, 2), uses shared/playfield.js
  assets.js           optional art: manifest and image loader, groups, scaled and sliced caches (section 8.11)
  stage.js            optional art: layered backdrops per stage, crossfade, pre-composed cache (section 8.11)
  art-config.js       optional art: data only (paths, loader limits, stage veils, alphas, effect timings)
public/js/audio/
  audio.js            createAudio(deps): engine, bus chain, voice limit, unlock
  recipes.js          PURE data: every sound of design section 10 as a recipe (nodes, frequencies, envelopes, durations)
```

### 8.2 The facade

```js
createPresentation(deps: {
  canvas: HTMLCanvasElement,
  clock: Clock,
  storage?: StorageApi,             // default createStorage()
  audio?: AudioEngine,              // default createAudio({clock})
  document?, window?, matchMedia?,  // injectable for tests
}): Presentation
```

`Presentation` (typedef in section 11):

| Member | Semantics |
|---|---|
| `ui.onIntent(fn)` | Register an intent handler, returns unsubscribe. Intents are delivered **synchronously** from inside the DOM event handler that caused them (clicks, keydown) or from inside `step()` (dwell, timers, countdown end). |
| `ui.notify(fact)` | Feed a fact from `main.js` (`UiFact`, 8.4). |
| `ui.getState()` | `UiState`. Cheap, no allocation beyond a small object. |
| `ui.force(screen, {roundMode})` | Debug/test only: jump to a screen, no animation, no intents. |
| `step(StepInput)` | Advance UI timers, fx, audio scheduling, blade-driven menu targets. Deterministic given its inputs (`fx` uses a seeded stream `createRng(seed ^ SEED_XOR.renderFx)` reseeded from `snapshot.seed`). Never draws. |
| `draw()` | Draw the current state. No state changes. Allocation-light. |
| `resize()` | Recompute canvas size (also wired to `ResizeObserver` inside). |
| `getPerf()` | `{fps, avgFrameMs, degradeLevel}`; auto-degrade per design 9.11 (avg frame > 20 ms for 2 s: halve particles, then splat cap 12, then backing scale 1.0). |
| `audio`, `storage` | The engine and storage the facade uses (main wires settings to them). |
| `dispose()` | Remove listeners, close the AudioContext. |

Presentation attaches its own pointer listeners to `canvas` (hit-testing with `clientToPlayfield`), and once-only `pointerdown`/`keydown` listeners on `window` that call `audio.unlock()` (autoplay policy). It sets `canvas.style.cursor` from `UiState.systemCursor`. It must work with a fake canvas/2D context in Node for its logic (`ui.js`, `fx.js`, `recipes.js`, `storage.js` need no browser).

### 8.3 Screens and the UI state machine (design 12.1, exact)

Screens: `boot`, `safety`, `connect`, `calibration`, `menu`, `settings`, `tuning`, `countdown`, `playing`, `paused`, `results`. Overlays: `disconnected`, `confirm`. `UiState.gameActive` is true only on `playing` (and on `calibration` step 4) with no overlay and no resume countdown.

Transitions (design table 12.1, plus the intents emitted):

| From | To | Trigger | Intent emitted (before the screen changes) |
|---|---|---|---|
| `boot` | `safety` / `connect` / `menu` | `{type:'ready', skipSafety?}` fact. Safety not acknowledged (and `skipSafety` not set) -> `safety`; otherwise, if the last `provider` fact is `sim` or `mouse` in state `streaming` -> `menu`; otherwise -> `connect`. `main.js` sends the `provider` fact for `?input=sim|mouse` before `ready`. | none |
| `safety` | `connect` (or `menu` with a provider) | Confirm after the 2 s wait (Enter or click, never cut/dwell) | none |
| `connect` | `connect` (busy) | "Connect Joy-Con" (Enter/click, real DOM gesture) | `{type:'connect', provider:'joycon'}` |
| `connect` | `connect` (busy) | "Can't see it? Extended search" (a click only, shown only after the chooser was closed without a choice, i.e. provider error `cancelled`, never while busy, cooling down or connected; never automatic) | `{type:'connect', provider:'joycon', filter:'all'}` (`requestDevice` with `acceptAllDevices` and `optionalServices`, still synchronous inside the click) |
| `connect` | `connect` (busy) | **Native layout** (when `GET /__bridge/status` says the bridge is available): the main button "Connect Joy-Con (native bridge)" (click, or Enter whatever the pointer rests on) | `{type:'connect', provider:'native'}` (no chooser, no gesture needed; one attempt per click) |
| `connect` | `connect` (busy) | Native layout: "Not working? Try Chrome's Bluetooth" (`connect.secondary`; the main button and this one swap roles when Chrome was the path that last reached streaming or `?input=joycon` asks for it) | `{type:'connect', provider:'joycon'}` (or `'native'` when the roles are swapped), still synchronous inside the click |
| `connect` | `connect` (idle) | Native layout, attempt running: "Cancel" (`connect.cancel`, a click or Esc, **never Enter**) | `{type:'disconnect'}`: the provider goes to `idle`, no cooldown |
| `connect` | `menu` | "Simulator" / "Mouse only" (click/Enter) | `{type:'connect', provider:'sim'|'mouse'}` then, when the `provider` fact reports `streaming`, `menu` |
| `connect` | `calibration` | provider `joycon` streaming and "Continue" (or automatically after 1.5 s) | `{type:'startCalibration'}` |
| `calibration` | `menu` | step 4 (practice) cut | `{type:'endRound'}` |
| `calibration` step 3 | (stays) | `recenter` or `confirm` action (the 3 s stillness alternative is handled inside Motion, no intent needed) | `{type:'confirmCenter'}` |
| `calibration` step 3 -> 4 | (stays) | Motion `done` event with `quick:false` (with `quick:true` the UI returns to `menu` or, from pause, to the resume countdown) | `{type:'startRound', mode:'practice'}` |
| `calibration` | `connect` / `menu` | `back` action in steps 1 to 3 (back to where it started) | `{type:'cancelCalibration'}` |
| `menu` | `countdown` | a mode target cut/dwell/click | `{type:'startRound', mode}` |
| `menu` | `settings` / `calibration` / `connect` | targets | none / `{type:'startCalibration'}` / none |
| `settings` | `tuning` and back | "Sword tuning" / "Back" or the `back` action (the origin of `settings`, `menu` or `paused`, is kept) | none |
| `countdown` | `playing` | after "3, 2, 1, GO!" (0.8 s per number, GO 0.6 s, design 12.8) | none |
| `playing` | `paused` | `pause` or `back` action, `blur`/hidden fact, provider lost | none |
| `paused` | `playing` (via resume countdown) | "Resume" | none |
| `paused` | `settings` / `calibration` (quick only) / `menu` | targets | none / `{type:'quickRecenter'}` / `{type:'endRound'}` (after confirm dialog) |
| `playing` | `results` | `roundOver` fact | none |
| `results` | `countdown` / `menu` | "Play again" / "Menu" (after the 1.2 s lockout) | `{type:'startRound', mode}` / `{type:'endRound'}` |
| any (provider `joycon`) | overlay `disconnected` | `provider` fact with `state:'lost'` | none. If `playing`, the screen becomes `paused` underneath. |

**Native connect screen** (docs/native-bridge.md 10, item 5): the layout is chosen by the facts `bridgeProbe` (what the probe said: `checking`, `available`, `unavailable`) and `provider` (`transport`); without a probe (tests, `?clock=manual`, `?input=sim|mouse`) or when it said no, the screen is the legacy one. While the bridge works the status pill shows one line of text per helper phase (the facts `bridge`: `checking`, `starting`, `building`, `waitingBluetooth`, `scanning` with a 45 s countdown bar, `connecting`, `discovering`, `initialising`, `waitingData`), the main button is dead and "Cancel" replaces the second path; every error code shows its own text (`status.error.native.key`).

Overlay `disconnected` (design 12.11): 0-2 s text; at 2 s intent `{type:'reconnect'}` once; when a `provider` fact shows `streaming`: `{type:'quickRecenter'}`, wait for the Motion `done` (quick) fact, then the resume countdown (`pause.resuming`); on failure show `disc.failed` and the buttons "Try again" (disabled until `status.cooldownUntil`, then `{type:'reconnect'}`), "Continue with the mouse" (`{type:'useMouse'}`), "Back to menu" (`{type:'endRound'}` + `{type:'disconnect'}`). **With the native bridge** (`provider.transport === 'native'`) there is no automatic reconnect and no 25 s cut-off: the panel opens on its three buttons at once with `disc.native.text` ("hold SYNC, then press Reconnect"), the retry button reads "Reconnect" ("Reconnect in N s" until the cooldown ends), and an attempt shows its progress line, the scan countdown and "Cancel" (`disc.cancel`, which returns to the three buttons at no cost).

A `calibration` fact of type `started` moves the UI to `calibration` step 1 from `menu` or `connect` even when the UI did not ask for it (this is how `?simcal=1` drives the real wizard without a click).

Menu selection by sword (design 12.6, improvements round): hover, dwell and cut are evaluated once per `step()`. The dwell counts REST: the UI keeps a rest anchor (`UI_TIMING.restRadiusPx`, 70 px) and the dwell time runs from the later of the hover start and the rest start. A disarmed dwell arms after `armRestMs` (300 ms) of rest, never while `BladeView.cutting` and never while `BladeView.refDriven`, and needs either "no target under the cursor" or a hand move of more than `armMovePx` (100 px) from the first cursor position after the last disarm; a change of cursor source (`blade` head vs last `pointer`), a screen change and a change of dialog or overlay disarm it. The `tuning` screen is interactive like `settings` but only its three practice fruit (`tune.fruit0..2`) have `cut: true`; `UiView.tune` carries the swing peak, the reach and the corners for drawing.

Stick navigation (2026-10-01, docs/contract-notes.md "Stick navigation"): the analog stick and the arrow keys reach the UI as `NavEvent`s through `{type:'nav'}` (provider event `nav`; `input/stick.js` makes them from the parsed stick field: per-session centre, dead zone 0.35, one `down` per flick at 0.55, re-arm below 0.3, `up` at the release). In every screen that is not play the UI keeps ONE focus unit (`ui/focus.js`: a button, or a whole settings row), moves it spatially, and `confirm` / `back` act on it (`view.focus`, `view.navHint`). While a REAL Joy-Con is the provider, dwell and cut selection of menu items is off unless the setting `swordSelect` is on.

Action routing (A-10): the UI receives every `ActionEvent` through `{type:'action'}` and decides per screen: `confirm` activates the focused/hovered target, `back` goes back/opens pause, `pause` pauses during play, `recenter` emits `{type:'recenter'}` on `menu`, `tuning`, `countdown`, `playing`, `paused` and `{type:'confirmCenter'}` in calibration step 3 (`confirm` also confirms in step 3). Menu targets are activated by cut (a `BladeSegment` in `StepInput.segments` crossing the target), dwell (900 ms, setting `dwellSelect`) or pointer click. Dwell and cuts are never active during play, safety or connect (design 12.2, 12.4, 12.6). Sizes, positions, timings: design 12.

`UiState.systemCursor` is true on `safety` and `connect` (and on any screen while the provider is not `sim`/`mouse` and no aim source exists yet), false elsewhere.

### 8.4 Facts and intents

`UiFact` and `UiIntent` are typedef'd in section 11. Semantics:

- `provider` fact: sent by `main.js` on every provider change and status event; `kind:null` when there is no provider. Carries `labels` for `{button}` texts and `capabilities`. The UI derives the connect-screen pill, cooldown text (`status.cooldownUntil - nowMs`), error strings (table 5.4), provider chip, battery level toast (level `low`/`critical`, at most once per 5 minutes, design 12.3), and the disconnect overlay.
- `calibration` fact: forwards Motion's `CalibrationEvent`s; drives the four steps' progress ring, texts (`cal.*`), the flip button, `calOk`/`calFail` sounds.
- `recentered` fact: toast `hud.recentered` (800 ms) and sound `recenter`.
- `roundOver` fact: opens the results screen. The UI computes the rank itself from `CONFIG.ranks` (the same data `rankFor` uses, imported from `game/config.js`), the record through `storage.recordResult`, and the break banner through `storage.addPlayMs`.
- `visibility`/`blur`: auto-pause during play and suspend audio when hidden.
- `settingsChanged` intent carries the applied patch and full `Settings`; `main.js` pushes them to Motion (`sensitivity`, `cutThreshold`, `autoCenter`, `flipX`), Game (`hand`, `reduceMotion`, `lethalBombs`) and audio (`volume`).
- `endRound` means "discard the current game object" (quit from pause, leaving results, leaving practice).

### 8.5 Renderer

- **Draw order** (design 11.3): background (the stage layers when the art is loaded, otherwise the procedural background canvas), stain layer, combo/power-up banners, halves, whole objects, telegraph triangles, particles, slash marks, blade trail, HUD, score popups, toasts, cursor, full-screen overlays, panels and dim layers, cursor again on top when a panel is open. The game layer (up to popups) shakes and zooms; HUD, panels, cursor do not.
- **Interpolation**: draw objects and halves at `lerp(px, x, snapshot.alpha)` (and `prot`, `rot`). `tWorld` drives bomb fuse and orbiting animations.
- **Blade**: draw from `BladeView.samples`, **aging points by `nowMs - sample.t`** (a stale trail must fade even when no new samples arrive), the head and cursor at `BladeView.head`. Colours, widths, layers: design 8.4, 8.5. `BladeView.cutThreshold` is `T` for the colour ramp. `discontinuity` samples break the trail.
- **Half sprites**: rasterised **once per `cut` event** from `objType`, `angleRad`, `nx`, `ny` (design 5.5), keyed by `halfIds`, then drawn with the transform of the matching `GameHalf` each frame. (With the generated art the two halves of a fruit type are shared pictures baked once per type and side, and the cut angle only rotates them; section 8.11.)
- **Caps and performance**: design 2.6 and 9.11 (no `shadowBlur`, no `filter`, pre-rendered background/vignette/sprites/splats, particles <= 400, splats <= 24, popups <= 12). Frame budget: `step()` + `draw()` <= 6 ms average at 1080p on a MacBook; `presentation.step()` must not allocate per particle.
- **Determinism**: `fx.js` is a pure state machine given `(events, dtS, snapshot.seed, settings)`; the same inputs produce the same fx state (tested).
- **Accessibility** toggles (`reduceFlash`, `reduceMotion`) read from `storage.getSettings()` at step time (design 9.12, 15.2). Flash limiter: at most one full-screen luminance flash per 500 ms (design 9.8).
- **Debug overlay** (`StepInput.debug`): fps, stage, blade speed, threshold, hit circles, object ids, degrade level.

### 8.6 Audio engine

- `createAudio({clock, createContext?})`: `createContext` is injectable so tests use a fake `AudioContext` recording nodes. Signal chain, gains, envelopes, voice limit 24 with priority bomb > life > combo > power-up > slice > UI, pan law and autoplay policy exactly as design 10.1.
- `recipes.js` holds every sound of design 10.2 to 10.4 as pure data (`{id, layers:[{type:'osc'|'noise', ...}], durationMs}`), unit-tested for presence of every id and for envelope end times.
- `audio.handleGameEvent(ev)` maps `GameEvent`s to sounds: `cut` -> `slice` (k = `comboIndex-1` on the pentatonic scale), `combo close` -> `comboChime(n)`, `bomb` -> `bombBoom`, `nearMiss` -> `bombNear`, `telegraph` -> `bombWarn`, `enter` of a golden apple/medallion -> spawn cues, `powerup` phases -> activation/end cues (+ master low-pass for Freeze), `lifeLost` -> `lifeLost`, `miss` (costsLife false or Classic) -> `miss`, `slowmo` -> `slowmo`, `tick` -> `tick`, `gameOver`/`timeUp` -> `gameOver`/`timeUp`, `phase over` none. Continuous sounds (swoosh from `BladeView`, bomb fuse from `snapshot.objects`) run in `update`.
- Never throws, silent before `unlock()`, fully playable with volume 0. `audio.play(id, params)` is also used by the UI for `uiMove`, `uiSelect`, `uiBack`, `connectOk`, `disconnect`, `calStep`, `calHold`, `calOk`, `calFail`, `countdown`, `go`, `record`, `recenter`.

### 8.7 Storage

`createStorage({key = CONFIG.storageKey ('joyconNinja.v1'), backend = globalThis.localStorage, matchMedia})`:

- Single JSON: `{v:2, best:{classic|arcade|zen:{score,combo,date}}, settings, safetyAck, playMsTotal, notice}` (design 7.5; the key stays `joyconNinja.v1`, only `v` moved). **Version 2 (sword tuning round): `sensitivity` is the multiplier of the pointer curve (0.3 to 2.0 step 0.1, default 1.0) and `cutThreshold` is in deg/s of tip speed (100 to 700 step 25, default 300).** A document whose `v` is missing or below 2 keeps everything except those two settings, which are reset once to their new defaults (they changed units), and sets the in-memory notice `'motion-2'`; `getNotice()` returns it and `ackNotice()` clears it and saves (the UI shows the toast `settings.migrated` once, when the menu is first shown). Nothing is written by loading. Defaults per design 14; `reduceMotion` defaults to true when `matchMedia('(prefers-reduced-motion: reduce)').matches`.
- **Every access in try/catch**; corrupted JSON, missing/blocked/throwing storage: fall back to memory for the session, never throw, `isPersistent()` false. Values are validated and clamped on load (out-of-range settings snap to the nearest legal value).
- `recordResult(mode, {score, combo})`: new best only if strictly greater and above 0; returns `{isNewBest, best}`.
- The separate key `joyconNinja.imu.v1` (`{gyroScale, measuredAt}`) belongs to the diagnostics page and `main.js`; Storage does not touch it.

### 8.8 Strings

All strings of design section 13 are in `STRINGS` in `ui/strings.en.js`, keyed exactly as the design table, `t(key, params)` replaces `{name}` placeholders and throws in development builds (returns the key in production) for a missing key. **Test:** parse the tables of `docs/game-design.md` section 13 and assert that `STRINGS` contains every key with exactly that text.

**Additions required by this architecture** (the design table lacks them; add to `strings.en.js` and list in `docs/contract-notes.md` under "String additions"):

| Key | English |
|---|---|
| `connect.err.permission` | Chrome is not allowed to use Bluetooth. Check System Settings > Privacy & Security > Bluetooth. |
| `connect.err.noData` | The Joy-Con is connected but is not sending data. Hold down the sync button again and try again. |
| `connect.cooldown.long` | Too many attempts in a row: wait about 3 minutes, then hold down the sync button again. |
| `connect.batteryLevel.ok` | Battery: good |
| `connect.batteryLevel.low` | Battery: low |
| `connect.batteryLevel.critical` | Battery: almost empty |
| `cal.flipX.hint` | Is the crosshair moving the wrong way? |
| `cal.flipX.button` | Flip left and right |

The spelling of the `connect.step1`/`step2` pairing texts (HW-4) and the cooldown warning (HW-5) stay as in the design until the owner verifies them on the device.

Later additions (the chooser fallback, the sword tuning screen, the native Bluetooth bridge) are logged in `docs/contract-notes.md` under "String additions"; the texts of the native bridge are in `docs/native-bridge.md` section 9 and are compared with `strings.en.js` by `test/ui/strings.test.js`.

### 8.9 CSS

`public/css/game.css`: `html, body {margin:0; height:100%; background:#14141C; overflow:hidden}`, `canvas#stage {display:block; width:100vw; height:100vh; touch-action:none; user-select:none}`, no external fonts (design 11.4 uses system stacks). The letterbox colour is the ink colour.

### 8.10 Presentation tests (`test/render/`, `test/audio/`, `test/ui/`)

- **UI state machine** (`ui.js` with fake inputs): every transition row of 8.3 including intents, gesture-synchronous `connect` intent, safety button locked for 2 s and never activated by cut/dwell, results lockout 1.2 s, dwell 900 ms (with and without the setting), countdown timing, resume countdown, disconnect overlay flow (auto reconnect once at 2 s, cooldown-disabled retry, `useMouse`), `gameActive` truth table, action routing per screen, error-code to string mapping (table 5.4), `systemCursor`.
- **Strings**: parity with the design section 13 tables plus the additions table above; placeholders; no key unused by the UI (report unused keys).
- **Storage**: throwing backend, corrupted JSON, blocked storage, range clamping, best-score rule, defaults, `prefers-reduced-motion`.
- **fx.js**: particle/splat/popup caps, lifetimes (splat 1.5 s hold + 4.5 s fade), shake takes the maximum not the sum, flash limiter (two bomb hits 300 ms apart = one flash), popup separation rule, banner timing, `reduceMotion`/`reduceFlash` effects, determinism from the seed, auto-degrade order.
- **Trail/cursor geometry**: taper, colour ramp values at T, T+1200, T+3000, aging by `nowMs`, discontinuity break, at most 48 points.
- **Audio**: `recipes.js` completeness (every sound id of design 10), envelope ends, voice limit and priority eviction with a fake `AudioContext`, `handleGameEvent` mapping table, squared volume curve `0.8 * v^2`, never throws before `unlock()`.
- **Renderer with a fake 2D context**: draw order recorded as call sequence, no `shadowBlur`/`filter` assignments anywhere (spy), interpolation uses `alpha`, half sprite rasterised once per `cut`.
- **Contract**: `presentation.step` accepts every snapshot/event produced by the Game's tests' fixtures without throwing.
- **Art layer**: tests with stub images and a fake canvas, described in `docs/assets-integration.md`: with no assets every drawing call equals the procedural one, each missing picture falls back on its own, nothing is scaled or allocated per frame after warm-up, and the game modules never import the art.

### 8.11 The optional art layer (added 2026-09-30)

The game ships two complete ways of drawing itself. The first is the procedural one of design section 11: canvas paths, gradients and one seeded texture, no image files. The second is a skin made of generated pictures (style "Ink and Paper Dojo", made with Higgsfield GPT Image 2.5): sprites for the fruit, halves, bomb and medallions, juice splashes and a few effects, icons, controller glyphs, the UI kit (buttons, steppers, toggles, panel, timer ring, cursors, logo) and layered backdrops for four stages. The files live under `public/assets/` and are described by `manifest.json`; `docs/assets.md` documents the shipped files, the build tool and the measurements, and `docs/assets-integration.md` is the contract that the renderer, the stage and the widgets are written against.

Rules that make it safe (all of them are tested):

1. **Optional everywhere.** A missing file, a failed decode, a timeout, a group that is not loaded yet or the flag `?assets=0` mean that the procedural drawing runs, per picture and in the same frame. With no assets the game draws exactly what it drew before the art existed, and `createPresentation` behaves the same with or without them.
2. **A skin, never game state.** Collision radii, hit boxes, timings, target rectangles, the 84 px minimum target and the 28 px minimum text size do not change. `game/`, `motion/`, `input/` and `shared/` never see the art; nothing the art does can change a snapshot, a seed or a determinism test.
3. **Same entry points.** The art is baked once into the same centred sprite entries that the procedural painters produce, so `drawSprite`, the HUD and the screens keep their calls. Widgets gain an optional `opts.assets`; a missing or null value means the procedural widget.
4. **No allocation in hot paths.** Scaled and nine-sliced images are created once per size and device-pixel step and cached (least recently used, with a byte cap); nothing is scaled, composed or allocated in a frame after warm-up; the effects use a small fixed pool. No `shadowBlur`, no `filter`.
5. **Lazy layers and a memory budget.** Sprites, effects, icons and the UI kit (group `core`) load at boot behind the boot screen (logo and a progress bar) and the game waits for them for at most 2.5 seconds of real time, then starts and keeps loading (a thin bar along the bottom edge shows that until they are there). Backdrops load per stage on demand, at most two stages are decoded at a time and layers ship at 2560 x 1440 pixels or smaller.
6. **Offline.** Everything is same-origin under `public/assets/`: no CDN, no external host. The existing Content-Security-Policy already allows same-origin images (`img-src 'self'`), so it does not change.
7. **Accessibility unchanged.** "Reduce flashes" shortens and dims the explosion picture; "Reduce motion" turns off backdrop drift, parallax and the crossfade; sound, contrast, silhouettes (bomb ring, medallion dots) and the text rules are untouched.
8. **Backdrops.** Each round screen uses the stage of its mode (Classic, Arcade or Zen: dawn, lantern festival, stone garden); every other screen uses the night stage under a tinted (pale blue-grey) veil with a dimmed moon, and the secondary text of those screens is drawn in ink, so that the text stays readable. The three layers are drawn behind all gameplay objects, are calm and static (a small parallax only while something shakes or zooms: about 6 px for the far layer and 12 px for the middle layer at the strongest bomb shake) and fade into each other in 400 ms.

Where the wiring lives: `app.js` creates the loader (from the window's `Image`, `fetch` and a canvas factory; the loader fetches every file and decodes it into an `ImageBitmap` that it closes when a group is released, and falls back to `<img>` elements where `createImageBitmap` does not exist), calls `loadFonts` for the two web fonts right after it (before the first frame), waits for the `core` group AND `fontsReady()` within the one 2.5 s boot cap, and starts the night stage in the background; `ui/presentation.js` builds the stage and passes the loader to sprites, trail and renderer; `flags.js` reads `?assets=0`; `ninja-api.js` exposes the loader status as `__ninja.getAssets()`. The exact API, the loader states and the failure behaviour are in `docs/assets-integration.md`, the measurements (sizes, memory, timings) in `docs/assets.md`. Nothing about the physical Joy-Con is involved: the art layer is verified in Node with stub images and in headless Chrome, never on the owner's hardware.

---

## 9. Integrator contract (owner: Integrator, later)

### 9.1 Files

`public/index.html`, `public/js/main.js`, `server.js`, `start.command`, `README.md`, `docs/GUIDE.md`, `test/e2e/**`, `test-support/e2e/**`, the architecture guard test.

> **Integration status (added by the Integrator).** All of the above exist. `main.js` is only the browser bootstrap: the wiring described below lives in `public/js/app.js` (`createApp(env)`, testable in Node with fakes), the debug API in `public/js/ninja-api.js` and the URL flags in `public/js/flags.js`. The tests are in `test/app`, `test/server` and `test/e2e`, with helpers in `test-support/app` and `test-support/e2e`. Every deviation, addition and resolution of the integration phase is logged in `docs/contract-notes.md` (Integrator entries); the typedef block of section 11 already contains the additive changes that were accepted (`MotionPipeline.reanchor` and `getDebug`, the simulator's `teleport` event, `DebugSpawnSpec.atApex`, `Game.debugCounters`, `AudioEngine.stop`, `setMuted`).

### 9.2 `public/index.html`

A single `<canvas id="stage">`, `<link rel="stylesheet" href="css/game.css">`, `<script type="module" src="js/main.js">`, a `<noscript>` line. No inline scripts, no external URLs, no font `preload` link (it would request `/assets/fonts/` under `?assets=0` and `?fonts=0`; `app.js` starts the font download itself, section 8.11). `<title>3D Fruit Dojo</title>`, `aria-label="3D Fruit Dojo"` on the canvas, a `<noscript>` line that names the game, `lang="en"`.

### 9.3 `main.js`: boot and wiring

Boot order: parse URL flags (9.7) -> `Clock` (real or manual) -> `storage` -> `presentation` (canvas) -> `motion` (settings from storage; the accelerometer sign and `gyroScaleOverride` from `joyconNinja.imu.v1` are applied per provider when the provider is chosen, round 2 finding M3) -> keyboard actions -> provider from `?input=` (sim and mouse are created and connected immediately; joycon is created at the connect screen; without a flag the connect screen chooses) -> `window.__ninja` -> `ui.notify({type:'ready'})` -> loop.

Wiring table:

| Source | Event | Sink |
|---|---|---|
| provider (`imu`) | `sample` | `motion.pushImu` |
| provider (`aim`) | `aim` | `motion.pushAim` |
| provider | `status`, connect/disconnect | `ui.notify({type:'provider', ...})`; on `lost`: `motion.markDiscontinuity('lost')`; on recovery: `motion.recenter('reconnect')` then the UI's `quickRecenter` |
| provider | `action` | `ui.notify({type:'action', event})` |
| keyboard | `action` | `ui.notify({type:'action', event})` |
| motion | `calibration` | `ui.notify({type:'calibration', event})` |
| motion | `recenter` | `ui.notify({type:'recentered', kind})` |
| motion | `warning` | `ui.notify({type:'motionWarning'})` and the debug log |
| game | `drainEvents()` | `presentation.step({events})`; with `?haptics=1` also `provider.vibrate` (cut: 3, bomb: 6) |
| ui | `settingsChanged` | motion / game / audio (8.4) |
| ui | `startRound` | `createGame(mode, seed, options)`; `motion.setSettings({cutMul: CONFIG.modes[mode].cutMul})`; `practice` uses cutMul 1 |
| ui | `endRound` | drop the game, `cutMul` back to 1 |
| ui | `connect` | create the provider of that kind and call `provider.connect()` **synchronously**; catch rejections (status events drive the UI); for `sim` apply `provider.nominalCalibration` to motion unless `?simcal=1` |
| ui | `disconnect` / `reconnect` / `useMouse` | provider `disconnect()` / `reconnect()` (catch) / dispose the joycon provider and create+connect a mouse provider |
| ui | `startCalibration` / `cancelCalibration` / `confirmCenter` / `quickRecenter` / `recenter` | `motion.startCalibration({side})` / `cancelCalibration()` / `confirmCenter()` / `beginQuickRecenter()` / `recenter('manual')` |
| ui | `openDiagnostics` | disconnect the Joy-Con provider (one central at a time, round 1 finding M4), then `window.open('diagnostics.html', '_blank')` |
| window | `visibilitychange`, `blur` | `ui.notify` visibility/blur facts |
| window | `pagehide` | `provider.disconnect()` (BLE tear-down) |

Seeds: `?seed=N` fixes every round's seed; otherwise a fresh random 32-bit seed per round from `crypto.getRandomValues` (the only randomness in `main.js`). `debug` validation: with `?debug=1`, run `assertValid` on every `ImuSample`, `BladeSample`, snapshot and event at the boundaries and log violations to the console (never throw).

### 9.4 Provider lifecycle

Exactly one provider at a time. `?input=sim|mouse` -> created and connected at boot (`ui` starts in `menu`). `?input=joycon` (Web Bluetooth) and `?input=native` (the native bridge) -> created at boot but not connected (connect screen; the click connects; the path named by the flag is offered first). No flag -> connect screen chooses (native first when the bridge is available, or the path that last reached streaming). `?input=bridge` (the old reserved name) -> ignored with a warning naming `?input=native`. The two Joy-Con providers (`providers.joycon`, `providers.native`) live for the page lifetime (cooldown and failure counts are in them); `app.js` probes `GET /__bridge/status` at boot and each time the connect screen opens again (real clock only) and sends the UI the facts `bridgeProbe` and `bridge`. With `?input=sim&simcal=1` main does not apply `nominalCalibration`; after boot it calls `motion.startCalibration({side})` and `sim.playCalibrationScript()` (the UI follows through the `calibration` facts, above); under the manual clock the caller advances time (about 10 s of simulated time) until the `done` event.

Switching providers: dispose the old one (removing its listeners), `motion.reset()`, `motion.setCalibration(null)` (unless the new provider is `sim` with a nominal calibration), notify the UI with a `provider` fact.

### 9.5 `server.js`

Node built-ins only (`node:http`, `node:fs`, `node:path`, `node:url`, plus the local `bridge/manager.js`, imported lazily on the first `/__bridge/` request so that a broken bridge can never stop the game server). Listen on `127.0.0.1:8137` (`PORT` env override for tests; Chrome resolves `localhost` and falls back to IPv4). Serve `public/` only: normalise and reject path traversal (`..`, encoded, absolute, symlink escape via `realpath`), `GET`/`HEAD` only, 404/405/400 text bodies, no directory listing (`/` -> `index.html`), MIME map (html, js and mjs as `text/javascript; charset=utf-8`, css, json, svg, png, ico, txt, webmanifest), `Cache-Control: no-store` (the files under `/assets/`, the optional art, are served with `Cache-Control: no-cache` and a weak `ETag`, so that a repeat visit answers `304`; JPEG and CSV MIME types are added for them), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `GET /__health` -> `{"ok":true,"name":"joycon-ninja"}`. **Native bridge endpoints** (`GET /__bridge/status`, `GET /__bridge/events` as Server-Sent Events, `POST /__bridge/connect|disconnect|rumble`, with the Origin and custom-header rules of 5.11): docs/native-bridge.md 3.3. If the port is taken and `/__health` answers, print "already running" and exit 0; if the port is taken by something else exit 1 with a clear message. Prints "3D Fruit Dojo is running at `http://localhost:8137`" on start (and "3D Fruit Dojo is already running at ..." when it finds itself). Graceful shutdown on SIGINT/SIGTERM. `localhost` is a secure context, so Web Bluetooth works; never serve a LAN address.

### 9.6 `start.command`

Bash, `chmod +x`, works when double-clicked in Finder: `cd "$(dirname "$0")"`; check `node` exists (clear message and exit otherwise, mention `brew install node`); **before that build the native bridge (`bash bridge/build.sh`, non-fatal, `JOYCON_NO_BRIDGE=1` skips it, with the note that macOS asks for Terminal's Bluetooth permission at the first connect)**; start `node server.js` in the background if `http://localhost:8137/__health` does not answer; wait until it does (10 s timeout); `open -a "Google Chrome" "http://localhost:8137"` (fall back to `open` with the default browser plus a warning that only the Web Bluetooth path needs Chrome: the native bridge works in any browser); keep the Terminal window open with a "Press Ctrl+C to quit" line (English) and a trap that stops every background job the launcher started (by the job table, `kill $(jobs -p)`, never by a pid variable: a Ctrl+C between `cmd &` and `PID=$!` would leave an orphan, round 1 finding M3). While it runs it also starts `caffeinate -di -w $$` (a power assertion tied to the launcher's own pid, so the display does not sleep while a sword-only player produces no keyboard or mouse activity, round 1 finding M2; `JOYCON_NO_CAFFEINATE=1` opts out). The page itself holds a screen wake lock (`public/js/wake-lock.js`) during rounds, calibration and any Joy-Con link. Never uses `sudo`, never modifies system settings (a power assertion is not a setting).

### 9.7 URL flags

| Flag | Values | Default | Effect |
|---|---|---|---|
| `input` | `native`, `joycon`, `sim`, `mouse` | none (connect screen) | provider (9.4); `native` needs the real clock |
| `seed` | integer | random per round | seed for every round |
| `mode` | `classic`, `arcade`, `zen` | none | skip to the countdown after boot; implies `skipsafety=1`; without `input` implies `input=mouse` |
| `skipsafety` | `1` | off | skip the safety screen without storing the acknowledgement |
| `skipcountdown` | `1` | off | with `mode`, start playing immediately |
| `clock` | `manual` | real | manual clock, time moves only via `__ninja.advance` |
| `debug` | `1` | off | overlay + boundary validation |
| `mute` | `1` | off | audio engine never creates a context (tests) |
| `reducemotion`, `reduceflash` | `1` | off | force the settings on (tests) |
| `simhz` | number (66, 250, ...) | 66 | simulator rate |
| `simmount` | preset name (5.8) | `faceUp` | virtual mount |
| `simside` | `L`, `R` | `R` | virtual side |
| `simmirror` | `1` | off | mirrored gyro sign in the simulator |
| `simgyro` | `alt` | default | true gyro scale 0.0075 dps/LSB |
| `simseed` | integer | 1 | simulator noise/jitter seed |
| `simcal` | `1` | off | run the real calibration wizard with `sim.playCalibrationScript()` instead of `nominalCalibration` |
| `haptics` | `1` | off | experimental vibration on cut/bomb (A-20, UNVERIFIED-ON-HARDWARE) |
| `filter` | `lenient`, `strict`, `all` | the remembered filter, else `lenient` | Bluetooth scan filter passed to `provider.connect` (round 1 findings M5 / F2; Bluetooth provider only). An explicit `?filter` wins over the remembered one; the connect screen's "Extended search" button asks for `all` by itself |
| `mask` | `0xB7`, `0xFF`, `0x37` (`0x` prefix mandatory) | `0xB7` | Bluetooth feature mask passed to `provider.connect` |
| `side` | `L`, `R` | both | which Joy-Con the chooser offers (Web Bluetooth) or the bridge looks for |
| `accelsign` | `1`, `-1` | saved value, else `1` | accelerometer sign given to `createMotionPipeline({accelSign})` (protocol audit F3, UOH-20) |
| `simaccelsign` | `-1` | `1` | the simulator models a gravity-vector accelerometer |
| `assets` | `0` or `off` | on | turn the optional art off: the procedural drawing runs and no image and no font file is requested (section 8.11) |
| `fonts` | `0` or `off` | on | keep the art, use the system font stacks instead of the two web fonts (`render/fonts.js`, `docs/typography.md`); `assets=0` implies it. `parseFlags(...).fonts` |

The diagnostics page accepts `input` (`native`, the default, `joycon` or `sim`) and the `sim*` flags.

### 9.8 `window.__ninja` (exact signatures)

Installed before `ready` resolves; always present (not only with `?debug`). Types in section 11 (`SwingResult`, `NinjaSnapshot`).

```js
window.__ninja = {
  version: 1,
  ready: Promise<void>,                    // boot finished, UI on its first screen
  manualClock: boolean,
  now(): number,                           // clock.now()
  getConfig(): { game: CONFIG, motion: MOTION_CONFIG, input: INPUT_CONFIG },
  getSettings(): Settings,
  setSetting(key: keyof Settings, value: any): Settings,       // applies and persists like the settings screen
  setSeed(n: number): void,                // seed of the next start() and of every later round
  start(mode: 'classic'|'arcade'|'zen', opts?: { seed?: number, skipCountdown?: boolean /* default true */, wavesEnabled?: boolean /* default true */ }): void,
  snapshot(): NinjaSnapshot,
  swing(from: Point, to: Point, ms: number): Promise<SwingResult>,
  swingThrough(objectId: number, opts?: { angleDeg?: number /* 0 = +x, 90 = +y (down), default 0 */, speed?: number /* px/s, default 3000 */, length?: number /* px, default 600 */ }): Promise<SwingResult>,
  simSwing(from: Point, to: Point, ms: number): Promise<SwingResult>,    // same path through the simulator's IMU; rejects unless the provider is 'sim'
  advance(ms: number): void,               // manual clock only, throws otherwise; runs step() in slices of <= 16 ms
  pause(): void,                           // playing -> paused (no-op otherwise)
  resume(): void,                          // paused -> playing immediately (no resume countdown)
  press(action: 'confirm'|'back'|'pause'|'recenter'): void,   // ActionEvent {source:'debug'} through the normal routing
  reanchor(x: number, y: number): void,    // additive (sword tuning round): the cursor is put at (x, y) at the next IMU sample with a discontinuity; how a test places a RELATIVE cursor
  getMotionState(): MotionState,
  getCalibration(): Calibration | null,
  getUiState(): UiState,
  getPerf(): { fps: number|null, avgFrameMs: number|null, degradeLevel: number, inputToDrawMs: number|null },
  getAssets(): { enabled: boolean, manifest: string, groups: object, generation: number, stage: object|null },   // status of the optional art loader and of the stage backdrops (section 8.11); plain data
  debug: {
    spawn(spec: DebugSpawnSpec): number,   // Game.debugSpawn; throws when no round
    wavesEnabled(on: boolean): void,
    forceScreen(screen: string, opts?: { roundMode?: string }): void,
    setCalibration(cal: Calibration): void,   // additive: install a Calibration without the wizard (replaying the real recording)
  },
  sim: null | { setTarget, setPose, clearPose, playCalibrationScript, simulateLoss, simulateRecovery, getTruth },   // present iff provider kind is 'sim'
}
```

Additive debug helper for the native path: `__ninja.debug.getUiView()` returns a JSON copy of what the connect screen and the disconnect panel show (`connect`: layout, primary path, progress text, countdown, buttons; `disc`; `hover`; the live `targets`), which the native e2e uses to follow the screens without reading pixels.

Semantics that tests rely on:

- **Units of the results**: `SwingResult.minSpeed/maxSpeed` and `NinjaSnapshot.blade.speed` are in px/s-equivalent (deg/s x 10/3); `NinjaSnapshot.blade` also has `speedDps`, `cutThresholdDps` and `pointerModel`. The debug swings (`swing`, `swingThrough`) and the simulator (`simSwing`) cut at `T_px = cutThreshold * 10/3` = 1000 px/s at the default, exactly as before; a real Joy-Con is tested through the recording (`test/app/real-replay-app.test.js`, `test/e2e/real-replay.test.js`).
- **`swing`**: injects `AimSample`s through `motion.pushAim` every **4 ms of simulated time** along the straight segment at constant speed `length / ms` (last sample exactly at `to`, at `t0 + ms`); the first sample has `discontinuity:true`. It never bypasses the blade tracker: a swing slower than the cut threshold must not cut. Under the manual clock it interleaves `pushAim` with `advance(dt)` so the game keeps running (fruit move during the swing) and it advances an extra 180 ms after the last sample (so combo `close` events land in the result; the combo grace is 150 ms); the promise is already resolved when the call returns to the event loop. With the real clock, samples are injected from `step()` at their scheduled times.
- **`swingThrough`**: computes the line through the object's predicted centre at the middle of the swing (`position + velocity * duration/2`), direction `angleDeg`, then calls `swing`. Throws if the object id is not alive.
- **`simSwing`**: same timing, but drives `sim.setTarget` (first with `teleport:true`) so data travels model -> bytes -> parser -> pipeline.
- **`snapshot()`**: `NinjaSnapshot`; game fields are `null`/`[]` when no round exists.
- **`start()`**: creates the round, sets `cutMul`, moves the UI to `playing` (`skipCountdown` true) or `countdown`. Requires `ready`.
- **Determinism**: under `?clock=manual&seed=N&input=sim|mouse` the sequence of `snapshot()` results is a pure function of the sequence of debug API calls.

### 9.9 e2e scenarios (`test/e2e/*.test.js`, Chrome headless via CDP; skipped, not passed, when Chrome is missing)

All use `?clock=manual&mute=1&skipsafety=1` unless stated.

1. **Boot and menu**: `?input=sim` reaches `screen:'menu'`, no console errors, no failed requests, every request is `localhost` (offline proof).
2. **Round basics**: `start('classic', {seed:1})`, advance 1 s, objects appear, `assertValid`-style checks on each snapshot, first wave at 0.8 s.
3. **Threshold**: a `swing` across a fruit at 900 px/s does not cut, at 1100 px/s it does (design 16.5 item 4; these are the aim-path numbers, 270 and 330 deg/s-equivalent at the default threshold of 300 deg/s = 1000 px/s). The relative model (real Joy-Con) is tested on the real recording (section 6.10) and, in the native e2e, with swings of at least 600 deg/s placed by `__ninja.reanchor`.
4. **Bomb**: slow contact does not explode, fast crossing does, near miss triggers once.
5. **Combo**: `debug.spawn` three fruit on a line, one swing, combo of 3 awards +30.
6. **Determinism**: two page loads with the same seed and scripted swings produce identical snapshot hash sequences over 20 s of manual time.
7. **Simulator IMU path**: `simSwing` cuts a fruit; with `?simcal=1` the wizard completes and `getCalibration().frame` is within 3 degrees of `sim.getTruth().frame` for every mount preset and `simmirror`, `simgyro=alt`.
8. **Disconnect flow**: `sim.simulateLoss()` -> `screen:'paused'`, overlay `disconnected`; `simulateRecovery()` then recovery, quick recentre, resume.
9. **Mouse provider**: real mouse events via CDP `Input.dispatchMouseEvent` move the cursor and cut.
10. **Storage failure**: with `Storage.prototype` methods throwing (injected before load), the game boots, plays, and records scores in memory.
11. **Diagnostics page**: `diagnostics.html?input=sim` connects and shows a packet rate near the simulator rate and sane values (`|a|` about 1 g).
12. **Keyboard and safety**: safety screen locked 2 s, Enter confirms, Esc pauses in play.
13. **Modes**: Arcade timer and bomb penalty, Zen without bombs, Classic lives to game over and the results screen with lockout.
14. **Performance smoke** (real clock, 1920x1080 viewport, 20 s of Classic with the simulator): reports average frame time, fps and `inputToDrawMs`; hard failure only above 33 ms average (headless GPU varies); the 60 fps and 50 ms figures are reported as informational, and explicitly not claimed for the real device.
15. **Native bridge** (`test/e2e/native.test.js`, real clock, a FAKE helper process that plays a virtual sword, never the real helper): the first-run flow screen by screen (probe, native button, every progress line in order, the 45 s countdown, "Connected", the wizard through the real parser and Motion, a Zen round in which the cursor follows the synthetic motion and a swing cuts a fruit), a denied permission, nothing found, "Cancel" by click and Esc, exit code 134, the bridge dying in the middle of a game with a working "Reconnect", and the diagnostics page in native mode.

### 9.10 Documents the Integrator writes

- `README.md` (English, written for a maker who is not a programmer): what it is, requirements (macOS, Chrome, Node >= 22), start (`start.command` or `npm start`), controls, the three modes, settings, safety, quick troubleshooting, and a developer section (tests, URL flags, `window.__ninja`, performance, project layout, known limitations). It says plainly that nothing was verified on a real Joy-Con 2 and links to the guide's HARDWARE CHECKLIST.
- `docs/GUIDE.md` (English; wherever it names something on the screen it quotes the on-screen text exactly): safety, strapping the Joy-Con to the sword (any mount works, side detected, rigid fixing, no strong magnets), starting the game, pairing (SYNC, the lights as the community documents them, never in macOS Bluetooth settings, one attempt, the cooldown and how long to wait), the diagnostics page 2-minute procedure with the gyro one-revolution scale tool, calibration steps 1 to 4 with tips, re-centring, settings and the tuning screen, a troubleshooting table, how to report results back (the "Copy report" JSON), a glossary of the screen labels whose meaning is not obvious and the **HARDWARE CHECKLIST**: a 10-minute first-run test that lists every UNVERIFIED-ON-HARDWARE item of the code, `docs/joycon2-protocol.md`, `docs/protocol-audit.md` and `docs/game-design.md` (nothing claimed as verified; `test/architecture/docs-sync.test.js` fails if an item is missing from it).

---

## 10. Test strategy

### 10.1 Layers and commands

| Layer | Where | Runs with | Needs |
|---|---|---|---|
| Shared contracts (done) | `test/shared/` | `node --test` | nothing |
| Architecture guard (done) | `test/architecture/` | `node --test` | nothing |
| Module unit tests | `test/input`, `test/motion`, `test/game`, `test/render`, `test/audio`, `test/ui` | `node --test` | nothing (fakes in `test-support/<module>/`) |
| End-to-end | `test/e2e/` | `node --test` | Chrome (else skipped, reported as skipped) and a free port |

Commands: `npm test` (everything), `npm run test:unit` (all but e2e), `npm run test:e2e`. Test files are `*.test.js`; helpers live in `test-support/` (A-25). Tests use `node:test` and `node:assert/strict` only.

### 10.2 Rules for every test suite

- **Deterministic**: manual clocks, seeded RNG (`shared/rng.js`), no `Math.random`, no real timers, no real network, no sleeping. A test that needs time advances a manual clock.
- **Contract-pinning**: assert module outputs with `assertValid(kind, value)`.
- **No hardware claims**: tests of BLE behaviour say in their names "protocol model" or "fake device". A green BLE test proves conformance to `docs/joycon2-protocol.md`, never to the physical controller.
- **Shared vectors**: `docs/joycon2-test-vectors.json` (V1 and V2 real third-party captures, V3 synthetic, timestamp deltas) is the only source of truth for the parser. Motion and Input both use V1/V2 for the "accel magnitude about 1 g at rest" sanity check.
- **Mount matrix**: the six presets of 5.8 x both sides x rates {33, 66, 250} Hz is the standard parameter space for anything involving orientation (Motion unit tests, Input simulator tests, e2e calibration).
- **Report skips**: a suite that cannot run (no Chrome) must say so (`t.skip('reason')`). Final reports list every skipped or unrunnable check.

### 10.3 Where each design invariant is tested (docs/game-design.md 16.5)

| # | Invariant | Owner suite |
|---|---|---|
| 1 | Spawn validity | `test/game` |
| 2 | Determinism of waves | `test/game`, `test/e2e` (6) |
| 3 | No tunnelling | `test/game` (segment vs circle) and `test/motion` (a 1800 px sample becomes one segment) |
| 4 | Threshold and hysteresis | `test/motion` (tracker numbers), `test/e2e` (3) |
| 5 | Bomb behaviour | `test/game`, `test/e2e` (4) |
| 6, 7 | Combo formula and window | `test/game` |
| 8, 9 | Lives, arcade clock | `test/game` |
| 10 | Time scale is a minimum, timers real-time | `test/game` |
| 11 | Halves | `test/game` |
| 12 | Persistence failure | `test/ui` (storage) and `test/e2e` (10) |
| 13 | Config-only numbers | `test/architecture` (gravity and spawn line) |
| 14 | Flash limiter | `test/render` (`fx.js`) |

### 10.4 Definition of done (per engineer)

1. All exports of section 2.5 exist with the signatures of section 11 (`assertValid` passes on every output in your own tests).
2. `npm run test:unit` passes, including `test/architecture` (no rule violated).
3. Everything you cannot verify without hardware is labelled UNVERIFIED-ON-HARDWARE where it lives in code comments and in your notes.
4. Every deviation is in `docs/contract-notes.md`.
5. Your final message to the orchestrator is short and structured: what you built, files, tests run with counts, skipped/unverifiable items, deviations, risks.

---

## 11. Canonical typedefs

Generated verbatim from `public/js/shared/contracts.js` (block between the `<typedefs>` markers). If this block and the file differ, **the file wins**. Runtime enums (`PROVIDER_KIND`, `CONN_STATE`, `INPUT_ERROR`, `ACTION`, `GAME_EVENT`, `SCREEN`, `BUTTON_NAMES`, ...) live in the same file; validators live in `public/js/shared/validate.js`.

```js
/**
 * ============================ PRIMITIVES ============================
 * @typedef {{x:number, y:number, z:number}} Vec3
 * @typedef {{x:number, y:number}} Point                Playfield px (1920 x 1080, origin top-left, y down).
 * @typedef {'L'|'R'|'?'} Side                          '?' = not known (yet).
 * @typedef {'joycon'|'sim'|'mouse'} ProviderKind       The native Bluetooth bridge reports 'joycon' too (same controller); `InputProvider.transport` tells it apart.
 * @typedef {'classic'|'arcade'|'zen'} GameMode
 * @typedef {'classic'|'arcade'|'zen'|'practice'} RoundMode
 * @typedef {'confirm'|'back'|'pause'|'recenter'} ActionName
 *
 * @typedef {Object} Clock
 * @property {() => number} now                          Monotonic ms. Real clock = performance.now(). Never Date.now().
 * @property {boolean} manual                            true only for the manual test clock (?clock=manual).
 * @property {(ms:number) => void} [advance]             Present only when manual === true.
 *
 * ============================ INPUT ============================
 * ImuSample: ONE motion sample, produced by the real packet parser (BLE, simulator) and consumed by the Motion pipeline.
 * @typedef {Object} ImuSample
 * @property {number} seq                 0,1,2,... +1 per emitted sample within one provider session.
 * @property {number} t                   ms, Clock timebase: best estimate of the instant the sample was TAKEN. Non-decreasing,
 *                                        never later than arrivedAt.
 * @property {number} arrivedAt           ms, Clock timebase: when the notification handler ran.
 * @property {number|null} dtMs           Integration step since the previous sample, ms. From device timestamps when they pass
 *                                        the sanity check, else from arrival times. null on the first sample of a session and
 *                                        after a gap (dt <= 0 or dt >= 200 ms): consumers MUST NOT integrate across null.
 * @property {'device'|'arrival'|'synthetic'} dtSource
 * @property {Vec3} accel                 g, device frame. Specific force: at rest it points to world UP with magnitude ~1.
 * @property {Vec3} gyro                  deg/s, device frame, default scale 2000/32768 deg/s per LSB, bias NOT removed,
 *                                        sign NOT corrected (Motion does both).
 * @property {Side} side
 * @property {ReadonlyArray<string>} buttons   Names (BUTTON_NAMES) currently pressed. Shared frozen [] when none.
 * @property {number|null} batteryMv      Millivolts from the packet, null if unknown.
 * @property {number|null} tempC
 * @property {boolean} imuActive          false when the 12 motion bytes were all zero (IMU not enabled).
 *
 * @typedef {Object} AimSample            Direct aim from a pointer (mouse provider, debug swing). Playfield px.
 * @property {number} t                   ms, Clock timebase.
 * @property {number} x
 * @property {number} y
 * @property {boolean} [discontinuity]    true = teleport, do not connect to the previous sample.
 *
 * @typedef {Object} ButtonsEvent
 * @property {number} t
 * @property {Side} side
 * @property {ReadonlyArray<string>} pressed
 * @property {ReadonlyArray<string>} down         Newly pressed since the previous event.
 * @property {ReadonlyArray<string>} up           Newly released.
 *
 * @typedef {Object} ActionEvent          Edge event. Debounced by the emitter (no auto-repeat).
 * @property {number} t
 * @property {ActionName} action
 * @property {string} label               Display label for the UI, e.g. 'ZR', 'Space'.
 * @property {'joycon'|'keyboard'|'mouse'|'sim'|'debug'} source
 *
 * @typedef {Object} NavEvent            Menu navigation edge from the analog stick (provider event 'nav') or the arrow keys. `phase` 'down' is the
 *                                        flick (edge-triggered with hysteresis, input/stick.js), 'up' its release (the UI uses it to stop the auto-repeat of a value row).
 * @property {number} t
 * @property {'up'|'down'|'left'|'right'} dir
 * @property {'down'|'up'} phase
 * @property {'joycon'|'keyboard'|'mouse'|'sim'|'debug'} source
 * @property {number} [nx]                Normalised stick position at the edge (Joy-Con only), -1..1, y positive = up.
 * @property {number} [ny]
 *
 * @typedef {Object} ActionLabels         What to show in "Pause: {button}" style hints, for the ACTIVE provider.
 * @property {string} confirm
 * @property {string} back
 * @property {string} pause
 * @property {string} recenter
 *
 * @typedef {Object} InputErrorInfo
 * @property {'unsupported_browser'|'permission_denied'|'cancelled'|'not_joycon'|'cooldown'|'gatt_failure'|'no_data'|'lost_signal'} code
 * @property {string} message             English, technical, for logs and the diagnostics page. NOT shown to the player.
 * @property {boolean} retryable          false only for unsupported_browser.
 * @property {number} at                  ms, Clock timebase.
 * @property {{code:string, key:string}} [native]   Additive, native Bluetooth bridge only: the bridge's own error code (docs/native-bridge.md 4) and the
 *                                        string key of the text that says what to do (strings.en.js). The UI prefers it to the `code` mapping.
 *
 * @typedef {Object} BatteryInfo
 * @property {number|null} mv
 * @property {'ok'|'low'|'critical'|'unknown'} level   BLE: ok >= 3550 mV, low 3300-3549, critical < 3300, unknown = no packet yet.
 * @property {number|null} pct            null for BLE (no trustworthy mV -> % map, UNVERIFIED-ON-HARDWARE), null for mouse.
 *
 * @typedef {Object} InputStatus          Immutable snapshot, a new object on every change.
 * @property {ProviderKind} kind
 * @property {'idle'|'requesting'|'connecting'|'initializing'|'streaming'|'lost'|'error'} state
 * @property {Side} side
 * @property {BatteryInfo} battery
 * @property {boolean} trackingOk         Provider-level: data is flowing and usable (streaming and fresh, pointer inside).
 * @property {InputErrorInfo|null} error  Last error, kept until the next successful streaming.
 * @property {number|null} cooldownUntil  ms, Clock timebase. connect()/reconnect() reject with 'cooldown' before this instant.
 * @property {number} failures            Consecutive failed attempts (reset to 0 when streaming starts).
 * @property {string|null} deviceName
 * @property {number|null} packetRateHz   Over the last 1 s, null until 2 packets.
 * @property {number|null} lastPacketAt
 * @property {number|null} featureMask    BLE only: mask in use (0xB7 default, 0xFF last resort; 0x37 is an expert choice).
 *
 * @typedef {Object} PacketEvent          Diagnostics feed, one per notification/synthetic packet.
 * @property {number} arrivedAt
 * @property {number} length
 * @property {Uint8Array} bytes           A COPY (the browser reuses its buffer).
 * @property {Object|null} report         Result of parseInputReport (docs/joycon2-protocol.md 7.7), null if rejected.
 * @property {number|null} t              The ImuSample.t derived from it, null if rejected.
 *
 * @typedef {Object} ProviderCapabilities
 * @property {boolean} imu                Emits 'sample' (ImuSample). false for the mouse provider (emits 'aim').
 * @property {boolean} aim                Emits 'aim' (AimSample).
 * @property {boolean} buttons            Emits 'buttons'.
 * @property {boolean} needsUserGesture   connect() must run synchronously inside a click/keydown handler.
 * @property {boolean} needsCalibration   Motion needs the mount calibration wizard (true only for 'joycon').
 * @property {boolean} hasBattery
 * @property {boolean} canVibrate
 *
 * @typedef {Object} ConnectOptions
 * @property {'L'|'R'|'any'} [side]       Chooser filter for BLE. Default 'any'.
 * @property {'lenient'|'strict'|'all'} [filter]   BLE scan filter, default 'lenient' = INPUT_CONFIG.defaultFilter (product id only). 'strict' also requires the zero host address of a pairing-mode advert; 'all' is acceptAllDevices (docs/joycon2-protocol.md 3.3, docs/hardware-findings.md).
 * @property {number} [mask]              BLE feature mask override (expert), default 0xB7.
 * @property {boolean} [keepAlive]        BLE 1 Hz keep-alive, default true (expert toggle on the diagnostics page).
 * @property {boolean} [pairingOnly]      Native bridge only: connect only to a controller whose advert is in pairing mode (default false: pairing-mode adverts are preferred, any other Joy-Con 2 advert is the fallback).
 * @property {number} [scanSeconds]       Native bridge only: how long the helper looks for an advert (5 to 120, default 45).
 *
 * @typedef {Object} InputProvider
 * @property {ProviderKind} kind
 * @property {ProviderCapabilities} capabilities
 * @property {InputStatus} status                                   Getter, latest immutable snapshot.
 * @property {(opts?:ConnectOptions) => Promise<void>} connect      Resolves when state === 'streaming'. Rejects with an Error whose
 *                                                                  .code is an InputErrorInfo.code and .info is the InputErrorInfo.
 * @property {() => Promise<void>} reconnect                        Re-use the known device WITHOUT the chooser (BLE), subject to cooldown.
 * @property {() => Promise<void>} disconnect                       User-driven, goes to 'idle', never throws.
 * @property {(now:number) => void} [tick]                          Sim only: emit all samples due up to `now`.
 * @property {() => ActionLabels} getActionLabels
 * @property {'native'} [transport]                                 Additive: set by the native Bluetooth bridge provider only (kind stays 'joycon').
 * @property {() => object} [getBridgeInfo]                         Native bridge only: {phase, key, helperState, bridge, adverts, scanStartedAt, scanSeconds, lastCode, dropped, badReports}.
 * @property {(presetId:number) => void} [vibrate]                  BLE and native bridge, rate limited, optional (UNVERIFIED-ON-HARDWARE).
 * @property {Calibration|null} [nominalCalibration]                Sim only: exact calibration of the virtual mount.
 * @property {(type:string, fn:(payload:any) => void) => (() => void)} on   Returns an unsubscribe function.
 * @property {(type:string, fn:Function) => void} off
 * @property {() => void} dispose                                   Remove every listener and timer.
 * Events: 'sample' ImuSample | 'aim' AimSample | 'buttons' ButtonsEvent | 'action' ActionEvent | 'status' InputStatus |
 *         'error' InputErrorInfo | 'packet' PacketEvent | 'log' {t:number, level:'info'|'warn'|'error', message:string} |
 *         'teleport' {t:number, x:number, y:number}   (simulator only, additive: the virtual mouse jumped; the host calls MotionPipeline.reanchor(x, y)) |
 *         'bridge' {phase:string, helperState:string, key:string|null, at:number, scanStartedAt:number|null, scanSeconds:number}   (native bridge only, additive: progress of the attempt)
 *
 * ============================ MOTION ============================
 * Sword frame (right-handed): right x forward = up. World frame: x = right, y = forward (towards the screen), z = up.
 * @typedef {Object} Calibration          Serialisable. Kept in memory for the session only (NOT trusted across sessions).
 * @property {1} version
 * @property {Side} side
 * @property {number} createdAt           Date.now() at creation (only place where wall-clock time is allowed).
 * @property {{right:Vec3, forward:Vec3, up:Vec3}} frame   Sword axes expressed in DEVICE coordinates. Orthonormal,
 *                                        right-handed. forward = blade tip direction, up = the direction that is up when the
 *                                        sword points horizontally at the screen (top edge of the blade).
 * @property {Vec3} gyroBiasDps           Device frame, subtracted from ImuSample.gyro.
 * @property {1|-1} gyroSign              Multiplier applied to all three gyro axes after bias removal.
 * @property {number} gyroScale           Multiplier on ImuSample.gyro (1 = protocol default 2000/32768 deg/s per LSB). The two known candidates are
 *                                        1 and 0.12288 (= 0.0075 / 0.06103515625, the disputed '48000 = 360 deg/s' scale).
 * @property {'default'|'stored'|'estimated'} gyroScaleSource
 * @property {number} [accelG0]           Additive (round 2 M2): the accelerometer magnitude at rest (g) learned in step 1, 0.85 to 1.15 accepted; Motion divides every accelerometer reading by it. Absent = 1.
 * @property {{poseAngleDeg:number|null, stillPeakDps:number, warnings:string[]}} quality
 *
 * @typedef {Object} MotionSettings
 * @property {number} sensitivity         0.3..2.0 (step 0.1, default 1.0): the multiplier of the whole pointer curve (relative model: 5 px/deg at slow aim rising to 14 px/deg in a fast swing, times this); the simulator's absolute model: pxPerDeg = 27.4 * sensitivity. It never touches the cut decision.
 * @property {number} cutThreshold        deg/s of TIP speed (100..700 step 25, default 300), base value before the mode multiplier. The cut decision is made in deg/s, independent of sensitivity; the aim path and the simulator compare px/s against cutThreshold * cutMul * 10/3.
 * @property {number} cutMul              Mode multiplier (classic/arcade 1, zen 0.8). Effective T = cutThreshold * cutMul (deg/s).
 * @property {boolean} autoCenter         Soft centring at rest.
 * @property {boolean} flipX              Mirror the horizontal axis (yaw sign cannot be validated by physics, see 6.4).
 *
 * @typedef {Object} BladeSample          One per input sample (IMU or aim), emitted synchronously by pushImu/pushAim.
 * @property {number} t                   ms, Clock timebase.
 * @property {number} x                   Playfield px, clamped to 0..1920.
 * @property {number} y                   Clamped to 0..1080.
 * @property {number} speed               px/s-EQUIVALENT of the cut-decision speed: tip speed (deg/s) x 10/3 for IMU samples of the relative model, the cursor px/s over the last 50 ms (polyline length / span, at least 2 samples) for aim samples and the simulator. Standard threshold = 1000. The game, the trail and the audio read this scale and did not change.
 * @property {number} speedDps           Additive (sword tuning round): the cut-decision speed in deg/s (the tip speed, or speed / (10/3) for aim samples and the simulator). Always a number.
 * @property {number} vx                  Additive: cursor velocity at this sample in px/s (0 for aim samples and the absolute model); used by the path between two samples and the head extrapolation.
 * @property {number} vy
 * @property {boolean} interpolated       Additive: true only for samples that Motion inserted into its history ring between two real samples (every 8 ms, relative model); `recent()` returns them, the 'blade' event never does.
 * @property {boolean} cutting            Hysteresis state: enter >= T, leave < 0.65 T (relative model: two samples at or above T at least 25 ms apart).
 * @property {number} swingId             Integer, +1 per new swing (a re-entry within 100 ms keeps the id). 0 before the first.
 * @property {boolean} segmentValid       true = this sample delivered at least one collision-eligible segment (relative model: one or more chords of at most about 48 px; px tracker: cutting, length >= 6 px after merging), not a discontinuity, not dropped by the safety cap. The invariant segmentValid => cutting && !discontinuity holds.
 * @property {number} x0                  Start of the first segment this sample delivered (last anchor position; equals x when there is no segment).
 * @property {number} y0
 * @property {number} t0
 * @property {boolean} discontinuity      Trail must break; no cut may be tested across this sample.
 * @property {boolean} trackingOk
 * @property {number|null} angularSpeedDps  Total sword angular speed |w| for IMU samples, null for aim samples (the cut decision uses speedDps, the tip speed without the roll about the blade).
 * @property {'imu'|'aim'} source
 *
 * @typedef {Object} BladeSegment         A collision-eligible chord of the blade path, the ONLY thing Game.update() consumes. The relative model delivers several contiguous chords of at most about 48 px per IMU sample while cutting (no tunnelling at 33 Hz); `speed` is in the px/s-equivalent scale.
 * @property {number} t0
 * @property {number} x0
 * @property {number} y0
 * @property {number} t1
 * @property {number} x1
 * @property {number} y1
 * @property {number} speed
 * @property {number} swingId
 *
 * @typedef {Object} RecenterEvent
 * @property {number} t
 * @property {'manual'|'auto'|'edge'|'calibration'|'reconnect'} kind   ('edge' only in the absolute model; in the relative model 'auto' fires when the idle glide arrives at the centre)
 *
 * @typedef {Object} MotionWarning
 * @property {number} t
 * @property {'gyro_scale_suspect'|'gyro_sign_flipped'|'dt_fallback'|'sample_gap'|'accel_saturated'|'gyro_saturated'|'low_sample_rate'|'accel_gain_off'} code
 * @property {string} message
 *
 * @typedef {{type:'started', t:number, quick:boolean}
 *   | {type:'progress', t:number, step:1|2|3, phase:'waiting'|'holding'|'transition', progress:number, meanDps:number, peakDps:number, accelMagG:number}
 *   | {type:'stepPassed', t:number, step:1|2|3}
 *   | {type:'stepFailed', t:number, step:1|2|3, reason:'moved'|'bad_pose'|'bad_accel'|'timeout'|'no_data'|'no_calibration'}
 *   | {type:'done', t:number, quick:boolean, calibration:Calibration, warnings:string[]}
 *   | {type:'cancelled', t:number}} CalibrationEvent
 *
 * @typedef {Object} MotionState
 * @property {boolean} calibrated
 * @property {null|1|2|3} calibrationStep
 * @property {number} x
 * @property {number} y
 * @property {number} speed               px/s-equivalent (see BladeSample.speed)
 * @property {number} speedDps           Additive: cut-decision speed in deg/s
 * @property {number} cutThresholdDps    Additive: effective cut threshold in deg/s (cutThreshold x cutMul, so 240 in a Zen round at Normal)
 * @property {'relative'|'absolute'} pointerModel   Additive: 'relative' for a real Joy-Con, 'absolute' for the simulator
 * @property {boolean} cutting
 * @property {number} swingId
 * @property {number|null} yawDeg         Relative to the current centre reference; null in the relative model (there are no absolute angles).
 * @property {number|null} pitchDeg
 * @property {number} angularSpeedDps
 * @property {boolean} trackingOk         false when no sample for 200 ms or uncalibrated.
 * @property {boolean} refDriven          Additive (R2-01): the newest IMU sample's position came (partly) from the REFERENCES moving (soft centring, edge slip, recentre ease, re-reference; in the relative model the idle glide to the centre and the recentre ease), not from the sword. The menu dwell never starts on a cursor the reference dragged onto a target. false for aim samples.
 * @property {number|null} sampleRateHz
 * @property {number} lastSampleT
 *
 * @typedef {Object} MotionPipeline
 * @property {(s:ImuSample) => void} pushImu
 * @property {(s:AimSample) => void} pushAim
 * @property {(nowMs:number) => void} poll                Call every frame: tracking loss, auto-centre, segment flush.
 * @property {(patch:Partial<MotionSettings>) => void} setSettings
 * @property {() => MotionSettings} getSettings
 * @property {(cal:Calibration|null) => void} setCalibration
 * @property {() => Calibration|null} getCalibration
 * @property {(opts?:{side?:Side}) => void} startCalibration   Steps 1..3 (step 4 is a practice round run by Game/UI).
 * @property {() => void} cancelCalibration
 * @property {() => void} confirmCenter                   Player pressed recenter/confirm during step 3.
 * @property {() => void} beginQuickRecenter              Step 3 only (hold still 1.5 s or confirmCenter), frame unchanged.
 * @property {(kind?:'manual'|'reconnect') => void} recenter
 * @property {(reason:string) => void} markDiscontinuity  Next blade sample has discontinuity = true. Reason 'lost' also restarts the orientation filter from gravity (relative model: the cursor does not move, a hole loses only the motion inside it).
 * @property {(model:'relative'|'absolute') => void} setPointerModel   Additive (sword tuning round): 'relative' (a real Joy-Con, the default) or 'absolute' (the simulator). Call it when the provider changes, before reset() and setCalibration(null); it resets nothing itself. A relative pointer is a mouse in the local frame of the sword (dead zone, acceleration curve, idle soft auto-centre).
 * @property {() => 'relative'|'absolute'} getPointerModel
 * @property {(sign:1|-1) => void} setAccelSign          Additive (round 2 M3): the accelerometer sign of the ACTIVE provider (see createMotionPipeline accelSign). Call before reset() when the provider changes.
 * @property {(scale:number|null) => void} setGyroScaleOverride  Additive (round 2 M3): the stored gyro scale of the ACTIVE provider, or null. Call before reset() and setCalibration(null) when the provider changes.
 * @property {(x:number, y:number) => void} reanchor      Additive (integrator): the sensor pose JUMPED (simulator teleport) or a test wants the cursor somewhere. Absolute model: restarts the filter from gravity and the next IMU sample maps to (x, y); relative model: the cursor is put at (x, y) at the next IMU sample. Both with a discontinuity.
 * @property {() => object} getDebug                      Additive (motion): internal state for the overlay and tests, never for game logic.
 * @property {() => BladeSegment[]} drainSegments         Returns and clears the eligible segments since the last call, oldest first (several per IMU sample while cutting in the relative model).
 * @property {(windowMs:number) => BladeSample[]} recent  Samples with t >= latest.t - windowMs (relative to the NEWEST sample), oldest first (ring of 384; the relative model adds `interpolated` samples every 8 ms between two real ones).
 * @property {() => BladeSample|null} latest
 * @property {(nowMs:number) => Point|null} headAt        Newest position, extrapolated for drawing the blade head only (relative model: up to 35 ms with the last acceleration, never reversing; absolute model and aim path: linear, at most 15 ms). Never used for collision.
 * @property {() => MotionState} getState
 * @property {() => void} reset                           Clears filter, tracker and history. Keeps settings and calibration.
 * @property {(type:string, fn:(payload:any) => void) => (() => void)} on
 * @property {(type:string, fn:Function) => void} off
 * Events: 'blade' BladeSample | 'calibration' CalibrationEvent | 'recenter' RecenterEvent | 'warning' MotionWarning
 *
 * ============================ GAME ============================
 * @typedef {Object} GameOptions
 * @property {'right'|'left'} [hand]       Spawn-band bias only (+-80 px). Default 'right'.
 * @property {boolean} [reduceMotion]      No hit-stop; Freeze min scale raised to 0.5.
 * @property {boolean} [lethalBombs]       [P2] Classic: a bomb ends the round.
 *
 * @typedef {Object} GameObject
 * @property {number} id                   Unique within the round, +1 per spawn, never reused.
 * @property {'fruit'|'bomb'|'powerup'|'golden'} kind
 * @property {string} type                 Fruit id | 'bomb' | powerup id | 'golden'.
 * @property {number} x @property {number} y            Current tick position (px).
 * @property {number} px @property {number} py          Previous tick position (for interpolation).
 * @property {number} rot @property {number} prot       rad.
 * @property {number} vx @property {number} vy          px/s.
 * @property {number} r @property {number} hitR
 * @property {number} ageS                 World seconds since launch.
 *
 * @typedef {Object} GameHalf
 * @property {number} id
 * @property {string} parentType           Fruit id or 'golden'.
 * @property {1|-1} side                   +1 = half on the +n side of the cut, -1 = the other.
 * @property {number} cutAngleRad          Blade direction (the cut line) in playfield coordinates.
 * @property {number} x @property {number} y @property {number} px @property {number} py
 * @property {number} rot @property {number} prot @property {number} vx @property {number} vy
 * @property {number} r
 *
 * @typedef {Object} PowerupState
 * @property {'freeze'|'frenzy'|'double'} id
 * @property {number} remainingS           Real seconds.
 * @property {number} durationS
 *
 * @typedef {Object} GameSnapshot          Plain JSON. Taking a snapshot never mutates the game.
 * @property {1} v
 * @property {RoundMode} mode
 * @property {number} seed
 * @property {'running'|'ending'|'over'} phase
 * @property {number} t                    Game seconds (real time, excludes pauses and the countdown).
 * @property {number} tWorld               World seconds (advances slower during slow motion).
 * @property {number} waveIndex            Index of the last wave spawned (-1 before the first).
 * @property {number} stage                1-based stage number (S1, A1, Z1 = 1).
 * @property {number} alpha                0..1 interpolation factor between (px,py) and (x,y).
 * @property {number} timeScale            Effective world time scale (min of the active scales).
 * @property {number} score
 * @property {number|null} lives           Classic only.
 * @property {number|null} timeLeft        Seconds, Arcade/Zen only.
 * @property {number|null} timeTotal       Starting duration, for the timer ring.
 * @property {{progress:number, per:number}} lifeRegen   progress = fruit cut since the last regen (0..24), per = 25.
 * @property {{swingId:number, n:number, open:boolean}} combo
 * @property {PowerupState[]} powerups
 * @property {GameObject[]} objects
 * @property {GameHalf[]} halves
 * @property {Array<{x:number, remainingMs:number}>} telegraphs
 * @property {boolean} mercyActive
 * @property {{fruitCut:number, fruitMissed:number, bombsHit:number, bestCombo:number, powerupsTaken:number}} stats
 * @property {{cut:boolean, elapsedS:number}|null} practice
 * @property {'lives'|'bomb'|'timer'|null} endReason
 * @property {GameEvent[]} events          Last 32 events (also delivered once through drainEvents()).
 *
 * @typedef {Object} RoundResult
 * @property {RoundMode} mode
 * @property {number} score
 * @property {number} fruitCut
 * @property {number} bestCombo
 * @property {number|null} accuracy        0..1, null when no fruit was thrown.
 * @property {number} bombsHit
 * @property {number} powerupsTaken
 * @property {number} durationS
 * @property {'lives'|'bomb'|'timer'} endReason
 *
 * @typedef {Object} DebugSpawnSpec
 * @property {'fruit'|'bomb'|'powerup'|'golden'} kind
 * @property {string} [type]               Fruit id or powerup id. Default: first fruit / 'freeze'.
 * @property {number} apexX
 * @property {number} apexY
 * @property {number} [vx]                 px/s, default 0.
 * @property {number} [gScale]             default 1.
 * @property {boolean} [atApex]            Additive (game): default false. true = the object is placed exactly at (apexX, apexY) with vy = 0 (deterministic scripted tests).
 *
 * @typedef {Object} Game
 * @property {RoundMode} mode
 * @property {number} seed
 * @property {(frameDtS:number, segments:BladeSegment[], nowMs:number) => void} update
 * @property {() => GameSnapshot} snapshot
 * @property {() => GameEvent[]} drainEvents
 * @property {() => RoundResult|null} getResult    Non-null once phase === 'over'.
 * @property {() => boolean} isOver
 * @property {(patch:Partial<GameOptions>) => void} setOptions
 * @property {(spec:DebugSpawnSpec) => number} debugSpawn     Test hook, returns the object id.
 * @property {(enabled:boolean) => void} debugSetWavesEnabled Test hook.
 * @property {() => object} debugCounters                 Additive (game): sizes of the internal collections, for leak checks.
 *
 * Every GameEvent has {seq:number (+1 per event, per round), t:number (game seconds), type:string}. Payloads:
 * @typedef {{seq:number,t:number,type:'spawn', id:number, kind:string, objType:string, x:number, y:number, apexX:number, apexY:number}} SpawnEvent
 * @typedef {{seq:number,t:number,type:'enter', id:number, kind:string, objType:string, x:number}} EnterEvent
 * @typedef {{seq:number,t:number,type:'telegraph', x:number, inMs:number}} TelegraphEvent
 * @typedef {{seq:number,t:number,type:'cut', id:number, kind:'fruit'|'golden', objType:string, x:number, y:number, r:number, angleRad:number, nx:number, ny:number, points:number, doubled:boolean, comboIndex:number, swingId:number, speed:number, halfIds:[number,number]}} CutEvent
 * @typedef {{seq:number,t:number,type:'combo', phase:'update'|'close', n:number, swingId:number, bonus:number, x:number, y:number}} ComboEvent
 * @typedef {{seq:number,t:number,type:'bomb', id:number, x:number, y:number, lethal:boolean, scoreDelta:number, timeDeltaS:number, lifeLost:boolean}} BombEvent
 * @typedef {{seq:number,t:number,type:'nearMiss', id:number, x:number, y:number, dist:number}} NearMissEvent
 * @typedef {{seq:number,t:number,type:'powerup', phase:'activate'|'refresh'|'end', powerupId:string, x:number, y:number, durationS:number}} PowerupEvent
 * @typedef {{seq:number,t:number,type:'miss', id:number, objType:string, x:number, costsLife:boolean}} MissEvent
 * @typedef {{seq:number,t:number,type:'lifeLost', livesLeft:number, cause:'miss'|'bomb'}} LifeLostEvent
 * @typedef {{seq:number,t:number,type:'lifeGained', lives:number, cause:'regen'|'golden'}} LifeGainedEvent
 * @typedef {{seq:number,t:number,type:'timeBonus', deltaS:number, cause:'golden'|'clock'|'bomb', timeLeft:number}} TimeBonusEvent
 * @typedef {{seq:number,t:number,type:'slowmo', reason:'combo4'|'combo7'|'nearMiss'|'golden'|'gameOver'|'freeze'|'hitStop', scale:number, ms:number}} SlowmoEvent
 * @typedef {{seq:number,t:number,type:'tick', secondsLeft:number}} TickEvent
 * @typedef {{seq:number,t:number,type:'stage', stage:number, waveIndex:number}} StageEvent
 * @typedef {{seq:number,t:number,type:'wave', index:number, formation:string, count:number, hasBomb:boolean, hasPowerup:boolean, hasGolden:boolean}} WaveEvent
 * @typedef {{seq:number,t:number,type:'phase', phase:'ending'|'over'}} PhaseEvent
 * @typedef {{seq:number,t:number,type:'gameOver', reason:'lives'|'bomb', score:number}} GameOverEvent
 * @typedef {{seq:number,t:number,type:'timeUp', score:number}} TimeUpEvent
 * @typedef {{seq:number,t:number,type:'practice', phase:'thrown'|'cut'|'timeout'}} PracticeEvent
 * @typedef {SpawnEvent|EnterEvent|TelegraphEvent|CutEvent|ComboEvent|BombEvent|NearMissEvent|PowerupEvent|MissEvent|LifeLostEvent|LifeGainedEvent|TimeBonusEvent|SlowmoEvent|TickEvent|StageEvent|WaveEvent|PhaseEvent|GameOverEvent|TimeUpEvent|PracticeEvent} GameEvent
 *
 * ============================ PRESENTATION ============================
 * @typedef {Object} Settings             Persisted in localStorage key 'joyconNinja.v1' (docs/game-design.md 7.5).
 * @property {number} sensitivity         0.3..2.0 step 0.1, default 1.0 (multiplier of the pointer curve; document v2, before: 0.5..2.0 x 27.4 px/deg)
 * @property {number} cutThreshold        100..700 step 25, default 300, deg/s of tip speed (document v2, before: 400..2400 px/s, default 1000)
 * @property {number} volume              0..1 step 0.1, default 0.7
 * @property {boolean} reduceFlash
 * @property {boolean} reduceMotion       default true when prefers-reduced-motion: reduce
 * @property {'right'|'left'} hand
 * @property {boolean} autoCenter         default true
 * @property {boolean} dwellSelect        default true
 * @property {boolean} swordSelect        default false: while a REAL Joy-Con is the provider, menu items are chosen with the stick and A; true also lets the sword choose (dwell, cut)
 * @property {boolean} lethalBombs        [P2], default false
 * @property {boolean} flipX              default false
 *
 * @typedef {Object} BladeView            Built by main.js from the MotionPipeline every frame.
 * @property {BladeSample[]} samples      Motion.recent(260), oldest first.
 * @property {BladeSample|null} latest
 * @property {Point|null} head            Motion.headAt(now): where to draw the blade head / cursor.
 * @property {boolean} cutting
 * @property {number} speed               px/s-equivalent (tip speed x 10/3): trail colours, swoosh and audio keep this scale.
 * @property {boolean} trackingOk         Provider trackingOk AND motion trackingOk.
 * @property {number} cutThreshold        Effective T now in px/s-equivalent (deg/s x 10/3, Normal = 1000), for trail colours and swoosh.
 * @property {number} [speedDps]          Additive (sword tuning round): the cut-decision speed in deg/s, for the settings meter, the tuning page and calibration step 4. Absent: the UI derives it from `speed`.
 * @property {number} [cutThresholdDps]   Additive: effective T in deg/s (includes the Zen multiplier). Absent: derived from `cutThreshold`.
 * @property {boolean} [refDriven]        Additive (R2-01): MotionState.refDriven. Absent = false.
 *
 * @typedef {Object} StepInput            The single per-frame call into the Presentation.
 * @property {number} nowMs
 * @property {number} dtS                 Real seconds since the previous step (clamped 0..0.05).
 * @property {GameSnapshot|null} snapshot Non-null while a round object exists (countdown, playing, paused, results).
 * @property {GameEvent[]} events         Drained from the game this step (may be empty).
 * @property {BladeView} blade
 * @property {BladeSegment[]} segments    Eligible segments this step, ONLY when the game is not consuming them (menus). Else [].
 * @property {boolean} debug              ?debug=1
 *
 * @typedef {Object} UiState
 * @property {'boot'|'safety'|'connect'|'calibration'|'menu'|'settings'|'countdown'|'playing'|'paused'|'results'} screen
 * @property {null|'disconnected'|'confirm'} overlay
 * @property {boolean} gameActive         true = main.js must call Game.update() this step (playing, or calibration step 4, and not paused,
 *                                        not resuming, no overlay).
 * @property {boolean} resuming           Resume countdown after pause / reconnect is running (game must not update).
 * @property {null|1|2|3|4} calibrationStep
 * @property {boolean} systemCursor       true = show the OS cursor over the canvas (connect/safety screens).
 * @property {RoundMode|null} roundMode   Mode of the round that the countdown/playing/paused/results screens belong to.
 *
 * @typedef {{type:'startRound', mode:RoundMode}
 *   | {type:'endRound'}
 *   | {type:'connect', provider:ProviderKind|'native', filter?:'lenient'|'strict'|'all'}     'native' = the native Bluetooth bridge (no chooser, no filter)
 *   | {type:'disconnect'}
 *   | {type:'reconnect'}
 *   | {type:'useMouse'}
 *   | {type:'startCalibration'}
 *   | {type:'cancelCalibration'}
 *   | {type:'confirmCenter'}
 *   | {type:'quickRecenter'}
 *   | {type:'clearCalibration'}
 *   | {type:'recenter'}
 *   | {type:'settingsChanged', patch:Partial<Settings>, settings:Settings}
 *   | {type:'openDiagnostics'}} UiIntent
 *
 * @typedef {{type:'ready', skipSafety?:boolean}
 *   | {type:'action', event:ActionEvent}
 *   | {type:'nav', event:NavEvent}
 *   | {type:'provider', kind:ProviderKind|null, transport?:'native'|'bluetooth'|null, status:InputStatus|null, labels:ActionLabels|null, capabilities:ProviderCapabilities|null}
 *   | {type:'bridgeProbe', phase:'checking'|'done', available?:boolean, reason?:string|null, canBuild?:boolean, built?:boolean, preferred?:'native'|'chrome'|null}
 *   | {type:'bridge', phase:string, key:string|null, scanStartedAt:number|null, scanSeconds:number|null}
 *   | {type:'calibration', event:CalibrationEvent}
 *   | {type:'recentered', kind:string}
 *   | {type:'roundOver', result:RoundResult}
 *   | {type:'visibility', hidden:boolean}
 *   | {type:'blur'}
 *   | {type:'motionWarning', warning:MotionWarning}} UiFact
 *
 * @typedef {Object} Presentation
 * @property {{onIntent:(fn:(i:UiIntent)=>void)=>(()=>void), notify:(f:UiFact)=>void, getState:()=>UiState, force:(screen:string, opts?:{roundMode?:RoundMode})=>void}} ui   force() is for the debug API and tests only: jumps to a screen with no animation and no intents.
 * @property {(s:StepInput) => void} step          Advance UI timers, fx, audio scheduling. Deterministic given inputs.
 * @property {() => void} draw                     Draw the current state to the canvas. No state changes.
 * @property {() => void} resize
 * @property {() => {fps:number, avgFrameMs:number, degradeLevel:0|1|2|3}} getPerf
 * @property {AudioEngine} audio
 * @property {StorageApi} storage
 * @property {() => void} dispose
 *
 * @typedef {Object} AudioEngine
 * @property {() => void} unlock                   Create/resume the AudioContext. Call inside a user gesture. Idempotent, never throws.
 * @property {boolean} ready
 * @property {(v01:number) => void} setVolume
 * @property {(id:string, params?:Object) => void} play
 * @property {(ev:GameEvent) => void} handleGameEvent
 * @property {(dtS:number, ctx:{blade:BladeView, snapshot:GameSnapshot|null, screen:string}) => void} update
 * @property {() => void} suspend
 * @property {() => void} resume
 * @property {(id:string) => void} stop            Additive (presentation): stop the voices of one sound (the calibration hold glide).
 * @property {(on:boolean) => void} setMuted       Additive (presentation): runtime mute (M key); volume keeps its value.
 * @property {boolean} muted
 *
 * @typedef {Object} StorageApi
 * @property {() => Settings} getSettings
 * @property {(patch:Partial<Settings>) => Settings} updateSettings
 * @property {(mode:GameMode) => {score:number, combo:number, date:string}|null} getBest
 * @property {(mode:GameMode, r:{score:number, combo:number}) => {isNewBest:boolean, best:{score:number, combo:number, date:string}}} recordResult
 * @property {() => void} resetBest
 * @property {() => boolean} getSafetyAck
 * @property {() => void} setSafetyAck
 * @property {() => null|'motion-2'} getNotice   Additive (sword tuning round): a pending one-time notice; 'motion-2' after a v1 document was migrated (Sensitivity and Slice threshold reset to their new defaults).
 * @property {() => void} ackNotice              Additive: clears the notice and saves (the document is then v2).
 * @property {(ms:number) => number} addPlayMs      Returns the new cumulative total.
 * @property {() => boolean} isPersistent           false when the in-memory fallback is in use.
 *
 * ============================ DEBUG API (window.__ninja) ============================
 * @typedef {Object} SwingResult
 * @property {number} samples                      Blade samples injected.
 * @property {number} cutCount                     'cut' events (fruit + golden) produced from the start of the swing until 180 ms after its end.
 * @property {GameEvent[]} events                  Those events plus any bomb/powerup events in the same span.
 * @property {number} minSpeed                     px/s-equivalent reported by the blade during the swing (excluding the first sample; deg/s = px/s x 3 / 10).
 * @property {number} maxSpeed
 * @property {boolean} cuttingAtEnd
 * @property {number} swingId                      Blade swingId at the end (0 if it never cut).
 *
 * @typedef {Object} NinjaSnapshot                 GameSnapshot fields flattened (null/[] when no round) plus:
 * @property {string} screen
 * @property {string|null} overlay
 * @property {{x:number,y:number,speed:number,speedDps:number,cutThresholdDps:number,pointerModel:'relative'|'absolute',cutting:boolean,swingId:number,trackingOk:boolean}} blade
 * @property {{kind:string|null, state:string|null, side:string|null}} provider
 * @property {boolean} calibrated
 * @property {boolean} manualClock
 * @property {number} nowMs
 * @property {GameSnapshot|null} game              The untouched GameSnapshot (same data as the flattened fields).
 */
```

---

## 12. Performance and latency rules

| Rule | Value | Owner |
|---|---|---|
| Frame rate | 60 fps at 1080p on a MacBook; `step()` + `draw()` <= 6 ms average; whole `main` step <= 10 ms | Presentation, Integrator |
| Physics | fixed 1/120 s, at most 6 steps per frame, real frame delta clamped to 50 ms | Game |
| Collision | swept segment vs circle over every `BladeSegment` since the last update; no tunnelling at any speed | Game, Motion |
| Input handler | copy bytes, timestamp, parse, emit; no rendering work; no per-packet allocation beyond the sample object and the byte copy | Input |
| Pipeline | synchronous in the event handler, <= 2 ms per sample | Motion |
| Blade smoothing | adds at most 8 ms of lag at cutting speed | Motion |
| Blade head drawing | newest sample (or `headAt(now)`, max 15 ms extrapolation) at render time, never the last physics tick | Presentation |
| Software input-to-screen latency | < 50 ms target; the debug API reports `inputToDrawMs` (arrival of a sample to the first `draw()` that used it). The BLE and display parts are UNVERIFIED-ON-HARDWARE (UOH-18, HW-1) and cannot be claimed | Integrator |
| Drain rule | every frame drains all queued samples before simulating (protocol 7.3) | Integrator |
| Caps | 12 uncut fruit (14 Freeze, 16 Frenzy), 40 halves, 400 particles, 24 splats, 12 popups, 24 audio voices | Game, Presentation |
| Forbidden per frame | `shadowBlur`, `filter`, large gradients, layout reads (`getBoundingClientRect`) except on resize/pointer events | Presentation |
| Art images (section 8.11) | scaled once per size and density step and cached; a stage is one pre-composed picture while nothing shakes; no allocation per frame after warm-up; at most two stages decoded; layers at most 2560 x 1440 | Presentation |
| Expected input rate | 33-67 Hz (protocol 7.3, UNVERIFIED-ON-HARDWARE): all algorithms must work at 33 Hz; 250 Hz must not break them | Motion, Input |

---

## 13. Hardware honesty rules

Constraint 8: nobody on the team can touch the real Joy-Con, so **nothing about the physical device is verified**.

1. The tag is exactly `UNVERIFIED-ON-HARDWARE` (abbreviations UOH-n for the protocol register, HW-n for the design register are fine next to it).
2. Put the tag in code comments wherever behaviour depends on the device (rates, keep-alive, cooldown, axes, gyro scale/sign, button reachability, battery mapping, latency, drift), in test names where a fake stands in for the device, in UI strings that describe device behaviour (pairing texts), and in every report.
3. Sources of truth for "what is assumed": `docs/joycon2-protocol.md` section 12 (UOH-1..19) and `docs/game-design.md` section 17 (HW-1..12). Add a row to your notes when you introduce a new assumption; the Integrator consolidates them in the README.
4. Words to avoid without the tag: "works", "verified", "confirmed", "measured" (about the device). Words to use: "specified", "modelled", "assumed", "expected", "simulated".
5. Fake devices (`fake-bluetooth`, the simulator) document that they model the protocol document, not the device.
6. Reports state failures and skipped checks plainly. A test that was not run is "skipped", never "passed".
7. The diagnostics page and the setup guide are how the owner converts UNVERIFIED-ON-HARDWARE items into verified ones; nothing else can.

---

## 14. Risks, open items, and how to change a contract

### 14.1 Top risks (architecture view)

| # | Risk | Mitigation in this architecture |
|---|---|---|
| 1 | Low, bursty sample rate (33-67 Hz), latency budget at the edge of 50 ms (UOH-4, UOH-18) | Device-timestamp dt, chord segments (swept collision), `headAt` extrapolation, drain-all-per-frame, tests at 33 Hz, `inputToDrawMs` and diagnostics latency probe |
| 2 | Gyro scale ambiguity (8.14x) | Parser stays exact; `gyroScale` multiplier; automatic estimate during calibration; diagnostics one-revolution tool; warning `gyro_scale_suspect` |
| 3 | Mount and side unknown; gyro sign unknown | Mount-agnostic two-pose calibration, sign self-test, six-mount x two-side test matrix, `flipX` |
| 4 | Link stability and cooldown on macOS (UOH-5, UOH-11) | Keep-alive, pairing-mode filter available (`strict`, no longer the default since 2026-09-30), one attempt per click, one silent retry, 10 s / 180 s cooldown, no reconnect loops |
| 5 | Web Bluetooth path unverified on this exact stack (Chrome 154, macOS 26.6, N1); on the owner's Mac Chrome's chooser listed no device (2026-09-30) | The native Bluetooth bridge as the primary path (5.11), itself unverified against a real helper run (UOH-21 to UOH-33); the diagnostics page as the verification tool for both paths |
| 6 | Yaw drift makes aim wander (HW-3) | Soft centring, edge slip, manual recenter, always-visible cursor, mercy rules, big hit radii |
| 7 | Presentation is the largest work package (renderer, audio, screens, strings, storage, CSS) | One facade, pure `fx.js`/`recipes.js`/`ui.js` testable in Node, priorities [MUST] before [SHOULD] before [P2] from the design, internal split at the engineer's discretion |
| 8 | The two-pose calibration may fail for an unlucky mount (design risk 5) | Failure reasons are explicit; step retries; `Calibration` can be set from outside (`setCalibration`) so a manual axis picker can be added later without changing contracts |
| 9 | Hidden tab throttles timers (keep-alive, watchdog) | Pause on hidden, warning, do not count hidden time toward `lostAfterMs` |
| 10 | Port 8137 already in use | `server.js` health check and clear message (9.5) |
| 11 | The optional art costs memory and load time, or looks wrong on the owner's Mac (weight of the layers, soft menu fruit, loud near layers, controller-like glyphs) | Every image is optional with the procedural fallback (8.11), budgets and lazy groups, data-only knobs for the layer alphas and the glyph switch, measurements and open decisions in `docs/assets.md` and `docs/assets-integration.md`; nothing of it is verified on the owner's hardware |

### 14.2 Open items intentionally left to the owner or later

Battery percentage mapping (A-15), haptics polish (A-20), running the native bridge against a real Joy-Con (5.11, UOH-21 to UOH-33), optional background music (design 10.4 P2), lethal bombs (P2), leaderboard, and everything in `docs/game-design.md` section 18 that is a question to the owner.

### 14.3 Changing a contract

1. Do not edit files you do not own, including `shared/contracts.js`.
2. Append an entry to `docs/contract-notes.md` using the template inside that file (what, why, proposed change, who is affected, whether you already coded against it). Implement to the contract as written unless the entry says it blocks you.
3. The Integrator reads the log, applies accepted changes to `contracts.js`/this document, runs `npm test`, and notes the resolution in the same entry.
4. Purely additive fields (a new optional property, a new event payload field) do not need approval but must be logged.
