//! GPU compute cull pipeline for vegetation/prop instances.
//!
//! Dispatches a compute shader that reads the source instance buffer, performs
//! frustum + distance + LOD culling, and writes:
//! - Compacted visible instances to a flat buffer
//! - Per-group `DrawIndexedIndirectArgs` (instance_count + first_instance)
//! - Per-group vertex-shader uniforms (visible_offset, tint_enabled)
//!
//! Zero CPU readback — the draw call reads GPU-written args directly via
//! `draw_indexed_indirect`.

use std::borrow::Cow;

use bevy::prelude::*;
use bevy::render::render_graph::{NodeRunError, RenderGraphContext, ViewNode};
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderDevice, RenderQueue};
use bevy::render::view::ExtractedView;

use bytemuck::{Pod, Zeroable};

use crate::rendering::render_timing::RenderTimingSink;

use super::GpuVegetationConfig;
use super::gpu_vegetation::GpuVegetationSourceBuffer;
use super::instanced_render::PropInstance;

const WORKGROUP_SIZE: u32 = 64;
const GPU_CULL_SHADER_PATH: &str = "shaders/prop_cull.wgsl";

const MAX_CASCADES: usize = 4;

// ──────────────────────── GPU-side structs (must match WGSL) ────────────────

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, ShaderType)]
struct GpuGroupMeta {
    source_offset: u32,
    source_count: u32,
    _pad0: u32,
    _pad1: u32,
}

/// Per-cascade frustum data uploaded to GPU.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, ShaderType)]
struct GpuCascadeFrustum {
    clip_from_world: [[f32; 4]; 4],
    shadow_sphere_radius: f32,
    _pad0: f32,
    _pad1: f32,
    _pad2: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, ShaderType)]
struct GpuCullParams {
    camera_pos: [f32; 4],
    clip_from_world: [[f32; 4]; 4],
    lod_end: [f32; 4],
    max_draw_distance: f32,
    total_source_instances: u32,
    total_groups: u32,
    cascade_count: u32,
    max_shadow_distance: f32,
}

/// CPU-side template for `DrawIndexedIndirectArgs`.
/// The compute shader only writes `instance_count` and `first_instance`.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
pub struct GpuDrawArgsTemplate {
    index_count: u32,
    _instance_count_init: u32, // set to 0 by CPU, overwritten by GPU
    first_index: u32,
    vertex_offset: u32,
    _first_instance_init: u32, // set to 0 by CPU, overwritten by GPU
}

/// Per-cascade shadow params uniform (uploaded per-cascade).
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, ShaderType)]
pub struct GpuShadowParams {
    pub cascade_index: u32,
    pub _pad0: u32,
    pub _pad1: u32,
    pub _pad2: u32,
}

/// Per-group vertex shader uniform written by compute shader.
/// The vertex shader only needs tint_enabled and the draw args handle the rest.
#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, ShaderType)]
pub struct GpuGroupUniform {
    pub visible_offset: u32,
    pub source_count: u32,
    pub tint_enabled: u32,
    pub group_index: u32,
}

// ──────────────────────── Resources ──────────────────────────────────────────

#[derive(Resource)]
pub struct GpuVegetationCullPipeline {
    pipeline_id: CachedComputePipelineId,
    bind_group_layout_0: BindGroupLayout,
    bind_group_layout_1: BindGroupLayout,
    bind_group_layout_2: BindGroupLayout,
}

#[derive(Resource)]
pub struct GpuVegetationCullBuffers {
    /// Output visible instances buffer (STORAGE | VERTEX).
    pub visible_instances_buffer: Option<Buffer>,
    /// Per-group draw args buffer (CPU template + GPU dynamic fields).
    pub draw_args_buffer: Option<Buffer>,
    /// Per-group vertex shader uniforms buffer.
    pub group_uniforms_buffer: Option<Buffer>,
    /// Per-group atomic counters (for the compute shader).
    group_counters_buffer: Option<Buffer>,
    /// Cull params uniform buffer.
    cull_params_buffer: Option<Buffer>,
    /// Group metadata buffer.
    group_meta_buffer: Option<Buffer>,
    /// Cascade frustum data uniform buffer.
    cascade_frusta_buffer: Option<Buffer>,
    /// Bind group 0 (compute inputs).
    bind_group_0: Option<BindGroup>,
    /// Bind group 1 (compute outputs).
    bind_group_1: Option<BindGroup>,
    /// Per-cascade shadow buffers.
    pub shadow_cascades: Vec<ShadowCascadeBuffers>,
    /// Bind group 4 for vertex shader (visible instances storage buffer).
    pub vertex_bind_group: Option<BindGroup>,
    /// Capacity tracking.
    source_capacity: u32,
    /// Group entity → group index mapping (rebuilt each frame).
    pub group_entity_map: Vec<(Entity, u32)>,
    /// Whether GPU cull is initialized and ready.
    pub ready: bool,
}

/// Per-cascade shadow cull buffers.
pub struct ShadowCascadeBuffers {
    pub visible_buffer: Option<Buffer>,
    pub draw_args_buffer: Option<Buffer>,
    pub group_uniforms_buffer: Option<Buffer>,
    pub group_counters_buffer: Option<Buffer>,
    pub shadow_params_buffer: Option<Buffer>,
    pub bind_group: Option<BindGroup>,
}

impl Default for GpuVegetationCullBuffers {
    fn default() -> Self {
        Self {
            visible_instances_buffer: None,
            draw_args_buffer: None,
            group_uniforms_buffer: None,
            group_counters_buffer: None,
            cull_params_buffer: None,
            group_meta_buffer: None,
            cascade_frusta_buffer: None,
            bind_group_0: None,
            bind_group_1: None,
            shadow_cascades: Vec::new(),
            vertex_bind_group: None,
            source_capacity: 0,
            group_entity_map: Vec::new(),
            ready: false,
        }
    }
}

impl GpuVegetationCullBuffers {
    /// Get the draw args buffer for indirect draw.
    pub fn draw_args_buffer(&self) -> Option<&Buffer> {
        self.draw_args_buffer.as_ref()
    }

    /// Get the group index for a given entity.
    pub fn group_index_for_entity(&self, entity: Entity) -> Option<u32> {
        self.group_entity_map
            .iter()
            .find(|(e, _)| *e == entity)
            .map(|(_, idx)| *idx)
    }

    /// Get the visible instances buffer for vertex shader bind group.
    pub fn visible_instances_buffer(&self) -> Option<&Buffer> {
        self.visible_instances_buffer.as_ref()
    }
}

// ──────────────────────── Extracted per-frame params ─────────────────────────

#[derive(Resource, Clone)]
pub struct ExtractedCullParams {
    pub camera_pos: [f32; 4],
    pub clip_from_world: [[f32; 4]; 4],
    pub lod_end: [f32; 4],
    pub max_draw_distance: f32,
    pub cascade_frusta: Vec<[[f32; 4]; 4]>,
    pub max_shadow_distance: f32,
}

pub fn extract_gpu_cull_params(
    mut commands: Commands,
    views: Query<&ExtractedView>,
    config: Option<Res<GpuVegetationConfig>>,
    capabilities: Option<Res<crate::rendering::device::capabilities::GraphicsCapabilities>>,
) {
    let Some(config) = config else {
        return;
    };
    if !config.enabled || config.force_cpu_fallback {
        return;
    }
    if config.disable_on_integrated_gpu && capabilities.is_some_and(|c| c.integrated_gpu) {
        return;
    }
    let Some(view) = views.iter().next() else {
        return;
    };
    let clip_from_world = view
        .clip_from_world
        .unwrap_or_else(|| view.clip_from_view * view.world_from_view.to_matrix().inverse());
    let pos = view.world_from_view.translation().to_array();
    commands.insert_resource(ExtractedCullParams {
        camera_pos: [pos[0], pos[1], pos[2], 0.0],
        clip_from_world: clip_from_world.to_cols_array_2d(),
        lod_end: [
            config.culling.lod_end_m[0],
            config.culling.lod_end_m[1],
            config.culling.lod_end_m[2],
            0.0,
        ],
        max_draw_distance: config.culling.max_draw_distance_m,
        cascade_frusta: Vec::new(), // filled in prepare
        max_shadow_distance: config.culling.max_shadow_distance_m,
    });
}

// ──────────────────────── Prepare: upload + dispatch ─────────────────────────

static GPU_CULL_FALLBACK_LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn prepare_gpu_cull_dispatch(
    source_buffer: Res<GpuVegetationSourceBuffer>,
    cull_pipeline: Option<Res<GpuVegetationCullPipeline>>,
    mut cull_buffers: ResMut<GpuVegetationCullBuffers>,
    render_device: Res<RenderDevice>,
    render_queue: Res<RenderQueue>,
    extracted_params: Option<Res<ExtractedCullParams>>,
    groups: Query<(Entity, &super::instanced_render::InstancedPropGroup)>,
    config: Option<Res<GpuVegetationConfig>>,
    directional_lights: Query<&bevy::camera::primitives::CascadesFrusta, With<bevy::light::DirectionalLight>>,
    capabilities: Option<Res<crate::rendering::device::capabilities::GraphicsCapabilities>>,
    bench_toggles: Option<Res<crate::diagnostics::bench::BenchRenderToggles>>,
    timing: Option<Res<RenderTimingSink>>,
) {
    let Some(config) = config else { return };
    if !config.enabled || config.force_cpu_fallback {
        if !GPU_CULL_FALLBACK_LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            info!("GPU vegetation cull: disabled or CPU fallback forced; using CPU path");
        }
        return;
    }
    if config.disable_on_integrated_gpu && capabilities.is_some_and(|c| c.integrated_gpu) {
        if !GPU_CULL_FALLBACK_LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
            info!("GPU vegetation cull: integrated GPU detected; using CPU path");
        }
        return;
    }
    let force_on = bench_toggles.as_ref().is_some_and(|t| t.force_gpu_vegetation.unwrap_or(false));
    let force_off = bench_toggles.as_ref().is_some_and(|t| t.disable_gpu_vegetation.unwrap_or(false));
    if force_off { return; }
    if !config.enabled && !force_on { return; }
    let Some(cull_pipeline) = cull_pipeline else { return };
    let Some(params) = extracted_params else { return };
    let Some(source_buf) = source_buffer.buffer() else { return };

    // ── Build group metadata ──
    let mut group_metas: Vec<GpuGroupMeta> = Vec::new();
    let mut group_entity_map: Vec<(Entity, u32)> = Vec::new();
    let mut running_offset: u32 = 0;
    let mut group_index: u32 = 0;

    for (entity, group) in &groups {
        let source = group.source_instances();
        if source.is_empty() { continue; }
        let count = source.len() as u32;
        group_metas.push(GpuGroupMeta {
            source_offset: running_offset,
            source_count: count,
            _pad0: if group.is_tint_enabled() { 1 } else { 0 },
            _pad1: 0,
        });
        group_entity_map.push((entity, group_index));
        running_offset += count;
        group_index += 1;
    }

    let total_source = source_buffer.total_instances();
    let total_groups = group_metas.len() as u32;

    if total_source == 0 || total_groups == 0 {
        cull_buffers.ready = false;
        cull_buffers.group_entity_map = group_entity_map;
        return;
    }

    let max_visible = config.buffers.max_visible_main;

    // ── Ensure buffers exist ──
    if cull_buffers.source_capacity < max_visible {
        let visible_size = (max_visible as usize * std::mem::size_of::<PropInstance>()) as u64;
        cull_buffers.visible_instances_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("gpu_cull_visible_instances"),
            size: visible_size,
            usage: BufferUsages::STORAGE | BufferUsages::VERTEX,
            mapped_at_creation: false,
        }));

        let args_size = (max_visible as usize * std::mem::size_of::<GpuDrawArgsTemplate>()) as u64;
        cull_buffers.draw_args_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("gpu_cull_draw_args"),
            size: args_size,
            usage: BufferUsages::STORAGE | BufferUsages::INDIRECT | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));

        let uniforms_size =
            (max_visible as usize * std::mem::size_of::<GpuGroupUniform>()) as u64;
        cull_buffers.group_uniforms_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("gpu_cull_group_uniforms"),
            size: uniforms_size,
            usage: BufferUsages::STORAGE | BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));

        let counters_size = (max_visible as usize * std::mem::size_of::<u32>()) as u64;
        cull_buffers.group_counters_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("gpu_cull_group_counters"),
            size: counters_size,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));

        let meta_size = (max_visible as usize * std::mem::size_of::<GpuGroupMeta>()) as u64;
        cull_buffers.group_meta_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("gpu_cull_group_meta"),
            size: meta_size,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));

        let params_size = std::mem::size_of::<GpuCullParams>() as u64;
        cull_buffers.cull_params_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("gpu_cull_params"),
            size: params_size,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));

        cull_buffers.source_capacity = max_visible;
    }

    // Clone buffer handles before mutable borrow of cull_buffers.
    let visible_buf = cull_buffers.visible_instances_buffer.clone().unwrap();
    let draw_args_buf = cull_buffers.draw_args_buffer.clone().unwrap();
    let group_uniforms_buf = cull_buffers.group_uniforms_buffer.clone().unwrap();
    let group_counters_buf = cull_buffers.group_counters_buffer.clone().unwrap();
    let group_meta_buf = cull_buffers.group_meta_buffer.clone().unwrap();
    let cull_params_buf = cull_buffers.cull_params_buffer.clone().unwrap();
    let cascade_frusta_buf = cull_buffers.cascade_frusta_buffer.clone();

    // ── Upload data ──
    // Clear per-group counters.
    render_queue.write_buffer(
        &group_counters_buf,
        0,
        bytemuck::cast_slice(&vec![0u32; max_visible as usize]),
    );

    // Upload group metadata.
    render_queue.write_buffer(
        &group_meta_buf,
        0,
        bytemuck::cast_slice(&group_metas),
    );

    // Upload cull params.
    // Extract cascade frusta from directional lights.
    let mut cascade_clip_from_world: Vec<[[f32; 4]; 4]> = Vec::new();
    for cascades_frusta in &directional_lights {
        for (_view_entity, frusta) in &cascades_frusta.frusta {
            for frustum in frusta.iter().take(MAX_CASCADES) {
                let planes = frustum.half_spaces;
                let mut clip = [[0f32; 4]; 4];
                for (i, plane) in planes.iter().enumerate().take(4) {
                    let n = plane.normal();
                    let d = plane.d();
                    clip[i] = [n.x, n.y, n.z, d];
                }
                cascade_clip_from_world.push(clip);
            }
            break;
        }
        break;
    }
    let cascade_count = cascade_clip_from_world.len() as u32;

    let cull_params = GpuCullParams {
        camera_pos: params.camera_pos,
        clip_from_world: params.clip_from_world,
        lod_end: params.lod_end,
        max_draw_distance: params.max_draw_distance,
        total_source_instances: total_source,
        total_groups,
        cascade_count,
        max_shadow_distance: params.max_shadow_distance,
    };
    render_queue.write_buffer(
        &cull_params_buf,
        0,
        bytemuck::bytes_of(&cull_params),
    );

    // Upload cascade frusta buffer.
    if !cascade_clip_from_world.is_empty() {
        let frusta_size = (cascade_clip_from_world.len() * std::mem::size_of::<[[f32; 4]; 4]>()) as u64;
        if cull_buffers.cascade_frusta_buffer.is_none()
            || cull_buffers.cascade_frusta_buffer.as_ref().unwrap().size() < frusta_size
        {
            cull_buffers.cascade_frusta_buffer = Some(render_device.create_buffer(&BufferDescriptor {
                label: Some("gpu_cull_cascade_frusta"),
                size: frusta_size,
                usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }
        if let Some(ref buf) = cull_buffers.cascade_frusta_buffer {
            render_queue.write_buffer(buf, 0, bytemuck::cast_slice(&cascade_clip_from_world));
        }
    }

    // Create per-cascade shadow buffers.
    let max_shadow = config.buffers.max_visible_shadow_per_cascade;
    cull_buffers.shadow_cascades.resize_with(cascade_count as usize, || {
        ShadowCascadeBuffers {
            visible_buffer: None,
            draw_args_buffer: None,
            group_uniforms_buffer: None,
            group_counters_buffer: None,
            shadow_params_buffer: None,
            bind_group: None,
        }
    });
    for ci in 0..cascade_count as usize {
        let sc = &mut cull_buffers.shadow_cascades[ci];
        if sc.visible_buffer.is_none() || sc.visible_buffer.as_ref().unwrap().size() < max_shadow as u64 * std::mem::size_of::<PropInstance>() as u64 {
            let visible_size = max_shadow as u64 * std::mem::size_of::<PropInstance>() as u64;
            sc.visible_buffer = Some(render_device.create_buffer(&BufferDescriptor {
                label: Some("gpu_cull_shadow_visible"),
                size: visible_size,
                usage: BufferUsages::STORAGE | BufferUsages::VERTEX,
                mapped_at_creation: false,
            }));
            let args_size = max_shadow as u64 * std::mem::size_of::<GpuDrawArgsTemplate>() as u64;
            sc.draw_args_buffer = Some(render_device.create_buffer(&BufferDescriptor {
                label: Some("gpu_cull_shadow_draw_args"),
                size: args_size,
                usage: BufferUsages::STORAGE | BufferUsages::INDIRECT | BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            let uniforms_size = max_shadow as u64 * std::mem::size_of::<GpuGroupUniform>() as u64;
            sc.group_uniforms_buffer = Some(render_device.create_buffer(&BufferDescriptor {
                label: Some("gpu_cull_shadow_group_uniforms"),
                size: uniforms_size,
                usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            let counters_size = max_shadow as u64 * std::mem::size_of::<u32>() as u64;
            sc.group_counters_buffer = Some(render_device.create_buffer(&BufferDescriptor {
                label: Some("gpu_cull_shadow_group_counters"),
                size: counters_size,
                usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
            let params_size = std::mem::size_of::<GpuShadowParams>() as u64;
            sc.shadow_params_buffer = Some(render_device.create_buffer(&BufferDescriptor {
                label: Some("gpu_cull_shadow_params"),
                size: params_size,
                usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }));
        }
        // Upload cascade index as shadow params.
        if let Some(ref buf) = sc.shadow_params_buffer {
            let shadow_params = GpuShadowParams {
                cascade_index: ci as u32,
                _pad0: 0,
                _pad1: 0,
                _pad2: 0,
            };
            render_queue.write_buffer(buf, 0, bytemuck::bytes_of(&shadow_params));
        }
        // Clear shadow counters.
        if let Some(ref buf) = sc.group_counters_buffer {
            render_queue.write_buffer(
                buf,
                0,
                bytemuck::cast_slice(&vec![0u32; max_shadow as usize]),
            );
        }
        // Create bind group 2 for this cascade.
        let visible_buf = sc.visible_buffer.as_ref().unwrap();
        let draw_args_buf = sc.draw_args_buffer.as_ref().unwrap();
        let uniforms_buf = sc.group_uniforms_buffer.as_ref().unwrap();
        let counters_buf = sc.group_counters_buffer.as_ref().unwrap();
        let params_buf = sc.shadow_params_buffer.as_ref().unwrap();
        let frusta_buf = cascade_frusta_buf.as_ref().unwrap();
        sc.bind_group = Some(render_device.create_bind_group(
            Some("gpu_cull_shadow_bg2"),
            &cull_pipeline.bind_group_layout_2,
            &BindGroupEntries::sequential((
                params_buf.as_entire_binding(),
                visible_buf.as_entire_binding(),
                draw_args_buf.as_entire_binding(),
                counters_buf.as_entire_binding(),
                uniforms_buf.as_entire_binding(),
                frusta_buf.as_entire_binding(),
            )),
        ));
    }

    // Upload per-group draw args template to each cascade's shadow draw args buffer.
    let shadow_template_data: Vec<GpuDrawArgsTemplate> = group_metas
        .iter()
        .scan(0u32, |running_offset, meta| {
            let first_instance = *running_offset;
            *running_offset += meta.source_count;
            Some(GpuDrawArgsTemplate {
                index_count: 0,
                _instance_count_init: 0,
                first_index: 0,
                vertex_offset: 0,
                _first_instance_init: first_instance,
            })
        })
        .collect();
    for sc in cull_buffers.shadow_cascades.iter() {
        if let Some(ref buf) = sc.draw_args_buffer {
            render_queue.write_buffer(buf, 0, bytemuck::cast_slice(&shadow_template_data));
        }
    }

    // Upload per-group draw args template.
    // first_instance = source prefix sum (where this group starts in the visible buffer).
    // instance_count is overwritten by the compute shader.
    let template_data: Vec<GpuDrawArgsTemplate> = group_metas
        .iter()
        .scan(0u32, |running_offset, meta| {
            let first_instance = *running_offset;
            *running_offset += meta.source_count;
            Some(GpuDrawArgsTemplate {
                index_count: 0, // set per-entity in DrawMeshInstanced
                _instance_count_init: 0,
                first_index: 0,
                vertex_offset: 0,
                _first_instance_init: first_instance,
            })
        })
        .collect();
    render_queue.write_buffer(
        &draw_args_buf,
        0,
        bytemuck::cast_slice(&template_data),
    );

    // ── Create bind groups ──
    cull_buffers.bind_group_0 = Some(render_device.create_bind_group(
        Some("gpu_cull_bg0"),
        &cull_pipeline.bind_group_layout_0,
        &BindGroupEntries::sequential((
            source_buf.as_entire_binding(),
            group_meta_buf.as_entire_binding(),
            cull_params_buf.as_entire_binding(),
        )),
    ));
    cull_buffers.bind_group_1 = Some(render_device.create_bind_group(
        Some("gpu_cull_bg1"),
        &cull_pipeline.bind_group_layout_1,
        &BindGroupEntries::sequential((
            visible_buf.as_entire_binding(),
            draw_args_buf.as_entire_binding(),
            group_uniforms_buf.as_entire_binding(),
            group_counters_buf.as_entire_binding(),
        )),
    ));

    cull_buffers.group_entity_map = group_entity_map;
    cull_buffers.ready = true;

    // Create vertex bind group 4 for the GPU cull path (visible instances buffer).
    let vertex_layout = gpu_cull_vertex_bind_group_layout(&render_device);
    cull_buffers.vertex_bind_group = Some(render_device.create_bind_group(
        Some("gpu_cull_vertex_bg"),
        &vertex_layout,
        &BindGroupEntries::sequential((visible_buf.as_entire_binding(),)),
    ));

    // Emit GPU vegetation metrics.
    if let Some(sink) = timing.as_deref() {
        sink.push_count("GPU Vegetation Source Instances", total_source as f64);
        sink.push_count("GPU Vegetation Groups", total_groups as f64);
        sink.push_count("GPU Vegetation Cascades", cascade_count as f64);
        sink.push_count("GPU Vegetation Active", 1.0);
    }
}

// ──────────────────────── Render graph node ──────────────────────────────────

static GPU_CULL_PIPELINE_NOT_READY_LOGGED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[derive(Default)]
pub struct GpuVegetationCullNode;

impl ViewNode for GpuVegetationCullNode {
    type ViewQuery = ();

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        _view: (),
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        let pipeline_res = world.resource::<GpuVegetationCullPipeline>();
        let buffers = world.resource::<GpuVegetationCullBuffers>();
        let pipeline_cache = world.resource::<PipelineCache>();

        if !buffers.ready {
            return Ok(());
        }

        let Some(pipeline) = pipeline_cache.get_compute_pipeline(pipeline_res.pipeline_id) else {
            if !GPU_CULL_PIPELINE_NOT_READY_LOGGED.swap(true, std::sync::atomic::Ordering::Relaxed) {
                warn_once!("GPU vegetation cull pipeline not yet compiled; falling back to CPU path");
            }
            return Ok(());
        };
        let Some(bg0) = &buffers.bind_group_0 else {
            return Ok(());
        };
        let Some(bg1) = &buffers.bind_group_1 else {
            return Ok(());
        };

        let config = world.resource::<GpuVegetationConfig>();
        let max_instances = config.buffers.max_source_instances;

        let mut pass = render_context
            .command_encoder()
            .begin_compute_pass(&ComputePassDescriptor {
                label: Some("gpu_vegetation_cull_pass"),
                timestamp_writes: None,
            });

        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, bg0, &[]);
        pass.set_bind_group(1, bg1, &[]);

        let workgroups = (max_instances + WORKGROUP_SIZE - 1) / WORKGROUP_SIZE;
        pass.dispatch_workgroups(workgroups, 1, 1);

        // Dispatch shadow cull for each cascade.
        for sc in &buffers.shadow_cascades {
            if let Some(ref bg2) = sc.bind_group {
                pass.set_bind_group(2, bg2, &[]);
                pass.dispatch_workgroups(workgroups, 1, 1);
            }
        }

        drop(pass);
        Ok(())
    }
}

// ──────────────────────── Plugin setup ───────────────────────────────────────

pub fn init_gpu_cull_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    pipeline_cache: Res<PipelineCache>,
    asset_server: Res<AssetServer>,
) {
    let shader: Handle<Shader> = asset_server.load(GPU_CULL_SHADER_PATH);
    info!("GPU vegetation cull pipeline initializing (compute cull + indirect draw)");

    // Bind group 0: compute inputs (source_instances, group_meta, cull_params).
    let bg_entries_0: Vec<BindGroupLayoutEntry> = BindGroupLayoutEntries::sequential(
        ShaderStages::COMPUTE,
        (
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
            binding_types::uniform_buffer::<GpuCullParams>(false),
        ),
    )
    .to_vec();

    // Bind group 1: compute outputs (visible_instances, draw_args, group_uniforms, group_counters).
    let bg_entries_1: Vec<BindGroupLayoutEntry> = BindGroupLayoutEntries::sequential(
        ShaderStages::COMPUTE,
        (
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
        ),
    )
    .to_vec();

    // Bind group 2: shadow cascade outputs (shadow_params, shadow_visible, shadow_draw_args, shadow_counters, shadow_uniforms, cascade_clip).
    let bg_entries_2: Vec<BindGroupLayoutEntry> = BindGroupLayoutEntries::sequential(
        ShaderStages::COMPUTE,
        (
            binding_types::uniform_buffer::<GpuShadowParams>(false),
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
            binding_types::uniform_buffer_sized(false, None),
        ),
    )
    .to_vec();

    let bind_group_layout_0 = render_device.create_bind_group_layout(
        Some("gpu_cull_bg_layout_0"),
        &bg_entries_0,
    );
    let bind_group_layout_1 = render_device.create_bind_group_layout(
        Some("gpu_cull_bg_layout_1"),
        &bg_entries_1,
    );
    let bind_group_layout_2 = render_device.create_bind_group_layout(
        Some("gpu_cull_bg_layout_2"),
        &bg_entries_2,
    );

    let pipeline_id = pipeline_cache.queue_compute_pipeline(ComputePipelineDescriptor {
        label: Some(Cow::Borrowed("gpu_vegetation_cull_pipeline")),
        layout: vec![
            BindGroupLayoutDescriptor {
                label: Cow::Borrowed("gpu_cull_bg_layout_0"),
                entries: bg_entries_0,
            },
            BindGroupLayoutDescriptor {
                label: Cow::Borrowed("gpu_cull_bg_layout_1"),
                entries: bg_entries_1,
            },
            BindGroupLayoutDescriptor {
                label: Cow::Borrowed("gpu_cull_bg_layout_2"),
                entries: bg_entries_2,
            },
        ],
        push_constant_ranges: vec![],
        shader,
        shader_defs: vec![],
        entry_point: Some(Cow::Borrowed("cull_main")),
        zero_initialize_workgroup_memory: false,
    });

    commands.insert_resource(GpuVegetationCullPipeline {
        pipeline_id,
        bind_group_layout_0,
        bind_group_layout_1,
        bind_group_layout_2,
    });
    commands.insert_resource(GpuVegetationCullBuffers::default());
}

/// Bind group 4 entries for the vertex shader (visible instances storage buffer).
/// Returns a leaked static slice for use in pipeline layout.
pub fn gpu_cull_vertex_bind_group_entries() -> &'static [BindGroupLayoutEntry] {
    let entries = BindGroupLayoutEntries::sequential(
        ShaderStages::VERTEX,
        (
            binding_types::storage_buffer_sized(false, None),
        ),
    );
    Box::leak(Box::new(entries))
}

/// Bind group 4 layout for the vertex shader (visible instances storage buffer).
pub fn gpu_cull_vertex_bind_group_layout(render_device: &RenderDevice) -> BindGroupLayout {
    render_device.create_bind_group_layout(
        Some("gpu_cull_vertex_bg_layout"),
        &gpu_cull_vertex_bind_group_entries(),
    )
}
