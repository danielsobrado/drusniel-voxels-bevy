use crate::constants::{CHUNK_SIZE_I32, MIN_BREAKABLE_Y, WATER_LEVEL};
use crate::terrain::generation::config::BasinConfig;
use serde::{Deserialize, Serialize};

use super::{
    NoiseGenerator, TerrainGenerator, default_world_edge_distance, lerp_f32, smoothstep,
    stronger_water_metadata,
};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
pub enum GeneratedWaterBodyKind {
    Ocean,
    LakeBasin,
    RiverChannel,
    Pond,
    CaveWaterAquifer,
    #[default]
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ShorelineKind {
    Beach,
    Cliff,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct ShorelineProfile {
    pub(super) edge_distance: i32,
    pub(super) kind: ShorelineKind,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WaterGenerationMetadata {
    pub kind: GeneratedWaterBodyKind,
    pub surface_y: i32,
    pub bed_y: i32,
    pub max_depth: i32,
    pub local_depth: f32,
    pub strength: f32,
}

impl WaterGenerationMetadata {
    fn none(surface_y: i32, bed_y: i32) -> Self {
        Self {
            kind: GeneratedWaterBodyKind::None,
            surface_y,
            bed_y,
            max_depth: 0,
            local_depth: 0.0,
            strength: 0.0,
        }
    }

    pub fn is_surface_water(self) -> bool {
        matches!(
            self.kind,
            GeneratedWaterBodyKind::Ocean
                | GeneratedWaterBodyKind::LakeBasin
                | GeneratedWaterBodyKind::RiverChannel
                | GeneratedWaterBodyKind::Pond
        )
    }
}

pub(super) const EDGE_OCEAN_START_DISTANCE: i32 = CHUNK_SIZE_I32 * 3;
pub(super) const EDGE_OCEAN_FULL_DEPTH_DISTANCE: i32 = CHUNK_SIZE_I32;
pub(super) const EDGE_SHORE_BACKSHORE_DISTANCE: i32 = CHUNK_SIZE_I32 * 2;
pub(super) const EDGE_OCEAN_MIN_DEPTH: f32 = 2.0;
pub(super) const EDGE_OCEAN_MAX_DEPTH: f32 = 16.0;
pub(super) const BEACH_BACKSHORE_HEIGHT: f32 = WATER_LEVEL as f32 + 5.0;
pub(super) const CLIFF_MIN_HEIGHT_ABOVE_WATER: f32 = 16.0;

impl<N: NoiseGenerator> TerrainGenerator<N> {
    /// Calculates river carving depth at a position.
    /// Returns 0 if no river, or a positive depth value to subtract from terrain.
    pub(super) fn river_carve(&self, x: f32, z: f32) -> f32 {
        let cfg = &self.config.rivers;
        if !cfg.enabled {
            return 0.0;
        }

        // Main river: use domain-warped noise for meandering
        let warp_x = self.noise.sample_2d(x * 0.002 + 500.0, z * 0.002) * 50.0;
        let warp_z = self.noise.sample_2d(x * 0.002, z * 0.002 + 500.0) * 50.0;

        let warped_x = x + warp_x;
        let warped_z = z + warp_z;

        // Main river pattern using sine-based channel
        let river_noise =
            self.fbm_configurable(warped_x, warped_z, cfg.scale, cfg.octaves, 0.5, 2.0);

        // Convert to river presence: values near 0.5 are river centers
        let river_dist = (river_noise - 0.5).abs() * 2.0; // Distance from river center [0,1]
        let main_river = (1.0 - river_dist / (cfg.width * 0.01).max(0.01)).max(0.0);

        // Tributary rivers (smaller, more frequent)
        let trib_noise =
            self.fbm_configurable(x + 1000.0, z + 1000.0, cfg.tributary_scale, 2, 0.5, 2.0);
        let trib_dist = (trib_noise - 0.5).abs() * 2.0;
        let tributary = (1.0 - trib_dist / (cfg.tributary_width * 0.01).max(0.01)).max(0.0);

        // Combine rivers, main river takes priority
        let river_strength = main_river.max(tributary * 0.6);

        // Smooth the river edges with a curve
        let smooth_river = river_strength * river_strength * (3.0 - 2.0 * river_strength);

        smooth_river * cfg.depth
    }

    pub fn get_water_generation_metadata(
        &self,
        world_x: i32,
        world_z: i32,
    ) -> WaterGenerationMetadata {
        let base_height = self.get_base_height(world_x, world_z);
        self.water_generation_metadata_for_base_height(world_x, world_z, base_height)
    }

    pub(super) fn water_generation_metadata_for_base_height(
        &self,
        world_x: i32,
        world_z: i32,
        base_height: i32,
    ) -> WaterGenerationMetadata {
        let surface_y = WATER_LEVEL;
        let mut best = WaterGenerationMetadata::none(surface_y, base_height);

        if self.config.rivers.enabled {
            let carve_depth = self.river_carve(world_x as f32, world_z as f32);
            if carve_depth >= 0.05 {
                let depth = carve_depth.ceil().max(2.0) as i32;
                let bed_y = surface_y - depth;
                let local_depth = (surface_y - bed_y.min(best.bed_y)).max(depth) as f32;
                best = WaterGenerationMetadata {
                    kind: GeneratedWaterBodyKind::RiverChannel,
                    surface_y,
                    bed_y: bed_y.min(best.bed_y),
                    max_depth: local_depth.ceil() as i32,
                    local_depth,
                    strength: (carve_depth / self.config.rivers.depth.max(0.001)).clamp(0.0, 1.0),
                };
            }
        }

        if self.config.water_bodies.enabled {
            if let Some(ocean) = self.sample_edge_ocean(world_x, world_z, base_height) {
                best = stronger_water_metadata(best, ocean);
            }
            if let Some(lake) = self.sample_basin(
                world_x,
                world_z,
                base_height,
                &self.config.water_bodies.lakes,
                GeneratedWaterBodyKind::LakeBasin,
                11,
            ) {
                best = stronger_water_metadata(best, lake);
            }
            if let Some(pond) = self.sample_basin(
                world_x,
                world_z,
                base_height,
                &self.config.water_bodies.ponds,
                GeneratedWaterBodyKind::Pond,
                29,
            ) {
                best = stronger_water_metadata(best, pond);
            }
        }

        best
    }

    pub(super) fn sample_edge_ocean(
        &self,
        world_x: i32,
        world_z: i32,
        base_height: i32,
    ) -> Option<WaterGenerationMetadata> {
        let edge_distance = default_world_edge_distance(world_x, world_z);
        if edge_distance >= EDGE_OCEAN_START_DISTANCE {
            return None;
        }

        let blend_width = (EDGE_OCEAN_START_DISTANCE - EDGE_OCEAN_FULL_DEPTH_DISTANCE).max(1);
        let raw = ((EDGE_OCEAN_START_DISTANCE - edge_distance) as f32 / blend_width as f32)
            .clamp(0.0, 1.0);
        let strength = raw * raw * (3.0 - 2.0 * raw);
        if strength <= f32::EPSILON {
            return None;
        }

        let depth = lerp_f32(EDGE_OCEAN_MIN_DEPTH, EDGE_OCEAN_MAX_DEPTH, strength);
        let target_bed_y = WATER_LEVEL as f32 - depth;
        let bed_y = lerp_f32(base_height as f32, target_bed_y, strength)
            .round()
            .min(base_height as f32) as i32;
        let bed_y = if edge_distance < EDGE_OCEAN_START_DISTANCE {
            bed_y.min(WATER_LEVEL - 1)
        } else {
            bed_y
        };
        let bed_y = bed_y.max(MIN_BREAKABLE_Y).min(base_height);
        if bed_y >= WATER_LEVEL {
            return None;
        }

        let local_depth = (WATER_LEVEL - bed_y) as f32;
        Some(WaterGenerationMetadata {
            kind: GeneratedWaterBodyKind::Ocean,
            surface_y: WATER_LEVEL,
            bed_y,
            max_depth: EDGE_OCEAN_MAX_DEPTH.ceil() as i32,
            local_depth,
            strength,
        })
    }

    pub(super) fn shoreline_profile(&self, world_x: i32, world_z: i32) -> Option<ShorelineProfile> {
        let edge_distance = default_world_edge_distance(world_x, world_z);
        if edge_distance < 0
            || edge_distance >= EDGE_OCEAN_START_DISTANCE + EDGE_SHORE_BACKSHORE_DISTANCE
        {
            return None;
        }

        let shoreline_cell = CHUNK_SIZE_I32 * 2;
        let cell_x = world_x.div_euclid(shoreline_cell);
        let cell_z = world_z.div_euclid(shoreline_cell);
        let headland_noise = self.hash_position(cell_x.wrapping_add(19), cell_z.wrapping_sub(31));
        let kind = if cell_x == 0 && cell_z == 0 {
            ShorelineKind::Beach
        } else if headland_noise >= 0.58 || (cell_x + cell_z).rem_euclid(7) == 0 {
            ShorelineKind::Cliff
        } else {
            ShorelineKind::Beach
        };

        Some(ShorelineProfile {
            edge_distance,
            kind,
        })
    }

    pub(super) fn apply_edge_shoreline_shape(
        &self,
        world_x: i32,
        world_z: i32,
        inland_height: f32,
    ) -> f32 {
        let Some(profile) = self.shoreline_profile(world_x, world_z) else {
            return inland_height;
        };

        let shore_t =
            (profile.edge_distance as f32 / EDGE_OCEAN_START_DISTANCE as f32).clamp(0.0, 1.0);
        let backshore_t = ((profile.edge_distance - EDGE_OCEAN_START_DISTANCE) as f32
            / EDGE_SHORE_BACKSHORE_DISTANCE as f32)
            .clamp(0.0, 1.0);

        match profile.kind {
            ShorelineKind::Beach => {
                let waterline = WATER_LEVEL as f32 + 1.0;
                let dry_beach = lerp_f32(waterline, BEACH_BACKSHORE_HEIGHT, smoothstep(shore_t));
                if profile.edge_distance < EDGE_OCEAN_START_DISTANCE {
                    dry_beach
                } else {
                    let inland_target = inland_height.max(waterline);
                    let beach_shelf = (CHUNK_SIZE_I32 / 2) as f32;
                    let blend_width = (EDGE_SHORE_BACKSHORE_DISTANCE as f32 - beach_shelf).max(1.0);
                    let delayed_backshore_t =
                        ((profile.edge_distance - EDGE_OCEAN_START_DISTANCE) as f32 - beach_shelf)
                            / blend_width;
                    lerp_f32(dry_beach, inland_target, smoothstep(delayed_backshore_t))
                }
            }
            ShorelineKind::Cliff => {
                let cliff_cap =
                    (WATER_LEVEL as f32 + CLIFF_MIN_HEIGHT_ABOVE_WATER).max(inland_height + 4.0);
                if profile.edge_distance < EDGE_OCEAN_START_DISTANCE {
                    cliff_cap
                } else {
                    lerp_f32(cliff_cap, inland_height, smoothstep(backshore_t))
                }
            }
        }
    }

    pub(super) fn sample_basin(
        &self,
        world_x: i32,
        world_z: i32,
        base_height: i32,
        cfg: &BasinConfig,
        kind: GeneratedWaterBodyKind,
        salt: i32,
    ) -> Option<WaterGenerationMetadata> {
        if !cfg.enabled || cfg.spacing <= 1.0 || cfg.max_radius <= 0.0 || cfg.density <= 0.0 {
            return None;
        }
        if base_height > WATER_LEVEL + 1 {
            return None;
        }

        let x = world_x as f32;
        let z = world_z as f32;
        let cell_x = (x / cfg.spacing).floor() as i32;
        let cell_z = (z / cfg.spacing).floor() as i32;
        let mut best: Option<WaterGenerationMetadata> = None;

        for dz in -1..=1 {
            for dx in -1..=1 {
                let cx = cell_x + dx;
                let cz = cell_z + dz;
                let active = self.hash_position(
                    cx.wrapping_mul(41).wrapping_add(salt),
                    cz.wrapping_mul(73).wrapping_sub(salt),
                );
                if active > cfg.density.clamp(0.0, 1.0) {
                    continue;
                }

                let ox = self.hash_position(
                    cx.wrapping_mul(97).wrapping_add(salt * 3),
                    cz.wrapping_mul(37).wrapping_sub(salt * 5),
                ) - 0.5;
                let oz = self.hash_position(
                    cx.wrapping_mul(53).wrapping_sub(salt * 7),
                    cz.wrapping_mul(89).wrapping_add(salt * 11),
                ) - 0.5;
                let radius_t = self.hash_position(
                    cx.wrapping_mul(131).wrapping_add(salt * 13),
                    cz.wrapping_mul(151).wrapping_sub(salt * 17),
                );
                let depth_t = self.hash_position(
                    cx.wrapping_mul(173).wrapping_sub(salt * 19),
                    cz.wrapping_mul(197).wrapping_add(salt * 23),
                );

                let center_x = (cx as f32 + 0.5 + ox * 0.7) * cfg.spacing;
                let center_z = (cz as f32 + 0.5 + oz * 0.7) * cfg.spacing;
                let radius = lerp_f32(cfg.min_radius, cfg.max_radius, radius_t).max(1.0);
                let dx = x - center_x;
                let dz = z - center_z;
                let dist = (dx * dx + dz * dz).sqrt();
                if dist > radius {
                    continue;
                }

                let inward = (1.0 - dist / radius).clamp(0.0, 1.0);
                let smooth = inward * inward * (3.0 - 2.0 * inward);
                let strength = smooth.powf(cfg.shore_power.max(0.25));
                let central_depth = lerp_f32(cfg.min_depth, cfg.max_depth, depth_t).max(1.0);
                let local_depth = 1.0 + (central_depth - 1.0) * strength;
                let bed_y = WATER_LEVEL - local_depth.ceil() as i32;
                let candidate = WaterGenerationMetadata {
                    kind,
                    surface_y: WATER_LEVEL,
                    bed_y,
                    max_depth: central_depth.ceil() as i32,
                    local_depth,
                    strength,
                };
                best = Some(match best {
                    Some(current) => stronger_water_metadata(current, candidate),
                    None => candidate,
                });
            }
        }

        best
    }

    pub fn is_cave_aquifer(&self, world_x: i32, world_y: i32, world_z: i32) -> bool {
        let cfg = &self.config.water_bodies.aquifers;
        if !self.config.water_bodies.enabled || !cfg.enabled || world_y > cfg.max_y {
            return false;
        }

        let x = world_x as f32 * cfg.noise_scale;
        let y = world_y as f32 * cfg.noise_scale;
        let z = world_z as f32 * cfg.noise_scale;
        self.noise.fbm_3d(x, y, z, 3) >= cfg.threshold
    }
}
