//! Prop persistence - saving and loading prop placements.
//!
//! This module handles serialization of prop placement data to disk,
//! enabling a "calculate once, persist forever" approach where props
//! are precisely placed using physics simulation once and then loaded
//! from disk on subsequent runs.

pub mod schema;
pub mod serializer;

use bevy::prelude::*;
use std::collections::{HashMap, HashSet};

pub use schema::*;
pub use serializer::*;

/// Resource tracking prop persistence state
#[derive(Resource, Default)]
pub struct PropPersistenceState {
    /// The loaded manifest (if any)
    pub manifest: Option<PropManifest>,
    /// Set of chunks that have been modified and need saving
    pub dirty_chunks: HashSet<IVec2>,
    /// Map of chunk positions to spawned entity IDs
    pub loaded_chunks: HashMap<IVec2, Vec<Entity>>,
    /// Cached prop placement data per chunk (for saving)
    pub chunk_prop_data: HashMap<IVec2, Vec<PropPlacementData>>,
}

impl PropPersistenceState {
    /// Check if a chunk is already loaded
    pub fn is_chunk_loaded(&self, chunk_pos: IVec2) -> bool {
        self.loaded_chunks.contains_key(&chunk_pos)
    }

    /// Mark a chunk as dirty (needs regeneration/saving)
    pub fn mark_dirty(&mut self, chunk_pos: IVec2) {
        self.dirty_chunks.insert(chunk_pos);
    }

    /// Mark a chunk and its neighbors as dirty
    pub fn mark_dirty_with_neighbors(&mut self, chunk_pos: IVec2) {
        self.dirty_chunks.insert(chunk_pos);
        for offset in ADJACENT_OFFSETS_2D {
            self.dirty_chunks.insert(chunk_pos + offset);
        }
    }

    /// Get all dirty chunks and clear the set
    pub fn take_dirty_chunks(&mut self) -> Vec<IVec2> {
        self.dirty_chunks.drain().collect()
    }
}

/// 8-neighbor offsets for 2D chunk adjacency
pub const ADJACENT_OFFSETS_2D: [IVec2; 8] = [
    IVec2::new(-1, -1),
    IVec2::new(0, -1),
    IVec2::new(1, -1),
    IVec2::new(-1, 0),
    IVec2::new(1, 0),
    IVec2::new(-1, 1),
    IVec2::new(0, 1),
    IVec2::new(1, 1),
];

/// Resource for edit-mode prop modifications
#[derive(Resource, Default)]
pub struct PropEditState {
    /// Chunks that have been modified by terrain editing
    pub terrain_modified_chunks: HashSet<IVec2>,
    /// Props that have been manually moved/modified
    pub modified_props: HashMap<Entity, PropModification>,
    /// Props that have been deleted
    pub deleted_props: Vec<(IVec2, u64)>, // (chunk, placement_seed)
    /// Props that have been manually added
    pub added_props: Vec<PropPlacementData>,
}

/// Types of manual prop modifications
#[derive(Clone, Debug)]
pub enum PropModification {
    Moved {
        old_pos: Vec3,
        new_pos: Vec3,
    },
    Rotated {
        old_rot: Vec3,
        new_rot: Vec3,
    },
    Scaled {
        old_scale: Vec3,
        new_scale: Vec3,
    },
    Deleted,
}

/// Marker component for props that were loaded from persistence
#[derive(Component)]
pub struct PersistedProp {
    /// The chunk this prop belongs to
    pub chunk_pos: IVec2,
    /// The placement seed for identification
    pub placement_seed: u64,
}
