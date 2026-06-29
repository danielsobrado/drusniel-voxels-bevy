use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};

use super::noise::{
    DomainWarpSettings, FbmSettings, domain_warped_fbm2, hash_position_seeded, smooth01,
    smoothstep_range,
};

#[derive(Resource, Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct IslandShapeConfig {
    pub enabled: bool,
    pub sea_level: f32,
    pub seed: i32,
    pub spacing_m: f32,
    pub radius_m: f32,
    pub blend_m: f32,
    pub warp_strength_m: f32,
    pub beach_width_m: f32,
    pub cliff_width_m: f32,
    pub world_radius_m: f32,
    pub ocean_rim: bool,
    pub ocean_rim_drop_m: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct IslandMaskSample {
    pub mask: f32,
    pub shore_distance_m: f32,
    pub nearest_center_x: f32,
    pub nearest_center_z: f32,
    pub cliff_weight: f32,
}

impl Default for IslandShapeConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            sea_level: 18.0,
            seed: 0,
            spacing_m: 1500.0,
            radius_m: 560.0,
            blend_m: 260.0,
            warp_strength_m: 190.0,
            beach_width_m: 28.0,
            cliff_width_m: 48.0,
            world_radius_m: 8192.0,
            ocean_rim: false,
            ocean_rim_drop_m: 42.0,
        }
    }
}

impl IslandShapeConfig {
    pub fn sanitized(mut self) -> Self {
        if !self.sea_level.is_finite() {
            self.sea_level = Self::default().sea_level;
        }
        self.spacing_m = self.spacing_m.max(64.0);
        self.radius_m = self.radius_m.max(16.0);
        self.blend_m = self.blend_m.max(1.0);
        self.warp_strength_m = self.warp_strength_m.max(0.0);
        self.beach_width_m = self.beach_width_m.max(1.0);
        self.cliff_width_m = self.cliff_width_m.max(1.0);
        self.world_radius_m = self.world_radius_m.max(1.0);
        self.ocean_rim_drop_m = self.ocean_rim_drop_m.max(1.0);
        self
    }
}

fn island_center(cell_x: i32, cell_z: i32, cfg: &IslandShapeConfig) -> (f32, f32, f32) {
    let ox = hash_position_seeded(
        cell_x.wrapping_mul(43),
        cell_z.wrapping_mul(59),
        cfg.seed.wrapping_add(1709),
    ) - 0.5;
    let oz = hash_position_seeded(
        cell_x.wrapping_mul(71),
        cell_z.wrapping_mul(37),
        cfg.seed.wrapping_add(2203),
    ) - 0.5;
    let radius_t = hash_position_seeded(
        cell_x.wrapping_mul(97),
        cell_z.wrapping_mul(83),
        cfg.seed.wrapping_add(3251),
    );
    (
        (cell_x as f32 + 0.5 + ox * 0.58) * cfg.spacing_m,
        (cell_z as f32 + 0.5 + oz * 0.58) * cfg.spacing_m,
        cfg.radius_m * (0.78 + radius_t * 0.44),
    )
}

pub fn sample_island_mask(x: f32, z: f32, config: &IslandShapeConfig) -> IslandMaskSample {
    let cfg = config.clone().sanitized();
    if !cfg.enabled {
        return IslandMaskSample {
            mask: 1.0,
            shore_distance_m: cfg.radius_m,
            nearest_center_x: 0.0,
            nearest_center_z: 0.0,
            cliff_weight: 0.0,
        };
    }

    let warp_x = (domain_warped_fbm2(
        x + 913.0,
        z - 311.0,
        DomainWarpSettings {
            fbm: FbmSettings {
                scale: 0.0007,
                octaves: 3,
                persistence: 0.52,
                lacunarity: 2.0,
                seed: cfg.seed.wrapping_add(4441),
            },
            warp_scale: 0.00021,
            warp_strength: cfg.warp_strength_m * 1.2,
        },
    ) * 2.0
        - 1.0)
        * cfg.warp_strength_m;
    let warp_z = (domain_warped_fbm2(
        x - 577.0,
        z + 1217.0,
        DomainWarpSettings {
            fbm: FbmSettings {
                scale: 0.0007,
                octaves: 3,
                persistence: 0.52,
                lacunarity: 2.0,
                seed: cfg.seed.wrapping_add(5059),
            },
            warp_scale: 0.00021,
            warp_strength: cfg.warp_strength_m * 1.2,
        },
    ) * 2.0
        - 1.0)
        * cfg.warp_strength_m;

    let sx = x + warp_x;
    let sz = z + warp_z;
    let cell_x = (sx / cfg.spacing_m).floor() as i32;
    let cell_z = (sz / cfg.spacing_m).floor() as i32;
    let mut best_mask = 0.0f32;
    let mut best_shore = f32::NEG_INFINITY;
    let mut nearest_center_x = 0.0;
    let mut nearest_center_z = 0.0;

    for dz in -2..=2 {
        for dx in -2..=2 {
            let (center_x, center_z, radius) = island_center(cell_x + dx, cell_z + dz, &cfg);
            let d = (sx - center_x).hypot(sz - center_z);
            let shore = radius - d;
            let outer = radius + cfg.blend_m;
            let mask = smooth01(1.0 - ((d - radius) / cfg.blend_m.max(1.0)).clamp(0.0, 1.0));
            let inside_boost = if d <= radius { 1.0 } else { mask };
            let island_mask = if d >= outer { 0.0 } else { inside_boost };
            best_mask = best_mask.max(island_mask);
            if shore > best_shore {
                best_shore = shore;
                nearest_center_x = center_x;
                nearest_center_z = center_z;
            }
        }
    }

    let cliff_noise = domain_warped_fbm2(
        x + 193.0,
        z - 877.0,
        DomainWarpSettings {
            fbm: FbmSettings {
                scale: 0.006,
                octaves: 3,
                persistence: 0.5,
                lacunarity: 2.1,
                seed: cfg.seed.wrapping_add(6427),
            },
            warp_scale: 0.0016,
            warp_strength: 46.0,
        },
    );

    IslandMaskSample {
        mask: best_mask.clamp(0.0, 1.0),
        shore_distance_m: best_shore,
        nearest_center_x,
        nearest_center_z,
        cliff_weight: smoothstep_range(0.58, 0.84, cliff_noise),
    }
}

pub fn apply_island_shape(x: f32, z: f32, inland_height: f32, config: &IslandShapeConfig) -> f32 {
    let cfg = config.clone().sanitized();
    if !cfg.enabled && !cfg.ocean_rim {
        return inland_height;
    }

    let mut height = inland_height;
    if cfg.enabled {
        let sample = sample_island_mask(x, z, &cfg);
        let ocean_floor = cfg.sea_level - 18.0;
        let cliff_target = inland_height.max(cfg.sea_level + 7.0 + sample.cliff_weight * 18.0);
        let beach_target =
            cfg.sea_level + smooth01(sample.shore_distance_m.max(0.0) / cfg.beach_width_m) * 3.5;
        let coast_t =
            smooth01(sample.shore_distance_m.max(0.0) / (cfg.beach_width_m + cfg.cliff_width_m));
        let coast_height =
            beach_target + (cliff_target - beach_target) * sample.cliff_weight * coast_t;
        let island_height = if sample.shore_distance_m < cfg.beach_width_m + cfg.cliff_width_m {
            inland_height.min(coast_height)
        } else {
            inland_height
        };
        height = ocean_floor + (island_height - ocean_floor) * sample.mask;
    }

    if cfg.ocean_rim {
        let d = x.hypot(z);
        let rim_t = smoothstep_range(cfg.world_radius_m * 0.9, cfg.world_radius_m, d);
        if rim_t > 0.0 {
            let rim_height = cfg.sea_level - 2.0 - cfg.ocean_rim_drop_m * rim_t;
            height = height.min(rim_height);
        }
    }

    height
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_island_mask_is_land() {
        let sample = sample_island_mask(100.0, 200.0, &IslandShapeConfig::default());
        assert_eq!(sample.mask, 1.0);
    }

    #[test]
    fn ocean_rim_lowers_far_edges() {
        let cfg = IslandShapeConfig {
            ocean_rim: true,
            ..IslandShapeConfig::default()
        };
        let center = apply_island_shape(0.0, 0.0, 80.0, &cfg);
        let edge = apply_island_shape(cfg.world_radius_m, 0.0, 80.0, &cfg);
        assert!(edge < center);
    }

    #[test]
    fn enabled_island_mask_is_deterministic() {
        let cfg = IslandShapeConfig {
            enabled: true,
            ..IslandShapeConfig::default()
        };
        let a = sample_island_mask(1200.0, -400.0, &cfg);
        let b = sample_island_mask(1200.0, -400.0, &cfg);
        assert_eq!(a, b);
    }
}
