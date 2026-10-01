# Motion verification, round 2 (independent verifier, 2026-10-01)

Scope: the sword-tuning round after the round-F1 fix (`docs/motion-contract.md` sections 0 to 9). The verifier re-ran the real recording `recordings/imu-2026-09-30T18-42-24.jsonl` through the real motion pipeline and through the real integrated app path with its own scripts, recomputed every acceptance metric of contract section 5.2, and stressed the result. The engineers' reference numbers were used only as the comparison column.

**Verdict: PASS.** No critical and no major finding. Every acceptance metric A1 to A11, A13 passes and matches the reference values (A12 and A14 are the engineers' suites, green). The controls never cut on slow aiming at the default threshold, never run away (constant 3 deg/s bias, 10 minutes of idle, jitter, loss, 0.5x and 2x playback, a cold start in the middle of a swing, continuous looping, 60 fuzzed sessions), the simulator and mouse providers behave, and the settings migration works from an old stored document. There are nine minor findings (section 7). One of them matters for "npm test is green": **3 of 1847 tests fail in this environment**, all frame-rate assertions in headless Chrome, which runs at 30 fps here even on a blank page (section 6). They pass with a frame-rate-uncapped Chrome.

Everything about how the sword feels is **UNVERIFIED-ON-HARDWARE** (one controller, one person, hand-timed steps, right side only, no wizard poses in the file). Nothing below says how the pointer feels.

## 1. How it was verified

- **Own scripts**, new, in `tools/verify-round-2/` (read-only with respect to the game). They were written from the contract text. `lib.mjs` has its own recording loader (real `parseInputReport`, device time from the microsecond counter), its own calibration, hard-stroke detector, stroke and path metrics, and replay driver; it imports only the public pipeline API (`createMotionPipeline`, `pushImu`, `poll`, `drainSegments`, `recent`, `headAt`, events), the real parser and the real validator. It does **not** import `test-support/motion/*`, `tools/replay-*.mjs` or `tools/verify-round-1/*`. The only reuse of engineer code is `runWindow()` of `test-support/app/replay-rig.js` as the harness that puts recorded hex through the fake BLE characteristic, the provider, `app.js`, the game and the UI with 60 fps frames; all metrics of `integrated.mjs` are computed by the verifier's code, and the report bytes (timestamps, gyro) are mutated by the verifier.
- Run them with `node tools/verify-round-2/<name>.mjs`: `metrics` (A1 to A10, A13), `a11` (cut state machine), `stress` (`jitter`, `speed`, `bias`, `idle`, `session`, `mounts`), `extra` (`mid`, `loop`, `fuzz`), `integrated` (app path with mutated reports), `hysteresis`, `glitch`, `elevation`, `wrap`, `sens`, `tail`, `thresholds`, `storage`, `raf`.
- Own calibration: gyro bias is the median of `rest_table` from 4 s on = (0.00, -0.31, +0.73) deg/s (the same as the contract's raw 0, -5, +12 LSB); identity frame, sign +1, scale 1, `accelG0` 1. Windows are replayed one at a time from a fresh pipeline (the countdowns between steps are not in the file).
- Recording re-measured: 4744 reports, all with the IMU active; device step median 30.00 ms, p99 31.25, max 61.25, nine steps above 45 ms; 33.3 Hz. Hard strokes re-detected from the contract definition: **15** in `fast_swings_h` (peaks 693.7 to 1048.5 deg/s), **6** in `fast_swings_v` (632.0 to 962.1). Both counts match the contract.
- Browser checks ran on a server started by the verifier on port 8245 (`PORT=8245 node server.js`), stopped at the end; its localStorage was cleared. The servers on 8200, 8210 and 8230 and every process of other agents were not touched. `public/` was not touched: the SHA-1 of the sorted list of file hashes of `public/` (198 files) is the same before and after the full `npm test` (975e8e7d...).

## 2. Acceptance metrics A1 to A14, recomputed

All from a fresh pipeline per window, default settings (sensitivity 1.0, threshold 300 deg/s, auto-centre on), `check: true` (every BladeSample and BladeSegment passed the project validator: 0 violations in every replay).

| # | Metric | Verifier's number (pipeline alone) | Integrated app path (verifier's `integrated.mjs`, Classic round) | Pass criterion | Result |
|---|---|---|---|---|---|
| A1 | hold_still 7 s+, return_still 2 s+ | 0.0 x 0.0 px and 0.0 x 0.0 px, CUTTING 0 % | 0.0 px, 0 apples cut of the 128 hung under the cursor in the four slow windows | <= 10 px, 0 % | PASS |
| A2 | yaw sweep 1..21 s; pitch sweep 1..21 s | yaw x 55.5 %, y 22.3 %, boundary 0.0 %; pitch y 26.4 %, x 2.7 %, boundary 0.0 % | same (engineers' tool prints the same) | yaw x 35..80 %, y <= 50 %; pitch y 15..40 %, x <= 10 %; boundary <= 5 % | PASS (the yaw y range 22.3 % is the F1 value, reference 30.7 % before F1) |
| A3 | false CUTTING, six slow windows at sensitivity 0.3, 1.0, 2.0; yaw+pitch combined | 0.00 % everywhere; sequences identical sample by sample at the three sensitivities | 0 of 128 apples, worst CUTTING 0.00 % | < 2 %, identical | PASS |
| A4 H | hard strokes that cut (CUTTING within 60 ms of the peak, segments cover >= 50 % of the cursor path) | 15/15, path share median 95.1 %, min 86.4 % | 15/15, 93.4 % / 85.2 %, the game cut 15 of 15 hover apples | >= 90 %, median >= 80 %, min >= 60 % | PASS |
| A4 V | same | 6/6, median 86.6 %, min 84.0 % | 6/6, 84.5 % / 81.9 %, the game cut 6 of 6 | same | PASS (lower than the pre-F1 90/87, see finding m4) |
| A5 | idle auto-centre from (60,60), (1860,540), (960,1040), (1100,600) | within 100 px after 2.50 / 2.35 / 1.84 / 1.33 s, within 20 px after 3.01 / 2.86 / 2.35 / 1.87 s; one `auto` event per run; `autoCenter: false`: 0.0 px | identical times, one event each | <= 3.0 s and <= 3.6 s | PASS |
| A5b | `refDriven` while cutting or tip speed > 21 deg/s (yaw, pitch, fast_h, fast_v) | 0 of 1818 samples | 0 (engineers' tool) | 0 | PASS |
| A6 H | no tunnelling | longest chord 61.2 px; 0 contiguity gaps inside cut runs; worst distance of the 1 ms dense path to the chords 3.6 px; `recent()` spacing max 7.81 ms (also across a lost packet); largest cursor step 409.6 px; peak cursor speed 14,335 px/s | 61.2 px, 0 gaps, 3.6 px | <= 96 px, 0 gaps, <= 12 px, <= 8.5 ms, <= 450 px | PASS |
| A6 V | same | 53.8 px, 0, 4.6 px, 7.81 ms, 225.3 px, 5,816 px/s | 53.8 px, 0, 4.6 px | same | PASS (the vertical step is smaller since F1: the vertical gain is capped) |
| A7 H | head extrapolation error at 60 fps (phases 0.2 to 1.0 of a sample interval, truth = quadratic path to the next sample) | mean 10.6 px, p95 40.8, max 100.0 (hold-last 101.5 / 314.5 / 409.6) | mean 3.6, p95 17.0 (real 60 fps frames) | mean <= 20, p95 <= 60 | PASS |
| A7 V | same | mean 11.4, p95 52.8, max 102.8 (hold-last 41.7 / 118.0 / 225.3) | mean 4.1, p95 18.7 | same | PASS |
| A8 | posture change (30 + 20 degrees) | 130.7 px from the centre 300 ms after (accelerometer rotated consistently with the injected rotation) and 131.6 px (accelerometer untouched) | 131.7 px (dx -113.8, dy -66.3) | <= 250 px | PASS |
| A9 | cut onset | H median 30.0 ms, max 31.3; V 30.0 / 30.0; retroactive chord 15/15 and 6/6 | the same | <= 35 ms, chord present | PASS |
| A10 | curve and direction (constant rates through `pushImu`) | speed equals the contract table to 0.00 px/s at tip speeds 5, 6, 10, 30, 100, 300, 1000 and sensitivity 0.6, 1.0, 1.5 (16 unclamped cases); yaw right dx +22.8 px, pitch up dy -22.8, roll 200 deg/s for 3 s moves 0.00 px, `flipX` mirrors, 4.9 deg/s for 10 s gives 0.00 px, 5.5 deg/s gives 24.98 px | - | within 1 px/s and the stated tolerances | PASS |
| A11 | cut state machine (synthetic tip-speed profiles, `a11.mjs`) | 290 never cuts; 310 for two samples cuts; one sample at 600 never cuts; 600-250-600 keeps the candidate; dip to 210 keeps the swing; 190 ends it; re-entry within 100 ms keeps `swingId`, after 150 ms starts a new one; `cutMul` 0.8 gives 240; a 60 ms gap inside a stroke does not break it; 33, 67 and 250 Hz enter 30, 30, 28 ms after the first fast sample; raising the threshold mid-swing keeps `swingId` | - | as stated | PASS (15 of 15 checks) |
| A12 | simulator, mouse, debug swings unchanged | suites `test/motion`, `test/input`, `test/app`, `test/ui`: all green in the full run (section 6); real-page checks in section 4.3 | - | green | PASS |
| A13 | cursor height under sustained slashing, sensitivity 1.0 | H whole step: CUTTING samples in y 270..810 **94.4 %**, median y 681 (cutting 664), bottom edge 0.0 %, lowest 180 px 0.0 %, net vy +92 px. V from 0.6 s: CUTTING median y 322, median y 528, edge 0.0 %, net -11 px, stroke spans 370 to 431 px | - | H >= 75 %, V cutting median <= 750, edge <= 3 %, low <= 15 %, net <= 800 / 500, span >= 250 | PASS |
| A13 | sensitivity 0.6 and 2.0 | 0.6: H 100 % in the middle half, edge 0.0 %; V 100 %. 2.0: H 65.6 %, bottom edge 1.9 %, lowest 180 px 21.2 %; V 52.2 % | - | >= 50 % in the middle half, <= 5 % on the bottom edge (H) | PASS |
| A14 | vertical model unit and physical tests | `test/motion/gravity-vertical.test.js` green in the full run; plus the verifier's independent check below | - | as in the test names | PASS |

Independent physical cross-check of the vertical axis (`elevation.mjs`): the elevation of the blade axis (device +y) from the **accelerometer** at calm samples (|a| within 0.06 g of 1, under 40 deg/s), independent of the pipeline, against the cursor height. `pitch_sweep`: 223 calm samples over 65.8 degrees of elevation, correlation of cursor y with elevation **-1.00**, slope **-4.70 px/deg** (the expected effective gain at 40 deg/s is 4.3 to 5). Pitching up moves the cursor up, exactly as a function of where the sword points. (This holds under the assumed accelerometer convention, +1 g towards up; see finding m9.)

Whole recording as one continuous session (steps chained with 30 ms and with 3 s between them): 0 violations, no warning, 3 `auto` recentres, CUTTING 0.0 % in every slow step. Two samples at the very start of `rest_table` cut (the owner picking the sword up); fast steps: `fast_swings_h` CUTTING 19.2 %, edge 15.0 %; `table_spin_360` (four full turns flat on a table) sits on an edge 80.7 % of the time, as any relative pointer must.

## 3. Stress tests

### 3.1 Timestamp jitter and lost packets (`stress.mjs jitter`, 8 seeds per case: both fast steps, six slow windows, a corner glide)

| Case | Hard strokes cut H / V (worst seed) | Path share median / min | Worst false CUTTING | Hold range | Corner to within 20 px | Longest chord | Violations |
|---|---|---|---|---|---|---|---|
| no jitter, no loss | 15/15, 6/6 | 93.8 / 84.0 % | 0.00 % | 0.0 px | 3.01 s | 61 px | 0 |
| 2 % lost | 15/15, 6/6 | 93.8 / 71.7 % | 0.00 % | 0.0 | 3.01 to 3.07 s | 74 px | 0 |
| device jitter sigma 2 ms + 2 % lost | 15/15, 6/6 | 94.3 / 66.3 % | 0.00 % | 0.0 | 3.01 to 3.02 s | 74 px | 0 |
| device jitter sigma 5 ms + 2 % lost | 15/15, 6/6 | 94.3 / 66.8 % | 0.00 % | 0.0 | 2.99 to 3.02 s | 76 px | 0 |
| device jitter sigma 10 ms + 2 % lost | 15/15, 6/6 | 93.8 / 67.9 % | 0.00 % | 0.0 | 2.96 to 3.01 s | 71 px | 0 (`sample_gap` warnings) |
| arrival jitter sigma 8 ms (time of arrival only) + 2 % lost | 15/15, 6/6 | 93.8 / 65.9 % | 0.00 % | 0.0 | 3.01 s | 77 px | 0 |
| arrival-dt fallback (`dtSource: 'arrival'`), sigma 5 ms + 2 % lost | 15/15, 6/6 | 94.3 / 66.8 % | 0.00 % | 0.0 | 2.98 to 3.01 s | 76 px | 0 (`dt_fallback` warnings, as designed) |
| 10 % lost | 15/15, 6/6 | 93.8 / 71.4 % | 0.00 % | 0.0 | 2.98 to 3.07 s | 81 px | 0 |

The longest chord stays under the 96 px bound in every case; the horizontal cutting samples stay in the middle half of the height (minimum over seeds 87 to 95 %). The same mutations on the **integrated app path** (hex bytes rewritten: device timestamp, arrival time, loss; `integrated.mjs`): device jitter 5 ms + 2 % lost and arrival jitter 8 ms + 2 % lost both give 0 of about 129 apples cut under slow aiming, hold range 0.0 px, strokes 15/15 and 6/6, the game cutting 15 of 15 and 6 of 6 hover apples, longest chord 66 to 69 px, no app warnings.

### 3.2 Playback speed (`stress.mjs speed`, `integrated.mjs`)

| Case | Result |
|---|---|
| timing only, 0.5x (time x2, rates unchanged, 16.7 Hz) | strokes 15/15 and 6/6, 0 % false cutting in all six slow windows, longest chord 66 px; integrated path the same (with `low_sample_rate` warnings at 15 to 16 Hz, as designed) |
| timing only, 2x (time x0.5, rates unchanged, 66 Hz) | strokes 15/15 and 6/6, 0 % false cutting, longest chord 56 px |
| **physical 0.5x** (time x2 and rates x0.5: a slower swinger) | strokes H 15/15, **V 5/6**, path share median 81.9 %; 0 % false cutting. The one lost vertical stroke has a physical peak of 316 deg/s and only one sample above 300 at 16.7 Hz, so the two-sample rule rejects it (contract risk R2, not a defect) |
| **physical 2x** (time x0.5 and rates x2: a faster swinger) | strokes 15/15 and 6/6, path share median 99 to 100 %; yaw sweep CUTTING 8.8 % and table spin 18.4 %, against an oracle of 11.5 % and 16.2 % of samples whose real angular speed is at least 300 deg/s: that is fast motion, not a false cut. Hold range 1.2 px. One `gyro_saturated` warning (a sample above 2190 deg/s) |

### 3.3 Constant gyro bias, long idle (`stress.mjs bias`, `idle`)

- **3 deg/s of uncorrected bias** (calibration bias 0) on synthetic table data (noise 0.12 deg/s, 120 s), all 26 sign combinations of (+-3, +-3, +-3): the cursor does not move at all (0.00 px), with auto-centre on or off, because the tip speed stays under the 5 deg/s dead zone (worst combination 4.24). The same with the sword at 60 degrees of elevation, upside down, on its side, nose down 80 degrees (the gravity frame of the vertical axis): 0.00 px.
- The same 3 deg/s added on top of the **real hand tremor** (262 s of looped `hold_still` and `return_still`): with auto-centre on the largest distance from the centre is 0.0 to 1.6 px; with auto-centre off 4.9 to 304 px after 262 s (1.2 px/s in the worst sign combination, nothing runs away; see finding m5). The online bias estimator corrects a 3 deg/s bias on a table (3.00 -> 0.00 in 60 s) but never while the sword is hand-held, by design.
- **Long idle:** 10 minutes of synthetic tremor (about 2.3 deg/s rms) from (60,60), (1860,1040) and (1860,60): within 20 px after 3.00 to 3.03 s, afterwards the median distance is 0.2 px and the largest excursion 17 to 19 px, exactly one `auto` event, 0 CUTTING samples. From the centre: 0.5 px, no event. 170 s of real tremor looped from three corners: within 20 px after 3.01, 3.01 and 2.35 s, largest excursion after that 18 to 20 px, one event. After `fast_swings_h` followed by 12 s of hold: the last CUTTING sample at 13.77 s, the cursor then at (549, 619), within 20 px of the centre 3.59 s after the last cut (0.5 s quiet + 1.0 s hold + the glide).

### 3.4 Robustness beyond the brief (`extra.mjs`, `stress.mjs mounts`, `wrap.mjs`)

- **Fuzz:** 60 sessions, 36,000 samples (duplicates, 250 ms and 1.5 s holes, backwards time, 5 ms steps, NaN and Infinity in the gyro, NaN, zero, 8 g and 1e6 in the accelerometer, 1e5 deg/s gyro, random `markDiscontinuity`, `recenter`, `reanchor`, `setSettings`, `poll(+400)`, `setCalibration(null)`; every sixth session in the absolute model): 0 exceptions, 0 non-finite values, 0 positions outside the field, 0 validator violations.
- **Mount invariance on real data:** the recorded gyro and accelerometer rotated into all 24 proper cube rotations with the matching calibration frame: the cursor differs from the identity mount by **0.00 px** and the CUTTING flags by 0, in `fast_swings_h`, `fast_swings_v`, `yaw_sweep`, `pitch_sweep`. The accelerometer negated together with `setAccelSign(-1)`: 0.00 px.
- **Device clock wrap:** the 32-bit microsecond timestamp wraps every 71.6 minutes; replayed through the integrated path with the wrap 4 s into the window: the cursor and the CUTTING flags are identical to the unwrapped run (yaw sweep, fast swings, hold).
- **Cold start in the middle of swinging** (the pipeline starts cold at 40 random offsets of `fast_swings_h` and `fast_swings_v`, 6 s each, like a reconnection during play): no exception, no non-finite value, no position outside the field; median y after 2 s is 563 (horizontal slashes; warm whole step 681), p10 to p90 354 to 925. The tail is finding m3.
- **Continuous play** (the two swing steps repeated 30 times in a row, with 30 ms and with 1.5 s between repetitions): the cursor height converges to a fixed value (for example 372 or 914 after the third repetition) and stays there; no drift to an edge over 30 repetitions (bottom-edge share 0 to 5 % per repetition).
- **Horizontal gain hysteresis** (contract risk R14, never measured): the real forward strokes kept, the return strokes slowed by 2, 3 and 5 (`hysteresis.mjs`). Net x path of the cursor over the 15 strokes: -811 px as recorded (the owner also turned about 330 degrees net), +60 (x2), +1167 (x3), +4350 (x5): a slow return leaves about 100, 220 and 570 px per cycle in the direction of the fast leg. Repeated 10 times in a row the cursor does **not** run away: the median x settles at 1058 (x2) and 1182 (x3) after the first repetition, edge share 11 %. Only at x5 do CUTTING samples sit on an edge 41 % of the time in one pass. So the hysteresis is a bias of 100 to 200 px in the median cursor position for plausible asymmetric play, not a runaway.
- **One corrupted gyro sample** (`glitch.mjs`): above the 2190 cap the pointer ignores it but the orientation filter has integrated it, so the vertical axis is off for a while: max cursor error 74 px (pitch sweep), 94 px (yaw), 125 px (fast slashes), still 69 px at the end of an 18 s window. A sample below the cap (1500 deg/s) moves the cursor by the integral of the glitch (up to 390 px, contract R8) and it stays until the idle glide. Not seen in 4744 real reports. Finding m8.
- **Chord of the leaving interval** (`tail.mjs`): the chord of the interval that ends at the leaving sample is not delivered by design; on the real strokes it is 56 px median, 86 px p90, 92 px max (H) and 36 / 56 / 64 px (V). The trail still draws it. Finding m7.

### 3.5 The owner's remark (3), the sensitivity range (`sens.mjs`)

The owner's own 20 s sweeps (100 degrees peak to peak yaw, 66 degrees pitch):

| Sensitivity | Yaw sweep, share of the width | Pitch sweep, share of the height |
|---|---|---|
| 0.3 (new minimum) | 16.7 % | 7.9 % |
| 0.6 | 33.3 % | 15.9 % |
| **1.0 (default)** | **55.5 %** | **26.4 %** |
| 1.5 | 83.3 % | 39.7 % |
| 2.0 | 100 % (boundary 3.2 %) | 52.9 % |
| old model at its old minimum 0.5 | 74.2 % (boundary 0 %) | 63.2 % (boundary 9.5 %) |
| old model at the old default 1.0 | 100 % (boundary 25.7 %) | 90.8 % (boundary 34.3 %) |

## 4. Providers and settings

### 4.1 Threshold table (owner's remark 2; `thresholds.mjs`)

False CUTTING share in the six slow windows and hard strokes cut, per threshold (tip speed, deg/s, before the mode multiplier):

| Threshold | hold / return | yaw | pitch | roll | table spin | Strokes cut H / V |
|---|---|---|---|---|---|---|
| 100 (range minimum) | 0 / 0 % | 26.89 % | 0 % | 0 % | 61.12 % | 15/15, 6/6 |
| 150 | 0 / 0 | 11.63 | 0 | 0 | 21.38 | 15/15, 6/6 |
| 200 | 0 / 0 | 4.38 | 0 | 0 | 4.32 | 15/15, 6/6 |
| 225 (Easy) | 0 / 0 | 2.27 | 0 | 0 | 1.73 | 15/15, 6/6 |
| 240 (Zen, 300 x 0.8) | 0 / 0 | 1.81 | 0 | 0 | 1.08 | 15/15, 6/6 |
| **300 (Normal, default)** | 0 / 0 | **0** | 0 | 0 | **0** | 15/15, 6/6 |
| 450 (Hard) | 0 / 0 | 0 | 0 | 0 | 0 | 15/15, 6/6 |
| 600 | 0 / 0 | 0 | 0 | 0 | 0 | 14/15, 5/6 |
| 700 (range maximum) | 0 / 0 | 0 | 0 | 0 | 0 | 14/15, 1/6 |

Normal and Hard: 0.00 % false CUTTING and every hard stroke cut. Easy and Zen cut 1 to 2.3 % of the owner's most vigorous aiming (finding m2). On the integrated path in a Zen round (threshold 240) 8 of the 48 apples hung under the cursor during the yaw sweep are cut; in a Classic round (300) 0 of 48.

### 4.2 Simulator provider (real page, `?input=sim&clock=manual`, Classic round, a watermelon at the apex, `__ninja.simSwing` through the real sim provider)

`pointerModel: 'absolute'`. The cursor ends within 20 px of the commanded target. Threshold 300: commanded glides of 400, 600 and 833 px/s do not cut, 1250, 2000 and 3333 cut (the eased glide peaks at about 1.57x its mean speed); threshold 225: 400, 500, 650 no, 900, 1500 yes; threshold 450: 900, 1100, 1300 no, 1800, 2500 yes. Sensitivity scales the absolute mapping as contracted: a 700 px glide ends at x 819, 1029, 1313 and 1920 at sensitivity 0.3, 0.6, 1.0 and 2.0 (finding m6).

### 4.3 Mouse provider (real page, `?input=mouse&clock=manual`, real `pointermove` events on the canvas at 8 ms steps of the manual clock, a watermelon hung on the path)

Threshold 300: 400, 500, 650, 800, 950 px/s do not cut; 1050, 1100, 1500, 3000 cut. Threshold 225: 600 and 700 no; 800 and 1000 yes. Threshold 450: 1300 and 1450 no; 1600 and 2000 yes. The converted thresholds are exactly the contract's 750 / 1000 / 1500 px/s. (A first trial that started by teleporting the cursor from the centre across the fruit cut it: a 560 px jump in one event is a real flick, not a defect.)

### 4.4 Settings migration (`storage.mjs`, then the real page)

- **Real page:** a stored `{ v: 1, settings: { sensitivity: 1.5, cutThreshold: 1400, volume: 0.3, hand: 'left', flipX: true, autoCenter: false, reduceFlash: true, lethalBombs: true }, best: {classic 1234, zen 77}, safetyAck: true, playMsTotal: 123456 }` loads with sensitivity 1.0 and cutThreshold 300 and every other setting, both high scores, the safety acknowledgement and the play time intact. The menu shows the toast "Sensitivity and Slice threshold were reset." once; the stored document is rewritten as `v: 2, notice: null`; the next load shows no toast. The Settings screen reads "Slice threshold 300 °/s (Normal)", "Blade speed: 0 °/s"; the Sword tuning screen has the new preset rows (Relaxed / Standard / Fast, Easy / Normal / Hard).
- **Module:** the owner's old defaults (1.0 / 1000), old minimum (0.5 / 400), old maximum (2 / 2400), a document without `v`, and `v: "1"` all reset the two settings once with the notice `'motion-2'`, keep everything else, write nothing on load, and after `ackNotice()` the document is `v: 2, notice: null` and a second load has no notice. A `v: 2` document is read as is (1400 clamps to 700, sensitivity 9 to 2.0), keeps a stored notice, and `v: 3` is not downgraded. Corrupted JSON, `[]`, `null` and a number give defaults and no notice; no storage at all keeps working from memory. `updateSettings({ cutThreshold: 113 })` snaps to 125, sensitivity 0.05 to 0.3.

## 5. The owner's four remarks against the data

1. **Gyro "not used", constant re-centring.** The real sensors use the gyro only for the horizontal axis (local frame) and the gyro plus the gravity direction for the vertical axis. A 30 + 20 degree posture change moves the cursor 131 px (A8, pipeline and integrated path); hold still gives 0.0 px over 20 s; slow sweeps never touch an edge; the vertical axis is an exact function of the accelerometer elevation during slow pitching (r = -1.00); continuous slashing keeps the cutting samples in the middle half of the height (94 %). Residual: a cold start in the middle of vigorous play references the cursor to the pose at that moment (m3).
2. **Cut threshold far too low.** Decided in tip speed, 300 deg/s by default with hysteresis and a minimum duration; 0.00 % CUTTING in every slow step at Normal and Hard, 21 of 21 hard strokes cut with an onset of 30 ms, independent of the sensitivity (identical sequences at 0.3, 1.0, 2.0 in the pipeline and the integrated path). Easy (225) and Zen (240) still cut 1 to 2 % of the owner's most vigorous aiming (m2).
3. **Sensitivity far too high even at minimum.** Minimum 0.3 covers 16.7 % of the width for the owner's own sweep (the old minimum 74 %); the default covers 55.5 %.
4. **Connection.** Not in scope of this round; the native e2e tests pass in the full run.

## 6. Test suites

`npm test` was run in full by the verifier once: **1847 tests, 1844 pass, 3 fail** (123 s; other agents were running heavy jobs on the same machine, load average 15 to 57). Everything in `test/{shared,input,motion,game,render,audio,ui,architecture,server,app,bridge,assets}` passes, and every e2e file except three tests:

| Failing test | Assertion | Cause |
|---|---|---|
| `e2e art 5` | `degradeLevel` 3 instead of 0 | the game degrades its effects because the frame rate is 30 fps |
| `e2e 14: performance smoke` | average frame interval 33.3 ms above the 33 ms hard limit | rAF runs at 30.0 fps |
| `e2e real recording` | `frames > 300`: 251 frames in 8 s | rAF runs at 30.0 fps |

All three fail again when run alone with `--test-concurrency=1`. **The cause is the environment, not the motion work:** `tools/verify-round-2/raf.mjs` launches the suite's own headless Chrome (154.0.8037.58) on `about:blank` and measures requestAnimationFrame at **30.4 fps** (30.2 with `--enable-gpu` or `--disable-gpu`); with `--disable-frame-rate-limit` it measures 57 fps. Run with `CHROME_PATH` pointing at a wrapper script (in the scratchpad, nothing in the project changed) that adds `--disable-frame-rate-limit`, `art 5`, `perf` and `real-replay` all pass (9 of 10 tests in those files pass; the tenth, `art 6`, a timing test of the 2.5 s boot wait, failed once in that configuration under a load average of 37 and passes in the plain configuration). In the failing real-replay runs every motion assertion before the frame count had passed and printed the expected numbers: Classic slow 0 cuts, 0 swings, peak 207 deg/s; Classic fast 15 swings, 10 cuts, CUTTING 18.7 % of the frames; Zen slow 0 cuts; Zen fast 15 swings, 14 cuts, 20.7 %. So "npm test is green" is **not confirmed in this environment** (finding m1), and is confirmed for everything except frame-rate assertions.

## 7. Findings

| # | Severity | Finding |
|---|---|---|
| m1 | minor | Three e2e tests hard-fail when headless Chrome runs at 30 fps (section 6): `art 5`, `perf`, `real-replay` assert on frame rate and `degradeLevel` instead of skipping or scaling. On this machine a blank page gets 30.4 fps, so `npm test` is 1844/1847 here. They pass with an uncapped frame rate. Re-run the suite on the owner's Mac (or set `CHROME_PATH` to a wrapper that adds `--disable-frame-rate-limit`) before calling it green. |
| m2 | minor | Easy (225 deg/s) and Zen (300 x 0.8 = 240) still cut on the owner's most vigorous aiming: yaw sweep 1.81 %, table spin 1.08 % at 240; 2.27 % and 1.73 % at 225; in an integrated Zen round 8 of 48 apples hung under the cursor during the yaw sweep are cut (0 of 48 in Classic). Known and accepted in the contract and by the integrator; the owner asked for Easy about 200. If the owner still feels Zen cuts too easily, raise the Zen multiplier, not the default. |
| m3 | minor | A (re)connection in the middle of vigorous swinging references the cursor to the pose at that moment, so continuous slashing afterwards can sit in the wrong part of the screen until the sword rests for 1.5 s (idle glide) or the player recentres: over 40 cold starts the median y after 2 s is 563 (p10 354, p90 925), and the worst start keeps 98.5 % of the next 4 s in the lowest 180 px. Median case fine. |
| m4 | minor | Vertical chops cover only 36 to 40 % of the screen height since F1 (stroke spans 370 to 431 px; R13, accepted), and the vertical step's path share dropped from 90 / 87 % to 86.6 / 84.0 % (median / min), still above the pass line. |
| m5 | minor | An uncorrected 3 deg/s bias plus real hand tremor makes the cursor creep up to 1.2 px/s (304 px in 262 s) **only with the auto-centre setting off**; with it on the excursion is at most 1.6 px. The bias estimator does not run while the sword is hand-held. Risk R10, unchanged. |
| m6 | minor | The simulator uses the sensitivity as the scale of its absolute mapping (contract 2.6), so at 0.3 a virtual-mouse glide of 700 px moves the cursor 210 px and the virtual sword no longer aims where the mouse points. Only `?input=sim` is affected; a consequence of the widened range. |
| m7 | minor | The chord of the interval that ends at the leaving sample is never delivered (contract 2.4): median 56 px, p90 86 px, max 92 px at the end of a horizontal cut run (36 / 56 / 64 px vertical). A fruit touched only in those last pixels is missed although the trail is drawn through it. |
| m8 | minor | One corrupted gyro sample above the safety cap is ignored by the pointer but integrated by the orientation filter, leaving a vertical error of up to 125 px for seconds; one below the cap moves the cursor permanently until the idle glide (R8). Not seen in the 4744 real reports. |
| m9 | minor (risk, UNVERIFIED-ON-HARDWARE) | The vertical axis now depends on the accelerometer convention (R12): the direction was verified against an independent accelerometer elevation under the assumed convention (+1 g towards up), but nothing in the recording tells which convention the physical controller uses. With the wrong convention pitching up would move the cursor down (tested by negating the recorded accelerometer without telling the pipeline: 0 to 12 % of the samples agree with the right direction instead of 88 to 100 %). The wizard's frame and `?accelsign=-1` are the only handles. The owner's first test with the wizard moved the cursor the right way. |

Also recorded, not findings: the migration toast reads "were reset" without saying to what (deviation D-S1, round 1 F3); the game's own tail and horizontal hysteresis behaviours are as described in 3.4.

## 8. Not verified

The feel on the sword; the Left controller; other people's swings (a swinger under 300 deg/s at the tip cannot cut at Normal, R2); the wizard's mount and sign on the real sword; Web Bluetooth rate and latency; the physical accelerometer convention; how the owner's real hand behaves in tense play; the e2e suite at 60 fps in the default configuration (section 6). Everything here is one controller, one person, hand-timed steps.
