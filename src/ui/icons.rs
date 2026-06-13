use bevy::prelude::*;
use std::collections::HashMap;
use std::path::Path;

use crate::entity::ItemType;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum UiIconId {
    Save,
    Close,
    Settings,
    Map,
    Inventory,
    Chat,
    Pickaxe,
    Torch,
    Axe,
    TerrainRaise,
    TerrainLower,
    TerrainLevel,
    TerrainSmooth,
    Warning,
}

#[derive(Resource, Default)]
pub struct UiIconAssets {
    images: HashMap<UiIconId, Handle<Image>>,
}

impl UiIconAssets {
    pub fn get(&self, id: UiIconId) -> Option<Handle<Image>> {
        self.images.get(&id).cloned()
    }
}

pub fn setup_ui_icons(asset_server: Res<AssetServer>, mut icons: ResMut<UiIconAssets>) {
    if !icons.images.is_empty() {
        return;
    }

    for id in UI_ICON_IDS {
        let asset_path = format!("ui/icons/{}", id.file_name());
        let disk_path = Path::new("assets").join(&asset_path);
        if disk_path.exists() {
            icons.images.insert(id, asset_server.load(asset_path));
        }
    }
}

pub fn icon_for_item(item: ItemType) -> Option<UiIconId> {
    match item {
        ItemType::Pickaxe => Some(UiIconId::Pickaxe),
        ItemType::Torch => Some(UiIconId::Torch),
        ItemType::Axe => Some(UiIconId::Axe),
        ItemType::TerrainRaise => Some(UiIconId::TerrainRaise),
        ItemType::TerrainLower => Some(UiIconId::TerrainLower),
        ItemType::TerrainLevel => Some(UiIconId::TerrainLevel),
        ItemType::TerrainSmooth => Some(UiIconId::TerrainSmooth),
        _ => None,
    }
}

const UI_ICON_IDS: [UiIconId; 14] = [
    UiIconId::Save,
    UiIconId::Close,
    UiIconId::Settings,
    UiIconId::Map,
    UiIconId::Inventory,
    UiIconId::Chat,
    UiIconId::Pickaxe,
    UiIconId::Torch,
    UiIconId::Axe,
    UiIconId::TerrainRaise,
    UiIconId::TerrainLower,
    UiIconId::TerrainLevel,
    UiIconId::TerrainSmooth,
    UiIconId::Warning,
];

impl UiIconId {
    fn file_name(self) -> &'static str {
        match self {
            UiIconId::Save => "save.png",
            UiIconId::Close => "close.png",
            UiIconId::Settings => "settings.png",
            UiIconId::Map => "map.png",
            UiIconId::Inventory => "inventory.png",
            UiIconId::Chat => "chat.png",
            UiIconId::Pickaxe => "pickaxe.png",
            UiIconId::Torch => "torch.png",
            UiIconId::Axe => "axe.png",
            UiIconId::TerrainRaise => "terrain_raise.png",
            UiIconId::TerrainLower => "terrain_lower.png",
            UiIconId::TerrainLevel => "terrain_level.png",
            UiIconId::TerrainSmooth => "terrain_smooth.png",
            UiIconId::Warning => "warning.png",
        }
    }
}
