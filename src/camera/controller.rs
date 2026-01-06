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
use bevy::camera::Exposure;
use bevy::core_pipeline::Skybox;
use bevy::core_pipeline::tonemapping::{DebandDither, Tonemapping};
use bevy::input::mouse::MouseMotion;
use bevy::light::ShadowFilteringMethod;
use bevy::pbr::ScreenSpaceReflections;
use bevy::post_process::bloom::{Bloom, BloomCompositeMode};
use bevy::prelude::*;
use bevy::render::view::Hdr;
use bevy::window::{CursorGrabMode, CursorOptions};
use bevy_water::ImageReformat;

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
    asset_server: Res<AssetServer>,
    capabilities: Res<GraphicsCapabilities>,
    ray_tracing: Res<RayTracingSettings>,
    fog_config: Res<FogConfig>,
    camera_config: Res<CameraConfig>,
) {
    // Daytime skybox (same asset used in v0.3).
    let skybox_image = ImageReformat::cubemap(
        &mut commands,
        &asset_server,
        "textures/table_mountain_2_puresky_4k_cubemap.jpg",
    );

    let mut camera = commands.spawn((
        Camera3d::default(),
        Camera::default(),
        Msaa::Off,
        Exposure::default(),
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
        Skybox {
            image: skybox_image,
            brightness: 1500.0,
            rotation: Quat::IDENTITY,
        },
        CinematicCamera,
    ));

    // Keep HDR + tonemapping enabled on all GPUs; otherwise custom materials that output HDR-linear
    // end up looking dark due to missing exposure/tonemapping.
    camera.insert((Hdr, Tonemapping::AcesFitted, DebandDither::Enabled));
    if !capabilities.integrated_gpu {
        camera.insert(Bloom {
            intensity: camera_config.rendering.bloom_intensity,
            composite_mode: BloomCompositeMode::EnergyConserving,
            ..default()
        });
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

pub fn update_camera_exposure_from_atmosphere(
    atmosphere: Res<crate::environment::AtmosphereSettings>,
    mut cameras: Query<&mut Exposure, With<PlayerCamera>>,
) {
    if !atmosphere.is_changed() {
        return;
    }

    let multiplier = atmosphere.exposure.max(0.001);
    // Treat the in-game "exposure" slider as a direct multiplier on top of Bevy's baseline (BLENDER) exposure.
    // Higher multiplier -> brighter image -> lower EV.
    let ev100 = (Exposure::EV100_BLENDER - multiplier.log2()).clamp(0.0, 20.0);

    for mut exposure in cameras.iter_mut() {
        exposure.ev100 = ev100;
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
    mouse_buttons: Res<ButtonInput<MouseButton>>,
    mut mouse_motion: MessageReader<MouseMotion>,
    time: Res<Time>,
    mut windows: Query<(&mut Window, &mut CursorOptions)>,
    pause_menu: Res<PauseMenuState>,
    palette: Res<PlacementPaletteState>,
    map_state: Res<MapState>,
    camera_config: Res<CameraConfig>,
    mut cursor_captured: Local<bool>,
) {
    let Ok((window, mut cursor_options)) = windows.single_mut() else {
        return;
    };
    let dt = time.delta_secs();

    let ui_open = pause_menu.open || palette.open || map_state.open;

    // Never keep the cursor grabbed when the window isn't focused.
    // Otherwise alt-tab / clicking other windows can feel like the mouse is "stuck".
    if !window.focused {
        *cursor_captured = false;
    }

    // Escape always releases the cursor (pause/menu systems can still handle it too).
    if keys.just_pressed(KeyCode::Escape) {
        *cursor_captured = false;
    }

    // Any UI that needs a cursor releases it.
    if ui_open {
        *cursor_captured = false;
    }

    if !*cursor_captured {
        cursor_options.visible = true;
        cursor_options.grab_mode = CursorGrabMode::None;

        // Drain motion events so we don't apply a large accumulated delta when capture starts.
        for _ in mouse_motion.read() {}

        // Click-to-capture when focused and not in UI.
        if window.focused && !ui_open && mouse_buttons.just_pressed(MouseButton::Left) {
            *cursor_captured = true;
            cursor_options.visible = false;
            cursor_options.grab_mode = CursorGrabMode::Locked;
        } else {
            return;
        }
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
