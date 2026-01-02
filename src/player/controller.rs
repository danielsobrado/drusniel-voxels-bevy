use avian3d::prelude::*;
use bevy::prelude::*;
use bevy_tnua::prelude::*;
use bevy_tnua_avian3d::*;

use crate::constants::{
    DEFAULT_CAPSULE_HEIGHT, DEFAULT_CAPSULE_RADIUS, DEFAULT_FLOAT_HEIGHT,
    DEFAULT_JUMP_HEIGHT, DEFAULT_RUN_SPEED, DEFAULT_WALK_SPEED,
};
use crate::physics::PhysicsLayer;

/// Player marker component.
#[derive(Component)]
pub struct Player;

/// Player configuration for movement and physics.
///
/// Use `PlayerConfig::builder()` for a fluent configuration API.
#[derive(Component, Clone, Resource)]
pub struct PlayerConfig {
    pub walk_speed: f32,
    pub run_speed: f32,
    pub jump_height: f32,
    pub float_height: f32,
    pub capsule_radius: f32,
    pub capsule_height: f32,
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            walk_speed: DEFAULT_WALK_SPEED,
            run_speed: DEFAULT_RUN_SPEED,
            jump_height: DEFAULT_JUMP_HEIGHT,
            float_height: DEFAULT_FLOAT_HEIGHT,
            capsule_radius: DEFAULT_CAPSULE_RADIUS,
            capsule_height: DEFAULT_CAPSULE_HEIGHT,
        }
    }
}

impl PlayerConfig {
    /// Creates a new builder for fluent configuration.
    pub fn builder() -> PlayerConfigBuilder {
        PlayerConfigBuilder::default()
    }
}

/// Builder for `PlayerConfig` with fluent API.
#[derive(Default)]
pub struct PlayerConfigBuilder {
    walk_speed: Option<f32>,
    run_speed: Option<f32>,
    jump_height: Option<f32>,
    float_height: Option<f32>,
    capsule_radius: Option<f32>,
    capsule_height: Option<f32>,
}

impl PlayerConfigBuilder {
    /// Sets the walking speed in units per second.
    pub fn walk_speed(mut self, speed: f32) -> Self {
        self.walk_speed = Some(speed);
        self
    }

    /// Sets the running speed in units per second.
    pub fn run_speed(mut self, speed: f32) -> Self {
        self.run_speed = Some(speed);
        self
    }

    /// Sets the jump height in world units.
    pub fn jump_height(mut self, height: f32) -> Self {
        self.jump_height = Some(height);
        self
    }

    /// Sets the float height for ground detection.
    pub fn float_height(mut self, height: f32) -> Self {
        self.float_height = Some(height);
        self
    }

    /// Sets the capsule collider radius.
    pub fn capsule_radius(mut self, radius: f32) -> Self {
        self.capsule_radius = Some(radius);
        self
    }

    /// Sets the capsule collider height.
    pub fn capsule_height(mut self, height: f32) -> Self {
        self.capsule_height = Some(height);
        self
    }

    /// Builds the `PlayerConfig` with defaults for unset values.
    pub fn build(self) -> PlayerConfig {
        PlayerConfig {
            walk_speed: self.walk_speed.unwrap_or(DEFAULT_WALK_SPEED),
            run_speed: self.run_speed.unwrap_or(DEFAULT_RUN_SPEED),
            jump_height: self.jump_height.unwrap_or(DEFAULT_JUMP_HEIGHT),
            float_height: self.float_height.unwrap_or(DEFAULT_FLOAT_HEIGHT),
            capsule_radius: self.capsule_radius.unwrap_or(DEFAULT_CAPSULE_RADIUS),
            capsule_height: self.capsule_height.unwrap_or(DEFAULT_CAPSULE_HEIGHT),
        }
    }
}

/// Bundle for spawning a player entity.
#[derive(Bundle)]
pub struct PlayerBundle {
    pub player: Player,
    pub config: PlayerConfig,
    pub transform: Transform,
    pub global_transform: GlobalTransform,
    pub rigid_body: RigidBody,
    pub collider: Collider,
    pub locked_axes: LockedAxes,
    pub collision_layers: CollisionLayers,
    pub tnua_controller: TnuaController,
    pub tnua_sensor: TnuaAvian3dSensorShape,
}

impl PlayerBundle {
    pub fn new(position: Vec3, config: PlayerConfig) -> Self {
        let half_height = (config.capsule_height - config.capsule_radius * 2.0) / 2.0;

        Self {
            player: Player,
            config: config.clone(),
            transform: Transform::from_translation(position),
            global_transform: GlobalTransform::default(),
            rigid_body: RigidBody::Dynamic,
            collider: Collider::capsule(config.capsule_radius, half_height * 2.0),
            locked_axes: LockedAxes::ROTATION_LOCKED,
            collision_layers: CollisionLayers::new(
                PhysicsLayer::Player,
                PhysicsLayer::player_mask(),
            ),
            tnua_controller: TnuaController::default(),
            tnua_sensor: TnuaAvian3dSensorShape(Collider::capsule(
                config.capsule_radius * 0.9,
                half_height * 1.8,
            )),
        }
    }
}
