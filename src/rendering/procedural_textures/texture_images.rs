use super::cache;
use super::config::ProceduralTextureConfig;
use super::errors::ProceduralTextureError;
use super::manifest::ProceduralTextureManifest;
use super::noise_bake::{NoiseBake, bake_noise_textures, sample_noise_channel};
use super::recipes::{ProceduralMaterialId, ProceduralMaterialRecipe};
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};

#[derive(Clone, Debug)]
pub struct GeneratedMaterialImages {
    pub id: ProceduralMaterialId,
    pub width: u32,
    pub height: u32,
    pub albedo_rgba: Vec<u8>,
    pub normal_rgba: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct GeneratedProceduralTextureSet {
    pub manifest: ProceduralTextureManifest,
    pub noise: NoiseBake,
    pub materials: Vec<GeneratedMaterialImages>,
}

impl GeneratedMaterialImages {
    pub fn albedo_image(&self) -> Image {
        image_from_rgba(
            self.width,
            self.height,
            self.albedo_rgba.clone(),
            TextureFormat::Rgba8UnormSrgb,
        )
    }

    pub fn normal_image(&self) -> Image {
        image_from_rgba(
            self.width,
            self.height,
            self.normal_rgba.clone(),
            TextureFormat::Rgba8Unorm,
        )
    }
}

impl GeneratedProceduralTextureSet {
    pub fn write_cache(&self, cache_dir: &str) -> Result<(), ProceduralTextureError> {
        cache::write_rgba_png(
            cache_dir,
            "noise_a.png",
            self.noise.resolution,
            self.noise.resolution,
            &self.noise.data_a,
        )?;
        cache::write_rgba_png(
            cache_dir,
            "noise_b.png",
            self.noise.resolution,
            self.noise.resolution,
            &self.noise.data_b,
        )?;
        for material in &self.materials {
            cache::write_rgba_png(
                cache_dir,
                &cache::material_albedo_filename(material.id),
                material.width,
                material.height,
                &material.albedo_rgba,
            )?;
            cache::write_rgba_png(
                cache_dir,
                &cache::material_normal_filename(material.id),
                material.width,
                material.height,
                &material.normal_rgba,
            )?;
        }
        cache::write_manifest(cache_dir, &self.manifest)
    }
}

fn clamp01(value: f32) -> f32 {
    value.clamp(0.0, 1.0)
}

fn color_byte(value: f32) -> u8 {
    (clamp01(value) * 255.0).round() as u8
}

fn image_from_rgba(width: u32, height: u32, rgba: Vec<u8>, format: TextureFormat) -> Image {
    let mut image = Image::new(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        rgba,
        format,
        RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
    );
    image.texture_descriptor.usage = TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST;
    image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::Repeat,
        address_mode_v: ImageAddressMode::Repeat,
        address_mode_w: ImageAddressMode::Repeat,
        mag_filter: ImageFilterMode::Linear,
        min_filter: ImageFilterMode::Linear,
        mipmap_filter: ImageFilterMode::Linear,
        anisotropy_clamp: 16,
        ..default()
    });
    image
}

fn material_albedo(
    id: ProceduralMaterialId,
    recipe: ProceduralMaterialRecipe,
    macro_noise: f32,
    meso_noise: f32,
    micro_noise: f32,
    worley: f32,
    y01: f32,
) -> [f32; 3] {
    let [mut r, mut g, mut b] = recipe.base_color;
    let macro_shift = (macro_noise - 0.5) * recipe.macro_strength;
    let meso_shift = (meso_noise - 0.5) * 0.22;
    r *= 1.0 + macro_shift + meso_shift;
    g *= 1.0 + macro_shift + meso_shift;
    b *= 1.0 + macro_shift + meso_shift;

    match id {
        ProceduralMaterialId::Rock => {
            let strata = 0.5 + 0.5 * (y01 * std::f32::consts::PI * 22.0 + macro_noise * 4.0).sin();
            let rust = recipe.strata_strength.unwrap_or(0.0) * (strata - 0.55).max(0.0);
            r *= 1.0 + rust * 0.55;
            g *= 1.0 - rust * 0.18;
            b *= 1.0 - rust * 0.32;
        }
        ProceduralMaterialId::Grass => {
            let dry = clamp01((worley - 0.44) * 2.2);
            r *= 1.0 + dry * 0.9;
            g *= 1.0 - dry * 0.18;
            b *= 1.0 - dry * 0.55;
        }
        ProceduralMaterialId::Snow => {
            let sparkle = recipe.sparkle_strength.unwrap_or(0.0) * (micro_noise - 0.85).max(0.0);
            r += sparkle;
            g += sparkle;
            b += sparkle;
        }
        ProceduralMaterialId::WetSoil => {
            r *= 0.72;
            g *= 0.76;
            b *= 0.82;
        }
        ProceduralMaterialId::Gravel => {
            let pebble = clamp01(1.0 - worley);
            let gain = 0.82 + pebble * 0.34;
            r *= gain;
            g *= gain;
            b *= gain;
        }
        _ => {}
    }

    [clamp01(r), clamp01(g), clamp01(b)]
}

pub fn generate_procedural_texture_set(
    config: &ProceduralTextureConfig,
) -> Result<GeneratedProceduralTextureSet, ProceduralTextureError> {
    let noise = bake_noise_textures(&config.noise, config.seed);
    let layer_size = config.terrain.layer_resolution.max(2);
    let manifest = ProceduralTextureManifest::expected(config)?;
    let mut materials = Vec::new();

    for id in ProceduralMaterialId::BEVY_TERRAIN_SLOTS {
        let recipe = config
            .terrain
            .materials
            .get(&id)
            .copied()
            .unwrap_or_else(|| {
                crate::rendering::procedural_textures::config::default_material_recipes()[&id]
            });
        let stride = (layer_size * layer_size * 4) as usize;
        let mut albedo_rgba = vec![0u8; stride];
        let mut normal_rgba = vec![0u8; stride];
        for y in 0..layer_size {
            for x in 0..layer_size {
                let u = (x as f32 + 0.5) / layer_size as f32;
                let v = (y as f32 + 0.5) / layer_size as f32;
                let layer = materials.len() as f32;
                let macro_noise = sample_noise_channel(
                    &noise.data_a,
                    noise.resolution,
                    u * 0.25 + layer * 0.113,
                    v * 0.25,
                    0,
                );
                let meso_noise = sample_noise_channel(
                    &noise.data_a,
                    noise.resolution,
                    u * 4.0 + layer * 0.071,
                    v * 4.0,
                    1,
                );
                let grad_x =
                    sample_noise_channel(&noise.data_a, noise.resolution, u * 8.0, v * 8.0, 2)
                        * 2.0
                        - 1.0;
                let grad_y =
                    sample_noise_channel(&noise.data_a, noise.resolution, u * 8.0, v * 8.0, 3)
                        * 2.0
                        - 1.0;
                let ridged = sample_noise_channel(
                    &noise.data_b,
                    noise.resolution,
                    u * 2.0 + layer * 0.17,
                    v * 2.0,
                    2,
                );
                let worley = sample_noise_channel(
                    &noise.data_b,
                    noise.resolution,
                    u * 3.0,
                    v * 3.0 + layer * 0.19,
                    3,
                );
                let micro_noise = sample_noise_channel(
                    &noise.data_a,
                    noise.resolution,
                    u * 15.0 + 0.37,
                    v * 15.0 + 0.61,
                    0,
                );
                let [r, g, b] =
                    material_albedo(id, recipe, macro_noise, meso_noise, micro_noise, worley, v);
                let i = ((y * layer_size + x) * 4) as usize;
                albedo_rgba[i] = color_byte(r);
                albedo_rgba[i + 1] = color_byte(g);
                albedo_rgba[i + 2] = color_byte(b);
                albedo_rgba[i + 3] = 255;

                let normal_enabled = if config.terrain.micro_normal.enabled {
                    1.0
                } else {
                    0.0
                };
                let strength = recipe.normal_strength
                    * config.terrain.micro_normal.max_strength
                    * normal_enabled
                    * (0.6 + ridged * 0.7);
                normal_rgba[i] = color_byte(0.5 - grad_x * strength);
                normal_rgba[i + 1] = color_byte(0.5 - grad_y * strength);
                normal_rgba[i + 2] = color_byte(1.0);
                normal_rgba[i + 3] = color_byte(recipe.roughness);
            }
        }
        materials.push(GeneratedMaterialImages {
            id,
            width: layer_size,
            height: layer_size,
            albedo_rgba,
            normal_rgba,
        });
    }

    Ok(GeneratedProceduralTextureSet {
        manifest,
        noise,
        materials,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::procedural_textures::config::ProceduralTextureConfig;

    #[test]
    fn generated_images_have_expected_dimensions_and_formats() {
        let mut config = ProceduralTextureConfig::default();
        config.noise.resolution = 8;
        config.terrain.layer_resolution = 8;

        let generated = generate_procedural_texture_set(&config).expect("generate textures");
        assert_eq!(generated.materials.len(), 4);
        for material in &generated.materials {
            assert_eq!(material.width, 8);
            assert_eq!(material.height, 8);
            assert_eq!(material.albedo_rgba.len(), 8 * 8 * 4);
            assert_eq!(material.normal_rgba.len(), 8 * 8 * 4);
            assert_eq!(
                material.albedo_image().texture_descriptor.format,
                TextureFormat::Rgba8UnormSrgb
            );
            assert_eq!(
                material.normal_image().texture_descriptor.format,
                TextureFormat::Rgba8Unorm
            );
        }
    }
}
