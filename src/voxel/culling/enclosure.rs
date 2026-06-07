//! Enclosure-gated occlusion culling. Set `OcclusionConfig::enclosure_gating_enabled`
//! false to fall back to today's behaviour: occlusion always disabled.

use crate::camera::controller::PlayerCamera;
use crate::voxel::occlusion::OcclusionConfig;
use crate::voxel::types::Voxel;
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::prelude::*;

const RAY_LEN: i32 = 24;
const UPDATE_INTERVAL: f32 = 0.1;
const HYSTERESIS_SECS: f32 = 1.0;

#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct EnclosureState {
    pub player_chunk: IVec3,
    pub mode: EnclosureMode,
    pub held_secs: f32,
    candidate_mode: EnclosureMode,
    candidate_secs: f32,
    update_accum: f32,
}

#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
pub enum EnclosureMode {
    #[default]
    Open,
    Enclosed,
}

#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct EnclosureOcclusionStats {
    pub hidden_chunks: usize,
    pub total_chunks: usize,
    pub hidden_props: usize,
    pub total_props: usize,
}

pub fn update_enclosure_state(
    time: Res<Time>,
    world: Res<VoxelWorld>,
    config: Res<OcclusionConfig>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut state: ResMut<EnclosureState>,
) {
    state.update_accum += time.delta_secs();
    state.held_secs += time.delta_secs();
    if state.update_accum < UPDATE_INTERVAL {
        return;
    }
    state.update_accum = 0.0;

    let Ok(camera) = camera_query.single() else {
        return;
    };
    let camera_voxel = camera.translation.floor().as_ivec3();
    state.player_chunk = VoxelWorld::world_to_chunk(camera_voxel);

    let detected = if config.enclosure_gating_enabled && !config.force_disabled {
        detect_mode(&world, camera_voxel)
    } else {
        EnclosureMode::Open
    };

    if detected == state.mode {
        state.candidate_mode = detected;
        state.candidate_secs = 0.0;
        return;
    }

    if detected != state.candidate_mode {
        state.candidate_mode = detected;
        state.candidate_secs = 0.0;
        return;
    }

    state.candidate_secs += UPDATE_INTERVAL;
    if state.candidate_secs >= HYSTERESIS_SECS {
        state.mode = detected;
        state.held_secs = 0.0;
        state.candidate_secs = 0.0;
    }
}

pub fn sync_occlusion_config_from_enclosure(
    state: Res<EnclosureState>,
    mut config: ResMut<OcclusionConfig>,
) {
    let should_enable = config.enclosure_gating_enabled
        && !config.force_disabled
        && state.mode == EnclosureMode::Enclosed;
    if config.enabled != should_enable {
        config.enabled = should_enable;
    }
}

pub fn toggle_enclosure_culling(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut config: ResMut<OcclusionConfig>,
) {
    let shift_held = keyboard.pressed(KeyCode::ShiftLeft) || keyboard.pressed(KeyCode::ShiftRight);
    if shift_held && keyboard.just_pressed(KeyCode::F11) {
        config.force_disabled = !config.force_disabled;
        info!(
            "Enclosure occlusion culling: {} (Shift+F11 to toggle)",
            if config.force_disabled {
                "force-disabled"
            } else {
                "automatic"
            }
        );
    }
}

fn detect_mode(world: &VoxelWorld, origin: IVec3) -> EnclosureMode {
    let chunk = VoxelWorld::world_to_chunk(origin);
    let any_loaded_neighbor = (-1..=1).any(|dx| {
        (-1..=1).any(|dy| (-1..=1).any(|dz| world.chunk_exists(chunk + IVec3::new(dx, dy, dz))))
    });
    if !any_loaded_neighbor {
        return EnclosureMode::Open;
    }

    let dirs = [
        IVec3::X,
        IVec3::NEG_X,
        IVec3::Y,
        IVec3::NEG_Y,
        IVec3::Z,
        IVec3::NEG_Z,
    ];
    let hits = dirs
        .iter()
        .filter(|dir| ray_hits_solid(world, origin, **dir))
        .count();

    // The 5/6 ray heuristic keeps cave interiors enclosed while rejecting open terrain.
    if hits >= 5 {
        EnclosureMode::Enclosed
    } else {
        EnclosureMode::Open
    }
}

fn ray_hits_solid(world: &VoxelWorld, origin: IVec3, dir: IVec3) -> bool {
    for step in 1..=RAY_LEN {
        let pos = origin + dir * step;
        match world.sample_voxel_for_collision(pos) {
            VoxelSample::InBounds(v) if v.is_solid() => return true,
            VoxelSample::OutsideBelowWorld
            | VoxelSample::OutsideHorizontalWorld
            | VoxelSample::MissingChunkInsideBounds => return true,
            VoxelSample::InBounds(_) | VoxelSample::OutsideAboveWorld => {}
        }
    }
    false
}
