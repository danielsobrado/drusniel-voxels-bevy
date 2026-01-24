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
    /// God rays with minimal fog - clear air with visible light shafts and animated dust
    GodRays,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FogPresetConfig {
    pub clear: FogVolumeConfig,
    pub balanced: FogVolumeConfig,
    pub misty: FogVolumeConfig,
    #[serde(default = "default_god_rays_preset")]
    pub god_rays: FogVolumeConfig,
}

fn default_light_intensity() -> f32 {
    1.0
}

fn default_god_rays_preset() -> FogVolumeConfig {
    FogVolumeConfig {
        size: 512.0,
        density: 0.0001,         // Very low base fog
        absorption: 0.15,        // HIGHER absorption = rays fade out, don't wash everything
        scattering: 0.25,        // Moderate scattering - rays visible but focused
        scattering_asymmetry: 0.85, // High forward scattering - rays visible toward sun
        dust_animation: DustAnimationConfig {
            enabled: true,
            speed: 0.4,
            scale: 6.0,          // Slightly larger patterns for visible dust
            intensity: 0.8,      // Higher contrast for dramatic effect
            wind_direction: [0.7, 0.3],
        },
        // God rays specific volumetric overrides
        step_count_override: Some(64),   // Higher steps for sharp canopy shafts
        ambient_intensity_override: Some(0.0), // Zero ambient = maximum shaft contrast
        light_intensity: 1.0,            // Normal intensity
    }
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
                dust_animation: DustAnimationConfig {
                    enabled: false, // No dust in clear mode
                    ..Default::default()
                },
                step_count_override: None,
                ambient_intensity_override: None,
                light_intensity: 1.0,
            },
            balanced: FogVolumeConfig {
                size: 512.0,
                density: 0.04, // Default
                absorption: 0.08,
                scattering: 0.25,
                scattering_asymmetry: 0.7,
                dust_animation: DustAnimationConfig {
                    enabled: true,
                    speed: 0.2,
                    scale: 10.0,
                    intensity: 0.4,
                    wind_direction: [0.7, 0.3],
                },
                step_count_override: None,
                ambient_intensity_override: None,
                light_intensity: 1.0,
            },
            misty: FogVolumeConfig {
                size: 512.0,
                density: 0.15, // Dense mist
                absorption: 0.05, // Bright mist
                scattering: 0.8, // High scattering
                scattering_asymmetry: 0.8,
                dust_animation: DustAnimationConfig {
                    enabled: true,
                    speed: 0.15,      // Slower, drifting mist
                    scale: 16.0,      // Larger swirling patterns
                    intensity: 0.5,
                    wind_direction: [0.5, 0.5],
                },
                step_count_override: Some(48), // Lower for performance in dense fog
                ambient_intensity_override: None,
                light_intensity: 1.0,
            },
            god_rays: default_god_rays_preset(),
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
    /// Dust animation settings for god ray movement
    #[serde(default)]
    pub dust_animation: DustAnimationConfig,
    /// Override step count for this preset (higher = sharper rays, more expensive)
    #[serde(default)]
    pub step_count_override: Option<u32>,
    /// Override ambient intensity (0 = dark shadows for visible rays)
    #[serde(default)]
    pub ambient_intensity_override: Option<f32>,
    /// Light intensity multiplier for volumetric scattering (boost god rays visibility)
    #[serde(default = "default_light_intensity")]
    pub light_intensity: f32,
}

/// Configuration for animated dust movement in volumetric fog
#[derive(Serialize, Deserialize, Clone, Copy)]
pub struct DustAnimationConfig {
    /// Enable animated dust in god rays
    pub enabled: bool,
    /// Movement speed multiplier (1.0 = default drift)
    pub speed: f32,
    /// Noise texture scale (smaller = larger dust patterns)
    pub scale: f32,
    /// Density variation intensity (0 = uniform, 1 = high contrast)
    pub intensity: f32,
    /// Wind direction influence (normalized XZ direction)
    pub wind_direction: [f32; 2],
}

impl Default for DustAnimationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            speed: 0.3,
            scale: 8.0,
            intensity: 0.6,
            wind_direction: [0.7, 0.3],
        }
    }
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
                dust_animation: DustAnimationConfig::default(),
                step_count_override: None,
                ambient_intensity_override: None,
                light_intensity: 1.0,
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
