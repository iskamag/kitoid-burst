import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,resolve,sep} from 'node:path';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
const root=resolve(import.meta.dirname),compress=promisify(gzip),compressed=new Map();
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.ttf':'font/ttf'};
http.createServer(async(req,res)=>{
  try{
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
    if(!path.startsWith(root+sep)&&path!==root)throw Error('Invalid path');
    const file=path===root?resolve(root,'index.html'):path,info=await stat(file),extension=extname(file);
    const zipped=info.size>512&&['.html','.js','.css','.svg','.json'].includes(extension)&&/\bgzip\b/.test(req.headers['accept-encoding']||'');
    const etag=`W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}-${zipped?'gz':'raw'}"`;
    const immutable=/^assets\/terrain\/catoid-eroded-field-\d+\/-?\d+_-?\d+\.bin$/.test(file.slice(root.length+1));
    const headers={'Content-Type':types[extension]||'application/octet-stream','Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache','ETag':etag,'Vary':'Accept-Encoding'};
    if(req.headers['if-none-match']===etag){res.writeHead(304,headers);res.end();return;}
    let data;
    if(zipped){
      const key=file+etag;
      if(!compressed.has(key)){if(compressed.size>=64)compressed.clear();const promise=readFile(file).then(bytes=>compress(bytes));compressed.set(key,promise);promise.catch(()=>compressed.delete(key));}
      data=await compressed.get(key);headers['Content-Encoding']='gzip';
    }else data=await readFile(file);
    headers['Content-Length']=data.length;res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
  }catch{if(!res.headersSent)res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.PORT||4173),'0.0.0.0',()=>console.log('Kitoid Burst — http://localhost:'+(process.env.PORT||4173)));
