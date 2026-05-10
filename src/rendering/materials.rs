use crate::atmosphere::FogUniforms;
use crate::constants::{
    VOXEL_WATER_CLARITY_MULT, VOXEL_WATER_EDGE_SCALE_MULT, VOXEL_WATER_WAVE_UV_SCALE,
};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::blocky_material::{BlockyMaterial, BlockyMaterialHandle};
use crate::rendering::building_material::{
    BuildingMaterial, BuildingMaterialHandle, BuildingUniforms,
};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::props_material::{PropsMaterial, PropsMaterialHandle, PropsUniforms};
use crate::rendering::triplanar_material::{
    TerrainMaterialQuality, TriplanarMaterial, TriplanarMaterialHandle, TriplanarUniforms,
};
use crate::rendering::water::{WaterBodyPresetConfig, WaterConfig, WaterShaderToggles};
use crate::rendering::witchcraft_water_finish::WitchcraftWaterFinishParams;
use crate::vegetation::grass_material::{GrassMaterial, GrassMaterialHandles};
use crate::voxel::meshing::WaterBodyKind;
use crate::weather::{WEATHER_FLAG_PUDDLE_DETAIL, WeatherRuntime};
use bevy::diagnostic::FrameCount;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy_water::WaterSettings;
use bevy_water::water::material::{StandardWaterMaterial, WaterMaterial as BevyWaterMaterial};
use std::path::Path;

const WATER_SURFACE_DEPTH_BIAS: f32 = 0.0;

fn water_debug_solid_color_enabled() -> bool {
    std::env::var_os("VOXEL_WATER_DEBUG_SOLID_COLOR").is_some()
}

fn water_debug_body_colors_enabled() -> bool {
    std::env::var_os("VOXEL_WATER_DEBUG_BODY_COLORS").is_some()
}

#[derive(Resource)]
pub struct VoxelMaterial {
    pub handle: Handle<BlockyMaterial>,
}

#[derive(Resource)]
pub struct WaterMaterial {
    pub near_handle: Handle<StandardWaterMaterial>,
    pub far_handle: Handle<StandardMaterial>,
    pub mask_handle: Handle<StandardMaterial>,
    pub ocean: BodyWaterMaterialHandles,
    pub lake: BodyWaterMaterialHandles,
    pub river: BodyWaterMaterialHandles,
    pub pond: BodyWaterMaterialHandles,
    pub shallow_flood: BodyWaterMaterialHandles,
    pub unknown: BodyWaterMaterialHandles,
}

#[derive(Clone)]
pub struct BodyWaterMaterialHandles {
    pub near: Handle<StandardWaterMaterial>,
    pub far: Handle<StandardMaterial>,
}

impl WaterMaterial {
    pub fn near_handle_for_kind(&self, kind: WaterBodyKind) -> Handle<StandardWaterMaterial> {
        self.handles_for_kind(kind).near.clone()
    }

    pub fn far_handle_for_kind(&self, kind: WaterBodyKind) -> Handle<StandardMaterial> {
        self.handles_for_kind(kind).far.clone()
    }

    fn handles_for_kind(&self, kind: WaterBodyKind) -> &BodyWaterMaterialHandles {
        match kind {
            WaterBodyKind::Ocean => &self.ocean,
            WaterBodyKind::Lake => &self.lake,
            WaterBodyKind::River => &self.river,
            WaterBodyKind::Pond => &self.pond,
            WaterBodyKind::ShallowFlood => &self.shallow_flood,
            // Unknown is the short-lived state before the water-body registry
            // connects chunk meshes. Prefer ocean so horizon chunks do not flash
            // as grey/lake water while classification catches up.
            WaterBodyKind::Unknown => &self.ocean,
        }
    }
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
    water_config: Option<Res<WaterConfig>>,
    shader_toggles: Option<Res<WaterShaderToggles>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Setup Water");
    let settings = water_settings.as_deref().cloned().unwrap_or_default();
    let config = water_config.as_deref().cloned().unwrap_or_default();
    let witchcraft_params = config.witchcraft_finish.params();
    let toggles = shader_toggles.as_deref().copied().unwrap_or_default();
    let debug_solid_color = water_debug_solid_color_enabled();
    let ocean = create_body_water_materials(
        WaterBodyKind::Ocean,
        &config,
        witchcraft_params,
        toggles,
        &settings,
        debug_solid_color,
        &mut fancy_materials,
        &mut cheap_materials,
    );
    let lake = create_body_water_materials(
        WaterBodyKind::Lake,
        &config,
        witchcraft_params,
        toggles,
        &settings,
        debug_solid_color,
        &mut fancy_materials,
        &mut cheap_materials,
    );
    let river = create_body_water_materials(
        WaterBodyKind::River,
        &config,
        witchcraft_params,
        toggles,
        &settings,
        debug_solid_color,
        &mut fancy_materials,
        &mut cheap_materials,
    );
    let pond = create_body_water_materials(
        WaterBodyKind::Pond,
        &config,
        witchcraft_params,
        toggles,
        &settings,
        debug_solid_color,
        &mut fancy_materials,
        &mut cheap_materials,
    );
    let shallow_flood = create_body_water_materials(
        WaterBodyKind::ShallowFlood,
        &config,
        witchcraft_params,
        toggles,
        &settings,
        debug_solid_color,
        &mut fancy_materials,
        &mut cheap_materials,
    );
    let unknown = create_body_water_materials(
        WaterBodyKind::Unknown,
        &config,
        witchcraft_params,
        toggles,
        &settings,
        debug_solid_color,
        &mut fancy_materials,
        &mut cheap_materials,
    );
    let mask_handle = cheap_materials.add(StandardMaterial {
        base_color: Color::WHITE,
        alpha_mode: AlphaMode::Opaque,
        unlit: true,
        double_sided: true,
        cull_mode: None,
        ..default()
    });

    commands.insert_resource(WaterMaterial {
        near_handle: ocean.near.clone(),
        far_handle: ocean.far.clone(),
        mask_handle,
        ocean,
        lake,
        river,
        pond,
        shallow_flood,
        unknown,
    });
}

fn create_body_water_materials(
    kind: WaterBodyKind,
    config: &WaterConfig,
    witchcraft_params: WitchcraftWaterFinishParams,
    toggles: WaterShaderToggles,
    settings: &WaterSettings,
    debug_solid_color: bool,
    fancy_materials: &mut Assets<StandardWaterMaterial>,
    cheap_materials: &mut Assets<StandardMaterial>,
) -> BodyWaterMaterialHandles {
    let preset = config.body_preset(kind);
    let debug_body_colors = water_debug_body_colors_enabled();
    let base_color = water_base_color(
        preset,
        settings,
        debug_solid_color,
        debug_body_colors,
        kind,
        witchcraft_params,
    );
    let alpha_mode = if debug_solid_color {
        AlphaMode::Opaque
    } else {
        AlphaMode::Blend
    };
    let shallow_color = if debug_body_colors && !debug_solid_color {
        water_debug_body_color(kind)
    } else {
        water_color(
            witchcraft_params.multiply_rgba(preset.shallow_color),
            debug_solid_color,
        )
    };
    let deep_color = if debug_body_colors && !debug_solid_color {
        water_debug_body_color(kind)
    } else {
        water_color(
            witchcraft_params.multiply_rgba(preset.deep_color),
            debug_solid_color,
        )
    };
    let wave_amplitude = if debug_solid_color {
        0.0
    } else {
        preset.wave_amplitude.max(0.0)
    };
    let clarity = if debug_solid_color {
        settings.clarity * VOXEL_WATER_CLARITY_MULT
    } else {
        preset.clarity.max(0.0)
    };
    let edge_scale = match kind {
        WaterBodyKind::Ocean => settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT,
        WaterBodyKind::Lake | WaterBodyKind::Pond => {
            (settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT * 1.45).max(0.1)
        }
        WaterBodyKind::River | WaterBodyKind::ShallowFlood | WaterBodyKind::Unknown => {
            settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT
        }
    };
    let edge_scale = if water_ripple_lines_disabled() {
        -edge_scale.abs()
    } else {
        edge_scale
    };

    let mut water_extension = BevyWaterMaterial {
        amplitude: wave_amplitude,
        clarity,
        deep_color,
        shallow_color,
        edge_color: water_edge_color(shallow_color, preset, debug_solid_color, witchcraft_params),
        edge_scale,
        coord_offset: Vec2::ZERO,
        coord_scale: Vec2::splat(VOXEL_WATER_WAVE_UV_SCALE),
        quality: settings.water_quality.into(),
        ..default()
    };
    apply_noble_water_shader_params(&mut water_extension, preset, toggles);

    let near = fancy_materials.add(StandardWaterMaterial {
        base: StandardMaterial {
            base_color,
            alpha_mode,
            perceptual_roughness: if matches!(kind, WaterBodyKind::Lake | WaterBodyKind::Pond) {
                0.045
            } else {
                0.06
            },
            metallic: 0.0,
            reflectance: preset.reflection_strength.clamp(0.0, 1.0),
            clearcoat: if matches!(kind, WaterBodyKind::Lake) {
                0.72
            } else if matches!(kind, WaterBodyKind::ShallowFlood) {
                0.1
            } else {
                0.55
            },
            clearcoat_perceptual_roughness: if matches!(kind, WaterBodyKind::Lake) {
                0.06
            } else {
                0.1
            },
            double_sided: true,
            cull_mode: None,
            depth_bias: WATER_SURFACE_DEPTH_BIAS,
            specular_transmission: if matches!(kind, WaterBodyKind::Ocean) {
                0.18
            } else if matches!(kind, WaterBodyKind::ShallowFlood) {
                0.02
            } else {
                0.12
            },
            ior: 1.33,
            thickness: if matches!(kind, WaterBodyKind::Pond) {
                0.35
            } else {
                0.5
            },
            ..default()
        },
        extension: water_extension,
    });

    let far = cheap_materials.add(StandardMaterial {
        base_color,
        alpha_mode,
        perceptual_roughness: if matches!(kind, WaterBodyKind::Lake | WaterBodyKind::Pond) {
            0.06
        } else {
            0.08
        },
        metallic: 0.0,
        reflectance: preset.reflection_strength.clamp(0.0, 1.0),
        clearcoat: if matches!(kind, WaterBodyKind::Lake) {
            0.62
        } else if matches!(kind, WaterBodyKind::ShallowFlood) {
            0.08
        } else {
            0.5
        },
        clearcoat_perceptual_roughness: 0.12,
        double_sided: true,
        cull_mode: None,
        depth_bias: WATER_SURFACE_DEPTH_BIAS,
        ..default()
    });

    BodyWaterMaterialHandles { near, far }
}

fn water_color(rgba: [f32; 4], debug_solid_color: bool) -> Color {
    if debug_solid_color {
        Color::srgba(0.0, 0.65, 1.0, 1.0)
    } else {
        Color::srgba(rgba[0], rgba[1], rgba[2], rgba[3])
    }
}

fn water_edge_color(
    shallow_color: Color,
    preset: &WaterBodyPresetConfig,
    debug_solid_color: bool,
    witchcraft_params: WitchcraftWaterFinishParams,
) -> Color {
    if debug_solid_color {
        return shallow_color;
    }
    let linear = shallow_color.to_linear();
    let witchcraft_alpha =
        witchcraft_params.shader_control_alpha(preset.lake_ripple_overlay_strength);
    Color::linear_rgba(linear.red, linear.green, linear.blue, witchcraft_alpha)
}

fn apply_noble_water_shader_params(
    extension: &mut BevyWaterMaterial,
    preset: &WaterBodyPresetConfig,
    toggles: WaterShaderToggles,
) {
    let default_dir = Vec2::new(1.0, 2.0).normalize();
    if toggles.any() {
        extension.coord_scale =
            Vec2::splat(VOXEL_WATER_WAVE_UV_SCALE * preset.wave_scale.max(0.01));
        extension.wave_dir_a = Vec2::new(
            preset.wave_speed.max(0.01),
            preset.wave_count.clamp(1, 32) as f32,
        );
        extension.wave_dir_b = Vec2::new(
            preset.detail_normal_intensity.max(0.0),
            preset.detail_scroll_speed.max(0.0),
        );
        extension.wave_blend = preset.wave_scale.max(0.01);
    } else {
        extension.coord_scale = Vec2::splat(VOXEL_WATER_WAVE_UV_SCALE);
        extension.wave_dir_a = default_dir;
        extension.wave_dir_b = default_dir;
        extension.wave_blend = 1.0;
    }
}

fn water_base_color(
    preset: &WaterBodyPresetConfig,
    settings: &WaterSettings,
    debug_solid_color: bool,
    debug_body_colors: bool,
    kind: WaterBodyKind,
    witchcraft_params: WitchcraftWaterFinishParams,
) -> Color {
    if debug_solid_color {
        Color::srgba(0.0, 0.75, 1.0, 1.0)
    } else if debug_body_colors {
        water_debug_body_color(kind)
    } else {
        let [r, g, b, _] = witchcraft_params.multiply_rgba(preset.shallow_color);
        let alpha = preset.base_alpha.clamp(0.05, 1.0);
        let _ = settings;
        Color::srgba(r, g, b, alpha)
    }
}

fn water_debug_body_color(kind: WaterBodyKind) -> Color {
    match kind {
        WaterBodyKind::Ocean => Color::srgba(0.0, 0.18, 1.0, 0.78),
        WaterBodyKind::Lake => Color::srgba(0.0, 0.75, 0.25, 0.78),
        WaterBodyKind::River => Color::srgba(0.6, 0.15, 1.0, 0.78),
        WaterBodyKind::Pond => Color::srgba(0.85, 0.8, 0.0, 0.78),
        WaterBodyKind::ShallowFlood => Color::srgba(1.0, 0.15, 0.05, 0.58),
        WaterBodyKind::Unknown => Color::srgba(1.0, 1.0, 1.0, 0.6),
    }
}

pub fn sync_voxel_water_material_overrides(
    water_settings: Option<Res<WaterSettings>>,
    water_config: Option<Res<WaterConfig>>,
    shader_toggles: Option<Res<WaterShaderToggles>>,
    water_material: Option<Res<WaterMaterial>>,
    mut materials: ResMut<Assets<StandardWaterMaterial>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Sync Water");
    let (Some(settings), Some(water_material)) = (water_settings, water_material) else {
        return;
    };

    let toggles_changed = shader_toggles
        .as_ref()
        .map(|r| r.is_changed())
        .unwrap_or(false);
    if !settings.is_changed() && !toggles_changed {
        return;
    }

    let debug_solid_color = water_debug_solid_color_enabled();
    let debug_body_colors = water_debug_body_colors_enabled();
    let config = water_config.as_deref().cloned().unwrap_or_default();
    let witchcraft_params = config.witchcraft_finish.params();
    let toggles = shader_toggles.as_deref().copied().unwrap_or_default();
    for (kind, handle) in [
        (WaterBodyKind::Ocean, &water_material.ocean.near),
        (WaterBodyKind::Lake, &water_material.lake.near),
        (WaterBodyKind::River, &water_material.river.near),
        (WaterBodyKind::Pond, &water_material.pond.near),
        (
            WaterBodyKind::ShallowFlood,
            &water_material.shallow_flood.near,
        ),
        (WaterBodyKind::Unknown, &water_material.unknown.near),
    ] {
        let preset = config.body_preset(kind);
        if let Some(mat) = materials.get_mut(handle) {
            mat.base.base_color = water_base_color(
                preset,
                &settings,
                debug_solid_color,
                debug_body_colors,
                kind,
                witchcraft_params,
            );
            mat.base.alpha_mode = if debug_solid_color {
                AlphaMode::Opaque
            } else {
                settings.alpha_mode
            };
            mat.base.double_sided = true;
            mat.base.cull_mode = None;
            mat.base.depth_bias = WATER_SURFACE_DEPTH_BIAS;

            mat.extension.amplitude = if debug_solid_color {
                0.0
            } else {
                preset.wave_amplitude.max(0.0)
            };
            mat.extension.clarity = if debug_solid_color {
                settings.clarity * VOXEL_WATER_CLARITY_MULT
            } else {
                preset.clarity.max(0.0)
            };
            mat.extension.deep_color = if debug_body_colors && !debug_solid_color {
                water_debug_body_color(kind)
            } else {
                water_color(
                    witchcraft_params.multiply_rgba(preset.deep_color),
                    debug_solid_color,
                )
            };
            mat.extension.shallow_color = if debug_body_colors && !debug_solid_color {
                water_debug_body_color(kind)
            } else {
                water_color(
                    witchcraft_params.multiply_rgba(preset.shallow_color),
                    debug_solid_color,
                )
            };
            mat.extension.edge_color = water_edge_color(
                mat.extension.shallow_color,
                preset,
                debug_solid_color,
                witchcraft_params,
            );
            let edge_scale = settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT;
            mat.extension.edge_scale = if water_ripple_lines_disabled() {
                -edge_scale.abs()
            } else {
                edge_scale
            };
            mat.extension.coord_offset = Vec2::ZERO;
            mat.extension.coord_scale = Vec2::splat(VOXEL_WATER_WAVE_UV_SCALE);
            mat.extension.quality = settings.water_quality.into();
            apply_noble_water_shader_params(&mut mat.extension, preset, toggles);
        }
    }
}

fn water_ripple_lines_disabled() -> bool {
    std::env::var("VOXEL_DISABLE_VOXEL_WATER_RIPPLE_LINES").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

/// Ensure the atlas uses a repeat/mipmapped sampler so tiled terrain does not clamp or alias

/// Setup triplanar terrain material for surface nets meshes with PBR textures
/// Loads grass, rock, sand, and dirt texture sets for multi-material terrain
pub fn setup_triplanar_material(
    mut commands: Commands,
    mut materials: ResMut<Assets<TriplanarMaterial>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    asset_server: Res<AssetServer>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Setup Triplanar");
    let integrated = capabilities
        .as_ref()
        .map(|capabilities| capabilities.integrated_gpu)
        .unwrap_or(false);

    let base_material = if integrated {
        TriplanarMaterial {
            uniforms: TriplanarUniforms {
                base_color: LinearRgba::WHITE,
                tex_scale: 2.0,
                blend_sharpness: 4.0,
                normal_intensity: 1.0,
                parallax_scale: 0.0,
                ao_strength: 0.0,
                ..Default::default()
            },
            quality: TerrainMaterialQuality::FullTriplanar,
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
                tex_scale: 2.0,        // Higher resolution (1 tile per 2 world units)
                blend_sharpness: 4.0,  // Moderate blend between projections
                normal_intensity: 1.0, // Full normal map strength
                parallax_scale: 0.04,  // Subtle parallax depth
                ao_strength: 0.0,      // V0.3 soft shadow look
                ..Default::default()
            },
            quality: TerrainMaterialQuality::FullTriplanar,
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
    };

    let mut full_material = base_material.clone();
    full_material.quality = TerrainMaterialQuality::FullTriplanar;
    let mut cheap_material = base_material.clone();
    cheap_material.quality = TerrainMaterialQuality::CheapTriplanar;
    let mut single_projection_far_material = base_material.clone();
    single_projection_far_material.quality = TerrainMaterialQuality::SingleProjectionFar;
    let mut atlas_only_debug_material = base_material;
    atlas_only_debug_material.quality = TerrainMaterialQuality::AtlasOnlyDebug;

    let material_handle = materials.add(full_material);
    let cheap_handle = materials.add(cheap_material);
    let single_projection_far_handle = materials.add(single_projection_far_material);
    let atlas_only_debug_handle = materials.add(atlas_only_debug_material);

    commands.insert_resource(TriplanarMaterialHandle {
        handle: material_handle,
        cheap_handle,
        single_projection_far_handle,
        atlas_only_debug_handle,
    });
}

/// Ensure all triplanar textures use Repeat address mode for seamless tiling with proper mipmaps
pub fn configure_triplanar_textures(
    mat_handle: Option<Res<TriplanarMaterialHandle>>,
    materials: Res<Assets<TriplanarMaterial>>,
    mut images: ResMut<Assets<Image>>,
    mut configured: Local<bool>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Configure Triplanar");
    if *configured {
        return;
    }

    if let Some(handle) = mat_handle {
        if let Some(material) = materials.get(&handle.handle) {
            let textures = [
                &material.grass_albedo,
                &material.grass_normal,
                &material.rock_albedo,
                &material.rock_normal,
                &material.sand_albedo,
                &material.sand_normal,
                &material.dirt_albedo,
                &material.dirt_normal,
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
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Configure Building");
    if *configured {
        return;
    }

    if let Some(handle) = mat_handle {
        if let Some(material) = materials.get(&handle.handle) {
            let textures = [
                &material.wood_albedo,
                &material.wood_normal,
                &material.wood_roughness,
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
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Configure Props");
    if *configured {
        return;
    }

    if let Some(handle) = mat_handle {
        if let Some(material) = materials.get(&handle.handle) {
            let textures = [
                &material.rock_albedo,
                &material.rock_normal,
                &material.rock_roughness,
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
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Setup Building");
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
                tex_scale: 1.0,       // 1 tile per world unit for building detail
                blend_sharpness: 8.0, // Sharp transitions for buildings
                normal_intensity: 1.0,
                parallax_scale: 0.04, // Subtle parallax depth
                parallax_steps: 6,    // Balanced quality/performance
                ..default()
            },
            // Wood plank textures
            wood_albedo: load_image_if_exists(&asset_server, "textures/building/wood/albedo.png"),
            wood_normal: load_image_if_exists(&asset_server, "textures/building/wood/normal.png"),
            wood_roughness: load_image_if_exists(
                &asset_server,
                "textures/building/wood/roughness.png",
            ),
            wood_ao: load_image_if_exists(&asset_server, "textures/building/wood/ao.png"),
            // Stone brick textures
            stone_albedo: load_image_if_exists(&asset_server, "textures/building/stone/albedo.png"),
            stone_normal: load_image_if_exists(&asset_server, "textures/building/stone/normal.png"),
            stone_roughness: load_image_if_exists(
                &asset_server,
                "textures/building/stone/roughness.png",
            ),
            stone_ao: load_image_if_exists(&asset_server, "textures/building/stone/ao.png"),
            // Metal plate textures
            metal_albedo: load_image_if_exists(&asset_server, "textures/building/metal/albedo.png"),
            metal_normal: load_image_if_exists(&asset_server, "textures/building/metal/normal.png"),
            metal_roughness: load_image_if_exists(
                &asset_server,
                "textures/building/metal/roughness.png",
            ),
            metal_ao: load_image_if_exists(&asset_server, "textures/building/metal/ao.png"),
            metal_metallic: load_image_if_exists(
                &asset_server,
                "textures/building/metal/metallic.png",
            ),
            // Thatch textures
            thatch_albedo: load_image_if_exists(
                &asset_server,
                "textures/building/thatch/albedo.png",
            ),
            thatch_normal: load_image_if_exists(
                &asset_server,
                "textures/building/thatch/normal.png",
            ),
            thatch_roughness: load_image_if_exists(
                &asset_server,
                "textures/building/thatch/roughness.png",
            ),
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
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Setup Props");
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
                alpha_cutoff: 0.0,
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
                alpha_cutoff: 0.0,
                ..default()
            },
            // Rock textures (full props PBR)
            rock_albedo: load_image_if_exists(&asset_server, "pbr/props/rock/albedo.png"),
            rock_normal: load_image_if_exists(&asset_server, "pbr/props/rock/normal.png"),
            rock_roughness: load_image_if_exists(&asset_server, "pbr/props/rock/roughness.png"),
            rock_ao: load_image_if_exists(&asset_server, "pbr/props/rock/ao.png"),
            alpha_mode: AlphaMode::Opaque,
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
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Sync Fog");
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
        let _ = handle;
        for (_, mat) in props_materials.iter_mut() {
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

/// Sync the tiny weather uniform into terrain materials.
///
/// This only updates material uniforms. It does not spawn CPU particles, mutate voxel terrain,
/// upload weather textures, or drive water displacement.
pub fn sync_weather_to_materials(
    weather: Option<Res<WeatherRuntime>>,
    triplanar_handles: Option<Res<TriplanarMaterialHandle>>,
    blocky_handle: Option<Res<BlockyMaterialHandle>>,
    mut triplanar_materials: ResMut<Assets<TriplanarMaterial>>,
    mut blocky_materials: ResMut<Assets<BlockyMaterial>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Sync Weather");
    let Some(weather) = weather else { return };

    if !weather.is_changed() {
        return;
    }

    let uniforms = weather.uniforms;
    if let Some(handles) = triplanar_handles {
        let weather_flags = uniforms.flags | terrain_weather_debug_flags();
        let full_puddle_normals = if uniforms.flags & WEATHER_FLAG_PUDDLE_DETAIL != 0 {
            0.055
        } else {
            0.0
        };
        for (handle, puddle_normal_strength) in [
            (&handles.handle, full_puddle_normals),
            (&handles.cheap_handle, 0.0),
            (&handles.single_projection_far_handle, 0.0),
            (&handles.atlas_only_debug_handle, 0.0),
        ] {
            if let Some(material) = triplanar_materials.get_mut(handle) {
                material.uniforms.rain_factor = uniforms.rain_factor;
                material.uniforms.wetness = uniforms.wetness;
                material.uniforms.in_rainy = uniforms.in_rainy;
                material.uniforms.snow_factor = uniforms.snow_factor;
                material.uniforms.in_snowy = uniforms.in_snowy;
                material.uniforms.puddle_strength = uniforms.puddle_strength;
                material.uniforms.puddle_noise_scale = 0.085;
                material.uniforms.puddle_normal_strength = puddle_normal_strength;
                material.uniforms.snow_tint_strength = uniforms.snow_tint_strength;
                material.uniforms.weather_time = uniforms.time;
                material.uniforms.weather_flags = weather_flags;
            }
        }
    }

    if let Some(handle) = blocky_handle {
        if let Some(material) = blocky_materials.get_mut(&handle.handle) {
            material.uniforms.rain_factor = uniforms.rain_factor;
            material.uniforms.wetness = uniforms.wetness;
            material.uniforms.snow_factor = uniforms.snow_tint_strength;
            material.uniforms.weather_time = uniforms.time;
            material.uniforms.weather_flags = uniforms.flags | blocky_weather_debug_flags();
        }
    }
}

fn terrain_weather_debug_flags() -> u32 {
    const DEBUG_PUDDLE: u32 = 1 << 8;
    const DEBUG_WETNESS: u32 = 1 << 9;
    const DEBUG_SNOW: u32 = 1 << 10;

    let Ok(value) = std::env::var("VOXEL_TERRAIN_WEATHER_DEBUG") else {
        return 0;
    };

    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "puddle" | "puddles" | "mask" => DEBUG_PUDDLE,
        "2" | "wet" | "wetness" => DEBUG_WETNESS,
        "3" | "snow" => DEBUG_SNOW,
        _ => 0,
    }
}

fn blocky_weather_debug_flags() -> u32 {
    const DEBUG_WETNESS: u32 = 1 << 11;
    const DEBUG_SNOW: u32 = 1 << 12;

    let Ok(value) = std::env::var("VOXEL_BLOCKY_WEATHER_DEBUG") else {
        return 0;
    };

    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "wet" | "wetness" => DEBUG_WETNESS,
        "2" | "snow" => DEBUG_SNOW,
        _ => 0,
    }
}
