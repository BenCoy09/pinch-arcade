// Pinch's Arcade: the pixel street. Home screen, missions and the Golden Pearl Race.
// Everything shown is derived from on-chain state: missions from your account, other crabs from real players.
(function () {
  'use strict';
  const P = window.__pinch, R = window.Rules, C = window.Chain, $ = (id) => document.getElementById(id);
  const VW = 160, VH = 112, WORLD = 520, GY = 90;
  const cv = $('stcv'), ctx = cv.getContext('2d');
  cv.width = VW; cv.height = VH; ctx.imageSmoothingEnabled = false;

  const SPR = [
    '....kkkkk.....',
    '...kbbbbbk....',
    '..kbbdbbbbk.k.',
    '..kbdbbdbbk.wk',
    '..kbbbbbbkkkwk',
    '...kkkkkkrrrk.',
    '.kk.krrrrrrk..',
    'krrkrrrrrrrk..',
    '.kk.kk.kk.kk..',
  ];
  const PAL = { k: '#0D1820', d: '#8F6410', r: '#E57A66', w: '#F1E6C8' };
  function crab(x, y, shell, flip, bob) {
    const w = SPR[0].length;
    for (let j = 0; j < SPR.length; j++) for (let i = 0; i < w; i++) {
      const ch = SPR[j][i]; if (ch === '.') continue;
      ctx.fillStyle = ch === 'b' ? shell : ch === 'd' ? shade(shell) : PAL[ch];
      ctx.fillRect(Math.round(x - w / 2 + (flip ? w - 1 - i : i)), Math.round(y - SPR.length + j + bob), 1, 1);
    }
  }
  const shade = (c) => (c === '#E0A63A' ? '#8F6410' : 'rgba(0,0,0,.35)');
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  const SPOTS = [
    { id: 'shell', x: 62, name: 'Shell Shop', sub: 'Easy · 5 pearls', color: '#79C2D0', run: () => P.enterMachine(0) },
    { id: 'reef', x: 150, name: 'Reef Run', sub: 'Medium · 10 pearls', color: '#2C6E8A', run: () => P.enterMachine(1) },
    { id: 'abyss', x: 238, name: 'The Abyss', sub: 'Hard · 25 pearls', color: '#1A2350', run: () => P.enterMachine(2) },
    { id: 'race', x: 330, name: 'Golden Pearl Race', sub: 'Who holds the most', color: '#E0A63A', run: () => raceSheet() },
    { id: 'ledger', x: 418, name: "Crimp's Ledger", sub: 'Missions', color: '#B3261E', run: () => missionSheet() },
    { id: 'shelf', x: 490, name: 'Your shelf', sub: 'Prizes and stats', color: '#8FD0B4', run: () => P.enterHub() },
  ];
  const FAR = []; for (let i = 0; i < 26; i++) FAR.push({ x: i * 26 + ((i * 37) % 11), h: 18 + ((i * 53) % 29), w: 9 + ((i * 17) % 9) });

  const S = { x: 40, tx: null, face: 1, t: 0, running: false, keys: { l: false, r: false }, others: [], ts: null, near: null, loaded: 0 };
  const done = {}; let doneInit = false, saved = false;

  // ---------------------------------------------------------------- missions (derived, never stored)
  function missions(st) {
    return [
      { id: 'open', t: 'Open the shutters', d: 'Make your first drop and look at the seal before it opens.', ok: st.drops >= 1, say: 'Crimp never let anyone see the roll. You just did.' },
      { id: 'hold', t: 'Hold something', d: 'Get any prize into the chute.', ok: st.wins >= 1, say: 'That grip was a number you could see, not a trick.' },
      { id: 'lantern', t: 'The reef lantern', d: 'Hold a lantern fish. Reef Run always has one somewhere.', ok: st.inventory[3] >= 1, say: 'Crimp swore these were fake. Look at it glow.' },
      { id: 'receipts', t: 'Show the receipts', d: 'Press Save to Solana so anyone can read and re-check your drops.', ok: saved, say: 'Now the base layer holds your receipts. Anyone can check.' },
      { id: 'gold', t: "Crimp's promise", d: 'Hold the golden pearl in The Abyss. It is always down there.', ok: st.inventory[4] >= 1, say: 'The golden pearl. Crimp never had one. We do.' },
    ];
  }
  function check(announce) {
    if (!P.G.st) return;
    const ms = missions(P.G.st);
    ms.forEach((m) => {
      if (m.ok && !done[m.id]) { done[m.id] = true; if (announce && doneInit) { P.toast('Mission complete: ' + m.t); P.sfx.win(); } }
    });
    doneInit = true;
    const n = ms.filter((m) => m.ok).length;
    const el = $('stMiss'); if (el) el.textContent = 'Missions ' + n + '/' + ms.length;
  }
  async function checkSaved() {
    try { const r = await C.readBaseState(C.address()); if (r && r.state.drops >= 1) { saved = true; check(true); } } catch (e) { /* offline is fine */ }
  }
  function missionSheet() {
    const ms = missions(P.G.st), n = ms.filter((m) => m.ok).length;
    P.showSheet('<h2>Crimp\'s ledger</h2><p class="lead">Uncle Crimp left a debt in this book. Pinch pays it back with proof. ' + n + ' of ' + ms.length + ' done, read from your on-chain account.</p>'
      + '<ol class="miss">' + ms.map((m) => '<li class="' + (m.ok ? 'done' : '') + '"><b>' + (m.ok ? '✓ ' : '') + m.t + '</b><span>' + m.d + '</span>' + (m.ok ? '<em>Pinch: "' + m.say + '"</em>' : '') + '</li>').join('') + '</ol>'
      + '<div class="row2"><button class="btn pri" id="mClose">Back to the street</button></div>');
    $('mClose').addEventListener('click', P.hideSheet);
  }

  // ---------------------------------------------------------------- race
  const short = (a) => a.slice(0, 4) + '…' + a.slice(-4);
  async function raceSheet(force) {
    P.showSheet('<h2>Golden Pearl Race</h2><p class="lead">Players ranked by golden pearls held, then pearls won. Read from Solana devnet: it only moves when a player presses Save to Solana (golden pearls save themselves).</p><div id="lb" class="lb"><p class="lead">Reading the base layer…</p></div><div class="row2"><button class="btn" id="lbSave">Save my score</button><button class="btn" id="lbRef">Refresh</button><button class="btn pri" id="lbClose">Close</button></div>');
    $('lbClose').addEventListener('click', P.hideSheet);
    $('lbRef').addEventListener('click', () => raceSheet(true));
    $('lbSave').addEventListener('click', async () => { $('lbSave').disabled = true; $('lbSave').textContent = 'Saving…'; try { await C.saveToSolana(); saved = true; check(true); await C.sleep(1500); raceSheet(true); } catch (e) { P.toast('Save failed: ' + String(e.message || e).slice(0, 80)); $('lbSave').disabled = false; $('lbSave').textContent = 'Save my score'; } });
    try {
      const rows = await C.racers(force), me = C.address();
      if (!$('lb')) return;
      $('lb').innerHTML = rows.length ? '<table><tr><th>#</th><th>Crab</th><th>Gold</th><th>Won</th><th>Drops</th></tr>' + rows.slice(0, 10).map((r, i) => '<tr class="' + (r.player === me ? 'me' : '') + '"><td>' + (i + 1) + '</td><td><i style="background:hsl(' + (hash(r.player) % 360) + ',65%,58%)"></i><a href="verify.html?p=' + r.player + '" target="_blank" rel="noopener">' + short(r.player) + (r.player === me ? ' (you)' : '') + '</a></td><td>' + r.golden + '</td><td>' + r.won + '</td><td>' + r.drops + '</td></tr>').join('') + '</table><p class="lead" style="margin-top:8px">Tap a crab\'s address to re-check their receipts yourself. Entries are separate throwaway wallets, so anyone can make several: the board proves fair rolls, not unique people.</p>' : '<p class="lead">Nobody has saved a score yet. Be the first: play, then press Save my score.</p>';
    } catch (e) { if ($('lb')) $('lb').innerHTML = '<p class="lead">Could not read devnet right now (' + String(e.message || e).slice(0, 80) + '). Try Refresh.</p>'; }
  }
  async function loadOthers() {
    try {
      const rows = await C.racers(false), me = C.address();
      S.others = rows.filter((r) => r.player !== me).slice(0, 8).map((r) => { const h = hash(r.player); return { r, x: 24 + (h % (WORLD - 48)), hue: h % 360, ph: (h % 100) / 10 }; });
      S.loaded = Date.now();
    } catch (e) { /* the street still works without them */ }
  }

  // ---------------------------------------------------------------- drawing
  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  function text(s, x, y, c, size) { ctx.fillStyle = c; ctx.font = '700 ' + (size || 6) + 'px "IBM Plex Mono",monospace'; ctx.textAlign = 'center'; ctx.fillText(s, Math.round(x), Math.round(y)); }
  function building(sp, cx) {
    const x = Math.round(sp.x - cx), top = GY - 38, w = 44;
    if (x < -60 || x > VW + 60) return;
    if (sp.id === 'race') {
      px(x - 16, top + 6, 32, 30, '#5A3E22'); px(x - 15, top + 7, 30, 28, '#7A5630'); px(x - 2, top + 30, 4, GY - top - 30, '#3E2A16');
      const by = Math.sin(S.t * 2) * 1.5; px(x - 5, top + 12 + by, 10, 10, '#E0A63A'); px(x - 3, top + 14 + by, 3, 3, '#FFF3C4'); px(x - 5, top + 20 + by, 10, 2, '#8F6410');
      text('RACE', x, top + 31, '#F1E6C8', 6); return;
    }
    if (sp.id === 'ledger') {
      px(x - 20, top + 10, 40, GY - top - 10, '#2A1816'); px(x - 22, top + 6, 44, 6, '#B3261E'); for (let i = 0; i < 6; i++) px(x - 22 + i * 8, top + 6, 4, 6, '#F1E6C8');
      px(x - 7, top + 28, 14, 10, '#F1E6C8'); px(x - 6, top + 29, 6, 8, '#CDBE96'); px(x + 1, top + 29, 5, 8, '#CDBE96'); text('LEDGER', x, top + 24, '#F1E6C8', 5); return;
    }
    if (sp.id === 'shelf') {
      px(x - 14, top + 10, 28, GY - top - 10, '#1B3340'); for (let r = 0; r < 3; r++) { px(x - 12, top + 20 + r * 10, 24, 2, '#8FD0B4'); px(x - 9 + r * 6, top + 14 + r * 10, 5, 5, ['#F1E6C8', '#E58AA8', '#E0A63A'][r]); }
      text('SHELF', x, top + 8, '#8FD0B4', 5); return;
    }
    const dark = sp.id === 'abyss';
    px(x - w / 2, top, w, GY - top, dark ? '#0B1230' : sp.id === 'reef' ? '#1E4D63' : '#3E8CA0');
    for (let i = 0; i < 6; i++) px(x - w / 2 + i * 8, top - 3, 4, 7, i % 2 ? '#F1E6C8' : sp.color);
    px(x - w / 2 - 2, top - 4, w + 4, 2, '#0D1820');
    px(x - 8, top + 14, 16, GY - top - 14, '#0D1820');
    px(x - 6, top + 17, 12, GY - top - 17, dark ? '#0A1A33' : sp.id === 'reef' ? '#17404F' : '#24617A');
    const flick = sp.id === 'reef' && Math.sin(S.t * 13) > 0.92 ? 0.3 : 1;
    ctx.globalAlpha = flick; text(sp.name.split(' ')[0].toUpperCase(), x, top + 11, dark ? '#7DF3E1' : '#F1E6C8', 6); ctx.globalAlpha = 1;
    if (dark) { for (let r = 9; r > 2; r -= 2) { ctx.globalAlpha = 0.07; px(x - r, GY - r - 6, r * 2, r * 2, '#7DF3E1'); } ctx.globalAlpha = 1; px(x - 1, GY - 22, 2, 2, '#7DF3E1'); }
    px(x - w / 2 + 3, top + 18, 8, 8, '#F1E6C8'); px(x + w / 2 - 11, top + 18, 8, 8, '#F1E6C8');
  }
  function draw() {
    const t = S.t, cx = Math.max(0, Math.min(WORLD - VW, S.x - VW / 2));
    for (let y = 0; y < GY; y += 3) { const k = y / GY; ctx.fillStyle = 'rgb(' + Math.round(10 + 22 * k) + ',' + Math.round(28 + 52 * k) + ',' + Math.round(44 + 52 * k) + ')'; ctx.fillRect(0, y, VW, 3); }
    ctx.globalAlpha = 0.06; ctx.fillStyle = '#C4E6DF';
    for (let i = 0; i < 3; i++) { const o = ((i * 70 + t * 4) % (VW + 60)) - 30; ctx.beginPath(); ctx.moveTo(o, 0); ctx.lineTo(o + 12, 0); ctx.lineTo(o + 40, GY); ctx.lineTo(o + 20, GY); ctx.fill(); }
    ctx.globalAlpha = 1;
    FAR.forEach((f) => { const x = Math.round(f.x - cx * 0.4); if (x < -20 || x > VW + 20) return; px(x, GY - f.h, f.w, f.h, '#102A38'); px(x + 2, GY - f.h - 3, 2, 3, '#102A38'); });
    for (let i = 0; i < 14; i++) { const bx = (i * 47 + 11) % VW, by = (VH - ((t * (4 + i % 4) + i * 19) % (VH + 6))); px(bx + Math.sin(t + i) * 2, by, 1, 1, 'rgba(196,230,223,.5)'); }
    SPOTS.forEach((sp) => building(sp, cx));
    px(0, GY, VW, VH - GY, '#1B3340'); px(0, GY, VW, 2, '#2A4C5E');
    for (let x = -((cx) % 12); x < VW; x += 12) px(x, GY + 9, 6, 1, '#E0A63A');
    for (let x = -((cx * 1.2) % 20); x < VW; x += 20) px(x, VH - 6, 2, 2, '#2A4C5E');
    S.others.forEach((o) => { const x = o.x + Math.sin(t * 0.5 + o.ph) * 10 - cx; if (x < -12 || x > VW + 12) return; const y = GY + 8 + (o.ph % 3) * 2; crab(x, y, 'hsl(' + o.hue + ',65%,58%)', Math.cos(t * 0.5 + o.ph) < 0, Math.sin(t * 6 + o.ph) > 0.7 ? -1 : 0); text(short(o.r.player).slice(0, 4), x, y - 11, '#C4E6DF', 5); });
    const moving = S.keys.l || S.keys.r || S.tx != null;
    crab(S.x - cx, GY + 12, '#E0A63A', S.face < 0, moving && Math.sin(t * 14) > 0 ? -1 : 0);
    SPOTS.forEach((sp) => { if (S.near === sp) { const x = sp.x - cx; px(x - 4, GY - 52 + Math.sin(t * 5), 8, 1, '#E0A63A'); px(x - 2, GY - 51 + Math.sin(t * 5), 4, 1, '#E0A63A'); px(x - 1, GY - 50 + Math.sin(t * 5), 2, 1, '#E0A63A'); } });
  }
  function update(dt) {
    S.t += dt;
    let dx = (S.keys.r ? 1 : 0) - (S.keys.l ? 1 : 0);
    if (dx) S.tx = null; else if (S.tx != null) { const d = S.tx - S.x; if (Math.abs(d) < 1.5) S.tx = null; else dx = Math.sign(d); }
    if (dx) { S.x = Math.max(12, Math.min(WORLD - 12, S.x + dx * 46 * dt)); S.face = dx; }
    let best = null, bd = 1e9; SPOTS.forEach((sp) => { const d = Math.abs(sp.x - S.x); if (d < bd) { bd = d; best = sp; } });
    const near = bd < 20 ? best : null;
    if (near !== S.near) { S.near = near; const b = $('stAct'); if (near) { b.textContent = 'Enter: ' + near.name; b.disabled = false; $('stHint').textContent = near.sub; } else { b.textContent = 'Walk to a door'; b.disabled = true; $('stHint').textContent = 'Drag, tap the street, or use the arrows.'; } }
    if (Date.now() - S.loaded > 60000 && !S.loading) { S.loading = true; loadOthers().finally(() => { S.loading = false; }); }
  }
  function frame(ts) { if (!S.running) return; const dt = S.ts == null ? 0 : Math.min(0.05, (ts - S.ts) / 1000); S.ts = ts; update(dt); draw(); requestAnimationFrame(frame); }

  // ---------------------------------------------------------------- input
  const lx = (e) => { const r = cv.getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * VW; };
  cv.addEventListener('pointerdown', (e) => {
    const cx = Math.max(0, Math.min(WORLD - VW, S.x - VW / 2)), x = lx(e) + cx;
    const o = S.others.find((q) => Math.abs(q.x + Math.sin(S.t * 0.5 + q.ph) * 10 - x) < 8);
    if (o) { const r = o.r; P.showSheet('<h2>' + short(r.player) + '</h2><p class="lead">A real player, read from Solana devnet at their last save.</p><dl class="stats"><div><dt>Golden pearls</dt><dd>' + r.golden + '</dd></div><div><dt>Pearls won</dt><dd>' + r.won + '</dd></div><div><dt>Drops</dt><dd>' + r.drops + '</dd></div><div><dt>Held</dt><dd>' + r.wins + '</dd></div></dl><div class="row2"><a class="btn" href="verify.html?p=' + r.player + '" target="_blank" rel="noopener">Re-check their receipts</a><button class="btn pri" id="oc">Close</button></div>'); $('oc').addEventListener('click', P.hideSheet); return; }
    S.tx = Math.max(12, Math.min(WORLD - 12, x));
  });
  function hold(id, k) { const b = $(id); b.addEventListener('pointerdown', (e) => { e.preventDefault(); S.keys[k] = true; }); ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => b.addEventListener(ev, () => { S.keys[k] = false; })); }
  hold('stL', 'l'); hold('stR', 'r');
  window.addEventListener('keydown', (e) => { if (!S.running || !$('sheet').hidden) return; if (e.key === 'ArrowLeft' || e.key === 'a') S.keys.l = true; else if (e.key === 'ArrowRight' || e.key === 'd') S.keys.r = true; else if ((e.key === ' ' || e.key === 'Enter') && S.near) { e.preventDefault(); S.near.run(); } });
  window.addEventListener('keyup', (e) => { if (e.key === 'ArrowLeft' || e.key === 'a') S.keys.l = false; if (e.key === 'ArrowRight' || e.key === 'd') S.keys.r = false; });
  $('stAct').addEventListener('click', () => { if (S.near) S.near.run(); });
  $('stMiss').addEventListener('click', missionSheet);
  $('stRace').addEventListener('click', () => raceSheet(false));

  window.Street = {
    enter() { S.near = null; S.tx = null; S.keys.l = S.keys.r = false; S.running = true; S.ts = null; check(false); requestAnimationFrame(frame); checkSaved(); },
    stop() { S.running = false; },
    afterDrop() { check(true); },
    markSaved() { saved = true; check(true); },
    missions, raceSheet,
  };
})();
