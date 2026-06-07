use bevy::prelude::*;
use serde::Deserialize;

/// PCSS configuration kept for save/config compatibility.
///
/// Bevy's built-in PBR shadow shader is still the active shadow path. This
/// plugin intentionally does not tag lights or claim contact-hardening PCSS
/// until a real shader integration replaces Bevy's shadow sampling.
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
            enabled: false,
            light_size: 10.0,
            blocker_search_samples: 16,
            pcf_samples: 32,
            min_penumbra_size: 0.001,
            max_penumbra_size: 0.05,
        }
    }
}

pub struct PcssPlugin;

impl Plugin for PcssPlugin {
    fn build(&self, app: &mut App) {
        let mut config = load_pcss_config().unwrap_or_else(|e| {
            warn!("Failed to load PCSS config: {}, using defaults", e);
            PcssConfig::default()
        });

        if config.enabled {
            warn!(
                "PCSS config is enabled, but the custom PCSS shader path is not integrated; using built-in Bevy shadows"
            );
            config.enabled = false;
        }

        app.insert_resource(config);
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
