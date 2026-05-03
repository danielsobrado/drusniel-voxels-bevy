//! Rendering systems and materials.
//!
//! This module provides custom rendering functionality including:
//! - [`atlas`] - Texture atlas management for voxel textures
//! - [`blocky_material`] - Minecraft-style block rendering
//! - [`triplanar_material`] - Smooth terrain triplanar texturing
//! - [`building_material`] - Materials for placed buildings/structures
//! - [`props_material`] - Materials for decorative props
//! - [`ssao`] - Screen-space ambient occlusion (legacy)
//! - [`gtao`] - Ground Truth Ambient Occlusion (XeGTAO)
//! - [`ao_config`] - Ambient occlusion configuration
//! - [`ray_tracing`] - Ray tracing support (optional)
//! - [`capabilities`] - GPU capability detection
//! - [`cinematic`] - Cinematic camera sequences
//! - [`photo_mode`] - Photo mode for screenshots
//! - [`volumetric_clouds`] - Raymarched volumetric clouds
//! - [`radiance_cascades`] - Radiance Cascades global illumination

pub mod adaptive_gi;
pub mod ao_config;
pub mod array_loader;
pub mod atlas;
pub mod blocky_material;
pub mod building_material;
pub mod capabilities;
pub mod cinematic;
pub mod cinematic_config;
pub mod cutscene;
pub mod god_rays;
pub mod gtao;
pub mod gtao_noise;
pub mod materials;
pub mod mipmaps;
pub mod pcss;
pub mod photo_mode;
pub mod plugin;
pub mod props_material;
pub mod quality;
pub mod radiance_cascades;
pub mod ray_tracing;
pub mod render_timing;
pub mod shadow_budget;
pub mod ssao;
pub mod triplanar_material;
pub mod volumetric_clouds;
pub mod water;
pub mod water_displacement;
pub mod water_reflection;
pub mod water_reflection_compositor;
pub mod water_visual_probe;

pub use adaptive_gi::{AdaptiveGIPlugin, AdaptiveGIQuality, AdaptiveGISettings};
pub use ao_config::AmbientOcclusionConfig;
pub use building_material::{
    BuildingMaterial, BuildingMaterialHandle, BuildingMaterialType, BuildingMesh,
};
pub use cinematic::{CinematicCamera, CinematicEvent, CinematicPlugin};
pub use cinematic_config::CinematicConfig;
pub use photo_mode::PhotoModePlugin;
pub use props_material::{PropMesh, PropsMaterial, PropsMaterialHandle, PropsMaterialType};
pub use quality::RenderQualityPreset;
pub use radiance_cascades::{
    RadianceCascadesCamera, RadianceCascadesConfig, RadianceCascadesPlugin,
};
pub use ssao::{SsaoPlugin, SsaoSupported, ssao_camera_components};
