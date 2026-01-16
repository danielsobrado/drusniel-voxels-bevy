//! XeGTAO - Ground Truth Ambient Occlusion
//!
//! Based on Intel's XeGTAO: https://github.com/GameTechDev/XeGTAO
//! Provides high-quality ambient occlusion with bent normals output.
//!
//! Pipeline stages:
//! 1. Prepass: Render depth + normals to texture
//! 2. Main GTAO: Compute occlusion with horizon-based algorithm
//! 3. Denoise: Spatial-temporal filtering for smooth results

use bevy::prelude::*;
use bevy::render::renderer::RenderAdapterInfo;
use bevy::render::{
    extract_component::{ExtractComponent, ExtractComponentPlugin},
    render_resource::*,
    render_graph::{NodeRunError, RenderGraphContext, RenderLabel, ViewNode},
    renderer::RenderDevice,
    texture::{CachedTexture, TextureCache},
    view::{ViewTarget, ViewUniformOffset},
    Render, RenderApp, RenderSystems,
};
use bevy::core_pipeline::prepass::{DepthPrepass, NormalPrepass};
use wgpu::DeviceType;
use std::num::NonZeroU64;

use crate::rendering::ao_config::{AmbientOcclusionConfig, load_ambient_occlusion_config};

/// GTAO Plugin - Adds Ground Truth Ambient Occlusion to the render pipeline
pub struct GtaoPlugin;

impl Plugin for GtaoPlugin {
    fn build(&self, app: &mut App) {
        let config = load_ambient_occlusion_config().unwrap_or_else(|e| {
            warn!("Failed to load AO config: {}, using defaults", e);
            AmbientOcclusionConfig::default()
        });

        app.insert_resource(config)
            .init_resource::<GtaoSupported>()
            .add_plugins(ExtractComponentPlugin::<GtaoSettings>::default())
            .add_systems(Startup, detect_gtao_support)
            .add_systems(PostStartup, configure_camera_gtao);

        // Register systems in RenderApp (resources initialized in finish())
        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app
                .add_systems(Render, prepare_gtao_textures.in_set(RenderSystems::PrepareResources));
        }
    }

    fn finish(&self, app: &mut App) {
        // Initialize GPU resources after RenderDevice is available
        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app
                .init_resource::<GtaoShaders>()
                .init_resource::<GtaoPipelines>()
                .init_resource::<GtaoMainPipeline>()
                .init_resource::<SpecializedRenderPipelines<GtaoMainPipeline>>();
        }
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
    /// Number of slices (directions) to sample - 2 or 3 recommended
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
    /// Mip offset for sampling far depth
    pub depth_mip_sampling_offset: f32,
    /// Enable temporal denoising
    pub enable_denoise: bool,
    /// Spatial filter radius
    pub denoise_spatial_radius: u32,
    /// Temporal blend factor (0-1)
    pub denoise_temporal_blend: f32,
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
            depth_mip_sampling_offset: 1.0,
            enable_denoise: true,
            denoise_spatial_radius: 2,
            denoise_temporal_blend: 0.95,
        }
    }
}

/// GPU uniform buffer for GTAO settings
#[derive(Clone, Copy)]
#[repr(C)]
pub struct GtaoSettingsUniform {
    pub slice_count: u32,
    pub steps_per_slice: u32,
    pub radius: f32,
    pub falloff_range: f32,
    pub final_value_power: f32,
    pub sample_distribution_power: f32,
    pub thin_occluder_compensation: f32,
    pub depth_mip_sampling_offset: f32,
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
            depth_mip_sampling_offset: settings.depth_mip_sampling_offset,
        }
    }
}

/// GPU uniform buffer for denoise settings
#[derive(Clone, Copy)]
#[repr(C)]
pub struct DenoiseSettingsUniform {
    pub spatial_radius: u32,
    pub spatial_sigma: f32,
    pub temporal_blend: f32,
    pub depth_threshold: f32,
    pub normal_threshold: f32,
    pub _padding: [f32; 3],
}

impl DenoiseSettingsUniform {
    pub const SIZE: u64 = std::mem::size_of::<Self>() as u64;

    pub fn min_size() -> NonZeroU64 {
        NonZeroU64::new(Self::SIZE).unwrap()
    }
}

impl From<&GtaoSettings> for DenoiseSettingsUniform {
    fn from(settings: &GtaoSettings) -> Self {
        Self {
            spatial_radius: settings.denoise_spatial_radius,
            spatial_sigma: settings.denoise_spatial_radius as f32,
            temporal_blend: settings.denoise_temporal_blend,
            depth_threshold: 0.01,
            normal_threshold: 0.1,
            _padding: [0.0, 0.0, 0.0],
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

    if config.ssao.disable_on_integrated_gpu && is_integrated {
        supported.0 = false;
        warn!("GTAO disabled: Integrated GPU detected ({})", adapter_name);
        return;
    }

    supported.0 = config.ssao.enabled;
    info!("GTAO support: {} (GPU: {})", supported.0, adapter_name);
}

/// Returns GTAO settings based on quality configuration
pub fn gtao_camera_components(
    config: &AmbientOcclusionConfig,
    supported: &GtaoSupported,
) -> Option<GtaoSettings> {
    if !supported.0 || !config.ssao.enabled {
        return None;
    }

    let settings = match config.ssao.quality.to_lowercase().as_str() {
        "low" => GtaoSettings {
            slice_count: 2,
            steps_per_slice: 2,
            radius: 1.5,
            enable_denoise: false,
            ..default()
        },
        "medium" => GtaoSettings {
            slice_count: 2,
            steps_per_slice: 3,
            radius: 2.0,
            enable_denoise: true,
            denoise_spatial_radius: 1,
            ..default()
        },
        "high" => GtaoSettings {
            slice_count: 3,
            steps_per_slice: 3,
            radius: 2.5,
            ..default()
        },
        "ultra" => GtaoSettings {
            slice_count: 4,
            steps_per_slice: 4,
            radius: 3.0,
            denoise_spatial_radius: 3,
            ..default()
        },
        _ => GtaoSettings::default(),
    };

    Some(settings)
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
            // GTAO requires depth and normal prepasses
            commands.entity(entity).insert((
                gtao,
                DepthPrepass,
                NormalPrepass,
            ));
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
                commands.entity(entity).insert((
                    gtao,
                    DepthPrepass,
                    NormalPrepass,
                ));
            }
        } else if !enable && existing.is_some() {
            commands.entity(entity).remove::<GtaoSettings>();
        }
    }
}

// ============================================================================
// GPU Pipeline Resources
// ============================================================================

/// Holds the GTAO render pipelines
#[derive(Resource)]
pub struct GtaoPipelines {
    /// Bind group layout for GTAO main pass
    pub main_layout: BindGroupLayout,
    /// Bind group layout for denoise pass
    pub denoise_layout: BindGroupLayout,
    /// Sampler for textures
    pub sampler: Sampler,
    /// Linear sampler for filtering
    pub linear_sampler: Sampler,
}

impl FromWorld for GtaoPipelines {
    fn from_world(world: &mut World) -> Self {
        let render_device = world.resource::<RenderDevice>();

        // Main GTAO pass bind group layout
        let main_layout = render_device.create_bind_group_layout(
            "gtao_main_bind_group_layout",
            &[
                // Depth-normal texture
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Depth-normal sampler
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                // Noise texture
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Noise sampler
                BindGroupLayoutEntry {
                    binding: 3,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                // GTAO settings uniform
                BindGroupLayoutEntry {
                    binding: 4,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: Some(GtaoSettingsUniform::min_size()),
                    },
                    count: None,
                },
                // View uniforms
                BindGroupLayoutEntry {
                    binding: 5,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: true,
                        min_binding_size: None, // View uniform size varies by implementation
                    },
                    count: None,
                },
            ],
        );

        // Denoise pass bind group layout
        let denoise_layout = render_device.create_bind_group_layout(
            "gtao_denoise_bind_group_layout",
            &[
                // Current AO texture
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Current AO sampler
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                // History AO texture
                BindGroupLayoutEntry {
                    binding: 2,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Float { filterable: true },
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // History AO sampler
                BindGroupLayoutEntry {
                    binding: 3,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                // Depth texture
                BindGroupLayoutEntry {
                    binding: 4,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Depth,
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                // Depth sampler
                BindGroupLayoutEntry {
                    binding: 5,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::Filtering),
                    count: None,
                },
                // Denoise settings uniform
                BindGroupLayoutEntry {
                    binding: 6,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Buffer {
                        ty: BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: Some(DenoiseSettingsUniform::min_size()),
                    },
                    count: None,
                },
            ],
        );

        // Create samplers
        let sampler = render_device.create_sampler(&SamplerDescriptor {
            label: Some("gtao_sampler"),
            address_mode_u: AddressMode::ClampToEdge,
            address_mode_v: AddressMode::ClampToEdge,
            mag_filter: FilterMode::Nearest,
            min_filter: FilterMode::Nearest,
            ..default()
        });

        let linear_sampler = render_device.create_sampler(&SamplerDescriptor {
            label: Some("gtao_linear_sampler"),
            address_mode_u: AddressMode::ClampToEdge,
            address_mode_v: AddressMode::ClampToEdge,
            mag_filter: FilterMode::Linear,
            min_filter: FilterMode::Linear,
            ..default()
        });

        Self {
            main_layout,
            denoise_layout,
            sampler,
            linear_sampler,
        }
    }
}

/// Pipeline key for specialization
#[derive(Clone, Copy, Hash, PartialEq, Eq)]
pub struct GtaoMainPipelineKey {
    pub hdr: bool,
}

/// Main GTAO pipeline definition
#[derive(Resource)]
pub struct GtaoMainPipeline {
    pub layout: BindGroupLayout,
    pub shader: Handle<Shader>,
}

impl FromWorld for GtaoMainPipeline {
    fn from_world(world: &mut World) -> Self {
        let pipelines = world.resource::<GtaoPipelines>();
        let shaders = world.resource::<GtaoShaders>();
        Self {
            layout: pipelines.main_layout.clone(),
            shader: shaders.main_shader.clone(),
        }
    }
}

impl SpecializedRenderPipeline for GtaoMainPipeline {
    type Key = GtaoMainPipelineKey;

    fn specialize(&self, key: Self::Key) -> RenderPipelineDescriptor {
        let format = if key.hdr {
            TextureFormat::Rgba16Float
        } else {
            TextureFormat::Rgba8Unorm
        };

        // Fullscreen vertex state - draws a fullscreen triangle
        // The vertex shader generates positions based on vertex index
        let vertex_state = VertexState {
            shader: self.shader.clone(),
            shader_defs: vec![],
            entry_point: Some("vertex".into()),
            buffers: vec![],
        };

        RenderPipelineDescriptor {
            label: Some("gtao_main_pipeline".into()),
            layout: vec![self.layout.clone()],
            push_constant_ranges: vec![],
            vertex: vertex_state,
            primitive: PrimitiveState::default(),
            depth_stencil: None,
            multisample: MultisampleState::default(),
            fragment: Some(FragmentState {
                shader: self.shader.clone(),
                shader_defs: vec![],
                entry_point: Some("fragment".into()),
                targets: vec![Some(ColorTargetState {
                    format,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                })],
            }),
            zero_initialize_workgroup_memory: false,
        }
    }
}

/// Shader handles loaded at runtime
#[derive(Resource)]
pub struct GtaoShaders {
    pub main_shader: Handle<Shader>,
    pub denoise_shader: Handle<Shader>,
}

impl FromWorld for GtaoShaders {
    fn from_world(world: &mut World) -> Self {
        let asset_server = world.resource::<AssetServer>();
        Self {
            main_shader: asset_server.load("shaders/gtao_main.wgsl"),
            denoise_shader: asset_server.load("shaders/gtao_denoise.wgsl"),
        }
    }
}

/// Per-view GTAO textures
#[derive(Component)]
pub struct GtaoTextures {
    pub ao_texture: CachedTexture,
    pub history_texture: CachedTexture,
}

/// System to prepare GTAO textures for each view
fn prepare_gtao_textures(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    mut texture_cache: ResMut<TextureCache>,
    views: Query<(Entity, &ViewTarget, &GtaoSettings)>,
) {
    for (entity, view_target, _settings) in views.iter() {
        let size = view_target.main_texture().size();

        let ao_texture = texture_cache.get(
            &render_device,
            TextureDescriptor {
                label: Some("gtao_ao_texture"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: TextureDimension::D2,
                format: TextureFormat::Rgba16Float,
                usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
        );

        let history_texture = texture_cache.get(
            &render_device,
            TextureDescriptor {
                label: Some("gtao_history_texture"),
                size,
                mip_level_count: 1,
                sample_count: 1,
                dimension: TextureDimension::D2,
                format: TextureFormat::Rgba16Float,
                usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::TEXTURE_BINDING,
                view_formats: &[],
            },
        );

        commands.entity(entity).insert(GtaoTextures {
            ao_texture,
            history_texture,
        });
    }
}

// ============================================================================
// Render Graph Node
// ============================================================================

/// Render graph label for GTAO
#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct GtaoLabel;

/// GTAO render graph node
///
/// Note: Full render graph integration requires additional setup.
/// This is a placeholder that will be expanded when the render graph
/// integration is complete.
#[derive(Default)]
pub struct GtaoNode;

impl ViewNode for GtaoNode {
    type ViewQuery = (
        &'static ViewTarget,
        &'static GtaoSettings,
        &'static GtaoTextures,
        &'static ViewUniformOffset,
    );

    fn run(
        &self,
        _graph: &mut RenderGraphContext,
        _render_context: &mut bevy::render::renderer::RenderContext,
        (_view_target, _settings, _textures, _view_offset): bevy::ecs::query::QueryItem<Self::ViewQuery>,
        _world: &World,
    ) -> Result<(), NodeRunError> {
        // GTAO implementation stub
        //
        // Full implementation requires:
        // 1. Get depth and normal textures from prepass
        // 2. Create bind groups with textures and uniforms
        // 3. Run main GTAO pass (horizon-based AO calculation)
        // 4. Run denoise pass (spatial-temporal filtering)
        // 5. Output AO texture for compositing
        //
        // The GTAO algorithm samples the depth buffer in multiple directions
        // to estimate ambient occlusion at each pixel. The denoise pass
        // applies temporal accumulation and spatial filtering to reduce noise.

        Ok(())
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Get the current AO texture for a view (for compositing)
pub fn get_gtao_texture(textures: &GtaoTextures) -> &CachedTexture {
    &textures.ao_texture
}
