pub mod cache;
pub mod config;
pub mod cpu_builder;
pub mod cpu_trace;
pub mod debug;
pub mod dirty;
pub mod extractor;
pub mod gpu_buffers;
pub mod gpu_tests;
pub mod layout;
pub mod pipeline;
pub mod prepare;
pub mod preview;
pub mod stats;
pub mod streaming;
pub mod systems;

use bevy::prelude::*;
use bevy::render::{ExtractSchedule, Render, RenderApp, RenderSystems};

pub use cache::{NaadfCache, NaadfCacheBuildReport};
pub use config::NaadfConfig;
pub use cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
pub use cpu_trace::NaadfCpuRayBackend;
pub use dirty::NaadfDirtyChunkQueue;
pub use extractor::{NaadfChunkExtractor, NaadfExtractionError};
pub use gpu_buffers::{NaadfGpuBufferPlan, NaadfGpuBuffers, NaadfGpuChunkTable};
pub use layout::NaadfChunk;
pub use prepare::{NaadfUploadBudget, NaadfUploadPlan};
pub use stats::{NaadfCacheState, NaadfStats};

pub struct NaadfPlugin;

impl Plugin for NaadfPlugin {
    fn build(&self, app: &mut App) {
        app.insert_resource(NaadfConfig::runtime_default())
            .init_resource::<NaadfCache>()
            .init_resource::<NaadfDirtyChunkQueue>()
            .init_resource::<gpu_buffers::NaadfGpuChunkTable>()
            .init_resource::<gpu_buffers::NaadfGpuUploadQueue>()
            .init_resource::<prepare::NaadfGpuBuildQueue>()
            .init_resource::<NaadfStats>()
            .init_resource::<NaadfCacheState>()
            .init_resource::<debug::NaadfDebugRayVisuals>()
            .init_resource::<preview::NaadfPreviewSettings>()
            .init_resource::<preview::NaadfPreviewPipelineState>()
            .init_resource::<preview::NaadfPreviewHistoryState>()
            .add_systems(
                Update,
                (
                    dirty::queue_existing_dirty_chunks,
                    cache::rebuild_naadf_cache_from_dirty_queue,
                    gpu_buffers::sync_gpu_chunk_table_from_cache,
                    gpu_buffers::queue_gpu_uploads_from_cache_report,
                    prepare::queue_gpu_builds_from_cache_report,
                    prepare::sync_gpu_build_queue_stats,
                    streaming::update_visible_region_cache,
                    systems::sync_naadf_stats_from_dirty_queue,
                    systems::sync_naadf_backend_fallback_policy,
                )
                    .chain()
                    .in_set(crate::voxel::plugin::VoxelTerrainSet::NaadfDirtyQueue),
            )
            .add_systems(
                Update,
                (debug::draw_debug_ray_hits, debug::draw_debug_chunks),
            )
            .add_systems(Update, preview::sync_naadf_preview_mode);

        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app
                .init_resource::<gpu_buffers::ExtractedNaadfGpuConfig>()
                .init_resource::<gpu_buffers::ExtractedNaadfGpuUploads>()
                .init_resource::<NaadfGpuBuffers>()
                .init_resource::<gpu_buffers::NaadfGpuUploadStats>()
                .add_systems(
                    ExtractSchedule,
                    (
                        gpu_buffers::extract_naadf_gpu_config,
                        gpu_buffers::extract_naadf_gpu_uploads,
                    )
                        .chain(),
                )
                .add_systems(
                    Render,
                    (
                        gpu_buffers::prepare_naadf_gpu_buffers,
                        gpu_buffers::upload_naadf_chunks_to_gpu
                            .after(gpu_buffers::prepare_naadf_gpu_buffers),
                    )
                        .in_set(RenderSystems::PrepareResources),
                )
                .add_systems(
                    Render,
                    gpu_buffers::sync_naadf_gpu_status_to_main.in_set(RenderSystems::Cleanup),
                );
        } else {
            warn!("Render sub-app not available; NAADF GPU buffer allocation disabled");
        }
    }
}
