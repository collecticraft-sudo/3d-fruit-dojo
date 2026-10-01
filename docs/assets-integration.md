# 3D Fruit Dojo: art integration contract

| Item | Value |
|---|---|
| Version | 1.0 (contract freeze for five engineers working in parallel on disjoint files) |
| Author role | Architect of the art integration |
| Audience | Asset engineer, Gameplay-renderer engineer, Stage engineer, UI-kit engineer, Copy engineer, the Integrator (later), QA |
| Inputs | `design/higgsfield-brief.md` (PHASE 1 and PHASE 2 RESULTS), `design/assets.csv`, `design/sprites|fx|icons|ui|backgrounds/`, `docs/architecture.md` (sections 2, 8, 12), `docs/game-design.md` (sections 9, 11, 12), `docs/contract-notes.md` |
| Skeleton files written with this document | `public/js/render/art-config.js` (final), `public/js/render/assets.js` (final `NULL_ASSETS`, inert `createAssets`), `public/js/render/stage.js` (final `stageIdFor`, `veilFor`, `STAGE_IDS`, inert `createStage`) |

> **HARDWARE HONESTY.** Nobody can test the real Joy-Con 2. This document says nothing about how the controller behaves. Every number below marked "seed" or "estimate" (file sizes, memory, frame cost) was NOT measured in a browser on the owner's Mac; the Asset engineer and QA measure them and correct this document. The measurements that ARE stated as measured (sprite bounding boxes, body circles, plate positions) come from pixel analysis of the files in `design/` on 2026-09-30.

---

## 0. Principles (read first)

1. **Optional everywhere.** Every sprite, layer and UI image is optional. A missing file, a failed decode, a timeout, a not-yet-loaded group, or `?assets=0` all mean: the existing procedural drawing runs unchanged. With no assets the game must draw exactly what it draws today, and the 1199 existing tests must stay green without touching a stub.
2. **The art is a skin, never game state.** Collision radii, hit boxes, timings and the deterministic fixed-step logic do not change. Nothing in `game/`, `motion/`, `input/` or `shared/` imports the art modules (guard test in section 8).
3. **Same entry points, new insides.** The renderer keeps drawing centred sprite entries `{canvas, half, size}` (`drawSprite`, HUD `blit`). The art is baked once into those same entries (section 3), so `renderer.js` draw code barely changes.
4. **No allocation in hot paths.** Everything scaled is created once per size and device-pixel step and cached (section 2.6). Nobody calls `assets.scaled/sliced` inside a per-frame loop without caching the returned object (section 2.7).
5. **Lazy layers.** Sprites and UI images (group `core`) load at boot. Stage layers load per stage, on demand.
6. **Offline.** Everything is under `public/assets/`, same origin, no CDN, no external host. The CSP already allows `img-src 'self'`.
7. **Accessibility unchanged.** Reduce flashing, Reduce motion, sound, the 28 px minimum text size, the 84 px minimum target size and silhouette-distinct fruit keep working (each section says how).
8. **Honest naming.** Asset ids equal the ids of `design/assets.csv` and the file base names of `design/`, so every shipped file traces back to a Higgsfield job.
9. **Title.** The player-visible name is "3D Fruit Dojo" everywhere (section 7). Folder, package name, `window.__ninja`, URL flags and `joyconNinja.*` storage keys stay.
10. **Ports.** Servers started by the engineers use only the port given in their role. Never stop or restart servers you did not start (8200 and 8210 belong to the owner). Never run a test or script that deletes or rewrites `public/` or `design/` in place (the build tool writes only `public/assets/`, section 1.1).

---

## 1. Asset pipeline and delivery (owner: Asset engineer)

### 1.1 Build tool

`tools/build-assets.mjs`, Node 22+, no npm dependencies, ffmpeg through `child_process.execFile` (argument arrays, never a shell string). It reads `design/` and writes ONLY inside `public/assets/` (it creates the folder, and rewrites its own outputs; it never deletes anything outside `public/assets/` and never touches `design/`).

| Command | Effect |
|---|---|
| `node tools/build-assets.mjs` | Build everything: transcode, measure, write `manifest.json` and `PROVENANCE.csv`. Deterministic: the same `design/` gives byte-identical output (no timestamps in any output file). |
| `node tools/build-assets.mjs --check` | Rebuild into a temp folder and compare with `public/assets/` (used by a test that skips when ffmpeg or `design/` is missing). Exit 1 on any difference. |
| `node tools/build-assets.mjs --measure` | Print the measured `body`, `contentBox`, `label`, `axis` values of every asset and the differences to `tools/asset-spec.mjs`. |
| `node tools/build-assets.mjs --layer-width 1920` | Fallback ladder for weight (section 1.7): mid and near layers at 1920 x 1080. |

`tools/asset-spec.mjs` is the single data table (id, source file, kind, group, target size, format, per-asset extras). Values that a human decides (body table, slice margins, label insets, the `ship: false` flag) live there; everything measurable (`contentBox`, `bytes`, `width`, `height`, stage luminance) is computed.

ffmpeg rules: sprites `-frames:v 1 -compression_level 9 -pred mixed`, scaling `flags=lanczos`. Scaling an RGBA image with a transparent background can leave dark or light fringes; the tool must scale in premultiplied alpha (`format=gbrap,premultiply=inplace=1,scale=...,unpremultiply=inplace=1,format=rgba` or an equivalent measured to be fringe-free) and the Asset engineer checks a sprite on a light and a dark ground after the first build. Far layers: `-q:v 4 -pix_fmt yuvj420p -huffman optimal` (baseline JPEG, no progressive). If ffmpeg is missing the tool exits with a clear message; the game never needs ffmpeg (the output is committed).

### 1.2 Output folder

Committed to the project so that the game runs without ffmpeg:

```
public/assets/
  manifest.json          the machine-readable index (1.4)
  PROVENANCE.csv         one row per shipped file, links to design/assets.csv and the Higgsfield job (1.8)
  sprites/               fruit_<id>_whole|half_a|half_b, fx_splash_<id>, bomb_whole, medallion_<id>     (PNG)
  fx/                    fx_bomb_explosion, fx_slice_flash, fx_blade_trail_tex                            (PNG)
  icons/                 icon_*, glyph_*                                                                    (PNG)
  ui/                    button_*, stepper_*, toggle_*, panel_9slice, timer_ring, cursor_*, logo_title     (PNG)
  backgrounds/           bg_<stage>_far (JPEG), bg_<stage>_mid, bg_<stage>_near (PNG)
```

File name = design id + extension: `sprites/fruit_apple_whole.png`, `backgrounds/bg_classic_far.jpg`. `stage` is one of `classic`, `arcade`, `zen`, `menu`.

### 1.3 Formats and sizes

| Kind | Ids | Shipped size (px) | Format | Notes |
|---|---|---|---|---|
| Fruit whole, halves, bomb, medallions | `fruit_<id>_whole|half_a|half_b` (11 fruit incl. `golden`), `bomb_whole`, `medallion_freeze|frenzy|double|clock` | 512 x 512 | PNG RGBA | Unchanged canvas (re-encoded). At density 2 the biggest fruit are drawn about 1:1. |
| Juice splash | `fx_splash_<id>` (10 fruit + `golden`) | 384 x 384 | PNG RGBA | Baked into a 320 px stain canvas (3.2). |
| FX | `fx_bomb_explosion`, `fx_slice_flash`, `fx_blade_trail_tex` | width 768, 768, 1024; height keeps the aspect (696, 408, 156) | PNG RGBA | Tight crops, kept tight. |
| Icons and glyphs | `icon_life_full|life_empty|combo|trophy|warning|freeze|frenzy|double|clock`, `glyph_joycon_l|joycon_r|mouse|keyboard_enter|sync_button` | 256 x 256 | PNG RGBA | Largest use is 96 logical px (192 px at density 2). |
| Buttons, toggles | `button_primary_*`, `button_secondary_*`, `toggle_off|on|focused` | width 840, height as in `design/ui/` | PNG RGBA | Unchanged. Heights differ per state (halo), see 5.1. |
| Steppers | `stepper_minus|plus_<state>` | width 336, height as in `design/ui/` | PNG RGBA | Unchanged. |
| Panel | `panel_9slice` | 512 x 512 | PNG RGBA | From 1024 x 1023; nine-slice margins 48 px (5.4). |
| Timer ring, cursors | `timer_ring`, `cursor_idle`, `cursor_cutting` | unchanged (512 x 508, 256 x 261, 256 x 269) | PNG RGBA | |
| Logo | `logo_title` | 1400 x 714 | PNG RGBA | From 1600 x 816. |
| Far layer | `bg_<stage>_far` | 2560 x 1440 | JPEG (opaque) | About 0.3 to 0.5 MB each (estimate). |
| Mid and near layers | `bg_<stage>_mid`, `bg_<stage>_near` | 2048 x 1152 | PNG RGBA | About 1.5 to 2 MB each (estimate). Brief allows 2560 x 1440 at most; 2048 keeps weight and decode memory down and these layers are soft scenery. |
| Not shipped | `meter_bar` | | | Its red marker triangle is baked in at 61 percent, the game's threshold marker moves; the procedural meters stay (`ship: false` in the spec, still listed in `PROVENANCE.csv` with `shipped=no`). |

`contentBox` is always measured on the SHIPPED file (alpha at least 24 of 255). Raw sheets in `design/phase0|1|2` are provenance only and are never read by the tool.

### 1.4 `manifest.json`

```jsonc
{
  "version": 1,
  "generator": "tools/build-assets.mjs",
  "designCsvSha256": "<sha256 of design/assets.csv>",
  "totalBytes": 0,                       // sum of every shipped file (excluding manifest.json and PROVENANCE.csv)
  "budget": { "totalBytes": 41943040, "fileBytes": 3145728 },
  "groups": {                            // ordered id lists = the preload order (2.3)
    "core": ["logo_title", "..."],
    "stage:classic": ["bg_classic_far", "bg_classic_mid", "bg_classic_near"],
    "stage:arcade": ["..."], "stage:zen": ["..."], "stage:menu": ["..."]
  },
  "stages": {                            // measured on the composed far+mid+near layers, 0..1 relative luminance
    "classic": { "centreLuma": 0.81, "edgeLuma": 0.74 }
  },
  "assets": [ { /* one entry per shipped file, schema below */ } ]
}
```

Entry schema (all sizes and coordinates in SHIPPED-file pixels, origin top-left, y down):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Design id (= file base name). Unique. |
| `file` | string | yes | Path relative to `public/assets/`, for example `sprites/fruit_apple_whole.png`. |
| `kind` | string | yes | `fruit`, `half`, `splash`, `bomb`, `medallion`, `fx`, `icon`, `glyph`, `ui`, `logo`, `layer`. |
| `group` | string | yes | `core` or `stage:<id>`. |
| `width`, `height`, `bytes` | int | yes | Shipped file. `bytes` is the exact file size. |
| `contentBox` | `{x,y,w,h}` | yes | Bounding box of alpha at least 24 (whole canvas for JPEG layers). |
| `anchor` | `{x,y}` | yes | Pivot: where the object centre lands, and the rotation pivot. Fruit wholes, `golden`, `bomb`, medallions: the body centre (`body.cx`, `body.cy`). Cursors: the aim dot centre. Everything else: the centre of `contentBox`. |
| `body` | `{cx,cy,r}` | fruit wholes, bomb, medallions, cursors | The circle that corresponds to the collision radius. Scale of the object on screen = `radius / body.r` (3.1). |
| `halfScale` | number | halves | Multiplier on the whole's scale for this half. 1 except golden (0.91). |
| `ref` | string | UI state variants | Id of the DEFAULT state; all states of a widget are scaled with the default's factors (5.1). |
| `slice` | `{l,r,t,b,scale?}` | buttons, panel | Nine-slice or three-slice margins in shipped px (`t = b = 0` means horizontal three-slice). `scale` (panel only) = logical px per shipped px, 0.5. |
| `label` | `{l,r,t,b}` | buttons, toggles | Safe text rectangle as insets from the REFERENCE contentBox, in shipped px (5.2). Toggles use `cells` instead. |
| `cells` | `[{x,y,w,h},{x,y,w,h}]` | toggles | The two cell interiors as fractions (0..1) of the contentBox. |
| `ring` | `{cx,cy,outer,bandMid,bandHalf,hole}` | `timer_ring` | Geometry of the donut in shipped px (5.5). |
| `axis` | `{angleRad,lengthPx}` | `fx_slice_flash` | Principal axis of the streak (PCA of alpha) and its length. |
| `points` | object | `bomb_whole` | `fuseTip: {x,y}`, the spark centre. |

`tools/asset-spec.mjs` seeds the human-decided values (Appendix A). The tool writes the manifest in a stable key order. `manifest.json` is plain JSON, scanned by the English-only guard, so ids and text stay English.

### 1.5 Body table (which circle is "the fruit")

The art canvases are normalised (every fruit is about 385 px tall in 512), while the game fruit radii run from 48 to 92 logical px. So each whole carries a `body` circle and the game scales every fruit by `radius / body.r`.

* `body.cx, cy, r` are MEASURED by `--measure` with this algorithm (the seeds of Appendix A were produced with it): mask = alpha at least 200; morphological opening with a disc of radius 40 px (removes stems, leaves, crown spikes, the fuse); `cx, cy` = centroid of the opened mask; `r` = radius of the circle with the same area as the opened mask; then `r` is divided by the per-fruit `fit` of `tools/asset-spec.mjs` (1 for round fruit; 0.86 pineapple, 0.92 pear, 0.93 lemon, 0.95 kiwi, 0.95 strawberry) so that tall fruit are drawn a little smaller and their visible body stays close to the hit circle. The manifest stores the divided value.
* The Asset engineer renders one debug sheet (`node tools/build-assets.mjs --overlay <dir>`, written OUTSIDE `public/`, for example in the scratchpad) that draws each fruit at its game size with the collision circle on top, on paper and on dark, and adjusts `fit` if a fruit visibly overflows its circle by more than about 15 percent. The manifest value is normative once committed.

### 1.6 The golden apple and its glow ring

`fruit_golden_whole` includes a glow ring and four small sparkles, so `contentBox` is almost the whole canvas (11, 2, 489, 508) while the fruit body is inside it. Rules:

* `body` of `fruit_golden_whole` is measured with a different algorithm: the largest 8-connected component of dark ink pixels (rgb below 70, alpha at least 200) is the apple outline; the body mask is the outline plus everything it encloses (flood fill from outside); then the same opening (radius 40) and area-equivalent radius. Seed: `cx 257, cy 262, r 172`.
* The sprite entry built by `sprites.golden()` sizes its canvas from `contentBox` (so the glow and sparkles are NOT clipped) and scales by `64 / 172` (`GOLDEN_ART.r / body.r`). The golden apple therefore renders with a body radius of 64 logical px and a glow up to about 93 logical px, as the procedural glow ring (1.5 r) did.
* The golden HALVES show the cut face without a glow and are 14 percent larger than the whole's body when both sit on a 512 canvas at the same scale; `fruit_golden_half_a|b` carry `halfScale: 0.91` (seed, `172 / 189` from the measured half body radius) so that they match the whole.
* The collision radius (64) and every game number stay as they are.

### 1.7 Size budget

| Budget | Value | Enforced by |
|---|---|---|
| `public/assets/` total (images only) | 40 MB (41 943 040 bytes) hard cap; target about 35 MB (estimate) | manifest test |
| One file | 3 MB (3 145 728 bytes) | manifest test |
| Decoded core group (gameplay sprites, fx, icons, UI kit, logo) | about 75 MB steady state (estimate: 512 x 512 x 4 bytes = 1 MB per sprite) | Asset engineer measures in Chrome and records in `docs/assets.md` |
| One decoded stage | about 34 MB (far 2560 x 1440 x 4 = 14.7 MB, mid and near 2048 x 1152 x 4 = 9.4 MB each) plus one pre-composed canvas of at most 2560 x 1440 (14.7 MB) | same |
| Peak during a stage crossfade | at most two stages resident (about 100 MB) | `maxResidentStages` in `art-config.js` |

If the first build is over budget the tool falls back automatically in this order and prints what it did: mid and near to 1920 x 1080, then far JPEG quality 5, then sprite halves to 448 px. Nothing else is negotiable without a note in `docs/contract-notes.md`.

### 1.8 Provenance

`public/assets/PROVENANCE.csv` (UTF-8, comma separated, quoted where needed, header row):

`id,file,shipped,source_file,source_sha256,shipped_sha256,bytes,width,height,higgsfield_job_ids,model,csv_source`

* One row for EVERY image row of `design/assets.csv` (103 rows), including the one with `shipped=no` (`meter_bar`).
* `source_file`: the path under `design/` (for example `design/sprites/fruit_apple_whole.png`). `source_sha256` and `shipped_sha256` make a silent replacement of an input visible.
* `higgsfield_job_ids`: every 36-character job id found in the `source` column of `design/assets.csv` for that id, separated by `;`. `model`: `gpt_image_2_5` when the source column says so. `csv_source`: the `source` column verbatim.
* `manifest.json` carries `designCsvSha256`. A test compares every row with `design/assets.csv` (skipped, not passed, when `design/` is absent).
* Audio rows of `design/assets.csv` (20) stay a wish list and are not part of this contract; the game keeps synthesising every sound.

### 1.9 Server changes (`server.js`)

* `MIME`: add `.jpg` and `.jpeg` (`image/jpeg`) and `.csv` (`text/csv; charset=utf-8`). `.png` and `.json` exist.
* Caching: paths under `/assets/` are served with `Cache-Control: no-cache` and a weak `ETag` (`W/"<size>-<mtimeMs>"`); a matching `If-None-Match` answers `304` with the same security headers and no body. Every other path keeps `Cache-Control: no-store`. `HEAD` behaves like `GET` without a body. The path checks (root escape, symlink escape, directory listing) are unchanged.
* The server console text says "3D Fruit Dojo" (section 7). The health body `{"ok":true,"name":"joycon-ninja"}` and the `X-Joycon-Ninja` header do NOT change (`start.command` and the tests depend on them).
* Tests for all of this live in `test/server/` (Asset engineer edits `server.test.js` for it).

### 1.10 `art-config.js`

`public/js/render/art-config.js` is data only and already written (see the file). Consumers do NOT import it directly except `assets.js` and `stage.js`; everything else reads the same object through `assets.config` (so tests inject their own). Keys: `baseUrl`, `loader`, `glyphs` (9.1), `stage` (4), `fx` (3.6, 3.7). No number in it is used by game logic.

---

## 2. Loader API (`public/js/render/assets.js`, owner: Asset engineer)

The file exists as a skeleton with the final export names. The Asset engineer replaces the body of `createAssets` and keeps: `createAssets`, `NULL_ASSETS`.

### 2.1 Factory

```js
createAssets({
  baseUrl = ART_CONFIG.baseUrl,          // string, joined with entry.file. Tests pass '/assets/'.
  fetch = globalThis.fetch,              // (url) => Promise<{ok:boolean, status:number, json():Promise<any>}>; used for manifest.json only
  createImage = () => new Image(),       // () => {src, decoding?, onload, onerror, decode?():Promise, width, height, naturalWidth?, naturalHeight?}
  createCanvas,                          // (w, h) => canvas; without it scaled() and sliced() return null
  createBitmap,                          // optional (blob) => Promise<ImageBitmap>; default the global createImageBitmap. With it the loader FETCHES every file and decodes it into a bitmap it can close() on release (no <img> element, so nothing lingers in the browser's image caches: measured 5 MB per stage switch kept for good with <img>, flat with bitmaps). null forces the <img> route (createImage), which is also the route without createImageBitmap and the one the Node tests use.
  setTimeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout,
  now = () => performance.now(),
  config = ART_CONFIG,
  manifest,                              // optional parsed manifest object: skips the fetch (tests)
}) => Assets
```

No top-level access to `window`, `document`, `Image`, `fetch` (architecture rule 6): defaults are read inside the function with `typeof` guards. If `fetch` or `createImage` is unavailable the assets object behaves like `NULL_ASSETS` after the first `load()`.

### 2.2 The `Assets` object

| Member | Semantics |
|---|---|
| `isNull` | `false` (`true` on `NULL_ASSETS`). |
| `config` | The config object in use. |
| `generation` | Integer, increases every time the set of usable images changes (an image became ready, a group was released). Consumers cache their baked objects and re-bake when `generation` differs from the value they saw (2.7). |
| `load(group, opts?)` | `Promise<{group, state, loaded, failed, total}>`, NEVER rejects. First call fetches the manifest (once), then loads the group's ids in manifest order with `config.loader.concurrency` parallel loads. Same promise while loading, resolves at once when the group is already done. `state`: `ready` (all loaded), `partial` (some failed), `failed` (none loaded, or the manifest failed), `disabled` (null implementation). `opts.priority: 'low'` yields to normal loads. Unknown group: resolves `failed` with `total: 0`. |
| `prefetch(group)` | `load(group, {priority:'low'})`, result ignored. |
| `release(group)` | Drops the decoded images of a group (references cleared, scaled-cache entries of those ids purged, state `released`), increases `generation`, emits `release`. A later `load(group)` loads it again. Never called on `core`. |
| `get(id)` | The drawable (an `Image`, `ImageBitmap` or, in tests, a stub with `width` and `height`), or `null` when the id is unknown, not loaded, failed or released. |
| `has(id)` | `get(id) !== null`. Cheap; safe to call every frame. |
| `meta(id)` | The manifest entry (frozen) once the manifest is loaded, even when the image is not ready; `null` before that or for an unknown id. |
| `ids(group?)` | Ordered ids of a group (or all). Empty before the manifest is loaded. |
| `scaled(id, boxW, boxH, density = 1, opts?)` | `{canvas, w, h, density}` or `null`. `boxW`, `boxH` are LOGICAL px. `opts.fit: 'contain'` (default) fits the `contentBox` into the box keeping the aspect (`s = min(boxW / box.w, boxH / box.h)`), `'stretch'` fills exactly. The returned canvas holds only the content box, `ceil(w * density)` by `ceil(h * density)` px, `w = box.w * s`. Draw it CENTRED on the point where the content should be centred: `ctx.drawImage(r.canvas, cx - r.w / 2, cy - r.h / 2, r.w, r.h)`. |
| `sliced(id, w, h, density = 1)` | `{canvas, w, h, density}` or `null`. Composes a nine-slice or three-slice image (uses `meta(id).slice`). `w`, `h` are the LOGICAL size of the REFERENCE frame (the default state's contentBox, `meta(id).ref ?? id`). Scale factor `s = h / refBox.h` for three-slice (`slice.t = 0`), `s = slice.scale` (0.5) for nine-slice; if `w < (l + r) * s` the caps shrink so that they fit. The returned size is `w' = w + (box.w - refBox.w) * s`, `h' = box.h * s` (a focused state with a halo comes out slightly bigger than the default, as designed). Draw it centred on the target centre. Returns `null` when `slice` is missing. |
| `status()` | `{manifest: 'idle'\|'loading'\|'ready'\|'failed', groups: {[name]: {state, loaded, failed, total}}, generation}`. Plain data, safe for a loading indicator and for `window.__ninja`. |
| `on(type, fn)` | Returns an unsubscribe function. Handlers run synchronously; an exception in one is isolated (use `shared/emitter.js`). Events below. |
| `dispose()` | Cancels timers, drops everything, ignores later loads. |

`NULL_ASSETS` implements all of it inertly (`has` false, `get`, `meta`, `scaled`, `sliced` null, `load` resolves `state: 'disabled'`, `on` returns a no-op unsubscribe).

### 2.3 Groups and preload order

| Group | Contents | Loaded |
|---|---|---|
| `core` | Every non-layer asset: UI kit and logo first, then wholes, halves, splashes, bomb, medallions, fx, icons, glyphs. Order in the manifest: `logo_title`, `panel_9slice`, `button_primary_*`, `button_secondary_*`, `cursor_*`, `stepper_*`, `toggle_*`, `timer_ring`, `fruit_watermelon_whole`, `fruit_orange_whole`, `fruit_pear_whole` and their halves (the menu fruit and the countdown split), then the other 8 fruit (catalogue order: pineapple, apple, peach, lemon, kiwi, strawberry, cherry, golden) with halves, `bomb_whole`, `medallion_*`, `fx_splash_*`, `fx_*`, `icon_*`, `glyph_*`. | At boot. The Integrator waits for it at most `loader.bootWaitMs` (2.5 s) before starting; it keeps loading in the background. |
| `stage:menu` | `bg_menu_far|mid|near` | Automatically right after `core` finishes. |
| `stage:classic`, `stage:arcade`, `stage:zen` | the three layers of that stage | On demand: `stage.prefetch(mode)` when the menu cursor rests on a mode fruit, and `stage.setMode(mode)` when a round begins. Never all at once at boot. |

### 2.4 Failure and timeout behaviour

* Manifest: `manifestTimeoutMs` (4 s). Fetch error, bad status, invalid JSON, `version !== 1`, or a missing `assets` array: `status().manifest = 'failed'`, every `load()` resolves `failed`, everything stays procedural. No automatic retry (the page reload is the retry).
* Image: `imageTimeoutMs` (15 s) for `core`, `layerTimeoutMs` (30 s) for layers. Load error, timeout, a decode rejection, or a decoded size different from `entry.width x entry.height` marks that id failed (`has(id)` false), emits `asset {id, ok:false}` and continues with the rest. A failed id is not retried.
* One `console.warn` per failed group (English text, prefix `[joycon-ninja]`), never per image, never per frame.
* Nothing throws out of the loader; nothing awaits it inside the frame loop; a slow or dead disk cannot freeze or blank the game.

### 2.5 Events

`on('manifest', {ok})`, `on('asset', {id, ok})`, `on('progress', {group, loaded, failed, total})` (after every asset of a group), `on('group', {group, state, loaded, failed, total})` (when a group settles), `on('release', {group})`. A loading indicator reads `status()` or listens to `progress`. The boot screen draws a thin progress bar and the word already in `strings.en.js` (`boot.loading`) from `g.assets.status().groups.core`; there is no new string.

Consumers that bake art (`sprites.js`, `stage.js`) subscribe to `group` and `release` themselves and rebuild lazily.

### 2.6 Scaled-sprite cache

* Key: `id|boxW x boxH|density|fit` (or `id|w x h|density|slice`). Value: a canvas of `ceil(w * density)` by `ceil(h * density)` px created with the injected `createCanvas`.
* Callers pass a STEPPED density, the same step everywhere: `Math.min(2, Math.max(1, Math.ceil(k * 2) / 2))` with `k = layout.k` (device pixels per logical pixel). So the cache holds at most three variants per size.
* Downscaling by more than 2x is done in halving steps with `imageSmoothingQuality = 'high'` (a one-shot drawImage from 512 down to 100 px aliases).
* Limits: `scaledCacheMaxEntries` (160) and `scaledCacheMaxBytes` (64 MB, estimated as `w * h * density^2 * 4`); least recently used entries go first. A `release` purges the entries of the released ids; `dispose` clears all.
* The cache is an optimisation of `assets.js` for UI, HUD and cursor images. Fruit, halves, bomb, medallions and splashes are baked by `sprites.js` into its own entries (3.1) and do not use it.

### 2.7 Rules for consumers (nobody breaks these)

1. Call `scaled()` and `sliced()` at bake time, resize, or when `assets.generation` or the density step changed; keep the returned object in a variable or a field. A call per frame allocates a key string.
2. Every use is `const a = assets.get(id)` or `assets.has(id)` first; when it is falsy, draw the procedural version, in the same frame, with no visible gap.
3. Never store a drawable across a `release` (compare `generation`).
4. Never let art change layout numbers, target rectangles or timings.

---

## 3. Sprite drawing conventions (owner: Gameplay-renderer engineer)

Files: `sprites.js` bakes, `renderer.js` draws, `fx.js` keeps one-shot fx state, `trail.js` draws the trail and cursor, `painters.js` and `palette.js` stay as the fallback. All of it works when `assets` is null or empty.

Constructor options (final): `createSprites({createCanvas, density, assets})`, `createTrail({config, assets})`, `createFx({config})`, `createRenderer({canvas, ctx, sprites, fx, trail, assets, stage})`. `assets` defaults to `NULL_ASSETS`, `stage` to null. The renderer's draw context object `g` gets two additive fields: `g.assets` (the assets, or `NULL_ASSETS`) and `g.density` (already there). Screens read `g.assets`.

### 3.1 Whole fruit, golden apple, bomb, medallions

Bake ONCE into the same centred entry the procedural painters produce: `{canvas, half: E, size: 2E, density, art: true}`.

* Radius: `R = FRUIT_ART[type].r` (or `GOLDEN_ART.r` 64, `BOMB_ART.r` 64, `POWERUP_ART[id].r` 62). Scale `s = R / meta.body.r`.
* Canvas half extent `E = ceil(max(anchor.x - box.x, box.x + box.w - anchor.x, anchor.y - box.y, box.y + box.h - anchor.y) * s) + 2` logical px, with `box = meta.contentBox`, `anchor = meta.anchor`. So stems, leaves, crowns, the fuse and the golden glow are never clipped.
* Paint: `ctx.setTransform(d*s, 0, 0, d*s, d*E - d*s*anchor.x, d*E - d*s*anchor.y); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0)` where `d` is the sprite density (2).
* Rotation pivot is the canvas centre, which is the body centre: `drawSprite(ctx, entry, x, y, rot)` is unchanged, so fruit, the bomb wobble and the medallions rotate about the body exactly as the procedural ones did and the collision circle stays where the body is.
* Per-object fallback: art is used only when `assets.has(id)` for that id; otherwise that object uses the painter. Mixed is fine.
* Refresh: `sprites` subscribes to `assets.on('group')`/`('release')` and, when the art of an id becomes (un)available, clears the cached entries built from it (`fruitByType`, `medallionById`, `cache` keys, `menu:*`, halves) and rebuilds lazily; `warmUp()` is idempotent and is called again from the refresh. Sprites built before the art loaded must never stay cached.
* `sprites.bomb()` also returns `fuseTip: {x, y}` in logical px relative to the body centre, unrotated: `((meta.points.fuseTip.x - anchor.x) * s, (meta.points.fuseTip.y - anchor.y) * s)`; `null` for the procedural bomb.
* **Bomb rim (art review round 1, M2).** The art bomb is baked with a light rim of `BOMB_RIM_PX` (5) logical px outside its ink outline, so that its near-black body (relative luminance about 0.01) keeps a silhouette on the dark ridge, rooftops and rocks of the stages. The entry is `{..., art: true, rim: 5}` and its half extent is the formula above plus `BOMB_RIM_PX` (canvas room for the rim). The bitmap is drawn once into a scratch canvas and filled with `COLORS.paperLight` through `source-in` (its silhouette), the silhouette is stamped 16 times around a circle of the rim radius, then the art is drawn on top: one bake per size and density, nothing per frame. Only the bomb has a rim; the painted bomb, fruit and medallions are unchanged. The collision circle, the body centre and the fuse tip do not move.
* Menu fruit: `menuFruit(type, scale, dens)` bakes the same way with `s * scale` (kept as today: released when the menu is not on screen). Upscaling of a 512 px source at menu scale 1.9 to 2.6 is soft on a 2x display; accepted (risk 9.5).

Replaces: `paintFruit`, `paintGolden`, `paintBomb`, `paintMedallion` (through `sprites.fruit/golden/bomb/medallion/menuFruit`).

### 3.2 What stays procedural on top of the art

Only bitmaps are replaced. Every animated overlay in `drawObjects` stays as it is: the pulsing danger ring (radius 1.2 r, vermilion, static with Reduce flashing), the bomb fuse spark drawn at the fuse tip (now `entry.fuseTip` instead of `bombFuseTip(BOMB_ART.r)`; the baked spark under it is covered by the larger animated one), the golden orbiting sparkles, the eight orbiting dots and the Freeze, Double and Clock extras of the medallions. Silhouette rules (bomb ring, medallion dots) keep the objects readable without colour. **Over a stage backdrop** (`g.backdropArt`, set by the renderer when a stage layer was drawn under the frame) the danger ring is drawn twice (art review round 1, M2): a `paperLight` underlay of 14 px at alpha 0.85, then the vermilion ring at 8 px with alpha 0.95 to 1 (1 with Reduce flashing); the old ring (6 px, alpha 0.5 to 0.9, 0.7 with Reduce flashing) stayed on the painted background and is what the procedural fallback still draws.

### 3.3 Halves and cuts

* The art halves are FACE-ON views (the cut face of half a fruit), identical twins `half_a` and `half_b`; they are not clipped copies of the whole. So no clipping and no dependence on the cut angle.
* Half A of the game (`GameHalf.side === +1`) uses `_half_a`, half B (`side === -1`) uses `_half_b`. Golden uses `fruit_golden_half_*`.
* Scale: `s_half = (R / wholeMeta.body.r) * halfMeta.halfScale`, `R` as in 3.1 (the cut event's `r` equals the catalogue radius). Anchor: the half's `anchor` (its content-box centre). Canvas half extent computed like 3.1.
* Halves are shared, not per cut: one baked entry per `(type, side)` (22 entries). `ensureHalf(half)` returns a small wrapper `{canvas, half: E, size: 2E, rot0: 0, stamp, id, shared: true}` so that the existing `drawHalves` and `drawGhostHalves` (`rot = lerp(prot, rot, a) - e.rot0`) draw them upright-then-rotated by the real `half.rot`, which starts equal to the parent's rotation. `pruneHalves` must not put a shared canvas on the free list.
* `registerCut` stays (it feeds the procedural path and the type lookup); art needs only `half.parentType`.
* The whole is replaced by its two halves at the cut, 0.15 r apart (game data), and the slice flash (3.6) covers the instant.
* New API for the UI-kit engineer (countdown and tuning screens draw sliced practice fruit with `paintHalf` today): `sprites.halfArt(type, side)` returns the shared entry or `null`, and `sprites.menuHalf(type, side, scale, dens)` the menu-scale entry or `null` (both `null` means the screen keeps calling `paintHalf`).
* **Menu slots and `releaseMenu()` (art review round 1, F6).** `menuFruit` and `menuHalf` keep their baked bitmaps in slots that `sprites.releaseMenu()` empties. The renderer calls `releaseMenu()` at the start of every frame whose screen is NOT `menu`, `tuning` or `countdown` (`MENU_SLOT_SCREENS` in `renderer.js`). `countdown` is in the set because the sliced mode fruit of a countdown that starts from a menu target is drawn from `menuHalf` slots for about a second: releasing them on every countdown frame re-baked both halves (two canvases, about 2 MB each at menu scale) on each of those frames. Any new screen that draws through `menuFruit` or `menuHalf` must be added to that set. The first frame of the next screen (the round) drops the slots.

Replaces: `paintHalf` (the cut-plane clip and the flesh strip) when both halves and the whole of that type have art.

### 3.4 Splash sprites: stains and particles

* Stains (`sprites.splat(colorHex, variant, soot)` used by `drawStains`): for a juice colour that belongs to a fruit with `fx_splash_<id>` art (reverse lookup of `FRUIT_ART[x].juice` and `GOLDEN_ART.juice`), bake ONE 320 x 320 canvas at density 1: the splash `contentBox` fitted (contain) into 288 x 288 and centred on the canvas centre. All three variants return that entry (the renderer already rotates every stain by `s.rot`). The stain keeps `multiply` compositing, the size `s.size` and the alpha from `fx.splatAlpha` (1.5 s hold plus 4.5 s fade), so the footprint matches the procedural blobs. Soot (`soot === true`, bomb) stays procedural.
* Particles (droplets, flecks, sparks, embers, smoke) stay procedural: hundreds per frame, tinted through `fx.colorTable`. The splash art is never a particle.

Replaces: `paintSplat` (juice colours only).

### 3.5 HUD icons that live in `sprites.js`

* `sprites.lifeApple(full)` (used by `hud.js` lives and the life-drop animation) bakes `icon_life_full` or `icon_life_empty` (contentBox contained in a 76 x 76 logical box, centred on the canvas centre, canvas half extent 44 as today). Replaces `paintLifeApple`.
* `sprites.medallion(id)` stays the play-field medallion (3.1). The HUD power-up tray uses the small `icon_<id>` art through `assets.scaled` (5.6), not the medallion.
* Bomb telegraph (`drawTelegraphs`): draw `icon_warning` (contentBox contained in a 72 x 72 logical box, bottom edge at y 1064, centred on `tg.x`) scaled by the existing pulse, instead of the vermilion triangle with "!"; keep the triangle when the icon is missing. The triangle-with-bomb picture is a silhouette cue, not colour only.
* Combo banner (`drawBanners`): `icon_combo` (contained in a 104 x 104 box) at `x = -band.w / 2 + 110`, `y = 0` inside the banner transform, only when the art exists.

### 3.6 Bomb explosion and slice flash (one-shot fx)

`fx.js` gets a small pool `fx.bursts` (cap `config.fx.burstsCap`, 6) of `{active, kind, x, y, angle, age, dur, size, alpha}` and `fx.burstView(b)` returning `{scale, alpha}`; `renderer.js` draws them after the particles and before the blade trail (a new `drawBursts()`), only when the art exists. `fx.handleEvent` fills the pool (pure state, deterministic from the seeded cosmetic stream and the events, like the existing pools; the no-art case still fills it, drawing is what needs the art).

| Burst | Trigger | Art | Size and motion |
|---|---|---|---|
| Explosion | `bomb` event (hit) at the bomb centre | `fx_bomb_explosion`, anchored at its alpha centroid | Width `6 * bomb r` logical px (384). Scale 0.55 to 1.0 with `easeOutCubic` over 300 ms, alpha 1 until 60 percent of the life then linear to 0, total `explosionMs` (480). Drawn after the 60 ms hit-stop like the existing embers. **Reduce flashing:** total `explosionMsReduced` (300), no scale animation (static 0.85), alpha at most `explosionAlphaReduced` (0.7). |
| Slice flash | every `cut` event | `fx_slice_flash`, anchored at its alpha centroid | Replaces the ink-and-paper slash line. Rotation `bladeAngle - meta.axis.angleRad`; uniform scale so that `meta.axis.lengthPx` equals `slashLenR * r` (2.2 r, as the line). Life, alpha and reduced variants are the existing `slashMs` 140, `slashAlpha` 0.9, `slashMsReduced` 200, `slashAlphaReduced` 0.5. The streak is symmetric enough that `bladeAngle` needs no sign choice. |

When the slice-flash art is missing the existing slash lines are drawn; when the explosion art is missing nothing extra is drawn (flash, vignette, shake, embers and smoke already exist).

Replaces: the slash lines of `drawSlashesAndRings` (only the slash loop; the rings stay), and adds the explosion.

### 3.7 Blade trail and cursor (`trail.js`)

* **Trail texture** `fx_blade_trail_tex`: an ink brush stroke under the existing coloured polygon (the polygon, its speed colour ramp and its ink outline are unchanged: the colour is the cut-threshold feedback). When the trail has at least 2 points and a chord of at least `trailBrushMinLenPx` (40): baked once at 640 x 97 logical (via `assets.scaled`), drawn from the oldest to the newest point as one straight brush: `translate` to the tail, `rotate` to the head direction, `scale` x to the chord length and y to `trailBrushWidthK` (1.6) times the head width, alpha `trailBrushAlpha` (0.4) times the trail's fade. It follows `style.cutting` (drawn only for the cutting style). No allocation per frame.
* **Cursor** `cursor_idle`, `cursor_cutting` replace the procedural ring (idle) and the vermilion disc (cutting) in `drawCursor`. Scale `s = (C.ringR + 6) / meta.body.r` (idle) or `(C.cutR + 8) / meta.body.r` (cutting), times `cursor.pulse` (idle); drawn with `anchor` on the cursor point (the aim dot, so the art's dot is exactly where the sword points), alpha as today (0.9, 0.35 when tracking is lost). The dwell arc, the tracking-lost dots and the hit logic stay procedural and are drawn over the art. Baked once per density step into entries; missing art means the procedural cursor.

### 3.8 Replacement table (summary)

| Existing painter or drawing | Replaced by | Fallback (unchanged) |
|---|---|---|
| `paintFruit` via `sprites.fruit`, `menuFruit` | `fruit_<id>_whole` | yes |
| `paintGolden` | `fruit_golden_whole` | yes |
| `paintHalf` (cut clip and flesh strip) | `fruit_<id>_half_a|b` | yes |
| `paintBomb` | `bomb_whole` (+ animated spark and ring on top) | yes |
| `paintMedallion` | `medallion_<id>` (+ animated overlays) | yes |
| `paintLifeApple` | `icon_life_full|empty` | yes |
| `paintSplat` | `fx_splash_<id>` | yes |
| slash lines | `fx_slice_flash` | yes |
| (none) | `fx_bomb_explosion`, `fx_blade_trail_tex` | nothing drawn |
| cursor ring and disc | `cursor_idle|cutting` | yes |
| telegraph triangle | `icon_warning` | yes |
| combo banner accent | `icon_combo` | nothing drawn |
| `paintBackground` | stage layers (section 4) | yes |

---

## 4. Stage contract (`public/js/render/stage.js`, owner: Stage engineer)

The file exists as a skeleton with the final `STAGE_IDS`, `stageIdFor`, `veilFor`.

### 4.1 API

```js
createStage({ assets, createCanvas, config = assets.config }) -> Stage
stage.setMode(id)            // 'classic'|'arcade'|'zen'|'menu'; cheap no-op when unchanged; starts loading group 'stage:<id>' and, once it is ready, the crossfade
stage.prefetch(id)           // assets.prefetch('stage:' + id); the renderer calls it while the menu cursor rests on a mode fruit
stage.resize(k)              // k = layout.k; rebuilds the pre-composed canvas lazily for the new density step
stage.needsFallback()        // true when the stage cannot fully cover the field this frame (nothing ready yet, assets off, load failed, or it is still fading in over the procedural background)
stage.draw(ctx, view, pass = 'back') -> boolean   // true if it drew anything
stage.status()               // {mode, shown, fading, resident: [ids], failed: [ids]} plain data (debug and tests)
stage.dispose()
```

`view` is one reused object built by the renderer: `{nowMs, screen, shakeX, shakeY, zoom, reduceMotion}` (`shakeX/Y` = `fx.shakeOffset`, `zoom` = `fx.zoom.scale`). The renderer, in `drawBackground()` inside the shaken and zoomed game layer, does:

```js
stage.setMode(stageIdFor(view.screen, snapshot ? snapshot.mode : view.roundMode))
if (stage.needsFallback()) <draw the procedural background as today>
stage.draw(ctx, stageView, 'back')
```

`pass` is `'back'` (all layers, behind every gameplay object, the only pass used now) or `'front'` (reserved for a future foreground; draws nothing and returns false). All three layers (far, mid, near) sit BEHIND the stains, banners, halves, objects, particles, blade trail, HUD and popups; the design rule that the background is calm and static (game-design 11) is unchanged.

### 4.2 Which stage each screen uses (exact)

`stageIdFor(screen, roundMode)`:

| Screen or overlay | Stage | Veil (tint `veil.color` `#C9D3E8` since art review round 1; it was paper `#EADFC8`) |
|---|---|---|
| `countdown`, `playing`, `paused`, `results` with `roundMode` `classic` | `classic` | none (the renderer's own paper dim of 0.75 on `paused` and 0.5 on `results` stays) |
| same, `arcade` | `arcade` | none |
| same, `zen` | `zen` | none |
| `boot`, `safety`, `connect`, `calibration` (steps 1 to 4, the practice apple included), `settings`, `tuning` | `menu` (night) | `veil.other` 0.52 |
| `menu` | `menu` (night) | `veil.menu` 0.5 (was 0.45, then 0.58 paper; see below) |
| overlay `disconnected` or `confirm` | the stage of the screen underneath (an overlay never changes it) | that screen's veil |
| a round screen whose `roundMode` is `practice` or null | `menu` (night) | `veil.other` |

This DEVIATES from the brief's list in one place, on purpose: `pause` and `results` do NOT switch to the night stage. The frozen game frame (stains, fruit, halves) stays visible under those screens' paper dim layers, and it was painted on the round's stage; switching the backdrop under a frozen frame would look like a glitch. The disconnected overlay while playing sits on `paused`, so it also keeps the round stage. Logged in `docs/contract-notes.md`.

The night stage is dark (indigo, moon, stars); the ink text of the menu, connect, settings and other screens was designed for paper. The veil is the readability fix. **Art review round 1 (M3) changed it in three ways.** (1) The veil is TINTED: `ART_CONFIG.stage.veil.color` `#C9D3E8` (a pale blue-grey) at 0.5 (menu) and 0.52 (other), instead of paper at 0.58 and 0.62; a paper veil turned the indigo night into a muddy grey that read like a disabled screen. (2) The secondary text of the night screens is drawn in `ink` instead of `inkText2` while the night art is under the frame (`secondaryInk(g)` in `draw-util.js`, `g.nightArt` set by the renderer): measured on the composed night stage `inkText2` would get 2.1 to 4.5 to 1 there (the reviewers measured 2.4 to 3.0 on the old paper veil), `ink` gets 4.2 to 8.8 to 1 (the smallest veil that gives ink 4.5 to 1 on the mean is 0.46, measured in `test/render/stage-readability.test.js`). The procedural background keeps `inkText2`. (3) The moon is dimmed by a soft disc (`stage.dim.menu`, 4.7). History: the first draft said `0.45` for the menu on an estimated luminance of 0.43 to 0.50; measured, that gave `inkText2` 2.3 to 1 and the paper veil needed 0.56 for 3 to 1, hence 0.58. `ART_CONFIG.stage.veil` is the tuning knob; the veil is drawn by the stage on top of the layers (after the near layer), so it never touches the round stages.

### 4.3 Placement, overscan, parallax

* Layers are drawn `cover`-sized at 2000 x 1125 logical px centred on the playfield, that is at `(-40, -22.5)`; `overscanPx = 40` (4.17 percent). The worst shake is 22 px (bomb hit) and the zoom punch is 1.03, which only grows the layer outward.
* The renderer draws the stage inside the game layer transform, so all layers already move 1:1 with shake and zoom. The stage compensates per layer: extra `translate(-(1 - kParallax) * shake)` and an extra scale of `(1 + (zoom - 1) * kParallax) / zoom` about the field centre, with `kParallax` = `parallax.far` 0.25, `parallax.mid` 0.55, `parallax.near` 1. The net motion of the far layer is therefore at most 5.5 px and of the mid layer 12 px at a bomb hit. Nothing moves when there is no shake or zoom.
* **Slow drift** (night stage only): the mid layer moves `sin(2 pi * nowMs / (periodS * 1000))` times `drift.midPx` (4) horizontally, the near layer times `drift.nearPx` (8) with a quarter-period phase shift. Never on the round stages. **Reduce motion** turns off the drift, the parallax offsets (layers are drawn at 0) and the crossfade (a stage change is a cut). Reduce flashing does not affect the stage (the crossfade is a slow 400 ms dissolve, not a flash).
* `layerAlpha[stage][layer]` multiplies each layer's alpha (defaults: near 0.85 classic, 0.8 arcade and zen). This is the knob for the loud near layers (bamboo, lanterns, petals, risk 9.3, 9.4).

### 4.4 Pre-composition cache, memory, loading

* **Fast path.** When `|shake| < 0.5`, `zoom === 1`, and no drift is active, the stage draws ONE pre-composed canvas: far, mid, near (with `layerAlpha`) composed once into a canvas of `round(2000 * dc)` by `round(1125 * dc)` px with `dc = min(d, compositeMaxDensity 1.28)` where `d` is the density step of 2.6, so at most 2560 x 1440 px (14.7 MB). One `drawImage` per frame. It is rebuilt only when the stage becomes ready, the density step of `k` changes, or `layerAlpha` changes.
* **Layered path.** While shake, zoom punch or drift is active, the three source images are drawn separately with their offsets (three `drawImage` calls). Shake episodes last at most 0.5 s; the night stage drifts continuously but draws little else.
* Decoded layers of at most `maxResidentStages` (2) stages are resident: the current one and the one fading out. When a crossfade ends the stage calls `assets.release('stage:<old>')`. Returning to the night stage reloads it (a fraction of a second on localhost); until it is ready the previous stage stays on screen.
* **Loading and fade.** `setMode(new)` never blanks the screen. The old stage (or the procedural background at the very start) stays until the new group is `ready`; then a crossfade of `crossfadeMs` (400) draws the new stage with alpha 0 to 1 over the old one (or over the procedural background). `needsFallback()` is true only while the procedural background is still visible under the art (before the first stage is ready, after a failed load, with `?assets=0`). A partial group (a layer failed) draws the layers that loaded, over the paper procedural background when the far layer is the one missing.
* Time comes only from `view.nowMs`; the stage owns no timers. It subscribes to `assets.on('group')` and `('release')` to invalidate its caches.

### 4.5 Fallback

The existing procedural background (`sprites.background(k)` and `paintBackground`) is the fallback and is not modified. It also remains the background of the very first frames before any art is ready. A stage that fails (manifest failed, far layer failed) is marked failed and the procedural background is used for that mode for the rest of the session; nothing retries.

### 4.6 Calm background guard

`manifest.stages.<id>.centreLuma` (mean relative luminance of the composed layers over the play area x 480 to 1440, y 180 to 900) must be between 0.60 and 0.93 for `classic`, `arcade`, `zen` (the game-design 11 range is 0.65 to 0.92 and the near layers are dimmed by `layerAlpha`, so the guard leaves a little room). The night stage is exempt (dark by design, veiled by 4.2). The Asset engineer computes the numbers at build time; the Stage engineer's test asserts them against `manifest.json` (skipped when the file is absent).


### 4.7 Erase, lift and dim (art review round 1)

Three optional data tables in `ART_CONFIG.stage`, read live by `stage.js`, each skipped when its entry is absent or the stage has no canvas factory, and each drawn the same way in the pre-composed canvas and in the layered path (the composite holds them, so the quiet steady state is still ONE `drawImage` per frame):

| Key | Shape | What it does | Shipped |
|---|---|---|---|
| `erase` | `{stage: {layer: [[x0, y0, x1, y1], ...]}}` in logical field px | the rectangles are cut out of that layer when it is drawn (`clip('evenodd')` around a rectangle of the whole layer; the holes must not overlap). The cut lines must run through transparent pixels of the layer: a test reads the alpha along them. | `arcade.near`: `[37, -30, 400, 440]` and `[1540, -30, 1884, 440]`. The two lantern clusters of M1 are gone (glossy, ink outlined, fruit coloured, in the top corners where fruit fly and the score is drawn); the two thin posts (x up to 36 and from 1885) stay. |
| `lift` | `{stage: {alpha, from, to}}` (y in logical field px) | a paper (`COLORS.paper`) haze drawn BETWEEN the mid and the near layer: alpha 0 at y `from`, `alpha` at y `to`, constant to the bottom of the backdrop. A 4 x 256 canvas per stage, built once. | classic 0.2, arcade 0.3, zen 0.2, from 640 to 780. Measured (64 px cells over x 100 to 1820, y 120 to 980): cells darker than relative luminance 0.12 went from 28 to 1 (Classic), 39 to 6 (Arcade, navy rooftops), 4 to 0 (Zen, rocks); the darkest cell from 0.052 / 0.019 / 0.067 to 0.116 / 0.105 / 0.134. The bomb rim (3.1) does the rest: the body has 3 to 1 against light grounds and the rim against dark ones, for every ground luminance (a test sweeps 0 to 1). |
| `dim` | `{stage: [{x, y, r, alpha, color}]}` (logical field px) | a soft disc of `color` over the FAR layer: full strength to radius `r`, linear fade to nothing at `1.25 r`. A 128 x 128 canvas per disc, built once. | `menu`: the moon at (1672, 163), r 120, alpha 0.4, `#1F3A5F` (the moon is 54 percent darker; it was the brightest spot of every night screen and sat behind the tuning sentence). |

The veil colour is `stage.veil.color` (4.2). Measuring tools: `test-support/stage/luma.js` `measureStage` composes the same extras (`erase`, `lift`, `dims` options, a `cells` census, `centreRgb`) in true field coordinates (the layers cover 2000 x 1125 px from (-40, -22.5)); `test-support/stage/recorder.js` `baseStageConfig()` is the shipped config with the three tables emptied, used by the tests that count the draw calls of the bare mechanism (`test/render/stage-extras.test.js` covers the extras with the shipped config).

---

## 5. UI kit contract (owner: UI-kit engineer)

Widgets keep their names and signatures and gain an optional `opts.assets` (the assets, from `g.assets`; missing or `NULL_ASSETS` means the procedural drawing, as today). Screens thread `g.assets` into every widget call they make. Hit boxes, `layout-data.js` target rectangles, target ids and the 84 x 84 minimum do not change: what is drawn may extend a few pixels beyond a target (a focus halo), what is clickable never changes.

### 5.1 Widget to image

| Widget (function) | Image(s) | Rule |
|---|---|---|
| `drawButton` primary | `button_primary_default|focused|pressed|disabled` | `variant` = `opts.variant ?? (tg.h >= 120 ? 'primary' : 'secondary')` (the existing height rule that picks the label size). Primary targets today: `safety.ok`, `connect.main|continue`, the four `pause.*`, `results.again|menu`. |
| `drawButton` secondary | `button_secondary_default|focused|pressed|disabled` | Every other button (height below 120). |
| `drawStepButton` | `stepper_minus_*` (symbol `-`), `stepper_plus_*` (symbol `+`) | One image each, glyph baked in. `assets.scaled(id, tg.w, tg.h)` contain: an 84 x 84 target draws about 82 x 84. Add an optional 5th parameter `opts` (`{assets}`) to the function. |
| `drawSegmentCell` (toggle) | `toggle_off`, `toggle_on`, `toggle_focused` | 5.3. |
| `drawSegmentCell` (hand `Right/Left` and the tuning presets, which are not on/off) | procedural, unchanged | Their cells are 240 and 250 wide and hold text of another meaning. |
| `drawPanel` | `panel_9slice` | 5.4. |
| Timer ring (`hud.js`) | `timer_ring` | 5.5. |
| HUD lives | `sprites.lifeApple(full)` (3.5) | Unchanged call. |
| HUD power-up tray | `icon_freeze|frenzy|double|clock` | `assets.scaled('icon_' + id, 68, 68, g.density)` cached in a module map per density step and generation; centred on `(x, y)` of `HUD.tray`; the shrinking ink ring stays. |
| Cursor | (renderer: 3.7) | Not a UI-kit item. |
| Logo | `logo_title` | 5.7 (menu, boot). |
| Controller glyphs | `glyph_*` | 9.1 (connect screen, disconnect overlay). |
| Results trophy | `icon_trophy` | Left of the "New best" plate, contained in 88 x 88, only when `isNewBest`. |
| `drawPill`, `drawRing`, `drawSeal`, `drawSword`, `drawArrow`, toasts, status pills | procedural, unchanged | No art exists for them. |
| Meters (settings, tuning speed meter, connect and disconnect countdown bars) | procedural, unchanged | `meter_bar` is not shipped (1.3). |

### 5.2 Button states, plate and label

* **States** (`opts.hovered` means focused): `!tg.enabled` -> `disabled` (wins over everything); else `v.pressedId === tg.id` -> `pressed`; else hovered (`v.hover.id === tg.id`) -> `focused`; else `default`. `view.pressedId` is an OPTIONAL string that the UI state machine may set for about 140 ms after a click, cut or dwell activation (the Integrator adds it to `ui.js` later, section 6.3); until then it is undefined and `pressed` is never drawn. The UI-kit engineer's tests set it in fixtures.
* **Frame.** The visual frame of a button is the target rectangle inset by `opts.inset ?? 0` (same semantics as today). `assets.sliced(defaultId, frameW, frameH, density)` for the default id; the other states use their own id with the same call, so all four scale with the default's factor `s = frameH / defaultBox.h` (a focused state comes out slightly larger because of its halo, centred on the same point). The caller draws each result centred on the target centre. Cache the four results per `(id, w, h, density, generation)` in a small map owned by `widgets.js`.
* **Label plate** (`manifest.label`, insets in shipped px from the default's contentBox, scaled by `s`): text is centred in the rectangle `[x0 + l*s, y0 + t*s] to [x1 - r*s, y1 - b*s]` of the frame. Seeds (Appendix A): primary `l = r = 110, t = b = 46`; secondary `l = r = 125, t = b = 56`. The label font is the existing style choice, then `fitFont(ctx, style, label, plateW)` as today, then capped at `max(28, floor(0.85 * plateH))` px (never below 28). Text colour: primary paper light (`COLORS.paperLight`); secondary `COLORS.ink`; disabled primary paper light, disabled secondary `COLORS.inkGrey`. The art has no tilt: drop the procedural tilt when art is used.
* **Fallback.** Missing assets for that variant or state -> the existing `drawButton` code path, unchanged (including the plate tilt, the 8 px hover border and the 55 percent disabled alpha).

### 5.3 Toggles

The settings toggles (`reduceFlash`, `reduceMotion`, `autoCenter`, `dwellSelect`) keep two targets, `set.<key>.on` (cell A, left) and `set.<key>.off` (cell B, right), with the same rectangles. Labels read "On" and "Off" (7). The art is ONE two-cell image drawn over both cells:

* The selected cell is the vermilion one. On-selected means the LEFT cell is vermilion, which is the picture in `toggle_off.png` (red on the left); Off-selected means the RIGHT cell is vermilion, the picture in `toggle_on.png` (red on the right). (The file names describe the thumb of a conventional switch; the picture is what counts.) Focused (either cell hovered): `toggle_focused.png` has the vermilion cell on the RIGHT with an amber halo; when the left cell is the selected one, draw it mirrored with `ctx.scale(-1, 1)`.
* Frame: `assets.scaled(id, unionW, 84)` contain, where the union of cell A and cell B is centred at `(col.x0 + 220, cy)` and is about 430 x 84; the image is narrower (3.46:1 to 5.1:1), so it is drawn at height 84 and centred; the two cells are LABELLED at the art's cell centres (`meta.cells`, seed x 0.26 and 0.74 of the box, y 0.5), and the hit boxes stay the wider layout rectangles (bigger than the picture, never smaller).
* Text: "On" and "Off" in `bodyBold`, ink on paper cell, paper light on the vermilion cell (as today), fitted to the cell width.
* Fallback: the existing `drawSegmentCell`.

### 5.4 Panel

`drawPanel(ctx, cx, cy, w, h, opts)` with art: `assets.sliced('panel_9slice', w, h, density)`, nine-slice margins 48 shipped px (`slice: {l:48, r:48, t:48, b:48, scale: 0.5}`, so the corners are 24 logical px), drawn centred at `(cx, cy)`. The art has its own highlight and shadow, so the procedural 4 px offset shadow is not drawn. Users: safety (1800 x 1064), connect steps (880 x 660), results (1240 x 880), disconnect (900 x 640), confirm (900 x 420). `opts.fill` is ignored with art (a custom fill means the procedural path). Fallback: existing.

### 5.5 Timer ring (HUD)

`timer_ring` is a cream donut; its centre is transparent. Geometry in `meta.ring` (seed on the 512 x 508 file: `cx 256, cy 254, outer 253, bandMid 203, bandHalf 31, hole 153`; measured: outer ink 0 to 18 px, cream band 21 to 84, inner ink 84 to 103, hole radius 153).

* Scale so that `bandMid` equals the ring radius: `s = ringR / bandMid`. The HUD ring radius is 72 for Arcade and `0.86 * 72` for Zen (`HUD.timer.r` 70 becomes 72), so the outer radius is 89 (Zen 77) logical px. Move the ring centre to `y = 96` (it was 92; the top of the ring must stay on the canvas: `96 - 89 = 7`).
* Draw the art as the track (replaces the faint track circle), then draw the remaining-time arc ON the band: `arc(cx, cy, ringR, ...)` with `lineWidth = 2 * bandHalf * s * 0.6` (about 13 px), same colours as today (teal, vermilion deep in the last 10 s) and `lineCap` round.
* The digits are drawn in the hole. Hole radius is `hole * s` about 53 px: use size 44 (`fontString('hudTimer', 44)`), never below 28; the "TIME" caption stays below the ring at `y + outer * s + 30`.
* Fallback: the existing arc and text drawing.

### 5.6 Cursor states and icons

`cursor_idle`/`cursor_cutting` belong to the renderer (3.7). The UI-kit uses `icon_life_*` only through `sprites.lifeApple`. Icons drawn by UI-kit code use `assets.scaled(id, box, box, density)` (contain, centred); no icon is ever below 44 px and none replaces text.

### 5.7 Logo (menu and boot)

* **Menu.** `logo_title` (1400 x 714, aspect 1.96) replaces the `menu.title` text. Box: centred at `x = 960`, top `y = 10`, height 226 (width 443) via `MENU_LOGO = {cx: 960, top: 10, h: 226}` exported from `layout-data.js`. The tagline moves from `y = 250` to `y = 272`; the mode fruit, their hit circles, names, descriptions and buttons do not move. The menu toast stays at `y = 302` (it may cover the last pixels of the tagline while it shows; accepted). With no logo art the title text and the tagline are drawn as today.
* **Boot.** Logo contained in 720 x 400 centred at `(960, 420)`, the word `boot.loading` at `y = 700`, and a 480 x 14 px progress bar at `y = 740` filled by `status().groups.core` (`loaded / total`). With no art: the existing "Loading" text.
* The title text fallback (`menu.title`) is the string "3D FRUIT DOJO" (7).

### 5.8 Layout constraints kept

Text never below 28 px; every selectable at least 84 x 84 (the stepper art fits an 84 x 84 target); wrap widths and fit rules of `layout-data.js` and `screens/` unchanged; all glyph and icon additions sit in free space and never overlap text or targets (tests in section 8 check the rectangles).

---

## 6. File ownership and hooks

### 6.1 Ownership table

Nobody edits a file that is not in their row. A change in someone else's file goes into `docs/contract-notes.md` as a request and is implemented against the contract meanwhile. If an existing test breaks because of an owner's change, that owner fixes the expectation (edit only the failing assertion, log it in `docs/contract-notes.md`).

| Owner | Owns |
|---|---|
| **Asset engineer** | `tools/**`, `public/assets/**`, `server.js`, `public/js/render/assets.js`, `public/js/render/art-config.js`, `test/assets/**`, `test/server/**` (only for the server changes), `test-support/assets/**`, `docs/assets.md` |
| **Gameplay-renderer engineer** | `public/js/render/renderer.js`, `painters.js`, `sprites.js`, `fx.js`, `trail.js`, `palette.js`, `draw-util.js`; `test/render/{renderer,painters,sprites,fx,trail,polish}.test.js` and new `test/render/art-*.test.js` about these files; `test-support/render/**` (`fake-canvas.js`, `rig.js`) |
| **Stage engineer** | `public/js/render/stage.js`; `test/render/stage*.test.js`; `test-support/stage/**` |
| **UI-kit engineer** | `public/js/ui/screens/**`, `public/js/ui/widgets.js`, `public/js/ui/layout-data.js`, `public/js/ui/hit.js`, `public/js/render/hud.js`, `public/js/render/layout.js`; `test/ui/{layout-data,hit}.test.js`, `test/render/layout.test.js`, new `test/ui/art-*.test.js`; `test-support/ui/**` |
| **Copy engineer** | `public/js/ui/strings.en.js`, `README.md`, `docs/**` except `docs/assets-integration.md` and `docs/assets.md` (and except appending to `docs/contract-notes.md`, which everyone does), `package.json`, the `<title>`, the `aria-label` and the `<noscript>` text of `public/index.html`, the texts of `public/diagnostics.html`, the banners of `start.command`, the usage string of `bridge/Info.plist`, and the tests that assert the renamed texts: `test/ui/strings.test.js`, `test/architecture/delivery.test.js`, `test/architecture/english-only.test.js`, `test/e2e/game.test.js` (title only) |
| **Integrator (later, after the five are done)** | `public/js/app.js`, `main.js`, `ninja-api.js`, `public/js/ui/presentation.js`, `public/js/ui/ui.js`, `public/js/ui/connect-model.js`, `public/js/flags.js`, `test/app/**`, `test/e2e/**` (new art scenarios), `test-support/app/**`, `test-support/e2e/**` |

Nobody touches `public/js/game/**`, `motion/**`, `input/**`, `audio/**`, `shared/**` or the other tests.

### 6.2 Hooks each owner exposes or calls

| Producer | Exposes (final names) | Consumers |
|---|---|---|
| Asset | `createAssets(opts)`, `NULL_ASSETS`, `ART_CONFIG`; `Assets` API of 2.2; `test-support/assets/stub-assets.js` `createStubAssets({ids: 'all'\|string[], manifest?, failIds?, size?})` returning an `Assets` whose `get(id)` is a stub drawable `{id, width, height, isStub: true}` and whose `meta(id)` comes from `test-support/assets/seed-manifest.js` (Appendix A numbers, written FIRST so the others can start); `public/assets/**` | everyone |
| Gameplay-renderer | `createSprites({createCanvas, density, assets})` (+ `halfArt`, `menuHalf`, `refresh`, `bomb().fuseTip`, art-aware `fruit/golden/bomb/medallion/lifeApple/splat/menuFruit/ensureHalf`); `createTrail({config, assets})`; `createFx({config})` with `bursts` and `burstView`; `createRenderer({canvas, ctx, sprites, fx, trail, assets, stage})`; `g.assets` on the draw context; `drawSprite` (unchanged); `makeRenderRig({cssW, cssH, dpr, assets, stage})` | UI-kit (`g.sprites`, `g.assets`), Integrator |
| Stage | `createStage`, `stageIdFor`, `veilFor`, `STAGE_IDS`; the `Stage` API of 4.1 | renderer (calls it), Integrator |
| UI-kit | widgets with `opts.assets`; `layout-data.js` additions `MENU_LOGO`, `CONNECT_GLYPHS` (9.1); `hud.js` `drawHud(g, anim)` and `HUD` (timer centre `y 96`, radius 72) | renderer (`drawHud`, `drawPill`, `SCREEN_DRAWERS`, `MENU_MODES`) |
| Copy | strings ("3D FRUIT DOJO", On and Off), documents | everyone |

Rules that make the parallel work safe:

* The renderer imports only `NULL_ASSETS` and (optionally) `stageIdFor` from the skeleton modules, which already exist. It never imports `layout-data.js` additions that do not exist yet.
* The UI-kit engineer never imports from `sprites.js` beyond the documented names (`menuFruit`, `menuHalf`, `halfArt`, `lifeApple`, `medallion`); everything else it needs comes from `g.assets`.
* The density step everywhere is the inline formula `Math.min(2, Math.max(1, Math.ceil(k * 2) / 2))`; there is no shared helper.
* Module boundaries: `render/` and `ui/` may import `shared/`, `render/`, `audio/`, `ui/` (unchanged rule); `test/architecture/boundaries.test.js` stays green: no new file may import `game/`, `motion/` or `input/` other than the three `*-config.js` data modules.

### 6.3 The Integrator's later work (specified now, not done now)

* (DONE, see docs/contract-notes.md, Integrator entry on the art wiring; deviations listed there) `app.js`: read a new flag `?assets=0|off` (assets disabled; default on), create `createAssets({createCanvas: env.createCanvas ?? ...})`, `await Promise.race([assets.load('core'), timeout(bootWaitMs)])` before `ui.notify({type:'ready'})` (also under `?clock=manual`; the timeout uses the real timer), then `assets.load('stage:menu')` in the background. Pass `assets` to `createPresentation`.
* `presentation.js`: build `createStage({assets, createCanvas})`, pass `assets` to `createSprites` and `createTrail`, `assets` and `stage` to `createRenderer`; call `stage.prefetch(mode)` from `step()` while `view.hover.id` is `menu.<mode>`; call `stage.resize(layout.k)` from `resize()`; expose `debug.assets`, `debug.stage`.
* `ui.js`: optional `view.pressedId` (set for 140 ms after an activation).
* `ninja-api.js`: `window.__ninja.getAssets()` returning `assets.status()` plus `{enabled}`.
* e2e: art scenarios (section 8.6).

---

## 7. Rename and On/Off (owner: Copy engineer, plus the guard tests)

* **Player-visible title becomes "3D Fruit Dojo"** in everything a player or a reader sees: `<title>`, the canvas `aria-label` and the `<noscript>` line of `index.html` ("3D Fruit Dojo needs JavaScript..."), the fatal-error box text of `main.js` (Integrator, later), the `menu.title` string (`"3D FRUIT DOJO"`, uppercase because it is the fallback of a logo), the diagnostics page texts, the `start.command` banners, the `server.js` console lines (Asset engineer), the macOS Bluetooth usage string in `bridge/Info.plist` (text only; do NOT rebuild the helper, its embedded copy changes at the next `bash bridge/build.sh`), `README.md`, `docs/GUIDE.md`, the H1 titles and prose of the other documents, and the `description` of `package.json` (also drop the mention of another game's name).
* **Unchanged on purpose:** the folder name, `package.json` `name` (`joycon-ninja`), `window.__ninja`, every URL flag, every `joyconNinja.*` localStorage key (saved scores survive), the `/__health` body, the `X-Joycon-Ninja` header, `[joycon-ninja]` console prefixes, the `NinjaSnapshot` type name, and the rank name "Ninja" (`rank.3`, a rank, not the title). The test title strings in `test/server/` that quote `joycon-ninja` stay.
* **On and Off.** `settings.on` reads "On" and `settings.off` reads "Off" (were "Yes" and "No") in `strings.en.js` AND in the `docs/game-design.md` section 13 table (the strings test compares both). The confirm dialogs keep "Yes, quit" and "Yes, delete" (they are answers, not toggles). Update `test/ui/strings.test.js` (`'settings.on': 'Yes'` expectation) and any prose in `README.md`, `docs/GUIDE.md`, `docs/game-design.md`, `docs/improvements.md` that says the toggles read Yes and No. The text "Auto-recenter: Yes" style examples in comments of other tests are comments only.
* **Documents.** `docs/architecture.md` rule 7 ("no image files (art is procedural)") and section 8.1 get an amendment: image files live only under `public/assets/`, all optional with the procedural drawing as fallback, see `docs/assets-integration.md`. `docs/game-design.md` section 11 gets the same note ("procedural only" becomes "procedural, with optional generated art"). `package.json` `test:unit` gains `assets` in its directory list. Everything stays English (the guard scans `docs/`).

---

## 8. Test strategy

All of it runs under `node --test` with no browser except 8.6. Existing tests stay green with no assets.

### 8.1 Loader (`test/assets/`, Asset engineer)

Stub `createImage` (fake image objects that call `onload` asynchronously with configurable `width`, `height`, failure, delay), stub `fetch` for the manifest, fake timers. Cases: load order and concurrency limit; groups; `load` never rejects; manifest failed, bad version, bad JSON; image error, timeout (fake timers), size mismatch; `has/get/meta` before and after; `generation` bumps; `release` purges and reloads; events order; `scaled` and `sliced` sizes (contain, stretch, three-slice with `h/refBox.h`, nine-slice with scale 0.5, caps shrink), cache key stability and LRU limits with a fake canvas factory; `NULL_ASSETS` shape equals the `Assets` shape (same member names); no top-level `window/Image/fetch` access (import in Node).

### 8.2 Manifest and pipeline integrity (`test/assets/`, Asset engineer)

`manifest.json` valid against the schema of 1.4; ids unique; every `file` exists and `bytes` equals the file size; PNG and JPEG headers give `width x height`; ids equal the image rows of `design/assets.csv` minus `meter_bar`; groups list exactly the ids of their assets in the documented order; `totalBytes` and each file within budget; every fruit and golden whole has `body`, every half `halfScale`, every UI state variant a `ref`, buttons and panel a `slice`; `PROVENANCE.csv` has 103 rows with matching hashes (skipped when `design/` is absent); no Italian word (the English-only guard already scans the JSON); `--check` rebuild compares equal (skipped when ffmpeg or `design/` is missing); the body table of `tools/asset-spec.mjs` matches `--measure` within 3 percent (same skip rule). Server tests: `.jpg` MIME, `ETag` and `304`, `no-store` elsewhere, path escape still refused.

### 8.3 Renderer and fx with stub images (`test/render/`, Gameplay-renderer engineer)

`makeRenderRig({assets: createStubAssets({ids: 'all'})})`: fruit entries have the right `half` and centre (anchor at the canvas centre), scale equals `R / body.r`, the golden entry is not clipped (E covers the glow), halves are shared and `rot0 === 0`, side A uses `_half_a`; refresh after `assets.generation` changes; a stub group that loads late replaces procedural entries without a frame that draws nothing; the draw call sequence and order equal the existing order plus the new bursts; explosion and slice-flash lifetimes, Reduce-flashing variants, deterministic fx state for the same seed; cursor and trail brush call counts; NO `shadowBlur` or `filter` assignment anywhere (the existing spy); per-id fallback (delete one id from the stub and only that object turns procedural); `assets` null equals today's output call by call (a golden test comparing `ctx.calls` with and without `NULL_ASSETS`).

### 8.4 Stage (`test/render/stage*.test.js`, Stage engineer)

`stageIdFor` and `veilFor` tables (every screen, `practice`, overlays); crossfade timing from `nowMs`; nothing blank while loading (`needsFallback` true then false); drift only on `menu`, zero with Reduce motion; parallax offsets `-(1 - k) * shake` and the zoom compensation formula; fast path uses one `drawImage`, layered path three; composite canvas size and density cap; `maxResidentStages` and `release`; failed far layer keeps the procedural background; manifest luminance guard (skipped when the manifest is absent); no allocation after the first frame (canvas count constant).

### 8.5 UI kit (`test/ui/art-*.test.js`, UI-kit engineer)

With a fake canvas rig and stub assets: every button variant and state picks the right id; disabled wins; `pressedId` optional; label rectangle inside the frame and every real label of `strings.en.js` fits its plate at the capped font size (28 px minimum) for every button target of `screenTargets`; toggles pick the picture by selected cell and mirror the focused one; panel `sliced` sizes for the five panels; timer ring geometry (arc radius equals `bandMid * s`, ring inside the canvas); HUD tray icons; logo box does not overlap the mode fruit circles or the buttons; glyph rectangles overlap no target and no text box; `layout-data.test.js` and `hit.test.js` keep passing with NO change to any target rectangle (a snapshot test of all target rectangles from `screenTargets` for every screen against the current values); art absent equals today's drawing.

### 8.6 Integration, visual smoke, performance (Integrator, QA)

* **Visual smoke in headless Chrome** (`test/e2e/art.test.js`, uses `test-support/e2e/cdp.js`, skipped not passed without Chrome): with the real `public/assets/`, boot with `?input=sim`, visit every screen through `__ninja` (`ui.force`), and for each: the canvas is not blank (mean colour and standard deviation over a grid of samples from `getImageData`), no page error or console error, `getAssets().groups.core.state === 'ready'`, then the same run with `?assets=0` (procedural) and with the manifest blocked (request failure) to prove the fallback. Screenshots are written outside `public/` and `design/` (scratchpad) for the owner to review; a human looks at classic, arcade, zen and menu, results and connect.
* **Performance smoke, node** (`test/render/art-perf.test.js`, Gameplay-renderer engineer): 600 frames of a busy round with the fake context: after warm-up no new canvas is created (`factory` counter constant), `sprites.stats` constant, draw calls per frame below a stated cap, `assets.scaled` never called from `draw`.
* **Performance smoke, browser** (`test/e2e/perf.test.js`, extended by the Integrator): average `step() + draw()` below the existing 6 ms budget with art on, and `getPerf().degradeLevel` stays 0 on the CI machine. UNVERIFIED-ON-HARDWARE for the owner's Mac.
* `npm test` is green at the end (at least 1199 tests plus the new ones).

### 8.7 Guards

A new test (Asset engineer, `test/assets/boundaries.test.js`): `game/`, `motion/`, `input/`, `shared/` import neither `assets.js`, `stage.js` nor `art-config.js`; `public/js` contains no reference to a file under `public/assets/` other than through the manifest (no hard-coded asset path); no `Image`, `fetch` or `createImageBitmap` reference outside `assets.js`.

---

## 9. Unresolved risks of PHASE 2 RESULTS: decisions

### 9.1 Joy-Con-like controller glyphs

`glyph_joycon_l` and `glyph_joycon_r` are red slim controllers with a stick and four buttons: not copies, close to the look of a real Joy-Con. Decision (first draft): they are used, behind ONE switch, `ART_CONFIG.glyphs.enabled`. **Art review round 1 (M5) switched the default to `false`**: the two pictures are slim rounded controllers with a top tab, a thumbstick and a four-button diamond in the real layout (stick above buttons for L, buttons above stick for R), and both are red, so the pair is a Joy-Con R twice; the brief asked for generic glyphs, not copies of Nintendo artwork. With `false` no controller picture is drawn (the connect screen and the disconnect overlay lose only the pair above the main button). A replacement for the two files should keep the pill shape and drop the stick, the four-dot diamond and the top tab, use one neutral colour (indigo or paper with an ink outline) and be identical for left and right; point `ids.joyconL` and `ids.joyconR` at it, then set `enabled` to `true` again (the layout tests run with the switch on: `createArtStubWithGlyphs`). Setting `false` hides every controller picture. Swapping is a data change: `ART_CONFIG.glyphs.ids` maps a role to an asset id, so a recoloured file added later replaces them with no code change. The other glyphs (`mouse`, `keyboard_enter`, `sync_button`) are not controller pictures and are not governed by `enabled`. Where they go (UI-kit exports `CONNECT_GLYPHS` from `layout-data.js` and draws them only through the swap table):

**Update 2026-10-01 (restyle round).** `glyph_joycon_l`, `glyph_joycon_r` and `glyph_sync_button` were replaced by the generic pictures of `design/icons_v2/` (a neutral blue and orange gamepad, identical in meaning for left and right; a neutral blue button with an arrow for the sync hint), exactly the replacement this section asked for, and `assets/PROVENANCE.csv` says so. The switch keeps its shipped default `false`; the ids still point at the same names, so turning the switch on is a data change. The new pictures are landscape (content boxes 218 x 148 and 216 x 165 of 256 px), the old ones were portrait: a glyph drawn "contained in a box of height h" is now width-bound and about 0.68 h tall, see `docs/contract-notes.md` ("Restyle requests for the UI engineer"). The fonts of the same round are described in `docs/typography.md` and `docs/assets.md` 2.1.

* connect screen (both layouts): the L and R pair, 96 logical px tall, centred at x 1400 and 1480, y 250, above the main button (free space between the subtitle and the button, checked by a rectangle test); `glyph_mouse`, 64 px tall, inside the left end of the "Mouse only" button plate; `glyph_keyboard_enter`, 64 px tall, inside the left end of the "Simulator" button plate (the simulator is driven by mouse and keyboard); `glyph_sync_button`, 56 px tall, left of the pairing steps title.
* disconnect overlay with the native bridge: `glyph_sync_button`, 72 px tall, centred at (960, 250) above the title.
* Label text of those buttons shifts right by the glyph width plus 12 px; the hit box does not change.
* Nothing is ever the only carrier of a meaning: every glyph sits next to its text.

The owner decision (keep, recolour or drop) is now "drop until replaced" (default off, above); the files stay in `design/` and `public/assets/` so that a recoloured pair can be swapped in by data.

### 9.2 Zen petals and the near layer

The Zen near layer has petals inside the play area at both sides and a branch over half of the sun. Petals are small and pink, fruit are bigger and outlined. Decision: draw the near layer behind everything with `layerAlpha.zen.near = 0.8`, keep the Zen far layer as is, and let QA judge in play. If a petal is mistaken for a fruit, lower `layerAlpha.zen.near` to 0.6 (data only). No petals are drawn in front of the gameplay, ever.

### 9.3 Lanterns and dark posts (Arcade)

The two lantern clusters reach about 20 percent of the width and 38 percent of the height, and the posts are dark. Decision: near layer behind the fruit, `layerAlpha.arcade.near = 0.8`; the calm-background guard (4.6) measures the composed play area and would fail the build if the layers dominate. If they still crowd the top corners, lower `arcade.near` to 0.6 (data only); rebuilding the art is out of scope.

**Outcome (art review round 1, M1).** A real-browser review found the lanterns looked like fruit (same palette, outline weight and highlight arc; the big red one is about fruit size), sat where every fruit flies (game arcs span x 100 to 1820, apexes at y 240 to 560) and carried the score block; 0.8 was far too weak. They are now erased at draw time (`stage.erase.arcade.near`, 4.7) and the near layer of Arcade is only its two posts; `layerAlpha.arcade.near` stays 0.8. The art files are untouched (`design/` is never edited, `build-assets --check` still passes); if the lanterns are ever regenerated flat, delete the `erase` entry.

### 9.4 Classic bamboo

The near bamboo is thick and saturated. Same decision: behind everything, `classic.near = 0.85`.

### 9.5 Weight and memory

Decided in 1.7: mid and near 2048 x 1152, far JPEG 2560 x 1440, sprites 512, icons 256, per-group lazy loading, at most two stages resident, one composed canvas. Fallbacks in the tool. The menu fruit are 512 px sources drawn up to 2.5x on a 2x display: soft but acceptable; if QA objects the owner can ask for larger fruit art (out of scope here).

### 9.6 Other decisions

* `meter_bar` is not shipped (baked marker). The procedural meters stay.
* The night stage is veiled, not recoloured (4.2).
* No audio changes.
* The unused sheets in `design/phase0|1|2` stay untouched (provenance only, about 230 MB; deleting them is the owner's call).

---

## 10. Order of work and hand-over

1. **Asset engineer, first hour:** `test-support/assets/seed-manifest.js` (from Appendix A) and `test-support/assets/stub-assets.js`, then the real `assets.js`. Everyone else builds against the skeleton files and the stub.
2. **In parallel:** Asset engineer builds the tool and `public/assets/`; Gameplay-renderer, Stage and UI-kit implement against the stub; Copy does the rename, On and Off and the documents.
3. **Then the Integrator** wires app, presentation and ui (6.3), extends the e2e tests, runs the visual smoke and the performance smoke and records real numbers in `docs/assets.md`.
4. **Definition of done:** `npm test` green; with `?assets=0` the game looks exactly like today; with assets every screen shows art with no missing piece; the three round stages and the night stage were reviewed on screen; sizes and memory measured and written down; open risks updated.

---

## Appendix A: seed values (measured on 2026-09-30 from `design/`)

These go into `tools/asset-spec.mjs` and `test-support/assets/seed-manifest.js`. Pixel coordinates are in the 512 px canvases of `design/sprites/` (shipped sprites keep these coordinates). `body.r` is the divided value (measured area-equivalent radius divided by `fit`).

### A.1 Fruit whole

| id | game radius | body cx | body cy | measured r | fit | manifest `body.r` | scale = radius / body.r | contentBox (x, y, w, h) |
|---|---|---|---|---|---|---|---|---|
| watermelon | 92 | 256 | 256 | 187.0 | 1.00 | 187 | 0.492 | 73, 63, 365, 385 |
| pineapple | 82 | 255 | 299 | 121.9 | 0.86 | 142 | 0.577 | 156, 62, 199, 387 |
| apple | 68 | 256 | 283 | 162.9 | 1.00 | 163 | 0.417 | 97, 63, 318, 385 |
| orange | 68 | 256 | 256 | 189.6 | 1.00 | 190 | 0.358 | 68, 63, 376, 385 |
| pear | 66 | 255 | 302 | 134.4 | 0.92 | 146 | 0.452 | 132, 62, 247, 387 |
| peach | 64 | 257 | 274 | 172.0 | 1.00 | 172 | 0.372 | 85, 63, 342, 385 |
| lemon | 60 | 256 | 256 | 152.7 | 0.93 | 164 | 0.366 | 118, 63, 276, 385 |
| kiwi | 58 | 256 | 259 | 173.7 | 0.95 | 183 | 0.317 | 97, 63, 317, 385 |
| strawberry | 52 | 255 | 258 | 150.8 | 0.95 | 159 | 0.327 | 110, 63, 290, 386 |
| cherry | 48 | 244 | 348 | 98.8 | 1.00 | 99 | 0.485 | 144, 62, 223, 387 |
| golden | 64 | 257 | 262 | 172 (outline fill) | 1.00 | 172 | 0.372 | 11, 2, 489, 508 |

Halves: `anchor` = centre of each half's `contentBox` (for example apple `half_a` box 102, 93, 308, 325 gives `(256, 255.5)`); `halfScale` 1 for every fruit except golden 0.91 (measured half body radius over whole body radius: watermelon 0.96, pineapple 1.04, apple 0.99, orange 0.99, pear 0.99, peach 0.94, lemon 1.01, kiwi 0.95, strawberry 0.93, cherry 1.00, golden 0.85 before the outline correction).

### A.2 Other sprites

| id | anchor (x, y) | body r | Notes |
|---|---|---|---|
| `bomb_whole` | 237, 318 | 154 | contentBox 82, 39, 347, 434; `points.fuseTip` (383, 88). Scale 64 / 154 = 0.416. |
| `medallion_freeze|frenzy|double|clock` | 256, 257 | 212 | contentBox about 47, 41, 418, 431 (differs by 2 px). Scale 62 / 212 = 0.292. |
| `fx_splash_*` (512 px source) | box centre | | contentBox about 380 x 436; shipped at 384 px, contentBox scales by 0.75. |
| `fx_bomb_explosion` (987 x 895 source) | alpha centroid (513, 489) x 0.778 = (399, 380) at 768 px | | |
| `fx_slice_flash` (1021 x 543 source) | alpha centroid (502, 262) x 0.752 = (377, 197) at 768 px | | `axis.angleRad` -0.480 (-27.5 degrees, rising to the right, y down), `axis.lengthPx` 860 at 768 px (1144 at source size). |
| `fx_blade_trail_tex` (1244 x 189 source) | box centre | | Almost horizontal tapered brush, alpha centroid (516, 105) of 1244 x 189. |
| `cursor_idle` (256 x 261) | 112, 146 | 109 | ring outer radius from the dark ring extent 4 to 221 (row) and 36 to 255 (column). |
| `cursor_cutting` (256 x 269) | 104, 144 | 100 | anchor = aim dot centre (103, 144); radius from the column extent 39 to 239. Verify with the overlay sheet. |

### A.3 UI kit

| id | Slice (shipped px) | Label or cells | Notes |
|---|---|---|---|
| `button_primary_default` (840 x 262, box 3, 3, 834 x 256) | `l = r = 190, t = b = 0` | `label` `l 110, r 110, t 46, b 46` (measured plate x 97 to 728, y 39 to 218 of the file) | Focused (840 x 281), pressed (840 x 262), disabled (840 x 264; grey plate 17 to 816 wide) carry `ref: button_primary_default` and the same slice and label. |
| `button_secondary_default` (840 x 227, box 3, 3, 834 x 221) | `l = r = 160, t = b = 0` | `label` `l 125, r 120, t 56, b 56` (measured inner rectangle x 122 to 723, y 54 to 173) | States 840 x 245, 229, 233. Secondary plates are paper coloured: label text is ink. |
| `toggle_on` (840 x 247), `toggle_off` (840 x 243), `toggle_focused` (840 x 270) | none | `cells` `[{x .03, y .11, w .45, h .78}, {x .52, y .11, w .45, h .78}]` of the box (measured cell interiors: x 27 to 409 and 429 to 812) | Picture with vermilion on the LEFT: `toggle_off`; on the RIGHT: `toggle_on`, `toggle_focused`. |
| `stepper_minus|plus_*` (336 x 346 to 359) | none | none | States share the default's scale (`ref`). |
| `panel_9slice` (512 x 512 shipped) | `l = r = t = b = 48, scale 0.5` | none | |
| `timer_ring` (512 x 508) | none | `ring` `cx 256, cy 254, outer 253, bandMid 203, bandHalf 31, hole 153` | Measured on the horizontal centre row. |
| `logo_title` (1400 x 714) | none | none | Aspect 1.96. |
| `icon_*`, `glyph_*` (256 x 256) | none | none | Box centre anchors. |

### A.4 Stage layers

| Stage | Far | Mid | Near | Brief notes |
|---|---|---|---|---|
| classic | `bg_classic_far.jpg` | `bg_classic_mid.png` | `bg_classic_near.png` | Dawn; flat sun; near bamboo thick (alpha 0.85). |
| arcade | `bg_arcade_far.jpg` | `bg_arcade_mid.png` | `bg_arcade_near.png` | Lantern festival at dusk; near lanterns and posts (alpha 0.8). |
| zen | `bg_zen_far.jpg` (the second try) | `bg_zen_mid.png` | `bg_zen_near.png` | Stone garden; near petals and a branch (alpha 0.8). |
| menu | `bg_menu_far.jpg` | `bg_menu_mid.png` | `bg_menu_near.png` | Night; veiled (4.2). |
