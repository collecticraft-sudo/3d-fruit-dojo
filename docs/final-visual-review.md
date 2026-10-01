# Final visual and UX review (design critic)

Date: 2026-10-01. Role: visual and UX critic. Port 8303 (the server was started by this review and stopped at the end).

**Verdict: FAIL, on two major findings (M1, M2). No critical finding.** Both majors are small, local fixes in the HUD and the combo banner; everything else is minor.

## 0. What was actually done, and what was not

Done (I looked at every picture listed here; they are in `docs/qa/visual-review/`, downscaled JPEGs):

- Headless Google Chrome, driven over the DevTools protocol with the project's own `test-support/e2e` classes (`launchChrome`, `Page`) against `node server.js` on port 8303, `?input=sim&skipsafety=1&clock=manual&mute=1`, the generated art and both fonts loaded, no console error or exception in any run.
- Stills at 1920x1080 and 800x450: menu, settings, sword tuning, calibration 1 to 3, safety, connect (Web Bluetooth layout), Classic, Arcade and Zen with all ten fruit, a golden apple and two bombs on screen, pause, resume, disconnect panel, results of Classic, Arcade and Zen (the 800x450 set covers menu, settings, safety, connect, calibration and the three play screens).
- Contact sheets, a frame every 50 ms for 600 ms (some every 16 ms, some longer): boot and logo entrance (also a zoom of the logo), ink wipe menu to settings and back, countdown 3, 2, 1, GO (five sheets covering 3.4 s), a single slice, combo x5 (also 16 ms steps around the banner entrance), combo x8 (a 10-fruit swing), a bomb (plain, and with fruit 170 to 400 px away), Freeze, Frenzy, Double, Golden apple, Clock, a heaviest-moment scene (Frenzy and Double active, 10 fruit in one swing, a golden apple and a bomb), life lost, game over, time up, pause and resume, results rank stamp for Classic, Arcade and Zen, the blade in normal, Freeze, Frenzy and Double colours.
- Reduce flashes and Reduce motion variants of the bomb, the combo x8 and the golden apple.
- Font coverage: the cmaps of both shipped WOFF2 files were decoded and checked against every character of `strings.en.js` (see 4).

Not done, and nothing here claims it:

- No real Joy-Con, no real display or GPU. Every frame comes from a software rasteriser with the clock stepped by hand (16 ms slices), so I judged composition and timing from frames, not the feel of real-time motion at 60 fps. Motion smoothness, perceived flash strength on a real screen and input latency are UNVERIFIED-ON-HARDWARE.
- No audio was heard (`mute=1`).
- Not looked at: the native-bridge connect and progress screens at small size, calibration step 4, Zen's "Time's up" banner, the Clock power-up in a long round, the `?assets=0` and `?fonts=0` fallbacks (earlier QA covers them), dark-mode OS settings (the game is a canvas).
- Contrast numbers below are measured from the rendered frames (the 4th and 96th percentile of the luminance of a small crop, WCAG formula) and are approximate; a fruit or a glow behind the crop would move them.

## 1. Scores

| Axis | Score | In one line |
|---|---|---|
| SPECTACLE | 7 of 10 | The slice, the 4+ combo banner, the bomb and the golden apple would get a "nice" or a "wow"; the Freeze, Frenzy and Double activations are a banner and a sprinkle, and the results rank seal and the life-lost moment are flat. |
| READABILITY | 7 of 10 | Fruit, bombs and the blade are almost always the clearest things on screen and the effects are mostly brief or behind them; the score numeral and a black banner flash are the two real problems. |

## 2. Findings

### Major (play-relevant or visibly ugly)

**M1. The HUD score turns gold on a peach sky and is hard to read for about 0.6 s after every cut (nearly always in Frenzy or a long combo).**
`hud.js` eases the score colour from ink to `COLORS.gold` (`GOLD_STEPS`, `hs.gold`) with a paper-light outline, and the roll-up lasts longer than the 120 ms in the direction doc. On the Arcade and Classic backdrops the sky behind the score is peach to orange, so gold on it measures about 1.5 to 1.9 to 1 (sample: "114" at 500 ms after a 5-fruit swing, darkest 4 percent `#C2992A` against lightest `#D5BC9A`, ratio 1.46). Contact sheet `f-score-hud.jpg`: 30 and 47 are readable, 102, 114 and 119 are washed out, 120 is back to ink only at 800 ms. The combo pip row and its "x4" fade in the same window. This is the number the player looks at after a combo.
Fix: keep the ink fill and flash the outline or a plate instead; or use the deep gold `#D9892A` over an ink outline (the banner look) instead of a paper outline, and keep the roll to 300 ms.

**M2. The tier 4+ combo banner flashes a hard-edged black slab with gold rules and no text over the top-left of the screen for 2 to 3 frames.**
`renderer.js drawComboBanner` clips the plate "revealed from the left in 120 ms" while the plate is scaled 2.2 times (tier 4) and the text is held back until `reveal > 0.35`. Result: at 130 to 190 ms after the cut a black rectangle of about 250 x 320 px (x 0 to 250, y 120 to 440) with gold double rules sits behind the score and "BEST 0", then jumps to the final plate. It looks like a rendering glitch, not a wipe (`f-combo5-150.jpg`, `f-combo5-fine.jpg` frames 160 and 176 ms; the same in `f-combo10.jpg`). With a higher plate (x7+) it is the vermilion plate.
Fix: reveal the plate from its own centre or from scale 1.0, or start the text at the same moment as the plate, or fade the plate in at alpha with the scale instead of the clip.

### Minor (taste, polish, small readability)

- m1. "TIME" under the timer ring is drawn on top of the combo plate (plate y 190 to 350, label y 195 to 220): the label sits half on the dark plate and half on paper for the whole combo (frame at 200 ms of `f-combo5.jpg`). Move the banner to y 320 or hide the label while a banner is up.
- m2. The "Missed!" popup at the bottom edge overlaps the grey hint pill ("Pause: middle click   Recenter: double click") in Classic (`sheet-lifelost.jpg` 900 to 1150 ms); the pill is only shown with the mouse and simulator, so it is a test-input artifact on a real Joy-Con.
- m3. "So close!" is drawn over the fruit next to the bomb: it covers the top of an apple for about 500 ms (`f-bomb-near-300`, not kept; frames in `f-bomb-near.jpg`). Short and non-fatal, but it is a label on a fruit.
- m4. Power-up banner: a near-black plate 930 x 214 px at y 333 to 547 for 1.45 s (1.2 s hold, 0.25 s fade, measured) right in the fruit apex band (240 to 560). Fruit are drawn over it, so nothing is hidden (`banner-fruit-freeze.jpg`), but the kiwi and the watermelon rind lose their contrast on black. Consider a lower plate alpha for Freeze and Frenzy, or move to y 250.
- m5. "GOLDEN APPLE! +100" sits on the sliced apple and the splash for about 1 s and the blade cursor lands on its last letters when the swing ends there; the halves are readable under it. Raise it 120 px.
- m6. The results rank seal is a flat red rounded square with a white inner line and a word ("Apprentice", "Warrior"). It is the climax of the screen and the weakest art in the game; the direction doc itself lists "a plain red square" as a defect. The stamp animation (slam from the left at 2 times size, a ring, sparks, then the ribbon) is good; the object being stamped is not. Also the dashed placeholder box is visible for the first 100 ms (`sheet-stamp.jpg`).
- m7. Results stats grid: label to value is 80 px but value to the next label is 70 px, so "40" reads as belonging to "Accuracy" at first glance (weight differs, but still). The panel has about 150 px of empty cream above the buttons.
- m8. Life lost is subtle: a 40 px apple icon cracks at the top right, a faint red edge tint and a small "Missed!". It reads, but it is the least dramatic event in the game. The red lives apples sit exactly on the vermilion sun of the Classic stage (`big-play-classic.jpg`, readable thanks to the ink outline, red on red otherwise).
- m9. Settings and tuning: the focus ring covers the first letter of "Auto-recenter" and of "Blade speed" when it rests between rows (`big-settings.jpg`, `big-tuning.jpg`); "Sword selection in menus" is set smaller than every other label; the tuning text "27.4 px per degree when aiming slowly, 27.4 px per degree in a fast swing" repeats the same number.
- m10. Combo x8 (10-fruit swing) crowds the middle of the screen: splats, 8 popups and a stars burst; the +280 bonus lands over the popups. It is the heaviest scene I could build and it stays readable (fruit halves keep their ink outline), but the individual "+25 / +30" popups become unreadable at that density.
- m11. On Freeze, the time-slow tint of the whole screen (blue edge frost) and the blue blade are clear, but there is no strong "time stopped" beat after the banner. Spectacle only.
- m12. The countdown, logo drop and wipe are fine at 50 ms steps; the logo squash and splash happen in under 300 ms and the splash droplets are small. No problem, just not a wow.

### Looked at and fine

- Fonts: Lilita One (display) and Fredoka (UI) are used everywhere; no system-font fallback glyph, no tofu, no clipped text in any screen at 1920 x 1080 or 800 x 450. Every character of `strings.en.js` exists in both subsets (including the multiplication sign, minus, degree sign, ellipsis and curly quotes). HUD numerals are tabular (the score does not jitter in the film).
- Fruit, bombs, blade: the bomb has a red and paper ring and a fuse spark and is the most conspicuous object on every stage; fruit are drawn over banners, decals and splats; the blade (white core, orange edge, ink outline) is visible on all stages in every power-up colour, with the cursor ring at its head.
- Banners: combo banners sit behind the fruit; the BOMB! banner follows the bomb, and the explosion and smoke did not cover the fruit 170 to 400 px away (`f-bomb-near.jpg`).
- HUD contrast over all four stages (night, classic, arcade, zen) with the score at rest: dark ink with a paper outline, well above 4.5 to 1 (4.2 to 6.5 measured on the crops; the lower value was a crop with splash behind it). Small labels (28 px "SCORE", "BEST", "LIVES", "TIME") have a paper outline and read.
- Reduce flashes: the bomb loses the full-screen white wash, the vignette and the ring (`reduceflash-f-bomb.jpg`); the golden apple loses its overlay; the combo keeps its stars. Reduce motion: no shake or zoom, banners fade in instead of slamming, combo plate has no reveal (so M2 does not occur with Reduce motion; it can be seen in `reducemotion-f-combo10.jpg` that the banner fades in cleanly). The white wash of the bomb is still full strength with only Reduce motion on (by design: it is a flash, not motion).
- Style consistency: the AI art backdrops, the UI kit (paper buttons, red toggles, ink outlines) and the procedural effects (ink splats, ink banners, star bursts) look like one world. The one outlier is the plain red rank seal (m6).
- Screens without a problem: menu, connect, safety, calibration 1 to 3, pause and resume, disconnect panel, the results screens, game over (the "GAME OVER" slam and the dim are clear), time up.

## 3. Effects clutter at the heaviest moment

`sheet-heavy` (Frenzy and Double active, ten fruit in one swing, a golden apple at the top, a bomb below the swing line): the screen is busy for about 600 ms (rays, splats, popups, an x8 banner, embers, gold overlay) but all fruit halves, the bomb and the blade stay the most saturated and best outlined things. Particles and splats stay behind the objects. Nothing was lost under a banner for longer than the 150 ms of the combo plate reveal (M2). Reduce flashes cuts the clutter noticeably.

## 4. Fonts, method

The two shipped WOFF2 files (`public/assets/fonts/dojo-display.woff2`, `dojo-ui.woff2`) were Brotli-decoded in a small script and their cmaps compared with every character of every string in `strings.en.js`: no character is missing from either file. The renderer's font stack falls through to system fonts only if the file is not loaded; in every screenshot both families were active.

## 5. How to reproduce

`PORT=8303 node server.js`, then in the browser `http://localhost:8303/?input=sim&skipsafety=1&clock=manual&mute=1`, `__ninja.start('arcade', {seed: 21})`, `__ninja.debug.spawn({kind:'fruit', type:'orange', apexX:960, apexY:500, atApex:true})` and `__ninja.sim.setTarget(x, y, {teleport:true})` followed by `__ninja.advance(ms)` and `__ninja.debug.draw()`. The review scripts were kept in the session scratchpad (they only use the public `__ninja` API and the existing e2e classes), not in the repository.

## 6. Recommended order of fixes

1. M2 (combo plate reveal), 10 minutes: no more black slab.
2. M1 (score colour), 10 minutes: deep-gold fill with ink outline, or a shorter roll.
3. m1, m5, m3: move banners and popups so they never overlap the HUD label or the cut fruit.
4. m6, m7: results seal and the stat grid spacing, if time allows.
