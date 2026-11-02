import * as T from '../vendor/three.module.js';
import {GeometryBatch,mergeGeometry} from './geometry-batch.js';
import {createTerrainLightField,createTerrainNormalField,TERRAIN_LIGHT_GLSL,TERRAIN_NORMAL_GLSL,pruneLighting,LIGHT_MARGIN} from './terrain-light.js';
import {ATMOSPHERE_GLSL,atmosphereUniforms,createAtmosphere,fogMaterial} from './atmosphere.js';
import {WORLD_SIZE,routePoint,routeTangent,corridorAt,COURSES,ARCH_SITES,NEEDLES,regionAt,worldRegion} from './world.js';
import {erodedHeightAt,prepareHeightfield,prepareFieldBounds,fieldBoundsReady,fieldVersion,PATCH_SIZE,fieldNoise} from './heightfield.js';
export {WORLD_SIZE};
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const clamp=T.MathUtils.clamp,lerp=T.MathUtils.lerp;
const TILE=384,CELLS=48,STEP=TILE/CELLS;
const DETAIL_LIMITS={48:[0,948],24:[692,1628],12:[1372,3228],8:[2972,Infinity]};
// The landscape is simulated independently of routes and landmark placement.
const rawHeightAt=erodedHeightAt;
// Lazy 8 m Float32 samples are shared by collision, geometry, and normals.
// Tile-sized arrays keep lookups cheap and are discarded beyond the view.
const heightSamples=new Map();let sampleMisses=0,sampleHits=0;
function sample(ix,iz){
  const tx=Math.floor(ix/CELLS),tz=Math.floor(iz/CELLS),key=tx+':'+tz;let values=heightSamples.get(key);
  if(!values){values=new Float32Array(CELLS*CELLS).fill(NaN);heightSamples.set(key,values);}
  const index=(iz-tz*CELLS)*CELLS+ix-tx*CELLS;
  if(Number.isNaN(values[index])){sampleMisses++;values[index]=rawHeightAt(ix*STEP,iz*STEP);}else sampleHits++;
  return values[index];
}
function meshHeight(x,z){const ix=x/STEP,iz=z/STEP;return Number.isInteger(ix)&&Number.isInteger(iz)?sample(ix,iz):Math.fround(rawHeightAt(x,z));}
function pruneSamples(cx,cz,radius){for(const key of heightSamples.keys()){const [x,z]=key.split(':').map(Number);if(Math.abs(x-cx)>radius||Math.abs(z-cz)>radius)heightSamples.delete(key);}}

// Collision always uses the exact triangles of the finest nearby terrain LOD.
export function heightAt(x,z){
  const gx=x/STEP,gz=z/STEP,ix=Math.floor(gx),iz=Math.floor(gz),tx=gx-ix,tz=gz-iz;
  const a=sample(ix,iz),b=sample(ix+1,iz),c=sample(ix,iz+1),d=sample(ix+1,iz+1);
  return tx+tz<=1?a+tx*(b-a)+tz*(c-a):d+(1-tx)*(c-d)+(1-tz)*(b-d);
}
export function groundNormal(x,z){const e=3;return V(heightAt(x-e,z)-heightAt(x+e,z),e*2,heightAt(x,z-e)-heightAt(x,z+e)).normalize();}
export function sweepGround(from,to,radius=3){
  const steps=Math.max(1,Math.ceil(from.distanceTo(to)/3));let safe=from.clone();
  for(let i=1;i<=steps;i++){
    const p=from.clone().lerp(to,i/steps);
    if(p.y-heightAt(p.x,p.z)<radius){
      let a=safe.clone(),b=p;
      for(let j=0;j<7;j++){const m=a.clone().lerp(b,.5);if(m.y-heightAt(m.x,m.z)>=radius)a=m;else b=m;}
      const normal=groundNormal(a.x,a.z);return{hit:true,position:a.addScaledVector(normal,.6),normal,fraction:(i-1)/steps};
    }
    safe=p;
  }
  return{hit:false,position:to.clone(),normal:V(0,1,0),fraction:1};
}

function tileGeometry(tx,tz,divisions){
  const positions=[],indices=[],step=TILE/divisions,row=divisions+1;
  for(let z=0;z<=divisions;z++)for(let x=0;x<=divisions;x++){
    const wx=tx*TILE+x*step,wz=tz*TILE+z*step;positions.push(wx,meshHeight(wx,wz),wz);
  }
  // Every LOD uses the same 8 m boundary. Triangle fans join that shared edge
  // to the coarser interior, eliminating cracks and overlapping skirt walls.
  for(let z=0;z<divisions;z++)for(let x=0;x<divisions;x++){
    const k=z*row+x;
    if(divisions===CELLS||(x>0&&z>0&&x<divisions-1&&z<divisions-1)){indices.push(k,k+row,k+1,k+1,k+row,k+row+1);continue;}
    const polygon=[];
    function edge(a,b,outer){polygon.push(a);if(outer)for(let j=1;j<step/STEP;j++){const t=j*STEP/step,wx=lerp(positions[a*3],positions[b*3],t),wz=lerp(positions[a*3+2],positions[b*3+2],t);polygon.push(positions.length/3);positions.push(wx,meshHeight(wx,wz),wz);}}
    edge(k,k+row,x===0);edge(k+row,k+row+1,z===divisions-1);edge(k+row+1,k+1,x===divisions-1);edge(k+1,k,z===0);
    const center=positions.length/3,wx=tx*TILE+(x+.5)*step,wz=tz*TILE+(z+.5)*step;positions.push(wx,meshHeight(wx,wz),wz);
    for(let j=0;j<polygon.length;j++)indices.push(center,polygon[j],polygon[(j+1)%polygon.length]);
  }
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.setAttribute('normal',new T.Float32BufferAttribute(new Float32Array(positions.length),3));
  // Derive top normals from the shared heightfield, including samples outside
  // the tile. Independently averaged edge triangles leave lighting seams.
  const normals=geo.attributes.normal;
  for(let i=0;i<positions.length/3;i++){
    const x=positions[i*3],z=positions[i*3+2],e=STEP,row=divisions+1,col=i%row,line=Math.floor(i/row),fine=divisions===CELLS;
    const left=fine&&col>0?positions[(i-1)*3+1]:meshHeight(x-e,z);
    const right=fine&&col<divisions?positions[(i+1)*3+1]:meshHeight(x+e,z);
    const back=fine&&line>0?positions[(i-row)*3+1]:meshHeight(x,z-e);
    const front=fine&&line<divisions?positions[(i+row)*3+1]:meshHeight(x,z+e);
    const n=V(left-right,e*2,back-front).normalize();normals.setXYZ(i,n.x,n.y,n.z);
  }
  geo.setAttribute('transition',new T.BufferAttribute(new Float32Array(positions.length/3*2),2));
  geo.computeBoundingSphere();return geo;
}

export function createTerrain(scene,options={}){
  const lightField=createTerrainLightField(),normalField=createTerrainNormalField(meshHeight);
  const uniforms={...atmosphereUniforms,uTerrainLight:{value:lightField.texture},uTerrainNormal:{value:normalField.texture},uTime:{value:0},uLodClock:{value:0},uPulse:{value:V(0,0,-100)}};
  const material=new T.ShaderMaterial({uniforms,vertexShader:`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec2 transition;attribute float groundContact;varying vec2 vTransition;varying float vGroundContact;
    varying vec3 vPosition;varying vec3 vNormal;
    void main(){vTransition=transition;vGroundContact=groundContact;vPosition=(modelMatrix*vec4(position,1.)).xyz;vNormal=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
      #include <logdepthbuf_vertex>
    }
  `,fragmentShader:`
    #include <logdepthbuf_pars_fragment>
    precision highp float;varying vec2 vTransition;varying float vGroundContact;uniform float uLodClock;varying vec3 vPosition;varying vec3 vNormal;uniform float uTime;uniform vec3 uPulse;
    ${ATMOSPHERE_GLSL}
    ${TERRAIN_LIGHT_GLSL}
    ${TERRAIN_NORMAL_GLSL}
    vec3 palette(float h){
      vec3 c=mix(vec3(.008,.035,.075),vec3(.012,.19,.19),smoothstep(35.,125.,h));
      c=mix(c,vec3(.08,.25,.15),smoothstep(120.,225.,h));
      c=mix(c,vec3(.36,.17,.035),smoothstep(220.,350.,h));
      c=mix(c,vec3(.38,.055,.025),smoothstep(340.,510.,h));
      return mix(c,vec3(.30,.08,.18),smoothstep(500.,710.,h));
    }
    void main(){
      #include <logdepthbuf_fragment>
      // Complementary screen-door coverage avoids alpha sorting and depth
      // fighting while both LOD silhouettes are present during the transition.
      float coverage=clamp((uLodClock-vTransition.x)/.55,0.,1.);
      float dither=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
      if(vTransition.y>0.5&&dither>=coverage)discard;
      if(vTransition.y<-.5&&dither<coverage)discard;
      float h=vPosition.y;vec3 col=palette(h);
      vec3 normal=vGroundContact>.5?normalize(vNormal):terrainNormal(vPosition.xz);
      float light=max(0.,dot(normal,uSunDirection));
      vec2 lighting=terrainLighting(vPosition,vGroundContact);
      col*=vec3(.30,.36,.46)*lighting.x+vec3(.85,.77,.64)*light*lighting.y;
      // Broad flowing elevation colors, as in the reference, rather than a grid
      // of dense contour lines. Fine ridges and actual silhouettes provide detail.
      col*=.94+.06*sin(h*.044+sin(vPosition.x*.008)*.5-uTime*.055);
      float age=uTime-uPulse.z;
      float wave=exp(-pow((length(vPosition.xz-uPulse.xy)-age*190.)/18.,2.))*exp(-age*.8);col+=vec3(.10,.24,.12)*wave;
      col=atmosphere(col,vPosition);
      float grain=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);col+=(grain-.5)*.004;
      gl_FragColor=vec4(col,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `});
  material.defaultAttributeValues.groundContact=[0];material.defaultAttributeValues.transition=[0,0];
  const group=new T.Group();scene.add(group);const tiles=new Map(),batches=new Map(),fading=new Set(),reachMeshes=new Map(),obstacles=[],arches=[];let lastX=Infinity,lastZ=Infinity,lodX=Infinity,lodZ=Infinity,revision=0,pending=[],landmarkVersion=-1,activeReaches=new Map();
  const streamEye=V(),progressive=!!options.progressive;let prefetchEnabled=options.backgroundPrefetch!==false;
  const mobile=!!(globalThis.innerWidth&&globalThis.innerWidth<=600),radius=mobile?12:16,landmarkDistance=(radius+1)*TILE;
  const queuedFields=new Set();
  function prepareBounds(x0,z0,x1,z1){
    const key=[x0,z0,x1,z1].map(v=>Math.floor(v/PATCH_SIZE)).join(':');if(queuedFields.has(key))return;queuedFields.add(key);
    prepareFieldBounds(x0,z0,x1,z1).catch(error=>console.error('Terrain preparation failed',error)).finally(()=>queuedFields.delete(key));
  }
  function readyBounds(x0,z0,x1,z1){if(!progressive||fieldBoundsReady(x0,z0,x1,z1))return true;prepareBounds(x0,z0,x1,z1);return false;}
  function transition(geometry,direction){const a=geometry.attributes.transition;for(let i=0;i<a.count;i++)a.setXY(i,uniforms.uLodClock.value,direction);a.needsUpdate=true;}
  function showGeometry(record,geometry,detail){
    if(detail>12){const mesh=new T.Mesh(geometry,material);mesh.matrixAutoUpdate=false;group.add(mesh);return{mesh,geometry};}
    const key=Math.floor(record.tx/4)+':'+Math.floor(record.tz/4);let batch=batches.get(key);
    if(!batch){batch=new GeometryBatch(material);batches.set(key,batch);scene.add(batch.mesh);}
    return{batch,key,slot:batch.add(geometry),geometry};
  }
  function hideGeometry(display){if(!display)return;if(display.mesh)group.remove(display.mesh);else display.batch.remove(display.slot);}
  function finishFade(record){hideGeometry(record.previous);record.previous=null;fading.delete(record);transition(record.mesh.geometry,0);if(record.display.batch)record.display.batch.write(record.display.slot,record.mesh.geometry);}
  function tile(tx,tz,detail,immediate=false){
    if(!readyBounds(tx*TILE-LIGHT_MARGIN,tz*TILE-LIGHT_MARGIN,(tx+1)*TILE+LIGHT_MARGIN,(tz+1)*TILE+LIGHT_MARGIN))return null;
    const key=tx+':'+tz;let record=tiles.get(key);
    if(!record){
      lightField.prepare(tx*TILE,tz*TILE,(tx+1)*TILE,(tz+1)*TILE);normalField.prepare(tx*TILE,tz*TILE,(tx+1)*TILE,(tz+1)*TILE);
      record={geometries:new Map(),mesh:new T.Mesh(undefined,material),tx,tz,detail:null};tiles.set(key,record);
    }
    if(!record.geometries.has(detail))record.geometries.set(detail,tileGeometry(tx,tz,detail));
    const geometry=record.geometries.get(detail);if(record.detail===detail)return record.mesh;
    if(record.previous)finishFade(record);
    const blend=progressive&&!immediate&&record.display;
    if(blend){record.previous=record.display;transition(record.previous.geometry,-1);if(record.previous.batch)record.previous.batch.write(record.previous.slot,record.previous.geometry);fading.add(record);record.fadeEnd=uniforms.uLodClock.value+.55;}
    else hideGeometry(record.display);
    transition(geometry,blend?1:0);record.mesh.geometry=geometry;record.detail=detail;revision++;record.display=showGeometry(record,geometry,detail);return record.mesh;
  }
  function stream(eye,force=false){
    const cx=Math.floor(eye.x/TILE),cz=Math.floor(eye.z/TILE);
    if(!force&&cx===lastX&&cz===lastZ&&Math.hypot(eye.x-lodX,eye.z-lodZ)<64)return;
    lodX=eye.x;lodZ=eye.z;
    const jumped=Math.max(Math.abs(cx-lastX),Math.abs(cz-lastZ))>1;lastX=cx;lastZ=cz;
    const active=new Set(),requests=[];activeReaches=new Map();streamEye.copy(eye);pruneSamples(cx,cz,radius+2);pruneLighting(eye.x,eye.z,(radius+4)*TILE);
    for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
      if(Math.hypot(dx,dz)>radius+.3)continue;
      const tx=cx+dx,tz=cz+dz,dist=Math.hypot((tx+.5)*TILE-eye.x,(tz+.5)*TILE-eye.z);
      let detail=dist<820?48:dist<1500?24:dist<3100?12:8;
      const key=tx+':'+tz,record=tiles.get(key);active.add(key);
      // A 128 m dead band prevents repeated swaps when circling a threshold.
      if(record){const[lo,hi]=DETAIL_LIMITS[record.detail];if(dist>=lo&&dist<hi)detail=record.detail;}
      if(!record||record.detail!==detail)requests.push({tx,tz,detail,dist});
      const reach=worldRegion((tx+.5)*TILE,(tz+.5)*TILE);activeReaches.set(reach.key,reach);
    }
    for(const [key,record]of tiles)if(!active.has(key)){hideGeometry(record.display);hideGeometry(record.previous);fading.delete(record);record.geometries.forEach(g=>g.dispose());tiles.delete(key);}
    pending=requests.sort((a,b)=>a.dist-b.dist);
    // Route selection can move several kilometres at once. Prepare its nearby
    // triangles immediately, then continue filling the horizon over later frames.
    for(let i=0;i<pending.length&&(force||(jumped&&pending[i].dist<660));){const p=pending[i];if(tile(p.tx,p.tz,p.detail,true))pending.splice(i,1);else i++;}
    syncLandmarks(activeReaches);landmarkVersion=fieldVersion();
    if(!force&&prefetchEnabled)prepareHeightfield(eye.x,eye.z,11000).catch(error=>console.error('Terrain preparation failed',error));
  }
  function fillTiles(){
    // New outer tiles are hidden by distance fog; near tiles already have a
    // coarser mesh. Spread upgrades across frames instead of stalling on a row.
    for(const record of fading)if(uniforms.uLodClock.value>=record.fadeEnd)finishFade(record);
    const start=performance.now();let i=0;
    while(i<pending.length&&performance.now()-start<4){const p=pending[i];if(tile(p.tx,p.tz,p.detail))pending.splice(i,1);else i++;}
    for(const[key,batch]of batches){batch.flush();if(!batch.parts.size){scene.remove(batch.mesh);batch.dispose();batches.delete(key);}}
    if(progressive&&fieldVersion()!==landmarkVersion){syncLandmarks(activeReaches);landmarkVersion=fieldVersion();}
  }
  const initial=options.center||routePoint(0);stream(initial,!progressive);for(const batch of batches.values())batch.flush();

  const floor=new T.Mesh(new T.PlaneGeometry(80000,80000),fogMaterial(new T.MeshBasicMaterial({color:0x071526})));floor.rotation.x=-Math.PI/2;floor.position.y=-180;scene.add(floor);
  function lightLandmark(mesh){
    mesh.updateMatrixWorld(true);mesh.geometry.computeBoundingBox();
    const bounds=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
    mesh.userData.lightBounds=bounds;
    mesh.geometry.setAttribute('groundContact',new T.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count).fill(1),1));
  }
  function syncLandmarks(active){
    let changed=false;
    for(const [key,record]of reachMeshes)if(!active.has(key)){for(const mesh of record.meshes){scene.remove(mesh);mesh.geometry.dispose();}reachMeshes.delete(key);changed=true;}
    for(const [key,reach]of active){
      let record=reachMeshes.get(key);if(!record){record={meshes:[],capsules:[],made:new Set()};reachMeshes.set(key,record);}
      for(const [index,site] of ARCH_SITES.entries()){
        const id='arch:'+index;if(record.made.has(id))continue;
        const center=routePoint(site.t,reach),forward=routeTangent(site.t,reach),rotation=new T.Quaternion().setFromUnitVectors(V(0,0,1),forward);
        if(progressive&&Math.hypot(center.x-streamEye.x,center.z-streamEye.z)>landmarkDistance)continue;
        const endpoints=[-1,1].map(sign=>V(sign*site.width,0,0).multiplyScalar(reach.scale).applyQuaternion(rotation).add(center));
        const xs=[center.x,...endpoints.map(p=>p.x)],zs=[center.z,...endpoints.map(p=>p.z)];
        if(!readyBounds(Math.min(...xs)-LIGHT_MARGIN,Math.min(...zs)-LIGHT_MARGIN,Math.max(...xs)+LIGHT_MARGIN,Math.max(...zs)+LIGHT_MARGIN))continue;
        record.made.add(id);changed=true;center.y=heightAt(center.x,center.z)-8*reach.scale;const local=[];
        const feet=[1,-1].map(sign=>{const p=V(sign*site.width,0,0).multiplyScalar(reach.scale).applyQuaternion(rotation).add(center);return(heightAt(p.x,p.z)-center.y)/reach.scale-8;});
        for(let i=0;i<=32;i++){const a=i/32*Math.PI,foot=lerp(feet[0],feet[1],i/32)*Math.pow(Math.abs(Math.cos(a)),3);local.push(V(Math.cos(a)*site.width,Math.sin(a)*site.height+foot,Math.sin(a*3)*3));}
        const curve=new T.CatmullRomCurve3(local),geo=new T.TubeGeometry(curve,56,8,9,false);
        const p=geo.attributes.position;for(let i=0;i<p.count;i++){const ripple=1+Math.sin(p.getX(i)*.19+p.getY(i)*.27)*.016;p.setXYZ(i,p.getX(i)*ripple,p.getY(i)*ripple,p.getZ(i));}geo.computeVertexNormals();
        const arch=new T.Mesh(geo,material);arch.userData.arch=true;arch.position.copy(center);arch.quaternion.copy(rotation);arch.scale.setScalar(reach.scale);scene.add(arch);lightLandmark(arch);record.meshes.push(arch);
        for(let i=1;i<local.length;i++)record.capsules.push({a:local[i-1].clone().multiplyScalar(reach.scale).applyQuaternion(rotation).add(center),b:local[i].clone().multiplyScalar(reach.scale).applyQuaternion(rotation).add(center),radius:8.7*reach.scale,name:site.name});
      }
      // Stone needles are separate obstacles rooted in the eroded landscape;
      // they never add bumps or route patterns to the underlying heightfield.
      for(let index=0;index<NEEDLES.length;index++){
        const id='needle:'+index;if(record.made.has(id))continue;
        const site=NEEDLES[index],center=V(reach.x+(site.x*reach.cos-site.z*reach.sin)*reach.scale,0,reach.z+(site.x*reach.sin+site.z*reach.cos)*reach.scale),radius=site.radius*reach.scale,height=site.height*reach.scale*reach.needleScale;
        if(progressive&&Math.hypot(center.x-streamEye.x,center.z-streamEye.z)>landmarkDistance)continue;
        if(!readyBounds(center.x-LIGHT_MARGIN,center.z-LIGHT_MARGIN,center.x+LIGHT_MARGIN,center.z+LIGHT_MARGIN))continue;
        record.made.add(id);changed=true;center.y=heightAt(center.x,center.z)-radius*.75;
        const geo=new T.ConeGeometry(radius,height,7,5),p=geo.attributes.position;
        for(let i=0;i<p.count;i++){const rough=1+fieldNoise(p.getY(i)*.04,index*.7+11)*.10;p.setXYZ(i,p.getX(i)*rough,p.getY(i),p.getZ(i)*rough);}geo.computeVertexNormals();
        const needle=new T.Mesh(geo,material);needle.position.copy(center).add(V(0,height*.5,0));scene.add(needle);lightLandmark(needle);record.meshes.push(needle);
        for(let j=0;j<6;j++)record.capsules.push({a:center.clone().add(V(0,height*j/6,0)),b:center.clone().add(V(0,height*(j+1)/6,0)),radius:radius*(1-j/6)*1.05,name:'STONE NEEDLE'});
      }
    }
    for(const record of reachMeshes.values())for(const mesh of record.meshes){
      mesh.visible=Math.hypot(mesh.position.x-streamEye.x,mesh.position.z-streamEye.z)<(radius-1)*TILE;
      // Retained, hidden landmarks may lie outside the wrapping light field.
      // Refresh their probes on re-entry without overwriting visible terrain
      // with probes belonging to distant, currently hidden formations.
      if(mesh.visible){const b=mesh.userData.lightBounds;lightField.prepare(b.min.x,b.min.z,b.max.x,b.max.z);}
    }
    if(changed){revision++;obstacles.length=0;arches.length=0;for(const record of reachMeshes.values()){obstacles.push(...record.capsules);arches.push(...record.meshes.filter(mesh=>mesh.userData.arch));}}
  }
  function obstacleContact(position,radius=3){
    let closest=null;
    for(const capsule of obstacles){
      if(Math.abs(position.x-capsule.a.x)>210||Math.abs(position.z-capsule.a.z)>210)continue;
      const ab=capsule.b.clone().sub(capsule.a),u=clamp(position.clone().sub(capsule.a).dot(ab)/ab.lengthSq(),0,1),p=capsule.a.clone().addScaledVector(ab,u),delta=position.clone().sub(p),distance=delta.length()-capsule.radius;
      if(!closest||distance<closest.distance)closest={distance,normal:delta.lengthSq()>.001?delta.normalize():V(0,1,0),point:p,radius:capsule.radius,name:capsule.name};
    }
    return closest&&closest.distance<radius?closest:null;
  }
  return{
    mesh:group,arches,material,obstacles,tiles,batches,
    startPrefetch(){prefetchEnabled=true;prepareHeightfield(streamEye.x,streamEye.z,11000).catch(error=>console.error('Terrain preparation failed',error));},
    stats:()=>({revision,tiles:tiles.size,pending:pending.length,transitions:fading.size,batches:batches.size,sampleTiles:heightSamples.size,sampleMisses,sampleHits}),
    meshAt(x,z){const m=tile(Math.floor(x/TILE),Math.floor(z/TILE),48,true);m.updateWorldMatrix(true,false);return m;},
    obstacleContact,
    sweepObstacles(from,to,radius=3){
      const steps=Math.max(1,Math.ceil(from.distanceTo(to)/3));let safe=from.clone();
      for(let i=1;i<=steps;i++){
        const p=from.clone().lerp(to,i/steps),contact=obstacleContact(p,radius);
        if(contact){let a=safe,b=p;for(let j=0;j<6;j++){const m=a.clone().lerp(b,.5);if(obstacleContact(m,radius))b=m;else a=m;}return{...contact,position:a.addScaledVector(contact.normal,.3)};}
        safe=p;
      }
      return null;
    },
    occludesSun(eye,direction){
      // Quadratic spacing resolves close ridges; the rising sun ray clears the
      // mountain envelope at longer range. Stone capsules block it as well.
      for(let i=1;i<=96;i++){const distance=6000*(i/96)**2,p=eye.clone().addScaledVector(direction,distance);if(!readyBounds(p.x-STEP,p.z-STEP,p.x+STEP,p.z+STEP)||heightAt(p.x,p.z)>p.y)return true;}
      for(const c of obstacles){
        const ab=c.b.clone().sub(c.a),v=eye.clone().sub(c.a),ad=ab.dot(direction),av=ab.dot(v),dv=direction.dot(v),denom=ab.lengthSq()-ad*ad;
        const u=clamp(denom>1e-8?(av-ad*dv)/denom:0,0,1),point=c.a.clone().addScaledVector(ab,u),t=point.clone().sub(eye).dot(direction);
        if(t>0&&eye.clone().addScaledVector(direction,t).distanceToSquared(point)<c.radius*c.radius)return true;
      }
      return false;
    },
    proximity(position){let d=Infinity;for(const c of obstacles){if(Math.abs(position.x-c.a.x)>160||Math.abs(position.z-c.a.z)>160)continue;const ab=c.b.clone().sub(c.a),u=clamp(position.clone().sub(c.a).dot(ab)/ab.lengthSq(),0,1);d=Math.min(d,position.distanceTo(c.a.clone().addScaledVector(ab,u))-c.radius);}return d;},
    pulse:(pos,time)=>uniforms.uPulse.value.set(pos.x,pos.z,time),
    update(time,eye){uniforms.uTime.value=time;uniforms.uLodClock.value=performance.now()/1000;stream(eye);fillTiles();floor.position.x=eye.x;floor.position.z=eye.z;},
    regionAt(x,z){const near=corridorAt(x,z);return near.region.key!=='0:0'?near.region.name:near.path>=10?'THE CROSSWIND PASSAGES':near.distance<650?regionAt(near.t).name:'THE OUTER RIDGES';},
  };
}
export const createSky=createAtmosphere;

export function createCircuit(scene,initialRegion=worldRegion(0,0)){
  const gates=[],material=fogMaterial(new T.MeshBasicMaterial({color:0xe6efba,transparent:true,opacity:.95})),dim=fogMaterial(new T.MeshBasicMaterial({color:0x9dc49e,transparent:true,opacity:.18}));
  let courseIndex=0,course=COURSES[0],reach=initialRegion;
  function load(index,region=reach){
    reach=region;
    for(const group of gates){scene.remove(group);group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});}gates.length=0;
    courseIndex=((index%COURSES.length)+COURSES.length)%COURSES.length;course=COURSES[courseIndex];
    course.samples.forEach((t,i)=>{
      const p=routePoint(t,reach),direction=routeTangent(t,reach),arch=ARCH_SITES.find(site=>Math.abs(site.t-t)<.001);
      p.y=heightAt(p.x,p.z)+(arch?arch.height*.45:course.lift+(i?Math.sin(i*1.3)*15:0))*reach.scale;
      const group=new T.Group();group.position.copy(p);group.quaternion.setFromUnitVectors(V(0,0,1),direction);
      const pieces=[new T.TorusGeometry(28,1,6,60),new T.TorusGeometry(25.5,.18,4,60)];
      for(let k=0;k<4;k++){const a=k/4*Math.PI*2,g=new T.BoxGeometry(.8,5,.8);g.rotateZ(-a);g.translate(Math.sin(a)*32,Math.cos(a)*32,0);pieces.push(g);}
      group.add(new T.Mesh(mergeGeometry(pieces),i===0?material:dim));pieces.forEach(g=>g.dispose());
      group.userData={index:i,t,direction};scene.add(group);gates.push(group);
    });
    return course;
  }
  load(0);
  return{
    gates,load,get region(){return reach;},get course(){return course;},get index(){return courseIndex;},get count(){return gates.length;},
    spawn(){const gate=gates[0],position=routePoint(gate.userData.t-.014,reach);position.y=Math.max(gate.position.y,heightAt(position.x,position.z)+35);const direction=gate.position.clone().sub(position).normalize();return{position,yaw:Math.atan2(direction.x,direction.z),pitch:Math.asin(direction.y)};},
    activate(index){gates.forEach((g,i)=>g.traverse(o=>{if(o.isMesh)o.material=i===index?material:dim;}));},
    update(){},
  };
}
