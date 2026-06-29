use super::biome_region_field::BiomeId;
use crate::voxel::types::VoxelType;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BiomeContent {
    pub biome: BiomeId,
    pub surface: VoxelType,
    pub shallow_subsurface: VoxelType,
    pub deep_subsurface: VoxelType,
    pub near_water_surface: VoxelType,
}

impl BiomeContent {
    pub fn voxel_for_depth(self, depth: i32, near_water: bool) -> VoxelType {
        if near_water {
            return self.near_water_surface;
        }
        match depth {
            d if d <= 0 => self.surface,
            1 | 2 => self.shallow_subsurface,
            _ => self.deep_subsurface,
        }
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct BiomeContentTable;

impl BiomeContentTable {
    pub const fn new() -> Self {
        Self
    }

    pub fn content(self, biome: BiomeId) -> BiomeContent {
        match biome {
            BiomeId::Meadows => BiomeContent {
                biome,
                surface: VoxelType::TopSoil,
                shallow_subsurface: VoxelType::SubSoil,
                deep_subsurface: VoxelType::Rock,
                near_water_surface: VoxelType::Sand,
            },
            BiomeId::Forest => BiomeContent {
                biome,
                surface: VoxelType::TopSoil,
                shallow_subsurface: VoxelType::SubSoil,
                deep_subsurface: VoxelType::Rock,
                near_water_surface: VoxelType::Sand,
            },
            BiomeId::Swamp => BiomeContent {
                biome,
                surface: VoxelType::Clay,
                shallow_subsurface: VoxelType::SubSoil,
                deep_subsurface: VoxelType::SubSoil,
                near_water_surface: VoxelType::Sand,
            },
            BiomeId::Mountain => BiomeContent {
                biome,
                surface: VoxelType::Rock,
                shallow_subsurface: VoxelType::Rock,
                deep_subsurface: VoxelType::Rock,
                near_water_surface: VoxelType::Rock,
            },
            BiomeId::Plains => BiomeContent {
                biome,
                surface: VoxelType::TopSoil,
                shallow_subsurface: VoxelType::SubSoil,
                deep_subsurface: VoxelType::Rock,
                near_water_surface: VoxelType::Sand,
            },
            BiomeId::Coast => BiomeContent {
                biome,
                surface: VoxelType::Sand,
                shallow_subsurface: VoxelType::Sand,
                deep_subsurface: VoxelType::Rock,
                near_water_surface: VoxelType::Sand,
            },
            BiomeId::Ocean => BiomeContent {
                biome,
                surface: VoxelType::Sand,
                shallow_subsurface: VoxelType::Sand,
                deep_subsurface: VoxelType::Clay,
                near_water_surface: VoxelType::Sand,
            },
        }
    }

    pub fn voxel_for_depth(self, biome: BiomeId, depth: i32, near_water: bool) -> VoxelType {
        self.content(biome).voxel_for_depth(depth, near_water)
    }
}

pub const BIOME_CONTENT_TABLE: BiomeContentTable = BiomeContentTable::new();

#[cfg(test)]
mod tests {
    use super::*;

    fn all_biomes() -> [BiomeId; 7] {
        [
            BiomeId::Meadows,
            BiomeId::Forest,
            BiomeId::Swamp,
            BiomeId::Mountain,
            BiomeId::Plains,
            BiomeId::Coast,
            BiomeId::Ocean,
        ]
    }

    #[test]
    fn table_defines_content_for_all_seven_biomes() {
        let table = BiomeContentTable::new();
        for biome in all_biomes() {
            let content = table.content(biome);
            assert_eq!(content.biome, biome);
            assert_ne!(
                content.surface,
                VoxelType::Air,
                "{biome:?} missing surface content"
            );
            assert_ne!(
                content.shallow_subsurface,
                VoxelType::Air,
                "{biome:?} missing shallow content"
            );
            assert_ne!(
                content.deep_subsurface,
                VoxelType::Air,
                "{biome:?} missing deep content"
            );
            assert_ne!(
                content.near_water_surface,
                VoxelType::Air,
                "{biome:?} missing near-water content"
            );
        }
    }

    #[test]
    fn table_preserves_legacy_bridge_surface_expectations() {
        let table = BiomeContentTable::new();
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
            assert_eq!(
                table.voxel_for_depth(biome, 0, false),
                expected,
                "{biome:?}"
            );
        }
    }

    #[test]
    fn near_water_uses_explicit_biome_content_not_a_hidden_fallback() {
        let table = BiomeContentTable::new();
        assert_eq!(
            table.voxel_for_depth(BiomeId::Mountain, 0, true),
            VoxelType::Rock
        );
        assert_eq!(
            table.voxel_for_depth(BiomeId::Meadows, 0, true),
            VoxelType::Sand
        );
        assert_eq!(
            table.voxel_for_depth(BiomeId::Swamp, 0, true),
            VoxelType::Sand
        );
    }
}
