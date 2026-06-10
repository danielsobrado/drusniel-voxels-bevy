use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::performance::AreaTimingRecorder;
use crate::rendering::naadf::cache::NaadfCache;
use crate::rendering::naadf::config::NaadfConfig;
use crate::rendering::naadf::dirty::NaadfDirtyChunkQueue;
use crate::rendering::naadf::preview::NaadfPreviewPipelineState;
use crate::rendering::naadf::stats::{NaadfCacheState, NaadfRenderStatsBridge, NaadfStats};
use crate::rendering::radiance_cascades::{
    NAADF_QUERY_CONTACT_SHADOW, NAADF_QUERY_GI_SECONDARY, NAADF_QUERY_SUN_VISIBILITY,
    NAADF_QUERY_TERRAIN_AO, RadianceCascadesConfig, SdfVolumeState,
    naadf_gi_shader_backend_available, radiance_cascade_pass_active,
};
use crate::rendering::ray_tracing::{RayTracingSettings, VoxelRayBackendMode};

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
    stats.gpu_uploaded_chunks_peak = stats
        .gpu_uploaded_chunks_peak
        .max(snapshot.gpu_uploaded_chunks_last_frame);
    stats.gpu_uploaded_bytes_last_frame = snapshot.gpu_uploaded_bytes_last_frame;
    stats.gpu_avg_ray_steps_last_frame = snapshot.gpu_avg_ray_steps_last_frame;
    stats.gpu_max_ray_steps_last_frame = snapshot.gpu_max_ray_steps_last_frame;
    stats.gpu_ray_samples_last_frame = snapshot.gpu_ray_samples_last_frame;
    stats.first_hit_ray_hits_last_frame = snapshot.first_hit_ray_hits_last_frame;
    stats.first_hit_ray_misses_last_frame = snapshot.first_hit_ray_misses_last_frame;
    stats.first_hit_clean_misses_last_frame = snapshot.first_hit_clean_misses_last_frame;
    stats.first_hit_voxel_budget_misses_last_frame =
        snapshot.first_hit_voxel_budget_misses_last_frame;
    stats.first_hit_chunk_budget_misses_last_frame =
        snapshot.first_hit_chunk_budget_misses_last_frame;
    stats.first_hit_distance_clamps_last_frame = snapshot.first_hit_distance_clamps_last_frame;
    stats.first_hit_no_lookup_misses_last_frame = snapshot.first_hit_no_lookup_misses_last_frame;
    stats.gi_rays_last_frame = snapshot.gi_rays_last_frame;
    stats.local_lights_visible = snapshot.local_lights_visible;
    stats.local_lights_uploaded = snapshot.local_lights_uploaded;
    stats.local_lights_culled = snapshot.local_lights_culled;
    stats.local_light_shadow_rays_last_frame = snapshot.local_light_shadow_rays_last_frame;
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
    stats.path_b_depth_rejects_last_frame = snapshot.path_b_depth_rejects_last_frame;
    stats.path_b_coverage_rejects_last_frame = snapshot.path_b_coverage_rejects_last_frame;
    stats.path_b_naadf_accepts_last_frame = snapshot.path_b_naadf_accepts_last_frame;
    stats.path_b_current_kept_last_frame = snapshot.path_b_current_kept_last_frame;
    stats.path_b_refine_requests_last_frame = snapshot.path_b_refine_requests_last_frame;
    stats.missing_fine_mip_requests_last_frame = snapshot.path_b_refine_requests_last_frame;
    stats.path_b_stale_or_unresident_last_frame = snapshot.path_b_stale_or_unresident_last_frame;
    stats.path_b_ownership_changes_last_frame = snapshot.path_b_ownership_changes_last_frame;
    stats.path_b_composite_passes_last_frame = snapshot.path_b_composite_passes_last_frame;
}

pub fn record_naadf_bench_counters(
    stats: Res<NaadfStats>,
    config: Res<NaadfConfig>,
    cache_state: Res<NaadfCacheState>,
    preview_state: Res<NaadfPreviewPipelineState>,
    radiance_config: Option<Res<RadianceCascadesConfig>>,
    sdf_state: Option<Res<SdfVolumeState>>,
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
        "naadf.streaming_interest_chunks",
        stats.streaming_interest_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.streaming_interest_missing_gpu_slots",
        stats.streaming_interest_missing_gpu_slots as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.streaming_interest_missing_gpu_slots_far_ring",
        stats.streaming_interest_missing_gpu_slots_far_ring as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.streaming_mip0_chunks",
        stats.streaming_mip0_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.streaming_mip1_chunks",
        stats.streaming_mip1_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.streaming_mip2_chunks",
        stats.streaming_mip2_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.streaming_mip3_chunks",
        stats.streaming_mip3_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.streaming_mip4_chunks",
        stats.streaming_mip4_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.missing_fine_mip_requests_last_frame",
        stats.missing_fine_mip_requests_last_frame as f64,
    );
    timing.record_count(frame.0, "naadf.gpu_slots_used", stats.gpu_slots_used as f64);
    timing.record_count(
        frame.0,
        "naadf.gpu_slots_available",
        stats.gpu_slots_available as f64,
    );
    timing.record_count(frame.0, "naadf.gpu_max_chunks", stats.gpu_max_chunks as f64);
    let slot_coverage = if stats.loaded_chunks == 0 {
        1.0
    } else {
        stats.gpu_slots_used as f64 / stats.loaded_chunks as f64
    };
    timing.record_count(frame.0, "naadf.gpu_slot_coverage", slot_coverage);
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
        "naadf.uploaded_chunks_peak",
        stats.gpu_uploaded_chunks_peak as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.gpu_uploads_pending",
        stats.gpu_uploads_pending as f64,
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
        "naadf.ray_samples_last_frame",
        stats.gpu_ray_samples_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.first_hit_ray_hits_last_frame",
        stats.first_hit_ray_hits_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.first_hit_ray_misses_last_frame",
        stats.first_hit_ray_misses_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.first_hit_voxel_budget_misses_last_frame",
        stats.first_hit_voxel_budget_misses_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.first_hit_chunk_budget_misses_last_frame",
        stats.first_hit_chunk_budget_misses_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.first_hit_distance_clamps_last_frame",
        stats.first_hit_distance_clamps_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.first_hit_no_lookup_misses_last_frame",
        stats.first_hit_no_lookup_misses_last_frame as f64,
    );
    let radiance_query_mask = radiance_config
        .as_deref()
        .filter(|config| config.enabled && config.voxel_backend == VoxelRayBackendMode::Naadf)
        .map(|config| config.voxel_backend_query_mask)
        .unwrap_or_default();

    timing.record_count(
        frame.0,
        "naadf.radiance_backend_available",
        naadf_gi_shader_backend_available(Some(&config), Some(&cache_state), Some(&stats)) as u32
            as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.radiance_query_mask",
        radiance_query_mask as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.radiance_sun_visibility_rays_per_pixel",
        if radiance_query_mask & NAADF_QUERY_SUN_VISIBILITY != 0 {
            1.0
        } else {
            0.0
        },
    );
    timing.record_count(
        frame.0,
        "naadf.radiance_contact_shadow_rays_per_pixel",
        if radiance_query_mask & NAADF_QUERY_CONTACT_SHADOW != 0 {
            1.0
        } else {
            0.0
        },
    );
    timing.record_count(
        frame.0,
        "naadf.radiance_gi_secondary_rays_per_pixel",
        if radiance_query_mask & NAADF_QUERY_GI_SECONDARY != 0 {
            2.0
        } else {
            0.0
        },
    );
    timing.record_count(
        frame.0,
        "naadf.radiance_terrain_ao_rays_per_pixel",
        if radiance_query_mask & NAADF_QUERY_TERRAIN_AO != 0 {
            4.0
        } else {
            0.0
        },
    );
    timing.record_count(
        frame.0,
        "naadf.radiance_short_range_rays_per_pixel",
        stats.radiance_short_range_rays_per_pixel as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.froxel_sun_mask_active",
        stats.froxel_sun_mask_active as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.froxel_sun_mask_rays_per_full_update",
        stats.froxel_sun_mask_rays_per_full_update as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.froxel_sun_mask_max_rays_per_frame",
        stats.froxel_sun_mask_max_rays_per_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.froxel_sun_mask_frames_per_full_update",
        stats.froxel_sun_mask_frames_per_full_update as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.static_proxy_volumes",
        stats.static_proxy_volumes as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.static_proxy_skipped",
        stats.static_proxy_skipped as f64,
    );
    if let Some(radiance_config) = radiance_config.as_deref() {
        timing.record_count(
            frame.0,
            "naadf.radiance_cascade_pass_active",
            radiance_cascade_pass_active(radiance_config) as u32 as f64,
        );
    }
    if let Some(sdf_state) = sdf_state.as_deref() {
        timing.record_count(
            frame.0,
            "naadf.sdf_volume_update_needed",
            sdf_state.sdf_update_needed_last_frame as u32 as f64,
        );
        timing.record_count(
            frame.0,
            "naadf.sdf_volume_skipped_for_naadf",
            sdf_state.sdf_updates_skipped_for_naadf as f64,
        );
        timing.record_count(
            frame.0,
            "naadf.lighting_history_dirty_generation",
            sdf_state.naadf_dirty_history_generation as f64,
        );
    }
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
        "naadf.local_lights_visible",
        stats.local_lights_visible as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.local_lights_uploaded",
        stats.local_lights_uploaded as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.local_lights_culled",
        stats.local_lights_culled as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.local_light_shadow_rays_last_frame",
        stats.local_light_shadow_rays_last_frame as f64,
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
    timing.record_count(
        frame.0,
        "naadf.path_b_depth_rejects_last_frame",
        stats.path_b_depth_rejects_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.path_b_coverage_rejects_last_frame",
        stats.path_b_coverage_rejects_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.path_b_naadf_accepts_last_frame",
        stats.path_b_naadf_accepts_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.path_b_current_kept_last_frame",
        stats.path_b_current_kept_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.path_b_refine_requests_last_frame",
        stats.path_b_refine_requests_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.path_b_stale_or_unresident_last_frame",
        stats.path_b_stale_or_unresident_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.path_b_ownership_changes_last_frame",
        stats.path_b_ownership_changes_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.path_b_composite_passes_last_frame",
        stats.path_b_composite_passes_last_frame as f64,
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
