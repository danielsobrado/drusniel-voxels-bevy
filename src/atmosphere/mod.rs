//! Atmospheric rendering effects.
//!
//! This module provides:
//! - [`config`] - Fog and atmospheric configuration
//! - [`fog`] - Volumetric fog and atmospheric scattering
//! - [`atmosphere_integration`] - Physical sky rendering with bevy_atmosphere

pub mod atmosphere_integration;
mod config;
mod fog;

pub use config::{FogColorModifiers, FogConfig, FogPreset};
pub use fog::{
    fog_camera_components, sun_volumetric_components, FogCamera, FogPlugin, FogUniforms,
    GlobalFogVolume,
};
pub use atmosphere_integration::{AtmosphereIntegrationPlugin, AtmosphereConfig};
