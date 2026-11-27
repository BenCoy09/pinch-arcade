// Art for Pinch's Arcade: Pinch, wax seals, prizes and the claw. Canvas + inline SVG, no assets.
const ARM=34,RAIL=30;
const TYPES=['pearl','scallop','starfish','lantern','golden'];
const PRIZES={
  pearl:{name:'Pearl',rarity:'Common',r:15},
  scallop:{name:'Scallop',rarity:'Common',r:17},
  starfish:{name:'Starfish',rarity:'Rare',r:19},
  lantern:{name:'Lantern Fish',rarity:'Epic',r:22},
  golden:{name:'Golden Pearl',rarity:'Mythic',r:24}
};
const RC={Common:'#82AAB6',Rare:'#5BB8FF',Epic:'#B58CFF',Mythic:'#FFC53D'};

function pinchSVG(cls){
  return '<svg class="pinch '+(cls||'idle')+'" viewBox="0 0 120 100" role="img" aria-label="Pinch the hermit crab in a clear capsule">'
  +'<ellipse cx="62" cy="93" rx="42" ry="5" fill="#000" opacity=".25"/>'
  +'<g fill="none" stroke="#E7B7A0" stroke-width="5" stroke-linecap="round"><path d="M40 84l-8 10M54 87l-2 9M68 86l6 9"/></g>'
  +'<g transform="rotate(-24 78 46)">'
  +'<rect x="52" y="14" width="54" height="64" rx="27" fill="#BFE6EE" fill-opacity=".2" stroke="#F1E6C8" stroke-width="3"/>'
  +'<path d="M52 46h54v5a27 27 0 0 1-54 0z" fill="#E0A63A" fill-opacity=".4"/>'
  +'<path d="M52 46h54" stroke="#F1E6C8" stroke-width="3"/>'
  +'<path d="M61 30c0-7 5-12 11-13" stroke="#fff" stroke-opacity=".8" stroke-width="4" stroke-linecap="round" fill="none"/>'
  +'<circle cx="90" cy="62" r="8" fill="#B3261E"/><rect x="86" y="58" width="3" height="3" fill="#7E1712"/><rect x="91" y="58" width="3" height="3" fill="#7E1712"/><rect x="86" y="63" width="8" height="3" fill="#7E1712"/>'
  +'</g>'
  +'<ellipse cx="46" cy="76" rx="30" ry="16" fill="#E7B7A0"/>'
  +'<path d="M34 64l-3-14M48 62l2-14" stroke="#E7B7A0" stroke-width="4" stroke-linecap="round"/>'
  +'<circle cx="31" cy="48" r="6.5" fill="#fff"/><circle cx="50" cy="46" r="6.5" fill="#fff"/>'
  +'<circle cx="32" cy="49" r="3.2" fill="#0D1820"/><circle cx="51" cy="47" r="3.2" fill="#0D1820"/>'
  +'<path class="br br1" d="M25 40q6-5 12-2" fill="none" stroke="#7A4B3A" stroke-width="2.6" stroke-linecap="round"/>'
  +'<path class="br br2" d="M44 37q6-3 12 1" fill="none" stroke="#7A4B3A" stroke-width="2.6" stroke-linecap="round"/>'
  +'<path d="M36 72q8 5 16 0" fill="none" stroke="#7A4B3A" stroke-width="3" stroke-linecap="round"/>'
  +'<g class="al" style="transform-box:fill-box;transform-origin:100% 100%"><path d="M24 76C12 78 4 70 6 60c1-5 6-6 9-3l5 5 6 1z" fill="#E8896A"/><path d="M6 60C3 52 8 44 15 46l3 8z" fill="#E8896A"/></g>'
  +'<g class="ar" style="transform-box:fill-box;transform-origin:0% 100%"><path d="M34 86c-6 2-12-1-12-6 0-3 3-4 6-2l4 4z" fill="#C86A4C"/></g>'
  +'</svg>';
}
function sealCells(hash){const a=[];for(let i=0;i<15;i++)a.push(parseInt(hash.substr(i*2,2),16)%2);return a;}
function sealInner(hash,ink){
  const cells=sealCells(hash);let s='';
  for(let r=0;r<5;r++)for(let c=0;c<5;c++){const cc=c<3?c:4-c;if(cells[r*3+cc])s+='<rect x="'+(27.5+c*9)+'" y="'+(27.5+r*9)+'" width="8" height="8" rx="2" fill="'+ink+'"/>';}
  return s;
}
let sealN=0;
function sealSVG(hash,mode,cls){
  const id='sc'+(sealN++);
  const wax='<circle cx="50" cy="50" r="44" fill="#B3261E"/><circle cx="50" cy="50" r="44" fill="none" stroke="#D8483B" stroke-width="3" stroke-dasharray="7 5" opacity=".55"/><circle cx="50" cy="50" r="36" fill="none" stroke="#7E1712" stroke-width="2.5"/>'+sealInner(hash,'#7E1712')+'<path d="M24 30a32 32 0 0 1 22-14" stroke="#fff" stroke-opacity=".35" stroke-width="4" stroke-linecap="round" fill="none"/>';
  if(mode==='crack'){
    return '<svg class="'+(cls||'')+'" viewBox="0 0 100 100" aria-hidden="true"><defs><clipPath id="'+id+'l"><path d="M0 0H52L46 25L55 45L47 70L53 100H0Z"/></clipPath><clipPath id="'+id+'r"><path d="M52 0H100V100H53L47 70L55 45L46 25Z"/></clipPath></defs><g class="hl" clip-path="url(#'+id+'l)">'+wax+'</g><g class="hr" clip-path="url(#'+id+'r)">'+wax+'</g></svg>';
  }
  return '<svg class="'+(cls||'')+'" viewBox="0 0 100 100" aria-hidden="true">'+wax+'</svg>';
}
function openedSVG(hash,ok){
  const col=ok?'#2E7D5B':'#B3261E';
  return '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" fill="#F1E6C8" stroke="'+col+'" stroke-width="4"/><circle cx="50" cy="50" r="36" fill="none" stroke="'+col+'" stroke-width="2" stroke-dasharray="3 4"/>'+sealInner(hash,col)+'</svg>';
}
function clawIcon(){
  return '<svg viewBox="0 0 40 34" aria-hidden="true"><path d="M20 0v10" stroke="#82AAB6" stroke-width="3"/><rect x="11" y="9" width="18" height="10" rx="4" fill="#E0A63A"/>'
  +'<path d="M13 17c-6 2-9 8-8 14M27 17c6 2 9 8 8 14" stroke="#C4E6DF" stroke-width="4" stroke-linecap="round" fill="none"/></svg>';
}
function drawPrize(c,type,x,y,r,t,glow){
  c.save();c.translate(x,y);
  if(glow){const g=c.createRadialGradient(0,0,r*.4,0,0,r*2);const col=type==='golden'?'255,197,61':'155,231,255';
    g.addColorStop(0,'rgba('+col+','+(.35+.15*Math.sin(t*3))+')');g.addColorStop(1,'rgba('+col+',0)');c.fillStyle=g;c.beginPath();c.arc(0,0,r*2,0,7);c.fill();}
  if(type==='pearl'){
    const g=c.createRadialGradient(-r*.3,-r*.35,r*.1,0,0,r);g.addColorStop(0,'#fff');g.addColorStop(.5,'#C4E6DF');g.addColorStop(1,'#6F9AA8');
    c.fillStyle=g;c.beginPath();c.arc(0,0,r,0,7);c.fill();
  }else if(type==='scallop'){
    c.fillStyle='#FF8FB1';c.beginPath();c.moveTo(-r*.28,r*.85);c.lineTo(-r,r*.05);c.arc(0,r*.05,r,Math.PI,0);c.lineTo(r*.28,r*.85);c.closePath();c.fill();
    c.strokeStyle='#D9628A';c.lineWidth=Math.max(1.5,r*.1);c.lineCap='round';
    for(let i=-3;i<=3;i++){c.beginPath();c.moveTo(i*r*.07,r*.8);c.lineTo(i*r*.3,-r*.9+Math.abs(i)*r*.12);c.stroke();}
    c.fillStyle='#B84770';c.fillRect(-r*.3,r*.78,r*.6,r*.2);
  }else if(type==='starfish'){
    c.fillStyle='#FF8A3D';c.beginPath();
    for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.48:r*1.05;c.lineTo(Math.cos(a)*rr,Math.sin(a)*rr);}
    c.closePath();c.fill();c.lineJoin='round';c.strokeStyle='#FF8A3D';c.lineWidth=r*.2;c.stroke();
    c.fillStyle='#FFC08A';for(let i=0;i<5;i++){const a=-Math.PI/2+i*Math.PI*2/5;c.beginPath();c.arc(Math.cos(a)*r*.5,Math.sin(a)*r*.5,r*.09,0,7);c.fill();}
  }else if(type==='lantern'){
    c.fillStyle='#2A7F9E';c.beginPath();c.ellipse(0,r*.15,r*.95,r*.62,0,0,7);c.fill();
    c.beginPath();c.moveTo(r*.8,r*.15);c.lineTo(r*1.25,-r*.2);c.lineTo(r*1.25,r*.5);c.closePath();c.fill();
    c.strokeStyle='#2A7F9E';c.lineWidth=r*.1;c.beginPath();c.moveTo(-r*.2,-r*.4);c.quadraticCurveTo(-r*.3,-r*1.0,-r*.75,-r*.95);c.stroke();
    const p=.7+.3*Math.sin(t*4);c.fillStyle='rgba(155,231,255,'+p+')';c.beginPath();c.arc(-r*.75,-r*.95,r*.2,0,7);c.fill();
    c.fillStyle='#fff';c.beginPath();c.arc(-r*.5,0,r*.17,0,7);c.fill();c.fillStyle='#0B1D26';c.beginPath();c.arc(-r*.53,0,r*.08,0,7);c.fill();
    c.strokeStyle='#9BE7FF';c.lineWidth=r*.07;c.beginPath();c.arc(r*.1,r*.15,r*.35,-.9,.9);c.stroke();
  }else{
    const g=c.createRadialGradient(-r*.3,-r*.35,r*.1,0,0,r);g.addColorStop(0,'#FFF3B0');g.addColorStop(.55,'#FFC53D');g.addColorStop(1,'#B97A00');
    c.fillStyle=g;c.beginPath();c.arc(0,0,r,0,7);c.fill();
    c.strokeStyle='rgba(255,243,176,.9)';c.lineWidth=r*.07;c.beginPath();c.arc(0,0,r*1.18,t*2,t*2+1.4);c.stroke();c.beginPath();c.arc(0,0,r*1.18,t*2+Math.PI,t*2+Math.PI+1.4);c.stroke();
  }
  c.restore();
}
function paintPrize(cv,type,size){
  const d=2;cv.width=size*d;cv.height=size*d;const c=cv.getContext('2d');c.scale(d,d);
  const rar=PRIZES[type].rarity;drawPrize(c,type,size/2,size/2+1,size*.32,0.6,rar==='Epic'||rar==='Mythic');
}
function drawClaw(c,x,headY,open,span){
  c.strokeStyle='#82AAB6';c.lineWidth=3;c.beginPath();c.moveTo(x,RAIL);c.lineTo(x,headY-12);c.stroke();
  c.fillStyle='#8F6410';c.fillRect(x-14,RAIL-8,28,12);c.fillStyle='#E0A63A';c.fillRect(x-14,RAIL-8,28,8);
  c.fillStyle='#8F6410';rr(c,x-17,headY-14,34,24,7);c.fill();c.fillStyle='#E0A63A';rr(c,x-17,headY-14,34,19,7);c.fill();
  c.fillStyle='rgba(255,255,255,.35)';rr(c,x-12,headY-11,14,4,2);c.fill();
  const reach=6+(span/2-6)*open;
  for(const s of [-1,1]){
    c.strokeStyle='#E8F5F2';c.lineWidth=6;c.lineCap='round';c.beginPath();
    c.moveTo(x+s*13,headY+4);c.quadraticCurveTo(x+s*(14+(span/2)*open*1.05),headY+12,x+s*reach,headY+ARM);c.stroke();
    c.fillStyle='#F1E6C8';c.beginPath();c.arc(x+s*reach,headY+ARM,4,0,7);c.fill();
  }
}
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}

