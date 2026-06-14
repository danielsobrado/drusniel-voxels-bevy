//! Terrain generation module with noise abstractions.
//!
//! This module provides procedural terrain generation including:
//! - Noise generation trait for extensible noise algorithms
//! - Height map generation with multiple noise layers
//! - Biome determination
//! - Cave system generation
//! - Tree placement and generation
//! - Dungeon structure generation

use crate::constants::{
    BEACH_HEIGHT_OFFSET,
    // Bedrock
    BEDROCK_DEPTH,
    CHUNK_SIZE_I32,
    DEFAULT_WORLD_CHUNKS_X,
    DEFAULT_WORLD_CHUNKS_Z,
    WATER_LEVEL,
};
use crate::terrain::generation::config::TerrainConfig;
use crate::voxel::types::VoxelType;

mod biome;
mod caves;
mod height;
mod noise;
mod trees;
mod water;

pub use biome::{BIOME_DEPTH_BANDS, Biome, BiomeTable};
pub use noise::{NoiseGenerator, ValueNoise, hash_position, hash_position_seeded};
pub use water::{GeneratedWaterBodyKind, WaterGenerationMetadata};

#[cfg(test)]
use water::{CLIFF_MIN_HEIGHT_ABOVE_WATER, EDGE_OCEAN_START_DISTANCE};

/// Terrain generator that produces voxel types for world positions.
pub struct TerrainGenerator<N: NoiseGenerator = ValueNoise> {
    noise: N,
    config: TerrainConfig,
    seed: i32,
    biome_table: BiomeTable,
}

impl Default for TerrainGenerator<ValueNoise> {
    fn default() -> Self {
        Self::with_config(ValueNoise::default(), TerrainConfig::load_or_default())
    }
}

impl<N: NoiseGenerator> TerrainGenerator<N> {
    /// Creates a new terrain generator with the given noise implementation.
    pub fn new(noise: N) -> Self {
        Self::with_config(noise, TerrainConfig::default())
    }

    /// Creates a new terrain generator with custom config.
    pub fn with_config(noise: N, config: TerrainConfig) -> Self {
        Self::with_config_and_biome_table(noise, config, BiomeTable::default())
    }

    pub fn with_biome_table(noise: N, biome_table: BiomeTable) -> Self {
        Self::with_config_and_biome_table(noise, TerrainConfig::default(), biome_table)
    }

    pub fn with_config_and_biome_table(
        noise: N,
        config: TerrainConfig,
        biome_table: BiomeTable,
    ) -> Self {
        Self {
            noise,
            config,
            seed: 0,
            biome_table,
        }
    }

    /// Creates a new terrain generator with custom config and a deterministic recipe seed.
    pub fn with_config_and_seed(noise: N, config: TerrainConfig, seed: i32) -> Self {
        Self::with_config_seed_and_biome_table(noise, config, seed, BiomeTable::default())
    }

    pub fn with_config_seed_and_biome_table(
        noise: N,
        config: TerrainConfig,
        seed: i32,
        biome_table: BiomeTable,
    ) -> Self {
        Self {
            noise,
            config,
            seed,
            biome_table,
        }
    }

    pub fn config(&self) -> &TerrainConfig {
        &self.config
    }
}

impl<N: NoiseGenerator> TerrainGenerator<N> {
    /// Determines the voxel type for a given world position.
    ///
    /// This is the main entry point for terrain generation. It considers:
    /// - Dungeon structures
    /// - Caves
    /// - Trees (trunk and leaves)
    /// - Water level
    /// - Bedrock layer
    /// - Biome-specific terrain
    pub fn get_voxel(&self, world_x: i32, world_y: i32, world_z: i32) -> VoxelType {
        // Bedrock floor (always solid below this depth)
        if world_y <= BEDROCK_DEPTH {
            return VoxelType::Bedrock;
        }

        let terrain_height = self.get_height(world_x, world_z);
        let biome = self.get_biome(world_x, world_z);

        // Dungeons disabled

        // Check caves
        if self.is_cave(world_x, world_y, world_z, terrain_height) {
            return if self.is_cave_aquifer(world_x, world_y, world_z) {
                VoxelType::Water
            } else {
                VoxelType::Air
            };
        }

        // Check tree trunks
        if self.is_tree_trunk(world_x, world_y, world_z, terrain_height) {
            return VoxelType::Wood;
        }

        // Check tree leaves
        if world_y > terrain_height && self.is_tree_leaves(world_x, world_y, world_z) {
            return VoxelType::Leaves;
        }

        // Above terrain surface
        if world_y > terrain_height {
            let metadata = self.get_water_generation_metadata(world_x, world_z);
            return if metadata.is_surface_water() && world_y <= metadata.surface_y {
                VoxelType::Water
            } else {
                VoxelType::Air
            };
        }

        // Biome-specific terrain
        let depth = terrain_height - world_y;
        let near_water = terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET;

        self.get_biome_voxel(biome, depth, near_water)
    }
}

fn lerp_f32(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t.clamp(0.0, 1.0)
}

#[inline]
fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn smoothstep_range(edge0: f32, edge1: f32, value: f32) -> f32 {
    let denominator = edge1 - edge0;
    if denominator.abs() <= f32::EPSILON {
        return if value >= edge1 { 1.0 } else { 0.0 };
    }
    smoothstep((value - edge0) / denominator)
}

#[inline]
fn soften_height_cap(height: f32, min_height: f32, max_height: f32) -> f32 {
    let ceiling_start = (max_height - 18.0).max(min_height);
    let ceiling = max_height - 0.5;
    if height <= ceiling_start || ceiling <= ceiling_start {
        return height;
    }

    let range = ceiling - ceiling_start;
    let excess = height - ceiling_start;
    ceiling_start + range * excess / (excess + range)
}

#[inline]
fn default_world_edge_distance(world_x: i32, world_z: i32) -> i32 {
    let max_x = DEFAULT_WORLD_CHUNKS_X * CHUNK_SIZE_I32 - 1;
    let max_z = DEFAULT_WORLD_CHUNKS_Z * CHUNK_SIZE_I32 - 1;
    world_x
        .min(max_x - world_x)
        .min(world_z)
        .min(max_z - world_z)
}

fn stronger_water_metadata(
    current: WaterGenerationMetadata,
    candidate: WaterGenerationMetadata,
) -> WaterGenerationMetadata {
    if current.kind == GeneratedWaterBodyKind::RiverChannel
        && candidate.kind != GeneratedWaterBodyKind::RiverChannel
    {
        return current;
    }
    if candidate.local_depth > current.local_depth {
        candidate
    } else {
        current
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{
        CAVE_SURFACE_OFFSET, CHUNK_SIZE_I32, DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y,
        DEFAULT_WORLD_CHUNKS_Z, MIN_BREAKABLE_Y,
    };

    use crate::terrain::generation::config::TerrainConfig;
    use crate::voxel::terrain::water::ShorelineKind;

    struct BiomeCoverageNoise;

    impl NoiseGenerator for BiomeCoverageNoise {
        fn sample_2d(&self, _x: f32, _z: f32) -> f32 {
            0.5
        }

        fn fbm_2d(&self, x: f32, _z: f32, _octaves: u32) -> f32 {
            if (x - 0.0).abs() < 0.001 {
                0.1
            } else if (x - 50.0).abs() < 0.001 {
                0.1
            } else if (x - 10.0).abs() < 0.001 {
                0.6
            } else if (x - 20.0).abs() < 0.001 || (x - 100.0).abs() < 0.001 {
                0.8
            } else if (x - 30.0).abs() < 0.001 {
                0.45
            } else if (x - 150.0).abs() < 0.001 {
                0.7
            } else {
                0.5
            }
        }
    }

    struct FlatLowNoise;

    impl NoiseGenerator for FlatLowNoise {
        fn sample_2d(&self, _x: f32, _z: f32) -> f32 {
            0.0
        }
    }

    fn find_shoreline_sample<N: NoiseGenerator>(
        generator: &TerrainGenerator<N>,
        kind: ShorelineKind,
        edge_distance: i32,
    ) -> Option<(i32, i32)> {
        let min_z = edge_distance + 1;
        let max_z = DEFAULT_WORLD_CHUNKS_Z * CHUNK_SIZE_I32 - edge_distance - 1;
        for z in min_z..max_z {
            let x = edge_distance;
            if generator
                .shoreline_profile(x, z)
                .is_some_and(|profile| profile.kind == kind)
            {
                return Some((x, z));
            }
        }
        None
    }

    #[test]
    fn test_value_noise_range() {
        let noise = ValueNoise::default();
        for x in -10..10 {
            for z in -10..10 {
                let value = noise.sample_2d(x as f32, z as f32);
                assert!(
                    value >= 0.0 && value <= 1.0,
                    "Noise value {} out of range",
                    value
                );
            }
        }
    }

    #[test]
    fn test_terrain_height_range() {
        let config = TerrainConfig::default();
        let generator = TerrainGenerator::with_config(ValueNoise::default(), config.clone());
        for x in -100..100 {
            for z in -100..100 {
                let height = generator.get_height(x, z);
                assert!(
                    height >= MIN_BREAKABLE_Y && height <= config.height.max as i32,
                    "Height {} out of range at ({}, {})",
                    height,
                    x,
                    z
                );
            }
        }
    }

    #[test]
    fn default_terrain_still_produces_tall_mountain_relief() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        let mut min_height = i32::MAX;
        let mut max_height = i32::MIN;

        for x in (0..512).step_by(4) {
            for z in (0..512).step_by(4) {
                let height = generator.get_base_height(x, z);
                min_height = min_height.min(height);
                max_height = max_height.max(height);
            }
        }

        assert!(
            max_height >= 100,
            "expected large mountain peaks, got max height {max_height}"
        );
        assert!(
            max_height < DEFAULT_WORLD_CHUNKS_Y * CHUNK_SIZE_I32,
            "world vertical size should contain generated peaks, max height {max_height}"
        );
        assert!(
            max_height - min_height >= 70,
            "expected mountain/valley relief, got range {}..{}",
            min_height,
            max_height
        );
    }

    #[test]
    fn default_terrain_generates_broad_high_massifs() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        let mut high_massif_samples = 0;
        let mut peak_height = i32::MIN;

        for x in (96..416).step_by(4) {
            for z in (96..416).step_by(4) {
                let height = generator.get_base_height(x, z);
                peak_height = peak_height.max(height);
                if height >= 96 {
                    high_massif_samples += 1;
                }
            }
        }

        assert!(
            peak_height >= 108,
            "expected very tall generated mountain peaks, got max height {peak_height}"
        );
        assert!(
            high_massif_samples >= 24,
            "expected broad high massif coverage, got {high_massif_samples} samples"
        );
    }

    #[test]
    fn default_terrain_does_not_flatten_high_massifs_at_height_cap() {
        let config = TerrainConfig::default();
        let generator = TerrainGenerator::with_config(ValueNoise::default(), config.clone());
        let max_height = config.height.max as i32;
        let mut capped_samples = 0;
        let mut longest_capped_run = 0;

        for z in (0..512).step_by(2) {
            let mut current_run = 0;
            for x in (0..512).step_by(2) {
                if generator.get_base_height(x, z) >= max_height {
                    capped_samples += 1;
                    current_run += 1;
                    longest_capped_run = longest_capped_run.max(current_run);
                } else {
                    current_run = 0;
                }
            }
        }

        assert_eq!(
            capped_samples, 0,
            "terrain height cap creates real flat high-altitude slabs; capped_samples={capped_samples}, longest_capped_run={longest_capped_run}"
        );
    }

    #[test]
    fn default_terrain_has_lowlands_and_mountain_peaks() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        let mut lowland_samples = 0;
        let mut mountain_samples = 0;

        for x in (96..416).step_by(4) {
            for z in (96..416).step_by(4) {
                let height = generator.get_base_height(x, z);
                if height <= WATER_LEVEL + 2 {
                    lowland_samples += 1;
                }
                if height >= WATER_LEVEL + 16 {
                    mountain_samples += 1;
                }
            }
        }

        assert!(
            lowland_samples >= 32,
            "expected broad lowland/valley samples, got {lowland_samples}"
        );
        assert!(
            mountain_samples >= 16,
            "expected elevated mountain samples, got {mountain_samples}"
        );
    }

    #[test]
    fn visual_regression_checkpoints_are_above_terrain() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        for (x, z, camera_y) in [
            (256, 220, 82),
            (320, 284, 82),
            (256, 220, 86),
            (320, 284, 86),
            (292, 304, 88),
        ] {
            let height = generator.get_height(x, z);
            assert!(
                height + 6 < camera_y,
                "checkpoint camera at ({x}, {camera_y}, {z}) should be above terrain height {height}"
            );
        }
    }

    #[test]
    fn test_biome_coverage() {
        let generator = TerrainGenerator::with_config(BiomeCoverageNoise, TerrainConfig::default());

        assert_eq!(generator.get_biome(0, 0), Biome::Sandy);
        assert_eq!(generator.get_biome(1000, 0), Biome::Grassland);
        assert_eq!(generator.get_biome(2000, 0), Biome::Rocky);
        assert_eq!(generator.get_biome(3000, 0), Biome::Clay);
    }

    #[test]
    fn biome_selection_table_preserves_strict_threshold_boundaries() {
        let table = BiomeTable::default();

        assert_eq!(table.select(0.24, 0.0), Biome::Sandy);
        assert_eq!(table.select(0.25, 0.0), Biome::Grassland);
        assert_eq!(table.select(0.45, 0.7), Biome::Clay);
        assert_eq!(table.select(0.4, 0.7), Biome::Grassland);
        assert_eq!(table.select(0.8, 0.6), Biome::Rocky);
        assert_eq!(table.select(0.75, 0.6), Biome::Grassland);
    }

    #[test]
    fn biome_selection_changes_from_content_without_code_changes() {
        let mut registry = crate::content::defaults::get_default_registry();
        registry.biomes.get_mut("sandy").unwrap().biome_noise_max = Some(0.65);
        let table = BiomeTable::from_content_registry(&registry).unwrap();
        let generator = TerrainGenerator::with_config_and_biome_table(
            BiomeCoverageNoise,
            TerrainConfig::default(),
            table,
        );

        assert_eq!(generator.get_biome(1000, 0), Biome::Sandy);
    }

    #[test]
    fn biome_soil_layers_are_shallow() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());

        assert_eq!(
            generator.get_biome_voxel(Biome::Grassland, 0, false),
            VoxelType::TopSoil
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Grassland, 2, false),
            VoxelType::SubSoil
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Grassland, 3, false),
            VoxelType::Rock
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Sandy, 2, false),
            VoxelType::Sand
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Sandy, 5, false),
            VoxelType::SubSoil
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Sandy, 6, false),
            VoxelType::Rock
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Clay, 1, false),
            VoxelType::TopSoil
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Clay, 4, false),
            VoxelType::Clay
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Clay, 7, false),
            VoxelType::SubSoil
        );
        assert_eq!(
            generator.get_biome_voxel(Biome::Clay, 8, false),
            VoxelType::Rock
        );
    }

    #[test]
    fn biome_table_resolves_normal_and_shoreline_bands_with_depth_clamping() {
        let table =
            BiomeTable::from_content_registry(&crate::content::defaults::get_default_registry())
                .unwrap();

        assert_eq!(table.voxel(Biome::Grassland, 0, false), VoxelType::TopSoil);
        assert_eq!(table.voxel(Biome::Grassland, 2, false), VoxelType::SubSoil);
        assert_eq!(table.voxel(Biome::Grassland, 200, false), VoxelType::Rock);
        assert_eq!(table.voxel(Biome::Grassland, 0, true), VoxelType::Sand);
        assert_eq!(table.voxel(Biome::Grassland, 3, true), VoxelType::SubSoil);
        assert_eq!(table.voxel(Biome::Clay, 2, true), VoxelType::Clay);
        assert_eq!(table.voxel(Biome::Clay, 200, true), VoxelType::Rock);
    }

    #[test]
    fn biome_content_changes_generated_material_without_code_changes() {
        let mut registry = crate::content::defaults::get_default_registry();
        registry
            .biomes
            .get_mut("grassland")
            .unwrap()
            .surface_material_ids = vec!["sand".to_string()];
        let table = BiomeTable::from_content_registry(&registry).unwrap();
        let generator = TerrainGenerator::with_biome_table(ValueNoise::default(), table);

        assert_eq!(
            generator.get_biome_voxel(Biome::Grassland, 0, false),
            VoxelType::Sand
        );
    }

    #[test]
    fn generated_lake_has_deep_center_and_shallow_shore() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        let mut deepest = None;
        let mut shallow = false;

        for x in 0..512 {
            for z in 0..512 {
                let meta = generator.get_water_generation_metadata(x, z);
                if meta.kind != GeneratedWaterBodyKind::LakeBasin {
                    continue;
                }
                if meta.local_depth >= 3.0 {
                    deepest = Some(meta.local_depth);
                }
                if meta.local_depth > 0.0 && meta.local_depth <= 2.0 {
                    shallow = true;
                }
            }
        }

        assert!(
            deepest.is_some_and(|depth| depth >= 3.0),
            "expected at least one generated lake basin with depth >= 3"
        );
        assert!(shallow, "expected generated lake shoreline depth <= 2");
    }

    #[test]
    fn generated_pond_has_non_flat_depth() {
        let mut config = TerrainConfig::default();
        config.water_bodies.ponds.density = 1.0;
        config.water_bodies.ponds.min_radius = 12.0;
        config.water_bodies.ponds.max_radius = 18.0;
        let generator = TerrainGenerator::with_config(ValueNoise::default(), config);
        let mut max_depth = 0.0f32;

        for x in 0..256 {
            for z in 0..256 {
                let meta = generator.get_water_generation_metadata(x, z);
                if meta.kind == GeneratedWaterBodyKind::Pond {
                    max_depth = max_depth.max(meta.local_depth);
                }
            }
        }

        assert!(
            max_depth >= 2.0,
            "expected pond basin water depth >= 2, got {max_depth}"
        );
    }

    #[test]
    fn generated_basins_do_not_flatten_high_ground() {
        let mut config = TerrainConfig::default();
        config.rivers.enabled = false;
        config.water_bodies.lakes.density = 1.0;
        config.water_bodies.ponds.density = 1.0;
        let generator = TerrainGenerator::with_config(ValueNoise::default(), config);
        let mut checked = 0;

        let interior_start = EDGE_OCEAN_START_DISTANCE + CHUNK_SIZE_I32;
        for x in interior_start..256 {
            for z in interior_start..256 {
                let base_height = generator.get_base_height(x, z);
                if base_height <= WATER_LEVEL + 1 {
                    continue;
                }
                let meta = generator.get_water_generation_metadata(x, z);
                assert_eq!(
                    meta.kind,
                    GeneratedWaterBodyKind::None,
                    "high ground at ({x}, {z}) should not become a lake/pond basin"
                );
                assert_eq!(
                    generator.get_height(x, z),
                    base_height,
                    "high ground at ({x}, {z}) should not be carved down to water level"
                );
                checked += 1;
                if checked >= 128 {
                    return;
                }
            }
        }

        assert!(checked > 0, "expected high ground samples in test area");
    }

    #[test]
    fn inland_low_ground_does_not_auto_fill_with_ocean() {
        let mut config = TerrainConfig::default();
        config.rivers.enabled = false;
        config.water_bodies.enabled = false;
        let generator = TerrainGenerator::with_config(FlatLowNoise, config);
        let x = DEFAULT_WORLD_CHUNKS_X * CHUNK_SIZE_I32 / 2;
        let z = DEFAULT_WORLD_CHUNKS_Z * CHUNK_SIZE_I32 / 2;

        assert!(generator.get_base_height(x, z) < WATER_LEVEL);
        assert_eq!(
            generator.get_water_generation_metadata(x, z).kind,
            GeneratedWaterBodyKind::None
        );
        assert_eq!(generator.get_voxel(x, WATER_LEVEL, z), VoxelType::Air);
    }

    #[test]
    fn generated_river_channel_has_water_depth() {
        let mut config = TerrainConfig::default();
        config.rivers.width = 32.0;
        config.rivers.tributary_width = 16.0;
        let generator = TerrainGenerator::with_config(ValueNoise::default(), config);
        let mut max_depth = 0.0f32;

        for x in 0..512 {
            for z in 0..512 {
                let meta = generator.get_water_generation_metadata(x, z);
                if meta.kind == GeneratedWaterBodyKind::RiverChannel {
                    max_depth = max_depth.max(meta.local_depth);
                }
            }
        }

        assert!(
            max_depth >= 2.0,
            "expected river channel water depth >= 2, got {max_depth}"
        );
    }

    #[test]
    fn low_edge_ground_becomes_ocean_shoreline() {
        let mut config = TerrainConfig::default();
        config.rivers.enabled = false;
        config.water_bodies.lakes.enabled = false;
        config.water_bodies.ponds.enabled = false;
        let generator = TerrainGenerator::with_config(FlatLowNoise, config);
        let (x, z) = find_shoreline_sample(&generator, ShorelineKind::Beach, 0)
            .expect("expected beach shoreline sample");
        let meta = generator.get_water_generation_metadata(x, z);

        assert!(generator.get_base_height(x, z) <= WATER_LEVEL + 1);
        assert_eq!(meta.kind, GeneratedWaterBodyKind::Ocean);
        assert!(meta.bed_y < WATER_LEVEL);
        assert_eq!(generator.get_height(x, z), meta.bed_y);
        assert_eq!(
            generator.get_voxel(x, WATER_LEVEL, z),
            VoxelType::Water,
            "low world-edge ground should become a real ocean surface"
        );
    }

    #[test]
    fn edge_ocean_has_beach_and_cliff_shoreline_profiles() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        let beach = find_shoreline_sample(
            &generator,
            ShorelineKind::Beach,
            EDGE_OCEAN_START_DISTANCE + 4,
        )
        .expect("expected a beach shoreline section");
        let cliff = find_shoreline_sample(
            &generator,
            ShorelineKind::Cliff,
            EDGE_OCEAN_START_DISTANCE + 4,
        )
        .expect("expected a cliff shoreline section");

        let beach_height = generator.get_height(beach.0, beach.1);
        assert!(
            (WATER_LEVEL..=WATER_LEVEL + 6).contains(&beach_height),
            "beach shoreline should form a shallow ramp, got height {beach_height}"
        );
        assert_eq!(
            generator.get_voxel(beach.0, beach_height, beach.1),
            VoxelType::Sand
        );

        let cliff_height = generator.get_height(cliff.0, cliff.1);
        assert!(
            cliff_height >= WATER_LEVEL + CLIFF_MIN_HEIGHT_ABOVE_WATER as i32 - 1,
            "cliff shoreline should hold a high headland, got height {cliff_height}"
        );
        assert_eq!(
            generator.get_voxel(cliff.0, cliff_height, cliff.1),
            VoxelType::Rock
        );
    }

    #[test]
    fn ocean_water_reaches_the_classified_shoreline() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        for kind in [ShorelineKind::Beach, ShorelineKind::Cliff] {
            let (x, z) = find_shoreline_sample(&generator, kind, EDGE_OCEAN_START_DISTANCE - 1)
                .expect("expected shoreline sample just inside ocean");
            let meta = generator.get_water_generation_metadata(x, z);
            assert_eq!(meta.kind, GeneratedWaterBodyKind::Ocean);
            assert!(
                meta.bed_y < WATER_LEVEL,
                "ocean bed should remain below water at {kind:?}, got {}",
                meta.bed_y
            );
            assert_eq!(generator.get_voxel(x, WATER_LEVEL, z), VoxelType::Water);
        }
    }

    #[test]
    fn default_generation_has_no_underground_voids_or_aquifer_water() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());

        for x in (0..256).step_by(3) {
            for z in (0..256).step_by(3) {
                let terrain_height = generator.get_height(x, z);
                for y in (MIN_BREAKABLE_Y..terrain_height - CAVE_SURFACE_OFFSET).step_by(2) {
                    let voxel = generator.get_voxel(x, y, z);
                    assert_ne!(
                        voxel,
                        VoxelType::Air,
                        "default terrain should not create hidden air void at ({x}, {y}, {z})"
                    );
                    assert_ne!(
                        voxel,
                        VoxelType::Water,
                        "default terrain should not create sealed underground water at ({x}, {y}, {z})"
                    );
                }
            }
        }
    }
}
