#!/usr/bin/env python3
"""Rebuild design/fonts/dist/*.woff2 from design/fonts/src/ (dev-time tool, never run by the game or by npm test).

    /Library/Frameworks/Python.framework/Versions/3.14/bin/python3 design/fonts/build-fonts.py

Needs fontTools (4.62.1 was used) and brotli (the WOFF2 compressor); install them yourself, the project does not.
What it does for every font of design/fonts/fonts.json:
  1. variable sources: pin the axes that the game does not use (fontTools.varLib.instancer; Fredoka: wdth 100, wght limited to 500..700)
  2. subset to the Latin ranges of fonts.json (the game is English; U+0020-007E, U+00A0-00FF, dashes, curly quotes, bullet, ellipsis, minus),
     keep the kern and liga features, drop hinting and the glyph names, write WOFF2
  3. rename the family inside the file to "Dojo Display" / "Dojo UI": the subset is a modified version, and the SIL OFL does not allow a
     modified version to keep a Reserved Font Name ("Lilita One"). The copyright, licence and designer records stay as they were.
The output is deterministic for one fontTools version. Equivalent pyftsubset call for the display face (without the rename):
    pyftsubset src/LilitaOne-Regular.ttf --unicodes=U+0020-007E,U+00A0-00FF,U+2013-2014,U+2018-201D,U+2022,U+2026,U+2212 \
        --flavor=woff2 --layout-features=kern,liga --no-hinting --glyph-names- --output-file=dist/dojo-display.woff2
"""
import io
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
spec = json.load(open(os.path.join(HERE, "fonts.json"), encoding="utf-8"))


def parse_unicodes(text):
    out = []
    for part in text.split(","):
        part = part.strip().replace("U+", "")
        if "-" in part:
            a, b = part.split("-")
            out.extend(range(int(a, 16), int(b, 16) + 1))
        else:
            out.append(int(part, 16))
    return out


def set_name(font, name_id, value):
    for rec in list(font["name"].names):
        if rec.nameID == name_id:
            font["name"].removeNames(nameID=name_id)
            break
    font["name"].setName(value, name_id, 3, 1, 0x409)
    font["name"].setName(value, name_id, 1, 0, 0)


def main():
    os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
    unicodes = parse_unicodes(spec["unicodeRanges"])
    for f in spec["fonts"]:
        src = os.path.join(HERE, f["source"]["file"])
        font = TTFont(src)
        if f["axes"]:
            limits = {k: (tuple(v) if isinstance(v, list) else v) for k, v in f["axes"].items()}
            font = instancer.instantiateVariableFont(font, limits, inplace=False)
            buf = io.BytesIO()  # round trip through bytes: the subsetter needs a fully compiled font
            font.save(buf)
            buf.seek(0)
            font = TTFont(buf)
        opts = subset.Options()
        opts.flavor = "woff2"
        opts.layout_features = ["kern", "liga"]
        opts.hinting = False
        opts.glyph_names = False
        opts.notdef_outline = True
        opts.name_IDs = [0, 7, 8, 9, 10, 11, 12, 13, 14, 15]  # copyright, trademark, designer, licence records; the family names are written below
        opts.name_legacy = True
        opts.name_languages = [0x409]
        opts.drop_tables += ["DSIG"]
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        fam = "Dojo Display" if f["id"] == "display" else "Dojo UI"
        ps = fam.replace(" ", "")
        set_name(font, 1, fam)
        set_name(font, 2, "Regular")
        set_name(font, 3, f"{ps}-1.0;{f['source']['name'].replace(' ', '')} {f['source']['version']} subset")
        set_name(font, 4, fam)
        set_name(font, 5, f"Version 1.0 ({f['source']['name']} {f['source']['version']}, Latin subset)")
        set_name(font, 6, ps)
        out = os.path.join(HERE, "dist", f["file"])
        font.flavor = "woff2"
        font.save(out)
        print(f"{out}: {os.path.getsize(out)} bytes, {len(font.getGlyphOrder())} glyphs")


if __name__ == "__main__":
    sys.exit(main())
