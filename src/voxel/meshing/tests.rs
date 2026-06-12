use super::*;
use crate::constants::{CHUNK_VOLUME, WATER_LEVEL};
use crate::rendering::ao_config::BakedAoConfig;

fn default_strip_status() -> [super::seam_audit::SeamStripStatus; super::seam_audit::XZ_FACE_COUNT]
{
    [super::seam_audit::SeamStripStatus::NotNeeded; super::seam_audit::XZ_FACE_COUNT]
}

fn ao_config() -> BakedAoConfig {
    BakedAoConfig {
        enabled: false,
        strength: 0.0,
        corner_darkness: 0.0,
        fix_anisotropy: false,
    }
}

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

fn world_with_vertical_chunks() -> VoxelWorld {
    world_with_test_chunks(IVec3::new(1, 3, 1))
}

fn seal_air_cell(world: &mut VoxelWorld, air_pos: IVec3) {
    for offset in [IVec3::X, -IVec3::X, IVec3::Y, IVec3::Z, -IVec3::Z] {
        world.set_voxel(air_pos + offset, VoxelType::Rock);
    }
}

fn meshed_water(world: &VoxelWorld) -> ChunkMeshResult {
    let chunk = world.get_chunk(IVec3::new(0, 1, 0)).unwrap();
    generate_chunk_mesh(
        chunk,
        world,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
    )
}

fn meshed_chunk(world: &VoxelWorld, chunk_pos: IVec3) -> ChunkMeshResult {
    let chunk = world.get_chunk(chunk_pos).unwrap();
    generate_chunk_mesh(
        chunk,
        world,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
    )
}

#[test]
fn blocky_mesh_uses_assigned_voxel_material_for_texture_layer() {
    let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
    let position = IVec3::new(8, 8, 8);
    world.set_voxel(position, VoxelType::Rock);
    world.set_material_id_with_rules(position, MaterialId(5), None);

    let mesh = meshed_chunk(&world, IVec3::ZERO);
    let sand_layers = [9.0 / 255.0, 10.0 / 255.0, 11.0 / 255.0];

    assert!(mesh.solid.colors.iter().any(|color| {
        sand_layers
            .iter()
            .any(|layer| (color[3] - layer).abs() < f32::EPSILON)
    }));
}

#[test]
fn surface_nets_weights_use_assigned_voxel_material_category() {
    let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
    let position = IVec3::new(8, 8, 8);
    world.set_voxel(position, VoxelType::Rock);
    world.set_material_id_with_rules(position, MaterialId(5), None);
    let chunk = world.get_chunk(IVec3::ZERO).unwrap();

    let weights =
        compute_vertex_material_weights(Vec3::new(8.0, 8.0, 8.0), chunk, &world, IVec3::ZERO);

    assert_eq!(weights, [0.0, 0.0, 1.0, 0.0]);
}

#[test]
fn lod_mismatch_material_weights_use_fine_sampler_in_boundary_band() {
    let mut world = world_with_test_chunks(IVec3::new(2, 1, 1));
    for x in 15..19 {
        for y in 8..12 {
            for z in 8..12 {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
            }
        }
    }
    for x in 15..17 {
        for y in 8..10 {
            for z in 8..10 {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::TopSoil);
            }
        }
    }

    let chunk = world.get_chunk(IVec3::ZERO).unwrap();
    let local_pos = Vec3::new(CHUNK_SIZE as f32 - 0.25, 8.0, 8.0);
    let coarse_weights =
        compute_vertex_material_weights_lod(local_pos, chunk, &world, IVec3::ZERO, LOD2_STEP_SIZE);
    let transition_weights = compute_vertex_material_weights_lod_transition_aware(
        local_pos,
        chunk,
        &world,
        IVec3::ZERO,
        LodLevel::Lod2,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod3),
            ..Default::default()
        },
        LOD2_STEP_SIZE,
    );
    let higher_neighbor_transition_weights = compute_vertex_material_weights_lod_transition_aware(
        local_pos,
        chunk,
        &world,
        IVec3::ZERO,
        LodLevel::Lod2,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        },
        LOD2_STEP_SIZE,
    );
    let no_transition_weights = compute_vertex_material_weights_lod_transition_aware(
        local_pos,
        chunk,
        &world,
        IVec3::ZERO,
        LodLevel::Lod2,
        &NeighborLods::default(),
        LOD2_STEP_SIZE,
    );

    assert!(
        coarse_weights[1] > 0.75,
        "fixture should make the coarse sampler mostly rock: {coarse_weights:?}"
    );
    assert_eq!(no_transition_weights, coarse_weights);
    assert_eq!(
        transition_weights,
        [1.0, 0.0, 0.0, 0.0],
        "transition seam vertices should keep the fine material neighborhood"
    );
    assert_eq!(
        higher_neighbor_transition_weights,
        [1.0, 0.0, 0.0, 0.0],
        "the lower-detail side of a seam should also keep the fine material neighborhood"
    );
}

fn surface_nets_mesh(chunk_pos: IVec3, world: &VoxelWorld) -> ChunkMeshResult {
    let chunk = world.get_chunk(chunk_pos).unwrap();
    generate_chunk_mesh_surface_nets(
        chunk,
        world,
        LodLevel::Lod0,
        NeighborLods {
            neg_x: None,
            pos_x: None,
            neg_y: None,
            pos_y: None,
            neg_z: None,
            pos_z: None,
        },
        &SkirtConfig::default(),
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    )
}

#[test]
fn lod0_transition_boundary_sdf_matches_lower_lod_neighbor_sample() {
    let chunk_pos = IVec3::new(1, 0, 2);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(4, 1, 5));
    world.set_voxel(chunk_origin + IVec3::new(16, 4, 4), VoxelType::Rock);

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let neighbor = world.get_chunk(chunk_pos + IVec3::X).unwrap();
    let no_transition_lods = NeighborLods {
        neg_x: None,
        pos_x: None,
        neg_y: None,
        pos_y: None,
        neg_z: None,
        pos_z: None,
    };
    let transition_lods = NeighborLods {
        neg_x: None,
        pos_x: Some(LodLevel::Lod1),
        neg_y: None,
        pos_y: None,
        neg_z: None,
        pos_z: None,
    };

    let boundary_idx = PaddedChunkShape::linearize([LOD0_PADDED_SIZE - 1, 5, 5]) as usize;
    let neighbor_boundary_idx = LodShape1::linearize([1, 3, 3]) as usize;

    let raw_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &no_transition_lods,
        false,
        BaseSdfTransitionMode::Coarsen,
    );
    let transition_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &transition_lods,
        false,
        BaseSdfTransitionMode::Coarsen,
    );
    let neighbor_lod1_sdf = generate_low_lod_sdf_with_smoothing::<LOD1_GRID_VOLUME>(
        neighbor,
        &world,
        LOD1_PADDED_SIZE,
        LOD1_STEP_SIZE as i32,
        LodShape1::linearize,
        LodLevel::Lod1,
        &NeighborLods::default(),
        false,
    );

    assert_eq!(
        transition_sdf[boundary_idx],
        neighbor_lod1_sdf[neighbor_boundary_idx]
    );
    assert_eq!(transition_sdf[boundary_idx], -1.0);
    assert_eq!(raw_sdf[boundary_idx], transition_sdf[boundary_idx]);
}

#[test]
fn lod0_transition_coarsens_full_boundary_band_not_just_outer_plane() {
    // The Surface-Nets cell that welds a Lod0 chunk to a lower-detail
    // neighbour straddles the boundary and uses the two outermost padded
    // planes as corners. Both must be coarsened; coarsening only the
    // outermost plane leaves the weld cell's inner corner at fine
    // resolution and a seam opens. This guards the inner plane
    // (px == LOD0_PADDED_SIZE - 2), which the original one-plane
    // transition left untouched.
    let chunk_pos = IVec3::new(1, 0, 2);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(4, 1, 5));
    // Solid voxel one aligned coarse step in from the PosX boundary. The
    // fine sample at the inner plane (local x = 15) misses it; the
    // lower-detail-aligned sample at local x = 14 picks it up.
    world.set_voxel(chunk_origin + IVec3::new(14, 4, 4), VoxelType::Rock);

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let no_transition_lods = NeighborLods::default();
    let transition_lods = NeighborLods {
        pos_x: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let inner_idx = PaddedChunkShape::linearize([LOD0_PADDED_SIZE - 2, 5, 5]) as usize;

    let raw_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &no_transition_lods,
        false,
        BaseSdfTransitionMode::Coarsen,
    );
    let transition_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &transition_lods,
        false,
        BaseSdfTransitionMode::Coarsen,
    );

    // Fine sampling at the inner plane misses the voxel.
    assert_eq!(raw_sdf[inner_idx], 1.0);
    // The transition must coarsen the inner plane too.
    assert_eq!(transition_sdf[inner_idx], -1.0);
}

#[test]
fn lod0_morph_base_sdf_keeps_transition_band_uniformly_fine() {
    let chunk_pos = IVec3::new(1, 0, 2);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(4, 1, 5));
    world.set_voxel(chunk_origin + IVec3::new(14, 4, 4), VoxelType::Rock);

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let no_transition_lods = NeighborLods::default();
    let transition_lods = NeighborLods {
        pos_x: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let inner_idx = PaddedChunkShape::linearize([LOD0_PADDED_SIZE - 2, 5, 5]) as usize;

    let raw_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &no_transition_lods,
        false,
        BaseSdfTransitionMode::Uniform,
    );
    let morph_base_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &transition_lods,
        false,
        BaseSdfTransitionMode::Uniform,
    );
    let legacy_coarsened_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &transition_lods,
        false,
        BaseSdfTransitionMode::Coarsen,
    );

    assert_eq!(raw_sdf[inner_idx], 1.0);
    assert_eq!(
        morph_base_sdf[inner_idx], raw_sdf[inner_idx],
        "GPU morph base POSITION mesh must not create a transition-only sign change"
    );
    assert_eq!(
        legacy_coarsened_sdf[inner_idx], -1.0,
        "fixture must still exercise the old coarsened-boundary wall risk"
    );
}

#[test]
fn lod0_vertical_transition_boundary_sdf_matches_lower_lod_neighbor_sample() {
    let chunk_pos = IVec3::new(0, 1, 0);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(1, 3, 1));
    world.set_voxel(chunk_origin + IVec3::new(4, 0, 4), VoxelType::Rock);

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let neighbor = world.get_chunk(chunk_pos + IVec3::NEG_Y).unwrap();
    let no_transition_lods = NeighborLods::default();
    let transition_lods = NeighborLods {
        neg_y: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let boundary_idx = PaddedChunkShape::linearize([6, 1, 5]) as usize;
    let neighbor_boundary_idx = LodShape1::linearize([3, LOD1_PADDED_SIZE - 1, 3]) as usize;

    let raw_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &no_transition_lods,
        false,
        BaseSdfTransitionMode::Coarsen,
    );
    let transition_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &transition_lods,
        false,
        BaseSdfTransitionMode::Coarsen,
    );
    let neighbor_lod1_sdf = generate_low_lod_sdf_with_smoothing::<LOD1_GRID_VOLUME>(
        neighbor,
        &world,
        LOD1_PADDED_SIZE,
        LOD1_STEP_SIZE as i32,
        LodShape1::linearize,
        LodLevel::Lod1,
        &NeighborLods::default(),
        false,
    );

    assert_eq!(raw_sdf[boundary_idx], 1.0);
    assert_eq!(
        transition_sdf[boundary_idx],
        neighbor_lod1_sdf[neighbor_boundary_idx]
    );
    assert_eq!(transition_sdf[boundary_idx], -1.0);
}

/// The smoothed SDF must never invert sign relative to the raw occupancy
/// at the same world voxel: solid centres return strict ≤ 0, air centres
/// return strict > 0. Classical Marching Cubes builds its case index from
/// `sdf < 0.0` per corner, so an air corner with a slightly-negative blur
/// flips a bit, selects the wrong case, and drops triangles — manifesting
/// as the scattered tiny holes we observed on MC LOD0 chunks. This test
/// guards against re-introducing that regression.
#[test]
fn smoothed_terrain_sdf_never_inverts_sign() {
    let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
    // 3x3x3 solid cube centred at (8, 8, 8). Air voxels in the surrounding
    // shell have 9 of their 27-cell neighbourhood as solid — the exact
    // configuration whose unclamped 1-2-1 blur could go negative.
    for x in 7..=9 {
        for y in 7..=9 {
            for z in 7..=9 {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
            }
        }
    }

    // Sample a 7x7x7 region around the cube — covers cube interior, shell,
    // and far-air cells.
    let mut saw_air_with_solid_neighbours = false;
    for z in 5..=11 {
        for x in 5..=11 {
            for y in 5..=11 {
                let p = IVec3::new(x, y, z);
                let raw = terrain_occupancy_sdf_at_world(&world, p);
                let smoothed = smoothed_terrain_sdf_at_world_pos(&world, p);
                if raw < 0.0 {
                    assert!(
                        smoothed <= 0.0,
                        "solid voxel {p:?} got smoothed = {smoothed} (must stay ≤ 0)"
                    );
                } else {
                    assert!(
                        smoothed > 0.0,
                        "air voxel {p:?} got smoothed = {smoothed} \
                         (must stay > 0; MC case index uses `< 0.0` per corner)"
                    );
                    // Face-adjacent air voxels of the cube are exactly the
                    // pre-clamp negative-blur case we want to exercise.
                    if (p.x == 6 || p.x == 10) && (7..=9).contains(&p.y) && (7..=9).contains(&p.z) {
                        saw_air_with_solid_neighbours = true;
                    }
                }
            }
        }
    }
    assert!(
        saw_air_with_solid_neighbours,
        "test fixture failed to exercise the air-adjacent-to-solid case"
    );
}

/// Same sign-invariant as `smoothed_terrain_sdf_never_inverts_sign` but
/// exercised through the block path used by `generate_sdf` for LOD0
/// non-transition cells — which is the MC LOD0 consumer's source. This
/// catches the case where only the per-voxel path got the clamp but the
/// block path still let an air corner go slightly negative.
#[test]
fn smoothed_block_sdf_never_inverts_sign() {
    let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
    // 3x3x3 solid cube centred at (8, 8, 8) — same fixture as the per-voxel test.
    for x in 7..=9 {
        for y in 7..=9 {
            for z in 7..=9 {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
            }
        }
    }

    let chunk_origin = VoxelWorld::chunk_to_world(IVec3::ZERO);
    let block = build_sdf_smoothing_block(&world, chunk_origin);

    // Padded cell (px, py, pz) maps to world voxel chunk_origin + (px-1, py-1, pz-1).
    // Walk a padded region that covers the cube interior, shell, and far-air cells.
    let mut saw_air_with_solid_neighbours = false;
    for pz in 6..=12 {
        for py in 6..=12 {
            for px in 6..=12 {
                let world_voxel =
                    chunk_origin + IVec3::new(px as i32 - 1, py as i32 - 1, pz as i32 - 1);
                let raw = terrain_occupancy_sdf_at_world(&world, world_voxel);
                let smoothed = smoothed_sdf_from_block(&block, px, py, pz);
                if raw < 0.0 {
                    assert!(
                        smoothed <= 0.0,
                        "solid padded cell ({px},{py},{pz}) -> world {world_voxel:?} \
                         got smoothed = {smoothed} (must stay ≤ 0)"
                    );
                } else {
                    assert!(
                        smoothed > 0.0,
                        "air padded cell ({px},{py},{pz}) -> world {world_voxel:?} \
                         got smoothed = {smoothed} (must stay > 0; MC case index \
                         uses `< 0.0` per corner — the LOD0 hole regression)"
                    );
                    if (world_voxel.x == 6 || world_voxel.x == 10)
                        && (7..=9).contains(&world_voxel.y)
                        && (7..=9).contains(&world_voxel.z)
                    {
                        saw_air_with_solid_neighbours = true;
                    }
                }
            }
        }
    }
    assert!(
        saw_air_with_solid_neighbours,
        "test fixture failed to exercise the air-adjacent-to-solid case via the block path"
    );
}

/// Minimal air-to-solid sign-flip fixture (per peer-review feedback):
/// one air cell at +0.1 surrounded by six face-neighbour solids at -1.0.
/// Pre-clamp mix: 0.1*0.5 + (-1.0)*0.5 = -0.45, which flips the sign.
#[test]
fn smooth_lod_sdf_interior_preserves_air_sign_near_solids() {
    const N: usize = 5;
    let linearize = |p: [u32; 3]| -> u32 { p[0] + p[1] * N as u32 + p[2] * N as u32 * N as u32 };

    let mut sdf = [1.0f32; N * N * N];
    let center = linearize([2, 2, 2]) as usize;

    sdf[center] = 0.1;
    for p in [
        [1, 2, 2],
        [3, 2, 2],
        [2, 1, 2],
        [2, 3, 2],
        [2, 2, 1],
        [2, 2, 3],
    ] {
        sdf[linearize(p) as usize] = -1.0;
    }

    let smoothed = smooth_lod_sdf_interior(&sdf, N as u32, linearize, 0.5);

    assert!(
        smoothed[center] > 0.0,
        "LOD smoothing flipped an air sample negative (raw=0.1, smoothed={})",
        smoothed[center]
    );
}

/// Minimal solid-to-air sign-flip fixture (per peer-review feedback): one
/// solid cell at -1.0 surrounded by six +1.0 air face-neighbours. Pre-clamp
/// mix: -1.0*0.5 + 1.0*0.5 = 0.0. MC treats 0.0 as non-solid because the
/// case test is `< 0.0`, so without the clamp this still corrupts MC.
#[test]
fn smooth_lod_sdf_interior_preserves_solid_sign_near_air() {
    const N: usize = 5;
    let linearize = |p: [u32; 3]| -> u32 { p[0] + p[1] * N as u32 + p[2] * N as u32 * N as u32 };

    let mut sdf = [1.0f32; N * N * N];
    let center = linearize([2, 2, 2]) as usize;

    sdf[center] = -1.0;

    let smoothed = smooth_lod_sdf_interior(&sdf, N as u32, linearize, 0.5);

    assert!(
        smoothed[center] < 0.0,
        "LOD smoothing flipped a solid sample non-negative (raw=-1.0, smoothed={})",
        smoothed[center]
    );
}

#[test]
fn smooth_lod_sdf_interior_treats_zero_as_air_for_mc_case_sign() {
    const N: usize = 5;
    let linearize = |p: [u32; 3]| -> u32 { p[0] + p[1] * N as u32 + p[2] * N as u32 * N as u32 };

    let mut sdf = [1.0f32; N * N * N];
    let center = linearize([2, 2, 2]) as usize;

    sdf[center] = 0.0;
    for p in [
        [1, 2, 2],
        [3, 2, 2],
        [2, 1, 2],
        [2, 3, 2],
        [2, 2, 1],
        [2, 2, 3],
    ] {
        sdf[linearize(p) as usize] = -1.0;
    }

    let smoothed = smooth_lod_sdf_interior(&sdf, N as u32, linearize, 0.5);

    assert!(
        smoothed[center] > 0.0,
        "LOD smoothing must preserve MC's non-solid classification for zero samples (smoothed={})",
        smoothed[center]
    );
}

/// `smooth_lod_sdf_interior` averages each near-surface cell with its 6
/// neighbours. Without a sign-preservation clamp, an air cell (+0.5) with
/// 4-5 mostly-solid neighbours (avg ~-0.58) at 50/50 weight produces ~-0.04
/// — a sign flip. MC's case index uses `< 0.0` per corner, so a sign flip
/// here selects the wrong MC case and drops triangles, producing static
/// holes in LOD1+ meshes. This test reproduces that fixture and asserts
/// the clamp keeps every air cell strictly positive after smoothing.
#[test]
fn smooth_lod_sdf_interior_preserves_sign_at_iso_surface() {
    // A 10x10x10 grid (LOD1 padded size) where one corner of the interior
    // is solid (a 3x3x3 block at padded (4..7, 4..7, 4..7)). The air cells
    // along its faces have 4 of 6 neighbours solid — exactly the pre-clamp
    // sign-flip case.
    const N: usize = 10;
    let linearize = |c: [u32; 3]| c[0] + c[1] * N as u32 + c[2] * N as u32 * N as u32;
    let mut sdf = [1.0f32; N * N * N];
    for z in 4..=6 {
        for y in 4..=6 {
            for x in 4..=6 {
                sdf[linearize([x, y, z]) as usize] = -1.0;
            }
        }
    }

    let smoothed = smooth_lod_sdf_interior(&sdf, N as u32, linearize, 0.5);

    // Every air cell (original +1.0) must remain strictly positive.
    // Every solid cell (original -1.0) must remain strictly negative.
    let mut saw_smoothed_air_with_solid_neighbours = false;
    for z in 2..(N as u32 - 2) {
        for y in 2..(N as u32 - 2) {
            for x in 2..(N as u32 - 2) {
                let idx = linearize([x, y, z]) as usize;
                let raw = sdf[idx];
                let post = smoothed[idx];
                if raw > 0.0 {
                    assert!(
                        post > 0.0,
                        "air cell at ({x},{y},{z}) flipped sign: raw={raw} smoothed={post}"
                    );
                } else {
                    assert!(
                        post < 0.0,
                        "solid cell at ({x},{y},{z}) flipped sign: raw={raw} smoothed={post}"
                    );
                }
                // Air cells face-adjacent to the cube are the exact
                // sign-flip configuration; mark we exercised them.
                if raw > 0.0 && ((x == 3 || x == 7) && (4..=6).contains(&y) && (4..=6).contains(&z))
                {
                    saw_smoothed_air_with_solid_neighbours = true;
                }
            }
        }
    }
    assert!(
        saw_smoothed_air_with_solid_neighbours,
        "test fixture failed to exercise an air cell with mostly-solid neighbours"
    );
}

#[test]
fn smoothed_lod0_sdf_is_fractional_but_boundary_consistent_across_chunks() {
    // Two same-LOD horizontally-adjacent chunks. With no LOD transition,
    // every boundary cell is smoothed, so this guards the regression the
    // old binary field was protecting against: the smoothed field must be
    // identical on the shared boundary plane of both chunks (no new seam),
    // while still being fractional (terracing actually removed).
    let chunk_pos = IVec3::new(1, 0, 1);
    let neighbor_pos = chunk_pos + IVec3::X;
    let origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(4, 1, 4));
    // A ramp of solid voxels spanning the shared X boundary at varying
    // heights so the boundary cells contain a real, non-trivial surface.
    for z in 0..CHUNK_SIZE_I32 {
        let height = 3 + (z % 4);
        for y in 0..=height {
            for x in 12..20 {
                world.set_voxel(origin + IVec3::new(x, y, z), VoxelType::Rock);
            }
        }
    }

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let neighbor = world.get_chunk(neighbor_pos).unwrap();
    let lods = NeighborLods::default();

    let sdf = generate_sdf(chunk, &world, LodLevel::Lod0, &lods, true);
    let neighbor_sdf = generate_sdf(neighbor, &world, LodLevel::Lod0, &lods, true);

    // Shared world voxels: this chunk's px == 17 plane is the neighbour's
    // qx == 1 plane (both world x == origin.x + 16).
    let mut saw_fractional = false;
    for z in 1..LOD0_PADDED_SIZE - 1 {
        for y in 1..LOD0_PADDED_SIZE - 1 {
            let mine = sdf[PaddedChunkShape::linearize([LOD0_PADDED_SIZE - 1, y, z]) as usize];
            let theirs = neighbor_sdf[PaddedChunkShape::linearize([1, y, z]) as usize];
            assert!(
                (mine - theirs).abs() < 1e-6,
                "boundary mismatch at (y={y}, z={z}): {mine} vs {theirs}"
            );
            if mine.abs() > 1e-3 && mine.abs() < 0.999 {
                saw_fractional = true;
            }
        }
    }
    assert!(
        saw_fractional,
        "smoothed boundary should contain fractional SDF values, not just ±1"
    );
}

#[test]
fn low_lod_sdf_samples_lattice_voxel_not_forward_box() {
    let mut world = world_with_test_chunks(IVec3::ONE);
    let sample_pos = IVec3::new(8, 8, 8);

    world.set_voxel(sample_pos + IVec3::ONE, VoxelType::Rock);
    assert_eq!(sample_lod_sdf_at_world_pos(&world, sample_pos), 1.0);

    world.set_voxel(sample_pos, VoxelType::Rock);
    assert_eq!(sample_lod_sdf_at_world_pos(&world, sample_pos), -1.0);
}

#[test]
fn lod1_flat_surface_stays_within_half_voxel_of_lod0() {
    let chunk_pos = IVec3::ZERO;
    let mut world = world_with_test_chunks(IVec3::ONE);
    for x in 0..CHUNK_SIZE_I32 {
        for y in 0..8 {
            for z in 0..CHUNK_SIZE_I32 {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
            }
        }
    }

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let lod0_mesh = generate_chunk_mesh_surface_nets(
        chunk,
        &world,
        LodLevel::Lod0,
        NeighborLods::default(),
        &SkirtConfig::default(),
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    );
    let lod1_mesh = generate_chunk_mesh_surface_nets_lod1(
        chunk,
        &world,
        LodLevel::Lod1,
        NeighborLods::default(),
        &SkirtConfig::default(),
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    );

    let max_lod0_y = lod0_mesh
        .solid
        .positions
        .iter()
        .map(|pos| pos[1])
        .fold(f32::NEG_INFINITY, f32::max);
    let max_lod1_y = lod1_mesh
        .solid
        .positions
        .iter()
        .map(|pos| pos[1])
        .fold(f32::NEG_INFINITY, f32::max);

    assert!(
        max_lod1_y <= max_lod0_y + VOXEL_SIZE * 0.05,
        "LOD1 flat surface should not overshoot LOD0: LOD1 y={max_lod1_y}, LOD0 y={max_lod0_y}"
    );
    assert!(
        max_lod0_y - max_lod1_y <= VOXEL_SIZE * 0.55,
        "LOD1 flat surface should stay within half a voxel of LOD0: LOD1 y={max_lod1_y}, LOD0 y={max_lod0_y}"
    );
}

#[test]
fn steep_lod0_lod1_x_seam_transition_stays_near_reference_surface() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 1));
    fill_steep_x_slope(&mut world);

    let lod0_chunk_pos = IVec3::new(1, 1, 0);
    let lod1_chunk_pos = IVec3::new(2, 1, 0);
    let lod0_chunk = world.get_chunk(lod0_chunk_pos).unwrap();
    let lod1_chunk = world.get_chunk(lod1_chunk_pos).unwrap();
    let lod0_origin = VoxelWorld::chunk_to_world(lod0_chunk_pos);
    let lod1_origin = VoxelWorld::chunk_to_world(lod1_chunk_pos);
    let skirt_config = SkirtConfig::default();
    let samples = [
        Vec3::new(31.5, 0.0, 8.5),
        Vec3::new(32.25, 0.0, 8.5),
        Vec3::new(32.75, 0.0, 8.5),
        Vec3::new(33.5, 0.0, 8.5),
    ];

    let reference_left = generate_chunk_mesh_surface_nets(
        lod0_chunk,
        &world,
        LodLevel::Lod0,
        NeighborLods {
            pos_x: Some(LodLevel::Lod0),
            ..Default::default()
        },
        &skirt_config,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    );
    let reference_right = generate_chunk_mesh_surface_nets(
        lod1_chunk,
        &world,
        LodLevel::Lod0,
        NeighborLods {
            neg_x: Some(LodLevel::Lod0),
            ..Default::default()
        },
        &skirt_config,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    );
    let reference_meshes = [
        (&reference_left.solid, lod0_origin),
        (&reference_right.solid, lod1_origin),
    ];
    let reference_max_abs_error = samples
        .iter()
        .map(|sample| {
            let hit_y = highest_vertical_hit_y_for_meshes(&reference_meshes, sample.x, sample.z)
                .expect("all-Lod0 reference seam should have a vertical hit");
            let expected_y = expected_surface_face_y_at(
                &world,
                sample.x.floor() as i32,
                sample.z.floor() as i32,
            )
            .expect("synthetic slope should have a voxel surface");
            (hit_y - expected_y).abs()
        })
        .fold(0.0_f32, f32::max);

    let transition_left = generate_chunk_mesh_surface_nets(
        lod0_chunk,
        &world,
        LodLevel::Lod0,
        NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        },
        &skirt_config,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    );
    let transition_right = generate_chunk_mesh_surface_nets_lod1(
        lod1_chunk,
        &world,
        LodLevel::Lod1,
        NeighborLods {
            neg_x: Some(LodLevel::Lod0),
            ..Default::default()
        },
        &skirt_config,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    );
    let transition_meshes = [
        (&transition_left.solid, lod0_origin),
        (&transition_right.solid, lod1_origin),
    ];
    let tolerance = reference_max_abs_error + VOXEL_SIZE * 0.75;

    for sample in samples {
        let hit_y = highest_vertical_hit_y_for_meshes(&transition_meshes, sample.x, sample.z)
            .unwrap_or_else(|| {
                panic!(
                    "Lod0/Lod1 transition seam should have a vertical hit at x={}, z={}",
                    sample.x, sample.z
                )
            });
        let expected_y =
            expected_surface_face_y_at(&world, sample.x.floor() as i32, sample.z.floor() as i32)
                .expect("synthetic slope should have a voxel surface");
        let signed_error = hit_y - expected_y;
        assert!(
            signed_error.abs() <= tolerance,
            "Lod0/Lod1 transition seam signed error {signed_error:.2} exceeded reference-derived tolerance {tolerance:.2} at x={}, z={} (hit_y={hit_y:.2}, expected_y={expected_y:.2}, reference_max_abs_error={reference_max_abs_error:.2})",
            sample.x,
            sample.z,
        );
    }
}

#[test]
fn low_lod_transition_boundary_sdf_matches_coarser_neighbor_sample() {
    let chunk_pos = IVec3::new(1, 0, 0);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(4, 1, 1));
    for x in 32..40 {
        for y in 8..16 {
            for z in 0..8 {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Air);
            }
        }
    }
    world.set_voxel(chunk_origin + IVec3::new(16, 8, 0), VoxelType::Rock);

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let neighbor = world.get_chunk(chunk_pos + IVec3::X).unwrap();
    let no_transition_lods = NeighborLods::default();
    let transition_lods = NeighborLods {
        pos_x: Some(LodLevel::Lod3),
        ..Default::default()
    };

    let boundary_idx = LodShape1::linearize([LOD1_PADDED_SIZE - 1, 5, 3]) as usize;
    let neighbor_boundary_idx = LodShape3::linearize([1, 2, 1]) as usize;

    let raw_sdf = generate_low_lod_sdf_with_smoothing::<LOD1_GRID_VOLUME>(
        chunk,
        &world,
        LOD1_PADDED_SIZE,
        LOD1_STEP_SIZE as i32,
        LodShape1::linearize,
        LodLevel::Lod1,
        &no_transition_lods,
        true,
    );
    let transition_sdf = generate_low_lod_sdf_with_smoothing::<LOD1_GRID_VOLUME>(
        chunk,
        &world,
        LOD1_PADDED_SIZE,
        LOD1_STEP_SIZE as i32,
        LodShape1::linearize,
        LodLevel::Lod1,
        &transition_lods,
        true,
    );
    let neighbor_lod3_sdf = generate_low_lod_sdf_with_smoothing::<LOD3_GRID_VOLUME>(
        neighbor,
        &world,
        LOD3_PADDED_SIZE,
        LOD3_STEP_SIZE as i32,
        LodShape3::linearize,
        LodLevel::Lod3,
        &NeighborLods {
            neg_x: Some(LodLevel::Lod1),
            ..Default::default()
        },
        true,
    );

    assert_eq!(raw_sdf[boundary_idx], 1.0);
    assert_eq!(
        transition_sdf[boundary_idx],
        neighbor_lod3_sdf[neighbor_boundary_idx]
    );
    assert!(
        transition_sdf[boundary_idx] < 0.0 && transition_sdf[boundary_idx] > -1.0,
        "transition boundary should keep the solid sign without snapping to hard -1: {}",
        transition_sdf[boundary_idx]
    );
}

#[test]
fn coarse_smoothed_solid_center_stays_hard_negative() {
    // Interior coarse smoothing keeps a solid centre hard-negative so thin
    // features do not blur away to air.
    let mut world = world_with_test_chunks(IVec3::splat(3));
    let center = IVec3::new(24, 24, 24);
    world.set_voxel(center, VoxelType::Rock);

    for step in [2, 4, 8] {
        let sdf = coarse_smoothed_sdf_at_world_pos(&world, center, step);
        assert_eq!(sdf, -1.0, "solid centre must stay hard -1 at step {step}");
    }
}

#[test]
fn coarse_smoothed_air_center_blurs_step_distant_solid() {
    // The point of the step-scaled kernel: an air cell whose nearest solid is
    // a full coarse step away must read a FRACTIONAL value (so the Surface-Nets
    // crossing slides off the coarse lattice and the terrace flattens). The
    // legacy ±1-voxel blur is sub-sample at this spacing and returns a flat
    // 1.0, which is exactly what produces the terraces.
    let mut world = world_with_test_chunks(IVec3::splat(3));
    let center = IVec3::new(24, 24, 24);
    let step = 4;
    // Solid slab one coarse step below the air centre.
    for x in 16..=32 {
        for z in 16..=32 {
            world.set_voxel(IVec3::new(x, center.y - step, z), VoxelType::Rock);
        }
    }

    let coarse = coarse_smoothed_sdf_at_world_pos(&world, center, step);
    let legacy = smoothed_terrain_sdf_at_world_pos(&world, center);

    assert!(
        coarse > 0.0 && coarse < 1.0,
        "step-scaled blur should be fractional, got {coarse}"
    );
    assert_eq!(
        legacy, 1.0,
        "±1-voxel blur misses the step-distant solid (the terrace cause)"
    );
}

#[test]
fn coarse_smoothed_deep_air_stays_positive_one() {
    // Far from any solid the blur must return a clean +1 (no spurious pull).
    let world = world_with_test_chunks(IVec3::splat(3));
    let center = IVec3::new(24, 24, 24);
    for step in [2, 4, 8] {
        assert_eq!(
            coarse_smoothed_sdf_at_world_pos(&world, center, step),
            1.0,
            "deep air must stay +1 at step {step}"
        );
    }
}

fn set_coarse_xz_slab(world: &mut VoxelWorld, center: IVec3, step: i32) {
    for dx in -1..=1 {
        for dz in -1..=1 {
            world.set_voxel(
                center + IVec3::new(dx * step, 0, dz * step),
                VoxelType::Rock,
            );
        }
    }
}

#[test]
fn lod0_transition_boundary_sdf_matches_smoothed_lod1_neighbor_fractional() {
    let chunk_pos = IVec3::new(1, 0, 2);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(4, 1, 5));
    let transition_step = LOD1_STEP_SIZE as i32;
    let sample_pos = chunk_origin + IVec3::new(16, 4, 4);
    set_coarse_xz_slab(
        &mut world,
        sample_pos - IVec3::new(0, transition_step, 0),
        transition_step,
    );

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let neighbor = world.get_chunk(chunk_pos + IVec3::X).unwrap();
    let transition_lods = NeighborLods {
        pos_x: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let boundary_idx = PaddedChunkShape::linearize([LOD0_PADDED_SIZE - 1, 5, 5]) as usize;
    let neighbor_boundary_idx = LodShape1::linearize([1, 3, 3]) as usize;

    let transition_sdf = generate_sdf_with_transition_mode(
        chunk,
        &world,
        LodLevel::Lod0,
        &transition_lods,
        true,
        BaseSdfTransitionMode::Coarsen,
    );
    let neighbor_lod1_sdf = generate_low_lod_sdf_with_smoothing::<LOD1_GRID_VOLUME>(
        neighbor,
        &world,
        LOD1_PADDED_SIZE,
        LOD1_STEP_SIZE as i32,
        LodShape1::linearize,
        LodLevel::Lod1,
        &NeighborLods {
            neg_x: Some(LodLevel::Lod0),
            ..Default::default()
        },
        true,
    );
    let expected = coarse_transition_smoothed_sdf_at_world_pos(&world, sample_pos, transition_step);

    assert!(
        expected > 0.0 && expected < 1.0,
        "test fixture should produce a fractional transition value, got {expected}"
    );
    assert_eq!(transition_sdf[boundary_idx], expected);
    assert_eq!(neighbor_lod1_sdf[neighbor_boundary_idx], expected);
}

#[test]
fn lod1_transition_boundary_sdf_matches_smoothed_lod3_neighbor_fractional() {
    let chunk_pos = IVec3::new(1, 0, 0);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut world = world_with_test_chunks(IVec3::new(4, 1, 2));
    let transition_step = LOD3_STEP_SIZE as i32;
    let sample_pos = chunk_origin + IVec3::new(16, 8, 8);
    set_coarse_xz_slab(
        &mut world,
        sample_pos - IVec3::new(0, transition_step, 0),
        transition_step,
    );

    let chunk = world.get_chunk(chunk_pos).unwrap();
    let neighbor = world.get_chunk(chunk_pos + IVec3::X).unwrap();
    let transition_lods = NeighborLods {
        pos_x: Some(LodLevel::Lod3),
        ..Default::default()
    };

    let boundary_idx = LodShape1::linearize([LOD1_PADDED_SIZE - 1, 5, 5]) as usize;
    let neighbor_boundary_idx = LodShape3::linearize([1, 2, 2]) as usize;

    let transition_sdf = generate_low_lod_sdf_with_smoothing::<LOD1_GRID_VOLUME>(
        chunk,
        &world,
        LOD1_PADDED_SIZE,
        LOD1_STEP_SIZE as i32,
        LodShape1::linearize,
        LodLevel::Lod1,
        &transition_lods,
        true,
    );
    let neighbor_lod3_sdf = generate_low_lod_sdf_with_smoothing::<LOD3_GRID_VOLUME>(
        neighbor,
        &world,
        LOD3_PADDED_SIZE,
        LOD3_STEP_SIZE as i32,
        LodShape3::linearize,
        LodLevel::Lod3,
        &NeighborLods {
            neg_x: Some(LodLevel::Lod1),
            ..Default::default()
        },
        true,
    );
    let expected = coarse_transition_smoothed_sdf_at_world_pos(&world, sample_pos, transition_step);

    assert!(
        expected > 0.0 && expected < 1.0,
        "test fixture should produce a fractional transition value, got {expected}"
    );
    assert_eq!(transition_sdf[boundary_idx], expected);
    assert_eq!(neighbor_lod3_sdf[neighbor_boundary_idx], expected);
}

#[test]
fn coarse_lod_iso_height_for_column_uses_smoothed_coarse_sdf() {
    let mut world = world_with_test_chunks(IVec3::new(3, 2, 3));
    let step = LOD2_STEP_SIZE as i32;
    let x = 16;
    let z = 16;
    for y in [0, step, step * 2] {
        world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
    }

    let legacy =
        coarse_lod_iso_height_for_column_with_smoothing(&world, x, z, LodLevel::Lod2, false)
            .expect("legacy column should have one crossing");
    let smoothed =
        coarse_lod_iso_height_for_column_with_smoothing(&world, x, z, LodLevel::Lod2, true)
            .expect("smoothed column should have one crossing");

    assert!(
        smoothed < legacy,
        "smoothed iso height should move off the raw coarse midpoint: legacy={legacy}, smoothed={smoothed}"
    );
    assert!((legacy - 10.0).abs() <= 1.0e-4);
    assert!((smoothed - 9.846154).abs() <= 1.0e-4);
}

#[test]
fn smoothed_coarse_iso_height_interpolates_within_coarse_xz_cell() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
    fill_steep_z_slope(&mut world);

    let x = 32;
    let z_near = 21;
    let z_far = 23;
    let legacy_near =
        coarse_lod_iso_height_for_column_with_smoothing(&world, x, z_near, LodLevel::Lod2, false)
            .expect("legacy near column should have one crossing");
    let legacy_far =
        coarse_lod_iso_height_for_column_with_smoothing(&world, x, z_far, LodLevel::Lod2, false)
            .expect("legacy far column should have one crossing");
    let smoothed_near =
        coarse_lod_iso_height_for_column_with_smoothing(&world, x, z_near, LodLevel::Lod2, true)
            .expect("smoothed near column should have one crossing");
    let smoothed_far =
        coarse_lod_iso_height_for_column_with_smoothing(&world, x, z_far, LodLevel::Lod2, true)
            .expect("smoothed far column should have one crossing");

    assert!(
        (legacy_near - legacy_far).abs() <= 1.0e-4,
        "legacy snap floors both columns to the same coarse z: near={legacy_near}, far={legacy_far}"
    );
    assert!(
        smoothed_far > smoothed_near + 0.25,
        "smoothed snap should interpolate across the coarse cell instead of terracing: near={smoothed_near}, far={smoothed_far}"
    );
}

fn set_column(world: &mut VoxelWorld, x: i32, z: i32, y_min: i32, y_max: i32, voxel: VoxelType) {
    for y in y_min..=y_max {
        world.set_voxel(IVec3::new(x, y, z), voxel);
    }
}

fn fill_chunk(world: &mut VoxelWorld, chunk_pos: IVec3, voxel: VoxelType) {
    world.insert_chunk(Chunk::with_voxels(chunk_pos, [voxel; CHUNK_VOLUME]));
}

fn mesh_has_vertical_hit(mesh: &MeshData, chunk_origin: IVec3, world_x: f32, world_z: f32) -> bool {
    let origin_y = chunk_origin.y as f32 + 32.0;
    for tri in mesh.indices.chunks_exact(3) {
        let p0 = Vec3::from_array(mesh.positions[tri[0] as usize]) + chunk_origin.as_vec3();
        let p1 = Vec3::from_array(mesh.positions[tri[1] as usize]) + chunk_origin.as_vec3();
        let p2 = Vec3::from_array(mesh.positions[tri[2] as usize]) + chunk_origin.as_vec3();
        if vertical_ray_triangle_hit_y(world_x, world_z, origin_y, p0, p1, p2).is_some() {
            return true;
        }
    }
    false
}

fn highest_vertical_hit_y_for_meshes(
    meshes: &[(&MeshData, IVec3)],
    world_x: f32,
    world_z: f32,
) -> Option<f32> {
    let origin_y = meshes
        .iter()
        .map(|(_, chunk_origin)| chunk_origin.y as f32 + 48.0)
        .fold(f32::NEG_INFINITY, f32::max);
    let mut best_hit = None;
    for (mesh, chunk_origin) in meshes {
        for tri in mesh.indices.chunks_exact(3) {
            let p0 = Vec3::from_array(mesh.positions[tri[0] as usize]) + chunk_origin.as_vec3();
            let p1 = Vec3::from_array(mesh.positions[tri[1] as usize]) + chunk_origin.as_vec3();
            let p2 = Vec3::from_array(mesh.positions[tri[2] as usize]) + chunk_origin.as_vec3();
            if let Some(hit_y) = vertical_ray_triangle_hit_y(world_x, world_z, origin_y, p0, p1, p2)
            {
                if best_hit.map_or(true, |best| hit_y > best) {
                    best_hit = Some(hit_y);
                }
            }
        }
    }
    best_hit
}

fn expected_surface_face_y_at(world: &VoxelWorld, x: i32, z: i32) -> Option<f32> {
    let bounds = world.bounds();
    for y in (bounds.min_world_y..=bounds.max_world_y).rev() {
        if matches!(
            world.sample_voxel_for_collision(IVec3::new(x, y, z)),
            VoxelSample::InBounds(voxel) if voxel.is_solid()
        ) {
            return Some(y as f32 + VOXEL_SIZE);
        }
    }
    None
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

fn fill_steep_z_slope(world: &mut VoxelWorld) {
    let bounds = world.bounds();
    for z in bounds.horizontal_min.y..=bounds.horizontal_max.y {
        let surface_y = (20 + z / 2).min(bounds.max_world_y);
        for x in bounds.horizontal_min.x..=bounds.horizontal_max.x {
            for y in bounds.min_world_y..surface_y {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
            }
        }
    }
}

fn assert_snapped_local_vertices_match_coarse_surface(
    stats: LodTransitionSnapStats,
    local_positions: &[Vec3],
    world: &VoxelWorld,
    chunk_pos: IVec3,
    face: ChunkFace,
) {
    assert!(
        stats.face_snapped(face),
        "{face:?} should be snap-welded, stats={:?}",
        stats
    );
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_size = CHUNK_SIZE as f32;
    let mut checked = 0;
    for local in local_positions.iter().copied() {
        let on_face = match face {
            ChunkFace::NegX => local.x.abs() <= 0.02,
            ChunkFace::PosX => (local.x - chunk_size).abs() <= 0.02,
            ChunkFace::NegZ => local.z.abs() <= 0.02,
            ChunkFace::PosZ => (local.z - chunk_size).abs() <= 0.02,
            ChunkFace::NegY | ChunkFace::PosY => false,
        };
        if !on_face {
            continue;
        }

        let column = snap_column_for_face(chunk_origin, local, face)
            .expect("X/Z face should have a snap column");
        let expected_y =
            coarse_lod_iso_height_for_column(world, column.x, column.y, LodLevel::Lod1)
                .expect("synthetic slope should have a single coarse crossing");
        let world_y = chunk_origin.y as f32 + local.y;
        let error = world_y - expected_y;
        assert!(
            error.abs() <= 0.02,
            "snapped {face:?} boundary vertex should sit on coarse iso-surface: local={local:?}, world_y={world_y:.2}, expected_y={expected_y:.2}, error={error:.2}"
        );
        assert!(
            error <= 0.05,
            "snapped {face:?} boundary vertex should not form a proud flap: local={local:?}, error={error:.2}"
        );
        checked += 1;
    }
    assert!(checked > 0, "{face:?} should expose boundary vertices");
}

fn mesh_data_for_local_positions(local_positions: &[Vec3], chunk_center: Vec3) -> MeshData {
    let mut mesh = MeshData::new();
    for local in local_positions {
        mesh.positions
            .push(scale_vertex_from_center(*local, chunk_center));
        mesh.colors.push([0.0; 4]);
    }
    mesh
}

fn morph_enabled_config() -> TerrainMorphConfig {
    TerrainMorphConfig {
        enabled: true,
        ..Default::default()
    }
}

#[test]
fn into_mesh_uploads_morph_attribute_only_when_parallel() {
    let base = || {
        let mut mesh = MeshData::new();
        for _ in 0..3 {
            mesh.positions.push([0.0, 0.0, 0.0]);
            mesh.normals.push([0.0, 1.0, 0.0]);
            mesh.uvs.push([0.0, 0.0]);
            mesh.colors.push([0.0; 4]);
        }
        mesh.indices.extend_from_slice(&[0, 1, 2]);
        mesh
    };

    // No morph targets → attribute omitted.
    assert!(
        base()
            .into_mesh()
            .attribute(ATTRIBUTE_MORPH_TARGET)
            .is_none(),
        "empty morph_targets must not upload the attribute"
    );

    // Mismatched length → attribute omitted (guards the Bevy length panic).
    let mut short = base();
    short.morph_targets = vec![[0.0; 4]; 2];
    assert!(
        short
            .into_mesh()
            .attribute(ATTRIBUTE_MORPH_TARGET)
            .is_none(),
        "mismatched morph_targets must not upload the attribute"
    );

    // Parallel length → attribute uploaded.
    let mut full = base();
    full.morph_targets = vec![[1.0, 2.0, 3.0, 1.0]; 3];
    assert!(
        full.into_mesh().attribute(ATTRIBUTE_MORPH_TARGET).is_some(),
        "parallel morph_targets must upload the attribute"
    );
}

#[test]
fn pad_morph_targets_identity_restores_invariant() {
    let mut mesh = MeshData::new();
    // Two "main" vertices already morphed.
    mesh.positions.push([1.0, 1.0, 1.0]);
    mesh.positions.push([2.0, 2.0, 2.0]);
    mesh.morph_targets.push([9.0, 9.0, 9.0, 1.0]);
    mesh.morph_targets.push([8.0, 8.0, 8.0, 0.0]);
    // Two "skirt" vertices appended after baking.
    mesh.positions.push([3.0, 3.0, 3.0]);
    mesh.positions.push([4.0, 4.0, 4.0]);

    pad_morph_targets_identity(&mut mesh);

    assert_eq!(mesh.morph_targets.len(), mesh.positions.len());
    assert_eq!(mesh.morph_targets[2], [3.0, 3.0, 3.0, 0.0]);
    assert_eq!(mesh.morph_targets[3], [4.0, 4.0, 4.0, 0.0]);
    // Pre-existing rows are untouched.
    assert_eq!(mesh.morph_targets[0], [9.0, 9.0, 9.0, 1.0]);
}

#[test]
fn pad_morph_targets_identity_is_noop_without_targets() {
    let mut mesh = MeshData::new();
    mesh.positions.push([1.0, 1.0, 1.0]);
    pad_morph_targets_identity(&mut mesh);
    assert!(mesh.morph_targets.is_empty());
}

#[test]
fn apply_snap_or_morph_enabled_skips_snap_and_bakes_targets() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
    fill_steep_x_slope(&mut world);
    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![
        Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0),
        Vec3::new(8.0, 8.0, 8.0),
    ];
    let mut mesh = mesh_data_for_local_positions(&local_positions, center);
    let positions_before = mesh.positions.clone();
    let neighbors = NeighborLods {
        pos_x: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let (stats, _) = apply_snap_or_morph(
        &mut mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        center,
        LodLevel::Lod0,
        &neighbors,
        &morph_enabled_config(),
        None,
    );

    // Snap was skipped: stats default, POSITION untouched (fine mesh kept).
    assert_eq!(stats.snapped_vertex_count, 0);
    assert!(stats.face_snapped(ChunkFace::PosX));
    assert_eq!(mesh.positions, positions_before);
    // Targets baked: boundary vertex morphs, interior does not.
    assert_eq!(mesh.morph_targets.len(), mesh.positions.len());
    assert_eq!(mesh.morph_targets[0][3], 1.0);
    assert_eq!(mesh.morph_targets[1][3], 0.0);
}

#[test]
fn fractional_morph_target_lands_on_lod1_neighbor_mesh() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 1));
    fill_steep_x_slope(&mut world);

    let lod0_chunk_pos = IVec3::new(1, 1, 0);
    let lod1_chunk_pos = IVec3::new(2, 1, 0);
    let lod0_origin = VoxelWorld::chunk_to_world(lod0_chunk_pos);
    let lod1_origin = VoxelWorld::chunk_to_world(lod1_chunk_pos);
    let center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![Vec3::new(CHUNK_SIZE as f32 - 0.6, 8.0, 7.4)];
    let mut mesh = mesh_data_for_local_positions(&local_positions, center);
    let neighbors = NeighborLods {
        pos_x: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let (stats, _) = apply_snap_or_morph(
        &mut mesh,
        &mut local_positions,
        world.get_chunk(lod0_chunk_pos).unwrap(),
        &world,
        lod0_origin,
        center,
        LodLevel::Lod0,
        &neighbors,
        &morph_enabled_config(),
        None,
    );

    assert_eq!(stats.boundary_candidate_vertex_count, 1);
    assert_eq!(stats.morph_target_vertex_count, 1);
    assert_eq!(stats.morph_missing_target_vertex_count, 0);
    assert_eq!(mesh.morph_targets[0][3], 1.0);

    let lod1_mesh = generate_chunk_mesh_surface_nets_lod1(
        world.get_chunk(lod1_chunk_pos).unwrap(),
        &world,
        LodLevel::Lod1,
        NeighborLods {
            neg_x: Some(LodLevel::Lod0),
            ..Default::default()
        },
        &SkirtConfig::default(),
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        None,
        &default_strip_status(),
        false,
    );

    let target = mesh.morph_targets[0];
    let target_world_x = lod0_origin.x as f32 + target[0];
    let target_world_y = lod0_origin.y as f32 + target[1];
    let target_world_z = lod0_origin.z as f32 + target[2];
    let neighbor_y = highest_vertical_hit_y_for_meshes(
        &[(&lod1_mesh.solid, lod1_origin)],
        target_world_x,
        target_world_z,
    )
    .expect("morph target should sit over the generated Lod1 neighbor mesh");

    assert!(
        (target_world_y - neighbor_y).abs() <= VOXEL_SIZE * 0.75,
        "morph target must land on the generated Lod1 mesh: target=({target_world_x:.2},{target_world_y:.2},{target_world_z:.2}) neighbor_y={neighbor_y:.2}"
    );
}

#[test]
fn resolve_morph_face_coverage_seals_if_any_vert_welds_and_keeps_welds() {
    let neighbors = NeighborLods {
        neg_x: Some(LodLevel::Lod1),
        ..Default::default()
    };
    let locals = vec![Vec3::new(0.0, 5.0, 5.0), Vec3::new(0.0, 6.0, 6.0)];

    // Any welded vert -> face complete (sealed). Welds are KEPT: un-morphing a
    // welded boundary vert is what released the LOD-seam spike it was pinning.
    let one_welded = vec![[0.0, 5.0, 5.0, 1.0], [0.0, 6.0, 6.0, 0.0]];
    let (complete, fallback, counts) =
        resolve_morph_face_coverage(&locals, &one_welded, LodLevel::Lod0, &neighbors);
    assert_eq!(complete, LodTransitionSnapStats::face_mask(ChunkFace::NegX));
    assert_eq!(fallback, 0);
    assert_eq!(counts.candidate[0], 2);
    assert_eq!(counts.welded[0], 1);
    assert!(
        one_welded[0][3] > 0.5,
        "welded vert must stay welded (no spike)"
    );

    // No welded vert on the face -> fallback (keeps skirt); nothing moved, no tear.
    let none_welded = vec![[0.0, 5.0, 5.0, 0.0], [0.0, 6.0, 6.0, 0.0]];
    let (complete, fallback, counts) =
        resolve_morph_face_coverage(&locals, &none_welded, LodLevel::Lod0, &neighbors);
    assert_eq!(complete, 0);
    assert_eq!(fallback, LodTransitionSnapStats::face_mask(ChunkFace::NegX));
    assert_eq!(counts.candidate[0], 2);
    assert_eq!(counts.welded[0], 0);
}

#[test]
fn partial_morph_without_stitch_or_skirt_is_invalid_unsafe_topology() {
    use super::seam_audit::{
        SeamFaceMode, SeamFaceModeInput, SeamStripStatus, classify_final_mode,
    };

    let mode = classify_final_mode(SeamFaceModeInput {
        fine_components: 1,
        coarse_components: 1,
        face: ChunkFace::PosX,
        fine_lod: LodLevel::Lod0,
        neighbor_lod: Some(LodLevel::Lod1),
        lod_delta_gt_one: false,
        strip_status: SeamStripStatus::MissingStrip,
        morph_candidate_count: 18,
        morph_welded_count: 11,
        stitch_triangle_count: 0,
        skirt_triangle_count: 0,
        sealed_by_mask: true,
        stitched: false,
        vertical_skirt_on_face: false,
    });
    assert_eq!(mode, SeamFaceMode::InvalidUnsafeTopology);
}

#[test]
fn strip_oracle_rejects_mismatched_segment_count() {
    use crate::voxel::lod_boundary_strip::{
        LodBoundaryStrip, StripVertex, compare_projected_strips,
    };

    let make_strip = |segments: Vec<[u32; 2]>| LodBoundaryStrip {
        face: ChunkFace::PosX,
        lod: LodLevel::Lod1,
        chunk_pos: IVec3::new(1, 0, 0),
        revision: 42,
        vertices: vec![
            StripVertex {
                local: Vec3::new(16.0, 4.0, 2.0),
                world: Vec3::new(32.0, 4.0, 2.0),
                normal: Vec3::Y,
                proj: Vec2::new(2.0, 4.0),
            },
            StripVertex {
                local: Vec3::new(16.0, 4.0, 6.0),
                world: Vec3::new(32.0, 4.0, 6.0),
                normal: Vec3::Y,
                proj: Vec2::new(6.0, 4.0),
            },
        ],
        segments,
    };

    let coarse = make_strip(vec![[0, 1]]);
    let fine = make_strip(vec![[0, 1], [0, 1]]);
    let mismatch = compare_projected_strips(&fine, &coarse, 0.05);
    assert!(!mismatch.equivalent);
    assert_ne!(mismatch.fine_segment_count, mismatch.coarse_segment_count);

    let matching_fine = make_strip(vec![[0, 1]]);
    let matching_coarse = make_strip(vec![[0, 1]]);
    let hit = compare_projected_strips(&matching_fine, &matching_coarse, 0.05);
    assert!(hit.equivalent);
    assert_eq!(hit.max_projected_segment_distance, 0.0);
}

#[test]
fn apply_snap_or_morph_enabled_does_not_seal_when_bake_fails() {
    let world = world_with_test_chunks(IVec3::new(2, 2, 1));
    let chunk_pos = IVec3::ZERO;
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0)];
    let mut mesh = mesh_data_for_local_positions(&local_positions, center);
    mesh.positions.push([0.0, 0.0, 0.0]);
    let neighbors = NeighborLods {
        pos_x: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let (stats, _) = apply_snap_or_morph(
        &mut mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        center,
        LodLevel::Lod0,
        &neighbors,
        &morph_enabled_config(),
        None,
    );

    assert_eq!(
        stats.snapped_face_mask, 0,
        "morph mode must leave skirts available when weld target baking fails"
    );
    assert!(mesh.morph_targets.is_empty());
}

#[test]
fn apply_snap_or_morph_disabled_snaps_and_leaves_targets_empty() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
    fill_steep_x_slope(&mut world);
    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0)];
    let mut mesh = mesh_data_for_local_positions(&local_positions, center);
    let neighbors = NeighborLods {
        pos_x: Some(LodLevel::Lod1),
        ..Default::default()
    };

    let (stats, _) = apply_snap_or_morph(
        &mut mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        center,
        LodLevel::Lod0,
        &neighbors,
        &TerrainMorphConfig::default(), // disabled
        None,
    );

    assert!(
        stats.snapped_vertex_count > 0,
        "snap should run when morph off"
    );
    assert!(
        mesh.morph_targets.is_empty(),
        "disabled morph must leave morph_targets empty so into_mesh stays legacy"
    );
}

#[test]
fn coarse_iso_height_helper_interpolates_single_crossing_column() {
    let height = single_solid_to_air_iso_height([(0, -1.0), (2, -1.0), (4, 1.0), (6, 1.0)])
        .expect("single solid-to-air crossing should interpolate");

    assert!((height - 3.0).abs() <= f32::EPSILON);
}

#[test]
fn coarse_iso_height_helper_rejects_no_and_multi_crossing_columns() {
    assert_eq!(
        single_solid_to_air_iso_height([(0, -1.0), (2, -1.0), (4, -1.0)]),
        None
    );
    assert_eq!(
        single_solid_to_air_iso_height([(0, 1.0), (2, -1.0), (4, 1.0)]),
        None
    );
    assert_eq!(
        single_solid_to_air_iso_height([(0, -1.0), (2, 1.0), (4, -1.0), (6, 1.0)]),
        None
    );
}

#[test]
fn lod0_lod1_x_boundary_snap_welds_to_coarse_iso_surface() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 3));
    fill_steep_x_slope(&mut world);

    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![
        Vec3::new(CHUNK_SIZE as f32, 2.0, 2.0),
        Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0),
        Vec3::new(CHUNK_SIZE as f32, 9.0, 14.0),
    ];
    let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);
    let original_colors = vec![
        [0.6, 0.2, 0.1, 0.1],
        [0.1, 0.6, 0.2, 0.1],
        [0.1, 0.2, 0.6, 0.1],
    ];
    solid_mesh.colors.clone_from(&original_colors);

    let stats = snap_boundary_vertices_to_lower_detail_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        chunk_center,
        LodLevel::Lod0,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        },
    );

    assert_eq!(stats.fallback_face_mask, 0);
    assert_eq!(stats.snapped_vertex_count, local_positions.len() as u32);
    assert_eq!(
        solid_mesh.colors, original_colors,
        "seam welding should preserve pre-snap material weights"
    );
    assert_snapped_local_vertices_match_coarse_surface(
        stats,
        &local_positions,
        &world,
        chunk_pos,
        ChunkFace::PosX,
    );
}

#[test]
fn lod0_lod1_z_boundary_snap_welds_to_coarse_iso_surface() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
    fill_steep_x_slope(&mut world);

    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![
        Vec3::new(2.0, 5.0, CHUNK_SIZE as f32),
        Vec3::new(8.0, 9.0, CHUNK_SIZE as f32),
        Vec3::new(14.0, 12.0, CHUNK_SIZE as f32),
    ];
    let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

    let stats = snap_boundary_vertices_to_lower_detail_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        chunk_center,
        LodLevel::Lod0,
        &NeighborLods {
            pos_z: Some(LodLevel::Lod1),
            ..Default::default()
        },
    );

    assert_eq!(stats.fallback_face_mask, 0);
    assert_eq!(stats.snapped_vertex_count, local_positions.len() as u32);
    assert_snapped_local_vertices_match_coarse_surface(
        stats,
        &local_positions,
        &world,
        chunk_pos,
        ChunkFace::PosZ,
    );
}

#[test]
fn lod_boundary_snap_interpolates_smoothed_coarse_targets_within_cell() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
    fill_steep_z_slope(&mut world);

    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![
        Vec3::new(CHUNK_SIZE as f32, 8.0, 5.0),
        Vec3::new(CHUNK_SIZE as f32, 8.0, 6.0),
    ];
    let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

    let stats = snap_boundary_vertices_to_lower_detail_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        chunk_center,
        LodLevel::Lod0,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        },
    );

    assert_eq!(stats.fallback_face_mask, 0);
    assert_eq!(stats.snapped_vertex_count, local_positions.len() as u32);
    assert!(
        local_positions[1].y > local_positions[0].y + 0.25,
        "snap targets inside one coarse z span should no longer collapse to a terrace: {:?}",
        local_positions
    );
    for local in local_positions.iter().copied() {
        let column = snap_column_for_face(chunk_origin, local, ChunkFace::PosX).unwrap();
        let expected_y =
            coarse_lod_iso_height_for_column(&world, column.x, column.y, LodLevel::Lod1)
                .expect("synthetic slope should have a single coarse crossing");
        let world_y = chunk_origin.y as f32 + local.y;
        assert!((world_y - expected_y).abs() <= 0.02);
    }
}

#[test]
fn lod_delta_gt_one_boundary_snap_rejects_and_falls_back() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
    fill_steep_z_slope(&mut world);

    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let original = Vec3::new(CHUNK_SIZE as f32 - 0.4, 8.0, 5.0);
    let mut local_positions = vec![original];
    let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

    let stats = snap_boundary_vertices_to_lower_detail_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        chunk_center,
        LodLevel::Lod0,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod2),
            ..Default::default()
        },
    );

    assert_eq!(stats.snapped_vertex_count, 0);
    assert!(stats.face_fallback(ChunkFace::PosX));
    assert_eq!(local_positions[0], original);
    assert_eq!(
        solid_mesh.positions[0],
        scale_vertex_from_center(original, chunk_center)
    );
}

#[test]
fn ambiguous_snap_column_skips_only_that_vertex() {
    let mut world = world_with_test_chunks(IVec3::new(2, 2, 1));
    for y in 0..=2 {
        world.set_voxel(IVec3::new(CHUNK_SIZE_I32, y, 4), VoxelType::Rock);
    }
    for y in 0..=2 {
        world.set_voxel(IVec3::new(CHUNK_SIZE_I32, y, 8), VoxelType::Rock);
    }
    for y in 8..=10 {
        world.set_voxel(IVec3::new(CHUNK_SIZE_I32, y, 8), VoxelType::Rock);
    }

    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let valid_local = Vec3::new(CHUNK_SIZE as f32, 5.0, 4.0);
    let ambiguous_local = Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0);
    let mut local_positions = vec![valid_local, ambiguous_local];
    let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

    let stats = snap_boundary_vertices_to_lower_detail_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        world.get_chunk(IVec3::ZERO).unwrap(),
        &world,
        IVec3::ZERO,
        chunk_center,
        LodLevel::Lod0,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            ..Default::default()
        },
    );

    assert_eq!(stats.snapped_vertex_count, 1);
    assert_eq!(stats.skipped_vertex_count, 1);
    assert!(stats.fallback_face_mask & LodTransitionSnapStats::face_mask(ChunkFace::PosX) != 0);
    let expected_y = coarse_lod_iso_height_for_column(&world, CHUNK_SIZE_I32, 4, LodLevel::Lod1)
        .expect("valid column should have one coarse crossing");
    assert!((local_positions[0].y - expected_y).abs() <= 0.02);
    assert_eq!(local_positions[1], ambiguous_local);
    assert_eq!(
        solid_mesh.positions[1],
        scale_vertex_from_center(ambiguous_local, chunk_center)
    );
}

#[test]
fn conflicting_snap_corner_does_not_fallback_whole_faces() {
    let mut world = world_with_test_chunks(IVec3::new(4, 4, 4));
    fill_steep_x_slope(&mut world);

    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let conflicted_corner = Vec3::new(CHUNK_SIZE as f32, 0.0, 5.7);
    let pos_x_only = Vec3::new(CHUNK_SIZE as f32, 5.0, 8.0);
    let neg_y_only = Vec3::new(5.7, 0.0, 7.2);
    let mut local_positions = vec![conflicted_corner, pos_x_only, neg_y_only];
    let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

    let stats = snap_boundary_vertices_to_lower_detail_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        chunk_center,
        LodLevel::Lod0,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod1),
            neg_y: Some(LodLevel::Lod1),
            ..Default::default()
        },
    );

    assert_eq!(stats.conflicting_vertex_count, 1);
    assert_eq!(stats.skipped_vertex_count, 0);
    assert_eq!(stats.fallback_face_mask, 0);
    assert!(stats.face_snapped(ChunkFace::PosX));
    assert!(stats.face_snapped(ChunkFace::NegY));
    assert_eq!(stats.snapped_vertex_count, 2);
    assert_eq!(local_positions[0], conflicted_corner);
    assert_ne!(local_positions[1], pos_x_only);
    assert_eq!(local_positions[2], Vec3::new(4.0, 0.0, 6.0));
}

#[test]
fn lod0_lod1_y_boundary_snap_welds_to_coarse_xz_lattice() {
    let world = world_with_test_chunks(IVec3::new(3, 3, 3));
    let chunk_pos = IVec3::new(1, 1, 1);
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec3::splat(CHUNK_SIZE as f32 * 0.5) * VOXEL_SIZE;
    let mut local_positions = vec![Vec3::new(5.7, 0.0, 7.2)];
    let mut solid_mesh = mesh_data_for_local_positions(&local_positions, chunk_center);

    let stats = snap_boundary_vertices_to_lower_detail_neighbor(
        &mut solid_mesh,
        &mut local_positions,
        world.get_chunk(chunk_pos).unwrap(),
        &world,
        chunk_origin,
        chunk_center,
        LodLevel::Lod0,
        &NeighborLods {
            neg_y: Some(LodLevel::Lod1),
            ..Default::default()
        },
    );

    assert_eq!(stats.fallback_face_mask, 0);
    assert!(stats.face_snapped(ChunkFace::NegY));
    assert_eq!(stats.snapped_vertex_count, 1);
    assert_eq!(local_positions[0], Vec3::new(4.0, 0.0, 6.0));
}

#[test]
fn lod_delta_gt_one_face_mask_reports_logical_lod_gap() {
    let mask = lod_delta_gt_one_face_mask(
        LodLevel::Lod0,
        &NeighborLods {
            pos_x: Some(LodLevel::Lod2),
            neg_y: Some(LodLevel::Lod1),
            pos_z: Some(LodLevel::Culled),
            ..Default::default()
        },
    );
    assert!(mask & LodTransitionSnapStats::face_mask(ChunkFace::PosX) != 0);
    assert_eq!(mask & LodTransitionSnapStats::face_mask(ChunkFace::NegY), 0);
    assert_eq!(mask & LodTransitionSnapStats::face_mask(ChunkFace::PosZ), 0);
}

fn vertical_ray_triangle_hit_y(
    x: f32,
    z: f32,
    origin_y: f32,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
) -> Option<f32> {
    let x0 = p0.x;
    let z0 = p0.z;
    let x1 = p1.x;
    let z1 = p1.z;
    let x2 = p2.x;
    let z2 = p2.z;
    let denom = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
    if denom.abs() < 1e-5 {
        return None;
    }
    let a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / denom;
    let b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / denom;
    let c = 1.0 - a - b;
    if a >= -1e-4 && b >= -1e-4 && c >= -1e-4 {
        let y = a * p0.y + b * p1.y + c * p2.y;
        (y <= origin_y).then_some(y)
    } else {
        None
    }
}

#[test]
fn sealed_below_sea_water_surface_is_not_meshed() {
    let mut world = world_with_vertical_chunks();
    world.set_voxel(IVec3::new(8, WATER_LEVEL, 8), VoxelType::Water);
    seal_air_cell(&mut world, IVec3::new(8, WATER_LEVEL + 1, 8));

    let mesh = meshed_water(&world);

    assert!(mesh.water.indices.is_empty());
    assert_eq!(mesh.water_stats.air_boundaries_total, 1);
    assert_eq!(mesh.water_stats.air_boundaries_exposed, 0);
    assert_eq!(mesh.water_stats.air_boundaries_sealed, 1);
    assert_eq!(mesh.water_stats.triangles_removed_sealed, 2);
}

#[test]
fn open_water_surface_is_still_meshed() {
    let mut world = world_with_vertical_chunks();
    world.set_voxel(IVec3::new(8, WATER_LEVEL, 8), VoxelType::Water);

    let mesh = meshed_water(&world);

    assert!(!mesh.water.indices.is_empty());
    assert_eq!(mesh.water_stats.air_boundaries_total, 1);
    assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
    assert_eq!(mesh.water_stats.air_boundaries_sealed, 0);
}

#[test]
fn water_surface_below_sea_level_is_clamped_to_water_level() {
    let mut world = world_with_vertical_chunks();
    let water_pos = IVec3::new(8, WATER_LEVEL - 2, 8);
    world.set_voxel(water_pos, VoxelType::Water);

    let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));
    let chunk_origin = VoxelWorld::chunk_to_world(VoxelWorld::world_to_chunk(water_pos));

    assert!(!mesh.water.indices.is_empty());
    assert!(mesh.water.positions.iter().all(|position| {
        let world_y = chunk_origin.y as f32 + position[1];
        (world_y - crate::constants::WATER_LEVEL as f32).abs() < 0.001
    }));
}

#[test]
fn water_surface_uses_narrow_overlap_for_shoreline_fade() {
    let mut world = world_with_vertical_chunks();
    let water_pos = IVec3::new(8, WATER_LEVEL - 2, 8);
    world.set_voxel(water_pos, VoxelType::Water);

    let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));
    let chunk_origin = VoxelWorld::chunk_to_world(VoxelWorld::world_to_chunk(water_pos));
    let min_x = mesh
        .water
        .positions
        .iter()
        .map(|position| chunk_origin.x as f32 + position[0])
        .fold(f32::INFINITY, f32::min);
    let max_x = mesh
        .water
        .positions
        .iter()
        .map(|position| chunk_origin.x as f32 + position[0])
        .fold(f32::NEG_INFINITY, f32::max);
    let min_z = mesh
        .water
        .positions
        .iter()
        .map(|position| chunk_origin.z as f32 + position[2])
        .fold(f32::INFINITY, f32::min);
    let max_z = mesh
        .water
        .positions
        .iter()
        .map(|position| chunk_origin.z as f32 + position[2])
        .fold(f32::NEG_INFINITY, f32::max);

    assert!(!mesh.water.indices.is_empty());
    assert!((min_x - (water_pos.x as f32 - WATER_SHORELINE_EXTENSION)).abs() < 0.001);
    assert!((max_x - (water_pos.x as f32 + VOXEL_SIZE + WATER_SHORELINE_EXTENSION)).abs() < 0.001);
    assert!((min_z - (water_pos.z as f32 - WATER_SHORELINE_EXTENSION)).abs() < 0.001);
    assert!((max_z - (water_pos.z as f32 + VOXEL_SIZE + WATER_SHORELINE_EXTENSION)).abs() < 0.001);
}

#[test]
fn map_edge_water_surface_is_not_meshed() {
    let mut world = world_with_test_chunks(IVec3::new(4, 3, 4));
    let water_pos = IVec3::new(0, WATER_LEVEL, CHUNK_SIZE_I32 + 8);
    world.set_voxel(water_pos, VoxelType::Water);

    let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));

    assert!(mesh.water.indices.is_empty());
    assert_eq!(mesh.water_stats.edge_water_faces_suppressed, 1);
    assert_eq!(mesh.water_stats.air_boundaries_total, 0);
}

#[test]
fn interior_water_surface_outside_edge_margin_is_still_meshed() {
    let mut world = world_with_test_chunks(IVec3::new(4, 3, 4));
    let water_pos = IVec3::new(CHUNK_SIZE_I32 + 8, WATER_LEVEL, CHUNK_SIZE_I32 + 8);
    world.set_voxel(water_pos, VoxelType::Water);

    let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));

    assert!(!mesh.water.indices.is_empty());
    assert_eq!(mesh.water_stats.edge_water_faces_suppressed, 0);
    assert_eq!(mesh.water_stats.air_boundaries_total, 1);
    assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
}

#[test]
fn shore_water_inside_gameplay_edge_guard_is_still_meshed() {
    let mut world = world_with_test_chunks(IVec3::new(4, 3, 4));
    let water_pos = IVec3::new(CHUNK_SIZE_I32 / 2, WATER_LEVEL, CHUNK_SIZE_I32 + 8);
    world.set_voxel(water_pos, VoxelType::Water);

    let mesh = meshed_chunk(&world, VoxelWorld::world_to_chunk(water_pos));

    assert!(!mesh.water.indices.is_empty());
    assert_eq!(mesh.water_stats.edge_water_faces_suppressed, 0);
    assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
}

#[test]
fn valid_surface_lake_above_floor_creates_water_mesh() {
    let mut world = world_with_vertical_chunks();
    let lake_y = WATER_LEVEL + 4;
    world.set_voxel(IVec3::new(8, lake_y, 8), VoxelType::Water);

    let mesh = meshed_water(&world);

    assert!(!mesh.water.indices.is_empty());
    assert_eq!(mesh.water_stats.air_boundaries_exposed, 1);
}

#[test]
fn invalid_below_floor_water_creates_no_mesh() {
    let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
    {
        let mut chunk = world.get_chunk_mut(IVec3::ZERO).unwrap();
        chunk.set(UVec3::new(8, 0, 8), VoxelType::Water);
    }

    let mesh = meshed_chunk(&world, IVec3::ZERO);

    assert!(mesh.water.indices.is_empty());
}

#[test]
fn water_exposure_does_not_leak_below_world_floor() {
    let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
    let air_pos = IVec3::new(8, 1, 8);
    for offset in [IVec3::X, -IVec3::X, IVec3::Y, IVec3::Z, -IVec3::Z] {
        world.set_voxel(air_pos + offset, VoxelType::Rock);
    }

    let mut stats = WaterMeshingStats::default();
    let exposed = air_connected_to_exterior_with_stats(&world, air_pos, &mut stats);

    assert!(!exposed);

    let mut stats = WaterMeshingStats::default();
    let exposed = air_connected_to_exterior_with_stats(
        &world,
        IVec3::new(air_pos.x, -1, air_pos.z),
        &mut stats,
    );
    assert!(!exposed);
    assert!(stats.exposure_outside_world_rejected > 0);
}

#[test]
fn sealed_air_is_inside_water_sdf() {
    let mut world = world_with_vertical_chunks();
    world.set_voxel(IVec3::new(8, WATER_LEVEL, 8), VoxelType::Water);
    seal_air_cell(&mut world, IVec3::new(8, WATER_LEVEL + 1, 8));
    let chunk = world.get_chunk(IVec3::new(0, 1, 0)).unwrap();

    let sdf = generate_water_sdf(chunk, &world, WaterAirExposureMode::ExteriorConnected);
    let air_above_water_index = PaddedChunkShape::linearize([9, 4, 9]) as usize;

    assert_eq!(sdf[air_above_water_index], -1.0);
}

#[test]
fn sealed_air_across_chunk_boundary_does_not_create_seam() {
    let mut world = world_with_test_chunks(IVec3::new(2, 3, 1));
    let water_pos = IVec3::new(15, WATER_LEVEL, 8);
    let air_pos = water_pos + IVec3::Y;
    world.set_voxel(water_pos, VoxelType::Water);
    seal_air_cell(&mut world, air_pos);

    let chunk = world.get_chunk(IVec3::new(0, 1, 0)).unwrap();
    let mesh = generate_chunk_mesh(
        chunk,
        &world,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
    );

    assert!(mesh.water.indices.is_empty());
    assert_eq!(mesh.water_stats.air_boundaries_sealed, 1);
}

#[test]
fn surface_nets_chunk_top_boundary_sand_surface_generates_geometry() {
    let mut world = world_with_test_chunks(IVec3::new(2, 3, 2));
    for x in 14..=18 {
        for z in 15..=19 {
            set_column(&mut world, x, z, 0, 27, VoxelType::Rock);
            set_column(&mut world, x, z, 28, 30, VoxelType::SubSoil);
            world.set_voxel(IVec3::new(x, 31, z), VoxelType::Sand);
        }
    }

    let lower_mesh = surface_nets_mesh(IVec3::new(1, 1, 1), &world);
    let upper_mesh = surface_nets_mesh(IVec3::new(1, 2, 1), &world);

    assert!(
        !lower_mesh.solid.indices.is_empty() || !upper_mesh.solid.indices.is_empty(),
        "Surface Nets must produce geometry for a solid surface exactly at a vertical chunk boundary"
    );
    assert!(
        lower_mesh
            .solid
            .positions
            .iter()
            .chain(upper_mesh.solid.positions.iter())
            .any(|position| position[1] >= -0.1 && position[1] <= 16.1),
        "expected boundary surface vertices in one of the two chunks"
    );
    assert!(
        mesh_has_vertical_hit(&lower_mesh.solid, IVec3::new(16, 16, 16), 16.5, 17.5)
            || mesh_has_vertical_hit(&upper_mesh.solid, IVec3::new(16, 32, 16), 16.5, 17.5),
        "expected a downward physics/render ray to hit the chunk-boundary sand surface"
    );
    assert!(
        empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::new(1, 2, 1)),
        "empty upper chunk must stay dirty when it may own a vertical boundary cap"
    );
}

#[test]
fn surface_nets_empty_chunk_above_fully_solid_neighbor_needs_terrain_mesh() {
    let mut world = world_with_test_chunks(IVec3::new(1, 2, 1));
    fill_chunk(&mut world, IVec3::ZERO, VoxelType::Rock);

    assert!(
        empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::Y),
        "empty chunk above a fully solid skipped chunk must own the exposed top cap"
    );
}

#[test]
fn surface_nets_empty_chunk_above_water_only_does_not_need_terrain_mesh() {
    let mut world = world_with_test_chunks(IVec3::new(3, 3, 3));
    world.set_voxel(IVec3::new(24, 31, 24), VoxelType::Water);

    assert!(
        !empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::new(1, 2, 1)),
        "water-only boundaries should remain water mesh responsibility, not terrain mesh"
    );
}

#[test]
fn surface_nets_empty_side_neighbor_does_not_need_terrain_mesh() {
    let mut world = world_with_test_chunks(IVec3::new(2, 2, 2));
    for z in 15..=18 {
        for y in 20..=26 {
            world.set_voxel(IVec3::new(15, y, z), VoxelType::Sand);
        }
    }

    assert!(
        !empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::new(1, 1, 1)),
        "all-air side neighbors should not spawn standalone terrain slabs"
    );
}

#[test]
fn surface_nets_empty_chunk_below_mixed_overhang_needs_terrain_mesh() {
    let mut world = world_with_test_chunks(IVec3::new(1, 2, 1));
    world.set_voxel(IVec3::new(8, 16, 8), VoxelType::Sand);

    assert!(
        empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::ZERO),
        "empty lower chunk must stay dirty when it may own an overhang boundary cap"
    );
}

#[test]
fn surface_nets_empty_chunk_below_fully_solid_neighbor_needs_terrain_mesh() {
    let mut world = world_with_test_chunks(IVec3::new(1, 2, 1));
    fill_chunk(&mut world, IVec3::Y, VoxelType::Rock);

    assert!(
        empty_chunk_has_surface_nets_boundary_surface(&world, IVec3::ZERO),
        "empty chunk below a fully solid skipped chunk may own the exposed ceiling cap"
    );
}

#[test]
fn surface_nets_side_boundary_sand_surface_generates_geometry() {
    let mut world = world_with_test_chunks(IVec3::new(2, 2, 2));
    for z in 15..=18 {
        for y in 0..=3 {
            world.set_voxel(IVec3::new(15, y, z), VoxelType::Sand);
        }
    }

    let left_mesh = surface_nets_mesh(IVec3::new(0, 0, 1), &world);
    let right_mesh = surface_nets_mesh(IVec3::new(1, 0, 1), &world);

    assert!(
        !left_mesh.solid.indices.is_empty() || !right_mesh.solid.indices.is_empty(),
        "Surface Nets must produce side-boundary terrain geometry"
    );
}

#[test]
fn surface_nets_bottom_boundary_air_over_solid_generates_geometry() {
    let mut world = world_with_test_chunks(IVec3::new(1, 3, 1));
    for x in 6..=10 {
        for z in 6..=10 {
            world.set_voxel(IVec3::new(x, 15, z), VoxelType::Sand);
        }
    }

    let upper_mesh = surface_nets_mesh(IVec3::new(0, 1, 0), &world);

    assert!(
        mesh_has_vertical_hit(&upper_mesh.solid, IVec3::new(0, 16, 0), 8.5, 8.5),
        "air chunk above a solid top boundary must generate the owned boundary surface"
    );
}

#[test]
fn voxel_water_sdf_treats_outside_below_world_as_solid_boundary() {
    let world = world_with_test_chunks(IVec3::new(1, 1, 1));
    let chunk = world.get_chunk(IVec3::ZERO).unwrap();
    let chunk_origin = VoxelWorld::chunk_to_world(chunk.position());

    assert_eq!(
        get_voxel_for_water_sdf(chunk, &world, chunk_origin, 8, 0, 8),
        VoxelType::Bedrock
    );
}

#[test]
fn voxel_terrain_meshing_does_not_open_bottom_face_against_world_floor() {
    let mut world = world_with_test_chunks(IVec3::new(1, 1, 1));
    world.set_voxel(IVec3::new(8, 1, 8), VoxelType::Rock);
    let mesh = generate_chunk_mesh(
        world.get_chunk(IVec3::ZERO).unwrap(),
        &world,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
    );

    assert!(
        !mesh.solid.normals.iter().any(|normal| normal[1] < -0.9),
        "terrain should not render a downward face into the world floor boundary"
    );
}

#[test]
fn barycentric_uv_section_tags_round_trip() {
    let mut mesh = MeshData::new();
    mesh.wireframe_lod_index = 2;
    mesh.push_triangle_barycentrics_with_section(TERRAIN_MESH_SECTION_MAIN);
    mesh.push_triangle_barycentrics_with_section(TERRAIN_MESH_SECTION_VERTICAL_SKIRT);
    mesh.push_triangle_barycentrics_with_section(TERRAIN_MESH_SECTION_TRANSITION_APRON);

    assert_eq!(barycentric_lod_index(mesh.barycentric_uvs[0]), 2);
    assert_eq!(
        barycentric_section(mesh.barycentric_uvs[0]),
        TERRAIN_MESH_SECTION_MAIN
    );
    assert_eq!(
        barycentric_section(mesh.barycentric_uvs[3]),
        TERRAIN_MESH_SECTION_VERTICAL_SKIRT
    );
    assert_eq!(
        barycentric_section(mesh.barycentric_uvs[6]),
        TERRAIN_MESH_SECTION_TRANSITION_APRON
    );
    assert!((barycentric_u(mesh.barycentric_uvs[0]) - 1.0).abs() < f32::EPSILON);
}

/// Manual perf probe for the Surface Nets meshing hot path. Not a regression
/// gate - run by hand and compare wall times across changes:
/// `cargo test -p voxel_builder perf_probe_surface_nets_meshing -- --ignored --nocapture`
#[test]
#[ignore = "perf probe - run manually with --nocapture and compare timings"]
fn perf_probe_surface_nets_meshing() {
    use std::time::Instant;

    let size = IVec3::new(4, 2, 4);
    let mut world = world_with_test_chunks(size);
    for x in 0..size.x * CHUNK_SIZE_I32 {
        for z in 0..size.z * CHUNK_SIZE_I32 {
            let h = (12.0
                + 6.0 * ((x as f32) * 0.19).sin()
                + 4.0 * ((z as f32) * 0.23).cos()
                + 3.0 * ((x as f32) * 0.07 + (z as f32) * 0.11).sin()) as i32;
            for y in 2..h.clamp(3, 30) {
                let voxel = if y >= h - 1 {
                    VoxelType::TopSoil
                } else {
                    VoxelType::Rock
                };
                world.set_voxel(IVec3::new(x, y, z), voxel);
            }
        }
    }

    let ao = BakedAoConfig {
        enabled: true,
        strength: 0.5,
        corner_darkness: 0.6,
        fix_anisotropy: false,
    };
    let skirt_config = SkirtConfig::default();
    let chunk_pos = IVec3::new(1, 0, 1);
    let chunk = world.get_chunk(chunk_pos).unwrap();

    for lod in [
        LodLevel::Lod0,
        LodLevel::Lod1,
        LodLevel::Lod2,
        LodLevel::Lod3,
    ] {
        let neighbor_lods = NeighborLods {
            neg_x: Some(lod),
            pos_x: Some(lod),
            neg_y: Some(lod),
            pos_y: Some(lod),
            neg_z: Some(lod),
            pos_z: Some(lod),
        };
        let mut best_us = u64::MAX;
        let mut last = None;
        for _ in 0..10 {
            let start = Instant::now();
            let result = generate_chunk_mesh_for_request(MeshRequest {
                chunk,
                world: &world,
                mode: MeshMode::SurfaceNets,
                logical_lod: lod,
                mesh_lod: lod,
                neighbor_lods,
                skirt_config: &skirt_config,
                ao_config: &ao,
                water_exposure_mode: WaterAirExposureMode::ExteriorConnected,
                forensics: MeshForensicsOptions::default(),
                neighbor_strips: None,
                strip_status: None,
                mc_settings: None,
                timing_enabled: true,
            });
            best_us = best_us.min(start.elapsed().as_micros() as u64);
            last = Some(result);
        }
        let result = last.unwrap();
        let t = result.generation_timing;
        println!(
            "{lod:?}: best {best_us} us | verts {} tris {} | sdf {} sn {} emit {} seam {} strips {} stitch {} skirt {} morph {} water {} us",
            result.solid.positions.len(),
            result.solid.indices.len() / 3,
            t.sdf_us,
            t.surface_nets_us,
            t.emit_surface_us,
            t.lod_seam_us,
            t.boundary_strip_us,
            t.seam_stitch_us,
            t.skirt_us,
            t.morph_finalize_us,
            t.water_us,
        );
    }
}

/// The memoized normal field must agree with the uncached SDF gradient path it
/// replaced, both inside its cached window and through the out-of-window
/// fallback.
#[test]
fn mesh_sdf_cache_matches_uncached_gradient_normals() {
    let mut world = world_with_test_chunks(IVec3::new(3, 2, 3));
    for x in 0..(3 * CHUNK_SIZE_I32) {
        for z in 0..(3 * CHUNK_SIZE_I32) {
            let h = 10 + ((x * 7 + z * 3) % 9);
            for y in 2..h {
                world.set_voxel(IVec3::new(x, y, z), VoxelType::Rock);
            }
        }
    }

    let chunk_origin = VoxelWorld::chunk_to_world(IVec3::new(1, 0, 1));
    let mut cache = MeshSdfCache::new(chunk_origin, LodLevel::Lod0);

    let mut probes = Vec::new();
    for x in [-1.0f32, 0.0, 0.25, 4.5, 8.75, 15.5, 16.0, 17.0] {
        for y in [-1.0f32, 6.25, 9.5, 11.75, 14.0, 17.0] {
            probes.push(Vec3::new(x, y, 7.25));
            probes.push(Vec3::new(7.5, y, x));
        }
    }
    // Outside the cached window: exercises the uncached fallback.
    probes.push(Vec3::new(-40.0, 9.0, 8.0));
    probes.push(Vec3::new(8.0, 9.0, 60.0));

    for local in probes {
        let cached = cache.gradient_normal_at_local(&world, local);
        let uncached = sdf_gradient_normal_at_local(&world, chunk_origin, local);
        for axis in 0..3 {
            assert!(
                (cached[axis] - uncached[axis]).abs() < 1e-6,
                "normal mismatch at {local:?}: cached {cached:?} vs uncached {uncached:?}"
            );
        }
        // Memoized second read must be stable.
        let again = cache.gradient_normal_at_local(&world, local);
        assert_eq!(cached, again, "cache not idempotent at {local:?}");
    }
}
