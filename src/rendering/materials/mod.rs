use crate::atmosphere::FogUniforms;
use crate::bench::BenchRenderToggles;
use crate::constants::{
    VOXEL_WATER_CLARITY_MULT, VOXEL_WATER_EDGE_SCALE_MULT, VOXEL_WATER_WAVE_UV_SCALE,
};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::blocky_material::{BlockyMaterial, BlockyMaterialHandle};
use crate::rendering::building_material::{
    BuildingMaterial, BuildingMaterialHandle, BuildingUniforms,
};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::procedural_textures::ProceduralTerrainTextureHandles;
use crate::rendering::procedural_textures::config::default_material_recipes;
use crate::rendering::procedural_textures::recipes::ProceduralMaterialId;
use crate::rendering::props_material::{PropsMaterial, PropsMaterialHandle, PropsUniforms};
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::terrain_hex_tiling::{
    TerrainTexturingConfig, effective_hex_tiling_enabled, effective_hex_tiling_normal_enabled,
    hex_tiling_uniform_from_config,
};
use crate::rendering::triplanar_material::{
    HexTilingUniform, TerrainIsoBandUniforms, TerrainMaterialQuality, TriplanarMaterial,
    TriplanarMaterialHandle, TriplanarUniforms,
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
    let edge_scale = water_edge_scale(kind, settings);

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
            reflectance: water_reflectance(preset),
            clearcoat: water_clearcoat(kind),
            clearcoat_perceptual_roughness: if matches!(kind, WaterBodyKind::Lake) {
                0.06
            } else {
                0.1
            },
            double_sided: true,
            cull_mode: None,
            depth_bias: WATER_SURFACE_DEPTH_BIAS,
            specular_transmission: water_specular_transmission(kind),
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
        reflectance: water_reflectance(preset),
        clearcoat: water_clearcoat(kind),
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

fn water_reflectance(preset: &WaterBodyPresetConfig) -> f32 {
    (preset.reflection_strength * 0.62).clamp(0.02, 0.46)
}

fn water_clearcoat(kind: WaterBodyKind) -> f32 {
    match kind {
        WaterBodyKind::Ocean => 0.26,
        WaterBodyKind::Lake => 0.3,
        WaterBodyKind::River => 0.18,
        WaterBodyKind::Pond => 0.2,
        WaterBodyKind::ShallowFlood => 0.06,
        WaterBodyKind::Unknown => 0.24,
    }
}

fn water_specular_transmission(kind: WaterBodyKind) -> f32 {
    match kind {
        WaterBodyKind::Ocean => 0.06,
        WaterBodyKind::Lake | WaterBodyKind::River | WaterBodyKind::Pond => 0.04,
        WaterBodyKind::ShallowFlood => 0.01,
        WaterBodyKind::Unknown => 0.05,
    }
}

fn water_edge_scale(kind: WaterBodyKind, settings: &WaterSettings) -> f32 {
    let edge_scale = match kind {
        WaterBodyKind::Ocean => settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT,
        WaterBodyKind::Lake | WaterBodyKind::Pond => {
            (settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT * 1.45).max(0.1)
        }
        WaterBodyKind::River | WaterBodyKind::ShallowFlood | WaterBodyKind::Unknown => {
            settings.edge_scale * VOXEL_WATER_EDGE_SCALE_MULT
        }
    };

    if water_ripple_lines_disabled() {
        -edge_scale.abs()
    } else {
        edge_scale
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
    let foam_luma = linear.red * 0.2126 + linear.green * 0.7152 + linear.blue * 0.0722;
    let foam = (foam_luma * 0.45 + 0.24).clamp(0.0, 0.78);
    Color::linear_rgba(foam * 0.88, foam * 0.92, foam * 0.92, witchcraft_alpha)
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

#[cfg(test)]
mod water_material_tests {
    use super::*;

    #[test]
    fn water_edge_color_is_desaturated_for_shoreline_blend() {
        let config = WaterConfig::default();
        let preset = config.body_preset(WaterBodyKind::Ocean);
        let shallow_color = water_color(preset.shallow_color, false);
        let edge_color = water_edge_color(
            shallow_color,
            preset,
            false,
            WitchcraftWaterFinishParams::default(),
        )
        .to_linear();

        assert!((edge_color.blue - edge_color.red).abs() < 0.08);
        assert!((edge_color.blue - edge_color.green).abs() < 0.08);
    }

    #[test]
    fn shallow_flood_edge_color_stays_below_foam_white() {
        let config = WaterConfig::default();
        let preset = config.body_preset(WaterBodyKind::ShallowFlood);
        let shallow_color = water_color(preset.shallow_color, false);
        let edge_color = water_edge_color(
            shallow_color,
            preset,
            false,
            WitchcraftWaterFinishParams::default(),
        )
        .to_linear();

        assert!(edge_color.blue < 0.34);
        assert!((edge_color.blue - edge_color.red).abs() < 0.04);
        assert!((edge_color.blue - edge_color.green).abs() < 0.04);
    }

    #[test]
    fn water_reflectance_damps_configured_strength() {
        let config = WaterConfig::default();
        let ocean = config.body_preset(WaterBodyKind::Ocean);

        assert!(water_reflectance(ocean) < ocean.reflection_strength);
        assert!(water_reflectance(ocean) <= 0.46);
    }

    #[test]
    fn still_water_keeps_expanded_shoreline_edge_scale() {
        let settings = WaterSettings {
            edge_scale: 0.4,
            ..default()
        };
        let ocean = water_edge_scale(WaterBodyKind::Ocean, &settings);
        let lake = water_edge_scale(WaterBodyKind::Lake, &settings);
        let pond = water_edge_scale(WaterBodyKind::Pond, &settings);

        assert!(lake > ocean);
        assert_eq!(lake, pond);
        assert!(lake >= 0.1);
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
            mat.extension.edge_scale = water_edge_scale(kind, &settings);
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
    mut images: ResMut<Assets<Image>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    procedural_textures: Option<Res<ProceduralTerrainTextureHandles>>,
    asset_server: Res<AssetServer>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Setup Triplanar");
    let integrated = capabilities
        .as_ref()
        .map(|capabilities| capabilities.integrated_gpu)
        .unwrap_or(false);

    let mut base_material = if integrated {
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
            hex_tiling_shader_enabled: false,
            clod_page_dither: false,
            grass_albedo: None,
            grass_normal: None,
            rock_albedo: None,
            rock_normal: None,
            sand_albedo: None,
            sand_normal: None,
            dirt_albedo: None,
            dirt_normal: None,
            iso_band_volume: None,
            iso_band_params: TerrainIsoBandUniforms::default(),
            hex_tiling: HexTilingUniform::default(),
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
            hex_tiling_shader_enabled: false,
            clod_page_dither: false,
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
            iso_band_volume: None,
            iso_band_params: TerrainIsoBandUniforms::default(),
            hex_tiling: HexTilingUniform::default(),
        }
    };

    if let Some(handles) = procedural_textures.as_deref() {
        apply_procedural_textures_to_triplanar_material(&mut base_material, handles);
    }

    let mut full_material = base_material.clone();
    full_material.quality = TerrainMaterialQuality::FullTriplanar;
    let mut cheap_material = base_material.clone();
    cheap_material.quality = TerrainMaterialQuality::CheapTriplanar;
    let mut single_projection_far_material = base_material.clone();
    single_projection_far_material.quality = TerrainMaterialQuality::SingleProjectionFar;
    let mut horizon_proxy_material = base_material.clone();
    horizon_proxy_material.quality = TerrainMaterialQuality::HorizonProxy;
    let mut atlas_only_debug_material = base_material.clone();
    atlas_only_debug_material.quality = TerrainMaterialQuality::AtlasOnlyDebug;
    let mut wireframe_debug_material = base_material.clone();
    wireframe_debug_material.quality = TerrainMaterialQuality::WireframeDebug;
    let mut normals_debug_material = base_material.clone();
    normals_debug_material.quality = TerrainMaterialQuality::NormalsDebug;
    let mut wireframe_normals_debug_material = base_material.clone();
    wireframe_normals_debug_material.quality = TerrainMaterialQuality::WireframeNormalsDebug;
    let mut flat_unlit_debug_material = base_material.clone();
    flat_unlit_debug_material.quality = TerrainMaterialQuality::FlatUnlitDebug;
    let mut wireframe_flat_unlit_debug_material = base_material.clone();
    wireframe_flat_unlit_debug_material.quality = TerrainMaterialQuality::WireframeFlatUnlitDebug;
    for material in [
        &mut full_material,
        &mut cheap_material,
        &mut single_projection_far_material,
        &mut horizon_proxy_material,
        &mut atlas_only_debug_material,
        &mut wireframe_debug_material,
        &mut normals_debug_material,
        &mut wireframe_normals_debug_material,
        &mut flat_unlit_debug_material,
        &mut wireframe_flat_unlit_debug_material,
    ] {
        material.uniforms.procedural_textures_enabled =
            if procedural_sampling_enabled_for_quality(material.quality) {
                material.uniforms.procedural_textures_enabled
            } else {
                0.0
            };
    }

    let iso_band_image = crate::voxel::terrain_iso_band::create_iso_band_volume_image();
    let iso_band_texture = images.add(iso_band_image);
    let attach_iso_band = |material: &mut TriplanarMaterial| {
        material.iso_band_volume = Some(iso_band_texture.clone());
        material.iso_band_params = TerrainIsoBandUniforms::default();
    };
    attach_iso_band(&mut full_material);
    attach_iso_band(&mut cheap_material);
    attach_iso_band(&mut single_projection_far_material);
    attach_iso_band(&mut horizon_proxy_material);
    attach_iso_band(&mut atlas_only_debug_material);
    attach_iso_band(&mut wireframe_debug_material);
    attach_iso_band(&mut normals_debug_material);
    attach_iso_band(&mut wireframe_normals_debug_material);
    attach_iso_band(&mut flat_unlit_debug_material);
    attach_iso_band(&mut wireframe_flat_unlit_debug_material);

    let hex_tiling_enabled = false;
    for material in [
        &mut full_material,
        &mut cheap_material,
        &mut single_projection_far_material,
        &mut horizon_proxy_material,
        &mut atlas_only_debug_material,
        &mut wireframe_debug_material,
        &mut normals_debug_material,
        &mut wireframe_normals_debug_material,
        &mut flat_unlit_debug_material,
        &mut wireframe_flat_unlit_debug_material,
    ] {
        material.hex_tiling_shader_enabled = hex_tiling_enabled;
        material.hex_tiling = hex_tiling_uniform_from_config(
            &TerrainTexturingConfig::default(),
            hex_tiling_enabled,
            false,
        );
    }

    let material_handle = materials.add(full_material);
    let cheap_handle = materials.add(cheap_material);
    let single_projection_far_handle = materials.add(single_projection_far_material);
    let horizon_proxy_handle = materials.add(horizon_proxy_material);
    let atlas_only_debug_handle = materials.add(atlas_only_debug_material);
    let wireframe_debug_handle = materials.add(wireframe_debug_material);
    let normals_debug_handle = materials.add(normals_debug_material);
    let wireframe_normals_debug_handle = materials.add(wireframe_normals_debug_material);
    let flat_unlit_debug_handle = materials.add(flat_unlit_debug_material);
    let wireframe_flat_unlit_debug_handle = materials.add(wireframe_flat_unlit_debug_material);

    commands.insert_resource(TriplanarMaterialHandle {
        handle: material_handle.clone(),
        cheap_handle: cheap_handle.clone(),
        single_projection_far_handle: single_projection_far_handle.clone(),
        horizon_proxy_handle: horizon_proxy_handle.clone(),
        atlas_only_debug_handle: atlas_only_debug_handle.clone(),
        wireframe_debug_handle: wireframe_debug_handle.clone(),
        normals_debug_handle: normals_debug_handle.clone(),
        wireframe_normals_debug_handle: wireframe_normals_debug_handle.clone(),
        flat_unlit_debug_handle: flat_unlit_debug_handle.clone(),
        wireframe_flat_unlit_debug_handle: wireframe_flat_unlit_debug_handle.clone(),
    });
    commands.insert_resource(
        crate::voxel::terrain_debug::TerrainDebugMaterialHandles::from_base(
            &material_handle,
            &wireframe_debug_handle,
            &normals_debug_handle,
            &wireframe_normals_debug_handle,
            &flat_unlit_debug_handle,
            &wireframe_flat_unlit_debug_handle,
            &iso_band_texture,
            &mut materials,
        ),
    );
    commands.insert_resource(crate::voxel::terrain_iso_band::TerrainIsoBandVolume::new(
        iso_band_texture,
    ));
}

pub fn apply_procedural_textures_to_triplanar_material(
    material: &mut TriplanarMaterial,
    handles: &ProceduralTerrainTextureHandles,
) {
    material.grass_albedo = Some(handles.grass_albedo.clone());
    material.grass_normal = Some(handles.grass_normal.clone());
    material.rock_albedo = Some(handles.rock_albedo.clone());
    material.rock_normal = Some(handles.rock_normal.clone());
    material.sand_albedo = Some(handles.sand_albedo.clone());
    material.sand_normal = Some(handles.sand_normal.clone());
    material.dirt_albedo = Some(handles.dirt_albedo.clone());
    material.dirt_normal = Some(handles.dirt_normal.clone());
    material.uniforms.procedural_textures_enabled =
        if procedural_sampling_enabled_for_quality(material.quality) {
            1.0
        } else {
            0.0
        };
    let masks = handles.config.terrain.masks;
    let fallback_recipes = default_material_recipes();
    let roughness = |id: ProceduralMaterialId| {
        handles
            .config
            .terrain
            .materials
            .get(&id)
            .or_else(|| fallback_recipes.get(&id))
            .map(|recipe| recipe.roughness)
            .unwrap_or(0.9)
    };
    material.uniforms.procedural_snow_mask = Vec4::new(
        masks.snow_height[0],
        masks.snow_height[1],
        masks.snow_upness[0],
        masks.snow_upness[1],
    );
    material.uniforms.procedural_wet_mask = Vec4::new(
        masks.wet_height[0],
        masks.wet_height[1],
        masks.wet_upness[0],
        masks.wet_upness[1],
    );
    material.uniforms.procedural_slope_masks = Vec4::new(
        masks.moss_upness[0],
        masks.moss_upness[1],
        masks.gravel_slope[0],
        masks.gravel_slope[1],
    );
    material.uniforms.procedural_tint_strengths = Vec4::new(
        masks.snow_tint_strength,
        masks.moss_tint_strength,
        masks.gravel_tint_strength,
        masks.wet_tint_strength,
    );
    material.uniforms.procedural_material_roughness = Vec4::new(
        roughness(ProceduralMaterialId::Grass),
        roughness(ProceduralMaterialId::Rock),
        roughness(ProceduralMaterialId::Sand),
        roughness(ProceduralMaterialId::Dirt),
    );
    material.uniforms.procedural_moss_tint = Vec4::new(
        masks.moss_tint[0],
        masks.moss_tint[1],
        masks.moss_tint[2],
        0.0,
    );
    material.uniforms.procedural_gravel_tint = Vec4::new(
        masks.gravel_tint[0],
        masks.gravel_tint[1],
        masks.gravel_tint[2],
        0.0,
    );
    material.uniforms.procedural_wet_tint =
        Vec4::new(masks.wet_tint[0], masks.wet_tint[1], masks.wet_tint[2], 0.0);
    material.uniforms.procedural_snow_tint = Vec4::new(
        masks.snow_tint[0],
        masks.snow_tint[1],
        masks.snow_tint[2],
        0.0,
    );
    material.uniforms.procedural_material_params = Vec4::new(
        handles.config.terrain.micro_normal.fade_start_m,
        handles.config.terrain.micro_normal.fade_end_m,
        masks.wet_roughness,
        masks.wet_roughness_strength,
    );
}

fn procedural_sampling_enabled_for_quality(quality: TerrainMaterialQuality) -> bool {
    matches!(
        quality,
        TerrainMaterialQuality::FullTriplanar
            | TerrainMaterialQuality::CheapTriplanar
            | TerrainMaterialQuality::SingleProjectionFar
    )
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
    if *configured {
        {
            let _timer = area_timer(&mut timing, frame.0, "Material Configure Triplanar");
        }
        timing.record_count(frame.0, "Terrain Triplanar Textures Configured", 1.0);
        return;
    }

    let mut expected_textures = None;
    let mut loaded_textures = None;
    let mut textures_configured = None;
    {
        let _timer = area_timer(&mut timing, frame.0, "Material Configure Triplanar");
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
                let mut expected = 0u32;
                let mut loaded = 0u32;
                for tex_opt in textures {
                    if let Some(tex_handle) = tex_opt {
                        expected += 1;
                        if let Some(image) = images.get_mut(tex_handle) {
                            loaded += 1;
                            if image.texture_descriptor.mip_level_count == 1 {
                                let width = image.texture_descriptor.size.width;
                                let height = image.texture_descriptor.size.height;
                                let mip_count =
                                    crate::rendering::mipmaps::calculate_mip_count(width, height);
                                if crate::rendering::mipmaps::supports_mipmaps(
                                    image.texture_descriptor.format,
                                ) && let Some(data) = image.data.as_mut()
                                {
                                    crate::rendering::mipmaps::generate_mipmaps_rgba8(
                                        data, width, height, mip_count,
                                    );
                                    image.texture_descriptor.mip_level_count = mip_count;
                                }
                            }

                            // Set sampler to Repeat for tiling with trilinear filtering and anisotropy.
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

                expected_textures = Some(expected);
                loaded_textures = Some(loaded);
                if all_loaded {
                    *configured = true;
                    textures_configured = Some(1.0);
                    info!("Triplanar textures configured with anisotropic filtering");
                } else {
                    textures_configured = Some(0.0);
                }
            }
        }
    }

    if let Some(expected_textures) = expected_textures {
        timing.record_count(
            frame.0,
            "Terrain Triplanar Textures Expected",
            expected_textures as f64,
        );
    }
    if let Some(loaded_textures) = loaded_textures {
        timing.record_count(
            frame.0,
            "Terrain Triplanar Textures Loaded",
            loaded_textures as f64,
        );
    }
    if let Some(textures_configured) = textures_configured {
        timing.record_count(
            frame.0,
            "Terrain Triplanar Textures Configured",
            textures_configured,
        );
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
                &material.stone_albedo,
                &material.stone_normal,
                &material.stone_roughness,
                &material.stone_ao,
                &material.metal_albedo,
                &material.metal_normal,
                &material.metal_roughness,
                &material.metal_ao,
                &material.metal_metallic,
                &material.thatch_albedo,
                &material.thatch_normal,
                &material.thatch_roughness,
                &material.thatch_ao,
            ];

            let mut all_loaded = true;
            for tex_opt in textures {
                if let Some(tex_handle) = tex_opt {
                    if let Some(image) = images.get_mut(tex_handle) {
                        if image.texture_descriptor.mip_level_count == 1 {
                            let width = image.texture_descriptor.size.width;
                            let height = image.texture_descriptor.size.height;
                            let mip_count =
                                crate::rendering::mipmaps::calculate_mip_count(width, height);
                            if crate::rendering::mipmaps::supports_mipmaps(
                                image.texture_descriptor.format,
                            ) {
                                if let Some(data) = image.data.as_mut() {
                                    crate::rendering::mipmaps::generate_mipmaps_rgba8(
                                        data, width, height, mip_count,
                                    );
                                    image.texture_descriptor.mip_level_count = mip_count;
                                }
                            }
                        }

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
                        if image.texture_descriptor.mip_level_count == 1 {
                            let width = image.texture_descriptor.size.width;
                            let height = image.texture_descriptor.size.height;
                            let mip_count =
                                crate::rendering::mipmaps::calculate_mip_count(width, height);
                            if crate::rendering::mipmaps::supports_mipmaps(
                                image.texture_descriptor.format,
                            ) {
                                if let Some(data) = image.data.as_mut() {
                                    crate::rendering::mipmaps::generate_mipmaps_rgba8(
                                        data, width, height, mip_count,
                                    );
                                    image.texture_descriptor.mip_level_count = mip_count;
                                }
                            }
                        }

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

fn for_each_triplanar_material<F>(handles: &TriplanarMaterialHandle, mut apply: F)
where
    F: FnMut(&Handle<TriplanarMaterial>),
{
    for handle in [
        &handles.handle,
        &handles.cheap_handle,
        &handles.single_projection_far_handle,
        &handles.horizon_proxy_handle,
        &handles.atlas_only_debug_handle,
        &handles.wireframe_debug_handle,
        &handles.normals_debug_handle,
        &handles.wireframe_normals_debug_handle,
        &handles.flat_unlit_debug_handle,
        &handles.wireframe_flat_unlit_debug_handle,
    ] {
        apply(handle);
    }
}

/// Sync hex-tiling uniforms and pipeline specialization into all triplanar materials.
pub fn sync_hex_tiling_to_materials(
    config: Option<Res<TerrainTexturingConfig>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    quality_preset: Option<Res<RenderQualityPreset>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    triplanar_handles: Option<Res<TriplanarMaterialHandle>>,
    mut triplanar_materials: ResMut<Assets<TriplanarMaterial>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Material Sync Hex Tiling");
    let Some(config) = config else {
        return;
    };
    let Some(handles) = triplanar_handles else {
        return;
    };

    // Only touch material assets when an input actually changed. `get_mut`
    // dirties the asset and forces a bind-group rebuild, so an unconditional
    // pass would do that for every terrain material every frame. Mirrors the
    // `is_changed()` guard in `sync_weather_to_materials`.
    let inputs_changed = config.is_changed()
        || handles.is_changed()
        || capabilities.as_ref().is_some_and(|res| res.is_changed())
        || quality_preset.as_ref().is_some_and(|res| res.is_changed())
        || bench_toggles.as_ref().is_some_and(|res| res.is_changed());
    if !inputs_changed {
        return;
    }

    let enabled = effective_hex_tiling_enabled(
        &config,
        capabilities.as_deref(),
        quality_preset.as_deref().copied().unwrap_or_default(),
        bench_toggles.as_deref(),
    );
    let normal_enabled = effective_hex_tiling_normal_enabled(
        &config,
        capabilities.as_deref(),
        quality_preset.as_deref().copied().unwrap_or_default(),
        bench_toggles.as_deref(),
    );
    let uniform = hex_tiling_uniform_from_config(&config, enabled, normal_enabled);

    for_each_triplanar_material(&handles, |handle| {
        if let Some(material) = triplanar_materials.get_mut(handle) {
            material.hex_tiling_shader_enabled = enabled;
            material.hex_tiling = uniform;
        }
    });
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
            (&handles.wireframe_debug_handle, 0.0),
            (&handles.normals_debug_handle, 0.0),
            (&handles.wireframe_normals_debug_handle, 0.0),
            (&handles.flat_unlit_debug_handle, 0.0),
            (&handles.wireframe_flat_unlit_debug_handle, 0.0),
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
pub mod blocky;
pub mod building;
pub mod props;
pub mod triplanar;
