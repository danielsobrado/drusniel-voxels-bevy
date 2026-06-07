use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::prelude::*;
use bevy::shader::{Shader, ShaderDefVal};
use bevy_water::water::material::{WATER_FRAGMENT_SHADER_HANDLE, WATER_VERTEX_SHADER_HANDLE};
use serde::{Deserialize, Serialize};

use crate::rendering::witchcraft_water_finish::WitchcraftWaterFinishConfig;
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

#[derive(Deserialize, Clone)]
pub struct ReflectionConfig {
    pub enabled: bool,
    pub resolution_scale: f32,
    pub disable_shadows: bool,
    pub max_render_distance: f32,
    pub distortion_strength: f32,
    pub update_every_n_frames: u32,
}

impl Default for ReflectionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resolution_scale: 0.35,
            disable_shadows: true,
            max_render_distance: 150.0,
            distortion_strength: 0.02,
            update_every_n_frames: 2,
        }
    }
}

#[derive(Deserialize, Clone)]
pub struct RefractionConfig {
    pub enabled: bool,
    pub strength: f32,
    pub ior: f32,
    pub chromatic_aberration: bool,
}

impl Default for RefractionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            strength: 0.03,
            ior: 1.33,
            chromatic_aberration: false,
        }
    }
}

#[derive(Deserialize, Clone)]
pub struct DisplacementConfig {
    pub enabled: bool,
    pub resolution: u32,
    pub world_size: f32,
    pub wave_speed: f32,
    pub damping: f32,
    pub player_impulse_radius: f32,
    pub player_impulse_strength: f32,
}

#[derive(Deserialize, Clone)]
#[serde(default)]
pub struct WaterWeatherConfig {
    pub rain_reflection_boost: f32,
    pub rain_distortion_boost: f32,
    pub snow_reflection_soften: f32,
}

impl Default for WaterWeatherConfig {
    fn default() -> Self {
        Self {
            rain_reflection_boost: 0.12,
            rain_distortion_boost: 0.35,
            snow_reflection_soften: 0.18,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_water_uses_ocean_preset_as_transient_fallback() {
        let config = WaterConfig::default();

        assert_eq!(
            config.body_preset(WaterBodyKind::Unknown).deep_color,
            config.body_preset(WaterBodyKind::Ocean).deep_color
        );
        assert_eq!(
            config.body_preset(WaterBodyKind::Unknown).wave_amplitude,
            config.body_preset(WaterBodyKind::Ocean).wave_amplitude
        );
    }
}

impl Default for DisplacementConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resolution: 1024,
            world_size: 128.0,
            wave_speed: 0.98,
            damping: 0.995,
            player_impulse_radius: 1.5,
            player_impulse_strength: -0.3,
        }
    }
}

pub fn load_water_config() -> Result<WaterConfig, Box<dyn std::error::Error>> {
    let config_str = std::fs::read_to_string("assets/config/water.yaml")?;
    let config: WaterConfig = serde_yaml::from_str(&config_str)?;
    Ok(config)
}

/// Component marking entities that should receive caustic lighting
#[derive(Component)]
pub struct ReceivesCaustics {
    pub water_surface_y: f32,
}

/// Component for water volumes
#[derive(Component)]
pub struct WaterVolume {
    pub bounds_min: Vec3,
    pub bounds_max: Vec3,
}

// WGSL modules registered via `load_internal_asset!` so other shaders can `#import` them.
pub const WATER_CAUSTICS_HANDLE: Handle<Shader> =
    uuid_handle!("c3d4e5f6-a7b8-9012-cdef-012345678901");
pub const WEATHER_COMMON_HANDLE: Handle<Shader> =
    uuid_handle!("a42e6f9b-5c81-4a0d-a6f7-6e45e9ef0001");
pub const NOBLE_GERSTNER_HANDLE: Handle<Shader> =
    uuid_handle!("e8a0c196-9db0-4db7-a623-3c8f57c20e01");
pub const NOBLE_FOAM_HANDLE: Handle<Shader> = uuid_handle!("d301db2d-50ef-4f6f-a22e-704278a756d1");
pub const NOBLE_DETAIL_NORMALS_HANDLE: Handle<Shader> =
    uuid_handle!("b6e30d80-517f-4e8e-bd35-e4e54f653fa1");
pub const NOBLE_PARALLAX_HANDLE: Handle<Shader> =
    uuid_handle!("ad3c6724-8f1d-4643-9504-790f9506700b");

pub struct EnhancedWaterPlugin;

impl Plugin for EnhancedWaterPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            WATER_CAUSTICS_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/water_caustics.wgsl"
            ),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            WEATHER_COMMON_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/weather_common.wgsl"
            ),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            NOBLE_GERSTNER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/noble_gerstner.wgsl"
            ),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            NOBLE_FOAM_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/noble_foam.wgsl"
            ),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            NOBLE_DETAIL_NORMALS_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/noble_detail_normals.wgsl"
            ),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            NOBLE_PARALLAX_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/noble_parallax.wgsl"
            ),
            Shader::from_wgsl
        );

        let config = load_water_config().unwrap_or_else(|e| {
            warn!("Failed to load water config: {}, using defaults", e);
            WaterConfig::default()
        });

        let witchcraft_params = config.witchcraft_finish.params();
        let shader_toggles = config.shader_toggles.with_env_overrides();
        app.insert_resource(config)
            .insert_resource(witchcraft_params)
            .insert_resource(shader_toggles)
            .add_systems(Startup, sync_water_shader_defs)
            .add_systems(Update, sync_water_shader_defs);
    }
}

fn sync_water_shader_defs(
    toggles: Res<WaterShaderToggles>,
    asset_server: Res<AssetServer>,
    mut shaders: ResMut<Assets<Shader>>,
    mut last_applied: Local<Option<WaterShaderToggles>>,
) {
    let shader_toggles = *toggles;
    let should_apply = last_applied.is_none_or(|last| last != shader_toggles);
    let vertex_asset: Handle<Shader> = asset_server.load("shaders/water_vertex.wgsl");
    let fragment_asset: Handle<Shader> = asset_server.load("shaders/water_fragment.wgsl");
    let mut all_loaded = true;

    for handle in [
        &WATER_VERTEX_SHADER_HANDLE,
        &WATER_FRAGMENT_SHADER_HANDLE,
        &vertex_asset,
        &fragment_asset,
    ] {
        if let Some(shader) = shaders.get_mut(handle) {
            if should_apply {
                set_noble_shader_defs(shader, shader_toggles);
            }
        } else {
            all_loaded = false;
        }
    }

    if all_loaded {
        *last_applied = Some(shader_toggles);
    }
}

fn set_noble_shader_defs(shader: &mut Shader, toggles: WaterShaderToggles) {
    const NOBLE_DEFS: [&str; 4] = [
        "USE_NOBLE_GERSTNER",
        "USE_NOBLE_FOAM",
        "USE_NOBLE_DETAIL_NORMALS",
        "USE_NOBLE_PARALLAX",
    ];
    shader.shader_defs.retain(|def| match def {
        ShaderDefVal::Bool(name, _) => !NOBLE_DEFS.contains(&name.as_str()),
        ShaderDefVal::Int(name, _) => !NOBLE_DEFS.contains(&name.as_str()),
        ShaderDefVal::UInt(name, _) => !NOBLE_DEFS.contains(&name.as_str()),
    });

    if toggles.gerstner {
        shader.shader_defs.push("USE_NOBLE_GERSTNER".into());
    }
    if toggles.voronoi_foam {
        shader.shader_defs.push("USE_NOBLE_FOAM".into());
    }
    if toggles.detail_normals {
        shader.shader_defs.push("USE_NOBLE_DETAIL_NORMALS".into());
    }
    if toggles.water_parallax {
        shader.shader_defs.push("USE_NOBLE_PARALLAX".into());
    }
}
pub mod displacement;
pub mod finish;
pub mod reflection;
pub mod reflection_compositor;
