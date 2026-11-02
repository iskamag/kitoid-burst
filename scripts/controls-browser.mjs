import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:680}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.addInitScript(()=>{window.virtualPad={index:0,connected:false,mapping:'standard',axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};Object.defineProperty(navigator,'getGamepads',{value:()=>[window.virtualPad]});});
const snap=()=>page.evaluate(()=>window.catoid.snapshot()),wait=fn=>page.waitForFunction(fn,null,{timeout:90000});
const frames=async n=>{const f=(await snap()).frame;await page.waitForFunction(t=>window.catoid.snapshot().frame>=t,f+n,{timeout:90000});};
const ready=async()=>{await wait(()=>window.catoid?.snapshot().frame>10);await page.locator('#loading').waitFor({state:'detached'});};
await mkdir('artifacts',{recursive:true});
try{
 await page.goto(process.env.CATOID_URL||'http://localhost:4173');await ready();await page.click('#launch');const initial=await snap();
 await page.mouse.move(400,300);await page.mouse.down();await page.mouse.move(610,350,{steps:6});await page.mouse.up();let s=await snap();assert(s.cameraView.yaw>.8&&s.cameraView.pitch>.1);assert(Math.abs(s.orientation.reduce((a,c,i)=>a+c*initial.orientation[i],0))>.99999,'Camera drag must not steer the creature');
 await page.mouse.wheel(0,450);await wait(()=>window.catoid.snapshot().cameraView.zoom>1.2);await page.keyboard.press('KeyV');assert.deepEqual((await snap()).cameraView,{yaw:0,pitch:0,zoom:1});
 await page.evaluate(()=>{virtualPad.connected=true;virtualPad.axes[2]=.8;});await wait(()=>window.catoid.snapshot().cameraView.yaw>.25);await page.evaluate(()=>virtualPad.axes[2]=0);await page.keyboard.press('KeyV');await page.keyboard.press('KeyR');
 const steering=await snap();await page.evaluate(()=>virtualPad.axes[0]=.8);await frames(8);s=await snap();assert(s.forward.reduce((a,c,i)=>a+c*steering.cameraRight[i],0)>.08,'Left stick must steer to its screen side');await page.evaluate(()=>virtualPad.axes[0]=0);await page.keyboard.press('KeyR');
 await page.evaluate(()=>virtualPad.buttons[7].value=1);await wait(()=>window.catoid.snapshot().speed>95);await page.evaluate(()=>{virtualPad.buttons[7].value=0;virtualPad.buttons[6].value=1;});await wait(()=>window.catoid.snapshot().speed<40);
 await page.keyboard.press('KeyR');await page.evaluate(()=>virtualPad.buttons[5].pressed=true);await wait(()=>window.catoid.snapshot().rollBank>.8);await page.evaluate(()=>virtualPad.buttons[5].pressed=false);
 await page.evaluate(()=>virtualPad.buttons[9].pressed=true);await wait(()=>window.catoid.snapshot().paused);await frames(5);assert((await snap()).paused,'Holding Start must not toggle pause repeatedly');await page.evaluate(()=>virtualPad.buttons[9].pressed=false);await frames(2);await page.evaluate(()=>virtualPad.buttons[9].pressed=true);await wait(()=>!window.catoid.snapshot().paused);
 await page.evaluate(()=>virtualPad.connected=false);await wait(()=>!window.catoid.snapshot().gamepad);
 await page.setViewportSize({width:390,height:844});await page.reload();await ready();await page.click('#launch');const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:130,y:240,id:1},{x:230,y:240,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:110,y:270,id:1},{x:290,y:270,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});s=await snap();assert(s.cameraView.zoom<.9&&s.cameraView.yaw>.05,'Two-finger look and pinch must work on the flight canvas');
 await page.keyboard.press('KeyV');await page.screenshot({path:'artifacts/camera-controls-mobile.png'});assert.deepEqual(errors,[]);const result={passed:true,mouseOrbit:true,wheelZoom:true,reset:true,gamepadLook:true,gamepadSteer:true,triggers:true,bumperRoll:true,pauseEdges:true,disconnect:true,touchLookAndPinch:true,errors};await writeFile('artifacts/controls-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
