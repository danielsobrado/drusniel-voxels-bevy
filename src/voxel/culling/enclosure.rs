//! Enclosure-gated occlusion culling.

use crate::camera::controller::PlayerCamera;
use crate::voxel::chunk::ChunkUniformity;
use crate::voxel::meshing::invalidation::CHUNK_FACE_NEIGHBOR_OFFSETS;
use crate::voxel::occlusion::OcclusionConfig;
use crate::voxel::skirt::ChunkFace;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;

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
    if state.update_accum < config.update_interval {
        return;
    }
    // Real elapsed time covered by this evaluation, so hysteresis tracks wall
    // time rather than counting fixed-size ticks.
    let tick_secs = state.update_accum;
    state.update_accum = 0.0;

    let Ok(camera) = camera_query.single() else {
        return;
    };
    let camera_voxel = camera.translation.floor().as_ivec3();
    state.player_chunk = VoxelWorld::world_to_chunk(camera_voxel);

    let detected = if config.gating_allowed() {
        if is_camera_enclosed(&world, state.player_chunk, &config) {
            EnclosureMode::Enclosed
        } else {
            EnclosureMode::Open
        }
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

    state.candidate_secs += tick_secs;
    if state.candidate_secs >= config.enclosure_hysteresis_secs {
        state.mode = detected;
        state.held_secs = 0.0;
        state.candidate_secs = 0.0;
        info!(
            "Enclosure occlusion mode: {}",
            match state.mode {
                EnclosureMode::Open => "open",
                EnclosureMode::Enclosed => "enclosed",
            }
        );
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

pub(crate) fn is_camera_enclosed(
    world: &VoxelWorld,
    camera_chunk: IVec3,
    config: &OcclusionConfig,
) -> bool {
    for offset in CHUNK_FACE_NEIGHBOR_OFFSETS {
        if !world.chunk_exists(camera_chunk + offset) {
            return false;
        }
    }
    let Some(camera) = world.get_chunk(camera_chunk) else {
        return false;
    };
    if camera.face_visibility().is_fully_transparent() {
        return false;
    }

    sky_probe_blocked(world, camera_chunk, config.sky_probe_chunks)
}

fn sky_probe_blocked(world: &VoxelWorld, camera_chunk: IVec3, sky_probe_chunks: u32) -> bool {
    for dy in 1..=sky_probe_chunks as i32 {
        let probe_chunk = camera_chunk + IVec3::new(0, dy, 0);
        if !world.chunk_in_bounds(probe_chunk) {
            return false;
        }
        let Some(chunk) = world.get_chunk(probe_chunk) else {
            return false;
        };
        match chunk.uniformity() {
            ChunkUniformity::Solid => {}
            ChunkUniformity::Mixed | ChunkUniformity::Unknown => {
                if chunk
                    .face_visibility()
                    .can_see_through(ChunkFace::NegY, ChunkFace::PosY)
                {
                    return false;
                }
            }
            ChunkUniformity::Empty => return false,
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::CHUNK_VOLUME;
    use crate::voxel::chunk::{Chunk, FaceVisibility};
    use crate::voxel::types::VoxelType;

    fn insert_camera_and_neighbors(world: &mut VoxelWorld, camera_chunk: IVec3) {
        let mut camera = Chunk::new(camera_chunk);
        camera.set_face_visibility(FaceVisibility::none_connected());
        world.insert_chunk(camera);
        for offset in CHUNK_FACE_NEIGHBOR_OFFSETS {
            world.insert_chunk(Chunk::new(camera_chunk + offset));
        }
    }

    #[test]
    fn enclosure_rejects_fully_open_camera_chunk() {
        let mut world = VoxelWorld::new(IVec3::new(4, 4, 4));
        let camera = IVec3::new(1, 1, 1);
        world.insert_chunk(Chunk::new(camera));
        for offset in CHUNK_FACE_NEIGHBOR_OFFSETS {
            world.insert_chunk(Chunk::new(camera + offset));
        }

        assert!(!is_camera_enclosed(
            &world,
            camera,
            &OcclusionConfig::default()
        ));
    }

    #[test]
    fn enclosure_accepts_fully_buried_camera() {
        let mut world = VoxelWorld::new(IVec3::new(4, 5, 4));
        let camera = IVec3::new(1, 1, 1);
        insert_camera_and_neighbors(&mut world, camera);
        for dy in 1..=2 {
            world.insert_chunk(Chunk::with_voxels(
                camera + IVec3::new(0, dy, 0),
                [VoxelType::Rock; CHUNK_VOLUME],
            ));
        }
        let config = OcclusionConfig {
            sky_probe_chunks: 2,
            ..default()
        };

        assert!(is_camera_enclosed(&world, camera, &config));
    }

    #[test]
    fn enclosure_rejects_cave_entrance_with_sky_path() {
        let mut world = VoxelWorld::new(IVec3::new(4, 5, 4));
        let camera = IVec3::new(1, 1, 1);
        insert_camera_and_neighbors(&mut world, camera);
        world.insert_chunk(Chunk::new(camera + IVec3::Y * 2));
        let config = OcclusionConfig {
            sky_probe_chunks: 2,
            ..default()
        };

        assert!(!is_camera_enclosed(&world, camera, &config));
    }
}
