# 3D Fruit Dojo: Game Design Bible

| Item | Value |
|---|---|
| Version | 1.0 (design freeze for implementation) |
| Author role | Game designer |
| Audience | Engineers (game loop, rendering, audio, input/motion pipeline), QA/automation agents, the owner (CollectiCraft) |
| Document language | English (owner request). The in-game UI text is English too and lives in section 13 (owner decision of 2026-09-30: the first version of the game showed Italian text). |
| Name | **3D Fruit Dojo** (renamed on 2026-09-30 from the working title "Joy-Con Ninja"). The code name `joycon-ninja` stays in the folder, the package name, `window.__ninja`, the URL flags and the `joyconNinja.*` storage keys, so that saved scores survive. Historical QA and review reports keep the old name. |
| Scope | A fruit-slicing web game (HTML5 Canvas, ES modules, Chrome) played by swinging a 3D-printed sword with a Joy-Con 2 strapped to it (Left or Right), plus simulator and mouse providers. Sections 9, 11 and 12 also describe the optional generated art layer (section 11.6). |

---

## Contents

0. How to read this document
1. Design pillars and feel target
2. Playfield, physics and spawning
3. Difficulty ramp and spawn cadence
4. Object catalogue (fruit, golden apple, bomb, power-ups)
5. Slicing rules (cut definition, combos, halves)
6. Scoring and lives at a glance
7. Modes (Classic, Arcade, Zen), results, high scores, ranks
8. Blade, cursor and input mapping
9. Juice (particles, splashes, slow motion, shake, popups, flashes)
10. Audio (WebAudio recipes)
11. Visual style: Ink and Paper Dojo
12. Screens and flows
13. UI strings (complete)
14. Settings
15. Accessibility and safety
16. Automation and test contract
17. Hardware-dependent assumptions register (UNVERIFIED-ON-HARDWARE)
18. Design risks and open questions
A. `config.js` reference

---

## 0. How to read this document

**Authority.** Every number in this document is a design decision. Engineers put them in one frozen module (`src/game/config.js`) and use no magic numbers elsewhere. Appendix A contains the same data in code form. If prose and Appendix A ever disagree, the **tables in the body win**; file a bug against this document.

**Priority tags.** **[MUST]** required for v1. **[SHOULD]** expected unless it blows the schedule or the performance budget. **[P2]** nice to have, only after everything else works.

**Hardware honesty.** Nobody on the team can touch the real Joy-Con 2. Every statement that depends on how the physical device behaves is tagged **UNVERIFIED-ON-HARDWARE** and given an ID (`HW-1` ... `HW-12`). The full register with "what to test" and "which constant to tune" is in section 17. Nothing in this document is claimed to be verified on the device. Numbers that only make sense with real hardware (sensitivity, cut threshold, drift correction, cooldowns) are **starting values**, not measurements.

**Units and conventions.** Logical playfield 1920 x 1080 px, origin top-left, **y grows downward**. Angles in degrees unless stated (rad/s for spin). Time in seconds (s) or milliseconds (ms). "World time" is game-simulation time (affected by slow-motion); "real time" is wall/UI time (not affected). Colours are `#RRGGBB`.

**Verification note.** The spawn arcs, launch speeds, air times and the score economy in sections 2, 3 and 7 were checked with a throwaway numeric script (20,000 random samples per configuration; all arcs stayed inside the allowed x range, apex never above the stated minimum). The script is not shipped; the invariants it checked are turned into unit-test requirements in section 16.

---

## 1. Design pillars and feel target

### 1.1 Pillars

1. **Swing, do not fiddle.** The player is standing, holding a sword. One decisive swing must be the answer to almost every situation. No precision aiming at tiny things, no menus that require fine pointing.
2. **Big and forgiving.** Big objects, hit areas about 70% larger than the drawn fruit body (a hit circle of 1.55 x r plus a 14 px blade half width, section 5.3), a cut threshold that a relaxed wrist flick clears, long hang-time near the apex of every throw.
3. **Instant feedback.** The blade trail must appear on the very next rendered frame after motion, the cut must show within one physics tick (8.3 ms), and every cut gets sound, particles and a splash.
4. **Fair failure.** A mistake must always feel like the player's mistake, never like "the tracking lied". The cursor is always visible, slow contact never triggers a bomb, misses come with mercy windows, and re-centering is always one gesture away.
5. **Short and rest-friendly.** It is exercise. Rounds are short, there are built-in breathers, and the game actively suggests breaks (section 15).

### 1.2 Feel targets (numbers)

| Parameter | Target value | Notes |
|---|---|---|
| Round length | Arcade 60 s (max 90 s with bonuses), Zen 90 s, Classic median 2:00 to 4:00 for an engaged player | Casual players are steered to Zen; Classic is the challenge mode |
| Sustained effort ceiling | at most **3.5 fruit/s** and about **1.2 swings/s** on average | Reached only in the last stages (section 3) |
| Fruit visual diameter | 96 to 184 px (5% to 9.6% of screen width) | Smallest is the cherry |
| Hit radius | fruit: 1.55 x visual radius + 14 px blade half width (Golden Apple 1.6 x + 14, medallions 1.5 x + 14); bomb: 0.85 x, no half width | Section 5.3 |
| Default cut threshold | **300 deg/s** of tip speed (sword tuning round, 2026-09-30; it was 1000 px/s, which is only 36 deg/s at 27.4 px/deg and cut everything). The mouse and the simulator compare px/s: 300 deg/s = 1000 px/s there | A slow aim never cuts, a real swing always does. Measured on one real recording: aiming p99 253 deg/s, slowest hard stroke 632 deg/s (`docs/motion-findings.md` 10.1) |
| Hang time | 0.70 to 0.83 s inside +/-100 px of the apex | Time in which a fruit is easiest to hit |
| Comfort band | 70% of throws have their apex inside x = 480 to 1440 (central half of the screen width) | The arm should rarely need to sweep to the extreme edges |
| Screen span of the sword | no fixed span for a real Joy-Con: the cursor moves like a mouse, 5 px per degree when aiming slowly rising to 14 px per degree in a fast swing (times the sensitivity), so a firm slash of about 137 degrees crosses the screen once. The simulator keeps +/-35 deg horizontally (70 deg) at 27.4 px per degree | section 8.2. UNVERIFIED-ON-HARDWARE (HW-2): comfort of the curve |
| Results-screen input lockout | 1.2 s | Prevents the last swing from selecting a button |
| Input-to-screen latency target | under 50 ms | Budget in section 1.3 |

### 1.3 Latency budget (design side)

The engine owner controls implementation; the designer fixes the rules that protect the feel.

| Stage | Budget | Design rule |
|---|---|---|
| BLE radio + browser event delivery | unknown, likely 10 to 30 ms | **UNVERIFIED-ON-HARDWARE (HW-1)**. If it alone exceeds 35 ms the 50 ms target cannot be met; report it in the diagnostics page instead of hiding it |
| Packet parse + orientation fusion | at most 2 ms | Runs in the input event handler, not in the render loop |
| Blade sample to pixels | next `requestAnimationFrame` | The **blade head is drawn from the newest sample at render time**, never from the last physics tick |
| Cut detection | at most one physics tick (8.3 ms at 120 Hz) | Collision runs in the fixed-step loop using all blade samples accumulated since the previous tick |
| Cut reaction on screen | same frame the tick produced it | Halves, splash, popup and sound start together |
| Display / compositor | one refresh (16.7 ms at 60 Hz) | Not controllable |

Rules: no smoothing filter may add more than 8 ms of lag to the blade at cutting speed (a speed-adaptive filter such as the "1 euro filter" is the recommended shape: strong smoothing at rest, none at speed). Never wait for a fixed-step tick before drawing the blade.

### 1.4 Tuning targets for playtests (initial, to be revised after simulator-bot and owner playtests)

| Metric | Target |
|---|---|
| Classic median run, engaged player (about 88% or better accuracy) | 2:00 to 4:00 |
| Arcade score, first-time casual player | 500 to 1200 |
| Arcade score, engaged player | 1300 to 2200 |
| Share of fruit cut as part of a multi-cut (2 or more in one swing) from stage 4 on | 35% or more |
| Accidental bomb hits reported by testers | at most 1 per 5 rounds |
| Accidental menu selections | at most 1 per 20 minutes of play |

---

## 2. Playfield, physics and spawning

### 2.1 Coordinates and zones (logical 1920 x 1080, y down)

| Zone | Definition |
|---|---|
| Playfield | x 0 to 1920, y 0 to 1080. The canvas scales this rectangle to fit the window (aspect-fit, letterbox bars in ink `#14141C`); backing store scale = min(devicePixelRatio, 2) |
| HUD band | y 0 to 190 (score top-left, timer top-centre, lives top-right) plus the power-up tray at y 206 to 274 on the left (section 12.3). Fruit may pass behind it; objects are drawn **under** the HUD |
| Spawn line (vertical throws) | y = **1190** (110 px below the screen, clears the largest fruit) |
| Spawn x for side throws | x = **-110** (left) or **2030** (right) |
| Cuttable region | object centre with y < 1110 and -30 < x < 1950. Objects outside it cannot be cut (nothing invisible can be sliced) |
| Cull line | y > 1080 + r + 40 while descending (r = visual radius) |
| Apex zone | y 240 to 560 for regular throws (fruit never rises above y = 240, so a big fruit's top stays below y = 148) |
| Arc x-limits | every arc keeps 100 <= x <= 1820 for its whole life |

### 2.2 Fixed timestep and time scale [MUST]

- Physics runs at a **fixed dt = 1/120 s** (8.333 ms) with an accumulator. Clamp the real frame delta to 50 ms; run at most 6 steps per frame (spiral-of-death guard). Render at display rate with interpolation between the previous and current physics state (alpha = accumulator / dt).
- `timeScale` multiplies only the *world* accumulator: `accum += frameDt * timeScale`. The physics dt itself never changes. World time = things that fly (fruit, halves, particles, splats ageing, bomb fuse animation).
- **Never scaled** (always real time): blade input and trail, cut detection and combo windows, all timers and durations (round timer, power-up durations, wave timers, mercy windows, popups, banners, UI animation), audio scheduling.
- Effective scale = **min** of all active scales (never multiply them). Sources: Freeze power-up 0.40, combo slow-motion 0.35 or 0.25, near-miss 0.50, golden apple 0.40, game-over 0.30. Ease in over 60 ms, ease out over 150 ms (Freeze: in 200 ms, out 400 ms).
- Fruit motion per tick never exceeds 15.8 px at the highest launch speed (1900 px/s), less than a quarter of the smallest fruit hit radius (88 px), so object-vs-blade tunnelling from fruit motion is impossible. Blade tunnelling is prevented by the swept-segment test (section 5).

### 2.3 Gravity and launch speeds

Base gravity **g0 = 1300 px/s^2**, scaled per mode and stage (`gScale`, tables in section 3). `g = g0 * gScale`.

Launch is computed **apex-first** so that the designer controls where a fruit peaks, not the engineer's guess at velocity:

```
inputs: apexX (Ax), apexY (Ay), g, leanMax (deg)
dy      = 1190 - Ay                       // spawn line minus apex height
vy0     = -sqrt(2 * g * dy)               // upward
tApex   = sqrt(2 * dy / g)                // seconds to apex
lean    = U(0, tan(leanMax) * |vy0|)      // max horizontal speed
vx      = lean * sign, sign = toward screen centre with probability 0.65
// arc x-limit rule (applies to every formation, applied last, never changes Ay):
x0      = Ax - vx * tApex
xEnd    = x0 + 2 * vx * tApex             // arc is symmetric, x is monotonic in time
while not (100 <= x0 <= 1820 and 100 <= xEnd <= 1820): vx *= 0.9 (recompute x0, xEnd)
omega   = U(1.5, 5.0) rad/s * random sign // spin, cosmetic but drawn
```

The **launch angle** from vertical is `atan(vx / |vy0|)`: at most `leanMax` (10 to 15 degrees depending on stage; Frenzy 8; `FAN` members come out at about 8 to 15; `PAIR` members under 4 and `LINE` members under 3). Side throws leave at **37 to 66 degrees above horizontal**.

Derived values (verified numerically), for vertical throws with apex y 240 to 560:

| Quantity | Value |
|---|---|
| Launch vertical speed \|vy0\| | 1214 px/s (Zen, lowest apex) to 1757 px/s (g x 1.25, highest apex) |
| Peak total speed | at most about 1820 px/s |
| Max horizontal speed (normal lean 15 deg) | about 471 px/s |
| Time to apex | 0.88 to 1.27 s |
| Air time (spawn line to spawn line) | 1.76 s (fastest) to 2.55 s (Zen) |
| Time visible (y < 1080) | 0.15 to 0.2 s less than the air time |
| Hang time within +/-100 px of apex | 0.83 s (g x 0.9), 0.78 s (g x 1.0), 0.70 s (g x 1.25) |

**Side throws** (formation `SIDE`, from stage 3 in Classic): spawn at x = -110 (left) or 2030 (right, mirrored), y0 uniform 700 to 900, apex y uniform 300 to 560, `vy0 = -sqrt(2 g (y0 - Ay))` (675 to 1396 px/s at g x 1.25), horizontal speed uniform 620 to 900 px/s toward the screen. Rule: if x at the cull line would exceed 1780 (mirrored side: fall below 140), reduce the horizontal speed until x at the cull line is exactly 1780 (mirrored: 140). Verified: air time 1.3 to 1.9 s (g x 1.25).

### 2.4 Formations (how a wave is arranged)

A **wave** is a group thrown in a short burst. Each wave picks N (count, from the stage table), then a **formation** among those compatible with N, using the stage's formation weights (renormalised over the compatible set).

| Formation | Compatible N | Arrangement (apex-first coordinates) | Purpose |
|---|---|---|---|
| `RAIN` | any | each object: apexX from the central band (70%: 480 to 1440) or the wide band (30%: 220 to 1700); apexY uniform 240 to 560; launch delay `i * U(70, 150) ms`; objects launched within 300 ms of each other must have apexX at least **220 px** apart (retry the draw up to 6 times, then push apart) | variety |
| `PAIR` | 2 | apexX = c -/+ 150 with c uniform 640 to 1280; apexY = a +/- 30 with a uniform 320 to 500; delays 0 and 40 ms; both nearly vertical (vx uniform -90 to 90 px/s) | designed 2-combo |
| `LINE` | 3, 4, 5 | shared a uniform 320 to 500, each apexY = a +/- 30; apexX_i = c + (i - (N-1)/2) * spacing with spacing 260 (N=3), 250 (N=4), 240 (N=5) (was 240, 230, 220 before the larger hit areas: at least twice the hit radius of an average fruit, 2 x 119), c uniform 860 to 1060; vx uniform -60 to 60; delays 0 to 30 ms | designed horizontal-swipe combo (3 to 5) |
| `FAN` | 3, 4, 5 | fountain: common launch x0 uniform 700 to 1220; member i has half-span s_i = spread * (i - (N-1)/2) / ((N-1)/2) with spread 300 (stage 3) to 420 (stage 6+), so xEnd = x0 + 2 s_i; apexY = base (uniform 300 to 480) +/- 60 alternating; delays 0, 50, 100 ms | spectacle; angles come out at about 8 to 15 deg |
| `SIDE` | 1 or 2 | side throw (section 2.3); N=1 (70%) or N=2 (30%, second 250 ms later, same side) | diagonal swing direction |
| `BREATHER` | 1 | one `RAIN` fruit, apexX central band, apex 360 to 500 | rest beat |

Rules: a wave never contains two objects with the same fruit type more than twice; `LINE` and `PAIR` members are chosen with distinct types when possible (readability of the combo).

### 2.5 Extras appended to a wave

Extras are **additional** objects on top of N. At most one extra of each kind per wave, and the golden apple never shares a wave with a bomb or a power-up.

| Extra | Rule |
|---|---|
| Bomb | one, `apexY` uniform 300 to 520, vx uniform -120 to 120, launch delay uniform 0 to 200 ms **plus a 350 ms telegraph** (section 4.5). `apexX` must be at least **280 px** (was 260; the largest fruit hit radius, 157, plus the 120 px near-miss band) from the `apexX` of every fruit in the same wave (retry 8 times; then flip to the opposite half of the screen; then the nearest slot that keeps 280 px; if a dense wave has none, the nearest slot that keeps 260 px, else the best effort) |
| Power-up | one, `apexY` uniform 300 to 460, central band, launch delay uniform 150 to 300 ms |
| Golden apple | one, `apexY` uniform 240 to 360, central band, vx uniform -80 to 80, launch delay uniform 100 to 250 ms |

### 2.6 Population caps and back-pressure

| Cap | Value |
|---|---|
| Uncut standard fruit alive | 12 (Freeze 14, Frenzy 16). If a wave would exceed the cap, delay the whole wave in 200 ms steps until it fits |
| Halves alive | 40 (oldest is removed with a 150 ms fade) |
| Particles | 400 |
| Splats | 24 |
| Score popups | 12 |
| Audio voices | 24 |

### 2.7 Lifetime and off-screen rules

- A **fruit is "missed"** when it is uncut, standard fruit type, and passes the cull line while descending. It is *not* missed if it is a bomb, a power-up, the golden apple or a half. A miss produces a small "Missed!" marker at the bottom edge at the object's x (only when a life is actually lost, i.e. in Classic outside the mercy window and outside Frenzy; in Arcade and Zen misses are counted for the accuracy statistic only, silently).
- Objects that leave through the left or right side (x < -(r + 200) or x > 1920 + r + 200) are removed silently and counted as missed. **This must never happen** in normal play (invariant in section 16).
- Hard cap on life: 6.0 s of world time, then removed silently (safety net, unreachable in normal play because the longest air time is 2.55 s).
- Halves are removed when they pass the cull line. Particles and splats follow their own lifetimes (section 9).
- Objects are never removed because of the HUD; the HUD is drawn over them.

### 2.8 Randomness [MUST]

Two independent seeded streams (mulberry32 or equivalent) so that cosmetics can never change gameplay:

| Stream | Used for |
|---|---|
| `rngWave(k)` = generator seeded with `hash32(seed, k)` for wave index k | everything about wave k: N, formation, fruit types, apex positions, bomb/power-up/golden roll results, delays |
| `rngFx` seeded with `seed XOR 0x9E3779B9` | particles, splat shapes, audio jitter, screen shake phase. The static background uses a fixed seed `0xC0FFEE` so it looks identical in every run |

Because wave k depends only on `(seed, k, stage, active flags)`, **the same seed gives the same throws regardless of what the player does** (except where a power-up flag such as Frenzy changes which waves are generated; that is deterministic given the same actions). Power-up and golden-apple pity counters advance per wave, not per frame.

---

## 3. Difficulty ramp and spawn cadence

Stage index advances with **game time** (real seconds since "GO!", excluding pauses and the countdown). Wave intervals get +/-15% jitter from `rngWave`. The first wave of every round spawns **0.8 s** after "GO!". "Fruit/s" is the expected throughput (average N divided by interval), shown to make the effort ceiling checkable.

### 3.1 Classic (lives), ramp table

| Stage | Starts at (s) | Wave interval (s) | Fruit per wave (N: weights) | avg N | Fruit/s | Bomb chance per wave | gScale | Lean max (deg) | Formation weights R / P / L / F / S | Side-throw share |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 0 | 1.90 | 1: 50, 2: 50 | 1.5 | 0.79 | 0% | 1.00 | 10 | 70 / 30 / 0 / 0 / 0 | 0% |
| S2 | 20 | 1.70 | 1: 30, 2: 40, 3: 30 | 2.0 | 1.18 | 8% | 1.03 | 12 | 55 / 25 / 20 / 0 / 0 | 0% |
| S3 | 45 | 1.55 | 2: 50, 3: 50 | 2.5 | 1.61 | 12% | 1.06 | 12 | 40 / 20 / 25 / 10 / 5 | 5% |
| S4 | 75 | 1.40 | 2: 30, 3: 40, 4: 30 | 3.0 | 2.14 | 15% | 1.10 | 14 | 35 / 15 / 25 / 15 / 10 | 10% |
| S5 | 105 | 1.30 | 2: 25, 3: 40, 4: 35 | 3.1 | 2.38 | 18% | 1.14 | 15 | 30 / 15 / 25 / 15 / 15 | 15% |
| S6 | 140 | 1.20 | 3: 50, 4: 50 | 3.5 | 2.92 | 20% | 1.18 | 15 | 30 / 10 / 25 / 20 / 15 | 15% |
| S7 | 180 | 1.20 | 3: 30, 4: 40, 5: 30 | 4.0 | 3.33 | 22% | 1.22 | 15 | 30 / 10 / 25 / 20 / 15 | 15% |
| S8 (plateau) | 240 | 1.15 | 3: 30, 4: 40, 5: 30 | 4.0 | 3.48 | 25% | 1.25 | 15 | 30 / 10 / 25 / 20 / 15 | 15% |

(R = RAIN, P = PAIR, L = LINE, F = FAN, S = SIDE.) Cumulative fruit thrown: 45 by 45 s, 94 by 75 s, 158 by 105 s, 241 by 140 s, 358 by 180 s, 558 by 240 s. The plateau never gets harder than S8. **At 6:00 of game time a soft banner suggests a break** (section 15); it never forces the round to end.

### 3.2 Arcade (60 s), ramp table

| Stage | Starts at (s) | Wave interval (s) | Fruit per wave | avg N | Fruit/s | Bomb chance | gScale | Lean (deg) | Formation weights R / P / L / F / S | Side share |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 0 | 1.60 | 2: 60, 3: 40 | 2.4 | 1.50 | 10% | 1.05 | 12 | 40 / 25 / 25 / 10 / 0 | 0% |
| A2 | 15 | 1.25 | 2: 30, 3: 40, 4: 30 | 3.0 | 2.40 | 14% | 1.10 | 14 | 35 / 20 / 25 / 10 / 10 | 10% |
| A3 | 30 | 1.15 | 3: 50, 4: 50 | 3.5 | 3.04 | 16% | 1.15 | 15 | 30 / 15 / 30 / 15 / 10 | 10% |
| A4 | 45 | 1.05 | 3: 50, 4: 50 | 3.5 | 3.33 | 18% | 1.20 | 15 | 30 / 10 / 30 / 15 / 15 | 15% |

About 154 fruit are thrown in a 60 s round (22.5 + 36.0 + 45.7 + 50.0). (Improvements round: A1 was 1.40 s with 2.5 fruit per wave, 1.79 fruit/s; the first 15 s are now a gentler warm-up for a cold arm, see docs/improvements.md.) Stages count real time, so time bonuses (which extend the round) keep the player in A4. No breathers in Arcade (it is a sprint).

### 3.3 Zen (90 s), ramp table

| Stage | Starts at (s) | Wave interval (s) | Fruit per wave | avg N | Fruit/s | Bomb chance | gScale | Lean (deg) | Formation weights R / P / L / F / S | Side share |
|---|---|---|---|---|---|---|---|---|---|---|
| Z1 | 0 | 1.80 | 1: 30, 2: 40, 3: 30 | 2.0 | 1.11 | **none** | 0.90 | 10 | 60 / 25 / 15 / 0 / 0 | 0% |
| Z2 | 30 | 1.55 | 2: 50, 3: 50 | 2.5 | 1.61 | none | 0.90 | 12 | 45 / 20 / 25 / 10 / 0 | 0% |
| Z3 | 60 | 1.35 | 2: 25, 3: 50, 4: 25 | 3.0 | 2.22 | none | 0.92 | 12 | 40 / 15 / 25 / 20 / 0 | 0% |

About 148 fruit per round. Zen has no side throws (everything comes from below) and the lowest gravity (floaty, longest hang time: 0.83 s).

### 3.4 Ramp rules shared by all modes

- Stage boundaries switch instantly at the next wave; there is no mid-wave change.
- **Fruit type weights** blend between the "early" and "late" columns of the catalogue (section 4.1): `w = lerp(wEarly, wLate, clamp((stageIndex - 1) / 4, 0, 1))` where stageIndex is 1-based (S1, A1, Z1 = 1). Arcade tops out at a blend of 0.75 and Zen at 0.50, so Zen keeps a friendlier mix of big fruit. Effect: big easy fruit early, more small high-value fruit later.
- **Breathers** (Classic and Zen only): every 10th wave (wave index 9, 19, 29, ...) is a `BREATHER` (1 fruit) and the *next* interval gets **+1.2 s**. Purpose: give the arm two seconds of rest.
- **Bomb rules** [MUST]: never in the first 20 s of Classic or the first 5 s of Arcade; never in Zen; never during Frenzy or Freeze; never in two consecutive waves; never in a `BREATHER`; at most one bomb per wave; each bomb is telegraphed (section 4.5).
- **Power-up scheduling.** A power-up is rolled once per wave after the eligibility time:

| | Classic | Arcade | Zen |
|---|---|---|---|
| First eligible at (s) | 25 | 8 | 20 |
| Minimum gap between power-up *spawns* (s) | 20 | 12 | 25 |
| Base chance per wave | 6% | 6% | 6% |
| Pity: added per eligible wave without a power-up | +2% | +2% | +2% |
| Chance cap | 30% | 30% | 30% |
| Kind weights | Freeze 35, Frenzy 30, Double 35 | Freeze 35, Frenzy 30, Double 35, **Clock 25** | Freeze 35, Frenzy 30, Double 35 |
| Expected power-ups per round | about 5 in 3 min | about 3 in 60 s | about 3 in 90 s |

The chance resets to 6% after a spawn. **No new power-up item spawns while a timed power-up is active** (the roll is skipped and does not advance the pity counter).
- **Golden apple scheduling:** eligible after 20 s, minimum gap 35 s, 4% per eligible wave, +1% pity per wave, cap 15%. About one per 50 s.
- **Frenzy waves (replace regular waves while Frenzy is active):** wave interval 0.42 s (+/-10%), N 2: 50 / 3: 50, formations RAIN 60 / LINE 40, apexY uniform 320 to 560, lean 8 deg, gScale 1.00, no bombs, cap 16 uncut fruit. The regular wave timer is suspended and restarts 1.2 s after Frenzy ends (about 36 fruit per Frenzy).
- **Freeze:** regular waves continue on the *real-time* wave timer while everything moves at 0.40x, so about 2.5x as many objects are on screen (cap 14). No new bombs spawn during Freeze (already-flying bombs remain). This is the "reward window".
- **Pausing** freezes all of the above.

---

## 4. Object catalogue

Every collidable is a **circle centred on the sprite body**; decorations (crown, stem, leaves, fuse) extend outside the circle and do not collide. `r` is the radius the sprite is scaled to (the visible body is about `r`; tall fruit are drawn up to 14 percent smaller than `r`, so their body is smaller and longer than the circle), `hitR` the collision radius: `hitR = round(r x multiplier) + blade half width` (section 5.3). **Hit areas were enlarged after the first real Joy-Con session** (owner feedback: the fruit hit box seemed a bit too small): fruit were 1.25 x r and are now 1.55 x r + 14 px.

### 4.1 Fruits (10 regular types)

| # | id | Name | r | hitR (x1.55 + 14) | Score | Weight early | Weight late | Skin (detail) | Flesh (detail) | Juice / splash colour |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `watermelon` | Watermelon | 92 | 157 | 10 | 14 | 6 | `#4E9A48` (stripes `#2F6B32`) | `#E8455A` (rind band `#F4F1C8`, seeds `#14141C`) | `#E8455A` |
| 2 | `pineapple` | Pineapple | 82 | 141 | 10 | 10 | 6 | `#E8A92B` (hatch `#B9781A`, crown `#4E9A48`) | `#F7DD5C` (core `#F3EFA8`) | `#F5D34B` |
| 3 | `apple` | Apple | 68 | 119 | 15 | 14 | 10 | `#D8412F` (shade `#A82A18`, stem `#6B4A2B`, leaf `#4E9A48`) | `#F6EFD0` (seeds `#5A3A22`) | `#E8C04A` |
| 4 | `orange` | Orange | 68 | 119 | 15 | 14 | 10 | `#F28C1E` (dimples `#C96A0A`) | `#FFB23D` (segment lines `#FFD37A`) | `#FF9A1F` |
| 5 | `pear` | Pear | 66 | 116 | 15 | 10 | 10 | `#B8C94A` (blush `#8FA632`, stem `#6B4A2B`) | `#F4F0C6` | `#C9D64A` |
| 6 | `peach` | Peach | 64 | 113 | 15 | 10 | 10 | `#F4A27E` (blush `#E4644E`) | `#F9C86A` (pit `#8B4A2B`) | `#F7A56A` |
| 7 | `lemon` | Lemon | 60 | 107 | 20 | 8 | 12 | `#F6E04A` (shade `#D1B62A`) | `#FBF3A6` (segment lines `#FFFBD0`) | `#F2E24A` |
| 8 | `kiwi` | Kiwi | 58 | 104 | 20 | 8 | 12 | `#8B6B3E` (fuzz dots `#6B4F2A`) | `#7BC043` (centre `#F2F7D0`, seeds `#14141C`) | `#7BC043` |
| 9 | `strawberry` | Strawberry | 52 | 95 | 25 | 6 | 14 | `#E63946` (seeds `#F6E7A0`, calyx `#4E9A48`) | `#F7A9A8` (core `#FDE8E4`) | `#E63946` |
| 10 | `cherry` | Cherry | 48 | 88 | 30 | 6 | 14 | `#B3122E` (highlight `#F26A7A`, stem `#6B4A2B`) | `#E85D75` (pit `#C79A6B`) | `#B3122E` |

Scoring logic: the smaller and harder, the more points. The average base score per spawned fruit is **16.1** with the early weights and **18.9** with the late weights (used in the score-economy checks of section 7.6).

**Procedural drawing recipes** (all fruit: 5 px ink outline `#14141C`, flat fill, one darker shade shape on the lower-right, one white highlight arc at alpha 0.55 on the upper-left; sprites are pre-rendered once per type at 2x into offscreen canvases):

| Fruit | Recipe |
|---|---|
| Watermelon | Circle. 7 darker stripes as bezier arcs from top to bottom. Cut face: outer rind ring (0.08 r, `#4E9A48`), pale band (0.06 r), red flesh, 9 seeds |
| Pineapple | Ellipse 0.92 : 1.0 inside the collision circle. Diagonal cross-hatch lines. Crown of 5 pointed leaves above the body (outside the collision circle, up to +0.55 r) |
| Apple | Circle with a small dip at the top, stem and one leaf. Blush gradient towards the bottom. Cut face: cream flesh, star-shaped core with 5 seeds |
| Orange | Circle with 12 dimple dots. Cut face: 10 wedge segments around a pale centre |
| Pear | Two overlapping circles (top 0.62 r, bottom 1.0 r) fitting the collision circle, stem on top. Cut face: pale flesh, small core |
| Peach | Circle with a vertical crease curve (the peach seam) and small leaf. Cut face: golden flesh with a brown pit in the middle |
| Lemon | Ellipse 1.12 : 0.90 (lemon shape) with small nubs at both tips. Cut face: 8 wedge segments |
| Kiwi | Circle with brown fuzz dots, slightly wobbly outline. Cut face: green flesh, pale centre, ring of 18 black seeds |
| Strawberry | Heart/teardrop shape, leaf calyx on top, 14 seed flecks. Cut face: pink flesh with a white core |
| Cherry | Small circle plus a long curved stem (up to +1.0 r above, outside the collision circle). Cut face: red ring, pit |

Shape-distinct on purpose (not colour-only), so that colour-blind players can tell apple, strawberry and cherry apart.

### 4.2 Special bonus fruit: Golden Apple

| Property | Value |
|---|---|
| id | `golden` |
| r / hitR | 64 / **116** (x1.6 + 14, extra generous; was 83) |
| Score | **100** (doubled by Double). Counts as one member of a combo group |
| Extra effect | Classic: +1 life if below 3. Arcade: +3 s (round timer capped at 90 s remaining). Zen: score only |
| Rarity | eligible after 20 s, gap 35 s, 4% per wave with pity (section 3.4): about one per 50 s |
| Flight | higher and a little faster than normal: apexY 240 to 360 (launch speed 1470 to 1570 px/s at gScale 1.0), air time 2.26 to 2.42 s |
| Visual cue | gold skin `#F2B134` with `#FFE28A` shine, cream flesh `#FFF0B0`, radial glow ring at 1.5 r (alpha 0.35), 3 sparkle stars orbiting (1 turn per 1.2 s), a short dust trail of gold particles behind it (1 particle per 25 ms, life 0.4 s) |
| Sound cue | spawn: soft two-note chime; cut: shimmer arpeggio (section 10) |
| Cut juice | slow-motion 0.40x for 350 ms, gold splash, 24 gold particles, score popup "GOLDEN APPLE! +100" |

### 4.3 Bomb

| Property | Value |
|---|---|
| id | `bomb` |
| r / hitR | 64 / **54** (x0.85 and NO blade half width: the blade must really go through it; unchanged by the hit-area change, so the outer 10 px of the drawn bomb, whose body is about 64 px, can be grazed safely) |
| Effect | Classic: -1 life, combo group closes, regen progress resets. Arcade: **-50 points (floor 0) and -5 s**, combo group closes. Zen: does not exist |
| Trigger | only when the blade is in the **cutting state** (speed at or above the threshold) and the segment crosses `hitR`. Slow contact only makes the bomb wobble (rotation kick of +/-1.5 rad/s, no explosion) |
| Visual cue (readable in one glance, shape and pattern, not just colour) | near-black body `#22222B` with sheen arc `#3A3A46`, a vermilion band `#A82A18` around the middle, a paper-coloured `#EADFC8` **X** mark on the front, a rope fuse `#8A6B3E` on top with a flickering spark (`#FFC93C` core, `#F26A21` halo) and a pulsing **danger ring** (vermilion `#D9432B`, radius 1.2 r, alpha 0.5 to 0.9 at 2 Hz; static when "Reduce flashes" is on) |
| Sound cue | quiet fuse sizzle while a bomb is on screen (panned by x), 2-tick warning at telegraph, explosion on hit (section 10) |
| Speed | apexY 300 to 520, otherwise as regular arcs |

### 4.4 Power-ups (timed) and the Arcade clock

All power-up items are **medallions**: circle r = **62**, hitR = **107** (x1.5 + 14; was 78), double ink rim (5 px ink, 3 px inner paper ring), an icon centred at 0.7 r, and 8 small dots orbiting at 1.15 r (1 turn per second; static in "Reduce motion"). Cutting a medallion activates it; it **shatters into particles** (it has no halves). It costs nothing if missed. Re-collecting an active power-up refreshes it to full duration (no stacking of effect strength). Different power-ups may overlap (a bomb-free window is created by Freeze and Frenzy, section 3.4).

| id | Name | Duration | Effect (exact) | Weight | Colour | Icon | Visual cue while flying | Active cue |
|---|---|---|---|---|---|---|---|---|
| `freeze` | **Freeze** | 5.0 s real time | world `timeScale` = 0.40 (eased in over 200 ms, back out over the last 400 ms). Blade, timers and score rules unchanged | 35 | `#7FD1F0` | white six-arm snowflake with ink outline | pulsing cyan ring (alpha 0.35 to 0.60 at 1.5 Hz, static when "Reduce flashes"), 2 ice shards flake off per 300 ms | screen-edge frost vignette `#7FD1F0` alpha 0.22; blade glow turns cyan; HUD icon with shrinking ring; master audio low-pass (section 10) |
| `frenzy` | **Frenzy** | 6.0 s real time | switches to Frenzy waves (section 3.4); bombs suppressed; **missed fruit cost nothing** (Classic) during Frenzy | 30 | `#F26A21` with inner `#FFC93C` | ink flame | rising embers (2 per 100 ms) | warm background tint `#F26A21` alpha 0.10; blade glow turns orange; banner "FRENZY!" |
| `double` | **Double** | 10.0 s real time | every point awarded (fruit base, combo bonus, golden apple) is **multiplied by 2**. Penalties are not doubled | 35 | `#F2B134` | ink "x2" numerals (44 px) | 4 sparkle stars orbiting | HUD score turns gold `#F2B134` with a small "x2" seal; popups turn gold |
| `clock` | **Clock** (Arcade only) | instant | round timer +4 s (cap: 90 s remaining) | 25 | `#4A9E8A` | paper clock face with ink hands | small tick marks pulsing at 1 Hz | popup "+4 s" next to the timer |

Sound cues for each power-up (spawn cue when the medallion first crosses into the screen, activation cue when cut, end cue) are defined as WebAudio recipes in section 10.

### 4.5 Bomb telegraph

350 ms **before** a bomb is launched, a vermilion warning triangle (40 px wide, ink outline, small "!" in paper colour) appears on the bottom edge at the bomb's launch x (y = 1040), together with the two-tick warning sound; it disappears when the bomb leaves the spawn line. Purpose: bombs are fair, not ambushes. Static (no pulse) when "Reduce flashes" is on.

---

## 5. Slicing rules

### 5.1 Blade samples and speed measure

The input layer delivers **blade samples** `{t, x, y, discontinuity}` in playfield px (all three providers produce the same shape; section 8). `discontinuity = true` marks a re-centering snap, reconnect or tracking loss longer than 200 ms: the trail is broken and **no cut may be tested across that segment**.

- **Blade speed.** Real Joy-Con (relative pointer): the **tip speed in deg/s** of every IMU sample, the angular speed of the blade tip (the gyro vector without its roll about the blade axis); the cut decision is made in this unit and does not depend on the sensitivity. Mouse, debug swings and the simulator: the length of the polyline through the samples of the last **50 ms** (always at least the last 2 samples) divided by the time span, in px/s, divided by 10/3 to get deg/s-equivalent (300 deg/s = 1000 px/s). Both are independent of the input sample rate. The game, the trail and the audio read the **px/s-equivalent** (tip speed x 10/3), so nothing there changed.
- **Segment merging:** consecutive samples less than **6 px** apart are accumulated into the next segment (flush at least every 8 ms) so that very high input rates do not produce degenerate zero-length segments. Below 6 px per merged flush is treated as rest jitter.
- **Safety cap:** a real-Joy-Con IMU sample whose total angular speed exceeds **2190 deg/s** is ignored completely (treated as a glitch, warning `gyro_saturated`). The simulator's px/s cap is `2190 * pxPerDeg` (60,000 px/s at the default sensitivity); the mouse provider uses a fixed 60,000 px/s. The number sits just above a 2000 deg/s gyro full scale (UNVERIFIED-ON-HARDWARE, HW-10: the real range and saturation behaviour are not known).

### 5.2 Cutting state (threshold with hysteresis) [MUST]

| Parameter | Value |
|---|---|
| Cut threshold `T` (default) | **300 deg/s** of tip speed; user range 100 to 700, step 25; presets Easy 225, Normal 300, Hard 450 (1000 px/s-equivalent at Normal) |
| Mode multiplier | Classic and Arcade x1.0, **Zen x0.8** (240 deg/s at default) |
| Enter `CUTTING` | blade speed >= T |
| Leave `CUTTING` | blade speed < 0.65 x T (195 deg/s at default; 650 px/s-equivalent for Normal) |
| Swing continuity | a `CUTTING` re-entry within **100 ms** of leaving continues the same `swingId` (covers wrist reversals and speed dips); otherwise a new `swingId` starts |
| Minimum segment length for a cut | 6 px after merging (section 5.1) |

Only segments produced while the state is `CUTTING` can hit fruit, bombs, power-ups, the golden apple or menu targets. Below the threshold the blade is a harmless cursor. **Relative model only (real Joy-Con): a swing needs two samples at or above T at least 25 ms apart with none below 0.65 T between them (one stray sample never cuts), and the first chord of the path is delivered retroactively, so the cut starts one 33 Hz sample after the first fast sample but the delivered path starts at the sample before it.** Measured on the one real recording (aiming p99 253 deg/s, max 326; hard strokes 632 to 1049), 300 deg/s gives 0 % false CUTTING in every slow step and 21 of 21 strokes cut (Zen at 240 deg/s cuts about 2 % of the most vigorous aiming, which is harmless there: no bombs). Whether 300 deg/s separates deliberate swings from aiming and hand tremor for other people and for tense play is still **UNVERIFIED-ON-HARDWARE (HW-9)**; the live speed meter in settings exists so the owner can tune it on the real sword.

### 5.3 Collision (swept segment vs circle) [MUST]

For every physics tick, take **every** blade segment produced since the previous tick, in order, and test it against every cuttable object: the object is hit if the **shortest distance from the object centre to the segment is <= hitR**. Because whole segments are tested (not endpoints), a swing of any length or speed cannot tunnel through an object.

**The hit area is a capsule** (hit-area change after the first real Joy-Con session; owner feedback: "the hitbox of the fruit seems a bit too small"; the pointer is a relative gyro pointer sampled at 33 Hz, so aiming is less precise than with a mouse). The blade chord has zero thickness, but the player sees a trail that is up to 30 px wide, so the test gives the chord that width: the object circle is `round(r x multiplier)` (grows with the fruit) and the blade half width (14 px, constant) is added to it. `hitR` in the snapshot is the sum, so the debug overlay (`?debug=1`) draws exactly the region in which a swing cuts. The constants are `CONFIG.hitMul` and `CONFIG.hit.bladeHalfWidth`.

| Object | circle (x r) | blade half width | hitR | before |
|---|---|---|---|---|
| Fruit | 1.55 x r (table 4.1) | 14 px | round(1.55 r) + 14 (88 cherry to 157 watermelon) | 1.25 x r (60 to 115) |
| Golden apple | 1.6 x 64 = 102 | 14 px | 116 | 83 |
| Power-up medallion | 1.5 x 62 = 93 | 14 px | 107 | 78 |
| Bomb | 0.85 x 64 = 54 | **0** | 54 (unchanged: a bomb needs real contact; a graze that cuts a neighbouring fruit never explodes it) | 54 |

The constant part gives the small fruit the larger relative bonus: `hitR / r` is 1.71 for the watermelon and 1.83 for the cherry (before: 1.25 for both), and the cherry's hit radius grew by a factor 1.47 where the watermelon's grew by 1.37. The half width is never wider than what the player sees: it is below half of `blade.headWidth.max` (30 px).

**Measured against the drawn art** (13 whole sprites of `public/assets/manifest.json`, scaled the way `public/js/render/sprites.js` scales them, `r / body.r`; the visible body is the sprite with crown, stem, leaves and fuse removed by an opening of radius 40 px, the recipe of the body table in `docs/assets-integration.md` 1.5; the pivot is the object centre; "farthest" is the distance from the centre to the farthest body pixel, which decides whether a swing through the body can miss):

| Fruit | r | visible body radius (area equivalent) | farthest body pixel | art beyond the body (farthest art pixel: crown, stem, leaf, glow) | hitR before | hitR now | reach beyond the farthest body pixel, before / now |
|---|---|---|---|---|---|---|---|
| watermelon | 92 | 92 | 95 | 96 (no decoration) | 115 | 157 | 20 / 62 |
| pineapple | 82 | 70 | 101 | 137 (crown) | 103 | 141 | 2 / 40 |
| apple | 68 | 68 | 71 | 109 (stem and leaf) | 85 | 119 | 14 / 48 |
| orange | 68 | 68 | 70 | 70 (no decoration) | 85 | 119 | 15 / 49 |
| pear | 66 | 61 | 81 | 109 (stem) | 83 | 116 | 2 / 35 |
| peach | 64 | 64 | 71 | 96 (leaf) | 80 | 113 | 9 / 42 |
| lemon | 60 | 56 | 67 | 71 | 75 | 107 | 8 / 40 |
| kiwi | 58 | 55 | 60 | 62 | 73 | 104 | 13 / 44 |
| strawberry | 52 | 49 | 62 | 70 (calyx) | 65 | 95 | 3 / 33 |
| cherry | 48 | 48 | 51 | 149 (stem, 3.1 r from the centre) | 60 | 88 | 9 / 37 |
| golden apple | 64 | 63 | 68 | 97 (glow ring) | 83 | 116 | 15 / 48 |
| medallion | 62 | 62 | 64 | 64 | 78 | 107 | 14 / 43 |
| bomb (for reference) | 64 | 66 | 79 (fuse collar) | 131 (fuse) | 54 | 54 | the circle lies 10 px INSIDE the body |

Findings. (1) Even the old circles contained every visible body: a swing that crosses the visible body of a fruit cut it in 100 percent of 157 000 simulated crossings, and it still does (the rule "a swing through the visible body always cuts" holds with a margin of 33 to 62 px instead of 2 to 20 px, and `test/game/hitbox.test.js` checks it on the sprites). (2) What was missing was the margin: of the swings that pass within 20 px of the visible edge, only 60 percent (cherry), 70 percent (strawberry), 76 to 86 percent (the other fruit) and 99.9 percent (watermelon) cut before; now 100 percent cut, at every angle. The swings used are the 21 real swings of the first real recording (`recordings/imu-2026-09-30T18-42-24.jsonl` through `tools/replay-integrated.mjs`, 33 Hz chords of about 44 px, 490 to 2300 px of path), placed at random against the rotated sprites. (3) The pineapple, the pear and the strawberry are drawn smaller than `r` (tall-fruit fit, 0.86 to 0.95), so their body is long and thin and its farthest pixel is 1.3 to 1.4 times the area-equivalent radius; the multiplier 1.55 keeps at least 33 px beyond the farthest pixel of all three (1.45 would still keep 27 px, enough for the 20 px rule, if 1.55 turns out too generous on the real sword). (4) Crowns, stems and leaves stay outside the circle and do not collide: a swing that crosses only the cherry's stem tip, far above the fruit, does not cut it; of the swings that cross any art pixel (stem included) 89 percent cut the cherry, 100 percent the others.

Order within a segment: objects hit by the same segment are processed in ascending order of the **projection parameter** of their closest point along the segment (so the combo order follows the swing direction). An object can be hit only once (state `cut`). Objects use the position at the tick (fruit move at most 15.8 px per tick, negligible against hit radii).

### 5.4 Multi-cut combos [MUST]

A **combo group** collects fruit cuts that belong together:

- The group **opens** at the first fruit cut of a swing (`swingId`).
- Each further fruit cut joins the group if the same swing is still active (or ended less than **100 ms** ago) **and** the time since the previous cut in the group is at most **250 ms**.
- The group **closes** when 250 ms pass without a cut, or **150 ms** after the swing ends, or immediately when a bomb is hit. (Improvements round: both clocks are measured from when the last cut / segment ARRIVED at the game, not from the segment's own timestamp, which lags the frame clock by the input latency; the grace was 100 ms and is 150 ms so that a 100 ms delivery hiccup inside a swing does not split a combo.)
- The golden apple is a normal member of the group. A power-up medallion cut in the same swing is **not** a member: it neither joins the group nor extends the 250 ms window.
- A bomb hit closes the group at once; fruit cut **before** the bomb keep their combo bonus.

Combo members: all ten fruit types and the golden apple. Medallions are never members (they activate their power-up and nothing else).

**Scoring formula.** Base points per fruit are awarded immediately, multiplied by 2 if Double is active. When a group closes with **n >= 2 members**:

```
comboBonus(n) = 5 * n * (n - 1)      with n capped at 10
awarded       = comboBonus(n) * (Double ? 2 : 1)
```

| Members n | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10+ |
|---|---|---|---|---|---|---|---|---|---|
| Bonus | +10 | +30 | +60 | +100 | +150 | +210 | +280 | +360 | +450 (cap) |
| Banner | "COMBO x2" small | "COMBO x3" medium | "COMBO x4!" large + slow-mo | x5 | x6 | x7 (long slow-mo) | x8 | x9 | x10 |

The banner updates **live** as each member joins; the bonus popup appears at close. The best combo of a round is a statistic on the results screen.

### 5.5 Cut halves physics [MUST]

When a fruit is cut with blade direction unit vector `d` (direction of the segment that hit it) and normal `n = perp(d)`:

| Property | Half A (side +n) | Half B (side -n) |
|---|---|---|
| Position | fruit centre, offset 0.15 r along +-n (so they visibly split) | |
| Velocity | parent velocity + **240 px/s** x n + blade push | parent velocity - **240 px/s** x n + blade push |
| Blade push | `0.12 x bladeVelocity`, magnitude capped at 500 px/s, same for both halves | |
| Angular velocity | parent omega + U(2, 4) rad/s | parent omega - U(2, 4) rad/s |
| Gravity | same `g` as fruit (world-time scaled) | |
| Collision | none, cannot be cut again, never counts as missed | |
| Drips | each half spawns 2 juice droplets per 50 ms for 400 ms | |
| Removal | passes the cull line, or evicted by the 40-halves cap (150 ms fade) | |

Rendering: the fruit sprite clipped to the half-plane on that half's side of the cut line through the fruit centre, plus the **flesh face**: a strip of width 0.28 r along the cut chord filled with the flesh colour and its details (seeds, segments). Rasterise each half **once** into a small offscreen sprite at cut time, then draw it rotated every frame (canvas clipping per frame is too slow at 40 halves).

Also on cut: a **slash mark** through the fruit along the blade line, length 2.2 r, paper-white `#F4EBD9` with a 3 px ink edge, alpha 0.9 fading to 0 in 140 ms (200 ms and alpha 0.5 in "Reduce flashes").

---

## 6. Scoring and lives: rules at a glance

| Rule | Classic | Arcade | Zen |
|---|---|---|---|
| Base fruit score | table 4.1 (x2 with Double) | same | same |
| Combo bonus | `5 n (n-1)`, n capped at 10 (x2 with Double) | same | same |
| Golden apple | +100, and +1 life if below 3 | +100 and +3 s | +100 |
| Bomb | -1 life, closes the combo group, resets the life-regen counter | **-50 points (floor 0) and -5 s**, closes the combo group | does not exist |
| Missed fruit | -1 life (mercy window 1.2 s; free during Frenzy) | nothing (statistic only) | nothing (statistic only) |
| Lives | 3, maximum 3, **+1 for every 25 fruit cut** | none | none |
| Timer | none | 60 s, bonuses add time, remaining time capped at 90 s | 90 s |
| Round ends when | lives reach 0 | timer reaches 0 | timer reaches 0 |
| Power-ups | Freeze, Frenzy, Double | Freeze, Frenzy, Double, Clock | Freeze, Frenzy, Double |
| Cut threshold multiplier | x1.0 | x1.0 | **x0.8** |
| Gravity scale | 1.00 to 1.25 | 1.05 to 1.20 | 0.90 to 0.92 |

Common rules: a score never goes below 0. Popups show every change. Double multiplies awards only, never penalties. The score is an integer.

---

## 7. Modes

### 7.1 Classic

- **Start:** 3 lives (drawn as three apple icons, top-right), score 0, no timer. Bombs appear from 20 s on (section 3.1).
- **Losing a life:** an uncut standard fruit falls out of the screen (miss) or a bomb is cut. **Mercy window:** after any life is lost, uncut fruit that fall during the next **1.2 s** cost nothing (still recorded as missed for the accuracy statistic). A bomb always costs a life, whatever the window says.
- **Regeneration:** every **25 fruit cut** (cumulative counter, not a streak; the golden apple counts as one fruit) restores 1 life up to the maximum of 3. Each missing apple icon shows a thin progress arc towards the next life. A bomb hit resets the counter to 0.
- **End:** when lives reach 0 (the last life is lost) the game-over sequence starts (section 9.10).

**Decision: a bomb costs one life instead of ending the game.** Justification:

1. **Tracking uncertainty.** The cursor comes from integrated gyro orientation; a few degrees of drift is about 100 px. Instant death after two minutes of effort because the cursor was 100 px off feels like the controller's fault, which violates pillar 4 (fair failure). UNVERIFIED-ON-HARDWARE (HW-3): the real drift rate is not known.
2. **Session length and fatigue.** Sudden death would cut many sessions below the 2 to 4 minute target and waste the physical effort already spent.
3. **One simple mental model.** "You have three mistakes; a miss is a mistake and a bomb is a mistake." Players do not need to learn a second failure rule.
4. **Bombs still matter.** A bomb hit costs a life *and* resets the regeneration counter, so it is strictly worse than a miss, and the combo group of that swing closes on the spot. Bomb chance grows to 25% of waves at the plateau.
5. Purists are served by an optional setting, **[P2]** "Deadly bombs (Classic)": when on, a bomb ends the game immediately. Default off.

### 7.2 Arcade (60 s)

- **Start:** timer 60.0 s, score 0, no lives. Faster cadence than Classic (section 3.2), power-ups eligible from 8 s with a 12 s gap, bombs from 5 s.
- **Bomb:** **-50 points (floor 0) and -5 s**. If 5 s or less remain, the timer goes to 0 and the round ends.
- **Bonuses:** Clock +4 s, golden apple +3 s and +100; remaining time is capped at 90 s. Misses cost nothing.
- **Last 10 s:** the timer digits turn deep vermilion `#A82A18` and tick once per second (a scale pulse of 1.0 to 1.15 over 200 ms; colour change only in "Reduce flashes").
- **End at 0:** the world freezes for 300 ms, the banner "Time's up!" shows, results after 1.0 s. Fruit still flying cannot be cut any more.

### 7.3 Zen (90 s)

- **Start:** timer 90.0 s (shown small and calm at top-centre), no bombs, no lives, no penalties of any kind. Lower gravity, wider gaps between waves, cut threshold x0.8 (section 3.3).
- Power-ups Freeze, Frenzy, Double exist (first at 20 s, gap 25 s). Golden apple gives +100.
- **End at 0:** soft fade to the results screen (no freeze, no banner sound other than the bell).

### 7.4 Game over and results

The screen is described in section 12.10 (layout) and section 13 (strings). Content per mode:

| Stat | Definition |
|---|---|
| Score | final score |
| Best | best score stored for this mode; "NEW RECORD!" if the new score is strictly greater and above 0 |
| Rank | rank from the table in 7.6 |
| Fruit sliced | fruit cut (regular fruit plus golden apple) |
| Best combo | largest combo group size in the round (0 if none) |
| Accuracy | fruit cut / (fruit cut + fruit missed), whole percent, "-" when no fruit was thrown |
| Bombs hit | bombs cut (Classic and Arcade only; hidden in Zen) |
| Power-ups | power-up medallions collected |
| Duration | round length as m:ss |

Input lockout: the buttons on the results screen ignore cuts, dwell and clicks for **1.2 s** after the panel is fully visible: the 400 ms slide-in comes first, so the lockout ends 1.6 s after the screen starts (`CONFIG.results.slideInMs`, QA-03).

### 7.5 Local high scores and persistence

- One `localStorage` key, `joyconNinja.v1`, holding JSON: `{ best: { classic:{score,combo,date}, arcade:{...}, zen:{...} }, settings:{...}, safetyAck:boolean, playMsTotal:number }`. `date` is an ISO string.
- **Every access is wrapped in try/catch.** If storage is unavailable (private window, blocked site data, corrupted JSON) the game keeps everything in memory for the session, shows nothing to the player, and never throws.
- Only the best score and best combo per mode are stored. Nothing personal is stored; there is no network access at all.
- The "Reset high scores" setting clears `best` only.

### 7.6 Ranks and score economy (initial tuning)

| Rank | Classic | Arcade | Zen |
|---|---|---|---|
| Apprentice | 0 to 799 | 0 to 599 | 0 to 599 |
| Warrior | 800 to 1999 | 600 to 1299 | 600 to 1199 |
| Ninja | 2000 to 3999 | 1300 to 2199 | 1200 to 1899 |
| Master | 4000 to 6999 | 2200 to 3199 | 1900 to 2599 |
| Legend | 7000 and up | 3200 and up | 2600 and up |

Derivation (rough, to be re-tuned): Arcade throws about 154 fruit at an average base score of about 17.5, so cutting everything yields about 2700 base points; an engaged player cutting 50% to 70% with some 3-fruit combos lands around 1300 to 2200 (Ninja); above 80% cut, with combos and power-ups (Frenzy adds about 36 fruit, Double doubles 10 s of scoring), runs reach Master (2200) and Legend (3200). Zen throws about 148 fruit with easier cuts. Classic thresholds assume a 2:00 to 4:00 run (about 190 to 560 fruit thrown; at 88% accuracy that is roughly 3500 points at 2:00 and 9000 at 4:00, so an engaged player passes through Ninja, Master and Legend as the run gets longer). These thresholds are **tuning constants**, not promises.

**After the larger hit areas (section 5.3)** the same aiming earns more points: a bot that swings every 550 ms at the fruit nearest its apex with a lateral aim error of 40 / 80 / 120 px (80 seeded rounds per cell, `public/js/game` before and after) cuts 60 / 52 / 45 percent of the fruit in Arcade before and 70 / 65 / 58 percent now, and its Arcade score rises from 2370 / 1940 / 1610 to 3050 / 2680 / 2340 (about +30 to +45 percent: more cuts, and 40 to 60 percent more second-or-later cuts of a swing, so more and bigger combos). The rank mix of an aim error of 80 px moves from 76 percent Ninja, 20 percent Master to 18 percent Ninja, 66 percent Master, 16 percent Legend; in Classic (rounds also last longer because fewer fruit are missed) an aim error of 80 px moves from 78 percent Apprentice to 20 percent. **The thresholds above were NOT changed**: the derivation assumed the old, smaller hit areas, the shift is about one rank for the same aim, Apprentice to Legend all stay reachable and Legend stays rare for a realistic aim error (4 to 16 percent at 80 to 120 px; 34 to 51 percent only for an aim error of 0 to 40 px, which a gyro pointer does not give). They are still **UNVERIFIED-ON-HARDWARE (HW-2)**: re-tune the four lower bounds of each mode (for example by +25 percent in Arcade) after the first real sessions with the new hit areas.

---

## 8. Blade, cursor and input mapping

### 8.1 What the game needs from an input provider (design view)

All three providers (real Joy-Con 2 over BLE, simulator, plain mouse) deliver the same three things; the engineers own the exact interface.

| Item | Content |
|---|---|
| `aim` samples | `{t, x, y, discontinuity}` in playfield px, clamped to 0..1920 x 0..1080, emitted at the source's native rate (Joy-Con: per IMU packet; simulator: synthetic 250 Hz; mouse: per pointer event including coalesced events) |
| `actions` | edge events `confirm`, `back`, `pause`, `recenter`, each with a display label for the UI (e.g. the Joy-Con button name or "Space") |
| `status` | `state` (idle, connecting, connected, lost), `side` (left, right, unknown), `battery` (0 to 100 or null), `trackingOk` (bool) |

Default action mapping (design constraints, exact Joy-Con buttons are decided by the protocol research; **UNVERIFIED-ON-HARDWARE HW-6**: whether any button is comfortably reachable with the Joy-Con strapped to a sword):

| Action | Keyboard | Mouse / simulator | Joy-Con (constraint) |
|---|---|---|---|
| `confirm` | Enter | left click | any face button |
| `back` | Esc | right click | a second face button |
| `pause` | P or Esc during play | middle click | a small system-class button that is hard to hit by accident mid-swing |
| `recenter` | Space | Space or double click | a shoulder or trigger button reachable by the index finger of the gripping hand |

**Every action has a no-button path**, because the buttons may be unreachable on a sword: menu items can be cut or selected by dwell (section 12.6), calibration accepts "hold still 3 s", pause happens automatically on disconnect and on window blur, and re-centering happens automatically at rest (8.3).

### 8.2 Orientation to screen (design intent for the motion pipeline)

- The **pointing direction of the sword** (yaw about the vertical axis, pitch about the horizontal axis; roll about the sword's own axis is **ignored**) relative to the reference set at calibration maps linearly to the screen:
  - **Real Joy-Con (sword tuning round, 2026-09-30): a RELATIVE, mouse-like pointer in the local frame of the sword.** The first real test showed that the absolute mapping below (27.4 px per degree, 70 degrees across the screen) pushed the cursor to the screen edge at every normal change of arm posture, and that yaw has no absolute reference (no magnetometer). The cursor now moves by the speed and direction of the blade TIP: `F(s) = sensitivity * (s - 5) * (5 + 9 * smoothstep(min(1, (s - 5) / 300)))` px/s for a tip speed `s` deg/s above the dead zone of 5 deg/s (tremor measured 1.7 to 3.1 deg/s median, 4.7 to 12.6 p90), i.e. 5 px per degree when aiming slowly rising to 14 px per degree from 305 deg/s on; `sensitivity` 0.3 to 2.0 in steps of 0.1, **default 1.0**, multiplies the curve and nothing else (presets Relaxed 0.6, Standard 1.0, Fast 1.5). Roll about the blade moves nothing. (Round F1: the VERTICAL component follows the elevation of the tip, measured against gravity, with its gain capped at 6 px per degree; the recording's horizontal slashes kept 94 % of their cutting samples in the middle half of the screen height instead of 10 %; `docs/motion-contract.md` 2.9.) A slow 70 degree sweep moves the cursor about a fifth of the screen, a firm slash of 137 degrees crosses it once; a change of posture of 30 + 20 degrees moves it 133 px (the absolute pointer: 996 px). UNVERIFIED-ON-HARDWARE (HW-2): comfort of the curve is a first guess from one recording.
  - **Simulator** (a mouse in disguise) keeps the absolute mapping:
  - `x = 960 + yawDeg * pxPerDeg`
  - `y = 540 - pitchDeg * pxPerDeg` (pointing up moves the cursor up)
  - `pxPerDeg = 27.4 * sensitivity`, sensitivity 0.3 to 2.0 in steps of 0.1, **default 1.0**
- For the simulator 27.4 px per degree is 1920 / 70: the screen spans 70 degrees horizontally and 39.4 degrees vertically, the same scale on both axes (no stretching).
- Real Joy-Con: no yaw drift to manage (nothing is integrated into an absolute angle), gravity fusion only for the vertical rate (round F1). The pipeline must not assume how the Joy-Con is mounted: the sword frame comes from the calibration (section 12.5). Simulator: yaw comes from gyro integration (it drifts), pitch from gravity/accelerometer fusion.
- The cursor is **clamped** to the playfield. Requirement: the player can reach every point of the screen; the cursor is never stuck at an edge (real Joy-Con: turning back moves it back at once, and the idle glide returns it after 1 s; simulator: edge slip).
- Left and right Joy-Con use the same mapping; axis sign differences are the provider's job (UNVERIFIED-ON-HARDWARE, HW-11: axis conventions and automatic side detection are assumptions).

### 8.3 Re-centering (design intent with numbers)

| Mechanism | Behaviour |
|---|---|
| **Manual** (`recenter` action) | Sets the reference so that the current pointing direction is the screen centre (960, 540) (real Joy-Con: puts the cursor at the centre). Cursor eases to the centre over **150 ms**; the samples during the ease are flagged `discontinuity` (no cutting), then a toast "Crosshair recentered" for 800 ms. Allowed at any time, also during play, no penalty. **Exception (sword tuning round): a press while the blade is cutting or moves at 100 deg/s or more, and for 250 ms afterwards, is ignored**, because a grip press during a swing (seen in the real recording) would break the cut |
| **Automatic soft centring** (setting "Auto-recenter", default on) | **Real Joy-Con:** when the blade tip is at rest (tip speed below **8 deg/s** for **1.0 s** and no `CUTTING` in the last **500 ms**) the cursor glides to the centre at 2.5 per second of its distance, between 120 and 800 px/s, ramped in over 300 ms (from a corner in about 2.5 s; the real recording: within 100 px after 1.33 to 2.50 s from four places, hold time included). It stops at once when the tip speed exceeds **14 deg/s**, never runs while cutting, and the cursor it moves never starts a dwell. **Simulator:** when the sword is at rest (gyro angular speed below **8 deg/s** for **1.0 s**, no `CUTTING` in the last **500 ms**) the reference slews so that the cursor drifts towards the centre at **3 deg/s** (82 px/s at default sensitivity), stopping at the centre or above 12 deg/s (the simulator runs with auto-centring off) |
| **Edge slip** (simulator only) | If the raw (unclamped) aim is beyond the playfield by more than 8 degrees for more than 0.5 s, the reference is dragged at 20 deg/s so the cursor is not pinned at the edge. A real Joy-Con has no references: turning back moves the cursor back at once |
| **After a reconnect** | Mandatory quick re-centre: hold still for 1.5 s (texts `disc.recovered` and `disc.recentering`), then the manual step of section 12.5 (step 3 only) |

UNVERIFIED-ON-HARDWARE (HW-3): the drift rate, the rest threshold and the slew rate are assumptions. They are separate constants so they can be tuned in minutes once the real sword is available.

### 8.4 Blade trail

The trail is built from the newest samples at render time. **No `shadowBlur`** anywhere (too slow); glow is a wider stroke at low alpha.

| Property | Value |
|---|---|
| History window `W` | not cutting: **120 ms**; cutting: `160 + 80 * clamp((v - T) / 2500, 0, 1)` ms (160 to 240 ms); at most 48 points |
| Head width | not cutting: **4 px**; cutting: `lerp(16, 30, clamp((v - T) / 3000, 0, 1))` px |
| Taper | width at age `a` = `headWidth * (1 - a / W)^1.2`, reaching 0 at the tail (drawn as one tapered polygon through quadratic mid-points) |
| Fade | the trail is never cut off: after the swing ends, points simply age out over `W`, so it thins away in at most 240 ms. On a `discontinuity` sample the trail is cleared at once |
| Layers (back to front) | 1. glow: same polygon stroked 14 px wider in the edge colour at alpha 0.35; 2. body fill in the core colour (alpha 1 when cutting, 0.35 when not); 3. 2.5 px ink outline (cutting only) |
| Idle trail (not cutting) | core `#8A8175`, no glow, 4 px, alpha 0.35: shows where the sword moved without implying it cuts |

**Colour by speed** (`v` = blade speed, `T` = current cut threshold; linear interpolation in RGB between stops, clamped at both ends):

| Stop | Speed | Core colour | Edge / glow colour | Head width |
|---|---|---|---|---|
| Idle | below T | `#8A8175` | none | 4 px |
| Cut | T (1000 at default) | `#14141C` sumi ink | `#D9432B` vermilion | 16 px |
| Fast | T + 1200 (2200) | `#14141C` | `#F2B134` gold | 24 px |
| Max | T + 3000 (4000) or faster | `#FFF3D1` cream | `#F2B134` gold | 30 px |

Overrides while a power-up is active: the glow colour becomes `#7FD1F0` (Freeze) or `#F26A21` (Frenzy); Double changes nothing on the blade (it changes the score instead).

### 8.5 On-screen cursor (shows where the sword points, also when not cutting)

The cursor is drawn above the HUD, popups and toasts, below full-screen effect overlays, and is drawn again above any open panel; it always sits at the newest sample.

| State | Look |
|---|---|
| Idle | ring of radius 24 px, stroke 5 px ink `#14141C` with a 3 px paper `#F4EBD9` outer stroke (readable on any fruit colour), centre dot radius 7 px vermilion `#D9432B` with 2 px paper outline, alpha 0.9. Overall diameter about 60 px (visible from 3 m) |
| Cutting | ring replaced by a filled vermilion disc of radius 22 px with paper outline, growing to 26 px over 60 ms; gives instant feedback that "the blade is live" |
| Tracking lost (no fresh sample for 200 ms or `trackingOk` false) | alpha 0.35 and three small dots under the ring |
| Re-centring | ring shrinks and re-expands over 150 ms |
| Menu dwell | a 6 px vermilion progress arc grows around the ring over 900 ms while it is held on a target |

---

## 9. Juice

Everything here is presentation; none of it may change gameplay outcomes or RNG streams (all cosmetic randomness uses `rngFx`).

### 9.1 Particles

| Effect | Count | Parameters |
|---|---|---|
| Juice droplets (each fruit cut) | 14 (7 in "Reduce motion") | circles r uniform 3 to 8 px; speed uniform 300 to 900 px/s; directions: 80% within a 50-degree cone around +-n (blade normal, half each side), 20% random; gravity as fruit; life uniform 0.5 to 0.9 s; alpha 1 fading over the last 40% of life; colour = fruit juice colour |
| Flecks (seeds, skin bits) | 6 (3) | 2 to 4 px squares/circles in skin or seed colour; speed 200 to 600 px/s; life 0.6 to 1.0 s |
| Bomb explosion | 40 sparks (20), 20 smoke puffs (10), 1 shockwave ring | sparks `#FFC93C` / `#F26A21`, speed 400 to 1400 px/s, life 0.35 to 0.7 s, drawn as streaks of length speed x 0.03; smoke `#3A3A46` alpha 0.5, radius 20 growing to 70, drifting up 60 px/s, life 1.0 s; ring paper-white to transparent, radius 0 to 380 px over 450 ms (alpha at most 0.35 in "Reduce flashes") |
| Combo n >= 4 | 24 ink stars (n >= 7: 48) | four-pointed stars in gold `#F2B134`, vermilion `#D9432B`, indigo `#1F3A5F`, speed 300 to 800 px/s, life 1.0 s, spawned at the centroid of the members' cut points |
| Golden apple | 24 gold particles + 3 star sparkles | as above |
| Medallion shatter | 24 shards | the medallion's colour |

Global cap 400; when exceeded, the oldest particles are dropped first.

### 9.2 Splashes that stain the background

- Every fruit cut adds **one splat**: a main blob of radius uniform 0.9 to 1.5 x r (an irregular shape of 12 to 16 lobes with radius noise +/-25%) plus **5 to 9 satellite droplets** of radius 0.06 to 0.20 x r at a distance of 1.2 to 2.4 x r, 60% of them along +-n, the rest random. Colour = juice colour at alpha 0.55. Cut bomb: an **ink soot splat** `#14141C` alpha 0.5, radius 130 px, 8 speckles.
- **Life:** hold 1.5 s at full alpha, then fade linearly to 0 over 4.5 s (6 s total). At most **24** splats; when exceeded, the oldest fades out over 300 ms.
- **Drawing:** on a layer between the paper background and the objects, with `multiply` compositing so stains look like pigment soaked into paper. Use **pre-rendered 256 x 256 splat sprites** (10 juice colours x 3 shape variants) drawn with rotation, scale and alpha; do not regenerate blobs each frame.
- Unaffected by "Reduce flashes" and "Reduce motion" (they are static).
- **With the generated art (section 11.6):** for a juice colour that has a splash picture (`fx_splash_<id>`, one per fruit and one for the Golden Apple), the stain is that picture, baked once into one 320 x 320 sprite and drawn with the same rotation, size, `multiply` compositing and alpha as the procedural blobs, so the footprint and the timing do not change. The ink soot stain of a bomb and every particle stay procedural.

### 9.3 Slow motion (world `timeScale`, real-time durations)

| Trigger | Scale | Real duration | Notes |
|---|---|---|---|
| Combo reaches n = 4 (once per group) | 0.35 | 450 ms | |
| Combo reaches n >= 7 | 0.25 | 800 ms | replaces the n = 4 slow-mo of the same group |
| Bomb near-miss | 0.50 | 250 ms | see below |
| Golden apple cut | 0.40 | 350 ms | |
| Last life lost (game over) | 0.30 | 700 ms | ignores the cooldown |
| Freeze power-up | 0.40 | 5.0 s | section 4.4 |

The first three share a **3 s global cooldown** (no slow-mo spam). Effective scale is always the minimum of the active scales (section 2.2). Audio: a master low-pass dip (section 10).

**Near-miss rule:** while the blade is `CUTTING`, if the distance from a bomb's centre to the blade segment is greater than its hitR (54) and at most **120 px**, and the bomb is on screen, and that bomb has not triggered it before, and 2 s have passed since the last near-miss: trigger slow-mo 0.50x for 250 ms, a bomb wobble, the popup "So close!" and the near-miss sting. It rewards a daring swing and never punishes. **The swing must have PASSED the bomb** (improvements round, QA-02): while the blade is still closing in (the closest point of the chord is its end point) nothing is decided, because the same swing may be about to hit the bomb, and "So close!" with slow motion must never precede a real explosion. Passing means the closest point lies behind the end of the chord, for a swing that was seen closing in inside the band, or in the middle of the chord; a swing that starts inside the band and moves away from the bomb earns nothing.

### 9.4 Screen shake

Offset = `A * decay(t) * (sin(2 pi f t + phiX), sin(2 pi f 1.3 t + phiY))` with `f = 26 Hz`, phases from `rngFx`, `decay` falling linearly from 1 to 0 over `D`. Simultaneous shakes take the **maximum** amplitude, never the sum. Applied as a translate of the whole game layer, not the HUD.

| Event | A (px) | D (ms) |
|---|---|---|
| Bomb hit | 22 | 500 |
| Combo n >= 8 | 12 | 220 |
| Combo n >= 5 | 8 | 160 |
| Life lost (miss) | 8 | 200 |
| Golden apple | 6 | 150 |
| Game over | 14 | 400 |

### 9.5 Hit-stop and zoom punch

- **Hit-stop:** on a bomb hit the *world* freezes for 60 ms (blade and UI keep running), then the explosion plays.
- **Zoom punch:** on combo n >= 5 and on bomb hit the game layer scales about the screen centre 1.00 to 1.03 in 60 ms and back in 240 ms.

### 9.6 Score popups

| Popup | Look | Motion |
|---|---|---|
| Base points "+15" | 44 px, fill = the fruit's juice colour, 5 px ink stroke (stroke drawn first, then fill); gold `#F2B134` while Double is active | rises 70 px over 700 ms (ease-out cubic), alpha 1 until 450 ms then to 0 at 700 ms; spawned at the fruit centre |
| Combo bonus "+60" with the label "COMBO" (28 px) above | 64 px gold with ink stroke | rises 90 px over 900 ms; spawned at the centroid of the members' cut points |
| Penalty "-50" and "-5 s" | vermilion `#D9432B` with ink stroke; the "-5 s" pops next to the timer | as base |
| Other popups | "Missed!", "So close!", "+1 life", "+4 s", "GOLDEN APPLE! +100" | as base, sized 44 px (the golden one 64 px) |
| Bomb hit "BOMB!" | 110 px display serif, vermilion `#D9432B` with 8 px ink stroke, at the bomb's position (clamped inside the screen) | scale 1.4 to 1.0 in 120 ms, holds 500 ms, fades 200 ms (fade only with "Reduce motion") |

If a new popup lands within 60 px of a live one it is offset by 50 px in x (alternating sides). Cap 12 (oldest dropped). "Reduce motion": popups do not rise; they fade in place over 700 ms.

### 9.7 Combo banner

Text "COMBO x{n}!" in the display serif, size by n (2: 84 px, 3: 110 px, 4 or more: 132 px). It sits on a horizontal **brush-stroke band** (procedural: ink `#14141C` alpha 0.88, about 1100 x 150 px with rough edges) centred at (960, 290); the word is paper `#F4EBD9` and the "x{n}" is gold `#F2B134` (contrast 15:1 and 9.7:1). Animation: scale 1.6 to 1.0 in 180 ms (ease-out-back), stays 700 ms after the last member joins, fades over 250 ms. **Drawn behind the objects** (above the stains) so it never hides a fruit. "Reduce motion": no scale, fade in 120 ms.

### 9.8 Full-screen flashes and vignettes

| Event | Effect (normal) | With "Reduce flashes" |
|---|---|---|
| Bomb hit | paper-white overlay alpha 0.55, in 80 ms out 260 ms, plus vermilion vignette alpha 0.30 | **no overlay**; ink-red vignette alpha 0.18 ramping over 400 ms |
| Life lost | vermilion vignette alpha 0.30, 300 ms in and out | alpha 0.15, 600 ms |
| Frenzy starts | orange `#F26A21` overlay alpha 0.25, in 80 ms out 400 ms | edge vignette alpha 0.12 |
| Freeze starts | cyan-white overlay alpha 0.30, in 80 ms out 400 ms | edge frost vignette alpha 0.15 |
| Golden apple / new record | gold overlay alpha 0.20, in 80 ms out 300 ms | none |

**Flash limiter (always on):** at most one full-screen luminance flash per **500 ms** (so never more than 2 per second, below the 3 per second guideline), each with at least 80 ms in and 250 ms out, and maximum overlay alpha 0.6. No object or UI element in the game blinks faster than 3 Hz.

### 9.9 Life lost feedback

The leftmost remaining apple icon in the HUD cracks in two and drops out of the screen over 400 ms; vignette per 9.8; shake per 9.4; sound `lifeLost`. A "Missed!" marker (44 px) appears at the bottom edge at the fruit's x for 600 ms (only for misses).

### 9.10 Game-over sequence (Classic) timeline

| t | Event |
|---|---|
| 0 | last life lost: slow-mo 0.30 for 700 ms, sound `gameOver`, shake per 9.4 |
| 0 to 500 ms | screen dims to ink alpha 0.55 |
| 700 ms | world resumes normal speed (fruit fall out) |
| 800 ms | results panel slides up from below over 400 ms (fade only with "Reduce motion") |
| 1200 ms | panel fully visible; the 1.2 s input lockout starts (section 7.4) |

### 9.11 Performance rules for juice [MUST]

- No `shadowBlur`, no `filter`, no per-frame large gradients: pre-render backgrounds, vignette, fruit sprites, splat sprites, half sprites.
- Caps: 12 uncut fruit (16 in Frenzy), 40 halves, 400 particles, 24 splats, 12 popups, 24 audio voices.
- **Art images follow the same rules:** every sprite is scaled once per size and device-pixel step and cached, nothing is scaled or allocated per frame, stage layers are loaded lazily per stage (at most two stages in memory) and a stage is drawn as one pre-composed picture while nothing shakes. The one-shot effects (bomb explosion, slice flash) live in a small fixed pool. No `shadowBlur`, no `filter`.
- **Auto-degrade:** if the average frame time exceeds 20 ms for 2 s, in this order: halve particle counts, cut the splat cap to 12, drop the backing-store scale to 1.0. Show nothing to the player; log it in the debug overlay.

### 9.12 The two accessibility toggles

| Toggle | What it changes |
|---|---|
| **Reduce flashes** | no full-screen overlays (vignettes only, table 9.8); pulsing rings (bomb danger ring, Freeze ring, bomb telegraph) become static; slash marks 200 ms at alpha 0.5; sparkle and star particles reduced by 70%; ink stars replaced by a single soft ring; last-10-s timer changes colour only, no pulse |
| **Reduce motion** | no screen shake, no zoom punch, no hit-stop; particle counts halved and speeds x0.7; popups and banner do not move or scale (fade only); orbiting dots and sparkles static; juice slow-motion stays (Freeze is unchanged) but its minimum scale is raised to 0.5 |

Both default to off, except that **"Reduce motion" defaults to on if the browser reports `prefers-reduced-motion: reduce`**. The first-run safety screen (section 12.2) offers "Reduce flashes" directly. In the settings screen each of them (and "Auto-recenter" and "Hold to select") is a two-cell switch that reads **On** and **Off**.

With the generated art (section 11.6) the toggles keep their meaning: "Reduce flashes" shortens and dims the bomb explosion picture (300 ms, alpha at most 0.7, no scale animation) and keeps the slice flash at 200 ms and alpha 0.5; "Reduce motion" turns off the slow drift of the night backdrop, the parallax offsets and the crossfade between backdrops (a change of stage is a cut).

---

### 9.11 The restyle round (final state of the effects)

What the effects engineer built on top of 9.1 to 9.10 (details and measurements: `docs/contract-notes.md`, effects engineer entry of 2026-10-01; presentation only, no game number changed): a cut gives **18 droplets, 3 streak droplets and 8 flecks** (not 14 and 6), a decal (hold **1000 ms** and fade **2500 ms**, not 1.5 s and 4.5 s) and a paper-white slice flash; from the swing's second cut a **camera punch and a 40 to 60 ms hit hold** (the objects stay where the previous frame drew them while the blade, the HUD and the effects keep running; none during Freeze or with Reduce motion); the **combo banner** sits on a baked ink plate whose gold work grows by tier (gold underline from x3, double rule from x4, vermilion plate with speckle from x7) with ink stars at 3, 4 and 7 cuts; the **bomb** is an explosion picture 8 radii wide, two shockwave rings, smoke, falling ink droplets, a red vignette and a 160 px `BOMB!` slam; the **Golden Apple** has turning light rays; **Freeze** an ice vignette, edge frost and snow motes, **Frenzy** an orange edge vignette and embers, **Double** a gold flash and an "x2" badge; the **blade** has glow, outline, core, speed streaks and sparks, and colours by speed; a lost life **cracks the HUD apple**, and `GAME OVER` or `TIME'S UP!` slams in at 160 px. The UI engineer added: the ink-brush wipe between menu screens (185 ms cover, 20 ms paper, 195 ms reveal; a 120 ms cross-fade with Reduce motion), the logo drop, the fruit bob, the focus ring pulse, the button squash, the countdown numerals with a shockwave, the HUD score roll and pop, the combo meter, the timer urgency ring, the results count-up with the rank stamp, and the section hop. The audio engineer added layered slice sounds, a combo arpeggio, sub-buses with ducking, a shared room reverb and a safety soft clip (`docs/contract-notes.md`, audio engineer entry). Every one of these has a Reduce motion or Reduce flashes variant, and none has been seen or heard on the owner's hardware (UNVERIFIED-ON-HARDWARE: the look on the real screen, the sound by ear). The final integration changed one thing: the power-up banner (`FREEZE!`, `FRENZY!`, `DOUBLE!`) is drawn on the tier 2 plate stretched to 214 px, with the title and the subtitle moved, because the gold underline of the tier 3 plate struck through the subtitle (`docs/qa/final/freeze-active.jpg`).

## 10. Audio: synthesised with WebAudio, no sample files

### 10.1 Global signal chain

`voices -> sfxBus (GainNode 1.0) -> DynamicsCompressor (threshold -14 dB, knee 12, ratio 4, attack 0.003 s, release 0.12 s) -> masterFilter (BiquadFilter lowpass, 20000 Hz, Q 0.7) -> masterGain -> destination`.

- `masterGain = 0.8 * volume^2` (volume 0 to 1, default 0.7, so 0.39): a squared curve feels linear to the ear.
- One shared 2 s white-noise `AudioBuffer` (cosmetic randomness: `Math.random` is fine here) is created once; noise voices start at random offsets.
- Positional cues use a `StereoPannerNode` with `pan = clamp((x - 960) / 960 * 0.7, -0.7, 0.7)`.
- Envelope convention: 3 to 5 ms linear attack (no clicks), then `exponentialRampToValueAtTime(0.0001, ...)` to the stated end time. "Gain" values below are pre-bus peak amplitudes.
- **Autoplay policy:** the `AudioContext` is created or resumed inside the first user gesture (the connect button, a key press or a pointer down). Until then the game runs silently and never throws. On `visibilitychange` hidden, suspend; on visible, resume.
- **Voice limit 24.** Priority: bomb > life > combo > power-up > slice > UI. When the limit is hit, drop the oldest voice of the lowest priority.
- Notation: `sine 660 Hz 80 ms` means an oscillator of that type at that frequency with that total envelope length; `A -> B` is an exponential frequency glide; "pentatonic" means semitone offsets [0, 2, 4, 7, 9, 12, 14, 16, 19, 21].

### 10.2 Gameplay sounds

| Id | When | Recipe |
|---|---|---|
| `swoosh` | continuous while `CUTTING` (one voice) | noise -> bandpass (centre `500 + 2700 * clamp((v - T) / 4000, 0, 1)` Hz, Q 1.2) -> gain; target gain `0.08 + 0.20 * clamp((v - T) / 4000, 0, 1)` while cutting, 0 otherwise, smoothed with `setTargetAtTime` time constant 20 ms; release tail 120 ms; panned by blade x |
| `slice` | each fruit cut (three layers) | (a) crack: noise -> highpass 1500 Hz, gain 0 to 0.45 in 3 ms, exponential to 0.0001 at 90 ms. (b) wet pop: sine gliding `f0 -> 0.28 f0` over 110 ms, `f0 = (900 - 5 r) * 2^(k/12)` Hz (r = fruit radius, so 660 Hz for the cherry, 440 Hz for the watermelon; `k` = pentatonic semitone of the fruit's index in the current combo group, capped at 21; random +/-6%), gain 0.35 fading to 0.0001 at 110 ms. (c) squelch, only if r >= 80: noise -> lowpass 600 Hz, gain 0.35 decaying over 160 ms. Panned by fruit x |
| `comboChime(n)` | when a group closes with n >= 2 | for `i < min(n, 5)`: at `0.06 * i` s a sine plus a triangle (+5 cents) at `523.25 * 2^(pentatonic[i]/12)` Hz, 4 ms attack, 220 ms decay, gain 0.18. If n >= 4 add a gong: sine 196 Hz gain 0.25 decaying over 1.2 s plus sine 392 Hz gain 0.08 decaying over 0.8 s |
| `bombFuse` | loop while any bomb is on screen | noise -> bandpass 5000 Hz Q 8 -> gain 0.03 with a 30 Hz tremolo (depth 0.5); panned to the nearest bomb |
| `bombWarn` | at telegraph start | two triangle ticks at 300 Hz, 30 ms each, 150 ms apart, gain 0.25, panned |
| `bombBoom` | bomb hit | (a) crackle: noise -> highpass 4000 Hz, gain 0.6 to 0.0001 in 20 ms; (b) body: noise -> lowpass sweeping 2000 -> 80 Hz over 0.7 s, gain 0.9 to 0.0001 over 0.9 s; (c) sub: sine 90 -> 35 Hz over 0.5 s, gain 0.8 to 0.0001 at 0.6 s |
| `bombNear` | near-miss | sine 900 -> 300 Hz over 200 ms gain 0.15 to 0; plus noise -> highpass 3000 Hz, 60 ms, gain 0.12 |
| `lifeLost` | life lost | sine 160 -> 60 Hz over 250 ms gain 0.5 to 0; noise -> lowpass 400 Hz, 120 ms, gain 0.25; then two triangle notes E4 (329.6 Hz) and C4 (261.6 Hz), 130 ms each, starting at +50 ms, gain 0.22 |
| `miss` | fruit falls (Classic only; skipped if `lifeLost` plays at the same time) | sine 300 -> 120 Hz over 120 ms, gain 0.15 |
| `golden` | golden apple cut | six sine partials at 1319, 1568, 1760, 2093, 2349, 2637 Hz, each starting 45 ms after the previous, 4 ms attack, 350 ms decay, gain 0.12; plus sparkle: noise -> highpass 6000 Hz, 150 ms, gain 0.08 |
| `goldenSpawn` | golden apple enters the screen | two sine notes 1568 Hz then 2093 Hz, 90 ms apart, 250 ms decay, gain 0.10, panned |
| `slowmo` | any slow-motion start | master lowpass 20000 -> 1800 Hz over 60 ms, back to 20000 Hz over 300 ms (skipped while Freeze holds its own filter); plus sine 300 -> 90 Hz over 350 ms, gain 0.15 |
| `recenter` | manual or automatic re-centre completes | sine 880 Hz 60 ms gain 0.08 |

### 10.3 Power-up sounds

| Power-up | Spawn cue (enters screen, panned) | Activation cue (cut) | End cue |
|---|---|---|---|
| Freeze | sines 2093 Hz + 3136 Hz, 500 ms decay, gain 0.12 each ("crystal ping") | noise -> highpass 4000 Hz, 0.8 s decay, gain 0.3; sine 1200 -> 200 Hz over 0.6 s, gain 0.18; **master lowpass to 2500 Hz over 150 ms and held** while Freeze is active | 1.0 s before the end: three ice-crack ticks (noise -> highpass 5000 Hz, 40 ms, gain 0.12, 60 ms apart); at the end the master lowpass returns to 20000 Hz over 300 ms |
| Frenzy | sawtooth 220 -> 440 Hz over 300 ms through a lowpass at 1200 Hz, gain 0.10 to 0; plus noise -> bandpass 1500 Hz with a 4 Hz amplitude LFO, 300 ms, gain 0.05 | sawtooth 110 Hz + 165 Hz through a lowpass sweeping 300 -> 2400 Hz over 0.4 s, gain 0.20 to 0 over 0.6 s; plus a noise burst of 0.1 s | sine 880 -> 660 Hz over 150 ms, gain 0.10 |
| Double | square 988 Hz for 60 ms then 1319 Hz for 250 ms through a lowpass at 3000 Hz, gain 0.08 ("coin") | triangle 1319 Hz + 1976 Hz together, 400 ms decay, gain 0.15 each, plus a second strike at +80 ms ("ka-ching") | sine 880 -> 660 Hz over 150 ms, gain 0.10 |
| Clock | triangle clicks: 1000 Hz 25 ms, then 750 Hz 25 ms at +120 ms, gain 0.15 | sine 1568 Hz, 400 ms decay, struck at 0 and at 150 ms, gain 0.15; then four fast ticks (triangle 1200 Hz, 15 ms, 60 ms apart) | none |

### 10.4 Round, UI and calibration sounds

| Id | Recipe |
|---|---|
| `countdown` | sine 660 Hz 100 ms gain 0.2 on each of "3", "2", "1" |
| `go` | sine 990 Hz 300 ms gain 0.25 plus noise -> highpass 2000 Hz 100 ms gain 0.15 |
| `tick` | last 10 s of a timed round, once per second: triangle 1000 Hz 30 ms gain 0.12; during the last 3 s 1400 Hz |
| `gameOver` | three triangle notes A3 (220), F3 (174.6), D3 (146.8) Hz, 250 ms each, lowpass 900 Hz, gain 0.25; then a gong: sine 110 Hz, 1.6 s decay, gain 0.3, at +0.75 s |
| `timeUp` | bell: sines at 880, 2429, 4752 Hz (ratios 1, 2.76, 5.4) with gains 0.2, 0.1, 0.05, all decaying over 1.5 s |
| `record` | arpeggio of sine + triangle: C5 523.25, D5 587.33, E5 659.25, G5 783.99, C6 1046.5 Hz, 80 ms apart, 300 ms decay, gain 0.18 |
| `uiMove` | triangle 1200 Hz 30 ms gain 0.08 (cursor enters a menu target) |
| `uiSelect` | sine 660 Hz 80 ms then 880 Hz 80 ms, gain 0.15 |
| `uiBack` | sine 660 Hz 80 ms then 440 Hz 80 ms, gain 0.15 |
| `connectOk` | sine 660 Hz 100 ms then 990 Hz 200 ms, gain 0.15 |
| `disconnect` | triangle 440 Hz 150 ms then 330 Hz 150 ms, gain 0.2; plus noise -> lowpass 800 Hz, 100 ms, gain 0.1 |
| `calStep` | sine 784 Hz 120 ms then 1047 Hz at +90 ms, gain 0.12 |
| `calHold` | sine gliding 400 -> 800 Hz over the hold duration, gain 0.05; stops immediately if the sword moves |
| `calOk` | `uiSelect` followed by the first three notes of `record` |
| `calFail` | square 140 Hz 150 ms through a lowpass at 800 Hz, gain 0.08 |

There is **no background music** in v1. **[P2]** an optional ambient bed (very quiet filtered-noise "wind" at gain 0.02) may be added later; it is off unless the owner asks for it.

---

## 11. Visual style: "Ink and Paper Dojo" (one direction, procedural, with optional generated art)

**Idea.** A Japanese woodblock-print dojo: warm rice paper, sumi-ink outlines, a pale vermilion sun, distant ink-wash mountains and bamboo at the edges. Fruit are bold flat "stamps" with thick ink outlines; juice lands on the paper as pigment stains; the sword leaves an ink brush stroke that turns gold and hot when swung fast. The procedural drawing described in this section is complete by itself: it uses canvas paths, gradients and one seeded noise texture, and it needs **no image files and no web fonts**. Optional generated art in the same direction (section 11.6) can replace the sprites, the UI kit and the backdrops; the procedural drawing stays as the fallback for every single picture.

**Principle: the background is static and calm; all motion belongs to gameplay objects.** Background value range stays narrow (luminance 65% to 92%); fruit, bombs and the blade have the strong contrast (ink outlines).

### 11.1 Palette tokens

| Token | Hex | Use |
|---|---|---|
| `paper` | `#EADFC8` | main background base |
| `paperLight` | `#F4EBD9` | panels, highlights, text on dark |
| `paperShade` | `#D8CAAE` | paper shadow, bottom of the background gradient `#E6D8BC` |
| `ink` | `#14141C` | outlines, text, blade core |
| `inkSoft` | `#3A3A46` | bomb sheen, smoke |
| `inkText2` | `#4E4740` | secondary text (contrast 6.9:1 on paper) |
| `inkGrey` | `#8A8175` | decorative only, idle trail (2.9:1, never for text) |
| `vermilion` | `#D9432B` | accents, cursor dot, large text 40 px and up (3.3:1 on paper) |
| `vermilionDeep` | `#A82A18` | buttons, small coloured text (5.3:1 on paper; paper text on it 5.9:1) |
| `indigo` | `#1F3A5F` | mountains, stars (8.7:1 on paper) |
| `gold` | `#F2B134` | Double, high speed, golden apple (9.7:1 against ink) |
| `matcha` | `#7BA05B` | bamboo, leaves |
| `ice` | `#7FD1F0` | Freeze |
| `flame` | `#F26A21` | Frenzy |
| `teal` | `#4A9E8A` | Clock |
| `sunPale` | `#E9A08A` | the sun disc |

Fruit and juice colours are in section 4.1.

### 11.2 Background (drawn once into an offscreen canvas per resize)

Back to front:

1. **Base:** vertical linear gradient from `#F4EBD9` (y = 0) to `#E6D8BC` (y = 1080).
2. **Sun:** disc centre (1380, 330), radius 210, fill `#E9A08A`; two thin soft rings at radius +6 and +12 with alpha 0.10 for an "ink bleed" edge.
3. **Mountains:** three ridgelines from fixed-seed (`0xC0FFEE`) 1D value noise, 3 octaves; baselines y = 740, 820, 900; maximum heights 280, 220, 160 px; fill `#1F3A5F` at alpha 0.10, 0.15, 0.22. Between layers a 120 px mist band: linear gradient of paper colour alpha 0, 0.55, 0.
4. **Bamboo:** 4 stalks on each side (x = 60, 128, 190, 236 and mirrored 1860, 1792, 1730, 1684), width 26 px, full height; colour `#7BA05B` mixed 65% with paper, 3 px ink outline at alpha 0.25; a node line every 210 px (4 px ink at alpha 0.30); 6 pointed leaves per stalk at alpha 0.5. Static, no sway.
5. **Paper grain:** a 512 x 512 tile drawn once with a fixed seed: 3000 speckles of 1 to 2 px in ink and `#B8A88A` at alpha 0 to 0.06, and 120 hairline fibres of 8 to 30 px at alpha 0.05. Tiled over the whole canvas at 0.6 opacity with `multiply`.
6. **Vignette:** radial gradient, transparent in the middle to ink alpha 0.14 in the corners.

### 11.3 Draw order (back to front)

background canvas, stain layer, combo and power-up banners, halves, whole objects (fruit, bomb, medallions, golden apple), telegraph triangles, particles, slash marks, blade trail, HUD, score popups, toasts, **cursor**, full-screen effect overlays (flashes, vignettes, frost), pause/results/disconnect panels, dim layers, and the cursor drawn again on top when a panel is open.

The game layer (everything up to popups) is what shakes and zooms; the HUD, panels and cursor do not.

### 11.4 Typography (two shipped web fonts, system fallback)

Minimum text size anywhere: **28 px** at 1080p logical (readable from 2 to 3 m). Since the restyle round (2026-10-01) the text uses two self-hosted fonts under the SIL Open Font License, with the old system stacks as the fallback (`?fonts=0`, `?assets=0`, a failed or slow download): the display face **Lilita One** (family `DojoDisplay`, 9.5 KB) and the UI face **Fredoka** (family `DojoUI`, 26.4 KB). The full account (why these two, the roles, loading, how to add a font) is `docs/typography.md`; the table below is its summary. Text is drawn as stroke first, then fill; the "look" of a style (banner, headline, plate, numeral, popup) adds the em-based stroke, shadow and gradient.

| Style | Family | Size | Weight in the string | Colour and look | Use |
|---|---|---|---|---|---|
| Display | display | 150 px | 900 | gold gradient, ink stroke, hard shadow (banner look) | game title (procedural) |
| Headline | display | 72 px | 800 | ink with a paper stroke | screen titles |
| Button | display | 56 / 44 / 36 px | 800 | paper letters, ink outline, maroon hard shadow (plate look) | button labels |
| Banner | display | 96 / 128 / 160 px | 900 | paper, gold, vermilion or ice gradients, ink stroke | combo, power-up, BOMB!, GAME OVER, TIME'S UP! |
| Numeral | display | 96 px (score), 60 px (timer), countdown numerals 360 px baked | 800 | ink, gold with Double, drawn in fixed digit cells | score, timer, countdown |
| Popup | display | 48 / 72 px | 800 | juice colour, ink stroke | score popups |
| Body | ui | 34 px | 600 / 700 | ink | instructions |
| Small | ui | 28 px | 600 | `#4E4740` | hints, labels |

The fallback stacks are `"Arial Rounded MT Bold", "Hiragino Maru Gothic ProN", "Yu Gothic UI", system-ui, sans-serif` for the display face and `ui-rounded, "SF Pro Rounded", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` for the UI face.

### 11.5 UI components

- **Panel:** fill `paperLight`, 6 px ink border, corner radius 10 px, a 4 px hard offset shadow (ink alpha 0.25, no blur).
- **Button:** a paper strip with a 5 px ink border and a deep-vermilion label plate (a hanko seal look, rotated 1 to 2 degrees); minimum size **84 x 84 px** for anything selectable (section 12.6), 420 x 130 px for main buttons. Selected/hovered: ink border thickens to 8 px and the plate brightens to `vermilion`.
- **Toggle / segmented control:** two or three paper cells, the active one filled with deep vermilion and paper text.
- **Slider replacement:** "-" and "+" buttons of 84 x 84 px either side of a value readout (sliders are not selectable with a sword).
- **Icons** (apples for lives, power-up icons, snowflake, flame, clock) are procedural paths with 4 px ink outline.
- All HUD glyphs and shapes differ by silhouette, not only by colour.
- With the generated art, buttons, steppers, toggles, panels, the timer ring, the icons and the cursors are pictures (section 11.6). Their text is always drawn by the game on an empty label plate, never baked into the picture, and no target, hit box or 84 x 84 minimum changes.

### 11.6 Optional generated art (the art layer)

**What it is.** A set of AI-generated pictures (made with Higgsfield GPT Image 2.5 in the style "Ink and Paper Dojo": a flat woodblock look with glossy highlights; the style formula and the asset list are in `design/higgsfield-brief.md` and `design/assets.csv`). It covers the ten fruit and the Golden Apple (whole and two halves), the bomb, the four medallions, one juice splash per fruit, three effects (bomb explosion, slice flash, blade brush texture), icons and controller glyphs, the UI kit (buttons, steppers, toggles, panel, timer ring, cursors, logo) and layered backdrops for the four stages below. The shipped files, their sizes and their measured geometry are described in `docs/assets.md`; how the renderer, the stage and the widgets use them is the contract in `docs/assets-integration.md`.

**It is a skin, never game state.** Collision radii, hit boxes, timings, target rectangles and the fixed-step, deterministic game logic do not change, and the art never influences a snapshot. Each picture is scaled so that the visible body of the fruit matches its collision circle (the Golden Apple picture includes a glow ring, which is drawn around the body). Fruit stay distinguishable by silhouette, not colour. The animated overlays that carry meaning stay procedural on top of the pictures: the pulsing danger ring of a bomb, the fuse spark, the orbiting sparkles of the Golden Apple and the extras of the medallions.

**Everything is optional.** A missing file, a failed decode, a slow disk, a picture that is not loaded yet or the URL flag `?assets=0` all mean that the procedural drawing of this document runs instead, in the same frame, with no gap. Mixed states are fine: one fruit can have art while another does not. Nothing in the game waits for the art.

**The four stages.** The backdrop is three layers (far, middle, near), all drawn behind every gameplay object.

| Stage | Used by | Look |
|---|---|---|
| Classic | the countdown, play, pause and results screens of Classic | dawn, flat sun, thick bamboo on the near layer |
| Arcade | the same screens of Arcade | lantern festival at dusk |
| Zen | the same screens of Zen | stone garden with petals and a branch on the near layer |
| Menu (night) | boot, safety, connect, calibration, menu, settings, tuning, and any round screen without a real mode (practice) | indigo night with a moon and stars, drawn under a paper veil so that the ink text of these screens stays readable |

The principle of this section holds for the pictures too: **the background is calm and static.** The parallax between layers is small and exists only while something shakes or zooms (at the strongest bomb shake the far layer moves about 6 px and the middle layer about 12 px; nothing moves otherwise), the night stage drifts by 4 to 8 px over a slow cycle, and the near layers are dimmed a little (a data table in `art-config.js`) so that bamboo, lanterns and petals never compete with fruit. The composed round stages are measured at build time and a test checks that their mean luminance over the play area stays inside a range slightly wider than the 65 % to 92 % of this section (the night stage is exempt: it is dark by design and veiled). A change of stage is a 400 ms dissolve, or a cut with "Reduce motion".

**Controller pictures.** The two Joy-Con glyphs on the connect and disconnect screens sit behind one switch (`ART_CONFIG.glyphs.enabled`), because they resemble a real controller too closely (a thumbstick, a four-button diamond and a top tab in the real layout). The switch is OFF by default since art review round 1: no controller picture is drawn until a neutral replacement (one colour, no stick, no diamond, no tab, the same for left and right) is swapped in by data. Every glyph sits next to its text and never carries a meaning alone.

**Readability fixes of the art review (round 1).** The artwork must never cost readability: (a) the bomb is baked with a light rim outside its outline and, over a stage backdrop, its danger ring is opaque and thicker with a paper underlay, and the lower band of each stage (ridge, rooftops, rocks) is lightened by a paper haze, so the near-black bomb keeps a silhouette on every ground; (b) the Arcade lantern clusters are not drawn (they looked like fruit and hung where fruit fly and the score sits); (c) the night stage is veiled with a pale blue tint instead of paper, its moon is dimmed, and the small text of those screens is drawn in ink (`ink` reaches 4.2 to 8.8 to 1 there, the softer `inkText2` only 2.1 to 4.5 to 1); (d) the small hint lines at the bottom of a round (the pause and recenter hint, the pause tip, the rest line of the results) sit on a paper label when a backdrop is under them. All of it needs the art and changes nothing without it: the procedural background keeps the drawing of this document exactly.

**Menu with the logo.** With the logo picture the menu shows `logo_title` in place of the title text (the text "3D FRUIT DOJO" is its fallback) and the tagline moves from y 250 to y 272; the three mode fruit, their circles, names, descriptions and the buttons stay where they are.

---

## 12. Screens and flows

**Text length note.** The wrap widths and line counts quoted in this section ("wraps at 440 px, at most 2 lines", the cooldown warning of "3 lines", the six safety lines on a 105 px pitch and similar) were first estimated for the original Italian texts. English strings are generally shorter than the original Italian ones, so those boxes have at least as much room (the longest strings are listed in `public/js/ui/strings.en.js`). Text is measured and wrapped at run time (`wrapLines` in `public/js/render/draw-util.js`), the position and size of every selectable target are checked by `test/ui/layout-data.test.js`, and the 28 px minimum text size and the 84 px minimum target size are unchanged. The English screens were re-checked on 2026-09-30 in real Chrome (1920x1080, 800x1000 and 640x360, every screen, overlay, toast and banner): no text leaves the playfield and no text is drawn over other text except two by-design cases, the small "−50" under the "BOMB!" popup and the "Last 10 seconds!" toast over the TIME label. The one crowded wrap was the Arcade description of the menu, shortened to one line (`menu.arcade.desc`). A re-check with the real sword and a real window is still part of the next QA round.

### 12.1 State machine

States: `boot`, `safety`, `connect`, `calibration`, `menu`, `settings`, `countdown`, `playing`, `paused`, `results`. Overlays that can appear on top of several states: `disconnected`, `confirm` dialogs, toasts.

| From | To | Trigger |
|---|---|---|
| `boot` | `safety` | assets ready and safety not yet acknowledged (or `safetyAck` unavailable) |
| `boot` | `connect` | safety already acknowledged and no `?input=` flag |
| `boot` | `menu` | `?input=sim` or `?input=mouse` (synthetic or no calibration is needed) |
| `boot` | `countdown` | `?mode=...` present (test/automation shortcut, implies `?skipsafety`) |
| `safety` | `connect` (or `menu` with an `?input=` flag) | "Got it, let's go" |
| `connect` | `calibration` | Joy-Con connected and "Continue", or auto after 1.5 s |
| `connect` | `menu` | "Simulator" or "Mouse only" chosen |
| `calibration` | `menu` | step 4 succeeded |
| `menu` | `countdown` | a mode target is selected |
| `menu` | `settings`, `calibration`, `connect` | "Settings", "Recalibrate", "Connection" |
| `settings` | origin (`menu` or `paused`) | "Back" or `back` |
| `countdown` | `playing` | after "GO!" |
| `playing` | `paused` | `pause` action, window blur or hidden tab, disconnect |
| `paused` | `playing` | "Resume", followed by the 3-2-1 resume countdown |
| `paused` | `settings` / `calibration` / `menu` | "Settings" / "Recalibrate" (quick re-centre only, then back to `paused`) / "Quit to menu" (with confirmation) |
| `playing` | `results` | lives 0 or timer 0, after the end sequence of section 9.10 / 7.2 |
| `results` | `countdown` / `menu` | "Play again" / "Menu" |
| any state with a Joy-Con provider | `disconnected` overlay | provider `state` becomes `lost` |

### 12.2 Safety screen (first run, and whenever `safetyAck` is not stored)

Full-screen panel over the calm background. Layout: title "Before you play" (Headline 72 px) at y = 130; six lines (Body 34 px, wrapping at 1440 px, each with a small ink icon: space, people, strap, screen, clock, sun) starting at y = 260 with a 105 px pitch; a toggle "Reduce flashes" at (960, 900); the button "Got it, let's go" (520 x 130) at (960, 990), **enabled after 2 s** (a thin progress bar under it fills meanwhile). It is confirmed only with `confirm`, Enter or a click, **never by cutting or dwell** (the sword is not calibrated yet). Strings: `safety.*`.

### 12.3 HUD (playing)

| Element | Position and size | Content |
|---|---|---|
| Score | label "SCORE" (Small 28 px) at (64, 40); number (HUD 84 px) baseline y = 130 at x = 64; under it "BEST {n}" (Small) at (64, 165) | current score; turns gold with Double and shows a small "x2" seal to its right |
| Timer (Arcade, Zen) | ring of radius 70 px centred at (960, 90), 10 px stroke, progress = remaining / total (capped at 1); m:ss in HUD 56 px inside | `TIME`; last 10 s: digits `vermilionDeep` and tick pulse |
| Lives (Classic) | three apple icons (radius 34) at (1840, 84), (1760, 84), (1680, 84) | full apple = life; empty outline with a progress arc = missing life |
| Power-up tray | icons of radius 34 in a row starting at (98, 240), 84 px pitch, each inside a shrinking ring | active timed power-ups |
| Combo banner | centre (960, 290) | section 9.7 |
| Power-up banner | centre (960, 440) | name (Banner 110 px, e.g. "FREEZE!") with its subtitle under it (Body 34 px), shown 1.2 s then fading over 250 ms; drawn behind the objects like the combo banner; `hud.pu.*` strings |
| Toasts | centre (960, 200), Body 34 px on a paper pill, 2.5 s | "Crosshair recentered" (800 ms), "Joy-Con battery almost empty" (when the battery is known and at or below 15%, at most once per 5 minutes; UNVERIFIED-ON-HARDWARE HW-8), "Last 10 seconds!", tips, break suggestion |
| Pause / recenter hint | bottom centre (960, 1050), Small 28 px, alpha 0.6 | shown during the first 20 s of a round only: "Pause: {button}   Recenter: {button}" |

The HUD is drawn over the game layer and never shakes. Timer and lives are never hidden by objects.

### 12.4 Connect screen

Layout: title "Connect your Joy-Con" at (960, 110) with the subtitle under it. **Left column** (x 120 to 1000): panel "How to connect" with the four steps (Body 34 px, wrapped). **Right column** (x 1080 to 1800): the main button "Connect Joy-Con" (520 x 130) at (1440, 400); under it a status pill (Body) at (1440, 520); under that the cooldown warning text (Small, 3 lines) at y 590 to 700. Bottom band: "Or play without a Joy-Con" (Small) at (1440, 790) and two buttons "Simulator" and "Mouse only" (400 x 100) at (1240, 890) and (1640, 890), each with a one-line description below. A small link "Joy-Con diagnostics" (Small, underlined) bottom-left at (120, 1030) opens `diagnostics.html` in a **new tab** so the game state is not lost. All buttons are mouse or Enter/click driven here (the sword is not yet calibrated).

States of the main button and pill:

| State | Button | Pill text |
|---|---|---|
| idle | enabled "Connect Joy-Con" | (empty) |
| chooser open | disabled | "Searching…" |
| connecting | disabled | "Connecting…" |
| connected | replaced by "Continue" | "Connected: Joy-Con ({left/right})" + "Battery: {pct}%" (or "not available") |
| error | enabled again after the cooldown if it was a connection failure | error string (`connect.err.*`) |
| chooser closed without a choice | enabled "Connect Joy-Con", plus the extended-search button below the pill | `connect.err.cancelled`, then the hint (see below) |
| cooldown | disabled, label "Try again in {s} s" | last error |
| unsupported browser | disabled | `connect.err.unsupported` |

**Chooser closed (added 2026-09-30, see `docs/hardware-findings.md`).** After the player closes Chrome's device chooser without a choice (provider error `cancelled`, which never starts a cooldown) the screen also shows the button `connect.fallback.button` ("Can't see it? Extended search", 640 x 84 at (1440, 612), click only) and, under it, the hint `connect.fallback.hint` (Small, centred, 2 lines from y 698). The click asks the Joy-Con provider to connect with the filter `all` (`acceptAllDevices` plus `optionalServices`). It is a real click because Chrome's chooser needs the user gesture; nothing ever retries by itself. If that extended search is closed without a choice too, the hint becomes `connect.fallback.hintExtended`. **Deviation from "the warning is always visible":** the button and the hint take the place of `connect.cooldown.warning` while they are shown (no cooldown runs at that moment and the warning returns with the next attempt); they never appear while a chooser is open, while connecting, connected, cooling down, or in an unsupported browser.

**Cooldown rule:** `connect.cooldownS = 10` (Appendix A). It starts after a connection attempt that reached the connect stage and failed, and after any disconnection. It does **not** start when the player simply closes Chrome's device chooser. While it runs the button shows the countdown; the warning text `connect.cooldown.warning` is always visible on this screen. The exact reason and the true safe interval are **UNVERIFIED-ON-HARDWARE (HW-5)**: the team's assumption is that rapid back-to-back attempts can leave the device or the OS Bluetooth stack in a stale state. The protocol research may change the number or drop the rule; it is a single constant.

The pairing steps 1 and 2 (`connect.step1`, `connect.step2`) describe generic BLE pairing behaviour. **UNVERIFIED-ON-HARDWARE (HW-4):** the exact gesture and LED behaviour of the Joy-Con 2 must be reconciled with the setup guide before release; edit the two strings, not the layout.

### 12.5 Calibration flow

Purpose: find the zero direction **and** the mount orientation, so the game works however the Joy-Con is fixed on the sword and for either side. Four steps, each full-screen with a large illustration (procedural: a stick-figure sword drawn in ink at the required pose), the instruction (Body 34 px), a progress ring (radius 90 at (960, 700)) and "Step {n} of 4".

| Step | Title / text | What the player does | Data captured | Pass rule | Fail behaviour |
|---|---|---|---|---|---|
| 1 | "Hold it still" / sword still, tip up (may rest it) | hold still 2.0 s | gyro bias (mean angular rate) and gravity vector `gA` in device axes | mean angular speed below **6 deg/s**, no sample above **15 deg/s**, accelerometer magnitude steady (within 5% of the hold's own mean) and averaging between 0.85 and 1.15 g (the game learns the resting magnitude and divides by it; a reading outside 0.95 to 1.05 g is only warned about), for 2.0 s continuous | any violation resets the ring and shows "You moved. Let's start over." |
| 2 | "Point at the screen" / point straight at the screen like a thrust, hold still | hold still 1.5 s | gravity vector `gB` in device axes | same stillness rule for 1.5 s, and the angle between `gA` and `gB` must be **between 65 and 115 degrees** (about 90 expected) | out of range: "The two poses are too similar..." then back to step 1 |
| 3 | "Center the crosshair" / point at the screen centre and press `{button}` (or hold still 3 s) | press or wait | yaw and pitch reference (zero) | the `recenter` or `confirm` action, or 3.0 s of stillness | none (retry possible) |
| 4 | "Try a slash" / cut the apple | one practice apple (fixed arc, apex (960, 400), gScale 1.0) is thrown every 3 s until it is cut; shows "Blade speed" | none | one cut, or 20 s elapsed | after 20 s show "Can't hit the apple? Repeat the calibration." and enable "Redo" |

Design intent of the two-pose method (motion-pipeline engineers may replace it with something better as long as the player-facing steps and outcomes stay the same): pose 1 puts gravity along the blade, so `gA` is the **sword axis in device coordinates**; pose 2 puts the blade horizontal, so `gB` gives the "down" direction perpendicular to that axis; with their cross product they define the full sword frame for any mount and either Joy-Con side. **UNVERIFIED-ON-HARDWARE (HW-7):** the stillness thresholds depend on real hand tremor and gyro noise.

Extras: "Just recenter" (`cal.quick`) on the menu and pause screens runs only step 3 for the case "same grip as before". For the simulator and mouse providers, calibration is skipped. A successful calibration plays `calOk`, then goes to the menu. The result may be kept in memory for the session but is **not** trusted across sessions (the strap may have moved).

### 12.6 Menu and how to select things with a sword

**Three ways to select, all always available in menus:** (1) **cut** the target (the blade must be `CUTTING` and cross the target); (2) **dwell**: **rest** the cursor on the target for 900 ms without cutting (setting "Hold to select", default on; the cursor shows a progress arc). The dwell counts REST, not time inside the target (improvements round, R3-04): the cursor is at rest while it stays within **70 px** of where the rest began (a hand tremor never breaks it, a slow aim across a fruit never completes it), and the 900 ms count from the later of "entered the target" and "began to rest". The dwell only counts a cursor that the **player** moved: while the references carry the cursor (soft centring at rest, the 150 ms recentre ease) it stays disarmed, and a change of cursor source (the pointer hands over to the sword, R3-01) or a screen change disarms it too. A disarmed dwell arms only after the cursor has RESTED for **300 ms** (never while the blade is cutting: the follow-through of a swing is not aiming, R3-02), and then either when it rests on no target, or when it rests on a target after the player moved it by hand by more than **100 px** from where it first appeared, so a resting sword never starts "Arcade" (which sits on the point the cursor is drawn to) and a re-centre in the pause panel never presses "Recalibrate"; (3) click / Enter for keyboard and mouse. Dwell exists so that players who cannot swing, and anyone with an unreachable button, can still operate everything. Dwell and cuts are **never** active during play, only in menus. Each target is at least **84 x 84 px** (main ones far larger). Entering a target plays `uiMove`, selecting plays `uiSelect`; `back` plays `uiBack`.

Menu layout (logical px):

| Element | Position | Size |
|---|---|---|
| Title "3D FRUIT DOJO" (Display 150 px; the logo picture replaces it when the art is loaded, section 11.6) | (960, 140) | |
| Tagline (Body) | (960, 250) | |
| Mode target Classic (a big **watermelon** sprite, scale 1.9) | (480, 520) | radius 175 |
| Mode target Arcade (a big **orange** sprite, scale 2.5) | (960, 520) | radius 170 |
| Mode target Zen (a big **pear** sprite, scale 2.6) | (1440, 520) | radius 172 |
| Under each: name (Headline 72 px) y = 790; description (Small 28 px, wraps at 440 px, at most 2 lines) y = 836 and 868; "Best: n" (Small) y = 906 (improvements round: 20 px lower and the fruit 20 px higher than before, so the names clear the fruit's lower edge, QA-06) | centred on the target x | |
| Buttons "Settings", "Recalibrate", "Connection" | (560, 975), (960, 975), (1360, 975) | 400 x 100 |
| Bottom line (Small 28 px): `menu.hint` on the first visit, then `menu.safety`, alternating every 8 s; until the tuning screen (12.7.1) has been opened once in the session a third line `menu.tuneHint` joins the rotation (improvements round) | (960, 1055) | |
| Provider chip (top-right): "Joy-Con (right)", "Simulator" or "Mouse" plus battery if known | (1700, 60) | pill |

Cutting a mode target splits it like a fruit (halves, splash, `slice` sound) and starts the countdown after 350 ms. Buttons split into two paper strips. The mode fruit bob by +/-10 px at 0.3 Hz (static with "Reduce motion").

### 12.7 Settings screen

Two columns of rows (label in Body 34 px on top, control below), then a live meter, then two buttons. Every selectable element is at least 84 x 84 px; sliders are replaced by "-" and "+" buttons.

| Position | Row |
|---|---|
| Left column x 140 to 930; label baselines at y = 250, 400, 550, 700, each control centred 64 px below its label | 1 Sensitivity, 2 Slice threshold, 3 Volume, 4 Reduce flashes |
| Right column x 990 to 1780, same y values | 5 Reduce motion, 6 Hand, 7 Auto-recenter, 8 Hold to select |
| Live meter, y = 850, x 140 to 1780 | "Blade speed: {n} °/s": a horizontal bar 0 to 900 °/s showing the current blade speed with a marker at the cut threshold (bar turns vermilion above it). This lets the player tune the threshold without hardware knowledge |
| Bottom buttons, y = 980 | "Reset high scores" at x = 470, **"Sword tuning" at x = 960**, "Back" at x = 1450 (400 x 100 each; improvements round: the middle one opens the sword tuning screen, 12.7.1) |
| **[P2]** row 9 "Deadly bombs (Classic)" | replaces the empty slot under row 8 |

Value display: sensitivity as "1.0" (decimal point); threshold as "300 °/s (Normal)" with the labels Easy (250 or less), Normal (251 to 375), Hard (above 375); volume as a percentage; toggles as a two-cell switch reading "On" / "Off" (the selected cell is the vermilion one); hand as a two-cell segmented control "Right | Left". Changes apply and save immediately. "Reset high scores" opens a confirm dialog (`settings.reset.confirm`, "Yes, delete" / "Cancel").

### 12.7.1 Sword tuning screen (improvements round)

The feel of the real sword can only be tuned on the real hardware, so one page holds everything that decides it. **Two columns (sword tuning round, 2026-09-30): the pointer on the left, the cut on the right.** Left column: the stepper "Sensitivity" (0.3 to 2.0, step 0.1), the row "Pointer speed" with three preset cells "Relaxed" 0.6, "Standard" 1.0 and "Fast" 1.5, the reach test (the reading "You covered {w}% of the width and {h}% of the height", replaced by "You can reach all four corners" when all four rings were touched, with the hint "Move the crosshair into all four corners. If you can't reach them, raise the sensitivity.") and the line "Crosshair speed: {lo} px per degree when aiming slowly, {hi} px per degree in a fast swing" (5 and 14 times the sensitivity for a Joy-Con; the simulator shows its fixed 27.4 times the sensitivity twice). Right column: the stepper "Slice threshold" (100 to 700 °/s, step 25), the row "Threshold preset" with "Easy" 225, "Normal" 300 and "Hard" 450 °/s, "Blade speed: {n} °/s" above a bar 0 to 900 °/s with the threshold marker (gold) and a peak-hold tick (ink) for the current or last swing, "Last swing: {n} °/s" and the verdict ("Slices: above the threshold" / "Too slow: {n} °/s needed" / "Make a firm swing" before the first swing). All six preset cells are 250 x 84 and selected by dwell, click or Enter only. Four rings (radius 46) sit at (90, 90), (1830, 90), (90, 990), (1830, 990) and light up when the cursor comes within 70 px; three practice fruit (apple, kiwi, lemon, radius 92 at x 560, 960, 1360, y 815) can be cut and come back after 1.4 s. Bottom buttons (400 x 100, y 975): "Default values" (x 640: sensitivity 1.0, threshold 300) and "Back" (x 1280, back to settings). The exact coordinates are in `public/js/ui/layout-data.js`.

Rules: a **swing** is any movement above 150 °/s; it ends after 0.25 s below that, and its peak becomes "Last swing". Reach is the bounding box of the cursor positions since entering the screen or the last sensitivity change, and cursor positions carried by the references (the re-centre ease, the idle glide) do not count. **Only the practice fruit can be cut** on this page (a swing through all three cuts all three, cutting one never locks the others, nothing else reacts to a cut); the steppers, presets and buttons are selected by dwell, click or Enter, because the player swings the sword all over the screen here and a stepper that a swing could press would change the very values being tuned. The screen only writes the two settings the game already has. All numbers (150 °/s, 0.25 s, 70 px, the ring radius) are starting values, UNVERIFIED-ON-HARDWARE (HW-2, HW-3, HW-9). Strings `tune.*` and `settings.tune` are listed in `docs/contract-notes.md` (additions beyond section 13).

### 12.8 Countdown

Mode name (Headline) fades in for 1 s at y = 330 (below the HUD band: at the top it overlapped the timer ring and its "TIME" label; improvements round, QA-05), then the numbers "3", "2", "1" (Banner 132 px, centre, 0.8 s each, scale 1.5 to 1.0 with `countdown` sound) and "GO!" (0.6 s, `go`). The blade and cursor are live (players can warm up) but there is nothing to cut. The first wave spawns 0.8 s after "GO!". On the very first round ever (no stored best in any mode) show the tips `tip.swing`, `tip.combo` as toasts at 2 s and 12 s, and `tip.bomb` when the first bomb telegraph appears.

### 12.9 Pause

Triggers: `pause` action, window blur, hidden tab, disconnect (the last one uses the disconnect overlay instead). Game time, wave timers and audio scheduling freeze; the paused frame stays visible under a paper dim layer (alpha 0.75). Panel title "Paused" at (960, 170); four stacked buttons 620 x 120 at (960, 380), (960, 540), (960, 700), (960, 860): "Resume", "Recalibrate", "Settings", "Quit to menu". A tip line `pause.tip` (Small) at y = 1000. "Quit to menu" opens the confirm dialog (`pause.confirm.*`). **"Resume" starts a resume countdown** ("Resuming in 3…", "Resuming in 2…", "Resuming in 1…", 0.7 s per number) so that objects do not fall on a player who is not ready. Blur or hidden-tab pauses show `pause.autoBlur` instead of the tip.

### 12.10 Results screen

Panel 1240 x 880 centred at (960, 520) (improvements round: the two buttons at y 862 are inside it; at y 900 they straddled its bottom border), Headline title at its top ("Game over" for Classic, "Time's up!" for Arcade and Zen).

| Area | Content |
|---|---|
| Left third | large vermilion **hanko rank seal** (200 px, rotated 4 degrees) with the rank word; under it "Rank" |
| Centre | "Score" and the score (HUD 84 px; counts up from 0 over 1.2 s with ticking, skipped in "Reduce motion"); "Best: n" under it; if new best: "NEW RECORD!" banner with gold stamp and `record` sound |
| Right third | stats grid 2 x 3 (label Small, value Body 34 px bold): Fruit sliced, Best combo, Accuracy, Bombs hit (not in Zen), Power-ups, Duration |
| Bottom | buttons "Play again" (520 x 130) at (760, 900) and "Menu" (520 x 130) at (1160, 900); a thin lockout bar fills for 1.2 s and the buttons are inert until it completes; line `results.rest` (Small) at y = 1030 |
| Conditional | the break banner `results.break` (Body, on a vermilion-deep pill) at y = 800 when 10 minutes or more of cumulative play have passed since the last break (section 15) |

### 12.11 Disconnect overlay

Appears over any state when a Joy-Con provider goes from connected to lost; the game **auto-pauses** if it was playing. Panel 900 x 640 centred (improvements round: three 84 px buttons with 16 px gaps now fit inside it; the pause panel behind it is not drawn): title "Joy-Con disconnected"; text "The game is paused. Trying to reconnect…"; then:

| Phase | Behaviour |
|---|---|
| 0 to 2 s | text `disc.text` |
| 2 s | **one** automatic reconnect attempt to the already-known device (if the browser allows it without the chooser; UNVERIFIED-ON-HARDWARE HW-5) |
| success | `connectOk`, text `disc.recovered`, a **mandatory quick re-centre** (hold still 1.5 s, "Recentering… don't move"; then step 3 of calibration if the ring was not enough), then the 3-2-1 resume countdown |
| failure | text `disc.failed` + `disc.cooldown`; the buttons appear: "Try again" (locked for the 10 s cooldown, showing "Try again in {s} s"), "Continue with the mouse" (switches provider to mouse and resumes with a countdown), "Back to menu" |

---

## 13. UI strings (complete)

All player-visible text, in English (owner decision, 2026-09-30; the first version of the game used Italian text). Keys are stable identifiers; placeholders are in braces. Typographic double quotes “ ” surround button and state names; the decimal separator is a point; American spelling (center, meters); multiplication is written "×". Keep the strings in one module (`public/js/ui/strings.en.js`). Any string not in this table must be added here first.

### 13.1 Boot and safety

| Key | English |
|---|---|
| `boot.loading` | Loading… |
| `boot.unsupported` | Your browser does not support this game. Use Google Chrome. |
| `safety.title` | Before you play |
| `safety.l1` | Make room: keep at least 2 meters (6 ft) clear around you in every direction. |
| `safety.l2` | Move people, pets and breakable objects out of the way. Do not play near stairs. |
| `safety.l3` | Attach the Joy-Con firmly to the sword and always use the wrist strap. |
| `safety.l4` | Never touch the screen with the sword. |
| `safety.l5` | Take a 5-minute break after every 15 minutes of play. If your wrist, arm or shoulder hurts, stop. |
| `safety.l6` | The game has flashing effects: if you are sensitive to flashes, turn on “Reduce flashes”. |
| `safety.reduceFlash` | Reduce flashes |
| `safety.wait` | Read carefully… |
| `safety.ok` | Got it, let's go |

### 13.2 Connect

| Key | English |
|---|---|
| `connect.title` | Connect your Joy-Con |
| `connect.subtitle` | Works with the left and right Joy-Con 2. |
| `connect.steps.title` | How to connect |
| `connect.step1` | 1. If the Joy-Con is connected to the console or to another device, disconnect it. |
| `connect.step2` | 2. Hold down the Joy-Con's sync button until the lights flash. |
| `connect.step3` | 3. Press “Connect Joy-Con” and choose your Joy-Con in the list that opens in Chrome. |
| `connect.step4` | 4. Wait for “Connected”, then calibrate the sword. |
| `connect.button` | Connect Joy-Con |
| `connect.searching` | Searching… |
| `connect.connecting` | Connecting… |
| `connect.connected` | Connected: Joy-Con ({side}) |
| `connect.side.left` | left |
| `connect.side.right` | right |
| `connect.side.unknown` | side unknown |
| `connect.battery` | Battery: {pct}% |
| `connect.batteryUnknown` | Battery: not available |
| `connect.cooldown.warning` | Careful: after an attempt, wait about 10 seconds before trying again. Repeated attempts in quick succession can stop the Joy-Con from being found. |
| `connect.cooldown.wait` | Try again in {s} s |
| `connect.err.unsupported` | This browser does not support Web Bluetooth. Use Google Chrome on a Mac. |
| `connect.err.cancelled` | No Joy-Con chosen. Try again when you are ready. |
| `connect.err.failed` | Connection failed. Check that the Joy-Con is on and not connected elsewhere. |
| `connect.err.notJoycon` | The device you chose does not look like a Joy-Con 2. |
| `connect.alt.title` | Or play without a Joy-Con |
| `connect.alt.sim` | Simulator |
| `connect.alt.sim.desc` | The mouse moves a virtual sword with simulated sensors. |
| `connect.alt.mouse` | Mouse only |
| `connect.alt.mouse.desc` | The mouse slices directly. |
| `connect.diagnostics` | Joy-Con diagnostics |
| `connect.continue` | Continue |

### 13.3 Calibration

| Key | English |
|---|---|
| `cal.title` | Sword calibration |
| `cal.progress` | Step {n} of {total} |
| `cal.s1.title` | Hold it still |
| `cal.s1.text` | Hold the sword still, tip pointing up. You can also rest it down, with the tip still pointing up. |
| `cal.s2.title` | Point at the screen |
| `cal.s2.text` | Point the sword straight at the screen, as if thrusting, and hold it still. |
| `cal.s3.title` | Center the crosshair |
| `cal.s3.text` | Aim at the center of the screen and press {button}. Or hold the sword still for 3 seconds. |
| `cal.s4.title` | Try a slash |
| `cal.s4.text` | Slice the apple with one firm swing! |
| `cal.still` | Hold still… |
| `cal.moved` | You moved. Let's start over. |
| `cal.badPose` | The two poses are too similar. In step 1 point the sword at the ceiling, in step 2 at the screen. |
| `cal.ok` | Calibration complete! |
| `cal.retry` | Redo |
| `cal.tryAgain` | Can't hit the apple? Repeat the calibration. |
| `cal.quick` | Just recenter |
| `cal.quick.hint` | Same grip as before? Just recenter. |
| `cal.speed` | Blade speed: {n} °/s |

`{button}` in `cal.s3.text` and in the HUD hints is filled by the active provider: keyboard "Space", mouse "click", simulator "Space", Joy-Con: the name of the mapped button (HW-6).

### 13.4 Menu

| Key | English |
|---|---|
| `menu.title` | 3D FRUIT DOJO |
| `menu.tagline` | Slice the fruit. Avoid the bombs. |
| `menu.classic` | Classic |
| `menu.classic.desc` | 3 lives. Don't let the fruit get away! |
| `menu.arcade` | Arcade |
| `menu.arcade.desc` | 60 seconds. Bonuses and bombs. |
| `menu.zen` | Zen |
| `menu.zen.desc` | 90 seconds. No bombs, no stress. |
| `menu.best` | Best: {n} |
| `menu.settings` | Settings |
| `menu.recalibrate` | Recalibrate |
| `menu.connection` | Connection |
| `menu.hint` | Slice a fruit to choose it, or hold the crosshair still on a button. |
| `menu.safety` | Keep 2 meters (6 ft) of clear space around you. |
| `menu.provider.joycon` | Joy-Con ({side}) |
| `menu.provider.sim` | Simulator |
| `menu.provider.mouse` | Mouse |

### 13.5 HUD, popups and banners

| Key | English |
|---|---|
| `hud.score` | SCORE |
| `hud.best` | BEST |
| `hud.time` | TIME |
| `hud.lives` | LIVES |
| `hud.combo` | COMBO ×{n}! |
| `hud.comboLabel` | COMBO |
| `hud.missed` | Missed! |
| `hud.nearMiss` | So close! |
| `hud.bomb` | BOMB! |
| `hud.bombScore` | −50 |
| `hud.bombTime` | −5 s |
| `hud.lifePlus` | +1 life |
| `hud.timePlus` | +{n} s |
| `hud.golden` | GOLDEN APPLE! +100 |
| `hud.pu.freeze` | FREEZE! |
| `hud.pu.freeze.sub` | Time slows down |
| `hud.pu.frenzy` | FRENZY! |
| `hud.pu.frenzy.sub` | Fruit only, no bombs |
| `hud.pu.double` | DOUBLE! |
| `hud.pu.double.sub` | Points ×2 |
| `hud.pu.clock` | CLOCK! |
| `hud.pu.clock.sub` | +4 seconds |
| `hud.count.go` | GO! |
| `hud.timeUp` | Time's up! |
| `hud.last10` | Last 10 seconds! |
| `hud.pauseHint` | Pause: {button} |
| `hud.recenterHint` | Recenter: {button} |
| `hud.recentered` | Crosshair recentered |
| `hud.lowBattery` | Joy-Con battery almost empty |
| `hud.softBreak` | You have been playing for 6 minutes. Want to take a break? |
| `hud.newBest` | NEW RECORD! |
| `tip.swing` | Swing the sword fast to slice! |
| `tip.bomb` | Watch out for bombs: don't slice them! |
| `tip.combo` | Slice several fruits in one swing to make a COMBO. |

The countdown numerals "3", "2", "1" are not strings.

### 13.6 Pause, results, disconnect, settings

| Key | English |
|---|---|
| `pause.title` | Paused |
| `pause.resume` | Resume |
| `pause.recalibrate` | Recalibrate |
| `pause.settings` | Settings |
| `pause.quit` | Quit to menu |
| `pause.tip` | Rest your arm: shake out your wrist and breathe. |
| `pause.autoBlur` | Game paused: this window is no longer in front. |
| `pause.resuming` | Resuming in {n}… |
| `pause.confirm.title` | Quit this game? |
| `pause.confirm.text` | Your current game will be lost. |
| `pause.confirm.yes` | Yes, quit |
| `pause.confirm.no` | No, keep playing |
| `results.title.gameover` | Game over |
| `results.title.timeup` | Time's up! |
| `results.score` | Score |
| `results.best` | Best |
| `results.newBest` | NEW RECORD! |
| `results.rank` | Rank |
| `rank.1` | Apprentice |
| `rank.2` | Warrior |
| `rank.3` | Ninja |
| `rank.4` | Master |
| `rank.5` | Legend |
| `results.fruit` | Fruit sliced |
| `results.combo` | Best combo |
| `results.accuracy` | Accuracy |
| `results.bombs` | Bombs hit |
| `results.powerups` | Power-ups |
| `results.duration` | Duration |
| `results.again` | Play again |
| `results.menu` | Menu |
| `results.rest` | Rest your arm before you start again. |
| `results.break` | You have played for {min} minutes. Take a 5-minute break: rest your arm and wrist. |
| `disc.title` | Joy-Con disconnected |
| `disc.text` | The game is paused. Trying to reconnect… |
| `disc.failed` | Can't reconnect. Check the battery and move closer to the Mac. |
| `disc.cooldown` | Wait about 10 seconds before trying again. |
| `disc.wait` | Try again in {s} s |
| `disc.retry` | Try again |
| `disc.useMouse` | Continue with the mouse |
| `disc.menu` | Back to menu |
| `disc.recovered` | Joy-Con reconnected! Hold the sword still to recenter. |
| `disc.recentering` | Recentering… don't move |
| `settings.title` | Settings |
| `settings.sens` | Sensitivity |
| `settings.sens.hint` | How far the crosshair moves when you rotate the sword. |
| `settings.cut` | Slice threshold |
| `settings.cut.hint` | Minimum speed needed to slice. Lower = easier. |
| `settings.cut.easy` | Easy |
| `settings.cut.normal` | Normal |
| `settings.cut.hard` | Hard |
| `settings.meter` | Blade speed: {n} °/s |
| `settings.volume` | Volume |
| `settings.flash` | Reduce flashes |
| `settings.flash.hint` | No full-screen flashes and fewer light effects. |
| `settings.motion` | Reduce motion |
| `settings.motion.hint` | No screen shake and fewer particles. |
| `settings.hand` | Hand |
| `settings.hand.right` | Right |
| `settings.hand.left` | Left |
| `settings.hand.hint` | The hand you hold the sword with. |
| `settings.autocenter` | Auto-recenter |
| `settings.autocenter.hint` | When idle, the crosshair slowly drifts back to the center. |
| `settings.dwell` | Hold to select |
| `settings.dwell.hint` | In menus, hold the crosshair still on a button to select it. |
| `settings.lethal` | Deadly bombs (Classic) [P2] |
| `settings.lethal.hint` | A bomb ends the game at once. |
| `settings.reset` | Reset high scores |
| `settings.reset.confirm` | Delete all high scores? |
| `settings.reset.yes` | Yes, delete |
| `settings.reset.no` | Cancel |
| `settings.on` | On |
| `settings.off` | Off |
| `settings.back` | Back |

The diagnostics page (`public/diagnostics.html`) is a technical tool; its labels are left to the engineers (English labels with standard technical units are recommended) and are not part of this table.

---

## 14. Settings (exact ranges and effects)

| Id | Label | Control | Range / default | Effect |
|---|---|---|---|---|
| `sensitivity` | Sensitivity | - / + | 0.3 to 2.0, step 0.1, default **1.0** | multiplier of the pointer curve (section 8.2); simulator: `pxPerDeg = 27.4 * sensitivity` |
| `cutThreshold` | Slice threshold | - / + | 100 to 700 deg/s, step 25, default **300** | `T` in section 5.2 (Zen applies x0.8); storage document version 2 resets an old value once |
| `volume` | Volume | - / + | 0 to 100%, step 10, default **70%** | `masterGain = 0.8 * (v/100)^2` |
| `reduceFlash` | Reduce flashes | toggle | default off | section 9.12 |
| `reduceMotion` | Reduce motion | toggle | default off (on if `prefers-reduced-motion: reduce`) | section 9.12 |
| `hand` | Hand | segmented | Right (default) or Left | **Ergonomic only, does not touch the motion pipeline.** Shifts the centres of the spawn bands (central 480 to 1440 and wide 220 to 1700) by **+80 px toward the hand side** (right hand: +80, left hand: -80), clamped to the arc limits. It has no other effect (button labels come from the provider). The Joy-Con **side** (left or right device) is detected from the device and shown on the connect screen and the provider chip; the player does not set it. If detection fails the diagnostics page offers a manual override (engineers' call) |
| `autoCenter` | Auto-recenter | toggle | default on | section 8.3 soft centring |
| `dwellSelect` | Hold to select | toggle | default on | section 12.6 |
| `swordSelect` | Sword selection in menus | toggle | default **off** | added 2026-10-01 (docs/contract-notes.md, "Stick navigation"): while a REAL Joy-Con is the provider the menus are used with the stick, A and B; only when on may the sword select items (dwell, cut, section 12.6). The simulator and the mouse always may |
| `lethalBombs` **[P2]** | Deadly bombs (Classic) | toggle | default off | section 7.1 |
| (action) | Reset high scores | button + confirm | | clears `best` |

All settings are saved on change in the single storage key of section 7.5 (in memory only if storage is unavailable).

---

## 15. Accessibility and safety

### 15.1 Physical safety [MUST]

- **First-run safety screen** (section 12.2) with six points: 2 m clear space in every direction; keep people, animals, fragile objects and stairs away; secure the Joy-Con on the sword and always use the wrist strap; never touch the screen with the sword; breaks; flashing effects. It is shown again if `safetyAck` is missing and repeated in short form on the menu (`menu.safety`).
- **Breaks:** cumulative play time is tracked per session (`playMsTotal`). On the results screen, after **10 minutes** of cumulative play since the last break, show `results.break` and keep showing it until the player has been idle for 5 minutes. The safety screen advises "5 minutes every 15 minutes"; the reminder at 10 minutes is deliberately earlier, because sessions are physical. A Classic round that reaches 6:00 shows the soft toast `hud.softBreak` once. None of this blocks play.
- **Rest built into the game:** breather waves (section 3.4), results-screen line `results.rest`, pause tip `pause.tip`.
- **Wrist and arm:** thresholds, hit radii and hang times are chosen so that a relaxed wrist flick cuts; the relative pointer makes a median hard stroke of 137 degrees cross the screen once, and the gain depends on the speed (section 8.2), so a modest swing is enough. The game must never *require* extreme velocity: above the threshold, speed only changes the trail colour and width (which stop changing at 4000 px/s at the default threshold); scoring never depends on how fast a swing is.
- Health wording is advice, not medical guidance. **UNVERIFIED-ON-HARDWARE (HW-12):** comfort with the real sword (weight, balance) is untested.

### 15.2 Photosensitivity and motion

- Full-screen flashes are rare, limited to at most one per 500 ms, alpha capped at 0.6, ramped (section 9.8). Nothing blinks above 3 Hz.
- **Reduce flashes** and **Reduce motion** (section 9.12) are reachable from the first-run screen, settings and pause. `prefers-reduced-motion` is honoured at first run.
- The background is static (also with the generated art, section 11.6: a small parallax during a shake only, and none with "Reduce motion"); the only large moving things are fruit.

### 15.3 Perception and input

- **Colour-independence:** every object class is distinguishable by silhouette and pattern: fruit are round with per-fruit shapes, the bomb is black with an X and a fuse, power-ups are medallions with unique icons, the golden apple has a leaf and orbiting stars. Lives are apple icons, not just red.
- **Contrast:** body text is always ink on paper (13.9:1) or paper on ink (15.5:1); vermilion text only at 40 px and larger (3.3:1) or the deep variant (5.3:1). Nothing important is grey text.
- **Text size:** at least 28 px at 1080p logical.
- **Audio is never the only cue:** every sound cue has a visual counterpart (banner, popup, icon), and the game is fully playable with volume 0.
- **Input alternatives:** no menu requires a button; dwell selection, keyboard and mouse always work; the simulator and mouse providers allow play without a Joy-Con or a sword; a seated player can play with small wrist motions (lower cut threshold, higher sensitivity).
- **Language:** all UI text is English (owner decision of 2026-09-30: the UI language changed from Italian to English), short sentences, no idioms that need cultural context.

---

## 16. Automation and test contract (design side)

The engineers own the exact API; this is what the designer requires so that agents and unit tests can verify the game.

### 16.1 URL flags (recommended)

`?input=joycon|sim|mouse`, `?seed=<int>`, `?mode=classic|arcade|zen` (skip to countdown, implies no safety screen; without `?input=` it implies `?input=mouse`), `?skipsafety=1`, `?clock=manual` (the loop advances only through `advance(ms)`), `?debug=1` (overlay: fps, stage, blade speed, hit circles, object ids).

### 16.2 `window.__ninja` semantics

| Method | Semantics |
|---|---|
| `start(mode, {seed, skipCountdown})` | reset and begin a round; with `skipCountdown` the first wave spawns 0.8 s later |
| `setSeed(n)` | applies to the next `start` |
| `snapshot()` | plain JSON-serialisable state (schema below) |
| `swing(from, to, ms)` | injects blade samples every **4 ms of simulated time** along the straight segment at constant speed `length / ms`, through the **same blade pipeline** as real samples (it skips only IMU parsing and orientation); resolves when done (synchronously in manual-clock mode). A swing slower than the threshold must *not* cut, and tests rely on that |
| `swingThrough(objectId, {angleDeg, speed})` | convenience: a swing crossing the object centre at `speed` px/s (default 3000) at the given angle |
| `advance(ms)` | manual clock: run fixed 1/120 s steps |
| `pause()` / `resume()` | as the pause action |
| `press(action)` | `confirm`, `back`, `pause`, `recenter` |
| `getConfig()` | the frozen config (so agents never hard-code numbers) |

### 16.3 Snapshot schema

```
{
  screen, mode, seed, t /* game seconds */, waveIndex, stage,
  score, lives /* Classic else null */, timeLeft /* Arcade, Zen else null */,
  lifeRegen: { progress, per: 25 },
  combo: { swingId, n, open }, timeScale,
  powerups: [ { id, remainingS } ],
  blade: { x, y, speed, cutting, swingId },
  objects: [ { id, kind /* fruit|bomb|powerup|golden */, type, x, y, vx, vy, r, hitR, cut } ],
  stats: { fruitCut, fruitMissed, bombsHit, bestCombo, powerupsTaken },
  events: [ { t, type /* cut|miss|bomb|combo|powerup|lifeLost|gameOver */, ... } ] /* last 32 */
}
```

### 16.4 Determinism [MUST]

Same seed, same scripted swings, same manual-clock steps give an **identical** snapshot sequence. The two RNG streams of section 2.8 are separate; turning particles off must not change the object list.

### 16.5 Invariants to turn into `node --test` tests

1. **Spawn validity:** across 10,000 random waves per mode and stage, every arc satisfies 100 <= x <= 1820 for its whole life, apex y >= 240 (side throws 300), launch speed <= 1900 px/s, and the cull happens after 1.7 to 2.6 s of air time (side throws 1.3 to 1.9 s).
2. **Determinism:** the first 100 waves of a seed are identical regardless of player input in Classic without power-ups.
3. **No tunnelling:** a single blade segment of any length (for example 1800 px in one sample) cuts every fruit whose centre is within `hitR` of it, in order along the segment.
4. **Threshold:** aim path and simulator (px tracker, threshold 1000 px/s = 300 deg/s): a swing crossing a fruit at 900 px/s does not cut; at 1100 px/s it cuts. Hysteresis: after entering `CUTTING`, dipping to 700 px/s for 50 ms keeps the same swing; below 650 px/s ends it. Real Joy-Con (angular tracker, tip speed in deg/s): 290 does not cut, 310 held for two samples cuts, a one-sample spike never cuts, a dip to 210 keeps the swing, below 195 ends it; the first chord is delivered retroactively; and the real recording's acceptance metrics (`docs/motion-contract.md` section 5, `test/motion/real-replay.test.js`, `test/app/real-replay-app.test.js`).
5. **Bomb:** a slow contact never explodes a bomb; a cutting-speed crossing inside 54 px does; inside 120 px but outside 54 px it triggers the near-miss once.
6. **Combo formula:** groups of 2 to 10 award exactly `5 n (n - 1)`; n = 11 awards 450; Double doubles the bonus and each fruit's points but not the -50 penalty.
7. **Combo window:** cuts 250 ms apart join, 260 ms apart do not; a bomb closes the group at once.
8. **Lives:** 3 uncut fruit falling within 1.2 s cost exactly 1 life; a bomb inside the window still costs 1; 25 fruit cut restore 1 life up to 3; a bomb resets the counter.
9. **Arcade:** bomb subtracts 50 (never below 0) and 5 s; Clock +4 s and golden +3 s never push remaining time above 90 s.
10. **Time scale:** during Freeze, the round timer and power-up durations advance at real speed while fruit fall at 0.4x; effective scale is the minimum, not the product.
11. **Halves:** the two halves' velocities average to the parent velocity plus the blade push; no half can be cut or counted as missed.
12. **Persistence:** with storage throwing on every access the game runs, keeps scores in memory, and never throws.
13. **Config-only numbers:** a grep for the literals 1300 (gravity) and 1190 (spawn line) outside the config module finds nothing.
14. **Flash limiter:** two bomb hits 300 ms apart produce one full-screen flash.

---

## 17. Hardware-dependent assumptions register

Everything below is **UNVERIFIED-ON-HARDWARE**. Nothing was verified on a physical Joy-Con 2. Each row says what to test and which constant to tune.

| ID | Assumption | What to test when the device is available | Constant(s) to tune |
|---|---|---|---|
| HW-1 | BLE plus browser latency leaves room inside the 50 ms input-to-screen target | measure event timestamps vs. paint time on the diagnostics page | none (report); trail/cut rules already avoid extra lag |
| HW-2 | The speed-dependent pointer curve (5 to 14 px per degree, dead zone 5 deg/s) is comfortable and reaches all four corners (simulator: 27.4 px/deg, 70 x 39.4 degrees) | swing the real sword, note reach at the screen corners on the tuning page | `MOTION_CONFIG.pointer`, sensitivity default |
| HW-3 | Real Joy-Con (relative pointer): a hand-held sword that tries to hold still moves the cursor 0 px (dead zone 5 deg/s; measured on one recording: tremor median 1.7 to 3.1, p99 22 to 47 deg/s, gyro bias 0.3 to 0.7 deg/s, integrated drift 0.02 to 0.19 degrees in 8 s), and the idle glide (rest 8 deg/s for 1.0 s) brings the cursor home. Simulator: yaw drift and soft centring as before | hold still 60 s and watch the cursor; rest 1 s and see it glide; play a full round | dead zone, rest threshold, rest time, glide speeds |
| HW-4 | Pairing steps 1 and 2 (unpair elsewhere, hold the sync button until the lights flash) match Joy-Con 2 | follow the steps on the real device | `connect.step1`, `connect.step2` text |
| HW-5 | A 10 s cooldown between attempts is useful; one automatic reconnect to the known device is possible without the chooser | force disconnects and retries at different intervals | `connect.cooldownS`, `connect.autoReconnectAttempts`, `connect.autoReconnectDelayS` (Appendix A) |
| HW-6 | A `recenter` shoulder/trigger button and a small `pause` button are reachable with the Joy-Con strapped to the sword | try to press each button holding the sword | action mapping, `{button}` labels |
| HW-7 | The two-pose mount calibration works; stillness thresholds (6 deg/s mean, 15 deg/s peak, 5% of 1 g) are achievable with a hand-held sword | run calibration with several mounts (flat, side, upside down) and both sides | stillness thresholds, pose-angle window 65 to 115 degrees, hold times |
| HW-8 | Battery level is readable; "low" at or below 15% | read the battery on the diagnostics page | `connect.lowBatteryPct` (Appendix A) |
| HW-9 | 300 deg/s separates deliberate swings from aiming and tremor (measured on ONE recording: aiming p99 253 and max 326 deg/s, slowest hard stroke 632; the first test with 1000 px/s = 36 deg/s cut everything) | swing and aim slowly; look for false cuts while pointing; read "Last swing" on the tuning page | `cutThreshold` default, hysteresis ratio 0.65 |
| HW-10 | Gyro range does not saturate in hard swings; the 2190 deg/s safety cap is never hit (one real recording, 2026-09-30: the hardest swing of the owner reached 1049 deg/s and the nominal scale of 0.0610 dps per LSB held within the accuracy of a hand-timed test, 4 table turns integrated to 3.99 turns; the real unit's full scale is still not measured). The protocol notes in progress (`docs/joycon2-test-vectors.json`) list a gyro scale of 0.061 dps per LSB, which for a signed 16-bit value implies about 2000 dps full scale; this is from documentation, not from the device | max-speed swings, watch raw values | `cut.safetyCapDegPerS` |
| HW-11 | Left and right Joy-Con 2 differ only in axis signs and can be told apart automatically | connect both sides | provider axis tables, side detection |
| HW-12 | Sword weight and balance are comfortable for the round lengths and break advice | play a full session, note fatigue | break interval (10 min), round lengths |

Out of scope here: whether Web Bluetooth can connect to the Joy-Con 2 at all, and the packet format. That is the protocol research; this document only assumes the `aim` / `actions` / `status` interface of section 8.1.

---

## 18. Design risks and open questions

Top risks, in order:

1. **Yaw drift** (HW-3) makes aim wander; mitigations are soft centring, manual recenter, the always-visible cursor, mercy rules, the large hit radii. If drift is severe the game feels unfair regardless of tuning.
2. **Cut threshold vs. tremor** (HW-9): too low gives false cuts while aiming (and, because a bomb can only explode at or above the threshold, makes accidental bomb hits more likely); too high makes the sword feel dead. The live speed meter in settings is the safety valve.
3. **BLE latency** (HW-1): if the radio alone exceeds 35 ms the swing feels laggy and the 50 ms target fails.
4. **Menu selection by sword** (dwell and cut): accidental selections while swinging; mitigated by dwell 900 ms, 1.2 s results lockout, big spaced targets, and keyboard/mouse fallbacks.
5. **Mount calibration** (HW-7): the two-pose method is a design proposal; if a mount makes gravity nearly parallel in both poses the flow fails; a manual axis picker may be needed.
6. **Arm fatigue and difficulty**: Classic plateau (3.5 fruit/s) may be too hard for long physical play; breathers and break reminders help; ranks and pacing need playtests.
7. **Classic pacing**: with 3 lives and misses costing life, engaged accuracy of about 88% is needed for 2 to 4 minutes; the regen rule (+1 per 25 fruit) and mercy window are the levers.
8. **Untuned economy**: ranks and combo values are first-pass constants; re-tune after simulator-bot and owner playtests.
9. **"Hand" setting interpretation**: implemented as an ergonomic spawn bias only (the motion pipeline does not need to know the hand); if the owner meant the Joy-Con side, that is auto-detected and shown, with an override in diagnostics.
10. **Pairing/cooldown wording** (HW-4, HW-5) may be wrong for Joy-Con 2; only two strings and one constant to change.

Open questions for the owner: (a) should Classic bombs be lethal by default (currently one life)? (b) is background music wanted? (c) do you want an in-game leaderboard on the Mac (local only, top 5) in a later version?

---

## Appendix A: `config.js` reference (same data as the tables)

If this block and the tables disagree, the tables win (section 0).

```js
export const CONFIG = Object.freeze({
  field: {
    w: 1920, h: 1080, spawnY: 1190, sideSpawnX: [-110, 2030], cullMargin: 40,
    cuttableMaxY: 1110, cuttableX: [-30, 1950], arcXMin: 100, arcXMax: 1820,
    apex: { regular: [240, 560], golden: [240, 360], powerup: [300, 460],
            bomb: [300, 520], frenzy: [320, 560], side: [300, 560], breather: [360, 500] },
    bands: { central: [480, 1440], wide: [220, 1700], centralShare: 0.7 },
    handBias: 80, minSeparationX: 220, bombSeparationX: 280, bombSeparationMinX: 260, towardCentreProb: 0.65, // bombSeparationX was 260
    spin: [1.5, 5.0], maxLifeS: 6.0,
  },
  time: { dt: 1 / 120, maxFrameS: 0.05, maxSteps: 6, firstWaveDelayS: 0.8 },
  gravity: 1300,
  caps: { fruit: 12, fruitFreeze: 14, fruitFrenzy: 16, halves: 40, particles: 400,
          splats: 24, popups: 12, voices: 24 },
  fruits: [
    // id, r, score, wEarly, wLate, juice
    { id: 'watermelon', r: 92, score: 10, wEarly: 14, wLate: 6,  juice: '#E8455A' },
    { id: 'pineapple',  r: 82, score: 10, wEarly: 10, wLate: 6,  juice: '#F5D34B' },
    { id: 'apple',      r: 68, score: 15, wEarly: 14, wLate: 10, juice: '#E8C04A' },
    { id: 'orange',     r: 68, score: 15, wEarly: 14, wLate: 10, juice: '#FF9A1F' },
    { id: 'pear',       r: 66, score: 15, wEarly: 10, wLate: 10, juice: '#C9D64A' },
    { id: 'peach',      r: 64, score: 15, wEarly: 10, wLate: 10, juice: '#F7A56A' },
    { id: 'lemon',      r: 60, score: 20, wEarly: 8,  wLate: 12, juice: '#F2E24A' },
    { id: 'kiwi',       r: 58, score: 20, wEarly: 8,  wLate: 12, juice: '#7BC043' },
    { id: 'strawberry', r: 52, score: 25, wEarly: 6,  wLate: 14, juice: '#E63946' },
    { id: 'cherry',     r: 48, score: 30, wEarly: 6,  wLate: 14, juice: '#B3122E' },
  ],
  hitMul: { fruit: 1.55, golden: 1.60, powerup: 1.50, bomb: 0.85 }, // was 1.25 / 1.30 / 1.25 / 0.85. hitR = round(r * mul) + hit.bladeHalfWidth[kind]
  hit: { bladeHalfWidth: { fruit: 14, golden: 14, powerup: 14, bomb: 0 } }, // px, the capsule (section 5.3); the bomb stays strict
  golden: { r: 64, score: 100, eligibleAtS: 20, gapS: 35, chance: 0.04, pity: 0.01, cap: 0.15,
            arcadeBonusS: 3, classicLife: 1 },
  bomb: { r: 64, arcadePenaltyScore: 50, arcadePenaltyS: 5, telegraphMs: 350, nearMissPx: 120 },
  powerups: {
    freeze: { r: 62, durationS: 5.0,  timeScale: 0.40, weight: 35, easeInMs: 200, easeOutMs: 400 },
    frenzy: { r: 62, durationS: 6.0,  weight: 30, waveIntervalS: 0.42, n: { 2: 50, 3: 50 },
              formation: { rain: 60, line: 40 }, lean: 8, g: 1.0, resumeDelayS: 1.2 },
    double: { r: 62, durationS: 10.0, multiplier: 2, weight: 35 },
    clock:  { r: 62, addS: 4, weight: 25, arcadeOnly: true },
    roll: { base: 0.06, pity: 0.02, cap: 0.30 },
    schedule: { classic: { firstS: 25, gapS: 20 }, arcade: { firstS: 8, gapS: 12 }, zen: { firstS: 20, gapS: 25 } },
  },
  cut: {
    thresholdDefault: 300, thresholdRange: [100, 700, 25], releaseRatio: 0.65,   // deg/s of tip speed since the sword tuning round (was 1000 px/s, [400, 2400, 100])
    minDurationMs: 25, candidateMaxMs: 100, aimPxPerDps: 10 / 3,                   // angular tracker (real Joy-Con); T_px = T x aimPxPerDps for the aim path and the simulator
    speedWindowMs: 50, mergeSegmentPx: 6, mergeFlushMs: 8, swingGraceMs: 100,      // px tracker (aim path, simulator)
    safetyCapDegPerS: 2190, safetyCapMousePxPerS: 60000, zenMul: 0.8,
  },
  pointer: { deadDps: 5, rampDps: 300, gLoPxDeg: 5, gHiPxDeg: 14, idleDps: 8, idleBreakDps: 14, idleHoldS: 1.0, quietMs: 500, centreGain: 2.5, centreMinPxS: 120,
             centreMaxPxS: 800, maxChordPx: 48, trailStepMs: 8, extrapolateMaxMs: 35 },   // the relative pointer (real Joy-Con); full list in docs/motion-contract.md 2.8
  combo: { windowMs: 250, closeGraceMs: 150, bonus: (n) => 5 * Math.min(n, 10) * (Math.min(n, 10) - 1) },
  halves: { separation: 240, bladePush: 0.12, bladePushMax: 500, spinAdd: [2, 4], offsetR: 0.15 },
  lives: { start: 3, max: 3, regenEvery: 25, mercyMs: 1200 },
  modes: {
    classic: { stages: [
      // t: start second, interval s, n: weights by count, bomb chance, g scale, lean deg, form: R/P/L/F/S weights
      { t: 0,   interval: 1.90, n: { 1: 50, 2: 50 },          bomb: 0.00, g: 1.00, lean: 10, form: [70, 30, 0, 0, 0] },
      { t: 20,  interval: 1.70, n: { 1: 30, 2: 40, 3: 30 },   bomb: 0.08, g: 1.03, lean: 12, form: [55, 25, 20, 0, 0] },
      { t: 45,  interval: 1.55, n: { 2: 50, 3: 50 },          bomb: 0.12, g: 1.06, lean: 12, form: [40, 20, 25, 10, 5] },
      { t: 75,  interval: 1.40, n: { 2: 30, 3: 40, 4: 30 },   bomb: 0.15, g: 1.10, lean: 14, form: [35, 15, 25, 15, 10] },
      { t: 105, interval: 1.30, n: { 2: 25, 3: 40, 4: 35 },   bomb: 0.18, g: 1.14, lean: 15, form: [30, 15, 25, 15, 15] },
      { t: 140, interval: 1.20, n: { 3: 50, 4: 50 },          bomb: 0.20, g: 1.18, lean: 15, form: [30, 10, 25, 20, 15] },
      { t: 180, interval: 1.20, n: { 3: 30, 4: 40, 5: 30 },   bomb: 0.22, g: 1.22, lean: 15, form: [30, 10, 25, 20, 15] },
      { t: 240, interval: 1.15, n: { 3: 30, 4: 40, 5: 30 },   bomb: 0.25, g: 1.25, lean: 15, form: [30, 10, 25, 20, 15] },
    ], bombs: true, bombFreeS: 20, breather: { every: 10, extraPauseS: 1.2 } },
    arcade: { durationS: 60, maxRemainingS: 90, bombFreeS: 5, stages: [
      { t: 0,  interval: 1.40, n: { 2: 50, 3: 50 },        bomb: 0.10, g: 1.05, lean: 12, form: [40, 25, 25, 10, 0] },
      { t: 15, interval: 1.25, n: { 2: 30, 3: 40, 4: 30 }, bomb: 0.14, g: 1.10, lean: 14, form: [35, 20, 25, 10, 10] },
      { t: 30, interval: 1.15, n: { 3: 50, 4: 50 },        bomb: 0.16, g: 1.15, lean: 15, form: [30, 15, 30, 15, 10] },
      { t: 45, interval: 1.05, n: { 3: 50, 4: 50 },        bomb: 0.18, g: 1.20, lean: 15, form: [30, 10, 30, 15, 15] },
    ], bombs: true, breather: null },
    zen: { durationS: 90, cutMul: 0.8, stages: [
      { t: 0,  interval: 1.80, n: { 1: 30, 2: 40, 3: 30 }, bomb: 0, g: 0.90, lean: 10, form: [60, 25, 15, 0, 0] },
      { t: 30, interval: 1.55, n: { 2: 50, 3: 50 },        bomb: 0, g: 0.90, lean: 12, form: [45, 20, 25, 10, 0] },
      { t: 60, interval: 1.35, n: { 2: 25, 3: 50, 4: 25 }, bomb: 0, g: 0.92, lean: 12, form: [40, 15, 25, 20, 0] },
    ], bombs: false, breather: { every: 10, extraPauseS: 1.2 } },
  },
  ranks: { // lower bounds of ranks 2..5
    classic: [800, 2000, 4000, 7000], arcade: [600, 1300, 2200, 3200], zen: [600, 1200, 1900, 2600],
  },
  blade: {
    idleWindowMs: 120, cutWindowMs: [160, 240], maxPoints: 48, headWidth: { idle: 4, min: 16, max: 30 },
    taperPower: 1.2, glowExtraPx: 14,
    stops: [ // offsets added to T
      { dv: 0,    core: '#14141C', edge: '#D9432B', w: 16 },
      { dv: 1200, core: '#14141C', edge: '#F2B134', w: 24 },
      { dv: 3000, core: '#FFF3D1', edge: '#F2B134', w: 30 },
    ],
    idleColor: '#8A8175', idleAlpha: 0.35,
  },
  cursor: { ringR: 24, dotR: 7, cutR: 22, dwellMs: 900, lostAfterMs: 200 },
  input: { pxPerDegBase: 27.4, sensitivityDefault: 1.0, sensitivityRange: [0.3, 2.0, 0.1],   // absolute model (simulator); the relative pointer and the angular cut decision are MOTION_CONFIG.pointer and .cut (docs/motion-contract.md 2.8)
           restDegPerS: 8, restHoldS: 1.0, restBreakDegPerS: 12, slewDegPerS: 3, cutQuietMs: 500,
           edgeSlipDeg: 8, edgeSlipHoldS: 0.5, edgeSlipDegPerS: 20, recenterEaseMs: 150 },
  juice: {
    slowmo: { combo4: { scale: 0.35, ms: 450 }, combo7: { scale: 0.25, ms: 800 },
              nearMiss: { scale: 0.50, ms: 250 }, golden: { scale: 0.40, ms: 350 },
              gameOver: { scale: 0.30, ms: 700 }, cooldownMs: 3000, nearMissCooldownMs: 2000,
              easeInMs: 60, easeOutMs: 150 },
    shake: { bomb: [22, 500], combo8: [12, 220], combo5: [8, 160], life: [8, 200], golden: [6, 150],
             gameOver: [14, 400], hz: 26 },
    hitStopMs: 60, zoomPunch: { scale: 1.03, inMs: 60, outMs: 240 },
    flash: { minGapMs: 500, maxAlpha: 0.6, inMs: 80, outMs: 250 },
    splat: { holdMs: 1500, fadeMs: 4500, alpha: 0.55, satellites: [5, 9] },
    particles: { droplets: 14, flecks: 6, bombSparks: 40, bombSmoke: 20 },
    popup: { riseBase: 70, riseCombo: 90, ms: 700, msCombo: 900 },
    bannerHoldMs: 700, bannerFadeMs: 250,
  },
  audio: { volumeDefault: 0.7, masterCurve: (v) => 0.8 * v * v,
           compressor: { threshold: -14, knee: 12, ratio: 4, attack: 0.003, release: 0.12 },
           panMax: 0.7, voices: 24, pentatonic: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] },
  connect: { cooldownS: 10, autoReconnectAttempts: 1, autoReconnectDelayS: 2, lowBatteryPct: 15 },
  calibration: {
    stillMeanDegPerS: 6, stillPeakDegPerS: 15, stillAccelTolerance: 0.05,
    holdS: { pose1: 2.0, pose2: 1.5, autoCentreS: 3.0 }, poseAngleDeg: [65, 115], practiceTimeoutS: 20,
  },
  results: { lockoutMs: 1200, countUpMs: 1200, slideInMs: 400 },
  breaks: { reminderAfterMs: 600000, idleResetMs: 300000, classicSoftBreakS: 360 },
  storageKey: 'joyconNinja.v1',
});
```
