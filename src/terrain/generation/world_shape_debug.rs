use super::world_shape::{CoastSurfaceClass, OceanClass, WorldShapeSampler};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WorldShapeDebugSample {
    pub land_mask: f32,
    pub coast_distance_m: f32,
    pub elevation: f32,
    pub color_rgba: [f32; 4],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorldShapeDebugMode {
    LandMask,
    CoastDistance,
    OceanClass,
    CoastSurface,
}

pub fn sample_world_shape_debug(
    sampler: &WorldShapeSampler,
    x: f32,
    z: f32,
    mode: WorldShapeDebugMode,
) -> WorldShapeDebugSample {
    let sample = sampler.sample(x, z);
    let color_rgba = match mode {
        WorldShapeDebugMode::LandMask => land_mask_color(sample.land_mask),
        WorldShapeDebugMode::CoastDistance => coast_distance_color(sample.coast_distance_m),
        WorldShapeDebugMode::OceanClass => ocean_class_color(sample.ocean_class),
        WorldShapeDebugMode::CoastSurface => coast_surface_color(sample.coast_surface),
    };

    WorldShapeDebugSample {
        land_mask: sample.land_mask,
        coast_distance_m: sample.coast_distance_m,
        elevation: sample.base_elevation,
        color_rgba,
    }
}

fn land_mask_color(land_mask: f32) -> [f32; 4] {
    let value = ((land_mask + 1.0) * 0.5).clamp(0.0, 1.0);
    [value, value, value, 1.0]
}

fn coast_distance_color(distance_m: f32) -> [f32; 4] {
    let near = (1.0 - (distance_m.abs() / 256.0).clamp(0.0, 1.0)).max(0.0);
    if distance_m >= 0.0 {
        [near, 0.65 + near * 0.35, 0.2, 1.0]
    } else {
        [0.05, 0.25 + near * 0.45, 0.75 + near * 0.25, 1.0]
    }
}

fn ocean_class_color(ocean_class: OceanClass) -> [f32; 4] {
    match ocean_class {
        OceanClass::DeepSea => [0.0, 0.02, 0.22, 1.0],
        OceanClass::ShelfSea => [0.0, 0.22, 0.58, 1.0],
        OceanClass::Coast => [0.0, 0.55, 0.85, 1.0],
        OceanClass::Beach => [0.86, 0.76, 0.42, 1.0],
        OceanClass::Land => [0.20, 0.58, 0.22, 1.0],
    }
}

fn coast_surface_color(surface: CoastSurfaceClass) -> [f32; 4] {
    match surface {
        CoastSurfaceClass::DeepSeaFloor => [0.0, 0.02, 0.18, 1.0],
        CoastSurfaceClass::ShelfSeaFloor => [0.0, 0.18, 0.48, 1.0],
        CoastSurfaceClass::WetCoast => [0.0, 0.48, 0.68, 1.0],
        CoastSurfaceClass::BeachSand => [0.88, 0.74, 0.38, 1.0],
        CoastSurfaceClass::CoastalCliff => [0.36, 0.34, 0.32, 1.0],
        CoastSurfaceClass::Inland => [0.22, 0.54, 0.20, 1.0],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::{WorldShapeConfig, WorldShapeSampler};

    #[test]
    fn debug_sampling_is_deterministic() {
        let sampler = WorldShapeSampler::new(WorldShapeConfig::default());

        let a = sample_world_shape_debug(&sampler, 64.0, -128.0, WorldShapeDebugMode::OceanClass);
        let b = sample_world_shape_debug(&sampler, 64.0, -128.0, WorldShapeDebugMode::OceanClass);

        assert_eq!(a, b);
    }

    #[test]
    fn debug_colors_have_alpha() {
        let sampler = WorldShapeSampler::new(WorldShapeConfig::default());

        for mode in [
            WorldShapeDebugMode::LandMask,
            WorldShapeDebugMode::CoastDistance,
            WorldShapeDebugMode::OceanClass,
            WorldShapeDebugMode::CoastSurface,
        ] {
            let sample = sample_world_shape_debug(&sampler, 0.0, 0.0, mode);
            assert_eq!(sample.color_rgba[3], 1.0);
        }
    }
}
