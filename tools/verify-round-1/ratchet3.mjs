import * as L from './lib.mjs';
for (const name of ['fast_swings_h','fast_swings_v']) {
  const strokes = L.hardStrokes(name);
  const sm = L.makeSamples(L.stepList(name), {}); const r = L.replay(L.mkPipe(), sm);
  const rows = r.rows.filter(q=>q.b);
  console.log(name);
  const lines = strokes.map((s,i)=>{
    const inx = rows.filter(q=>q.dev>=s.t0-30&&q.dev<=s.t1+30);
    const a=inx[0].b, b=inx.at(-1).b;
    let path=0; for(let k=1;k<inx.length;k++) path+=Math.hypot(inx[k].b.x-inx[k-1].b.x, inx[k].b.y-inx[k-1].b.y);
    const ys=inx.map(q=>q.b.y), xs=inx.map(q=>q.b.x);
    return `#${i+1} start(${Math.round(a.x)},${Math.round(a.y)}) end(${Math.round(b.x)},${Math.round(b.y)}) realized path ${Math.round(path)}px x-span ${Math.round(Math.max(...xs)-Math.min(...xs))} y-span ${Math.round(Math.max(...ys)-Math.min(...ys))}`;
  });
  console.log(lines.join('\n'));
  // share of strokes that start within 60px of an edge in the stroke direction
  const startEdge = strokes.filter((s)=>{const q=rows.find(z=>z.dev>=s.t0-30).b; return q.x<60||q.x>1860||q.y<60||q.y>1020;}).length;
  console.log('  strokes that START within 60 px of a screen edge:', startEdge, '/', strokes.length);
  // y-centroid during cutting samples
  const cutRows=rows.filter(q=>q.b.cutting); const ysC=cutRows.map(q=>q.b.y);
  console.log('  cutting samples:', cutRows.length, 'y median', Math.round(L.median(ysC)), 'p10', Math.round(L.quant(ysC,0.1)), 'p90', Math.round(L.quant(ysC,0.9)), 'share of cutting samples with y>1000:', (100*ysC.filter(y=>y>1000).length/ysC.length).toFixed(0)+'%', 'x median', Math.round(L.median(cutRows.map(q=>q.b.x))));
  const inMid = cutRows.filter(q=>q.b.y>=270&&q.b.y<=810).length;
  console.log('  share of cutting samples inside the middle half of the screen height (y 270..810):', (100*inMid/cutRows.length).toFixed(0)+'%');
}
