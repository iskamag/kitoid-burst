import * as T from '../vendor/three.module.js';
// Body +Z is forward; its chase camera's screen-right is body -X.
const Z=new T.Vector3(0,0,1),UP=new T.Vector3(0,1,0);
const clamp=T.MathUtils.clamp,lerp=T.MathUtils.lerp;
export const HARD_IMPACT_SPEED=45,IMPACT_TIMEOUT=1.2,IMPACT_RESTITUTION=.65,IMPACT_DRAG=.35;
export function flightInput(keys,touch={}){
  const held=(...names)=>names.some(k=>keys.has(k))?1:0;
  return{steer:clamp(held('KeyD','ArrowRight')-held('KeyA','ArrowLeft')+(touch.x||0),-1,1),pitch:clamp(held('KeyW','ArrowUp')-held('KeyS','ArrowDown')-(touch.y||0),-1,1),roll:clamp(held('KeyE','KeyC')-held('KeyQ','KeyZ')+(touch.roll||0),-1,1),brake:!!(held('Space','KeyX')||touch.brake),boost:!!(held('ShiftLeft','ShiftRight')||touch.boost)};
}
export function rewardRoll(state,{close=false,gate=false}={}){
  if(!close&&!gate)return 0;const points=gate?500:350;state.energy=clamp(state.energy+(gate?.22:.25),0,1);state.score+=points;state.streak+=gate?2:1.5;return points;
}
export function pilotState(position=new T.Vector3()){
  // Initialize the frame lazily, after the caller sets its starting heading.
  return{position,orientation:null,velocity:null,angularVelocity:new T.Vector3(),yaw:0,pitch:0,rollBank:0,rollGrace:0,levelAssist:false,bank:0,steer:0,speed:68,boost:0,energy:1,boostLocked:false,flow:0,streak:0,score:0,collisions:0,timeout:0,timeouts:0,impactCooldown:0,impact:''};
}
export function horizonRoll(orientation){
  const forward=Z.clone().applyQuaternion(orientation),up=UP.clone().applyQuaternion(orientation),reference=UP.clone().addScaledVector(forward,-forward.y);
  if(reference.lengthSq()<.004)return null;reference.normalize();
  return Math.atan2(forward.dot(reference.clone().cross(up)),reference.dot(up));
}
function integrate(state,input,dt,world,radius,spinDelta){
  if(state.timeout>0){
    const locked=Math.min(dt,state.timeout);
    // Input is locked, but the body keeps its rebound momentum and collides
    // with the world. Integrate drag over this interval, without flight thrust.
    state.velocity.multiplyScalar(Math.exp(-IMPACT_DRAG*locked));
    state.angularVelocity.multiplyScalar(Math.exp(-5*locked));
    const angularSpeed=state.angularVelocity.length();
    if(angularSpeed>1e-8)state.orientation.multiply(new T.Quaternion().setFromAxisAngle(state.angularVelocity.clone().divideScalar(angularSpeed),angularSpeed*Math.expm1(5*locked)/5)).normalize();
    updateFrame(state);
    movePilot(state,Math.expm1(IMPACT_DRAG*locked)/IMPACT_DRAG,world,radius,true);
    state.timeout=Math.max(0,state.timeout-locked);state.boost=0;state.flow=0;
    if(state.timeout<1e-12){state.timeout=0;state.impact='';}
    dt-=locked;if(dt<1e-12)return state;spinDelta=0;
  }
  const clearance=state.position.y-world.heightAt(state.position.x,state.position.z)-radius,obstacleDistance=world.proximity?.(state.position)??Infinity,proximity=Math.min(clearance,obstacleDistance-radius);
  state.flow=clamp((48-proximity)/43,0,1)*clamp((state.speed-34)/80,0,1);
  state.streak=state.flow>.06?state.streak+dt:Math.max(0,state.streak-dt*2.5);state.score+=state.flow*state.speed*dt*(1+Math.min(state.streak*.22,4));
  if(state.boostLocked&&state.energy>.20)state.boostLocked=false;
  const burning=input.boost&&!state.boostLocked&&state.energy>.005;
  state.energy=clamp(state.energy+dt*(burning?-.18*(1-state.flow*.75):.055+state.flow*.34),0,1);if(state.energy<=.005)state.boostLocked=true;
  state.boost=lerp(state.boost,burning?1:0,1-Math.exp(-dt*5));state.steer=lerp(state.steer,input.steer,1-Math.exp(-dt*10));
  const maneuverability=input.brake?1.55:1-state.boost*.22,manualRoll=input.spinning?0:input.roll||0;
  const target=new T.Vector3(-input.pitch*1.08*maneuverability,-state.steer*1.02*maneuverability,manualRoll*2.9);
  state.angularVelocity.lerp(target,1-Math.exp(-dt*12));
  const angularSpeed=state.angularVelocity.length();if(angularSpeed>1e-8)state.orientation.multiply(new T.Quaternion().setFromAxisAngle(state.angularVelocity.clone().divideScalar(angularSpeed),angularSpeed*dt));
  if(spinDelta)state.orientation.multiply(new T.Quaternion().setFromAxisAngle(Z,spinDelta));
  state.rollGrace=(manualRoll||input.spinning) ? .4:Math.max(0,(state.rollGrace||0)-dt);
  if(state.levelAssist===true&&!state.rollGrace){const angle=horizonRoll(state.orientation);if(angle!==null)state.orientation.multiply(new T.Quaternion().setFromAxisAngle(Z,-angle*(1-Math.exp(-dt*2.8))));}
  state.orientation.normalize();
  const forward=updateFrame(state);
  // Small tissue reflex only; the flight frame never auto-banks into yaw.
  state.bank=lerp(state.bank,(manualRoll||input.spinning)?0:state.steer*.38,1-Math.exp(-dt*6));
  // Thrust changes velocity over time. Boost keeps more lateral momentum;
  // braking sheds it quickly, allowing a tighter line around rock.
  const drag=input.brake?5.5:1.5-state.boost*.45,targetSpeed=input.brake?23:68+state.boost*120;
  state.velocity.multiplyScalar(Math.exp(-drag*dt)).addScaledVector(forward,targetSpeed*(1-Math.exp(-drag*dt)));
  const lateral=state.velocity.clone().addScaledVector(forward,-state.velocity.dot(forward)),grip=input.brake?5:2.8-state.boost*1.9;
  state.velocity.addScaledVector(lateral,-(1-Math.exp(-grip*dt)));if(state.velocity.length()>240)state.velocity.setLength(240);
  return movePilot(state,dt,world,radius,false);
}
function updateFrame(state){
  const forward=Z.clone().applyQuaternion(state.orientation);
  state.yaw=Math.atan2(forward.x,forward.z);state.pitch=Math.asin(clamp(forward.y,-1,1));state.rollBank=horizonRoll(state.orientation)??state.rollBank;
  return forward;
}
function movePilot(state,dt,world,radius,locked){
  const before=state.position.clone(),next=before.clone().addScaledVector(state.velocity,dt),hit=world.sweepGround(before,next,radius);state.position.copy(hit.position);
  const obstacle=world.sweepObstacles?world.sweepObstacles(before,state.position,radius):world.obstacleContact?.(state.position,radius);
  state.impactCooldown=Math.max(0,state.impactCooldown-dt);
  if(hit.hit||obstacle){
    const normal=obstacle?obstacle.normal:hit.normal;
    if(obstacle?.position)state.position.copy(obstacle.position);else if(obstacle)state.position.addScaledVector(normal,radius-obstacle.distance+.5);
    const inward=Math.min(0,state.velocity.dot(normal));
    if(locked){
      // Further contacts can bounce during the same loss-of-control period,
      // without restarting its timer or applying another crash penalty.
      state.velocity.addScaledVector(normal,-inward*(1+IMPACT_RESTITUTION));
    }else if(-inward>=HARD_IMPACT_SPEED){
      state.collisions++;state.timeouts++;state.timeout=IMPACT_TIMEOUT;
      state.energy=Math.max(0,state.energy-.18);state.streak=0;state.impact=obstacle?.name||'RIDGE';
      state.velocity.addScaledVector(normal,-inward*(1+IMPACT_RESTITUTION));
      state.boost=0;state.flow=0;state.spinDelta=0;
    }else{
      // Sliding contact removes only motion into the surface. A fast pass
      // along a wall is peaceful when its normal closing speed is small.
      state.velocity.addScaledVector(normal,-inward);state.impact='';
    }
  }else if(!locked)state.impact='';
  state.speed=state.velocity.length();return state;
}
export function stepPilot(state,input,dt,world,radius=3){
  state.orientation??=new T.Quaternion().setFromEuler(new T.Euler(-state.pitch,state.yaw,0,'YXZ'));
  state.velocity??=Z.clone().applyQuaternion(state.orientation).multiplyScalar(state.speed);state.angularVelocity??=new T.Vector3();
  state.timeout??=0;state.timeouts??=0;
  let spin=state.timeout>0?0:state.spinDelta||0;const steps=Math.max(1,Math.ceil(dt*120));
  for(let i=0;i<steps;i++){integrate(state,input,dt/steps,world,radius,spin/steps);if(state.timeout>0)spin=0;}
  state.spinDelta=0;return state;
}
// A double tap adds one fast rotation to the same physical roll axis. It never
// writes positions, restores an old heading, or follows a scripted dodge path.
export class BarrelRoll {
  constructor(){this.active=false;this.elapsed=0;this.cooldown=0;this.direction=1;this.completed=0;this.angle=0;this.delta=0;this.lastTap=-Infinity;this.lastDirection=0;}
  tap(direction,time){const twice=direction===this.lastDirection&&time-this.lastTap<.28;this.lastTap=time;this.lastDirection=direction;if(twice){this.lastTap=-Infinity;return this.trigger(direction);}return false;}
  trigger(direction){if(this.active||this.cooldown>0)return false;this.active=true;this.elapsed=0;this.angle=0;this.direction=Math.sign(direction)||1;return true;}
  update(dt){
    this.cooldown=Math.max(0,this.cooldown-dt);this.delta=0;if(!this.active){this.angle=0;return;}
    const before=this.angle;this.elapsed+=dt;const t=Math.min(1,this.elapsed/.62);this.angle=this.direction*t*t*(3-2*t)*Math.PI*2;this.delta=this.angle-before;
    if(t===1){this.active=false;this.cooldown=.14;this.completed++;this.angle=0;}
  }
  reset(){this.active=false;this.elapsed=0;this.cooldown=0;this.angle=0;this.delta=0;this.lastTap=-Infinity;this.lastDirection=0;}
}
