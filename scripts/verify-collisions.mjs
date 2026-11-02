import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {pilotState,stepPilot,HARD_IMPACT_SPEED,IMPACT_TIMEOUT,IMPACT_RESTITUTION,IMPACT_DRAG} from '../src/flight.js';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z),neutral={steer:0,pitch:0,roll:0,brake:false,boost:false};
const close=(a,b,message)=>assert(Math.abs(a-b)<1e-10,`${message}: ${a} vs ${b}`);
const wallNormal=V(0,0,-1),groundNormal=V(0,1,0);
function sweepPlane(before,after,radius,normal){
  const a=before.dot(normal)-radius,b=after.dot(normal)-radius;
  if(b>=0)return null;
  return{position:before.clone().lerp(after,a>0?a/(a-b):0).addScaledVector(normal,.01),normal:normal.clone(),name:'STONE WALL'};
}
function worldFor(kind,{solid=true,direct=false}={}){
  const normal=kind==='ground'?groundNormal:wallNormal;
  const world={heightAt:()=>kind==='ground'?0:-1000,proximity:()=>Infinity,
    sweepGround:(a,b,r)=>{
      const hit=solid&&kind==='ground'?sweepPlane(a,b,r,normal):null;
      return hit?{...hit,hit:true}:{hit:false,position:b.clone()};
    }};
  if(kind==='wall'){
    if(direct)world.obstacleContact=(p,r)=>solid&&p.dot(normal)<r?{normal:normal.clone(),distance:p.dot(normal),name:'STONE WALL'}:null;
    else world.sweepObstacles=(a,b,r)=>solid?sweepPlane(a,b,r,normal):null;
  }
  return world;
}
function stateFor(kind,velocity,bank=0){
  const state=pilotState(kind==='ground'?V(0,3.05,0):V(0,100,-3.05));
  state.velocity=velocity.clone();state.speed=velocity.length();
  state.orientation=new T.Quaternion().setFromUnitVectors(V(0,0,1),velocity.clone().normalize())
    .multiply(new T.Quaternion().setFromAxisAngle(V(0,0,1),bank));
  state.energy=.7;state.streak=4;state.steer=.2;return state;
}
function softCase(kind,velocity,input=neutral,direct=false){
  const normal=kind==='ground'?groundNormal:wallNormal,state=stateFor(kind,velocity),free=stateFor(kind,velocity);
  stepPilot(free,input,1/120,worldFor(kind,{solid:false}));
  stepPilot(state,input,1/120,worldFor(kind,{direct}));
  const expected=free.velocity.clone().addScaledVector(normal,-Math.min(0,free.velocity.dot(normal)));
  assert(state.velocity.distanceTo(expected)<1e-10,'Soft contact preserves tangential velocity exactly');
  close(state.energy,free.energy,'No soft-contact energy penalty');close(state.streak,free.streak,'No soft-contact streak reset');
  close(state.steer,free.steer,'Soft contact preserves steering');
  assert.deepEqual(state.orientation.toArray(),free.orientation.toArray(),'Soft contact preserves the steering frame');
  assert.equal(state.collisions,0);assert.equal(state.timeouts,0);assert.equal(state.timeout,0);assert.equal(state.impact,'');
  assert(state.position.dot(normal)>=3,'Contact resolves outside the surface');return state;
}
softCase('wall',V(12,0,23),{...neutral,brake:true});
softCase('ground',V(12,-23,0),{...neutral,brake:true});
softCase('wall',V(150,0,10)); // High speed with a gentle normal approach.
softCase('ground',V(150,-10,0));
softCase('wall',V(0,0,23),{...neutral,brake:true},true);

function hardCase(kind,bank=0){
  const velocity=kind==='ground'?V(0,-68,0):V(0,0,68),state=stateFor(kind,velocity,bank),free=stateFor(kind,velocity,bank);
  stepPilot(free,neutral,1/120,worldFor(kind,{solid:false}));
  stepPilot(state,neutral,1/120,worldFor(kind));
  assert.equal(state.collisions,1);assert.equal(state.timeouts,1);assert.equal(state.timeout,IMPACT_TIMEOUT);
  close(state.energy,free.energy-.18,'Hard-hit energy penalty happens once');assert.equal(state.streak,0);
  const normal=kind==='ground'?groundNormal:wallNormal,expected=free.velocity.clone().addScaledVector(normal,-(1+IMPACT_RESTITUTION)*Math.min(0,free.velocity.dot(normal)));
  assert(state.velocity.distanceTo(expected)<1e-10,'Hard contact reflects momentum away from the surface');assert(state.velocity.dot(normal)>0);assert.deepEqual(state.angularVelocity.toArray(),free.angularVelocity.toArray());close(state.speed,expected.length(),'Rebound speed');assert.equal(state.boost,0);
  assert.equal(state.impact,kind==='ground'?'RIDGE':'STONE WALL');
  assert.deepEqual(state.orientation.toArray(),free.orientation.toArray(),'Hard contact retains the current orientation');
  assert(state.position.dot(kind==='ground'?groundNormal:wallNormal)>=3);return state;
}
hardCase('ground');
assert.equal(HARD_IMPACT_SPEED,45);
assert.equal(pilotState().timeout,0);assert.equal(pilotState().timeouts,0);

const intrusive={steer:1,pitch:-1,roll:1,brake:true,boost:true,spinning:true},timerRates=[30,60,144];
for(const rate of timerRates){
  const state=hardCase('wall',1.1),reference=hardCase('wall',1.1),position=state.position.clone(),velocity=state.velocity.clone();
  const retained={energy:state.energy,score:state.score,streak:state.streak,bank:state.bank,steer:state.steer};
  // The control lock still queries swept collisions, but not the powered flight
  // or proximity-scoring path. Compare all inputs held against neutral input.
  const world=worldFor('wall');world.heightAt=world.proximity=()=>{throw new Error('Control-locked motion must not run flight thrust/scoring');};
  let elapsed=0;
  while(elapsed<IMPACT_TIMEOUT-1e-10){
    const dt=Math.min(1/rate,IMPACT_TIMEOUT-elapsed);state.spinDelta=Math.PI*2;
    stepPilot(state,intrusive,dt,world);stepPilot(reference,neutral,dt,world);elapsed+=dt;
    const expected=position.clone().addScaledVector(velocity,-Math.expm1(-IMPACT_DRAG*elapsed)/IMPACT_DRAG);
    assert(state.position.distanceTo(expected)<1e-9,'Rebound coasts throughout the control lock at every frame rate');
    assert.deepEqual(state.position.toArray(),reference.position.toArray(),'Inputs cannot change the rebound trajectory');
    assert.deepEqual(state.velocity.toArray(),reference.velocity.toArray());assert.deepEqual(state.orientation.toArray(),reference.orientation.toArray(),'Steering and queued spin are ignored while physical angular motion continues');
    for(const [key,value] of Object.entries(retained))assert.equal(state[key],value,`Timeout retains ${key}`);
    assert(state.speed>0);assert.equal(state.boost,0);assert.equal(state.spinDelta,0);assert.equal(state.collisions,1);assert.equal(state.timeouts,1);
    close(state.timeout,Math.max(0,IMPACT_TIMEOUT-elapsed),`Timeout duration at ${rate} Hz`);
    if(state.timeout>0)assert.equal(state.impact,'STONE WALL');
  }
  assert(state.position.distanceTo(position)>30,'The cat must visibly rebound rather than hang at the wall');
  assert.equal(state.timeout,0);assert.equal(state.impact,'');
  const orientation=state.orientation.clone();
  for(let i=0;i<rate*3;i++)stepPilot(state,{...neutral,steer:1,brake:true},1/rate,worldFor('wall'));
  assert.equal(state.collisions,1);assert.equal(state.timeout,0);assert(state.speed>0);assert(state.orientation.angleTo(orientation)>.5,'Steering returns after the countdown');
}

// A second surface can bounce the uncontrolled cat again without extending the
// lock or repeatedly charging a collision penalty.
const corridor=worldFor('wall'),baseSweep=corridor.sweepObstacles;let secondaryHits=0;
corridor.sweepObstacles=(a,b,r)=>{
  const first=baseSweep(a,b,r);if(first)return first;
  const offset=V(0,0,20),hit=sweepPlane(a.clone().add(offset),b.clone().add(offset),r,V(0,0,1));
  if(hit){hit.position.sub(offset);secondaryHits++;}return hit;
};
const pinball=hardCase('wall',.8),penaltyEnergy=pinball.energy;
stepPilot(pinball,intrusive,.9,corridor);assert(secondaryHits>0,'Coasting still collides with another wall');assert.equal(pinball.timeouts,1);assert.equal(pinball.collisions,1);close(pinball.timeout,.3,'Secondary bounce must not restart the control lock');close(pinball.energy,penaltyEnergy,'Secondary bounce must not charge another penalty');assert(pinball.position.z>=-17&&pinball.position.z<=-3);
const falling=pilotState(V(0,3.05,0));falling.timeout=.8;falling.velocity=V(0,-30,0);
stepPilot(falling,intrusive,.1,worldFor('ground'));assert(falling.position.y>=3&&falling.velocity.y>0,'Control-locked motion still bounces off the ground');assert.equal(falling.timeouts,0);close(falling.timeout,.7,'Ground bounce keeps the current countdown');

// A timeout ending inside a large frame consumes only its remaining duration.
const recovered=hardCase('wall',.7),split=hardCase('wall',.7),before=recovered.orientation.toArray();
stepPilot(recovered,intrusive,IMPACT_TIMEOUT-.025,worldFor('wall'));
recovered.spinDelta=Math.PI*2;
stepPilot(recovered,{...neutral,steer:1,brake:true},.05,worldFor('wall'));
stepPilot(split,neutral,IMPACT_TIMEOUT,worldFor('wall'));stepPilot(split,{...neutral,steer:1,brake:true},.025,worldFor('wall'));
assert(recovered.position.distanceTo(split.position)<1e-9&&recovered.orientation.angleTo(split.orientation)<1e-7,'Controls resume only in the post-timeout portion of a frame');
assert.equal(recovered.timeout,0);assert.equal(recovered.timeouts,1);
assert.notDeepEqual(recovered.orientation.toArray(),before,'Steering resumes after the remaining timeout expires');
assert(recovered.orientation.angleTo(new T.Quaternion().fromArray(before))<.01,'Queued spin does not leak into the recovery portion');
console.log(JSON.stringify({passed:true,hardImpactSpeed:HARD_IMPACT_SPEED,timeoutSeconds:IMPACT_TIMEOUT,timerRates,softCases:5,rebound:true,inputsLocked:true,secondaryBounces:true},null,2));
