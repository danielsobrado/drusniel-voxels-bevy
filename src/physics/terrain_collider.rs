use avian3d::prelude::*;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::camera::controller::PlayerCamera;
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::physics::PhysicsLayer;

const TERRAIN_COLLIDER_VOXEL_SIZE: f32 = 1.0;
const TERRAIN_COLLIDER_MARGIN: f32 = 0.05;
/// Maximum colliders generated per frame to avoid gameplay hitching during terrain LOD churn.
const MAX_COLLIDERS_PER_FRAME: usize = 2;
use crate::voxel::meshing::ChunkMesh;

/// Marker for chunks that need collider generation.
#[derive(Component)]
pub struct NeedsCollider;

/// Marker for chunks with active colliders.
#[derive(Component)]
pub struct ChunkCollider;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerrainColliderMode {
    Auto,
    Trimesh,
    Voxelized,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GeneratedColliderKind {
    Trimesh,
    Voxelized,
}

fn terrain_collider_mode() -> TerrainColliderMode {
    match std::env::var("VOXEL_TERRAIN_COLLIDER")
        .unwrap_or_else(|_| "auto".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "trimesh" => TerrainColliderMode::Trimesh,
        "voxelized" => TerrainColliderMode::Voxelized,
        _ => TerrainColliderMode::Auto,
    }
}

fn build_terrain_collider(
    mesh: &Mesh,
    _chunk_mesh: &ChunkMesh,
    mode: TerrainColliderMode,
) -> Option<(Collider, GeneratedColliderKind)> {
    let trimesh = || {
        Collider::trimesh_from_mesh_with_config(mesh, TrimeshFlags::FIX_INTERNAL_EDGES)
            .map(|collider| (collider, GeneratedColliderKind::Trimesh))
    };
    let voxelized = || {
        Collider::voxelized_trimesh_from_mesh(
            mesh,
            TERRAIN_COLLIDER_VOXEL_SIZE,
            FillMode::SurfaceOnly,
        )
        .map(|collider| (collider, GeneratedColliderKind::Voxelized))
    };

    match mode {
        TerrainColliderMode::Trimesh => trimesh(),
        TerrainColliderMode::Voxelized => voxelized().or_else(trimesh),
        TerrainColliderMode::Auto => voxelized().or_else(trimesh),
    }
}

/// System to generate trimesh colliders for terrain chunks.
/// Throttled to MAX_COLLIDERS_PER_FRAME per frame, sorted nearest-to-camera first.
pub fn generate_chunk_colliders(
    mut commands: Commands,
    chunks: Query<
        (Entity, &Mesh3d, &Transform, &ChunkMesh),
        (With<ChunkMesh>, With<NeedsCollider>),
    >,
    meshes: Res<Assets<Mesh>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    camera_query: Query<&Transform, (With<PlayerCamera>, Without<ChunkMesh>)>,
) {
    let mode = terrain_collider_mode();
    let (pending_count, generated, generated_trimesh, generated_voxelized) = {
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

        let pending_count = pending.len();
        let mut generated = 0usize;
        let mut generated_trimesh = 0usize;
        let mut generated_voxelized = 0usize;
        for (entity, mesh_handle, _transform, chunk_mesh) in pending {
            if generated >= MAX_COLLIDERS_PER_FRAME {
                break;
            }

            let Some(mesh) = meshes.get(&mesh_handle.0) else {
                // Mesh not yet available in asset system - will retry next frame
                // (NeedsCollider stays on the entity)
                trace!("Collider gen deferred for {:?} - mesh not ready", entity);
                continue;
            };

            let collider = build_terrain_collider(mesh, chunk_mesh, mode);

            if let Some((collider, collider_kind)) = collider {
                // Use regular commands (not queue_silenced) so Avian's observers
                // can detect the collider change and sync physics state properly
                commands.entity(entity).try_insert((
                    RigidBody::Static,
                    collider,
                    CollisionMargin(TERRAIN_COLLIDER_MARGIN),
                    CollisionLayers::new(PhysicsLayer::Terrain, PhysicsLayer::terrain_mask()),
                    ChunkCollider,
                ));
                commands.entity(entity).remove::<NeedsCollider>();
                match collider_kind {
                    GeneratedColliderKind::Trimesh => generated_trimesh += 1,
                    GeneratedColliderKind::Voxelized => generated_voxelized += 1,
                }
                trace!("Generated collider for chunk {:?}", entity);
            } else {
                warn!("Failed to generate terrain collider for chunk {:?}", entity);
                commands.entity(entity).remove::<NeedsCollider>();
            }

            generated += 1;
        }

        (
            pending_count,
            generated,
            generated_trimesh,
            generated_voxelized,
        )
    };

    timing.record_count(frame.0, "Terrain Colliders Pending", pending_count as f64);
    timing.record_count(frame.0, "Terrain Colliders Generated", generated as f64);
    timing.record_count(
        frame.0,
        "Terrain Colliders Generated Trimesh",
        generated_trimesh as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Colliders Generated Voxelized",
        generated_voxelized as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collider Mode Trimesh",
        (mode == TerrainColliderMode::Trimesh) as u8 as f64,
    );
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
        commands.entity(entity).try_insert(NeedsCollider);
    }
}
