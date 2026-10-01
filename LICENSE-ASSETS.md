# Licences of the art, the video and the third-party files

The MIT licence in [`LICENSE`](LICENSE) covers the source code only. Everything listed here has its own terms.

## 1. Art, logo and video: all rights reserved

Copyright (c) 2026 collecticraft-sudo. **All rights reserved.** You may run the game and look at the art in this repository. You may not copy, redistribute, sell, or use it in another project, and you may not train or fine-tune a model on it, without written permission.

This applies to:

- `public/assets/` (sprites, backdrops, user-interface kit, effects, icons, glyphs, the logo `public/assets/ui/logo_title.png`);
- `design/` (the art sources in `design/sprites`, `design/ui`, `design/fx`, `design/icons`, the previews, the art brief);
- the presentation video, its poster and its storyboard (`video/`; the finished MP4 is published as a release asset, not in git);
- the name and the logo "3D Fruit Dojo".

The art was generated with Higgsfield (GPT Image 2.5) from prompts written for this project and then cut, cleaned and optimised by the tools in `tools/` and `design/tools/`. The provenance of every picture is in `design/assets.csv` and `public/assets/PROVENANCE.csv`. Check the terms of the generator for any use of AI-generated images that goes beyond running this game.

If you want to build your own game on this code, replace the art: every picture is optional (the game has a complete paper-and-ink fallback, start it with `?assets=0` to see it).

## 2. Third-party files and their licences

| What | Where | Author | Licence |
|---|---|---|---|
| Lilita One (display font; the game ships a Latin subset renamed "Dojo Display") | `design/fonts/src/LilitaOne-Regular.ttf`, `design/fonts/dist/dojo-display.woff2`, `public/assets/fonts/dojo-display.woff2` | Juan Montoreano | SIL Open Font License 1.1, text in `design/fonts/licenses/OFL-lilitaone.txt` and `public/assets/fonts/OFL-lilitaone.txt` |
| Fredoka (UI font; Latin subset renamed "Dojo UI") | `design/fonts/src/Fredoka[wdth,wght].ttf`, `design/fonts/dist/dojo-ui.woff2`, `public/assets/fonts/dojo-ui.woff2` | The Fredoka Project Authors | SIL Open Font License 1.1, text in `design/fonts/licenses/OFL-fredoka.txt` and `public/assets/fonts/OFL-fredoka.txt` |
| Music of the presentation video: "Happy Beats / Business Moves" (the audio file is not in this repository) | `video/CREDITS.md` | Sascha Ende, https://ende.app | Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/ . Changes made: shortened, faded and ducked under the narration |
| Sound effects of the presentation video (the audio files are not in this repository) | `video/CREDITS.md` | Kenney, https://kenney.nl | CC0 1.0 (public domain) |
| Narration of the presentation video (not in this repository) | `video/CREDITS.md` | generated with Higgsfield text-to-speech | see the terms of the generator |

The game itself plays no audio file: every sound is synthesised with the Web Audio API in `public/js/audio/`.

The two OFL fonts are modified versions (subset, instanced, renamed so that the Reserved Font Names are not used). They are distributed with their licence texts and are not sold by themselves, as the OFL requires.

## 3. Trademarks

Nintendo, Nintendo Switch, Nintendo Switch 2 and Joy-Con are trademarks of Nintendo. This project is not made, endorsed, sponsored or approved by Nintendo and has no affiliation with it. The controller pictures in the game are generic gamepad drawings, not pictures of a Nintendo product. The Bluetooth protocol notes in `docs/` come from public community research; see `docs/joycon2-protocol.md` for the sources.
