//! World persistence - saving and loading voxel worlds.
//!
//! This module handles serialization of the voxel world to disk using bincode
//! for efficient binary encoding.
//!
//! # Current world save format
//!
//! The default world save is `world_data.bin` in the process working directory.
//! It is a bincode 1.x serialization of [`WorldData`] using serde. The payload
//! contains the world size in chunks, the terrain-generation fingerprint active
//! when the save was written, and a list of serialized chunks. Each chunk stores
//! its chunk-space position, the full 16x16x16 voxel array in `Chunk::index`
//! order, and the chunk face-visibility mask used by occlusion culling.
//!
//! The on-disk payload does not currently include an explicit schema version,
//! prop placements, runtime mesh entities, LOD state, protected areas, editor
//! selections, undo history, or water overrides beyond water voxels already
//! present in the chunk voxel data.

use crate::constants::{CHUNK_SIZE_I32, CHUNK_VOLUME};
use crate::voxel::chunk::{Chunk, ChunkData};
use crate::voxel::materials::MaterialId;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use thiserror::Error;

use crate::terrain::generation::config::terrain_config_fingerprint;

/// Default path for world save files.
pub const WORLD_SAVE_PATH: &str = "world_data.bin";

/// Stable editor-facing contract version for DTOs in this module.
///
/// This is not written into `world_data.bin`; it versions the API shape exposed
/// to the editor backend.
pub const EDITOR_PERSISTENCE_CONTRACT_VERSION: u32 = 1;

/// Human-readable name for the current runtime save format.
pub const WORLD_SAVE_FORMAT_NAME: &str = "drusniel.voxel_world.bincode";

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

    /// Saved world was generated with a different terrain generation config.
    #[error(
        "Saved world terrain fingerprint mismatch: saved {saved:#018x}, current {current:#018x}"
    )]
    TerrainFingerprintMismatch { saved: u64, current: u64 },

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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorldData {
    /// Size of the world in chunks.
    pub world_size_chunks: IVec3,
    /// Fingerprint of terrain-generation rules used when the world was generated.
    pub terrain_config_fingerprint: u64,
    /// All chunk data.
    pub chunks: Vec<ChunkData>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct LegacyWorldData {
    pub world_size_chunks: IVec3,
    pub terrain_config_fingerprint: u64,
    pub chunks: Vec<LegacyChunkData>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct LegacyMaterialIdsWorldData {
    pub world_size_chunks: IVec3,
    pub terrain_config_fingerprint: u64,
    pub chunks: Vec<LegacyMaterialIdsChunkData>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct LegacyMaterialIdsChunkData {
    pub voxels: Vec<VoxelType>,
    #[serde(default)]
    pub material_ids: Vec<MaterialId>,
    pub position: IVec3,
    #[serde(default)]
    pub face_visibility: crate::voxel::chunk::FaceVisibility,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct LegacyChunkData {
    pub voxels: Vec<VoxelType>,
    pub position: IVec3,
    #[serde(default)]
    pub face_visibility: crate::voxel::chunk::FaceVisibility,
}

impl From<LegacyWorldData> for WorldData {
    fn from(data: LegacyWorldData) -> Self {
        Self {
            world_size_chunks: data.world_size_chunks,
            terrain_config_fingerprint: data.terrain_config_fingerprint,
            chunks: data
                .chunks
                .into_iter()
                .map(|chunk| ChunkData {
                    voxels: chunk.voxels,
                    material_overrides: Vec::new(),
                    position: chunk.position,
                    face_visibility: chunk.face_visibility,
                })
                .collect(),
        }
    }
}

impl From<LegacyMaterialIdsWorldData> for WorldData {
    fn from(data: LegacyMaterialIdsWorldData) -> Self {
        Self {
            world_size_chunks: data.world_size_chunks,
            terrain_config_fingerprint: data.terrain_config_fingerprint,
            chunks: data
                .chunks
                .into_iter()
                .map(|chunk| {
                    Chunk::data_from_legacy_material_ids(
                        chunk.voxels,
                        chunk.material_ids,
                        chunk.position,
                        chunk.face_visibility,
                    )
                })
                .collect(),
        }
    }
}

/// Editor-facing metadata for a serialized voxel world.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EditorWorldMetadata {
    pub contract_version: u32,
    pub format_name: String,
    /// The existing binary file has no embedded version field.
    pub on_disk_format_version: Option<u32>,
    pub save_path: String,
    pub world_size_chunks: [i32; 3],
    pub world_size_voxels: [i32; 3],
    pub chunk_size: i32,
    pub chunk_volume: usize,
    pub chunk_count: usize,
    pub terrain_config_fingerprint: u64,
    pub current_terrain_config_fingerprint: u64,
    pub terrain_fingerprint_matches: bool,
    pub includes_chunk_positions: bool,
    pub includes_voxels: bool,
    pub includes_face_visibility: bool,
    pub includes_props: bool,
    pub includes_water_overrides: bool,
    pub includes_protected_areas: bool,
}

/// Editor-facing summary of the default saved world file.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EditorWorldSummary {
    pub exists: bool,
    pub save_path: String,
    pub file_size_bytes: Option<u64>,
    pub modified_unix_ms: Option<u64>,
    pub metadata: Option<EditorWorldMetadata>,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
}

/// Editor-facing summary of one persisted chunk.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EditorChunkSummary {
    pub position: [i32; 3],
    pub voxel_count: usize,
    pub non_air_voxels: usize,
    pub solid_voxels: usize,
    pub liquid_voxels: usize,
    pub water_voxels: usize,
    pub face_visibility_mask: u16,
}

/// Editor-facing save command result.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EditorSaveResult {
    pub saved: bool,
    pub save_path: String,
    pub metadata: Option<EditorWorldMetadata>,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
}

/// Editor-facing load command result.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct EditorLoadResult {
    pub loaded: bool,
    pub save_path: String,
    pub metadata: Option<EditorWorldMetadata>,
    pub error_kind: Option<String>,
    pub error_message: Option<String>,
}

/// Saves the world to disk using bincode for fast serialization.
///
/// # Arguments
/// * `world` - The voxel world to save
///
/// # Returns
/// `Ok(())` on success, or a `PersistenceError` on failure.
pub fn save_world(world: &VoxelWorld) -> Result<(), PersistenceError> {
    save_world_to_path(world, WORLD_SAVE_PATH)
}

/// Saves the world to a specific path using the existing bincode world format.
pub fn save_world_to_path(
    world: &VoxelWorld,
    path: impl AsRef<Path>,
) -> Result<(), PersistenceError> {
    let path = path.as_ref();
    let path_string = path_to_string(path);
    let data = world.to_data();

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| PersistenceError::FileAccess {
                path: path_to_string(parent),
                source: e,
            })?;
        }
    }

    let file = File::create(path).map_err(|e| PersistenceError::FileAccess {
        path: path_string.clone(),
        source: e,
    })?;
    let writer = BufWriter::new(file);

    bincode::serialize_into(writer, &data)?;

    info!(
        "World saved to {} ({} chunks, terrain fp {:#018x})",
        path_string,
        data.chunks.len(),
        data.terrain_config_fingerprint
    );
    Ok(())
}

/// Loads the world from disk.
///
/// # Returns
/// The loaded `VoxelWorld` on success, or a `PersistenceError` on failure.
pub fn load_world() -> Result<VoxelWorld, PersistenceError> {
    load_world_from_path(WORLD_SAVE_PATH)
}

/// Loads a world from a specific path and validates the terrain fingerprint.
pub fn load_world_from_path(path: impl AsRef<Path>) -> Result<VoxelWorld, PersistenceError> {
    let path = path.as_ref();
    let path_string = path_to_string(path);
    let data = read_world_data_from_path(path)?;
    let current_fingerprint = terrain_config_fingerprint();
    if data.terrain_config_fingerprint != current_fingerprint {
        return Err(PersistenceError::TerrainFingerprintMismatch {
            saved: data.terrain_config_fingerprint,
            current: current_fingerprint,
        });
    }

    info!(
        "World loaded from {} ({} chunks, terrain fp {:#018x})",
        path_string,
        data.chunks.len(),
        data.terrain_config_fingerprint
    );

    Ok(VoxelWorld::from_data(data))
}

/// Reads serialized world data from disk without validating terrain compatibility.
///
/// This is useful for editor metadata and diagnostics. Use [`load_world`] or
/// [`load_world_from_path`] when the world will be used as runtime terrain.
pub fn read_world_data_from_path(path: impl AsRef<Path>) -> Result<WorldData, PersistenceError> {
    let path = path.as_ref();
    let path_string = path_to_string(path);

    if !path.exists() {
        return Err(PersistenceError::NotFound(path_string));
    }

    let file = File::open(path).map_err(|e| PersistenceError::FileAccess {
        path: path_string.clone(),
        source: e,
    })?;
    let reader = BufReader::new(file);

    match bincode::deserialize_from(reader) {
        Ok(data) => Ok(data),
        Err(new_format_error) => {
            let file = File::open(path).map_err(|e| PersistenceError::FileAccess {
                path: path_string.clone(),
                source: e,
            })?;
            let reader = BufReader::new(file);
            if let Ok(data) = bincode::deserialize_from::<_, LegacyMaterialIdsWorldData>(reader) {
                return Ok(data.into());
            }

            let file = File::open(path).map_err(|e| PersistenceError::FileAccess {
                path: path_string.clone(),
                source: e,
            })?;
            let reader = BufReader::new(file);
            bincode::deserialize_from::<_, LegacyWorldData>(reader)
                .map(Into::into)
                .map_err(|_| PersistenceError::Serialization(new_format_error))
        }
    }
}

/// Reads serialized world data from an in-memory bincode payload.
pub fn read_world_data_from_bytes(bytes: &[u8]) -> Result<WorldData, PersistenceError> {
    match bincode::deserialize(bytes) {
        Ok(data) => Ok(data),
        Err(new_format_error) => {
            if let Ok(data) = bincode::deserialize::<LegacyMaterialIdsWorldData>(bytes) {
                return Ok(data.into());
            }
            bincode::deserialize::<LegacyWorldData>(bytes)
                .map(Into::into)
                .map_err(|_| PersistenceError::Serialization(new_format_error))
        }
    }
}

/// Checks if a saved world exists.
///
/// # Returns
/// `true` if a save file exists at `WORLD_SAVE_PATH`, `false` otherwise.
pub fn saved_world_exists() -> bool {
    saved_world_exists_at_path(WORLD_SAVE_PATH)
}

/// Checks if a saved world exists at a specific path.
pub fn saved_world_exists_at_path(path: impl AsRef<Path>) -> bool {
    path.as_ref().exists()
}

/// Deletes the saved world file.
///
/// # Returns
/// `Ok(())` on success (including if no file existed), or a `PersistenceError` on failure.
pub fn delete_saved_world() -> Result<(), PersistenceError> {
    delete_saved_world_at_path(WORLD_SAVE_PATH)
}

/// Deletes a saved world file at a specific path.
pub fn delete_saved_world_at_path(path: impl AsRef<Path>) -> Result<(), PersistenceError> {
    let path = path.as_ref();
    let path_string = path_to_string(path);
    if path.exists() {
        fs::remove_file(path).map_err(|e| PersistenceError::DeleteFailed {
            path: path_string.clone(),
            source: e,
        })?;
        info!("Deleted saved world at {}", path_string);
    }
    Ok(())
}

/// Editor command foundation: load the default world and return serializable status.
pub fn editor_load_default_world() -> EditorLoadResult {
    editor_load_world_from_path(WORLD_SAVE_PATH)
}

/// Editor command foundation: save the default world and return serializable status.
pub fn editor_save_default_world(world: &VoxelWorld) -> EditorSaveResult {
    editor_save_world_to_path(world, WORLD_SAVE_PATH)
}

/// Editor command foundation: check whether the default saved world exists.
pub fn editor_saved_world_exists() -> bool {
    saved_world_exists()
}

/// Editor command foundation: delete the default saved world.
pub fn editor_delete_saved_world() -> EditorSaveResult {
    let save_path = WORLD_SAVE_PATH.to_string();
    match delete_saved_world() {
        Ok(()) => EditorSaveResult {
            saved: false,
            save_path,
            metadata: None,
            error_kind: None,
            error_message: None,
        },
        Err(error) => editor_save_error(save_path, error),
    }
}

/// Editor command foundation: export metadata for the default saved world.
pub fn editor_export_world_metadata() -> Result<EditorWorldMetadata, PersistenceError> {
    editor_export_world_metadata_from_path(WORLD_SAVE_PATH)
}

/// Editor command foundation: return summaries for chunks in the default save.
pub fn editor_get_chunk_summaries() -> Result<Vec<EditorChunkSummary>, PersistenceError> {
    editor_get_chunk_summaries_from_path(WORLD_SAVE_PATH)
}

/// Path-aware editor load helper for tests and future backend adapters.
pub fn editor_load_world_from_path(path: impl AsRef<Path>) -> EditorLoadResult {
    let path = path.as_ref();
    let save_path = path_to_string(path);
    match read_world_data_from_path(path) {
        Ok(data) => EditorLoadResult {
            loaded: true,
            metadata: Some(editor_world_metadata_from_data(&data, &save_path)),
            save_path,
            error_kind: None,
            error_message: None,
        },
        Err(error) => editor_load_error(save_path, error),
    }
}

/// Path-aware editor save helper for tests and future backend adapters.
pub fn editor_save_world_to_path(world: &VoxelWorld, path: impl AsRef<Path>) -> EditorSaveResult {
    let path = path.as_ref();
    let save_path = path_to_string(path);
    match save_world_to_path(world, path) {
        Ok(()) => {
            let data = world.to_data();
            EditorSaveResult {
                saved: true,
                metadata: Some(editor_world_metadata_from_data(&data, &save_path)),
                save_path,
                error_kind: None,
                error_message: None,
            }
        }
        Err(error) => editor_save_error(save_path, error),
    }
}

/// Path-aware editor metadata export helper.
pub fn editor_export_world_metadata_from_path(
    path: impl AsRef<Path>,
) -> Result<EditorWorldMetadata, PersistenceError> {
    let path = path.as_ref();
    let save_path = path_to_string(path);
    let data = read_world_data_from_path(path)?;
    Ok(editor_world_metadata_from_data(&data, &save_path))
}

/// Path-aware editor chunk summary helper.
pub fn editor_get_chunk_summaries_from_path(
    path: impl AsRef<Path>,
) -> Result<Vec<EditorChunkSummary>, PersistenceError> {
    let data = read_world_data_from_path(path)?;
    Ok(data.chunks.iter().map(editor_chunk_summary).collect())
}

/// Returns a serializable summary for the default saved world.
pub fn editor_default_world_summary() -> EditorWorldSummary {
    editor_world_summary_from_path(WORLD_SAVE_PATH)
}

/// Returns a serializable summary for a saved world at a specific path.
pub fn editor_world_summary_from_path(path: impl AsRef<Path>) -> EditorWorldSummary {
    let path = path.as_ref();
    let save_path = path_to_string(path);
    let file_metadata = fs::metadata(path);
    let exists = file_metadata.is_ok();
    let file_size_bytes = file_metadata.as_ref().ok().map(|metadata| metadata.len());
    let modified_unix_ms = file_metadata
        .as_ref()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64);

    match editor_export_world_metadata_from_path(path) {
        Ok(metadata) => EditorWorldSummary {
            exists: true,
            save_path,
            file_size_bytes,
            modified_unix_ms,
            metadata: Some(metadata),
            error_kind: None,
            error_message: None,
        },
        Err(PersistenceError::NotFound(_)) => EditorWorldSummary {
            exists: false,
            save_path,
            file_size_bytes: None,
            modified_unix_ms: None,
            metadata: None,
            error_kind: None,
            error_message: None,
        },
        Err(error) => EditorWorldSummary {
            exists,
            save_path,
            file_size_bytes,
            modified_unix_ms,
            metadata: None,
            error_kind: Some(persistence_error_kind(&error).to_string()),
            error_message: Some(error.to_string()),
        },
    }
}

fn editor_world_metadata_from_data(data: &WorldData, save_path: &str) -> EditorWorldMetadata {
    let world_size_voxels = data.world_size_chunks * CHUNK_SIZE_I32;
    let current_terrain_config_fingerprint = terrain_config_fingerprint();
    EditorWorldMetadata {
        contract_version: EDITOR_PERSISTENCE_CONTRACT_VERSION,
        format_name: WORLD_SAVE_FORMAT_NAME.to_string(),
        on_disk_format_version: None,
        save_path: save_path.to_string(),
        world_size_chunks: ivec3_to_array(data.world_size_chunks),
        world_size_voxels: ivec3_to_array(world_size_voxels),
        chunk_size: CHUNK_SIZE_I32,
        chunk_volume: CHUNK_VOLUME,
        chunk_count: data.chunks.len(),
        terrain_config_fingerprint: data.terrain_config_fingerprint,
        current_terrain_config_fingerprint,
        terrain_fingerprint_matches: data.terrain_config_fingerprint
            == current_terrain_config_fingerprint,
        includes_chunk_positions: true,
        includes_voxels: true,
        includes_face_visibility: true,
        includes_props: false,
        includes_water_overrides: false,
        includes_protected_areas: false,
    }
}

/// Internal adapter for the editor bridge HTTP layer.
pub(crate) fn editor_world_metadata_from_data_for_bridge(
    data: &WorldData,
    save_path: &str,
) -> EditorWorldMetadata {
    editor_world_metadata_from_data(data, save_path)
}

fn editor_chunk_summary(data: &ChunkData) -> EditorChunkSummary {
    let non_air_voxels = data
        .voxels
        .iter()
        .filter(|voxel| **voxel != VoxelType::Air)
        .count();
    let solid_voxels = data.voxels.iter().filter(|voxel| voxel.is_solid()).count();
    let liquid_voxels = data.voxels.iter().filter(|voxel| voxel.is_liquid()).count();
    let water_voxels = data
        .voxels
        .iter()
        .filter(|voxel| **voxel == VoxelType::Water)
        .count();

    EditorChunkSummary {
        position: ivec3_to_array(data.position),
        voxel_count: data.voxels.len(),
        non_air_voxels,
        solid_voxels,
        liquid_voxels,
        water_voxels,
        face_visibility_mask: data.face_visibility.0,
    }
}

/// Internal adapter for the editor bridge HTTP layer.
pub(crate) fn editor_chunk_summary_for_bridge(data: &ChunkData) -> EditorChunkSummary {
    editor_chunk_summary(data)
}

fn editor_load_error(save_path: String, error: PersistenceError) -> EditorLoadResult {
    EditorLoadResult {
        loaded: false,
        save_path,
        metadata: None,
        error_kind: Some(persistence_error_kind(&error).to_string()),
        error_message: Some(error.to_string()),
    }
}

fn editor_save_error(save_path: String, error: PersistenceError) -> EditorSaveResult {
    EditorSaveResult {
        saved: false,
        save_path,
        metadata: None,
        error_kind: Some(persistence_error_kind(&error).to_string()),
        error_message: Some(error.to_string()),
    }
}

fn persistence_error_kind(error: &PersistenceError) -> &'static str {
    match error {
        PersistenceError::FileAccess { .. } => "FileAccess",
        PersistenceError::Serialization(_) => "Serialization",
        PersistenceError::TerrainFingerprintMismatch { .. } => "TerrainFingerprintMismatch",
        PersistenceError::NotFound(_) => "NotFound",
        PersistenceError::DeleteFailed { .. } => "DeleteFailed",
    }
}

fn ivec3_to_array(value: IVec3) -> [i32; 3] {
    [value.x, value.y, value.z]
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Resource to control world persistence behavior
#[derive(Resource, Clone, Debug)]
pub struct WorldPersistence {
    /// World save path used by runtime loading/saving.
    pub path: PathBuf,
    /// Force regeneration even if saved world exists
    pub force_regenerate: bool,
    /// Auto-save world after generation
    pub auto_save: bool,
    /// Load saved world data even if the terrain-generation fingerprint changed.
    ///
    /// This is intended for deterministic bench caches where startup cost and
    /// scene stability matter more than automatically tracking terrain config
    /// changes. Normal runtime loads should keep strict fingerprint validation.
    pub allow_terrain_fingerprint_mismatch: bool,
}

impl Default for WorldPersistence {
    fn default() -> Self {
        Self {
            path: PathBuf::from(WORLD_SAVE_PATH),
            force_regenerate: true, // Force regeneration to ensure fresh terrain
            auto_save: true,
            allow_terrain_fingerprint_mismatch: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::config::terrain_config_fingerprint;
    use bevy::prelude::IVec3;
    use tempfile::NamedTempFile;

    fn mismatched_world_data() -> WorldData {
        WorldData {
            world_size_chunks: IVec3::new(1, 1, 1),
            terrain_config_fingerprint: terrain_config_fingerprint() ^ 0xA5A5_A5A5_A5A5_A5A5,
            chunks: Vec::new(),
        }
    }

    fn write_world_data(data: &WorldData) -> NamedTempFile {
        let file = NamedTempFile::new().expect("temp save file should be created");
        bincode::serialize_into(file.as_file(), data).expect("world data should serialize");
        file
    }

    #[test]
    fn strict_runtime_load_rejects_terrain_fingerprint_mismatch() {
        let data = mismatched_world_data();
        let file = write_world_data(&data);

        let error = match load_world_from_path(file.path()) {
            Ok(_) => panic!("strict load should reject mismatch"),
            Err(error) => error,
        };

        assert!(matches!(
            error,
            PersistenceError::TerrainFingerprintMismatch { .. }
        ));
    }

    #[test]
    fn editor_load_allows_terrain_fingerprint_mismatch_with_metadata_flag() {
        let data = mismatched_world_data();
        let file = write_world_data(&data);

        let result = editor_load_world_from_path(file.path());

        assert!(result.loaded);
        assert_eq!(result.error_kind, None);
        let metadata = result.metadata.expect("editor load should return metadata");
        assert_eq!(
            metadata.terrain_config_fingerprint,
            data.terrain_config_fingerprint
        );
        assert!(!metadata.terrain_fingerprint_matches);
    }
}
