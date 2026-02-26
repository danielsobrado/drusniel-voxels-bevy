//! Atmospheric rendering integration using Bevy's built-in atmosphere feature.
//!
//! Bevy 0.17+ has native procedural atmosphere support with two rendering modes:
//! - Raymarched: Better quality for cinematic scenes, flight simulators, space views
//! - LookupTexture (default): Faster, ideal for ground-level outdoor scenes

use bevy::prelude::*;
use bevy::pbr::{Atmosphere, AtmosphereMode, AtmosphereSettings, ScatteringMedium};
use serde::Deserialize;

/// Configuration for atmospheric rendering
#[derive(Resource, Deserialize, Clone)]
pub struct AtmosphereConfig {
    pub enabled: bool,
    pub rendering_mode: String, // "raymarched" or "lookup"
    pub sky_max_samples: u32,
    
    // Rayleigh scattering
    pub rayleigh_scattering: Option<[f32; 3]>,
    pub rayleigh_scale_height: Option<f32>,
    
    // Mie scattering
    pub mie_scattering: Option<f32>,
    pub mie_scale_height: Option<f32>,
    pub mie_asymmetry: Option<f32>,
    
    // Ozone
    pub ozone_absorption: Option<[f32; 3]>,
    pub ozone_center_altitude: Option<f32>,
    pub ozone_width: Option<f32>,
    
    // Sun
    pub sun_intensity: f32,
    pub sun_angular_radius: Option<f32>,
    
    // Planet
    pub ground_albedo: Option<[f32; 3]>,
    pub bottom_radius: Option<f32>,
    pub top_radius: Option<f32>,
}

impl Default for AtmosphereConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            rendering_mode: "lookup".to_string(),
            sky_max_samples: 32,
            rayleigh_scattering: None,
            rayleigh_scale_height: None,
            mie_scattering: None,
            mie_scale_height: None,
            mie_asymmetry: None,
            ozone_absorption: None,
            ozone_center_altitude: None,
            ozone_width: None,
            sun_intensity: 22.0,
            sun_angular_radius: None,
            ground_albedo: None,
            bottom_radius: None,
            top_radius: None,
        }
    }
}

/// Marker component for cameras with atmosphere rendering enabled
#[derive(Component)]
pub struct AtmosphereCamera;

pub struct AtmosphereIntegrationPlugin;

impl Plugin for AtmosphereIntegrationPlugin {
    fn build(&self, app: &mut App) {
        let config = load_atmosphere_config().unwrap_or_else(|e| {
            warn!("Failed to load atmosphere config: {}, using defaults", e);
            AtmosphereConfig::default()
        });

        if !config.enabled {
            info!("Atmospheric rendering disabled via config");
            return;
        }

        app.insert_resource(config)
            .add_systems(PostStartup, configure_atmosphere_cameras);

        info!("Bevy built-in atmosphere initialized");
    }
}

pub fn load_atmosphere_config() -> Result<AtmosphereConfig, Box<dyn std::error::Error>> {
    #[derive(Deserialize)]
    struct AtmosphereConfigFile {
        atmosphere: AtmosphereConfig,
    }

    let config_str = std::fs::read_to_string("assets/config/atmosphere.yaml")?;
    let config_file: AtmosphereConfigFile = serde_yaml::from_str(&config_str)?;
    Ok(config_file.atmosphere)
}

fn configure_atmosphere_cameras(
    mut commands: Commands,
    config: Res<AtmosphereConfig>,
    mut scattering_mediums: ResMut<Assets<ScatteringMedium>>,
    cameras: Query<Entity, (With<Camera3d>, Without<AtmosphereCamera>)>,
) {
    for entity in cameras.iter() {
        let mut entity_commands = commands.entity(entity);

        // Build an earthlike atmosphere using a configurable scattering medium asset.
        let medium = scattering_mediums.add(ScatteringMedium::earthlike(256, 256));
        let mut atmosphere = Atmosphere::earthlike(medium);
        if let Some(albedo) = config.ground_albedo {
            atmosphere.ground_albedo = Vec3::from_array(albedo);
        }
        if let Some(radius) = config.bottom_radius {
            atmosphere.bottom_radius = radius;
        }
        if let Some(radius) = config.top_radius {
            atmosphere.top_radius = radius;
        }

        // Add atmosphere component
        entity_commands.insert((AtmosphereCamera, atmosphere));

        // Add atmosphere settings based on config
        let rendering_method = if config.rendering_mode.eq_ignore_ascii_case("raymarched") {
            AtmosphereMode::Raymarched
        } else {
            AtmosphereMode::LookupTexture
        };
        let settings = AtmosphereSettings {
            sky_max_samples: config.sky_max_samples,
            rendering_method,
            ..default()
        };
        entity_commands.insert(settings);

        info!("Atmosphere rendering enabled on camera {:?}", entity);
    }
}

/// Helper to update atmosphere settings at runtime
pub fn update_atmosphere_settings(
    commands: &mut Commands,
    entity: Entity,
    sky_max_samples: Option<u32>,
) {
    let mut entity_commands = commands.entity(entity);

    if let Some(samples) = sky_max_samples {
        entity_commands.insert(AtmosphereSettings {
            sky_max_samples: samples,
            ..default()
        });
    }
}
