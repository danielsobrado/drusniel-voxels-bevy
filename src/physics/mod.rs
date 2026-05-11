//! Physics integration with Avian physics engine.
//!
//! This module provides:
//! - [`layers`] - Collision layer definitions for filtering
//! - [`plugin`] - Bevy plugin integrating Avian physics
//! - [`terrain_collider`] - Mesh-based terrain collision generation

mod layers;
mod plugin;
mod terrain_collider;
mod terrain_collision_cache;

pub use layers::CollisionLayer as PhysicsLayer;
pub use plugin::PhysicsPlugin;
pub use terrain_collider::*;
pub use terrain_collision_cache::*;
