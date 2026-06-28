const DEFAULT_SEED: i32 = 0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FbmSettings {
    pub scale: f32,
    pub octaves: u32,
    pub persistence: f32,
    pub lacunarity: f32,
    pub seed: i32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DomainWarpSettings {
    pub fbm: FbmSettings,
    pub warp_scale: f32,
    pub warp_strength: f32,
}

#[inline]
pub fn smooth01(value: f32) -> f32 {
    let t = value.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
pub fn smoothstep_range(edge0: f32, edge1: f32, value: f32) -> f32 {
    let denominator = edge1 - edge0;
    if denominator.abs() <= f32::EPSILON {
        return if value >= edge1 { 1.0 } else { 0.0 };
    }
    smooth01((value - edge0) / denominator)
}

#[inline]
pub fn hash_position_seeded(x: i32, z: i32, seed: i32) -> f32 {
    let mut n = x
        .wrapping_mul(374_761_393)
        .wrapping_add(z.wrapping_mul(668_265_263))
        .wrapping_add(seed.wrapping_mul(1_376_312_589));
    n = (n ^ (n >> 13)).wrapping_mul(1_274_126_177);
    ((n ^ (n >> 16)) as u32) as f32 / 4_294_967_295.0
}

#[inline]
pub fn value_noise2(x: f32, z: f32, seed: i32) -> f32 {
    let xi = x.floor() as i32;
    let zi = z.floor() as i32;
    let xf = smooth01(x - xi as f32);
    let zf = smooth01(z - zi as f32);
    let a = hash_position_seeded(xi, zi, seed);
    let b = hash_position_seeded(xi.wrapping_add(1), zi, seed);
    let c = hash_position_seeded(xi, zi.wrapping_add(1), seed);
    let d = hash_position_seeded(xi.wrapping_add(1), zi.wrapping_add(1), seed);
    a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf
}

pub fn fbm2(x: f32, z: f32, settings: FbmSettings) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = settings.scale.max(1.0e-8);
    let mut max_value = 0.0;
    let octaves = settings.octaves.max(1);

    for i in 0..octaves {
        value += amplitude
            * value_noise2(
                x * frequency + i as f32 * 37.17,
                z * frequency - i as f32 * 19.31,
                settings.seed.wrapping_add((i as i32).wrapping_mul(101)),
            );
        max_value += amplitude;
        amplitude *= settings.persistence;
        frequency *= settings.lacunarity;
    }

    if max_value > 0.0 { value / max_value } else { 0.0 }
}

pub fn ridged_fbm2(x: f32, z: f32, settings: FbmSettings, power: f32) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = settings.scale.max(1.0e-8);
    let mut max_value = 0.0;
    let octaves = settings.octaves.max(1);

    for i in 0..octaves {
        let n = value_noise2(
            x * frequency + i as f32 * 83.9,
            z * frequency - i as f32 * 47.3,
            settings.seed.wrapping_add((i as i32).wrapping_mul(131)),
        );
        let ridge = (1.0 - (n * 2.0 - 1.0).abs()).powf(power);
        value += amplitude * ridge;
        max_value += amplitude;
        amplitude *= settings.persistence;
        frequency *= settings.lacunarity;
    }

    if max_value > 0.0 { value / max_value } else { 0.0 }
}

pub fn domain_warped_fbm2(x: f32, z: f32, settings: DomainWarpSettings) -> f32 {
    let seed = settings.fbm.seed;
    let warp_octaves = settings.fbm.octaves.clamp(1, 3);
    let wx = fbm2(
        x + 137.5,
        z - 91.25,
        FbmSettings {
            scale: settings.warp_scale,
            octaves: warp_octaves,
            persistence: 0.5,
            lacunarity: 2.0,
            seed: seed.wrapping_add(811),
        },
    ) * 2.0
        - 1.0;
    let wz = fbm2(
        x - 233.75,
        z + 57.5,
        FbmSettings {
            scale: settings.warp_scale,
            octaves: warp_octaves,
            persistence: 0.5,
            lacunarity: 2.0,
            seed: seed.wrapping_add(1451),
        },
    ) * 2.0
        - 1.0;

    fbm2(
        x + wx * settings.warp_strength,
        z + wz * settings.warp_strength,
        settings.fbm,
    )
}

impl Default for FbmSettings {
    fn default() -> Self {
        Self {
            scale: 0.001,
            octaves: 1,
            persistence: 0.5,
            lacunarity: 2.0,
            seed: DEFAULT_SEED,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_is_deterministic_and_seeded() {
        let a = value_noise2(12.3, -7.5, 4);
        let b = value_noise2(12.3, -7.5, 4);
        let c = value_noise2(12.3, -7.5, 5);

        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn fbm_is_bounded() {
        let settings = FbmSettings {
            scale: 0.01,
            octaves: 4,
            persistence: 0.5,
            lacunarity: 2.0,
            seed: 9,
        };
        let sample = fbm2(100.0, -50.0, settings);
        assert!((0.0..=1.0).contains(&sample));
    }
}
