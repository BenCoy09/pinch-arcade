// Pinch's Arcade: browser chain layer. No framework. Talks to Solana devnet and MagicBlock's
// private rollup (Intel TDX validator). Everything here is real; nothing is simulated.
// Needs globals: solanaWeb3 (web3.js IIFE) and nacl (tweetnacl) in the browser.
(function (root) {
  'use strict';
  let savedRpc = null; try { savedRpc = (root.localStorage && root.localStorage.getItem('pinch-rpc')) || new URLSearchParams(root.location.search).get('rpc'); } catch (e) { /* ignore */ }
  const CFG = Object.assign({
    program: 'D9dhoGvqXAngiJBsEzZiyuY3mv43VdU39WTBszuzgZnz',
    baseRpc: 'https://api.devnet.solana.com',
    teeRpc: 'https://devnet-tee.magicblock.app',
    teeValidator: 'MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo',
    erQueue: '5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc',
    fundUrl: '/api/fund',
    // Seeds below verified against the deployed program IDL (pda output) and the SDK PERMISSION_SEED.
    permissionSeed: 'permission:',
    bufferSeed: 'buffer',
    delegationSeed: 'delegation',
    delegationMetaSeed: 'delegation-metadata',
    identitySeed: 'identity',
    minLamports: 15000000,
  }, root.PINCH_CFG || {}, savedRpc ? { baseRpc: savedRpc } : {});

  // ---------------------------------------------------------------- pure helpers (testable in Node)
  const A58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58encode(bytes) {
    let digits = [0];
    for (let i = 0; i < bytes.length; i++) {
      let carry = bytes[i];
      for (let j = 0; j < digits.length; j++) { carry += digits[j] << 8; digits[j] = carry % 58; carry = (carry / 58) | 0; }
      while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
    }
    let out = '';
    for (let k = 0; k < bytes.length && bytes[k] === 0; k++) out += '1';
    for (let q = digits.length - 1; q >= 0; q--) out += A58[digits[q]];
    return out;
  }
  function b58decode(str) {
    const bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const v = A58.indexOf(str[i]);
      if (v < 0) throw new Error('bad base58');
      let carry = v;
      for (let j = 0; j < bytes.length; j++) { carry += bytes[j] * 58; bytes[j] = carry & 255; carry >>= 8; }
      while (carry) { bytes.push(carry & 255); carry >>= 8; }
    }
    for (let k = 0; k < str.length && str[k] === '1'; k++) bytes.push(0);
    return Uint8Array.from(bytes.reverse());
  }
  const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

  // Anchor discriminators, copied from the program's IDL.
  const DISC = {
    initialize: [175, 175, 109, 31, 13, 152, 155, 237],
    delegate: [90, 147, 75, 178, 85, 88, 4, 137],
    init_permission: [66, 14, 153, 250, 187, 36, 179, 236],
    set_privacy: [120, 77, 9, 207, 149, 140, 138, 129],
    drop_claw: [176, 101, 112, 189, 15, 40, 96, 244],
    cancel_pending: [74, 87, 109, 242, 64, 192, 151, 71],
    refill: [128, 207, 142, 11, 54, 232, 38, 201],
    checkpoint: [213, 200, 19, 204, 240, 143, 184, 252],
    undelegate: [131, 148, 180, 198, 91, 104, 42, 238],
  };
  const SESSION_DISC = [243, 81, 72, 115, 214, 188, 72, 144];
  const RING = 8;

  function ixData(name, args) {
    const d = DISC[name];
    const a = args || [];
    const out = new Uint8Array(8 + a.length);
    out.set(d, 0);
    out.set(a, 8);
    return out;
  }
  const encDrop = (machine, xpm, seed) => ixData('drop_claw', [machine & 255, xpm & 255, (xpm >> 8) & 255, seed & 255]);
  const encPrivacy = (isPrivate, playerCanRead) => ixData('set_privacy', [isPrivate ? 1 : 0, playerCanRead ? 1 : 0]);

  // Borsh layout of the Session account (see programs/pinch_spike/src/lib.rs).
  function decodeSession(u8) {
    for (let i = 0; i < 8; i++) if (u8[i] !== SESSION_DISC[i]) throw new Error('not a session account');
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 8;
    const authority = u8.slice(o, o + 32); o += 32;
    const s = { authority, authorityB58: b58encode(authority) };
    s.pearls = dv.getUint32(o, true); o += 4;
    s.round = dv.getUint32(o, true); o += 4;
    s.drops = dv.getUint32(o, true); o += 4;
    s.wins = dv.getUint32(o, true); o += 4;
    s.paid = dv.getUint32(o, true); o += 4;
    s.won = dv.getUint32(o, true); o += 4;
    s.refills = dv.getUint16(o, true); o += 2;
    s.status = dv.getUint8(o); o += 1;
    s.pendingTs = Number(dv.getBigInt64(o, true)); o += 8;
    s.ring = [];
    for (let i = 0; i < RING; i++) {
      const r = {};
      r.round = dv.getUint32(o, true); o += 4;
      r.machine = dv.getUint8(o); o += 1;
      r.xPm = dv.getUint16(o, true); o += 2;
      r.slot = dv.getUint8(o); o += 1;
      r.kind = dv.getUint8(o); o += 1;
      r.centering = dv.getUint16(o, true); o += 2;
      r.chance = dv.getUint16(o, true); o += 2;
      r.outcome = dv.getUint8(o); o += 1;
      r.roll = dv.getUint16(o, true); o += 2;
      r.randomness = u8.slice(o, o + 32); o += 32;
      s.ring.push(r);
    }
    s.inventory = [];
    for (let i = 0; i < 5; i++) { s.inventory.push(dv.getUint16(o, true)); o += 2; }
    return s;
  }
  // newest first, only receipts that really exist (round < s.round)
  function receipts(s) {
    const out = [];
    for (let r = s.round - 1; r >= 0 && r >= s.round - RING; r--) out.push(s.ring[r % RING]);
    return out.filter((x) => x.round < s.round);
  }
  const OUTCOME = ['pending', 'miss', 'slip', 'hold', 'void'];

  // ---------------------------------------------------------------- web3-backed part
  const W3 = () => root.solanaWeb3;
  const PK = (s) => new (W3().PublicKey)(s);
  let kp = null, base = null, er = null, pdas = null, tokenCache = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timings = {};

  function loadWallet() {
    const { Keypair } = W3();
    try {
      const raw = localStorage.getItem('pinch-arcade-key');
      if (raw) { kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))); return kp; }
    } catch (e) { /* fall through */ }
    kp = Keypair.generate();
    try { localStorage.setItem('pinch-arcade-key', JSON.stringify(Array.from(kp.secretKey))); } catch (e) { /* in-memory only */ }
    return kp;
  }
  function importWallet(b58) {
    const { Keypair } = W3();
    kp = Keypair.fromSecretKey(b58decode(b58.trim()));
    try { localStorage.setItem('pinch-arcade-key', JSON.stringify(Array.from(kp.secretKey))); } catch (e) { /* ignore */ }
    pdas = null; tokenCache = null; er = null;
    return kp;
  }
  const exportSecret = () => b58encode(kp.secretKey);
  const address = () => kp.publicKey.toBase58();

  function derive() {
    if (pdas) return pdas;
    const P = PK(CFG.program), enc = new TextEncoder();
    const find = (seeds, prog) => W3().PublicKey.findProgramAddressSync(seeds, prog)[0];
    const session = find([enc.encode('claw'), kp.publicKey.toBytes()], P);
    const DELEG = PK('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
    const PERM = PK('ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1');
    pdas = {
      program: P, session, deleg: DELEG, perm: PERM,
      permission: find([enc.encode(CFG.permissionSeed), session.toBytes()], PERM),
      buffer: find([enc.encode(CFG.bufferSeed), session.toBytes()], P),
      record: find([enc.encode(CFG.delegationSeed), session.toBytes()], DELEG),
      meta: find([enc.encode(CFG.delegationMetaSeed), session.toBytes()], DELEG),
      identity: find([enc.encode(CFG.identitySeed)], P),
      vault: PK('MagicVau1t999999999999999999999999999999999'),
      magic: PK('Magic11111111111111111111111111111111111111'),
      magicCtx: PK('MagicContext1111111111111111111111111111111'),
      vrf: PK('Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz'),
      slotHashes: PK('SysvarS1otHashes111111111111111111111111111'),
      system: PK('11111111111111111111111111111111'),
      queue: PK(CFG.erQueue), validator: PK(CFG.teeValidator),
    };
    return pdas;
  }
  const m = (pubkey, signer, writable) => ({ pubkey, isSigner: !!signer, isWritable: !!writable });
  function ix(keys, data) {
    return new (W3().TransactionInstruction)({ programId: derive().program, keys, data: data });
  }
  const permKeys = () => {
    const d = derive();
    return [m(kp.publicKey, 1, 1), m(d.session, 0, 1), m(d.permission, 0, 1), m(d.perm, 0, 0), m(d.vault, 0, 1), m(d.magic, 0, 0)];
  };
  const builders = {
    initialize: () => { const d = derive(); return ix([m(d.session, 0, 1), m(kp.publicKey, 1, 1), m(d.system, 0, 0)], ixData('initialize')); },
    delegate: () => { const d = derive(); return ix([m(kp.publicKey, 1, 0), m(d.buffer, 0, 1), m(d.record, 0, 1), m(d.meta, 0, 1), m(d.session, 0, 1), m(d.validator, 0, 0), m(d.program, 0, 0), m(d.deleg, 0, 0), m(d.system, 0, 0)], ixData('delegate')); },
    initPermission: () => ix(permKeys(), ixData('init_permission')),
    setPrivacy: (priv, read) => ix(permKeys(), encPrivacy(priv, read)),
    dropClaw: (machine, xpm, seed) => {
      const d = derive();
      return ix([m(kp.publicKey, 1, 1), m(d.session, 0, 1), m(d.permission, 0, 1), m(d.perm, 0, 0), m(d.vault, 0, 1), m(d.magic, 0, 0),
        m(d.queue, 0, 1), m(d.identity, 0, 0), m(d.vrf, 0, 0), m(d.slotHashes, 0, 0), m(d.system, 0, 0)], encDrop(machine, xpm, seed));
    },
    refill: () => ix([m(kp.publicKey, 1, 0), m(derive().session, 0, 1)], ixData('refill')),
    cancel: () => ix([m(kp.publicKey, 1, 0), m(derive().session, 0, 1)], ixData('cancel_pending')),
    checkpoint: () => { const d = derive(); return ix([m(kp.publicKey, 1, 1), m(d.session, 0, 1), m(d.magic, 0, 0), m(d.magicCtx, 0, 1)], ixData('checkpoint')); },
    undelegate: () => { const d = derive(); return ix([m(kp.publicKey, 1, 1), m(d.session, 0, 1), m(d.magic, 0, 0), m(d.magicCtx, 0, 1)], ixData('undelegate')); },
  };

  const bhCache = new Map();
  async function send(conn, instruction, label) {
    const t0 = performance.now();
    const tx = new (W3().Transaction)().add(instruction);
    tx.feePayer = kp.publicKey;
    let fresh = false;
    const hashFor = async (force) => {
      const c = bhCache.get(conn);
      if (!force && c && Date.now() - c.t < 8000) return c.h;
      const h = (await retry(() => conn.getLatestBlockhash())).blockhash; bhCache.set(conn, { h, t: Date.now() }); fresh = true; return h;
    };
    let sig;
    for (let attempt = 0; ; attempt++) {
      const t1 = new (W3().Transaction)().add(instruction);
      t1.feePayer = kp.publicKey; t1.recentBlockhash = await hashFor(attempt > 0); t1.sign(kp);
      try { sig = await retry(() => conn.sendRawTransaction(t1.serialize(), { skipPreflight: true })); break; }
      catch (e) { if (attempt >= 1 || !/blockhash/i.test(String(e.message || e))) throw e; }
    }
    for (let i = 0; i < 140; i++) {
      const st = (await retry(() => conn.getSignatureStatuses([sig]))).value[0];
      if (st) {
        if (st.err) throw new Error(label + ' failed on chain: ' + JSON.stringify(st.err));
        if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') break;
      }
      if (i === 139) throw new Error(label + ': no confirmation after 35s');
      await sleep(250);
    }
    const ms = Math.round(performance.now() - t0);
    timings[label] = ms;
    return { sig, ms };
  }
  async function retry(fn, n) {
    n = n || 9;
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        const msg = String((e && e.message) || e);
        if (i >= n - 1 || !/429|Too Many|rate|fetch|network|timeout/i.test(msg)) throw e;
        const wait = Math.min(6000, 700 * Math.pow(1.6, i)) + Math.random() * 400;
        if (root.PINCH_ONRETRY) root.PINCH_ONRETRY(i + 1, n);
        await sleep(wait);
      }
    }
  }
  async function getToken() {
    if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.token;
    const pk = address();
    const c = await (await fetch(CFG.teeRpc + '/auth/challenge?pubkey=' + pk)).json();
    if (!c.challenge) throw new Error('private rollup login: no challenge (' + (c.error || 'unknown') + ')');
    const sig = root.nacl.sign.detached(new TextEncoder().encode(c.challenge), kp.secretKey);
    const r = await fetch(CFG.teeRpc + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pubkey: pk, challenge: c.challenge, signature: b58encode(sig) }),
    });
    const j = await r.json();
    if (r.status !== 200 || !j.token) throw new Error('private rollup login failed: ' + (j.error || r.status));
    tokenCache = { token: j.token, expiresAt: j.expiresAt || Date.now() + 25 * 24 * 3600 * 1000 };
    return tokenCache.token;
  }
  async function connectEr() {
    const token = await getToken();
    er = new (W3().Connection)(CFG.teeRpc + '?token=' + token, { commitment: 'confirmed' });
    return er;
  }
  const baseConn = () => base || (base = new (W3().Connection)(CFG.baseRpc, { commitment: 'confirmed' }));

  async function balance() { return retry(() => baseConn().getBalance(kp.publicKey)); }
  async function ensureFunded(onNote) {
    let bal = await balance();
    if (bal >= CFG.minLamports) return bal;
    onNote && onNote('asking the faucet for a few cents of devnet SOL');
    try {
      const r = await fetch(CFG.fundUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pubkey: address() }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'faucet ' + r.status);
    } catch (e) {
      onNote && onNote('faucet unavailable, trying the public airdrop');
      try { await baseConn().requestAirdrop(kp.publicKey, 100000000); } catch (e2) { /* handled below */ }
    }
    for (let i = 0; i < 30; i++) { await sleep(1000); bal = await balance(); if (bal >= CFG.minLamports) return bal; }
    const err = new Error('needs devnet SOL'); err.code = 'NEEDS_FUNDS'; err.address = address(); throw err;
  }

  async function fetchBase() {
    const info = await retry(() => baseConn().getAccountInfo(derive().session));
    return info;
  }
  async function fetchEr() {
    const info = await retry(() => er.getAccountInfo(derive().session));
    return info ? decodeSession(new Uint8Array(info.data)) : null;
  }

  // Create (if needed) and delegate the player's arcade account, log in to the private rollup, open the permission.
  async function setup(onStep) {
    const step = (k, extra) => onStep && onStep(k, extra);
    loadWalletIfNeeded();
    step('wallet', { address: address() });
    await ensureFunded((n) => step('fund', { note: n }));
    step('funded');
    let info = await fetchBase();
    if (!info) { const r = await send(baseConn(), builders.initialize(), 'initialize'); step('created', r); info = await fetchBase(); }
    if (info && info.owner.equals(derive().program)) {
      const r = await send(baseConn(), builders.delegate(), 'delegate'); step('delegated', r);
      for (let i = 0; i < 40; i++) { info = await fetchBase(); if (info && !info.owner.equals(derive().program)) break; await sleep(700); }
    } else step('delegated', { ms: 0, already: true });
    await connectEr();
    step('login');
    let st = null;
    for (let i = 0; i < 40 && !st; i++) { st = await fetchEr().catch(() => null); if (!st) await sleep(800); }
    try { await send(er, builders.initPermission(), 'init_permission'); } catch (e) { /* exists already */ }
    st = (await fetchEr()) || st;
    step('ready', { state: st });
    return st;
  }
  function loadWalletIfNeeded() { if (!kp) loadWallet(); }

  // One sealed drop: seal + VRF request in a single transaction, then reveal and read the receipt.
  async function drop(machine, xpm, onPhase, known) {
    const ph = (k, x) => onPhase && onPhase(k, x);
    let st = known && known.status === 0 ? known : await fetchEr();
    if (st && st.status === 1) { ph('recover'); st = await resolvePending(ph); }
    const t0 = performance.now();
    const seed = Math.floor(Math.random() * 256);
    const first = await send(er, builders.dropClaw(machine, xpm, seed), 'drop_claw');
    ph('sealed', first);
    await sleep(900);
    ph('rolling');
    await send(er, builders.setPrivacy(false, false), 'reveal');
    ph('revealing');
    st = await waitResult(t0, ph);
    timings.total = Math.round(performance.now() - t0);
    return { state: st, signature: first.sig, ms: timings.total };
  }
  async function waitResult(t0, ph) {
    let st = await fetchEr();
    while (st && st.status === 1) {
      const elapsed = (performance.now() - t0) / 1000;
      if (elapsed > 130) {
        ph && ph('timeout');
        await send(er, builders.cancel(), 'cancel_pending');
        return fetchEr();
      }
      await sleep(500);
      st = await fetchEr();
    }
    return st;
  }
  async function resolvePending(ph) {
    try { await send(er, builders.setPrivacy(false, false), 'reveal'); } catch (e) { /* ignore */ }
    return waitResult(performance.now() - 20000, ph);
  }
  async function refill() { await send(er, builders.refill(), 'refill'); return fetchEr(); }
  // Commit the arcade account to Solana (stays in the rollup) so anyone can verify receipts from the base layer.
  async function saveToSolana() { const r = await send(er, builders.checkpoint(), 'checkpoint'); return r; }
  async function readBaseState(pubkey) {
    const P = PK(CFG.program), enc = new TextEncoder();
    const pda = W3().PublicKey.findProgramAddressSync([enc.encode('claw'), PK(pubkey).toBytes()], P)[0];
    const info = await retry(() => baseConn().getAccountInfo(pda));
    return info ? { state: decodeSession(new Uint8Array(info.data)), pda: pda.toBase58() } : null;
  }

  // ---- Golden Pearl Race: players are found from the program's own base-layer history (initialize/delegate
  // transactions), then each player's account is read from the base layer and decoded. Score only moves when a
  // player commits ("Save to Solana"), so the board is as fresh as the last commit. No server, no database.
  const raceScore = (s) => s.inventory[4] * 1000000 + Math.min(s.won, 999999);
  let raceCache = null;
  async function racers(force) {
    if (!force && raceCache && Date.now() - raceCache.t < 45000) return raceCache.rows;
    const conn = baseConn(), P = PK(CFG.program), enc = new TextEncoder();
    let sigs = [];
    try { sigs = await retry(() => conn.getSignaturesForAddress(P, { limit: 24 })); } catch (e) { /* fall back to your own row */ }
    const players = new Map();
    const todo = sigs.filter((x) => !x.err).map((x) => x.signature);
    let idx = 0;
    async function worker() {
      while (idx < todo.length) {
        const sig = todo[idx++];
        try {
          const tx = await retry(() => conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: 'confirmed' }));
          if (!tx) continue;
          const m = tx.transaction.message;
          const keys = m.staticAccountKeys || m.accountKeys;
          if (keys && keys[0]) players.set(keys[0].toBase58(), keys[0]);
        } catch (e) { /* skip this one */ }
        await sleep(150);
      }
    }
    await Promise.all([worker(), worker()]);
    if (kp) players.set(kp.publicKey.toBase58(), kp.publicKey);
    const list = Array.from(players.values());
    const pdasList = list.map((k) => W3().PublicKey.findProgramAddressSync([enc.encode('claw'), k.toBytes()], P)[0]);
    const rows = [];
    for (let i = 0; i < pdasList.length; i += 50) {
      const infos = await retry(() => conn.getMultipleAccountsInfo(pdasList.slice(i, i + 50)));
      infos.forEach((info, j) => {
        if (!info || info.data.length < 400) return;
        try {
          const s = decodeSession(new Uint8Array(info.data));
          if (s.drops === 0) return;
          rows.push({ player: list[i + j].toBase58(), golden: s.inventory[4], won: s.won, paid: s.paid, drops: s.drops, wins: s.wins, score: raceScore(s), inventory: s.inventory });
        } catch (e) { /* not a session */ }
      });
    }
    rows.sort((a, b) => b.score - a.score || a.drops - b.drops);
    raceCache = { t: Date.now(), rows };
    return rows;
  }

  const API = {
    CFG, b58encode, b58decode, toHex, DISC, SESSION_DISC, RING, OUTCOME, ixData, encDrop, encPrivacy, decodeSession, receipts,
    loadWallet, importWallet, exportSecret, address, balance, setup, drop, refill, saveToSolana, fetchEr, readBaseState,
    timings, derive, builders, sleep, racers, raceScore,
    get session() { return derive().session.toBase58(); },
  };
  if (typeof module !== 'undefined') module.exports = API; else root.Chain = API;
})(typeof self !== 'undefined' ? self : this);
