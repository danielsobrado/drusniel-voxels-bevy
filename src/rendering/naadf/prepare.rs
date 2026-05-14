use bevy::prelude::*;

use super::config::NaadfConfig;
use super::dirty::NaadfDirtyChunkQueue;

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
