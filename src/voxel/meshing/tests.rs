use super::*;
use crate::constants::{CHUNK_VOLUME, WATER_LEVEL};
use crate::rendering::ao_config::BakedAoConfig;

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

fn surface_nets_mesh(chunk_pos: IVec3, world: &VoxelWorld) -> ChunkMeshResult {
    let chunk = world.get_chunk(chunk_pos).unwrap();
    generate_chunk_mesh_surface_nets(
        chunk,
        world,
        &ao_config(),
        WaterAirExposureMode::ExteriorConnected,
        false,
    )
}

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
    let sdf = generate_sdf(chunk, &world, true);
    let neighbor_sdf = generate_sdf(neighbor, &world, true);

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
                ao_config: &ao,
                water_exposure_mode: WaterAirExposureMode::ExteriorConnected,
                forensics: MeshForensicsOptions::default(),
                mc_settings: None,
                timing_enabled: true,
            });
            best_us = best_us.min(start.elapsed().as_micros() as u64);
            last = Some(result);
        }
        let result = last.unwrap();
        let t = result.generation_timing;
        println!(
            "{lod:?}: best {best_us} us | verts {} tris {} | sdf {} sn {} emit {} seam {} strips {} stitch {} skirt {} water {} us",
            result.solid.positions.len(),
            result.solid.indices.len() / 3,
            t.sdf_us,
            t.surface_nets_us,
            t.emit_surface_us,
            t.lod_seam_us,
            t.boundary_strip_us,
            t.seam_stitch_us,
            t.skirt_us,
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
