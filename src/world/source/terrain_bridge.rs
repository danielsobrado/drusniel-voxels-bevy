use crate::constants::{BEACH_HEIGHT_OFFSET, BEDROCK_DEPTH};
use crate::voxel::types::VoxelType;

use super::biome_content::BIOME_CONTENT_TABLE;
use super::biome_region_field::BiomeId;
use super::world_source::{ProceduralWorldSource, WorldSource};

pub type ProceduralWorldSourceTerrainBridge = WorldSourceTerrainBridge<ProceduralWorldSource>;

#[derive(Debug, Clone)]
pub struct WorldSourceTerrainBridge<S: WorldSource> {
    source: S,
}

impl<S: WorldSource> WorldSourceTerrainBridge<S> {
    pub fn new(source: S) -> Self {
        Self { source }
    }

    pub fn source(&self) -> &S {
        &self.source
    }

    pub fn surface_height_i32(&self, world_x: i32, world_z: i32) -> i32 {
        self.source
            .sample_height(world_x as f32, world_z as f32)
            .round()
            .clamp(BEDROCK_DEPTH as f32 + 1.0, i32::MAX as f32) as i32
    }

    pub fn biome(&self, world_x: i32, world_z: i32) -> BiomeId {
        self.source.sample_biome(world_x as f32, world_z as f32)
    }

    pub fn surface_material(&self, biome: BiomeId, depth: i32, near_water: bool) -> VoxelType {
        BIOME_CONTENT_TABLE.voxel_for_depth(biome, depth, near_water)
    }

    pub fn get_voxel(&self, world_x: i32, world_y: i32, world_z: i32) -> VoxelType {
        if world_y <= BEDROCK_DEPTH {
            return VoxelType::Bedrock;
        }

        let height = self.surface_height_i32(world_x, world_z);
        let sea_level = self.source.metadata().sea_level.round() as i32;
        if world_y > height {
            return if world_y <= sea_level {
                VoxelType::Water
            } else {
                VoxelType::Air
            };
        }

        let biome = self.biome(world_x, world_z);
        let depth = height - world_y;
        let near_water = height <= sea_level + BEACH_HEIGHT_OFFSET;
        self.surface_material(biome, depth, near_water)
    }
}

impl WorldSourceTerrainBridge<ProceduralWorldSource> {
    pub fn load_or_default() -> Self {
        Self::new(ProceduralWorldSource::load_or_default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::island_shape::IslandShapeConfig;
    use crate::world::source::world_source::{
        TerrainFieldConfig, WorldSourceBounds, WorldSourceMetadata,
    };

    #[derive(Debug, Clone)]
    struct FixedSource {
        metadata: WorldSourceMetadata,
        height: f32,
        biome: BiomeId,
    }

    impl FixedSource {
        fn new(height: f32, sea_level: f32, biome: BiomeId) -> Self {
            let terrain = TerrainFieldConfig::new(7, sea_level, IslandShapeConfig::default());
            Self {
                metadata: WorldSourceMetadata {
                    seed: terrain.seed,
                    sea_level,
                    bounds: WorldSourceBounds::Infinite,
                    ocean_rim: false,
                    terrain,
                },
                height,
                biome,
            }
        }
    }

    impl WorldSource for FixedSource {
        fn metadata(&self) -> &WorldSourceMetadata {
            &self.metadata
        }

        fn sample_height(&self, _x: f32, _z: f32) -> f32 {
            self.height
        }

        fn sample_biome(&self, _x: f32, _z: f32) -> BiomeId {
            self.biome
        }

        fn ocean_mask(&self, _x: f32, _z: f32) -> f32 {
            0.0
        }
    }

    #[test]
    fn bridge_fills_water_above_underwater_surface() {
        let bridge = WorldSourceTerrainBridge::new(FixedSource::new(10.0, 18.0, BiomeId::Ocean));

        assert_eq!(bridge.get_voxel(0, 11, 0), VoxelType::Water);
        assert_eq!(bridge.get_voxel(0, 19, 0), VoxelType::Air);
    }

    #[test]
    fn bridge_maps_biomes_to_content_table_materials() {
        let cases = [
            (BiomeId::Meadows, VoxelType::TopSoil),
            (BiomeId::Forest, VoxelType::TopSoil),
            (BiomeId::Plains, VoxelType::TopSoil),
            (BiomeId::Swamp, VoxelType::Clay),
            (BiomeId::Mountain, VoxelType::Rock),
            (BiomeId::Coast, VoxelType::Sand),
            (BiomeId::Ocean, VoxelType::Sand),
        ];

        for (biome, expected) in cases {
            let bridge = WorldSourceTerrainBridge::new(FixedSource::new(32.0, 18.0, biome));
            assert_eq!(bridge.get_voxel(0, 32, 0), expected, "{biome:?}");
            assert_eq!(
                bridge.surface_material(biome, 0, false),
                BIOME_CONTENT_TABLE.voxel_for_depth(biome, 0, false),
                "{biome:?} must come from the content table"
            );
        }
    }

    #[test]
    fn bridge_preserves_bedrock_floor() {
        let bridge = WorldSourceTerrainBridge::new(FixedSource::new(32.0, 18.0, BiomeId::Meadows));
        assert_eq!(bridge.get_voxel(0, BEDROCK_DEPTH, 0), VoxelType::Bedrock);
    }
}
