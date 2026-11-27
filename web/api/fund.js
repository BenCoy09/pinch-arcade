// Vercel serverless faucet for the demo. Sends a few cents of DEVNET SOL to a new player wallet.
// Env: FAUCET_SECRET = JSON array secret key of a funded devnet keypair. Devnet SOL only; has no value.
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require('@solana/web3.js');
const AMOUNT = 30_000_000; // 0.03 SOL
const seen = new Map(); // best-effort per-instance rate limit
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).end(JSON.stringify({ error: 'POST only' }));
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const to = new PublicKey(String(body.pubkey || ''));
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'ip';
    const now = Date.now(), n = (seen.get(ip) || []).filter((t) => now - t < 3600e3);
    if (n.length >= 5) return res.status(429).end(JSON.stringify({ error: 'rate limited' }));
    const conn = new Connection(process.env.DEVNET_RPC || 'https://api.devnet.solana.com', 'confirmed');
    if ((await conn.getBalance(to)) >= 15_000_000) return res.status(200).end(JSON.stringify({ ok: true, already: true }));
    const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.FAUCET_SECRET)));
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: AMOUNT }));
    const sig = await sendAndConfirmTransaction(conn, tx, [payer]);
    n.push(now); seen.set(ip, n);
    res.status(200).end(JSON.stringify({ ok: true, sig }));
  } catch (e) { res.status(500).end(JSON.stringify({ error: String(e.message || e).slice(0, 160) })); }
};
