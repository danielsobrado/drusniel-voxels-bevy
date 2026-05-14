use bevy::prelude::*;
use std::collections::{HashSet, VecDeque};

use super::cache::NaadfCache;
use super::config::NaadfConfig;
use super::dirty::NaadfDirtyChunkQueue;
use super::stats::NaadfStats;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NaadfUploadBudget {
    pub max_chunks: u32,
    pub max_bytes: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NaadfUploadPlan {
    pub chunks: Vec<IVec3>,
    pub estimated_bytes: u32,
}

impl NaadfUploadPlan {
    pub fn from_dirty_queue(
        queue: &mut NaadfDirtyChunkQueue,
        budget: NaadfUploadBudget,
        bytes_per_chunk: u32,
    ) -> Self {
        let mut plan = Self::default();
        while plan.chunks.len() < budget.max_chunks as usize
            && plan.estimated_bytes.saturating_add(bytes_per_chunk) <= budget.max_bytes
        {
            let Some(chunk_pos) = queue.pop_pending() else {
                break;
            };
            plan.chunks.push(chunk_pos);
            plan.estimated_bytes = plan.estimated_bytes.saturating_add(bytes_per_chunk);
        }
        plan
    }
}

impl From<&NaadfConfig> for NaadfUploadBudget {
    fn from(config: &NaadfConfig) -> Self {
        Self {
            max_chunks: config.chunk_cache.max_chunk_updates_per_frame,
            max_bytes: config.chunk_cache.max_upload_bytes_per_frame,
        }
    }
}

#[derive(Resource, Debug, Default)]
pub struct NaadfGpuBuildQueue {
    pending: VecDeque<NaadfGpuBuildItem>,
    pending_set: HashSet<IVec3>,
    queued_total: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NaadfGpuBuildItem {
    pub chunk_pos: IVec3,
    pub age_frames: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfGpuBuildQueueStats {
    pub pending: usize,
    pub oldest_age_frames: u32,
    pub queued_total: u64,
}

impl NaadfGpuBuildQueue {
    pub fn queue(&mut self, chunk_pos: IVec3) -> bool {
        if self.pending_set.contains(&chunk_pos) {
            return false;
        }
        self.pending.push_back(NaadfGpuBuildItem {
            chunk_pos,
            age_frames: 0,
        });
        self.pending_set.insert(chunk_pos);
        self.queued_total = self.queued_total.saturating_add(1);
        true
    }

    pub fn take_budgeted(&mut self, max_chunks: u32) -> Vec<NaadfGpuBuildItem> {
        let mut items = Vec::new();
        while items.len() < max_chunks as usize {
            let Some(item) = self.pending.pop_front() else {
                break;
            };
            self.pending_set.remove(&item.chunk_pos);
            items.push(item);
        }
        items
    }

    pub fn increment_ages(&mut self) {
        for item in &mut self.pending {
            item.age_frames = item.age_frames.saturating_add(1);
        }
    }

    pub fn stats(&self) -> NaadfGpuBuildQueueStats {
        NaadfGpuBuildQueueStats {
            pending: self.pending.len(),
            oldest_age_frames: self
                .pending
                .iter()
                .map(|item| item.age_frames)
                .max()
                .unwrap_or(0),
            queued_total: self.queued_total,
        }
    }

    pub fn clear(&mut self) {
        self.pending.clear();
        self.pending_set.clear();
    }
}

pub fn queue_gpu_builds_from_cache_report(
    config: Res<NaadfConfig>,
    cache: Res<NaadfCache>,
    mut build_queue: ResMut<NaadfGpuBuildQueue>,
) {
    if !config.enabled {
        build_queue.clear();
        return;
    }

    for chunk_pos in &cache.last_report().rebuilt_chunks {
        build_queue.queue(*chunk_pos);
    }
}

pub fn sync_gpu_build_queue_stats(
    config: Res<NaadfConfig>,
    mut build_queue: ResMut<NaadfGpuBuildQueue>,
    mut stats: ResMut<NaadfStats>,
) {
    if !config.enabled {
        build_queue.clear();
    } else {
        build_queue.increment_ages();
    }

    let queue_stats = build_queue.stats();
    stats.gpu_build_queue_pending = queue_stats.pending as u32;
    stats.gpu_build_queue_oldest_age_frames = queue_stats.oldest_age_frames;
    stats.gpu_build_queue_queued_total = queue_stats.queued_total;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpu_build_queue_deduplicates_chunks() {
        let mut queue = NaadfGpuBuildQueue::default();

        assert!(queue.queue(IVec3::new(1, 2, 3)));
        assert!(!queue.queue(IVec3::new(1, 2, 3)));

        assert_eq!(queue.stats().pending, 1);
        assert_eq!(queue.stats().queued_total, 1);
    }

    #[test]
    fn gpu_build_queue_takes_budgeted_items_across_frames() {
        let mut queue = NaadfGpuBuildQueue::default();
        queue.queue(IVec3::X);
        queue.queue(IVec3::Y);
        queue.queue(IVec3::Z);
        queue.increment_ages();

        let first = queue.take_budgeted(2);
        let second = queue.take_budgeted(2);

        assert_eq!(first.len(), 2);
        assert_eq!(first[0].chunk_pos, IVec3::X);
        assert_eq!(first[0].age_frames, 1);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].chunk_pos, IVec3::Z);
        assert_eq!(queue.stats().pending, 0);
    }

    #[test]
    fn gpu_build_queue_reports_oldest_age() {
        let mut queue = NaadfGpuBuildQueue::default();
        queue.queue(IVec3::X);
        queue.increment_ages();
        queue.queue(IVec3::Y);
        queue.increment_ages();

        let stats = queue.stats();

        assert_eq!(stats.pending, 2);
        assert_eq!(stats.oldest_age_frames, 2);
    }
}
