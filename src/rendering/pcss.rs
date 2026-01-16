use bevy::prelude::*;
use serde::Deserialize;

/// PCSS (Percentage-Closer Soft Shadows) Configuration
#[derive(Resource, Deserialize, Clone)]
pub struct PcssConfig {
    pub enabled: bool,
    pub light_size: f32,
    pub blocker_search_samples: u32,
    pub pcf_samples: u32,
    pub min_penumbra_size: f32,
    pub max_penumbra_size: f32,
}

impl Default for PcssConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            light_size: 10.0,
            blocker_search_samples: 16,
            pcf_samples: 32,
            min_penumbra_size: 0.001,
            max_penumbra_size: 0.05,
        }
    }
}

/// Component to mark lights that use PCSS
#[derive(Component, Clone)]
pub struct PcssShadows {
    pub light_size: f32,
}

impl Default for PcssShadows {
    fn default() -> Self {
        Self {
            light_size: 10.0,
        }
    }
}

pub struct PcssPlugin;

impl Plugin for PcssPlugin {
    fn build(&self, app: &mut App) {
        let config = load_pcss_config().unwrap_or_else(|e| {
            warn!("Failed to load PCSS config: {}, using defaults", e);
            PcssConfig::default()
        });

        app.insert_resource(config)
            .add_systems(PostStartup, configure_directional_lights);
    }
}

pub fn load_pcss_config() -> Result<PcssConfig, Box<dyn std::error::Error>> {
    #[derive(Deserialize)]
    struct PcssConfigFile {
        pcss: PcssConfig,
    }

    let config_str = std::fs::read_to_string("assets/config/pcss.yaml")?;
    let config_file: PcssConfigFile = serde_yaml::from_str(&config_str)?;
    Ok(config_file.pcss)
}

fn configure_directional_lights(
    mut commands: Commands,
    config: Res<PcssConfig>,
    lights: Query<Entity, (With<DirectionalLight>, Without<PcssShadows>)>,
) {
    if !config.enabled {
        return;
    }

    for entity in lights.iter() {
        let pcss = PcssShadows {
            light_size: config.light_size,
        };
        commands.entity(entity).insert(pcss);
        info!("PCSS enabled on directional light {:?}", entity);
    }
}

/// Helper to enable/disable PCSS on specific lights
pub fn toggle_pcss_light(
    commands: &mut Commands,
    entity: Entity,
    enable: bool,
    light_size: f32,
) {
    if enable {
        commands.entity(entity).insert(PcssShadows { light_size });
    } else {
        commands.entity(entity).remove::<PcssShadows>();
    }
}
