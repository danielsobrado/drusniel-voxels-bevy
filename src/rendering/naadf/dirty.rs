use bevy::prelude::*;
use std::collections::{HashSet, VecDeque};

use super::config::NaadfConfig;
use crate::voxel::world::VoxelWorld;

#[derive(Resource, Default, Debug)]
pub struct NaadfDirtyChunkQueue {
    pending: VecDeque<IVec3>,
    pending_set: HashSet<IVec3>,
    in_flight: HashSet<IVec3>,
    queued_total: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfDirtyQueueStats {
    pub pending: usize,
    pub in_flight: usize,
    pub queued_total: u64,
}

impl NaadfDirtyChunkQueue {
    pub fn queue(&mut self, chunk_pos: IVec3) -> bool {
        if self.pending_set.contains(&chunk_pos) || self.in_flight.contains(&chunk_pos) {
            return false;
        }
        self.pending.push_back(chunk_pos);
        self.pending_set.insert(chunk_pos);
        self.queued_total = self.queued_total.saturating_add(1);
        true
    }

    pub fn pop_pending(&mut self) -> Option<IVec3> {
        let chunk_pos = self.pending.pop_front()?;
        self.pending_set.remove(&chunk_pos);
        self.in_flight.insert(chunk_pos);
        Some(chunk_pos)
    }

    pub fn finish(&mut self, chunk_pos: IVec3) {
        self.in_flight.remove(&chunk_pos);
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    pub fn stats(&self) -> NaadfDirtyQueueStats {
        NaadfDirtyQueueStats {
            pending: self.pending.len(),
            in_flight: self.in_flight.len(),
            queued_total: self.queued_total,
        }
    }
}

pub fn queue_existing_dirty_chunks(
    config: Res<NaadfConfig>,
    world: Res<VoxelWorld>,
    mut queue: ResMut<NaadfDirtyChunkQueue>,
) {
    if !config.enabled {
        return;
    }

    for chunk_pos in world.dirty_chunks() {
        queue.queue(chunk_pos);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dirty_queue_deduplicates_positions() {
        let mut queue = NaadfDirtyChunkQueue::default();
        assert!(queue.queue(IVec3::new(1, 2, 3)));
        assert!(!queue.queue(IVec3::new(1, 2, 3)));
        assert_eq!(queue.pending_len(), 1);
    }
}
