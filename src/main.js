import * as T from '../vendor/three.module.js';
import { Catoid } from './catoid.js';
import {frameSteps,EmissionClock} from './frame-timing.js';
import { DEFAULT_GENES,GROUPS,DEFINITIONS,spawnGenes,mutateGenes,crossGenes,PRESETS,GENOME_VERSION,validateGenome } from './genes.js';
import { createTerrain,createSky,createCircuit,heightAt,sweepGround } from './terrain.js';
import {GamepadInput} from './gamepad.js';
import { FlightAudio } from './audio.js';
import { flightInput,stepPilot,BarrelRoll,rewardRoll } from './flight.js';
import {routePoint,crossedGate,worldRegion,WORLD_SIZE} from './world.js';
import {SUN_DIRECTION} from './atmosphere.js';
import {SeedAtlas} from './atlas.js';
import {prepareHeightfield,prepareFieldBounds,fieldBoundsReady,heightfieldStats} from './heightfield.js';

const $=id=>document.getElementById(id),canvas=$('world');
const clamp=T.MathUtils.clamp,lerp=T.MathUtils.lerp;
const STORAGE='catoid-genome-v2';
let renderer;
try{renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance',logarithmicDepthBuffer:true});}
catch(error){$('loading').innerHTML='<span>KITOID BURST</span><p>This expanse needs WebGL 2. Please enable hardware acceleration.</p>';throw error;}
renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<=600?1.25:1.6));renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
const scene=new T.Scene();
const camera=new T.PerspectiveCamera(54,innerWidth/innerHeight,.15,25000);
scene.add(new T.HemisphereLight(0xcfe5eb,0x355951,2.1));
const sun=new T.DirectionalLight(0xffd19b,3);sun.position.copy(SUN_DIRECTION).multiplyScalar(500);scene.add(sun);
const rim=new T.DirectionalLight(0x8bcdd3,2.2);rim.position.set(200,100,-300);scene.add(rim);
const reachParam=new URL(location.href).searchParams.get('reach')||'0,0',reachCoordinates=/^-?\d{1,5},-?\d{1,5}$/.test(reachParam)?reachParam.split(',').map(Number):[0,0];
const initialReach=worldRegion(reachCoordinates[0]*WORLD_SIZE,reachCoordinates[1]*WORLD_SIZE),initialLocation=routePoint(0,initialReach);
$('loading').querySelector('p').textContent='Shaping the expanse…';
await prepareHeightfield(initialReach.x,initialReach.z,4000*initialReach.scale);
const terrain=createTerrain(scene,{center:initialLocation,progressive:true,backgroundPrefetch:false}),sky=createSky(scene,{occluded:terrain.occludesSun}),circuit=createCircuit(scene,initialReach),audio=new FlightAudio();
const cat=new Catoid();scene.add(cat.root);
let genes={...DEFAULT_GENES},targetGenes={...genes},seed=617,generation=0,ancestry='FOUNDER',parent=null;
try{
  const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');
  if(saved){genes=validateGenome(saved);targetGenes={...genes};seed=saved.seed;generation=Number.isSafeInteger(saved.generation)?saved.generation:0;ancestry=String(saved.ancestry||'FOUNDER').slice(0,100);}
  // Refresh unedited founders into the broader seed distribution. Edited and
  // bred genomes retain their alleles; explicit imports also retain every allele.
  if(saved&&saved.generatorRevision!==3&&generation===0){
    if(ancestry==='FOUNDER')genes=seed===617?{...DEFAULT_GENES}:spawnGenes(seed);
    else if(PRESETS[ancestry.toLowerCase()])genes={...PRESETS[ancestry.toLowerCase()]};
    targetGenes={...genes};
  }
  const kept=JSON.parse(localStorage.getItem('catoid-parent-v2')||'null');if(kept){validateGenome(kept);parent=kept;}
}catch{}
await cat.rebuildAsync(genes);cat.root.position.copy(initialLocation);$('intro-region').textContent=initialReach.name;
let overlook=0;for(let x=-400;x<=400;x+=100)for(let z=-400;z<=400;z+=100)overlook=Math.max(overlook,heightAt(cat.root.position.x+x,cat.root.position.z+z));
cat.root.position.y=overlook+55;
let growthRequest=false,renderDirty=true,renderFrames=0,prefetchStarted=false;
let mode='intro',lab=false,paused=false,growing=false,elapsed=0,frame=0,lastEdit=0,stage=1,stageHeld=false;
let yaw=Math.PI/2,pitch=0,bank=0,speed=68,boost=0,time=0,steer=0,nextGate=0,gateCount=0,lapTime=0,complete=false;
let best=0,energy=1,boostLocked=false,flow=0,streak=0,score=0,collisions=0,impactCooldown=0,impact='',timeout=0,timeouts=0;
let frameRollRewards=[];
let rollNear=false,stuntRolls=0,rollBank=0,rollGrace=0,levelAssist=false;
const discoveredReaches=new Set([initialReach.key]);let reachKey=initialReach.key;
let orbit=.55,drag=false,dragX=0,dragY=0,orbitHeight=.23,messageUntil=0,weather=1;
const keys=new Set(),touch={x:0,y:0,roll:0,rollLeft:false,rollRight:false,brake:false,boost:false},roll=new BarrelRoll();
const forward=new T.Vector3(),desiredCamera=new T.Vector3(),lookAt=new T.Vector3(),lookSmooth=new T.Vector3(),oldPosition=new T.Vector3();
const chaseQ=new T.Quaternion(),motionOrientation=new T.Quaternion(),velocity=new T.Vector3(),angularVelocity=new T.Vector3(),orientation=new T.Euler(0,0,0,'YXZ');
const controls=new Map(),gamepad=new GamepadInput(),pad={x:0,y:0,roll:0,brake:false,boost:false};
let viewYaw=0,viewPitch=0,viewZoom=1;const cameraPointers=new Map(),viewRotation=new T.Quaternion();
let buffering=false,flightDataRequest=null,pendingReach=null,pendingRestart=false,pendingCourse=0;
const atlas=new SeedAtlas((newSeed,next)=>{seed=newSeed;replaceGenome(next,'FOUNDER',0);});

const trailCount=420,trailPositions=new Float32Array(trailCount*3),trailColors=new Float32Array(trailCount*3),trailAges=new Float32Array(trailCount).fill(10);
const trailGeo=new T.BufferGeometry();trailGeo.setAttribute('position',new T.BufferAttribute(trailPositions,3));trailGeo.setAttribute('color',new T.BufferAttribute(trailColors,3));
const trail=new T.Points(trailGeo,new T.PointsMaterial({size:.19,vertexColors:true,transparent:true,opacity:.6,blending:T.AdditiveBlending,depthWrite:false}));trail.frustumCulled=false;scene.add(trail);let trailIndex=0;const trailEmission=new EmissionClock();

function genome(){return {version:GENOME_VERSION,generatorRevision:3,eyes:9,seed,generation,ancestry,genes:{...targetGenes}};}
function save(){try{localStorage.setItem(STORAGE,JSON.stringify(genome()));}catch{}}
function updateFamily(){
  $('seed-label').textContent='SEED '+String(seed).padStart(4,'0');
  $('lineage').textContent=`GEN ${generation} · ${ancestry}`;
  $('keep-parent').textContent=parent?'PARENT '+parent.seed+' · REPLACE':'KEEP PARENT';$('cross').disabled=!parent;
  const c=cat.counts;$('phenotype-label').textContent=`${c.axes} ${c.axes===1?'axis':'axes'} · ${c.segments} segments · ${c.limbBranches} branches · ${c.bodyEyes} axial eyes / 9`;
}
function updateControls(){for(const [key,{input,output}] of controls){input.value=targetGenes[key];output.value=targetGenes[key].toFixed(2);}updateFamily();}
function queueGrowth(){growing=true;lastEdit=elapsed;cat.cancelBuild();}
function replaceGenome(next,origin,gen=generation+1){targetGenes={...next};ancestry=origin;generation=gen;$('growth-state').textContent='RECOMBINING FIELDS';queueGrowth();updateControls();save();}
for(const [title,rows] of GROUPS){
  const details=document.createElement('details');details.open=title==='Axial patterning';
  const summary=document.createElement('summary');summary.append(title);const count=document.createElement('span');count.textContent=String(rows.length).padStart(2,'0');summary.append(count);details.append(summary);
  for(const [key,label,,description] of rows){
    const el=document.createElement('label');el.className='gene';el.title=description;
    const row=document.createElement('span');row.textContent=label;const output=document.createElement('output');output.htmlFor='gene-'+key;row.append(output);
    const input=document.createElement('input');input.type='range';input.min=0;input.max=1;input.step=.01;input.id='gene-'+key;input.dataset.gene=key;input.setAttribute('aria-label',label);input.title=description;
    input.addEventListener('input',()=>{targetGenes[key]=Number(input.value);output.value=Number(input.value).toFixed(2);ancestry='FIELD EDIT';queueGrowth();});
    input.addEventListener('change',save);el.append(row,input);details.append(el);controls.set(key,{input,output});
  }
  $('gene-controls').append(details);
}
updateControls();
function notify(text,duration=2.3){$('message').textContent=text;messageUntil=elapsed+duration;}
function focusFlight(){canvas.focus({preventScroll:true});}
function orient(){
  chaseQ.copy(motionOrientation);
  cat.root.quaternion.copy(motionOrientation);
}
function startFlight(){
  if(mode==='intro'){mode='flight';$('intro').classList.add('hidden');$('flight-hud').classList.remove('hidden');document.body.classList.add('flying');restart();notify('');}
  if(lab)toggleLab(false);if(paused)togglePause(false);focusFlight();
}
function restart(){
  if(pendingReach){pendingRestart=true;notify('SHAPING '+pendingReach.name);return;}
  buffering=false;nextGate=0;gateCount=0;lapTime=0;complete=false;speed=68;boost=0;bank=0;steer=0;
  energy=1;boostLocked=false;flow=0;streak=0;score=0;collisions=0;impactCooldown=0;impact='';timeout=0;timeouts=0;
  rollNear=false;stuntRolls=0;rollBank=0;rollGrace=0;angularVelocity.set(0,0,0);
  roll.reset();cat.breath.position.set(0,0,0);const spawn=circuit.spawn();
  cat.root.position.copy(spawn.position);yaw=spawn.yaw;pitch=spawn.pitch;
  motionOrientation.setFromEuler(orientation.set(-pitch,yaw,0,'YXZ'));velocity.set(0,0,speed).applyQuaternion(motionOrientation);
  reachKey=circuit.region.key;
  try{best=Number(localStorage.getItem('catoid-line-best-v9-'+reachKey+'-'+circuit.course.id)||0);}catch{best=0;}
  document.body.classList.remove('impact-timeout');$('timeout').classList.add('hidden');
  circuit.activate(0);oldPosition.copy(cat.root.position);trailAges.fill(10);trailEmission.reset();orient();setFlightCamera(true);
  $('route-name').textContent=circuit.course.name+' ↻';$('gate-total').textContent='/ '+String(circuit.count).padStart(2,'0');
  $('gates').textContent='00';
}
function nextCourse(){if(pendingReach){pendingCourse++;pendingRestart=mode==='flight';notify('SHAPING '+pendingReach.name);return;}circuit.load(circuit.index+1,worldRegion(cat.root.position.x,cat.root.position.z));if(mode==='flight'){restart();notify(circuit.course.name,3);}else{$('route-name').textContent=circuit.course.name+' ↻';$('gate-total').textContent='/ '+String(circuit.count).padStart(2,'0');}}
function toggleLab(force){
  lab=typeof force==='boolean'?force:!lab;$('lab').classList.toggle('hidden',!lab);document.body.classList.toggle('lab-open',lab);
  keys.clear();touch.x=touch.y=touch.roll=0;touch.rollLeft=touch.rollRight=touch.brake=touch.boost=false;
  if(lab){orbit=.55;orbitHeight=.23;notify('');cat.breath.position.set(0,0,0);}
  else{save();stageHeld=false;if(mode==='flight'){orient();focusFlight();}}
}
function togglePause(force){renderDirty=true;if(mode!=='flight')return;paused=typeof force==='boolean'?force:!paused;$('help').classList.toggle('hidden',!paused);keys.clear();touch.x=touch.y=touch.roll=0;touch.rollLeft=touch.rollRight=touch.brake=touch.boost=false;if(!paused)focusFlight();}
$('launch').onclick=startFlight;$('help-toggle').onclick=()=>togglePause();$('open-lab').onclick=()=>toggleLab();$('close-lab').onclick=()=>toggleLab(false);$('resume').onclick=()=>togglePause(false);$('route-name').onclick=()=>{nextCourse();focusFlight();};
$('mutate').onclick=()=>{const result=mutateGenes(targetGenes,(Date.now()+seed)>>>0);replaceGenome(result.genes,result.module.toUpperCase());};
$('keep-parent').onclick=()=>{parent=genome();try{localStorage.setItem('catoid-parent-v2',JSON.stringify(parent));}catch{}updateFamily();};
$('cross').onclick=()=>{if(!parent)return;replaceGenome(crossGenes(targetGenes,parent.genes,(Date.now()+seed)>>>0),'CROSS × '+parent.seed,Math.max(generation,parent.generation||0)+1);};
$('new-seed').onclick=()=>{seed=Math.floor(Math.random()*999999);replaceGenome(spawnGenes(seed),'FOUNDER',0);};
$('open-atlas').onclick=()=>atlas.open({seed,genes:{...targetGenes}});
$('bodyplan').onchange=e=>{const name=e.target.value;seed={mantle:617,spindle:2017,corolla:7919}[name];replaceGenome(PRESETS[name],name.toUpperCase(),0);};
$('reset-genes').onclick=()=>{seed=617;$('bodyplan').value='mantle';replaceGenome(DEFAULT_GENES,'FOUNDER',0);};
$('regrow').onclick=()=>{stage=0;stageHeld=false;};
$('development-stage').oninput=e=>{stage=Number(e.target.value);stageHeld=true;};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify(genome(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='kitoid-burst-'+seed+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async event=>{
  try{const file=event.target.files[0];if(!file)return;const data=JSON.parse(await file.text());const next=validateGenome(data);seed=data.seed;replaceGenome(next,'IMPORTED',Math.max(0,Number.isSafeInteger(data.generation)?data.generation:0));}
  catch(e){$('growth-state').textContent='IMPORT FAILED: '+e.message;}
  event.target.value='';
};
function unlockAudio(e){if(e.target instanceof Element&&e.target.closest('#sound'))return;if(audio.enabled&&audio.context?.state!=='running')audio.resume().catch(()=>{});}
addEventListener('pointerdown',unlockAudio,true);addEventListener('keydown',unlockAudio,true);
$('sound').onclick=async()=>{try{const enabled=await audio.toggle();$('sound').setAttribute('aria-pressed',String(enabled));$('sound').querySelector('span').textContent=enabled?'ON':'OFF';}catch{$('sound').querySelector('span').textContent='UNAVAILABLE';}};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();focusFlight();}catch{notify('FULLSCREEN UNAVAILABLE');}};
function cycleWeather(){weather=(weather+1)%3;sky.setDensity([.55,1,1.8][weather]);$('weather').querySelector('span').textContent=['LIGHT','DEPTH','DENSE'][weather];}
$('weather').onclick=cycleWeather;
const flightKeys=new Set(['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ControlLeft','ControlRight','ShiftLeft','ShiftRight','KeyQ','KeyE','KeyZ','KeyC','KeyX','KeyR','KeyN','KeyG','KeyP','KeyH','KeyF','KeyB','KeyV','Escape']);
addEventListener('keydown',e=>{
  if(atlas.visible){if(e.code==='Escape'){e.preventDefault();e.stopImmediatePropagation();atlas.close();}return;}
  const editing=e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement;
  if(editing&&!['KeyG','Escape'].includes(e.code))return;
  if(e.metaKey||e.altKey)return;
  if(mode==='flight'&&!lab&&flightKeys.has(e.code)){e.preventDefault();e.stopImmediatePropagation();}
  if(e.repeat)return;
  if(e.code==='KeyG')toggleLab();
  else if(e.code==='Escape'){if(lab)toggleLab(false);else togglePause();}
  else if(e.code==='KeyP'||e.code==='KeyH')togglePause();
  else if(e.code==='KeyF')cycleWeather();
  else if(e.code==='KeyV'){viewYaw=viewPitch=0;viewZoom=1;}
  else if(e.code==='KeyB'&&mode==='flight'&&!lab){levelAssist=!levelAssist;notify('HORIZON ASSIST '+(levelAssist?'ON':'OFF'));}
  else if(e.code==='KeyN'&&!lab){nextCourse();}
  else if(e.code==='KeyR'&&mode==='flight'&&!lab){restart();if(!pendingReach)notify('CIRCUIT RESET');}
  else if(e.code==='Enter'&&mode==='intro'&&!lab)startFlight();
  else if(mode==='flight'&&!lab&&!paused){
    if(!timeout&&['KeyQ','KeyZ','KeyE','KeyC'].includes(e.code))roll.tap(['KeyQ','KeyZ'].includes(e.code)?-1:1,e.timeStamp/1000);
    keys.add(e.code);
  }
},true);
addEventListener('keyup',e=>{keys.delete(e.code);if(mode==='flight'&&!lab&&flightKeys.has(e.code)){e.preventDefault();e.stopImmediatePropagation();}},true);
addEventListener('blur',()=>{keys.clear();touch.x=touch.y=touch.roll=0;touch.rollLeft=touch.rollRight=touch.brake=touch.boost=false;if(mode==='flight'&&!lab)togglePause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&mode==='flight')togglePause(true);});
function cameraGesture(){const points=[...cameraPointers.values()];if(points.length<2)return null;return{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,d:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)};}
function lookCamera(dx,dy){viewYaw=(viewYaw+dx*.006)%(Math.PI*2);viewPitch=clamp(viewPitch+dy*.006,-1.25,1.25);}
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('dblclick',()=>{if(mode==='flight'&&!lab&&!paused){viewYaw=viewPitch=0;viewZoom=1;}});
canvas.addEventListener('pointerdown',e=>{
  canvas.setPointerCapture(e.pointerId);cameraPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(lab){drag=true;dragX=e.clientX;dragY=e.clientY;}else if(mode==='flight')focusFlight();
});
canvas.addEventListener('pointermove',e=>{
  const old=cameraPointers.get(e.pointerId);if(!old)return;
  const before=cameraGesture();cameraPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(lab){orbit+=(e.clientX-old.x)*.008;orbitHeight=clamp(orbitHeight+(e.clientY-old.y)*.005,-.3,.85);}
  else if(mode==='flight'&&!paused){
    if(e.pointerType==='touch'){const after=cameraGesture();if(before&&after){lookCamera(after.x-before.x,after.y-before.y);if(after.d>1&&before.d>1)viewZoom=clamp(viewZoom*before.d/after.d,.65,3);}}
    else lookCamera(e.clientX-old.x,e.clientY-old.y);
  }
});
function endCameraPointer(e){cameraPointers.delete(e.pointerId);drag=cameraPointers.size>0;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}
canvas.addEventListener('pointerup',endCameraPointer);canvas.addEventListener('pointercancel',endCameraPointer);canvas.addEventListener('lostpointercapture',e=>{cameraPointers.delete(e.pointerId);drag=cameraPointers.size>0;});
canvas.addEventListener('wheel',e=>{if((mode==='flight'&&!paused)||lab){e.preventDefault();viewZoom=clamp(viewZoom*Math.exp(e.deltaY*(e.deltaMode===1?.025:.001)),.65,3);}},{passive:false});
addEventListener('blur',()=>{cameraPointers.clear();drag=false;});
const stick=$('touch-stick');
function moveStick(e){const box=stick.getBoundingClientRect();touch.x=clamp((e.clientX-box.x-box.width/2)/40,-1,1);touch.y=clamp((e.clientY-box.y-box.height/2)/40,-1,1);stick.firstElementChild.style.transform=`translate(${touch.x*28}px,${touch.y*28}px)`;}
stick.onpointerdown=e=>{stick.setPointerCapture(e.pointerId);moveStick(e);};stick.onpointermove=e=>{if(stick.hasPointerCapture(e.pointerId))moveStick(e);};stick.onpointerup=stick.onpointercancel=()=>{touch.x=touch.y=0;stick.firstElementChild.style.transform='';};
for(const [id,key] of [['touch-brake','brake'],['touch-boost','boost']]){const el=$(id);el.onpointerdown=e=>{el.setPointerCapture(e.pointerId);touch[key]=1;};el.onpointerup=el.onpointercancel=()=>touch[key]=0;}
for(const[id,side,direction]of[['touch-roll-left','rollLeft',-1],['touch-roll-right','rollRight',1]]){
  const button=$(id);button.onpointerdown=e=>{button.setPointerCapture(e.pointerId);touch[side]=true;touch.roll=Number(touch.rollRight)-Number(touch.rollLeft);if(!timeout)roll.tap(direction,e.timeStamp/1000);};
  button.onpointerup=button.onpointercancel=()=>{touch[side]=false;touch.roll=Number(touch.rollRight)-Number(touch.rollLeft);};
}
for(const type of ['pointerdown','keydown','input','change'])addEventListener(type,()=>{renderDirty=true;},{capture:true});
addEventListener('resize',()=>{renderDirty=true;camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

function pollGamepad(dt){
  let input=null;try{input=gamepad.sample(document.hasFocus()&&!document.hidden?navigator.getGamepads?.():[]);}catch{}
  Object.assign(pad,input?{x:input.x,y:input.y,roll:input.roll,brake:input.brake,boost:input.boost}:{x:0,y:0,roll:0,brake:false,boost:false});
  if(!input||atlas.visible)return;
  const pressed=input.pressed;
  if(mode==='intro'){if(pressed.has(3))toggleLab();if(pressed.has(0)){audio.resume().catch(()=>{});startFlight();}return;}
  if(pressed.has(9)){audio.resume().catch(()=>{});togglePause();}
  if(pressed.has(3))toggleLab();
  if(lab||paused)return;
  if(pressed.has(2))restart();if(pressed.has(15))nextCourse();
  if(pressed.has(8)||pressed.has(11)||pressed.has(14)){viewYaw=viewPitch=0;viewZoom=1;}
  if(!timeout){if(pressed.has(4))roll.tap(-1,performance.now()/1000);if(pressed.has(5))roll.tap(1,performance.now()/1000);}
  lookCamera(input.lookX*dt*260,input.lookY*dt*260);viewZoom=clamp(viewZoom*Math.exp(input.zoom*dt),.65,3);
}
function setFlightCamera(snap=false,dt=.016){
  const pos=cat.root.position,distance=Math.max(20,cat.viewRadius*2.9)*viewZoom;
  viewRotation.setFromEuler(new T.Euler(viewPitch,viewYaw,0,'YXZ'));
  // The chase view follows the physical roll frame, so local steering stays
  // aligned with the screen through banks, inverted flight, and complete loops.
  desiredCamera.set(0,5.5,-distance-boost*3).applyQuaternion(viewRotation).applyQuaternion(chaseQ).add(pos);
  const anchor=pos.clone().add(new T.Vector3(0,4,0));
  desiredCamera.copy(sweepGround(anchor,desiredCamera,1.5).position);
  lookAt.set(0,1.2,25).applyQuaternion(viewRotation).applyQuaternion(chaseQ).add(pos);
  if(snap){camera.position.copy(desiredCamera);lookSmooth.copy(lookAt);}else{camera.position.lerp(desiredCamera,1-Math.exp(-dt*6));lookSmooth.lerp(lookAt,1-Math.exp(-dt*8));}
  camera.position.copy(sweepGround(anchor,camera.position,1.5).position);
  camera.up.set(0,1,0).applyQuaternion(viewRotation).applyQuaternion(chaseQ);camera.lookAt(lookSmooth);camera.fov=lerp(camera.fov,61+boost*12,1-Math.exp(-dt*3));camera.updateProjectionMatrix();
}
function displayCamera(dt){
  const center=cat.root.position.clone().add(cat.center),radius=cat.viewRadius;
  cat.root.quaternion.identity();cat.breath.position.set(0,0,0);
  if(lab){
    if(!drag)orbit+=dt*.06;
    const distance=radius*(innerWidth<600?3.8:3.25)*viewZoom;
    desiredCamera.set(Math.sin(orbit)*distance,5+orbitHeight*10,Math.cos(orbit)*distance).add(center);
    lookAt.copy(center);
    if(innerWidth<600)lookAt.y-=radius*.87;
    else{const right=new T.Vector3().crossVectors(lookAt.clone().sub(desiredCamera).normalize(),new T.Vector3(0,1,0));lookAt.addScaledVector(right,radius*.55);}
  }else{
    const distance=radius*(innerWidth<600?4.3:3.4);
    desiredCamera.set(distance*.52,radius*.6,distance*.86).add(center);lookAt.copy(center);
    if(innerWidth<600)lookAt.y+=radius*.6;
    else{const right=new T.Vector3().crossVectors(lookAt.clone().sub(desiredCamera).normalize(),new T.Vector3(0,1,0));lookAt.addScaledVector(right,-radius*.82);lookAt.y-=radius*.2;}
  }
  camera.position.lerp(desiredCamera,1-Math.exp(-dt*3));lookSmooth.lerp(lookAt,1-Math.exp(-dt*3));camera.up.set(0,1,0);camera.lookAt(lookSmooth);
  camera.fov=lerp(camera.fov,lab?47:50,1-Math.exp(-dt*3));camera.updateProjectionMatrix();
}
function checkGate(before,after,index){
  return crossedGate(before,after,circuit.gates[index]);
}
function enterReach(reach){
  pendingReach=reach;pendingRestart=false;pendingCourse=circuit.index;
  const margin=4000*reach.scale,bounds=[reach.x-margin,reach.z-margin,reach.x+margin,reach.z+margin];
  const finish=()=>{
    if(pendingReach?.key!==reach.key)return;
    const retry=pendingRestart;pendingReach=null;pendingRestart=false;circuit.load(pendingCourse,reach);
    nextGate=0;gateCount=0;lapTime=0;complete=false;circuit.activate(0);best=0;
    $('route-name').textContent=circuit.course.name+' ↻';$('gates').textContent='00';$('gate-total').textContent='/ '+String(circuit.count).padStart(2,'0');
    if(retry)restart();
  };
  const prepare=()=>{if(pendingReach?.key!==reach.key)return;if(fieldBoundsReady(...bounds))finish();else prepareFieldBounds(...bounds).then(finish).catch(error=>{console.error('Reach preparation failed',error);setTimeout(prepare,1000);});};
  prepare();
}
function flight(dt,updateView=true,viewDt=dt){
  const p=cat.root.position,margin=Math.max(180,cat.viewRadius*3.2*viewZoom+20),bounds=[p.x-margin,p.z-margin,p.x+margin,p.z+margin];
  if(!fieldBoundsReady(...bounds)){
    buffering=true;$('flight-state').textContent='SHAPING AHEAD';
    if(!flightDataRequest)flightDataRequest=prepareFieldBounds(...bounds).catch(error=>console.error('Terrain preparation failed',error)).finally(()=>flightDataRequest=null);
    return;
  }
  buffering=false;
  const input=flightInput(keys,{x:clamp(touch.x+pad.x,-1,1),y:clamp(touch.y+pad.y,-1,1),roll:clamp(touch.roll+pad.roll,-1,1),brake:touch.brake||pad.brake,boost:touch.boost||pad.boost});oldPosition.copy(cat.root.position);
  const wasRolling=roll.active,completedBefore=roll.completed,collisionsBefore=collisions;
  if(wasRolling&&roll.elapsed===0)rollNear=false;
  if(timeout)roll.reset();else roll.update(dt);input.spinning=wasRolling||roll.active;
  const state={position:cat.root.position,orientation:motionOrientation,velocity,angularVelocity,yaw,pitch,bank,rollBank,rollGrace,levelAssist,steer,speed,boost,energy,boostLocked,flow,streak,score,collisions,impactCooldown,impact,timeout,timeouts,spinDelta:roll.delta};
  stepPilot(state,input,dt,{heightAt,sweepGround,obstacleContact:terrain.obstacleContact,sweepObstacles:terrain.sweepObstacles,proximity:terrain.proximity},clamp(cat.viewRadius*.22,2.5,4));
  ({yaw,pitch,bank,rollBank,rollGrace,steer,speed,boost,energy,boostLocked,flow,streak,score,collisions,impactCooldown,impact,timeout,timeouts}=state);
  document.body.classList.toggle('impact-timeout',timeout>0);
  $('timeout').classList.toggle('hidden',!timeout);
  if(timeout){$('timeout-count').textContent=timeout.toFixed(1);$('timeout-surface').textContent=impact;}
  const crashed=collisions>collisionsBefore;
  if(crashed){roll.reset();rollNear=false;}
  orient();cat.breath.position.set(0,0,0);
  forward.set(0,0,1).applyQuaternion(motionOrientation);
  const clearance=cat.root.position.y-heightAt(cat.root.position.x,cat.root.position.z);
  const reach=worldRegion(cat.root.position.x,cat.root.position.z);
  if(reach.key!==reachKey){
    reachKey=reach.key;const fresh=!discoveredReaches.has(reach.key);discoveredReaches.add(reach.key);enterReach(reach);
    const address=new URL(location.href);address.searchParams.set('reach',reach.cx+','+reach.cz);history.replaceState(null,'',address);
    notify((fresh?'DISCOVERED · ':'ENTERED · ')+reach.name+' · N TO START ITS LINE',4);
  }
  if(!timeout&&!crashed&&wasRolling&&Math.min(clearance,terrain.proximity(cat.root.position))<50)rollNear=true;
  if(!timeout&&!crashed&&roll.completed>completedBefore&&rollNear){frameRollRewards.push({close:true});rollNear=false;}
  lapTime+=(complete||pendingReach)?0:dt;
  if(!pendingReach&&!timeout&&!crashed&&!complete&&checkGate(oldPosition,cat.root.position,nextGate)){
    gateCount++;nextGate=(nextGate+1)%circuit.count;energy=Math.min(1,energy+.13);if(wasRolling)frameRollRewards.push({gate:true});audio.chime();terrain.pulse(cat.root.position,time);$('gates').textContent=String(gateCount).padStart(2,'0');
    if(gateCount===circuit.count){
      complete=true;circuit.activate(-1);const pb=!best||lapTime<best;
      if(pb){best=lapTime;try{localStorage.setItem('catoid-line-best-v9-'+reachKey+'-'+circuit.course.id,String(best));}catch{}}
      notify((pb?'PERSONAL BEST':'LINE COMPLETE')+' · '+formatTime(lapTime),7);
    }else{circuit.activate(nextGate);notify('',1.4);}
  }
  if(!updateView)return;
  const delta=circuit.gates[nextGate].position.clone().sub(cat.root.position),distance=delta.length();
  const right=new T.Vector3().crossVectors(forward,new T.Vector3(0,1,0)).normalize(),bearing=Math.atan2(delta.dot(right),delta.dot(forward));
  $('bearing-arrow').style.transform=`rotate(${bearing}rad)`;$('bearing-label').textContent=pendingReach?'EXPLORING · SHAPING THIS REACH':complete?'EXPLORE · N FOR ANOTHER LINE':Math.abs(bearing)>1.65?'GATE BEHIND · '+Math.round(distance)+' m':'GATE '+String(nextGate+1).padStart(2,'0')+' · '+Math.round(distance)+' m';
  setFlightCamera(false,viewDt);
  if(frame%3===0){
    $('speed').textContent=Math.round(speed);$('altitude').textContent=Math.max(0,Math.round(clearance));
    $('flight-state').textContent=timeout?'':roll.active?'SPIN '+(roll.direction<0?'LEFT':'RIGHT'):input.roll?'ROLL '+(input.roll<0?'LEFT':'RIGHT'):input.brake?'AIRBRAKE':boostLocked?'RECHARGING':boost>.3?'BURST':'';
    $('timer').textContent=formatTime(lapTime);
    $('energy-meter').style.width=(energy*100)+'%';$('energy-meter').parentElement.setAttribute('aria-valuenow',String(Math.round(energy*100)));
    $('flow-label').textContent=flow>.05&&streak>.5?'FLOW ×'+(1+Math.min(streak*.22,4)).toFixed(1):'';$('flow-score').textContent='Score '+Math.floor(score);
  }
}
function formatTime(seconds){return String(Math.floor(seconds/60)).padStart(2,'0')+':'+(seconds%60).toFixed(2).padStart(5,'0');}
function updateTrail(dt,active){
  if(!dt)return;
  for(let i=0;i<trailCount;i++)trailAges[i]+=dt;
  if(active){
    const count=trailEmission.take(dt,boost>.3?180:60),offset=new T.Vector3();
    for(let k=0;k<count;k++){
      const index=trailIndex++%trailCount,t=(k+.5)/count;
      offset.set((Math.random()-.5)*.7,-.2,-cat.length*.4).add(cat.breath.position).applyQuaternion(cat.root.quaternion).addScaledVector(oldPosition,1-t).addScaledVector(cat.root.position,t);
      trailPositions.set(offset.toArray(),index*3);trailAges[index]=dt*(1-t);
    }
  }
  for(let i=0;i<trailCount;i++){const fade=Math.max(0,1-trailAges[i]/(boost>.3?2.1:1.1));trailColors[i*3]=fade*.65;trailColors[i*3+1]=fade;trailColors[i*3+2]=fade*.5;}
  if(active)trailGeo.attributes.position.needsUpdate=true;trailGeo.attributes.color.needsUpdate=true;
}

camera.position.copy(cat.root.position).add(new T.Vector3(18,7,29));lookSmooth.copy(cat.root.position).add(new T.Vector3(-6,0,3));camera.lookAt(lookSmooth);
const clock=new T.Clock();
function animate(){
  requestAnimationFrame(animate);const timing=frameSteps(clock.getDelta()),dt=timing.duration;elapsed+=dt;frame++;pollGamepad(dt);
  const active=mode==='flight'&&!lab&&!paused&&!atlas.visible;if(!paused&&!atlas.visible)time+=dt;
  if(growing&&!growthRequest&&elapsed-lastEdit>.13){
    const next={...targetGenes};growthRequest=true;
    cat.rebuildAsync(next).then(applied=>{if(!applied)return;genes=next;growing=false;stage=0;stageHeld=false;renderDirty=true;updateFamily();save();}).catch(error=>{growing=false;$('growth-state').textContent='GROWTH FAILED: '+error.message;console.error(error);}).finally(()=>{growthRequest=false;});
  }
  if(stage<1&&!stageHeld&&!paused&&!atlas.visible)stage=Math.min(1,stage+dt*(.2+genes.growthRate*.3));
  if(lab){
    $('development-stage').value=stage;$('development-percent').textContent=Math.round(stage*100)+'%';
    $('development-label').textContent=stage<.25?'AXIAL GROWTH':stage<.56?'BRANCH INDUCTION':stage<.88?'SENSORY DIFFERENTIATION':'MATURE';
    if(!$('growth-state').textContent.startsWith('IMPORT FAILED'))$('growth-state').textContent=growing?'Updating…':'';
  }
  if(frame>=4&&!prefetchStarted){prefetchStarted=true;terrain.startPrefetch();}
  if(atlas.visible){audio.update(speed,boost,false);return;}
  if(active){
    const collisionsBeforeFrame=collisions;frameRollRewards=[];
    for(let i=0;i<timing.count;i++){flight(timing.dt,i===timing.count-1,dt);updateTrail(timing.dt,!buffering);}
    // A later substep may hit rock after a spin completes. Commit trick rewards
    // only once the entire rendered frame has survived collision processing.
    if(collisions===collisionsBeforeFrame&&!timeout)for(const trick of frameRollRewards){
      if(trick.close)stuntRolls++;const reward={energy,score,streak};rewardRoll(reward,trick);({energy,score,streak}=reward);
      if(!complete)notify(trick.gate?'ROLL GATE +500 · BURST RESTORED':'CLOSE ROLL +350 · BURST RESTORED',2);
    }
  }else if(!paused){displayCamera(dt);updateTrail(dt,false);}
  cat.animate(time,active?speed:0,active?bank:0,active?Math.max(boost,roll.active?.75:0):0,stage);
  const before=terrain.stats();sky.update(time,camera.position,dt,camera);terrain.update(time,camera.position);const after=terrain.stats();
  circuit.update(time);audio.update(speed,boost,active);
  if(elapsed>messageUntil)$('message').textContent='';
  if(!paused||renderDirty||before.pending||before.transitions||before.revision!==after.revision||!sky.settled()){renderer.render(scene,camera);renderFrames++;renderDirty=false;}
  if(frame===2){$('loading').style.opacity=0;setTimeout(()=>$('loading').remove(),220);}
}
animate();
window.kitoid=window.catoid={
  snapshot:()=>({renderFrames,cameraView:{yaw:viewYaw,pitch:viewPitch,zoom:viewZoom},gamepad:gamepad.id!==null,mode,lab,paused,buffering,pendingReach:pendingReach?.key||null,eyes:cat.eyeGroups.length,geneCount:DEFINITIONS.length,genes:{...genes},targetGenes:{...targetGenes},phenotype:{...cat.counts},position:cat.root.position.toArray(),cameraPosition:camera.position.toArray(),cameraRight:new T.Vector3(1,0,0).applyQuaternion(camera.quaternion).toArray(),craftUp:new T.Vector3(0,1,0).applyQuaternion(cat.root.quaternion).toArray(),forward:[Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),Math.cos(yaw)*Math.cos(pitch)],yaw,bank,rollBank,levelAssist,orientation:motionOrientation.toArray(),velocity:velocity.toArray(),angularVelocity:angularVelocity.toArray(),speed,nextGate,gateCount,lapTime,complete,growing,stage,stageHeld,roll:{active:roll.active,angle:roll.angle,completed:roll.completed,direction:roll.direction},stuntRolls,reach:{key:reachKey,name:worldRegion(cat.root.position.x,cat.root.position.z).name,discovered:discoveredReaches.size},terrain:terrain.stats(),heightfield:heightfieldStats(),airDensity:sky.density(),lensFlare:sky.flareState(),energy,flow,streak,score,collisions,timeout,timeouts,pitch,clearance:cat.root.position.y-heightAt(cat.root.position.x,cat.root.position.z),course:circuit.course.id,gateTotal:circuit.count,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,frame,seed,generation,ancestry}),heightAt,
};
