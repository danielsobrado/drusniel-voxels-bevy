use bevy::prelude::{IVec3, UVec3};

use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32, CHUNK_VOLUME};
use crate::voxel::chunk::Chunk;
use crate::voxel::materials::MaterialId;
use crate::voxel::types::VoxelType;
use crate::world::source::{material_with_biome, WorldSource, WorldSourceTerrainBridge};

pub(crate) fn build_world_source_chunk<S: WorldSource>(
    chunk_pos: IVec3,
    bridge: &WorldSourceTerrainBridge<S>,
) -> Chunk {
    let voxels = fill_world_source_chunk_voxels(chunk_pos, bridge);
    let mut chunk = Chunk::with_voxels(chunk_pos, voxels);
    tag_world_source_chunk_biomes(&mut chunk, bridge);
    chunk
}

pub(crate) fn fill_world_source_chunk_voxels<S: WorldSource>(
    chunk_pos: IVec3,
    bridge: &WorldSourceTerrainBridge<S>,
) -> [VoxelType; CHUNK_VOLUME] {
    let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
    let chunk_world_y = chunk_pos.y * CHUNK_SIZE_I32;
    let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;
    let mut voxels = [VoxelType::Air; CHUNK_VOLUME];

    for z in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                let world_x = chunk_world_x + x as i32;
                let world_y = chunk_world_y + y as i32;
                let world_z = chunk_world_z + z as i32;
                let local = UVec3::new(x as u32, y as u32, z as u32);
                voxels[Chunk::index(local.x as usize, local.y as usize, local.z as usize)] =
                    bridge.get_voxel(world_x, world_y, world_z);
            }
        }
    }

    voxels
}

fn tag_world_source_chunk_biomes<S: WorldSource>(
    chunk: &mut Chunk,
    bridge: &WorldSourceTerrainBridge<S>,
) {
    let chunk_pos = chunk.position();
    let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
    let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;

    for z in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                let local = UVec3::new(x as u32, y as u32, z as u32);
                let voxel = chunk.get(local);
                if !should_tag_biome(voxel) {
                    continue;
                }

                let world_x = chunk_world_x + x as i32;
                let world_z = chunk_world_z + z as i32;
                let biome = bridge.biome(world_x, world_z);
                let material_id = material_with_biome(MaterialId::from_voxel(voxel), biome);
                chunk.set_material_id(local, material_id);
            }
        }
    }
}

fn should_tag_biome(voxel: VoxelType) -> bool {
    voxel != VoxelType::Air && voxel != VoxelType::Water
}

#[cfg(test)]
pub(crate) struct VoxelValueRef(VoxelType);

#[cfg(test)]
impl std::ops::Deref for VoxelValueRef {
    type Target = VoxelType;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

#[cfg(test)]
impl Chunk {
    pub(crate) fn iter_voxels(&self) -> impl Iterator<Item = VoxelValueRef> + '_ {
        self.iter().map(|(_, voxel)| VoxelValueRef(voxel))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{
        material_base, material_biome, BiomeId, IslandShapeConfig, TerrainFieldConfig,
        WorldSourceBounds, WorldSourceMetadata,
    };

    #[derive(Debug, Clone)]
    struct FixedBiomeSource {
        metadata: WorldSourceMetadata,
        biome: BiomeId,
    }

    impl FixedBiomeSource {
        fn new(biome: BiomeId) -> Self {
            let terrain = TerrainFieldConfig::new(11, 18.0, IslandShapeConfig::default());
            Self {
                metadata: WorldSourceMetadata {
                    seed: terrain.seed,
                    sea_level: terrain.sea_level,
                    bounds: WorldSourceBounds::Infinite,
                    ocean_rim: false,
                    terrain,
                },
                biome,
            }
        }
    }

    impl WorldSource for FixedBiomeSource {
        fn metadata(&self) -> &WorldSourceMetadata {
            &self.metadata
        }

        fn sample_height(&self, _x: f32, _z: f32) -> f32 {
            32.0
        }

        fn sample_biome(&self, _x: f32, _z: f32) -> BiomeId {
            self.biome
        }

        fn ocean_mask(&self, _x: f32, _z: f32) -> f32 {
            1.0
        }
    }

    #[test]
    fn world_source_chunk_tags_solid_voxels_with_true_biome_id() {
        let bridge = WorldSourceTerrainBridge::new(FixedBiomeSource::new(BiomeId::Forest));
        let chunk = build_world_source_chunk(IVec3::ZERO, &bridge);
        let local = UVec3::new(0, 15, 0);
        let material = chunk.get_material_id(local);

        assert_eq!(material_biome(material), Some(BiomeId::Forest));
        assert_eq!(material_base(material), MaterialId::from_voxel(chunk.get(local)));
    }

    #[test]
    fn world_source_chunk_does_not_tag_air_or_water() {
        let bridge = WorldSourceTerrainBridge::new(FixedBiomeSource::new(BiomeId::Ocean));
        let chunk = build_world_source_chunk(IVec3::new(0, 3, 0), &bridge);
        let local = UVec3::new(0, 15, 0);

        assert!(matches!(chunk.get(local), VoxelType::Air | VoxelType::Water));
        assert_eq!(material_biome(chunk.get_material_id(local)), None);
    }
}
