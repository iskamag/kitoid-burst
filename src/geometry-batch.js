import * as T from '../vendor/three.module.js';
// Fixed vertex slots keep streamed updates local; the compact index list draws
// only occupied slots. Small spatial batches retain useful frustum culling and
// work on WebGL 2 without requiring a multi-draw extension.
export class GeometryBatch {
  constructor(material,{slots=32,vertices=400,indices=2400}={}){
    this.slots=slots;this.vertices=vertices;this.parts=new Map();this.free=Array.from({length:slots},(_,i)=>slots-1-i);
    this.geometry=new T.BufferGeometry();
    for(const [name,size] of [['position',3],['normal',3],['transition',2]])this.geometry.setAttribute(name,new T.BufferAttribute(new Float32Array(slots*vertices*size),size).setUsage(T.DynamicDrawUsage));
    this.geometry.setIndex(new T.BufferAttribute(new Uint32Array(slots*indices),1).setUsage(T.DynamicDrawUsage));
    this.geometry.setDrawRange(0,0);this.mesh=new T.Mesh(this.geometry,material);this.mesh.matrixAutoUpdate=false;
  }
  add(geometry){
    if(!this.free.length)throw Error('Terrain batch capacity exceeded');
    const slot=this.free.pop();this.parts.set(slot,geometry);this.write(slot,geometry);return slot;
  }
  write(slot,geometry){
    const count=geometry.attributes.position.count;if(count>this.vertices)throw Error('Terrain batch vertex capacity exceeded');
    this.parts.set(slot,geometry);
    for(const [name,target] of Object.entries(this.geometry.attributes)){
      const source=geometry.attributes[name],offset=slot*this.vertices*target.itemSize;
      if(source)target.array.set(source.array,offset);else target.array.fill(0,offset,offset+count*target.itemSize);
      target.addUpdateRange(offset,count*target.itemSize);target.needsUpdate=true;
    }
    this.dirty=true;
  }
  remove(slot){this.parts.delete(slot);this.free.push(slot);this.dirty=true;}
  flush(){
    if(!this.dirty)return;this.dirty=false;const index=this.geometry.index;let offset=0;const bounds=new T.Box3();
    for(const[slot,geo]of this.parts){const source=geo.index.array,base=slot*this.vertices;for(let i=0;i<source.length;i++)index.array[offset++]=source[i]+base;geo.computeBoundingBox();bounds.union(geo.boundingBox);}
    index.addUpdateRange(0,offset);index.needsUpdate=true;this.geometry.setDrawRange(0,offset);
    this.geometry.boundingBox=bounds;this.geometry.boundingSphere=bounds.getBoundingSphere(new T.Sphere());this.mesh.visible=offset>0;
  }
  dispose(){this.geometry.dispose();}
}
export function mergeGeometry(geometries){
  const result=new T.BufferGeometry(),positions=[],normals=[];
  for(const geometry of geometries){const g=geometry.index?geometry.toNonIndexed():geometry;for(const v of g.attributes.position.array)positions.push(v);for(const v of g.attributes.normal.array)normals.push(v);if(g!==geometry)g.dispose();}
  result.setAttribute('position',new T.Float32BufferAttribute(positions,3));result.setAttribute('normal',new T.Float32BufferAttribute(normals,3));return result;
}
