use bevy::prelude::*;

/// Configuration for viewmodel (pickaxe) appearance and animation.
#[derive(Resource, Clone)]
pub struct ViewmodelConfig {
    pub handle: HandleConfig,
    pub head: HeadConfig,
    pub position: ViewmodelPositionConfig,
    pub swing: SwingConfig,
    pub idle: IdleConfig,
}

#[derive(Clone)]
pub struct HandleConfig {
    pub size: Vec3,
    pub color: Color,
    pub emissive: [f32; 4],
    pub roughness: f32,
}

#[derive(Clone)]
pub struct HeadConfig {
    pub size: Vec3,
    pub offset: Vec3,
    pub color: Color,
    pub emissive: [f32; 4],
    pub roughness: f32,
    pub metallic: f32,
}

#[derive(Clone)]
pub struct ViewmodelPositionConfig {
    pub offset: Vec3,
    pub rotation: Vec3,
}

#[derive(Clone)]
pub struct SwingConfig {
    pub duration: f32,
    pub down_phase: f32,
    pub rotation_pitch: f32,
    pub rotation_yaw: f32,
    pub rotation_roll: f32,
    pub offset_x: f32,
    pub offset_y: f32,
    pub offset_z: f32,
}

#[derive(Clone)]
pub struct IdleConfig {
    pub bob_frequency: f32,
    pub sway_frequency: f32,
    pub bob_amplitude: f32,
    pub sway_amplitude: f32,
}

impl Default for ViewmodelConfig {
    fn default() -> Self {
        Self {
            handle: HandleConfig {
                size: Vec3::new(0.08, 0.08, 0.8),
                color: Color::srgb(0.6, 0.35, 0.15),
                emissive: [0.1, 0.05, 0.02, 1.0],
                roughness: 0.7,
            },
            head: HeadConfig {
                size: Vec3::new(0.4, 0.12, 0.12),
                offset: Vec3::new(0.0, 0.0, -0.4),
                color: Color::srgb(0.7, 0.7, 0.75),
                emissive: [0.1, 0.1, 0.12, 1.0],
                roughness: 0.2,
                metallic: 0.8,
            },
            position: ViewmodelPositionConfig {
                offset: Vec3::new(0.45, -0.35, -1.0),
                rotation: Vec3::new(0.3, -0.5, 0.2),
            },
            swing: SwingConfig {
                duration: 0.35,
                down_phase: 0.5,
                rotation_pitch: 1.2,
                rotation_yaw: 0.15,
                rotation_roll: -0.1,
                offset_x: 0.15,
                offset_y: 0.3,
                offset_z: 0.4,
            },
            idle: IdleConfig {
                bob_frequency: 2.0,
                sway_frequency: 1.5,
                bob_amplitude: 0.015,
                sway_amplitude: 0.008,
            },
        }
    }
}
