//! Atmospheric rendering effects.
//!
//! This module provides:
//! - [`config`] - Fog and atmospheric configuration
//! - [`fog`] - Volumetric fog and atmospheric scattering
//! - [`atmosphere_integration`] - Physical sky rendering with bevy_atmosphere

pub mod atmosphere_integration;
mod config;
mod fog;

pub use atmosphere_integration::{AtmosphereConfig, AtmosphereIntegrationPlugin};
pub use config::{
    FogColorModifiers, FogConfig, FogFalloffMode, FogPreset, FogQuality, FogQualityTier,
    ScreenGodRaysConfig,
};
pub use fog::{
    FogCamera, FogPlugin, FogUniforms, GlobalFogVolume, VolumetricFogRuntimeState,
    fog_camera_components, sun_volumetric_components,
};
