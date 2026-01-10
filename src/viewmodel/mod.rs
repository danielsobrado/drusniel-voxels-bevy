pub mod config;

use bevy::prelude::*;

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

/// Resource to track swing state
#[derive(Resource, Default)]
pub struct PickaxeState {
    pub swing_timer: f32,
    pub swing_duration: f32,
}

/// Spawn the pickaxe viewmodel as a child of the camera
pub fn spawn_pickaxe(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    camera_query: Query<Entity, With<crate::camera::controller::PlayerCamera>>,
    config: Res<ViewmodelConfig>,
) {
    if let Ok(camera_entity) = camera_query.single() {
        let handle_mesh = meshes.add(Cuboid::new(
            config.handle.size.x,
            config.handle.size.y,
            config.handle.size.z,
        ));
        let handle_material = materials.add(StandardMaterial {
            base_color: config.handle.color,
            emissive: LinearRgba::new(
                config.handle.emissive[0],
                config.handle.emissive[1],
                config.handle.emissive[2],
                config.handle.emissive[3],
            ),
            perceptual_roughness: config.handle.roughness,
            ..default()
        });

        let head_mesh = meshes.add(Cuboid::new(
            config.head.size.x,
            config.head.size.y,
            config.head.size.z,
        ));
        let head_material = materials.add(StandardMaterial {
            base_color: config.head.color,
            emissive: LinearRgba::new(
                config.head.emissive[0],
                config.head.emissive[1],
                config.head.emissive[2],
                config.head.emissive[3],
            ),
            perceptual_roughness: config.head.roughness,
            metallic: config.head.metallic,
            ..default()
        });

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
                        Mesh3d(handle_mesh),
                        MeshMaterial3d(handle_material),
                        Transform::from_xyz(0.0, 0.0, 0.0),
                    ));

                    pickaxe.spawn((
                        Mesh3d(head_mesh),
                        MeshMaterial3d(head_material),
                        Transform::from_xyz(
                            config.head.offset.x,
                            config.head.offset.y,
                            config.head.offset.z,
                        ),
                    ));
                });
        });
    }
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
            let swing_amount = if pickaxe.swing_progress < down_phase {
                pickaxe.swing_progress / down_phase
            } else {
                1.0 - (pickaxe.swing_progress - down_phase) / up_phase
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
                config.position.offset.z + swing_amount * config.swing.offset_z,
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

pub fn update_pickaxe_visibility(
    equipped: Res<EquippedItem>,
    mut pickaxe_query: Query<&mut Visibility, With<PickaxeViewModel>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let visible = !matches!(equipped.item, Some(ItemType::Torch));
    let visibility = if visible {
        Visibility::Visible
    } else {
        Visibility::Hidden
    };

    for mut pickaxe_visibility in pickaxe_query.iter_mut() {
        *pickaxe_visibility = visibility;
    }
}

/// Plugin for the pickaxe viewmodel
pub struct PickaxePlugin;

impl Plugin for PickaxePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PickaxeState>()
            .init_resource::<ViewmodelConfig>()
            .add_systems(PostStartup, spawn_pickaxe)
            .add_systems(
                Update,
                (trigger_swing_system, animate_pickaxe_system, idle_bob_system).chain(),
            )
            .add_systems(Update, update_pickaxe_visibility);
    }
}
