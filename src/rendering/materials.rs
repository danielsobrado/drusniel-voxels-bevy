use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy_water::water::material::{StandardWaterMaterial, WaterMaterial as BevyWaterMaterial};
use bevy_water::WaterSettings;
use std::path::Path;
use crate::atmosphere::FogUniforms;
use crate::constants::{
    VOXEL_WATER_WAVE_AMPLITUDE_MULT, VOXEL_WATER_WAVE_UV_SCALE,
    VOXEL_WATER_CLARITY_MULT, VOXEL_WATER_EDGE_SCALE_MULT,
};
use crate::rendering::blocky_material::BlockyMaterial;
use crate::rendering::building_material::{BuildingMaterial, BuildingMaterialHandle, BuildingUniforms};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::props_material::{PropsMaterial, PropsMaterialHandle, PropsUniforms};
use crate::rendering::triplanar_material::{TriplanarMaterial, TriplanarMaterialHandle, TriplanarUniforms};
use crate::vegetation::grass_material::{GrassMaterial, GrassMaterialHandles};

#[derive(Resource)]
pub struct VoxelMaterial {
    pub handle: Handle<BlockyMaterial>,
}

#[derive(Resource)]
pub struct WaterMaterial {
    pub near_handle: Handle<StandardWaterMaterial>,
    pub far_handle: Handle<StandardMaterial>,
}

fn load_image_if_exists(asset_server: &AssetServer, asset_path: &str) -> Option<Handle<Image>> {
    let disk_path = Path::new("assets").join(asset_path);
    if disk_path.exists() {
        Some(asset_server.load(asset_path.to_string()))
    } else {
        None
    }
}

// setup_voxel_material is now largely superseded by array_loader which creates the BlockyMaterial
// However, we might keep this signature if we want to initialize other things or just empty.
// For now, let's essentially empty it out or remove it from plugin if not needed.
// But wait, the system logic likely expects VoxelMaterial resource to exist.
// Let's modify array_loader to insert VoxelMaterial resource instead of its own internal handle.

pub fn setup_water_material(
    mut commands: Commands,
    mut fancy_materials: ResMut<Assets<StandardWaterMaterial>>,
    mut cheap_materials: ResMut<Assets<StandardMaterial>>,
    water_settings: Option<Res<WaterSettings>>,
) {
    let settings = water_settings.as_deref().cloned().unwrap_or_default();
    // Voxel water uses the same water shader as the ocean tiles for wave/foam effects.
    // Base parameters match the v0.3 blue partial-alpha look.
    let near_handle = fancy_materials.add(StandardWaterMaterial {
        base: StandardMaterial {
            base_color: settings.base_color,
            alpha_mode: AlphaMode::Blend,
            perceptual_roughness: 0.06,
            metallic: 0.0,
            reflectance: 0.8,
            clearcoat: 0.6,
            clearcoat_perceptual_roughness: 0.1,
            double_sided: true,
            cull_mode: None,
            depth_bias: 4.0,
            // Refraction via Bevy's specular transmission:
            // Objects below the water surface appear with IOR-based distortion
            specular_transmission: 0.2,
            ior: 1.33,     // Water IOR (physically correct)
            thickness: 0.5, // Non-zero thickness enables lens-like distortion
            ..default()
        },
        extension: BevyWaterMaterial {
            amplitude: settings.amplitude * VOXEL_WATER_WAVE_AMPLITUDE_MULT,
            clarity: settings.clarity * VOXEL_WATER_CLARITY_MULT,
            deep_color: settings.deep_color,
            shallow_color: settings.shallow_color,
            edge_color: settings.shallow_color,
            edge_scale: settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT,
            coord_offset: Vec2::ZERO,
            coord_scale: Vec2::splat(VOXEL_WATER_WAVE_UV_SCALE),
            quality: settings.water_quality.into(),
            ..default()
        },
    });

    let far_handle = cheap_materials.add(StandardMaterial {
        base_color: settings.base_color,
        alpha_mode: AlphaMode::Blend,
        perceptual_roughness: 0.08,
        metallic: 0.0,
        reflectance: 0.78,
        clearcoat: 0.5,
        clearcoat_perceptual_roughness: 0.12,
        double_sided: true,
        cull_mode: None,
        depth_bias: 4.0,
        ..default()
    });

    commands.insert_resource(WaterMaterial {
        near_handle,
        far_handle,
    });
}

pub fn sync_voxel_water_material_overrides(
    water_settings: Option<Res<WaterSettings>>,
    water_material: Option<Res<WaterMaterial>>,
    mut materials: ResMut<Assets<StandardWaterMaterial>>,
) {
    let (Some(settings), Some(water_material)) = (water_settings, water_material) else {
        return;
    };

    if !settings.is_changed() {
        return;
    }

    if let Some(mat) = materials.get_mut(&water_material.near_handle) {
        mat.base.base_color = settings.base_color;
        mat.base.alpha_mode = settings.alpha_mode;
        mat.base.perceptual_roughness = 0.06;
        mat.base.metallic = 0.0;
        mat.base.reflectance = 0.8;
        mat.base.clearcoat = 0.6;
        mat.base.clearcoat_perceptual_roughness = 0.1;
        mat.base.double_sided = true;
        mat.base.cull_mode = None;
        mat.base.depth_bias = 4.0;
        mat.base.specular_transmission = 0.2;
        mat.base.ior = 1.33;
        mat.base.thickness = 0.5;

        mat.extension.amplitude = settings.amplitude * VOXEL_WATER_WAVE_AMPLITUDE_MULT;
        mat.extension.clarity = settings.clarity * VOXEL_WATER_CLARITY_MULT;
        mat.extension.deep_color = settings.deep_color;
        mat.extension.shallow_color = settings.shallow_color;
        mat.extension.edge_color = settings.shallow_color;
        mat.extension.edge_scale = settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT;
        mat.extension.coord_offset = Vec2::ZERO;
        mat.extension.coord_scale = Vec2::splat(VOXEL_WATER_WAVE_UV_SCALE);
        mat.extension.quality = settings.water_quality.into();
    }
}

/// Ensure the atlas uses a repeat/mipmapped sampler so tiled terrain does not clamp or alias


/// Setup triplanar terrain material for surface nets meshes with PBR textures
/// Loads grass, rock, sand, and dirt texture sets for multi-material terrain
pub fn setup_triplanar_material(
    mut commands: Commands,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    asset_server: Res<AssetServer>,
) {
    let integrated = capabilities
        .as_ref()
        .map(|capabilities| capabilities.integrated_gpu)
        .unwrap_or(false);

    let material_handle = materials.add(if integrated {
        TriplanarMaterial {
            uniforms: TriplanarUniforms {
                base_color: LinearRgba::WHITE,
                tex_scale: 2.0,
                blend_sharpness: 4.0,
                normal_intensity: 1.0,
                parallax_scale: 0.0,
                ao_strength: 0.0,
                _padding: 0.0,
            },
            grass_albedo: None,
            grass_normal: None,
            rock_albedo: None,
            rock_normal: None,
            sand_albedo: None,
            sand_normal: None,
            dirt_albedo: None,
            dirt_normal: None,
        }
    } else {
        TriplanarMaterial {
            uniforms: TriplanarUniforms {
                base_color: LinearRgba::WHITE,
                tex_scale: 2.0,         // Higher resolution (1 tile per 2 world units)
                blend_sharpness: 4.0,   // Moderate blend between projections
                normal_intensity: 1.0,  // Full normal map strength
                parallax_scale: 0.04,   // Subtle parallax depth
                ao_strength: 0.0,       // V0.3 soft shadow look
                _padding: 0.0,
            },
            // Grass textures (for TopSoil top faces)
            grass_albedo: Some(asset_server.load("pbr/grass/albedo.png")),
            grass_normal: Some(asset_server.load("pbr/grass/normal.png")),
            // Rock textures (for Rock, Bedrock, cliffs)
            rock_albedo: Some(asset_server.load("pbr/rock/albedo.png")),
            rock_normal: Some(asset_server.load("pbr/rock/normal.png")),
            // Sand textures
            sand_albedo: Some(asset_server.load("pbr/sand/albedo.png")),
            sand_normal: Some(asset_server.load("pbr/sand/normal.png")),
            // Dirt textures (for SubSoil, sides)
            dirt_albedo: Some(asset_server.load("pbr/dirt/albedo.png")),
            dirt_normal: Some(asset_server.load("pbr/dirt/normal.png")),
        }
    });

    commands.insert_resource(TriplanarMaterialHandle {
        handle: material_handle,
    });
}

/// Ensure all triplanar textures use Repeat address mode for seamless tiling with proper mipmaps
pub fn configure_triplanar_textures(
    mat_handle: Option<Res<TriplanarMaterialHandle>>,
    materials: Res<Assets<TriplanarMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut configured: Local<bool>,
) {
    if *configured {
        return;
    }

    if let Some(handle) = mat_handle {
        if let Some(material) = materials.get(&handle.handle) {
            let textures = [
                &material.grass_albedo, &material.grass_normal,
                &material.rock_albedo, &material.rock_normal,
                &material.sand_albedo, &material.sand_normal,
                &material.dirt_albedo, &material.dirt_normal,
            ];

            let mut all_loaded = true;
            for tex_opt in textures {
                if let Some(tex_handle) = tex_opt {
                    if let Some(image) = images.get_mut(tex_handle) {
                        // Set sampler to Repeat for tiling with trilinear filtering and anisotropy
                        image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
                            address_mode_u: ImageAddressMode::Repeat,
                            address_mode_v: ImageAddressMode::Repeat,
                            address_mode_w: ImageAddressMode::Repeat,
                            mag_filter: ImageFilterMode::Linear,
                            min_filter: ImageFilterMode::Linear,
                            mipmap_filter: ImageFilterMode::Linear,
                            // Enable anisotropic filtering for terrain viewed at oblique angles
                            anisotropy_clamp: 16,
                            ..default()
                        });
                    } else {
                        // Texture not loaded yet
                        all_loaded = false;
                    }
                }
            }

            // Only mark as configured if we successfully processed all textures (or at least checked them)
            // If some are not loaded, we wait for next frame
            if all_loaded {
                *configured = true;
                info!("Triplanar textures configured with anisotropic filtering");
            }
        }
    }
}

/// Ensure building textures use Repeat address mode with trilinear + anisotropy.
pub fn configure_building_textures(
    mat_handle: Option<Res<BuildingMaterialHandle>>,
    materials: Res<Assets<BuildingMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut configured: Local<bool>,
) {
    if *configured {
        return;
    }

    if let Some(handle) = mat_handle {
        if let Some(material) = materials.get(&handle.handle) {
            let textures = [
                &material.wood_albedo, &material.wood_normal, &material.wood_roughness,
                &material.wood_ao,
            ];

            let mut all_loaded = true;
            for tex_opt in textures {
                if let Some(tex_handle) = tex_opt {
                    if let Some(image) = images.get_mut(tex_handle) {
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
                    } else {
                        all_loaded = false;
                    }
                }
            }

            if all_loaded {
                *configured = true;
                info!("Building textures configured with anisotropic filtering");
            }
        }
    }
}

/// Ensure props textures use Repeat address mode with trilinear + anisotropy.
pub fn configure_props_textures(
    mat_handle: Option<Res<PropsMaterialHandle>>,
    materials: Res<Assets<PropsMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut configured: Local<bool>,
) {
    if *configured {
        return;
    }

    if let Some(handle) = mat_handle {
        if let Some(material) = materials.get(&handle.handle) {
            let textures = [
                &material.rock_albedo, &material.rock_normal, &material.rock_roughness,
                &material.rock_ao,
            ];

            let mut all_loaded = true;
            for tex_opt in textures {
                if let Some(tex_handle) = tex_opt {
                    if let Some(image) = images.get_mut(tex_handle) {
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
                    } else {
                        all_loaded = false;
                    }
                }
            }

            if all_loaded {
                *configured = true;
                info!("Props textures configured with anisotropic filtering");
            }
        }
    }
}

/// Setup building material with full PBR textures for RTX 40xx
/// Buildings get the highest detail: albedo + normal + roughness + AO + metallic + parallax
pub fn setup_building_material(
    mut commands: Commands,
    mut materials: ResMut<Assets<BuildingMaterial>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    asset_server: Res<AssetServer>,
) {
    let integrated = capabilities
        .as_ref()
        .map(|c| c.integrated_gpu)
        .unwrap_or(false);

    let material_handle = materials.add(if integrated {
        // Fallback for integrated GPU - no textures
        BuildingMaterial {
            uniforms: BuildingUniforms {
                base_color: LinearRgba::WHITE,
                tex_scale: 1.0,
                blend_sharpness: 8.0,
                normal_intensity: 0.0,
                parallax_scale: 0.0,
                parallax_steps: 0,
                ..default()
            },
            ..default()
        }
    } else {
        // Full PBR for dedicated GPU (RTX 40xx target)
        BuildingMaterial {
            uniforms: BuildingUniforms {
                base_color: LinearRgba::WHITE,
                tex_scale: 1.0,          // 1 tile per world unit for building detail
                blend_sharpness: 8.0,    // Sharp transitions for buildings
                normal_intensity: 1.0,
                parallax_scale: 0.04,    // Subtle parallax depth
                parallax_steps: 6,       // Balanced quality/performance
                ..default()
            },
            // Wood plank textures
            wood_albedo: load_image_if_exists(&asset_server, "textures/building/wood/albedo.png"),
            wood_normal: load_image_if_exists(&asset_server, "textures/building/wood/normal.png"),
            wood_roughness: load_image_if_exists(&asset_server, "textures/building/wood/roughness.png"),
            wood_ao: load_image_if_exists(&asset_server, "textures/building/wood/ao.png"),
            // Stone brick textures
            stone_albedo: load_image_if_exists(&asset_server, "textures/building/stone/albedo.png"),
            stone_normal: load_image_if_exists(&asset_server, "textures/building/stone/normal.png"),
            stone_roughness: load_image_if_exists(&asset_server, "textures/building/stone/roughness.png"),
            stone_ao: load_image_if_exists(&asset_server, "textures/building/stone/ao.png"),
            // Metal plate textures
            metal_albedo: load_image_if_exists(&asset_server, "textures/building/metal/albedo.png"),
            metal_normal: load_image_if_exists(&asset_server, "textures/building/metal/normal.png"),
            metal_roughness: load_image_if_exists(&asset_server, "textures/building/metal/roughness.png"),
            metal_ao: load_image_if_exists(&asset_server, "textures/building/metal/ao.png"),
            metal_metallic: load_image_if_exists(&asset_server, "textures/building/metal/metallic.png"),
            // Thatch textures
            thatch_albedo: load_image_if_exists(&asset_server, "textures/building/thatch/albedo.png"),
            thatch_normal: load_image_if_exists(&asset_server, "textures/building/thatch/normal.png"),
            thatch_roughness: load_image_if_exists(&asset_server, "textures/building/thatch/roughness.png"),
            thatch_ao: load_image_if_exists(&asset_server, "textures/building/thatch/ao.png"),
        }
    });

    commands.insert_resource(BuildingMaterialHandle {
        handle: material_handle,
    });
}

/// Setup props material with medium PBR for RTX 40xx
/// Props get medium detail: albedo + normal + roughness + vertex AO
pub fn setup_props_material(
    mut commands: Commands,
    mut materials: ResMut<Assets<PropsMaterial>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    asset_server: Res<AssetServer>,
) {
    let integrated = capabilities
        .as_ref()
        .map(|c| c.integrated_gpu)
        .unwrap_or(false);

    let material_handle = materials.add(if integrated {
        // Fallback for integrated GPU - no textures
        PropsMaterial {
            uniforms: PropsUniforms {
                base_color: LinearRgba::WHITE,
                tex_scale: 1.0,
                blend_sharpness: 4.0,
                normal_intensity: 0.0,
                default_roughness: 0.8,
                ..default()
            },
            ..default()
        }
    } else {
        // Medium PBR for dedicated GPU
        PropsMaterial {
            uniforms: PropsUniforms {
                base_color: LinearRgba::WHITE,
                tex_scale: 1.0,
                blend_sharpness: 4.0,
                normal_intensity: 1.0,
                default_roughness: 0.8,
                ..default()
            },
            // Rock textures (full props PBR)
            rock_albedo: load_image_if_exists(&asset_server, "pbr/props/rock/albedo.png"),
            rock_normal: load_image_if_exists(&asset_server, "pbr/props/rock/normal.png"),
            rock_roughness: load_image_if_exists(&asset_server, "pbr/props/rock/roughness.png"),
            rock_ao: load_image_if_exists(&asset_server, "pbr/props/rock/ao.png"),
        }
    });

    commands.insert_resource(PropsMaterialHandle {
        handle: material_handle,
    });
}

/// Sync fog uniforms to all custom materials that use aerial perspective.
/// This updates building, props, and grass materials when the atmosphere fog changes.
pub fn sync_fog_to_materials(
    fog_uniforms: Option<Res<FogUniforms>>,
    building_handle: Option<Res<BuildingMaterialHandle>>,
    props_handle: Option<Res<PropsMaterialHandle>>,
    grass_handles: Option<Res<GrassMaterialHandles>>,
    mut building_materials: ResMut<Assets<BuildingMaterial>>,
    mut props_materials: ResMut<Assets<PropsMaterial>>,
    mut grass_materials: ResMut<Assets<GrassMaterial>>,
) {
    let Some(fog) = fog_uniforms else { return };

    if !fog.is_changed() {
        return;
    }

    // Update building material
    if let Some(handle) = building_handle {
        if let Some(mat) = building_materials.get_mut(&handle.handle) {
            mat.uniforms.fog_color = fog.fog_color;
            mat.uniforms.fog_start = fog.fog_start;
            mat.uniforms.fog_end = fog.fog_end;
            mat.uniforms.aerial_strength = fog.aerial_strength;
        }
    }

    // Update props material
    if let Some(handle) = props_handle {
        if let Some(mat) = props_materials.get_mut(&handle.handle) {
            mat.uniforms.fog_color = fog.fog_color;
            mat.uniforms.fog_start = fog.fog_start;
            mat.uniforms.fog_end = fog.fog_end;
            mat.uniforms.aerial_strength = fog.aerial_strength;
        }
    }

    // Update all grass materials
    if let Some(handles) = grass_handles {
        for handle in &handles.handles {
            if let Some(mat) = grass_materials.get_mut(handle) {
                mat.uniform_data.fog_color = fog.fog_color;
                mat.uniform_data.fog_start = fog.fog_start;
                mat.uniform_data.fog_end = fog.fog_end;
                mat.uniform_data.aerial_strength = fog.aerial_strength;
            }
        }
    }
}
