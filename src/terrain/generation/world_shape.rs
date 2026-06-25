use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};
use std::path::Path;

use super::config::NoiseLayer;
use super::noise::fbm;

pub const WORLD_SHAPE_CONFIG_PATH: &str = "assets/config/world_shape.yaml";
const COAST_GRADIENT_STEP_M: f32 = 64.0;
const MIN_GRADIENT: f32 = 0.0001;

#[derive(Debug, Deserialize, Serialize)]
pub struct WorldShapeConfigFile {
    pub world_shape: WorldShapeConfig,
}

#[derive(Resource, Debug, Deserialize, Serialize, Clone)]
pub struct WorldShapeConfig {
    pub seed: u32,
    pub sea_level: f32,
    pub continents: ContinentShapeConfig,
    pub islands: IslandShapeConfig,
    pub coast: CoastShapeConfig,
    pub ocean: OceanShapeConfig,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ContinentShapeConfig {
    pub scale: f32,
    pub octaves: u32,
    pub lacunarity: f32,
    pub gain: f32,
    pub threshold: f32,
    pub warp_scale: f32,
    pub warp_strength_m: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct IslandShapeConfig {
    pub scale: f32,
    pub octaves: u32,
    pub lacunarity: f32,
    pub gain: f32,
    pub threshold: f32,
    pub contribution: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CoastShapeConfig {
    pub beach_width_m: f32,
    pub shelf_width_m: f32,
    pub cliff_chance: f32,
    pub cliff_noise_scale: f32,
    pub cliff_slope_threshold: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OceanShapeConfig {
    pub shelf_depth: f32,
    pub deep_sea_depth: f32,
    pub trench_depth: f32,
    pub trench_scale: f32,
    pub trench_strength: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OceanClass {
    DeepSea,
    ShelfSea,
    Coast,
    Beach,
    Land,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BiomeHint {
    Ocean,
    Beach,
    Lowland,
    Highland,
    Mountain,
}

#[derive(Debug, Clone, Copy)]
pub struct WorldShapeSample {
    pub continental: f32,
    pub island: f32,
    pub land_mask: f32,
    pub coast_distance_m: f32,
    pub base_elevation: f32,
    pub ocean_class: OceanClass,
    pub biome_hint: BiomeHint,
}

#[derive(Debug, Clone)]
pub struct WorldShapeSampler {
    config: WorldShapeConfig,
}

impl WorldShapeSampler {
    pub fn new(config: WorldShapeConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &WorldShapeConfig {
        &self.config
    }

    pub fn sample(&self, x: f32, z: f32) -> WorldShapeSample {
        let land_mask = self.land_mask(x, z);
        let coast_distance_m = self.estimate_coast_distance(x, z, land_mask);
        let continental = self.continental_value(x, z);
        let island = self.island_value(x, z);
        let ocean_class = classify_ocean(land_mask, coast_distance_m, &self.config.coast);
        let base_elevation = self.base_elevation(x, z, land_mask, coast_distance_m, ocean_class);
        let biome_hint = classify_biome(base_elevation, ocean_class, self.config.sea_level);

        WorldShapeSample {
            continental,
            island,
            land_mask,
            coast_distance_m,
            base_elevation,
            ocean_class,
            biome_hint,
        }
    }

    fn land_mask(&self, x: f32, z: f32) -> f32 {
        let warp_layer = NoiseLayer {
            scale: self.config.continents.warp_scale,
            amplitude: self.config.continents.warp_strength_m,
            octaves: 2,
            persistence: 0.5,
            lacunarity: 2.0,
        };
        let warp_x = fbm(x, z, &warp_layer, self.config.seed.wrapping_add(11));
        let warp_z = fbm(x, z, &warp_layer, self.config.seed.wrapping_add(17));
        let wx = x + warp_x;
        let wz = z + warp_z;

        let continental = self.continental_value_at(wx, wz) - self.config.continents.threshold;
        let island = (self.island_value_at(wx, wz) - self.config.islands.threshold).max(0.0)
            * self.config.islands.contribution;

        continental + island
    }

    fn continental_value(&self, x: f32, z: f32) -> f32 {
        self.continental_value_at(x, z)
    }

    fn continental_value_at(&self, x: f32, z: f32) -> f32 {
        fbm(
            x,
            z,
            &NoiseLayer {
                scale: self.config.continents.scale,
                amplitude: 1.0,
                octaves: self.config.continents.octaves,
                persistence: self.config.continents.gain,
                lacunarity: self.config.continents.lacunarity,
            },
            self.config.seed,
        )
    }

    fn island_value(&self, x: f32, z: f32) -> f32 {
        self.island_value_at(x, z)
    }

    fn island_value_at(&self, x: f32, z: f32) -> f32 {
        fbm(
            x,
            z,
            &NoiseLayer {
                scale: self.config.islands.scale,
                amplitude: 1.0,
                octaves: self.config.islands.octaves,
                persistence: self.config.islands.gain,
                lacunarity: self.config.islands.lacunarity,
            },
            self.config.seed.wrapping_add(101),
        )
    }

    fn estimate_coast_distance(&self, x: f32, z: f32, land_mask: f32) -> f32 {
        let dx = self.land_mask(x + COAST_GRADIENT_STEP_M, z)
            - self.land_mask(x - COAST_GRADIENT_STEP_M, z);
        let dz = self.land_mask(x, z + COAST_GRADIENT_STEP_M)
            - self.land_mask(x, z - COAST_GRADIENT_STEP_M);
        let gradient = ((dx * dx + dz * dz).sqrt() / (COAST_GRADIENT_STEP_M * 2.0)).max(MIN_GRADIENT);

        land_mask / gradient
    }

    fn base_elevation(
        &self,
        x: f32,
        z: f32,
        land_mask: f32,
        coast_distance_m: f32,
        ocean_class: OceanClass,
    ) -> f32 {
        match ocean_class {
            OceanClass::Land | OceanClass::Beach => {
                let normalized_land = land_mask.max(0.0).sqrt();
                self.config.sea_level + normalized_land * 64.0
            }
            OceanClass::Coast => self.config.sea_level - 2.0,
            OceanClass::ShelfSea => {
                let t = (-coast_distance_m / self.config.coast.shelf_width_m).clamp(0.0, 1.0);
                lerp(self.config.sea_level, self.config.ocean.shelf_depth, smoothstep(t))
            }
            OceanClass::DeepSea => {
                let trench = fbm(
                    x,
                    z,
                    &NoiseLayer {
                        scale: self.config.ocean.trench_scale,
                        amplitude: 1.0,
                        octaves: 3,
                        persistence: 0.5,
                        lacunarity: 2.0,
                    },
                    self.config.seed.wrapping_add(211),
                )
                .abs()
                    * self.config.ocean.trench_strength;
                lerp(
                    self.config.ocean.deep_sea_depth,
                    self.config.ocean.trench_depth,
                    trench.clamp(0.0, 1.0),
                )
            }
        }
    }

    pub fn load(path: impl AsRef<Path>) -> Result<Self, Box<dyn std::error::Error>> {
        let file = std::fs::File::open(path)?;
        let reader = std::io::BufReader::new(file);
        let config_file: WorldShapeConfigFile = serde_yaml::from_reader(reader)?;
        Ok(Self::new(config_file.world_shape))
    }

    pub fn load_or_default() -> Self {
        match Self::load(WORLD_SHAPE_CONFIG_PATH) {
            Ok(sampler) => sampler,
            Err(error) => {
                bevy::log::warn!(
                    "Failed to load world shape config from {}: {}; using defaults",
                    WORLD_SHAPE_CONFIG_PATH,
                    error
                );
                Self::new(WorldShapeConfig::default())
            }
        }
    }
}

pub fn classify_ocean(
    land_mask: f32,
    coast_distance_m: f32,
    coast: &CoastShapeConfig,
) -> OceanClass {
    if land_mask > 0.0 {
        if coast_distance_m <= coast.beach_width_m {
            OceanClass::Beach
        } else {
            OceanClass::Land
        }
    } else if coast_distance_m.abs() <= coast.beach_width_m {
        OceanClass::Coast
    } else if coast_distance_m.abs() <= coast.shelf_width_m {
        OceanClass::ShelfSea
    } else {
        OceanClass::DeepSea
    }
}

pub fn classify_biome(elevation: f32, ocean_class: OceanClass, sea_level: f32) -> BiomeHint {
    match ocean_class {
        OceanClass::DeepSea | OceanClass::ShelfSea | OceanClass::Coast => BiomeHint::Ocean,
        OceanClass::Beach => BiomeHint::Beach,
        OceanClass::Land if elevation > sea_level + 72.0 => BiomeHint::Mountain,
        OceanClass::Land if elevation > sea_level + 36.0 => BiomeHint::Highland,
        OceanClass::Land => BiomeHint::Lowland,
    }
}

impl Default for WorldShapeConfig {
    fn default() -> Self {
        Self {
            seed: 1337,
            sea_level: 0.0,
            continents: ContinentShapeConfig {
                scale: 0.00055,
                octaves: 5,
                lacunarity: 2.0,
                gain: 0.5,
                threshold: 0.08,
                warp_scale: 0.0009,
                warp_strength_m: 180.0,
            },
            islands: IslandShapeConfig {
                scale: 0.0018,
                octaves: 4,
                lacunarity: 2.1,
                gain: 0.52,
                threshold: 0.22,
                contribution: 0.35,
            },
            coast: CoastShapeConfig {
                beach_width_m: 45.0,
                shelf_width_m: 220.0,
                cliff_chance: 0.35,
                cliff_noise_scale: 0.004,
                cliff_slope_threshold: 0.42,
            },
            ocean: OceanShapeConfig {
                shelf_depth: -8.0,
                deep_sea_depth: -80.0,
                trench_depth: -160.0,
                trench_scale: 0.0008,
                trench_strength: 0.45,
            },
        }
    }
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    let clamped = t.clamp(0.0, 1.0);
    clamped * clamped * (3.0 - 2.0 * clamped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_shape_yaml_matches_runtime_defaults() {
        let sampler = WorldShapeSampler::load(WORLD_SHAPE_CONFIG_PATH)
            .expect("world_shape.yaml should deserialize");
        let defaults = WorldShapeConfig::default();

        assert_eq!(sampler.config().seed, defaults.seed);
        assert_eq!(sampler.config().sea_level, defaults.sea_level);
        assert_eq!(sampler.config().continents.scale, defaults.continents.scale);
        assert_eq!(sampler.config().islands.threshold, defaults.islands.threshold);
        assert_eq!(sampler.config().coast.beach_width_m, defaults.coast.beach_width_m);
        assert_eq!(sampler.config().ocean.deep_sea_depth, defaults.ocean.deep_sea_depth);
    }

    #[test]
    fn sampler_is_deterministic() {
        let sampler = WorldShapeSampler::new(WorldShapeConfig::default());

        let a = sampler.sample(1200.0, -400.0);
        let b = sampler.sample(1200.0, -400.0);

        assert_eq!(a.land_mask, b.land_mask);
        assert_eq!(a.ocean_class, b.ocean_class);
        assert_eq!(a.biome_hint, b.biome_hint);
    }

    #[test]
    fn ocean_classification_respects_coast_distance() {
        let coast = WorldShapeConfig::default().coast;

        assert_eq!(classify_ocean(0.2, 100.0, &coast), OceanClass::Land);
        assert_eq!(classify_ocean(0.2, 12.0, &coast), OceanClass::Beach);
        assert_eq!(classify_ocean(-0.01, -12.0, &coast), OceanClass::Coast);
        assert_eq!(classify_ocean(-0.2, -100.0, &coast), OceanClass::ShelfSea);
        assert_eq!(classify_ocean(-0.6, -400.0, &coast), OceanClass::DeepSea);
    }
}
