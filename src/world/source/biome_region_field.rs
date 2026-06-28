use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};

use super::island_shape::{sample_island_mask, IslandMaskSample, IslandShapeConfig};
use super::noise::smooth01;

pub const BIOME_REGION_CELL_M: f32 = 420.0;
pub const BIOME_OCEAN_HEIGHT_MARGIN_M: f32 = 1.5;
pub const BIOME_OCEAN_ISLAND_MASK_MAX: f32 = 0.08;
pub const BIOME_COAST_HEIGHT_BAND_M: f32 = 4.0;
pub const BIOME_COAST_SHORE_DISTANCE_M: f32 = 42.0;
pub const BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M: f32 = 68.0;
pub const BIOME_SWAMP_HEIGHT_ABOVE_SEA_M: f32 = 8.0;
pub const BIOME_SWAMP_NOISE_MAX: f32 = 0.42;
pub const BIOME_PLAINS_DISTANCE_MIN: f32 = 0.72;
pub const BIOME_PLAINS_NOISE_MIN: f32 = 0.58;
pub const BIOME_FOREST_NOISE_MIN: f32 = 0.46;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[repr(u8)]
pub enum BiomeId {
    Meadows = 0,
    Forest = 1,
    Swamp = 2,
    Mountain = 3,
    Plains = 4,
    Coast = 5,
    Ocean = 6,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BiomeRegionSample {
    pub biome: BiomeId,
    pub region_noise: f32,
    pub island_distance_t: f32,
}

#[derive(Resource, Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BiomeRegionField {
    pub seed: i32,
    pub sea_level: f32,
    pub region_cell_m: f32,
    pub island_shape: IslandShapeConfig,
}

#[derive(Debug, Clone, Copy)]
pub struct BiomeRegionClassifyInput {
    pub x: f32,
    pub z: f32,
    pub height: f32,
    pub seed: i32,
    pub sea_level: f32,
    pub region_cell_m: f32,
    pub island_radius_m: f32,
    pub island: IslandMaskSample,
}

impl BiomeId {
    pub fn layer_index(self) -> u32 {
        self as u32
    }
}

impl BiomeRegionField {
    pub fn new(seed: i32, sea_level: f32, island_shape: IslandShapeConfig) -> Self {
        Self {
            seed,
            sea_level,
            region_cell_m: BIOME_REGION_CELL_M,
            island_shape,
        }
    }

    pub fn with_region_cell_m(mut self, region_cell_m: f32) -> Self {
        self.region_cell_m = resolve_region_cell_m(region_cell_m);
        self
    }

    pub fn sample(&self, x: f32, z: f32, height: f32) -> BiomeRegionSample {
        let island = sample_island_mask(x, z, &self.island_shape);
        classify_biome_region(BiomeRegionClassifyInput {
            x,
            z,
            height,
            seed: self.seed,
            sea_level: self.sea_level,
            region_cell_m: self.region_cell_m,
            island_radius_m: self.island_shape.radius_m.max(1.0),
            island,
        })
    }
}

impl Default for BiomeRegionField {
    fn default() -> Self {
        Self::new(0, 18.0, IslandShapeConfig::default())
    }
}

fn resolve_region_cell_m(region_cell_m: f32) -> f32 {
    if !region_cell_m.is_finite() {
        return BIOME_REGION_CELL_M;
    }
    if (region_cell_m - BIOME_REGION_CELL_M).abs() > f32::EPSILON {
        panic!(
            "BiomeRegionField region_cell_m must be {BIOME_REGION_CELL_M} to match the GPU shader; got {region_cell_m}"
        );
    }
    BIOME_REGION_CELL_M
}

fn mix32(value: u32) -> u32 {
    let mut mixed = value;
    mixed ^= mixed >> 16;
    mixed = mixed.wrapping_mul(0x7feb_352d);
    mixed ^= mixed >> 15;
    mixed = mixed.wrapping_mul(0x846c_a68b);
    mixed ^= mixed >> 16;
    mixed
}

pub fn pcg2d(x: i32, z: i32, seed: i32) -> f32 {
    let value = (seed as u32)
        ^ (x as u32).wrapping_mul(0x1f12_3bb5)
        ^ (z as u32).wrapping_mul(0x5f35_6495);
    mix32(value) as f32 / 4_294_967_296.0
}

pub fn biome_region_noise(x: f32, z: f32, cell_m: f32, seed: i32) -> f32 {
    let cell_m = resolve_region_cell_m(cell_m);
    let gx = x / cell_m;
    let gz = z / cell_m;
    let x0 = gx.floor() as i32;
    let z0 = gz.floor() as i32;
    let tx = smooth01(gx - x0 as f32);
    let tz = smooth01(gz - z0 as f32);
    let a = pcg2d(x0, z0, seed);
    let b = pcg2d(x0.wrapping_add(1), z0, seed);
    let c = pcg2d(x0, z0.wrapping_add(1), seed);
    let d = pcg2d(x0.wrapping_add(1), z0.wrapping_add(1), seed);
    a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz
}

pub fn classify_biome_region(input: BiomeRegionClassifyInput) -> BiomeRegionSample {
    if input.height < input.sea_level - BIOME_OCEAN_HEIGHT_MARGIN_M
        || input.island.mask < BIOME_OCEAN_ISLAND_MASK_MAX
    {
        return BiomeRegionSample {
            biome: BiomeId::Ocean,
            region_noise: 0.0,
            island_distance_t: 0.0,
        };
    }
    if (input.height - input.sea_level).abs() < BIOME_COAST_HEIGHT_BAND_M
        || input.island.shore_distance_m < BIOME_COAST_SHORE_DISTANCE_M
    {
        return BiomeRegionSample {
            biome: BiomeId::Coast,
            region_noise: 0.0,
            island_distance_t: 0.0,
        };
    }

    let n = biome_region_noise(
        input.x,
        input.z,
        input.region_cell_m,
        input.seed.wrapping_add(711),
    );
    let center_distance = (input.x - input.island.nearest_center_x)
        .hypot(input.z - input.island.nearest_center_z);
    let distance_t = (center_distance / input.island_radius_m.max(1.0)).clamp(0.0, 1.0);

    let biome = if input.height >= input.sea_level + BIOME_MOUNTAIN_HEIGHT_ABOVE_SEA_M {
        BiomeId::Mountain
    } else if input.height <= input.sea_level + BIOME_SWAMP_HEIGHT_ABOVE_SEA_M
        && n < BIOME_SWAMP_NOISE_MAX
    {
        BiomeId::Swamp
    } else if distance_t > BIOME_PLAINS_DISTANCE_MIN && n > BIOME_PLAINS_NOISE_MIN {
        BiomeId::Plains
    } else if n > BIOME_FOREST_NOISE_MIN {
        BiomeId::Forest
    } else {
        BiomeId::Meadows
    };

    BiomeRegionSample {
        biome,
        region_noise: n,
        island_distance_t: distance_t,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn land_input(height: f32, noise_x: f32) -> BiomeRegionClassifyInput {
        BiomeRegionClassifyInput {
            x: noise_x,
            z: 0.0,
            height,
            seed: 0,
            sea_level: 18.0,
            region_cell_m: BIOME_REGION_CELL_M,
            island_radius_m: 560.0,
            island: IslandMaskSample {
                mask: 1.0,
                shore_distance_m: 200.0,
                nearest_center_x: 0.0,
                nearest_center_z: 0.0,
                cliff_weight: 0.0,
            },
        }
    }

    #[test]
    fn ocean_and_coast_are_height_or_mask_driven() {
        let mut input = land_input(10.0, 0.0);
        assert_eq!(classify_biome_region(input).biome, BiomeId::Ocean);

        input.height = 18.5;
        assert_eq!(classify_biome_region(input).biome, BiomeId::Coast);

        input.height = 50.0;
        input.island.mask = 0.05;
        assert_eq!(classify_biome_region(input).biome, BiomeId::Ocean);
    }

    #[test]
    fn high_elevation_is_mountain() {
        assert_eq!(classify_biome_region(land_input(90.0, 0.0)).biome, BiomeId::Mountain);
    }

    #[test]
    fn field_sampling_is_deterministic() {
        let field = BiomeRegionField::default();
        let a = field.sample(512.0, -128.0, 72.0);
        let b = field.sample(512.0, -128.0, 72.0);
        assert_eq!(a, b);
    }

    #[test]
    #[should_panic(expected = "match the GPU shader")]
    fn region_cell_m_rejects_cpu_only_values() {
        let _ = BiomeRegionField::default().with_region_cell_m(BIOME_REGION_CELL_M + 1.0);
    }
}
