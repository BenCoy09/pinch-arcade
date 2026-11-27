const R=require('./rules.js'),V=require('./vectors.json');let bad=0;
for(const v of V){
  const a=R.hex(v.auth),seed=R.pitSeed(a,v.round,v.m);
  const k=R.pitKinds(seed,v.m),t=R.pickTarget(v.m,v.x);
  const slot=t?t.slot:-1,c=t?t.centering:-1,ch=t?R.chanceBp(v.m,k[t.slot],t.centering):-1;
  const roll=R.rollFromRandomness(R.hex(v.rnd));
  if(String(seed)!==v.seed||JSON.stringify(k)!==JSON.stringify(v.kinds)||slot!==v.slot||c!==v.c||ch!==v.ch||roll!==v.roll){bad++;if(bad<4)console.log('MISMATCH',v.m,v.round,String(seed),v.seed,k,v.kinds,slot,v.slot,ch,v.ch,roll,v.roll);}
}
console.log(V.length,'vectors,',bad,'mismatches');process.exit(bad?1:0);
