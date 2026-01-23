use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::render::render_resource::{
    Extent3d, TextureDataOrder, TextureDescriptor, TextureDimension, TextureFormat, TextureViewDescriptor, TextureViewDimension, TextureUsages,
};

use crate::rendering::blocky_material::{BlockyMaterial, BlockyMaterialHandle};
use crate::rendering::materials::VoxelMaterial;
use crate::rendering::mipmaps::{calculate_mip_count, generate_array_mipmaps_rgba8};

#[derive(Resource)]
pub struct TextureArraySource {
    // Albedo handles (5 layers: grass, dirt, rock, sand, grass_side)
    pub grass: Handle<Image>,
    pub dirt: Handle<Image>,
    pub rock: Handle<Image>,
    pub sand: Handle<Image>,
    // grass_side is generated procedurally from grass + dirt

    // Normal handles
    pub grass_n: Handle<Image>,
    pub dirt_n: Handle<Image>,
    pub rock_n: Handle<Image>,
    pub sand_n: Handle<Image>,

    pub loaded: bool,
}

#[derive(Resource)]
pub struct BlockyTextureArray {
    pub albedo: Handle<Image>,
    pub normal: Handle<Image>,
}

/// Generate a grass_side texture by blending grass (top portion) with dirt (bottom portion).
/// This creates the classic Minecraft-style grass block side appearance.
fn generate_grass_side_texture(
    images: &Assets<Image>,
    grass_handle: &Handle<Image>,
    dirt_handle: &Handle<Image>,
) -> Image {
    use bevy::render::render_resource::TextureFormat;

    let grass_img = images.get(grass_handle).expect("Grass texture not loaded");
    let dirt_img = images.get(dirt_handle).expect("Dirt texture not loaded");

    let width = grass_img.width();
    let height = grass_img.height();

    let grass_data = grass_img.data.as_ref().expect("Grass texture has no data");
    let dirt_data = dirt_img.data.as_ref().expect("Dirt texture has no data");

    // Get bytes per pixel from actual texture format
    let grass_format = grass_img.texture_descriptor.format;
    let dirt_format = dirt_img.texture_descriptor.format;

    // Helper to read a pixel as RGBA8 from various formats
    let read_pixel = |data: &[u8], pixel_idx: usize, format: TextureFormat| -> (u8, u8, u8, u8) {
        match format {
            TextureFormat::Rgba8Unorm | TextureFormat::Rgba8UnormSrgb => {
                let offset = pixel_idx * 4;
                (data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
            }
            TextureFormat::Rgba16Unorm | TextureFormat::Rgba16Float | TextureFormat::Rgba16Uint | TextureFormat::Rgba16Sint => {
                let offset = pixel_idx * 8;
                let r16 = u16::from_le_bytes([data[offset], data[offset + 1]]);
                let g16 = u16::from_le_bytes([data[offset + 2], data[offset + 3]]);
                let b16 = u16::from_le_bytes([data[offset + 4], data[offset + 5]]);
                let a16 = u16::from_le_bytes([data[offset + 6], data[offset + 7]]);
                ((r16 / 257) as u8, (g16 / 257) as u8, (b16 / 257) as u8, (a16 / 257) as u8)
            }
            // Note: Rgb8Unorm doesn't exist in wgpu - RGB formats without alpha
            // are not directly supported. The fallback below handles 3-byte formats.
            TextureFormat::R8Unorm => {
                // Single channel grayscale - expand to RGBA
                let v = data[pixel_idx];
                (v, v, v, 255)
            }
            _ => {
                // Fallback: try to read as Rgba8, or return magenta for unknown
                let bpp = data.len() / (width * height) as usize;
                if bpp >= 4 {
                    let offset = pixel_idx * bpp;
                    (data[offset], data[offset + 1], data[offset + 2], data[offset + 3])
                } else if bpp >= 3 {
                    let offset = pixel_idx * bpp;
                    (data[offset], data[offset + 1], data[offset + 2], 255)
                } else {
                    (255, 0, 255, 255) // Magenta for debug
                }
            }
        }
    };

    // Create output as Rgba8
    let mut result_data = Vec::with_capacity((width * height * 4) as usize);

    // Grass covers top ~20% of the texture, with a slight gradient blend
    let grass_end_row = (height as f32 * 0.20) as u32;
    let blend_rows = (height as f32 * 0.05) as u32; // 5% blend zone

    for y in 0..height {
        for x in 0..width {
            let pixel_idx = (y * width + x) as usize;

            let (gr, gg, gb, ga) = read_pixel(grass_data, pixel_idx, grass_format);
            let (dr, dg, db, da) = read_pixel(dirt_data, pixel_idx, dirt_format);

            // Blend based on Y position (y=0 is top of texture)
            let (r, g, b, a) = if y < grass_end_row {
                // Pure grass zone
                (gr, gg, gb, ga)
            } else if y < grass_end_row + blend_rows {
                // Blend zone - smooth transition from grass to dirt
                let t = (y - grass_end_row) as f32 / blend_rows.max(1) as f32;
                let blend = |g: u8, d: u8| -> u8 {
                    (g as f32 * (1.0 - t) + d as f32 * t) as u8
                };
                (blend(gr, dr), blend(gg, dg), blend(gb, db), blend(ga, da))
            } else {
                // Pure dirt zone
                (dr, dg, db, da)
            };

            result_data.push(r);
            result_data.push(g);
            result_data.push(b);
            result_data.push(a);
        }
    }

    Image::new(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        result_data,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
    )
}

pub fn start_loading_texture_arrays(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    commands.insert_resource(TextureArraySource {
        grass: asset_server.load("pbr/grass/albedo.png"),
        dirt: asset_server.load("pbr/dirt/albedo.png"),
        rock: asset_server.load("pbr/rock/albedo.png"),
        sand: asset_server.load("pbr/sand/albedo.png"),
        
        grass_n: asset_server.load("pbr/grass/normal.png"),
        dirt_n: asset_server.load("pbr/dirt/normal.png"),
        rock_n: asset_server.load("pbr/rock/normal.png"),
        sand_n: asset_server.load("pbr/sand/normal.png"),
        
        loaded: false,
    });
}

pub fn create_texture_array(
    mut commands: Commands,
    mut source: ResMut<TextureArraySource>,
    asset_server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<BlockyMaterial>>,
    _mat_handle_res: Option<ResMut<BlockyMaterialHandle>>,
) {
    if source.loaded {
        return;
    }

    // Check if all textures are loaded
    let handles = [
        &source.grass, &source.dirt, &source.rock, &source.sand,
        &source.grass_n, &source.dirt_n, &source.rock_n, &source.sand_n,
    ];

    for handle in handles {
        if !asset_server.is_loaded(handle) {
            return;
        }
    }

    // All loaded, create the arrays
    info!("Creating Texture Arrays for Blocky Material with mipmaps...");

    // Generate grass_side textures FIRST (before the closure captures images mutably)
    // This creates the classic Minecraft-style grass block side appearance
    let grass_side_albedo = generate_grass_side_texture(&images, &source.grass, &source.dirt);
    let grass_side_normal = generate_grass_side_texture(&images, &source.grass_n, &source.dirt_n);

    let grass_side_albedo_handle = images.add(grass_side_albedo);
    let grass_side_normal_handle = images.add(grass_side_normal);

    // Helper to create array from list of handles with mipmap generation
    let mut create_array = |handles: &[&Handle<Image>]| -> Option<Handle<Image>> {
        let first = images.get(handles[0])?;
        let width = first.width();
        let height = first.height();
        let num_layers = handles.len() as u32;
        // Target format is always Rgba8UnormSrgb for our shaders
        let target_format = TextureFormat::Rgba8UnormSrgb;

        // Calculate mip count based on texture dimensions (stop at 8x8 minimum for quality)
        let mip_count = calculate_mip_count(width, height).min(8);

        // Collect layer data separately for mipmap generation
        // Convert from Rgba16 to Rgba8 if necessary
        let mut layer_data: Vec<Vec<u8>> = Vec::with_capacity(handles.len());
        for h in handles {
            let img = images.get(*h)?;
            if img.width() != width || img.height() != height {
                warn!("Texture array layer has mismatched dimensions, skipping mipmaps");
                return None;
            }
            let bytes = img.data.as_ref()?;
            
            // Check format PER IMAGE to handle mixing 16-bit assets with 8-bit generated textures
            let is_16bit = matches!(
                img.texture_descriptor.format,
                TextureFormat::Rgba16Unorm | TextureFormat::Rgba16Float | TextureFormat::Rgba16Uint | TextureFormat::Rgba16Sint
            );

            if is_16bit {
                // Convert Rgba16 (8 bytes/pixel) to Rgba8 (4 bytes/pixel)
                // Each channel: u16 (0-65535) -> u8 (0-255) by dividing by 257
                let pixel_count = (width * height) as usize;
                
                // Safety check to ensure we don't read out of bounds if format lies
                if bytes.len() < pixel_count * 8 {
                    warn!("Texture claims 16-bit format but data is too small! Expected {}, got {}", pixel_count * 8, bytes.len());
                    // Fallback to copy if size matches 8-bit
                    if bytes.len() == pixel_count * 4 {
                        layer_data.push(bytes.to_vec());
                        continue;
                    }
                    return None;
                }

                let mut rgba8_data = Vec::with_capacity(pixel_count * 4);

                for i in 0..pixel_count {
                    let offset = i * 8;
                    // Read u16 values (little endian)
                    let r16 = u16::from_le_bytes([bytes[offset], bytes[offset + 1]]);
                    let g16 = u16::from_le_bytes([bytes[offset + 2], bytes[offset + 3]]);
                    let b16 = u16::from_le_bytes([bytes[offset + 4], bytes[offset + 5]]);
                    let a16 = u16::from_le_bytes([bytes[offset + 6], bytes[offset + 7]]);

                    // Convert to u8 (divide by 257 maps 0-65535 to 0-255 correctly)
                    rgba8_data.push((r16 / 257) as u8);
                    rgba8_data.push((g16 / 257) as u8);
                    rgba8_data.push((b16 / 257) as u8);
                    rgba8_data.push((a16 / 257) as u8);
                }

                layer_data.push(rgba8_data);
            } else {
                layer_data.push(bytes.to_vec());
            }
        }

        info!(
            "Creating {}x{} texture array with {} layers, {} mip levels",
            width, height, num_layers, mip_count
        );

        // Generate mipmaps for all layers (LayerMajor format for GPU)
        let data_with_mips = generate_array_mipmaps_rgba8(width, height, num_layers, &layer_data, mip_count);

        // Construct Image directly to avoid size validation issues with mipmap data
        // Image::new() only validates against base texture size, but we have full mip chain
        // Using LayerMajor (default) because our data is laid out as [layer0_all_mips, layer1_all_mips, ...]
        let image = Image {
            data: Some(data_with_mips),
            data_order: TextureDataOrder::LayerMajor,
            texture_descriptor: TextureDescriptor {
                label: None,
                size: Extent3d {
                    width,
                    height,
                    depth_or_array_layers: num_layers,
                },
                mip_level_count: mip_count,
                sample_count: 1,
                dimension: TextureDimension::D2,
                format: target_format,
                usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
                view_formats: &[],
            },
            // Configure sampler for array with trilinear filtering (uses mipmaps)
            sampler: ImageSampler::Descriptor(ImageSamplerDescriptor {
                address_mode_u: ImageAddressMode::Repeat,
                address_mode_v: ImageAddressMode::Repeat,
                address_mode_w: ImageAddressMode::Repeat,
                mag_filter: ImageFilterMode::Linear,
                min_filter: ImageFilterMode::Linear,
                mipmap_filter: ImageFilterMode::Linear,
                // Enable anisotropic filtering for better quality at oblique angles
                anisotropy_clamp: 16,
                ..default()
            }),
            // Critical: Set correct TextureView to 2D Array with all mip levels
            texture_view_descriptor: Some(TextureViewDescriptor {
                dimension: Some(TextureViewDimension::D2Array),
                mip_level_count: Some(mip_count),
                ..default()
            }),
            asset_usage: RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
            copy_on_resize: false,
        };

        Some(images.add(image))
    };

    // Create texture arrays with 5 layers: grass, dirt, rock, sand, grass_side
    let Some(albedo_array) =
        create_array(&[&source.grass, &source.dirt, &source.rock, &source.sand, &grass_side_albedo_handle])
    else {
        return;
    };
    let Some(normal_array) =
        create_array(&[&source.grass_n, &source.dirt_n, &source.rock_n, &source.sand_n, &grass_side_normal_handle])
    else {
        return;
    };

    commands.insert_resource(BlockyTextureArray {
        albedo: albedo_array.clone(),
        normal: normal_array.clone(),
    });

    // Create the material
    let material = BlockyMaterial {
        uniforms: default(),
        diffuse_texture: Some(albedo_array),
        normal_texture: Some(normal_array),
    };

    let handle = materials.add(material);

    // Insert the handle so we can access it if needed
    commands.insert_resource(BlockyMaterialHandle { handle: handle.clone() });

    // CRITICAL: Insert VoxelMaterial resource so the rest of the app (meshing) can find it
    commands.insert_resource(VoxelMaterial { handle });
    
    source.loaded = true;
    info!("Blocky Texture Array created and material initialized.");
}
