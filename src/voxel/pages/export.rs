//! §11.1 — capture a clean LOD0 main-surface export from the chunk mesher, BEFORE skirts /
//! aprons / morph deformation exist. Never derived from the final Bevy `Mesh`.
//!
//! Exclusion is **structural**: the mesher already tags every vertex with its section in
//! UV1 (`barycentric_section`), so we keep only `TERRAIN_MESH_SECTION_MAIN` geometry rather
//! than stripping skirts by post-hoc geometric heuristics (plan §11.9 #2). Material weights
//! ride on `MeshData.colors`; base positions are un-morphed (morph is GPU-only).

use crate::voxel::chunk::LodLevel;
use crate::voxel::meshing::{MeshData, TERRAIN_MESH_SECTION_MAIN, barycentric_section};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::{IVec3, Vec3};
use std::fmt;

/// Clean main-surface geometry for one chunk — the only terrain input a page may consume.
/// `local_positions` are chunk-local; `world = local + world_origin()` (one representation).
#[derive(Clone)]
pub struct TerrainMainSurfaceExport {
    pub local_positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub material_weights: Vec<[f32; 4]>,
    /// Per-vertex paint override (0 = natural terrain).
    pub paint_slots: Vec<f32>,
    pub indices: Vec<u32>,
    pub chunk_pos: IVec3,
    pub lod: LodLevel,
    /// Staleness tracking for Phase 6 edit invalidation. 0 until the chunk grows a revision.
    pub revision: u64,
}

impl TerrainMainSurfaceExport {
    /// World-space origin to add to `local_positions` (chunk min corner).
    pub fn world_origin(&self) -> Vec3 {
        VoxelWorld::chunk_to_world(self.chunk_pos).as_vec3()
    }
}

#[derive(Debug)]
pub enum ClodExportError {
    /// Section tags missing/mismatched — cannot exclude skirts structurally (plan §11.9 #2).
    MissingSectionTags {
        chunk: IVec3,
        verts: usize,
        tags: usize,
    },
    /// Surface Nets always emits per-vertex material weights in `colors`; absence is a bug.
    MissingMaterialWeights {
        chunk: IVec3,
        verts: usize,
        colors: usize,
    },
    /// Geometry exists but none of it is main surface — never bake skirt-only into a page.
    MainSurfaceEmptyWithGeometry { chunk: IVec3 },
}

impl fmt::Display for ClodExportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClodExportError::MissingSectionTags { chunk, verts, tags } => write!(
                f,
                "MissingSectionTags at {chunk:?}: {verts} verts but {tags} section tags"
            ),
            ClodExportError::MissingMaterialWeights {
                chunk,
                verts,
                colors,
            } => write!(
                f,
                "MissingMaterialWeights at {chunk:?}: {verts} verts but {colors} colors"
            ),
            ClodExportError::MainSurfaceEmptyWithGeometry { chunk } => {
                write!(
                    f,
                    "MainSurfaceEmptyWithGeometry at {chunk:?}: all geometry is non-main"
                )
            }
        }
    }
}

impl std::error::Error for ClodExportError {}

/// Keep only `TERRAIN_MESH_SECTION_MAIN` vertices/triangles from a chunk's solid `MeshData`,
/// compacting to a tight main-only buffer. The caller must pass the in-memory `MeshData`
/// from the mesher (before `into_mesh`), never a built `Mesh`.
pub fn extract_main_surface_for_clod(
    solid: &MeshData,
    chunk_pos: IVec3,
    lod: LodLevel,
    revision: u64,
) -> Result<TerrainMainSurfaceExport, ClodExportError> {
    let n = solid.positions.len();
    if solid.barycentric_uvs.len() != n {
        return Err(ClodExportError::MissingSectionTags {
            chunk: chunk_pos,
            verts: n,
            tags: solid.barycentric_uvs.len(),
        });
    }
    if solid.colors.len() != n {
        return Err(ClodExportError::MissingMaterialWeights {
            chunk: chunk_pos,
            verts: n,
            colors: solid.colors.len(),
        });
    }

    let mut remap = vec![u32::MAX; n];
    let mut local_positions = Vec::new();
    let mut normals = Vec::new();
    let mut material_weights = Vec::new();
    let mut paint_slots = Vec::new();
    for i in 0..n {
        if barycentric_section(solid.barycentric_uvs[i]) == TERRAIN_MESH_SECTION_MAIN {
            remap[i] = local_positions.len() as u32;
            local_positions.push(solid.positions[i]);
            normals.push(solid.normals[i]);
            material_weights.push(solid.colors[i]);
            // TODO: extract real paint slot from MeshData when available
            paint_slots.push(0.0);
        }
    }

    let mut indices = Vec::new();
    for tri in solid.indices.chunks_exact(3) {
        let (a, b, c) = (
            remap[tri[0] as usize],
            remap[tri[1] as usize],
            remap[tri[2] as usize],
        );
        if a != u32::MAX && b != u32::MAX && c != u32::MAX {
            indices.extend_from_slice(&[a, b, c]);
        }
    }

    if local_positions.is_empty() && !solid.indices.is_empty() {
        return Err(ClodExportError::MainSurfaceEmptyWithGeometry { chunk: chunk_pos });
    }

    Ok(TerrainMainSurfaceExport {
        local_positions,
        normals,
        material_weights,
        paint_slots,
        indices,
        chunk_pos,
        lod,
        revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::meshing::{
        TERRAIN_MESH_SECTION_HORIZONTAL_SKIRT, TERRAIN_MESH_SECTION_MAIN, encode_barycentric_uv,
    };

    fn push_vertex(m: &mut MeshData, pos: [f32; 3], section: u8) {
        m.positions.push(pos);
        m.normals.push([0.0, 1.0, 0.0]);
        m.colors.push([1.0, 0.0, 0.0, 0.0]);
        m.barycentric_uvs
            .push(encode_barycentric_uv([0.0, 0.0], section, 0));
    }

    #[test]
    fn keeps_main_drops_skirt() {
        let mut m = MeshData::new();
        // 4 main verts (2 tris) + 3 skirt verts (1 tri)
        for i in 0..4 {
            push_vertex(&mut m, [i as f32, 0.0, 0.0], TERRAIN_MESH_SECTION_MAIN);
        }
        for i in 0..3 {
            push_vertex(
                &mut m,
                [i as f32, 9.0, 0.0],
                TERRAIN_MESH_SECTION_HORIZONTAL_SKIRT,
            );
        }
        m.indices.extend_from_slice(&[0, 1, 2, 0, 2, 3]); // main
        m.indices.extend_from_slice(&[4, 5, 6]); // skirt

        let out =
            extract_main_surface_for_clod(&m, IVec3::new(1, 0, 2), LodLevel::Lod0, 7).unwrap();
        assert_eq!(out.local_positions.len(), 4, "only main verts kept");
        assert_eq!(out.indices.len(), 6, "only the 2 main triangles kept");
        assert_eq!(out.material_weights.len(), 4);
        assert_eq!(out.chunk_pos, IVec3::new(1, 0, 2));
        assert_eq!(out.revision, 7);
    }

    #[test]
    fn rejects_skirt_only_geometry() {
        let mut m = MeshData::new();
        for i in 0..3 {
            push_vertex(
                &mut m,
                [i as f32, 0.0, 0.0],
                TERRAIN_MESH_SECTION_HORIZONTAL_SKIRT,
            );
        }
        m.indices.extend_from_slice(&[0, 1, 2]);
        assert!(extract_main_surface_for_clod(&m, IVec3::ZERO, LodLevel::Lod0, 0).is_err());
    }
}
