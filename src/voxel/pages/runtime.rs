//! Phase 5 Step 3a — LOD0 live-mesh export cache maintenance.
//!
//! Default-ON (`ClodPagesRuntime.enabled`, D1-a) with `CLOD_PAGES=0` as the kill switch.
//! Reuses the EXACT live mesher with all-LOD0 neighbors, so the eventual
//! near/far bubble edge matches the live chunks by construction (I3.1). Off-thread
//! decimation + page assembly + entity commit land in Step 3b; this only fills the cache.
//!
//! NOTE: terrain is chunked in Y too, so a page footprint spans several Y chunks; this
//! caches per-chunk exports (all Y), and Step 3b groups them into P×P×Y page sources.

use bevy::prelude::*;
use std::collections::{BTreeMap, HashMap};

use super::config::ClodPagesConfig;
use super::export::TerrainMainSurfaceExport;
use crate::gameplay::camera::controller::PlayerCamera;
use crate::voxel::chunk::MeshDirtyReason;
use crate::voxel::runtime::ChunkGenerationState;
use crate::voxel::world::VoxelWorld;

#[derive(Resource)]
pub struct ClodPagesRuntime {
    pub cfg: ClodPagesConfig,
    /// Master gate. Default true; `CLOD_PAGES=0` is the release kill switch.
    pub enabled: bool,
    /// LOD0 pages assembled per frame by the build queue.
    pub source_budget_per_frame: usize,
    /// Chebyshev radius (chunks) out to which page sources are pre-meshed.
    pub source_radius_chunks: i32,
}

/// Reproducible bench/run A/B: pages default ON unless `CLOD_PAGES` is set false
/// (`0`/`false`/`off`/`no`). Lets a scripted bench run old live LOD via env kill switch.
/// `CLOD_PAGES_BUDGET` optionally overrides the per-frame page-source job budget.
fn env_default_on(key: &str) -> bool {
    !matches!(
        std::env::var(key).ok().as_deref().map(str::trim),
        Some("0") | Some("false") | Some("off") | Some("no")
    )
}

impl Default for ClodPagesRuntime {
    fn default() -> Self {
        let cfg = ClodPagesConfig::load();
        let p = cfg.page.chunks_per_page as i32;
        let levels = cfg.page.quadtree_levels as i32;
        // reach one top-level page footprint beyond the near-field bubble
        let source_radius_chunks = cfg.near_field.radius_chunks + p * (1 << (levels - 1).max(0));
        let source_budget_per_frame = std::env::var("CLOD_PAGES_BUDGET")
            .ok()
            .and_then(|v| v.trim().parse().ok())
            .unwrap_or(4);
        Self {
            cfg,
            enabled: env_default_on("CLOD_PAGES"),
            source_budget_per_frame,
            source_radius_chunks,
        }
    }
}

/// LOD0 main-surface exports keyed by chunk position, the input to the Step 3b page builder.
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

fn cheby(a: IVec3, b: IVec3) -> i32 {
    (a.x - b.x).abs().max((a.z - b.z).abs())
}

fn page_coord(chunk_pos: IVec3, chunks_per_page: i32) -> (i32, i32) {
    (
        chunk_pos.x.div_euclid(chunks_per_page),
        chunk_pos.z.div_euclid(chunks_per_page),
    )
}

/// Logs the initial page state once so bench output records whether the A/B ran pages-on.
pub fn clod_pages_startup_log_system(runtime: Res<ClodPagesRuntime>) {
    info!(
        "CLOD PAGES: source cache {} at startup (default ON; CLOD_PAGES=0 disables); radius {} chunks, page-source budget {}/frame. Alt+F11 toggles.",
        if runtime.enabled { "ON" } else { "OFF" },
        runtime.source_radius_chunks,
        runtime.source_budget_per_frame
    );
}

/// Alt+F11 toggles CLOD page source meshing on/off for A/B inspection + benching.
pub fn clod_pages_debug_toggle_system(
    keys: Res<ButtonInput<KeyCode>>,
    mut runtime: ResMut<ClodPagesRuntime>,
) {
    let alt = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);
    if alt && keys.just_pressed(KeyCode::F11) {
        runtime.enabled = !runtime.enabled;
        info!(
            "CLOD PAGES: source cache {} (radius {} chunks, page-source budget {}/frame)",
            if runtime.enabled { "ON" } else { "OFF" },
            runtime.source_radius_chunks,
            runtime.source_budget_per_frame
        );
    }
}

/// Maintains the page-source export cache filled by the live dirty mesher.
pub fn clod_pages_source_meshing_system(
    runtime: Res<ClodPagesRuntime>,
    gen_state: Res<ChunkGenerationState>,
    world: Res<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut cache: ResMut<PageExportCache>,
) {
    if !runtime.enabled {
        cache.clear_all();
        return;
    }
    if !gen_state.is_complete {
        cache.clear_all();
        return;
    }
    let Ok(cam) = camera_query.single() else {
        return;
    };
    let cam_chunk = VoxelWorld::world_to_chunk(cam.translation.as_ivec3());
    let far = runtime.source_radius_chunks;
    cache.retain_in_radius(cam_chunk, far);
    cache.invalidate_dirty_exports(&world);
    cache.refresh_complete_pages(&world, runtime.cfg.page.chunks_per_page as i32);
}
