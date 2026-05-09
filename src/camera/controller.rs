use crate::atmosphere::{AtmosphereConfig, FogConfig, fog_camera_components};
use crate::camera::config::{CameraConfig, CameraExposureConfig};
use crate::constants::WORLD_EDGE_GUARD_MARGIN;
use crate::editor_diagnostics::{
    EditorDiagnosticsCategory, EditorDiagnosticsState, editor_diagnostics_log,
};
use crate::interaction::palette::PlacementPaletteState;
use crate::inventory_ui::InventoryUiState;
use crate::map::MapState;
use crate::menu::{AntiAliasing, PauseMenuState, SettingsState, ShadowFiltering, VisualSettings};
use crate::player::{
    Player, PlayerWorldValidity, SpawnColliderReadiness, SpawnValidationReport,
    classify_player_world_validity, find_nearest_valid_spawn,
};
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
use bevy::input::mouse::MouseWheel;
use bevy::light::ShadowFilteringMethod;
use bevy::pbr::ScreenSpaceReflections;
use bevy::post_process::bloom::{Bloom, BloomCompositeMode};
use bevy::prelude::*;
use bevy::render::view::{
    ColorGrading, ColorGradingGlobal, ColorGradingSection, Hdr, NoIndirectDrawing,
};
use bevy::window::{CursorGrabMode, CursorOptions};
use bevy_water::ImageReformat;

fn editor_native_viewport_enabled() -> bool {
    std::env::var_os("DRUSNIEL_EDITOR_NATIVE_VIEWPORT").is_some()
}

#[derive(Default)]
pub(crate) struct EditorViewportInputDebugState {
    reported_system_seen: bool,
    reported_missing_window: bool,
    reported_initial: bool,
    last_control_down: bool,
    last_window_focused: bool,
    last_active: bool,
    last_move_intent: bool,
    seconds_since_report: f32,
}

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

fn default_camera_color_grading() -> ColorGrading {
    ColorGrading {
        global: ColorGradingGlobal {
            exposure: 0.0,
            temperature: 0.0,
            tint: 0.0,
            hue: 0.0,
            post_saturation: 1.0,
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
    }
}

fn apply_color_grading_preset(color_grading: &mut ColorGrading, visual_settings: &VisualSettings) {
    let saturation = visual_settings.saturation.clamp(0.5, 2.0);
    let gamma = visual_settings.gamma.clamp(0.5, 1.5);
    let saturation_bias = saturation - 1.0;
    let contrast_bias = (1.0 - gamma).clamp(-0.35, 0.35);

    color_grading.global.exposure = visual_settings.exposure.clamp(-1.0, 1.0);
    color_grading.global.temperature = visual_settings.temperature.clamp(-0.5, 0.5);
    color_grading.global.tint = (visual_settings.sun_warmth * 0.08).clamp(-0.2, 0.2);
    color_grading.global.post_saturation = saturation;

    color_grading.shadows.saturation = (1.0 + saturation_bias * 0.18).clamp(0.5, 2.0);
    color_grading.shadows.contrast = (1.0 + contrast_bias * 0.04).clamp(0.75, 1.25);
    color_grading.shadows.gamma = lerp(1.0, gamma, 0.35);
    color_grading.shadows.gain = 1.0;
    color_grading.shadows.lift = 0.0;

    color_grading.midtones.saturation = (1.0 + saturation_bias * 0.35).clamp(0.5, 2.0);
    color_grading.midtones.contrast = (1.0 + contrast_bias * 0.08).clamp(0.75, 1.25);
    color_grading.midtones.gamma = gamma;
    color_grading.midtones.gain = 1.0;
    color_grading.midtones.lift = 0.0;

    color_grading.highlights.saturation = (1.0 + saturation_bias * 0.14).clamp(0.5, 2.0);
    color_grading.highlights.contrast = (1.0 + contrast_bias * 0.04).clamp(0.75, 1.25);
    color_grading.highlights.gamma = lerp(1.0, gamma, 0.25);
    color_grading.highlights.gain = visual_settings.highlights_gain.clamp(0.5, 1.5);
    color_grading.highlights.lift = 0.0;
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
        match settings_state.shadow_filtering {
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
            brightness: 800.0, // Lower skybox brightness
            rotation: Quat::IDENTITY,
        });
    } else {
        info!("Native atmosphere enabled - skipping cubemap Skybox");
    }

    // Keep HDR + tonemapping enabled on all GPUs; otherwise custom materials that output HDR-linear
    // end up looking dark due to missing exposure/tonemapping.
    let mut color_grading = default_camera_color_grading();
    apply_color_grading_preset(&mut color_grading, &VisualSettings::default());
    camera.insert((
        Hdr,
        Tonemapping::AcesFitted,
        DebandDither::Enabled,
        color_grading,
    ));
    if !capabilities.integrated_gpu {
        camera.insert(Bloom {
            intensity: camera_config.rendering.bloom_intensity,
            composite_mode: BloomCompositeMode::EnergyConserving,
            ..default()
        });
    }
    if cfg!(debug_assertions) {
        camera.insert(NoIndirectDrawing);
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

    // Note: VolumetricFog is already added via fog_camera_components() at line 114
    // The sync_fog_toggles system in fog.rs handles enabling/disabling based on config

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
    mut mouse_wheel: MessageReader<MouseWheel>,
    time: Res<Time>,
    mut windows: Query<(&mut Window, &mut CursorOptions)>,
    pause_menu: Res<PauseMenuState>,
    palette: Res<PlacementPaletteState>,
    map_state: Res<MapState>,
    inventory_ui: Res<InventoryUiState>,
    camera_config: Res<CameraConfig>,
    world: Res<VoxelWorld>,
    diagnostics: Option<Res<EditorDiagnosticsState>>,
    mut cursor_captured: Local<bool>,
    mut editor_debug: Local<EditorViewportInputDebugState>,
) {
    let editor_native_viewport = editor_native_viewport_enabled();
    let diagnostics = diagnostics.as_deref();
    if editor_native_viewport && !editor_debug.reported_system_seen {
        editor_diagnostics_log(
            diagnostics,
            EditorDiagnosticsCategory::Input,
            "player_camera_system is running",
        );
        editor_debug.reported_system_seen = true;
    }

    let Ok((window, mut cursor_options)) = windows.single_mut() else {
        if editor_native_viewport && !editor_debug.reported_missing_window {
            editor_diagnostics_log(
                diagnostics,
                EditorDiagnosticsCategory::Input,
                "no single primary window with cursor options",
            );
            editor_debug.reported_missing_window = true;
        }
        return;
    };
    let dt = time.delta_secs();

    let ui_open = pause_menu.open || palette.open || map_state.open || inventory_ui.open;

    if editor_native_viewport {
        editor_viewport_camera_navigation(
            &mut query,
            &keys,
            &mut mouse_motion,
            &mut mouse_wheel,
            dt,
            &mut cursor_options,
            window.focused,
            &camera_config,
            &world,
            &mut *editor_debug,
            diagnostics,
        );
        *cursor_captured = false;
        return;
    }

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
            *transform =
                surface_safe_camera_transform(&camera_config, &world).unwrap_or_else(|| {
                    Transform::from_xyz(
                        camera_config.spawn.position.x,
                        camera_config.spawn.position.y,
                        camera_config.spawn.position.z,
                    )
                    .looking_at(camera_config.spawn.look_at, Vec3::Y)
                });
        }

        if cursor_options.visible {
            return;
        }

        // Mouse look (both modes)
        for ev in mouse_motion.read() {
            camera.yaw -= ev.delta.x * camera.sensitivity;
            camera.pitch -= ev.delta.y * camera.sensitivity;
            camera.pitch = camera.pitch.clamp(
                camera_config.movement.pitch_min,
                camera_config.movement.pitch_max,
            );
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

fn editor_viewport_camera_navigation(
    query: &mut Query<(&mut Transform, &mut PlayerCamera)>,
    keys: &Res<ButtonInput<KeyCode>>,
    mouse_motion: &mut MessageReader<MouseMotion>,
    mouse_wheel: &mut MessageReader<MouseWheel>,
    dt: f32,
    cursor_options: &mut CursorOptions,
    window_focused: bool,
    camera_config: &CameraConfig,
    world: &VoxelWorld,
    debug_state: &mut EditorViewportInputDebugState,
    diagnostics: Option<&EditorDiagnosticsState>,
) {
    let control_down = keys.pressed(KeyCode::ControlLeft) || keys.pressed(KeyCode::ControlRight);
    let key_w = keys.pressed(KeyCode::KeyW);
    let key_a = keys.pressed(KeyCode::KeyA);
    let key_s = keys.pressed(KeyCode::KeyS);
    let key_d = keys.pressed(KeyCode::KeyD);
    let shift_down = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let mut wheel_delta = 0.0f32;
    for event in mouse_wheel.read() {
        wheel_delta += event.y;
    }

    let active = control_down;
    let move_intent = key_w || key_a || key_s || key_d || wheel_delta.abs() > f32::EPSILON;
    let state_changed = !debug_state.reported_initial
        || debug_state.last_control_down != control_down
        || debug_state.last_window_focused != window_focused
        || debug_state.last_active != active
        || debug_state.last_move_intent != move_intent;
    debug_state.seconds_since_report += dt;

    if !active {
        cursor_options.visible = true;
        cursor_options.grab_mode = CursorGrabMode::None;
        let drained_motion_events = mouse_motion.read().count();
        if state_changed || debug_state.seconds_since_report >= 2.0 {
            editor_diagnostics_log(
                diagnostics,
                EditorDiagnosticsCategory::Input,
                format!(
                    "[editor-viewport-input] inactive focused={} ctrl={} move_intent={} drained_mouse_events={}",
                    window_focused, control_down, move_intent, drained_motion_events
                ),
            );
            debug_state.reported_initial = true;
            debug_state.seconds_since_report = 0.0;
        }
        debug_state.last_control_down = control_down;
        debug_state.last_window_focused = window_focused;
        debug_state.last_active = active;
        debug_state.last_move_intent = move_intent;
        return;
    }

    cursor_options.visible = false;
    cursor_options.grab_mode = CursorGrabMode::Locked;

    let mut camera_count = 0usize;
    let mut mouse_delta = Vec2::ZERO;
    let mut mouse_event_count = 0usize;
    let mut moved = false;
    let mut blocked = false;
    let mut camera_position = Vec3::ZERO;

    for (mut transform, mut camera) in query.iter_mut() {
        camera_count += 1;
        for event in mouse_motion.read() {
            mouse_delta += event.delta;
            mouse_event_count += 1;
            camera.yaw -= event.delta.x * camera.sensitivity;
            camera.pitch -= event.delta.y * camera.sensitivity;
            camera.pitch = camera.pitch.clamp(
                camera_config.movement.pitch_min,
                camera_config.movement.pitch_max,
            );
        }

        transform.rotation = Quat::from_euler(EulerRot::YXZ, camera.yaw, camera.pitch, 0.0);

        let forward = transform.forward().as_vec3();
        let right = transform.right().as_vec3();
        let mut velocity = Vec3::ZERO;
        if key_w {
            velocity += forward;
        }
        if key_s {
            velocity -= forward;
        }
        if key_a {
            velocity -= right;
        }
        if key_d {
            velocity += right;
        }

        let speed = if shift_down {
            camera.fly_speed * camera_config.movement.fly_turbo_multiplier
        } else {
            camera.fly_speed
        };

        let movement =
            velocity.normalize_or_zero() * speed * dt + forward * wheel_delta * speed * 0.12;
        if movement.length_squared() > 0.0 {
            let desired = transform.translation + movement;
            if !camera_intersects_solid(world, desired) {
                transform.translation = world
                    .bounds()
                    .clamp_horizontal_position(desired, WORLD_EDGE_GUARD_MARGIN);
                moved = true;
            } else {
                blocked = true;
            }
        }
        camera_position = transform.translation;
    }

    let periodic = debug_state.seconds_since_report >= 1.0;
    if state_changed || periodic || mouse_event_count > 0 || wheel_delta.abs() > f32::EPSILON {
        editor_diagnostics_log(
            diagnostics,
            EditorDiagnosticsCategory::Input,
            format!(
                "[editor-viewport-input] active focused={} ctrl={} keys=w:{} a:{} s:{} d:{} shift:{} mouse_events={} mouse_delta=({:.1},{:.1}) wheel={:.2} cameras={} moved={} blocked={} pos=({:.2},{:.2},{:.2})",
                window_focused,
                control_down,
                key_w,
                key_a,
                key_s,
                key_d,
                shift_down,
                mouse_event_count,
                mouse_delta.x,
                mouse_delta.y,
                wheel_delta,
                camera_count,
                moved,
                blocked,
                camera_position.x,
                camera_position.y,
                camera_position.z
            ),
        );
        debug_state.reported_initial = true;
        debug_state.seconds_since_report = 0.0;
    }
    debug_state.last_control_down = control_down;
    debug_state.last_window_focused = window_focused;
    debug_state.last_active = active;
    debug_state.last_move_intent = move_intent;
}

pub fn ensure_camera_above_surface_once(
    world: Res<VoxelWorld>,
    camera_config: Res<CameraConfig>,
    mut camera_query: Query<&mut Transform, With<PlayerCamera>>,
    mut checked: Local<bool>,
) {
    if *checked {
        return;
    }

    if world.chunk_positions().next().is_none() {
        return;
    }

    let Ok(mut transform) = camera_query.single_mut() else {
        return;
    };

    let validity = classify_player_world_validity(&world, transform.translation);
    if validity == PlayerWorldValidity::InValidWorld {
        *checked = true;
        return;
    }

    let Some(safe_transform) = surface_safe_camera_transform(&camera_config, &world) else {
        return;
    };

    warn!(
        "Camera started in invalid world space ({:?}); moved to {:?}",
        validity, safe_transform.translation
    );
    *transform = safe_transform;
    *checked = true;
}

fn surface_safe_camera_transform(config: &CameraConfig, world: &VoxelWorld) -> Option<Transform> {
    let mut stats = SpawnValidationReport::default();
    let readiness = SpawnColliderReadiness::default();
    let preferred = config.spawn.position.xz();
    let spawn = find_nearest_valid_spawn(world, preferred, &readiness, false, &mut stats)?;
    let position = spawn.position + Vec3::Y * config.movement.eye_height;
    let look_at = if config.spawn.look_at.distance_squared(position) > 0.01 {
        config.spawn.look_at
    } else {
        position + Vec3::new(-1.0, -0.2, -1.0)
    };
    Some(Transform::from_translation(position).looking_at(look_at, Vec3::Y))
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
        transform.translation = world
            .bounds()
            .clamp_horizontal_position(desired, WORLD_EDGE_GUARD_MARGIN);
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
    if editor_native_viewport_enabled() {
        return;
    }

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
    mut camera_query: Query<(&mut ColorGrading, Option<&mut Skybox>), With<PlayerCamera>>,
) {
    if !visual_settings.is_changed() {
        return;
    }

    for (mut color_grading, skybox) in camera_query.iter_mut() {
        apply_color_grading_preset(&mut color_grading, &visual_settings);

        if let Some(mut skybox) = skybox {
            skybox.brightness = visual_settings.skybox_brightness;
        }
    }
}
