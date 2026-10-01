// Joy-Con Ninja: shared contracts. OWNER: architect (frozen). Changes only through docs/contract-notes.md and the Integrator.
//
// This file has two parts:
//   1. Runtime enums (frozen objects). Import these instead of typing string literals.
//   2. The canonical JSDoc typedefs between the <typedefs> markers. docs/architecture.md section 11 embeds the same block
//      verbatim (generated). If the two ever differ, THIS FILE wins.
//
// Conventions used by every typedef below:
//   - Time: milliseconds (ms) on the Clock timebase (performance.now() in the browser, a manual counter in tests), unless a
//     field name ends in S (seconds) or says "game seconds".
//   - Playfield coordinates: logical 1920 x 1080 px, origin top-left, y grows DOWN.
//   - Angles: degrees unless the name ends in Rad. Angular rates: deg/s. Accelerometer: g. Lengths on screen: px.
//   - "Device frame" = raw Joy-Con sensor axes X, Y, Z in report order, no swizzling, no sign changes.
//   - Every payload that crosses a module boundary is plain data (JSON-serialisable) unless it is a function-bearing
//     interface (InputProvider, MotionPipeline, Game, ...).

export const PROVIDER_KIND = Object.freeze({ JOYCON: 'joycon', SIM: 'sim', MOUSE: 'mouse' });
export const SIDE = Object.freeze({ LEFT: 'L', RIGHT: 'R', UNKNOWN: '?' });

/** Connection state machine of an input provider (section 5.3 of docs/architecture.md). */
export const CONN_STATE = Object.freeze({
  IDLE: 'idle',
  REQUESTING: 'requesting',
  CONNECTING: 'connecting',
  INITIALIZING: 'initializing',
  STREAMING: 'streaming',
  LOST: 'lost',
  ERROR: 'error',
});

/** Machine-readable error codes. The UI maps each to a string (docs/architecture.md section 5.4). */
export const INPUT_ERROR = Object.freeze({
  UNSUPPORTED_BROWSER: 'unsupported_browser',
  PERMISSION_DENIED: 'permission_denied',
  CANCELLED: 'cancelled',
  NOT_JOYCON: 'not_joycon',
  COOLDOWN: 'cooldown',
  GATT_FAILURE: 'gatt_failure',
  NO_DATA: 'no_data',
  LOST_SIGNAL: 'lost_signal',
});

/** `SECTION` (restyle round): hop between the two columns of the settings and sword tuning screens (R / L of a Joy-Con, PageUp / PageDown); it does nothing elsewhere. */
export const ACTION = Object.freeze({ CONFIRM: 'confirm', BACK: 'back', PAUSE: 'pause', RECENTER: 'recenter', SECTION: 'section' });
export const ACTION_SOURCE = Object.freeze({ JOYCON: 'joycon', KEYBOARD: 'keyboard', MOUSE: 'mouse', SIM: 'sim', DEBUG: 'debug' });
/** Menu navigation (analog stick of a Joy-Con, arrow keys): a direction pushed (`down`) and released (`up`). One flick = one `down`. */
export const NAV_DIR = Object.freeze({ UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' });
export const NAV_PHASE = Object.freeze({ DOWN: 'down', UP: 'up' });

export const GAME_MODE = Object.freeze({ CLASSIC: 'classic', ARCADE: 'arcade', ZEN: 'zen' });
/** 'practice' is the calibration step 4 round (one apple every 3 s). It is not a menu mode. */
export const ROUND_MODE = Object.freeze({ ...GAME_MODE, PRACTICE: 'practice' });
export const GAME_PHASE = Object.freeze({ RUNNING: 'running', ENDING: 'ending', OVER: 'over' });
export const OBJECT_KIND = Object.freeze({ FRUIT: 'fruit', BOMB: 'bomb', POWERUP: 'powerup', GOLDEN: 'golden' });
export const POWERUP_ID = Object.freeze({ FREEZE: 'freeze', FRENZY: 'frenzy', DOUBLE: 'double', CLOCK: 'clock' });

export const GAME_EVENT = Object.freeze({
  SPAWN: 'spawn',
  ENTER: 'enter',
  TELEGRAPH: 'telegraph',
  CUT: 'cut',
  COMBO: 'combo',
  BOMB: 'bomb',
  NEAR_MISS: 'nearMiss',
  POWERUP: 'powerup',
  MISS: 'miss',
  LIFE_LOST: 'lifeLost',
  LIFE_GAINED: 'lifeGained',
  TIME_BONUS: 'timeBonus',
  SLOWMO: 'slowmo',
  TICK: 'tick',
  STAGE: 'stage',
  WAVE: 'wave',
  PHASE: 'phase',
  GAME_OVER: 'gameOver',
  TIME_UP: 'timeUp',
  PRACTICE: 'practice',
});

export const SCREEN = Object.freeze({
  BOOT: 'boot',
  SAFETY: 'safety',
  CONNECT: 'connect',
  CALIBRATION: 'calibration',
  MENU: 'menu',
  SETTINGS: 'settings',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  PAUSED: 'paused',
  RESULTS: 'results',
});

export const CAL_STEP_FAIL = Object.freeze({
  MOVED: 'moved',
  BAD_POSE: 'bad_pose',
  BAD_ACCEL: 'bad_accel',
  TIMEOUT: 'timeout',
  NO_DATA: 'no_data',
  NO_CALIBRATION: 'no_calibration',
});

export const MOTION_WARNING = Object.freeze({
  GYRO_SCALE_SUSPECT: 'gyro_scale_suspect',
  GYRO_SIGN_FLIPPED: 'gyro_sign_flipped',
  DT_FALLBACK: 'dt_fallback',
  SAMPLE_GAP: 'sample_gap',
  ACCEL_SATURATED: 'accel_saturated',
  GYRO_SATURATED: 'gyro_saturated',
  LOW_SAMPLE_RATE: 'low_sample_rate',
  ACCEL_GAIN_OFF: 'accel_gain_off',
});

/** Joy-Con 2 button names exactly as produced by BUTTON_TABLE in the protocol parser (docs/joycon2-protocol.md 7.7). */
export const BUTTON_NAMES = Object.freeze([
  'Y', 'X', 'B', 'A', 'SR_R', 'SL_R', 'R', 'ZR',
  'MINUS', 'PLUS', 'R_STICK', 'L_STICK', 'HOME', 'CAPTURE', 'C',
  'DOWN', 'UP', 'RIGHT', 'LEFT', 'SR_L', 'SL_L', 'L', 'ZL',
  'GR', 'GL',
]);

export const CONTRACT_VERSION = 1;

// <typedefs>
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
// </typedefs>
