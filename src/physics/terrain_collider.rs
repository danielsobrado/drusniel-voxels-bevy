use avian3d::prelude::*;
use bevy::prelude::*;

use crate::physics::PhysicsLayer;
use crate::voxel::meshing::ChunkMesh;

/// Marker for chunks that need collider generation.
#[derive(Component)]
pub struct NeedsCollider;

/// Marker for chunks with active colliders.
#[derive(Component)]
pub struct ChunkCollider;

/// System to generate trimesh colliders for terrain chunks.
pub fn generate_chunk_colliders(
    mut commands: Commands,
    chunks: Query<(Entity, &Mesh3d), (With<ChunkMesh>, With<NeedsCollider>)>,
    meshes: Res<Assets<Mesh>>,
) {
    for (entity, mesh_handle) in chunks.iter() {
        let Some(mesh) = meshes.get(&mesh_handle.0) else {
            continue;
        };

        if let Some(collider) = Collider::trimesh_from_mesh(mesh) {
            commands.entity(entity).insert((
                RigidBody::Static,
                collider,
                CollisionLayers::new(PhysicsLayer::Terrain, PhysicsLayer::terrain_mask()),
                ChunkCollider,
            ));
            commands.entity(entity).remove::<NeedsCollider>();
        } else {
            trace!("Failed to generate trimesh collider for chunk {:?}", entity);
            commands.entity(entity).remove::<NeedsCollider>();
        }
    }
}

/// System to remove and regenerate colliders when chunks are modified.
pub fn handle_chunk_modification(
    mut commands: Commands,
    modified_chunks: Query<Entity, (With<ChunkMesh>, Changed<Mesh3d>, With<ChunkCollider>)>,
) {
    for entity in modified_chunks.iter() {
        commands
            .entity(entity)
            .remove::<Collider>()
            .remove::<ChunkCollider>()
            .insert(NeedsCollider);
    }
}
