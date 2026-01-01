use crate::atmosphere::{fog_camera_components, FogConfig};
use crate::camera::config::CameraConfig;
use crate::interaction::palette::PlacementPaletteState;
use crate::map::MapState;
use crate::menu::{PauseMenuState, SettingsState, ShadowFiltering};
use crate::player::Player;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::cinematic::CinematicCamera;
use crate::rendering::ray_tracing::RayTracingSettings;
use bevy::anti_alias::contrast_adaptive_sharpening::ContrastAdaptiveSharpening;
use bevy::anti_alias::smaa::{Smaa, SmaaPreset};
use bevy::anti_alias::taa::TemporalAntiAliasing;
use bevy::core_pipeline::tonemapping::{DebandDither, Tonemapping};
use bevy::input::mouse::MouseMotion;
use bevy::light::ShadowFilteringMethod;
use bevy::pbr::ScreenSpaceReflections;
use bevy::post_process::bloom::{Bloom, BloomCompositeMode};
use bevy::prelude::*;
use bevy::render::view::Hdr;
use bevy::window::{CursorGrabMode, CursorOptions};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CameraMode {
    Fly,
    Walk,
}

#[derive(Component)]
pub struct PlayerCamera {
    // Shared settings
    pub sensitivity: f32,
    pub pitch: f32,
    pub yaw: f32,
    pub mode: CameraMode,

    // Fly mode settings
    pub fly_speed: f32,
}

impl PlayerCamera {
    pub fn from_config(config: &CameraConfig) -> Self {
        Self {
            sensitivity: config.movement.sensitivity,
            pitch: 0.0,
            yaw: 0.0,
            mode: CameraMode::Walk,
            fly_speed: config.movement.fly_speed,
        }
    }
}

impl Default for PlayerCamera {
    fn default() -> Self {
        let config = CameraConfig::default();
        Self::from_config(&config)
    }
}

pub fn spawn_camera(
    mut commands: Commands,
    capabilities: Res<GraphicsCapabilities>,
    ray_tracing: Res<RayTracingSettings>,
    fog_config: Res<FogConfig>,
    camera_config: Res<CameraConfig>,
) {
    let mut camera = commands.spawn((
        Camera3d::default(),
        Camera::default(),
        Msaa::Off,
        Transform::from_xyz(
            camera_config.spawn.position.x,
            camera_config.spawn.position.y,
            camera_config.spawn.position.z,
        )
        .looking_at(camera_config.spawn.look_at, Vec3::Y),
        PlayerCamera::from_config(&camera_config),
        match SettingsState::default().shadow_filtering {
            ShadowFiltering::Gaussian => ShadowFilteringMethod::Gaussian,
            ShadowFiltering::Hardware2x2 => ShadowFilteringMethod::Hardware2x2,
            ShadowFiltering::Temporal => ShadowFilteringMethod::Temporal,
        },
        fog_camera_components(&fog_config),
        CinematicCamera,
    ));

    if capabilities.integrated_gpu {
        camera.insert(Tonemapping::None);
    } else {
        camera.insert((
            Hdr,
            Bloom {
                intensity: camera_config.rendering.bloom_intensity,
                composite_mode: BloomCompositeMode::EnergyConserving,
                ..default()
            },
            Tonemapping::TonyMcMapface,
            DebandDither::Enabled,
        ));
    }

    if capabilities.integrated_gpu {
        camera.insert(Smaa { preset: SmaaPreset::Low });
    } else if capabilities.taa_supported {
        camera.insert((
            TemporalAntiAliasing::default(),
            ContrastAdaptiveSharpening {
                enabled: true,
                sharpening_strength: camera_config.rendering.sharpening_strength,
                denoise: false,
            },
        ));
    } else {
        camera.insert(Smaa { preset: SmaaPreset::High });
    }

    if ray_tracing.enabled && capabilities.ray_tracing_supported {
        camera.insert(ScreenSpaceReflections::default());
    }
}

pub fn update_camera_shadow_filtering(
    settings_state: Res<SettingsState>,
    mut camera_query: Query<&mut ShadowFilteringMethod, With<PlayerCamera>>,
) {
    if !settings_state.is_changed() {
        return;
    }

    for mut method in camera_query.iter_mut() {
        *method = match settings_state.shadow_filtering {
            ShadowFiltering::Gaussian => ShadowFilteringMethod::Gaussian,
            ShadowFiltering::Hardware2x2 => ShadowFilteringMethod::Hardware2x2,
            ShadowFiltering::Temporal => ShadowFilteringMethod::Temporal,
        };
    }
}

pub fn update_ray_tracing_on_camera(
    capabilities: Res<GraphicsCapabilities>,
    settings: Res<RayTracingSettings>,
    mut commands: Commands,
    mut cameras: Query<(Entity, Option<&ScreenSpaceReflections>), With<PlayerCamera>>,
) {
    if !(settings.is_changed() || capabilities.is_changed()) {
        return;
    }

    let should_enable = settings.enabled && capabilities.ray_tracing_supported;

    for (entity, current) in cameras.iter_mut() {
        match (should_enable, current.is_some()) {
            (true, false) => {
                commands
                    .entity(entity)
                    .insert(ScreenSpaceReflections::default());
            }
            (false, true) => {
                commands.entity(entity).remove::<ScreenSpaceReflections>();
            }
            _ => {}
        }
    }
}

pub fn player_camera_system(
    mut query: Query<(&mut Transform, &mut PlayerCamera)>,
    keys: Res<ButtonInput<KeyCode>>,
    mut mouse_motion: MessageReader<MouseMotion>,
    time: Res<Time>,
    mut windows: Query<(&mut Window, &mut CursorOptions)>,
    pause_menu: Res<PauseMenuState>,
    palette: Res<PlacementPaletteState>,
    map_state: Res<MapState>,
    camera_config: Res<CameraConfig>,
) {
    let Ok((_window, mut cursor_options)) = windows.single_mut() else {
        return;
    };
    let dt = time.delta_secs();

    if pause_menu.open || palette.open || map_state.open {
        cursor_options.visible = true;
        cursor_options.grab_mode = CursorGrabMode::None;
        return;
    }

    cursor_options.visible = false;
    cursor_options.grab_mode = CursorGrabMode::Locked;

    for (mut transform, mut camera) in query.iter_mut() {
        // Toggle between fly and walk mode with Tab
        if keys.just_pressed(KeyCode::Tab) {
            camera.mode = match camera.mode {
                CameraMode::Fly => CameraMode::Walk,
                CameraMode::Walk => CameraMode::Fly,
            };
            match camera.mode {
                CameraMode::Fly => info!("Switched to FLY mode"),
                CameraMode::Walk => info!("Switched to WALK mode"),
            }
        }

        // Reset position with R
        if keys.just_pressed(KeyCode::KeyR) {
            camera.yaw = camera_config.movement.reset_yaw;
            camera.pitch = camera_config.movement.reset_pitch;
            *transform = Transform::from_xyz(
                camera_config.spawn.position.x,
                camera_config.spawn.position.y,
                camera_config.spawn.position.z,
            )
            .looking_at(camera_config.spawn.look_at, Vec3::Y);
        }

        if cursor_options.visible {
            return;
        }

        // Mouse look (both modes)
        for ev in mouse_motion.read() {
            camera.yaw -= ev.delta.x * camera.sensitivity;
            camera.pitch -= ev.delta.y * camera.sensitivity;
            camera.pitch = camera
                .pitch
                .clamp(camera_config.movement.pitch_min, camera_config.movement.pitch_max);
        }

        transform.rotation = Quat::from_euler(EulerRot::YXZ, camera.yaw, camera.pitch, 0.0);

        // Movement based on mode
        match camera.mode {
            CameraMode::Fly => {
                fly_movement(&mut transform, &camera, &keys, dt, &camera_config);
            }
            CameraMode::Walk => {
                // Walk mode is handled by the player controller.
            }
        }
    }
}

fn fly_movement(
    transform: &mut Transform,
    camera: &PlayerCamera,
    keys: &Res<ButtonInput<KeyCode>>,
    dt: f32,
    config: &CameraConfig,
) {
    let mut velocity = Vec3::ZERO;
    let local_z = transform.local_z();
    let forward = -Vec3::new(local_z.x, 0.0, local_z.z).normalize_or_zero();
    let right = Vec3::new(local_z.z, 0.0, -local_z.x).normalize_or_zero();

    if keys.pressed(KeyCode::KeyW) {
        velocity += forward;
    }
    if keys.pressed(KeyCode::KeyS) {
        velocity -= forward;
    }
    if keys.pressed(KeyCode::KeyA) {
        velocity -= right;
    }
    if keys.pressed(KeyCode::KeyD) {
        velocity += right;
    }
    if keys.pressed(KeyCode::Space) {
        velocity += Vec3::Y;
    }
    if keys.pressed(KeyCode::ShiftLeft) {
        velocity -= Vec3::Y;
    }

    let speed = if keys.pressed(KeyCode::ControlLeft) {
        camera.fly_speed * config.movement.fly_turbo_multiplier
    } else {
        camera.fly_speed
    };

    transform.translation += velocity.normalize_or_zero() * speed * dt;
}

pub fn camera_follow_player(
    player_query: Query<&Transform, With<Player>>,
    mut camera_query: Query<(&mut Transform, &PlayerCamera), (With<PlayerCamera>, Without<Player>)>,
    camera_config: Res<CameraConfig>,
) {
    let Ok(player_transform) = player_query.single() else {
        return;
    };
    let Ok((mut camera_transform, camera)) = camera_query.single_mut() else {
        return;
    };

    if camera.mode == CameraMode::Walk {
        camera_transform.translation =
            player_transform.translation + Vec3::Y * camera_config.movement.eye_height;
    }
}
