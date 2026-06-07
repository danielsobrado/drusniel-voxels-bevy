use bevy::light::{
    CascadeShadowConfig, CascadeShadowConfigBuilder, DirectionalLightShadowMap, GlobalAmbientLight,
    SunDisk, VolumetricLight,
};
use bevy::prelude::*;
use bevy_water::{
    GlobalWaveState, ImageUtilsPlugin, WaterSettings, water::material::WaterMaterialPlugin,
};

use crate::constants::WATER_LEVEL;
use crate::rendering::capabilities::GraphicsCapabilities;

use self::atmosphere::AtmosphereConfig;

pub const DEFAULT_SUN_ILLUMINANCE: f32 = 5_000.0;

/// Settings that drive the sky and sun animation
#[derive(Resource, Clone)]
pub struct AtmosphereSettings {
    /// Length of a full day/night cycle in seconds
    pub day_length: f32,
    /// Current time within the cycle
    pub time: f32,
    /// Scales how quickly time advances (1.0 = real time)
    pub time_scale: f32,
    /// Strength of Rayleigh scattering (blue sky)
    pub rayleigh: Vec3,
    /// Strength of Mie scattering (sunset glow)
    pub mie: Vec3,
    /// Controls how forward-facing Mie scattering is; 0 = isotropic
    pub mie_direction: f32,
    /// Exposure multiplier for the sky and sun light
    pub exposure: f32,
    /// Width of the dawn/dusk transition band around the horizon (in radians)
    pub twilight_band: f32,
    /// Minimum ambient multiplier to keep nights readable
    pub night_floor: f32,
    /// Fog density for (day, night)
    pub fog_density: Vec2,
    /// Whether the day/night cycle is active
    pub cycle_enabled: bool,
    /// Whether the main infinitely distant light source contributes direct light.
    pub light_enabled: bool,
    /// Manual light azimuth in degrees, used when the day/night cycle is disabled.
    pub light_azimuth_degrees: f32,
    /// Manual light elevation in degrees, used when the day/night cycle is disabled.
    pub light_elevation_degrees: f32,
    /// Manual light color, used when the day/night cycle is disabled.
    pub light_color: Vec3,
    /// Manual light illuminance, used when the day/night cycle is disabled.
    pub light_illuminance: f32,
    /// User-facing atmosphere density multiplier.
    pub atmosphere_amount: f32,
    /// Distance at which the atmosphere hides half the scene contribution.
    pub atmosphere_half_length: f32,
}

impl Default for AtmosphereSettings {
    fn default() -> Self {
        Self {
            day_length: 1800.0, // 30 minutes for a full cycle
            // Start during the day (slightly past sunrise)
            time: 1800.0 * 0.25,
            time_scale: 1.0,
            rayleigh: Vec3::new(5.5, 13.0, 22.4) * 0.0012,
            mie: Vec3::splat(0.005),
            mie_direction: 0.7,
            exposure: 1.0,
            twilight_band: 0.6,
            night_floor: 0.08,
            // Much lower density for clearer outdoor views
            fog_density: Vec2::new(0.0001, 0.0010),
            cycle_enabled: false,
            light_enabled: true,
            light_azimuth_degrees: 0.0,
            light_elevation_degrees: 70.0,
            light_color: Vec3::new(1.0, 0.98, 0.95),
            light_illuminance: DEFAULT_SUN_ILLUMINANCE,
            atmosphere_amount: 1.0,
            atmosphere_half_length: 220.0,
        }
    }
}

impl AtmosphereSettings {
    pub fn manual_light_direction(&self) -> Vec3 {
        light_direction_from_angles(self.light_azimuth_degrees, self.light_elevation_degrees)
    }

    pub fn sun_direction_and_altitude(&self) -> (Vec3, f32) {
        if self.cycle_enabled {
            let phase = if self.day_length <= f32::EPSILON {
                0.25
            } else {
                (self.time / self.day_length).rem_euclid(1.0)
            };
            let theta = phase * std::f32::consts::TAU;
            let altitude = theta.sin();
            let azimuth = theta.cos();
            let direction = Vec3::new(azimuth * 0.45, altitude, 0.35).normalize_or_zero();
            (direction, altitude)
        } else {
            let direction = self.manual_light_direction();
            (direction, direction.y)
        }
    }
}

pub fn light_direction_from_angles(azimuth_degrees: f32, elevation_degrees: f32) -> Vec3 {
    let azimuth = azimuth_degrees.to_radians();
    let elevation = elevation_degrees.clamp(-90.0, 90.0).to_radians();
    let horizontal = elevation.cos();
    Vec3::new(
        horizontal * azimuth.sin(),
        elevation.sin(),
        horizontal * azimuth.cos(),
    )
    .normalize_or_zero()
}

pub fn light_angles_from_direction(direction: Vec3) -> (f32, f32) {
    let direction = if direction.length_squared() > f32::EPSILON {
        direction.normalize()
    } else {
        Vec3::Y
    };
    let elevation = direction.y.clamp(-1.0, 1.0).asin().to_degrees();
    let azimuth = direction.x.atan2(direction.z).to_degrees();
    (azimuth, elevation)
}

#[derive(Component)]
pub struct Sun;

pub struct AtmospherePlugin;

impl Plugin for AtmospherePlugin {
    fn build(&self, app: &mut App) {
        // Check if native atmosphere will be used (loaded separately, but we can check the config)
        let native_atmosphere_enabled =
            atmosphere::atmosphere_integration::load_atmosphere_config()
                .map(|c| c.enabled)
                .unwrap_or(false);

        // Use transparent clear color when native atmosphere is active (it renders the sky),
        // otherwise use a soft sky tint as fallback
        let clear_color = if native_atmosphere_enabled {
            ClearColor(Color::NONE)
        } else {
            ClearColor(Color::srgba(0.50, 0.64, 0.84, 1.0))
        };

        app.insert_resource(AtmosphereSettings::default())
            .insert_resource(clear_color)
            .insert_resource(DirectionalLightShadowMap { size: 4096 })
            // bevy_water material settings for voxel-owned water meshes.
            .insert_resource(WaterSettings {
                height: WATER_LEVEL as f32,
                amplitude: 0.9,
                alpha_mode: AlphaMode::Blend,
                base_color: Color::srgba(0.02, 0.1, 0.2, 0.92),
                clarity: 0.14,
                deep_color: Color::srgba(0.01, 0.04, 0.12, 0.98).into(),
                shallow_color: Color::srgba(0.04, 0.18, 0.36, 0.9).into(),
                edge_color: Color::srgba(0.18, 0.38, 0.55, 0.75).into(),
                edge_scale: 0.4,
                // Voxel water owns visible water surfaces; never spawn the finite global tile grid.
                spawn_tiles: None,
                ..default()
            })
            .insert_resource(GlobalWaveState::default())
            .add_plugins((WaterMaterialPlugin, ImageUtilsPlugin))
            .add_systems(Startup, (setup_atmosphere, seed_atmosphere).chain())
            .add_systems(
                Update,
                (
                    animate_atmosphere,
                    apply_visual_settings_to_sun,
                    adjust_shadows_for_integrated_gpu,
                ),
            );
    }
}

fn setup_atmosphere(mut commands: Commands) {
    // Sun directional light with tuned settings
    commands.spawn((
        DirectionalLight {
            color: Color::srgb(1.0, 0.98, 0.95), // Slightly warm white sun
            // Tuned for the shared terrain PBR and editor viewport exposure.
            illuminance: DEFAULT_SUN_ILLUMINANCE,
            shadows_enabled: true,
            shadow_depth_bias: 0.04,
            shadow_normal_bias: 1.8,
            ..default()
        },
        Transform::from_translation(Vec3::ZERO)
            .looking_to(Vec3::new(-0.3, -1.0, -0.2).normalize(), Vec3::Y),
        CascadeShadowConfigBuilder {
            num_cascades: 4,
            minimum_distance: 0.5,
            maximum_distance: 256.0, // Was 1024 — matches terrain shadow cull distance + margin
            first_cascade_far_bound: 16.0,
            overlap_proportion: 0.3,
            ..default()
        }
        .build(),
        VolumetricLight, // Enable god rays
        SunDisk::EARTH,
        Sun,
    ));
}

fn seed_atmosphere(
    settings: Res<AtmosphereSettings>,
    atmo_config: Option<Res<AtmosphereConfig>>,
    mut sun_query: Query<(&mut Transform, &mut DirectionalLight), With<Sun>>,
    mut ambient: ResMut<GlobalAmbientLight>,
    mut clear_color: ResMut<ClearColor>,
) {
    // Check if Bevy's native atmosphere is handling sky rendering
    let native_atmosphere_active = atmo_config.map(|c| c.enabled).unwrap_or(false);

    if let Some(sample) = compute_atmosphere(&settings) {
        apply_atmosphere_sample(
            sample,
            &mut sun_query,
            &mut ambient,
            &mut clear_color,
            native_atmosphere_active,
        );
    }
}

fn animate_atmosphere(
    time: Res<Time>,
    mut settings: ResMut<AtmosphereSettings>,
    atmo_config: Option<Res<AtmosphereConfig>>,
    mut sun_query: Query<(&mut Transform, &mut DirectionalLight), With<Sun>>,
    mut ambient: ResMut<GlobalAmbientLight>,
    mut clear_color: ResMut<ClearColor>,
) {
    // Check if Bevy's native atmosphere is handling sky rendering
    let native_atmosphere_active = atmo_config.map(|c| c.enabled).unwrap_or(false);

    // Advance time if enabled
    if settings.cycle_enabled {
        settings.time =
            (settings.time + time.delta_secs() * settings.time_scale) % settings.day_length;
    }
    if let Some(sample) = compute_atmosphere(&settings) {
        apply_atmosphere_sample(
            sample,
            &mut sun_query,
            &mut ambient,
            &mut clear_color,
            native_atmosphere_active,
        );
    }
}

struct AtmosphereSample {
    sun_dir: Vec3,
    sun_color: Color,
    sun_illuminance: f32,
    ambient_color: Color,
    ambient_brightness: f32,
    sky_color: Color,
}

fn compute_atmosphere(settings: &AtmosphereSettings) -> Option<AtmosphereSample> {
    let (sun_dir, altitude) = settings.sun_direction_and_altitude();

    if sun_dir == Vec3::ZERO {
        return None;
    }

    // Atmospheric scattering parameters
    let cos_theta = sun_dir.dot(Vec3::Y).clamp(-1.0, 1.0);
    let rayleigh_phase = 0.75 * (1.0 + cos_theta * cos_theta);
    let mie_phase = henyey_greenstein(settings.mie_direction.clamp(-0.99, 0.99), cos_theta)
        * std::f32::consts::FRAC_1_PI;

    // Daylight factor (smoothstep to keep soft dawn/dusk)
    let daylight = smoothstep(-0.1, 0.25, altitude);
    let twilight = twilight_factor(altitude, settings.twilight_band);
    let horizon_warmth = twilight.powf(1.2);
    let night_factor = (1.0 - daylight).max(settings.night_floor);

    // Sky and light colors driven by scattering
    let spectral_scatter = settings.rayleigh * rayleigh_phase + settings.mie * mie_phase;
    let zenith_day = Vec3::new(0.17, 0.27, 0.48) + spectral_scatter * 5.0;
    let horizon_twilight = Vec3::new(1.05, 0.42, 0.18);
    let night_sky = Vec3::new(0.01, 0.025, 0.05);

    let night_sky_boost = (settings.night_floor * 4.0).clamp(0.12, 0.6);
    let sky_brightness = lerp(night_sky_boost, 1.0, daylight);
    let sky_color = night_sky
        .lerp(zenith_day, daylight)
        .lerp(horizon_twilight, horizon_warmth)
        * (settings.exposure * sky_brightness);

    let sun_heat = Vec3::new(1.0, 0.78, 0.62).lerp(Vec3::new(1.0, 0.92, 0.84), daylight);
    let moon_heat = Vec3::new(0.8, 0.9, 1.0);
    let sun_tint = if settings.cycle_enabled {
        sun_heat.lerp(moon_heat, night_factor * 0.85)
    } else {
        settings.light_color
    };

    // Lighting strength based on altitude (tuned to match the older v0.3 look).
    let (sun_strength, moon_strength) = if settings.cycle_enabled {
        (
            lerp(2000.0, 5_000.0, daylight) * (1.0 + horizon_warmth * 0.1),
            lerp(100.0, 20.0, daylight) * night_factor,
        )
    } else {
        (settings.light_illuminance, 0.0)
    };
    // Ambient light - moderate for balanced shadows
    let ambient_strength = lerp(800.0, 2000.0, daylight) * (1.0 + horizon_warmth * 0.2);
    // Blue-ish ambient tint for cooler fill light (Valheim style)
    let ambient_tint = Vec3::new(0.10, 0.16, 0.26)
        .lerp(Vec3::new(0.24, 0.36, 0.52), daylight)
        .lerp(Vec3::new(0.22, 0.24, 0.30), horizon_warmth * 0.5);

    Some(AtmosphereSample {
        sun_dir,
        sun_color: Color::linear_rgb(sun_tint.x, sun_tint.y, sun_tint.z),
        sun_illuminance: if settings.light_enabled {
            sun_strength + moon_strength
        } else {
            0.0
        },
        ambient_color: Color::linear_rgb(ambient_tint.x, ambient_tint.y, ambient_tint.z),
        ambient_brightness: ambient_strength,
        sky_color: Color::linear_rgb(sky_color.x, sky_color.y, sky_color.z),
    })
}

fn apply_atmosphere_sample(
    sample: AtmosphereSample,
    sun_query: &mut Query<(&mut Transform, &mut DirectionalLight), With<Sun>>,
    ambient: &mut ResMut<GlobalAmbientLight>,
    clear_color: &mut ResMut<ClearColor>,
    native_atmosphere_active: bool,
) {
    if let Ok((mut transform, mut light)) = sun_query.single_mut() {
        // Use light direction (from sun toward the world), which is the inverse of the sun vector.
        transform.look_to(-sample.sun_dir, Vec3::Y);
        light.illuminance = sample.sun_illuminance;
        light.color = sample.sun_color;
    }

    ambient.brightness = sample.ambient_brightness;
    ambient.color = sample.ambient_color;

    // Only set ClearColor if native atmosphere is NOT active
    // When Bevy's procedural atmosphere is enabled, it renders the sky itself
    if !native_atmosphere_active {
        clear_color.0 = sample.sky_color;
    }
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn saturate(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = saturate((x - edge0) / (edge1 - edge0));
    t * t * (3.0 - 2.0 * t)
}

fn twilight_factor(altitude: f32, band_width: f32) -> f32 {
    let half_band = band_width.max(0.05) * 0.5;
    let distance = (altitude.abs() - half_band).max(0.0) / half_band.max(f32::EPSILON);
    saturate(1.0 - distance).powf(1.5)
}

fn henyey_greenstein(g: f32, cos_theta: f32) -> f32 {
    let denom = 1.0 + g * g - 2.0 * g * cos_theta;
    (1.0 - g * g) / (denom.powf(1.5) + f32::EPSILON)
}

use crate::menu::VisualSettings;

/// System to apply visual settings to sun lighting
pub fn apply_visual_settings_to_sun(
    visual_settings: Res<VisualSettings>,
    mut sun_query: Query<&mut DirectionalLight, With<Sun>>,
) {
    if !visual_settings.is_changed() {
        return;
    }

    for mut light in sun_query.iter_mut() {
        // Apply sun warmth - interpolate from neutral white to warm
        let warmth = visual_settings.sun_warmth;
        light.color = Color::srgb(1.0, 1.0 - warmth * 0.15, 1.0 - warmth * 0.5);

        // Apply illuminance
        light.illuminance = visual_settings.illuminance;
    }
}

fn adjust_shadows_for_integrated_gpu(
    capabilities: Res<GraphicsCapabilities>,
    mut sun_query: Query<&mut CascadeShadowConfig, With<Sun>>,
    mut ran: Local<bool>,
) {
    if *ran || !capabilities.integrated_gpu {
        return;
    }
    *ran = true;

    for mut cascade_config in sun_query.iter_mut() {
        // Reduce to 2 cascades, shorter distance on integrated GPU
        *cascade_config = CascadeShadowConfigBuilder {
            num_cascades: 2,
            minimum_distance: 0.5,
            maximum_distance: 96.0,
            first_cascade_far_bound: 12.0,
            overlap_proportion: 0.25,
            ..default()
        }
        .build();
    }
}
pub mod atmosphere;
pub mod vegetation;
pub mod weather;
