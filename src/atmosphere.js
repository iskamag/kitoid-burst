import * as T from '../vendor/three.module.js';

const NOISE_SIZE=128,noisePixels=new Uint8Array(NOISE_SIZE*NOISE_SIZE*4);
const clamp=T.MathUtils.clamp,mix=T.MathUtils.lerp,smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
function noiseHash(x,y,salt){let n=Math.imul(x,374761393)^Math.imul(y,668265263)^salt;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967295;}
function tileNoise(x,y,n,salt){const ix=Math.floor(x),iy=Math.floor(y),u=x-ix,v=y-iy,a=u*u*(3-2*u),b=v*v*(3-2*v),h=(x,y)=>noiseHash((x%n+n)%n,(y%n+n)%n,salt);return mix(mix(h(ix,iy),h(ix+1,iy),a),mix(h(ix,iy+1),h(ix+1,iy+1),a),b);}
for(let y=0;y<NOISE_SIZE;y++)for(let x=0;x<NOISE_SIZE;x++)for(let c=0;c<2;c++){let value=0,weight=0;for(let o=0;o<4;o++){const n=4*2**o,a=2**-o;value+=tileNoise(x/NOISE_SIZE*n,y/NOISE_SIZE*n,n,173+c*149+o*71)*a;weight+=a;}const i=(y*NOISE_SIZE+x)*4;noisePixels[i+c]=Math.round(value/weight*255);noisePixels[i+2]=Math.round(noiseHash(x,y,193)*255);noisePixels[i+3]=255;}
const cloudNoise=new T.DataTexture(noisePixels,NOISE_SIZE,NOISE_SIZE,T.RGBAFormat);cloudNoise.wrapS=cloudNoise.wrapT=T.RepeatWrapping;cloudNoise.magFilter=cloudNoise.minFilter=T.LinearFilter;cloudNoise.generateMipmaps=false;cloudNoise.needsUpdate=true;
export const SUN_DIRECTION=new T.Vector3(-.65,.5,.6).normalize();
export const FOG_DENSITY=.00038,FOG_FALLOFF=1/1100;
export const atmosphereUniforms={uAtmoEye:{value:new T.Vector3()},uAtmoTime:{value:0},uHaze:{value:1},uCloudNoise:{value:cloudNoise},uSunDirection:{value:SUN_DIRECTION}};
const FOG_BLUE=[.14,.22,.30],FOG_SUN=[.70,.48,.20];
// IQ, Better Fog: integrate a*exp(-b*y) over the camera-to-surface ray.
// https://web.archive.org/web/20231021103649/https://iquilezles.org/articles/fog/
// Reversing descending segments makes the exponents non-positive. The series
// gives the horizontal-ray limit without division by zero or cancellation.
export function fogIntegral(eye,world,density=1){
  if(density<=0)return 0;const distance=Math.hypot(...world.map((v,i)=>v-eye[i]));
  const x=Math.abs(world[1]-eye[1])*FOG_FALLOFF,average=x<.01?1-x/2+x*x/6-x*x*x/24:-Math.expm1(-x)/x;
  return FOG_DENSITY*density*distance*Math.exp(-Math.min(eye[1],world[1])*FOG_FALLOFF)*average;
}
export function fogAt(color,eye,world,density=1){
  const ray=world.map((v,i)=>v-eye[i]),distance=Math.hypot(...ray),sunward=Math.max(0,ray.reduce((v,c,i)=>v+c*SUN_DIRECTION.getComponent(i),0)/Math.max(distance,1e-9))**8;
  const amount=clamp(fogIntegral(eye,world,density),0,1),fogColor=FOG_BLUE.map((c,i)=>mix(c,FOG_SUN[i],sunward));
  return{color:color.map((c,i)=>mix(c,fogColor[i],amount)),amount};
}
export const ATMOSPHERE_GLSL=`
  uniform vec3 uAtmoEye;uniform float uAtmoTime;uniform float uHaze;uniform sampler2D uCloudNoise;uniform vec3 uSunDirection;
  vec3 atmosphereAirColor(vec3 direction){
    float sunward=pow(max(0.,dot(direction,uSunDirection)),8.);
    return mix(vec3(.14,.22,.30),vec3(.70,.48,.20),sunward);
  }
  float atmosphereIntegral(vec3 eye,vec3 world){
    float distance=length(world-eye),x=abs(world.y-eye.y)*${FOG_FALLOFF};
    float average=x<.01?1.-x*.5+x*x/6.-x*x*x/24.:(1.-exp(-x))/max(x,.000001);
    return ${FOG_DENSITY}*max(0.,uHaze)*distance*exp(-min(eye.y,world.y)*${FOG_FALLOFF})*average;
  }
  vec3 atmosphere(vec3 color,vec3 world){
    vec3 ray=world-uAtmoEye;vec3 direction=ray/max(length(ray),.000001);
    return mix(color,atmosphereAirColor(direction),clamp(atmosphereIntegral(uAtmoEye,world),0.,1.));
  }
`;

// Shared by the creature, rings, and ground. Close objects remain crisp while
// distant objects disappear into the same air as the sky's horizon.
export function fogMaterial(material){
  const before=material.onBeforeCompile.bind(material),key=material.customProgramCacheKey.bind(material)();
  material.onBeforeCompile=shader=>{
    before(shader);Object.assign(shader.uniforms,atmosphereUniforms);
    shader.vertexShader='varying vec3 vAirWorld;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvAirWorld=(modelMatrix*vec4(transformed,1.)).xyz;');
    shader.fragmentShader='varying vec3 vAirWorld;\n'+ATMOSPHERE_GLSL+shader.fragmentShader.replace('#include <tonemapping_fragment>','gl_FragColor.rgb=atmosphere(gl_FragColor.rgb,vAirWorld);\n#include <tonemapping_fragment>');
  };
  material.customProgramCacheKey=()=>key+'-iq-height-fog-v4';
  return material;
}

export function createAtmosphere(scene,{occluded=()=>false}={}){
  const uniforms={...atmosphereUniforms};
  const material=new T.ShaderMaterial({uniforms,side:T.BackSide,depthWrite:false,depthTest:false,vertexShader:`
    varying vec3 vDirection;
    void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position.z=gl_Position.w;}
  `,fragmentShader:`
    varying vec3 vDirection;
    ${ATMOSPHERE_GLSL}
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec3 d=normalize(vDirection);float altitude=max(0.,d.y);
      vec3 zenith=vec3(.009,.015,.045),horizon=atmosphereAirColor(d);
      vec3 color=mix(horizon,zenith,pow(altitude,.43));
      vec3 sun=uSunDirection;float sunDot=max(0.,dot(d,sun));
      color+=vec3(.32,.13,.035)*pow(sunDot,9.)*.45;
      color+=vec3(1.,.76,.38)*smoothstep(.99955,.99972,sunDot)*1.5;
      color+=vec3(.55,.3,.09)*pow(sunDot,180.)*.35;
      // Two independent advected cloud decks, projected at different heights.
      vec2 cloudUV=d.xz/max(.10,d.y+.13);
      float lower=texture2D(uCloudNoise,cloudUV*.16+vec2(uAtmoTime*.0008,uAtmoTime*.0004)).r;
      float upper=texture2D(uCloudNoise,cloudUV*.41-vec2(uAtmoTime*.0004,.43)).g;
      float clouds=smoothstep(.44,.70,lower)*smoothstep(-.02,.12,d.y)*(1.-smoothstep(.65,.94,d.y));
      float cirrus=smoothstep(.52,.76,upper)*smoothstep(.13,.4,d.y)*.26;
      vec3 cloudColor=mix(vec3(.06,.055,.105),vec3(.26,.17,.12),pow(sunDot,3.));
      color=mix(color,cloudColor,(clouds*.68+cirrus)*(.65+uHaze*.2));
      // Sparse stars in the darker upper sky, rather than a black background.
      vec2 starCell=floor(vec2(atan(d.z,d.x),asin(d.y))*650.);
      float star=step(.9986,hash(starCell))*smoothstep(.16,.65,d.y);
      color+=star*vec3(.4,.47,.5);
      color=mix(color,horizon,1.-smoothstep(-.18,.02,d.y));
      // Apply the same analytic volume to the sky, including camera altitude.
      color=atmosphere(color,uAtmoEye+d*10000.);
      gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `});
  const dome=new T.Mesh(new T.SphereGeometry(12000,48,32),material);dome.renderOrder=-1000;dome.frustumCulled=false;scene.add(dome);
  const flareUniforms={uSun:{value:new T.Vector2()},uAspect:{value:1},uFlare:{value:0}};
  const flareMaterial=new T.ShaderMaterial({uniforms:flareUniforms,transparent:true,blending:T.AdditiveBlending,depthTest:false,depthWrite:false,vertexShader:`
    varying vec2 uvScreen;void main(){uvScreen=uv;gl_Position=vec4(position.xy,0.,1.);}
  `,fragmentShader:`
    varying vec2 uvScreen;uniform vec2 uSun;uniform float uAspect;uniform float uFlare;
    float disc(vec2 p,float radius){return 1.-smoothstep(radius*.65,radius,length(p));}
    void main(){
      vec2 scale=vec2(uAspect,1.),p=(uvScreen-uSun)*scale,axis=vec2(.5)-uSun;
      float glow=exp(-length(p)*45.)*.20,streak=exp(-abs(p.y)*280.)*exp(-abs(p.x)*8.)*.07;
      vec3 color=vec3(1.,.65,.27)*(glow+streak);
      color+=vec3(.30,.52,.7)*disc((uvScreen-(uSun+axis*1.35))*scale,.035)*.055;
      color+=vec3(.65,.25,.08)*disc((uvScreen-(uSun+axis*1.8))*scale,.065)*.035;
      float ring=abs(length((uvScreen-(uSun+axis*2.25))*scale)-.09);
      color+=vec3(.22,.48,.34)*(1.-smoothstep(.002,.007,ring))*.025;
      gl_FragColor=vec4(color*uFlare,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `});
  const flare=new T.Mesh(new T.PlaneGeometry(2,2),flareMaterial);flare.frustumCulled=false;flare.renderOrder=10000;scene.add(flare);
  const projected=new T.Vector3(),view=new T.Vector3();let target=1,blocked=true,occlusionAge=1;

  return {
    setDensity:density=>{target=density;},
    update(time,eye,dt,camera){
      atmosphereUniforms.uAtmoTime.value=time;atmosphereUniforms.uAtmoEye.value.copy(eye);atmosphereUniforms.uHaze.value=T.MathUtils.lerp(atmosphereUniforms.uHaze.value,target,1-Math.exp(-dt*2));dome.position.copy(eye);
      let strength=0;occlusionAge+=dt;
      if(camera){
        camera.updateMatrixWorld();camera.getWorldDirection(view);projected.copy(SUN_DIRECTION).multiplyScalar(10000).add(eye).project(camera);
        const edge=Math.max(Math.abs(projected.x),Math.abs(projected.y)),visible=view.dot(SUN_DIRECTION)>0&&edge<1.15;
        if(visible){if(occlusionAge>.08){blocked=occluded(eye,SUN_DIRECTION);occlusionAge=0;}const transmission=1-clamp(fogIntegral(eye.toArray(),eye.clone().addScaledVector(SUN_DIRECTION,10000).toArray(),atmosphereUniforms.uHaze.value),0,1);strength=blocked?0:(1-smooth(.65,1.15,edge))*transmission;}
        flareUniforms.uSun.value.set(projected.x*.5+.5,projected.y*.5+.5);flareUniforms.uAspect.value=camera.aspect;
      }
      flareUniforms.uFlare.value=mix(flareUniforms.uFlare.value,strength,1-Math.exp(-dt*16));flare.visible=flareUniforms.uFlare.value>.001;
    },
    settled:()=>Math.abs(atmosphereUniforms.uHaze.value-target)<.001,
    density:()=>atmosphereUniforms.uHaze.value,
    flareState:()=>({strength:flareUniforms.uFlare.value,blocked}),
  };
}
