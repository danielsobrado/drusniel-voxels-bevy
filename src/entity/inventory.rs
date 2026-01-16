use bevy::prelude::*;
use std::collections::HashMap;

/// Types of items that can be collected or tools that can be used
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ItemType {
    // Inventory items
    Fur,
    Pickaxe,
    Axe,
    Sword,
    Torch,
    // Terrain tools (not collectible, always available)
    TerrainRaise,
    TerrainLower,
    TerrainLevel,
    TerrainSmooth,
}

/// Player inventory resource
#[derive(Resource, Debug)]
pub struct Inventory {
    pub items: HashMap<ItemType, u32>,
}

#[derive(Resource, Debug)]
pub struct EquippedItem {
    pub item: Option<ItemType>,
}

impl ItemType {
    pub fn display_name(&self) -> &'static str {
        match self {
            ItemType::Fur => "Fur",
            ItemType::Pickaxe => "Pickaxe",
            ItemType::Axe => "Axe",
            ItemType::Sword => "Sword",
            ItemType::Torch => "Torch",
            ItemType::TerrainRaise => "Raise",
            ItemType::TerrainLower => "Lower",
            ItemType::TerrainLevel => "Level",
            ItemType::TerrainSmooth => "Smooth",
        }
    }

    pub(crate) fn sort_key(&self) -> u8 {
        match self {
            ItemType::Pickaxe => 0,
            ItemType::Axe => 1,
            ItemType::Sword => 2,
            ItemType::Torch => 3,
            ItemType::Fur => 4,
            ItemType::TerrainRaise => 10,
            ItemType::TerrainLower => 11,
            ItemType::TerrainLevel => 12,
            ItemType::TerrainSmooth => 13,
        }
    }

    /// Returns true if this is a terrain tool
    pub fn is_terrain_tool(&self) -> bool {
        matches!(
            self,
            ItemType::TerrainRaise
                | ItemType::TerrainLower
                | ItemType::TerrainLevel
                | ItemType::TerrainSmooth
        )
    }
}

impl Default for EquippedItem {
    fn default() -> Self {
        Self {
            item: Some(ItemType::Pickaxe),
        }
    }
}

impl Default for Inventory {
    fn default() -> Self {
        let mut items = HashMap::new();
        items.insert(ItemType::Pickaxe, 1);
        items.insert(ItemType::Axe, 1);
        items.insert(ItemType::Sword, 1);
        items.insert(ItemType::Torch, 1);
        Self { items }
    }
}

impl Inventory {
    pub fn add_item(&mut self, item_type: ItemType) {
        *self.items.entry(item_type).or_insert(0) += 1;
    }

    pub fn get_count(&self, item_type: ItemType) -> u32 {
        *self.items.get(&item_type).unwrap_or(&0)
    }

    pub fn remove_item(&mut self, item_type: ItemType, count: u32) -> bool {
        if let Some(current) = self.items.get_mut(&item_type) {
            if *current >= count {
                *current -= count;
                return true;
            }
        }
        false
    }
}

/// Component for item drops
#[derive(Component)]
pub struct ItemDrop {
    pub item_type: ItemType,
    pub position: Vec3,
}
