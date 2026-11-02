import * as T from '../vendor/three.module.js';
import {erodedHeightAt} from './heightfield.js';
import {SUN_DIRECTION} from './atmosphere.js';
const GRID=64,SIZE=256,cache=new Map();
export const LIGHT_MARGIN=896;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function probe(ix,iz){
  const key=ix+':'+iz;let p=cache.get(key);if(p)return p;
  const x=ix*GRID,z=iz*GRID,h=erodedHeightAt(x,z),near=[erodedHeightAt(x-GRID,z),erodedHeightAt(x+GRID,z),erodedHeightAt(x,z-GRID),erodedHeightAt(x,z+GRID)];
  const ambient=clamp(1-Math.max(0,near.reduce((a,b)=>a+b,0)/4-h)*.006,.66,1);
  let horizon=-Infinity;
  for(const d of [40,96,192,384,768])horizon=Math.max(horizon,erodedHeightAt(x+SUN_DIRECTION.x*d,z+SUN_DIRECTION.z*d)-SUN_DIRECTION.y*d);
  p={h,ambient,horizon};cache.set(key,p);return p;
}
// A toroidal world-space field covers 16 km, wider than the visible terrain.
// Store the horizon height, not the shadow evaluated at a mesh vertex: its
// nonlinear height comparison belongs in the fragment shader.
export function createTerrainLightField(){
  const data=new Uint16Array(SIZE*SIZE*4),resident=new Array(SIZE*SIZE),half=T.DataUtils.toHalfFloat;
  for(let i=0;i<data.length;i+=4){data[i]=half(1);data[i+1]=data[i+2]=half(-65504);}
  const texture=new T.DataTexture(data,SIZE,SIZE,T.RGBAFormat,T.HalfFloatType);
  texture.wrapS=texture.wrapT=T.RepeatWrapping;
  // Filterable half floats need one texture read per fragment on WebGL 2.
  texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
  return{texture,
    prepare(x0,z0,x1,z1){
      let changed=false;
      for(let iz=Math.floor(z0/GRID);iz<=Math.floor(z1/GRID)+1;iz++)for(let ix=Math.floor(x0/GRID);ix<=Math.floor(x1/GRID)+1;ix++){
        const slot=((iz%SIZE+SIZE)%SIZE)*SIZE+(ix%SIZE+SIZE)%SIZE,key=ix+':'+iz;
        if(resident[slot]===key)continue;
        const p=probe(ix,iz),offset=slot*4;resident[slot]=key;
        data[offset]=half(p.ambient);data[offset+1]=half(p.horizon);data[offset+2]=half(p.h);data[offset+3]=half(1);changed=true;
      }
      if(changed)texture.needsUpdate=true;
    },
  };
}
export const TERRAIN_LIGHT_GLSL=`
  uniform sampler2D uTerrainLight;
  vec2 terrainLighting(vec3 position,float contact){
    vec3 p=texture2D(uTerrainLight,(position.xz/${GRID}.+.5)/${SIZE}.).xyz;
    float ambient=p.x*mix(1.,.72+.28*clamp((position.y-p.z)/25.,0.,1.),contact);
    return vec2(ambient,1.-.72*smoothstep(2.,20.,p.y-position.y));
  }
`;
const NORMAL_SIZE=1024,NORMAL_STEP=16,NORMAL_ROWS=4,NORMAL_LAYERS=NORMAL_SIZE/NORMAL_ROWS;
export function createTerrainNormalField(heightAt){
  // Short horizontal bands bound each GPU upload to 20 KiB. A duplicated
  // boundary row preserves linear filtering between bands; 256 layers fit
  // WebGL 2's minimum limit. Uploading rows from one large buffer makes some
  // browser drivers copy the entire buffer for each row.
  const rows=NORMAL_ROWS+1,data=new Uint8Array(NORMAL_SIZE*rows*NORMAL_LAYERS*4);
  const texture=new T.DataArrayTexture(data,NORMAL_SIZE,rows,NORMAL_LAYERS);
  texture.wrapS=T.RepeatWrapping;
  texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
  return{texture,
    prepare(x0,z0,x1,z1){
      for(let iz=Math.floor(z0/NORMAL_STEP);iz<=Math.floor(z1/NORMAL_STEP)+1;iz++){
        const row=(iz%NORMAL_SIZE+NORMAL_SIZE)%NORMAL_SIZE,layer=Math.floor(row/NORMAL_ROWS),local=row%NORMAL_ROWS;
        const first=Math.floor(x0/NORMAL_STEP),last=Math.floor(x1/NORMAL_STEP)+1;
        for(let ix=first;ix<=last;ix++){
          const x=ix*NORMAL_STEP,z=iz*NORMAL_STEP;
          const nx=heightAt(x-8,z)-heightAt(x+8,z),ny=16,nz=heightAt(x,z-8)-heightAt(x,z+8),length=Math.hypot(nx,ny,nz);
          const col=(ix%NORMAL_SIZE+NORMAL_SIZE)%NORMAL_SIZE,offset=((layer*rows+local)*NORMAL_SIZE+col)*4;
          data[offset]=Math.round((nx/length*.5+.5)*255);data[offset+1]=Math.round((ny/length*.5+.5)*255);data[offset+2]=Math.round((nz/length*.5+.5)*255);data[offset+3]=255;
          if(local===0){const previous=(layer+NORMAL_LAYERS-1)%NORMAL_LAYERS,edge=((previous*rows+NORMAL_ROWS)*NORMAL_SIZE+col)*4;data.set(data.subarray(offset,offset+4),edge);}
        }
        texture.addLayerUpdate(layer);
        if(local===0)texture.addLayerUpdate((layer+NORMAL_LAYERS-1)%NORMAL_LAYERS);
      }
      texture.needsUpdate=true;
    },
  };
}
export const TERRAIN_NORMAL_GLSL=`
  uniform highp sampler2DArray uTerrainNormal;
  vec3 terrainNormal(vec2 position){
    vec2 grid=mod(position/${NORMAL_STEP}.,${NORMAL_SIZE}.);
    vec3 uv=vec3((grid.x+.5)/${NORMAL_SIZE}.,(mod(grid.y,${NORMAL_ROWS}.)+.5)/${NORMAL_ROWS+1}.,floor(grid.y/${NORMAL_ROWS}.));
    return normalize(texture(uTerrainNormal,uv).xyz*2.-1.);
  }
`;
export function pruneLighting(x,z,radius){for(const key of cache.keys()){const[ix,iz]=key.split(':').map(Number);if(Math.abs(ix*GRID-x)>radius||Math.abs(iz*GRID-z)>radius)cache.delete(key);}}
