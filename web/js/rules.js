// Pinch's Arcade claw rules: JavaScript port of game.rs (integer maths, BigInt for u64).
// Used by the game UI and the receipt verifier. Must match the on-chain program exactly.
(function (root) {
  const M64 = (1n << 64n) - 1n;
  const KINDS = ['Pearl', 'Scallop', 'Starfish', 'Lantern Fish', 'Golden Pearl'];
  const VALUE = [2, 4, 10, 26, 80];
  const GRIP_PM = [1000, 970, 850, 620, 420];
  const NONE = 255;
  const SLOTS = 8;
  const MACHINES = [
    { name: 'Shell Shop', ticket: 5, floor_pm: 480, span_pm: 237, mix: [500, 350, 150, 0, 0], guarantee: NONE },
    { name: 'Reef Run', ticket: 10, floor_pm: 300, span_pm: 188, mix: [250, 300, 320, 130, 0], guarantee: 3 },
    { name: 'The Abyss', ticket: 25, floor_pm: 160, span_pm: 144, mix: [0, 180, 300, 340, 180], guarantee: 4 },
  ];
  const POW13 = [0, 20, 50, 85, 123, 165, 209, 255, 304, 354, 406, 460, 515, 571, 629, 688, 748, 810, 872, 935, 1000];

  function splitmix64(x) {
    let z = (BigInt(x) + 0x9E3779B97F4A7C15n) & M64;
    z = ((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94D049BB133111EBn) & M64;
    return (z ^ (z >> 31n)) & M64;
  }
  function pitSeed(authBytes, round, machine) {
    let a = 0n;
    for (let i = 7; i >= 0; i--) a = (a << 8n) | BigInt(authBytes[i]);
    const k = a ^ ((BigInt(round) * 0x9E3779B97F4A7C15n) & M64) ^ (BigInt(machine) << 56n);
    return splitmix64(k & M64);
  }
  function pitKinds(seed, machine) {
    const m = MACHINES[machine];
    const out = [];
    for (let i = 0; i < SLOTS; i++) {
      const r = Number(splitmix64((seed + BigInt(i) + 1n) & M64) % 1000n);
      let acc = 0, kind = 0;
      for (let k = 0; k < 5; k++) {
        acc += m.mix[k];
        if (m.mix[k] > 0) kind = k;
        if (r < acc) { kind = k; break; }
      }
      out.push(kind);
    }
    if (m.guarantee !== NONE && !out.includes(m.guarantee)) {
      const at = Number(splitmix64(seed ^ 0xA5A5A5A5A5A5A5A5n) % BigInt(SLOTS));
      out[at] = m.guarantee;
    }
    return out;
  }
  const slotX = (s) => 90 + 117 * s;
  const reach = (machine) => Math.floor(MACHINES[machine].span_pm / 2) + 40;
  function pickTarget(machine, xpm) {
    const x = Math.min(xpm, 1000), rc = reach(machine);
    let best = 0, bdx = 1e9;
    for (let s = 0; s < SLOTS; s++) { const dx = Math.abs(x - slotX(s)); if (dx < bdx) { bdx = dx; best = s; } }
    if (bdx > rc) return null;
    return { slot: best, centering: 1000 - Math.floor((bdx * 1000) / rc) };
  }
  function pow13(c) {
    c = Math.min(c, 1000);
    const i = Math.floor(c / 50);
    if (i >= 20) return POW13[20];
    return POW13[i] + Math.floor(((POW13[i + 1] - POW13[i]) * (c % 50)) / 50);
  }
  function chanceBp(machine, kind, centering) {
    const fb = MACHINES[machine].floor_pm * 10;
    const base = fb + Math.floor(((10000 - fb) * pow13(centering)) / 1000);
    const c = Math.floor((base * GRIP_PM[kind]) / 1000);
    return Math.max(200, Math.min(9700, c));
  }
  function rollFromRandomness(bytes) {
    const v = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16)) + bytes[3] * 16777216;
    return (v % 10000) + 1;
  }
  const hex = (h) => Uint8Array.from(h.match(/../g).map((b) => parseInt(b, 16)));
  // Recompute a whole drop from the public inputs and the VRF bytes. Returns what the program must have written.
  function recompute(authBytes, round, machine, xpm, randomness) {
    const seed = pitSeed(authBytes, round, machine), kinds = pitKinds(seed, machine);
    const t = pickTarget(machine, xpm);
    if (!t) return { seed, kinds, outcome: 'miss' };
    const kind = kinds[t.slot], ch = chanceBp(machine, kind, t.centering);
    const roll = randomness ? rollFromRandomness(randomness) : null;
    return { seed, kinds, slot: t.slot, kind, centering: t.centering, chance: ch, roll, outcome: roll === null ? 'pending' : roll <= ch ? 'hold' : 'slip' };
  }
  const API = { KINDS, VALUE, GRIP_PM, MACHINES, SLOTS, splitmix64, pitSeed, pitKinds, slotX, reach, pickTarget, chanceBp, rollFromRandomness, recompute, hex };
  if (typeof module !== 'undefined') module.exports = API; else root.Rules = API;
})(typeof self !== 'undefined' ? self : this);
