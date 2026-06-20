use super::config::ProceduralSupportMapConfig;
use super::noise_bake::{NoiseBake, sample_noise_channel};

#[derive(Clone, Debug)]
pub struct TerrainClassificationBake {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn color_byte(value: f32) -> u8 {
    (clamp01(value) * 255.0).round() as u8
}

fn smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    let t = clamp01((value - edge0) / (edge1 - edge0).max(0.0001));
    t * t * (3.0 - 2.0 * t)
}

pub fn bake_terrain_classification_a(
    config: &ProceduralSupportMapConfig,
    noise: &NoiseBake,
) -> TerrainClassificationBake {
    let resolution = noise.resolution.max(2);
    let mut rgba = vec![0u8; (resolution * resolution * 4) as usize];
    let masks = config.terrain.masks;
    for y in 0..resolution {
        for x in 0..resolution {
            let u = (x as f32 + 0.5) / resolution as f32;
            let v = (y as f32 + 0.5) / resolution as f32;
            let macro_noise = sample_noise_channel(&noise.data_a, noise.resolution, u, v, 1);
            let ridged = sample_noise_channel(&noise.data_b, noise.resolution, u * 2.0, v * 2.0, 2);
            let worley = sample_noise_channel(&noise.data_b, noise.resolution, u * 2.5, v * 2.5, 3);
            let height = 8.0 + macro_noise * 92.0 + ridged * 28.0;
            let upness = clamp01(1.0 - ridged * 0.55);
            let slope = clamp01(1.0 - upness);
            let snow = smoothstep(masks.snow_height[0], masks.snow_height[1], height)
                * smoothstep(masks.snow_upness[0], masks.snow_upness[1], upness);
            let wetness = (1.0 - smoothstep(masks.wet_height[0], masks.wet_height[1], height))
                * smoothstep(masks.wet_upness[0], masks.wet_upness[1], upness)
                * (0.65 + worley * 0.35);
            let vegetation = smoothstep(10.0, 42.0, height)
                * (1.0 - smoothstep(68.0, 104.0, height))
                * smoothstep(0.45, 0.92, upness)
                * (1.0 - snow);
            let rock_exposure = smoothstep(masks.gravel_slope[0], masks.gravel_slope[1], slope)
                * (0.55 + ridged * 0.45)
                * (1.0 - wetness * 0.35);
            let i = ((y * resolution + x) * 4) as usize;
            rgba[i] = color_byte(snow);
            rgba[i + 1] = color_byte(wetness);
            rgba[i + 2] = color_byte(vegetation);
            rgba[i + 3] = color_byte(rock_exposure);
        }
    }
    TerrainClassificationBake {
        width: resolution,
        height: resolution,
        rgba,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::procedural_support_maps::config::ProceduralSupportMapConfig;
    use crate::rendering::procedural_support_maps::noise_bake::bake_noise_textures;

    #[test]
    fn classification_bake_is_deterministic_and_rgba8() {
        let mut config = ProceduralSupportMapConfig::default();
        config.noise.resolution = 8;
        let noise = bake_noise_textures(&config.noise, config.seed);
        let first = bake_terrain_classification_a(&config, &noise);
        let second = bake_terrain_classification_a(&config, &noise);

        assert_eq!(first.width, 8);
        assert_eq!(first.height, 8);
        assert_eq!(first.rgba.len(), 8 * 8 * 4);
        assert_eq!(first.rgba, second.rgba);
    }
}
