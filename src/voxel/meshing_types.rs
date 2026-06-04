//! Shared types for GPU terrain geomorph (Surface Nets LOD).
//!
//! PR1 scope: the custom vertex attribute, the CPU-side config, and the error
//! type used by [`crate::voxel::meshing_lod::append_morph_targets`]. The shader,
//! material, and config-file loader land in later PRs (see
//! `docs/lod/gpu-terrain-geomorph-plan.md`).

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

/// CPU-side geomorph configuration.
///
/// In PR1 only `enabled` is read (by `append_morph_targets`); the distance fields
/// are shader uniforms wired in PR3. The YAML loader (`terrain_morph.yaml`) arrives
/// in PR2 — for now `Default` is the single source of truth and keeps morph **off**.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TerrainMorphConfig {
    /// Master gate. When `false`, `append_morph_targets` emits identity targets
    /// (`w == 0` everywhere) so the mesh is byte-for-byte the pre-geomorph result.
    pub enabled: bool,
    /// Distance at which same-chunk distance morph begins (shader uniform, PR3).
    pub morph_start_distance: f32,
    /// Distance at which same-chunk distance morph completes (shader uniform, PR3).
    pub morph_end_distance: f32,
    /// When `true`, keep CPU snap even with morph enabled (usually wrong for seams;
    /// see the plan's "Snap vs morph ordering"). Consumed by the pipeline in PR2.
    pub cpu_snap_when_morph_enabled: bool,
}

impl Default for TerrainMorphConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            morph_start_distance: 50.0,
            morph_end_distance: 60.0,
            cpu_snap_when_morph_enabled: false,
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
