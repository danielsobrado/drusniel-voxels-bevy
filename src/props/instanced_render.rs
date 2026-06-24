use std::any::TypeId;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use bevy::asset::AssetId;
use bevy::camera::primitives::{Aabb, CascadesFrusta, Frustum, Sphere};
use bevy::camera::visibility::RenderLayers;
use bevy::core_pipeline::core_3d::{
    AlphaMask3d, CORE_3D_DEPTH_FORMAT, Opaque3d, Opaque3dBatchSetKey, Opaque3dBinKey, Transparent3d,
};
use bevy::core_pipeline::prepass::{OpaqueNoLightmap3dBatchSetKey, OpaqueNoLightmap3dBinKey};
use bevy::diagnostic::FrameCount;
use bevy::ecs::system::{SystemParam, SystemParamItem, lifetimeless::*};
use bevy::light::NotShadowCaster;
use bevy::mesh::{MeshVertexBufferLayoutRef, VertexBufferLayout};
use bevy::pbr::{
    ExtractedDirectionalLight, ExtractedPointLight, LightEntity, MATERIAL_BIND_GROUP_INDEX,
    MaterialBindGroupAllocators, MeshPipeline, MeshPipelineKey, PreparedMaterial, PrepassPipeline,
    RenderCascadesVisibleEntities, RenderCubemapVisibleEntities, RenderMeshInstanceFlags,
    RenderMeshInstances, RenderPhaseType, RenderVisibleMeshEntities, SetMeshBindGroup,
    SetMeshViewBindGroup, SetMeshViewBindingArrayBindGroup, SetPrepassViewBindGroup,
    SetPrepassViewEmptyBindGroup, Shadow, ShadowBatchSetKey, ShadowBinKey, ViewKeyCache,
    ViewLightEntities,
};
use bevy::prelude::*;
use bevy::render::erased_render_asset::ErasedRenderAssets;
use bevy::render::{
    Extract, ExtractSchedule, Render, RenderApp, RenderStartup, RenderSystems,
    batching::gpu_preprocessing::GpuPreprocessingSupport,
    mesh::{RenderMesh, RenderMeshBufferInfo, allocator::MeshAllocator},
    render_asset::RenderAssets,
    render_phase::{
        AddRenderCommand, BinnedRenderPhaseType, DrawFunctions, PhaseItem, PhaseItemExtraIndex,
        RenderCommand, RenderCommandResult, SetItemPipeline, TrackedRenderPass,
        ViewBinnedRenderPhases, ViewSortedRenderPhases,
    },
    render_resource::*,
    renderer::{RenderDevice, RenderQueue},
    sync_component::SyncComponentPlugin,
    sync_world::{MainEntity, RenderEntity},
    view::{ExtractedView, NoIndirectDrawing, RenderVisibleEntities},
};
use bevy_shader::ShaderDefVal;
use bytemuck::{Pod, Zeroable};

use crate::bench::BenchRenderToggles;
use crate::camera::controller::PlayerCamera;
use crate::interaction::TargetedProp;
use crate::performance::AreaTimingRecorder;
use crate::props::PropType;
use crate::props::instancing::{CachedPropMesh, InstancedProp};
use crate::props::lod_material::PropLodState;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::props_material::PropsMaterial;
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::render_timing::{RenderTimingSink, render_timing_guard};
use crate::rendering::water_reflection::REFLECTION_RENDER_LAYER;

const SHADER_ASSET_PATH: &str = "shaders/instanced_prop.wgsl";
const INTEGRATED_GROUP_INSTANCE_LIMIT: usize = 2048;

#[cfg(feature = "gpu_vegetation")]
#[derive(Debug, PartialEq, Eq, Clone, Hash, bevy::render::render_graph::RenderLabel)]
struct GpuVegetationCullLabel;
const DEDICATED_GROUP_INSTANCE_LIMIT: usize = 65_536;
const PROP_GROUP_REGION_CHUNKS: i32 = 2;
const MIN_BINNED_PROP_GROUP_INSTANCES: usize = 4;
const PROP_LOD_UPDATE_INTERVAL_SECS: f32 = 0.2;
const PROP_LOD_HYSTERESIS: f32 = 12.0;
const IMPORTANT_PROP_SHADOW_LOD_DISTANCE: f32 = 176.0;
const FOLIAGE_FULL_LOD_DISTANCE: f32 = 96.0;
const FOLIAGE_HIDDEN_LOD_DISTANCE: f32 = 160.0;
const TINY_CLUTTER_FULL_LOD_DISTANCE: f32 = 64.0;
const TINY_CLUTTER_HIDDEN_LOD_DISTANCE: f32 = 80.0;
const TINY_CLUTTER_LOOKAHEAD_HEIGHT_START: f32 = 8.0;
const TINY_CLUTTER_LOOKAHEAD_HEIGHT_RANGE: f32 = 40.0;
const TINY_CLUTTER_LOOKAHEAD_FRONT_COS: f32 = 0.35;
const TINY_CLUTTER_LOOKAHEAD_MAX_EXTRA_DISTANCE: f32 = 48.0;
const TINY_CLUTTER_LOOKAHEAD_FULL_FRACTION: f32 = 0.5;
/// Max shadow-casting prop instances per group per cascade. Enforced per
/// `InstancedPropGroup`, so the true per-cascade budget is this × number of groups.
const SHADOW_CASTER_BUDGET_PER_GROUP_CASCADE: usize = 2048;
const PROP_SUBCLUSTER_MIN_GROUP_INSTANCES: usize = 24;
const PROP_SUBCLUSTER_MIN_CLUSTER_INSTANCES: usize = 8;
const PROP_SUBCLUSTER_MAX_CLUSTERS_PER_GROUP: usize = 3;
const DEFAULT_PROP_SUBCLUSTER_GRID: u8 = 4;
const PROP_SUBCLUSTER_BOUNDS_PADDING: f32 = 16.0;

#[derive(Resource, Clone, Copy, Debug)]
pub struct PropBoundsConfig {
    pub default_padding: f32,
    pub tree_padding: f32,
    pub foliage_wind_padding: f32,
    pub missing_mesh_fallback_padding: f32,
}

impl Default for PropBoundsConfig {
    fn default() -> Self {
        Self {
            default_padding: 0.5,
            tree_padding: 2.0,
            foliage_wind_padding: 1.75,
            missing_mesh_fallback_padding: 4.0,
        }
    }
}

#[derive(Resource, Clone, Copy, Debug)]
pub struct PropBoundsDebugSettings {
    pub enabled: bool,
}

impl Default for PropBoundsDebugSettings {
    fn default() -> Self {
        Self { enabled: false }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PropBoundsStats {
    heuristic_used: usize,
    from_mesh: usize,
    missing_mesh_fallback: usize,
    max_radius: f32,
    max_extent: f32,
    large_guard_expansions: usize,
}

#[derive(Clone, Copy, Debug, Hash, PartialEq, Eq)]
enum InstancedPropRenderPhase {
    Opaque,
    AlphaMask,
    Transparent,
}

impl InstancedPropRenderPhase {
    fn label(self) -> &'static str {
        match self {
            Self::Opaque => "opaque",
            Self::AlphaMask => "alpha_mask",
            Self::Transparent => "transparent",
        }
    }
}

#[derive(Clone, Hash, PartialEq, Eq)]
struct InstancedPropBucketKey {
    mesh: AssetId<Mesh>,
    material: AssetId<PropsMaterial>,
    phase: InstancedPropRenderPhase,
    prop_type_mask: u8,
}

#[derive(Default)]
struct InstancedPropBucketStats {
    draws: usize,
    instances: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PropRenderClass {
    ImportantOpaque,
    CutoutFoliage,
    TinyGroundClutter,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PropInstanceLod {
    Full,
    Mid,
    Hidden,
}

#[repr(C)]
#[derive(Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct PropInstance {
    pub transform: [[f32; 4]; 4],
    pub tint: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PropInstanceNoTint {
    transform: [[f32; 4]; 4],
}

#[derive(Component, Clone)]
pub struct InstancedPropGroup {
    pub mesh: Handle<Mesh>,
    pub material: Handle<PropsMaterial>,
    source_instances: Vec<PropInstance>,
    source_bounds: Vec<PropInstanceBounds>,
    prop_classes: Vec<PropRenderClass>,
    lod_states: Vec<PropInstanceLod>,
    pub instances: Vec<PropInstance>,
    instance_bounds: Vec<PropInstanceBounds>,
    pub shadow_instances: Vec<PropInstance>,
    shadow_culled: Vec<bool>,
    cascade_shadow_instances: Vec<Vec<PropInstance>>,
    /// Fingerprint of the cascade frusta used to build `cascade_shadow_instances`.
    /// Compared each tick to decide whether per-group cascade rebuild is needed.
    cascade_frusta_fingerprint: CascadeFrustaFingerprint,
    tint_enabled: bool,
    pub diagnostic_prop_type_mask: u8,
    pub version: u64,
    pub shadow_version: u64,
}

/// Lightweight fingerprint of cascade frusta state, derived from camera position
/// and directional light direction. Used to detect per-group cascade staleness.
#[derive(Clone, Copy, Default, PartialEq)]
struct CascadeFrustaFingerprint {
    cam_x: f32,
    cam_y: f32,
    cam_z: f32,
    light_dir_x: f32,
    light_dir_y: f32,
    light_dir_z: f32,
}

impl InstancedPropGroup {
    /// Returns a reference to the source instances (used by GPU vegetation pipeline).
    pub fn source_instances(&self) -> &[PropInstance] {
        &self.source_instances
    }

    /// Returns whether tint is enabled for this group (used by GPU vegetation pipeline).
    pub fn is_tint_enabled(&self) -> bool {
        self.tint_enabled
    }

    fn render_world_clone(&self) -> Self {
        Self {
            mesh: self.mesh.clone(),
            material: self.material.clone(),
            source_instances: Vec::new(),
            source_bounds: self.source_bounds.clone(),
            prop_classes: Vec::new(),
            lod_states: Vec::new(),
            instances: self.instances.clone(),
            instance_bounds: self.instance_bounds.clone(),
            shadow_instances: self.shadow_instances.clone(),
            shadow_culled: self.shadow_culled.clone(),
            cascade_shadow_instances: self.cascade_shadow_instances.clone(),
            cascade_frusta_fingerprint: self.cascade_frusta_fingerprint,
            tint_enabled: self.tint_enabled,
            diagnostic_prop_type_mask: self.diagnostic_prop_type_mask,
            version: self.version,
            shadow_version: self.shadow_version,
        }
    }
}

#[derive(Component, Clone, Copy)]
pub struct PropVisualRef {
    pub group: Entity,
    pub slot: u32,
    pub local_transform: Transform,
    pub local_bounds: PropLocalBounds,
    pub bounds_padding: f32,
}

#[derive(Component, Clone)]
pub struct PropVisualRefs {
    pub refs: Vec<PropVisualRef>,
}

#[derive(Component)]
pub struct PropTransformDirty;

#[derive(Component, Clone, Copy, Debug, Default)]
pub struct CascadeIndex(pub usize);

#[derive(Resource, Default, Debug)]
pub struct CascadeShadowBuffers {
    pub buffers: HashMap<(Entity, usize), CascadeShadowEntry>,
}

#[derive(Clone, Debug)]
pub struct CascadeShadowEntry {
    pub buffer: Buffer,
    pub length: usize,
}

#[derive(Clone, Copy, Debug)]
pub struct PropLocalBounds {
    pub min: Vec3,
    pub max: Vec3,
    pub sphere_center: Vec3,
    pub sphere_radius: f32,
}

impl From<&CachedPropMesh> for PropLocalBounds {
    fn from(mesh: &CachedPropMesh) -> Self {
        Self {
            min: mesh.local_aabb_min,
            max: mesh.local_aabb_max,
            sphere_center: mesh.local_bounding_sphere_center,
            sphere_radius: mesh.local_bounding_sphere_radius,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PropInstanceBounds {
    pub min: Vec3,
    pub max: Vec3,
    pub sphere_center: Vec3,
    pub sphere_radius: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct RawPropInstance {
    pub transform: Transform,
    pub tint: Vec4,
    pub shadow_culled: bool,
}

#[derive(Clone, Copy, Eq)]
struct PropGroupKey {
    region_pos: IVec2,
    mesh: AssetId<Mesh>,
    material: AssetId<PropsMaterial>,
    split: u32,
}

impl PartialEq for PropGroupKey {
    fn eq(&self, other: &Self) -> bool {
        self.region_pos == other.region_pos
            && self.mesh == other.mesh
            && self.material == other.material
            && self.split == other.split
    }
}

impl Hash for PropGroupKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.region_pos.hash(state);
        self.mesh.hash(state);
        self.material.hash(state);
        self.split.hash(state);
    }
}

struct PropGroupRecord {
    entity: Entity,
    count: usize,
    min: Vec3,
    max: Vec3,
}

#[derive(Default)]
struct PendingPropGroupUpdate {
    instances: Vec<PropInstance>,
    bounds: Vec<PropInstanceBounds>,
    prop_classes: Vec<PropRenderClass>,
    shadow_culled: Vec<bool>,
    min: Vec3,
    max: Vec3,
    prop_type_mask: u8,
}

#[derive(Resource, Default)]
pub struct PropInstanceGroups {
    groups: HashMap<PropGroupKey, PropGroupRecord>,
    pending: HashMap<Entity, PendingPropGroupUpdate>,
    integrated_gpu: bool,
    bounds_stats: PropBoundsStats,
}

impl PropInstanceGroups {
    pub fn group_count(&self) -> usize {
        self.groups.len()
    }

    pub fn pending_group_count(&self) -> usize {
        self.pending.len()
    }

    pub fn remove_chunk(&mut self, chunk_pos: IVec2) -> Vec<Entity> {
        let region_pos = prop_group_region_pos(chunk_pos);
        let mut removed = Vec::new();
        self.groups.retain(|key, record| {
            if key.region_pos == region_pos {
                removed.push(record.entity);
                false
            } else {
                true
            }
        });
        self.pending.clear();
        removed
    }

    pub fn region_for_chunk(chunk_pos: IVec2) -> IVec2 {
        prop_group_region_pos(chunk_pos)
    }

    pub fn region_chunks_for_chunk(chunk_pos: IVec2) -> Vec<IVec2> {
        prop_group_region_chunks(prop_group_region_pos(chunk_pos))
    }

    fn limit(&self) -> usize {
        if self.integrated_gpu {
            INTEGRATED_GROUP_INSTANCE_LIMIT
        } else {
            DEDICATED_GROUP_INSTANCE_LIMIT
        }
    }

    fn record_bounds(&mut self, from_mesh: bool, bounds: PropInstanceBounds, bounds_padding: f32) {
        if from_mesh {
            self.bounds_stats.from_mesh += 1;
        } else {
            self.bounds_stats.missing_mesh_fallback += 1;
        }
        if bounds_padding > PropBoundsConfig::default().default_padding {
            self.bounds_stats.large_guard_expansions += 1;
        }
        self.bounds_stats.max_radius = self.bounds_stats.max_radius.max(bounds.sphere_radius);
        self.bounds_stats.max_extent = self
            .bounds_stats
            .max_extent
            .max((bounds.max - bounds.min).max_element());
    }
}

fn prop_bounds_padding(
    config: &PropBoundsConfig,
    prop_id: &str,
    prop_type: PropType,
    bounds_from_mesh: bool,
) -> f32 {
    let id = prop_id.to_ascii_lowercase();
    let mut padding = config.default_padding.max(0.0);
    if prop_type == PropType::Tree {
        padding += config.tree_padding.max(0.0);
    }
    if matches!(prop_type, PropType::Bush | PropType::Flower)
        || id.contains("leaf")
        || id.contains("foliage")
        || id.contains("grass")
    {
        padding += config.foliage_wind_padding.max(0.0);
    }
    if !bounds_from_mesh {
        padding += config.missing_mesh_fallback_padding.max(0.0);
    }
    padding
}

fn transformed_prop_bounds(
    local_bounds: PropLocalBounds,
    transform: &Transform,
    padding: f32,
) -> PropInstanceBounds {
    transformed_padded_aabb(
        local_bounds.min,
        local_bounds.max,
        local_bounds.sphere_center,
        local_bounds.sphere_radius,
        transform,
        padding,
    )
}

fn transformed_padded_aabb(
    local_min: Vec3,
    local_max: Vec3,
    local_sphere_center: Vec3,
    local_sphere_radius: f32,
    transform: &Transform,
    padding: f32,
) -> PropInstanceBounds {
    let matrix = transform.to_matrix();
    let corners = [
        Vec3::new(local_min.x, local_min.y, local_min.z),
        Vec3::new(local_max.x, local_min.y, local_min.z),
        Vec3::new(local_min.x, local_max.y, local_min.z),
        Vec3::new(local_max.x, local_max.y, local_min.z),
        Vec3::new(local_min.x, local_min.y, local_max.z),
        Vec3::new(local_max.x, local_min.y, local_max.z),
        Vec3::new(local_min.x, local_max.y, local_max.z),
        Vec3::new(local_max.x, local_max.y, local_max.z),
    ];

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    for corner in corners {
        let world = matrix.transform_point3(corner);
        min = min.min(world);
        max = max.max(world);
    }

    let padding = padding.max(0.0);
    min -= Vec3::splat(padding);
    max += Vec3::splat(padding);

    let sphere_center = matrix.transform_point3(local_sphere_center);
    let radius_scale = transform.scale.abs().max_element();
    let sphere_radius = local_sphere_radius * radius_scale + padding;

    PropInstanceBounds {
        min,
        max,
        sphere_center,
        sphere_radius,
    }
}

fn prop_group_region_pos(chunk_pos: IVec2) -> IVec2 {
    IVec2::new(
        chunk_pos.x.div_euclid(PROP_GROUP_REGION_CHUNKS),
        chunk_pos.y.div_euclid(PROP_GROUP_REGION_CHUNKS),
    )
}

fn prop_group_region_chunks(region_pos: IVec2) -> Vec<IVec2> {
    let origin = region_pos * PROP_GROUP_REGION_CHUNKS;
    let mut chunks =
        Vec::with_capacity((PROP_GROUP_REGION_CHUNKS * PROP_GROUP_REGION_CHUNKS) as usize);
    for z in 0..PROP_GROUP_REGION_CHUNKS {
        for x in 0..PROP_GROUP_REGION_CHUNKS {
            chunks.push(origin + IVec2::new(x, z));
        }
    }
    chunks
}

fn prop_type_mask(prop_type: PropType) -> u8 {
    match prop_type {
        PropType::Tree => 1 << 0,
        PropType::Rock => 1 << 1,
        PropType::Bush => 1 << 2,
        PropType::Flower => 1 << 3,
    }
}

fn prop_type_mask_label(mask: u8) -> &'static str {
    match mask {
        0 => "unknown",
        1 => "tree",
        2 => "rock",
        4 => "bush",
        8 => "flower",
        _ => "mixed",
    }
}

fn classify_prop_render_class(prop_id: &str, prop_type: PropType) -> PropRenderClass {
    let prop_id = prop_id.to_ascii_lowercase();
    match prop_type {
        PropType::Rock | PropType::Tree => PropRenderClass::ImportantOpaque,
        PropType::Bush if prop_id.contains("grass") => PropRenderClass::TinyGroundClutter,
        PropType::Flower => PropRenderClass::TinyGroundClutter,
        PropType::Bush => PropRenderClass::CutoutFoliage,
    }
}

pub struct PropInstancingPlugin;

impl Plugin for PropInstancingPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PropInstanceGroups>()
            .init_resource::<PropBoundsConfig>()
            .init_resource::<PropBoundsDebugSettings>()
            .init_resource::<CascadeShadowBuffers>()
            .add_systems(Startup, configure_prop_instancing_limits)
            .add_systems(
                Update,
                (
                    apply_pending_instances,
                    sync_dirty_prop_transforms,
                    sync_prop_shadow_culling,
                    update_instanced_prop_lod,
                    record_prop_bounds_timing,
                )
                    .chain(),
            );
        app.add_systems(Update, (toggle_prop_bounds_debug, draw_prop_bounds_debug));

        app.add_plugins(SyncComponentPlugin::<InstancedPropGroup>::default());
        app.sub_app_mut(RenderApp)
            .add_render_command::<Opaque3d, DrawInstancedProp>()
            .add_render_command::<AlphaMask3d, DrawInstancedProp>()
            .add_render_command::<Transparent3d, DrawInstancedProp>()
            .add_render_command::<Shadow, DrawInstancedPropShadow>()
            .init_resource::<SpecializedMeshPipelines<PropInstancingPipeline>>()
            .init_resource::<SpecializedMeshPipelines<PropInstancingShadowPipeline>>()
            .add_systems(RenderStartup, init_prop_instancing_pipeline)
            .add_systems(ExtractSchedule, extract_instanced_prop_groups)
            .add_systems(
                Render,
                (
                    ensure_prop_instancing_shadow_pipeline.in_set(RenderSystems::PrepareResources),
                    prepare_instance_buffers.in_set(RenderSystems::PrepareResources),
                    queue_instanced_props.in_set(RenderSystems::QueueMeshes),
                    queue_instanced_prop_shadows.in_set(RenderSystems::QueueMeshes),
                ),
            );

        #[cfg(feature = "gpu_vegetation")]
        {
            use crate::props::gpu_vegetation;
            use crate::props::gpu_vegetation_cull;

            app.sub_app_mut(RenderApp)
                .init_resource::<gpu_vegetation::GpuVegetationSourceBuffer>()
                .add_systems(
                    ExtractSchedule,
                    (
                        gpu_vegetation::extract_gpu_vegetation_source_instances,
                        gpu_vegetation_cull::extract_gpu_cull_params,
                    ),
                )
                .add_systems(
                    Render,
                    (
                        gpu_vegetation::prepare_gpu_vegetation_source_buffer
                            .in_set(RenderSystems::PrepareResources),
                        gpu_vegetation_cull::prepare_gpu_cull_dispatch
                            .in_set(RenderSystems::PrepareResources)
                            .after(gpu_vegetation::prepare_gpu_vegetation_source_buffer),
                        prepare_instance_buffers
                            .in_set(RenderSystems::PrepareResources)
                            .after(gpu_vegetation_cull::prepare_gpu_cull_dispatch),
                    ),
                )
                .add_systems(
                    RenderStartup,
                    gpu_vegetation_cull::init_gpu_cull_pipeline,
                );

            // Register the compute cull node in the Core3d render graph.
            use bevy::core_pipeline::core_3d::graph::Core3d;
            use bevy::render::render_graph::RenderGraphExt;
            app.sub_app_mut(RenderApp).add_render_graph_node::<
                bevy::render::render_graph::ViewNodeRunner<gpu_vegetation_cull::GpuVegetationCullNode>,
            >(Core3d, GpuVegetationCullLabel);
        }
    }
}

fn configure_prop_instancing_limits(
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut groups: ResMut<PropInstanceGroups>,
) {
    groups.integrated_gpu = capabilities
        .as_ref()
        .map(|capabilities| capabilities.integrated_gpu)
        .unwrap_or(false);
}

pub fn spawn_instanced_prop(
    commands: &mut Commands,
    groups: &mut PropInstanceGroups,
    bounds_config: &PropBoundsConfig,
    cached: &[CachedPropMesh],
    prop_id: &str,
    transform: Transform,
    prop_type: PropType,
    chunk_pos: IVec2,
    tint: Vec4,
) -> Option<Entity> {
    if cached.is_empty() {
        return None;
    }

    let mut refs = Vec::with_capacity(cached.len());
    let prop_class = classify_prop_render_class(prop_id, prop_type);
    for cached_mesh in cached {
        let local_transform = if cached.len() == 1 {
            Transform {
                translation: Vec3::ZERO,
                rotation: cached_mesh.local_transform.rotation,
                scale: cached_mesh.local_transform.scale,
            }
        } else {
            cached_mesh.local_transform
        };
        let final_transform = transform * local_transform;
        let local_bounds = PropLocalBounds::from(cached_mesh);
        let bounds_padding = prop_bounds_padding(
            bounds_config,
            prop_id,
            prop_type,
            cached_mesh.bounds_from_mesh,
        );
        let instance_bounds =
            transformed_prop_bounds(local_bounds, &final_transform, bounds_padding);
        let instance = PropInstance {
            transform: final_transform.to_matrix().to_cols_array_2d(),
            tint: tint.to_array(),
        };

        groups.record_bounds(
            cached_mesh.bounds_from_mesh,
            instance_bounds,
            bounds_padding,
        );
        let (group, slot) = get_or_create_group(
            commands,
            groups,
            cached_mesh.mesh.clone(),
            cached_mesh.instanced_material.clone(),
            chunk_pos,
            instance_bounds.min,
            instance_bounds.max,
            prop_type,
        );

        groups
            .pending
            .entry(group)
            .and_modify(|pending| {
                pending.instances.push(instance);
                pending.bounds.push(instance_bounds);
                pending.prop_classes.push(prop_class);
                pending.shadow_culled.push(false);
                pending.min = pending.min.min(instance_bounds.min);
                pending.max = pending.max.max(instance_bounds.max);
                pending.prop_type_mask |= prop_type_mask(prop_type);
            })
            .or_insert_with(|| PendingPropGroupUpdate {
                instances: vec![instance],
                bounds: vec![instance_bounds],
                prop_classes: vec![prop_class],
                shadow_culled: vec![false],
                min: instance_bounds.min,
                max: instance_bounds.max,
                prop_type_mask: prop_type_mask(prop_type),
            });

        refs.push(PropVisualRef {
            group,
            slot,
            local_transform,
            local_bounds,
            bounds_padding,
        });
    }

    let first_ref = refs[0];

    Some(
        commands
            .spawn((
                transform,
                Visibility::Inherited,
                InstancedProp {
                    prop_id: prop_id.to_string(),
                },
                first_ref,
                PropVisualRefs { refs },
            ))
            .id(),
    )
}

pub fn spawn_raw_instanced_prop_batch(
    commands: &mut Commands,
    groups: &mut PropInstanceGroups,
    mesh: Handle<Mesh>,
    material: Handle<PropsMaterial>,
    local_bounds: PropLocalBounds,
    bounds_padding: f32,
    prop_id: &str,
    prop_type: PropType,
    chunk_pos: IVec2,
    instances: &[RawPropInstance],
) -> Vec<Entity> {
    if instances.is_empty() {
        return Vec::new();
    }

    let prop_class = classify_prop_render_class(prop_id, prop_type);
    let mut touched = Vec::new();
    for raw in instances {
        let instance_bounds = transformed_prop_bounds(local_bounds, &raw.transform, bounds_padding);
        let instance = PropInstance {
            transform: raw.transform.to_matrix().to_cols_array_2d(),
            tint: raw.tint.to_array(),
        };

        groups.record_bounds(true, instance_bounds, bounds_padding);
        let (group, _slot) = get_or_create_group(
            commands,
            groups,
            mesh.clone(),
            material.clone(),
            chunk_pos,
            instance_bounds.min,
            instance_bounds.max,
            prop_type,
        );
        if !touched.contains(&group) {
            touched.push(group);
        }

        groups
            .pending
            .entry(group)
            .and_modify(|pending| {
                pending.instances.push(instance);
                pending.bounds.push(instance_bounds);
                pending.prop_classes.push(prop_class);
                pending.shadow_culled.push(raw.shadow_culled);
                pending.min = pending.min.min(instance_bounds.min);
                pending.max = pending.max.max(instance_bounds.max);
                pending.prop_type_mask |= prop_type_mask(prop_type);
            })
            .or_insert_with(|| PendingPropGroupUpdate {
                instances: vec![instance],
                bounds: vec![instance_bounds],
                prop_classes: vec![prop_class],
                shadow_culled: vec![raw.shadow_culled],
                min: instance_bounds.min,
                max: instance_bounds.max,
                prop_type_mask: prop_type_mask(prop_type),
            });
    }

    touched
}

fn get_or_create_group(
    commands: &mut Commands,
    groups: &mut PropInstanceGroups,
    mesh: Handle<Mesh>,
    material: Handle<PropsMaterial>,
    chunk_pos: IVec2,
    min: Vec3,
    max: Vec3,
    prop_type: PropType,
) -> (Entity, u32) {
    let split_limit = groups.limit();
    let region_pos = prop_group_region_pos(chunk_pos);
    let mut split = 0;
    loop {
        let key = PropGroupKey {
            region_pos,
            mesh: mesh.id(),
            material: material.id(),
            split,
        };

        if let Some(record) = groups.groups.get_mut(&key) {
            if record.count < split_limit {
                let slot = record.count as u32;
                record.count += 1;
                record.min = record.min.min(min);
                record.max = record.max.max(max);
                return (record.entity, slot);
            }
        } else {
            let entity = commands
                .spawn((
                    Mesh3d(mesh.clone()),
                    Transform::IDENTITY,
                    Visibility::Inherited,
                    Aabb::from_min_max(min, max),
                    InstancedPropGroup {
                        mesh: mesh.clone(),
                        material: material.clone(),
                        source_instances: Vec::new(),
                        source_bounds: Vec::new(),
                        prop_classes: Vec::new(),
                        lod_states: Vec::new(),
                        instances: Vec::new(),
                        instance_bounds: Vec::new(),
                        shadow_instances: Vec::new(),
                        shadow_culled: Vec::new(),
                        cascade_shadow_instances: Vec::new(),
                        cascade_frusta_fingerprint: CascadeFrustaFingerprint::default(),
                        tint_enabled: !groups.integrated_gpu,
                        diagnostic_prop_type_mask: prop_type_mask(prop_type),
                        version: 1,
                        shadow_version: 1,
                    },
                    NoIndirectDrawing,
                    RenderLayers::default().with(REFLECTION_RENDER_LAYER),
                ))
                .id();
            groups.groups.insert(
                key,
                PropGroupRecord {
                    entity,
                    count: 1,
                    min,
                    max,
                },
            );
            return (entity, 0);
        }

        split += 1;
    }
}

fn apply_pending_instances(
    mut commands: Commands,
    mut groups: ResMut<PropInstanceGroups>,
    mut group_query: Query<&mut InstancedPropGroup>,
) {
    let pending = std::mem::take(&mut groups.pending);
    for (entity, update) in pending {
        let Ok(mut group) = group_query.get_mut(entity) else {
            continue;
        };
        group
            .source_instances
            .extend(update.instances.iter().copied());
        group.source_bounds.extend(update.bounds.iter().copied());
        group
            .prop_classes
            .extend(update.prop_classes.iter().copied());
        group
            .lod_states
            .extend(std::iter::repeat(PropInstanceLod::Full).take(update.instances.len()));
        group
            .shadow_culled
            .extend(update.shadow_culled.iter().copied());
        group.diagnostic_prop_type_mask |= update.prop_type_mask;
        rebuild_visible_and_shadow_instances(&mut group);
        if let Some((bounds_min, bounds_max)) = source_bounds_aabb(&group.source_bounds) {
            commands
                .entity(entity)
                .insert(Aabb::from_min_max(bounds_min, bounds_max));
        }
    }
}

fn sync_dirty_prop_transforms(
    mut commands: Commands,
    mut groups: Query<&mut InstancedPropGroup>,
    props: Query<
        (
            Entity,
            &Transform,
            &PropVisualRefs,
            Option<&NotShadowCaster>,
        ),
        With<PropTransformDirty>,
    >,
) {
    let mut touched_groups = HashSet::new();
    for (entity, transform, visual_refs, shadow_culled) in &props {
        for visual in &visual_refs.refs {
            let Ok(mut group) = groups.get_mut(visual.group) else {
                continue;
            };
            let slot = visual.slot as usize;
            let final_transform = *transform * visual.local_transform;
            if let Some(instance) = group.source_instances.get_mut(slot) {
                instance.transform = final_transform.to_matrix().to_cols_array_2d();
            }
            if let Some(bounds) = group.source_bounds.get_mut(slot) {
                *bounds = transformed_prop_bounds(
                    visual.local_bounds,
                    &final_transform,
                    visual.bounds_padding,
                );
            }
            if let Some(culled) = group.shadow_culled.get_mut(slot) {
                *culled = shadow_culled.is_some();
            }
            touched_groups.insert(visual.group);
        }
        commands.entity(entity).remove::<PropTransformDirty>();
    }

    for group_entity in touched_groups {
        let Ok(mut group) = groups.get_mut(group_entity) else {
            continue;
        };
        rebuild_visible_and_shadow_instances(&mut group);
        if let Some((min, max)) = source_bounds_aabb(&group.source_bounds) {
            commands
                .entity(group_entity)
                .insert(Aabb::from_min_max(min, max));
        }
    }
}

fn sync_prop_shadow_culling(
    mut groups: Query<&mut InstancedPropGroup>,
    props: Query<(&PropVisualRefs, &PropLodState), Changed<PropLodState>>,
) {
    for (visual_refs, lod_state) in &props {
        for visual in &visual_refs.refs {
            let Ok(mut group) = groups.get_mut(visual.group) else {
                continue;
            };
            let slot = visual.slot as usize;
            if let Some(culled) = group.shadow_culled.get_mut(slot) {
                *culled = lod_state.shadows_disabled;
                rebuild_visible_and_shadow_instances(&mut group);
            }
        }
    }
}

fn record_prop_bounds_timing(
    groups: Res<PropInstanceGroups>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let stats = groups.bounds_stats;
    timing.record_count(
        frame.0,
        "Prop Bounds Heuristic Used",
        stats.heuristic_used as f64,
    );
    timing.record_count(frame.0, "Prop Bounds From Mesh", stats.from_mesh as f64);
    timing.record_count(
        frame.0,
        "Prop Bounds Missing Mesh Fallback",
        stats.missing_mesh_fallback as f64,
    );
    timing.record_count(frame.0, "Prop Bounds Max Radius", stats.max_radius as f64);
    timing.record_count(frame.0, "Prop Bounds Max Extent", stats.max_extent as f64);
    timing.record_count(
        frame.0,
        "Large Prop Visibility Guard Expansions",
        stats.large_guard_expansions as f64,
    );
}

fn toggle_prop_bounds_debug(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut settings: ResMut<PropBoundsDebugSettings>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    if alt_held && keyboard.just_pressed(KeyCode::KeyB) {
        settings.enabled = !settings.enabled;
        info!(
            "Prop bounds debug: {}",
            if settings.enabled { "ON" } else { "OFF" }
        );
    }
}

fn draw_prop_bounds_debug(
    settings: Res<PropBoundsDebugSettings>,
    targeted_prop: Option<Res<TargetedProp>>,
    mut gizmos: Gizmos,
    groups: Query<(Entity, &InstancedPropGroup, Option<&Aabb>, &Visibility)>,
    props: Query<(Entity, &PropVisualRefs), With<InstancedProp>>,
) {
    if !settings.enabled {
        return;
    }

    for (_entity, _group, aabb, visibility) in &groups {
        let Some(aabb) = aabb else {
            continue;
        };
        let color = if *visibility == Visibility::Hidden {
            Color::srgba(1.0, 0.15, 0.1, 0.75)
        } else {
            Color::srgba(0.2, 0.55, 1.0, 0.55)
        };
        draw_aabb(
            &mut gizmos,
            Vec3::from(aabb.min()),
            Vec3::from(aabb.max()),
            color,
        );
    }

    let Some(targeted_entity) = targeted_prop.and_then(|targeted| targeted.entity) else {
        return;
    };
    let Ok((_entity, refs)) = props.get(targeted_entity) else {
        return;
    };
    for visual in &refs.refs {
        let Ok((_group_entity, group, _aabb, _visibility)) = groups.get(visual.group) else {
            continue;
        };
        let Some(bounds) = group.source_bounds.get(visual.slot as usize) else {
            continue;
        };
        draw_aabb(
            &mut gizmos,
            bounds.min,
            bounds.max,
            Color::srgba(0.15, 1.0, 0.25, 0.9),
        );
        gizmos.sphere(
            Isometry3d::from_translation(bounds.sphere_center),
            bounds.sphere_radius,
            Color::srgba(1.0, 0.9, 0.1, 0.65),
        );
    }
}

fn draw_aabb(gizmos: &mut Gizmos, min: Vec3, max: Vec3, color: Color) {
    let center = (min + max) * 0.5;
    let size = (max - min).max(Vec3::splat(0.01));
    let cuboid = Cuboid::new(size.x, size.y, size.z);
    gizmos.primitive_3d(&cuboid, Isometry3d::from_translation(center), color);
}

fn rebuild_visible_and_shadow_instances(group: &mut InstancedPropGroup) -> (bool, bool) {
    rebuild_visible_and_shadow_instances_with_options(group, false)
}

fn rebuild_visible_and_shadow_instances_with_options(
    group: &mut InstancedPropGroup,
    disable_shadow_lod: bool,
) -> (bool, bool) {
    let mut visible_instances = Vec::with_capacity(group.source_instances.len());
    let mut visible_bounds = Vec::with_capacity(group.source_bounds.len());
    let mut shadow_instances = Vec::with_capacity(group.source_instances.len());

    for (((instance, bounds), lod), shadow_culled) in group
        .source_instances
        .iter()
        .zip(group.source_bounds.iter())
        .zip(group.lod_states.iter())
        .zip(group.shadow_culled.iter())
    {
        if *lod == PropInstanceLod::Hidden {
            continue;
        }
        visible_instances.push(*instance);
        visible_bounds.push(*bounds);
        if !*shadow_culled && (disable_shadow_lod || *lod == PropInstanceLod::Full) {
            shadow_instances.push(*instance);
        }
    }

    let visible_dirty =
        group.instances != visible_instances || group.instance_bounds != visible_bounds;
    if visible_dirty {
        group.instances = visible_instances;
        group.instance_bounds = visible_bounds;
        bump_version(group);
    }

    let shadow_dirty = group.shadow_instances != shadow_instances;
    if shadow_dirty {
        group.shadow_instances = shadow_instances;
        bump_shadow_version(group);
    }

    (visible_dirty, shadow_dirty)
}

fn rebuild_visible_and_shadow_instances_with_cascades(
    group: &mut InstancedPropGroup,
    disable_shadow_lod: bool,
    cascade_frusta: &[Frustum],
    camera_pos: Vec3,
    cascade_overflow: &mut Vec<usize>,
) -> (bool, bool, bool) {
    let mut visible_instances = Vec::with_capacity(group.source_instances.len());
    let mut visible_bounds = Vec::with_capacity(group.source_bounds.len());
    let mut shadow_instances = Vec::with_capacity(group.source_instances.len());
    let num_cascades = cascade_frusta.len();
    let mut cascade_lists: Vec<Vec<PropInstance>> = vec![Vec::new(); num_cascades];

    for (((instance, bounds), lod), shadow_culled) in group
        .source_instances
        .iter()
        .zip(group.source_bounds.iter())
        .zip(group.lod_states.iter())
        .zip(group.shadow_culled.iter())
    {
        if *lod == PropInstanceLod::Hidden {
            continue;
        }
        visible_instances.push(*instance);
        visible_bounds.push(*bounds);

        let is_shadow_capable = !*shadow_culled
            && (disable_shadow_lod || *lod == PropInstanceLod::Full);

        if !is_shadow_capable {
            continue;
        }

        shadow_instances.push(*instance);

        if num_cascades > 0 {
            let sphere = Sphere {
                center: Vec3A::from(bounds.sphere_center),
                radius: bounds.sphere_radius,
            };
            for (cascade_idx, frustum) in cascade_frusta.iter().enumerate() {
                if frustum.intersects_sphere(&sphere, true) {
                    cascade_lists[cascade_idx].push(*instance);
                }
            }
        }
    }

    for (cascade_idx, cascade_list) in cascade_lists.iter_mut().enumerate() {
        if cascade_list.len() <= SHADOW_CASTER_BUDGET_PER_GROUP_CASCADE {
            continue;
        }
        let overflow = cascade_list.len() - SHADOW_CASTER_BUDGET_PER_GROUP_CASCADE;
        cascade_overflow[cascade_idx] += overflow;
        let mut dist_keys: Vec<f32> = cascade_list
            .iter()
            .map(|inst| {
                camera_pos.distance(Vec3::new(
                    inst.transform[3][0],
                    inst.transform[3][1],
                    inst.transform[3][2],
                ))
            })
            .collect();
        let mut indices: Vec<usize> = (0..cascade_list.len()).collect();
        indices.sort_unstable_by(|&a, &b| {
            dist_keys[a]
                .partial_cmp(&dist_keys[b])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        indices.truncate(SHADOW_CASTER_BUDGET_PER_GROUP_CASCADE);
        let mut truncated = indices
            .into_iter()
            .map(|i| {
                dist_keys[i] = 0.0;
                cascade_list[i]
            })
            .collect::<Vec<_>>();
        std::mem::swap(cascade_list, &mut truncated);
    }

    let visible_dirty =
        group.instances != visible_instances || group.instance_bounds != visible_bounds;
    if visible_dirty {
        group.instances = visible_instances;
        group.instance_bounds = visible_bounds;
        bump_version(group);
    }

    let shadow_dirty = group.shadow_instances != shadow_instances;
    if shadow_dirty {
        group.shadow_instances = shadow_instances;
        bump_shadow_version(group);
    }

    let cascade_dirty = group.cascade_shadow_instances != cascade_lists;
    if cascade_dirty {
        group.cascade_shadow_instances = cascade_lists;
        bump_shadow_version(group);
    }

    (visible_dirty, shadow_dirty, cascade_dirty)
}

fn source_bounds_aabb(bounds: &[PropInstanceBounds]) -> Option<(Vec3, Vec3)> {
    let first = bounds.first()?;
    let mut min = first.min;
    let mut max = first.max;
    for bounds in &bounds[1..] {
        min = min.min(bounds.min);
        max = max.max(bounds.max);
    }
    Some((min, max))
}

fn bump_version(group: &mut InstancedPropGroup) {
    group.version = group.version.wrapping_add(1).max(1);
}

fn bump_shadow_version(group: &mut InstancedPropGroup) {
    group.shadow_version = group.shadow_version.wrapping_add(1).max(1);
}

fn update_instanced_prop_lod(
    mut commands: Commands,
    time: Res<Time>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut groups: Query<(Entity, &mut InstancedPropGroup)>,
    timing: Option<Res<RenderTimingSink>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    quality_preset: Res<RenderQualityPreset>,
    directional_lights: Query<(&CascadesFrusta, &GlobalTransform), With<DirectionalLight>>,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if now - *last_update < PROP_LOD_UPDATE_INTERVAL_SECS {
        return;
    }
    *last_update = now;

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };
    let camera_pos = camera_transform.translation();
    let camera_forward = camera_transform.forward().as_vec3();
    let disable_hiding = bench_toggles
        .as_deref()
        .is_some_and(|toggles| toggles.disable_prop_lod_hiding);
    let disable_shadow_lod = bench_toggles
        .as_deref()
        .is_some_and(|toggles| toggles.disable_prop_shadow_lod);
    let lod_distance_scale = quality_preset.prop_lod_distance_scale();
    let shadow_distance_scale = quality_preset.prop_shadow_distance_scale();

    let cascade_frusta_list = {
        let mut all_frusta = Vec::new();
        for (cascades_frusta, _light_transform) in &directional_lights {
            for (_view_entity, frusta) in &cascades_frusta.frusta {
                if all_frusta.is_empty() {
                    all_frusta = frusta.clone();
                }
                break;
            }
            break;
        }
        all_frusta
    };

    // Compute frusta fingerprint from camera position + first directional light direction.
    // This uniquely identifies the cascade configuration for per-group staleness checks.
    let current_fingerprint = {
        let (cam_x, cam_y, cam_z) = (camera_pos.x, camera_pos.y, camera_pos.z);
        let (ldx, ldy, ldz) = directional_lights
            .iter()
            .next()
            .map(|(_, transform)| {
                let forward = transform.forward().as_vec3();
                (forward.x, forward.y, forward.z)
            })
            .unwrap_or((0.0, -1.0, 0.0));
        CascadeFrustaFingerprint { cam_x, cam_y, cam_z, light_dir_x: ldx, light_dir_y: ldy, light_dir_z: ldz }
    };

    let mut full_instances = 0usize;
    let mut mid_instances = 0usize;
    let mut hidden_instances = 0usize;
    let mut shadows_disabled = 0usize;
    let mut groups_dirtied = 0usize;
    let num_cascades = cascade_frusta_list.len();
    let mut cascade_overflow = vec![0usize; num_cascades];
    let mut cascade_caster_counts = vec![0usize; num_cascades];

    for (entity, mut group) in &mut groups {
        let mut lod_changed = false;
        for index in 0..group.source_instances.len() {
            let class = group
                .prop_classes
                .get(index)
                .copied()
                .unwrap_or(PropRenderClass::ImportantOpaque);
            let current = group
                .lod_states
                .get(index)
                .copied()
                .unwrap_or(PropInstanceLod::Full);
            let center = group
                .source_bounds
                .get(index)
                .map(|bounds| bounds.sphere_center)
                .unwrap_or_else(|| instance_translation(&group.source_instances[index]));
            let distance = group
                .source_bounds
                .get(index)
                .map(|bounds| (camera_pos.distance(center) - bounds.sphere_radius).max(0.0))
                .unwrap_or_else(|| camera_pos.distance(center));
            let lookahead_distance =
                tiny_ground_clutter_lookahead_distance(class, camera_pos, camera_forward, center);
            let next = classify_instance_lod(
                class,
                current,
                distance,
                lookahead_distance,
                disable_hiding,
                disable_shadow_lod,
                lod_distance_scale,
                shadow_distance_scale,
            );
            if let Some(lod) = group.lod_states.get_mut(index) {
                if *lod != next {
                    *lod = next;
                    lod_changed = true;
                }
            }

            match next {
                PropInstanceLod::Full => full_instances += 1,
                PropInstanceLod::Mid => {
                    mid_instances += 1;
                    if !disable_shadow_lod {
                        shadows_disabled += 1;
                    }
                }
                PropInstanceLod::Hidden => {
                    hidden_instances += 1;
                    if !disable_shadow_lod {
                        shadows_disabled += 1;
                    }
                }
            }
        }

        let frusta_changed_for_group = group.cascade_frusta_fingerprint != current_fingerprint;

        if lod_changed || frusta_changed_for_group {
            let (visible_dirty, shadow_dirty, cascade_dirty) =
                rebuild_visible_and_shadow_instances_with_cascades(
                    &mut group,
                    disable_shadow_lod,
                    &cascade_frusta_list,
                    camera_pos,
                    &mut cascade_overflow,
                );
            if visible_dirty || shadow_dirty || cascade_dirty {
                groups_dirtied += 1;
            }
            if visible_dirty {
                let visibility = if group.instances.is_empty() {
                    Visibility::Hidden
                } else {
                    Visibility::Inherited
                };
                commands.entity(entity).insert(visibility);
            }
            group.cascade_frusta_fingerprint = current_fingerprint;
        }
        for (ci, cascade_instances) in group.cascade_shadow_instances.iter().enumerate() {
            cascade_caster_counts[ci] += cascade_instances.len();
        }
    }

    if let Some(sink) = timing.as_deref() {
        sink.push_count("Prop LOD Full Instances", full_instances as f64);
        sink.push_count("Prop LOD Mid Instances", mid_instances as f64);
        sink.push_count("Prop LOD Hidden Instances", hidden_instances as f64);
        sink.push_count("Prop Shadows Disabled By LOD", shadows_disabled as f64);
        sink.push_count("Instanced Groups Dirtied By LOD", groups_dirtied as f64);
        for (idx, &overflow) in cascade_overflow.iter().enumerate() {
            sink.push_count(
                format!("Prop Shadow Cascade {idx} Budget Overflow"),
                overflow as f64,
            );
        }
        for (idx, &count) in cascade_caster_counts.iter().enumerate() {
            sink.push_count(
                format!("Prop Shadow Cascade {idx} Total Casters"),
                count as f64,
            );
        }
    }
}

fn classify_instance_lod(
    class: PropRenderClass,
    current: PropInstanceLod,
    distance: f32,
    lookahead_distance: f32,
    disable_hiding: bool,
    disable_shadow_lod: bool,
    lod_distance_scale: f32,
    shadow_distance_scale: f32,
) -> PropInstanceLod {
    let lod = match class {
        PropRenderClass::ImportantOpaque => {
            if disable_shadow_lod {
                return PropInstanceLod::Full;
            }
            let shadow_distance = IMPORTANT_PROP_SHADOW_LOD_DISTANCE * shadow_distance_scale;
            if distance > threshold_for_entering(current, PropInstanceLod::Mid, shadow_distance) {
                PropInstanceLod::Mid
            } else {
                PropInstanceLod::Full
            }
        }
        PropRenderClass::CutoutFoliage => classify_visible_lod(
            current,
            distance,
            FOLIAGE_FULL_LOD_DISTANCE * lod_distance_scale,
            FOLIAGE_HIDDEN_LOD_DISTANCE * lod_distance_scale,
        ),
        PropRenderClass::TinyGroundClutter => classify_visible_lod(
            current,
            distance,
            TINY_CLUTTER_FULL_LOD_DISTANCE * lod_distance_scale
                + lookahead_distance * TINY_CLUTTER_LOOKAHEAD_FULL_FRACTION,
            TINY_CLUTTER_HIDDEN_LOD_DISTANCE * lod_distance_scale + lookahead_distance,
        ),
    };

    match lod {
        PropInstanceLod::Hidden if disable_hiding && disable_shadow_lod => PropInstanceLod::Full,
        PropInstanceLod::Hidden if disable_hiding => PropInstanceLod::Mid,
        PropInstanceLod::Mid if disable_shadow_lod => PropInstanceLod::Full,
        other => other,
    }
}

fn tiny_ground_clutter_lookahead_distance(
    class: PropRenderClass,
    camera_pos: Vec3,
    camera_forward: Vec3,
    prop_center: Vec3,
) -> f32 {
    if class != PropRenderClass::TinyGroundClutter {
        return 0.0;
    }

    let mut forward_xz = Vec2::new(camera_forward.x, camera_forward.z);
    if forward_xz.length_squared() < 0.0001 {
        return 0.0;
    }
    forward_xz = forward_xz.normalize();

    let to_prop = Vec2::new(prop_center.x - camera_pos.x, prop_center.z - camera_pos.z);
    let distance_sq = to_prop.length_squared();
    if distance_sq < 0.0001 {
        return 0.0;
    }

    let alignment = (to_prop / distance_sq.sqrt()).dot(forward_xz);
    if alignment <= TINY_CLUTTER_LOOKAHEAD_FRONT_COS {
        return 0.0;
    }

    let height = (camera_pos.y - prop_center.y - TINY_CLUTTER_LOOKAHEAD_HEIGHT_START)
        / TINY_CLUTTER_LOOKAHEAD_HEIGHT_RANGE;
    let height_t = height.clamp(0.0, 1.0);
    if height_t <= 0.0 {
        return 0.0;
    }

    let alignment_t = ((alignment - TINY_CLUTTER_LOOKAHEAD_FRONT_COS)
        / (1.0 - TINY_CLUTTER_LOOKAHEAD_FRONT_COS))
        .clamp(0.0, 1.0);
    TINY_CLUTTER_LOOKAHEAD_MAX_EXTRA_DISTANCE * height_t * alignment_t
}

fn classify_visible_lod(
    current: PropInstanceLod,
    distance: f32,
    full_distance: f32,
    hidden_distance: f32,
) -> PropInstanceLod {
    let enter_hidden = threshold_for_entering(current, PropInstanceLod::Hidden, hidden_distance);
    if distance > enter_hidden {
        return PropInstanceLod::Hidden;
    }

    let enter_mid = threshold_for_entering(current, PropInstanceLod::Mid, full_distance);
    if distance > enter_mid {
        return PropInstanceLod::Mid;
    }

    PropInstanceLod::Full
}

fn threshold_for_entering(
    current: PropInstanceLod,
    target: PropInstanceLod,
    threshold: f32,
) -> f32 {
    if current == target {
        threshold - PROP_LOD_HYSTERESIS
    } else {
        threshold + PROP_LOD_HYSTERESIS
    }
}

fn instance_translation(instance: &PropInstance) -> Vec3 {
    Vec3::new(
        instance.transform[3][0],
        instance.transform[3][1],
        instance.transform[3][2],
    )
}

fn extract_instanced_prop_groups(
    mut commands: Commands,
    source_groups: Extract<Query<(RenderEntity, &InstancedPropGroup)>>,
    mut render_groups: Query<&mut InstancedPropGroup>,
    timing: Option<Res<RenderTimingSink>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Extract Groups");
    let mut groups_examined = 0usize;
    let mut groups_skipped = 0usize;
    let mut groups_inserted = 0usize;
    let mut groups_updated = 0usize;
    let mut metadata_updates = 0usize;
    let mut visible_vectors_cloned = 0usize;
    let mut shadow_vectors_cloned = 0usize;
    let mut visible_instances_cloned = 0usize;
    let mut shadow_instances_cloned = 0usize;

    for (render_entity, source) in &source_groups {
        groups_examined += 1;
        let entity = render_entity;

        let Ok(mut target) = render_groups.get_mut(entity) else {
            commands.entity(entity).insert(source.render_world_clone());
            groups_inserted += 1;
            visible_vectors_cloned += 1;
            shadow_vectors_cloned += 1;
            visible_instances_cloned += source.instances.len();
            shadow_instances_cloned += source.shadow_instances.len();
            continue;
        };

        let metadata_dirty = target.mesh != source.mesh
            || target.material != source.material
            || target.tint_enabled != source.tint_enabled
            || target.diagnostic_prop_type_mask != source.diagnostic_prop_type_mask;
        let visible_dirty =
            target.version != source.version || target.instances.len() != source.instances.len();
        let shadow_dirty = target.shadow_version != source.shadow_version
            || target.shadow_instances.len() != source.shadow_instances.len();
        let cascade_dirty = target.cascade_shadow_instances != source.cascade_shadow_instances;

        if !metadata_dirty && !visible_dirty && !shadow_dirty && !cascade_dirty {
            groups_skipped += 1;
            continue;
        }

        groups_updated += 1;

        if metadata_dirty {
            target.mesh = source.mesh.clone();
            target.material = source.material.clone();
            target.tint_enabled = source.tint_enabled;
            target.diagnostic_prop_type_mask = source.diagnostic_prop_type_mask;
            metadata_updates += 1;
        }

        if visible_dirty {
            target.instances.clone_from(&source.instances);
            target.instance_bounds.clone_from(&source.instance_bounds);
            target.source_bounds.clone_from(&source.source_bounds);
            target.version = source.version;
            visible_vectors_cloned += 1;
            visible_instances_cloned += source.instances.len();
        }

        if shadow_dirty {
            target.shadow_instances.clone_from(&source.shadow_instances);
            target.shadow_culled.clone_from(&source.shadow_culled);
            target.shadow_version = source.shadow_version;
            shadow_vectors_cloned += 1;
            shadow_instances_cloned += source.shadow_instances.len();
        }

        if cascade_dirty {
            target
                .cascade_shadow_instances
                .clone_from(&source.cascade_shadow_instances);
        }
    }

    if let Some(sink) = sink {
        sink.push_count(
            "Render Instancing Extract Groups Examined",
            groups_examined as f64,
        );
        sink.push_count(
            "Render Instancing Extract Groups Skipped",
            groups_skipped as f64,
        );
        sink.push_count(
            "Render Instancing Extract Groups Inserted",
            groups_inserted as f64,
        );
        sink.push_count(
            "Render Instancing Extract Groups Updated",
            groups_updated as f64,
        );
        sink.push_count(
            "Render Instancing Extract Metadata Updates",
            metadata_updates as f64,
        );
        sink.push_count(
            "Render Instancing Extract Visible Vectors Cloned",
            visible_vectors_cloned as f64,
        );
        sink.push_count(
            "Render Instancing Extract Shadow Vectors Cloned",
            shadow_vectors_cloned as f64,
        );
        sink.push_count(
            "Render Instancing Extract Visible Instances Cloned",
            visible_instances_cloned as f64,
        );
        sink.push_count(
            "Render Instancing Extract Shadow Instances Cloned",
            shadow_instances_cloned as f64,
        );
    }
}

#[derive(Component)]
pub struct InstanceBuffer {
    pub buffer: Buffer,
    pub capacity: usize,
    pub length: usize,
    pub uploaded_version: u64,
    pub shadow_buffer: Buffer,
    pub shadow_capacity: usize,
    pub shadow_length: usize,
    pub uploaded_shadow_version: u64,
    pub cascade_shadow_count: usize,
    subcluster_grid: u8,
    subcluster_source_version: u64,
    subcluster_visibility_mask: u64,
    subclusters: Vec<PreparedPropSubcluster>,
    /// GPU cull: draw args buffer for indirect draw (None = CPU path).
    pub gpu_cull_draw_args_buffer: Option<Buffer>,
    /// GPU cull: visible instances buffer for vertex shader (STORAGE | VERTEX).
    pub gpu_cull_visible_buffer: Option<Buffer>,
    /// GPU cull: byte offset into the draw args buffer for this entity's group.
    pub gpu_cull_draw_args_offset: u64,
}

#[derive(Clone)]
struct PreparedPropSubcluster {
    center: Vec3,
    radius: f32,
    instances: Vec<PropInstance>,
}

#[derive(Clone, Copy)]
struct PropSubclusterSource {
    instance: PropInstance,
    bounds: PropInstanceBounds,
}

fn instance_stride(tint_enabled: bool) -> usize {
    if tint_enabled {
        size_of::<PropInstance>()
    } else {
        size_of::<PropInstanceNoTint>()
    }
}

fn ensure_instance_buffer_capacity(
    render_device: &RenderDevice,
    existing: Option<&Buffer>,
    current_capacity: usize,
    required_len: usize,
    tint_enabled: bool,
    label: &'static str,
) -> (Buffer, usize, bool) {
    if let Some(buffer) = existing {
        if current_capacity >= required_len {
            return (buffer.clone(), current_capacity, false);
        }
    }

    let new_capacity = required_len.next_power_of_two().max(1);
    let size = (new_capacity * instance_stride(tint_enabled)) as u64;
    let buffer = render_device.create_buffer(&BufferDescriptor {
        label: Some(label),
        size,
        usage: BufferUsages::VERTEX | BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });

    (buffer, new_capacity, true)
}

fn shadow_instances_match_visible(group: &InstancedPropGroup) -> bool {
    if group.shadow_instances.len() != group.instances.len() {
        return false;
    }

    if group.shadow_culled.len() == group.instances.len()
        && group.shadow_culled.iter().all(|culled| !*culled)
    {
        return true;
    }

    group.shadow_instances == group.instances
}

fn normalized_prop_subcluster_grid(bench_toggles: Option<&BenchRenderToggles>) -> u8 {
    match bench_toggles.map(|toggles| toggles.prop_subcluster_grid) {
        Some(2) => 2,
        Some(4) => 4,
        _ => DEFAULT_PROP_SUBCLUSTER_GRID,
    }
}

fn prop_instance_translation(instance: &PropInstance) -> Vec3 {
    Vec3::new(
        instance.transform[3][0],
        instance.transform[3][1],
        instance.transform[3][2],
    )
}

fn cluster_from_sources(sources: Vec<PropSubclusterSource>) -> PreparedPropSubcluster {
    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    let mut instances = Vec::with_capacity(sources.len());
    for source in sources {
        min = min.min(source.bounds.min);
        max = max.max(source.bounds.max);
        instances.push(source.instance);
    }
    let center = (min + max) * 0.5;
    let radius = ((max - min) * 0.5).length() + PROP_SUBCLUSTER_BOUNDS_PADDING;
    PreparedPropSubcluster {
        center,
        radius,
        instances,
    }
}

fn build_prop_subclusters(
    instances: &[PropInstance],
    bounds: &[PropInstanceBounds],
    grid: u8,
) -> Vec<PreparedPropSubcluster> {
    if !matches!(grid, 2 | 4) || instances.len() < PROP_SUBCLUSTER_MIN_GROUP_INSTANCES {
        return Vec::new();
    }

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    let mut sources = Vec::with_capacity(instances.len());
    for (index, instance) in instances.iter().enumerate() {
        let bounds = bounds
            .get(index)
            .copied()
            .unwrap_or_else(|| point_instance_bounds(instance));
        min = min.min(bounds.min);
        max = max.max(bounds.max);
        sources.push(PropSubclusterSource {
            instance: *instance,
            bounds,
        });
    }

    let extent = max - min;
    if extent.x <= f32::EPSILON && extent.z <= f32::EPSILON {
        return Vec::new();
    }

    let grid_usize = grid as usize;
    let mut cells = vec![Vec::new(); grid_usize * grid_usize];
    let inv_x = if extent.x > f32::EPSILON {
        1.0 / extent.x
    } else {
        0.0
    };
    let inv_z = if extent.z > f32::EPSILON {
        1.0 / extent.z
    } else {
        0.0
    };

    for source in sources {
        let position = source.bounds.sphere_center;
        let x = (((position.x - min.x) * inv_x) * grid as f32)
            .floor()
            .clamp(0.0, (grid - 1) as f32) as usize;
        let z = (((position.z - min.z) * inv_z) * grid as f32)
            .floor()
            .clamp(0.0, (grid - 1) as f32) as usize;
        cells[z * grid_usize + x].push(source);
    }

    let mut tiny_instances = Vec::new();
    let mut clusters = Vec::new();
    for cell in cells {
        // Fold sparse cells into one bounded fallback cluster
        // instead of letting the experiment devolve into one draw per instance.
        if cell.len() >= PROP_SUBCLUSTER_MIN_CLUSTER_INSTANCES {
            clusters.push(cluster_from_sources(cell));
        } else {
            tiny_instances.extend(cell);
        }
    }
    if !tiny_instances.is_empty() {
        clusters.push(cluster_from_sources(tiny_instances));
    }

    if clusters.len() <= 1 {
        return Vec::new();
    }

    clusters.sort_by(|a, b| b.instances.len().cmp(&a.instances.len()));
    if clusters.len() > PROP_SUBCLUSTER_MAX_CLUSTERS_PER_GROUP {
        let mut merged_instances = Vec::new();
        let mut merged_min = Vec3::splat(f32::INFINITY);
        let mut merged_max = Vec3::splat(f32::NEG_INFINITY);
        for cluster in clusters.drain((PROP_SUBCLUSTER_MAX_CLUSTERS_PER_GROUP - 1)..) {
            let radius = Vec3::splat(cluster.radius);
            merged_min = merged_min.min(cluster.center - radius);
            merged_max = merged_max.max(cluster.center + radius);
            merged_instances.extend(cluster.instances);
        }
        let center = (merged_min + merged_max) * 0.5;
        let radius = ((merged_max - merged_min) * 0.5).length();
        clusters.push(PreparedPropSubcluster {
            center,
            radius,
            instances: merged_instances,
        });
    }

    clusters
}

fn point_instance_bounds(instance: &PropInstance) -> PropInstanceBounds {
    let center = prop_instance_translation(instance);
    PropInstanceBounds {
        min: center,
        max: center,
        sphere_center: center,
        sphere_radius: 0.0,
    }
}

fn extracted_view_frustum(view: &ExtractedView) -> Frustum {
    let clip_from_world = view
        .clip_from_world
        .unwrap_or_else(|| view.clip_from_view * view.world_from_view.to_matrix().inverse());
    Frustum::from_clip_from_world(&clip_from_world)
}

fn prop_subcluster_visible_mask(subclusters: &[PreparedPropSubcluster], frusta: &[Frustum]) -> u64 {
    if subclusters.is_empty() {
        return 0;
    }
    if frusta.is_empty() {
        let count = subclusters.len().min(64);
        return if count == 64 {
            u64::MAX
        } else {
            (1u64 << count) - 1
        };
    }

    let mut mask = 0u64;
    for (index, subcluster) in subclusters.iter().enumerate().take(64) {
        let sphere = Sphere {
            center: Vec3A::from(subcluster.center),
            radius: subcluster.radius,
        };
        if frusta
            .iter()
            .any(|frustum| frustum.intersects_sphere(&sphere, true))
        {
            mask |= 1u64 << index;
        }
    }
    mask
}

fn group_visible_instance_sphere_intersects_frusta(
    group: &InstancedPropGroup,
    frusta: &[Frustum],
) -> bool {
    if frusta.is_empty() {
        return false;
    }
    group.instance_bounds.iter().any(|bounds| {
        let sphere = Sphere {
            center: Vec3A::from(bounds.sphere_center),
            radius: bounds.sphere_radius,
        };
        frusta
            .iter()
            .any(|frustum| frustum.intersects_sphere(&sphere, true))
    })
}

fn prop_subcluster_visible_len(subclusters: &[PreparedPropSubcluster], mask: u64) -> usize {
    subclusters
        .iter()
        .enumerate()
        .filter(|(index, _)| (mask & (1u64 << index)) != 0)
        .map(|(_, subcluster)| subcluster.instances.len())
        .sum()
}

fn collect_prop_subcluster_instances(
    subclusters: &[PreparedPropSubcluster],
    mask: u64,
) -> Vec<PropInstance> {
    let mut instances = Vec::with_capacity(prop_subcluster_visible_len(subclusters, mask));
    for (index, subcluster) in subclusters.iter().enumerate() {
        if (mask & (1u64 << index)) != 0 {
            instances.extend_from_slice(&subcluster.instances);
        }
    }
    instances
}

fn prepare_instance_buffers(
    mut commands: Commands,
    query: Query<(Entity, &InstancedPropGroup, Option<&InstanceBuffer>)>,
    views: Query<(&ExtractedView, &RenderVisibleEntities)>,
    visible_meshes: Query<&RenderVisibleMeshEntities>,
    visible_cubemaps: Query<&RenderCubemapVisibleEntities>,
    visible_cascades: Query<&RenderCascadesVisibleEntities>,
    render_device: Res<RenderDevice>,
    render_queue: Res<RenderQueue>,
    timing: Option<Res<RenderTimingSink>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    mut cascade_buffers: ResMut<CascadeShadowBuffers>,
    #[cfg(feature = "gpu_vegetation")]
    gpu_cull_buffers: Option<Res<crate::props::gpu_vegetation_cull::GpuVegetationCullBuffers>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Prepare Buffers");
    let subcluster_grid = normalized_prop_subcluster_grid(bench_toggles.as_deref());
    let subcluster_mode = subcluster_grid != 0;
    let collect_frustum_diagnostics = subcluster_mode || sink.is_some();
    let mut visible_entities = HashSet::new();
    let mut view_frusta = Vec::new();
    for (view, visible_view_entities) in &views {
        if collect_frustum_diagnostics {
            view_frusta.push(extracted_view_frustum(view));
        }
        visible_entities.extend(
            visible_view_entities
                .iter::<Mesh3d>()
                .map(|(entity, _)| *entity),
        );
    }
    for visible_meshes in &visible_meshes {
        visible_entities.extend(visible_meshes.iter().map(|(entity, _)| *entity));
    }
    for visible_cubemaps in &visible_cubemaps {
        for visible_meshes in visible_cubemaps.iter() {
            visible_entities.extend(visible_meshes.iter().map(|(entity, _)| *entity));
        }
    }
    for visible_cascades in &visible_cascades {
        for cascade_views in visible_cascades.entities.values() {
            for visible_meshes in cascade_views {
                visible_entities.extend(visible_meshes.iter().map(|(entity, _)| *entity));
            }
        }
    }
    let visibility_filter_active = !visible_entities.is_empty();
    let mut groups_examined = 0usize;
    let mut groups_skipped_not_visible = 0usize;
    let mut groups_skipped = 0usize;
    let mut groups_uploaded = 0usize;
    let mut visible_buffers_uploaded = 0usize;
    let mut shadow_buffers_uploaded = 0usize;
    let mut visible_buffers_created = 0usize;
    let mut shadow_buffers_created = 0usize;
    let mut shadow_buffers_reused = 0usize;
    let mut instances_uploaded = 0usize;
    let mut shadow_instances_uploaded = 0usize;
    let mut shadow_instances_reused = 0usize;
    let mut bytes_uploaded = 0usize;
    let mut subclusters_total = 0usize;
    let mut subclusters_visible = 0usize;
    let mut subclusters_queued = 0usize;
    let mut subcluster_draws = 0usize;
    let mut subcluster_instances_queued = 0usize;
    let mut subcluster_instances_culled = 0usize;
    let mut groups_culled_but_instance_sphere_intersects = 0usize;

    for (entity, group, existing) in &query {
        groups_examined += 1;
        if visibility_filter_active && !visible_entities.contains(&entity) {
            groups_skipped_not_visible += 1;
            if group_visible_instance_sphere_intersects_frusta(group, &view_frusta) {
                groups_culled_but_instance_sphere_intersects += 1;
            }
            continue;
        }
        if group.instances.is_empty() {
            if let Some(existing) = existing {
                if existing.length != 0
                    || existing.shadow_length != 0
                    || existing.uploaded_version != group.version
                    || existing.uploaded_shadow_version != group.shadow_version
                {
                    commands.entity(entity).insert(InstanceBuffer {
                        buffer: existing.buffer.clone(),
                        capacity: existing.capacity,
                        length: 0,
                        uploaded_version: group.version,
                        shadow_buffer: existing.shadow_buffer.clone(),
                        shadow_capacity: existing.shadow_capacity,
                        shadow_length: 0,
                        uploaded_shadow_version: group.shadow_version,
                        cascade_shadow_count: 0,
                        subcluster_grid: 0,
                        subcluster_source_version: 0,
                        subcluster_visibility_mask: 0,
                        subclusters: Vec::new(),
                        gpu_cull_draw_args_buffer: None,
                        gpu_cull_visible_buffer: None,
                        gpu_cull_draw_args_offset: 0,
                    });
                }
            }
            continue;
        }

        let mut built_subclusters = None;
        let subclusters: &[PreparedPropSubcluster] = if subcluster_mode {
            if let Some(buffer) = existing.filter(|buffer| {
                buffer.subcluster_grid == subcluster_grid
                    && buffer.subcluster_source_version == group.version
            }) {
                &buffer.subclusters
            } else {
                built_subclusters = Some(build_prop_subclusters(
                    &group.instances,
                    &group.instance_bounds,
                    subcluster_grid,
                ));
                built_subclusters.as_deref().unwrap_or(&[])
            }
        } else {
            &[]
        };
        let subcluster_visibility_mask = if subcluster_mode {
            prop_subcluster_visible_mask(subclusters, &view_frusta)
        } else {
            0
        };
        let visible_instance_len = if subcluster_mode && !subclusters.is_empty() {
            prop_subcluster_visible_len(subclusters, subcluster_visibility_mask)
        } else {
            group.instances.len()
        };
        if subcluster_mode && !subclusters.is_empty() {
            let visible_count = subcluster_visibility_mask.count_ones() as usize;
            subclusters_total += subclusters.len();
            subclusters_visible += visible_count;
            subclusters_queued += visible_count;
            if visible_instance_len > 0 {
                subcluster_draws += 1;
            }
            subcluster_instances_queued += visible_instance_len;
            subcluster_instances_culled +=
                group.instances.len().saturating_sub(visible_instance_len);
        }

        let visible_clean = existing
            .map(|buffer| {
                buffer.uploaded_version == group.version
                    && buffer.capacity >= visible_instance_len
                    && buffer.length == visible_instance_len
                    && buffer.subcluster_grid == subcluster_grid
                    && (!subcluster_mode
                        || (buffer.subcluster_source_version == group.version
                            && buffer.subcluster_visibility_mask == subcluster_visibility_mask))
            })
            .unwrap_or(false);
        let shadow_clean = existing
            .map(|buffer| {
                buffer.uploaded_shadow_version == group.shadow_version
                    && buffer.shadow_capacity >= group.shadow_instances.len()
                    && buffer.shadow_length == group.shadow_instances.len()
            })
            .unwrap_or(false);

        if visible_clean && shadow_clean {
            groups_skipped += 1;
            continue;
        }

        let mut uploaded_any = false;
        let (buffer, capacity, length, uploaded_version) = if visible_clean {
            let existing = existing.expect("visible_clean requires an existing buffer");
            (
                existing.buffer.clone(),
                existing.capacity,
                existing.length,
                existing.uploaded_version,
            )
        } else {
            let subcluster_instances;
            let instance_bytes: Vec<PropInstanceNoTint>;
            let visible_instances = if subcluster_mode && !subclusters.is_empty() {
                subcluster_instances =
                    collect_prop_subcluster_instances(subclusters, subcluster_visibility_mask);
                subcluster_instances.as_slice()
            } else {
                group.instances.as_slice()
            };
            let contents = if group.tint_enabled {
                bytemuck::cast_slice(visible_instances)
            } else {
                instance_bytes = visible_instances
                    .iter()
                    .map(|instance| PropInstanceNoTint {
                        transform: instance.transform,
                    })
                    .collect();
                bytemuck::cast_slice(instance_bytes.as_slice())
            };
            let (buffer, capacity, created) = ensure_instance_buffer_capacity(
                &render_device,
                existing.map(|buffer| &buffer.buffer),
                existing.map(|buffer| buffer.capacity).unwrap_or(0),
                visible_instance_len,
                group.tint_enabled,
                "instanced prop data buffer",
            );
            if !contents.is_empty() {
                render_queue.write_buffer(&buffer, 0, contents);
            }
            bytes_uploaded += contents.len();
            instances_uploaded += visible_instance_len;
            visible_buffers_uploaded += 1;
            visible_buffers_created += usize::from(created);
            uploaded_any = true;
            (buffer, capacity, visible_instance_len, group.version)
        };

        let (shadow_buffer, shadow_capacity, shadow_length, uploaded_shadow_version) =
            if shadow_clean {
                let existing = existing.expect("shadow_clean requires an existing buffer");
                (
                    existing.shadow_buffer.clone(),
                    existing.shadow_capacity,
                    existing.shadow_length,
                    existing.uploaded_shadow_version,
                )
            } else if group.shadow_instances.is_empty()
                || (visible_instance_len == group.instances.len()
                    && shadow_instances_match_visible(group))
            {
                shadow_buffers_reused += 1;
                shadow_instances_reused += group.shadow_instances.len();
                (
                    buffer.clone(),
                    capacity,
                    group.shadow_instances.len(),
                    group.shadow_version,
                )
            } else {
                let shadow_instance_bytes: Vec<PropInstanceNoTint>;
                let shadow_contents = if group.tint_enabled {
                    bytemuck::cast_slice(group.shadow_instances.as_slice())
                } else {
                    shadow_instance_bytes = group
                        .shadow_instances
                        .iter()
                        .map(|instance| PropInstanceNoTint {
                            transform: instance.transform,
                        })
                        .collect();
                    bytemuck::cast_slice(shadow_instance_bytes.as_slice())
                };
                let (shadow_buffer, shadow_capacity, created) = ensure_instance_buffer_capacity(
                    &render_device,
                    existing.map(|buffer| &buffer.shadow_buffer),
                    existing.map(|buffer| buffer.shadow_capacity).unwrap_or(0),
                    group.shadow_instances.len(),
                    group.tint_enabled,
                    "instanced prop shadow data buffer",
                );
                if !shadow_contents.is_empty() {
                    render_queue.write_buffer(&shadow_buffer, 0, shadow_contents);
                    shadow_buffers_uploaded += 1;
                }
                bytes_uploaded += shadow_contents.len();
                shadow_instances_uploaded += group.shadow_instances.len();
                shadow_buffers_created += usize::from(created);
                uploaded_any = true;
                (
                    shadow_buffer,
                    shadow_capacity,
                    group.shadow_instances.len(),
                    group.shadow_version,
                )
            };

        if uploaded_any {
            groups_uploaded += 1;
        }
        let subclusters_to_store = if subcluster_mode {
            built_subclusters
                .or_else(|| existing.map(|buffer| buffer.subclusters.clone()))
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        // GPU cull: look up draw args buffer and offset for this entity.
        #[cfg(feature = "gpu_vegetation")]
        let (gpu_cull_draw_args_buffer, gpu_cull_visible_buffer, gpu_cull_draw_args_offset) =
            if let Some(ref cull_buffers) = gpu_cull_buffers {
                if let Some(group_idx) = cull_buffers.group_index_for_entity(entity) {
                    let stride = std::mem::size_of::<crate::props::gpu_vegetation_cull::GpuDrawArgsTemplate>() as u64;
                    (
                        cull_buffers.draw_args_buffer().cloned(),
                        cull_buffers.visible_instances_buffer().cloned(),
                        group_idx as u64 * stride,
                    )
                } else {
                    (None, None, 0)
                }
            } else {
                (None, None, 0)
            };
        #[cfg(not(feature = "gpu_vegetation"))]
        let (gpu_cull_draw_args_buffer, gpu_cull_visible_buffer, gpu_cull_draw_args_offset): (Option<Buffer>, Option<Buffer>, u64) = (None, None, 0);
        let mut entity_cmd = commands.entity(entity);
        #[allow(unused_variables)]
        let gpu_cull_active = gpu_cull_draw_args_buffer.is_some();
        entity_cmd.insert(InstanceBuffer {
            buffer,
            capacity,
            length,
            uploaded_version,
            shadow_buffer,
            shadow_capacity,
            shadow_length,
            uploaded_shadow_version,
            cascade_shadow_count: group.cascade_shadow_instances.len(),
            subcluster_grid,
            subcluster_source_version: if subcluster_mode { group.version } else { 0 },
            subcluster_visibility_mask,
            subclusters: subclusters_to_store,
            gpu_cull_draw_args_buffer,
            gpu_cull_visible_buffer,
            gpu_cull_draw_args_offset,
        });
        #[cfg(feature = "gpu_vegetation")]
        if gpu_cull_active {
            entity_cmd.insert(GpuCullActive);
        }

        cascade_buffers.buffers.retain(|(e, _), _| *e != entity);
        for (cascade_idx, cascade_instances) in group.cascade_shadow_instances.iter().enumerate() {
            if cascade_instances.is_empty() {
                continue;
            }
            let cascade_no_tint: Vec<PropInstanceNoTint>;
            let cascade_contents: &[u8] = if group.tint_enabled {
                bytemuck::cast_slice(cascade_instances.as_slice())
            } else {
                cascade_no_tint = cascade_instances
                    .iter()
                    .map(|inst| PropInstanceNoTint {
                        transform: inst.transform,
                    })
                    .collect();
                bytemuck::cast_slice(cascade_no_tint.as_slice())
            };
            let required_len = cascade_instances.len();
            let new_capacity = required_len.next_power_of_two().max(1);
            let size = (new_capacity * instance_stride(group.tint_enabled)) as u64;
            let buf = render_device.create_buffer(&BufferDescriptor {
                label: Some("instanced prop cascade shadow buffer"),
                size,
                usage: BufferUsages::VERTEX | BufferUsages::COPY_DST,
                mapped_at_creation: false,
            });
            render_queue.write_buffer(&buf, 0, cascade_contents);
            bytes_uploaded += cascade_contents.len();
            cascade_buffers.buffers.insert(
                (entity, cascade_idx),
                CascadeShadowEntry {
                    buffer: buf,
                    length: required_len,
                },
            );
        }
    }

    if let Some(sink) = sink {
        sink.push_count(
            "Render Instancing Buffer Groups Examined",
            groups_examined as f64,
        );
        sink.push_count(
            "Render Instancing Buffer Groups Skipped",
            groups_skipped as f64,
        );
        sink.push_count(
            "Render Instancing Buffer Groups Skipped Not Visible",
            groups_skipped_not_visible as f64,
        );
        sink.push_count(
            "Prop Groups Culled By Frustum",
            groups_skipped_not_visible as f64,
        );
        sink.push_count(
            "Prop Groups Culled But Instance Sphere Intersects Frustum",
            groups_culled_but_instance_sphere_intersects as f64,
        );
        sink.push_count(
            "Render Instancing Buffer Groups Uploaded",
            groups_uploaded as f64,
        );
        sink.push_count(
            "Render Instancing Visible Buffers Uploaded",
            visible_buffers_uploaded as f64,
        );
        sink.push_count(
            "Render Instancing Shadow Buffers Uploaded",
            shadow_buffers_uploaded as f64,
        );
        sink.push_count(
            "Render Instancing Visible Buffers Created",
            visible_buffers_created as f64,
        );
        sink.push_count(
            "Render Instancing Shadow Buffers Created",
            shadow_buffers_created as f64,
        );
        sink.push_count(
            "Render Instancing Shadow Buffers Reused",
            shadow_buffers_reused as f64,
        );
        sink.push_count(
            "Render Instancing Buffer Instances Uploaded",
            instances_uploaded as f64,
        );
        sink.push_count(
            "Render Instancing Buffer Shadow Instances Uploaded",
            shadow_instances_uploaded as f64,
        );
        sink.push_count(
            "Render Instancing Buffer Shadow Instances Reused",
            shadow_instances_reused as f64,
        );
        sink.push_count(
            "Render Instancing Buffer Bytes Uploaded",
            bytes_uploaded as f64,
        );
        sink.push_count("Prop Subclusters Total", subclusters_total as f64);
        sink.push_count("Prop Subclusters Visible", subclusters_visible as f64);
        sink.push_count("Prop Subclusters Queued", subclusters_queued as f64);
        sink.push_count("Prop Subcluster Draws", subcluster_draws as f64);
        sink.push_count(
            "Prop Subcluster Instances Queued",
            subcluster_instances_queued as f64,
        );
        sink.push_count(
            "Prop Subcluster Instances Culled",
            subcluster_instances_culled as f64,
        );
        let avg_instances_per_draw = if subcluster_draws > 0 {
            subcluster_instances_queued as f64 / subcluster_draws as f64
        } else {
            0.0
        };
        sink.push_count(
            "Prop Subcluster Avg Instances Per Draw",
            avg_instances_per_draw,
        );
    }
}

#[derive(Resource)]
struct PropInstancingPipeline {
    shader: Handle<Shader>,
    mesh_pipeline: MeshPipeline,
    material_layout: BindGroupLayoutDescriptor,
    gpu_cull_vertex_entries: Option<&'static [BindGroupLayoutEntry]>,
}

#[derive(Resource)]
struct PropInstancingShadowPipeline {
    shader: Handle<Shader>,
    mesh_pipeline: MeshPipeline,
    prepass_pipeline: PrepassPipeline,
    material_layout: BindGroupLayoutDescriptor,
}

fn init_prop_instancing_pipeline(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mesh_pipeline: Res<MeshPipeline>,
    prepass_pipeline: Option<Res<PrepassPipeline>>,
    render_device: Res<RenderDevice>,
    pipeline_cache: Res<PipelineCache>,
) {
    let material_layout = PropsMaterial::bind_group_layout_descriptor(&render_device);
    let _ = pipeline_cache.get_bind_group_layout(&material_layout);
    #[cfg(feature = "gpu_vegetation")]
    let gpu_cull_vertex_entries = Some(
        crate::props::gpu_vegetation_cull::gpu_cull_vertex_bind_group_entries(),
    );
    #[cfg(not(feature = "gpu_vegetation"))]
    let gpu_cull_vertex_entries = None;
    commands.insert_resource(PropInstancingPipeline {
        shader: asset_server.load(SHADER_ASSET_PATH),
        mesh_pipeline: mesh_pipeline.clone(),
        material_layout,
        gpu_cull_vertex_entries,
    });
    if let Some(prepass_pipeline) = prepass_pipeline {
        commands.insert_resource(PropInstancingShadowPipeline {
            shader: asset_server.load(SHADER_ASSET_PATH),
            mesh_pipeline: mesh_pipeline.clone(),
            prepass_pipeline: prepass_pipeline.clone(),
            material_layout: PropsMaterial::bind_group_layout_descriptor(&render_device),
        });
    }
}

fn ensure_prop_instancing_shadow_pipeline(
    mut commands: Commands,
    existing: Option<Res<PropInstancingShadowPipeline>>,
    asset_server: Res<AssetServer>,
    mesh_pipeline: Res<MeshPipeline>,
    prepass_pipeline: Option<Res<PrepassPipeline>>,
    render_device: Res<RenderDevice>,
    timing: Option<Res<RenderTimingSink>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Ensure Shadow Pipeline");
    if existing.is_some() {
        if let Some(sink) = sink {
            sink.push_count("Render Instancing Shadow Pipeline Builds", 0.0);
        }
        return;
    }
    let Some(prepass_pipeline) = prepass_pipeline else {
        if let Some(sink) = sink {
            sink.push_count("Render Instancing Shadow Pipeline Builds", 0.0);
        }
        return;
    };
    commands.insert_resource(PropInstancingShadowPipeline {
        shader: asset_server.load(SHADER_ASSET_PATH),
        mesh_pipeline: mesh_pipeline.clone(),
        prepass_pipeline: prepass_pipeline.clone(),
        material_layout: PropsMaterial::bind_group_layout_descriptor(&render_device),
    });
    if let Some(sink) = sink {
        sink.push_count("Render Instancing Shadow Pipeline Builds", 1.0);
    }
}

impl SpecializedMeshPipeline for PropInstancingPipeline {
    type Key = PropInstancingPipelineKey;

    fn specialize(
        &self,
        key: Self::Key,
        layout: &MeshVertexBufferLayoutRef,
    ) -> Result<RenderPipelineDescriptor, SpecializedMeshPipelineError> {
        let mut descriptor = self.mesh_pipeline.specialize(key.mesh_key, layout)?;
        descriptor.vertex.buffers[0] = layout.0.get_layout(&[
            Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
            Mesh::ATTRIBUTE_NORMAL.at_shader_location(1),
            Mesh::ATTRIBUTE_UV_0.at_shader_location(2),
            Mesh::ATTRIBUTE_COLOR.at_shader_location(3),
        ])?;
        descriptor.vertex.shader = self.shader.clone();
        descriptor.vertex.shader_defs.push(ShaderDefVal::UInt(
            "MATERIAL_BIND_GROUP".into(),
            MATERIAL_BIND_GROUP_INDEX as u32,
        ));
        if key.tint_enabled {
            descriptor
                .vertex
                .shader_defs
                .push("PROP_INSTANCE_TINT".into());
        }
        let blends_alpha = key
            .mesh_key
            .intersection(MeshPipelineKey::BLEND_RESERVED_BITS)
            == MeshPipelineKey::BLEND_ALPHA;
        if key.gpu_cull {
            // GPU cull: vertex shader reads instance data from storage buffer (bind group 4).
            // No instance vertex buffer layout needed.
            descriptor
                .vertex
                .shader_defs
                .push("GPU_VEGETATION".into());
            if let Some(entries) = self.gpu_cull_vertex_entries {
                descriptor.layout.push(BindGroupLayoutDescriptor {
                    label: std::borrow::Cow::Borrowed("gpu_cull_vertex_bg_layout"),
                    entries: entries.to_vec(),
                });
            }
            if let Some(fragment) = descriptor.fragment.as_mut() {
                fragment.shader = self.shader.clone();
                fragment.shader_defs.push(ShaderDefVal::UInt(
                    "MATERIAL_BIND_GROUP".into(),
                    MATERIAL_BIND_GROUP_INDEX as u32,
                ));
                if key.tint_enabled {
                    fragment.shader_defs.push("PROP_INSTANCE_TINT".into());
                }
                if blends_alpha {
                    fragment.shader_defs.push("PROP_BLEND_ALPHA".into());
                }
                fragment
                    .shader_defs
                    .push("GPU_VEGETATION".into());
            }
        } else {
            descriptor
                .vertex
                .buffers
                .push(instance_vertex_buffer_layout(key.tint_enabled));
            if let Some(fragment) = descriptor.fragment.as_mut() {
                fragment.shader = self.shader.clone();
                fragment.shader_defs.push(ShaderDefVal::UInt(
                    "MATERIAL_BIND_GROUP".into(),
                    MATERIAL_BIND_GROUP_INDEX as u32,
                ));
                if key.tint_enabled {
                    fragment.shader_defs.push("PROP_INSTANCE_TINT".into());
                }
                if blends_alpha {
                    fragment.shader_defs.push("PROP_BLEND_ALPHA".into());
                }
            }
        }
        descriptor
            .layout
            .insert(MATERIAL_BIND_GROUP_INDEX, self.material_layout.clone());
        Ok(descriptor)
    }
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct PropInstancingPipelineKey {
    mesh_key: MeshPipelineKey,
    tint_enabled: bool,
    gpu_cull: bool,
}

impl SpecializedMeshPipeline for PropInstancingShadowPipeline {
    type Key = PropInstancingPipelineKey;

    fn specialize(
        &self,
        key: Self::Key,
        layout: &MeshVertexBufferLayoutRef,
    ) -> Result<RenderPipelineDescriptor, SpecializedMeshPipelineError> {
        let mut descriptor = self.mesh_pipeline.specialize(key.mesh_key, layout)?;
        descriptor.vertex.buffers[0] = layout.0.get_layout(&[
            Mesh::ATTRIBUTE_POSITION.at_shader_location(0),
            Mesh::ATTRIBUTE_NORMAL.at_shader_location(1),
            Mesh::ATTRIBUTE_UV_0.at_shader_location(2),
            Mesh::ATTRIBUTE_COLOR.at_shader_location(3),
        ])?;
        descriptor.vertex.shader = self.shader.clone();
        descriptor.vertex.shader_defs.push(ShaderDefVal::UInt(
            "MATERIAL_BIND_GROUP".into(),
            MATERIAL_BIND_GROUP_INDEX as u32,
        ));
        if key.tint_enabled {
            descriptor
                .vertex
                .shader_defs
                .push("PROP_INSTANCE_TINT".into());
        }
        descriptor
            .vertex
            .buffers
            .push(instance_vertex_buffer_layout(key.tint_enabled));
        descriptor.fragment = None;
        descriptor.layout[0] = self.prepass_pipeline.view_layout_no_motion_vectors.clone();
        descriptor.layout[1] = self.prepass_pipeline.empty_layout.clone();
        descriptor
            .layout
            .insert(MATERIAL_BIND_GROUP_INDEX, self.material_layout.clone());
        descriptor.depth_stencil = Some(DepthStencilState {
            format: CORE_3D_DEPTH_FORMAT,
            depth_write_enabled: true,
            depth_compare: CompareFunction::GreaterEqual,
            stencil: StencilState {
                front: StencilFaceState::IGNORE,
                back: StencilFaceState::IGNORE,
                read_mask: 0,
                write_mask: 0,
            },
            bias: DepthBiasState {
                constant: 0,
                slope_scale: 0.0,
                clamp: 0.0,
            },
        });
        Ok(descriptor)
    }
}

fn instance_vertex_buffer_layout(tint_enabled: bool) -> VertexBufferLayout {
    let instance_stride = if tint_enabled {
        size_of::<PropInstance>() as u64
    } else {
        size_of::<PropInstanceNoTint>() as u64
    };
    let mut attributes = vec![
        VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: 0,
            shader_location: 4,
        },
        VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size(),
            shader_location: 5,
        },
        VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size() * 2,
            shader_location: 6,
        },
        VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size() * 3,
            shader_location: 7,
        },
    ];
    if tint_enabled {
        attributes.push(VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size() * 4,
            shader_location: 8,
        });
    }
    VertexBufferLayout {
        array_stride: instance_stride,
        step_mode: VertexStepMode::Instance,
        attributes,
    }
}

#[derive(SystemParam)]
struct QueueInstancedPropsParams<'w, 's> {
    opaque_draw_functions: Res<'w, DrawFunctions<Opaque3d>>,
    alpha_mask_draw_functions: Res<'w, DrawFunctions<AlphaMask3d>>,
    transparent_draw_functions: Res<'w, DrawFunctions<Transparent3d>>,
    pipeline: Res<'w, PropInstancingPipeline>,
    pipelines: ResMut<'w, SpecializedMeshPipelines<PropInstancingPipeline>>,
    pipeline_cache: Res<'w, PipelineCache>,
    meshes: Res<'w, RenderAssets<RenderMesh>>,
    render_mesh_instances: Res<'w, RenderMeshInstances>,
    render_materials: Res<'w, ErasedRenderAssets<PreparedMaterial>>,
    mesh_allocator: Res<'w, MeshAllocator>,
    material_meshes: Query<
        'w,
        's,
        (
            Entity,
            &'static MainEntity,
            &'static InstancedPropGroup,
            &'static InstanceBuffer,
        ),
        (With<InstancedPropGroup>, With<InstanceBuffer>),
    >,
    opaque_render_phases: ResMut<'w, ViewBinnedRenderPhases<Opaque3d>>,
    alpha_mask_render_phases: ResMut<'w, ViewBinnedRenderPhases<AlphaMask3d>>,
    transparent_render_phases: ResMut<'w, ViewSortedRenderPhases<Transparent3d>>,
    views: Query<'w, 's, (&'static ExtractedView, &'static RenderVisibleEntities)>,
    view_key_cache: Res<'w, ViewKeyCache>,
}

fn queue_instanced_props(
    mut params: QueueInstancedPropsParams,
    timing: Option<Res<RenderTimingSink>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Queue Props");
    let _main_timer = render_timing_guard(sink, "Render Instancing Queue Main CPU");
    let bench_toggles = bench_toggles.as_deref();
    if bench_toggles.is_some_and(|toggles| toggles.disable_instanced_props) {
        if let Some(sink) = sink {
            sink.push_count("Render Instancing Props Groups Examined", 0.0);
            sink.push_count("Render Instancing Props Groups Visible", 0.0);
            sink.push_count("Render Instancing Props Groups Queued", 0.0);
            sink.push_count("Render Instancing Queue Draws", 0.0);
            sink.push_count("Render Instancing Queue Instances", 0.0);
            sink.push_count("Render Instancing Props Queued Opaque", 0.0);
            sink.push_count("Render Instancing Props Queued AlphaMask", 0.0);
            sink.push_count("Render Instancing Props Queued Transparent", 0.0);
            sink.push_count("Render Instancing Props Queued Total", 0.0);
        }
        return;
    }
    let collect_diagnostics = sink.is_some();
    let groups_examined = if collect_diagnostics {
        params.material_meshes.iter().count()
    } else {
        0
    };
    let mut views_seen = 0usize;
    let mut phase_views = 0usize;
    let mut visible_candidates = 0usize;
    let mut groups_visible = 0usize;
    let mut opaque_queued = 0usize;
    let mut alpha_mask_queued = 0usize;
    let mut transparent_queued = 0usize;
    let mut opaque_instances_queued = 0usize;
    let mut alpha_mask_instances_queued = 0usize;
    let mut transparent_instances_queued = 0usize;
    let mut instances_queued = 0usize;
    let mut groups_1_instance = 0usize;
    let mut groups_2_to_4_instances = 0usize;
    let mut groups_5_to_16_instances = 0usize;
    let mut groups_17_to_64_instances = 0usize;
    let mut groups_65_plus_instances = 0usize;
    let mut bucket_stats: Option<HashMap<InstancedPropBucketKey, InstancedPropBucketStats>> =
        collect_diagnostics.then(HashMap::new);

    let opaque_draw_function = params
        .opaque_draw_functions
        .read()
        .id::<DrawInstancedProp>();
    let alpha_mask_draw_function = params
        .alpha_mask_draw_functions
        .read()
        .id::<DrawInstancedProp>();
    let transparent_draw_function = params
        .transparent_draw_functions
        .read()
        .id::<DrawInstancedProp>();

    for (view, visible_entities) in &params.views {
        views_seen += 1;
        let (Some(opaque_phase), Some(alpha_mask_phase), Some(transparent_phase)) = (
            params
                .opaque_render_phases
                .get_mut(&view.retained_view_entity),
            params
                .alpha_mask_render_phases
                .get_mut(&view.retained_view_entity),
            params
                .transparent_render_phases
                .get_mut(&view.retained_view_entity),
        ) else {
            continue;
        };
        phase_views += 1;
        let Some(view_key) = params.view_key_cache.get(&view.retained_view_entity) else {
            continue;
        };
        let rangefinder = view.rangefinder3d();

        for (entity, main_entity) in visible_entities.iter::<Mesh3d>().copied() {
            visible_candidates += 1;
            let Ok((_, group_main_entity, group, instance_buffer)) =
                params.material_meshes.get(entity)
            else {
                continue;
            };
            if *group_main_entity != main_entity {
                continue;
            }
            groups_visible += 1;
            if instance_buffer.length == 0 {
                continue;
            }
            let Some(mesh_instance) = params
                .render_mesh_instances
                .render_mesh_queue_data(main_entity)
            else {
                continue;
            };
            let Some(material) = params.render_materials.get(group.material.id()) else {
                continue;
            };
            let Some(mesh) = params.meshes.get(mesh_instance.mesh_asset_id) else {
                continue;
            };
            let phase = classify_instanced_prop_render_phase(group, material, bench_toggles);
            let mesh_key = instanced_prop_mesh_key_for_phase(
                *view_key
                    | MeshPipelineKey::from_bits_retain(mesh.key_bits.bits())
                    | MeshPipelineKey::from_primitive_topology(mesh.primitive_topology()),
                phase,
                group,
                material,
            );
            let key = PropInstancingPipelineKey {
                mesh_key,
                tint_enabled: group.tint_enabled,
                gpu_cull: instance_buffer.gpu_cull_draw_args_buffer.is_some(),
            };
            let Ok(pipeline_id) = params.pipelines.specialize(
                &params.pipeline_cache,
                &params.pipeline,
                key,
                &mesh.layout,
            ) else {
                continue;
            };
            let (vertex_slab, index_slab) = params
                .mesh_allocator
                .mesh_slabs(&mesh_instance.mesh_asset_id);
            let material_bind_group_index = Some(material.binding.group.0);
            let group_instances = instance_buffer.length;

            match phase {
                InstancedPropRenderPhase::Opaque => {
                    opaque_phase.add(
                        Opaque3dBatchSetKey {
                            pipeline: pipeline_id,
                            draw_function: opaque_draw_function,
                            material_bind_group_index,
                            vertex_slab: vertex_slab.unwrap_or_default(),
                            index_slab,
                            lightmap_slab: mesh_instance
                                .shared
                                .lightmap_slab_index
                                .map(|index| *index),
                        },
                        Opaque3dBinKey {
                            asset_id: mesh_instance.mesh_asset_id.into(),
                        },
                        (entity, main_entity),
                        mesh_instance.current_uniform_index,
                        BinnedRenderPhaseType::UnbatchableMesh,
                        Default::default(),
                    );
                    opaque_queued += 1;
                    opaque_instances_queued += group_instances;
                }
                InstancedPropRenderPhase::AlphaMask => {
                    alpha_mask_phase.add(
                        OpaqueNoLightmap3dBatchSetKey {
                            pipeline: pipeline_id,
                            draw_function: alpha_mask_draw_function,
                            material_bind_group_index,
                            vertex_slab: vertex_slab.unwrap_or_default(),
                            index_slab,
                        },
                        OpaqueNoLightmap3dBinKey {
                            asset_id: mesh_instance.mesh_asset_id.into(),
                        },
                        (entity, main_entity),
                        mesh_instance.current_uniform_index,
                        BinnedRenderPhaseType::UnbatchableMesh,
                        Default::default(),
                    );
                    alpha_mask_queued += 1;
                    alpha_mask_instances_queued += group_instances;
                }
                InstancedPropRenderPhase::Transparent => {
                    transparent_phase.add(Transparent3d {
                        entity: (entity, main_entity),
                        pipeline: pipeline_id,
                        draw_function: transparent_draw_function,
                        distance: rangefinder.distance(&mesh_instance.center),
                        batch_range: 0..1,
                        extra_index: PhaseItemExtraIndex::None,
                        indexed: index_slab.is_some(),
                    });
                    transparent_queued += 1;
                    transparent_instances_queued += group_instances;
                }
            }
            instances_queued += group_instances;
            match group_instances {
                0 => {}
                1 => groups_1_instance += 1,
                2..=4 => groups_2_to_4_instances += 1,
                5..=16 => groups_5_to_16_instances += 1,
                17..=64 => groups_17_to_64_instances += 1,
                _ => groups_65_plus_instances += 1,
            }
            if let Some(bucket_stats) = bucket_stats.as_mut() {
                let stats = bucket_stats
                    .entry(InstancedPropBucketKey {
                        mesh: group.mesh.id(),
                        material: group.material.id(),
                        phase,
                        prop_type_mask: group.diagnostic_prop_type_mask,
                    })
                    .or_default();
                stats.draws += 1;
                stats.instances += group_instances;
            }
        }
    }

    let draws_queued = opaque_queued + alpha_mask_queued + transparent_queued;
    if let Some(sink) = sink {
        sink.push_count(
            "Render Instancing Props Groups Examined",
            groups_examined as f64,
        );
        sink.push_count(
            "Render Instancing Props Groups Visible",
            groups_visible as f64,
        );
        sink.push_count("Render Instancing Props Groups Queued", draws_queued as f64);
        sink.push_count("Render Instancing Queue Views", views_seen as f64);
        sink.push_count("Render Instancing Queue Phase Views", phase_views as f64);
        sink.push_count(
            "Render Instancing Queue Visible Candidates",
            visible_candidates as f64,
        );
        sink.push_count("Render Instancing Queue Draws", draws_queued as f64);
        sink.push_count("Render Instancing Queue Instances", instances_queued as f64);
        sink.push_count(
            "Render Instancing Props Queued Opaque",
            opaque_queued as f64,
        );
        sink.push_count(
            "Render Instancing Props Queued AlphaMask",
            alpha_mask_queued as f64,
        );
        sink.push_count(
            "Render Instancing Props Queued Transparent",
            transparent_queued as f64,
        );
        sink.push_count("Render Instancing Props Queued Total", draws_queued as f64);
        sink.push_count(
            "Render Instancing Props Queued Instances Opaque",
            opaque_instances_queued as f64,
        );
        sink.push_count(
            "Render Instancing Props Queued Instances AlphaMask",
            alpha_mask_instances_queued as f64,
        );
        sink.push_count(
            "Render Instancing Props Queued Instances Transparent",
            transparent_instances_queued as f64,
        );
        sink.push_count(
            "Render Instancing Props Groups 1 Instance",
            groups_1_instance as f64,
        );
        sink.push_count(
            "Render Instancing Props Groups 2-4 Instances",
            groups_2_to_4_instances as f64,
        );
        sink.push_count(
            "Render Instancing Props Groups 5-16 Instances",
            groups_5_to_16_instances as f64,
        );
        sink.push_count(
            "Render Instancing Props Groups 17-64 Instances",
            groups_17_to_64_instances as f64,
        );
        sink.push_count(
            "Render Instancing Props Groups 65+ Instances",
            groups_65_plus_instances as f64,
        );
        if let Some(bucket_stats) = bucket_stats {
            push_top_instanced_prop_bucket_counts(sink, bucket_stats);
        }
    }
}

fn push_top_instanced_prop_bucket_counts(
    sink: &RenderTimingSink,
    bucket_stats: HashMap<InstancedPropBucketKey, InstancedPropBucketStats>,
) {
    const TOP_BUCKETS: usize = 8;
    let mut buckets: Vec<_> = bucket_stats.into_iter().collect();
    buckets.sort_by(|(left_key, left), (right_key, right)| {
        right
            .draws
            .cmp(&left.draws)
            .then_with(|| right.instances.cmp(&left.instances))
            .then_with(|| left_key.phase.label().cmp(right_key.phase.label()))
            .then_with(|| asset_id_label(left_key.mesh).cmp(&asset_id_label(right_key.mesh)))
            .then_with(|| {
                asset_id_label(left_key.material).cmp(&asset_id_label(right_key.material))
            })
    });

    let reported = buckets.len().min(TOP_BUCKETS);
    sink.push_count("Render Instancing Top Buckets Reported", reported as f64);
    for (index, (key, stats)) in buckets.into_iter().take(TOP_BUCKETS).enumerate() {
        let label = format!(
            "Render Instancing Top Bucket {:02} phase={} category={} mesh={} material={}",
            index + 1,
            key.phase.label(),
            prop_type_mask_label(key.prop_type_mask),
            asset_id_label(key.mesh),
            asset_id_label(key.material),
        );
        sink.push_count(format!("{label} Draws"), stats.draws as f64);
        sink.push_count(format!("{label} Instances"), stats.instances as f64);
        let avg_instances = if stats.draws == 0 {
            0.0
        } else {
            stats.instances as f64 / stats.draws as f64
        };
        sink.push_count(format!("{label} Avg Instances Per Draw"), avg_instances);
    }
}

fn asset_id_label<A: Asset>(asset_id: AssetId<A>) -> String {
    let debug = format!("{asset_id:?}");
    if let Some(after_index) = debug.split("index: ").nth(1) {
        if let Some((index, after_generation_label)) = after_index.split_once(", generation: ") {
            let generation = after_generation_label.trim_end_matches('}');
            return format!("index{index}_gen{generation}");
        }
    }
    if let Some(after_uuid) = debug.split("uuid: ").nth(1) {
        return format!("uuid{}", after_uuid.trim_end_matches('}'));
    }
    debug.replace([',', ' '], "")
}

fn classify_instanced_prop_render_phase(
    group: &InstancedPropGroup,
    material: &PreparedMaterial,
    bench_toggles: Option<&BenchRenderToggles>,
) -> InstancedPropRenderPhase {
    if bench_toggles.is_some_and(|toggles| toggles.force_instanced_props_transparent) {
        return InstancedPropRenderPhase::Transparent;
    }

    let uses_blended_alpha = group_uses_blended_alpha(group);

    if bench_toggles.is_some_and(|toggles| toggles.force_instanced_props_opaque) {
        if !uses_blended_alpha {
            return InstancedPropRenderPhase::Opaque;
        }
    }

    if bench_toggles.is_some_and(|toggles| toggles.force_cutout_props_alpha_mask) {
        if !uses_blended_alpha && instanced_prop_shader_uses_cutout() {
            return InstancedPropRenderPhase::AlphaMask;
        }
    }

    if group.instances.len() < MIN_BINNED_PROP_GROUP_INSTANCES {
        return InstancedPropRenderPhase::Transparent;
    }
    if uses_blended_alpha {
        return InstancedPropRenderPhase::Transparent;
    }

    match material.properties.render_phase_type {
        RenderPhaseType::Opaque if instanced_prop_shader_uses_cutout() => {
            InstancedPropRenderPhase::AlphaMask
        }
        RenderPhaseType::Opaque => InstancedPropRenderPhase::Opaque,
        RenderPhaseType::AlphaMask => InstancedPropRenderPhase::AlphaMask,
        RenderPhaseType::Transmissive | RenderPhaseType::Transparent => {
            InstancedPropRenderPhase::Transparent
        }
    }
}

fn instanced_prop_mesh_key_for_phase(
    mut mesh_key: MeshPipelineKey,
    phase: InstancedPropRenderPhase,
    group: &InstancedPropGroup,
    material: &PreparedMaterial,
) -> MeshPipelineKey {
    match phase {
        InstancedPropRenderPhase::Opaque => {
            if instanced_prop_shader_uses_cutout() {
                mesh_key |= MeshPipelineKey::MAY_DISCARD;
            }
        }
        InstancedPropRenderPhase::AlphaMask => {
            mesh_key |= MeshPipelineKey::MAY_DISCARD;
        }
        InstancedPropRenderPhase::Transparent => {
            if group_uses_blended_alpha(group)
                || matches!(
                    material.properties.render_phase_type,
                    RenderPhaseType::Transparent | RenderPhaseType::Transmissive
                )
            {
                mesh_key |= MeshPipelineKey::BLEND_ALPHA;
            } else if instanced_prop_shader_uses_cutout() {
                mesh_key |= MeshPipelineKey::MAY_DISCARD;
            }
        }
    }
    mesh_key
}

fn group_uses_blended_alpha(group: &InstancedPropGroup) -> bool {
    group.tint_enabled
        && group
            .instances
            .iter()
            .any(|instance| instance.tint[3] > 0.01 && instance.tint[3] < 0.999)
}

fn instanced_prop_shader_uses_cutout() -> bool {
    true
}

fn queue_instanced_prop_shadows(
    shadow_draw_functions: Res<DrawFunctions<Shadow>>,
    pipeline: Option<Res<PropInstancingShadowPipeline>>,
    mut pipelines: ResMut<SpecializedMeshPipelines<PropInstancingShadowPipeline>>,
    pipeline_cache: Res<PipelineCache>,
    meshes: Res<RenderAssets<RenderMesh>>,
    render_mesh_instances: Res<RenderMeshInstances>,
    mesh_allocator: Res<MeshAllocator>,
    gpu_preprocessing_support: Res<GpuPreprocessingSupport>,
    groups: Query<(&InstancedPropGroup, &InstanceBuffer)>,
    mut shadow_render_phases: ResMut<ViewBinnedRenderPhases<Shadow>>,
    view_lights: Query<(Entity, &ViewLightEntities, Option<&RenderLayers>), With<ExtractedView>>,
    view_light_entities: Query<(&LightEntity, &ExtractedView)>,
    mut light_visible_entities: ParamSet<(
        Query<&RenderCascadesVisibleEntities, With<ExtractedDirectionalLight>>,
        Query<&RenderCubemapVisibleEntities, With<ExtractedPointLight>>,
        Query<&RenderVisibleMeshEntities, With<ExtractedPointLight>>,
        Res<CascadeShadowBuffers>,
    )>,
    view_key_cache: Res<ViewKeyCache>,
    timing: Option<Res<RenderTimingSink>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Queue Shadows");
    let _shadow_timer = render_timing_guard(sink, "Render Instancing Queue Shadows CPU");
    if bench_toggles
        .is_some_and(|toggles| toggles.disable_instanced_props || toggles.disable_shadows)
    {
        if let Some(sink) = sink {
            sink.push_count("Render Instancing Shadow Views", 0.0);
            sink.push_count("Render Instancing Shadow Lights", 0.0);
            sink.push_count("Render Instancing Shadow Draws", 0.0);
            sink.push_count("Render Instancing Shadow Instances", 0.0);
        }
        return;
    }
    let Some(pipeline) = pipeline else {
        if let Some(sink) = sink {
            sink.push_count("Render Instancing Shadow Draws", 0.0);
            sink.push_count("Render Instancing Shadow Instances", 0.0);
        }
        return;
    };
    let mut shadow_views_seen = 0usize;
    let mut lights_seen = 0usize;
    let mut draws_queued = 0usize;
    let mut instances_queued = 0usize;
    let mut cascade_buffer_hits = 0usize;
    let mut cascade_buffer_fallbacks = 0usize;
    let mut per_cascade_directional_draws = 0usize;
    let mut per_cascade_directional_instances = 0usize;
    let draw_function = shadow_draw_functions.read().id::<DrawInstancedPropShadow>();

    for (camera_entity, view_lights, camera_layers) in &view_lights {
        shadow_views_seen += 1;
        for view_light_entity in view_lights.lights.iter().copied() {
            lights_seen += 1;
            let Ok((light_entity, extracted_view_light)) =
                view_light_entities.get(view_light_entity)
            else {
                continue;
            };
            let Some(shadow_phase) =
                shadow_render_phases.get_mut(&extracted_view_light.retained_view_entity)
            else {
                continue;
            };
            let Some(view_key) = view_key_cache.get(&extracted_view_light.retained_view_entity)
            else {
                continue;
            };

            let visible_entities: Vec<_> = match light_entity {
                LightEntity::Directional {
                    light_entity,
                    cascade_index,
                } => {
                    let query = light_visible_entities.p0();
                    query
                        .get(*light_entity)
                        .ok()
                        .and_then(|entities| entities.entities.get(&camera_entity))
                        .and_then(|cascades| cascades.get(*cascade_index))
                        .map(|entities| entities.iter().copied().collect())
                        .unwrap_or_default()
                }
                LightEntity::Point {
                    light_entity,
                    face_index,
                } => {
                    let query = light_visible_entities.p1();
                    query
                        .get(*light_entity)
                        .ok()
                        .map(|entities| entities.get(*face_index).iter().copied().collect())
                        .unwrap_or_default()
                }
                LightEntity::Spot { light_entity } => {
                    let query = light_visible_entities.p2();
                    query
                        .get(*light_entity)
                        .ok()
                        .map(|entities| entities.iter().copied().collect())
                        .unwrap_or_default()
                }
            };
            if visible_entities.is_empty() {
                continue;
            }

            let is_directional = matches!(light_entity, LightEntity::Directional { .. });
            let cascade_index = match light_entity {
                LightEntity::Directional {
                    cascade_index,
                    ..
                } => Some(*cascade_index),
                _ => None,
            };

            for (render_entity, main_entity) in visible_entities {
                let Ok((group, instance_buffer)) = groups.get(render_entity) else {
                    continue;
                };
                if instance_buffer.shadow_length == 0 {
                    continue;
                }
                if is_directional {
                    if cascade_index.is_some_and(|ci| {
                        light_visible_entities.p3()
                            .buffers
                            .contains_key(&(render_entity, ci))
                    }) {
                        cascade_buffer_hits += 1;
                    } else {
                        cascade_buffer_fallbacks += 1;
                    }
                }
                let Some(mesh_instance) = render_mesh_instances.render_mesh_queue_data(main_entity)
                else {
                    continue;
                };
                if !mesh_instance
                    .flags
                    .contains(RenderMeshInstanceFlags::SHADOW_CASTER)
                {
                    continue;
                }
                let mesh_layers = mesh_instance
                    .shared
                    .render_layers
                    .as_ref()
                    .unwrap_or_default();
                let camera_layers = camera_layers.unwrap_or_default();
                if !camera_layers.intersects(mesh_layers) {
                    continue;
                }
                let Some(mesh) = meshes.get(mesh_instance.mesh_asset_id) else {
                    continue;
                };
                let mesh_key = *view_key
                    | MeshPipelineKey::from_bits_retain(mesh.key_bits.bits())
                    | MeshPipelineKey::from_primitive_topology(mesh.primitive_topology());
                let key = PropInstancingPipelineKey {
                    mesh_key,
                    tint_enabled: group.tint_enabled,
                    gpu_cull: false,
                };
                let Ok(pipeline_id) =
                    pipelines.specialize(&pipeline_cache, &pipeline, key, &mesh.layout)
                else {
                    continue;
                };
                let (vertex_slab, index_slab) =
                    mesh_allocator.mesh_slabs(&mesh_instance.mesh_asset_id);
                let batch_set_key = ShadowBatchSetKey {
                    pipeline: pipeline_id,
                    draw_function,
                    material_bind_group_index: None,
                    vertex_slab: vertex_slab.unwrap_or_default(),
                    index_slab,
                };
                shadow_phase.add(
                    batch_set_key,
                    ShadowBinKey {
                        asset_id: mesh_instance.mesh_asset_id.into(),
                    },
                    (render_entity, main_entity),
                    mesh_instance.current_uniform_index,
                    BinnedRenderPhaseType::mesh(
                        mesh_instance.should_batch(),
                        &gpu_preprocessing_support,
                    ),
                    Default::default(),
                );
                draws_queued += 1;
                instances_queued += instance_buffer.shadow_length;
                if is_directional {
                    per_cascade_directional_draws += 1;
                    per_cascade_directional_instances += instance_buffer.shadow_length;
                }
            }
        }
    }

    if let Some(sink) = sink {
        sink.push_count("Render Instancing Shadow Views", shadow_views_seen as f64);
        sink.push_count("Render Instancing Shadow Lights", lights_seen as f64);
        sink.push_count("Render Instancing Shadow Draws", draws_queued as f64);
        sink.push_count(
            "Render Instancing Shadow Instances",
            instances_queued as f64,
        );
        sink.push_count(
            "Render Instancing Shadow Cascade Buffer Hits",
            cascade_buffer_hits as f64,
        );
        sink.push_count(
            "Render Instancing Shadow Cascade Buffer Fallbacks",
            cascade_buffer_fallbacks as f64,
        );
        sink.push_count(
            "Render Instancing Shadow Per-Cascade Directional Draws",
            per_cascade_directional_draws as f64,
        );
        sink.push_count(
            "Render Instancing Shadow Per-Cascade Directional Instances",
            per_cascade_directional_instances as f64,
        );
    }
}

type DrawInstancedProp = (
    SetItemPipeline,
    SetMeshViewBindGroup<0>,
    SetMeshViewBindingArrayBindGroup<1>,
    SetMeshBindGroup<2>,
    SetInstancedPropMaterialBindGroup<MATERIAL_BIND_GROUP_INDEX>,
    SetGpuCullBindGroup<4>,
    DrawMeshInstanced,
);

type DrawInstancedPropShadow = (
    SetItemPipeline,
    SetPrepassViewBindGroup<0>,
    SetPrepassViewEmptyBindGroup<1>,
    SetMeshBindGroup<2>,
    DrawMeshInstancedShadow,
);

struct SetInstancedPropMaterialBindGroup<const I: usize>;

impl<P: PhaseItem, const I: usize> RenderCommand<P> for SetInstancedPropMaterialBindGroup<I> {
    type Param = (
        SRes<ErasedRenderAssets<PreparedMaterial>>,
        SRes<MaterialBindGroupAllocators>,
    );
    type ViewQuery = ();
    type ItemQuery = Read<InstancedPropGroup>;

    fn render<'w>(
        _item: &P,
        _view: (),
        group: Option<&'w InstancedPropGroup>,
        (materials, allocators): SystemParamItem<'w, '_, Self::Param>,
        pass: &mut TrackedRenderPass<'w>,
    ) -> RenderCommandResult {
        let Some(group) = group else {
            return RenderCommandResult::Skip;
        };
        let Some(material) = materials.into_inner().get(group.material.id()) else {
            return RenderCommandResult::Skip;
        };
        let Some(allocator) = allocators.into_inner().get(&TypeId::of::<PropsMaterial>()) else {
            return RenderCommandResult::Skip;
        };
        let Some(slab) = allocator.get(material.binding.group) else {
            return RenderCommandResult::Skip;
        };
        let Some(bind_group) = slab.bind_group() else {
            return RenderCommandResult::Skip;
        };
        pass.set_bind_group(I, bind_group, &[]);
        RenderCommandResult::Success
    }
}

/// Marker component: entity uses GPU cull path (indirect draw).
#[cfg(feature = "gpu_vegetation")]
#[derive(Component, Clone, Copy)]
pub struct GpuCullActive;

#[cfg(feature = "gpu_vegetation")]
mod gpu_cull_bind_group {
    use super::*;
    use bevy::render::render_phase::{PhaseItem, RenderCommand, RenderCommandResult, TrackedRenderPass};
    use bevy::ecs::system::SystemParamItem;

    /// Bind group 4: visible instances storage buffer for GPU cull vertex shader path.
    pub struct SetGpuCullBindGroup<const I: usize>;

    impl<P: PhaseItem, const I: usize> RenderCommand<P> for SetGpuCullBindGroup<I> {
        type Param = SRes<crate::props::gpu_vegetation_cull::GpuVegetationCullBuffers>;
        type ViewQuery = ();
        type ItemQuery = Read<GpuCullActive>;

        fn render<'w>(
            _item: &P,
            _view: (),
            active: Option<&'w GpuCullActive>,
            cull_buffers: SystemParamItem<'w, '_, Self::Param>,
            pass: &mut TrackedRenderPass<'w>,
        ) -> RenderCommandResult {
            if active.is_none() {
                return RenderCommandResult::Skip;
            }
            let cull_buffers = cull_buffers.into_inner();
            let Some(bind_group) = &cull_buffers.vertex_bind_group else {
                return RenderCommandResult::Skip;
            };
            pass.set_bind_group(I, bind_group, &[]);
            RenderCommandResult::Success
        }
    }
}

#[cfg(not(feature = "gpu_vegetation"))]
mod gpu_cull_bind_group {
    use bevy::render::render_phase::{PhaseItem, RenderCommand, RenderCommandResult, TrackedRenderPass};
    use bevy::ecs::system::SystemParamItem;

    pub struct SetGpuCullBindGroup<const I: usize>;

    impl<P: PhaseItem, const I: usize> RenderCommand<P> for SetGpuCullBindGroup<I> {
        type Param = ();
        type ViewQuery = ();
        type ItemQuery = ();

        fn render<'w>(
            _item: &P,
            _view: (),
            _entity: Option<()>,
            _params: SystemParamItem<'w, '_, Self::Param>,
            _pass: &mut TrackedRenderPass<'w>,
        ) -> RenderCommandResult {
            RenderCommandResult::Skip
        }
    }
}

use gpu_cull_bind_group::SetGpuCullBindGroup;

struct DrawMeshInstanced;

impl<P: PhaseItem> RenderCommand<P> for DrawMeshInstanced {
    type Param = (
        SRes<RenderAssets<RenderMesh>>,
        SRes<RenderMeshInstances>,
        SRes<MeshAllocator>,
    );
    type ViewQuery = ();
    type ItemQuery = Read<InstanceBuffer>;

    fn render<'w>(
        item: &P,
        _view: (),
        instance_buffer: Option<&'w InstanceBuffer>,
        (meshes, render_mesh_instances, mesh_allocator): SystemParamItem<'w, '_, Self::Param>,
        pass: &mut TrackedRenderPass<'w>,
    ) -> RenderCommandResult {
        let mesh_allocator = mesh_allocator.into_inner();
        let Some(mesh_instance) = render_mesh_instances.render_mesh_queue_data(item.main_entity())
        else {
            return RenderCommandResult::Skip;
        };
        let Some(gpu_mesh) = meshes.into_inner().get(mesh_instance.mesh_asset_id) else {
            return RenderCommandResult::Skip;
        };
        let Some(instance_buffer) = instance_buffer else {
            return RenderCommandResult::Skip;
        };
        let Some(vertex_buffer_slice) =
            mesh_allocator.mesh_vertex_slice(&mesh_instance.mesh_asset_id)
        else {
            return RenderCommandResult::Skip;
        };

        pass.set_vertex_buffer(0, vertex_buffer_slice.buffer.slice(..));

        // GPU cull path: use draw_indexed_indirect.
        // Instance data comes from bind group 4 (storage buffer), not vertex buffer 1.
        if let Some(ref draw_args_buffer) = instance_buffer.gpu_cull_draw_args_buffer {
            match &gpu_mesh.buffer_info {
                RenderMeshBufferInfo::Indexed {
                    index_format,
                    ..
                } => {
                    let Some(index_buffer_slice) =
                        mesh_allocator.mesh_index_slice(&mesh_instance.mesh_asset_id)
                    else {
                        return RenderCommandResult::Skip;
                    };
                    pass.set_index_buffer(index_buffer_slice.buffer.slice(..), *index_format);
                    pass.draw_indexed_indirect(
                        draw_args_buffer,
                        instance_buffer.gpu_cull_draw_args_offset,
                    );
                }
                RenderMeshBufferInfo::NonIndexed => {
                    pass.draw_indirect(
                        draw_args_buffer,
                        instance_buffer.gpu_cull_draw_args_offset,
                    );
                }
            }
            return RenderCommandResult::Success;
        }

        // CPU path: standard instanced draw.
        pass.set_vertex_buffer(1, instance_buffer.buffer.slice(..));

        match &gpu_mesh.buffer_info {
            RenderMeshBufferInfo::Indexed {
                index_format,
                count,
            } => {
                let Some(index_buffer_slice) =
                    mesh_allocator.mesh_index_slice(&mesh_instance.mesh_asset_id)
                else {
                    return RenderCommandResult::Skip;
                };
                pass.set_index_buffer(index_buffer_slice.buffer.slice(..), *index_format);
                pass.draw_indexed(
                    index_buffer_slice.range.start..(index_buffer_slice.range.start + count),
                    vertex_buffer_slice.range.start as i32,
                    0..instance_buffer.length as u32,
                );
            }
            RenderMeshBufferInfo::NonIndexed => {
                pass.draw(vertex_buffer_slice.range, 0..instance_buffer.length as u32);
            }
        }
        RenderCommandResult::Success
    }
}

struct DrawMeshInstancedShadow;

#[cfg(feature = "gpu_vegetation")]
impl<P: PhaseItem> RenderCommand<P> for DrawMeshInstancedShadow {
    type Param = (
        SRes<RenderAssets<RenderMesh>>,
        SRes<RenderMeshInstances>,
        SRes<MeshAllocator>,
        SRes<CascadeShadowBuffers>,
        SRes<crate::props::gpu_vegetation_cull::GpuVegetationCullBuffers>,
    );
    type ViewQuery = Read<LightEntity>;
    type ItemQuery = (Read<InstanceBuffer>, Option<Read<GpuCullActive>>);

    fn render<'w>(
        item: &P,
        light_entity: &'w LightEntity,
        query_item: Option<(&'w InstanceBuffer, Option<&'w GpuCullActive>)>,
        (meshes, render_mesh_instances, mesh_allocator, cascade_buffers, gpu_cull_buffers): SystemParamItem<
            'w,
            '_,
            Self::Param,
        >,
        pass: &mut TrackedRenderPass<'w>,
    ) -> RenderCommandResult {
        let mesh_allocator = mesh_allocator.into_inner();
        let Some(mesh_instance) = render_mesh_instances.render_mesh_queue_data(item.main_entity())
        else {
            return RenderCommandResult::Skip;
        };
        let Some(gpu_mesh) = meshes.into_inner().get(mesh_instance.mesh_asset_id) else {
            return RenderCommandResult::Skip;
        };
        let Some((instance_buffer, gpu_cull_active)) = query_item else {
            return RenderCommandResult::Skip;
        };

        let render_entity = item.entity();
        let cascade_index = match light_entity {
            LightEntity::Directional {
                cascade_index,
                ..
            } => Some(*cascade_index),
            _ => None,
        };

        let gpu_cull = gpu_cull_buffers.into_inner();

        // GPU cull path: use compute-written shadow buffers.
        if gpu_cull_active.is_some() {
            if let (Some(ci), Some(group_idx)) = (
                cascade_index,
                gpu_cull.group_index_for_entity(render_entity),
            ) {
                if let Some(sc) = gpu_cull.shadow_cascades.get(ci) {
                    if let (Some(visible_buf), Some(draw_args_buf)) =
                        (&sc.visible_buffer, &sc.draw_args_buffer)
                    {
                        let Some(vertex_buffer_slice) =
                            mesh_allocator.mesh_vertex_slice(&mesh_instance.mesh_asset_id)
                        else {
                            return RenderCommandResult::Skip;
                        };
                        pass.set_vertex_buffer(0, vertex_buffer_slice.buffer.slice(..));
                        pass.set_vertex_buffer(1, visible_buf.slice(..));

                        let args_offset =
                            group_idx as u64 * std::mem::size_of::<crate::props::gpu_vegetation_cull::GpuDrawArgsTemplate>() as u64;

                        match &gpu_mesh.buffer_info {
                            RenderMeshBufferInfo::Indexed {
                                index_format,
                                ..
                            } => {
                                let Some(index_buffer_slice) =
                                    mesh_allocator.mesh_index_slice(&mesh_instance.mesh_asset_id)
                                else {
                                    return RenderCommandResult::Skip;
                                };
                                pass.set_index_buffer(
                                    index_buffer_slice.buffer.slice(..),
                                    *index_format,
                                );
                                pass.draw_indexed_indirect(draw_args_buf, args_offset);
                            }
                            RenderMeshBufferInfo::NonIndexed => {
                                pass.draw_indirect(draw_args_buf, args_offset);
                            }
                        }
                        return RenderCommandResult::Success;
                    }
                }
            }
        }

        // CPU path: standard shadow buffer.
        let cascade_buffers_ref = cascade_buffers.into_inner();
        let (shadow_buf, shadow_len) = if let Some(ci) = cascade_index {
            if let Some(entry) = cascade_buffers_ref.buffers.get(&(render_entity, ci)) {
                (&entry.buffer, entry.length)
            } else {
                (&instance_buffer.shadow_buffer, instance_buffer.shadow_length)
            }
        } else {
            (&instance_buffer.shadow_buffer, instance_buffer.shadow_length)
        };

        if shadow_len == 0 {
            return RenderCommandResult::Skip;
        }
        let Some(vertex_buffer_slice) =
            mesh_allocator.mesh_vertex_slice(&mesh_instance.mesh_asset_id)
        else {
            return RenderCommandResult::Skip;
        };

        pass.set_vertex_buffer(0, vertex_buffer_slice.buffer.slice(..));
        pass.set_vertex_buffer(1, shadow_buf.slice(..));

        match &gpu_mesh.buffer_info {
            RenderMeshBufferInfo::Indexed {
                index_format,
                count,
            } => {
                let Some(index_buffer_slice) =
                    mesh_allocator.mesh_index_slice(&mesh_instance.mesh_asset_id)
                else {
                    return RenderCommandResult::Skip;
                };
                pass.set_index_buffer(index_buffer_slice.buffer.slice(..), *index_format);
                pass.draw_indexed(
                    index_buffer_slice.range.start..(index_buffer_slice.range.start + count),
                    vertex_buffer_slice.range.start as i32,
                    0..shadow_len as u32,
                );
            }
            RenderMeshBufferInfo::NonIndexed => {
                pass.draw(vertex_buffer_slice.range, 0..shadow_len as u32);
            }
        }
        RenderCommandResult::Success
    }
}

#[cfg(not(feature = "gpu_vegetation"))]
impl<P: PhaseItem> RenderCommand<P> for DrawMeshInstancedShadow {
    type Param = (
        SRes<RenderAssets<RenderMesh>>,
        SRes<RenderMeshInstances>,
        SRes<MeshAllocator>,
        SRes<CascadeShadowBuffers>,
    );
    type ViewQuery = Read<LightEntity>;
    type ItemQuery = Read<InstanceBuffer>;

    fn render<'w>(
        item: &P,
        light_entity: &'w LightEntity,
        instance_buffer: Option<&'w InstanceBuffer>,
        (meshes, render_mesh_instances, mesh_allocator, cascade_buffers): SystemParamItem<
            'w,
            '_,
            Self::Param,
        >,
        pass: &mut TrackedRenderPass<'w>,
    ) -> RenderCommandResult {
        let mesh_allocator = mesh_allocator.into_inner();
        let Some(mesh_instance) = render_mesh_instances.render_mesh_queue_data(item.main_entity())
        else {
            return RenderCommandResult::Skip;
        };
        let Some(gpu_mesh) = meshes.into_inner().get(mesh_instance.mesh_asset_id) else {
            return RenderCommandResult::Skip;
        };
        let Some(instance_buffer) = instance_buffer else {
            return RenderCommandResult::Skip;
        };

        let render_entity = item.entity();
        let cascade_index = match light_entity {
            LightEntity::Directional {
                cascade_index,
                ..
            } => Some(*cascade_index),
            _ => None,
        };
        let cascade_buffers_ref = cascade_buffers.into_inner();
        let (shadow_buf, shadow_len) = if let Some(ci) = cascade_index {
            if let Some(entry) = cascade_buffers_ref.buffers.get(&(render_entity, ci)) {
                (&entry.buffer, entry.length)
            } else {
                (&instance_buffer.shadow_buffer, instance_buffer.shadow_length)
            }
        } else {
            (&instance_buffer.shadow_buffer, instance_buffer.shadow_length)
        };

        if shadow_len == 0 {
            return RenderCommandResult::Skip;
        }
        let Some(vertex_buffer_slice) =
            mesh_allocator.mesh_vertex_slice(&mesh_instance.mesh_asset_id)
        else {
            return RenderCommandResult::Skip;
        };

        pass.set_vertex_buffer(0, vertex_buffer_slice.buffer.slice(..));
        pass.set_vertex_buffer(1, shadow_buf.slice(..));

        match &gpu_mesh.buffer_info {
            RenderMeshBufferInfo::Indexed {
                index_format,
                count,
            } => {
                let Some(index_buffer_slice) =
                    mesh_allocator.mesh_index_slice(&mesh_instance.mesh_asset_id)
                else {
                    return RenderCommandResult::Skip;
                };
                pass.set_index_buffer(index_buffer_slice.buffer.slice(..), *index_format);
                pass.draw_indexed(
                    index_buffer_slice.range.start..(index_buffer_slice.range.start + count),
                    vertex_buffer_slice.range.start as i32,
                    0..shadow_len as u32,
                );
            }
            RenderMeshBufferInfo::NonIndexed => {
                pass.draw(vertex_buffer_slice.range, 0..shadow_len as u32);
            }
        }
        RenderCommandResult::Success
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_vec3_close(actual: Vec3, expected: Vec3) {
        let delta = (actual - expected).abs();
        assert!(
            delta.max_element() < 0.001,
            "actual {actual:?} expected {expected:?}"
        );
    }

    fn bounds_for(min: Vec3, max: Vec3, transform: Transform) -> PropInstanceBounds {
        let center = (min + max) * 0.5;
        let radius = (max - center).length();
        transformed_padded_aabb(min, max, center, radius, &transform, 0.0)
    }

    #[test]
    fn identity_transform_preserves_aabb() {
        let bounds = bounds_for(
            Vec3::new(-1.0, 0.0, -2.0),
            Vec3::new(3.0, 4.0, 2.0),
            Transform::IDENTITY,
        );
        assert_vec3_close(bounds.min, Vec3::new(-1.0, 0.0, -2.0));
        assert_vec3_close(bounds.max, Vec3::new(3.0, 4.0, 2.0));
    }

    #[test]
    fn translated_mesh_aabb_moves_with_transform() {
        let bounds = bounds_for(
            Vec3::new(-1.0, -1.0, -1.0),
            Vec3::new(1.0, 1.0, 1.0),
            Transform::from_translation(Vec3::new(10.0, 2.0, -4.0)),
        );
        assert_vec3_close(bounds.min, Vec3::new(9.0, 1.0, -5.0));
        assert_vec3_close(bounds.max, Vec3::new(11.0, 3.0, -3.0));
    }

    #[test]
    fn rotated_mesh_aabb_uses_all_corners() {
        let bounds = bounds_for(
            Vec3::new(-1.0, -0.5, -3.0),
            Vec3::new(1.0, 0.5, 3.0),
            Transform::from_rotation(Quat::from_rotation_y(std::f32::consts::FRAC_PI_2)),
        );
        assert_vec3_close(bounds.min, Vec3::new(-3.0, -0.5, -1.0));
        assert_vec3_close(bounds.max, Vec3::new(3.0, 0.5, 1.0));
    }

    #[test]
    fn non_uniform_scale_expands_each_axis() {
        let bounds = bounds_for(
            Vec3::new(-1.0, -1.0, -1.0),
            Vec3::new(1.0, 1.0, 1.0),
            Transform::from_scale(Vec3::new(2.0, 3.0, 0.5)),
        );
        assert_vec3_close(bounds.min, Vec3::new(-2.0, -3.0, -0.5));
        assert_vec3_close(bounds.max, Vec3::new(2.0, 3.0, 0.5));
    }

    #[test]
    fn multi_mesh_local_transform_offsets_bounds() {
        let prop = Transform::from_translation(Vec3::new(10.0, 0.0, 0.0));
        let local = Transform::from_translation(Vec3::new(0.0, 5.0, 2.0));
        let bounds = bounds_for(Vec3::splat(-1.0), Vec3::splat(1.0), prop * local);
        assert_vec3_close(bounds.min, Vec3::new(9.0, 4.0, 1.0));
        assert_vec3_close(bounds.max, Vec3::new(11.0, 6.0, 3.0));
    }

    #[test]
    fn large_canopy_offset_from_origin_sets_sphere_distance() {
        let bounds = transformed_padded_aabb(
            Vec3::new(8.0, 4.0, -3.0),
            Vec3::new(18.0, 16.0, 7.0),
            Vec3::new(13.0, 10.0, 2.0),
            8.0,
            &Transform::from_translation(Vec3::new(20.0, 0.0, 30.0)),
            2.0,
        );
        assert_vec3_close(bounds.min, Vec3::new(26.0, 2.0, 25.0));
        assert_vec3_close(bounds.max, Vec3::new(40.0, 18.0, 39.0));
        assert_vec3_close(bounds.sphere_center, Vec3::new(33.0, 10.0, 32.0));
        assert!((bounds.sphere_radius - 10.0).abs() < 0.001);
    }

    #[test]
    fn tiny_ground_clutter_lookahead_requires_elevated_forward_view() {
        let camera_pos = Vec3::new(0.0, 48.0, 0.0);
        let forward = Vec3::NEG_Z;
        let ahead = tiny_ground_clutter_lookahead_distance(
            PropRenderClass::TinyGroundClutter,
            camera_pos,
            forward,
            Vec3::new(0.0, 0.0, -120.0),
        );
        assert!(
            ahead > 24.0,
            "expected forward elevated lookahead, got {ahead}"
        );

        let side = tiny_ground_clutter_lookahead_distance(
            PropRenderClass::TinyGroundClutter,
            camera_pos,
            forward,
            Vec3::new(120.0, 0.0, 0.0),
        );
        assert_eq!(side, 0.0);

        let low_camera = tiny_ground_clutter_lookahead_distance(
            PropRenderClass::TinyGroundClutter,
            Vec3::new(0.0, 4.0, 0.0),
            forward,
            Vec3::new(0.0, 0.0, -120.0),
        );
        assert_eq!(low_camera, 0.0);
    }

    #[test]
    fn tiny_ground_clutter_lookahead_prevents_forward_hidden_pop() {
        let no_lookahead = classify_instance_lod(
            PropRenderClass::TinyGroundClutter,
            PropInstanceLod::Full,
            110.0,
            0.0,
            false,
            false,
            1.0,
            1.0,
        );
        assert_eq!(no_lookahead, PropInstanceLod::Hidden);

        let with_lookahead = classify_instance_lod(
            PropRenderClass::TinyGroundClutter,
            PropInstanceLod::Full,
            110.0,
            TINY_CLUTTER_LOOKAHEAD_MAX_EXTRA_DISTANCE,
            false,
            false,
            1.0,
            1.0,
        );
        assert_eq!(with_lookahead, PropInstanceLod::Mid);
    }

    #[test]
    fn prop_subcluster_grid_defaults_on_for_runtime() {
        assert_eq!(
            normalized_prop_subcluster_grid(None),
            DEFAULT_PROP_SUBCLUSTER_GRID
        );
        let mut toggles = BenchRenderToggles::default();
        toggles.prop_subcluster_grid = 2;
        assert_eq!(normalized_prop_subcluster_grid(Some(&toggles)), 2);
    }
}
