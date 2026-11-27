// Pinch's Arcade: game UI wired to the chain. The rules come from rules.js (identical to the on-chain program).
(function () {
  'use strict';
  const R = window.Rules, C = window.Chain;
  const $ = (id) => document.getElementById(id);
  const W = 360, H = 500, FLOOR = 452, HOME = 50, XMIN = 22, XMAX = 342, CHUTE_X = 16;
  const pxOf = (pm) => XMIN + (pm * (XMAX - XMIN)) / 1000;
  const pmOf = (px) => Math.max(0, Math.min(1000, Math.round(((px - XMIN) * 1000) / (XMAX - XMIN))));
  const pc = (v) => (v * 100).toFixed(v >= 0.995 || v <= 0.005 ? 0 : 1) + '%';
  const bp = (v) => (v / 100).toFixed(2) + '%';

  // ---- feel per machine (client side only; the odds themselves are the on-chain rules)
  const MV = [
    { id: 'shell', c: '#79C2D0', cab: '#4FA3B5', tag: 'Easy', depth: 'Shallows', timer: 0, blurb: 'Morning shallows. Wide claw, still water. Learn the feel.', say: "Seal's on, and I can't peek either. Line it up." },
    { id: 'reef', c: '#6FB1CC', cab: '#2C6E8A', tag: 'Medium', depth: 'Reef', timer: 12, blurb: 'A narrower claw and a lantern fish somewhere in the pit. Twelve seconds to aim.', say: "Reef's tighter. The seal's on. Twelve seconds." },
    { id: 'abyss', c: '#7DF3E1', cab: '#1A2350', tag: 'Hard', depth: 'Abyss', timer: 8, blurb: "Night dive. Only the claw's lantern lights the pit, and the golden pearl Crimp promised is always down there.", say: "Night dive. The lantern's all we've got. Seal's on." },
  ];
  const DEPTH = { shell: ['#8ED8E3', '#2C7C95', '#2A6E80', '#3F8FA3'], reef: ['#2F7392', '#10303F', '#0E2C39', '#17404F'], abyss: ['#0B1230', '#03050C', '#070B1C', '#101833'] };

  // ---- sound (tiny, optional)
  let soundOn = true, ac = null;
  try { soundOn = localStorage.getItem('pinch-sound') !== '0'; } catch (e) { /* default on */ }
  function tone(f, d, type, v, slide, at) {
    if (!soundOn) return;
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + (at || 0);
      o.type = type || 'sine'; o.frequency.setValueAtTime(f, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + d);
      g.gain.setValueAtTime(v || 0.08, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + d + 0.02);
    } catch (e) { /* no audio */ }
  }
  const sfx = {
    tick() { tone(900, 0.03, 'square', 0.025); },
    whirr() { tone(420, 0.9, 'sawtooth', 0.035, -300); },
    clack() { tone(180, 0.08, 'square', 0.08); tone(120, 0.1, 'square', 0.05, 0, 0.05); },
    seal() { tone(150, 0.12, 'square', 0.1); tone(90, 0.2, 'sine', 0.1, -30, 0.04); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.09, 0, i * 0.09)); },
    slip() { tone(330, 0.35, 'triangle', 0.09, -200); },
    miss() { tone(200, 0.2, 'sine', 0.06, -80); },
  };
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* ignore */ } };
  function paintSnd() { $('sndWave').style.display = soundOn ? '' : 'none'; }
  $('sndBtn').addEventListener('click', () => { soundOn = !soundOn; try { localStorage.setItem('pinch-sound', soundOn ? '1' : '0'); } catch (e) { /* ignore */ } paintSnd(); sfx.tick(); });
  paintSnd();

  // ---- state
  const cv = $('cv'), ctx = cv.getContext('2d');
  let dpr = 1;
  const calm = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  function fit() { dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; }
  fit();
  const BUB = []; for (let i = 0; i < 22; i++) BUB.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2.5, s: 8 + Math.random() * 16 });
  const G = { m: 0, st: null, pit: [], state: 'idle', t: 0, clawX: 200, headY: HOME, open: 1, tgt: null, res: null, pending: null, carry: null, cdx: 0, cdy: 0, fall: null, shake: 0, stop: 0, keys: { l: false, r: false }, drag: null, timer: 0, lastTickX: 0, dropStart: 0, last: null };
  let running = false;

  const authBytes = () => G.st.authority;
  function pitFor(round, machine) {
    const kinds = R.pitKinds(R.pitSeed(authBytes(), round, machine), machine);
    return kinds.map((k, i) => {
      const type = TYPES[k], r = PRIZES[type].r;
      return { i, kind: k, type, r, x: pxOf(R.slotX(i)), y: FLOOR - r - (i % 2 ? 16 : 0), gone: false, falling: false, fallY: 0, fallV: 0 };
    });
  }
  const say = (txt, mood) => { $('bubble').textContent = txt; const s = document.querySelector('#sayAv svg'); if (s) s.setAttribute('class', 'pinch ' + (mood || 'idle')); };
  const toast = (t) => { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 3200); };
  function showView(v) { ['start', 'street', 'hub', 'cab'].forEach((k) => { $('v-' + k).hidden = k !== v; }); window.scrollTo(0, 0); if (v !== 'cab') stopLoop(); if (v !== 'street' && window.Street) window.Street.stop(); }
  function showSheet(html) { $('sheetBody').innerHTML = html; $('sheet').hidden = false; }
  function hideSheet() { $('sheet').hidden = true; }
  $('sheet').addEventListener('click', (e) => { if (e.target === $('sheet') && G.state !== 'busy') hideSheet(); });
  function setPads() { const on = G.state === 'aim'; ['bL', 'bR', 'bD'].forEach((i) => { $(i).disabled = !on; }); }
  function updHeader() { if (!G.st) return; $('bal').textContent = G.st.pearls; $('pearlPill').hidden = false; }

  // ---- start flow (every step is a real transaction or request)
  const STEPS = [
    ['wallet', 'Throwaway wallet in this browser'], ['fund', 'A few cents of devnet SOL'], ['created', 'Arcade account created on Solana'],
    ['delegated', 'Account moved into the private rollup'], ['login', 'Logged in to the sealed room'], ['ready', 'Machines ready'],
  ];
  function renderSteps(cur, info, failed) {
    const el = $('steps'); el.hidden = false;
    const idx = STEPS.findIndex((s) => s[0] === cur);
    el.innerHTML = STEPS.map((s, i) => {
      const cls = i < idx ? 'ok' : i === idx ? (failed ? 'bad' : 'run') : '';
      const extra = info[s[0]] || {};
      const small = extra.address ? '<br><small>' + extra.address + '</small>' : extra.note ? '<br><small>' + extra.note + '</small>' : '';
      return '<li class="' + cls + '"><span class="dot"></span><span>' + s[1] + small + '</span><span class="ms">' + (extra.ms != null && i < idx ? (extra.already ? 'already' : (extra.ms / 1000).toFixed(1) + 's') : '') + '</span></li>';
    }).join('');
  }
  async function start() {
    $('startBtn').disabled = true; $('startErr').innerHTML = '';
    const info = {}; let cur = 'wallet';
    renderSteps('wallet', info);
    try {
      C.loadWallet();
      $('walletTxt').textContent = C.address().slice(0, 4) + '…' + C.address().slice(-4); $('walletChip').hidden = false;
      const order = { wallet: 'fund', funded: 'created', created: 'delegated', delegated: 'login', login: 'ready' };
      const st = await C.setup((k, x) => {
        if (k === 'funded') { cur = 'created'; } else if (k === 'fund') { cur = 'fund'; info.fund = x; } else { info[k] = x || {}; cur = order[k] || k; }
        if (k === 'wallet') cur = 'fund';
        renderSteps(cur, info);
      });
      G.st = st; renderSteps('ready', info);
      document.querySelectorAll('#steps li').forEach((li) => li.classList.add('ok'));
      await C.sleep(500);
      home();
    } catch (e) {
      renderSteps(cur, info, true);
      let html;
      if (e.code === 'NEEDS_FUNDS') {
        html = '<div class="err"><b>The faucet is busy, so this wallet needs a few cents of devnet SOL.</b> Send 0.05 devnet SOL to this address, then continue:<code>' + e.address + '</code>'
          + '<div class="row2"><button class="btn" id="copyAddr">Copy address</button><a class="btn" href="https://faucet.solana.com" target="_blank" rel="noopener">Open the Solana faucet</a><button class="btn pri" id="retryBtn">I sent it, continue</button></div></div>';
      } else {
        html = '<div class="err"><b>That step failed.</b> ' + String(e.message || e).replace(/[<>]/g, '') + '<div class="row2"><button class="btn pri" id="retryBtn">Try again</button></div></div>';
      }
      $('startErr').innerHTML = html;
      const rb = $('retryBtn'); if (rb) rb.addEventListener('click', start);
      const cb = $('copyAddr'); if (cb) cb.addEventListener('click', () => { try { navigator.clipboard.writeText(e.address); toast('Copied'); } catch (x) { toast(e.address); } });
    } finally { $('startBtn').disabled = false; }
  }
  $('startBtn').addEventListener('click', start);

  // ---- hub
  function chipCanvas(type) { const c = document.createElement('canvas'); paintPrize(c, type, 30); return c; }
  function home() { const sv = $('stVerify'); if (sv) sv.href = 'verify.html?p=' + C.address(); if (window.Street) { showView('street'); window.Street.enter(); updHeader(); } else enterHub(); }
  function enterHub() {
    showView('hub'); renderHub(); say('', 'idle');
  }
  function renderHub() {
    const st = G.st; updHeader();
    $('mlist').innerHTML = '';
    R.MACHINES.forEach((m, i) => {
      const v = MV[i], broke = st.pearls < m.ticket;
      const b = document.createElement('button');
      b.className = 'mcard'; b.style.setProperty('--c', v.c); b.disabled = false;
      const bestKind = Math.max(...m.mix.map((w, k) => (w > 0 ? k : -1)));
      const chips = m.mix.map((w, k) => (w > 0 ? '<span class="pitrow" title="' + PRIZES[TYPES[k]].name + ' ' + w / 10 + '%"></span>' : '')).join('');
      b.innerHTML = '<div class="mc-top"><span class="chip" style="--c:' + v.c + '">' + v.tag + '</span><span class="claws">' + [0, 1, 2].map((n) => '<span class="' + (n <= i ? 'on' : '') + '"></span>').join('') + '</span></div>'
        + '<h3>' + m.name + '</h3><div class="mc-prizes" id="mp' + i + '"></div>'
        + '<p style="color:var(--fog);font-size:.9rem">' + v.blurb + '</p>'
        + '<dl class="mc-stats"><div><dt>Ticket</dt><dd>' + m.ticket + '</dd></div><div><dt>Grip floor</dt><dd>' + (m.floor_pm / 10).toFixed(0) + '%</dd></div><div><dt>Claw</dt><dd>' + (m.span_pm / 10).toFixed(0) + '%</dd></div></dl>'
        + '<div class="mc-cta" style="' + (broke ? 'opacity:.45;box-shadow:none' : '') + '">' + (broke ? 'Need ' + m.ticket + ' pearls' : 'Play for ' + m.ticket + ' pearls') + '</div>';
      b.addEventListener('click', () => { if (broke) { toast('Not enough pearls for this machine'); return; } enterMachine(i); });
      $('mlist').appendChild(b);
      const holder = b.querySelector('#mp' + i);
      m.mix.forEach((w, k) => { if (w > 0) { const c = chipCanvas(TYPES[k]); c.title = PRIZES[TYPES[k]].name + ' ' + w / 10 + '% of the pit'; c.style.width = c.style.height = '36px'; holder.appendChild(c); } });
    });
    $('shelf').innerHTML = TYPES.map((t, k) => '<div class="scard"><canvas data-t="' + t + '"></canvas><b>' + st.inventory[k] + '</b><span style="font-size:.72rem;color:var(--fog)">' + PRIZES[t].name + '</span></div>').join('');
    document.querySelectorAll('#shelf canvas').forEach((c) => paintPrize(c, c.dataset.t, 64));
    const rtp = st.paid ? Math.round((st.won / st.paid) * 100) + '%' : '--';
    $('stats').innerHTML = '<div><dt>Drops</dt><dd>' + st.drops + '</dd></div><div><dt>Held</dt><dd>' + st.wins + '</dd></div><div><dt>Paid / won</dt><dd>' + st.paid + ' / ' + st.won + '</dd></div><div><dt>Your payout</dt><dd>' + rtp + '</dd></div>';
    $('refillBtn').hidden = !(st.pearls < 5);
    $('verifyLink').href = 'verify.html?p=' + C.address();
    const T = C.timings;
    $('lat').innerHTML = T.total ? 'Last drop measured from your device: drop + seal <b>' + (T.drop_claw / 1000).toFixed(1) + 's</b> · reveal <b>' + ((T.reveal || 0) / 1000).toFixed(1) + 's</b> · drop to result <b>' + (T.total / 1000).toFixed(1) + 's</b>. Turn-based on purpose: each step is a real confirmed transaction.' : 'Every step is a real confirmed transaction, so a drop takes several seconds. Turn-based on purpose.';
  }
  $('refillBtn').addEventListener('click', async () => {
    $('refillBtn').disabled = true;
    try { G.st = await C.refill(); toast('Pearls refilled. The faucet is counted on your stats.'); renderHub(); } catch (e) { toast('Refill failed: ' + String(e.message || e).slice(0, 90)); }
    $('refillBtn').disabled = false;
  });
  $('saveBtn').addEventListener('click', async () => {
    $('saveBtn').disabled = true; $('saveBtn').textContent = 'Saving…';
    try { await C.saveToSolana(); toast('Committed to Solana. Your receipts are now readable from the base layer.'); } catch (e) { toast('Save failed: ' + String(e.message || e).slice(0, 90)); }
    $('saveBtn').disabled = false; $('saveBtn').textContent = 'Save to Solana';
  });
  $('keyBtn').addEventListener('click', () => {
    showSheet('<h2>Your throwaway key</h2><p class="lead">This browser holds the key to your arcade account on devnet. It is only worth test pearls. Copy it to restore on another device. Anyone with it controls this account.</p><div class="ticket static" style="padding:14px"><div class="raw" style="font-family:var(--mono);font-size:.8rem;word-break:break-all;color:#1B1A14">' + C.exportSecret() + '</div></div><div class="row2"><button class="btn" id="copyKey">Copy</button><button class="btn pri" id="closeKey">Close</button></div>');
    $('copyKey').addEventListener('click', () => { try { navigator.clipboard.writeText(C.exportSecret()); toast('Copied'); } catch (e) { toast('Select the text and copy it'); } });
    $('closeKey').addEventListener('click', hideSheet);
  });

  // ---- machine
  function enterMachine(i) {
    G.m = i; const v = MV[i];
    G.pit = pitFor(G.st.round, i);
    $('mName').textContent = R.MACHINES[i].name; $('mTicket').textContent = R.MACHINES[i].ticket + ' pearls';
    $('cab').style.setProperty('--cab', v.cab);
    G.clawX = 200; G.headY = HOME; G.open = 1; G.carry = null; G.res = null; G.pending = null; G.t = 0; G.stop = 0;
    G.timer = v.timer; $('tbarw').hidden = !v.timer;
    G.state = 'aim'; $('phase').hidden = true;
    $('commit').innerHTML = 'public pit #' + G.st.round;
    showView('cab'); setPads(); fit(); say(v.say, 'idle'); startLoop(); sfx.tick();
  }
  $('back').addEventListener('click', () => { if (G.state === 'busy') return; G.state = 'idle'; home(); });

  // ---- drop flow
  function glyph(sigOrHex) { // 30 hex chars from a signature or hex string
    let hex = sigOrHex;
    if (!/^[0-9a-f]+$/i.test(hex)) { try { hex = C.toHex(C.b58decode(hex)); } catch (e) { hex = '00'; } }
    return (hex + '0123456789abcdef0123456789abcdef0123456789').slice(0, 30);
  }
  const PH = [['Dropped and sealed', 'one transaction'], ['VRF roll in flight', 'MagicBlock oracle'], ['Seal opened', 'reveal'], ['Receipt checked here', 'your browser']];
  function phaseUI(idx, times, sealHash) {
    $('phase').hidden = false;
    $('phList').innerHTML = PH.map((p, i) => '<li class="' + (i < idx ? 'done' : i === idx ? 'on' : '') + '"><span>' + (i < idx ? '✓ ' : i === idx ? '… ' : '') + p[0] + '</span><b>' + (times[i] != null ? (times[i] / 1000).toFixed(1) + 's' : p[1]) + '</b></li>').join('');
    if (sealHash !== undefined) $('phSeal').innerHTML = sealHash ? sealSVG(sealHash, 'wax', 'stampdrop') : '';
  }
  async function doDrop() {
    if (G.state !== 'aim') return;
    const m = R.MACHINES[G.m], v = MV[G.m];
    if (G.st.pearls < m.ticket) { say('Not enough pearls for this one.', 'sad'); return; }
    const xpm = pmOf(G.clawX), tg = R.pickTarget(G.m, xpm);
    G.tgt = tg ? G.pit[tg.slot] : null; G.pending = null; G.res = null;
    G.state = 'down'; setPads(); $('tbarw').hidden = true; sfx.whirr(); buzz(15);
    say('Dropping. The seal goes on first.', 'idle');
    const t0 = performance.now(); G.dropStart = t0;
    const times = [null, null, null, null];
    phaseUI(0, times, '');
    let sealHash = '';
    try {
      const out = await C.drop(G.m, xpm, (k, x) => {
        const el = performance.now() - t0;
        if (k === 'sealed') { times[0] = el; sealHash = glyph(x.sig); phaseUI(1, times, sealHash); sfx.seal(); buzz(30); say("Sealed. I can't see the roll and neither can you.", 'idle'); }
        else if (k === 'rolling') { phaseUI(1, times); }
        else if (k === 'revealing') { times[1] = el; phaseUI(2, times); say('Opening the seal…', 'idle'); }
        else if (k === 'recover') { say('Finishing your last drop first…', 'idle'); }
        else if (k === 'timeout') { say("The oracle didn't answer. Refunding your ticket.", 'sad'); }
      }, G.st);
      times[2] = performance.now() - t0;
      G.st = out.state;
      const rc = C.receipts(out.state)[0];
      const ver = verifyReceipt(rc);
      times[3] = performance.now() - t0; phaseUI(4, times);
      G.pending = { rc, ver, sig: out.signature, sealHash: sealHash || glyph(out.signature), ms: out.ms };
      if (G.state === 'wait') beginGrab();
    } catch (e) {
      G.state = 'aim'; G.headY = HOME; G.open = 1; setPads(); $('phase').hidden = true;
      say('Something broke. Nothing was lost.', 'sad');
      showSheet('<h2>That drop did not finish</h2><p class="lead">' + String(e.message || e).replace(/[<>]/g, '').slice(0, 220) + '</p><p class="lead">Your account is safe. If a roll was pending, it resolves or refunds on its own. Try again in a moment.</p><div class="row2"><button class="btn pri" id="errOk">OK</button></div>');
      $('errOk').addEventListener('click', hideSheet);
      try { G.st = (await C.fetchEr()) || G.st; updHeader(); } catch (x) { /* ignore */ }
    }
  }
  $('bD').addEventListener('click', doDrop);

  function verifyReceipt(rc) {
    const have = rc.outcome === 2 || rc.outcome === 3;
    const r = R.recompute(authBytes(), rc.round, rc.machine, rc.xPm, have ? rc.randomness : null);
    const bad = [];
    if (r.outcome === 'miss') { if (rc.outcome !== 1) bad.push('expected a miss'); }
    else if (rc.outcome === 4) { return { ok: true, r, void: true, bad }; }
    else {
      if (r.slot !== rc.slot) bad.push('slot'); if (r.kind !== rc.kind) bad.push('prize'); if (r.centering !== rc.centering) bad.push('centering');
      if (r.chance !== rc.chance) bad.push('chance');
      if (have) { if (r.roll !== rc.roll) bad.push('roll'); const want = r.roll <= r.chance ? 3 : 2; if (want !== rc.outcome) bad.push('verdict'); }
    }
    return { ok: bad.length === 0, r, bad };
  }

  function beginGrab() {
    const p = G.pending; if (!p) return;
    const rc = p.rc; G.res = rc;
    if (rc.outcome === 4) { G.state = 'rise'; G.riseFrom = G.headY; G.carry = null; G.slipDone = true; return; }
    G.carry = G.tgt && rc.outcome !== 1 ? G.tgt : null;
    if (G.carry) { G.cdx = G.carry.x - G.clawX; G.cdy = G.carry.y - (G.headY + ARM); G.carry.lifted = true; }
    G.state = 'grab'; G.stop = 0.08; G.shake = 0.2; sfx.clack(); buzz(40);
    G.slipDone = false; G.slipAt = 0.2 + 0.6 * ((rc.roll || 5000) / 10000);
    say(rc.outcome === 3 ? 'It holds…' : rc.outcome === 2 ? 'Gripping…' : 'Closed on nothing.', 'idle');
  }
  function slip() {
    G.slipDone = true; const p = G.carry; if (!p) return;
    p.lifted = false; p.falling = true; p.fallY = G.headY + ARM + G.cdy; p.fallV = 0; G.carry = null; G.shake = 0.25; sfx.slip(); buzz([20, 40, 20]);
    say('Slipped. That was the roll, not me.', 'sad');
  }
  function finishRound() {
    G.state = 'result'; G.resultTimer = 0.7; G.headY = HOME;
    const rc = G.res;
    if (rc.outcome === 3) { sfx.win(); buzz([30, 40, 60]); say(rc.kind === 4 ? "Golden pearl. Crimp never had one. I do." : 'Held. Check the receipt.', 'happy'); }
    else if (rc.outcome === 2) say('Slipped. The receipt says why.', 'sad');
    else if (rc.outcome === 1) { sfx.miss(); say('Nothing under the claw.', 'sad'); }
    updHeader();
  }

  // ---- receipt sheet
  function showReceipt(p, fresh) {
    const rc = p.rc, v = p.ver, m = R.MACHINES[rc.machine], r = v.r;
    const hold = rc.outcome === 3, miss = rc.outcome === 1, voided = rc.outcome === 4, gold = hold && rc.kind === 4;
    const type = rc.kind < 5 ? TYPES[rc.kind] : null;
    const title = voided ? 'No answer from the oracle' : gold ? 'The Golden Pearl' : hold ? PRIZES[type].name : rc.outcome === 2 ? 'Slipped' : 'Empty grab';
    const sub = voided ? 'Your ticket was refunded.' : gold ? 'The pearl Crimp promised. This receipt proves it was held fairly.' : hold ? PRIZES[type].rarity + ' / ' + R.VALUE[rc.kind] + ' pearls' : rc.outcome === 2 ? 'The roll landed above your hold chance.' : 'The claw closed on nothing.';
    const pitSeed = String(r.seed);
    const rndHex = C.toHex(rc.randomness);
    let meter = '', rows;
    if (!miss && !voided) {
      const roll = rc.roll / 10000, chance = rc.chance / 10000;
      meter = '<div><div style="display:flex;justify-content:space-between;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:#6B6247"><span>Hold chance ' + bp(rc.chance) + '</span><span>Sealed roll ' + bp(rc.roll) + '</span></div>'
        + '<div class="meter" aria-hidden="true"><i style="width:' + chance * 100 + '%;background:' + (hold ? '#2E7D5B' : '#8A7F5E') + '"></i><u style="left:calc(' + roll * 100 + '% - 2px)"></u></div></div>';
    }
    const delta = voided ? 0 : (hold ? R.VALUE[rc.kind] : 0) - m.ticket;
    rows = '<div class="t-rows"><div><span>Machine</span><b>' + m.name + '</b></div><div><span>Drop number</span><b>' + rc.round + '</b></div>'
      + '<div><span>Claw position</span><b>' + (rc.xPm / 10).toFixed(1) + '%</b></div>'
      + (miss || voided ? '' : '<div><span>Under the claw</span><b>slot ' + (rc.slot + 1) + ' of 8: ' + PRIZES[type].name + '</b></div><div><span>Your centering</span><b>' + (rc.centering / 10).toFixed(1) + '%</b></div>'
        + '<div><span>Grip floor / prize weight</span><b>' + (m.floor_pm / 10).toFixed(0) + '% / x ' + (R.GRIP_PM[rc.kind] / 1000).toFixed(2) + '</b></div>'
        + '<div><span>Hold chance (fixed before the roll)</span><b>' + bp(rc.chance) + '</b></div><div><span>Roll, 1 to 10000</span><b>' + rc.roll + '</b></div><div><span>Rule</span><b>roll at or below chance holds</b></div>')
      + '<div><span>Pearls</span><b>' + (delta >= 0 ? '+' : '') + delta + '</b></div><div><span>Pit seed (public)</span><b>' + pitSeed + '</b></div></div>';
    const stamp = v.ok ? '<span class="stamp-ok">VERIFIED</span>' : '<span class="stamp-bad">MISMATCH</span>';
    const left = p.sealHash || glyph(pitSeed.length >= 30 ? pitSeed : (pitSeed + '0123456789012345678901234567890').slice(0, 30).replace(/[^0-9a-f]/gi, 'a'));
    const html = '<div class="ticket ' + (gold ? 'gold ' : '') + (fresh ? 'reveal' : 'static') + '">'
      + '<div class="t-head"><span>Pinch\'s Arcade</span><span>No. ' + String(rc.round).padStart(4, '0') + '</span></div>'
      + '<div class="t-seals"><div><div class="seal-wrap">' + sealSVG(left) + '</div><small>Sealed before</small></div><div class="eq">=</div>'
      + '<div><div class="openseal">' + openedSVG(glyph(rndHex), v.ok) + (fresh ? sealSVG(left, 'crack') : '') + '</div><small>Opened after</small></div></div>'
      + '<div class="tcols"><div class="tl"><div class="stampwrap">' + stamp + '</div><div class="perf"></div>'
      + '<div class="t-title"><canvas id="rcv"></canvas><h2>' + title + '</h2><div class="t-sub">' + sub + '</div></div></div><div class="tr">' + meter + rows
      + '<div class="t-sub" style="margin-top:8px">' + (v.ok ? 'Recomputed in your browser from public data: the pit, the target, the hold chance and the verdict all match what the chain wrote.' : 'This browser could not reproduce the chain\'s numbers (' + v.bad.join(', ') + '). Do not trust this receipt.') + '</div>'
      + '<details><summary>Raw proof</summary><div class="raw">VRF output ' + rndHex + '<br>roll = first four bytes (little-endian) mod 10000 + 1<br>pit seed = splitmix64(player key, drop number, machine)' + (p.sig ? '<br>drop transaction ' + p.sig : '') + '</div></details></div></div></div>'
      + (fresh ? '<div class="row3"><button class="btn pri" id="again">Play again</button><button class="btn" id="mach">Machines</button><button class="btn" id="copyRc">Copy receipt</button></div>' : '<div class="row3"><button class="btn pri" id="closeR">Close</button></div>');
    showSheet(html);
    if (type && !voided) { paintPrize($('rcv'), type, 88); if (rc.outcome === 2) $('rcv').style.opacity = '.45'; } else $('rcv').style.display = 'none';
    const copy = $('copyRc'); if (copy) copy.addEventListener('click', () => { const j = JSON.stringify({ player: C.address(), round: rc.round, machine: rc.machine, xPm: rc.xPm, slot: rc.slot, kind: rc.kind, centering: rc.centering, chance: rc.chance, roll: rc.roll, outcome: C.OUTCOME[rc.outcome], vrf: rndHex }); try { navigator.clipboard.writeText(j); toast('Receipt copied'); } catch (e) { toast('Copy failed'); } });
    if (fresh) {
      $('again').addEventListener('click', () => { hideSheet(); G.state = 'idle'; if (G.st.pearls >= m.ticket) enterMachine(G.m); else { home(); toast('Out of pearls for this machine'); } });
      $('mach').addEventListener('click', () => { hideSheet(); G.state = 'idle'; home(); });
    } else $('closeR').addEventListener('click', hideSheet);
  }

  function afterDrop(p) {
    if (window.Street) window.Street.afterDrop();
    const rc = p.rc;
    if (rc.outcome === 3 && rc.kind >= 3) { // rare hold: commit so the race board and verifier can see it
      C.saveToSolana().then(() => { if (window.Street) window.Street.markSaved(); toast('Saved to Solana: your rare prize is on the race board.'); }).catch(() => {});
    }
  }
  $('toStreet').addEventListener('click', home);
  $('stShelf').addEventListener('click', enterHub);
  $('stSave').addEventListener('click', async () => {
    const b = $('stSave'); b.disabled = true; b.textContent = 'Saving…';
    try { await C.saveToSolana(); if (window.Street) window.Street.markSaved(); toast('Committed to Solana. Now press Verify my receipts.'); } catch (e) { toast('Save failed: ' + String(e.message || e).slice(0, 90)); }
    b.disabled = false; b.textContent = 'Save to Solana';
  });

  // ---- loop
  function update(dt) {
    if (G.stop > 0) { G.stop -= dt; return; }
    G.t += dt; if (G.shake > 0) G.shake -= dt;
    const v = MV[G.m];
    for (const p of G.pit) { if (p.falling) { p.fallV += 900 * dt; p.fallY += p.fallV * dt; if (p.fallY >= p.y) { p.falling = false; p.fallY = p.y; } } }
    if (G.state === 'aim') {
      let dx = 0; if (G.keys.l) dx -= 1; if (G.keys.r) dx += 1;
      if (dx) { G.drag = null; G.clawX += dx * 140 * dt; } else if (G.drag != null) { const d = G.drag - G.clawX, s = 300 * dt; G.clawX += Math.abs(d) < s ? d : Math.sign(d) * s; }
      G.clawX = Math.max(XMIN, Math.min(XMAX, G.clawX));
      if (Math.abs(G.clawX - G.lastTickX) > 14) { G.lastTickX = G.clawX; sfx.tick(); }
      if (v.timer) { G.timer -= dt; $('tbar').style.width = Math.max(0, (G.timer / v.timer) * 100) + '%'; if (G.timer <= 0) { say('Time is up. Dropping for you.', 'sad'); doDrop(); } }
    } else if (G.state === 'down') {
      G.headY += 300 * dt; const tip = G.headY + ARM;
      const stopY = G.tgt ? G.tgt.y - G.tgt.r + 6 : FLOOR - 4;
      if (tip >= stopY) { G.headY = stopY - ARM; G.state = 'wait'; if (G.pending) beginGrab(); }
    } else if (G.state === 'wait') {
      G.open = 0.55 + 0.06 * Math.sin(G.t * 9);
    } else if (G.state === 'grab') {
      G.open = Math.max(0, G.open - dt / 0.4);
      if (G.open <= 0) { G.state = 'rise'; G.riseFrom = G.headY; sfx.clack(); }
    } else if (G.state === 'rise') {
      G.cdx *= Math.max(0, 1 - 4 * dt); G.cdy += (0 - G.cdy) * 0; G.headY -= 200 * dt;
      const prog = (G.riseFrom - G.headY) / Math.max(1, G.riseFrom - HOME);
      if (G.res && G.res.outcome === 2 && !G.slipDone && prog >= G.slipAt) slip();
      if (G.headY <= HOME) { G.headY = HOME; if (G.res && G.res.outcome === 3 && G.carry) G.state = 'carry'; else finishRound(); }
    } else if (G.state === 'carry') {
      G.cdx *= Math.max(0, 1 - 4 * dt);
      const d = CHUTE_X - G.clawX, s = 200 * dt; G.clawX += Math.abs(d) < s ? d : Math.sign(d) * s;
      if (Math.abs(G.clawX - CHUTE_X) < 0.5) { G.state = 'release'; G.open = 1; G.fall = { y: G.headY + ARM + G.cdy, vy: 0 }; sfx.clack(); }
    } else if (G.state === 'release') {
      G.open = 1; const f = G.fall, r = G.carry.r; f.vy += 900 * dt; f.y += f.vy * dt;
      if (f.y >= FLOOR - r) { f.y = FLOOR - r; if (f.vy > 120) { f.vy *= -0.35; sfx.tick(); } else { f.vy = 0; G.carry.gone = true; finishRound(); } }
    } else if (G.state === 'result') {
      G.resultTimer -= dt;
      if (G.resultTimer <= 0) { G.state = 'busy'; const p = G.pending; $('phase').hidden = true; showReceipt(p, true); G.last = p; afterDrop(p); }
    }
    if (G.state === 'aim') {
      const tg = R.pickTarget(G.m, pmOf(G.clawX));
      $('chance').innerHTML = tg ? 'Hold <b>' + bp(R.chanceBp(G.m, G.pit[tg.slot].kind, tg.centering)) + '</b>' : 'Hold <b>--</b>';
    }
  }
  function draw() {
    const c = ctx, m = MV[G.m], dp = DEPTH[m.id];
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = G.shake > 0 && !calm ? (Math.random() - 0.5) * 6 : 0, sy = G.shake > 0 && !calm ? (Math.random() - 0.5) * 6 : 0;
    c.save(); c.translate(sx, sy);
    const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, dp[0]); bg.addColorStop(1, dp[1]); c.fillStyle = bg; c.fillRect(-8, -8, W + 16, H + 16);
    if (!calm) {
      c.save(); c.globalAlpha = m.id === 'shell' ? 0.16 : m.id === 'reef' ? 0.08 : 0.03; c.fillStyle = '#C4E6DF';
      for (let i = 0; i < 3; i++) { const o = Math.sin(G.t * 0.4 + i * 2) * 18 + i * 120 + 40; c.beginPath(); c.moveTo(o, 0); c.lineTo(o + 40, 0); c.lineTo(o + 120, H); c.lineTo(o + 50, H); c.closePath(); c.fill(); }
      c.restore();
      c.fillStyle = 'rgba(196,230,223,.35)';
      for (const b of BUB) { b.y -= b.s * 0.016; if (b.y < -4) { b.y = H + 4; b.x = Math.random() * W; } c.beginPath(); c.arc(b.x + Math.sin(G.t + b.s) * 3, b.y, b.r, 0, 7); c.fill(); }
    }
    c.fillStyle = '#1B3340'; c.fillRect(0, RAIL - 2, W, 4);
    c.save(); c.globalAlpha = m.id === 'abyss' ? 0.1 : 0.3; c.translate(206, 128); c.rotate(-0.06);
    c.fillStyle = '#CDBE96'; rr(c, -104, -24, 208, 48, 5); c.fill(); c.fillStyle = '#0D1820'; c.font = '13px Special Elite, Courier New, monospace'; c.textAlign = 'center'; c.fillText("CRIMP'S: WIN EVERY TIME", 0, 5);
    c.strokeStyle = '#B3261E'; c.lineWidth = 4; c.beginPath(); c.moveTo(-100, -20); c.lineTo(100, 20); c.stroke(); c.restore();
    c.fillStyle = dp[2]; c.fillRect(0, FLOOR, W, H - FLOOR); c.fillStyle = dp[3]; c.fillRect(0, FLOOR, W, 6);
    // chute (left edge)
    c.fillStyle = 'rgba(224,166,58,.16)'; c.fillRect(0, FLOOR - 70, 30, 70); c.strokeStyle = '#E0A63A'; c.lineWidth = 3; c.strokeRect(0, FLOOR - 70, 30, 70);
    c.fillStyle = '#E0A63A'; c.font = '600 11px IBM Plex Mono,monospace'; c.textAlign = 'center'; c.fillText('WIN', 15, FLOOR - 76);
    // slot marks (public)
    c.fillStyle = 'rgba(241,230,200,.16)'; for (let i = 0; i < 8; i++) c.fillRect(pxOf(R.slotX(i)) - 1, FLOOR + 8, 2, 8);
    const order = G.pit.slice().sort((a, b) => (a.i % 2) - (b.i % 2));
    const lit = (p) => { const rar = PRIZES[p.type].rarity; return rar === 'Epic' || rar === 'Mythic'; };
    for (const p of order) { if (p.gone || p.lifted) continue; drawPrize(c, p.type, p.x, p.falling ? p.fallY : p.y, p.r, G.t + p.i, lit(p)); }
    if (m.id === 'abyss') {
      const fx = G.clawX; c.save(); c.translate(fx, 390); c.scale(1, 2.2);
      const gr = c.createRadialGradient(0, 0, 35, 0, 0, 120); gr.addColorStop(0, 'rgba(3,5,12,0)'); gr.addColorStop(1, 'rgba(3,5,12,.92)');
      c.fillStyle = gr; c.fillRect(-fx - 20, -390 / 2.2 - 20, W + 40, H / 2.2 + 40); c.restore();
      for (const p of order) { if (p.gone || p.lifted) continue; if (lit(p)) drawPrize(c, p.type, p.x, p.falling ? p.fallY : p.y, p.r, G.t + p.i, true); }
    }
    if (G.state === 'aim') {
      const tg = R.pickTarget(G.m, pmOf(G.clawX));
      c.setLineDash([4, 6]); c.strokeStyle = 'rgba(196,230,223,.35)'; c.lineWidth = 2; c.beginPath(); c.moveTo(G.clawX, G.headY + ARM); c.lineTo(G.clawX, FLOOR); c.stroke(); c.setLineDash([]);
      if (tg) { const p = G.pit[tg.slot], col = tg.centering > 700 ? '#5CCB9E' : tg.centering > 350 ? '#FFC53D' : '#FF7A6B'; c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, p.r + 6, 0, 7); c.stroke(); }
    }
    if (G.carry && !G.carry.gone) {
      const p = G.carry; let x, y;
      if (G.state === 'release') { x = CHUTE_X; y = G.fall.y; } else if (G.state === 'grab') { x = p.x; y = p.y; } else { x = G.clawX + G.cdx; y = G.headY + ARM + G.cdy; }
      drawPrize(c, p.type, x, y, p.r, G.t, lit(p));
    }
    if (G.state === 'wait') { c.save(); c.globalAlpha = 0.5 + 0.3 * Math.sin(G.t * 6); c.fillStyle = '#B3261E'; c.font = '600 11px IBM Plex Mono,monospace'; c.textAlign = 'center'; c.fillText('SEALED', G.clawX, Math.max(24, G.headY - 22)); c.restore(); }
    drawClaw(c, G.clawX, G.headY, G.open, R.MACHINES[G.m].span_pm * (XMAX - XMIN) / 1000);
    c.restore();
  }
  function frame(ts) {
    if (!running) return;
    const dt = G.ts == null ? 0 : Math.min(0.05, (ts - G.ts) / 1000); G.ts = ts;
    update(dt); draw(); requestAnimationFrame(frame);
  }
  function startLoop() { if (running) return; running = true; G.ts = null; requestAnimationFrame(frame); }
  function stopLoop() { running = false; }

  // ---- input
  const posX = (e) => { const r = cv.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  cv.addEventListener('pointerdown', (e) => { if (G.state !== 'aim') return; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } G.drag = Math.max(XMIN, Math.min(XMAX, posX(e))); G.keys.l = G.keys.r = false; });
  cv.addEventListener('pointermove', (e) => { if (G.state !== 'aim' || !(e.buttons || e.pointerType === 'touch')) return; G.drag = Math.max(XMIN, Math.min(XMAX, posX(e))); });
  function hold(id, key) {
    const b = $(id);
    const on = (e) => { e.preventDefault(); if (G.state !== 'aim') return; G.keys[key] = true; b.classList.add('down'); };
    const off = () => { G.keys[key] = false; b.classList.remove('down'); };
    b.addEventListener('pointerdown', on); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, off));
  }
  hold('bL', 'l'); hold('bR', 'r');
  window.addEventListener('keydown', (e) => {
    if (G.state !== 'aim') return;
    if (e.key === 'ArrowLeft') { G.keys.l = true; e.preventDefault(); } else if (e.key === 'ArrowRight') { G.keys.r = true; e.preventDefault(); }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); doDrop(); }
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft') G.keys.l = false; if (e.key === 'ArrowRight') G.keys.r = false; });

  // ---- boot
  $('brand').innerHTML = clawIcon() + '<span>Pinch\'s Arcade</span>';
  $('storyPinch').innerHTML = pinchSVG('happy');
  $('sayAv').innerHTML = pinchSVG('idle');
  window.__pinch = { G, showReceipt, verifyReceipt, enterHub, enterMachine, renderHub, doDrop, home, toast, showSheet, hideSheet, sfx }; // handy for tests and the console
})();
