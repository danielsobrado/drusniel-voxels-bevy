//! Radiance Cascades Global Illumination
//!
//! Screen-space radiance cascades leveraging voxel SDF for efficient GI.
//! Based on Alexander Sannikov's Radiance Cascades technique.

use bevy::asset::RenderAssetUsages;
#[cfg(feature = "naadf")]
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::render_resource::*;
use std::collections::{HashSet, VecDeque};

#[cfg(feature = "naadf")]
use crate::performance::AreaTimingRecorder;
#[cfg(feature = "naadf")]
use crate::rendering::naadf::NaadfStats;
use crate::rendering::ray_tracing::{
    ExperimentalRenderMode, RayTracingSettings, VoxelRayBackendMode,
};
use crate::voxel::world::VoxelWorld;

/// Plugin for Radiance Cascades global illumination
pub struct RadianceCascadesPlugin;

impl Plugin for RadianceCascadesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<RadianceCascadesConfig>()
            .init_resource::<SdfVolumeState>()
            .add_systems(Startup, setup_radiance_cascades)
            .add_systems(
                Update,
                (
                    sync_radiance_cascades_voxel_backend,
                    update_sdf_volume,
                    update_cascade_params,
                )
                    .chain(),
            );
        #[cfg(feature = "naadf")]
        app.add_systems(Update, record_naadf_gi_counters);

        // Render app systems would go here for full implementation
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
        }
    }
}

pub fn sync_radiance_cascades_voxel_backend(
    ray_tracing: Res<RayTracingSettings>,
    mut config: ResMut<RadianceCascadesConfig>,
    mut state: ResMut<SdfVolumeState>,
) {
    apply_radiance_backend_selection(&ray_tracing, &mut config, &mut state);
}

pub fn apply_radiance_backend_selection(
    ray_tracing: &RayTracingSettings,
    config: &mut RadianceCascadesConfig,
    state: &mut SdfVolumeState,
) {
    let target_backend = match ray_tracing.experimental_mode {
        ExperimentalRenderMode::Current => ray_tracing.effective_backend(),
        ExperimentalRenderMode::CurrentWithNaadfGi | ExperimentalRenderMode::NaadfPreview => {
            VoxelRayBackendMode::Naadf
        }
    };

    config.voxel_backend = target_backend;

    if config.backend_switch_generation != ray_tracing.backend_switch_generation {
        config.backend_switch_generation = ray_tracing.backend_switch_generation;
        if ray_tracing.reset_history_on_backend_switch {
            state.frame_index = 0;
            state.prev_view_proj = Mat4::IDENTITY;
            state.history_reset_generation = ray_tracing.backend_switch_generation;
        }
    }
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
    pub _padding5: f32,

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
        _padding5: 0.0,

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
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Res<FrameCount>,
) {
    let gi_rays = estimated_naadf_gi_rays(&config);
    if let Some(stats) = naadf_stats.as_deref_mut() {
        stats.gi_rays_last_frame = gi_rays;
    }

    let Some(timing) = timing.as_deref_mut() else {
        return;
    };
    let Some(stats) = naadf_stats.as_deref() else {
        return;
    };

    timing.record_count(
        frame.0,
        "naadf.gpu_memory_bytes",
        stats.gpu_memory_bytes as f64,
    );
    timing.record_count(frame.0, "naadf.chunks_resident", stats.loaded_chunks as f64);
    timing.record_count(
        frame.0,
        "naadf.dirty_chunks_pending",
        stats.dirty_pending as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.gpu_build_queue_oldest_age_frames",
        stats.gpu_build_queue_oldest_age_frames as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.uploaded_chunks_last_frame",
        stats.gpu_uploaded_chunks_last_frame as f64,
    );
    timing.record_count(
        frame.0,
        "naadf.avg_ray_steps_last_frame",
        stats.gpu_avg_ray_steps_last_frame as f64,
    );
    timing.record_count(frame.0, "naadf.gi_rays_last_frame", gi_rays as f64);
}

pub fn estimated_naadf_gi_rays(config: &RadianceCascadesConfig) -> u64 {
    if config.voxel_backend != VoxelRayBackendMode::Naadf {
        return 0;
    }
    config.cascade_count as u64 * config.rays_per_probe as u64
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
    fn backend_selection_mirrors_ray_tracing_and_resets_history() {
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

        apply_radiance_backend_selection(&settings, &mut config, &mut state);

        assert_eq!(config.voxel_backend, VoxelRayBackendMode::Naadf);
        assert_eq!(config.backend_switch_generation, 7);
        assert_eq!(state.frame_index, 0);
        assert_eq!(state.prev_view_proj, Mat4::IDENTITY);
        assert_eq!(state.history_reset_generation, 7);
    }

    #[test]
    fn current_with_naadf_gi_forces_naadf_backend() {
        let mut config = RadianceCascadesConfig::default();
        let mut state = SdfVolumeState::default();
        let settings = RayTracingSettings {
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            experimental_mode: ExperimentalRenderMode::CurrentWithNaadfGi,
            ..default()
        };

        apply_radiance_backend_selection(&settings, &mut config, &mut state);

        assert_eq!(config.voxel_backend, VoxelRayBackendMode::Naadf);
    }

    #[test]
    fn radiance_uniforms_include_backend_selection() {
        let mut config = RadianceCascadesConfig {
            voxel_backend: VoxelRayBackendMode::Naadf,
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
    }

    #[test]
    fn estimated_naadf_gi_rays_only_counts_naadf_backend() {
        let mut config = RadianceCascadesConfig {
            cascade_count: 4,
            rays_per_probe: 16,
            voxel_backend: VoxelRayBackendMode::CurrentSdf,
            ..default()
        };

        assert_eq!(estimated_naadf_gi_rays(&config), 0);

        config.voxel_backend = VoxelRayBackendMode::Naadf;
        assert_eq!(estimated_naadf_gi_rays(&config), 64);
    }
}
