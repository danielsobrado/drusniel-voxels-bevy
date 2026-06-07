use super::*;

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

impl<N: NoiseGenerator> TerrainGenerator<N> {
    pub fn get_biome(&self, world_x: i32, world_z: i32) -> Biome {
        if let Some(profile) = self.shoreline_profile(world_x, world_z) {
            return match profile.kind {
                ShorelineKind::Beach => Biome::Sandy,
                ShorelineKind::Cliff => Biome::Rocky,
            };
        }

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

    /// Determines the voxel type based on biome, depth, and water proximity.
    pub(crate) fn get_biome_voxel(&self, biome: Biome, depth: i32, near_water: bool) -> VoxelType {
        match biome {
            Biome::Sandy => {
                if depth <= 2 {
                    VoxelType::Sand
                } else if depth <= 5 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
            Biome::Rocky => {
                if depth <= 1 {
                    VoxelType::Rock
                } else if depth <= 2 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
            Biome::Clay => {
                if near_water {
                    if depth <= 1 {
                        VoxelType::Sand
                    } else if depth <= 4 {
                        VoxelType::Clay
                    } else {
                        VoxelType::Rock
                    }
                } else if depth <= 1 {
                    VoxelType::TopSoil
                } else if depth <= 4 {
                    VoxelType::Clay
                } else if depth <= 7 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
            Biome::Grassland => {
                if near_water {
                    if depth <= BEACH_HEIGHT_OFFSET {
                        VoxelType::Sand
                    } else if depth <= 3 {
                        VoxelType::SubSoil
                    } else {
                        VoxelType::Rock
                    }
                } else if depth == 0 {
                    VoxelType::TopSoil
                } else if depth <= 2 {
                    VoxelType::SubSoil
                } else {
                    VoxelType::Rock
                }
            }
        }
    }
}
