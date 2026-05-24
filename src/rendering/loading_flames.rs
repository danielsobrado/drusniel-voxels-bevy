use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::camera::NormalizedRenderTarget;
use bevy::core_pipeline::{
    core_3d::graph::{Core3d, Node3d},
    FullscreenShader,
};
use bevy::prelude::*;
use bevy::render::{
    camera::ExtractedCamera,
    render_graph::{NodeRunError, RenderGraphContext, RenderGraphExt, RenderLabel, ViewNode, ViewNodeRunner},
    render_resource::{
        binding_types, BindGroupEntries, BindGroupLayoutDescriptor, BindGroupLayoutEntries,
        Buffer, BufferDescriptor, BufferUsages, CachedRenderPipelineId, ColorTargetState,
        ColorWrites, FragmentState, Operations, PipelineCache, RenderPassColorAttachment,
        RenderPassDescriptor, RenderPipelineDescriptor, Sampler, SamplerBindingType,
        SamplerDescriptor, ShaderStages, ShaderType, TextureFormat, TextureSampleType,
    },
    renderer::{RenderContext, RenderDevice, RenderQueue},
    view::ViewTarget,
    ExtractSchedule, RenderApp, RenderStartup,
};
use bevy::shader::Shader;
use bevy::window::PrimaryWindow;

use crate::voxel::plugin::WorldStartupLoadingFlames;

const LOADING_FLAMES_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("e0f8c4f6-7a7e-4c95-9d7f-5f1a9f0d8f90");

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct LoadingFlamesLabel;

#[repr(C)]
#[derive(Clone, Copy, ShaderType, bytemuck::Pod, bytemuck::Zeroable)]
struct LoadingFlamesUniform {
    time: f32,
    resolution: [f32; 2],
    mouse: [f32; 2],
}

#[derive(Resource)]
struct ExtractedLoadingFlames {
    uniform: LoadingFlamesUniform,
}

#[derive(Resource)]
struct LoadingFlamesPipeline {
    layout: BindGroupLayoutDescriptor,
    sampler: Sampler,
    uniform_buffer: Buffer,
    hdr_pipeline_id: CachedRenderPipelineId,
    sdr_pipeline_id: CachedRenderPipelineId,
}

fn extract_loading_flames(world: &mut World) {
    let Some((time, resolution, mouse)) = world.resource_scope::<bevy::render::MainWorld, _>(
        |_, main_world| {
            if !main_world
                .get_resource::<WorldStartupLoadingFlames>()
                .is_some_and(|state| state.active)
            {
                return None;
            }

            let time = main_world.get_resource::<Time>()?.elapsed_secs();
            let window = main_world
                .query_filtered::<&Window, With<PrimaryWindow>>()
                .iter(main_world)
                .next()?;
            let width = window.width();
            let height = window.height();
            if width <= 0.0 || height <= 0.0 {
                return None;
            }

            Some((
                time,
                Vec2::new(width, height),
                window.cursor_position().unwrap_or(Vec2::ZERO),
            ))
        },
    ) else {
        world.remove_resource::<ExtractedLoadingFlames>();
        return;
    };

    world.insert_resource(ExtractedLoadingFlames {
        uniform: LoadingFlamesUniform {
            time,
            resolution: [resolution.x, resolution.y],
            mouse: [mouse.x, mouse.y],
        },
    });
}

fn init_loading_flames_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let layout = BindGroupLayoutDescriptor::new(
        "loading_flames_layout",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                binding_types::sampler(SamplerBindingType::Filtering),
                binding_types::uniform_buffer::<LoadingFlamesUniform>(false),
            ),
        ),
    );

    let sampler = render_device.create_sampler(&SamplerDescriptor::default());
    let uniform_buffer = render_device.create_buffer(&BufferDescriptor {
        label: Some("loading_flames_uniform"),
        size: std::mem::size_of::<LoadingFlamesUniform>() as u64,
        usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let pipeline_descriptor = |label: &'static str, format: TextureFormat| RenderPipelineDescriptor {
        label: Some(label.into()),
        layout: vec![layout.clone()],
        vertex: fullscreen_shader.to_vertex_state(),
        fragment: Some(FragmentState {
            shader: LOADING_FLAMES_SHADER_HANDLE,
            targets: vec![Some(ColorTargetState {
                format,
                blend: None,
                write_mask: ColorWrites::ALL,
            })],
            ..default()
        }),
        ..default()
    };
    let hdr_pipeline_id = pipeline_cache
        .queue_render_pipeline(pipeline_descriptor("loading_flames_hdr", ViewTarget::TEXTURE_FORMAT_HDR));
    let sdr_pipeline_id =
        pipeline_cache.queue_render_pipeline(pipeline_descriptor("loading_flames_sdr", TextureFormat::bevy_default()));

    commands.insert_resource(LoadingFlamesPipeline {
        layout,
        sampler,
        uniform_buffer,
        hdr_pipeline_id,
        sdr_pipeline_id,
    });
}

#[derive(Default)]
pub struct LoadingFlamesNode;

impl ViewNode for LoadingFlamesNode {
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

        let Some(overlay) = world.get_resource::<ExtractedLoadingFlames>() else {
            return Ok(());
        };
        let Some(pipeline_res) = world.get_resource::<LoadingFlamesPipeline>() else {
            return Ok(());
        };
        let pipeline_cache = world.resource::<PipelineCache>();
        let pipeline_id = if view_target.main_texture_format() == ViewTarget::TEXTURE_FORMAT_HDR {
            pipeline_res.hdr_pipeline_id
        } else {
            pipeline_res.sdr_pipeline_id
        };
        let Some(pipeline) = pipeline_cache.get_render_pipeline(pipeline_id) else {
            return Ok(());
        };

        world
            .resource::<RenderQueue>()
            .write_buffer(&pipeline_res.uniform_buffer, 0, bytemuck::bytes_of(&overlay.uniform));

        let post_process = view_target.post_process_write();
        let bind_group = render_context.render_device().create_bind_group(
            "loading_flames_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.layout),
            &BindGroupEntries::sequential((
                post_process.source,
                &pipeline_res.sampler,
                pipeline_res.uniform_buffer.as_entire_binding(),
            )),
        );

        let mut render_pass = render_context.begin_tracked_render_pass(RenderPassDescriptor {
            label: Some("loading_flames_pass"),
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

pub struct LoadingFlamesPlugin;

impl Plugin for LoadingFlamesPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            LOADING_FLAMES_SHADER_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/loading_flames.wgsl"),
            Shader::from_wgsl
        );

        let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
            return;
        };

        render_app.add_systems(ExtractSchedule, extract_loading_flames);
        render_app.add_systems(RenderStartup, init_loading_flames_pipeline);
        render_app.add_render_graph_node::<ViewNodeRunner<LoadingFlamesNode>>(
            Core3d,
            LoadingFlamesLabel,
        );
        render_app.add_render_graph_edges(
            Core3d,
            (
                super::weather_overlay::WeatherOverlayLabel,
                LoadingFlamesLabel,
                Node3d::Bloom,
            ),
        );
    }
}
