// English UI strings. OWNER: Presentation engineer. This is the ONLY place where player-visible text of the game lives
// (plus the labels of diagnostics.html and diagnostics-page.js, which belong to the Input engineer, and the <noscript> line
// of index.html). The whole game is English (owner decision, 2026-09-30; the first version of the game used Italian text).
//
// Section "BASE" is generated from the tables of docs/game-design.md section 13 and is verified against that document by
// test/ui/strings.test.js (every key, exactly that text). Section "ADDITIONS" holds the keys that the design table lacks:
// the eight required by docs/architecture.md section 8.8 and more that the Presentation needed (calibration failure reasons,
// the mute toggle, the sword tuning screen, the chooser fallback and the native Bluetooth bridge; all logged in
// docs/contract-notes.md under "String additions").
//
// Conventions: American spelling (center, meters), typographic double quotes (“ ”) around button and state names, "×" for
// multiplication, "−" (minus sign) for negative scores, a decimal point, straight apostrophes. macOS menu names use the exact
// English macOS wording (System Settings > Privacy & Security > Bluetooth). test/ui/strings.test.js also fails when an
// Italian word or an accented vowel leaks into a text.
//
// Name and toggles (art-integration workstream, docs/assets-integration.md section 7): the player-visible name of the game is
// "3D Fruit Dojo" ("menu.title" is upper case because it is the text fallback of the logo picture); the settings switches read
// "On" and "Off" ("settings.on", "settings.off"), while the confirm dialogs keep "Yes, quit" and "Yes, delete" (those are answers).
// The folder, the package name, window.__ninja, the URL flags and the joyconNinja.* storage keys keep the old code name on purpose.
//
// UNVERIFIED-ON-HARDWARE (HW-4, HW-5): connect.step1, connect.step2, connect.cooldown.warning and disc.cooldown describe
// generic BLE pairing behaviour and a cooldown rule. Their exact wording must be reconciled with the real Joy-Con 2 before
// release; edit the strings, not the layout.

const BASE = {
  // 13.1 Boot and safety
  "boot.loading": "Loading…",
  "boot.unsupported": "Your browser does not support this game. Use Google Chrome.",
  "safety.title": "Before you play",
  "safety.l1": "Make room: keep at least 2 meters (6 ft) clear around you in every direction.",
  "safety.l2": "Move people, pets and breakable objects out of the way. Do not play near stairs.",
  "safety.l3": "Attach the Joy-Con firmly to the sword and always use the wrist strap.",
  "safety.l4": "Never touch the screen with the sword.",
  "safety.l5": "Take a 5-minute break after every 15 minutes of play. If your wrist, arm or shoulder hurts, stop.",
  "safety.l6": "The game has flashing effects: if you are sensitive to flashes, turn on “Reduce flashes”.",
  "safety.reduceFlash": "Reduce flashes",
  "safety.wait": "Read carefully…",
  "safety.ok": "Got it, let's go",

  // 13.2 Connect
  "connect.title": "Connect your Joy-Con",
  "connect.subtitle": "Works with the left and right Joy-Con 2.",
  "connect.steps.title": "How to connect",
  "connect.step1": "1. If the Joy-Con is connected to the console or to another device, disconnect it.",
  "connect.step2": "2. Hold down the Joy-Con's sync button until the lights flash.",
  "connect.step3": "3. Press “Connect Joy-Con” and choose your Joy-Con in the list that opens in Chrome.",
  "connect.step4": "4. Wait for “Connected”, then calibrate the sword.",
  "connect.button": "Connect Joy-Con",
  "connect.searching": "Searching…",
  "connect.connecting": "Connecting…",
  "connect.connected": "Connected: Joy-Con ({side})",
  "connect.side.left": "left",
  "connect.side.right": "right",
  "connect.side.unknown": "side unknown",
  "connect.battery": "Battery: {pct}%",
  "connect.batteryUnknown": "Battery: not available",
  "connect.cooldown.warning": "Careful: after an attempt, wait about 10 seconds before trying again. Repeated attempts in quick succession can stop the Joy-Con from being found.",
  "connect.cooldown.wait": "Try again in {s} s",
  "connect.err.unsupported": "This browser does not support Web Bluetooth. Use Google Chrome on a Mac.",
  "connect.err.cancelled": "No Joy-Con chosen. Try again when you are ready.",
  "connect.err.failed": "Connection failed. Check that the Joy-Con is on and not connected elsewhere.",
  "connect.err.notJoycon": "The device you chose does not look like a Joy-Con 2.",
  "connect.alt.title": "Or play without a Joy-Con",
  "connect.alt.sim": "Simulator",
  "connect.alt.sim.desc": "The mouse moves a virtual sword with simulated sensors.",
  "connect.alt.mouse": "Mouse only",
  "connect.alt.mouse.desc": "The mouse slices directly.",
  "connect.diagnostics": "Joy-Con diagnostics",
  "connect.continue": "Continue",

  // 13.3 Calibration
  "cal.title": "Sword calibration",
  "cal.progress": "Step {n} of {total}",
  "cal.s1.title": "Hold it still",
  "cal.s1.text": "Hold the sword still, tip pointing up. You can also rest it down, with the tip still pointing up.",
  "cal.s2.title": "Point at the screen",
  "cal.s2.text": "Point the sword straight at the screen, as if thrusting, and hold it still.",
  "cal.s3.title": "Center the crosshair",
  "cal.s3.text": "Aim at the center of the screen and press {button}. Or hold the sword still for 3 seconds.",
  "cal.s4.title": "Try a slash",
  "cal.s4.text": "Slice the apple with one firm swing!",
  "cal.still": "Hold still…",
  "cal.moved": "You moved. Let's start over.",
  "cal.badPose": "The two poses are too similar. In step 1 point the sword at the ceiling, in step 2 at the screen.",
  "cal.ok": "Calibration complete!",
  "cal.retry": "Redo",
  "cal.tryAgain": "Can't hit the apple? Repeat the calibration.",
  "cal.quick": "Just recenter",
  "cal.quick.hint": "Same grip as before? Just recenter.",
  "cal.speed": "Blade speed: {n} °/s",

  // 13.4 Menu
  "menu.title": "3D FRUIT DOJO",
  "menu.tagline": "Slice the fruit. Avoid the bombs.",
  "menu.classic": "Classic",
  "menu.classic.desc": "3 lives. Don't let the fruit get away!",
  "menu.arcade": "Arcade",
  "menu.arcade.desc": "60 seconds. Bonuses and bombs.",
  "menu.zen": "Zen",
  "menu.zen.desc": "90 seconds. No bombs, no stress.",
  "menu.best": "Best: {n}",
  "menu.settings": "Settings",
  "menu.recalibrate": "Recalibrate",
  "menu.connection": "Connection",
  "menu.hint": "Slice a fruit to choose it, or hold the crosshair still on a button.",
  "menu.safety": "Keep 2 meters (6 ft) of clear space around you.",
  "menu.provider.joycon": "Joy-Con ({side})",
  "menu.provider.sim": "Simulator",
  "menu.provider.mouse": "Mouse",

  // 13.5 HUD, popups and banners
  "hud.score": "SCORE",
  "hud.best": "BEST",
  "hud.time": "TIME",
  "hud.lives": "LIVES",
  "hud.combo": "COMBO ×{n}!",
  "hud.comboLabel": "COMBO",
  "hud.missed": "Missed!",
  "hud.nearMiss": "So close!",
  "hud.bomb": "BOMB!",
  "hud.bombScore": "−50",
  "hud.bombTime": "−5 s",
  "hud.lifePlus": "+1 life",
  "hud.timePlus": "+{n} s",
  "hud.golden": "GOLDEN APPLE! +100",
  "hud.pu.freeze": "FREEZE!",
  "hud.pu.freeze.sub": "Time slows down",
  "hud.pu.frenzy": "FRENZY!",
  "hud.pu.frenzy.sub": "Fruit only, no bombs",
  "hud.pu.double": "DOUBLE!",
  "hud.pu.double.sub": "Points ×2",
  "hud.pu.clock": "CLOCK!",
  "hud.pu.clock.sub": "+4 seconds",
  "hud.count.go": "GO!",
  "hud.timeUp": "Time's up!",
  "hud.last10": "Last 10 seconds!",
  "hud.pauseHint": "Pause: {button}",
  "hud.recenterHint": "Recenter: {button}",
  "hud.recentered": "Crosshair recentered",
  "hud.lowBattery": "Joy-Con battery almost empty",
  "hud.softBreak": "You have been playing for 6 minutes. Want to take a break?",
  "hud.newBest": "NEW RECORD!",
  "tip.swing": "Swing the sword fast to slice!",
  "tip.bomb": "Watch out for bombs: don't slice them!",
  "tip.combo": "Slice several fruits in one swing to make a COMBO.",

  // 13.6 Pause, results, disconnect, settings
  "pause.title": "Paused",
  "pause.resume": "Resume",
  "pause.recalibrate": "Recalibrate",
  "pause.settings": "Settings",
  "pause.quit": "Quit to menu",
  "pause.tip": "Rest your arm: shake out your wrist and breathe.",
  "pause.autoBlur": "Game paused: this window is no longer in front.",
  "pause.resuming": "Resuming in {n}…",
  "pause.confirm.title": "Quit this game?",
  "pause.confirm.text": "Your current game will be lost.",
  "pause.confirm.yes": "Yes, quit",
  "pause.confirm.no": "No, keep playing",
  "results.title.gameover": "Game over",
  "results.title.timeup": "Time's up!",
  "results.score": "Score",
  "results.best": "Best",
  "results.newBest": "NEW RECORD!",
  "results.rank": "Rank",
  "rank.1": "Apprentice",
  "rank.2": "Warrior",
  "rank.3": "Ninja",
  "rank.4": "Master",
  "rank.5": "Legend",
  "results.fruit": "Fruit sliced",
  "results.combo": "Best combo",
  "results.accuracy": "Accuracy",
  "results.bombs": "Bombs hit",
  "results.powerups": "Power-ups",
  "results.duration": "Duration",
  "results.again": "Play again",
  "results.menu": "Menu",
  "results.rest": "Rest your arm before you start again.",
  "results.break": "You have played for {min} minutes. Take a 5-minute break: rest your arm and wrist.",
  "disc.title": "Joy-Con disconnected",
  "disc.text": "The game is paused. Trying to reconnect…",
  "disc.failed": "Can't reconnect. Check the battery and move closer to the Mac.",
  "disc.cooldown": "Wait about 10 seconds before trying again.",
  "disc.wait": "Try again in {s} s",
  "disc.retry": "Try again",
  "disc.useMouse": "Continue with the mouse",
  "disc.menu": "Back to menu",
  "disc.recovered": "Joy-Con reconnected! Hold the sword still to recenter.",
  "disc.recentering": "Recentering… don't move",
  "settings.title": "Settings",
  "settings.sens": "Sensitivity",
  "settings.sens.hint": "How far the crosshair moves when you rotate the sword.",
  "settings.cut": "Slice threshold",
  "settings.cut.hint": "Minimum speed needed to slice. Lower = easier.",
  "settings.cut.easy": "Easy",
  "settings.cut.normal": "Normal",
  "settings.cut.hard": "Hard",
  "settings.meter": "Blade speed: {n} °/s",
  "settings.volume": "Volume",
  "settings.flash": "Reduce flashes",
  "settings.flash.hint": "No full-screen flashes and fewer light effects.",
  "settings.motion": "Reduce motion",
  "settings.motion.hint": "No screen shake and fewer particles.",
  "settings.hand": "Hand",
  "settings.hand.right": "Right",
  "settings.hand.left": "Left",
  "settings.hand.hint": "The hand you hold the sword with.",
  "settings.autocenter": "Auto-recenter",
  "settings.autocenter.hint": "When idle, the crosshair slowly drifts back to the center.",
  "settings.dwell": "Hold to select",
  "settings.dwell.hint": "In menus, hold the crosshair still on a button to select it.",
  "settings.lethal": "Deadly bombs (Classic) [P2]",
  "settings.lethal.hint": "A bomb ends the game at once.",
  "settings.reset": "Reset high scores",
  "settings.reset.confirm": "Delete all high scores?",
  "settings.reset.yes": "Yes, delete",
  "settings.reset.no": "Cancel",
  "settings.on": "On",
  "settings.off": "Off",
  "settings.back": "Back",
};

// Additions required by docs/architecture.md section 8.8 (first eight), the calibration failure reasons and the mute toast.
const ADDITIONS = {
  "connect.err.permission": "Chrome is not allowed to use Bluetooth. Check System Settings > Privacy & Security > Bluetooth.",
  "connect.err.noData": "The Joy-Con is connected but is not sending data. Hold down the sync button again and try again.",
  "connect.cooldown.long": "Too many attempts in a row: wait about 3 minutes, then hold down the sync button again.",
  "connect.batteryLevel.ok": "Battery: good",
  "connect.batteryLevel.low": "Battery: low",
  "connect.batteryLevel.critical": "Battery: almost empty",
  "cal.flipX.hint": "Is the crosshair moving the wrong way?",
  "cal.flipX.button": "Flip left and right",
  // Presentation additions (calibration stepFailed reasons that the design table does not cover, and a back hint).
  "cal.timeout": "This step timed out. Try again.",
  "cal.noData": "The Joy-Con is not sending data. Check the connection.",
  // R3-06: the reading can be off because of the SENSOR, not because the player moved: say both
  "cal.badAccel": "The sensor does not seem to be still, or it reads an unusual value. Put the sword down on a flat surface and try again.",
  "cal.noCalibration": "Calibration is missing. Repeat the full calibration.",
  // Round 2 finding M1: the wizard could not measure the gyro sign (a hole in the data during the move); the player is told to repeat it
  "cal.signUnknown": "Could not measure the direction of rotation. If the crosshair moves the wrong way, repeat the calibration.",
  "cal.backHint": "Back: {button}",
  // Runtime mute (the M key)
  "audio.muted": "Audio muted",
  "audio.unmuted": "Audio on",
  // Improvements round: a notice for the mouse provider (QA-07) and the sword tuning screen
  "menu.noCalibration": "No calibration is needed with the mouse.",
  "menu.tuneHint": "First time with the real sword? Open Settings, then “Sword tuning”.",
  "settings.tune": "Sword tuning",
  "tune.title": "Sword tuning",
  "tune.intro": "Move the sword as you would in a game and adjust the values until the crosshair and the slices feel right.",
  "tune.preset": "Threshold preset",
  "tune.last": "Last swing: {n} °/s",
  "tune.verdict.none": "Make a firm swing",
  "tune.verdict.cut": "Slices: above the threshold",
  "tune.verdict.slow": "Too slow: {n} °/s needed",
  "tune.reach": "You covered {w}% of the width and {h}% of the height",
  "tune.reach.hint": "Move the crosshair into all four corners. If you can't reach them, raise the sensitivity.",
  "tune.reach.ok": "You can reach all four corners",
  "tune.fruit": "Slice the practice fruit",
  "tune.defaults": "Default values",
  // Chooser fallback (docs/hardware-findings.md): shown after a closed chooser, with a button that retries with "acceptAllDevices"
  "connect.fallback.button": "Can't see it? Extended search",
  "connect.fallback.hint": "Is your Joy-Con not in the list? Extended search shows all nearby Bluetooth devices.",
  "connect.fallback.hintExtended": "Still nothing? Hold down the sync button until the lights flash, then try again.",

  // Native Bluetooth bridge (docs/native-bridge.md sections 9 and 10). The provider hands the UI the KEY of an error
  // (status.error.native.key) or of a progress phase (the 'bridge' event); the texts are these. Every error text says what to do next.
  "connect.native.button": "Connect Joy-Con (native bridge)",
  "connect.native.secondary": "Not working? Try Chrome's Bluetooth",
  "connect.native.secondaryToNative": "Try the native bridge (recommended)",
  "connect.native.hint": "Keep holding SYNC until “Connected” appears: a few seconds are usually enough.",
  "connect.native.cancel": "Cancel",
  "connect.native.countdown": "Time left: {s} s",
  "connect.native.anyBrowser": "This browser has no Web Bluetooth: the native bridge works anyway.",
  "connect.native.note.noCompiler": "Native bridge not available: install Apple's developer tools (type in Terminal: xcode-select --install) and restart the game.",
  "connect.native.step1": "1. Turn off the console. Do not pair the Joy-Con in the Mac's Bluetooth settings: it is not needed.",
  "connect.native.step2": "2. Press “{button}”. The first time, macOS asks for Bluetooth permission for Terminal: choose Allow.",
  "connect.native.step3": "3. Right away, hold down SYNC (the small button next to the USB-C port) until the lights sweep.",
  "connect.native.step4": "4. Wait for “Connected”, then calibrate the sword.",
  "connect.native.progress.checking": "Checking the Bluetooth bridge…",
  "connect.native.progress.starting": "Starting the Bluetooth bridge…",
  "connect.native.progress.building": "Preparing the Bluetooth bridge (first time only, a few seconds)…",
  "connect.native.progress.waitingBluetooth": "Waiting for the Mac's Bluetooth. If macOS asks for permission, choose Allow.",
  "connect.native.progress.scanning": "Looking for the Joy-Con. Hold SYNC now (the small button next to the USB-C port) until the lights sweep.",
  "connect.native.progress.connecting": "Joy-Con found. Connecting…",
  "connect.native.progress.discovering": "Reading the Joy-Con's services…",
  "connect.native.progress.initialising": "Preparing the Joy-Con…",
  "connect.native.progress.waitingData": "Waiting for the first motion data…",
  "connect.err.native.permission": "macOS is not letting this app use Bluetooth. Restart the game with start.command from Terminal and allow Bluetooth when macOS asks. Already declined? System Settings > Privacy & Security > Bluetooth: turn on Terminal.",
  "connect.err.native.bluetoothOff": "The Mac's Bluetooth is off. Turn it on from the menu bar or from System Settings, then try again.",
  "connect.err.native.noDevice": "No Joy-Con found. Hold SYNC until the lights sweep, staying close to the Mac. If you have already tried many times, wait a minute: the Joy-Con refuses repeated connections.",
  "connect.err.native.notPairing": "A Joy-Con was seen, but it is not in pairing mode. Hold SYNC until the lights sweep and try again.",
  "connect.err.native.connectFailed": "Can't connect to the Joy-Con. Wait a few seconds, hold SYNC and try again.",
  "connect.err.native.gatt": "The connection to the Joy-Con failed. Wait a few seconds and try again.",
  "connect.err.native.lost": "The Joy-Con disconnected. Hold SYNC until the lights sweep, then reconnect it.",
  "connect.err.native.noData": "The Joy-Con is connected but is not sending motion data. Hold SYNC and try again.",
  "connect.err.native.stalled": "The Bluetooth bridge has stopped responding. Try again in a few seconds.",
  "connect.err.native.crashed": "The Bluetooth bridge stopped suddenly. Try again; if it happens again, close the game and restart it with start.command.",
  "connect.err.native.helperFailed": "The Bluetooth bridge will not start. Close the game and restart it with start.command.",
  "connect.err.native.buildFailed": "Can't prepare the Bluetooth bridge. Install Apple's developer tools (type in Terminal: xcode-select --install) and restart the game. Meanwhile you can use the simulator or the mouse.",
  "connect.err.native.unavailable": "The Bluetooth bridge is not available. On a Mac you need Apple's developer tools (type in Terminal: xcode-select --install) and a restart of the game. Otherwise use Chrome with Web Bluetooth, the simulator or the mouse.",
  "connect.err.native.oldServer": "The game was started with an old version. Close it and reopen it with start.command.",
  "connect.err.native.noServer": "Can't reach the game. Check that the Terminal window is still open.",
  "connect.err.native.busy": "The Bluetooth bridge is already in use (another game tab?). Close it and try again in a few seconds.",
  "connect.err.native.refused": "The Bluetooth bridge refused the request. Open the game from the address that start.command shows.",
  "connect.err.native.unknown": "Something went wrong with the Bluetooth bridge. Try again.",
  "disc.native.text": "The Joy-Con disconnected. Hold SYNC until the lights sweep, then press “Reconnect”.",
  "disc.native.retry": "Reconnect",
  "disc.native.wait": "Reconnect in {s} s",

  // ---- Sword controls round, 2026-09-30 (docs/motion-contract.md 3.3 and 3.6, docs/motion-findings.md). The angular cut threshold and the
  // relative pointer changed the units of Sensitivity and Slice threshold; these are the one-time notice that says so, the crosshair-speed
  // line of the tuning screen (its numbers come from MOTION_CONFIG.pointer) and the row of pointer-speed presets.
  // `settings.migrated` is a one-line toast with no wrapping, and on the menu it sits at y 302 between the tagline and the mode fruit, whose
  // sprites are drawn over it (the pear reaches the band from x 1411): a text must stay under about 50 characters (750 px in the game font).
  // The contract's sentence (138 characters, about 2000 px) would have been hidden behind the fruit and cut at the screen edges, so it is
  // shortened to the one fact the player needs (logged in docs/contract-notes.md, D-S1).
  "settings.migrated": "Sensitivity and Slice threshold were reset.",
  "tune.gain": "Crosshair speed: {lo} px per degree when aiming slowly, {hi} px per degree in a fast swing",
  "tune.pointer": "Pointer speed",
  "tune.pointer.relaxed": "Relaxed",
  "tune.pointer.standard": "Standard",
  "tune.pointer.fast": "Fast",

  // ---- Stick navigation round, 2026-10-01 (docs/contract-notes.md, "Stick navigation"): in the menus the stick moves a focus, A selects, B goes
  // back; the real Joy-Con no longer selects with the sword unless "Sword selection in menus" is on. The hint line names the buttons of the
  // device in use ({move}, {confirm} and {back} are filled in by ui.js: "Stick" / "Arrows", "A" / "Enter", "B" / "Esc", or the Left unit's own buttons).
  "settings.sword": "Sword selection in menus",
  "settings.sword.hint": "Real Joy-Con. Off: stick, A and B only. On: the sword can also select (hold still, or cut).",
  "menu.nav.stick": "Stick",
  "menu.nav.arrows": "Arrows",
  "menu.nav.hint": "{move}: move   {confirm}: select   {back}: back",
  "menu.nav.hintNoBack": "{move}: move   {confirm}: select",
  "menu.nav.hintValue": "{move}: up and down to move, left and right to change   {back}: back",

  // ---- restyle round (UI engineer): the section hop of the settings and sword tuning screens (R / L of a Joy-Con, PageUp / PageDown)
  "menu.nav.hintHop": "{move}: move   {confirm}: select   {hop}: other column   {back}: back",
  "menu.nav.hintValueHop": "{move}: up and down to move, left and right to change   {hop}: other column   {back}: back",
};

export const STRING_KEYS_BASE = Object.freeze(Object.keys(BASE));
export const STRING_KEYS_ADDITIONS = Object.freeze(Object.keys(ADDITIONS));

/** @type {Readonly<Record<string,string>>} */
export const STRINGS = Object.freeze({ ...BASE, ...ADDITIONS });

// Development builds throw on a missing key, production builds return the key. Node (tests) and ?debug=1 are development;
// a throwing t() inside the render loop of a real session would freeze the game, so the browser default is lenient.
let strict = typeof window === 'undefined';

/** Switch strict (throwing) mode on or off. The Presentation turns it on for ?debug=1. */
export function setStrictStrings(on) {
  strict = !!on;
}

export function isStrictStrings() {
  return strict;
}

/**
 * Look up a string and replace {name} placeholders.
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  const text = STRINGS[key];
  if (text === undefined) {
    if (strict) throw new Error(`strings.en.js: missing key "${key}"`);
    return key;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}

/** Decimal point, fixed digits (one by default): 1 -> "1.0". Used by the settings screen. */
export function formatDecimal(value, digits = 1) {
  return Number(value).toFixed(digits);
}
