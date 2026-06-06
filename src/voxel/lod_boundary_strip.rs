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
use bevy::prelude::Resource;
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

// ============================================================================
// Stage 2: consume + segment matching
// ============================================================================

/// Result of matching a fine boundary vertex onto a coarse boundary segment.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SeamMatch {
    /// World-voxel target on the coarse segment (the closest point, interpolated).
    pub target_world: Vec3,
    /// Coarse normal interpolated to the matched point (for Stage 5 seam normals).
    pub target_normal: Vec3,
    /// Seam-frame (2-D) distance from the fine vertex to the coarse segment. Used to
    /// reject welds beyond `max_stitch_distance`.
    pub distance: f32,
}

/// Closest point on segment `a..b` to `p`, all in seam-frame 2-D. Returns
/// `(t, distance)` where `t∈[0,1]` parameterises the segment.
fn closest_point_on_segment_2d(p: Vec2, a: Vec2, b: Vec2) -> (f32, f32) {
    let ab = b - a;
    let len_sq = ab.length_squared();
    let t = if len_sq <= f32::EPSILON {
        0.0
    } else {
        ((p - a).dot(ab) / len_sq).clamp(0.0, 1.0)
    };
    (t, p.distance(a + ab * t))
}

/// Match one fine boundary vertex (given its seam-frame projection) to the closest
/// point on the closest segment of a coarse `strip`. Returns `None` (caller falls back
/// to a skirt) when:
/// - the strip has no segments, or
/// - the closest segment is farther than `max_stitch_distance`.
///
/// Crucially this snaps to the closest point **on a segment**, never the nearest
/// vertex — that is what keeps cliffs from shearing and avoids collapsing several fine
/// verts onto one coarse vertex. (Multi-chain / fold ambiguity rejection and the
/// stitch geometry itself are Stage 4.)
pub fn match_fine_vertex_to_coarse(
    fine_proj: Vec2,
    strip: &LodBoundaryStrip,
    max_stitch_distance: f32,
) -> Option<SeamMatch> {
    let mut best: Option<SeamMatch> = None;
    for &[ia, ib] in &strip.segments {
        let (va, vb) = (
            strip.vertices.get(ia as usize)?,
            strip.vertices.get(ib as usize)?,
        );
        let (t, distance) = closest_point_on_segment_2d(fine_proj, va.proj, vb.proj);
        if best.map(|m| distance < m.distance).unwrap_or(true) {
            best = Some(SeamMatch {
                target_world: va.world.lerp(vb.world, t),
                target_normal: va.normal.lerp(vb.normal, t).normalize_or_zero(),
                distance,
            });
        }
    }
    best.filter(|m| m.distance <= max_stitch_distance.max(0.0))
}

/// Per-chunk strips plus the revision they were exported at.
#[derive(Clone, Debug, Default)]
struct CachedChunkStrips {
    revision: u64,
    strips: Vec<LodBoundaryStrip>,
}

/// Process-wide, **non-blocking** store of exported boundary strips, keyed by chunk
/// position. A chunk publishes its strips when its main-surface mesh commits; a finer
/// neighbour reads the coarse strip if present and revision-valid, and otherwise falls
/// back to a skirt — it never waits for the coarse chunk to (re)mesh. This is the
/// cross-chunk hand-off the review flagged as load-bearing; keeping it a plain lookup
/// (no dependency edge into the mesher) is what keeps the mesh queue from cascading.
#[derive(Resource, Default)]
pub struct LodBoundaryStripCache {
    chunks: HashMap<IVec3, CachedChunkStrips>,
}

impl LodBoundaryStripCache {
    /// Publish (replace) the strips for `chunk_pos` at `revision`.
    pub fn insert(&mut self, chunk_pos: IVec3, revision: u64, strips: Vec<LodBoundaryStrip>) {
        self.chunks
            .insert(chunk_pos, CachedChunkStrips { revision, strips });
    }

    /// Drop a chunk's strips (e.g. on unload), so stale boundaries are never matched.
    pub fn remove(&mut self, chunk_pos: IVec3) {
        self.chunks.remove(&chunk_pos);
    }

    /// Look up `chunk_pos`'s strip for `face`. When `expected_revision` is `Some`, a
    /// mismatched revision is treated as stale and returns `None` (skirt fallback).
    pub fn strip_for_face(
        &self,
        chunk_pos: IVec3,
        face: ChunkFace,
        expected_revision: Option<u64>,
    ) -> Option<&LodBoundaryStrip> {
        let cached = self.chunks.get(&chunk_pos)?;
        if let Some(rev) = expected_revision {
            if cached.revision != rev {
                return None;
            }
        }
        cached.strips.iter().find(|s| s.face == face)
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }
}

/// The coarse boundary strips a chunk consumes — one per X/Z face, looked up from the
/// cache for the strictly-coarser neighbour on that face (and `None` when the neighbour
/// is missing, same-LOD, finer, or its strip is stale). Stage 3 welds each fine
/// boundary vertex onto the matching coarse **segment** from these instead of the 1-D
/// iso (the lips/holes/spike root).
#[derive(Clone, Debug, Default)]
pub struct NeighborBoundaryStrips {
    pub neg_x: Option<LodBoundaryStrip>,
    pub pos_x: Option<LodBoundaryStrip>,
    pub neg_z: Option<LodBoundaryStrip>,
    pub pos_z: Option<LodBoundaryStrip>,
}

impl NeighborBoundaryStrips {
    pub fn for_face(&self, face: ChunkFace) -> Option<&LodBoundaryStrip> {
        match face {
            ChunkFace::NegX => self.neg_x.as_ref(),
            ChunkFace::PosX => self.pos_x.as_ref(),
            ChunkFace::NegZ => self.neg_z.as_ref(),
            ChunkFace::PosZ => self.pos_z.as_ref(),
            _ => None,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.neg_x.is_none() && self.pos_x.is_none() && self.neg_z.is_none() && self.pos_z.is_none()
    }
}

/// World-voxel direction from a chunk to its neighbour across `face`.
pub fn face_neighbor_offset(face: ChunkFace) -> IVec3 {
    match face {
        ChunkFace::NegX => IVec3::new(-1, 0, 0),
        ChunkFace::PosX => IVec3::new(1, 0, 0),
        ChunkFace::NegZ => IVec3::new(0, 0, -1),
        ChunkFace::PosZ => IVec3::new(0, 0, 1),
        ChunkFace::NegY => IVec3::new(0, -1, 0),
        ChunkFace::PosY => IVec3::new(0, 1, 0),
    }
}

/// The neighbour's face that shares this chunk's `face` plane (its opposite).
pub fn opposite_face(face: ChunkFace) -> ChunkFace {
    match face {
        ChunkFace::NegX => ChunkFace::PosX,
        ChunkFace::PosX => ChunkFace::NegX,
        ChunkFace::NegZ => ChunkFace::PosZ,
        ChunkFace::PosZ => ChunkFace::NegZ,
        ChunkFace::NegY => ChunkFace::PosY,
        ChunkFace::PosY => ChunkFace::NegY,
    }
}

/// Weld target for a fine boundary vertex: the closest point on the matching coarse
/// **segment** of `strip`, expressed in this chunk's local coordinates. `None` (caller
/// keeps the iso/skirt fallback) when no segment is within `max_stitch_distance`.
///
/// Both sides share the plane, so the coarse target's world position converts to local
/// simply as `target_world - chunk_origin`; the face-normal axis already lands on the
/// boundary plane because the coarse strip verts live on it.
pub fn coarse_segment_target_local(
    fine_local: Vec3,
    face: ChunkFace,
    chunk_origin: IVec3,
    strip: &LodBoundaryStrip,
    max_stitch_distance: f32,
) -> Option<Vec3> {
    let origin = chunk_origin.as_vec3();
    let fine_world = origin + fine_local;
    let matched = match_fine_vertex_to_coarse(
        project_to_seam_frame(face, fine_world),
        strip,
        max_stitch_distance,
    )?;
    let target = matched.target_world - origin;
    target.is_finite().then_some(target)
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

    /// A flat coarse NegX seam segment along z at world x=16, y=0.
    fn flat_negx_strip() -> LodBoundaryStrip {
        let v = |z: f32| StripVertex {
            local: Vec3::new(0.0, 0.0, z),
            world: Vec3::new(16.0, 0.0, z),
            normal: Vec3::new(-1.0, 0.0, 0.0),
            proj: Vec2::new(z, 0.0),
        };
        LodBoundaryStrip {
            face: ChunkFace::NegX,
            lod: LodLevel::Lod1,
            chunk_pos: IVec3::new(1, 0, 0),
            revision: 42,
            vertices: vec![v(0.0), v(4.0)],
            segments: vec![[0, 1]],
        }
    }

    #[test]
    fn match_snaps_to_closest_point_on_segment_not_vertex() {
        let strip = flat_negx_strip();
        // Fine vert above the seam midpoint: should snap onto the segment at z=2,
        // not to either coarse vertex (z=0 / z=4).
        let m = match_fine_vertex_to_coarse(Vec2::new(2.0, 0.5), &strip, 1.0).expect("match");
        assert!((m.target_world - Vec3::new(16.0, 0.0, 2.0)).length() < 1e-4);
        assert!((m.distance - 0.5).abs() < 1e-4);
    }

    #[test]
    fn match_rejects_over_distance() {
        let strip = flat_negx_strip();
        assert!(
            match_fine_vertex_to_coarse(Vec2::new(2.0, 5.0), &strip, 1.0).is_none(),
            "a vert 5 voxels off the seam must fall back to skirt, not weld"
        );
    }

    #[test]
    fn coarse_segment_target_welds_fine_vert_onto_coarse_segment() {
        // Coarse NegX strip at world x=16, z in [0,4], y=0. A fine chunk at origin 0
        // shares that plane on its PosX face; a fine boundary vert above the seam
        // midpoint should weld DOWN onto the segment (y 0.5 -> 0) at z=2.
        let strip = flat_negx_strip();
        let target = coarse_segment_target_local(
            Vec3::new(16.0, 0.5, 2.0),
            ChunkFace::PosX,
            IVec3::ZERO,
            &strip,
            1.0,
        )
        .expect("segment target");
        assert!((target - Vec3::new(16.0, 0.0, 2.0)).length() < 1e-4);

        // Too far off the seam -> no weld (caller keeps iso/skirt fallback).
        assert!(coarse_segment_target_local(
            Vec3::new(16.0, 9.0, 2.0),
            ChunkFace::PosX,
            IVec3::ZERO,
            &strip,
            1.0
        )
        .is_none());
    }

    #[test]
    fn neighbor_strips_for_face_and_opposite() {
        let mut n = NeighborBoundaryStrips::default();
        assert!(n.is_empty());
        n.pos_x = Some(flat_negx_strip());
        assert!(!n.is_empty());
        assert!(n.for_face(ChunkFace::PosX).is_some());
        assert!(n.for_face(ChunkFace::NegZ).is_none());
        assert_eq!(opposite_face(ChunkFace::PosX), ChunkFace::NegX);
        assert_eq!(face_neighbor_offset(ChunkFace::PosX), IVec3::new(1, 0, 0));
    }

    #[test]
    fn cache_is_non_blocking_and_revision_gated() {
        let mut cache = LodBoundaryStripCache::default();
        let pos = IVec3::new(1, 0, 0);
        cache.insert(pos, 42, vec![flat_negx_strip()]);

        // Present + revision match -> hit.
        assert!(cache
            .strip_for_face(pos, ChunkFace::NegX, Some(42))
            .is_some());
        // Stale revision -> miss (fall back to skirt, never block).
        assert!(cache
            .strip_for_face(pos, ChunkFace::NegX, Some(99))
            .is_none());
        // Wrong face / missing chunk -> miss.
        assert!(cache
            .strip_for_face(pos, ChunkFace::PosX, Some(42))
            .is_none());
        assert!(cache
            .strip_for_face(IVec3::new(9, 9, 9), ChunkFace::NegX, None)
            .is_none());

        cache.remove(pos);
        assert!(cache.is_empty());
    }
}
