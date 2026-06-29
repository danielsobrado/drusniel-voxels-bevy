use std::sync::OnceLock;

use crate::voxel::chunk::Chunk;
use crate::voxel::materials::MaterialId;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use crate::world::source::{
    BiomeId, ProceduralWorldSource, TerrainSourceConfig, WorldSource, material_biome,
};
use bevy::prelude::{IVec3, UVec3, Vec3};

struct MeshBiomeSource {
    config: TerrainSourceConfig,
    source: ProceduralWorldSource,
}

pub(crate) fn encode_biome_id_for_uv(biome: BiomeId) -> f32 {
    biome.layer_index() as f32
}

pub(crate) fn source_or_compatibility_biome_id_for_uv(
    local_pos: Vec3,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
    fallback_weights: [f32; 4],
) -> f32 {
    let biome = source_biome_from_neighbor_materials(local_pos, chunk, world, chunk_origin)
        .or_else(|| active_world_source_biome(local_pos, chunk_origin))
        .unwrap_or_else(|| compatibility_biome_from_triplanar_weights(fallback_weights));
    encode_biome_id_for_uv(biome)
}

fn mesh_biome_source() -> &'static MeshBiomeSource {
    static SOURCE: OnceLock<MeshBiomeSource> = OnceLock::new();
    SOURCE.get_or_init(|| MeshBiomeSource {
        config: TerrainSourceConfig::load_or_default(),
        source: ProceduralWorldSource::load_or_default(),
    })
}

fn active_world_source_biome(local_pos: Vec3, chunk_origin: IVec3) -> Option<BiomeId> {
    let source = mesh_biome_source();
    if source.config.is_legacy() {
        return None;
    }

    let world_pos = chunk_origin.as_vec3() + local_pos;
    Some(source.source.sample_biome(world_pos.x, world_pos.z))
}

fn source_biome_from_neighbor_materials(
    local_pos: Vec3,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
) -> Option<BiomeId> {
    let mut counts = [0u8; 7];
    let base_x = local_pos.x.floor() as i32;
    let base_y = local_pos.y.floor() as i32;
    let base_z = local_pos.z.floor() as i32;

    for dz in 0..2 {
        for dy in 0..2 {
            for dx in 0..2 {
                let local = IVec3::new(base_x + dx, base_y + dy, base_z + dz);
                let Some(material) =
                    terrain_material_at_neighbor(local, chunk, world, chunk_origin)
                else {
                    continue;
                };
                if let Some(biome) = material_biome(material) {
                    counts[biome.layer_index() as usize] += 1;
                }
            }
        }
    }

    let (best_index, best_count) = counts
        .iter()
        .copied()
        .enumerate()
        .max_by_key(|(_, count)| *count)?;
    if best_count == 0 {
        return None;
    }

    match best_index {
        0 => Some(BiomeId::Meadows),
        1 => Some(BiomeId::Forest),
        2 => Some(BiomeId::Swamp),
        3 => Some(BiomeId::Mountain),
        4 => Some(BiomeId::Plains),
        5 => Some(BiomeId::Coast),
        6 => Some(BiomeId::Ocean),
        _ => None,
    }
}

fn terrain_material_at_neighbor(
    local: IVec3,
    chunk: &Chunk,
    world: &VoxelWorld,
    chunk_origin: IVec3,
) -> Option<MaterialId> {
    if local.x >= 0 && local.x < 16 && local.y >= 0 && local.y < 16 && local.z >= 0 && local.z < 16
    {
        let local = UVec3::new(local.x as u32, local.y as u32, local.z as u32);
        let voxel = chunk.get(local);
        if voxel == VoxelType::Air || voxel == VoxelType::Water {
            return None;
        }
        return Some(chunk.get_material_id(local));
    }

    let world_pos = chunk_origin + local;
    let voxel = world.get_voxel(world_pos)?;
    if voxel == VoxelType::Air || voxel == VoxelType::Water {
        return None;
    }
    world.get_material_id(world_pos)
}

pub(crate) fn compatibility_biome_from_triplanar_weights(weights: [f32; 4]) -> BiomeId {
    let mut best = 0usize;
    for index in 1..weights.len() {
        if weights[index] > weights[best] {
            best = index;
        }
    }

    match best {
        1 => BiomeId::Mountain,
        2 => BiomeId::Coast,
        3 => BiomeId::Swamp,
        _ => BiomeId::Meadows,
    }
}

pub(crate) fn compatibility_biome_id_for_uv(weights: [f32; 4]) -> f32 {
    encode_biome_id_for_uv(compatibility_biome_from_triplanar_weights(weights))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::material_with_biome;

    #[test]
    fn encodes_biome_id_as_exact_float_for_shader_uv_channel() {
        assert_eq!(encode_biome_id_for_uv(BiomeId::Meadows), 0.0);
        assert_eq!(encode_biome_id_for_uv(BiomeId::Forest), 1.0);
        assert_eq!(encode_biome_id_for_uv(BiomeId::Swamp), 2.0);
        assert_eq!(encode_biome_id_for_uv(BiomeId::Mountain), 3.0);
        assert_eq!(encode_biome_id_for_uv(BiomeId::Plains), 4.0);
        assert_eq!(encode_biome_id_for_uv(BiomeId::Coast), 5.0);
        assert_eq!(encode_biome_id_for_uv(BiomeId::Ocean), 6.0);
    }

    #[test]
    fn maps_legacy_triplanar_weights_to_named_compatibility_biomes() {
        assert_eq!(
            compatibility_biome_from_triplanar_weights([1.0, 0.0, 0.0, 0.0]),
            BiomeId::Meadows
        );
        assert_eq!(
            compatibility_biome_from_triplanar_weights([0.0, 1.0, 0.0, 0.0]),
            BiomeId::Mountain
        );
        assert_eq!(
            compatibility_biome_from_triplanar_weights([0.0, 0.0, 1.0, 0.0]),
            BiomeId::Coast
        );
        assert_eq!(
            compatibility_biome_from_triplanar_weights([0.0, 0.0, 0.0, 1.0]),
            BiomeId::Swamp
        );
    }

    #[test]
    fn compatibility_adapter_is_explicitly_not_full_seven_biome_content() {
        let mapped = [
            compatibility_biome_from_triplanar_weights([1.0, 0.0, 0.0, 0.0]),
            compatibility_biome_from_triplanar_weights([0.0, 1.0, 0.0, 0.0]),
            compatibility_biome_from_triplanar_weights([0.0, 0.0, 1.0, 0.0]),
            compatibility_biome_from_triplanar_weights([0.0, 0.0, 0.0, 1.0]),
        ];

        assert!(!mapped.contains(&BiomeId::Forest));
        assert!(!mapped.contains(&BiomeId::Plains));
        assert!(!mapped.contains(&BiomeId::Ocean));
    }

    #[test]
    fn source_material_tags_override_active_world_source_and_compatibility_adapter() {
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(0, 0, 0), VoxelType::TopSoil);
        chunk.set_material_id(
            UVec3::new(0, 0, 0),
            material_with_biome(MaterialId::from_voxel(VoxelType::TopSoil), BiomeId::Forest),
        );
        let world = VoxelWorld::new(IVec3::ONE);

        assert_eq!(
            source_or_compatibility_biome_id_for_uv(
                Vec3::ZERO,
                &chunk,
                &world,
                IVec3::ZERO,
                [0.0, 1.0, 0.0, 0.0],
            ),
            encode_biome_id_for_uv(BiomeId::Forest),
        );
    }

    #[test]
    fn active_world_source_overrides_legacy_weights_when_no_material_tags_exist() {
        let chunk = Chunk::new(IVec3::ZERO);
        let world = VoxelWorld::new(IVec3::ONE);
        let expected = ProceduralWorldSource::load_or_default().sample_biome(0.0, 0.0);

        assert_eq!(
            source_or_compatibility_biome_id_for_uv(
                Vec3::ZERO,
                &chunk,
                &world,
                IVec3::ZERO,
                [0.0, 1.0, 0.0, 0.0],
            ),
            encode_biome_id_for_uv(expected),
        );
    }
}
