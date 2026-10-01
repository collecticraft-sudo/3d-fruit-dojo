# Code review, round 1: the sword-tuning workstream (relative pointer, angular cut decision, storage v2, tuning screens)

Reviewer: senior code reviewer, 2026-09-30. Scope: `public/js/motion/**`, `ui/storage.js`, `ui/ui.js` (tuning and migration parts), `ui/screens/{settings,tuning,calibration}.js`, `ui/layout-data.js`, `ui/strings.en.js`, `app.js` wiring, `ninja-api.js`, the tests and `test-support` of this round, `tools/analyze-*.mjs` / `tools/replay-*.mjs`, and the documents.

Everything said about feel stays UNVERIFIED-ON-HARDWARE: nobody on the team has touched the real sword; the only ground truth is `recordings/imu-2026-09-30T18-42-24.jsonl`.

## 0. Verdict

**No critical and no major finding.** The motion core, the migration and the wiring do what the contract says, on the real recording and under fuzz. There are **9 minor findings**: two behavioural edge cases with a verified repro (F1, F2), two behaviour notes on the UI/centring (F3, F4), a cluster of test gaps found by mutation (F5), and documentation and tooling mismatches (F6 to F9).

| Check | Result |
|---|---|
| `npm test` | green: 1831 tests, 0 failed, 0 skipped (run on the unmodified tree; ports 8200, 8210, 8230 were not touched) |
| Migration v1 to v2 (11 hand-built documents, see 2.4) | correct: no double migration, no loss of `best`, `safetyAck`, `playMsTotal` or the other settings |
| Fuzz of the relative pipeline (400 runs x 400 samples, random gaps 0 to 400 ms, duplicates, NaN gyro, saturated samples, random calls of `setSettings`, `recenter`, `reanchor`, `markDiscontinuity`, `reset`, `setCalibration`, `startCalibration`, `poll`) | 0 violations: no NaN or out-of-field position, `segmentValid => cutting && !discontinuity` holds, the ring is chronological, every chord finite with positive speed and `t1 >= t0`, `headAt` finite and inside the field |
| Real recording with a wrong wizard bias (error of 1 to 4 deg/s in both directions on the tip axes) | hold windows stay within 10 px (at most 2 px up to 3 deg/s, 10 px at 4 deg/s): the 5 deg/s dead zone has the margin it claims |
| Mutation testing (73 single-line mutants of the implementation plus one no-op control, on a copy of the tree in the scratchpad, suites `test/{motion,app,ui,input}`) | 59 killed, 14 survived; of the 14, 3 are equivalent mutants and 11 are test gaps (F5); the control survived, as it must |

## 1. Findings

### F1 (minor) After a hole whose first sample is above the safety cap, the next sample integrates the whole hole and is not a discontinuity

`public/js/motion/pipeline.js`, `_relativeStep`, the `ignoredSince` branch (lines 713 to 725).

A sample above `safetyCapDegPerS` returns before `disc` is consumed, so a `gapDisc` or `nextDiscontinuity` that belonged to that sample is lost. The next accepted sample then gets `dtMs = t - this.rel.tPrev` with no upper bound and no discontinuity flag.

Verified repro (`tip-stream`, relative model, 60 deg/s rightwards, then `skip(1000)`, one sample of 3000 deg/s, then 60 deg/s again): the following sample has `dt = 1061 ms`, `discontinuity: false` and moves the cursor 338 px (400 ms hole: `dt = 461`, 147 px). While cutting, the same path would be delivered as chords. Trigger is rare (a saturated sample right after a hole), but the code contradicts contract 2.4 ("the next sample integrates over the device step from the last accepted one") as soon as the ignored sample carried a discontinuity.

Suggested fix: when the ignored sample had `disc` true, set `this.nextDiscontinuity = true` before returning; and apply `maxGapMs` to the repaired `dtMs` (`>= cfg.maxGapMs` gives `null`).

### F2 (minor) The recenter guard of `app.js` also applies to the simulator and the mouse, where `speedDps` is px-derived

`public/js/app.js` line 798 to 799: `if (b.cutting || b.speedDps >= RECENTER_BLOCK_DPS) lastFastAt = clock.now();`. For the aim path and the absolute model `BladeSample.speedDps = px/s / (10/3)`, so 100 "deg/s" is 333 px/s of cursor speed, not 100 deg/s of sword rotation.

Verified with the app harness (`?input=sim`, manual clock): mouse moved along x at 600 px/s for 400 ms, stopped, Space pressed 100 ms later: the log says `recenter press ignored` and nothing is recentred; at 200 px/s the press is accepted. The guard was written for the owner's grip on a real Joy-Con (the R button during a stroke), and only for the simulator it silently eats a keyboard recenter right after a fast mouse move (no toast, no sound). Low impact (the simulator is a development tool), but it is a unit mix-up: px-equivalent speed compared with a deg/s constant.

Suggested fix: apply the guard only when `provider.kind` is `joycon` or `native` (or compare `b.angularSpeedDps`, which is real deg/s and `null` for aim samples).

### F3 (minor) A hole of 90 to 199 ms during a cut is integrated as a normal step, then 200 ms and more breaks the cut: a cliff, and an invented path

`pipeline.js` `pushImu` (`maxGapMs` 200) and `_relativeStep`.

Verified with `tip-stream` (400 deg/s rightwards, one hole, 400 deg/s again): a hole that makes the step 90, 150 or 180 ms keeps ONE cut run, moves the cursor 499 to 688 px in that single step (clamped by the screen edge) and delivers 21 chords along the quadratic between the two velocities; a hole that makes the step 220 ms is a discontinuity and ends the cut. A bomb on the invented path explodes although nothing measured the sword there. The recording has no gap above 61 ms, and Chrome Web Bluetooth gaps were never measured (contract R11), so this is a risk, not an observed failure.

Suggested fix (a design decision for the owner of the contract): treat a step above about 100 ms (three periods at 33 Hz) as a discontinuity for the CUT decision (no chords, the cut ends) while the cursor still moves. The smallest change is one config constant, for example `cut.maxChordStepMs` (about 100), checked where `interval` is computed in `_relativeStep`.

### F4 (minor) Once the idle glide is running, deliberate slow aiming between 8 and 14 deg/s does not move the cursor at all

`pointer.js`, `RelativePointer.update`: once `centring` is true it only stops when `s1 > idleBreakDps (14)`, and the glide speed has a floor of `centreMinPxS` (120 px/s).

Verified (`tip-stream`, `autoCenter` on, rest 1.2 s, then push the tip left at v deg/s for 3 s from near the centre): at 9, 12 and 13.5 deg/s the cursor stays exactly at the centre (x 992 to 960) for the whole 3 s, whereas without the glide the same motion would move it about 60 to 130 px; at 15 deg/s it moves 151 px, at 25 deg/s 308 px. The pointer curve at 13.5 deg/s would give about 45 px/s, below the 120 px/s glide floor, so the glide wins until the sword exceeds 14 deg/s. The owner's slow aiming has a median of 41 to 50 deg/s, so this only bites for very slow, precise movements right after a rest, and contract 2.3 states the threshold, so it is "as designed"; but the contract's intent ("does not fight") and the behaviour differ in this band. Options: stop the glide as soon as the cursor velocity from the pointer curve exceeds the glide speed, or lower `idleBreakDps` toward `idleDps` plus the tremor margin (the trimmed rest windows of the recording stay below 5 deg/s, p99 4.9). Needs a feel decision on the sword.

### F5 (minor) Test gaps found by mutation (the implementation is right, the tests would not notice if it broke)

Survivors of the mutation run, with the contract or behaviour each would break:

| Mutant (all in a scratch copy) | What it breaks | Suggested test |
|---|---|---|
| `app.js` BladeView `cutThreshold: cutThresholdDps * PXS_PER_DPS` without the factor | D6: the trail ramps (T + 1200, T + 3000) and the swoosh threshold read 300 instead of 1000 px/s-equivalent | an app test that `snapshot/BladeView.cutThreshold` is 1000 at Normal and 800 in Zen |
| `pipeline.js` trail sample `speed: q.s` (no x 10/3) | interpolated ring samples 3.3x too slow in colour and audio | assert `speed === speedDps * 10/3` for `interpolated` ring samples (A6b checks other fields only) |
| `pointer.js` `planChords` speed not interpolated (`o.s1 * k`) | chord speed at the retroactive chord | assert monotone interpolation between `s0` and `s1` |
| `pipeline.js` `startCalibration` without `rel.reset()`; `cancelCalibration` and `_applyWizardParams` without `rel.clearMotion()` | contract 2.7 (cursor to the centre, velocity memory cleared) | one pipeline test per call |
| `pointer.js` centre ramp removed (`ramp = 1`) | the 300 ms ramp of the glide (the glide would start at full speed) | assert the first glide step after the hold is below `centreMinPxS * dt` |
| `pipeline.js` minChord merge removed (`if (false) continue`) | sub-pixel chords at a screen edge are emitted instead of merged | replay at a clamped edge and assert no segment shorter than 1 px |
| `app.js` `motion.markDiscontinuity('lost')` on `streaming -> lost` removed | link-loss flag at app level (the pipeline function itself is tested) | app test: lose the link mid-stroke, assert the first sample afterwards is a discontinuity |
| `app.js` `RECENTER_BLOCK_DPS = 1e9` | the 100 deg/s branch of the guard is untested: only the `cutting` branch is (the integrator's "mutation-checked" covers removal of the guard, not its speed limit) | a press at 120 deg/s that is not cutting |
| `pipeline.js` chords across a discontinuity (`interval` without `!outDisc`) | chords and interpolated trail samples planned during a recentre ease (the cutter discards the chords, but the trail samples would be pushed along the true cursor path, not the eased one) | assert no `interpolated` ring sample exists between samples that carry `discontinuity` during an ease |
| `pipeline.js` `poll`: `rel.clearMotion()` and `cutter.dropCutting()` removed | equivalent mutants in practice (`nextDiscontinuity` does the same on the next sample); listed for completeness | none needed |
| `pointer.js` dead-zone boundary `e < 0` instead of `!(e > 0)` | equivalent mutant (F is 0 at `e = 0`) | none needed |

Also worth saying about test design (not defects):
- A7 (head extrapolation) takes as truth the quadratic path between the next two real samples, which is the path the pipeline itself interpolates. It proves the predictor agrees with the interpolator (13 px mean), not with the real sword at 60 fps. Nothing in a 33 Hz recording can give the latter; the findings say so, the contract's "error" wording does not. Keep the "UNVERIFIED-ON-HARDWARE" label on it.
- The A1 and A5 windows (`hold_still` from 7 s, `return_still` from 2 s) were chosen after looking at the data; I replayed the wider windows (`hold_still` from 3 s, `return_still` from 0.5 s): cursor range at most 1 x 8 px, 0 % cutting, and the same with `autoCenter` on and off, so the choice does not hide a problem.
- Tuning and meter colour use the single-sample peak of the tip speed against the threshold ("Slices: above the threshold", bar turns red at `speed >= T`), but the real cut needs two samples at or above T at least 25 ms apart. A one-sample spike reads as "would cut" and does not. Not seen in the recording (tremor maximum 5 deg/s), so cosmetic.

### F6 (minor, tooling) `tools/analyze-imu.mjs` still prints the contaminated numbers without a caveat

`node tools/analyze-imu.mjs recordings/imu-2026-09-30T18-42-24.jsonl` prints a rest bias of (-0.41, -1.21, 8.29) deg/s, "drift while still" of -161 degrees, scale multipliers 0.578 / 0.935 / 1.314 and a return-to-start error of 158.9 degrees. Those come from whole-step means that include the owner handling the device. They contradict the clean values of `docs/hardware-findings.md` and `docs/motion-findings.md` (bias 0 / -0.31 / 0.73, drift 0.02 to 0.19 degrees in 8 s). `motion-findings.md` warns about it, the tool does not. Suggest a banner in the tool output ("whole-step means, contaminated; use `tools/analyze-motion.mjs`") or trimming as `analyze-motion.mjs` does.

### F7 (minor, docs) Stale sentences and gaps

- `docs/architecture.md` line 630 ("`headAt` clamps and never extrapolates more than 15 ms") and line 1672 ("`headAt(now)`, max 15 ms extrapolation") are stale for the relative model (35 ms, `pointer.extrapolateMaxMs`); lines 1410 and 606 are right.
- `docs/architecture.md` 6.8 shows two `cut:` keys in one literal (lines 610 and 615) and omits `pointer.minChordPx`, `pointer.maxTrailSteps` and `pointer.centreArriveEventPx`, which exist in `motion-config.js`.
- `docs/game-design.md` Appendix A (line 1497) still lists `zenMul: 0.8` in the `cut` block, while `MOTION_CONFIG.cut` has none (Zen comes from `CONFIG.modes.zen.cutMul`; architecture says "zenMul removed (A-02)").
- `docs/motion-contract.md` 3.6 still specifies the 138-character toast text of `settings.migrated`; the shipped text is the 43-character "Sensitivity and Slice threshold were reset." (deviation D-S1 is recorded in `contract-notes.md` and the guide, but the contract says it wins over other documents and section 8 does not mention it).
- `docs/motion-contract.md` 2.4 says a dip keeps the candidate for at most 100 ms; in `angular-tracker.js` the bound applies only to dips that stay below T, a sample at or above T after a dip of 99 ms (or one more sample) enters the cut. Harmless, but the wording and the code differ by one sample.

### F8 (minor) Docs note for the owner

`docs/GUIDE.md` tells the player that a press of the re-centre button is ignored while the blade moves; the README troubleshooting row for "cursor at the edge" still names ZR/ZL without the exception. Fine, but the same guard also fires for Space in the simulator (F2).

### F9 (minor, hot path) Allocations per frame

`recent()` (array of about 35 references), `headAt()` (one `{x, y}`), `getState()` and the BladeView object are allocated once per 60 fps frame; `planChords` / `planTrail` / `AngularCutTracker` allocate a few arrays and up to 32 + 7 small objects per 33 Hz sample. At these rates (about 60 small allocations per second for frames, about 1300 per second during a stroke) the garbage is negligible and the recorded browser run shows a 0.45 to 0.54 ms frame callback, so this is listed only because the review brief asks; no change needed.

## 2. What was checked and held

### 2.1 Units (px, deg, deg/s)
- `tipVelocity` signs reproduce the absolute model's convention on the identity frame (yaw right gives `vR > 0`, tip up gives `vU > 0`); `validateCalibration` enforces right-handedness, so `up = right x forward` is guaranteed.
- `BladeSample.speed` is px/s-equivalent (tip speed x 10/3) for IMU samples, chords and trail samples; `speedDps` is deg/s for all providers (px speed / (10/3) for the aim path and the absolute model). `cutThresholdDps` includes `cutMul`. The BladeView builds `cutThreshold` in px/s-equivalent. All consistent (except that the BladeView factor is untested, F5).
- The simulator's meter reads px-derived "deg/s" (8x the real rotation: 27.4 px/deg); it is documented as "deg/s-equivalent", not a bug.

### 2.2 Time, gaps, wrap
- Wrap: `report-stream.js` uses `(ts - prevTs) >>> 0` and accumulates `devMs`; nothing in `motion/` depends on the raw counter. Lost packets (60 ms) integrate normally and are not holes (`sample_gap` warns only above 100 ms); duplicates (`dt = 0`) and unknown steps integrate nothing without breaking the cut.
- `t` never goes backwards (`pushImu`), the ring stays chronological (fuzz), chords carry sample-time stamps and the game sorts by `t1`.

### 2.3 Cut decision and hysteresis
- No way found to stick in CUTTING: it ends on `s < 0.65 T`, on a discontinuity, on `poll` (200 ms without samples), on `setCalibration`/`reset`/`startCalibration`. A threshold raised mid-swing is re-read every sample. Zen (`cutMul` 0.8) reaches the relative cutter and the px tracker (mutants killed).
- Replay of the recording: 15/15 and 6/6 hard strokes cut, cut onset 30 ms, retroactive chord present, 0 % false cutting in every slow window at sensitivity 0.3, 1.0 and 2.0, identical CUTTING sequences. The alternate slow returns of `fast_swings_v` (peaks 101 to 229 deg/s) do not cut at 300, as the guide says.

### 2.4 Migration (storage v2)
Hand-built documents through `createStorage` with a Map backend: v1 with every setting changed (sensitivity 1.5, threshold 1400, volume, hand, flipX, autoCenter, dwell, lethal bombs, reduce flash), best scores for two modes, `safetyAck`, `playMsTotal` -> settings reset to 1.0 / 300 only, everything else kept, notice `motion-2`. A save before the notice is acknowledged (for example `addPlayMs`) writes `v: 2` with the notice still pending; a reload shows it again; after the player changes the two settings the reload keeps the new values (no second reset) and still shows the notice once; `ackNotice()` then clears it and a further reload is silent. String version `"1"`, missing settings block, a `v: 2` document with old-unit values (clamped to 700 / 0.3, no reset, stray notice dropped), no document, `[]` and a blocked backend: all as specified. The overrides (`?reducemotion`) are never persisted. Only one `createStorage` instance exists in the page (`app.js`).

### 2.5 Acceleration curve
`F(s)` is continuous and monotone (smoothstep ramp, zero at the dead-zone edge, derivative zero at the top of the ramp); the table of the contract reproduces to the px/s; the dead zone is radial and independent of the sensitivity; the trapezoid integration ends exactly at the same point as the quadratic chord path (mutants on both killed).

### 2.6 Hot-path and state leaks
`reset`, `setCalibration`, `startCalibration`, end of the wizard, `poll` (lost track) and the provider switch (`useProvider`: pointer model, accel sign, gyro scale, reset, `setCalibration(null)`) clear the cursor, velocity memory, cutter, ease, pending placement and ring. `lastFastAt` in `app.js` is not reset on a provider switch (at most 250 ms of carry-over, harmless).

## 3. Method notes

No VCS in the project directory, so the review read the files as they stand (timestamps of this round: 21:33 to 22:52). Mutation testing ran on a copy of `public/`, `test/`, `test-support/` in the scratchpad, never on the owner's tree (the servers on 8200, 8210 and 8230 serve `public/`). Scratch scripts (fuzz, replays with perturbed calibration, repros F1 to F4) are in the review scratchpad, not in the repository.
