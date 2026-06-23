//! GPU-driven prop cull/indirect-draw pipeline (Phase 1: source buffer).
//!
//! Gated behind `cfg(feature = "gpu_vegetation")`. When the feature is off,
//! none of this code compiles and the CPU path runs unchanged.

use std::collections::HashMap;

use bevy::prelude::*;
use bevy::render::renderer::{RenderDevice, RenderQueue};
use bevy::render::render_resource::BufferUsages;
use bevy::render::render_resource::BufferDescriptor;
use bevy::render::render_resource::Buffer;

use super::GpuVegetationConfig;
use super::instanced_render::PropInstance;

/// Byte size of a single source instance on the GPU.
/// Must match `PropInstance` layout (64 bytes: 4x4 f32 transform + 4 f32 tint).
const SOURCE_INSTANCE_BYTES: u64 = std::mem::size_of::<PropInstance>() as u64;

/// Per-group tracking entry in the source buffer.
#[derive(Clone, Debug)]
struct GroupSlot {
    /// Byte offset into the storage buffer.
    offset: u64,
    /// Number of instances in this slot.
    count: u32,
    /// Version at last upload (matches `InstancedPropGroup.version`).
    uploaded_version: u64,
}

/// GPU source-instance storage buffer for the vegetation pipeline.
///
/// Holds a single large storage buffer partitioned into per-group slots.
/// Only dirty groups are re-uploaded when their `version` changes.
#[derive(Resource)]
pub struct GpuVegetationSourceBuffer {
    /// The underlying wgpu storage buffer (None until first allocation).
    buffer: Option<Buffer>,
    /// Maximum number of instances the buffer can hold.
    capacity: u32,
    /// Current total instances uploaded across all groups.
    total_instances: u32,
    /// Per-group slot tracking (keyed by main-world Entity).
    group_slots: HashMap<Entity, GroupSlot>,
    /// Monotonically increasing generation counter (bumped on any change).
    generation: u64,
}

impl Default for GpuVegetationSourceBuffer {
    fn default() -> Self {
        Self {
            buffer: None,
            capacity: 0,
            total_instances: 0,
            group_slots: HashMap::new(),
            generation: 0,
        }
    }
}

impl GpuVegetationSourceBuffer {
    /// Returns the storage buffer for binding in compute passes.
    pub fn buffer(&self) -> Option<&Buffer> {
        self.buffer.as_ref()
    }

    /// Returns the total number of instances currently uploaded.
    pub fn total_instances(&self) -> u32 {
        self.total_instances
    }

    /// Returns the per-group offset and count, if uploaded.
    pub fn group_slot(&self, entity: Entity) -> Option<(u32, u32)> {
        self.group_slots
            .get(&entity)
            .map(|slot| (slot.offset as u32, slot.count))
    }

    /// Returns the current generation (bumped on any buffer change).
    pub fn generation(&self) -> u64 {
        self.generation
    }
}

/// Snapshot of source instances extracted from the main world for GPU upload.
#[derive(Clone)]
pub struct ExtractedGroupSource {
    pub entity: Entity,
    pub instances: Vec<PropInstance>,
    pub version: u64,
}

/// System parameter set for extracting source instances from the main world.
/// Runs in the Extract schedule.
pub fn extract_gpu_vegetation_source_instances(
    mut extracted: Local<Vec<ExtractedGroupSource>>,
    groups: Query<(Entity, &super::instanced_render::InstancedPropGroup)>,
) {
    extracted.clear();
    for (entity, group) in &groups {
        let source = group.source_instances();
        if source.is_empty() {
            continue;
        }
        extracted.push(ExtractedGroupSource {
            entity,
            instances: source.to_vec(),
            version: group.version,
        });
    }
}

/// Upload dirty source instances to the GPU storage buffer.
/// Runs in `RenderSystems::PrepareResources`.
pub fn prepare_gpu_vegetation_source_buffer(
    extracted_instances: Local<Vec<ExtractedGroupSource>>,
    render_device: Res<RenderDevice>,
    render_queue: Res<RenderQueue>,
    mut source_buffer: ResMut<GpuVegetationSourceBuffer>,
    config: Option<Res<GpuVegetationConfig>>,
    capabilities: Option<Res<crate::rendering::device::capabilities::GraphicsCapabilities>>,
    bench_toggles: Option<Res<crate::diagnostics::bench::BenchRenderToggles>>,
) {
    let Some(config) = config else {
        return;
    };
    let config = config.into_inner();
    if !config.enabled || config.force_cpu_fallback {
        return;
    }
    if config.disable_on_integrated_gpu && capabilities.is_some_and(|c| c.integrated_gpu) {
        return;
    }
    let force_on = bench_toggles.as_ref().is_some_and(|t| t.force_gpu_vegetation.unwrap_or(false));
    let force_off = bench_toggles.as_ref().is_some_and(|t| t.disable_gpu_vegetation.unwrap_or(false));
    if force_off { return; }
    if !config.enabled && !force_on { return; }

    let max_instances = config.buffers.max_source_instances;

    // Ensure the buffer exists and has sufficient capacity.
    if source_buffer.capacity < max_instances {
        let size = max_instances as u64 * SOURCE_INSTANCE_BYTES;
        let buffer = render_device.create_buffer(&BufferDescriptor {
            label: Some("gpu_vegetation_source_buffer"),
            size,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        source_buffer.buffer = Some(buffer);
        source_buffer.capacity = max_instances;
        source_buffer.group_slots.clear();
        source_buffer.total_instances = 0;
    }

    // Process extracted instances: upload dirty groups and append new ones.
    let Some(buffer) = source_buffer.buffer.clone() else {
        return;
    };
    for extracted in extracted_instances.iter() {
        if let Some(slot) = source_buffer.group_slots.get(&extracted.entity) {
            if slot.uploaded_version == extracted.version {
                continue; // Already up to date.
            }
            // Copy slot data before mutable borrow.
            let slot_offset = slot.offset;
            // Re-upload existing slot (same offset, possibly different count).
            let byte_offset = slot_offset * SOURCE_INSTANCE_BYTES;
            let contents: &[u8] = bytemuck::cast_slice(extracted.instances.as_slice());
            render_queue.write_buffer(&buffer, byte_offset, contents);
            source_buffer.group_slots.insert(
                extracted.entity,
                GroupSlot {
                    offset: slot_offset,
                    count: extracted.instances.len() as u32,
                    uploaded_version: extracted.version,
                },
            );
        } else {
            // New group — append at the end.
            let new_offset = source_buffer.total_instances;
            let new_count = extracted.instances.len() as u32;
            if new_offset + new_count > max_instances {
                warn!(
                    "gpu_vegetation: source buffer overflow at group {:?} \
                     ({} + {} > {}); skipping",
                    extracted.entity, new_offset, new_count, max_instances
                );
                continue;
            }
            let byte_offset = new_offset as u64 * SOURCE_INSTANCE_BYTES;
            let contents: &[u8] = bytemuck::cast_slice(extracted.instances.as_slice());
            render_queue.write_buffer(&buffer, byte_offset, contents);
            source_buffer.group_slots.insert(
                extracted.entity,
                GroupSlot {
                    offset: new_offset as u64,
                    count: new_count,
                    uploaded_version: extracted.version,
                },
            );
            source_buffer.total_instances += new_count;
        }
        source_buffer.generation += 1;
    }
}

/// Cleanup slots for groups that no longer exist in the extracted data.
/// Runs after `prepare_gpu_vegetation_source_buffer`.
pub fn cleanup_gpu_vegetation_stale_slots(
    extracted_instances: Local<Vec<ExtractedGroupSource>>,
    mut source_buffer: ResMut<GpuVegetationSourceBuffer>,
) {
    let active_entities: std::collections::HashSet<Entity> = extracted_instances
        .iter()
        .map(|e| e.entity)
        .collect();

    let stale: Vec<Entity> = source_buffer
        .group_slots
        .keys()
        .filter(|e| !active_entities.contains(e))
        .copied()
        .collect();

    if stale.is_empty() {
        return;
    }

    // Note: we don't compact the buffer (holes are acceptable for now).
    // A compaction pass can be added later if fragmentation becomes a problem.
    for entity in stale {
        source_buffer.group_slots.remove(&entity);
        source_buffer.generation += 1;
    }

    // Recompute total_instances from remaining slots.
    source_buffer.total_instances = source_buffer
        .group_slots
        .values()
        .map(|slot| slot.count)
        .sum();
}
