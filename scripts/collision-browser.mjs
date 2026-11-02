import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:680}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
// Place controlled fixtures against an actual production arch. Physics,
// keyboard events, collision geometry, countdown and camera remain unchanged.
await page.route('**/src/main.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text())+`
 window.stageContact=(value,spinning=false)=>{
   restart();const expected=routePoint(.075,circuit.region),arch=terrain.arches.reduce((best,a)=>!best||Math.hypot(a.position.x-expected.x,a.position.z-expected.z)<Math.hypot(best.position.x-expected.x,best.position.z-expected.z)?a:best,null),direction=new T.Vector3(0,0,1).applyQuaternion(arch.quaternion);
   let highest=null,clearance=-Infinity;for(const c of terrain.obstacles){if(c.name!=='THE FIRST EYE')continue;const p=c.a.clone().lerp(c.b,.5);if(Math.hypot(p.x-expected.x,p.z-expected.z)>150*circuit.region.scale)continue;const h=p.y-heightAt(p.x,p.z);if(h>clearance){highest=c;clearance=h;}}
   if(!highest)throw new Error('Arch fixture unavailable');const p=highest.a.clone().lerp(highest.b,.5),bodyRadius=clamp(cat.viewRadius*.22,2.5,4);
   cat.root.position.copy(p).addScaledVector(direction,-highest.radius-bodyRadius-2);motionOrientation.setFromUnitVectors(new T.Vector3(0,0,1),direction).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),.65));
   velocity.copy(direction).multiplyScalar(value);speed=value;energy=.7;if(spinning){roll.trigger(1);roll.elapsed=.619;
     // The spin completes before contact within this one slow frame. Its bonus
     // must be withheld even when collision occurs in a later physics substep.
     const delta=clock.getDelta.bind(clock);clock.getDelta=()=>{clock.getDelta=delta;delta();return .05;};
   }angularVelocity.set(0,0,0);orient();setFlightCamera(true);return{radius:highest.radius+bodyRadius,center:p.toArray(),direction:direction.toArray()};
 };
 `});});
const snap=()=>page.evaluate(()=>window.catoid.snapshot());
const frames=async n=>{const f=(await snap()).frame;await page.waitForFunction(t=>window.catoid.snapshot().frame>=t,f+n,{timeout:90000});};
await mkdir('artifacts',{recursive:true});
try{
 await page.goto(process.env.CATOID_URL||'http://localhost:4173');await page.waitForFunction(()=>window.catoid?.snapshot().frame>10,null,{timeout:90000});await page.locator('#loading').waitFor({state:'detached'});await page.click('#launch');
 await page.keyboard.down('Space');const fixture=await page.evaluate(()=>window.stageContact(23));await frames(18);let s=await snap();assert.equal(s.timeout,0);assert.equal(s.timeouts,0);assert.equal(s.collisions,0);assert(s.energy>.68);assert(await page.locator('#timeout').isHidden());
 const along=s.position.reduce((v,c,i)=>v+(c-fixture.center[i])*fixture.direction[i],0);assert(Math.abs(along+fixture.radius)<1,'Slow fixture must reach the real wall');await page.keyboard.up('Space');
 const hardFixture=await page.evaluate(()=>window.stageContact(100,true));await page.waitForFunction(()=>window.catoid.snapshot().timeout>.7,null,{timeout:90000});const rebounding=await snap();assert.equal(rebounding.timeouts,1);assert.equal(rebounding.stuntRolls,0);assert(rebounding.energy<.56&&rebounding.score<100,'Crash-frame spin must not award a trick bonus');assert(await page.locator('#timeout').isVisible());await page.screenshot({path:'artifacts/collision-timeout.png'});
 await page.keyboard.down('KeyW');await page.keyboard.down('KeyE');await page.keyboard.down('ShiftLeft');await frames(4);s=await snap();const moved=s.position.reduce((v,c,i)=>v+(c-rebounding.position[i])*hardFixture.direction[i],0);assert(moved<-.5,'The cat must bounce away while controls are locked');assert(s.speed>0);assert.deepEqual(s.orientation,rebounding.orientation);assert(s.lapTime>rebounding.lapTime&&!s.paused,'The game and race clock continue during the timeout');assert.equal(s.energy,rebounding.energy);assert.equal(s.timeouts,1);assert(s.timeout<rebounding.timeout);
 await page.keyboard.up('KeyW');await page.keyboard.up('KeyE');await page.keyboard.up('ShiftLeft');await page.keyboard.down('KeyA');await page.waitForFunction(()=>window.catoid.snapshot().timeout===0,null,{timeout:90000});await frames(12);await page.keyboard.up('KeyA');s=await snap();assert.equal(s.timeouts,1);assert(s.speed>0);assert(await page.locator('#timeout').isHidden());
 await page.keyboard.press('KeyR');s=await snap();assert.equal(s.timeouts,0);assert.equal(s.timeout,0);assert.deepEqual(errors,[]);const result={passed:true,slowContact:true,hardTimeout:true,controlsLocked:true,reboundMotion:true,worldContinues:true,bankRetained:true,recovery:true,retry:true,errors};await writeFile('artifacts/collision-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
