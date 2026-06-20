use super::config::{BarkSpeciesConfig, BarkSynthesisParams, BarkTextureConfig};
use super::noise_bake::{periodic_value_noise_2d, periodic_worley_f1_edge};
use super::seed_streams::stable_seed_stream;

#[derive(Clone, Debug)]
pub struct GeneratedBarkImages {
    pub id: String,
    pub label: String,
    pub width: u32,
    pub height: u32,
    pub albedo_rgba: Vec<u8>,
    pub normal_rgba: Vec<u8>,
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn color_byte(value: f32) -> u8 {
    (clamp01(value) * 255.0).round() as u8
}

fn pfbm(x: f32, y: f32, octaves: u32, period: f32, seed: u32) -> f32 {
    let mut sum = 0.0;
    let mut amp = 0.5;
    let mut scale = 1.0;
    for octave in 0..octaves {
        sum += periodic_value_noise_2d(
            x * scale,
            y * scale,
            (period * scale).round().max(1.0) as i32,
            seed + octave * 7,
        ) * amp;
        amp *= 0.5;
        scale *= 2.0;
    }
    sum
}

fn bark_height(params: BarkSynthesisParams, u: f32, v: f32, seed: u32) -> f32 {
    let warp_x = (pfbm(u * 6.0, v * 6.0, 2, 6.0, seed + 31) - 0.5) * params.warp * 0.12;
    let warp_y = (pfbm(u * 6.0, v * 6.0, 2, 6.0, seed + 67) - 0.5) * params.warp * 0.12;
    let qx = u + warp_x;
    let qy = v + warp_y;
    let [f1, edge] = periodic_worley_f1_edge(
        qx * params.plates[0],
        qy * params.plates[1],
        params.plates[0],
        params.plates[1],
        seed,
    );
    let fissure = clamp01(edge / params.fissure_w.max(0.0001));
    let mut height = fissure.powf(0.65) * params.fissure_depth + f1 * params.plate_round;
    if params.vert_crack > 0.0 {
        let lanes = (params.plates[0] * 0.5).round().max(1.0);
        let crack_phase = qx * lanes + pfbm(qx * 3.0, qy * 3.0, 2, 3.0, seed + 5) * 1.4;
        let crack = ((crack_phase - crack_phase.floor()) - 0.5).abs() * 2.0;
        height *= (clamp01(crack / 0.22).powf(0.5) * params.vert_crack) + (1.0 - params.vert_crack);
    }
    height += (pfbm(u * 24.0, v * 24.0, 3, 24.0, seed + 91) - 0.5) * params.micro;
    height
}

fn bake_species(
    species: &BarkSpeciesConfig,
    root_seed: u32,
    resolution: u32,
) -> GeneratedBarkImages {
    let resolution = resolution.max(2);
    let params = species.params;
    let seed =
        stable_seed_stream(root_seed, "bark_synth") ^ stable_seed_stream(root_seed, &species.id);
    let mut albedo_rgba = vec![0u8; (resolution * resolution * 4) as usize];
    let mut normal_rgba = vec![0u8; (resolution * resolution * 4) as usize];
    let e = 1.6 / resolution as f32;

    for y in 0..resolution {
        for x in 0..resolution {
            let u = (x as f32 + 0.5) / resolution as f32;
            let v = (y as f32 + 0.5) / resolution as f32;
            let height = bark_height(params, u, v, seed);
            let hx0 = bark_height(params, u - e, v, seed);
            let hx1 = bark_height(params, u + e, v, seed);
            let hy0 = bark_height(params, u, v - e, seed);
            let hy1 = bark_height(params, u, v + e, seed);
            let nx = (hx0 - hx1) * params.normal_k * 0.5;
            let ny = (hy0 - hy1) * params.normal_k * 0.5;
            let inv_len = 1.0 / (nx * nx + ny * ny + 1.0).sqrt().max(0.0001);
            let h01 = clamp01(height);
            let mottle =
                (periodic_value_noise_2d(u * 2.0, v * 2.0, 2, seed + 201) - 0.5) * params.mottle;
            let mut r = (params.deep[0] + (params.high[0] - params.deep[0]) * h01) * (1.0 + mottle);
            let mut g = (params.deep[1] + (params.high[1] - params.deep[1]) * h01) * (1.0 + mottle);
            let mut b = (params.deep[2] + (params.high[2] - params.deep[2]) * h01) * (1.0 + mottle);
            if params.lenticels > 0.0 {
                let [dash_f1, _] = periodic_worley_f1_edge(u * 5.0, v * 24.0, 5.0, 24.0, seed + 77);
                let dash = 1.0 - clamp01((dash_f1 - 0.2) / 0.22);
                r += (0.045 - r) * dash * 0.85;
                g += (0.04 - g) * dash * 0.85;
                b += (0.038 - b) * dash * 0.85;
            }
            let rough = clamp01(params.rough_base + (height - 0.5) * params.rough_var * 2.0);
            let i = ((y * resolution + x) * 4) as usize;
            albedo_rgba[i] = color_byte(clamp01(r).sqrt());
            albedo_rgba[i + 1] = color_byte(clamp01(g).sqrt());
            albedo_rgba[i + 2] = color_byte(clamp01(b).sqrt());
            albedo_rgba[i + 3] = color_byte(h01 * 0.7 + 0.3);
            normal_rgba[i] = color_byte(nx * inv_len * 0.5 + 0.5);
            normal_rgba[i + 1] = color_byte(ny * inv_len * 0.5 + 0.5);
            normal_rgba[i + 2] = color_byte(rough.max(0.3));
            normal_rgba[i + 3] = color_byte(h01);
        }
    }

    GeneratedBarkImages {
        id: species.id.clone(),
        label: species.label.clone(),
        width: resolution,
        height: resolution,
        albedo_rgba,
        normal_rgba,
    }
}

pub fn bake_bark_textures(config: &BarkTextureConfig, seed: u32) -> Vec<GeneratedBarkImages> {
    if !config.enabled {
        return Vec::new();
    }
    config
        .species
        .iter()
        .map(|species| bake_species(species, seed, config.resolution))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::procedural_textures::config::default_bark_species;

    fn tiny_bark_config() -> BarkTextureConfig {
        BarkTextureConfig {
            resolution: 16,
            species: default_bark_species(),
            ..Default::default()
        }
    }

    #[test]
    fn default_species_match_reference_bark_synth_table() {
        let ids = default_bark_species()
            .into_iter()
            .map(|species| species.id)
            .collect::<Vec<_>>();
        assert_eq!(
            ids,
            vec!["spruce", "pine", "beech", "birch", "karst_gnarl", "snag"]
        );
    }

    #[test]
    fn bark_bake_is_deterministic_and_seeded() {
        let config = tiny_bark_config();
        let first = bake_bark_textures(&config, 77);
        let second = bake_bark_textures(&config, 77);
        let changed = bake_bark_textures(&config, 78);

        assert_eq!(first.len(), 6);
        assert_eq!(first[1].id, "pine");
        assert_eq!(first[1].width, 16);
        assert_eq!(first[1].albedo_rgba.len(), 16 * 16 * 4);
        assert_eq!(first[1].normal_rgba.len(), 16 * 16 * 4);
        assert_eq!(first[1].albedo_rgba, second[1].albedo_rgba);
        assert_eq!(first[1].normal_rgba, second[1].normal_rgba);
        assert_ne!(first[1].albedo_rgba, changed[1].albedo_rgba);
        assert_ne!(first[1].albedo_rgba, first[2].albedo_rgba);
    }

    #[test]
    fn disabled_bark_bake_emits_no_images() {
        let mut config = tiny_bark_config();
        config.enabled = false;

        assert!(bake_bark_textures(&config, 77).is_empty());
    }
}
