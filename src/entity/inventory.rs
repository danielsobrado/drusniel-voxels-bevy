use bevy::prelude::*;
use std::collections::HashMap;

/// Types of items that can be collected
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ItemType {
    Fur,
    Pickaxe,
    Torch,
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
            ItemType::Torch => "Torch",
        }
    }

    pub(crate) fn sort_key(&self) -> u8 {
        match self {
            ItemType::Pickaxe => 0,
            ItemType::Torch => 1,
            ItemType::Fur => 2,
        }
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
