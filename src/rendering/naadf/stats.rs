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
    pub gpu_build_queue_pending: u32,
    pub gpu_build_queue_oldest_age_frames: u32,
    pub gpu_build_queue_queued_total: u64,
    pub chunk_bound_updates_last_frame: u32,
    pub chunk_bound_skipped_unknown_neighbors_last_frame: u32,
    pub chunk_bound_saturated_fields_last_frame: u32,
    pub chunk_bound_propagation_passes_last_frame: u32,
    pub gi_rays_last_frame: u64,
    pub radiance_contact_shadow_rays_per_pixel: u32,
    pub radiance_terrain_ao_rays_per_pixel: u32,
    pub preview_pixels_last_frame: u64,
    pub preview_first_hit_dispatches_last_frame: u32,
    pub preview_gi_dispatches_last_frame: u32,
    pub preview_spatial_dispatches_last_frame: u32,
    pub preview_temporal_dispatches_last_frame: u32,
    pub preview_composite_passes_last_frame: u32,
    pub preview_denoise_dispatches_last_frame: u32,
    pub preview_reference_dispatches_last_frame: u32,
    pub preview_node_stage_last_frame: u32,
    pub streaming_interest_chunks: u32,
    pub streaming_interest_missing_gpu_slots: u32,
    pub streaming_interest_missing_gpu_slots_far_ring: u32,
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
    pub gpu_max_ray_steps_last_frame: u32,
    pub gi_rays_last_frame: u64,
    pub preview_pixels_last_frame: u64,
    pub preview_first_hit_dispatches_last_frame: u32,
    pub preview_gi_dispatches_last_frame: u32,
    pub preview_spatial_dispatches_last_frame: u32,
    pub preview_temporal_dispatches_last_frame: u32,
    pub preview_composite_passes_last_frame: u32,
    pub preview_denoise_dispatches_last_frame: u32,
    pub preview_reference_dispatches_last_frame: u32,
    pub preview_node_stage_last_frame: u32,
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

    pub fn publish_ray_step_budget(&self, max_ray_steps: u32) {
        self.snapshot.lock().unwrap().gpu_max_ray_steps_last_frame = max_ray_steps;
    }

    pub fn publish_gi_rays(&self, gi_rays: u64) {
        self.snapshot.lock().unwrap().gi_rays_last_frame = gi_rays;
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
