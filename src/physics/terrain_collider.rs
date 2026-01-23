use avian3d::prelude::*;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::physics::PhysicsLayer;
use crate::performance::{AreaTimingRecorder, area_timer};

const TERRAIN_COLLIDER_VOXEL_SIZE: f32 = 1.0;
const TERRAIN_COLLIDER_MARGIN: f32 = 0.05;
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
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Collider Build");
    for (entity, mesh_handle) in chunks.iter() {
        let Some(mesh) = meshes.get(&mesh_handle.0) else {
            continue;
        };

        let collider = Collider::voxelized_trimesh_from_mesh(
            mesh,
            TERRAIN_COLLIDER_VOXEL_SIZE,
            FillMode::SurfaceOnly,
        )
        .or_else(|| Collider::trimesh_from_mesh_with_config(mesh, TrimeshFlags::FIX_INTERNAL_EDGES));

        if let Some(collider) = collider {
            // Use regular commands (not queue_silenced) so Avian's observers
            // can detect the collider change and sync physics state properly
            commands.entity(entity).insert((
                RigidBody::Static,
                collider,
                CollisionMargin(TERRAIN_COLLIDER_MARGIN),
                CollisionLayers::new(PhysicsLayer::Terrain, PhysicsLayer::terrain_mask()),
                ChunkCollider,
            ));
            commands.entity(entity).remove::<NeedsCollider>();
        } else {
            warn!("Failed to generate terrain collider for chunk {:?}", entity);
            commands.entity(entity).remove::<NeedsCollider>();
        }
    }
}

/// System to mark colliders for regeneration when chunk meshes change.
pub fn handle_chunk_modification(
    mut commands: Commands,
    modified_chunks: Query<Entity, (With<ChunkMesh>, Changed<Mesh3d>, With<ChunkCollider>)>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Collider Update");
    for entity in modified_chunks.iter() {
        commands.entity(entity).insert(NeedsCollider);
    }
}
