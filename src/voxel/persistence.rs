//! World persistence - saving and loading voxel worlds.
//!
//! This module handles serialization of the voxel world to disk using bincode
//! for efficient binary encoding.

use crate::voxel::chunk::ChunkData;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use serde::{Serialize, Deserialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::Path;
use thiserror::Error;

/// Default path for world save files.
const WORLD_SAVE_PATH: &str = "world_data.bin";

/// Errors that can occur during world persistence operations.
#[derive(Debug, Error)]
pub enum PersistenceError {
    /// Failed to create or open a file.
    #[error("Failed to access file '{path}': {source}")]
    FileAccess {
        path: String,
        #[source]
        source: std::io::Error,
    },

    /// Failed to serialize world data.
    #[error("Failed to serialize world data: {0}")]
    Serialization(#[from] bincode::Error),

    /// No saved world exists at the expected path.
    #[error("No saved world found at '{0}'")]
    NotFound(String),

    /// Failed to delete the save file.
    #[error("Failed to delete save file '{path}': {source}")]
    DeleteFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

/// Serializable world data.
#[derive(Serialize, Deserialize)]
pub struct WorldData {
    /// Size of the world in chunks.
    pub world_size_chunks: IVec3,
    /// All chunk data.
    pub chunks: Vec<ChunkData>,
}

/// Saves the world to disk using bincode for fast serialization.
///
/// # Arguments
/// * `world` - The voxel world to save
///
/// # Returns
/// `Ok(())` on success, or a `PersistenceError` on failure.
pub fn save_world(world: &VoxelWorld) -> Result<(), PersistenceError> {
    let data = world.to_data();

    let file = File::create(WORLD_SAVE_PATH).map_err(|e| PersistenceError::FileAccess {
        path: WORLD_SAVE_PATH.to_string(),
        source: e,
    })?;
    let writer = BufWriter::new(file);

    bincode::serialize_into(writer, &data)?;

    info!("World saved to {} ({} chunks)", WORLD_SAVE_PATH, data.chunks.len());
    Ok(())
}

/// Loads the world from disk.
///
/// # Returns
/// The loaded `VoxelWorld` on success, or a `PersistenceError` on failure.
pub fn load_world() -> Result<VoxelWorld, PersistenceError> {
    let path = Path::new(WORLD_SAVE_PATH);

    if !path.exists() {
        return Err(PersistenceError::NotFound(WORLD_SAVE_PATH.to_string()));
    }

    let file = File::open(path).map_err(|e| PersistenceError::FileAccess {
        path: WORLD_SAVE_PATH.to_string(),
        source: e,
    })?;
    let reader = BufReader::new(file);

    let data: WorldData = bincode::deserialize_from(reader)?;

    info!("World loaded from {} ({} chunks)", WORLD_SAVE_PATH, data.chunks.len());

    Ok(VoxelWorld::from_data(data))
}

/// Checks if a saved world exists.
///
/// # Returns
/// `true` if a save file exists at `WORLD_SAVE_PATH`, `false` otherwise.
pub fn saved_world_exists() -> bool {
    Path::new(WORLD_SAVE_PATH).exists()
}

/// Deletes the saved world file.
///
/// # Returns
/// `Ok(())` on success (including if no file existed), or a `PersistenceError` on failure.
pub fn delete_saved_world() -> Result<(), PersistenceError> {
    let path = Path::new(WORLD_SAVE_PATH);
    if path.exists() {
        fs::remove_file(path).map_err(|e| PersistenceError::DeleteFailed {
            path: WORLD_SAVE_PATH.to_string(),
            source: e,
        })?;
        info!("Deleted saved world at {}", WORLD_SAVE_PATH);
    }
    Ok(())
}

/// Resource to control world persistence behavior
#[derive(Resource, Clone, Debug)]
pub struct WorldPersistence {
    /// Force regeneration even if saved world exists
    pub force_regenerate: bool,
    /// Auto-save world after generation
    pub auto_save: bool,
}

impl Default for WorldPersistence {
    fn default() -> Self {
        Self {
            force_regenerate: true, // Force regeneration to ensure fresh terrain
            auto_save: true,
        }
    }
}
