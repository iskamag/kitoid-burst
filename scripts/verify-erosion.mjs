import assert from 'node:assert/strict';
import {erodeGrid,generateFieldPatch,erodedHeightAt,PATCH_CELLS,PATCH_SIZE} from '../src/heightfield.js';
const n=64,ramp=Float32Array.from({length:n*n},(_,i)=>100+(i%n)*.8+Math.floor(i/n)*.5),eroded=erodeGrid(ramp,n),sum=a=>a.reduce((a,b)=>a+b,0);
assert(eroded.every(Number.isFinite));const massError=Math.abs(sum(eroded)-sum(ramp))/sum(ramp);assert(massError<1e-6,'Hydraulic transport and settling must conserve sediment mass');
let curvature=0,count=0;for(let z=8;z<n-8;z++)for(let x=8;x<n-8;x++){const i=z*n+x;curvature+=(eroded[i-1]+eroded[i+1]+eroded[i-n]+eroded[i+n]-4*eroded[i])**2;count++;}
assert(Math.sqrt(curvature/count)<.1,'A smooth ramp must not develop an alternating grid mode');
const a=generateFieldPatch(0,0),b=generateFieldPatch(1,0),c=generateFieldPatch(0,-1),width=PATCH_CELLS+3;let seamError=0;
for(let i=0;i<width;i++)for(let k=0;k<3;k++){seamError=Math.max(seamError,Math.abs(a[i*width+PATCH_CELLS+k]-b[i*width+k]),Math.abs(c[(PATCH_CELLS+k)*width+i]-a[k*width+i]));}
assert.equal(seamError,0,'Independent erosion patches must agree exactly across their overlap');
for(const boundary of[-PATCH_SIZE,0,PATCH_SIZE])for(const epsilon of[-1e-10,-Number.EPSILON,0,Number.EPSILON,1e-10])assert(Number.isFinite(erodedHeightAt(boundary+epsilon,boundary-epsilon)),'Sampling either side of a patch boundary must remain finite');
console.log(JSON.stringify({passed:true,hydraulicMassError:massError,rampCurvature:Math.sqrt(curvature/count),patchSeamError:seamError},null,2));
