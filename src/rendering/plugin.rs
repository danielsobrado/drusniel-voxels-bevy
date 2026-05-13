use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::prelude::*;
use bevy::render::extract_component::ExtractComponentPlugin;
use bevy::shader::Shader;

use crate::props::billboard::BillboardMaterial;
use crate::props::lod_material::SimpleLodMaterial;
use crate::rendering::array_loader::{create_texture_array, start_loading_texture_arrays};
use crate::rendering::atlas::load_texture_atlas;
use crate::rendering::blocky_material::BlockyMaterial;
use crate::rendering::building_material::{BuildingMaterial, BuildingMesh};
use crate::rendering::capabilities::{
    GraphicsCapabilities, GraphicsDetectionSet, detect_graphics_capabilities,
};
use crate::rendering::cinematic::CinematicPlugin;
use crate::rendering::god_rays::GodRayPlugin;
use crate::rendering::gtao::GtaoPlugin;
use crate::rendering::gtao_noise::GtaoNoisePlugin;
use crate::rendering::materials::{
    configure_building_textures, configure_props_textures, configure_triplanar_textures,
    setup_building_material, setup_props_material, setup_triplanar_material, setup_water_material,
    sync_fog_to_materials, sync_voxel_water_material_overrides, sync_weather_to_materials,
};
use crate::rendering::pcss::PcssPlugin;
use crate::rendering::photo_mode::PhotoModePlugin;
use crate::rendering::props_material::PropsMaterial;
use crate::rendering::quality::{
    RenderQualityPreset, apply_render_quality_preset, record_render_quality_counters,
    sync_render_quality_preset,
};
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::rendering::render_timing::install_render_timing;
use crate::rendering::shadow_budget::ShadowBudgetPlugin;
use crate::rendering::ssao::SsaoPlugin;
use crate::rendering::triplanar_material::TriplanarMaterial;
use crate::rendering::water::EnhancedWaterPlugin;
use crate::rendering::water_displacement::WaterDisplacementPlugin;
use crate::rendering::water_reflection::WaterReflectionPlugin;
use crate::rendering::water_reflection_compositor::WaterReflectionCompositorPlugin;
use crate::rendering::water_visual_probe::WaterVisualProbePlugin;
use crate::rendering::weather_overlay::WeatherOverlayPlugin;
use crate::rendering::witchcraft_water_finish::WitchcraftWaterFinishPlugin;

const WEATHER_PARTICLE_CLASSIFY_HANDLE: Handle<Shader> =
    uuid_handle!("ab4a4d6a-2a5d-4bc8-87a8-c267789f72cb");

pub struct RenderingPlugin;

impl Plugin for RenderingPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            WEATHER_PARTICLE_CLASSIFY_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/weather_particle_classify.wgsl"
            ),
            Shader::from_wgsl
        );

        if render_timing_enabled(app) {
            install_render_timing(app);
        }

        app.init_resource::<GraphicsCapabilities>()
            .init_resource::<RayTracingSettings>()
            .init_resource::<RenderQualityPreset>()
            .add_systems(
                Update,
                (
                    detect_graphics_capabilities
                        .in_set(GraphicsDetectionSet)
                        .run_if(|capabilities: Res<GraphicsCapabilities>| {
                            capabilities.adapter_name.is_none()
                        }),
                    sync_render_quality_preset,
                    apply_render_quality_preset.after(sync_render_quality_preset),
                    record_render_quality_counters.after(sync_render_quality_preset),
                ),
            )
            .add_plugins(GtaoNoisePlugin)
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
                    sync_voxel_water_material_overrides.after(bevy_water::update_materials),
                ),
            );
    }
}

fn render_timing_enabled(app: &App) -> bool {
    app.world().contains_resource::<crate::bench::BenchConfig>()
        || std::env::var_os("VOXEL_RENDER_TIMING").is_some()
}
