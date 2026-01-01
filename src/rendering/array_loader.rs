use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::render::render_resource::{
    Extent3d, TextureDimension, TextureViewDescriptor, TextureViewDimension,
};

use crate::rendering::blocky_material::{BlockyMaterial, BlockyMaterialHandle};
use crate::rendering::materials::VoxelMaterial;

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
    info!("Creating Texture Arrays for Blocky Material...");

    // Helper to create array from list of handles
    let mut create_array = |handles: &[&Handle<Image>]| -> Handle<Image> {
        let first = images.get(handles[0]).unwrap();
        let width = first.width();
        let height = first.height();
        let format = first.texture_descriptor.format;
        
        // Assume consistent size/format for now
        let mut data = Vec::new();
        for h in handles {
            let img = images.get(*h).unwrap();
            let bytes = img
                .data
                .as_ref()
                .expect("Image data should be available once loaded");
            data.extend_from_slice(bytes);
        }
        
        let mut image = Image::new(
            Extent3d {
                width,
                height,
                depth_or_array_layers: handles.len() as u32,
            },
            TextureDimension::D2,
            data,
            format,
            RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
        );
        
        // Configure sampler for array
        image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
            address_mode_u: ImageAddressMode::Repeat,
            address_mode_v: ImageAddressMode::Repeat,
            address_mode_w: ImageAddressMode::Repeat,
            mag_filter: ImageFilterMode::Linear,
            min_filter: ImageFilterMode::Linear,
            mipmap_filter: ImageFilterMode::Linear,
            ..default()
        });
        
        // Critical: Set correct TextureView to 2D Array
        image.texture_view_descriptor = Some(TextureViewDescriptor {
            dimension: Some(TextureViewDimension::D2Array),
            ..default()
        });

        images.add(image)
    };

    let albedo_array = create_array(&[&source.grass, &source.dirt, &source.rock, &source.sand]);
    let normal_array = create_array(&[&source.grass_n, &source.dirt_n, &source.rock_n, &source.sand_n]);

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
