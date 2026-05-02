use std::any::TypeId;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use bevy::asset::AssetId;
use bevy::camera::primitives::Aabb;
use bevy::camera::visibility::RenderLayers;
use bevy::core_pipeline::core_3d::{CORE_3D_DEPTH_FORMAT, Transparent3d};
use bevy::ecs::system::{SystemParamItem, lifetimeless::*};
use bevy::light::NotShadowCaster;
use bevy::mesh::{MeshVertexBufferLayoutRef, VertexBufferLayout};
use bevy::pbr::{
    ExtractedDirectionalLight, ExtractedPointLight, LightEntity, MATERIAL_BIND_GROUP_INDEX,
    MaterialBindGroupAllocators, MeshPipeline, MeshPipelineKey, PreparedMaterial, PrepassPipeline,
    RenderCascadesVisibleEntities, RenderCubemapVisibleEntities, RenderMeshInstanceFlags,
    RenderMeshInstances, RenderVisibleMeshEntities, SetMeshBindGroup, SetMeshViewBindGroup,
    SetMeshViewBindingArrayBindGroup, SetPrepassViewBindGroup, SetPrepassViewEmptyBindGroup,
    Shadow, ShadowBatchSetKey, ShadowBinKey, ViewKeyCache, ViewLightEntities,
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
    view::{ExtractedView, NoIndirectDrawing},
};
use bevy_shader::ShaderDefVal;
use bytemuck::{Pod, Zeroable};

use crate::props::PropType;
use crate::props::instancing::{CachedPropMesh, InstancedProp};
use crate::props::lod_material::PropLodState;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::props_material::{PropsMaterial, PropsMaterialHandle};
use crate::rendering::render_timing::{RenderTimingSink, render_timing_guard};

const SHADER_ASSET_PATH: &str = "shaders/instanced_prop.wgsl";
const INTEGRATED_GROUP_INSTANCE_LIMIT: usize = 2048;
const DEDICATED_GROUP_INSTANCE_LIMIT: usize = 65_536;

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
    pub instances: Vec<PropInstance>,
    pub shadow_instances: Vec<PropInstance>,
    shadow_culled: Vec<bool>,
    tint_enabled: bool,
    pub version: u64,
    pub shadow_version: u64,
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
    chunk_pos: IVec2,
    mesh: AssetId<Mesh>,
    material: AssetId<PropsMaterial>,
    split: u32,
}

impl PartialEq for PropGroupKey {
    fn eq(&self, other: &Self) -> bool {
        self.chunk_pos == other.chunk_pos
            && self.mesh == other.mesh
            && self.material == other.material
            && self.split == other.split
    }
}

impl Hash for PropGroupKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.chunk_pos.hash(state);
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
    shadow_culled: Vec<bool>,
    min: Vec3,
    max: Vec3,
}

#[derive(Resource, Default)]
pub struct PropInstanceGroups {
    groups: HashMap<PropGroupKey, PropGroupRecord>,
    pending: HashMap<Entity, PendingPropGroupUpdate>,
    integrated_gpu: bool,
}

impl PropInstanceGroups {
    pub fn remove_chunk(&mut self, chunk_pos: IVec2) -> Vec<Entity> {
        let mut removed = Vec::new();
        self.groups.retain(|key, record| {
            if key.chunk_pos == chunk_pos {
                removed.push(record.entity);
                false
            } else {
                true
            }
        });
        self.pending.clear();
        removed
    }

    fn limit(&self) -> usize {
        if self.integrated_gpu {
            INTEGRATED_GROUP_INSTANCE_LIMIT
        } else {
            DEDICATED_GROUP_INSTANCE_LIMIT
        }
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
                ),
            );

        app.add_plugins(SyncComponentPlugin::<InstancedPropGroup>::default());
        app.sub_app_mut(RenderApp)
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
    _prop_type: PropType,
    chunk_pos: IVec2,
    tint: Vec4,
) -> Option<Entity> {
    if cached.is_empty() {
        return None;
    }

    let mut refs = Vec::with_capacity(cached.len());
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
        );

        groups
            .pending
            .entry(group)
            .and_modify(|pending| {
                pending.instances.push(instance);
                pending.shadow_culled.push(false);
                pending.min = pending.min.min(min);
                pending.max = pending.max.max(max);
            })
            .or_insert_with(|| PendingPropGroupUpdate {
                instances: vec![instance],
                shadow_culled: vec![false],
                min,
                max,
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
) -> (Entity, u32) {
    let split_limit = groups.limit();
    let mut split = 0;
    loop {
        let key = PropGroupKey {
            chunk_pos,
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
                        instances: Vec::new(),
                        shadow_instances: Vec::new(),
                        shadow_culled: Vec::new(),
                        tint_enabled: !groups.integrated_gpu,
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
        let Ok(mut group) = group_query.get_mut(entity) else {
            continue;
        };
        group.instances.extend(update.instances.iter().copied());
        group
            .shadow_culled
            .extend(update.shadow_culled.iter().copied());
        group
            .shadow_instances
            .extend(update.instances.iter().copied());
        bump_versions(&mut group);
        commands
            .entity(entity)
            .insert(Aabb::from_min_max(update.min, update.max));
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
            if let Some(instance) = group.instances.get_mut(slot) {
                instance.transform = final_transform.to_matrix().to_cols_array_2d();
                bump_version(&mut group);
            }
            if let Some(culled) = group.shadow_culled.get_mut(slot) {
                *culled = shadow_culled.is_some();
            }
            rebuild_shadow_instances(&mut group);
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
                rebuild_shadow_instances(&mut group);
            }
        }
    }
}

fn rebuild_shadow_instances(group: &mut InstancedPropGroup) {
    group.shadow_instances = group
        .instances
        .iter()
        .zip(group.shadow_culled.iter())
        .filter_map(|(instance, culled)| (!*culled).then_some(*instance))
        .collect();
    bump_shadow_version(group);
}

fn bump_version(group: &mut InstancedPropGroup) {
    group.version = group.version.wrapping_add(1).max(1);
}

fn bump_shadow_version(group: &mut InstancedPropGroup) {
    group.shadow_version = group.shadow_version.wrapping_add(1).max(1);
}

fn bump_versions(group: &mut InstancedPropGroup) {
    bump_version(group);
    bump_shadow_version(group);
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
            commands.entity(entity).insert(source.clone());
            groups_inserted += 1;
            visible_vectors_cloned += 1;
            shadow_vectors_cloned += 1;
            visible_instances_cloned += source.instances.len();
            shadow_instances_cloned += source.shadow_instances.len();
            continue;
        };

        let metadata_dirty = target.mesh != source.mesh
            || target.material != source.material
            || target.tint_enabled != source.tint_enabled;
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
    render_device: Res<RenderDevice>,
    render_queue: Res<RenderQueue>,
    timing: Option<Res<RenderTimingSink>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Prepare Buffers");
    let mut groups_examined = 0usize;
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
        if group.instances.is_empty() {
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

fn queue_instanced_props(
    transparent_3d_draw_functions: Res<DrawFunctions<Transparent3d>>,
    pipeline: Res<PropInstancingPipeline>,
    mut pipelines: ResMut<SpecializedMeshPipelines<PropInstancingPipeline>>,
    pipeline_cache: Res<PipelineCache>,
    meshes: Res<RenderAssets<RenderMesh>>,
    render_mesh_instances: Res<RenderMeshInstances>,
    material_meshes: Query<
        (Entity, &MainEntity, &InstancedPropGroup),
        (With<InstancedPropGroup>, With<InstanceBuffer>),
    >,
    mut transparent_render_phases: ResMut<ViewSortedRenderPhases<Transparent3d>>,
    views: Query<&ExtractedView>,
    view_key_cache: Res<ViewKeyCache>,
    timing: Option<Res<RenderTimingSink>>,
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Queue Props");
    let mut views_seen = 0usize;
    let mut phase_views = 0usize;
    let mut draws_queued = 0usize;
    let mut instances_queued = 0usize;

    let draw_function = transparent_3d_draw_functions
        .read()
        .id::<DrawInstancedProp>();

    for view in &views {
        views_seen += 1;
        let Some(transparent_phase) = transparent_render_phases.get_mut(&view.retained_view_entity)
        else {
            continue;
        };
        phase_views += 1;
        let Some(view_key) = view_key_cache.get(&view.retained_view_entity) else {
            continue;
        };
        let rangefinder = view.rangefinder3d();

        for (entity, main_entity, group) in &material_meshes {
            let Some(mesh_instance) = render_mesh_instances.render_mesh_queue_data(*main_entity)
            else {
                continue;
            };
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
            transparent_phase.add(Transparent3d {
                entity: (entity, *main_entity),
                pipeline: pipeline_id,
                draw_function,
                distance: rangefinder.distance(&mesh_instance.center),
                batch_range: 0..1,
                extra_index: PhaseItemExtraIndex::None,
                indexed: true,
            });
            draws_queued += 1;
            instances_queued += group.instances.len();
        }
    }

    if let Some(sink) = sink {
        sink.push_count("Render Instancing Queue Views", views_seen as f64);
        sink.push_count("Render Instancing Queue Phase Views", phase_views as f64);
        sink.push_count("Render Instancing Queue Draws", draws_queued as f64);
        sink.push_count("Render Instancing Queue Instances", instances_queued as f64);
    }
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
) {
    let sink = timing.as_deref();
    let _timer = render_timing_guard(sink, "Render Instancing Queue Shadows");
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
