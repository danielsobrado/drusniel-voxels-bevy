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
use std::sync::atomic::{AtomicU64, Ordering};

/// Running diagnostics for the vertex-exact seam consume, so a run can show whether the
/// publish -> lookup -> segment-weld chain is actually firing (and where it breaks).
pub static STRIPS_PUBLISHED: AtomicU64 = AtomicU64::new(0);
pub static STRIP_LOOKUPS_HIT: AtomicU64 = AtomicU64::new(0);
pub static SEGMENT_TARGETS_USED: AtomicU64 = AtomicU64::new(0);
pub static ISO_TARGETS_USED: AtomicU64 = AtomicU64::new(0);

#[inline]
pub fn bump(counter: &AtomicU64) {
    counter.fetch_add(1, Ordering::Relaxed);
}

/// Log the consume-chain counters (call at build-complete / periodically).
pub fn log_strip_diag(context: &str) {
    bevy::log::info!(
        "STRIP DIAG [{context}]: published={} lookups_hit={} segment_targets={} iso_targets={}",
        STRIPS_PUBLISHED.load(Ordering::Relaxed),
        STRIP_LOOKUPS_HIT.load(Ordering::Relaxed),
        SEGMENT_TARGETS_USED.load(Ordering::Relaxed),
        ISO_TARGETS_USED.load(Ordering::Relaxed),
    );
}

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

impl LodBoundaryStrip {
    pub fn has_single_connected_component(&self) -> bool {
        self.component_count() == 1
    }

    pub fn component_count(&self) -> usize {
        boundary_component_count(&self.segments, self.vertices.len())
    }
}

fn boundary_component_count(segments: &[[u32; 2]], vertex_count: usize) -> usize {
    if vertex_count < 2 || segments.is_empty() {
        return 0;
    }

    let mut adjacency = vec![Vec::new(); vertex_count];
    for &[a, b] in segments {
        let (a, b) = (a as usize, b as usize);
        if a >= vertex_count || b >= vertex_count || a == b {
            debug_assert!(
                false,
                "invalid LOD boundary segment [{a}, {b}] for {vertex_count} vertices"
            );
            continue;
        }
        adjacency[a].push(b);
        adjacency[b].push(a);
    }

    let mut seen = vec![false; vertex_count];
    let mut components = 0;
    for start in 0..vertex_count {
        if seen[start] || adjacency[start].is_empty() {
            continue;
        }

        components += 1;
        let mut stack = vec![start];
        seen[start] = true;
        while let Some(vertex) = stack.pop() {
            for &neighbor in &adjacency[vertex] {
                if !seen[neighbor] {
                    seen[neighbor] = true;
                    stack.push(neighbor);
                }
            }
        }
    }

    components
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
    if local_positions.len() != normals.len() {
        debug_assert_eq!(
            local_positions.len(),
            normals.len(),
            "LOD boundary extraction requires one normal per main-surface vertex"
        );
        return Vec::new();
    }

    let origin = chunk_origin.as_vec3();
    let mut strips = Vec::new();

    for face in ChunkFace::ALL {
        if !is_xz_face(face) {
            continue;
        }

        let mut vert_index: HashMap<[i32; 3], u32> = HashMap::new();
        let mut vertices: Vec<StripVertex> = Vec::new();
        let mut intern = |i: usize| -> Option<u32> {
            let Some(&local) = local_positions.get(i) else {
                debug_assert!(
                    false,
                    "LOD boundary extraction index {i} is outside {} local positions",
                    local_positions.len()
                );
                return None;
            };
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
                normal: Vec3::from_array(normals[i]),
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

    /// Revision of the currently-published strips for `chunk_pos`, or `None` if it has
    /// none. Used to detect when a re-mesh actually changed the strip so finer
    /// neighbours can be dirtied for re-consume (the convergence trigger).
    pub fn revision_for(&self, chunk_pos: IVec3) -> Option<u64> {
        self.chunks.get(&chunk_pos).map(|c| c.revision)
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

// ============================================================================
// Stage 4: stitch geometry (watertight transition triangles)
// ============================================================================

/// A render-only transition surface bridging a fine boundary polyline to a coarser one
/// on a shared seam plane. World-space positions/normals + triangle indices.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SeamStitch {
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub indices: Vec<u32>,
}

impl SeamStitch {
    pub fn is_empty(&self) -> bool {
        self.indices.is_empty()
    }
    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

/// Triangulate the transition between a **fine** boundary polyline and a **coarser** one
/// that share a seam plane (the 2:1-ish density bridge). Both are projected to the seam
/// frame; we sort by the along-seam axis (`proj.x`) and **zip** them into a triangle
/// strip, so the fine edges and coarse edge become one watertight surface — no gap (the
/// steep-side hole) and no T-junction (the density crack). This is the review's "stitch
/// geometry" (Mode B): it bridges the *original* fine chain to the *actual* coarse
/// segment, so it does not depend on the morph weld succeeding.
///
/// Returns `None` when either side has < 2 vertices or their along-seam spans do not
/// overlap meaningfully — the caller then keeps the skirt fallback. (Monotone strip;
/// never a blind fan.)
pub fn stitch_seam(fine: &[StripVertex], coarse: &[StripVertex]) -> Option<SeamStitch> {
    if fine.len() < 2 || coarse.len() < 2 {
        return None;
    }

    let mut f: Vec<&StripVertex> = fine.iter().collect();
    let mut c: Vec<&StripVertex> = coarse.iter().collect();
    let along = |v: &&StripVertex| v.proj.x;
    f.sort_by(|a, b| along(a).total_cmp(&along(b)));
    c.sort_by(|a, b| along(a).total_cmp(&along(b)));

    // Spans must overlap, else this is not a shared seam (e.g. partial neighbour).
    let f_span = (along(&f[0]), along(&f[f.len() - 1]));
    let c_span = (along(&c[0]), along(&c[c.len() - 1]));
    if f_span.1 < c_span.0 || c_span.1 < f_span.0 {
        return None;
    }

    let mut positions: Vec<[f32; 3]> = Vec::with_capacity(f.len() + c.len());
    let mut normals: Vec<[f32; 3]> = Vec::with_capacity(f.len() + c.len());
    for v in &f {
        positions.push(v.world.to_array());
        normals.push(v.normal.to_array());
    }
    let coarse_off = positions.len() as u32;
    for v in &c {
        positions.push(v.world.to_array());
        normals.push(v.normal.to_array());
    }

    let mut indices: Vec<u32> = Vec::new();
    // Orient each triangle so its geometric normal agrees with the vertex normals (so
    // the stitch faces the same way as the terrain — no backface-culled invisible strip).
    let mut emit = |a: u32, b: u32, cc: u32| {
        let pa = Vec3::from_array(positions[a as usize]);
        let pb = Vec3::from_array(positions[b as usize]);
        let pc = Vec3::from_array(positions[cc as usize]);
        let geo = (pb - pa).cross(pc - pa);
        let avg = Vec3::from_array(normals[a as usize])
            + Vec3::from_array(normals[b as usize])
            + Vec3::from_array(normals[cc as usize]);
        if geo.dot(avg) >= 0.0 {
            indices.extend_from_slice(&[a, b, cc]);
        } else {
            indices.extend_from_slice(&[a, cc, b]);
        }
    };

    let (mut i, mut j) = (0usize, 0usize);
    while i + 1 < f.len() || j + 1 < c.len() {
        let advance_fine = if i + 1 >= f.len() {
            false
        } else if j + 1 >= c.len() {
            true
        } else {
            along(&f[i + 1]) <= along(&c[j + 1])
        };
        let fi = i as u32;
        let cj = coarse_off + j as u32;
        if advance_fine {
            emit(fi, cj, fi + 1);
            i += 1;
        } else {
            emit(fi, cj, cj + 1);
            j += 1;
        }
    }

    if indices.is_empty() {
        return None;
    }
    Some(SeamStitch {
        positions,
        normals,
        indices,
    })
}

/// Stitch two extracted strips only when both sides are one connected seam chain.
/// Multi-component strips are ambiguous after sorting and keep the skirt fallback.
pub fn stitch_boundary_strips(
    fine: &LodBoundaryStrip,
    coarse: &LodBoundaryStrip,
) -> Option<SeamStitch> {
    if !fine.has_single_connected_component() || !coarse.has_single_connected_component() {
        return None;
    }

    stitch_seam(&fine.vertices, &coarse.vertices)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StripOracleComparison {
    pub equivalent: bool,
    pub fine_segment_count: usize,
    pub coarse_segment_count: usize,
    pub fine_component_count: usize,
    pub coarse_component_count: usize,
    pub max_projected_segment_distance: f32,
}

/// Debug/bench oracle: compare a fine consumer strip against the coarse source strip.
pub fn compare_projected_strips(
    fine: &LodBoundaryStrip,
    coarse: &LodBoundaryStrip,
    epsilon: f32,
) -> StripOracleComparison {
    let fine_segment_count = fine.segments.len();
    let coarse_segment_count = coarse.segments.len();
    let fine_component_count = fine.component_count();
    let coarse_component_count = coarse.component_count();
    let mut max_projected_segment_distance = 0.0f32;

    if fine_segment_count == coarse_segment_count {
        for (fine_seg, coarse_seg) in fine.segments.iter().zip(coarse.segments.iter()) {
            let fa = fine.vertices.get(fine_seg[0] as usize);
            let fb = fine.vertices.get(fine_seg[1] as usize);
            let ca = coarse.vertices.get(coarse_seg[0] as usize);
            let cb = coarse.vertices.get(coarse_seg[1] as usize);
            if let (Some(fa), Some(fb), Some(ca), Some(cb)) = (fa, fb, ca, cb) {
                let d0 = fa.proj.distance(ca.proj);
                let d1 = fb.proj.distance(cb.proj);
                max_projected_segment_distance =
                    max_projected_segment_distance.max(d0.max(d1));
            }
        }
    }

    let equivalent = fine_segment_count == coarse_segment_count
        && fine_component_count == coarse_component_count
        && max_projected_segment_distance <= epsilon.max(0.0);

    StripOracleComparison {
        equivalent,
        fine_segment_count,
        coarse_segment_count,
        fine_component_count,
        coarse_component_count,
        max_projected_segment_distance,
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum StripOverlapStatus {
    #[default]
    NotEvaluated,
    Compatible,
    MissingFineStrip,
    MissingCoarseStrip,
    EmptyFineStrip,
    EmptyCoarseStrip,
    ComponentMismatch,
    FineMultiComponent,
    CoarseMultiComponent,
    SpanMismatch,
    DirectedDistanceExceeded,
    EndpointDistanceExceeded,
    CrossingOrFoldDetected,
    DegenerateSegment,
    UnsupportedTopology,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StripOverlapConfig {
    pub max_directed_distance_voxels: f32,
    pub max_endpoint_distance_voxels: f32,
    pub min_span_overlap_ratio: f32,
    pub min_segment_length_voxels: f32,
    pub segment_sample_spacing_voxels: f32,
    pub max_unmatched_fine_segments: u16,
    pub max_unmatched_coarse_segments: u16,
    pub max_crossings: u16,
}

impl Default for StripOverlapConfig {
    fn default() -> Self {
        Self {
            max_directed_distance_voxels: 0.35,
            max_endpoint_distance_voxels: 0.50,
            min_span_overlap_ratio: 0.95,
            min_segment_length_voxels: 0.02,
            segment_sample_spacing_voxels: 0.25,
            max_unmatched_fine_segments: 0,
            max_unmatched_coarse_segments: 0,
            max_crossings: 0,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct StripOverlapAudit {
    pub status: StripOverlapStatus,
    pub compatible: bool,
    pub fine_segment_count: u16,
    pub coarse_segment_count: u16,
    pub fine_component_count: u8,
    pub coarse_component_count: u8,
    pub fine_span_min: f32,
    pub fine_span_max: f32,
    pub coarse_span_min: f32,
    pub coarse_span_max: f32,
    pub overlap_span_min: f32,
    pub overlap_span_max: f32,
    pub span_overlap_ratio: f32,
    pub max_fine_to_coarse_distance: f32,
    pub max_coarse_to_fine_distance: f32,
    pub max_endpoint_distance: f32,
    pub unmatched_fine_segments: u16,
    pub unmatched_coarse_segments: u16,
    pub degenerate_segments: u16,
    pub crossing_count: u16,
}

#[derive(Clone, Copy, Debug)]
struct ProjectedSegment {
    a: Vec2,
    b: Vec2,
    length: f32,
    span_min: f32,
    span_max: f32,
}

#[derive(Clone, Copy, Debug, Default)]
struct DirectedDistanceResult {
    max_distance: f32,
    unmatched_segments: u16,
}

pub fn audit_projected_strip_overlap(
    fine: Option<&LodBoundaryStrip>,
    coarse: Option<&LodBoundaryStrip>,
    config: StripOverlapConfig,
) -> StripOverlapAudit {
    let mut audit = StripOverlapAudit::default();
    let Some(fine) = fine else {
        audit.status = StripOverlapStatus::MissingFineStrip;
        return audit;
    };
    let Some(coarse) = coarse else {
        audit.status = StripOverlapStatus::MissingCoarseStrip;
        return audit;
    };

    audit.fine_segment_count = fine.segments.len().min(u16::MAX as usize) as u16;
    audit.coarse_segment_count = coarse.segments.len().min(u16::MAX as usize) as u16;
    audit.fine_component_count = fine.component_count().min(u8::MAX as usize) as u8;
    audit.coarse_component_count = coarse.component_count().min(u8::MAX as usize) as u8;

    if fine.segments.is_empty() {
        audit.status = StripOverlapStatus::EmptyFineStrip;
        return audit;
    }
    if coarse.segments.is_empty() {
        audit.status = StripOverlapStatus::EmptyCoarseStrip;
        return audit;
    }
    if audit.fine_component_count > 1 {
        audit.status = StripOverlapStatus::FineMultiComponent;
        return audit;
    }
    if audit.coarse_component_count > 1 {
        audit.status = StripOverlapStatus::CoarseMultiComponent;
        return audit;
    }
    if audit.fine_component_count != audit.coarse_component_count {
        audit.status = StripOverlapStatus::ComponentMismatch;
        return audit;
    }

    let fine_segments = match projected_segments(fine, config.min_segment_length_voxels, &mut audit) {
        Some(s) => s,
        None => return audit,
    };
    let coarse_segments = match projected_segments(coarse, config.min_segment_length_voxels, &mut audit) {
        Some(s) => s,
        None => return audit,
    };

    let Some((fine_span_min, fine_span_max)) = strip_span(&fine_segments) else {
        audit.status = StripOverlapStatus::EmptyFineStrip;
        return audit;
    };
    let Some((coarse_span_min, coarse_span_max)) = strip_span(&coarse_segments) else {
        audit.status = StripOverlapStatus::EmptyCoarseStrip;
        return audit;
    };
    audit.fine_span_min = fine_span_min;
    audit.fine_span_max = fine_span_max;
    audit.coarse_span_min = coarse_span_min;
    audit.coarse_span_max = coarse_span_max;
    audit.overlap_span_min = fine_span_min.max(coarse_span_min);
    audit.overlap_span_max = fine_span_max.min(coarse_span_max);
    let overlap_len = (audit.overlap_span_max - audit.overlap_span_min).max(0.0);
    let denom = (fine_span_max - fine_span_min).max(coarse_span_max - coarse_span_min);
    audit.span_overlap_ratio = if denom <= f32::EPSILON { 1.0 } else { overlap_len / denom };
    if audit.span_overlap_ratio < config.min_span_overlap_ratio {
        audit.status = StripOverlapStatus::SpanMismatch;
        return audit;
    }

    let fine_to_coarse = directed_segment_set_distance(
        &fine_segments,
        &coarse_segments,
        config.segment_sample_spacing_voxels,
        config.max_directed_distance_voxels,
    );
    let coarse_to_fine = directed_segment_set_distance(
        &coarse_segments,
        &fine_segments,
        config.segment_sample_spacing_voxels,
        config.max_directed_distance_voxels,
    );
    audit.max_fine_to_coarse_distance = fine_to_coarse.max_distance;
    audit.max_coarse_to_fine_distance = coarse_to_fine.max_distance;
    audit.unmatched_fine_segments = fine_to_coarse.unmatched_segments;
    audit.unmatched_coarse_segments = coarse_to_fine.unmatched_segments;

    audit.max_endpoint_distance = endpoint_distance_max(&fine_segments, &coarse_segments)
        .max(endpoint_distance_max(&coarse_segments, &fine_segments));
    audit.crossing_count = segment_crossing_count(&fine_segments, &coarse_segments, 1e-4);

    if audit.max_fine_to_coarse_distance > config.max_directed_distance_voxels
        || audit.max_coarse_to_fine_distance > config.max_directed_distance_voxels
        || audit.unmatched_fine_segments > config.max_unmatched_fine_segments
        || audit.unmatched_coarse_segments > config.max_unmatched_coarse_segments
    {
        audit.status = StripOverlapStatus::DirectedDistanceExceeded;
        return audit;
    }
    if audit.max_endpoint_distance > config.max_endpoint_distance_voxels {
        audit.status = StripOverlapStatus::EndpointDistanceExceeded;
        return audit;
    }
    if audit.crossing_count > config.max_crossings {
        audit.status = StripOverlapStatus::CrossingOrFoldDetected;
        return audit;
    }

    audit.status = StripOverlapStatus::Compatible;
    audit.compatible = true;
    audit
}

fn projected_segments(
    strip: &LodBoundaryStrip,
    min_segment_length: f32,
    audit: &mut StripOverlapAudit,
) -> Option<Vec<ProjectedSegment>> {
    let mut out = Vec::with_capacity(strip.segments.len());
    for segment in &strip.segments {
        let (Some(a), Some(b)) = (
            strip.vertices.get(segment[0] as usize),
            strip.vertices.get(segment[1] as usize),
        ) else {
            audit.status = StripOverlapStatus::UnsupportedTopology;
            return None;
        };
        if !a.proj.is_finite() || !b.proj.is_finite() {
            audit.status = StripOverlapStatus::UnsupportedTopology;
            return None;
        }
        let length = a.proj.distance(b.proj);
        if length <= min_segment_length {
            audit.degenerate_segments = audit.degenerate_segments.saturating_add(1);
            audit.status = StripOverlapStatus::DegenerateSegment;
            return None;
        }
        out.push(ProjectedSegment {
            a: a.proj,
            b: b.proj,
            length,
            span_min: a.proj.x.min(b.proj.x),
            span_max: a.proj.x.max(b.proj.x),
        });
    }
    Some(out)
}

fn strip_span(segments: &[ProjectedSegment]) -> Option<(f32, f32)> {
    let mut min_x = f32::INFINITY;
    let mut max_x = f32::NEG_INFINITY;
    for segment in segments {
        min_x = min_x.min(segment.span_min);
        max_x = max_x.max(segment.span_max);
    }
    (min_x.is_finite() && max_x.is_finite()).then_some((min_x, max_x))
}

fn directed_segment_set_distance(
    source: &[ProjectedSegment],
    target: &[ProjectedSegment],
    spacing: f32,
    threshold: f32,
) -> DirectedDistanceResult {
    let mut result = DirectedDistanceResult::default();
    for segment in source {
        let sample_count = ((segment.length / spacing.max(1e-3)).ceil() as usize).max(1);
        let mut segment_has_match = false;
        for i in 0..=sample_count {
            let t = i as f32 / sample_count as f32;
            let point = segment.a.lerp(segment.b, t);
            let distance = closest_distance_to_segments(point, target);
            result.max_distance = result.max_distance.max(distance);
            if distance <= threshold {
                segment_has_match = true;
            }
        }
        if !segment_has_match {
            result.unmatched_segments = result.unmatched_segments.saturating_add(1);
        }
    }
    result
}

fn endpoint_distance_max(source: &[ProjectedSegment], target: &[ProjectedSegment]) -> f32 {
    let mut max_distance: f32 = 0.0;
    for segment in source {
        max_distance = max_distance.max(closest_distance_to_segments(segment.a, target));
        max_distance = max_distance.max(closest_distance_to_segments(segment.b, target));
    }
    max_distance
}

fn closest_distance_to_segments(point: Vec2, segments: &[ProjectedSegment]) -> f32 {
    let mut best = f32::INFINITY;
    for segment in segments {
        let (_, distance) = closest_point_on_segment_2d(point, segment.a, segment.b);
        best = best.min(distance);
    }
    if best.is_finite() { best } else { f32::INFINITY }
}

fn segment_crossing_count(
    a_segments: &[ProjectedSegment],
    b_segments: &[ProjectedSegment],
    epsilon: f32,
) -> u16 {
    let mut count = 0u16;
    for a in a_segments {
        for b in b_segments {
            if segments_intersect_strict(a.a, a.b, b.a, b.b, epsilon) {
                count = count.saturating_add(1);
            }
        }
    }
    count
}

fn segments_intersect_strict(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2, epsilon: f32) -> bool {
    if points_close(a0, b0, epsilon)
        || points_close(a0, b1, epsilon)
        || points_close(a1, b0, epsilon)
        || points_close(a1, b1, epsilon)
    {
        return false;
    }
    let o1 = orient(a0, a1, b0);
    let o2 = orient(a0, a1, b1);
    let o3 = orient(b0, b1, a0);
    let o4 = orient(b0, b1, a1);
    if o1.abs() <= epsilon || o2.abs() <= epsilon || o3.abs() <= epsilon || o4.abs() <= epsilon {
        return false;
    }
    (o1 > 0.0) != (o2 > 0.0) && (o3 > 0.0) != (o4 > 0.0)
}

#[inline]
fn orient(a: Vec2, b: Vec2, c: Vec2) -> f32 {
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

#[inline]
fn points_close(a: Vec2, b: Vec2, epsilon: f32) -> bool {
    a.distance_squared(b) <= epsilon * epsilon
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
        assert!(
            coarse_segment_target_local(
                Vec3::new(16.0, 9.0, 2.0),
                ChunkFace::PosX,
                IVec3::ZERO,
                &strip,
                1.0
            )
            .is_none()
        );
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
    fn stitch_seam_zips_fine_chain_to_coarse_segment() {
        let sv = |z: f32, y: f32| StripVertex {
            local: Vec3::new(0.0, y, z),
            world: Vec3::new(16.0, y, z),
            normal: Vec3::new(1.0, 0.0, 0.0),
            proj: Vec2::new(z, y),
        };
        // 3 fine verts (z=0,1,2) bridged to 2 coarse verts (z=0,2): a 2:1 density gap.
        let fine = vec![sv(0.0, 0.0), sv(1.0, 0.0), sv(2.0, 0.0)];
        let coarse = vec![sv(0.0, 0.0), sv(2.0, 0.0)];
        let stitch = stitch_seam(&fine, &coarse).expect("stitch");
        assert_eq!(stitch.positions.len(), 5, "all fine + coarse verts kept");
        assert_eq!(
            stitch.triangle_count(),
            3,
            "3+2 polyline zips to 3 triangles"
        );
        // Every index in range.
        assert!(
            stitch
                .indices
                .iter()
                .all(|&i| (i as usize) < stitch.positions.len())
        );
    }

    #[test]
    fn stitch_boundary_strips_accepts_single_component_uneven_lengths() {
        let sv = |z: f32, y: f32| StripVertex {
            local: Vec3::new(0.0, y, z),
            world: Vec3::new(16.0, y, z),
            normal: Vec3::new(1.0, 0.0, 0.0),
            proj: Vec2::new(z, y),
        };
        let strip = |vertices: Vec<StripVertex>, segments: Vec<[u32; 2]>| LodBoundaryStrip {
            face: ChunkFace::NegX,
            lod: LodLevel::Lod0,
            chunk_pos: IVec3::ZERO,
            revision: 1,
            vertices,
            segments,
        };

        let fine = strip(
            vec![sv(0.0, 0.0), sv(0.5, 0.0), sv(1.0, 0.0), sv(2.0, 0.0)],
            vec![[0, 1], [1, 2], [2, 3]],
        );
        let coarse = strip(vec![sv(0.0, 0.0), sv(2.0, 0.0)], vec![[0, 1]]);

        let stitch = stitch_boundary_strips(&fine, &coarse).expect("single component stitch");
        assert_eq!(stitch.positions.len(), 6);
        assert_eq!(stitch.triangle_count(), 4);
        assert!(
            stitch
                .indices
                .iter()
                .all(|&i| (i as usize) < stitch.positions.len())
        );
    }

    #[test]
    fn stitch_boundary_strips_rejects_multiple_components() {
        let sv = |z: f32| StripVertex {
            local: Vec3::new(0.0, 0.0, z),
            world: Vec3::new(16.0, 0.0, z),
            normal: Vec3::new(1.0, 0.0, 0.0),
            proj: Vec2::new(z, 0.0),
        };
        let fine = LodBoundaryStrip {
            face: ChunkFace::NegX,
            lod: LodLevel::Lod0,
            chunk_pos: IVec3::ZERO,
            revision: 1,
            vertices: vec![sv(0.0), sv(1.0), sv(4.0), sv(5.0)],
            segments: vec![[0, 1], [2, 3]],
        };
        let coarse = flat_negx_strip();

        assert_eq!(
            boundary_component_count(&fine.segments, fine.vertices.len()),
            2
        );
        assert!(stitch_boundary_strips(&fine, &coarse).is_none());
    }

    #[test]
    fn stitch_seam_rejects_non_overlapping_spans() {
        let sv = |z: f32| StripVertex {
            local: Vec3::new(0.0, 0.0, z),
            world: Vec3::new(16.0, 0.0, z),
            normal: Vec3::new(1.0, 0.0, 0.0),
            proj: Vec2::new(z, 0.0),
        };
        let fine = vec![sv(0.0), sv(1.0)];
        let coarse = vec![sv(5.0), sv(6.0)];
        assert!(
            stitch_seam(&fine, &coarse).is_none(),
            "disjoint spans -> skirt fallback"
        );
        assert!(
            stitch_seam(&fine, &[sv(0.0)]).is_none(),
            "coarse < 2 verts -> None"
        );
    }

    #[test]
    fn cache_is_non_blocking_and_revision_gated() {
        let mut cache = LodBoundaryStripCache::default();
        let pos = IVec3::new(1, 0, 0);
        cache.insert(pos, 42, vec![flat_negx_strip()]);

        // Present + revision match -> hit.
        assert!(
            cache
                .strip_for_face(pos, ChunkFace::NegX, Some(42))
                .is_some()
        );
        // Stale revision -> miss (fall back to skirt, never block).
        assert!(
            cache
                .strip_for_face(pos, ChunkFace::NegX, Some(99))
                .is_none()
        );
        // Wrong face / missing chunk -> miss.
        assert!(
            cache
                .strip_for_face(pos, ChunkFace::PosX, Some(42))
                .is_none()
        );
        assert!(
            cache
                .strip_for_face(IVec3::new(9, 9, 9), ChunkFace::NegX, None)
                .is_none()
        );

        cache.remove(pos);
        assert!(cache.is_empty());
    }

    fn line_strip(points: &[(f32, f32)], segments: &[[u32; 2]]) -> LodBoundaryStrip {
        LodBoundaryStrip {
            face: ChunkFace::PosX,
            lod: LodLevel::Lod0,
            chunk_pos: IVec3::ZERO,
            revision: 1,
            vertices: points
                .iter()
                .map(|(x, y)| StripVertex {
                    local: Vec3::ZERO,
                    world: Vec3::ZERO,
                    normal: Vec3::Y,
                    proj: Vec2::new(*x, *y),
                })
                .collect(),
            segments: segments.to_vec(),
        }
    }

    #[test]
    fn overlap_oracle_accepts_different_segment_counts_when_geometrically_compatible() {
        let fine = line_strip(&[(0.0, 0.0), (1.0, 0.0), (2.0, 0.0)], &[[0, 1], [1, 2]]);
        let coarse = line_strip(&[(0.0, 0.0), (2.0, 0.0)], &[[0, 1]]);
        let audit = audit_projected_strip_overlap(Some(&fine), Some(&coarse), StripOverlapConfig::default());
        assert_eq!(audit.status, StripOverlapStatus::Compatible);
        assert!(audit.compatible);
    }

    #[test]
    fn overlap_oracle_rejects_span_mismatch() {
        let fine = line_strip(&[(0.0, 0.0), (10.0, 0.0)], &[[0, 1]]);
        let coarse = line_strip(&[(0.0, 0.0), (7.0, 0.0)], &[[0, 1]]);
        let audit = audit_projected_strip_overlap(Some(&fine), Some(&coarse), StripOverlapConfig::default());
        assert_eq!(audit.status, StripOverlapStatus::SpanMismatch);
    }

    #[test]
    fn overlap_oracle_rejects_directed_distance_exceeded() {
        let fine = line_strip(&[(0.0, 0.0), (2.0, 0.0)], &[[0, 1]]);
        let coarse = line_strip(&[(0.0, 0.6), (2.0, 0.6)], &[[0, 1]]);
        let audit = audit_projected_strip_overlap(Some(&fine), Some(&coarse), StripOverlapConfig::default());
        assert_eq!(audit.status, StripOverlapStatus::DirectedDistanceExceeded);
    }

    #[test]
    fn overlap_oracle_rejects_endpoint_distance_exceeded() {
        let fine = line_strip(&[(0.0, 0.0), (2.0, 0.0)], &[[0, 1]]);
        let coarse = line_strip(&[(0.4, 0.0), (2.0, 0.0)], &[[0, 1]]);
        let mut config = StripOverlapConfig::default();
        config.max_directed_distance_voxels = 1.0;
        config.max_endpoint_distance_voxels = 0.2;
        config.min_span_overlap_ratio = 0.5;
        let audit = audit_projected_strip_overlap(Some(&fine), Some(&coarse), config);
        assert_eq!(audit.status, StripOverlapStatus::EndpointDistanceExceeded);
    }
}
