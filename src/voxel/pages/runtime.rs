//! Phase 5 Step 3a — LOD0 live-mesh export cache maintenance.
//!
//! Default-OFF (`ClodPagesRuntime.enabled`, D4) for explicit A/B rollout.
//! Reuses the exact live LOD0 mesher output, so the near/far bubble edge matches the live
//! chunks by construction (I3.1). This module maintains the export cache consumed by the
//! async page assembly, decimation, and entity commit pipeline.
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
    /// Master gate. Default false; `CLOD_PAGES=1` opts into the page path.
    pub enabled: bool,
    /// LOD0 pages assembled per frame by the build queue.
    pub source_budget_per_frame: usize,
    /// Chebyshev radius (chunks) out to which page sources are pre-meshed.
    pub source_radius_chunks: i32,
}

/// Parses conventional boolean environment values without mutating process-global state.
/// Unknown values use `default` so each flag can choose its own rollout behavior.
pub(super) fn parse_env_bool(value: Option<&str>, default: bool) -> bool {
    let Some(value) = value.map(str::trim) else {
        return default;
    };
    if value == "1"
        || value.eq_ignore_ascii_case("true")
        || value.eq_ignore_ascii_case("on")
        || value.eq_ignore_ascii_case("yes")
    {
        true
    } else if value == "0"
        || value.eq_ignore_ascii_case("false")
        || value.eq_ignore_ascii_case("off")
        || value.eq_ignore_ascii_case("no")
    {
        false
    } else {
        default
    }
}

pub(super) fn env_bool(key: &str, default: bool) -> bool {
    parse_env_bool(std::env::var(key).ok().as_deref(), default)
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
            enabled: env_bool("CLOD_PAGES", false),
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
        "CLOD PAGES: {} at startup (default OFF; set CLOD_PAGES=1/true/on/yes to enable); radius {} chunks, page-source budget {}/frame. Alt+F11 toggles.",
        if runtime.enabled {
            "ENABLED"
        } else {
            "DISABLED"
        },
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

#[cfg(test)]
mod tests {
    use super::parse_env_bool;

    #[test]
    fn parse_env_bool_accepts_case_insensitive_true_values() {
        for value in ["1", "true", "TRUE", " on ", "Yes"] {
            assert!(parse_env_bool(Some(value), false), "value={value:?}");
        }
    }

    #[test]
    fn parse_env_bool_accepts_case_insensitive_false_values() {
        for value in ["0", "false", "FALSE", " off ", "No"] {
            assert!(!parse_env_bool(Some(value), true), "value={value:?}");
        }
    }

    #[test]
    fn parse_env_bool_uses_default_for_missing_empty_or_unknown_values() {
        for value in [None, Some(""), Some("unexpected")] {
            assert!(!parse_env_bool(value, false), "value={value:?}");
            assert!(parse_env_bool(value, true), "value={value:?}");
        }
    }
}
