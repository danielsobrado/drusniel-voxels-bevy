use crate::atmosphere::{fog_camera_components, AtmosphereConfig, FogConfig};
use crate::camera::config::{CameraConfig, CameraExposureConfig};
use crate::interaction::palette::PlacementPaletteState;
use crate::inventory_ui::InventoryUiState;
use crate::map::MapState;
use crate::menu::{AntiAliasing, PauseMenuState, SettingsState, ShadowFiltering, VisualSettings};
use crate::player::Player;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::cinematic::CinematicCamera;
use crate::rendering::ray_tracing::RayTracingSettings;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;
use bevy::anti_alias::contrast_adaptive_sharpening::ContrastAdaptiveSharpening;
use bevy::anti_alias::fxaa::Fxaa;
use bevy::anti_alias::taa::TemporalAntiAliasing;
use bevy::camera::Exposure;
use bevy::core_pipeline::Skybox;
use bevy::core_pipeline::tonemapping::{DebandDither, Tonemapping};
use bevy::input::mouse::MouseMotion;
use bevy::light::VolumetricFog;
use bevy::light::ShadowFilteringMethod;
use bevy::pbr::ScreenSpaceReflections;
use bevy::post_process::bloom::{Bloom, BloomCompositeMode};
use bevy::prelude::*;
use bevy::render::view::{ColorGrading, ColorGradingGlobal, ColorGradingSection, Hdr};
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
    exposure_config: Res<CameraExposureConfig>,
    settings_state: Res<SettingsState>,
    atmo_config: Option<Res<AtmosphereConfig>>,
) {
    // Check if Bevy's native atmosphere is handling sky rendering
    // If enabled, we skip the Skybox to let the procedural atmosphere render
    let native_atmosphere_enabled = atmo_config.map(|c| c.enabled).unwrap_or(false);

    // Daytime skybox (same asset used in v0.3).
    let skybox_image = ImageReformat::cubemap(
        &mut commands,
        &asset_server,
        "textures/table_mountain_2_puresky_4k_cubemap.jpg",
    );

    let mut camera = commands.spawn((
        Camera3d::default(),
        Camera::default(),
        Projection::Perspective(PerspectiveProjection {
            near: 0.02,
            ..default()
        }),
        match settings_state.anti_aliasing {
            AntiAliasing::Msaa4x => Msaa::Sample4,
            _ => Msaa::Off,
        },
        Exposure {
            ev100: exposure_config.ev100_clamped(),
        },
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
        // Keep EnvironmentMapLight for IBL even with native atmosphere
        EnvironmentMapLight {
            diffuse_map: skybox_image.clone(),
            specular_map: skybox_image.clone(),
            intensity: 400.0, // Lower than skybox to avoid over-lighting
            rotation: Quat::IDENTITY,
            affects_lightmapped_mesh_diffuse: false,
        },
        CinematicCamera,
    ));

    // Only add Skybox if native atmosphere is NOT enabled
    // The Skybox would override the procedural atmosphere rendering
    if !native_atmosphere_enabled {
        camera.insert(Skybox {
            image: skybox_image,
            brightness: 800.0,  // Lower skybox brightness
            rotation: Quat::IDENTITY,
        });
    } else {
        info!("Native atmosphere enabled - skipping cubemap Skybox");
    }

    // Keep HDR + tonemapping enabled on all GPUs; otherwise custom materials that output HDR-linear
    // end up looking dark due to missing exposure/tonemapping.
    camera.insert((
        Hdr,
        Tonemapping::AcesFitted,  // v0.3 tonemapping for natural colors
        DebandDither::Enabled,
        ColorGrading {
            global: ColorGradingGlobal {
                exposure: 0.0,           // Neutral exposure (v0.3 style)
                temperature: 0.0,        // Neutral temperature
                tint: 0.0,               // Neutral tint
                hue: 0.0,
                post_saturation: 1.0,    // Neutral saturation
                ..default()
            },
            shadows: ColorGradingSection {
                saturation: 1.0,
                contrast: 1.0,
                gamma: 1.0,
                gain: 1.0,
                lift: 0.0,
            },
            midtones: ColorGradingSection {
                saturation: 1.0,
                contrast: 1.0,
                gamma: 1.0,
                gain: 1.0,
                lift: 0.0,
            },
            highlights: ColorGradingSection {
                saturation: 1.0,
                contrast: 1.0,
                gamma: 1.0,
                gain: 1.0,
                lift: 0.0,
            },
        },
    ));
    if !capabilities.integrated_gpu {
        camera.insert(Bloom {
            intensity: camera_config.rendering.bloom_intensity,
            composite_mode: BloomCompositeMode::EnergyConserving,
            ..default()
        });
    }

    match settings_state.anti_aliasing {
        AntiAliasing::Fxaa => {
            camera.insert(Fxaa::default());
        }
        AntiAliasing::Taa => {
            camera.insert((
                TemporalAntiAliasing::default(),
                ContrastAdaptiveSharpening {
                    enabled: true,
                    sharpening_strength: 0.6,
                    denoise: false,
                },
            ));
        }
        _ => {}
    }

    if fog_config.volumetric.enabled {
        camera.insert(VolumetricFog {
            step_count: fog_config.volumetric.step_count,
            jitter: fog_config.volumetric.jitter,
            ambient_intensity: fog_config.volumetric.ambient_intensity,
            ambient_color: Color::WHITE,
        });
    }

    // SSR currently disabled: enabling deferred + SSR can exceed per-stage texture binding limits
    // on some environments, causing a render-prepass panic.
    let _ = (&ray_tracing, &capabilities);
}

pub fn update_camera_anti_aliasing(
    settings_state: Res<SettingsState>,
    mut commands: Commands,
    mut camera_query: Query<(Entity, &mut Msaa), With<PlayerCamera>>,
) {
    if !settings_state.is_changed() {
        return;
    }

    for (entity, mut msaa) in camera_query.iter_mut() {
        let mut camera = commands.entity(entity);
        // Remove all AA-related components before applying new ones
        camera.remove::<Fxaa>();
        camera.remove::<TemporalAntiAliasing>();
        camera.remove::<ContrastAdaptiveSharpening>();

        match settings_state.anti_aliasing {
            AntiAliasing::None => {
                *msaa = Msaa::Off;
            }
            AntiAliasing::Fxaa => {
                *msaa = Msaa::Off;
                camera.insert(Fxaa::default());
            }
            AntiAliasing::Msaa4x => {
                *msaa = Msaa::Sample4;
            }
            AntiAliasing::Taa => {
                *msaa = Msaa::Off;
                camera.insert((
                    TemporalAntiAliasing::default(),
                    ContrastAdaptiveSharpening {
                        enabled: true,
                        sharpening_strength: 0.6,
                        denoise: false,
                    },
                ));
            }
        }
    }
}

pub fn update_camera_exposure(
    exposure_config: Res<CameraExposureConfig>,
    mut cameras: Query<&mut Exposure, With<PlayerCamera>>,
) {
    let ev100 = exposure_config.ev100_clamped();
    for mut exposure in cameras.iter_mut() {
        exposure.ev100 = ev100;
    }
}

pub fn update_camera_skybox_from_atmosphere(
    atmosphere: Res<crate::environment::AtmosphereSettings>,
    mut cameras: Query<(&mut Skybox, &mut EnvironmentMapLight), With<PlayerCamera>>,
) {
    if !atmosphere.is_changed() {
        return;
    }

    let altitude = if atmosphere.cycle_enabled {
        let phase = atmosphere.time / atmosphere.day_length;
        let theta = phase * std::f32::consts::TAU;
        theta.sin()
    } else {
        1.0
    };

    let daylight = smoothstep(-0.1, 0.25, altitude);
    let skybox_brightness = lerp(1500.0, 6000.0, daylight);
    // Environment map intensity tracks skybox but stays lower to avoid over-lighting
    let env_intensity = lerp(100.0, 400.0, daylight);

    for (mut skybox, mut env_map) in cameras.iter_mut() {
        skybox.brightness = skybox_brightness;
        env_map.intensity = env_intensity;
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

    // SSR currently disabled: avoid triggering deferred/prepass pipeline issues.
    let should_enable = false;
    let _ = (&settings, &capabilities);

    for (entity, current) in cameras.iter_mut() {
        match (should_enable, current.is_some()) {
            (true, false) => {}
            (false, true) => {
                commands
                    .entity(entity)
                    .remove::<ScreenSpaceReflections>();
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
    inventory_ui: Res<InventoryUiState>,
    camera_config: Res<CameraConfig>,
    world: Res<VoxelWorld>,
    mut cursor_captured: Local<bool>,
) {
    let Ok((window, mut cursor_options)) = windows.single_mut() else {
        return;
    };
    let dt = time.delta_secs();

    let ui_open = pause_menu.open || palette.open || map_state.open || inventory_ui.open;

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
                fly_movement(&mut transform, &camera, &keys, dt, &camera_config, &world);
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
    world: &VoxelWorld,
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

    let desired = transform.translation + velocity.normalize_or_zero() * speed * dt;
    if !camera_intersects_solid(world, desired) {
        transform.translation = desired;
    }
}

const CAMERA_COLLISION_RADIUS: f32 = 0.2;

fn camera_intersects_solid(world: &VoxelWorld, position: Vec3) -> bool {
    let offsets = [
        Vec3::ZERO,
        Vec3::X * CAMERA_COLLISION_RADIUS,
        Vec3::NEG_X * CAMERA_COLLISION_RADIUS,
        Vec3::Y * CAMERA_COLLISION_RADIUS,
        Vec3::NEG_Y * CAMERA_COLLISION_RADIUS,
        Vec3::Z * CAMERA_COLLISION_RADIUS,
        Vec3::NEG_Z * CAMERA_COLLISION_RADIUS,
    ];

    for offset in offsets {
        let check = position + offset;
        let voxel_pos = IVec3::new(
            check.x.floor() as i32,
            check.y.floor() as i32,
            check.z.floor() as i32,
        );
        if let Some(voxel) = world.get_voxel(voxel_pos) {
            if voxel.is_solid() {
                return true;
            }
        }
    }

    false
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

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// System to apply visual settings to camera color grading and skybox
pub fn apply_visual_settings(
    visual_settings: Res<VisualSettings>,
    mut camera_query: Query<(&mut ColorGrading, &mut Skybox), With<PlayerCamera>>,
) {
    if !visual_settings.is_changed() {
        return;
    }

    for (mut color_grading, mut skybox) in camera_query.iter_mut() {
        // Apply color grading settings
        color_grading.global.exposure = visual_settings.exposure;
        color_grading.global.temperature = visual_settings.temperature;
        color_grading.global.post_saturation = visual_settings.saturation;
        
        color_grading.midtones.gamma = visual_settings.gamma;
        color_grading.highlights.gain = visual_settings.highlights_gain;
        
        // Apply skybox brightness
        skybox.brightness = visual_settings.skybox_brightness;
    }
}
