use bevy::prelude::*;

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
    pub gpu_uploaded_bytes_last_frame: u32,
    pub gpu_avg_ray_steps_last_frame: f32,
    pub gpu_build_queue_pending: u32,
    pub gpu_build_queue_oldest_age_frames: u32,
    pub gpu_build_queue_queued_total: u64,
    pub gi_rays_last_frame: u64,
    pub streaming_interest_chunks: u32,
}

#[derive(Resource, Clone, Debug, PartialEq, Eq)]
pub struct NaadfCacheState {
    pub ready: bool,
    pub warming: bool,
    pub fallback_reason: Option<String>,
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
