//! Per-point climate / scatter fields derived from terrain generation.
//!
//! These are exposed for prop scatter (stones) which needs snow, moisture, river depth,
//! rock exposure and standing-water signals that the voxel path does not surface directly.
//! Everything here is derived from the existing height / biome / water / noise machinery and
//! driven by `self.seed`, so it is deterministic and additive — `get_voxel` and `get_height`
//! are untouched.

use crate::constants::WATER_LEVEL;

use super::{Biome, NoiseGenerator, TerrainGenerator, smoothstep_range};

/// Snow line as a fraction of the band between the water level and the height ceiling.
const SNOW_START_T: f32 = 0.5;
const SNOW_FULL_T: f32 = 0.85;
/// Horizontal step (cells) used to estimate slope from neighbouring heights.
const SLOPE_STEP: i32 = 2;

/// Terrain-derived placement fields at a world column. Values are in `[0, 1]` unless noted.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ClimateSample {
    /// Snow cover, rising with altitude (and slightly in colder/rocky areas).
    pub snow: f32,
    /// Surface moisture from precipitation noise, water proximity and biome.
    pub moisture: f32,
    /// River channel carve depth in world units (0 away from rivers).
    pub river_depth: f32,
    /// Bare-rock likelihood (rocky biome, steep slopes, high altitude).
    pub rock_exposure: f32,
    /// True where a surface water body (ocean/lake/river/pond) covers this column.
    pub standing_water: bool,
}

impl<N: NoiseGenerator> TerrainGenerator<N> {
    /// Samples the climate / scatter fields for prop placement at a world column.
    pub fn get_climate(&self, world_x: i32, world_z: i32) -> ClimateSample {
        let x = world_x as f32;
        let z = world_z as f32;

        let height = self.get_height(world_x, world_z) as f32;
        let biome = self.get_biome(world_x, world_z);
        let water = self.get_water_generation_metadata(world_x, world_z);
        let standing_water = water.is_surface_water();
        let river_depth = self.river_carve(x, z).max(0.0);

        let ceiling = self.config.height.max.max(WATER_LEVEL as f32 + 1.0);
        let range = (ceiling - WATER_LEVEL as f32).max(1.0);
        let altitude_t = ((height - WATER_LEVEL as f32) / range).clamp(0.0, 1.0);
        let slope01 = self.slope01(world_x, world_z);

        // Snow: altitude-driven, nudged by a low-frequency temperature field (warmer => less).
        let temperature = self.noise.fbm_2d(x * 0.004, z * 0.004, 2);
        let snow_t = altitude_t - (temperature - 0.5) * 0.2;
        let mut snow = smoothstep_range(SNOW_START_T, SNOW_FULL_T, snow_t);
        if biome == Biome::Rocky {
            snow = (snow + 0.08).min(1.0);
        }
        if standing_water {
            snow = 0.0;
        }

        // Moisture: precipitation noise + shoreline/river dampness + biome bias.
        let precipitation = self.noise.fbm_2d(x * 0.01 + 777.0, z * 0.01 - 333.0, 3);
        let shore_wet = 1.0 - ((height - WATER_LEVEL as f32) / 8.0).clamp(0.0, 1.0);
        let river_wet = if river_depth > 0.0 { 0.4 } else { 0.0 };
        let biome_moisture_bias = match biome {
            Biome::Sandy => -0.2,
            Biome::Clay => 0.15,
            _ => 0.0,
        };
        let mut moisture =
            (precipitation * 0.55 + shore_wet * 0.3 + river_wet + biome_moisture_bias)
                .clamp(0.0, 1.0);
        if standing_water {
            moisture = 1.0;
        }

        // Rock exposure: rocky biome + steep slopes + altitude.
        let biome_rock_base = match biome {
            Biome::Rocky => 0.7,
            Biome::Grassland => 0.12,
            Biome::Sandy => 0.05,
            Biome::Clay => 0.1,
        };
        let rock_exposure = (biome_rock_base + slope01 * 0.55 + altitude_t * 0.25).clamp(0.0, 1.0);

        ClimateSample {
            snow,
            moisture,
            river_depth,
            rock_exposure,
            standing_water,
        }
    }

    /// Slope in `[0, 1)` from central differences of neighbouring surface heights
    /// (0 = flat, approaching 1 as the surface steepens).
    fn slope01(&self, world_x: i32, world_z: i32) -> f32 {
        let step = SLOPE_STEP;
        let hxp = self.get_height(world_x + step, world_z) as f32;
        let hxn = self.get_height(world_x - step, world_z) as f32;
        let hzp = self.get_height(world_x, world_z + step) as f32;
        let hzn = self.get_height(world_x, world_z - step) as f32;
        let span = (2 * step) as f32;
        let dx = (hxp - hxn) / span;
        let dz = (hzp - hzn) / span;
        let gradient = (dx * dx + dz * dz).sqrt();
        gradient / (1.0 + gradient)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::config::TerrainConfig;
    use crate::voxel::terrain::ValueNoise;

    fn generator() -> TerrainGenerator<ValueNoise> {
        TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default())
    }

    #[test]
    fn climate_is_deterministic() {
        let terrain = generator();
        for (x, z) in [(0, 0), (137, -64), (-512, 1024)] {
            assert_eq!(terrain.get_climate(x, z), terrain.get_climate(x, z));
        }
    }

    #[test]
    fn fields_stay_in_range() {
        let terrain = generator();
        for x in (-256..256).step_by(17) {
            for z in (-256..256).step_by(17) {
                let c = terrain.get_climate(x, z);
                assert!(
                    (0.0..=1.0).contains(&c.snow),
                    "snow out of range: {}",
                    c.snow
                );
                assert!(
                    (0.0..=1.0).contains(&c.moisture),
                    "moisture: {}",
                    c.moisture
                );
                assert!(
                    (0.0..=1.0).contains(&c.rock_exposure),
                    "rock_exposure: {}",
                    c.rock_exposure
                );
                assert!(c.river_depth >= 0.0 && c.river_depth.is_finite());
            }
        }
    }

    #[test]
    fn snow_increases_with_altitude() {
        // Statistical: higher columns carry at least as much snow on average as lower ones.
        let terrain = generator();
        let mut samples: Vec<(f32, f32)> = Vec::new();
        for x in (-400..400).step_by(13) {
            for z in (-400..400).step_by(13) {
                let height = terrain.get_height(x, z) as f32;
                samples.push((height, terrain.get_climate(x, z).snow));
            }
        }
        samples.sort_by(|a, b| a.0.total_cmp(&b.0));
        let quartile = samples.len() / 4;
        let low_avg: f32 = samples[..quartile].iter().map(|s| s.1).sum::<f32>() / quartile as f32;
        let high_avg: f32 = samples[samples.len() - quartile..]
            .iter()
            .map(|s| s.1)
            .sum::<f32>()
            / quartile as f32;
        assert!(
            high_avg >= low_avg,
            "high terrain should hold >= snow than low (low {low_avg}, high {high_avg})",
        );
    }

    #[test]
    fn standing_water_matches_surface_water() {
        let terrain = generator();
        for x in (-256..256).step_by(31) {
            for z in (-256..256).step_by(31) {
                let c = terrain.get_climate(x, z);
                let water = terrain.get_water_generation_metadata(x, z);
                assert_eq!(c.standing_water, water.is_surface_water());
                if c.standing_water {
                    assert_eq!(c.snow, 0.0);
                    assert_eq!(c.moisture, 1.0);
                }
            }
        }
    }
}
