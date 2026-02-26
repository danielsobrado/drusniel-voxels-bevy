use bevy::prelude::*;

/// Number of inventory slots (6 columns x 4 rows)
pub const INVENTORY_SLOTS: usize = 24;
pub const INVENTORY_COLUMNS: usize = 6;
pub const INVENTORY_ROWS: usize = 4;

/// Types of items that can be collected or tools that can be used
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ItemType {
    // Tools (non-stackable)
    Pickaxe,
    Axe,
    Sword,
    Torch,
    Bow,
    Hammer,
    Shield,
    // Armor (non-stackable)
    Helmet,
    Chestplate,
    Boots,
    // Resources (stackable)
    Fur,
    Wood,
    Stone,
    Iron,
    Coin,
    // Consumables (stackable)
    Potion,
    Food,
    Arrow,
    // Terrain tools (not collectible, always available)
    TerrainRaise,
    TerrainLower,
    TerrainLevel,
    TerrainSmooth,
}

/// A single inventory slot that can hold an item with a quantity
#[derive(Debug, Clone, Copy, Default)]
pub struct InventorySlot {
    pub item: Option<ItemType>,
    pub quantity: u32,
}

/// Player inventory resource with slot-based storage
#[derive(Resource, Debug)]
pub struct Inventory {
    pub slots: [InventorySlot; INVENTORY_SLOTS],
}

#[derive(Resource, Debug)]
pub struct EquippedItem {
    pub item: Option<ItemType>,
}

impl ItemType {
    pub fn display_name(&self) -> &'static str {
        match self {
            ItemType::Pickaxe => "Pickaxe",
            ItemType::Axe => "Axe",
            ItemType::Sword => "Sword",
            ItemType::Torch => "Torch",
            ItemType::Bow => "Bow",
            ItemType::Hammer => "Hammer",
            ItemType::Shield => "Shield",
            ItemType::Helmet => "Helmet",
            ItemType::Chestplate => "Chestplate",
            ItemType::Boots => "Boots",
            ItemType::Fur => "Fur",
            ItemType::Wood => "Wood",
            ItemType::Stone => "Stone",
            ItemType::Iron => "Iron",
            ItemType::Coin => "Coin",
            ItemType::Potion => "Potion",
            ItemType::Food => "Food",
            ItemType::Arrow => "Arrow",
            ItemType::TerrainRaise => "Raise",
            ItemType::TerrainLower => "Lower",
            ItemType::TerrainLevel => "Level",
            ItemType::TerrainSmooth => "Smooth",
        }
    }

    pub(crate) fn sort_key(&self) -> u8 {
        match self {
            // Tools
            ItemType::Pickaxe => 0,
            ItemType::Axe => 1,
            ItemType::Sword => 2,
            ItemType::Torch => 3,
            ItemType::Bow => 4,
            ItemType::Hammer => 5,
            ItemType::Shield => 6,
            // Armor
            ItemType::Helmet => 10,
            ItemType::Chestplate => 11,
            ItemType::Boots => 12,
            // Resources
            ItemType::Fur => 20,
            ItemType::Wood => 21,
            ItemType::Stone => 22,
            ItemType::Iron => 23,
            ItemType::Coin => 24,
            // Consumables
            ItemType::Potion => 30,
            ItemType::Food => 31,
            ItemType::Arrow => 32,
            // Terrain tools
            ItemType::TerrainRaise => 100,
            ItemType::TerrainLower => 101,
            ItemType::TerrainLevel => 102,
            ItemType::TerrainSmooth => 103,
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

    /// Returns true if this item type can stack
    pub fn is_stackable(&self) -> bool {
        matches!(
            self,
            ItemType::Fur
                | ItemType::Wood
                | ItemType::Stone
                | ItemType::Iron
                | ItemType::Coin
                | ItemType::Potion
                | ItemType::Food
                | ItemType::Arrow
        )
    }

    /// Maximum stack size for this item type
    pub fn max_stack(&self) -> u32 {
        if self.is_stackable() {
            99
        } else {
            1
        }
    }

    /// Path to the 2D icon for this item type
    pub fn icon_path(&self) -> &'static str {
        match self {
            ItemType::Pickaxe => "textures/ui/inventory/pickaxe.png",
            ItemType::Axe => "textures/ui/inventory/axe.png",
            ItemType::Sword => "textures/ui/inventory/sword.png",
            ItemType::Torch => "textures/ui/inventory/torch.png",
            ItemType::Bow => "textures/ui/inventory/bow.png",
            ItemType::Hammer => "textures/ui/inventory/hammer.png",
            ItemType::Shield => "textures/ui/inventory/shield.png",
            ItemType::Helmet => "textures/ui/inventory/helmet.png",
            ItemType::Chestplate => "textures/ui/inventory/chestplate.png",
            ItemType::Boots => "textures/ui/inventory/boots.png",
            ItemType::Fur => "textures/ui/inventory/fur.png",
            ItemType::Wood => "textures/ui/inventory/wood.png",
            ItemType::Stone => "textures/ui/inventory/stone.png",
            ItemType::Iron => "textures/ui/inventory/iron.png",
            ItemType::Coin => "textures/ui/inventory/coin.png",
            ItemType::Potion => "textures/ui/inventory/potion.png",
            ItemType::Food => "textures/ui/inventory/food.png",
            ItemType::Arrow => "textures/ui/inventory/arrow.png",
            ItemType::TerrainRaise => "textures/ui/inventory/shovel.png",
            ItemType::TerrainLower => "textures/ui/inventory/pickaxe.png",
            ItemType::TerrainLevel => "textures/ui/inventory/rake.png",
            ItemType::TerrainSmooth => "textures/ui/inventory/rake.png",
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
        let mut slots = [InventorySlot::default(); INVENTORY_SLOTS];
        // Start with some basic items
        slots[0] = InventorySlot {
            item: Some(ItemType::Pickaxe),
            quantity: 1,
        };
        slots[1] = InventorySlot {
            item: Some(ItemType::Axe),
            quantity: 1,
        };
        slots[2] = InventorySlot {
            item: Some(ItemType::Sword),
            quantity: 1,
        };
        slots[3] = InventorySlot {
            item: Some(ItemType::Torch),
            quantity: 1,
        };
        // Some stackable items for testing
        slots[6] = InventorySlot {
            item: Some(ItemType::Wood),
            quantity: 20,
        };
        slots[7] = InventorySlot {
            item: Some(ItemType::Stone),
            quantity: 15,
        };
        slots[8] = InventorySlot {
            item: Some(ItemType::Potion),
            quantity: 5,
        };
        Self { slots }
    }
}

impl Inventory {
    /// Add an item to the inventory, stacking if possible
    /// Returns true if the item was added successfully
    pub fn add_item(&mut self, item_type: ItemType) -> bool {
        self.add_items(item_type, 1)
    }

    /// Add multiple items to the inventory, stacking if possible
    /// Returns true if all items were added successfully
    pub fn add_items(&mut self, item_type: ItemType, mut count: u32) -> bool {
        let max_stack = item_type.max_stack();

        // First, try to stack with existing slots
        for slot in self.slots.iter_mut() {
            if count == 0 {
                break;
            }
            if let Some(existing) = slot.item {
                if existing == item_type && slot.quantity < max_stack {
                    let can_add = (max_stack - slot.quantity).min(count);
                    slot.quantity += can_add;
                    count -= can_add;
                }
            }
        }

        // Then, fill empty slots
        while count > 0 {
            if let Some(slot) = self.slots.iter_mut().find(|s| s.item.is_none()) {
                let add_count = count.min(max_stack);
                slot.item = Some(item_type);
                slot.quantity = add_count;
                count -= add_count;
            } else {
                // No more empty slots
                return false;
            }
        }

        true
    }

    /// Get the total count of a specific item type across all slots
    pub fn get_count(&self, item_type: ItemType) -> u32 {
        self.slots
            .iter()
            .filter(|s| s.item == Some(item_type))
            .map(|s| s.quantity)
            .sum()
    }

    /// Remove items from the inventory
    /// Returns true if the items were removed successfully
    pub fn remove_item(&mut self, item_type: ItemType, mut count: u32) -> bool {
        // Check if we have enough
        if self.get_count(item_type) < count {
            return false;
        }

        // Remove from slots (prefer partial stacks first)
        let mut slots_with_item: Vec<usize> = self
            .slots
            .iter()
            .enumerate()
            .filter(|(_, s)| s.item == Some(item_type))
            .map(|(i, _)| i)
            .collect();

        // Sort by quantity (ascending) to empty smaller stacks first
        slots_with_item.sort_by_key(|&i| self.slots[i].quantity);

        for slot_idx in slots_with_item {
            if count == 0 {
                break;
            }
            let slot = &mut self.slots[slot_idx];
            let remove = slot.quantity.min(count);
            slot.quantity -= remove;
            count -= remove;

            if slot.quantity == 0 {
                slot.item = None;
            }
        }

        true
    }

    /// Get the item in a specific slot
    pub fn get_slot(&self, index: usize) -> Option<&InventorySlot> {
        self.slots.get(index)
    }

    /// Get a mutable reference to a specific slot
    pub fn get_slot_mut(&mut self, index: usize) -> Option<&mut InventorySlot> {
        self.slots.get_mut(index)
    }

    /// Swap two inventory slots
    pub fn swap_slots(&mut self, a: usize, b: usize) {
        if a < INVENTORY_SLOTS && b < INVENTORY_SLOTS {
            self.slots.swap(a, b);
        }
    }

    /// Try to split a stack, moving half to another slot
    /// Returns true if split was successful
    pub fn split_stack(&mut self, from_slot: usize, to_slot: usize) -> bool {
        if from_slot >= INVENTORY_SLOTS || to_slot >= INVENTORY_SLOTS {
            return false;
        }

        let from = &self.slots[from_slot];
        if from.item.is_none() || from.quantity <= 1 {
            return false;
        }

        let to = &self.slots[to_slot];
        if to.item.is_some() {
            return false;
        }

        let item = from.item.unwrap();
        let split_amount = self.slots[from_slot].quantity / 2;

        self.slots[from_slot].quantity -= split_amount;
        self.slots[to_slot] = InventorySlot {
            item: Some(item),
            quantity: split_amount,
        };

        true
    }
}

/// Component for item drops
#[derive(Component)]
pub struct ItemDrop {
    pub item_type: ItemType,
    pub position: Vec3,
}
