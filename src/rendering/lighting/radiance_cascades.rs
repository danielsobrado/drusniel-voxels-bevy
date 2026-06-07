//! Radiance Cascades Global Illumination
//!
//! Screen-space radiance cascades leveraging voxel SDF for efficient GI.
//! Based on Alexander Sannikov's Radiance Cascades technique.

use bevy::asset::RenderAssetUsages;
#[cfg(feature = "naadf")]
use bevy::asset::{load_internal_asset, uuid_handle};
use bevy::core_pipeline::prepass::{DepthPrepass, NormalPrepass};
#[cfg(feature = "naadf")]
use bevy::core_pipeline::{
    FullscreenShader,
    core_3d::graph::{Core3d, Node3d},
    prepass::ViewPrepassTextures,
};
use bevy::prelude::*;
#[cfg(feature = "naadf")]
use bevy::render::render_graph::{
    NodeRunError, RenderGraphContext, RenderGraphExt, RenderLabel, ViewNode, ViewNodeRunner,
};
use bevy::render::render_resource::*;
#[cfg(feature = "naadf")]
use bevy::render::renderer::{RenderContext, RenderDevice};
#[cfg(feature = "naadf")]
use bevy::render::view::{ExtractedView, ViewTarget};
#[cfg(feature = "naadf")]
use bevy::render::{ExtractSchedule, MainWorld, Render, RenderApp, RenderStartup, RenderSystems};
#[cfg(feature = "naadf")]
use bevy::shader::Shader;
#[cfg(feature = "naadf")]
use std::borrow::Cow;
use std::collections::{HashSet, VecDeque};

#[cfg(feature = "naadf")]
use crate::atmosphere::FogUniforms;
#[cfg(feature = "naadf")]
use crate::rendering::god_rays::GodRaysLabel;
#[cfg(feature = "naadf")]
use crate::rendering::naadf::{
    NaadfCacheState, NaadfConfig, NaadfDirtyChunkQueue, NaadfGpuChunkTable, NaadfStats,
};
use crate::rendering::ray_tracing::{
    ExperimentalRenderMode, RayTracingSettings, VoxelRayBackendMode,
};
#[cfg(feature = "naadf")]
use crate::rendering::weather_overlay::WeatherOverlayLabel;
use crate::voxel::world::VoxelWorld;

#[cfg(feature = "naadf")]
const RADIANCE_CASCADES_SHADER_HANDLE: Handle<Shader> =
    uuid_handle!("b965089a-9b56-4425-9d8f-d265b7dfcbde");

pub(crate) const NAADF_QUERY_GI_SECONDARY: u32 = 1 << 0;
#[cfg_attr(not(feature = "naadf"), allow(dead_code))]
pub(crate) const NAADF_QUERY_SUN_VISIBILITY: u32 = 1 << 1;
#[cfg_attr(not(feature = "naadf"), allow(dead_code))]
pub(crate) const NAADF_QUERY_TERRAIN_AO: u32 = 1 << 2;
#[cfg_attr(not(feature = "naadf"), allow(dead_code))]
pub(crate) const NAADF_QUERY_CONTACT_SHADOW: u32 = 1 << 3;
const NAADF_QUERY_ALL: u32 = NAADF_QUERY_GI_SECONDARY
    | NAADF_QUERY_SUN_VISIBILITY
    | NAADF_QUERY_TERRAIN_AO
    | NAADF_QUERY_CONTACT_SHADOW;

/// Plugin for Radiance Cascades global illumination
pub struct RadianceCascadesPlugin;

impl Plugin for RadianceCascadesPlugin {
    fn build(&self, app: &mut App) {
        #[cfg(feature = "naadf")]
        load_internal_asset!(
            app,
            RADIANCE_CASCADES_SHADER_HANDLE,
            concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/assets/shaders/radiance_cascades.wgsl"
            ),
            Shader::from_wgsl
        );

        app.init_resource::<RadianceCascadesConfig>()
            .init_resource::<SdfVolumeState>()
            .add_systems(Startup, setup_radiance_cascades)
            .add_systems(
                Update,
                (
                    sync_radiance_cascades_voxel_backend,
                    #[cfg(feature = "naadf")]
                    invalidate_naadf_lighting_history_for_dirty_chunks,
                    configure_radiance_cascade_camera_prepass,
                    update_sdf_volume,
                    update_cascade_params,
                )
                    .chain(),
            );
        #[cfg(feature = "naadf")]
        app.add_systems(Update, record_naadf_gi_counters);

        #[cfg(feature = "naadf")]
        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app
                .init_resource::<ExtractedRadianceCascadesState>()
                .init_resource::<ExtractedRadianceNaadfCacheState>()
                .add_systems(RenderStartup, init_radiance_cascade_pipeline)
                .add_systems(
                    ExtractSchedule,
                    (
                        extract_radiance_cascades_state,
                        extract_radiance_naadf_cache_state,
                    )
                        .chain(),
                )
                .add_systems(
                    Render,
                    prepare_radiance_cascade_naadf_bind_group
                        .in_set(RenderSystems::PrepareBindGroups),
                );
            render_app.add_render_graph_node::<ViewNodeRunner<RadianceCascadesNode>>(
                Core3d,
                RadianceCascadesLabel,
            );
            render_app.add_render_graph_edges(
                Core3d,
                (
                    GodRaysLabel,
                    RadianceCascadesLabel,
                    WeatherOverlayLabel,
                    Node3d::Bloom,
                ),
            );
        }
    }
}

/// Configuration for Radiance Cascades GI
#[derive(Resource, Clone)]
pub struct RadianceCascadesConfig {
    /// Enable/disable GI
    pub enabled: bool,

    /// Number of cascade levels (typically 4)
    pub cascade_count: u32,

    /// Rays per probe at finest cascade
    pub rays_per_probe: u32,

    /// Probe spacing at finest cascade (in pixels)
    pub probe_spacing: f32,

    /// Maximum ray distance (world units)
    pub max_ray_distance: f32,

    /// GI intensity multiplier
    pub gi_intensity: f32,

    /// Secondary bounce intensity
    pub bounce_intensity: f32,

    /// AO strength from SDF
    pub ao_strength: f32,

    /// Normal bias to prevent self-shadowing
    pub normal_bias: f32,

    /// Temporal blend factor for stability
    pub temporal_blend: f32,

    // SDF Volume settings
    /// SDF volume resolution
    pub sdf_resolution: UVec3,

    /// World bounds for SDF volume
    pub sdf_world_min: Vec3,
    pub sdf_world_max: Vec3,

    /// Update SDF incrementally vs full rebuild
    pub incremental_sdf_updates: bool,

    /// Selected voxel ray backend for GI queries.
    pub voxel_backend: VoxelRayBackendMode,

    /// Per-query NAADF routing mask for GI, sun visibility, terrain AO, and contact shadows.
    pub voxel_backend_query_mask: u32,

    /// Last backend switch generation mirrored from ray tracing settings.
    pub backend_switch_generation: u64,
}

impl Default for RadianceCascadesConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            cascade_count: 4,
            rays_per_probe: 16,
            probe_spacing: 8.0,
            max_ray_distance: 64.0,
            gi_intensity: 1.0,
            bounce_intensity: 0.5,
            ao_strength: 0.5,
            normal_bias: 0.1,
            temporal_blend: 0.9,
            sdf_resolution: UVec3::new(128, 64, 128),
            sdf_world_min: Vec3::new(-256.0, 0.0, -256.0),
            sdf_world_max: Vec3::new(256.0, 64.0, 256.0),
            incremental_sdf_updates: true,
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            voxel_backend_query_mask: 0,
            backend_switch_generation: 0,
        }
    }
}

/// Runtime state for SDF volume
#[derive(Resource)]
pub struct SdfVolumeState {
    /// 3D SDF texture handle
    pub sdf_texture: Option<Handle<Image>>,

    /// Dirty chunks that need SDF update
    pub dirty_chunks: VecDeque<IVec3>,

    /// Membership set for dirty chunk deduplication.
    dirty_chunk_set: HashSet<IVec3>,

    /// Frame counter for temporal jitter
    pub frame_index: u32,

    /// Whether initial SDF generation is complete
    pub initialized: bool,

    /// Previous frame's view-projection for reprojection
    pub prev_view_proj: Mat4,

    /// Last GI history reset caused by a voxel backend switch.
    pub history_reset_generation: u64,

    /// Whether the SDF volume update path was needed for the most recent frame.
    pub sdf_update_needed_last_frame: bool,

    /// Frames where all GI query classes were NAADF-routed and SDF update work was skipped.
    pub sdf_updates_skipped_for_naadf: u64,

    /// Last GI history reset caused by NAADF dirty chunk edits.
    pub naadf_dirty_history_generation: u64,

    /// Last observed total of queued NAADF dirty chunks.
    pub last_naadf_dirty_queued_total: u64,
}

impl Default for SdfVolumeState {
    fn default() -> Self {
        Self {
            sdf_texture: None,
            dirty_chunks: VecDeque::new(),
            dirty_chunk_set: HashSet::new(),
            frame_index: 0,
            initialized: false,
            prev_view_proj: Mat4::IDENTITY,
            history_reset_generation: 0,
            sdf_update_needed_last_frame: true,
            sdf_updates_skipped_for_naadf: 0,
            naadf_dirty_history_generation: 0,
            last_naadf_dirty_queued_total: 0,
        }
    }
}

#[cfg(feature = "naadf")]
pub fn sync_radiance_cascades_voxel_backend(
    ray_tracing: Res<RayTracingSettings>,
    naadf_config: Option<Res<NaadfConfig>>,
    naadf_cache_state: Option<Res<NaadfCacheState>>,
    naadf_stats: Option<Res<NaadfStats>>,
    mut config: ResMut<RadianceCascadesConfig>,
    mut state: ResMut<SdfVolumeState>,
) {
    let query_mask = naadf_config
        .as_deref()
        .map(naadf_query_mask_from_config)
        .unwrap_or_default();
    let shader_backend_available = naadf_gi_shader_backend_available(
        naadf_config.as_deref(),
        naadf_cache_state.as_deref(),
        naadf_stats.as_deref(),
    );
    apply_radiance_backend_selection_with_shader_support(
        &ray_tracing,
        query_mask,
        shader_backend_available,
        &mut config,
        &mut state,
    );
}

#[cfg(feature = "naadf")]
pub fn invalidate_naadf_lighting_history_for_dirty_chunks(
    queue: Option<Res<NaadfDirtyChunkQueue>>,
    config: Res<RadianceCascadesConfig>,
    mut state: ResMut<SdfVolumeState>,
) {
    let Some(queue) = queue else {
        return;
    };
    apply_naadf_dirty_history_invalidation(queue.stats().queued_total, &config, &mut state);
}

#[cfg(feature = "naadf")]
fn apply_naadf_dirty_history_invalidation(
    queued_total: u64,
    config: &RadianceCascadesConfig,
    state: &mut SdfVolumeState,
) {
    if queued_total == state.last_naadf_dirty_queued_total {
        return;
    }
    state.last_naadf_dirty_queued_total = queued_total;

    if config.enabled && config.voxel_backend == VoxelRayBackendMode::Naadf {
        state.frame_index = 0;
        state.prev_view_proj = Mat4::IDENTITY;
        state.naadf_dirty_history_generation =
            state.naadf_dirty_history_generation.saturating_add(1);
    }
}

#[cfg(not(feature = "naadf"))]
pub fn sync_radiance_cascades_voxel_backend(
    ray_tracing: Res<RayTracingSettings>,
    mut config: ResMut<RadianceCascadesConfig>,
    mut state: ResMut<SdfVolumeState>,
) {
    apply_radiance_backend_selection(&ray_tracing, 0, &mut config, &mut state);
}

pub fn apply_radiance_backend_selection(
    ray_tracing: &RayTracingSettings,
    naadf_query_mask: u32,
    config: &mut RadianceCascadesConfig,
    state: &mut SdfVolumeState,
) {
    apply_radiance_backend_selection_with_shader_support(
        ray_tracing,
        naadf_query_mask,
        false,
        config,
        state,
    );
}

fn apply_radiance_backend_selection_with_shader_support(
    ray_tracing: &RayTracingSettings,
    naadf_query_mask: u32,
    shader_backend_available: bool,
    config: &mut RadianceCascadesConfig,
    state: &mut SdfVolumeState,
) {
    let requested_backend = match ray_tracing.experimental_mode {
        ExperimentalRenderMode::Current
        | ExperimentalRenderMode::CurrentWithNaadfGi
        | ExperimentalRenderMode::NaadfPreview => ray_tracing.effective_backend(),
    };
    let target_backend =
        if requested_backend == VoxelRayBackendMode::Naadf && !shader_backend_available {
            VoxelRayBackendMode::CurrentSdf
        } else {
            requested_backend
        };

    config.voxel_backend = target_backend;
    config.voxel_backend_query_mask = if target_backend == VoxelRayBackendMode::Naadf {
        naadf_query_mask
    } else {
        0
    };

    if config.backend_switch_generation != ray_tracing.backend_switch_generation {
        config.backend_switch_generation = ray_tracing.backend_switch_generation;
        if ray_tracing.reset_history_on_backend_switch {
            state.frame_index = 0;
            state.prev_view_proj = Mat4::IDENTITY;
            state.history_reset_generation = ray_tracing.backend_switch_generation;
        }
    }
}

#[cfg(feature = "naadf")]
fn naadf_query_mask_from_config(config: &NaadfConfig) -> u32 {
    let mut mask = 0;
    if config.use_for_gi_secondary {
        mask |= NAADF_QUERY_GI_SECONDARY;
    }
    if config.use_for_sun_visibility {
        mask |= NAADF_QUERY_SUN_VISIBILITY;
    }
    if config.use_for_terrain_ao {
        mask |= NAADF_QUERY_TERRAIN_AO;
    }
    if config.use_for_contact_shadows {
        mask |= NAADF_QUERY_CONTACT_SHADOW;
    }
    mask
}

#[cfg(feature = "naadf")]
pub fn naadf_gi_shader_backend_available(
    config: Option<&NaadfConfig>,
    cache_state: Option<&NaadfCacheState>,
    stats: Option<&NaadfStats>,
) -> bool {
    let (Some(config), Some(cache_state), Some(stats)) = (config, cache_state, stats) else {
        return false;
    };

    config.enabled
        && config.debug.allow_unverified_post_205
        && cache_state.ready
        && stats.gpu_slots_used > 0
        && stats.gpu_uploads_pending == 0
        && stats.gpu_build_queue_pending == 0
        && stats.dirty_pending == 0
        && stats.dirty_in_flight == 0
}

#[cfg(not(feature = "naadf"))]
pub const fn naadf_gi_shader_backend_available() -> bool {
    false
}

#[cfg(feature = "naadf")]
#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct RadianceCascadesLabel;

#[cfg(feature = "naadf")]
#[derive(Resource, Clone, Default)]
pub struct ExtractedRadianceCascadesState {
    pub config: RadianceCascadesConfig,
    pub frame_index: u32,
    pub active: bool,
    pub sun_direction: Vec3,
}

#[cfg(feature = "naadf")]
#[derive(Resource)]
pub struct RadianceCascadePipeline {
    pub main_layout: BindGroupLayoutDescriptor,
    pub sampler: Sampler,
    _dummy_2d_texture: Texture,
    pub dummy_2d_view: TextureView,
    _dummy_3d_texture: Texture,
    pub dummy_3d_view: TextureView,
    pub hdr_pipeline_id: CachedRenderPipelineId,
    pub sdr_pipeline_id: CachedRenderPipelineId,
}

#[cfg(feature = "naadf")]
const RADIANCE_NAADF_VOXEL_RECORDS_BINDING: u32 = 0;
#[cfg(feature = "naadf")]
const RADIANCE_NAADF_MATERIAL_RECORDS_BINDING: u32 = 1;
#[cfg(feature = "naadf")]
const RADIANCE_NAADF_BLOCK_RECORDS_BINDING: u32 = 5;
#[cfg(feature = "naadf")]
const RADIANCE_NAADF_CHUNK_RECORDS_BINDING: u32 = 11;
#[cfg(feature = "naadf")]
const RADIANCE_NAADF_CHUNK_LOOKUP_BINDING: u32 = 20;

#[cfg(feature = "naadf")]
#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ExtractedRadianceNaadfCacheState {
    pub ready: bool,
}

#[cfg(feature = "naadf")]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum RadianceCascadeNaadfBindingSource {
    #[default]
    Dummy,
    Live {
        max_chunks: u32,
        estimated_bytes: u64,
    },
}

#[cfg(feature = "naadf")]
#[derive(Resource)]
pub struct RadianceCascadeNaadfBindings {
    pub layout: BindGroupLayout,
    pub descriptor: BindGroupLayoutDescriptor,
    dummy_buffer: Buffer,
    pub bind_group: BindGroup,
    pub source: RadianceCascadeNaadfBindingSource,
}

#[cfg(feature = "naadf")]
pub fn extract_radiance_cascades_state(mut commands: Commands, main_world: Res<MainWorld>) {
    let config = main_world
        .get_resource::<RadianceCascadesConfig>()
        .map(|config| config.clone())
        .unwrap_or_default();
    let frame_index = main_world
        .get_resource::<SdfVolumeState>()
        .map(|state| state.frame_index)
        .unwrap_or_default();
    let active = radiance_cascade_pass_active(&config);
    let sun_direction = main_world
        .get_resource::<FogUniforms>()
        .map(|fog| fog.sun_dir.normalize_or_zero())
        .unwrap_or_else(|| FogUniforms::default().sun_dir.normalize_or_zero());
    commands.insert_resource(ExtractedRadianceCascadesState {
        config,
        frame_index,
        active,
        sun_direction,
    });
}

#[cfg(feature = "naadf")]
pub fn extract_radiance_naadf_cache_state(mut commands: Commands, main_world: Res<MainWorld>) {
    let ready = main_world
        .get_resource::<NaadfCacheState>()
        .map(|state| state.ready)
        .unwrap_or(false);
    commands.insert_resource(ExtractedRadianceNaadfCacheState { ready });
}

#[cfg(feature = "naadf")]
pub fn init_radiance_cascade_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    fullscreen_shader: Res<FullscreenShader>,
    pipeline_cache: Res<PipelineCache>,
) {
    let naadf_descriptor = BindGroupLayoutDescriptor::new(
        "radiance_cascade_naadf_bind_group_layout",
        &radiance_cascade_naadf_bind_group_layout_entries(),
    );
    let naadf_layout = render_device.create_bind_group_layout(
        Some("radiance_cascade_naadf_bind_group_layout"),
        &naadf_descriptor.entries,
    );
    let dummy_buffer = create_radiance_cascade_naadf_dummy_buffer(&render_device);
    let bind_group = create_radiance_cascade_naadf_dummy_bind_group(
        &render_device,
        &naadf_layout,
        &dummy_buffer,
    );

    let main_layout = radiance_cascade_main_bind_group_layout();
    let empty_group_layout =
        BindGroupLayoutDescriptor::new("radiance_cascade_empty_group_layout", &[]);
    let sampler = render_device.create_sampler(&SamplerDescriptor::default());
    let (dummy_2d_texture, dummy_2d_view) = create_radiance_dummy_texture(
        &render_device,
        "radiance_cascade_dummy_2d_texture",
        TextureDimension::D2,
        TextureViewDimension::D2,
    );
    let (dummy_3d_texture, dummy_3d_view) = create_radiance_dummy_texture(
        &render_device,
        "radiance_cascade_dummy_3d_texture",
        TextureDimension::D3,
        TextureViewDimension::D3,
    );
    let pipeline_descriptor =
        |label: &'static str, format: TextureFormat| RenderPipelineDescriptor {
            label: Some(Cow::from(label)),
            layout: vec![
                main_layout.clone(),
                empty_group_layout.clone(),
                empty_group_layout.clone(),
                naadf_descriptor.clone(),
            ],
            vertex: fullscreen_shader.to_vertex_state(),
            fragment: Some(FragmentState {
                shader: RADIANCE_CASCADES_SHADER_HANDLE,
                entry_point: Some(Cow::from("radiance_sun_visibility")),
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
        "radiance_cascades_passthrough_hdr",
        ViewTarget::TEXTURE_FORMAT_HDR,
    ));
    let sdr_pipeline_id = pipeline_cache.queue_render_pipeline(pipeline_descriptor(
        "radiance_cascades_passthrough_sdr",
        TextureFormat::bevy_default(),
    ));

    commands.insert_resource(RadianceCascadeNaadfBindings {
        layout: naadf_layout,
        descriptor: naadf_descriptor,
        dummy_buffer,
        bind_group,
        source: RadianceCascadeNaadfBindingSource::Dummy,
    });
    commands.insert_resource(RadianceCascadePipeline {
        main_layout,
        sampler,
        _dummy_2d_texture: dummy_2d_texture,
        dummy_2d_view,
        _dummy_3d_texture: dummy_3d_texture,
        dummy_3d_view,
        hdr_pipeline_id,
        sdr_pipeline_id,
    });
}

#[cfg(feature = "naadf")]
pub fn prepare_radiance_cascade_naadf_bind_group(
    mut bindings: ResMut<RadianceCascadeNaadfBindings>,
    cache_state: Option<Res<ExtractedRadianceNaadfCacheState>>,
    buffers: Option<Res<crate::rendering::naadf::gpu_buffers::NaadfGpuBuffers>>,
    render_device: Res<RenderDevice>,
) {
    let ready = cache_state
        .as_deref()
        .map(|state| state.ready)
        .unwrap_or(false);
    let live = buffers
        .as_deref()
        .filter(|buffers| ready && buffers.status().allocated)
        .and_then(|buffers| {
            buffers
                .allocation()
                .map(|allocation| (buffers.status(), allocation))
        });

    let target_source = live
        .map(|(status, _)| RadianceCascadeNaadfBindingSource::Live {
            max_chunks: status.max_chunks,
            estimated_bytes: status.estimated_bytes,
        })
        .unwrap_or(RadianceCascadeNaadfBindingSource::Dummy);

    if bindings.source == target_source {
        return;
    }

    let bind_group = if let Some((_, allocation)) = live {
        render_device.create_bind_group(
            Some("radiance_cascade_naadf_live_bind_group"),
            &bindings.layout,
            &BindGroupEntries::with_indices((
                (
                    RADIANCE_NAADF_VOXEL_RECORDS_BINDING,
                    allocation.voxel_buffer.as_entire_binding(),
                ),
                (
                    RADIANCE_NAADF_MATERIAL_RECORDS_BINDING,
                    allocation.material_buffer.as_entire_binding(),
                ),
                (
                    RADIANCE_NAADF_BLOCK_RECORDS_BINDING,
                    allocation.block_buffer.as_entire_binding(),
                ),
                (
                    RADIANCE_NAADF_CHUNK_RECORDS_BINDING,
                    allocation.chunk_buffer.as_entire_binding(),
                ),
                (
                    RADIANCE_NAADF_CHUNK_LOOKUP_BINDING,
                    allocation.chunk_lookup_buffer.as_entire_binding(),
                ),
            )),
        )
    } else {
        create_radiance_cascade_naadf_dummy_bind_group(
            &render_device,
            &bindings.layout,
            &bindings.dummy_buffer,
        )
    };

    bindings.bind_group = bind_group;
    bindings.source = target_source;
}

#[cfg(feature = "naadf")]
fn create_radiance_cascade_naadf_dummy_buffer(render_device: &RenderDevice) -> Buffer {
    render_device.create_buffer(&BufferDescriptor {
        label: Some("radiance_cascade_naadf_dummy_records"),
        size: 16,
        usage: BufferUsages::STORAGE,
        mapped_at_creation: false,
    })
}

#[cfg(feature = "naadf")]
fn create_radiance_cascade_naadf_dummy_bind_group(
    render_device: &RenderDevice,
    layout: &BindGroupLayout,
    dummy_buffer: &Buffer,
) -> BindGroup {
    render_device.create_bind_group(
        Some("radiance_cascade_naadf_dummy_bind_group"),
        layout,
        &BindGroupEntries::with_indices((
            (
                RADIANCE_NAADF_VOXEL_RECORDS_BINDING,
                dummy_buffer.as_entire_binding(),
            ),
            (
                RADIANCE_NAADF_MATERIAL_RECORDS_BINDING,
                dummy_buffer.as_entire_binding(),
            ),
            (
                RADIANCE_NAADF_BLOCK_RECORDS_BINDING,
                dummy_buffer.as_entire_binding(),
            ),
            (
                RADIANCE_NAADF_CHUNK_RECORDS_BINDING,
                dummy_buffer.as_entire_binding(),
            ),
            (
                RADIANCE_NAADF_CHUNK_LOOKUP_BINDING,
                dummy_buffer.as_entire_binding(),
            ),
        )),
    )
}

#[cfg(feature = "naadf")]
fn radiance_cascade_naadf_bind_group_layout_entries() -> [BindGroupLayoutEntry; 5] {
    [
        naadf_radiance_storage_entry(RADIANCE_NAADF_VOXEL_RECORDS_BINDING),
        naadf_radiance_storage_entry(RADIANCE_NAADF_MATERIAL_RECORDS_BINDING),
        naadf_radiance_storage_entry(RADIANCE_NAADF_BLOCK_RECORDS_BINDING),
        naadf_radiance_storage_entry(RADIANCE_NAADF_CHUNK_RECORDS_BINDING),
        naadf_radiance_storage_entry(RADIANCE_NAADF_CHUNK_LOOKUP_BINDING),
    ]
}

#[cfg(feature = "naadf")]
fn naadf_radiance_storage_entry(binding: u32) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE | ShaderStages::FRAGMENT,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Storage { read_only: true },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

#[cfg(feature = "naadf")]
fn radiance_cascade_main_bind_group_layout() -> BindGroupLayoutDescriptor {
    BindGroupLayoutDescriptor::new(
        "radiance_cascade_main_bind_group_layout",
        &[
            uniform_buffer_entry(0),
            texture_entry(1, TextureViewDimension::D3),
            sampler_entry(2),
            depth_texture_entry(3),
            texture_entry(4, TextureViewDimension::D2),
            texture_entry(5, TextureViewDimension::D2),
            texture_entry(6, TextureViewDimension::D2),
            texture_entry(7, TextureViewDimension::D2),
            texture_entry(8, TextureViewDimension::D2),
            texture_entry(9, TextureViewDimension::D2),
            texture_entry(10, TextureViewDimension::D2),
            texture_entry(11, TextureViewDimension::D2),
            sampler_entry(12),
        ],
    )
}

#[cfg(feature = "naadf")]
fn uniform_buffer_entry(binding: u32) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::FRAGMENT | ShaderStages::COMPUTE,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

#[cfg(feature = "naadf")]
fn texture_entry(binding: u32, view_dimension: TextureViewDimension) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::FRAGMENT | ShaderStages::COMPUTE,
        ty: BindingType::Texture {
            sample_type: TextureSampleType::Float { filterable: true },
            view_dimension,
            multisampled: false,
        },
        count: None,
    }
}

#[cfg(feature = "naadf")]
fn depth_texture_entry(binding: u32) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::FRAGMENT | ShaderStages::COMPUTE,
        ty: BindingType::Texture {
            sample_type: TextureSampleType::Depth,
            view_dimension: TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

#[cfg(feature = "naadf")]
fn sampler_entry(binding: u32) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::FRAGMENT | ShaderStages::COMPUTE,
        ty: BindingType::Sampler(SamplerBindingType::Filtering),
        count: None,
    }
}

#[cfg(feature = "naadf")]
fn create_radiance_dummy_texture(
    render_device: &RenderDevice,
    label: &'static str,
    dimension: TextureDimension,
    view_dimension: TextureViewDimension,
) -> (Texture, TextureView) {
    let texture = render_device.create_texture(&TextureDescriptor {
        label: Some(label),
        size: Extent3d {
            width: 1,
            height: 1,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension,
        format: TextureFormat::Rgba8Unorm,
        usage: TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST,
        view_formats: &[],
    });
    let view = texture.create_view(&TextureViewDescriptor {
        dimension: Some(view_dimension),
        ..default()
    });
    (texture, view)
}

#[cfg(feature = "naadf")]
#[derive(Default)]
pub struct RadianceCascadesNode;

#[cfg(feature = "naadf")]
impl ViewNode for RadianceCascadesNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static ExtractedView,
        &'static ViewPrepassTextures,
    );

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        (view_target, extracted_view, prepass_textures): bevy::ecs::query::QueryItem<
            'w,
            '_,
            Self::ViewQuery,
        >,
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        let Some(state) = world.get_resource::<ExtractedRadianceCascadesState>() else {
            return Ok(());
        };
        if !state.active {
            return Ok(());
        }
        let Some(pipeline_res) = world.get_resource::<RadianceCascadePipeline>() else {
            return Ok(());
        };
        let Some(naadf_bindings) = world.get_resource::<RadianceCascadeNaadfBindings>() else {
            return Ok(());
        };
        let Some(depth_view) = prepass_textures.depth_view() else {
            return Ok(());
        };
        let Some(normal_view) = prepass_textures.normal_view() else {
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
        let naadf_counts = radiance_naadf_counts(world, naadf_bindings);
        let uniform_buffer = create_radiance_uniform_buffer(
            render_context.render_device(),
            state,
            extracted_view,
            naadf_counts,
        );
        let bind_group = render_context.render_device().create_bind_group(
            "radiance_cascades_sun_visibility_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.main_layout),
            &BindGroupEntries::with_indices((
                (0, uniform_buffer.as_entire_binding()),
                (1, BindingResource::TextureView(&pipeline_res.dummy_3d_view)),
                (2, BindingResource::Sampler(&pipeline_res.sampler)),
                (3, BindingResource::TextureView(depth_view)),
                (4, BindingResource::TextureView(normal_view)),
                (5, BindingResource::TextureView(post_process.source)),
                (6, BindingResource::TextureView(&pipeline_res.dummy_2d_view)),
                (7, BindingResource::TextureView(&pipeline_res.dummy_2d_view)),
                (8, BindingResource::TextureView(&pipeline_res.dummy_2d_view)),
                (9, BindingResource::TextureView(&pipeline_res.dummy_2d_view)),
                (
                    10,
                    BindingResource::TextureView(&pipeline_res.dummy_2d_view),
                ),
                (
                    11,
                    BindingResource::TextureView(&pipeline_res.dummy_2d_view),
                ),
                (12, BindingResource::Sampler(&pipeline_res.sampler)),
            )),
        );

        let mut render_pass = render_context.begin_tracked_render_pass(RenderPassDescriptor {
            label: Some("radiance_cascades_sun_visibility_pass"),
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
        render_pass.set_bind_group(3, &naadf_bindings.bind_group, &[]);
        render_pass.draw(0..3, 0..1);

        Ok(())
    }
}

#[cfg(feature = "naadf")]
fn create_radiance_uniform_buffer(
    render_device: &RenderDevice,
    state: &ExtractedRadianceCascadesState,
    view: &ExtractedView,
    naadf_counts: UVec2,
) -> Buffer {
    let world_from_view = view.world_from_view.to_matrix();
    let clip_from_world = view.clip_from_view * world_from_view.inverse();
    let uniforms = create_radiance_uniforms_with_naadf_counts(
        &state.config,
        &SdfVolumeState {
            frame_index: state.frame_index,
            ..default()
        },
        world_from_view.w_axis.truncate(),
        state.sun_direction,
        Vec3::ONE,
        clip_from_world.inverse(),
        naadf_counts,
    );
    let mut uniform_buffer = encase::UniformBuffer::new(Vec::<u8>::new());
    uniform_buffer.write(&uniforms).unwrap();
    render_device.create_buffer_with_data(&BufferInitDescriptor {
        label: Some("radiance_cascades_uniforms"),
        contents: uniform_buffer.as_ref(),
        usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
    })
}

#[cfg(feature = "naadf")]
fn radiance_naadf_counts(world: &World, bindings: &RadianceCascadeNaadfBindings) -> UVec2 {
    let chunk_count = match bindings.source {
        RadianceCascadeNaadfBindingSource::Live { max_chunks, .. } => max_chunks,
        RadianceCascadeNaadfBindingSource::Dummy => 0,
    };
    let lookup_count = world
        .get_resource::<NaadfGpuChunkTable>()
        .map(|table| table.stats().allocated_chunks)
        .unwrap_or(0)
        .min(chunk_count);

    UVec2::new(chunk_count, lookup_count)
}

/// GPU uniforms for radiance cascades
#[derive(Clone, Copy, Default, ShaderType)]
pub struct RadianceCascadeUniforms {
    pub cascade_count: u32,
    pub rays_per_probe: u32,
    pub probe_spacing: f32,
    pub max_ray_distance: f32,

    pub sdf_volume_min: Vec3,
    pub _padding0: f32,
    pub sdf_volume_max: Vec3,
    pub _padding1: f32,
    pub sdf_volume_resolution: UVec3,
    pub _padding2: u32,

    pub sun_direction: Vec3,
    pub _padding3: f32,
    pub sun_color: Vec3,
    pub sun_intensity: f32,
    pub sky_color: Vec3,
    pub sky_intensity: f32,

    pub gi_intensity: f32,
    pub bounce_intensity: f32,
    pub ambient_occlusion_strength: f32,
    pub normal_bias: f32,

    pub frame_index: u32,
    pub temporal_blend: f32,
    pub voxel_backend: u32,
    pub backend_switch_generation: u32,

    pub camera_position: Vec3,
    pub voxel_backend_query_mask: u32,
    pub naadf_counts: UVec4,

    pub inv_view_proj: Mat4,
}

/// GPU uniforms for SDF volume generation
#[derive(Clone, Copy, Default, ShaderType)]
pub struct SdfVolumeUniforms {
    pub volume_min: Vec3,
    pub _padding0: f32,
    pub volume_max: Vec3,
    pub _padding1: f32,

    pub resolution: UVec3,
    pub _padding2: u32,

    pub update_min: UVec3,
    pub _padding3: u32,
    pub update_max: UVec3,
    pub _padding4: u32,

    pub chunk_offset: IVec3,
    pub _padding5: i32,
}

/// Cascade texture resources
#[derive(Resource)]
pub struct CascadeTextures {
    pub cascade_0: Handle<Image>,
    pub cascade_1: Handle<Image>,
    pub cascade_2: Handle<Image>,
    pub cascade_3: Handle<Image>,
    pub history: Handle<Image>,
}

/// Component to mark cameras that should receive GI
#[derive(Component, Clone, Copy)]
pub struct RadianceCascadesCamera;

fn configure_radiance_cascade_camera_prepass(
    mut commands: Commands,
    config: Res<RadianceCascadesConfig>,
    cameras: Query<Entity, (With<Camera3d>, Without<RadianceCascadesCamera>)>,
) {
    if !radiance_cascade_pass_active(&config) {
        return;
    }

    for entity in cameras.iter() {
        commands
            .entity(entity)
            .insert((RadianceCascadesCamera, DepthPrepass, NormalPrepass));
    }
}

/// Quality presets for Radiance Cascades
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RadianceCascadesQuality {
    Low,
    Medium,
    High,
    Ultra,
}

impl RadianceCascadesQuality {
    pub fn apply(&self, config: &mut RadianceCascadesConfig) {
        match self {
            RadianceCascadesQuality::Low => {
                config.cascade_count = 3;
                config.rays_per_probe = 8;
                config.probe_spacing = 16.0;
                config.sdf_resolution = UVec3::new(64, 32, 64);
                config.temporal_blend = 0.95;
            }
            RadianceCascadesQuality::Medium => {
                config.cascade_count = 4;
                config.rays_per_probe = 12;
                config.probe_spacing = 12.0;
                config.sdf_resolution = UVec3::new(96, 48, 96);
                config.temporal_blend = 0.92;
            }
            RadianceCascadesQuality::High => {
                config.cascade_count = 4;
                config.rays_per_probe = 16;
                config.probe_spacing = 8.0;
                config.sdf_resolution = UVec3::new(128, 64, 128);
                config.temporal_blend = 0.9;
            }
            RadianceCascadesQuality::Ultra => {
                config.cascade_count = 5;
                config.rays_per_probe = 24;
                config.probe_spacing = 6.0;
                config.sdf_resolution = UVec3::new(192, 96, 192);
                config.temporal_blend = 0.85;
            }
        }
    }
}

/// Setup radiance cascades resources
fn setup_radiance_cascades(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    config: Res<RadianceCascadesConfig>,
) {
    if !config.enabled {
        return;
    }

    // Create SDF volume texture
    let sdf_texture = create_sdf_volume_texture(&config);
    let _sdf_handle = images.add(sdf_texture);

    // Create cascade textures (screen-sized, half-res per cascade)
    // In a full implementation, these would be created based on screen resolution
    let cascade_size = Extent3d {
        width: 1920 / 2,
        height: 1080 / 2,
        depth_or_array_layers: 1,
    };

    let create_cascade_texture = |size: Extent3d| -> Image {
        let mut image = Image::new_fill(
            size,
            TextureDimension::D2,
            &[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
            TextureFormat::Rgba16Float,
            RenderAssetUsages::RENDER_WORLD,
        );
        image.texture_descriptor.usage = TextureUsages::TEXTURE_BINDING
            | TextureUsages::STORAGE_BINDING
            | TextureUsages::RENDER_ATTACHMENT;
        image
    };

    let cascade_0 = images.add(create_cascade_texture(cascade_size));
    let cascade_1 = images.add(create_cascade_texture(Extent3d {
        width: cascade_size.width / 2,
        height: cascade_size.height / 2,
        depth_or_array_layers: 1,
    }));
    let cascade_2 = images.add(create_cascade_texture(Extent3d {
        width: cascade_size.width / 4,
        height: cascade_size.height / 4,
        depth_or_array_layers: 1,
    }));
    let cascade_3 = images.add(create_cascade_texture(Extent3d {
        width: cascade_size.width / 8,
        height: cascade_size.height / 8,
        depth_or_array_layers: 1,
    }));
    let history = images.add(create_cascade_texture(cascade_size));

    commands.insert_resource(CascadeTextures {
        cascade_0,
        cascade_1,
        cascade_2,
        cascade_3,
        history,
    });

    info!(
        "Radiance Cascades GI initialized with {} cascades",
        config.cascade_count
    );
}

/// Create 3D SDF volume texture
fn create_sdf_volume_texture(config: &RadianceCascadesConfig) -> Image {
    let res = config.sdf_resolution;
    let size = Extent3d {
        width: res.x,
        height: res.y,
        depth_or_array_layers: res.z,
    };

    // R16Float for signed distance values
    let data_size = (res.x * res.y * res.z * 2) as usize; // 2 bytes per R16Float
    let data = vec![0u8; data_size];

    let mut image = Image::new(
        size,
        TextureDimension::D3,
        data,
        TextureFormat::R16Float,
        RenderAssetUsages::RENDER_WORLD,
    );

    image.texture_descriptor.usage =
        TextureUsages::TEXTURE_BINDING | TextureUsages::STORAGE_BINDING | TextureUsages::COPY_DST;

    image
}

/// Update SDF volume from voxel world changes
fn update_sdf_volume(
    config: Res<RadianceCascadesConfig>,
    mut state: ResMut<SdfVolumeState>,
    voxel_world: Option<Res<VoxelWorld>>,
) {
    if !config.enabled {
        return;
    }

    state.frame_index = state.frame_index.wrapping_add(1);
    state.sdf_update_needed_last_frame = sdf_volume_update_needed(&config);
    if !state.sdf_update_needed_last_frame {
        state.sdf_updates_skipped_for_naadf = state.sdf_updates_skipped_for_naadf.saturating_add(1);
        return;
    }

    // In a full implementation, this would:
    // 1. Check for modified chunks in VoxelWorld
    // 2. Queue dirty chunks for SDF update
    // 3. Dispatch compute shader for incremental or full SDF rebuild

    if !state.initialized {
        // Initial full SDF generation
        if voxel_world.is_some() {
            info!("Generating initial SDF volume...");
            // Would dispatch full SDF generation compute shader here
            state.initialized = true;
        }
    }

    // Process dirty chunks incrementally
    if config.incremental_sdf_updates && !state.dirty_chunks.is_empty() {
        // Would dispatch incremental update compute shader here
        process_dirty_sdf_chunks(&mut state, 8);
    }
}

fn sdf_volume_update_needed(config: &RadianceCascadesConfig) -> bool {
    if !config.enabled {
        return false;
    }
    if config.voxel_backend != VoxelRayBackendMode::Naadf {
        return true;
    }
    config.voxel_backend_query_mask & NAADF_QUERY_ALL != NAADF_QUERY_ALL
}

/// Update cascade parameters each frame
fn update_cascade_params(
    mut state: ResMut<SdfVolumeState>,
    camera_query: Query<&GlobalTransform, With<Camera3d>>,
) {
    // Store previous view matrix for temporal reprojection
    // Full view-projection would require accessing Camera component
    if let Ok(transform) = camera_query.single() {
        let view = Mat4::from(transform.affine().inverse());
        // For now, just store the view matrix - full implementation would include projection
        state.prev_view_proj = view;
    }
}

/// Mark a chunk as needing SDF update
pub fn mark_chunk_dirty(state: &mut SdfVolumeState, chunk_pos: IVec3) {
    if state.dirty_chunk_set.insert(chunk_pos) {
        state.dirty_chunks.push_back(chunk_pos);
    }
}

fn process_dirty_sdf_chunks(state: &mut SdfVolumeState, max_chunks: usize) -> usize {
    let chunks_to_update = state.dirty_chunks.len().min(max_chunks);
    for _ in 0..chunks_to_update {
        if let Some(chunk_pos) = state.dirty_chunks.pop_front() {
            state.dirty_chunk_set.remove(&chunk_pos);
        }
    }
    chunks_to_update
}

/// Create uniforms from current state
pub fn create_radiance_uniforms(
    config: &RadianceCascadesConfig,
    state: &SdfVolumeState,
    camera_pos: Vec3,
    sun_dir: Vec3,
    sun_color: Vec3,
    inv_view_proj: Mat4,
) -> RadianceCascadeUniforms {
    create_radiance_uniforms_with_naadf_counts(
        config,
        state,
        camera_pos,
        sun_dir,
        sun_color,
        inv_view_proj,
        UVec2::ZERO,
    )
}

pub fn create_radiance_uniforms_with_naadf_counts(
    config: &RadianceCascadesConfig,
    state: &SdfVolumeState,
    camera_pos: Vec3,
    sun_dir: Vec3,
    sun_color: Vec3,
    inv_view_proj: Mat4,
    naadf_counts: UVec2,
) -> RadianceCascadeUniforms {
    RadianceCascadeUniforms {
        cascade_count: config.cascade_count,
        rays_per_probe: config.rays_per_probe,
        probe_spacing: config.probe_spacing,
        max_ray_distance: config.max_ray_distance,

        sdf_volume_min: config.sdf_world_min,
        _padding0: 0.0,
        sdf_volume_max: config.sdf_world_max,
        _padding1: 0.0,
        sdf_volume_resolution: config.sdf_resolution,
        _padding2: 0,

        sun_direction: sun_dir,
        _padding3: 0.0,
        sun_color,
        sun_intensity: 1.0,
        sky_color: Vec3::new(0.5, 0.7, 1.0),
        sky_intensity: 0.3,

        gi_intensity: config.gi_intensity,
        bounce_intensity: config.bounce_intensity,
        ambient_occlusion_strength: config.ao_strength,
        normal_bias: config.normal_bias,

        frame_index: state.frame_index,
        temporal_blend: config.temporal_blend,
        voxel_backend: voxel_backend_code(config.voxel_backend),
        backend_switch_generation: config.backend_switch_generation as u32,

        camera_position: camera_pos,
        voxel_backend_query_mask: config.voxel_backend_query_mask,
        naadf_counts: UVec4::new(naadf_counts.x, naadf_counts.y, 0, 0),

        inv_view_proj,
    }
}

fn voxel_backend_code(backend: VoxelRayBackendMode) -> u32 {
    match backend {
        VoxelRayBackendMode::CurrentSdf | VoxelRayBackendMode::Auto => 0,
        VoxelRayBackendMode::Naadf => 1,
    }
}

#[cfg(feature = "naadf")]
pub fn record_naadf_gi_counters(
    config: Res<RadianceCascadesConfig>,
    mut naadf_stats: Option<ResMut<NaadfStats>>,
) {
    let gi_rays = estimated_naadf_gi_rays(&config);
    if let Some(stats) = naadf_stats.as_deref_mut() {
        stats.gi_rays_last_frame = gi_rays;
        stats.radiance_sun_visibility_rays_per_pixel =
            estimated_naadf_sun_visibility_rays_per_pixel(&config);
        stats.radiance_contact_shadow_rays_per_pixel =
            estimated_naadf_contact_shadow_rays_per_pixel(&config);
        stats.radiance_terrain_ao_rays_per_pixel =
            estimated_naadf_terrain_ao_rays_per_pixel(&config);
        stats.radiance_short_range_rays_per_pixel = stats
            .radiance_contact_shadow_rays_per_pixel
            .saturating_add(stats.radiance_terrain_ao_rays_per_pixel);
    }
}

pub fn estimated_naadf_gi_rays(config: &RadianceCascadesConfig) -> u64 {
    if config.voxel_backend != VoxelRayBackendMode::Naadf
        || config.voxel_backend_query_mask & NAADF_QUERY_GI_SECONDARY == 0
    {
        return 0;
    }
    config.cascade_count as u64 * config.rays_per_probe as u64
}

pub fn estimated_naadf_sun_visibility_rays_per_pixel(config: &RadianceCascadesConfig) -> u32 {
    if config.voxel_backend == VoxelRayBackendMode::Naadf
        && config.voxel_backend_query_mask & NAADF_QUERY_SUN_VISIBILITY != 0
    {
        1
    } else {
        0
    }
}

pub fn estimated_naadf_contact_shadow_rays_per_pixel(config: &RadianceCascadesConfig) -> u32 {
    if config.voxel_backend == VoxelRayBackendMode::Naadf
        && config.voxel_backend_query_mask & NAADF_QUERY_CONTACT_SHADOW != 0
    {
        1
    } else {
        0
    }
}

pub fn estimated_naadf_terrain_ao_rays_per_pixel(config: &RadianceCascadesConfig) -> u32 {
    if config.voxel_backend == VoxelRayBackendMode::Naadf
        && config.voxel_backend_query_mask & NAADF_QUERY_TERRAIN_AO != 0
    {
        4
    } else {
        0
    }
}

#[cfg_attr(not(feature = "naadf"), allow(dead_code))]
pub(crate) fn radiance_cascade_pass_active(config: &RadianceCascadesConfig) -> bool {
    config.enabled
        && config.voxel_backend == VoxelRayBackendMode::Naadf
        && config.voxel_backend_query_mask != 0
}

/// SDF volume data generation utilities
pub mod sdf_generation {
    use super::*;

    /// Generate SDF data on CPU (fallback for initialization)
    /// Returns raw bytes for R16Float texture
    pub fn generate_sdf_cpu(voxel_world: &VoxelWorld, config: &RadianceCascadesConfig) -> Vec<u8> {
        let res = config.sdf_resolution;
        let volume_size = config.sdf_world_max - config.sdf_world_min;

        let total_voxels = (res.x * res.y * res.z) as usize;
        let mut sdf_data = vec![0u8; total_voxels * 2]; // 2 bytes per f16

        for z in 0..res.z {
            for y in 0..res.y {
                for x in 0..res.x {
                    let uvw = Vec3::new(x as f32, y as f32, z as f32) / res.as_vec3();
                    let world_pos = config.sdf_world_min + uvw * volume_size;
                    let voxel_pos = world_pos.as_ivec3();

                    // Check if solid (non-air voxels)
                    let is_solid = voxel_world
                        .get_voxel(voxel_pos)
                        .map(|v| v != crate::voxel::types::VoxelType::Air)
                        .unwrap_or(false);

                    // Simple distance estimation
                    let dist = if is_solid { -1.0f32 } else { 1.0f32 };

                    // Convert f32 to f16 bytes (IEEE 754 half precision)
                    let f16_bits = f32_to_f16(dist);
                    let index = (x + y * res.x + z * res.x * res.y) as usize;
                    sdf_data[index * 2] = (f16_bits & 0xFF) as u8;
                    sdf_data[index * 2 + 1] = ((f16_bits >> 8) & 0xFF) as u8;
                }
            }
        }

        sdf_data
    }

    /// Convert f32 to f16 bits (simplified conversion)
    fn f32_to_f16(value: f32) -> u16 {
        let bits = value.to_bits();
        let sign = ((bits >> 16) & 0x8000) as u16;
        let exponent = ((bits >> 23) & 0xFF) as i32;
        let mantissa = bits & 0x7FFFFF;

        if exponent == 255 {
            // Inf or NaN
            return sign | 0x7C00 | ((mantissa != 0) as u16);
        }

        let new_exp = exponent - 127 + 15;

        if new_exp >= 31 {
            // Overflow to infinity
            return sign | 0x7C00;
        }

        if new_exp <= 0 {
            // Underflow to zero or denormal
            if new_exp < -10 {
                return sign;
            }
            let m = mantissa | 0x800000;
            let shift = 14 - new_exp;
            return sign | ((m >> shift) as u16);
        }

        sign | ((new_exp as u16) << 10) | ((mantissa >> 13) as u16)
    }

    /// World position to SDF volume index
    pub fn world_to_sdf_index(world_pos: Vec3, config: &RadianceCascadesConfig) -> Option<UVec3> {
        let volume_size = config.sdf_world_max - config.sdf_world_min;
        let uvw = (world_pos - config.sdf_world_min) / volume_size;

        if uvw.cmplt(Vec3::ZERO).any() || uvw.cmpge(Vec3::ONE).any() {
            return None;
        }

        Some((uvw * config.sdf_resolution.as_vec3()).as_uvec3())
    }
}

/// Debug visualization
pub mod debug {
    use super::*;

    pub fn draw_gi_debug_ui(
        ui: &mut bevy_egui::egui::Ui,
        config: &mut RadianceCascadesConfig,
        state: &SdfVolumeState,
    ) {
        ui.heading("Radiance Cascades GI");

        ui.checkbox(&mut config.enabled, "Enable GI");

        if config.enabled {
            ui.separator();

            ui.add(
                bevy_egui::egui::Slider::new(&mut config.gi_intensity, 0.0..=2.0)
                    .text("GI Intensity"),
            );
            ui.add(
                bevy_egui::egui::Slider::new(&mut config.bounce_intensity, 0.0..=1.0)
                    .text("Bounce Intensity"),
            );
            ui.add(
                bevy_egui::egui::Slider::new(&mut config.ao_strength, 0.0..=1.0)
                    .text("AO Strength"),
            );

            ui.separator();

            ui.add(
                bevy_egui::egui::Slider::new(&mut config.rays_per_probe, 4..=32).text("Rays/Probe"),
            );
            ui.add(
                bevy_egui::egui::Slider::new(&mut config.probe_spacing, 4.0..=16.0)
                    .text("Probe Spacing"),
            );
            ui.add(
                bevy_egui::egui::Slider::new(&mut config.temporal_blend, 0.8..=0.99)
                    .text("Temporal Blend"),
            );

            ui.separator();

            ui.label(format!("Frame: {}", state.frame_index));
            ui.label(format!("Dirty Chunks: {}", state.dirty_chunks.len()));
            ui.label(format!("SDF Initialized: {}", state.initialized));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mark_chunk_dirty_deduplicates_queue_entries() {
        let mut state = SdfVolumeState::default();
        let chunk = IVec3::new(2, 0, -4);

        mark_chunk_dirty(&mut state, chunk);
        mark_chunk_dirty(&mut state, chunk);

        assert_eq!(state.dirty_chunks.len(), 1);
        assert_eq!(state.dirty_chunks.front().copied(), Some(chunk));
    }

    #[test]
    fn processing_dirty_chunks_clears_membership_for_requeue() {
        let mut state = SdfVolumeState::default();
        let first = IVec3::new(1, 0, 0);
        let second = IVec3::new(2, 0, 0);

        mark_chunk_dirty(&mut state, first);
        mark_chunk_dirty(&mut state, second);

        assert_eq!(process_dirty_sdf_chunks(&mut state, 1), 1);
        assert_eq!(state.dirty_chunks.front().copied(), Some(second));

        mark_chunk_dirty(&mut state, first);

        assert_eq!(state.dirty_chunks.len(), 2);
        assert_eq!(state.dirty_chunks.back().copied(), Some(first));
    }

    #[test]
    fn backend_selection_without_runtime_naadf_proof_falls_back_and_resets_history() {
        let mut config = RadianceCascadesConfig::default();
        let mut state = SdfVolumeState {
            frame_index: 44,
            prev_view_proj: Mat4::from_scale(Vec3::splat(2.0)),
            ..default()
        };
        let settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Naadf,
            resolved_voxel_backend: VoxelRayBackendMode::Naadf,
            backend_switch_generation: 7,
            ..default()
        };

        apply_radiance_backend_selection(
            &settings,
            NAADF_QUERY_GI_SECONDARY,
            &mut config,
            &mut state,
        );

        assert_eq!(config.voxel_backend, VoxelRayBackendMode::CurrentSdf);
        assert_eq!(config.voxel_backend_query_mask, 0);
        assert_eq!(config.backend_switch_generation, 7);
        assert_eq!(state.frame_index, 0);
        assert_eq!(state.prev_view_proj, Mat4::IDENTITY);
        assert_eq!(state.history_reset_generation, 7);
    }

    #[test]
    fn current_with_naadf_gi_respects_fallback_backend() {
        let mut config = RadianceCascadesConfig::default();
        let mut state = SdfVolumeState::default();
        let settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Naadf,
            resolved_voxel_backend: VoxelRayBackendMode::CurrentSdf,
            experimental_mode: ExperimentalRenderMode::CurrentWithNaadfGi,
            fallback_reason: Some("NAADF cache warming; using CurrentSdf fallback".into()),
            ..default()
        };

        apply_radiance_backend_selection(
            &settings,
            NAADF_QUERY_GI_SECONDARY,
            &mut config,
            &mut state,
        );

        assert_eq!(config.voxel_backend, VoxelRayBackendMode::CurrentSdf);
        assert_eq!(config.voxel_backend_query_mask, 0);
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn naadf_dirty_chunks_reset_lighting_history_for_naadf_backend() {
        let config = RadianceCascadesConfig {
            voxel_backend: VoxelRayBackendMode::Naadf,
            ..default()
        };
        let mut state = SdfVolumeState {
            frame_index: 31,
            prev_view_proj: Mat4::from_scale(Vec3::splat(3.0)),
            last_naadf_dirty_queued_total: 4,
            ..default()
        };

        apply_naadf_dirty_history_invalidation(5, &config, &mut state);

        assert_eq!(state.frame_index, 0);
        assert_eq!(state.prev_view_proj, Mat4::IDENTITY);
        assert_eq!(state.naadf_dirty_history_generation, 1);
        assert_eq!(state.last_naadf_dirty_queued_total, 5);
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn current_sdf_dirty_bookmark_does_not_reset_lighting_history() {
        let config = RadianceCascadesConfig {
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            ..default()
        };
        let previous_view_proj = Mat4::from_scale(Vec3::splat(3.0));
        let mut state = SdfVolumeState {
            frame_index: 31,
            prev_view_proj: previous_view_proj,
            last_naadf_dirty_queued_total: 4,
            ..default()
        };

        apply_naadf_dirty_history_invalidation(5, &config, &mut state);

        assert_eq!(state.frame_index, 31);
        assert_eq!(state.prev_view_proj, previous_view_proj);
        assert_eq!(state.naadf_dirty_history_generation, 0);
        assert_eq!(state.last_naadf_dirty_queued_total, 5);
    }

    #[test]
    fn backend_selection_preserves_query_mask_when_shader_backend_is_available() {
        let mut config = RadianceCascadesConfig::default();
        let mut state = SdfVolumeState::default();
        let settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::Naadf,
            resolved_voxel_backend: VoxelRayBackendMode::Naadf,
            ..default()
        };
        let mask = NAADF_QUERY_GI_SECONDARY | NAADF_QUERY_SUN_VISIBILITY;

        apply_radiance_backend_selection_with_shader_support(
            &settings,
            mask,
            true,
            &mut config,
            &mut state,
        );

        assert_eq!(config.voxel_backend, VoxelRayBackendMode::Naadf);
        assert_eq!(config.voxel_backend_query_mask, mask);
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn naadf_query_mask_tracks_config_flags() {
        let config = NaadfConfig {
            use_for_gi_secondary: true,
            use_for_sun_visibility: true,
            use_for_terrain_ao: true,
            use_for_contact_shadows: false,
            ..default()
        };

        let mask = naadf_query_mask_from_config(&config);

        assert_ne!(mask & NAADF_QUERY_GI_SECONDARY, 0);
        assert_ne!(mask & NAADF_QUERY_SUN_VISIBILITY, 0);
        assert_ne!(mask & NAADF_QUERY_TERRAIN_AO, 0);
        assert_eq!(mask & NAADF_QUERY_CONTACT_SHADOW, 0);
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn default_naadf_config_keeps_path_a_queries_opt_in() {
        let config = NaadfConfig::default();

        assert_eq!(naadf_query_mask_from_config(&config), 0);
    }

    #[test]
    fn sdf_volume_update_is_skipped_only_when_naadf_covers_every_query() {
        let mut config = RadianceCascadesConfig::default();

        assert!(sdf_volume_update_needed(&config));

        config.voxel_backend = VoxelRayBackendMode::Naadf;
        config.voxel_backend_query_mask = NAADF_QUERY_ALL;
        assert!(!sdf_volume_update_needed(&config));

        config.voxel_backend_query_mask = NAADF_QUERY_ALL & !NAADF_QUERY_GI_SECONDARY;
        assert!(sdf_volume_update_needed(&config));

        config.voxel_backend = VoxelRayBackendMode::CurrentSdf;
        assert!(sdf_volume_update_needed(&config));

        config.enabled = false;
        assert!(!sdf_volume_update_needed(&config));
    }

    #[test]
    fn radiance_uniforms_include_backend_selection() {
        let mut config = RadianceCascadesConfig {
            voxel_backend: VoxelRayBackendMode::Naadf,
            voxel_backend_query_mask: NAADF_QUERY_GI_SECONDARY | NAADF_QUERY_TERRAIN_AO,
            backend_switch_generation: 9,
            ..default()
        };
        let state = SdfVolumeState::default();

        let uniforms = create_radiance_uniforms(
            &config,
            &state,
            Vec3::ZERO,
            Vec3::Y,
            Vec3::ONE,
            Mat4::IDENTITY,
        );

        assert_eq!(uniforms.voxel_backend, 1);
        assert_eq!(
            uniforms.voxel_backend_query_mask,
            NAADF_QUERY_GI_SECONDARY | NAADF_QUERY_TERRAIN_AO
        );
        assert_eq!(uniforms.backend_switch_generation, 9);

        config.voxel_backend = VoxelRayBackendMode::CurrentSdf;
        let uniforms = create_radiance_uniforms(
            &config,
            &state,
            Vec3::ZERO,
            Vec3::Y,
            Vec3::ONE,
            Mat4::IDENTITY,
        );
        assert_eq!(uniforms.voxel_backend, 0);
        assert_eq!(
            uniforms.voxel_backend_query_mask,
            NAADF_QUERY_GI_SECONDARY | NAADF_QUERY_TERRAIN_AO
        );
    }

    #[test]
    fn radiance_uniforms_include_naadf_chunk_counts() {
        let config = RadianceCascadesConfig::default();
        let state = SdfVolumeState::default();

        let uniforms = create_radiance_uniforms_with_naadf_counts(
            &config,
            &state,
            Vec3::ZERO,
            Vec3::Y,
            Vec3::ONE,
            Mat4::IDENTITY,
            UVec2::new(384, 282),
        );

        assert_eq!(uniforms.naadf_counts, UVec4::new(384, 282, 0, 0));
    }

    #[test]
    fn estimated_naadf_gi_rays_only_counts_naadf_backend() {
        let mut config = RadianceCascadesConfig {
            cascade_count: 4,
            rays_per_probe: 16,
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            voxel_backend_query_mask: NAADF_QUERY_GI_SECONDARY,
            ..default()
        };

        assert_eq!(estimated_naadf_gi_rays(&config), 0);

        config.voxel_backend = VoxelRayBackendMode::Naadf;
        assert_eq!(estimated_naadf_gi_rays(&config), 64);

        config.voxel_backend_query_mask = NAADF_QUERY_SUN_VISIBILITY;
        assert_eq!(estimated_naadf_gi_rays(&config), 0);
    }

    #[test]
    fn estimated_sun_visibility_rays_only_count_enabled_naadf_query() {
        let mut config = RadianceCascadesConfig {
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            voxel_backend_query_mask: NAADF_QUERY_SUN_VISIBILITY,
            ..default()
        };

        assert_eq!(estimated_naadf_sun_visibility_rays_per_pixel(&config), 0);

        config.voxel_backend = VoxelRayBackendMode::Naadf;
        assert_eq!(estimated_naadf_sun_visibility_rays_per_pixel(&config), 1);

        config.voxel_backend_query_mask = NAADF_QUERY_TERRAIN_AO;
        assert_eq!(estimated_naadf_sun_visibility_rays_per_pixel(&config), 0);
    }

    #[test]
    fn estimated_short_range_query_rays_only_count_enabled_naadf_queries() {
        let mut config = RadianceCascadesConfig {
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            voxel_backend_query_mask: NAADF_QUERY_CONTACT_SHADOW | NAADF_QUERY_TERRAIN_AO,
            ..default()
        };

        assert_eq!(estimated_naadf_contact_shadow_rays_per_pixel(&config), 0);
        assert_eq!(estimated_naadf_terrain_ao_rays_per_pixel(&config), 0);

        config.voxel_backend = VoxelRayBackendMode::Naadf;
        assert_eq!(estimated_naadf_contact_shadow_rays_per_pixel(&config), 1);
        assert_eq!(estimated_naadf_terrain_ao_rays_per_pixel(&config), 4);
        assert_eq!(
            estimated_naadf_contact_shadow_rays_per_pixel(&config)
                + estimated_naadf_terrain_ao_rays_per_pixel(&config),
            5
        );

        config.voxel_backend_query_mask = NAADF_QUERY_SUN_VISIBILITY;
        assert_eq!(estimated_naadf_contact_shadow_rays_per_pixel(&config), 0);
        assert_eq!(estimated_naadf_terrain_ao_rays_per_pixel(&config), 0);
    }

    #[test]
    fn radiance_cascade_pass_only_runs_when_a_naadf_query_is_enabled() {
        let mut config = RadianceCascadesConfig {
            enabled: true,
            voxel_backend: VoxelRayBackendMode::Naadf,
            voxel_backend_query_mask: 0,
            ..default()
        };

        assert!(!radiance_cascade_pass_active(&config));

        config.voxel_backend_query_mask = NAADF_QUERY_SUN_VISIBILITY;
        assert!(radiance_cascade_pass_active(&config));

        config.voxel_backend = VoxelRayBackendMode::CurrentSdf;
        assert!(!radiance_cascade_pass_active(&config));
    }

    #[test]
    fn radiance_shader_uses_bevy_reversed_z_and_flipped_ndc_y() {
        let shader = include_str!("../../../assets/shaders/radiance_cascades.wgsl");

        assert!(shader.contains("fn is_sky_depth"));
        assert!(shader.contains("return depth <= 0.001"));
        assert!(shader.contains("fn uv_to_ndc"));
        assert!(shader.contains("uv * vec2<f32>(2.0, -2.0) + vec2<f32>(-1.0, 1.0)"));
        assert!(!shader.contains("if depth >= 0.9999"));
        assert!(!shader.contains("if depth >= 1.0"));
    }

    #[test]
    fn radiance_shader_scrubs_final_alpha() {
        let shader = include_str!("../../../assets/shaders/radiance_cascades.wgsl");

        assert!(!shader.contains("return scene;"));
        assert!(!shader.contains("scene.a"));
        assert!(shader.contains("return vec4<f32>(scene.rgb, 1.0);"));
        assert!(
            shader.contains(
                "return vec4(scene.rgb * direct_shadow * ao_factor + secondary_gi, 1.0);"
            )
        );
    }

    #[test]
    fn radiance_pass_runs_before_weather_overlay() {
        let source = include_str!("radiance_cascades.rs");
        let compact = source.split_whitespace().collect::<Vec<_>>().join(" ");
        let old_order = ["WeatherOverlayLabel", "RadianceCascadesLabel"].join(", ");

        assert!(compact.contains("GodRaysLabel, RadianceCascadesLabel, WeatherOverlayLabel"));
        assert!(!compact.contains(&old_order));
    }

    #[test]
    fn active_radiance_pass_enables_depth_and_normal_prepass() {
        let mut app = App::new();
        let camera = app.world_mut().spawn(Camera3d::default()).id();
        app.insert_resource(RadianceCascadesConfig {
            enabled: true,
            voxel_backend: VoxelRayBackendMode::Naadf,
            voxel_backend_query_mask: NAADF_QUERY_SUN_VISIBILITY,
            ..default()
        });
        app.add_systems(Update, configure_radiance_cascade_camera_prepass);

        app.update();

        let world = app.world();
        assert!(world.get::<RadianceCascadesCamera>(camera).is_some());
        assert!(world.get::<DepthPrepass>(camera).is_some());
        assert!(world.get::<NormalPrepass>(camera).is_some());
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn radiance_naadf_bind_group_layout_declares_read_only_storage_buffers() {
        let entries = radiance_cascade_naadf_bind_group_layout_entries();
        let bindings: Vec<u32> = entries.iter().map(|entry| entry.binding).collect();

        assert_eq!(bindings, vec![0, 1, 5, 11, 20]);
        for entry in entries {
            assert!(entry.visibility.contains(ShaderStages::FRAGMENT));
            assert!(entry.visibility.contains(ShaderStages::COMPUTE));
            assert_eq!(entry.count, None);
            let BindingType::Buffer {
                ty,
                has_dynamic_offset,
                min_binding_size,
            } = entry.ty
            else {
                panic!("expected storage buffer binding");
            };
            assert_eq!(ty, BufferBindingType::Storage { read_only: true });
            assert!(!has_dynamic_offset);
            assert_eq!(min_binding_size, None);
        }
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn radiance_shader_routes_sun_visibility_to_naadf_world_trace() {
        let shader = include_str!("../../../assets/shaders/radiance_cascades.wgsl");

        assert!(shader.contains("fn soft_shadow_backend"));
        assert!(shader.contains("use_naadf_for_query(NAADF_QUERY_SUN_VISIBILITY)"));
        assert!(shader.contains("naadf_sun_visibility_world("));
        assert!(shader.contains("naadf_chunk_count()"));
        assert!(shader.contains("naadf_chunk_lookup_count()"));
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn radiance_shader_routes_phase5_queries_to_naadf_world_trace() {
        let shader = include_str!("../../../assets/shaders/radiance_cascades.wgsl");

        assert!(shader.contains("const NAADF_QUERY_CONTACT_SHADOW: u32 = 8u"));
        assert!(shader.contains("fn contact_shadow_backend"));
        assert!(shader.contains("use_naadf_for_query(NAADF_QUERY_CONTACT_SHADOW)"));
        assert!(shader.contains("naadf_contact_shadow_visibility_world("));
        assert!(shader.contains("fn terrain_ao_backend"));
        assert!(shader.contains("use_naadf_for_query(NAADF_QUERY_TERRAIN_AO)"));
        assert!(shader.contains("naadf_terrain_ao_visibility_world("));
        assert!(shader.contains("NAADF_CONTACT_SHADOW_DISTANCE"));
        assert!(shader.contains("NAADF_TERRAIN_AO_DISTANCE"));
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn radiance_shader_routes_gi_secondary_to_naadf_world_trace() {
        let shader = include_str!("../../../assets/shaders/radiance_cascades.wgsl");

        assert!(shader.contains("fn trace_naadf_gi"));
        assert!(shader.contains("trace_naadf_world("));
        assert!(shader.contains("naadf_world_surface_normal("));
        assert!(shader.contains("use_naadf_for_query(query_mask)"));
        assert!(shader.contains("return trace_naadf_gi(origin, direction, max_dist);"));
    }

    #[cfg(feature = "naadf")]
    #[test]
    fn naadf_gi_shader_backend_requires_runtime_gate_and_ready_gpu_cache() {
        let config = NaadfConfig {
            enabled: true,
            debug: crate::rendering::naadf::config::NaadfDebugConfig {
                allow_unverified_post_205: true,
                ..default()
            },
            ..default()
        };
        let cache_state = NaadfCacheState {
            ready: true,
            warming: false,
            fallback_reason: None,
        };
        let stats = NaadfStats {
            gpu_slots_used: 1,
            ..default()
        };

        assert!(naadf_gi_shader_backend_available(
            Some(&config),
            Some(&cache_state),
            Some(&stats)
        ));

        let blocked_config = NaadfConfig {
            enabled: true,
            ..default()
        };
        assert!(!naadf_gi_shader_backend_available(
            Some(&blocked_config),
            Some(&cache_state),
            Some(&stats)
        ));

        let pending_upload_stats = NaadfStats {
            gpu_slots_used: 1,
            gpu_uploads_pending: 1,
            ..default()
        };
        assert!(!naadf_gi_shader_backend_available(
            Some(&config),
            Some(&cache_state),
            Some(&pending_upload_stats)
        ));
    }
}
