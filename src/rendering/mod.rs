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

pub mod ao_config;
pub mod array_loader;
pub mod atlas;
pub mod blocky_material;
pub mod building_material;
pub mod capabilities;
pub mod cinematic;
pub mod cinematic_config;
pub mod cutscene;
pub mod adaptive_gi;
pub mod gtao;
pub mod gtao_noise;
pub mod materials;
pub mod mipmaps;
pub mod pcss;
pub mod photo_mode;
pub mod plugin;
pub mod props_material;
pub mod radiance_cascades;
pub mod ray_tracing;
pub mod ssao;
pub mod triplanar_material;
pub mod volumetric_clouds;
pub mod water;


pub use ao_config::AmbientOcclusionConfig;
pub use building_material::{BuildingMaterial, BuildingMaterialHandle, BuildingMaterialType, BuildingMesh};
pub use cinematic::{CinematicCamera, CinematicEvent, CinematicPlugin};
pub use cinematic_config::CinematicConfig;
pub use adaptive_gi::{AdaptiveGIPlugin, AdaptiveGISettings, AdaptiveGIQuality};
pub use photo_mode::PhotoModePlugin;
pub use props_material::{PropMesh, PropsMaterial, PropsMaterialHandle, PropsMaterialType};
pub use radiance_cascades::{RadianceCascadesPlugin, RadianceCascadesConfig, RadianceCascadesCamera};
pub use ssao::{ssao_camera_components, SsaoPlugin, SsaoSupported};

