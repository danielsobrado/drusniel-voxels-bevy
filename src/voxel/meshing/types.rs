//! Shared types for GPU terrain geomorph (Surface Nets LOD).
//!
//! The Surface Nets mesher writes per-vertex morph targets for LOD seam welding,
//! and the terrain material consumes them when the runtime morph gate is enabled.

use bevy_mesh::{MeshVertexAttribute, VertexFormat};

/// Per-vertex boundary morph target: `xyz` is the coarse-aligned local position
/// (same local space + scaling as `Mesh::ATTRIBUTE_POSITION`), `w` is the seam
/// weight (`0.0` = no morph / interior, `1.0` = full blend on a LOD-transition
/// boundary vertex).
///
/// The numeric id is an arbitrary stable value that must not collide with Bevy's
/// built-in attribute ids; it matches `docs/lod/gpu-terrain-geomorph-plan.md`.
pub const ATTRIBUTE_MORPH_TARGET: MeshVertexAttribute =
    MeshVertexAttribute::new("Vertex_MorphTarget", 987654321, VertexFormat::Float32x4);

pub const DEFAULT_TERRAIN_MORPH_MAX_STITCH_DISTANCE: f32 = 16.0;

/// CPU-side geomorph configuration.
///
/// `terrain_morph_config` owns the process-level runtime defaults. `Default` stays
/// disabled so tests and manually constructed configs are neutral unless opted in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainMorphConfig {
    /// Master gate. When `false`, the mesh keeps the legacy CPU snap/skirt path.
    pub enabled: bool,
    /// Distance at which same-chunk distance morph begins.
    pub morph_start_distance: f32,
    /// Distance at which same-chunk distance morph completes.
    pub morph_end_distance: f32,
    /// When `true`, keep CPU snap even with morph enabled (usually wrong for seams;
    /// see the plan's "Snap vs morph ordering").
    pub cpu_snap_when_morph_enabled: bool,
    /// Reject seam targets farther than this from the original fine vertex.
    pub max_stitch_distance: f32,
}

impl Default for TerrainMorphConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            morph_start_distance: 50.0,
            morph_end_distance: 60.0,
            cpu_snap_when_morph_enabled: false,
            max_stitch_distance: DEFAULT_TERRAIN_MORPH_MAX_STITCH_DISTANCE,
        }
    }
}

/// Failure modes for morph-target generation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MorphTargetError {
    /// `mesh.positions.len()` and the supplied `local_positions` length disagree,
    /// so per-vertex targets cannot be aligned to positions.
    PositionLengthMismatch {
        positions: usize,
        local_positions: usize,
    },
}
