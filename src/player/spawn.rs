use bevy::prelude::*;
use bevy_tnua::builtins::{TnuaBuiltinJumpConfig, TnuaBuiltinWalkConfig};

use super::{PlayerBundle, PlayerConfig, PlayerMovementSchemeConfig};
use crate::constants::{CHUNK_SIZE_I32, DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Z};
use crate::rendering::water_displacement::WaterImpulseSource;

/// Spawn the player at game start.
pub fn spawn_player(
    mut commands: Commands,
    config: Res<PlayerConfig>,
    mut movement_configs: ResMut<Assets<PlayerMovementSchemeConfig>>,
) {
    // Spawn at the center of the world map
    let world_center_x = (DEFAULT_WORLD_CHUNKS_X * CHUNK_SIZE_I32) as f32 / 2.0;
    let world_center_z = (DEFAULT_WORLD_CHUNKS_Z * CHUNK_SIZE_I32) as f32 / 2.0;
    let spawn_position = Vec3::new(world_center_x, 130.0, world_center_z); // Just above max terrain height
    let movement_config = movement_configs.add(PlayerMovementSchemeConfig {
        basis: TnuaBuiltinWalkConfig {
            // Feed speed directly through desired_motion each frame.
            speed: 1.0,
            float_height: config.float_height,
            cling_distance: 1.0,
            max_slope: std::f32::consts::FRAC_PI_3,
            ..default()
        },
        jump: TnuaBuiltinJumpConfig {
            height: config.jump_height,
            ..default()
        },
    });
    commands.spawn((
        PlayerBundle::new(spawn_position, config.clone(), movement_config),
        // Player creates water ripples when moving through water
        WaterImpulseSource::new(1.5, 0.3),
    ));
}
