//! Bounded main-thread LOD0 source meshing for CLOD page construction.
//!
//! The live mesher remains the geometry authority. Source meshes are exported directly from
//! `MeshData` and are never committed as render or collider entities. Expensive page assembly,
//! welding, simplification, and quadtree construction remain asynchronous. Source generation
//! includes the near-field area because exclusion is a render-ownership rule; complete page
//! columns that straddle the bubble still need every chunk export.

use bevy::prelude::*;
use std::collections::{HashMap, HashSet, VecDeque};

use super::export::TerrainMainSurfaceExport;
use super::runtime::{ClodPagesRuntime, PageExportCache, horizontal_chunk_distance};
use crate::gameplay::camera::controller::PlayerCamera;
use crate::rendering::AmbientOcclusionConfig;
use crate::voxel::chunk::LodLevel;
use crate::voxel::mc_transvoxel::McTransvoxelSettings;
use crate::voxel::meshing::{
    MeshForensicsOptions, MeshMode, MeshRequest, MeshSettings,
    generate_chunk_mesh_for_request,
};
use crate::voxel::runtime::ChunkGenerationState;
use crate::voxel::skirt::NeighborLods;
use crate::voxel::world::VoxelWorld;

const QUEUE_RESCAN_INTERVAL_FRAMES: u32 = 30;
const COMPLETE_PAGE_REFRESH_INTERVAL_FRAMES: u32 = 8;

#[derive(Resource, Default)]
pub(crate) struct PageSourceMeshingQueue {
    source_anchor: Option<IVec3>,
    world_chunk_count: usize,
    pending: VecDeque<IVec3>,
    queued: HashSet<IVec3>,
}

impl PageSourceMeshingQueue {
    fn clear(&mut self) {
        self.source_anchor = None;
        self.world_chunk_count = 0;
        self.pending.clear();
        self.queued.clear();
    }

    fn refresh(
        &mut self,
        world: &VoxelWorld,
        cache: &PageExportCache,
        source_anchor: IVec3,
        vertical_reference_y: i32,
        near: i32,
        far: i32,
        chunks_per_page: i32,
    ) {
        self.source_anchor = Some(source_anchor);
        self.world_chunk_count = world.chunk_count();
        self.pending = source_positions_within_radius(
            world.chunk_positions(),
            &cache.exports,
            source_anchor,
            vertical_reference_y,
            near,
            far,
            chunks_per_page,
        )
        .into();
        self.queued = self.pending.iter().copied().collect();
    }

    fn pop(&mut self) -> Option<IVec3> {
        let position = self.pending.pop_front()?;
        self.queued.remove(&position);
        Some(position)
    }

    fn requeue(&mut self, position: IVec3) {
        if self.queued.insert(position) {
            self.pending.push_back(position);
        }
    }

    pub(crate) fn pending_len(&self) -> usize {
        self.pending.len()
    }

    fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub(crate) struct PageSourceMeshingStats {
    pub pending_chunks: usize,
    pub meshed_this_frame: usize,
    pub failures_total: u64,
}

#[derive(Default)]
struct SourceMeshingSchedule {
    queue_rescan_in_frames: u32,
    complete_page_refresh_in_frames: u32,
}

fn should_refresh_queue(
    queue: &PageSourceMeshingQueue,
    source_anchor: IVec3,
    world_chunk_count: usize,
    invalidated: bool,
    schedule: &mut SourceMeshingSchedule,
) -> bool {
    if invalidated
        || queue.source_anchor != Some(source_anchor)
        || queue.world_chunk_count != world_chunk_count
    {
        schedule.queue_rescan_in_frames = QUEUE_RESCAN_INTERVAL_FRAMES;
        return true;
    }
    if !queue.is_empty() {
        return false;
    }
    if schedule.queue_rescan_in_frames == 0 {
        schedule.queue_rescan_in_frames = QUEUE_RESCAN_INTERVAL_FRAMES;
        return true;
    }
    schedule.queue_rescan_in_frames -= 1;
    false
}

fn source_anchor_chunk(cam_chunk: IVec3, chunks_per_page: i32) -> IVec3 {
    let half_page = chunks_per_page / 2;
    IVec3::new(
        cam_chunk.x.div_euclid(chunks_per_page) * chunks_per_page + half_page,
        0,
        cam_chunk.z.div_euclid(chunks_per_page) * chunks_per_page + half_page,
    )
}

fn page_coord(position: IVec3, chunks_per_page: i32) -> IVec2 {
    IVec2::new(
        position.x.div_euclid(chunks_per_page),
        position.z.div_euclid(chunks_per_page),
    )
}

fn page_min_chebyshev_distance(
    page: IVec2,
    source_anchor: IVec3,
    chunks_per_page: i32,
) -> i32 {
    let min_x = page.x * chunks_per_page;
    let min_z = page.y * chunks_per_page;
    let max_x = min_x + chunks_per_page - 1;
    let max_z = min_z + chunks_per_page - 1;
    let dx = if source_anchor.x < min_x {
        min_x - source_anchor.x
    } else if source_anchor.x > max_x {
        source_anchor.x - max_x
    } else {
        0
    };
    let dz = if source_anchor.z < min_z {
        min_z - source_anchor.z
    } else if source_anchor.z > max_z {
        source_anchor.z - max_z
    } else {
        0
    };
    dx.max(dz)
}

fn source_positions_within_radius(
    positions: impl Iterator<Item = IVec3>,
    exports: &HashMap<IVec3, TerrainMainSurfaceExport>,
    source_anchor: IVec3,
    vertical_reference_y: i32,
    near: i32,
    far: i32,
    chunks_per_page: i32,
) -> Vec<IVec3> {
    let mut candidates = positions
        .filter(|position| {
            horizontal_chunk_distance(*position, source_anchor) <= far
                && !exports.contains_key(position)
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|position| {
        let page = page_coord(*position, chunks_per_page);
        let page_distance = page_min_chebyshev_distance(page, source_anchor, chunks_per_page);
        let hidden_near_page = page_distance <= near;
        (
            hidden_near_page,
            page_distance,
            page.x,
            page.y,
            (position.y - vertical_reference_y).abs(),
            position.x,
            position.z,
            position.y,
        )
    });
    candidates
}

fn all_lod0_neighbors() -> NeighborLods {
    NeighborLods {
        neg_x: Some(LodLevel::Lod0),
        pos_x: Some(LodLevel::Lod0),
        neg_y: Some(LodLevel::Lod0),
        pos_y: Some(LodLevel::Lod0),
        neg_z: Some(LodLevel::Lod0),
        pos_z: Some(LodLevel::Lod0),
    }
}

fn reset_source_state(
    cache: &mut PageExportCache,
    queue: &mut PageSourceMeshingQueue,
    stats: &mut PageSourceMeshingStats,
    schedule: &mut SourceMeshingSchedule,
) {
    cache.clear_all();
    queue.clear();
    *stats = PageSourceMeshingStats::default();
    *schedule = SourceMeshingSchedule::default();
}

/// Builds missing LOD0 exports inside the page-source radius under a strict main-thread budget.
pub(crate) fn clod_pages_source_meshing_system(
    gen_state: Res<ChunkGenerationState>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    runtime: Res<ClodPagesRuntime>,
    mesh_settings: Res<MeshSettings>,
    ao_config: Res<AmbientOcclusionConfig>,
    mc_settings: Option<Res<McTransvoxelSettings>>,
    mut cache: ResMut<PageExportCache>,
    mut queue: ResMut<PageSourceMeshingQueue>,
    mut stats: ResMut<PageSourceMeshingStats>,
    mut schedule: Local<SourceMeshingSchedule>,
) {
    stats.meshed_this_frame = 0;
    if !runtime.enabled || !gen_state.is_complete {
        reset_source_state(&mut cache, &mut queue, &mut stats, &mut schedule);
        return;
    }
    let Ok(camera) = camera_query.single() else {
        return;
    };
    if !matches!(mesh_settings.mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel) {
        reset_source_state(&mut cache, &mut queue, &mut stats, &mut schedule);
        return;
    }

    if schedule.complete_page_refresh_in_frames > 0 {
        schedule.complete_page_refresh_in_frames -= 1;
    }

    let cam_chunk = VoxelWorld::world_to_chunk(camera.translation.as_ivec3());
    let world_chunk_count = world.chunk_count();
    let near = runtime.cfg.near_field.radius_chunks;
    let far = runtime.source_radius_chunks;
    let chunks_per_page = runtime.cfg.page.chunks_per_page as i32;
    let source_anchor = source_anchor_chunk(cam_chunk, chunks_per_page);
    let retained = cache.retain_in_radius(source_anchor, far);
    let invalidated = cache.invalidate_dirty_exports(&world);
    let world_changed = queue.world_chunk_count != world_chunk_count;

    if should_refresh_queue(
        &queue,
        source_anchor,
        world_chunk_count,
        invalidated || retained,
        &mut schedule,
    ) {
        queue.refresh(
            &world,
            &cache,
            source_anchor,
            cam_chunk.y,
            near,
            far,
            chunks_per_page,
        );
    }

    let mut cache_inserted = false;
    for _ in 0..runtime.source_mesh_budget_per_frame.max(1) {
        let Some(chunk_pos) = queue.pop() else {
            break;
        };
        if cache.exports.contains_key(&chunk_pos) {
            continue;
        }
        let Some(chunk) = world.get_chunk(chunk_pos) else {
            continue;
        };
        if chunk.is_dirty() {
            queue.requeue(chunk_pos);
            continue;
        }

        let mesh_result = generate_chunk_mesh_for_request(MeshRequest {
            chunk,
            world: &world,
            mode: mesh_settings.mode,
            logical_lod: LodLevel::Lod0,
            mesh_lod: LodLevel::Lod0,
            neighbor_lods: all_lod0_neighbors(),
            ao_config: &ao_config.baked,
            water_exposure_mode: mesh_settings.water_air_exposure_mode,
            forensics: MeshForensicsOptions::default(),
            mc_settings: mc_settings.as_deref(),
            timing_enabled: false,
        });

        match super::extract_main_surface_for_clod(
            &mesh_result.solid,
            chunk_pos,
            LodLevel::Lod0,
            0,
        ) {
            Ok(export) => {
                cache.insert_from_live_lod0(export);
                cache_inserted = true;
                stats.meshed_this_frame += 1;
            }
            Err(error) => {
                cache.remove_export(chunk_pos);
                stats.failures_total = stats.failures_total.saturating_add(1);
                warn!("CLOD source export failed for {:?}: {}", chunk_pos, error);
            }
        }
    }

    let refresh_complete_pages = invalidated
        || retained
        || world_changed
        || (cache_inserted
            && (queue.is_empty() || schedule.complete_page_refresh_in_frames == 0));
    if refresh_complete_pages {
        cache.refresh_complete_pages(&world, chunks_per_page);
        schedule.complete_page_refresh_in_frames = COMPLETE_PAGE_REFRESH_INTERVAL_FRAMES;
    }

    stats.pending_chunks = queue.pending_len();
}

#[cfg(test)]
#[path = "source_meshing_tests.rs"]
mod tests;
