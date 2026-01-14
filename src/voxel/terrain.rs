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
    // Terrain generation (fallbacks for biomes/caves/trees)
    TERRAIN_BIOME_FREQUENCY, TERRAIN_CAVE_FREQUENCY,
    TERRAIN_BASE_FREQUENCY, TERRAIN_BASE_AMPLITUDE, TERRAIN_BASE_HEIGHT,
    TERRAIN_HILL_FREQUENCY, TERRAIN_HILL_AMPLITUDE,
    TERRAIN_MOUNTAIN_FREQUENCY, MOUNTAIN_MULTIPLIER,
    TERRAIN_RIVER_FREQUENCY, RIVER_WIDTH_THRESHOLD, RIVER_CARVE_DEPTH,
    TERRAIN_MIN_HEIGHT, TERRAIN_MAX_HEIGHT,
    WATER_LEVEL, BEACH_HEIGHT_OFFSET,
    // Biomes
    BIOME_SANDY_THRESHOLD, BIOME_ROCKY_THRESHOLD, BIOME_ROCKY_DETAIL_THRESHOLD,
    BIOME_CLAY_MIN, BIOME_CLAY_MAX, BIOME_CLAY_DETAIL_THRESHOLD,
    // Trees
    TREE_SPAWN_THRESHOLD, TREE_MIN_HEIGHT, TREE_HEIGHT_VARIANCE, TREE_LEAF_CHECK_RADIUS, TREE_LEAF_RADIUS,
    // Caves
    CAVE_MIN_Y, CAVE_MAX_Y, CAVE_SURFACE_OFFSET, MOUNTAIN_THRESHOLD,
    // Bedrock
    BEDROCK_DEPTH,
};
use crate::terrain::generation::config::TerrainConfig;
use crate::voxel::types::VoxelType;
use bevy::log::debug;
use std::sync::atomic::{AtomicUsize, Ordering};

static TREE_SPAWN_LOGS: AtomicUsize = AtomicUsize::new(0);

// =============================================================================
// Noise Abstraction
// =============================================================================

/// Trait for noise generation algorithms.
///
/// Implement this trait to provide custom noise functions for terrain generation.
pub trait NoiseGenerator: Send + Sync {
    /// Samples 2D noise at the given coordinates.
    ///
    /// Returns a value in the range [0, 1].
    fn sample_2d(&self, x: f32, z: f32) -> f32;

    /// Samples 3D noise at the given coordinates.
    ///
    /// Returns a value in the range [0, 1].
    fn sample_3d(&self, x: f32, y: f32, z: f32) -> f32 {
        // Default implementation uses 2D noise with y offset
        self.sample_2d(x + y * 0.1, z + y * 0.1)
    }

    /// Generates fractal Brownian motion noise using multiple octaves.
    fn fbm_2d(&self, x: f32, z: f32, octaves: u32) -> f32 {
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = 1.0;
        let mut max_value = 0.0;

        for _ in 0..octaves {
            value += amplitude * self.sample_2d(x * frequency, z * frequency);
            max_value += amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }

        value / max_value
    }

    /// Generates 3D fractal Brownian motion noise.
    fn fbm_3d(&self, x: f32, y: f32, z: f32, octaves: u32) -> f32 {
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = 1.0;
        let mut max_value = 0.0;

        for _ in 0..octaves {
            value += amplitude * self.sample_3d(x * frequency, y * frequency, z * frequency);
            max_value += amplitude;
            amplitude *= 0.5;
            frequency *= 2.0;
        }

        value / max_value
    }
}

/// Default value noise implementation using hash-based pseudo-random numbers.
#[derive(Clone, Copy, Default)]
pub struct ValueNoise {
    seed: i32,
}

impl ValueNoise {
    /// Creates a new value noise generator with the given seed.
    pub fn new(seed: i32) -> Self {
        Self { seed }
    }

    /// Hash function for pseudo-random number generation.
    #[inline]
    fn hash(&self, x: i32, z: i32) -> f32 {
        let n = x
            .wrapping_mul(374761393)
            .wrapping_add(z.wrapping_mul(668265263))
            .wrapping_add(self.seed.wrapping_mul(1376312589));
        let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
        ((n ^ (n >> 16)) as u32 as f32) / u32::MAX as f32
    }

    /// Hash function for 3D coordinates.
    #[inline]
    fn hash_3d(&self, x: i32, y: i32, z: i32) -> f32 {
        let n = x
            .wrapping_mul(374761393)
            .wrapping_add(y.wrapping_mul(668265263))
            .wrapping_add(z.wrapping_mul(1274126177))
            .wrapping_add(self.seed.wrapping_mul(1376312589));
        let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
        ((n ^ (n >> 16)) as u32 as f32) / u32::MAX as f32
    }

    #[inline]
    fn smoothstep(t: f32) -> f32 {
        t * t * (3.0 - 2.0 * t)
    }

    #[inline]
    fn lerp(a: f32, b: f32, t: f32) -> f32 {
        a + t * (b - a)
    }
}

impl NoiseGenerator for ValueNoise {
    fn sample_2d(&self, x: f32, z: f32) -> f32 {
        let xi = x.floor() as i32;
        let zi = z.floor() as i32;
        let xf = x - x.floor();
        let zf = z - z.floor();

        let v00 = self.hash(xi, zi);
        let v10 = self.hash(xi + 1, zi);
        let v01 = self.hash(xi, zi + 1);
        let v11 = self.hash(xi + 1, zi + 1);

        let u = Self::smoothstep(xf);
        let v = Self::smoothstep(zf);

        Self::lerp(Self::lerp(v00, v10, u), Self::lerp(v01, v11, u), v)
    }

    fn sample_3d(&self, x: f32, y: f32, z: f32) -> f32 {
        let xi = x.floor() as i32;
        let yi = y.floor() as i32;
        let zi = z.floor() as i32;
        let xf = x - x.floor();
        let yf = y - y.floor();
        let zf = z - z.floor();

        let v000 = self.hash_3d(xi, yi, zi);
        let v100 = self.hash_3d(xi + 1, yi, zi);
        let v010 = self.hash_3d(xi, yi + 1, zi);
        let v110 = self.hash_3d(xi + 1, yi + 1, zi);
        let v001 = self.hash_3d(xi, yi, zi + 1);
        let v101 = self.hash_3d(xi + 1, yi, zi + 1);
        let v011 = self.hash_3d(xi, yi + 1, zi + 1);
        let v111 = self.hash_3d(xi + 1, yi + 1, zi + 1);

        let u = Self::smoothstep(xf);
        let v = Self::smoothstep(yf);
        let w = Self::smoothstep(zf);

        let x00 = Self::lerp(v000, v100, u);
        let x10 = Self::lerp(v010, v110, u);
        let x01 = Self::lerp(v001, v101, u);
        let x11 = Self::lerp(v011, v111, u);

        let y0 = Self::lerp(x00, x10, v);
        let y1 = Self::lerp(x01, x11, v);

        Self::lerp(y0, y1, w)
    }
}

// =============================================================================
// Biome Types
// =============================================================================

/// Biome type enumeration for terrain variation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Biome {
    /// Normal terrain with grass and soil.
    Grassland,
    /// Sandy desert or beach areas.
    Sandy,
    /// Rocky mountain outcrops.
    Rocky,
    /// Clay deposit areas.
    Clay,
}

impl Biome {
    /// Returns the biome ID for compatibility with existing code.
    pub fn id(&self) -> u8 {
        match self {
            Biome::Grassland => 0,
            Biome::Sandy => 1,
            Biome::Rocky => 2,
            Biome::Clay => 3,
        }
    }

    /// Creates a biome from its numeric ID.
    pub fn from_id(id: u8) -> Self {
        match id {
            1 => Biome::Sandy,
            2 => Biome::Rocky,
            3 => Biome::Clay,
            _ => Biome::Grassland,
        }
    }
}

// =============================================================================
// Terrain Generator
// =============================================================================

/// Terrain generator that produces voxel types for world positions.
pub struct TerrainGenerator<N: NoiseGenerator = ValueNoise> {
    noise: N,
    config: TerrainConfig,
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
        Self { noise, config }
    }

    /// Configurable fBm noise using NoiseLayer parameters.
    fn fbm_configurable(&self, x: f32, z: f32, scale: f32, octaves: u32, persistence: f32, lacunarity: f32) -> f32 {
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = scale;
        let mut max_value = 0.0;

        for _ in 0..octaves {
            value += amplitude * self.noise.sample_2d(x * frequency, z * frequency);
            max_value += amplitude;
            amplitude *= persistence;
            frequency *= lacunarity;
        }

        value / max_value
    }

    /// Ridged noise for sharp mountain peaks.
    fn ridged_noise(&self, x: f32, z: f32) -> f32 {
        let cfg = &self.config.mountains;
        let mut value = 0.0;
        let mut amplitude = 1.0;
        let mut frequency = cfg.scale;
        let mut max_value = 0.0;

        for i in 0..cfg.octaves {
            // Offset each octave slightly for variation
            let sample = self.noise.sample_2d(x * frequency + i as f32 * 100.0, z * frequency + i as f32 * 100.0);

            // Ridge transformation: 1.0 - |noise * 2 - 1|, then power for sharpness
            let centered = sample * 2.0 - 1.0; // Convert [0,1] to [-1,1]
            let ridge = 1.0 - centered.abs();
            let ridge = ridge.powf(cfg.ridge_power);

            value += ridge * amplitude;
            max_value += amplitude;

            amplitude *= cfg.persistence;
            frequency *= cfg.lacunarity;
        }

        (value / max_value) * cfg.amplitude
    }

    /// Calculates terrain height at a given world position.
    ///
    /// Uses multiple noise layers for varied terrain:
    /// - Continent layer for large-scale shape
    /// - Mountains with ridged noise for dramatic peaks
    /// - Hills for medium-scale variation
    /// - Detail for fine surface variation
    pub fn get_height(&self, world_x: i32, world_z: i32) -> i32 {
        let x = world_x as f32;
        let z = world_z as f32;
        let cfg = &self.config;

        // Large-scale continent shape
        let continent = self.fbm_configurable(
            x, z,
            cfg.continent.scale,
            cfg.continent.octaves,
            cfg.continent.persistence,
            cfg.continent.lacunarity,
        ) * cfg.continent.amplitude;

        // Mountain mask - determines where mountains appear (using lower frequency)
        let mountain_mask = self.fbm_configurable(
            x, z,
            cfg.mountains.scale * 0.25, // Lower frequency for mountain regions
            2,
            0.5,
            2.0,
        );
        let mountain_mask = (mountain_mask + 0.3).clamp(0.0, 1.0);

        // Ridged mountains, masked by mountain regions
        let mountains = self.ridged_noise(x, z) * mountain_mask;

        // Hills everywhere
        let hills = self.fbm_configurable(
            x, z,
            cfg.hills.scale,
            cfg.hills.octaves,
            cfg.hills.persistence,
            cfg.hills.lacunarity,
        ) * cfg.hills.amplitude;

        // Fine detail
        let detail = self.fbm_configurable(
            x, z,
            cfg.detail.scale,
            cfg.detail.octaves,
            cfg.detail.persistence,
            cfg.detail.lacunarity,
        ) * cfg.detail.amplitude;

        // Combine all layers
        let height = continent + mountains + hills + detail;

        // Clamp to world bounds from config
        height.clamp(cfg.height.min, cfg.height.max) as i32
    }

    /// Determines the biome at a given world position.
    pub fn get_biome(&self, world_x: i32, world_z: i32) -> Biome {
        let x = world_x as f32;
        let z = world_z as f32;

        let biome_noise = self.noise.fbm_2d(x * TERRAIN_BIOME_FREQUENCY, z * TERRAIN_BIOME_FREQUENCY, 2);
        let detail_noise = self.noise.fbm_2d(x * TERRAIN_CAVE_FREQUENCY, z * TERRAIN_CAVE_FREQUENCY, 2);

        if biome_noise < BIOME_SANDY_THRESHOLD {
            Biome::Sandy
        } else if biome_noise > BIOME_ROCKY_THRESHOLD && detail_noise > BIOME_ROCKY_DETAIL_THRESHOLD {
            Biome::Rocky
        } else if biome_noise > BIOME_CLAY_MIN && biome_noise < BIOME_CLAY_MAX && detail_noise > BIOME_CLAY_DETAIL_THRESHOLD {
            Biome::Clay
        } else {
            Biome::Grassland
        }
    }

    /// Checks if a position should be a cave.
    pub fn is_cave(&self, world_x: i32, world_y: i32, world_z: i32, terrain_height: i32) -> bool {
        if world_y <= CAVE_MIN_Y || world_y >= CAVE_MAX_Y {
            return false;
        }

        if world_y >= terrain_height - CAVE_SURFACE_OFFSET {
            return false;
        }

        let x = world_x as f32;
        let y = world_y as f32;
        let z = world_z as f32;

        let cave_noise = self.noise.fbm_2d(
            x * TERRAIN_CAVE_FREQUENCY + y * 0.03,
            z * TERRAIN_CAVE_FREQUENCY + y * 0.02,
            3,
        );

        // Caves more common at lower depths
        let cave_threshold = MOUNTAIN_THRESHOLD + (y / 64.0) * 0.1;
        cave_noise > cave_threshold
    }

    /// Checks if a tree should spawn at a given location.
    pub fn should_spawn_tree(&self, world_x: i32, world_z: i32, terrain_height: i32) -> bool {
        if terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET {
            return false;
        }

        let tree_noise = hash_position(world_x.wrapping_mul(7), world_z.wrapping_mul(13));
        let spawn = tree_noise > TREE_SPAWN_THRESHOLD;
        if spawn && TREE_SPAWN_LOGS.fetch_add(1, Ordering::Relaxed) < 8 {
            debug!(
                "Tree spawn candidate at ({}, {}) height {} noise {:.3}",
                world_x, world_z, terrain_height, tree_noise
            );
        }
        spawn
    }

    /// Gets the height of a tree at a given location.
    pub fn get_tree_height(&self, world_x: i32, world_z: i32) -> i32 {
        let h = hash_position(world_x.wrapping_add(1000), world_z.wrapping_add(2000));
        TREE_MIN_HEIGHT + (h * TREE_HEIGHT_VARIANCE as f32) as i32
    }

    /// Checks if a position is part of a tree trunk.
    pub fn is_tree_trunk(&self, world_x: i32, world_y: i32, world_z: i32, terrain_height: i32) -> bool {
        if !self.should_spawn_tree(world_x, world_z, terrain_height) {
            return false;
        }

        let trunk_height = self.get_tree_height(world_x, world_z);
        let trunk_bottom = terrain_height + 1;
        let trunk_top = trunk_bottom + trunk_height;

        world_y >= trunk_bottom && world_y < trunk_top
    }

    /// Checks if a position is part of tree leaves.
    pub fn is_tree_leaves(&self, world_x: i32, world_y: i32, world_z: i32) -> bool {
        for dx in -TREE_LEAF_CHECK_RADIUS..=TREE_LEAF_CHECK_RADIUS {
            for dz in -TREE_LEAF_CHECK_RADIUS..=TREE_LEAF_CHECK_RADIUS {
                let check_x = world_x + dx;
                let check_z = world_z + dz;

                let check_height = self.get_height(check_x, check_z);

                if self.should_spawn_tree(check_x, check_z, check_height) {
                    let trunk_height = self.get_tree_height(check_x, check_z);
                    let trunk_top = check_height + 1 + trunk_height;
                    let leaf_center_y = trunk_top - 1;

                    let dx_f = dx as f32;
                    let dz_f = dz as f32;
                    let dy_f = (world_y - leaf_center_y) as f32;

                    let dist_sq = dx_f * dx_f + dy_f * dy_f * 1.5 + dz_f * dz_f;

                    if dist_sq < TREE_LEAF_RADIUS * TREE_LEAF_RADIUS {
                        if !(dx == 0 && dz == 0 && world_y < trunk_top) {
                            return true;
                        }
                    }
                }
            }
        }

        false
    }

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
        let terrain_height = self.get_height(world_x, world_z);

        // Bedrock floor (always solid below this depth)
        if world_y <= BEDROCK_DEPTH {
            return VoxelType::Bedrock;
        }

        let biome = self.get_biome(world_x, world_z);

        // Dungeons disabled

        // Check caves
        if self.is_cave(world_x, world_y, world_z, terrain_height) {
            return if world_y <= WATER_LEVEL {
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
            return if world_y <= WATER_LEVEL {
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

    /// Determines the voxel type based on biome, depth, and water proximity.
    fn get_biome_voxel(&self, biome: Biome, depth: i32, near_water: bool) -> VoxelType {
        match biome {
            Biome::Sandy => {
                if depth <= 4 {
                    VoxelType::Sand
                } else if depth <= 8 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
            Biome::Rocky => {
                if depth <= 1 {
                    VoxelType::Rock
                } else if depth <= 3 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
            Biome::Clay => {
                if near_water {
                    if depth <= 2 {
                        VoxelType::Sand
                    } else if depth <= 6 {
                        VoxelType::Clay
                    } else {
                        VoxelType::Rock
                    }
                } else if depth <= 2 {
                    VoxelType::TopSoil
                } else if depth <= 6 {
                    VoxelType::Clay
                } else if depth <= 10 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
            Biome::Grassland => {
                if near_water {
                    if depth <= BEACH_HEIGHT_OFFSET {
                        VoxelType::Sand
                    } else if depth <= 5 {
                        VoxelType::SubSoil
                    } else {
                        VoxelType::Rock
                    }
                } else if depth == 0 {
                    VoxelType::TopSoil
                } else if depth <= 4 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
        }
    }
}


// =============================================================================
// Utility Functions
// =============================================================================

/// Simple hash function for deterministic pseudo-random values.
#[inline]
pub fn hash_position(x: i32, z: i32) -> f32 {
    let n = x
        .wrapping_mul(374761393)
        .wrapping_add(z.wrapping_mul(668265263));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    ((n ^ (n >> 16)) as u32 as f32) / u32::MAX as f32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::config::TerrainConfig;

    #[test]
    fn test_value_noise_range() {
        let noise = ValueNoise::default();
        for x in -10..10 {
            for z in -10..10 {
                let value = noise.sample_2d(x as f32, z as f32);
                assert!(value >= 0.0 && value <= 1.0, "Noise value {} out of range", value);
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
                    height >= config.height.min as i32 && height <= config.height.max as i32,
                    "Height {} out of range at ({}, {})",
                    height,
                    x,
                    z
                );
            }
        }
    }

    #[test]
    fn test_biome_coverage() {
        let generator = TerrainGenerator::default();
        let mut biome_counts = [0u32; 4];

        for x in 0..100 {
            for z in 0..100 {
                let biome = generator.get_biome(x, z);
                biome_counts[biome.id() as usize] += 1;
            }
        }

        // All biomes should appear at least once in a 100x100 area
        for (i, &count) in biome_counts.iter().enumerate() {
            assert!(count > 0, "Biome {} never appeared in test area", i);
        }
    }

}
