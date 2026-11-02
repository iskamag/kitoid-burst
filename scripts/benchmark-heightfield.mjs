import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import * as current from '../src/heightfield.js';
import {BAKED_KEYS,BAKED_REVISION} from '../src/heightfield-cache.js';

// Keep the former allocating sampler as an executable reference. Its private
// helpers and patch data come from the same module source as the current code.
const referenceSampler=`export function erodedHeightAt(x,z){
  const gx=x/FIELD_STEP,gz=z/FIELD_STEP,cellX=Math.floor(gx),cellZ=Math.floor(gz),px=Math.floor(cellX/PATCH_CELLS),pz=Math.floor(cellZ/PATCH_CELLS),data=patch(px,pz),ix=cellX-px*PATCH_CELLS+1,iz=cellZ-pz*PATCH_CELLS+1,tx=gx-cellX,tz=gz-cellZ;
  const rows=[],derivatives=[];for(let j=-1;j<=2;j++){const k=(iz+j)*OUTPUT+ix;rows.push(cubic(data[k-1],data[k],data[k+1],data[k+2],tx));derivatives.push(cubicDerivative(data[k-1],data[k],data[k+1],data[k+2],tx));}
  const slope=Math.hypot(cubic(...derivatives,tz),cubicDerivative(...rows,tz))/FIELD_STEP,exposed=clamp((slope-.10)/.65,0,1);
  const relief=foldedRelief((x*.6-z*.8)/430+11,(z*.6+x*.8)/430-37,4153)*180
    +foldedRelief((x*.8+z*.6)/180+31,(z*.8-x*.6)/180-19,8191)*90
    +foldedRelief((x*.28-z*.96)/68-7,(z*.28+x*.96)/68+23,2539)*29
    +foldedRelief((x*.92+z*.39)/27,(z*.92-x*.39)/27,6551)*9;
  return Math.max(2,cubic(...rows,tz)+relief*(.08+exposed*.92));
}`;
const moduleUrl=new URL('../src/heightfield.js',import.meta.url);
let source=await readFile(moduleUrl,'utf8');
const samplerPattern=/export function erodedHeightAt\(x,z\)\{[\s\S]*?\n\}/;
assert(samplerPattern.test(source),'Locate the current sampler before substituting its reference');
source=source.replace(samplerPattern,referenceSampler)
  .replace(/from '([^']+)'/g,(_,path)=>`from '${new URL(path,moduleUrl).href}'`)
  .replaceAll('import.meta.url',JSON.stringify(moduleUrl.href));
const reference=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

assert.equal(BAKED_REVISION,current.EROSION_REVISION);
for(const key of BAKED_KEYS){
  const [px,pz]=key.split(':').map(Number),bytes=await readFile(new URL(`../assets/terrain/${BAKED_REVISION}/${px}_${pz}.bin`,import.meta.url));
  const field=Float32Array.from(new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4));
  current.storeFieldPatch(px,pz,field);reference.storeFieldPatch(px,pz,field);
}

const coords=[],add=(x,z)=>coords.push(x,z),epsilons=[-1e-8,-1e-10,-Number.EPSILON,0,Number.EPSILON,1e-10,1e-8];
// Cover signs, signed zero, lattice boundaries, and both baked starting areas.
for(const [cx,cz] of [[0,0],[-5120,5120],[5120,-5120],[20480,-15360]]){
  for(const dx of [-40,0,40])for(const dz of [-40,0,40])for(const epsilon of epsilons)add(cx+dx+epsilon,cz+dz-epsilon);
}
add(-0,0);add(0,-0);
// Large world coordinates use deterministic synthetic fields, avoiding an
// unrelated erosion-generation benchmark while exercising identical sampling.
for(const [px,pz] of [[200000,-200000],[-200000,200000]]){
  for(let dz=-2;dz<=1;dz++)for(let dx=-2;dx<=1;dx++){
    const field=Float32Array.from({length:(current.PATCH_CELLS+3)**2},(_,i)=>150+Math.sin(i*.17+dx)*80+Math.cos(i*.037+dz)*35);
    current.storeFieldPatch(px+dx,pz+dz,field);reference.storeFieldPatch(px+dx,pz+dz,field);
  }
  for(const dx of [-5120,0,5120])for(const dz of [-5120,0,5120])for(const epsilon of [-.001,0,.001])add(px*current.PATCH_SIZE+dx+epsilon,pz*current.PATCH_SIZE+dz-epsilon);
}
let seed=0x67cafe;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
for(let i=0;i<300000;i++){
  let x=random()*20000-10000,z=random()*20000-10000;
  if(i%3===0){x=Math.round(x/8)*8;z=Math.round(z/8)*8;}
  add(x,z);
}
for(let i=0;i<coords.length;i+=2){
  const expected=reference.erodedHeightAt(coords[i],coords[i+1]),actual=current.erodedHeightAt(coords[i],coords[i+1]);
  assert(Number.isFinite(actual),`Finite sample at ${coords[i]},${coords[i+1]}`);
  assert(Object.is(actual,expected),`Exact sample at ${coords[i]},${coords[i+1]}: ${actual} vs ${expected}`);
}
const rounds=[];
for(let round=0;round<4;round++){
  const result={};
  for(const name of round%2?['current','reference']:['reference','current']){
    const sample=(name==='current'?current:reference).erodedHeightAt,start=performance.now();let sum=0;
    for(let i=0;i<coords.length;i+=2)sum+=sample(coords[i],coords[i+1]);
    result[name]={milliseconds:performance.now()-start,sum};
  }
  assert(Object.is(result.current.sum,result.reference.sum));rounds.push(result);
}
console.log(JSON.stringify({passed:true,exactSamples:coords.length/2,rounds},null,2));
