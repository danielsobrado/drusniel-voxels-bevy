use std::collections::HashMap;

use super::macro_world_source::{AzgaarMacroWorldSource, DecodedMacroAtlas, decode_macro_atlas};

const WATER_TILE_ID: u8 = 0;
const LAND_HEIGHT: f32 = 20.0;
const MOUNTAIN_RUGGEDNESS: f32 = 0.25;

#[derive(Debug, Clone, Copy)]
pub struct AzgaarProceduralMetadata {
    pub seed: i32,
    pub version: i32,
    pub height_scale: f32,
    pub sea_level: f32,
}

#[derive(Debug, Clone)]
struct RiverSegment {
    ax: f32,
    ay: f32,
    bx: f32,
    by: f32,
    width: f32,
}

#[derive(Debug, Clone)]
pub struct AzgaarMacroWorldGenerator {
    source: AzgaarMacroWorldSource,
    heights: Vec<u8>,
    biome_atlas: Vec<u8>,
    biome_by_source_id: HashMap<u8, u8>,
    seed: i32,
    river_index: HashMap<(i32, i32), Vec<RiverSegment>>,
}

fn clamp(value: f32, minimum: f32, maximum: f32) -> f32 {
    value.max(minimum).min(maximum)
}

fn lerp(left: f32, right: f32, amount: f32) -> f32 {
    left + (right - left) * amount
}

fn smoothstep(value: f32) -> f32 {
    let t = clamp(value, 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn hash2d(x: i32, z: i32, seed: i32) -> f32 {
    let mut value = x.wrapping_mul(0x1f123bb5) ^ z.wrapping_mul(0x5f356495) ^ seed;
    value = (value ^ (value >> 15)).wrapping_mul(0x2c1b3c6d);
    value = (value ^ (value >> 12)).wrapping_mul(0x297a2d39);
    value ^= value >> 15;
    (value as u32 as f64 / 0xffff_ffffu32 as f64) as f32
}

fn value_noise(x: f32, z: f32, seed: i32) -> f32 {
    let x0 = x.floor() as i32;
    let z0 = z.floor() as i32;
    let tx = smoothstep(x - x0 as f32);
    let tz = smoothstep(z - z0 as f32);
    let north = lerp(hash2d(x0, z0, seed), hash2d(x0 + 1, z0, seed), tx);
    let south = lerp(hash2d(x0, z0 + 1, seed), hash2d(x0 + 1, z0 + 1, seed), tx);
    lerp(north, south, tz) * 2.0 - 1.0
}

fn point_segment_distance(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
    let dx = bx - ax;
    let dy = by - ay;
    let length_squared = dx * dx + dy * dy;
    if length_squared == 0.0 {
        return (px - ax).hypot(py - ay);
    }
    let amount = clamp(((px - ax) * dx + (py - ay) * dy) / length_squared, 0.0, 1.0);
    (px - (ax + dx * amount)).hypot(py - (ay + dy * amount))
}

fn land_relief_fraction(raw_height: f32, relief_exponent: f32) -> f32 {
    let normalized = clamp((raw_height - LAND_HEIGHT) / (100.0 - LAND_HEIGHT), 0.0, 1.0);
    if (relief_exponent - 1.0).abs() < f32::EPSILON {
        normalized
    } else {
        normalized.powf(relief_exponent)
    }
}

fn convert_height(raw_height: f32, min_height: f32, max_height: f32, exaggeration: f32, relief_exponent: f32) -> f32 {
    if raw_height < LAND_HEIGHT {
        return min_height * clamp((LAND_HEIGHT - raw_height) / LAND_HEIGHT, 0.0, 1.0) * 0.35;
    }
    land_relief_fraction(raw_height, relief_exponent) * max_height * 0.85 * exaggeration
}

fn create_river_index(
    rivers: &[super::macro_world_source::MacroRiver],
    width: u32,
    height: u32,
) -> HashMap<(i32, i32), Vec<RiverSegment>> {
    let mut buckets: HashMap<(i32, i32), Vec<RiverSegment>> = HashMap::new();
    for river in rivers {
        for index in 1..river.points.len() {
            let [ax, ay] = river.points[index - 1];
            let [bx, by] = river.points[index];
            let segment = RiverSegment {
                ax: ax as f32,
                ay: ay as f32,
                bx: bx as f32,
                by: by as f32,
                width: river.width_atlas as f32,
            };
            let margin = river.width_atlas.max(0.5);
            let min_x = ((ax.min(bx) - margin).floor() as i32).clamp(0, width as i32 - 1);
            let max_x = ((ax.max(bx) + margin).floor() as i32).clamp(0, width as i32 - 1);
            let min_y = ((ay.min(by) - margin).floor() as i32).clamp(0, height as i32 - 1);
            let max_y = ((ay.max(by) + margin).floor() as i32).clamp(0, height as i32 - 1);
            for y in min_y..=max_y {
                for x in min_x..=max_x {
                    buckets.entry((x, y)).or_default().push(segment.clone());
                }
            }
        }
    }
    buckets
}

impl AzgaarMacroWorldGenerator {
    pub fn new(source: AzgaarMacroWorldSource, metadata: AzgaarProceduralMetadata) -> Self {
        let DecodedMacroAtlas {
            heights,
            biomes,
            features: _,
        } = decode_macro_atlas(&source).expect("valid macro atlas");
        let biome_by_source_id = source
            .biomes
            .iter()
            .map(|definition| (definition.source_id, definition.tile_id))
            .collect();
        let river_index = create_river_index(&source.rivers, source.atlas.width, source.atlas.height);
        Self {
            source,
            heights,
            biome_atlas: biomes,
            biome_by_source_id,
            seed: metadata.seed,
            river_index,
        }
    }

    pub fn source(&self) -> &AzgaarMacroWorldSource {
        &self.source
    }

    fn atlas_index(&self, x: i32, y: i32) -> usize {
        let width = self.source.atlas.width as i32;
        let height = self.source.atlas.height as i32;
        let clamped_x = x.clamp(0, width - 1);
        let clamped_y = y.clamp(0, height - 1);
        (clamped_y * width + clamped_x) as usize
    }

    pub fn to_atlas_position(&self, cell_x: f32, cell_z: f32) -> (f32, f32) {
        let bounds = &self.source.bounds;
        let atlas = &self.source.atlas;
        (
            (cell_x - bounds.min_cell_x as f32) / bounds.width_cells as f32 * atlas.width as f32,
            (cell_z - bounds.min_cell_z as f32) / bounds.height_cells as f32 * atlas.height as f32,
        )
    }

    pub fn is_inside(&self, cell_x: f32, cell_z: f32) -> bool {
        let bounds = &self.source.bounds;
        cell_x >= bounds.min_cell_x as f32
            && cell_z >= bounds.min_cell_z as f32
            && cell_x < (bounds.min_cell_x + bounds.width_cells) as f32
            && cell_z < (bounds.min_cell_z + bounds.height_cells) as f32
    }

    pub fn sample_raw_height(&self, cell_x: f32, cell_z: f32) -> f32 {
        let width = self.source.atlas.width as i32;
        let height = self.source.atlas.height as i32;
        let (px, py) = self.to_atlas_position(cell_x, cell_z);
        let fx = clamp(px - 0.5, 0.0, (width - 1) as f32);
        let fy = clamp(py - 0.5, 0.0, (height - 1) as f32);
        let x0 = fx.floor() as i32;
        let y0 = fy.floor() as i32;
        let x1 = (x0 + 1).min(width - 1);
        let y1 = (y0 + 1).min(height - 1);
        let north = lerp(
            self.heights[self.atlas_index(x0, y0)] as f32,
            self.heights[self.atlas_index(x1, y0)] as f32,
            fx - x0 as f32,
        );
        let south = lerp(
            self.heights[self.atlas_index(x0, y1)] as f32,
            self.heights[self.atlas_index(x1, y1)] as f32,
            fx - x0 as f32,
        );
        lerp(north, south, fy - y0 as f32)
    }

    fn outside_distance(&self, cell_x: f32, cell_z: f32) -> f32 {
        let bounds = &self.source.bounds;
        let max_x = (bounds.min_cell_x + bounds.width_cells) as f32;
        let max_z = (bounds.min_cell_z + bounds.height_cells) as f32;
        let dx = (bounds.min_cell_x as f32 - cell_x).max(0.0).max(cell_x - max_x);
        let dz = (bounds.min_cell_z as f32 - cell_z).max(0.0).max(cell_z - max_z);
        dx.hypot(dz)
    }

    pub fn sample_height(&self, vertex_x: f32, vertex_z: f32) -> f32 {
        let raw_height = self.sample_raw_height(vertex_x, vertex_z);
        let terrain = &self.source.terrain;
        let base = convert_height(
            raw_height,
            terrain.min_height,
            terrain.max_height,
            terrain.vertical_exaggeration,
            terrain.relief_exponent,
        );
        if !self.is_inside(vertex_x, vertex_z) {
            let amount = smoothstep(
                self.outside_distance(vertex_x, vertex_z) / self.source.ocean_transition_cells as f32,
            );
            return lerp(base, terrain.min_height * 0.35, amount);
        }
        if raw_height < LAND_HEIGHT {
            return base;
        }
        let coast_fade = clamp((raw_height - LAND_HEIGHT) / 10.0, 0.0, 1.0);
        let exaggeration = terrain.vertical_exaggeration;
        let elevation_fraction = land_relief_fraction(raw_height, terrain.relief_exponent);
        let ruggedness = 1.0 + (exaggeration - 1.0) * elevation_fraction * MOUNTAIN_RUGGEDNESS;
        let detail = value_noise(vertex_x / 96.0, vertex_z / 96.0, self.seed.wrapping_add(1709)) * 1.4
            + value_noise(vertex_x / 24.0, vertex_z / 24.0, self.seed.wrapping_add(1877)) * 0.35;
        base + detail * coast_fade * ruggedness
    }

    pub fn is_river(&self, cell_x: i32, cell_z: i32) -> bool {
        let (px, py) = self.to_atlas_position(cell_x as f32 + 0.5, cell_z as f32 + 0.5);
        let key = (px.floor() as i32, py.floor() as i32);
        let Some(segments) = self.river_index.get(&key) else {
            return false;
        };
        segments.iter().any(|segment| {
            point_segment_distance(px, py, segment.ax, segment.ay, segment.bx, segment.by)
                <= segment.width * 0.5
        })
    }

    pub fn sample_tile(&self, cell_x: i32, cell_z: i32) -> u8 {
        if !self.is_inside(cell_x as f32 + 0.5, cell_z as f32 + 0.5) {
            return WATER_TILE_ID;
        }
        let (px, py) = self.to_atlas_position(cell_x as f32 + 0.5, cell_z as f32 + 0.5);
        let index = self.atlas_index(px.floor() as i32, py.floor() as i32);
        let raw_height = self.heights[index] as f32;
        if raw_height >= LAND_HEIGHT && self.is_river(cell_x, cell_z) {
            return WATER_TILE_ID;
        }
        if raw_height < LAND_HEIGHT {
            return WATER_TILE_ID;
        }
        let biome = self.biome_atlas[index];
        *self.biome_by_source_id.get(&biome).unwrap_or(&WATER_TILE_ID)
    }
}
