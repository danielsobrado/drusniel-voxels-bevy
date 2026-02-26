//! Game entities and AI.
//!
//! This module provides:
//! - [`inventory`] - Player inventory system
//! - Entity health and death systems
//! - Item drop and collection

pub mod inventory;

use bevy::prelude::*;

pub use inventory::{
    EquippedItem, Inventory, InventorySlot, ItemDrop, ItemType, INVENTORY_COLUMNS, INVENTORY_ROWS,
    INVENTORY_SLOTS,
};

// ============================================================================
// Shared Configuration
// ============================================================================

/// Configuration for entity spawning behavior
#[derive(Resource)]
pub struct EntitySpawnConfig {
    // Shared
    pub spawn_delay_frames: u32,
    pub world_scan_step: i32,
    pub world_size: i32,
    pub max_search_height: i32,
}

impl Default for EntitySpawnConfig {
    fn default() -> Self {
        Self {
            // Shared
            spawn_delay_frames: 60,
            world_scan_step: 4,
            world_size: 512,
            max_search_height: 64,
        }
    }
}

// ============================================================================
// Shared Spawn State
// ============================================================================

/// Consolidated spawn state for all entity types
#[derive(Resource, Default)]
pub struct EntitySpawnState {
    // Placeholder if needed for other entities, currently empty as NPCs are removed
}


// ============================================================================
// Shared Utilities
// ============================================================================

/// Simple deterministic hash function returning a value in [0, 1]
pub fn simple_hash(x: i32, z: i32) -> f32 {
    let n = x
        .wrapping_mul(374761393)
        .wrapping_add(z.wrapping_mul(668265263));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    let n = n ^ (n >> 16);
    (n as u32 as f32) / (u32::MAX as f32)
}

// ============================================================================
// Health System
// ============================================================================

/// Component for entities with health
#[derive(Component)]
pub struct Health {
    pub current: f32,
    pub max: f32,
}

impl Health {
    pub fn new(max: f32) -> Self {
        Self {
            current: max,
            max,
        }
    }

    pub fn damage(&mut self, amount: f32) {
        self.current = (self.current - amount).max(0.0);
    }

    pub fn is_dead(&self) -> bool {
        self.current <= 0.0
    }
}

/// Component to mark entities that should be removed
#[derive(Component)]
pub struct Dead;

/// System to handle entity death
pub fn handle_death(
    mut commands: Commands,
    query: Query<(Entity, &Health, &Transform), (Without<Dead>, Changed<Health>)>,
) {
    for (entity, health, transform) in query.iter() {
        if health.is_dead() {
            info!("Entity died at {:?}", transform.translation);

            commands.entity(entity).insert(Dead);
            commands.entity(entity).insert(ItemDrop {
                item_type: ItemType::Fur,
                position: transform.translation,
            });
        }
    }
}

/// System to process item drops and add to inventory
pub fn process_item_drops(
    mut commands: Commands,
    query: Query<(Entity, &ItemDrop)>,
    mut inventory: ResMut<Inventory>,
) {
    for (entity, drop) in query.iter() {
        inventory.add_item(drop.item_type);
        info!("Collected {:?}! Inventory: {:?}", drop.item_type, inventory);
        commands.entity(entity).despawn();
    }
}

/// System to despawn dead entities
pub fn despawn_dead(
    mut commands: Commands,
    query: Query<Entity, With<Dead>>,
) {
    for entity in query.iter() {
        commands.entity(entity).despawn();
    }
}

// ============================================================================
// Plugin
// ============================================================================

/// Plugin for entity system
pub struct EntityPlugin;

impl Plugin for EntityPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<Inventory>()
            .init_resource::<EquippedItem>()
            .init_resource::<EntitySpawnState>()
            .init_resource::<EntitySpawnConfig>()
            .add_systems(
                Update,
                (
                    handle_death,
                    process_item_drops,
                    despawn_dead.after(process_item_drops),
                ),
            );
    }
}
