//! CPU morph metadata for GPU terrain geomorph (Surface Nets LOD).
//!
//! PR1 scope (see `docs/lod/gpu-terrain-geomorph-plan.md`): compute the per-vertex
//! `ATTRIBUTE_MORPH_TARGET` payload for a Surface Nets chunk mesh. This module is
//! **not yet wired into the meshing pipeline** — it is exercised by unit tests only.
//! The pipeline hook, `into_mesh` upload, skirt rows, and shader land in PR2/PR3.
//!
//! Boundary morph targets reuse the **same** coarse-aligned math as
//! `snap_boundary_vertices_to_lower_detail_neighbor`, so a seam vertex blended to
//! `t = 1` lands exactly where CPU snap would weld it (this equivalence is the point
//! of the "Benefit vs. CPU snap" caveat in the plan, and is asserted below).

use bevy::math::{IVec3, Vec3};

use crate::constants::{CHUNK_SIZE, VOXEL_SIZE};
use crate::voxel::chunk::LodLevel;
use crate::voxel::meshing::{
    MeshData, coarse_lattice_y_face_target, neighbor_lod_for_face, scale_vertex_from_center,
    transition_target_lod, xz_face_coarse_target_local,
};
use crate::voxel::meshing_types::{MorphTargetError, TerrainMorphConfig};
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::world::VoxelWorld;

/// Whether `local` lies inside the outermost cell row of `face` for `my_lod`.
///
/// This mirrors the `in_boundary_cell` closure in
/// `snap_boundary_vertices_to_lower_detail_neighbor` (band width = `step_size`
/// voxels, **not** skirt's old `0.01` epsilon). Kept as a small local copy rather
/// than threading the closure out of the hot snap function; the snap path remains
/// the source of truth.
fn in_boundary_cell(local: Vec3, face: ChunkFace, my_lod: LodLevel) -> bool {
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

/// Coarse-aligned local morph target for `local` on `face`, or `None` when no
/// target applies (column has no single clean coarse crossing, Y step trivial, …).
/// Same branch structure as the snap target computation.
fn boundary_target_local(
    local: Vec3,
    face: ChunkFace,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    my_lod: LodLevel,
    neighbor_lod: LodLevel,
    max_stitch_distance: f32,
) -> Option<Vec3> {
    let target_lod = transition_target_lod(my_lod, neighbor_lod)?;
    match face {
        ChunkFace::NegX | ChunkFace::PosX | ChunkFace::NegZ | ChunkFace::PosZ => {
            xz_face_coarse_target_local(
                world,
                chunk_origin,
                local,
                face,
                target_lod,
                max_stitch_distance,
            )
        }
        ChunkFace::NegY | ChunkFace::PosY => {
            coarse_lattice_y_face_target(chunk_origin, local, face, target_lod)
        }
    }
}

/// Fill `mesh.morph_targets` (one `[x, y, z, w]` per vertex) for a Surface Nets
/// chunk.
///
/// - Interior / non-transition verts get an **identity** target `[pos, 0.0]` so the
///   shader `mix(position, target.xyz, t)` is a no-op regardless of the distance
///   factor (storing `[0,0,0,0]` would drag interior verts toward the origin — see
///   the plan's distance-factor caveat).
/// - Verts inside the boundary band of a face whose neighbor is **lower detail**
///   get `[coarse_target, 1.0]`, with `coarse_target` in the same local space and
///   `CHUNK_BOUNDARY_SCALE` scaling as `POSITION` (via `scale_vertex_from_center`).
///
/// When `config.enabled` is false, every vertex receives an identity target, so the
/// uploaded mesh is identical to the pre-geomorph result.
///
/// `local_positions` are the unscaled Surface Nets vertex positions parallel to
/// `mesh.positions`; both must have the same length.
///
/// Multi-face corners are resolved by iterating `ChunkFace::ALL` in order and
/// letting the last qualifying face win — deterministic, and adequate for v1 since
/// this metadata is not yet pipeline-wired. (Snap has richer conflict handling.)
pub fn append_morph_targets(
    mesh: &mut MeshData,
    local_positions: &[Vec3],
    world: &VoxelWorld,
    chunk_origin: IVec3,
    chunk_center: Vec3,
    my_lod: LodLevel,
    neighbor_lods: &NeighborLods,
    config: &TerrainMorphConfig,
) -> Result<(), MorphTargetError> {
    if mesh.positions.len() != local_positions.len() {
        return Err(MorphTargetError::PositionLengthMismatch {
            positions: mesh.positions.len(),
            local_positions: local_positions.len(),
        });
    }

    // Identity targets first: every vertex starts as a no-op morph (w = 0).
    mesh.morph_targets.clear();
    mesh.morph_targets.reserve(mesh.positions.len());
    for pos in &mesh.positions {
        mesh.morph_targets.push([pos[0], pos[1], pos[2], 0.0]);
    }

    if !config.enabled || my_lod.step_size() == 0 {
        return Ok(());
    }

    let mut target_locals: Vec<Option<Vec3>> = vec![None; local_positions.len()];
    let mut conflicting_targets = vec![false; local_positions.len()];

    for face in ChunkFace::ALL {
        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, face) else {
            continue;
        };
        if neighbor_lod == LodLevel::Culled || !neighbor_lod.is_lower_detail_than(my_lod) {
            continue;
        }

        for (index, local) in local_positions.iter().copied().enumerate() {
            if !in_boundary_cell(local, face, my_lod) {
                continue;
            }
            let Some(target_local) = boundary_target_local(
                local,
                face,
                world,
                chunk_origin,
                my_lod,
                neighbor_lod,
                config.max_stitch_distance,
            ) else {
                continue;
            };
            if let Some(existing) = target_locals[index] {
                if (existing - target_local).length() > VOXEL_SIZE * 0.05 {
                    conflicting_targets[index] = true;
                }
            } else {
                target_locals[index] = Some(target_local);
            }
        }
    }

    for (index, target_local) in target_locals.into_iter().enumerate() {
        if conflicting_targets[index] {
            continue;
        }
        let Some(target_local) = target_local else {
            continue;
        };
        let scaled = scale_vertex_from_center(target_local, chunk_center);
        mesh.morph_targets[index] = [scaled[0], scaled[1], scaled[2], 1.0];
    }

    // Proof-of-life: emit once when the morph first welds boundary verts, so a run
    // with VOXELS_TERRAIN_MORPH=1 visibly confirms the GPU path is doing work (the
    // visual result still matches snap — see decision D1).
    let welded = mesh.morph_targets.iter().filter(|t| t[3] > 0.5).count();
    if welded > 0 {
        static LOGGED: std::sync::Once = std::sync::Once::new();
        LOGGED.call_once(|| {
            bevy::log::info!(
                "GPU terrain morph ACTIVE: welded {welded} of {} verts on a transition chunk",
                mesh.morph_targets.len()
            );
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::VOXEL_SIZE;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::meshing::{coarse_lod_iso_height_for_column, snap_column_for_face};
    use crate::voxel::types::VoxelType;

    fn world_with_test_chunks(size: IVec3) -> VoxelWorld {
        let mut world = VoxelWorld::new(size);
        for x in 0..size.x {
            for y in 0..size.y {
                for z in 0..size.z {
                    world.insert_chunk(Chunk::new(IVec3::new(x, y, z)));
                }
            }
        }
        world
    }

    fn fill_steep_x_slope(world: &mut VoxelWorld) {
        let bounds = world.bounds();
        for x in bounds.horizontal_min.x..=bounds.horizontal_max.x {
            let surface_y = 44 - x / 2;
            for z in bounds.horizontal_min.y..=bounds.horizontal_max.y {
                for y in bounds.min_world_y..surface_y {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
                }
            }
        }
    }

    fn test_chunk_center() -> Vec3 {
        Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE
    }

    fn mesh_for_local_positions(local_positions: &[Vec3], chunk_center: Vec3) -> MeshData {
        let mut mesh = MeshData::new();
        for local in local_positions {
            mesh.positions
                .push(scale_vertex_from_center(*local, chunk_center));
            mesh.colors.push([0.0; 4]);
        }
        mesh
    }

    fn enabled_config() -> TerrainMorphConfig {
        TerrainMorphConfig {
            enabled: true,
            ..Default::default()
        }
    }

    fn pos_x_transition() -> NeighborLods {
        NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        }
    }

    #[test]
    fn length_mismatch_is_an_error() {
        let world = world_with_test_chunks(IVec3::new(1, 1, 1));
        let mut mesh = MeshData::new();
        mesh.positions.push([0.0, 0.0, 0.0]);
        let err = append_morph_targets(
            &mut mesh,
            &[],
            &world,
            IVec3::ZERO,
            test_chunk_center(),
            LodLevel::Lod0,
            &NeighborLods::default(),
            &enabled_config(),
        )
        .unwrap_err();
        assert_eq!(
            err,
            MorphTargetError::PositionLengthMismatch {
                positions: 1,
                local_positions: 0,
            }
        );
    }

    #[test]
    fn morph_disabled_emits_identity_targets_only() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        // Includes a PosX boundary vertex that *would* morph if enabled.
        let local_positions = vec![
            Vec3::new(CHUNK_SIZE as f32, 2.0, 2.0),
            Vec3::new(8.0, 8.0, 8.0),
        ];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &pos_x_transition(),
            &TerrainMorphConfig::default(), // disabled
        )
        .unwrap();

        assert_eq!(mesh.morph_targets.len(), mesh.positions.len());
        for (target, pos) in mesh.morph_targets.iter().zip(&mesh.positions) {
            assert_eq!(target[3], 0.0, "disabled morph must leave every w == 0");
            assert_eq!([target[0], target[1], target[2]], *pos, "identity xyz");
        }
    }

    #[test]
    fn interior_vertex_has_zero_seam_weight() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local_positions = vec![Vec3::new(8.0, 8.0, 8.0)];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &pos_x_transition(),
            &enabled_config(),
        )
        .unwrap();

        assert_eq!(mesh.morph_targets[0][3], 0.0);
        assert_eq!(
            [
                mesh.morph_targets[0][0],
                mesh.morph_targets[0][1],
                mesh.morph_targets[0][2]
            ],
            mesh.positions[0]
        );
    }

    #[test]
    fn posx_boundary_vertex_morphs_when_neighbor_is_coarser() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local_positions = vec![
            Vec3::new(CHUNK_SIZE as f32, 2.0, 2.0),
            Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0),
            Vec3::new(CHUNK_SIZE as f32, 9.0, 14.0),
        ];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &pos_x_transition(),
            &enabled_config(),
        )
        .unwrap();

        for target in &mesh.morph_targets {
            assert_eq!(target[3], 1.0, "every PosX boundary vertex should morph");
        }
    }

    #[test]
    fn fractional_posx_boundary_cell_vertex_morphs_when_neighbor_is_coarser() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local_positions = vec![
            Vec3::new(CHUNK_SIZE as f32 - 0.6, 5.0, 8.0),
            Vec3::new(CHUNK_SIZE as f32 - 0.01, 9.0, 14.0),
            Vec3::new(CHUNK_SIZE as f32 - 1.1, 8.0, 8.0),
        ];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &pos_x_transition(),
            &enabled_config(),
        )
        .unwrap();

        assert_eq!(
            mesh.morph_targets[0][3], 1.0,
            "fractional vertex inside the Lod0 boundary cell must morph"
        );
        assert_eq!(
            mesh.morph_targets[1][3], 1.0,
            "near-plane fractional vertex must morph"
        );
        assert_eq!(
            mesh.morph_targets[2][3], 0.0,
            "vertex outside the Lod0 boundary cell must stay interior"
        );
    }

    #[test]
    fn fractional_xz_boundary_targets_anchor_to_seam_planes() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local_positions = vec![
            Vec3::new(CHUNK_SIZE as f32 - 0.6, 5.0, 8.0),
            Vec3::new(0.6, 5.0, 8.0),
            Vec3::new(8.0, 5.0, CHUNK_SIZE as f32 - 0.6),
            Vec3::new(8.0, 5.0, 0.6),
        ];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &NeighborLods {
                pos_x: Some(LodLevel::Lod1),
                neg_x: Some(LodLevel::Lod1),
                pos_z: Some(LodLevel::Lod1),
                neg_z: Some(LodLevel::Lod1),
                ..Default::default()
            },
            &enabled_config(),
        )
        .unwrap();

        let pos_x = scale_vertex_from_center(Vec3::new(CHUNK_SIZE as f32, 0.0, 0.0), center)[0];
        let neg_x = scale_vertex_from_center(Vec3::new(0.0, 0.0, 0.0), center)[0];
        let pos_z = scale_vertex_from_center(Vec3::new(0.0, 0.0, CHUNK_SIZE as f32), center)[2];
        let neg_z = scale_vertex_from_center(Vec3::new(0.0, 0.0, 0.0), center)[2];

        for target in &mesh.morph_targets {
            assert_eq!(target[3], 1.0);
        }
        assert!((mesh.morph_targets[0][0] - pos_x).abs() <= 1.0e-4);
        assert!((mesh.morph_targets[1][0] - neg_x).abs() <= 1.0e-4);
        assert!((mesh.morph_targets[2][2] - pos_z).abs() <= 1.0e-4);
        assert!((mesh.morph_targets[3][2] - neg_z).abs() <= 1.0e-4);
    }

    #[test]
    fn lod3_neighbor_uses_lod2_visual_target() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local = Vec3::new(CHUNK_SIZE as f32 - 0.4, 5.0, 8.0);
        let local_positions = vec![local];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod1,
            &NeighborLods {
                pos_x: Some(LodLevel::Lod3),
                ..Default::default()
            },
            &enabled_config(),
        )
        .unwrap();

        let column = snap_column_for_face(chunk_origin, local, ChunkFace::PosX).unwrap();
        let world_y = coarse_lod_iso_height_for_column(&world, column.x, column.y, LodLevel::Lod2)
            .expect("steep slope has a Lod2 visual crossing");
        let expected = scale_vertex_from_center(
            Vec3::new(CHUNK_SIZE as f32, world_y - chunk_origin.y as f32, local.z),
            center,
        );

        assert_eq!(mesh.morph_targets[0][3], 1.0);
        assert!((mesh.morph_targets[0][0] - expected[0]).abs() <= 1e-4);
        assert!((mesh.morph_targets[0][1] - expected[1]).abs() <= 1e-4);
        assert!((mesh.morph_targets[0][2] - expected[2]).abs() <= 1e-4);
    }

    #[test]
    fn lod_delta_gt_one_neighbor_does_not_emit_morph_target() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local_positions = vec![Vec3::new(CHUNK_SIZE as f32 - 0.4, 5.0, 8.0)];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &NeighborLods {
                pos_x: Some(LodLevel::Lod2),
                ..Default::default()
            },
            &enabled_config(),
        )
        .unwrap();

        assert_eq!(mesh.morph_targets[0][3], 0.0);
        assert_eq!(
            [
                mesh.morph_targets[0][0],
                mesh.morph_targets[0][1],
                mesh.morph_targets[0][2]
            ],
            mesh.positions[0]
        );
    }

    #[test]
    fn no_morph_when_neighbor_is_not_coarser() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local_positions = vec![Vec3::new(CHUNK_SIZE as f32, 2.0, 2.0)];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        // Same-detail neighbor → no transition → no morph.
        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &NeighborLods {
                pos_x: Some(LodLevel::Lod0),
                ..Default::default()
            },
            &enabled_config(),
        )
        .unwrap();

        assert_eq!(mesh.morph_targets[0][3], 0.0);
    }

    #[test]
    fn duplicated_corner_vertices_get_identical_targets() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        // Same geometric corner appears three times (as a per-triangle mesh would).
        let corner = Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0);
        let local_positions = vec![corner, corner, corner];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &pos_x_transition(),
            &enabled_config(),
        )
        .unwrap();

        assert_eq!(mesh.morph_targets[0], mesh.morph_targets[1]);
        assert_eq!(mesh.morph_targets[1], mesh.morph_targets[2]);
        assert_eq!(mesh.morph_targets[0][3], 1.0);
    }

    #[test]
    fn conflicting_multi_face_corner_keeps_identity_target() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let corner = Vec3::new(CHUNK_SIZE as f32 - 0.4, 5.0, CHUNK_SIZE as f32 - 0.4);
        let local_positions = vec![corner];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &NeighborLods {
                pos_x: Some(LodLevel::Lod1),
                pos_z: Some(LodLevel::Lod1),
                ..Default::default()
            },
            &enabled_config(),
        )
        .unwrap();

        assert_eq!(
            mesh.morph_targets[0][3], 0.0,
            "conflicting corner targets must not let the last face pull a seam-end spike"
        );
        assert_eq!(
            [
                mesh.morph_targets[0][0],
                mesh.morph_targets[0][1],
                mesh.morph_targets[0][2]
            ],
            mesh.positions[0]
        );
    }

    #[test]
    fn boundary_target_matches_snap_coarse_iso_destination() {
        let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
        fill_steep_x_slope(&mut world);
        let chunk_pos = IVec3::new(1, 1, 1);
        let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
        let center = test_chunk_center();
        let local = Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0);
        let local_positions = vec![local];
        let mut mesh = mesh_for_local_positions(&local_positions, center);

        append_morph_targets(
            &mut mesh,
            &local_positions,
            &world,
            chunk_origin,
            center,
            LodLevel::Lod0,
            &pos_x_transition(),
            &enabled_config(),
        )
        .unwrap();

        // Reconstruct the snap destination from the shared coarse-iso helper.
        let column = snap_column_for_face(chunk_origin, local, ChunkFace::PosX).unwrap();
        let world_y = coarse_lod_iso_height_for_column(&world, column.x, column.y, LodLevel::Lod1)
            .expect("steep slope has a single coarse crossing");
        let expected = scale_vertex_from_center(
            Vec3::new(local.x, world_y - chunk_origin.y as f32, local.z),
            center,
        );

        assert_eq!(mesh.morph_targets[0][3], 1.0);
        assert!((mesh.morph_targets[0][0] - expected[0]).abs() <= 1e-4);
        assert!((mesh.morph_targets[0][1] - expected[1]).abs() <= 1e-4);
        assert!((mesh.morph_targets[0][2] - expected[2]).abs() <= 1e-4);
    }
}
