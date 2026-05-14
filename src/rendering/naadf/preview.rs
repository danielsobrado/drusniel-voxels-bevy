use bevy::prelude::*;
use bevy::render::render_graph::RenderLabel;

use crate::rendering::ray_tracing::{ExperimentalRenderMode, RayTracingSettings};

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct NaadfPreviewNodeLabel;

#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct NaadfPreviewSettings {
    pub max_ray_steps: u32,
    pub bounce_count: u32,
    pub accumulation_enabled: bool,
    pub composite_mode: NaadfPreviewCompositeMode,
    pub history_resolution_scale: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NaadfPreviewCompositeMode {
    Fullscreen,
    #[default]
    SplitView,
    PictureInPicture,
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
            composite_mode: NaadfPreviewCompositeMode::SplitView,
            history_resolution_scale: 1.0,
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
    mut state: ResMut<NaadfPreviewPipelineState>,
) {
    apply_preview_mode_state(&ray_tracing, &mut state);
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

        apply_preview_mode_state(&settings, &mut state);

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

        apply_preview_mode_state(&settings, &mut state);

        assert_eq!(state.history_generation, 1);
        assert_eq!(state.last_backend_switch_generation, 2);
    }

    #[test]
    fn preview_settings_default_to_split_view_composite() {
        assert_eq!(
            NaadfPreviewSettings::default().composite_mode,
            NaadfPreviewCompositeMode::SplitView
        );
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
}

pub fn apply_preview_mode_state(
    ray_tracing: &RayTracingSettings,
    state: &mut NaadfPreviewPipelineState,
) {
    let active = ray_tracing.experimental_mode == ExperimentalRenderMode::NaadfPreview;
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
