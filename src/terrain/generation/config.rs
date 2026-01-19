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
