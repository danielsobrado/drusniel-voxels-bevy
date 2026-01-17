mod types;
mod operations;
mod input;
mod preview;
mod apply;

pub use types::*;
pub use operations::*;
pub use preview::TerrainRaycastHit;

use bevy::prelude::*;

pub struct TerrainToolsPlugin;

impl Plugin for TerrainToolsPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TerrainToolState>()
            .init_resource::<TerrainToolConfig>()
            .add_systems(Startup, preview::spawn_preview)
            .add_systems(Update, (
                input::select_terrain_tool,
                input::handle_tool_input,
                preview::update_terrain_raycast,
                preview::update_preview,
                apply::apply_terrain_tool,
            ).chain());
    }
}
