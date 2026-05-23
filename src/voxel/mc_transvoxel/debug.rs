use bevy::prelude::*;

use super::config::McTransvoxelSettings;
use super::stats::McTransvoxelRuntimeStats;

pub fn log_transition_stats_if_due(
    settings: &McTransvoxelSettings,
    stats: &McTransvoxelRuntimeStats,
    frame: u32,
) {
    if !settings.enabled || !settings.debug_log_transition_stats {
        return;
    }
    if frame % 120 != 0 {
        return;
    }
    let s = stats.aggregated;
    info!(
        "MC+Transvoxel stats (frame {frame}): regular_tris={} transition_tris={} transition_faces={:?} skipped_delta_gt_one={} mesh_ms={:.2}",
        s.triangle_count_regular,
        s.triangle_count_transition,
        s.transition_faces_meshed,
        s.skipped_lod_delta_gt_one,
        s.mesh_generation_ms_total,
    );
}
