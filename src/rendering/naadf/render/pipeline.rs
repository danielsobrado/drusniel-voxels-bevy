use bevy::asset::uuid_handle;
use bevy::core_pipeline::FullscreenShader;
use bevy::core_pipeline::prepass::ViewPrepassTextures;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::MainWorld;
use bevy::render::render_asset::RenderAssets;
use bevy::render::render_graph::{NodeRunError, RenderGraphContext, ViewNode};
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderDevice};
use bevy::render::texture::GpuImage;
use bevy::render::view::{ExtractedView, RetainedViewEntity, ViewTarget};
use bevy::shader::Shader;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::atmosphere::{FogQuality, FogQualityTier, FogUniforms};
use crate::rendering::array_loader::BlockyTextureArray;
use crate::rendering::water_reflection::WaterReflectionMaskTexture;

use crate::rendering::naadf::config::NaadfDenoiseQuality;
use crate::rendering::naadf::gpu_buffers::{
    ExtractedNaadfEntityGpuUploads, ExtractedNaadfGpuUploads, NaadfEntityGpuBuffers,
    NaadfGpuBuffers,
};
use crate::rendering::naadf::local_lights::{ExtractedNaadfLocalLights, NaadfLocalLightGpuBuffers};
use crate::rendering::naadf::preview::{
    NaadfMainView, NaadfPathBCompositorMode, NaadfPreviewCompositeMode, NaadfPreviewPipelineState,
    NaadfPreviewSettings,
};
use crate::rendering::naadf::stats::NaadfRenderStatsBridge;

pub const NAADF_DEBUG_TRACE_RAYS_SHADER_PATH: &str = "shaders/naadf/debug_trace_rays.wgsl";
pub const NAADF_DEBUG_TRACE_WORKGROUP_SIZE: u32 = 64;
pub const NAADF_COMMON_SHADER_PATH: &str = "shaders/naadf/common.wgsl";
pub const NAADF_LAYOUT_SHADER_PATH: &str = "shaders/naadf/layout.wgsl";
pub const NAADF_RAY_TRACE_SHADER_PATH: &str = "shaders/naadf/ray_trace.wgsl";
pub const NAADF_WORLD_TRACE_SHADER_PATH: &str = "shaders/naadf/world_trace.wgsl";
pub const NAADF_LIGHTING_QUERIES_SHADER_PATH: &str = "shaders/naadf/lighting_queries.wgsl";
pub const NAADF_FROXEL_SUN_MASK_SHADER_PATH: &str = "shaders/naadf/froxel_sun_mask.wgsl";
pub const NAADF_BUILD_BLOCKS_SHADER_PATH: &str = "shaders/naadf/build_blocks.wgsl";
pub const NAADF_BUILD_MIPS_SHADER_PATH: &str = "shaders/naadf/build_mips.wgsl";
pub const NAADF_BUILD_BOUNDS_SHADER_PATH: &str = "shaders/naadf/build_bounds.wgsl";
pub const NAADF_BUILD_CHUNKS_SHADER_PATH: &str = "shaders/naadf/build_chunks.wgsl";
pub const NAADF_BUILD_CHUNK_BOUNDS_SHADER_PATH: &str = "shaders/naadf/build_chunk_bounds.wgsl";
pub const NAADF_FIRST_HIT_SHADER_PATH: &str = "shaders/naadf/first_hit.wgsl";
pub const NAADF_FIRST_HIT_PATH_B_TERRAIN_SHADER_PATH: &str =
    "shaders/naadf/first_hit_path_b_terrain.wgsl";
pub const NAADF_GI_TRACE_SHADER_PATH: &str = "shaders/naadf/gi_trace.wgsl";
pub const NAADF_SPATIAL_RESAMPLING_SHADER_PATH: &str = "shaders/naadf/spatial_resampling.wgsl";
pub const NAADF_TEMPORAL_ACCUMULATION_SHADER_PATH: &str =
    "shaders/naadf/temporal_accumulation.wgsl";
pub const NAADF_DENOISE_SHADER_PATH: &str = "shaders/naadf/denoise.wgsl";
pub const NAADF_PATH_TRACE_SHADER_PATH: &str = "shaders/naadf/path_trace.wgsl";
pub const NAADF_PREVIEW_FULLSCREEN_COMPOSITE_SHADER_PATH: &str =
    "shaders/naadf/preview_fullscreen_composite.wgsl";
pub const NAADF_PATH_B_OWNERSHIP_SHADER_PATH: &str = "shaders/naadf/path_b_ownership.wgsl";
pub const NAADF_BUILD_BLOCKS_WORKGROUP_SIZE: u32 = 64;
pub const NAADF_BUILD_BLOCKS_PER_CHUNK: u32 = crate::rendering::naadf::layout::BLOCKS_PER_CHUNK;
pub const NAADF_BUILD_CHUNKS_WORKGROUP_SIZE: u32 = 64;
pub const NAADF_PREVIEW_WORKGROUP_SIZE: u32 = 8;

pub const NAADF_COMMON_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("d2502064-2216-4b67-9a76-b502ee061cbb");
pub const NAADF_LAYOUT_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("8e414d36-7f73-4517-b06e-242602f4ac3a");
pub const NAADF_RAY_TRACE_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("ee6d7760-fbe0-4498-9e0c-bfe50e165022");
pub const NAADF_WORLD_TRACE_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("5c129290-de5e-4125-b0be-d128b5e187da");
pub const NAADF_LIGHTING_QUERIES_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("010676cf-a5de-4b6a-8ef4-a0eb30867f40");
pub const NAADF_FROXEL_SUN_MASK_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("6726bf56-1334-45d8-a6a9-ad0c3101d1ad");
pub const NAADF_BUILD_BLOCKS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("78b08331-0603-4efe-85a9-8e8f5b712f41");
pub const NAADF_BUILD_MIPS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("e1d2c726-790f-4f78-9ced-1305583ef45f");
pub const NAADF_BUILD_BOUNDS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("2e95a98a-69c1-44b9-a67f-ce44a2969039");
pub const NAADF_BUILD_CHUNKS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("fdf870dd-15f6-4cc8-9103-43950bd68a45");
pub const NAADF_BUILD_CHUNK_BOUNDS_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("50ac25a0-9afa-4b24-8689-ad3e57a36b52");
pub const NAADF_FIRST_HIT_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("cf37e4c0-d2db-48d9-888a-792d1de2c16d");
pub const NAADF_FIRST_HIT_PATH_B_TERRAIN_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("338cc2fe-4d9a-4d60-bf4e-2ec8a6b95b53");
pub const NAADF_GI_TRACE_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("2c0bb034-951f-4498-aa1b-bd17c248c182");
pub const NAADF_SPATIAL_RESAMPLING_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("072a12c3-b5bc-45f5-ade2-f6ee6491adcf");
pub const NAADF_TEMPORAL_ACCUMULATION_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("70acb298-365d-4ee7-af9e-d2c25d8e4873");
pub const NAADF_DENOISE_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("336e52e8-845a-4097-aa0c-0ab5a61e27b2");
pub const NAADF_PATH_TRACE_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("6b45e298-4b10-4482-8bf3-57a11a412f01");
pub const NAADF_PREVIEW_FULLSCREEN_COMPOSITE_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("1e1d1db7-2683-408c-9244-045e3e5c310e");
pub const NAADF_PATH_B_OWNERSHIP_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("bdfbb110-02e9-46c7-9cb2-b4df5bdb447d");

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
    pub bounce_count: u32,
    pub accumulation_enabled: bool,
    pub temporal_blend_factor: f32,
    pub denoise_enabled: bool,
    pub denoise_quality: NaadfDenoiseQuality,
    pub spatial_radius: u32,
    pub spatial_depth_sigma: f32,
    pub spatial_normal_sigma: f32,
    pub gi_sky_strength: f32,
    pub gi_bounce_strength: f32,
    pub local_lights_enabled: bool,
    pub local_light_limit: u32,
    pub local_light_shadows_enabled: bool,
    pub reference_path_tracing_enabled: bool,
    pub reference_sample_count: u32,
    pub reference_sky_strength: f32,
    pub reference_indirect_strength: f32,
    pub show_miss_sky: bool,
    pub composite_mode: NaadfPreviewCompositeMode,
    pub history_resolution_scale: f32,
    pub path_b_mode: NaadfPathBCompositorMode,
    pub path_b_depth_epsilon: f32,
    pub path_b_enable_temporal: bool,
    pub path_b_audit_overlay_alpha: f32,
    pub path_b_counters_enabled: bool,
    pub path_b_runtime_available: bool,
    pub fog_color_start: Vec4,
    pub fog_end_strength: Vec4,
    pub sun_direction: Vec4,
    pub frame_index: u32,
}

impl Default for ExtractedNaadfPreviewSettings {
    fn default() -> Self {
        let settings = NaadfPreviewSettings::default();
        Self::from(&settings)
    }
}

impl From<&NaadfPreviewSettings> for ExtractedNaadfPreviewSettings {
    fn from(settings: &NaadfPreviewSettings) -> Self {
        Self::from_settings_and_fog(*settings, FogUniforms::default(), true)
    }
}

impl ExtractedNaadfPreviewSettings {
    fn from_settings_and_fog(
        settings: NaadfPreviewSettings,
        fog: FogUniforms,
        fog_enabled: bool,
    ) -> Self {
        let aerial_strength = if fog_enabled {
            fog.aerial_strength
        } else {
            0.0
        };
        Self {
            max_ray_steps: settings.max_ray_steps,
            bounce_count: settings.bounce_count,
            accumulation_enabled: settings.accumulation_enabled,
            temporal_blend_factor: settings.temporal_blend_factor.clamp(0.0, 0.99),
            denoise_enabled: settings.denoise_enabled,
            denoise_quality: settings.denoise_quality,
            spatial_radius: settings.spatial_radius.min(4),
            spatial_depth_sigma: settings.spatial_depth_sigma.clamp(0.001, 1.0),
            spatial_normal_sigma: settings.spatial_normal_sigma.clamp(0.001, 1.0),
            gi_sky_strength: settings.gi_sky_strength.clamp(0.0, 2.0),
            gi_bounce_strength: settings.gi_bounce_strength.clamp(0.0, 2.0),
            local_lights_enabled: settings.local_lights_enabled,
            local_light_limit: settings.local_light_limit.clamp(1, 64),
            local_light_shadows_enabled: settings.local_light_shadows_enabled,
            reference_path_tracing_enabled: settings.reference_path_tracing_enabled,
            reference_sample_count: settings.reference_sample_count,
            reference_sky_strength: settings.reference_sky_strength.clamp(0.0, 2.0),
            reference_indirect_strength: settings.reference_indirect_strength.clamp(0.0, 2.0),
            show_miss_sky: settings.show_miss_sky,
            composite_mode: settings.composite_mode,
            history_resolution_scale: settings.history_resolution_scale.clamp(0.125, 1.0),
            path_b_mode: settings.path_b_mode,
            path_b_depth_epsilon: settings.path_b_depth_epsilon.max(0.0),
            path_b_enable_temporal: settings.path_b_enable_temporal,
            path_b_audit_overlay_alpha: settings.path_b_audit_overlay_alpha.clamp(0.0, 1.0),
            path_b_counters_enabled: settings.path_b_counters_enabled,
            path_b_runtime_available: settings.path_b_runtime_available,
            fog_color_start: Vec4::new(
                fog.fog_color.red,
                fog.fog_color.green,
                fog.fog_color.blue,
                fog.fog_start,
            ),
            fog_end_strength: Vec4::new(fog.fog_end, aerial_strength, 0.0, 0.0),
            sun_direction: fog.sun_dir.normalize_or_zero().extend(0.0),
            frame_index: 0,
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

    let fog = main_world
        .get_resource::<FogUniforms>()
        .copied()
        .unwrap_or_default();
    let fog_enabled = main_world
        .get_resource::<FogQuality>()
        .is_none_or(|quality| quality.tier != FogQualityTier::Off);
    let preview_settings = main_world
        .get_resource::<NaadfPreviewSettings>()
        .copied()
        .unwrap_or_default();
    let mut settings =
        ExtractedNaadfPreviewSettings::from_settings_and_fog(preview_settings, fog, fog_enabled);
    settings.frame_index = main_world
        .get_resource::<FrameCount>()
        .map(|frame| frame.0)
        .unwrap_or_default();
    commands.insert_resource(settings);
}

#[derive(Resource, Clone, Default)]
pub struct ExtractedNaadfTerrainAtlas {
    pub albedo: Option<Handle<Image>>,
}

pub fn extract_naadf_terrain_atlas(mut commands: Commands, main_world: Res<MainWorld>) {
    let albedo = main_world
        .get_resource::<BlockyTextureArray>()
        .map(|array| array.albedo.clone());
    commands.insert_resource(ExtractedNaadfTerrainAtlas { albedo });
}

#[derive(Resource, Clone, Default)]
pub struct ExtractedNaadfForegroundCoverageMask {
    pub water_mask: Option<Handle<Image>>,
}

pub fn extract_naadf_foreground_coverage_mask(mut commands: Commands, main_world: Res<MainWorld>) {
    let water_mask = main_world
        .get_resource::<WaterReflectionMaskTexture>()
        .map(|mask| mask.image.clone());
    commands.insert_resource(ExtractedNaadfForegroundCoverageMask { water_mask });
}

#[derive(Resource)]
pub struct NaadfPreviewBuildPipelines {
    empty_group_layout: BindGroupLayoutDescriptor,
    build_blocks_layout: BindGroupLayoutDescriptor,
    build_mips_layout: BindGroupLayoutDescriptor,
    build_bounds_layout: BindGroupLayoutDescriptor,
    build_chunks_layout: BindGroupLayoutDescriptor,
    build_chunk_bounds_layout: BindGroupLayoutDescriptor,
    first_hit_layout: BindGroupLayoutDescriptor,
    first_hit_path_b_terrain_layout: BindGroupLayoutDescriptor,
    gi_layout: BindGroupLayoutDescriptor,
    spatial_layout: BindGroupLayoutDescriptor,
    temporal_layout: BindGroupLayoutDescriptor,
    path_b_ownership_layout: BindGroupLayoutDescriptor,
    denoise_layout: BindGroupLayoutDescriptor,
    path_trace_layout: BindGroupLayoutDescriptor,
    composite_layout: BindGroupLayoutDescriptor,
    build_blocks_pipeline: CachedComputePipelineId,
    build_mips_pipeline: CachedComputePipelineId,
    build_bounds_pipeline: CachedComputePipelineId,
    build_chunks_pipeline: CachedComputePipelineId,
    build_chunk_bounds_pipeline: CachedComputePipelineId,
    first_hit_pipeline: CachedComputePipelineId,
    first_hit_path_b_terrain_pipeline: CachedComputePipelineId,
    gi_pipeline: CachedComputePipelineId,
    spatial_pipeline: CachedComputePipelineId,
    temporal_pipeline: CachedComputePipelineId,
    path_b_ownership_pipeline: CachedComputePipelineId,
    denoise_pipeline: CachedComputePipelineId,
    path_trace_pipeline: CachedComputePipelineId,
    composite_hdr_pipeline: CachedRenderPipelineId,
    composite_sdr_pipeline: CachedRenderPipelineId,
    _dummy_depth_texture: Texture,
    dummy_depth_view: TextureView,
    _dummy_coverage_texture: Texture,
    dummy_coverage_view: TextureView,
}

#[derive(Resource, Default)]
pub struct NaadfPreviewTemporalHistory {
    slots: Mutex<HashMap<RetainedViewEntity, NaadfPreviewTemporalHistorySlot>>,
}

#[derive(Resource, Default)]
pub struct NaadfPreviewScratchTextures {
    slots: Mutex<HashMap<RetainedViewEntity, NaadfPreviewScratchTextureSlot>>,
}

struct NaadfPreviewTemporalHistorySlot {
    size: Extent3d,
    history_generation: u64,
    world_from_view: Mat4,
    clip_from_view: Mat4,
    read_texture: Texture,
    write_texture: Texture,
    read_moments_texture: Texture,
    write_moments_texture: Texture,
    read_owner_texture: Texture,
    write_owner_texture: Texture,
}

struct NaadfPreviewScratchTextureSlot {
    size: Extent3d,
    first_hit_texture: Texture,
    first_hit_depth_texture: Texture,
    first_hit_normal_texture: Texture,
    first_hit_motion_texture: Texture,
    current_owner_texture: Texture,
    gi_texture: Texture,
    spatial_filtered_texture: Texture,
    denoise_ping_texture: Option<Texture>,
    denoise_pong_texture: Option<Texture>,
    path_trace_texture: Option<Texture>,
}

struct NaadfPreviewScratchViews {
    first_hit: TextureView,
    first_hit_depth: TextureView,
    first_hit_normal: TextureView,
    first_hit_motion: TextureView,
    current_owner: TextureView,
    gi: TextureView,
    spatial_filtered: TextureView,
    denoise_ping: Option<TextureView>,
    denoise_pong: Option<TextureView>,
    path_trace: Option<TextureView>,
}

#[derive(Resource, Default)]
pub struct NaadfPreviewPassStats {
    last_frame: Mutex<NaadfPreviewPassStatsSnapshot>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct NaadfPreviewPassStatsSnapshot {
    pixels: u64,
    first_hit_dispatches: u32,
    gi_dispatches: u32,
    spatial_dispatches: u32,
    temporal_dispatches: u32,
    composite_passes: u32,
    denoise_dispatches: u32,
    reference_dispatches: u32,
}

impl NaadfPreviewPassStats {
    fn record(&self, snapshot: NaadfPreviewPassStatsSnapshot) {
        *self.last_frame.lock().unwrap() = snapshot;
    }

    fn snapshot(&self) -> NaadfPreviewPassStatsSnapshot {
        *self.last_frame.lock().unwrap()
    }
}

impl NaadfPreviewScratchTextures {
    fn views_for_frame(
        &self,
        render_device: &bevy::render::renderer::RenderDevice,
        view: RetainedViewEntity,
        size: Extent3d,
        needs_denoise: bool,
        needs_path_trace: bool,
    ) -> NaadfPreviewScratchViews {
        let mut slots = self.slots.lock().unwrap();
        let slot = slots.entry(view).or_insert_with(|| {
            create_preview_scratch_texture_slot(
                render_device,
                size,
                needs_denoise,
                needs_path_trace,
            )
        });
        if slot.size != size {
            *slot = create_preview_scratch_texture_slot(
                render_device,
                size,
                needs_denoise,
                needs_path_trace,
            );
        }
        if needs_denoise {
            if slot.denoise_ping_texture.is_none() {
                slot.denoise_ping_texture = Some(create_preview_texture(
                    render_device,
                    "naadf_preview_denoise_ping_texture",
                    size,
                ));
            }
            if slot.denoise_pong_texture.is_none() {
                slot.denoise_pong_texture = Some(create_preview_texture(
                    render_device,
                    "naadf_preview_denoise_pong_texture",
                    size,
                ));
            }
        }
        if needs_path_trace && slot.path_trace_texture.is_none() {
            slot.path_trace_texture = Some(create_preview_texture(
                render_device,
                "naadf_preview_path_trace_texture",
                size,
            ));
        }

        NaadfPreviewScratchViews {
            first_hit: slot
                .first_hit_texture
                .create_view(&TextureViewDescriptor::default()),
            first_hit_depth: slot
                .first_hit_depth_texture
                .create_view(&TextureViewDescriptor::default()),
            first_hit_normal: slot
                .first_hit_normal_texture
                .create_view(&TextureViewDescriptor::default()),
            first_hit_motion: slot
                .first_hit_motion_texture
                .create_view(&TextureViewDescriptor::default()),
            current_owner: slot
                .current_owner_texture
                .create_view(&TextureViewDescriptor::default()),
            gi: slot
                .gi_texture
                .create_view(&TextureViewDescriptor::default()),
            spatial_filtered: slot
                .spatial_filtered_texture
                .create_view(&TextureViewDescriptor::default()),
            denoise_ping: slot
                .denoise_ping_texture
                .as_ref()
                .map(|texture| texture.create_view(&TextureViewDescriptor::default())),
            denoise_pong: slot
                .denoise_pong_texture
                .as_ref()
                .map(|texture| texture.create_view(&TextureViewDescriptor::default())),
            path_trace: slot
                .path_trace_texture
                .as_ref()
                .map(|texture| texture.create_view(&TextureViewDescriptor::default())),
        }
    }
}

pub fn sync_naadf_preview_pass_stats_to_main(
    pass_stats: Res<NaadfPreviewPassStats>,
    bridge: Res<NaadfRenderStatsBridge>,
) {
    let snapshot = pass_stats.snapshot();
    if snapshot.pixels == 0 && snapshot.first_hit_dispatches == 0 {
        return;
    }
    bridge.publish_preview_passes(
        snapshot.pixels,
        snapshot.first_hit_dispatches,
        snapshot.gi_dispatches,
        snapshot.spatial_dispatches,
        snapshot.temporal_dispatches,
        snapshot.composite_passes,
        snapshot.denoise_dispatches,
        snapshot.reference_dispatches,
    );
}

pub fn init_naadf_preview_build_pipelines(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let empty_group_layout = BindGroupLayoutDescriptor::new("naadf_empty_group_layout", &[]);
    let build_blocks_entries =
        bind_layout_entries(crate::rendering::naadf::layout::NAADF_BUILD_BLOCKS_LAYOUT);
    let build_blocks_layout =
        BindGroupLayoutDescriptor::new("naadf_build_blocks_layout", &build_blocks_entries);
    let build_bounds_entries =
        bind_layout_entries(crate::rendering::naadf::layout::NAADF_BUILD_BOUNDS_LAYOUT);
    let build_bounds_layout =
        BindGroupLayoutDescriptor::new("naadf_build_bounds_layout", &build_bounds_entries);
    let build_mips_entries =
        bind_layout_entries(crate::rendering::naadf::layout::NAADF_BUILD_MIPS_LAYOUT);
    let build_mips_layout =
        BindGroupLayoutDescriptor::new("naadf_build_mips_layout", &build_mips_entries);
    let build_chunks_entries =
        bind_layout_entries(crate::rendering::naadf::layout::NAADF_BUILD_CHUNKS_LAYOUT);
    let build_chunks_layout =
        BindGroupLayoutDescriptor::new("naadf_build_chunks_layout", &build_chunks_entries);
    let build_chunk_bounds_entries =
        bind_layout_entries(crate::rendering::naadf::layout::NAADF_BUILD_CHUNK_BOUNDS_LAYOUT);
    let build_chunk_bounds_layout = BindGroupLayoutDescriptor::new(
        "naadf_build_chunk_bounds_layout",
        &build_chunk_bounds_entries,
    );
    let first_hit_layout = BindGroupLayoutDescriptor::new(
        "naadf_first_hit_layout",
        &[
            storage_buffer_entry(0, true),
            storage_buffer_entry(1, true),
            storage_buffer_entry(5, true),
            storage_buffer_entry(6, true),
            storage_buffer_entry(7, true),
            storage_buffer_entry(8, true),
            storage_buffer_entry(11, true),
            uniform_buffer_entry(16),
            storage_texture_entry(17, TextureFormat::Rgba16Float),
            storage_texture_entry(18, TextureFormat::Rgba16Float),
            storage_texture_entry(19, TextureFormat::Rgba16Float),
            storage_buffer_entry(20, true),
            storage_buffer_entry(21, true),
            storage_buffer_entry(22, true),
            storage_texture_entry(23, TextureFormat::Rgba16Float),
            storage_buffer_entry(24, false),
            storage_buffer_entry(25, true),
            texture_array_entry_for_stage(39, ShaderStages::COMPUTE),
            sampler_entry_for_stage(40, ShaderStages::COMPUTE),
            depth_texture_entry_for_stage(41, ShaderStages::COMPUTE),
        ],
    );
    let first_hit_path_b_terrain_layout = BindGroupLayoutDescriptor::new(
        "naadf_first_hit_path_b_terrain_layout",
        &[
            storage_buffer_entry(0, true),
            storage_buffer_entry(1, true),
            storage_buffer_entry(5, true),
            storage_buffer_entry(6, true),
            storage_buffer_entry(7, true),
            storage_buffer_entry(8, true),
            storage_buffer_entry(11, true),
            uniform_buffer_entry(16),
            storage_texture_entry(17, TextureFormat::Rgba16Float),
            storage_texture_entry(18, TextureFormat::Rgba16Float),
            storage_texture_entry(19, TextureFormat::Rgba16Float),
            storage_buffer_entry(20, true),
            storage_texture_entry(23, TextureFormat::Rgba16Float),
            texture_array_entry_for_stage(39, ShaderStages::COMPUTE),
            sampler_entry_for_stage(40, ShaderStages::COMPUTE),
            depth_texture_entry_for_stage(41, ShaderStages::COMPUTE),
        ],
    );
    let gi_layout = BindGroupLayoutDescriptor::new(
        "naadf_gi_trace_layout",
        &[
            storage_buffer_entry(0, true),
            storage_buffer_entry(1, true),
            storage_buffer_entry(5, true),
            storage_buffer_entry(6, true),
            storage_buffer_entry(7, true),
            storage_buffer_entry(8, true),
            storage_buffer_entry(11, true),
            storage_buffer_entry(20, true),
            uniform_buffer_entry(28),
            texture_entry_for_stage(29, ShaderStages::COMPUTE),
            texture_entry_for_stage(30, ShaderStages::COMPUTE),
            texture_entry_for_stage(31, ShaderStages::COMPUTE),
            storage_texture_entry(32, TextureFormat::Rgba16Float),
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
            texture_entry_for_stage(16, ShaderStages::COMPUTE),
            storage_texture_entry(17, TextureFormat::Rg16Float),
            texture_entry_for_stage(18, ShaderStages::COMPUTE),
            uint_texture_entry_for_stage(19, ShaderStages::COMPUTE),
            uint_texture_entry_for_stage(20, ShaderStages::COMPUTE),
            storage_texture_entry(21, TextureFormat::R32Uint),
        ],
    );
    let path_b_ownership_layout = BindGroupLayoutDescriptor::new(
        "naadf_path_b_ownership_layout",
        &[
            uniform_buffer_entry(42),
            depth_texture_entry_for_stage(43, ShaderStages::COMPUTE),
            texture_entry_for_stage(44, ShaderStages::COMPUTE),
            texture_entry_for_stage(45, ShaderStages::COMPUTE),
            texture_entry_for_stage(46, ShaderStages::COMPUTE),
            storage_texture_entry(47, TextureFormat::R32Uint),
            uint_texture_entry_for_stage(48, ShaderStages::COMPUTE),
            texture_entry_for_stage(49, ShaderStages::COMPUTE),
            storage_buffer_entry_for_stage(50, false, ShaderStages::COMPUTE),
        ],
    );
    let denoise_layout = BindGroupLayoutDescriptor::new(
        "naadf_denoise_layout",
        &[
            uniform_buffer_entry(23),
            texture_entry_for_stage(24, ShaderStages::COMPUTE),
            texture_entry_for_stage(25, ShaderStages::COMPUTE),
            texture_entry_for_stage(26, ShaderStages::COMPUTE),
            storage_texture_entry(27, TextureFormat::Rgba16Float),
        ],
    );
    let path_trace_layout = BindGroupLayoutDescriptor::new(
        "naadf_path_trace_layout",
        &[
            uniform_buffer_entry(33),
            texture_entry_for_stage(34, ShaderStages::COMPUTE),
            texture_entry_for_stage(35, ShaderStages::COMPUTE),
            texture_entry_for_stage(36, ShaderStages::COMPUTE),
            texture_entry_for_stage(37, ShaderStages::COMPUTE),
            storage_texture_entry(38, TextureFormat::Rgba16Float),
        ],
    );
    let composite_layout = BindGroupLayoutDescriptor::new(
        "naadf_preview_fullscreen_composite_layout",
        &[
            texture_entry(0),
            texture_entry(1),
            uniform_buffer_entry(2),
            depth_texture_entry(3),
            texture_entry(4),
            texture_entry(5),
        ],
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
    let build_mips_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_build_mips_pipeline",
        NAADF_BUILD_MIPS_SHADER_HANDLE,
        "build_naadf_mips",
        &empty_group_layout,
        &build_mips_layout,
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
    let first_hit_path_b_terrain_pipeline =
        pipeline_cache.queue_compute_pipeline(compute_descriptor(
            "naadf_first_hit_path_b_terrain_pipeline",
            NAADF_FIRST_HIT_PATH_B_TERRAIN_SHADER_HANDLE,
            "naadf_first_hit_preview",
            &empty_group_layout,
            &first_hit_path_b_terrain_layout,
        ));
    let gi_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_gi_trace_pipeline",
        NAADF_GI_TRACE_SHADER_HANDLE,
        "naadf_gi_trace",
        &empty_group_layout,
        &gi_layout,
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
    let path_b_ownership_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_path_b_ownership_pipeline",
        NAADF_PATH_B_OWNERSHIP_SHADER_HANDLE,
        "naadf_path_b_ownership",
        &empty_group_layout,
        &path_b_ownership_layout,
    ));
    let denoise_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_denoise_pipeline",
        NAADF_DENOISE_SHADER_HANDLE,
        "naadf_denoise",
        &empty_group_layout,
        &denoise_layout,
    ));
    let path_trace_pipeline = pipeline_cache.queue_compute_pipeline(compute_descriptor(
        "naadf_path_trace_pipeline",
        NAADF_PATH_TRACE_SHADER_HANDLE,
        "naadf_path_trace_reference",
        &empty_group_layout,
        &path_trace_layout,
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
    let (dummy_depth_texture, dummy_depth_view) = create_dummy_depth_texture(&render_device);
    let dummy_coverage_texture = create_preview_texture(
        &render_device,
        "naadf_path_b_dummy_foreground_coverage_texture",
        Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
    );
    let dummy_coverage_view = dummy_coverage_texture.create_view(&TextureViewDescriptor::default());

    commands.insert_resource(NaadfPreviewBuildPipelines {
        empty_group_layout,
        build_blocks_layout,
        build_mips_layout,
        build_bounds_layout,
        build_chunks_layout,
        build_chunk_bounds_layout,
        first_hit_layout,
        first_hit_path_b_terrain_layout,
        gi_layout,
        spatial_layout,
        temporal_layout,
        path_b_ownership_layout,
        denoise_layout,
        path_trace_layout,
        composite_layout,
        build_blocks_pipeline,
        build_mips_pipeline,
        build_bounds_pipeline,
        build_chunks_pipeline,
        build_chunk_bounds_pipeline,
        first_hit_pipeline,
        first_hit_path_b_terrain_pipeline,
        gi_pipeline,
        spatial_pipeline,
        temporal_pipeline,
        path_b_ownership_pipeline,
        denoise_pipeline,
        path_trace_pipeline,
        composite_hdr_pipeline,
        composite_sdr_pipeline,
        _dummy_depth_texture: dummy_depth_texture,
        dummy_depth_view,
        _dummy_coverage_texture: dummy_coverage_texture,
        dummy_coverage_view,
    });
}

fn storage_buffer_entry(binding: u32, read_only: bool) -> BindGroupLayoutEntry {
    storage_buffer_entry_for_stage(binding, read_only, ShaderStages::COMPUTE)
}

fn bind_layout_entries(
    specs: &[crate::rendering::naadf::layout::NaadfBindEntrySpec],
) -> Vec<BindGroupLayoutEntry> {
    specs
        .iter()
        .map(|spec| match spec.kind {
            crate::rendering::naadf::layout::NaadfBindEntryKind::StorageRead => {
                storage_buffer_entry(spec.binding, true)
            }
            crate::rendering::naadf::layout::NaadfBindEntryKind::StorageReadWrite => {
                storage_buffer_entry(spec.binding, false)
            }
            crate::rendering::naadf::layout::NaadfBindEntryKind::Uniform => {
                uniform_buffer_entry(spec.binding)
            }
        })
        .collect()
}

fn storage_buffer_entry_for_stage(
    binding: u32,
    read_only: bool,
    visibility: ShaderStages,
) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility,
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

fn depth_texture_entry(binding: u32) -> BindGroupLayoutEntry {
    depth_texture_entry_for_stage(binding, ShaderStages::FRAGMENT)
}

fn depth_texture_entry_for_stage(binding: u32, visibility: ShaderStages) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility,
        ty: BindingType::Texture {
            sample_type: TextureSampleType::Depth,
            view_dimension: TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
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

fn uint_texture_entry_for_stage(binding: u32, visibility: ShaderStages) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility,
        ty: BindingType::Texture {
            sample_type: TextureSampleType::Uint,
            view_dimension: TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

fn texture_array_entry_for_stage(binding: u32, visibility: ShaderStages) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility,
        ty: BindingType::Texture {
            sample_type: TextureSampleType::Float { filterable: true },
            view_dimension: TextureViewDimension::D2Array,
            multisampled: false,
        },
        count: None,
    }
}

fn sampler_entry_for_stage(binding: u32, visibility: ShaderStages) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility,
        ty: BindingType::Sampler(SamplerBindingType::Filtering),
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
    type ViewQuery = (
        &'static ViewTarget,
        &'static ExtractedView,
        Option<&'static ViewPrepassTextures>,
        &'static NaadfMainView,
    );

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        (view_target, extracted_view, prepass_textures, _main_view): bevy::ecs::query::QueryItem<
            'w,
            '_,
            Self::ViewQuery,
        >,
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        publish_preview_node_stage(world, 1);
        let preview_state = world
            .get_resource::<ExtractedNaadfPreviewPipelineState>()
            .copied()
            .unwrap_or_default();
        if !preview_state.active {
            publish_preview_node_stage(world, 2);
            return Ok(());
        }

        let Some(pipelines) = world.get_resource::<NaadfPreviewBuildPipelines>() else {
            publish_preview_node_stage(world, 3);
            return Ok(());
        };
        let preview_settings = world
            .get_resource::<ExtractedNaadfPreviewSettings>()
            .copied()
            .unwrap_or_default();
        let denoise_iterations = denoise_iterations(preview_settings);
        let gi_enabled = preview_settings.bounce_count > 0;
        let Some(allocation) = world
            .get_resource::<NaadfGpuBuffers>()
            .and_then(NaadfGpuBuffers::allocation)
        else {
            publish_preview_node_stage(world, 4);
            return Ok(());
        };
        if allocation.plan.max_chunks == 0 {
            publish_preview_node_stage(world, 5);
            return Ok(());
        }
        let Some(entity_allocation) = world
            .get_resource::<NaadfEntityGpuBuffers>()
            .and_then(NaadfEntityGpuBuffers::allocation)
        else {
            publish_preview_node_stage(world, 6);
            return Ok(());
        };

        let pipeline_cache = world.resource::<PipelineCache>();
        let gpu_config = world
            .get_resource::<crate::rendering::naadf::gpu_buffers::ExtractedNaadfGpuConfig>()
            .cloned()
            .unwrap_or_default();
        let gpu_builder_enabled = gpu_config.prefer_gpu_builder;
        let gpu_builds = world
            .get_resource::<crate::rendering::naadf::prepare::ExtractedNaadfGpuBuilds>()
            .cloned()
            .unwrap_or_default();
        let needs_gpu_build = gpu_builder_enabled && gpu_builds.has_work();
        let telemetry_enabled = gpu_config.debug_readback;
        let path_b_counters_readback_enabled = preview_settings.path_b_mode.is_path_b()
            && preview_settings.path_b_runtime_available
            && preview_settings.path_b_counters_enabled;
        let stats_readback_enabled = telemetry_enabled || path_b_counters_readback_enabled;
        let use_path_b_terrain_first_hit =
            preview_settings.path_b_mode.is_path_b() && preview_settings.path_b_runtime_available;
        let build_blocks_pipeline = if needs_gpu_build {
            let Some(pipeline) =
                pipeline_cache.get_compute_pipeline(pipelines.build_blocks_pipeline)
            else {
                publish_preview_node_stage(world, 10);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let build_bounds_pipeline = if needs_gpu_build {
            let Some(pipeline) =
                pipeline_cache.get_compute_pipeline(pipelines.build_bounds_pipeline)
            else {
                publish_preview_node_stage(world, 11);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let build_mips_pipeline = if needs_gpu_build {
            let Some(pipeline) = pipeline_cache.get_compute_pipeline(pipelines.build_mips_pipeline)
            else {
                publish_preview_node_stage(world, 12);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let build_chunks_pipeline = if needs_gpu_build {
            let Some(pipeline) =
                pipeline_cache.get_compute_pipeline(pipelines.build_chunks_pipeline)
            else {
                publish_preview_node_stage(world, 13);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let build_chunk_bounds_pipeline = if needs_gpu_build {
            let Some(pipeline) =
                pipeline_cache.get_compute_pipeline(pipelines.build_chunk_bounds_pipeline)
            else {
                publish_preview_node_stage(world, 14);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let first_hit_pipeline_id = if use_path_b_terrain_first_hit {
            pipelines.first_hit_path_b_terrain_pipeline
        } else {
            pipelines.first_hit_pipeline
        };
        let Some(first_hit_pipeline) = pipeline_cache.get_compute_pipeline(first_hit_pipeline_id)
        else {
            let stage = match pipeline_cache.get_compute_pipeline_state(first_hit_pipeline_id) {
                CachedPipelineState::Queued => 141,
                CachedPipelineState::Creating(_) => 142,
                CachedPipelineState::Err(err) => {
                    warn!("NAADF first-hit pipeline failed: {err:?}");
                    143
                }
                CachedPipelineState::Ok(_) => 144,
            };
            publish_preview_node_stage(world, stage);
            return Ok(());
        };
        let gi_pipeline = if gi_enabled {
            let Some(pipeline) = pipeline_cache.get_compute_pipeline(pipelines.gi_pipeline) else {
                publish_preview_node_stage(world, 15);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let Some(spatial_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.spatial_pipeline)
        else {
            publish_preview_node_stage(world, 16);
            return Ok(());
        };
        let Some(temporal_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.temporal_pipeline)
        else {
            publish_preview_node_stage(world, 17);
            return Ok(());
        };
        let Some(path_b_ownership_pipeline) =
            pipeline_cache.get_compute_pipeline(pipelines.path_b_ownership_pipeline)
        else {
            publish_preview_node_stage(world, 171);
            return Ok(());
        };
        let denoise_pipeline = if denoise_iterations > 0 {
            let Some(pipeline) = pipeline_cache.get_compute_pipeline(pipelines.denoise_pipeline)
            else {
                publish_preview_node_stage(world, 18);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let path_trace_pipeline = if preview_settings.reference_path_tracing_enabled {
            let Some(pipeline) = pipeline_cache.get_compute_pipeline(pipelines.path_trace_pipeline)
            else {
                publish_preview_node_stage(world, 19);
                return Ok(());
            };
            Some(pipeline)
        } else {
            None
        };
        let composite_pipeline_id =
            if view_target.main_texture_format() == ViewTarget::TEXTURE_FORMAT_HDR {
                pipelines.composite_hdr_pipeline
            } else {
                pipelines.composite_sdr_pipeline
            };
        let Some(composite_pipeline) = pipeline_cache.get_render_pipeline(composite_pipeline_id)
        else {
            publish_preview_node_stage(world, 20);
            return Ok(());
        };

        let render_device = render_context.render_device().clone();
        let size = preview_extent(extracted_view, preview_settings.history_resolution_scale);
        if size.width == 0 || size.height == 0 {
            publish_preview_node_stage(world, 21);
            return Ok(());
        }
        let Some(scratch_textures) = world.get_resource::<NaadfPreviewScratchTextures>() else {
            publish_preview_node_stage(world, 22);
            return Ok(());
        };
        let scratch_views = scratch_textures.views_for_frame(
            &render_device,
            extracted_view.retained_view_entity,
            size,
            denoise_iterations > 0,
            preview_settings.reference_path_tracing_enabled,
        );
        let preview_view = scratch_views.first_hit;
        let preview_depth_view = scratch_views.first_hit_depth;
        let preview_normal_view = scratch_views.first_hit_normal;
        let preview_motion_view = scratch_views.first_hit_motion;
        let current_owner_view = scratch_views.current_owner;
        let gi_view = scratch_views.gi;
        let filtered_view = scratch_views.spatial_filtered;
        let denoise_ping = scratch_views.denoise_ping;
        let denoise_pong = scratch_views.denoise_pong;
        let path_trace_output = scratch_views.path_trace;
        let Some(temporal_history) = world.get_resource::<NaadfPreviewTemporalHistory>() else {
            publish_preview_node_stage(world, 23);
            return Ok(());
        };
        let (
            history_view,
            temporal_output_view,
            history_moments_view,
            temporal_output_moments_view,
            history_owner_view,
            temporal_output_owner_view,
            reset_temporal_history,
            previous_clip_from_world,
        ) = temporal_history.views_for_frame(
            &render_device,
            extracted_view.retained_view_entity,
            size,
            preview_state.history_generation,
            extracted_view.world_from_view.to_matrix(),
            extracted_view.clip_from_view,
        );
        let entity_count = world
            .get_resource::<ExtractedNaadfEntityGpuUploads>()
            .map(|uploads| uploads.entity_count)
            .unwrap_or_default();
        let Some(local_light_allocation) = world
            .get_resource::<NaadfLocalLightGpuBuffers>()
            .and_then(NaadfLocalLightGpuBuffers::allocation)
        else {
            publish_preview_node_stage(world, 24);
            return Ok(());
        };
        let local_lights = world
            .get_resource::<ExtractedNaadfLocalLights>()
            .cloned()
            .unwrap_or_default();
        let local_light_count = if preview_settings.local_lights_enabled {
            local_lights.uploaded
        } else {
            0
        };
        let chunk_lookup_records = world
            .get_resource::<ExtractedNaadfGpuUploads>()
            .map(|uploads| uploads.lookup_records.len() as u32)
            .unwrap_or_default();
        let build_chunk_bounds_uniform = create_uniform_buffer(
            &render_device,
            "naadf_chunk_bounds_params",
            &NaadfChunkBoundsParamsUniform {
                chunk_count: allocation.plan.chunk_records as u32,
                chunk_lookup_count: chunk_lookup_records,
                _pad0: UVec2::ZERO,
            },
        );
        let scene_depth_view = prepass_textures.and_then(ViewPrepassTextures::depth_view);
        let first_hit_uniform = create_uniform_buffer(
            &render_device,
            "naadf_first_hit_params",
            &first_hit_params_uniform(
                extracted_view,
                preview_settings,
                allocation.plan.chunk_records as u32,
                chunk_lookup_records,
                entity_count,
                local_light_count,
                telemetry_enabled,
                previous_clip_from_world,
                scene_depth_view.is_some(),
            ),
        );
        let spatial_uniform = create_uniform_buffer(
            &render_device,
            "naadf_spatial_resampling_params",
            &spatial_params_uniform(preview_settings),
        );
        let gi_uniform = create_uniform_buffer(
            &render_device,
            "naadf_gi_trace_params",
            &gi_params_uniform(
                extracted_view,
                preview_settings,
                allocation.plan.chunk_records as u32,
                chunk_lookup_records,
            ),
        );
        let temporal_uniform = create_uniform_buffer(
            &render_device,
            "naadf_temporal_accumulation_params",
            &temporal_params_uniform(
                extracted_view,
                preview_settings,
                reset_temporal_history,
                previous_clip_from_world,
            ),
        );
        let mut denoise_uniforms = Vec::with_capacity(denoise_iterations as usize);
        let mut denoise_groups = Vec::with_capacity(denoise_iterations as usize);
        for iteration in 0..denoise_iterations {
            denoise_uniforms.push(create_uniform_buffer(
                &render_device,
                "naadf_denoise_params",
                &denoise_params_for_iteration(preview_settings, iteration),
            ));
            let source_view = if iteration == 0 {
                &temporal_output_view
            } else if iteration % 2 == 1 {
                denoise_ping.as_ref().unwrap()
            } else {
                denoise_pong.as_ref().unwrap()
            };
            let output_view = if iteration % 2 == 0 {
                denoise_ping.as_ref().unwrap()
            } else {
                denoise_pong.as_ref().unwrap()
            };
            denoise_groups.push(render_device.create_bind_group(
                "naadf_denoise_bind_group",
                &pipeline_cache.get_bind_group_layout(&pipelines.denoise_layout),
                &BindGroupEntries::with_indices((
                    (23, denoise_uniforms.last().unwrap().as_entire_binding()),
                    (24, BindingResource::TextureView(source_view)),
                    (25, BindingResource::TextureView(&preview_depth_view)),
                    (26, BindingResource::TextureView(&preview_normal_view)),
                    (27, BindingResource::TextureView(output_view)),
                )),
            ));
        }
        let path_trace_uniform = create_uniform_buffer(
            &render_device,
            "naadf_path_trace_params",
            &path_trace_params_uniform(preview_settings),
        );
        let empty_group = render_device.create_bind_group(
            "naadf_empty_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.empty_group_layout),
            &[],
        );
        let fallback_build_slots = [0u32];
        let build_slots = if needs_gpu_build {
            gpu_builds.slots.as_slice()
        } else {
            &fallback_build_slots
        };
        let build_slot_buffer =
            create_storage_buffer_u32(&render_device, "naadf_build_slot_buffer", build_slots);

        let build_blocks_group = render_device.create_bind_group(
            "naadf_build_blocks_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_blocks_layout),
            &BindGroupEntries::with_indices((
                (0, allocation.voxel_buffer.as_entire_binding()),
                (1, allocation.material_buffer.as_entire_binding()),
                (4, allocation.raw_voxel_buffer.as_entire_binding()),
                (5, allocation.block_buffer.as_entire_binding()),
                (6, allocation.mip_traversal_buffer.as_entire_binding()),
                (7, allocation.mip_payload_buffer.as_entire_binding()),
                (30, build_slot_buffer.as_entire_binding()),
            )),
        );
        let build_bounds_group = render_device.create_bind_group(
            "naadf_build_bounds_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_bounds_layout),
            &BindGroupEntries::with_indices((
                (5, allocation.block_buffer.as_entire_binding()),
                (30, build_slot_buffer.as_entire_binding()),
            )),
        );
        let build_mips_group = render_device.create_bind_group(
            "naadf_build_mips_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_mips_layout),
            &BindGroupEntries::with_indices((
                (6, allocation.mip_traversal_buffer.as_entire_binding()),
                (7, allocation.mip_payload_buffer.as_entire_binding()),
                (8, allocation.mip_bounds_buffer.as_entire_binding()),
                (30, build_slot_buffer.as_entire_binding()),
            )),
        );
        let build_chunks_group = render_device.create_bind_group(
            "naadf_build_chunks_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_chunks_layout),
            &BindGroupEntries::with_indices((
                (5, allocation.block_buffer.as_entire_binding()),
                (11, allocation.chunk_buffer.as_entire_binding()),
                (30, build_slot_buffer.as_entire_binding()),
            )),
        );
        let build_chunk_bounds_group = render_device.create_bind_group(
            "naadf_build_chunk_bounds_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.build_chunk_bounds_layout),
            &BindGroupEntries::with_indices((
                (11, allocation.chunk_buffer.as_entire_binding()),
                (12, build_chunk_bounds_uniform.as_entire_binding()),
                (20, allocation.chunk_lookup_buffer.as_entire_binding()),
                (30, build_slot_buffer.as_entire_binding()),
            )),
        );
        let Some(terrain_atlas_handle) = world
            .get_resource::<ExtractedNaadfTerrainAtlas>()
            .and_then(|atlas| atlas.albedo.as_ref())
        else {
            publish_preview_node_stage(world, 25);
            return Ok(());
        };
        let gpu_images = world.resource::<RenderAssets<GpuImage>>();
        let Some(terrain_albedo) = gpu_images.get(terrain_atlas_handle) else {
            publish_preview_node_stage(world, 26);
            return Ok(());
        };
        let coverage_view = world
            .get_resource::<ExtractedNaadfForegroundCoverageMask>()
            .and_then(|mask| mask.water_mask.as_ref())
            .and_then(|handle| gpu_images.get(handle))
            .map(|image| &image.texture_view);
        let composite_uniform = create_uniform_buffer(
            &render_device,
            "naadf_preview_composite_params",
            &composite_params_uniform(
                extracted_view,
                preview_settings,
                scene_depth_view.is_some(),
                coverage_view.is_some(),
            ),
        );
        let first_hit_group = if use_path_b_terrain_first_hit {
            render_device.create_bind_group(
                "naadf_first_hit_path_b_terrain_bind_group",
                &pipeline_cache.get_bind_group_layout(&pipelines.first_hit_path_b_terrain_layout),
                &BindGroupEntries::with_indices((
                    (0, allocation.voxel_buffer.as_entire_binding()),
                    (1, allocation.material_buffer.as_entire_binding()),
                    (5, allocation.block_buffer.as_entire_binding()),
                    (6, allocation.mip_traversal_buffer.as_entire_binding()),
                    (7, allocation.mip_payload_buffer.as_entire_binding()),
                    (8, allocation.mip_bounds_buffer.as_entire_binding()),
                    (11, allocation.chunk_buffer.as_entire_binding()),
                    (16, first_hit_uniform.as_entire_binding()),
                    (17, BindingResource::TextureView(&preview_view)),
                    (18, BindingResource::TextureView(&preview_depth_view)),
                    (19, BindingResource::TextureView(&preview_normal_view)),
                    (20, allocation.chunk_lookup_buffer.as_entire_binding()),
                    (23, BindingResource::TextureView(&preview_motion_view)),
                    (
                        39,
                        BindingResource::TextureView(&terrain_albedo.texture_view),
                    ),
                    (40, BindingResource::Sampler(&terrain_albedo.sampler)),
                    (
                        41,
                        BindingResource::TextureView(
                            scene_depth_view.unwrap_or(&pipelines.dummy_depth_view),
                        ),
                    ),
                )),
            )
        } else {
            render_device.create_bind_group(
                "naadf_first_hit_bind_group",
                &pipeline_cache.get_bind_group_layout(&pipelines.first_hit_layout),
                &BindGroupEntries::with_indices((
                    (0, allocation.voxel_buffer.as_entire_binding()),
                    (1, allocation.material_buffer.as_entire_binding()),
                    (5, allocation.block_buffer.as_entire_binding()),
                    (6, allocation.mip_traversal_buffer.as_entire_binding()),
                    (7, allocation.mip_payload_buffer.as_entire_binding()),
                    (8, allocation.mip_bounds_buffer.as_entire_binding()),
                    (11, allocation.chunk_buffer.as_entire_binding()),
                    (16, first_hit_uniform.as_entire_binding()),
                    (17, BindingResource::TextureView(&preview_view)),
                    (18, BindingResource::TextureView(&preview_depth_view)),
                    (19, BindingResource::TextureView(&preview_normal_view)),
                    (20, allocation.chunk_lookup_buffer.as_entire_binding()),
                    (
                        21,
                        entity_allocation.entity_record_buffer.as_entire_binding(),
                    ),
                    (
                        22,
                        entity_allocation.entity_material_buffer.as_entire_binding(),
                    ),
                    (23, BindingResource::TextureView(&preview_motion_view)),
                    (24, allocation.stats_buffer.as_entire_binding()),
                    (25, local_light_allocation.buffer.as_entire_binding()),
                    (
                        39,
                        BindingResource::TextureView(&terrain_albedo.texture_view),
                    ),
                    (40, BindingResource::Sampler(&terrain_albedo.sampler)),
                    (
                        41,
                        BindingResource::TextureView(
                            scene_depth_view.unwrap_or(&pipelines.dummy_depth_view),
                        ),
                    ),
                )),
            )
        };
        let gi_group = if gi_enabled {
            Some(render_device.create_bind_group(
                "naadf_gi_trace_bind_group",
                &pipeline_cache.get_bind_group_layout(&pipelines.gi_layout),
                &BindGroupEntries::with_indices((
                    (0, allocation.voxel_buffer.as_entire_binding()),
                    (1, allocation.material_buffer.as_entire_binding()),
                    (5, allocation.block_buffer.as_entire_binding()),
                    (6, allocation.mip_traversal_buffer.as_entire_binding()),
                    (7, allocation.mip_payload_buffer.as_entire_binding()),
                    (8, allocation.mip_bounds_buffer.as_entire_binding()),
                    (11, allocation.chunk_buffer.as_entire_binding()),
                    (20, allocation.chunk_lookup_buffer.as_entire_binding()),
                    (28, gi_uniform.as_entire_binding()),
                    (29, BindingResource::TextureView(&preview_view)),
                    (30, BindingResource::TextureView(&preview_depth_view)),
                    (31, BindingResource::TextureView(&preview_normal_view)),
                    (32, BindingResource::TextureView(&gi_view)),
                )),
            ))
        } else {
            None
        };
        let spatial_source_view = if gi_enabled { &gi_view } else { &preview_view };
        let spatial_group = render_device.create_bind_group(
            "naadf_spatial_resampling_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.spatial_layout),
            &BindGroupEntries::with_indices((
                (10, spatial_uniform.as_entire_binding()),
                (12, BindingResource::TextureView(spatial_source_view)),
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
                (14, BindingResource::TextureView(&preview_depth_view)),
                (15, BindingResource::TextureView(&temporal_output_view)),
                (16, BindingResource::TextureView(&history_moments_view)),
                (
                    17,
                    BindingResource::TextureView(&temporal_output_moments_view),
                ),
                (18, BindingResource::TextureView(&preview_motion_view)),
                (19, BindingResource::TextureView(&current_owner_view)),
                (20, BindingResource::TextureView(&history_owner_view)),
                (
                    21,
                    BindingResource::TextureView(&temporal_output_owner_view),
                ),
            )),
        );
        let path_b_ownership_group = render_device.create_bind_group(
            "naadf_path_b_ownership_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.path_b_ownership_layout),
            &BindGroupEntries::with_indices((
                (42, composite_uniform.as_entire_binding()),
                (
                    43,
                    BindingResource::TextureView(
                        scene_depth_view.unwrap_or(&pipelines.dummy_depth_view),
                    ),
                ),
                (
                    44,
                    BindingResource::TextureView(
                        coverage_view.unwrap_or(&pipelines.dummy_coverage_view),
                    ),
                ),
                (45, BindingResource::TextureView(&preview_depth_view)),
                (46, BindingResource::TextureView(&preview_view)),
                (47, BindingResource::TextureView(&current_owner_view)),
                (48, BindingResource::TextureView(&history_owner_view)),
                (49, BindingResource::TextureView(&preview_motion_view)),
                (50, allocation.stats_buffer.as_entire_binding()),
            )),
        );
        let path_trace_source_view = if denoise_iterations == 0 {
            &temporal_output_view
        } else if denoise_iterations % 2 == 1 {
            denoise_ping.as_ref().unwrap()
        } else {
            denoise_pong.as_ref().unwrap()
        };
        let path_trace_group = if preview_settings.reference_path_tracing_enabled {
            let path_trace_view = path_trace_output.as_ref().unwrap();
            Some(render_device.create_bind_group(
                "naadf_path_trace_bind_group",
                &pipeline_cache.get_bind_group_layout(&pipelines.path_trace_layout),
                &BindGroupEntries::with_indices((
                    (33, path_trace_uniform.as_entire_binding()),
                    (34, BindingResource::TextureView(path_trace_source_view)),
                    (35, BindingResource::TextureView(&preview_view)),
                    (36, BindingResource::TextureView(&preview_depth_view)),
                    (37, BindingResource::TextureView(&preview_normal_view)),
                    (38, BindingResource::TextureView(path_trace_view)),
                )),
            ))
        } else {
            None
        };
        let composite_source_view = if path_trace_group.is_some() {
            path_trace_output.as_ref().unwrap()
        } else {
            path_trace_source_view
        };

        let post_process = view_target.post_process_write();
        let scene_depth_view = scene_depth_view.unwrap_or(&pipelines.dummy_depth_view);
        let coverage_view = coverage_view.unwrap_or(&pipelines.dummy_coverage_view);
        let composite_group = render_device.create_bind_group(
            "naadf_preview_fullscreen_composite_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipelines.composite_layout),
            &BindGroupEntries::with_indices((
                (0, BindingResource::TextureView(post_process.source)),
                (1, BindingResource::TextureView(composite_source_view)),
                (2, composite_uniform.as_entire_binding()),
                (3, BindingResource::TextureView(scene_depth_view)),
                (4, BindingResource::TextureView(coverage_view)),
                (5, BindingResource::TextureView(&preview_depth_view)),
            )),
        );

        if stats_readback_enabled {
            render_context
                .command_encoder()
                .clear_buffer(&allocation.stats_buffer, 0, None);
        }
        let mut pass =
            render_context
                .command_encoder()
                .begin_compute_pass(&ComputePassDescriptor {
                    label: Some("naadf_preview_build_pass"),
                    timestamp_writes: None,
                });
        publish_preview_node_stage(world, 90);
        pass.set_bind_group(0, &empty_group, &[]);
        pass.set_bind_group(1, &empty_group, &[]);
        pass.set_bind_group(2, &empty_group, &[]);
        if needs_gpu_build {
            if let (
                Some(build_blocks_pipeline),
                Some(build_bounds_pipeline),
                Some(build_mips_pipeline),
                Some(build_chunks_pipeline),
                Some(build_chunk_bounds_pipeline),
            ) = (
                build_blocks_pipeline,
                build_bounds_pipeline,
                build_mips_pipeline,
                build_chunks_pipeline,
                build_chunk_bounds_pipeline,
            ) {
                pass.set_pipeline(build_blocks_pipeline);
                pass.set_bind_group(3, &build_blocks_group, &[]);
                pass.dispatch_workgroups(
                    gpu_builds.slots.len() as u32 * NAADF_BUILD_BLOCKS_PER_CHUNK,
                    1,
                    1,
                );

                pass.set_pipeline(build_mips_pipeline);
                pass.set_bind_group(3, &build_mips_group, &[]);
                pass.dispatch_workgroups(gpu_builds.slots.len() as u32, 1, 1);

                pass.set_pipeline(build_bounds_pipeline);
                pass.set_bind_group(3, &build_bounds_group, &[]);
                pass.dispatch_workgroups(gpu_builds.slots.len() as u32, 1, 1);

                pass.set_pipeline(build_chunks_pipeline);
                pass.set_bind_group(3, &build_chunks_group, &[]);
                pass.dispatch_workgroups(gpu_builds.slots.len() as u32, 1, 1);
                pass.set_pipeline(build_chunk_bounds_pipeline);
                pass.set_bind_group(3, &build_chunk_bounds_group, &[]);
                pass.dispatch_workgroups(
                    div_ceil_u64(
                        gpu_builds.slots.len() as u64,
                        NAADF_BUILD_CHUNKS_WORKGROUP_SIZE as u64,
                    ) as u32,
                    1,
                    1,
                );
                if let Some(bridge) = world
                    .get_resource::<crate::rendering::naadf::prepare::NaadfGpuBuildDispatchBridge>(
                ) {
                    bridge.publish(gpu_builds.generation, &gpu_builds.chunk_positions);
                }
            }
        }
        pass.set_pipeline(first_hit_pipeline);
        pass.set_bind_group(3, &first_hit_group, &[]);
        pass.dispatch_workgroups(
            div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            1,
        );
        if let (Some(gi_pipeline), Some(gi_group)) = (gi_pipeline, gi_group.as_ref()) {
            pass.set_pipeline(gi_pipeline);
            pass.set_bind_group(3, gi_group, &[]);
            pass.dispatch_workgroups(
                div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
                div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
                1,
            );
        }
        pass.set_pipeline(spatial_pipeline);
        pass.set_bind_group(3, &spatial_group, &[]);
        pass.dispatch_workgroups(
            div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
            1,
        );
        pass.set_pipeline(path_b_ownership_pipeline);
        pass.set_bind_group(3, &path_b_ownership_group, &[]);
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
        if let Some(denoise_pipeline) = denoise_pipeline {
            pass.set_pipeline(denoise_pipeline);
            for denoise_group in &denoise_groups {
                pass.set_bind_group(3, denoise_group, &[]);
                pass.dispatch_workgroups(
                    div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
                    div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
                    1,
                );
            }
        }
        if let Some(path_trace_group) = &path_trace_group {
            let Some(path_trace_pipeline) = path_trace_pipeline else {
                return Ok(());
            };
            pass.set_pipeline(path_trace_pipeline);
            pass.set_bind_group(3, path_trace_group, &[]);
            pass.dispatch_workgroups(
                div_ceil_u64(size.width as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
                div_ceil_u64(size.height as u64, NAADF_PREVIEW_WORKGROUP_SIZE as u64) as u32,
                1,
            );
        }
        drop(pass);
        if stats_readback_enabled {
            render_context.command_encoder().copy_buffer_to_buffer(
                &allocation.stats_buffer,
                0,
                &allocation.stats_readback_buffer,
                0,
                crate::rendering::naadf::gpu_buffers::NAADF_STATS_BUFFER_BYTES,
            );
        }
        let gi_rays = if preview_settings.bounce_count > 0 {
            size.width as u64 * size.height as u64 * preview_settings.bounce_count.min(8) as u64
        } else {
            0
        };
        let preview_pixels = size.width as u64 * size.height as u64;
        let local_light_shadow_rays = if preview_settings.local_light_shadows_enabled
            && preview_settings.local_lights_enabled
        {
            preview_pixels * local_light_count as u64
        } else {
            0
        };
        let first_hit_dispatches = 1;
        let gi_dispatches = u32::from(preview_settings.bounce_count > 0);
        let spatial_dispatches = 1;
        let temporal_dispatches = 1;
        let composite_passes = 1;
        let reference_dispatches = u32::from(preview_settings.reference_path_tracing_enabled);
        if let Some(bridge) = world.get_resource::<NaadfRenderStatsBridge>() {
            bridge.publish_gi_rays(gi_rays);
            bridge.publish_local_light_shadow_rays(local_light_shadow_rays);
            bridge.publish_preview_passes(
                preview_pixels,
                first_hit_dispatches,
                gi_dispatches,
                spatial_dispatches,
                temporal_dispatches,
                composite_passes,
                denoise_iterations,
                reference_dispatches,
            );
            let path_b_composite_passes = u32::from(
                preview_settings.path_b_mode.is_path_b()
                    && preview_settings.path_b_runtime_available,
            );
            if !path_b_counters_readback_enabled {
                bridge.publish_path_b_passes(0, 0, 0, 0, 0, 0, 0, path_b_composite_passes);
            }
        }
        if let Some(pass_stats) = world.get_resource::<NaadfPreviewPassStats>() {
            pass_stats.record(NaadfPreviewPassStatsSnapshot {
                pixels: preview_pixels,
                first_hit_dispatches,
                gi_dispatches,
                spatial_dispatches,
                temporal_dispatches,
                composite_passes,
                denoise_dispatches: denoise_iterations,
                reference_dispatches,
            });
        }
        temporal_history.swap_after_dispatch(
            extracted_view.retained_view_entity,
            extracted_view.world_from_view.to_matrix(),
            extracted_view.clip_from_view,
        );

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
struct NaadfChunkBoundsParamsUniform {
    chunk_count: u32,
    chunk_lookup_count: u32,
    _pad0: UVec2,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfFirstHitParamsUniform {
    camera_origin_max_distance: Vec4,
    camera_forward_fov_y: Vec4,
    camera_right_aspect: Vec4,
    camera_up_pad: Vec4,
    config: UVec4,
    telemetry_config: UVec4,
    local_light_config: UVec4,
    fog_color_start: Vec4,
    fog_end_strength: Vec4,
    sun_direction_pad: Vec4,
    path_b_config: Vec4,
    view_from_clip: Mat4,
    previous_clip_from_world: Mat4,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfPreviewCompositeParamsUniform {
    mode_split: Vec4,
    pip_min_max: Vec4,
    path_b_config: Vec4,
    clip_from_view_x: Vec4,
    clip_from_view_y: Vec4,
    clip_from_view_z: Vec4,
    clip_from_view_w: Vec4,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfSpatialResamplingParamsUniform {
    enabled: u32,
    radius: u32,
    depth_sigma: f32,
    normal_sigma: f32,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfGiTraceParamsUniform {
    enabled: u32,
    sample_count: u32,
    sky_strength: f32,
    bounce_strength: f32,
    camera_origin_max_distance: Vec4,
    camera_forward_fov_y: Vec4,
    camera_right_aspect: Vec4,
    camera_up_pad: Vec4,
    sun_direction_pad: Vec4,
    config: UVec4,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfTemporalAccumulationParamsUniform {
    blend_factor: f32,
    reset_history: u32,
    _pad0: UVec2,
    camera_origin_max_distance: Vec4,
    camera_forward_fov_y: Vec4,
    camera_right_aspect: Vec4,
    camera_up_pad: Vec4,
    previous_clip_from_world: Mat4,
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfDenoiseParamsUniform {
    enabled: u32,
    radius: u32,
    depth_sigma: f32,
    normal_sigma: f32,
}

fn denoise_iterations(settings: ExtractedNaadfPreviewSettings) -> u32 {
    if !settings.denoise_enabled {
        return 0;
    }

    match settings.denoise_quality {
        NaadfDenoiseQuality::Low => 1,
        NaadfDenoiseQuality::Medium => 2,
        NaadfDenoiseQuality::High => 3,
    }
}

fn spatial_params_uniform(
    settings: ExtractedNaadfPreviewSettings,
) -> NaadfSpatialResamplingParamsUniform {
    NaadfSpatialResamplingParamsUniform {
        enabled: 1,
        radius: settings.spatial_radius.min(4),
        depth_sigma: settings.spatial_depth_sigma.clamp(0.001, 1.0),
        normal_sigma: settings.spatial_normal_sigma.clamp(0.001, 1.0),
    }
}

fn gi_params_uniform(
    view: &ExtractedView,
    settings: ExtractedNaadfPreviewSettings,
    chunk_records: u32,
    chunk_lookup_records: u32,
) -> NaadfGiTraceParamsUniform {
    let camera = camera_basis_params(view);
    gi_params_uniform_for_camera(camera, settings, chunk_records, chunk_lookup_records)
}

fn gi_params_uniform_for_camera(
    camera: CameraBasisParams,
    settings: ExtractedNaadfPreviewSettings,
    chunk_records: u32,
    chunk_lookup_records: u32,
) -> NaadfGiTraceParamsUniform {
    NaadfGiTraceParamsUniform {
        enabled: u32::from(settings.bounce_count > 0),
        sample_count: settings.bounce_count,
        sky_strength: settings.gi_sky_strength.clamp(0.0, 2.0),
        bounce_strength: settings.gi_bounce_strength.clamp(0.0, 2.0),
        camera_origin_max_distance: camera.origin_max_distance,
        camera_forward_fov_y: camera.forward_fov_y,
        camera_right_aspect: camera.right_aspect,
        camera_up_pad: camera.up_pad,
        sun_direction_pad: settings.sun_direction,
        config: UVec4::new(
            settings.max_ray_steps,
            chunk_records,
            chunk_lookup_records,
            settings.frame_index,
        ),
    }
}

fn path_trace_params_uniform(
    settings: ExtractedNaadfPreviewSettings,
) -> NaadfPathTraceParamsUniform {
    NaadfPathTraceParamsUniform {
        enabled: u32::from(settings.reference_path_tracing_enabled),
        sample_count: settings.reference_sample_count.clamp(1, 32),
        sky_strength: settings.reference_sky_strength.clamp(0.0, 2.0),
        indirect_strength: settings.reference_indirect_strength.clamp(0.0, 2.0),
    }
}

fn denoise_params_for_iteration(
    settings: ExtractedNaadfPreviewSettings,
    iteration: u32,
) -> NaadfDenoiseParamsUniform {
    let quality = if settings.denoise_enabled {
        settings.denoise_quality
    } else {
        NaadfDenoiseQuality::Low
    };
    let (radius, depth_sigma, normal_sigma) = match (quality, iteration) {
        (NaadfDenoiseQuality::Low, _) => (1, 0.035, 0.25),
        (NaadfDenoiseQuality::Medium, 0) => (1, 0.035, 0.25),
        (NaadfDenoiseQuality::Medium, _) => (2, 0.025, 0.18),
        (NaadfDenoiseQuality::High, 0) => (1, 0.04, 0.28),
        (NaadfDenoiseQuality::High, 1) => (2, 0.026, 0.18),
        (NaadfDenoiseQuality::High, _) => (3, 0.018, 0.12),
    };

    NaadfDenoiseParamsUniform {
        enabled: 1,
        radius,
        depth_sigma,
        normal_sigma,
    }
}

#[derive(Clone, Copy, ShaderType)]
struct NaadfPathTraceParamsUniform {
    enabled: u32,
    sample_count: u32,
    sky_strength: f32,
    indirect_strength: f32,
}

impl NaadfPreviewTemporalHistory {
    fn views_for_frame(
        &self,
        render_device: &bevy::render::renderer::RenderDevice,
        view: RetainedViewEntity,
        size: Extent3d,
        history_generation: u64,
        world_from_view: Mat4,
        clip_from_view: Mat4,
    ) -> (
        TextureView,
        TextureView,
        TextureView,
        TextureView,
        TextureView,
        TextureView,
        bool,
        Mat4,
    ) {
        let mut slots = self.slots.lock().unwrap();
        let current_clip_from_world = clip_from_world_matrix(world_from_view, clip_from_view);
        let reset_history = slots
            .get(&view)
            .is_none_or(|slot| slot.size != size || slot.history_generation != history_generation);
        let previous_clip_from_world = slots
            .get(&view)
            .filter(|_| !reset_history)
            .map(|slot| clip_from_world_matrix(slot.world_from_view, slot.clip_from_view))
            .unwrap_or(current_clip_from_world);
        if reset_history {
            slots.insert(
                view,
                create_preview_temporal_history_slot(
                    render_device,
                    size,
                    history_generation,
                    world_from_view,
                    clip_from_view,
                ),
            );
        }
        let slot = slots
            .get(&view)
            .expect("NAADF temporal history slot exists");

        (
            slot.read_texture
                .create_view(&TextureViewDescriptor::default()),
            slot.write_texture
                .create_view(&TextureViewDescriptor::default()),
            slot.read_moments_texture
                .create_view(&TextureViewDescriptor::default()),
            slot.write_moments_texture
                .create_view(&TextureViewDescriptor::default()),
            slot.read_owner_texture
                .create_view(&TextureViewDescriptor::default()),
            slot.write_owner_texture
                .create_view(&TextureViewDescriptor::default()),
            reset_history,
            previous_clip_from_world,
        )
    }

    fn swap_after_dispatch(
        &self,
        view: RetainedViewEntity,
        world_from_view: Mat4,
        clip_from_view: Mat4,
    ) {
        let mut slots = self.slots.lock().unwrap();
        let Some(slot) = slots.get_mut(&view) else {
            return;
        };
        std::mem::swap(&mut slot.read_texture, &mut slot.write_texture);
        std::mem::swap(
            &mut slot.read_moments_texture,
            &mut slot.write_moments_texture,
        );
        std::mem::swap(&mut slot.read_owner_texture, &mut slot.write_owner_texture);
        slot.world_from_view = world_from_view;
        slot.clip_from_view = clip_from_view;
    }
}

fn preview_extent(view: &ExtractedView, resolution_scale: f32) -> Extent3d {
    preview_extent_from_viewport(view.viewport.z, view.viewport.w, resolution_scale)
}

fn preview_extent_from_viewport(width: u32, height: u32, resolution_scale: f32) -> Extent3d {
    let scale = resolution_scale.clamp(0.125, 1.0);
    let scaled_width = if width == 0 {
        0
    } else {
        ((width as f32) * scale).round().max(1.0) as u32
    };
    let scaled_height = if height == 0 {
        0
    } else {
        ((height as f32) * scale).round().max(1.0) as u32
    };

    Extent3d {
        width: scaled_width,
        height: scaled_height,
        depth_or_array_layers: 1,
    }
}

fn create_preview_scratch_texture_slot(
    render_device: &bevy::render::renderer::RenderDevice,
    size: Extent3d,
    needs_denoise: bool,
    needs_path_trace: bool,
) -> NaadfPreviewScratchTextureSlot {
    NaadfPreviewScratchTextureSlot {
        size,
        first_hit_texture: create_preview_texture(
            render_device,
            "naadf_preview_first_hit_texture",
            size,
        ),
        first_hit_depth_texture: create_preview_texture(
            render_device,
            "naadf_preview_first_hit_depth_texture",
            size,
        ),
        first_hit_normal_texture: create_preview_texture(
            render_device,
            "naadf_preview_first_hit_normal_texture",
            size,
        ),
        first_hit_motion_texture: create_preview_texture(
            render_device,
            "naadf_preview_first_hit_motion_texture",
            size,
        ),
        current_owner_texture: create_owner_texture(
            render_device,
            "naadf_preview_current_owner_texture",
            size,
        ),
        gi_texture: create_preview_texture(render_device, "naadf_preview_gi_texture", size),
        spatial_filtered_texture: create_preview_texture(
            render_device,
            "naadf_preview_spatial_filtered_texture",
            size,
        ),
        denoise_ping_texture: needs_denoise.then(|| {
            create_preview_texture(render_device, "naadf_preview_denoise_ping_texture", size)
        }),
        denoise_pong_texture: needs_denoise.then(|| {
            create_preview_texture(render_device, "naadf_preview_denoise_pong_texture", size)
        }),
        path_trace_texture: needs_path_trace.then(|| {
            create_preview_texture(render_device, "naadf_preview_path_trace_texture", size)
        }),
    }
}

fn create_preview_temporal_history_slot(
    render_device: &bevy::render::renderer::RenderDevice,
    size: Extent3d,
    history_generation: u64,
    world_from_view: Mat4,
    clip_from_view: Mat4,
) -> NaadfPreviewTemporalHistorySlot {
    NaadfPreviewTemporalHistorySlot {
        size,
        history_generation,
        world_from_view,
        clip_from_view,
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
        read_moments_texture: create_moments_texture(
            render_device,
            "naadf_preview_temporal_moments_read_texture",
            size,
        ),
        write_moments_texture: create_moments_texture(
            render_device,
            "naadf_preview_temporal_moments_write_texture",
            size,
        ),
        read_owner_texture: create_owner_texture(
            render_device,
            "naadf_preview_temporal_owner_read_texture",
            size,
        ),
        write_owner_texture: create_owner_texture(
            render_device,
            "naadf_preview_temporal_owner_write_texture",
            size,
        ),
    }
}

fn create_preview_texture(
    render_device: &bevy::render::renderer::RenderDevice,
    label: &'static str,
    size: Extent3d,
) -> Texture {
    create_storage_texture(render_device, label, size, TextureFormat::Rgba16Float)
}

fn create_moments_texture(
    render_device: &bevy::render::renderer::RenderDevice,
    label: &'static str,
    size: Extent3d,
) -> Texture {
    create_storage_texture(render_device, label, size, TextureFormat::Rg16Float)
}

fn create_owner_texture(
    render_device: &bevy::render::renderer::RenderDevice,
    label: &'static str,
    size: Extent3d,
) -> Texture {
    create_storage_texture(render_device, label, size, TextureFormat::R32Uint)
}

fn create_storage_texture(
    render_device: &bevy::render::renderer::RenderDevice,
    label: &'static str,
    size: Extent3d,
    format: TextureFormat,
) -> Texture {
    render_device.create_texture(&TextureDescriptor {
        label: Some(label),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format,
        usage: TextureUsages::STORAGE_BINDING | TextureUsages::TEXTURE_BINDING,
        view_formats: &[],
    })
}

fn create_dummy_depth_texture(
    render_device: &bevy::render::renderer::RenderDevice,
) -> (Texture, TextureView) {
    let texture = render_device.create_texture(&TextureDescriptor {
        label: Some("naadf_path_b_dummy_scene_depth_texture"),
        size: Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: TextureDimension::D2,
        format: TextureFormat::Depth32Float,
        usage: TextureUsages::TEXTURE_BINDING | TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = texture.create_view(&TextureViewDescriptor::default());
    (texture, view)
}

#[cfg(test)]
fn view_matrix_changed(previous: Mat4, current: Mat4) -> bool {
    const CAMERA_HISTORY_EPSILON: f32 = 0.0005;
    previous
        .to_cols_array()
        .into_iter()
        .zip(current.to_cols_array())
        .any(|(previous, current)| (previous - current).abs() > CAMERA_HISTORY_EPSILON)
}

fn clip_from_world_matrix(world_from_view: Mat4, clip_from_view: Mat4) -> Mat4 {
    clip_from_view * world_from_view.inverse()
}

#[derive(Clone, Copy)]
struct CameraBasisParams {
    origin_max_distance: Vec4,
    forward_fov_y: Vec4,
    right_aspect: Vec4,
    up_pad: Vec4,
}

fn camera_basis_params(view: &ExtractedView) -> CameraBasisParams {
    let world_from_view = view.world_from_view.to_matrix();
    let origin = world_from_view.w_axis.truncate();
    let right = world_from_view.x_axis.truncate().normalize_or_zero();
    let up = world_from_view.y_axis.truncate().normalize_or_zero();
    let forward = (-world_from_view.z_axis.truncate()).normalize_or_zero();
    let y_scale = view.clip_from_view.y_axis.y.abs().max(0.0001);
    let x_scale = view.clip_from_view.x_axis.x.abs().max(0.0001);
    let fov_y = 2.0 * (1.0 / y_scale).atan();
    let aspect = y_scale / x_scale;

    CameraBasisParams {
        origin_max_distance: origin.extend(512.0),
        forward_fov_y: forward.extend(fov_y),
        right_aspect: right.extend(aspect),
        up_pad: up.extend(0.0),
    }
}

fn temporal_params_uniform(
    view: &ExtractedView,
    preview_settings: ExtractedNaadfPreviewSettings,
    reset_temporal_history: bool,
    previous_clip_from_world: Mat4,
) -> NaadfTemporalAccumulationParamsUniform {
    let camera = camera_basis_params(view);
    let temporal_enabled = if preview_settings.path_b_mode.is_path_b() {
        preview_settings.path_b_enable_temporal
    } else {
        preview_settings.accumulation_enabled
    };
    NaadfTemporalAccumulationParamsUniform {
        blend_factor: if temporal_enabled {
            preview_settings.temporal_blend_factor.clamp(0.0, 0.99)
        } else {
            0.0
        },
        reset_history: u32::from(reset_temporal_history || !temporal_enabled),
        _pad0: UVec2::ZERO,
        camera_origin_max_distance: camera.origin_max_distance,
        camera_forward_fov_y: camera.forward_fov_y,
        camera_right_aspect: camera.right_aspect,
        camera_up_pad: camera.up_pad,
        previous_clip_from_world,
    }
}

fn first_hit_params_uniform(
    view: &ExtractedView,
    preview_settings: ExtractedNaadfPreviewSettings,
    chunk_records: u32,
    chunk_lookup_records: u32,
    entity_records: u32,
    local_light_records: u32,
    telemetry_enabled: bool,
    previous_clip_from_world: Mat4,
    scene_depth_available: bool,
) -> NaadfFirstHitParamsUniform {
    let camera = camera_basis_params(view);
    let path_b_depth_clamp_enabled = preview_settings.path_b_runtime_available
        && preview_settings.path_b_mode.is_path_b()
        && scene_depth_available;

    NaadfFirstHitParamsUniform {
        camera_origin_max_distance: camera.origin_max_distance,
        camera_forward_fov_y: camera.forward_fov_y,
        camera_right_aspect: camera.right_aspect,
        camera_up_pad: camera.up_pad,
        config: UVec4::new(
            preview_settings.max_ray_steps,
            chunk_records,
            chunk_lookup_records,
            entity_records,
        ),
        telemetry_config: UVec4::new(u32::from(telemetry_enabled), 0, 0, 0),
        local_light_config: UVec4::new(
            if preview_settings.local_lights_enabled {
                local_light_records.min(preview_settings.local_light_limit)
            } else {
                0
            },
            u32::from(
                preview_settings.local_lights_enabled
                    && preview_settings.local_light_shadows_enabled
                    && local_light_records > 0,
            ),
            0,
            0,
        ),
        fog_color_start: preview_settings.fog_color_start,
        fog_end_strength: preview_settings.fog_end_strength,
        sun_direction_pad: preview_settings.sun_direction,
        path_b_config: Vec4::new(
            preview_settings.path_b_depth_epsilon,
            u32::from(path_b_depth_clamp_enabled) as f32,
            u32::from(scene_depth_available) as f32,
            0.0,
        ),
        view_from_clip: view.clip_from_view.inverse(),
        previous_clip_from_world,
    }
}

fn composite_params_uniform(
    view: &ExtractedView,
    settings: ExtractedNaadfPreviewSettings,
    scene_depth_available: bool,
    foreground_coverage_available: bool,
) -> NaadfPreviewCompositeParamsUniform {
    composite_params_uniform_with_clip_from_view(
        view.clip_from_view,
        settings,
        scene_depth_available,
        foreground_coverage_available,
    )
}

fn composite_params_uniform_with_clip_from_view(
    clip_from_view: Mat4,
    settings: ExtractedNaadfPreviewSettings,
    scene_depth_available: bool,
    foreground_coverage_available: bool,
) -> NaadfPreviewCompositeParamsUniform {
    let mode_value = match settings.path_b_mode {
        NaadfPathBCompositorMode::HybridFarTerrain if settings.path_b_runtime_available => 3.0,
        NaadfPathBCompositorMode::DepthAudit if settings.path_b_runtime_available => 4.0,
        NaadfPathBCompositorMode::DebugPreview
        | NaadfPathBCompositorMode::HybridFarTerrain
        | NaadfPathBCompositorMode::DepthAudit
        | NaadfPathBCompositorMode::Off => match settings.composite_mode {
            NaadfPreviewCompositeMode::Fullscreen => 0.0,
            NaadfPreviewCompositeMode::SplitView => 1.0,
            NaadfPreviewCompositeMode::PictureInPicture => 2.0,
        },
    };
    let view_from_clip = clip_from_view.inverse();
    NaadfPreviewCompositeParamsUniform {
        mode_split: Vec4::new(
            mode_value,
            0.5,
            if settings.show_miss_sky { 1.0 } else { 0.0 },
            u32::from(settings.path_b_counters_enabled) as f32,
        ),
        pip_min_max: Vec4::new(0.68, 0.06, 0.96, 0.34),
        path_b_config: Vec4::new(
            settings.path_b_depth_epsilon,
            settings.path_b_audit_overlay_alpha,
            u32::from(scene_depth_available) as f32,
            u32::from(foreground_coverage_available) as f32,
        ),
        clip_from_view_x: view_from_clip.x_axis,
        clip_from_view_y: view_from_clip.y_axis,
        clip_from_view_z: view_from_clip.z_axis,
        clip_from_view_w: view_from_clip.w_axis,
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

fn create_storage_buffer_u32(
    render_device: &bevy::render::renderer::RenderDevice,
    label: &'static str,
    values: &[u32],
) -> Buffer {
    render_device.create_buffer_with_data(&BufferInitDescriptor {
        label: Some(label),
        contents: bytemuck::cast_slice(values),
        usage: BufferUsages::STORAGE,
    })
}

const fn div_ceil_u64(value: u64, divisor: u64) -> u64 {
    if value == 0 {
        0
    } else {
        ((value - 1) / divisor) + 1
    }
}

fn publish_preview_node_stage(world: &World, stage: u32) {
    if let Some(bridge) = world.get_resource::<NaadfRenderStatsBridge>() {
        bridge.publish_preview_node_stage(stage);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_camera() -> CameraBasisParams {
        CameraBasisParams {
            origin_max_distance: Vec4::new(0.0, 0.0, 0.0, 512.0),
            forward_fov_y: Vec4::new(0.0, 0.0, -1.0, 1.0),
            right_aspect: Vec4::new(1.0, 0.0, 0.0, 1.0),
            up_pad: Vec4::new(0.0, 1.0, 0.0, 0.0),
        }
    }

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
        settings.temporal_blend_factor = 0.7;
        settings.denoise_enabled = false;
        settings.denoise_quality = NaadfDenoiseQuality::High;
        settings.spatial_radius = 3;
        settings.spatial_depth_sigma = 0.125;
        settings.spatial_normal_sigma = 0.5;
        settings.gi_sky_strength = 0.3;
        settings.gi_bounce_strength = 0.2;
        settings.reference_path_tracing_enabled = true;
        settings.reference_sample_count = 24;
        settings.reference_sky_strength = 0.4;
        settings.reference_indirect_strength = 0.6;
        settings.show_miss_sky = true;
        settings.bounce_count = 3;
        settings.composite_mode = NaadfPreviewCompositeMode::PictureInPicture;
        settings.history_resolution_scale = 0.5;

        let extracted = ExtractedNaadfPreviewSettings::from(&settings);

        assert!(extracted.accumulation_enabled);
        assert_eq!(extracted.temporal_blend_factor, 0.7);
        assert!(!extracted.denoise_enabled);
        assert_eq!(extracted.denoise_quality, NaadfDenoiseQuality::High);
        assert_eq!(extracted.spatial_radius, 3);
        assert_eq!(extracted.spatial_depth_sigma, 0.125);
        assert_eq!(extracted.spatial_normal_sigma, 0.5);
        assert_eq!(extracted.gi_sky_strength, 0.3);
        assert_eq!(extracted.gi_bounce_strength, 0.2);
        assert!(extracted.reference_path_tracing_enabled);
        assert_eq!(extracted.reference_sample_count, 24);
        assert_eq!(extracted.reference_sky_strength, 0.4);
        assert_eq!(extracted.reference_indirect_strength, 0.6);
        assert!(extracted.show_miss_sky);
        assert_eq!(extracted.bounce_count, 3);
        assert_eq!(
            extracted.composite_mode,
            NaadfPreviewCompositeMode::PictureInPicture
        );
        assert_eq!(extracted.history_resolution_scale, 0.5);
    }

    #[test]
    fn extracted_preview_settings_clamp_history_resolution_scale() {
        let mut settings = NaadfPreviewSettings::default();
        settings.history_resolution_scale = 0.1;
        assert_eq!(
            ExtractedNaadfPreviewSettings::from(&settings).history_resolution_scale,
            0.125
        );

        settings.history_resolution_scale = 2.0;
        assert_eq!(
            ExtractedNaadfPreviewSettings::from(&settings).history_resolution_scale,
            1.0
        );
    }

    #[test]
    fn preview_extent_applies_resolution_scale() {
        let extent = preview_extent_from_viewport(1920, 1080, 0.5);

        assert_eq!(extent.width, 960);
        assert_eq!(extent.height, 540);
        assert_eq!(extent.depth_or_array_layers, 1);
    }

    #[test]
    fn preview_extent_preserves_zero_viewport_and_minimum_nonzero_size() {
        let zero = preview_extent_from_viewport(0, 1080, 0.5);
        assert_eq!(zero.width, 0);
        assert_eq!(zero.height, 540);

        let tiny = preview_extent_from_viewport(1, 1, 0.25);
        assert_eq!(tiny.width, 1);
        assert_eq!(tiny.height, 1);
    }

    #[test]
    fn extracted_preview_settings_copy_fog_uniforms_for_first_hit() {
        let settings = NaadfPreviewSettings::default();
        let fog = FogUniforms {
            fog_color: LinearRgba::new(0.1, 0.2, 0.3, 1.0),
            fog_start: 12.0,
            fog_end: 48.0,
            sun_dir: Vec3::Y,
            directional_exponent: 16.0,
            aerial_strength: 0.75,
        };

        let extracted = ExtractedNaadfPreviewSettings::from_settings_and_fog(settings, fog, true);

        assert_eq!(extracted.fog_color_start, Vec4::new(0.1, 0.2, 0.3, 12.0));
        assert_eq!(extracted.fog_end_strength, Vec4::new(48.0, 0.75, 0.0, 0.0));
        assert_eq!(extracted.sun_direction, Vec4::new(0.0, 1.0, 0.0, 0.0));
    }

    #[test]
    fn extracted_preview_settings_disable_aerial_fog_when_fog_is_off() {
        let settings = NaadfPreviewSettings::default();
        let fog = FogUniforms {
            aerial_strength: 0.75,
            ..Default::default()
        };

        let extracted = ExtractedNaadfPreviewSettings::from_settings_and_fog(settings, fog, false);

        assert_eq!(extracted.fog_end_strength.y, 0.0);
    }

    #[test]
    fn build_dispatch_workgroups_round_up_block_records() {
        assert_eq!(div_ceil_u64(0, 64), 0);
        assert_eq!(div_ceil_u64(1, 64), 1);
        assert_eq!(div_ceil_u64(64, 64), 1);
        assert_eq!(div_ceil_u64(65, 64), 2);
    }

    #[test]
    fn view_matrix_changed_ignores_tiny_float_noise() {
        let previous = Mat4::from_translation(Vec3::new(1.0, 2.0, 3.0));
        let current = Mat4::from_translation(Vec3::new(1.0, 2.0001, 3.0));

        assert!(!view_matrix_changed(previous, current));
    }

    #[test]
    fn view_matrix_changed_detects_camera_motion() {
        let previous = Mat4::from_translation(Vec3::new(1.0, 2.0, 3.0));
        let current = Mat4::from_translation(Vec3::new(1.0, 2.01, 3.0));

        assert!(view_matrix_changed(previous, current));
    }

    #[test]
    fn clip_from_world_combines_projection_with_inverse_view() {
        let world_from_view = Mat4::from_translation(Vec3::new(1.0, 2.0, 3.0));
        let clip_from_view = Mat4::from_scale(Vec3::new(2.0, 3.0, 1.0));

        let clip_from_world = clip_from_world_matrix(world_from_view, clip_from_view);

        assert_eq!(clip_from_world, clip_from_view * world_from_view.inverse());
    }

    #[test]
    fn preview_pass_stats_keep_latest_snapshot() {
        let stats = NaadfPreviewPassStats::default();
        let snapshot = NaadfPreviewPassStatsSnapshot {
            pixels: 64,
            first_hit_dispatches: 1,
            gi_dispatches: 1,
            spatial_dispatches: 1,
            temporal_dispatches: 1,
            composite_passes: 1,
            denoise_dispatches: 0,
            reference_dispatches: 1,
        };

        stats.record(snapshot);

        assert_eq!(stats.snapshot(), snapshot);
    }

    #[test]
    fn composite_params_copy_miss_sky_toggle() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.show_miss_sky = true;

        let params =
            composite_params_uniform_with_clip_from_view(Mat4::IDENTITY, settings, true, false);

        assert_eq!(params.mode_split.z, 1.0);
    }

    #[test]
    fn composite_params_mark_real_path_b_inputs() {
        let settings = ExtractedNaadfPreviewSettings::default();

        let params =
            composite_params_uniform_with_clip_from_view(Mat4::IDENTITY, settings, true, false);

        assert_eq!(params.path_b_config.z, 1.0);
        assert_eq!(params.path_b_config.w, 0.0);
    }

    #[test]
    fn denoise_quality_controls_iteration_count_and_radius() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.denoise_enabled = false;
        settings.denoise_quality = NaadfDenoiseQuality::High;
        assert_eq!(denoise_iterations(settings), 0);

        settings.denoise_enabled = true;
        settings.denoise_quality = NaadfDenoiseQuality::Low;
        assert_eq!(denoise_iterations(settings), 1);
        assert_eq!(denoise_params_for_iteration(settings, 0).radius, 1);

        settings.denoise_quality = NaadfDenoiseQuality::Medium;
        assert_eq!(denoise_iterations(settings), 2);
        assert_eq!(denoise_params_for_iteration(settings, 1).radius, 2);

        settings.denoise_quality = NaadfDenoiseQuality::High;
        assert_eq!(denoise_iterations(settings), 3);
        assert_eq!(denoise_params_for_iteration(settings, 2).radius, 3);
    }

    #[test]
    fn spatial_params_copy_preview_filter_settings() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.spatial_radius = 2;
        settings.spatial_depth_sigma = 0.08;
        settings.spatial_normal_sigma = 0.4;

        let params = spatial_params_uniform(settings);

        assert_eq!(params.enabled, 1);
        assert_eq!(params.radius, 2);
        assert_eq!(params.depth_sigma, 0.08);
        assert_eq!(params.normal_sigma, 0.4);
    }

    #[test]
    fn spatial_params_clamp_preview_filter_settings() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.spatial_radius = 99;
        settings.spatial_depth_sigma = 0.0;
        settings.spatial_normal_sigma = 3.0;

        let params = spatial_params_uniform(settings);

        assert_eq!(params.radius, 4);
        assert_eq!(params.depth_sigma, 0.001);
        assert_eq!(params.normal_sigma, 1.0);
    }

    #[test]
    fn gi_params_copy_preview_strength_settings() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.bounce_count = 2;
        settings.gi_sky_strength = 0.3;
        settings.gi_bounce_strength = 0.12;

        let params = gi_params_uniform_for_camera(test_camera(), settings, 384, 128);

        assert_eq!(params.enabled, 1);
        assert_eq!(params.sample_count, 2);
        assert_eq!(params.sky_strength, 0.3);
        assert_eq!(params.bounce_strength, 0.12);
        assert!(
            params
                .sun_direction_pad
                .abs_diff_eq(Vec3::new(0.4, 0.8, 0.3).normalize().extend(0.0), 0.000001)
        );
    }

    #[test]
    fn gi_params_copy_frame_index_for_sample_jitter() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.bounce_count = 1;
        settings.frame_index = 42;

        let params = gi_params_uniform_for_camera(test_camera(), settings, 384, 128);

        assert_eq!(params.config.w, 42);
    }

    #[test]
    fn gi_params_disable_when_bounce_count_is_zero_and_clamp_strengths() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.bounce_count = 0;
        settings.gi_sky_strength = 3.0;
        settings.gi_bounce_strength = -1.0;

        let params = gi_params_uniform_for_camera(test_camera(), settings, 384, 128);

        assert_eq!(params.enabled, 0);
        assert_eq!(params.sky_strength, 2.0);
        assert_eq!(params.bounce_strength, 0.0);
    }

    #[test]
    fn path_trace_params_copy_reference_strength_settings() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.reference_path_tracing_enabled = true;
        settings.reference_sample_count = 24;
        settings.reference_sky_strength = 0.4;
        settings.reference_indirect_strength = 0.6;

        let params = path_trace_params_uniform(settings);

        assert_eq!(params.enabled, 1);
        assert_eq!(params.sample_count, 24);
        assert_eq!(params.sky_strength, 0.4);
        assert_eq!(params.indirect_strength, 0.6);
    }

    #[test]
    fn path_trace_params_clamp_reference_strength_settings() {
        let mut settings = ExtractedNaadfPreviewSettings::default();
        settings.reference_sample_count = 99;
        settings.reference_sky_strength = -1.0;
        settings.reference_indirect_strength = 3.0;

        let params = path_trace_params_uniform(settings);

        assert_eq!(params.enabled, 0);
        assert_eq!(params.sample_count, 32);
        assert_eq!(params.sky_strength, 0.0);
        assert_eq!(params.indirect_strength, 2.0);
    }
}
