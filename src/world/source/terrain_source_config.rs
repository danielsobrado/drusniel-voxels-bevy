use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const TERRAIN_SOURCE_CONFIG_PATH: &str = "assets/config/terrain_source.yaml";

#[derive(Resource, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerrainSourceMode {
    GpuWorldSource,
    Legacy,
    CpuWorldSourceReference,
}

#[derive(Resource, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TerrainSourceConfig {
    pub mode: TerrainSourceMode,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct TerrainSourceConfigFile {
    terrain_source: TerrainSourceConfig,
}

impl Default for TerrainSourceMode {
    fn default() -> Self {
        Self::GpuWorldSource
    }
}

impl Default for TerrainSourceConfig {
    fn default() -> Self {
        Self {
            mode: TerrainSourceMode::default(),
        }
    }
}

impl TerrainSourceConfig {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, Box<dyn std::error::Error>> {
        let file = std::fs::File::open(path)?;
        let reader = std::io::BufReader::new(file);
        let parsed: TerrainSourceConfigFile = serde_yaml::from_reader(reader)?;
        Ok(parsed.terrain_source)
    }

    pub fn load_or_default() -> Self {
        match Self::load(TERRAIN_SOURCE_CONFIG_PATH) {
            Ok(config) => config,
            Err(error) => {
                bevy::log::warn!(
                    "Failed to load terrain source config from {}: {}; using defaults",
                    TERRAIN_SOURCE_CONFIG_PATH,
                    error
                );
                Self::default()
            }
        }
    }

    pub fn is_gpu_default_path(&self) -> bool {
        self.mode == TerrainSourceMode::GpuWorldSource
    }

    pub fn is_explicit_cpu_reference(&self) -> bool {
        self.mode == TerrainSourceMode::CpuWorldSourceReference
    }

    pub fn is_legacy(&self) -> bool {
        self.mode == TerrainSourceMode::Legacy
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_temp_yaml(contents: &str) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(contents.as_bytes()).expect("write temp yaml");
        file
    }

    #[test]
    fn default_mode_is_gpu_world_source() {
        let config = TerrainSourceConfig::default();

        assert_eq!(config.mode, TerrainSourceMode::GpuWorldSource);
        assert!(config.is_gpu_default_path());
    }

    #[test]
    fn loads_default_config_file() {
        let config = TerrainSourceConfig::load(TERRAIN_SOURCE_CONFIG_PATH)
            .expect("terrain_source.yaml should deserialize");

        assert_eq!(config.mode, TerrainSourceMode::GpuWorldSource);
    }

    #[test]
    fn loads_legacy_mode() {
        let file = write_temp_yaml("terrain_source:\n  mode: legacy\n");
        let config = TerrainSourceConfig::load(file.path()).expect("legacy config");

        assert_eq!(config.mode, TerrainSourceMode::Legacy);
        assert!(config.is_legacy());
    }

    #[test]
    fn loads_explicit_cpu_reference_mode() {
        let file = write_temp_yaml("terrain_source:\n  mode: cpu_world_source_reference\n");
        let config = TerrainSourceConfig::load(file.path()).expect("cpu reference config");

        assert_eq!(config.mode, TerrainSourceMode::CpuWorldSourceReference);
        assert!(config.is_explicit_cpu_reference());
    }

    #[test]
    fn rejects_invalid_modes() {
        let file = write_temp_yaml("terrain_source:\n  mode: cpu\n");

        assert!(TerrainSourceConfig::load(file.path()).is_err());
    }
}
