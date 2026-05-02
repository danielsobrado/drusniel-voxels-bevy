use std::any::TypeId;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use bevy::asset::AssetId;
use bevy::camera::primitives::Aabb;
use bevy::camera::visibility::RenderLayers;
use bevy::core_pipeline::core_3d::{
    AlphaMask3d, CORE_3D_DEPTH_FORMAT, Opaque3d, Opaque3dBatchSetKey, Opaque3dBinKey, Transparent3d,
};
use bevy::core_pipeline::prepass::{OpaqueNoLightmap3dBatchSetKey, OpaqueNoLightmap3dBinKey};
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
use crate::props::PropType;
use crate::props::instancing::{CachedPropMesh, InstancedProp};
use crate::props::lod_material::PropLodState;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::props_material::{PropsMaterial, PropsMaterialHandle};
use crate::rendering::render_timing::{RenderTimingSink, render_timing_guard};

const SHADER_ASSET_PATH: &str = "shaders/instanced_prop.wgsl";
const INTEGRATED_GROUP_INSTANCE_LIMIT: usize = 2048;
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
    prop_classes: Vec<PropRenderClass>,
    lod_states: Vec<PropInstanceLod>,
    pub instances: Vec<PropInstance>,
    pub shadow_instances: Vec<PropInstance>,
    shadow_culled: Vec<bool>,
    tint_enabled: bool,
    diagnostic_prop_type_mask: u8,
    pub version: u64,
    pub shadow_version: u64,
}

impl InstancedPropGroup {
    fn render_world_clone(&self) -> Self {
        Self {
            mesh: self.mesh.clone(),
            material: self.material.clone(),
            source_instances: Vec::new(),
            prop_classes: Vec::new(),
            lod_states: Vec::new(),
            instances: self.instances.clone(),
            shadow_instances: self.shadow_instances.clone(),
            shadow_culled: self.shadow_culled.clone(),
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
}

#[derive(Component, Clone)]
pub struct PropVisualRefs {
    pub refs: Vec<PropVisualRef>,
}

#[derive(Component)]
pub struct PropTransformDirty;

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
}

impl PropInstanceGroups {
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

    fn bounds_for_group(&self, entity: Entity) -> Option<(Vec3, Vec3)> {
        self.groups
            .values()
            .find(|record| record.entity == entity)
            .map(|record| (record.min, record.max))
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
            .add_systems(Startup, configure_prop_instancing_limits)
            .add_systems(
                Update,
                (
                    apply_pending_instances,
                    sync_dirty_prop_transforms,
                    sync_prop_shadow_culling,
                    update_instanced_prop_lod,
                )
                    .chain(),
            );

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
    prop_material: &PropsMaterialHandle,
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
        let instance = PropInstance {
            transform: final_transform.to_matrix().to_cols_array_2d(),
            tint: tint.to_array(),
        };

        let radius = final_transform.scale.abs().max_element().max(1.0) * 4.0;
        let min = final_transform.translation - Vec3::splat(radius);
        let max = final_transform.translation + Vec3::splat(radius);
        let (group, slot) = get_or_create_group(
            commands,
            groups,
            cached_mesh.mesh.clone(),
            prop_material.handle.clone(),
            chunk_pos,
            min,
            max,
            prop_type,
        );

        groups
            .pending
            .entry(group)
            .and_modify(|pending| {
                pending.instances.push(instance);
                pending.prop_classes.push(prop_class);
                pending.shadow_culled.push(false);
                pending.min = pending.min.min(min);
                pending.max = pending.max.max(max);
                pending.prop_type_mask |= prop_type_mask(prop_type);
            })
            .or_insert_with(|| PendingPropGroupUpdate {
                instances: vec![instance],
                prop_classes: vec![prop_class],
                shadow_culled: vec![false],
                min,
                max,
                prop_type_mask: prop_type_mask(prop_type),
            });

        refs.push(PropVisualRef {
            group,
            slot,
            local_transform,
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
                        prop_classes: Vec::new(),
                        lod_states: Vec::new(),
                        instances: Vec::new(),
                        shadow_instances: Vec::new(),
                        shadow_culled: Vec::new(),
                        tint_enabled: !groups.integrated_gpu,
                        diagnostic_prop_type_mask: prop_type_mask(prop_type),
                        version: 1,
                        shadow_version: 1,
                    },
                    NoIndirectDrawing,
                    // TODO: keep props on layer 0 until reflection-layer membership is designed.
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
        let (bounds_min, bounds_max) = groups
            .bounds_for_group(entity)
            .unwrap_or((update.min, update.max));
        let Ok(mut group) = group_query.get_mut(entity) else {
            continue;
        };
        group
            .source_instances
            .extend(update.instances.iter().copied());
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
        commands
            .entity(entity)
            .insert(Aabb::from_min_max(bounds_min, bounds_max));
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
            if let Some(culled) = group.shadow_culled.get_mut(slot) {
                *culled = shadow_culled.is_some();
            }
            rebuild_visible_and_shadow_instances(&mut group);
        }
        commands.entity(entity).remove::<PropTransformDirty>();
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

fn rebuild_visible_and_shadow_instances(group: &mut InstancedPropGroup) -> (bool, bool) {
    rebuild_visible_and_shadow_instances_with_options(group, false)
}

fn rebuild_visible_and_shadow_instances_with_options(
    group: &mut InstancedPropGroup,
    disable_shadow_lod: bool,
) -> (bool, bool) {
    let mut visible_instances = Vec::with_capacity(group.source_instances.len());
    let mut shadow_instances = Vec::with_capacity(group.source_instances.len());

    for ((instance, lod), shadow_culled) in group
        .source_instances
        .iter()
        .zip(group.lod_states.iter())
        .zip(group.shadow_culled.iter())
    {
        if *lod == PropInstanceLod::Hidden {
            continue;
        }
        visible_instances.push(*instance);
        if !*shadow_culled && (disable_shadow_lod || *lod == PropInstanceLod::Full) {
            shadow_instances.push(*instance);
        }
    }

    let visible_dirty = group.instances != visible_instances;
    if visible_dirty {
        group.instances = visible_instances;
        bump_version(group);
    }

    let shadow_dirty = group.shadow_instances != shadow_instances;
    if shadow_dirty {
        group.shadow_instances = shadow_instances;
        bump_shadow_version(group);
    }

    (visible_dirty, shadow_dirty)
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
    let disable_hiding = bench_toggles
        .as_deref()
        .is_some_and(|toggles| toggles.disable_prop_lod_hiding);
    let disable_shadow_lod = bench_toggles
        .as_deref()
        .is_some_and(|toggles| toggles.disable_prop_shadow_lod);

    let mut full_instances = 0usize;
    let mut mid_instances = 0usize;
    let mut hidden_instances = 0usize;
    let mut shadows_disabled = 0usize;
    let mut groups_dirtied = 0usize;

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
            let distance =
                camera_pos.distance(instance_translation(&group.source_instances[index]));
            let next =
                classify_instance_lod(class, current, distance, disable_hiding, disable_shadow_lod);
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

        if lod_changed {
            let (visible_dirty, shadow_dirty) =
                rebuild_visible_and_shadow_instances_with_options(&mut group, disable_shadow_lod);
            if visible_dirty || shadow_dirty {
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
        }
    }

    if let Some(sink) = timing.as_deref() {
        sink.push_count("Prop LOD Full Instances", full_instances as f64);
        sink.push_count("Prop LOD Mid Instances", mid_instances as f64);
        sink.push_count("Prop LOD Hidden Instances", hidden_instances as f64);
        sink.push_count("Prop Shadows Disabled By LOD", shadows_disabled as f64);
        sink.push_count("Instanced Groups Dirtied By LOD", groups_dirtied as f64);
    }
}

fn classify_instance_lod(
    class: PropRenderClass,
    current: PropInstanceLod,
    distance: f32,
    disable_hiding: bool,
    disable_shadow_lod: bool,
) -> PropInstanceLod {
    let lod = match class {
        PropRenderClass::ImportantOpaque => {
            if disable_shadow_lod {
                return PropInstanceLod::Full;
            }
            if distance
                > threshold_for_entering(
                    current,
                    PropInstanceLod::Mid,
                    IMPORTANT_PROP_SHADOW_LOD_DISTANCE,
                )
            {
                PropInstanceLod::Mid
            } else {
                PropInstanceLod::Full
            }
        }
        PropRenderClass::CutoutFoliage => classify_visible_lod(
            current,
            distance,
            FOLIAGE_FULL_LOD_DISTANCE,
            FOLIAGE_HIDDEN_LOD_DISTANCE,
        ),
        PropRenderClass::TinyGroundClutter => classify_visible_lod(
            current,
            distance,
            TINY_CLUTTER_FULL_LOD_DISTANCE,
            TINY_CLUTTER_HIDDEN_LOD_DISTANCE,
        ),
    };

    match lod {
        PropInstanceLod::Hidden if disable_hiding && disable_shadow_lod => PropInstanceLod::Full,
        PropInstanceLod::Hidden if disable_hiding => PropInstanceLod::Mid,
        PropInstanceLod::Mid if disable_shadow_lod => PropInstanceLod::Full,
        other => other,
    }
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

        if !metadata_dirty && !visible_dirty && !shadow_dirty {
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

fn prepare_instance_buffers(
    mut commands: Commands,
    query: Query<(Entity, &InstancedPropGroup, Option<&InstanceBuffer>)>,
    visible_view_entities: Query<&RenderVisibleEntities>,
    visible_meshes: Query<&RenderVisibleMeshEntities>,
    visible_cubemaps: Query<&RenderCubemapVisibleEntities>,
    visible_cascades: Query<&RenderCascadesVisibleEntities>,
    render_device: Res<RenderDevice>,
    render_queue: Res<RenderQueue>,
    timing: Option<Res<RenderTimingSink>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Prepare Buffers");
    let mut visible_entities = HashSet::new();
    for visible_view_entities in &visible_view_entities {
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

    for (entity, group, existing) in &query {
        groups_examined += 1;
        if visibility_filter_active && !visible_entities.contains(&entity) {
            groups_skipped_not_visible += 1;
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
                    });
                }
            }
            continue;
        }

        let visible_clean = existing
            .map(|buffer| {
                buffer.uploaded_version == group.version
                    && buffer.capacity >= group.instances.len()
                    && buffer.length == group.instances.len()
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
            let instance_bytes: Vec<PropInstanceNoTint>;
            let contents = if group.tint_enabled {
                bytemuck::cast_slice(group.instances.as_slice())
            } else {
                instance_bytes = group
                    .instances
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
                group.instances.len(),
                group.tint_enabled,
                "instanced prop data buffer",
            );
            render_queue.write_buffer(&buffer, 0, contents);
            bytes_uploaded += contents.len();
            instances_uploaded += group.instances.len();
            visible_buffers_uploaded += 1;
            visible_buffers_created += usize::from(created);
            uploaded_any = true;
            (buffer, capacity, group.instances.len(), group.version)
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
            } else if group.shadow_instances.is_empty() || shadow_instances_match_visible(group) {
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
        commands.entity(entity).insert(InstanceBuffer {
            buffer,
            capacity,
            length,
            uploaded_version,
            shadow_buffer,
            shadow_capacity,
            shadow_length,
            uploaded_shadow_version,
        });
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
    }
}

#[derive(Resource)]
struct PropInstancingPipeline {
    shader: Handle<Shader>,
    mesh_pipeline: MeshPipeline,
    material_layout: BindGroupLayoutDescriptor,
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
    commands.insert_resource(PropInstancingPipeline {
        shader: asset_server.load(SHADER_ASSET_PATH),
        mesh_pipeline: mesh_pipeline.clone(),
        material_layout,
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
        if let Some(fragment) = descriptor.fragment.as_mut() {
            fragment.shader = self.shader.clone();
            fragment.shader_defs.push(ShaderDefVal::UInt(
                "MATERIAL_BIND_GROUP".into(),
                MATERIAL_BIND_GROUP_INDEX as u32,
            ));
            if key.tint_enabled {
                fragment.shader_defs.push("PROP_INSTANCE_TINT".into());
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
            shader_location: 3,
        },
        VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size(),
            shader_location: 4,
        },
        VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size() * 2,
            shader_location: 5,
        },
        VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size() * 3,
            shader_location: 6,
        },
    ];
    if tint_enabled {
        attributes.push(VertexAttribute {
            format: VertexFormat::Float32x4,
            offset: VertexFormat::Float32x4.size() * 4,
            shader_location: 7,
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
        (Entity, &'static MainEntity, &'static InstancedPropGroup),
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
            let Ok((_, group_main_entity, group)) = params.material_meshes.get(entity) else {
                continue;
            };
            if *group_main_entity != main_entity {
                continue;
            }
            groups_visible += 1;
            if group.instances.is_empty() {
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
            );
            let key = PropInstancingPipelineKey {
                mesh_key,
                tint_enabled: group.tint_enabled,
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
            let group_instances = group.instances.len();

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
            if group_uses_blended_alpha(group) {
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

            for (render_entity, main_entity) in visible_entities {
                let Ok((group, instance_buffer)) = groups.get(render_entity) else {
                    continue;
                };
                if instance_buffer.shadow_length == 0 {
                    continue;
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
    }
}

type DrawInstancedProp = (
    SetItemPipeline,
    SetMeshViewBindGroup<0>,
    SetMeshViewBindingArrayBindGroup<1>,
    SetMeshBindGroup<2>,
    SetInstancedPropMaterialBindGroup<MATERIAL_BIND_GROUP_INDEX>,
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

impl<P: PhaseItem> RenderCommand<P> for DrawMeshInstancedShadow {
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
        if instance_buffer.shadow_length == 0 {
            return RenderCommandResult::Skip;
        }
        let Some(vertex_buffer_slice) =
            mesh_allocator.mesh_vertex_slice(&mesh_instance.mesh_asset_id)
        else {
            return RenderCommandResult::Skip;
        };

        pass.set_vertex_buffer(0, vertex_buffer_slice.buffer.slice(..));
        pass.set_vertex_buffer(1, instance_buffer.shadow_buffer.slice(..));

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
                    0..instance_buffer.shadow_length as u32,
                );
            }
            RenderMeshBufferInfo::NonIndexed => {
                pass.draw(
                    vertex_buffer_slice.range,
                    0..instance_buffer.shadow_length as u32,
                );
            }
        }
        RenderCommandResult::Success
    }
}
