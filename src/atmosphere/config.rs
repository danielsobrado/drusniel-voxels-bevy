use bevy::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Resource, Serialize, Deserialize, Clone)]
pub struct FogConfig {
    pub distance: DistanceFogConfig,
    pub volumetric: VolumetricConfig,
    pub volume: FogVolumeConfig,
    pub colors: FogColorPresets,
    /// Current active preset
    #[serde(default)]
    pub current_preset: FogPreset,
    /// Configs for each preset
    #[serde(default)]
    pub presets: FogPresetConfig,
    /// Runtime color modifiers (adjusted via settings UI, persisted in settings save)
    #[serde(default)]
    pub color_modifiers: FogColorModifiers,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
#[serde(rename_all = "snake_case")]
pub enum FogPreset {
    Clear,
    #[default]
    Balanced,
    Misty,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FogPresetConfig {
    pub clear: FogVolumeConfig,
    pub balanced: FogVolumeConfig,
    pub misty: FogVolumeConfig,
}

impl Default for FogPresetConfig {
    fn default() -> Self {
        Self {
            clear: FogVolumeConfig {
                size: 512.0,
                density: 0.0005, // Very clear
                absorption: 0.1,
                scattering: 0.1,
                scattering_asymmetry: 0.6,
            },
            balanced: FogVolumeConfig {
                size: 512.0,
                density: 0.04, // Default
                absorption: 0.08,
                scattering: 0.25,
                scattering_asymmetry: 0.7,
            },
            misty: FogVolumeConfig {
                size: 512.0,
                density: 0.15, // Dense mist
                absorption: 0.05, // Bright mist
                scattering: 0.8, // High scattering
                scattering_asymmetry: 0.8,
            },
        }
    }
}

/// Runtime fog color modifiers for UI tweaking
#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct FogColorModifiers {
    /// Blue tint intensity (0.0 = neutral, 1.0 = full blue shift)
    pub blue_tint: f32,
    /// Overall fog brightness multiplier
    pub brightness: f32,
    /// Aerial perspective strength (how much distant objects blend to fog)
    pub aerial_strength: f32,
}

impl Default for FogColorModifiers {
    fn default() -> Self {
        Self {
            blue_tint: 0.5,      // Neutral starting point
            brightness: 1.0,    // No brightness change
            aerial_strength: 1.0, // Normal aerial perspective
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct DistanceFogConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub start: f32,
    pub end: f32,
    #[serde(default)]
    /// Fraction of the fog range kept clear before fog starts (0 = immediate, 0.5 = start halfway).
    pub near_fade: f32,
    #[serde(default)]
    pub falloff: FogFalloffMode,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum FogFalloffMode {
    Linear,
    Atmospheric,
}

impl Default for FogFalloffMode {
    fn default() -> Self {
        Self::Linear
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct VolumetricConfig {
    pub enabled: bool,
    pub step_count: u32,
    pub jitter: f32,
    pub ambient_intensity: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FogVolumeConfig {
    pub size: f32,
    pub density: f32,
    pub absorption: f32,
    pub scattering: f32,
    pub scattering_asymmetry: f32,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FogColorPresets {
    pub day: FogColors,
    pub twilight: FogColors,
    pub night: FogColors,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FogColors {
    pub fog: [f32; 4],
    pub extinction: [f32; 3],
    pub inscattering: [f32; 3],
    pub directional: [f32; 3],
}

impl Default for FogConfig {
    fn default() -> Self {
        Self {
            distance: DistanceFogConfig {
                enabled: true,
                start: 80.0,
                end: 220.0,
                near_fade: 0.0,
                falloff: FogFalloffMode::Linear,
            },
            volumetric: VolumetricConfig {
                enabled: true,
                step_count: 64,
                jitter: 0.5,
                ambient_intensity: 0.0,
            },
            volume: FogVolumeConfig {
                size: 512.0,
                density: 0.04,
                absorption: 0.08,
                scattering: 0.25,
                scattering_asymmetry: 0.7,
            },
            current_preset: FogPreset::Balanced,
            presets: FogPresetConfig::default(),
            colors: FogColorPresets {
                day: FogColors {
                    fog: [0.55, 0.65, 0.80, 1.0],
                    extinction: [0.35, 0.50, 0.66],
                    inscattering: [0.80, 0.84, 1.00],
                    directional: [1.0, 0.95, 0.85],
                },
                twilight: FogColors {
                    fog: [0.65, 0.45, 0.40, 1.0],
                    extinction: [0.50, 0.35, 0.30],
                    inscattering: [1.0, 0.70, 0.50],
                    directional: [1.0, 0.60, 0.30],
                },
                night: FogColors {
                    fog: [0.08, 0.10, 0.15, 1.0],
                    extinction: [0.05, 0.08, 0.12],
                    inscattering: [0.10, 0.15, 0.25],
                    directional: [0.6, 0.7, 0.9],
                },
            },
            color_modifiers: FogColorModifiers::default(),
        }
    }
}

fn default_true() -> bool {
    true
}
