use crate::camera::config::CameraConfig;
use crate::camera::controller::{
    camera_follow_player, player_camera_system, spawn_camera, update_camera_shadow_filtering,
    update_ray_tracing_on_camera,
};
use crate::rendering::capabilities::GraphicsDetectionSet;
use bevy::prelude::*;
use bevy::window::{CursorGrabMode, CursorOptions};

pub struct CameraPlugin;

impl Plugin for CameraPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<CameraConfig>()
            .add_systems(
                Startup,
                (spawn_camera, lock_cursor_on_start)
                    .chain()
                    .after(GraphicsDetectionSet),
            )
            .add_systems(
                Update,
                (
                    player_camera_system,
                    camera_follow_player,
                    update_ray_tracing_on_camera,
                    update_camera_shadow_filtering,
                ),
            );
    }
}

fn lock_cursor_on_start(mut windows: Query<(&mut Window, &mut CursorOptions)>) {
    if let Ok((_window, mut cursor_options)) = windows.single_mut() {
        cursor_options.visible = false;
        cursor_options.grab_mode = CursorGrabMode::Locked;
    }
}
