import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.env.CATOID_URL||'http://localhost:4173',errors=[],results=[];
await mkdir('artifacts',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:960,height:680}});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/src/main.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text())+`
 window.stageFrontier=x=>{startFlight();cat.root.position.set(x,heightAt(x,0)+200,0);motionOrientation.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(-1,0,0));velocity.set(-180,0,0);speed=180;orient();setFlightCamera(true);};
 `});});
 let release;const gate=new Promise(resolve=>release=resolve);let blocked=0;
 await page.route('**/assets/terrain/**/*.bin',async route=>{const name=new URL(route.request().url()).pathname.split('/').pop();if(!['-1_-1.bin','-1_0.bin','0_-1.bin','0_0.bin'].includes(name)){blocked++;await gate;}await route.continue();});
 const start=Date.now();await page.goto(base);await page.waitForFunction(()=>window.catoid?.snapshot().frame>=5,null,{timeout:90000});await page.locator('#loading').waitFor({state:'detached'});
 let s=await page.evaluate(()=>window.catoid.snapshot());assert.equal(s.heightfield.synchronousGenerations,0);assert.equal(s.heightfield.patches,4);assert(s.terrain.tiles>=9&&s.terrain.pending>0);assert(blocked>0,'Outer patches must still be pending when the loading screen ends');
 results.push({case:'outer data delayed',readyMs:Date.now()-start,terrain:s.terrain,heightfield:s.heightfield});
 await page.evaluate(()=>window.stageFrontier(-3610));await page.waitForFunction(()=>window.catoid.snapshot().pendingReach==='-1:0',null,{timeout:90000});s=await page.evaluate(()=>window.catoid.snapshot());assert.equal(s.heightfield.synchronousGenerations,0,'Reach entry must wait for its course data');
 await page.evaluate(()=>window.stageFrontier(-5000));await page.waitForFunction(()=>window.catoid.snapshot().buffering,null,{timeout:90000});const stopped=await page.evaluate(()=>window.catoid.snapshot());await page.waitForTimeout(150);s=await page.evaluate(()=>window.catoid.snapshot());assert.deepEqual(s.position,stopped.position);assert.equal(s.heightfield.synchronousGenerations,0);results.push({case:'unloaded frontier held safely',heightfield:s.heightfield});
 await page.keyboard.press('KeyR');await page.keyboard.press('KeyN');release();await page.waitForFunction(()=>!window.catoid.snapshot().pendingReach,null,{timeout:90000});

 await page.waitForFunction(()=>window.catoid.snapshot().terrain.pending===0,null,{timeout:90000});s=await page.evaluate(()=>window.catoid.snapshot());assert.equal(s.terrain.tiles,845);assert.equal(s.heightfield.synchronousGenerations,0);await page.screenshot({path:'artifacts/startup-complete.png'});
 await page.unroute('**/assets/terrain/**/*.bin');const remoteStart=Date.now();await page.goto(base+'/?reach=1,2');await page.waitForFunction(()=>window.catoid?.snapshot().frame>=10,null,{timeout:120000});await page.locator('#loading').waitFor({state:'detached'});s=await page.evaluate(()=>window.catoid.snapshot());assert.equal(s.reach.key,'1:2');assert.equal(s.heightfield.synchronousGenerations,0,'Peripheral landmarks must not trigger synchronous erosion');results.push({case:'unbaked reach',readyMs:Date.now()-remoteStart,terrain:s.terrain,heightfield:s.heightfield});
 await page.waitForFunction(()=>window.catoid.snapshot().terrain.pending===0,null,{timeout:120000});s=await page.evaluate(()=>window.catoid.snapshot());assert.equal(s.heightfield.synchronousGenerations,0);assert.equal(s.terrain.tiles,845);
 assert.deepEqual(errors,[]);await writeFile('artifacts/startup-browser.json',JSON.stringify({passed:true,results,errors},null,2));console.log(JSON.stringify({passed:true,results,errors},null,2));
}finally{await browser.close();}
