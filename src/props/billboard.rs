//! Billboard LOD system for distant props.
//!
//! Provides axial (cylindrical) billboards that rotate only around the Y-axis,
//! suitable for trees and tall vegetation. Integrates with existing prop
//! spawning and culling systems.

use bevy::pbr::OpaqueRendererMethod;
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderType};
use bevy_mesh::{Indices, PrimitiveTopology};
use bevy::asset::RenderAssetUsages;
use bevy_shader::ShaderRef;
use std::collections::HashMap;

use crate::camera::controller::PlayerCamera;
use crate::constants::{
    BILLBOARD_ALPHA_CUTOFF, BILLBOARD_BEND_SEGMENTS, BILLBOARD_BEND_STRENGTH,
    BILLBOARD_LEAF_FLUTTER_SPEED, BILLBOARD_LEAF_FLUTTER_STRENGTH, BILLBOARD_LOD_HYSTERESIS,
    BILLBOARD_SWITCH_DISTANCE, BILLBOARD_UPDATE_INTERVAL, BILLBOARD_WIND_STRENGTH,
};

use super::PropType;

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
    /// Pre-loaded billboard textures keyed by prop ID.
    pub textures: HashMap<String, Handle<Image>>,

    /// Shared quad mesh handle (all billboards use the same unit quad).
    pub quad_mesh: Option<Handle<Mesh>>,

    /// Billboard sizes per prop type (width, height, y_offset).
    pub sizes: HashMap<String, BillboardSize>,

    /// Whether cache initialization is complete.
    pub initialized: bool,
}

/// Billboard size configuration for a prop type.
#[derive(Clone, Debug)]
pub struct BillboardSize {
    pub width: f32,
    pub height: f32,
    pub y_offset: f32,
}

/// Statistics for billboard LOD system (debug UI).
#[derive(Resource, Default)]
pub struct BillboardStats {
    pub total_billboard_capable: usize,
    pub currently_billboarded: usize,
    pub currently_3d: usize,
    pub lod_switches_this_frame: usize,
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

    /// Billboard texture handle for this prop type.
    pub billboard_texture: Handle<Image>,

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

    fn prepass_vertex_shader() -> ShaderRef {
        "shaders/billboard_prepass.wgsl".into()
    }

    fn prepass_fragment_shader() -> ShaderRef {
        "shaders/billboard_prepass.wgsl".into()
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
) {
    if cache.initialized {
        return;
    }

    // Create shared quad mesh
    cache.quad_mesh = Some(meshes.add(create_billboard_quad_mesh()));

    // Load placeholder billboard texture
    let placeholder_texture: Handle<Image> = asset_server.load("textures/billboards/placeholder.png");

    // Create billboard material with placeholder
    let material = materials.add(BillboardMaterial {
        uniforms: BillboardUniforms::default(),
        texture: Some(placeholder_texture.clone()),
    });

    commands.insert_resource(BillboardMaterialHandle { handle: material });

    // Set up default sizes for common tree types
    // These can be overridden when actual tree definitions are loaded
    let default_tree_size = BillboardSize {
        width: 6.0,
        height: 12.0,
        y_offset: 0.0,
    };

    cache.sizes.insert("tree_oak".to_string(), default_tree_size.clone());
    cache.sizes.insert("tree_pine".to_string(), BillboardSize {
        width: 4.0,
        height: 14.0,
        y_offset: 0.0,
    });
    cache.sizes.insert("tree_birch".to_string(), BillboardSize {
        width: 5.0,
        height: 16.0,
        y_offset: 0.0,
    });

    // Store placeholder texture for all tree types initially
    cache.textures.insert("default".to_string(), placeholder_texture);

    cache.initialized = true;

    info!("Billboard cache initialized with quad mesh and placeholder texture");
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
    mut lod_query: Query<(Entity, &GlobalTransform, &mut BillboardLod)>,
    mut stats: ResMut<BillboardStats>,
    mut last_update: Local<f32>,
) {
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
}

fn switch_to_billboard(
    commands: &mut Commands,
    prop_entity: Entity,
    prop_transform: &GlobalTransform,
    lod: &mut BillboardLod,
    quad_mesh: &Handle<Mesh>,
    material: &Handle<BillboardMaterial>,
) {
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
            MeshMaterial3d(material.clone()),
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

// =============================================================================
// Helper Functions
// =============================================================================

/// Check if a prop type should use billboard LOD.
pub fn should_use_billboard_lod(prop_type: PropType, _prop_id: &str) -> bool {
    matches!(prop_type, PropType::Tree)
}

/// Get billboard configuration for a prop ID.
pub fn get_billboard_config(cache: &BillboardCache, prop_id: &str) -> Option<(Handle<Image>, Vec2, f32)> {
    // Try prop-specific texture first, fall back to default
    let texture = cache
        .textures
        .get(prop_id)
        .or_else(|| cache.textures.get("default"))?
        .clone();

    // Get size config, or use default
    let size = cache.sizes.get(prop_id).cloned().unwrap_or(BillboardSize {
        width: 6.0,
        height: 12.0,
        y_offset: 0.0,
    });

    Some((texture, Vec2::new(size.width, size.height), size.y_offset))
}
