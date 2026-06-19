//! Deterministic stone scatter over a world area. Same terrain + config + area ⇒ identical
//! instance list. Reuses the project's `deterministic_hash` / `hash_to_seed` (props/mod.rs) so
//! placement matches the calculate-once / persist-forever prop model and the CLOD-PoC overlay.

use bevy::math::{Vec2, Vec3};

use crate::constants::WATER_LEVEL;
use crate::voxel::terrain::{NoiseGenerator, TerrainGenerator};

use super::config::{StoneClassId, StoneConfig};
use super::hash::StoneRng;
use super::rock_mesh::RockPreset;
use super::site_sample::{StoneSiteSample, sample_site};
use super::{deterministic_hash, hash_to_seed};

const TAU: f32 = std::f32::consts::TAU;

fn seeded_hash(cfg: &StoneConfig, x: i32, z: i32, id: &str) -> f32 {
    deterministic_hash(
        x.wrapping_add(cfg.seed_salt),
        z.wrapping_sub(cfg.seed_salt),
        id,
    )
}

fn seeded_seed(cfg: &StoneConfig, x: i32, z: i32, id: &str) -> u64 {
    hash_to_seed(
        x.wrapping_add(cfg.seed_salt),
        z.wrapping_sub(cfg.seed_salt),
        id,
    )
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StoneInstance {
    pub position: Vec3,
    pub scale: f32,
    pub yaw: f32,
    pub lean: Vec2,
    pub class_id: StoneClassId,
    pub preset: RockPreset,
    pub variant: u8,
    pub seed: u64,
}

/// Combined acceptance weight (≥0; >1 means certain).
fn stone_weight(site: &StoneSiteSample, cfg: &StoneConfig, gx: i32, gz: i32) -> f32 {
    if site.standing_water || site.repose <= 0.0 {
        return 0.0;
    }
    let clump = (cfg.cell_size_m * cfg.patch_clump_cell_mult).max(1.0);
    let patch_clump = cfg.patch_clump_min
        + seeded_hash(
            cfg,
            (gx as f32 / clump).floor() as i32,
            (gz as f32 / clump).floor() as i32,
            "stone_clump",
        );
    let base = site.rock_exposure * cfg.rock_exposure_weight
        + site.scree * cfg.scree_weight
        + site.streambed * cfg.stream_weight
        + site.cliff_above * cfg.cliff_above_weight
        + cfg.base_soil_weight;
    cfg.density * base * patch_clump * site.repose * (1.0 - site.snow * cfg.snow_fade)
}

fn select_class(site: &StoneSiteSample, cfg: &StoneConfig, roll: f32) -> StoneClassId {
    // Large stones gather in scree fans / below cliffs / in streambeds, but stay a minority:
    // the bias is capped so the small class keeps dominating the ground-cover layer.
    let large_bias = (1.0
        + site.scree * 0.5
        + site.cliff_above * 0.6
        + site.streambed * cfg.stream_large_bias * 3.0)
        .min(2.0);
    let weights = [
        StoneClassId::Large.base_weight() * large_bias,
        StoneClassId::Medium.base_weight(),
        StoneClassId::Small.base_weight(),
    ];
    let total = weights[0] + weights[1] + weights[2];
    let target = roll * total;
    let mut acc = 0.0;
    for (i, w) in weights.iter().enumerate() {
        acc += w;
        if target < acc {
            return StoneClassId::ALL[i];
        }
    }
    StoneClassId::Small
}

fn select_preset(
    class: StoneClassId,
    site: &StoneSiteSample,
    cfg: &StoneConfig,
    roll: f32,
) -> RockPreset {
    let presets = &cfg.class(class).presets;
    if presets.is_empty() {
        return RockPreset::Cobble;
    }
    if presets.len() == 1 {
        return presets[0];
    }
    if site.streambed > 0.4 && presets.contains(&RockPreset::Boulder) {
        return RockPreset::Boulder;
    }
    if (site.scree > 0.3 || site.cliff_above > 0.3) && presets.contains(&RockPreset::Talus) {
        return RockPreset::Talus;
    }
    presets[(roll * presets.len() as f32).floor() as usize % presets.len()]
}

/// Scatter stones over the half-open world area `[min_x, max_x) × [min_z, max_z)`.
/// Accepted candidates are ranked by a stable priority hash and truncated to `max_instances`.
pub fn generate_stones_in_area<N: NoiseGenerator>(
    terrain: &TerrainGenerator<N>,
    min_x: i32,
    min_z: i32,
    max_x: i32,
    max_z: i32,
    cfg: &StoneConfig,
) -> Vec<StoneInstance> {
    generate_ranked_stones_in_area(terrain, min_x, min_z, max_x, max_z, cfg)
        .into_iter()
        .take(cfg.max_instances)
        .map(|(_, instance)| instance)
        .collect()
}

pub fn generate_ranked_stones_in_area<N: NoiseGenerator>(
    terrain: &TerrainGenerator<N>,
    min_x: i32,
    min_z: i32,
    max_x: i32,
    max_z: i32,
    cfg: &StoneConfig,
) -> Vec<(f32, StoneInstance)> {
    if cfg.density <= 0.0 || cfg.max_instances == 0 {
        return Vec::new();
    }
    let spacing = cfg.cell_size_m.max(0.1);
    let columns = (((max_x - min_x) as f32) / spacing).floor().max(0.0) as i32;
    let rows = (((max_z - min_z) as f32) / spacing).floor().max(0.0) as i32;
    let water_floor = WATER_LEVEL as f32 + cfg.water_margin_m + cfg.standing_water_cutoff_m;

    let mut ranked: Vec<(f32, StoneInstance)> = Vec::new();
    for row in 0..rows {
        for column in 0..columns {
            let grid_x = (min_x as f32 / spacing).floor() as i32 + column;
            let grid_z = (min_z as f32 / spacing).floor() as i32 + row;
            let jx = (seeded_hash(cfg, grid_x, grid_z, "stone_jx") * 2.0 - 1.0) * spacing * 0.34;
            let jz = (seeded_hash(cfg, grid_x, grid_z, "stone_jz") * 2.0 - 1.0) * spacing * 0.34;
            let fx = min_x as f32 + (column as f32 + 0.5) * spacing + jx;
            let fz = min_z as f32 + (row as f32 + 0.5) * spacing + jz;
            let wx = fx.round() as i32;
            let wz = fz.round() as i32;

            let site = sample_site(terrain, wx, wz, cfg);
            if site.height < water_floor {
                continue;
            }
            let weight = stone_weight(&site, cfg, grid_x, grid_z);
            if weight <= 0.0 {
                continue;
            }
            if seeded_hash(cfg, grid_x, grid_z, "stone_accept") >= weight {
                continue;
            }

            // Per-cell strong PRNG for the categorical / continuous draws (the single-round
            // spatial hashes band on the structured grid; sfc32 does not).
            let seed = seeded_seed(cfg, grid_x, grid_z, "stone");
            let mut rng = StoneRng::new(seed as u32);
            let class = select_class(&site, cfg, rng.next_f32());
            let class_cfg = cfg.class(class);
            let preset = select_preset(class, &site, cfg, rng.next_f32());
            let variants = class_cfg.variants.max(1).min(u8::MAX as u32);
            let variant = (rng.next_u32() % variants) as u8;

            let target_radius = class_cfg.radius_min
                + (class_cfg.radius_max - class_cfg.radius_min) * rng.next_f32();
            let scale = target_radius / preset.params().radius;

            let slope_amt = 1.0 - site.normal_y;
            let sink_depth =
                class_cfg.sink * target_radius * (1.0 + slope_amt * cfg.sink_slope_multiplier);
            let y = site.height - sink_depth;
            let lean = site.normal_xz * cfg.normal_lean * slope_amt;
            let yaw = rng.next_f32() * TAU;

            ranked.push((
                seeded_hash(cfg, grid_x, grid_z, "stone_priority"),
                StoneInstance {
                    position: Vec3::new(fx, y, fz),
                    scale,
                    yaw,
                    lean,
                    class_id: class,
                    preset,
                    variant,
                    seed,
                },
            ));
        }
    }

    ranked.sort_by(|a, b| a.0.total_cmp(&b.0));
    ranked
}

/// Class-share breakdown for tests / debug.
pub fn class_shares(instances: &[StoneInstance]) -> [f32; 3] {
    let mut counts = [0.0_f32; 3];
    for instance in instances {
        let index = StoneClassId::ALL
            .iter()
            .position(|c| *c == instance.class_id)
            .unwrap();
        counts[index] += 1.0;
    }
    let total = instances.len().max(1) as f32;
    [counts[0] / total, counts[1] / total, counts[2] / total]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::generation::config::TerrainConfig;
    use crate::voxel::terrain::ValueNoise;

    fn terrain() -> TerrainGenerator<ValueNoise> {
        TerrainGenerator::with_config(ValueNoise::default(), TerrainConfig::default())
    }

    fn enabled_config() -> StoneConfig {
        StoneConfig {
            enabled: true,
            density: 1.0,
            ..StoneConfig::default()
        }
    }

    #[test]
    fn scatter_is_deterministic() {
        let t = terrain();
        let cfg = enabled_config();
        let a = generate_stones_in_area(&t, -256, -256, 256, 256, &cfg);
        let b = generate_stones_in_area(&t, -256, -256, 256, 256, &cfg);
        assert!(!a.is_empty());
        assert_eq!(a, b);
    }

    #[test]
    fn differs_for_different_salt() {
        let t = terrain();
        let a = generate_stones_in_area(&t, -256, -256, 256, 256, &enabled_config());
        let b = generate_stones_in_area(
            &t,
            -256,
            -256,
            256,
            256,
            &StoneConfig {
                seed_salt: 931_778,
                ..enabled_config()
            },
        );
        assert_ne!(a, b);
    }

    #[test]
    fn never_floats_above_terrain() {
        let t = terrain();
        let cfg = enabled_config();
        for stone in generate_stones_in_area(&t, -256, -256, 256, 256, &cfg) {
            let h = t.get_height(
                stone.position.x.round() as i32,
                stone.position.z.round() as i32,
            ) as f32;
            assert!(
                stone.position.y <= h + 1.0,
                "stone floats: y={} h={}",
                stone.position.y,
                h
            );
        }
    }

    #[test]
    fn never_in_standing_water() {
        let t = terrain();
        let cfg = enabled_config();
        for stone in generate_stones_in_area(&t, -256, -256, 256, 256, &cfg) {
            let climate = t.get_climate(
                stone.position.x.round() as i32,
                stone.position.z.round() as i32,
            );
            assert!(!climate.standing_water);
        }
    }

    #[test]
    fn size_stratification_small_over_large() {
        let t = terrain();
        let shares = class_shares(&generate_stones_in_area(
            &t,
            -256,
            -256,
            256,
            256,
            &enabled_config(),
        ));
        assert!((shares[0] + shares[1] + shares[2] - 1.0).abs() < 1e-4);
        assert!(
            shares[2] > shares[0],
            "small {} should exceed large {}",
            shares[2],
            shares[0]
        );
        assert!(shares[0] > 0.0 && shares[1] > 0.0);
    }

    #[test]
    fn density_zero_is_empty() {
        let t = terrain();
        let cfg = StoneConfig {
            density: 0.0,
            ..enabled_config()
        };
        assert!(generate_stones_in_area(&t, -256, -256, 256, 256, &cfg).is_empty());
    }
}
