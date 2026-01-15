//! Atmospheric rendering effects.
//!
//! This module provides:
//! - [`config`] - Fog and atmospheric configuration
//! - [`fog`] - Volumetric fog and atmospheric scattering

mod config;
mod fog;

pub use config::{FogColorModifiers, FogConfig};
pub use fog::{fog_camera_components, sun_volumetric_components, FogCamera, FogPlugin, FogUniforms};
