use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};

use super::biome_region_field::{BiomeId, BiomeRegionField};
use super::island_shape::{sample_island_mask, IslandShapeConfig};
use super::height_field::base_surface_height;

pub const DEFAULT_TERRAIN_SEED: i32 = 0;
pub const DEFAULT_SEA_LEVEL: f32 = 18.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TerrainFieldConfig {
    pub seed: i32,
    pub sea_level: f32,
    pub island_shape: IslandShapeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum WorldSourceBounds {
    Infinite,
    RadiusM(f32),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorldSourceMetadata {
    pub seed: i32,
    pub sea_level: f32,
    pub bounds: WorldSourceBounds,
    pub ocean_rim: bool,
    pub terrain: TerrainFieldConfig,
}

pub trait WorldSource {
    fn metadata(&self) -> &WorldSourceMetadata;
    fn sample_height(&self, x: f32, z: f32) -> f32;
    fn sample_biome(&self, x: f32, z: f32) -> BiomeId;
    fn ocean_mask(&self, x: f32, z: f32) -> f32;
}

#[derive(Resource, Debug, Clone)]
pub struct ProceduralWorldSource {
    metadata: WorldSourceMetadata,
    biomes: BiomeRegionField,
}

impl TerrainFieldConfig {
    pub fn new(seed: i32, sea_level: f32, island_shape: IslandShapeConfig) -> Self {
        let mut island_shape = island_shape.sanitized();
        island_shape.sea_level = sea_level;
        Self { seed, sea_level, island_shape }
    }
}

impl Default for TerrainFieldConfig {
    fn default() -> Self {
        Self::new(DEFAULT_TERRAIN_SEED, DEFAULT_SEA_LEVEL, IslandShapeConfig::default())
    }
}

impl ProceduralWorldSource {
    pub fn new(terrain: TerrainFieldConfig) -> Self {
        let bounds = if terrain.island_shape.ocean_rim {
            WorldSourceBounds::RadiusM(terrain.island_shape.world_radius_m)
        } else {
            WorldSourceBounds::Infinite
        };
        let metadata = WorldSourceMetadata {
            seed: terrain.seed,
            sea_level: terrain.sea_level,
            bounds,
            ocean_rim: terrain.island_shape.ocean_rim,
            terrain: terrain.clone(),
        };
        let biomes = BiomeRegionField::new(terrain.seed, terrain.sea_level, terrain.island_shape.clone());
        Self { metadata, biomes }
    }

    pub fn biome_field(&self) -> &BiomeRegionField {
        &self.biomes
    }
}

impl Default for ProceduralWorldSource {
    fn default() -> Self {
        Self::new(TerrainFieldConfig::default())
    }
}

impl WorldSource for ProceduralWorldSource {
    fn metadata(&self) -> &WorldSourceMetadata {
        &self.metadata
    }

    fn sample_height(&self, x: f32, z: f32) -> f32 {
        base_surface_height(x, z, &self.metadata.terrain)
    }

    fn sample_biome(&self, x: f32, z: f32) -> BiomeId {
        self.biomes.sample(x, z, self.sample_height(x, z)).biome
    }

    fn ocean_mask(&self, x: f32, z: f32) -> f32 {
        let height = self.sample_height(x, z);
        let island = sample_island_mask(x, z, &self.metadata.terrain.island_shape);
        if height < self.metadata.sea_level {
            1.0
        } else {
            (1.0 - island.mask).clamp(0.0, 1.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn procedural_world_source_is_deterministic() {
        let source = ProceduralWorldSource::default();
        let a = source.sample_height(512.0, -128.0);
        let b = source.sample_height(512.0, -128.0);
        assert_eq!(a, b);
        assert_eq!(source.sample_biome(512.0, -128.0), source.sample_biome(512.0, -128.0));
    }

    #[test]
    fn ocean_rim_sets_bounded_metadata() {
        let source = ProceduralWorldSource::new(TerrainFieldConfig::new(
            0,
            18.0,
            IslandShapeConfig { ocean_rim: true, ..IslandShapeConfig::default() },
        ));
        assert!(matches!(source.metadata().bounds, WorldSourceBounds::RadiusM(_)));
        assert!(source.metadata().ocean_rim);
    }
}
