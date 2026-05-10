use avian3d::prelude::*;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::camera::controller::PlayerCamera;
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::physics::PhysicsLayer;
use crate::player::{Player, PlayerSpawnState};
use crate::voxel::meshing::ChunkMesh;
use bevy_mesh::VertexAttributeValues;

const TERRAIN_COLLIDER_VOXEL_SIZE: f32 = 1.0;
const TERRAIN_COLLIDER_MARGIN: f32 = 0.05;
const TERRAIN_HEIGHTFIELD_GRID: usize = 9;
const TERRAIN_HEIGHTFIELD_PADDING: f32 = 0.35;
/// Maximum colliders generated per frame during normal idle terrain churn.
const MAX_COLLIDERS_PER_FRAME: usize = 4;
/// Collider budget while the player is near pending terrain.
const MAX_PLAYER_NEAR_COLLIDERS_PER_FRAME: usize = 24;
/// Startup can safely spend more work preparing the local terrain before player release.
const MAX_STARTUP_COLLIDERS_PER_FRAME: usize = 48;
const PLAYER_COLLIDER_CATCHUP_RADIUS: f32 = 128.0;

/// Marker for chunks that need collider generation.
#[derive(Component)]
pub struct NeedsCollider;

/// Marker for chunks with active colliders.
#[derive(Component)]
pub struct ChunkCollider;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerrainColliderMode {
    Auto,
    Heightfield,
    Trimesh,
    Voxelized,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GeneratedColliderKind {
    Heightfield,
    Trimesh,
    Voxelized,
}

fn terrain_collider_mode() -> TerrainColliderMode {
    match std::env::var("VOXEL_TERRAIN_COLLIDER")
        .unwrap_or_else(|_| "auto".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "heightfield" | "rough" => TerrainColliderMode::Heightfield,
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
    let heightfield = || {
        coarse_heightfield_from_mesh(mesh)
            .map(|collider| (collider, GeneratedColliderKind::Heightfield))
    };
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
        TerrainColliderMode::Heightfield => heightfield().or_else(trimesh),
        TerrainColliderMode::Trimesh => trimesh(),
        TerrainColliderMode::Voxelized => voxelized().or_else(trimesh),
        TerrainColliderMode::Auto => heightfield().or_else(trimesh).or_else(voxelized),
    }
}

fn coarse_heightfield_from_mesh(mesh: &Mesh) -> Option<Collider> {
    let Some(VertexAttributeValues::Float32x3(positions)) = mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return None;
    };
    if positions.len() < 3 {
        return None;
    }

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for position in positions {
        let p = Vec3::from_array(*position);
        min = min.min(p);
        max = max.max(p);
    }

    let width = (max.x - min.x).max(0.0);
    let depth = (max.z - min.z).max(0.0);
    let height = (max.y - min.y).max(0.0);
    if width <= f32::EPSILON || depth <= f32::EPSILON || height <= f32::EPSILON {
        return None;
    }

    let center = (min + max) * 0.5;
    let mut heights = vec![vec![f32::NEG_INFINITY; TERRAIN_HEIGHTFIELD_GRID]; TERRAIN_HEIGHTFIELD_GRID];
    let max_index = (TERRAIN_HEIGHTFIELD_GRID - 1) as f32;

    for position in positions {
        let p = Vec3::from_array(*position);
        let x = (((p.x - min.x) / width) * max_index).round() as usize;
        let z = (((p.z - min.z) / depth) * max_index).round() as usize;
        let height = p.y - center.y + TERRAIN_HEIGHTFIELD_PADDING;

        let x_min = x.saturating_sub(1);
        let x_max = (x + 1).min(TERRAIN_HEIGHTFIELD_GRID - 1);
        let z_min = z.saturating_sub(1);
        let z_max = (z + 1).min(TERRAIN_HEIGHTFIELD_GRID - 1);
        for row in heights.iter_mut().take(x_max + 1).skip(x_min) {
            for cell in row.iter_mut().take(z_max + 1).skip(z_min) {
                *cell = (*cell).max(height);
            }
        }
    }

    let fallback_height = max.y - center.y + TERRAIN_HEIGHTFIELD_PADDING;
    for row in &mut heights {
        for height in row {
            if !height.is_finite() {
                *height = fallback_height;
            }
        }
    }

    let heightfield = Collider::heightfield(heights, Vec3::new(width, 1.0, depth));
    Some(Collider::compound(vec![(
        Vec3::new(center.x, center.y, center.z),
        Quat::IDENTITY,
        heightfield,
    )]))
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
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>, Without<ChunkMesh>)>,
    spawn_state: Option<Res<PlayerSpawnState>>,
) {
    let mode = terrain_collider_mode();
    let startup_collider_catchup = spawn_state.is_some_and(|state| state.initial_spawn_pending);
    let (
        pending_count,
        generated,
        generated_heightfield,
        generated_trimesh,
        generated_voxelized,
        collider_budget,
        player_near_pending,
    ) = {
        let _timer = area_timer(&mut timing, frame.0, "Collider Build");

        let camera_pos = camera_query
            .single()
            .map(|t| t.translation)
            .unwrap_or(Vec3::ZERO);
        let priority_pos = player_query
            .single()
            .map(|t| t.translation)
            .unwrap_or(camera_pos);

        // Collect and sort by distance to camera (nearest first)
        let mut pending: Vec<_> = chunks.iter().collect();
        let catchup_radius_sq = PLAYER_COLLIDER_CATCHUP_RADIUS * PLAYER_COLLIDER_CATCHUP_RADIUS;
        let player_near_pending = pending.iter().any(|(_, _, transform, _)| {
            horizontal_distance_sq(transform.translation, priority_pos) <= catchup_radius_sq
        });
        let collider_budget = if startup_collider_catchup {
            MAX_STARTUP_COLLIDERS_PER_FRAME
        } else if player_near_pending {
            MAX_PLAYER_NEAR_COLLIDERS_PER_FRAME
        } else {
            MAX_COLLIDERS_PER_FRAME
        };
        pending.sort_by(|a, b| {
            let da = collider_priority_distance_sq(a.2.translation, priority_pos);
            let db = collider_priority_distance_sq(b.2.translation, priority_pos);
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        });

        let pending_count = pending.len();
        let mut generated = 0usize;
        let mut generated_heightfield = 0usize;
        let mut generated_trimesh = 0usize;
        let mut generated_voxelized = 0usize;
        for (entity, mesh_handle, _transform, chunk_mesh) in pending {
            if generated >= collider_budget {
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
                    GeneratedColliderKind::Heightfield => generated_heightfield += 1,
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
            generated_heightfield,
            generated_trimesh,
            generated_voxelized,
            collider_budget,
            player_near_pending,
        )
    };

    timing.record_count(frame.0, "Terrain Colliders Pending", pending_count as f64);
    timing.record_count(frame.0, "Terrain Colliders Generated", generated as f64);
    timing.record_count(frame.0, "Terrain Collider Budget", collider_budget as f64);
    timing.record_count(
        frame.0,
        "Terrain Collider Player Near Pending",
        player_near_pending as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Colliders Generated Heightfield",
        generated_heightfield as f64,
    );
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
        "Terrain Collider Mode Heightfield",
        (mode == TerrainColliderMode::Heightfield) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collider Mode Trimesh",
        (mode == TerrainColliderMode::Trimesh) as u8 as f64,
    );
}

fn collider_priority_distance_sq(chunk_position: Vec3, priority_pos: Vec3) -> f32 {
    let dx = chunk_position.x - priority_pos.x;
    let dz = chunk_position.z - priority_pos.z;
    let dy = (chunk_position.y - priority_pos.y) * 0.25;
    dx * dx + dz * dz + dy * dy
}

fn horizontal_distance_sq(chunk_position: Vec3, priority_pos: Vec3) -> f32 {
    let dx = chunk_position.x - priority_pos.x;
    let dz = chunk_position.z - priority_pos.z;
    dx * dx + dz * dz
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::triplanar_material::TerrainMaterialQuality;
    use crate::voxel::meshing::MeshMode;
    use bevy::asset::RenderAssetUsages;
    use bevy_mesh::{Indices, PrimitiveTopology};

    fn simple_terrain_mesh() -> Mesh {
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::default(),
        );
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![[0.0, 0.0, 0.0], [1.0, 0.25, 0.0], [0.0, 0.5, 1.0]],
        );
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_NORMAL,
            vec![[0.0, 1.0, 0.0], [0.0, 1.0, 0.0], [0.0, 1.0, 0.0]],
        );
        mesh.insert_indices(Indices::U32(vec![0, 1, 2]));
        mesh
    }

    fn simple_chunk_mesh() -> ChunkMesh {
        ChunkMesh {
            chunk_position: IVec3::ZERO,
            vertex_count: 3,
            triangle_count: 1,
            mesh_mode: MeshMode::SurfaceNets,
            material_quality: TerrainMaterialQuality::FullTriplanar,
        }
    }

    #[test]
    fn terrain_collider_auto_prefers_heightfield() {
        let mesh = simple_terrain_mesh();
        let chunk_mesh = simple_chunk_mesh();

        let Some((_collider, kind)) =
            build_terrain_collider(&mesh, &chunk_mesh, TerrainColliderMode::Auto)
        else {
            panic!("expected simple terrain mesh to produce a collider");
        };

        assert_eq!(kind, GeneratedColliderKind::Heightfield);
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
        commands.entity(entity).try_insert(NeedsCollider);
    }
}
