//! Phase 5 Step 3a — main-thread LOD0 source meshing into a per-chunk export cache.
//!
//! Default-OFF (`ClodPagesRuntime.enabled`, D4) so it is zero-cost until you flip it on for
//! A/B + bench. Reuses the EXACT live mesher with all-LOD0 neighbors, so the eventual
//! near/far bubble edge matches the live chunks by construction (I3.1). Off-thread
//! decimation + page assembly + entity commit land in Step 3b; this only fills the cache.
//!
//! NOTE: terrain is chunked in Y too, so a page footprint spans several Y chunks; this
//! caches per-chunk exports (all Y), and Step 3b groups them into P×P×Y page sources.

use bevy::prelude::*;
use std::collections::HashMap;

use super::config::ClodPagesConfig;
use super::export::{extract_main_surface_for_clod, TerrainMainSurfaceExport};
use crate::gameplay::camera::controller::PlayerCamera;
use crate::rendering::ao_config::{AmbientOcclusionConfig, BakedAoConfig};
use crate::voxel::chunk::LodLevel;
use crate::voxel::meshing::{
    generate_chunk_mesh_for_request, MeshForensicsOptions, MeshMode, MeshRequest, WaterAirExposureMode,
};
use crate::voxel::runtime::ChunkGenerationState;
use crate::voxel::skirt::{NeighborLods, SkirtConfig};
use crate::voxel::world::VoxelWorld;

#[derive(Resource)]
pub struct ClodPagesRuntime {
    pub cfg: ClodPagesConfig,
    /// Master gate. Default false — zero cost when off.
    pub enabled: bool,
    /// Chunks meshed-for-export per frame (throttle, like the dirty-mesh budget).
    pub source_budget_per_frame: usize,
    /// Chebyshev radius (chunks) out to which page sources are pre-meshed.
    pub source_radius_chunks: i32,
}

/// Reproducible bench/run A/B: start with pages ON if `CLOD_PAGES` is set to a truthy value
/// (`1`/`true`/`on`). Lets a scripted bench run entirely pages-on without a manual Alt+F11.
/// `CLOD_PAGES_BUDGET` optionally overrides the per-frame source-mesh budget.
fn env_truthy(key: &str) -> bool {
    matches!(
        std::env::var(key).ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("on") | Some("yes")
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
            enabled: env_truthy("CLOD_PAGES"),
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
}

fn all_lod0_neighbors() -> NeighborLods {
    let l = Some(LodLevel::Lod0);
    NeighborLods {
        neg_x: l,
        pos_x: l,
        neg_y: l,
        pos_y: l,
        neg_z: l,
        pos_z: l,
    }
}

/// Mesh one chunk at LOD0 (all-LOD0 neighbors → no seam/skirt transitions) and extract its
/// main-surface export. Reuses the live mesher so page geometry matches live chunks exactly.
pub fn mesh_lod0_export(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    skirt_config: &SkirtConfig,
    ao_baked: &BakedAoConfig,
) -> Option<TerrainMainSurfaceExport> {
    let chunk = world.get_chunk(chunk_pos)?;
    let result = generate_chunk_mesh_for_request(MeshRequest {
        chunk,
        world,
        mode: MeshMode::SurfaceNets,
        logical_lod: LodLevel::Lod0,
        mesh_lod: LodLevel::Lod0,
        neighbor_lods: all_lod0_neighbors(),
        skirt_config,
        ao_config: ao_baked,
        water_exposure_mode: WaterAirExposureMode::default(),
        forensics: MeshForensicsOptions::default(),
        neighbor_strips: None,
        strip_status: None,
        mc_settings: None,
        timing_enabled: false,
    });
    extract_main_surface_for_clod(&result.solid, chunk_pos, LodLevel::Lod0, 0).ok()
}

fn cheby(a: IVec3, b: IVec3) -> i32 {
    (a.x - b.x).abs().max((a.z - b.z).abs())
}

/// Logs the initial page state once so bench output records whether the A/B ran pages-on.
pub fn clod_pages_startup_log_system(runtime: Res<ClodPagesRuntime>) {
    info!(
        "CLOD PAGES: source meshing {} at startup (CLOD_PAGES env); radius {} chunks, budget {}/frame. Alt+F11 toggles.",
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
            "CLOD PAGES: source meshing {} (radius {} chunks, budget {}/frame)",
            if runtime.enabled { "ON" } else { "OFF" },
            runtime.source_radius_chunks,
            runtime.source_budget_per_frame
        );
    }
}

/// Default-off. Pre-mesh LOD0 page-source exports for loaded chunks in the far-field band
/// around the camera, throttled, evicting entries that drift out of range.
pub fn clod_pages_source_meshing_system(
    runtime: Res<ClodPagesRuntime>,
    gen_state: Res<ChunkGenerationState>,
    world: Res<VoxelWorld>,
    skirt_config: Res<SkirtConfig>,
    ao_config: Res<AmbientOcclusionConfig>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut cache: ResMut<PageExportCache>,
) {
    if !runtime.enabled {
        if !cache.exports.is_empty() {
            cache.exports.clear();
            cache.revision = cache.revision.wrapping_add(1);
        }
        return;
    }
    // Never build pages during initial world generation — let the live mesher drain its
    // queue first (pages are a far-field feature; this also keeps startup off our critical path).
    if !gen_state.is_complete {
        return;
    }
    let Ok(cam) = camera_query.single() else {
        return;
    };
    let cam_chunk = VoxelWorld::world_to_chunk(cam.translation.as_ivec3());
    let near = runtime.cfg.near_field.radius_chunks;
    let far = runtime.source_radius_chunks;

    let previous_len = cache.exports.len();
    cache.exports.retain(|pos, _| cheby(*pos, cam_chunk) <= far);
    if cache.exports.len() != previous_len {
        cache.revision = cache.revision.wrapping_add(1);
    }

    let mut candidates: Vec<IVec3> = world
        .chunk_positions()
        .filter(|pos| {
            let r = cheby(*pos, cam_chunk);
            r > near && r <= far && !cache.exports.contains_key(pos)
        })
        .collect();
    candidates.sort_by_key(|pos| cheby(*pos, cam_chunk));

    for pos in candidates.into_iter().take(runtime.source_budget_per_frame) {
        if let Some(export) = mesh_lod0_export(&world, pos, &skirt_config, &ao_config.baked) {
            cache.exports.insert(pos, export);
            cache.revision = cache.revision.wrapping_add(1);
        }
    }
}
