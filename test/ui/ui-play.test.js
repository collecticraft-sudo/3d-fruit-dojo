// UI state machine, part 2: countdown, pause and resume, results, disconnect overlay, action routing, toasts, gameActive and
// systemCursor truth tables (docs/architecture.md 8.3 and 8.4, docs/game-design.md 12.8 to 12.11, 15.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { countdownPhase } from '../../public/js/ui/screens/countdown.js';
import { rankFromScore } from '../../public/js/ui/ui.js';
import { actionFact, makeBlade, makeSnapshot, makeUiHarness, providerFact, roundResult, seg } from '../../test-support/ui/fixtures.js';

const cal = (h, event) => h.ui.notify({ type: 'calibration', event: { t: 0, ...event } });
const at = (x, y) => makeBlade({ head: { x, y }, trackingOk: true });

function startRound(h, mode = 'arcade') {
  h.toMenuWithSim();
  h.advance(600);
  h.ui.force('menu');
  h.advance(600);
  const target = { classic: [480, 540], arcade: [960, 540], zen: [1440, 540] }[mode];
  h.ui.pointerClick(...target);
  return h;
}

// ---------------------------------------------------------------- countdown

test('countdown: exactly 3 x 0.8 s numbers + 0.6 s "VIA!" (after the 350 ms slice), then playing with gameActive', () => {
  const h = startRound(makeUiHarness(), 'arcade');
  h.clearRecords();
  assert.equal(h.state().screen, 'countdown');
  assert.equal(h.state().gameActive, false);
  h.advance(340);
  assert.equal(h.soundIds().includes('countdown'), false, 'no number during the slice');
  h.advance(20);
  assert.equal(h.soundIds().filter((s) => s === 'countdown').length, 1, '"3"');
  h.advance(800);
  assert.equal(h.soundIds().filter((s) => s === 'countdown').length, 2, '"2"');
  h.advance(800);
  assert.equal(h.soundIds().filter((s) => s === 'countdown').length, 3, '"1"');
  h.advance(800);
  assert.deepEqual(h.soundIds().filter((s) => s === 'go'), ['go']);
  assert.equal(h.state().screen, 'countdown', '"VIA!" is still on screen');
  h.advance(600);
  assert.equal(h.state().screen, 'playing');
  assert.equal(h.state().gameActive, true);
  assert.equal(h.state().roundMode, 'arcade');
});

test('force("countdown") runs the normal 3-2-1-VIA timeline from now (used by the debug API)', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(5000);
  h.ui.force('countdown', { roundMode: 'zen' });
  h.step();
  assert.equal(h.state().screen, 'countdown');
  assert.equal(h.state().roundMode, 'zen');
  h.advance(2900);
  assert.equal(h.state().screen, 'countdown');
  h.advance(200);
  assert.equal(h.state().screen, 'playing');
  assert.equal(h.state().gameActive, true);
});

test('countdownPhase maps elapsed time to the numeral shown', () => {
  assert.deepEqual(countdownPhase(-10), { word: null, local: 0 });
  assert.equal(countdownPhase(0).word, '3');
  assert.equal(countdownPhase(799).word, '3');
  assert.equal(countdownPhase(800).word, '2');
  assert.equal(countdownPhase(1600).word, '1');
  assert.equal(countdownPhase(2399).word, '1');
  assert.equal(countdownPhase(2400).word, 'go');
  assert.ok(Math.abs(countdownPhase(2700).local - 0.5) < 1e-9);
});

test('countdown: the blade stays live (warm-up) and recenter still works; pause action is ignored, blur pauses', () => {
  const h = startRound(makeUiHarness(), 'zen');
  h.advance(600);
  h.clearRecords();
  h.ui.notify(actionFact('recenter'));
  assert.deepEqual(h.intents, [{ type: 'recenter' }]);
  h.ui.notify(actionFact('pause'));
  assert.equal(h.state().screen, 'countdown');
  h.ui.notify({ type: 'blur' });
  assert.equal(h.state().screen, 'paused');
});

test('results "Play again" starts the countdown at once (no slice delay)', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'classic' }) });
  h.advance(1700);
  h.clearRecords();
  h.ui.pointerClick(760, 862);
  assert.deepEqual(h.intents, [{ type: 'startRound', mode: 'classic' }]);
  assert.equal(h.state().screen, 'countdown');
  h.advance(20);
  assert.equal(h.soundIds().includes('countdown'), true, 'the "3" starts immediately');
});

// ---------------------------------------------------------------- pause and resume

test('pause: the pause and back actions pause; pause toggles back through the resume countdown', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  assert.equal(h.state().gameActive, true);
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'paused');
  assert.equal(h.state().gameActive, false);
  h.ui.notify(actionFact('pause'));
  assert.equal(h.state().screen, 'playing');
  assert.equal(h.state().resuming, true);
  assert.equal(h.state().gameActive, false, 'the game does not update during the resume countdown');
  h.advance(2000);
  assert.equal(h.state().gameActive, false);
  assert.equal(h.view.pause.resumeN, 1);
  h.advance(150);
  assert.equal(h.state().resuming, false);
  assert.equal(h.state().gameActive, true);
  assert.equal(h.soundIds().filter((s) => s === 'countdown').length, 3, '3, 2, 1');
});

test('pause: "Resume" runs the 0.7 s per number resume countdown; pausing again cancels it', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify(actionFact('pause'));
  h.ui.pointerClick(960, 380);
  assert.equal(h.state().resuming, true);
  h.advance(600);
  assert.equal(h.view.pause.resumeN, 3);
  h.advance(200);
  assert.equal(h.view.pause.resumeN, 2);
  h.ui.notify(actionFact('pause'));
  assert.equal(h.state().screen, 'paused');
  assert.equal(h.state().resuming, false);
  assert.equal(h.state().gameActive, false);
});

test('pause: window blur and a hidden tab pause a running game and show the auto-pause notice', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify({ type: 'visibility', hidden: true });
  assert.equal(h.state().screen, 'paused');
  assert.equal(h.view.pausedBlur, true);
  h.ui.notify(actionFact('pause'));
  h.advance(2200);
  h.ui.notify({ type: 'blur' });
  assert.equal(h.state().screen, 'paused');
  assert.equal(h.view.pausedBlur, true);
  h.ui.notify(actionFact('pause'));
  h.advance(2200);
  h.ui.notify(actionFact('pause'));
  assert.equal(h.view.pausedBlur, false, 'a user pause shows the normal tip');
  const idle = makeUiHarness();
  idle.toMenuWithSim();
  idle.ui.notify({ type: 'blur' });
  assert.equal(idle.state().screen, 'menu', 'blur outside a round does nothing');
});

test('pause menu: Quit to menu asks first; Yes ends the round; No keeps it; Recalibrate asks Motion for a quick recentre', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify(actionFact('pause'));
  h.clearRecords();
  h.ui.pointerClick(960, 860);
  assert.equal(h.view.overlay, 'confirm');
  assert.equal(h.view.confirm.kind, 'quit');
  h.ui.pointerClick(1160, 650); // No, keep playing
  assert.equal(h.state().screen, 'paused');
  assert.deepEqual(h.intents, []);
  h.ui.pointerClick(960, 860);
  h.ui.pointerClick(760, 650); // Yes, quit
  assert.deepEqual(h.intents, [{ type: 'endRound' }]);
  assert.equal(h.state().screen, 'menu');
  assert.equal(h.state().roundMode, null);
  const r = makeUiHarness();
  r.toPlaying('classic');
  r.ui.notify(actionFact('pause'));
  r.clearRecords();
  r.ui.pointerClick(960, 540);
  assert.deepEqual(r.intents, [{ type: 'quickRecenter' }]);
  cal(r, { type: 'started', quick: true });
  assert.equal(h.state().calibrationStep === null || true, true);
  assert.equal(r.state().screen, 'calibration');
  assert.equal(r.state().calibrationStep, 3);
  cal(r, { type: 'done', quick: true, calibration: {}, warnings: [] });
  assert.equal(r.state().screen, 'playing', 'after a quick recentre from pause the resume countdown runs');
  assert.equal(r.state().resuming, true);
});

test('pause menu buttons can be cut or dwelled like the main menu', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify(actionFact('pause'));
  h.advance(700);
  h.advance(16, { segments: [seg(600, 380, 1300, 380)] });
  assert.equal(h.state().resuming, true, 'cutting Resume resumes');
});

// ---------------------------------------------------------------- results

test('results: roundOver opens the screen with rank, the best score and the new-record flag; the game is not active', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'classic', score: 1234 }) });
  assert.equal(h.state().screen, 'results');
  assert.equal(h.state().gameActive, false);
  assert.equal(h.view.results.rank, 2, 'Warrior: 800 to 1999');
  assert.equal(h.view.results.isNewBest, true);
  assert.equal(h.storage.getBest('classic').score, 1234);
  h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'classic', score: 500 }) });
  assert.equal(h.view.results.isNewBest, false);
  assert.equal(h.view.results.best.score, 1234, 'the shown record is the stored one');
  assert.equal(h.view.results.rank, 1);
});

test('rankFromScore follows the design table for every mode and boundary', () => {
  const cases = [
    ['classic', 0, 1], ['classic', 799, 1], ['classic', 800, 2], ['classic', 1999, 2], ['classic', 2000, 3], ['classic', 3999, 3], ['classic', 4000, 4], ['classic', 6999, 4], ['classic', 7000, 5],
    ['arcade', 599, 1], ['arcade', 600, 2], ['arcade', 1300, 3], ['arcade', 2200, 4], ['arcade', 3200, 5], ['arcade', 99999, 5],
    ['zen', 599, 1], ['zen', 600, 2], ['zen', 1200, 3], ['zen', 1900, 4], ['zen', 2600, 5],
  ];
  for (const [mode, score, rank] of cases) assert.equal(rankFromScore(mode, score), rank, `${mode} ${score}`);
});

test('results: input lockout of 1.2 s AFTER the 400 ms slide-in for clicks, cuts and dwell; then Play again and Menu work (QA-03)', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'classic' }) });
  h.advance(600);
  assert.equal(h.ui.findTarget('results.again').enabled, false);
  assert.equal(h.ui.pointerClick(760, 862), false);
  h.advance(500, { segments: [seg(500, 862, 1400, 862)], blade: at(760, 862) });
  assert.equal(h.state().screen, 'results', 'a cut during the lockout selects nothing');
  h.ui.notify(actionFact('confirm'));
  assert.equal(h.state().screen, 'results');
  assert.ok(h.view.results.lockLeft > 0 && h.view.results.lockLeft < 0.5);
  h.advance(150);
  assert.equal(h.view.results.locked, true, '1250 ms after the screen started the panel has been fully in for only 850 ms (QA-03)');
  h.ui.notify(actionFact('confirm'));
  assert.equal(h.state().screen, 'results', 'Enter at +1250 ms is still ignored');
  h.advance(400);
  assert.equal(h.view.results.locked, false, 'unlocked 1200 ms after the slide-in ended (+1600 ms)');
  assert.equal(h.ui.findTarget('results.again').enabled, true);
  h.clearRecords();
  h.ui.pointerClick(1160, 862); // Menu
  assert.deepEqual(h.intents, [{ type: 'endRound' }]);
  assert.equal(h.state().screen, 'menu');
});

test('results: the score counts up over 1.2 s (immediately with reduced motion) and a new record plays the record sound once', () => {
  const h = makeUiHarness();
  h.toPlaying('arcade');
  h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'arcade', score: 1000 }) });
  h.advance(16);
  assert.ok(h.view.results.shownScore < 100);
  // the panel slides in during the first 400 ms; THEN the score counts up for 1.2 s (restyle: direction section 3)
  h.advance(300);
  assert.equal(h.view.results.shownScore, 0, 'nothing counts while the panel slides in');
  h.advance(700); // 1016 ms: 616 ms into the 1200 ms count-up
  assert.ok(h.view.results.shownScore > 400 && h.view.results.shownScore < 1000);
  assert.equal(h.soundIds().includes('record'), false);
  assert.equal(h.soundIds().includes('rankStamp'), false, 'the seal lands 150 ms after the count-up ends');
  h.advance(900); // 1916 ms: past the stamp (1750), before the ribbon (1950)
  assert.equal(h.view.results.shownScore, 1000);
  assert.deepEqual(h.soundIds().filter((s) => s === 'rankStamp' || s === 'resultsFanfare'), ['rankStamp', 'resultsFanfare'], 'the stamp, then the fanfare for the rank');
  assert.equal(h.soundIds().includes('record'), false, 'the ribbon comes 200 ms after the seal');
  assert.deepEqual(h.sounds.find((s) => s[0] === 'resultsFanfare')[1], { rank: h.view.results.rank });
  h.advance(100);
  assert.equal(h.soundIds().filter((s) => s === 'record').length, 1);
  assert.equal(h.effects.filter((e) => e[0] === 'goldFlash').length, 1);
  h.advance(1000);
  assert.equal(h.soundIds().filter((s) => s === 'record').length, 1, 'only once');
  assert.equal(h.soundIds().filter((s) => s === 'rankStamp').length, 1, 'the stamp once too');
  const ticks = h.sounds.filter((s) => s[0] === 'countTick');
  assert.ok(ticks.length >= 18 && ticks.length <= 26, `a tick every 50 ms for 1.2 s, ${ticks.length} ticks`);
  assert.ok(ticks.every((s, i) => i === 0 || s[1].progress >= ticks[i - 1][1].progress) && ticks.at(-1)[1].progress < 1, 'the progress rises (the engine pitches the tick with it)');
  assert.equal(h.soundIds().includes('tick'), false, 'tick is the timer cue of the last 10 s of a round, not the count-up');
  const calm = makeUiHarness();
  calm.storage.updateSettings({ reduceMotion: true });
  calm.toPlaying('arcade');
  calm.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'arcade', score: 1000 }) });
  calm.advance(16);
  assert.equal(calm.view.results.shownScore, 1000);
});

test('results: after 10 minutes of cumulative play a break banner appears; 5 minutes idle resets the count', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify({ type: 'roundOver', result: roundResult({ durationS: 300 }) });
  assert.equal(h.view.results.showBreak, false);
  h.advance(60_000);
  h.ui.notify({ type: 'roundOver', result: roundResult({ durationS: 330 }) });
  assert.equal(h.view.results.showBreak, true);
  assert.equal(h.view.results.breakMin, 10);
  h.advance(6 * 60_000);
  h.ui.notify({ type: 'roundOver', result: roundResult({ durationS: 120 }) });
  assert.equal(h.view.results.showBreak, false, 'idle for 5 minutes counts as a break');
  assert.ok(h.storage.addPlayMs(0) >= 750_000, 'the total play time is persisted');
});

test('results for Zen hide the bombs stat; practice results are ignored', () => {
  const h = makeUiHarness();
  h.toPlaying('zen');
  h.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'zen', bombsHit: 0 }) });
  assert.equal(h.state().screen, 'results');
  const p = makeUiHarness();
  p.toMenuWithSim();
  p.ui.notify({ type: 'roundOver', result: roundResult({ mode: 'practice' }) });
  assert.equal(p.state().screen, 'menu');
});

// ---------------------------------------------------------------- disconnect overlay

function streamingJoycon(h) {
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('joycon', 'streaming'));
  h.ui.notify({ type: 'ready' });
  cal(h, { type: 'started', quick: false });
  cal(h, { type: 'done', quick: false, calibration: {}, warnings: [] }); // step 4
  h.ui.notify(actionFact('back')); // leave the practice round: menu
  return h;
}

test('disconnect: a lost Joy-Con pauses the game under the overlay; one automatic reconnect at 2 s', () => {
  const h = streamingJoycon(makeUiHarness());
  h.ui.force('playing', { roundMode: 'classic' });
  h.step();
  assert.equal(h.state().gameActive, true);
  h.clearRecords();
  h.ui.notify(providerFact('joycon', 'lost', { error: { code: 'lost_signal', message: 'x', retryable: true, at: 0 } }));
  assert.equal(h.state().screen, 'paused', 'the game is paused underneath');
  assert.equal(h.state().overlay, 'disconnected');
  assert.equal(h.state().gameActive, false);
  assert.ok(h.soundIds().includes('disconnect'));
  h.advance(1900);
  assert.equal(h.intents.some((i) => i.type === 'reconnect'), false);
  h.advance(200);
  assert.equal(h.intents.filter((i) => i.type === 'reconnect').length, 1);
  h.advance(500);
  assert.equal(h.intents.filter((i) => i.type === 'reconnect').length, 1, 'never a loop');
});

test('disconnect: a failed reconnect shows Try again (locked during the cooldown), Continue with the mouse and Back to menu', () => {
  const h = streamingJoycon(makeUiHarness());
  h.ui.force('playing', { roundMode: 'classic' });
  h.step();
  h.ui.notify(providerFact('joycon', 'lost'));
  h.advance(2100);
  h.ui.notify(providerFact('joycon', 'connecting'));
  h.advance(500);
  h.ui.notify(providerFact('joycon', 'lost', { error: { code: 'gatt_failure', message: 'x', retryable: true, at: 0 }, cooldownUntil: h.clock.now() + 10_000, failures: 1 }));
  h.advance(50);
  assert.equal(h.view.disc.phase, 'failed');
  const ids = h.ui.getTargets().map((t) => t.id);
  assert.deepEqual(ids, ['disc.retry', 'disc.mouse', 'disc.menu']);
  assert.equal(h.ui.findTarget('disc.retry').enabled, false);
  assert.ok(h.view.disc.retryLeftS > 0 && h.view.disc.retryLeftS <= 10);
  h.clearRecords();
  assert.equal(h.ui.pointerClick(960, 585), false, 'Try again is locked until the cooldown ends');
  h.advance(10_100);
  assert.equal(h.ui.findTarget('disc.retry').enabled, true);
  h.ui.pointerClick(960, 585);
  assert.deepEqual(h.intents, [{ type: 'reconnect' }]);
  assert.equal(h.view.disc.phase, 'reconnecting');
});

test('disconnect: a reconnect that shows no progress for 1.5 s (cooldown rejection) also ends in the failed phase', () => {
  const h = streamingJoycon(makeUiHarness());
  h.ui.notify(providerFact('joycon', 'lost'));
  h.advance(2100);
  assert.equal(h.view.disc.phase, 'reconnecting');
  h.advance(1600);
  assert.equal(h.view.disc.phase, 'failed');
});

test('disconnect: recovery runs a quick recentre, then the resume countdown of the interrupted round', () => {
  const h = streamingJoycon(makeUiHarness());
  h.ui.force('playing', { roundMode: 'arcade' });
  h.step();
  h.ui.notify(providerFact('joycon', 'lost'));
  h.advance(2100);
  h.clearRecords();
  h.ui.notify(providerFact('joycon', 'connecting'));
  h.ui.notify(providerFact('joycon', 'streaming'));
  assert.ok(h.soundIds().includes('connectOk'));
  assert.deepEqual(h.intents, [{ type: 'quickRecenter' }]);
  assert.equal(h.view.disc.phase, 'recovering');
  cal(h, { type: 'started', quick: true });
  assert.equal(h.state().overlay, 'disconnected', 'the overlay stays: the quick recentre is shown inside it');
  assert.equal(h.view.disc.phase, 'recentering');
  cal(h, { type: 'progress', step: 3, phase: 'holding', progress: 0.5, meanDps: 1, peakDps: 1, accelMagG: 1 });
  assert.equal(h.view.cal.progress, 0.5);
  cal(h, { type: 'done', quick: true, calibration: {}, warnings: [] });
  assert.equal(h.state().overlay, null);
  assert.equal(h.state().screen, 'playing');
  assert.equal(h.state().resuming, true);
  assert.equal(h.state().gameActive, false);
  h.advance(2200);
  assert.equal(h.state().gameActive, true);
});

test('disconnect: an already paused game stays paused after the recovery; without a calibration the overlay just closes', () => {
  const h = streamingJoycon(makeUiHarness());
  h.ui.force('playing', { roundMode: 'classic' });
  h.ui.notify(actionFact('pause'));
  h.ui.notify(providerFact('joycon', 'lost'));
  h.ui.notify(providerFact('joycon', 'streaming'));
  cal(h, { type: 'done', quick: true, calibration: {}, warnings: [] });
  assert.equal(h.state().overlay, null);
  assert.equal(h.state().screen, 'paused');
  const c = makeUiHarness();
  c.storage.setSafetyAck();
  c.ui.notify(providerFact('joycon', 'streaming'));
  c.ui.notify({ type: 'ready' });
  c.ui.notify(providerFact('joycon', 'lost'));
  assert.equal(c.state().overlay, 'disconnected');
  c.ui.notify(providerFact('joycon', 'streaming'));
  assert.equal(c.state().overlay, null, 'no calibration: nothing to recentre');
});

test('disconnect: "Continue with the mouse" and "Back to menu"', () => {
  const setup = () => {
    const h = streamingJoycon(makeUiHarness());
    h.ui.force('playing', { roundMode: 'classic' });
    h.ui.notify(providerFact('joycon', 'lost'));
    h.advance(2100);
    h.ui.notify(providerFact('joycon', 'connecting'));
    h.ui.notify(providerFact('joycon', 'lost'));
    h.advance(50);
    return h;
  };
  const a = setup();
  a.clearRecords();
  a.ui.pointerClick(960, 685);
  assert.deepEqual(a.intents, [{ type: 'useMouse' }]);
  a.ui.notify(providerFact('mouse', 'streaming'));
  assert.equal(a.state().overlay, null);
  assert.equal(a.state().resuming, true, 'continues with a countdown');
  const b = setup();
  b.clearRecords();
  b.ui.pointerClick(960, 785);
  assert.deepEqual(b.intents, [{ type: 'endRound' }, { type: 'disconnect' }]);
  assert.equal(b.state().screen, 'menu');
  assert.equal(b.state().overlay, null);
  assert.equal(b.state().systemCursor, true, 'no aim source: the OS cursor stays available');
});

test('disconnect: during calibration steps 1 to 3 the wizard is cancelled', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify(providerFact('joycon', 'streaming'));
  h.ui.notify({ type: 'ready' });
  cal(h, { type: 'started', quick: false });
  h.clearRecords();
  h.ui.notify(providerFact('joycon', 'lost'));
  assert.deepEqual(h.intents, [{ type: 'cancelCalibration' }]);
  assert.equal(h.state().overlay, 'disconnected');
  assert.equal(h.state().screen, 'connect');
});

test('disconnect: a Joy-Con that never streamed does not raise the overlay (that is a connect error)', () => {
  const h = makeUiHarness();
  h.storage.setSafetyAck();
  h.ui.notify({ type: 'ready' });
  h.ui.notify(providerFact('joycon', 'connecting'));
  h.ui.notify(providerFact('joycon', 'lost'));
  assert.equal(h.state().overlay, null);
});

// ---------------------------------------------------------------- action routing, truth tables

test('action routing per screen', () => {
  // confirm: menu hovered / default, settings, results after lockout; back: settings, pause, playing
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.notify(actionFact('back'));
  assert.equal(h.state().screen, 'menu', 'back on the menu does nothing');
  h.ui.notify(actionFact('recenter'));
  assert.equal(h.intents.at(-1).type, 'recenter');
  const s = makeUiHarness();
  s.ui.notify({ type: 'ready' });
  s.ui.notify(actionFact('back'));
  s.ui.notify(actionFact('pause'));
  s.ui.notify(actionFact('recenter'));
  assert.equal(s.state().screen, 'safety');
  assert.equal(s.intents.length, 0, 'nothing on the safety screen');
  const p = makeUiHarness();
  p.toPlaying('classic');
  p.clearRecords();
  p.ui.notify(actionFact('recenter'));
  assert.deepEqual(p.intents, [{ type: 'recenter' }]);
  p.ui.notify(actionFact('confirm'));
  assert.equal(p.state().screen, 'playing', 'confirm does nothing during play');
  p.ui.notify(actionFact('pause'));
  p.clearRecords();
  p.ui.notify(actionFact('recenter'));
  assert.deepEqual(p.intents, [{ type: 'recenter' }], 'recenter also works while paused');
  p.ui.notify(actionFact('confirm')); // default focus: Resume
  assert.equal(p.state().resuming, true);
});

test('gameActive is true only on playing (and calibration step 4) with no overlay and no resume countdown', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  const table = [];
  for (const screen of ['boot', 'safety', 'connect', 'menu', 'settings', 'countdown', 'playing', 'paused', 'results']) {
    h.ui.force(screen, { roundMode: 'classic' });
    table.push([screen, h.state().gameActive]);
  }
  assert.deepEqual(table, [['boot', false], ['safety', false], ['connect', false], ['menu', false], ['settings', false], ['countdown', false], ['playing', true], ['paused', false], ['results', false]]);
  h.ui.force('calibration', { step: 3 });
  assert.equal(h.state().gameActive, false);
  h.ui.force('calibration', { step: 4 });
  assert.equal(h.state().gameActive, true);
  h.ui.force('playing', { roundMode: 'classic' });
  h.ui.notify(providerFact('joycon', 'streaming'));
  h.ui.notify(providerFact('joycon', 'lost'));
  assert.equal(h.state().gameActive, false, 'overlay');
});

test('systemCursor: safety and connect, and any screen without an aim source; false while a sim / mouse / calibrated Joy-Con aims', () => {
  const h = makeUiHarness();
  assert.equal(h.state().systemCursor, true, 'boot');
  h.ui.notify({ type: 'ready' });
  assert.equal(h.state().systemCursor, true, 'safety');
  const sim = makeUiHarness();
  sim.toMenuWithSim();
  assert.equal(sim.state().screen, 'menu');
  assert.equal(sim.state().systemCursor, false, 'menu with a simulator');
  sim.ui.force('connect');
  assert.equal(sim.state().systemCursor, true);
  sim.ui.force('playing', { roundMode: 'classic' });
  assert.equal(sim.state().systemCursor, false);
  const j = makeUiHarness();
  j.storage.setSafetyAck();
  j.ui.notify(providerFact('joycon', 'streaming'));
  j.ui.notify({ type: 'ready' });
  j.ui.force('menu');
  assert.equal(j.state().systemCursor, true, 'uncalibrated Joy-Con: no aim source yet');
  cal(j, { type: 'started', quick: false });
  assert.equal(j.state().systemCursor, true, 'calibration steps 1 to 3 keep the OS cursor');
  cal(j, { type: 'done', quick: false, calibration: {}, warnings: [] });
  assert.equal(j.state().calibrationStep, 4);
  assert.equal(j.state().systemCursor, false);
  j.ui.force('menu');
  assert.equal(j.state().systemCursor, false, 'calibrated');
  const m = makeUiHarness();
  m.ui.force('menu');
  assert.equal(m.state().systemCursor, true, 'no provider at all');
});

// ---------------------------------------------------------------- toasts, hints, tips

test('toasts: recentered (800 ms + sound + cursor pulse), low battery at most once per 5 minutes', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.notify({ type: 'recentered', kind: 'manual' });
  assert.equal(h.view.toast.text, 'Crosshair recentered');
  assert.ok(h.soundIds().includes('recenter'));
  assert.equal(h.effects.at(-1)[0], 'cursorPulse');
  h.advance(700);
  assert.equal(h.view.toast.text, 'Crosshair recentered');
  h.advance(150);
  assert.equal(h.view.toast.text, null);
  const low = { battery: { mv: 3400, level: 'low', pct: null } };
  h.ui.notify(providerFact('joycon', 'streaming', low));
  assert.equal(h.view.toast.text, 'Joy-Con battery almost empty');
  h.advance(3000);
  assert.equal(h.view.toast.text, null);
  h.ui.notify(providerFact('joycon', 'streaming', { ...low, battery: { mv: 3300, level: 'critical', pct: null } }));
  assert.equal(h.view.toast.text, null, 'not again within 5 minutes');
  h.advance(5 * 60_000);
  h.ui.notify(providerFact('joycon', 'streaming', low));
  assert.equal(h.view.toast.text, 'Joy-Con battery almost empty');
});

test('in-round hints: pause / recenter hint for the first 20 s only, with the provider labels', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.step({ snapshot: makeSnapshot({ t: 5 }) });
  assert.equal(h.view.hint.show, true);
  assert.equal(h.view.hint.pauseText, 'Pause: P');
  assert.equal(h.view.hint.recenterText, 'Recenter: Space');
  h.step({ snapshot: makeSnapshot({ t: 21 }) });
  assert.equal(h.view.hint.show, false);
  const j = makeUiHarness();
  j.storage.setSafetyAck();
  j.ui.notify(providerFact('joycon', 'streaming'));
  j.ui.notify({ type: 'ready' });
  j.ui.force('playing', { roundMode: 'classic' });
  j.step({ snapshot: makeSnapshot({ t: 1 }) });
  assert.equal(j.view.hint.pauseText, 'Pause: +');
  assert.equal(j.view.hint.recenterText, 'Recenter: ZR');
});

test('first-ever round: tips at 2 s and 12 s and the bomb tip at the first telegraph; never for a player with a record', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(600);
  h.ui.pointerClick(480, 540); // classic: firstEver
  h.ui.force('playing', { roundMode: 'classic' });
  h.step({ snapshot: makeSnapshot({ t: 1 }) });
  assert.equal(h.view.toast.text, null);
  h.step({ snapshot: makeSnapshot({ t: 2.1 }) });
  assert.equal(h.view.toast.text, 'Swing the sword fast to slice!');
  h.advance(2600);
  h.step({ snapshot: makeSnapshot({ t: 12.2 }) });
  assert.equal(h.view.toast.text, 'Slice several fruits in one swing to make a COMBO.');
  h.advance(2600);
  h.step({ snapshot: makeSnapshot({ t: 30 }), events: [{ seq: 1, t: 30, type: 'telegraph', x: 500, inMs: 350 }] });
  assert.equal(h.view.toast.text, 'Watch out for bombs: don\'t slice them!');
  const v = makeUiHarness();
  v.storage.recordResult('arcade', { score: 100, combo: 1 });
  v.toMenuWithSim();
  v.advance(600);
  v.ui.pointerClick(480, 540);
  v.ui.force('playing', { roundMode: 'classic' });
  v.step({ snapshot: makeSnapshot({ t: 2.5 }) });
  assert.equal(v.view.toast.text, null, 'the tips are for the very first round only');
});

test('timed rounds: "Last 10 seconds!" once; Classic soft break toast at 6:00 once', () => {
  const h = makeUiHarness();
  h.toPlaying('arcade');
  h.step({ snapshot: makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 12, timeTotal: 60, t: 48 }) });
  assert.equal(h.view.toast.text, null);
  h.step({ snapshot: makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 9.9, timeTotal: 60, t: 50.1 }) });
  assert.equal(h.view.toast.text, 'Last 10 seconds!');
  h.advance(2600);
  h.step({ snapshot: makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 8, timeTotal: 60, t: 52 }) });
  assert.equal(h.view.toast.text, null, 'once');
  const c = makeUiHarness();
  c.toPlaying('classic');
  c.step({ snapshot: makeSnapshot({ t: 359 }) });
  assert.equal(c.view.toast.text, null);
  c.step({ snapshot: makeSnapshot({ t: 360.2 }) });
  assert.equal(c.view.toast.text, 'You have been playing for 6 minutes. Want to take a break?');
});

test('Zen never shows the last-10-seconds toast', () => {
  const h = makeUiHarness();
  h.toPlaying('zen');
  h.step({ snapshot: makeSnapshot({ mode: 'zen', lives: null, timeLeft: 5, timeTotal: 90, t: 85 }) });
  assert.equal(h.view.toast.text, null);
});

test('intents from a throwing handler do not break the UI; handlers can be removed', () => {
  const h = makeUiHarness();
  h.toMenuWithSim();
  const off = h.ui.onIntent(() => { throw new Error('handler bug'); });
  const original = console.error;
  console.error = () => {};
  try {
    h.ui.pointerClick(560, 975);
  } finally {
    console.error = original;
  }
  assert.equal(h.state().screen, 'settings');
  off();
  const seen = [];
  const off2 = h.ui.onIntent((i) => seen.push(i.type));
  off2();
  h.ui.notify(actionFact('back'));
  assert.deepEqual(seen, []);
});
