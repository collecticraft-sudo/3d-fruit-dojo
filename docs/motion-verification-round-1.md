# Motion verification, round 1 (independent verifier, 2026-09-30)

Scope: the sword-tuning round (`docs/motion-contract.md`). The verifier re-ran the replay of the real recording `recordings/imu-2026-09-30T18-42-24.jsonl` through the real pipeline with its own scripts, recomputed every acceptance metric of contract section 5.2, and stressed the result. The engineers' numbers were used only as the comparison column.

**Verdict: FAIL.** One major finding (F1). Every acceptance metric A1 to A9 passes and matches the reference values, nothing crashes, nothing cuts on slow aiming, nothing runs away. The major finding is about what the relative pointer does to the cursor position during sustained vigorous swinging, which no contract metric measures and which is the owner's complaint (1) in a new form.

Everything about the feel on the sword is **UNVERIFIED-ON-HARDWARE** (one controller, one person, hand-timed steps, right side only). Nothing below says how the pointer feels.

## 1. How it was verified

- Scripts: `tools/verify-round-1/*.mjs` (new, read-only with respect to the game; `node tools/verify-round-1/baseline.mjs` and so on). They were written from the contract text and use only the public pipeline API (`createMotionPipeline`, `pushImu`, `poll`, `drainSegments`, `recent`, `headAt`, events) and `parseInputReport` from `public/js/input/joycon2-parse.js`. They do not import the engineers' test helpers (`test-support/motion/*`) or `tools/replay-*.mjs`.
- Own calibration: the gyro bias is the median of `rest_table` from 4 s on (0.00, -0.31, +0.73 deg/s, the same as the contract's raw -5 / +12 LSB), identity frame, sign +1, scale 1. Hard strokes are detected again from the contract definition: 15 in `fast_swings_h` (peaks 694 to 1049 deg/s), 6 in `fast_swings_v` (632 to 962 deg/s). Both counts match.
- Recording facts re-measured: 4744 IMU reports, device step median 30.00 ms, p99 31.25 ms, 9 steps longer than 45 ms (maximum 61.25 ms).
- Browser checks ran on a server started by the verifier on port 8245 (stopped at the end). The servers on 8200, 8210 and 8230 were not touched. No test that writes to `public/` was run.
- Test suites run by the verifier: `test/{motion,input,ui,app,shared,game,architecture,audio,render}` = **1526 tests, 1526 pass, 0 fail**, plus `test/e2e/real-replay.test.js` (real Chrome, art on, passes). NOT run by the verifier: `test/assets`, `test/bridge`, `test/server` and the other e2e files (about 140 tests, some write files or need the bridge); "npm test is green at the end" is therefore confirmed for 1526 tests plus one e2e file, not for the whole suite.

## 2. Acceptance metrics A1 to A9, recomputed

All from a fresh pipeline per window, default settings (sensitivity 1.0, threshold 300 deg/s, auto-centre on), `check: true` (every BladeSample and BladeSegment passed the project validator, 0 violations everywhere).

| # | Metric | Verifier's number | Pass criterion | Reference | Result |
|---|---|---|---|---|---|
| A1 | hold_still from 7 s; return_still from 2 s | x range 0.0 px, y range 0.0 px in both; CUTTING 0.0 % | <= 10 px, 0 % | 0.0 / 0.0 | PASS |
| A2 | yaw sweep 1..21 s | x 55.5 %, y 30.7 %, boundary 0.0 % | x 35..80 %, y <= 50 %, boundary <= 5 % | 55.5 / 30.7 | PASS |
| A2 | pitch sweep 1..21 s | y 26.3 %, x 2.7 %, boundary 0.0 % | y 15..40 %, x <= 10 % | 26.3 / 2.7 | PASS |
| A3 | false CUTTING over hold, return, yaw, pitch, roll_360, table_spin_360, and yaw+pitch together | 0.00 % in every window, at sensitivity 0.3, 1.0 and 2.0; the CUTTING sequences are identical sample by sample at the three sensitivities (6 windows) | < 2 % | 0.00 % | PASS |
| A4 | hard strokes that produce a cut (CUTTING within 60 ms of the peak and segments cover >= 50 % of the cursor path in the stroke) | H 15/15, path share median 94.7 %, min 86.5 %; V 6/6, median 89.8 %, min 87.0 % | >= 90 % each, median >= 80 %, min >= 60 % | H 15/15 (95 / 86), V 6/6 (90 / 87) | PASS |
| A5 | idle auto-centre from (60,60), (1860,540), (960,1040), (1100,600) | within 100 px after 2.50 / 2.35 / 1.84 / 1.33 s; within 20 px after 3.01 / 2.86 / 2.35 / 1.87 s; exactly one `auto` recenter event per run; `autoCenter: false`: range 0.0 px, 0 events | <= 3.0 s and <= 3.6 s | 2.50 / 2.35 / 1.84 / 1.33 and 3.01 / 2.86 / 2.35 / 1.87 | PASS |
| A5b | refDriven while cutting or tip speed > 21 deg/s (yaw, pitch, fast_h, fast_v) | 0 in all four (refDriven never true in these steps) | 0 | 0 | PASS |
| A6 | no tunnelling, fast_h / fast_v | longest chord 61.5 / 55.0 px; 0 gaps inside cut runs (see note); worst distance of the 1 ms dense path to the segments 3.2 / 2.9 px; `recent()` spacing at most 7.81 ms (snapshots every 5th sample); largest cursor step 407.9 / 351.6 px; peak cursor speed 14,592 / 13,271 px/s | <= 96 px; 0 gaps; <= 12 px; <= 8.5 ms; <= 450 px | 61 / 55; 0; 6.6 / 2.9; - ; 408 / 352 | PASS |
| A7 | head extrapolation error at 60 fps, fast_h | mean 11.4 px, p95 41.9 px, max 99.4 px (hold-last: 104 / 316); fast_v 5.1 / 16.9 / 46.1 | mean <= 20, p95 <= 60 | 13.1 / 45.5 / 99.5 | PASS |
| A8 | posture change (30 + 20 degrees) | cursor 133.0 px from the centre 300 ms after (dx -113.7, dy -69.1); the maximum during the change is also 133.0 px | <= 250 px | 133 px | PASS |
| A9 | cut onset after the first sample at or above 300 deg/s | H median 30.0 ms, max 31.3 ms; V 30.0 / 30.0 ms; retroactive chord present 15/15 and 6/6 | <= 35 ms, chord present | 30 / 31.25 | PASS |

Note on A6 (ii): inside every cut run the chords are contiguous. There is one interval in `fast_swings_h` (52 px, along the right screen edge) between two runs of the same swing id where no chord exists: the tip speed dipped below the release level (195 deg/s), the chord of the leaving interval is not emitted by design (contract 2.4), and the swing re-entered 60 ms later. It is not a tunnelling bug, but an object exactly in that 52 px would be missed.

A10 (curve and direction): re-checked with constant-rate streams through `pushImu` (`tools/verify-round-1/curve.mjs`): the cursor speed equals the contract table at all 16 tip speeds (5 to 1000 deg/s) within 0.94 px/s at sensitivity 0.3, 0.6, 1.0, 1.5 and 2.0; yaw right moves x right (+678 px/s at 100 deg/s), pitch up moves y up, roll about the blade moves nothing (0.0), `flipX` mirrors (and mirrors the whole yaw sweep to 0.0 px), 4.9 deg/s gives 0.0 px after 10 s, 5.5 deg/s gives 25.0 px. A11 and A12 are the engineers' unit suites (motion, simulator, mouse, app, ui): all green in the run above; the verifier did not re-derive them, but spot-checked the threshold behaviour end to end (section 3.5).

Whole recording as one continuous session (steps chained with 30 ms between them): no exception, no warning, 0 contract violations, 3 `auto` recenter events, CUTTING 0.0 % in every slow step. Two samples at the very start of `rest_table` cut (the owner picking the sword up), which is correct behaviour for a fast move.

## 3. Stress tests

### 3.1 Timestamp jitter and lost packets (5 seeds each, `tools/verify-round-1/stress.mjs jitter`)

| Case | Hard strokes cut (H / V, all 5 seeds) | False CUTTING, worst slow window | A1 hold | A5 corner to within 20 px | Longest chord | Violations |
|---|---|---|---|---|---|---|
| device timestamps jittered, sigma 2 ms, 2 % lost | 15/15 and 6/6 | 0.00 % | 0.0 / 0.0 px | 3.01 to 3.02 s | 74 px | 0 |
| device timestamps jittered, sigma 5 ms, 2 % lost | 15/15 and 6/6 | 0.00 % | 0.0 / 0.0 px | 3.00 to 3.02 s | 76 px | 0 |
| arrival jitter sigma 8 ms on `t` only, 2 % lost | 15/15 and 6/6 | 0.00 % | 0.0 / 0.0 px | 3.01 s | 73 px | 0 |
| arrival-dt fallback path (`dtSource: 'arrival'`), sigma 5 ms, 2 % lost | 15/15 and 6/6 | 0.00 % | 0.0 / 0.0 px | 3.00 to 3.02 s | 76 px | 0 (170 `dt_fallback` warnings, as designed) |
| 2 % lost only | 15/15 and 6/6 | 0.00 % | 0.0 / 0.0 px | 3.01 to 3.07 s | 73 px | 0 |

Stroke path share stays at median 94 to 95 %, minimum 72 % (one seed, 2 % loss). With a lost packet the largest cursor step reaches 695 px (information only); the longest chord stays under the 96 px bound. Jitter of 5 ms makes the 25 ms minimum duration fail for about a quarter of the sample pairs on paper, but the cut then starts one sample later and the retroactive chord covers the path, so no stroke was lost. `recent()` spacing: 7.8 ms with one lost packet; 11.4 ms across two consecutive lost packets (a 91 ms interval), see F4.

### 3.2 Playback speed (`stress.mjs speed`)

| Case | Result |
|---|---|
| 0.5x physical (time x2, rates x0.5: a slower swinger) | A1, A2, A3 pass (0 % false cutting, yaw covers 36.6 % of the width). Hard strokes cut: H 14/15, V 5/6, exactly the strokes whose halved peak is near or below 330 deg/s (contract risk R2, not a defect). One H stroke is cut but under 50 % of its path is in segments (43 %) because the stream is 16.5 Hz. |
| 2x physical (time x0.5, rates x2) | H 15/15, V 6/6, path share median 100 %. Yaw sweep cuts 8.8 % and table spin 18.4 % of the time, against an oracle of 12.5 % and 18.6 % of samples whose true angular speed is at least 300 deg/s: that is real fast motion, not a false cut. `roll_360` (25.9 % of samples above 300 deg/s about the blade) cuts 0 %, as designed. One `gyro_saturated` warning (a sample above 2190 deg/s). Hold still range 1.1 / 1.2 px. |
| timing only, 16.5 Hz (rates unchanged) | 15/15 and 6/6, 0 % false cutting, longest chord 65 px, largest cursor step 758 px (angle per sample doubles, information only). |
| timing only, 66 Hz | 15/15 and 6/6, 0 % false cutting, longest chord 56 px, largest step 207 px. |

### 3.3 Constant gyro bias and idle (`stress2.mjs`)

- 3 deg/s of bias that the calibration does not subtract, on every axis combination (plus and minus), 120 s of synthetic table data (0.12 deg/s noise): the cursor does not move at all (0.0 px), because the tip speed stays under the 5 deg/s dead zone.
- The same 3 deg/s added on top of the real hand tremor (91 s of looped `return_still` and `hold_still`): with auto-centre on, the largest distance from the centre is 1.1 px; with auto-centre off, 1.7 to 73 px after 91 s (under 1 px/s, nothing runs away).
- Beyond the brief: 5 and 6 deg/s of uncorrected bias on the pitch axis with real tremor: 2.1 and 7.2 px with auto-centre on, 142 and 449 px with it off. **8 deg/s: 540 px (the cursor reaches the edge) even with auto-centre on**, because the idle test needs the tip speed under 8 deg/s (F5).
- Long idle: from (60,60), (1860,1040) and (960,540), 182 s of real tremor: within 20 px after 3.01 s (0 s for the centre), afterwards the largest excursion is 0.1 px, exactly one `auto` event, no cutting. Ten minutes of synthetic tremor (AR(1), about 2.3 deg/s rms) starting at (1700,900): settles after 2.8 s, median distance 0.2 px, largest later excursion 18.4 px, no cutting.
- The online bias estimator corrects on a table (7 updates, 3 deg/s off converged to 2.6 in 8 s) but never updates while the sword is hand-held (0 updates on `hold_still` and `return_still` with +3 deg/s), by design (`restSpreadDps`).

### 3.4 Robustness (`robust.mjs`)

40 fuzzed sessions (18,350 blade samples): duplicate timestamps, 250 ms and 1.5 s holes, backwards time, 5 ms steps, 30,000 deg/s samples, NaN and Infinity in the gyro, random `markDiscontinuity('lost')`, `recenter`, `reanchor`, `setSettings`, `setCalibration(null)` and `poll(+400 ms)`: 0 exceptions, 0 non-finite values, 0 samples outside the field. Tracking lost: after 250 ms of silence `cutting` is false and `trackingOk` false; the first sample after a hole is a discontinuity and does not cut. `setSettings` mid-stream (sensitivity 1 to 2, threshold 500, flipX) made no jump larger than a normal step (141 px at 100 deg/s).

### 3.5 Settings ranges, thresholds (owner's complaints 2 and 3)

Sensitivity on the owner's own 20 s sweeps (`robust.mjs`): at 0.3 (the new minimum) the yaw sweep covers 16.7 % of the width and the pitch sweep 7.9 % of the height; 0.6: 33.3 / 15.8 %; 1.0: 55.5 / 26.3 %; 1.5: 83.3 / 39.5 %; 2.0: 100 / 52.6 % (boundary 3.2 %). The old minimum was 13.7 px per degree at every speed; the new minimum is about 1.5 px per degree at 50 deg/s.

Threshold table (`thresholds.mjs`, false CUTTING in the six slow windows, hard strokes cut):

| Threshold (deg/s) | hold / return | yaw | pitch | roll | table spin | strokes H / V |
|---|---|---|---|---|---|---|
| 100 (range minimum) | 0 / 0 % | 26.9 % | 0 % | 0 % | 61.1 % | 15/15, 6/6 |
| 150 | 0 / 0 | 11.6 | 0 | 0 | 21.4 | 15/15, 6/6 |
| 200 | 0 / 0 | 4.4 | 0 | 0 | 4.3 | 15/15, 6/6 |
| 225 (Easy) | 0 / 0 | 2.3 | 0 | 0 | 1.7 | 15/15, 6/6 |
| 240 (Zen, 300 x 0.8) | 0 / 0 | 1.8 | 0 | 0 | 1.1 | 15/15, 6/6 |
| **300 (Normal)** | 0 / 0 | **0** | 0 | 0 | **0** | 15/15, 6/6 |
| 450 (Hard) | 0 / 0 | 0 | 0 | 0 | 0 | 15/15, 6/6 |
| 600 | 0 / 0 | 0 | 0 | 0 | 0 | 14/15, 5/6 |
| 700 (range maximum) | 0 / 0 | 0 | 0 | 0 | 0 | 13/15, 1/6 |

### 3.6 Providers

- **Simulator** (real `sim` provider through the absolute model, six mount presets): cursor follows the virtual mouse to within 15.5 to 16.7 px on glides of 900 ms; thresholds convert correctly (T 225 / 300 / 450 deg/s cut from about 600 / 900 / 1100 px/s of eased glide peak, as the px tracker does); 30 s idle with the idle centring off (as `app.js` sets it for the simulator) drifts 1.3 px and never cuts. In the real page (`?input=sim&clock=manual`): `pointerModel: 'absolute'`, a 400 and an 833 px/s glide through a watermelon does not cut, 1250, 2000 and 3333 px/s each cut it once, and the cursor ends within 8 px of the target.
- **Mouse** (`pushAim` through a real mouse provider and a fake target): T 300 does not cut at 300, 600 or 900 px/s and cuts at 1100 px/s and above; T 225 cuts from 900; T 450 from 1600. In the real page (`?input=mouse`, `__ninja.swing`): 500 and 750 px/s never cut, 1250, 1875 and 3000 px/s cut (81 to 91 % of the samples in the stroke), with the state reporting `cutThresholdDps: 300`.
- **Settings migration** (`storage.mjs`, then a real browser): a stored `{ v: 1, sensitivity 1.5, cutThreshold 1400, volume 0.3, hand left, flipX true, autoCenter false, best, safetyAck, playMsTotal }` loads with sensitivity 1.0 and threshold 300, every other setting, the high score, the safety acknowledgement and the play time intact, `getNotice() === 'motion-2'`. In the page: the toast "Sensitivity and Slice threshold were reset." appears once on the first menu, the stored document is rewritten as `v: 2, notice: null` (settings and best intact), and the next reload shows no toast. Edge cases: a document without `v`, with `v: "2"`, or at extreme old values (2400, 400) all reset once with the notice; a v2 document is kept as is (1400 clamps to 700, 113 snaps to 125, 0.05 to 0.3); a v2 document that carries the notice keeps it; corrupted JSON, no document and `[]` give defaults and no notice; a throwing backend does not throw. The Settings and Sword tuning screens render the new units ("300 deg/s (Normal)", "Blade speed: 0 deg/s", preset rows Relaxed/Standard/Fast and Easy/Normal/Hard).
- **Frame smoothness** (`frames.mjs`, 60 fps frames with `headAt`, samples visible 0 to 35 ms after their device time): with 0 to 20 ms of delivery delay the head stalls in 15 to 19 % of the frames inside strokes (hold-last: 45 %), with 3 to 4 % direction reversals at 10 to 20 ms; at 35 ms of delay it stalls in 46 % (same as hold-last) because the 35 ms extrapolation clamp is reached. The pipeline maps `t` with a running minimum of arrival minus device time, so the expected delay is the jitter, not the transport latency (UNVERIFIED-ON-HARDWARE).

## 4. Findings

| # | Severity | Finding |
|---|---|---|
| F1 | **major** | During sustained vigorous swinging the relative pointer sinks to a screen edge and stays there (details below). No contract metric measures it. |
| F2 | minor | Easy (225) and anything below it still cuts on the owner's most vigorous slow aiming (2.3 % yaw, 1.7 % spin at 225; 4.4 % at 200; 27 % yaw and 61 % spin at the range minimum 100). |
| F3 | minor | `settings.migrated` says "were reset" but not why or to what (deviation D-S1, recorded and accepted by the Integrator); the owner will not learn the new defaults from the game. |
| F4 | minor | After two consecutive lost packets (a 91 ms interval) the trail ring has a 11.4 ms spacing (the 8 sample cap), above the 8.5 ms bound that A6 (iv) states for a single lost packet. Cosmetic. |
| F5 | minor | An uncorrected gyro bias of about 8 deg/s with real tremor makes the cursor creep to the edge even with auto-centre on; the online estimator only works on a table. Risk R10 already lists this; the wizard's own bias removes the normal case. |

### F1 detail (major)

The contract counts time on the screen boundary (R6: "33 % of the time in the horizontal swing test") and accepts it because "the cursor leaves the edge as soon as the sword reverses". The replay shows a stronger effect than edge time: the cursor centroid is pushed to the bottom of the screen and stays there, so the owner's horizontal slashes are drawn along the bottom edge instead of through the middle where the fruit are.

Replay of `fast_swings_h` whole (15 slashes, the owner's horizontal swings, 14 s), default settings:

- the cursor is on a screen edge for **35.4 %** of the samples (bottom 24.8 %, left 4.7 %, right 5.6 %); the browser replay `test/e2e/real-replay.test.js` agrees (35.6 % Classic, 36.6 % Zen);
- median cursor y is **987 of 1080**; 67 % of the samples are in the lowest 180 px;
- of the samples that are CUTTING, the median y is **1027**, 57 % are below y 1000, and only **10 %** are inside the middle half of the screen height (y 270 to 810);
- 11 of the 15 slashes start within 60 px of an edge; the y span of slashes 6 to 12 is 72 to 270 px, all at y 800 to 1080;
- without any clamping the cursor path would end 4,222 px below and 811 px to the side of where it started (a back and forth test should net about zero). The samples above 300 deg/s carry +4,260 px of that; 34 % of those samples are diagonal (minor axis over 35 % of the major axis) and the net rotation about the pitch axis inside them is -288 degrees: the owner's tip drops during the slashes and the return strokes do not bring it back. Replacing the acceleration curve by a constant gain (9 or 14 px per degree) does not remove it (+3,064 and +4,766 px), so it is not the pointer acceleration;
- `fast_swings_v` (six downward chops with slow raises) uses the screen well (all six strokes span more than 650 px vertically, four of them more than 950 px) but 62 % of the samples are in the lowest band and 29 % of the cutting samples are in the middle half.

Why it matters: owner complaint (1) was that the cursor always has to be re-centred. The relative model removed the posture problem (A8 133 px) and the slow sweeps stay centred, but under continuous fast slashing the cursor drifts to the bottom and the only remedy in the model is the idle centring, which needs 0.5 s without cutting plus 1.0 s under 8 deg/s and is switched off while swinging on purpose. In a round with fruit coming continuously there may never be 1.5 s of rest; the player has to tip the sword up to bring the cursor back. Whether this is tolerable on the sword is UNVERIFIED-ON-HARDWARE (a mouse user corrects it without noticing); the replay of the owner's own data says it is the normal state of the cursor during vigorous play, not a rare event. It is classed major because it is the owner-visible symptom of complaint (1) and because every contract metric passes while it happens.

What was tried (what-if only, nothing was changed): suppressing the minor axis above 300 deg/s when it is under 35 % of the major one did not change the median y (1050), so a simple axis lock is not the fix. Directions the engineers may test, all UNVERIFIED: a weak spring towards the centre that runs whenever the blade is not CUTTING (not only after 1.5 s of rest); a shorter quiet time before the idle centring; an edge relief that lets the cursor come back faster after it was clamped; or accepting the behaviour and documenting it in the guide. A metric to add to the real replay test: the share of CUTTING samples of `fast_swings_h` and `fast_swings_v` that lie in the middle half of the screen height (now 10 % and 29 %), plus the median y of all samples (now 987 and 1035).

## 5. The owner's four remarks against the data

1. Gyro "not used", constant re-centring: the model is now relative and uses only the gyro; a 30 + 20 degree posture change moves the cursor 133 px; hold still gives 0.0 px over 20 s; slow sweeps never reach an edge (boundary 0.0 %). Remaining: F1 under vigorous swinging.
2. Cut threshold far too low: decided in tip speed, default 300 deg/s; 0.00 % CUTTING in every slow step (old pipeline 15.9 to 61.6 % per the contract), 21 of 21 hard strokes cut, onset 30 ms. Independent of sensitivity (identical sequences at 0.3, 1.0, 2.0).
3. Sensitivity far too high even at minimum: minimum 0.3 now covers 16.7 % of the width for the owner's own yaw sweep; default 55.5 %.
4. Connection: not in scope of this round.

## 6. Not verified

The feel on the sword; the Left controller; other people's swings (risk R2: a swinger under 300 deg/s at the tip cannot cut at Normal); the wizard's mount and sign on real hardware; Web Bluetooth rate and latency; Chrome timing of the native bridge path beyond the recording's 33 Hz; the `test/assets`, `test/bridge`, `test/server` and non-replay e2e suites.
