// Procedural flight audio, enabled by default and unlocked by a user gesture.
export class FlightAudio {
  constructor(){this.enabled=true;this.context=null;}
  async resume(){
    if(!this.enabled)return;
    if(!this.context){
      const ctx=this.context=new AudioContext();
      this.master=ctx.createGain();this.master.gain.value=0;this.master.connect(ctx.destination);
      const buffer=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate),data=buffer.getChannelData(0);
      let low=0;for(let i=0;i<data.length;i++){const white=Math.random()*2-1;low=(low+.02*white)/1.02;data[i]=low*3;}
      const noise=ctx.createBufferSource();noise.buffer=buffer;noise.loop=true;
      this.filter=ctx.createBiquadFilter();this.filter.type='lowpass';this.filter.frequency.value=600;
      this.wind=ctx.createGain();this.wind.gain.value=.4;noise.connect(this.filter).connect(this.wind).connect(this.master);noise.start();
      this.drone=ctx.createOscillator();this.drone.type='sine';this.drone.frequency.value=52;
      const gain=ctx.createGain();gain.gain.value=.04;this.drone.connect(gain).connect(this.master);this.drone.start();
    }
    await this.context.resume();
    this.master.gain.setTargetAtTime(this.enabled?.6:0,this.context.currentTime,.2);
  }
  async toggle(){
    this.enabled=!this.enabled;
    if(this.enabled)await this.resume();else if(this.context)this.master.gain.setTargetAtTime(0,this.context.currentTime,.2);
    return this.enabled;
  }
  update(speed,boost,active){if(!this.context)return;const t=this.context.currentTime;this.filter.frequency.setTargetAtTime(250+speed*7+boost*700,t,.15);this.wind.gain.setTargetAtTime(active?.15+speed*.002:0,t,.2);this.drone.frequency.setTargetAtTime(47+speed*.12+boost*15,t,.2);}
  chime(){if(!this.enabled||!this.context)return;const c=this.context;for(let i=0;i<3;i++){const o=c.createOscillator(),g=c.createGain();o.frequency.value=[523.25,659.25,783.99][i];g.gain.setValueAtTime(0,c.currentTime+i*.07);g.gain.linearRampToValueAtTime(.07,c.currentTime+i*.07+.015);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+i*.07+.6);o.connect(g).connect(this.master);o.start(c.currentTime+i*.07);o.stop(c.currentTime+1);}}
}
