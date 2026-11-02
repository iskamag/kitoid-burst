import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.env.KITOID_URL||'http://localhost:4183/games/kitoid-burst/';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const errors=[],badRequests=[],results=[];await mkdir('artifacts',{recursive:true});
try{
 for(const viewport of [{width:1280,height:800},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)badRequests.push({url:r.url(),status:r.status()});});
  await page.goto(url);await page.waitForFunction(()=>window.kitoid?.snapshot().frame>10,null,{timeout:120000});await page.locator('#loading').waitFor({state:'detached'});
  assert.match(await page.title(),/^Kitoid Burst/);assert.equal(await page.locator('.wordmark').innerText(),'KITOID BURST');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const fits=await page.evaluate(()=>{const brand=document.querySelector('.wordmark').getBoundingClientRect(),nav=document.querySelector('.masthead nav').getBoundingClientRect();return brand.right+8<=nav.left&&nav.right<=innerWidth;});assert(fits,'Brand and toolbar must fit without overlap');
  if(viewport.width>600){await mkdir('docs',{recursive:true});await page.screenshot({path:process.env.KITOID_PREVIEW||'docs/preview.jpg',type:'jpeg',quality:85});}
  await page.click('#launch');await page.keyboard.down('ShiftLeft');await page.waitForFunction(()=>kitoid.snapshot().speed>130,null,{timeout:30000});await page.keyboard.up('ShiftLeft');await page.keyboard.press('KeyP');
  assert.equal(await page.evaluate(()=>kitoid.snapshot().paused),true);
  await page.click('#resume');await page.click('#open-lab');const downloadEvent=page.waitForEvent('download');await page.click('#export');const download=await downloadEvent;assert.match(download.suggestedFilename(),/^kitoid-burst-\d+\.json$/);
  const snapshot=await page.evaluate(()=>kitoid.snapshot());assert.equal(snapshot.eyes,9);assert.equal(snapshot.heightfield.synchronousGenerations,0);
  results.push({viewport,title:await page.title(),eyes:snapshot.eyes,speed:snapshot.speed,exportName:download.suggestedFilename()});
  await page.screenshot({path:`artifacts/release-${viewport.width}.png`});await page.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(badRequests,[]);
 const report={passed:true,url,results,errors,badRequests};await writeFile('artifacts/release-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
