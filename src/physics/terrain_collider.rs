use avian3d::prelude::*;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::camera::controller::PlayerCamera;
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::physics::PhysicsLayer;

const TERRAIN_COLLIDER_VOXEL_SIZE: f32 = 1.0;
const TERRAIN_COLLIDER_MARGIN: f32 = 0.05;
/// Maximum colliders generated per frame to avoid spikes (matches meshing throttle pattern).
const MAX_COLLIDERS_PER_FRAME: usize = 6;
use crate::voxel::meshing::ChunkMesh;

/// Marker for chunks that need collider generation.
#[derive(Component)]
pub struct NeedsCollider;

/// Marker for chunks with active colliders.
#[derive(Component)]
pub struct ChunkCollider;

/// System to generate trimesh colliders for terrain chunks.
/// Throttled to MAX_COLLIDERS_PER_FRAME per frame, sorted nearest-to-camera first.
pub fn generate_chunk_colliders(
    mut commands: Commands,
    chunks: Query<(Entity, &Mesh3d, &Transform), (With<ChunkMesh>, With<NeedsCollider>)>,
    meshes: Res<Assets<Mesh>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    camera_query: Query<&Transform, (With<PlayerCamera>, Without<ChunkMesh>)>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Collider Build");

    let camera_pos = camera_query
        .single()
        .map(|t| t.translation)
        .unwrap_or(Vec3::ZERO);

    // Collect and sort by distance to camera (nearest first)
    let mut pending: Vec<_> = chunks.iter().collect();
    pending.sort_by(|a, b| {
        let da = a.2.translation.distance_squared(camera_pos);
        let db = b.2.translation.distance_squared(camera_pos);
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut generated = 0usize;
    for (entity, mesh_handle, _transform) in pending {
        if generated >= MAX_COLLIDERS_PER_FRAME {
            break;
        }

        let Some(mesh) = meshes.get(&mesh_handle.0) else {
            // Mesh not yet available in asset system - will retry next frame
            // (NeedsCollider stays on the entity)
            trace!("Collider gen deferred for {:?} - mesh not ready", entity);
            continue;
        };

        let collider = Collider::voxelized_trimesh_from_mesh(
            mesh,
            TERRAIN_COLLIDER_VOXEL_SIZE,
            FillMode::SurfaceOnly,
        )
        .or_else(|| {
            Collider::trimesh_from_mesh_with_config(mesh, TrimeshFlags::FIX_INTERNAL_EDGES)
        });

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
            trace!("Generated collider for chunk {:?}", entity);
        } else {
            warn!("Failed to generate terrain collider for chunk {:?}", entity);
            commands.entity(entity).remove::<NeedsCollider>();
        }

        generated += 1;
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
