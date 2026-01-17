pub mod config;

use bevy::light::VolumetricLight;
use bevy::prelude::*;
use bevy_hanabi::prelude::*;

use crate::entity::{EquippedItem, ItemType};

pub use config::ViewmodelConfig;

/// Component marking the pickaxe viewmodel
#[derive(Component)]
pub struct PickaxeViewModel {
    /// Current swing animation progress (0.0 = idle, 1.0 = full swing)
    pub swing_progress: f32,
    /// Is currently swinging
    pub is_swinging: bool,
}

impl Default for PickaxeViewModel {
    fn default() -> Self {
        Self {
            swing_progress: 0.0,
            is_swinging: false,
        }
    }
}

/// Component marking the axe viewmodel
#[derive(Component)]
pub struct AxeViewModel;

/// Component marking the sword viewmodel
#[derive(Component)]
pub struct SwordViewModel;

/// Component marking the torch viewmodel
#[derive(Component)]
pub struct TorchViewModel;

/// Component for torch light flickering
#[derive(Component)]
pub struct TorchFlicker {
    pub base_intensity: f32,
    pub speed: f32,
    pub amplitude: f32,
}

/// Component marking the shovel viewmodel
#[derive(Component)]
pub struct ShovelViewModel;

/// Component marking the rake viewmodel
#[derive(Component)]
pub struct RakeViewModel;


/// Resource to track swing state
#[derive(Resource, Default)]
pub struct PickaxeState {
    pub swing_timer: f32,
    pub swing_duration: f32,
}

/// Spawn the pickaxe viewmodel as a child of the camera
pub fn spawn_pickaxe(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    camera_query: Query<Entity, With<crate::camera::controller::PlayerCamera>>,
    config: Res<ViewmodelConfig>,
) {
    let Ok(camera_entity) = camera_query.single() else {
        return;
    };

    let scene_handle: Handle<Scene> =
        asset_server.load("models/Models/GLB format/Pickaxe.glb#Scene0");

    commands.entity(camera_entity).with_children(|parent| {
        parent
            .spawn((
                Transform::from_xyz(
                    config.position.offset.x,
                    config.position.offset.y,
                    config.position.offset.z,
                )
                .with_rotation(Quat::from_euler(
                    EulerRot::XYZ,
                    config.position.rotation.x,
                    config.position.rotation.y,
                    config.position.rotation.z,
                )),
                Visibility::default(),
                PickaxeViewModel::default(),
            ))
            .with_children(|pickaxe| {
                pickaxe.spawn((
                    SceneRoot(scene_handle),
                    Transform::from_scale(Vec3::splat(0.9))
                        .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.2, 0.6, 0.0)),
                ));
            });
    });
}

/// System to trigger pickaxe swing when breaking blocks
pub fn trigger_swing_system(
    mouse: Res<ButtonInput<MouseButton>>,
    mut pickaxe_query: Query<&mut PickaxeViewModel>,
    mut state: ResMut<PickaxeState>,
    config: Res<ViewmodelConfig>,
) {
    if mouse.just_pressed(MouseButton::Left) {
        for mut pickaxe in pickaxe_query.iter_mut() {
            if !pickaxe.is_swinging {
                pickaxe.is_swinging = true;
                pickaxe.swing_progress = 0.0;
                state.swing_timer = 0.0;
                state.swing_duration = config.swing.duration;
            }
        }
    }
}

/// System to animate the pickaxe swing
pub fn animate_pickaxe_system(
    time: Res<Time>,
    mut state: ResMut<PickaxeState>,
    mut pickaxe_query: Query<(&mut PickaxeViewModel, &mut Transform)>,
    config: Res<ViewmodelConfig>,
) {
    let dt = time.delta_secs();

    for (mut pickaxe, mut transform) in pickaxe_query.iter_mut() {
        if pickaxe.is_swinging {
            state.swing_timer += dt;
            pickaxe.swing_progress = (state.swing_timer / state.swing_duration).min(1.0);

            let down_phase = config.swing.down_phase;
            let up_phase = 1.0 - down_phase;

            // Calculate swing amount with easing for more natural motion
            let swing_amount = if pickaxe.swing_progress < down_phase {
                // Down phase: ease-in for acceleration (like gravity)
                let t = pickaxe.swing_progress / down_phase;
                t * t // quadratic ease-in
            } else {
                // Up phase: ease-out for deceleration (recovery)
                let t = (pickaxe.swing_progress - down_phase) / up_phase;
                let ease_out = 1.0 - (1.0 - t) * (1.0 - t); // quadratic ease-out
                1.0 - ease_out
            };

            let base_rotation = Quat::from_euler(
                EulerRot::XYZ,
                config.position.rotation.x,
                config.position.rotation.y,
                config.position.rotation.z,
            );
            let swing_rotation = Quat::from_euler(
                EulerRot::XYZ,
                swing_amount * config.swing.rotation_pitch,
                swing_amount * config.swing.rotation_yaw,
                swing_amount * config.swing.rotation_roll,
            );

            transform.rotation = base_rotation * swing_rotation;

            transform.translation = Vec3::new(
                config.position.offset.x - swing_amount * config.swing.offset_x,
                config.position.offset.y - swing_amount * config.swing.offset_y,
                config.position.offset.z - swing_amount * config.swing.offset_z,
            );

            if pickaxe.swing_progress >= 1.0 {
                pickaxe.is_swinging = false;
                pickaxe.swing_progress = 0.0;
                transform.translation = config.position.offset;
                transform.rotation = base_rotation;
            }
        }
    }
}

/// Subtle idle bob animation
pub fn idle_bob_system(
    time: Res<Time>,
    mut pickaxe_query: Query<(&PickaxeViewModel, &mut Transform)>,
    config: Res<ViewmodelConfig>,
) {
    let t = time.elapsed_secs();

    for (pickaxe, mut transform) in pickaxe_query.iter_mut() {
        if !pickaxe.is_swinging {
            let bob = (t * config.idle.bob_frequency).sin() * config.idle.bob_amplitude;
            let sway = (t * config.idle.sway_frequency).cos() * config.idle.sway_amplitude;

            transform.translation.y = config.position.offset.y + bob;
            transform.translation.x = config.position.offset.x + sway;
        }
    }
}

/// Spawn the axe viewmodel as a child of the camera
pub fn spawn_axe(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    camera_query: Query<Entity, With<crate::camera::controller::PlayerCamera>>,
    _config: Res<ViewmodelConfig>,
) {
    let Ok(camera_entity) = camera_query.single() else {
        return;
    };

    let scene_handle: Handle<Scene> = asset_server.load("models/Models/GLB format/MedievalAxe.glb#Scene0");

    commands.entity(camera_entity).with_children(|parent| {
        parent
            .spawn((
                // Position similar to pickaxe
                Transform::from_xyz(0.45, -0.35, -0.9)
                    .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.3, -0.5, 0.2)),
                Visibility::Hidden,
                AxeViewModel,
            ))
            .with_children(|axe| {
                axe.spawn((
                    SceneRoot(scene_handle),
                    Transform::from_scale(Vec3::splat(0.35))
                        .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, std::f32::consts::PI, 0.0)),
                ));
            });
    });
}

/// Spawn the sword viewmodel as a child of the camera
pub fn spawn_sword(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    camera_query: Query<Entity, With<crate::camera::controller::PlayerCamera>>,
    config: Res<ViewmodelConfig>,
) {
    let Ok(camera_entity) = camera_query.single() else {
        return;
    };

    let scene_handle: Handle<Scene> = asset_server.load("models/Models/GLB format/Sword.glb#Scene0");

    commands.entity(camera_entity).with_children(|parent| {
        parent
            .spawn((
                Transform::from_xyz(
                    config.position.offset.x + 0.25,
                    config.position.offset.y - 0.1,
                    config.position.offset.z - 0.2,
                )
                .with_rotation(Quat::from_euler(
                    EulerRot::XYZ,
                    config.position.rotation.x,
                    config.position.rotation.y,
                    config.position.rotation.z,
                )),
                Visibility::Hidden,
                SwordViewModel,
            ))
            .with_children(|sword| {
                sword.spawn((
                    SceneRoot(scene_handle),
                    Transform::from_scale(Vec3::splat(1.0))
                        .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.5, 1.8, 0.0)),
                ));
            });
    });
}

/// Spawn the torch viewmodel as a child of the camera
pub fn spawn_torch(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    camera_query: Query<Entity, With<crate::camera::controller::PlayerCamera>>,
    config: Res<ViewmodelConfig>,
    mut effects: ResMut<Assets<EffectAsset>>,
) {
    let Ok(camera_entity) = camera_query.single() else {
        return;
    };

    let scene_handle: Handle<Scene> =
        asset_server.load("models/Models/GLB format/MedievalTorch.glb#Scene0");

    // Create fire particle effect
    let fire_handle = create_torch_fire_effect(&mut effects);

    commands.entity(camera_entity).with_children(|parent| {
        parent
            .spawn((
                // Position torch closer and lower, like holding it at your side
                Transform::from_xyz(0.4, -0.5, -0.8)
                    .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.2, -0.3, 0.1)),
                Visibility::Hidden,
                TorchViewModel,
            ))
            .with_children(|torch| {
                // The actual torch model
                torch.spawn((
                    SceneRoot(scene_handle),
                    Transform::from_scale(Vec3::splat(0.75))
                        .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, 0.0, 0.0)),
                ));

                // Add a point light for the torch flame effect
                torch.spawn((
                    PointLight {
                        color: Color::srgb(1.0, 0.5, 0.2), // Warmer orange-red
                        intensity: 120_000.0,
                        range: 60.0,
                        shadows_enabled: true,
                        ..default()
                    },
                    VolumetricLight,
                    TorchFlicker {
                        base_intensity: 120_000.0,
                        speed: 10.0,
                        amplitude: 20_000.0,
                    },
                    Transform::from_xyz(0.0, 0.45, 0.1), // Slightly adjusted position for tip
                ));

                // Add the fire particle effect
                torch.spawn((
                    ParticleEffect::new(fire_handle),
                    // Position at the tip of the torch
                    Transform::from_xyz(0.0, 0.45, 0.1), 
                ));
            });
    });
}



/// Spawn the shovel viewmodel as a child of the camera
pub fn spawn_shovel(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    camera_query: Query<Entity, With<crate::camera::controller::PlayerCamera>>,
    config: Res<ViewmodelConfig>,
) {
    let Ok(camera_entity) = camera_query.single() else {
        return;
    };

    let scene_handle: Handle<Scene> =
        asset_server.load("models/Models/GLB format/Shovel.glb#Scene0");

    commands.entity(camera_entity).with_children(|parent| {
        parent
            .spawn((
                Transform::from_xyz(
                    config.position.offset.x + 0.1,
                    config.position.offset.y - 0.2,
                    config.position.offset.z - 0.2,
                )
                .with_rotation(Quat::from_euler(
                    EulerRot::XYZ,
                    config.position.rotation.x,
                    config.position.rotation.y,
                    config.position.rotation.z,
                )),
                Visibility::Hidden,
                ShovelViewModel,
            ))
            .with_children(|shovel| {
                shovel.spawn((
                    SceneRoot(scene_handle),
                    Transform::from_scale(Vec3::splat(1.1))
                        .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.2, 0.0, -0.2)),
                ));
            });
    });
}

/// Spawn the rake viewmodel as a child of the camera
pub fn spawn_rake(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    camera_query: Query<Entity, With<crate::camera::controller::PlayerCamera>>,
    config: Res<ViewmodelConfig>,
) {
    let Ok(camera_entity) = camera_query.single() else {
        return;
    };

    let scene_handle: Handle<Scene> =
        asset_server.load("models/Models/GLB format/Hand Rake.glb#Scene0");

    commands.entity(camera_entity).with_children(|parent| {
        parent
            .spawn((
                Transform::from_xyz(
                    config.position.offset.x + 0.15,
                    config.position.offset.y - 0.15,
                    config.position.offset.z - 0.15,
                )
                .with_rotation(Quat::from_euler(
                    EulerRot::XYZ,
                    config.position.rotation.x,
                    config.position.rotation.y,
                    config.position.rotation.z,
                )),
                Visibility::Hidden,
                RakeViewModel,
            ))
            .with_children(|rake| {
                rake.spawn((
                    SceneRoot(scene_handle),
                    Transform::from_scale(Vec3::splat(1.1))
                        .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.4, 1.5, 0.0)),
                ));
            });
    });
}


pub fn update_pickaxe_visibility(
    equipped: Res<EquippedItem>,
    mut pickaxe_query: Query<&mut Visibility, With<PickaxeViewModel>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let visible = matches!(equipped.item, Some(ItemType::Pickaxe) | Some(ItemType::TerrainLower));
    let visibility = if visible {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for mut pickaxe_visibility in pickaxe_query.iter_mut() {
        *pickaxe_visibility = visibility;
    }
}

pub fn update_axe_visibility(
    equipped: Res<EquippedItem>,
    mut axe_query: Query<&mut Visibility, With<AxeViewModel>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let visibility = if matches!(equipped.item, Some(ItemType::Axe)) {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for mut axe_visibility in axe_query.iter_mut() {
        *axe_visibility = visibility;
    }
}

pub fn update_sword_visibility(
    equipped: Res<EquippedItem>,
    mut sword_query: Query<&mut Visibility, With<SwordViewModel>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let visibility = if matches!(equipped.item, Some(ItemType::Sword)) {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for mut sword_visibility in sword_query.iter_mut() {
        *sword_visibility = visibility;
    }
}

pub fn update_torch_visibility(
    equipped: Res<EquippedItem>,
    mut torch_query: Query<&mut Visibility, With<TorchViewModel>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let visibility = if matches!(equipped.item, Some(ItemType::Torch)) {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for mut torch_visibility in torch_query.iter_mut() {
        *torch_visibility = visibility;
    }
}

pub fn update_shovel_visibility(
    equipped: Res<EquippedItem>,
    mut shovel_query: Query<&mut Visibility, With<ShovelViewModel>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let visibility = if matches!(equipped.item, Some(ItemType::TerrainRaise)) {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for mut shovel_visibility in shovel_query.iter_mut() {
        *shovel_visibility = visibility;
    }
}

pub fn update_rake_visibility(
    equipped: Res<EquippedItem>,
    mut rake_query: Query<&mut Visibility, With<RakeViewModel>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let visibility = if matches!(equipped.item, Some(ItemType::TerrainLevel) | Some(ItemType::TerrainSmooth)) {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for mut rake_visibility in rake_query.iter_mut() {
        *rake_visibility = visibility;
    }
}

/// Plugin for all viewmodels
pub struct PickaxePlugin;

impl Plugin for PickaxePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PickaxeState>()
            .init_resource::<ViewmodelConfig>()
            .add_systems(
                PostStartup,
                (spawn_pickaxe, spawn_axe, spawn_sword, spawn_torch, spawn_shovel, spawn_rake),
            )
            .add_systems(
                Update,
                (trigger_swing_system, animate_pickaxe_system, idle_bob_system, animate_torch_light).chain(),
            )
            .add_systems(
                Update,
                (
                    update_pickaxe_visibility,
                    update_axe_visibility,
                    update_sword_visibility,
                    update_torch_visibility,
                    update_shovel_visibility,
                    update_rake_visibility,
                ),
            );
    }
}

fn animate_torch_light(
    time: Res<Time>,
    mut query: Query<(&mut PointLight, &TorchFlicker)>,
) {
    let t = time.elapsed_secs();
    for (mut light, flicker) in query.iter_mut() {
        // Multi-layered sine waves for organic flickering
        let noise = (t * flicker.speed).sin() 
            + (t * flicker.speed * 2.3).sin() * 0.5 
            + (t * flicker.speed * 5.7).sin() * 0.25;
        
        light.intensity = flicker.base_intensity + noise * flicker.amplitude;
    }
}

fn create_torch_fire_effect(effects: &mut Assets<EffectAsset>) -> Handle<EffectAsset> {
    let mut color_gradient = bevy_hanabi::Gradient::new();
    // Bright yellow/white core (HDR)
    color_gradient.add_key(0.0, Vec4::new(4.0, 3.0, 1.0, 1.0)); 
    // Orange body
    color_gradient.add_key(0.3, Vec4::new(4.0, 1.0, 0.1, 1.0));
    // Red/Dark Orange tip
    color_gradient.add_key(0.6, Vec4::new(2.0, 0.2, 0.0, 0.8));
    // Smoke/Dark Gray
    color_gradient.add_key(0.8, Vec4::new(0.2, 0.2, 0.2, 0.3));
    // Transparent at end
    color_gradient.add_key(1.0, Vec4::new(0.0, 0.0, 0.0, 0.0));

    let mut size_gradient = bevy_hanabi::Gradient::new();
    size_gradient.add_key(0.0, Vec3::splat(0.02));
    size_gradient.add_key(0.4, Vec3::splat(0.05)); // Expand slightly
    size_gradient.add_key(1.0, Vec3::splat(0.01)); // Shrink to nothing

    let writer = ExprWriter::new();

    // Lifetime
    let init_lifetime = SetAttributeModifier::new(
        Attribute::LIFETIME,
        writer.lit(0.7).expr(), 
    );

    // Initial Position (Small tight sphere at emitter)
    let init_pos = SetPositionSphereModifier {
        center: writer.lit(Vec3::ZERO).expr(),
        radius: writer.lit(0.02).expr(), 
        dimension: ShapeDimension::Volume,
    };

    // Initial Velocity (Upwards + random noise)
    let init_vel = SetVelocitySphereModifier {
        center: writer.lit(Vec3::Y * 0.5).expr(), // Bias up
        speed: writer.lit(0.2).expr(), // Random spread
    };
    
    // Expressions for modifiers
    let accel_expr = writer.lit(Vec3::new(0.0, 2.0, 0.0)).expr();
    let drag_expr = writer.lit(0.5f32).expr();

    let spawner = SpawnerSettings::rate(60.0.into()); 

    let effect = EffectAsset::new(512, spawner, writer.finish())
        .with_name("torch_fire")
        .with_simulation_space(SimulationSpace::Global) // Trails when moving
        .init(init_lifetime)
        .init(init_pos)
        .init(init_vel)
        .update(AccelModifier::new(accel_expr)) // Heat rises
        .update(LinearDragModifier::new(drag_expr)) // Drag
        .render(ColorOverLifetimeModifier::new(color_gradient))
        .render(SizeOverLifetimeModifier { gradient: size_gradient, screen_space_size: false })
        .render(OrientModifier::new(OrientMode::FaceCameraPosition));

    effects.add(effect)
}
