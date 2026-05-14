use bevy::prelude::*;

use super::cache::NaadfCache;
use super::dirty::NaadfDirtyChunkQueue;
use super::stats::{NaadfCacheState, NaadfStats};
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
