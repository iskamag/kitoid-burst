import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
const url=process.env.KITOID_GAMES_URL||'http://localhost:4183/games/',errors=[];await mkdir('artifacts',{recursive:true});
try{
 for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});page.on('pageerror',e=>errors.push(e.message));
  const response=await page.goto(url);assert.equal(response.status(),200);
  await page.locator('.featured img').evaluate(image=>image.decode());
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(await page.locator('.featured h2').innerText(),'Kitoid Burst');
  assert.equal(await page.locator('.more .game').count(),3);
  assert.equal(await page.locator('.featured .play').getAttribute('href'),'./kitoid-burst/');
  await page.screenshot({path:`artifacts/games-${viewport.width}.png`,fullPage:true});await page.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,url,viewports:[1280,390],errors}));
}finally{await browser.close();}
