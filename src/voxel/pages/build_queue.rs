//! Phase 5 Step 3b part 1: assemble complete LOD0 page sources on the main thread and
//! build their quadtree on the async compute pool.

use std::collections::VecDeque;
#[cfg(test)]
use std::collections::{BTreeMap, HashSet};

use bevy::prelude::*;
use bevy::tasks::{AsyncComputeTaskPool, Task, block_on, poll_once};

use super::config::ClodPagesConfig;
use super::diagonal_polish::DiagonalPolishStats;
use super::export::TerrainMainSurfaceExport;
use super::quadtree::{BuildResult, ClodPageNode, build_quadtree};
use super::runtime::{ClodPagesRuntime, PageExportCache};
use super::source_mesh::{PageSource, build_lod0_page_source};
use super::types::{ClodBuildError, PageFootprint};
use crate::voxel::runtime::ChunkGenerationState;
use crate::voxel::world::VoxelWorld;

pub type ClodPageCoord = (i32, i32);

const BUILD_DEBOUNCE_FRAMES: u32 = 3;

fn env_truthy(key: &str) -> bool {
    matches!(
        std::env::var(key).ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("on") | Some("yes")
    )
}

pub enum ClodPageBuildStatus {
    Building,
    Ready,
    Failed(ClodBuildError),
}

/// The latest complete tree. Existing nodes remain available while a replacement builds.
#[derive(Resource, Default)]
pub struct ClodPageTree {
    pub nodes_by_level: Vec<Vec<ClodPageNode>>,
    pub polish: DiagonalPolishStats,
    /// Increments only when a complete replacement tree is published.
    pub revision: u64,
    /// Coordinates represented by `nodes_by_level`.
    pub page_coords: Vec<ClodPageCoord>,
    /// Coordinates involved in the current or most recent build attempt.
    pub build_page_coords: Vec<ClodPageCoord>,
    pub status: Option<ClodPageBuildStatus>,
}

struct PendingPageSource {
    coord: ClodPageCoord,
    exports: Vec<TerrainMainSurfaceExport>,
    footprint: PageFootprint,
}

struct PageAssembly {
    signature: PageInputSignature,
    page_coords: Vec<ClodPageCoord>,
    pending: VecDeque<PendingPageSource>,
    in_flight: Vec<Task<Result<(ClodPageCoord, PageSource), ClodBuildError>>>,
    sources: Vec<(ClodPageCoord, PageSource)>,
}

struct PendingTreeBuild {
    signature: PageInputSignature,
    page_coords: Vec<ClodPageCoord>,
    task: Task<Result<BuildResult, ClodBuildError>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PageInputSignature {
    page_coords: Vec<ClodPageCoord>,
    content_revision: u64,
}

#[derive(Resource, Default)]
pub(crate) struct ClodPageBuildQueue {
    observed_signature: Option<PageInputSignature>,
    stable_frames: u32,
    last_published_signature: Option<PageInputSignature>,
    assembly: Option<PageAssembly>,
    task: Option<PendingTreeBuild>,
}

impl ClodPageBuildQueue {
    fn clear(&mut self) {
        self.observed_signature = None;
        self.stable_frames = 0;
        self.last_published_signature = None;
        self.assembly = None;
        self.task = None;
    }

    fn observe_signature(&mut self, signature: PageInputSignature) -> bool {
        if self.observed_signature.as_ref() == Some(&signature) {
            return false;
        }

        self.observed_signature = Some(signature);
        self.stable_frames = 0;
        true
    }
}

#[cfg(test)]
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

#[cfg(test)]
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

fn mix_export_signature(mut signature: u64, pos: IVec3, export_revision: u64) -> u64 {
    signature = signature.wrapping_mul(1_099_511_628_211);
    signature ^= pos.x as u32 as u64;
    signature = signature.wrapping_mul(1_099_511_628_211);
    signature ^= pos.y as u32 as u64;
    signature = signature.wrapping_mul(1_099_511_628_211);
    signature ^= pos.z as u32 as u64;
    signature = signature.wrapping_mul(1_099_511_628_211);
    signature ^ export_revision
}

fn page_inputs_from_cache(
    cache: &PageExportCache,
    cfg: &ClodPagesConfig,
) -> Result<Option<(PageInputSignature, VecDeque<PendingPageSource>)>, ClodBuildError> {
    if cache.complete_pages.is_empty() {
        return Ok(None);
    }

    let mut page_coords = Vec::with_capacity(cache.complete_pages.len());
    let mut pending = VecDeque::with_capacity(cache.complete_pages.len());
    let mut content_revision = 14_695_981_039_346_656_037u64;
    for (&coord, chunk_positions) in &cache.complete_pages {
        page_coords.push(coord);
        let mut exports = Vec::with_capacity(chunk_positions.len());
        for &pos in chunk_positions {
            let export = cache.exports.get(&pos).cloned().ok_or_else(|| {
                ClodBuildError::PageIncomplete(format!(
                    "page {:?} complete-page snapshot is missing chunk export {:?}",
                    coord, pos
                ))
            })?;
            content_revision = mix_export_signature(content_revision, pos, export.revision);
            exports.push(export);
        }
        pending.push_back(PendingPageSource {
            coord,
            exports,
            footprint: page_footprint(coord, cfg),
        });
    }

    Ok(Some((
        PageInputSignature {
            page_coords,
            content_revision,
        },
        pending,
    )))
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
    if !gen_state.is_complete {
        if !tree.nodes_by_level.is_empty()
            || !tree.build_page_coords.is_empty()
            || tree.status.is_some()
        {
            tree.nodes_by_level.clear();
            tree.polish = DiagonalPolishStats::default();
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

    let Some((signature, pending_pages)) = (match page_inputs_from_cache(&cache, &runtime.cfg) {
        Ok(result) => result,
        Err(error) => {
            fail_build(&mut tree, Vec::new(), error);
            return;
        }
    }) else {
        return;
    };

    if env_truthy("CLOD_PAGES_FORCE_FAIL") {
        let page_coords = signature.page_coords.clone();
        if tree.build_page_coords != page_coords
            || !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Failed(_)))
        {
            fail_build(
                &mut tree,
                page_coords,
                ClodBuildError::DirtyInput(
                    "forced by CLOD_PAGES_FORCE_FAIL for fallback verification".to_string(),
                ),
            );
        }
        queue.clear();
        return;
    }

    if queue.observe_signature(signature.clone()) {
        if matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Building)) {
            tree.build_page_coords.clear();
            tree.status = None;
        }
        if queue.task.is_none() {
            queue.assembly = None;
        }
    }

    if queue.stable_frames < BUILD_DEBOUNCE_FRAMES {
        queue.stable_frames += 1;
        return;
    }
    if queue.task.is_some() {
        return;
    }

    if queue.assembly.is_none() {
        if queue.last_published_signature.as_ref() == Some(&signature)
            && matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready))
        {
            return;
        }

        let page_coords = signature.page_coords.clone();
        tree.build_page_coords = signature.page_coords.clone();
        tree.status = Some(ClodPageBuildStatus::Building);
        queue.assembly = Some(PageAssembly {
            signature,
            page_coords,
            pending: pending_pages,
            in_flight: Vec::new(),
            sources: Vec::new(),
        });
    }

    let source_budget = runtime.source_budget_per_frame.max(1);
    let mut source_error = None;
    if let Some(assembly) = queue.assembly.as_mut() {
        for _ in 0..source_budget {
            let Some(page) = assembly.pending.pop_front() else {
                break;
            };
            let cfg = runtime.cfg.clone();
            assembly
                .in_flight
                .push(AsyncComputeTaskPool::get().spawn(async move {
                    build_lod0_page_source(&page.exports, page.footprint, &cfg)
                        .map(|source| (page.coord, source))
                }));
        }

        let mut still_running = Vec::with_capacity(assembly.in_flight.len());
        for mut task in assembly.in_flight.drain(..) {
            match block_on(poll_once(&mut task)) {
                Some(Ok((coord, source))) => assembly.sources.push((coord, source)),
                Some(Err(error)) => {
                    source_error = Some(error);
                    break;
                }
                None => still_running.push(task),
            }
        }
        assembly.in_flight = still_running;
    }

    if let Some(error) = source_error {
        let page_coords = queue
            .assembly
            .take()
            .expect("page assembly exists")
            .page_coords;
        fail_build(&mut tree, page_coords, error);
        return;
    }

    let assembly_complete = queue
        .assembly
        .as_ref()
        .is_some_and(|assembly| assembly.pending.is_empty() && assembly.in_flight.is_empty());
    if !assembly_complete {
        return;
    }

    let assembly = queue.assembly.take().expect("page assembly exists");
    let page_coords = assembly.page_coords;
    let signature = assembly.signature;
    let cfg = runtime.cfg.clone();
    let task =
        AsyncComputeTaskPool::get().spawn(async move { build_quadtree(assembly.sources, &cfg) });
    queue.task = Some(PendingTreeBuild {
        signature,
        page_coords,
        task,
    });
}

/// Polls the single in-flight quadtree build and atomically publishes only a complete result.
pub(crate) fn clod_pages_build_task_poll_system(
    gen_state: Res<ChunkGenerationState>,
    mut queue: ResMut<ClodPageBuildQueue>,
    mut tree: ResMut<ClodPageTree>,
) {
    if !gen_state.is_complete {
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

    match result {
        Ok(result) => {
            let polish = result.polish;
            tree.nodes_by_level = result.nodes_by_level;
            tree.polish = polish;
            tree.revision = tree.revision.wrapping_add(1);
            tree.page_coords = pending.page_coords.clone();
            tree.build_page_coords = pending.page_coords;
            tree.status = Some(ClodPageBuildStatus::Ready);
            queue.last_published_signature = Some(pending.signature);
            info!(
                "CLOD page diagonal polish: candidates={} flips={} rejected={} avg_gain={:.4}",
                polish.candidate_quads,
                polish.flipped,
                polish.rejected_degenerate
                    + polish.rejected_winding
                    + polish.rejected_locked_border
                    + polish.rejected_no_improvement,
                polish.average_score_improvement
            );
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
            ..Default::default()
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
