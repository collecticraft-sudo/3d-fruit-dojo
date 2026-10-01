import * as L from './lib.mjs';
for (const name of ['fast_swings_h','fast_swings_v','yaw_sweep','pitch_sweep']) {
  const sm = L.makeSamples(L.stepList(name), {from: name.startsWith('fast')?0:1, to: name.startsWith('fast')?Infinity:21});
  const r = L.replay(L.mkPipe(), sm);
  const b = r.rows.filter(q=>q.b).map(q=>q.b);
  const edge = (f)=>100*b.filter(f).length/b.length;
  const hist = Array(8).fill(0); for (const q of b) hist[Math.min(7, Math.floor(q.x/240))]++;
  const histy = Array(6).fill(0); for (const q of b) histy[Math.min(5, Math.floor(q.y/180))]++;
  console.log(name, 'left edge %', edge(q=>q.x<=0.5).toFixed(1), 'right', edge(q=>q.x>=1919.5).toFixed(1), 'top', edge(q=>q.y<=0.5).toFixed(1), 'bottom', edge(q=>q.y>=1079.5).toFixed(1));
  console.log('  x hist (8 bins of 240px, %):', hist.map(v=>(100*v/b.length).toFixed(0)).join(' '), '| y hist (6 bins of 180px):', histy.map(v=>(100*v/b.length).toFixed(0)).join(' '));
  // net signed displacement asymmetry: sum of dx per direction clamped loss
}
