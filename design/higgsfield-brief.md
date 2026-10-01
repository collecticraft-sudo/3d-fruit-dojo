# Higgsfield asset brief (filled in)

Status: STYLE-v1 approved by the owner on 2026-09-30. Phase 0 (style test) done and reviewed, see "Phase 0 results".
Credit costs are noted per phase below; the account balance is not recorded here.
Model decision: GPT Image 2.5 (owner's choice after comparing it with Recraft V4.1 on the same apple).
Language decision: the whole game is in English, UI text included.

## PROJECT
Original single-player arcade fruit-slicing game, working title "3D Fruit Dojo" (the title refers to the 3D-printed sword; the art itself stays flat).
Played with a Nintendo Switch 2 Joy-Con 2 (one controller, left or right, strapped to a 3D-printed sword; the game
also works with mouse and keyboard) on a web engine: HTML5 Canvas 2D with plain ES modules, served locally and played in
a browser. No Unity, no Godot, no Three.js, no Phaser.
There is NO Pro Controller support, so no Pro Controller glyph is drawn.
Must NOT reproduce any existing game's logo, characters, fruit designs or UI. The logo must not contain the words
"Ninja", "Joy-Con" or "Nintendo" (trademarks, and too close to an existing game).
All in-game text is ENGLISH (owner decision, 2026-09-30) and is drawn by the game itself, so no image may contain text, except the logo lettering "3D FRUIT DOJO".

## DELIVERABLE
A complete UI kit, stage backgrounds, fruit assets and sound effects, exported as files and listed in design/assets.csv
(id, role, type, description, size/ratio, style line ref, source). The planned inventory has 123 rows.

## STYLE
Derive ONE style formula first, show it to the owner for approval, then reuse it verbatim in every prompt so all assets
look like one game. The formula grows out of the existing in-game art direction "Ink and Paper Dojo" (docs/game-design.md
section 11), so the new art and the procedural UI drawn by the game do not clash.

STYLE-v1 (superseded by v1.1 below, kept for the record):

> Japanese woodblock print meets bold cel shading: a thick, slightly irregular sumi-ink outline (#14141C) of uniform
> weight, flat two-tone fills with one hard-edged shadow shape on the lower right and one white highlight arc on the upper
> left, warm saturated fruit colours on a calm rice-paper palette (paper #EADFC8, light paper #F4EBD9), accents in
> vermilion #D9432B and gold #F2B134, indigo #1F3A5F ink-wash mountains, matcha green #7BA05B bamboo, a faint paper grain,
> front-facing flat perspective, no photorealism, no 3D render look, no gradients except soft ink-wash skies, no drop
> shadows except a hard 4 px offset, no text, no logos, no characters, original design.


### STYLE-v1.1 (approved by the owner on 2026-09-30, glossy look kept): use this one
The formula is split so that scenery never leaks into objects (the phase 0 button got mountains and bamboo painted inside).
STYLE-CORE goes verbatim into EVERY prompt. STYLE-SCENE goes only into backdrop prompts.

STYLE-CORE:
> Japanese woodblock print meets bold cel shading: a thick, slightly irregular sumi-ink outline (#14141C) of uniform weight, flat
> two-tone fills with one hard-edged shadow shape on the lower right and one white highlight arc on the upper left, warm saturated
> colours on a calm rice-paper palette (paper #EADFC8, light paper #F4EBD9), accents in vermilion #D9432B and gold #F2B134, a faint
> paper grain, front-facing flat perspective, no photorealism, no 3D render look, no gradients, no drop shadows except a hard 4 px
> offset, no text, no logos, no characters, original design.

STYLE-SCENE (backdrops only):
> indigo #1F3A5F ink-wash mountains, matcha green #7BA05B bamboo, soft ink-wash skies (the only place where gradients are allowed),
> a calm low-contrast composition with luminance between 65 and 92 percent and an empty centre.

Logo prompt: STYLE-CORE with "no text, no logos" replaced by "no other text than the words 3D FRUIT DOJO", and the hanko seal must be a plain
red square seal with no characters in it.

Extra rules for every prompt:
- Fruit and hazards are readable by SILHOUETTE, not only by colour (colour-blind players): apple, strawberry and cherry
  must differ in outline.
- Backgrounds stay calm: luminance between 65% and 92%, so fruit, bomb and blade always have the strongest contrast.
- Transparent assets are generated on a flat pure-magenta or pure-white background and cut out afterwards with the
  background-removal tool, then checked on dark and light grounds for halos.

## SCREENS (16:9, 1920x1080 logical, sword/controller-first, visible focus state on every element)
The game draws the screens itself from the components below. Full-screen mockups are optional references (phase 3).
1. Safety screen ("Before you play"): clear space, wrist strap. (added, it exists in the game)
2. Title / main menu: logo and three mode fruit to slice (Classic, Arcade, Zen), plus High scores and Settings.
   The menu is chosen by cutting a fruit or by holding the sword still on it, and by Enter.
3. Controller connect screen: four pairing steps, "hold SYNC" hint with a countdown, pairing status line, primary button
   "Connect Joy-Con (native bridge)", secondary "Chrome Bluetooth", plus Simulator and Mouse only.
   Disconnect and reconnect overlay ("Joy-Con disconnected"). Glyphs: Joy-Con L and R, mouse, keyboard Enter.
   (The template said "Press A to start": this game has no A-button start, it uses SYNC and Enter.)
4. Calibration screen: four steps ("hold still", "point at the screen", "re-centre", practice cut on an apple).
5. In-game HUD: score, best score, combo multiplier, 3 life apples (Classic), timer ring (Arcade, Zen), active power-up
   indicator, safe margins, blade-trail style. (The template said "3 strike icons": here they are life apples.)
6. Pause menu.
7. Game over / results: score, new-record state, rank seal, Retry and Menu.
8. Settings: Sensitivity, Cut threshold, Volume, Reduce flashing, Reduce motion, Hand, Auto re-centre, Hold-still select, plus the
   "Sword tuning" screen. (The template said "vibration": this game has no vibration
   setting yet.)
9. High scores list (one per mode).

## COMPONENTS
Buttons (default, focused, pressed, disabled), steppers "-" and "+" instead of sliders (a sword cannot drag a slider),
two-cell toggles, panel, meter bar, timer ring, icons, sword-point cursor (idle and cutting). Minimum size of anything
selectable: 84 x 84 px logical. Controller glyphs are drawn generically, NOT copied from Nintendo artwork.

## BACKGROUNDS
4 stage backdrops, each with 3 parallax layers (far, mid, near): Classic = dojo at dawn, Arcade = lantern festival at
dusk, Zen = stone garden with cherry trees, plus a darker "dojo at night" version used by the menu.
Design rule: the background is static and calm, all motion belongs to gameplay. So the layers are used for depth and for a
very small response to screen shake and zoom punch (at most a few pixels) and a slow drift in the menu only. The near
layer frames the edges only, the centre stays clear.

## FRUITS AND FX
10 regular fruits (watermelon, pineapple, apple, orange, pear, peach, lemon, kiwi, strawberry, cherry; game display names are the English ones), each with whole +
two sliced halves + juice splash in its own juice colour (colours in docs/game-design.md section 4.1). Plus the Golden
Apple, the bomb, 4 power-up medallions (Freeze, Frenzy, Double, Clock), slice flash, bomb explosion and a blade-trail
texture. Format: 2D transparent PNG at 2x (the engine is 2D canvas, no GLB).
The design document keeps the collision sizes: radii 48 to 92 logical px, so every fruit sprite is exported on a square
512x512 canvas at 2x with a 12% margin.

## AUDIO
NOT generated with Higgsfield. Checked on 2026-09-30: Higgsfield has no standalone sound-effect or music model for this use. Its speech
tool is text-to-speech only, and the models mirelo_text_to_audio (SFX) and sonilo_music (music) exist only for Higgsfield's own
game-generation pipeline and must not be used for standalone audio. So the sound effects and the menu loop come from elsewhere (owner's
choice: keep the game's WebAudio synthesis and improve it, or use another audio tool or licensed sound packs).
The inventory rows with role "audio" in design/assets.csv stay as a wish list. The game keeps synthesising every sound, so it never
goes silent. If files are added later, the engine can load them as optional layers with the synthesised sound as the fallback.
Formats if files are added: WAV 48 kHz for short effects, OGG Opus for the music loop (seamless loop to be checked and trimmed).

## OUTPUT
Transparent PNG at 2x, consistent naming (screen_element_state.png, for example button_primary_focused.png,
fruit_apple_half_a.png, bg_zen_mid.png), everything listed in design/assets.csv (the `source` column records the model and
job id of each generated file).

## PLAN AND BUDGET
Measured costs (GPT Image 2.5): high quality at 2k = 2.75 credits per image, medium quality at 1k = 0.5, low quality at 1k = 0.25.
Generation method: one sheet per fruit (whole + two halves in the same image, so the halves are identical twins), cut into single
sprites locally with ffmpeg after the magenta chroma key. A 2k sheet gives about 800 px per element, enough for the 512 px sprite at 2x.
Phase 1, hero set (about 13 images, about 36 credits, about 60 with retries): 4 fruit sheets (apple, watermelon, orange, strawberry),
1 juice-splash sheet for those colours, Golden Apple sheet, bomb and medallions sheet at high quality, primary button states without
scenery, Classic backdrop far layer plus mid and near layers, logo redo with a plain seal.
Phase 2, the rest of the images (about 100 credits): 6 more fruits, splash sheets, the UI kit sheets (toggles, steppers, panel, icons,
cursor, glyphs), 3 more backdrops with 3 layers each and the darker menu version, FX.
Phase 3, integration in the game (the renderer currently draws everything procedurally): load the sprites, keep the procedural drawing
as a fallback when a file is missing, keep the 60 fps budget, update the tests. Must wait until the English translation is merged.
Audio: outside Higgsfield, see the AUDIO section.

## PHASE 0 RESULTS (2026-09-30, files in design/phase0/)
Cost: about 9 credits. GPT Image 2.5 ran in its cheap mode (quality low, 1344x752, 0.25 credits). Final assets need high quality and
a higher resolution, which costs more per image.

| File | What | Verdict |
|---|---|---|
| p0_00_apple_recraft.png | apple + halves, Recraft V4.1 | Rejected: the "shadow shape" came out as solid black and blue blobs, the halves have a blue rind |
| p0_01_apple_gptimage.png | same prompt, GPT Image 2.5 | Chosen: correct anatomy, cream flesh, five-seed star core, red rind, identical twin halves |
| p0_02_button_states.png | primary button, default and focused | Shape and focus halo work. PROBLEM: mountains and bamboo were painted inside the paper strip |
| p0_03_bg_classic.png | Classic backdrop, dojo at dawn | Very good: calm, pale sun upper right, indigo ridges, bamboo at the edges, empty centre. One flat image, not three layers yet |
| p0_04_logo.png | logo "3D FRUIT DOJO" | Good and readable, orange slice as the O. The hanko seal shows a meaningless pseudo-kanji: replace it with a plain seal |
| p0_05_bomb_medallions.png | bomb + Freeze + Frenzy medallions | Good and consistent, readable by silhouette |

Findings and decisions:
1. Scenery leak: the verbatim formula mentions mountains and bamboo, and the model painted them into objects (the button strip).
   Proposal STYLE-v1.1: split the formula into STYLE-CORE (ink outline, flat two-tone fills, palette, grain, no 3D, no text) used in
   every prompt, and STYLE-SCENE (mountains, bamboo, skies) used only in backdrop prompts. Waiting for the owner's OK.
2. The look is closer to a glossy cartoon than to a matte woodblock print, because the formula asks for a white highlight arc.
   It reads well on screen. A matte variant is possible if the owner prefers it.
3. Transparency works with a free local chroma key (ffmpeg colorkey on #FF00FF plus a 1 px alpha erosion). Checked at 4x zoom on a
   dark ground: no magenta fringe. The Higgsfield remove_background tool stays as a fallback.
4. Parallax layers need separately generated mid and near layers (magenta key) that match the far layer: test with a reference image
   in phase 1.
5. Final sizes: a 1344 px sheet gives about 400 px per element, so every asset is generated on its own at high quality and upscaled
   to the 2x size of design/assets.csv.

## PHASE 1 RESULTS (2026-09-30)
Cost: 43 credits. GPT Image 2.5 at high quality, native transparent background (RGBA), so no chroma key was needed
for phase 1. Files: design/phase1/ (raw sheets), design/sprites/ (24 single sprites, 512x512 at 2x), design/ui/ (2 button states, logo),
design/backgrounds/ (Classic far, mid, near at 3840x2160). The slicer is design/tools/slice-sheet.mjs (no dependencies except ffmpeg).
Checked on paper and on dark grounds: clean edges, no halo.

Produced: apple, watermelon, orange, strawberry and Golden Apple (whole + two halves each), 4 juice splashes (watermelon, orange, apple,
strawberry), bomb, 4 medallions (Freeze, Frenzy, Double, Clock), primary button default and focused, logo "3D FRUIT DOJO" (no seal),
Classic backdrop in 3 layers.

Known issues and decisions for later:
1. The sun on the far layer has an ink outline and a white highlight, so it looks like a glossy ball. Kept for now. A flat sun would need a
   new far layer (4.25 credits) and new mid and near layers.
2. The near bamboo is thick and saturated and on the right it overlaps the sun. Draw it BEHIND the gameplay objects, or keep fruit away from
   x < 300 and x > 1700 (logical px). It is brighter than the "calm background" rule, so a dimmer version may be needed.
3. The button strip is 840x167 (5:1), wider than the 420x130 of the design. The game layout has to use the new proportion or stretch it.
4. Logo v2 (phase1/logo_v2.png) has a stray red square that reads like an apostrophe. Use logo_v3_noseal.png (this is ui/logo_title.png).
5. Sheets with five items (bomb + four medallions) are still large enough (about 440 px per item in the source) for the 2x sprite.

## PHASE 1 REFINEMENTS (2026-09-30, about 20 more credits)
- Far layer v2: the sun is now a flat pale-vermilion disc with a soft ink bleed, no outline, no highlight. Same composition as v1 (edit with
  the first far layer as reference).
- Near layer: v2 came with opaque cream patches around the bamboo (they covered the mountains at the sides and made a hard vertical edge).
  Cause: my prompt said "green mixed with the paper colour". v3 asks for bamboo only, nothing else, and has clean transparency. Slim stalks
  (about 6% of the width per side), and the right side starts below the sun.
- Mid layer v2: hills run edge to edge, two bamboo groves, one soft mist band.
- Buttons: four states in one sheet (default, focused, pressed, disabled), now about 840x262 at 2x, matching the 420x130 design.
- Lesson for phase 2: never write "mixed with paper" or "mist" in prompts for transparent layers: the model turns it into opaque patches.
  Always say "every pixel that is not X must be fully transparent".
- Previews for quick review are in design/previews/.

## PHASE 2 RESULTS (2026-09-30)
Cost: about 92 credits. All image rows of design/assets.csv now have a file: 103 of 123. The 20 remaining rows are audio
(not possible with Higgsfield, see AUDIO).

Produced in phase 2: the 6 remaining fruits (pineapple, pear, peach, lemon, kiwi, cherry: whole + two halves), 7 more juice splashes
(pineapple, pear, peach, lemon, kiwi, cherry, golden), bomb explosion, slice flash, blade-trail brush texture, secondary button (4 states),
steppers (minus and plus, 4 states each), toggles (3), panel, meter bar, timer ring, 9 icons, 2 cursors, 5 input glyphs, and the Arcade,
Zen and Menu-night backdrops, each in 3 layers. Previews are in design/previews/.

Notes and risks:
1. The two controller glyphs (glyph_joycon_l and _r) came out as red slim controllers with a thumbstick and four buttons. They are NOT copies,
   but they are close to the look of a real Joy-Con. Decide before shipping: recolour them (for example indigo), simplify them, or keep.
2. Zen: the upper-left cherry branch covers about half of the sun, and the falling petals sit inside the play area at both sides. Petals are
   small and pink, fruit are bigger, but check it in play.
3. Arcade: the two lantern clusters reach about 20% of the width and 38% of the height, and the wooden posts are dark and heavy. Draw the
   near layers BEHIND the fruit, or scale the lanterns down.
4. Near and mid layers must be drawn behind the gameplay objects. The design rule "calm, static background" stays.
5. The first Zen far layer (phase2/bg_zen_far.png) had a pine, a stone lantern, rocks and red maple trees in it (not a far layer, and too
   loud): discarded. bg_zen_far.png in design/backgrounds is the second try. The Menu night mid and near layers were generated, not
   colour-graded from the Classic ones: the grade turned the mist into a dirty yellow band.
6. Weight: 12 backdrop layers at 3840x2160 PNG are 84 MB. A 4k RGBA layer needs about 33 MB of memory once decoded. For the game, ship the
   far layers as JPEG 2560x1440 (about 230 KB each) and the mid and near layers as PNG 2560x1440 (about 2.4 to 3 MB each), load them per
   stage. ffmpeg here has no WebP encoder, so no WebP. Sprites can stay at 512x512 (about 200 KB) or go to 256x256 (about 50 KB).
7. The raw sheets in design/phase0, phase1 and phase2 (about 230 MB) are only there for traceability. They can be deleted once the sprites
   are final.
8. Buttons: secondary buttons are 840x227 to 245 (about 3.6:1), primary ones 840x262.
