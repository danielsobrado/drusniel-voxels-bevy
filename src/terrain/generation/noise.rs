use super::config::{MountainConfig, NoiseLayer, TerrainConfig};
use super::world_shape::{OceanClass, WorldShapeConfig, WorldShapeSampler};

const UNDERWATER_DETAIL_FACTOR: f32 = 0.08;
const BEACH_DETAIL_FACTOR: f32 = 0.18;
const COAST_DETAIL_FACTOR: f32 = 0.12;
const MOUNTAIN_MASK_OFFSET: f32 = 0.3;

/// Standard fBm noise
pub fn fbm(x: f32, z: f32, layer: &NoiseLayer, seed: u32) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = layer.scale;
    let mut max_value = 0.0;

    for i in 0..layer.octaves {
        let sample = simplex_2d(x * frequency, z * frequency, seed.wrapping_add(i));
        value += sample * amplitude;
        max_value += amplitude;

        amplitude *= layer.persistence;
        frequency *= layer.lacunarity;
    }

    (value / max_value) * layer.amplitude
}

/// Ridged noise for sharp mountain peaks
pub fn ridged_fbm(x: f32, z: f32, config: &MountainConfig, seed: u32) -> f32 {
    let mut value = 0.0;
    let mut amplitude = 1.0;
    let mut frequency = config.scale;
    let mut max_value = 0.0;

    for i in 0..config.octaves {
        let sample = simplex_2d(x * frequency, z * frequency, seed.wrapping_add(i + 100));
        let ridge = 1.0 - sample.abs();
        let ridge = ridge.powf(config.ridge_power);

        value += ridge * amplitude;
        max_value += amplitude;

        amplitude *= config.persistence;
        frequency *= config.lacunarity;
    }

    (value / max_value) * config.amplitude
}

/// Combined terrain height at world position.
pub fn sample_terrain_height(x: f32, z: f32, config: &TerrainConfig, seed: u32) -> f32 {
    let sampler = WorldShapeSampler::new(WorldShapeConfig {
        seed,
        sea_level: config.height.sea_level,
        ..WorldShapeConfig::default()
    });

    sample_terrain_height_with_world_shape(x, z, config, &sampler, seed)
}

pub fn sample_terrain_height_with_world_shape(
    x: f32,
    z: f32,
    config: &TerrainConfig,
    world_shape: &WorldShapeSampler,
    seed: u32,
) -> f32 {
    let shape = world_shape.sample(x, z);
    let land_factor = land_detail_factor(shape.ocean_class);

    let mountain_mask = (fbm(
        x,
        z,
        &NoiseLayer {
            scale: 0.002,
            amplitude: 1.0,
            octaves: 2,
            persistence: 0.5,
            lacunarity: 2.0,
        },
        seed.wrapping_add(500),
    ) + MOUNTAIN_MASK_OFFSET)
        .clamp(0.0, 1.0)
        * land_factor;

    let mountains = ridged_fbm(x, z, &config.mountains, seed) * mountain_mask;
    let hills = fbm(x, z, &config.hills, seed.wrapping_add(200)) * land_factor;
    let detail = fbm(x, z, &config.detail, seed.wrapping_add(300)) * land_factor;
    let height = shape.base_elevation + mountains + hills + detail;

    match shape.ocean_class {
        OceanClass::DeepSea | OceanClass::ShelfSea | OceanClass::Coast => {
            height.min(config.height.sea_level - 0.25)
        }
        OceanClass::Beach | OceanClass::Land => height.clamp(config.height.min, config.height.max),
    }
}

fn land_detail_factor(ocean_class: OceanClass) -> f32 {
    match ocean_class {
        OceanClass::Land => 1.0,
        OceanClass::Beach => BEACH_DETAIL_FACTOR,
        OceanClass::Coast => COAST_DETAIL_FACTOR,
        OceanClass::ShelfSea | OceanClass::DeepSea => UNDERWATER_DETAIL_FACTOR,
    }
}

fn simplex_2d(x: f32, y: f32, seed: u32) -> f32 {
    const F2: f32 = 0.366_025_4;
    const G2: f32 = 0.211_324_87;

    let skew = (x + y) * F2;
    let i = fast_floor(x + skew);
    let j = fast_floor(y + skew);

    let unskew = (i + j) as f32 * G2;
    let cell_x = i as f32 - unskew;
    let cell_y = j as f32 - unskew;
    let x0 = x - cell_x;
    let y0 = y - cell_y;

    let (i1, j1) = if x0 > y0 { (1, 0) } else { (0, 1) };

    let x1 = x0 - i1 as f32 + G2;
    let y1 = y0 - j1 as f32 + G2;
    let x2 = x0 - 1.0 + 2.0 * G2;
    let y2 = y0 - 1.0 + 2.0 * G2;

    let n0 = simplex_corner(i, j, x0, y0, seed);
    let n1 = simplex_corner(i + i1, j + j1, x1, y1, seed);
    let n2 = simplex_corner(i + 1, j + 1, x2, y2, seed);

    (70.0 * (n0 + n1 + n2)).clamp(-1.0, 1.0)
}

#[inline]
fn fast_floor(value: f32) -> i32 {
    let truncated = value as i32;
    if value < truncated as f32 {
        truncated - 1
    } else {
        truncated
    }
}

#[inline]
fn simplex_corner(i: i32, j: i32, x: f32, y: f32, seed: u32) -> f32 {
    let influence = 0.5 - x * x - y * y;
    if influence <= 0.0 {
        return 0.0;
    }

    let gradient = GRADIENTS[gradient_index(i, j, seed)];
    let dot = gradient[0] * x + gradient[1] * y;
    let influence2 = influence * influence;
    influence2 * influence2 * dot
}

#[inline]
fn gradient_index(i: i32, j: i32, seed: u32) -> usize {
    let mut hash = (i as u32).wrapping_mul(0x85eb_ca6b)
        ^ (j as u32).wrapping_mul(0xc2b2_ae35)
        ^ seed.wrapping_mul(0x27d4_eb2d);
    hash ^= hash >> 15;
    hash = hash.wrapping_mul(0x2c1b_3c6d);
    hash ^= hash >> 12;
    hash = hash.wrapping_mul(0x297a_2d39);
    hash ^= hash >> 15;
    hash as usize & (GRADIENTS.len() - 1)
}

const GRADIENTS: [[f32; 2]; 8] = [
    [1.0, 0.0],
    [-1.0, 0.0],
    [0.0, 1.0],
    [0.0, -1.0],
    [0.707_106_77, 0.707_106_77],
    [-0.707_106_77, 0.707_106_77],
    [0.707_106_77, -0.707_106_77],
    [-0.707_106_77, -0.707_106_77],
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::config::{NoiseLayer, TerrainConfig};

    #[test]
    fn simplex_2d_varies_across_coordinates() {
        let samples = [
            simplex_2d(0.1, 0.2, 7),
            simplex_2d(1.3, -2.1, 7),
            simplex_2d(8.0, 5.5, 7),
            simplex_2d(-13.7, 21.4, 7),
        ];

        assert!(
            samples.iter().any(|sample| sample.abs() > 0.001),
            "simplex samples should not all collapse to zero: {samples:?}"
        );
        assert!(
            samples
                .windows(2)
                .any(|pair| (pair[0] - pair[1]).abs() > 0.001),
            "simplex samples should vary by coordinate: {samples:?}"
        );
    }

    #[test]
    fn simplex_2d_is_deterministic_and_seeded() {
        let sample = simplex_2d(12.5, -9.25, 42);

        assert_eq!(sample, simplex_2d(12.5, -9.25, 42));
        assert_ne!(sample, simplex_2d(12.5, -9.25, 43));
    }

    #[test]
    fn fbm_respects_layer_amplitude() {
        let layer = NoiseLayer {
            scale: 0.07,
            amplitude: 3.5,
            octaves: 4,
            persistence: 0.5,
            lacunarity: 2.0,
        };

        let sample = fbm(32.0, -19.0, &layer, 11);

        assert!(
            (-layer.amplitude..=layer.amplitude).contains(&sample),
            "fBm sample {sample} should be bounded by layer amplitude {}",
            layer.amplitude
        );
    }

    #[test]
    fn sampled_terrain_height_varies() {
        let config = TerrainConfig::default();
        let heights = [
            sample_terrain_height(0.0, 0.0, &config, 5),
            sample_terrain_height(128.0, 64.0, &config, 5),
            sample_terrain_height(-256.0, 96.0, &config, 5),
            sample_terrain_height(512.0, -384.0, &config, 5),
        ];

        let min = heights.iter().copied().fold(f32::INFINITY, f32::min);
        let max = heights.iter().copied().fold(f32::NEG_INFINITY, f32::max);

        assert!(
            max - min > 1.0,
            "terrain height samples should vary after noise is applied: {heights:?}"
        );
    }

    #[test]
    fn underwater_samples_stay_below_sea_level() {
        let config = TerrainConfig::default();
        let mut shape_config = WorldShapeConfig::default();
        shape_config.seed = 5;
        shape_config.continents.threshold = 2.0;
        let sampler = WorldShapeSampler::new(shape_config);

        let height = sample_terrain_height_with_world_shape(0.0, 0.0, &config, &sampler, 5);

        assert!(height <= config.height.sea_level - 0.25);
    }
}
