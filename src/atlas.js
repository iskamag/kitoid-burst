import * as T from '../vendor/three.module.js';
import {Catoid} from './catoid.js';
import {spawnGenes} from './genes.js';
import {atmosphereUniforms} from './atmosphere.js';

// Thumbnails use the production generator and the same lighting for every seed.
// They are rendered once, rather than keeping eight animated WebGL worlds alive.
export class SeedAtlas {
  constructor(onSelect,onClose){
    this.panel=document.getElementById('atlas');this.grid=document.getElementById('atlas-grid');
    this.onSelect=onSelect;this.onClose=onClose;this.epoch=0;this.entries=[];this.urls=[];
    document.getElementById('close-atlas').onclick=()=>this.close();
    document.getElementById('more-seeds').onclick=()=>this.populate();
  }
  open(current){this.current=current;this.panel.classList.remove('hidden');document.getElementById('close-atlas').focus();return this.populate(true);}
  close(){this.epoch++;this.panel.classList.add('hidden');this.onClose?.();}
  get visible(){return !this.panel.classList.contains('hidden');}
  setup(){
    if(this.renderer)return;
    this.renderer=new T.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:false});
    this.renderer.setSize(320,260);this.renderer.setPixelRatio(1);this.renderer.setClearColor(0x000000,0);
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
    this.scene=new T.Scene();this.scene.add(new T.HemisphereLight(0xe2ebf3,0x354039,2.4));
    const key=new T.DirectionalLight(0xffe1b0,3);key.position.set(-10,14,16);this.scene.add(key);
    const rim=new T.DirectionalLight(0x8ebddd,2);rim.position.set(10,4,-10);this.scene.add(rim);
    this.camera=new T.OrthographicCamera(-4,4,3.25,-3.25,.1,1000);
  }
  async populate(includeCurrent=false){
    const epoch=++this.epoch;
    while(this.busy)await new Promise(requestAnimationFrame);
    if(epoch!==this.epoch)return;
    this.busy=true;this.setup();this.grid.replaceChildren();this.urls.forEach(URL.revokeObjectURL);this.urls=[];
    const base=includeCurrent?11:Math.floor(Math.random()*900000);
    this.entries=Array.from({length:8},(_,i)=>{
      const seed=includeCurrent&&i===0?this.current.seed:(base+i*104729)%1000000;
      const genes=includeCurrent&&i===0?{...this.current.genes}:spawnGenes(seed);
      return {seed,genes,current:includeCurrent&&i===0};
    });
    const cards=this.entries.map(entry=>{
      const card=document.createElement('button');card.className='specimen-card';card.disabled=true;card.dataset.seed=entry.seed;
      const preview=document.createElement('img');preview.alt='Generated kitoid, seed '+entry.seed;
      const caption=document.createElement('span');caption.className='specimen-caption';caption.textContent=(entry.current?'CURRENT · ':'SEED ')+entry.seed;
      const traits=document.createElement('small');traits.textContent='GROWING…';card.append(preview,caption,traits);
      card.onclick=()=>{this.onSelect(entry.seed,{...entry.genes});this.close();};this.grid.append(card);return {card,preview,traits};
    });
    const model=new Catoid();this.scene.add(model.root);
    try{
      for(let i=0;i<this.entries.length;i++){
        if(epoch!==this.epoch)break;
        const entry=this.entries[i];await model.rebuildAsync(entry.genes);if(epoch!==this.epoch)break;model.animate(1.5,0,0,0,1);
        const center=model.center.clone(),r=model.viewRadius;
        this.camera.position.copy(center).add(new T.Vector3(r,r*.45,r*2.8));this.camera.lookAt(center);this.camera.updateMatrixWorld(true);
        model.root.updateWorldMatrix(true,true);
        const viewBounds={min:new T.Vector3().fromArray(model.atlasBounds.min),max:new T.Vector3().fromArray(model.atlasBounds.max)};
        const width=Math.max(viewBounds.max.x-viewBounds.min.x,(viewBounds.max.y-viewBounds.min.y)*320/260)*1.18,height=width*260/320;
        const cx=(viewBounds.min.x+viewBounds.max.x)/2,cy=(viewBounds.min.y+viewBounds.max.y)/2;
        this.camera.left=cx-width/2;this.camera.right=cx+width/2;this.camera.top=cy+height/2;this.camera.bottom=cy-height/2;this.camera.updateProjectionMatrix();
        const haze=atmosphereUniforms.uHaze.value;atmosphereUniforms.uHaze.value=0;
        let encoded;
        try{this.renderer.render(this.scene,this.camera);encoded=new Promise(resolve=>this.renderer.domElement.toBlob(resolve,'image/png'));}
        finally{atmosphereUniforms.uHaze.value=haze;}
        const blob=await encoded;if(epoch!==this.epoch)break;if(!blob)throw Error('Could not encode specimen preview');
        const url=URL.createObjectURL(blob);this.urls.push(url);cards[i].preview.src=url;
        const c=model.counts;cards[i].traits.textContent=`${c.axes} ${c.axes===1?'AXIS':'AXES'} · ${c.limbs} BUDS · 9 EYES`;
        cards[i].card.disabled=false;entry.counts={...c};
        await new Promise(requestAnimationFrame);
      }
    }finally{this.scene.remove(model.root);model.dispose();this.busy=false;}
  }
}
