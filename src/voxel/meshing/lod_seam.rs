use super::{
    LodTransitionSnapStats, MeshData, MeshSdfCache, coarse_lod_iso_height_for_column,
    neighbor_lod_for_face, seam_audit::MorphFaceCounts,
};
use crate::constants::{CHUNK_BOUNDARY_SCALE, CHUNK_SIZE, CHUNK_SIZE_I32, VOXEL_SIZE};
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::world::VoxelWorld;
use bevy::prelude::{IVec2, IVec3, Vec3};
use std::collections::{HashMap, HashSet};

const MAX_LOD_STITCH_DISTANCE: f32 = 16.0;

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

/// LOD-boundary weld for a Surface Nets chunk using the legacy CPU snap path.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_lod_snap(
    solid_mesh: &mut MeshData,
    local_positions: &mut Vec<Vec3>,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
) -> (LodTransitionSnapStats, MorphFaceCounts) {
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
    (stats, MorphFaceCounts::default())
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
                        MAX_LOD_STITCH_DISTANCE,
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

    // Memoizes the smoothed-SDF taps across the snapped verts of all faces;
    // the uncached gradient costs ~1.3k chunk-hashmap lookups per vertex.
    let mut sdf_cache = (!face_targets.is_empty()).then(|| MeshSdfCache::new(chunk_origin, my_lod));
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
            if let (Some(normal), Some(cache)) =
                (solid_mesh.normals.get_mut(index), sdf_cache.as_mut())
            {
                *normal = cache.gradient_normal_at_local(world, local);
            }
            snapped += 1;
        }
        if snapped > 0 {
            stats.mark_snapped(face, snapped);
        }
    }

    stats
}
