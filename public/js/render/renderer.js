// Frame composition: draw order, interpolation, layers. OWNER: Presentation engineer.
// docs/architecture.md 8.5, docs/game-design.md 11.3:
//   background, stain layer, combo / power-up banners, halves, whole objects, telegraph triangles, particles, slash marks,
//   blade trail, HUD, score popups, toasts, cursor, full-screen overlays, panels and dim layers, cursor again on top of panels.
// The game layer (background .. slash marks, and the popups) shakes and zooms; the HUD, panels and the cursor do not. The
// blade trail also stays unshaken so that it never separates from the cursor (logged in docs/contract-notes.md).
//
// UNVERIFIED-ON-HARDWARE: the frame budget (60 fps at 1080p, step + draw <= 6 ms) is met by construction (no shadowBlur, no
// filter, no per-frame gradients or canvases, everything expensive pre-rendered) and by the tests with a fake context; the real
// GPU / compositor cost was not measured on the owner's MacBook.
//
// draw() changes no game or UI state and allocates no per-particle objects. No shadowBlur, no filter, no per-frame gradients:
// everything expensive lives in pre-rendered sprites (sprites.js).
//
// ART LAYER (docs/assets-integration.md 3 and 4, all optional): `assets` (the loader, default NULL_ASSETS) and `stage` (the layered
// backdrops, default none). With neither, or when a piece of art is missing, the frame is drawn exactly as before with the painted
// versions. Art additions in the game layer: the stage instead of the painted background, the sprite path (through sprites.js, same
// draw calls), the warning icon on telegraphs, the combo icon, the bomb explosion and the slice flash (bursts, after the particles),
// and in trail.js the brush and the cursor. The draw order of design 11.3 is unchanged.

import { NULL_ASSETS } from './assets.js';
import { BOMB_ART, COLORS, GOLDEN_ART, POWERUP_ART, fontString } from './palette.js';
import { TAU, clamp01, drawText, lerp, roundRectPath, starSubpath } from './draw-util.js';
import { easeOutCubic, easeOutExpo } from './ease.js';
import { BURST, PK } from './fx.js';
import { lightenHex } from './banner.js';
import { CONFIG } from '../game/config.js';
import { drawHud } from './hud.js';
import { applyLayoutToCanvas, applyPlayfieldTransform, computeLayout, letterboxBars } from './layout.js';
import { bombFuseTip, paintSparkle } from './painters.js';
import { stageIdFor } from './stage.js';
import { SCREEN_DRAWERS, drawConfirm, drawDisconnect, drawResumeCountdown } from '../ui/screens/index.js';
import { drawFocusRing, drawNavHint, drawPill } from '../ui/widgets.js';
import { t } from '../ui/strings.en.js';

const GAME_SCREENS = new Set(['countdown', 'playing', 'paused', 'results']);
/**
 * The screens that draw through the sprite cache's menu slots (sprites.menuFruit / sprites.menuHalf). The slots are released on the first frame
 * of any other screen. The countdown is in this set because its sliced mode fruit is drawn from menu-scale halves for about a second: releasing
 * the slots every frame there re-baked both halves (two canvases, about 2 MB each) on every frame of that animation (round 1 fix, contract-notes).
 */
const MENU_SLOT_SCREENS = new Set(['menu', 'tuning', 'countdown']);
const NO_TARGET = Object.freeze({ id: '', shape: 'rect', x: 0, y: 0, w: 0, h: 0, enabled: false });
const PROC_FUSE_TIP = Object.freeze(bombFuseTip(BOMB_ART.r)); // where the painted bomb's spark sits (art bombs carry their own fuseTip)
const MODE_IDS = Object.freeze({ classic: true, arcade: true, zen: true });

// art geometry (docs/assets-integration.md 3.5, 3.6)
const NO_SLASHES = Object.freeze([]);
const WARNING_BOX = 72; // logical box of the telegraph icon, its bottom edge sits at y 1064
const WARNING_BOTTOM = 1064;
const COMBO_BOX = 104; // logical box of the combo icon, centred 110 px inside the left end of the banner band
const COMBO_INSET = 110;
const FLASH_REF_W = 192; // the slice flash is baked at this logical width and scaled down to the cut's size
const ART_FX_DEFAULTS = Object.freeze({ explosionWidthInRadii: 8 });
const HOLD_CAP = 64; // objects and halves tracked for the render-side hit hold
const FONT_CHECK_EVERY = 30; // frames between two looks at the banner fonts' metrics

/** Draw a centred sprite entry ({canvas, size}) at (x, y) with rotation `rot`. */
export function drawSprite(ctx, sp, x, y, rot = 0, alpha = 1) {
  const prev = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prev * alpha;
  if (rot === 0) {
    ctx.drawImage(sp.canvas, x - sp.size / 2, y - sp.size / 2, sp.size, sp.size);
  } else {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(sp.canvas, -sp.size / 2, -sp.size / 2, sp.size, sp.size);
    ctx.restore();
  }
  if (alpha !== 1) ctx.globalAlpha = prev;
}

/**
 * @param {{canvas:any, ctx:any, sprites:any, fx:any, trail:any, config?:any}} deps
 */
export function createRenderer(deps) {
  const { canvas, ctx, sprites, fx, trail } = deps;
  // anything that is not a loader (missing members) counts as "no art"
  const assets = deps.assets && typeof deps.assets.has === 'function' && typeof deps.assets.meta === 'function' && typeof deps.assets.scaled === 'function' ? deps.assets : NULL_ASSETS;
  const stage = deps.stage ?? null;
  const artFx = { ...ART_FX_DEFAULTS, ...(assets.config?.fx ?? {}) };
  let layout = null;
  const anim = {
    scorePop: 1, lastScore: -1, popAge: 1e9, clockS: 0, badgeX: 0, badgeY: 0, badgeOn: false, badgeOutT: -1,
    pipN: 0, pipShown: 0, pipPop: 1e9, pipAlpha: 0, pipFade: 1e9, reduceMotion: false,
  };
  let view = null;
  const g = { ctx, v: null, fx, sprites, assets, snapshot: null, target: null, now: 0, density: 1, backdropArt: false, nightArt: false };
  const stats = { frames: 0, halfBlits: 0, stageFrames: 0, artBakes: 0, holdFrames: 0 };
  const popupOut = { alpha: 1, dy: 0, dx: 0, scale: 1 };
  const bannerOut = { alpha: 1, scale: 1 };
  const camera = { dx: 0, dy: 0, scale: 1, rot: 0 };
  const comboCache = { epoch: -1, n: -1, tier: -1, left: null, right: null, plate: null, plateKey: -1, dens: 0 };
  const hh = { active: false, remainingMs: 0, catchUp: 0 };
  const placed = { x: 0, y: 0, r: 0 };

  g.target = (id) => {
    const list = view ? view.targets : null;
    if (list) for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return NO_TARGET;
  };

  /**
   * Bake the effect texts and plates the first time a round could need them (banners, popups, plates), so that the first bomb or the first combo of a
   * session does not pay for ten small canvases in the middle of a frame. Runs once, from the first resize; a failure only means they are baked later.
   */
  let warmed = false;
  function warmEffects() {
    warmed = true;
    try {
      for (const tier of [2, 3, 4, 7]) {
        const size = fx.TIERS[tier].size;
        sprites.text({ text: 'COMBO', style: 'banner110', size, tint: 'paper' });
        for (let n = tier === 2 ? 2 : tier; n <= (tier === 7 ? 10 : tier === 4 ? 6 : tier); n++) sprites.text({ text: t('hud.combo', { n }).slice(t('hud.combo', { n }).indexOf('\u00d7')), style: 'banner110', size, tint: 'gold' });
        sprites.plate(tier, 1000);
      }
      sprites.text({ text: t('hud.bomb'), style: 'banner132', size: 160, tint: 'vermilion', maxW: 1500 });
      sprites.text({ text: t('results.title.gameover').toUpperCase(), style: 'banner132', size: 160, tint: 'vermilion', maxW: 1700 });
      sprites.text({ text: t('hud.timeUp').toUpperCase(), style: 'banner132', size: 160, tint: 'gold', maxW: 1700 });
      sprites.text({ text: t('hud.golden'), style: 'popup64', size: 72, tint: 'gold' });
      for (const f of CONFIG.fruits) {
        sprites.text({ text: `+${f.score}`, style: 'popup44', size: 48, fill: lightenHex(f.juice, 0.15) });
        sprites.text({ text: `+${f.score * 2}`, style: 'popup44', size: 48, tint: 'gold' });
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[joycon-ninja] the effect texts could not be pre-baked, they are baked when first needed', err);
    }
  }

  /** Recompute the canvas size and transform. Call on window resize and after a degrade-level change. */
  function resize(cssW, cssH, dpr, degradeLevel = 0) {
    layout = computeLayout({ cssW, cssH, dpr, degradeLevel });
    applyLayoutToCanvas(canvas, layout);
    if (!warmed) warmEffects();
    if (stage && !stageBroken && typeof stage.resize === 'function') {
      try {
        stage.resize(layout.k);
      } catch (err) {
        disableStage(err);
      }
    }
    return layout;
  }

  // ---------------------------------------------------------------- art (docs/assets-integration.md 2.7: scaled images are asked
  // for at bake time, when assets.generation or the density step changed, never per frame)
  const art = { gen: NaN, density: 0, warning: null, combo: null, explosion: null, flash: null, failures: 0 };

  function icon(id, box) {
    return assets.has(id) ? assets.scaled(id, box, box, art.density) : null;
  }

  /** The loader's scaled canvas of a tight fx crop, plus where its anchor and (for the flash) its streak axis lie on that canvas. */
  function fxArt(id, logicalW, withAxis) {
    if (!assets.has(id)) return null;
    const meta = assets.meta(id);
    const box = meta && meta.contentBox;
    if (!box || !(box.w > 0) || !(box.h > 0)) return null;
    const r = assets.scaled(id, logicalW, (logicalW * box.h) / box.w, art.density);
    if (!r || !r.canvas) return null;
    const a = meta.anchor && Number.isFinite(meta.anchor.x) && Number.isFinite(meta.anchor.y) ? meta.anchor : { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const k = r.w / box.w; // logical px per shipped px
    const e = { canvas: r.canvas, w: r.w, h: r.h, ax: (a.x - box.x) * k, ay: (a.y - box.y) * (r.h / box.h), axisAngle: 0, axisLen: r.w };
    if (withAxis && meta.axis && Number.isFinite(meta.axis.angleRad) && meta.axis.lengthPx > 0) {
      e.axisAngle = meta.axis.angleRad;
      e.axisLen = meta.axis.lengthPx * k;
    }
    return e;
  }

  function syncArt() {
    if (assets.isNull) return;
    const gen = assets.generation;
    if (gen === art.gen && g.density === art.density) return;
    art.gen = gen;
    art.density = g.density;
    stats.artBakes++;
    try {
      art.warning = icon('icon_warning', WARNING_BOX);
      art.combo = icon('icon_combo', COMBO_BOX);
      art.explosion = fxArt('fx_bomb_explosion', artFx.explosionWidthInRadii * BOMB_ART.r, false);
      art.flash = fxArt('fx_slice_flash', FLASH_REF_W, true);
    } catch (err) {
      art.failures++;
      art.warning = null;
      art.combo = null;
      art.explosion = null;
      art.flash = null;
      if (typeof console !== 'undefined') console.warn('[joycon-ninja] gameplay art could not be prepared, the painted versions are used', err);
    }
  }

  // ---------------------------------------------------------------- game layer pieces
  let bgSprite = null;
  let bgK = -1;
  function drawProceduralBackground() {
    if (layout.k !== bgK || !bgSprite) {
      bgSprite = sprites.background(layout.k);
      bgK = layout.k;
    }
    ctx.drawImage(bgSprite.canvas, -bgSprite.margin, -bgSprite.margin, bgSprite.w, bgSprite.h);
  }

  // The stage (docs 4.1): layered backdrop behind everything. A stage that throws is switched off for the session and the painted
  // background is used from then on: an asset problem must never freeze or blank the game.
  const stageView = { nowMs: 0, screen: 'menu', shakeX: 0, shakeY: 0, zoom: 1, reduceMotion: false };
  let stageBroken = false;
  let prefetched = '';
  function disableStage(err) {
    stageBroken = true;
    if (typeof console !== 'undefined') console.warn('[joycon-ninja] the stage backdrop failed, the painted background is used instead', err);
  }

  /** The menu cursor resting on a mode fruit warms that stage (docs 4.1). Only when the hovered mode changes, never per frame. */
  function prefetchHovered() {
    const id = view.screen === 'menu' ? (view.hover && view.hover.id) || (view.focus && view.focus.visible && view.focus.id) || '' : '';
    if (id === prefetched) return;
    prefetched = id;
    if (typeof id === 'string' && id.startsWith('menu.')) {
      const mode = id.slice(5);
      if (MODE_IDS[mode] === true && typeof stage.prefetch === 'function') stage.prefetch(mode);
    }
  }

  function drawBackground(snap) {
    g.backdropArt = false; // true when a stage layer (lanterns, bamboo, petals) is under this frame: the HUD gives its small labels a paper outline then
    g.nightArt = false; // true when that layer belongs to the night stage (menu, connect, settings ...): secondary text is drawn in ink (draw-util secondaryInk)
    if (stage && !stageBroken) {
      try {
        prefetchHovered();
        stageView.nowMs = g.now;
        stageView.screen = view.screen;
        stageView.shakeX = fx.shakeOffset.x;
        stageView.shakeY = fx.shakeOffset.y;
        stageView.zoom = fx.zoom.scale;
        stageView.reduceMotion = !!view.settings.reduceMotion;
        const wanted = stageIdFor(view.screen, snap ? snap.mode : view.roundMode);
        stage.setMode(wanted);
        const fallback = stage.needsFallback();
        if (fallback) drawProceduralBackground(); // the painted background stays under a stage that is still loading or fading in
        let drew = false;
        ctx.save();
        try {
          drew = !!stage.draw(ctx, stageView, 'back');
        } finally {
          ctx.restore();
        }
        if (drew) {
          stats.stageFrames++;
          g.backdropArt = true;
          g.nightArt = wanted === 'menu';
        } else if (!fallback) drawProceduralBackground(); // a stage that says it is ready but drew nothing must not leave a blank frame
        return;
      } catch (err) {
        disableStage(err);
      }
    }
    drawProceduralBackground();
  }

  function drawStains() {
    let any = false;
    for (const s of fx.splats) if (s.active) { any = true; break; }
    if (!any) return;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'multiply';
    for (const s of fx.splats) {
      if (!s.active) continue;
      const a = fx.splatAlpha(s);
      if (a <= 0.003) continue;
      const sp = s.ref ?? (s.ref = sprites.splat(fx.colorTable[s.color], s.variant, s.soot));
      ctx.globalAlpha = a;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.drawImage(sp.canvas, -s.size / 2, -s.size / 2, s.size, s.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }

  /** Hand-drawn gold streaks hanging on both screen edges (the edge accents of combo tier 3 and up). */
  function drawEdgeAccents() {
    for (const e of fx.edgeAccents) {
      if (!e.active) continue;
      const p = clamp01(e.age / e.dur);
      const a = e.still ? e.alpha * Math.sin(Math.PI * p) : e.alpha * (1 - p);
      if (a <= 0.01) continue;
      const sp = sprites.edgeStreak(COLORS.gold, e.side < 0);
      ctx.globalAlpha = a;
      ctx.drawImage(sp.canvas, e.side < 0 ? 0 : 1920 - sp.w, 110, sp.w, sp.h);
    }
    ctx.globalAlpha = 1;
  }

  /** Rebuild the baked pieces of the combo banner when the number, the tier, the density or the fonts changed (not per frame). */
  function syncComboArt(cb) {
    const epoch = sprites.textEpoch;
    const dens = art.combo ? 1 : 0;
    if (comboCache.epoch === epoch && comboCache.n === cb.n && comboCache.tier === cb.tier && comboCache.dens === dens) return;
    comboCache.epoch = epoch; comboCache.n = cb.n; comboCache.tier = cb.tier; comboCache.dens = dens;
    const size = fx.TIERS[cb.tier].size;
    const full = t('hud.combo', { n: cb.n });
    const cut = full.indexOf('\u00d7');
    const left = (cut > 0 ? full.slice(0, cut) : full).trim();
    const right = cut > 0 ? full.slice(cut) : '';
    comboCache.left = sprites.text({ text: left, style: 'banner110', size, tint: 'paper' });
    comboCache.right = right ? sprites.text({ text: right, style: 'banner110', size, tint: 'gold' }) : null;
    comboCache.plateKey = -1;
  }

  /** "COMBO x{n}!" on its ink plate (direction 2.2): behind the objects, above the decals, never below y 400. */
  function drawComboBanner(cb) {
    syncComboArt(cb);
    const L = comboCache.left;
    const R = comboCache.right;
    const gap = fx.TIERS[cb.tier].size * 0.22;
    const wl = L.textW;
    const wr = R ? R.textW : 0;
    let total = wl + (R ? gap + wr : 0);
    const fit = total > 1500 ? 1500 / total : 1; // the text shrinks to 1500 wide before the plate grows
    total *= fit;
    const ic = art.combo;
    const extra = ic ? 120 : 0;
    const plateW = Math.min(1700, Math.max(900, total + 180 + extra));
    const key = cb.tier * 100000 + Math.ceil(plateW / 20);
    if (comboCache.plateKey !== key) {
      comboCache.plate = sprites.plate(cb.tier, plateW);
      comboCache.plateKey = key;
    }
    const plate = comboCache.plate;
    ctx.save();
    // Tier 4 and up: plate and words fade in TOGETHER over 120 ms (squared, so the frames of the slam at 2.2x are nearly clear). This was a clip that
    // revealed the plate from the left while the words waited: at 2.2x it showed a hard black, textless slab over the score for 2 to 3 frames (final QA).
    ctx.globalAlpha = cb.reveal < 1 ? cb.alpha * cb.reveal * cb.reveal : cb.alpha;
    ctx.translate(960, 290);
    if (cb.rot !== 0) ctx.rotate(cb.rot);
    ctx.scale(cb.scale, cb.scale);
    const pw = plate.w;
    const ph = plate.h;
    ctx.drawImage(plate.canvas, -pw / 2, -ph / 2, pw, ph);
    const shift = ic ? 60 : 0;
    if (ic) ctx.drawImage(ic.canvas, -pw / 2 + 88 - ic.w / 2, -ic.h / 2, ic.w, ic.h);
    const x0 = -total / 2 + shift;
    const lw = (L.w * fit);
    ctx.drawImage(L.canvas, x0 + (wl * fit) / 2 - L.cx * fit, -L.cy * fit, lw, L.h * fit);
    if (R) {
      const cx = x0 + (wl + gap) * fit + (wr * fit) / 2;
      const k = fit * cb.numScale;
      ctx.drawImage(R.canvas, cx - R.cx * k, -R.cy * k, R.w * k, R.h * k);
    }
    ctx.restore();
  }

  function drawBanners() {
    const settings = view.settings;
    drawEdgeAccents();
    const cb = fx.comboBannerView();
    if (cb) drawComboBanner(cb);
    const pa = fx.powerupBannerAlpha();
    if (pa > 0) {
      const id = fx.powerupBanner.id;
      const rise = settings.reduceMotion ? 0 : (1 - easeOutCubic(clamp01(fx.powerupBanner.age / 0.2))) * 40;
      const plate = sprites.plate(2, 1000); // tier 2: tier 3 has a gold underline that struck through the subtitle (final QA)
      const tint = id === 'freeze' ? 'ice' : id === 'frenzy' ? 'vermilion' : id === 'double' ? 'gold' : 'paper';
      ctx.save();
      ctx.globalAlpha = pa;
      ctx.translate(960, 440 + rise);
      // the plate is 214 tall with its ink between 12 and 88 percent: title and subtitle sit inside that
      const ph = 214; // the tier 2 plate (170 tall) stretched to the height of tier 3, so that the subtitle clears the dry-brush line
      ctx.drawImage(plate.canvas, -plate.w / 2, -ph / 2, plate.w, ph);
      const name = sprites.text({ text: t(`hud.pu.${id}`), style: 'banner110', size: 96, tint, maxW: 900 });
      ctx.drawImage(name.canvas, -name.cx, -name.cy - 30, name.w, name.h);
      drawText(ctx, t(`hud.pu.${id}.sub`), 0, 52, { style: 'body', fill: COLORS.paperLight, align: 'center' });
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- render-side hit hold (direction 2.1)
  // On the frame a multi-cut `cut` event arrives, fx.hitHold() turns active for 40 to 60 ms: the objects and halves are drawn where they were drawn in
  // the PREVIOUS frame (positions and rotations kept in two preallocated sets of typed arrays, matched by id, at most 64), while the blade, the HUD
  // and every effect keep running live. Afterwards they ease from the held to the live position over 60 ms (oC). The game, the audio and the score
  // never see any of it. Draw only: it changes no state of the game or the UI.
  const prevKey = new Int32Array(HOLD_CAP);
  const prevX = new Float32Array(HOLD_CAP);
  const prevY = new Float32Array(HOLD_CAP);
  const prevR = new Float32Array(HOLD_CAP);
  let prevN = 0;
  const curKey = new Int32Array(HOLD_CAP);
  const curX = new Float32Array(HOLD_CAP);
  const curY = new Float32Array(HOLD_CAP);
  const curR = new Float32Array(HOLD_CAP);
  let curN = 0;
  const heldKey = new Int32Array(HOLD_CAP);
  const heldX = new Float32Array(HOLD_CAP);
  const heldY = new Float32Array(HOLD_CAP);
  const heldR = new Float32Array(HOLD_CAP);
  let heldN = 0;
  let wasHolding = false;

  /** Beginning of a frame's object pass: captures the held set when a hold has just started. */
  function beginHold(snap) {
    fx.hitHold(hh);
    curN = 0;
    if (hh.active && !wasHolding) {
      heldN = prevN;
      for (let i = 0; i < prevN; i++) { heldKey[i] = prevKey[i]; heldX[i] = prevX[i]; heldY[i] = prevY[i]; heldR[i] = prevR[i]; }
    }
    wasHolding = hh.active;
    if (hh.active) stats.holdFrames++;
    return !!snap;
  }

  /** The position and rotation to draw for an object or half with this key (id * 2, id * 2 + 1 for halves): held, easing back, or live. */
  function place(key, x, y, r, record = true) {
    if (record && curN < HOLD_CAP) { curKey[curN] = key; curX[curN] = x; curY[curN] = y; curR[curN] = r; curN++; }
    placed.x = x; placed.y = y; placed.r = r;
    if (!hh.active && hh.catchUp <= 0) return placed;
    for (let i = 0; i < heldN; i++) {
      if (heldKey[i] !== key) continue;
      const m = hh.active ? 0 : easeOutCubic(1 - hh.catchUp);
      placed.x = heldX[i] + (x - heldX[i]) * m;
      placed.y = heldY[i] + (y - heldY[i]) * m;
      placed.r = heldR[i] + (r - heldR[i]) * m;
      break;
    }
    return placed;
  }

  /** End of the frame's object pass: the positions drawn now become the "previous frame" unless a hold is running (then they stay the pre-hold ones). */
  function endHold() {
    if (hh.active) return;
    prevN = curN;
    for (let i = 0; i < curN; i++) { prevKey[i] = curKey[i]; prevX[i] = curX[i]; prevY[i] = curY[i]; prevR[i] = curR[i]; }
  }

  function drawHalves(snap) {
    const a = snap.alpha;
    for (const h of snap.halves) {
      const e = sprites.ensureHalf(h);
      const pl = place(h.id * 2 + 1, lerp(h.px, h.x, a), lerp(h.py, h.y, a), lerp(h.prot, h.rot, a));
      const x = pl.x;
      const y = pl.y;
      const rot = pl.r - e.rot0;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(e.canvas, -e.half, -e.half, e.size, e.size);
      ctx.restore();
      stats.halfBlits++;
    }
  }

  function drawGhostHalves() {
    for (const g of fx.ghosts) {
      if (!g.active) continue;
      const h = g.half;
      const e = sprites.ensureHalf(h);
      ctx.save();
      ctx.globalAlpha = fx.ghostAlpha(g);
      ctx.translate(h.x, h.y);
      ctx.rotate(h.rot - e.rot0);
      ctx.drawImage(e.canvas, -e.half, -e.half, e.size, e.size);
      ctx.restore();
    }
  }

  /** Twelve gold rays behind every Golden Apple on screen, turning 20 degrees per second (static with Reduce flashes or Reduce motion). */
  function drawGoldenRays(snap) {
    let rays = null;
    const still = view.settings.reduceFlash || view.settings.reduceMotion;
    for (const o of snap.objects) {
      if (o.kind !== 'golden') continue;
      if (!rays) rays = sprites.rays();
      const pl = place(o.id * 2, lerp(o.px, o.x, snap.alpha), lerp(o.py, o.y, snap.alpha), 0, false);
      const radius = o.r * 3.2;
      ctx.save();
      ctx.translate(pl.x, pl.y);
      if (!still) ctx.rotate(snap.tWorld * 20 * (Math.PI / 180));
      ctx.globalAlpha = view.settings.reduceFlash ? 0.7 : 1;
      ctx.drawImage(rays.canvas, -radius, -radius, radius * 2, radius * 2);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawObjects(snap) {
    const a = snap.alpha;
    const reduceFlash = view.settings.reduceFlash;
    const reduceMotion = view.settings.reduceMotion;
    const tw = snap.tWorld;
    for (const o of snap.objects) {
      const pl = place(o.id * 2, lerp(o.px, o.x, a), lerp(o.py, o.y, a), lerp(o.prot, o.rot, a));
      const x = pl.x;
      const y = pl.y;
      const rot = pl.r + (o.kind === 'bomb' ? fx.wobbleAngle(o.id) : 0);
      switch (o.kind) {
        case 'fruit':
          drawSprite(ctx, sprites.fruit(o.type), x, y, rot);
          break;
        case 'golden': {
          drawSprite(ctx, sprites.golden(), x, y, rot);
          const n = 3;
          for (let i = 0; i < n; i++) {
            const ang = reduceMotion ? (i * TAU) / n : (tw / 1.2) * TAU + (i * TAU) / n;
            paintSparkle(ctx, x + Math.cos(ang) * o.r * 1.28, y + Math.sin(ang) * o.r * 1.28, 12, GOLDEN_ART.shine);
          }
          break;
        }
        case 'bomb': {
          const bs = sprites.bomb();
          drawSprite(ctx, bs, x, y, rot);
          // pulsing danger ring (vermilion, radius 1.2 r, alpha 0.5 to 0.9 at 2 Hz; static with reduced flashing)
          ctx.beginPath();
          ctx.arc(x, y, o.r * 1.2, 0, TAU);
          if (g.backdropArt === true) {
            // over a stage backdrop the thin half-transparent ring vanished on the dark ridge and rooftops (art review round 1, M2): a paper
            // underlay and an opaque, thicker ring on top of it (the pulse is kept, between 0.9 and 1)
            ctx.lineWidth = 14;
            ctx.strokeStyle = COLORS.paperLight;
            ctx.globalAlpha = 0.85;
            ctx.stroke();
            ctx.lineWidth = 8;
            ctx.strokeStyle = BOMB_ART.ring;
            ctx.globalAlpha = reduceFlash ? 1 : 0.95 + 0.05 * Math.sin(tw * TAU * 2);
            ctx.stroke();
          } else {
            ctx.lineWidth = 6;
            ctx.strokeStyle = BOMB_ART.ring;
            ctx.globalAlpha = reduceFlash ? 0.7 : 0.7 + 0.2 * Math.sin(tw * TAU * 2);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          // fuse spark at the rope tip (rotates with the bomb): the art carries its own tip, the painted bomb uses painters.bombFuseTip
          const tip = bs.fuseTip ?? PROC_FUSE_TIP;
          const c = Math.cos(rot);
          const s = Math.sin(rot);
          const sx = x + tip.x * c - tip.y * s;
          const sy = y + tip.x * s + tip.y * c;
          const fl = reduceFlash ? 0.5 : 0.5 + 0.5 * Math.sin(tw * 41 + o.id);
          ctx.beginPath();
          ctx.arc(sx, sy, 9 + 3 * fl, 0, TAU);
          ctx.fillStyle = 'rgba(242,106,33,0.8)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(sx, sy, 5, 0, TAU);
          ctx.fillStyle = BOMB_ART.sparkCore;
          ctx.fill();
          break;
        }
        case 'powerup': {
          const art = POWERUP_ART[o.type];
          drawSprite(ctx, sprites.medallion(o.type), x, y, 0);
          const ringA = reduceFlash ? 0.475 : 0.475 + 0.125 * Math.sin(tw * TAU * 1.5);
          if (o.type === 'freeze') {
            ctx.beginPath();
            ctx.arc(x, y, o.r * 1.32, 0, TAU);
            ctx.lineWidth = 8;
            ctx.strokeStyle = art.color;
            ctx.globalAlpha = ringA;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          // eight small dots orbiting at 1.15 r, one turn per second (static with reduced motion)
          const base = reduceMotion ? 0 : tw * TAU;
          ctx.fillStyle = art.color;
          ctx.strokeStyle = COLORS.ink;
          ctx.lineWidth = 2.5;
          for (let i = 0; i < 8; i++) {
            const ang = base + (i * TAU) / 8;
            ctx.beginPath();
            ctx.arc(x + Math.cos(ang) * o.r * 1.15 * 1.12, y + Math.sin(ang) * o.r * 1.15 * 1.12, 5, 0, TAU);
            ctx.fill();
            ctx.stroke();
          }
          if (o.type === 'double') {
            for (let i = 0; i < 4; i++) {
              const ang = (reduceMotion ? 0 : -tw * TAU * 0.7) + (i * TAU) / 4 + 0.4;
              paintSparkle(ctx, x + Math.cos(ang) * o.r * 1.6, y + Math.sin(ang) * o.r * 1.6, 11, COLORS.gold);
            }
          }
          if (o.type === 'clock') {
            ctx.strokeStyle = art.color;
            ctx.lineWidth = 4;
            ctx.globalAlpha = reduceFlash ? 0.6 : 0.4 + 0.4 * (0.5 + 0.5 * Math.sin(tw * TAU));
            for (let i = 0; i < 12; i++) {
              const ang = (i * TAU) / 12;
              ctx.beginPath();
              ctx.moveTo(x + Math.cos(ang) * o.r * 1.3, y + Math.sin(ang) * o.r * 1.3);
              ctx.lineTo(x + Math.cos(ang) * o.r * 1.42, y + Math.sin(ang) * o.r * 1.42);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }
          break;
        }
        default:
          break;
      }
    }
  }

  function drawTelegraphs(snap) {
    const reduceFlash = view.settings.reduceFlash;
    const warn = art.warning;
    for (const tg of snap.telegraphs) {
      const pulse = reduceFlash ? 1 : 1 + 0.12 * Math.sin((tg.remainingMs / 1000) * TAU * 3);
      ctx.save();
      if (warn) {
        // the art icon (a bomb in a triangle keeps the silhouette cue), bottom edge on y 1064, pulsing about its base
        ctx.translate(tg.x, WARNING_BOTTOM);
        ctx.scale(pulse, pulse);
        ctx.drawImage(warn.canvas, -warn.w / 2, -warn.h, warn.w, warn.h);
        ctx.restore();
        continue;
      }
      ctx.translate(tg.x, 1040);
      ctx.scale(pulse, pulse);
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(24, 20);
      ctx.lineTo(-24, 20);
      ctx.closePath();
      ctx.fillStyle = COLORS.vermilion;
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = COLORS.ink;
      ctx.stroke();
      drawText(ctx, '!', 0, 14, { font: fontString('small'), fill: COLORS.paperLight, align: 'center' });
      ctx.restore();
    }
  }

  function drawParticles() {
    const p = fx.particles;
    const table = fx.colorTable;
    const puff = sprites.puff(COLORS.inkSoft);
    let lastColor = -1;
    ctx.lineCap = 'round';
    for (let i = 0; i < p.capacity; i++) {
      if (!p.alive[i]) continue;
      const k = p.kind[i];
      const lifeFrac = p.life[i] / p.maxLife[i];
      const x = p.x[i];
      const y = p.y[i];
      const sz = p.size[i];
      if (k === PK.SMOKE) {
        // a soft ink puff growing from 24 to 90 px while it fades from 0.55 to 0
        const r = (24 + 66 * (1 - lifeFrac)) * sz;
        ctx.globalAlpha = 0.55 * lifeFrac;
        ctx.drawImage(puff.canvas, x - r, y - r, r * 2, r * 2);
        continue;
      }
      let alpha;
      if (k === PK.SPARK || k === PK.EMBER || k === PK.DUST || k === PK.SNOW) alpha = lifeFrac;
      else alpha = Math.min(1, lifeFrac / 0.4);
      ctx.globalAlpha = alpha;
      const ci = p.color[i];
      if (ci !== lastColor) {
        ctx.fillStyle = table[ci];
        ctx.strokeStyle = table[ci];
        lastColor = ci;
      }
      switch (k) {
        case PK.DROPLET:
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, TAU);
          ctx.fill();
          if (sz >= 5) {
            // a thin ink rim so that a droplet does not vanish into the paper grain
            ctx.globalAlpha = alpha * 0.45;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = COLORS.ink;
            ctx.stroke();
            ctx.strokeStyle = table[ci];
          }
          break;
        case PK.EMBER:
        case PK.DUST:
        case PK.FLECK_CIRCLE:
          ctx.beginPath();
          ctx.arc(x, y, sz, 0, TAU);
          ctx.fill();
          break;
        case PK.SNOW:
          ctx.beginPath();
          ctx.arc(x, y, sz * 0.6, 0, TAU);
          ctx.fill();
          break;
        case PK.FLECK_SQ:
          ctx.fillRect(x - sz, y - sz, sz * 2, sz * 2);
          break;
        case PK.SPARK:
        case PK.STREAK: {
          const vx = p.vx[i];
          const vy = p.vy[i];
          const sp = Math.hypot(vx, vy) || 1;
          const len = sp * 0.03;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - (vx / sp) * len, y - (vy / sp) * len);
          ctx.lineWidth = k === PK.STREAK ? sz * 1.6 : 3;
          ctx.stroke();
          break;
        }
        case PK.STAR:
          ctx.beginPath();
          starSubpath(ctx, x, y, sz, sz * 0.3, 4, p.rot[i]);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = COLORS.ink;
          ctx.stroke();
          ctx.strokeStyle = table[ci];
          break;
        case PK.SHARD:
        case PK.ICE: {
          const r = p.rot[i];
          const c = Math.cos(r) * sz;
          const s = Math.sin(r) * sz;
          ctx.beginPath();
          ctx.moveTo(x + c, y + s);
          ctx.lineTo(x - s * 0.5, y + c * 0.5);
          ctx.lineTo(x - c, y - s);
          ctx.lineTo(x + s * 0.5, y - c * 0.5);
          ctx.closePath();
          ctx.fill();
          break;
        }
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
  }

  /**
   * Art bursts (docs 3.6): the bomb explosion, the slice flash and the Golden Apple rays, after the particles. Without the explosion art a painted
   * fireball (two soft puffs) takes its place, so that ?assets=0 keeps the bomb's centre of gravity. Nothing is drawn for a missing flash picture
   * (the slash lines are its fallback).
   */
  const burstOut = { scale: 1, alpha: 1, rot: 0 };
  function drawBursts(flashPass) {
    const list = fx.bursts;
    if (!list) return;
    const ex = art.explosion;
    const fl = art.flash;
    let drawn = false;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b.active || (b.kind === BURST.SLICE) !== flashPass) continue;
      const v = fx.burstView(b, burstOut);
      if (v.alpha <= 0.003) continue;
      if (b.kind === BURST.EXPLOSION) {
        if (ex) {
          const k = (b.size / ex.w) * v.scale;
          ctx.globalAlpha = v.alpha;
          ctx.drawImage(ex.canvas, b.x - ex.ax * k, b.y - ex.ay * k, ex.w * k, ex.h * k);
        } else {
          const r = (b.size / 2) * v.scale;
          ctx.globalAlpha = v.alpha * 0.9;
          const o = sprites.puff(COLORS.flame);
          ctx.drawImage(o.canvas, b.x - r, b.y - r, r * 2, r * 2);
          const q = sprites.puff(COLORS.flameInner);
          ctx.globalAlpha = v.alpha;
          ctx.drawImage(q.canvas, b.x - r * 0.55, b.y - r * 0.55, r * 1.1, r * 1.1);
        }
      } else if (b.kind === BURST.RAYS) {
        const rays = sprites.rays();
        const r = b.size * v.scale;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(v.rot);
        ctx.globalAlpha = v.alpha;
        ctx.drawImage(rays.canvas, -r, -r, r * 2, r * 2);
        ctx.restore();
      } else {
        if (!fl) continue;
        // uniform scale so that the streak's own length equals the cut's slash length (2.6 r), turned onto the blade direction, growing 0.6 to 1
        const k = (b.size / fl.axisLen) * v.scale;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle - fl.axisAngle);
        ctx.globalAlpha = v.alpha;
        ctx.drawImage(fl.canvas, -fl.ax * k, -fl.ay * k, fl.w * k, fl.h * k);
        ctx.restore();
      }
      drawn = true;
    }
    if (drawn) ctx.globalAlpha = 1;
  }

  function drawSlashesAndRings() {
    for (const r of fx.rings) {
      if (!r.active || r.age < 0) continue;
      const p = clamp01(r.age / r.dur);
      const radius = r.still ? r.r1 : r.r0 + (r.r1 - r.r0) * easeOutExpo(p);
      const w = r.still ? r.w0 : r.w0 + (r.w1 - r.w0) * p;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, radius), 0, TAU);
      ctx.lineWidth = w;
      ctx.strokeStyle = r.ramp[Math.min(r.ramp.length - 1, (p * r.ramp.length) | 0)];
      ctx.globalAlpha = r.still ? r.alpha * (1 - p ** 4) : r.alpha * (1 - p);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    for (const s of fx.slashes) {
      if (!s.active) continue;
      const c = Math.cos(s.angle);
      const sn = Math.sin(s.angle);
      if (!art.flash) {
        // the slash lines are the fallback of the slice flash art
        const a = s.alpha * (1 - s.age / s.dur);
        ctx.beginPath();
        ctx.moveTo(s.x - c * s.len * 0.5, s.y - sn * s.len * 0.5);
        ctx.lineTo(s.x + c * s.len * 0.5, s.y + sn * s.len * 0.5);
        ctx.globalAlpha = a;
        ctx.lineWidth = 11;
        ctx.strokeStyle = COLORS.ink;
        ctx.stroke();
        ctx.lineWidth = 5;
        ctx.strokeStyle = COLORS.paperLight;
        ctx.stroke();
      }
      if (s.core) {
        // the paper-white core line: 3 r long, 0.16 r wide, alpha 0.9 to 0 in 90 ms (none with Reduce flashes)
        const a = fx.FX.coreAlpha * (1 - clamp01(s.age / (fx.FX.coreMs / 1000)));
        if (a > 0.01) {
          const half = fx.FX.coreLenR * s.r * 0.5;
          ctx.beginPath();
          ctx.moveTo(s.x - c * half, s.y - sn * half);
          ctx.lineTo(s.x + c * half, s.y + sn * half);
          ctx.globalAlpha = a;
          ctx.lineWidth = fx.FX.coreWidthR * s.r;
          ctx.strokeStyle = COLORS.paperLight;
          ctx.stroke();
        }
      }
    }
    ctx.lineCap = 'butt';
    ctx.globalAlpha = 1;
  }

  /** Score popups (direction 2.3): baked text sprites, popped, risen and faded by fx.popupView. */
  function drawPopups() {
    const epoch = sprites.textEpoch;
    for (const p of fx.popups) {
      if (!p.active) continue;
      if (p.ref === null || p.refEpoch !== epoch) {
        p.ref = sprites.text(p.tint ? { text: p.text, style: p.style, size: p.size, tint: p.tint } : { text: p.text, style: p.style, size: p.size, fill: p.fill });
        p.labelRef = p.label ? sprites.text({ text: p.label, style: 'popupLabel', size: 28, tint: 'gold' }) : null;
        p.refEpoch = epoch;
      }
      const pv = fx.popupView(p, popupOut);
      if (pv.alpha <= 0.004) continue;
      const e = p.ref;
      ctx.save();
      ctx.globalAlpha = pv.alpha;
      ctx.translate(p.x + pv.dx, p.y + pv.dy);
      if (pv.scale !== 1) ctx.scale(pv.scale, pv.scale);
      if (p.labelRef) {
        const lr = p.labelRef;
        const ly = -p.size * 0.95 - 22;
        roundRectPath(ctx, -lr.textW / 2 - 18, ly - 21, lr.textW + 36, 42, 21);
        ctx.fillStyle = 'rgba(20,20,28,0.92)';
        ctx.fill();
        ctx.drawImage(lr.canvas, -lr.cx, ly - lr.cy, lr.w, lr.h);
      }
      ctx.drawImage(e.canvas, -e.cx, -e.cy, e.w, e.h);
      ctx.restore();
    }
  }

  /** The slam banners (BOMB!): drawn over the objects at the bomb's position, with the popups' shake. */
  function drawSlamBanners() {
    const epoch = sprites.textEpoch;
    for (const b of fx.banners) {
      if (!b.active || b.age < 0) continue;
      if (b.ref === null || b.refEpoch !== epoch) {
        b.ref = sprites.text({ text: b.text, style: 'banner132', size: b.size, tint: b.tint, maxW: 1500 });
        b.refEpoch = epoch;
      }
      const v = fx.bannerView(b, bannerOut);
      if (v.alpha <= 0.004) continue;
      const e = b.ref;
      ctx.save();
      ctx.globalAlpha = v.alpha;
      ctx.translate(b.x, b.y);
      ctx.scale(v.scale, v.scale);
      ctx.drawImage(e.canvas, -e.cx, -e.cy, e.w, e.h);
      ctx.restore();
    }
  }

  /** GAME OVER / TIME'S UP! slamming in at the middle of the playfield (only while the round screen is up: the results panel has its own title). */
  function drawEndBanner() {
    const eb = fx.endBanner;
    if (!eb.active) return;
    const v = fx.endBannerView(bannerOut);
    if (v.alpha <= 0.004) return;
    const epoch = sprites.textEpoch;
    if (!eb.ref || eb.refEpoch !== epoch || eb.refText !== eb.text) {
      eb.ref = sprites.text({ text: eb.text, style: 'banner132', size: 160, tint: eb.tint, maxW: 1700 });
      eb.refEpoch = epoch;
      eb.refText = eb.text;
    }
    const e = eb.ref;
    ctx.save();
    ctx.globalAlpha = v.alpha;
    ctx.translate(960, 540);
    ctx.scale(v.scale, v.scale);
    ctx.drawImage(e.canvas, -e.cx, -e.cy, e.w, e.h);
    ctx.restore();
  }

  /** The ring that leaves the blade head on every cut (radius 30 to 60, alpha 0.6 to 0 over 0.5 s). */
  function drawCutPulses() {
    const cur = trail.cursor;
    if (!cur || !cur.visible) return;
    for (const c of fx.cutPulses) {
      if (!c.active) continue;
      const p = clamp01(c.age / (fx.FX.cutPulseMs / 1000));
      ctx.beginPath();
      ctx.arc(cur.x, cur.y, 30 + 30 * easeOutCubic(p), 0, TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = COLORS.paperLight;
      ctx.globalAlpha = (view.settings.reduceFlash ? 0.3 : 0.6) * (1 - p);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawToast() {
    const tt = view.toast;
    if (!tt.text) return;
    const left = tt.until - view.now;
    const age = view.now - tt.from;
    const a = clamp01(Math.min(age / 150, left / 250));
    // y 200 is free on the game screens; on the menu it would land on the title and the tagline (R3-05), so it sits between the
    // tagline and the mode fruit there
    drawPill(ctx, 960, view.screen === 'menu' ? 302 : 200, tt.text, { style: 'body', alpha: a, h: 64, maxW: 1500 });
  }

  function drawOverlays() {
    for (const f of fx.flashes) {
      if (!f.active || f.alpha <= 0.002) continue;
      ctx.globalAlpha = f.alpha;
      ctx.fillStyle = f.color;
      ctx.fillRect(0, 0, 1920, 1080);
    }
    for (const vg of fx.vignettes) {
      if (!vg.active || vg.alpha <= 0.002) continue;
      ctx.globalAlpha = vg.alpha;
      const sp = sprites.vignette(vg.color);
      ctx.drawImage(sp.canvas, 0, 0, 1920, 1080);
    }
    const am = fx.ambient;
    if (am.frost > 0.004) {
      ctx.globalAlpha = am.frost;
      ctx.drawImage(sprites.vignette(COLORS.ice).canvas, 0, 0, 1920, 1080);
    }
    if (am.warm > 0.004) {
      // Frenzy: a warm orange edge vignette (no full-screen fill)
      ctx.globalAlpha = am.warm;
      ctx.drawImage(sprites.vignette(COLORS.flame).canvas, 0, 0, 1920, 1080);
    }
    if (am.slow > 0.004) {
      // slow-motion treatment: a cool indigo edge vignette that eases in and out with the world time scale
      ctx.globalAlpha = am.slow * 2.2;
      ctx.drawImage(sprites.vignette(COLORS.indigo).canvas, 0, 0, 1920, 1080);
    }
    if (am.dim > 0.004) {
      ctx.globalAlpha = am.dim;
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(0, 0, 1920, 1080);
    }
    ctx.globalAlpha = 1;
  }

  function drawDebug(frame) {
    const snap = frame.snapshot;
    ctx.save();
    ctx.font = '600 22px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lines = [
      `fps ${frame.perf.fps ? frame.perf.fps.toFixed(0) : '-'}  frame ${frame.perf.avgFrameMs ? frame.perf.avgFrameMs.toFixed(1) : '-'} ms  degrade ${frame.perf.degradeLevel}`,
      `stage ${snap ? snap.stage : '-'}  wave ${snap ? snap.waveIndex : '-'}  objs ${snap ? snap.objects.length : 0}  halves ${snap ? snap.halves.length : 0}`,
      `blade ${Math.round(frame.blade.speed)} px/s  T ${Math.round(frame.blade.cutThreshold)}  ${frame.blade.cutting ? 'CUT' : 'idle'}`,
      `particles ${fx.particles.count}  splats ${fx.activeCounts().splats}  step+draw ${frame.stepDrawMs !== undefined ? frame.stepDrawMs.toFixed(2) : '-'} ms`,
    ];
    lines.forEach((l, i) => {
      ctx.fillStyle = 'rgba(20,20,28,0.75)';
      ctx.fillRect(10, 700 + i * 30, ctx.measureText(l).width + 16, 28);
      ctx.fillStyle = '#7CFC9A';
      ctx.fillText(l, 18, 722 + i * 30);
    });
    if (snap) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,200,90,0.9)';
      ctx.fillStyle = 'rgba(0,120,60,0.95)';
      ctx.font = '600 18px ui-monospace, Menlo, monospace';
      for (const o of snap.objects) {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.hitR, 0, TAU);
        ctx.stroke();
        ctx.fillText(String(o.id), o.x - 8, o.y + 6);
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- frame
  /**
   * @param {{view:object, uiState:object, snapshot:object|null, blade:object, nowMs:number, perf:object, debug:boolean}} frame
   */
  function draw(frame) {
    if (!layout) return;
    stats.frames++;
    view = frame.view;
    g.v = view;
    g.snapshot = frame.snapshot;
    g.now = frame.nowMs;
    g.density = Math.min(2, Math.max(1, Math.ceil(layout.k * 2) / 2)); // sprite density step for big sprites (menu fruit)
    syncArt();
    if (stats.frames % FONT_CHECK_EVERY === 1 && typeof sprites.checkFonts === 'function' && sprites.checkFonts()) warmEffects(); // a web font arriving changes the baked texts
    if (!MENU_SLOT_SCREENS.has(frame.view.screen)) sprites.releaseMenu();
    const { screen, overlay } = view;
    const snap = frame.snapshot;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    applyPlayfieldTransform(ctx, layout);

    const showGame = !!snap && (GAME_SCREENS.has(screen) || (screen === 'calibration' && view.cal.step === 4));
    const cam = fx.cameraView(camera);
    const sh = fx.shakeOffset;

    // ---- game layer (shakes, zooms and tilts a little with the biggest hits)
    ctx.save();
    if (cam.scale !== 1 || cam.dx !== 0 || cam.dy !== 0 || cam.rot !== 0) {
      ctx.translate(960 + cam.dx, 540 + cam.dy);
      if (cam.rot !== 0) ctx.rotate(cam.rot);
      ctx.scale(cam.scale, cam.scale);
      ctx.translate(-960, -540);
    }
    drawBackground(snap);
    if (showGame) {
      drawStains();
      drawBanners();
      beginHold(snap);
      drawGoldenRays(snap);
      drawHalves(snap);
      drawGhostHalves();
      drawObjects(snap);
      endHold();
      drawTelegraphs(snap);
      drawParticles();
      drawBursts(false);
      drawSlashesAndRings();
    }
    ctx.restore();

    // ---- trail (never shakes: it must stay attached to the cursor)
    const trackVisible = screen !== 'boot' && screen !== 'safety' && screen !== 'connect';
    if (trackVisible) {
      trail.draw(ctx, g.density);
      if (showGame) drawCutPulses();
    }

    // ---- HUD (never shakes)
    if (showGame && (screen === 'playing' || screen === 'paused' || screen === 'countdown')) drawHud(g, anim);

    // ---- popups and the slam banners share the game layer's shake
    if (showGame) {
      // the slice flashes sit on top of the blade and the HUD (they are brief), under the same camera as the game layer
      ctx.save();
      if (cam.scale !== 1 || cam.dx !== 0 || cam.dy !== 0 || cam.rot !== 0) {
        ctx.translate(960 + cam.dx, 540 + cam.dy);
        if (cam.rot !== 0) ctx.rotate(cam.rot);
        ctx.scale(cam.scale, cam.scale);
        ctx.translate(-960, -540);
      }
      drawBursts(true);
      ctx.restore();
      ctx.save();
      ctx.translate(sh.x, sh.y);
      drawSlamBanners();
      drawPopups();
      ctx.restore();
    }

    // toasts sit at (960, 200): never over the safety / connect / calibration screens, whose own texts live there
    if (screen !== 'boot' && screen !== 'safety' && screen !== 'connect' && screen !== 'calibration' && !overlay) drawToast();

    // ---- ambient overlays: flashes, vignettes, frost, slow-motion, dim
    drawOverlays();

    // ---- screens and panels (paper dim layers behind the panels)
    if (screen === 'paused') {
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(0, 0, 1920, 1080);
      ctx.globalAlpha = 1;
    } else if (screen === 'results') {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(0, 0, 1920, 1080);
      ctx.globalAlpha = 1;
    }
    const drawer = SCREEN_DRAWERS[screen];
    // behind the disconnect overlay the pause panel is not reachable: its title and tip must not show through (QA-06)
    if (drawer && !(overlay === 'disconnected' && screen === 'paused')) drawer.draw(g);
    if (screen === 'playing' && view.resuming) drawResumeCountdown(g);
    if (fx.endBanner.active && screen === 'playing') drawEndBanner();
    if (overlay) {
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = COLORS.paper;
      ctx.fillRect(0, 0, 1920, 1080);
      ctx.globalAlpha = 1;
      if (overlay === 'disconnected') drawDisconnect(g);
      else if (overlay === 'confirm') drawConfirm(g);
    }

    // ---- the focus ring and the hint line of the menus (over the panels and dialogs, under the cursor)
    drawFocusRing(ctx, view);
    drawNavHint(ctx, view);

    // ---- cursor (again on top of any open panel)
    if (trackVisible && !frame.uiState.systemCursor) trail.drawCursor(ctx, g.density);

    if (frame.debug) drawDebug(frame);

    // ---- letterbox bars, identity transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.ink;
    for (const b of letterboxBars(layout)) ctx.fillRect(b.x, b.y, b.w, b.h);
  }

  /** Advance the renderer's own cosmetic animations (score pop). Called from Presentation.step(), never from draw(). */
  function advance(snapshot, dtS, settings) {
    if (snapshot) {
      if (snapshot.score !== anim.lastScore) {
        if (anim.lastScore >= 0 && snapshot.score > anim.lastScore) anim.popAge = 0;
        anim.lastScore = snapshot.score;
      }
    } else {
      anim.lastScore = -1;
    }
    anim.popAge += dtS;
    anim.scorePop = settings.reduceMotion ? 1 : 1 + 0.12 * Math.max(0, 1 - anim.popAge / 0.16);
    // HUD cosmetics: the Double badge's breathing and pop-out clocks, the combo meter's pips
    anim.clockS += dtS;
    anim.reduceMotion = !!settings.reduceMotion;
    if (anim.badgeOutT >= 0) anim.badgeOutT += dtS;
    const cb = snapshot && snapshot.combo ? snapshot.combo : null;
    const cn = cb ? cb.n : 0;
    if (cb && cb.open && cn >= 2) {
      if (cn > anim.pipN) anim.pipPop = 0;
      anim.pipShown = Math.min(cn, 10);
      anim.pipFade = 0;
      anim.pipAlpha = 1;
    } else {
      anim.pipFade += dtS;
      anim.pipAlpha = clamp01(1 - anim.pipFade / 0.25);
    }
    anim.pipN = cn;
    anim.pipPop += dtS;
    // the blade takes the look of the running power-up, and its sparks and shards advance with the step (never from draw())
    if (typeof trail.setAura === 'function') trail.setAura(fx.auraView());
    if (typeof trail.tick === 'function') trail.tick(dtS, settings);
  }

  return {
    resize, draw, advance, getLayout: () => layout, stats, anim,
    /** The draw context object handed to the screens (`g.assets`, `g.density`, ...): for the tests of the UI kit and of the art layer. */
    drawContext: g,
    /** Which art pieces of the renderer are baked right now (plain booleans, tests and the debug overlay). */
    artState: () => ({ warning: !!art.warning, combo: !!art.combo, explosion: !!art.explosion, flash: !!art.flash, stage: !!stage && !stageBroken, failures: art.failures }),
  };
}
