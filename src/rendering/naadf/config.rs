use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;

use crate::config::loader::load_config;

#[derive(Resource, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NaadfConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub build_visible_chunks_only: bool,
    #[serde(default)]
    pub chunk_cache: NaadfChunkCacheConfig,
    #[serde(default)]
    pub gpu: NaadfGpuConfig,
    #[serde(default)]
    pub debug: NaadfDebugConfig,
    #[serde(default)]
    pub use_for_sun_visibility: bool,
    #[serde(default)]
    pub use_for_terrain_ao: bool,
    #[serde(default)]
    pub use_for_contact_shadows: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NaadfChunkCacheConfig {
    #[serde(default = "default_radius_chunks")]
    pub radius_chunks: i32,
    #[serde(default = "default_hysteresis_chunks")]
    pub hysteresis_chunks: i32,
    #[serde(default = "default_max_chunks")]
    pub max_chunks: u32,
    #[serde(default = "default_max_chunk_updates_per_frame")]
    pub max_chunk_updates_per_frame: u32,
    #[serde(default = "default_max_upload_bytes_per_frame")]
    pub max_upload_bytes_per_frame: u32,
    #[serde(default = "default_max_gpu_memory_mb")]
    pub max_gpu_memory_mb: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct NaadfGpuConfig {
    #[serde(default)]
    pub allow_integrated_gpu: bool,
    #[serde(default)]
    pub prefer_gpu_builder: bool,
    #[serde(default)]
    pub debug_readback: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct NaadfDebugConfig {
    #[serde(default)]
    pub visualize_chunks: bool,
    #[serde(default)]
    pub visualize_ray_steps: bool,
    #[serde(default)]
    pub visualize_aadf_bounds: bool,
    #[serde(default)]
    pub compare_cpu_gpu: bool,
    #[serde(default)]
    pub force_cpu_builder: bool,
    #[serde(default)]
    pub force_gpu_builder: bool,
}

impl Default for NaadfConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            build_visible_chunks_only: true,
            chunk_cache: NaadfChunkCacheConfig::default(),
            gpu: NaadfGpuConfig::default(),
            debug: NaadfDebugConfig::default(),
            use_for_sun_visibility: false,
            use_for_terrain_ao: false,
            use_for_contact_shadows: false,
        }
    }
}

impl Default for NaadfChunkCacheConfig {
    fn default() -> Self {
        Self {
            radius_chunks: default_radius_chunks(),
            hysteresis_chunks: default_hysteresis_chunks(),
            max_chunks: default_max_chunks(),
            max_chunk_updates_per_frame: default_max_chunk_updates_per_frame(),
            max_upload_bytes_per_frame: default_max_upload_bytes_per_frame(),
            max_gpu_memory_mb: default_max_gpu_memory_mb(),
        }
    }
}

impl NaadfConfig {
    pub fn load_or_default(path: impl AsRef<Path>) -> Self {
        load_config(path).unwrap_or_default()
    }

    pub fn runtime_default() -> Self {
        let mut config = Self::load_or_default("assets/config/naadf.yaml");
        if env_flag_enabled("DRUSNIEL_NAADF") {
            config.enabled = true;
            config.debug.force_cpu_builder = true;
        }
        config
    }
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn default_true() -> bool {
    true
}

fn default_radius_chunks() -> i32 {
    12
}

fn default_hysteresis_chunks() -> i32 {
    2
}

fn default_max_chunks() -> u32 {
    4096
}

fn default_max_chunk_updates_per_frame() -> u32 {
    4
}

fn default_max_upload_bytes_per_frame() -> u32 {
    4 * 1024 * 1024
}

fn default_max_gpu_memory_mb() -> u32 {
    512
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_keeps_naadf_release_gate_closed() {
        let config = NaadfConfig::default();

        assert!(!config.enabled);
        assert!(!config.gpu.allow_integrated_gpu);
        assert!(!config.use_for_sun_visibility);
        assert!(!config.use_for_terrain_ao);
        assert!(!config.use_for_contact_shadows);
    }

    #[test]
    fn checked_in_config_keeps_naadf_default_off() {
        let config = NaadfConfig::load_or_default("assets/config/naadf.yaml");

        assert!(!config.enabled);
        assert!(!config.gpu.allow_integrated_gpu);
        assert_eq!(config.chunk_cache.max_gpu_memory_mb, 512);
    }
}
