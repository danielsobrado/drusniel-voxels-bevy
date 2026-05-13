use avian3d::prelude::*;
use bevy::asset::AssetId;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::tasks::{AsyncComputeTaskPool, Task, block_on, poll_once};

use crate::camera::controller::PlayerCamera;
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::physics::PhysicsLayer;
use crate::physics::terrain_collision_cache::TerrainCollisionCache;
use crate::player::{Player, PlayerSpawnState};
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::world::VoxelWorld;
use bevy_mesh::{Indices, VertexAttributeValues};
use std::collections::HashMap;

const TERRAIN_COLLIDER_VOXEL_SIZE: f32 = 1.0;
const TERRAIN_COLLIDER_MARGIN: f32 = 0.05;
const TERRAIN_HEIGHTFIELD_GRID: usize = 9;
const TERRAIN_HEIGHTFIELD_PADDING: f32 = 0.05;
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

#[derive(Component)]
pub struct TerrainColliderBakeTask {
    task: Task<Option<(Collider, GeneratedColliderKind)>>,
    chunk_position: IVec3,
    source_revision: u64,
    mesh_asset_id: AssetId<Mesh>,
}

#[derive(Component, Clone, Copy, Debug, PartialEq, Eq)]
pub struct TerrainCollisionChunk {
    pub chunk: IVec3,
}

#[derive(Component, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TerrainCollisionState {
    #[default]
    Missing,
    Queued,
    Baking,
    Ready,
    Stale,
    Failed,
}

#[derive(Component, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct TerrainCollisionRevision {
    pub source_revision: u64,
    pub baked_revision: u64,
    pub collider_revision: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TerrainCollisionDirtyCause {
    #[default]
    Initial,
    MeshChanged,
    BuildFailed,
    Observed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlayerCollisionReadiness {
    Ready,
    DegradedUsingCurrentColliderPipeline,
    BlockedUnknownSpace,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct TerrainCollisionRecord {
    pub chunk: IVec3,
    pub state: TerrainCollisionState,
    pub source_revision: u64,
    pub queued_revision: u64,
    pub baked_revision: u64,
    pub collider_revision: u64,
    pub last_dirty_cause: TerrainCollisionDirtyCause,
    pub last_collider_kind: Option<GeneratedColliderKind>,
    pub failed_bakes: u64,
    pub stale_bake_drops: u64,
}

impl TerrainCollisionRecord {
    fn revision_component(self) -> TerrainCollisionRevision {
        TerrainCollisionRevision {
            source_revision: self.source_revision,
            baked_revision: self.baked_revision,
            collider_revision: self.collider_revision,
        }
    }
}

#[derive(Resource, Default)]
pub struct TerrainCollisionRegistry {
    chunks: HashMap<IVec3, TerrainCollisionRecord>,
}

#[derive(Default)]
struct TerrainCollisionStateCounts {
    missing: usize,
    queued: usize,
    baking: usize,
    ready: usize,
    stale: usize,
    failed: usize,
    stale_bake_drops: u64,
    failed_bakes: u64,
}

impl TerrainCollisionRegistry {
    pub fn state(&self, chunk: IVec3) -> TerrainCollisionState {
        self.chunks
            .get(&chunk)
            .map(|record| record.state)
            .unwrap_or(TerrainCollisionState::Missing)
    }

    pub fn source_revision(&self, chunk: IVec3) -> u64 {
        self.chunks
            .get(&chunk)
            .map(|record| record.source_revision)
            .unwrap_or(1)
    }

    fn ensure_record(&mut self, chunk: IVec3) -> &mut TerrainCollisionRecord {
        self.chunks
            .entry(chunk)
            .or_insert_with(|| TerrainCollisionRecord {
                chunk,
                source_revision: 1,
                queued_revision: 1,
                ..default()
            })
    }

    fn observe_chunk(&mut self, chunk: IVec3, observed: TerrainCollisionState) {
        let record = self.ensure_record(chunk);
        record.state = observed;
        if observed == TerrainCollisionState::Queued && record.queued_revision == 0 {
            record.queued_revision = record.source_revision;
        }
        if observed == TerrainCollisionState::Stale && record.queued_revision == 0 {
            record.queued_revision = record.source_revision;
        }
    }

    fn mark_queued(
        &mut self,
        chunk: IVec3,
        cause: TerrainCollisionDirtyCause,
    ) -> TerrainCollisionRevision {
        let record = self.ensure_record(chunk);
        if record.state == TerrainCollisionState::Ready {
            record.state = TerrainCollisionState::Stale;
        } else if record.state != TerrainCollisionState::Stale {
            record.state = TerrainCollisionState::Queued;
        }
        record.queued_revision = record.source_revision;
        record.last_dirty_cause = cause;
        record.revision_component()
    }

    fn mark_baking(&mut self, chunk: IVec3) -> TerrainCollisionRevision {
        let record = self.ensure_record(chunk);
        record.state = TerrainCollisionState::Baking;
        record.queued_revision = record.source_revision;
        record.revision_component()
    }

    #[allow(dead_code)]
    fn mark_mesh_changed(&mut self, chunk: IVec3) -> TerrainCollisionRevision {
        let record = self.ensure_record(chunk);
        record.source_revision = record.source_revision.saturating_add(1);
        record.queued_revision = record.source_revision;
        record.state = if record.collider_revision > 0 {
            TerrainCollisionState::Stale
        } else {
            TerrainCollisionState::Queued
        };
        record.last_dirty_cause = TerrainCollisionDirtyCause::MeshChanged;
        record.revision_component()
    }

    fn mark_ready(
        &mut self,
        chunk: IVec3,
        kind: GeneratedColliderKind,
    ) -> TerrainCollisionRevision {
        let record = self.ensure_record(chunk);
        record.baked_revision = record.source_revision;
        record.collider_revision = record.source_revision;
        record.queued_revision = 0;
        record.state = TerrainCollisionState::Ready;
        record.last_collider_kind = Some(kind);
        record.revision_component()
    }

    fn mark_failed(&mut self, chunk: IVec3) -> TerrainCollisionRevision {
        let record = self.ensure_record(chunk);
        record.state = TerrainCollisionState::Failed;
        record.failed_bakes = record.failed_bakes.saturating_add(1);
        record.last_dirty_cause = TerrainCollisionDirtyCause::BuildFailed;
        record.revision_component()
    }

    fn mark_stale_bake_drop(&mut self, chunk: IVec3) -> TerrainCollisionRevision {
        let record = self.ensure_record(chunk);
        record.stale_bake_drops = record.stale_bake_drops.saturating_add(1);
        record.state = if record.collider_revision > 0 {
            TerrainCollisionState::Stale
        } else {
            TerrainCollisionState::Queued
        };
        record.queued_revision = record.source_revision;
        record.revision_component()
    }

    fn counts(&self) -> TerrainCollisionStateCounts {
        let mut counts = TerrainCollisionStateCounts::default();
        for record in self.chunks.values() {
            match record.state {
                TerrainCollisionState::Missing => counts.missing += 1,
                TerrainCollisionState::Queued => counts.queued += 1,
                TerrainCollisionState::Baking => counts.baking += 1,
                TerrainCollisionState::Ready => counts.ready += 1,
                TerrainCollisionState::Stale => counts.stale += 1,
                TerrainCollisionState::Failed => counts.failed += 1,
            }
            counts.stale_bake_drops = counts
                .stale_bake_drops
                .saturating_add(record.stale_bake_drops);
            counts.failed_bakes = counts.failed_bakes.saturating_add(record.failed_bakes);
        }
        counts
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TerrainColliderMode {
    Auto,
    Heightfield,
    Trimesh,
    Voxelized,
    Voxels,
}

#[derive(Resource, Clone, Copy, Debug)]
pub(crate) struct TerrainColliderConfig {
    mode: TerrainColliderMode,
}

impl TerrainColliderConfig {
    pub(super) fn from_env() -> Self {
        Self {
            mode: terrain_collider_mode_from_env(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GeneratedColliderKind {
    Heightfield,
    Trimesh,
    Voxelized,
    Voxels,
}

#[derive(Clone, Debug)]
struct TerrainColliderMeshData {
    positions: Vec<Vec3>,
    indices: Option<Vec<[u32; 3]>>,
}

fn terrain_collider_mode_from_env() -> TerrainColliderMode {
    match std::env::var("VOXEL_TERRAIN_COLLIDER")
        .unwrap_or_else(|_| "auto".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "heightfield" | "rough" => TerrainColliderMode::Heightfield,
        "trimesh" => TerrainColliderMode::Trimesh,
        "voxelized" => TerrainColliderMode::Voxelized,
        "voxels" | "occupancy" | "parry_voxels" => TerrainColliderMode::Voxels,
        _ => TerrainColliderMode::Auto,
    }
}

fn collider_frame_budget(startup_catchup: bool, player_near_pending: bool) -> usize {
    if startup_catchup {
        MAX_STARTUP_COLLIDERS_PER_FRAME
    } else if player_near_pending {
        MAX_PLAYER_NEAR_COLLIDERS_PER_FRAME
    } else {
        MAX_COLLIDERS_PER_FRAME
    }
}

fn build_voxel_terrain_collider_from_coords(
    coords: Vec<IVec3>,
) -> Option<(Collider, GeneratedColliderKind)> {
    if coords.is_empty() {
        return None;
    }
    Some((
        Collider::voxels(Vec3::splat(TERRAIN_COLLIDER_VOXEL_SIZE), &coords),
        GeneratedColliderKind::Voxels,
    ))
}

fn build_terrain_collider(
    mesh: &TerrainColliderMeshData,
    _chunk_mesh: &ChunkMesh,
    mode: TerrainColliderMode,
) -> Option<(Collider, GeneratedColliderKind)> {
    let heightfield = || {
        coarse_heightfield_from_mesh_data(mesh)
            .map(|collider| (collider, GeneratedColliderKind::Heightfield))
    };
    let trimesh = || {
        mesh.indices.as_ref().and_then(|indices| {
            Collider::try_trimesh_with_config(
                mesh.positions.clone(),
                indices.clone(),
                TrimeshFlags::FIX_INTERNAL_EDGES,
            )
            .ok()
            .map(|collider| (collider, GeneratedColliderKind::Trimesh))
        })
    };
    let voxelized = || {
        mesh.indices.as_ref().map(|indices| {
            (
                Collider::voxelized_trimesh(
                    &mesh.positions,
                    indices,
                    TERRAIN_COLLIDER_VOXEL_SIZE,
                    FillMode::SurfaceOnly,
                ),
                GeneratedColliderKind::Voxelized,
            )
        })
    };

    match mode {
        TerrainColliderMode::Heightfield => heightfield().or_else(trimesh),
        TerrainColliderMode::Trimesh => trimesh(),
        TerrainColliderMode::Voxelized => voxelized().or_else(trimesh),
        TerrainColliderMode::Voxels => None,
        TerrainColliderMode::Auto => trimesh().or_else(heightfield).or_else(voxelized),
    }
}

fn extract_terrain_collider_mesh_data(mesh: &Mesh) -> Option<TerrainColliderMeshData> {
    let positions = match mesh.attribute(Mesh::ATTRIBUTE_POSITION)? {
        VertexAttributeValues::Float32(values) => {
            if values.len() % 3 != 0 {
                return None;
            }
            values
                .chunks_exact(3)
                .map(|position| Vec3::new(position[0], position[1], position[2]))
                .collect()
        }
        VertexAttributeValues::Float32x3(values) => values
            .iter()
            .map(|position| Vec3::from_array(*position))
            .collect(),
        _ => return None,
    };

    let indices = mesh.indices().map(|indices| match indices {
        Indices::U16(indices) => indices
            .chunks_exact(3)
            .map(|index| [index[0] as u32, index[1] as u32, index[2] as u32])
            .collect(),
        Indices::U32(indices) => indices
            .chunks_exact(3)
            .map(|index| [index[0], index[1], index[2]])
            .collect(),
    });

    Some(TerrainColliderMeshData { positions, indices })
}

fn coarse_heightfield_from_mesh_data(mesh: &TerrainColliderMeshData) -> Option<Collider> {
    let positions = &mesh.positions;
    if positions.len() < 3 {
        return None;
    }

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for position in positions {
        min = min.min(*position);
        max = max.max(*position);
    }

    let width = (max.x - min.x).max(0.0);
    let depth = (max.z - min.z).max(0.0);
    let height = (max.y - min.y).max(0.0);
    if width <= f32::EPSILON || depth <= f32::EPSILON || height <= f32::EPSILON {
        return None;
    }

    let center = (min + max) * 0.5;
    let mut heights =
        vec![vec![f32::NEG_INFINITY; TERRAIN_HEIGHTFIELD_GRID]; TERRAIN_HEIGHTFIELD_GRID];
    let max_index = (TERRAIN_HEIGHTFIELD_GRID - 1) as f32;

    for position in positions {
        let p = *position;
        let x = (((p.x - min.x) / width) * max_index).round() as usize;
        let z = (((p.z - min.z) / depth) * max_index).round() as usize;
        let height = p.y - center.y + TERRAIN_HEIGHTFIELD_PADDING;

        heights[x][z] = heights[x][z].max(height);
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

/// System to start terrain collider bakes for chunks.
/// Throttled per frame and sorted nearest-to-camera first. The completed bake is
/// applied by `poll_chunk_collider_bakes`, so old colliders stay live while work
/// runs on the async pool.
pub(crate) fn generate_chunk_colliders(
    mut commands: Commands,
    chunks: Query<
        (Entity, &Mesh3d, &Transform, &ChunkMesh),
        (With<NeedsCollider>, Without<TerrainColliderBakeTask>),
    >,
    bake_tasks: Query<(), With<TerrainColliderBakeTask>>,
    meshes: Res<Assets<Mesh>>,
    cache: Res<TerrainCollisionCache>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    config: Res<TerrainColliderConfig>,
    camera_query: Query<&Transform, (With<PlayerCamera>, Without<ChunkMesh>)>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>, Without<ChunkMesh>)>,
    spawn_state: Option<Res<PlayerSpawnState>>,
    mut registry: ResMut<TerrainCollisionRegistry>,
) {
    let mode = config.mode;
    let startup_collider_catchup = spawn_state.is_some_and(|state| state.initial_spawn_pending);
    let (pending_count, spawned, collider_budget, player_near_pending) = {
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
        let collider_budget = collider_frame_budget(startup_collider_catchup, player_near_pending);
        let pending_count = pending.len();
        if pending_count > collider_budget {
            pending.sort_by(|a, b| {
                let da = collider_priority_distance_sq(a.2.translation, priority_pos);
                let db = collider_priority_distance_sq(b.2.translation, priority_pos);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });
        }

        let mut spawned = 0usize;
        for (entity, mesh_handle, _transform, chunk_mesh) in pending {
            if spawned >= collider_budget {
                break;
            }
            let queued_revision = registry.mark_queued(
                chunk_mesh.chunk_position,
                TerrainCollisionDirtyCause::Initial,
            );

            let cached_voxel_coords = if mode == TerrainColliderMode::Voxels {
                let Some(cached) = cache
                    .get(chunk_mesh.chunk_position)
                    .filter(|cached| cached.source_revision == queued_revision.source_revision)
                else {
                    commands.entity(entity).try_insert((
                        TerrainCollisionChunk {
                            chunk: chunk_mesh.chunk_position,
                        },
                        TerrainCollisionState::Queued,
                        queued_revision,
                    ));
                    trace!(
                        "Collider gen deferred for {:?} - collision cache not ready",
                        entity
                    );
                    continue;
                };
                Some(cached.occupancy.filled_core_coords().collect::<Vec<_>>())
            } else {
                None
            };

            let mesh = if mode == TerrainColliderMode::Voxels {
                None
            } else {
                let Some(mesh) = meshes.get(&mesh_handle.0) else {
                    // Mesh not yet available in asset system - will retry next frame
                    // (NeedsCollider stays on the entity)
                    commands.entity(entity).try_insert((
                        TerrainCollisionChunk {
                            chunk: chunk_mesh.chunk_position,
                        },
                        TerrainCollisionState::Queued,
                        queued_revision,
                    ));
                    trace!("Collider gen deferred for {:?} - mesh not ready", entity);
                    continue;
                };
                Some(extract_terrain_collider_mesh_data(mesh))
            };

            let Some(cached_voxel_coords) = cached_voxel_coords else {
                if mode == TerrainColliderMode::Voxels {
                    commands.entity(entity).try_insert((
                        TerrainCollisionChunk {
                            chunk: chunk_mesh.chunk_position,
                        },
                        TerrainCollisionState::Queued,
                        queued_revision,
                    ));
                    trace!(
                        "Collider gen deferred for {:?} - voxel coords not ready",
                        entity
                    );
                    continue;
                }
                let mesh = mesh.flatten();
                let baking_revision = registry.mark_baking(chunk_mesh.chunk_position);
                let chunk_mesh = *chunk_mesh;
                let task = AsyncComputeTaskPool::get().spawn(async move {
                    mesh.and_then(|mesh| build_terrain_collider(&mesh, &chunk_mesh, mode))
                });

                commands.entity(entity).try_insert((
                    TerrainColliderBakeTask {
                        task,
                        chunk_position: chunk_mesh.chunk_position,
                        source_revision: baking_revision.source_revision,
                        mesh_asset_id: mesh_handle.0.id(),
                    },
                    TerrainCollisionChunk {
                        chunk: chunk_mesh.chunk_position,
                    },
                    TerrainCollisionState::Baking,
                    baking_revision,
                ));
                spawned += 1;
                trace!("Spawned terrain collider bake for chunk {:?}", entity);
                continue;
            };

            let baking_revision = registry.mark_baking(chunk_mesh.chunk_position);
            let chunk_mesh = *chunk_mesh;
            let task = AsyncComputeTaskPool::get().spawn(async move {
                let voxel_collider = build_voxel_terrain_collider_from_coords(cached_voxel_coords);
                if mode == TerrainColliderMode::Voxels || voxel_collider.is_some() {
                    return voxel_collider;
                }
                mesh.flatten()
                    .and_then(|mesh| build_terrain_collider(&mesh, &chunk_mesh, mode))
            });

            commands.entity(entity).try_insert((
                TerrainColliderBakeTask {
                    task,
                    chunk_position: chunk_mesh.chunk_position,
                    source_revision: baking_revision.source_revision,
                    mesh_asset_id: mesh_handle.0.id(),
                },
                TerrainCollisionChunk {
                    chunk: chunk_mesh.chunk_position,
                },
                TerrainCollisionState::Baking,
                baking_revision,
            ));
            spawned += 1;
            trace!("Spawned terrain collider bake for chunk {:?}", entity);
        }

        (pending_count, spawned, collider_budget, player_near_pending)
    };

    timing.record_count(frame.0, "Terrain Colliders Pending", pending_count as f64);
    timing.record_count(frame.0, "Terrain Collider Bakes Spawned", spawned as f64);
    timing.record_count(
        frame.0,
        "Terrain Collider Bakes In Flight",
        bake_tasks.iter().count() as f64,
    );
    timing.record_count(frame.0, "Terrain Collider Budget", collider_budget as f64);
    timing.record_count(
        frame.0,
        "Terrain Collider Player Near Pending",
        player_near_pending as u8 as f64,
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
    timing.record_count(
        frame.0,
        "Terrain Collider Mode Voxelized",
        (mode == TerrainColliderMode::Voxelized) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collider Mode Voxels",
        (mode == TerrainColliderMode::Voxels) as u8 as f64,
    );
}

pub fn poll_chunk_collider_bakes(
    mut commands: Commands,
    mut bakes: Query<(Entity, &mut TerrainColliderBakeTask, Option<&Mesh3d>)>,
    bake_transforms: Query<&Transform, With<TerrainColliderBakeTask>>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    camera_query: Query<&Transform, (With<PlayerCamera>, Without<ChunkMesh>)>,
    player_query: Query<&Transform, (With<Player>, Without<PlayerCamera>, Without<ChunkMesh>)>,
    spawn_state: Option<Res<PlayerSpawnState>>,
    mut registry: ResMut<TerrainCollisionRegistry>,
) {
    let startup_collider_catchup = spawn_state.is_some_and(|state| state.initial_spawn_pending);
    let camera_pos = camera_query
        .single()
        .map(|t| t.translation)
        .unwrap_or(Vec3::ZERO);
    let priority_pos = player_query
        .single()
        .map(|t| t.translation)
        .unwrap_or(camera_pos);
    let catchup_radius_sq = PLAYER_COLLIDER_CATCHUP_RADIUS * PLAYER_COLLIDER_CATCHUP_RADIUS;
    let player_near_pending = bake_transforms.iter().any(|transform| {
        horizontal_distance_sq(transform.translation, priority_pos) <= catchup_radius_sq
    });
    let collider_budget = collider_frame_budget(startup_collider_catchup, player_near_pending);

    let (
        applied,
        failed,
        stale_drops,
        generated_heightfield,
        generated_trimesh,
        generated_voxelized,
        generated_voxels,
        in_flight,
    ) = {
        let _timer = area_timer(&mut timing, frame.0, "Collider Swap");
        let mut applied = 0usize;
        let mut failed = 0usize;
        let mut stale_drops = 0usize;
        let mut generated_heightfield = 0usize;
        let mut generated_trimesh = 0usize;
        let mut generated_voxelized = 0usize;
        let mut generated_voxels = 0usize;
        let mut in_flight = 0usize;

        for (entity, mut bake, mesh_handle) in bakes.iter_mut() {
            in_flight += 1;
            if applied >= collider_budget {
                continue;
            }

            let Some(result) = block_on(poll_once(&mut bake.task)) else {
                continue;
            };

            let mesh_changed = mesh_handle
                .map(|mesh_handle| mesh_handle.0.id() != bake.mesh_asset_id)
                .unwrap_or(true);
            if mesh_changed || registry.source_revision(bake.chunk_position) != bake.source_revision
            {
                let revision = registry.mark_stale_bake_drop(bake.chunk_position);
                commands.entity(entity).try_insert((
                    TerrainCollisionChunk {
                        chunk: bake.chunk_position,
                    },
                    TerrainCollisionState::Stale,
                    revision,
                ));
                commands.entity(entity).remove::<TerrainColliderBakeTask>();
                stale_drops += 1;
                continue;
            }

            if let Some((collider, collider_kind)) = result {
                let revision = registry.mark_ready(bake.chunk_position, collider_kind);
                commands.entity(entity).try_insert((
                    TerrainCollisionChunk {
                        chunk: bake.chunk_position,
                    },
                    TerrainCollisionState::Ready,
                    revision,
                    RigidBody::Static,
                    collider,
                    CollisionMargin(TERRAIN_COLLIDER_MARGIN),
                    CollisionLayers::new(PhysicsLayer::Terrain, PhysicsLayer::terrain_mask()),
                    ChunkCollider,
                ));
                commands.entity(entity).remove::<NeedsCollider>();
                commands.entity(entity).remove::<TerrainColliderBakeTask>();
                match collider_kind {
                    GeneratedColliderKind::Heightfield => generated_heightfield += 1,
                    GeneratedColliderKind::Trimesh => generated_trimesh += 1,
                    GeneratedColliderKind::Voxelized => generated_voxelized += 1,
                    GeneratedColliderKind::Voxels => generated_voxels += 1,
                }
                applied += 1;
                trace!("Applied baked terrain collider for chunk {:?}", entity);
            } else {
                let revision = registry.mark_failed(bake.chunk_position);
                warn!("Failed to bake terrain collider for chunk {:?}", entity);
                commands.entity(entity).try_insert((
                    TerrainCollisionChunk {
                        chunk: bake.chunk_position,
                    },
                    TerrainCollisionState::Failed,
                    revision,
                ));
                commands.entity(entity).remove::<NeedsCollider>();
                commands.entity(entity).remove::<TerrainColliderBakeTask>();
                failed += 1;
            }
        }

        (
            applied,
            failed,
            stale_drops,
            generated_heightfield,
            generated_trimesh,
            generated_voxelized,
            generated_voxels,
            in_flight,
        )
    };

    timing.record_count(frame.0, "Terrain Colliders Generated", applied as f64);
    timing.record_count(frame.0, "Terrain Collider Swaps Applied", applied as f64);
    timing.record_count(frame.0, "Terrain Collider Swaps Failed", failed as f64);
    timing.record_count(
        frame.0,
        "Terrain Collider Stale Bake Drops Frame",
        stale_drops as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collider Swap Budget",
        collider_budget as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collider Bakes In Flight After Poll",
        in_flight.saturating_sub(applied + failed + stale_drops) as f64,
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
        "Terrain Colliders Generated Voxels",
        generated_voxels as f64,
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

    fn simple_heightfield_mesh() -> Mesh {
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            RenderAssetUsages::default(),
        );
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![[0.0, 0.0, 0.0], [1.0, 0.25, 0.0], [0.0, 0.5, 1.0]],
        );
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
    fn terrain_collider_auto_prefers_trimesh() {
        let mesh = simple_terrain_mesh();
        let mesh_data = extract_terrain_collider_mesh_data(&mesh)
            .expect("expected simple terrain mesh data to extract");
        let chunk_mesh = simple_chunk_mesh();

        let Some((_collider, kind)) =
            build_terrain_collider(&mesh_data, &chunk_mesh, TerrainColliderMode::Auto)
        else {
            panic!("expected simple terrain mesh to produce a collider");
        };

        assert_eq!(kind, GeneratedColliderKind::Trimesh);
    }

    #[test]
    fn terrain_collider_auto_falls_back_to_heightfield_without_indices() {
        let mesh = simple_heightfield_mesh();
        let mesh_data = extract_terrain_collider_mesh_data(&mesh)
            .expect("expected position-only mesh data to extract");
        let chunk_mesh = simple_chunk_mesh();

        let Some((_collider, kind)) =
            build_terrain_collider(&mesh_data, &chunk_mesh, TerrainColliderMode::Auto)
        else {
            panic!("expected position-only terrain mesh to produce a heightfield collider");
        };

        assert_eq!(kind, GeneratedColliderKind::Heightfield);
    }

    #[test]
    fn terrain_collider_mesh_data_ignores_non_collision_attributes() {
        let mesh = simple_terrain_mesh();
        let mesh_data = extract_terrain_collider_mesh_data(&mesh)
            .expect("expected simple terrain mesh data to extract");

        assert_eq!(mesh_data.positions.len(), 3);
        assert_eq!(mesh_data.indices.as_ref().map(Vec::len), Some(1));
    }

    #[test]
    fn voxel_terrain_collider_builds_from_occupied_cells() {
        let Some((_collider, kind)) =
            build_voxel_terrain_collider_from_coords(vec![IVec3::ZERO, IVec3::new(1, 0, 0)])
        else {
            panic!("expected occupied cells to produce a voxel collider");
        };

        assert_eq!(kind, GeneratedColliderKind::Voxels);
        assert!(build_voxel_terrain_collider_from_coords(Vec::new()).is_none());
    }

    #[test]
    fn observed_collision_state_matches_legacy_markers() {
        let collider = ChunkCollider;
        let needs = NeedsCollider;

        assert_eq!(
            observed_collision_state(Some(&collider), None, None),
            TerrainCollisionState::Ready
        );
        assert_eq!(
            observed_collision_state(None, Some(&needs), None),
            TerrainCollisionState::Queued
        );
        assert_eq!(
            observed_collision_state(Some(&collider), Some(&needs), None),
            TerrainCollisionState::Stale
        );
        assert_eq!(
            observed_collision_state(None, Some(&needs), Some(TerrainCollisionState::Baking)),
            TerrainCollisionState::Baking
        );
        assert_eq!(
            observed_collision_state(None, None, Some(TerrainCollisionState::Failed)),
            TerrainCollisionState::Failed
        );
    }

    #[test]
    fn registry_tracks_revision_when_ready_chunk_goes_stale() {
        let mut registry = TerrainCollisionRegistry::default();
        let chunk = IVec3::new(2, 1, 3);

        let ready = registry.mark_ready(chunk, GeneratedColliderKind::Trimesh);
        assert_eq!(ready.source_revision, 1);
        assert_eq!(ready.collider_revision, 1);
        assert_eq!(registry.state(chunk), TerrainCollisionState::Ready);

        let stale = registry.mark_mesh_changed(chunk);
        assert_eq!(stale.source_revision, 2);
        assert_eq!(stale.collider_revision, 1);
        assert_eq!(registry.state(chunk), TerrainCollisionState::Stale);
    }

    #[test]
    fn registry_drops_stale_bake_without_losing_live_collider_revision() {
        let mut registry = TerrainCollisionRegistry::default();
        let chunk = IVec3::new(3, 0, 4);

        registry.mark_ready(chunk, GeneratedColliderKind::Trimesh);
        registry.mark_mesh_changed(chunk);
        let baking = registry.mark_baking(chunk);
        assert_eq!(baking.source_revision, 2);
        assert_eq!(registry.state(chunk), TerrainCollisionState::Baking);

        registry.mark_mesh_changed(chunk);
        let stale = registry.mark_stale_bake_drop(chunk);

        assert_eq!(stale.source_revision, 3);
        assert_eq!(stale.collider_revision, 1);
        assert_eq!(registry.state(chunk), TerrainCollisionState::Stale);
        assert_eq!(registry.counts().stale_bake_drops, 1);
    }

    #[test]
    fn player_readiness_reports_degraded_for_pending_support_ring() {
        let mut registry = TerrainCollisionRegistry::default();
        let chunk = IVec3::new(1, 0, 1);
        for offset in [IVec3::ZERO, IVec3::X, IVec3::NEG_X, IVec3::Z, IVec3::NEG_Z] {
            registry.mark_ready(chunk + offset, GeneratedColliderKind::Trimesh);
        }
        registry.mark_queued(chunk + IVec3::Z, TerrainCollisionDirtyCause::MeshChanged);

        assert_eq!(
            player_collision_readiness(&registry, Vec3::new(16.5, 4.0, 16.5)),
            PlayerCollisionReadiness::DegradedUsingCurrentColliderPipeline
        );
    }
}

pub fn record_terrain_collision_diagnostics(
    mut registry: ResMut<TerrainCollisionRegistry>,
    chunks: Query<(
        &ChunkMesh,
        Option<&ChunkCollider>,
        Option<&NeedsCollider>,
        Option<&TerrainCollisionState>,
    )>,
    player_query: Query<&Transform, (With<Player>, Without<ChunkMesh>)>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    for (chunk_mesh, collider, needs_collider, explicit_state) in chunks.iter() {
        let observed = observed_collision_state(collider, needs_collider, explicit_state.copied());
        registry.observe_chunk(chunk_mesh.chunk_position, observed);
    }

    let counts = registry.counts();
    timing.record_count(
        frame.0,
        "Terrain Collision State Missing",
        counts.missing as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collision State Queued",
        counts.queued as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collision State Baking",
        counts.baking as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collision State Ready",
        counts.ready as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collision State Stale",
        counts.stale as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collision State Failed",
        counts.failed as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collision Stale Bake Drops",
        counts.stale_bake_drops as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collision Failed Bakes",
        counts.failed_bakes as f64,
    );

    let readiness = player_query
        .single()
        .ok()
        .map(|transform| player_collision_readiness(&registry, transform.translation))
        .unwrap_or(PlayerCollisionReadiness::BlockedUnknownSpace);
    timing.record_count(
        frame.0,
        "Player Collision Readiness Ready",
        (readiness == PlayerCollisionReadiness::Ready) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Player Collision Readiness Degraded",
        (readiness == PlayerCollisionReadiness::DegradedUsingCurrentColliderPipeline) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Player Collision Readiness Blocked",
        (readiness == PlayerCollisionReadiness::BlockedUnknownSpace) as u8 as f64,
    );
}

fn observed_collision_state(
    collider: Option<&ChunkCollider>,
    needs_collider: Option<&NeedsCollider>,
    explicit_state: Option<TerrainCollisionState>,
) -> TerrainCollisionState {
    match (collider.is_some(), needs_collider.is_some(), explicit_state) {
        (_, _, Some(TerrainCollisionState::Failed)) => TerrainCollisionState::Failed,
        (_, _, Some(TerrainCollisionState::Baking)) => TerrainCollisionState::Baking,
        (true, true, _) => TerrainCollisionState::Stale,
        (false, true, _) => TerrainCollisionState::Queued,
        (true, false, _) => TerrainCollisionState::Ready,
        (false, false, Some(state)) => state,
        (false, false, None) => TerrainCollisionState::Missing,
    }
}

fn player_collision_readiness(
    registry: &TerrainCollisionRegistry,
    player_position: Vec3,
) -> PlayerCollisionReadiness {
    const SUPPORT_OFFSETS: [IVec3; 5] =
        [IVec3::ZERO, IVec3::X, IVec3::NEG_X, IVec3::Z, IVec3::NEG_Z];
    let player_block = player_position.floor().as_ivec3();
    let player_chunk = VoxelWorld::world_to_chunk(player_block);
    let mut all_ready = true;
    let mut has_blocking_unknown = false;

    for offset in SUPPORT_OFFSETS {
        match registry.state(player_chunk + offset) {
            TerrainCollisionState::Ready => {}
            TerrainCollisionState::Queued
            | TerrainCollisionState::Baking
            | TerrainCollisionState::Stale => all_ready = false,
            TerrainCollisionState::Missing | TerrainCollisionState::Failed => {
                all_ready = false;
                has_blocking_unknown = true;
            }
        }
    }

    if all_ready {
        PlayerCollisionReadiness::Ready
    } else if has_blocking_unknown {
        PlayerCollisionReadiness::BlockedUnknownSpace
    } else {
        PlayerCollisionReadiness::DegradedUsingCurrentColliderPipeline
    }
}
