// Screen layouts as pure data: where every selectable target lives (docs/game-design.md 12, logical 1920 x 1080 px).
// OWNER: Presentation engineer (art layout at the end: UI-kit engineer). No canvas access; the UI state machine uses this for hit-testing
// and the screen drawing code reads the same rectangles, so what is drawn is exactly what is clickable. The art never moves a target:
// the constants under "art layout" only place pictures (logo, glyphs, icons) in free space.
//
// A Target is described by its CENTRE: {id, shape:'rect'|'circle', x, y, w, h | r, enabled, cut, dwell, row?, labelKey?}.
//   cut   = can be activated by cutting through it with the blade (only in menus, never in play, design 12.6)
//   dwell = can be activated by holding the cursor still on it for 900 ms (setting "Hold to select")
// Click / Enter activation is always available for enabled targets.

// The fruit sit 20 px higher than design 12.6 (540) so that the mode names no longer touch their lower edge (QA-06).
export const MENU_MODES = Object.freeze([
  Object.freeze({ id: 'classic', x: 480, y: 520, r: 175, fruit: 'watermelon', scale: 1.9, nameKey: 'menu.classic', descKey: 'menu.classic.desc' }),
  Object.freeze({ id: 'arcade', x: 960, y: 520, r: 170, fruit: 'orange', scale: 2.5, nameKey: 'menu.arcade', descKey: 'menu.arcade.desc' }),
  Object.freeze({ id: 'zen', x: 1440, y: 520, r: 172, fruit: 'pear', scale: 2.6, nameKey: 'menu.zen', descKey: 'menu.zen.desc' }),
]);

export const MENU_BUTTONS = Object.freeze([
  Object.freeze({ id: 'menu.settings', x: 560, y: 975, w: 400, h: 100, labelKey: 'menu.settings' }),
  Object.freeze({ id: 'menu.recalibrate', x: 960, y: 975, w: 400, h: 100, labelKey: 'menu.recalibrate' }),
  Object.freeze({ id: 'menu.connection', x: 1360, y: 975, w: 400, h: 100, labelKey: 'menu.connection' }),
]);

export const PAUSE_BUTTONS = Object.freeze([
  Object.freeze({ id: 'pause.resume', x: 960, y: 380, w: 620, h: 120, labelKey: 'pause.resume' }),
  Object.freeze({ id: 'pause.recalibrate', x: 960, y: 540, w: 620, h: 120, labelKey: 'pause.recalibrate' }),
  Object.freeze({ id: 'pause.settings', x: 960, y: 700, w: 620, h: 120, labelKey: 'pause.settings' }),
  Object.freeze({ id: 'pause.quit', x: 960, y: 860, w: 620, h: 120, labelKey: 'pause.quit' }),
]);

/** Settings rows: two columns of four (design 12.7). `y` is the label baseline; the control is centred 64 px below. */
export const SETTINGS_COL = Object.freeze({ left: { x0: 140, x1: 930 }, right: { x0: 990, x1: 1780 } });
export const SETTINGS_ROWS = Object.freeze([
  Object.freeze({ key: 'sensitivity', type: 'stepper', col: 'left', y: 250, labelKey: 'settings.sens', hintKey: 'settings.sens.hint' }),
  Object.freeze({ key: 'cutThreshold', type: 'stepper', col: 'left', y: 400, labelKey: 'settings.cut', hintKey: 'settings.cut.hint' }),
  Object.freeze({ key: 'volume', type: 'stepper', col: 'left', y: 550, labelKey: 'settings.volume', hintKey: null }),
  Object.freeze({ key: 'reduceFlash', type: 'toggle', col: 'left', y: 700, labelKey: 'settings.flash', hintKey: 'settings.flash.hint' }),
  Object.freeze({ key: 'reduceMotion', type: 'toggle', col: 'right', y: 250, labelKey: 'settings.motion', hintKey: 'settings.motion.hint' }),
  Object.freeze({ key: 'hand', type: 'segment', col: 'right', y: 400, labelKey: 'settings.hand', hintKey: 'settings.hand.hint' }),
  Object.freeze({ key: 'autoCenter', type: 'toggle', col: 'right', y: 550, labelKey: 'settings.autocenter', hintKey: 'settings.autocenter.hint' }),
  Object.freeze({ key: 'dwellSelect', type: 'toggle', col: 'right', y: 700, labelKey: 'settings.dwell', hintKey: 'settings.dwell.hint' }),
  // The ninth row ("Sword selection in menus") has no room for the label-above layout of the other eight (the screen is full from y 223 to 1030):
  // it sits in the free band between the last row and the bottom buttons, label LEFT of the two cells, and every other target stays where it was.
  Object.freeze({ key: 'swordSelect', type: 'toggle', col: 'left', y: 806, inline: true, cy: 870, labelKey: 'settings.sword', hintKey: 'settings.sword.hint' }),
]);

/** The live meter of the settings screen (right half of the bottom band) and the line that explains the focused row (under the title). */
export const SETTINGS_METER = Object.freeze({ x0: 990, x1: 1780, y: 872, h: 34, max: 900, labelY: 858 });
export const SETTINGS_HINT = Object.freeze({ x: 960, y: 192, w: 1500 });

/** The hint line of the menus ("Stick: move   A: select   B: back"): centred at the bottom edge on every screen, beside the "Got it" button on the safety page. */
export const NAV_HINT = Object.freeze({ x: 960, y: 1064, safety: Object.freeze({ x: 1450, y: 984 }) });
/** Focus ring: how far it stands off the unit's rectangle (circles: off the radius), the two stroke widths (ink outside, gold inside). */
export const FOCUS_RING = Object.freeze({ pad: 12, circlePad: 30, radius: 18, inkW: 14, goldW: 7, pulseHz: 1.1, pulseScale: 0.04, pulseAlpha: 0.7 });

/** Geometry of the controls of one settings row. */
export function settingsRowGeometry(row) {
  const col = SETTINGS_COL[row.col];
  if (row.inline) {
    // label left (baseline 12 px under the centre line, x 140, 30 px type: 500 px of room), the two cells (130 x 84) right of it, flush with the column end (x 930)
    const cy = row.cy;
    return {
      labelX: col.x0, labelY: cy + 12, cy,
      minus: { x: col.x0 + 42, y: cy, w: 84, h: 84 },
      plus: { x: col.x1 - 42, y: cy, w: 84, h: 84 },
      valueX: (col.x0 + col.x1) / 2,
      cellA: { x: 725, y: cy, w: 130, h: 84 },
      cellB: { x: 865, y: cy, w: 130, h: 84 },
      segA: { x: 725, y: cy, w: 130, h: 84 },
      segB: { x: 865, y: cy, w: 130, h: 84 },
      labelSize: 30,
    };
  }
  const cy = row.y + 64;
  return {
    labelX: col.x0,
    labelY: row.y,
    cy,
    minus: { x: col.x0 + 42, y: cy, w: 84, h: 84 },
    plus: { x: col.x1 - 42, y: cy, w: 84, h: 84 },
    valueX: (col.x0 + col.x1) / 2,
    cellA: { x: col.x0 + 110, y: cy, w: 210, h: 84 },
    cellB: { x: col.x0 + 330, y: cy, w: 210, h: 84 },
    segA: { x: col.x0 + 125, y: cy, w: 240, h: 84 },
    segB: { x: col.x0 + 375, y: cy, w: 240, h: 84 },
  };
}

// the buttons sit INSIDE the panel (QA-06: at y 900 they straddled its bottom border)
// ---- sword tuning screen ("Sword tuning"). Two columns that each hold ONE group, top to bottom:
//   left  = the POINTER: the "Sensitivity" stepper, the "Pointer speed" presets (Relaxed / Standard / Fast), the reach test text and the
//           crosshair-speed line (`tune.gain`);
//   right = the CUT: the "Slice threshold" stepper, the "Threshold preset" cells (Easy / Normal / Hard), the live blade-speed meter in
//           deg/s with the threshold marker, the last swing and its verdict.
// Below them the practice fruit (their caption now sits in the left margin, TUNING_FRUIT_LABEL) and the two buttons. Every cell and button
// is 84 px high or more. The threshold and pointer numbers follow docs/motion-contract.md 3.2 and 3.5; all of them are starting values,
// UNVERIFIED-ON-HARDWARE (HW-3, HW-9).
export const TUNING_ROWS = Object.freeze([
  Object.freeze({ key: 'sensitivity', type: 'stepper', col: 'left', y: 245, labelKey: 'settings.sens' }),
  Object.freeze({ key: 'cutThreshold', type: 'stepper', col: 'right', y: 245, labelKey: 'settings.cut' }),
]);
/** Centre line of both preset rows (cells 250 x 84), and the baseline of their small captions (`tune.pointer`, `tune.preset`). */
export const TUNING_PRESET_Y = 440;
export const TUNING_PRESET_CAPTION_Y = 384;
/** Cut-threshold presets, deg/s (tip speed): right column. A preset is highlighted when the setting equals its value. */
export const TUNING_PRESETS = Object.freeze([
  Object.freeze({ id: 'tune.preset.easy', value: 225, x: 1115, labelKey: 'settings.cut.easy' }),
  Object.freeze({ id: 'tune.preset.normal', value: 300, x: 1385, labelKey: 'settings.cut.normal' }),
  Object.freeze({ id: 'tune.preset.hard', value: 450, x: 1655, labelKey: 'settings.cut.hard' }),
]);
/** Pointer-speed presets = values of `sensitivity` (the multiplier of the pointer curve): left column. */
export const TUNING_POINTER_PRESETS = Object.freeze([
  Object.freeze({ id: 'tune.pointer.relaxed', value: 0.6, x: 265, labelKey: 'tune.pointer.relaxed' }),
  Object.freeze({ id: 'tune.pointer.standard', value: 1.0, x: 535, labelKey: 'tune.pointer.standard' }),
  Object.freeze({ id: 'tune.pointer.fast', value: 1.5, x: 805, labelKey: 'tune.pointer.fast' }),
]);
/** The live meter: a bar 0 to `max` deg/s (a hard slash peaks near 1000, the slowest of the recording 632; the bar is full from 900 on). */
export const TUNING_METER = Object.freeze({ x0: 990, x1: 1780, y: 552, h: 40, max: 900 });
/**
 * The text blocks under the two groups (baselines). Left column (x 140, 790 wide): the reach line, its hint two lines below, then the
 * crosshair-speed line (`tune.gain`, two lines). Right column: "Last swing" and the verdict sit `lastDy` and `verdictDy` below the bottom
 * edge of the meter bar. Both columns stay clear of the practice fruit (their tops are at y 723).
 */
export const TUNING_TEXT = Object.freeze({
  reachY: 530,
  hintDy: 40,
  gainY: 650,
  leftX: 140,
  leftW: 790,
  lineH: 34,
  lastDy: 56,
  verdictDy: 100,
});
export const TUNING_CORNERS = Object.freeze([
  Object.freeze({ x: 90, y: 90 }), Object.freeze({ x: 1830, y: 90 }), Object.freeze({ x: 90, y: 990 }), Object.freeze({ x: 1830, y: 990 }),
]);
export const TUNING_CORNER = Object.freeze({ drawR: 46, reachR: 70 });
export const TUNING_FRUIT = Object.freeze([
  Object.freeze({ id: 'tune.fruit0', x: 560, y: 815, r: 92, fruit: 'apple', scale: 1.2 }),
  Object.freeze({ id: 'tune.fruit1', x: 960, y: 815, r: 92, fruit: 'kiwi', scale: 1.4 }),
  Object.freeze({ id: 'tune.fruit2', x: 1360, y: 815, r: 92, fruit: 'lemon', scale: 1.4 }),
]);
/** Caption of the practice fruit: wrapped, centred on x, in the free left margin beside the apple (the band above the fruit is full). */
export const TUNING_FRUIT_LABEL = Object.freeze({ x: 300, y: 800, w: 300, lineH: 34 });
export const TUNING_DEFAULTS = Object.freeze({ sensitivity: 1, cutThreshold: 300 });

export const RESULTS_PANEL = Object.freeze({ x: 960, y: 520, w: 1240, h: 880 });

// ---------------------------------------------------------------------------------------------------------------- restyle motion (docs/restyle-direction.md 3)
/**
 * The ink-brush wipe between two menu screens (render/transitions.js draws it, ui.js starts it): a paper-coloured brush edge covers the old screen
 * left to right (right to left when going back) in `coverMs`, the screen is already the new one at the midpoint (`holdMs` of plain paper), then a second
 * edge reveals it in `revealMs`. 400 ms in all (the brief says 350 to 450); with Reduce motion it is a `fadeMs` cross-fade of the old frame.
 * Input is never blocked by it (the 220 ms confirm lock and the 500 ms cut lock of the screen change are the only locks, and they are older).
 */
export const WIPE = Object.freeze({ coverMs: 185, holdMs: 20, revealMs: 195, totalMs: 400, fadeMs: 120, entranceLeadMs: 150 });

/** Screens between which the wipe never runs: the loading screen (the first menu has its own entrance), and the round itself (its transitions are the countdown, the pause panel and the results slide). */
const NO_WIPE = Object.freeze(new Set(['boot', 'playing', 'countdown']));
/** Edges that go BACK (the wipe runs right to left): leaving a sub-screen for the one it was opened from. */
const BACK_EDGES = Object.freeze(new Set(['settings>menu', 'settings>paused', 'tuning>settings']));

/** Does a change of screen from `from` to `to` get the ink wipe? */
export const wipeBetween = (from, to) => from !== to && !NO_WIPE.has(from) && !NO_WIPE.has(to);
/** Does the change go back (the wipe sweeps right to left)? `explicit` is the caller's word for it (a "Back" button), else the table of edges decides. */
export const wipeGoesBack = (from, to, explicit) => (explicit === undefined ? BACK_EDGES.has(`${from}>${to}`) : !!explicit);

/**
 * The menu entrance (section 3, "Menu entrance"): times in ms from the start of the entrance (`view.enterAt`).
 * The logo drops from `dropFrom` px above its place and settles with a squash; a splash (ring, droplets, a small shake) marks the landing; the
 * tagline fades in `taglineAtMs` after the landing starts; the three mode fruit rise one after the other.
 */
export const MENU_MOTION = Object.freeze({
  dropMs: 560, dropFrom: 300, squashMs: 90, squashX: 1.08, squashY: 0.88, settleMs: 260,
  splashMs: 350, splashRing: 260, splashDroplets: 16, shakePx: 6, shakeMs: 120,
  taglineAtMs: 300, taglineMs: 250,
  fruitRiseMs: 400, fruitStaggerMs: 90, fruitFromPx: 150, fruitAtMs: 380,
  bobPx: 8, bobHz: 0.35, turnDeg: 3, phases: Object.freeze([0, 0.33, 0.66]),
  fadeMs: 200,
});

/** The countdown numerals (section 3): scale from, entrance ms, the shockwave ring, the exit, and the GO! values. */
export const COUNT_MOTION = Object.freeze({
  digitFrom: 1.6, digitInMs: 190, digitOutMs: 150, ringMs: 420, ringR: 320, ringW0: 24, ringW1: 2,
  goFrom: 2.4, goInMs: 150, goRingR: 520, goStars: 20, goStarMs: 600,
  digitPx: 360, goPx: 300,
});

/** The pops and rolls of the HUD (section 3): score pop and roll, colour ease, combo pip, timer urgency. */
export const HUD_MOTION = Object.freeze({
  popUpMs: 70, popDownMs: 160, popScale: 1.22, popBigScale: 1.35, bigDelta: 50, rollMs: 250, goldMs: 120,
  pipPopMs: 100, urgentS: 10, lastS: 3, lastPulse: 1.18,
});

/** The results timeline (section 3), see `resultsTimeline`. */
export const RESULTS_MOTION = Object.freeze({
  stampDelayMs: 150, recordDelayMs: 200, tickMs: 50, stampInMs: 140, stampBounceMs: 120, stampScale: 3, ringMs: 300, ringR: 220, shakePx: 10, shakeMs: 200,
  staggerMs: 60, rowMs: 280, rowRisePx: 26, fadeMs: 200, flecks: 12, stars: 24,
});

/**
 * When things happen on the results screen, in ms from the start of the screen (the panel slides in during the first `slideMs`).
 * Normal: the score counts up for `countMs` once the panel is in, the seal lands `stampDelayMs` later, "NEW RECORD!" `recordDelayMs` after the seal.
 * Soft (Reduce motion, and Zen which ends softly): no count-up (the score is just there), the seal and the ribbon fade in instead of slamming.
 * @returns {{countStart:number, countEnd:number, stampAt:number, recordAt:number, soft:boolean}}
 */
export function resultsTimeline(soft, reduced, slideMs, countMs) {
  const R = RESULTS_MOTION;
  const countStart = reduced ? 0 : slideMs;
  const countEnd = reduced ? 0 : slideMs + countMs;
  const stampAt = (reduced ? slideMs : countEnd) + R.stampDelayMs;
  return { countStart, countEnd, stampAt, recordAt: stampAt + R.recordDelayMs, soft: !!soft };
}
// 640 high (design: 560): the three buttons of the failed phase used to touch each other and the panel edge (QA-06)
export const DISCONNECT_PANEL = Object.freeze({ x: 960, y: 540, w: 900, h: 640 });

/**
 * The right column of the connect screen when the native Bluetooth bridge is offered (connect-model.js `native`). One place for the
 * numbers: the targets below and screens/connect.js both read them. The status pill starts at `pillTop` and grows downwards (at most
 * five lines); the second path sits below it at `secondaryY`, or above the extended-search button after a closed chooser.
 */
export const CONNECT_NATIVE = Object.freeze({
  main: Object.freeze({ x: 1440, y: 365, w: 720, h: 120 }),
  pillTop: 440,
  pillWidth: 780,
  barY: 606,
  secondaryY: 700,
  secondaryYWithFallback: 625,
  fallbackY: 715,
  secondaryW: 800,
  secondaryH: 72,
  cancel: Object.freeze({ x: 1440, y: 700, w: 400, h: 72 }),
});
export const CONFIRM_PANEL = Object.freeze({ x: 960, y: 540, w: 900, h: 420 });

// ---------------------------------------------------------------------------------------------------------------- art layout
// Where the generated pictures go (docs/assets-integration.md 5.7, 5.1, 9.1). Used only when the picture exists; with no art the screens draw
// what they always drew. Every rectangle here is checked against the targets and the text boxes by test/ui/art-layout.test.js.

/** The logo on the menu (logo_title, aspect 1.96): centred on x, top edge at `top`, `h` high, `w` wide (the box the picture is contained in). */
export const MENU_LOGO = Object.freeze({ cx: 960, top: 10, h: 226, w: 443 });
/** Baseline of the menu tagline: below the title text as always, 22 px lower under the logo picture (its bottom edge is at 236). */
export const MENU_TAGLINE_Y = Object.freeze({ text: 250, logo: 272 });

/** Boot screen with the logo: the logo contained in a 720 x 400 box, "Loading…" on a baseline at 700, a progress bar 480 x 14 centred on y 740. */
export const BOOT_ART = Object.freeze({
  logo: Object.freeze({ cx: 960, cy: 420, w: 720, h: 400 }),
  loadingY: 700,
  bar: Object.freeze({ cx: 960, cy: 740, w: 480, h: 14 }),
});

/** Default asset ids of the glyph roles (art-config.js `glyphs.ids` is the swap table and wins). */
export const GLYPH_DEFAULT_IDS = Object.freeze({
  joyconL: 'glyph_joycon_l', joyconR: 'glyph_joycon_r', mouse: 'glyph_mouse', keyboardEnter: 'glyph_keyboard_enter', sync: 'glyph_sync_button',
});

/**
 * Asset id of a glyph role through the swap table of the assets config (`assets.config.glyphs`, assets-integration 9.1), or null. The single
 * switch `glyphs.enabled === false` hides the two controller pictures (joyconL, joyconR) and nothing else.
 * @param {{glyphs?:{enabled?:boolean, ids?:Record<string,string>}}|null|undefined} config
 * @param {'joyconL'|'joyconR'|'mouse'|'keyboardEnter'|'sync'} role
 */
export function glyphId(config, role) {
  const cfg = config && config.glyphs;
  if ((role === 'joyconL' || role === 'joyconR') && cfg && cfg.enabled === false) return null;
  return (cfg && cfg.ids && cfg.ids[role]) || GLYPH_DEFAULT_IDS[role] || null;
}

/**
 * Glyphs of the connect screen (both layouts) and of the disconnect overlay. Sizes are the HEIGHT of the picture (its content box is contained
 * in an h x h box; the glyphs are tall and narrow). `pair`: the left and right Joy-Con above the main button, in the free band between the
 * subtitle and the button. `mouse` and `keyboard`: inside the left end of the plate of "Mouse only" and "Simulator" (the label shifts right
 * by the glyph width plus 12 px, see widgets.js). `sync`: left of the pairing steps title (its baseline `titleY` and font size `titleSize`
 * are those of connect.js). `disconnect`: left of the disconnect title (contract: above it; see docs/contract-notes.md, the title sits at the
 * top of a panel whose top edge is at y 220, so there is no room above it).
 */
export const CONNECT_GLYPHS = Object.freeze({
  pair: Object.freeze({ h: 96, y: 250, xs: Object.freeze([1400, 1480]) }),
  mouse: Object.freeze({ h: 64 }),
  keyboard: Object.freeze({ h: 64 }),
  sync: Object.freeze({ h: 56, gap: 16, x: 560, titleY: 330, titleSize: 60 }),
  disconnect: Object.freeze({ h: 72, gap: 18, margin: 16, titleY: 322, titleSize: 64 }),
});

/**
 * Icons of the results screen. `trophy` (icon_trophy, `h` x `h` box): inside the left end of the "new record" plate, the text shifts right by the
 * icon width plus `gap` (the contract puts it left of the plate, where the rank seal leaves 37 px). `combo` (icon_combo): left of the "Best
 * combo" figure of the stats grid. `plate`: the rotated plate of the record ribbon (centre, size, tilt in degrees).
 */
export const RESULTS_ART = Object.freeze({
  trophy: Object.freeze({ h: 72, gap: 14, pad: 12 }),
  combo: Object.freeze({ h: 48, dx: -58, dy: -12 }),
  plate: Object.freeze({ x: 890, y: 545, w: 420, h: 86, tiltDeg: -3 }),
});

const rect = (id, x, y, w, h, extra) => ({ id, shape: 'rect', x, y, w, h, enabled: true, cut: false, dwell: false, ...extra });
const circle = (id, x, y, r, extra) => ({ id, shape: 'circle', x, y, r, enabled: true, cut: false, dwell: false, ...extra });

/** Targets of the overlay dialogs (they replace every screen target while open). */
export function overlayTargets(view) {
  if (view.overlay === 'confirm') {
    return [
      rect('confirm.yes', 760, 650, 380, 100, { cut: true, dwell: true }),
      rect('confirm.no', 1160, 650, 380, 100, { cut: true, dwell: true }),
    ];
  }
  if (view.overlay === 'disconnected') {
    // the native bridge scans for up to 45 s: the player can give up at any time, at no cost (a cancelled attempt starts no cooldown)
    if (view.disc.native && view.disc.phase === 'reconnecting') return [rect('disc.cancel', 960, 785, 620, 84, { cut: true, dwell: true })];
    if (view.disc.phase !== 'failed') return [];
    return [
      rect('disc.retry', 960, 585, 620, 84, { enabled: view.disc.retryEnabled, cut: true, dwell: true }),
      rect('disc.mouse', 960, 685, 620, 84, { cut: true, dwell: true }),
      rect('disc.menu', 960, 785, 620, 84, { cut: true, dwell: true }),
    ];
  }
  return [];
}

/** Targets of the connect screen with the native bridge offered: the main button, the other path or "Cancel", the extended search, the alternatives. */
function nativeConnectTargets(view, m) {
  const C = CONNECT_NATIVE;
  const out = [
    rect(m.showContinue ? 'connect.continue' : 'connect.main', C.main.x, C.main.y, C.main.w, C.main.h, { enabled: m.buttonEnabled }),
    rect('connect.sim', 1240, 890, 400, 100),
    rect('connect.mouse', 1640, 890, 400, 100),
    rect('connect.diagnostics', 300, 1030, 360, 56),
  ];
  // while the bridge works the second path gives way to "Cancel" (a click or Esc, never Enter: a second Enter must not undo the first)
  if (m.cancel) out.push(rect('connect.cancel', C.cancel.x, C.cancel.y, C.cancel.w, C.cancel.h));
  else if (m.secondary.show) out.push(rect('connect.secondary', 1440, m.showFallback ? C.secondaryYWithFallback : C.secondaryY, C.secondaryW, C.secondaryH, { enabled: m.secondary.enabled }));
  if (m.showFallback) out.push(rect('connect.fallback', 1440, C.fallbackY, C.secondaryW, C.secondaryH, { enabled: m.buttonEnabled }));
  if (view.connect.cameFromMenu) out.push(rect('connect.back', 210, 70, 260, 72));
  return out;
}

/**
 * All selectable targets of the current screen. `view` is the UI view model (see ui.js).
 * @returns {Array<object>}
 */
export function screenTargets(view) {
  if (view.overlay) return overlayTargets(view);
  switch (view.screen) {
    case 'safety':
      return [
        rect('safety.toggle', 960, 852, 520, 72),
        rect('safety.ok', 960, 976, 520, 120, { enabled: view.safety.ready }),
      ];
    case 'connect': {
      const m = view.connect;
      if (m.native) return nativeConnectTargets(view, m);
      const out = [
        rect(m.showContinue ? 'connect.continue' : 'connect.main', 1440, 400, 520, 130, { enabled: m.buttonEnabled }),
        rect('connect.sim', 1240, 890, 400, 100),
        rect('connect.mouse', 1640, 890, 400, 100),
        rect('connect.diagnostics', 300, 1030, 360, 56),
      ];
      // after a closed chooser: "Can't see it? Extended search" (a click target like the main button, never cut or dwell)
      if (m.showFallback) out.push(rect('connect.fallback', 1440, 612, 640, 84, { enabled: m.buttonEnabled }));
      if (view.connect.cameFromMenu) out.push(rect('connect.back', 210, 70, 260, 72));
      return out;
    }
    case 'calibration': {
      const step = view.cal.step;
      const out = [];
      if (step === 3 || step === 4) out.push(rect('cal.flip', 1560, 1035, 560, 70));
      if (step === 4 && view.cal.tryAgain) out.push(rect('cal.retry', 960, 900, 400, 100, { cut: false, dwell: true }));
      if (step === 1 && view.calibrated && !view.cal.quick) out.push(rect('cal.quick', 420, 1035, 500, 70));
      return out;
    }
    case 'menu': {
      const out = MENU_MODES.map((m) => circle(`menu.${m.id}`, m.x, m.y, m.r, { cut: true, dwell: true, mode: m.id }));
      for (const b of MENU_BUTTONS) out.push(rect(b.id, b.x, b.y, b.w, b.h, { cut: true, dwell: true }));
      return out;
    }
    case 'settings': {
      const out = [];
      for (const row of SETTINGS_ROWS) {
        const g = settingsRowGeometry(row);
        const flags = { cut: true, dwell: true, row: row.key, span: [SETTINGS_COL[row.col].x0, SETTINGS_COL[row.col].x1] }; // span: navigation bounds of the row (focus.js)
        if (row.type === 'stepper') {
          out.push(rect(`set.${row.key}.minus`, g.minus.x, g.minus.y, g.minus.w, g.minus.h, flags));
          out.push(rect(`set.${row.key}.plus`, g.plus.x, g.plus.y, g.plus.w, g.plus.h, flags));
        } else if (row.type === 'toggle') {
          out.push(rect(`set.${row.key}.on`, g.cellA.x, g.cellA.y, g.cellA.w, g.cellA.h, flags));
          out.push(rect(`set.${row.key}.off`, g.cellB.x, g.cellB.y, g.cellB.w, g.cellB.h, flags));
        } else {
          out.push(rect(`set.${row.key}.right`, g.segA.x, g.segA.y, g.segA.w, g.segA.h, flags));
          out.push(rect(`set.${row.key}.left`, g.segB.x, g.segB.y, g.segB.w, g.segB.h, flags));
        }
      }
      out.push(rect('set.reset', 470, 980, 400, 100, { cut: true, dwell: true }));
      out.push(rect('set.tune', 960, 980, 400, 100, { cut: true, dwell: true }));
      out.push(rect('set.back', 1450, 980, 400, 100, { cut: true, dwell: true }));
      return out;
    }
    case 'tuning': {
      // Nothing but the practice fruit can be CUT here: the player swings the sword all over the screen on this page, and a
      // stepper or a button that a swing can trigger would change the very values being tuned. Dwell, click and Enter still work.
      const out = [];
      for (const row of TUNING_ROWS) {
        const g = settingsRowGeometry(row);
        const flags = { cut: false, dwell: true, row: row.key, span: [SETTINGS_COL[row.col].x0, SETTINGS_COL[row.col].x1] };
        out.push(rect(`set.${row.key}.minus`, g.minus.x, g.minus.y, g.minus.w, g.minus.h, flags));
        out.push(rect(`set.${row.key}.plus`, g.plus.x, g.plus.y, g.plus.w, g.plus.h, flags));
      }
      for (const p of TUNING_POINTER_PRESETS) out.push(rect(p.id, p.x, TUNING_PRESET_Y, 250, 84, { cut: false, dwell: true }));
      for (const p of TUNING_PRESETS) out.push(rect(p.id, p.x, TUNING_PRESET_Y, 250, 84, { cut: false, dwell: true }));
      const tune = view.tune;
      TUNING_FRUIT.forEach((f, i) => out.push(circle(f.id, f.x, f.y, f.r, { cut: true, dwell: false, enabled: !tune || tune.fruit[i].ready })));
      out.push(rect('tune.defaults', 640, 975, 400, 100, { cut: false, dwell: true }));
      out.push(rect('tune.back', 1280, 975, 400, 100, { cut: false, dwell: true }));
      return out;
    }
    case 'paused':
      if (view.resuming) return [];
      return PAUSE_BUTTONS.map((b) => rect(b.id, b.x, b.y, b.w, b.h, { cut: true, dwell: true }));
    case 'results':
      return [
        rect('results.again', 760, 862, 380, 120, { enabled: !view.results.locked, cut: true, dwell: true }),
        rect('results.menu', 1160, 862, 380, 120, { enabled: !view.results.locked, cut: true, dwell: true }),
      ];
    default:
      return [];
  }
}
