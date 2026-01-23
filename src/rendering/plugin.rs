use bevy::prelude::*;

use crate::rendering::array_loader::{create_texture_array, start_loading_texture_arrays};
use crate::rendering::blocky_material::BlockyMaterial;
use crate::rendering::building_material::BuildingMaterial;
use crate::rendering::capabilities::{
    GraphicsCapabilities, GraphicsDetectionSet, detect_graphics_capabilities,
};
use crate::rendering::cinematic::CinematicPlugin;
use crate::rendering::gtao::GtaoPlugin;
use crate::rendering::gtao_noise::GtaoNoisePlugin;
use crate::rendering::pcss::PcssPlugin;
use crate::rendering::materials::{
    configure_building_textures, configure_props_textures, configure_triplanar_textures,
    setup_triplanar_material, setup_water_material, setup_building_material, setup_props_material,
    sync_fog_to_materials, sync_voxel_water_material_overrides,
};
use crate::rendering::photo_mode::PhotoModePlugin;
use crate::rendering::props_material::PropsMaterial;
use crate::props::billboard::BillboardMaterial;
use crate::props::lod_material::SimpleLodMaterial;
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::rendering::ssao::SsaoPlugin;
use crate::rendering::triplanar_material::TriplanarMaterial;

pub struct RenderingPlugin;

impl Plugin for RenderingPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<GraphicsCapabilities>()
            .init_resource::<RayTracingSettings>()
            .add_systems(
                Update,
                detect_graphics_capabilities
                    .in_set(GraphicsDetectionSet)
                    .run_if(|capabilities: Res<GraphicsCapabilities>| {
                        capabilities.adapter_name.is_none()
                    }),
            )
            // GTAO replaces SSAO for better quality
            .add_plugins(GtaoPlugin)
            .add_plugins(GtaoNoisePlugin)
            // PCSS for contact-hardening soft shadows
            .add_plugins(PcssPlugin)
            // Legacy SSAO kept for compatibility (disabled by default in gtao.yaml)
            .add_plugins(SsaoPlugin)
            .add_plugins(CinematicPlugin)
            .add_plugins(PhotoModePlugin)
            // ScreenSpaceReflectionsPlugin is already included by DefaultPlugins via PbrPlugin.
            // Register TriplanarMaterial as a custom material type
            .add_plugins(MaterialPlugin::<TriplanarMaterial>::default())
            // Register BlockyMaterial
            .add_plugins(MaterialPlugin::<BlockyMaterial>::default())
            // Register BuildingMaterial (Full PBR for RTX 40xx)
            .add_plugins(MaterialPlugin::<BuildingMaterial>::default())
            // Register PropsMaterial (Medium PBR)
            .add_plugins(MaterialPlugin::<PropsMaterial>::default())
            // Register BillboardMaterial for tree LOD
            .add_plugins(MaterialPlugin::<BillboardMaterial>::default())
            // Register SimpleLodMaterial for distant props (no PBR)
            .add_plugins(MaterialPlugin::<SimpleLodMaterial>::default())
            .add_systems(
                Startup,
                (
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
                    sync_voxel_water_material_overrides.after(bevy_water::update_materials),
                ),
            );
    }
}
