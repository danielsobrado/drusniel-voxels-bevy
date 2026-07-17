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
    center: Option<IVec3>,
    world_chunk_count: usize,
    pending: VecDeque<IVec3>,
    queued: HashSet<IVec3>,
}

impl PageSourceMeshingQueue {
    fn clear(&mut self) {
        self.center = None;
        self.world_chunk_count = 0;
        self.pending.clear();
        self.queued.clear();
    }

    fn refresh(
        &mut self,
        world: &VoxelWorld,
        cache: &PageExportCache,
        cam_chunk: IVec3,
        far: i32,
    ) {
        self.center = Some(cam_chunk);
        self.world_chunk_count = world.chunk_count();
        self.pending = source_positions_within_radius(
            world.chunk_positions(),
            &cache.exports,
            cam_chunk,
            far,
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
    pub cached_exports: usize,
    pub complete_page_columns: usize,
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
    cam_chunk: IVec3,
    world_chunk_count: usize,
    invalidated: bool,
    schedule: &mut SourceMeshingSchedule,
) -> bool {
    if invalidated
        || queue.center != Some(cam_chunk)
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

fn source_positions_within_radius(
    positions: impl Iterator<Item = IVec3>,
    exports: &HashMap<IVec3, TerrainMainSurfaceExport>,
    cam_chunk: IVec3,
    far: i32,
) -> Vec<IVec3> {
    let mut candidates = positions
        .filter(|position| {
            horizontal_chunk_distance(*position, cam_chunk) <= far
                && !exports.contains_key(position)
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|position| {
        (
            horizontal_chunk_distance(*position, cam_chunk),
            (position.y - cam_chunk.y).abs(),
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
    if !runtime.enabled {
        cache.clear_all();
        queue.clear();
        *stats = PageSourceMeshingStats::default();
        return;
    }
    if !gen_state.is_complete {
        return;
    }
    let Ok(camera) = camera_query.single() else {
        return;
    };
    if !matches!(mesh_settings.mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel) {
        cache.clear_all();
        queue.clear();
        *stats = PageSourceMeshingStats::default();
        return;
    }

    if schedule.complete_page_refresh_in_frames > 0 {
        schedule.complete_page_refresh_in_frames -= 1;
    }

    let cam_chunk = VoxelWorld::world_to_chunk(camera.translation.as_ivec3());
    let world_chunk_count = world.chunk_count();
    let far = runtime.source_radius_chunks;
    let retained = cache.retain_in_radius(cam_chunk, far);
    let invalidated = cache.invalidate_dirty_exports(&world);
    let world_changed = queue.world_chunk_count != world_chunk_count;

    if should_refresh_queue(
        &queue,
        cam_chunk,
        world_chunk_count,
        invalidated || retained,
        &mut schedule,
    ) {
        queue.refresh(&world, &cache, cam_chunk, far);
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
        cache.refresh_complete_pages(&world, runtime.cfg.page.chunks_per_page as i32);
        schedule.complete_page_refresh_in_frames = COMPLETE_PAGE_REFRESH_INTERVAL_FRAMES;
    }

    stats.cached_exports = cache.exports.len();
    stats.complete_page_columns = cache.complete_pages.len();
    stats.pending_chunks = queue.pending_len();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn export(position: IVec3) -> TerrainMainSurfaceExport {
        TerrainMainSurfaceExport {
            local_positions: Vec::new(),
            normals: Vec::new(),
            material_weights: Vec::new(),
            paint_slots: Vec::new(),
            indices: Vec::new(),
            chunk_pos: position,
            lod: LodLevel::Lod0,
            revision: 1,
        }
    }

    #[test]
    fn source_queue_includes_near_chunks_and_skips_cached_or_out_of_radius_chunks() {
        let cam = IVec3::ZERO;
        let cached = IVec3::new(3, 0, 0);
        let exports = [(cached, export(cached))].into_iter().collect();
        let positions = vec![
            IVec3::new(1, 0, 0),
            IVec3::new(2, 0, 0),
            cached,
            IVec3::new(4, 0, 0),
            IVec3::new(5, 0, 0),
        ];

        let queued = source_positions_within_radius(positions.into_iter(), &exports, cam, 4);

        assert_eq!(
            queued,
            vec![
                IVec3::new(1, 0, 0),
                IVec3::new(2, 0, 0),
                IVec3::new(4, 0, 0),
            ]
        );
    }

    #[test]
    fn source_queue_prioritizes_horizontal_then_vertical_distance() {
        let positions = vec![
            IVec3::new(4, 5, 0),
            IVec3::new(2, 8, 0),
            IVec3::new(2, 1, 0),
            IVec3::new(3, 0, 0),
        ];

        let queued = source_positions_within_radius(
            positions.into_iter(),
            &HashMap::new(),
            IVec3::ZERO,
            8,
        );

        assert_eq!(
            queued,
            vec![
                IVec3::new(2, 1, 0),
                IVec3::new(2, 8, 0),
                IVec3::new(3, 0, 0),
                IVec3::new(4, 5, 0),
            ]
        );
    }

    #[test]
    fn empty_queue_rescans_only_after_cooldown() {
        let mut queue = PageSourceMeshingQueue::default();
        queue.center = Some(IVec3::ZERO);
        queue.world_chunk_count = 10;
        let mut schedule = SourceMeshingSchedule {
            queue_rescan_in_frames: 2,
            ..Default::default()
        };

        assert!(!should_refresh_queue(
            &queue,
            IVec3::ZERO,
            10,
            false,
            &mut schedule,
        ));
        assert!(!should_refresh_queue(
            &queue,
            IVec3::ZERO,
            10,
            false,
            &mut schedule,
        ));
        assert!(should_refresh_queue(
            &queue,
            IVec3::ZERO,
            10,
            false,
            &mut schedule,
        ));
    }

    #[test]
    fn invalidation_bypasses_queue_rescan_cooldown() {
        let mut queue = PageSourceMeshingQueue::default();
        queue.center = Some(IVec3::ZERO);
        queue.world_chunk_count = 10;
        let mut schedule = SourceMeshingSchedule {
            queue_rescan_in_frames: 20,
            ..Default::default()
        };

        assert!(should_refresh_queue(
            &queue,
            IVec3::ZERO,
            10,
            true,
            &mut schedule,
        ));
    }

    #[test]
    fn source_meshing_uses_all_lod0_neighbors() {
        let neighbors = all_lod0_neighbors();
        assert_eq!(neighbors.neg_x, Some(LodLevel::Lod0));
        assert_eq!(neighbors.pos_x, Some(LodLevel::Lod0));
        assert_eq!(neighbors.neg_y, Some(LodLevel::Lod0));
        assert_eq!(neighbors.pos_y, Some(LodLevel::Lod0));
        assert_eq!(neighbors.neg_z, Some(LodLevel::Lod0));
        assert_eq!(neighbors.pos_z, Some(LodLevel::Lod0));
    }
}
