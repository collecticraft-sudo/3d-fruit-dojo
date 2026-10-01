# Code review, round 2: the sword-tuning workstream (relative pointer, angular cut, storage v2, tuning screens, round F1 vertical axis)

Reviewer: senior code reviewer, 2026-10-01. Scope: `public/js/motion/**` (including the round F1 changes to `pointer.js`, `pipeline.js`, `fusion.js`, `motion-config.js`), `ui/storage.js`, `ui/ui.js` (tuning and migration parts), `ui/screens/{settings,tuning,calibration}.js`, `ui/layout-data.js`, `ui/strings.en.js`, `app.js` wiring, the tests and `test-support`, and the documents. Everything said about feel stays UNVERIFIED-ON-HARDWARE: the only ground truth is `recordings/imu-2026-09-30T18-42-24.jsonl`.

## 0. Verdict

**No critical and no major finding.** The motion core, the migration and the wiring do what the contract says on the real recording and under fuzz. There are **9 minor findings** (G1 to G9). Four of them (G1, G2, G3, G6) are findings of the round 1 review (`docs/motion-code-review-round-1.md` F1 to F4) that are **still open and were not dispositioned**: the F1 fixer round addressed only the verifier's finding F1, and `docs/contract-notes.md` has no entry for the round 1 review. They are re-verified below on the current tree.

| Check | Result |
|---|---|
| `npm test` (unmodified tree, ports 8200, 8210, 8230 not touched) | green: 1847 tests, 1847 pass, 0 fail, 0 skipped (190 s) |
| Fuzz of the relative pipeline, own script (300 runs x 400 samples; gaps 0 / 60 / 100 to 500 / 1500 ms, duplicates, NaN gyro, saturated samples, accel magnitude 1 and 2.5 g, both accelerometer signs, all six mounts, random `recenter`, `markDiscontinuity('lost')`, `setSettings`, `reset`, `poll`) | 0 violations: state, segments and `headAt` finite; position inside the field; segment `t1 >= t0` and `speed > 0`; ring chronological; `segmentValid => cutting && !discontinuity`; never `cutting && discontinuity` |
| Migration v1 to v2 (read of `storage.js`, plus 14 single-line mutants of it, all killed) | correct: no double migration, `best`, `safetyAck`, `playMsTotal` and all other settings kept, one-time notice, `v: 2` written by the first save |
| Mutation testing (100 single-line mutants of the implementation on a copy of the tree in the scratchpad, suites `test/{motion,ui,input,app,architecture,shared}`, 1009 tests) | 80 killed, 20 survived; of the 20, 5 are equivalent or near-equivalent and 15 are test gaps (G7) |
| Curve and units | `F(s)` continuous (zero at the dead-zone edge, smoothstep ramp with zero slope at the top), monotone; the vertical cap crosses the curve at 80 deg/s (the text says "about 75"); the table of the contract reproduces |
| Timestamp wrap and lost packets | `report-stream.js` uses `(ts - prevTs) >>> 0`; nothing in `motion/` uses the raw counter; a 60 ms hole integrates as a normal step; duplicates (`dt` 0) integrate nothing and do not break the cut |

## 1. Findings

### G1 (minor, still open from round 1 F1) After a hole whose first sample is above the safety cap, the next sample integrates the whole hole and is not a discontinuity

`public/js/motion/pipeline.js`, `_relativeStep`: a sample above `safetyCapDegPerS` returns at once (the local `gapDisc` of that sample is lost), and the next accepted sample gets `dtMs = t - this.rel.tPrev` with no upper bound and no discontinuity flag (the `ignoredSince` branch).

Verified on the current tree (`tip-stream`, 60 deg/s rightwards, `skip(1000)`, one sample of 3000 deg/s, then 60 deg/s): the sample after the ignored one is at t = 1333 ms, `discontinuity: false`, and the cursor moves 338 px in that single step (x 1047 to 1385) instead of the 10 px of a normal step. The contract (2.4) says the next sample "integrates over the device step"; the code integrates the hole. Rare trigger (a saturated sample right behind a hole), but it moves the cursor and can cut along an invented path.

Fix: when the ignored sample had `gapDisc`, set `this.nextDiscontinuity = true` before returning; and treat a repaired `dtMs >= cfg.maxGapMs` as `null`.

### G2 (minor, still open from round 1 F2) The recenter guard of `app.js` applies to the simulator and the mouse, where `speedDps` is px-derived

`app.js` line 799: `if (b.cutting || b.speedDps >= RECENTER_BLOCK_DPS) lastFastAt = clock.now();`. For aim-path and absolute-model samples `speedDps = px/s / (10/3)` (pipeline `_emitBlade`), so 100 "deg/s" is 333 px/s of cursor speed. A Space press within 250 ms of a mouse move faster than 333 px/s is silently ignored (log line only). The guard exists for the grip of a real Joy-Con. Unit mix-up: px-equivalent speed against a deg/s constant. Fix: apply the guard only for `joycon` and `native` providers, or compare `b.angularSpeedDps` (real deg/s, `null` for aim samples).

### G3 (minor, still open from round 1 F3) A hole of 90 to 199 ms during a cut is integrated as a normal step; 200 ms breaks the cut

Verified on the current tree: a cut run with one hole of 60, 120, 150 or 180 ms keeps ONE swing (the cursor takes the full step and chords are drawn along the quadratic between the two velocities); a hole of 220 ms is a discontinuity and starts a second swing. The recording has no gap above 61 ms and Chrome Web Bluetooth gaps were never measured (R11), so this is a risk, not an observed failure. Suggested (a contract decision): a step above about 100 ms is a discontinuity for the CUT decision (no chords) while the cursor still moves (one constant, for example `cut.maxChordStepMs`).

### G4 (minor, NEW) A saturated stream leaves the blade in CUTTING and the game blind, without a tracking-lost

Verified (`tip-stream`: 10 samples at 500 deg/s, then 60 samples at 3000 deg/s, 2 s): every sample is ignored (`return` before `cutter.update`), so no `blade` event is emitted, `getState().cutting` stays `true` for the whole 2 s and `trackingOk` stays `true`, because `poll` measures `lastImuT`, which `pushImu` updates before the cap test. `cutter.cutting` also stays true, so the orientation filter keeps its trust weight at 0. The state ends at the first accepted sample below 0.65 T. Only a sustained |w| above 2190 deg/s triggers it (two clipped gyro axes at 2000 deg/s are enough: 2828), which a thrown or dropped sword could do; the recording's maximum is 1049. Fix: count consecutive ignored samples or the time since the last accepted one, and give `poll` that time instead of `lastImuT` (or call `cutter.dropCutting` after `trackingLostMs` of ignored samples).

### G5 (minor, NEW) The sword tuning page cannot read a swing below 150 deg/s, but the threshold goes down to 100

`ui.js` `stepTuning`: a swing starts only at `blade.speedDps >= UI_TIMING.tuneSwingMinDps` (150). `cutThreshold` can be set down to 100 (and the guide tells a weak wrist or a child to go to 100 to 150). A player whose flicks peak at 100 to 149 deg/s and cut at threshold 100 sees "Make a firm swing" and no "Last swing" for ever, on the one page meant to tune this. The meter bar itself is right; the verdict is not. A mutant of the constant is killed, so the test pins 150. Fix: `Math.min(tuneSwingMinDps, 0.9 * settings.cutThreshold)` (or 100). Also noted from round 1 and still true: the verdict and the red bar use the single-sample peak, while a real cut needs two samples at or above T at least 25 ms apart; a one-sample spike reads "Slices" and does not cut.

### G6 (minor, still open from round 1 F4) Once the idle glide runs, aiming at 9 to 14 deg/s does not move the cursor

Verified: `autoCenter` on, 1.2 s rest, then 9, 12 or 13.5 deg/s leftwards for 3 s: 0 px (the glide minimum of 120 px/s wins over the curve's 20 to 45 px/s); at 15 deg/s 136 px, at 25 deg/s 277 px. The contract states `idleBreakDps` 14, so this is as designed, but the intent ("does not fight") and the behaviour differ in this band. Options: stop the glide when the curve's cursor speed exceeds the glide speed, or lower `idleBreakDps` to about `deadDps + 3`.

### G7 (minor) Test gaps found by mutation (the implementation is right; the tests would not notice if it broke)

Survivors of the 100-mutant run that are not equivalent (the round 1 list F5 is mostly unchanged, because no test was added for it):

| Mutant (scratch copy only) | What it would break | Suggested test |
|---|---|---|
| `pointer.js` centre ramp removed (`ramp = 1`) | the 300 ms ramp of the idle glide (starts at full speed) | first glide step after the hold is below `centreMinPxS * dt` |
| `pointer.js` `centreMinPxS` removed from the clamp | the 120 px/s floor of the glide (the last 40 px would crawl) | arrival time from 30 px at default settings |
| `pointer.js` `planChords` speed not interpolated (`o.s1 * k`) | chord speed between the two sample speeds | monotone interpolation between `s0` and `s1` |
| `pipeline.js` `startCalibration` without `rel.reset()`; `cancelCalibration` without `rel.clearMotion()` | contract 2.7 (cursor to the centre, velocity memory cleared) | one pipeline test per call |
| `pipeline.js` minChord merge removed | sub-pixel chords at a screen edge emitted instead of merged | replay clamped at an edge, assert no segment shorter than 1 px |
| `pipeline.js` chords planned during a recentre ease (`interval` without `!outDisc`) | chords and trail samples along the true instead of the eased path | no `interpolated` ring sample between two samples that carry `discontinuity` during an ease |
| `pipeline.js` `maxGapMs` check on `dtMs` removed | the orientation filter then integrates holes of 200 ms and more in slices (the cursor is unaffected: `gapDisc` still nulls its step) | a 300 ms hole leaves the filter's tilt unchanged |
| `app.js` `RECENTER_BLOCK_DPS = 1e9` | the speed branch of the guard (only the `cutting` branch is tested) | press at 120 deg/s, not cutting |
| `app.js` BladeView `cutThreshold: cutThresholdDps * PXS_PER_DPS` without the factor | the trail ramps and the swoosh threshold read 300 instead of 1000 px/s | BladeView `cutThreshold` 1000 at Normal, 800 in Zen |
| `app.js` `markDiscontinuity('lost')` on `streaming -> lost` removed | the link-loss flag at app level | lose the link mid-stroke, assert the first sample after is a discontinuity |
| `app.js` `endRound()` without `setSettings({cutMul: 1})` | the Zen multiplier (0.8) would leak into menu and tuning cuts after a Zen round | after a Zen round, `getState().cutThresholdDps` is 300 again |
| `app.js` `speedDps` fallback (`ms.speed` without `/ PXS_PER_DPS`) | only for a pipeline that does not report `speedDps` | unit test with a stub pipeline |

Equivalent or near-equivalent survivors (no action): `RelativePointer.update` without `!this.have`, `AngularCutTracker.dropCutting` without `cand = null` (the next sample is a discontinuity), `poll` without `rel.clearMotion()` or `cutter.dropCutting` (same reason), the pitch-rate clamp (numerical safety only), `initFromAccel` without `confirmed = false` (`reset` already does it).

The tests that matter most (units of the curve, dead zone, hysteresis, retroactive chord, migration, storage ranges, the vertical axis and its sign and cap, the real-recording acceptance metrics) all fail when mutated: 80 of 100 mutants killed, the whole of `storage.js` (14 of 14) and the whole of the angular tracker except the equivalent one.

### G8 (minor, documents that disagree with the code)

1. `docs/motion-contract.md` 2.7, row "orientation filter, online bias, wizard": "in the relative model the filter is **not needed for pointing**". False since round F1 (2.9): the vertical axis reads the filter's gravity direction and `confirmed`. Same sentence in `docs/architecture.md` line 573 ("the pointer uses only the calibrated frame and the gyro"); `architecture.md` line 192 and contract D9 are right.
2. `docs/architecture.md` 6.8 (lines 599 to 620): the `pointer` literal lacks `centreArriveEventPx`, `maxTrailSteps`, `minChordPx`, `gravityVertical`, `verticalMaxPxDeg`, `gravityMinCos`; the `fusion` literal lacks `flatBandG`, `softTrustDps`, `bootS`, `bootTauS`, `gravityConfirmTrust`, `gravityConfirmTiltDeg`, `unconfirmedTauS`; two `cut:` keys appear in one literal (lines 610 and 615).
3. `docs/architecture.md` line 630 ("`headAt` clamps and never extrapolates more than 15 ms") and line 1672 ("max 15 ms extrapolation") are stale for the relative model (35 ms); lines 501, 606 and 1410 are right.
4. `docs/game-design.md` Appendix A line 1497 still lists `zenMul: 0.8` in the `cut` block; `MOTION_CONFIG.cut` has none (Zen is `CONFIG.modes.zen.cutMul`).
5. `docs/motion-contract.md` 3.6 specifies the 138-character `settings.migrated` toast; the shipped text is 43 characters (deviation D-S1, in `contract-notes.md` and the guide, not in the contract that "wins over other documents").
6. `docs/motion-contract.md` 2.4 says a dip keeps the candidate for at most 100 ms; in `angular-tracker.js` the bound is tested only on the dip samples (below T); a sample at or above T enters the cut whatever the time since the first one (for example a dip of 99 ms, then a sample above T). Harmless; word it or add the check.
7. `docs/GUIDE.md` 363 and 382 and README 172 state "about 5 px per degree slowly, about 14 in a fast swing" for the crosshair; since round F1 that is the HORIZONTAL axis; the vertical gain is capped at `6 x sensitivity` above about 80 deg/s. GUIDE 499 says it (the 40 % chop), the settings table does not. The same holds for the `tune.gain` line on the tuning page (the contract 2.9 admits it and leaves the string).
8. `tools/analyze-imu.mjs` (round 1 F6) still prints the contaminated whole-step means (rest bias -0.41 / -1.21 / +8.29 deg/s, "drift while still" -161 degrees, scale 0.578 / 0.935 / 1.314, return-to-start error 158.9 degrees) with no caveat; `docs/motion-findings.md` warns, the tool does not.

### G9 (minor, process and environment)

1. The round 1 review findings F1 to F9 have no entry in `docs/contract-notes.md`; G1, G2, G3, G6 and G8 (F7) are the same defects as before. Either fix them or record them as accepted deviations.
2. Three e2e tests (`art 5`, `perf`, `real-replay`) assert on frame rate and fail when headless Chrome is capped at 30 fps (verification round 2, m1). In this review's run they passed; that depends on the machine. They should skip, or scale to the measured blank-page rate.
3. Hot path, listed because the brief asks: `recent()`, `headAt()`, `getState()`, the BladeView and, per 33 Hz sample, `planChords` / `planTrail` / the trail objects allocate small arrays and objects (about 60 per second idle, about 1300 per second during a stroke); `rel.update` reuses its output object and `tipVelocity` its scratch. At these rates the garbage is negligible. No change needed.

## 2. What was checked and held

- **Units.** `tipVelocity` and the pitch rate in deg/s; `pointerSpeedPxS` in px/s; `BladeSample.speed` in px/s-equivalent (tip speed x 10/3) for samples, chords and trail; `speedDps` in deg/s; `cutThresholdDps` includes `cutMul`; the BladeView threshold is `x 10/3`; the px tracker threshold is `T x cutMul x 10/3`; the safety cap of the absolute model is `deg/s x pxPerDeg x sensitivity`. Consistent (the BladeView factor is untested, G7).
- **Dead zone and curve.** Radial, independent of sensitivity (tested at 0.3 to 2.0); the vertical gain is `min(curve, 6 x sens)`, identical to the horizontal one below 80 deg/s and continuous.
- **dt, NaN, divide by zero.** The relative step is entered only with finite accel and gyro; `dtMs` is `null` for a non-positive or hole step; `planChords` / `pathPoint` need `dtMs > 0`; `tip.s > 1e-6` guards the direction; `gravityPitchRate` guards `c > 1e-9`. A sample time equal to the previous one (burst) produces chords with `t0 == t1` and finite speed.
- **Hysteresis.** CUTTING ends on `s < 0.65 T`, a discontinuity, `poll` (200 ms without samples), `setCalibration`, `reset`, `startCalibration`; a threshold raised mid-swing is re-read every sample. The only way found to stay in CUTTING is G4. The idle glide has no way to stick: it ends above `idleBreakDps`, when cutting, within `quietMs` of a cut, with `autoCenter` off, at a hole or a reset.
- **State leaks.** `reset`, `setCalibration`, `startCalibration`, end of the wizard, `poll` (lost track), `cancelCalibration` after step 2 and the provider switch clear the cursor, the velocity memory, the cutter, the ease, the pending placement and the ring. `filter.confirmed` is false after every (re)initialisation. `cutter.reset()` restarts `swingId` at 1 (as the px tracker did).
- **Migration.** Hand-reasoned and mutation-checked: `v` missing, string or below 2 resets exactly `sensitivity` and `cutThreshold` and raises the notice; `v >= 2` keeps a stored `notice` only if it is `'motion-2'`; a save before the notice is acknowledged writes `v: 2` with the notice still pending, so a reload shows it again and never resets a second time; `ackNotice()` saves; overrides are never persisted; blocked, throwing or corrupted storage never throws.

## 3. Method notes

No VCS in the project directory. Mutation testing ran on a copy of `public/`, `test/`, `test-support/`, `tools/`, `docs/` (images linked) in the scratchpad, never on the owner's tree (the servers on 8200, 8210 and 8230 serve `public/` and were not touched). The fuzz and the repro scripts for G1, G3, G4 and G6 are in the scratchpad, not in the repository.
