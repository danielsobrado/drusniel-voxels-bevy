//! Stage 1 of vertex-exact LOD seam stitching.
//!
//! A coarse chunk exports its **main-surface boundary strip** per X/Z face so that a
//! one-level-finer neighbour can later weld/stitch to the *real* coarse Surface Nets
//! geometry instead of a 1-D iso-height approximation (the root cause of the seam
//! lips/holes). This module only *extracts and represents* strips — consuming them
//! (segment matching, morph targets, stitch polygons, normals) is Stages 2–5.
//!
//! Design rules baked in from the review:
//! - **Main surface only.** Strips are extracted from the Surface Nets triangles
//!   *before* any skirt/apron geometry is appended, so a skirt never pollutes a strip.
//! - **Dedup by quantized local position.** Surface Nets emits per-triangle duplicate
//!   vertices; they are merged so edge sharing can be detected.
//! - **Match in world voxel space.** A fine chunk's `PosX` face and its coarse
//!   neighbour's `NegX` face are the *same plane*; both project to the same world
//!   frame `(along-seam world axis, world Y)`, so their boundaries are comparable
//!   despite different chunk origins. Local, world, and projected coords are all kept
//!   explicitly to avoid the coordinate-space mismatch the review warned about.
//! - **Revision signature.** A consumer can reject a stale neighbour strip, so a fine
//!   chunk never stitches against an outdated coarse boundary.
//! - **X/Z faces only** this pass. Y seams (cave/floor/ceiling topology) come later
//!   behind the same per-face abstraction.

use crate::voxel::chunk::LodLevel;
use crate::voxel::skirt::ChunkFace;
use bevy::math::{IVec3, Vec2, Vec3};
use std::collections::HashMap;

/// Local-position dedup resolution (1/256 voxel). Surface Nets vertices are well
/// inside a voxel, so this merges per-triangle duplicates without collapsing distinct
/// boundary vertices.
const STRIP_QUANTIZE: f32 = 256.0;

/// One deduplicated boundary vertex on a chunk face.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StripVertex {
    /// Chunk-local Surface Nets position (unscaled voxel units), as in `local_positions`.
    pub local: Vec3,
    /// World voxel position = `chunk_origin + local`. The shared space for matching.
    pub world: Vec3,
    /// Vertex normal (from the main-surface mesh).
    pub normal: Vec3,
    /// 2-D seam-frame coordinate `(along-seam world axis, world Y)` — the same frame on
    /// both sides of a shared plane, so fine/coarse boundaries line up.
    pub proj: Vec2,
}

/// Main-surface boundary polyline of one chunk on one X/Z face.
#[derive(Clone, Debug)]
pub struct LodBoundaryStrip {
    pub face: ChunkFace,
    pub lod: LodLevel,
    pub chunk_pos: IVec3,
    /// Staleness signature of the source mesh; a consumer rejects mismatched revisions.
    pub revision: u64,
    pub vertices: Vec<StripVertex>,
    /// Open boundary edges (used by exactly one triangle) as index pairs into
    /// `vertices` — the seam silhouette.
    pub segments: Vec<[u32; 2]>,
}

/// Only X/Z faces are stitched in this pass.
pub fn is_xz_face(face: ChunkFace) -> bool {
    matches!(
        face,
        ChunkFace::NegX | ChunkFace::PosX | ChunkFace::NegZ | ChunkFace::PosZ
    )
}

fn quantize_local(v: Vec3) -> [i32; 3] {
    [
        (v.x * STRIP_QUANTIZE).round() as i32,
        (v.y * STRIP_QUANTIZE).round() as i32,
        (v.z * STRIP_QUANTIZE).round() as i32,
    ]
}

/// Project a world-voxel position onto the seam's 2-D frame for `face`:
/// `(along-seam horizontal world axis, world Y)`. Identical on both sides of a shared
/// plane, so a fine `PosX` strip and a coarse `NegX` strip are directly comparable.
pub fn project_to_seam_frame(face: ChunkFace, world: Vec3) -> Vec2 {
    match face {
        ChunkFace::NegX | ChunkFace::PosX => Vec2::new(world.z, world.y),
        ChunkFace::NegZ | ChunkFace::PosZ => Vec2::new(world.x, world.y),
        _ => Vec2::ZERO,
    }
}

fn local_on_face(local: Vec3, face: ChunkFace, chunk_size: f32, band: f32) -> bool {
    match face {
        ChunkFace::NegX => local.x <= band,
        ChunkFace::PosX => local.x >= chunk_size - band,
        ChunkFace::NegZ => local.z <= band,
        ChunkFace::PosZ => local.z >= chunk_size - band,
        _ => false,
    }
}

/// Extract the X/Z main-surface boundary strips from a finished Surface Nets mesh.
///
/// `local_positions` / `normals` / `indices` are the **main surface only** (call this
/// before skirts are appended). `chunk_origin` is the chunk's world voxel origin
/// (`VoxelWorld::chunk_to_world`). `boundary_band` is the face-cell tolerance
/// (`my_lod.step_size()`), matching the snap/morph boundary band.
#[allow(clippy::too_many_arguments)]
pub fn extract_lod_boundary_strips(
    local_positions: &[Vec3],
    normals: &[[f32; 3]],
    indices: &[u32],
    chunk_origin: IVec3,
    chunk_size: f32,
    boundary_band: f32,
    lod: LodLevel,
    chunk_pos: IVec3,
    revision: u64,
) -> Vec<LodBoundaryStrip> {
    let origin = chunk_origin.as_vec3();
    let mut strips = Vec::new();

    for face in ChunkFace::ALL {
        if !is_xz_face(face) {
            continue;
        }

        let mut vert_index: HashMap<[i32; 3], u32> = HashMap::new();
        let mut vertices: Vec<StripVertex> = Vec::new();
        let mut intern = |i: usize| -> Option<u32> {
            let local = *local_positions.get(i)?;
            if !local_on_face(local, face, chunk_size, boundary_band) {
                return None;
            }
            let key = quantize_local(local);
            if let Some(&idx) = vert_index.get(&key) {
                return Some(idx);
            }
            let world = origin + local;
            let idx = vertices.len() as u32;
            vertices.push(StripVertex {
                local,
                world,
                normal: Vec3::from_array(normals.get(i).copied().unwrap_or([0.0, 1.0, 0.0])),
                proj: project_to_seam_frame(face, world),
            });
            vert_index.insert(key, idx);
            Some(idx)
        };

        // Count each undirected on-face edge; open edges (one triangle) are the seam.
        let mut edge_count: HashMap<(u32, u32), u32> = HashMap::new();
        for tri in indices.chunks(3) {
            if tri.len() < 3 {
                continue;
            }
            for (a, b) in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
                let (Some(ia), Some(ib)) = (intern(a as usize), intern(b as usize)) else {
                    continue;
                };
                if ia == ib {
                    continue;
                }
                let key = if ia < ib { (ia, ib) } else { (ib, ia) };
                *edge_count.entry(key).or_insert(0) += 1;
            }
        }

        let segments: Vec<[u32; 2]> = edge_count
            .iter()
            .filter(|&(_, &count)| count == 1)
            .map(|(&(a, b), _)| [a, b])
            .collect();

        if !vertices.is_empty() && !segments.is_empty() {
            strips.push(LodBoundaryStrip {
                face,
                lod,
                chunk_pos,
                revision,
                vertices,
                segments,
            });
        }
    }

    strips
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A single quad (two triangles) lying on the NegX face plane: its four perimeter
    /// edges are open (one triangle each) and form the seam; the shared diagonal is
    /// interior (two triangles) and is excluded.
    #[test]
    fn extract_negx_quad_yields_perimeter_segments() {
        // Four corners at x = 0, varying (y, z). Per-triangle duplicate verts to prove
        // dedup: the quad is two tris sharing an edge, emitted with fresh indices.
        let local_positions = vec![
            Vec3::new(0.0, 0.0, 0.0), // 0
            Vec3::new(0.0, 0.0, 2.0), // 1
            Vec3::new(0.0, 2.0, 2.0), // 2
            Vec3::new(0.0, 2.0, 0.0), // 3
        ];
        let normals = vec![[-1.0, 0.0, 0.0]; 4];
        // Tri A: 0,1,2  Tri B: 0,2,3 (shared diagonal 0-2).
        let indices = vec![0, 1, 2, 0, 2, 3];

        let strips = extract_lod_boundary_strips(
            &local_positions,
            &normals,
            &indices,
            IVec3::new(16, 0, 32),
            16.0,
            1.0,
            LodLevel::Lod0,
            IVec3::new(1, 0, 2),
            7,
        );

        let negx = strips
            .iter()
            .find(|s| s.face == ChunkFace::NegX)
            .expect("NegX strip");
        assert_eq!(negx.vertices.len(), 4, "deduped to 4 corner vertices");
        // Perimeter edges 0-1, 1-2, 2-3, 3-0 are open; diagonal 0-2 is interior.
        assert_eq!(negx.segments.len(), 4, "four open perimeter edges");
        assert!(
            !negx
                .segments
                .iter()
                .any(|&[a, b]| (a, b) == (0, 2) || (a, b) == (2, 0)),
            "shared diagonal must not be a boundary segment"
        );
        // World coords = chunk_origin + local; proj = (world.z, world.y) for X faces.
        let v0 = negx.vertices[0];
        assert_eq!(v0.world, Vec3::new(16.0, 0.0, 32.0));
        assert_eq!(v0.proj, Vec2::new(32.0, 0.0));
    }

    #[test]
    fn extract_skips_y_faces_this_pass() {
        // A quad on the NegY plane must not produce a strip (Y deferred).
        let local_positions = vec![
            Vec3::new(0.0, 0.0, 0.0),
            Vec3::new(2.0, 0.0, 0.0),
            Vec3::new(2.0, 0.0, 2.0),
            Vec3::new(0.0, 0.0, 2.0),
        ];
        let normals = vec![[0.0, -1.0, 0.0]; 4];
        let indices = vec![0, 1, 2, 0, 2, 3];
        let strips = extract_lod_boundary_strips(
            &local_positions,
            &normals,
            &indices,
            IVec3::ZERO,
            16.0,
            1.0,
            LodLevel::Lod0,
            IVec3::ZERO,
            1,
        );
        assert!(
            strips.iter().all(|s| is_xz_face(s.face)),
            "no Y-face strips in this pass"
        );
    }
}
