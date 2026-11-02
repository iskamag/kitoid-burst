import * as T from '../vendor/three.module.js';
export function packCatoid(model){
  const nodes=[],ids=new Map(),geometries=[],geometryIds=new Map(),transfers=[];
  model.model.traverse(o=>{ids.set(o,nodes.length);nodes.push(o);});
  const tree=nodes.map(o=>{
    let geometry;
    if(o.isMesh){
      if(!geometryIds.has(o.geometry)){
        geometryIds.set(o.geometry,geometries.length);const attributes={};
        for(const[name,a]of Object.entries(o.geometry.attributes)){const array=a.array.slice();attributes[name]={array,size:a.itemSize};transfers.push(array.buffer);}
        const index=o.geometry.index?.array.slice();if(index)transfers.push(index.buffer);geometries.push({attributes,index});
      }
      geometry=geometryIds.get(o.geometry);
    }
    return{parent:ids.get(o.parent),position:o.position.toArray(),quaternion:o.quaternion.toArray(),scale:o.scale.toArray(),name:o.name,userData:o.userData,geometry,material:o.isMesh?model.materials.indexOf(o.material):undefined};
  });
  const ref=({group,anchor,...rest})=>({...rest,group:ids.get(group),...(anchor?{anchor:anchor.toArray()}:{})});
  return{data:{tree,geometries,materials:model.materials.map(m=>m.toJSON()),growthItems:model.growthItems.map(ref),joints:model.joints.map(ref),eyes:model.eyeGroups.map(({group,organ,base,...rest})=>({...rest,group:ids.get(group),organ:ids.get(organ),base:base.toArray()})),length:model.length,counts:model.counts,center:model.center.toArray(),viewRadius:model.viewRadius,segments:model.phenotype.axes[0].segments,atlas:model.atlasBounds},transfers};
}
export function unpackCatoid(data){
  const loader=new T.MaterialLoader(),materials=data.materials.map(m=>loader.parse(m));
  const geometries=data.geometries.map(({attributes,index})=>{const g=new T.BufferGeometry();for(const[name,{array,size}]of Object.entries(attributes))g.setAttribute(name,new T.BufferAttribute(array,size));if(index)g.setIndex(new T.BufferAttribute(index,1));return g;});
  const nodes=data.tree.map(n=>{const o=n.geometry===undefined?new T.Group():new T.Mesh(geometries[n.geometry],materials[n.material]);o.position.fromArray(n.position);o.quaternion.fromArray(n.quaternion);o.scale.fromArray(n.scale);o.name=n.name;o.userData=n.userData;return o;});
  data.tree.forEach((n,i)=>{if(n.parent!==undefined)nodes[n.parent].add(nodes[i]);});
  const ref=({group,anchor,...rest})=>({...rest,group:nodes[group],...(anchor?{anchor:new T.Vector3().fromArray(anchor)}:{})});
  return{model:nodes[0],materials,growthItems:data.growthItems.map(ref),joints:data.joints.map(ref),eyeGroups:data.eyes.map(({group,organ,base,...rest})=>({...rest,group:nodes[group],organ:nodes[organ],base:new T.Quaternion().fromArray(base)}))};
}
export function measureAtlas(model){
  model.animate(1.5,0,0,0,1);model.root.updateMatrixWorld(true);
  const center=model.center,r=model.viewRadius,camera=new T.OrthographicCamera(-4,4,3.25,-3.25,.1,1000);
  camera.position.copy(center).add(new T.Vector3(r,r*.45,r*2.8));camera.lookAt(center);camera.updateMatrixWorld(true);
  const bounds=new T.Box3(),point=new T.Vector3();
  model.root.traverse(o=>{if(o.isMesh){const transform=new T.Matrix4().multiplyMatrices(camera.matrixWorldInverse,o.matrixWorld),positions=o.geometry.attributes.position;for(let i=0;i<positions.count;i++)bounds.expandByPoint(point.fromBufferAttribute(positions,i).applyMatrix4(transform));}});
  return{min:bounds.min.toArray(),max:bounds.max.toArray()};
}
