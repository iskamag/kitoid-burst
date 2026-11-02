import * as T from '../vendor/three.module.js';
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const clamp=T.MathUtils.clamp,lerp=T.MathUtils.lerp;

// The same continuous growth envelope supplies terminal tissue and its sensory
// attachment sites. A central inhibitor divides dorsal growth into paired ridges.
// It is a surface field, not a collection of attached facial or ear meshes.
export function terminalPoint(g,theta,phi){
  const profile=Math.sin(theta),power=.48+g.terminalCurl*.72;
  const c=Math.cos(phi),s=Math.sin(phi),signed=(x,p)=>Math.sign(x)*Math.pow(Math.abs(x),p);
  const rx=.78+g.organizerStrength*.5,ry=.65+g.crestActivation*.35,rz=.5+g.fieldFusion*.42;
  let x=signed(c,power)*profile*rx;
  let y=signed(s,power)*profile*ry;
  const ridge=.25+g.crestActivation*.65,width=.07+g.budCompetition*.13;
  y+=Math.pow(Math.max(0,s),3)*profile*ridge*(.5-Math.exp(-Math.pow(x/rx,2)/width));
  if(y<0)y*=.72+g.ventralGradient*.28;
  x*=.87+(y/ry)*(.10+g.dorsalGradient*.12);
  const z=Math.cos(theta)*rz+profile*profile*Math.sin(phi*2)*g.symmetryBreak*g.terminalCurl*.25;
  return V(x,y,z);
}

export function axisFrame(axis,t){
  const p=axis.curve.getPoint(clamp(t,0,1)),forward=axis.curve.getTangent(clamp(t,0,1)).normalize();
  const side=V(0,1,0).cross(forward).normalize();
  if(side.lengthSq()<.1)side.set(1,0,0);
  const up=forward.clone().cross(side).normalize();
  const twist=axis.twist*(t-.5);side.applyAxisAngle(forward,twist);up.applyAxisAngle(forward,twist);
  return {p,forward,side,up};
}

// A bounded developmental grammar, not a mesh with independently scaled parts.
// Axial organizers induce segments; competent segments induce recursive buds.
// Organ duplication competes for resources and changes the rest of the phenotype.
export function develop(g){
  const segments=3+Math.floor(g.segmentationClock*9);
  const axisCount=1+(g.radialPattern>.28?2:0)+(g.radialPattern>.76?2:0);
  const resource=1/Math.sqrt(1+(axisCount-1)*.2+g.limbInduction*g.distalGrowth*.3);
  const length=(2.6+Math.pow(g.axialGrowth,1.4)*14)*(.8+g.resourceBias*.4)*resource;
  const radius=(.38+Math.pow(1-g.resourceBias,1.5)*2.5)*(.55+g.organizerStrength*.8)*resource;
  const tissue={vertical:.30+g.fieldFusion*.95,solid:g.fieldFusion,roundness:.40+g.terminalCurl*1.2,
    crown:.35+g.crestActivation*.95,bulk:radius,spread:.15+g.webbing*2.35};
  const axes=[],nodes=[],limbs=[],tails=[],spines=[],eyes=[];
  const makeAxis=(id,points,r,order)=>{
    const axis={id,curve:new T.CatmullRomCurve3(points),radius:r,order,segments:Math.max(3,segments-order*2),twist:(g.torsionGradient-.5)*4.5,birth:order?.2:.02};
    axis.width=t=>{
      const envelope=Math.pow(Math.sin(Math.PI*(.015+.97*t)),.23+g.resourceBias*.45);
      const segment=1-g.growthFeedback*.2+Math.cos(t*axis.segments*Math.PI*2)*Math.pow(g.segmentPolarity,2)*g.growthFeedback*.3;
      return Math.max(.025,r*envelope*segment*(1+(g.dorsalGradient-g.ventralGradient)*(t-.5)*.35));
    };
    axes.push(axis);return axis;
  };
  const points=[];
  for(let i=0;i<=32;i++){
    const t=i/32,s=t-.5,bend=(g.axialCurl-.5)*4.8;
    const x=Math.abs(bend)<.001?0:(1-Math.cos(s*bend))*length/bend;
    const z=Math.abs(bend)<.001?s*length:Math.sin(s*bend)*length/bend;
    points.push(V(x+Math.sin(t*7)*g.symmetryBreak*g.symmetryBreak*.8,
      Math.sin(t*Math.PI)*(g.dorsalGradient-g.ventralGradient)*radius*2+(t-.5)*(g.axialCurl-.5)*radius,z));
  }
  const trunk=makeAxis('axis-0',points,radius,0);
  for(let i=1;i<axisCount;i++){
    const pair=Math.floor((i-1)/2),sign=i%2?1:-1;
    const root=trunk.curve.getPoint(.56-pair*.2),reach=length*(.35+g.radialPattern*.18)*(pair?.8:1);
    const angle=(g.torsionGradient-.5)*Math.PI+pair*Math.PI*.5;
    const direction=V(sign*Math.cos(angle)*(1+g.symmetryBreak*sign*.3),sign*Math.sin(angle),.45-g.organizerMigration*.9).normalize();
    const curve=[];
    for(let j=0;j<=16;j++){const t=j/16;curve.push(root.clone().addScaledVector(direction,t*reach).add(V(Math.sin(t*Math.PI)*sign*g.axialCurl*.55,Math.sin(t*Math.PI)*(.3+g.dorsalGradient),t*t*g.symmetryBreak*sign*.8)));}
    makeAxis('axis-'+i,curve,radius*(.65+g.organizerDuplication*.16),1);
  }

  // An organizer's duplication and migration determine where nodes differentiate.
  for(const axis of axes){
    if(axis.order&&g.organizerDuplication<.32+(axes.indexOf(axis)-1)*.13)continue;
    const t=1-g.organizerMigration*(axis.order?.25:.13),f=axisFrame(axis,t);
    nodes.push({id:'node-'+nodes.length,axis:axis.id,p:f.p.clone().addScaledVector(f.up,.1),direction:f.forward,size:(.8+g.organizerStrength*.8)*resource*(axis.order?.45+g.organizerDuplication*.3:1),birth:.35+axis.order*.08});
  }
  if(g.organizerDuplication>.86){const f=axisFrame(trunk,.32+g.organizerMigration*.2);nodes.push({id:'node-ectopic',axis:trunk.id,p:f.p.clone().addScaledVector(f.up,radius+.25),direction:f.up,size:.65*resource,birth:.5});}

  // Lateral-inhibition peaks determine appendage sites, rather than four fixed legs.
  let branchCount=0;
  function limbBud(anchor,sign,phase,scale,depth,axisId){
    const span=(.25+g.proximalGrowth*2)*resource*scale;
    const lateral=.22+g.webbing*1.65,drop=.3+(1-g.webbing)*(1+g.ventralGradient);
    const joint=anchor.clone().add(V(sign*span*lateral,-span*drop,Math.sin(phase)*.3));
    const tip=joint.clone().add(V(sign*(.12+g.webbing*g.distalGrowth)*scale,-(.2+g.distalGrowth)*(1-g.webbing)*scale,(g.jointBias-.5)*1.8*scale));
    const digitCount=2+Math.floor(g.digitInduction*4),digits=[];
    for(let k=0;k<digitCount;k++){
      const angle=(k/(digitCount-1)-.5)*tissue.spread;
      digits.push(tip.clone().add(V(sign*Math.sin(angle)*(.3+g.distalGrowth)*scale,-.1+Math.sin(k+phase)*g.elasticity*.08,
        Math.cos(angle)*(.25+g.distalGrowth*(.3+g.webbing))*scale)));
    }
    const limb={id:'limb-'+branchCount++,axis:axisId,anchor,joint,tip,digits,scale,sign,phase,depth,birth:.32+depth*.15+phase*.012};limbs.push(limb);
    if(depth<(g.limbRecursion>.7?2:1)&&g.limbBranching>.52+depth*.25&&branchCount<26){
      const daughter=joint.clone().lerp(tip,.45);limbBud(daughter,sign,phase+1.7,scale*.54,depth+1,axisId);
    }
  }
  const sites=1+Math.floor(g.limbSpacing*4);
  for(let i=0;i<sites;i++){
    const t=.16+(i+.2+g.limbPhase*.6)/sites*.61,f=axisFrame(trunk,t);
    const competence=.38+.25*Math.sin((i+.3)*2.4+g.limbPhase*5)+g.limbInduction;
    if(competence<.55)continue;
    for(const sign of [-1,1]){
      const asymmetry=(1-g.symmetryCoupling)*g.symmetryBreak;
      if(sign<0&&asymmetry>.35&&i%2)continue;
      limbBud(f.p.clone().addScaledVector(f.side,trunk.width(t)*sign*.85),sign,i*.65+g.limbPhase*(1+asymmetry*sign),1-asymmetry*(sign<0?.6:0),0,trunk.id);
    }
  }

  // The same recursive production is applied to each posterior tail bud.
  let tailBranches=0;
  function tailBud(start,direction,extent,depth,phase){
    const path=[];
    const lateral=V(0,1,0).cross(direction).normalize();
    for(let i=0;i<=16;i++){
      const t=i/16,curl=t*t*g.tailCurl*2.2;
      path.push(start.clone().addScaledVector(direction,extent*t).addScaledVector(lateral,Math.sin(curl+phase)*t*g.tailCurl*extent*.38)
        .add(V(0,t*t*(.35+g.tailCurl*1.5)+Math.sin(t*4+phase)*t*g.caudalWave*.3,0)));
    }
    const tail={id:'tail-'+tailBranches++,curve:new T.CatmullRomCurve3(path),radius:(.10+radius*.1)*Math.pow(.66,depth),depth,phase,birth:.28+depth*.18};tails.push(tail);
    if(depth<(g.tailRecursion>.67?2:1)&&g.tailBranching>.64+depth*.2){
      const root=tail.curve.getPoint(.7),dir=tail.curve.getTangent(.7);
      for(const sign of [-1,1])tailBud(root.clone(),dir.clone().applyAxisAngle(V(0,1,0),sign*(.35+g.tailTorsion*.9)),extent*.5,depth+1,phase+sign*1.2);
    }
  }
  const tailCount=1+Math.floor(g.tailInduction*2.9);
  const posterior=axisFrame(trunk,0);
  for(let i=0;i<tailCount;i++)tailBud(posterior.p.clone(),V((i-(tailCount-1)/2)*(.28+g.tailTorsion),.08,-1).normalize(),(1.6+g.tailGrowth*4.5)*resource,0,i*g.caudalWave*2);

  for(const axis of axes)for(let i=1;i<axis.segments;i++){
    const t=i/axis.segments,f=axisFrame(axis,t),competence=(Math.sin(i*2.3+g.segmentPolarity*4)+1)*.25+g.spineInduction;
    if(competence>.92){const base=f.p.clone().addScaledVector(f.up,axis.width(t)*tissue.vertical);spines.push({p:base,direction:f.up,size:(.1+g.spineInduction*.7)*resource,phase:i,axis:axis.id,birth:.5+t*.15});}
  }

  // A fixed eye budget chooses sites in the grown anatomy. Repulsion prevents
  // duplicated organizers from simply receiving identical grids of face-eyes.
  const nodeSites=[],bodySites=[];
  nodes.forEach((node,h)=>{
    const rot=new T.Quaternion().setFromUnitVectors(V(0,0,1),node.direction);
    for(let i=0;i<7;i++){
      const x=i<2?(i?1:-1)*.47:Math.sin(i*2.4)*.6,y=i<2?.12:.2+Math.cos(i*2.4)*.4;
      const direction=V(x,y,.9).normalize(),theta=Math.acos(direction.z),phi=Math.atan2(direction.y,direction.x);
      const local=terminalPoint(g,theta,phi).multiplyScalar(node.size);
      const normal=V(x*.7,y*.5,1).normalize().applyQuaternion(rot);
      nodeSites.push({p:local.applyQuaternion(rot).add(node.p),normal,host:node.id,kind:'node',phase:i+h*1.7,score:.5+Math.sin(i*2+h+g.eyeRhythm*6)*.15,birth:.7});
    }
  });
  for(const axis of axes)for(let i=1;i<axis.segments;i++)for(let side=0;side<3;side++){
    const t=(i+.15+g.eyeRhythm*.5)/(axis.segments+.5),f=axisFrame(axis,t);
    const a=(side-1)*(1.4-g.eyePolarity*.7)+(g.eyeRhythm-.5)*.35;
    const normal=f.up.clone().multiplyScalar(Math.cos(a)/tissue.vertical).addScaledVector(f.side,Math.sin(a)).normalize();
    const surface=f.p.clone().addScaledVector(f.up,axis.width(t)*tissue.vertical*Math.cos(a)).addScaledVector(f.side,axis.width(t)*Math.sin(a));
    bodySites.push({p:surface.addScaledVector(normal,.035),normal,host:axis.id,kind:'body',phase:i+side*1.8,score:.5+Math.sin(i*2.3+side+g.eyeRhythm*8)*.23+Math.cos(a)*g.eyePolarity*.3,birth:.68+t*.12});
  }
  const nodeBudget=clamp(Math.round(9*(1-g.eyeMigration*.85)),2,9);
  function choose(candidates,count){
    const remaining=[...candidates];
    while(count--&&remaining.length){
      let best=-Infinity,index=0;
      remaining.forEach((site,i)=>{
        const distance=eyes.length?Math.min(...eyes.map(e=>e.p.distanceTo(site.p))):1;
        const sameHost=eyes.filter(e=>e.host===site.host).length;
        const score=site.score+Math.min(distance,4)*(.22+g.eyeClustering*.45)-sameHost*g.eyeClustering*.14;
        if(score>best){best=score;index=i;}
      });
      eyes.push(remaining.splice(index,1)[0]);
    }
  }
  eyes.push(nodeSites.shift(),nodeSites.shift());
  choose(nodeSites,nodeBudget-2);choose(bodySites,9-eyes.length);
  // A very short axis may not have enough competent sites for the requested
  // migration. Reassign the remainder to unused terminal sites, never lose eyes.
  choose([...nodeSites,...bodySites].filter(site=>!eyes.includes(site)),9-eyes.length);
  if(eyes.length!==9)throw Error('Sensory budget must differentiate into nine eyes.');
  const counts={axes:axes.length,segments:axes.reduce((n,a)=>n+a.segments,0),nodes:nodes.length,limbs:limbs.filter(l=>!l.depth).length,limbBranches:limbs.length,tails:tails.length,eyes:eyes.length,bodyEyes:eyes.filter(e=>e.kind==='body').length,spines:spines.length};
  return {axes,nodes,limbs,tails,spines,eyes,counts,length,radius,resource,tissue};
}
