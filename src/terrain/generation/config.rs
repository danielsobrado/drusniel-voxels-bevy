use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::terrain::hydrology::VisualHydrologyConfig;

pub const TERRAIN_CONFIG_PATH: &str = "assets/config/terrain_generation.yaml";
pub const TERRAIN_MATERIALS_PATH: &str = "assets/content/materials.yaml";
pub const TERRAIN_BIOMES_PATH: &str = "assets/content/biomes.yaml";
pub const TERRAIN_GENERATION_VERSION: u64 = 11;

/// Wrapper for YAML file structure (has `terrain:` root key)
#[derive(Debug, Deserialize, Serialize)]
pub struct TerrainConfigFile {
    pub terrain: TerrainConfig,
}

#[derive(Resource, Debug, Deserialize, Serialize, Clone)]
pub struct TerrainConfig {
    pub height: HeightConfig,
    pub continent: NoiseLayer,
    pub mountains: MountainConfig,
    pub hills: NoiseLayer,
    pub detail: NoiseLayer,
    #[serde(default)]
    pub caves: CaveConfig,
    #[serde(default)]
    pub rivers: RiverConfig,
    #[serde(default)]
    pub water_bodies: WaterBodyGenerationConfig,
    #[serde(default)]
    pub visual_hydrology: VisualHydrologyConfig,
    #[serde(default)]
    pub biome_modifiers: HashMap<String, f32>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CaveConfig {
    pub enabled: bool,
}

impl Default for CaveConfig {
    fn default() -> Self {
        Self { enabled: false }
    }
}

/// Configuration for river generation
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct RiverConfig {
    /// Enable river generation
    pub enabled: bool,
    /// Scale of the main river pattern (lower = larger rivers)
    pub scale: f32,
    /// Width of rivers in voxels
    pub width: f32,
    /// Maximum depth of river channels below water level
    pub depth: f32,
    /// Number of noise octaves for river meandering
    pub octaves: u32,
    /// Scale of secondary river network
    pub tributary_scale: f32,
    /// Width of tributary rivers
    pub tributary_width: f32,
}

impl Default for RiverConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            scale: 0.003,
            width: 4.0,
            depth: 6.0,
            octaves: 3,
            tributary_scale: 0.008,
            tributary_width: 2.0,
        }
    }
}

/// Configuration for deterministic lake, pond, and aquifer generation.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct WaterBodyGenerationConfig {
    pub enabled: bool,
    pub lakes: BasinConfig,
    pub ponds: BasinConfig,
    pub aquifers: AquiferConfig,
}

impl Default for WaterBodyGenerationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            lakes: BasinConfig {
                enabled: true,
                spacing: 96.0,
                density: 0.38,
                min_radius: 18.0,
                max_radius: 42.0,
                min_depth: 3.0,
                max_depth: 8.0,
                shore_power: 1.45,
            },
            ponds: BasinConfig {
                enabled: true,
                spacing: 48.0,
                density: 0.34,
                min_radius: 7.0,
                max_radius: 17.0,
                min_depth: 2.0,
                max_depth: 5.0,
                shore_power: 1.25,
            },
            aquifers: AquiferConfig::default(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BasinConfig {
    pub enabled: bool,
    pub spacing: f32,
    pub density: f32,
    pub min_radius: f32,
    pub max_radius: f32,
    pub min_depth: f32,
    pub max_depth: f32,
    pub shore_power: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AquiferConfig {
    pub enabled: bool,
    pub max_y: i32,
    pub noise_scale: f32,
    pub threshold: f32,
}

impl Default for AquiferConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_y: 10,
            noise_scale: 0.045,
            threshold: 0.84,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct HeightConfig {
    pub min: f32,
    pub max: f32,
    pub sea_level: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct NoiseLayer {
    pub scale: f32,
    pub amplitude: f32,
    pub octaves: u32,
    pub persistence: f32,
    pub lacunarity: f32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct MountainConfig {
    pub scale: f32,
    pub amplitude: f32,
    pub octaves: u32,
    pub persistence: f32,
    pub lacunarity: f32,
    pub ridge_power: f32,
    #[serde(default = "default_massif_scale")]
    pub massif_scale: f32,
    #[serde(default = "default_massif_amplitude")]
    pub massif_amplitude: f32,
    #[serde(default = "default_massif_threshold")]
    pub massif_threshold: f32,
    #[serde(default = "default_massif_power")]
    pub massif_power: f32,
}

fn default_massif_scale() -> f32 {
    0.0035
}

fn default_massif_amplitude() -> f32 {
    38.0
}

fn default_massif_threshold() -> f32 {
    0.38
}

fn default_massif_power() -> f32 {
    1.65
}

impl Default for TerrainConfig {
    fn default() -> Self {
        Self {
            height: HeightConfig {
                min: 14.0,
                max: 118.0,
                sea_level: 0.0,
            },
            continent: NoiseLayer {
                scale: 0.001,
                amplitude: 40.0,
                octaves: 2,
                persistence: 0.5,
                lacunarity: 2.0,
            },
            mountains: MountainConfig {
                scale: 0.008,
                amplitude: 120.0,
                octaves: 7,
                persistence: 0.48,
                lacunarity: 2.3,
                ridge_power: 1.8,
                massif_scale: default_massif_scale(),
                massif_amplitude: default_massif_amplitude(),
                massif_threshold: default_massif_threshold(),
                massif_power: default_massif_power(),
            },
            hills: NoiseLayer {
                scale: 0.025,
                amplitude: 25.0,
                octaves: 4,
                persistence: 0.5,
                lacunarity: 2.0,
            },
            detail: NoiseLayer {
                scale: 0.1,
                amplitude: 3.0,
                octaves: 3,
                persistence: 0.5,
                lacunarity: 2.0,
            },
            caves: CaveConfig::default(),
            rivers: RiverConfig::default(),
            water_bodies: WaterBodyGenerationConfig::default(),
            visual_hydrology: VisualHydrologyConfig::default(),
            biome_modifiers: HashMap::new(),
        }
    }
}

impl TerrainConfig {
    /// Load terrain config from YAML file
    pub fn load(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let file = std::fs::File::open(path)?;
        let reader = std::io::BufReader::new(file);
        let config_file: TerrainConfigFile = serde_yaml::from_reader(reader)?;
        Ok(config_file.terrain)
    }

    /// Load from default path, falling back to defaults if file not found
    pub fn load_or_default() -> Self {
        match Self::load(TERRAIN_CONFIG_PATH) {
            Ok(config) => {
                info!("Loaded terrain config from {}", TERRAIN_CONFIG_PATH);
                config
            }
            Err(e) => {
                warn!("Failed to load terrain config: {}, using defaults", e);
                Self::default()
            }
        }
    }
}

pub fn terrain_config_fingerprint() -> u64 {
    terrain_config_fingerprint_for_paths(
        Path::new(TERRAIN_CONFIG_PATH),
        Path::new(TERRAIN_MATERIALS_PATH),
        Path::new(TERRAIN_BIOMES_PATH),
    )
}

fn terrain_config_fingerprint_for_paths(
    terrain_path: &Path,
    materials_path: &Path,
    biomes_path: &Path,
) -> u64 {
    let mut hash = Fnv1a64::default();
    hash.write_u64(TERRAIN_GENERATION_VERSION);
    for (path, missing_marker) in [
        (terrain_path, b"default-terrain-config".as_slice()),
        (materials_path, b"default-material-content".as_slice()),
        (biomes_path, b"default-biome-content".as_slice()),
    ] {
        match std::fs::read(path) {
            Ok(bytes) => {
                hash.write_u64(bytes.len() as u64);
                hash.write(&bytes);
            }
            Err(_) => {
                hash.write_u64(missing_marker.len() as u64);
                hash.write(missing_marker);
            }
        }
    }
    hash.finish()
}

#[derive(Clone, Copy)]
struct Fnv1a64(u64);

impl Default for Fnv1a64 {
    fn default() -> Self {
        Self(0xcbf29ce484222325)
    }
}

impl Fnv1a64 {
    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(0x100000001b3);
        }
    }

    fn write_u64(&mut self, value: u64) {
        self.write(&value.to_le_bytes());
    }

    fn finish(self) -> u64 {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn terrain_yaml_matches_runtime_defaults() {
        let loaded = TerrainConfig::load(TERRAIN_CONFIG_PATH)
            .expect("terrain_generation.yaml should deserialize");
        let defaults = TerrainConfig::default();

        assert_eq!(loaded.height.min, defaults.height.min);
        assert_eq!(loaded.height.max, defaults.height.max);
        assert_eq!(loaded.height.sea_level, defaults.height.sea_level);
        assert_eq!(loaded.continent.amplitude, defaults.continent.amplitude);
        assert_eq!(loaded.mountains.amplitude, defaults.mountains.amplitude);
        assert_eq!(loaded.mountains.octaves, defaults.mountains.octaves);
        assert_eq!(loaded.hills.amplitude, defaults.hills.amplitude);
        assert_eq!(loaded.detail.amplitude, defaults.detail.amplitude);
        assert_eq!(loaded.caves.enabled, defaults.caves.enabled);
        assert_eq!(
            loaded.water_bodies.aquifers.enabled,
            defaults.water_bodies.aquifers.enabled
        );
        assert_eq!(
            loaded.visual_hydrology.resolution,
            defaults.visual_hydrology.resolution
        );
        assert_eq!(
            loaded.visual_hydrology.far_reduce_factor,
            defaults.visual_hydrology.far_reduce_factor
        );
    }

    #[test]
    fn terrain_fingerprint_includes_material_and_biome_content() {
        let mut terrain = tempfile::NamedTempFile::new().unwrap();
        let mut materials = tempfile::NamedTempFile::new().unwrap();
        let mut biomes = tempfile::NamedTempFile::new().unwrap();
        terrain.write_all(b"terrain-v1").unwrap();
        materials.write_all(b"materials-v1").unwrap();
        biomes.write_all(b"biomes-v1").unwrap();

        let baseline =
            terrain_config_fingerprint_for_paths(terrain.path(), materials.path(), biomes.path());
        std::fs::write(materials.path(), b"materials-v2").unwrap();
        let materials_changed =
            terrain_config_fingerprint_for_paths(terrain.path(), materials.path(), biomes.path());
        std::fs::write(biomes.path(), b"biomes-v2").unwrap();
        let biomes_changed =
            terrain_config_fingerprint_for_paths(terrain.path(), materials.path(), biomes.path());

        assert_ne!(baseline, materials_changed);
        assert_ne!(materials_changed, biomes_changed);
    }
}
