import {BAKED_REVISION,BAKED_KEYS} from './heightfield-cache.js';
// Uplift and erosion operate in world coordinates. Each simulation has a halo
// wider than its stencil's total reach, so independently generated patches agree
// exactly in their overlapping interior. No seams or periodic terrain atlas.
export const FIELD_STEP=40,PATCH_CELLS=128,PATCH_SIZE=FIELD_STEP*PATCH_CELLS;
export const WATER_STEPS=12,THERMAL_EVERY=4,DRAINAGE_STEPS=24,STREAM_STEPS=8,FIELD_HALO=2*(WATER_STEPS+WATER_STEPS/THERMAL_EVERY)+DRAINAGE_STEPS+STREAM_STEPS+4;
export const EROSION_REVISION='catoid-eroded-field-6';
const OUTPUT=PATCH_CELLS+3,cache=new Map(),sources=new Map();let synchronousGenerations=0;
export const heightfieldStats=()=>({patches:cache.size,synchronousGenerations,inflight:inflight.size});
const baked=new Set(BAKED_REVISION===EROSION_REVISION?BAKED_KEYS:[]);
const bakedUrl=(px,pz)=>new URL(`../assets/terrain/${EROSION_REVISION}/${px}_${pz}.bin`,import.meta.url);
let readBaked;
if(typeof process!=='undefined'&&process.versions?.node){const {readFileSync}=await import('node:fs');readBaked=(px,pz)=>{const data=readFileSync(bakedUrl(px,pz));return Float32Array.from(new Float32Array(data.buffer,data.byteOffset,data.byteLength/4));};}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function hash(x,z,salt=0){let h=Math.imul(x,374761393)^Math.imul(z,668265263)^salt;h=Math.imul(h^(h>>>13),1274126177);return((h^(h>>>16))>>>0)/4294967295;}
const G=[1,0,.70710678,.70710678,0,1,-.70710678,.70710678,-1,0,-.70710678,-.70710678,0,-1,.70710678,-.70710678];
function gradient(ix,iz,x,z){const k=(Math.floor(hash(ix,iz,0x63a92)*8)&7)*2;return G[k]*x+G[k+1]*z;}
export function fieldNoise(x,z){
  const ix=Math.floor(x),iz=Math.floor(z),a=x-ix,b=z-iz,u=a*a*a*(a*(a*6-15)+10),v=b*b*b*(b*(b*6-15)+10);
  const p=gradient(ix,iz,a,b),q=gradient(ix+1,iz,a-1,b),r=gradient(ix,iz+1,a,b-1),s=gradient(ix+1,iz+1,a-1,b-1);
  return(p+(q-p)*u+(r-p)*v+(p-q-r+s)*u*v)*1.6;
}
function fractal(x,z,octaves=4){let sum=0,amp=.5;for(let i=0;i<octaves;i++){sum+=fieldNoise(x,z)*amp;const a=x;x=x*1.64+z*1.23+17.9;z=z*1.64-a*1.23-31.3;amp*=.5;}return sum;}
function plate(cx,cz,scale){
  const key=scale+':'+cx+':'+cz;if(sources.has(key))return sources.get(key);
  const s={x:(cx+.12+hash(cx,cz,3191)*.76)*scale,z:(cz+.12+hash(cx,cz,4211)*.76)*scale,vx:hash(cx,cz,5279)*2-1,vz:hash(cx,cz,6311)*2-1,elevation:40+hash(cx,cz,7393)*210};sources.set(key,s);return s;
}
function plateField(x,z,scale){
  const cx=Math.floor(x/scale),cz=Math.floor(z/scale);let sum=0,vx=0,vz=0,elevation=0,dwx=0,dwz=0,divergence=0;
  for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++){
    const p=plate(cx+i,cz+j,scale),dx=(x-p.x)/scale,dz=(z-p.z)/scale,r=Math.hypot(dx,dz)/1.35;if(r>=1)continue;
    const a=1-r,w=a**4*(4*r+1),gx=-20*a**3*dx/1.35**2,gz=-20*a**3*dz/1.35**2;
    sum+=w;vx+=w*p.vx;vz+=w*p.vz;elevation+=w*p.elevation;dwx+=gx;dwz+=gz;divergence+=gx*p.vx+gz*p.vz;
  }
  const d=divergence/sum-(vx*dwx+vz*dwz)/(sum*sum);
  return{base:elevation/sum,compression:Math.max(0,-d)/(.7+Math.max(0,-d)),extension:Math.max(0,d)/(1+Math.max(0,d))};
}
// Finite mountain systems have a connected crest graph. Side ridges descend
// from that spine, leaving open foothills between systems. Noise breaks rock
// surfaces and bends the graph; it does not decide where every hill goes.
const RANGE_SIZE=4200,RIDGE_BIN=512,ranges=new Map(),ridgeSamples=new Map();
function mountainRange(cx,cz,scale){
  const key=scale+':'+cx+':'+cz;if(ranges.has(key))return ranges.get(key);
  const r=(i)=>hash(cx,cz,12007+i*173+(scale-RANGE_SIZE)*97),theta=r(1)*Math.PI*2,ux=Math.cos(theta),uz=Math.sin(theta),vx=-uz,vz=ux;
  const ratio=scale/RANGE_SIZE,ox=(cx+.2+r(2)*.6)*scale,oz=(cz+.2+r(3)*.6)*scale,length=(3500+r(4)*2400)*ratio,peak=(680+r(5)*580)*ratio,width=(650+r(6)*600)*ratio,bins=new Map();
  const nodes=[],count=8+Math.floor(r(9)*5);
  const node=(a,b,h,w)=>({x:ox+ux*a+vx*b,z:oz+uz*a+vz*b,h,w});
  function segment(a,b,asym=.35){
    const dx=b.x-a.x,dz=b.z-a.z,inv=1/(dx*dx+dz*dz),margin=Math.max(a.w,b.w)*(1+asym),s={a,b,dx,dz,inv,asym};
    for(let z=Math.floor((Math.min(a.z,b.z)-margin)/RIDGE_BIN);z<=Math.floor((Math.max(a.z,b.z)+margin)/RIDGE_BIN);z++)for(let x=Math.floor((Math.min(a.x,b.x)-margin)/RIDGE_BIN);x<=Math.floor((Math.max(a.x,b.x)+margin)/RIDGE_BIN);x++){const key=x+':'+z;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(s);}
  }
  for(let i=0;i<=count;i++){
    const t=i===0?0:i===count?1:(i+(r(300+i)-.5)*.55)/count,envelope=Math.min(1,t*4,(1-t)*4),bend=((r(10+i)-.5)*800+fieldNoise(t*2.4+r(7)*8,r(8)*10)*650)*ratio;
    const height=peak*envelope*(.48+r(40+i)*.52);nodes.push(node((t-.5)*length,bend,height,width*(.5+r(70+i)*.6)));
    if(i)segment(nodes[i-1],nodes[i],.2+r(90+i)*.3);
  }
  for(let i=1;i<count;i++)for(const side of [-1,1]){
    if(r(400+i*2+side)<.32)continue;
    const root=nodes[i],reach=(650+r(110+i*2+side)*1500)*ratio,skew=(r(150+i*2+side)-.5)*1450*ratio,points=[root];
    for(let j=1;j<=3;j++){
      const t=j/3,curve=(r(500+i*9+j*2+side)-.5)*reach*.25;
      points.push({x:root.x+vx*side*reach*t+ux*(skew*t+curve),z:root.z+vz*side*reach*t+uz*(skew*t+curve),h:root.h*Math.pow(1-t,1.15)*(j===1?.8+r(180+i*2+side)*.3:1),w:root.w*(1-t*.7)});
      segment(points[j-1],points[j],.15+r(600+i*9+j*2+side)*.3);
    }
    if(r(710+i*2+side)>.55){const shoulder=points[1],fork={x:shoulder.x+vx*side*reach*.45-ux*side*reach*.55,z:shoulder.z+vz*side*reach*.45-uz*side*reach*.55,h:0,w:root.w*.3};segment(shoulder,fork,.3);}
  }
  const range={bins};ranges.set(key,range);return range;
}
function nearbyRidges(x,z,scale){
  const bx=Math.floor(x/RIDGE_BIN),bz=Math.floor(z/RIDGE_BIN),bin=bx+':'+bz,key=scale+':'+bin;if(ridgeSamples.has(key))return ridgeSamples.get(key);
  const cx=Math.floor((bx+.5)*RIDGE_BIN/scale),cz=Math.floor((bz+.5)*RIDGE_BIN/scale),segments=[];
  for(let j=-2;j<=2;j++)for(let i=-2;i<=2;i++)segments.push(...(mountainRange(cx+i,cz+j,scale).bins.get(bin)||[]));
  ridgeSamples.set(key,segments);return segments;
}
export function mountainAt(x,z,scale=RANGE_SIZE){
  let h=0;
  for(const s of nearbyRidges(x,z,scale)){
    const dx=x-s.a.x,dz=z-s.a.z,t=clamp((dx*s.dx+dz*s.dz)*s.inv,0,1),cross=dx*s.dz-dz*s.dx,distance=Math.hypot(dx-s.dx*t,dz-s.dz*t),side=cross*Math.sqrt(s.inv)/Math.max(distance,1e-8),width=(s.a.w+(s.b.w-s.a.w)*t)*(1+s.asym*side);
    if(distance>=width)continue;const crest=s.a.h+(s.b.h-s.a.h)*t;h=Math.max(h,crest*Math.pow(1-distance/width,1.55));
  }
  return h;
}
export function upliftAt(x,z){
  const wx=x+fractal(x/2400+12,z/2400-9,3)*140,wz=z+fractal(x/2400-25,z/2400+18,3)*140;
  const continental=plateField(wx,wz,6000),province=plateField(wx+731,wz-1193,2400),mountain=mountainAt(wx,wz)+mountainAt(wx+1003,wz-733,1400)*.8;
  const lowland=25+continental.base*.4+province.base*.15+continental.compression*220+province.compression*100-continental.extension*38;
  return Math.max(12,lowland+mountain+fractal(x/1400-7,z/1400+13,3)*32);
}
const DX=[1,1,0,-1,-1,-1,0,1],DZ=[0,1,1,1,0,-1,-1,-1],LENGTH=[1,Math.SQRT2,1,Math.SQRT2,1,Math.SQRT2,1,Math.SQRT2];
export function inciseDrainage(initial,n,rainfall,spacing=FIELD_STEP){
  const receiver=new Int32Array(n*n).fill(-1),offset=DX.map((x,d)=>x+DZ[d]*n);let area=Float32Array.from(rainfall),nextArea=new Float32Array(area),h=Float32Array.from(initial),nextH=new Float32Array(h);
  for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){
    const i=z*n+x;let steepest=0;
    for(let d=0;d<8;d++){const j=i+offset[d],slope=(initial[i]-initial[j])/LENGTH[d];if(slope>steepest){steepest=slope;receiver[i]=j;}}
  }
  // Contributing rainfall joins along downhill drainage trees. The bounded
  // upstream reach is included in the simulation halo, preserving exact seams.
  for(let step=0;step<DRAINAGE_STEPS;step++){
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){const i=z*n+x;let a=rainfall[i];for(let d=0;d<8;d++){const j=i+offset[d];if(receiver[j]===i)a+=area[j]*.96;}nextArea[i]=a;}
    [area,nextArea]=[nextArea,area];
  }
  // Implicit stream-power incision: trunk channels cut more strongly than
  // small tributaries, exposing the branching divides between catchments.
  for(let step=0;step<STREAM_STEPS;step++){
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){const i=z*n+x,j=receiver[i];if(j<0){nextH[i]=initial[i];continue;}const distance=spacing*(Math.abs(j-i)===n-1||Math.abs(j-i)===n+1?Math.SQRT2:1),k=95*Math.max(0,Math.sqrt(area[i])-1)/distance;nextH[i]=(initial[i]+k*h[j])/(1+k);}
    [h,nextH]=[nextH,h];
  }
  return h;
}
export function erodeGrid(initial,n,{steps=WATER_STEPS,spacing=FIELD_STEP,rainfall=1.15,talusSlope=.65}={}){
  let h=Float32Array.from(initial),nextH=Float32Array.from(h),water=new Float32Array(n*n),nextWater=new Float32Array(n*n),sediment=new Float32Array(n*n),nextSediment=new Float32Array(n*n);
  const suspended=new Float32Array(n*n),flow=new Float32Array(n*n*8),drop=new Float32Array(n*n),out=new Float32Array(n*n),offset=DX.map((x,d)=>x+DZ[d]*n);
  for(let tick=0;tick<steps;tick++){
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){const i=z*n+x;water[i]+=typeof rainfall==='number'?rainfall:rainfall[i];}
    // Virtual pipes split finite water volume among downhill neighbours.
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){
      const i=z*n+x,head=h[i]+water[i];let total=0,maxDrop=0;
      for(let d=0;d<8;d++){
        const j=i+offset[d],inside=x+DX[d]>0&&x+DX[d]<n-1&&z+DZ[d]>0&&z+DZ[d]<n-1;
        const f=inside?Math.max(0,(head-h[j]-water[j])/LENGTH[d]):0;flow[i*8+d]=f;total+=f;maxDrop=Math.max(maxDrop,(h[i]-h[j])/LENGTH[d]);
      }
      // Retain at least 55% of the cell's water per step. Emptying cells in one
      // update creates an alternating grid mode in both water and sediment.
      const scale=total>0?Math.min(.15,water[i]*.45/total):0;let volume=0;for(let d=0;d<8;d++){flow[i*8+d]*=scale;volume+=flow[i*8+d];}out[i]=volume;drop[i]=maxDrop;
    }
    // Erode to the carrying capacity of moving water, or deposit its excess.
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){
      const i=z*n+x,capacity=Math.max(.01,drop[i]/spacing)*Math.sqrt(out[i])*14*Math.sqrt(Math.max(1,water[i]));
      let change=sediment[i]>capacity?-(sediment[i]-capacity)*.12:Math.min((capacity-sediment[i])*.10,Math.max(0,drop[i])*.12,2);
      change=Math.min(change,h[i]-2);nextH[i]=h[i]-change;suspended[i]=sediment[i]+change;
    }
    // Advect suspended sediment with the same mass-conserving water fluxes.
    for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){
      const i=z*n+x;let volume=water[i]-out[i],mass=suspended[i]*(1-out[i]/Math.max(water[i],1e-9));
      for(let d=0;d<8;d++){const j=i+offset[d],incoming=flow[j*8+((d+4)&7)];volume+=incoming;mass+=incoming*suspended[j]/Math.max(water[j],1e-9);}
      nextWater[i]=Math.max(0,volume*.88);nextSediment[i]=Math.max(0,mass);
    }
    [h,nextH]=[nextH,h];[water,nextWater]=[nextWater,water];[sediment,nextSediment]=[nextSediment,sediment];
    if((tick+1)%THERMAL_EVERY===0){
      // Loose material falls from slopes exceeding the talus angle.
      for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){
        const i=z*n+x;let total=0,max=0;
        for(let d=0;d<8;d++){const j=i+offset[d],inside=x+DX[d]>0&&x+DX[d]<n-1&&z+DZ[d]>0&&z+DZ[d]<n-1,excess=inside?Math.max(0,h[i]-h[j]-spacing*LENGTH[d]*talusSlope):0;flow[i*8+d]=excess;total+=excess;max=Math.max(max,excess);}
        const scale=total>0?max*.18/total:0;let volume=0;for(let d=0;d<8;d++){flow[i*8+d]*=scale;volume+=flow[i*8+d];}out[i]=volume;
      }
      for(let z=1;z<n-1;z++)for(let x=1;x<n-1;x++){const i=z*n+x;let v=h[i]-out[i];for(let d=0;d<8;d++)v+=flow[(i+offset[d])*8+((d+4)&7)];nextH[i]=v;}
      [h,nextH]=[nextH,h];
    }
  }
  // Dry the final surface: remaining suspended material settles in place.
  for(let i=0;i<h.length;i++)h[i]+=sediment[i];return h;
}
export function generateFieldPatch(px,pz){
  const n=OUTPUT+2*FIELD_HALO,initial=new Float32Array(n*n),rain=new Float32Array(n*n),gx=px*PATCH_CELLS-1-FIELD_HALO,gz=pz*PATCH_CELLS-1-FIELD_HALO;
  for(let z=0;z<n;z++)for(let x=0;x<n;x++){const wx=(gx+x)*FIELD_STEP,wz=(gz+z)*FIELD_STEP;initial[z*n+x]=upliftAt(wx,wz);rain[z*n+x]=1.15*(1+fieldNoise(wx/1700+5,wz/1700-11)*.25);}
  const incised=inciseDrainage(initial,n,rain),eroded=erodeGrid(incised,n,{rainfall:rain,talusSlope:.9}),result=new Float32Array(OUTPUT*OUTPUT);
  for(let z=0;z<OUTPUT;z++)for(let x=0;x<OUTPUT;x++)result[z*OUTPUT+x]=eroded[(z+FIELD_HALO)*n+x+FIELD_HALO];if(sources.size>6000)sources.clear();if(ranges.size>240){ranges.clear();ridgeSamples.clear();}return result;
}
let version=0;
export const fieldVersion=()=>version;
export function storeFieldPatch(px,pz,data){version++;cache.set(px+':'+pz,data);}
function patch(px,pz){const key=px+':'+pz;if(!cache.has(key)){let data;if(readBaked&&baked.has(key))try{data=readBaked(px,pz);}catch{}if(!data){synchronousGenerations++;data=generateFieldPatch(px,pz);}cache.set(key,data);}return cache.get(key);}
function cubic(a,b,c,d,t){return b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));}
function cubicDerivative(a,b,c,d,t){return .5*(c-a)+t*(2*a-5*b+4*c-d)+1.5*t*t*(3*(b-c)+d-a);}
// Piecewise planar fracture relief, rather than smoothly rounded noise lobes.
// Each lattice triangle is a plane; folding at zero makes sharp connected
// divides. Rotated scales break up the planes into shoulders and smaller spurs.
function foldedRelief(x,z,salt){
  const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
  const a=hash(ix,iz,salt)*2-1,b=hash(ix+1,iz,salt)*2-1,c=hash(ix,iz+1,salt)*2-1,d=hash(ix+1,iz+1,salt)*2-1;
  const h=u+v<1?a+(b-a)*u+(c-a)*v:d+(c-d)*(1-u)+(b-d)*(1-v);
  return .38-Math.abs(h);
}
export function erodedHeightAt(x,z){
  const gx=x/FIELD_STEP,gz=z/FIELD_STEP,cellX=Math.floor(gx),cellZ=Math.floor(gz),px=Math.floor(cellX/PATCH_CELLS),pz=Math.floor(cellZ/PATCH_CELLS),data=patch(px,pz),ix=cellX-px*PATCH_CELLS+1,iz=cellZ-pz*PATCH_CELLS+1,tx=gx-cellX,tz=gz-cellZ;
  const k0=(iz-1)*OUTPUT+ix,k1=iz*OUTPUT+ix,k2=(iz+1)*OUTPUT+ix,k3=(iz+2)*OUTPUT+ix;
  const a=cubic(data[k0-1],data[k0],data[k0+1],data[k0+2],tx),b=cubic(data[k1-1],data[k1],data[k1+1],data[k1+2],tx),c=cubic(data[k2-1],data[k2],data[k2+1],data[k2+2],tx),d=cubic(data[k3-1],data[k3],data[k3+1],data[k3+2],tx);
  const da=cubicDerivative(data[k0-1],data[k0],data[k0+1],data[k0+2],tx),db=cubicDerivative(data[k1-1],data[k1],data[k1+1],data[k1+2],tx),dc=cubicDerivative(data[k2-1],data[k2],data[k2+1],data[k2+2],tx),dd=cubicDerivative(data[k3-1],data[k3],data[k3+1],data[k3+2],tx);
  const slope=Math.hypot(cubic(da,db,dc,dd,tz),cubicDerivative(a,b,c,d,tz))/FIELD_STEP,exposed=clamp((slope-.10)/.65,0,1);
  // Erosion still determines the mountains and drainage. These subordinate
  // outcrops change actual silhouettes and collision, with quiet basin floors.
  const relief=foldedRelief((x*.6-z*.8)/430+11,(z*.6+x*.8)/430-37,4153)*180
    +foldedRelief((x*.8+z*.6)/180+31,(z*.8-x*.6)/180-19,8191)*90
    +foldedRelief((x*.28-z*.96)/68-7,(z*.28+x*.96)/68+23,2539)*29
    +foldedRelief((x*.92+z*.39)/27,(z*.92-x*.39)/27,6551)*9;
  return Math.max(2,cubic(a,b,c,d,tz)+relief*(.08+exposed*.92));
}

// Browsers prepare simulation patches off the rendering thread. Node geometry
// checks use the same generator synchronously through erodedHeightAt.
let worker,requestId=0;const jobs=new Map(),inflight=new Map();
function requestPatch(px,pz){
  const key=px+':'+pz;if(cache.has(key))return Promise.resolve();if(inflight.has(key))return inflight.get(key);
  if(typeof Worker==='undefined'){patch(px,pz);return Promise.resolve();}
  if(baked.has(key)){
    const promise=fetch(bakedUrl(px,pz)).then(response=>{if(!response.ok)throw new Error('Missing terrain patch '+key);return response.arrayBuffer();}).then(buffer=>{if(buffer.byteLength!==OUTPUT*OUTPUT*4)throw new Error('Invalid terrain patch '+key);storeFieldPatch(px,pz,new Float32Array(buffer));}).finally(()=>inflight.delete(key));inflight.set(key,promise);return promise;
  }
  if(!worker){worker=new Worker(new URL('./terrain-worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);inflight.delete(job.key);if(data.error)job.reject(new Error(data.error));else{storeFieldPatch(data.px,data.pz,new Float32Array(data.buffer));job.resolve();}};worker.onerror=e=>{for(const job of jobs.values())job.reject(new Error(e.message));jobs.clear();inflight.clear();};}
  const id=++requestId,promise=new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject,key});worker.postMessage({id,px,pz});});inflight.set(key,promise);return promise;
}
export async function prepareHeightfield(x,z,radius=10500){
  const tasks=[];for(let pz=Math.floor((z-radius)/PATCH_SIZE);pz<=Math.floor((z+radius)/PATCH_SIZE);pz++)for(let px=Math.floor((x-radius)/PATCH_SIZE);px<=Math.floor((x+radius)/PATCH_SIZE);px++)tasks.push({px,pz,d:Math.hypot((px+.5)*PATCH_SIZE-x,(pz+.5)*PATCH_SIZE-z)});
  tasks.sort((a,b)=>a.d-b.d);await Promise.all(tasks.map(({px,pz})=>requestPatch(px,pz)));
}

// Streaming never asks the renderer to generate an absent simulation patch.
export function fieldBoundsReady(x0,z0,x1,z1){
  for(let z=Math.floor(z0/PATCH_SIZE);z<=Math.floor(z1/PATCH_SIZE);z++)for(let x=Math.floor(x0/PATCH_SIZE);x<=Math.floor(x1/PATCH_SIZE);x++)if(!cache.has(x+':'+z))return false;
  return true;
}
export function prepareFieldBounds(x0,z0,x1,z1){
  const tasks=[];for(let z=Math.floor(z0/PATCH_SIZE);z<=Math.floor(z1/PATCH_SIZE);z++)for(let x=Math.floor(x0/PATCH_SIZE);x<=Math.floor(x1/PATCH_SIZE);x++)tasks.push(requestPatch(x,z));
  return Promise.all(tasks);
}
