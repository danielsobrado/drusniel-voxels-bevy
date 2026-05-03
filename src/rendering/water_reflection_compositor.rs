//! Post-processing compositor for planar water reflections.
//!
//! The pass samples a water mask generated from actual `WaterMesh` geometry and
//! only blends planar reflections on pixels covered by that mask.

use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::camera::NormalizedRenderTarget;
use bevy::core_pipeline::{
    FullscreenShader,
    core_3d::graph::{Core3d, Node3d},
};
use bevy::prelude::*;
use bevy::render::{
    ExtractSchedule, RenderApp, RenderStartup,
    camera::ExtractedCamera,
    render_asset::RenderAssets,
    render_graph::{
        NodeRunError, RenderGraphContext, RenderGraphExt, RenderLabel, ViewNode, ViewNodeRunner,
    },
    render_resource::{
        BindGroupEntries, BindGroupLayoutDescriptor, BindGroupLayoutEntries, BufferInitDescriptor,
        BufferUsages, CachedRenderPipelineId, ColorTargetState, ColorWrites, FragmentState,
        Operations, PipelineCache, RenderPassColorAttachment, RenderPassDescriptor,
        RenderPipelineDescriptor, Sampler, SamplerBindingType, SamplerDescriptor, ShaderStages,
        ShaderType, TextureSampleType, binding_types,
    },
    renderer::{RenderContext, RenderDevice},
    texture::GpuImage,
    view::ViewTarget,
};
use bevy::shader::Shader;

use crate::rendering::water_reflection::{
    WaterReflectionBodyParams, WaterReflectionDebugViewMode, WaterReflectionMaskTexture,
    WaterReflectionStatus, WaterReflectionTexture,
};

const COMPOSITOR_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("f0e1d2c3-b4a5-9678-efab-012345678901");

/// Label used to identify the compositor node in the render graph.
#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct WaterReflectionCompositorLabel;

#[derive(Resource, Clone)]
struct ExtractedReflectionHandle(Handle<Image>);

#[derive(Resource, Clone)]
struct ExtractedWaterMaskHandle(Handle<Image>);

#[derive(Resource, Clone, Copy, Default)]
struct ExtractedReflectionStatus {
    sample_reflection: bool,
    debug_view: u32,
    reflection_strength: f32,
    fresnel_power: f32,
    distortion_strength: f32,
    surface_y: f32,
}

#[repr(C)]
#[derive(Clone, Copy, ShaderType, bytemuck::Pod, bytemuck::Zeroable)]
struct ReflectionCompositorUniform {
    flags: [u32; 4],
    params: [f32; 4],
}

fn extract_reflection_texture(world: &mut World) {
    let compositor_disabled =
        std::env::var_os("VOXEL_DISABLE_WATER_REFLECTION_COMPOSITOR").is_some();
    let (handle, mask_handle, sample_reflection, debug_view, params) = world
        .resource_scope::<bevy::render::MainWorld, _>(|_, main_world| {
            (
                main_world
                    .get_resource::<WaterReflectionTexture>()
                    .map(|r| r.image.clone()),
                main_world
                    .get_resource::<WaterReflectionMaskTexture>()
                    .map(|r| r.image.clone()),
                main_world
                    .get_resource::<WaterReflectionStatus>()
                    .map(|s| s.sample_reflection)
                    .unwrap_or(false),
                main_world
                    .get_resource::<WaterReflectionDebugViewMode>()
                    .map(|mode| mode.as_u32())
                    .unwrap_or(0),
                main_world
                    .get_resource::<WaterReflectionBodyParams>()
                    .copied()
                    .unwrap_or_default(),
            )
        });
    let sample_reflection = sample_reflection && !compositor_disabled;
    match (handle, mask_handle) {
        (Some(h), Some(mask)) => {
            world.insert_resource(ExtractedReflectionHandle(h));
            world.insert_resource(ExtractedWaterMaskHandle(mask));
            world.insert_resource(ExtractedReflectionStatus {
                sample_reflection,
                debug_view,
                reflection_strength: params.reflection_strength,
                fresnel_power: params.fresnel_power,
                distortion_strength: params.distortion_strength,
                surface_y: params.surface_y,
            });
        }
        _ => {
            world.remove_resource::<ExtractedReflectionHandle>();
            world.remove_resource::<ExtractedWaterMaskHandle>();
            world.remove_resource::<ExtractedReflectionStatus>();
        }
    }
}

#[derive(Resource)]
struct CompositorPipeline {
    layout: BindGroupLayoutDescriptor,
    sampler: Sampler,
    pipeline_id: CachedRenderPipelineId,
}

fn init_compositor_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let layout = BindGroupLayoutDescriptor::new(
        "water_reflection_compositor_layout",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                binding_types::sampler(SamplerBindingType::Filtering),
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                binding_types::uniform_buffer::<ReflectionCompositorUniform>(false),
            ),
        ),
    );

    let sampler = render_device.create_sampler(&SamplerDescriptor::default());

    let pipeline_id = pipeline_cache.queue_render_pipeline(RenderPipelineDescriptor {
        label: Some("water_reflection_compositor_pipeline".into()),
        layout: vec![layout.clone()],
        vertex: fullscreen_shader.to_vertex_state(),
        fragment: Some(FragmentState {
            shader: COMPOSITOR_SHADER_HANDLE,
            targets: vec![Some(ColorTargetState {
                format: ViewTarget::TEXTURE_FORMAT_HDR,
                blend: None,
                write_mask: ColorWrites::ALL,
            })],
            ..default()
        }),
        ..default()
    });

    commands.insert_resource(CompositorPipeline {
        layout,
        sampler,
        pipeline_id,
    });
}

#[derive(Default)]
pub struct CompositorNode;

impl ViewNode for CompositorNode {
    type ViewQuery = (&'static ViewTarget, &'static ExtractedCamera);

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        (view_target, extracted_camera): bevy::ecs::query::QueryItem<'w, '_, Self::ViewQuery>,
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        if !matches!(
            extracted_camera.target.as_ref(),
            Some(NormalizedRenderTarget::Window(_))
        ) {
            return Ok(());
        }

        let Some(handle) = world.get_resource::<ExtractedReflectionHandle>() else {
            return Ok(());
        };
        let Some(mask_handle) = world.get_resource::<ExtractedWaterMaskHandle>() else {
            return Ok(());
        };
        let gpu_images = world.resource::<RenderAssets<GpuImage>>();
        let Some(refl_gpu) = gpu_images.get(&handle.0) else {
            return Ok(());
        };
        let Some(mask_gpu) = gpu_images.get(&mask_handle.0) else {
            return Ok(());
        };
        let status = world
            .get_resource::<ExtractedReflectionStatus>()
            .copied()
            .unwrap_or_default();

        let Some(pipeline_res) = world.get_resource::<CompositorPipeline>() else {
            return Ok(());
        };
        let pipeline_cache = world.resource::<PipelineCache>();
        let Some(pipeline) = pipeline_cache.get_render_pipeline(pipeline_res.pipeline_id) else {
            return Ok(());
        };

        let post_process = view_target.post_process_write();

        let uniform = ReflectionCompositorUniform {
            flags: [u32::from(status.sample_reflection), status.debug_view, 0, 0],
            params: [
                status.reflection_strength,
                status.fresnel_power,
                status.distortion_strength,
                status.surface_y,
            ],
        };
        let uniform_buffer =
            render_context
                .render_device()
                .create_buffer_with_data(&BufferInitDescriptor {
                    label: Some("water_reflection_compositor_uniform"),
                    contents: bytemuck::bytes_of(&uniform),
                    usage: BufferUsages::UNIFORM,
                });

        let bind_group = render_context.render_device().create_bind_group(
            "water_reflection_compositor_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.layout),
            &BindGroupEntries::sequential((
                post_process.source,
                &pipeline_res.sampler,
                &refl_gpu.texture_view,
                &mask_gpu.texture_view,
                uniform_buffer.as_entire_binding(),
            )),
        );

        let mut render_pass = render_context.begin_tracked_render_pass(RenderPassDescriptor {
            label: Some("water_reflection_compositor_pass"),
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

        render_pass.set_render_pipeline(pipeline);
        render_pass.set_bind_group(0, &bind_group, &[]);
        render_pass.draw(0..3, 0..1);

        Ok(())
    }
}

pub struct WaterReflectionCompositorPlugin;

impl Plugin for WaterReflectionCompositorPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            COMPOSITOR_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/water_reflection_compositor.wgsl"
            ),
            Shader::from_wgsl
        );

        let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
            return;
        };

        render_app.add_systems(ExtractSchedule, extract_reflection_texture);
        render_app.add_systems(RenderStartup, init_compositor_pipeline);
        render_app.add_render_graph_node::<ViewNodeRunner<CompositorNode>>(
            Core3d,
            WaterReflectionCompositorLabel,
        );
        render_app.add_render_graph_edges(
            Core3d,
            (
                Node3d::EndMainPass,
                WaterReflectionCompositorLabel,
                Node3d::Bloom,
            ),
        );
    }
}
