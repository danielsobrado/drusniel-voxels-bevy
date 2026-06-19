//! Canonical stone chunk generation entry point.
//!
//! Runtime spawning, dirty regeneration, and future persistence invalidation must call this path
//! instead of duplicating scatter logic.

use bevy::prelude::*;

use crate::constants::CHUNK_SIZE_I32;
use crate::voxel::terrain::{BiomeTable, TerrainGenerator, ValueNoise};
use crate::voxel::world::VoxelWorld;
use crate::world_rules::ProtectedAreaRegistry;

use super::config::StoneConfig;
use super::constants::STONE_CHUNK_SIZE;
use super::scatter::{StoneInstance, generate_ranked_stones_in_area};

pub fn generate_stones_for_chunk(
    chunk_pos: IVec2,
    world: &VoxelWorld,
    generator: &TerrainGenerator<ValueNoise>,
    _biome_table: &BiomeTable,
    config: &StoneConfig,
    protected_areas: Option<&ProtectedAreaRegistry>,
) -> Vec<StoneInstance> {
    if config.max_instances_per_chunk == 0 || config.density <= 0.0 {
        return Vec::new();
    }

    let min_x = chunk_pos.x * STONE_CHUNK_SIZE;
    let min_z = chunk_pos.y * STONE_CHUNK_SIZE;
    let max_x = min_x + STONE_CHUNK_SIZE;
    let max_z = min_z + STONE_CHUNK_SIZE;

    if outside_positive_world_bounds(world, min_x, min_z, max_x, max_z) {
        return Vec::new();
    }

    generate_ranked_stones_in_area(generator, min_x, min_z, max_x, max_z, config)
        .into_iter()
        .filter_map(|(_, instance)| {
            if protected_areas
                .map(|registry| registry.prop_position_blocked(instance.position))
                .unwrap_or(false)
            {
                None
            } else {
                Some(instance)
            }
        })
        .take(config.max_instances_per_chunk)
        .collect()
}

fn outside_positive_world_bounds(
    world: &VoxelWorld,
    min_x: i32,
    min_z: i32,
    max_x: i32,
    max_z: i32,
) -> bool {
    let size = world.world_size_chunks() * CHUNK_SIZE_I32;
    max_x <= 0 || max_z <= 0 || min_x >= size.x || min_z >= size.z
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::config::TerrainConfig;
    use crate::voxel::terrain::ValueNoise;

    fn terrain() -> TerrainGenerator<ValueNoise> {
        TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default())
    }

    #[test]
    fn dirty_regen_matches_initial_generation_path() {
        let world = VoxelWorld::new(IVec3::new(16, 4, 16));
        let generator = terrain();
        let biome_table = BiomeTable::default();
        let cfg = StoneConfig {
            enabled: true,
            density: 1.0,
            ..StoneConfig::default()
        };
        let chunk = IVec2::new(1, 1);
        let initial =
            generate_stones_for_chunk(chunk, &world, &generator, &biome_table, &cfg, None);
        let dirty = generate_stones_for_chunk(chunk, &world, &generator, &biome_table, &cfg, None);
        assert_eq!(initial, dirty);
    }
}
