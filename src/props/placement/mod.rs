//! Prop placement - physics-based precision placement for props.
//!
//! This module provides algorithms for accurately placing props on terrain
//! using multi-point sampling, surface normal calculation, and slope alignment.

pub mod terrain_analysis;

use bevy::prelude::*;

pub use terrain_analysis::*;

/// Result of a placement calculation
#[derive(Clone, Debug)]
pub struct PlacementResult {
    /// Final world position for the prop
    pub position: Vec3,
    /// Surface normal at the placement point
    pub surface_normal: Vec3,
    /// Calculated rotation based on terrain and randomization
    pub rotation: Quat,
    /// Slope angle in degrees
    pub slope_angle: f32,
    /// Whether the placement is valid
    pub valid: bool,
}

impl PlacementResult {
    /// Create an invalid placement result
    pub fn invalid() -> Self {
        Self {
            position: Vec3::ZERO,
            surface_normal: Vec3::Y,
            rotation: Quat::IDENTITY,
            slope_angle: 0.0,
            valid: false,
        }
    }
}

/// Configuration for prop placement behavior
#[derive(Clone, Debug)]
pub struct PlacementConfig {
    /// Number of sample points for multi-sample placement (4 corners + center = 5)
    pub sample_points: u32,
    /// Scale factor for the sampling footprint relative to prop bounds
    pub footprint_scale: f32,
    /// Strength of slope alignment (0.0 = upright, 1.0 = fully aligned)
    pub slope_align_strength: f32,
    /// Maximum random tilt in degrees
    pub max_random_tilt: f32,
    /// Maximum height difference between samples before rejection
    pub max_height_variance: f32,
}

impl Default for PlacementConfig {
    fn default() -> Self {
        Self {
            sample_points: 5,
            footprint_scale: 0.8,
            slope_align_strength: 0.8,
            max_random_tilt: 5.0,
            max_height_variance: 2.0,
        }
    }
}

/// Calculate rotation for a prop based on surface normal and random seed
pub fn calculate_prop_rotation(
    surface_normal: Vec3,
    slope_align_strength: f32,
    random_yaw: f32,
    random_tilt_x: f32,
    random_tilt_z: f32,
) -> Quat {
    // Start with random yaw rotation
    let yaw_rotation = Quat::from_rotation_y(random_yaw);

    if slope_align_strength <= 0.0 {
        // No slope alignment, just apply yaw and small tilt
        return yaw_rotation
            * Quat::from_rotation_x(random_tilt_x)
            * Quat::from_rotation_z(random_tilt_z);
    }

    // Blend between upright and fully aligned to surface
    let blended_up = Vec3::Y.lerp(surface_normal, slope_align_strength).normalize();

    // Calculate rotation that aligns the object's up vector to the blended normal
    let forward = Vec3::new(random_yaw.cos(), 0.0, random_yaw.sin());

    // Use look_to to create proper orientation
    let aligned_rotation = if blended_up.dot(forward).abs() > 0.99 {
        // Fallback when up and forward are nearly parallel
        yaw_rotation
    } else {
        // Calculate proper orientation
        let right = forward.cross(blended_up).normalize();
        let corrected_forward = blended_up.cross(right).normalize();
        Quat::from_mat3(&Mat3::from_cols(right, blended_up, corrected_forward))
    };

    // Apply small random tilt for natural variation
    aligned_rotation
        * Quat::from_rotation_x(random_tilt_x)
        * Quat::from_rotation_z(random_tilt_z)
}

/// Convert a rotation quaternion to Euler angles in degrees
pub fn quat_to_euler_degrees(rotation: Quat) -> Vec3 {
    let (x, y, z) = rotation.to_euler(EulerRot::XYZ);
    Vec3::new(x.to_degrees(), y.to_degrees(), z.to_degrees())
}

/// Simple deterministic random number generator based on seed
pub fn seeded_random(seed: u64, offset: u64) -> f32 {
    let n = seed.wrapping_mul(374761393)
        .wrapping_add(offset.wrapping_mul(668265263));
    let n = (n ^ (n >> 13)).wrapping_mul(1274126177);
    let n = n ^ (n >> 16);
    (n as f32) / (u64::MAX as f32)
}
