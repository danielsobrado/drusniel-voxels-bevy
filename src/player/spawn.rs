use bevy::prelude::*;

use super::{PlayerBundle, PlayerConfig};
use crate::constants::{CHUNK_SIZE_I32, DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Z};

/// Spawn the player at game start.
pub fn spawn_player(mut commands: Commands, config: Res<PlayerConfig>) {
    // Spawn at the center of the world map
    let world_center_x = (DEFAULT_WORLD_CHUNKS_X * CHUNK_SIZE_I32) as f32 / 2.0;
    let world_center_z = (DEFAULT_WORLD_CHUNKS_Z * CHUNK_SIZE_I32) as f32 / 2.0;
    let spawn_position = Vec3::new(world_center_x, 150.0, world_center_z); // High Y to fall to terrain
    commands.spawn(PlayerBundle::new(spawn_position, config.clone()));
}
