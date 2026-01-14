use bevy::prelude::*;
use serde::Deserialize;

#[derive(Resource, Deserialize, Clone)]
pub struct FogConfig {
    pub distance: DistanceFogConfig,
    pub volumetric: VolumetricConfig,
    pub volume: FogVolumeConfig,
    pub colors: FogColorPresets,
}

#[derive(Deserialize, Clone)]
pub struct DistanceFogConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub visibility: f32,
    pub start: f32,
    pub end: f32,
}

#[derive(Deserialize, Clone)]
pub struct VolumetricConfig {
    pub enabled: bool,
    pub step_count: u32,
    pub jitter: f32,
    pub ambient_intensity: f32,
}

#[derive(Deserialize, Clone)]
pub struct FogVolumeConfig {
    pub size: f32,
    pub density: f32,
    pub absorption: f32,
    pub scattering: f32,
    pub scattering_asymmetry: f32,
}

#[derive(Deserialize, Clone)]
pub struct FogColorPresets {
    pub day: FogColors,
    pub twilight: FogColors,
    pub night: FogColors,
}

#[derive(Deserialize, Clone)]
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
                visibility: 200.0,
                start: 80.0,
                end: 220.0,
            },
            volumetric: VolumetricConfig {
                enabled: false,
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
        }
    }
}

fn default_true() -> bool {
    true
}
