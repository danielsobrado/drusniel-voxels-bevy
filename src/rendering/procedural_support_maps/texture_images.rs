use super::cache;
use super::classification_bake::{TerrainClassificationBake, bake_terrain_classification_a};
use super::config::ProceduralSupportMapConfig;
use super::errors::ProceduralSupportMapError;
use super::manifest::ProceduralSupportMapManifest;
use super::noise_bake::{NoiseBake, bake_noise_textures};
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};

#[derive(Clone, Debug)]
pub struct GeneratedProceduralSupportMapSet {
    pub manifest: ProceduralSupportMapManifest,
    pub noise: NoiseBake,
    pub classification: TerrainClassificationBake,
}

impl GeneratedProceduralSupportMapSet {
    pub fn noise_a_image(&self) -> Image {
        support_map_image(
            self.noise.resolution,
            self.noise.resolution,
            self.noise.data_a.clone(),
        )
    }

    pub fn noise_b_image(&self) -> Image {
        support_map_image(
            self.noise.resolution,
            self.noise.resolution,
            self.noise.data_b.clone(),
        )
    }

    pub fn classification_a_image(&self) -> Image {
        support_map_image(
            self.classification.width,
            self.classification.height,
            self.classification.rgba.clone(),
        )
    }

    pub fn write_cache(&self, cache_dir: &str) -> Result<(), ProceduralSupportMapError> {
        cache::write_rgba_png(
            cache_dir,
            &self.manifest.outputs.noise_a,
            self.noise.resolution,
            self.noise.resolution,
            &self.noise.data_a,
        )?;
        cache::write_rgba_png(
            cache_dir,
            &self.manifest.outputs.noise_b,
            self.noise.resolution,
            self.noise.resolution,
            &self.noise.data_b,
        )?;
        cache::write_rgba_png(
            cache_dir,
            &self.manifest.outputs.terrain_classification_a,
            self.classification.width,
            self.classification.height,
            &self.classification.rgba,
        )?;
        cache::write_manifest(cache_dir, &self.manifest)
    }
}

fn support_map_image(width: u32, height: u32, rgba: Vec<u8>) -> Image {
    let mut image = Image::new(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        rgba,
        TextureFormat::Rgba8Unorm,
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

pub fn generate_procedural_support_map_set(
    config: &ProceduralSupportMapConfig,
) -> Result<GeneratedProceduralSupportMapSet, ProceduralSupportMapError> {
    let noise = bake_noise_textures(&config.noise, config.seed);
    let classification = bake_terrain_classification_a(config, &noise);
    let manifest = ProceduralSupportMapManifest::expected(config)?;

    Ok(GeneratedProceduralSupportMapSet {
        manifest,
        noise,
        classification,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::procedural_support_maps::config::ProceduralSupportMapConfig;

    #[test]
    fn generated_support_maps_have_expected_dimensions_and_formats() {
        let mut config = ProceduralSupportMapConfig::default();
        config.noise.resolution = 8;

        let generated = generate_procedural_support_map_set(&config).expect("generate maps");
        assert_eq!(generated.noise.resolution, 8);
        assert_eq!(generated.noise.data_a.len(), 8 * 8 * 4);
        assert_eq!(generated.noise.data_b.len(), 8 * 8 * 4);
        assert_eq!(generated.classification.width, 8);
        assert_eq!(generated.classification.height, 8);
        assert_eq!(generated.classification.rgba.len(), 8 * 8 * 4);
        assert_eq!(
            generated.noise_a_image().texture_descriptor.format,
            TextureFormat::Rgba8Unorm
        );
        assert_eq!(
            generated.classification_a_image().texture_descriptor.format,
            TextureFormat::Rgba8Unorm
        );
    }
}
