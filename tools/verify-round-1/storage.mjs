import * as L from './lib.mjs';
import { pathToFileURL } from 'node:url';
const st = await import(pathToFileURL(`${L.P}/public/js/ui/storage.js`).href);
const mem = (init) => { const m = new Map(init ? [['joyconNinja.v1', init]] : []); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }; };
const show = (label, be) => { const s = st.createStorage({ backend: be }); const g = s.getSettings(); console.log(label, JSON.stringify({ sens: g.sensitivity, cut: g.cutThreshold, vol: g.volume, hand: g.hand, flip: g.flipX, auto: g.autoCenter, notice: s.getNotice(), best: s.getBest('classic'), ack: s.getSafetyAck(), play: s.addPlayMs(0) })); return s; };
const v1 = JSON.stringify({ v: 1, best: { classic: { score: 1234, combo: 9, date: '2026-09-01' }, arcade: null, zen: null }, settings: { sensitivity: 1.5, cutThreshold: 1400, volume: 0.3, hand: 'left', flipX: true, autoCenter: false }, safetyAck: true, playMsTotal: 5000 });
let be = mem(v1); let s = show('v1 doc            ', be);
console.log('  raw still v1 before save:', JSON.parse(be.m.get('joyconNinja.v1')).v);
s.ackNotice(); const raw = JSON.parse(be.m.get('joyconNinja.v1')); console.log('  after ack raw v', raw.v, 'notice', raw.notice, 'settings', JSON.stringify(raw.settings));
s = show('reload after ack ', be);
// edge cases
show('no v field       ', mem(JSON.stringify({ best: {}, settings: { sensitivity: 0.6, cutThreshold: 300 } })));
show('v1 extreme 2400  ', mem(JSON.stringify({ v: 1, settings: { sensitivity: 2, cutThreshold: 2400 } })));
show('v1 low 400       ', mem(JSON.stringify({ v: 1, settings: { sensitivity: 0.5, cutThreshold: 400 } })));
show('v2 doc untouched ', mem(JSON.stringify({ v: 2, settings: { sensitivity: 0.6, cutThreshold: 450 }, notice: null })));
show('v2 cut 1400      ', mem(JSON.stringify({ v: 2, settings: { sensitivity: 5, cutThreshold: 1400 } })));
show('v2 with notice   ', mem(JSON.stringify({ v: 2, settings: {}, notice: 'motion-2' })));
show('v"2" string      ', mem(JSON.stringify({ v: '2', settings: { cutThreshold: 450 } })));
show('corrupt json     ', mem('{not json'));
show('none             ', mem(null));
show('array            ', mem('[]'));
s = st.createStorage({ backend: mem(null) });
for (const v of [1400, 100, 113, 99, 712, NaN]) console.log(' updateSettings cutThreshold', v, '->', s.updateSettings({ cutThreshold: v }).cutThreshold);
for (const v of [0.05, 0.34, 0.35, 2.5]) console.log(' updateSettings sensitivity', v, '->', s.updateSettings({ sensitivity: v }).sensitivity);
// throwing backend
const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('y'); } };
const sb = st.createStorage({ backend: bad }); console.log('throwing backend ok, persistent', sb.isPersistent(), 'cut', sb.getSettings().cutThreshold);
