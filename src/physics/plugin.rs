use avian3d::prelude::*;
use bevy::prelude::*;
use bevy_tnua::prelude::*;
use bevy_tnua_avian3d::*;

use super::terrain_collider::{generate_chunk_colliders, handle_chunk_modification};

pub struct PhysicsPlugin;

impl Plugin for PhysicsPlugin {
    fn build(&self, app: &mut App) {
        app.add_plugins(PhysicsPlugins::default());

        app.add_plugins(TnuaAvian3dPlugin::new(PhysicsSchedule));
        app.add_plugins(TnuaControllerPlugin::new(PhysicsSchedule));

        #[cfg(debug_assertions)]
        if std::env::var("VOXEL_PHYSICS_DEBUG").is_ok() {
            app.add_plugins(PhysicsDebugPlugin::default());
        }

        app.insert_resource(Gravity(Vec3::new(0.0, -20.0, 0.0)));
        app.insert_resource(PhysicsLengthUnit(1.0));

        app.add_systems(
            Update,
            (generate_chunk_colliders, handle_chunk_modification),
        );
    }
}
