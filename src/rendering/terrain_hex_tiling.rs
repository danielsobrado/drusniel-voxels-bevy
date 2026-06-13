use bevy::prelude::*;
use serde::{Deserialize, Serialize};

use crate::bench::BenchRenderToggles;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::triplanar_material::HexTilingUniform;

pub const TERRAIN_TEXTURING_CONFIG_PATH: &str = "assets/config/terrain_texturing.yaml";

#[derive(Resource, Clone, Debug, Deserialize)]
pub struct TerrainTexturingConfig {
    #[serde(default)]
    pub hex_tiling: HexTilingConfig,
}

#[derive(Clone, Debug, Deserialize)]
pub struct HexTilingConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub normal_enabled: bool,
    #[serde(default = "default_rotation_strength")]
    pub rotation_strength: f32,
    #[serde(default = "default_color_border_contrast")]
    pub color_border_contrast: f32,
    #[serde(default = "default_normal_border_contrast")]
    pub normal_border_contrast: f32,
    #[serde(default = "default_near_distance")]
    pub near_distance: f32,
    #[serde(default = "default_mid_distance")]
    pub mid_distance: f32,
    #[serde(default = "default_true")]
    pub disable_on_integrated_gpu: bool,
    #[serde(default = "default_true")]
    pub disable_on_low_quality: bool,
}

fn default_rotation_strength() -> f32 {
    1.0
}

fn default_color_border_contrast() -> f32 {
    0.55
}

fn default_normal_border_contrast() -> f32 {
    0.50
}

fn default_near_distance() -> f32 {
    96.0
}

fn default_mid_distance() -> f32 {
    160.0
}

fn default_true() -> bool {
    true
}

impl Default for HexTilingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            normal_enabled: false,
            rotation_strength: default_rotation_strength(),
            color_border_contrast: default_color_border_contrast(),
            normal_border_contrast: default_normal_border_contrast(),
            near_distance: default_near_distance(),
            mid_distance: default_mid_distance(),
            disable_on_integrated_gpu: true,
            disable_on_low_quality: true,
        }
    }
}

impl Default for TerrainTexturingConfig {
    fn default() -> Self {
        Self {
            hex_tiling: HexTilingConfig::default(),
        }
    }
}

impl TerrainTexturingConfig {
    pub fn load_or_default() -> Self {
        match Self::load(TERRAIN_TEXTURING_CONFIG_PATH) {
            Ok(config) => {
                info!("Loaded terrain texturing config from {TERRAIN_TEXTURING_CONFIG_PATH}");
                config
            }
            Err(error) => {
                warn!(
                    "Failed to load terrain texturing config from {TERRAIN_TEXTURING_CONFIG_PATH}: {error}; using defaults"
                );
                Self::default()
            }
        }
    }

    pub fn load(path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        #[derive(Deserialize)]
        struct TerrainTexturingConfigFile {
            terrain_texturing: TerrainTexturingConfig,
        }

        let file = std::fs::File::open(path)?;
        let reader = std::io::BufReader::new(file);
        let config_file: TerrainTexturingConfigFile = serde_yaml::from_reader(reader)?;
        Ok(config_file.terrain_texturing)
    }
}

pub fn hex_tiling_env_override() -> Option<bool> {
    parse_hex_tiling_env_flag("VOXEL_TERRAIN_HEX_TILING")
}

pub fn hex_tiling_normal_env_override() -> Option<bool> {
    parse_hex_tiling_env_flag("VOXEL_TERRAIN_HEX_TILING_NORMAL")
}

fn parse_hex_tiling_env_flag(name: &str) -> Option<bool> {
    let Ok(value) = std::env::var(name) else {
        return None;
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Some(true),
        "0" | "false" | "no" | "off" => Some(false),
        _ => None,
    }
}

pub fn effective_hex_tiling_enabled(
    config: &TerrainTexturingConfig,
    capabilities: Option<&GraphicsCapabilities>,
    quality_preset: RenderQualityPreset,
    bench_toggles: Option<&BenchRenderToggles>,
) -> bool {
    let wants_enabled = bench_toggles
        .and_then(|toggles| toggles.terrain_hex_tiling)
        .or_else(hex_tiling_env_override)
        .unwrap_or(config.hex_tiling.enabled);
    if !wants_enabled {
        return false;
    }

    if config.hex_tiling.disable_on_integrated_gpu
        && capabilities.is_some_and(|capabilities| capabilities.integrated_gpu)
    {
        return false;
    }

    if config.hex_tiling.disable_on_low_quality
        && matches!(
            quality_preset,
            RenderQualityPreset::Low | RenderQualityPreset::Performance100
        )
    {
        return false;
    }

    true
}

pub fn effective_hex_tiling_normal_enabled(
    config: &TerrainTexturingConfig,
    capabilities: Option<&GraphicsCapabilities>,
    quality_preset: RenderQualityPreset,
    bench_toggles: Option<&BenchRenderToggles>,
) -> bool {
    if !effective_hex_tiling_enabled(config, capabilities, quality_preset, bench_toggles) {
        return false;
    }

    bench_toggles
        .and_then(|toggles| toggles.terrain_hex_tiling_normal)
        .or_else(hex_tiling_normal_env_override)
        .unwrap_or(config.hex_tiling.normal_enabled)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainTexturingEditorPayload {
    pub configured: TerrainTexturingConfiguredState,
    pub effective: TerrainTexturingEffectiveState,
    pub gated_by_integrated_gpu: bool,
    pub gated_by_low_quality: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainTexturingConfiguredState {
    pub enabled: bool,
    pub normal_enabled: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainTexturingEffectiveState {
    pub enabled: bool,
    pub normal_enabled: bool,
}

pub fn terrain_texturing_editor_payload(
    config: &TerrainTexturingConfig,
    capabilities: Option<&GraphicsCapabilities>,
    quality_preset: RenderQualityPreset,
) -> TerrainTexturingEditorPayload {
    let configured = TerrainTexturingConfiguredState {
        enabled: config.hex_tiling.enabled,
        normal_enabled: config.hex_tiling.normal_enabled,
    };
    let effective = TerrainTexturingEffectiveState {
        enabled: effective_hex_tiling_enabled(config, capabilities, quality_preset, None),
        normal_enabled: effective_hex_tiling_normal_enabled(
            config,
            capabilities,
            quality_preset,
            None,
        ),
    };
    let wants_enabled = configured.enabled;
    let gated_by_integrated_gpu = wants_enabled
        && config.hex_tiling.disable_on_integrated_gpu
        && capabilities.is_some_and(|capabilities| capabilities.integrated_gpu);
    let gated_by_low_quality = wants_enabled
        && config.hex_tiling.disable_on_low_quality
        && matches!(
            quality_preset,
            RenderQualityPreset::Low | RenderQualityPreset::Performance100
        );

    TerrainTexturingEditorPayload {
        configured,
        effective,
        gated_by_integrated_gpu,
        gated_by_low_quality,
    }
}

pub fn hex_tiling_uniform_from_config(
    config: &TerrainTexturingConfig,
    enabled: bool,
    normal_enabled: bool,
) -> HexTilingUniform {
    HexTilingUniform {
        enabled: u32::from(enabled),
        normal_enabled: u32::from(normal_enabled && enabled),
        rotation_strength: config.hex_tiling.rotation_strength,
        color_border_contrast: config.hex_tiling.color_border_contrast,
        normal_border_contrast: config.hex_tiling.normal_border_contrast,
        near_distance: config.hex_tiling.near_distance,
        mid_distance: config.hex_tiling.mid_distance,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_has_hex_tiling_disabled() {
        let config = TerrainTexturingConfig::default();
        assert!(!config.hex_tiling.enabled);
    }

    #[test]
    fn terrain_texturing_yaml_parses() {
        // Validates the shipped file parses with the expected tuning values.
        // Ship-disabled-by-default is guarded by `default_config_has_hex_tiling_disabled`;
        // the `enabled` flags here are a local iteration toggle, so not asserted.
        let config = TerrainTexturingConfig::load(TERRAIN_TEXTURING_CONFIG_PATH)
            .expect("terrain texturing yaml should parse");
        assert_eq!(config.hex_tiling.rotation_strength, 1.0);
        assert_eq!(config.hex_tiling.color_border_contrast, 0.55);
        assert_eq!(config.hex_tiling.normal_border_contrast, 0.50);
        assert_eq!(config.hex_tiling.near_distance, 96.0);
        assert_eq!(config.hex_tiling.mid_distance, 160.0);
    }

    #[test]
    fn uniform_defaults_match_config_defaults() {
        let config = TerrainTexturingConfig::default();
        let uniform = hex_tiling_uniform_from_config(&config, false, false);
        assert_eq!(uniform.enabled, 0);
        assert_eq!(uniform.normal_enabled, 0);
        assert_eq!(
            uniform.rotation_strength,
            config.hex_tiling.rotation_strength
        );
        assert_eq!(
            uniform.color_border_contrast,
            config.hex_tiling.color_border_contrast
        );
        assert_eq!(uniform.near_distance, config.hex_tiling.near_distance);
        assert_eq!(uniform.mid_distance, config.hex_tiling.mid_distance);
    }

    #[test]
    fn integrated_gpu_disables_hex_tiling_when_configured() {
        let config = TerrainTexturingConfig {
            hex_tiling: HexTilingConfig {
                enabled: true,
                ..Default::default()
            },
        };
        let capabilities = GraphicsCapabilities {
            integrated_gpu: true,
            ..Default::default()
        };
        assert!(!effective_hex_tiling_enabled(
            &config,
            Some(&capabilities),
            RenderQualityPreset::High,
            None,
        ));
    }

    #[test]
    fn low_quality_preset_disables_hex_tiling_when_configured() {
        let config = TerrainTexturingConfig {
            hex_tiling: HexTilingConfig {
                enabled: true,
                ..Default::default()
            },
        };
        assert!(!effective_hex_tiling_enabled(
            &config,
            None,
            RenderQualityPreset::Low,
            None,
        ));
    }

    #[test]
    fn hextile_shader_module_exists() {
        let shader = include_str!("../../assets/shaders/terrain/hextile.wgsl");
        assert!(shader.contains("hex_color_sample"));
        assert!(shader.contains("hex_normal_derivative"));
        assert!(shader.contains("triangle_grid"));
    }

    #[test]
    fn surfgrad_shader_module_exists() {
        let shader = include_str!("../../assets/shaders/terrain/surfgrad.wgsl");
        assert!(shader.contains("surfgrad_from_triplanar_projection"));
    }

    #[test]
    fn normal_uniform_requires_master_hex_enabled() {
        let config = TerrainTexturingConfig::default();
        let uniform = hex_tiling_uniform_from_config(&config, false, true);
        assert_eq!(uniform.normal_enabled, 0);
        let uniform = hex_tiling_uniform_from_config(&config, true, true);
        assert_eq!(uniform.normal_enabled, 1);
    }

    #[test]
    fn bench_toggle_can_force_hex_tiling_on() {
        let config = TerrainTexturingConfig::default();
        let toggles = BenchRenderToggles {
            terrain_hex_tiling: Some(true),
            ..Default::default()
        };
        assert!(effective_hex_tiling_enabled(
            &config,
            None,
            RenderQualityPreset::High,
            Some(&toggles),
        ));
    }

    #[test]
    fn bench_toggle_can_force_hex_tiling_normal_on() {
        let config = TerrainTexturingConfig::default();
        let toggles = BenchRenderToggles {
            terrain_hex_tiling: Some(true),
            terrain_hex_tiling_normal: Some(true),
            ..Default::default()
        };
        assert!(effective_hex_tiling_normal_enabled(
            &config,
            None,
            RenderQualityPreset::High,
            Some(&toggles),
        ));
    }

    #[test]
    fn editor_payload_reports_quality_gate() {
        let mut config = TerrainTexturingConfig::default();
        config.hex_tiling.enabled = true;
        let payload = terrain_texturing_editor_payload(&config, None, RenderQualityPreset::Low);
        assert!(payload.configured.enabled);
        assert!(!payload.effective.enabled);
        assert!(payload.gated_by_low_quality);
    }

    #[test]
    fn normal_hex_disabled_when_master_hex_off() {
        let mut config = TerrainTexturingConfig::default();
        config.hex_tiling.enabled = true;
        config.hex_tiling.normal_enabled = true;
        let toggles = BenchRenderToggles {
            terrain_hex_tiling: Some(false),
            terrain_hex_tiling_normal: Some(true),
            ..Default::default()
        };
        assert!(!effective_hex_tiling_normal_enabled(
            &config,
            None,
            RenderQualityPreset::High,
            Some(&toggles),
        ));
    }
}
