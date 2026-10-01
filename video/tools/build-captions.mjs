#!/usr/bin/env node
// Builds composition/compositions/captions.html from audio/narration-timings.json (one burned-in caption per narration line).
// Run after any change of the narration timings:  node video/tools/build-captions.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const video = path.resolve(here, '..');
const timings = JSON.parse(fs.readFileSync(path.join(video, 'audio/narration-timings.json'), 'utf8'));
// display text per line (numerals instead of spelled-out numbers; *word* = gold accent)
const display = {
  n00: 'This is 3D Fruit Dojo, a fruit slicing game.',
  n01: 'Strap a *Joy-Con 2* to a 3D-printed sword.',
  n02: 'Its motion sensor streams to your Mac about *33 times a second*, and drives the blade.',
  n03: '*Three modes.* Classic gives you three lives.',
  n04: 'Arcade is a sixty second sprint.',
  n05: 'Zen is calm, with no bombs.',
  n06: 'Chain a combo.',
  n07: 'Dodge a bomb.',
  n08: 'Or *freeze* time.',
  n09: 'The art began as prompts to *Higgsfield*.',
  n10: 'The code was built, tested and reviewed by a team of *AI agents*.',
  n11: 'Tested with a *real Joy-Con 2*. Swing to slice.',
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = (s) => esc(s).replace(/\*([^*]+)\*/g, '<b>$1</b>');
const caps = timings.map((t, i) => `        <div class="cap" id="cap-${t.id}"><div class="pill">${html(display[t.id] || t.text)}</div></div>`).join('\n');
const data = JSON.stringify(timings.map((t) => [t.id, t.start, t.end]));
const out = `<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body>
    <template>
      <style>
        #captions { position: absolute; inset: 0; pointer-events: none; font-family: Montserrat, Inter, sans-serif; }
        #captions .cap { position: absolute; left: 0; right: 0; bottom: 104px; display: flex; justify-content: center; opacity: 0; }
        #captions .pill { max-width: 1560px; padding: 12px 36px 13px; background: rgba(24, 22, 28, 0.88); color: #fbf1d6; border-radius: 20px;
          font-weight: 700; font-size: 46px; line-height: 1.22; letter-spacing: -0.005em; text-align: center; text-wrap: balance; box-shadow: 0 6px 0 rgba(0,0,0,0.25); }
        #captions .pill b { color: #f1b02f; font-weight: 800; }
      </style>
      <div id="captions" data-composition-id="captions" data-width="1920" data-height="1080">
${caps}
      </div>
      <script>
        (function () {
          var K = KF.scene(0, document.getElementById("captions"));
          var E = KF.E;
          var lines = ${data};
          lines.forEach(function (l, i) {
            var a = Math.max(0, l[1] - 0.06), b = l[2] + 0.18;
            if (lines[i + 1]) b = Math.min(b, lines[i + 1][1] - 0.2);
            K.track("#cap-" + l[0], [{ t: 0, y: 16, o: 0 }, { t: a, y: 16, o: 0, ease: E.out }, { t: a + 0.2, y: 0, o: 1 }, { t: b - 0.01, y: 0, o: 1, ease: E.soft }, { t: b + 0.1, y: -6, o: 0 }]);
          });
        })();
      </script>
    </template>
  </body>
</html>
`;
fs.writeFileSync(path.join(video, 'composition/compositions/captions.html'), out);
console.log('captions.html written for', timings.length, 'lines');
