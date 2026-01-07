use crate::camera::config::CameraConfig;
use crate::camera::controller::{
    camera_follow_player, player_camera_system, spawn_camera, update_camera_shadow_filtering,
    update_camera_anti_aliasing, update_camera_exposure_from_atmosphere, update_ray_tracing_on_camera,
};
use crate::rendering::capabilities::GraphicsDetectionSet;
use bevy::prelude::*;

pub struct CameraPlugin;

impl Plugin for CameraPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<CameraConfig>()
            .add_systems(
                Startup,
                spawn_camera.after(GraphicsDetectionSet),
            )
            .add_systems(
                Update,
                (
                    player_camera_system,
                    camera_follow_player,
                    update_ray_tracing_on_camera,
                    update_camera_shadow_filtering,
                    update_camera_anti_aliasing,
                    update_camera_exposure_from_atmosphere,
                ),
            );
    }
}
