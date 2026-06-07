use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use crate::bench::BenchRenderToggles;
use crate::menu::{GraphicsQuality, SettingsState};
use crate::performance::AreaTimingRecorder;
use crate::rendering::water_reflection::WaterReflectionConfig;
use crate::weather::WeatherQuality;

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RenderQualityPreset {
    Low,
    Medium,
    #[default]
    High,
    #[serde(alias = "performance_100", alias = "Performance100")]
    Performance100,
}

impl From<GraphicsQuality> for RenderQualityPreset {
    fn from(value: GraphicsQuality) -> Self {
        match value {
            GraphicsQuality::Low => Self::Low,
            GraphicsQuality::Medium => Self::Medium,
            GraphicsQuality::High => Self::High,
            GraphicsQuality::Performance100 => Self::Performance100,
        }
    }
}

impl RenderQualityPreset {
    pub fn code(self) -> f64 {
        match self {
            Self::Low => 0.0,
            Self::Medium => 1.0,
            Self::High => 2.0,
            Self::Performance100 => 3.0,
        }
    }

    pub fn prop_lod_distance_scale(self) -> f32 {
        match self {
            Self::Low => 0.72,
            Self::Medium => 0.86,
            Self::High => 1.0,
            Self::Performance100 => 0.62,
        }
    }

    pub fn prop_shadow_distance_scale(self) -> f32 {
        match self {
            Self::Low => 0.7,
            Self::Medium => 0.85,
            Self::High => 1.0,
            Self::Performance100 => 0.55,
        }
    }

    pub fn terrain_material_lod_distance(self, high_distance: f32) -> f32 {
        match self {
            Self::Low => high_distance * 0.65,
            Self::Medium => high_distance * 0.82,
            Self::High => high_distance,
            Self::Performance100 => high_distance,
        }
    }

    pub fn water_reflection_resolution_scale(self) -> f32 {
        match self {
            Self::Low => 0.25,
            Self::Medium => 0.5,
            Self::High => 0.5,
            Self::Performance100 => 0.25,
        }
    }

    pub fn water_reflection_update_interval(self) -> f32 {
        match self {
            Self::Low => 1.0 / 30.0,
            Self::Medium => 1.0 / 45.0,
            Self::High => 0.0,
            Self::Performance100 => 1.0 / 30.0,
        }
    }

    pub fn water_reflection_distance(self) -> f32 {
        match self {
            Self::Low => 80.0,
            Self::Medium => 120.0,
            Self::High => 120.0,
            Self::Performance100 => 72.0,
        }
    }

    pub fn water_reflection_quality_code(self) -> f64 {
        match self {
            Self::Low => 0.0,
            Self::Medium => 1.0,
            Self::High => 2.0,
            Self::Performance100 => 0.0,
        }
    }

    pub fn shadow_quality_code(self) -> f64 {
        match self {
            Self::Low => 0.0,
            Self::Medium => 1.0,
            Self::High => 2.0,
            Self::Performance100 => 0.0,
        }
    }

    pub fn terrain_material_quality_code(self) -> f64 {
        match self {
            Self::Low => 0.0,
            Self::Medium => 1.0,
            Self::High => 2.0,
            Self::Performance100 => 2.0,
        }
    }

    pub fn weather_quality_cap(self) -> WeatherQuality {
        match self {
            Self::Low | Self::Performance100 => WeatherQuality::Low,
            Self::Medium => WeatherQuality::Medium,
            Self::High => WeatherQuality::Ultra,
        }
    }

    pub fn naadf_max_chunk_updates_per_frame(self) -> u32 {
        match self {
            Self::Low => 1,
            Self::Medium => 4,
            Self::High => 16,
            Self::Performance100 => 1,
        }
    }

    pub fn naadf_max_upload_bytes_per_frame(self) -> u32 {
        match self {
            Self::Low => 1 * 1024 * 1024,
            Self::Medium => 4 * 1024 * 1024,
            Self::High => 16 * 1024 * 1024,
            Self::Performance100 => 1 * 1024 * 1024,
        }
    }

    pub fn naadf_allows_contact_queries(self) -> bool {
        match self {
            Self::Low | Self::Performance100 => false,
            Self::Medium | Self::High => true,
        }
    }
}

pub fn sync_render_quality_preset(
    settings: Option<Res<SettingsState>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    mut preset: ResMut<RenderQualityPreset>,
) {
    let target = bench_toggles
        .as_deref()
        .and_then(|toggles| toggles.quality_preset)
        .or_else(|| {
            settings
                .as_deref()
                .map(|settings| settings.graphics_quality.into())
        })
        .unwrap_or(RenderQualityPreset::High);

    if *preset != target {
        *preset = target;
    }
}

pub fn apply_render_quality_preset(
    preset: Res<RenderQualityPreset>,
    mut reflection_config: Option<ResMut<WaterReflectionConfig>>,
    #[cfg(feature = "naadf")] mut naadf_config: Option<
        ResMut<crate::rendering::naadf::NaadfConfig>,
    >,
    mut last_applied: Local<Option<RenderQualityPreset>>,
) {
    if Some(*preset) == *last_applied {
        return;
    }
    *last_applied = Some(*preset);

    if let Some(config) = reflection_config.as_deref_mut() {
        config.enabled = true;
        config.resolution_scale = preset.water_reflection_resolution_scale();
        config.update_interval = preset.water_reflection_update_interval();
        config.auto_disable_distance = preset.water_reflection_distance();
        config.require_water_in_frustum = true;
        config.clamp_runtime();
    }

    #[cfg(feature = "naadf")]
    if let Some(config) = naadf_config.as_deref_mut() {
        config.chunk_cache.max_chunk_updates_per_frame = preset.naadf_max_chunk_updates_per_frame();
        config.chunk_cache.max_upload_bytes_per_frame = preset.naadf_max_upload_bytes_per_frame();
        if !preset.naadf_allows_contact_queries() {
            config.use_for_contact_shadows = false;
        }
    }
}

pub fn record_render_quality_counters(
    preset: Res<RenderQualityPreset>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Res<FrameCount>,
) {
    let Some(timing) = timing.as_deref_mut() else {
        return;
    };
    timing.record_count(frame.0, "Render Quality Preset", preset.code());
    timing.record_count(
        frame.0,
        "Terrain Material Quality",
        preset.terrain_material_quality_code(),
    );
    timing.record_count(
        frame.0,
        "Prop LOD Distance Scale",
        preset.prop_lod_distance_scale() as f64,
    );
    timing.record_count(frame.0, "Shadow Quality", preset.shadow_quality_code());
    timing.record_count(
        frame.0,
        "Water Reflection Quality",
        preset.water_reflection_quality_code(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn naadf_quality_budgets_keep_performance100_conservative() {
        assert!(RenderQualityPreset::Performance100.naadf_max_chunk_updates_per_frame() <= 1);
        assert!(
            RenderQualityPreset::Performance100.naadf_max_upload_bytes_per_frame()
                <= RenderQualityPreset::Medium.naadf_max_upload_bytes_per_frame()
        );
        assert!(!RenderQualityPreset::Performance100.naadf_allows_contact_queries());
    }

    #[test]
    fn low_quality_disables_expensive_naadf_contact_queries() {
        assert!(!RenderQualityPreset::Low.naadf_allows_contact_queries());
        assert!(RenderQualityPreset::High.naadf_allows_contact_queries());
    }
}
