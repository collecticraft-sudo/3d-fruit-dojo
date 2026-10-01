# design/fonts

Sources and tools of the two shipped fonts. The account of the choice, the roles and the sizes is `docs/typography.md`; this file says what is in the folder and the exact commands.

| Path | What |
|---|---|
| `src/LilitaOne-Regular.ttf` | upstream Lilita One 1.002 (Juan Montoreano), 28 092 bytes, from `google/fonts` `ofl/lilitaone/LilitaOne-Regular.ttf`, downloaded 2026-10-01 |
| `src/Fredoka[wdth,wght].ttf` | upstream Fredoka 2.001 (Fredoka Project Authors), 159 184 bytes, from `google/fonts` `ofl/fredoka/Fredoka[wdth,wght].ttf`, downloaded 2026-10-01 |
| `licenses/OFL-lilitaone.txt`, `licenses/OFL-fredoka.txt` | the SIL Open Font License 1.1 texts of the two families, as published next to the fonts in `google/fonts` |
| `fonts.json` | the list of shipped fonts: id, family name used by the game, shipped file name, weight range, source, licence, axes to pin, and the Latin ranges of the subset |
| `build-fonts.py` | dev-time tool: pins variable axes, subsets, renames the family inside the file, writes `dist/` |
| `dist/dojo-display.woff2`, `dist/dojo-ui.woff2` | the subsets (9 724 and 27 064 bytes); `tools/build-assets.mjs` copies them to `public/assets/fonts/` |
| `specimen.html` | the test sheet used to choose (real game strings at 28 to 160 px over paper, the night veil and the vermilion plate; not shipped). Open it in Chrome with `?d=<display family>&u=<ui family>` or `?mode=ui&ui=<family>,<family>`. It knows the two shipped families (and the names of the four candidates that were rejected, whose files are not kept: download them from `google/fonts` `ofl/titanone`, `bowlbyone`, `paytoneone`, `nunito` into `src/` to compare again) |

## Rebuilding `dist/`

```
python3 design/fonts/build-fonts.py
npm run build:assets
```

Python fontTools 4.62.1 and brotli were used (`pip install fonttools brotli`; this is a dev-time step, the game, `npm test` and `npm run build:assets` need neither). The script is deterministic for one fontTools version. What it does for each font:

1. variable sources: `fontTools.varLib.instancer` pins the axes the game does not use (Fredoka: `wdth=100`, `wght` limited to 500..700);
2. `fontTools.subset` to `U+0020-007E, U+00A0-00FF, U+2013-2014, U+2018-201D, U+2022, U+2026, U+2212`, features `kern` and `liga`, no hinting, no glyph names, WOFF2 output;
3. the family names inside the file become "Dojo Display" and "Dojo UI" (the SIL OFL does not allow a modified version to keep a Reserved Font Name such as "Lilita One"); the copyright, trademark, designer and licence records are kept.

The equivalent `pyftsubset` call for the display face, without the rename:

```
pyftsubset src/LilitaOne-Regular.ttf --unicodes=U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2212 \
  --flavor=woff2 --layout-features=kern,liga --no-hinting --glyph-names- --output-file=dist/dojo-display.woff2
```

## Licences

Both fonts are SIL Open Font License 1.1 (<https://openfontlicense.org>). Shipping them requires the licence text next to the files: `public/assets/fonts/OFL-lilitaone.txt` and `OFL-fredoka.txt` are copied by the build and the asset tests fail if they are missing. The fonts are not sold on their own.
