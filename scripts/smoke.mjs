import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {GROUPS,DEFAULT_GENES} from '../src/genes.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--enable-webgl','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],requests=[],url=process.env.CATOID_URL||'http://localhost:4173';
const context=await browser.newContext({viewport:{width:960,height:680},deviceScaleFactor:1,acceptDownloads:true});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('request',r=>requests.push(r.url()));
const snap=()=>page.evaluate(()=>window.catoid.snapshot());
const wait=async fn=>{await page.waitForFunction(fn,null,{timeout:90000});assert.deepEqual(errors,[],'Browser and shader errors');};
// Scrubbing is also a user-facing feature. Use it for adult fixtures, while the
// separate Regrow check below waits for a complete real-time developmental pass.
const mature=async()=>{await wait(()=>!window.catoid.snapshot().growing);await page.locator('#development-stage').fill('1');await page.locator('#development-stage').dispatchEvent('input');await wait(()=>window.catoid.snapshot().stage===1);};
async function frames(n){const before=(await snap()).frame;await page.waitForFunction(goal=>window.catoid.snapshot().frame>=goal,before+n,{timeout:90000});}
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
await mkdir('artifacts',{recursive:true});
try{
  await page.goto(url);await wait(()=>window.catoid?.snapshot().frame>6);await page.locator('#loading').waitFor({state:'detached'});
  let s=await snap();assert.equal(s.eyes,9);assert.equal(s.geneCount,67);assert.equal(await page.locator('input[data-gene]').count(),67);
  await page.screenshot({path:'artifacts/intro.png'});await page.click('#open-lab');await frames(20);
  const slider=page.locator('#gene-axialGrowth');await slider.fill('0.91');await slider.dispatchEvent('change');await mature();
  assert.equal((await snap()).genes.axialGrowth,.91);assert.equal((await snap()).eyes,9);
  await page.click('#regrow');await wait(()=>window.catoid.snapshot().stage<.5);await page.screenshot({path:'artifacts/embryo.png'});await wait(()=>window.catoid.snapshot().stage===1);
  const downloadPromise=page.waitForEvent('download');await page.click('#export');const download=await downloadPromise;await download.saveAs('artifacts/exported-genome.json');
  const exported=JSON.parse(await readFile('artifacts/exported-genome.json','utf8'));assert.equal(exported.version,2);assert.equal(Object.keys(exported.genes).length,67);
  await page.locator('#import').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...exported,eyes:8}))});
  await wait(()=>document.getElementById('growth-state').textContent.startsWith('IMPORT FAILED'));assert.equal((await snap()).genes.axialGrowth,.91);
  await page.locator('#import').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await mature();assert(!(await page.locator('#growth-state').textContent()).startsWith('IMPORT FAILED'));
  await page.reload();await wait(()=>window.catoid?.snapshot().frame>5);await page.locator('#loading').waitFor({state:'detached'});assert.equal((await snap()).genes.axialGrowth,.91);
  await page.click('#open-lab');await page.click('#reset-genes');await mature();
  const mantle=await snap();await page.click('#keep-parent');assert.equal(await page.locator('#cross').isEnabled(),true);
  await page.selectOption('#bodyplan','spindle');await mature();const spindle=await snap();assert.equal(spindle.phenotype.axes,3);
  await page.screenshot({path:'artifacts/spindle.png'});
  await page.selectOption('#bodyplan','corolla');await mature();const corolla=await snap();assert.equal(corolla.phenotype.axes,5);
  await page.screenshot({path:'artifacts/corolla.png'});await page.click('#cross');await mature();const crossed=await snap();
  for(const [,rows] of GROUPS)assert(rows.every(([k])=>crossed.genes[k]===mantle.genes[k])||rows.every(([k])=>crossed.genes[k]===corolla.genes[k]));
  assert.equal(crossed.generation,1);assert.equal(crossed.eyes,9);
  await page.click('#mutate');await mature();assert.equal((await snap()).generation,2);
  await page.click('#reset-genes');await mature();assert.equal((await snap()).genes.axialGrowth,DEFAULT_GENES.axialGrowth);
  await page.click('#open-atlas');await wait(()=>document.querySelectorAll('.specimen-card:not(:disabled)').length===8);
  await page.screenshot({path:'artifacts/seed-atlas.png'});
  const masks=await page.locator('.specimen-card img').evaluateAll(async images=>{
    await Promise.all(images.map(image=>image.decode()));
    return images.map(image=>{const c=document.createElement('canvas');c.width=64;c.height=52;const context=c.getContext('2d');context.drawImage(image,0,0,64,52);const rgba=context.getImageData(0,0,64,52).data;return Array.from({length:64*52},(_,i)=>rgba[i*4+3]>48?1:0);});
  });
  const overlaps=[];
  for(let i=0;i<masks.length;i++)for(let j=0;j<i;j++){let intersection=0,union=0;for(let k=0;k<masks[i].length;k++){intersection+=masks[i][k]&&masks[j][k];union+=masks[i][k]||masks[j][k];}overlaps.push(intersection/Math.max(1,union));}
  const meanSilhouetteOverlap=overlaps.reduce((a,b)=>a+b,0)/overlaps.length;
  assert(meanSilhouetteOverlap<.65,'Seed differences must change silhouettes, not just colors');
  const chosen=Number(await page.locator('.specimen-card').nth(3).getAttribute('data-seed'));await page.locator('.specimen-card').nth(3).click();await mature();assert.equal((await snap()).seed,chosen);assert.equal((await snap()).eyes,9);
  await page.click('#open-atlas');await page.click('#more-seeds');await page.click('#more-seeds');await wait(()=>document.querySelectorAll('.specimen-card:not(:disabled)').length===8);
  await page.keyboard.press('Escape');assert(await page.locator('#atlas').isHidden());assert.equal((await snap()).lab,true);
  await page.click('#reset-genes');await mature();
  await page.screenshot({path:'artifacts/genome.png'});console.log('Growth, topology, inheritance, and persistence passed.');
  // G must still work after editing a focused range input.
  await page.locator('#gene-axialGrowth').focus();await page.keyboard.press('KeyG');assert.equal((await snap()).lab,false);
  await page.click('#weather');await wait(()=>window.catoid.snapshot().airDensity>1.7);await page.click('#weather');await wait(()=>window.catoid.snapshot().airDensity<.6);await page.screenshot({path:'artifacts/light-fog.png'});
  await page.click('#weather');await wait(()=>window.catoid.snapshot().airDensity>.95);await page.screenshot({path:'artifacts/depth-fog.png'});
  await page.click('#launch');await page.keyboard.down('ShiftLeft');await wait(()=>window.catoid.snapshot().speed>130);await page.keyboard.up('ShiftLeft');
  await wait(()=>window.catoid.snapshot().gateCount===1);assert.equal((await snap()).nextGate,1);await page.screenshot({path:'artifacts/flight.png'});
  await page.keyboard.down('Space');await wait(()=>window.catoid.snapshot().speed<30);await page.keyboard.up('Space');
  for(const [key,sign] of [['KeyA',-1],['ArrowLeft',-1],['KeyD',1],['ArrowRight',1]]){
    await page.keyboard.press('KeyR');const before=await snap();await page.keyboard.down(key);await frames(14);await page.keyboard.up(key);const after=await snap();
    assert(sign*dot(after.forward,before.cameraRight)>.06,`${key} must steer to its screen side`);
    assert(sign*dot(after.position.map((v,i)=>v-before.position[i]),before.cameraRight)>.1,`${key} motion must agree with steering`);
  }
  await page.keyboard.press('KeyR');
  const capture=await page.evaluate(()=>{
    window.shortcutLeaks=0;document.addEventListener('keydown',e=>{if(e.code==='KeyQ')window.shortcutLeaks++;});
    const event=new KeyboardEvent('keydown',{key:'q',code:'KeyQ',bubbles:true,cancelable:true});return {cancelled:!document.getElementById('world').dispatchEvent(event),leaks:window.shortcutLeaks};
  });assert.equal(capture.cancelled,true);assert.equal(capture.leaks,0);await page.keyboard.up('KeyQ');
  await page.keyboard.press('KeyR');assert.equal((await snap()).levelAssist,false);await page.keyboard.down('Space');
  await page.keyboard.down('KeyE');await wait(()=>window.catoid.snapshot().rollBank>1.25);await page.keyboard.up('KeyE');await frames(12);
  const banked=await snap();assert(Math.abs(banked.craftUp[1])<.3,'Holding roll banks the actual steering frame');assert(Math.abs(banked.cameraRight[1])>.7,'The chase camera follows the bank');
  await page.screenshot({path:'artifacts/banked-flight.png'});
  await page.waitForFunction(t=>window.catoid.snapshot().lapTime>t+2,banked.lapTime,{timeout:90000});assert(Math.abs((await snap()).rollBank-banked.rollBank)<.02,'Bank must persist after roll release');await page.keyboard.up('Space');
  await page.keyboard.down('KeyW');await frames(10);await page.keyboard.up('KeyW');s=await snap();
  assert(dot(s.forward,banked.craftUp)>.2,'Pitch must steer towards the banked body-up direction');assert(Math.abs(s.forward[1]-banked.forward[1])<.3,'A quarter-bank turns pitch across the landscape');
  await page.keyboard.press('KeyR');const initialSpin=(await snap()).roll.completed;
  await page.keyboard.press('KeyQ');assert.equal((await snap()).roll.active,false,'One tap is an ordinary roll input');await page.waitForTimeout(300);await page.keyboard.press('KeyQ');await page.keyboard.press('KeyQ');
  await wait(()=>{const s=window.catoid.snapshot();return Math.abs(s.roll.angle)>2.2&&Math.abs(s.roll.angle)<4;});
  s=await snap();assert(s.craftUp[1]<-.4,'The physical body rotates through inverted');await page.screenshot({path:'artifacts/fast-spin.png'});
  await page.waitForFunction(n=>window.catoid.snapshot().roll.completed>n,initialSpin,{timeout:90000});
  await frames(6);await page.keyboard.down('KeyQ');await frames(20);await page.keyboard.up('KeyQ');assert.equal((await snap()).roll.completed,initialSpin+1,'Holding roll must not repeat the double-tap spin');
  await page.keyboard.press('KeyR');await page.keyboard.press('KeyB');assert.equal((await snap()).levelAssist,true);
  await page.keyboard.down('KeyC');await wait(()=>window.catoid.snapshot().rollBank>1);await page.keyboard.up('KeyC');await wait(()=>Math.abs(window.catoid.snapshot().rollBank)<.07);
  await page.keyboard.press('KeyP');const frozen=await snap();await frames(8);const afterPause=await snap();assert.equal(afterPause.paused,true);assert.deepEqual(afterPause.position,frozen.position);assert.deepEqual(afterPause.orientation,frozen.orientation);assert.equal(afterPause.lapTime,frozen.lapTime);await page.click('#resume');
  console.log('Screen-space steering, banked pitch, camera roll, double-tap spins, horizon assist, airbrake, and first gate passed.');
  assert(requests.every(u=>u.startsWith(url)||u.startsWith('blob:')||u.startsWith('data:')),'No external requests');
  await page.setViewportSize({width:390,height:844});await page.reload();await wait(()=>window.catoid?.snapshot().frame>15);await page.locator('#loading').waitFor({state:'detached'});
  await page.screenshot({path:'artifacts/mobile.png'});await page.click('#open-lab');await frames(20);await page.screenshot({path:'artifacts/mobile-genome.png'});
  await page.click('#close-lab');await page.click('#launch');assert(await page.locator('#touch-controls').isVisible());
  const beforeTouch=await snap(),box=await page.locator('#touch-stick').boundingBox();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2);await page.mouse.down();await frames(16);await page.mouse.up();assert(dot((await snap()).forward,beforeTouch.cameraRight)>.08,'Touch-right must match keyboard-right');
  await page.keyboard.press('KeyR');const rollBox=await page.locator('#touch-roll-left').boundingBox();await page.mouse.move(rollBox.x+rollBox.width/2,rollBox.y+rollBox.height/2);await page.mouse.down();await wait(()=>window.catoid.snapshot().rollBank<-.8);await page.mouse.up();
  await page.keyboard.press('KeyR');await page.click('#touch-roll-left');assert.equal((await snap()).roll.active,false);await page.waitForTimeout(300);await page.locator('#touch-roll-left').dblclick({delay:40});await wait(()=>window.catoid.snapshot().roll.active);await wait(()=>!window.catoid.snapshot().roll.active);
  await page.keyboard.press('KeyP');assert.deepEqual(errors,[],'Browser and shader errors');
  assert.equal(await page.locator('#touch-up,#touch-down').count(),0,'No climb controls');
  const report={passed:true,eyes:9,regulators:67,topology:[1,3,5],seedAtlas:true,meanSilhouetteOverlap,moduleInheritance:true,stagedGrowth:true,persistence:true,firstGate:true,screenSpaceSteering:true,keyCapture:true,completeRolls:true,bodyFrameSteering:true,rotatingCamera:true,horizonAssist:true,airbrake:true,analyticFog:true,persistentBank:true,noClimbControls:true,mobileTouch:true,externalRequests:0,errors};
  await writeFile('artifacts/smoke.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
