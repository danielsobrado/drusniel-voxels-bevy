use bevy::prelude::*;
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfGpuBufferPlan {
    pub max_chunks: u32,
    pub voxel_records: u64,
    pub block_records: u64,
    pub chunk_records: u64,
    pub estimated_bytes: u64,
}

impl NaadfGpuBufferPlan {
    pub fn for_chunk_capacity(max_chunks: u32) -> Self {
        let voxel_records = max_chunks as u64 * crate::constants::CHUNK_VOLUME as u64;
        let block_records = max_chunks as u64 * super::layout::BLOCKS_PER_CHUNK as u64;
        let chunk_records = max_chunks as u64;
        let estimated_bytes =
            voxel_records * 4 + block_records * 32 + chunk_records * 32 + max_chunks as u64 * 16;
        Self {
            max_chunks,
            voxel_records,
            block_records,
            chunk_records,
            estimated_bytes,
        }
    }

    pub fn fits_memory_cap(&self, max_gpu_memory_mb: u32) -> bool {
        self.estimated_bytes <= max_gpu_memory_mb as u64 * 1024 * 1024
    }
}

#[derive(Resource, Clone, Debug, Default)]
pub struct NaadfGpuChunkTable {
    chunk_to_slot: HashMap<IVec3, u32>,
    free_slots: Vec<u32>,
    next_slot: u32,
    max_slots: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NaadfGpuChunkTableStats {
    pub allocated_chunks: u32,
    pub reserved_slots: u32,
    pub free_slots: u32,
    pub max_slots: u32,
    pub free_slot_fragmentation: f32,
}

impl NaadfGpuChunkTable {
    pub fn with_capacity(max_slots: u32) -> Self {
        Self {
            max_slots,
            ..default()
        }
    }

    pub fn slot_for_chunk(&mut self, chunk_pos: IVec3) -> Option<u32> {
        if let Some(slot) = self.chunk_to_slot.get(&chunk_pos).copied() {
            return Some(slot);
        }
        let slot = self.free_slots.pop().or_else(|| {
            if self.next_slot < self.max_slots {
                let slot = self.next_slot;
                self.next_slot += 1;
                Some(slot)
            } else {
                None
            }
        })?;
        self.chunk_to_slot.insert(chunk_pos, slot);
        Some(slot)
    }

    pub fn release_chunk(&mut self, chunk_pos: IVec3) -> Option<u32> {
        let slot = self.chunk_to_slot.remove(&chunk_pos)?;
        self.free_slots.push(slot);
        Some(slot)
    }

    pub fn stats(&self) -> NaadfGpuChunkTableStats {
        let free_slots = self.free_slots.len() as u32;
        let reserved_slots = self.next_slot;
        let free_slot_fragmentation = if reserved_slots == 0 {
            0.0
        } else {
            free_slots as f32 / reserved_slots as f32
        };

        NaadfGpuChunkTableStats {
            allocated_chunks: self.chunk_to_slot.len() as u32,
            reserved_slots,
            free_slots,
            max_slots: self.max_slots,
            free_slot_fragmentation,
        }
    }

    pub fn len(&self) -> usize {
        self.chunk_to_slot.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunk_to_slot.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_table_reuses_released_slots() {
        let mut table = NaadfGpuChunkTable::with_capacity(1);
        assert_eq!(table.slot_for_chunk(IVec3::ZERO), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::X), None);
        assert_eq!(table.release_chunk(IVec3::ZERO), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::X), Some(0));
    }

    #[test]
    fn chunk_table_reports_free_slot_fragmentation() {
        let mut table = NaadfGpuChunkTable::with_capacity(4);
        assert_eq!(table.slot_for_chunk(IVec3::ZERO), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::X), Some(1));
        assert_eq!(table.release_chunk(IVec3::ZERO), Some(0));

        let stats = table.stats();

        assert_eq!(stats.allocated_chunks, 1);
        assert_eq!(stats.reserved_slots, 2);
        assert_eq!(stats.free_slots, 1);
        assert_eq!(stats.free_slot_fragmentation, 0.5);
    }
}
