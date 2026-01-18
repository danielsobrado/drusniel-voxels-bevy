//! Prop persistence serialization - save/load functions.
//!
//! Handles reading and writing prop data to/from disk in JSON format.
//! Supports chunk-based storage for incremental loading and saving.

use super::schema::*;
use bevy::prelude::*;
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use thiserror::Error;

/// Default directory for prop save files
const PROPS_SAVE_DIR: &str = "saves/props";
const MANIFEST_FILENAME: &str = "props_manifest.json";
const CHUNKS_SUBDIR: &str = "chunks";

/// Errors that can occur during prop persistence operations
#[derive(Debug, Error)]
pub enum PropPersistenceError {
    /// Failed to create or open a file
    #[error("Failed to access file '{path}': {source}")]
    FileAccess {
        path: String,
        #[source]
        source: std::io::Error,
    },

    /// Failed to serialize/deserialize prop data
    #[error("Failed to serialize prop data: {0}")]
    Serialization(#[from] serde_json::Error),

    /// No saved props exist at the expected path
    #[error("No saved props found at '{0}'")]
    NotFound(String),

    /// Failed to create directory
    #[error("Failed to create directory '{path}': {source}")]
    DirectoryCreation {
        path: String,
        #[source]
        source: std::io::Error,
    },

    /// Failed to delete file
    #[error("Failed to delete file '{path}': {source}")]
    DeleteFailed {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

/// Get the base props save directory
pub fn props_save_dir() -> PathBuf {
    PathBuf::from(PROPS_SAVE_DIR)
}

/// Get the manifest file path
pub fn manifest_path() -> PathBuf {
    props_save_dir().join(MANIFEST_FILENAME)
}

/// Get the chunks directory path
pub fn chunks_dir() -> PathBuf {
    props_save_dir().join(CHUNKS_SUBDIR)
}

/// Get the file path for a specific chunk
pub fn chunk_file_path(chunk_pos: IVec2) -> PathBuf {
    chunks_dir().join(format!("chunk_{}_{}.json", chunk_pos.x, chunk_pos.y))
}

/// Ensure the save directories exist
pub fn ensure_save_dirs() -> Result<(), PropPersistenceError> {
    let chunks_path = chunks_dir();
    if !chunks_path.exists() {
        fs::create_dir_all(&chunks_path).map_err(|e| PropPersistenceError::DirectoryCreation {
            path: chunks_path.display().to_string(),
            source: e,
        })?;
    }
    Ok(())
}

/// Check if prop persistence data exists
pub fn saved_props_exist() -> bool {
    manifest_path().exists()
}

/// Load the prop manifest from disk
pub fn load_manifest() -> Result<PropManifest, PropPersistenceError> {
    let path = manifest_path();

    if !path.exists() {
        return Err(PropPersistenceError::NotFound(path.display().to_string()));
    }

    let file = File::open(&path).map_err(|e| PropPersistenceError::FileAccess {
        path: path.display().to_string(),
        source: e,
    })?;
    let reader = BufReader::new(file);

    let manifest: PropManifest = serde_json::from_reader(reader)?;

    info!(
        "Loaded prop manifest: {} chunks, {} total props",
        manifest.chunk_files.len(),
        manifest.metadata.total_props
    );

    Ok(manifest)
}

/// Save the prop manifest to disk
pub fn save_manifest(manifest: &PropManifest) -> Result<(), PropPersistenceError> {
    ensure_save_dirs()?;

    let path = manifest_path();
    let file = File::create(&path).map_err(|e| PropPersistenceError::FileAccess {
        path: path.display().to_string(),
        source: e,
    })?;
    let writer = BufWriter::new(file);

    serde_json::to_writer_pretty(writer, manifest)?;

    info!(
        "Saved prop manifest: {} chunks, {} total props",
        manifest.chunk_files.len(),
        manifest.metadata.total_props
    );

    Ok(())
}

/// Load props for a specific chunk from disk
pub fn load_chunk_props(chunk_pos: IVec2) -> Result<Option<ChunkPropData>, PropPersistenceError> {
    let path = chunk_file_path(chunk_pos);

    if !path.exists() {
        return Ok(None);
    }

    let file = File::open(&path).map_err(|e| PropPersistenceError::FileAccess {
        path: path.display().to_string(),
        source: e,
    })?;
    let reader = BufReader::new(file);

    let data: ChunkPropData = serde_json::from_reader(reader)?;

    Ok(Some(data))
}

/// Save props for a specific chunk to disk
pub fn save_chunk_props(
    chunk_pos: IVec2,
    props: &[PropPlacementData],
) -> Result<String, PropPersistenceError> {
    ensure_save_dirs()?;

    let data = ChunkPropData::new(chunk_pos, props.to_vec());
    let path = chunk_file_path(chunk_pos);

    let file = File::create(&path).map_err(|e| PropPersistenceError::FileAccess {
        path: path.display().to_string(),
        source: e,
    })?;
    let writer = BufWriter::new(file);

    serde_json::to_writer_pretty(writer, &data)?;

    // Calculate hash for manifest
    let hash = calculate_chunk_hash(props);

    Ok(hash)
}

/// Delete a chunk's prop file
pub fn delete_chunk_props(chunk_pos: IVec2) -> Result<(), PropPersistenceError> {
    let path = chunk_file_path(chunk_pos);

    if path.exists() {
        fs::remove_file(&path).map_err(|e| PropPersistenceError::DeleteFailed {
            path: path.display().to_string(),
            source: e,
        })?;
    }

    Ok(())
}

/// Delete all saved prop data
pub fn delete_all_props() -> Result<(), PropPersistenceError> {
    let save_dir = props_save_dir();

    if save_dir.exists() {
        fs::remove_dir_all(&save_dir).map_err(|e| PropPersistenceError::DeleteFailed {
            path: save_dir.display().to_string(),
            source: e,
        })?;
        info!("Deleted all saved prop data");
    }

    Ok(())
}

/// Calculate a hash for a set of props (for change detection)
fn calculate_chunk_hash(props: &[PropPlacementData]) -> String {
    let mut hasher = DefaultHasher::new();

    for prop in props {
        prop.id.hash(&mut hasher);
        // Hash position with fixed precision
        ((prop.position[0] * 1000.0) as i64).hash(&mut hasher);
        ((prop.position[1] * 1000.0) as i64).hash(&mut hasher);
        ((prop.position[2] * 1000.0) as i64).hash(&mut hasher);
        prop.placement_seed.hash(&mut hasher);
    }

    format!("{:016x}", hasher.finish())
}

/// Load or generate props for a chunk
///
/// If persisted data exists, load it. Otherwise return None so the caller
/// can generate new props.
pub fn load_chunk_props_if_exists(chunk_pos: IVec2) -> Option<Vec<PropPlacementData>> {
    match load_chunk_props(chunk_pos) {
        Ok(Some(data)) => Some(data.props),
        Ok(None) => None,
        Err(e) => {
            warn!("Failed to load chunk props at {:?}: {}", chunk_pos, e);
            None
        }
    }
}

/// Save chunk props and update manifest
pub fn save_chunk_and_update_manifest(
    chunk_pos: IVec2,
    props: &[PropPlacementData],
    manifest: &mut PropManifest,
) -> Result<(), PropPersistenceError> {
    let hash = save_chunk_props(chunk_pos, props)?;
    manifest.update_chunk(chunk_pos, props.len(), hash);
    save_manifest(manifest)?;
    Ok(())
}

/// Configuration for prop persistence behavior
#[derive(Resource, Clone, Debug)]
pub struct PropPersistenceConfig {
    /// Whether persistence is enabled
    pub enabled: bool,
    /// Directory for save files
    pub save_directory: String,
    /// Auto-save interval in seconds (0 = disabled)
    pub auto_save_interval: f32,
    /// Whether to use pretty-printed JSON (slower but readable)
    pub pretty_json: bool,
}

impl Default for PropPersistenceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            save_directory: PROPS_SAVE_DIR.to_string(),
            pretty_json: true,
            auto_save_interval: 0.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::props::PropType;
    use std::env::temp_dir;

    #[test]
    fn test_chunk_file_path() {
        let path = chunk_file_path(IVec2::new(5, 10));
        assert!(path.to_string_lossy().contains("chunk_5_10.json"));
    }

    #[test]
    fn test_chunk_hash_deterministic() {
        let props = vec![
            PropPlacementData::new(
                "test".to_string(),
                PropType::Tree,
                Vec3::new(1.0, 2.0, 3.0),
                Vec3::ZERO,
                Vec3::ONE,
                100,
            ),
        ];

        let hash1 = calculate_chunk_hash(&props);
        let hash2 = calculate_chunk_hash(&props);

        assert_eq!(hash1, hash2);
    }
}
