use bevy::prelude::*;
use std::sync::{Arc, Mutex};

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq)]
pub struct NaadfStats {
    pub loaded_chunks: u32,
    pub dirty_pending: u32,
    pub dirty_in_flight: u32,
    pub rays_traced: u64,
    pub ray_hits: u64,
    pub ray_misses: u64,
    pub average_steps: f32,
    pub fallback_count: u64,
    pub gpu_memory_bytes: u64,
    pub gpu_max_chunks: u32,
    pub gpu_slots_used: u32,
    pub gpu_slots_available: u32,
    pub gpu_slots_reserved: u32,
    pub gpu_slots_free_list: u32,
    pub gpu_slot_fragmentation: f32,
    pub gpu_uploads_pending: u32,
    pub gpu_uploads_queued_total: u64,
    pub gpu_uploaded_chunks_last_frame: u32,
    pub gpu_uploaded_chunks_peak: u32,
    pub gpu_uploaded_bytes_last_frame: u32,
    pub gpu_avg_ray_steps_last_frame: f32,
    pub gpu_max_ray_steps_last_frame: u32,
    pub gpu_ray_samples_last_frame: u32,
    pub first_hit_ray_hits_last_frame: u32,
    pub first_hit_ray_misses_last_frame: u32,
    pub first_hit_clean_misses_last_frame: u32,
    pub first_hit_voxel_budget_misses_last_frame: u32,
    pub first_hit_chunk_budget_misses_last_frame: u32,
    pub first_hit_distance_clamps_last_frame: u32,
    pub first_hit_no_lookup_misses_last_frame: u32,
    pub gpu_build_queue_pending: u32,
    pub gpu_build_queue_oldest_age_frames: u32,
    pub gpu_build_queue_queued_total: u64,
    pub chunk_bound_updates_last_frame: u32,
    pub chunk_bound_skipped_unknown_neighbors_last_frame: u32,
    pub chunk_bound_saturated_fields_last_frame: u32,
    pub chunk_bound_propagation_passes_last_frame: u32,
    pub gi_rays_last_frame: u64,
    pub local_lights_visible: u32,
    pub local_lights_uploaded: u32,
    pub local_lights_culled: u32,
    pub local_light_shadow_rays_last_frame: u64,
    pub radiance_sun_visibility_rays_per_pixel: u32,
    pub radiance_contact_shadow_rays_per_pixel: u32,
    pub radiance_terrain_ao_rays_per_pixel: u32,
    pub radiance_short_range_rays_per_pixel: u32,
    pub froxel_sun_mask_active: u32,
    pub froxel_sun_mask_rays_per_full_update: u64,
    pub froxel_sun_mask_max_rays_per_frame: u32,
    pub froxel_sun_mask_frames_per_full_update: u32,
    pub static_proxy_volumes: u32,
    pub static_proxy_skipped: u32,
    pub preview_pixels_last_frame: u64,
    pub preview_first_hit_dispatches_last_frame: u32,
    pub preview_gi_dispatches_last_frame: u32,
    pub preview_spatial_dispatches_last_frame: u32,
    pub preview_temporal_dispatches_last_frame: u32,
    pub preview_composite_passes_last_frame: u32,
    pub preview_denoise_dispatches_last_frame: u32,
    pub preview_reference_dispatches_last_frame: u32,
    pub preview_node_stage_last_frame: u32,
    pub path_b_depth_rejects_last_frame: u32,
    pub path_b_coverage_rejects_last_frame: u32,
    pub path_b_naadf_accepts_last_frame: u32,
    pub path_b_current_kept_last_frame: u32,
    pub path_b_refine_requests_last_frame: u32,
    pub path_b_stale_or_unresident_last_frame: u32,
    pub path_b_ownership_changes_last_frame: u32,
    pub path_b_composite_passes_last_frame: u32,
    pub streaming_interest_chunks: u32,
    pub streaming_interest_missing_gpu_slots: u32,
    pub streaming_interest_missing_gpu_slots_far_ring: u32,
    pub streaming_mip0_chunks: u32,
    pub streaming_mip1_chunks: u32,
    pub streaming_mip2_chunks: u32,
    pub streaming_mip3_chunks: u32,
    pub streaming_mip4_chunks: u32,
    pub missing_fine_mip_requests_last_frame: u32,
    pub entity_volumes: u32,
    pub entity_volume_voxels: u32,
}

#[derive(Resource, Clone, Debug, PartialEq, Eq)]
pub struct NaadfCacheState {
    pub ready: bool,
    pub warming: bool,
    pub fallback_reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NaadfRenderStatsSnapshot {
    pub gpu_memory_bytes: u64,
    pub gpu_max_chunks: u32,
    pub gpu_uploaded_chunks_last_frame: u32,
    pub gpu_uploaded_bytes_last_frame: u32,
    pub gpu_avg_ray_steps_last_frame: f32,
    pub gpu_max_ray_steps_last_frame: u32,
    pub gpu_ray_samples_last_frame: u32,
    pub first_hit_ray_hits_last_frame: u32,
    pub first_hit_ray_misses_last_frame: u32,
    pub first_hit_clean_misses_last_frame: u32,
    pub first_hit_voxel_budget_misses_last_frame: u32,
    pub first_hit_chunk_budget_misses_last_frame: u32,
    pub first_hit_distance_clamps_last_frame: u32,
    pub first_hit_no_lookup_misses_last_frame: u32,
    pub gi_rays_last_frame: u64,
    pub local_lights_visible: u32,
    pub local_lights_uploaded: u32,
    pub local_lights_culled: u32,
    pub local_light_shadow_rays_last_frame: u64,
    pub preview_pixels_last_frame: u64,
    pub preview_first_hit_dispatches_last_frame: u32,
    pub preview_gi_dispatches_last_frame: u32,
    pub preview_spatial_dispatches_last_frame: u32,
    pub preview_temporal_dispatches_last_frame: u32,
    pub preview_composite_passes_last_frame: u32,
    pub preview_denoise_dispatches_last_frame: u32,
    pub preview_reference_dispatches_last_frame: u32,
    pub preview_node_stage_last_frame: u32,
    pub path_b_depth_rejects_last_frame: u32,
    pub path_b_coverage_rejects_last_frame: u32,
    pub path_b_naadf_accepts_last_frame: u32,
    pub path_b_current_kept_last_frame: u32,
    pub path_b_refine_requests_last_frame: u32,
    pub path_b_stale_or_unresident_last_frame: u32,
    pub path_b_ownership_changes_last_frame: u32,
    pub path_b_composite_passes_last_frame: u32,
}

#[derive(Resource, Clone, Debug, Default)]
pub struct NaadfRenderStatsBridge {
    snapshot: Arc<Mutex<NaadfRenderStatsSnapshot>>,
}

impl NaadfRenderStatsBridge {
    pub fn snapshot(&self) -> NaadfRenderStatsSnapshot {
        *self.snapshot.lock().unwrap()
    }

    pub fn publish_gpu_status(
        &self,
        gpu_memory_bytes: u64,
        gpu_max_chunks: u32,
        uploaded_chunks: u32,
        uploaded_bytes: u32,
    ) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.gpu_memory_bytes = gpu_memory_bytes;
        snapshot.gpu_max_chunks = gpu_max_chunks;
        snapshot.gpu_uploaded_chunks_last_frame = uploaded_chunks;
        snapshot.gpu_uploaded_bytes_last_frame = uploaded_bytes;
    }

    pub fn publish_ray_steps(
        &self,
        average_steps: f32,
        max_steps: u32,
        ray_samples: u32,
        miss_reason_counts: [u32; 6],
    ) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.gpu_avg_ray_steps_last_frame = average_steps;
        snapshot.gpu_max_ray_steps_last_frame = max_steps;
        snapshot.gpu_ray_samples_last_frame = ray_samples;
        snapshot.first_hit_ray_hits_last_frame = miss_reason_counts[0];
        snapshot.first_hit_ray_misses_last_frame = miss_reason_counts[1]
            .saturating_add(miss_reason_counts[2])
            .saturating_add(miss_reason_counts[3])
            .saturating_add(miss_reason_counts[4])
            .saturating_add(miss_reason_counts[5]);
        snapshot.first_hit_clean_misses_last_frame = miss_reason_counts[1];
        snapshot.first_hit_voxel_budget_misses_last_frame = miss_reason_counts[2];
        snapshot.first_hit_chunk_budget_misses_last_frame = miss_reason_counts[3];
        snapshot.first_hit_distance_clamps_last_frame = miss_reason_counts[4];
        snapshot.first_hit_no_lookup_misses_last_frame = miss_reason_counts[5];
    }

    pub fn publish_ray_telemetry_words(&self, words: &[u32]) {
        let ray_samples = words.first().copied().unwrap_or_default();
        let total_steps = words.get(1).copied().unwrap_or_default();
        let max_steps = words.get(2).copied().unwrap_or_default();
        let mut miss_reason_counts = [0u32; 6];
        for (index, count) in miss_reason_counts.iter_mut().enumerate() {
            *count = words.get(3 + index).copied().unwrap_or_default();
        }
        let average_steps = if ray_samples == 0 {
            0.0
        } else {
            total_steps as f32 / ray_samples as f32
        };
        self.publish_ray_steps(average_steps, max_steps, ray_samples, miss_reason_counts);
        self.publish_path_b_telemetry_words(words);
    }

    pub fn publish_path_b_telemetry_words(&self, words: &[u32]) {
        let depth_rejects = words.get(9).copied().unwrap_or_default();
        let coverage_rejects = words.get(10).copied().unwrap_or_default();
        let naadf_accepts = words.get(11).copied().unwrap_or_default();
        let current_kept = words.get(12).copied().unwrap_or_default();
        let refine_requests = words.get(13).copied().unwrap_or_default();
        let stale_or_unresident = words.get(14).copied().unwrap_or_default();
        let ownership_changes = words.get(15).copied().unwrap_or_default();
        let composite_passes = u32::from(
            depth_rejects
                .saturating_add(coverage_rejects)
                .saturating_add(naadf_accepts)
                .saturating_add(current_kept)
                .saturating_add(refine_requests)
                .saturating_add(stale_or_unresident)
                .saturating_add(ownership_changes)
                > 0,
        );
        self.publish_path_b_passes(
            depth_rejects,
            coverage_rejects,
            naadf_accepts,
            current_kept,
            refine_requests,
            stale_or_unresident,
            ownership_changes,
            composite_passes,
        );
    }

    pub fn publish_gi_rays(&self, gi_rays: u64) {
        self.snapshot.lock().unwrap().gi_rays_last_frame = gi_rays;
    }

    pub fn publish_local_lights(&self, visible: u32, uploaded: u32, culled: u32, shadow_rays: u64) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.local_lights_visible = visible;
        snapshot.local_lights_uploaded = uploaded;
        snapshot.local_lights_culled = culled;
        snapshot.local_light_shadow_rays_last_frame = shadow_rays;
    }

    pub fn publish_local_light_shadow_rays(&self, shadow_rays: u64) {
        self.snapshot
            .lock()
            .unwrap()
            .local_light_shadow_rays_last_frame = shadow_rays;
    }

    pub fn publish_preview_passes(
        &self,
        pixels: u64,
        first_hit_dispatches: u32,
        gi_dispatches: u32,
        spatial_dispatches: u32,
        temporal_dispatches: u32,
        composite_passes: u32,
        denoise_dispatches: u32,
        reference_dispatches: u32,
    ) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.preview_pixels_last_frame = pixels;
        snapshot.preview_first_hit_dispatches_last_frame = first_hit_dispatches;
        snapshot.preview_gi_dispatches_last_frame = gi_dispatches;
        snapshot.preview_spatial_dispatches_last_frame = spatial_dispatches;
        snapshot.preview_temporal_dispatches_last_frame = temporal_dispatches;
        snapshot.preview_composite_passes_last_frame = composite_passes;
        snapshot.preview_denoise_dispatches_last_frame = denoise_dispatches;
        snapshot.preview_reference_dispatches_last_frame = reference_dispatches;
        snapshot.preview_node_stage_last_frame = 100;
    }

    pub fn publish_preview_node_stage(&self, stage: u32) {
        self.snapshot.lock().unwrap().preview_node_stage_last_frame = stage;
    }

    pub fn publish_path_b_passes(
        &self,
        depth_rejects: u32,
        coverage_rejects: u32,
        naadf_accepts: u32,
        current_kept: u32,
        refine_requests: u32,
        stale_or_unresident: u32,
        ownership_changes: u32,
        composite_passes: u32,
    ) {
        let mut snapshot = self.snapshot.lock().unwrap();
        snapshot.path_b_depth_rejects_last_frame = depth_rejects;
        snapshot.path_b_coverage_rejects_last_frame = coverage_rejects;
        snapshot.path_b_naadf_accepts_last_frame = naadf_accepts;
        snapshot.path_b_current_kept_last_frame = current_kept;
        snapshot.path_b_refine_requests_last_frame = refine_requests;
        snapshot.path_b_stale_or_unresident_last_frame = stale_or_unresident;
        snapshot.path_b_ownership_changes_last_frame = ownership_changes;
        snapshot.path_b_composite_passes_last_frame = composite_passes;
    }
}

impl Default for NaadfCacheState {
    fn default() -> Self {
        Self {
            ready: false,
            warming: false,
            fallback_reason: Some("NAADF cache disabled until feature systems build it".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ray_telemetry_words_publish_average_max_and_miss_reasons() {
        let bridge = NaadfRenderStatsBridge::default();

        bridge.publish_ray_telemetry_words(&[5, 24, 9, 1, 1, 2, 0, 0, 1]);
        let snapshot = bridge.snapshot();

        assert_eq!(snapshot.gpu_ray_samples_last_frame, 5);
        assert!((snapshot.gpu_avg_ray_steps_last_frame - 4.8).abs() < f32::EPSILON);
        assert_eq!(snapshot.gpu_max_ray_steps_last_frame, 9);
        assert_eq!(snapshot.first_hit_ray_hits_last_frame, 1);
        assert_eq!(snapshot.first_hit_ray_misses_last_frame, 4);
        assert_eq!(snapshot.first_hit_clean_misses_last_frame, 1);
        assert_eq!(snapshot.first_hit_voxel_budget_misses_last_frame, 2);
        assert_eq!(snapshot.first_hit_no_lookup_misses_last_frame, 1);
    }
}
