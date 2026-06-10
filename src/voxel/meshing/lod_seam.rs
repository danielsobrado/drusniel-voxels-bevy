use super::{
    LodTransitionSnapStats, MeshData, TERRAIN_MESH_SECTION_TRANSITION_APRON,
    coarse_lod_iso_height_for_column, neighbor_lod_for_face, sdf_gradient_normal_at_local,
    seam_audit::{MorphFaceCounts, SeamStitchResult, XZ_FACE_COUNT, XZ_FACES, xz_face_index},
};
use crate::constants::{CHUNK_BOUNDARY_SCALE, CHUNK_SIZE, CHUNK_SIZE_I32, VOXEL_SIZE};
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::meshing_lod::append_morph_targets;
use crate::voxel::meshing_types::TerrainMorphConfig;
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::{IVec2, IVec3, Vec3, info, warn};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// Scales a vertex position outward from chunk center to close seams.
#[inline]
pub(crate) fn scale_vertex_from_center(local: Vec3, chunk_center: Vec3) -> [f32; 3] {
    let pos = Vec3::new(
        local.x * VOXEL_SIZE,
        local.y * VOXEL_SIZE,
        local.z * VOXEL_SIZE,
    );
    let scaled = chunk_center + (pos - chunk_center) * CHUNK_BOUNDARY_SCALE;
    [scaled.x, scaled.y, scaled.z]
}

/// Inverse of [`scale_vertex_from_center`]: recover the unscaled chunk-local position
/// from a render-space vertex (used to read back a morph target's local position).
#[inline]
pub(crate) fn unscale_vertex_to_local(scaled: [f32; 3], chunk_center: Vec3) -> Vec3 {
    let scaled = Vec3::from_array(scaled);
    let pos = (scaled - chunk_center) / CHUNK_BOUNDARY_SCALE + chunk_center;
    pos / VOXEL_SIZE
}

/// Stage 5 — seam normals. A GPU-morph-welded boundary vert (`w = 1`) renders at its
/// morph **target**, but its normal would otherwise stay the stale fine-position normal,
/// so the welded geometry lights wrong (flat-dark seam welds). Recompute each still-
/// welded vert's normal from the SDF gradient at the welded position. Verts left at
/// `w = 0` (interior, or faces handed to the Stage-4 stitch) keep their SDF-gradient
/// normal, which already matches where they render. Call AFTER morph + stitch + skirt
/// (so the apron inherits the original boundary normals) and BEFORE
/// `pad_morph_targets_identity` (so only main-surface morph rows are visited).
pub(super) fn recompute_morphed_seam_normals(
    mesh: &mut MeshData,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
) {
    let count = mesh.morph_targets.len().min(mesh.normals.len());
    for i in 0..count {
        let target = mesh.morph_targets[i];
        if target[3] > 0.5 {
            let target_local =
                unscale_vertex_to_local([target[0], target[1], target[2]], chunk_center);
            mesh.normals[i] = sdf_gradient_normal_at_local(world, chunk_origin, target_local);
        }
    }
}

pub(crate) fn snap_column_for_face(
    chunk_origin: IVec3,
    local: Vec3,
    face: ChunkFace,
) -> Option<IVec2> {
    match face {
        ChunkFace::NegX => Some(IVec2::new(
            chunk_origin.x,
            chunk_origin.z + local.z.floor() as i32,
        )),
        ChunkFace::PosX => Some(IVec2::new(
            chunk_origin.x + CHUNK_SIZE_I32,
            chunk_origin.z + local.z.floor() as i32,
        )),
        ChunkFace::NegZ => Some(IVec2::new(
            chunk_origin.x + local.x.floor() as i32,
            chunk_origin.z,
        )),
        ChunkFace::PosZ => Some(IVec2::new(
            chunk_origin.x + local.x.floor() as i32,
            chunk_origin.z + CHUNK_SIZE_I32,
        )),
        ChunkFace::NegY | ChunkFace::PosY => None,
    }
}

pub(crate) fn visual_surface_nets_target_lod(lod: LodLevel) -> LodLevel {
    match lod {
        LodLevel::Lod3 => LodLevel::Lod2,
        other => other,
    }
}

pub(crate) fn transition_target_lod(my_lod: LodLevel, neighbor_lod: LodLevel) -> Option<LodLevel> {
    let my_lod = visual_surface_nets_target_lod(my_lod);
    let neighbor_lod = visual_surface_nets_target_lod(neighbor_lod);
    if neighbor_lod == LodLevel::Culled || !neighbor_lod.is_lower_detail_than(my_lod) {
        return None;
    }

    let my_index = my_lod.lod_index()?;
    let neighbor_index = neighbor_lod.lod_index()?;
    if neighbor_index.saturating_sub(my_index) > 1 {
        return None;
    }

    Some(neighbor_lod)
}

pub(crate) fn xz_face_coarse_target_local(
    world: &VoxelWorld,
    chunk_origin: IVec3,
    local: Vec3,
    face: ChunkFace,
    target_lod: LodLevel,
    max_stitch_distance: f32,
) -> Option<Vec3> {
    let column = snap_column_for_face(chunk_origin, local, face)?;
    let world_y = coarse_lod_iso_height_for_column(world, column.x, column.y, target_lod)?;
    let chunk_size = CHUNK_SIZE as f32;
    let mut target = local;
    target.y = world_y - chunk_origin.y as f32;
    match face {
        ChunkFace::NegX => target.x = 0.0,
        ChunkFace::PosX => target.x = chunk_size,
        ChunkFace::NegZ => target.z = 0.0,
        ChunkFace::PosZ => target.z = chunk_size,
        ChunkFace::NegY | ChunkFace::PosY => return None,
    }

    if !(target.x.is_finite() && target.y.is_finite() && target.z.is_finite()) {
        return None;
    }
    if (target - local).length() > max_stitch_distance.max(0.0) {
        return None;
    }

    Some(target)
}

pub(crate) fn coarse_lattice_y_face_target(
    chunk_origin: IVec3,
    local: Vec3,
    face: ChunkFace,
    neighbor_lod: LodLevel,
) -> Option<Vec3> {
    let step = neighbor_lod.step_size() as i32;
    if step <= 1 {
        return None;
    }

    let target_y = match face {
        ChunkFace::NegY => 0.0,
        ChunkFace::PosY => CHUNK_SIZE as f32,
        _ => return None,
    };
    let world_x = chunk_origin.x + local.x.floor() as i32;
    let world_z = chunk_origin.z + local.z.floor() as i32;
    let aligned_x = world_x.div_euclid(step) * step;
    let aligned_z = world_z.div_euclid(step) * step;
    let chunk_size = CHUNK_SIZE as f32;

    Some(
        Vec3::new(
            (aligned_x - chunk_origin.x) as f32,
            target_y,
            (aligned_z - chunk_origin.z) as f32,
        )
        .clamp(Vec3::ZERO, Vec3::splat(chunk_size)),
    )
}

/// Process-level GPU geomorph gate. Read once from `VOXELS_TERRAIN_MORPH`
/// (`0` / `false` disables) and cached; default is enabled. The toggle is an env var,
/// not YAML, to avoid per-chunk file IO on the Surface Nets path.
pub(crate) fn terrain_morph_config() -> &'static TerrainMorphConfig {
    static CACHE: OnceLock<TerrainMorphConfig> = OnceLock::new();
    CACHE.get_or_init(|| {
        // Default ON: the GPU geomorph welds the fine boundary to the coarse-LOD
        // target so LOD levels meet directly (set VOXELS_TERRAIN_MORPH=0 to disable
        // and fall back to the legacy CPU snap path).
        let enabled = std::env::var("VOXELS_TERRAIN_MORPH")
            .map(|v| !(v == "0" || v.eq_ignore_ascii_case("false")))
            .unwrap_or(true);
        if enabled {
            info!("GPU terrain morph gate: ENABLED (default; set VOXELS_TERRAIN_MORPH=0 to disable) — SN path welds on GPU");
        } else {
            info!("GPU terrain morph gate: DISABLED (VOXELS_TERRAIN_MORPH=0) — legacy CPU snap");
        }
        TerrainMorphConfig {
            enabled,
            ..Default::default()
        }
    })
}

/// LOD-boundary weld for a Surface Nets chunk: either the legacy CPU snap (morph
/// off — the default, byte-identical path) or GPU morph-target baking (morph on,
/// which keeps the fine mesh in `POSITION` for colliders and welds only on display).
/// Returns the snap stats; default when snap is skipped.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_snap_or_morph(
    solid_mesh: &mut MeshData,
    local_positions: &mut Vec<Vec3>,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    morph: &TerrainMorphConfig,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
) -> (LodTransitionSnapStats, MorphFaceCounts) {
    let bake_targets = |solid_mesh: &mut MeshData, local_positions: &[Vec3]| {
        if let Err(err) = append_morph_targets(
            solid_mesh,
            local_positions,
            world,
            chunk_origin,
            chunk_center,
            my_lod,
            neighbor_lods,
            morph,
            neighbor_strips,
        ) {
            warn!("terrain morph target generation skipped: {err:?}");
            solid_mesh.morph_targets.clear();
        }
    };

    if morph.enabled && !morph.cpu_snap_when_morph_enabled {
        // Keep the fine mesh in POSITION; weld lives in ATTRIBUTE_MORPH_TARGET only.
        bake_targets(solid_mesh, local_positions);
        let mut stats = LodTransitionSnapStats::default();
        stats.boundary_candidate_vertex_count =
            transition_boundary_vertex_count(local_positions, my_lod, neighbor_lods);
        stats.morph_target_vertex_count = solid_mesh
            .morph_targets
            .iter()
            .take(local_positions.len())
            .filter(|target| target[3] > 0.5)
            .count() as u32;
        stats.morph_missing_target_vertex_count = stats
            .boundary_candidate_vertex_count
            .saturating_sub(stats.morph_target_vertex_count);
        // Per-face coverage (all-morph-or-all-skirt): suppress the apron/vertical
        // skirt only on faces the GPU morph welds **completely**. A face with any
        // missing target stays as fallback and keeps its skirt — and its
        // partially-welded verts are un-morphed so the kept skirt is not torn (a
        // welded boundary vert flying up while its w=0 skirt vert stays behind is
        // exactly what tore the seam). The fallback skirt is the honest interim until
        // the vertex-exact stitch (lod_boundary_strip) replaces it.
        let (complete_mask, fallback_mask, _morph_counts) = if solid_mesh.morph_targets.is_empty() {
            (0, 0, MorphFaceCounts::default())
        } else {
            let (complete, fallback, counts) = resolve_morph_face_coverage(
                local_positions,
                &solid_mesh.morph_targets,
                my_lod,
                neighbor_lods,
            );
            (complete, fallback, counts)
        };
        stats.snapped_face_mask = complete_mask;
        stats.fallback_face_mask = fallback_mask;
        (stats, _morph_counts)
    } else {
        let stats = snap_boundary_vertices_to_lower_detail_neighbor(
            solid_mesh,
            local_positions,
            chunk,
            world,
            chunk_origin,
            chunk_center,
            my_lod,
            neighbor_lods,
        );
        if morph.enabled {
            // cpu_snap_when_morph_enabled: snap AND publish targets (~= snapped pos).
            bake_targets(solid_mesh, local_positions);
        }
        let morph_counts = if morph.enabled && !solid_mesh.morph_targets.is_empty() {
            morph_face_counts_for_cpu_snap(local_positions, &solid_mesh.morph_targets, my_lod, neighbor_lods)
        } else {
            MorphFaceCounts::default()
        };
        (stats, morph_counts)
    }
}

pub(super) fn extract_own_boundary_strips(
    local_positions: &[Vec3],
    solid_mesh: &MeshData,
    chunk_origin: IVec3,
    chunk: &Chunk,
    my_lod: LodLevel,
) -> crate::voxel::lod_boundary_strip::OwnBoundaryStrips {
    crate::voxel::lod_boundary_strip::OwnBoundaryStrips::from_extracted(
        crate::voxel::lod_boundary_strip::extract_lod_boundary_strips(
            local_positions,
            &solid_mesh.normals,
            &solid_mesh.indices,
            chunk_origin,
            CHUNK_SIZE as f32,
            my_lod.step_size() as f32,
            my_lod,
            chunk.position(),
            0,
        ),
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_surface_nets_seam_face_audit(
    chunk: &Chunk,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    own_strips: &crate::voxel::lod_boundary_strip::OwnBoundaryStrips,
    snap_stats: &LodTransitionSnapStats,
    morph_counts: &MorphFaceCounts,
    stitch: &SeamStitchResult,
    skirt_stats: &crate::voxel::skirt::SkirtGenerationStats,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
    strip_status: &[super::seam_audit::SeamStripStatus; XZ_FACE_COUNT],
) -> (
    [super::seam_audit::SeamFaceAudit; XZ_FACE_COUNT],
    super::TerrainSeamStripDebug,
) {
    use super::lod_delta_gt_one_face_mask;
    use super::seam_audit::{SkirtFaceCounts, assemble_seam_face_audit, terrain_seam_strip_debug_from_own_strips};

    let fine_strips: Vec<_> = own_strips.iter_strips().cloned().collect();
    let seam_strip_debug = terrain_seam_strip_debug_from_own_strips(&fine_strips);
    let skirt_counts = SkirtFaceCounts {
        triangle_counts: skirt_stats.per_face_triangle_counts,
    };
    let audits = assemble_seam_face_audit(
        chunk.position(),
        my_lod,
        neighbor_lods,
        snap_stats,
        morph_counts,
        stitch,
        &skirt_counts,
        strip_status,
        neighbor_strips,
        &fine_strips,
        lod_delta_gt_one_face_mask(my_lod, neighbor_lods),
    );
    (audits, seam_strip_debug)
}

pub(super) fn in_lod_boundary_cell(local: Vec3, face: ChunkFace, my_lod: LodLevel) -> bool {
    let chunk_size = CHUNK_SIZE as f32;
    let face_tolerance = my_lod.step_size() as f32;
    match face {
        ChunkFace::NegX => local.x <= face_tolerance,
        ChunkFace::PosX => local.x >= chunk_size - face_tolerance,
        ChunkFace::NegY => local.y <= face_tolerance,
        ChunkFace::PosY => local.y >= chunk_size - face_tolerance,
        ChunkFace::NegZ => local.z <= face_tolerance,
        ChunkFace::PosZ => local.z >= chunk_size - face_tolerance,
    }
}

pub(super) fn transition_boundary_vertex_count(
    local_positions: &[Vec3],
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> u32 {
    if my_lod.step_size() == 0 {
        return 0;
    }

    let mut count = 0u32;
    for local in local_positions.iter().copied() {
        for face in ChunkFace::ALL {
            let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
                continue;
            };
            if transition_target_lod(my_lod, neighbor_lod).is_none() {
                continue;
            }
            if in_lod_boundary_cell(local, face, my_lod) {
                count = count.saturating_add(1);
                break;
            }
        }
    }
    count
}

/// Resolve per-face GPU-morph coverage for the skirt seal/fallback decision.
///
/// Returns `(complete_mask, fallback_mask)`:
/// - **complete**: a LOD-transition face with *at least one* welded boundary vert
///   (w=1). Its skirt is sealed — sealing keeps the morph welds (which can be holding
///   a spike vertex down), and a sealed face has no skirt to tear. The few un-welded
///   verts on it just sit at their fine position (a small notch the vertex-exact
///   stitch closes later) — never a wall or a spike.
/// - **fallback**: a transition face where *no* boundary vert welded. It keeps its
///   skirt as cover; since nothing on it moved, the skirt cannot tear.
///
/// Note (regression guard): an earlier "seal only when *every* vert welds, else
/// un-morph the face" rule reintroduced the LOD-seam spikes — un-morphing a welded
/// boundary vert released a spike the weld was pinning down — and turned
/// partially-welded faces into skirt walls. Seal-if-any avoids both.
pub(super) fn resolve_morph_face_coverage(
    local_positions: &[Vec3],
    morph_targets: &[[f32; 4]],
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> (u8, u8, MorphFaceCounts) {
    if my_lod.step_size() == 0 || local_positions.len() != morph_targets.len() {
        return (0, 0, MorphFaceCounts::default());
    }

    let mut complete = 0u8;
    let mut fallback = 0u8;
    let mut counts = MorphFaceCounts::default();
    for face in ChunkFace::ALL {
        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
            continue;
        };
        if transition_target_lod(my_lod, neighbor_lod).is_none() {
            continue;
        }
        let mut candidate_count = 0u16;
        let mut welded_count = 0u16;
        for (local, target) in local_positions.iter().zip(morph_targets.iter()) {
            if in_lod_boundary_cell(*local, face, my_lod) {
                candidate_count = candidate_count.saturating_add(1);
                if target[3] > 0.5 {
                    welded_count = welded_count.saturating_add(1);
                }
            }
        }
        if candidate_count > 0 {
            if welded_count > 0 {
                complete |= LodTransitionSnapStats::face_mask(face);
            } else {
                fallback |= LodTransitionSnapStats::face_mask(face);
            }
            if let Some(idx) = xz_face_index(face) {
                counts.candidate[idx] = candidate_count;
                counts.welded[idx] = welded_count;
            }
        }
    }

    (complete, fallback, counts)
}

pub(super) fn morph_face_counts_for_cpu_snap(
    local_positions: &[Vec3],
    morph_targets: &[[f32; 4]],
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> MorphFaceCounts {
    if morph_targets.is_empty() {
        return MorphFaceCounts::default();
    }
    resolve_morph_face_coverage(local_positions, morph_targets, my_lod, neighbor_lods).2
}

/// Extract the main-surface boundary strips this chunk exports for a finer neighbour
/// to weld to (vertex-exact seam). Gated for cost: only when morph is on **and** the
/// chunk borders a strictly finer neighbour (the finer side is the consumer), so the
/// O(triangles) walk is skipped for the interior of a uniform-LOD region. Must be
/// called with the **main surface only** (before skirts are appended).
pub(super) fn extract_export_boundary_strips(
    morph: &TerrainMorphConfig,
    own_strips: &crate::voxel::lod_boundary_strip::OwnBoundaryStrips,
    neighbor_lods: &NeighborLods,
    my_lod: LodLevel,
) -> Vec<crate::voxel::lod_boundary_strip::LodBoundaryStrip> {
    if !morph.enabled || my_lod.step_size() == 0 {
        return Vec::new();
    }
    let borders_finer = ChunkFace::ALL.iter().any(|&face| {
        neighbor_lod_for_face(neighbor_lods, face)
            .is_some_and(|n| n != LodLevel::Culled && my_lod.is_lower_detail_than(n))
    });
    if !borders_finer {
        return Vec::new();
    }
    own_strips.iter_strips().cloned().collect()
}

/// Stage 4: append watertight stitch triangles bridging this chunk's fine boundary to
/// each strictly-coarser neighbour's boundary, and un-morph those faces' boundary verts
/// so the main surface stays at its Surface Nets position and meets the stitch. Returns
/// the mask of stitched faces so the caller suppresses skirts there. Must run AFTER
/// `apply_snap_or_morph` and BEFORE skirts / `pad_morph_targets_identity` (which fills
/// identity morph rows for the appended stitch verts).
///
/// This closes the cases the morph weld alone cannot: the steep-side gap (segment
/// over-distance) and the 2:1 density T-junction. Triangulated only for
/// single-component strips; ambiguous multi-chain faces keep their skirt.
#[allow(clippy::too_many_arguments)]
pub(super) fn append_seam_stitches(
    solid_mesh: &mut MeshData,
    local_positions: &[Vec3],
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    own_strips: &crate::voxel::lod_boundary_strip::OwnBoundaryStrips,
    neighbor_strips: Option<&crate::voxel::lod_boundary_strip::NeighborBoundaryStrips>,
) -> SeamStitchResult {
    let mut result = SeamStitchResult::default();
    let Some(neighbor_strips) = neighbor_strips else {
        return result;
    };
    if neighbor_strips.is_empty() || my_lod.step_size() == 0 {
        return result;
    }

    let origin = chunk_origin.as_vec3();

    for face in XZ_FACES {
        let Some(coarse) = neighbor_strips.for_face(face) else {
            continue;
        };
        let Some(fine) = own_strips.for_face(face) else {
            continue;
        };
        let Some(stitch) = crate::voxel::lod_boundary_strip::stitch_boundary_strips(fine, coarse)
        else {
            continue;
        };

        let tri_count = (stitch.indices.len() / 3) as u16;
        if let Some(idx) = xz_face_index(face) {
            result.triangle_counts[idx] = tri_count;
        }
        // Append as non-indexed triangles to match the main-surface convention
        // (per-triangle verts + barycentrics).
        for tri in stitch.indices.chunks(3) {
            if tri.len() < 3 {
                continue;
            }
            let base = solid_mesh.positions.len() as u32;
            for &idx in tri {
                let local = Vec3::from_array(stitch.positions[idx as usize]) - origin;
                solid_mesh
                    .positions
                    .push(scale_vertex_from_center(local, chunk_center));
                solid_mesh.normals.push(stitch.normals[idx as usize]);
                solid_mesh.uvs.push([1.0, 0.0]); // ao=1 (no darkening)
                solid_mesh.colors.push([0.0, 0.0, 0.0, 1.0]); // default material (v1)
            }
            solid_mesh.indices.push(base);
            solid_mesh.indices.push(base + 1);
            solid_mesh.indices.push(base + 2);
            solid_mesh
                .push_triangle_barycentrics_with_section(TERRAIN_MESH_SECTION_TRANSITION_APRON);
        }

        // Keep the main-surface boundary at its SN position so it meets the stitch.
        for (i, local) in local_positions.iter().enumerate() {
            if i < solid_mesh.morph_targets.len() && in_lod_boundary_cell(*local, face, my_lod) {
                solid_mesh.morph_targets[i][3] = 0.0;
            }
        }
        result.stitched_face_mask |= 1u8 << face as u8;
    }

    result
}

/// Extend `morph_targets` with identity rows (`[pos, 0]`) for any vertices appended
/// after morph baking (skirts / aprons), preserving the
/// `morph_targets.len() == positions.len()` invariant that `into_mesh` checks before
/// uploading the attribute. No-op when morph produced no targets.
pub(super) fn pad_morph_targets_identity(solid_mesh: &mut MeshData) {
    if solid_mesh.morph_targets.is_empty() {
        return;
    }
    while solid_mesh.morph_targets.len() < solid_mesh.positions.len() {
        let i = solid_mesh.morph_targets.len();
        let p = solid_mesh.positions[i];
        solid_mesh.morph_targets.push([p[0], p[1], p[2], 0.0]);
    }
}

pub(super) fn snap_boundary_vertices_to_lower_detail_neighbor(
    solid_mesh: &mut MeshData,
    local_positions: &mut [Vec3],
    _chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> LodTransitionSnapStats {
    let mut stats = LodTransitionSnapStats {
        boundary_candidate_vertex_count: transition_boundary_vertex_count(
            local_positions,
            my_lod,
            neighbor_lods,
        ),
        ..Default::default()
    };
    if my_lod.step_size() == 0 || solid_mesh.positions.len() != local_positions.len() {
        return stats;
    }

    let mut face_targets: Vec<(ChunkFace, Vec<(usize, Vec3)>)> = Vec::new();
    for face in [
        ChunkFace::NegX,
        ChunkFace::PosX,
        ChunkFace::NegY,
        ChunkFace::PosY,
        ChunkFace::NegZ,
        ChunkFace::PosZ,
    ] {
        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
            continue;
        };
        let visual_my_lod = visual_surface_nets_target_lod(my_lod);
        let visual_neighbor_lod = visual_surface_nets_target_lod(neighbor_lod);
        if visual_neighbor_lod == LodLevel::Culled
            || !visual_neighbor_lod.is_lower_detail_than(visual_my_lod)
        {
            continue;
        }
        let Some(target_lod) = transition_target_lod(my_lod, neighbor_lod) else {
            stats.mark_fallback(face);
            continue;
        };

        let mut targets = Vec::new();
        for (index, local) in local_positions.iter().copied().enumerate() {
            if !in_lod_boundary_cell(local, face, my_lod) {
                continue;
            }

            let target = match face {
                ChunkFace::NegX | ChunkFace::PosX | ChunkFace::NegZ | ChunkFace::PosZ => {
                    let Some(target) = xz_face_coarse_target_local(
                        world,
                        chunk_origin,
                        local,
                        face,
                        target_lod,
                        terrain_morph_config().max_stitch_distance,
                    ) else {
                        stats.skipped_vertex_count = stats.skipped_vertex_count.saturating_add(1);
                        stats.mark_fallback(face);
                        continue;
                    };
                    target
                }
                ChunkFace::NegY | ChunkFace::PosY => {
                    let Some(target) =
                        coarse_lattice_y_face_target(chunk_origin, local, face, target_lod)
                    else {
                        stats.skipped_vertex_count = stats.skipped_vertex_count.saturating_add(1);
                        stats.mark_fallback(face);
                        continue;
                    };
                    target
                }
            };
            targets.push((index, target));
        }
        if targets.is_empty() {
            continue;
        }
        face_targets.push((face, targets));
    }

    let mut vertex_targets: HashMap<usize, (Vec3, ChunkFace)> = HashMap::new();
    let mut conflicting_vertices: HashSet<usize> = HashSet::new();
    for (face, targets) in &face_targets {
        for (index, target) in targets.iter().copied() {
            if let Some((existing_target, _existing_face)) = vertex_targets.get(&index).copied() {
                if (existing_target - target).length() > VOXEL_SIZE * 0.05 {
                    // Multi-face corner/edge vertices can legitimately resolve to
                    // different coarse targets for each face. Skip only the
                    // conflicted vertex; marking both whole faces as fallback emits
                    // a full-width transition apron/skirt for a sparse corner case.
                    conflicting_vertices.insert(index);
                }
            } else {
                vertex_targets.insert(index, (target, *face));
            }
        }
    }
    stats.conflicting_vertex_count = conflicting_vertices.len() as u32;

    for (face, targets) in face_targets {
        let mut snapped = 0usize;
        for (index, local) in targets.iter().copied() {
            if conflicting_vertices.contains(&index) {
                continue;
            }
            local_positions[index] = local;
            solid_mesh.positions[index] = scale_vertex_from_center(local, chunk_center);
            // Preserve the pre-snap material weights. The snap target is a seam
            // weld position, not the semantic surface sample; recomputing here
            // can sample deeper subsoil/rock and paint a dark material band
            // along LOD junctions.
            if let Some(normal) = solid_mesh.normals.get_mut(index) {
                *normal = sdf_gradient_normal_at_local(world, chunk_origin, local);
            }
            snapped += 1;
        }
        if snapped > 0 {
            stats.mark_snapped(face, snapped);
        }
    }

    stats
}
