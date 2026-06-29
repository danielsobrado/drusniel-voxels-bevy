use super::island_shape::apply_island_shape;
use super::noise::{
    DomainWarpSettings, FbmSettings, domain_warped_fbm2, fbm2, hash_position_seeded, ridged_fbm2,
    smooth01, smoothstep_range,
};
use super::world_source::TerrainFieldConfig;

#[derive(Debug, Clone, Copy)]
struct TerrainConstants {
    min_height: f32,
    max_height: f32,
    continent: NoiseConstants,
    mountains: MountainConstants,
    hills: NoiseConstants,
    detail: NoiseConstants,
}

#[derive(Debug, Clone, Copy)]
struct NoiseConstants {
    scale: f32,
    amplitude: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
    warp_strength: f32,
}

#[derive(Debug, Clone, Copy)]
struct MountainConstants {
    scale: f32,
    amplitude: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
    ridge_power: f32,
    massif_scale: f32,
    massif_amplitude: f32,
    massif_threshold: f32,
    massif_power: f32,
    warp_strength: f32,
}

const TERRAIN: TerrainConstants = TerrainConstants {
    min_height: 14.0,
    max_height: 118.0,
    continent: NoiseConstants {
        scale: 0.001,
        amplitude: 40.0,
        octaves: 2,
        persistence: 0.5,
        lacunarity: 2.0,
        warp_strength: 220.0,
    },
    mountains: MountainConstants {
        scale: 0.008,
        amplitude: 120.0,
        octaves: 7,
        persistence: 0.48,
        lacunarity: 2.3,
        ridge_power: 1.8,
        massif_scale: 0.0035,
        massif_amplitude: 38.0,
        massif_threshold: 0.38,
        massif_power: 1.65,
        warp_strength: 52.0,
    },
    hills: NoiseConstants {
        scale: 0.025,
        amplitude: 25.0,
        octaves: 4,
        persistence: 0.5,
        lacunarity: 2.0,
        warp_strength: 19.0,
    },
    detail: NoiseConstants {
        scale: 0.1,
        amplitude: 3.0,
        octaves: 3,
        persistence: 0.5,
        lacunarity: 2.0,
        warp_strength: 4.0,
    },
};

fn fbm_configurable(x: f32, z: f32, cfg: NoiseConstants, seed: i32) -> f32 {
    fbm2(
        x,
        z,
        FbmSettings {
            scale: cfg.scale,
            octaves: cfg.octaves,
            persistence: cfg.persistence,
            lacunarity: cfg.lacunarity,
            seed,
        },
    )
}

fn domain_fbm_configurable(x: f32, z: f32, cfg: NoiseConstants, seed: i32) -> f32 {
    domain_warped_fbm2(
        x,
        z,
        DomainWarpSettings {
            fbm: FbmSettings {
                scale: cfg.scale,
                octaves: cfg.octaves,
                persistence: cfg.persistence,
                lacunarity: cfg.lacunarity,
                seed,
            },
            warp_scale: cfg.scale * 0.31,
            warp_strength: cfg.warp_strength,
        },
    )
}

fn domain_fbm_custom(
    x: f32,
    z: f32,
    scale: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
    warp_strength: f32,
    seed: i32,
) -> f32 {
    domain_warped_fbm2(
        x,
        z,
        DomainWarpSettings {
            fbm: FbmSettings {
                scale,
                octaves,
                persistence,
                lacunarity,
                seed,
            },
            warp_scale: scale * 0.31,
            warp_strength,
        },
    )
}

fn ridged_noise(x: f32, z: f32, seed: i32) -> f32 {
    let cfg = TERRAIN.mountains;
    ridged_fbm2(
        x,
        z,
        FbmSettings {
            scale: cfg.scale,
            octaves: cfg.octaves,
            persistence: cfg.persistence,
            lacunarity: cfg.lacunarity,
            seed: seed.wrapping_add(37),
        },
        cfg.ridge_power,
    ) * cfg.amplitude
}

fn massif_cell_mask(x: f32, z: f32, seed: i32) -> f32 {
    let cfg = TERRAIN.mountains;
    let spacing = (1.0 / cfg.massif_scale.max(0.001)).clamp(128.0, 384.0);
    let cell_x = (x / spacing).floor() as i32;
    let cell_z = (z / spacing).floor() as i32;
    let mut strongest = 0.0f32;

    for dz in -1..=1 {
        for dx in -1..=1 {
            let cx = cell_x + dx;
            let cz = cell_z + dz;
            let offset_x =
                hash_position_seeded(cx.wrapping_mul(43), cz.wrapping_mul(59), seed) - 0.5;
            let offset_z =
                hash_position_seeded(cx.wrapping_mul(71), cz.wrapping_mul(37), seed) - 0.5;
            let height_t =
                0.55 + hash_position_seeded(cx.wrapping_mul(97), cz.wrapping_mul(83), seed) * 0.45;
            let radius_t = hash_position_seeded(cx.wrapping_mul(113), cz.wrapping_mul(131), seed);
            let center_x = (cx as f32 + 0.5 + offset_x * 0.55) * spacing;
            let center_z = (cz as f32 + 0.5 + offset_z * 0.55) * spacing;
            let radius = spacing * (0.42 + radius_t * 0.22);
            let dist = (x - center_x).hypot(z - center_z);
            let falloff = (1.0 - dist / radius.max(1.0)).clamp(0.0, 1.0);
            let mask = smooth01(falloff).powf(cfg.massif_power.max(0.25));
            strongest = strongest.max(mask * height_t);
        }
    }
    strongest
}

fn soften_height_cap(height: f32, min_height: f32, max_height: f32) -> f32 {
    let ceiling_start = (max_height - 18.0).max(min_height);
    let ceiling = max_height - 0.5;
    if height <= ceiling_start || ceiling <= ceiling_start {
        return height;
    }
    let range = ceiling - ceiling_start;
    let excess = height - ceiling_start;
    ceiling_start + (range * excess) / (excess + range)
}

pub fn base_surface_height(x: f32, z: f32, field: &TerrainFieldConfig) -> f32 {
    let seed = field.seed;
    let min_normal_surface_y = field.sea_level - 4.0;
    let base_elevation = min_normal_surface_y;
    let continent_noise = domain_fbm_configurable(x, z, TERRAIN.continent, seed.wrapping_add(101));
    let continent = continent_noise * TERRAIN.continent.amplitude * 0.55;

    let mountain_signal = domain_fbm_custom(
        x,
        z,
        TERRAIN.mountains.scale * 0.25,
        2,
        0.5,
        2.0,
        TERRAIN.mountains.warp_strength,
        seed.wrapping_add(211),
    );
    let massif_signal = domain_fbm_custom(
        x + 4096.0,
        z - 2048.0,
        TERRAIN.mountains.massif_scale,
        3,
        0.52,
        2.0,
        TERRAIN.mountains.warp_strength * 1.6,
        seed.wrapping_add(307),
    );
    let massif_mask = smoothstep_range(TERRAIN.mountains.massif_threshold, 1.0, massif_signal)
        .powf(TERRAIN.mountains.massif_power.max(0.25))
        .max(massif_cell_mask(x, z, seed));
    let mountain_region_base = mountain_signal.clamp(0.0, 1.0).powf(1.35);
    let mountain_region = (mountain_region_base * 0.55 + massif_mask * 0.8).clamp(0.0, 1.0);
    let mountains = ridged_noise(x, z, seed) * mountain_region * (1.0 + massif_mask * 0.55);
    let mountain_uplift = TERRAIN.mountains.amplitude * 0.18 * mountain_region
        + TERRAIN.mountains.massif_amplitude * massif_mask;

    let valley_signal = domain_fbm_custom(
        x + 1375.0,
        z - 911.0,
        TERRAIN.continent.scale * 2.2,
        3,
        0.55,
        2.0,
        120.0,
        seed.wrapping_add(409),
    );
    let valley_mask = smoothstep_range(0.22, 0.08, valley_signal);
    let valley_carve = valley_mask * 14.0 * (1.0 - mountain_region * 0.75);

    let hills = domain_fbm_configurable(x, z, TERRAIN.hills, seed.wrapping_add(503))
        * TERRAIN.hills.amplitude
        * 0.45;
    let detail_noise = fbm_configurable(x, z, TERRAIN.detail, seed.wrapping_add(607)) * 0.65
        + domain_fbm_custom(
            x,
            z,
            TERRAIN.detail.scale * 0.8,
            2,
            0.5,
            2.0,
            TERRAIN.detail.warp_strength,
            seed.wrapping_add(701),
        ) * 0.35;
    let detail = detail_noise * TERRAIN.detail.amplitude;

    let min_surface = TERRAIN.min_height.max(min_normal_surface_y);
    let height =
        base_elevation + continent + mountains + mountain_uplift + hills + detail - valley_carve;
    let capped = soften_height_cap(height, min_surface, TERRAIN.max_height)
        .clamp(min_surface, TERRAIN.max_height - 0.5);
    apply_island_shape(x, z, capped, &field.island_shape)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::world_source::TerrainFieldConfig;

    #[test]
    fn height_field_is_deterministic() {
        let cfg = TerrainFieldConfig::default();
        assert_eq!(
            base_surface_height(128.0, 64.0, &cfg),
            base_surface_height(128.0, 64.0, &cfg)
        );
    }

    #[test]
    fn height_field_varies_across_coordinates() {
        let cfg = TerrainFieldConfig::default();
        let a = base_surface_height(0.0, 0.0, &cfg);
        let b = base_surface_height(512.0, -384.0, &cfg);
        assert!((a - b).abs() > 0.1);
    }
}
