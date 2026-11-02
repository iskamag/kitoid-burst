// Standard browser gamepad mapping. Polling keeps held controls and button edges
// separate, so pause and roll gestures never repeat just because a button is held.
const axis=x=>Math.abs(x||0)<.15?0:Math.sign(x)*Math.min(1,(Math.abs(x)-.15)/.85);
export class GamepadInput{
  constructor(){this.id=null;this.previous=[];}
  sample(pads){
    const p=Array.from(pads||[]).find(p=>p?.connected&&p.mapping==='standard');
    if(!p){this.id=null;this.previous=[];return null;}
    if(this.id!==p.index){this.id=p.index;this.previous=[];}
    const held=p.buttons.map(b=>!!b.pressed||b.value>.5),pressed=new Set(held.flatMap((on,i)=>on&&!this.previous[i]?[i]:[]));this.previous=held;
    return{x:axis(p.axes[0]),y:axis(p.axes[1]),lookX:axis(p.axes[2]),lookY:axis(p.axes[3]),zoom:Number(!!held[13])-Number(!!held[12]),roll:Number(!!held[5])-Number(!!held[4]),boost:!!(p.buttons[7]?.value>.2||held[0]),brake:!!(p.buttons[6]?.value>.2||held[1]),pressed};
  }
}
