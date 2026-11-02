import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import {frameSteps,EmissionClock} from '../src/frame-timing.js';
import {pilotState,stepPilot} from '../src/flight.js';
import {GeometryBatch} from '../src/geometry-batch.js';
import {createTerrainNormalField} from '../src/terrain-light.js';
import {Catoid} from '../src/catoid.js';
import {packCatoid,unpackCatoid,measureAtlas} from '../src/catoid-transfer.js';
import {PRESETS} from '../src/genes.js';
const flat={heightAt:()=>0,sweepGround:(a,b)=>({hit:false,position:b.clone()}),proximity:()=>Infinity};
const input={steer:.3,pitch:.2,roll:0,boost:true,brake:false};const states=[];
for(const fps of [10,15,30,60,144]){
 const state=pilotState(new T.Vector3(0,2000,0)),emission=new EmissionClock();let seconds=0,particles=0;
 for(let frame=0;frame<fps*3;frame++){const tick=frameSteps(1/fps);for(let i=0;i<tick.count;i++){stepPilot(state,input,tick.dt,flat);particles+=emission.take(tick.dt,180);seconds+=tick.dt;}}
 assert(Math.abs(seconds-3)<1e-10);assert.equal(particles,540);states.push(state);
}
for(const state of states)assert(state.position.distanceTo(states[0].position)<1,'Slow frames must preserve elapsed flight time and path');
assert.equal(frameSteps(30).duration,.5,'A resumed tab must not run thirty seconds of catch-up');
const model=new Catoid();model.rebuild(PRESETS.corolla);model.atlasBounds=measureAtlas(model);const packed=packCatoid(model),copy=unpackCatoid(packed.data);
assert.equal(copy.eyeGroups.length,9);assert.equal(copy.growthItems.length,model.growthItems.length);
const positions=root=>{const arrays=[];root.traverse(o=>{if(o.isMesh)arrays.push([...o.geometry.attributes.position.array]);});return arrays;};assert.deepEqual(positions(copy.model),positions(model.model),'Worker transfer must preserve generated geometry exactly');
const material=new T.MeshBasicMaterial(),batch=new GeometryBatch(material),a=new T.PlaneGeometry(10,10,3,3),b=new T.PlaneGeometry(5,5,2,2);
const first=batch.add(a),second=batch.add(b);batch.flush();assert.equal(batch.geometry.drawRange.count,a.index.count+b.index.count);
batch.remove(first);batch.flush();assert.equal(batch.geometry.drawRange.count,b.index.count);for(let i=0;i<b.index.count;i++)assert.equal(batch.geometry.index.array[i],b.index.array[i]+second*batch.vertices);
// Negative coordinates and wrapping band halos must preserve the same slope.
// Streamed uploads must stay bounded instead of repeatedly copying a full map.
const field=createTerrainNormalField((x,z)=>x*.25+z*.125);field.prepare(-384,-384,0,0);
const texture=field.texture,{data,width,height,depth}=texture.image,expected=new T.Vector3(-.25,1,-.125).normalize();
assert(texture.isDataArrayTexture);assert(depth<=256);assert(texture.layerUpdates.size*width*height*4<=256*1024,'One tile must not upload the entire normal map');
for(const [layer,row,col]of [[0,0,0],[depth-1,height-1,0],[depth-1,height-2,width-1]]){
 const offset=((layer*height+row)*width+col)*4,n=new T.Vector3(data[offset]/255*2-1,data[offset+1]/255*2-1,data[offset+2]/255*2-1).normalize();assert(n.distanceTo(expected)<.008,'Normal field must remain continuous across band and world-wrap boundaries');
}
texture.dispose();
batch.dispose();material.dispose();a.dispose();b.dispose();model.dispose();copy.model.traverse(o=>{if(o.isMesh)o.geometry.dispose();});copy.materials.forEach(m=>m.dispose());
console.log(JSON.stringify({passed:true,frameRates:[10,15,30,60,144],preservedFlightTime:true,particlesPerSecond:180,workerGeometryEquivalent:true,batchRemoval:true}));
