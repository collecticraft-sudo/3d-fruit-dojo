// Motion configuration (data only, deep-frozen). OWNER: motion engineer.
//
// Layout follows docs/architecture.md section 6.8: the design's `input`, `cut` and `calibration` blocks (game-design
// Appendix A) plus the fusion values. Keys marked (+) were added by Motion beyond the architecture text; every addition is
// logged in docs/contract-notes.md.
//
// HARDWARE HONESTY: every number that depends on how a real Joy-Con 2 on a real sword behaves (hand tremor, drift rate,
// gyro noise, rest thresholds, slew rates) is a STARTING VALUE, UNVERIFIED-ON-HARDWARE (design HW-2, HW-3, HW-7, HW-9, HW-10;
// protocol UOH-4, UOH-6, UOH-7). They live here as separate constants so they can be tuned in minutes on the real sword.

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) deepFreeze(value);
  }
  return Object.freeze(obj);
}

export const MOTION_CONFIG = deepFreeze({
  /** Orientation -> screen mapping and re-centring (design 8.2, 8.3). */
  input: {
    // ABSOLUTE model (the simulator, pointerModel 'absolute'); the real sword uses the relative model in `pointer` below.
    pxPerDegBase: 27.4, // 1920 px / 70 deg, same scale on both axes. UNVERIFIED-ON-HARDWARE (HW-2)
    // Sensitivity is one multiplier for both models (docs/motion-contract.md 2.6, 3.1): the absolute model reads it as
    // 27.4 px/deg x value, the relative model as a factor on the whole pointer curve (`pointer`). Range widened downwards (was 0.5).
    sensitivityDefault: 1.0,
    sensitivityRange: [0.3, 2.0, 0.1],
    restDegPerS: 8, // auto-centre starts below this angular speed ...
    restHoldS: 1.0, // ... held for this long
    restBreakDegPerS: 12, // auto-centre stops above this angular speed
    slewDegPerS: 3, // auto-centre slew rate (82 px/s at sensitivity 1). UNVERIFIED-ON-HARDWARE (HW-3)
    cutQuietMs: 500, // no CUTTING during this long before auto-centre may run
    edgeSlipDeg: 8, // raw aim this far beyond the playfield ...
    edgeSlipHoldS: 0.5, // ... for this long starts the edge slip
    edgeSlipDegPerS: 20,
    recenterEaseMs: 150,
  },

  /**
   * RELATIVE pointer of the real sword (docs/motion-contract.md 1 and 2.1 to 2.5). Measured on the first real Joy-Con 2 recording
   * (docs/motion-findings.md): hand tremor stays below 5 deg/s, slow aiming is 40 to 260 deg/s, hard strokes peak at 632 to 1049 deg/s.
   * Everything here is a STARTING VALUE, UNVERIFIED-ON-HARDWARE for feel; the numbers that the recording measured are noted.
   */
  pointer: {
    deadDps: 5, // tip speed at or below this moves nothing (tremor p99 3.5, max 5.0 after trimming)
    rampDps: 300, // gain rises from gLo to gHi over this much speed above the dead zone (smoothstep)
    gLoPxDeg: 5, // px per degree just above the dead zone at sensitivity 1.0
    gHiPxDeg: 14, // px per degree for fast motion at sensitivity 1.0 (HORIZONTAL axis; the vertical gain is capped, see below)
    // (+) round F1 (docs/motion-contract.md 2.9): the vertical axis follows the ELEVATION of the blade (gravity-stabilised pitch)
    // and its gain is capped, so the cursor height does not depend on the path and the speed of the swing. Measured on the
    // recording: the local frame integral of the vertical tip rate over fast_swings_h is -357 degrees while the true elevation of
    // the tip changes by +1 degree (wrist roll tilts the local axes), and an accelerating gain turns the remaining up and down
    // movements of unequal speed into a net drift. UNVERIFIED-ON-HARDWARE for feel.
    gravityVertical: true, // false: the vertical rate is the local one (w . right) with the accelerating curve, as before round F1
    verticalMaxPxDeg: 6, // the vertical gain is the curve above, never more than this (px per degree at sensitivity 1.0)
    gravityMinCos: 0.05, // nearer than asin(0.05) = 2.9 degrees to the zenith the pitch axis is undefined: the local rate is used
    idleDps: 8, // idle soft auto-centre starts after idleHoldS below this tip speed ...
    idleBreakDps: 14, // ... and stops at once above this one
    idleHoldS: 1.0,
    quietMs: 500, // no CUTTING during this long before the centring may run
    centreGain: 2.5, // centring speed = gain x distance (1/s), clamped to [centreMinPxS, centreMaxPxS]
    centreMinPxS: 120,
    centreMaxPxS: 800,
    centreRampMs: 300, // the centring speed ramps up over this long after it starts
    centreArriveEventPx: 40, // announce 'auto' on arrival only if the cursor travelled at least this far
    maxChordPx: 48, // collision chords between two IMU samples are at most about this long (bound: 2 x)
    maxSubSteps: 32,
    trailStepMs: 8, // interpolated samples of recent() every this many ms
    maxTrailSteps: 8,
    minChordPx: 1, // chords shorter than this are not emitted (merged into the next one)
    extrapolateMaxMs: 35, // headAt() looks this far ahead at most (quadratic, never reversing)
  },

  /** Blade speed, cut state and segments (design 5.1, 5.2, contract 2.4 and 2.6). */
  cut: {
    // The cut decision is in angular TIP speed, deg/s, independent of the sensitivity (contract D3).
    thresholdDefault: 300, // deg/s. Normal; presets Easy 225, Hard 450. UNVERIFIED-ON-HARDWARE (HW-9): measured on one recording only
    thresholdRange: [100, 700, 25],
    releaseRatio: 0.65, // leave CUTTING below releaseRatio * T
    minDurationMs: 25, // relative model: a second sample at or above T at least this long after the first is needed to enter
    candidateMaxMs: 100, // a dip that stays above the release level keeps the candidate for this long
    swingGraceMs: 100,
    // The px tracker (aim path: mouse, debug swings; and the absolute model: simulator) works in px/s: T_px = T x aimPxPerDps.
    aimPxPerDps: 10 / 3, // 300 deg/s = 1000 px/s, the shipped mouse threshold
    speedWindowMs: 50,
    mergeSegmentPx: 6,
    mergeFlushMs: 8,
    safetyCapDegPerS: 2190, // just above a 2000 dps gyro full scale. UNVERIFIED-ON-HARDWARE (HW-10): measured maximum 1049 deg/s
    safetyCapMousePxPerS: 60000,
  },

  /** Mount calibration wizard (design 12.5, architecture 6.4). */
  calibration: {
    stillMeanDegPerS: 6,
    stillPeakDegPerS: 15,
    stillAccelTolerance: 0.05, // a hold's |a| must stay within this fraction of the hold's own running mean (it used to be | |a| - 1 |)
    // (+) round 2 finding M2: the resting |a| of a real sensor is not exactly 1 g (gain and offset without the factory calibration
    // record are UNVERIFIED-ON-HARDWARE, UOH-3). A hold is accepted when |a| lies in this band and is steady; step 1 learns the
    // mean as g0 and the pipeline divides every accelerometer reading by it. Outside the warn band the wizard says so.
    accelG0Range: [0.85, 1.15],
    accelG0WarnRange: [0.95, 1.05],
    holdS: { pose1: 2.0, pose2: 1.5, autoCentreS: 3.0, quickCentre: 1.5 },
    poseAngleDeg: [65, 115],
    practiceTimeoutS: 20, // read by the game, not by Motion
    waitTimeoutS: 60,
    scaleAcceptCos: 0.9,
    scaleMinAngleDeg: 45,
    scaleSnapTolerance: 0.12,
    scaleCandidates: [1, 0.12288],
    signAcceptCos: 0.5,
    progressHz: 10,
    // (+) additions
    stillTiltDeg: 4, // max angle between the accel direction and the hold's mean direction. UNVERIFIED-ON-HARDWARE (HW-7)
    maxStillBiasDps: 30, // step 1 ceiling on |mean gyro| (bias included); also covers the 8.14x alternative gyro scale
    poseGateDeg: 15, // step 2: a hold only counts once the sword tilted this far away from pose 1
    minHoldSamples: 8,
    minFailHoldS: 0.4, // a broken hold announces stepFailed only if it had lasted this long
    failRepeatMs: 1000, // stepFailed('moved'|'bad_accel') at most this often
    noDataMs: 1000, // no IMU sample for this long during a step -> stepFailed('no_data')
    holdGapMs: 250, // a gap this long inside a hold restarts it
    // (+) round 2 finding M1: a sample with an unknown time step is only charged as a hole when the wall-clock distance to the
    // previous sample exceeds this; a duplicate report or a burst partner loses no rotation and is integrated over its real distance
    transitionGapMinMs: 40,
    transitionGapBudgetMs: 300, // more than this much unintegrated time in the move: the sign and scale cannot be trusted
    signTieBreakErrDeg: 20, // gravity-consistency tie-break (only when the axis test is ambiguous)
    signTieBreakMarginDeg: 15,
  },

  /** Orientation filter (architecture 6.5). */
  fusion: {
    tauS: 1.5,
    trustBandG: 0.15,
    maxTrustDps: 300,
    cutQuietMs: 200,
    // (+) soft trust: full weight for | |a| - 1 | <= flatBandG, tapering to 0 at trustBandG, and divided by
    // 1 + (omega / softTrustDps)^2 so that centripetal acceleration of a moving sword contaminates the tilt less.
    flatBandG: 0.05,
    softTrustDps: 60,
    // (+) start-up boost: tau runs from bootTauS to tauS over the first bootS seconds after the filter (re)starts
    bootS: 1.0,
    bootTauS: 0.2,
    // (+) round F1: the tilt counts as confirmed (the vertical axis of the pointer may use gravity) from the first correction with a
    // trust weight of at least gravityConfirmTrust whose residual tilt error is at most gravityConfirmTiltDeg; false after every
    // (re)initialisation. A start or a reconnection in the middle of a hard swing initialises the filter from a contaminated reading.
    gravityConfirmTrust: 0.4,
    gravityConfirmTiltDeg: 8,
    unconfirmedTauS: 0.3, // while unconfirmed (and after the start-up boost) the gravity correction uses this time constant instead of tauS
  },

  /** Online gyro bias estimation while the sword rests (architecture 6.5). */
  gyroBias: {
    restBandG: 0.03,
    restSpreadDps: 2.4,
    windowS: 1.0,
    blend: 0.25,
    // (+) additions
    maxCorrectionDps: 5, // ignore a window whose mean differs from the current bias by more than this (true dps)
    tiltStableDeg: 2, // the accel direction must stay within this cone during the window
    minSamples: 8,
  },

  // (+) sized for the interpolated ring samples (8 ms) and the sub-segments of the relative model: 384 x 8 ms = 3 s of trail
  tracker: { historySize: 384, segmentQueueMax: 1024 },

  trackingLostMs: 200,
  maxGapMs: 200,
  // (+) A hole in the stream longer than this (or a link loss reported by markDiscontinuity('lost')) restarts the orientation
  // filter from gravity and re-references the cursor on the first sample after it. Nothing is integrated across a hole, so the
  // sword may have been tilted meanwhile; without the restart the tilt would only creep to the truth with the 1.5 s time
  // constant of the gravity correction and the cursor would slide for seconds (round 1 finding M1).
  orientationResetGapMs: 1000,
  extrapolateMaxMs: 15, // absolute model and aim path; the relative model uses pointer.extrapolateMaxMs

  // (+) miscellaneous
  aimIdleMs: 60, // aim path: no sample for this long -> one synthetic "at rest" sample so CUTTING can end
  sliceOverMs: 100, // integrate gaps longer than this in slices ...
  sliceMs: 20, // ... of at most this length (raises sample_gap)
  warningIntervalMs: 1000, // at most one warning per code per interval
  lowSampleRateHz: 20,
  lowSampleRateS: 2,
  saturation: { accelG: 7.95, gyroDps: 1990 }, // int16 full scale is 8 g and about 2000 dps at the default scale
});

/**
 * Deep merge of plain objects; arrays and scalars in `patch` replace the base value. Returns a new deep-frozen object.
 * Used by createMotionPipeline({config}) so tests can tweak single constants.
 * @template T
 * @param {T} base
 * @param {Record<string, any>} [patch]
 * @returns {T}
 */
export function mergeConfig(base, patch) {
  if (!patch) return base;
  const out = {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const p = patch[key];
    if (p === undefined) out[key] = b;
    else if (b && typeof b === 'object' && !Array.isArray(b) && p && typeof p === 'object' && !Array.isArray(p)) out[key] = mergeConfig(b, p);
    else out[key] = p;
  }
  for (const key of Object.keys(patch)) if (!(key in out)) out[key] = patch[key];
  return deepFreeze(out);
}
