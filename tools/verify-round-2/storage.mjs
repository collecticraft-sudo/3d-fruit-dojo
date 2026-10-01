// Verifier round 2: settings migration with old stored values, through the real storage module with a fake localStorage.
import { pathToFileURL } from 'node:url';
import { P } from './lib.mjs';
const st = await import(pathToFileURL(`${P}/public/js/ui/storage.js`).href);
const mk = (doc, raw) => { const m = new Map(); if (doc !== undefined) m.set('joyconNinja.v1', raw ?? JSON.stringify(doc)); return { m, backend: { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) } }; };
const cases = [
  ['owner old defaults v1 (1.0 / 1000)', { v: 1, best: {}, settings: { sensitivity: 1, cutThreshold: 1000 }, safetyAck: true, playMsTotal: 5 }],
  ['v1 min old values (0.5 / 400)', { v: 1, settings: { sensitivity: 0.5, cutThreshold: 400, volume: 0.2 } }],
  ['v1 max old values (2 / 2400)', { v: 1, settings: { sensitivity: 2, cutThreshold: 2400, hand: 'left' } }],
  ['no v field', { settings: { sensitivity: 1.5, cutThreshold: 1400 }, best: { classic: { score: 9, combo: 1, date: 'x' } } }],
  ['v as string "1"', { v: '1', settings: { sensitivity: 1.5, cutThreshold: 1400 } }],
  ['v2 valid (450 / 1.5)', { v: 2, settings: { sensitivity: 1.5, cutThreshold: 450 }, notice: null }],
  ['v2 out of range (1400 / 9)', { v: 2, settings: { sensitivity: 9, cutThreshold: 1400 }, notice: null }],
  ['v2 carrying the notice', { v: 2, settings: { sensitivity: 1.5, cutThreshold: 450 }, notice: 'motion-2' }],
  ['v3 future doc', { v: 3, settings: { sensitivity: 1.2, cutThreshold: 350 } }],
];
for (const [label, doc] of cases) {
  const b = mk(doc); const s = st.createStorage({ backend: b.backend });
  const g = s.getSettings(); const n0 = s.getNotice();
  const beforeSaved = b.m.get('joyconNinja.v1') === JSON.stringify(doc);
  s.ackNotice(); const raw = JSON.parse(b.m.get('joyconNinja.v1'));
  console.log(`${label.padEnd(38)} -> sens ${g.sensitivity} thr ${g.cutThreshold} hand ${g.hand} vol ${g.volume} notice ${n0}; load wrote nothing: ${beforeSaved}; after ack: v${raw.v} notice ${raw.notice}; 2nd load notice ${st.createStorage({ backend: b.backend }).getNotice()}`);
}
for (const [label, raw] of [['corrupt JSON', '{bad'], ['array', '[]'], ['null', 'null'], ['number', '7']]) { const b = mk(0, raw); const s = st.createStorage({ backend: b.backend }); console.log(`${label.padEnd(38)} -> sens ${s.getSettings().sensitivity} thr ${s.getSettings().cutThreshold} notice ${s.getNotice()}`); }
{ const s = st.createStorage({ backend: null }); console.log(`no storage -> persistent ${s.isPersistent()}, thr ${s.getSettings().cutThreshold}, notice ${s.getNotice()}`); }
{ const b = mk({ v: 2, settings: { sensitivity: 1, cutThreshold: 300 } }); const s = st.createStorage({ backend: b.backend }); s.updateSettings({ cutThreshold: 1400 }); console.log('updateSettings 1400 ->', s.getSettings().cutThreshold, ' 113 ->', s.updateSettings({ cutThreshold: 113 }).cutThreshold, ' sens 0.05 ->', s.updateSettings({ sensitivity: 0.05 }).sensitivity); }
