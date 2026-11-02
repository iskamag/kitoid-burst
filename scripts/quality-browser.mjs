import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:960,height:680}}),errors=[],result={};await mkdir('artifacts',{recursive:true});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/src/catoid.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('const prepared=unpackCatoid(data);','const adoptedAt=performance.now();const prepared=unpackCatoid(data);').replace('this.materials.forEach(fogMaterial);this.rebuilds++;','this.materials.forEach(fogMaterial);this.rebuilds++;(globalThis.adoptionTimes??=[]).push(performance.now()-adoptedAt);')});});
await page.route('**/src/main.js',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('terrain.update(time,camera.position)','terrain.update(time,window.testCenter||camera.position)')+`
 window.terrainUpdateTimes=[];const updateTerrain=terrain.update;terrain.update=(...args)=>{const start=performance.now();updateTerrain(...args);window.terrainUpdateTimes.push(performance.now()-start);};
 window.quality={terrain,renderer,scene,camera,cat,circuit,sky,atlas,T,
  stage(){startFlight();paused=true;renderDirty=true;cat.root.position.set(-1975.11264032887,316.4041793028943,-841.6850111216822);setFlightCamera(true);},
  stream(x,z){window.testCenter=new T.Vector3(x,300,z);terrain.update(time,window.testCenter);renderDirty=true;},
  redraw(){renderDirty=true;}
 };
`});});
const settled=()=>page.waitForFunction(()=>{const s=window.catoid?.snapshot();return s&&s.terrain.pending===0&&s.terrain.transitions===0;},null,{timeout:120000});
try{
 const started=Date.now();await page.goto(process.env.CATOID_URL||'http://localhost:4173');await settled();result.settleMs=Date.now()-started;await page.evaluate(()=>quality.stage());await settled();await page.waitForTimeout(1000);
 result.flight=await page.evaluate(()=>{const s=catoid.snapshot();return{drawCalls:s.drawCalls,triangles:s.triangles,terrain:s.terrain,synchronousGenerations:s.heightfield.synchronousGenerations};});assert(result.flight.drawCalls<200);assert.equal(result.flight.synchronousGenerations,0);
 await page.screenshot({path:'artifacts/quality-flight.png'});
 result.performance=await page.evaluate(async()=>{
  const{renderer,scene,camera,T,terrain}=quality,gl=renderer.getContext(),draw=[],referenceDraw=[],pixel=new Uint8Array(4);
  renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  for(let i=0;i<8;i++){const start=performance.now();renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);draw.push(performance.now()-start);}
  const{TERRAIN_LIGHT_GLSL}=await import('/src/terrain-light.js'),reference=terrain.material.clone(),meshes=[];
  reference.defaultAttributeValues={...terrain.material.defaultAttributeValues};
  reference.vertexShader='varying vec2 vReferenceLighting;\n'+TERRAIN_LIGHT_GLSL+reference.vertexShader.replace('gl_Position=','vReferenceLighting=terrainLighting(vPosition,groundContact);gl_Position=');
  reference.fragmentShader='varying vec2 vReferenceLighting;\n'+reference.fragmentShader.replace('vGroundContact>.5?normalize(vNormal):terrainNormal(vPosition.xz)','normalize(vNormal)').replace('terrainLighting(vPosition,vGroundContact)','vReferenceLighting');
  scene.traverse(o=>{if(o.material===terrain.material){meshes.push(o);o.material=reference;}});
  renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  for(let i=0;i<8;i++){const start=performance.now();renderer.render(scene,camera);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);referenceDraw.push(performance.now()-start);}
  for(const mesh of meshes)mesh.material=terrain.material;reference.dispose();
  const frames=[];for(let i=0;i<40;i++){quality.redraw();await new Promise(requestAnimationFrame);frames.push(performance.now());}
  const percentile=(a,f)=>a.slice().sort((x,y)=>x-y)[Math.floor((a.length-1)*f)],extension=gl.getExtension('WEBGL_debug_renderer_info');
  return{renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),renderMedianMs:percentile(draw,.5),renderMaxMs:Math.max(...draw),vertexLitReferenceMedianMs:percentile(referenceDraw,.5),redrawFps:(frames.length-1)*1000/(frames.at(-1)-frames[0]),terrainUpdateP95Ms:percentile(terrainUpdateTimes,.95),terrainUpdateMaxMs:Math.max(...terrainUpdateTimes)};
 });
 const before=await page.evaluate(()=>catoid.snapshot());await page.waitForTimeout(600);const after=await page.evaluate(()=>catoid.snapshot());assert.equal(after.renderFrames,before.renderFrames,'Settled paused scenes must not redraw');assert.deepEqual(after.position,before.position);result.pauseDraws=after.renderFrames-before.renderFrames;
 // Reproduce the audited two-centimetre tile-boundary crossing after settling.
 await page.evaluate(()=>quality.stream(383.99,0));await settled();const revision=await page.evaluate(()=>{quality.boundaryDetails=new Map([...quality.terrain.tiles].map(([key,r])=>[key,r.detail]));return quality.terrain.stats().revision;});await page.evaluate(()=>quality.stream(384.01,0));await settled();result.boundary=await page.evaluate(()=>quality.terrain.stats());result.boundaryRevisionDelta=result.boundary.revision-revision;result.boundaryLodSwaps=await page.evaluate(()=>[...quality.terrain.tiles].filter(([key,r])=>quality.boundaryDetails.has(key)&&quality.boundaryDetails.get(key)!==r.detail).length);assert.equal(result.boundaryLodSwaps,0,'Crossing the grid boundary must not switch existing LODs');
 // Drive a longer ordinary move to exercise both cached and fresh LOD fades.
 result.fade=await page.evaluate(()=>{quality.stream(640,0);const records=[...quality.terrain.tiles.values()].filter(r=>r.previous);return{count:records.length,complementary:records.every(r=>r.previous.geometry.attributes.transition.getY(0)===-1&&r.mesh.geometry.attributes.transition.getY(0)===1&&r.previous.geometry.attributes.transition.getX(0)===r.mesh.geometry.attributes.transition.getX(0))};});
 assert(result.fade.count>0);assert(result.fade.complementary);await settled();
 await page.evaluate(()=>{quality.redraw();quality.atlas.open({seed:catoid.snapshot().seed,genes:catoid.snapshot().genes});});await page.waitForFunction(()=>!quality.atlas.busy,null,{timeout:120000});
 result.adoptionMs=await page.evaluate(()=>adoptionTimes);assert(result.adoptionMs.length>=9);
 const atlasFrame=await page.evaluate(()=>catoid.snapshot().renderFrames);await page.waitForTimeout(300);assert.equal(await page.evaluate(()=>catoid.snapshot().renderFrames),atlasFrame,'Hidden world must not render under atlas');
 await page.evaluate(()=>quality.atlas.close());
 result.latestBuild=await page.evaluate(async()=>{const {Catoid}=await import('/src/catoid.js'),{PRESETS}=await import('/src/genes.js'),model=new Catoid();const old=model.rebuildAsync(PRESETS.spindle);model.cancelBuild();const latest=model.rebuildAsync(PRESETS.corolla);const applied=await Promise.all([old,latest]);const axes=model.counts.axes,eyes=model.eyeGroups.length;model.dispose();return{applied,axes,eyes};});assert.deepEqual(result.latestBuild,{applied:[false,true],axes:5,eyes:9});
 result.lighting=await page.evaluate(()=>{const{renderer,scene,camera,terrain}=quality,gl=renderer.getContext(),w=renderer.domElement.width,h=renderer.domElement.height,a=new Uint8Array(w*h*4),b=new Uint8Array(a.length),texture=terrain.material.uniforms.uTerrainLight.value,data=texture.image.data,saved=data.slice();
 renderer.render(scene,camera);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,a);
 for(let i=0;i<data.length;i+=4){data[i]=quality.T.DataUtils.toHalfFloat(1);data[i+1]=data[i+2]=quality.T.DataUtils.toHalfFloat(-65504);}texture.clearUpdateRanges();texture.needsUpdate=true;
 renderer.render(scene,camera);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,b);let changed=0,total=0;for(let i=0;i<a.length;i+=4){const difference=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(difference>3)changed++;total+=difference;}
 data.set(saved);texture.needsUpdate=true;renderer.render(scene,camera);return{changedPixels:changed,meanChannelDifference:total/(w*h*3)};});assert(result.lighting.changedPixels>1000,'Shadow/contact lighting must affect rendered pixels');
 // The production fragment shader must light the same planar surface identically
 // with two triangles or a dense mesh, even if vertex normals are changed.
 result.fragmentShading=await page.evaluate(()=>{
  const {T,renderer,terrain}=quality,scene=new T.Scene(),camera=new T.OrthographicCamera(-180,180,180,-180,1,2000),target=new T.WebGLRenderTarget(256,256),material=terrain.material.clone();
  material.defaultAttributeValues={...terrain.material.defaultAttributeValues};material.uniforms.uHaze.value=0;material.uniforms.uTime.value=0;
  const light=terrain.material.uniforms.uTerrainLight.value.clone(),normal=terrain.material.uniforms.uTerrainNormal.value.clone();
  // Nonlinear shadow edge and varying surface normals across the negative-world
  // / texture-wrap boundary; the plane itself has no vertex lighting detail.
  light.source=new T.Source({...light.image,data:new Uint16Array(light.image.data.length)});light.clearUpdateRanges();
  const d=light.image.data,n=light.image.width,half=T.DataUtils.toHalfFloat;for(let z=0;z<n;z++)for(let x=0;x<n;x++){const wx=(x>n/2?x-n:x)*64,i=(z*n+x)*4;d[i]=half(.8);d[i+1]=half(310+wx*.12);d[i+2]=0;d[i+3]=half(1);}light.needsUpdate=true;
  material.uniforms.uTerrainLight.value=light;material.uniforms.uTerrainNormal.value=normal;
  camera.position.set(0,1000,0);camera.up.set(0,0,-1);camera.lookAt(0,300,0);
  const mesh=new T.Mesh(undefined,material);scene.add(mesh);
  function draw(divisions,changeNormals=false){
   mesh.geometry.dispose();mesh.geometry=new T.PlaneGeometry(384,384,divisions,divisions);mesh.geometry.rotateX(-Math.PI/2);mesh.geometry.translate(0,300,0);
   if(changeNormals){const a=mesh.geometry.attributes.normal;for(let i=0;i<a.count;i++)a.setXYZ(i,1,0,0);}
   const pixels=new Uint8Array(256*256*4);renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,256,256,pixels);renderer.setRenderTarget(null);return pixels;
  }
  const a=draw(1),b=draw(32,true);let max=0,changed=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);max=Math.max(max,delta);if(delta>1)changed++;}
  // Removing the normal field must visibly alter this same coarse plane.
  const flat=new T.DataArrayTexture(new Uint8Array([128,255,128,255]),1,1,1);flat.needsUpdate=true;material.uniforms.uTerrainNormal.value=flat;
  const c=draw(1);let normalPixels=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-c[i])+Math.abs(a[i+1]-c[i+1])+Math.abs(a[i+2]-c[i+2])>3)normalPixels++;
  mesh.geometry.dispose();material.dispose();light.dispose();normal.dispose();flat.dispose();target.dispose();
  return{maxChannelDifference:max,changedChannels:changed,normalPixels};
 });assert.equal(result.fragmentShading.changedChannels,0,'Terrain illumination must be independent of mesh tessellation and vertex normals');assert(result.fragmentShading.normalPixels>1000,'The world normal field must affect coarse terrain pixels');
 assert.deepEqual(errors,[]);result.passed=true;result.errors=errors;await writeFile('artifacts/quality-browser.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
