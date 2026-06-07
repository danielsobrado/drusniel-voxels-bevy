//! Post-processing compositor for planar water reflections.
//!
//! The pass samples a water mask generated from actual `WaterMesh` geometry and
//! only blends planar reflections on pixels covered by that mask.

use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::camera::NormalizedRenderTarget;
use bevy::core_pipeline::{
    FullscreenShader,
    core_3d::graph::{Core3d, Node3d},
    prepass::{DepthPrepass, ViewPrepassTextures},
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
        ShaderType, TextureFormat, TextureSampleType, binding_types,
    },
    renderer::{RenderContext, RenderDevice},
    texture::GpuImage,
    view::{ViewTarget, ViewUniformOffset, ViewUniforms},
};
use bevy::shader::Shader;

use crate::camera::controller::PlayerCamera;
use crate::rendering::render_timing::RenderTimingSink;
use crate::rendering::water::WaterConfig;
use crate::rendering::water_reflection::{
    WaterReflectionBodyParams, WaterReflectionConfig, WaterReflectionDebugViewMode,
    WaterReflectionMaskTexture, WaterReflectionStatus, WaterReflectionTexture,
};
use crate::rendering::witchcraft_water_finish::WitchcraftWaterFinishParams;
use crate::weather::{WeatherRuntime, WeatherShaderUniforms};

const COMPOSITOR_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("f0e1d2c3-b4a5-9678-efab-012345678901");
const NEAR_SKY_WATER_MASK_DISTANCE: f32 = 32.0;

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
    sky_mask_max_distance: f32,
    weather: WeatherShaderUniforms,
    weather_water: [f32; 4],
    refraction: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, ShaderType, bytemuck::Pod, bytemuck::Zeroable)]
struct ReflectionCompositorUniform {
    flags: [u32; 4],
    params: [f32; 4],
    params2: [f32; 4],
    weather: WeatherShaderUniforms,
    weather_water: [f32; 4],
    refraction: [f32; 4],
}

fn configure_compositor_depth_prepass(
    mut commands: Commands,
    config: Option<Res<WaterReflectionConfig>>,
    cameras: Query<Entity, (With<PlayerCamera>, Without<DepthPrepass>)>,
) {
    if config.is_some_and(|config| !config.enabled) {
        return;
    }

    for entity in &cameras {
        commands.entity(entity).insert(DepthPrepass);
    }
}

fn extract_reflection_texture(world: &mut World) {
    let compositor_disabled =
        std::env::var_os("VOXEL_DISABLE_WATER_REFLECTION_COMPOSITOR").is_some();
    let (
        handle,
        mask_handle,
        sample_reflection,
        debug_view,
        params,
        witchcraft_params,
        weather,
        weather_water,
        refraction,
        sky_mask_max_distance,
    ) = world.resource_scope::<bevy::render::MainWorld, _>(|_, main_world| {
        let water_config = main_world.get_resource::<WaterConfig>();
        let sky_mask_max_distance = main_world
            .get_resource::<WaterReflectionConfig>()
            .map(|config| {
                config
                    .auto_disable_distance
                    .max(NEAR_SKY_WATER_MASK_DISTANCE)
            })
            .unwrap_or(WaterReflectionConfig::default().auto_disable_distance);
        let weather_water = water_config
            .map(|config| {
                [
                    config.weather.rain_distortion_boost.max(0.0),
                    config.weather.rain_reflection_boost.max(0.0),
                    config.weather.snow_reflection_soften.clamp(0.0, 1.0),
                    0.0,
                ]
            })
            .unwrap_or_else(|| {
                let defaults = crate::rendering::water::WaterWeatherConfig::default();
                [
                    defaults.rain_distortion_boost,
                    defaults.rain_reflection_boost,
                    defaults.snow_reflection_soften,
                    0.0,
                ]
            });
        let refraction = water_config
            .map(|config| {
                [
                    if config.refraction.enabled { 1.0 } else { 0.0 },
                    config.refraction.strength.max(0.0),
                    config.refraction.ior.max(1.0),
                    if config.refraction.chromatic_aberration {
                        1.0
                    } else {
                        0.0
                    },
                ]
            })
            .unwrap_or_else(|| {
                let defaults = crate::rendering::water::RefractionConfig::default();
                [
                    if defaults.enabled { 1.0 } else { 0.0 },
                    defaults.strength,
                    defaults.ior,
                    if defaults.chromatic_aberration {
                        1.0
                    } else {
                        0.0
                    },
                ]
            });
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
            main_world
                .get_resource::<WitchcraftWaterFinishParams>()
                .copied()
                .unwrap_or_default(),
            main_world
                .get_resource::<WeatherRuntime>()
                .map(|runtime| runtime.uniforms)
                .unwrap_or_default(),
            weather_water,
            refraction,
            sky_mask_max_distance,
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
                reflection_strength: params.reflection_strength
                    * witchcraft_params.reflection_multiplier_base(),
                fresnel_power: params.fresnel_power,
                distortion_strength: params.distortion_strength,
                surface_y: params.surface_y,
                sky_mask_max_distance,
                weather,
                weather_water,
                refraction,
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
    hdr_pipeline_id: CachedRenderPipelineId,
    sdr_pipeline_id: CachedRenderPipelineId,
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
                binding_types::texture_depth_2d(),
                binding_types::uniform_buffer::<bevy::render::view::ViewUniform>(true),
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
                shader: COMPOSITOR_SHADER_HANDLE,
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
        "water_reflection_compositor_pipeline_hdr",
        ViewTarget::TEXTURE_FORMAT_HDR,
    ));
    let sdr_pipeline_id = pipeline_cache.queue_render_pipeline(pipeline_descriptor(
        "water_reflection_compositor_pipeline_sdr",
        TextureFormat::bevy_default(),
    ));

    commands.insert_resource(CompositorPipeline {
        layout,
        sampler,
        hdr_pipeline_id,
        sdr_pipeline_id,
    });
}

#[derive(Default)]
pub struct CompositorNode;

impl ViewNode for CompositorNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static ExtractedCamera,
        &'static ViewPrepassTextures,
        &'static ViewUniformOffset,
    );

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        (view_target, extracted_camera, prepass_textures, view_offset): bevy::ecs::query::QueryItem<
            'w,
            '_,
            Self::ViewQuery,
        >,
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
        let Some(depth_view) = prepass_textures.depth_view() else {
            return Ok(());
        };
        let view_uniforms = world.resource::<ViewUniforms>();
        let Some(view_binding) = view_uniforms.uniforms.binding() else {
            return Ok(());
        };

        let Some(pipeline_res) = world.get_resource::<CompositorPipeline>() else {
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

        let post_process = view_target.post_process_write();

        let uniform = ReflectionCompositorUniform {
            flags: [u32::from(status.sample_reflection), status.debug_view, 0, 0],
            params: [
                status.reflection_strength,
                status.fresnel_power,
                status.distortion_strength,
                status.surface_y,
            ],
            params2: [status.sky_mask_max_distance, 0.0, 0.0, 0.0],
            weather: status.weather,
            weather_water: status.weather_water,
            refraction: status.refraction,
        };
        if let Some(timing) = world.get_resource::<RenderTimingSink>() {
            timing.push_count(
                "Water Weather Distortion Boost",
                (status.weather.rain_factor * status.weather_water[0]) as f64,
            );
            timing.push_count(
                "Water Weather Reflection Boost",
                (status.weather.rain_factor * status.weather_water[1]) as f64,
            );
            timing.push_count("Water Refraction Enabled", status.refraction[0] as f64);
            timing.push_count("Water Refraction Strength", status.refraction[1] as f64);
        }
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
                depth_view,
                view_binding.clone(),
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
        render_pass.set_bind_group(0, &bind_group, &[view_offset.offset]);
        render_pass.draw(0..3, 0..1);

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn compositor_shader_scrubs_disabled_reflection_alpha() {
        let shader = include_str!("../../../assets/shaders/water_reflection_compositor.wgsl");

        assert!(shader.contains("return vec4<f32>(base_scene.rgb, 1.0);"));
        assert!(!shader.contains("return base_scene;"));
    }

    #[test]
    fn compositor_queues_hdr_and_sdr_pipelines() {
        let source = include_str!("reflection_compositor.rs");

        assert!(source.contains("hdr_pipeline_id"));
        assert!(source.contains("sdr_pipeline_id"));
        assert!(source.contains("ViewTarget::TEXTURE_FORMAT_HDR"));
        assert!(source.contains("TextureFormat::bevy_default()"));
        assert!(source.contains("view_target.main_texture_format()"));
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

        app.add_systems(Update, configure_compositor_depth_prepass);

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
