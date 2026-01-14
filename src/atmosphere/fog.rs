use bevy::prelude::*;
use bevy::light::{FogVolume, VolumetricFog, VolumetricLight};
use bevy::pbr::{DistanceFog, FogFalloff};
use crate::atmosphere::config::FogConfig;
use crate::environment::AtmosphereSettings;

pub struct FogPlugin;

const BASE_FOG_DENSITY: f32 = 0.006; // Fallback density when visibility-based calc fails.
const BASE_PRESET_DENSITY: f32 = 0.0009; // "Balanced" preset baseline for scaling.
const VISIBILITY_DENSITY_SCALE: f32 = 0.3; // Moderate visibility fog
const VOLUME_DENSITY_SCALE: f32 = 0.5; // Volumetric density scale (lower = brighter scene)
const MIN_VOLUME_DENSITY: f32 = 0.005; // Very low minimum for subtle god rays
const MAX_VOLUME_DENSITY: f32 = 0.08; // Cap to prevent over-dark scenes

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
                    sync_fog_toggles,
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

fn spawn_global_fog_volume(commands: &mut Commands, config: &FogConfig) {
    commands.spawn((
        Name::new("GlobalFogVolume"),
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
        Visibility::Visible,
    ));
}

fn setup_fog(mut commands: Commands, config: Res<FogConfig>) {
    if config.volumetric.enabled {
        // Spawn global fog volume centered at origin
        // Will be repositioned to follow camera
        spawn_global_fog_volume(&mut commands, &config);
    }
    
    // Initialize atmosphere sample resource
    commands.insert_resource(AtmosphereSample::default());
}

/// Call this when spawning the main camera to add fog components
pub fn fog_camera_components(config: &FogConfig) -> impl Bundle {
    (FogCamera, distance_fog_component(config))
}

fn distance_fog_component(config: &FogConfig) -> DistanceFog {
    let colors = &config.colors.day;
    let base_density = visibility_density(config.distance.visibility);

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
        // Exponential squared gives a softer, more natural haze.
        falloff: FogFalloff::ExponentialSquared {
            density: base_density,
        },
    }
}

/// Call this when spawning the sun to enable volumetric light
pub fn sun_volumetric_components() -> VolumetricLight {
    VolumetricLight
}

fn volumetric_fog_component(config: &FogConfig) -> VolumetricFog {
    VolumetricFog {
        step_count: config.volumetric.step_count,
        jitter: config.volumetric.jitter,
        ambient_intensity: config.volumetric.ambient_intensity,
        ambient_color: Color::WHITE,
    }
}

fn sync_fog_toggles(
    mut commands: Commands,
    config: Res<FogConfig>,
    camera_query: Query<(Entity, Option<&DistanceFog>, Option<&VolumetricFog>), With<FogCamera>>,
    volume_query: Query<Entity, With<GlobalFogVolume>>,
) {
    if !config.is_changed() {
        return;
    }

    for (entity, distance_fog, volumetric_fog) in camera_query.iter() {
        let mut camera = commands.entity(entity);

        if config.distance.enabled {
            if distance_fog.is_none() {
                camera.insert(distance_fog_component(&config));
            }
        } else if distance_fog.is_some() {
            camera.remove::<DistanceFog>();
        }

        if config.volumetric.enabled {
            if volumetric_fog.is_none() {
                camera.insert(volumetric_fog_component(&config));
            }
        } else if volumetric_fog.is_some() {
            camera.remove::<VolumetricFog>();
        }
    }

    if config.volumetric.enabled {
        if volume_query.iter().next().is_none() {
            spawn_global_fog_volume(&mut commands, &config);
        }
    } else {
        for entity in volume_query.iter() {
            commands.entity(entity).despawn();
        }
    }
}

/// Update fog colors based on time-of-day from AtmosphereSettings
fn update_fog_from_atmosphere(
    atmosphere_settings: Option<Res<AtmosphereSettings>>,
    config: Res<FogConfig>,
    mut atmosphere_sample: ResMut<AtmosphereSample>,
    ambient: Res<AmbientLight>,
    mut fog_query: Query<&mut DistanceFog, With<FogCamera>>,
    mut volumetric_query: Query<&mut VolumetricFog, With<FogCamera>>,
    mut volume_query: Query<&mut FogVolume, With<GlobalFogVolume>>,
) {
    let Some(atmo_settings) = atmosphere_settings else { return };

    // Get Mie settings from atmosphere (connected to menu settings)
    let mie_direction = atmo_settings.mie_direction;
    let mie_strength = atmo_settings.mie.x; // Use X component as overall strength
    
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
    let (daylight, twilight, night) = if atmo_settings.cycle_enabled {
        let daylight = smoothstep(-0.1, 0.25, altitude);
        let twilight = twilight_factor(altitude, 0.15);
        let night = (1.0 - daylight).max(0.05);
        (daylight, twilight, night)
    } else {
        (1.0, 0.0, 0.0)
    };

    let preset_density = lerp(atmo_settings.fog_density.y, atmo_settings.fog_density.x, daylight)
        .max(0.0001);

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
    let preset_scale = (preset_density / BASE_PRESET_DENSITY).clamp(0.5, 2.5);
    let base_density = visibility_density(config.distance.visibility);
    let fog_density = base_density * preset_scale * density_mult;
    
    let ambient_intensity = (ambient.brightness / 6000.0).clamp(0.02, 0.22)
        .max(config.volumetric.ambient_intensity);

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
        fog.falloff = FogFalloff::ExponentialSquared { density: fog_density };
    }

    // Update volumetric fog camera settings so night/dim changes take effect.
    for mut volumetric in volumetric_query.iter_mut() {
        volumetric.ambient_color = ambient.color;
        volumetric.ambient_intensity = ambient_intensity;
        volumetric.step_count = config.volumetric.step_count;
        volumetric.jitter = config.volumetric.jitter;
    }
    
    // Update volumetric fog volume
    for mut volume in volume_query.iter_mut() {
        volume.density_factor = (config.volume.density * density_mult * VOLUME_DENSITY_SCALE * preset_scale)
            .clamp(MIN_VOLUME_DENSITY, MAX_VOLUME_DENSITY);
        volume.fog_color = Color::srgba(fog_color[0], fog_color[1], fog_color[2], 1.0);
        volume.light_tint = Color::srgba(
            directional_color[0],
            directional_color[1],
            directional_color[2],
            1.0,
        );
        volume.light_intensity = lerp(2.0, 5.0, daylight) * (1.0 + twilight * 0.5);
        // Connect Mie settings to fog scattering
        // mie_strength (0.0035-0.0075) scaled up to have visible impact
        let mie_factor = (mie_strength / 0.005).clamp(0.5, 2.0); // Normalize around 1.0
        volume.scattering = (config.volume.scattering * mie_factor).clamp(0.3, 1.0);
        // mie_direction controls forward scattering asymmetry
        // Lower = more visible from all angles, higher = only toward sun
        volume.scattering_asymmetry = config.volume.scattering_asymmetry * mie_direction;
    }
}

/// Keep fog volume centered on camera
fn follow_camera_fog_volume(
    config: Res<FogConfig>,
    camera_query: Query<&Transform, With<FogCamera>>,
    mut volume_query: Query<&mut Transform, (With<GlobalFogVolume>, Without<FogCamera>)>,
) {
    let Ok(camera_tf) = camera_query.single() else { return };
    
    for mut tf in volume_query.iter_mut() {
        // Center volume on the camera so we're always inside the fog.
        tf.translation.x = camera_tf.translation.x;
        tf.translation.y = camera_tf.translation.y;
        tf.translation.z = camera_tf.translation.z;

        if config.is_changed() {
            tf.scale = Vec3::splat(config.volume.size);
        }
    }
}

// Helpers

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
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

fn visibility_density(visibility: f32) -> f32 {
    let visibility = visibility.max(1.0);
    let density = match FogFalloff::from_visibility_squared(visibility) {
        FogFalloff::ExponentialSquared { density } => density,
        _ => BASE_FOG_DENSITY,
    };
    density * VISIBILITY_DENSITY_SCALE
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
