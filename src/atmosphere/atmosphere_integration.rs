//! Atmospheric rendering integration using Bevy's built-in atmosphere feature.
//!
//! Bevy 0.17+ has native procedural atmosphere support with two rendering modes:
//! - Raymarched: Better quality for cinematic scenes, flight simulators, space views
//! - LookupTexture (default): Faster, ideal for ground-level outdoor scenes

use bevy::prelude::*;
use bevy::pbr::{Atmosphere, AtmosphereSettings};
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
    cameras: Query<Entity, (With<Camera3d>, Without<AtmosphereCamera>)>,
) {
    for entity in cameras.iter() {
        let mut entity_commands = commands.entity(entity);

        // Build atmosphere from config
        let mut atmosphere = Atmosphere::EARTH;
        
        if let Some(rayleigh) = config.rayleigh_scattering {
            atmosphere.rayleigh_scattering = Vec3::from_array(rayleigh);
        }
        if let Some(scale) = config.rayleigh_scale_height {
            // Convert scale height to density exp scale (1/scale_height in km^-1)
            atmosphere.rayleigh_density_exp_scale = -1.0 / (scale / 1000.0);
        }
        if let Some(mie) = config.mie_scattering {
            atmosphere.mie_scattering = mie;
        }
        if let Some(scale) = config.mie_scale_height {
            // Convert scale height to density exp scale
            atmosphere.mie_density_exp_scale = -1.0 / (scale / 1000.0);
        }
        if let Some(asymmetry) = config.mie_asymmetry {
            atmosphere.mie_asymmetry = asymmetry;
        }
        if let Some(ozone) = config.ozone_absorption {
            atmosphere.ozone_absorption = Vec3::from_array(ozone);
        }
        if let Some(altitude) = config.ozone_center_altitude {
            atmosphere.ozone_layer_altitude = altitude / 1000.0; // Convert to km
        }
        if let Some(width) = config.ozone_width {
            atmosphere.ozone_layer_width = width / 1000.0; // Convert to km
        }
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
        entity_commands.insert((
            AtmosphereCamera,
            atmosphere,
        ));

        // Add atmosphere settings based on config
        let settings = AtmosphereSettings {
            sky_max_samples: config.sky_max_samples,
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
