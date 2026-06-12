//! Phase 5 Step 3b part 1: assemble complete LOD0 page sources on the main thread and
//! build their quadtree on the async compute pool.

use std::collections::{BTreeMap, HashSet, VecDeque};

use bevy::prelude::*;
use bevy::tasks::{AsyncComputeTaskPool, Task, block_on, poll_once};

use super::config::ClodPagesConfig;
use super::export::TerrainMainSurfaceExport;
use super::quadtree::{BuildResult, ClodPageNode, build_quadtree};
use super::runtime::{ClodPagesRuntime, PageExportCache};
use super::source_mesh::{PageSource, build_lod0_page_source};
use super::types::{ClodBuildError, PageFootprint};
use crate::voxel::runtime::ChunkGenerationState;
use crate::voxel::world::VoxelWorld;

pub type ClodPageCoord = (i32, i32);

const BUILD_DEBOUNCE_FRAMES: u32 = 3;

pub enum ClodPageBuildStatus {
    Building,
    Ready,
    Failed(ClodBuildError),
}

/// The latest complete tree. Existing nodes remain available while a replacement builds.
#[derive(Resource, Default)]
pub struct ClodPageTree {
    pub nodes_by_level: Vec<Vec<ClodPageNode>>,
    /// Coordinates represented by `nodes_by_level`.
    pub page_coords: Vec<ClodPageCoord>,
    /// Coordinates involved in the current or most recent build attempt.
    pub build_page_coords: Vec<ClodPageCoord>,
    pub status: Option<ClodPageBuildStatus>,
}

struct PendingPageSource {
    coord: ClodPageCoord,
    chunk_positions: Vec<IVec3>,
}

struct PageAssembly {
    page_coords: Vec<ClodPageCoord>,
    pending: VecDeque<PendingPageSource>,
    sources: Vec<(ClodPageCoord, PageSource)>,
}

struct PendingTreeBuild {
    revision: u64,
    page_coords: Vec<ClodPageCoord>,
    task: Task<Result<BuildResult, ClodBuildError>>,
}

#[derive(Resource, Default)]
pub(crate) struct ClodPageBuildQueue {
    observed_cache_revision: u64,
    observed_chunk_count: usize,
    input_revision: u64,
    stable_frames: u32,
    page_source_credit: usize,
    last_attempted_pages: Vec<ClodPageCoord>,
    assembly: Option<PageAssembly>,
    task: Option<PendingTreeBuild>,
}

impl ClodPageBuildQueue {
    fn clear(&mut self) {
        self.observed_cache_revision = 0;
        self.observed_chunk_count = 0;
        self.input_revision = self.input_revision.wrapping_add(1);
        self.stable_frames = 0;
        self.page_source_credit = 0;
        self.last_attempted_pages.clear();
        self.assembly = None;
        self.task = None;
    }

    fn inputs_changed(&mut self, cache_revision: u64, chunk_count: usize) -> bool {
        if self.observed_cache_revision == cache_revision
            && self.observed_chunk_count == chunk_count
        {
            return false;
        }

        self.observed_cache_revision = cache_revision;
        self.observed_chunk_count = chunk_count;
        self.input_revision = self.input_revision.wrapping_add(1);
        self.stable_frames = 0;
        self.page_source_credit = 0;
        self.assembly = None;
        self.task = None;
        true
    }
}

fn page_coord(chunk_pos: IVec3, chunks_per_page: i32) -> ClodPageCoord {
    (
        chunk_pos.x.div_euclid(chunks_per_page),
        chunk_pos.z.div_euclid(chunks_per_page),
    )
}

fn page_footprint(coord: ClodPageCoord, cfg: &ClodPagesConfig) -> PageFootprint {
    let page_size = (cfg.page.chunks_per_page * cfg.page.chunk_size) as f32;
    let min_x = coord.0 as f32 * page_size;
    let min_z = coord.1 as f32 * page_size;
    PageFootprint {
        min_x,
        min_z,
        max_x: min_x + page_size,
        max_z: min_z + page_size,
    }
}

fn complete_page_columns(
    chunk_positions: impl Iterator<Item = IVec3>,
    exports: &HashSet<IVec3>,
    chunks_per_page: i32,
) -> BTreeMap<ClodPageCoord, Vec<IVec3>> {
    let mut columns: BTreeMap<ClodPageCoord, Vec<IVec3>> = BTreeMap::new();
    for pos in chunk_positions {
        columns
            .entry(page_coord(pos, chunks_per_page))
            .or_default()
            .push(pos);
    }

    columns.retain(|_, positions| positions.iter().all(|pos| exports.contains(pos)));
    for positions in columns.values_mut() {
        positions.sort_by_key(|pos| (pos.x, pos.z, pos.y));
    }
    columns
}

fn complete_columns_from_cache(
    world: &VoxelWorld,
    cache: &PageExportCache,
    chunks_per_page: i32,
) -> BTreeMap<ClodPageCoord, Vec<IVec3>> {
    let export_keys = cache.exports.keys().copied().collect();
    complete_page_columns(world.chunk_positions(), &export_keys, chunks_per_page)
}

fn fail_build(tree: &mut ClodPageTree, page_coords: Vec<ClodPageCoord>, error: ClodBuildError) {
    error!(
        "CLOD page build failed for pages {:?}: {}",
        page_coords, error
    );
    tree.build_page_coords = page_coords;
    tree.status = Some(ClodPageBuildStatus::Failed(error));
}

/// Finds complete page columns and assembles a bounded number of welded LOD0 sources each frame.
pub(crate) fn clod_pages_build_queue_system(
    runtime: Res<ClodPagesRuntime>,
    gen_state: Res<ChunkGenerationState>,
    world: Res<VoxelWorld>,
    cache: Res<PageExportCache>,
    mut queue: ResMut<ClodPageBuildQueue>,
    mut tree: ResMut<ClodPageTree>,
) {
    if !runtime.enabled || !gen_state.is_complete {
        if !tree.nodes_by_level.is_empty()
            || !tree.build_page_coords.is_empty()
            || tree.status.is_some()
        {
            tree.nodes_by_level.clear();
            tree.page_coords.clear();
            tree.build_page_coords.clear();
            tree.status = None;
        }
        queue.clear();
        return;
    }
    if world.chunk_count() == 0 {
        return;
    }

    if queue.inputs_changed(cache.revision, world.chunk_count()) {
        if matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Building)) {
            tree.build_page_coords.clear();
            tree.status = None;
        }
        return;
    }

    if queue.stable_frames < BUILD_DEBOUNCE_FRAMES {
        queue.stable_frames += 1;
        return;
    }
    if queue.task.is_some() {
        return;
    }

    if queue.assembly.is_none() {
        let chunks_per_page = runtime.cfg.page.chunks_per_page as i32;
        let complete = complete_columns_from_cache(&world, &cache, chunks_per_page);
        let page_coords: Vec<ClodPageCoord> = complete.keys().copied().collect();
        if page_coords == queue.last_attempted_pages {
            return;
        }

        let pending = complete
            .into_iter()
            .map(|(coord, chunk_positions)| PendingPageSource {
                coord,
                chunk_positions,
            })
            .collect();
        tree.build_page_coords = page_coords.clone();
        tree.status = Some(ClodPageBuildStatus::Building);
        queue.page_source_credit = 0;
        queue.assembly = Some(PageAssembly {
            page_coords,
            pending,
            sources: Vec::new(),
        });
    }

    queue.page_source_credit = queue
        .page_source_credit
        .saturating_add(runtime.source_budget_per_frame);
    loop {
        let next_page_cost = queue
            .assembly
            .as_ref()
            .and_then(|assembly| assembly.pending.front())
            .map(|page| page.chunk_positions.len().max(1));
        let Some(next_page_cost) = next_page_cost else {
            break;
        };
        if queue.page_source_credit < next_page_cost {
            break;
        }
        queue.page_source_credit -= next_page_cost;

        let Some(page) = queue
            .assembly
            .as_mut()
            .and_then(|assembly| assembly.pending.pop_front())
        else {
            break;
        };

        let exports: Result<Vec<TerrainMainSurfaceExport>, ClodBuildError> = page
            .chunk_positions
            .iter()
            .map(|pos| {
                cache.exports.get(pos).cloned().ok_or_else(|| {
                    ClodBuildError::PageIncomplete(format!(
                        "page {:?} is missing loaded chunk export {:?}",
                        page.coord, pos
                    ))
                })
            })
            .collect();
        let source = exports.and_then(|exports| {
            build_lod0_page_source(
                &exports,
                page_footprint(page.coord, &runtime.cfg),
                &runtime.cfg,
            )
        });

        match source {
            Ok(source) => queue
                .assembly
                .as_mut()
                .expect("page assembly exists")
                .sources
                .push((page.coord, source)),
            Err(error) => {
                let page_coords = queue
                    .assembly
                    .take()
                    .expect("page assembly exists")
                    .page_coords;
                queue.last_attempted_pages = page_coords;
                fail_build(&mut tree, vec![page.coord], error);
                return;
            }
        }
    }

    let assembly_complete = queue
        .assembly
        .as_ref()
        .is_some_and(|assembly| assembly.pending.is_empty());
    if !assembly_complete {
        return;
    }

    let assembly = queue.assembly.take().expect("page assembly exists");
    let page_coords = assembly.page_coords;
    queue.last_attempted_pages = page_coords.clone();
    let cfg = runtime.cfg.clone();
    let revision = queue.input_revision;
    let task =
        AsyncComputeTaskPool::get().spawn(async move { build_quadtree(assembly.sources, &cfg) });
    queue.task = Some(PendingTreeBuild {
        revision,
        page_coords,
        task,
    });
}

/// Polls the single in-flight quadtree build and atomically publishes only a complete result.
pub(crate) fn clod_pages_build_task_poll_system(
    runtime: Res<ClodPagesRuntime>,
    gen_state: Res<ChunkGenerationState>,
    mut queue: ResMut<ClodPageBuildQueue>,
    mut tree: ResMut<ClodPageTree>,
) {
    if !runtime.enabled || !gen_state.is_complete {
        return;
    }

    let Some(result) = queue
        .task
        .as_mut()
        .and_then(|pending| block_on(poll_once(&mut pending.task)))
    else {
        return;
    };
    let pending = queue.task.take().expect("polled task exists");
    if pending.revision != queue.input_revision {
        return;
    }

    match result {
        Ok(result) => {
            tree.nodes_by_level = result.nodes_by_level;
            tree.page_coords = pending.page_coords.clone();
            tree.build_page_coords = pending.page_coords;
            tree.status = Some(ClodPageBuildStatus::Ready);
        }
        Err(error) => fail_build(&mut tree, pending.page_coords, error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::LodLevel;

    fn empty_export(pos: IVec3) -> TerrainMainSurfaceExport {
        TerrainMainSurfaceExport {
            local_positions: Vec::new(),
            normals: Vec::new(),
            material_weights: Vec::new(),
            indices: Vec::new(),
            chunk_pos: pos,
            lod: LodLevel::Lod0,
            revision: 0,
        }
    }

    #[test]
    fn page_coords_use_euclidean_division() {
        assert_eq!(page_coord(IVec3::new(0, 7, 3), 4), (0, 0));
        assert_eq!(page_coord(IVec3::new(4, -2, 7), 4), (1, 1));
        assert_eq!(page_coord(IVec3::new(-1, 0, -4), 4), (-1, -1));
        assert_eq!(page_coord(IVec3::new(-5, 0, -5), 4), (-2, -2));
    }

    #[test]
    fn footprint_is_in_world_units() {
        let cfg = ClodPagesConfig::load();
        let footprint = page_footprint((-2, 3), &cfg);
        assert_eq!(footprint.min_x, -128.0);
        assert_eq!(footprint.max_x, -64.0);
        assert_eq!(footprint.min_z, 192.0);
        assert_eq!(footprint.max_z, 256.0);
    }

    #[test]
    fn completeness_requires_every_loaded_y_chunk_export() {
        let positions = vec![
            IVec3::new(0, 0, 0),
            IVec3::new(0, 1, 0),
            IVec3::new(4, 0, 0),
        ];
        let mut exports = HashSet::new();
        exports.insert(positions[0]);
        exports.insert(positions[2]);

        let complete = complete_page_columns(positions.iter().copied(), &exports, 4);
        assert!(!complete.contains_key(&(0, 0)));
        assert!(complete.contains_key(&(1, 0)));

        exports.insert(positions[1]);
        let complete = complete_page_columns(positions.into_iter(), &exports, 4);
        assert_eq!(complete.get(&(0, 0)).map(Vec::len), Some(2));
    }

    #[test]
    fn empty_geometry_export_counts_as_present() {
        let pos = IVec3::new(0, 0, 0);
        let cache = PageExportCache {
            exports: [(pos, empty_export(pos))].into(),
            revision: 1,
        };
        let export_keys = cache.exports.keys().copied().collect();
        let complete = complete_page_columns(std::iter::once(pos), &export_keys, 4);
        assert!(complete.contains_key(&(0, 0)));
    }

    #[test]
    fn all_air_page_builds_a_complete_tree() {
        let cfg = ClodPagesConfig::load();
        let source = build_lod0_page_source(
            &[empty_export(IVec3::ZERO)],
            page_footprint((0, 0), &cfg),
            &cfg,
        )
        .unwrap();

        let result = build_quadtree(vec![((0, 0), source)], &cfg).unwrap();
        assert_eq!(result.nodes_by_level[0].len(), 1);
        assert!(result.nodes_by_level[0][0].mesh.indices.is_empty());
    }
}
