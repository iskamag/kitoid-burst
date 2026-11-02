import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {createTerrain,createCircuit,heightAt,sweepGround} from '../src/terrain.js';
import {pilotState,stepPilot} from '../src/flight.js';
import {routePoint,routeTangent,corridorAt,ROUTE_LENGTH,ARCH_SITES,crossedGate,COURSES,ROOT_REGION,worldRegion} from '../src/world.js';
const scene=new T.Scene(),terrain=createTerrain(scene),circuit=createCircuit(scene);
const world={heightAt,sweepGround,proximity:terrain.proximity,obstacleContact:terrain.obstacleContact,sweepObstacles:terrain.sweepObstacles};
const clamp=T.MathUtils.clamp,wrap=x=>Math.atan2(Math.sin(x),Math.cos(x)),results=[];
function run(courseIndex,reach=ROOT_REGION){
 circuit.load(courseIndex,reach);terrain.update(0,routePoint(circuit.course.samples[0],reach));
 const spawn=circuit.spawn(),state=pilotState(spawn.position.clone());state.yaw=spawn.yaw;state.pitch=spawn.pitch;state.levelAssist=true;let next=0,tick=0,minClear=Infinity;
 for(;tick<22000&&next<circuit.count;tick++){
  const gate=circuit.gates[next],near=corridorAt(state.position.x,state.position.z),goalT=gate.userData.t;
  const t=Math.min(goalT,near.t+Math.max(55,state.speed*.9)/(ROUTE_LENGTH*reach.scale));
  const target=routePoint(t,reach);target.y=heightAt(target.x,target.z)+circuit.course.lift*reach.scale;
  const gateDistance=target.distanceTo(gate.position);if(gateDistance<150)target.y=T.MathUtils.lerp(target.y,gate.position.y,1-gateDistance/150);
  for(const arch of ARCH_SITES){
   const ap=routePoint(arch.t,reach),d=Math.hypot(ap.x-state.position.x,ap.z-state.position.z),ahead=ap.clone().sub(state.position).dot(routeTangent(near.t,reach));
   if(d<190*reach.scale&&ahead>-10){const blend=1-T.MathUtils.smoothstep(d,45*reach.scale,190*reach.scale);target.y=T.MathUtils.lerp(target.y,heightAt(ap.x,ap.z)+arch.height*reach.scale*.45,blend);}
  }
  // The old canyon follower could aim below a crest once its lookahead crossed
  // the summit. Inspect the intervening ground before beginning a descent.
  for(let sample=0;sample<=4;sample++){const p=state.position.clone().lerp(target,sample/4);target.y=Math.max(target.y,heightAt(p.x,p.z)+24);}
  const delta=target.clone().sub(state.position),yawError=wrap(Math.atan2(delta.x,delta.z)-state.yaw),pitchError=Math.atan2(delta.y,Math.hypot(delta.x,delta.z))-state.pitch;
  const before=state.position.clone(),collisionsBefore=state.collisions;stepPilot(state,{steer:clamp(-yawError*2.6,-1,1),pitch:clamp(pitchError*3,-1,1),brake:Math.abs(yawError)>.38||Math.abs(pitchError)>.22||Math.abs(state.pitch)>.58,boost:false},1/60,world);
  if(process.env.CATOID_ROUTE_DEBUG&&state.collisions>collisionsBefore&&state.collisions<=3)console.error(JSON.stringify({course:circuit.course.id,t:near.t,impact:state.impact,position:state.position.toArray(),pitch:state.pitch,target:target.toArray(),next}));
  minClear=Math.min(minClear,state.position.y-heightAt(state.position.x,state.position.z));
  if(crossedGate(before,state.position,gate)){next++;state.energy=Math.min(1,state.energy+.13);}
 }
 const result={course:circuit.course.id,reach:reach.key,passed:next,total:circuit.count,seconds:+(tick/60).toFixed(2),collisions:state.collisions,minClear:+minClear.toFixed(2)};
 console.log(JSON.stringify(result));results.push(result);assert.equal(next,circuit.count,'The line must be traversable using the actual flight integrator');assert(state.collisions<=1,'The intended route must clear terrain and arches');
}
for(let i=0;i<COURSES.length;i++)run(i);
run(0,worldRegion(21600,-14400));
await mkdir('artifacts',{recursive:true});
await writeFile('artifacts/world-flight-check.json',JSON.stringify({passed:true,results},null,2));
