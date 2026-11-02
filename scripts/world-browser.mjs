import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1}),errors=[];
const url=process.env.CATOID_URL||'http://localhost:4173';
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const ready=async()=>{await page.waitForFunction(()=>window.catoid?.snapshot().frame>25,null,{timeout:90000});await page.locator('#loading').waitFor({state:'detached'});assert.equal((await snap()).heightfield.synchronousGenerations,0,'World loading must not run erosion on the UI thread');};
const snap=()=>page.evaluate(()=>window.catoid.snapshot());
await mkdir('artifacts',{recursive:true});
try{
  await page.goto(url);await ready();await page.screenshot({path:'artifacts/ridges-overlook.png'});
  // Compare both production GPU paths against independent quadrature of
  // IQ's exponential height density, including its horizontal-ray limit.
  const fog=await page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js'),{fogMaterial,ATMOSPHERE_GLSL,atmosphereUniforms:u,FOG_DENSITY,FOG_FALLOFF,SUN_DIRECTION}=await import('/src/atmosphere.js');
    const saved={eye:u.uAtmoEye.value.clone(),density:u.uHaze.value,time:u.uAtmoTime.value},r=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
    r.setSize(1,1);r.outputColorSpace=T.SRGBColorSpace;r.toneMapping=T.NoToneMapping;
    const camera=new T.PerspectiveCamera(50,1,.1,10000),scene=new T.Scene(),geo=new T.PlaneGeometry(1,1);
    const materials=[fogMaterial(new T.MeshBasicMaterial({color:0xffffff})),new T.ShaderMaterial({uniforms:{...u},vertexShader:'varying vec3 p;void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 p;${ATMOSPHERE_GLSL}void main(){gl_FragColor=vec4(atmosphere(vec3(1.),p),1.);\n#include <colorspace_fragment>\n}`})];
    const plane=new T.Mesh(geo,materials[0]);scene.add(plane);const samples=[],gl=r.getContext();u.uHaze.value=1;u.uAtmoTime.value=0;
    const srgb=c=>c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055;
    try{
      const cases=[];
      for(const altitude of [0,1000])for(const distance of [100,500,1400,2500,5500])cases.push({eye:[0,altitude,0],end:[0,altitude,-distance],density:1});
      for(const dy of [-.6,-1e-7,0,1e-7,.6])for(const density of [.55,1.8])cases.push({eye:[0,900,0],end:[0,900+dy*1200,-Math.sqrt(1-dy*dy)*1200],density});
      for(const sign of [-1,1])cases.push({eye:[0,500,0],end:[sign*SUN_DIRECTION.x*2000,500+SUN_DIRECTION.y*2000,sign*SUN_DIRECTION.z*2000],density:1});
      for(let kind=0;kind<materials.length;kind++)for(const sample of cases){
        const {eye,end,density}=sample,ray=new T.Vector3().fromArray(end).sub(new T.Vector3().fromArray(eye)),distance=ray.length();
        camera.position.fromArray(eye);camera.lookAt(new T.Vector3().fromArray(end));u.uAtmoEye.value.copy(camera.position);u.uHaze.value=density;plane.position.fromArray(end);plane.quaternion.copy(camera.quaternion);plane.scale.setScalar(distance);plane.material=materials[kind];
        r.render(scene,camera);const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        let integral=0;for(let i=0;i<4096;i++)integral+=FOG_DENSITY*density*Math.exp(-(eye[1]+(end[1]-eye[1])*(i+.5)/4096)*FOG_FALLOFF)*distance/4096;
        const amount=Math.min(1,integral),sunward=Math.max(0,ray.normalize().dot(SUN_DIRECTION))**8,blue=[.14,.22,.30],warm=[.70,.48,.20],expected=blue.map((c,i)=>Math.round(srgb((1-amount)+(c+(warm[i]-c)*sunward)*amount)*255));
        samples.push({kind,...sample,pixel:[...pixel].slice(0,3),expected});
      }
    }finally{u.uAtmoEye.value.copy(saved.eye);u.uHaze.value=saved.density;u.uAtmoTime.value=saved.time;materials.forEach(m=>m.dispose());geo.dispose();r.dispose();}
    return samples;
  });
  for(const sample of fog)for(let c=0;c<3;c++)assert(Math.abs(sample.pixel[c]-sample.expected[c])<=2,`GPU fog must match the analytic height integral: ${JSON.stringify(sample)}`);
  assert(fog[3].pixel.some((v,c)=>Math.abs(v-fog[8].pixel[c])>15),'Height density must visibly affect the same range');
  console.log('Both atmosphere shader paths match independent density integration, including near-horizontal rays and sunward scattering.');
  await page.click('#launch');await page.keyboard.press('KeyB');const courses=[]; // Explicitly enable horizon assist for the route follower.
  for(const [id,count,path] of [['cut',7,'copper-cut'],['needles',8,'needle-garden'],['highline',9,'highline'],['pilgrimage',22,'long-way-home']]){
    await page.waitForFunction(id=>window.catoid.snapshot().course===id,id);const state=await snap();assert.equal(state.gateTotal,count);courses.push({id,count});
    await page.screenshot({path:`artifacts/${path}.png`});await page.keyboard.press('KeyN');
  }
  await page.keyboard.press('KeyR');
  // These are keyboard events through the real capture/input path, not position
  // writes or direct integrator calls. Follow four gates and the intervening arch.
  const flight=page.evaluate(async()=>{
    const T=await import('/vendor/three.module.js'),W=await import('/src/world.js');
    const root=document.getElementById('world'),held=new Set(),wrap=x=>Math.atan2(Math.sin(x),Math.cos(x)),clamp=T.MathUtils.clamp;
    function setKeys(wanted){for(const code of new Set([...held,...wanted]))if(held.has(code)!==wanted.has(code)){root.dispatchEvent(new KeyboardEvent(wanted.has(code)?'keydown':'keyup',{code,key:code.slice(3).toLowerCase(),bubbles:true,cancelable:true}));if(wanted.has(code))held.add(code);else held.delete(code);}}
    window.worldPlay={archApproach:false};let steps=0,maxGate=0;
    return await new Promise(resolve=>{
      function frame(){
        const s=window.catoid.snapshot(),p=new T.Vector3().fromArray(s.position),near=W.corridorAt(p.x,p.z),course=W.COURSES[0],goalT=course.samples[s.nextGate],t=Math.min(goalT,near.t+Math.max(55,s.speed*.9)/W.ROUTE_LENGTH);
        maxGate=Math.max(maxGate,s.gateCount);
        if(maxGate>=4||s.lapTime>85||s.collisions>0||steps++>9000){setKeys(new Set());resolve({gates:maxGate,collisions:s.collisions,seconds:s.lapTime,position:s.position});return;}
        const target=W.routePoint(t);target.y=window.catoid.heightAt(target.x,target.z)+course.lift;
        const gate=W.routePoint(goalT);gate.y=window.catoid.heightAt(gate.x,gate.z)+(W.ARCH_SITES.find(a=>a.t===goalT)?.height*.45||course.lift+(s.nextGate?Math.sin(s.nextGate*1.3)*15:0));
        const gd=target.distanceTo(gate);if(gd<150)target.y=T.MathUtils.lerp(target.y,gate.y,1-gd/150);
        for(const arch of W.ARCH_SITES){const ap=W.routePoint(arch.t),d=Math.hypot(ap.x-p.x,ap.z-p.z),ahead=ap.clone().sub(p).dot(W.routeTangent(near.t));if(arch.t===.075&&d<160&&ahead>0)window.worldPlay.archApproach=true;if(d<190&&ahead>-10)target.y=T.MathUtils.lerp(target.y,window.catoid.heightAt(ap.x,ap.z)+arch.height*.45,1-T.MathUtils.smoothstep(d,45,190));}
        for(let sample=0;sample<=4;sample++){const q=p.clone().lerp(target,sample/4);target.y=Math.max(target.y,window.catoid.heightAt(q.x,q.z)+24);}
        const delta=target.sub(p),yawError=wrap(Math.atan2(delta.x,delta.z)-s.yaw),pitchError=Math.atan2(delta.y,Math.hypot(delta.x,delta.z))-s.pitch,wanted=new Set();
        if(Math.abs(yawError)>.035)wanted.add(yawError>0?'KeyA':'KeyD');if(Math.abs(pitchError)>.018)wanted.add(pitchError>0?'KeyW':'KeyS');if(Math.abs(yawError)>.38||Math.abs(pitchError)>.22||Math.abs(s.pitch)>.58)wanted.add('KeyX');setKeys(wanted);requestAnimationFrame(frame);
      }requestAnimationFrame(frame);
    });
  });
  await page.waitForFunction(()=>window.worldPlay?.archApproach,null,{timeout:180000});await page.screenshot({path:'artifacts/arch-flight.png'});
  const traversal=await flight;assert.equal(traversal.gates,4,'Real keyboard flight must reach four gates');assert.equal(traversal.collisions,0,'The arch approach must be clear');
  console.log('Keyboard flight passed four gates and an open stone arch.');
  await page.goto(url+'/?reach=3,-2');await ready();let distant=await snap();assert.equal(distant.reach.key,'3:-2');assert(Math.hypot(distant.position[0],distant.position[2])>20000);await page.screenshot({path:'artifacts/distant-reach.png'});
  await page.click('#launch');distant=await snap();assert.equal(distant.course,'cut');assert.equal(distant.gateTotal,7);assert(distant.clearance>=35);
  assert.deepEqual(errors,[],'No browser or shader errors');const report={passed:true,gpuDistanceFog:fog,courses,keyboardTraversal:traversal,distantReach:distant.reach,errors};
  await writeFile('artifacts/world-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,courses,keyboardTraversal:traversal,distantReach:distant.reach,errors},null,2));
}finally{await browser.close();}
