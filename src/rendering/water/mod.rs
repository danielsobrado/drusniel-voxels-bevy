use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::prelude::*;
use bevy::shader::{Shader, ShaderDefVal};
use bevy_water::water::material::{WATER_FRAGMENT_SHADER_HANDLE, WATER_VERTEX_SHADER_HANDLE};
use serde::{Deserialize, Serialize};

use crate::rendering::witchcraft_water_finish::WitchcraftWaterFinishConfig;
use crate::terrain::generation::OceanClass;
use crate::voxel::meshing::WaterBodyKind;

/// Water configuration. Per-body wave/colour/reflection tuning lives in
/// `body_presets`; the rest are toggles for reflections, refraction,
/// displacement, weather coupling, the optional witchcraft finish, and the
/// optional Noble shader paths.
#[derive(Resource, Deserialize, Clone, Default)]
#[serde(default)]
pub struct WaterConfig {
    pub body_presets: WaterBodyPresetsConfig,
    pub reflections: ReflectionConfig,
    pub refraction: RefractionConfig,
    pub displacement: DisplacementConfig,
    pub weather: WaterWeatherConfig,
    pub witchcraft_finish: WitchcraftWaterFinishConfig,
    #[serde(alias = "noble_shaders")]
    pub shader_toggles: WaterShaderToggles,
}

#[derive(Resource, Deserialize, Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(default)]
pub struct WaterShaderToggles {
    pub gerstner: bool,
    pub voronoi_foam: bool,
    pub detail_normals: bool,
    pub water_parallax: bool,
}

impl WaterShaderToggles {
    pub fn with_env_overrides(self) -> Self {
        Self {
            gerstner: self.gerstner || env_flag("VOXEL_WATER_GERSTNER"),
            voronoi_foam: self.voronoi_foam || env_flag("VOXEL_WATER_VORONOI_FOAM"),
            detail_normals: self.detail_normals || env_flag("VOXEL_WATER_DETAIL_NORMALS"),
            water_parallax: self.water_parallax || env_flag("VOXEL_WATER_PARALLAX"),
        }
    }

    pub fn any(self) -> bool {
        self.gerstner || self.voronoi_foam || self.detail_normals || self.water_parallax
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

#[derive(Deserialize, Clone)]
pub struct WaterBodyPresetsConfig {
    pub ocean: WaterBodyPresetConfig,
    pub lake: WaterBodyPresetConfig,
    pub river: WaterBodyPresetConfig,
    pub pond: WaterBodyPresetConfig,
    #[serde(default = "default_shallow_flood_preset")]
    pub shallow_flood: WaterBodyPresetConfig,
}

#[derive(Deserialize, Clone)]
pub struct WaterBodyPresetConfig {
    pub wave_amplitude: f32,
    pub wave_speed: f32,
    pub wave_scale: f32,
    pub wave_count: u32,
    pub reflection_strength: f32,
    pub fresnel_power: f32,
    pub distortion_strength: f32,
    pub shallow_color: [f32; 4],
    pub deep_color: [f32; 4],
    pub clarity: f32,
    pub base_alpha: f32,
    pub foam_enabled: bool,
    pub shore_foam: bool,
    pub wave_crest_foam: bool,
    pub murkiness: f32,
    pub detail_normal_intensity: f32,
    pub detail_scroll_speed: f32,
    #[serde(default = "default_ripple_overlay_strength")]
    pub lake_ripple_overlay_strength: f32,
}

impl WaterConfig {
    pub fn body_preset(&self, kind: WaterBodyKind) -> &WaterBodyPresetConfig {
        match kind {
            WaterBodyKind::Ocean => &self.body_presets.ocean,
            WaterBodyKind::Lake => &self.body_presets.lake,
            WaterBodyKind::River => &self.body_presets.river,
            WaterBodyKind::Pond => &self.body_presets.pond,
            WaterBodyKind::ShallowFlood => &self.body_presets.shallow_flood,
            WaterBodyKind::Unknown => &self.body_presets.ocean,
        }
    }

    pub fn world_shape_preset(&self, ocean_class: OceanClass) -> &WaterBodyPresetConfig {
        self.body_preset(water_body_kind_for_ocean_class(ocean_class))
    }
}

pub fn water_body_kind_for_ocean_class(ocean_class: OceanClass) -> WaterBodyKind {
    match ocean_class {
        OceanClass::DeepSea | OceanClass::ShelfSea | OceanClass::Coast => WaterBodyKind::Ocean,
        OceanClass::Beach | OceanClass::Land => WaterBodyKind::Unknown,
    }
}

fn default_ripple_overlay_strength() -> f32 {
    1.0
}

impl Default for WaterBodyPresetsConfig {
    fn default() -> Self {
        Self {
            ocean: WaterBodyPresetConfig {
                wave_amplitude: 3.6,
                wave_speed: 1.3,
                wave_scale: 0.85,
                wave_count: 4,
                reflection_strength: 0.44,
                fresnel_power: 5.6,
                distortion_strength: 0.02,
                shallow_color: [0.015, 0.34, 0.82, 0.98],
                deep_color: [0.0, 0.06, 0.34, 1.0],
                clarity: 0.46,
                base_alpha: 0.98,
                foam_enabled: true,
                shore_foam: true,
                wave_crest_foam: true,
                murkiness: 0.1,
                detail_normal_intensity: 0.8,
                detail_scroll_speed: 0.04,
                lake_ripple_overlay_strength: 1.0,
            },
            lake: WaterBodyPresetConfig {
                wave_amplitude: 0.36,
                wave_speed: 0.5,
                wave_scale: 1.1,
                wave_count: 2,
                reflection_strength: 0.42,
                fresnel_power: 4.4,
                distortion_strength: 0.005,
                shallow_color: [0.014, 0.17, 0.39, 0.96],
                deep_color: [0.0, 0.045, 0.16, 0.99],
                clarity: 0.62,
                base_alpha: 0.95,
                foam_enabled: true,
                shore_foam: true,
                wave_crest_foam: false,
                murkiness: 0.22,
                detail_normal_intensity: 1.35,
                detail_scroll_speed: 0.02,
                lake_ripple_overlay_strength: 0.22,
            },
            river: WaterBodyPresetConfig {
                wave_amplitude: 0.22,
                wave_speed: 0.65,
                wave_scale: 1.6,
                wave_count: 2,
                reflection_strength: 0.34,
                fresnel_power: 4.0,
                distortion_strength: 0.008,
                shallow_color: [0.02, 0.18, 0.34, 0.82],
                deep_color: [0.004, 0.055, 0.15, 0.9],
                clarity: 0.18,
                base_alpha: 0.8,
                foam_enabled: true,
                shore_foam: true,
                wave_crest_foam: false,
                murkiness: 0.28,
                detail_normal_intensity: 0.45,
                detail_scroll_speed: 0.026,
                lake_ripple_overlay_strength: 0.28,
            },
            pond: WaterBodyPresetConfig {
                wave_amplitude: 0.08,
                wave_speed: 0.3,
                wave_scale: 3.0,
                wave_count: 1,
                reflection_strength: 0.36,
                fresnel_power: 4.0,
                distortion_strength: 0.0035,
                shallow_color: [0.018, 0.13, 0.29, 0.82],
                deep_color: [0.004, 0.04, 0.11, 0.92],
                clarity: 0.5,
                base_alpha: 0.8,
                foam_enabled: false,
                shore_foam: false,
                wave_crest_foam: false,
                murkiness: 0.42,
                detail_normal_intensity: 0.55,
                detail_scroll_speed: 0.012,
                lake_ripple_overlay_strength: 0.08,
            },
            shallow_flood: default_shallow_flood_preset(),
        }
    }
}

fn default_shallow_flood_preset() -> WaterBodyPresetConfig {
    WaterBodyPresetConfig {
        wave_amplitude: 0.015,
        wave_speed: 0.18,
        wave_scale: 4.0,
        wave_count: 1,
        reflection_strength: 0.08,
        fresnel_power: 3.0,
        distortion_strength: 0.001,
        shallow_color: [0.035, 0.20, 0.34, 0.74],
        deep_color: [0.005, 0.065, 0.17, 0.86],
        clarity: 0.42,
        base_alpha: 0.72,
        foam_enabled: false,
        shore_foam: false,
        wave_crest_foam: false,
        murkiness: 0.65,
        detail_normal_intensity: 0.1,
        detail_scroll_speed: 0.006,
        lake_ripple_overlay_strength: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ocean_classes_map_to_ocean_water() {
        assert_eq!(
            water_body_kind_for_ocean_class(OceanClass::DeepSea),
            WaterBodyKind::Ocean
        );
        assert_eq!(
            water_body_kind_for_ocean_class(OceanClass::ShelfSea),
            WaterBodyKind::Ocean
        );
        assert_eq!(
            water_body_kind_for_ocean_class(OceanClass::Coast),
            WaterBodyKind::Ocean
        );
    }

    #[test]
    fn dry_classes_do_not_spawn_ocean_water() {
        assert_eq!(
            water_body_kind_for_ocean_class(OceanClass::Beach),
            WaterBodyKind::Unknown
        );
        assert_eq!(
            water_body_kind_for_ocean_class(OceanClass::Land),
            WaterBodyKind::Unknown
        );
    }
}
