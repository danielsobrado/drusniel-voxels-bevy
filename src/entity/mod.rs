pub mod wolf;
pub mod rabbit;
pub mod inventory;

use bevy::prelude::*;

pub use wolf::Wolf;
pub use rabbit::Rabbit;
pub use inventory::{Inventory, ItemType, ItemDrop};

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

    // Wolves
    pub wolf_max_count: usize,
    pub wolf_spawn_chance: f32,
    pub wolf_health: f32,
    pub wolf_wander_time_min: f32,
    pub wolf_wander_time_variance: f32,
    pub wolf_move_speed: f32,

    // Rabbits
    pub rabbit_max_count: usize,
    pub rabbit_spawn_step: i32,
    pub rabbit_health: f32,
    pub rabbit_hop_speed: f32,
    pub rabbit_hop_height: f32,
    pub rabbit_hop_time_min: f32,
    pub rabbit_hop_time_variance: f32,
    pub rabbit_scale: f32,
}

impl Default for EntitySpawnConfig {
    fn default() -> Self {
        Self {
            // Shared
            spawn_delay_frames: 60,
            world_scan_step: 4,
            world_size: 512,
            max_search_height: 64,

            // Wolves
            wolf_max_count: 50,
            wolf_spawn_chance: 0.50,
            wolf_health: 30.0,
            wolf_wander_time_min: 2.0,
            wolf_wander_time_variance: 3.0,
            wolf_move_speed: 0.5,

            // Rabbits
            rabbit_max_count: 20,
            rabbit_spawn_step: 25,
            rabbit_health: 10.0,
            rabbit_hop_speed: 3.0,
            rabbit_hop_height: 0.5,
            rabbit_hop_time_min: 0.5,
            rabbit_hop_time_variance: 2.0,
            rabbit_scale: 0.5,
        }
    }
}

// ============================================================================
// Shared Spawn State
// ============================================================================

/// Consolidated spawn state for all entity types
#[derive(Resource, Default)]
pub struct EntitySpawnState {
    pub wolves_spawned: bool,
    pub wolves_frame_counter: u32,
    pub rabbits_spawned: bool,
    pub rabbits_frame_counter: u32,
}

/// Run condition: wolves not yet spawned
fn should_spawn_wolves(state: Res<EntitySpawnState>) -> bool {
    !state.wolves_spawned
}

/// Run condition: rabbits not yet spawned
fn should_spawn_rabbits(state: Res<EntitySpawnState>) -> bool {
    !state.rabbits_spawned
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
            .init_resource::<EntitySpawnState>()
            .init_resource::<EntitySpawnConfig>()
            .add_systems(Startup, rabbit::setup_rabbit_assets)
            .add_systems(
                Update,
                (
                    wolf::spawn_wolves.run_if(should_spawn_wolves),
                    wolf::animate_wolves,
                    rabbit::spawn_rabbits.run_if(should_spawn_rabbits),
                    rabbit::animate_rabbits,
                    rabbit::fix_rabbit_textures,
                    handle_death,
                    process_item_drops,
                    despawn_dead.after(process_item_drops),
                ),
            );
    }
}
