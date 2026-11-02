// Keep ordinary slow frames in game time. Bound catch-up after a suspended tab
// or debugger stop, and subdivide before gate, roll and collision processing.
export function frameSteps(seconds,step=1/60,maxCatchUp=.5){
  const duration=Math.max(0,Math.min(seconds,maxCatchUp)),count=Math.max(1,Math.ceil(duration/step));
  return {count,dt:duration/count,duration};
}
export class EmissionClock {
  constructor(){this.remainder=0;}
  take(dt,rate){const total=this.remainder+dt*rate,count=Math.floor(total+1e-9);this.remainder=Math.max(0,total-count);return count;}
  reset(){this.remainder=0;}
}
