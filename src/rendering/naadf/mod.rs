pub mod cache;
pub mod config;
pub mod cpu_builder;
pub mod cpu_trace;
pub mod debug;
pub mod dirty;
pub mod entities;
pub mod extractor;
pub mod gpu_buffers;
pub mod gpu_tests;
pub mod layout;
pub mod local_lights;
pub mod pipeline;
pub mod prepare;
pub mod preview;
pub mod stats;
pub mod streaming;
pub mod systems;

use bevy::asset::load_internal_asset;
use bevy::core_pipeline::core_3d::graph::{Core3d, Node3d};
use bevy::prelude::*;
use bevy::render::render_graph::{RenderGraphExt, ViewNodeRunner};
use bevy::render::{ExtractSchedule, Render, RenderApp, RenderStartup, RenderSystems};
use bevy::shader::Shader;
use std::borrow::Cow;

use crate::rendering::weather_overlay::WeatherOverlayLabel;

pub use cache::{NaadfCache, NaadfCacheBuildReport};
pub use config::{NaadfConfig, NaadfDenoiseQuality, NaadfPreviewCompositeModeConfig};
pub use cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
pub use cpu_trace::NaadfCpuRayBackend;
pub use dirty::NaadfDirtyChunkQueue;
pub use entities::{NaadfEntityVolumeRegistry, NaadfEntityVoxelVolume};
pub use extractor::{NaadfChunkExtractor, NaadfExtractionError};
pub use gpu_buffers::{NaadfGpuBufferPlan, NaadfGpuBuffers, NaadfGpuChunkTable};
pub use layout::NaadfChunk;
pub use local_lights::{NAADF_LOCAL_LIGHT_MAX_RECORDS, NaadfLocalLightRecord};
pub use prepare::{NaadfUploadBudget, NaadfUploadPlan};
pub use stats::{NaadfCacheState, NaadfStats};

pub struct NaadfPlugin;

fn naadf_shader(path: &'static str) -> impl for<'a> Fn(&'static str, Cow<'a, str>) -> Shader {
    move |source, _| Shader::from_wgsl(source, path)
}

impl Plugin for NaadfPlugin {
    fn build(&self, app: &mut App) {
        let render_stats_bridge = stats::NaadfRenderStatsBridge::default();

        load_internal_asset!(
            app,
            pipeline::NAADF_COMMON_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/common.wgsl"
            ),
            naadf_shader(pipeline::NAADF_COMMON_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_LAYOUT_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/layout.wgsl"
            ),
            naadf_shader(pipeline::NAADF_LAYOUT_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_RAY_TRACE_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/ray_trace.wgsl"
            ),
            naadf_shader(pipeline::NAADF_RAY_TRACE_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_WORLD_TRACE_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/world_trace.wgsl"
            ),
            naadf_shader(pipeline::NAADF_WORLD_TRACE_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_LIGHTING_QUERIES_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/lighting_queries.wgsl"
            ),
            naadf_shader(pipeline::NAADF_LIGHTING_QUERIES_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_BUILD_BLOCKS_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/build_blocks.wgsl"
            ),
            naadf_shader(pipeline::NAADF_BUILD_BLOCKS_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_BUILD_BOUNDS_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/build_bounds.wgsl"
            ),
            naadf_shader(pipeline::NAADF_BUILD_BOUNDS_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_BUILD_CHUNKS_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/build_chunks.wgsl"
            ),
            naadf_shader(pipeline::NAADF_BUILD_CHUNKS_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_BUILD_CHUNK_BOUNDS_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/build_chunk_bounds.wgsl"
            ),
            naadf_shader(pipeline::NAADF_BUILD_CHUNK_BOUNDS_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_FIRST_HIT_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/first_hit.wgsl"
            ),
            naadf_shader(pipeline::NAADF_FIRST_HIT_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_GI_TRACE_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/gi_trace.wgsl"
            ),
            naadf_shader(pipeline::NAADF_GI_TRACE_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_SPATIAL_RESAMPLING_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/spatial_resampling.wgsl"
            ),
            naadf_shader(pipeline::NAADF_SPATIAL_RESAMPLING_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_TEMPORAL_ACCUMULATION_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/temporal_accumulation.wgsl"
            ),
            naadf_shader(pipeline::NAADF_TEMPORAL_ACCUMULATION_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_DENOISE_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/denoise.wgsl"
            ),
            naadf_shader(pipeline::NAADF_DENOISE_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_PATH_TRACE_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/path_trace.wgsl"
            ),
            naadf_shader(pipeline::NAADF_PATH_TRACE_SHADER_PATH)
        );
        load_internal_asset!(
            app,
            pipeline::NAADF_PREVIEW_FULLSCREEN_COMPOSITE_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/naadf/preview_fullscreen_composite.wgsl"
            ),
            naadf_shader(pipeline::NAADF_PREVIEW_FULLSCREEN_COMPOSITE_SHADER_PATH)
        );

        app.insert_resource(NaadfConfig::runtime_default())
            .init_resource::<NaadfCache>()
            .init_resource::<NaadfDirtyChunkQueue>()
            .init_resource::<entities::NaadfEntityVolumeRegistry>()
            .init_resource::<gpu_buffers::NaadfGpuChunkTable>()
            .init_resource::<gpu_buffers::NaadfGpuUploadQueue>()
            .init_resource::<prepare::NaadfGpuBuildQueue>()
            .init_resource::<NaadfStats>()
            .init_resource::<streaming::NaadfStreamingState>()
            .insert_resource(render_stats_bridge.clone())
            .init_resource::<NaadfCacheState>()
            .init_resource::<debug::NaadfDebugRayVisuals>()
            .init_resource::<preview::NaadfPreviewSettings>()
            .init_resource::<preview::NaadfPreviewPipelineState>()
            .init_resource::<preview::NaadfPreviewHistoryState>()
            .add_systems(
                Update,
                (
                    dirty::queue_existing_dirty_chunks,
                    streaming::update_visible_region_cache,
                    cache::rebuild_naadf_cache_from_dirty_queue,
                    gpu_buffers::sync_gpu_chunk_table_from_cache,
                    gpu_buffers::queue_gpu_uploads_from_cache_report,
                    prepare::queue_gpu_builds_from_cache_report,
                    prepare::sync_gpu_build_queue_stats,
                    streaming::sync_streaming_gpu_slot_stats,
                    entities::sync_naadf_entity_volume_registry,
                    systems::sync_naadf_stats_from_dirty_queue,
                    systems::sync_naadf_render_stats_bridge_to_stats,
                    systems::sync_naadf_backend_fallback_policy,
                    systems::record_naadf_bench_counters,
                )
                    .chain()
                    .in_set(crate::voxel::plugin::VoxelTerrainSet::NaadfDirtyQueue),
            )
            .add_systems(
                Update,
                (debug::draw_debug_ray_hits, debug::draw_debug_chunks),
            )
            .add_systems(
                Update,
                (
                    preview::sync_naadf_preview_settings_from_config,
                    preview::sync_naadf_preview_mode,
                )
                    .chain(),
            );

        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app
                .insert_resource(render_stats_bridge)
                .init_resource::<gpu_buffers::ExtractedNaadfGpuConfig>()
                .init_resource::<pipeline::ExtractedNaadfPreviewPipelineState>()
                .init_resource::<pipeline::ExtractedNaadfPreviewSettings>()
                .init_resource::<local_lights::ExtractedNaadfLocalLights>()
                .init_resource::<gpu_buffers::ExtractedNaadfGpuUploads>()
                .init_resource::<gpu_buffers::ExtractedNaadfEntityGpuUploads>()
                .init_resource::<NaadfGpuBuffers>()
                .init_resource::<local_lights::NaadfLocalLightGpuBuffers>()
                .init_resource::<gpu_buffers::NaadfEntityGpuBuffers>()
                .init_resource::<gpu_buffers::NaadfGpuUploadStats>()
                .init_resource::<pipeline::NaadfPreviewTemporalHistory>()
                .init_resource::<pipeline::NaadfPreviewScratchTextures>()
                .init_resource::<pipeline::NaadfPreviewPassStats>()
                .add_systems(RenderStartup, pipeline::init_naadf_preview_build_pipelines)
                .add_systems(
                    ExtractSchedule,
                    (
                        gpu_buffers::extract_naadf_gpu_config,
                        pipeline::extract_naadf_preview_pipeline_state,
                        local_lights::extract_naadf_local_lights,
                        gpu_buffers::extract_naadf_gpu_uploads,
                        gpu_buffers::extract_naadf_entity_gpu_uploads,
                    )
                        .chain(),
                )
                .add_systems(
                    Render,
                    (
                        gpu_buffers::prepare_naadf_gpu_buffers,
                        local_lights::prepare_naadf_local_light_gpu_buffer,
                        gpu_buffers::prepare_naadf_entity_gpu_buffers,
                        gpu_buffers::readback_naadf_gpu_stats
                            .after(gpu_buffers::prepare_naadf_gpu_buffers),
                        gpu_buffers::upload_naadf_chunks_to_gpu
                            .after(gpu_buffers::prepare_naadf_gpu_buffers),
                        local_lights::upload_naadf_local_lights
                            .after(local_lights::prepare_naadf_local_light_gpu_buffer),
                        gpu_buffers::upload_naadf_entity_volumes_to_gpu
                            .after(gpu_buffers::prepare_naadf_entity_gpu_buffers),
                    )
                        .in_set(RenderSystems::PrepareResources),
                )
                .add_systems(
                    Render,
                    (
                        gpu_buffers::sync_naadf_gpu_status_to_main,
                        pipeline::sync_naadf_preview_pass_stats_to_main,
                    )
                        .in_set(RenderSystems::Cleanup),
                );
            render_app.add_render_graph_node::<ViewNodeRunner<pipeline::NaadfPreviewBuildNode>>(
                Core3d,
                preview::NaadfPreviewNodeLabel,
            );
            render_app.add_render_graph_edges(
                Core3d,
                (
                    WeatherOverlayLabel,
                    preview::NaadfPreviewNodeLabel,
                    Node3d::Bloom,
                ),
            );
        } else {
            warn!("Render sub-app not available; NAADF GPU buffer allocation disabled");
        }
    }
}
