//! Per-candidate terrain readout for stone placement. Pulls height + slope from the terrain
//! generator and the climate fields from [`crate::voxel::terrain::ClimateSample`], then derives
//! scree / streambed / cliff-above signals. Pure function of the terrain generator + position.

use bevy::math::{Vec2, Vec3};

use crate::voxel::terrain::{NoiseGenerator, TerrainGenerator};

use super::config::StoneConfig;

/// Horizontal step (cells) for the slope estimate.
const SLOPE_STEP: i32 = 2;

pub struct StoneSiteSample {
    pub height: f32,
    /// Surface normal.y in `[0, 1]` (1 = flat).
    pub normal_y: f32,
    /// Horizontal normal components, for leaning stones into the slope.
    pub normal_xz: Vec2,
    pub rock_exposure: f32,
    pub snow: f32,
    pub moisture: f32,
    /// Stable-but-steep ground that accumulates scree.
    pub scree: f32,
    /// River/streambed influence.
    pub streambed: f32,
    /// Steep rise above the site (talus collects below cliffs).
    pub cliff_above: f32,
    /// Slope acceptance factor in `[0, 1]` (0 = too steep to hold stones).
    pub repose: f32,
    pub standing_water: bool,
}

fn clamp01(v: f32) -> f32 {
    v.clamp(0.0, 1.0)
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    if edge0 == edge1 {
        return if value >= edge1 { 1.0 } else { 0.0 };
    }
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

pub fn sample_site<N: NoiseGenerator>(
    terrain: &TerrainGenerator<N>,
    world_x: i32,
    world_z: i32,
    cfg: &StoneConfig,
) -> StoneSiteSample {
    let climate = terrain.get_climate(world_x, world_z);
    let height = terrain.get_height(world_x, world_z) as f32;

    // Slope/normal from central differences of neighbouring heights.
    let step = SLOPE_STEP;
    let hxp = terrain.get_height(world_x + step, world_z) as f32;
    let hxn = terrain.get_height(world_x - step, world_z) as f32;
    let hzp = terrain.get_height(world_x, world_z + step) as f32;
    let hzn = terrain.get_height(world_x, world_z - step) as f32;
    let span = (2 * step) as f32;
    let dhx = (hxp - hxn) / span;
    let dhz = (hzp - hzn) / span;
    let normal = Vec3::new(-dhx, 1.0, -dhz).normalize();
    let normal_y = normal.y;
    let normal_xz = Vec2::new(normal.x, normal.z);

    let denom = (cfg.slope_repose_start - cfg.slope_repose).max(1e-3);
    let repose = clamp01((normal_y - cfg.slope_repose) / denom);
    let scree = clamp01((cfg.slope_repose_start - normal_y) / denom) * repose;

    // Real river depth from the terrain generator drives the streambed signal.
    let streambed = clamp01(climate.river_depth / cfg.streambed_depth_scale.max(1e-3));

    // Cliff-above: probe uphill (steepest ascent = +gradient direction) for a steep rise.
    let uphill = Vec2::new(dhx, dhz);
    let cliff_above = if uphill.length_squared() > 1e-6 {
        let dir = uphill.normalize();
        let near = cfg.cliff_probe_near_m;
        let far = cfg.cliff_probe_far_m;
        let h_near = terrain.get_height(
            world_x + (dir.x * near).round() as i32,
            world_z + (dir.y * near).round() as i32,
        ) as f32;
        let h_far = terrain.get_height(
            world_x + (dir.x * far).round() as i32,
            world_z + (dir.y * far).round() as i32,
        ) as f32;
        let rise_near = (h_near - height) / near.max(1e-3);
        let rise_far = (h_far - h_near) / (far - near).max(1e-3);
        smoothstep(
            cfg.cliff_rise_start,
            cfg.cliff_rise_end,
            rise_near.max(rise_far),
        )
    } else {
        0.0
    };

    StoneSiteSample {
        height,
        normal_y,
        normal_xz,
        rock_exposure: climate.rock_exposure,
        snow: climate.snow,
        moisture: climate.moisture,
        scree,
        streambed,
        cliff_above,
        repose,
        standing_water: climate.standing_water,
    }
}
