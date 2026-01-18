//! JSON schema data structures for prop persistence.
//!
//! These structures define the format for serializing prop placement data
//! to disk. They are designed to be human-readable (JSON) during development
//! and can be switched to binary formats (bincode, rkyv) for production.

use bevy::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::props::PropType;
use crate::voxel::types::VoxelType;

/// Current schema version for migration support
pub const SCHEMA_VERSION: &str = "1.0";

/// Individual prop placement data
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PropPlacementData {
    /// Unique identifier matching the prop definition (e.g., "usn_birch_1")
    pub id: String,
    /// Type of prop (Tree, Rock, Bush, Flower)
    pub prop_type: SerializablePropType,
    /// World position (x, y, z)
    pub position: [f32; 3],
    /// Euler rotation in degrees (pitch, yaw, roll)
    pub rotation: [f32; 3],
    /// Scale (x, y, z) - usually uniform
    pub scale: [f32; 3],
    /// Information about the ground contact point
    pub ground_contact: GroundContactData,
    /// Deterministic seed used for this placement
    pub placement_seed: u64,
    /// Whether this placement passed validation
    pub validated: bool,
}

impl PropPlacementData {
    /// Create a new prop placement with default ground contact
    pub fn new(
        id: String,
        prop_type: PropType,
        position: Vec3,
        rotation: Vec3,
        scale: Vec3,
        placement_seed: u64,
    ) -> Self {
        Self {
            id,
            prop_type: prop_type.into(),
            position: position.into(),
            rotation: rotation.into(),
            scale: scale.into(),
            ground_contact: GroundContactData::default(),
            placement_seed,
            validated: false,
        }
    }

    /// Get position as Vec3
    pub fn position_vec3(&self) -> Vec3 {
        Vec3::from(self.position)
    }

    /// Get rotation as Vec3 (Euler angles in degrees)
    pub fn rotation_vec3(&self) -> Vec3 {
        Vec3::from(self.rotation)
    }

    /// Get scale as Vec3
    pub fn scale_vec3(&self) -> Vec3 {
        Vec3::from(self.scale)
    }

    /// Convert to Bevy Transform
    pub fn to_transform(&self) -> Transform {
        Transform {
            translation: self.position_vec3(),
            rotation: Quat::from_euler(
                EulerRot::XYZ,
                self.rotation[0].to_radians(),
                self.rotation[1].to_radians(),
                self.rotation[2].to_radians(),
            ),
            scale: self.scale_vec3(),
        }
    }
}

/// Serializable version of PropType
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SerializablePropType {
    Tree,
    Rock,
    Bush,
    Flower,
}

impl From<PropType> for SerializablePropType {
    fn from(pt: PropType) -> Self {
        match pt {
            PropType::Tree => SerializablePropType::Tree,
            PropType::Rock => SerializablePropType::Rock,
            PropType::Bush => SerializablePropType::Bush,
            PropType::Flower => SerializablePropType::Flower,
        }
    }
}

impl From<SerializablePropType> for PropType {
    fn from(spt: SerializablePropType) -> Self {
        match spt {
            SerializablePropType::Tree => PropType::Tree,
            SerializablePropType::Rock => PropType::Rock,
            SerializablePropType::Bush => PropType::Bush,
            SerializablePropType::Flower => PropType::Flower,
        }
    }
}

/// Ground contact information for accurate placement
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct GroundContactData {
    /// Type of voxel at the contact point
    pub terrain_type: Option<SerializableVoxelType>,
    /// Blend of surrounding terrain types (texture names -> weights)
    pub texture_blend: HashMap<String, f32>,
    /// Slope angle at contact point (degrees)
    pub slope_angle: f32,
    /// Surface normal at contact point
    pub normal: [f32; 3],
}

impl GroundContactData {
    /// Create ground contact data from analyzed terrain
    pub fn new(terrain_type: VoxelType, slope_angle: f32, normal: Vec3) -> Self {
        Self {
            terrain_type: Some(terrain_type.into()),
            texture_blend: HashMap::new(),
            slope_angle,
            normal: normal.into(),
        }
    }

    /// Get normal as Vec3
    pub fn normal_vec3(&self) -> Vec3 {
        Vec3::from(self.normal)
    }
}

/// Serializable version of VoxelType
/// Matches the actual VoxelType enum in src/voxel/types.rs
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SerializableVoxelType {
    Air,
    TopSoil,
    SubSoil,
    Rock,
    Bedrock,
    Sand,
    Clay,
    Water,
    Wood,
    Leaves,
    DungeonWall,
    DungeonFloor,
}

impl From<VoxelType> for SerializableVoxelType {
    fn from(vt: VoxelType) -> Self {
        match vt {
            VoxelType::Air => SerializableVoxelType::Air,
            VoxelType::TopSoil => SerializableVoxelType::TopSoil,
            VoxelType::SubSoil => SerializableVoxelType::SubSoil,
            VoxelType::Rock => SerializableVoxelType::Rock,
            VoxelType::Bedrock => SerializableVoxelType::Bedrock,
            VoxelType::Sand => SerializableVoxelType::Sand,
            VoxelType::Clay => SerializableVoxelType::Clay,
            VoxelType::Water => SerializableVoxelType::Water,
            VoxelType::Wood => SerializableVoxelType::Wood,
            VoxelType::Leaves => SerializableVoxelType::Leaves,
            VoxelType::DungeonWall => SerializableVoxelType::DungeonWall,
            VoxelType::DungeonFloor => SerializableVoxelType::DungeonFloor,
        }
    }
}

impl From<SerializableVoxelType> for VoxelType {
    fn from(svt: SerializableVoxelType) -> Self {
        match svt {
            SerializableVoxelType::Air => VoxelType::Air,
            SerializableVoxelType::TopSoil => VoxelType::TopSoil,
            SerializableVoxelType::SubSoil => VoxelType::SubSoil,
            SerializableVoxelType::Rock => VoxelType::Rock,
            SerializableVoxelType::Bedrock => VoxelType::Bedrock,
            SerializableVoxelType::Sand => VoxelType::Sand,
            SerializableVoxelType::Clay => VoxelType::Clay,
            SerializableVoxelType::Water => VoxelType::Water,
            SerializableVoxelType::Wood => VoxelType::Wood,
            SerializableVoxelType::Leaves => VoxelType::Leaves,
            SerializableVoxelType::DungeonWall => VoxelType::DungeonWall,
            SerializableVoxelType::DungeonFloor => VoxelType::DungeonFloor,
        }
    }
}

/// Data for a single chunk's props
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChunkPropData {
    /// Chunk position (2D, using x and z)
    pub chunk_pos: [i32; 2],
    /// All props in this chunk
    pub props: Vec<PropPlacementData>,
    /// When this chunk was last modified (ISO 8601)
    pub last_modified: String,
    /// Whether this chunk has unsaved changes
    #[serde(default)]
    pub dirty: bool,
}

impl ChunkPropData {
    /// Create new chunk prop data
    pub fn new(chunk_pos: IVec2, props: Vec<PropPlacementData>) -> Self {
        Self {
            chunk_pos: [chunk_pos.x, chunk_pos.y],
            props,
            last_modified: chrono_now(),
            dirty: false,
        }
    }

    /// Get chunk position as IVec2
    pub fn chunk_pos_ivec2(&self) -> IVec2 {
        IVec2::new(self.chunk_pos[0], self.chunk_pos[1])
    }
}

/// Manifest entry for a chunk file
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ChunkManifestEntry {
    /// Relative path to the chunk file
    pub file_path: String,
    /// Number of props in this chunk
    pub prop_count: usize,
    /// Hash for change detection
    pub hash: String,
}

/// Metadata about the prop persistence
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct PropMetadata {
    /// Total number of props across all chunks
    pub total_props: usize,
    /// Time taken for initial generation (milliseconds)
    pub placement_time_ms: u64,
    /// Number of validation errors during generation
    pub validation_errors: usize,
}

/// Root manifest for prop persistence
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PropManifest {
    /// Schema version for migration support
    pub version: String,
    /// World seed used for generation
    pub world_seed: u64,
    /// When props were initially generated (ISO 8601)
    pub generated_at: String,
    /// Map of chunk keys to manifest entries
    pub chunk_files: HashMap<String, ChunkManifestEntry>,
    /// Overall metadata
    pub metadata: PropMetadata,
}

impl PropManifest {
    /// Create a new empty manifest
    pub fn new(world_seed: u64) -> Self {
        Self {
            version: SCHEMA_VERSION.to_string(),
            world_seed,
            generated_at: chrono_now(),
            chunk_files: HashMap::new(),
            metadata: PropMetadata::default(),
        }
    }

    /// Generate a chunk key from position
    pub fn chunk_key(chunk_pos: IVec2) -> String {
        format!("{}_{}", chunk_pos.x, chunk_pos.y)
    }

    /// Add or update a chunk entry
    pub fn update_chunk(&mut self, chunk_pos: IVec2, prop_count: usize, hash: String) {
        let key = Self::chunk_key(chunk_pos);
        let file_path = format!("chunks/chunk_{}_{}.json", chunk_pos.x, chunk_pos.y);

        self.chunk_files.insert(
            key,
            ChunkManifestEntry {
                file_path,
                prop_count,
                hash,
            },
        );

        // Update total count
        self.metadata.total_props = self
            .chunk_files
            .values()
            .map(|e| e.prop_count)
            .sum();
    }

    /// Check if a chunk exists in the manifest
    pub fn has_chunk(&self, chunk_pos: IVec2) -> bool {
        self.chunk_files.contains_key(&Self::chunk_key(chunk_pos))
    }
}

impl Default for PropManifest {
    fn default() -> Self {
        Self::new(0)
    }
}

/// Get current timestamp as ISO 8601 string
fn chrono_now() -> String {
    // Simple timestamp without external dependency
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}s", duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prop_placement_roundtrip() {
        let prop = PropPlacementData::new(
            "test_tree".to_string(),
            PropType::Tree,
            Vec3::new(10.0, 20.0, 30.0),
            Vec3::new(0.0, 45.0, 0.0),
            Vec3::splat(1.0),
            12345,
        );

        let json = serde_json::to_string(&prop).unwrap();
        let loaded: PropPlacementData = serde_json::from_str(&json).unwrap();

        assert_eq!(prop.id, loaded.id);
        assert_eq!(prop.position, loaded.position);
        assert_eq!(prop.placement_seed, loaded.placement_seed);
    }

    #[test]
    fn test_manifest_chunk_key() {
        assert_eq!(PropManifest::chunk_key(IVec2::new(0, 0)), "0_0");
        assert_eq!(PropManifest::chunk_key(IVec2::new(-5, 10)), "-5_10");
    }
}
