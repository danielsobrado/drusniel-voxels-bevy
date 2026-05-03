use bevy::prelude::*;
use serde::Deserialize;
use std::collections::HashMap;

/// Wrapper for YAML file structure (has `terrain:` root key)
#[derive(Deserialize)]
pub struct TerrainConfigFile {
    pub terrain: TerrainConfig,
}

#[derive(Resource, Deserialize, Clone)]
pub struct TerrainConfig {
    pub height: HeightConfig,
    pub continent: NoiseLayer,
    pub mountains: MountainConfig,
    pub hills: NoiseLayer,
    pub detail: NoiseLayer,
    #[serde(default)]
    pub rivers: RiverConfig,
    #[serde(default)]
    pub water_bodies: WaterBodyGenerationConfig,
    #[serde(default)]
    pub biome_modifiers: HashMap<String, f32>,
}

/// Configuration for river generation
#[derive(Deserialize, Clone)]
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
#[derive(Deserialize, Clone)]
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

#[derive(Deserialize, Clone)]
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

#[derive(Deserialize, Clone)]
pub struct AquiferConfig {
    pub enabled: bool,
    pub max_y: i32,
    pub noise_scale: f32,
    pub threshold: f32,
}

impl Default for AquiferConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_y: 10,
            noise_scale: 0.045,
            threshold: 0.84,
        }
    }
}

#[derive(Deserialize, Clone)]
pub struct HeightConfig {
    pub min: f32,
    pub max: f32,
    pub sea_level: f32,
}

#[derive(Deserialize, Clone)]
pub struct NoiseLayer {
    pub scale: f32,
    pub amplitude: f32,
    pub octaves: u32,
    pub persistence: f32,
    pub lacunarity: f32,
}

#[derive(Deserialize, Clone)]
pub struct MountainConfig {
    pub scale: f32,
    pub amplitude: f32,
    pub octaves: u32,
    pub persistence: f32,
    pub lacunarity: f32,
    pub ridge_power: f32,
}

impl Default for TerrainConfig {
    fn default() -> Self {
        Self {
            height: HeightConfig {
                min: -64.0,
                max: 180.0,
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
            rivers: RiverConfig::default(),
            water_bodies: WaterBodyGenerationConfig::default(),
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
        match Self::load("assets/config/terrain_generation.yaml") {
            Ok(config) => {
                info!("Loaded terrain config from assets/config/terrain_generation.yaml");
                config
            }
            Err(e) => {
                warn!("Failed to load terrain config: {}, using defaults", e);
                Self::default()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terrain_yaml_preserves_historical_mountain_scale() {
        let loaded = TerrainConfig::load("assets/config/terrain_generation.yaml")
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
    }
}
