use bevy::asset::RenderAssetUsages;
use bevy::diagnostic::FrameCount;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;
use bevy_mesh::{Indices, PrimitiveTopology};
use serde::Deserialize;
use std::cmp::Ordering;

use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE_I32, WATER_LEVEL};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::device::capabilities::GraphicsCapabilities;
use crate::rendering::water_ownership::{WaterOwnerMarker, WaterSurfaceOwner};
use crate::voxel::world::VoxelWorld;

const WATER_CONFIG_PATH: &str = "assets/config/water.yaml";
const DEFAULT_LEVELS: u32 = 6;
const DEFAULT_CELLS_PER_LEVEL: u32 = 64;
const DEFAULT_BASE_CELL_SIZE: f32 = 1.0;
const DEFAULT_MAX_DISTANCE: f32 = 4000.0;
const DEFAULT_MIN_BODY_AREA: f32 = 2048.0;
const DEFAULT_DEEP_OCEAN_START_OUTSIDE_BORDER_M: f32 = 64.0;
const DEFAULT_DEEP_OCEAN_VISUAL_EXTENT_M: f32 = 4096.0;
const DEFAULT_DEEP_OCEAN_SUBDIVISIONS: u32 = 256;
const DEEP_OCEAN_SPECTRUM_SEED: i32 = 12345;
const DEEP_OCEAN_SWELLS: [DeepOceanSwell; 6] = [
    DeepOceanSwell {
        dx: 0.90,
        dz: 0.44,
        wavelength: 120.0,
        steepness: 0.18,
        speed_scale: 0.88,
    },
    DeepOceanSwell {
        dx: -0.30,
        dz: 0.95,
        wavelength: 80.0,
        steepness: 0.13,
        speed_scale: 1.05,
    },
    DeepOceanSwell {
        dx: 0.60,
        dz: -0.80,
        wavelength: 200.0,
        steepness: 0.10,
        speed_scale: 0.72,
    },
    DeepOceanSwell {
        dx: 0.70,
        dz: 0.70,
        wavelength: 400.0,
        steepness: 0.06,
        speed_scale: 0.55,
    },
    DeepOceanSwell {
        dx: -0.50,
        dz: 0.86,
        wavelength: 600.0,
        steepness: 0.04,
        speed_scale: 0.45,
    },
    DeepOceanSwell {
        dx: 0.40,
        dz: 0.92,
        wavelength: 55.0,
        steepness: 0.12,
        speed_scale: 1.25,
    },
];

#[derive(Resource, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct WaterRendererConfig {
    pub near_voxel_meshes_enabled: bool,
    pub clipmap_enabled: bool,
    pub clipmap_min_body_area: f32,
    pub clipmap_max_distance: f32,
}

impl Default for WaterRendererConfig {
    fn default() -> Self {
        Self {
            near_voxel_meshes_enabled: true,
            clipmap_enabled: false,
            clipmap_min_body_area: DEFAULT_MIN_BODY_AREA,
            clipmap_max_distance: DEFAULT_MAX_DISTANCE,
        }
    }
}

#[derive(Resource, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct WaterClipmapConfig {
    pub enabled: bool,
    pub levels: u32,
    pub cells_per_level: u32,
    pub base_cell_size: f32,
    pub max_distance: f32,
    pub min_body_area: f32,
    pub debug_visible: bool,
}

impl Default for WaterClipmapConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            levels: DEFAULT_LEVELS,
            cells_per_level: DEFAULT_CELLS_PER_LEVEL,
            base_cell_size: DEFAULT_BASE_CELL_SIZE,
            max_distance: DEFAULT_MAX_DISTANCE,
            min_body_area: DEFAULT_MIN_BODY_AREA,
            debug_visible: false,
        }
    }
}

impl WaterClipmapConfig {
    pub fn sanitized(mut self) -> Self {
        self.levels = self.levels.clamp(1, 12);
        self.cells_per_level = self.cells_per_level.max(4);
        self.base_cell_size = self.base_cell_size.max(0.25);
        self.max_distance = self.max_distance.max(self.base_cell_size);
        self.min_body_area = self.min_body_area.max(0.0);
        self
    }

    pub fn load_or_default() -> (WaterRendererConfig, Self, DeepOceanConfig) {
        match std::fs::read_to_string(WATER_CONFIG_PATH) {
            Ok(config_str) => match serde_yaml::from_str::<WaterClipmapFileConfig>(&config_str) {
                Ok(file_config) => (
                    file_config.renderer,
                    file_config.clipmap.sanitized(),
                    file_config.deep_ocean.sanitized(),
                ),
                Err(error) => {
                    warn!("Failed to parse water clipmap config: {error}; using defaults");
                    (
                        WaterRendererConfig::default(),
                        Self::default(),
                        DeepOceanConfig::default(),
                    )
                }
            },
            Err(error) => {
                warn!("Failed to read {WATER_CONFIG_PATH}: {error}; using water clipmap defaults");
                (
                    WaterRendererConfig::default(),
                    Self::default(),
                    DeepOceanConfig::default(),
                )
            }
        }
    }

    pub fn effective_enabled(&self, renderer: &WaterRendererConfig) -> bool {
        self.enabled && renderer.clipmap_enabled
    }

    pub fn placeholder_triangle_count(&self) -> u32 {
        // Each future grid cell resolves to two triangles. Placeholder entities
        // use the same accounting so bench rows stay comparable when meshes land.
        self.levels
            .saturating_mul(self.cells_per_level)
            .saturating_mul(self.cells_per_level)
            .saturating_mul(2)
    }
}

#[derive(Resource, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct DeepOceanConfig {
    pub enabled: bool,
    pub start_outside_border_m: f32,
    pub visual_extent_m: f32,
    pub subdivisions: u32,
    pub surface_y: f32,
    pub wave: DeepOceanWaveConfig,
    pub shading: DeepOceanShadingConfig,
}

impl Default for DeepOceanConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            start_outside_border_m: DEFAULT_DEEP_OCEAN_START_OUTSIDE_BORDER_M,
            visual_extent_m: DEFAULT_DEEP_OCEAN_VISUAL_EXTENT_M,
            subdivisions: DEFAULT_DEEP_OCEAN_SUBDIVISIONS,
            surface_y: WATER_LEVEL as f32,
            wave: DeepOceanWaveConfig::default(),
            shading: DeepOceanShadingConfig::default(),
        }
    }
}

impl DeepOceanConfig {
    pub fn sanitized(mut self) -> Self {
        self.start_outside_border_m = self.start_outside_border_m.max(1.0);
        self.visual_extent_m = self.visual_extent_m.max(self.start_outside_border_m);
        self.subdivisions = self.subdivisions.clamp(4, DEFAULT_DEEP_OCEAN_SUBDIVISIONS);
        self.wave = self.wave.sanitized();
        self.shading = self.shading.sanitized();
        self
    }
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(default)]
pub struct DeepOceanWaveConfig {
    pub gravity: f32,
    pub grid_k: u32,
    pub active_gpu_waves: u32,
    pub wind_speed: f32,
    pub wind_direction_deg: f32,
    pub height_scale: f32,
    pub choppiness: f32,
    pub coarse_patch_m: f32,
    pub fine_patch_m: f32,
    pub foam_threshold: f32,
    pub foam_power: f32,
    pub foam_intensity: f32,
    pub swell_height_scale: f32,
}

impl Default for DeepOceanWaveConfig {
    fn default() -> Self {
        Self {
            gravity: 9.81,
            grid_k: 16,
            active_gpu_waves: 48,
            wind_speed: 14.0,
            wind_direction_deg: 45.0,
            height_scale: 1.3,
            choppiness: 1.6,
            coarse_patch_m: 250.0,
            fine_patch_m: 37.0,
            foam_threshold: 0.5,
            foam_power: 1.36,
            foam_intensity: 1.25,
            swell_height_scale: 0.34,
        }
    }
}

impl DeepOceanWaveConfig {
    fn sanitized(mut self) -> Self {
        self.gravity = self.gravity.max(0.01);
        self.grid_k = self.grid_k.clamp(1, 64);
        self.active_gpu_waves = self.active_gpu_waves.min(128);
        self.wind_speed = self.wind_speed.max(0.0);
        self.height_scale = self.height_scale.max(0.0);
        self.choppiness = self.choppiness.max(0.0);
        self.coarse_patch_m = self.coarse_patch_m.max(1.0);
        self.fine_patch_m = self.fine_patch_m.max(1.0);
        self.foam_threshold = self.foam_threshold.max(0.0);
        self.foam_power = self.foam_power.max(0.01);
        self.foam_intensity = self.foam_intensity.max(0.0);
        self.swell_height_scale = self.swell_height_scale.max(0.0);
        self
    }
}

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(default)]
pub struct DeepOceanShadingConfig {
    pub deep_color: [f32; 4],
    pub shallow_color: [f32; 4],
    pub foam_color: [f32; 4],
    pub fresnel_power: f32,
    pub fresnel_strength: f32,
    pub reflection_strength: f32,
    pub reflection_distortion: f32,
    pub roughness: f32,
    pub fog_color: [f32; 4],
    pub fog_near_m: f32,
    pub fog_far_m: f32,
    pub fog_density: f32,
}

impl Default for DeepOceanShadingConfig {
    fn default() -> Self {
        Self {
            deep_color: [0.016, 0.173, 0.306, 1.0],
            shallow_color: [0.039, 0.361, 0.353, 1.0],
            foam_color: [1.0, 1.0, 1.0, 1.0],
            fresnel_power: 4.5,
            fresnel_strength: 0.75,
            reflection_strength: 0.46,
            reflection_distortion: 0.04,
            roughness: 0.08,
            fog_color: [0.278, 0.38, 0.427, 1.0],
            fog_near_m: 100.0,
            fog_far_m: 1800.0,
            fog_density: 0.5,
        }
    }
}

impl DeepOceanShadingConfig {
    fn sanitized(mut self) -> Self {
        sanitize_color(&mut self.deep_color);
        sanitize_color(&mut self.shallow_color);
        sanitize_color(&mut self.foam_color);
        sanitize_color(&mut self.fog_color);
        self.fresnel_power = self.fresnel_power.max(0.01);
        self.fresnel_strength = self.fresnel_strength.max(0.0);
        self.reflection_strength = self.reflection_strength.clamp(0.0, 1.0);
        self.reflection_distortion = self.reflection_distortion.max(0.0);
        self.roughness = self.roughness.clamp(0.0, 1.0);
        self.fog_near_m = self.fog_near_m.max(0.0);
        self.fog_far_m = self.fog_far_m.max(self.fog_near_m + 1.0);
        self.fog_density = self.fog_density.max(0.0);
        self
    }
}

fn sanitize_color(rgba: &mut [f32; 4]) {
    for channel in rgba {
        *channel = channel.clamp(0.0, 1.0);
    }
}

#[derive(Deserialize, Default)]
#[serde(default)]
struct WaterClipmapFileConfig {
    renderer: WaterRendererConfig,
    clipmap: WaterClipmapConfig,
    deep_ocean: DeepOceanConfig,
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct WaterClipmapOrigin {
    pub snapped_xz: Vec2,
    pub cell_size: f32,
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct WaterClipmapStatus {
    pub enabled: bool,
    pub force_disabled_integrated_gpu: bool,
    pub levels: u32,
    pub mesh_count: u32,
    pub origin: Vec2,
}

#[derive(Resource, Clone, Copy, Debug, Default)]
pub struct DeepOceanStatus {
    pub enabled: bool,
    pub mesh_present: bool,
    pub vertices: u32,
    pub triangles: u32,
    pub draw_calls: u32,
    pub transition_gap_vertices: u32,
    pub world_extent: Vec2,
    pub surface_y: f32,
    pub active_cpu_waves: u32,
    pub cpu_animation_vertices: u32,
}

#[derive(Component)]
pub struct WaterClipmapLevel {
    pub level: u32,
}

#[derive(Component)]
pub struct DeepOceanSurface {
    pub base_positions: Vec<[f32; 3]>,
    pub vertices: u32,
    pub triangles: u32,
    pub transition_gap_vertices: u32,
    pub world_extent: Vec2,
    pub start_outside_border_m: f32,
    pub visual_extent_m: f32,
    pub subdivisions: u32,
    pub surface_y: f32,
}

pub struct WaterClipmapPlugin;

impl Plugin for WaterClipmapPlugin {
    fn build(&self, app: &mut App) {
        let (renderer_config, clipmap_config, deep_ocean_config) =
            WaterClipmapConfig::load_or_default();
        app.insert_resource(renderer_config)
            .insert_resource(clipmap_config)
            .insert_resource(deep_ocean_config)
            .init_resource::<WaterClipmapOrigin>()
            .init_resource::<WaterClipmapStatus>()
            .init_resource::<DeepOceanStatus>()
            .add_systems(
                Update,
                (
                    sync_clipmap_origin,
                    sync_clipmap_placeholders,
                    sync_deep_ocean_surface,
                    animate_deep_ocean_surface,
                )
                    .chain(),
            );
    }
}

fn sync_clipmap_origin(
    config: Res<WaterClipmapConfig>,
    camera: Query<&Transform, With<PlayerCamera>>,
    mut origin: ResMut<WaterClipmapOrigin>,
) {
    let Ok(camera_transform) = camera.single() else {
        return;
    };

    let cell_size = config.base_cell_size;
    let camera_xz = Vec2::new(
        camera_transform.translation.x,
        camera_transform.translation.z,
    );
    origin.snapped_xz = (camera_xz / cell_size).round() * cell_size;
    origin.cell_size = cell_size;
}

fn sync_clipmap_placeholders(
    mut commands: Commands,
    renderer_config: Res<WaterRendererConfig>,
    config: Res<WaterClipmapConfig>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    origin: Res<WaterClipmapOrigin>,
    mut status: ResMut<WaterClipmapStatus>,
    existing: Query<(Entity, &WaterClipmapLevel)>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let integrated = capabilities
        .as_ref()
        .map(|capabilities| capabilities.integrated_gpu)
        .unwrap_or(false);
    let enabled = config.effective_enabled(&renderer_config) && !integrated;

    if !enabled {
        for (entity, _) in &existing {
            commands.entity(entity).despawn();
        }
        *status = WaterClipmapStatus {
            enabled: false,
            force_disabled_integrated_gpu: integrated && config.effective_enabled(&renderer_config),
            levels: config.levels,
            mesh_count: 0,
            origin: origin.snapped_xz,
        };
        record_clipmap_counters(&mut timing, frame.0, *status, 0);
        return;
    }

    let existing_count = existing.iter().count() as u32;
    if existing_count != config.levels {
        for (entity, _) in &existing {
            commands.entity(entity).despawn();
        }
        for level in 0..config.levels {
            commands.spawn((
                WaterClipmapLevel { level },
                WaterOwnerMarker {
                    owner: WaterSurfaceOwner::Clipmap,
                },
                Transform::from_translation(Vec3::new(
                    origin.snapped_xz.x,
                    0.0,
                    origin.snapped_xz.y,
                )),
                GlobalTransform::default(),
                Visibility::Hidden,
            ));
        }
    }

    *status = WaterClipmapStatus {
        enabled: true,
        force_disabled_integrated_gpu: false,
        levels: config.levels,
        mesh_count: config.levels,
        origin: origin.snapped_xz,
    };
    record_clipmap_counters(
        &mut timing,
        frame.0,
        *status,
        config.placeholder_triangle_count(),
    );
}

fn sync_deep_ocean_surface(
    mut commands: Commands,
    config: Res<DeepOceanConfig>,
    world: Option<Res<VoxelWorld>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    mut status: ResMut<DeepOceanStatus>,
    existing: Query<(Entity, &DeepOceanSurface)>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    if !config.enabled {
        for (entity, _) in &existing {
            commands.entity(entity).despawn();
        }
        *status = DeepOceanStatus {
            enabled: false,
            surface_y: config.surface_y,
            ..default()
        };
        record_deep_ocean_counters(&mut timing, frame.0, &config, *status);
        return;
    }

    let Some(world) = world else {
        *status = DeepOceanStatus {
            enabled: true,
            surface_y: config.surface_y,
            ..default()
        };
        record_deep_ocean_counters(&mut timing, frame.0, &config, *status);
        return;
    };

    let world_size_chunks = world.world_size_chunks();
    let world_extent = Vec2::new(
        (world_size_chunks.x * CHUNK_SIZE_I32) as f32,
        (world_size_chunks.z * CHUNK_SIZE_I32) as f32,
    );

    let needs_rebuild = existing.iter().count() != 1
        || existing
            .iter()
            .any(|(_, surface)| !surface.matches(world_extent, &config));

    if needs_rebuild {
        for (entity, _) in &existing {
            commands.entity(entity).despawn();
        }

        let build = build_deep_ocean_mesh(world_extent, &config);
        let mesh_handle = meshes.add(build.mesh);
        let material_handle = materials.add(deep_ocean_material(&config.shading));
        commands.spawn((
            Mesh3d(mesh_handle),
            MeshMaterial3d(material_handle),
            Transform::default(),
            DeepOceanSurface {
                base_positions: build.base_positions,
                vertices: build.vertices,
                triangles: build.triangles,
                transition_gap_vertices: build.transition_gap_vertices,
                world_extent,
                start_outside_border_m: config.start_outside_border_m,
                visual_extent_m: config.visual_extent_m,
                subdivisions: config.subdivisions,
                surface_y: config.surface_y,
            },
            WaterOwnerMarker {
                owner: WaterSurfaceOwner::DeepOcean,
            },
            NotShadowCaster,
        ));

        *status = DeepOceanStatus {
            enabled: true,
            mesh_present: true,
            vertices: build.vertices,
            triangles: build.triangles,
            draw_calls: 1,
            transition_gap_vertices: build.transition_gap_vertices,
            world_extent,
            surface_y: config.surface_y,
            active_cpu_waves: 0,
            cpu_animation_vertices: 0,
        };
        record_deep_ocean_counters(&mut timing, frame.0, &config, *status);
    } else if let Some((_, surface)) = existing.iter().next() {
        *status = DeepOceanStatus {
            enabled: true,
            mesh_present: true,
            vertices: surface.vertices,
            triangles: surface.triangles,
            draw_calls: 1,
            transition_gap_vertices: surface.transition_gap_vertices,
            world_extent,
            surface_y: surface.surface_y,
            active_cpu_waves: 0,
            cpu_animation_vertices: 0,
        };
    }
}

impl DeepOceanSurface {
    fn matches(&self, world_extent: Vec2, config: &DeepOceanConfig) -> bool {
        self.world_extent == world_extent
            && self.start_outside_border_m == config.start_outside_border_m
            && self.visual_extent_m == config.visual_extent_m
            && self.subdivisions == config.subdivisions
            && self.surface_y == config.surface_y
    }
}

struct DeepOceanMeshBuild {
    mesh: Mesh,
    base_positions: Vec<[f32; 3]>,
    vertices: u32,
    triangles: u32,
    transition_gap_vertices: u32,
}

fn build_deep_ocean_mesh(world_extent: Vec2, config: &DeepOceanConfig) -> DeepOceanMeshBuild {
    let buffers = build_deep_ocean_buffers(world_extent, config);
    let vertices = buffers.positions.len() as u32;
    let triangles = (buffers.indices.len() / 3) as u32;
    let mut mesh = Mesh::new(
        PrimitiveTopology::TriangleList,
        RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
    );
    mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, buffers.positions.clone());
    mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, buffers.normals);
    mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, buffers.uvs);
    mesh.insert_indices(Indices::U32(buffers.indices));

    DeepOceanMeshBuild {
        mesh,
        base_positions: buffers.positions,
        vertices,
        triangles,
        transition_gap_vertices: buffers.transition_gap_vertices,
    }
}

struct DeepOceanBuffers {
    positions: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    uvs: Vec<[f32; 2]>,
    indices: Vec<u32>,
    transition_gap_vertices: u32,
}

fn build_deep_ocean_buffers(world_extent: Vec2, config: &DeepOceanConfig) -> DeepOceanBuffers {
    let start = config.start_outside_border_m;
    let outer = config.start_outside_border_m + config.visual_extent_m;
    let inner_min_x = -start;
    let inner_max_x = world_extent.x + start;
    let inner_min_z = -start;
    let inner_max_z = world_extent.y + start;
    let outer_min_x = -outer;
    let outer_max_x = world_extent.x + outer;
    let outer_min_z = -outer;
    let outer_max_z = world_extent.y + outer;
    let subdivisions = config.subdivisions;

    let vertices_per_rect = (subdivisions as usize + 1) * (subdivisions as usize + 1);
    let indices_per_rect = subdivisions as usize * subdivisions as usize * 6;
    let mut buffers = DeepOceanBuffers {
        positions: Vec::with_capacity(vertices_per_rect * 4),
        normals: Vec::with_capacity(vertices_per_rect * 4),
        uvs: Vec::with_capacity(vertices_per_rect * 4),
        indices: Vec::with_capacity(indices_per_rect * 4),
        transition_gap_vertices: 0,
    };

    append_deep_ocean_rect(
        &mut buffers,
        Vec2::new(outer_min_x, outer_min_z),
        Vec2::new(outer_max_x, inner_min_z),
        world_extent,
        config,
    );
    append_deep_ocean_rect(
        &mut buffers,
        Vec2::new(outer_min_x, inner_max_z),
        Vec2::new(outer_max_x, outer_max_z),
        world_extent,
        config,
    );
    append_deep_ocean_rect(
        &mut buffers,
        Vec2::new(outer_min_x, inner_min_z),
        Vec2::new(inner_min_x, inner_max_z),
        world_extent,
        config,
    );
    append_deep_ocean_rect(
        &mut buffers,
        Vec2::new(inner_max_x, inner_min_z),
        Vec2::new(outer_max_x, inner_max_z),
        world_extent,
        config,
    );

    buffers
}

fn append_deep_ocean_rect(
    buffers: &mut DeepOceanBuffers,
    min: Vec2,
    max: Vec2,
    world_extent: Vec2,
    config: &DeepOceanConfig,
) {
    let base = buffers.positions.len() as u32;
    let subdivisions = config.subdivisions;
    let uv_scale = 512.0;

    for z_i in 0..=subdivisions {
        let z_t = z_i as f32 / subdivisions as f32;
        let z = min.y.lerp(max.y, z_t);
        for x_i in 0..=subdivisions {
            let x_t = x_i as f32 / subdivisions as f32;
            let x = min.x.lerp(max.x, x_t);
            if is_in_deep_ocean_transition_gap(x, z, world_extent, config.start_outside_border_m) {
                buffers.transition_gap_vertices += 1;
            }
            buffers.positions.push([x, config.surface_y, z]);
            buffers.normals.push([0.0, 1.0, 0.0]);
            buffers.uvs.push([x / uv_scale, z / uv_scale]);
        }
    }

    let stride = subdivisions + 1;
    for z_i in 0..subdivisions {
        for x_i in 0..subdivisions {
            let i0 = base + z_i * stride + x_i;
            let i1 = i0 + 1;
            let i2 = i0 + stride;
            let i3 = i2 + 1;
            buffers.indices.extend_from_slice(&[i0, i2, i1, i1, i2, i3]);
        }
    }
}

fn is_in_deep_ocean_transition_gap(
    x: f32,
    z: f32,
    world_extent: Vec2,
    start_outside_border_m: f32,
) -> bool {
    (-start_outside_border_m < x && x < 0.0)
        || (world_extent.x < x && x < world_extent.x + start_outside_border_m)
        || (-start_outside_border_m < z && z < 0.0)
        || (world_extent.y < z && z < world_extent.y + start_outside_border_m)
}

#[derive(Clone, Copy, Debug)]
struct DeepOceanSwell {
    dx: f32,
    dz: f32,
    wavelength: f32,
    steepness: f32,
    speed_scale: f32,
}

#[derive(Clone, Copy, Debug)]
struct DeepOceanSpectrumWave {
    dx: f32,
    dz: f32,
    k: f32,
    omega: f32,
    amp: f32,
    phase: f32,
}

#[derive(Clone, Copy, Debug)]
struct DeepOceanGpuWave {
    dir_x: f32,
    dir_z: f32,
    k: f32,
    omega: f32,
    amp: f32,
    phase: f32,
    choppiness: f32,
}

#[derive(Clone, Copy, Debug, Default)]
struct DeepOceanWaveSample {
    height: f32,
    offset_x: f32,
    offset_z: f32,
    slope_x: f32,
    slope_z: f32,
    compression: f32,
    velocity_x: f32,
    velocity_z: f32,
}

#[derive(Default)]
struct DeepOceanWaveCache {
    key: u64,
    waves: Vec<DeepOceanGpuWave>,
}

fn animate_deep_ocean_surface(
    config: Res<DeepOceanConfig>,
    mut meshes: ResMut<Assets<Mesh>>,
    surfaces: Query<(&DeepOceanSurface, &Mesh3d)>,
    time: Res<Time>,
    frame: Res<FrameCount>,
    mut status: ResMut<DeepOceanStatus>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut wave_cache: Local<DeepOceanWaveCache>,
) {
    if !config.enabled {
        return;
    }

    let wave_key = deep_ocean_wave_config_key(&config.wave);
    if wave_cache.key != wave_key || wave_cache.waves.is_empty() {
        wave_cache.key = wave_key;
        wave_cache.waves = build_deep_ocean_gpu_waves(config.wave);
    }

    let mut animated_vertices = 0u32;
    let time_seconds = time.elapsed_secs();
    {
        let _timer = area_timer(&mut timing, frame.0, "Deep Ocean CPU Wave Update");
        for (surface, mesh_handle) in &surfaces {
            let Some(mesh) = meshes.get_mut(&mesh_handle.0) else {
                continue;
            };
            let mut positions = Vec::with_capacity(surface.base_positions.len());
            let mut normals = Vec::with_capacity(surface.base_positions.len());
            for base in &surface.base_positions {
                let sample =
                    sample_deep_ocean_wave(base[0], base[2], time_seconds, &wave_cache.waves);
                positions.push([
                    base[0] + sample.offset_x,
                    surface.surface_y + sample.height,
                    base[2] + sample.offset_z,
                ]);
                normals.push(deep_ocean_normal(sample));
            }
            animated_vertices = animated_vertices.saturating_add(positions.len() as u32);
            mesh.insert_attribute(Mesh::ATTRIBUTE_POSITION, positions);
            mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
        }
    }

    status.active_cpu_waves = wave_cache.waves.len() as u32;
    status.cpu_animation_vertices = animated_vertices;
    record_deep_ocean_counters(&mut timing, frame.0, &config, *status);
}

fn build_deep_ocean_gpu_waves(config_input: DeepOceanWaveConfig) -> Vec<DeepOceanGpuWave> {
    let config = config_input.sanitized();
    let mut spectrum = build_deep_ocean_cascade(config, 0, config.coarse_patch_m);
    spectrum.extend(build_deep_ocean_cascade(config, 1, config.fine_patch_m));
    spectrum.sort_by(|a, b| b.amp.partial_cmp(&a.amp).unwrap_or(Ordering::Equal));
    spectrum
        .into_iter()
        .take(config.active_gpu_waves as usize)
        .map(|wave| DeepOceanGpuWave {
            dir_x: wave.dx,
            dir_z: wave.dz,
            k: wave.k,
            omega: wave.omega,
            amp: wave.amp,
            phase: wave.phase,
            choppiness: config.choppiness,
        })
        .chain(resolve_deep_ocean_swell_waves(config))
        .collect()
}

fn build_deep_ocean_cascade(
    config: DeepOceanWaveConfig,
    cascade: u32,
    patch_size: f32,
) -> Vec<DeepOceanSpectrumWave> {
    let mut waves = Vec::new();
    let grid_k = config.grid_k;
    let dk = std::f32::consts::TAU / patch_size;
    let wind_speed = config.wind_speed.max(0.5);
    let wind_direction_rad = config.wind_direction_deg.to_radians();
    let fetch_length = (wind_speed * wind_speed) / config.gravity;
    let omega_peak = (config.gravity * 0.87) / wind_speed;

    for iz in 0..grid_k {
        for ix in 0..grid_k {
            let nx = ix as f32 - grid_k as f32 / 2.0;
            let nz = iz as f32 - grid_k as f32 / 2.0;
            if nx.abs() < 0.5 && nz.abs() < 0.5 {
                continue;
            }

            let kx = nx * dk;
            let kz = nz * dk;
            let k = kx.hypot(kz).max(0.0001);
            let omega = (config.gravity * k).sqrt();
            let dx = kx / k;
            let dz = kz / k;
            let k_fetch = k * fetch_length;
            let k4 = k * k * k * k;
            let phillips = (0.01 / k4) * (-1.0 / (k_fetch * k_fetch).max(1e-6)).exp();
            let sigma = if omega <= omega_peak { 0.07 } else { 0.09 };
            let ratio = (omega - omega_peak) / (sigma * omega_peak).max(1e-6);
            let jonswap = 3.3_f32.powf((-0.5 * ratio * ratio).exp());
            let wave_angle = kz.atan2(kx);
            let directional = (wave_angle - wind_direction_rad).cos().max(0.0).powi(2);
            let suppress = (-0.0001 * k * k).exp();
            let spectrum = phillips * jonswap * directional * suppress;
            let amp = spectrum.max(0.0).sqrt() * dk * config.height_scale;
            if amp <= 1e-6 {
                continue;
            }

            let wave_index = cascade * grid_k * grid_k + iz * grid_k + ix;
            waves.push(DeepOceanSpectrumWave {
                dx,
                dz,
                k,
                omega,
                amp,
                phase: hash01(wave_index as i32, DEEP_OCEAN_SPECTRUM_SEED) * std::f32::consts::TAU,
            });
        }
    }

    waves
}

fn resolve_deep_ocean_swell_waves(
    config: DeepOceanWaveConfig,
) -> impl Iterator<Item = DeepOceanGpuWave> {
    DEEP_OCEAN_SWELLS.into_iter().map(move |swell| {
        let length = swell.dx.hypot(swell.dz).max(1.0);
        let dir_x = swell.dx / length;
        let dir_z = swell.dz / length;
        let k = std::f32::consts::TAU / swell.wavelength.max(1.0);
        let omega = (config.gravity * k).sqrt() * swell.speed_scale;
        DeepOceanGpuWave {
            dir_x,
            dir_z,
            k,
            omega,
            amp: (swell.steepness / k) * config.swell_height_scale,
            phase: 0.0,
            choppiness: config.choppiness,
        }
    })
}

fn sample_deep_ocean_wave(
    x: f32,
    z: f32,
    time_seconds: f32,
    waves: &[DeepOceanGpuWave],
) -> DeepOceanWaveSample {
    let mut sample = DeepOceanWaveSample::default();
    let mut jxx = 0.0;
    let mut jzz = 0.0;
    let mut jxz = 0.0;

    for wave in waves {
        let theta =
            wave.k * (wave.dir_x * x + wave.dir_z * z) - wave.omega * time_seconds + wave.phase;
        let c = theta.cos();
        let s = theta.sin();
        sample.offset_x -= wave.amp * wave.dir_x * s * wave.choppiness;
        sample.offset_z -= wave.amp * wave.dir_z * s * wave.choppiness;
        sample.height += wave.amp * c;
        sample.slope_x -= wave.amp * wave.k * wave.dir_x * s;
        sample.slope_z -= wave.amp * wave.k * wave.dir_z * s;
        jxx -= wave.amp * wave.k * wave.dir_x * wave.dir_x * c * wave.choppiness;
        jzz -= wave.amp * wave.k * wave.dir_z * wave.dir_z * c * wave.choppiness;
        jxz -= wave.amp * wave.k * wave.dir_x * wave.dir_z * c * wave.choppiness;
        sample.velocity_x += wave.amp * wave.dir_x * wave.omega * c * wave.choppiness;
        sample.velocity_z += wave.amp * wave.dir_z * wave.omega * c * wave.choppiness;
    }

    let jacobian = (1.0 + jxx) * (1.0 + jzz) - jxz * jxz;
    sample.compression = ((0.58 - jacobian) / 0.58).clamp(0.0, 1.0);
    sample
}

fn deep_ocean_normal(sample: DeepOceanWaveSample) -> [f32; 3] {
    let normal = Vec3::new(-sample.slope_x, 1.0, -sample.slope_z).normalize_or(Vec3::Y);
    [normal.x, normal.y, normal.z]
}

fn hash01(value: i32, seed: i32) -> f32 {
    let mut n = value
        .wrapping_mul(374_761_393)
        .wrapping_add(seed.wrapping_mul(668_265_263));
    n = (n ^ (n >> 13)).wrapping_mul(1_274_126_177);
    let hashed = (n ^ (n >> 16)) as u32;
    hashed as f32 / u32::MAX as f32
}

fn deep_ocean_wave_config_key(config: &DeepOceanWaveConfig) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    hash = hash_key_u32(hash, config.gravity.to_bits());
    hash = hash_key_u32(hash, config.grid_k);
    hash = hash_key_u32(hash, config.active_gpu_waves);
    hash = hash_key_u32(hash, config.wind_speed.to_bits());
    hash = hash_key_u32(hash, config.wind_direction_deg.to_bits());
    hash = hash_key_u32(hash, config.height_scale.to_bits());
    hash = hash_key_u32(hash, config.choppiness.to_bits());
    hash = hash_key_u32(hash, config.coarse_patch_m.to_bits());
    hash = hash_key_u32(hash, config.fine_patch_m.to_bits());
    hash = hash_key_u32(hash, config.foam_threshold.to_bits());
    hash = hash_key_u32(hash, config.foam_power.to_bits());
    hash = hash_key_u32(hash, config.foam_intensity.to_bits());
    hash_key_u32(hash, config.swell_height_scale.to_bits())
}

fn hash_key_u32(hash: u64, value: u32) -> u64 {
    (hash ^ value as u64).wrapping_mul(0x100_0000_01b3)
}

fn deep_ocean_material(shading: &DeepOceanShadingConfig) -> StandardMaterial {
    StandardMaterial {
        base_color: Color::srgba(
            shading.deep_color[0],
            shading.deep_color[1],
            shading.deep_color[2],
            shading.deep_color[3],
        ),
        alpha_mode: AlphaMode::Blend,
        perceptual_roughness: shading.roughness,
        metallic: 0.0,
        reflectance: shading.reflection_strength.clamp(0.02, 0.5),
        clearcoat: shading.fresnel_strength.clamp(0.0, 1.0),
        clearcoat_perceptual_roughness: shading.roughness.clamp(0.02, 0.35),
        double_sided: true,
        cull_mode: None,
        ..default()
    }
}

fn record_deep_ocean_counters(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    config: &DeepOceanConfig,
    status: DeepOceanStatus,
) {
    timing.record_count(
        frame,
        "border_ocean.deep_ocean_enabled",
        u8::from(status.enabled) as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.mesh_present",
        u8::from(status.mesh_present) as f64,
    );
    timing.record_count(frame, "border_ocean.vertices", status.vertices as f64);
    timing.record_count(frame, "border_ocean.triangles", status.triangles as f64);
    timing.record_count(frame, "border_ocean.draw_calls", status.draw_calls as f64);
    timing.record_count(
        frame,
        "border_ocean.start_outside_m",
        config.start_outside_border_m as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.extend_m",
        config.visual_extent_m as f64,
    );
    timing.record_count(frame, "border_ocean.surface_y", status.surface_y as f64);
    timing.record_count(
        frame,
        "border_ocean.transition_gap_vertices",
        status.transition_gap_vertices as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.world_extent_x",
        status.world_extent.x as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.world_extent_z",
        status.world_extent.y as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.configured_gpu_waves",
        config.wave.active_gpu_waves as f64,
    );
    timing.record_count(frame, "border_ocean.active_gpu_waves", 0.0);
    timing.record_count(
        frame,
        "border_ocean.active_cpu_waves",
        status.active_cpu_waves as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.cpu_animation_vertices",
        status.cpu_animation_vertices as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.wave_height_scale",
        config.wave.height_scale as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.wave_choppiness",
        config.wave.choppiness as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.wind_speed",
        config.wave.wind_speed as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.reflection_strength",
        config.shading.reflection_strength as f64,
    );
    timing.record_count(
        frame,
        "border_ocean.fog_far_m",
        config.shading.fog_far_m as f64,
    );
}

fn record_clipmap_counters(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    status: WaterClipmapStatus,
    triangles: u32,
) {
    timing.record_count(
        frame,
        "Water Clipmap Enabled",
        u8::from(status.enabled) as f64,
    );
    timing.record_count(frame, "Water Clipmap Levels Visible", status.levels as f64);
    timing.record_count(frame, "Water Clipmap Meshes", status.mesh_count as f64);
    timing.record_count(frame, "Water Clipmap Triangles", triangles as f64);
    timing.record_count(
        frame,
        "Water Clipmap Integrated GPU Disabled",
        u8::from(status.force_disabled_integrated_gpu) as f64,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipmap_config_is_disabled_by_default() {
        let renderer = WaterRendererConfig::default();
        let config = WaterClipmapConfig::default();

        assert!(!config.effective_enabled(&renderer));
    }

    #[test]
    fn clipmap_config_sanitizes_ranges() {
        let config = WaterClipmapConfig {
            enabled: true,
            levels: 0,
            cells_per_level: 0,
            base_cell_size: 0.0,
            max_distance: 0.0,
            min_body_area: -1.0,
            debug_visible: false,
        }
        .sanitized();

        assert_eq!(config.levels, 1);
        assert_eq!(config.cells_per_level, 4);
        assert_eq!(config.base_cell_size, 0.25);
        assert_eq!(config.max_distance, 0.25);
        assert_eq!(config.min_body_area, 0.0);
    }

    #[test]
    fn placeholder_triangle_count_matches_grid_accounting() {
        let config = WaterClipmapConfig {
            enabled: true,
            levels: 2,
            cells_per_level: 8,
            ..default()
        };

        assert_eq!(config.placeholder_triangle_count(), 256);
    }

    #[test]
    fn deep_ocean_config_is_disabled_by_default() {
        assert!(!DeepOceanConfig::default().enabled);
    }

    #[test]
    fn deep_ocean_mesh_leaves_transition_gap_empty() {
        let config = DeepOceanConfig {
            enabled: true,
            subdivisions: 8,
            start_outside_border_m: 64.0,
            visual_extent_m: 512.0,
            ..default()
        }
        .sanitized();
        let buffers = build_deep_ocean_buffers(Vec2::new(512.0, 512.0), &config);

        assert_eq!(buffers.transition_gap_vertices, 0);
        assert_eq!(buffers.positions.len(), 4 * 9 * 9);
        assert_eq!(buffers.indices.len() / 3, 4 * 8 * 8 * 2);
    }

    #[test]
    fn deep_ocean_mesh_accounting_matches_default_budget() {
        let config = DeepOceanConfig {
            enabled: true,
            ..default()
        }
        .sanitized();
        let buffers = build_deep_ocean_buffers(Vec2::new(512.0, 512.0), &config);

        assert_eq!(buffers.positions.len(), 264_196);
        assert_eq!(buffers.indices.len() / 3, 524_288);
        assert!(buffers.indices.len() / 3 < 600_000);
    }

    #[test]
    fn deep_ocean_wave_builder_uses_configured_spectrum_plus_swells() {
        let waves = build_deep_ocean_gpu_waves(DeepOceanWaveConfig::default());

        assert_eq!(
            waves.len(),
            DeepOceanWaveConfig::default().active_gpu_waves as usize + DEEP_OCEAN_SWELLS.len()
        );
        assert!(waves.iter().all(|wave| wave.amp.is_finite()));
        assert!(waves.iter().all(|wave| wave.k > 0.0));
    }

    #[test]
    fn deep_ocean_wave_sample_is_finite_and_normalized() {
        let waves = build_deep_ocean_gpu_waves(DeepOceanWaveConfig::default());
        let sample = sample_deep_ocean_wave(128.0, -256.0, 12.5, &waves);
        let normal = Vec3::from_array(deep_ocean_normal(sample));

        assert!(sample.height.is_finite());
        assert!(sample.offset_x.is_finite());
        assert!(sample.offset_z.is_finite());
        assert!(sample.compression.is_finite());
        assert!((normal.length() - 1.0).abs() < 0.001);
    }
}
