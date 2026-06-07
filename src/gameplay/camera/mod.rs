//! Camera system for first-person perspective.
//!
//! This module provides:
//! - [`config`] - Camera configuration (FOV, sensitivity, etc.)
//! - [`controller`] - Camera movement and look-around systems
//! - [`plugin`] - Bevy plugin integration

pub mod config;
pub mod controller;
pub mod plugin;

pub use config::CameraConfig;
