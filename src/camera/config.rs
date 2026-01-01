use bevy::prelude::*;

/// Configuration for camera behavior and rendering settings.
#[derive(Resource, Clone)]
pub struct CameraConfig {
    pub movement: CameraMovementConfig,
    pub rendering: CameraRenderingConfig,
    pub spawn: CameraSpawnConfig,
}

#[derive(Clone)]
pub struct CameraMovementConfig {
    pub sensitivity: f32,
    pub fly_speed: f32,
    pub fly_turbo_multiplier: f32,
    pub pitch_min: f32,
    pub pitch_max: f32,
    pub reset_yaw: f32,
    pub reset_pitch: f32,
    pub eye_height: f32,
}

#[derive(Clone)]
pub struct CameraRenderingConfig {
    pub bloom_intensity: f32,
    pub sharpening_strength: f32,
}

#[derive(Clone)]
pub struct CameraSpawnConfig {
    pub position: Vec3,
    pub look_at: Vec3,
}

impl Default for CameraConfig {
    fn default() -> Self {
        Self {
            movement: CameraMovementConfig {
                sensitivity: 0.002,
                fly_speed: 40.0,
                fly_turbo_multiplier: 3.0,
                pitch_min: -1.5,
                pitch_max: 1.5,
                reset_yaw: -2.35,
                reset_pitch: -0.4,
                eye_height: 1.6,
            },
            rendering: CameraRenderingConfig {
                bloom_intensity: 0.15,
                sharpening_strength: 0.6,
            },
            spawn: CameraSpawnConfig {
                position: Vec3::new(256.0, 50.0, 256.0),
                look_at: Vec3::new(200.0, 30.0, 200.0),
            },
        }
    }
}
