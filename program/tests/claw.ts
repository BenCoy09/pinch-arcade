/**
 * Pinch's Arcade: end-to-end devnet test. Real session, real sealed drops, real receipts.
 * After every drop it recomputes the result from PUBLIC data (rules.js) and checks the
 * chain wrote exactly that. Prints measured latency. Nothing here is simulated.
 *
 * Run: npx ts-mocha -p ./tsconfig.json -t 1000000 tests/claw.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { web3 } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as nacl from "tweetnacl";
import {
  getAuthToken,
  PERMISSION_PROGRAM_ID,
  MAGIC_PROGRAM_ID,
  permissionPdaFromAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const R = require("./rules.js");

const VAULT_ID = new web3.PublicKey("MagicVau1t999999999999999999999999999999999");
const TEE_VALIDATOR = new web3.PublicKey("MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo");
const ER_QUEUE = new web3.PublicKey("5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc");
const SEED = "claw";
const OUT = ["pending", "miss", "slip", "hold", "void"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lat: { label: string; ms: number }[] = [];

describe("pinch-claw", () => {
  const idl = JSON.parse(fs.readFileSync("target/idl/pinch_spike.json", "utf8"));
  const teeUrl = process.env.TEE_PROVIDER_ENDPOINT || "https://devnet-tee.magicblock.app";
  const teeWs = process.env.TEE_WS_ENDPOINT || "wss://devnet-tee.magicblock.app";
  const wallet = anchor.Wallet.local();
  const base = new anchor.AnchorProvider(
    new web3.Connection(process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com", { commitment: "confirmed" }),
    wallet
  );
  anchor.setProvider(base);
  const program: any = new anchor.Program(idl, base);
  let er: anchor.AnchorProvider;
  let erProgram: any;
  const auth = wallet.publicKey.toBytes();
  const [sessionPDA] = web3.PublicKey.findProgramAddressSync(
    [Buffer.from(SEED), wallet.publicKey.toBuffer()], program.programId);
  const permissionPDA = permissionPdaFromAccount(sessionPDA);
  const accts = () => ({
    authority: wallet.publicKey, payer: wallet.publicKey, session: sessionPDA, permission: permissionPDA,
    magicProgram: MAGIC_PROGRAM_ID, permissionProgram: PERMISSION_PROGRAM_ID, ephemeralVault: VAULT_ID,
  });

  async function send(conn: web3.Connection, txp: Promise<web3.Transaction>, label: string, record = true) {
    const t0 = Date.now();
    let tx = await txp;
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    tx = await wallet.signTransaction(tx);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    for (let i = 0; i < 80; i++) {
      const st = (await conn.getSignatureStatuses([sig])).value[0];
      if (st) {
        if (st.err) throw new Error(`${label} failed on chain: ${JSON.stringify(st.err)}`);
        if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") break;
      }
      if (i === 79) throw new Error(`${label}: no confirmation after 32s (${sig})`);
      await sleep(400);
    }
    const ms = Date.now() - t0;
    if (record) lat.push({ label, ms });
    console.log(`  ${String(ms).padStart(5)}ms ${label} ${sig.slice(0, 20)}...`);
    return sig;
  }
  const sendEr = (b: Promise<web3.Transaction>, l: string, rec = true) => send(er.connection, b, l, rec);
  const fetchEr = () => erProgram.account.session.fetch(sessionPDA);

  function check(rc: any, label: string) {
    const rnd = Uint8Array.from(rc.randomness);
    const have = rc.outcome === 2 || rc.outcome === 3;
    const r = R.recompute(auth, rc.round, rc.machine, rc.xPm, have ? rnd : null);
    const problems: string[] = [];
    if (r.outcome === "miss") { if (rc.outcome !== 1) problems.push("expected miss"); }
    else {
      if (r.slot !== rc.slot) problems.push(`slot ${rc.slot}!=${r.slot}`);
      if (r.kind !== rc.kind) problems.push(`kind ${rc.kind}!=${r.kind}`);
      if (r.centering !== rc.centering) problems.push(`centering ${rc.centering}!=${r.centering}`);
      if (r.chance !== rc.chance) problems.push(`chance ${rc.chance}!=${r.chance}`);
      if (have) {
        if (r.roll !== rc.roll) problems.push(`roll ${rc.roll}!=${r.roll}`);
        const want = r.roll <= r.chance ? 3 : 2;
        if (want !== rc.outcome) problems.push(`outcome ${OUT[rc.outcome]}!=${OUT[want]}`);
      }
    }
    console.log(`  ${label}: ${problems.length ? "MISMATCH " + problems.join("; ") : "VERIFIED against the public rules"}`);
    return problems.length === 0;
  }

  function aim(machine: number, round: number, offset = 0) {
    const kinds = R.pitKinds(R.pitSeed(auth, round, machine), machine);
    let best = 0, bv = -1;
    for (let s = 0; s < 8; s++) {
      const v = R.VALUE[kinds[s]] * R.chanceBp(machine, kinds[s], 1000);
      if (v > bv) { bv = v; best = s; }
    }
    return { x: Math.max(0, Math.min(1000, R.slotX(best) + offset)), kinds, best };
  }

  before(async () => {
    const token = await getAuthToken(teeUrl, wallet.publicKey,
      (m: Uint8Array) => Promise.resolve(nacl.sign.detached(m, wallet.payer.secretKey)));
    er = new anchor.AnchorProvider(
      new web3.Connection(`${teeUrl}?token=${token.token}`, { wsEndpoint: `${teeWs}?token=${token.token}`, commitment: "confirmed" }),
      wallet);
    erProgram = new anchor.Program(idl, er);
    console.log("program", program.programId.toString(), "session", sessionPDA.toString());
  });

  it("1. initialize on Solana + delegate to the private rollup", async () => {
    if (!(await base.connection.getAccountInfo(sessionPDA))) {
      await send(base.connection, program.methods.initialize().accounts({ authority: wallet.publicKey }).transaction(), "initialize (Solana)", false);
    } else console.log("  account exists");
    const info = await base.connection.getAccountInfo(sessionPDA);
    if (info && info.owner.equals(program.programId)) {
      await send(base.connection, program.methods.delegate().accountsPartial({
        authority: wallet.publicKey, session: sessionPDA, validator: TEE_VALIDATOR }).transaction(), "delegate to TEE (Solana)", false);
      await sleep(3000);
    } else console.log("  already delegated");
  });

  it("2. open the permission (idempotent)", async () => {
    try { await sendEr(program.methods.initPermission().accountsPartial(accts()).transaction(), "init_permission", false); }
    catch (e: any) { console.log("  init_permission:", String(e.message ?? e).slice(0, 100), "(ok if it already exists)"); }
  });

  const plan = [
    { m: 0, off: 0, name: "Shell Shop, aimed true" },
    { m: 2, off: 30, name: "The Abyss, a little off-centre" },
    { m: 1, off: -20, name: "Reef Run, a little off-centre" },
  ];
  plan.forEach((p, i) => {
    it(`3.${i + 1} sealed drop: ${p.name}`, async () => {
      let s = await fetchEr();
      if (s.status === 1) throw new Error("a drop is still pending from an earlier run; wait 2 minutes and rerun");
      if (s.pearls < R.MACHINES[p.m].ticket) {
        await sendEr(program.methods.refill().accountsPartial(accts()).transaction(), "refill (faucet)", false);
        s = await fetchEr();
      }
      const before = s.pearls;
      const a = aim(p.m, s.round, p.off);
      console.log(`  pit ${a.kinds.map((k: number) => R.KINDS[k][0]).join("")}  aiming slot ${a.best} at x=${a.x}`);
      const t0 = Date.now();
      await sendEr(program.methods.dropClaw(p.m, a.x, Math.floor(Math.random() * 256))
        .accountsPartial({ ...accts(), oracleQueue: ER_QUEUE }).transaction(), "drop_claw (seal + VRF request)");
      await sleep(4500);
      await sendEr(program.methods.setPrivacy(false, false).accountsPartial(accts()).transaction(), "reveal (open the seal)");
      s = await fetchEr();
      for (let k = 0; k < 40 && s.status === 1; k++) { await sleep(3000); s = await fetchEr(); }
      if (s.status === 1) {
        console.log("  oracle has not answered; waiting for the 120s timeout, then refunding the ticket");
        await sleep(125000 - (Date.now() - t0));
        await sendEr(program.methods.cancelPending().accountsPartial(accts()).transaction(), "cancel_pending (refund)");
        s = await fetchEr();
      }
      const total = Date.now() - t0;
      const rc = s.ring[(s.round - 1) % 8];
      console.log(`  ${total}ms from drop to a readable result.  outcome=${OUT[rc.outcome]} roll=${rc.roll} chance=${(rc.chance / 100).toFixed(2)}%  prize=${rc.kind === 255 ? "none" : R.KINDS[rc.kind]}`);
      if (rc.outcome === 4) return;
      if (!check(rc, "receipt")) throw new Error("receipt does not match the public rules");
      const expect = before - R.MACHINES[p.m].ticket + (rc.outcome === 3 ? R.VALUE[rc.kind] : 0);
      console.log(`  pearls ${before} -> ${s.pearls} (expected ${expect})`);
      if (s.pearls !== expect) throw new Error("balance does not match the receipt");
    });
  });

  it("4. checkpoint to Solana, then verify from the base layer", async () => {
    await sendEr(program.methods.checkpoint().accountsPartial({ payer: wallet.publicKey, session: sessionPDA }).transaction(), "checkpoint (commit to Solana)", false);
    await sleep(4000);
    await sendEr(program.methods.undelegate().accountsPartial({ payer: wallet.publicKey, session: sessionPDA }).transaction(), "undelegate (settle on Solana)", false);
    let info: web3.AccountInfo<Buffer> | null = null;
    for (let i = 0; i < 40; i++) {
      info = await base.connection.getAccountInfo(sessionPDA);
      if (info && info.owner.equals(program.programId)) break;
      await sleep(750);
    }
    if (!info || !info.owner.equals(program.programId)) throw new Error("account did not return to Solana in time");
    let dec: any;
    try { dec = program.coder.accounts.decode("session", info.data); } catch { dec = program.coder.accounts.decode("Session", info.data); }
    const newest = dec.ring[(dec.round - 1) % 8];
    console.log(`  on Solana: pearls=${dec.pearls} drops=${dec.drops} wins=${dec.wins} paid=${dec.paid} won=${dec.won}`);
    if (!check(newest, "newest receipt, read from Solana")) throw new Error("base-layer receipt mismatch");
  });

  after(() => {
    console.log("\n=== MEASURED LATENCY (devnet, from this machine) ===");
    const by: Record<string, number[]> = {};
    lat.forEach((l) => (by[l.label] = (by[l.label] || []).concat(l.ms)));
    const rows: any = {};
    Object.keys(by).forEach((k) => { const a = by[k].sort((x, y) => x - y); rows[k] = { n: a.length, median_ms: a[Math.floor(a.length / 2)], max_ms: a[a.length - 1] }; });
    console.table(rows);
  });
});
