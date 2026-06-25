use super::noise::sample_terrain_height_with_world_shape;
use super::world_shape::{CoastSurfaceClass, OceanClass, WorldShapeSampler};
use super::TerrainConfig;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FarFieldTerrainSample {
    pub height: f32,
    pub ocean_class: OceanClass,
    pub coast_surface: CoastSurfaceClass,
    pub coast_distance_m: f32,
    pub water_surface_y: Option<f32>,
}

pub fn sample_far_field_terrain(
    x: f32,
    z: f32,
    terrain_config: &TerrainConfig,
    world_shape: &WorldShapeSampler,
    seed: u32,
) -> FarFieldTerrainSample {
    let shape = world_shape.sample(x, z);
    let height = sample_terrain_height_with_world_shape(x, z, terrain_config, world_shape, seed);
    let water_surface_y = match shape.ocean_class {
        OceanClass::DeepSea | OceanClass::ShelfSea | OceanClass::Coast => {
            Some(world_shape.config().sea_level)
        }
        OceanClass::Beach | OceanClass::Land => None,
    };

    FarFieldTerrainSample {
        height,
        ocean_class: shape.ocean_class,
        coast_surface: shape.coast_surface,
        coast_distance_m: shape.coast_distance_m,
        water_surface_y,
    }
}

pub fn far_field_is_deep_sea(sample: &FarFieldTerrainSample) -> bool {
    sample.ocean_class == OceanClass::DeepSea
}

pub fn far_field_is_drawn_as_land(sample: &FarFieldTerrainSample) -> bool {
    matches!(sample.ocean_class, OceanClass::Beach | OceanClass::Land)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::WorldShapeConfig;

    #[test]
    fn ocean_far_field_has_water_surface() {
        let terrain_config = TerrainConfig::default();
        let mut world_config = WorldShapeConfig::default();
        world_config.continents.threshold = 2.0;
        let world_shape = WorldShapeSampler::new(world_config);

        let sample = sample_far_field_terrain(0.0, 0.0, &terrain_config, &world_shape, 9);

        assert!(sample.water_surface_y.is_some());
    }

    #[test]
    fn far_field_sampling_is_deterministic() {
        let terrain_config = TerrainConfig::default();
        let world_shape = WorldShapeSampler::new(WorldShapeConfig::default());

        let a = sample_far_field_terrain(256.0, -96.0, &terrain_config, &world_shape, 9);
        let b = sample_far_field_terrain(256.0, -96.0, &terrain_config, &world_shape, 9);

        assert_eq!(a, b);
    }
}
