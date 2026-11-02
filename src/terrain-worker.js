import {generateFieldPatch,EROSION_REVISION} from './heightfield.js';
const database=new Promise(resolve=>{const request=indexedDB.open(EROSION_REVISION,1);request.onupgradeneeded=()=>request.result.createObjectStore('patches');request.onsuccess=()=>resolve(request.result);request.onerror=()=>resolve(null);});
self.onmessage=async({data:{id,px,pz}})=>{
  try{
    const db=await database,key=px+':'+pz,cached=db?await new Promise(resolve=>{const r=db.transaction('patches').objectStore('patches').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>resolve(null);}):null;
    const field=cached?new Float32Array(cached):generateFieldPatch(px,pz);
    if(db&&!cached)await new Promise(resolve=>{const tx=db.transaction('patches','readwrite');tx.objectStore('patches').put(field.buffer,key);tx.oncomplete=tx.onerror=()=>resolve();});
    self.postMessage({id,px,pz,buffer:field.buffer},[field.buffer]);
  }
  catch(error){self.postMessage({id,error:String(error)});}
};
