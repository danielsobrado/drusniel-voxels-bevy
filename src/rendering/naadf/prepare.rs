use bevy::prelude::*;
use bevy::render::MainWorld;
use std::collections::{HashSet, VecDeque};

use super::cache::NaadfCache;
use super::config::NaadfConfig;
use super::dirty::NaadfDirtyChunkQueue;
use super::gpu_buffers::{NaadfGpuChunkTable, NaadfGpuUploadQueue};
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

#[derive(Resource, Clone, Debug, Default, PartialEq, Eq)]
pub struct ExtractedNaadfGpuBuilds {
    pub slots: Vec<u32>,
    pub chunk_positions: Vec<IVec3>,
    pub generation: u64,
}

impl ExtractedNaadfGpuBuilds {
    pub fn has_work(&self) -> bool {
        !self.slots.is_empty()
    }
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

    pub fn increment_ages(&mut self) {
        for item in &mut self.pending {
            item.age_frames = item.age_frames.saturating_add(1);
        }
    }

    pub fn pop_pending(&mut self) -> Option<NaadfGpuBuildItem> {
        let item = self.pending.pop_front()?;
        self.pending_set.remove(&item.chunk_pos);
        Some(item)
    }

    pub fn requeue(&mut self, item: NaadfGpuBuildItem) -> bool {
        if self.pending_set.contains(&item.chunk_pos) {
            return false;
        }
        self.pending.push_back(item);
        self.pending_set.insert(item.chunk_pos);
        true
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
    if !config.gpu_builder_enabled() || !naadf_gpu_builder_dispatch_available() {
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
    let queue_stats = sync_gpu_build_queue_stats_for_config(&config, &mut build_queue);

    stats.gpu_build_queue_pending = queue_stats.pending as u32;
    stats.gpu_build_queue_oldest_age_frames = queue_stats.oldest_age_frames;
    stats.gpu_build_queue_queued_total = queue_stats.queued_total;
}

pub fn sync_gpu_build_queue_stats_for_config(
    config: &NaadfConfig,
    build_queue: &mut NaadfGpuBuildQueue,
) -> NaadfGpuBuildQueueStats {
    if !config.gpu_builder_enabled() || !naadf_gpu_builder_dispatch_available() {
        build_queue.clear();
    } else {
        build_queue.increment_ages();
    }

    build_queue.stats()
}

pub fn extract_naadf_gpu_builds(mut commands: Commands, mut main_world: ResMut<MainWorld>) {
    let mut extracted = ExtractedNaadfGpuBuilds::default();

    main_world.resource_scope(|world, mut build_queue: Mut<NaadfGpuBuildQueue>| {
        let Some(config) = world.get_resource::<NaadfConfig>() else {
            return;
        };
        if !config.gpu_builder_enabled() || !naadf_gpu_builder_dispatch_available() {
            build_queue.clear();
            return;
        }
        let Some(table) = world.get_resource::<NaadfGpuChunkTable>() else {
            return;
        };
        let pending_uploads = world
            .get_resource::<NaadfGpuUploadQueue>()
            .map(|queue| queue.pending_chunks().collect::<HashSet<_>>())
            .unwrap_or_default();
        let max_builds = config.chunk_cache.max_chunk_updates_per_frame as usize;
        let attempts = build_queue.stats().pending;
        for _ in 0..attempts {
            if extracted.slots.len() >= max_builds {
                break;
            }
            let Some(item) = build_queue.pop_pending() else {
                break;
            };
            if pending_uploads.contains(&item.chunk_pos) {
                build_queue.requeue(item);
                continue;
            }
            let Some(slot) = table.slot(item.chunk_pos) else {
                build_queue.requeue(item);
                continue;
            };
            extracted.slots.push(slot);
            extracted.chunk_positions.push(item.chunk_pos);
        }
        extracted.generation = build_queue.stats().queued_total;
    });

    if let (Some(queue_stats), Some(mut stats)) = (
        main_world
            .get_resource::<NaadfGpuBuildQueue>()
            .map(NaadfGpuBuildQueue::stats),
        main_world.get_resource_mut::<NaadfStats>(),
    ) {
        stats.gpu_build_queue_pending = queue_stats.pending as u32;
        stats.gpu_build_queue_oldest_age_frames = queue_stats.oldest_age_frames;
        stats.gpu_build_queue_queued_total = queue_stats.queued_total;
    }

    commands.insert_resource(extracted);
}

pub const fn naadf_gpu_builder_dispatch_available() -> bool {
    true
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

    #[test]
    fn gpu_build_queue_is_disabled_until_gpu_builder_is_preferred() {
        let mut queue = NaadfGpuBuildQueue::default();
        queue.queue(IVec3::X);

        let stats = sync_gpu_build_queue_stats_for_config(
            &NaadfConfig {
                enabled: true,
                ..default()
            },
            &mut queue,
        );

        assert_eq!(stats.pending, 0);
        assert_eq!(stats.oldest_age_frames, 0);
    }

    #[test]
    fn gpu_build_queue_stays_pending_until_extracted_when_dispatch_is_available() {
        let mut queue = NaadfGpuBuildQueue::default();
        queue.queue(IVec3::X);

        let stats = sync_gpu_build_queue_stats_for_config(
            &NaadfConfig {
                enabled: true,
                gpu: super::super::config::NaadfGpuConfig {
                    prefer_gpu_builder: true,
                    ..default()
                },
                ..default()
            },
            &mut queue,
        );

        assert_eq!(stats.pending, 1);
        assert_eq!(stats.oldest_age_frames, 1);
        assert_eq!(stats.queued_total, 1);
        assert!(naadf_gpu_builder_dispatch_available());
    }

    #[test]
    fn gpu_build_queue_uses_force_gpu_override() {
        let mut queue = NaadfGpuBuildQueue::default();
        queue.queue(IVec3::X);

        let stats = sync_gpu_build_queue_stats_for_config(
            &NaadfConfig {
                enabled: true,
                debug: super::super::config::NaadfDebugConfig {
                    force_gpu_builder: true,
                    ..default()
                },
                ..default()
            },
            &mut queue,
        );

        assert_eq!(stats.pending, 1);
        assert_eq!(stats.oldest_age_frames, 1);
        assert_eq!(stats.queued_total, 1);
        assert!(naadf_gpu_builder_dispatch_available());
    }

    #[test]
    fn gpu_build_queue_requeues_unslotted_items_without_recounting() {
        let mut queue = NaadfGpuBuildQueue::default();
        queue.queue(IVec3::X);

        let item = queue.pop_pending().unwrap();
        assert_eq!(queue.stats().pending, 0);
        assert!(queue.requeue(item));

        let stats = queue.stats();
        assert_eq!(stats.pending, 1);
        assert_eq!(stats.queued_total, 1);
    }
}
