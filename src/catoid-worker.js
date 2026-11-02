import {Catoid} from './catoid.js';
import {packCatoid,measureAtlas} from './catoid-transfer.js';
self.onmessage=({data:{id,genes}})=>{
  const model=new Catoid();
  try{model.rebuild(genes);model.atlasBounds=measureAtlas(model);const {data,transfers}=packCatoid(model);self.postMessage({id,model:data},transfers);}
  catch(error){self.postMessage({id,error:String(error)});}
  finally{model.dispose();}
};
