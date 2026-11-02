import {cp,mkdir,readFile,readdir,rm,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {BAKED_REVISION,BAKED_KEYS} from '../src/heightfield-cache.js';

const root=new URL('../',import.meta.url),out=new URL('dist/',root);
await rm(out,{recursive:true,force:true});
await mkdir(out,{recursive:true});
// Explicit runtime inputs keep test captures, local configuration, and obsolete
// terrain bakes out of public deployments. All URLs stay relative to the game.
for(const name of ['index.html','style.css','fonts.css','LICENSE','src','vendor'])await cp(new URL(name,root),new URL(name,out),{recursive:true});
await cp(new URL('docs/preview.jpg',root),new URL('preview.jpg',out));
const terrain=new URL(`assets/terrain/${BAKED_REVISION}/`,out);await mkdir(terrain,{recursive:true});
for(const key of BAKED_KEYS){
  const name=key.replace(':','_')+'.bin';
  await cp(new URL(`assets/terrain/${BAKED_REVISION}/${name}`,root),new URL(name,terrain));
}
const count=async directory=>{let files=0,bytes=0;for(const entry of await readdir(directory,{withFileTypes:true})){const path=new URL(entry.name,directory);if(entry.isDirectory()){const child=await count(new URL(entry.name+'/',directory));files+=child.files;bytes+=child.bytes;}else{files++;bytes+=(await stat(path)).size;}}return{files,bytes};};
const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
console.log(JSON.stringify({name:pkg.name,directory:fileURLToPath(out),...await count(out)}));
