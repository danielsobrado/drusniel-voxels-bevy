pub mod config;
pub mod manager;

use bevy::prelude::*;

pub struct InputPlugin;

impl Plugin for InputPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<config::InputConfig>()
           .init_resource::<manager::ActionState>()
           .add_systems(Startup, config::load_inputs)
           .add_systems(Update, manager::update_action_state);
    }
}
