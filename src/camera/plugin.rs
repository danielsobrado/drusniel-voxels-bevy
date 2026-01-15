use crate::camera::config::{load_camera_exposure_config, CameraConfig, CameraExposureConfig};
use crate::camera::controller::{
    camera_follow_player, player_camera_system, spawn_camera, update_camera_shadow_filtering,
    update_camera_anti_aliasing, update_camera_exposure,
    update_camera_skybox_from_atmosphere, update_ray_tracing_on_camera, apply_visual_settings,
};
use crate::rendering::capabilities::GraphicsDetectionSet;
use bevy::prelude::*;

pub struct CameraPlugin;

impl Plugin for CameraPlugin {
    fn build(&self, app: &mut App) {
        let exposure_config = load_camera_exposure_config().unwrap_or_else(|e| {
            warn!("Failed to load camera exposure config: {}, using defaults", e);
            CameraExposureConfig::default()
        });

        app.insert_resource(exposure_config)
            .init_resource::<CameraConfig>()
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
                    update_camera_exposure,
                    update_camera_skybox_from_atmosphere,
                    apply_visual_settings,
                ),
            );
    }
}
