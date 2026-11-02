const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
import {mkdir,writeFile} from 'node:fs/promises';
// Render the production landscape from above and at ridge height. Only the
// camera, tile-streaming center, fog setting and interface change for inspection.
const label=process.argv[2]||'current',out='artifacts';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/src/main.js',async route=>{
  const response=await route.fetch(),code=await response.text();
  await route.fulfill({response,body:code.replace('center:initialLocation','center:new T.Vector3()').replace('terrain.update(time,camera.position)','terrain.update(time,window.inspectingTerrain?window.inspectionCenter:camera.position)')+`
    window.inspectTerrain=kind=>{
      window.inspectingTerrain=true;window.inspectionCenter=new T.Vector3();paused=true;renderDirty=true;cat.root.visible=false;
      document.querySelectorAll('body > :not(canvas):not(script)').forEach(e=>e.style.display='none');
      camera.fov=54;camera.aspect=innerWidth/innerHeight;camera.up.set(0,0,-1);camera.position.set(0,8400,0);camera.lookAt(0,0,0);sky.setDensity(0);
      if(kind==='oblique'){camera.up.set(0,1,0);camera.position.set(4500,4800,5000);camera.lookAt(0,150,0);}
      if(kind==='ridge'){
        const peak=new T.Vector3(0,-Infinity,0);
        for(let z=-3600;z<=3600;z+=120)for(let x=-3600;x<=3600;x+=120){const h=heightAt(x,z);if(h>peak.y)peak.set(x,h,z);}
        camera.up.set(0,1,0);camera.position.copy(peak).add(new T.Vector3(600,210,750));camera.lookAt(peak);window.inspectionCenter.copy(camera.position);sky.setDensity(1);
      }
      camera.updateProjectionMatrix();terrain.update(time,window.inspectionCenter);
      return{camera:camera.position.toArray(),center:window.inspectionCenter.toArray()};
    };
  `});
});
const views=[];
try{
  await page.goto(process.env.CATOID_URL||'http://localhost:4173');await page.waitForFunction(()=>window.catoid?.snapshot().frame>15,null,{timeout:90000});
  for(const kind of ['overhead','oblique','ridge']){
    const view=await page.evaluate(kind=>window.inspectTerrain(kind),kind);views.push({kind,...view});
    await page.evaluate(async kind=>{const {atmosphereUniforms}=await import('/src/atmosphere.js');atmosphereUniforms.uHaze.value=kind==='ridge'?1:0;},kind);
    const frame=await page.evaluate(()=>window.catoid.snapshot().frame);await page.waitForFunction(goal=>window.catoid.snapshot().frame>=goal,frame+(kind==='ridge'?40:12),{timeout:90000});
    await page.waitForFunction(()=>window.catoid.snapshot().terrain.pending===0&&window.catoid.snapshot().terrain.transitions===0,null,{timeout:90000}).catch(async error=>{console.error(JSON.stringify(await page.evaluate(()=>window.catoid.snapshot())));throw error;});
    await page.screenshot({path:`${out}/terrain-${label}-${kind}.png`});
  }
  await writeFile(`${out}/terrain-${label}-survey.json`,JSON.stringify({label,views,errors},null,2));console.log(JSON.stringify({label,views,errors}));
}finally{await browser.close();}
if(errors.length)process.exitCode=1;
