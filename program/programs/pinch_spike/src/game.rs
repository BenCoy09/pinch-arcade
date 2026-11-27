//! Pinch's Arcade: the claw rules. Pure integer maths, no floats, no framework.
//! Everything here is PUBLIC: anyone can recompute a drop from the receipt.
//! (The JavaScript port in verify.js must give identical numbers; see the tests.)

pub const SLOTS: usize = 8;
pub const KINDS: usize = 5; // 0 pearl, 1 scallop, 2 starfish, 3 lantern fish, 4 golden pearl
pub const NONE: u8 = 255;

pub const VALUE: [u32; KINDS] = [2, 4, 10, 26, 80];
/// Grip multiplier per prize, permille (heavier or slipperier prizes hold less).
pub const GRIP_PM: [u32; KINDS] = [1000, 970, 850, 620, 420];

pub struct Machine {
    pub ticket: u32,
    pub floor_pm: u32,     // grip chance of a barely-touching grab, permille
    pub span_pm: u32,      // claw width, permille of the cabinet
    pub mix: [u32; KINDS], // prize mix, permille, sums to 1000
    pub guarantee: u8,     // kind that is always somewhere in the pit, or NONE
}

pub const MACHINES: [Machine; 3] = [
    Machine {
        ticket: 5,
        floor_pm: 480,
        span_pm: 237,
        mix: [500, 350, 150, 0, 0],
        guarantee: NONE,
    },
    Machine {
        ticket: 10,
        floor_pm: 300,
        span_pm: 188,
        mix: [250, 300, 320, 130, 0],
        guarantee: 3,
    },
    Machine {
        ticket: 25,
        floor_pm: 160,
        span_pm: 144,
        mix: [0, 180, 300, 340, 180],
        guarantee: 4,
    },
];

/// (k/20)^1.3 in permille for k = 0..=20 (centering steps of 5%).
const POW13: [u32; 21] = [
    0, 20, 50, 85, 123, 165, 209, 255, 304, 354, 406, 460, 515, 571, 629, 688, 748, 810, 872, 935,
    1000,
];

pub fn splitmix64(x: u64) -> u64 {
    let mut z = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Public pit seed: first 8 bytes of the player key, the round number, the machine.
pub fn pit_seed(authority: &[u8; 32], round: u32, machine: u8) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&authority[0..8]);
    let k = u64::from_le_bytes(a)
        ^ (round as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ ((machine as u64) << 56);
    splitmix64(k)
}

pub fn pit_kinds(seed: u64, machine: u8) -> [u8; SLOTS] {
    let m = &MACHINES[machine as usize];
    let mut out = [0u8; SLOTS];
    for i in 0..SLOTS {
        let r = (splitmix64(seed.wrapping_add(i as u64 + 1)) % 1000) as u32;
        let mut acc = 0u32;
        let mut kind = 0u8;
        for k in 0..KINDS {
            acc += m.mix[k];
            if m.mix[k] > 0 {
                kind = k as u8;
            }
            if r < acc {
                kind = k as u8;
                break;
            }
        }
        out[i] = kind;
    }
    if m.guarantee != NONE && !out.contains(&m.guarantee) {
        let at = (splitmix64(seed ^ 0xA5A5_A5A5_A5A5_A5A5) % SLOTS as u64) as usize;
        out[at] = m.guarantee;
    }
    out
}

pub fn slot_x_pm(slot: usize) -> u32 {
    90 + 117 * slot as u32
}

pub fn reach_pm(machine: u8) -> u32 {
    MACHINES[machine as usize].span_pm / 2 + 40
}

/// The prize under the claw: nearest slot centre, if it is inside the claw's reach.
/// Returns (slot, centering_pm 0..=1000).
pub fn pick_target(machine: u8, x_pm: u32) -> Option<(usize, u32)> {
    let x = x_pm.min(1000);
    let reach = reach_pm(machine);
    let mut best = 0usize;
    let mut best_dx = u32::MAX;
    for s in 0..SLOTS {
        let c = slot_x_pm(s);
        let dx = if x > c { x - c } else { c - x };
        if dx < best_dx {
            best_dx = dx;
            best = s;
        }
    }
    if best_dx > reach {
        return None;
    }
    Some((best, 1000 - best_dx * 1000 / reach))
}

fn pow13(c_pm: u32) -> u32 {
    let c = c_pm.min(1000);
    let i = (c / 50) as usize;
    if i >= 20 {
        return POW13[20];
    }
    let r = c % 50;
    POW13[i] + (POW13[i + 1] - POW13[i]) * r / 50
}

/// Hold chance in basis points (10000 = 100%), clamped to 2%..97%.
pub fn chance_bp(machine: u8, kind: u8, centering_pm: u32) -> u32 {
    let m = &MACHINES[machine as usize];
    let floor_bp = m.floor_pm * 10;
    let base_bp = floor_bp + (10_000 - floor_bp) * pow13(centering_pm) / 1000;
    let c = base_bp * GRIP_PM[kind as usize] / 1000;
    c.clamp(200, 9700)
}

/// 1..=10000 from the VRF output (first four bytes).
pub fn roll_from_randomness(r: &[u8; 32]) -> u32 {
    u32::from_le_bytes([r[0], r[1], r[2], r[3]]) % 10_000 + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixes_sum_to_1000() {
        for m in MACHINES.iter() {
            assert_eq!(m.mix.iter().sum::<u32>(), 1000);
        }
    }

    #[test]
    fn guarantees_hold() {
        for round in 0..2000u32 {
            let a = [round as u8; 32];
            for mi in 0..3u8 {
                let k = pit_kinds(pit_seed(&a, round, mi), mi);
                let g = MACHINES[mi as usize].guarantee;
                if g != NONE {
                    assert!(k.contains(&g));
                }
                for x in k.iter() {
                    assert!(MACHINES[mi as usize].mix[*x as usize] > 0 || *x == g);
                }
            }
        }
    }

    #[test]
    fn chance_is_monotonic_in_centering() {
        for mi in 0..3u8 {
            for kind in 0..5u8 {
                let mut prev = 0;
                for c in (0..=1000).step_by(10) {
                    let v = chance_bp(mi, kind, c);
                    assert!(v >= prev);
                    prev = v;
                }
            }
        }
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 = splitmix64(self.0);
            self.0
        }
        fn unit(&mut self) -> f64 {
            (self.next() >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// returns (rtp, hit_rate) for a strategy. noise_pm: aim error.
    fn sim(mi: u8, skilled: bool, noise_pm: i32, n: u32) -> (f64, f64) {
        let mut rng = Rng(12345 + mi as u64);
        let (mut paid, mut won, mut holds) = (0u64, 0u64, 0u32);
        for round in 0..n {
            let mut auth = [0u8; 32];
            let r = rng.next().to_le_bytes();
            auth[0..8].copy_from_slice(&r);
            let kinds = pit_kinds(pit_seed(&auth, round, mi), mi);
            let x: i32 = if skilled {
                // aim at the slot with the best expected value, plus noise
                let mut best = (0usize, 0u64);
                for s in 0..SLOTS {
                    let v = VALUE[kinds[s] as usize] as u64 * chance_bp(mi, kinds[s], 1000) as u64;
                    if v > best.1 {
                        best = (s, v);
                    }
                }
                let u = (rng.unit() + rng.unit() + rng.unit() - 1.5) * 2.0; // ~ +-3 sd-ish triangular
                slot_x_pm(best.0) as i32 + (u * noise_pm as f64) as i32
            } else {
                (rng.unit() * 1000.0) as i32
            };
            let x = x.clamp(0, 1000) as u32;
            paid += MACHINES[mi as usize].ticket as u64;
            if let Some((slot, c)) = pick_target(mi, x) {
                let ch = chance_bp(mi, kinds[slot], c);
                let mut rb = [0u8; 32];
                rb[0..8].copy_from_slice(&rng.next().to_le_bytes());
                if roll_from_randomness(&rb) <= ch {
                    won += VALUE[kinds[slot] as usize] as u64;
                    holds += 1;
                }
            }
        }
        (won as f64 / paid as f64, holds as f64 / n as f64)
    }

    #[test]
    fn economics_report() {
        for mi in 0..3u8 {
            let (b, bh) = sim(mi, false, 0, 200_000);
            let (s, sh) = sim(mi, true, 25, 200_000);
            let (s2, _) = sim(mi, true, 55, 200_000);
            println!("machine {mi}: blind RTP {:.1}% (hit {:.0}%)  skilled(+-25pm) {:.1}% (hit {:.0}%)  sloppy(+-55pm) {:.1}%",
                b * 100.0, bh * 100.0, s * 100.0, sh * 100.0, s2 * 100.0);
        }
    }
}
