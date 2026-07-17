//! Phase 5 Step 3a — bounded LOD0 page-source meshing and export-cache maintenance.
//!
//! Default-OFF (`ClodPagesRuntime.enabled`) for explicit A/B rollout. Enable with
//! `CLOD_PAGES=1`. Source meshing runs on the main thread under a strict per-frame budget,
//! using the exact live terrain mesher with LOD0 neighbors. Weld/simplify/quadtree work stays
//! on the async compute pool.

use bevy::prelude::*;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

use super::config::ClodPagesConfig;
use super::export::TerrainMainSurfaceExport;
use crate::gameplay::camera::controller::PlayerCamera;
use crate::rendering::AmbientOcclusionConfig;
use crate::voxel::chunk::{LodLevel, MeshDirtyReason};
use crate::voxel::mc_transvoxel::McTransvoxelSettings;
use crate::voxel::meshing::{
    MeshForensicsOptions, MeshMode, MeshRequest, MeshSettings, generate_chunk_mesh_for_request,
};
use crate::voxel::runtime::ChunkGenerationState;
use crate::voxel::skirt::NeighborLods;
use crate::voxel::world::VoxelWorld;

const DEFAULT_SOURCE_MESH_BUDGET_PER_FRAME: usize = 4;

fn clod_pages_enabled() -> bool {
    matches!(
        std::env::var("CLOD_PAGES").ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("on") | Some("yes")
    )
}

fn env_usize(key: &str, fallback: usize) -> usize {
    std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

#[derive(Resource)]
pub struct ClodPagesRuntime {
    pub cfg: ClodPagesConfig,
    /// Master toggle — default OFF. Set `CLOD_PAGES=1` to enable.
    pub enabled: bool,
    /// LOD0 page sources assembled per frame by the async build queue.
    pub source_budget_per_frame: usize,
    /// Far-field chunks meshed for clean LOD0 export per frame.
    pub source_mesh_budget_per_frame: usize,
    /// Chebyshev radius (chunks) out to which page sources are pre-meshed.
    pub source_radius_chunks: i32,
}

impl Default for ClodPagesRuntime {
    fn default() -> Self {
        let cfg = ClodPagesConfig::load();
        let p = cfg.page.chunks_per_page as i32;
        let levels = cfg.page.quadtree_levels as i32;
        let enabled = clod_pages_enabled();
        // Reach one top-level page footprint beyond the near-field bubble.
        let source_radius_chunks = cfg.near_field.radius_chunks + p * (1 << (levels - 1).max(0));
        Self {
            cfg,
            enabled,
            source_budget_per_frame: env_usize("CLOD_PAGES_BUDGET", 4),
            source_mesh_budget_per_frame: env_usize(
                "CLOD_PAGES_SOURCE_MESH_BUDGET",
                DEFAULT_SOURCE_MESH_BUDGET_PER_FRAME,
            ),
            source_radius_chunks,
        }
    }
}

/// LOD0 main-surface exports keyed by chunk position, the input to the page builder.
#[derive(Resource, Default)]
pub struct PageExportCache {
    pub exports: HashMap<IVec3, TerrainMainSurfaceExport>,
    pub(crate) revision: u64,
    pub(crate) complete_pages: BTreeMap<(i32, i32), Vec<IVec3>>,
    pub(crate) complete_pages_revision: u64,
    pub(crate) complete_pages_world_chunk_count: usize,
}

impl PageExportCache {
    pub(crate) fn clear_all(&mut self) -> bool {
        if self.exports.is_empty() && self.complete_pages.is_empty() {
            return false;
        }
        self.exports.clear();
        self.complete_pages.clear();
        self.complete_pages_revision = 0;
        self.complete_pages_world_chunk_count = 0;
        self.revision = self.revision.wrapping_add(1);
        true
    }

    pub(crate) fn insert_from_live_lod0(&mut self, mut export: TerrainMainSurfaceExport) {
        self.revision = self.revision.wrapping_add(1);
        export.revision = self.revision;
        self.exports.insert(export.chunk_pos, export);
    }

    pub(crate) fn remove_export(&mut self, chunk_pos: IVec3) {
        if self.exports.remove(&chunk_pos).is_some() {
            self.revision = self.revision.wrapping_add(1);
        }
    }

    fn retain_in_radius(&mut self, cam_chunk: IVec3, far: i32) {
        let previous_len = self.exports.len();
        self.exports.retain(|pos, _| cheby(*pos, cam_chunk) <= far);
        if self.exports.len() != previous_len {
            self.revision = self.revision.wrapping_add(1);
        }
    }

    fn invalidate_dirty_exports(&mut self, world: &VoxelWorld) {
        let dirty_generation_mask =
            MeshDirtyReason::Generation.bit() | MeshDirtyReason::TerrainMutation.bit();
        let dirty_positions: Vec<IVec3> = world
            .dirty_chunks()
            .filter(|pos| {
                world
                    .get_chunk(*pos)
                    .is_some_and(|chunk| chunk.dirty_reason_flags() & dirty_generation_mask != 0)
            })
            .collect();
        if dirty_positions.is_empty() {
            return;
        }

        let mut changed = false;
        for pos in dirty_positions {
            changed |= self.exports.remove(&pos).is_some();
        }
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
    }

    fn refresh_complete_pages(&mut self, world: &VoxelWorld, chunks_per_page: i32) {
        let world_chunk_count = world.chunk_count();
        if self.complete_pages_revision == self.revision
            && self.complete_pages_world_chunk_count == world_chunk_count
        {
            return;
        }

        let mut columns: BTreeMap<(i32, i32), Vec<IVec3>> = BTreeMap::new();
        for pos in world.chunk_positions() {
            columns
                .entry(page_coord(pos, chunks_per_page))
                .or_default()
                .push(pos);
        }

        columns.retain(|_, positions| positions.iter().all(|pos| self.exports.contains_key(pos)));
        for positions in columns.values_mut() {
            positions.sort_by_key(|pos| (pos.x, pos.z, pos.y));
        }

        self.complete_pages = columns;
        self.complete_pages_revision = self.revision;
        self.complete_pages_world_chunk_count = world_chunk_count;
    }
}

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
        near: i32,
        far: i32,
    ) {
        let world_chunk_count = world.chunk_count();
        let rebuild = self.center != Some(cam_chunk)
            || self.world_chunk_count != world_chunk_count
            || self.pending.is_empty();
        if !rebuild {
            return;
        }

        self.center = Some(cam_chunk);
        self.world_chunk_count = world_chunk_count;
        self.pending = source_positions_in_band(
            world.chunk_positions(),
            &cache.exports,
            cam_chunk,
            near,
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
}

fn cheby(a: IVec3, b: IVec3) -> i32 {
    (a.x - b.x).abs().max((a.z - b.z).abs())
}

fn page_coord(chunk_pos: IVec3, chunks_per_page: i32) -> (i32, i32) {
    (
        chunk_pos.x.div_euclid(chunks_per_page),
        chunk_pos.z.div_euclid(chunks_per_page),
    )
}

fn source_positions_in_band(
    positions: impl Iterator<Item = IVec3>,
    exports: &HashMap<IVec3, TerrainMainSurfaceExport>,
    cam_chunk: IVec3,
    near: i32,
    far: i32,
) -> Vec<IVec3> {
    let mut candidates = positions
        .filter(|position| {
            let distance = cheby(*position, cam_chunk);
            distance > near && distance <= far && !exports.contains_key(position)
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|position| {
        (
            cheby(*position, cam_chunk),
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

/// Logs the initial page state once for bench output.
pub fn clod_pages_startup_log_system(runtime: Res<ClodPagesRuntime>) {
    if !runtime.enabled {
        info!("CLOD PAGES: disabled (set CLOD_PAGES=1 to enable).");
        return;
    }
    info!(
        "CLOD PAGES: enabled; radius {} chunks, source-mesh budget {}/frame, page-source budget {}/frame.",
        runtime.source_radius_chunks,
        runtime.source_mesh_budget_per_frame,
        runtime.source_budget_per_frame,
    );
}

/// Builds missing far-field LOD0 exports under a strict main-thread budget, then refreshes
/// complete page columns. It never commits source meshes as live chunk entities.
pub fn clod_pages_source_meshing_system(
    gen_state: Res<ChunkGenerationState>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    runtime: Res<ClodPagesRuntime>,
    mesh_settings: Res<MeshSettings>,
    ao_config: Res<AmbientOcclusionConfig>,
    mc_settings: Option<Res<McTransvoxelSettings>>,
    mut cache: ResMut<PageExportCache>,
    mut queue: ResMut<PageSourceMeshingQueue>,
) {
    if !runtime.enabled {
        cache.clear_all();
        queue.clear();
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
        return;
    }

    let cam_chunk = VoxelWorld::world_to_chunk(camera.translation.as_ivec3());
    let near = runtime.cfg.near_field.radius_chunks;
    let far = runtime.source_radius_chunks;
    cache.retain_in_radius(cam_chunk, far);
    cache.invalidate_dirty_exports(&world);
    queue.refresh(&world, &cache, cam_chunk, near, far);

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
            Ok(export) => cache.insert_from_live_lod0(export),
            Err(error) => {
                cache.remove_export(chunk_pos);
                warn!("CLOD source export failed for {:?}: {}", chunk_pos, error);
            }
        }
    }

    cache.refresh_complete_pages(&world, runtime.cfg.page.chunks_per_page as i32);
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
    fn source_queue_contains_only_missing_far_band_chunks() {
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

        let queued = source_positions_in_band(positions.into_iter(), &exports, cam, 1, 4);

        assert_eq!(queued, vec![IVec3::new(2, 0, 0), IVec3::new(4, 0, 0)]);
    }

    #[test]
    fn source_queue_prioritizes_horizontal_distance_then_vertical_distance() {
        let positions = vec![
            IVec3::new(4, 5, 0),
            IVec3::new(2, 8, 0),
            IVec3::new(2, 1, 0),
            IVec3::new(3, 0, 0),
        ];

        let queued = source_positions_in_band(
            positions.into_iter(),
            &HashMap::new(),
            IVec3::ZERO,
            0,
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
