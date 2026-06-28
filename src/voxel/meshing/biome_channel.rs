use crate::world::source::BiomeId;

pub(crate) fn encode_biome_id_for_uv(biome: BiomeId) -> f32 {
    biome.layer_index() as f32
}

/// Temporary adapter while Surface Nets still receives four legacy triplanar
/// weights instead of true seven-biome WorldSource IDs.
///
/// TODO(BVY-WS-08 follow-up): replace callers with source-aware biome IDs once
/// meshing has direct WorldSource biome samples at each emitted vertex.
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
        assert_eq!(compatibility_biome_from_triplanar_weights([1.0, 0.0, 0.0, 0.0]), BiomeId::Meadows);
        assert_eq!(compatibility_biome_from_triplanar_weights([0.0, 1.0, 0.0, 0.0]), BiomeId::Mountain);
        assert_eq!(compatibility_biome_from_triplanar_weights([0.0, 0.0, 1.0, 0.0]), BiomeId::Coast);
        assert_eq!(compatibility_biome_from_triplanar_weights([0.0, 0.0, 0.0, 1.0]), BiomeId::Swamp);
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
}
