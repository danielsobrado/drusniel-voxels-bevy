use bevy::prelude::*;

use super::config::VisualHydrologyConfig;
use super::field::{VisualHydrologyField, VisualHydrologyMetadata};
use crate::constants::{CHUNK_SIZE_I32, DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Z};
use crate::voxel::terrain::{GeneratedWaterBodyKind, NoiseGenerator, TerrainGenerator};

pub struct VisualHydrologyBuilder;

impl VisualHydrologyBuilder {
    pub fn build_default_world<N: NoiseGenerator>(
        generator: &TerrainGenerator<N>,
        config: &VisualHydrologyConfig,
    ) -> Option<VisualHydrologyField> {
        let world_size = Vec2::new(
            (DEFAULT_WORLD_CHUNKS_X * CHUNK_SIZE_I32) as f32,
            (DEFAULT_WORLD_CHUNKS_Z * CHUNK_SIZE_I32) as f32,
        );
        Self::build(generator, config, Vec2::ZERO, world_size)
    }

    pub fn build<N: NoiseGenerator>(
        generator: &TerrainGenerator<N>,
        config: &VisualHydrologyConfig,
        world_min: Vec2,
        world_size: Vec2,
    ) -> Option<VisualHydrologyField> {
        let config = config.normalized();
        if !config.enabled {
            return None;
        }

        let resolution = config.resolution;
        let len = resolution * resolution;
        let far_resolution = resolution.div_ceil(config.far_reduce_factor).max(1);
        let cell_size = Vec2::new(
            world_size.x / resolution as f32,
            world_size.y / resolution as f32,
        );
        let metadata = VisualHydrologyMetadata {
            resolution,
            far_resolution,
            world_min,
            world_size,
            cell_size,
        };

        let mut terrain_height = vec![0.0; len];
        let mut raw_wet = vec![false; len];
        let mut water_y = vec![0.0; len];
        let mut wet_mask = vec![0; len];
        let mut flow_dir_speed = vec![Vec2::ZERO; len];
        let mut flow_strength = vec![0.0; len];
        let mut river_depth = vec![0.0; len];
        let mut moisture_seed = vec![0.0; len];
        let mut body_kind = vec![GeneratedWaterBodyKind::None; len];

        for z in 0..resolution {
            for x in 0..resolution {
                let index = grid_index(resolution, x, z);
                let world = cell_world_position(world_min, cell_size, x, z);
                let (height, water) = generator.get_height_and_water_generation_metadata(
                    world.x.round() as i32,
                    world.y.round() as i32,
                );
                let is_water = water.is_surface_water();
                terrain_height[index] = height as f32;
                raw_wet[index] = is_water;
                wet_mask[index] = if is_water { u8::MAX } else { 0 };
                water_y[index] = if is_water {
                    water.surface_y as f32
                } else {
                    height as f32 - config.dry_sink_offset
                };
                body_kind[index] = water.kind;
                if water.kind == GeneratedWaterBodyKind::RiverChannel {
                    river_depth[index] = water.local_depth.max(0.0);
                }
                moisture_seed[index] = if is_water {
                    1.0
                } else if water.kind == GeneratedWaterBodyKind::RiverChannel {
                    water.strength.clamp(0.0, 1.0)
                } else {
                    0.0
                };
            }
        }

        smooth_wet_mask(
            resolution,
            &terrain_height,
            &raw_wet,
            &mut wet_mask,
            config.wet_smooth_iterations,
            config.wet_cliff_gradient_max,
        );
        fill_river_flow(
            resolution,
            cell_size,
            &terrain_height,
            &body_kind,
            &river_depth,
            config.river_flow_min_slope,
            config.river_flow_speed_scale,
            &mut flow_dir_speed,
            &mut flow_strength,
        );
        let moisture = blur_moisture(resolution, &moisture_seed, config.moisture_blur_radius);
        let water_y_far = downsample_water_y(
            resolution,
            far_resolution,
            config.far_reduce_factor,
            &water_y,
            &wet_mask,
        );

        Some(VisualHydrologyField {
            water_y,
            water_y_far,
            wet_mask,
            flow_dir_speed,
            flow_strength,
            river_depth,
            moisture,
            body_kind,
            metadata,
        })
    }
}

#[inline]
fn grid_index(resolution: usize, x: usize, z: usize) -> usize {
    z * resolution + x
}

#[inline]
fn cell_world_position(world_min: Vec2, cell_size: Vec2, x: usize, z: usize) -> Vec2 {
    world_min
        + Vec2::new(
            (x as f32 + 0.5) * cell_size.x,
            (z as f32 + 0.5) * cell_size.y,
        )
}

fn smooth_wet_mask(
    resolution: usize,
    terrain_height: &[f32],
    raw_wet: &[bool],
    wet_mask: &mut [u8],
    iterations: usize,
    cliff_gradient_max: f32,
) {
    if iterations == 0 || resolution < 3 {
        return;
    }

    let mut current = wet_mask.to_vec();
    let mut next = current.clone();
    for _ in 0..iterations {
        for z in 1..resolution - 1 {
            for x in 1..resolution - 1 {
                let index = grid_index(resolution, x, z);
                if raw_wet[index] {
                    next[index] = u8::MAX;
                    continue;
                }

                let mut wet_neighbors = 0;
                let mut max_gradient = 0.0f32;
                for nz in z - 1..=z + 1 {
                    for nx in x - 1..=x + 1 {
                        if nx == x && nz == z {
                            continue;
                        }
                        let neighbor = grid_index(resolution, nx, nz);
                        if current[neighbor] > 0 {
                            wet_neighbors += 1;
                            max_gradient = max_gradient
                                .max((terrain_height[index] - terrain_height[neighbor]).abs());
                        }
                    }
                }

                next[index] = if wet_neighbors >= 3 && max_gradient <= cliff_gradient_max {
                    128
                } else {
                    current[index]
                };
            }
        }
        std::mem::swap(&mut current, &mut next);
        next.copy_from_slice(&current);
    }
    wet_mask.copy_from_slice(&current);
}

fn fill_river_flow(
    resolution: usize,
    cell_size: Vec2,
    terrain_height: &[f32],
    body_kind: &[GeneratedWaterBodyKind],
    river_depth: &[f32],
    min_slope: f32,
    speed_scale: f32,
    flow_dir_speed: &mut [Vec2],
    flow_strength: &mut [f32],
) {
    if resolution < 3 {
        return;
    }

    for z in 1..resolution - 1 {
        for x in 1..resolution - 1 {
            let index = grid_index(resolution, x, z);
            if body_kind[index] != GeneratedWaterBodyKind::RiverChannel {
                continue;
            }

            let left = terrain_height[grid_index(resolution, x - 1, z)];
            let right = terrain_height[grid_index(resolution, x + 1, z)];
            let up = terrain_height[grid_index(resolution, x, z - 1)];
            let down = terrain_height[grid_index(resolution, x, z + 1)];
            let gradient = Vec2::new(
                (right - left) / (2.0 * cell_size.x.max(f32::EPSILON)),
                (down - up) / (2.0 * cell_size.y.max(f32::EPSILON)),
            );
            let slope = gradient.length();
            if slope < min_slope {
                continue;
            }

            let direction = -gradient.normalize_or_zero();
            let strength =
                ((slope - min_slope) * speed_scale * river_depth[index].max(1.0)).clamp(0.0, 1.0);
            flow_dir_speed[index] = direction * strength;
            flow_strength[index] = strength;
        }
    }
}

fn blur_moisture(resolution: usize, seed: &[f32], radius: usize) -> Vec<f32> {
    if radius == 0 {
        return seed.to_vec();
    }

    let mut moisture = vec![0.0; seed.len()];
    for z in 0..resolution {
        let z_min = z.saturating_sub(radius);
        let z_max = (z + radius).min(resolution - 1);
        for x in 0..resolution {
            let x_min = x.saturating_sub(radius);
            let x_max = (x + radius).min(resolution - 1);
            let mut sum = 0.0;
            let mut weight_sum = 0.0;
            for nz in z_min..=z_max {
                for nx in x_min..=x_max {
                    let dist = Vec2::new(nx as f32 - x as f32, nz as f32 - z as f32).length();
                    if dist > radius as f32 {
                        continue;
                    }
                    let weight = 1.0 - dist / (radius as f32 + 1.0);
                    sum += seed[grid_index(resolution, nx, nz)] * weight;
                    weight_sum += weight;
                }
            }
            moisture[grid_index(resolution, x, z)] = if weight_sum > 0.0 {
                (sum / weight_sum).clamp(0.0, 1.0)
            } else {
                0.0
            };
        }
    }
    moisture
}

fn downsample_water_y(
    resolution: usize,
    far_resolution: usize,
    reduce_factor: usize,
    water_y: &[f32],
    wet_mask: &[u8],
) -> Vec<f32> {
    let mut far = vec![0.0; far_resolution * far_resolution];
    for far_z in 0..far_resolution {
        for far_x in 0..far_resolution {
            let x_min = far_x * reduce_factor;
            let z_min = far_z * reduce_factor;
            let x_max = ((far_x + 1) * reduce_factor).min(resolution);
            let z_max = ((far_z + 1) * reduce_factor).min(resolution);
            let mut wet_max = f32::NEG_INFINITY;
            let mut dry_sum = 0.0;
            let mut dry_count = 0usize;

            for z in z_min..z_max {
                for x in x_min..x_max {
                    let index = grid_index(resolution, x, z);
                    if wet_mask[index] > 0 {
                        wet_max = wet_max.max(water_y[index]);
                    } else {
                        dry_sum += water_y[index];
                        dry_count += 1;
                    }
                }
            }

            far[grid_index(far_resolution, far_x, far_z)] = if wet_max.is_finite() {
                wet_max
            } else if dry_count > 0 {
                dry_sum / dry_count as f32
            } else {
                0.0
            };
        }
    }
    far
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::config::TerrainConfig;
    use crate::voxel::terrain::ValueNoise;

    #[test]
    fn builds_default_visual_hydrology_field_contract() {
        let mut terrain_config = TerrainConfig::default();
        terrain_config.visual_hydrology.resolution = 32;
        terrain_config.visual_hydrology.far_reduce_factor = 4;
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), terrain_config.clone());

        let field = VisualHydrologyBuilder::build_default_world(
            &generator,
            &terrain_config.visual_hydrology,
        )
        .expect("visual hydrology should be enabled");

        assert_eq!(field.metadata.resolution, 32);
        assert_eq!(field.metadata.far_resolution, 8);
        assert_eq!(field.water_y.len(), field.len());
        assert_eq!(field.wet_mask.len(), field.len());
        assert_eq!(field.flow_dir_speed.len(), field.len());
        assert_eq!(field.flow_strength.len(), field.len());
        assert_eq!(field.river_depth.len(), field.len());
        assert_eq!(field.moisture.len(), field.len());
        assert_eq!(field.body_kind.len(), field.len());
        assert_eq!(field.water_y_far.len(), field.far_len());
    }

    #[test]
    fn disabled_config_skips_field_build() {
        let mut config = VisualHydrologyConfig {
            enabled: false,
            ..Default::default()
        };
        config.resolution = 8;
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default());

        assert!(VisualHydrologyBuilder::build_default_world(&generator, &config).is_none());
    }
}
