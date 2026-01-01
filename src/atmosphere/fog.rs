use bevy::prelude::*;
use bevy::light::{FogVolume, VolumetricFog, VolumetricLight};
use bevy::pbr::{DistanceFog, FogFalloff};
use crate::atmosphere::config::FogConfig;
use crate::environment::AtmosphereSettings;

pub struct FogPlugin;

impl Plugin for FogPlugin {
    fn build(&self, app: &mut App) {
        // Load fog config from file or use default
        let fog_config = load_fog_config().unwrap_or_else(|e| {
            warn!("Failed to load fog config: {}, using defaults", e);
            FogConfig::default()
        });
        
        app.insert_resource(fog_config)
            .add_systems(Startup, setup_fog)
            .add_systems(
                Update,
                (
                    update_fog_from_atmosphere,
                    follow_camera_fog_volume,
                ).chain(),
            );
    }
}

/// Marker for the global fog volume entity
#[derive(Component)]
pub struct GlobalFogVolume;

/// Marker for the main camera with fog
#[derive(Component)]
pub struct FogCamera;

/// Stores the current atmosphere state for fog calculations
#[derive(Resource, Default)]
pub struct AtmosphereSample {
    pub sun_dir: Vec3,
    pub sun_altitude: f32,
}

fn setup_fog(mut commands: Commands, config: Res<FogConfig>) {
    // Spawn global fog volume centered at origin
    // Will be repositioned to follow camera
    commands.spawn((
        GlobalFogVolume,
        FogVolume {
            fog_color: Color::WHITE,
            density_factor: config.volume.density,
            density_texture: None,
            density_texture_offset: Vec3::ZERO,
            absorption: config.volume.absorption,
            scattering: config.volume.scattering,
            scattering_asymmetry: config.volume.scattering_asymmetry,
            light_tint: Color::WHITE,
            light_intensity: 1.0,
        },
        Transform::from_scale(Vec3::splat(config.volume.size)),
    ));
    
    // Initialize atmosphere sample resource
    commands.insert_resource(AtmosphereSample::default());
}

/// Call this when spawning the main camera to add fog components
pub fn fog_camera_components(config: &FogConfig) -> impl Bundle {
    let colors = &config.colors.day;
    
    (
        FogCamera,
        // Screen-space distance fog
        DistanceFog {
            color: Color::srgba(colors.fog[0], colors.fog[1], colors.fog[2], colors.fog[3]),
            directional_light_color: Color::srgba(
                colors.directional[0],
                colors.directional[1],
                colors.directional[2],
                0.5,
            ),
            directional_light_exponent: 30.0,
            falloff: FogFalloff::Linear {
                start: config.distance.start,
                end: config.distance.end,
            },
        },
        // Volumetric fog processor
        VolumetricFog {
            ambient_color: Color::srgba(0.1, 0.1, 0.15, 1.0),
            ambient_intensity: config.volumetric.ambient_intensity,
            step_count: config.volumetric.step_count,
            jitter: config.volumetric.jitter,
            ..default()
        },
    )
}

/// Call this when spawning the sun to enable volumetric light
pub fn sun_volumetric_components() -> VolumetricLight {
    VolumetricLight
}

/// Update fog colors based on time-of-day from AtmosphereSettings
fn update_fog_from_atmosphere(
    atmosphere_settings: Option<Res<AtmosphereSettings>>,
    config: Res<FogConfig>,
    mut atmosphere_sample: ResMut<AtmosphereSample>,
    mut fog_query: Query<&mut DistanceFog, With<FogCamera>>,
    mut volume_query: Query<&mut FogVolume, With<GlobalFogVolume>>,
) {
    let Some(atmo_settings) = atmosphere_settings else { return };
    
    // Calculate sun position from atmosphere settings
    let phase = atmo_settings.time / atmo_settings.day_length;
    let theta = phase * std::f32::consts::TAU;
    let altitude = theta.sin(); // 1 at noon, -1 at midnight
    let azimuth = theta.cos();
    let sun_dir = Vec3::new(azimuth * 0.45, altitude, 0.35).normalize_or_zero();
    
    // Update atmosphere sample
    atmosphere_sample.sun_dir = sun_dir;
    atmosphere_sample.sun_altitude = altitude;
    
    // Compute blend factors from sun altitude
    let daylight = smoothstep(-0.1, 0.25, altitude);
    let twilight = twilight_factor(altitude, 0.15);
    let night = (1.0 - daylight).max(0.05);
    
    // Blend between presets
    let day = &config.colors.day;
    let twi = &config.colors.twilight;
    let ngt = &config.colors.night;
    
    // Interpolate fog color
    let fog_color = lerp_color4(
        lerp_color4(ngt.fog, day.fog, daylight),
        twi.fog,
        twilight,
    );
    
    let directional_color = lerp_color3(
        lerp_color3(ngt.directional, day.directional, daylight),
        twi.directional,
        twilight,
    );
    
    // Density increases at night/twilight
    let density_mult = 1.0 + twilight * 0.5 + night * 0.3;
    
    // Update distance fog
    for mut fog in fog_query.iter_mut() {
        fog.color = Color::srgba(fog_color[0], fog_color[1], fog_color[2], fog_color[3]);
        fog.directional_light_color = Color::srgba(
            directional_color[0],
            directional_color[1],
            directional_color[2],
            0.5 * daylight + 0.2 * night, // Less directional glow at night
        );
        fog.directional_light_exponent = 30.0 + twilight * 20.0; // Tighter during sunset
    }
    
    // Update volumetric fog volume
    for mut volume in volume_query.iter_mut() {
        volume.density_factor = config.volume.density * density_mult;
        volume.fog_color = Color::srgba(fog_color[0], fog_color[1], fog_color[2], 1.0);
    }
}

/// Keep fog volume centered on camera
fn follow_camera_fog_volume(
    camera_query: Query<&Transform, With<FogCamera>>,
    mut volume_query: Query<&mut Transform, (With<GlobalFogVolume>, Without<FogCamera>)>,
) {
    let Ok(camera_tf) = camera_query.single() else { return };
    
    for mut tf in volume_query.iter_mut() {
        // Center volume on camera XZ, keep Y centered on world
        tf.translation.x = camera_tf.translation.x;
        tf.translation.z = camera_tf.translation.z;
        // Keep Y at half the volume height so it covers above and below
        tf.translation.y = tf.scale.y * 0.5;
    }
}

// Helpers

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn twilight_factor(altitude: f32, band: f32) -> f32 {
    let centered = (altitude.abs() / band).min(1.0);
    (1.0 - centered).powi(2) * (1.0 - altitude.abs().min(1.0))
}

fn lerp_color3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

fn lerp_color4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

/// Load fog configuration from YAML file
fn load_fog_config() -> Result<FogConfig, Box<dyn std::error::Error>> {
    #[derive(serde::Deserialize)]
    struct FogConfigFile {
        fog: FogConfig,
    }
    
    let config_str = std::fs::read_to_string("assets/config/fog.yaml")?;
    let config_file: FogConfigFile = serde_yaml::from_str(&config_str)?;
    Ok(config_file.fog)
}

