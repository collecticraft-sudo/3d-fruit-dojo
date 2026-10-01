import * as L from './lib.mjs';
const bias = L.ownBias();
const ss = (x) => { const c = Math.max(0, Math.min(1, x)); return c*c*(3-2*c); };
const F = (s) => { const e = s-5; if (e<=0) return 0; return e*(5+9*ss(e/300)); };
for (const name of ['fast_swings_h','fast_swings_v']) {
  const l = L.stepList(name); const bands = {'<50':[0,0],'50-150':[0,0],'150-300':[0,0],'300-600':[0,0],'>=600':[0,0]};
  let pv=null;
  for (let i=0;i<l.length;i++){ const g=l[i].g; const vR=-(g.z-bias.z), vU=g.x-bias.x; const s=Math.hypot(vR,vU); const f=F(s); const v={x:s>1e-9?f*vR/s:0,y:s>1e-9?-f*vU/s:0};
    if(pv&&l[i].dt){ const k = s<50?'<50':s<150?'50-150':s<300?'150-300':s<600?'300-600':'>=600'; bands[k][0]+=0.5*(pv.x+v.x)*l[i].dt/1000; bands[k][1]+=0.5*(pv.y+v.y)*l[i].dt/1000; } pv=v; }
  console.log(name, 'unclamped net (dx,dy) px by tip-speed band:', Object.entries(bands).map(([k,v])=>`${k}: (${Math.round(v[0])},${Math.round(v[1])})`).join('  '));
}
