use bevy::prelude::*;

use crate::terrain::generation::config::TerrainConfig;
use crate::voxel::terrain::{BiomeTable, TerrainGenerator, ValueNoise};
use crate::voxel::world::VoxelWorld;

use super::*;

fn terrain() -> TerrainGenerator<ValueNoise> {
    TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default())
}

fn enabled_config() -> StoneConfig {
    StoneConfig {
        enabled: true,
        density: 1.0,
        ..StoneConfig::default()
    }
}

#[test]
fn rock_mesh_same_seed_same_vertices() {
    let a = build_rock_buffers(RockPreset::Boulder, 42, 2);
    let b = build_rock_buffers(RockPreset::Boulder, 42, 2);
    assert_eq!(a.positions, b.positions);
}

#[test]
fn rock_mesh_different_seed_changes_shape() {
    let a = build_rock_buffers(RockPreset::Boulder, 1, 2);
    let b = build_rock_buffers(RockPreset::Boulder, 2, 2);
    assert_ne!(a.positions, b.positions);
}

#[test]
fn rock_mesh_has_vdata() {
    let rock = build_rock_buffers(RockPreset::Talus, 7, 2);
    assert_eq!(rock.positions.len(), rock.vdata.len());
    assert!(rock.vdata.iter().all(|v| v.len() == 4));
}

#[test]
fn scatter_same_seed_same_instances() {
    let t = terrain();
    let cfg = enabled_config();
    let a = generate_stones_in_area(&t, -128, -128, 128, 128, &cfg);
    let b = generate_stones_in_area(&t, -128, -128, 128, 128, &cfg);
    assert_eq!(a, b);
}

#[test]
fn scatter_dirty_regen_matches_initial() {
    let world = VoxelWorld::new(IVec3::new(16, 4, 16));
    let generator = terrain();
    let biome_table = BiomeTable::default();
    let cfg = enabled_config();
    let chunk = IVec2::new(1, 1);
    let initial = generate_stones_for_chunk(chunk, &world, &generator, &biome_table, &cfg, None);
    let dirty = generate_stones_for_chunk(chunk, &world, &generator, &biome_table, &cfg, None);
    assert_eq!(initial, dirty);
}

#[test]
fn scatter_rejects_too_steep_repose() {
    let t = terrain();
    let cfg = StoneConfig {
        slope_repose: 1.1,
        slope_repose_start: 1.2,
        ..enabled_config()
    };
    assert!(generate_stones_in_area(&t, 0, 0, 256, 256, &cfg).is_empty());
}

#[test]
fn scatter_small_stones_do_not_modify_voxels() {
    let world = VoxelWorld::new(IVec3::new(16, 4, 16));
    let before = world.edit_stats();
    let generator = terrain();
    let biome_table = BiomeTable::default();
    let cfg = enabled_config();
    let _ = generate_stones_for_chunk(
        IVec2::new(1, 1),
        &world,
        &generator,
        &biome_table,
        &cfg,
        None,
    );
    assert_eq!(before, world.edit_stats());
}

#[test]
fn negative_world_coords_are_stable() {
    let t = terrain();
    let cfg = enabled_config();
    let a = generate_stones_in_area(&t, -256, -256, -64, -64, &cfg);
    let b = generate_stones_in_area(&t, -256, -256, -64, -64, &cfg);
    assert_eq!(a, b);
}
