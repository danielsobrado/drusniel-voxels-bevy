//! Atomic LOD mesh transaction preparation and commit orchestration.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Instant;

use avian3d::prelude::{Collider, CollisionLayers, CollisionMargin, RigidBody};
use bevy::camera::visibility::RenderLayers;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy_water::water::material::StandardWaterMaterial;

use crate::bench::{BenchForensicsConfig, BenchForensicsMcTransitions, BenchRenderToggles};
use crate::constants::{CHUNK_SIZE_F32, CHUNK_SIZE_I32, WATER_LEVEL};
use crate::physics::{
    ChunkCollider, NeedsCollider, TerrainColliderBakeTask, TerrainCollisionChunk,
    TerrainCollisionState,
};
use crate::rendering::AmbientOcclusionConfig;
use crate::rendering::materials::{VoxelMaterial, WaterMaterial};
use crate::rendering::triplanar_material::{TerrainMaterialQuality, TriplanarMaterialHandle};
use crate::rendering::water_reflection::{REFLECTION_RENDER_LAYER, WATER_MASK_RENDER_LAYER};
use crate::voxel::chunk::{ChunkUniformity, LodLevel, MeshDirtyReason};
use crate::voxel::lod::{
    LodSettings, build_terrain_neighbor_lods, forensics_mesh_mode_override, is_horizon_proxy_lod,
    resolve_terrain_mesh_mode, should_defer_surface_nets_mesh, target_terrain_mesh_mode_for_lod,
    terrain_lod_requires_collider, terrain_material_quality_for_lod,
};
use crate::voxel::mc_transvoxel::{McTransvoxelRuntimeStats, McTransvoxelSettings};
use crate::voxel::meshing::{
    ChunkMesh, ChunkMeshResult, McTransitionForensicsMode, McTriangleSources, MeshForensicsOptions,
    MeshGenerationTimingStats, MeshMode, MeshRequest, MeshSettings, TerrainMeshDebug,
    WaterBodyKind, WaterMesh, WaterMeshDetail, count_missing_in_bounds_boundary_neighbors,
    empty_chunk_has_surface_nets_boundary_surface, generate_chunk_mesh_for_request,
    lod_delta_gt_one_face_mask,
};
use crate::voxel::plugin::{RuntimeChunkStats, WaterMaskProxy};
use crate::voxel::skirt::NeighborLods;
use crate::voxel::types::Voxel;
use crate::voxel::world::{VoxelSample, VoxelWorld};

pub(crate) const MAX_LOD_TRANSACTION_CHUNKS_PER_FRAME: usize = 32;
pub(crate) const MAX_LOD_TRANSACTION_PREPARE_CHUNKS_PER_FRAME: usize = 1;

fn env_flag(name: &str) -> bool {
    std::env::var_os(name).is_some()
}

pub(crate) fn mesh_forensics_options(
    forensics: Option<&BenchForensicsConfig>,
    mc_settings: &McTransvoxelSettings,
) -> MeshForensicsOptions {
    let Some(forensics) = forensics.filter(|config| config.enabled) else {
        return MeshForensicsOptions {
            enabled: mc_settings.debug_triangle_sources,
            mc_transitions: McTransitionForensicsMode::Enabled,
        };
    };
    MeshForensicsOptions {
        enabled: true,
        mc_transitions: match forensics.mc_transitions {
            BenchForensicsMcTransitions::Enabled => McTransitionForensicsMode::Enabled,
            BenchForensicsMcTransitions::DisabledKeepBoundaryRows => {
                McTransitionForensicsMode::DisabledKeepBoundaryRows
            }
        },
    }
}

#[derive(Default)]
struct LodMeshTransactionSelection {
    chunks: Vec<IVec3>,
    component_count: usize,
    deferred_chunks: usize,
    oversize_component_chunks: usize,
}

#[derive(Resource, Default)]
pub(crate) struct LodMeshTransactionState {
    pub(crate) active: Option<LodMeshTransaction>,
}

pub(crate) struct LodMeshTransaction {
    chunks: Vec<IVec3>,
    pending: VecDeque<IVec3>,
    prepared: HashMap<IVec3, PreparedLodChunkCommit>,
}

impl LodMeshTransaction {
    fn new(chunks: Vec<IVec3>) -> Self {
        Self {
            pending: VecDeque::from(chunks.clone()),
            chunks,
            prepared: HashMap::new(),
        }
    }

    fn prepared_len(&self) -> usize {
        self.prepared.len()
    }

    fn pending_len(&self) -> usize {
        self.pending.len()
    }

    fn is_ready_to_commit(&self) -> bool {
        self.prepared.len() == self.chunks.len()
    }
}

pub(crate) struct PreparedLodChunkCommit {
    chunk_pos: IVec3,
    target_mode: MeshMode,
    lod_level: LodLevel,
    terrain_quality: TerrainMaterialQuality,
    terrain_mesh_debug: TerrainMeshDebug,
    solid_mesh_handle: Option<Handle<Mesh>>,
    vertex_count: u32,
    triangle_count: u32,
    mc_triangle_sources: Option<McTriangleSources>,
    water_mesh_handle: Option<Handle<Mesh>>,
    water_vertex_count: u32,
    water_triangle_count: u32,
    water_depth_detail: WaterChunkDepthDetail,
}

enum LodChunkPrepareOutcome {
    Prepared(PreparedLodChunkCommit),
    DeferredForHalo,
    Skipped,
    Stale,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LodMeshTransactionAbortReason {
    PrepareDeferredForHalo,
    PrepareSkipped,
    PrepareStale,
    ValidationMissingChunk,
    ValidationGenerationOrMutationDirty,
    ValidationLodChanged,
    ValidationTargetModeChanged,
    ValidationMeshLodChanged,
    ValidationNoVisibleMeshMismatch,
    ValidationNeighborLodsChanged,
    ValidationMissingBoundaryNeighborsChanged,
    ValidationEmptySurfaceCapChanged,
    MissingPreparedCommit,
    NonLodDirty,
}

pub(crate) fn lod_transaction_abort_reason_count(
    stats: &LodMeshTransactionFrameStats,
    reason: LodMeshTransactionAbortReason,
) -> f64 {
    f64::from(stats.abort_reason == Some(reason))
}

fn lod_commit_no_visible_mesh_skips_context_validation(
    lod_level: LodLevel,
    uniformity: ChunkUniformity,
    empty_surface_neighbor: bool,
) -> bool {
    // True clear commits do not depend on neighbor/cap context. Generated
    // no-visible results still validate the context below before publishing.
    lod_level == LodLevel::Culled
        || uniformity == ChunkUniformity::Solid
        || (uniformity == ChunkUniformity::Empty && !empty_surface_neighbor)
}

#[derive(Default)]
pub(crate) struct LodMeshTransactionFrameStats {
    pub(crate) selected_transactions: usize,
    pub(crate) selected_chunks: usize,
    pub(crate) deferred_chunks: usize,
    pub(crate) oversize_component_chunks: usize,
    pub(crate) pending_chunks: usize,
    pub(crate) prepared_chunks_total: usize,
    pub(crate) prepared_chunks_this_frame: usize,
    pub(crate) committed_chunks: usize,
    pub(crate) aborted_transactions: usize,
    pub(crate) chunks_processed: usize,
    pub(crate) chunks_meshed: u32,
    pub(crate) chunks_skipped: u32,
    pub(crate) skipped_unchanged_chunks: u32,
    pub(crate) terrain_mesh_empty_but_solid_voxels: u32,
    pub(crate) terrain_mesh_boundary_missing_neighbor: u32,
    pub(crate) surface_nets_chunks_deferred_for_halo: u32,
    pub(crate) terrain_mesh_lod_seam_repairs: u32,
    pub(crate) mesh_dirty_generate_us: u64,
    pub(crate) mesh_dirty_apply_us: u64,
    pub(crate) mesh_generation_timing: MeshGenerationTimingStats,
    pub(crate) abort_reason: Option<LodMeshTransactionAbortReason>,
}

const LOD_TRANSACTION_FACE_OFFSETS: [IVec3; 6] = [
    IVec3::new(1, 0, 0),
    IVec3::new(-1, 0, 0),
    IVec3::new(0, 1, 0),
    IVec3::new(0, -1, 0),
    IVec3::new(0, 0, 1),
    IVec3::new(0, 0, -1),
];

fn select_lod_mesh_transaction_chunks(
    dirty_chunks: &[IVec3],
    camera_pos: Option<Vec3>,
    max_chunks: usize,
) -> LodMeshTransactionSelection {
    if dirty_chunks.is_empty() || max_chunks == 0 {
        return LodMeshTransactionSelection::default();
    }

    let mut components = lod_dirty_components(dirty_chunks);
    components.sort_by(|a, b| compare_lod_component_priority(a, b, camera_pos));

    let mut selected = Vec::new();
    let mut component_count = 0usize;
    let mut oversize_component_chunks = 0usize;
    for mut component in components {
        component.sort_by(|a, b| {
            camera_pos
                .map(|camera_pos| compare_dirty_chunk_distance(a, b, camera_pos))
                .unwrap_or_else(|| compare_chunk_pos_lex(*a, *b))
        });

        let component_len = component.len();
        if !selected.is_empty() && selected.len() + component_len > max_chunks {
            break;
        }
        if selected.is_empty() && component_len > max_chunks {
            // A connected LOD component must publish atomically. Bounding this
            // to a partial wave lets adjacent chunks display different LOD
            // generations at the same boundary, which creates visible seams.
            oversize_component_chunks = component_len;
            selected.extend(component);
            component_count += 1;
            break;
        }
        selected.extend(component);
        component_count += 1;
    }

    let deferred_chunks = dirty_chunks.len().saturating_sub(selected.len());
    LodMeshTransactionSelection {
        chunks: selected,
        component_count,
        deferred_chunks,
        oversize_component_chunks,
    }
}

fn lod_dirty_components(dirty_chunks: &[IVec3]) -> Vec<Vec<IVec3>> {
    let dirty_set: HashSet<IVec3> = dirty_chunks.iter().copied().collect();
    let mut visited: HashSet<IVec3> = HashSet::new();
    let mut components = Vec::new();

    for &start in dirty_chunks {
        if !visited.insert(start) {
            continue;
        }

        let mut queue = VecDeque::from([start]);
        let mut component = Vec::new();
        while let Some(pos) = queue.pop_front() {
            component.push(pos);
            for offset in LOD_TRANSACTION_FACE_OFFSETS {
                let neighbor = pos + offset;
                if dirty_set.contains(&neighbor) && visited.insert(neighbor) {
                    queue.push_back(neighbor);
                }
            }
        }
        components.push(component);
    }

    components
}

fn compare_lod_component_priority(
    a: &[IVec3],
    b: &[IVec3],
    camera_pos: Option<Vec3>,
) -> std::cmp::Ordering {
    match camera_pos {
        Some(camera_pos) => lod_component_distance_sq(a, camera_pos)
            .partial_cmp(&lod_component_distance_sq(b, camera_pos))
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.len().cmp(&a.len()))
            .then_with(|| {
                compare_chunk_pos_lex(lod_component_min_pos(a), lod_component_min_pos(b))
            }),
        None => compare_chunk_pos_lex(lod_component_min_pos(a), lod_component_min_pos(b))
            .then_with(|| b.len().cmp(&a.len())),
    }
}

fn lod_component_distance_sq(component: &[IVec3], camera_pos: Vec3) -> f32 {
    component
        .iter()
        .map(|pos| {
            let world_pos =
                VoxelWorld::chunk_to_world(*pos).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
            world_pos.distance_squared(camera_pos)
        })
        .fold(f32::INFINITY, f32::min)
}

fn lod_component_min_pos(component: &[IVec3]) -> IVec3 {
    component
        .iter()
        .copied()
        .min_by(|a, b| compare_chunk_pos_lex(*a, *b))
        .unwrap_or(IVec3::ZERO)
}

fn compare_chunk_pos_lex(a: IVec3, b: IVec3) -> std::cmp::Ordering {
    a.x.cmp(&b.x)
        .then_with(|| a.y.cmp(&b.y))
        .then_with(|| a.z.cmp(&b.z))
}

fn compare_dirty_chunk_distance(a: &IVec3, b: &IVec3, camera_pos: Vec3) -> std::cmp::Ordering {
    let world_a = VoxelWorld::chunk_to_world(*a).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
    let world_b = VoxelWorld::chunk_to_world(*b).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
    let dist_a = world_a.distance_squared(camera_pos);
    let dist_b = world_b.distance_squared(camera_pos);
    dist_a
        .partial_cmp(&dist_b)
        .unwrap_or(std::cmp::Ordering::Equal)
}

/// Compact key over the mesh-determining LOD inputs: target mesh mode, the final
/// (post-promotion) mesh LOD, and the six effective neighbor LODs. Two chunks with
/// the same key and identical voxels produce a byte-identical Surface Nets mesh, so
/// a `NeighborLod`-only re-mesh whose key is unchanged can be skipped.
pub(crate) fn terrain_mesh_dedup_key(
    target_mode: MeshMode,
    mesh_lod_level: LodLevel,
    neighbor_lods: &NeighborLods,
) -> u64 {
    let lod_code = |lod: LodLevel| -> u64 {
        match lod.lod_index() {
            Some(i) => (i as u64) + 1,
            None => 5, // Culled
        }
    };
    let opt_code = |lod: Option<LodLevel>| -> u64 { lod.map(lod_code).unwrap_or(0) };
    let mode_code = match target_mode {
        MeshMode::Blocky => 1,
        MeshMode::SurfaceNets => 2,
        MeshMode::McTransvoxel => 3,
    };
    mode_code
        | (lod_code(mesh_lod_level) << 3)
        | (opt_code(neighbor_lods.neg_x) << 6)
        | (opt_code(neighbor_lods.pos_x) << 9)
        | (opt_code(neighbor_lods.neg_y) << 12)
        | (opt_code(neighbor_lods.pos_y) << 15)
        | (opt_code(neighbor_lods.neg_z) << 18)
        | (opt_code(neighbor_lods.pos_z) << 21)
}

/// True when a chunk dirtied **only** for `NeighborLod` would re-mesh to exactly the
/// mesh it already has â€” same target mode, same post-promotion mesh LOD, same
/// effective neighbor LODs as the last committed mesh. Such a re-mesh is wasted work
/// (a byte-identical result), so the LOD-churn path can drop it from the transaction.
///
/// Mirrors the mesh-producing input resolution in [`prepare_lod_chunk_commit`]; any
/// case it cannot resolve cheaply (unknown uniformity, culled/empty-clear, would
/// defer for halo) returns `false` so the normal path handles it.
#[allow(clippy::too_many_arguments)]
fn lod_churn_chunk_mesh_unchanged(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    bench_forensics: Option<&BenchForensicsConfig>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    mc_settings: &McTransvoxelSettings,
    camera_pos: Option<Vec3>,
) -> bool {
    let Some(chunk) = world.get_chunk(chunk_pos) else {
        return false;
    };
    // Only dedup pure neighbor-LOD churn: voxels (Generation/TerrainMutation) and the
    // chunk's own LOD (Lod) and water (WaterMaterial) must be unchanged.
    if chunk.dirty_reason_flags() != MeshDirtyReason::NeighborLod.bit() {
        return false;
    }
    let Some(stored_key) = chunk.last_terrain_mesh_key() else {
        return false;
    };
    let lod_level = chunk.lod_level();
    if lod_level == LodLevel::Culled {
        return false;
    }
    let uniformity = chunk.uniformity();
    if uniformity == ChunkUniformity::Unknown {
        return false;
    }
    let base_mode = target_terrain_mesh_mode_for_lod(lod_level, mesh_settings, lod_settings);
    let target_mode =
        resolve_terrain_mesh_mode(base_mode, chunk_pos, lod_level, mc_settings, camera_pos);
    let target_mode = forensics_mesh_mode_override(target_mode, bench_forensics);
    let empty_surface_neighbor = uniformity == ChunkUniformity::Empty
        && matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
        && empty_chunk_has_surface_nets_boundary_surface(world, chunk_pos);
    if uniformity == ChunkUniformity::Empty && !empty_surface_neighbor {
        return false;
    }
    let mesh_lod_level = LodLevel::Lod0;
    let missing_boundary_neighbors = count_missing_in_bounds_boundary_neighbors(world, chunk_pos);
    if missing_boundary_neighbors > 0
        && should_defer_surface_nets_mesh(target_mode, missing_boundary_neighbors)
    {
        return false;
    }
    let neighbor_lods = build_terrain_neighbor_lods(world, chunk_pos, mesh_settings, lod_settings);
    terrain_mesh_dedup_key(target_mode, mesh_lod_level, &neighbor_lods) == stored_key
}

#[inline(never)]
pub(crate) fn process_lod_mesh_transaction(
    state: &mut LodMeshTransactionState,
    dirty_chunks: &[IVec3],
    camera_pos: Option<Vec3>,
    commands: &mut Commands,
    world: &mut VoxelWorld,
    meshes: &mut Assets<Mesh>,
    blocky_material: Option<&VoxelMaterial>,
    triplanar_material: &TriplanarMaterialHandle,
    water_material: &WaterMaterial,
    bench_toggles: Option<&BenchRenderToggles>,
    bench_forensics: Option<&BenchForensicsConfig>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    mc_settings: &McTransvoxelSettings,
    ao_config: &AmbientOcclusionConfig,
    runtime_mc_stats: &mut McTransvoxelRuntimeStats,
    chunk_stats: &mut RuntimeChunkStats,
    frame: u32,
    timing_enabled: bool,
) -> LodMeshTransactionFrameStats {
    let mut frame_stats = LodMeshTransactionFrameStats::default();

    if state.active.is_none() {
        // Dedup pass: drop pure NeighborLod churn whose mesh inputs are unchanged so
        // the transaction only re-meshes chunks that actually changed. This is the
        // dominant source of the LOD-churn backlog (one LOD change halo-dirties six
        // neighbors, most of which would re-mesh to an identical result).
        let mut changed_chunks: Vec<IVec3> = Vec::with_capacity(dirty_chunks.len());
        for &chunk_pos in dirty_chunks {
            if lod_churn_chunk_mesh_unchanged(
                world,
                chunk_pos,
                bench_forensics,
                mesh_settings,
                lod_settings,
                mc_settings,
                camera_pos,
            ) {
                if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                    chunk.clear_dirty();
                }
                frame_stats.skipped_unchanged_chunks += 1;
            } else {
                changed_chunks.push(chunk_pos);
            }
        }
        let selection = select_lod_mesh_transaction_chunks(
            &changed_chunks,
            camera_pos,
            MAX_LOD_TRANSACTION_CHUNKS_PER_FRAME,
        );
        frame_stats.selected_transactions = selection.component_count;
        frame_stats.selected_chunks = selection.chunks.len();
        frame_stats.deferred_chunks = selection.deferred_chunks;
        frame_stats.oversize_component_chunks = selection.oversize_component_chunks;
        if selection.chunks.is_empty() {
            return frame_stats;
        }
        state.active = Some(LodMeshTransaction::new(selection.chunks));
    }

    let mut abort_transaction = false;
    if let Some(transaction) = state.active.as_mut() {
        while frame_stats.prepared_chunks_this_frame < MAX_LOD_TRANSACTION_PREPARE_CHUNKS_PER_FRAME
        {
            let Some(chunk_pos) = transaction.pending.pop_front() else {
                break;
            };
            frame_stats.chunks_processed += 1;
            match prepare_lod_chunk_commit(
                world,
                meshes,
                chunk_pos,
                frame,
                camera_pos,
                blocky_material.is_some(),
                bench_toggles,
                bench_forensics,
                mesh_settings,
                lod_settings,
                mc_settings,
                ao_config,
                runtime_mc_stats,
                chunk_stats,
                &mut frame_stats,
                timing_enabled,
            ) {
                LodChunkPrepareOutcome::Prepared(commit) => {
                    transaction.prepared.insert(chunk_pos, commit);
                    frame_stats.prepared_chunks_this_frame += 1;
                }
                LodChunkPrepareOutcome::DeferredForHalo => {
                    abort_transaction = true;
                    frame_stats.abort_reason =
                        Some(LodMeshTransactionAbortReason::PrepareDeferredForHalo);
                    break;
                }
                LodChunkPrepareOutcome::Skipped => {
                    abort_transaction = true;
                    frame_stats.abort_reason = Some(LodMeshTransactionAbortReason::PrepareSkipped);
                    break;
                }
                LodChunkPrepareOutcome::Stale => {
                    abort_transaction = true;
                    frame_stats.abort_reason = Some(LodMeshTransactionAbortReason::PrepareStale);
                    break;
                }
            }
        }
        frame_stats.pending_chunks = transaction.pending_len();
        frame_stats.prepared_chunks_total = transaction.prepared_len();
    }

    if abort_transaction {
        if let Some(transaction) = state.active.take() {
            discard_lod_mesh_transaction(transaction, meshes);
        }
        frame_stats.aborted_transactions = 1;
        return frame_stats;
    }

    let ready_to_commit = state
        .active
        .as_ref()
        .is_some_and(LodMeshTransaction::is_ready_to_commit);
    if ready_to_commit {
        let mut transaction = state.active.take().expect("transaction existed above");
        if let Some(reason) = transaction.prepared.values().find_map(|commit| {
            prepared_lod_commit_stale_reason(
                commit,
                world,
                camera_pos,
                bench_forensics,
                mesh_settings,
                lod_settings,
                mc_settings,
            )
        }) {
            discard_lod_mesh_transaction(transaction, meshes);
            frame_stats.aborted_transactions = 1;
            frame_stats.abort_reason = Some(reason);
            return frame_stats;
        }
        for chunk_pos in transaction.chunks {
            let Some(commit) = transaction.prepared.remove(&chunk_pos) else {
                frame_stats.aborted_transactions = 1;
                frame_stats.abort_reason =
                    Some(LodMeshTransactionAbortReason::MissingPreparedCommit);
                break;
            };
            apply_prepared_lod_chunk_commit(
                commit,
                commands,
                world,
                blocky_material,
                triplanar_material,
                water_material,
                chunk_stats,
                &mut frame_stats,
            );
        }
        frame_stats.committed_chunks = frame_stats
            .chunks_meshed
            .saturating_add(frame_stats.chunks_skipped)
            as usize;
        frame_stats.pending_chunks = 0;
        frame_stats.prepared_chunks_total = 0;
    }

    frame_stats
}

fn prepare_lod_chunk_commit(
    world: &mut VoxelWorld,
    meshes: &mut Assets<Mesh>,
    chunk_pos: IVec3,
    frame: u32,
    camera_pos: Option<Vec3>,
    blocky_material_available: bool,
    bench_toggles: Option<&BenchRenderToggles>,
    bench_forensics: Option<&BenchForensicsConfig>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    mc_settings: &McTransvoxelSettings,
    ao_config: &AmbientOcclusionConfig,
    runtime_mc_stats: &mut McTransvoxelRuntimeStats,
    chunk_stats: &mut RuntimeChunkStats,
    frame_stats: &mut LodMeshTransactionFrameStats,
    timing_enabled: bool,
) -> LodChunkPrepareOutcome {
    let dirty_flags = if let Some(chunk) = world.get_chunk(chunk_pos) {
        chunk.dirty_reason_flags()
    } else {
        return LodChunkPrepareOutcome::Stale;
    };
    if dirty_flags & MeshDirtyReason::Generation.bit() != 0
        || dirty_flags & MeshDirtyReason::TerrainMutation.bit() != 0
    {
        return LodChunkPrepareOutcome::Stale;
    }

    if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
        if chunk.uniformity() == ChunkUniformity::Unknown {
            chunk.compute_uniformity();
        }
    }

    let (target_mode, lod_level, uniformity) = if let Some(chunk) = world.get_chunk(chunk_pos) {
        let base_mode =
            target_terrain_mesh_mode_for_lod(chunk.lod_level(), mesh_settings, lod_settings);
        let target_mode = resolve_terrain_mesh_mode(
            base_mode,
            chunk_pos,
            chunk.lod_level(),
            mc_settings,
            camera_pos,
        );
        let target_mode = forensics_mesh_mode_override(target_mode, bench_forensics);
        (target_mode, chunk.lod_level(), chunk.uniformity())
    } else {
        return LodChunkPrepareOutcome::Stale;
    };

    if lod_level == LodLevel::Culled {
        return LodChunkPrepareOutcome::Prepared(PreparedLodChunkCommit::clear_for_chunk(
            chunk_pos,
            lod_level,
            target_mode,
            LodLevel::Culled,
            NeighborLods::default(),
            0,
            false,
            frame,
        ));
    }

    let empty_surface_neighbor = uniformity == ChunkUniformity::Empty
        && matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
        && empty_chunk_has_surface_nets_boundary_surface(world, chunk_pos);
    let mesh_lod_level = LodLevel::Lod0;

    if uniformity == ChunkUniformity::Empty {
        if empty_surface_neighbor {
            frame_stats.terrain_mesh_lod_seam_repairs += 1;
        } else {
            return LodChunkPrepareOutcome::Prepared(PreparedLodChunkCommit::clear_for_chunk(
                chunk_pos,
                lod_level,
                target_mode,
                mesh_lod_level,
                NeighborLods::default(),
                0,
                false,
                frame,
            ));
        }
    }

    let missing_boundary_neighbors = count_missing_in_bounds_boundary_neighbors(world, chunk_pos);
    if missing_boundary_neighbors > 0 {
        frame_stats.terrain_mesh_boundary_missing_neighbor += 1;
        if should_defer_surface_nets_mesh(target_mode, missing_boundary_neighbors) {
            frame_stats.surface_nets_chunks_deferred_for_halo += 1;
            return LodChunkPrepareOutcome::DeferredForHalo;
        }
    }

    if matches!(target_mode, MeshMode::Blocky) && !blocky_material_available {
        return LodChunkPrepareOutcome::Skipped;
    }

    let neighbor_lods = build_terrain_neighbor_lods(world, chunk_pos, mesh_settings, lod_settings);
    let mesh_start = Instant::now();
    let mesh_result = if let Some(chunk) = world.get_chunk(chunk_pos) {
        generate_chunk_mesh_for_request(MeshRequest {
            chunk,
            world,
            mode: target_mode,
            logical_lod: lod_level,
            mesh_lod: mesh_lod_level,
            neighbor_lods,
            ao_config: &ao_config.baked,
            water_exposure_mode: mesh_settings.water_air_exposure_mode,
            forensics: mesh_forensics_options(bench_forensics, mc_settings),
            mc_settings: Some(mc_settings),
            timing_enabled,
        })
    } else {
        return LodChunkPrepareOutcome::Stale;
    };
    let mesh_elapsed = mesh_start.elapsed();
    frame_stats.mesh_dirty_generate_us += mesh_elapsed.as_micros() as u64;
    chunk_stats.meshing_time_us += mesh_elapsed.as_micros() as u64;

    let ChunkMeshResult {
        solid,
        water,
        water_stats,
        lod_transition_snap_stats,
        mesh_section_stats,
        mc_transvoxel_stats,
        mc_triangle_sources,
        generation_timing,
    } = mesh_result;
    frame_stats.mesh_generation_timing.add(generation_timing);

    let vertex_count = solid.positions.len() as u32;
    let triangle_count = (solid.indices.len() / 3) as u32;
    if uniformity == ChunkUniformity::Mixed && triangle_count == 0 {
        frame_stats.terrain_mesh_empty_but_solid_voxels += 1;
    }
    record_water_meshing_stats(chunk_stats, water_stats);
    if let Some(stats) = mc_transvoxel_stats {
        record_mc_transvoxel_generation_stats(runtime_mc_stats, stats);
    }

    let horizon_proxy = is_horizon_proxy_lod(lod_level);
    let water_depth_detail = if water.is_empty() {
        WaterChunkDepthDetail::default()
    } else {
        compute_water_chunk_depth_detail(world, chunk_pos)
    };
    let water_vertex_count = water.positions.len() as u32;
    let water_triangle_count = (water.indices.len() / 3) as u32;
    let solid_mesh_handle = if solid.is_empty() {
        None
    } else {
        Some(meshes.add(solid.into_mesh()))
    };
    let water_mesh_handle = if horizon_proxy || water.is_empty() {
        None
    } else {
        Some(meshes.add(water.into_mesh()))
    };
    let terrain_quality = terrain_material_quality_for_lod(lod_level, bench_toggles);
    let terrain_mesh_debug = TerrainMeshDebug {
        logical_lod_at_mesh: lod_level,
        effective_lod_at_mesh: mesh_lod_level,
        target_mode_at_mesh: target_mode,
        neighbor_lods_at_mesh: neighbor_lods,
        lod_delta_gt_one_face_mask: lod_delta_gt_one_face_mask(lod_level, &neighbor_lods),
        missing_boundary_neighbors_at_mesh: missing_boundary_neighbors,
        empty_surface_cap_at_mesh: empty_surface_neighbor,
        generated_frame: frame,
        lod_transition_snap_stats,
        mesh_section_stats,
        mc_transvoxel_stats,
    };

    LodChunkPrepareOutcome::Prepared(PreparedLodChunkCommit {
        chunk_pos,
        target_mode,
        lod_level,
        terrain_quality,
        terrain_mesh_debug,
        solid_mesh_handle,
        vertex_count,
        triangle_count,
        mc_triangle_sources,
        water_mesh_handle,
        water_vertex_count,
        water_triangle_count,
        water_depth_detail,
    })
}

impl PreparedLodChunkCommit {
    #[cfg(test)]
    fn clear(chunk_pos: IVec3) -> Self {
        Self::clear_for_chunk(
            chunk_pos,
            LodLevel::Culled,
            MeshMode::SurfaceNets,
            LodLevel::Culled,
            NeighborLods::default(),
            0,
            false,
            0,
        )
    }

    fn clear_for_chunk(
        chunk_pos: IVec3,
        lod_level: LodLevel,
        target_mode: MeshMode,
        mesh_lod_level: LodLevel,
        neighbor_lods: NeighborLods,
        missing_boundary_neighbors: u32,
        empty_surface_neighbor: bool,
        frame: u32,
    ) -> Self {
        Self {
            chunk_pos,
            target_mode,
            lod_level,
            terrain_quality: TerrainMaterialQuality::FullTriplanar,
            terrain_mesh_debug: TerrainMeshDebug {
                logical_lod_at_mesh: lod_level,
                effective_lod_at_mesh: mesh_lod_level,
                target_mode_at_mesh: target_mode,
                neighbor_lods_at_mesh: neighbor_lods,
                lod_delta_gt_one_face_mask: lod_delta_gt_one_face_mask(lod_level, &neighbor_lods),
                missing_boundary_neighbors_at_mesh: missing_boundary_neighbors,
                empty_surface_cap_at_mesh: empty_surface_neighbor,
                generated_frame: frame,
                lod_transition_snap_stats: Default::default(),
                mesh_section_stats: Default::default(),
                mc_transvoxel_stats: None,
            },
            solid_mesh_handle: None,
            vertex_count: 0,
            triangle_count: 0,
            mc_triangle_sources: None,
            water_mesh_handle: None,
            water_vertex_count: 0,
            water_triangle_count: 0,
            water_depth_detail: WaterChunkDepthDetail::default(),
        }
    }
}

fn prepared_lod_commit_stale_reason(
    commit: &PreparedLodChunkCommit,
    world: &VoxelWorld,
    camera_pos: Option<Vec3>,
    bench_forensics: Option<&BenchForensicsConfig>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    mc_settings: &McTransvoxelSettings,
) -> Option<LodMeshTransactionAbortReason> {
    let Some(chunk) = world.get_chunk(commit.chunk_pos) else {
        return Some(LodMeshTransactionAbortReason::ValidationMissingChunk);
    };
    let dirty_flags = chunk.dirty_reason_flags();
    if dirty_flags & MeshDirtyReason::Generation.bit() != 0
        || dirty_flags & MeshDirtyReason::TerrainMutation.bit() != 0
    {
        return Some(LodMeshTransactionAbortReason::ValidationGenerationOrMutationDirty);
    }

    let lod_level = chunk.lod_level();
    if lod_level != commit.lod_level {
        return Some(LodMeshTransactionAbortReason::ValidationLodChanged);
    }

    let base_mode = target_terrain_mesh_mode_for_lod(lod_level, mesh_settings, lod_settings);
    let target_mode = resolve_terrain_mesh_mode(
        base_mode,
        commit.chunk_pos,
        lod_level,
        mc_settings,
        camera_pos,
    );
    let target_mode = forensics_mesh_mode_override(target_mode, bench_forensics);
    if target_mode != commit.target_mode {
        return Some(LodMeshTransactionAbortReason::ValidationTargetModeChanged);
    }

    let uniformity = chunk.uniformity();
    let empty_surface_neighbor = uniformity == ChunkUniformity::Empty
        && matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
        && empty_chunk_has_surface_nets_boundary_surface(world, commit.chunk_pos);
    let mesh_lod_level = LodLevel::Lod0;
    let current_neighbor_lods =
        build_terrain_neighbor_lods(world, commit.chunk_pos, mesh_settings, lod_settings);
    if mesh_lod_level != commit.terrain_mesh_debug.effective_lod_at_mesh {
        return Some(LodMeshTransactionAbortReason::ValidationMeshLodChanged);
    }

    let has_visible_mesh = commit.solid_mesh_handle.is_some() || commit.water_mesh_handle.is_some();
    if !has_visible_mesh
        && lod_commit_no_visible_mesh_skips_context_validation(
            lod_level,
            uniformity,
            empty_surface_neighbor,
        )
    {
        return None;
    }

    if !neighbor_lods_match(
        current_neighbor_lods,
        commit.terrain_mesh_debug.neighbor_lods_at_mesh,
    ) {
        return Some(LodMeshTransactionAbortReason::ValidationNeighborLodsChanged);
    }
    if count_missing_in_bounds_boundary_neighbors(world, commit.chunk_pos)
        != commit.terrain_mesh_debug.missing_boundary_neighbors_at_mesh
    {
        return Some(LodMeshTransactionAbortReason::ValidationMissingBoundaryNeighborsChanged);
    }
    if empty_surface_neighbor != commit.terrain_mesh_debug.empty_surface_cap_at_mesh {
        return Some(LodMeshTransactionAbortReason::ValidationEmptySurfaceCapChanged);
    }
    None
}

fn neighbor_lods_match(a: NeighborLods, b: NeighborLods) -> bool {
    a.neg_x == b.neg_x
        && a.pos_x == b.pos_x
        && a.neg_y == b.neg_y
        && a.pos_y == b.pos_y
        && a.neg_z == b.neg_z
        && a.pos_z == b.pos_z
}

pub(crate) fn discard_lod_mesh_transaction(
    transaction: LodMeshTransaction,
    meshes: &mut Assets<Mesh>,
) {
    for commit in transaction.prepared.into_values() {
        discard_prepared_lod_chunk_commit(commit, meshes);
    }
}

fn discard_prepared_lod_chunk_commit(commit: PreparedLodChunkCommit, meshes: &mut Assets<Mesh>) {
    if let Some(handle) = commit.solid_mesh_handle {
        meshes.remove(handle.id());
    }
    if let Some(handle) = commit.water_mesh_handle {
        meshes.remove(handle.id());
    }
}

fn record_water_meshing_stats(
    chunk_stats: &mut RuntimeChunkStats,
    stats: crate::voxel::meshing::WaterMeshingStats,
) {
    chunk_stats.water_air_boundaries_total += stats.air_boundaries_total as u64;
    chunk_stats.water_air_boundaries_exposed += stats.air_boundaries_exposed as u64;
    chunk_stats.water_air_boundaries_sealed += stats.air_boundaries_sealed as u64;
    chunk_stats.water_triangles_removed_sealed += stats.triangles_removed_sealed as u64;
    chunk_stats.invalid_water_meshes_suppressed += stats.invalid_meshes_suppressed as u64;
    chunk_stats.edge_water_faces_suppressed += stats.edge_water_faces_suppressed as u64;
    chunk_stats.water_flood_fill_boundary_hits += stats.flood_fill_boundary_hits as u64;
    chunk_stats.water_exposure_outside_world_rejected +=
        stats.exposure_outside_world_rejected as u64;
}

fn record_mc_transvoxel_generation_stats(
    runtime_stats: &mut McTransvoxelRuntimeStats,
    stats: crate::voxel::mc_transvoxel::McTransvoxelStats,
) {
    runtime_stats.chunks_meshed_this_frame += 1;
    runtime_stats.aggregated.regular_chunks_meshed = runtime_stats
        .aggregated
        .regular_chunks_meshed
        .saturating_add(stats.regular_chunks_meshed);
    for (dst, src) in runtime_stats
        .aggregated
        .transition_faces_meshed
        .iter_mut()
        .zip(stats.transition_faces_meshed)
    {
        *dst = dst.saturating_add(src);
    }
    runtime_stats.aggregated.transition_triangles_total = runtime_stats
        .aggregated
        .transition_triangles_total
        .saturating_add(stats.transition_triangles_total);
    runtime_stats.aggregated.skipped_lod_delta_gt_one = runtime_stats
        .aggregated
        .skipped_lod_delta_gt_one
        .saturating_add(stats.skipped_lod_delta_gt_one);
    runtime_stats.aggregated.skipped_missing_neighbor = runtime_stats
        .aggregated
        .skipped_missing_neighbor
        .saturating_add(stats.skipped_missing_neighbor);
    runtime_stats.aggregated.mesh_generation_ms_total += stats.mesh_generation_ms_total;
    runtime_stats.aggregated.triangle_count_regular = runtime_stats
        .aggregated
        .triangle_count_regular
        .saturating_add(stats.triangle_count_regular);
    runtime_stats.aggregated.triangle_count_transition = runtime_stats
        .aggregated
        .triangle_count_transition
        .saturating_add(stats.triangle_count_transition);
}

#[inline(never)]
fn apply_prepared_lod_chunk_commit(
    commit: PreparedLodChunkCommit,
    commands: &mut Commands,
    world: &mut VoxelWorld,
    blocky_material: Option<&VoxelMaterial>,
    triplanar_material: &TriplanarMaterialHandle,
    water_material: &WaterMaterial,
    chunk_stats: &mut RuntimeChunkStats,
    frame_stats: &mut LodMeshTransactionFrameStats,
) {
    let PreparedLodChunkCommit {
        chunk_pos,
        target_mode,
        lod_level,
        terrain_quality,
        terrain_mesh_debug,
        solid_mesh_handle,
        vertex_count,
        triangle_count,
        mc_triangle_sources,
        water_mesh_handle,
        water_vertex_count,
        water_triangle_count,
        water_depth_detail,
    } = commit;

    if matches!(target_mode, MeshMode::Blocky) && blocky_material.is_none() {
        frame_stats.chunks_skipped += 1;
        return;
    }

    let apply_start = Instant::now();
    let Some(mut chunk) = world.get_chunk_mut(chunk_pos) else {
        frame_stats.chunks_skipped += 1;
        return;
    };
    chunk.clear_dirty();
    // Record the mesh-determining LOD inputs so a later NeighborLod-only dirty with
    // identical inputs can be skipped (see `lod_churn_chunk_mesh_unchanged`).
    chunk.set_last_terrain_mesh_key(terrain_mesh_dedup_key(
        terrain_mesh_debug.target_mode_at_mesh,
        terrain_mesh_debug.effective_lod_at_mesh,
        &terrain_mesh_debug.neighbor_lods_at_mesh,
    ));

    let world_pos = VoxelWorld::chunk_to_world(chunk_pos);
    let horizon_proxy = is_horizon_proxy_lod(lod_level);
    let needs_collider = terrain_lod_requires_collider(lod_level);
    let chunk_top_y = (chunk_pos.y + 1) * CHUNK_SIZE_I32;
    let terrain_layers = if !horizon_proxy && chunk_top_y > WATER_LEVEL {
        RenderLayers::default().with(REFLECTION_RENDER_LAYER)
    } else {
        RenderLayers::default()
    };
    let had_visible_mesh = solid_mesh_handle.is_some() || water_mesh_handle.is_some();

    if let Some(mesh_handle) = solid_mesh_handle {
        let chunk_mesh = ChunkMesh {
            chunk_position: chunk_pos,
            vertex_count,
            triangle_count,
            mesh_mode: target_mode,
            material_quality: terrain_quality,
        };
        chunk_stats.add_mesh_vertices(vertex_count, lod_level);
        if let Some(entity) = chunk.mesh_entity() {
            match target_mode {
                MeshMode::Blocky => {
                    if let Some(blocky_mat) = blocky_material {
                        commands
                            .entity(entity)
                            .insert((
                                Mesh3d(mesh_handle),
                                MeshMaterial3d(blocky_mat.handle.clone()),
                                chunk_mesh,
                                terrain_mesh_debug,
                            ))
                            .remove::<MeshMaterial3d<
                                crate::rendering::triplanar_material::TriplanarMaterial,
                            >>();
                    }
                }
                MeshMode::SurfaceNets | MeshMode::McTransvoxel => {
                    commands
                        .entity(entity)
                        .insert((
                            Mesh3d(mesh_handle),
                            MeshMaterial3d(triplanar_material.handle_for_quality(terrain_quality)),
                            chunk_mesh,
                            terrain_mesh_debug,
                        ))
                        .remove::<MeshMaterial3d<
                            crate::rendering::blocky_material::BlockyMaterial,
                        >>();
                }
            }
            let mut entity_cmd = commands.entity(entity);
            if needs_collider {
                entity_cmd
                    .insert((NeedsCollider, terrain_layers))
                    .remove::<NotShadowCaster>();
            } else if horizon_proxy {
                entity_cmd
                    .remove::<NeedsCollider>()
                    .remove::<TerrainColliderBakeTask>()
                    .remove::<TerrainCollisionChunk>()
                    .remove::<TerrainCollisionState>()
                    .remove::<RigidBody>()
                    .remove::<Collider>()
                    .remove::<CollisionMargin>()
                    .remove::<CollisionLayers>()
                    .remove::<ChunkCollider>()
                    .insert((NotShadowCaster, terrain_layers));
            } else {
                entity_cmd
                    .remove::<NeedsCollider>()
                    .remove::<TerrainColliderBakeTask>()
                    .remove::<TerrainCollisionChunk>()
                    .remove::<TerrainCollisionState>()
                    .remove::<RigidBody>()
                    .remove::<Collider>()
                    .remove::<CollisionMargin>()
                    .remove::<CollisionLayers>()
                    .remove::<ChunkCollider>()
                    .insert(terrain_layers)
                    .remove::<NotShadowCaster>();
            }
            if let Some(sources) = mc_triangle_sources.clone() {
                entity_cmd.insert(sources);
            } else {
                entity_cmd.remove::<McTriangleSources>();
            }
        } else {
            let entity = match target_mode {
                MeshMode::Blocky => {
                    let Some(blocky_material) = blocky_material else {
                        frame_stats.chunks_skipped += 1;
                        return;
                    };
                    commands
                        .spawn((
                            Mesh3d(mesh_handle),
                            MeshMaterial3d(blocky_material.handle.clone()),
                            Transform::from_xyz(
                                world_pos.x as f32,
                                world_pos.y as f32,
                                world_pos.z as f32,
                            ),
                            chunk_mesh,
                            terrain_mesh_debug,
                            terrain_layers,
                        ))
                        .id()
                }
                MeshMode::SurfaceNets | MeshMode::McTransvoxel => commands
                    .spawn((
                        Mesh3d(mesh_handle),
                        MeshMaterial3d(triplanar_material.handle_for_quality(terrain_quality)),
                        Transform::from_xyz(
                            world_pos.x as f32,
                            world_pos.y as f32,
                            world_pos.z as f32,
                        ),
                        chunk_mesh,
                        terrain_mesh_debug,
                        terrain_layers,
                    ))
                    .id(),
            };
            let mut entity_cmd = commands.entity(entity);
            if needs_collider {
                entity_cmd.insert(NeedsCollider);
            } else if horizon_proxy {
                entity_cmd.insert(NotShadowCaster);
            }
            if let Some(sources) = mc_triangle_sources {
                entity_cmd.insert(sources);
            } else {
                entity_cmd.remove::<McTriangleSources>();
            }
            chunk.set_mesh_entity(entity);
        }
    } else if let Some(entity) = chunk.mesh_entity() {
        commands.entity(entity).despawn();
        chunk.clear_mesh_entity();
    }

    if horizon_proxy || water_mesh_handle.is_none() {
        if let Some(entity) = chunk.water_mesh_entity() {
            commands.entity(entity).despawn();
            chunk.clear_water_mesh_entity();
        }
        if let Some(entity) = chunk.water_mask_mesh_entity() {
            commands.entity(entity).despawn();
            chunk.clear_water_mask_mesh_entity();
        }
    } else if let Some(water_mesh_handle) = water_mesh_handle {
        let force_fancy = env_flag("VOXEL_FORCE_ALL_WATER_FANCY");
        let force_cheap = env_flag("VOXEL_FORCE_ALL_WATER_CHEAP");
        let use_fancy_water = force_fancy && !force_cheap;

        if let Some(entity) = chunk.water_mesh_entity() {
            let mut entity_cmd = commands.entity(entity);
            entity_cmd.insert((
                Mesh3d(water_mesh_handle.clone()),
                ChunkMesh {
                    chunk_position: chunk_pos,
                    vertex_count: water_vertex_count,
                    triangle_count: water_triangle_count,
                    mesh_mode: MeshMode::Blocky,
                    material_quality: TerrainMaterialQuality::FullTriplanar,
                },
                WaterMesh,
                WaterMeshDetail {
                    triangle_count: water_triangle_count as usize,
                    max_depth: water_depth_detail.max_depth,
                    average_depth: water_depth_detail.average_depth,
                    surface_area: water_depth_detail.surface_area,
                },
                RenderLayers::default(),
                NotShadowCaster,
            ));
            if use_fancy_water {
                entity_cmd
                    .insert(MeshMaterial3d(
                        water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                    ))
                    .remove::<MeshMaterial3d<StandardMaterial>>();
            } else {
                entity_cmd
                    .insert(MeshMaterial3d(
                        water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                    ))
                    .remove::<MeshMaterial3d<StandardWaterMaterial>>();
            }
        } else {
            let mut entity_cmd = commands.spawn((
                Mesh3d(water_mesh_handle.clone()),
                Transform::from_xyz(world_pos.x as f32, world_pos.y as f32, world_pos.z as f32),
                ChunkMesh {
                    chunk_position: chunk_pos,
                    vertex_count: water_vertex_count,
                    triangle_count: water_triangle_count,
                    mesh_mode: MeshMode::Blocky,
                    material_quality: TerrainMaterialQuality::FullTriplanar,
                },
                WaterMesh,
                WaterMeshDetail {
                    triangle_count: water_triangle_count as usize,
                    max_depth: water_depth_detail.max_depth,
                    average_depth: water_depth_detail.average_depth,
                    surface_area: water_depth_detail.surface_area,
                },
                RenderLayers::default(),
                NotShadowCaster,
            ));
            if use_fancy_water {
                entity_cmd.insert(MeshMaterial3d(
                    water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                ));
            } else {
                entity_cmd.insert(MeshMaterial3d(
                    water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                ));
            }
            let entity = entity_cmd.id();
            chunk.set_water_mesh_entity(entity);
        }

        let mask_transform =
            Transform::from_xyz(world_pos.x as f32, world_pos.y as f32, world_pos.z as f32);
        if let Some(mask_entity) = chunk.water_mask_mesh_entity() {
            commands.entity(mask_entity).insert((
                Mesh3d(water_mesh_handle.clone()),
                MeshMaterial3d(water_material.mask_handle.clone()),
                mask_transform,
                WaterMaskProxy,
                RenderLayers::layer(WATER_MASK_RENDER_LAYER),
                NotShadowCaster,
            ));
        } else {
            let mask_entity = commands
                .spawn((
                    Mesh3d(water_mesh_handle),
                    MeshMaterial3d(water_material.mask_handle.clone()),
                    mask_transform,
                    WaterMaskProxy,
                    RenderLayers::layer(WATER_MASK_RENDER_LAYER),
                    NotShadowCaster,
                ))
                .id();
            chunk.set_water_mask_mesh_entity(mask_entity);
        }
    }

    if had_visible_mesh {
        frame_stats.chunks_meshed += 1;
    } else {
        frame_stats.chunks_skipped += 1;
    }
    frame_stats.mesh_dirty_apply_us += apply_start.elapsed().as_micros() as u64;
}

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct WaterChunkDepthDetail {
    pub(crate) max_depth: usize,
    pub(crate) average_depth: f32,
    pub(crate) surface_area: f32,
}

pub(crate) fn compute_water_chunk_depth_detail(
    world: &VoxelWorld,
    chunk_pos: IVec3,
) -> WaterChunkDepthDetail {
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos);
    let mut max_depth = 0usize;
    let mut total_depth = 0usize;
    let mut surface_area = 0usize;

    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            for y in (0..CHUNK_SIZE_I32).rev() {
                let world_pos = chunk_origin + IVec3::new(x, y, z);
                let VoxelSample::InBounds(voxel) = world.sample_voxel_for_water_meshing(world_pos)
                else {
                    continue;
                };
                if !voxel.is_liquid() {
                    continue;
                }

                if matches!(
                    world.sample_voxel_for_water_meshing(world_pos + IVec3::Y),
                    VoxelSample::InBounds(v) if v.is_liquid()
                ) {
                    continue;
                }

                let mut depth = 1usize;
                loop {
                    let below_pos = world_pos - IVec3::Y * depth as i32;
                    match world.sample_voxel_for_water_meshing(below_pos) {
                        VoxelSample::InBounds(v) if v.is_liquid() => {
                            depth += 1;
                        }
                        _ => break,
                    }
                }

                if depth > max_depth {
                    max_depth = depth;
                }
                total_depth += depth;
                surface_area += 1;
                break;
            }
        }
    }

    WaterChunkDepthDetail {
        max_depth,
        average_depth: if surface_area == 0 {
            0.0
        } else {
            total_depth as f32 / surface_area as f32
        },
        surface_area: surface_area as f32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lod_transaction_skips_context_validation_for_clear_no_visible_commits() {
        assert!(lod_commit_no_visible_mesh_skips_context_validation(
            LodLevel::Lod1,
            ChunkUniformity::Solid,
            false
        ));
        assert!(lod_commit_no_visible_mesh_skips_context_validation(
            LodLevel::Culled,
            ChunkUniformity::Mixed,
            false
        ));
        assert!(lod_commit_no_visible_mesh_skips_context_validation(
            LodLevel::Lod1,
            ChunkUniformity::Empty,
            false
        ));
        assert!(!lod_commit_no_visible_mesh_skips_context_validation(
            LodLevel::Lod1,
            ChunkUniformity::Empty,
            true
        ));
        assert!(!lod_commit_no_visible_mesh_skips_context_validation(
            LodLevel::Lod1,
            ChunkUniformity::Mixed,
            false
        ));
    }

    #[test]
    fn lod_mesh_transaction_keeps_oversize_connected_component_atomic() {
        let dirty_chunks = vec![
            IVec3::new(0, 0, 0),
            IVec3::new(1, 0, 0),
            IVec3::new(2, 0, 0),
            IVec3::new(20, 0, 0),
        ];

        let selection = select_lod_mesh_transaction_chunks(&dirty_chunks, Some(Vec3::ZERO), 2);

        assert_eq!(
            selection.chunks,
            vec![
                IVec3::new(0, 0, 0),
                IVec3::new(1, 0, 0),
                IVec3::new(2, 0, 0),
            ]
        );
        assert_eq!(selection.component_count, 1);
        assert_eq!(selection.deferred_chunks, 1);
        assert_eq!(selection.oversize_component_chunks, 3);
    }

    #[test]
    fn lod_mesh_transaction_batches_complete_components_under_limit() {
        let dirty_chunks = vec![
            IVec3::new(0, 0, 0),
            IVec3::new(1, 0, 0),
            IVec3::new(10, 0, 0),
            IVec3::new(11, 0, 0),
            IVec3::new(30, 0, 0),
        ];

        let selection = select_lod_mesh_transaction_chunks(&dirty_chunks, Some(Vec3::ZERO), 4);

        assert_eq!(
            selection.chunks,
            vec![
                IVec3::new(0, 0, 0),
                IVec3::new(1, 0, 0),
                IVec3::new(10, 0, 0),
                IVec3::new(11, 0, 0),
            ]
        );
        assert_eq!(selection.component_count, 2);
        assert_eq!(selection.deferred_chunks, 1);
        assert_eq!(selection.oversize_component_chunks, 0);
    }

    #[test]
    fn lod_mesh_transaction_waits_until_all_chunks_are_prepared() {
        let chunks = vec![IVec3::new(0, 0, 0), IVec3::new(1, 0, 0)];
        let mut transaction = LodMeshTransaction::new(chunks.clone());

        assert_eq!(transaction.pending_len(), 2);
        assert_eq!(transaction.prepared_len(), 0);
        assert!(!transaction.is_ready_to_commit());

        let first = transaction.pending.pop_front().unwrap();
        transaction
            .prepared
            .insert(first, PreparedLodChunkCommit::clear(first));

        assert_eq!(transaction.pending_len(), 1);
        assert_eq!(transaction.prepared_len(), 1);
        assert!(!transaction.is_ready_to_commit());

        let second = transaction.pending.pop_front().unwrap();
        transaction
            .prepared
            .insert(second, PreparedLodChunkCommit::clear(second));

        assert_eq!(transaction.chunks, chunks);
        assert_eq!(transaction.pending_len(), 0);
        assert_eq!(transaction.prepared_len(), 2);
        assert!(transaction.is_ready_to_commit());
    }
}
