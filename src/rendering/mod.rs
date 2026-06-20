//! Rendering systems and materials.
//!
//! This module provides custom rendering functionality including:
//! - [`assets`] - Texture atlas, array loading, and mipmap helpers
//! - [`materials`] - Custom terrain, voxel, building, prop, and water materials
//! - [`effects`] - Screen-space and post-process effects
//! - [`lighting`] - GI and ray-query backends
//! - [`water`] - Water shading, reflections, displacement, and finish passes
//! - [`shadows`] - Shadow budget and PCSS compatibility config
//! - [`camera_modes`] - Cinematic, cutscene, and photo mode systems
//! - [`device`] - GPU capabilities and render quality settings
//! - [`diagnostics`] - Render timing and visual probes

pub mod assets;
pub mod camera_modes;
pub mod device;
pub mod diagnostics;
pub mod effects;
pub mod lighting;
pub mod materials;
pub mod procedural_support_maps;
pub mod shadows;
pub mod water;

pub mod ao_config;
pub mod plugin;
pub mod terrain_hex_tiling;

#[cfg(feature = "naadf")]
pub mod naadf;

pub use ao_config::AmbientOcclusionConfig;
pub use camera_modes::cinematic::{CinematicCamera, CinematicEvent, CinematicPlugin};
pub use camera_modes::cinematic_config::CinematicConfig;
pub use camera_modes::photo_mode::PhotoModePlugin;
pub use device::quality::RenderQualityPreset;
pub use effects::ssao::{SsaoPlugin, SsaoSupported, ssao_camera_components};
pub use lighting::adaptive_gi::{AdaptiveGIPlugin, AdaptiveGIQuality, AdaptiveGISettings};
pub use lighting::radiance_cascades::{
    RadianceCascadesCamera, RadianceCascadesConfig, RadianceCascadesPlugin,
};
pub use materials::building::{
    BuildingMaterial, BuildingMaterialHandle, BuildingMaterialType, BuildingMesh,
};
pub use materials::props::{PropMesh, PropsMaterial, PropsMaterialHandle, PropsMaterialType};
pub use procedural_support_maps::ProceduralSupportMapPlugin;
pub use terrain_hex_tiling::TerrainTexturingConfig;

pub mod adaptive_gi {
    pub use super::lighting::adaptive_gi::*;
}

pub mod ao_msaa {
    pub use super::effects::ao_msaa::*;
}

pub mod array_loader {
    pub use super::assets::array_loader::*;
}

pub mod atlas {
    pub use super::assets::atlas::*;
}

pub mod blocky_material {
    pub use super::materials::blocky::*;
}

pub mod building_material {
    pub use super::materials::building::*;
}

pub mod capabilities {
    pub use super::device::capabilities::*;
}

pub mod cinematic {
    pub use super::camera_modes::cinematic::*;
}

pub mod cinematic_config {
    pub use super::camera_modes::cinematic_config::*;
}

pub mod cutscene {
    pub use super::camera_modes::cutscene::*;
}

pub mod god_rays {
    pub use super::effects::god_rays::*;
}

pub mod gtao {
    pub use super::effects::gtao::*;
}

pub mod mipmaps {
    pub use super::assets::mipmaps::*;
}

pub mod pcss {
    pub use super::shadows::pcss::*;
}

pub mod photo_mode {
    pub use super::camera_modes::photo_mode::*;
}

pub mod props_material {
    pub use super::materials::props::*;
}

pub mod quality {
    pub use super::device::quality::*;
}

pub mod radiance_cascades {
    pub use super::lighting::radiance_cascades::*;
}

pub mod ray_tracing {
    pub use super::lighting::ray_tracing::*;
}

pub mod render_timing {
    pub use super::diagnostics::render_timing::*;
}

pub mod shadow_budget {
    pub use super::shadows::shadow_budget::*;
}

pub mod ssao {
    pub use super::effects::ssao::*;
}

pub mod triplanar_material {
    pub use super::materials::triplanar::*;
}

pub mod voxel_ray_backend {
    pub use super::lighting::voxel_ray_backend::*;
}

pub mod water_displacement {
    pub use super::water::displacement::*;
}

pub mod water_reflection {
    pub use super::water::reflection::*;
}

pub mod water_reflection_compositor {
    pub use super::water::reflection_compositor::*;
}

pub mod water_visual_probe {
    pub use super::diagnostics::water_visual_probe::*;
}

pub mod weather_overlay {
    pub use super::diagnostics::weather_overlay::*;
}

pub mod witchcraft_water_finish {
    pub use super::water::finish::*;
}
