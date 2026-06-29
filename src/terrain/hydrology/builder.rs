use bevy::prelude::*;

use super::config::{
    HydrologyAccumulationConfig, HydrologyFillConfig, HydrologyMoistureConfig,
    HydrologyRiversConfig, HydrologyTalusConfig, HydrologyWaterSurfaceConfig,
    VisualHydrologyConfig,
};
use super::field::{VisualHydrologyField, VisualHydrologyMetadata};
use crate::constants::{CHUNK_SIZE_I32, DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Z};
use crate::voxel::terrain::{GeneratedWaterBodyKind, NoiseGenerator, TerrainGenerator};

const OFFSETS_8: [(isize, isize, f32); 8] = [
    (-1, 0, 1.0),
    (1, 0, 1.0),
    (0, -1, 1.0),
    (0, 1, 1.0),
    (-1, -1, std::f32::consts::SQRT_2),
    (1, 1, std::f32::consts::SQRT_2),
    (-1, 1, std::f32::consts::SQRT_2),
    (1, -1, std::f32::consts::SQRT_2),
];

const FALLBACK_RIVER_PATHS: &[&[(f32, f32)]] = &[
    &[
        (0.08, 0.32),
        (0.24, 0.39),
        (0.42, 0.47),
        (0.61, 0.56),
        (0.86, 0.68),
    ],
    &[(0.72, 0.12), (0.66, 0.27), (0.58, 0.42), (0.48, 0.51)],
];

pub struct VisualHydrologyBuilder;

#[derive(Clone, Debug)]
struct HydrologyGrid {
    res: usize,
    world_min: Vec2,
    world_size: Vec2,
    texel: f32,
    original_bed: Vec<f32>,
    carved_bed: Vec<f32>,
    filled_surface: Vec<f32>,
    accumulation: Vec<f32>,
    flow_strength: Vec<f32>,
    water_strength: Vec<f32>,
    river_depth: Vec<f32>,
    water_y_raw: Vec<f32>,
    water_y: Vec<f32>,
    water_y_far: Vec<f32>,
    far_res: usize,
    wet_mask: Vec<f32>,
    lake_mask: Vec<f32>,
    river_mask: Vec<f32>,
    moisture: Vec<f32>,
    body_kind: Vec<GeneratedWaterBodyKind>,
    flow_dir_x: Vec<f32>,
    flow_dir_z: Vec<f32>,
}

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

        let mut grid = create_grid(generator, &config, world_min, world_size);
        fill_depressions(&mut grid, &config.fill);
        compute_flow_accumulation(
            &mut grid,
            &config.accumulation,
            &config.fill,
            &config.rivers,
        );
        carve_rivers_and_classify_water(&mut grid, &config.fill, &config.rivers, &config.talus);
        apply_river_flow_speed_multiplier(&mut grid, config.rivers.flow_speed_multiplier);
        for i in 0..grid.water_y_raw.len() {
            if grid.river_mask[i] > 0.01 {
                grid.water_y_raw[i] = grid.carved_bed[i] + grid.river_depth[i];
            }
        }
        build_water_surface(
            &mut grid,
            &config.water_surface,
            config.water_surface.dry_sentinel_depth,
        );
        build_far_water_surface(&mut grid, &config.water_surface);
        build_moisture_field(&mut grid, &config.moisture);

        let resolution = grid.res;
        let metadata = VisualHydrologyMetadata {
            resolution,
            far_resolution: grid.far_res,
            world_min: grid.world_min,
            world_size: grid.world_size,
            cell_size: public_cell_size(grid.world_size, resolution),
        };

        Some(VisualHydrologyField {
            water_y: grid.water_y,
            water_y_far: grid.water_y_far,
            wet_mask: grid
                .wet_mask
                .into_iter()
                .map(|mask| if mask > 0.5 { u8::MAX } else { 0 })
                .collect(),
            flow_dir_speed: grid
                .flow_dir_x
                .into_iter()
                .zip(grid.flow_dir_z)
                .map(|(x, z)| Vec2::new(x, z))
                .collect(),
            flow_strength: grid.flow_strength,
            river_depth: grid.river_depth,
            moisture: grid.moisture,
            body_kind: grid.body_kind,
            metadata,
        })
    }
}

fn create_grid<N: NoiseGenerator>(
    generator: &TerrainGenerator<N>,
    config: &VisualHydrologyConfig,
    world_min: Vec2,
    world_size: Vec2,
) -> HydrologyGrid {
    let res = config.resolution;
    let count = res * res;
    let far_res = (res / config.water_surface.far_reduce_factor).max(1);
    let texel = if res > 1 {
        world_size.x.max(world_size.y) / (res - 1) as f32
    } else {
        world_size.x.max(world_size.y).max(1.0)
    };
    let mut original_bed = vec![0.0; count];

    for z in 0..res {
        let wz = world_min.y + normalized_axis(z, res) * world_size.y;
        for x in 0..res {
            let wx = world_min.x + normalized_axis(x, res) * world_size.x;
            original_bed[grid_index(res, x, z)] =
                generator.get_base_height(wx.round() as i32, wz.round() as i32) as f32;
        }
    }

    HydrologyGrid {
        res,
        world_min,
        world_size,
        texel,
        carved_bed: original_bed.clone(),
        filled_surface: original_bed.clone(),
        original_bed,
        accumulation: vec![0.0; count],
        flow_strength: vec![0.0; count],
        water_strength: vec![0.0; count],
        river_depth: vec![0.0; count],
        water_y_raw: vec![0.0; count],
        water_y: vec![0.0; count],
        water_y_far: vec![0.0; far_res * far_res],
        far_res,
        wet_mask: vec![0.0; count],
        lake_mask: vec![0.0; count],
        river_mask: vec![0.0; count],
        moisture: vec![0.0; count],
        body_kind: vec![GeneratedWaterBodyKind::None; count],
        flow_dir_x: vec![0.0; count],
        flow_dir_z: vec![0.0; count],
    }
}

#[inline]
fn normalized_axis(index: usize, res: usize) -> f32 {
    if res > 1 {
        index as f32 / (res - 1) as f32
    } else {
        0.0
    }
}

fn public_cell_size(world_size: Vec2, res: usize) -> Vec2 {
    if res > 1 {
        world_size / (res - 1) as f32
    } else {
        world_size.max(Vec2::ONE)
    }
}

#[inline]
fn grid_index(res: usize, x: usize, z: usize) -> usize {
    z * res + x
}

#[inline]
fn clamp_grid_coord(res: usize, value: isize) -> usize {
    value.clamp(0, res.saturating_sub(1) as isize) as usize
}

fn fill_depressions(grid: &mut HydrologyGrid, config: &HydrologyFillConfig) {
    let res = grid.res;
    if !config.enabled {
        grid.filled_surface.copy_from_slice(&grid.original_bed);
        return;
    }

    let count = res * res;
    let mut src = vec![0.0; count];
    let mut dst = vec![0.0; count];
    for z in 0..res {
        for x in 0..res {
            let i = grid_index(res, x, z);
            let border = x == 0 || z == 0 || x == res - 1 || z == res - 1;
            src[i] = if border {
                grid.original_bed[i]
            } else {
                grid.original_bed[i] + 4000.0
            };
            dst[i] = src[i];
        }
    }

    for _ in 0..config.iterations {
        let mut max_change = 0.0f32;
        for z in 0..res {
            for x in 0..res {
                let i = grid_index(res, x, z);
                if x == 0 || z == 0 || x == res - 1 || z == res - 1 {
                    dst[i] = grid.original_bed[i];
                    continue;
                }

                let mut lowest = f32::INFINITY;
                for (ox, oz, dist) in OFFSETS_8 {
                    let n = grid_index(res, (x as isize + ox) as usize, (z as isize + oz) as usize);
                    lowest = lowest.min(src[n] + config.epsilon_per_cell * dist);
                }

                let next = grid.original_bed[i].max(src[i].min(lowest));
                dst[i] = next;
                max_change = max_change.max((next - src[i]).abs());
            }
        }

        std::mem::swap(&mut src, &mut dst);
        if max_change < 1e-4 {
            break;
        }
    }

    grid.filled_surface.copy_from_slice(&src);
}

fn compute_flow_accumulation(
    grid: &mut HydrologyGrid,
    accumulation_config: &HydrologyAccumulationConfig,
    fill_config: &HydrologyFillConfig,
    rivers_config: &HydrologyRiversConfig,
) {
    let res = grid.res;
    let count = res * res;
    grid.accumulation.fill(0.0);
    let particles = accumulation_config.particles;

    for p in 0..particles {
        let spawn = p * count / particles.max(1);
        let mut x = (spawn % res) as f32
            + hash01(p as i32 + accumulation_config.jitter_seed.wrapping_mul(17));
        let mut z = (spawn / res) as f32
            + hash01(p as i32 + accumulation_config.jitter_seed.wrapping_mul(31));
        let mut dir_x = 0.0;
        let mut dir_z = 0.0;

        for _ in 0..accumulation_config.max_steps {
            let xi = (x.floor() as isize).clamp(1, res.saturating_sub(2) as isize) as usize;
            let zi = (z.floor() as isize).clamp(1, res.saturating_sub(2) as isize) as usize;
            let i = grid_index(res, xi, zi);
            grid.accumulation[i] += 1.0;
            if grid.filled_surface[i] - grid.original_bed[i] > fill_config.lake_delta {
                break;
            }

            let gx = sample_array_at_grid(&grid.filled_surface, res, x + 0.65, z)
                - sample_array_at_grid(&grid.filled_surface, res, x - 0.65, z);
            let gz = sample_array_at_grid(&grid.filled_surface, res, x, z + 0.65)
                - sample_array_at_grid(&grid.filled_surface, res, x, z - 0.65);
            let g_len = gx.hypot(gz);
            if g_len < accumulation_config.flat_gradient_stop {
                break;
            }

            let nx = -gx / g_len;
            let nz = -gz / g_len;
            let inertia = accumulation_config.inertia.clamp(0.0, 0.98);
            dir_x = dir_x * inertia + nx * (1.0 - inertia);
            dir_z = dir_z * inertia + nz * (1.0 - inertia);
            let d_len = dir_x.hypot(dir_z).max(1.0);
            x += dir_x / d_len;
            z += dir_z / d_len;
            if x < 1.0 || x > (res - 2) as f32 || z < 1.0 || z > (res - 2) as f32 {
                break;
            }
        }
    }

    let river_threshold = particles as f32 / count as f32 + rivers_config.river_threshold_add;
    let visible_threshold =
        particles as f32 / count as f32 + rivers_config.visible_water_threshold_add;
    for i in 0..count {
        let acc = grid.accumulation[i];
        let t = (acc / river_threshold).clamp(1e-5, 60.0);
        grid.flow_strength[i] = if t > 1.0 {
            (t.log2() * 0.18).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let tw = (acc / visible_threshold).clamp(1e-5, 60.0);
        grid.water_strength[i] = if tw > 1.0 {
            (tw.log2() * 0.21).clamp(0.0, 1.0)
        } else {
            0.0
        };
    }

    let radius = rivers_config.widen_radius;
    let mut scratch = vec![0.0; count];
    triangle_blur(&mut grid.flow_strength, res, radius, &mut scratch);
    triangle_blur(&mut grid.water_strength, res, radius, &mut scratch);

    for z in 0..res {
        for x in 0..res {
            let i = grid_index(res, x, z);
            let wl = grid.filled_surface[grid_index(res, clamp_grid_coord(res, x as isize - 1), z)];
            let wr = grid.filled_surface[grid_index(res, clamp_grid_coord(res, x as isize + 1), z)];
            let wd = grid.filled_surface[grid_index(res, x, clamp_grid_coord(res, z as isize - 1))];
            let wu = grid.filled_surface[grid_index(res, x, clamp_grid_coord(res, z as isize + 1))];
            let dx = wl - wr;
            let dz = wd - wu;
            let len = dx.hypot(dz);
            if len > 1e-5 {
                grid.flow_dir_x[i] = dx / len * grid.flow_strength[i];
                grid.flow_dir_z[i] = dz / len * grid.flow_strength[i];
            } else {
                grid.flow_dir_x[i] = 0.0;
                grid.flow_dir_z[i] = 0.0;
            }
        }
    }
}

fn carve_rivers_and_classify_water(
    grid: &mut HydrologyGrid,
    fill_config: &HydrologyFillConfig,
    rivers_config: &HydrologyRiversConfig,
    talus_config: &HydrologyTalusConfig,
) {
    let res = grid.res;
    grid.carved_bed.copy_from_slice(&grid.original_bed);

    let lake_drop = rivers_config.lake_surface_drop_m.max(0.0);
    let mut lake_depth: Vec<f32> = grid
        .filled_surface
        .iter()
        .zip(&grid.original_bed)
        .map(|(filled, original)| (filled - lake_drop - original).max(0.0))
        .collect();
    let mut scratch = vec![0.0; lake_depth.len()];
    triangle_blur(&mut lake_depth, res, 3, &mut scratch);

    for z in 0..res {
        for x in 0..res {
            let i = grid_index(res, x, z);
            let lake_d = lake_depth[i];
            let is_lake = lake_d > fill_config.lake_delta;
            grid.lake_mask[i] = if is_lake { 1.0 } else { 0.0 };

            let lake_fade = smoothstep(fill_config.lake_delta * 0.7, 0.12, lake_d);
            let strength = if is_lake {
                1.0
            } else {
                (grid.flow_strength[i] * 2.1).clamp(0.0, 1.0)
            };
            grid.flow_strength[i] = strength;
            let carve_depth =
                strength.powf(rivers_config.carve_power) * rivers_config.carve_depth_m * lake_fade;
            if !is_lake {
                grid.carved_bed[i] = grid.original_bed[i] - carve_depth;
            }

            let wl = grid.filled_surface[grid_index(res, clamp_grid_coord(res, x as isize - 1), z)];
            let wr = grid.filled_surface[grid_index(res, clamp_grid_coord(res, x as isize + 1), z)];
            let wd = grid.filled_surface[grid_index(res, x, clamp_grid_coord(res, z as isize - 1))];
            let wu = grid.filled_surface[grid_index(res, x, clamp_grid_coord(res, z as isize + 1))];
            let slope = (wl - wr).hypot(wd - wu) / (grid.texel * 2.0).max(1e-6);
            let slope_gate = smoothstep(
                rivers_config.slope_gate_start,
                rivers_config.slope_gate_end,
                slope,
            );

            if is_lake {
                grid.river_depth[i] = lake_d;
                grid.water_y_raw[i] = grid.filled_surface[i] - lake_drop;
                grid.wet_mask[i] = 1.0;
                grid.river_mask[i] = 0.0;
                grid.body_kind[i] = GeneratedWaterBodyKind::LakeBasin;
                grid.flow_dir_x[i] = 0.0;
                grid.flow_dir_z[i] = 0.0;
                continue;
            }

            let visible_strength = (grid.water_strength[i] * 1.5).clamp(0.0, 1.0);
            let river_surface_depth = (visible_strength.powf(rivers_config.visible_depth_power)
                * rivers_config.visible_depth_m
                * lake_fade
                * 0.45
                * slope_gate)
                .max(0.0);
            let river_wet = visible_strength > rivers_config.min_visible_depth
                && river_surface_depth > rivers_config.min_visible_depth;
            grid.river_depth[i] = if river_wet { river_surface_depth } else { 0.0 };
            grid.river_mask[i] = if river_wet { 1.0 } else { 0.0 };
            grid.wet_mask[i] = if river_wet { 1.0 } else { 0.0 };
            grid.body_kind[i] = if river_wet {
                GeneratedWaterBodyKind::RiverChannel
            } else {
                GeneratedWaterBodyKind::None
            };
            grid.water_y_raw[i] = if river_wet {
                grid.carved_bed[i] + river_surface_depth
            } else {
                -1e4
            };
        }
    }

    ensure_visible_fallback_rivers(grid, rivers_config);

    if talus_config.enabled {
        relax_talus(grid, talus_config);
    }
}

fn ensure_visible_fallback_rivers(grid: &mut HydrologyGrid, config: &HydrologyRiversConfig) {
    if !config.guarantee_fallback_rivers || grid.res < 16 {
        return;
    }
    let minimum_river_cells =
        (grid.res as f32 * 2.25).max(grid.res as f32 * grid.res as f32 * 0.006);
    if count_river_cells(grid) as f32 >= minimum_river_cells {
        return;
    }

    for (path_index, path) in FALLBACK_RIVER_PATHS.iter().enumerate() {
        if path_index == 0 && !config.fallback_main_river {
            continue;
        }
        if path_index > 0 && !config.fallback_tributaries {
            continue;
        }
        carve_fallback_river_path(grid, config, path);
    }
}

fn count_river_cells(grid: &HydrologyGrid) -> usize {
    grid.river_mask.iter().filter(|value| **value > 0.5).count()
}

fn carve_fallback_river_path(
    grid: &mut HydrologyGrid,
    config: &HydrologyRiversConfig,
    path_norm: &[(f32, f32)],
) {
    if path_norm.len() < 2 {
        return;
    }

    let points: Vec<Vec2> = path_norm
        .iter()
        .map(|(x, z)| {
            Vec2::new(
                clamp_grid_coord(grid.res, (*x * (grid.res - 1) as f32) as isize) as f32,
                clamp_grid_coord(grid.res, (*z * (grid.res - 1) as f32) as isize) as f32,
            )
        })
        .collect();
    let levels = monotonic_river_levels(grid, &points);
    let half_width_cells =
        (grid.res as f32 * 0.013 + config.widen_radius as f32 * 0.9).clamp(2.4, 6.5);

    for z in 1..grid.res - 1 {
        for x in 1..grid.res - 1 {
            let mut best: Option<SegmentProjection> = None;
            for i in 0..points.len() - 1 {
                let projection =
                    project_grid_point_to_segment(x as f32, z as f32, points[i], points[i + 1], i);
                if best
                    .as_ref()
                    .is_none_or(|best| projection.distance < best.distance)
                {
                    best = Some(projection);
                }
            }

            let Some(best) = best else {
                continue;
            };
            if best.distance > half_width_cells {
                continue;
            }

            let cell = grid_index(grid.res, x, z);
            if grid.lake_mask[cell] > 0.5 {
                continue;
            }

            let bank = 1.0 - smoothstep(half_width_cells * 0.35, half_width_cells, best.distance);
            if bank <= 0.01 {
                continue;
            }

            let level = lerp(
                levels[best.segment_index],
                levels[best.segment_index + 1],
                best.t,
            );
            let channel_depth = config
                .min_visible_depth
                .max(config.visible_depth_m * (0.28 + bank * 0.72));
            let target_bed = level - channel_depth;
            grid.carved_bed[cell] = grid.carved_bed[cell].min(target_bed);
            grid.river_depth[cell] = grid.river_depth[cell].max(level - grid.carved_bed[cell]);
            grid.water_y_raw[cell] = grid.water_y_raw[cell].max(level);
            grid.river_mask[cell] = grid.river_mask[cell].max(bank);
            grid.wet_mask[cell] = 1.0;
            grid.lake_mask[cell] = 0.0;
            grid.body_kind[cell] = GeneratedWaterBodyKind::RiverChannel;

            let flow = grid.flow_strength[cell].max(0.32 + bank * 0.68);
            grid.flow_strength[cell] = flow;
            grid.water_strength[cell] = grid.water_strength[cell].max(bank);
            grid.flow_dir_x[cell] = best.dir_x * flow;
            grid.flow_dir_z[cell] = best.dir_z * flow;
        }
    }
}

fn monotonic_river_levels(grid: &HydrologyGrid, points: &[Vec2]) -> Vec<f32> {
    let mut levels: Vec<f32> = points
        .iter()
        .map(|point| {
            let ix = clamp_grid_coord(grid.res, point.x.round() as isize);
            let iz = clamp_grid_coord(grid.res, point.y.round() as isize);
            grid.filled_surface[grid_index(grid.res, ix, iz)] + 0.35
        })
        .collect();

    for i in 1..levels.len() {
        levels[i] = levels[i].min(levels[i - 1] - 0.08);
    }
    let minimum_drop = 2.6f32.max(levels.len() as f32 * 0.35);
    let last = levels.len() - 1;
    levels[last] = levels[last].min(levels[0] - minimum_drop);
    for i in (0..levels.len() - 1).rev() {
        levels[i] = levels[i].max(levels[i + 1] + 0.08);
    }

    levels
}

#[derive(Clone, Copy, Debug)]
struct SegmentProjection {
    segment_index: usize,
    distance: f32,
    t: f32,
    dir_x: f32,
    dir_z: f32,
}

fn project_grid_point_to_segment(
    x: f32,
    z: f32,
    a: Vec2,
    b: Vec2,
    segment_index: usize,
) -> SegmentProjection {
    let delta = b - a;
    let len_sq = delta.length_squared();
    let t = if len_sq > 1e-8 {
        ((Vec2::new(x, z) - a).dot(delta) / len_sq).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let closest = a + delta * t;
    let len = len_sq.sqrt().max(1e-8);
    SegmentProjection {
        segment_index,
        distance: Vec2::new(x, z).distance(closest),
        t,
        dir_x: delta.x / len,
        dir_z: delta.y / len,
    }
}

fn relax_talus(grid: &mut HydrologyGrid, config: &HydrologyTalusConfig) {
    let res = grid.res;
    let talus = grid.texel * 0.7;
    let mut tmp = vec![0.0; grid.carved_bed.len()];
    for _ in 0..config.iterations {
        tmp.copy_from_slice(&grid.carved_bed);
        for z in 1..res - 1 {
            for x in 1..res - 1 {
                let i = grid_index(res, x, z);
                let mut delta = 0.0;
                for (ox, oz) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                    let ni =
                        grid_index(res, (x as isize + ox) as usize, (z as isize + oz) as usize);
                    let d_out = (grid.carved_bed[i] - grid.carved_bed[ni] - talus).max(0.0);
                    let d_in = (grid.carved_bed[ni] - grid.carved_bed[i] - talus).max(0.0);
                    delta += d_in - d_out;
                }
                tmp[i] = grid.carved_bed[i] + delta * config.strength;
            }
        }
        grid.carved_bed.copy_from_slice(&tmp);
    }
}

fn apply_river_flow_speed_multiplier(grid: &mut HydrologyGrid, multiplier: f32) {
    let safe_multiplier = if multiplier.is_finite() {
        multiplier.max(0.0)
    } else {
        1.0
    };
    if (safe_multiplier - 1.0).abs() < 1e-6 {
        return;
    }
    for i in 0..grid.flow_strength.len() {
        if grid.river_mask[i] > 0.01 {
            grid.flow_strength[i] *= safe_multiplier;
        }
    }
}

fn build_water_surface(
    grid: &mut HydrologyGrid,
    config: &HydrologyWaterSurfaceConfig,
    dry_sentinel_depth: f32,
) {
    let res = grid.res;
    for z in 0..res {
        for x in 0..res {
            let i = grid_index(res, x, z);
            let wet = grid.water_y_raw[i] > -1000.0;
            grid.wet_mask[i] = if wet { 1.0 } else { 0.0 };
            if wet {
                grid.water_y[i] = grid.water_y_raw[i];
            } else {
                let mut min_bed = f32::INFINITY;
                for oz in -1..=1 {
                    for ox in -1..=1 {
                        let nx = clamp_grid_coord(res, x as isize + ox);
                        let nz = clamp_grid_coord(res, z as isize + oz);
                        min_bed = min_bed.min(grid.carved_bed[grid_index(res, nx, nz)]);
                    }
                }
                grid.water_y[i] = min_bed - dry_sentinel_depth;
            }
        }
    }

    let mut tmp = vec![0.0; grid.water_y.len()];
    for _ in 0..config.wet_smooth_iterations {
        tmp.copy_from_slice(&grid.water_y);
        for z in 0..res {
            for x in 0..res {
                let i = grid_index(res, x, z);
                if grid.wet_mask[i] <= 0.5 {
                    continue;
                }
                let mut sum = grid.water_y[i];
                let mut count = 1.0;
                for (ox, oz) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                    let ni = grid_index(
                        res,
                        clamp_grid_coord(res, x as isize + ox),
                        clamp_grid_coord(res, z as isize + oz),
                    );
                    if grid.wet_mask[ni] > 0.5 {
                        sum += grid.water_y[ni];
                        count += 1.0;
                    }
                }
                tmp[i] = sum / count;
            }
        }
        grid.water_y.copy_from_slice(&tmp);
    }

    tmp.copy_from_slice(&grid.water_y);
    let mut next_wet_mask = grid.wet_mask.clone();
    let mut next_lake_mask = grid.lake_mask.clone();
    let mut next_river_mask = grid.river_mask.clone();
    let mut next_body_kind = grid.body_kind.clone();
    let max_jump = config.wet_to_wet_cliff_slope_max * grid.texel;
    for z in 0..res {
        for x in 0..res {
            let i = grid_index(res, x, z);
            if grid.wet_mask[i] <= 0.5 {
                continue;
            }
            let mut cliff = false;
            for (ox, oz) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                let ni = grid_index(
                    res,
                    clamp_grid_coord(res, x as isize + ox),
                    clamp_grid_coord(res, z as isize + oz),
                );
                if grid.wet_mask[ni] > 0.5 && (grid.water_y[i] - grid.water_y[ni]).abs() > max_jump
                {
                    cliff = true;
                    break;
                }
            }
            if cliff {
                tmp[i] = grid.carved_bed[i] - dry_sentinel_depth;
                next_wet_mask[i] = 0.0;
                next_lake_mask[i] = 0.0;
                next_river_mask[i] = 0.0;
                next_body_kind[i] = GeneratedWaterBodyKind::None;
            }
        }
    }
    grid.water_y.copy_from_slice(&tmp);
    grid.wet_mask = next_wet_mask;
    grid.lake_mask = next_lake_mask;
    grid.river_mask = next_river_mask;
    grid.body_kind = next_body_kind;
}

fn build_far_water_surface(grid: &mut HydrologyGrid, config: &HydrologyWaterSurfaceConfig) {
    let reduce = config.far_reduce_factor.max(1);
    let far_res = (grid.res / reduce).max(1);
    if grid.water_y_far.len() != far_res * far_res {
        grid.water_y_far.resize(far_res * far_res, 0.0);
    }

    for fz in 0..far_res {
        let z0 = fz * grid.res / far_res;
        let z1 = ((fz + 1) * grid.res / far_res).max(z0 + 1);
        for fx in 0..far_res {
            let x0 = fx * grid.res / far_res;
            let x1 = ((fx + 1) * grid.res / far_res).max(x0 + 1);

            let mut min_water_y = f32::INFINITY;
            let mut wet_count = 0usize;
            let mut lake_count = 0usize;
            let mut river_count = 0usize;
            let mut total_cells = 0usize;
            let mut lake_water_y = Vec::new();

            for z in z0..z1.min(grid.res) {
                for x in x0..x1.min(grid.res) {
                    let idx = grid_index(grid.res, x, z);
                    total_cells += 1;
                    if grid.wet_mask[idx] > 0.5 {
                        wet_count += 1;
                    }
                    if grid.body_kind[idx] == GeneratedWaterBodyKind::LakeBasin {
                        lake_count += 1;
                        lake_water_y.push(grid.water_y[idx]);
                    }
                    if grid.body_kind[idx] == GeneratedWaterBodyKind::RiverChannel {
                        river_count += 1;
                    }
                    min_water_y = min_water_y.min(grid.water_y[idx]);
                }
            }

            let total = total_cells.max(1) as f32;
            let wet_ratio = wet_count as f32 / total;
            let lake_ratio = lake_count as f32 / total;
            let river_ratio = river_count as f32 / total;

            let result = if wet_ratio < config.far_wet_threshold {
                min_water_y
            } else if lake_ratio >= config.far_lake_dominance && !lake_water_y.is_empty() {
                lake_water_y.sort_by(|a, b| a.total_cmp(b));
                let mid = lake_water_y.len() / 2;
                if lake_water_y.len() % 2 == 0 {
                    (lake_water_y[mid - 1] + lake_water_y[mid]) * 0.5
                } else {
                    lake_water_y[mid]
                }
            } else if river_ratio >= config.far_river_dominance {
                min_wet_water_y(grid, x0, x1, z0, z1).unwrap_or(min_water_y)
            } else {
                min_wet_water_y(grid, x0, x1, z0, z1).unwrap_or(min_water_y)
            };

            grid.water_y_far[grid_index(far_res, fx, fz)] =
                if result.is_finite() { result } else { 0.0 };
        }
    }

    grid.far_res = far_res;
}

fn min_wet_water_y(
    grid: &HydrologyGrid,
    x0: usize,
    x1: usize,
    z0: usize,
    z1: usize,
) -> Option<f32> {
    let mut min_wet = f32::INFINITY;
    for z in z0..z1.min(grid.res) {
        for x in x0..x1.min(grid.res) {
            let idx = grid_index(grid.res, x, z);
            if grid.wet_mask[idx] > 0.5 {
                min_wet = min_wet.min(grid.water_y[idx]);
            }
        }
    }
    min_wet.is_finite().then_some(min_wet)
}

fn build_moisture_field(grid: &mut HydrologyGrid, config: &HydrologyMoistureConfig) {
    grid.moisture.fill(0.0);
    if !config.enabled {
        return;
    }

    for i in 0..grid.moisture.len() {
        let source = if grid.body_kind[i] == GeneratedWaterBodyKind::RiverChannel {
            config.river_source
        } else if grid.body_kind[i] == GeneratedWaterBodyKind::LakeBasin {
            config.lake_source
        } else if grid.wet_mask[i] > 0.5 {
            config.lake_source
        } else {
            0.0
        };
        grid.moisture[i] = finite01(source);
    }

    if config.blur_radius > 0 {
        let mut scratch = vec![0.0; grid.moisture.len()];
        triangle_blur(
            &mut grid.moisture,
            grid.res,
            config.blur_radius,
            &mut scratch,
        );
    }
    for i in 0..grid.moisture.len() {
        let wet_boost = if grid.wet_mask[i] > 0.5 {
            1.0
        } else {
            config.dry_decay
        };
        grid.moisture[i] = finite01(grid.moisture[i] * wet_boost);
    }
}

fn sample_array_at_grid(field: &[f32], res: usize, gx: f32, gz: f32) -> f32 {
    let x0 = clamp_grid_coord(res, gx.floor() as isize);
    let z0 = clamp_grid_coord(res, gz.floor() as isize);
    let x1 = (x0 + 1).min(res - 1);
    let z1 = (z0 + 1).min(res - 1);
    let fx = (gx - x0 as f32).clamp(0.0, 1.0);
    let fz = (gz - z0 as f32).clamp(0.0, 1.0);
    let a = field[grid_index(res, x0, z0)] * (1.0 - fx) + field[grid_index(res, x1, z0)] * fx;
    let b = field[grid_index(res, x0, z1)] * (1.0 - fx) + field[grid_index(res, x1, z1)] * fx;
    a * (1.0 - fz) + b * fz
}

fn triangle_blur(field: &mut [f32], res: usize, radius: usize, scratch: &mut [f32]) {
    if radius == 0 {
        return;
    }
    let denom = ((radius + 1) * (radius + 1)) as f32;
    for z in 0..res {
        for x in 0..res {
            let mut sum = 0.0;
            for o in -(radius as isize)..=radius as isize {
                let weight = (radius + 1) as f32 - o.unsigned_abs() as f32;
                sum += field[grid_index(res, clamp_grid_coord(res, x as isize + o), z)] * weight;
            }
            scratch[grid_index(res, x, z)] = sum / denom;
        }
    }
    for z in 0..res {
        for x in 0..res {
            let mut sum = 0.0;
            for o in -(radius as isize)..=radius as isize {
                let weight = (radius + 1) as f32 - o.unsigned_abs() as f32;
                sum += scratch[grid_index(res, x, clamp_grid_coord(res, z as isize + o))] * weight;
            }
            field[grid_index(res, x, z)] = sum / denom;
        }
    }
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    if (edge1 - edge0).abs() <= f32::EPSILON {
        return if value >= edge1 { 1.0 } else { 0.0 };
    }
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn hash01(n: i32) -> f32 {
    let mut x = n as u32;
    x = (x ^ (x >> 16)).wrapping_mul(2_246_822_519);
    x = (x ^ (x >> 13)).wrapping_mul(3_266_489_917);
    ((x ^ (x >> 16)) as f32) / 4_294_967_295.0
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a * (1.0 - t) + b * t
}

#[inline]
fn finite01(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        0.0
    }
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
        terrain_config.visual_hydrology.accumulation.particles = 2_000;
        terrain_config.visual_hydrology.accumulation.max_steps = 80;
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
        assert!(field.water_y.iter().all(|value| value.is_finite()));
        assert!(
            field
                .moisture
                .iter()
                .all(|value| (0.0..=1.0).contains(value))
        );
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

    #[test]
    fn fallback_rivers_produce_visible_river_cells_on_flat_terrain() {
        let mut terrain_config = TerrainConfig::default();
        terrain_config.height.min = 20.0;
        terrain_config.height.max = 21.0;
        terrain_config.visual_hydrology.resolution = 32;
        terrain_config.visual_hydrology.far_reduce_factor = 4;
        terrain_config.visual_hydrology.accumulation.particles = 0;
        terrain_config.visual_hydrology.fill.enabled = false;
        terrain_config
            .visual_hydrology
            .rivers
            .guarantee_fallback_rivers = true;
        let generator =
            TerrainGenerator::with_config(ValueNoise::default(), terrain_config.clone());

        let field = VisualHydrologyBuilder::build_default_world(
            &generator,
            &terrain_config.visual_hydrology,
        )
        .expect("visual hydrology should be enabled");

        let river_cells = field
            .body_kind
            .iter()
            .filter(|kind| **kind == GeneratedWaterBodyKind::RiverChannel)
            .count();
        assert!(river_cells > 0);
        assert!(field.river_depth.iter().copied().fold(0.0, f32::max) > 0.0);
    }
}
