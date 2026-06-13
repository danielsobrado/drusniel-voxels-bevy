use avian3d::prelude::LinearVelocity;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy_tnua::prelude::*;

use crate::audio::events::{AudioEventId, GameAudioEvent};

use super::{Player, PlayerConfig, PlayerMovementScheme, PlayerMovementSchemeConfig};
use crate::camera::controller::PlayerCamera;
use crate::input::config::GameAction;
use crate::input::manager::ActionState;
use crate::performance::AreaTimingRecorder;
use crate::physics::{ChunkCollider, NeedsCollider, TerrainCollisionCache};
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::world::VoxelWorld;

use super::{SpawnColliderReadiness, can_player_enter_ground_column};

const MOVEMENT_GROUND_PROBE_DISTANCE: f32 = 1.25;

/// Player input state.
#[derive(Resource, Default)]
pub struct PlayerInput {
    pub movement: Vec2,
    pub jump: bool,
    pub sprint: bool,
}

/// Read keyboard input.
pub fn read_player_input(action_state: Res<ActionState>, mut input: ResMut<PlayerInput>) {
    let mut movement = Vec2::ZERO;
    if action_state.pressed(GameAction::MoveForward) {
        movement.y += 1.0;
    }
    if action_state.pressed(GameAction::MoveBackward) {
        movement.y -= 1.0;
    }
    if action_state.pressed(GameAction::MoveLeft) {
        movement.x -= 1.0;
    }
    if action_state.pressed(GameAction::MoveRight) {
        movement.x += 1.0;
    }
    input.movement = movement.normalize_or_zero();

    input.jump = action_state.pressed(GameAction::Jump);
    input.sprint = action_state.pressed(GameAction::Sprint);
}

/// Apply input to Tnua controller.
pub fn apply_player_movement(
    input: Res<PlayerInput>,
    action_state: Res<ActionState>,
    camera_query: Query<&Transform, (With<PlayerCamera>, Without<Player>)>,
    mut player_query: Query<
        (
            &mut TnuaController<PlayerMovementScheme>,
            &PlayerConfig,
            &TnuaConfig<PlayerMovementScheme>,
            &Transform,
        ),
        With<Player>,
    >,
    mut movement_configs: ResMut<Assets<PlayerMovementSchemeConfig>>,
    world: Res<VoxelWorld>,
    cache: Res<TerrainCollisionCache>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let Ok((mut controller, config, movement_config, player_transform)) = player_query.single_mut()
    else {
        return;
    };

    let forward = camera_transform.forward().as_vec3();
    let forward = Vec3::new(forward.x, 0.0, forward.z).normalize_or_zero();
    let right = Vec3::new(-forward.z, 0.0, forward.x);

    let mut direction = forward * input.movement.y + right * input.movement.x;
    if direction.length_squared() > 0.0 {
        let collider_readiness =
            SpawnColliderReadiness::from_chunk_meshes_with_cache(collider_query.iter(), &cache);
        let probe_position =
            player_transform.translation + direction.normalize() * MOVEMENT_GROUND_PROBE_DISTANCE;
        if !can_player_enter_ground_column(&world, probe_position, &collider_readiness) {
            direction = Vec3::ZERO;
        }
    }

    let speed = if input.sprint {
        config.run_speed
    } else {
        config.walk_speed
    };

    if let Some(config_asset) = movement_configs.get_mut(&movement_config.0) {
        config_asset.basis.float_height = config.float_height;
        config_asset.basis.max_slope = std::f32::consts::FRAC_PI_3;
        config_asset.jump.height = config.jump_height;
    }

    controller.basis = TnuaBuiltinWalk {
        desired_motion: direction * speed,
        desired_forward: Dir3::new(direction).ok(),
    };

    controller.initiate_action_feeding();

    if input.jump {
        controller.action(PlayerMovementScheme::Jump(TnuaBuiltinJump::default()));
    }

    if action_state.just_pressed(GameAction::Jump) && controller.is_airborne().ok() == Some(false) {
        audio_events.write(GameAudioEvent::ui(AudioEventId::PlayerJump));
    }
}

pub fn record_player_movement_diagnostics(
    input: Res<PlayerInput>,
    frame: Res<FrameCount>,
    mut stall_frames: Local<u32>,
    mut last_profile_log_frame: Local<u32>,
    mut timing: ResMut<AreaTimingRecorder>,
    player_query: Query<(&Transform, Option<&LinearVelocity>, &PlayerConfig), With<Player>>,
) {
    let Ok((transform, velocity, config)) = player_query.single() else {
        return;
    };

    let profile_log_enabled = std::env::var_os("VOXEL_MOVEMENT_PROFILE").is_some();
    if profile_log_enabled && !timing.enabled {
        timing.set_enabled(true);
    }

    let requested_speed = if input.sprint {
        config.run_speed
    } else {
        config.walk_speed
    };
    let horizontal_speed = velocity
        .map(|velocity| Vec2::new(velocity.x, velocity.z).length())
        .unwrap_or(0.0);
    let input_active = input.movement.length_squared() > 0.25;
    let stalled = input_active && requested_speed > 0.0 && horizontal_speed < requested_speed * 0.2;

    if stalled {
        *stall_frames += 1;
    } else {
        *stall_frames = 0;
    }

    timing.record_count(
        frame.0,
        "Player Movement Input Active",
        input_active as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Player Movement Horizontal Speed",
        horizontal_speed as f64,
    );
    timing.record_count(
        frame.0,
        "Player Movement Stall Frames",
        *stall_frames as f64,
    );

    let should_log_profile = profile_log_enabled
        && frame.0.saturating_sub(*last_profile_log_frame) >= 300
        && !timing.rolling_summaries().is_empty();
    let should_log_stall = profile_log_enabled
        && *stall_frames >= 12
        && (*stall_frames == 12 || *stall_frames % 60 == 0);

    if should_log_profile || should_log_stall {
        *last_profile_log_frame = frame.0;
        let mut summaries = timing.rolling_summaries();
        summaries.truncate(12);
        let summary_text = summaries
            .iter()
            .map(|summary| {
                format!(
                    "{} avg={:.2} p99={:.2} {}",
                    summary.area, summary.avg_ms, summary.p99_ms, summary.unit
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        let level = if should_log_stall { "stall" } else { "profile" };
        warn!(
            "Player movement {level}: stall_frames={} input_active={} pos=({:.1},{:.1},{:.1}) requested_speed={:.2} horizontal_speed={:.2} timings=[{}]",
            *stall_frames,
            input_active,
            transform.translation.x,
            transform.translation.y,
            transform.translation.z,
            requested_speed,
            horizontal_speed,
            summary_text
        );
    }
}
