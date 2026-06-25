//! Billboard LOD system for distant props.
//!
//! Provides axial (cylindrical) billboards that rotate only around the Y-axis,
//! suitable for trees and tall vegetation. Integrates with existing prop
//! spawning and culling systems.

use bevy::asset::RenderAssetUsages;
use bevy::diagnostic::FrameCount;
use bevy::pbr::OpaqueRendererMethod;
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderType};
use bevy_mesh::{Indices, PrimitiveTopology};
use bevy_shader::ShaderRef;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    BILLBOARD_ALPHA_CUTOFF, BILLBOARD_BEND_SEGMENTS, BILLBOARD_BEND_STRENGTH,
    BILLBOARD_LEAF_FLUTTER_SPEED, BILLBOARD_LEAF_FLUTTER_STRENGTH, BILLBOARD_LOD_HYSTERESIS,
    BILLBOARD_SWITCH_DISTANCE, BILLBOARD_UPDATE_INTERVAL, BILLBOARD_WIND_STRENGTH,
};
use crate::performance::{AreaTimingRecorder, area_timer};

use super::instanced_render::PropVisualRefs;
use super::{PropConfig, PropType};

const GENERATED_BILLBOARD_DIR: &str = "assets/textures/billboards/generated";

// =============================================================================
// Resources
// =============================================================================

/// Configuration for billboard LOD behavior.
#[derive(Resource)]
pub struct BillboardLodSettings {
    /// Distance at which to switch from 3D mesh to billboard.
    pub switch_distance: f32,

    /// Hysteresis buffer to prevent rapid LOD switching.
    pub hysteresis: f32,

    /// Interval between LOD update checks (seconds).
    pub update_interval: f32,

    /// Whether billboard LOD is enabled globally.
    pub enabled: bool,
}

impl Default for BillboardLodSettings {
    fn default() -> Self {
        Self {
            switch_distance: BILLBOARD_SWITCH_DISTANCE,
            hysteresis: BILLBOARD_LOD_HYSTERESIS,
            update_interval: BILLBOARD_UPDATE_INTERVAL,
            enabled: true,
        }
    }
}

/// Resource caching billboard textures and meshes per prop type.
#[derive(Resource, Default)]
pub struct BillboardCache {
    /// Pre-loaded generated billboard assets keyed by prop ID.
    pub assets: HashMap<String, BillboardAsset>,

    /// Shared quad mesh handle (all billboards use the same unit quad).
    pub quad_mesh: Option<Handle<Mesh>>,

    /// Whether cache initialization is complete.
    pub initialized: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum BillboardMode {
    #[default]
    SingleAxial,
    Directional4,
    Directional8,
}

impl BillboardMode {
    pub fn direction_count(self) -> usize {
        match self {
            Self::SingleAxial => 1,
            Self::Directional4 => 4,
            Self::Directional8 => 8,
        }
    }
}

#[derive(Clone, Debug)]
pub struct BillboardAsset {
    pub mode: BillboardMode,
    pub materials: Vec<Handle<BillboardMaterial>>,
    pub size: BillboardSize,
    pub alpha_cutoff: f32,
}

/// Billboard size configuration for a prop type.
#[derive(Clone, Debug)]
pub struct BillboardSize {
    pub width: f32,
    pub height: f32,
    pub y_offset: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BillboardMetadata {
    pub prop_id: String,
    pub mode: BillboardMode,
    pub texture_paths: Vec<String>,
    pub width: f32,
    pub height: f32,
    pub y_offset: f32,
    pub alpha_cutoff: f32,
    pub source_bounds: BillboardSourceBounds,
    pub generated_image_resolution: [u32; 2],
    pub alpha_coverage: BillboardAlphaCoverage,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct BillboardSourceBounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct BillboardAlphaCoverage {
    pub min: f32,
    pub max: f32,
    pub mean: f32,
}

/// Statistics for billboard LOD system (debug UI).
#[derive(Resource, Default)]
pub struct BillboardStats {
    pub total_billboard_capable: usize,
    pub currently_billboarded: usize,
    pub currently_3d: usize,
    pub lod_switches_this_frame: usize,
    pub generated_assets_loaded: usize,
    pub missing_generated_assets: usize,
    pub directional8_count: usize,
    pub texture_direction_switches: usize,
    pub placeholder_blocked: usize,
    pub alpha_coverage_min: f32,
    pub alpha_coverage_max: f32,
}

// =============================================================================
// Components
// =============================================================================

/// Component marking a prop as billboard-capable with its LOD state.
#[derive(Component)]
pub struct BillboardLod {
    /// Current LOD state: true = billboard, false = 3D mesh.
    pub is_billboard: bool,

    /// Reference to the billboard entity when in billboard mode.
    pub billboard_entity: Option<Entity>,

    /// Whether this is a single-mesh prop (root entity has Mesh3d).
    /// For single-mesh: we hide the root entity itself.
    /// For multi-mesh: we hide child mesh entities.
    pub is_single_mesh: bool,

    /// Billboard mode for texture direction selection.
    pub mode: BillboardMode,

    /// Billboard material handles for each baked direction.
    pub billboard_materials: Vec<Handle<BillboardMaterial>>,

    /// Currently selected baked texture direction.
    pub current_direction: usize,

    /// Billboard dimensions (width, height) in world units.
    pub billboard_size: Vec2,

    /// Y offset for billboard placement (accounts for prop anchor point).
    pub y_offset: f32,
}

/// Marker component for billboard quad entities.
#[derive(Component)]
pub struct BillboardQuad {
    /// The parent prop entity this billboard represents.
    pub prop_entity: Entity,
}

// =============================================================================
// Billboard Material
// =============================================================================

/// Uniform data for billboard shader.
#[derive(Clone, Copy, ShaderType, Debug)]
pub struct BillboardUniforms {
    /// Billboard size in world units (width, height).
    pub size: Vec2,

    /// Alpha cutoff threshold for alpha testing.
    pub alpha_cutoff: f32,

    /// Padding for alignment.
    pub _padding0: f32,

    /// x = wind strength, y = bend strength, z = leaf flutter strength, w = leaf flutter speed.
    pub wind_params: Vec4,

    /// x = time, y = fog start, z = fog end, w = reserved.
    pub scene_params: Vec4,

    /// Fog color for aerial perspective.
    pub fog_color: LinearRgba,
}

impl Default for BillboardUniforms {
    fn default() -> Self {
        Self {
            size: Vec2::new(4.0, 8.0),
            alpha_cutoff: BILLBOARD_ALPHA_CUTOFF,
            _padding0: 0.0,
            wind_params: Vec4::new(
                BILLBOARD_WIND_STRENGTH,
                BILLBOARD_BEND_STRENGTH,
                BILLBOARD_LEAF_FLUTTER_STRENGTH,
                BILLBOARD_LEAF_FLUTTER_SPEED,
            ),
            scene_params: Vec4::new(0.0, 80.0, 220.0, 0.0),
            fog_color: LinearRgba::new(0.7, 0.78, 0.88, 1.0),
        }
    }
}

/// Billboard material for axial/cylindrical billboards.
#[derive(Asset, TypePath, AsBindGroup, Clone, Debug)]
pub struct BillboardMaterial {
    #[uniform(0)]
    pub uniforms: BillboardUniforms,

    #[texture(1)]
    #[sampler(2)]
    pub texture: Option<Handle<Image>>,
}

impl Default for BillboardMaterial {
    fn default() -> Self {
        Self {
            uniforms: BillboardUniforms::default(),
            texture: None,
        }
    }
}

impl Material for BillboardMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/billboard.wgsl".into()
    }

    fn vertex_shader() -> ShaderRef {
        "shaders/billboard.wgsl".into()
    }

    fn enable_prepass() -> bool {
        // Temporarily disabled for Bevy 0.18 runtime stability.
        false
    }

    fn enable_shadows() -> bool {
        // Prevent shadow-prepass specialization from compiling unstable alpha-cutout prepass variants.
        false
    }

    fn alpha_mode(&self) -> AlphaMode {
        AlphaMode::Mask(self.uniforms.alpha_cutoff)
    }

    fn opaque_render_method(&self) -> OpaqueRendererMethod {
        OpaqueRendererMethod::Forward
    }
}

/// Resource holding the billboard material handle.
#[derive(Resource)]
pub struct BillboardMaterialHandle {
    pub handle: Handle<BillboardMaterial>,
}

// =============================================================================
// Mesh Generation
// =============================================================================

/// Create a unit quad mesh for billboards.
/// The quad is centered on the X axis, with the bottom at Y=0.
/// This allows natural ground anchoring for trees.
pub fn create_billboard_quad_mesh() -> Mesh {
    let segments = BILLBOARD_BEND_SEGMENTS.max(1);

    let mut positions = Vec::with_capacity((segments + 1) * 2);
    let mut normals = Vec::with_capacity((segments + 1) * 2);
    let mut uvs = Vec::with_capacity((segments + 1) * 2);

    for i in 0..=segments {
        let t = i as f32 / segments as f32;
        let y = t;

        positions.push([-0.5, y, 0.0]);
        positions.push([0.5, y, 0.0]);

        normals.push([0.0, 0.0, 1.0]);
        normals.push([0.0, 0.0, 1.0]);

        // Keep bottom at V=1 and top at V=0.
        let v = 1.0 - t;
        uvs.push([0.0, v]);
        uvs.push([1.0, v]);
    }

    let mut indices = Vec::with_capacity(segments * 6);
    for i in 0..segments {
        let base = (i * 2) as u16;
        let bl = base;
        let br = base + 1;
        let tl = base + 2;
        let tr = base + 3;

        indices.extend_from_slice(&[bl, br, tr, bl, tr, tl]);
    }

    let indices = Indices::U16(indices);

    Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::all())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
        .with_inserted_attribute(Mesh::ATTRIBUTE_NORMAL, normals)
        .with_inserted_attribute(Mesh::ATTRIBUTE_UV_0, uvs)
        .with_inserted_indices(indices)
}

// =============================================================================
// Systems
// =============================================================================

/// System to initialize billboard cache on startup.
pub fn initialize_billboard_cache(
    mut cache: ResMut<BillboardCache>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<BillboardMaterial>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    config: Res<PropConfig>,
    mut stats: ResMut<BillboardStats>,
) {
    if cache.initialized {
        return;
    }

    // Create shared quad mesh
    cache.quad_mesh = Some(meshes.add(create_billboard_quad_mesh()));

    // Create a fallback material without a texture. It is only kept so the material
    // asset type is initialized; runtime billboard eligibility is gated by metadata.
    let material = materials.add(BillboardMaterial {
        uniforms: BillboardUniforms::default(),
        texture: None,
    });

    commands.insert_resource(BillboardMaterialHandle { handle: material });

    let metadata = load_generated_billboard_metadata();
    let mut coverage_min = f32::INFINITY;
    let mut coverage_max = 0.0_f32;
    let mut directional8_count = 0usize;

    for metadata in metadata {
        if metadata.texture_paths.is_empty() {
            warn!(
                "Skipping billboard metadata for '{}' because it has no textures",
                metadata.prop_id
            );
            continue;
        }

        let expected = metadata.mode.direction_count();
        if metadata.texture_paths.len() != expected {
            warn!(
                "Skipping billboard metadata for '{}' because mode {:?} expects {} textures, found {}",
                metadata.prop_id,
                metadata.mode,
                expected,
                metadata.texture_paths.len()
            );
            continue;
        }

        let mut billboard_materials = Vec::with_capacity(metadata.texture_paths.len());
        for texture_path in &metadata.texture_paths {
            let asset_path = texture_path
                .strip_prefix("assets/")
                .unwrap_or(texture_path.as_str())
                .replace('\\', "/");
            let texture = asset_server.load(asset_path);
            billboard_materials.push(materials.add(BillboardMaterial {
                uniforms: BillboardUniforms {
                    size: Vec2::new(metadata.width, metadata.height),
                    alpha_cutoff: metadata.alpha_cutoff,
                    ..default()
                },
                texture: Some(texture),
            }));
        }

        if metadata.mode == BillboardMode::Directional8 {
            directional8_count += 1;
        }
        coverage_min = coverage_min.min(metadata.alpha_coverage.min);
        coverage_max = coverage_max.max(metadata.alpha_coverage.max);

        cache.assets.insert(
            metadata.prop_id.clone(),
            BillboardAsset {
                mode: metadata.mode,
                materials: billboard_materials,
                size: BillboardSize {
                    width: metadata.width,
                    height: metadata.height,
                    y_offset: metadata.y_offset,
                },
                alpha_cutoff: metadata.alpha_cutoff,
            },
        );
    }

    cache.initialized = true;

    stats.generated_assets_loaded = cache.assets.len();
    stats.directional8_count = directional8_count;
    stats.alpha_coverage_min = if coverage_min.is_finite() {
        coverage_min
    } else {
        0.0
    };
    stats.alpha_coverage_max = coverage_max;
    stats.missing_generated_assets = config
        .props
        .trees
        .iter()
        .filter(|tree| !cache.assets.contains_key(&tree.id))
        .count();
    stats.placeholder_blocked = stats.missing_generated_assets;

    info!(
        "Billboard cache initialized: {} generated assets loaded, {} tree assets missing; placeholders disabled",
        stats.generated_assets_loaded, stats.missing_generated_assets
    );
}

fn load_generated_billboard_metadata() -> Vec<BillboardMetadata> {
    let dir = Path::new(GENERATED_BILLBOARD_DIR);
    let Ok(entries) = fs::read_dir(dir) else {
        info!(
            "Generated billboard directory '{}' is missing; billboard LOD will stay disabled for unbaked props",
            GENERATED_BILLBOARD_DIR
        );
        return Vec::new();
    };

    entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.ends_with(".billboard.ron"))
        })
        .filter_map(|path| match fs::read_to_string(&path) {
            Ok(contents) => match ron::de::from_str::<BillboardMetadata>(&contents) {
                Ok(metadata) => Some(metadata),
                Err(err) => {
                    warn!("Failed to parse billboard metadata {:?}: {}", path, err);
                    None
                }
            },
            Err(err) => {
                warn!("Failed to read billboard metadata {:?}: {}", path, err);
                None
            }
        })
        .collect()
}

/// System to update billboard material time for wind animation.
pub fn sync_billboard_time(
    time: Res<Time>,
    material_handle: Option<Res<BillboardMaterialHandle>>,
    mut materials: ResMut<Assets<BillboardMaterial>>,
) {
    let Some(handle) = material_handle else {
        return;
    };

    if let Some(material) = materials.get_mut(&handle.handle) {
        material.uniforms.scene_params.x = time.elapsed_secs();
    }
}

/// System to update billboard LOD states based on camera distance.
pub fn update_billboard_lod(
    time: Res<Time>,
    settings: Res<BillboardLodSettings>,
    cache: Res<BillboardCache>,
    material_handle: Option<Res<BillboardMaterialHandle>>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut commands: Commands,
    mut lod_query: Query<
        (Entity, &GlobalTransform, &mut BillboardLod),
        Without<PropVisualRefs>,
    >,
    mut billboard_query: Query<&mut MeshMaterial3d<BillboardMaterial>, With<BillboardQuad>>,
    mut stats: ResMut<BillboardStats>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut last_update: Local<f32>,
) {
    let timer = area_timer(&mut timing, frame.0, "Prop Billboard");
    if !settings.enabled || !cache.initialized {
        return;
    }

    let Some(material_handle) = material_handle else {
        return;
    };

    let Some(quad_mesh) = cache.quad_mesh.clone() else {
        return;
    };

    // Throttle updates
    let now = time.elapsed_secs();
    if now - *last_update < settings.update_interval {
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation();

    let mut switches = 0usize;
    let mut billboard_count = 0usize;
    let mut mesh_count = 0usize;

    for (entity, transform, mut lod) in lod_query.iter_mut() {
        let prop_pos = transform.translation();
        let distance = camera_pos.distance(prop_pos);

        // Determine target LOD state with hysteresis
        let threshold = if lod.is_billboard {
            settings.switch_distance - settings.hysteresis
        } else {
            settings.switch_distance + settings.hysteresis
        };

        let should_be_billboard = distance > threshold;

        if should_be_billboard != lod.is_billboard {
            switches += 1;

            if should_be_billboard {
                lod.current_direction = select_billboard_direction(&lod, transform, camera_pos);
                // Switch to billboard mode
                switch_to_billboard(
                    &mut commands,
                    entity,
                    transform,
                    &mut lod,
                    &quad_mesh,
                    &material_handle.handle,
                );
            } else {
                // Switch to mesh mode
                switch_to_mesh(&mut commands, entity, &mut lod);
            }
        } else if lod.is_billboard {
            let selected = select_billboard_direction(&lod, transform, camera_pos);
            if selected != lod.current_direction
                && let Some(material) = lod.billboard_materials.get(selected).cloned()
                && let Some(billboard_entity) = lod.billboard_entity
                && let Ok(mut mesh_material) = billboard_query.get_mut(billboard_entity)
            {
                mesh_material.0 = material;
                lod.current_direction = selected;
                stats.texture_direction_switches += 1;
            }
        }

        if lod.is_billboard {
            billboard_count += 1;
        } else {
            mesh_count += 1;
        }
    }

    stats.lod_switches_this_frame = switches;
    stats.currently_billboarded = billboard_count;
    stats.currently_3d = mesh_count;
    stats.total_billboard_capable = billboard_count + mesh_count;
    drop(timer);
    timing.record_count(
        frame.0,
        "Billboard Generated Assets Loaded",
        stats.generated_assets_loaded as f64,
    );
    timing.record_count(
        frame.0,
        "Billboard Missing Generated Assets",
        stats.missing_generated_assets as f64,
    );
    timing.record_count(
        frame.0,
        "Billboard Directional8 Count",
        stats.directional8_count as f64,
    );
    timing.record_count(
        frame.0,
        "Billboard Texture Direction Switches",
        stats.texture_direction_switches as f64,
    );
    timing.record_count(
        frame.0,
        "Billboard Placeholder Blocked",
        stats.placeholder_blocked as f64,
    );
    timing.record_count(
        frame.0,
        "Billboard Alpha Coverage Min",
        stats.alpha_coverage_min as f64,
    );
    timing.record_count(
        frame.0,
        "Billboard Alpha Coverage Max",
        stats.alpha_coverage_max as f64,
    );
}

fn switch_to_billboard(
    commands: &mut Commands,
    prop_entity: Entity,
    prop_transform: &GlobalTransform,
    lod: &mut BillboardLod,
    quad_mesh: &Handle<Mesh>,
    _material: &Handle<BillboardMaterial>,
) {
    let Some(material) = lod.billboard_materials.get(lod.current_direction).cloned() else {
        return;
    };

    // Hide the prop entity (this hides the mesh and all children)
    if let Ok(mut entity_commands) = commands.get_entity(prop_entity) {
        entity_commands.insert(Visibility::Hidden);
    }

    // Spawn billboard as a separate entity at the prop's world position
    // (not as a child, since hiding the parent would hide the child too)
    let world_pos = prop_transform.translation();
    let billboard_entity = commands
        .spawn((
            Mesh3d(quad_mesh.clone()),
            MeshMaterial3d(material),
            Transform::from_translation(world_pos + Vec3::new(0.0, lod.y_offset, 0.0))
                .with_scale(Vec3::new(lod.billboard_size.x, lod.billboard_size.y, 1.0)),
            Visibility::Inherited,
            BillboardQuad { prop_entity },
        ))
        .id();

    lod.billboard_entity = Some(billboard_entity);
    lod.is_billboard = true;
}

fn switch_to_mesh(commands: &mut Commands, prop_entity: Entity, lod: &mut BillboardLod) {
    // Show the prop entity again
    if let Ok(mut entity_commands) = commands.get_entity(prop_entity) {
        entity_commands.insert(Visibility::Inherited);
    }

    // Despawn billboard entity
    if let Some(billboard_entity) = lod.billboard_entity.take() {
        commands.entity(billboard_entity).despawn();
    }

    lod.is_billboard = false;
}

fn select_billboard_direction(
    lod: &BillboardLod,
    prop_transform: &GlobalTransform,
    camera_pos: Vec3,
) -> usize {
    let direction_count = lod.mode.direction_count();
    if direction_count <= 1 {
        return 0;
    }

    let prop_transform = prop_transform.compute_transform();
    let prop_pos = prop_transform.translation;
    let to_camera = camera_pos - prop_pos;
    let camera_angle = to_camera.x.atan2(to_camera.z);
    let forward = prop_transform.rotation * Vec3::Z;
    let prop_yaw = forward.x.atan2(forward.z);
    let relative = (camera_angle - prop_yaw).rem_euclid(std::f32::consts::TAU);
    let sector = std::f32::consts::TAU / direction_count as f32;
    let selected = ((relative / sector).round() as usize) % direction_count;

    if lod.current_direction >= direction_count {
        return selected;
    }

    // Avoid flicker at exact sector boundaries by keeping the previous direction
    // until the camera has moved a little past the midpoint to the next sector.
    let current_center = lod.current_direction as f32 * sector;
    let delta = angular_distance(relative, current_center);
    let hysteresis = sector * 0.08;
    if delta <= sector * 0.5 + hysteresis {
        lod.current_direction
    } else {
        selected
    }
}

fn angular_distance(a: f32, b: f32) -> f32 {
    let delta = (a - b).rem_euclid(std::f32::consts::TAU);
    delta.min(std::f32::consts::TAU - delta)
}

// =============================================================================
// Helper Functions
// =============================================================================

/// Check if a prop type should use billboard LOD.
pub fn should_use_billboard_lod(prop_type: PropType, _prop_id: &str) -> bool {
    matches!(prop_type, PropType::Tree)
}

/// Get billboard configuration for a prop ID.
pub fn get_billboard_config(cache: &BillboardCache, prop_id: &str) -> Option<BillboardLodConfig> {
    let asset = cache.assets.get(prop_id)?;
    Some(BillboardLodConfig {
        mode: asset.mode,
        materials: asset.materials.clone(),
        size: Vec2::new(asset.size.width, asset.size.height),
        y_offset: asset.size.y_offset,
    })
}

#[derive(Clone)]
pub struct BillboardLodConfig {
    pub mode: BillboardMode,
    pub materials: Vec<Handle<BillboardMaterial>>,
    pub size: Vec2,
    pub y_offset: f32,
}
