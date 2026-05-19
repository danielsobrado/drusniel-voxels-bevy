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
    pub path_b: NaadfPathBConfig,
    #[serde(default)]
    pub debug: NaadfDebugConfig,
    #[serde(default)]
    pub froxel_sun_mask: NaadfFroxelSunMaskConfig,
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
    pub local_lights_enabled: bool,
    #[serde(default = "default_preview_local_light_limit")]
    pub local_light_limit: u32,
    #[serde(default)]
    pub local_light_shadows_enabled: bool,
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NaadfPathBConfig {
    #[serde(default)]
    pub compositor_mode: NaadfPathBCompositorModeConfig,
    #[serde(default = "default_path_b_depth_epsilon")]
    pub depth_epsilon: f32,
    #[serde(default = "default_true")]
    pub enable_temporal: bool,
    #[serde(default = "default_path_b_audit_overlay_alpha")]
    pub audit_overlay_alpha: f32,
    #[serde(default)]
    pub counters_enabled: bool,
    #[serde(default)]
    pub foundation_200_210_verified: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NaadfPathBCompositorModeConfig {
    #[default]
    Off,
    DebugPreview,
    HybridFarTerrain,
    DepthAudit,
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
    #[serde(default)]
    pub allow_unverified_post_205: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NaadfFroxelSunMaskConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_froxel_sun_mask_resolution")]
    pub resolution: [u32; 3],
    #[serde(default = "default_froxel_sun_mask_max_rays_per_frame")]
    pub max_rays_per_frame: u32,
    #[serde(default = "default_froxel_sun_mask_max_distance")]
    pub max_distance: f32,
}

impl NaadfFroxelSunMaskConfig {
    pub fn resolution_uvec3(&self) -> UVec3 {
        UVec3::new(
            self.resolution[0].max(1),
            self.resolution[1].max(1),
            self.resolution[2].max(1),
        )
    }
}

impl Default for NaadfFroxelSunMaskConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            resolution: default_froxel_sun_mask_resolution(),
            max_rays_per_frame: default_froxel_sun_mask_max_rays_per_frame(),
            max_distance: default_froxel_sun_mask_max_distance(),
        }
    }
}

impl Default for NaadfConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            build_visible_chunks_only: true,
            chunk_cache: NaadfChunkCacheConfig::default(),
            gpu: NaadfGpuConfig::default(),
            preview: NaadfPreviewConfig::default(),
            path_b: NaadfPathBConfig::default(),
            debug: NaadfDebugConfig::default(),
            froxel_sun_mask: NaadfFroxelSunMaskConfig::default(),
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

impl Default for NaadfPathBConfig {
    fn default() -> Self {
        Self {
            compositor_mode: NaadfPathBCompositorModeConfig::Off,
            depth_epsilon: default_path_b_depth_epsilon(),
            enable_temporal: false,
            audit_overlay_alpha: default_path_b_audit_overlay_alpha(),
            counters_enabled: false,
            foundation_200_210_verified: false,
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
        if env_flag_enabled("DRUSNIEL_NAADF_GPU_BUILDER") {
            config.enabled = true;
            config.debug.force_cpu_builder = false;
            config.debug.force_gpu_builder = true;
        }
        if env_flag_enabled("DRUSNIEL_NAADF_DEBUG_READBACK") {
            config.enabled = true;
            config.gpu.debug_readback = true;
        }
        if env_flag_enabled("DRUSNIEL_NAADF_ALLOW_UNVERIFIED_POST_205") {
            config.enabled = true;
            config.debug.allow_unverified_post_205 = true;
        }
        config
    }

    pub fn path_b_runtime_available(&self) -> bool {
        self.enabled && self.path_b.foundation_200_210_verified
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
            local_lights_enabled: false,
            local_light_limit: default_preview_local_light_limit(),
            local_light_shadows_enabled: false,
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

fn default_preview_local_light_limit() -> u32 {
    16
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

fn default_path_b_depth_epsilon() -> f32 {
    0.25
}

fn default_path_b_audit_overlay_alpha() -> f32 {
    0.75
}

fn default_froxel_sun_mask_resolution() -> [u32; 3] {
    [160, 90, 64]
}

fn default_froxel_sun_mask_max_rays_per_frame() -> u32 {
    65_536
}

fn default_froxel_sun_mask_max_distance() -> f32 {
    512.0
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
        assert!(!config.preview.local_lights_enabled);
        assert_eq!(config.preview.local_light_limit, 16);
        assert!(!config.preview.local_light_shadows_enabled);
        assert!(!config.preview.reference_path_tracing_enabled);
        assert_eq!(config.preview.reference_sky_strength, 0.22);
        assert_eq!(config.preview.reference_indirect_strength, 0.18);
        assert_eq!(
            config.path_b.compositor_mode,
            NaadfPathBCompositorModeConfig::Off
        );
        assert!(!config.path_b.counters_enabled);
        assert!(!config.path_b.foundation_200_210_verified);
        assert!(!config.path_b_runtime_available());
        assert!(!config.froxel_sun_mask.enabled);
        assert_eq!(config.froxel_sun_mask.resolution, [160, 90, 64]);
        assert_eq!(config.froxel_sun_mask.max_rays_per_frame, 65_536);
        assert!(!config.debug.allow_unverified_post_205);
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
        assert!(!config.preview.local_lights_enabled);
        assert_eq!(config.preview.local_light_limit, 16);
        assert!(!config.preview.local_light_shadows_enabled);
        assert!(!config.preview.reference_path_tracing_enabled);
        assert_eq!(config.preview.reference_sample_count, 16);
        assert!(!config.preview.show_miss_sky);
        assert_eq!(
            config.path_b.compositor_mode,
            NaadfPathBCompositorModeConfig::Off
        );
        assert!(!config.path_b.counters_enabled);
        assert!(!config.path_b.foundation_200_210_verified);
        assert_eq!(
            config.preview.composite_mode,
            NaadfPreviewCompositeModeConfig::SplitView
        );
        assert_eq!(config.chunk_cache.max_gpu_memory_mb, 512);
        assert!(!config.froxel_sun_mask.enabled);
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
