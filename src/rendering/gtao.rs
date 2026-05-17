//! XeGTAO - Ground Truth Ambient Occlusion
//!
//! Inspired by Intel's XeGTAO: https://github.com/GameTechDev/XeGTAO.
//! Provides a depth-aware fullscreen ambient occlusion pass.
//!
//! Pipeline stages:
//! 1. Prepass: render depth for the active camera
//! 2. Main GTAO: darken scene color using depth-neighborhood occlusion

use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::core_pipeline::{
    FullscreenShader,
    core_3d::graph::{Core3d, Node3d},
    prepass::{DepthPrepass, NormalPrepass, ViewPrepassTextures},
};
use bevy::prelude::*;
use bevy::render::{
    RenderApp, RenderStartup,
    extract_component::{ExtractComponent, ExtractComponentPlugin},
    render_graph::{
        NodeRunError, RenderGraphContext, RenderGraphExt, RenderLabel, ViewNode, ViewNodeRunner,
    },
    render_resource::*,
    renderer::{RenderAdapterInfo, RenderContext, RenderDevice},
    view::ViewTarget,
};
use bevy::shader::Shader;
use std::num::NonZeroU64;
use wgpu::DeviceType;

use crate::rendering::ao_config::{AmbientOcclusionConfig, load_ambient_occlusion_config};
use crate::rendering::water_reflection_compositor::WaterReflectionCompositorLabel;

const GTAO_SHADER_HANDLE: Handle<Shader> = uuid_handle!("8e571a0d-7cf7-4a12-9b2e-27c8f8e5b6a4");

/// GTAO Plugin - Adds Ground Truth Ambient Occlusion to the render pipeline
pub struct GtaoPlugin;

impl Plugin for GtaoPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            GTAO_SHADER_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/gtao_main.wgsl"),
            Shader::from_wgsl
        );

        let config = load_ambient_occlusion_config().unwrap_or_else(|e| {
            warn!("Failed to load AO config: {}, using defaults", e);
            AmbientOcclusionConfig::default()
        });

        app.insert_resource(config)
            .init_resource::<GtaoSupported>()
            .add_plugins(ExtractComponentPlugin::<GtaoSettings>::default())
            .add_systems(Startup, detect_gtao_support)
            .add_systems(PostStartup, configure_camera_gtao);

        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app.add_systems(RenderStartup, init_gtao_pipeline);
            render_app.add_render_graph_node::<ViewNodeRunner<GtaoNode>>(Core3d, GtaoLabel);
            render_app.add_render_graph_edges(
                Core3d,
                (
                    Node3d::EndMainPass,
                    GtaoLabel,
                    WaterReflectionCompositorLabel,
                ),
            );
        }
    }

    fn finish(&self, app: &mut App) {
        let _ = app;
    }
}

/// Tracks whether GTAO is supported on current hardware
#[derive(Resource, Default)]
pub struct GtaoSupported(pub bool);

/// Marker component for cameras with GTAO enabled
#[derive(Component)]
pub struct GtaoCamera;

/// GTAO quality settings - configures the algorithm parameters
#[derive(Component, Clone, ExtractComponent)]
pub struct GtaoSettings {
    /// Number of slices (directions) to sample - 2 to 4 recommended
    pub slice_count: u32,
    /// Samples per direction - 2-4 recommended
    pub steps_per_slice: u32,
    /// World-space radius in meters
    pub radius: f32,
    /// Distance falloff range
    pub falloff_range: f32,
    /// Power curve for final AO value (1.5-2.5)
    pub final_value_power: f32,
    /// Sample distribution power (2.0 default)
    pub sample_distribution_power: f32,
    /// Reduces over-darkening from thin occluders (0.0-1.0)
    pub thin_occluder_compensation: f32,
}

impl Default for GtaoSettings {
    fn default() -> Self {
        Self {
            slice_count: 3,
            steps_per_slice: 3,
            radius: 2.0,
            falloff_range: 1.0,
            final_value_power: 2.0,
            sample_distribution_power: 2.0,
            thin_occluder_compensation: 0.0,
        }
    }
}

/// GPU uniform buffer for GTAO settings
#[derive(Clone, Copy, ShaderType, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
pub struct GtaoSettingsUniform {
    pub slice_count: u32,
    pub steps_per_slice: u32,
    pub radius: f32,
    pub falloff_range: f32,
    pub final_value_power: f32,
    pub sample_distribution_power: f32,
    pub thin_occluder_compensation: f32,
    pub _padding: f32,
}

impl GtaoSettingsUniform {
    pub const SIZE: u64 = std::mem::size_of::<Self>() as u64;

    pub fn min_size() -> NonZeroU64 {
        NonZeroU64::new(Self::SIZE).unwrap()
    }
}

impl From<&GtaoSettings> for GtaoSettingsUniform {
    fn from(settings: &GtaoSettings) -> Self {
        Self {
            slice_count: settings.slice_count,
            steps_per_slice: settings.steps_per_slice,
            radius: settings.radius,
            falloff_range: settings.falloff_range,
            final_value_power: settings.final_value_power,
            sample_distribution_power: settings.sample_distribution_power,
            thin_occluder_compensation: settings.thin_occluder_compensation,
            _padding: 0.0,
        }
    }
}

fn detect_gtao_support(
    adapter_info: Option<Res<RenderAdapterInfo>>,
    config: Res<AmbientOcclusionConfig>,
    mut supported: ResMut<GtaoSupported>,
) {
    #[cfg(target_arch = "wasm32")]
    {
        supported.0 = false;
        info!("GTAO disabled: WebGL2 lacks required features");
        return;
    }

    let mut is_integrated = false;
    let mut adapter_name = "Unknown GPU".to_string();

    if let Some(info) = adapter_info {
        adapter_name = info.name.clone();
        let name = adapter_name.to_lowercase();
        is_integrated = name.contains("intel")
            || name.contains("integrated")
            || matches!(info.device_type, DeviceType::IntegratedGpu);
    }

    let gtao_config = config.gtao.as_ref();
    let disable_on_integrated = gtao_config
        .map(|gtao| gtao.disable_on_integrated_gpu)
        .unwrap_or(config.ssao.disable_on_integrated_gpu);

    if disable_on_integrated && is_integrated {
        supported.0 = false;
        warn!("GTAO disabled: Integrated GPU detected ({})", adapter_name);
        return;
    }

    supported.0 = gtao_config.is_some_and(|gtao| gtao.enabled);
    info!("GTAO support: {} (GPU: {})", supported.0, adapter_name);
}

/// Returns GTAO settings from the active numeric GTAO configuration.
pub fn gtao_settings_from_config(config: &AmbientOcclusionConfig) -> GtaoSettings {
    let Some(gtao) = config.gtao.as_ref() else {
        return GtaoSettings::default();
    };

    GtaoSettings {
        slice_count: gtao.slice_count,
        steps_per_slice: gtao.steps_per_slice,
        radius: gtao.radius,
        falloff_range: gtao.falloff_range,
        final_value_power: gtao.final_value_power,
        sample_distribution_power: gtao.sample_distribution_power,
        thin_occluder_compensation: gtao.thin_occluder_compensation,
    }
}

/// Returns GTAO component for a camera if supported and enabled.
pub fn gtao_camera_components(
    config: &AmbientOcclusionConfig,
    supported: &GtaoSupported,
) -> Option<GtaoSettings> {
    let Some(gtao_config) = config.gtao.as_ref() else {
        return None;
    };
    if !supported.0 || !gtao_config.enabled {
        return None;
    }

    Some(gtao_settings_from_config(config))
}

fn configure_camera_gtao(
    mut commands: Commands,
    config: Res<AmbientOcclusionConfig>,
    supported: Res<GtaoSupported>,
    cameras: Query<Entity, (With<Camera3d>, Without<GtaoCamera>)>,
) {
    for entity in cameras.iter() {
        commands.entity(entity).insert(GtaoCamera);

        if let Some(gtao) = gtao_camera_components(&config, &supported) {
            // GTAO samples depth now and keeps normals available for future quality upgrades.
            commands
                .entity(entity)
                .insert((gtao, DepthPrepass, NormalPrepass));
            info!("GTAO enabled on camera {:?}", entity);
        }
    }
}

/// Runtime toggle for GTAO
pub fn toggle_gtao(
    mut commands: Commands,
    config: Res<AmbientOcclusionConfig>,
    supported: Res<GtaoSupported>,
    cameras: Query<(Entity, Option<&GtaoSettings>), With<GtaoCamera>>,
    enable: bool,
) {
    for (entity, existing) in cameras.iter() {
        if enable && existing.is_none() && supported.0 {
            if let Some(gtao) = gtao_camera_components(&config, &supported) {
                commands
                    .entity(entity)
                    .insert((gtao, DepthPrepass, NormalPrepass));
            }
        } else if !enable && existing.is_some() {
            commands.entity(entity).remove::<GtaoSettings>();
        }
    }
}

#[derive(Resource)]
struct GtaoPostPipeline {
    layout: BindGroupLayoutDescriptor,
    sampler: Sampler,
    hdr_pipeline_id: CachedRenderPipelineId,
    sdr_pipeline_id: CachedRenderPipelineId,
}

fn init_gtao_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let layout = BindGroupLayoutDescriptor::new(
        "gtao_post_layout",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                binding_types::sampler(SamplerBindingType::Filtering),
                binding_types::texture_depth_2d(),
                binding_types::uniform_buffer::<GtaoSettingsUniform>(false),
            ),
        ),
    );

    let sampler = render_device.create_sampler(&SamplerDescriptor::default());
    let pipeline_descriptor =
        |label: &'static str, format: TextureFormat| RenderPipelineDescriptor {
            label: Some(label.into()),
            layout: vec![layout.clone()],
            vertex: fullscreen_shader.to_vertex_state(),
            fragment: Some(FragmentState {
                shader: GTAO_SHADER_HANDLE,
                targets: vec![Some(ColorTargetState {
                    format,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
                ..default()
            }),
            ..default()
        };

    let hdr_pipeline_id = pipeline_cache.queue_render_pipeline(pipeline_descriptor(
        "gtao_pipeline_hdr",
        ViewTarget::TEXTURE_FORMAT_HDR,
    ));
    let sdr_pipeline_id = pipeline_cache.queue_render_pipeline(pipeline_descriptor(
        "gtao_pipeline_sdr",
        TextureFormat::bevy_default(),
    ));

    commands.insert_resource(GtaoPostPipeline {
        layout,
        sampler,
        hdr_pipeline_id,
        sdr_pipeline_id,
    });
}

// ============================================================================
// Render Graph Node
// ============================================================================

/// Render graph label for GTAO
#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct GtaoLabel;

/// GTAO render graph node.
#[derive(Default)]
pub struct GtaoNode;

impl ViewNode for GtaoNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static ViewPrepassTextures,
        &'static GtaoSettings,
    );

    fn run(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext,
        (view_target, prepass_textures, settings): bevy::ecs::query::QueryItem<Self::ViewQuery>,
        world: &World,
    ) -> Result<(), NodeRunError> {
        let Some(depth_view) = prepass_textures.depth_view() else {
            return Ok(());
        };
        let Some(pipeline_res) = world.get_resource::<GtaoPostPipeline>() else {
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

        let uniform = GtaoSettingsUniform::from(settings);
        let uniform_buffer =
            render_context
                .render_device()
                .create_buffer_with_data(&BufferInitDescriptor {
                    label: Some("gtao_settings_uniform"),
                    contents: bytemuck::bytes_of(&uniform),
                    usage: BufferUsages::UNIFORM,
                });

        let post_process = view_target.post_process_write();
        let bind_group = render_context.render_device().create_bind_group(
            "gtao_post_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.layout),
            &BindGroupEntries::sequential((
                post_process.source,
                &pipeline_res.sampler,
                depth_view,
                uniform_buffer.as_entire_binding(),
            )),
        );

        let mut render_pass = render_context.begin_tracked_render_pass(RenderPassDescriptor {
            label: Some("gtao_post_pass"),
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
