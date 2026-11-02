import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {DEFAULT_GENES,DEFINITIONS,GROUPS,PRESETS,spawnGenes,mutateGenes,crossGenes,validateGenome} from '../src/genes.js';
import {develop} from '../src/development.js';
import {Catoid} from '../src/catoid.js';
import {flightInput,BarrelRoll,pilotState,stepPilot,rewardRoll} from '../src/flight.js';
import {createTerrain,createCircuit,heightAt,sweepGround} from '../src/terrain.js';
import {fogIntegral,fogAt,FOG_DENSITY,FOG_FALLOFF,SUN_DIRECTION} from '../src/atmosphere.js';
import {routePoint,corridorAt,ARCH_SITES,COURSES,worldRegion,WORLD_SIZE} from '../src/world.js';

assert.equal(DEFINITIONS.length,67);
assert.deepEqual(spawnGenes(413),spawnGenes(413));
const mutation=mutateGenes(DEFAULT_GENES,71),changed=DEFINITIONS.filter(([k])=>mutation.genes[k]!==DEFAULT_GENES[k]).map(([k])=>k);
assert(changed.length>=2&&changed.length<=5);
const module=GROUPS.find(([name])=>name===mutation.module)[1].map(([k])=>k);assert(changed.every(k=>module.includes(k)));
const a=spawnGenes(11),b=spawnGenes(23),offspring=crossGenes(a,b,83);
for(const [,rows] of GROUPS)assert(rows.every(([k])=>offspring[k]===a[k])||rows.every(([k])=>offspring[k]===b[k]),'Inherited modules must stay coherent');
assert.throws(()=>validateGenome({version:2,eyes:9,seed:1,genes:{...a,axialGrowth:NaN}}));

const plans=Object.values(PRESETS).map(develop);
assert.equal(new Set(plans.map(p=>p.counts.axes)).size,3,'Founders should have different body topology');
// Sample ordinary founders, not just curated presets. This guards against
// shrinking seed exploration back to small perturbations of one body plan.
const population=Array.from({length:128},(_,i)=>develop(spawnGenes(i*104729+11)));
const architectures=new Set(population.map(d=>[d.counts.axes,d.counts.limbs,d.counts.tails,d.tissue.solid>.58].join('/')));
const ratio=field=>Math.max(...population.map(field))/Math.min(...population.map(field));
assert(architectures.size>=40,'Random seeds must span distinct growth architectures');
assert(ratio(d=>d.length)>4,'Random seeds must span compact and elongated bodies');
assert(ratio(d=>d.radius)>6,'Random seeds must span thin and bulky tissue');
assert(ratio(d=>d.tissue.vertical)>3,'Random seeds must span planar and volumetric tissue');
assert(population.every(d=>d.eyes.length===9));
const model=new Catoid();
for(const g of [DEFAULT_GENES,...Object.values(PRESETS),...Array.from({length:12},(_,i)=>spawnGenes(i*337)),...['low','high'].map(side=>Object.fromEntries(DEFINITIONS.map(([k])=>[k,side==='low'?0:1])))]){
  const d=develop(g);assert.equal(d.eyes.length,9);assert(d.counts.bodyEyes>=2);assert(d.counts.limbBranches<45);assert(d.counts.tails<=21);
  model.rebuild(g);model.animate(1.23,140,.4,1,1);assert.equal(model.eyeGroups.length,9);
  model.model.traverse(o=>{if(o.isMesh)assert(o.geometry.attributes.position.array.every(Number.isFinite),'All generated geometry must be finite');});
}
// Growth must remain in the creature's local frame after flying and rotating.
model.rebuild(DEFAULT_GENES);const baseline=model.viewRadius;
model.root.position.set(1220,370,-800);model.root.rotation.set(.2,1.7,.7);model.rebuild(DEFAULT_GENES);
assert(Math.abs(model.viewRadius-baseline)<.001,'Rebuilding must not bake world coordinates into tissues');
model.animate(0,0,0,0,.05);const embryo=model.growthItems.filter(x=>x.group.visible).length;
model.animate(0,0,0,0,1);assert(model.growthItems.filter(x=>x.group.visible).length>embryo);

const flat={heightAt:()=>0,sweepGround:(a,b)=>({hit:false,position:b.clone()}),proximity:()=>Infinity};
for(const yaw of [0,Math.PI/2,Math.PI,-1.1])for(const bank of [0,Math.PI/2,Math.PI])for(const [key,sign] of [['KeyA',-1],['ArrowLeft',-1],['KeyD',1],['ArrowRight',1]]){
  const state=pilotState(new T.Vector3(0,1000,0));state.levelAssist=false;
  state.orientation=new T.Quaternion().setFromEuler(new T.Euler(0,yaw,0,'YXZ')).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),bank));
  const right=new T.Vector3(-1,0,0).applyQuaternion(state.orientation);
  for(let i=0;i<24;i++)stepPilot(state,flightInput(new Set([key])),1/60,flat);
  assert(sign*new T.Vector3(0,0,1).applyQuaternion(state.orientation).dot(right)>.15,`${key} must turn to its screen side through banks and headings`);
  assert(sign*state.position.clone().add(new T.Vector3(0,-1000,0)).dot(right)>.5,'Velocity must follow the turn');
}
assert.equal(flightInput(new Set(),{x:1}).steer,1);assert.equal(flightInput(new Set(),{x:-1}).steer,-1);
for(const rate of [30,60,144]){
  const roll=new BarrelRoll();assert(!roll.tap(-1,0));assert(roll.tap(-1,.16));assert(!roll.trigger(1));let total=0;
  for(let i=0;i<Math.ceil(rate*1.2);i++){roll.update(1/rate);total+=roll.delta;}
  assert(Math.abs(total+Math.PI*2)<1e-10);assert.equal(roll.active,false);assert.equal(roll.completed,1);assert.equal(roll.angle,0);
  const single=new BarrelRoll();assert(!single.tap(1,0));assert(!single.tap(1,.4));assert(!single.tap(-1,.5));assert(!single.active,'Single or opposite taps must not launch a spin');
}
const scene=new T.Scene(),terrain=createTerrain(scene),ray=new T.Raycaster();scene.updateMatrixWorld(true);let maxError=0;
for(let i=0;i<24;i++){
  const x=Math.sin(i*37.35)*3200,z=Math.cos(i*13.77)*3200;
  const mesh=terrain.meshAt(x,z);ray.set(new T.Vector3(x,3000,z),new T.Vector3(0,-1,0));const hit=ray.intersectObject(mesh)[0];assert(hit);
  maxError=Math.max(maxError,Math.abs(hit.point.y-heightAt(x,z)));assert(maxError<.001);
}
const tileA=terrain.meshAt(-2050,-850).geometry,tileB=terrain.meshAt(-2050+384,-850).geometry;
for(let row=0;row<=48;row++){
  const a=new T.Vector3().fromBufferAttribute(tileA.attributes.normal,row*49+48),b=new T.Vector3().fromBufferAttribute(tileB.attributes.normal,row*49);
  assert(a.distanceTo(b)<1e-5,'Neighboring fine tiles must share their lighting normals');
}
const tileMap=new Map([...terrain.tiles.values()].map(({mesh})=>{const p=mesh.geometry.attributes.position;return[Math.round(p.getX(0)/384)+':'+Math.round(p.getZ(0)/384),mesh];}));let mixedEdges=0;
for(const[key,mesh]of tileMap){
  const [tx,tz]=key.split(':').map(Number),other=tileMap.get((tx+1)+':'+tz);if(!other||mesh.geometry.attributes.position.count===other.geometry.attributes.position.count)continue;
  const edge=(m,x)=>{const p=m.geometry.attributes.position,n=m.geometry.attributes.normal,map=new Map();for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<.001)map.set(p.getZ(i),[p.getY(i),n.getX(i),n.getY(i),n.getZ(i)]);return map;};
  const a=edge(mesh,(tx+1)*384),b=edge(other,(tx+1)*384);assert.equal(a.size,49);assert.equal(b.size,49);for(const[z,v]of a)assert.deepEqual(v,b.get(z),'All terrain LODs must share exact edge positions and normals');mixedEdges++;
}
assert(mixedEdges>0,'Check boundaries between different terrain LODs');
// Space brakes; removed elevator axes and Control never translate vertically.
assert.deepEqual(flightInput(new Set(['ControlLeft']),{up:1,down:1}),flightInput(new Set()));
assert(flightInput(new Set(['Space'])).brake);assert.equal(flightInput(new Set(['KeyW'])).pitch,1);
const level=pilotState(new T.Vector3(0,100,0));
for(let i=0;i<120;i++)stepPilot(level,flightInput(new Set(['Space'])),1/60,flat);
assert.equal(level.position.y,100);assert(level.speed<24);
stepPilot(level,flightInput(new Set(['KeyW'])),.4,flat);
for(let i=0;i<60;i++)stepPilot(level,flightInput(new Set()),1/60,flat);const heldPitch=level.pitch;
for(let i=0;i<60;i++)stepPilot(level,flightInput(new Set()),1/60,flat);
assert(Math.abs(level.pitch-heldPitch)<1e-5);assert(level.position.y>130,'Pitch, rather than an elevator, changes altitude');
const low=pilotState(new T.Vector3(0,12,0)),high=pilotState(new T.Vector3(0,180,0));low.energy=high.energy=.2;
for(let i=0;i<180;i++){stepPilot(low,flightInput(new Set()),1/60,flat);stepPilot(high,flightInput(new Set()),1/60,flat);}
assert(low.energy>high.energy+.15,'Skimming must regenerate burst faster');assert(low.score>high.score);
const skimBurst=pilotState(new T.Vector3(0,12,0)),openBurst=pilotState(new T.Vector3(0,180,0));
for(const state of [skimBurst,openBurst]){state.speed=188;state.boost=1;state.energy=.8;}
for(let i=0;i<120;i++){stepPilot(skimBurst,flightInput(new Set(['ShiftLeft'])),1/120,flat);stepPilot(openBurst,flightInput(new Set(['ShiftLeft'])),1/120,flat);}
assert(skimBurst.energy>openBurst.energy+.1,'Grazing must reduce active burst drain');assert(skimBurst.energy<.8,'Grazing reduces drain rather than granting free burst');
// Pitch is in the physical body frame. At a quarter roll it turns across the
// landscape instead of climbing; the camera follows this same frame in play.
for(const bank of [-Math.PI/2,0,Math.PI/2]){
  const state=pilotState(new T.Vector3(0,1000,0));state.levelAssist=false;state.orientation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),bank);
  for(let i=0;i<60;i++)stepPilot(state,flightInput(new Set(['KeyW'])),1/60,flat);
  if(bank){assert(-Math.sign(bank)*state.position.x>15);assert(Math.abs(state.position.y-1000)<1e-8);}else assert(state.position.y>1015);
}
const rollStates=[];
for(const rate of [30,60,144]){
  const state=pilotState(new T.Vector3(0,1000,0));state.levelAssist=false;
  for(let i=0;i<rate;i++)stepPilot(state,flightInput(new Set(['KeyE'])),1/rate,flat);
  assert(state.rollBank>2.5,'Holding roll rotates the actual steering frame');assert(Math.abs(state.position.x)<1e-8&&Math.abs(state.position.y-1000)<1e-8,'A roll must not inject a scripted sideways path');
  const angular=state.angularVelocity.length();for(let i=0;i<rate/2;i++)stepPilot(state,flightInput(new Set()),1/rate,flat);assert(state.angularVelocity.length()<angular*.01,'Released roll damps angular momentum');rollStates.push(state);
}
assert(rollStates[0].orientation.angleTo(rollStates[1].orientation)<.01&&rollStates[1].orientation.angleTo(rollStates[2].orientation)<.02,'Physical roll must be consistent across frame rates');
// Turning the body cannot instantly reverse travel. Airbraking reduces that
// drift, while full pitch rotations remain possible without a vertical clamp.
const drift=[];for(const brake of [false,true]){
  const state=pilotState(new T.Vector3(0,1000,0));state.levelAssist=false;state.orientation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI);state.velocity=new T.Vector3(0,0,150);
  stepPilot(state,{...flightInput(new Set()),brake},.1,flat);
  drift.push(state.velocity.z);if(!brake)assert(state.velocity.z>90,'Travel retains momentum after changing heading');
}
assert(drift[1]<drift[0]*.7,'Braking must shed momentum substantially faster');
const looping=pilotState(new T.Vector3(0,1000,0));looping.levelAssist=false;let inverted=false,backward=false;
for(let i=0;i<360;i++){stepPilot(looping,flightInput(new Set(['KeyW'])),1/60,flat);const f=new T.Vector3(0,0,1).applyQuaternion(looping.orientation),up=new T.Vector3(0,1,0).applyQuaternion(looping.orientation);inverted||=up.y<-.9;backward||=f.z<-.9;}
assert(inverted&&backward&&Math.abs(looping.orientation.length()-1)<1e-10,'A complete vertical loop must preserve a valid physical frame');
// Steering during a fast spin must affect the resulting heading and travel;
// completing the animation must not restore a saved orientation or flight line.
for(const direction of [-1,1]){
  const state=pilotState(new T.Vector3(0,1000,0));state.levelAssist=false;const spin=new BarrelRoll();spin.trigger(direction);
  for(let i=0;i<120;i++){const active=spin.active;spin.update(1/120);state.spinDelta=spin.delta;const input=flightInput(new Set(i>10&&i<42?['KeyW']:[]));input.spinning=active;stepPilot(state,input,1/120,flat);}
  assert(-direction*state.position.x>2,'Timed steering during a spin must change the flight path');assert(state.orientation.angleTo(new T.Quaternion())>.07,'A spin must retain the heading chosen during it');
}
const reward={score:0,energy:.2,streak:0};assert.equal(rewardRoll(reward),0);assert.equal(reward.score,0);
assert.equal(rewardRoll(reward,{close:true}),350);assert.equal(reward.energy,.45);assert.equal(rewardRoll(reward,{gate:true}),500);assert(reward.energy>.6);
// Independently integrate IQ's height density along the actual segment. This
// catches an endpoint-height tint, a missing normalization, and horizon NaNs.
for(const [eye,end] of [[[0,100,0],[0,100,1400]],[[0,100,0],[0,100.000001,1400]],[[0,100,0],[0,99.999999,1400]],[[0,40,0],[0,1600,3000]],[[0,1600,0],[0,40,3000]],[[0,-100,0],[1000,900,3000]],[[0,500,0],[0,500,0]]]){
  const length=Math.hypot(...end.map((v,i)=>v-eye[i]));let quadrature=0;
  for(let i=0;i<8192;i++)quadrature+=FOG_DENSITY*Math.exp(-(eye[1]+(end[1]-eye[1])*(i+.5)/8192)*FOG_FALLOFF)*length/8192;
  const analytic=fogIntegral(eye,end);assert(Number.isFinite(analytic)&&Math.abs(analytic-quadrature)<1e-7,'Analytic fog must match the density integral, including horizontal rays');
  assert(Math.abs(analytic-fogIntegral(end,eye))<1e-12,'The same volume must have the same integrated density in either direction');
  const f=fogAt([.2,.3,.1],eye,end);assert(f.amount>=0&&f.amount<=1&&f.color.every(Number.isFinite));
}
assert(fogIntegral([0,20,0],[0,20,1000])>fogIntegral([0,1200,0],[0,1200,1000])*2,'Lower rays traverse denser atmosphere');
assert(fogAt([1,1,1],[0,100,0],[0,100,20]).amount<.01,'Nearby surfaces stay readable without an artificial near cutoff');
const sunRay=SUN_DIRECTION.clone().multiplyScalar(3000),awayRay=sunRay.clone();awayRay.x*=-1;awayRay.z*=-1;
const sunFog=fogAt([0,0,0],[0,500,0],sunRay.clone().add(new T.Vector3(0,500,0)).toArray()),awayFog=fogAt([0,0,0],[0,500,0],awayRay.clone().add(new T.Vector3(0,500,0)).toArray());
assert(Math.abs(sunFog.amount-awayFog.amount)<1e-12&&sunFog.color[0]>awayFog.color[0]*3,'Sun direction changes scattering color, not the fog volume');
assert.equal(pilotState().levelAssist,false,'Roll must persist by default');
const persistent=pilotState(new T.Vector3(0,1000,0));for(let i=0;i<35;i++)stepPilot(persistent,flightInput(new Set(['KeyE'])),1/60,flat);
for(let i=0;i<120;i++)stepPilot(persistent,flightInput(new Set()),1/60,flat);const heldBank=persistent.orientation.clone();
for(let i=0;i<180;i++)stepPilot(persistent,flightInput(new Set()),1/60,flat);assert(persistent.orientation.angleTo(heldBank)<1e-6,'Releasing roll must damp angular velocity without levelling the frame');
// A heightfield playground needs open slopes between mountain groups. Sampling
// directions around the route catches a continuous trench even on a large map.
let blockedSectors=0,openSites=0;
for(let i=0;i<80;i++){
  const p=routePoint(i/80),eye=heightAt(p.x,p.z)+70;let blocked=0;
  for(let k=0;k<16;k++){const a=k/16*Math.PI*2;if([150,300,450].some(d=>heightAt(p.x+Math.cos(a)*d,p.z+Math.sin(a)*d)>eye))blocked++;}
  blockedSectors+=blocked;if(blocked<=4)openSites++;
}
assert(blockedSectors/(80*16)<.5&&openSites/80>.25,'Open country must interrupt the narrows');
// Features must matter within a few seconds of flight, rather than only across
// kilometre-wide basins. Preserve local relief while the openness check above
// guards against turning the entire map into enclosed channels again.
const localRelief=[],landHeights=[];let steepSlopes=0,gentleSlopes=0;
for(let iz=0;iz<24;iz++)for(let ix=0;ix<24;ix++){
  const x=-3000+ix*250,z=-3000+iz*250,heights=[heightAt(x,z)];landHeights.push(heights[0]);
  const slope=Math.hypot(heightAt(x+10,z)-heightAt(x-10,z),heightAt(x,z+10)-heightAt(x,z-10))/20;steepSlopes+=slope>.7;gentleSlopes+=slope<.15;
  for(let k=0;k<8;k++){const angle=k*Math.PI/4;heights.push(heightAt(x+Math.cos(angle)*100,z+Math.sin(angle)*100));}
  localRelief.push(Math.max(...heights)-Math.min(...heights));
}
localRelief.sort((a,b)=>a-b);const localReliefMedian=localRelief[288],roughAreaRelief=localRelief[518];
assert(localReliefMedian>75&&roughAreaRelief>180,'Foothills and rugged slopes must have substantial relief at flight scale');
assert(Math.max(...landHeights)-Math.min(...landHeights)>750,'Mountain crests must rise substantially above the lowlands');
assert(steepSlopes/576>.2&&gentleSlopes/576>.08&&gentleSlopes/576<.24,'Steep mountain faces and open, gentler country must both occupy substantial areas');
const courses=createCircuit(scene);
for(let i=0;i<COURSES.length;i++){
  courses.load(i);const spawn=courses.spawn(),state=pilotState(spawn.position);state.yaw=spawn.yaw;state.pitch=spawn.pitch;
  for(const gate of courses.gates){assert(gate.position.y-heightAt(gate.position.x,gate.position.z)>25);assert(!terrain.obstacleContact(gate.position,3),'Gate center must be outside the arch rock');}
  const from=spawn.position.clone(),to=courses.gates[0].position;
  assert(!sweepGround(from,to).hit,'Each route must start with a clear approach');
}
const probe=routePoint(.075);probe.y=heightAt(probe.x,probe.z)+ARCH_SITES[0].height*.45;
assert(!terrain.obstacleContact(probe,3),'The arch must have an open interior');
const wall=terrain.obstacles[0].a;assert(terrain.obstacleContact(wall,3),'The visible arch must be collidable');
const groundPoint=routePoint(.05),ground=heightAt(groundPoint.x,groundPoint.z);
const hit=sweepGround(new T.Vector3(groundPoint.x,ground+20,groundPoint.z),new T.Vector3(groundPoint.x,ground-30,groundPoint.z),3);
assert(hit.hit&&hit.position.y-ground>=3,'Swept contact must stop above the actual ground');
const distantReach=worldRegion(21600,-14400),distant=routePoint(.3,distantReach);
assert(distant.distanceTo(new T.Vector3())>WORLD_SIZE*2);assert(corridorAt(distant.x,distant.z).distance<.01);
terrain.update(0,distant);courses.load(0,distantReach);assert.equal(courses.region.key,'3:-2');assert(terrain.arches.length>0);
const farMesh=terrain.meshAt(distant.x,distant.z);ray.set(new T.Vector3(distant.x,3000,distant.z),new T.Vector3(0,-1,0));const farHit=ray.intersectObject(farMesh)[0];assert(farHit&&Math.abs(farHit.point.y-heightAt(distant.x,distant.z))<.001);
console.log(JSON.stringify({passed:true,regulators:67,finiteGenomes:18,nineEyes:true,topologyVaries:true,randomSeeds:128,growthArchitectures:architectures.size,moduleInheritance:true,worldIndependentGrowth:true,screenSpaceSteering:true,frameIndependentRolls:true,bodyFrameSteering:true,momentum:true,fullPitchLoops:true,contextualStuntRewards:true,noClimbElevator:true,skimRechargesBurst:true,distanceFog:true,analyticHeightFog:true,directionalScattering:true,persistentBank:true,openTerrain:true,blockedViewingDirections:blockedSectors/(80*16),openRouteSites:openSites/80,localReliefMedian,roughAreaRelief,mountainRelief:Math.max(...landHeights)-Math.min(...landHeights),steepFraction:steepSlopes/576,gentleFraction:gentleSlopes/576,routeApproaches:COURSES.length,collidableArches:true,unboundedReaches:true,maxHeightError:maxError},null,2));
