use std::fs;
use std::path::Path;

use bevy::prelude::*;
use bevy::window::{MonitorSelection, PrimaryWindow, VideoModeSelection, Window, WindowMode, WindowResolution};
use serde::{Deserialize, Serialize};

use super::types::{
    AntiAliasing, DayLengthOption, DisplayMode, ExposureOption, FloatHeightPreset, GraphicsQuality,
    JumpHeightPreset, MieDirectionOption, MieOption, NightBrightnessOption, OzoneOption,
    RayleighOption, RunSpeedPreset, SettingsState, ShadowFiltering, SkyQualityOption, SunSizeOption,
    TimeScaleOption, TwilightBandOption, WalkSpeedPreset, GroundAlbedoOption, VisualSettings,
};
use crate::atmosphere::{FogConfig, FogPreset};
use crate::environment::AtmosphereSettings;
use crate::player::PlayerConfig;
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::voxel::plugin::WorldConfig;
use crate::voxel::world::VoxelWorld;

pub const SETTINGS_YAML_PATH: &str = "assets/config/settings.yaml";
pub const SETTINGS_JSON_PATH: &str = "assets/config/settings.json";

#[derive(Serialize, Deserialize, Clone)]
struct SettingsSave {
    settings: SettingsSnapshot,
    visual: VisualSettings,
    fog: FogConfig,
    #[serde(default)]
    time_of_day_hours: Option<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
struct SettingsSnapshot {
    graphics_quality: GraphicsQuality,
    anti_aliasing: AntiAliasing,
    ray_tracing: bool,
    display_mode: DisplayMode,
    resolution: [u32; 2],
    greedy_meshing: bool,
    day_length: DayLengthOption,
    time_scale: TimeScaleOption,
    rayleigh: RayleighOption,
    mie: MieOption,
    mie_direction: MieDirectionOption,
    exposure: ExposureOption,
    twilight_band: TwilightBandOption,
    night_brightness: NightBrightnessOption,
    sky_quality: SkyQualityOption,
    ozone: OzoneOption,
    ground_albedo: GroundAlbedoOption,
    sun_size: SunSizeOption,
    cycle_enabled: bool,
    shadow_filtering: ShadowFiltering,
    walk_speed: WalkSpeedPreset,
    run_speed: RunSpeedPreset,
    jump_height: JumpHeightPreset,
    float_height: FloatHeightPreset,
}

impl SettingsSnapshot {
    fn from_state(settings: &SettingsState) -> Self {
        Self {
            graphics_quality: settings.graphics_quality,
            anti_aliasing: settings.anti_aliasing,
            ray_tracing: settings.ray_tracing,
            display_mode: settings.display_mode,
            resolution: [settings.resolution.x, settings.resolution.y],
            greedy_meshing: settings.greedy_meshing,
            day_length: settings.day_length,
            time_scale: settings.time_scale,
            rayleigh: settings.rayleigh,
            mie: settings.mie,
            mie_direction: settings.mie_direction,
            exposure: settings.exposure,
            twilight_band: settings.twilight_band,
            night_brightness: settings.night_brightness,
            sky_quality: settings.sky_quality,
            ozone: settings.ozone,
            ground_albedo: settings.ground_albedo,
            sun_size: settings.sun_size,
            cycle_enabled: settings.cycle_enabled,
            shadow_filtering: settings.shadow_filtering,
            walk_speed: settings.walk_speed,
            run_speed: settings.run_speed,
            jump_height: settings.jump_height,
            float_height: settings.float_height,
        }
    }

    fn apply_to_state(&self, settings: &mut SettingsState) {
        settings.graphics_quality = self.graphics_quality;
        settings.anti_aliasing = self.anti_aliasing;
        settings.ray_tracing = self.ray_tracing;
        settings.display_mode = self.display_mode;
        settings.resolution = UVec2::new(self.resolution[0], self.resolution[1]);
        settings.greedy_meshing = self.greedy_meshing;
        settings.day_length = self.day_length;
        settings.time_scale = self.time_scale;
        settings.rayleigh = self.rayleigh;
        settings.mie = self.mie;
        settings.mie_direction = self.mie_direction;
        settings.exposure = self.exposure;
        settings.twilight_band = self.twilight_band;
        settings.night_brightness = self.night_brightness;
        settings.sky_quality = self.sky_quality;
        settings.ozone = self.ozone;
        settings.ground_albedo = self.ground_albedo;
        settings.sun_size = self.sun_size;
        settings.cycle_enabled = self.cycle_enabled;
        settings.shadow_filtering = self.shadow_filtering;
        settings.walk_speed = self.walk_speed;
        settings.run_speed = self.run_speed;
        settings.jump_height = self.jump_height;
        settings.float_height = self.float_height;
    }
}

pub fn save_settings_to_disk(
    settings_state: &SettingsState,
    visual_settings: &VisualSettings,
    fog_config: &FogConfig,
    atmosphere: &AtmosphereSettings,
) -> Result<(), String> {
    let save = SettingsSave {
        settings: SettingsSnapshot::from_state(settings_state),
        visual: visual_settings.clone(),
        fog: fog_config.clone(),
        time_of_day_hours: Some(atmosphere_time_hours(atmosphere)),
    };

    let yaml_path = Path::new(SETTINGS_YAML_PATH);
    if let Some(parent) = yaml_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let yaml = serde_yaml::to_string(&save).map_err(|e| e.to_string())?;
    fs::write(yaml_path, yaml).map_err(|e| e.to_string())?;

    let json = serde_json::to_string_pretty(&save).map_err(|e| e.to_string())?;
    fs::write(SETTINGS_JSON_PATH, json).map_err(|e| e.to_string())?;

    Ok(())
}

pub fn load_settings_on_startup(
    mut settings_state: ResMut<SettingsState>,
    mut visual_settings: ResMut<VisualSettings>,
    mut fog_config: ResMut<FogConfig>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut player_config: ResMut<PlayerConfig>,
    mut world_config: ResMut<WorldConfig>,
    mut world: ResMut<VoxelWorld>,
    mut ray_tracing: ResMut<RayTracingSettings>,
    mut window_query: Query<&mut Window, With<PrimaryWindow>>,
    mut bevy_atmosphere_query: Query<&mut bevy::pbr::Atmosphere>,
    mut bevy_atmosphere_settings_query: Query<&mut bevy::pbr::AtmosphereSettings>,
) {
    let Some(save) = read_settings_file() else {
        return;
    };

    save.settings.apply_to_state(&mut settings_state);
    *visual_settings = save.visual;
    *fog_config = save.fog;

    settings_state.fog_preset = super::types::FogPresetOption(fog_config.current_preset);
    ray_tracing.enabled = settings_state.ray_tracing;

    let was_greedy = world_config.greedy_meshing;
    world_config.greedy_meshing = settings_state.greedy_meshing;
    if was_greedy != world_config.greedy_meshing {
        for (_, chunk) in world.chunk_entries_mut() {
            chunk.mark_dirty();
        }
    }

    apply_player_settings(&settings_state, &mut player_config);
    apply_window_settings(&settings_state, &mut window_query);
    apply_atmosphere_settings(
        &settings_state,
        fog_config.current_preset,
        &mut atmosphere,
        &mut bevy_atmosphere_query,
        &mut bevy_atmosphere_settings_query,
    );
    apply_time_of_day(save.time_of_day_hours, &mut atmosphere);

    info!(
        "Loaded settings from {}{}",
        SETTINGS_YAML_PATH,
        if Path::new(SETTINGS_JSON_PATH).exists() { " (JSON available)" } else { "" }
    );
}

fn read_settings_file() -> Option<SettingsSave> {
    if Path::new(SETTINGS_YAML_PATH).exists() {
        match fs::read_to_string(SETTINGS_YAML_PATH) {
            Ok(contents) => match serde_yaml::from_str(&contents) {
                Ok(save) => return Some(save),
                Err(err) => warn!("Failed to parse {}: {}", SETTINGS_YAML_PATH, err),
            },
            Err(err) => warn!("Failed to read {}: {}", SETTINGS_YAML_PATH, err),
        }
    }

    if Path::new(SETTINGS_JSON_PATH).exists() {
        match fs::read_to_string(SETTINGS_JSON_PATH) {
            Ok(contents) => match serde_json::from_str(&contents) {
                Ok(save) => return Some(save),
                Err(err) => warn!("Failed to parse {}: {}", SETTINGS_JSON_PATH, err),
            },
            Err(err) => warn!("Failed to read {}: {}", SETTINGS_JSON_PATH, err),
        }
    }

    None
}

fn apply_player_settings(settings: &SettingsState, player_config: &mut PlayerConfig) {
    player_config.walk_speed = settings.walk_speed.value();
    player_config.run_speed = settings.run_speed.value();
    player_config.jump_height = settings.jump_height.value();
    player_config.float_height = settings.float_height.value();
}

fn apply_window_settings(
    settings_state: &SettingsState,
    window_query: &mut Query<&mut Window, With<PrimaryWindow>>,
) {
    let Ok(mut window) = window_query.single_mut() else {
        return;
    };

    window.mode = match settings_state.display_mode {
        DisplayMode::Bordered | DisplayMode::Borderless => WindowMode::Windowed,
        DisplayMode::Fullscreen => {
            WindowMode::Fullscreen(MonitorSelection::Primary, VideoModeSelection::Current)
        }
    };
    window.decorations = matches!(settings_state.display_mode, DisplayMode::Bordered);
    window.resolution = WindowResolution::new(
        settings_state.resolution.x,
        settings_state.resolution.y,
    );
}

fn apply_atmosphere_settings(
    settings_state: &SettingsState,
    fog_preset: FogPreset,
    atmosphere: &mut AtmosphereSettings,
    bevy_atmosphere_query: &mut Query<&mut bevy::pbr::Atmosphere>,
    bevy_atmosphere_settings_query: &mut Query<&mut bevy::pbr::AtmosphereSettings>,
) {
    let base_rayleigh = Vec3::new(5.5, 13.0, 22.4) * 0.0012;
    let base_mie = Vec3::splat(0.005);

    atmosphere.cycle_enabled = settings_state.cycle_enabled;
    atmosphere.day_length = match settings_state.day_length {
        DayLengthOption::Short => 600.0,
        DayLengthOption::Standard => 1800.0,
        DayLengthOption::Long => 3600.0,
    };
    atmosphere.time_scale = match settings_state.time_scale {
        TimeScaleOption::Slow => 0.5,
        TimeScaleOption::RealTime => 1.0,
        TimeScaleOption::Fast => 2.0,
    };
    if !settings_state.cycle_enabled {
        atmosphere.time = atmosphere.day_length * 0.25;
    }

    atmosphere.rayleigh = match settings_state.rayleigh {
        RayleighOption::Gentle => base_rayleigh * 0.7,
        RayleighOption::Balanced => base_rayleigh,
        RayleighOption::Vivid => base_rayleigh * 1.4,
    };
    atmosphere.mie = match settings_state.mie {
        MieOption::Soft => Vec3::splat(0.0035),
        MieOption::Standard => base_mie,
        MieOption::Dense => Vec3::splat(0.0075),
    };
    atmosphere.mie_direction = match settings_state.mie_direction {
        MieDirectionOption::Broad => 0.5,
        MieDirectionOption::Standard => 0.7,
        MieDirectionOption::Forward => 0.85,
    };
    atmosphere.exposure = match settings_state.exposure {
        ExposureOption::Low => 0.8,
        ExposureOption::Neutral => 1.0,
        ExposureOption::High => 1.3,
    };
    atmosphere.twilight_band = match settings_state.twilight_band {
        TwilightBandOption::Narrow => 0.35,
        TwilightBandOption::Medium => 0.6,
        TwilightBandOption::Wide => 0.9,
    };
    atmosphere.night_floor = match settings_state.night_brightness {
        NightBrightnessOption::Dim => 0.04,
        NightBrightnessOption::Balanced => 0.08,
        NightBrightnessOption::Bright => 0.12,
    };
    atmosphere.fog_density = match fog_preset {
        FogPreset::Clear => Vec2::new(0.0006, 0.0014),
        FogPreset::Balanced => Vec2::new(0.0009, 0.0022),
        FogPreset::Misty => Vec2::new(0.0012, 0.003),
        FogPreset::GodRays => Vec2::new(0.00001, 0.0001),
    };

    for mut atmo in bevy_atmosphere_query.iter_mut() {
        atmo.ground_albedo = match settings_state.ground_albedo {
            GroundAlbedoOption::Dark => Vec3::splat(0.1),
            GroundAlbedoOption::Earth => Vec3::new(0.3, 0.3, 0.3),
            GroundAlbedoOption::Bright => Vec3::splat(0.5),
            GroundAlbedoOption::Snow => Vec3::splat(0.8),
        };
    }

    for mut settings in bevy_atmosphere_settings_query.iter_mut() {
        settings.sky_max_samples = match settings_state.sky_quality {
            SkyQualityOption::Low => 16,
            SkyQualityOption::Medium => 32,
            SkyQualityOption::High => 48,
            SkyQualityOption::Ultra => 64,
        };
    }
}

fn atmosphere_time_hours(atmosphere: &AtmosphereSettings) -> f32 {
    if atmosphere.day_length <= f32::EPSILON {
        return 0.0;
    }
    let normalized = (atmosphere.time / atmosphere.day_length).rem_euclid(1.0);
    (normalized * 24.0).clamp(0.0, 24.0)
}

fn apply_time_of_day(time_of_day_hours: Option<f32>, atmosphere: &mut AtmosphereSettings) {
    let Some(hours) = time_of_day_hours else { return };
    let clamped = hours.clamp(0.0, 24.0);
    if atmosphere.day_length > 0.0 {
        atmosphere.time = (clamped / 24.0) * atmosphere.day_length;
    }
}
