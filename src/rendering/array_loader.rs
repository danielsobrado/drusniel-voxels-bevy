use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::render::render_resource::{
    Extent3d, TextureDataOrder, TextureDescriptor, TextureDimension, TextureViewDescriptor, TextureViewDimension, TextureUsages,
};

use crate::rendering::blocky_material::{BlockyMaterial, BlockyMaterialHandle};
use crate::rendering::materials::VoxelMaterial;
use crate::rendering::mipmaps::{calculate_mip_count, generate_array_mipmaps_rgba8};

#[derive(Resource)]
pub struct TextureArraySource {
    // Albedo handles
    pub grass: Handle<Image>,
    pub dirt: Handle<Image>,
    pub rock: Handle<Image>,
    pub sand: Handle<Image>,
    
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

    // Helper to create array from list of handles with mipmap generation
    let mut create_array = |handles: &[&Handle<Image>]| -> Option<Handle<Image>> {
        let first = images.get(handles[0])?;
        let width = first.width();
        let height = first.height();
        let original_format = first.texture_descriptor.format;
        let num_layers = handles.len() as u32;
        
        // Determine if we need to convert from Rgba16 to Rgba8
        use bevy::render::render_resource::TextureFormat;
        let needs_conversion = matches!(
            original_format,
            TextureFormat::Rgba16Unorm | TextureFormat::Rgba16Float | TextureFormat::Rgba16Uint | TextureFormat::Rgba16Sint
        );
        
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
            
            if needs_conversion {
                // Convert Rgba16 (8 bytes/pixel) to Rgba8 (4 bytes/pixel)
                // Each channel: u16 (0-65535) -> u8 (0-255) by dividing by 257
                let pixel_count = (width * height) as usize;
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

    let Some(albedo_array) =
        create_array(&[&source.grass, &source.dirt, &source.rock, &source.sand])
    else {
        return;
    };
    let Some(normal_array) =
        create_array(&[&source.grass_n, &source.dirt_n, &source.rock_n, &source.sand_n])
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
