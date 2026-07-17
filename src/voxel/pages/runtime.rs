//! Phase 5 CLOD runtime configuration and LOD0 export cache.
//!
//! Pages remain default-off for explicit A/B rollout. Set `CLOD_PAGES=1` to enable them.

use bevy::prelude::*;
use std::collections::{BTreeMap, HashMap};

use super::config::ClodPagesConfig;
use super::export::TerrainMainSurfaceExport;
use crate::voxel::chunk::MeshDirtyReason;
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
        let chunks_per_page = cfg.page.chunks_per_page as i32;
        let levels = cfg.page.quadtree_levels as i32;
        let source_radius_chunks = cfg.near_field.radius_chunks
            + chunks_per_page * (1 << (levels - 1).max(0));
        Self {
            cfg,
            enabled: clod_pages_enabled(),
            source_budget_per_frame: env_usize("CLOD_PAGES_BUDGET", 4),
            source_mesh_budget_per_frame: env_usize(
                "CLOD_PAGES_SOURCE_MESH_BUDGET",
                DEFAULT_SOURCE_MESH_BUDGET_PER_FRAME,
            ),
            source_radius_chunks,
        }
    }
}

/// LOD0 main-surface exports keyed by chunk position, consumed by the async page builder.
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

    pub(crate) fn remove_export(&mut self, chunk_pos: IVec3) -> bool {
        let removed = self.exports.remove(&chunk_pos).is_some();
        if removed {
            self.revision = self.revision.wrapping_add(1);
        }
        removed
    }

    pub(crate) fn retain_in_radius(&mut self, cam_chunk: IVec3, far: i32) -> bool {
        let previous_len = self.exports.len();
        self.exports
            .retain(|position, _| horizontal_chunk_distance(*position, cam_chunk) <= far);
        let changed = self.exports.len() != previous_len;
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
        changed
    }

    pub(crate) fn invalidate_dirty_exports(&mut self, world: &VoxelWorld) -> bool {
        let invalidation_mask =
            MeshDirtyReason::Generation.bit() | MeshDirtyReason::TerrainMutation.bit();
        let dirty_positions = world
            .dirty_chunks()
            .filter(|position| {
                world.get_chunk(*position).is_some_and(|chunk| {
                    chunk.dirty_reason_flags() & invalidation_mask != 0
                })
            })
            .collect::<Vec<_>>();

        let mut changed = false;
        for position in dirty_positions {
            changed |= self.exports.remove(&position).is_some();
        }
        if changed {
            self.revision = self.revision.wrapping_add(1);
        }
        changed
    }

    pub(crate) fn refresh_complete_pages(
        &mut self,
        world: &VoxelWorld,
        chunks_per_page: i32,
    ) {
        let world_chunk_count = world.chunk_count();
        if self.complete_pages_revision == self.revision
            && self.complete_pages_world_chunk_count == world_chunk_count
        {
            return;
        }

        let mut columns: BTreeMap<(i32, i32), Vec<IVec3>> = BTreeMap::new();
        for position in world.chunk_positions() {
            columns
                .entry(page_coord(position, chunks_per_page))
                .or_default()
                .push(position);
        }
        columns.retain(|_, positions| {
            positions
                .iter()
                .all(|position| self.exports.contains_key(position))
        });
        for positions in columns.values_mut() {
            positions.sort_by_key(|position| (position.x, position.z, position.y));
        }

        self.complete_pages = columns;
        self.complete_pages_revision = self.revision;
        self.complete_pages_world_chunk_count = world_chunk_count;
    }
}

pub(crate) fn horizontal_chunk_distance(a: IVec3, b: IVec3) -> i32 {
    (a.x - b.x).abs().max((a.z - b.z).abs())
}

fn page_coord(chunk_pos: IVec3, chunks_per_page: i32) -> (i32, i32) {
    (
        chunk_pos.x.div_euclid(chunks_per_page),
        chunk_pos.z.div_euclid(chunks_per_page),
    )
}

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
