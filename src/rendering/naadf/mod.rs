pub mod cache;
pub mod config;
pub mod cpu_builder;
pub mod cpu_trace;
pub mod debug;
pub mod dirty;
pub mod extractor;
pub mod gpu_buffers;
pub mod layout;
pub mod prepare;
pub mod preview;
pub mod stats;
pub mod systems;

use bevy::prelude::*;

pub use cache::{NaadfCache, NaadfCacheBuildReport};
pub use config::NaadfConfig;
pub use cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
pub use cpu_trace::NaadfCpuRayBackend;
pub use dirty::NaadfDirtyChunkQueue;
pub use extractor::{NaadfChunkExtractor, NaadfExtractionError};
pub use gpu_buffers::{NaadfGpuBufferPlan, NaadfGpuChunkTable};
pub use layout::NaadfChunk;
pub use prepare::{NaadfUploadBudget, NaadfUploadPlan};
pub use stats::{NaadfCacheState, NaadfStats};

pub struct NaadfPlugin;

impl Plugin for NaadfPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<NaadfConfig>()
            .init_resource::<NaadfCache>()
            .init_resource::<NaadfDirtyChunkQueue>()
            .init_resource::<NaadfStats>()
            .init_resource::<NaadfCacheState>()
            .init_resource::<preview::NaadfPreviewSettings>()
            .add_systems(
                Update,
                (
                    dirty::queue_existing_dirty_chunks,
                    cache::rebuild_naadf_cache_from_dirty_queue,
                    systems::sync_naadf_stats_from_dirty_queue,
                )
                    .chain()
                    .in_set(crate::voxel::plugin::VoxelTerrainSet::NaadfDirtyQueue),
            );
    }
}
