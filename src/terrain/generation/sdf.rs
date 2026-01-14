use super::config::TerrainConfig;
use super::noise::sample_terrain_height;
use crate::terrain::constants::{BEDROCK_BLEND, BEDROCK_DEPTH};
use bevy::prelude::*;

/// Sample SDF for Surface Nets
pub fn sample_terrain_sdf(world_pos: Vec3, config: &TerrainConfig, seed: u32) -> f32 {
    let terrain_height = sample_terrain_height(world_pos.x, world_pos.z, config, seed);

    // Basic heightfield SDF: positive above surface, negative below
    let height_sdf = world_pos.y - terrain_height;

    // Bedrock layer - always solid
    let bedrock_sdf = (BEDROCK_DEPTH as f32) - world_pos.y;

    // Combine: terrain OR bedrock (smooth union for blend)
    smooth_min(height_sdf, bedrock_sdf, BEDROCK_BLEND)
}

/// Smooth minimum for blending SDFs
fn smooth_min(a: f32, b: f32, k: f32) -> f32 {
    let h = (0.5 + 0.5 * (b - a) / k).clamp(0.0, 1.0);
    a * h + b * (1.0 - h) - k * h * (1.0 - h)
}
