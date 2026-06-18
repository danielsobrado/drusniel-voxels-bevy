//! Deterministic RNG + CPU value noise for stone mesh generation.
//!
//! Mirrors the CLOD-PoC overlay (`tools/clod-poc/src/stones/seed.ts` + `noise.ts`) so the two
//! implementations stay conceptually aligned. The mesh field is built once on the CPU; same
//! seed + preset + detail must yield the same geometry.

/// Murmur3 fmix32 avalanche.
#[inline]
pub fn mix32(mut h: u32) -> u32 {
    h ^= h >> 16;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    h
}

/// sfc32-based PRNG — fast, solid statistical quality for procedural content.
pub struct StoneRng {
    a: u32,
    b: u32,
    c: u32,
    d: u32,
}

impl StoneRng {
    pub fn new(seed: u32) -> Self {
        let mut s = seed;
        let mut next = || {
            s = s.wrapping_add(0x9e37_79b9);
            mix32(s)
        };
        let mut rng = Self {
            a: next(),
            b: next(),
            c: next(),
            d: next(),
        };
        for _ in 0..8 {
            rng.next_u32();
        }
        rng
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let t = self.a.wrapping_add(self.b).wrapping_add(self.d);
        self.d = self.d.wrapping_add(1);
        self.a = self.b ^ (self.b >> 9);
        self.b = self.c.wrapping_add(self.c << 3);
        self.c = (self.c << 21) | (self.c >> 11);
        self.c = self.c.wrapping_add(t);
        t
    }

    /// uniform [0, 1)
    #[inline]
    pub fn next_f32(&mut self) -> f32 {
        self.next_u32() as f32 / 4_294_967_296.0
    }

    /// standard normal (Box–Muller)
    pub fn gauss(&mut self) -> f32 {
        let mut u = 0.0;
        while u == 0.0 {
            u = self.next_f32();
        }
        let mut v = 0.0;
        while v == 0.0 {
            v = self.next_f32();
        }
        (-2.0 * u.ln()).sqrt() * (std::f32::consts::TAU * v).cos()
    }
}

#[inline]
fn hash3(x: i32, y: i32, z: i32, seed: u32) -> f32 {
    let mut h = seed;
    h = mix32(h ^ (x as u32).wrapping_mul(0x27d4_eb2f));
    h = mix32(h ^ (y as u32).wrapping_mul(0x1656_67b1));
    h = mix32(h ^ (z as u32).wrapping_mul(0x9e37_79b1));
    h as f32 / 4_294_967_296.0
}

#[inline]
fn smooth(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// trilinear value noise, ~[-1, 1]
pub fn value_noise3(x: f32, y: f32, z: f32, seed: u32) -> f32 {
    let xi = x.floor() as i32;
    let yi = y.floor() as i32;
    let zi = z.floor() as i32;
    let xf = smooth(x - x.floor());
    let yf = smooth(y - y.floor());
    let zf = smooth(z - z.floor());
    let n000 = hash3(xi, yi, zi, seed);
    let n100 = hash3(xi + 1, yi, zi, seed);
    let n010 = hash3(xi, yi + 1, zi, seed);
    let n110 = hash3(xi + 1, yi + 1, zi, seed);
    let n001 = hash3(xi, yi, zi + 1, seed);
    let n101 = hash3(xi + 1, yi, zi + 1, seed);
    let n011 = hash3(xi, yi + 1, zi + 1, seed);
    let n111 = hash3(xi + 1, yi + 1, zi + 1, seed);
    let nx00 = n000 + (n100 - n000) * xf;
    let nx10 = n010 + (n110 - n010) * xf;
    let nx01 = n001 + (n101 - n001) * xf;
    let nx11 = n011 + (n111 - n011) * xf;
    let nxy0 = nx00 + (nx10 - nx00) * yf;
    let nxy1 = nx01 + (nx11 - nx01) * yf;
    (nxy0 + (nxy1 - nxy0) * zf) * 2.0 - 1.0
}

/// standard fBm over value_noise3 (lacunarity 2.02, gain 0.5).
pub fn fbm3(x: f32, y: f32, z: f32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 0.5;
    let mut freq = 1.0;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for i in 0..octaves {
        sum += amp
            * value_noise3(
                x * freq,
                y * freq,
                z * freq,
                mix32(seed.wrapping_add(i.wrapping_mul(0x9e37))),
            );
        norm += amp;
        amp *= 0.5;
        freq *= 2.02;
    }
    sum / norm
}

/// ridged fBm in [0,1], sharp creases (lacunarity 2.1, gain 0.52).
pub fn ridged3(x: f32, y: f32, z: f32, seed: u32, octaves: u32) -> f32 {
    let mut amp = 0.5;
    let mut freq = 1.0;
    let mut sum = 0.0;
    let mut norm = 0.0;
    for i in 0..octaves {
        let n = 1.0
            - value_noise3(
                x * freq,
                y * freq,
                z * freq,
                mix32(seed.wrapping_add(i.wrapping_mul(0x51ed))),
            )
            .abs();
        sum += amp * n * n;
        norm += amp;
        amp *= 0.52;
        freq *= 2.1;
    }
    sum / norm
}
