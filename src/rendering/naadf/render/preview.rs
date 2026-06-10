use bevy::core_pipeline::prepass::DepthPrepass;
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponent;
use bevy::render::render_graph::RenderLabel;

use crate::camera::controller::PlayerCamera;
use crate::rendering::naadf::config::{
    NaadfConfig, NaadfDenoiseQuality, NaadfPathBCompositorModeConfig,
    NaadfPreviewCompositeModeConfig,
};
use crate::rendering::naadf::stats::{NaadfCacheState, NaadfStats};
use crate::rendering::ray_tracing::{ExperimentalRenderMode, RayTracingSettings};

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct NaadfPreviewNodeLabel;

#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct NaadfPreviewSettings {
    pub max_ray_steps: u32,
    pub bounce_count: u32,
    pub accumulation_enabled: bool,
    pub temporal_blend_factor: f32,
    pub denoise_enabled: bool,
    pub denoise_quality: NaadfDenoiseQuality,
    pub spatial_radius: u32,
    pub spatial_depth_sigma: f32,
    pub spatial_normal_sigma: f32,
    pub gi_sky_strength: f32,
    pub gi_bounce_strength: f32,
    pub local_lights_enabled: bool,
    pub local_light_limit: u32,
    pub local_light_shadows_enabled: bool,
    pub reference_path_tracing_enabled: bool,
    pub reference_sample_count: u32,
    pub reference_sky_strength: f32,
    pub reference_indirect_strength: f32,
    pub show_miss_sky: bool,
    pub composite_mode: NaadfPreviewCompositeMode,
    pub history_resolution_scale: f32,
    pub path_b_mode: NaadfPathBCompositorMode,
    pub path_b_depth_epsilon: f32,
    pub path_b_enable_temporal: bool,
    pub path_b_audit_overlay_alpha: f32,
    pub path_b_counters_enabled: bool,
    pub path_b_runtime_available: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NaadfPreviewCompositeMode {
    Fullscreen,
    #[default]
    SplitView,
    PictureInPicture,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NaadfPathBCompositorMode {
    #[default]
    Off,
    DebugPreview,
    HybridFarTerrain,
    DepthAudit,
}

impl NaadfPathBCompositorMode {
    pub fn is_path_b(self) -> bool {
        matches!(
            self,
            NaadfPathBCompositorMode::HybridFarTerrain | NaadfPathBCompositorMode::DepthAudit
        )
    }

    pub fn is_active(self) -> bool {
        !matches!(self, NaadfPathBCompositorMode::Off)
    }
}

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfPreviewPipelineState {
    pub active: bool,
    pub mode_generation: u64,
    pub history_generation: u64,
    last_backend_switch_generation: u64,
}

impl Default for NaadfPreviewSettings {
    fn default() -> Self {
        Self {
            max_ray_steps: 256,
            bounce_count: 1,
            accumulation_enabled: false,
            temporal_blend_factor: 0.85,
            denoise_enabled: false,
            denoise_quality: NaadfDenoiseQuality::default(),
            spatial_radius: 1,
            spatial_depth_sigma: 0.04,
            spatial_normal_sigma: 0.25,
            gi_sky_strength: 0.16,
            gi_bounce_strength: 0.08,
            local_lights_enabled: false,
            local_light_limit: 16,
            local_light_shadows_enabled: false,
            reference_path_tracing_enabled: false,
            reference_sample_count: 16,
            reference_sky_strength: 0.22,
            reference_indirect_strength: 0.18,
            show_miss_sky: false,
            composite_mode: NaadfPreviewCompositeMode::SplitView,
            history_resolution_scale: 1.0,
            path_b_mode: NaadfPathBCompositorMode::Off,
            path_b_depth_epsilon: 0.25,
            path_b_enable_temporal: false,
            path_b_audit_overlay_alpha: 0.75,
            path_b_counters_enabled: false,
            path_b_runtime_available: false,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfPreviewHistoryPlan {
    pub width: u32,
    pub height: u32,
    pub color_bytes: u64,
    pub moments_bytes: u64,
}

impl NaadfPreviewHistoryPlan {
    pub fn for_resolution(width: u32, height: u32) -> Self {
        let pixels = width as u64 * height as u64;
        Self {
            width,
            height,
            color_bytes: pixels * 16,
            moments_bytes: pixels * 8,
        }
    }

    pub fn total_bytes(self) -> u64 {
        self.color_bytes + self.moments_bytes
    }
}

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfPreviewHistoryState {
    pub plan: NaadfPreviewHistoryPlan,
    pub generation: u64,
}

#[derive(Component)]
pub(crate) struct NaadfManagedDepthPrepass;

#[derive(Component, Clone, Copy, Debug, Default, ExtractComponent)]
pub struct NaadfMainView;

impl NaadfPreviewHistoryState {
    pub fn ensure_plan(&mut self, plan: NaadfPreviewHistoryPlan) {
        if self.plan != plan {
            self.plan = plan;
            self.invalidate();
        }
    }

    pub fn invalidate(&mut self) {
        self.generation = self.generation.saturating_add(1);
    }
}

pub fn sync_naadf_preview_mode(
    ray_tracing: Res<RayTracingSettings>,
    config: Res<NaadfConfig>,
    cache_state: Res<NaadfCacheState>,
    stats: Res<NaadfStats>,
    mut state: ResMut<NaadfPreviewPipelineState>,
) {
    apply_preview_mode_state(
        &ray_tracing,
        &config,
        path_b_runtime_available_for_preview(&config, &cache_state, &stats),
        &mut state,
    );
}

pub fn sync_naadf_preview_settings_from_config(
    config: Res<NaadfConfig>,
    cache_state: Res<NaadfCacheState>,
    stats: Res<NaadfStats>,
    mut settings: ResMut<NaadfPreviewSettings>,
    mut pipeline_state: ResMut<NaadfPreviewPipelineState>,
) {
    let mut next = *settings;
    apply_preview_config(&config, &mut next);
    next.path_b_runtime_available =
        path_b_runtime_available_for_preview(&config, &cache_state, &stats);

    if *settings != next {
        *settings = next;
        pipeline_state.history_generation = pipeline_state.history_generation.saturating_add(1);
    }
}

fn apply_preview_config(config: &NaadfConfig, settings: &mut NaadfPreviewSettings) {
    let preview = &config.preview;
    settings.max_ray_steps = preview.max_ray_steps.max(1);
    settings.bounce_count = preview.bounce_count.min(8);
    settings.accumulation_enabled = preview.accumulation_enabled;
    settings.temporal_blend_factor = preview.temporal_blend_factor.clamp(0.0, 0.99);
    settings.denoise_enabled = preview.denoise_enabled;
    settings.denoise_quality = preview.denoise_quality;
    settings.spatial_radius = preview.spatial_radius.min(4);
    settings.spatial_depth_sigma = preview.spatial_depth_sigma.clamp(0.001, 1.0);
    settings.spatial_normal_sigma = preview.spatial_normal_sigma.clamp(0.001, 1.0);
    settings.gi_sky_strength = preview.gi_sky_strength.clamp(0.0, 2.0);
    settings.gi_bounce_strength = preview.gi_bounce_strength.clamp(0.0, 2.0);
    settings.local_lights_enabled = preview.local_lights_enabled;
    settings.local_light_limit = preview.local_light_limit.clamp(1, 64);
    settings.local_light_shadows_enabled = preview.local_light_shadows_enabled;
    settings.reference_path_tracing_enabled = preview.reference_path_tracing_enabled;
    settings.reference_sample_count = preview.reference_sample_count.clamp(1, 32);
    settings.reference_sky_strength = preview.reference_sky_strength.clamp(0.0, 2.0);
    settings.reference_indirect_strength = preview.reference_indirect_strength.clamp(0.0, 2.0);
    settings.show_miss_sky = preview.show_miss_sky;
    settings.composite_mode = match preview.composite_mode {
        NaadfPreviewCompositeModeConfig::Fullscreen => NaadfPreviewCompositeMode::Fullscreen,
        NaadfPreviewCompositeModeConfig::SplitView => NaadfPreviewCompositeMode::SplitView,
        NaadfPreviewCompositeModeConfig::PictureInPicture => {
            NaadfPreviewCompositeMode::PictureInPicture
        }
    };
    settings.history_resolution_scale = preview.history_resolution_scale.clamp(0.125, 1.0);
    settings.path_b_mode = match config.path_b.compositor_mode {
        NaadfPathBCompositorModeConfig::Off => NaadfPathBCompositorMode::Off,
        NaadfPathBCompositorModeConfig::DebugPreview => NaadfPathBCompositorMode::DebugPreview,
        NaadfPathBCompositorModeConfig::HybridFarTerrain => {
            NaadfPathBCompositorMode::HybridFarTerrain
        }
        NaadfPathBCompositorModeConfig::DepthAudit => NaadfPathBCompositorMode::DepthAudit,
    };
    settings.path_b_depth_epsilon = config.path_b.depth_epsilon.max(0.0);
    settings.path_b_enable_temporal = config.path_b.enable_temporal;
    settings.path_b_audit_overlay_alpha = config.path_b.audit_overlay_alpha.clamp(0.0, 1.0);
    settings.path_b_counters_enabled = config.path_b.counters_enabled;
    settings.path_b_runtime_available = config.path_b_runtime_available();
}

fn path_b_runtime_available_for_preview(
    config: &NaadfConfig,
    cache_state: &NaadfCacheState,
    stats: &NaadfStats,
) -> bool {
    config.path_b_runtime_available()
        && cache_state.ready
        && stats.gpu_slots_used > 0
        && stats.gpu_uploads_pending == 0
}

pub(crate) fn configure_path_b_camera_prepass(
    mut commands: Commands,
    config: Res<NaadfConfig>,
    ray_tracing: Res<RayTracingSettings>,
    player_cameras: Query<
        (Entity, Option<&DepthPrepass>, Option<&NaadfMainView>),
        (With<Camera3d>, With<PlayerCamera>),
    >,
    managed_prepass_cameras: Query<Entity, With<NaadfManagedDepthPrepass>>,
    naadf_main_views: Query<Entity, With<NaadfMainView>>,
) {
    let needs_path_b_prepass = config.path_b_runtime_available()
        && matches!(
            config.path_b.compositor_mode,
            NaadfPathBCompositorModeConfig::HybridFarTerrain
                | NaadfPathBCompositorModeConfig::DepthAudit
        );
    let needs_prepass = ray_tracing.experimental_mode == ExperimentalRenderMode::NaadfPreview
        || needs_path_b_prepass;

    if needs_prepass {
        for (entity, depth_prepass, main_view) in player_cameras.iter() {
            let mut entity_commands = commands.entity(entity);
            if depth_prepass.is_none() {
                entity_commands.insert((DepthPrepass, NaadfManagedDepthPrepass));
            }
            if main_view.is_none() {
                entity_commands.insert(NaadfMainView);
            }
        }
    } else {
        for entity in managed_prepass_cameras.iter() {
            commands
                .entity(entity)
                .remove::<(DepthPrepass, NaadfManagedDepthPrepass)>();
        }
        for entity in naadf_main_views.iter() {
            commands.entity(entity).remove::<NaadfMainView>();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::ray_tracing::VoxelRayBackendMode;

    #[test]
    fn preview_state_activates_from_experimental_mode() {
        let settings = RayTracingSettings {
            experimental_mode: ExperimentalRenderMode::NaadfPreview,
            ..default()
        };
        let mut state = NaadfPreviewPipelineState::default();

        apply_preview_mode_state(&settings, &NaadfConfig::default(), false, &mut state);

        assert!(state.active);
        assert_eq!(state.mode_generation, 1);
        assert_eq!(state.history_generation, 1);
    }

    #[test]
    fn preview_state_resets_history_on_backend_switch() {
        let settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Naadf,
            backend_switch_generation: 2,
            ..default()
        };
        let mut state = NaadfPreviewPipelineState::default();

        apply_preview_mode_state(&settings, &NaadfConfig::default(), false, &mut state);

        assert_eq!(state.history_generation, 1);
        assert_eq!(state.last_backend_switch_generation, 2);
    }

    #[test]
    fn path_b_state_requires_foundation_gate() {
        let ray_tracing = RayTracingSettings::default();
        let mut state = NaadfPreviewPipelineState::default();
        let config = NaadfConfig {
            enabled: true,
            path_b: crate::rendering::naadf::config::NaadfPathBConfig {
                compositor_mode: NaadfPathBCompositorModeConfig::HybridFarTerrain,
                foundation_200_210_verified: false,
                ..default()
            },
            ..default()
        };

        apply_preview_mode_state(&ray_tracing, &config, false, &mut state);

        assert!(!state.active);

        let mut verified_config = config;
        verified_config.path_b.foundation_200_210_verified = true;
        apply_preview_mode_state(&ray_tracing, &verified_config, true, &mut state);

        assert!(state.active);
    }

    #[test]
    fn path_b_runtime_gate_requires_cache_and_gpu_upload_quiescence() {
        let config = NaadfConfig {
            enabled: true,
            path_b: crate::rendering::naadf::config::NaadfPathBConfig {
                compositor_mode: NaadfPathBCompositorModeConfig::HybridFarTerrain,
                foundation_200_210_verified: true,
                ..default()
            },
            ..default()
        };
        let mut cache_state = NaadfCacheState {
            ready: true,
            warming: false,
            fallback_reason: None,
        };
        let mut stats = NaadfStats {
            gpu_slots_used: 1,
            gpu_uploads_pending: 0,
            ..default()
        };

        assert!(path_b_runtime_available_for_preview(
            &config,
            &cache_state,
            &stats
        ));

        cache_state.ready = false;
        assert!(!path_b_runtime_available_for_preview(
            &config,
            &cache_state,
            &stats
        ));

        cache_state.ready = true;
        stats.gpu_uploads_pending = 1;
        assert!(!path_b_runtime_available_for_preview(
            &config,
            &cache_state,
            &stats
        ));
    }

    #[test]
    fn preview_settings_default_to_split_view_composite() {
        assert_eq!(
            NaadfPreviewSettings::default().composite_mode,
            NaadfPreviewCompositeMode::SplitView
        );
        assert!(!NaadfPreviewSettings::default().denoise_enabled);
        assert!(!NaadfPreviewSettings::default().reference_path_tracing_enabled);
        assert!(!NaadfPreviewSettings::default().local_lights_enabled);
        assert_eq!(NaadfPreviewSettings::default().local_light_limit, 16);
        assert!(!NaadfPreviewSettings::default().local_light_shadows_enabled);
        assert_eq!(
            NaadfPreviewSettings::default().path_b_mode,
            NaadfPathBCompositorMode::Off
        );
        assert!(!NaadfPreviewSettings::default().path_b_counters_enabled);
        assert!(!NaadfPreviewSettings::default().path_b_runtime_available);
    }

    #[test]
    fn preview_history_plan_tracks_expected_bytes() {
        let plan = NaadfPreviewHistoryPlan::for_resolution(1920, 1080);

        assert_eq!(plan.color_bytes, 1920 * 1080 * 16);
        assert_eq!(plan.moments_bytes, 1920 * 1080 * 8);
        assert_eq!(plan.total_bytes(), 1920 * 1080 * 24);
    }

    #[test]
    fn preview_history_state_invalidates_on_resize() {
        let mut state = NaadfPreviewHistoryState::default();

        state.ensure_plan(NaadfPreviewHistoryPlan::for_resolution(1280, 720));

        assert_eq!(state.generation, 1);
        state.ensure_plan(NaadfPreviewHistoryPlan::for_resolution(1280, 720));
        assert_eq!(state.generation, 1);
        state.ensure_plan(NaadfPreviewHistoryPlan::for_resolution(640, 360));
        assert_eq!(state.generation, 2);
    }

    #[test]
    fn preview_settings_apply_config_with_clamps() {
        let mut settings = NaadfPreviewSettings::default();
        let config = NaadfConfig {
            preview: crate::rendering::naadf::config::NaadfPreviewConfig {
                max_ray_steps: 0,
                bounce_count: 12,
                accumulation_enabled: true,
                temporal_blend_factor: 2.0,
                denoise_enabled: false,
                denoise_quality: NaadfDenoiseQuality::High,
                spatial_radius: 9,
                spatial_depth_sigma: 0.0,
                spatial_normal_sigma: 2.0,
                gi_sky_strength: 3.0,
                gi_bounce_strength: -1.0,
                local_lights_enabled: true,
                local_light_limit: 999,
                local_light_shadows_enabled: true,
                reference_path_tracing_enabled: true,
                reference_sample_count: 64,
                reference_sky_strength: -1.0,
                reference_indirect_strength: 3.0,
                show_miss_sky: true,
                composite_mode: NaadfPreviewCompositeModeConfig::PictureInPicture,
                history_resolution_scale: 2.0,
            },
            path_b: crate::rendering::naadf::config::NaadfPathBConfig {
                compositor_mode: NaadfPathBCompositorModeConfig::DepthAudit,
                depth_epsilon: -1.0,
                enable_temporal: true,
                audit_overlay_alpha: 2.0,
                counters_enabled: true,
                foundation_200_210_verified: true,
            },
            enabled: true,
            ..default()
        };

        apply_preview_config(&config, &mut settings);

        assert_eq!(settings.max_ray_steps, 1);
        assert_eq!(settings.bounce_count, 8);
        assert!(settings.accumulation_enabled);
        assert_eq!(settings.temporal_blend_factor, 0.99);
        assert!(!settings.denoise_enabled);
        assert_eq!(settings.denoise_quality, NaadfDenoiseQuality::High);
        assert_eq!(settings.spatial_radius, 4);
        assert_eq!(settings.spatial_depth_sigma, 0.001);
        assert_eq!(settings.spatial_normal_sigma, 1.0);
        assert_eq!(settings.gi_sky_strength, 2.0);
        assert_eq!(settings.gi_bounce_strength, 0.0);
        assert!(settings.local_lights_enabled);
        assert_eq!(settings.local_light_limit, 64);
        assert!(settings.local_light_shadows_enabled);
        assert!(settings.reference_path_tracing_enabled);
        assert_eq!(settings.reference_sample_count, 32);
        assert_eq!(settings.reference_sky_strength, 0.0);
        assert_eq!(settings.reference_indirect_strength, 2.0);
        assert!(settings.show_miss_sky);
        assert_eq!(
            settings.composite_mode,
            NaadfPreviewCompositeMode::PictureInPicture
        );
        assert_eq!(settings.history_resolution_scale, 1.0);
        assert_eq!(settings.path_b_mode, NaadfPathBCompositorMode::DepthAudit);
        assert_eq!(settings.path_b_depth_epsilon, 0.0);
        assert!(settings.path_b_enable_temporal);
        assert_eq!(settings.path_b_audit_overlay_alpha, 1.0);
        assert!(settings.path_b_counters_enabled);
        assert!(settings.path_b_runtime_available);
    }
}

pub fn apply_preview_mode_state(
    ray_tracing: &RayTracingSettings,
    config: &NaadfConfig,
    path_b_runtime_available: bool,
    state: &mut NaadfPreviewPipelineState,
) {
    let path_b_mode_active = path_b_runtime_available
        && config.path_b.compositor_mode != NaadfPathBCompositorModeConfig::Off;
    let active =
        ray_tracing.experimental_mode == ExperimentalRenderMode::NaadfPreview || path_b_mode_active;
    if state.active != active {
        state.active = active;
        state.mode_generation = state.mode_generation.saturating_add(1);
        state.history_generation = state.history_generation.saturating_add(1);
    }
    if state.last_backend_switch_generation != ray_tracing.backend_switch_generation {
        state.last_backend_switch_generation = ray_tracing.backend_switch_generation;
        state.history_generation = state.history_generation.saturating_add(1);
    }
}
