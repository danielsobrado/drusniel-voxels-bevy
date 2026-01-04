use bevy::light::{CascadeShadowConfigBuilder, DirectionalLightShadowMap, VolumetricLight};
use bevy::prelude::*;
use bevy_water::*;

use crate::constants::WATER_LEVEL;

/// Settings that drive the sky and sun animation
#[derive(Resource)]
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
            exposure: 1.2,
            twilight_band: 0.6,
            night_floor: 0.08,
            fog_density: Vec2::new(0.0009, 0.0022),
            cycle_enabled: true,
        }
    }
}

#[derive(Component)]
pub struct Sun;

pub struct AtmospherePlugin;

impl Plugin for AtmospherePlugin {
    fn build(&self, app: &mut App) {
        app.insert_resource(AtmosphereSettings::default())
            // Soft initial sky tint
            .insert_resource(ClearColor(Color::srgba(0.50, 0.64, 0.84, 1.0)))
            .insert_resource(DirectionalLightShadowMap { size: 4096 })
            // bevy_water for dynamic ocean waves
            .insert_resource(WaterSettings {
                height: WATER_LEVEL as f32,
                amplitude: 0.5,
                clarity: 0.4,
                deep_color: Color::srgba(0.05, 0.15, 0.35, 0.95).into(),
                shallow_color: Color::srgba(0.2, 0.5, 0.7, 0.85).into(),
                edge_color: Color::srgba(0.6, 0.8, 0.9, 0.7).into(),
                ..default()
            })
            .add_plugins((WaterPlugin, ImageUtilsPlugin))
            .add_systems(
                Startup,
                (setup_atmosphere, seed_atmosphere.after(setup_atmosphere)),
            )
            .add_systems(Update, animate_atmosphere);
    }
}

fn setup_atmosphere(mut commands: Commands) {
    // Sun directional light with warmer color and tuned settings
    commands.spawn((
        DirectionalLight {
            color: Color::srgb(1.0, 0.95, 0.85),
            illuminance: 32_000.0,
            shadows_enabled: true,
            shadow_depth_bias: 0.02,
            shadow_normal_bias: 1.8,
            ..default()
        },
        Transform::from_translation(Vec3::ZERO)
            .looking_to(Vec3::new(-0.3, -1.0, -0.2).normalize(), Vec3::Y),
        CascadeShadowConfigBuilder {
            num_cascades: 4,
            minimum_distance: 1.0,
            maximum_distance: 256.0,
            first_cascade_far_bound: 15.0,
            overlap_proportion: 0.2,
            ..default()
        }
        .build(),
        VolumetricLight, // Enable god rays
        Sun,
    ));
}

fn seed_atmosphere(
    settings: Res<AtmosphereSettings>,
    mut sun_query: Query<(&mut Transform, &mut DirectionalLight), With<Sun>>,
    mut ambient: ResMut<AmbientLight>,
    mut clear_color: ResMut<ClearColor>,
) {
    if let Some(sample) = compute_atmosphere(&settings) {
        apply_atmosphere_sample(
            sample,
            &mut sun_query,
            &mut ambient,
            &mut clear_color,
        );
    }
}

fn animate_atmosphere(
    time: Res<Time>,
    mut settings: ResMut<AtmosphereSettings>,
    mut sun_query: Query<(&mut Transform, &mut DirectionalLight), With<Sun>>,
    mut ambient: ResMut<AmbientLight>,
    mut clear_color: ResMut<ClearColor>,
) {
    // Advance time if enabled
    if settings.cycle_enabled {
        settings.time = (settings.time + time.delta_secs() * settings.time_scale) % settings.day_length;
    }
    if let Some(sample) = compute_atmosphere(&settings) {
        apply_atmosphere_sample(
            sample,
            &mut sun_query,
            &mut ambient,
            &mut clear_color,
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
    let phase = settings.time / settings.day_length; // 0..1

    // Sun position: overhead at noon, below horizon at night for smooth twilight
    let theta = phase * std::f32::consts::TAU;
    let altitude = theta.sin(); // 1 at noon, -1 at midnight
    let azimuth = theta.cos(); // horizontal movement
    let sun_dir = Vec3::new(azimuth * 0.45, altitude, 0.35).normalize_or_zero();

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

    let sky_color = night_sky
        .lerp(zenith_day, daylight)
        .lerp(horizon_twilight, horizon_warmth)
        * settings.exposure;

    let sun_heat = Vec3::new(1.0, 0.78, 0.62).lerp(Vec3::new(1.0, 0.92, 0.84), daylight);
    let moon_heat = Vec3::new(0.8, 0.9, 1.0);
    let sun_tint = sun_heat.lerp(moon_heat, night_factor * 0.85);

    // Lighting strength based on altitude
    let sun_strength = lerp(1200.0, 45_000.0, daylight) * (1.0 + horizon_warmth * 0.2);
    let moon_strength = lerp(600.0, 50.0, daylight) * settings.night_floor;
    let ambient_strength =
        lerp(1200.0, 7000.0, daylight) * (1.0 + horizon_warmth * 0.15) * settings.exposure;
    let ambient_tint = Vec3::new(0.06, 0.10, 0.16)
        .lerp(Vec3::new(0.25, 0.36, 0.50), daylight)
        .lerp(Vec3::new(0.22, 0.24, 0.30), horizon_warmth * 0.5);

    Some(AtmosphereSample {
        sun_dir,
        sun_color: Color::linear_rgb(sun_tint.x, sun_tint.y, sun_tint.z),
        sun_illuminance: sun_strength + moon_strength,
        ambient_color: Color::linear_rgb(ambient_tint.x, ambient_tint.y, ambient_tint.z),
        ambient_brightness: ambient_strength,
        sky_color: Color::linear_rgb(sky_color.x, sky_color.y, sky_color.z),
    })
}

fn apply_atmosphere_sample(
    sample: AtmosphereSample,
    sun_query: &mut Query<(&mut Transform, &mut DirectionalLight), With<Sun>>,
    ambient: &mut ResMut<AmbientLight>,
    clear_color: &mut ResMut<ClearColor>,
) {
    if let Ok((mut transform, mut light)) = sun_query.single_mut() {
        transform.look_to(sample.sun_dir, Vec3::Y);
        light.illuminance = sample.sun_illuminance;
        light.color = sample.sun_color;
    }

    ambient.brightness = sample.ambient_brightness;
    ambient.color = sample.ambient_color;
    clear_color.0 = sample.sky_color;
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
