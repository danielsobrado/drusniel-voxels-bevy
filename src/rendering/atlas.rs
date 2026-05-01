use crate::constants::{ATLAS_COLUMNS, ATLAS_TILE_SIZE};
use bevy::prelude::*;

#[derive(Resource)]
pub struct TextureAtlas {
    pub handle: Handle<Image>,
    pub tile_size: u32,
    pub columns: u32,
}

pub fn load_texture_atlas(mut commands: Commands, asset_server: Res<AssetServer>) {
    // For Phase 1, we assume a pre-combined atlas exists
    // In a real scenario, we might want to combine individual textures at runtime
    let handle = asset_server.load("textures/atlas.png");

    commands.insert_resource(TextureAtlas {
        handle,
        tile_size: ATLAS_TILE_SIZE,
        columns: ATLAS_COLUMNS,
    });
}
