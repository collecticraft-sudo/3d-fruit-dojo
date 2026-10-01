// Layout and readability fixes of the improvements round (QA-04, QA-05, QA-06, QA-07, R3-05, R2-02): what is drawn where.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeRenderRig } from '../../test-support/render/rig.js';
import { MENU_MODES, RESULTS_PANEL, DISCONNECT_PANEL, screenTargets } from '../../public/js/ui/layout-data.js';
import { actionFact, comboEvent, makeBlade, makeSnapshot, makeUiHarness, powerupEvent, providerFact, roundResult } from '../../test-support/ui/fixtures.js';

const fillTexts = (rig, text) => rig.ctx.calls.filter((c) => c[0] === 'fillText' && c[1] === text);

test('QA-04: the power-up banner subtitle sits inside the dark plate, not across its lower edge', () => {
  for (const id of ['freeze', 'frenzy', 'double']) {
    const rig = makeRenderRig();
    const h = makeUiHarness();
    h.toPlaying('classic');
    const snap = makeSnapshot();
    rig.fx.handleEvent(powerupEvent({ powerupId: id }));
    rig.fx.update(0.3, 0.3, snap);
    h.step({ snapshot: snap });
    rig.trail.updateCursor(makeBlade(), 0.016);
    rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: 1000 });
    const sub = rig.ctx.calls.find((c) => c[0] === 'fillText' && /Time slows down|Fruit only, no bombs|Points ×2/.test(c[1]));
    assert.ok(sub, `${id}: the subtitle is drawn`);
    // the plate (tier 2, 170 tall, drawn 214 tall so that the tier 3 gold underline does not strike through the subtitle; ink between 12 and 88 percent of it)
    // is drawn centred on the banner origin
    const plate = rig.ctx.calls.find((c) => c[0] === 'drawImage' && c[1] && c[1].height === 170 && c[1].width >= 900 && c[5] === 214);
    assert.ok(plate, `${id}: the ink plate is drawn`);
    const inkTop = plate[3] + 0.12 * plate[5];
    const inkBottom = plate[3] + 0.88 * plate[5];
    const baseline = sub[3];
    assert.ok(baseline - 26 > inkTop + 40, `${id}: subtitle top ${baseline - 26} is well inside the ink (top ${inkTop})`);
    assert.ok(baseline + 8 < inkBottom - 8, `${id}: subtitle bottom ${baseline + 8} keeps 8 px inside the ink bottom ${inkBottom}`);
    const name = rig.sprites.text({ text: { freeze: 'FREEZE!', frenzy: 'FRENZY!', double: 'DOUBLE!' }[id], style: 'banner110', size: 96, tint: { freeze: 'ice', frenzy: 'vermilion', double: 'gold' }[id], maxW: 900 });
    assert.ok(rig.indexOfImage(name.canvas) > 0, `${id}: the title is a baked banner text`);
  }
});

test('QA-06: behind the disconnect overlay the pause panel ("Paused", its buttons and tip) is not drawn', () => {
  const rig = makeRenderRig();
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.force('paused', { roundMode: 'classic' });
  h.step();
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: 0 });
  assert.ok(fillTexts(rig, 'Paused').length > 0, 'the pause panel shows its title on its own');
  h.view.overlay = 'disconnected';
  h.view.disc.phase = 'failed';
  rig.draw({ view: h.view, uiState: { ...h.ui.getState(), overlay: 'disconnected' }, snapshot: null, blade: makeBlade(), nowMs: 0 });
  assert.equal(fillTexts(rig, 'Paused').length, 0, 'no "Paused" title through the overlay');
  assert.equal(fillTexts(rig, 'Resume').length, 0);
  assert.ok(fillTexts(rig, 'Joy-Con disconnected').length > 0);
});

test('QA-06: the three disconnect buttons keep a gap and the panel border, the results buttons sit inside their panel', () => {
  const h = makeUiHarness();
  h.toPlaying('classic');
  h.ui.notify({ type: 'roundOver', result: roundResult() });
  h.advance(2000);
  const inside = (t, P) => t.y - t.h / 2 >= P.y - P.h / 2 + 20 && t.y + t.h / 2 <= P.y + P.h / 2 - 20;
  const res = screenTargets(h.view).filter((t) => t.id.startsWith('results.'));
  assert.equal(res.length, 2);
  for (const t of res) assert.ok(inside(t, RESULTS_PANEL), `${t.id} is inside the results panel with a 20 px margin`);
  // the break banner (y 742) does not touch the buttons (top 802)
  assert.ok(742 + 29 < res[0].y - res[0].h / 2 - 20);
  h.view.overlay = 'disconnected';
  h.view.disc.phase = 'failed';
  const disc = screenTargets(h.view);
  assert.equal(disc.length, 3);
  disc.forEach((t, i) => {
    assert.ok(inside(t, DISCONNECT_PANEL), `${t.id} is inside the disconnect panel`);
    if (i > 0) assert.ok(t.y - t.h / 2 - (disc[i - 1].y + disc[i - 1].h / 2) >= 12, `${t.id} keeps a gap of at least 12 px to the button above`);
  });
});

test('QA-06: the mode names no longer touch the lower edge of the menu fruit', () => {
  const rig = makeRenderRig();
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.advance(1500); // the menu entrance (fruit and names rise one after the other) has played
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: h.clock.now() });
  for (const m of MENU_MODES) {
    const name = rig.ctx.calls.find((c) => c[0] === 'fillText' && c[1] === { classic: 'Classic', arcade: 'Arcade', zen: 'Zen' }[m.id]);
    assert.ok(name, m.id);
    const capTop = name[3] - 52; // the headline font is 72 px: its capitals are about 52 px high
    assert.ok(capTop >= m.y + m.r + 14, `${m.id}: name top ${capTop} is 14 px or more below the fruit bottom ${m.y + m.r} (plus the 10 px bob)`);
  }
  // the record line stays above the buttons (top 925)
  const rec = rig.ctx.calls.find((c) => c[0] === 'fillText' && c[1] === 'Best: 0');
  assert.ok(rec[3] + 8 < 925 - 6);
});

test('R3-05: a toast sits between the tagline and the fruit on the menu (it used to land on the title), at y 200 elsewhere', () => {
  const menu = makeUiHarness();
  menu.toMenuWithSim();
  menu.ui.notify({ type: 'recentered', kind: 'manual' });
  menu.step();
  const rig = makeRenderRig();
  rig.draw({ view: menu.view, uiState: menu.ui.getState(), snapshot: null, blade: makeBlade(), nowMs: menu.clock.now() });
  const toast = fillTexts(rig, 'Crosshair recentered')[0];
  assert.ok(toast, 'the toast is drawn');
  assert.equal(toast[3], 302);
  const tagline = fillTexts(rig, 'Slice the fruit. Avoid the bombs.')[0];
  assert.ok(toast[3] - 32 > tagline[3] + 8, 'the pill starts below the tagline');
  assert.ok(toast[3] + 32 < MENU_MODES[0].y - MENU_MODES[0].r + 20, 'and ends just above the top of the fruit');
  const play = makeUiHarness();
  play.toPlaying('zen');
  play.ui.notify({ type: 'recentered', kind: 'manual' });
  play.step({ snapshot: makeSnapshot({ mode: 'zen', lives: null }) });
  const rig2 = makeRenderRig();
  rig2.draw({ view: play.view, uiState: play.ui.getState(), snapshot: makeSnapshot({ mode: 'zen', lives: null }), blade: makeBlade(), nowMs: play.clock.now() });
  assert.equal(fillTexts(rig2, 'Crosshair recentered')[0][3], 200);
});

test('QA-05: the mode name of the countdown is below the HUD band (no overlap with the timer ring and TIME) and below the toast row', () => {
  const rig = makeRenderRig();
  const h = makeUiHarness();
  h.toMenuWithSim();
  h.ui.force('playing', { roundMode: 'arcade' });
  h.ui.force('countdown', { roundMode: 'arcade' });
  h.advance(400);
  const snap = makeSnapshot({ mode: 'arcade', lives: null, timeLeft: 60, timeTotal: 60 });
  h.step({ snapshot: snap });
  rig.draw({ view: h.view, uiState: h.ui.getState(), snapshot: snap, blade: makeBlade(), nowMs: h.clock.now() });
  const name = fillTexts(rig, 'Arcade')[0];
  assert.ok(name, 'the mode name is drawn');
  assert.ok(name[3] - 52 > 190, `its top ${name[3] - 52} is below the HUD band (190)`);
  assert.ok(fillTexts(rig, 'TIME').length > 0, 'the timer label is still there');
});

test('QA-07: "Recalibrate" with the mouse provider answers with a toast instead of nothing; the simulator still starts its wizard', () => {
  const mouse = makeUiHarness();
  mouse.storage.setSafetyAck();
  mouse.ui.notify(providerFact('mouse', 'streaming'));
  mouse.ui.notify({ type: 'ready' });
  mouse.advance(600);
  mouse.clearRecords();
  assert.equal(mouse.ui.pointerClick(960, 975), true);
  assert.equal(mouse.view.toast.text, 'No calibration is needed with the mouse.');
  assert.equal(mouse.intentTypes().includes('startCalibration'), false);
  assert.equal(mouse.state().screen, 'menu');
  // the pause panel has the same button
  mouse.ui.force('playing', { roundMode: 'zen' });
  mouse.ui.notify(actionFact('pause'));
  mouse.advance(300);
  mouse.view.toast.text = null;
  mouse.ui.activate('pause.recalibrate');
  assert.equal(mouse.view.toast.text, 'No calibration is needed with the mouse.');
  assert.equal(mouse.intentTypes().includes('quickRecenter'), false);
  const sim = makeUiHarness();
  sim.toMenuWithSim();
  sim.advance(600);
  sim.ui.pointerClick(960, 975);
  assert.equal(sim.intentTypes().includes('startCalibration'), true);
});

test('QA-06: the small COMBO label is not drawn above the bonus when the combo banner already shows the word', () => {
  const rig = makeRenderRig();
  const snap = makeSnapshot();
  rig.fx.handleEvent({ seq: 1, t: 1, type: 'combo', phase: 'update', n: 3, swingId: 1, bonus: 0, x: 900, y: 480 });
  rig.fx.handleEvent(comboEvent({ n: 3, bonus: 30 }));
  const popup = rig.fx.popups.find((p) => p.active && p.text === '+30');
  assert.ok(popup);
  assert.equal(popup.label, null, 'the banner says COMBO x3!');
  const lone = makeRenderRig();
  lone.fx.handleEvent(comboEvent({ n: 3, bonus: 30 }));
  assert.equal(lone.fx.popups.find((p) => p.active && p.text === '+30').label, 'COMBO', 'with no banner before it, the label stays');
  void snap;
});
