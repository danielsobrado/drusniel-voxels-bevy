use bevy::prelude::*;
use serde::Deserialize;

/// Enhanced water configuration with Gerstner waves, foam, and caustics
#[derive(Resource, Deserialize, Clone)]
pub struct WaterConfig {
    pub gerstner: GerstnerConfig,
    pub foam: FoamConfig,
    pub caustics: CausticsConfig,
    pub visual: WaterVisualConfig,
}

#[derive(Deserialize, Clone)]
pub struct GerstnerConfig {
    pub enabled: bool,
    pub amplitude: f32,
    pub wave_scale: f32,
    pub wave_speed: f32,
    pub wave_count: u32,
}

#[derive(Deserialize, Clone)]
pub struct FoamConfig {
    pub enabled: bool,
    pub color: [f32; 3],
    pub intensity: f32,
    pub scale: f32,
    pub persistence: f32,
    pub shore_foam: bool,
    pub wave_crest_foam: bool,
}

#[derive(Deserialize, Clone)]
pub struct CausticsConfig {
    pub enabled: bool,
    pub intensity: f32,
    pub scale: f32,
    pub speed: f32,
    pub max_depth: f32,
}

#[derive(Deserialize, Clone)]
pub struct WaterVisualConfig {
    pub deep_color: [f32; 4],
    pub shallow_color: [f32; 4],
    pub clarity: f32,
    pub reflectivity: f32,
    pub fresnel_power: f32,
}

impl Default for WaterConfig {
    fn default() -> Self {
        Self {
            gerstner: GerstnerConfig {
                enabled: true,
                amplitude: 0.5,
                wave_scale: 1.0,
                wave_speed: 1.0,
                wave_count: 4,
            },
            foam: FoamConfig {
                enabled: true,
                color: [1.0, 1.0, 1.0],
                intensity: 1.0,
                scale: 1.0,
                persistence: 0.9,
                shore_foam: true,
                wave_crest_foam: true,
            },
            caustics: CausticsConfig {
                enabled: true,
                intensity: 0.5,
                scale: 1.0,
                speed: 1.0,
                max_depth: 10.0,
            },
            visual: WaterVisualConfig {
                deep_color: [0.0, 0.1, 0.2, 0.9],
                shallow_color: [0.0, 0.3, 0.4, 0.7],
                clarity: 0.3,
                reflectivity: 0.8,
                fresnel_power: 5.0,
            },
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

pub struct EnhancedWaterPlugin;

impl Plugin for EnhancedWaterPlugin {
    fn build(&self, app: &mut App) {
        let config = load_water_config().unwrap_or_else(|e| {
            warn!("Failed to load water config: {}, using defaults", e);
            WaterConfig::default()
        });

        app.insert_resource(config)
            .add_systems(Update, update_water_uniforms);
    }
}

/// Uniform buffer data sent to water shaders
#[derive(Clone, Copy)]
#[repr(C)]
pub struct WaterUniforms {
    pub time: f32,
    pub amplitude: f32,
    pub wave_scale: f32,
    pub foam_intensity: f32,
    pub caustic_intensity: f32,
    pub caustic_scale: f32,
    pub clarity: f32,
    pub fresnel_power: f32,
    pub deep_color: [f32; 4],
    pub shallow_color: [f32; 4],
    pub foam_color: [f32; 4],
}

fn update_water_uniforms(
    time: Res<Time>,
    config: Res<WaterConfig>,
    // This would update shader uniforms in a real implementation
) {
    let _uniforms = WaterUniforms {
        time: time.elapsed_secs(),
        amplitude: config.gerstner.amplitude,
        wave_scale: config.gerstner.wave_scale,
        foam_intensity: if config.foam.enabled { config.foam.intensity } else { 0.0 },
        caustic_intensity: if config.caustics.enabled { config.caustics.intensity } else { 0.0 },
        caustic_scale: config.caustics.scale,
        clarity: config.visual.clarity,
        fresnel_power: config.visual.fresnel_power,
        deep_color: config.visual.deep_color,
        shallow_color: config.visual.shallow_color,
        foam_color: [config.foam.color[0], config.foam.color[1], config.foam.color[2], 1.0],
    };
    
    // Uniform buffer would be updated here
}
