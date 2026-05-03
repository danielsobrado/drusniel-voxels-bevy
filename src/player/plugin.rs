use bevy::prelude::*;
use bevy_tnua::prelude::*;

use super::*;

pub struct PlayerPlugin;

impl Plugin for PlayerPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PlayerConfig>();
        app.init_resource::<PlayerInput>();
        app.init_resource::<PlayerSpawnState>();

        app.add_systems(Startup, spawn_player);

        app.add_systems(
            Update,
            (
                resolve_initial_player_spawn,
                read_player_input,
                apply_player_movement.in_set(TnuaUserControlsSystems),
                recover_player_from_void,
                track_last_safe_grounded_position,
                record_player_movement_diagnostics,
                record_spawn_diagnostics,
            )
                .chain(),
        );
    }
}
