use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use crate::rendering::capabilities::GraphicsCapabilities;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Reflect, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoxelRayBackendMode {
    #[default]
    CurrentSdf,
    Naadf,
    Auto,
}

impl VoxelRayBackendMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CurrentSdf => "current_sdf",
            Self::Naadf => "naadf",
            Self::Auto => "auto",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "current_sdf" | "current-sdf" | "current" | "sdf" => Some(Self::CurrentSdf),
            "naadf" => Some(Self::Naadf),
            "auto" => Some(Self::Auto),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Reflect, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExperimentalRenderMode {
    #[default]
    Current,
    CurrentWithNaadfGi,
    NaadfPreview,
}

impl ExperimentalRenderMode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::CurrentWithNaadfGi => "current_with_naadf_gi",
            Self::NaadfPreview => "naadf_preview",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "current" => Some(Self::Current),
            "current_with_naadf_gi" | "current-with-naadf-gi" | "naadf_gi" | "naadf-gi" => {
                Some(Self::CurrentWithNaadfGi)
            }
            "naadf_preview" | "naadf-preview" | "preview" => Some(Self::NaadfPreview),
            _ => None,
        }
    }
}

/// Runtime switches for voxel ray backends. Defaults preserve the current renderer.
#[derive(Resource, Clone, Debug, Reflect, Serialize, Deserialize)]
#[reflect(Resource)]
pub struct RayTracingSettings {
    pub enabled: bool,
    pub voxel_backend: VoxelRayBackendMode,
    pub experimental_mode: ExperimentalRenderMode,
    pub allow_naadf_on_integrated_gpu: bool,
    pub reset_history_on_backend_switch: bool,
    pub backend_switch_generation: u64,
    pub fallback_reason: Option<String>,
}

impl Default for RayTracingSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            experimental_mode: ExperimentalRenderMode::Current,
            allow_naadf_on_integrated_gpu: false,
            reset_history_on_backend_switch: true,
            backend_switch_generation: 0,
            fallback_reason: None,
        }
    }
}

impl RayTracingSettings {
    pub fn set_voxel_backend(
        &mut self,
        next: VoxelRayBackendMode,
        capabilities: Option<&GraphicsCapabilities>,
    ) -> bool {
        if next == VoxelRayBackendMode::Naadf
            && !self.allow_naadf_on_integrated_gpu
            && capabilities.is_some_and(|capabilities| capabilities.integrated_gpu)
        {
            self.fallback_reason =
                Some("NAADF blocked on integrated GPU; enable explicit override to use it".into());
            return false;
        }

        self.fallback_reason = None;
        if self.voxel_backend == next {
            return false;
        }
        self.voxel_backend = next;
        if self.reset_history_on_backend_switch {
            self.backend_switch_generation = self.backend_switch_generation.saturating_add(1);
        }
        true
    }

    pub fn effective_backend(&self) -> VoxelRayBackendMode {
        match self.voxel_backend {
            VoxelRayBackendMode::Auto => VoxelRayBackendMode::CurrentSdf,
            mode => mode,
        }
    }
}

pub fn toggle_voxel_ray_backend_key(
    keys: Res<ButtonInput<KeyCode>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut settings: ResMut<RayTracingSettings>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if shift_held || !keys.just_pressed(KeyCode::F11) {
        return;
    }

    let next = match settings.voxel_backend {
        VoxelRayBackendMode::CurrentSdf => VoxelRayBackendMode::Naadf,
        VoxelRayBackendMode::Naadf => VoxelRayBackendMode::Auto,
        VoxelRayBackendMode::Auto => VoxelRayBackendMode::CurrentSdf,
    };
    if settings.set_voxel_backend(next, capabilities.as_deref()) {
        info!(
            "Voxel ray backend: {} (F11 to cycle)",
            settings.voxel_backend.as_str()
        );
    } else if let Some(reason) = settings.fallback_reason.as_deref() {
        warn!("Voxel ray backend unchanged: {}", reason);
    }
}
