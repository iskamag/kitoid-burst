let worker,nextId=0;const jobs=new Map();
export function buildCatoid(genes){
  if(!worker){
    worker=new Worker(new URL('./catoid-worker.js',import.meta.url),{type:'module'});
    worker.onmessage=({data})=>{const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve(data.model);};
    worker.onerror=event=>{for(const job of jobs.values())job.reject(new Error(event.message));jobs.clear();worker.terminate();worker=null;};
  }
  const id=++nextId;return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject});worker.postMessage({id,genes});});
}
