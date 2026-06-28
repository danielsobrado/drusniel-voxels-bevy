use crate::voxel::materials::MaterialId;

use super::BiomeId;

const BASE_MASK: u16 = 0x00ff;
const BIOME_SHIFT: u16 = 8;

pub fn material_with_biome(base: MaterialId, biome: BiomeId) -> MaterialId {
    MaterialId((base.0 & BASE_MASK) | (((biome.layer_index() as u16) + 1) << BIOME_SHIFT))
}

pub fn material_base(material: MaterialId) -> MaterialId {
    MaterialId(material.0 & BASE_MASK)
}

pub fn material_biome(material: MaterialId) -> Option<BiomeId> {
    match (material.0 >> BIOME_SHIFT).checked_sub(1)? as u8 {
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
