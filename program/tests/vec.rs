#[path = "game.rs"] mod game;
use game::*;
fn main(){
  let mut s=12345u64;
  println!("[");
  for i in 0..400u32 {
    s=splitmix64(s);
    let mut a=[0u8;32]; a[0..8].copy_from_slice(&s.to_le_bytes()); a[8]=i as u8;
    let mi=(i%3) as u8; let round=i*7;
    let seed=pit_seed(&a,round,mi); let k=pit_kinds(seed,mi);
    s=splitmix64(s); let x=(s%1001) as u32;
    let (slot,c,ch)=match pick_target(mi,x){Some((sl,c))=>(sl as i32,c as i32,chance_bp(mi,k[sl],c) as i32),None=>(-1,-1,-1)};
    let mut r=[0u8;32]; s=splitmix64(s); r[0..8].copy_from_slice(&s.to_le_bytes());
    let auth:String=a.iter().map(|b|format!("{:02x}",b)).collect();
    let rnd:String=r.iter().map(|b|format!("{:02x}",b)).collect();
    println!("{{\"auth\":\"{}\",\"round\":{},\"m\":{},\"seed\":\"{}\",\"kinds\":{:?},\"x\":{},\"slot\":{},\"c\":{},\"ch\":{},\"rnd\":\"{}\",\"roll\":{}}}{}",auth,round,mi,seed,k,x,slot,c,ch,rnd,roll_from_randomness(&r),if i<399{","}else{""});
  }
  println!("]");
}
