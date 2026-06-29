use serde::{Deserialize, Serialize};

use super::biome_region_field::BiomeId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MaterialLayerId {
    Grass = 0,
    ForestFloor = 1,
    Mud = 2,
    Rock = 3,
    DryGrass = 4,
    Sand = 5,
    OceanBed = 6,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BiomeSplatSample {
    pub layers: [MaterialLayerId; 4],
    pub weights: [f32; 4],
}

impl BiomeSplatSample {
    pub fn dominant_layer(self) -> MaterialLayerId {
        let mut best = 0;
        for index in 1..self.weights.len() {
            if self.weights[index] > self.weights[best] {
                best = index;
            }
        }
        self.layers[best]
    }

    pub fn normalized(mut self) -> Self {
        let sum: f32 = self.weights.iter().sum();
        if sum <= f32::EPSILON {
            self.weights = [1.0, 0.0, 0.0, 0.0];
            return self;
        }
        for weight in &mut self.weights {
            *weight = (*weight / sum).clamp(0.0, 1.0);
        }
        self
    }

    pub fn triplanar_weights(self) -> [f32; 4] {
        let mut weights = [0.0; 4];
        for (layer, weight) in self.layers.into_iter().zip(self.weights) {
            let index = layer.triplanar_weight_index();
            weights[index] += weight;
        }
        normalize_weights4(weights)
    }
}

impl MaterialLayerId {
    pub fn triplanar_weight_index(self) -> usize {
        match self {
            MaterialLayerId::Rock => 1,
            MaterialLayerId::Sand | MaterialLayerId::OceanBed => 2,
            MaterialLayerId::Mud => 3,
            MaterialLayerId::Grass | MaterialLayerId::ForestFloor | MaterialLayerId::DryGrass => 0,
        }
    }
}

fn normalize_weights4(mut weights: [f32; 4]) -> [f32; 4] {
    let sum: f32 = weights.iter().sum();
    if sum <= f32::EPSILON {
        return [1.0, 0.0, 0.0, 0.0];
    }
    for weight in &mut weights {
        *weight = (*weight / sum).clamp(0.0, 1.0);
    }
    weights
}

pub fn sample_biome_splat(
    biome: BiomeId,
    height: f32,
    sea_level: f32,
    slope: f32,
) -> BiomeSplatSample {
    let rock_weight = ((slope - 0.55) / 0.35).clamp(0.0, 1.0);
    let shore_weight = ((sea_level + 5.0 - height) / 9.0).clamp(0.0, 1.0);

    match biome {
        BiomeId::Ocean => BiomeSplatSample {
            layers: [
                MaterialLayerId::OceanBed,
                MaterialLayerId::Sand,
                MaterialLayerId::Rock,
                MaterialLayerId::Mud,
            ],
            weights: [1.0 - shore_weight * 0.35, shore_weight * 0.35, 0.0, 0.0],
        }
        .normalized(),
        BiomeId::Coast => BiomeSplatSample {
            layers: [
                MaterialLayerId::Sand,
                MaterialLayerId::Rock,
                MaterialLayerId::Grass,
                MaterialLayerId::Mud,
            ],
            weights: [1.0 - rock_weight * 0.45, rock_weight * 0.45, 0.0, 0.0],
        }
        .normalized(),
        BiomeId::Mountain => BiomeSplatSample {
            layers: [
                MaterialLayerId::Rock,
                MaterialLayerId::Grass,
                MaterialLayerId::ForestFloor,
                MaterialLayerId::Sand,
            ],
            weights: [
                0.72 + rock_weight * 0.28,
                (1.0 - rock_weight) * 0.2,
                (1.0 - rock_weight) * 0.08,
                0.0,
            ],
        }
        .normalized(),
        BiomeId::Swamp => BiomeSplatSample {
            layers: [
                MaterialLayerId::Mud,
                MaterialLayerId::ForestFloor,
                MaterialLayerId::Grass,
                MaterialLayerId::Sand,
            ],
            weights: [0.68, 0.22, 0.1, 0.0],
        }
        .normalized(),
        BiomeId::Plains => BiomeSplatSample {
            layers: [
                MaterialLayerId::DryGrass,
                MaterialLayerId::Grass,
                MaterialLayerId::Sand,
                MaterialLayerId::Rock,
            ],
            weights: [0.72, 0.2, 0.08, rock_weight * 0.12],
        }
        .normalized(),
        BiomeId::Forest => BiomeSplatSample {
            layers: [
                MaterialLayerId::ForestFloor,
                MaterialLayerId::Grass,
                MaterialLayerId::Rock,
                MaterialLayerId::Mud,
            ],
            weights: [0.72, 0.2 * (1.0 - rock_weight), rock_weight * 0.18, 0.0],
        }
        .normalized(),
        BiomeId::Meadows => BiomeSplatSample {
            layers: [
                MaterialLayerId::Grass,
                MaterialLayerId::ForestFloor,
                MaterialLayerId::Sand,
                MaterialLayerId::Rock,
            ],
            weights: [
                0.78 - shore_weight * 0.3,
                0.14,
                shore_weight * 0.3,
                rock_weight * 0.08,
            ],
        }
        .normalized(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WGSL: &str = include_str!("../../../assets/shaders/world_source/biome_splat.wgsl");
    const TRIPLANAR_WGSL: &str = include_str!("../../../assets/shaders/triplanar_terrain.wgsl");

    fn all_biomes() -> [BiomeId; 7] {
        [
            BiomeId::Ocean,
            BiomeId::Coast,
            BiomeId::Meadows,
            BiomeId::Forest,
            BiomeId::Swamp,
            BiomeId::Mountain,
            BiomeId::Plains,
        ]
    }

    #[test]
    fn weights_are_normalized() {
        for biome in all_biomes() {
            let sample = sample_biome_splat(biome, 32.0, 18.0, 0.7);
            let sum: f32 = sample.weights.iter().sum();
            assert!((sum - 1.0).abs() < 0.0001, "{biome:?} weights sum to {sum}");
        }
    }

    #[test]
    fn biome_maps_to_expected_dominant_layer() {
        assert_eq!(
            sample_biome_splat(BiomeId::Ocean, 10.0, 18.0, 0.1).dominant_layer(),
            MaterialLayerId::OceanBed
        );
        assert_eq!(
            sample_biome_splat(BiomeId::Coast, 18.0, 18.0, 0.1).dominant_layer(),
            MaterialLayerId::Sand
        );
        assert_eq!(
            sample_biome_splat(BiomeId::Mountain, 100.0, 18.0, 0.8).dominant_layer(),
            MaterialLayerId::Rock
        );
    }

    #[test]
    fn triplanar_weights_are_normalized() {
        for biome in all_biomes() {
            let sample = sample_biome_splat(biome, 32.0, 18.0, 0.7);
            let sum: f32 = sample.triplanar_weights().iter().sum();
            assert!(
                (sum - 1.0).abs() < 0.0001,
                "{biome:?} triplanar weights sum to {sum}"
            );
        }
    }

    #[test]
    fn rust_material_layer_ids_match_wgsl() {
        for (name, id) in [
            ("MATERIAL_GRASS", MaterialLayerId::Grass as u32),
            ("MATERIAL_FOREST_FLOOR", MaterialLayerId::ForestFloor as u32),
            ("MATERIAL_MUD", MaterialLayerId::Mud as u32),
            ("MATERIAL_ROCK", MaterialLayerId::Rock as u32),
            ("MATERIAL_DRY_GRASS", MaterialLayerId::DryGrass as u32),
            ("MATERIAL_SAND", MaterialLayerId::Sand as u32),
            ("MATERIAL_OCEAN_BED", MaterialLayerId::OceanBed as u32),
        ] {
            assert!(
                WGSL.contains(&format!("const {name} : u32 = {id}u;")),
                "missing WGSL constant {name}={id}"
            );
        }
    }

    #[test]
    fn wgsl_contains_gpu_splat_entry_points() {
        assert!(WGSL.contains("fn biome_splat_sample"));
        assert!(WGSL.contains("fn biome_splat_to_triplanar_weights"));
        assert!(WGSL.contains("fn biome_splat_resolve_triplanar_weights"));
    }

    #[test]
    fn triplanar_shader_uses_gpu_biome_splat_path() {
        assert!(TRIPLANAR_WGSL.contains("shaders/world_source/biome_splat.wgsl"));
        assert!(TRIPLANAR_WGSL.contains("biome_splat_resolve_triplanar_weights"));
        assert!(TRIPLANAR_WGSL.contains("terrain_biome_id"));
        assert!(TRIPLANAR_WGSL.contains("in.uv.y"));
        assert!(TRIPLANAR_WGSL.contains("legacy_w"));
    }
}
