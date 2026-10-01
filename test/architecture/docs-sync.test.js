// Keeps docs/architecture.md, contracts.js and package.json in sync (architect, owned by the Integrator afterwards).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findItalian } from '../../test-support/ui/italian-leaks.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('architecture.md embeds the typedef block of contracts.js verbatim', () => {
  const src = read('public/js/shared/contracts.js');
  const m = src.match(/\/\/ <typedefs>\n([\s\S]*?)\/\/ <\/typedefs>/);
  assert.ok(m, 'contracts.js must contain the <typedefs> markers');
  const block = m[1].trimEnd();
  assert.ok(read('docs/architecture.md').includes(block), 'docs/architecture.md section 11 is out of date: re-embed the typedef block of contracts.js');
});

test('package.json follows the project constraints', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.type, 'module');
  assert.ok(pkg.scripts.start && pkg.scripts.test, 'scripts start and test are required');
  assert.match(pkg.scripts.test, /^node --test\b/);
  assert.equal(pkg.dependencies, undefined, 'zero runtime dependencies');
  assert.equal(pkg.devDependencies, undefined, 'zero dev dependencies');
});

test('required project documents exist', () => {
  for (const f of ['README.md', 'docs/architecture.md', 'docs/contract-notes.md', 'docs/joycon2-protocol.md', 'docs/game-design.md', 'docs/joycon2-test-vectors.json', 'docs/protocol-audit.md', 'docs/GUIDE.md', 'docs/hardware-findings.md']) {
    assert.ok(existsSync(join(ROOT, f)), `${f} is missing`);
  }
});

test('every section reference in architecture.md points at an existing heading', () => {
  const doc = read('docs/architecture.md');
  const headings = new Set([...doc.matchAll(/^#{2,3} (\d+(?:\.\d+)?)\b/gm)].map((m) => m[1]));
  const own = doc.replace(/`([^`]*)`/g, (_m, inner) => (/docs\//.test(inner) ? inner : '')); // keep file names of the other documents
  const bad = [];
  for (const m of own.matchAll(/(?<![\w./-])(?:section|sections|see) (\d+(?:\.\d+)?)(?![\d.]*\s*(?:of the design|of the protocol))/gi)) {
    const ref = m[1];
    const context = own.slice(Math.max(0, m.index - 45), m.index + m[0].length + 30);
    if (/design|protocol/i.test(context)) continue; // references into the other two documents (they are named in the same sentence)
    if (!headings.has(ref)) bad.push(`${ref} (in "${context.replace(/\s+/g, ' ')}")`);
  }
  assert.deepEqual(bad, []);
});

// ---- documentation checks added by the Integrator: the owner asked for the documents in English, and the links must work

const DOCS = ['README.md', 'docs/architecture.md', 'docs/contract-notes.md', 'docs/game-design.md', 'docs/joycon2-protocol.md', 'docs/protocol-audit.md', 'docs/GUIDE.md'];

test('documents are written in English, and so is every text of the game (no Italian word, no accented vowel)', () => {
  const EN = /\b(the|and|is|of|to|with|that|for|this|are|you|when|if|it|in|on|by|not)\b/g;
  const problems = [];
  for (const f of DOCS) {
    const text = read(f);
    const en = (text.toLowerCase().match(EN) ?? []).length;
    if (en < 200) problems.push(`${f}: only ${en} English markers`);
    // the UI language changed to English on 2026-09-30: the documents quote English labels, so no Italian may be left at all
    text.split('\n').forEach((line, i) => {
      const hits = findItalian(line);
      if (hits.length) problems.push(`${f}:${i + 1}: ${hits.join(', ')}`);
    });
  }
  assert.deepEqual(problems, []);
});

test('relative links in README.md and the guide point at files and headings that exist', () => {
  const slug = (h) => h.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9_\- ]/g, '').trim().replace(/ /g, '-');
  const headings = (file) => new Set([...read(file).matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])));
  const problems = [];
  for (const f of ['README.md', 'docs/GUIDE.md']) {
    for (const m of read(f).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [path, anchor] = target.split('#');
      const file = path === '' ? f : join(dirname(f), path).replace(/\\/g, '/');
      if (!existsSync(join(ROOT, file))) {
        problems.push(`${f}: ${target} -> missing file ${file}`);
        continue;
      }
      if (anchor && file.endsWith('.md') && !headings(file).has(anchor)) problems.push(`${f}: ${target} -> no heading "${anchor}" in ${file}`);
    }
  }
  assert.deepEqual(problems, []);
});

test('README.md never claims verified hardware behaviour and points at the guide\'s HARDWARE CHECKLIST', () => {
  const readme = read('README.md');
  assert.match(readme, /Nobody on the team could touch a real Joy-Con 2/);
  assert.match(readme, /\]\(docs\/GUIDE\.md#\d+-hardware-checklist\)/, 'the README must link to the HARDWARE CHECKLIST of the guide');
  assert.match(read('docs/GUIDE.md'), /nothing here was tried on a real Joy-Con 2/i);
});

test('docs/GUIDE.md has a HARDWARE CHECKLIST that lists every UNVERIFIED-ON-HARDWARE item of the code, the protocol document, the audit and the design', () => {
  const guide = read('docs/GUIDE.md');
  const start = guide.search(/^## \d+\. HARDWARE CHECKLIST$/m);
  assert.ok(start >= 0, 'the guide needs a "## N. HARDWARE CHECKLIST" section');
  const rest = guide.slice(start + 10);
  const next = rest.search(/^## /m);
  const checklist = next < 0 ? rest : rest.slice(0, next);
  // ids used anywhere in the code (public/, server.js, start.command) or in the three research documents
  const ids = new Set();
  const addIds = (text) => { for (const m of text.matchAll(/\b(UOH-\d+|HW-\d+)\b/g)) ids.add(m[1]); };
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(js|html|css)$/.test(e.name)) addIds(read(rel));
    }
  };
  walk('public');
  for (const f of ['server.js', 'start.command', 'docs/joycon2-protocol.md', 'docs/protocol-audit.md', 'docs/game-design.md']) addIds(read(f));
  for (const m of read('docs/protocol-audit.md').matchAll(/^### (F\d+) /gm)) ids.add(m[1]);
  assert.ok(ids.size >= 30, `found only ${ids.size} ids: the scan is broken`);
  const missing = [...ids].filter((id) => !new RegExp(`\\b${id}\\b`).test(checklist));
  assert.deepEqual(missing, [], 'these items are tagged UNVERIFIED-ON-HARDWARE but missing from the HARDWARE CHECKLIST of docs/GUIDE.md');
  assert.ok(/UNVERIFIED-ON-HARDWARE/.test(checklist));
});
