use bevy::asset::uuid_handle;
use bevy::core_pipeline::FullscreenShader;
use bevy::prelude::*;
use bevy::render::MainWorld;
use bevy::render::render_graph::{NodeRunError, RenderGraphContext, ViewNode};
use bevy::render::render_resource::*;
use bevy::render::renderer::RenderContext;
use bevy::render::view::{ExtractedView, RetainedViewEntity, ViewTarget};
use bevy::shader::Shader;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;

use super::gpu_buffers::{ExtractedNaadfGpuUploads, NaadfGpuBuffers};
use super::preview::{NaadfPreviewCompositeMode, NaadfPreviewPipelineState, NaadfPreviewSettings};

pub const NAADF_DEBUG_TRACE_RAYS_SHADER_PATH: &str = "shaders/naadf/debug_trace_rays.wgsl";
pub const NAADF_DEBUG_TRACE_WORKGROUP_SIZE: u32 = 64;
pub const NAADF_BUILD_BLOCKS_SHADER_PATH: &str = "shaders/naadf/build_blocks.wgsl";
pub const NAADF_BUILD_BOUNDS_SHADER_PATH: &str = "shaders/naadf/build_bounds.wgsl";
pub const NAADF_BUILD_CHUNKS_SHADER_PATH: &str = "shaders/naadf/build_chunks.wgsl";
pub const NAADF_BUILD_CHUNK_BOUNDS_SHADER_PATH: &str = "shaders/naadf/build_chunk_bounds.wgsl";
pub const NAADF_FIRST_HIT_SHADER_PATH: &str = "shaders/naadf/first_hit.wgsl";
pub const NAADF_SPATIAL_RESAMPLING_SHADER_PATH: &str = "shaders/naadf/spatial_resampling.wgsl";
pub const NAADF_TEMPORAL_ACCUMULATION_SHADER_PATH: &str =
    "shaders/naadf/temporal_accumulation.wgsl";
pub const NAADF_PREVIEW_FULLSCREEN_COMPOSITE_SHADER_PATH: &str =
    "shaders/naadf/preview_fullscreen_composite.wgsl";
pub const NAADF_BUILD_BLOCKS_WORKGROUP_SIZE: u32 = 64;
pub const NAADF_BUILD_CHUNKS_WORKGROUP_SIZE: u32 = 64;
pub const NAADF_PREVIEW_WORKGROUP_SIZE: u32 = 8;

pub const NAADF_BUILD_BLOCKS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("78b08331-0603-4efe-85a9-8e8f5b712f41");
pub const NAADF_BUILD_BOUNDS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("2e95a98a-69c1-44b9-a67f-ce44a2969039");
pub const NAADF_BUILD_CHUNKS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("fdf870dd-15f6-4cc8-9103-43950bd68a45");
pub const NAADF_BUILD_CHUNK_BOUNDS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("50ac25a0-9afa-4b24-8689-ad3e57a36b52");
pub const NAADF_FIRST_HIT_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("cf37e4c0-d2db-48d9-888a-792d1de2c16d");
pub const NAADF_SPATIAL_RESAMPLING_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("072a12c3-b5bc-45f5-ade2-f6ee6491adcf");
pub const NAADF_TEMPORAL_ACCUMULATION_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("70acb298-365d-4ee7-af9e-d2c25d8e4873");
pub const NAADF_PREVIEW_FULLSCREEN_COMPOSITE_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("1e1d1db7-2683-408c-9244-045e3e5c310e");

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfGpuRayTestPipelineState {
    pub queued_batches: u64,
    pub last_dispatched_rays: u32,
    pub last_readback_rays: u32,
}

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ExtractedNaadfPreviewPipelineState {
    pub active: bool,
    pub mode_generation: u64,
    pub history_generation: u64,
}

#[derive(Resource, Clone, Copy, Debug, PartialEq)]
pub struct ExtractedNaadfPreviewSettings {
    pub max_ray_steps: u32,
    pub accumulation_enabled: bool,
    pub composite_mode: NaadfPreviewCompositeMode,
}

impl Default for ExtractedNaadfPreviewSettings {
    fn default() -> Self {
        let settings = NaadfPreviewSettings::default();
        Self::from(&settings)
    }
}

impl From<&NaadfPreviewSettings> for ExtractedNaadfPreviewSettings {
    fn from(settings: &NaadfPreviewSettings) -> Self {
        Self {
            max_ray_steps: settings.max_ray_steps,
            accumulation_enabled: settings.accumulation_enabled,
            composite_mode: settings.composite_mode,
        }
    }
}

impl From<&NaadfPreviewPipelineState> for ExtractedNaadfPreviewPipelineState {
    fn from(state: &NaadfPreviewPipelineState) -> Self {
        Self {
            active: state.active,
            mode_generation: state.mode_generation,
            history_generation: state.history_generation,
        }
    }
}

pub fn extract_naadf_preview_pipeline_state(mut commands: Commands, main_world: Res<MainWorld>) {
    let extracted = main_world
        .get_resource::<NaadfPreviewPipelineState>()
        .map(ExtractedNaadfPreviewPipelineState::from)
        .unwrap_or_default();
    commands.insert_resource(extracted);

    let settings = main_world
        .get_resource::<NaadfPreviewSettings>()
        .map(ExtractedNaadfPreviewSettings::from)
        .unwrap_or_default();
    commands.insert_resource(settings);
}

#[derive(Resource)]
pub struct NaadfPreviewBuildPipelines {
    build_blocks_layout: BindGroupLayoutDescriptor,
    build_bounds_layout: BindGroupLayoutDescriptor,
    build_chunks_layout: BindGroupLayoutDescriptor,
    build_chunk_bounds_layout: BindGroupLayoutDescriptor,
    first_hit_layout: BindGroupLayoutDescriptor,
    spatial_layout: BindGroupLayoutDescriptor,
    temporal_layout: BindGroupLayoutDescriptor,
    composite_layout: BindGroupLayoutDescriptor,
    build_blocks_pipeline: CachedComputePipelineId,
    build_bounds_pipeline: CachedComputePipelineId,
    build_chunks_pipeline: CachedComputePipelineId,
    build_chunk_bounds_pipeline: CachedComputePipelineId,
    first_hit_pipeline: CachedComputePipelineId,
    spatial_pipeline: CachedComputePipelineId,
    temporal_pipeline: CachedComputePipelineId,
    composite_hdr_pipeline: CachedRenderPipelineId,
    composite_sdr_pipeline: CachedRenderPipelineId,
}

#[derive(Resource, Default)]
pub struct NaadfPreviewTemporalHistory {
    slots: Mutex<HashMap<RetainedViewEntity, NaadfPreviewTemporalHistorySlot>>,
}

struct NaadfPreviewTemporalHistorySlot {
    size: Extent3d,
    history_generation: u64,
    read_texture: Texture,
    write_texture: Texture,
}

pub fn init_naadf_preview_build_pipelines(
    mut commands: Commands,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let empty_group_layout = BindGroupLayoutDescriptor::new("naadf_empty_group_layout", &[]);
    let build_blocks_layout = BindGroupLayoutDescriptor::new(
        "naadf_build_blocks_layout",
        &[
            storage_buffer_entry(0, false),
            storage_buffer_entry(4, true),
            storage_buffer_entry(5, false),
        ],
    );
    let build_bounds_layout = BindGroupLayoutDescriptor::new(
        "naadf_build_bounds_layout",
        &[storage_buffer_entry(5, false)],
    );
    let build_chunks_layout = BindGroupLayoutDescriptor::new(
        "naadf_build_chunks_layout",
        &[
            storage_buffer_entry(5, true),
            storage_buffer_entry(11, false),
        ],
    );
    let build_chunk_bounds_layout = BindGroupLayoutDescriptor::new(
        "naadf_build_chunk_bounds_layout",
        &[storage_buffer_entry(11, false)],
    );
    let first_hit_layout = BindGroupLayoutDescriptor::new(
        "naadf_first_hit_layout",
        &[
            storage_buffer_entry(0, true),
            storage_buffer_entry(1, true),
            storage_buffer_entry(5, true),
            storage_buffer_entry(11, true),
            uniform_buffer_entry(16),
            storage_texture_entry(17, TextureFormat::Rgba16Float),
            storage_texture_entry(18, TextureFormat::Rgba16Float),
            storage_texture_entry(19, TextureFormat::Rgba16Float),
            storage_buffer_entry(20, true),
        ],
    );
    let spatial_layout = BindGroupLayoutDescriptor::new(
        "naadf_spatial_resampling_layout",
        &[
            uniform_buffer_entry(10),
            texture_entry_for_stage(12, ShaderStages::COMPUTE),
            texture_entry_for_stage(13, ShaderStages::COMPUTE),
            texture_entry_for_stage(14, ShaderStages::COMPUTE),
            storage_texture_entry(15, TextureFormat::Rgba16Float),
        ],
    );
    let temporal_layout = BindGroupLayoutDescriptor::new(
        "naadf_temporal_accumulation_layout",
        &[
            uniform_buffer_entry(9),
            texture_entry_for_stage(12, ShaderStages::COMPUTE),
            texture_entry_for_stage(13, ShaderStages::COMPUTE),
            texture_entry_for_stage(14, ShaderStages::COMPUTE),
            storage_texture_entry(15, TextureFormat::Rgba16Float),
        ],
    );
    let composite_layout = BindGroupLayoutDescriptor::new(
        "naadf_preview_fullscreen_composite_layout",
        &[texture_entry(0), texture_entry(1), uniform_buffer_entry(2)],
    );

    let build_blocks_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_build_blocks_pipeline",
        NAADF_BUILD_BLOCKS_SHADER_HANDLE,
        "build_naadf_blocks",
        &empty_group_layout,
        &build_blocks_layout,
    ));
    let build_bounds_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_build_bounds_pipeline",
        NAADF_BUILD_BOUNDS_SHADER_HANDLE,
        "build_naadf_bounds",
        &empty_group_layout,
        &build_bounds_layout,
    ));
    let build_chunks_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_build_chunks_pipeline",
        NAADF_BUILD_CHUNKS_SHADER_HANDLE,
        "build_naadf_chunks",
        &empty_group_layout,
        &build_chunks_layout,
    ));
    let build_chunk_bounds_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_build_chunk_bounds_pipeline",
        NAADF_BUILD_CHUNK_BOUNDS_SHADER_HANDLE,
        "build_naadf_chunk_bounds",
        &empty_group_layout,
        &build_chunk_bounds_layout,
    ));
    let first_hit_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_first_hit_pipeline",
        NAADF_FIRST_HIT_SHADER_HANDLE,
        "naadf_first_hit_preview",
        &empty_group_layout,
        &first_hit_layout,
    ));
    let spatial_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_spatial_resampling_pipeline",
        NAADF_SPATIAL_RESAMPLING_SHADER_HANDLE,
        "naadf_spatial_resampling",
        &empty_group_layout,
        &spatial_layout,
    ));
    let temporal_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_temporal_accumulation_pipeline",
        NAADF_TEMPORAL_ACCUMULATION_SHADER_HANDLE,
        "naadf_temporal_accumulation",
        &empty_group_layout,
        &temporal_layout,
    ));
    let composite_descriptor =
        |label: &'static str, format: TextureFormat| RenderPipelineDescriptor {
            label: Some(Cow::from(label)),
            layout: vec![composite_layout.clone()],
            vertex: fullscreen_shader.to_vertex_state(),
            fragment: Some(FragmentState {
                shader: NAADF_PREVIEW_FULLSCREEN_COMPOSITE_SHADER_HANDLE,
                targets: vec![Some(ColorTargetState {
                    format,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
                ..default()
            }),
            ..default()
        };
    let composite_hdr_pipeline = pipeline_cache.queue_render_pipeline(composite_descriptor(
        "naadf_preview_composite_hdr_pipeline",
        ViewTarget::TEXTURE_FORMAT_HDR,
    ));
    let composite_sdr_pipeline = pipeline_cache.queue_render_pipeline(composite_descriptor(
        "naadf_preview_composite_sdr_pipeline",
        TextureFormat::bevy_default(),
    ));

    commands.insert_resource(NaadfPreviewBuildPipelines {
        build_blocks_layout,
        build_bounds_layout,
        build_chunks_layout,
        build_chunk_bounds_layout,
        first_hit_layout,
        spatial_layout,
        temporal_layout,
        composite_layout,
        build_blocks_pipeline,
        build_bounds_pipeline,
        build_chunks_pipeline,
        build_chunk_bounds_pipeline,
        first_hit_pipeline,
        spatial_pipeline,
        temporal_pipeline,
        composite_hdr_pipeline,
        composite_sdr_pipeline,
    });
}

fn storage_buffer_entry(binding: u32, read_only: bool) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn uniform_buffer_entry(binding: u32) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE | ShaderStages::FRAGMENT,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn storage_texture_entry(binding: u32, format: TextureFormat) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE,
        ty: BindingType::StorageTexture {
            access: StorageTextureAccess::WriteOnly,
            format,
            view_dimension: TextureViewDimension::D2,
        },
        count: None,
    }
}

fn texture_entry(binding: u32) -> BindGroupLayoutEntry {
    texture_entry_for_stage(binding, ShaderStages::FRAGMENT)
}

fn texture_entry_for_stage(binding: u32, visibility: ShaderStages) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility,
        ty: BindingType::Texture {
            sample_type: TextureSampleType::Float { filterable: false },
            view_dimension: TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn compute_descriptor(
    label: &'static str,
    shader: Handle<Shader>,
    entry_point: &'static str,
    empty_group_layout: &BindGroupLayoutDescriptor,
    naadf_layout: &BindGroupLayoutDescriptor,
) -> ComputePipelineDescriptor {
    ComputePipelineDescriptor {
        label: Some(Cow::from(label)),
        layout: vec![
            empty_group_layout.clone(),
            empty_group_layout.clone(),
            empty_group_layout.clone(),
            naadf_layout.clone(),
        ],
        shader,
        entry_point: Some(Cow::from(entry_point)),
        ..default()
    }
}

#[derive(Default)]
pub struct NaadfPreviewBuildNode;

impl ViewNode for NaadfPreviewBuildNode {
    type ViewQuery = (&'static ViewTarget, &'static ExtractedView);

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        (view_target, extracted_view): bevy::ecs::query::QueryItem<'w, '_, Self::ViewQuery>,
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        let preview_state = world
            .get_resource::<ExtractedNaadfPreviewPipelineState>()
            .copied()
            .unwrap_or_default();
        if !preview_state.active {
            return Ok(());
        }

        let Some(pipelines) = world.get_resource::<NaadfPreviewBuildPipelines>() else {
            return Ok(());
        };
        let Some(allocation) = world
            .get_resource::<NaadfGpuBuffers>()
            .and_then(NaadfGpuBuffers::allocation)
        else {
            return Ok(());
        };
        if allocation.plan.max_chunks == 0 {
            return Ok(());
        }

        let pipeline_cache = world.resource::<PipelineCache>();
        let Some(build_blocks_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.build_blocks_pipeline)
        else {
            return Ok(());
        };
        let Some(build_bounds_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.build_bounds_pipeline)
        else {
            return Ok(());
        };
        let Some(build_chunks_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.build_chunks_pipeline)
        else {
            return Ok(());
        };
        let Some(build_chunk_bounds_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.build_chunk_bounds_pipeline)
        else {
            return Ok(());
        };
        let Some(first_hit_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.first_hit_pipeline)
        else {
            return Ok(());
        };
        let Some(spatial_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.spatial_pipeline)
        else {
            return Ok(());
        };
        let Some(temporal_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.temporal_pipeline)
        else {
            return Ok(());
        };
        let composite_pipeline_id =
            if view_target.main_texture_format() == ViewTarget::TEXTURE_FORMAT_HDR {
                pipelines.composite_hdr_pipeline
            } else {
                pipelines.composite_sdr_pipeline
            };
        let Some(composite_pipeline) = pipeline_cache.get_render_pipeline(composite_pipeline_id)
        else {
            return Ok(());
        };

        let render_device = render_context.render_device().clone();
        let size = preview_extent(extracted_view);
        if size.width == 0 || size.height == 0 {
            return Ok(());
        }
        let preview_texture =
            create_preview_texture(&render_device, "naadf_preview_first_hit_texture", size);
        let preview_view = preview_texture.create_view(&TextureViewDescriptor::default());
        let preview_depth_texture = create_preview_texture(
            &render_device,
            "naadf_preview_first_hit_depth_texture",
            size,
        );
        let preview_depth_view =
            preview_depth_texture.create_view(&TextureViewDescriptor::default());
        let preview_normal_texture = create_preview_texture(
            &render_device,
            "naadf_preview_first_hit_normal_texture",
            size,
        );
        let preview_normal_view =
            preview_normal_texture.create_view(&TextureViewDescriptor::default());
        let filtered_texture = create_preview_texture(
            &render_device,
            "naadf_preview_spatial_filtered_texture",
            size,
        );
        let filtered_view = filtered_texture.create_view(&TextureViewDescriptor::default());
        let Some(temporal_history) = world.get_resource::<NaadfPreviewTemporalHistory>() else {
            return Ok(());
        };
        let (history_view, temporal_output_view, reset_temporal_history) = temporal_history
            .views_for_frame(
                &render_device,
                extracted_view.retained_view_entity,
                size,
                preview_state.history_generation,
            );
        let preview_settings = world
            .get_resource::<ExtractedNaadfPreviewSettings>()
            .copied()
            .unwrap_or_default();
        let first_hit_uniform = create_uniform_buffer(
            &render_device,
            "naadf_first_hit_params",
            &first_hit_params_uniform(
                extracted_view,
                preview_settings.max_ray_steps,
                allocation.plan.chunk_records as u32,
                world
                    .get_resource::<ExtractedNaadfGpuUploads>()
                    .map(|uploads| uploads.lookup_records.len() as u32)
                    .unwrap_or_default(),
            ),
        );
        let composite_uniform = create_uniform_buffer(
            &render_device,
            "naadf_preview_composite_params",
            &composite_params_uniform(preview_settings.composite_mode),
        );
        let spatial_uniform = create_uniform_buffer(
            &render_device,
            "naadf_spatial_resampling_params",
            &NaadfSpatialResamplingParamsUniform {
                enabled: 1,
                radius: 1,
                depth_sigma: 0.04,
                normal_sigma: 0.25,
            },
        );
        let temporal_uniform = create_uniform_buffer(
            &render_device,
            "naadf_temporal_accumulation_params",
            &NaadfTemporalAccumulationParamsUniform {
                blend_factor: if preview_settings.accumulation_enabled {
                    0.85
                } else {
                    0.0
                },
                reset_history: u32::from(
                    reset_temporal_history || !preview_settings.accumulation_enabled,
                ),
                _pad0: UVec2::ZERO,
            },
        );

        let build_blocks_group = render_device.create_bind_group(
            "naadf_build_blocks_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_blocks_layout),
            &BindGroupEntries::with_indices((
                (0, allocation.voxel_buffer.as_entire_binding()),
                (4, allocation.raw_voxel_buffer.as_entire_binding()),
                (5, allocation.block_buffer.as_entire_binding()),
            )),
        );
        let build_bounds_group = render_device.create_bind_group(
            "naadf_build_bounds_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_bounds_layout),
            &BindGroupEntries::with_indices(((5, allocation.block_buffer.as_entire_binding()),)),
        );
        let build_chunks_group = render_device.create_bind_group(
            "naadf_build_chunks_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_chunks_layout),
            &BindGroupEntries::with_indices((
                (5, allocation.block_buffer.as_entire_binding()),
                (11, allocation.chunk_buffer.as_entire_binding()),
            )),
        );
        let build_chunk_bounds_group = render_device.create_bind_group(
            "naadf_build_chunk_bounds_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_chunk_bounds_layout),
            &BindGroupEntries::with_indices(((11, allocation.chunk_buffer.as_entire_binding()),)),
        );
        let first_hit_group = render_device.create_bind_group(
            "naadf_first_hit_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.first_hit_layout),
            &BindGroupEntries::with_indices((
                (0, allocation.voxel_buffer.as_entire_binding()),
                (1, allocation.material_buffer.as_entire_binding()),
                (5, allocation.block_buffer.as_entire_binding()),
                (11, allocation.chunk_buffer.as_entire_binding()),
                (16, first_hit_uniform.as_entire_binding()),
                (17, BindingResource::TextureView(&preview_view)),
                (18, BindingResource::TextureView(&preview_depth_view)),
                (19, BindingResource::TextureView(&preview_normal_view)),
                (20, allocation.chunk_lookup_buffer.as_entire_binding()),
            )),
        );
        let spatial_group = render_device.create_bind_group(
            "naadf_spatial_resampling_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.spatial_layout),
            &BindGroupEntries::with_indices((
                (10, spatial_uniform.as_entire_binding()),
                (12, BindingResource::TextureView(&preview_view)),
                (13, BindingResource::TextureView(&preview_depth_view)),
                (14, BindingResource::TextureView(&preview_normal_view)),
                (15, BindingResource::TextureView(&filtered_view)),
            )),
        );
        let temporal_group = render_device.create_bind_group(
            "naadf_temporal_accumulation_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.temporal_layout),
            &BindGroupEntries::with_indices((
                (9, temporal_uniform.as_entire_binding()),
                (12, BindingResource::TextureView(&filtered_view)),
                (13, BindingResource::TextureView(&history_view)),
                (14, BindingResource::TextureView(&preview_normal_view)),
                (15, BindingResource::TextureView(&temporal_output_view)),
            )),
        );

        let post_process = view_target.post_process_write();
        let composite_group = render_device.create_bind_group(
            "naadf_preview_fullscreen_composite_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.composite_layout),
            &BindGroupEntries::sequential((
                post_process.source,
                &temporal_output_view,
                composite_uniform.as_entire_binding(),
            )),
        );

        let mut pass =
            render_context
                .command_encoder()
                .begin_compute_pass(&ComputePassDescriptor {
                    label: Some("naadf_preview_build_pass"),
                    timestamp_writes: None,
                });
        pass.set_pipeline(build_blocks_pipeline);
        pass.set_bind_group(3, &build_blocks_group, &[]);
        pass.dispatch_workgroups(allocation.plan.block_records as u32, 1, 1);

        pass.set_pipeline(build_bounds_pipeline);
        pass.set_bind_group(3, &build_bounds_group, &[]);
        pass.dispatch_workgroups(allocation.plan.max_chunks, 1, 1);

        pass.set_pipeline(build_chunks_pipeline);
        pass.set_bind_group(3, &build_chunks_group, &[]);
        pass.dispatch_workgroups(allocation.plan.max_chunks, 1, 1);
        pass.set_pipeline(build_chunk_bounds_pipeline);
        pass.set_bind_group(3, &build_chunk_bounds_group, &[]);
        pass.dispatch_workgroups(
            div_ceil_u64(
                allocation.plan.chunk_records,
                NAADF_BUILD_CHUNKS_WORKGROUP_SIZE as u64,
            ) as u32,
            1,
            1,
        );
        pass.set_pipeline(first_hit_pipeline);
        pass.set_bind_group(3, &first_hit_group, &[]);
        pass.dispatch_workgroups(
            div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            1,
        );
        pass.set_pipeline(spatial_pipeline);
        pass.set_bind_group(3, &spatial_group, &[]);
        pass.dispatch_workgroups(
            div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            1,
        );
        pass.set_pipeline(temporal_pipeline);
        pass.set_bind_group(3, &temporal_group, &[]);
        pass.dispatch_workgroups(
            div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            1,
        );
        drop(pass);
        temporal_history.swap_after_dispatch(extracted_view.retained_view_entity);

        let mut render_pass = render_context.begin_tracked_render_pass(RenderPassDescriptor {
            label: Some("naadf_preview_fullscreen_composite_pass"),
            color_attachments: &[Some(RenderPassColorAttachment {
                view: post_process.destination,
                depth_slice: None,
                resolve_target: None,
                ops: Operations::default(),
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        render_pass.set_render_pipeline(composite_pipeline);
        render_pass.set_bind_group(0, &composite_group, &[]);
        render_pass.draw(0..3, 0..1);

        Ok(())
    }
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfFirstHitParamsUniform {
    camera_origin_max_distance: Vec4,
    camera_forward_fov_y: Vec4,
    camera_right_aspect: Vec4,
    camera_up_pad: Vec4,
    config: UVec4,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfPreviewCompositeParamsUniform {
    mode_split: Vec4,
    pip_min_max: Vec4,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfSpatialResamplingParamsUniform {
    enabled: u32,
    radius: u32,
    depth_sigma: f32,
    normal_sigma: f32,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfTemporalAccumulationParamsUniform {
    blend_factor: f32,
    reset_history: u32,
    _pad0: UVec2,
}

impl NaadfPreviewTemporalHistory {
    fn views_for_frame(
        &self,
        render_device: &bevy::render::renderer::RenderDevice,
        view: RetainedViewEntity,
        size: Extent3d,
        history_generation: u64,
    ) -> (TextureView, TextureView, bool) {
        let mut slots = self.slots.lock().unwrap();
        let first_frame = !slots.contains_key(&view);
        let slot = slots
            .entry(view)
            .or_insert_with(|| NaadfPreviewTemporalHistorySlot {
                size,
                history_generation,
                read_texture: create_preview_texture(
                    render_device,
                    "naadf_preview_temporal_history_read_texture",
                    size,
                ),
                write_texture: create_preview_texture(
                    render_device,
                    "naadf_preview_temporal_history_write_texture",
                    size,
                ),
            });

        let reset_history =
            first_frame || slot.size != size || slot.history_generation != history_generation;
        if reset_history {
            *slot = NaadfPreviewTemporalHistorySlot {
                size,
                history_generation,
                read_texture: create_preview_texture(
                    render_device,
                    "naadf_preview_temporal_history_read_texture",
                    size,
                ),
                write_texture: create_preview_texture(
                    render_device,
                    "naadf_preview_temporal_history_write_texture",
                    size,
                ),
            };
        }

        (
            slot.read_texture
                .create_view(&TextureViewDescriptor::default()),
            slot.write_texture
                .create_view(&TextureViewDescriptor::default()),
            reset_history,
        )
    }

    fn swap_after_dispatch(&self, view: RetainedViewEntity) {
        let mut slots = self.slots.lock().unwrap();
        let Some(slot) = slots.get_mut(&view) else {
            return;
        };
        std::mem::swap(&mut slot.read_texture, &mut slot.write_texture);
    }
}

fn preview_extent(view: &ExtractedView) -> Extent3d {
    Extent3d {
        width: view.viewport.z,
        height: view.viewport.w,
        depth_or_array_layers: 1,
    }
}

fn create_preview_texture(
    render_device: &bevy::render::renderer::RenderDevice,
    label: &'static str,
    size: Extent3d,
) -> Texture {
    render_device.create_texture(&TextureDescriptor {
        label: Some(label),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format: TextureFormat::Rgba16Float,
        usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    })
}

fn first_hit_params_uniform(
    view: &ExtractedView,
    max_ray_steps: u32,
    chunk_records: u32,
    chunk_lookup_records: u32,
) -> NaadfFirstHitParamsUniform {
    let world_from_view = view.world_from_view.to_matrix();
    let origin = world_from_view.w_axis.truncate();
    let right = world_from_view.x_axis.truncate().normalize_or_zero();
    let up = world_from_view.y_axis.truncate().normalize_or_zero();
    let forward = (-world_from_view.z_axis.truncate()).normalize_or_zero();
    let y_scale = view.clip_from_view.y_axis.y.abs().max(0.0001);
    let x_scale = view.clip_from_view.x_axis.x.abs().max(0.0001);
    let fov_y = 2.0 * (1.0 / y_scale).atan();
    let aspect = y_scale / x_scale;

    NaadfFirstHitParamsUniform {
        camera_origin_max_distance: origin.extend(512.0),
        camera_forward_fov_y: forward.extend(fov_y),
        camera_right_aspect: right.extend(aspect),
        camera_up_pad: up.extend(0.0),
        config: UVec4::new(max_ray_steps, chunk_records, chunk_lookup_records, 0),
    }
}

fn composite_params_uniform(mode: NaadfPreviewCompositeMode) -> NaadfPreviewCompositeParamsUniform {
    let mode_value = match mode {
        NaadfPreviewCompositeMode::Fullscreen => 0.0,
        NaadfPreviewCompositeMode::SplitView => 1.0,
        NaadfPreviewCompositeMode::PictureInPicture => 2.0,
    };
    NaadfPreviewCompositeParamsUniform {
        mode_split: Vec4::new(mode_value, 0.5, 0.0, 0.0),
        pip_min_max: Vec4::new(0.68, 0.06, 0.96, 0.34),
    }
}

fn create_uniform_buffer<T: ShaderType + encase::internal::WriteInto>(
    render_device: &bevy::render::renderer::RenderDevice,
    label: &'static str,
    value: &T,
) -> Buffer {
    let mut uniform_buffer = encase::UniformBuffer::new(Vec::<u8>::new());
    uniform_buffer.write(value).unwrap();
    render_device.create_buffer_with_data(&BufferInitDescriptor {
        label: Some(label),
        contents: uniform_buffer.as_ref(),
        usage: BufferUsages::UNIFORM,
    })
}

const fn div_ceil_u64(value: u64, divisor: u64) -> u64 {
    if value == 0 {
        0
    } else {
        ((value - 1) / divisor) + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracted_preview_pipeline_state_copies_render_activation_fields() {
        let mut state = NaadfPreviewPipelineState::default();
        state.active = true;
        state.mode_generation = 7;
        state.history_generation = 11;

        let extracted = ExtractedNaadfPreviewPipelineState::from(&state);

        assert!(extracted.active);
        assert_eq!(extracted.mode_generation, 7);
        assert_eq!(extracted.history_generation, 11);
    }

    #[test]
    fn extracted_preview_settings_copy_temporal_accumulation_flag() {
        let mut settings = NaadfPreviewSettings::default();
        settings.accumulation_enabled = true;
        settings.composite_mode = NaadfPreviewCompositeMode::PictureInPicture;

        let extracted = ExtractedNaadfPreviewSettings::from(&settings);

        assert!(extracted.accumulation_enabled);
        assert_eq!(
            extracted.composite_mode,
            NaadfPreviewCompositeMode::PictureInPicture
        );
    }

    #[test]
    fn build_dispatch_workgroups_round_up_block_records() {
        assert_eq!(div_ceil_u64(0, 64), 0);
        assert_eq!(div_ceil_u64(1, 64), 1);
        assert_eq!(div_ceil_u64(64, 64), 1);
        assert_eq!(div_ceil_u64(65, 64), 2);
    }
}
