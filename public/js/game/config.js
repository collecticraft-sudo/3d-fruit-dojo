// Game configuration (data only, deep-frozen). OWNER: Gameplay engineer.
//
// Source: docs/game-design.md Appendix A, minus the blocks owned by other modules (input, cut, calibration, connect),
// plus the additions required by docs/architecture.md section 7.7 (modes.<mode>.cutMul, ending, practice) and a few
// blocks that turn prose numbers of the design into data (spawn, ids, combo/audio numeric fields).
// Where the design prose and Appendix A disagree, the tables of the design body win (design section 0).
//
// This file is the ONLY place where gravity (base value) and the spawn line height may appear as literals
// (test/architecture/boundaries.test.js). Everything in game/ reads them from here.
//
// HARDWARE HONESTY: none of these numbers was tried with a real sword and a real Joy-Con 2. The ones that decide how
// the game FEELS (spawn bands vs the reachable screen span, hit radii vs yaw drift, the 3.5 fruit/s ceiling, the
// bomb near-miss band) are starting values, UNVERIFIED-ON-HARDWARE (design register HW-2, HW-3, HW-9, HW-12). Tune them
// here after the first real session; no logic needs to change.

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export const CONFIG = deepFreeze({
  field: {
    w: 1920,
    h: 1080,
    spawnY: 1190, // vertical throws start here (110 px below the screen)
    sideSpawnX: [-110, 2030], // side throws start left / right of the screen
    cullMargin: 40, // cull line = h + r + cullMargin while descending
    cuttableMaxY: 1110, // objects with centre y >= this cannot be cut
    cuttableX: [-30, 1950], // ... nor outside this x range
    arcXMin: 100,
    arcXMax: 1820, // every vertical arc stays inside [arcXMin, arcXMax]
    apex: {
      regular: [240, 560],
      golden: [240, 360],
      powerup: [300, 460],
      bomb: [300, 520],
      frenzy: [320, 560],
      side: [300, 560],
      breather: [360, 500],
    },
    bands: { central: [480, 1440], wide: [220, 1700], centralShare: 0.7 },
    handBias: 80, // px, spawn bands shift toward the player's hand side
    minSeparationX: 220, // px between apexes of objects launched within sepWindowMs
    sepWindowMs: 300,
    // px between a bomb's apex and every fruit apex of its wave. Was 260. Rule: >= largest fruit hitR (watermelon 157) + bomb.nearMissPx (120)
    // = 277, so a swing that only just reaches a neighbouring fruit can never land in the bomb's near-miss band, let alone on the bomb.
    bombSeparationX: 280,
    bombSeparationMinX: 260, // px, the old value: used when no slot keeps 280 px from every fruit apex of a dense wave (about 1 bomb in 1000)
    towardCentreProb: 0.65,
    spin: [1.5, 5.0], // rad/s
    maxLifeS: 6.0, // world seconds, safety net
    sideExitMargin: 200, // object removed silently when x < -(r + margin) or x > w + r + margin
  },
  time: { dt: 1 / 120, maxFrameS: 0.05, maxSteps: 6, firstWaveDelayS: 0.8, maxBackProjectMs: 100 }, // maxBackProjectMs: how far back a blade segment's collision rewinds the objects (input latency)
  gravity: 1300,
  caps: { fruit: 12, fruitFreeze: 14, fruitFrenzy: 16, halves: 40, particles: 400, splats: 24, popups: 12, voices: 24 },
  fruits: [
    // id, r, score, wEarly, wLate, juice colour (hitR = round(r * hitMul.fruit) + hit.bladeHalfWidth.fruit)
    { id: 'watermelon', r: 92, score: 10, wEarly: 14, wLate: 6, juice: '#E8455A' },
    { id: 'pineapple', r: 82, score: 10, wEarly: 10, wLate: 6, juice: '#F5D34B' },
    { id: 'apple', r: 68, score: 15, wEarly: 14, wLate: 10, juice: '#E8C04A' },
    { id: 'orange', r: 68, score: 15, wEarly: 14, wLate: 10, juice: '#FF9A1F' },
    { id: 'pear', r: 66, score: 15, wEarly: 10, wLate: 10, juice: '#C9D64A' },
    { id: 'peach', r: 64, score: 15, wEarly: 10, wLate: 10, juice: '#F7A56A' },
    { id: 'lemon', r: 60, score: 20, wEarly: 8, wLate: 12, juice: '#F2E24A' },
    { id: 'kiwi', r: 58, score: 20, wEarly: 8, wLate: 12, juice: '#7BC043' },
    { id: 'strawberry', r: 52, score: 25, wEarly: 6, wLate: 14, juice: '#E63946' },
    { id: 'cherry', r: 48, score: 30, wEarly: 6, wLate: 14, juice: '#B3122E' },
  ],
  // HIT AREAS (owner feedback after the first real Joy-Con session: "the hitbox of the fruit seems a bit too small").
  // The cut test is a CAPSULE: the blade chord (zero thickness) must come within hitR of the object centre, where
  //   hitR = round(r * hitMul[kind]) + hit.bladeHalfWidth[kind]          (physics.hitRadius, the number in the snapshot)
  // `hitMul` is the PROPORTIONAL part (it grows with the fruit), `hit.bladeHalfWidth` the CONSTANT part (it matters most for the
  // small fruit: cherry 48 gains +29 percent of r, watermelon 92 only +15). Measured against the drawn sprites (docs/game-design.md 5.3):
  // the visible body (without crown, stem, leaves) of every fruit already lay inside the old circle, but the old circle reached only
  // 2 to 20 px beyond the farthest point of the visible body (60 to 100 percent of the swings within 20 px of the edge cut); the new
  // one reaches 33 to 62 px beyond it, so a swing within 20 px of the visible edge always cuts, with the margin the 33 Hz relative
  // pointer needs. UNVERIFIED-ON-HARDWARE (HW-3): how generous this feels with the real sword.
  hitMul: { fruit: 1.55, golden: 1.6, powerup: 1.5, bomb: 0.85 }, // was 1.25 / 1.3 / 1.25 / 0.85. Bomb UNCHANGED on purpose (see bladeHalfWidth.bomb)
  hit: {
    // px, added to the hit radius of every object kind. 14 is the largest half width of the drawn blade trail
    // (blade.headWidth.max 30 / 2 = 15, minus 1): the player never cuts something the trail visibly does not reach.
    // The BOMB gets 0: "the blade must really go through it" (design 4.3), so a graze that cuts a neighbouring fruit never explodes it.
    bladeHalfWidth: { fruit: 14, golden: 14, powerup: 14, bomb: 0 },
  },
  golden: { r: 64, score: 100, eligibleAtS: 20, gapS: 35, chance: 0.04, pity: 0.01, cap: 0.15, arcadeBonusS: 3, classicLife: 1 },
  // nearMissPx: distance from the bomb CENTRE (hitR 54, so a band 66 px wide). Unchanged: the bomb hit test did not change, and field.bombSeparationX keeps neighbouring fruit out of the band.
  bomb: { r: 64, arcadePenaltyScore: 50, arcadePenaltyS: 5, telegraphMs: 350, nearMissPx: 120 },
  powerups: {
    freeze: { r: 62, durationS: 5.0, timeScale: 0.4, weight: 35, easeInMs: 200, easeOutMs: 400 },
    frenzy: {
      r: 62, durationS: 6.0, weight: 30, waveIntervalS: 0.42, intervalJitter: 0.1, n: { 2: 50, 3: 50 },
      formation: { rain: 60, line: 40 }, lean: 8, g: 1.0, resumeDelayS: 1.2,
    },
    double: { r: 62, durationS: 10.0, multiplier: 2, weight: 35 },
    clock: { r: 62, addS: 4, weight: 25, arcadeOnly: true },
    roll: { base: 0.06, pity: 0.02, cap: 0.3 },
    schedule: {
      classic: { firstS: 25, gapS: 20 },
      arcade: { firstS: 8, gapS: 12 },
      zen: { firstS: 20, gapS: 25 },
    },
  },
  // Combo rules (design 5.4). `bonusFactor` and `capN` are the data; `bonus` is the Appendix A function derived from them.
  combo: {
    windowMs: 250, closeGraceMs: 150, bonusFactor: 5, capN: 10,
    bonus: (n) => (n < 2 ? 0 : 5 * Math.min(n, 10) * (Math.min(n, 10) - 1)),
  },
  halves: { separation: 240, bladePush: 0.12, bladePushMax: 500, spinAdd: [2, 4], offsetR: 0.15 },
  lives: { start: 3, max: 3, regenEvery: 25, mercyMs: 1200 },
  modes: {
    classic: {
      cutMul: 1,
      stages: [
        // t: start second, interval s, n: weights by count, bomb chance, g scale, lean deg, form: R/P/L/F/S weights
        { t: 0, interval: 1.9, n: { 1: 50, 2: 50 }, bomb: 0.0, g: 1.0, lean: 10, form: [70, 30, 0, 0, 0] },
        { t: 20, interval: 1.7, n: { 1: 30, 2: 40, 3: 30 }, bomb: 0.08, g: 1.03, lean: 12, form: [55, 25, 20, 0, 0] },
        { t: 45, interval: 1.55, n: { 2: 50, 3: 50 }, bomb: 0.12, g: 1.06, lean: 12, form: [40, 20, 25, 10, 5] },
        { t: 75, interval: 1.4, n: { 2: 30, 3: 40, 4: 30 }, bomb: 0.15, g: 1.1, lean: 14, form: [35, 15, 25, 15, 10] },
        { t: 105, interval: 1.3, n: { 2: 25, 3: 40, 4: 35 }, bomb: 0.18, g: 1.14, lean: 15, form: [30, 15, 25, 15, 15] },
        { t: 140, interval: 1.2, n: { 3: 50, 4: 50 }, bomb: 0.2, g: 1.18, lean: 15, form: [30, 10, 25, 20, 15] },
        { t: 180, interval: 1.2, n: { 3: 30, 4: 40, 5: 30 }, bomb: 0.22, g: 1.22, lean: 15, form: [30, 10, 25, 20, 15] },
        { t: 240, interval: 1.15, n: { 3: 30, 4: 40, 5: 30 }, bomb: 0.25, g: 1.25, lean: 15, form: [30, 10, 25, 20, 15] },
      ],
      bombs: true,
      bombFreeS: 20,
      breather: { every: 10, extraPauseS: 1.2 },
    },
    arcade: {
      cutMul: 1,
      durationS: 60,
      maxRemainingS: 90,
      bombFreeS: 5,
      stages: [
        { t: 0, interval: 1.6, n: { 2: 60, 3: 40 }, bomb: 0.1, g: 1.05, lean: 12, form: [40, 25, 25, 10, 0] }, // warm-up: 1.5 fruit/s (was 1.79), the arm is cold
        { t: 15, interval: 1.25, n: { 2: 30, 3: 40, 4: 30 }, bomb: 0.14, g: 1.1, lean: 14, form: [35, 20, 25, 10, 10] },
        { t: 30, interval: 1.15, n: { 3: 50, 4: 50 }, bomb: 0.16, g: 1.15, lean: 15, form: [30, 15, 30, 15, 10] },
        { t: 45, interval: 1.05, n: { 3: 50, 4: 50 }, bomb: 0.18, g: 1.2, lean: 15, form: [30, 10, 30, 15, 15] },
      ],
      bombs: true,
      breather: null,
    },
    zen: {
      cutMul: 0.8, // architecture A-02: replaces the design's cut.zenMul
      durationS: 90,
      stages: [
        { t: 0, interval: 1.8, n: { 1: 30, 2: 40, 3: 30 }, bomb: 0, g: 0.9, lean: 10, form: [60, 25, 15, 0, 0] },
        { t: 30, interval: 1.55, n: { 2: 50, 3: 50 }, bomb: 0, g: 0.9, lean: 12, form: [45, 20, 25, 10, 0] },
        { t: 60, interval: 1.35, n: { 2: 25, 3: 50, 4: 25 }, bomb: 0, g: 0.92, lean: 12, form: [40, 15, 25, 20, 0] },
      ],
      bombs: false,
      breather: { every: 10, extraPauseS: 1.2 },
    },
    // Calibration step 4 (architecture A-16). No stages: throws are scripted by CONFIG.practice.
    practice: { cutMul: 1 },
  },
  ranks: {
    // lower bounds of ranks 2..5
    classic: [800, 2000, 4000, 7000],
    arcade: [600, 1300, 2200, 3200],
    zen: [600, 1200, 1900, 2600],
  },
  blade: {
    idleWindowMs: 120, cutWindowMs: [160, 240], maxPoints: 48, headWidth: { idle: 4, min: 16, max: 30 },
    taperPower: 1.2, glowExtraPx: 14,
    stops: [
      // offsets added to T
      { dv: 0, core: '#14141C', edge: '#D9432B', w: 16 },
      { dv: 1200, core: '#14141C', edge: '#F2B134', w: 24 },
      { dv: 3000, core: '#FFF3D1', edge: '#F2B134', w: 30 },
    ],
    idleColor: '#8A8175', idleAlpha: 0.35,
  },
  cursor: { ringR: 24, dotR: 7, cutR: 22, dwellMs: 900, lostAfterMs: 200 },
  juice: {
    slowmo: {
      combo4: { scale: 0.35, ms: 450 },
      combo7: { scale: 0.25, ms: 800 },
      nearMiss: { scale: 0.5, ms: 250 },
      golden: { scale: 0.4, ms: 350 },
      gameOver: { scale: 0.3, ms: 700 },
      cooldownMs: 3000,
      nearMissCooldownMs: 2000,
      easeInMs: 60,
      easeOutMs: 150,
      reduceMotionMinScale: 0.5, // design 9.12 / architecture 7.3
    },
    shake: {
      bomb: [22, 500], combo8: [12, 220], combo5: [8, 160], life: [8, 200], golden: [6, 150], gameOver: [14, 400], hz: 26,
    },
    hitStopMs: 60,
    zoomPunch: { scale: 1.03, inMs: 60, outMs: 240 },
    flash: { minGapMs: 500, maxAlpha: 0.6, inMs: 80, outMs: 250 },
    splat: { holdMs: 1500, fadeMs: 4500, alpha: 0.55, satellites: [5, 9] },
    particles: { droplets: 14, flecks: 6, bombSparks: 40, bombSmoke: 20 },
    popup: { riseBase: 70, riseCombo: 90, ms: 700, msCombo: 900 },
    bannerHoldMs: 700,
    bannerFadeMs: 250,
  },
  audio: {
    volumeDefault: 0.7,
    masterGain: 0.8,
    masterExponent: 2,
    masterCurve: (v) => 0.8 * v * v, // Appendix A form of masterGain * v ^ masterExponent
    compressor: { threshold: -14, knee: 12, ratio: 4, attack: 0.003, release: 0.12 },
    panMax: 0.7,
    voices: 24,
    pentatonic: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21],
  },
  results: { lockoutMs: 1200, countUpMs: 1200, slideInMs: 400 }, // lockoutMs counts from the moment the panel is fully in (QA-03)
  breaks: { reminderAfterMs: 600000, idleResetMs: 300000, classicSoftBreakS: 360 },
  storageKey: 'joyconNinja.v1',

  // ---- additions (architecture 7.7) -------------------------------------------------------------------------------
  // Delays (real ms) after which phase becomes 'over'. classic: after gameOver; arcade: after timeUp (300 ms world
  // freeze + 1000 ms); zen: after timeUp.
  ending: { classicResultsMs: 800, arcadeFreezeMs: 300, arcadeResultsMs: 1300, zenResultsMs: 600 },
  practice: { apexX: 960, apexY: 400, gScale: 1.0, firstThrowS: 0.8, everyS: 3.0, timeoutS: 20, fruit: 'apple' },

  // ---- additions (design prose turned into data) ------------------------------------------------------------------
  // Ids: halves use their own counter so that object ids depend only on the spawn order (never on how many cuts happened)
  // and stay unique against object ids.
  ids: { halfBase: 1000000 },
  spawn: {
    sameTypeMax: 2, // a wave never holds one fruit type more than twice
    intervalJitter: 0.15, // wave interval +-15% (design 3)
    retryStepMs: 200, // back-pressure: a wave that would exceed the population cap is delayed in these steps
    rain: { delayStepMs: [70, 150], retries: 6 },
    pair: { centre: [640, 1280], offset: 150, apexBase: [320, 500], apexSpread: 30, delaysMs: [0, 40], vx: [-90, 90] },
    line: {
      // spacing was { 3: 240, 4: 230, 5: 220 }. Rule: >= twice the hitR of an average fruit (r 68: 2 x 119 = 238), so neighbouring cut regions of average fruit do not overlap
      centre: [860, 1060], spacing: { 3: 260, 4: 250, 5: 240 }, apexBase: [320, 500], apexSpread: 30,
      vx: [-60, 60], delayMs: [0, 30],
    },
    fan: {
      x0: [700, 1220], spreadStage3: 300, spreadStage6: 420, apexBase: [300, 480], apexAlt: 60, delayStepMs: 50,
    },
    side: {
      y0: [700, 900], vx: [620, 900], singleShare: 0.7, secondDelayMs: 250, cullXMax: 1780,
    },
    extras: {
      bomb: { vx: [-120, 120], delayMs: [0, 200], retries: 8 },
      powerup: { vx: [-80, 80], delayMs: [150, 300] },
      golden: { vx: [-80, 80], delayMs: [100, 250] },
    },
    events: { maxLogged: 32, maxUndrained: 8192 },
  },
});
