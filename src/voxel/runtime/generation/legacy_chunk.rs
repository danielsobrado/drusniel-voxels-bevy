use super::*;

const DEBUG_FLAT_WORLD: bool = false;

#[derive(Clone, Copy)]
struct TerrainColumn {
    terrain_height: i32,
    biome: Biome,
    water: WaterGenerationMetadata,
    tree: Option<GeneratedTree>,
}

#[derive(Clone, Copy)]
struct GeneratedTree {
    world_x: i32,
    world_z: i32,
    trunk_top: i32,
    leaf_center_y: i32,
}

pub(crate) fn generate_legacy_chunk_async(
    chunk_pos: IVec3,
    generator: &TerrainGenerator,
) -> (Chunk, ChunkStats) {
    let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
    let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;
    let chunk_world_y = chunk_pos.y * CHUNK_SIZE_I32;

    let mut voxels = [VoxelType::Air; CHUNK_VOLUME];

    if DEBUG_FLAT_WORLD {
        fill_debug_flat_world(&mut voxels, chunk_world_y);
    } else {
        let columns = precompute_terrain_columns(chunk_world_x, chunk_world_z, generator);
        fill_chunk_voxels(
            &mut voxels,
            &columns,
            chunk_world_x,
            chunk_world_y,
            chunk_world_z,
            generator,
        );
        let trees = precompute_overlapping_trees(chunk_world_x, chunk_world_z, &columns, generator);
        paint_tree_leaves(
            &mut voxels,
            &columns,
            &trees,
            chunk_world_x,
            chunk_world_y,
            chunk_world_z,
        );
    }

    let stats = collect_chunk_stats(&voxels);
    let chunk = Chunk::with_voxels(chunk_pos, voxels);
    (chunk, stats)
}

fn fill_debug_flat_world(voxels: &mut [VoxelType; CHUNK_VOLUME], chunk_world_y: i32) {
    for z in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            let world_y = chunk_world_y + y as i32;
            let voxel = if world_y <= 12 { VoxelType::TopSoil } else { VoxelType::Air };
            for x in 0..CHUNK_SIZE {
                voxels[Chunk::index(x, y, z)] = voxel;
            }
        }
    }
}

fn precompute_terrain_columns(
    chunk_world_x: i32,
    chunk_world_z: i32,
    generator: &TerrainGenerator,
) -> [TerrainColumn; CHUNK_SIZE * CHUNK_SIZE] {
    std::array::from_fn(|index| {
        let x = index % CHUNK_SIZE;
        let z = index / CHUNK_SIZE;
        let world_x = chunk_world_x + x as i32;
        let world_z = chunk_world_z + z as i32;
        let (terrain_height, water) =
            generator.get_height_and_water_generation_metadata(world_x, world_z);
        let biome = generator.get_biome(world_x, world_z);
        let tree = tree_at(generator, world_x, world_z, terrain_height);
        TerrainColumn {
            terrain_height,
            biome,
            water,
            tree,
        }
    })
}

fn precompute_overlapping_trees(
    chunk_world_x: i32,
    chunk_world_z: i32,
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    generator: &TerrainGenerator,
) -> Vec<GeneratedTree> {
    let min_x = chunk_world_x - TREE_LEAF_CHECK_RADIUS;
    let max_x = chunk_world_x + CHUNK_SIZE_I32 - 1 + TREE_LEAF_CHECK_RADIUS;
    let min_z = chunk_world_z - TREE_LEAF_CHECK_RADIUS;
    let max_z = chunk_world_z + CHUNK_SIZE_I32 - 1 + TREE_LEAF_CHECK_RADIUS;
    let mut trees = Vec::new();

    for world_z in min_z..=max_z {
        for world_x in min_x..=max_x {
            let terrain_height = tree_scan_terrain_height(
                chunk_world_x,
                chunk_world_z,
                columns,
                generator,
                world_x,
                world_z,
            );
            if let Some(tree) = tree_at(generator, world_x, world_z, terrain_height) {
                trees.push(tree);
            }
        }
    }

    trees
}

fn tree_scan_terrain_height(
    chunk_world_x: i32,
    chunk_world_z: i32,
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    generator: &TerrainGenerator,
    world_x: i32,
    world_z: i32,
) -> i32 {
    let local_x = world_x - chunk_world_x;
    let local_z = world_z - chunk_world_z;
    if (0..CHUNK_SIZE_I32).contains(&local_x) && (0..CHUNK_SIZE_I32).contains(&local_z) {
        columns[column_index(local_x as usize, local_z as usize)].terrain_height
    } else {
        generator
            .get_height_and_water_generation_metadata(world_x, world_z)
            .0
    }
}

fn tree_at(
    generator: &TerrainGenerator,
    world_x: i32,
    world_z: i32,
    terrain_height: i32,
) -> Option<GeneratedTree> {
    if !generator.should_spawn_tree(world_x, world_z, terrain_height) {
        return None;
    }

    let trunk_height = generator.get_tree_height(world_x, world_z);
    let trunk_top = terrain_height + 1 + trunk_height;
    Some(GeneratedTree {
        world_x,
        world_z,
        trunk_top,
        leaf_center_y: trunk_top - 1,
    })
}

fn fill_chunk_voxels(
    voxels: &mut [VoxelType; CHUNK_VOLUME],
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    chunk_world_x: i32,
    chunk_world_y: i32,
    chunk_world_z: i32,
    generator: &TerrainGenerator,
) {
    for x in 0..CHUNK_SIZE {
        for z in 0..CHUNK_SIZE {
            let world_x = chunk_world_x + x as i32;
            let world_z = chunk_world_z + z as i32;
            let column = columns[column_index(x, z)];

            for y in 0..CHUNK_SIZE {
                let world_y = chunk_world_y + y as i32;
                voxels[Chunk::index(x, y, z)] =
                    voxel_from_column(generator, column, world_x, world_y, world_z);
            }
        }
    }
}

fn voxel_from_column(
    generator: &TerrainGenerator,
    column: TerrainColumn,
    world_x: i32,
    world_y: i32,
    world_z: i32,
) -> VoxelType {
    if world_y <= BEDROCK_DEPTH {
        return VoxelType::Bedrock;
    }

    if generator.is_cave(world_x, world_y, world_z, column.terrain_height) {
        return if generator.is_cave_aquifer(world_x, world_y, world_z) {
            VoxelType::Water
        } else {
            VoxelType::Air
        };
    }

    if column
        .tree
        .is_some_and(|tree| world_y >= column.terrain_height + 1 && world_y < tree.trunk_top)
    {
        return VoxelType::Wood;
    }

    if world_y > column.terrain_height {
        return if column.water.is_surface_water() && world_y <= column.water.surface_y {
            VoxelType::Water
        } else {
            VoxelType::Air
        };
    }

    let depth = column.terrain_height - world_y;
    let near_water = column.terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET;
    generator.get_biome_voxel(column.biome, depth, near_water)
}

fn paint_tree_leaves(
    voxels: &mut [VoxelType; CHUNK_VOLUME],
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    trees: &[GeneratedTree],
    chunk_world_x: i32,
    chunk_world_y: i32,
    chunk_world_z: i32,
) {
    let chunk_max_x = chunk_world_x + CHUNK_SIZE_I32 - 1;
    let chunk_max_y = chunk_world_y + CHUNK_SIZE_I32 - 1;
    let chunk_max_z = chunk_world_z + CHUNK_SIZE_I32 - 1;
    let leaf_radius_sq = TREE_LEAF_RADIUS * TREE_LEAF_RADIUS;

    for tree in trees {
        let min_x = (tree.world_x - TREE_LEAF_CHECK_RADIUS).max(chunk_world_x);
        let max_x = (tree.world_x + TREE_LEAF_CHECK_RADIUS).min(chunk_max_x);
        let min_z = (tree.world_z - TREE_LEAF_CHECK_RADIUS).max(chunk_world_z);
        let max_z = (tree.world_z + TREE_LEAF_CHECK_RADIUS).min(chunk_max_z);

        for world_z in min_z..=max_z {
            for world_x in min_x..=max_x {
                let local_x = (world_x - chunk_world_x) as usize;
                let local_z = (world_z - chunk_world_z) as usize;
                let column = columns[column_index(local_x, local_z)];
                let dx = tree.world_x - world_x;
                let dz = tree.world_z - world_z;
                let xz_dist_sq = (dx * dx + dz * dz) as f32;
                if xz_dist_sq >= leaf_radius_sq {
                    continue;
                }

                for world_y in chunk_world_y..=chunk_max_y {
                    if world_y <= column.terrain_height {
                        continue;
                    }

                    let dy = world_y - tree.leaf_center_y;
                    let dist_sq = xz_dist_sq + (dy * dy) as f32 * 1.5;
                    if dist_sq >= leaf_radius_sq {
                        continue;
                    }
                    if dx == 0 && dz == 0 && world_y < tree.trunk_top {
                        continue;
                    }

                    let local_y = (world_y - chunk_world_y) as usize;
                    let index = Chunk::index(local_x, local_y, local_z);
                    if voxels[index] != VoxelType::Wood {
                        voxels[index] = VoxelType::Leaves;
                    }
                }
            }
        }
    }
}

#[inline]
fn column_index(x: usize, z: usize) -> usize {
    x + z * CHUNK_SIZE
}
