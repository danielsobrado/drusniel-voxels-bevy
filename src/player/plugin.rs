use bevy::prelude::*;
use bevy_tnua::prelude::*;

use super::*;

pub struct PlayerPlugin;

impl Plugin for PlayerPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PlayerConfig>();
        app.init_resource::<PlayerInput>();

        app.add_systems(Startup, spawn_player);

        app.add_systems(
            Update,
            (
                read_player_input,
                apply_player_movement.in_set(TnuaUserControlsSystems),
                record_player_movement_diagnostics,
            )
                .chain(),
        );
    }
}
