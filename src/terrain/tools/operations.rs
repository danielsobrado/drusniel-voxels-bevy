use bevy::prelude::*;
use crate::terrain::constants::BEDROCK_DEPTH;

/// Raise terrain within radius
pub fn raise_terrain(
    current_sdf: f32,
    world_pos: Vec3,
    center: Vec3,
    radius: f32,
    strength: f32,
) -> f32 {
    if !can_modify_at(world_pos) {
        return current_sdf;
    }

    let dist = world_pos.xz().distance(center.xz());
    if dist > radius {
        return current_sdf;
    }

    let falloff = 1.0 - (dist / radius).powi(2);
    let raise_amount = strength * falloff;

    current_sdf - raise_amount
}

/// Lower terrain within radius (respects bedrock)
pub fn lower_terrain(
    current_sdf: f32,
    world_pos: Vec3,
    center: Vec3,
    radius: f32,
    strength: f32,
) -> f32 {
    if !can_modify_at(world_pos) {
        return current_sdf;
    }

    let dist = world_pos.xz().distance(center.xz());
    if dist > radius {
        return current_sdf;
    }

    let falloff = 1.0 - (dist / radius).powi(2);
    let lower_amount = strength * falloff;

    current_sdf + lower_amount
}

/// Level terrain to target height
pub fn level_terrain(
    current_sdf: f32,
    world_pos: Vec3,
    center: Vec3,
    radius: f32,
    target_height: f32,
    strength: f32,
) -> f32 {
    if !can_modify_at(world_pos) {
        return current_sdf;
    }

    let dist = world_pos.xz().distance(center.xz());
    if dist > radius {
        return current_sdf;
    }

    let falloff = 1.0 - (dist / radius).powi(2);
    let plane_sdf = world_pos.y - target_height;

    // Blend toward flat plane
    let blend = (strength * falloff).clamp(0.0, 1.0);
    lerp(current_sdf, plane_sdf, blend)
}

/// Smooth terrain by averaging nearby values
pub fn smooth_terrain(
    samples: &[f32],
    current_sdf: f32,
    world_pos: Vec3,
    center: Vec3,
    radius: f32,
    strength: f32,
) -> f32 {
    if !can_modify_at(world_pos) {
        return current_sdf;
    }

    let dist = world_pos.xz().distance(center.xz());
    if dist > radius {
        return current_sdf;
    }

    let avg: f32 = samples.iter().sum::<f32>() / samples.len() as f32;
    let falloff = 1.0 - (dist / radius).powi(2);
    let blend = (strength * falloff * 0.5).clamp(0.0, 1.0);

    lerp(current_sdf, avg, blend)
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[inline]
fn can_modify_at(world_pos: Vec3) -> bool {
    world_pos.y > BEDROCK_DEPTH as f32
}
