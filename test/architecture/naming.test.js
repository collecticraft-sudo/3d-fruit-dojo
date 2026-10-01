// Naming guard (art-integration workstream, docs/assets-integration.md section 7): the player-visible name of the game is "3D Fruit Dojo"
// everywhere a player or a reader sees it, while the code name "joycon-ninja" stays where saved data, URLs and tools depend on it.
// This file checks three things: (1) the surfaces that show the name (entry page, diagnostics page, launcher banners, server console lines,
// the macOS Bluetooth usage string, package.json, the documents) carry the new name and not the old one; (2) the identifiers that must NOT
// change did not change (package name, window.__ninja, the health body and header, the joyconNinja.* storage keys); (3) the documents
// describe the art layer and point at docs/assets-integration.md and docs/assets.md.
// It never runs a server and never opens a browser. Historical reports keep the old name on purpose (see HISTORICAL).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../../public/js/ui/strings.en.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const NAME = '3D Fruit Dojo';
// "Joy-Con Ninja", "JOY-CON NINJA", "Joycon Ninja": a space between the two words. The identifiers `joycon-ninja` (folder, package name),
// `joyconNinja.v1` (storage) and `X-Joycon-Ninja` (bridge header) have no space, so they never match.
const OLD_TITLE = /joy-?con\s+ninja/i;
const OTHER_GAME = /fruit\s+ninja/i;
// a line that talks about the rename itself may quote the old name
const RENAME_TALK = /(renam|old name|old title|former|formerly|working title|used to be|was called|code name|historical)/i;

// documents that show the game's name to a reader and were renamed; the historical reports and the two art documents of other roles are not in it
const NAMED_DOCS = ['README.md', 'docs/GUIDE.md', 'docs/architecture.md', 'docs/game-design.md', 'docs/native-bridge.md', 'docs/joycon2-protocol.md', 'docs/protocol-audit.md', 'docs/hardware-findings.md', 'docs/contract-notes.md'];
// reports written under the old name: kept as they are (README.md says so)
const HISTORICAL = ['docs/qa-report-round-1.md', 'docs/qa-report-round-2.md', 'docs/qa-report-round-3.md', 'docs/code-review-round-1.md', 'docs/code-review-round-2.md', 'docs/code-review-round-3.md', 'docs/improvements.md'];

const codeLines = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*|#)/.test(l));

test('the entry page, the diagnostics page and the Bluetooth usage string show "3D Fruit Dojo", never the old title', () => {
  const html = read('public/index.html');
  assert.match(html, /<title>3D Fruit Dojo<\/title>/);
  assert.match(html, /aria-label="3D Fruit Dojo"/);
  assert.match(html, /<noscript>3D Fruit Dojo needs JavaScript\./);
  assert.doesNotMatch(html, OLD_TITLE);
  const diag = read('public/diagnostics.html');
  assert.ok(diag.includes(NAME), 'the diagnostics page says which game it belongs to');
  assert.match(diag, /<h1>Joy-Con Diagnostics<\/h1>/, 'the heading of the page is unchanged (the server test looks for it)');
  assert.doesNotMatch(diag, OLD_TITLE);
  const plist = read('bridge/Info.plist');
  const usage = plist.match(/<key>NSBluetoothAlwaysUsageDescription<\/key>\s*<string>([^<]+)<\/string>/);
  assert.ok(usage, 'the usage description exists');
  assert.ok(usage[1].startsWith(`${NAME} talks to your Joy-Con 2`), usage[1]);
  assert.match(plist, /<string>local\.joyconninja\.bridge<\/string>/, 'the bundle id is an identifier and stays');
  assert.doesNotMatch(plist, OLD_TITLE);
});

test('the launcher banners and the server console lines say "3D Fruit Dojo"', () => {
  const launcher = read('start.command');
  assert.doesNotMatch(launcher, OLD_TITLE);
  const echoes = launcher.split('\n').filter((l) => /^\s*echo "/.test(l));
  assert.ok(echoes.some((l) => l.includes(`${NAME} is already running at \${URL}`)), 'banner: already running');
  assert.ok(echoes.some((l) => l.includes(`${NAME} is open at \${URL}`)), 'banner: open');
  assert.match(launcher.split('\n')[1], /^# 3D Fruit Dojo launcher\./);
  const server = read('server.js');
  const code = codeLines(server).join('\n');
  assert.doesNotMatch(code, OLD_TITLE, 'no console line of server.js uses the old title');
  assert.ok(code.includes(`console.log(\`${NAME} is already running at http://localhost:\${port}\`)`));
  assert.ok(code.includes(`console.log(\`${NAME} is running at http://localhost:\${running.port}\`)`));
  assert.ok(code.includes(`does not answer /__health as ${NAME}).`));
});

test('package.json describes 3D Fruit Dojo and no longer names another game', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.description.startsWith(`${NAME}:`), pkg.description);
  assert.doesNotMatch(pkg.description, OTHER_GAME);
  assert.doesNotMatch(pkg.description, OLD_TITLE);
  assert.match(pkg.scripts['test:unit'], /\bassets\b/, 'test:unit lists the new test/assets directory');
});

test('the strings: the title fallback is "3D FRUIT DOJO"; nothing a player reads names the old title or another game', () => {
  assert.equal(STRINGS['menu.title'], '3D FRUIT DOJO');
  for (const [key, text] of Object.entries(STRINGS)) {
    assert.doesNotMatch(text, OLD_TITLE, key);
    assert.doesNotMatch(text, OTHER_GAME, key);
  }
});

test('the documents call the game "3D Fruit Dojo": the old title survives only on lines about the rename, and no document names another game', () => {
  const offenders = [];
  for (const f of NAMED_DOCS) {
    read(f).split('\n').forEach((line, i) => {
      if (OTHER_GAME.test(line)) offenders.push(`${f}:${i + 1}: names another game: ${line.trim().slice(0, 100)}`);
      if (OLD_TITLE.test(line) && !RENAME_TALK.test(line)) offenders.push(`${f}:${i + 1}: old title outside a rename note: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
  for (const f of ['README.md', 'docs/GUIDE.md', 'docs/architecture.md', 'docs/game-design.md']) {
    assert.match(read(f).split('\n')[0], /^# 3D Fruit Dojo\b/, `${f}: the H1 carries the new name`);
  }
});

test('README.md explains the rename and says that the historical reports keep the old name', () => {
  const readme = read('README.md');
  assert.match(readme, /renamed from "Joy-Con Ninja"/, 'the rename is stated once, near the top');
  assert.match(readme, /`joycon-ninja`/, 'the code name that stays is named');
  assert.match(readme, /`window\.__ninja`/);
  assert.match(readme, /`joyconNinja\.\*`/);
  assert.match(readme, /keep the old name Joy-Con Ninja/, 'the index of documents says that the historical reports keep the old name');
  for (const f of HISTORICAL) assert.ok(existsSync(join(ROOT, f)), `${f} is kept`);
});

test('identifiers that must NOT change did not change (saved scores, URLs, the health probe and the bridge header depend on them)', () => {
  assert.equal(JSON.parse(read('package.json')).name, 'joycon-ninja');
  const server = read('server.js');
  assert.ok(server.includes(`'{"ok":true,"name":"joycon-ninja"}'`), 'the health body');
  assert.ok(server.includes(`'X-Joycon-Ninja'`), 'the bridge header');
  assert.ok(read('start.command').includes(`'"name":"joycon-ninja"'`), 'the launcher probes the health body');
  assert.ok(read('public/js/input/native-link.js').includes(`'X-Joycon-Ninja'`));
  assert.ok(read('public/js/game/config.js').includes(`storageKey: 'joyconNinja.v1'`), 'the score storage key');
  const input = read('public/js/input/input-config.js');
  for (const key of ['joyconNinja.ble.v1', 'joyconNinja.path.v1', 'joyconNinja.imu.v1']) assert.ok(input.includes(`'${key}'`), key);
  assert.ok(read('public/js/ninja-api.js').includes('__ninja'), 'window.__ninja');
  assert.equal(STRINGS['rank.3'], 'Ninja', 'the rank Ninja is a rank, not the title');
});

test('architecture.md and game-design.md carry the art-layer amendment (image files only under public/assets, all optional, procedural fallback)', () => {
  const arch = read('docs/architecture.md');
  assert.doesNotMatch(arch, /no image files \(art is procedural\)/, 'rule 7 is amended');
  assert.match(arch, /public\/assets\//);
  assert.doesNotMatch(read('docs/game-design.md'), /procedural only/);
  assert.match(read('docs/game-design.md'), /^## 11\. Visual style: "Ink and Paper Dojo" \(one direction, procedural, with optional generated art\)$/m);
});

test('README.md, the guide, the architecture and the design describe the art layer and point at docs/assets-integration.md and docs/assets.md', () => {
  const problems = [];
  for (const f of ['README.md', 'docs/GUIDE.md', 'docs/architecture.md', 'docs/game-design.md']) {
    const text = read(f);
    if (!/assets-integration\.md/.test(text)) problems.push(`${f}: no pointer to docs/assets-integration.md`);
    if (!/[^-]assets\.md/.test(text)) problems.push(`${f}: no pointer to docs/assets.md`);
    if (!/procedural|paper-and-ink/i.test(text)) problems.push(`${f}: does not mention the procedural (paper-and-ink) fallback`);
  }
  assert.deepEqual(problems, []);
  // the guide tells the player what happens when a picture is missing, and how to switch the art off
  const guide = read('docs/GUIDE.md');
  assert.match(guide, /\?assets=0/);
  assert.match(read('README.md'), /\| `assets` \|/, 'the flag table lists the assets flag');
});
