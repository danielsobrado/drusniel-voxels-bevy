//! CLOD pages Bevy plugin. Registers default-off source capture and async page builds.

use bevy::prelude::*;

use crate::voxel::runtime::VoxelTerrainSet;

use super::border_lock_export::{
    ClodBorderLockExportSettings, ClodBorderLockExportState, clod_border_lock_export_system,
};
use super::build_queue::{
    ClodPageBuildQueue, ClodPageTree, clod_pages_build_queue_system,
    clod_pages_build_task_poll_system,
};
use super::crossfade_runtime::{
    ClodCrossfadeFrameClock, ClodCrossfadeRuntimeSettings, ClodCrossfadeRuntimeState,
    clod_crossfade_runtime_bridge_system,
};
use super::crossfade_stats_export::{
    ClodCrossfadeStatsExportSettings, ClodCrossfadeStatsExportState,
    clod_crossfade_stats_export_system,
};
use super::cut_freeze_export::{
    ClodCutFreezeExportSettings, ClodCutFreezeExportState, clod_cut_freeze_export_system,
};
use super::fade_material::{ClodFadeMaterialSettings, clod_page_fade_material_system};
use super::ownership::{
    ClodPageMeshGate, clod_page_chunk_ownership_system, refresh_clod_page_mesh_gate_system,
};
use super::rebuild_observer::{
    ClodRebuildObserverSettings, ClodRebuildObserverState, clod_rebuild_observer_system,
};
use super::render::{ClodPageMeshCommitState, clod_page_mesh_commit_system};
use super::runtime::{
    ClodPagesRuntime, PageExportCache, PageSourceMeshingQueue,
    clod_pages_source_meshing_system, clod_pages_startup_log_system,
};
use super::runtime_stats_export::{
    ClodRuntimeStatsExportSettings, ClodRuntimeStatsExportState, clod_runtime_stats_export_system,
};
use super::selection::{
    ClodPageSelectionIndex, ClodPageSelectionState, ClodSelectionDebugControls,
    ClodSelectionRuntimeStats, clod_page_selection_system,
};
use super::simplify_export::{
    ClodSimplifyExportSettings, ClodSimplifyExportState, clod_simplify_export_system,
};
use super::summary::{
    TerrainSummaryField, TerrainSummaryRebuildState, terrain_summary_rebuild_system,
};
use super::topology_export::{
    ClodTopologyExportSettings, ClodTopologyExportState, clod_topology_export_system,
};
use super::weld_export::{ClodWeldExportSettings, ClodWeldExportState, clod_weld_export_system};

pub struct ClodPagesPlugin;

impl Plugin for ClodPagesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodPagesRuntime>()
            .init_resource::<PageExportCache>()
            .init_resource::<PageSourceMeshingQueue>()
            .init_resource::<ClodPageBuildQueue>()
            .init_resource::<ClodPageTree>()
            .init_resource::<ClodPageMeshCommitState>()
            .init_resource::<ClodPageSelectionIndex>()
            .init_resource::<ClodPageSelectionState>()
            .init_resource::<ClodSelectionDebugControls>()
            .init_resource::<ClodSelectionRuntimeStats>()
            .init_resource::<ClodPageMeshGate>()
            .init_resource::<TerrainSummaryField>()
            .init_resource::<TerrainSummaryRebuildState>()
            .init_resource::<ClodRuntimeStatsExportSettings>()
            .init_resource::<ClodRuntimeStatsExportState>()
            .init_resource::<ClodRebuildObserverSettings>()
            .init_resource::<ClodRebuildObserverState>()
            .init_resource::<ClodCrossfadeRuntimeSettings>()
            .init_resource::<ClodCrossfadeFrameClock>()
            .init_resource::<ClodCrossfadeRuntimeState>()
            .init_resource::<ClodCrossfadeStatsExportSettings>()
            .init_resource::<ClodCrossfadeStatsExportState>()
            .init_resource::<ClodCutFreezeExportSettings>()
            .init_resource::<ClodCutFreezeExportState>()
            .init_resource::<ClodBorderLockExportSettings>()
            .init_resource::<ClodBorderLockExportState>()
            .init_resource::<ClodTopologyExportSettings>()
            .init_resource::<ClodTopologyExportState>()
            .init_resource::<ClodSimplifyExportSettings>()
            .init_resource::<ClodSimplifyExportState>()
            .init_resource::<ClodWeldExportSettings>()
            .init_resource::<ClodWeldExportState>()
            .init_resource::<ClodFadeMaterialSettings>()
            .add_systems(Startup, clod_pages_startup_log_system)
            // Source meshing borrows VoxelWorld immutably after the live dirty mesher.
            .add_systems(
                Update,
                clod_pages_source_meshing_system.after(VoxelTerrainSet::MeshDirty),
            )
            .add_systems(
                Update,
                clod_pages_build_queue_system.after(clod_pages_source_meshing_system),
            )
            .add_systems(
                Update,
                clod_pages_build_task_poll_system.after(clod_pages_build_queue_system),
            )
            .add_systems(
                Update,
                (
                    clod_rebuild_observer_system,
                    clod_border_lock_export_system,
                    clod_topology_export_system,
                    clod_simplify_export_system,
                    clod_weld_export_system,
                )
                    .after(clod_pages_build_task_poll_system)
                    .before(clod_page_mesh_commit_system),
            )
            .add_systems(
                Update,
                clod_page_mesh_commit_system.after(clod_pages_build_task_poll_system),
            )
            .add_systems(
                Update,
                clod_page_selection_system.after(clod_page_mesh_commit_system),
            )
            .add_systems(
                Update,
                clod_crossfade_runtime_bridge_system.after(clod_page_selection_system),
            )
            .add_systems(
                Update,
                clod_page_fade_material_system.after(clod_crossfade_runtime_bridge_system),
            )
            .add_systems(
                Update,
                (
                    clod_runtime_stats_export_system,
                    clod_crossfade_stats_export_system,
                    clod_cut_freeze_export_system,
                )
                    .after(clod_page_fade_material_system),
            )
            .add_systems(
                Update,
                (
                    refresh_clod_page_mesh_gate_system,
                    terrain_summary_rebuild_system,
                )
                    .chain()
                    .after(clod_runtime_stats_export_system)
                    .after(clod_crossfade_stats_export_system)
                    .after(clod_cut_freeze_export_system),
            )
            .add_systems(
                Update,
                clod_page_chunk_ownership_system
                    .after(refresh_clod_page_mesh_gate_system)
                    .after(VoxelTerrainSet::MeshDirty),
            );
    }
}
