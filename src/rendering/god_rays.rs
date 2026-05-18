//! Screen-space god rays post-process effect.
//!
//! Inserts a fullscreen render graph node after the main 3D pass that performs
//! radial blur toward the sun's screen-space position, producing volumetric
//! light shaft visuals independently of Bevy's built-in `VolumetricFog`.
//!
//! Configurable via `GodRayConfig` resource (loaded from `fog.yaml` or set at
//! runtime). Automatically disabled on integrated GPUs.

use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::core_pipeline::{
    FullscreenShader,
    core_3d::graph::{Core3d, Node3d},
    prepass::ViewPrepassTextures,
};
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::{
    ExtractSchedule, RenderApp, RenderStartup,
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
    view::{ViewTarget, ViewUniformOffset, ViewUniforms},
};
use bevy::shader::Shader;

use crate::atmosphere::FogConfig;
use crate::camera::controller::PlayerCamera;
use crate::environment::Sun;
use crate::performance::AreaTimingRecorder;
#[cfg(feature = "naadf")]
use crate::rendering::naadf::froxel::NaadfFroxelSunMaskState;
use crate::rendering::water_reflection_compositor::WaterReflectionCompositorLabel;
use crate::weather::WeatherRuntime;

const GOD_RAYS_SHADER_HANDLE: Handle<Shader> = uuid_handle!("a1b2c3d4-e5f6-7890-abcd-ef0123456789");
const MIN_GOD_RAY_SAMPLES: u32 = 1;
const MAX_GOD_RAY_SAMPLES: u32 = 128;

/// Configuration for the screen-space god rays effect.
#[derive(Resource, Clone)]
pub struct GodRayConfig {
    /// Master enable toggle
    pub enabled: bool,
    /// Overall intensity of the god ray contribution (0.0–1.0+)
    pub intensity: f32,
    /// Exponential decay along each ray (0.9–1.0)
    pub decay: f32,
    /// Density controls how far each ray marches across the screen (0.5–1.5)
    pub density: f32,
    /// Per-sample weight (0.0–0.1)
    pub weight: f32,
    /// Number of radial blur samples per pixel (16–128)
    pub num_samples: u32,
    /// Luminance threshold — geometry brighter than this contributes to shafts
    pub threshold: f32,
}

impl Default for GodRayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            intensity: 0.35,
            decay: 0.97,
            density: 0.8,
            weight: 0.04,
            num_samples: 32,
            threshold: 2.0,
        }
    }
}

fn clamp_god_ray_samples(num_samples: u32) -> u32 {
    num_samples.clamp(MIN_GOD_RAY_SAMPLES, MAX_GOD_RAY_SAMPLES)
}

/// Render graph label for the god rays node.
#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct GodRaysLabel;

// ─── GPU Uniform ─────────────────────────────────────────────────────────────

/// Must match `GodRayUniforms` in `god_rays.wgsl` exactly.
#[derive(Clone, Copy, ShaderType)]
pub(crate) struct GodRayUniforms {
    sun_screen_pos: Vec4,
    sun_dir_world: Vec4,
    intensity: f32,
    decay: f32,
    density: f32,
    weight: f32,
    num_samples: i32,
    threshold: f32,
    rain_factor: f32,
    snow_factor: f32,
    naadf_froxel_visibility: f32,
    naadf_froxel_strength: f32,
}

// ─── Main-world sun projection ───────────────────────────────────────────────

/// Computed each frame in the main world: the sun's screen-space UV and config.
/// Extracted to the render world for the god ray node.
#[derive(Resource, Clone)]
pub(crate) struct GodRayFrameData {
    pub(crate) uniforms: GodRayUniforms,
}

/// Sync GodRayConfig from the FogConfig YAML values when it changes.
fn sync_god_ray_config(fog_config: Option<Res<FogConfig>>, mut config: ResMut<GodRayConfig>) {
    let Some(fog_config) = fog_config else { return };
    if !fog_config.is_changed() {
        return;
    }
    let src = &fog_config.screen_god_rays;
    config.enabled = src.enabled;
    config.intensity = src.intensity;
    config.decay = src.decay;
    config.density = src.density;
    config.weight = src.weight;
    config.num_samples = clamp_god_ray_samples(src.num_samples);
    config.threshold = src.threshold;
}

/// Computes the sun's screen position each frame from the camera + sun transforms.
fn compute_god_ray_frame_data(
    mut commands: Commands,
    config: Res<GodRayConfig>,
    weather: Option<Res<WeatherRuntime>>,
    #[cfg(feature = "naadf")] naadf_froxel: Option<Res<NaadfFroxelSunMaskState>>,
    frame: Res<FrameCount>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    sun_query: Query<&Transform, With<Sun>>,
    camera_query: Query<(&GlobalTransform, &Projection), With<PlayerCamera>>,
) {
    if !config.enabled {
        commands.remove_resource::<GodRayFrameData>();
        return;
    }

    // Get sun direction (DirectionalLight forward = light direction, negate for "toward sun")
    let sun_dir = sun_query
        .iter()
        .next()
        .map(|t| t.forward().as_vec3())
        .unwrap_or(Vec3::new(-0.3, -1.0, -0.2).normalize());
    let sun_world_dir = -sun_dir;
    #[cfg(feature = "naadf")]
    let naadf_froxel_strength = naadf_froxel_god_ray_strength(naadf_froxel.as_deref());
    #[cfg(not(feature = "naadf"))]
    let naadf_froxel_strength = naadf_froxel_god_ray_strength();

    // Project sun to screen space using the main camera
    let mut sun_screen = Vec4::new(0.5, 0.5, 0.0, 0.0); // default: center, invisible

    if let Some((global_transform, projection)) = camera_query.iter().next() {
        let view_matrix = global_transform.to_matrix().inverse();
        let proj_matrix = projection.get_clip_from_view();
        let view_proj = proj_matrix * view_matrix;

        // Project a far-away point in the sun direction
        let sun_far = global_transform.translation() + sun_world_dir * 10000.0;
        let clip = view_proj * sun_far.extend(1.0);

        if clip.w > 0.0 {
            let ndc = clip.xyz() / clip.w;
            // NDC to UV: x: [-1,1] -> [0,1], y: [-1,1] -> [1,0] (Bevy UV flipped Y)
            let uv_x = ndc.x * 0.5 + 0.5;
            let uv_y = 1.0 - (ndc.y * 0.5 + 0.5);
            sun_screen = Vec4::new(uv_x, uv_y, 0.0, 1.0);
        }
    }

    commands.insert_resource(GodRayFrameData {
        uniforms: GodRayUniforms {
            sun_screen_pos: sun_screen,
            sun_dir_world: sun_world_dir.extend(0.0),
            intensity: config.intensity,
            decay: config.decay,
            density: config.density,
            weight: config.weight,
            num_samples: clamp_god_ray_samples(config.num_samples) as i32,
            threshold: config.threshold,
            rain_factor: weather
                .as_deref()
                .map(|weather| weather.uniforms.rain_factor.clamp(0.0, 1.0))
                .unwrap_or(0.0),
            snow_factor: weather
                .as_deref()
                .map(|weather| weather.uniforms.snow_factor.clamp(0.0, 1.0))
                .unwrap_or(0.0),
            naadf_froxel_visibility: 1.0 - naadf_froxel_strength * 0.15,
            naadf_froxel_strength,
        },
    });

    if let Some(timing) = timing.as_deref_mut() {
        let rain = weather
            .as_deref()
            .map(|weather| weather.uniforms.rain_factor.clamp(0.0, 1.0))
            .unwrap_or(0.0);
        let snow = weather
            .as_deref()
            .map(|weather| weather.uniforms.snow_factor.clamp(0.0, 1.0))
            .unwrap_or(0.0);
        let intensity_mult = weather_god_ray_intensity_mult(rain, snow);
        timing.record_count(
            frame.0,
            "Weather GodRay Intensity Mult",
            intensity_mult as f64,
        );
        timing.record_count(
            frame.0,
            "NAADF Froxel GodRay Strength",
            naadf_froxel_strength as f64,
        );
    }
}

fn weather_god_ray_intensity_mult(rain: f32, snow: f32) -> f32 {
    (1.0 - rain * 0.55 - snow * 0.1).clamp(0.35, 1.0)
}

#[cfg(feature = "naadf")]
fn naadf_froxel_god_ray_strength(state: Option<&NaadfFroxelSunMaskState>) -> f32 {
    state
        .filter(|state| state.active)
        .map(|_| 1.0)
        .unwrap_or(0.0)
}

#[cfg(not(feature = "naadf"))]
fn naadf_froxel_god_ray_strength() -> f32 {
    0.0
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/// Extracted to the render world each frame.
#[derive(Resource, Clone)]
struct ExtractedGodRayData {
    uniforms: GodRayUniforms,
}

fn extract_god_ray_data(world: &mut World) {
    let data = world.resource_scope::<bevy::render::MainWorld, _>(|_, main_world| {
        main_world
            .get_resource::<GodRayFrameData>()
            .map(|d| ExtractedGodRayData {
                uniforms: d.uniforms,
            })
    });

    match data {
        Some(d) => {
            world.insert_resource(d);
        }
        None => {
            world.remove_resource::<ExtractedGodRayData>();
        }
    }
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

#[derive(Resource)]
struct GodRayPipeline {
    layout: BindGroupLayoutDescriptor,
    sampler: Sampler,
    hdr_pipeline_id: CachedRenderPipelineId,
    sdr_pipeline_id: CachedRenderPipelineId,
}

fn init_god_ray_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let layout = BindGroupLayoutDescriptor::new(
        "god_rays_layout",
        &BindGroupLayoutEntries::sequential(
            ShaderStages::FRAGMENT,
            (
                // 0: scene colour texture
                binding_types::texture_2d(TextureSampleType::Float { filterable: true }),
                // 1: sampler
                binding_types::sampler(SamplerBindingType::Filtering),
                // 2: depth prepass
                binding_types::texture_depth_2d(),
                // 3: GodRayUniforms
                binding_types::uniform_buffer::<GodRayUniforms>(false),
                // 4: Bevy View uniform
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
                shader: GOD_RAYS_SHADER_HANDLE,
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
        "god_rays_pipeline_hdr",
        ViewTarget::TEXTURE_FORMAT_HDR,
    ));
    let sdr_pipeline_id = pipeline_cache.queue_render_pipeline(pipeline_descriptor(
        "god_rays_pipeline_sdr",
        TextureFormat::bevy_default(),
    ));

    commands.insert_resource(GodRayPipeline {
        layout,
        sampler,
        hdr_pipeline_id,
        sdr_pipeline_id,
    });
}

// ─── Render Graph Node ───────────────────────────────────────────────────────

#[derive(Default)]
pub struct GodRayNode;

impl ViewNode for GodRayNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static ViewPrepassTextures,
        &'static ViewUniformOffset,
    );

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        (view_target, prepass_textures, view_offset): bevy::ecs::query::QueryItem<
            'w,
            '_,
            Self::ViewQuery,
        >,
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        // ── Guard: god ray data must be extracted ───────────────────────────
        let Some(god_ray_data) = world.get_resource::<ExtractedGodRayData>() else {
            return Ok(());
        };

        // ── Depth prepass ──────────────────────────────────────────────────
        let Some(depth_view) = prepass_textures.depth_view() else {
            return Ok(());
        };

        // ── View uniform ───────────────────────────────────────────────────
        let view_uniforms = world.resource::<ViewUniforms>();
        let Some(view_binding) = view_uniforms.uniforms.binding() else {
            return Ok(());
        };

        // ── Pipeline ───────────────────────────────────────────────────────
        let Some(pipeline_res) = world.get_resource::<GodRayPipeline>() else {
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

        // ── Upload uniforms to GPU ─────────────────────────────────────────
        let mut ubo = bevy::render::render_resource::encase::UniformBuffer::new(Vec::<u8>::new());
        ubo.write(&god_ray_data.uniforms).unwrap();

        let uniform_buffer =
            render_context
                .render_device()
                .create_buffer_with_data(&BufferInitDescriptor {
                    label: Some("god_ray_uniforms"),
                    contents: ubo.as_ref(),
                    usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
                });

        // ── Post-process write (ping-pong) ─────────────────────────────────
        let post_process = view_target.post_process_write();

        // ── Bind group ─────────────────────────────────────────────────────
        let bind_group = render_context.render_device().create_bind_group(
            "god_rays_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.layout),
            &BindGroupEntries::sequential((
                post_process.source,                // 0: scene colour
                &pipeline_res.sampler,              // 1: sampler
                depth_view,                         // 2: depth
                uniform_buffer.as_entire_binding(), // 3: GodRayUniforms
                view_binding.clone(),               // 4: View uniform
            )),
        );

        // ── Render pass ────────────────────────────────────────────────────
        let mut render_pass = render_context.begin_tracked_render_pass(RenderPassDescriptor {
            label: Some("god_rays_pass"),
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

pub struct GodRayPlugin;

impl Plugin for GodRayPlugin {
    fn build(&self, app: &mut App) {
        load_internal_asset!(
            app,
            GOD_RAYS_SHADER_HANDLE,
            concat!(env!("CARGO_MANIFEST_DIR"), "/assets/shaders/god_rays.wgsl"),
            Shader::from_wgsl
        );

        // Ensure the config resource exists
        if !app.world().contains_resource::<GodRayConfig>() {
            app.init_resource::<GodRayConfig>();
        }

        // Main-world systems
        app.add_systems(
            Update,
            (sync_god_ray_config, compute_god_ray_frame_data).chain(),
        );

        let Some(render_app) = app.get_sub_app_mut(RenderApp) else {
            return;
        };

        render_app.add_systems(ExtractSchedule, extract_god_ray_data);
        render_app.add_systems(RenderStartup, init_god_ray_pipeline);

        render_app.add_render_graph_node::<ViewNodeRunner<GodRayNode>>(Core3d, GodRaysLabel);

        // WeatherOverlay inserts itself after GodRays, so depth-dependent lighting samples the
        // scene before screen-space precipitation is composited.
        render_app.add_render_graph_edges(
            Core3d,
            (WaterReflectionCompositorLabel, GodRaysLabel, Node3d::Bloom),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn god_ray_sample_count_is_clamped_for_uniforms() {
        assert_eq!(clamp_god_ray_samples(0), MIN_GOD_RAY_SAMPLES);
        assert_eq!(clamp_god_ray_samples(32), 32);
        assert_eq!(clamp_god_ray_samples(512), MAX_GOD_RAY_SAMPLES);
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn inactive_froxel_mask_does_not_modulate_god_rays() {
        assert_eq!(naadf_froxel_god_ray_strength(None), 0.0);
        assert_eq!(
            naadf_froxel_god_ray_strength(Some(&NaadfFroxelSunMaskState::default())),
            0.0
        );
    }
}
