// Shared checks of the UI-kit art tests: the table of every button of the game with its labels, a scene's drawn geometry, and the free-space
// assertion (a picture overlaps no target and no text). OWNER: UI-kit engineer. Used with the seed metadata and, when the build tool has
// written public/assets/manifest.json, with the real measured numbers (test/ui/art-manifest.test.js).
import assert from 'node:assert/strict';
import { deriveConnectModel } from '../../public/js/ui/connect-model.js';
import { STRINGS, t } from '../../public/js/ui/strings.en.js';
import { createArtStub } from './art-stub.js';
import { makeSpriteStub, runScene } from './art-scenes.js';
import { WIDTH_FACTOR, circleHitsRect, inside, overlaps, readDrawn, targetRect } from './art-geometry.js';
import { providerFact } from './fixtures.js';

export const FIELD = { x: 0, y: 0, w: 1920, h: 1080 };
const S = (n) => STRINGS[n];

/** The labels a connect-screen button can show, gathered from the model over a matrix of provider states, probes and browsers. */
function connectLabels() {
  const main = new Set([t('connect.continue')]);
  const mainNative = new Set([t('connect.continue')]);
  const secondary = new Set();
  const fallback = new Set();
  const cancel = new Set();
  const statuses = [null, 'idle', 'requesting', 'connecting', 'initializing', 'streaming', 'lost', 'error'];
  const errors = [null, { code: 'cancelled', message: 'm', retryable: true, at: 0 }, { code: 'cooldown', message: 'm', retryable: true, at: 0 }, { code: 'gatt_failure', message: 'm', retryable: true, at: 0 }];
  for (const state of statuses) {
    for (const error of errors) {
      for (const transport of ['bluetooth', 'native']) {
        for (const probe of ['unknown', 'checking', 'available', 'unavailable']) {
          for (const hasBluetooth of [true, false]) {
            for (const preferred of [null, 'chrome', 'native']) {
              for (const cooldownUntil of [null, 12_000, 190_000]) {
                const provider = state === null ? null : { kind: 'joycon', transport, status: providerFact('joycon', state, { error, cooldownUntil, failures: cooldownUntil === 190_000 ? 9 : 0 }).status };
                const m = deriveConnectModel(provider, 2000, { hasBluetooth, bridge: { probe, reason: null }, preferred, progress: null });
                (m.native ? mainNative : main).add(m.buttonText);
                if (m.secondary.show) secondary.add(m.secondary.text);
                if (m.showFallback) fallback.add(m.fallbackText);
                if (m.cancel) cancel.add(m.cancelText);
              }
            }
          }
        }
      }
    }
  }
  return { main: [...main], mainNative: [...mainNative], secondary: [...secondary], fallback: [...fallback], cancel: [...cancel] };
}

export const CONNECT = connectLabels();

/**
 * Every button of the game: [target id, target size, inset, style (undefined = the height rule), labels, glyph height or 0].
 * Sizes are those of layout-data.js (checked against screenTargets below), inset and style those of the screens.
 */
export const BUTTONS = [
  ['safety.ok', 520, 120, 0, undefined, [S('safety.ok'), S('safety.wait')], 0],
  ['connect.main', 520, 130, 0, undefined, CONNECT.main, 0],
  ['connect.main (native)', 720, 120, 0, undefined, CONNECT.mainNative, 0],
  ['connect.continue', 520, 130, 0, undefined, [S('connect.continue')], 0],
  ['connect.secondary', 800, 72, 6, 'buttonSmall', CONNECT.secondary, 0],
  ['connect.fallback', 640, 84, 6, 'buttonSmall', CONNECT.fallback, 0],
  ['connect.fallback (native)', 800, 72, 6, 'buttonSmall', CONNECT.fallback, 0],
  ['connect.cancel', 400, 72, 6, 'buttonSmall', CONNECT.cancel, 0],
  ['connect.sim', 400, 100, 8, 'buttonSmall', [S('connect.alt.sim')], 64],
  ['connect.mouse', 400, 100, 8, 'buttonSmall', [S('connect.alt.mouse')], 64],
  ['connect.back', 260, 72, 0, 'buttonSmall', [S('settings.back')], 0],
  ...['menu.settings', 'menu.recalibrate', 'menu.connection'].map((id) => [id, 400, 100, 8, 'buttonSmall', [S(id)], 0]),
  ...['pause.resume', 'pause.recalibrate', 'pause.settings', 'pause.quit'].map((id) => [id, 620, 120, 0, undefined, [S(id)], 0]),
  ['set.reset', 400, 100, 0, 'buttonSmall', [S('settings.reset')], 0],
  ['set.tune', 400, 100, 0, 'buttonSmall', [S('settings.tune')], 0],
  ['set.back', 400, 100, 0, 'buttonSmall', [S('settings.back')], 0],
  ['tune.defaults', 400, 100, 0, 'buttonSmall', [S('tune.defaults')], 0],
  ['tune.back', 400, 100, 0, 'buttonSmall', [S('settings.back')], 0],
  ['cal.flip', 560, 70, 0, 'buttonSmall', [S('cal.flipX.button')], 0],
  ['cal.quick', 500, 70, 0, 'buttonSmall', [S('cal.quick')], 0],
  ['cal.retry', 400, 100, 0, undefined, [S('cal.retry')], 0],
  ['results.again', 380, 120, 0, undefined, [S('results.again')], 0],
  ['results.menu', 380, 120, 0, undefined, [S('results.menu')], 0],
  ['confirm.yes', 380, 100, 0, 'buttonSmall', [S('pause.confirm.yes'), S('settings.reset.yes')], 0],
  ['confirm.no', 380, 100, 0, 'buttonSmall', [S('pause.confirm.no'), S('settings.reset.no')], 0],
  ['disc.retry', 620, 84, 0, 'buttonTiny', [S('disc.retry'), S('disc.native.retry'), t('disc.wait', { s: 10 }), t('disc.native.wait', { s: 10 })], 0],
  ['disc.mouse', 620, 84, 0, 'buttonTiny', [S('disc.useMouse')], 0],
  ['disc.menu', 620, 84, 0, 'buttonTiny', [S('disc.menu')], 0],
  ['disc.cancel', 620, 84, 0, 'buttonTiny', [S('connect.native.cancel')], 0],
];

/** Draw a scene with the stub art (conservative text widths) and read back what it drew: images, texts and the targets of its view. */
export function geometry(name, o = {}) {
  const r = runScene(name, { assets: createArtStub(), widthFactor: WIDTH_FACTOR, sprites: makeSpriteStub({ withHalves: true }), ...o });
  const drawn = readDrawn(r.calls);
  const targets = r.view.targets ?? [];
  return { ...r, ...drawn, targets };
}

/** Assert that an image rectangle overlaps no target (except `own`) and no text box (except the ones passed in `ignoreText`). */
export function assertFree(name, im, g, { own = null, ignoreText = [] } = {}) {
  assert.ok(inside(im, FIELD), `${name} ${im.id}: inside the playfield`);
  for (const tg of g.targets) {
    if (tg.id === own) continue;
    const hit = tg.shape === 'circle' ? circleHitsRect(tg, im) : overlaps(im, targetRect(tg));
    assert.equal(hit, false, `${name}: ${im.id} overlaps the target ${tg.id}`);
  }
  for (const tx of g.texts) {
    if (tx.rotated || ignoreText.includes(tx.text)) continue;
    assert.equal(overlaps(im, tx), false, `${name}: ${im.id} (${Math.round(im.x)},${Math.round(im.y)},${Math.round(im.w)}x${Math.round(im.h)}) overlaps the text "${tx.text}" (${Math.round(tx.x)},${Math.round(tx.y)},${Math.round(tx.w)}x${Math.round(tx.h)})`);
  }
}

