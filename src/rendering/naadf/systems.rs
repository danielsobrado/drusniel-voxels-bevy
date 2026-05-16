use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use super::cache::NaadfCache;
use super::dirty::NaadfDirtyChunkQueue;
use super::preview::NaadfPreviewPipelineState;
use super::stats::{NaadfCacheState, NaadfRenderStatsBridge, NaadfStats};
use crate::performance::AreaTimingRecorder;
use crate::rendering::ray_tracing::RayTracingSettings;

pub const NAADF_STALE_CACHE_AGE_FRAMES: u32 = 120;

pub fn sync_naadf_stats_from_dirty_queue(
    queue: Res<NaadfDirtyChunkQueue>,
    cache: Res<NaadfCache>,
    mut stats: ResMut<NaadfStats>,
) {
    let queue_stats = queue.stats();
    stats.loaded_chunks = cache.len() as u32;
    stats.dirty_pending = queue_stats.pending as u32;
    stats.dirty_in_flight = queue_stats.in_flight as u32;
}

pub fn sync_naadf_backend_fallback_policy(
    state: Res<NaadfCacheState>,
    stats: Res<NaadfStats>,
    mut ray_tracing: ResMut<RayTracingSettings>,
) {
    ray_tracing.resolve_naadf_cache_policy(
        state.ready,
        state.warming,
        stats.gpu_build_queue_oldest_age_frames > NAADF_STALE_CACHE_AGE_FRAMES,
    );
}

pub fn sync_naadf_render_stats_bridge_to_stats(
    bridge: Res<NaadfRenderStatsBridge>,
    mut stats: ResMut<NaadfStats>,
) {
    let snapshot = bridge.snapshot();
    stats.gpu_memory_bytes = snapshot.gpu_memory_bytes;
    stats.gpu_max_chunks = snapshot.gpu_max_chunks;
    stats.gpu_uploaded_chunks_last_frame = snapshot.gpu_uploaded_chunks_last_frame;
    stats.gpu_uploaded_bytes_last_frame = snapshot.gpu_uploaded_bytes_last_frame;
    stats.gpu_max_ray_steps_last_frame = snapshot.gpu_max_ray_steps_last_frame;
    stats.gi_rays_last_frame = snapshot.gi_rays_last_frame;
    stats.preview_pixels_last_frame = snapshot.preview_pixels_last_frame;
    stats.preview_first_hit_dispatches_last_frame =
        snapshot.preview_first_hit_dispatches_last_frame;
    stats.preview_gi_dispatches_last_frame = snapshot.preview_gi_dispatches_last_frame;
    stats.preview_spatial_dispatches_last_frame = snapshot.preview_spatial_dispatches_last_frame;
    stats.preview_temporal_dispatches_last_frame = snapshot.preview_temporal_dispatches_last_frame;
    stats.preview_composite_passes_last_frame = snapshot.preview_composite_passes_last_frame;
    stats.preview_denoise_dispatches_last_frame = snapshot.preview_denoise_dispatches_last_frame;
    stats.preview_reference_dispatches_last_frame =
        snapshot.preview_reference_dispatches_last_frame;
    stats.preview_node_stage_last_frame = snapshot.preview_node_stage_last_frame;
}

pub fn record_naadf_bench_counters(
    stats: Res<NaadfStats>,
    preview_state: Res<NaadfPreviewPipelineState>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Res<FrameCount>,
) {
    let Some(timing) = timing.as_deref_mut() else {
        return;
    };

    timing.record_count(
        frame.0,
        "naadf.gpu_memory_bytes",
        stats.gpu_memory_bytes as f64,
    );
    timing.record_count(frame.0, "naadf.chunks_resident", stats.loaded_chunks as f64);
    timing.record_count(
        frame.0,
        "naadf.dirty_chunks_pending",
        stats.dirty_pending as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.gpu_build_queue_oldest_age_frames",
        stats.gpu_build_queue_oldest_age_frames as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.uploaded_chunks_last_frame",
        stats.gpu_uploaded_chunks_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.avg_ray_steps_last_frame",
        stats.gpu_avg_ray_steps_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.max_ray_steps_last_frame",
        stats.gpu_max_ray_steps_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_first_hit_dispatches_last_frame",
        stats.preview_first_hit_dispatches_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_active",
        preview_state.active as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_pixels_last_frame",
        stats.preview_pixels_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_node_stage_last_frame",
        stats.preview_node_stage_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_gi_dispatches_last_frame",
        stats.preview_gi_dispatches_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.gi_rays_last_frame",
        stats.gi_rays_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_spatial_dispatches_last_frame",
        stats.preview_spatial_dispatches_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_temporal_dispatches_last_frame",
        stats.preview_temporal_dispatches_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_composite_passes_last_frame",
        stats.preview_composite_passes_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_denoise_dispatches_last_frame",
        stats.preview_denoise_dispatches_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.preview_reference_dispatches_last_frame",
        stats.preview_reference_dispatches_last_frame as f64,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_cache_threshold_is_release_gate_value() {
        assert_eq!(NAADF_STALE_CACHE_AGE_FRAMES, 120);
    }
}
