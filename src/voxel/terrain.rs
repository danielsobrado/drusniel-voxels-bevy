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
    BIOME_CLAY_DETAIL_THRESHOLD,
    BIOME_CLAY_MAX,
    BIOME_CLAY_MIN,
    BIOME_ROCKY_DETAIL_THRESHOLD,
    BIOME_ROCKY_THRESHOLD,
    // Biomes
    BIOME_SANDY_THRESHOLD,
    CAVE_MAX_Y,
    // Caves
    CAVE_MIN_Y,
    CAVE_SURFACE_OFFSET,
    MOUNTAIN_THRESHOLD,
    // Terrain generation (fallbacks for biomes/caves/trees)
    TERRAIN_BIOME_FREQUENCY,
    TERRAIN_CAVE_FREQUENCY,
    TREE_HEIGHT_VARIANCE,
    TREE_LEAF_CHECK_RADIUS,
    TREE_LEAF_RADIUS,
    TREE_MIN_HEIGHT,
    // Trees
    TREE_SPAWN_THRESHOLD,
    WATER_LEVEL,
};
use crate::terrain::generation::config::{BasinConfig, TerrainConfig};
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

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum GeneratedWaterBodyKind {
    Ocean,
    LakeBasin,
    RiverChannel,
    Pond,
    CaveWaterAquifer,
    #[default]
    None,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WaterGenerationMetadata {
    pub kind: GeneratedWaterBodyKind,
    pub surface_y: i32,
    pub bed_y: i32,
    pub max_depth: i32,
    pub local_depth: f32,
    pub strength: f32,
}

impl WaterGenerationMetadata {
    fn none(surface_y: i32, bed_y: i32) -> Self {
        Self {
            kind: GeneratedWaterBodyKind::None,
            surface_y,
            bed_y,
            max_depth: 0,
            local_depth: 0.0,
            strength: 0.0,
        }
    }

    pub fn is_surface_water(self) -> bool {
        matches!(
            self.kind,
            GeneratedWaterBodyKind::Ocean
                | GeneratedWaterBodyKind::LakeBasin
                | GeneratedWaterBodyKind::RiverChannel
                | GeneratedWaterBodyKind::Pond
        )
    }
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
    fn fbm_configurable(
        &self,
        x: f32,
        z: f32,
        scale: f32,
        octaves: u32,
        persistence: f32,
        lacunarity: f32,
    ) -> f32 {
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
            let sample = self.noise.sample_2d(
                x * frequency + i as f32 * 100.0,
                z * frequency + i as f32 * 100.0,
            );

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

    /// Calculates river carving depth at a position.
    /// Returns 0 if no river, or a positive depth value to subtract from terrain.
    fn river_carve(&self, x: f32, z: f32) -> f32 {
        let cfg = &self.config.rivers;
        if !cfg.enabled {
            return 0.0;
        }

        // Main river: use domain-warped noise for meandering
        let warp_x = self.noise.sample_2d(x * 0.002 + 500.0, z * 0.002) * 50.0;
        let warp_z = self.noise.sample_2d(x * 0.002, z * 0.002 + 500.0) * 50.0;

        let warped_x = x + warp_x;
        let warped_z = z + warp_z;

        // Main river pattern using sine-based channel
        let river_noise =
            self.fbm_configurable(warped_x, warped_z, cfg.scale, cfg.octaves, 0.5, 2.0);

        // Convert to river presence: values near 0.5 are river centers
        let river_dist = (river_noise - 0.5).abs() * 2.0; // Distance from river center [0,1]
        let main_river = (1.0 - river_dist / (cfg.width * 0.01).max(0.01)).max(0.0);

        // Tributary rivers (smaller, more frequent)
        let trib_noise =
            self.fbm_configurable(x + 1000.0, z + 1000.0, cfg.tributary_scale, 2, 0.5, 2.0);
        let trib_dist = (trib_noise - 0.5).abs() * 2.0;
        let tributary = (1.0 - trib_dist / (cfg.tributary_width * 0.01).max(0.01)).max(0.0);

        // Combine rivers, main river takes priority
        let river_strength = main_river.max(tributary * 0.6);

        // Smooth the river edges with a curve
        let smooth_river = river_strength * river_strength * (3.0 - 2.0 * river_strength);

        smooth_river * cfg.depth
    }

    /// Calculates terrain height before water body bathymetry is applied.
    ///
    /// Uses multiple noise layers for varied terrain:
    /// - Continent layer for large-scale shape
    /// - Mountains with ridged noise for dramatic peaks
    /// - Hills for medium-scale variation
    /// - Detail for fine surface variation
    pub fn get_base_height(&self, world_x: i32, world_z: i32) -> i32 {
        let x = world_x as f32;
        let z = world_z as f32;
        let cfg = &self.config;

        // Large-scale continent shape
        let continent = self.fbm_configurable(
            x,
            z,
            cfg.continent.scale,
            cfg.continent.octaves,
            cfg.continent.persistence,
            cfg.continent.lacunarity,
        ) * cfg.continent.amplitude;

        // Mountain mask - determines where mountains appear (using lower frequency)
        let mountain_signal = self.fbm_configurable(
            x,
            z,
            cfg.mountains.scale * 0.25, // Lower frequency for mountain regions
            2,
            0.5,
            2.0,
        );

        // Ridged mountains, masked by mountain regions. The broad uplift keeps
        // mountain ranges tall even when the sharp ridge sample is between peaks.
        let mountain_region = (mountain_signal * 3.0).clamp(0.0, 1.0).powf(1.15);
        let mountains = self.ridged_noise(x, z) * mountain_region;
        let mountain_uplift = cfg.mountains.amplitude * 1.1 * mountain_region;

        // Hills everywhere
        let hills = self.fbm_configurable(
            x,
            z,
            cfg.hills.scale,
            cfg.hills.octaves,
            cfg.hills.persistence,
            cfg.hills.lacunarity,
        ) * cfg.hills.amplitude;

        // Fine detail
        let detail = self.fbm_configurable(
            x,
            z,
            cfg.detail.scale,
            cfg.detail.octaves,
            cfg.detail.persistence,
            cfg.detail.lacunarity,
        ) * cfg.detail.amplitude;

        let height = continent + mountains + mountain_uplift + hills + detail;

        // Clamp to world bounds from config
        height.clamp(cfg.height.min, cfg.height.max) as i32
    }

    /// Calculates terrain height at a given world position.
    ///
    /// Water body bathymetry lowers terrain under lakes, ponds, and river
    /// channels before the usual water fill step runs.
    pub fn get_height(&self, world_x: i32, world_z: i32) -> i32 {
        let base_height = self.get_base_height(world_x, world_z);
        let metadata = self.get_water_generation_metadata(world_x, world_z);
        let carved_height = if metadata.is_surface_water() {
            base_height.min(metadata.bed_y)
        } else {
            base_height
        };
        carved_height.clamp(self.config.height.min as i32, self.config.height.max as i32)
    }

    pub fn get_water_generation_metadata(
        &self,
        world_x: i32,
        world_z: i32,
    ) -> WaterGenerationMetadata {
        let base_height = self.get_base_height(world_x, world_z);
        self.water_generation_metadata_for_base_height(world_x, world_z, base_height)
    }

    fn water_generation_metadata_for_base_height(
        &self,
        world_x: i32,
        world_z: i32,
        base_height: i32,
    ) -> WaterGenerationMetadata {
        let surface_y = WATER_LEVEL;
        let mut best = WaterGenerationMetadata::none(surface_y, base_height);

        if self.config.rivers.enabled {
            let carve_depth = self.river_carve(world_x as f32, world_z as f32);
            if carve_depth >= 0.05 {
                let depth = carve_depth.ceil().max(2.0) as i32;
                let bed_y = surface_y - depth;
                let local_depth = (surface_y - bed_y.min(best.bed_y)).max(depth) as f32;
                best = WaterGenerationMetadata {
                    kind: GeneratedWaterBodyKind::RiverChannel,
                    surface_y,
                    bed_y: bed_y.min(best.bed_y),
                    max_depth: local_depth.ceil() as i32,
                    local_depth,
                    strength: (carve_depth / self.config.rivers.depth.max(0.001)).clamp(0.0, 1.0),
                };
            }
        }

        if self.config.water_bodies.enabled {
            if let Some(lake) = self.sample_basin(
                world_x,
                world_z,
                base_height,
                &self.config.water_bodies.lakes,
                GeneratedWaterBodyKind::LakeBasin,
                11,
            ) {
                best = stronger_water_metadata(best, lake);
            }
            if let Some(pond) = self.sample_basin(
                world_x,
                world_z,
                base_height,
                &self.config.water_bodies.ponds,
                GeneratedWaterBodyKind::Pond,
                29,
            ) {
                best = stronger_water_metadata(best, pond);
            }
        }

        best
    }

    fn sample_basin(
        &self,
        world_x: i32,
        world_z: i32,
        base_height: i32,
        cfg: &BasinConfig,
        kind: GeneratedWaterBodyKind,
        salt: i32,
    ) -> Option<WaterGenerationMetadata> {
        if !cfg.enabled || cfg.spacing <= 1.0 || cfg.max_radius <= 0.0 || cfg.density <= 0.0 {
            return None;
        }
        if base_height > WATER_LEVEL + 1 {
            return None;
        }

        let x = world_x as f32;
        let z = world_z as f32;
        let cell_x = (x / cfg.spacing).floor() as i32;
        let cell_z = (z / cfg.spacing).floor() as i32;
        let mut best: Option<WaterGenerationMetadata> = None;

        for dz in -1..=1 {
            for dx in -1..=1 {
                let cx = cell_x + dx;
                let cz = cell_z + dz;
                let active = hash_position(
                    cx.wrapping_mul(41).wrapping_add(salt),
                    cz.wrapping_mul(73).wrapping_sub(salt),
                );
                if active > cfg.density.clamp(0.0, 1.0) {
                    continue;
                }

                let ox = hash_position(
                    cx.wrapping_mul(97).wrapping_add(salt * 3),
                    cz.wrapping_mul(37).wrapping_sub(salt * 5),
                ) - 0.5;
                let oz = hash_position(
                    cx.wrapping_mul(53).wrapping_sub(salt * 7),
                    cz.wrapping_mul(89).wrapping_add(salt * 11),
                ) - 0.5;
                let radius_t = hash_position(
                    cx.wrapping_mul(131).wrapping_add(salt * 13),
                    cz.wrapping_mul(151).wrapping_sub(salt * 17),
                );
                let depth_t = hash_position(
                    cx.wrapping_mul(173).wrapping_sub(salt * 19),
                    cz.wrapping_mul(197).wrapping_add(salt * 23),
                );

                let center_x = (cx as f32 + 0.5 + ox * 0.7) * cfg.spacing;
                let center_z = (cz as f32 + 0.5 + oz * 0.7) * cfg.spacing;
                let radius = lerp_f32(cfg.min_radius, cfg.max_radius, radius_t).max(1.0);
                let dx = x - center_x;
                let dz = z - center_z;
                let dist = (dx * dx + dz * dz).sqrt();
                if dist > radius {
                    continue;
                }

                let inward = (1.0 - dist / radius).clamp(0.0, 1.0);
                let smooth = inward * inward * (3.0 - 2.0 * inward);
                let strength = smooth.powf(cfg.shore_power.max(0.25));
                let central_depth = lerp_f32(cfg.min_depth, cfg.max_depth, depth_t).max(1.0);
                let local_depth = 1.0 + (central_depth - 1.0) * strength;
                let bed_y = WATER_LEVEL - local_depth.ceil() as i32;
                let candidate = WaterGenerationMetadata {
                    kind,
                    surface_y: WATER_LEVEL,
                    bed_y,
                    max_depth: central_depth.ceil() as i32,
                    local_depth,
                    strength,
                };
                best = Some(match best {
                    Some(current) => stronger_water_metadata(current, candidate),
                    None => candidate,
                });
            }
        }

        best
    }

    /// Determines the biome at a given world position.
    pub fn get_biome(&self, world_x: i32, world_z: i32) -> Biome {
        let x = world_x as f32;
        let z = world_z as f32;

        let biome_noise =
            self.noise
                .fbm_2d(x * TERRAIN_BIOME_FREQUENCY, z * TERRAIN_BIOME_FREQUENCY, 2);
        let detail_noise =
            self.noise
                .fbm_2d(x * TERRAIN_CAVE_FREQUENCY, z * TERRAIN_CAVE_FREQUENCY, 2);

        if biome_noise < BIOME_SANDY_THRESHOLD {
            Biome::Sandy
        } else if biome_noise > BIOME_ROCKY_THRESHOLD && detail_noise > BIOME_ROCKY_DETAIL_THRESHOLD
        {
            Biome::Rocky
        } else if biome_noise > BIOME_CLAY_MIN
            && biome_noise < BIOME_CLAY_MAX
            && detail_noise > BIOME_CLAY_DETAIL_THRESHOLD
        {
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
    pub fn is_tree_trunk(
        &self,
        world_x: i32,
        world_y: i32,
        world_z: i32,
        terrain_height: i32,
    ) -> bool {
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

    pub fn is_cave_aquifer(&self, world_x: i32, world_y: i32, world_z: i32) -> bool {
        let cfg = &self.config.water_bodies.aquifers;
        if !self.config.water_bodies.enabled || !cfg.enabled || world_y > cfg.max_y {
            return false;
        }

        let x = world_x as f32 * cfg.noise_scale;
        let y = world_y as f32 * cfg.noise_scale;
        let z = world_z as f32 * cfg.noise_scale;
        self.noise.fbm_3d(x, y, z, 3) >= cfg.threshold
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

#[inline]
fn lerp_f32(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t.clamp(0.0, 1.0)
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
        CHUNK_SIZE_I32, DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y, DEFAULT_WORLD_CHUNKS_Z,
    };
    use crate::terrain::generation::config::TerrainConfig;

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
                BIOME_CLAY_DETAIL_THRESHOLD + 0.1
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
            max_height >= 80,
            "expected tall mountain peaks, got max height {max_height}"
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
    fn test_biome_coverage() {
        let generator = TerrainGenerator::with_config(BiomeCoverageNoise, TerrainConfig::default());

        assert_eq!(generator.get_biome(0, 0), Biome::Sandy);
        assert_eq!(generator.get_biome(1000, 0), Biome::Grassland);
        assert_eq!(generator.get_biome(2000, 0), Biome::Rocky);
        assert_eq!(generator.get_biome(3000, 0), Biome::Clay);
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

        for x in 0..256 {
            for z in 0..256 {
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
    fn low_edge_ground_does_not_create_temporary_ocean_wall() {
        let mut config = TerrainConfig::default();
        config.rivers.enabled = false;
        config.water_bodies.enabled = false;
        let generator = TerrainGenerator::with_config(FlatLowNoise, config);
        let x = 0;
        let z = DEFAULT_WORLD_CHUNKS_Z * CHUNK_SIZE_I32 / 2;
        let meta = generator.get_water_generation_metadata(x, z);

        assert!(generator.get_base_height(x, z) < WATER_LEVEL);
        assert_ne!(meta.kind, GeneratedWaterBodyKind::Ocean);
        assert_eq!(
            generator.get_voxel(x, WATER_LEVEL, z),
            VoxelType::Air,
            "low world-edge ground should not create a vertical temporary ocean wall"
        );
    }

    #[test]
    fn sealed_underground_caves_do_not_default_to_water() {
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());
        let mut checked = false;

        'outer: for x in 0..256 {
            for z in 0..256 {
                let terrain_height = generator.get_height(x, z);
                for y in (CAVE_MIN_Y + 1)..WATER_LEVEL {
                    if generator.is_cave(x, y, z, terrain_height)
                        && !generator.is_cave_aquifer(x, y, z)
                    {
                        assert_eq!(
                            generator.get_voxel(x, y, z),
                            VoxelType::Air,
                            "non-aquifer cave below water level should remain air"
                        );
                        checked = true;
                        break 'outer;
                    }
                }
            }
        }

        assert!(
            checked,
            "expected to find at least one non-aquifer cave sample"
        );
    }
}
