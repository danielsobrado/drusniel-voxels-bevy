//! Post-processing compositor for planar water reflections.
//!
//! Inserts a fullscreen render graph node after the main 3D pass.  The node
//! reconstructs world-Y from the depth prepass and blends the
//! `WaterReflectionTexture` into the scene at water-surface pixels using
//! Schlick Fresnel.
//!
//! If reflections are disabled (integrated GPU or config) the node is a no-op.

use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::core_pipeline::{
    core_3d::graph::{Core3d, Node3d},
    prepass::ViewPrepassTextures,
    FullscreenShader,
};
use bevy::prelude::*;
use bevy::render::{
    render_asset::RenderAssets,
    render_graph::{
        NodeRunError, RenderGraphContext, RenderGraphExt, RenderLabel, ViewNode, ViewNodeRunner,
    },
    render_resource::{
        binding_types, BindGroupEntries, BindGroupLayoutDescriptor, BindGroupLayoutEntries,
        CachedRenderPipelineId, ColorTargetState, ColorWrites, FragmentState, Operations,
        PipelineCache, RenderPassColorAttachment, RenderPassDescriptor,
        RenderPipelineDescriptor, Sampler, SamplerBindingType, SamplerDescriptor, ShaderStages,
        TextureSampleType,
    },
    renderer::{RenderContext, RenderDevice},
    texture::GpuImage,
    view::{ViewTarget, ViewUniformOffset, ViewUniforms},
    ExtractSchedule, RenderApp, RenderStartup,
};
use bevy::shader::Shader;

use crate::rendering::water_reflection::WaterReflectionTexture;

const COMPOSITOR_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("f0e1d2c3-b4a5-9678-efab-012345678901");

/// Label used to identify the compositor node in the render graph.
#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct WaterReflectionCompositorLabel;

// ─── Extraction ──────────────────────────────────────────────────────────────

/// Holds the reflection texture handle in the render world so the node can
/// look up the GPU image without touching the main world.
#[derive(Resource, Clone)]
struct ExtractedReflectionHandle(Handle<Image>);

fn extract_reflection_texture(world: &mut World) {
    let handle = world.resource_scope::<bevy::render::MainWorld, _>(|_, main_world| {
        main_world
            .get_resource::<WaterReflectionTexture>()
            .map(|r| r.image.clone())
    });
    match handle {
        Some(h) => {
            world.insert_resource(ExtractedReflectionHandle(h));
        }
        None => {
            world.remove_resource::<ExtractedReflectionHandle>();
        }
    }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

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
                // 0: scene colour texture
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                // 1: sampler (shared by scene + reflection)
                binding_types::sampler(SamplerBindingType::Filtering),
                // 2: reflection texture
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                // 3: depth prepass (load-only, no sampler)
                binding_types::texture_depth_2d(),
                // 4: Bevy View uniform (contains inverse clip_from_world, world_position)
                binding_types::uniform_buffer::<bevy::render::view::ViewUniform>(true),
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

// ─── Render Graph Node ───────────────────────────────────────────────────────

#[derive(Default)]
pub struct CompositorNode;

impl ViewNode for CompositorNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static ViewPrepassTextures,
        &'static ViewUniformOffset,
    );

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        (view_target, prepass_textures, view_offset): bevy::ecs::query::QueryItem<'w, '_, Self::ViewQuery>,
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        // ── Guard: reflection texture must exist in the render world ─────────
        let Some(handle) = world.get_resource::<ExtractedReflectionHandle>() else {
            return Ok(());
        };
        let gpu_images = world.resource::<RenderAssets<GpuImage>>();
        let Some(refl_gpu) = gpu_images.get(&handle.0) else {
            return Ok(());
        };

        // ── Depth prepass ────────────────────────────────────────────────────
        let Some(depth_view) = prepass_textures.depth_view() else {
            return Ok(());
        };

        // ── View uniform ─────────────────────────────────────────────────────
        let view_uniforms = world.resource::<ViewUniforms>();
        let Some(view_binding) = view_uniforms.uniforms.binding() else {
            return Ok(());
        };

        // ── Pipeline ─────────────────────────────────────────────────────────
        let Some(pipeline_res) = world.get_resource::<CompositorPipeline>() else {
            return Ok(());
        };
        let pipeline_cache = world.resource::<PipelineCache>();
        let Some(pipeline) = pipeline_cache.get_render_pipeline(pipeline_res.pipeline_id) else {
            return Ok(());
        };

        // ── Post-process write (ping-pong source ↔ destination) ──────────────
        let post_process = view_target.post_process_write();

        // ── Bind group ───────────────────────────────────────────────────────
        let bind_group = render_context.render_device().create_bind_group(
            "water_reflection_compositor_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.layout),
            &BindGroupEntries::sequential((
                post_process.source,             // 0: scene colour
                &pipeline_res.sampler,           // 1: sampler
                &refl_gpu.texture_view,          // 2: reflection
                depth_view,                      // 3: depth
                view_binding.clone(),            // 4: View uniform
            )),
        );

        // ── Render pass ──────────────────────────────────────────────────────
        let mut render_pass =
            render_context.begin_tracked_render_pass(RenderPassDescriptor {
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
        render_pass.set_bind_group(0, &bind_group, &[view_offset.offset]);
        render_pass.draw(0..3, 0..1); // Fullscreen triangle

        Ok(())
    }
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

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

        // Extract the reflection texture handle each frame
        render_app.add_systems(ExtractSchedule, extract_reflection_texture);

        // Initialise pipeline once RenderDevice is available
        render_app.add_systems(RenderStartup, init_compositor_pipeline);

        // Add the compositor node to the Core3d render graph
        render_app.add_render_graph_node::<ViewNodeRunner<CompositorNode>>(
            Core3d,
            WaterReflectionCompositorLabel,
        );

        // Wire: EndMainPass → Compositor → Bloom
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
