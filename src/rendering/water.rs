use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::prelude::*;
use bevy::shader::Shader;
use serde::Deserialize;

/// Enhanced water configuration with Gerstner waves, foam, caustics, reflections, and more
#[derive(Resource, Deserialize, Clone)]
pub struct WaterConfig {
    pub gerstner: GerstnerConfig,
    pub foam: FoamConfig,
    pub caustics: CausticsConfig,
    pub visual: WaterVisualConfig,
    #[serde(default)]
    pub detail_normals: DetailNormalConfig,
    #[serde(default)]
    pub reflections: ReflectionConfig,
    #[serde(default)]
    pub refraction: RefractionConfig,
    #[serde(default)]
    pub displacement: DisplacementConfig,
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

#[derive(Deserialize, Clone)]
pub struct DetailNormalConfig {
    pub enabled: bool,
    pub scale_a: f32,
    pub scale_b: f32,
    pub intensity: f32,
    pub scroll_speed: f32,
}

impl Default for DetailNormalConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            scale_a: 0.3,
            scale_b: 0.17,
            intensity: 0.8,
            scroll_speed: 0.04,
        }
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
            detail_normals: DetailNormalConfig::default(),
            reflections: ReflectionConfig::default(),
            refraction: RefractionConfig::default(),
            displacement: DisplacementConfig::default(),
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

// Shader handles for custom water modules (registered as imports via load_internal_asset!)
pub const GERSTNER_WAVES_HANDLE: Handle<Shader> =
    uuid_handle!("a1b2c3d4-e5f6-7890-abcd-ef0123456789");
pub const WATER_FOAM_HANDLE: Handle<Shader> =
    uuid_handle!("b2c3d4e5-f6a7-8901-bcde-f01234567890");
pub const WATER_CAUSTICS_HANDLE: Handle<Shader> =
    uuid_handle!("c3d4e5f6-a7b8-9012-cdef-012345678901");
pub const WATER_DETAIL_NORMALS_HANDLE: Handle<Shader> =
    uuid_handle!("d4e5f6a7-b8c9-0123-defa-123456789012");
pub const WATER_DISPLACEMENT_COMPUTE_HANDLE: Handle<Shader> =
    uuid_handle!("e5f6a7b8-c9d0-1234-efab-234567890123");

pub struct EnhancedWaterPlugin;

impl Plugin for EnhancedWaterPlugin {
    fn build(&self, app: &mut App) {
        // Register custom water shader modules so they can be #imported by water_fragment.wgsl
        load_internal_asset!(
            app,
            GERSTNER_WAVES_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/gerstner_waves.wgsl"),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            WATER_FOAM_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/water_foam.wgsl"),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            WATER_CAUSTICS_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/water_caustics.wgsl"),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            WATER_DETAIL_NORMALS_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/water_detail_normals.wgsl"),
            Shader::from_wgsl
        );
        load_internal_asset!(
            app,
            WATER_DISPLACEMENT_COMPUTE_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/water_displacement_compute.wgsl"),
            Shader::from_wgsl
        );

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
