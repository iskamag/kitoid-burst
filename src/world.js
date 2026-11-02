import * as T from '../vendor/three.module.js';
const V=(x,z)=>new T.Vector3(x,0,z);
const knots=[[-2150,-850],[-1700,-850],[-1150,-1100],[-650,-700],[-100,-1150],[650,-1000],[1500,-650],[2150,100],[1850,1100],[1050,1650],[250,1200],[-600,1650],[-1400,1050],[-2300,750],[-2550,0],[-2550,-850]];
const spine=new T.CatmullRomCurve3(knots.map(p=>V(...p)),true,'catmullrom',.35);
export const ROUTE_LENGTH=spine.getLength();
export const WORLD_SIZE=7200;
const reaches=new Map();
function regionHash(x,z){let h=Math.imul(x,374761393)^Math.imul(z,668265263)^0x51f15e;h=Math.imul(h^(h>>>13),1274126177);return(h^(h>>>16))>>>0;}
export function worldRegion(x,z){
  const cx=Math.round(x/WORLD_SIZE),cz=Math.round(z/WORLD_SIZE),key=cx+':'+cz;
  if(reaches.has(key))return reaches.get(key);
  const seed=regionHash(cx,cz),root=cx===0&&cz===0;
  const adjectives=['AMBER','INDIGO','VERMILION','GLASS','SAFFRON','VIRIDIAN','SILVER','CINNABAR'],nouns=['FOLDS','REACH','LABYRINTH','CROWN','WILDS','GARDENS','SADDLES','CATHEDRAL'];
  const region={key,cx,cz,x:cx*WORLD_SIZE,z:cz*WORLD_SIZE,seed,angle:root?0:(seed%4)*Math.PI*.5,scale:root?1:.8+((seed>>>6)%301)/1000,lift:root?0:((seed>>>15)%110),needleScale:root?1:.65+((seed>>>20)%80)/100,name:root?'THE COPPER BASIN':adjectives[seed%8]+' '+nouns[(seed>>>4)%8]};
  region.cos=Math.cos(region.angle);region.sin=Math.sin(region.angle);reaches.set(key,region);return region;
}
export const ROOT_REGION=worldRegion(0,0);
export function localPoint(x,z,region){const dx=(x-region.x)/region.scale,dz=(z-region.z)/region.scale;return{x:dx*region.cos+dz*region.sin,z:-dx*region.sin+dz*region.cos};}
export function routePoint(t,region=ROOT_REGION){const p=spine.getPointAt(((t%1)+1)%1),x=p.x;return p.set(region.x+(x*region.cos-p.z*region.sin)*region.scale,0,region.z+(x*region.sin+p.z*region.cos)*region.scale);}
export function routeTangent(t,region=ROOT_REGION){const p=spine.getTangentAt(((t%1)+1)%1),x=p.x;return p.set(x*region.cos-p.z*region.sin,0,x*region.sin+p.z*region.cos).normalize();}
export const corridorFloor=t=>65+55*Math.sin(t*Math.PI*2-.3)+30*Math.sin(t*Math.PI*6)+70*Math.exp(-Math.pow((t-.67)/.12,2));
export const corridorWidth=t=>68+55*(.5+.5*Math.sin(t*Math.PI*8+.7))+85*Math.exp(-Math.pow((t-.47)/.07,2));
export const REGIONS=[
  {end:.21,name:'THE COPPER CUT',hint:'Split canyons · low arches'},
  {end:.43,name:'THE NEEDLE GARDEN',hint:'Slalom through the stone spires'},
  {end:.57,name:'THE HOLLOW CROWN',hint:'An open bowl beneath the ridges'},
  {end:.80,name:'THE HIGHLINE',hint:'Climbing valleys · exposed saddles'},
  {end:1,name:'THE BLUE FOLDS',hint:'Layered ravines · the long way home'},
];
export const regionAt=t=>REGIONS.find(r=>t<r.end)||REGIONS[0];
export const COURSES=[
  {id:'cut',name:'THE COPPER CUT',samples:[.018,.038,.058,.14,.154,.17,.19],lift:95},
  {id:'needles',name:'NEEDLE RUN',samples:[.228,.253,.278,.302,.328,.36,.385,.414],lift:110},
  {id:'highline',name:'THE HIGHLINE',samples:[.57,.594,.62,.65,.678,.705,.73,.76,.79],lift:150},
  {id:'pilgrimage',name:'THE LONG WAY HOME',samples:[.018,.055,.075,.14,.19,.228,.253,.278,.328,.36,.385,.445,.50,.57,.594,.65,.705,.73,.79,.84,.91,.96],lift:110},
];
export const ARCH_SITES=[.075,.14,.278,.385,.594,.73,.91].map((t,i)=>({t,width:[60,85,55,105,75,65,95][i],height:[84,100,115,125,95,110,100][i],name:['THE FIRST EYE','THE SPLIT','THE NEEDLE EYE','THE GARDEN GATE','THE HIGH WINDOW','THE SADDLE','THE HOME ARCH'][i]}));
export function crossedGate(before,after,gate,radius=28){
  const normal=gate.userData.direction,a=before.clone().sub(gate.position).dot(normal),b=after.clone().sub(gate.position).dot(normal);
  if(a*b>0||Math.abs(b-a)<1e-8)return false;
  return before.clone().lerp(after,-a/(b-a)).distanceToSquared(gate.position)<radius*radius;
}

// Course metadata supports bearings and the route playtest. This index never
// modifies the heightfield; the landscape is generated independently.
const CELL=320,segments=[],index=new Map();
function addSegment(a,b,t0,t1,width,floor,path=0){
  // Include neighboring course segments for continuous course lookup.
  const segment={a,b,t0,t1,width,floor,path},id=segments.push(segment)-1,margin=width*5.6+16;
  for(let x=Math.floor((Math.min(a.x,b.x)-margin)/CELL);x<=Math.floor((Math.max(a.x,b.x)+margin)/CELL);x++)
    for(let z=Math.floor((Math.min(a.z,b.z)-margin)/CELL);z<=Math.floor((Math.max(a.z,b.z)+margin)/CELL);z++){
      const key=x+':'+z;if(!index.has(key))index.set(key,[]);index.get(key).push(id);
    }
}
for(let i=0;i<384;i++){
  const t0=i/384,t1=(i+1)/384,t=(t0+t1)*.5;
  addSegment(routePoint(t0),routePoint(t1),t0,t1,corridorWidth(t),corridorFloor(t));
}
// Narrow shortcuts reconnect to the main valley. They offer different lines
// between checkpoints instead of forcing every pilot down the same spline.
const branchDefinitions=[[.058,.14,-190],[.30,.385,220],[.59,.705,-240],[.84,.94,160]];
for(let branch=0;branch<branchDefinitions.length;branch++){
  const [start,end,offset]=branchDefinitions[branch],a=routePoint(start),b=routePoint(end),middle=a.clone().lerp(b,.5);
  const side=new T.Vector3(b.z-a.z,0,a.x-b.x).normalize();middle.addScaledVector(side,offset);
  const curve=new T.CatmullRomCurve3([a,a.clone().lerp(middle,.55),middle,middle.clone().lerp(b,.5),b]);
  for(let i=0;i<40;i++){
    const s=(i+.5)/40,t=T.MathUtils.lerp(start,end,s);
    addSegment(curve.getPoint(i/40),curve.getPoint((i+1)/40),t,t+(end-start)/40,43+branch*4,corridorFloor(t)+10,branch+1);
  }
}

function localCorridorAt(x,z){
  const ids=index.get(Math.floor(x/CELL)+':'+Math.floor(z/CELL));if(!ids)return null;
  let best=null,bestMetric=Infinity;
  for(const id of ids){
    const s=segments[id],dx=s.b.x-s.a.x,dz=s.b.z-s.a.z;
    const u=T.MathUtils.clamp(((x-s.a.x)*dx+(z-s.a.z)*dz)/(dx*dx+dz*dz),0,1);
    const distance=Math.hypot(x-s.a.x-dx*u,z-s.a.z-dz*u),metric=distance/s.width;
    if(metric<bestMetric){bestMetric=metric;best={distance,width:s.width,floor:s.floor,t:T.MathUtils.lerp(s.t0,s.t1,u)%1,path:s.path};}
  }
  return best;
}

export function corridorAt(x,z){
  const region=worldRegion(x,z),local=localPoint(x,z,region),near=localCorridorAt(local.x,local.z),candidates=[];
  if(near)candidates.push({...near,distance:near.distance*region.scale,width:near.width*region.scale,floor:near.floor+region.lift});
  // Unbroken crosswind canyons connect neighboring reaches. Their floor field
  // is global, so crossings remain continuous across regional boundaries.
  const row=Math.round(z/WORLD_SIZE),column=Math.round(x/WORLD_SIZE),floor=70+20*Math.sin(x*.00055)+18*Math.cos(z*.00065);
  candidates.push({distance:Math.abs(z-row*WORLD_SIZE-Math.sin(x*.0008+row*1.7)*180),width:100,floor,path:10,t:near?.t||0});
  candidates.push({distance:Math.abs(x-column*WORLD_SIZE-Math.sin(z*.0007+column*2.1)*210),width:82,floor,path:11,t:near?.t||0});
  candidates.sort((a,b)=>a.distance/a.width-b.distance/b.width);
  const best=candidates[0];let weight=0,blendedFloor=0;
  for(const c of candidates){const w=Math.exp(-Math.pow(c.distance/c.width,2)*2);weight+=w;blendedFloor+=c.floor*w;}
  return{...best,floor:weight>1e-8?blendedFloor/weight:best.floor,region,localX:local.x,localZ:local.z,t:near?.t||best.t};
}

export const NEEDLES=Array.from({length:23},(_,i)=>{
  const t=.235+i*.0079,p=routePoint(t),side=new T.Vector3().crossVectors(new T.Vector3(0,1,0),routeTangent(t));
  p.addScaledVector(side,(i%2?1:-1)*(94+(i%4)*22));
  return {x:p.x,z:p.z,radius:18+(i%3)*7,height:150+(i%5)*36};
});
