use avian3d::prelude::*;
use bevy::prelude::*;
use bevy_tnua::prelude::*;
use bevy_tnua_avian3d::*;

use crate::player::PlayerMovementScheme;
use crate::voxel::world::WorldBounds;

use super::PhysicsLayer;
use super::terrain_collider::{generate_chunk_colliders, handle_chunk_modification};

#[derive(Component)]
struct WorldFloorCollider;

pub struct PhysicsPlugin;

impl Plugin for PhysicsPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(PhysicsPlugins::default());

        app.add_plugins(TnuaAvian3dPlugin::new(PhysicsSchedule));
        app.add_plugins(TnuaControllerPlugin::<PlayerMovementScheme>::new(
            PhysicsSchedule,
        ));

        #[cfg(debug_assertions)]
        if std::env::var("VOXEL_PHYSICS_DEBUG").is_ok() {
            app.add_plugins(PhysicsDebugPlugin::default());
        }

        app.insert_resource(Gravity(Vec3::new(0.0, -20.0, 0.0)));
        app.insert_resource(PhysicsLengthUnit(1.0));

        app.add_systems(Startup, spawn_world_floor_collider);
        app.add_systems(
            Update,
            (generate_chunk_colliders, handle_chunk_modification),
        );
    }
}

fn spawn_world_floor_collider(mut commands: Commands, bounds: Res<WorldBounds>) {
    let width = (bounds.horizontal_max.x - bounds.horizontal_min.x + 1) as f32;
    let depth = (bounds.horizontal_max.y - bounds.horizontal_min.y + 1) as f32;
    let height = bounds.min_breakable_y.max(1) as f32;
    let center = Vec3::new(
        (bounds.horizontal_min.x + bounds.horizontal_max.x + 1) as f32 * 0.5,
        height * 0.5,
        (bounds.horizontal_min.y + bounds.horizontal_max.y + 1) as f32 * 0.5,
    );

    commands.spawn((
        WorldFloorCollider,
        RigidBody::Static,
        Collider::cuboid(width, height, depth),
        Transform::from_translation(center),
        GlobalTransform::default(),
        CollisionLayers::new(PhysicsLayer::Terrain, PhysicsLayer::terrain_mask()),
    ));
}
