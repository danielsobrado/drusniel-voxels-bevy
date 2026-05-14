use bevy::prelude::*;

use super::cache::NaadfCache;
use super::dirty::NaadfDirtyChunkQueue;
use super::stats::NaadfStats;

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
