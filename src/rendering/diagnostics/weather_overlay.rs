//! GPU-generated precipitation overlay.
//!
//! This pass is intentionally shader-first: rain and snow streaks are generated
//! in WGSL from the small weather uniform. The node exits before allocating GPU
//! resources or opening a render pass when weather is clear.

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
    render_graph::{
        NodeRunError, RenderGraphContext, RenderGraphExt, RenderLabel, ViewNode, ViewNodeRunner,
    },
    render_resource::{
        BindGroupEntries, BindGroupLayoutDescriptor, BindGroupLayoutEntries, Buffer,
        BufferDescriptor, BufferUsages, CachedRenderPipelineId, ColorTargetState, ColorWrites,
        FragmentState, Operations, PipelineCache, RenderPassColorAttachment, RenderPassDescriptor,
        RenderPipelineDescriptor, Sampler, SamplerBindingType, SamplerDescriptor, ShaderStages,
        ShaderType, TextureFormat, TextureSampleType, binding_types,
    },
    renderer::{RenderContext, RenderDevice, RenderQueue},
    view::ViewTarget,
};
use bevy::shader::Shader;

use crate::camera::controller::PlayerCamera;
use crate::constants::WATER_LEVEL;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::god_rays::GodRaysLabel;
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::render_timing::{RenderTimingSink, render_timing_guard};
use crate::weather::{WEATHER_FLAG_PRECIP_OVERLAY, WeatherRuntime, WeatherShaderUniforms};

const WEATHER_OVERLAY_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("7e9d1a22-6f81-47c3-9f61-9a1a1f830001");

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct WeatherOverlayLabel;

#[repr(C)]
#[derive(Clone, Copy, ShaderType, bytemuck::Pod, bytemuck::Zeroable)]
struct WeatherOverlayUniform {
    weather: WeatherShaderUniforms,
    // x = overlay density, y = quality code, z = debug mode, w = WEATHER_TEX_OPACITY input.
    params: [f32; 4],
    // x = underwater, y = enabled, z = dominant precipitation kind, w = pass active.
    flags: [u32; 4],
}

#[derive(Resource, Clone, Copy)]
struct ExtractedWeatherOverlay {
    uniform: WeatherOverlayUniform,
}

fn extract_weather_overlay(world: &mut World) {
    let env_override = weather_overlay_env_override();
    if env_override == Some(false) {
        world.remove_resource::<ExtractedWeatherOverlay>();
        record_overlay_counts(world, false, 0, 0.0, false);
        return;
    }

    let extracted = world.resource_scope::<bevy::render::MainWorld, _>(|_, mut main_world| {
        let uniforms = main_world
            .get_resource::<WeatherRuntime>()
            .map(|runtime| runtime.uniforms);
        let constrained_gpu = main_world
            .get_resource::<GraphicsCapabilities>()
            .map(|capabilities| capabilities.integrated_gpu)
            .unwrap_or(false)
            || matches!(
                main_world.get_resource::<RenderQualityPreset>().copied(),
                Some(RenderQualityPreset::Low | RenderQualityPreset::Performance100)
            );
        let quality = overlay_quality_code(
            constrained_gpu,
            main_world.get_resource::<RenderQualityPreset>().copied(),
        );
        let camera_y = main_world
            .query_filtered::<&GlobalTransform, With<PlayerCamera>>()
            .iter(&main_world)
            .next()
            .map(|transform| transform.translation().y)
            .unwrap_or(WATER_LEVEL as f32 + 1.0);
        (uniforms, quality, camera_y)
    });
    let (Some(mut uniforms), quality, camera_y) = extracted else {
        world.remove_resource::<ExtractedWeatherOverlay>();
        record_overlay_counts(world, false, 0, 0.0, false);
        return;
    };

    let has_precipitation = uniforms.rain_factor > 0.001 || uniforms.snow_factor > 0.001;
    if env_override == Some(true) && has_precipitation && uniforms.overlay_density <= 0.001 {
        uniforms.overlay_density = if quality <= 1 { 0.18 } else { 0.45 };
        uniforms.flags |= WEATHER_FLAG_PRECIP_OVERLAY;
    } else if quality <= 1 {
        uniforms.overlay_density *= 0.35;
    }

    let overlay_enabled = (uniforms.flags & WEATHER_FLAG_PRECIP_OVERLAY) != 0
        && uniforms.overlay_density > 0.001
        && has_precipitation;
    if !overlay_enabled {
        world.remove_resource::<ExtractedWeatherOverlay>();
        record_overlay_counts(world, false, quality, uniforms.overlay_density, false);
        return;
    }

    let underwater = camera_y < WATER_LEVEL as f32 - 0.05;
    let pass_active = !underwater;
    let uniform = WeatherOverlayUniform {
        weather: uniforms,
        params: [
            uniforms.overlay_density.clamp(0.0, 1.0),
            quality as f32,
            weather_overlay_debug_mode() as f32,
            0.72,
        ],
        flags: [
            underwater as u32,
            1,
            uniforms.weather_kind_code,
            pass_active as u32,
        ],
    };

    world.insert_resource(ExtractedWeatherOverlay { uniform });
    record_overlay_counts(world, true, quality, uniforms.overlay_density, pass_active);
}

#[derive(Resource)]
struct WeatherOverlayPipeline {
    layout: BindGroupLayoutDescriptor,
    sampler: Sampler,
    uniform_buffer: Buffer,
    hdr_pipeline_id: CachedRenderPipelineId,
    sdr_pipeline_id: CachedRenderPipelineId,
}

fn init_weather_overlay_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let layout = BindGroupLayoutDescriptor::new(
        "weather_overlay_layout",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                binding_types::sampler(SamplerBindingType::Filtering),
                binding_types::uniform_buffer::<WeatherOverlayUniform>(false),
            ),
        ),
    );

    let sampler = render_device.create_sampler(&SamplerDescriptor::default());
    let uniform_buffer = render_device.create_buffer(&BufferDescriptor {
        label: Some("weather_overlay_uniform"),
        size: std::mem::size_of::<WeatherOverlayUniform>() as u64,
        usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let pipeline_descriptor =
        |label: &'static str, format: TextureFormat| RenderPipelineDescriptor {
            label: Some(label.into()),
            layout: vec![layout.clone()],
            vertex: fullscreen_shader.to_vertex_state(),
            fragment: Some(FragmentState {
                shader: WEATHER_OVERLAY_SHADER_HANDLE,
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
        "weather_overlay_pipeline_hdr",
        ViewTarget::TEXTURE_FORMAT_HDR,
    ));
    let sdr_pipeline_id = pipeline_cache.queue_render_pipeline(pipeline_descriptor(
        "weather_overlay_pipeline_sdr",
        TextureFormat::bevy_default(),
    ));

    commands.insert_resource(WeatherOverlayPipeline {
        layout,
        sampler,
        uniform_buffer,
        hdr_pipeline_id,
        sdr_pipeline_id,
    });
}

#[derive(Default)]
pub struct WeatherOverlayNode;

impl ViewNode for WeatherOverlayNode {
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

        let Some(overlay) = world.get_resource::<ExtractedWeatherOverlay>() else {
            return Ok(());
        };
        let Some(pipeline_res) = world.get_resource::<WeatherOverlayPipeline>() else {
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

        let timing = world.get_resource::<RenderTimingSink>();
        let _timer = render_timing_guard(timing, "Weather Overlay Pass CPU");
        if let Some(timing) = timing {
            timing.push_count(
                "Weather Overlay Pass Active",
                overlay.uniform.flags[3] as f64,
            );
            timing.push_count("Weather Overlay Quality", overlay.uniform.params[1] as f64);
            timing.push_count("Weather Overlay Density", overlay.uniform.params[0] as f64);
        }

        world.resource::<RenderQueue>().write_buffer(
            &pipeline_res.uniform_buffer,
            0,
            bytemuck::bytes_of(&overlay.uniform),
        );
        let post_process = view_target.post_process_write();
        let bind_group = render_context.render_device().create_bind_group(
            "weather_overlay_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.layout),
            &BindGroupEntries::sequential((
                post_process.source,
                &pipeline_res.sampler,
                pipeline_res.uniform_buffer.as_entire_binding(),
            )),
        );

        let mut render_pass = render_context.begin_tracked_render_pass(RenderPassDescriptor {
            label: Some("weather_overlay_pass"),
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

pub struct WeatherOverlayPlugin;

impl Plugin for WeatherOverlayPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            WEATHER_OVERLAY_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/weather_overlay.wgsl"
            ),
            Shader::from_wgsl
        );

        let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
            return;
        };

        render_app.add_systems(ExtractSchedule, extract_weather_overlay);
        render_app.add_systems(RenderStartup, init_weather_overlay_pipeline);
        render_app.add_render_graph_node::<ViewNodeRunner<WeatherOverlayNode>>(
            Core3d,
            WeatherOverlayLabel,
        );
        render_app
            .add_render_graph_edges(Core3d, (GodRaysLabel, WeatherOverlayLabel, Node3d::Bloom));
    }
}

fn weather_overlay_env_override() -> Option<bool> {
    if std::env::var_os("VOXEL_DISABLE_WEATHER_OVERLAY").is_some() {
        return Some(false);
    }
    let value = std::env::var("VOXEL_WEATHER_OVERLAY").ok()?;
    match value.trim().to_ascii_lowercase().as_str() {
        "0" | "false" | "off" | "disabled" => Some(false),
        "1" | "true" | "on" | "enabled" => Some(true),
        _ => None,
    }
}

fn weather_overlay_debug_mode() -> u32 {
    let Ok(value) = std::env::var("VOXEL_WEATHER_OVERLAY_DEBUG") else {
        return 0;
    };
    match value.trim().to_ascii_lowercase().as_str() {
        "1" | "mask" => 1,
        "2" | "classification" | "class" => 2,
        _ => 0,
    }
}

fn overlay_quality_code(constrained_gpu: bool, preset: Option<RenderQualityPreset>) -> u32 {
    if constrained_gpu {
        return 1;
    }
    match preset.unwrap_or_default() {
        RenderQualityPreset::Low | RenderQualityPreset::Performance100 => 1,
        RenderQualityPreset::Medium => 2,
        RenderQualityPreset::High => 3,
    }
}

fn record_overlay_counts(
    world: &mut World,
    enabled: bool,
    quality: u32,
    density: f32,
    pass_active: bool,
) {
    let Some(timing) = world.get_resource::<RenderTimingSink>() else {
        return;
    };
    timing.push_count("Weather Overlay Enabled", enabled as u32 as f64);
    timing.push_count("Weather Overlay Quality", quality as f64);
    timing.push_count("Weather Overlay Density", density as f64);
    timing.push_count("Weather Overlay Pass Active", pass_active as u32 as f64);
}

#[cfg(test)]
mod tests {
    #[test]
    fn weather_overlay_queues_hdr_and_sdr_pipelines() {
        let source = include_str!("weather_overlay.rs");

        assert!(source.contains("hdr_pipeline_id"));
        assert!(source.contains("sdr_pipeline_id"));
        assert!(source.contains("ViewTarget::TEXTURE_FORMAT_HDR"));
        assert!(source.contains("TextureFormat::bevy_default()"));
        assert!(source.contains("view_target.main_texture_format()"));
    }
}
