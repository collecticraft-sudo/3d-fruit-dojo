# 3D Fruit Dojo: the asset pipeline

| Item | Value |
|---|---|
| Owner | Asset engineer (tools, `public/assets/`, the `/assets/` rules of `server.js`, this document) |
| Contract | `docs/assets-integration.md` (sections 1, 2, 8, 9). This document says how the contract is built, measured and delivered. Deviations are logged in `docs/contract-notes.md`. |
| Inputs | `design/` (the AI-generated art from Higgsfield GPT Image 2.5, style "Ink and Paper Dojo") |
| Output | `public/assets/`: 102 optimised images, two WOFF2 fonts with their licence texts (`fonts/`, 36 KB, `docs/typography.md`), `manifest.json`, `PROVENANCE.csv`. 23.2 MiB of images in total. Committed to the project, so the game runs without ffmpeg. |

> **Honesty about hardware.** Nothing here touches the Joy-Con 2. Every number in this document was measured on files, or in a headless Google Chrome 154 on the development Mac (marked as such). Nothing was measured on the owner's display, GPU or frame rate. That is listed under "Not verified" at the end.

## 0. Fonts at run time

The two WOFF2 files in `public/assets/fonts/` are loaded by `render/fonts.js`, started by `app.js` before the first frame and awaited in the same 2.5 s boot cap as the art group `core` (final integration, 2026-10-01). `server.js` serves them as `font/woff2` with the `/assets/` cache rules. `?fonts=0` keeps the art and the system fonts; `?assets=0` turns both off and requests nothing under `/assets/`. See `docs/typography.md`.

## 1. The commands

| Command | What it does |
|---|---|
| `npm run build:assets` (or `node tools/build-assets.mjs`) | Build everything: encode `design/` into `public/assets/`, measure the shipped files, write `manifest.json` and `PROVENANCE.csv`, print a size report. About 6 seconds on the development Mac (it runs up to 8 ffmpeg processes at once). |
| `node tools/build-assets.mjs --check` | Rebuild into a temporary folder and compare with `public/assets/`. Exit 1 on any difference. |
| `node tools/build-assets.mjs --measure` | Print what the pixels of the shipped files say (body circles, halves, label plates, toggle cells, timer ring, fuse tip, alpha centroids, slice-flash axis) next to the numbers of `tools/asset-spec.mjs`. Exit 1 when a value is out of tolerance. |
| `node tools/build-assets.mjs --overlay <dir>` | Write four debug sheets (collision circles on paper and on dark, halves, UI plates, edge zoom) into `<dir>`, which must be outside `design/` and `public/`. |
| `node tools/build-assets.mjs --layer-width 1920` | Ship the mid and near layers at 1920 x 1080 (step 1 of the weight ladder, section 6). |

Other options: `--out <dir>` (another output folder, never inside `design/`), `--jobs <n>` (parallel ffmpeg processes), `--no-fallback`, `--help`.

Requirements: Node 22 or newer, no npm packages. **ffmpeg is needed to build and to check, never to play, measure or draw the debug sheets.** Without it the build stops with a message that says how to install it (`brew install ffmpeg`), or set `FFMPEG=/path/to/ffmpeg`. ffmpeg is started with `child_process.execFile` and an argument array, never through a shell.

The tool writes only inside the output folder (`public/assets/` by default) and never touches `design/`. It builds into a temporary folder first, so a failed build leaves `public/assets/` as it was. It deletes only files that the previous `manifest.json` listed and the new one dropped. The project folder is not a git repository, so "committed" means "the generated files are in place and are the input of `--check`".

## 2. What is shipped

```
public/assets/
  manifest.json      the machine-readable index (section 4)
  PROVENANCE.csv     one row per image row of design/assets.csv, then one row per font (section 7)
  fonts/             dojo-display.woff2, dojo-ui.woff2 and their OFL texts (section 2.1)
  sprites/           fruit_<id>_whole|half_a|half_b, fx_splash_<id>, bomb_whole, medallion_<id>    PNG RGBA
  fx/                fx_bomb_explosion, fx_slice_flash, fx_blade_trail_tex                          PNG RGBA
  icons/             icon_*, glyph_*                                                                  PNG RGBA
  ui/                button_*, stepper_*, toggle_*, panel_9slice, timer_ring, cursor_*, logo_title    PNG RGBA
  backgrounds/       bg_<stage>_far (JPEG), bg_<stage>_mid, bg_<stage>_near (PNG RGBA)
```

File name = design id + extension. The 11 fruit are watermelon, pineapple, apple, orange, pear, peach, lemon, kiwi, strawberry, cherry and golden (the Golden Apple). `meter_bar` is not shipped (its threshold marker is baked in at 61 percent, the game's marker moves); it still has a row in `PROVENANCE.csv` with `shipped=no`.

| Kind | Files | Shipped size (px) | Total on disk |
|---|---|---|---|
| Fruit whole (11), bomb, medallions (4) | 16 | 512 x 512, unchanged canvas | 3.54 MiB |
| Halves (22) | 22 | 512 x 512, unchanged | 3.73 MiB |
| Juice splashes (11) | 11 | 384 x 384 (from 512) | 1.22 MiB |
| Fx: explosion, slice flash, blade texture | 3 | 768 x 696, 768 x 408, 1024 x 156 | 0.92 MiB |
| Icons (9), glyphs (5) | 14 | 256 x 256 (from 512) | 0.76 MiB |
| Buttons (8), toggles (3), steppers (8), panel, timer ring, cursors (2) | 23 | 840 wide, 336 wide, 512 x 512, 512 x 508, 256 x 261 and 256 x 269 | 4.80 MiB |
| Logo | 1 | 1400 x 714 (from 1600 x 816) | 1.10 MiB |
| Far layers (4) | 4 | 2560 x 1440 baseline JPEG, quality 4 | 0.56 MiB |
| Mid and near layers (8) | 8 | 2048 x 1152 PNG RGBA (the brief allows 2560 x 1440 at most) | 6.56 MiB |
| **Total** | **102** | | **23.19 MiB** (24 311 481 bytes) |

Budget (contract 1.7): 40 MiB total (41 943 040 bytes), 3 MiB per file, target about 35 MiB. The tool and the manifest test enforce the two hard limits. By group: `core` 16.07 MiB, `stage:classic` 2.03, `stage:arcade` 1.44, `stage:zen` 1.92, `stage:menu` 1.74. The biggest files are `bg_classic_mid` 1.36 MiB, `bg_zen_mid` 1.27, `logo_title` 1.10, `bg_menu_mid` 1.01 and `fx_bomb_explosion` 0.65.

### 2.1 Fonts and their licences (restyle round, 2026-10-01)

Two small web fonts ship for the canvas text; they are optional (the game falls back to the system fonts, `docs/typography.md`). The source of truth is `design/fonts/fonts.json`; `design/fonts/build-fonts.py` (Python fontTools and brotli, dev time only) subsets the upstream TTF files in `design/fonts/src/` into `design/fonts/dist/`; `npm run build:assets` copies those, with the licence texts, into `public/assets/fonts/` and records them in the manifest (`fonts`, `fontBytes`, `fontBudget`) and in `PROVENANCE.csv` (rows `font_display`, `font_ui`: shipped hash, source file and hash, licence). The build refuses a font that is not WOFF2, is over 400 KB, has no licence file or takes the fonts over 150 KB; `--check` compares them byte for byte.

| Credit | Font | Author | Licence | File |
|---|---|---|---|---|
| Display text (family `DojoDisplay`) | Lilita One 1.002, Latin subset | Juan Montoreano | SIL Open Font License 1.1 (`fonts/OFL-lilitaone.txt`) | `fonts/dojo-display.woff2`, 9.5 KB |
| UI text (family `DojoUI`) | Fredoka 2.001, variable weight 500 to 700, Latin subset | Milena B. Brandao, Ben Nathan and the Fredoka Project Authors | SIL Open Font License 1.1 (`fonts/OFL-fredoka.txt`) | `fonts/dojo-ui.woff2`, 26.4 KB |

Both were downloaded on 2026-10-01 from the Google Fonts open-source repository (`google/fonts`, `ofl/lilitaone` and `ofl/fredoka`). The subsets are modified versions, so their internal family names are "Dojo Display" and "Dojo UI" (the OFL forbids a modified version to keep the Reserved Font Name "Lilita One"). For a credits page: "Fonts: Lilita One by Juan Montoreano and Fredoka by the Fredoka Project Authors, both SIL Open Font License 1.1."

### Encoding rules

* **Sprites** are written with `-compression_level 9 -pred mixed`. A sprite that keeps its size is only re-encoded (`format=rgba`): every pixel, transparent ones included, is identical (a test proves it).
* **Scaling** is done in premultiplied alpha with a Lanczos filter (`format=gbrap16le,premultiply=inplace=1,scale=W:H:flags=lanczos,unpremultiply=inplace=1,format=rgba`). Scaling straight RGBA with a transparent background would blend the hidden colour of the transparent pixels into the edge and leave a dark or light fringe. A test scales a red disc whose transparent pixels are hidden black: with this chain every visible pixel stays pure red (within 8-bit rounding on the faintest edge pixels), while the naive chain leaves dark edge pixels (the same test proves the naive one is worse, so it can fail). The debug sheet `overlay-edges.png` shows the edges of a scaled splash, an icon and a medallion on white, paper and black: no fringe.
* **Far layers** are `-q:v 4 -pix_fmt yuvj420p -huffman optimal`, baseline (not progressive). The source must be opaque: the tool refuses a far layer whose PNG has transparent pixels.
* **Determinism.** `-fflags +bitexact -flags:v +bitexact -map_metadata -1`, no timestamps in any output file. The same `design/` gives byte-identical files on one machine; `--check` proves it (and passes with a note if only the encoder build differs and every image decodes to the same pixels).
* **Alpha threshold.** `contentBox` is measured on the SHIPPED file, on pixels with alpha of at least 24 of 255. The tool decodes the PNG itself (`tools/lib/png.mjs`, Node built-ins only), so it does not depend on ffmpeg for measuring.

## 3. What is measured and what a human decides

`tools/asset-spec.mjs` is the one data table. **A human decides** (in that file): the target size, which asset ships, the body circles, `halfScale`, the slice margins, the label insets, the toggle cells, the timer ring geometry, the cursor pivots and the bomb fuse tip. **Machines measure** (in the build): `contentBox`, `bytes`, `width`, `height`, the alpha centroid anchors of the two big fx, the slice-flash axis and the stage luminance.

`--measure` compares the human values with the pixels. Tolerances: body radius 3 percent, body centre 5 percent of the radius, ring geometry 3 percent of the outer radius, fuse tip 15 px, drawn size of a half within 10 percent of its whole, a label rectangle not more than 12 px outside the flood-filled plate, a toggle cell inside the measured cell. A test (`test/assets/tools.test.js`) runs the same report on the committed files and fails when any value drifts out of tolerance. That is the "body table matches `--measure` within 3 percent" test of contract 8.2.

### Body circles (contract 1.5)

The game scales every whole by `radius / body.r`, so the body circle must be the visible fruit. The measured algorithm: mask = alpha at least 200, morphological opening with a disc of radius 40 px (removes stems, leaves, crown spikes and the fuse), centroid of the opened mask, radius of the circle with the same area, divided by the shape correction `fit` (1 for round fruit, 0.86 pineapple, 0.92 pear, 0.93 lemon, 0.95 kiwi and strawberry). The opening runs on an exact Euclidean distance transform, so it takes 10 ms per sprite.

| Result | Detail |
|---|---|
| Ten fruit, four medallions | The measured radius equals the seeds of the contract to 0.1 px (the algorithm is the same). Centres differ by 0.5 px: the seeds count pixel indices, the tool measures in continuous coordinates where pixel `x` covers `[x, x+1)`. The spec keeps the integer seeds. |
| Golden apple | Own algorithm (the glow ring would inflate the body): the largest 8-connected component of dark ink pixels is the outline, the body is the outline plus everything it encloses, then the same opening. Measured (258, 267) r 169.4, seed (257, 262) r 172. The spec keeps the seed: it is 1.5 percent off in radius and 3 percent of r off in position, and its circle sits on the visible apple bottom and sides (`overlay-bodies.png`). |
| Bomb | Measured (237, 311) r 158.0, seed (237, 318) r 154. The opening keeps the stem collar at the top, which pulls the measured circle up. On the overlay the seed circle sits on the sphere. The spec keeps the seed: 2.6 percent in radius, 4.7 percent of r in position, inside the tolerance. |
| Halves | `halfScale` is 1, golden 0.91 (contract 1.6). The drawn size of a half against its whole, after `halfScale`, measures 0.93 to 1.05 (golden 1.02). The two smallest ratios are peach 0.937 and strawberry 0.928. |
| Cursors | Pivots by inspection of the overlay, not measured by the opening (the ring has streaks). |

Open one debug sheet to check them yourself: `node tools/build-assets.mjs --overlay /tmp/dojo-sheets`. The item order of `overlay-bodies.png`, row by row, on paper (top half) and on dark (bottom half): watermelon, pineapple, apple, orange, pear, peach, lemon, kiwi / strawberry, cherry, golden, bomb, freeze, frenzy, double, clock. `overlay-halves.png`: whole, half A, half B for two fruit per row in catalogue order. `overlay-ui.png`: primary and secondary button (yellow = flood-filled plate, green = label rectangle), the three toggles (green cells), the timer ring (blue outer, magenta band middle, green hole), the two cursors, the panel with its nine-slice margin.

If a fruit visibly overflows its circle by more than about 15 percent, lower its `fit` in `tools/asset-spec.mjs` (the manifest value is normative once built).

## 4. The manifest

`manifest.json` follows contract 1.4 (fields, groups, entry schema). It is plain ASCII JSON, top level pretty printed, one asset per line, no timestamps. What to know beyond the contract:

* **Groups.** `groups` lists ids in preload order: `core` (90 files: logo, panel, buttons, cursors, steppers, toggles, timer ring, the three menu fruit with their halves, the other eight fruit, bomb, medallions, splashes, fx, icons, glyphs), then `stage:classic`, `stage:arcade`, `stage:zen`, `stage:menu` (far, mid, near each).
* **`anchor`.** Wholes, bomb, medallions and cursors: the body centre (cursors: the aim dot). The two big fx (`fx_bomb_explosion`, `fx_slice_flash`): the alpha centroid (weighted by alpha), as in contract 3.6 and Appendix A.2 (contract 1.4 says "centre of contentBox" for everything else; the more specific text wins, logged in the contract notes). Everything else: the centre of the `contentBox`.
* **`axis`** of `fx_slice_flash`: principal axis of the alpha (weighted PCA, alpha at least 24), angle in radians (y down, rising to the right is negative) and the extent of the content along it. Measured angle -0.4807 rad, length 860.2 px, the seeds say -0.480 and 860.
* **`points.fuseTip`** of the bomb: the centre of the spark, (383, 88). The tool measures the bounding box centre of the warm pixels of the spark and reports 3.4 px difference.
* **`halfScale`** is the spec value times `512 / shipped width`, so it stays correct if the halves ship at 448 px (weight ladder step 3): 1.1429, golden 1.04.
* **Additive keys** (logged in the contract notes): `build` (`layerWidth`, `farQuality`, `halfWidth`: the options that made the files, so `--check` reproduces a build that needed a fallback) and, inside every `stages.<id>`, `centreLinear` and `edgeLinear` next to `centreLuma` and `edgeLuma`.

### Stage luminance (contract 4.6)

The tool composes the shipped far, mid and near layers of each stage the way the canvas does (source-over in gamma-encoded sRGB, near and mid multiplied by `ART_CONFIG.stage.layerAlpha`), maps them onto the 1920 x 1080 field with the overscan of `ART_CONFIG.stage.overscanPx` (layers cover 2000 x 1125 logical px centred on the field), and averages over the play area x 480 to 1440, y 180 to 900 (`centre`) and over the rest of the field (`edge`).

* `centreLuma`, `edgeLuma`: mean of `0.2126 R + 0.7152 G + 0.0722 B` on the gamma-encoded values, 0 to 1. This is what a designer calls "luminance 65 percent to 92 percent" (game-design section 11) and it matches the example of the contract (0.81 and 0.74).
* `centreLinear`, `edgeLinear`: the same on linearised values (the WCAG relative luminance, useful for contrast ratios). About 0.18 to 0.2 lower.

| Stage | centreLuma | edgeLuma | centreLinear | edgeLinear |
|---|---|---|---|---|
| classic | 0.748 | 0.711 | 0.568 | 0.527 |
| arcade | 0.804 | 0.618 | 0.629 | 0.436 |
| zen | 0.846 | 0.756 | 0.688 | 0.577 |
| menu (night) | 0.202 | 0.294 | 0.038 | 0.105 |

The three round stages are inside the calm-background range of contract 4.6 (0.60 to 0.93): the tool prints a warning and exits with code 1 if one leaves it, and the manifest test asserts it. In these three stages the near layers (bamboo, lanterns, petals) sit at the sides and do not touch the play area, so `layerAlpha.<stage>.near` does not change `centreLuma` at all (measured: identical to 3 decimals for alpha 0 to 1); the `mid` layer changes it by at most 0.02 (linear scale). The night stage is exempt and is drawn under the paper veil of `ART_CONFIG.stage.veil`. Whether that veil gives enough contrast to every ink text is for the Stage engineer and QA to verify on screen: with a veil of alpha `v` over a night stage of `centreLuma` `L`, the veiled backdrop is about `v * V + (1 - v) * L` in the gamma-encoded scale, where `V` is the luma of the veil colour (paper `#EADFC8` has 0.878; since art review round 1 the veil is the tint `#C9D3E8`, contract 4.2). The numbers of this section and of `manifest.json` describe the layer files as shipped, before the stage extras of contract 4.7 (erase rectangles, lift, dim disc); those change the composed stage, not the files, and `build-assets --check` does not see them.

## 5. Weight and memory

Decoded size is `width x height x 4` bytes, whatever the file size.

| Set | Files | On disk | Decoded (arithmetic) |
|---|---|---|---|
| `core` | 90 | 16.07 MiB | 70.3 MiB |
| one stage (far 2560 x 1440, mid and near 2048 x 1152) | 3 | 1.4 to 2.0 MiB | 32.1 MiB |
| all four stages | 12 | 7.12 MiB | 128.3 MiB (never resident together: contract `maxResidentStages` is 2) |

Measured in headless Google Chrome 154 on the development Mac, against the real server on port 8212 with the real CSP (the index page, `?assets=0` so the game itself loaded nothing):

* All 102 files load, decode and have exactly the sizes of the manifest. **No Content-Security-Policy violation** (a `securitypolicyviolation` listener stayed empty).
* Loading and decoding all 90 `core` images with `Image.decode()` took 183 ms wall on loopback (slowest single image 106 ms). One stage of 3 layers took 21 ms. The other nine layers took 82 ms.
* The resident set size of the Chrome process tree grew by about 110 MiB for `core` and 33 MiB for one stage (ps `rss`, so it includes allocator slack and cached compressed data). It agrees with the arithmetic above within that slack; it is a rough check, not a profile.

The weight ladder of contract 1.7 is implemented in the build. If a build goes over 40 MiB or a file goes over 3 MiB, the tool applies in this order, prints what it did, and records it in `manifest.build`: (1) mid and near layers at 1920 x 1080, (2) far JPEG quality 5, (3) sprite halves at 448 px (with `halfScale` compensated). The current build needs none of them (`build`: `layerWidth` 2048, `farQuality` 4, `halfWidth` 512). A test forces all three with an impossible budget and checks the order, the 448 px halves and the compensated `halfScale`.

## 6. Delivery (`server.js`)

* **MIME types** added: `.jpg` and `.jpeg` (`image/jpeg`), `.csv` (`text/csv; charset=utf-8`). `.png` and `.json` were there.
* **Cache.** Files under `/assets/` answer with `Cache-Control: no-cache` and a weak `ETag` `W/"<size>-<mtimeMs>"`. A matching `If-None-Match` (a list, weak or strong spelling, or `*`) answers `304` with the same security headers, the ETag and no body. `HEAD` behaves like `GET` without a body. A rebuilt file has a new mtime and so a new ETag. Every other path, and every 404, keeps `no-store`. The decision uses the real path, so a symlink inside the web root that points into `/assets/` gets the same rules.
* **Path safety** is unchanged: root escape, symlink escape, dot files and directory listings are refused (tests repeat the traversal spellings under `/assets/`).
* **CSP.** The header of HTML documents already allows what the art needs and nothing more: `img-src 'self' data: blob:`, `connect-src 'self'` (the manifest is fetched from the server). Same-origin images load; `data:` and `blob:` are there for a canvas-derived image, the loader does not need them. No external host, no wildcard, no `unsafe-eval`, scripts stay `'self'`. Measured: no violation in Chrome (section 5).
* The console lines say "3D Fruit Dojo". `/__health` still answers `{"ok":true,"name":"joycon-ninja"}` and the bridge header is unchanged.

## 7. Provenance

`PROVENANCE.csv` (UTF-8, LF, header row): `id,file,shipped,source_file,source_sha256,shipped_sha256,bytes,width,height,higgsfield_job_ids,model,csv_source`. One row for every image row of `design/assets.csv` (103), in the order of that file, then two rows for the fonts (`font_display`, `font_ui`: no size, job id or model; `csv_source` names the font, its author, the licence and its file). The three glyphs that the restyle round replaced (`glyph_joycon_l`, `glyph_joycon_r`, `glyph_sync_button`, from `design/icons_v2/`) keep the Higgsfield job id of their first version in `csv_source` and say that they were replaced; the generation record of the replacement is not kept. `source_sha256` and `shipped_sha256` make a silent replacement of an input or an output visible. `higgsfield_job_ids` are the 36-character ids found in the `source` column, joined by `;`; `model` is `gpt_image_2_5`; `csv_source` is the source column verbatim. The `meter_bar` row has `shipped=no` and empty shipped columns. `manifest.json` carries `designCsvSha256`. Tests compare every row with `design/assets.csv` (skipped, not passed, when `design/` is absent). The 20 audio rows of the CSV stay a wish list; the game keeps synthesising every sound.

## 8. Adding, replacing or tuning an asset

**Replace the art of an existing id.** Put the new PNG at the same path in `design/`, then `npm run build:assets`. The build refuses a far layer with transparency and an image with no visible pixel. Run `node tools/build-assets.mjs --measure`; if a body or plate is off, adjust the number in `tools/asset-spec.mjs` and check the sheets from `--overlay`.

**Add a new asset.** (1) Add the image and its row to `design/assets.csv` (the tool stops if the CSV and the spec disagree, and names the missing side). (2) Add a row in `buildSpec()` of `tools/asset-spec.mjs`: folder, kind, group, target size, and the extras it needs (`body`, `slice`, `label`, `cells`, `ref` for a state variant of a widget, `ring`, `points`). Put it where its load order matters: the order of the rows is the manifest order and the preload order of `core`. (3) `npm run build:assets`, then update the id lists of `test/assets/manifest.test.js` and the loader consumers. (4) Never write the path in code: consumers use the id and the manifest.

**Change a stage.** `layerAlpha` and the veil are data in `public/js/render/art-config.js`. The tool reads `layerAlpha` for the luminance numbers, so rebuild after changing it.

**Fallback of an asset.** Removing a file or failing to load it is always safe: the game draws its procedural art (contract principle 1).

## 9. Tests (`test/assets/`)

| File | What it covers | Needs |
|---|---|---|
| `manifest.test.js` | the fonts (list, sizes, hashes, licence texts, budget, `FONT_FILES` equals the manifest, the stacks of `palette.js`), schema, ids the contract promises (102), unique ids, groups and preload order, files exist, `bytes`, PNG and JPEG headers, sizes of contract 1.3, RGBA with transparent pixels, `contentBox` recomputed from the file, budgets, body and `halfScale` and `ref` and `slice` and `label` and `cells` and `ring` and `axis` and `points`, stage luminance range, ASCII English JSON | nothing |
| `provenance.test.js` | 103 image rows and 2 font rows, header, hashes of every shipped file, `meter_bar` row, job ids, rows equal `design/assets.csv`, source hashes | `design/` for the last two checks (skipped without it) |
| `server-assets.test.js` | MIME types, no-cache and ETag, 304 with a list of tags and `*`, HEAD, `no-store` elsewhere, traversal under `/assets/`, symlinks, dot files, real files served with exact bytes, CSP, console text | nothing |
| `tools.test.js` | PNG decoder (all colour types, filters, depths), JPEG size, EDT and opening, body measures, centroid, PCA, ring, CSV, the spec table, targets, ladder, ffmpeg arguments, `--measure`, `--overlay`, command line, missing ffmpeg, `commitStaging`, `compareBuild` | nothing |
| `pipeline.test.js` | premultiplied scaling without fringe, lossless re-encode, `--check`, `--layer-width` and `--out`, the weight fallbacks | ffmpeg and `design/` (about 30 s; skipped without them) |
| `loader.test.js` | the real loader (`render/assets.js`) with fake images, timers, fetch and canvases (`test-support/assets/loader-rig.js`): load order and concurrency, groups, events and their order, generation, failures of every kind (manifest, status, JSON, version, timeout, error, size, decode), release and reload, cancelled loads, low priority and its promotion, `scaled` and `sliced` sizes and caches, halving steps, the bitmap route and its `close()`, dispose | nothing |
| `boundaries.test.js` | `game/`, `motion/`, `input/`, `shared/` never import the art modules; no hard-coded asset path; only the loader creates images; `art-config.js` is data only; the loader imports in Node; the manifest has no URL; only png, jpg, json, csv (and woff2 and txt under `fonts/`) ship | nothing |
| `fonts-pipeline.test.js` | the font step of the build (`tools/lib/fonts.mjs`): byte-for-byte copy with the licence, manifest entry and provenance row, the checks (missing file, not WOFF2, missing source or licence, 400 KB per file, 150 KB in total), `fonts.json` validation, the real `design/fonts` | nothing |

## 10. Not verified, and open points

* **Frame cost and real memory on the owner's Mac** were not measured. The game with its art was measured in headless Chrome on the development Mac (section 11); that says nothing about the owner's display, GPU or thermal behaviour (HW-1, UNVERIFIED-ON-HARDWARE).
* **Visual review on screen** was done by the Integrator on stills of every screen and of the three modes in headless Chrome (section 11): the layers stay behind the fruit and calm, the menu veil went from 0.45 to 0.58 (measured contrast), and the HUD's small labels get a paper outline over a stage backdrop. Whether a petal or a lantern is ever mistaken for a fruit in real play is a human judgement that nobody has made yet.
* **The controller glyphs** (`glyph_joycon_l` and `glyph_joycon_r`) were replaced on 2026-10-01 by the generic gamepad pictures of `design/icons_v2/` (one neutral gamepad, no copy of a real controller; the sync-button hint was replaced too). The switch `ART_CONFIG.glyphs.enabled` stays `false`, as the config says: turning it on is the owner's and the UI engineer's decision. The new pictures are landscape (content box 218 x 148 and 216 x 165 px of 256), the old ones were portrait, so `test/ui/art-manifest.test.js` "the glyphs keep the sizes of the contract" needs its expectation re-pinned (`docs/contract-notes.md`, "Restyle requests for the UI engineer").
* **Body values of the bomb and the golden apple** keep the contract seeds while the opening measure gives slightly different values (section 3). They are inside tolerance and visually right on the overlay.
* **`--check` across machines.** Another ffmpeg or zlib build can encode the same picture to other bytes. `--check` then passes with a note when every image still decodes to the same pixels; a real change of art or spec fails it.
* **Halves 448 px, layers 1920 px, far quality 5** are the fallbacks, none is used today.

## 11. The game with its art, measured (Integrator)

Everything below was measured in headless Google Chrome 154 on the development Mac, against the real server (`server.js`, real CSP, real files of `public/assets/`), with the built-in simulator. It is **not** a measurement of the owner's Mac, display or GPU, nor of anything about the Joy-Con (UNVERIFIED-ON-HARDWARE, HW-1). Headless Chrome paints with its own compositor at 60 Hz, so the frame interval below proves that the game keeps up there, not how a real display behaves. The scripts are throwaway files in the scratchpad of the session; the numbers that a test can pin are pinned (`test/e2e/perf.test.js`, `test/e2e/art.test.js`).

**How the loader loads** (`public/js/render/assets.js`). In a browser the loader fetches each file and decodes it into an `ImageBitmap`; it closes the bitmap when its group is released. An `<img>` route exists for the tests and for a browser without `createImageBitmap`. The reason is memory, measured: with `<img>` elements the decoded pixels of a released stage stayed in the browser's image caches (24 stage switches kept about 130 MB more in the renderer process, 6.5 MB per switch, with no plateau in 8 cycles), with fetch and bitmaps the same 24 switches move the renderer process from 367 to 372 MB. The bitmap route also removed the one long frame at start (33 to 50 ms while `core` was baked) that the `<img>` route showed in most runs.

| What | Value | How |
|---|---|---|
| Time from navigation to `__ninja.ready` (manifest, 90 images of `core` fetched, decoded and baked, boot screen up) | 155 to 210 ms | loopback, `ps`-free timer in the page |
| A round stage: loaded, then fully on screen | 30 to 60 ms, then 450 ms (the 400 ms crossfade) | polled every frame from `__ninja.getAssets()`; first draw after ready starts the fade |
| Frame interval, 1920 x 1080 at 1x, three rounds of 10 s (Classic, Arcade, Zen, a bot cutting fruit) | every frame 16.7 ms (max 16.8 ms), none above 20 ms, `degradeLevel` 0 | `requestAnimationFrame` deltas, 1932 to 1954 frames |
| Frame interval, 1440 x 900 at 2x (2880 x 1800 backing store) | the same: 2275 frames, max 16.8 ms, none above 20 ms | same |
| JavaScript cost of one frame (game step plus drawing), 20 s of Classic at 1080p | 0.53 ms on average, p95 0.8, p99 1.1, worst 9.8 ms; the same run with `?assets=0` averages 0.56 ms | `test/e2e/perf.test.js` (budget 6 ms) |
| Resizing and changing the density during a round (1920 x 1080 at 1x, 1280 x 720 at 2x, 800 x 450, 1440 x 900 at 2x, 1000 x 1000) | stays 60 fps, the pre-composed backdrop is rebuilt when the density step changes, no console message | scripted `Emulation.setDeviceMetricsOverride` |
| Renderer process resident size (`ps rss`, so allocator slack included), painted (`?assets=0`) | 177 to 201 MB | menu and a round |
| The same with the art, 1920 x 1080 at 1x | about 372 MB after three modes; +190 MB over painted | one round in each mode |
| The same with the art, 2880 x 1800 backing store | about 395 MB (painted 201 MB) | same |
| GPU process, art against painted | about +40 MB at 1x, +70 MB at 2x | `ps rss` |
| 24 mode switches (menu, round, menu, ...) | renderer 367 MB after the first, 372 MB after the last | `HeapProfiler.collectGarbage` before each reading |

Where the +190 MB is: `core` decoded as bitmaps (about 70 MB by arithmetic), the sprites baked into their own canvases at density 2 (about 24 MB by arithmetic, the renderer's note), one stage as bitmaps plus the night stage while it fades (about 33 MB each), the pre-composed backdrop (9 MB at 1x, 15 MB at 2x), the nine-sliced panels and the scaled UI images of the widgets, and the browser's own overhead. It was not split further with a heap or memory profiler; the sum of the parts agrees with the difference within the slack of `ps rss`. The decoded sprites are resident twice (the loader's bitmap and the baked canvas); the contract forbids releasing `core`, so this stays.

**Failures, tried for real** (`test/e2e/art.test.js`, and by hand on a copy of the project). A manifest that fails, a manifest that takes 3.3 s, a sprite, a stage layer and a button image that answer 404, and a copy of the project with one sprite (`fruit_pear_whole`, the menu's Zen fruit), one layer (`bg_zen_mid`) and one UI image (`button_secondary_default`) deleted or renamed: the game starts, plays all three modes at 60 fps, draws only those pictures procedurally, prints one `[joycon-ninja]` warning line per failed group and no error of its own. The only console lines are the browser's own "Failed to load resource" lines for the missing files.

**Not measured:** the owner's Mac (display, GPU, power), a session longer than a few minutes, Safari, Firefox and the "Reduce motion" cost of the crossfade (it is a cut), a real disk that is slow (a slow manifest was simulated, a slow image was not).
