import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1280,height:850}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
// Freeze the production view for optical inspection; no alternate scene, fog,
// lighting, terrain, or flare shader is substituted.
await page.route('**/src/main.js',async route=>{
  const response=await route.fetch();await route.fulfill({response,body:(await response.text())+`
    window.inspectSun=kind=>{
      paused=true;cat.root.visible=false;document.querySelectorAll('body > :not(canvas):not(script)').forEach(e=>e.style.display='none');
      const eye=new T.Vector3(0,2200,0);
      if(kind==='blocked'){
        let found=false;
        for(let z=-2500;z<=2500&&!found;z+=125)for(let x=-2500;x<=2500;x+=125){const p=new T.Vector3(x,heightAt(x,z)+12,z);if(terrain.occludesSun(p,SUN_DIRECTION)){eye.copy(p);found=true;break;}}
        if(!found)throw new Error('No sun-occluded hillside found');
      }
      camera.position.copy(eye);camera.up.set(0,1,0);camera.fov=61;camera.updateProjectionMatrix();
      const direction=SUN_DIRECTION.clone().multiplyScalar(kind==='away'?-1:1).add(new T.Vector3(.15,-.09,0)).normalize();camera.lookAt(eye.clone().addScaledVector(direction,1000));
      return{eye:eye.toArray(),blocked:terrain.occludesSun(eye,SUN_DIRECTION)};
    };
    window.inspectHaze=density=>sky.setDensity(density);
    window.flarePixels=()=>{
      const flare=scene.children.find(o=>o.renderOrder===10000),gl=renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,a=new Uint8Array(w*h*4),b=new Uint8Array(a.length);
      flare.visible=true;renderer.render(scene,camera);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);
      flare.visible=false;renderer.render(scene,camera);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);flare.visible=true;renderer.render(scene,camera);
      let changed=0,maxDelta=0;for(let i=0;i<a.length;i+=4){const delta=Math.max(Math.abs(a[i]-b[i]),Math.abs(a[i+1]-b[i+1]),Math.abs(a[i+2]-b[i+2]));if(delta>3)changed++;maxDelta=Math.max(maxDelta,delta);}
      return{changed,maxDelta};
    };
  `});
});
const frames=async n=>{const start=await page.evaluate(()=>window.catoid.snapshot().frame);await page.waitForFunction(t=>window.catoid.snapshot().frame>=t,start+n,{timeout:90000});};
await mkdir('artifacts',{recursive:true});
try{
  await page.goto(process.env.CATOID_URL||'http://localhost:4173');await page.waitForFunction(()=>window.catoid?.snapshot().frame>15,null,{timeout:90000});await page.locator('#loading').waitFor({state:'detached'});
  const clear=await page.evaluate(()=>window.inspectSun('clear'));await frames(25);let flare=await page.evaluate(()=>window.catoid.snapshot().lensFlare);
  assert(!clear.blocked&&flare.strength>.5,'Visible sun must drive the flare');
  const pixels=await page.evaluate(()=>window.flarePixels());assert(pixels.changed>100&&pixels.maxDelta>5,'The flare must actually affect rendered pixels');await page.screenshot({path:'artifacts/sun-flare.png'});
  await page.evaluate(()=>window.inspectHaze(20));await page.waitForFunction(()=>{const s=window.catoid.snapshot();return s.airDensity>19&&s.lensFlare.strength<.001;},null,{timeout:90000});
  await page.evaluate(()=>window.inspectHaze(1));await page.waitForFunction(()=>window.catoid.snapshot().airDensity<1.02,null,{timeout:90000});
  const blocked=await page.evaluate(()=>window.inspectSun('blocked'));await frames(25);flare=await page.evaluate(()=>window.catoid.snapshot().lensFlare);assert(blocked.blocked&&flare.blocked&&flare.strength<.001,'A hillside must occlude the flare');await page.screenshot({path:'artifacts/sun-occluded.png'});
  await page.evaluate(()=>window.inspectSun('away'));await frames(25);flare=await page.evaluate(()=>window.catoid.snapshot().lensFlare);assert(flare.strength<.001,'Looking away must remove the flare');
  assert.deepEqual(errors,[]);const result={passed:true,pixels,clear,blocked,lookingAway:true,fogAttenuation:true,errors};await writeFile('artifacts/atmosphere-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
