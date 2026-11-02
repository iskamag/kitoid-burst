import * as T from '../vendor/three.module.js';
import { develop,axisFrame,terminalPoint } from './development.js';
import { fogMaterial } from './atmosphere.js';
import {buildCatoid} from './catoid-build.js';
import {unpackCatoid,measureAtlas} from './catoid-transfer.js';
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const sphere=new T.SphereGeometry(1,16,12);
const smooth=(a,b,t)=>T.MathUtils.smoothstep(t,a,b);

// Bake rigid tissues per organ and material, keeping the render cost bounded as
// branch counts change. Joints, eyes and growth anchors remain independent.
function bake(group){
  group.updateWorldMatrix(true,true);const batches=new Map(),inverse=group.matrixWorld.clone().invert();
  group.traverse(o=>{if(o.isMesh){let batch=batches.get(o.material);if(!batch){batch={positions:[],normals:[]};batches.set(o.material,batch);}const geo=o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone();geo.applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld));batch.positions.push(...geo.attributes.position.array);batch.normals.push(...geo.attributes.normal.array);geo.dispose();if(o.geometry!==sphere)o.geometry.dispose();}});
  group.clear();
  for(const [material,batch] of batches){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(batch.positions,3));geo.setAttribute('normal',new T.Float32BufferAttribute(batch.normals,3));group.add(new T.Mesh(geo,material));}
}

function sweep(curve,radius,vertical=1,segments=40,sides=14,twist=0){
  const points=[],indices=[];
  for(let i=0;i<=segments;i++){
    const t=i/segments,p=curve.getPoint(t),r=typeof radius==='function'?radius(t):radius*(1-t*.78);
    const forward=curve.getTangent(t).normalize(),side=V(0,1,0).cross(forward).normalize();
    if(side.lengthSq()<.1)side.set(1,0,0);
    const up=forward.clone().cross(side).normalize();side.applyAxisAngle(forward,twist*(t-.5));up.applyAxisAngle(forward,twist*(t-.5));
    for(let j=0;j<=sides;j++){
      const a=j/sides*Math.PI*2,offset=side.clone().multiplyScalar(Math.cos(a)*r).addScaledVector(up,Math.sin(a)*r*vertical);
      points.push(...p.clone().add(offset).toArray());
      if(i<segments&&j<sides){const k=i*(sides+1)+j;indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);}
    }
  }
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(points,3));geo.setIndex(indices);geo.computeVertexNormals();return geo;
}

function terminalGeometry(g,size){
  const positions=[],indices=[],latitude=28,longitude=48;
  for(let i=0;i<=latitude;i++)for(let j=0;j<=longitude;j++){
    positions.push(...terminalPoint(g,i/latitude*Math.PI,j/longitude*Math.PI*2).multiplyScalar(size).toArray());
    if(i<latitude&&j<longitude){const k=i*(longitude+1)+j;indices.push(k,k+longitude+1,k+1,k+1,k+longitude+1,k+longitude+2);}
  }
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();return geo;
}

function configureSkin(skin,g,segments,uniforms){
    skin.onBeforeCompile=shader=>{
      shader.uniforms.uLife=uniforms.uLife;
      shader.uniforms.uCompliance={value:g.elasticity};
      shader.uniforms.uCoupling={value:g.phaseCoupling};
      shader.uniforms.uField={value:new T.Vector4(2.5+g.pigmentActivator*8,1+g.pigmentInhibitor*7,g.pigmentDiffusion*5,g.pigmentThreshold)};
      shader.uniforms.uSegment={value:segments*.6};
      shader.vertexShader='varying vec3 vTissue;uniform float uLife;uniform float uCompliance;uniform float uCoupling;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTissue=position;\ntransformed.x+=sin(uLife*1.6+position.z*(1.2-uCoupling))*.055*uCompliance;\ntransformed.y+=sin(uLife*1.9+position.x)*.025*uCompliance;');
      shader.fragmentShader='varying vec3 vTissue;uniform vec4 uField;uniform float uSegment;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        float activator=sin(vTissue.z*uField.x+sin(vTissue.x*2.+vTissue.y)*uField.z);
        float inhibitor=cos(vTissue.x*uField.y+sin(vTissue.y*3.-vTissue.z)*uField.z);
        float domain=activator-inhibitor*.65+sin(vTissue.z*uSegment)*.24;
        float pigment=smoothstep(uField.w-.25,uField.w+.15,domain);
        diffuseColor.rgb*=mix(.37,1.,pigment);
      `);
    };
    skin.customProgramCacheKey=()=>'regulatory-skin-v2';
}

export class Catoid {
  constructor(){
    this.root=new T.Group();this.breath=new T.Group();this.model=new T.Group();this.root.add(this.breath);this.breath.add(this.model);
    this.materials=[];this.eyeGroups=[];this.joints=[];this.growthItems=[];this.rebuilds=0;
    this.uniforms={uLife:{value:0},uFlex:{value:.5}};
  }
  cancelBuild(){this.buildRevision=(this.buildRevision||0)+1;}
  async rebuildAsync(g){
    const revision=(this.buildRevision||0)+1;this.buildRevision=revision;
    if(typeof Worker==='undefined'){this.rebuild(g);this.atlasBounds=measureAtlas(this);return true;}
    const data=await buildCatoid(g);if(revision!==this.buildRevision)return false;
    const prepared=unpackCatoid(data);this.dispose();this.breath.remove(this.model);Object.assign(this,prepared);this.breath.add(this.model);
    this.genes={...g};this.length=data.length;this.counts=data.counts;this.center=new T.Vector3().fromArray(data.center);this.viewRadius=data.viewRadius;this.atlasBounds=data.atlas;
    this.glow=this.materials[3];this.iris=this.materials[4];configureSkin(this.materials[0],g,data.segments,this.uniforms);this.materials.forEach(fogMaterial);this.rebuilds++;
    return true;
  }
  rebuild(g){
    this.cancelBuild();this.genes={...g};
    this.model.traverse(o=>{if(o.isMesh&&o.geometry!==sphere)o.geometry.dispose();});this.model.clear();this.materials.forEach(m=>m.dispose());
    this.materials=[];this.eyeGroups=[];this.joints=[];this.growthItems=[];
    const d=this.phenotype=develop(g);this.length=d.length;this.counts=d.counts;
    const mat=options=>{const m=new T.MeshStandardMaterial(options);this.materials.push(m);return m;};
    const color=new T.Color().setHSL(g.pigmentHue,.12+g.pigmentChroma*.7,.58-g.resourceBias*.14);
    const skin=mat({color,roughness:.72-g.dermalGrowth*.35,metalness:.04+g.dermalGrowth*.25});
    configureSkin(skin,g,d.axes[0].segments,this.uniforms);
    const dark=mat({color:new T.Color().setHSL((g.pigmentHue+.05)%1,.4,.11),roughness:.54});
    const plate=mat({color:new T.Color().setHSL((g.pigmentHue+.045)%1,.18,.58),roughness:.36,metalness:.3});
    this.glow=mat({color:0xdfefa8,emissive:new T.Color().setHSL((g.pigmentHue+.1)%1,.5,.34),emissiveIntensity:1.2,roughness:.3});
    this.iris=mat({color:new T.Color().setHSL(g.retinalPigment,.7,.6),emissive:new T.Color().setHSL(g.retinalPigment,.7,.27),emissiveIntensity:1.5,roughness:.22,metalness:.25});
    const membrane=mat({color:new T.Color().setHSL((g.pigmentHue+.055)%1,.3+g.pigmentChroma*.3,.49),emissive:color.clone().multiplyScalar(.16),transparent:true,opacity:.38+g.webbing*.23,side:T.DoubleSide,depthWrite:false,roughness:.8});
    const mesh=(geo,m,p=V(),s=null,parent=this.model)=>{const o=new T.Mesh(geo,m);o.position.copy(p);if(s)o.scale.copy(s);parent.add(o);return o;};
    const ball=(p,s,m=skin,parent=this.model)=>mesh(sphere,m,p,s,parent);
    const tube=(points,r,m=skin,parent=this.model)=>mesh(sweep(new T.CatmullRomCurve3(points),r,1,18,8),m,V(),null,parent);
    const bud=(position,birth,kind)=>{const group=new T.Group();this.model.add(group);this.growthItems.push({group,birth,kind,anchor:position.clone()});return group;};
    const rigid=new T.Group();this.model.add(rigid);
    for(const axis of d.axes){
      const group=bud(V(),axis.birth,'axis');
      mesh(sweep(axis.curve,axis.width,d.tissue.vertical,56,20,axis.twist),skin,V(),null,group);
      for(let i=1;i<axis.segments;i++){
        const t=i/axis.segments,f=axisFrame(axis,t),r=axis.width(t);
        if(g.dermalGrowth>.62){
          const p=f.p.clone().addScaledVector(f.up,r*.65);
          const lobe=ball(p,V(r*.88,r*(.1+g.dermalGrowth*.32),.12+g.dermalGrowth*.2),plate,group);lobe.quaternion.setFromUnitVectors(V(0,0,1),f.forward);
        }
        if(g.photophoreInduction>.58&&Math.sin(i*2.1)+g.photophoreInduction*2>1.3){
          for(const sign of [-1,1])ball(f.p.clone().addScaledVector(f.side,sign*r*.87).addScaledVector(f.up,r*.28),V(.07,.07,.13).multiplyScalar(.65+g.photophoreInduction),this.glow,group);
        }
      }
      bake(group);
    }

    // Tissue retention changes these organizers from solid growth envelopes to
    // shells and open folded loops. All are products of the same field.
    for(const node of d.nodes){
      const group=bud(node.p,node.birth,'node'),s=node.size;
      const lobes=2+Math.floor(g.terminalInduction*4),radius=(.46+g.organizerStrength*.5)*s;
      if(node===d.nodes[0]||g.fieldFusion>.28)mesh(terminalGeometry(g,s),skin,V(),null,group);
      for(let lobe=0;lobe<(g.fieldFusion<.58?lobes:0);lobe++){
        const phase=lobe/lobes*Math.PI*2,points=[];
        const coverage=.55+g.fieldFusion*.44;
        for(let i=0;i<=28;i++){
          const t=i/28,a=t*Math.PI*2*coverage+phase;
          const r=radius*(1+.19*Math.cos(a*3+g.crestActivation*4));
          points.push(V(Math.cos(a)*r,Math.sin(a)*r*(.75+g.crestActivation*.4),
            Math.sin(a*2+phase)*g.terminalCurl*.35*s+(lobe-(lobes-1)/2)*.13*s));
        }
        tube(points,.045*s+(1-g.budCompetition)*.025,plate,group);
        const end=points.at(-1),root=points[0];
        tube([V(0,0,-.3*s),root.clone().multiplyScalar(.5),root],.085*s,skin,group);
        if(g.terminalBranching>.35){
          for(const sign of [-1,1])tube([end,end.clone().add(V(sign*.15*s,.12*s,.2*s)),end.clone().add(V(sign*.3*s,.25*s,.45*s))],.03*s,this.glow,group);
        }
        if(g.fieldFusion>.2){
          const positions=[];
          for(let i=1;i<points.length;i++){
            const a=points[i-1],b=points[i],inner=a.clone().multiplyScalar(.55+g.budCompetition*.25).add(V(0,0,-.13*s));
            positions.push(...a.toArray(),...b.toArray(),...inner.toArray());
          }
          const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.computeVertexNormals();mesh(geo,membrane,V(),null,group);
        }
      }
      const filaments=g.antennaInduction>.5||g.fieldFusion<.45?2+Math.floor(g.antennaInduction*5):0;
      for(let i=0;i<filaments;i++){
        const a=i/filaments*Math.PI*2,root=V(Math.cos(a)*radius*.6,Math.sin(a)*radius*.6,-.08);
        const end=root.clone().add(V(Math.cos(a)*g.antennaInduction,Math.sin(a)*g.antennaInduction,.65+g.ridgeInduction*1.5));
        const mid=root.clone().lerp(end,.55).add(V(0,.15*g.terminalCurl,0));
        tube([root,mid,end],.018*s,this.glow,group);
        if(g.antennaBranching>.4)tube([mid,end.clone().add(V(Math.sin(a)*.2,-Math.cos(a)*.2,.15)),end.clone().add(V(Math.sin(a)*.4,-Math.cos(a)*.4,.3))],.011*s,plate,group);
      }
      bake(group);group.position.copy(node.p);group.quaternion.setFromUnitVectors(V(0,0,1),node.direction);this.joints.push({group,kind:'node',phase:d.nodes.indexOf(node)});
    }

    for(const limb of d.limbs){
      const group=bud(limb.anchor,limb.birth,'limb'),local=p=>p.clone().sub(limb.anchor),a=V(),j=local(limb.joint),tip=local(limb.tip),r=(.055+d.radius*(.1+g.fieldFusion*.18))*limb.scale;
      tube([a,j.clone().multiplyScalar(.5).add(V(0,.12,0)),j,tip],r,skin,group);
      if(g.fieldFusion>.4)ball(tip,V(r*(1.2+g.terminalInduction),r*.8,r*(1.5+g.distalGrowth)),skin,group);
      const tips=limb.digits.map(local);
      for(let i=0;i<tips.length;i++){
        const end=tips[i];tube([tip,tip.clone().lerp(end,.6).add(V(0,.12*limb.scale,0)),end],r*.48,plate,group);
        if(g.digitBranching>.48){const branch=end.clone().lerp(tip,.22);tube([branch,end.clone().add(V(.1*limb.sign,.18,0)),end.clone().add(V(.22*limb.sign,.26,-.1))],r*.23,skin,group);}
        if(i&&g.webbing>.08){
          const a=tips[i-1].clone().lerp(tip,1-g.webbing),b=end.clone().lerp(tip,1-g.webbing),mid=tip.clone().add(a).add(b).multiplyScalar(1/3).add(V(0,-g.elasticity*.3*limb.scale,0));
          const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([...tip.toArray(),...a.toArray(),...mid.toArray(),...a.toArray(),...b.toArray(),...mid.toArray(),...b.toArray(),...tip.toArray(),...mid.toArray()],3));geo.computeVertexNormals();mesh(geo,membrane,V(),null,group);
          tube([a,mid.clone().lerp(a,.3),b],.012*limb.scale,this.glow,group);
        }
        if(g.photophoreInduction>.65)ball(end,V(.04,.04,.06).multiplyScalar(limb.scale),this.glow,group);
      }
      bake(group);group.position.copy(limb.anchor);this.joints.push({group,kind:'limb',phase:limb.phase,sign:limb.sign,depth:limb.depth});
    }

    const tailAnchor=d.axes[0].curve.getPoint(0),tailGroup=bud(tailAnchor,.27,'tail');
    for(const tail of d.tails){
      const curve=new T.CatmullRomCurve3(tail.curve.points.map(p=>p.clone().sub(tailAnchor)));
      mesh(sweep(curve,tail.radius,1,28,10),skin,V(),null,tailGroup);
      if(g.terminalBud>.58){const p=curve.getPoint(1);ball(p,V(.035+g.terminalBud*.07,.05+g.terminalBud*.12,.035+g.terminalBud*.07).multiplyScalar(1-tail.depth*.2),g.photophoreInduction>.5?this.glow:skin,tailGroup);}
    }
    bake(tailGroup);tailGroup.position.copy(tailAnchor);this.joints.push({group:tailGroup,kind:'tail',phase:g.caudalWave*4});
    for(const spine of d.spines){
      const tip=spine.p.clone().addScaledVector(spine.direction,spine.size);
      tube([spine.p,spine.p.clone().lerp(tip,.6).add(V(0,0,-.12)),tip],.07,plate,rigid);
      if(g.spineInduction>.65)for(const sign of [-1,1])tube([spine.p.clone().lerp(tip,.5),tip.clone().add(V(sign*.15,.05,-.1)),tip.clone().add(V(sign*.32,.18,-.2))],.035,skin,rigid);
    }
    bake(rigid);

    for(let i=0;i<d.eyes.length;i++){
      const site=d.eyes[i],group=bud(site.p,site.birth,'eye');group.userData.eye=true;group.name='eye-'+(i+1);group.userData.host=site.host;
      const height=(site.kind==='body'?.10:.025)+g.eyeStalk*g.eyeStalk*(site.kind==='body'?1.5:.25);
      const tip=site.normal.clone().multiplyScalar(height),size=(.13+g.eyeScale*.16)*Math.sqrt(d.resource)*(i<2?1.3:1);
      if(height>.06)tube([V(),tip.clone().multiplyScalar(.55).add(V(0,.08,0)),tip],size*.28,skin,group);
      // A separate eyeball sits on the end of its grown stalk, facing outwards.
      const organ=new T.Group();organ.position.copy(tip);organ.quaternion.setFromUnitVectors(V(0,0,1),site.normal);group.add(organ);
      ball(V(0,0,-.025),V(size*1.25,size*1.18,size*.7),dark,organ);
      ball(V(),V(size,size*.88,size*.7),this.iris,organ);
      ball(V(0,0,size*.64),V(size*(.1+g.pupilResponse*.6),size*.73,size*.1),dark,organ);
      ball(V(size*.25,size*.25,size*.74),V(size*.12,size*.12,size*.03),this.glow,organ);
      // Only the organ blinks; the stalk stays attached to its host tissue.
      group.position.copy(site.p);this.eyeGroups.push({group,organ,base:organ.quaternion.clone(),phase:site.phase,kind:site.kind});
    }
    this.materials.forEach(fogMaterial);
    this.model.updateWorldMatrix(true,true);const bounds=new T.Box3(),inverse=this.model.matrixWorld.clone().invert();
    this.model.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();bounds.union(o.geometry.boundingBox.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));}});
    this.viewRadius=Math.max(4,bounds.getBoundingSphere(new T.Sphere()).radius);this.center=bounds.getCenter(V());
    this.rebuilds++;
  }
  animate(time,speed,bank,boost,stage=1){
    const g=this.genes;if(!g)return;
    this.uniforms.uLife.value=time;
    this.breath.scale.y=1+Math.sin(time*(1+g.respiration*3))*g.respiration*.025;
    this.model.rotation.x=Math.sin(time*(1+g.phaseCoupling*2))*.018*g.elasticity;
    this.model.rotation.z=bank*g.reflexGain*.14;
    this.model.scale.setScalar(.35+.65*Math.sqrt(stage));
    for(const item of this.growthItems){
      const amount=smooth(item.birth,Math.min(.99,item.birth+.2),stage);
      item.group.visible=amount>.002;item.group.scale.setScalar(Math.max(.001,amount));
      item.group.position.copy(item.anchor).multiplyScalar(.3+.7*smooth(0,.5,stage));
    }
    for(const {group,kind,phase,sign=1,depth=0} of this.joints){
      const wave=Math.sin(time*(1+g.ciliaMotion*2)-phase*(1-g.phaseCoupling*.75));
      if(kind==='limb'){group.rotation.z=sign*(wave*g.elasticity*.10+boost*g.reflexGain*.35);group.rotation.x=wave*.1*g.ciliaMotion*(1-depth*.25);}
      if(kind==='tail'){group.rotation.y=wave*g.elasticity*.12;group.rotation.x=Math.sin(time*(.8+g.caudalWave*2))*g.elasticity*.07-boost*.09;}
    }
    const cycle=time*(.22+g.respiration*.3);
    for(const eye of this.eyeGroups){
      const phase=(cycle+eye.phase*.071)%1;eye.organ.scale.y=phase>.956?Math.max(.04,Math.abs(phase-.978)/.022):1;
      const glance=Math.sin(Math.floor(time*.7+eye.phase)*2.9)*.09;
      eye.organ.quaternion.copy(eye.base).multiply(new T.Quaternion().setFromEuler(new T.Euler(Math.sin(time*.7+eye.phase)*.05,bank*g.reflexGain*.3+glance,0)));
    }
    this.glow.emissiveIntensity=.65+g.luminousResponse*(.8+Math.sin(time*(1+g.respiration*4))*g.phaseCoupling*.5)+boost*.75;
    this.iris.emissiveIntensity=.65+g.luminousResponse+boost*.3;
  }
  dispose(){
    this.cancelBuild();this.model.traverse(o=>{if(o.isMesh&&o.geometry!==sphere)o.geometry.dispose();});
    this.materials.forEach(m=>m.dispose());this.model.clear();this.materials=[];
  }
}
