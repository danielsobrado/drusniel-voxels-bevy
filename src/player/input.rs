use bevy::prelude::*;
use bevy_tnua::prelude::*;

use super::{Player, PlayerConfig};
use crate::camera::controller::PlayerCamera;
use crate::input::manager::ActionState;
use crate::input::config::GameAction;

/// Player input state.
#[derive(Resource, Default)]
pub struct PlayerInput {
    pub movement: Vec2,
    pub jump: bool,
    pub sprint: bool,
}

/// Read keyboard input.
pub fn read_player_input(
    action_state: Res<ActionState>,
    mut input: ResMut<PlayerInput>,
) {
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

    input.jump = action_state.just_pressed(GameAction::Jump);
    input.sprint = action_state.pressed(GameAction::Sprint);
}

/// Apply input to Tnua controller.
pub fn apply_player_movement(
    input: Res<PlayerInput>,
    camera_query: Query<&Transform, (With<PlayerCamera>, Without<Player>)>,
    mut player_query: Query<(&mut TnuaController, &PlayerConfig), With<Player>>,
) {
    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let Ok((mut controller, config)) = player_query.single_mut() else {
        return;
    };

    let forward = camera_transform.forward().as_vec3();
    let forward = Vec3::new(forward.x, 0.0, forward.z).normalize_or_zero();
    let right = Vec3::new(-forward.z, 0.0, forward.x);

    let direction = forward * input.movement.y + right * input.movement.x;

    let speed = if input.sprint {
        config.run_speed
    } else {
        config.walk_speed
    };

    controller.basis(TnuaBuiltinWalk {
        desired_velocity: direction * speed,
        float_height: config.float_height,
        cling_distance: 1.0,
        max_slope: std::f32::consts::FRAC_PI_3,
        ..default()
    });

    if input.jump {
        controller.action(TnuaBuiltinJump {
            height: config.jump_height,
            ..default()
        });
    }

}
