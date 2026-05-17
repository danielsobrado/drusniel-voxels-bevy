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
    pub preview: NaadfPreviewConfig,
    #[serde(default)]
    pub debug: NaadfDebugConfig,
    #[serde(default)]
    pub use_for_gi_secondary: bool,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NaadfPreviewConfig {
    #[serde(default = "default_preview_max_ray_steps")]
    pub max_ray_steps: u32,
    #[serde(default = "default_preview_bounce_count")]
    pub bounce_count: u32,
    #[serde(default)]
    pub accumulation_enabled: bool,
    #[serde(default = "default_preview_temporal_blend_factor")]
    pub temporal_blend_factor: f32,
    #[serde(default = "default_true")]
    pub denoise_enabled: bool,
    #[serde(default)]
    pub denoise_quality: NaadfDenoiseQuality,
    #[serde(default = "default_preview_spatial_radius")]
    pub spatial_radius: u32,
    #[serde(default = "default_preview_spatial_depth_sigma")]
    pub spatial_depth_sigma: f32,
    #[serde(default = "default_preview_spatial_normal_sigma")]
    pub spatial_normal_sigma: f32,
    #[serde(default = "default_preview_gi_sky_strength")]
    pub gi_sky_strength: f32,
    #[serde(default = "default_preview_gi_bounce_strength")]
    pub gi_bounce_strength: f32,
    #[serde(default)]
    pub reference_path_tracing_enabled: bool,
    #[serde(default = "default_preview_reference_sample_count")]
    pub reference_sample_count: u32,
    #[serde(default = "default_preview_reference_sky_strength")]
    pub reference_sky_strength: f32,
    #[serde(default = "default_preview_reference_indirect_strength")]
    pub reference_indirect_strength: f32,
    #[serde(default)]
    pub show_miss_sky: bool,
    #[serde(default)]
    pub composite_mode: NaadfPreviewCompositeModeConfig,
    #[serde(default = "default_preview_history_resolution_scale")]
    pub history_resolution_scale: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NaadfDenoiseQuality {
    Low,
    #[default]
    Medium,
    High,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NaadfPreviewCompositeModeConfig {
    Fullscreen,
    #[default]
    SplitView,
    PictureInPicture,
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
            preview: NaadfPreviewConfig::default(),
            debug: NaadfDebugConfig::default(),
            use_for_gi_secondary: false,
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
    pub fn gpu_builder_enabled(&self) -> bool {
        self.enabled
            && !self.debug.force_cpu_builder
            && (self.gpu.prefer_gpu_builder || self.debug.force_gpu_builder)
    }

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

impl Default for NaadfPreviewConfig {
    fn default() -> Self {
        Self {
            max_ray_steps: default_preview_max_ray_steps(),
            bounce_count: default_preview_bounce_count(),
            accumulation_enabled: false,
            temporal_blend_factor: default_preview_temporal_blend_factor(),
            denoise_enabled: false,
            denoise_quality: NaadfDenoiseQuality::default(),
            spatial_radius: default_preview_spatial_radius(),
            spatial_depth_sigma: default_preview_spatial_depth_sigma(),
            spatial_normal_sigma: default_preview_spatial_normal_sigma(),
            gi_sky_strength: default_preview_gi_sky_strength(),
            gi_bounce_strength: default_preview_gi_bounce_strength(),
            reference_path_tracing_enabled: false,
            reference_sample_count: default_preview_reference_sample_count(),
            reference_sky_strength: default_preview_reference_sky_strength(),
            reference_indirect_strength: default_preview_reference_indirect_strength(),
            show_miss_sky: false,
            composite_mode: NaadfPreviewCompositeModeConfig::default(),
            history_resolution_scale: default_preview_history_resolution_scale(),
        }
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
    20
}

fn default_hysteresis_chunks() -> i32 {
    2
}

fn default_max_chunks() -> u32 {
    8192
}

fn default_max_chunk_updates_per_frame() -> u32 {
    16
}

fn default_max_upload_bytes_per_frame() -> u32 {
    16 * 1024 * 1024
}

fn default_max_gpu_memory_mb() -> u32 {
    512
}

fn default_preview_max_ray_steps() -> u32 {
    256
}

fn default_preview_bounce_count() -> u32 {
    1
}

fn default_preview_temporal_blend_factor() -> f32 {
    0.85
}

fn default_preview_spatial_radius() -> u32 {
    1
}

fn default_preview_spatial_depth_sigma() -> f32 {
    0.04
}

fn default_preview_spatial_normal_sigma() -> f32 {
    0.25
}

fn default_preview_gi_sky_strength() -> f32 {
    0.16
}

fn default_preview_gi_bounce_strength() -> f32 {
    0.08
}

fn default_preview_reference_sample_count() -> u32 {
    16
}

fn default_preview_reference_sky_strength() -> f32 {
    0.22
}

fn default_preview_reference_indirect_strength() -> f32 {
    0.18
}

fn default_preview_history_resolution_scale() -> f32 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_keeps_naadf_release_gate_closed() {
        let config = NaadfConfig::default();

        assert!(!config.enabled);
        assert!(!config.gpu.allow_integrated_gpu);
        assert!(!config.preview.denoise_enabled);
        assert_eq!(config.preview.temporal_blend_factor, 0.85);
        assert_eq!(config.preview.spatial_radius, 1);
        assert_eq!(config.preview.spatial_depth_sigma, 0.04);
        assert_eq!(config.preview.spatial_normal_sigma, 0.25);
        assert_eq!(config.preview.gi_sky_strength, 0.16);
        assert_eq!(config.preview.gi_bounce_strength, 0.08);
        assert!(!config.preview.reference_path_tracing_enabled);
        assert_eq!(config.preview.reference_sky_strength, 0.22);
        assert_eq!(config.preview.reference_indirect_strength, 0.18);
        assert!(!config.use_for_gi_secondary);
        assert!(!config.use_for_sun_visibility);
        assert!(!config.use_for_terrain_ao);
        assert!(!config.use_for_contact_shadows);
    }

    #[test]
    fn checked_in_config_keeps_naadf_default_off() {
        let config = NaadfConfig::load_or_default("assets/config/naadf.yaml");

        assert!(!config.enabled);
        assert!(!config.gpu.allow_integrated_gpu);
        assert_eq!(config.preview.max_ray_steps, 256);
        assert!(!config.preview.denoise_enabled);
        assert_eq!(config.preview.denoise_quality, NaadfDenoiseQuality::Medium);
        assert!(!config.preview.reference_path_tracing_enabled);
        assert_eq!(config.preview.reference_sample_count, 16);
        assert!(!config.preview.show_miss_sky);
        assert_eq!(
            config.preview.composite_mode,
            NaadfPreviewCompositeModeConfig::SplitView
        );
        assert_eq!(config.chunk_cache.max_gpu_memory_mb, 512);
        assert!(!config.use_for_gi_secondary);
        assert!(!config.use_for_sun_visibility);
        assert!(!config.use_for_terrain_ao);
        assert!(!config.use_for_contact_shadows);
    }

    #[test]
    fn gpu_builder_enabled_honors_debug_overrides() {
        let mut config = NaadfConfig {
            enabled: true,
            ..default()
        };

        assert!(!config.gpu_builder_enabled());
        config.gpu.prefer_gpu_builder = true;
        assert!(config.gpu_builder_enabled());
        config.debug.force_cpu_builder = true;
        assert!(!config.gpu_builder_enabled());
        config.gpu.prefer_gpu_builder = false;
        config.debug.force_gpu_builder = true;
        assert!(!config.gpu_builder_enabled());
        config.debug.force_cpu_builder = false;
        assert!(config.gpu_builder_enabled());
    }
}
