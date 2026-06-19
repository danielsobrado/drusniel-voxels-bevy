use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponentPlugin;
use bevy::render::{Render, RenderApp, RenderSystems};

use crate::props::billboard::BillboardMaterial;
use crate::props::lod_material::SimpleLodMaterial;
use crate::rendering::assets::array_loader::{create_texture_array, start_loading_texture_arrays};
use crate::rendering::assets::atlas::load_texture_atlas;
use crate::rendering::camera_modes::cinematic::CinematicPlugin;
use crate::rendering::camera_modes::photo_mode::PhotoModePlugin;
use crate::rendering::device::capabilities::{
    GraphicsCapabilities, GraphicsDetectionSet, detect_graphics_capabilities,
    sync_capabilities_to_main,
};
use crate::rendering::device::quality::{
    RenderQualityPreset, apply_render_quality_preset, record_render_quality_counters,
    sync_render_quality_preset,
};
use crate::rendering::diagnostics::render_timing::install_render_timing;
use crate::rendering::diagnostics::water_visual_probe::WaterVisualProbePlugin;
use crate::rendering::diagnostics::weather_overlay::WeatherOverlayPlugin;
use crate::rendering::effects::ao_msaa::disable_msaa_for_screen_space_ao;
use crate::rendering::effects::god_rays::GodRayPlugin;
use crate::rendering::effects::gtao::GtaoPlugin;
use crate::rendering::effects::ssao::SsaoPlugin;
use crate::rendering::lighting::radiance_cascades::RadianceCascadesPlugin;
use crate::rendering::lighting::ray_tracing::{
    RayTracingSettings, VoxelRayBackendNotice, setup_voxel_ray_backend_notice,
    toggle_voxel_ray_backend_key, update_voxel_ray_backend_notice,
};
use crate::rendering::materials::blocky::BlockyMaterial;
use crate::rendering::materials::building::{BuildingMaterial, BuildingMesh};
use crate::rendering::materials::props::PropsMaterial;
use crate::rendering::materials::triplanar::TriplanarMaterial;
use crate::rendering::materials::{
    configure_building_textures, configure_props_textures, configure_triplanar_textures,
    setup_building_material, setup_props_material, setup_triplanar_material, setup_water_material,
    sync_fog_to_materials, sync_hex_tiling_to_materials, sync_voxel_water_material_overrides,
    sync_weather_to_materials,
};
use crate::rendering::procedural_textures::ProceduralTexturePlugin;
use crate::rendering::shadows::pcss::PcssPlugin;
use crate::rendering::shadows::shadow_budget::ShadowBudgetPlugin;
use crate::rendering::terrain_hex_tiling::TerrainTexturingConfig;
use crate::rendering::water::EnhancedWaterPlugin;
use crate::rendering::water::displacement::WaterDisplacementPlugin;
use crate::rendering::water::finish::WitchcraftWaterFinishPlugin;
use crate::rendering::water::reflection::WaterReflectionPlugin;
use crate::rendering::water::reflection_compositor::WaterReflectionCompositorPlugin;

pub struct RenderingPlugin;

impl Plugin for RenderingPlugin {
    fn build(&self, app: &mut App) {
        if render_timing_enabled(app) {
            install_render_timing(app);
        }

        app.init_resource::<GraphicsCapabilities>()
            .insert_resource(RayTracingSettings::from_env_or_default())
            .init_resource::<VoxelRayBackendNotice>()
            .insert_resource(TerrainTexturingConfig::load_or_default())
            .init_resource::<RenderQualityPreset>()
            .add_systems(
                Update,
                (
                    toggle_voxel_ray_backend_key,
                    update_voxel_ray_backend_notice.after(toggle_voxel_ray_backend_key),
                    sync_render_quality_preset,
                    apply_render_quality_preset.after(sync_render_quality_preset),
                    record_render_quality_counters.after(sync_render_quality_preset),
                ),
            )
            // PCSS config is loaded for compatibility; custom PCSS shadow sampling is not active.
            .add_plugins(PcssPlugin)
            // Legacy SSAO kept for compatibility (disabled by default in gtao.yaml)
            .add_plugins(SsaoPlugin)
            .add_plugins(CinematicPlugin)
            .add_plugins(PhotoModePlugin)
            // Enhanced water shader modules (Gerstner, foam, caustics)
            .add_plugins(EnhancedWaterPlugin)
            // Planar water reflections (Valheim-style mirrored camera)
            .add_plugins(WaterReflectionPlugin)
            // Post-process compositor: blends the reflection texture onto water pixels
            .add_plugins(WaterReflectionCompositorPlugin)
            // GTAO post-process runs after the main pass and before water/god-ray compositing.
            .add_plugins(GtaoPlugin)
            // Diagnostic-only water visual probe and overlay counters.
            .add_plugins(WaterVisualProbePlugin)
            // Optional shaderpack-style final color/alpha finish for water.
            .add_plugins(WitchcraftWaterFinishPlugin)
            // Interactive water displacement (CPU wave physics + GPU texture)
            .add_plugins(WaterDisplacementPlugin)
            // Screen-space god rays (radial blur toward sun, independent of volumetric fog)
            .add_plugins(GodRayPlugin)
            // Shader-generated precipitation overlay; inactive clear weather exits before a pass.
            .add_plugins(WeatherOverlayPlugin)
            // Shadow budget: terrain shadow culling + point light shadow limits
            .add_plugins(ShadowBudgetPlugin)
            // Path A lighting backend: inactive unless NAADF is selected and query routing is enabled.
            .add_plugins(RadianceCascadesPlugin)
            // Deterministic generated terrain textures for existing triplanar material slots.
            .add_plugins(ProceduralTexturePlugin)
            .add_plugins(naadf_plugin())
            // ScreenSpaceReflectionsPlugin is already included by DefaultPlugins via PbrPlugin.
            // Register TriplanarMaterial as a custom material type
            .add_plugins(MaterialPlugin::<TriplanarMaterial>::default())
            // Register BlockyMaterial
            .add_plugins(MaterialPlugin::<BlockyMaterial>::default())
            // Register BuildingMaterial (Full PBR for RTX 40xx)
            .add_plugins(MaterialPlugin::<BuildingMaterial>::default())
            .add_plugins(ExtractComponentPlugin::<BuildingMesh>::default())
            // Register PropsMaterial (Medium PBR)
            .add_plugins(MaterialPlugin::<PropsMaterial>::default())
            // Register BillboardMaterial for tree LOD.
            // Keep prepass disabled for this custom alpha-cutout shader path to avoid pipeline mismatch panics.
            .add_plugins(MaterialPlugin::<BillboardMaterial>::default())
            // Register SimpleLodMaterial for distant props (no PBR)
            .add_plugins(MaterialPlugin::<SimpleLodMaterial>::default())
            .add_systems(Startup, setup_voxel_ray_backend_notice)
            .add_systems(PostUpdate, disable_msaa_for_screen_space_ao)
            .add_systems(
                Startup,
                (
                    load_texture_atlas,
                    start_loading_texture_arrays,
                    setup_water_material,
                    setup_triplanar_material,
                    setup_building_material,
                    setup_props_material,
                )
                    .chain(),
            )
            .add_systems(
                Update,
                (
                    configure_triplanar_textures,
                    configure_building_textures,
                    configure_props_textures,
                    create_texture_array,
                    sync_fog_to_materials,
                    sync_weather_to_materials,
                    sync_hex_tiling_to_materials,
                    sync_voxel_water_material_overrides.after(bevy_water::update_materials),
                ),
            );

        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app
                .init_resource::<GraphicsCapabilities>()
                .add_systems(
                    Render,
                    (
                        detect_graphics_capabilities.in_set(GraphicsDetectionSet),
                        sync_capabilities_to_main
                            .after(GraphicsDetectionSet)
                            .in_set(RenderSystems::Cleanup),
                    ),
                );
        } else {
            warn!("Render sub-app not available; graphics capability detection disabled");
        }
    }
}

#[cfg(feature = "naadf")]
fn naadf_plugin() -> crate::rendering::naadf::NaadfPlugin {
    crate::rendering::naadf::NaadfPlugin
}

#[cfg(not(feature = "naadf"))]
fn naadf_plugin() {}

fn render_timing_enabled(app: &App) -> bool {
    app.world().contains_resource::<crate::bench::BenchConfig>()
        || std::env::var_os("VOXEL_RENDER_TIMING").is_some()
}

#[cfg(test)]
mod tests {
    #[test]
    fn rendering_plugin_installs_radiance_cascades_path_a_pass() {
        let source = include_str!("plugin.rs");

        assert!(
            source.contains(
                "use crate::rendering::lighting::radiance_cascades::RadianceCascadesPlugin"
            )
        );
        assert!(source.contains(".add_plugins(RadianceCascadesPlugin)"));
    }
}
