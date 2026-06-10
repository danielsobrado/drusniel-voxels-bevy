use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::{
    MainWorld,
    render_resource::{Buffer, BufferDescriptor, BufferUsages},
    renderer::{RenderAdapterInfo, RenderDevice, RenderQueue},
};
use std::collections::{HashMap, HashSet, VecDeque};
use wgpu::DeviceType;

use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::naadf::cache::NaadfCache;
use crate::rendering::naadf::config::NaadfConfig;
use crate::rendering::naadf::entities::{NaadfEntityVolumeRecord, NaadfEntityVolumeRegistry};
use crate::rendering::naadf::layout::{
    BLOCKS_PER_CHUNK, DirectionalBounds, NaadfBlock, NaadfChunk,
};
use crate::rendering::naadf::prepare::NaadfUploadBudget;
use crate::rendering::naadf::stats::{NaadfRenderStatsBridge, NaadfStats};
use crate::rendering::naadf::streaming::NaadfStreamingState;
use crate::rendering::render_timing::{RenderTimingSink, render_timing_guard};

pub const NAADF_VOXEL_RECORD_BYTES: u64 = 4;
pub const NAADF_RAW_VOXEL_RECORD_BYTES: u64 = 4;
pub const NAADF_MATERIAL_RECORD_BYTES: u64 = 4;
pub const NAADF_MIP_TRAVERSAL_RECORD_BYTES: u64 = 4;
pub const NAADF_MIP_PAYLOAD_RECORD_BYTES: u64 = 4;
pub const NAADF_MIP_BOUNDS_RECORD_BYTES: u64 = 4;
pub const NAADF_BLOCK_RECORD_BYTES: u64 = 32;
pub const NAADF_CHUNK_RECORD_BYTES: u64 = 32;
pub const NAADF_CHUNK_LOOKUP_RECORD_BYTES: u64 = 16;
pub const NAADF_ENTITY_VOLUME_RECORD_VEC4S: usize = 17;
pub const NAADF_ENTITY_VOLUME_RECORD_BYTES: u64 = NAADF_ENTITY_VOLUME_RECORD_VEC4S as u64 * 16;
pub const NAADF_ENTITY_MATERIAL_RECORD_BYTES: u64 = 4;
pub const NAADF_DEBUG_RAY_RECORDS: u64 = 1024;
pub const NAADF_DEBUG_RAY_RECORD_BYTES: u64 = 64;
pub const NAADF_STATS_BUFFER_BYTES: u64 = 256;
pub const NAADF_PACKED_BLOCK_WORDS: usize = 8;
pub const NAADF_PACKED_CHUNK_WORDS: usize = 8;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfGpuBufferPlan {
    pub max_chunks: u32,
    pub voxel_records: u64,
    pub raw_voxel_records: u64,
    pub material_records: u64,
    pub mip_traversal_records: u64,
    pub mip_payload_records: u64,
    pub mip_bounds_records: u64,
    pub block_records: u64,
    pub chunk_records: u64,
    pub chunk_lookup_records: u64,
    pub voxel_buffer_bytes: u64,
    pub raw_voxel_buffer_bytes: u64,
    pub material_buffer_bytes: u64,
    pub mip_traversal_buffer_bytes: u64,
    pub mip_payload_buffer_bytes: u64,
    pub mip_bounds_buffer_bytes: u64,
    pub block_buffer_bytes: u64,
    pub chunk_buffer_bytes: u64,
    pub chunk_lookup_buffer_bytes: u64,
    pub upload_buffer_bytes: u64,
    pub debug_ray_buffer_bytes: u64,
    pub stats_buffer_bytes: u64,
    pub estimated_bytes: u64,
}

impl NaadfGpuBufferPlan {
    pub fn for_chunk_capacity(max_chunks: u32) -> Self {
        let voxel_records = max_chunks as u64 * crate::constants::CHUNK_VOLUME as u64;
        let raw_voxel_records = voxel_records;
        let material_records = voxel_records;
        let mip_traversal_records =
            max_chunks as u64 * crate::rendering::naadf::layout::MIP_CELLS_PER_CHUNK as u64;
        let mip_payload_records = mip_traversal_records;
        let mip_bounds_records = mip_traversal_records;
        let block_records =
            max_chunks as u64 * crate::rendering::naadf::layout::BLOCKS_PER_CHUNK as u64;
        let chunk_records = max_chunks as u64;
        let chunk_lookup_records = max_chunks as u64;
        let voxel_buffer_bytes = voxel_records * NAADF_VOXEL_RECORD_BYTES;
        let raw_voxel_buffer_bytes = raw_voxel_records * NAADF_RAW_VOXEL_RECORD_BYTES;
        let material_buffer_bytes = material_records * NAADF_MATERIAL_RECORD_BYTES;
        let mip_traversal_buffer_bytes = mip_traversal_records * NAADF_MIP_TRAVERSAL_RECORD_BYTES;
        let mip_payload_buffer_bytes = mip_payload_records * NAADF_MIP_PAYLOAD_RECORD_BYTES;
        let mip_bounds_buffer_bytes = mip_bounds_records * NAADF_MIP_BOUNDS_RECORD_BYTES;
        let block_buffer_bytes = block_records * NAADF_BLOCK_RECORD_BYTES;
        let chunk_buffer_bytes = chunk_records * NAADF_CHUNK_RECORD_BYTES;
        let chunk_lookup_buffer_bytes = chunk_lookup_records * NAADF_CHUNK_LOOKUP_RECORD_BYTES;
        let upload_buffer_bytes = crate::constants::CHUNK_VOLUME as u64 * NAADF_VOXEL_RECORD_BYTES;
        let debug_ray_buffer_bytes = NAADF_DEBUG_RAY_RECORDS * NAADF_DEBUG_RAY_RECORD_BYTES;
        let stats_buffer_bytes = NAADF_STATS_BUFFER_BYTES;
        let estimated_bytes = voxel_buffer_bytes
            + raw_voxel_buffer_bytes
            + material_buffer_bytes
            + mip_traversal_buffer_bytes
            + mip_payload_buffer_bytes
            + mip_bounds_buffer_bytes
            + block_buffer_bytes
            + chunk_buffer_bytes
            + chunk_lookup_buffer_bytes
            + upload_buffer_bytes
            + debug_ray_buffer_bytes
            + stats_buffer_bytes;
        Self {
            max_chunks,
            voxel_records,
            raw_voxel_records,
            material_records,
            mip_traversal_records,
            mip_payload_records,
            mip_bounds_records,
            block_records,
            chunk_records,
            chunk_lookup_records,
            voxel_buffer_bytes,
            raw_voxel_buffer_bytes,
            material_buffer_bytes,
            mip_traversal_buffer_bytes,
            mip_payload_buffer_bytes,
            mip_bounds_buffer_bytes,
            block_buffer_bytes,
            chunk_buffer_bytes,
            chunk_lookup_buffer_bytes,
            upload_buffer_bytes,
            debug_ray_buffer_bytes,
            stats_buffer_bytes,
            estimated_bytes,
        }
    }

    pub fn fits_memory_cap(&self, max_gpu_memory_mb: u32) -> bool {
        self.estimated_bytes <= max_gpu_memory_mb as u64 * 1024 * 1024
    }
}

#[derive(Resource, Clone, Debug, Default, PartialEq, Eq)]
pub struct ExtractedNaadfGpuConfig {
    pub enabled: bool,
    pub max_chunks: u32,
    pub max_gpu_memory_mb: u32,
    pub allow_integrated_gpu: bool,
    pub prefer_gpu_builder: bool,
    pub debug_readback: bool,
}

impl From<&NaadfConfig> for ExtractedNaadfGpuConfig {
    fn from(config: &NaadfConfig) -> Self {
        Self {
            enabled: config.enabled,
            max_chunks: config.chunk_cache.max_chunks,
            max_gpu_memory_mb: config.chunk_cache.max_gpu_memory_mb,
            allow_integrated_gpu: config.gpu.allow_integrated_gpu,
            prefer_gpu_builder: config.gpu_builder_enabled(),
            debug_readback: config.gpu.debug_readback && naadf_gpu_debug_readback_allowed(),
        }
    }
}

pub fn naadf_gpu_debug_readback_allowed() -> bool {
    cfg!(debug_assertions) || env_flag_enabled("DRUSNIEL_NAADF_DEBUG_READBACK")
}

fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

#[derive(Resource, Default)]
pub struct NaadfGpuBuffers {
    allocation: Option<NaadfGpuBufferAllocation>,
    status: NaadfGpuBufferStatus,
}

pub struct NaadfGpuBufferAllocation {
    pub plan: NaadfGpuBufferPlan,
    pub debug_readback: bool,
    pub voxel_buffer: Buffer,
    pub raw_voxel_buffer: Buffer,
    pub material_buffer: Buffer,
    pub mip_traversal_buffer: Buffer,
    pub mip_payload_buffer: Buffer,
    pub mip_bounds_buffer: Buffer,
    pub block_buffer: Buffer,
    pub chunk_buffer: Buffer,
    pub chunk_lookup_buffer: Buffer,
    pub upload_buffer: Buffer,
    pub debug_ray_buffer: Buffer,
    pub stats_buffer: Buffer,
    pub stats_readback_buffer: Buffer,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NaadfGpuBufferStatus {
    pub allocated: bool,
    pub max_chunks: u32,
    pub estimated_bytes: u64,
    pub fallback_reason: Option<String>,
}

#[derive(Resource, Default, Debug)]
pub struct NaadfGpuUploadQueue {
    pending: VecDeque<IVec3>,
    pending_set: HashSet<IVec3>,
    queued_total: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfGpuUploadQueueStats {
    pub pending: usize,
    pub queued_total: u64,
}

#[derive(Resource, Default, Debug)]
pub struct ExtractedNaadfGpuUploads {
    pub uploads: Vec<NaadfChunkUpload>,
    pub lookup_records: Vec<[u32; 4]>,
    pub lookup_records_generation: u64,
    pub estimated_bytes: u32,
}

#[derive(Resource, Default, Debug)]
pub struct ExtractedNaadfEntityGpuUploads {
    pub entity_records: Vec<NaadfEntityGpuRecord>,
    pub material_records: Vec<u32>,
    pub entity_count: u32,
    pub estimated_bytes: u32,
}

pub type NaadfEntityGpuRecord = [[f32; 4]; NAADF_ENTITY_VOLUME_RECORD_VEC4S];

#[derive(Resource, Default)]
pub struct NaadfEntityGpuBuffers {
    allocation: Option<NaadfEntityGpuBufferAllocation>,
}

pub struct NaadfEntityGpuBufferAllocation {
    pub entity_capacity: u64,
    pub material_capacity: u64,
    pub entity_record_buffer: Buffer,
    pub entity_material_buffer: Buffer,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NaadfChunkUpload {
    pub chunk_pos: IVec3,
    pub slot: u32,
    pub chunk_record: [u32; NAADF_PACKED_CHUNK_WORDS],
    pub block_records: Vec<[u32; NAADF_PACKED_BLOCK_WORDS]>,
    pub voxel_records: Vec<u32>,
    pub raw_voxel_records: Vec<u32>,
    pub material_records: Vec<u32>,
    pub estimated_bytes: u32,
}

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfGpuUploadStats {
    pub uploaded_chunks_last_frame: u32,
    pub uploaded_bytes_last_frame: u32,
}

impl NaadfGpuUploadQueue {
    pub fn queue(&mut self, chunk_pos: IVec3) -> bool {
        if self.pending_set.contains(&chunk_pos) {
            return false;
        }
        self.pending.push_back(chunk_pos);
        self.pending_set.insert(chunk_pos);
        self.queued_total = self.queued_total.saturating_add(1);
        true
    }

    pub fn pop_pending(&mut self) -> Option<IVec3> {
        let chunk_pos = self.pending.pop_front()?;
        self.pending_set.remove(&chunk_pos);
        Some(chunk_pos)
    }

    pub fn stats(&self) -> NaadfGpuUploadQueueStats {
        NaadfGpuUploadQueueStats {
            pending: self.pending.len(),
            queued_total: self.queued_total,
        }
    }

    pub fn pending_chunks(&self) -> impl Iterator<Item = IVec3> + '_ {
        self.pending.iter().copied()
    }
}

impl NaadfGpuBuffers {
    pub fn allocation(&self) -> Option<&NaadfGpuBufferAllocation> {
        self.allocation.as_ref()
    }

    pub fn status(&self) -> &NaadfGpuBufferStatus {
        &self.status
    }

    fn clear_with_status(&mut self, plan: NaadfGpuBufferPlan, fallback_reason: impl Into<String>) {
        self.allocation = None;
        self.status = NaadfGpuBufferStatus {
            allocated: false,
            max_chunks: plan.max_chunks,
            estimated_bytes: plan.estimated_bytes,
            fallback_reason: Some(fallback_reason.into()),
        };
    }
}

pub fn extract_naadf_gpu_config(mut commands: Commands, main_world: Res<MainWorld>) {
    let extracted = main_world
        .get_resource::<NaadfConfig>()
        .map(ExtractedNaadfGpuConfig::from)
        .unwrap_or_default();
    commands.insert_resource(extracted);
}

pub fn queue_gpu_uploads_from_cache_report(
    config: Res<NaadfConfig>,
    cache: Res<NaadfCache>,
    mut upload_queue: ResMut<NaadfGpuUploadQueue>,
    mut stats: ResMut<NaadfStats>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    let _timer = timing.as_deref_mut().map(|timing| {
        area_timer(
            timing,
            frame.as_deref().map_or(0, |frame| frame.0),
            "NAADF Upload Queue",
        )
    });

    if !config.enabled {
        return;
    }

    for chunk_pos in &cache.last_report().rebuilt_chunks {
        upload_queue.queue(*chunk_pos);
    }

    let upload_stats = upload_queue.stats();
    stats.gpu_uploads_pending = upload_stats.pending as u32;
    stats.gpu_uploads_queued_total = upload_stats.queued_total;
}

pub fn extract_naadf_gpu_uploads(mut commands: Commands, mut main_world: ResMut<MainWorld>) {
    let mut extracted = ExtractedNaadfGpuUploads::default();

    main_world.resource_scope(|world, mut upload_queue: Mut<NaadfGpuUploadQueue>| {
        let Some(config) = world.get_resource::<NaadfConfig>() else {
            return;
        };
        if !config.enabled {
            return;
        }
        let Some(cache) = world.get_resource::<NaadfCache>() else {
            return;
        };
        let Some(table) = world.get_resource::<NaadfGpuChunkTable>() else {
            return;
        };
        let budget = NaadfUploadBudget::from(config);
        while extracted.uploads.len() < budget.max_chunks as usize {
            let Some(chunk_pos) = upload_queue.pop_pending() else {
                break;
            };
            let Some(chunk) = cache.get(chunk_pos) else {
                continue;
            };
            let Some(slot) = table.slot(chunk_pos) else {
                continue;
            };
            let upload = pack_naadf_chunk_upload(chunk, slot);
            if extracted
                .estimated_bytes
                .saturating_add(upload.estimated_bytes)
                > budget.max_bytes
            {
                upload_queue.queue(chunk_pos);
                break;
            }
            extracted.estimated_bytes = extracted
                .estimated_bytes
                .saturating_add(upload.estimated_bytes);
            extracted.uploads.push(upload);
        }
        let pending_chunks = upload_queue.pending_chunks().collect::<HashSet<_>>();
        extracted.lookup_records = table.lookup_records_excluding(&pending_chunks);
        extracted.lookup_records_generation =
            lookup_generation_for_pending_uploads(table.generation(), &pending_chunks);
    });

    let upload_stats = main_world
        .get_resource::<NaadfGpuUploadQueue>()
        .map(NaadfGpuUploadQueue::stats);
    if let (Some(upload_stats), Some(mut stats)) =
        (upload_stats, main_world.get_resource_mut::<NaadfStats>())
    {
        stats.gpu_uploads_pending = upload_stats.pending as u32;
        stats.gpu_uploads_queued_total = upload_stats.queued_total;
    }

    commands.insert_resource(extracted);
}

pub fn extract_naadf_entity_gpu_uploads(mut commands: Commands, main_world: Res<MainWorld>) {
    let mut extracted = ExtractedNaadfEntityGpuUploads::default();

    let Some(config) = main_world.get_resource::<NaadfConfig>() else {
        commands.insert_resource(extracted);
        return;
    };
    if !config.enabled {
        commands.insert_resource(extracted);
        return;
    }
    let Some(registry) = main_world.get_resource::<NaadfEntityVolumeRegistry>() else {
        commands.insert_resource(extracted);
        return;
    };

    for record in registry.iter().filter(|record| record.occupied_voxels != 0) {
        let material_base = extracted.material_records.len() as u32;
        extracted.material_records.extend(
            record
                .material_ids
                .iter()
                .map(|material_id| *material_id as u32),
        );
        extracted
            .entity_records
            .push(pack_entity_volume_record(record, material_base));
    }

    extracted.entity_count = extracted.entity_records.len() as u32;
    extracted.estimated_bytes = (extracted.entity_records.len() as u64
        * NAADF_ENTITY_VOLUME_RECORD_BYTES
        + extracted.material_records.len() as u64 * NAADF_ENTITY_MATERIAL_RECORD_BYTES)
        as u32;
    commands.insert_resource(extracted);
}

pub fn prepare_naadf_gpu_buffers(
    config: Res<ExtractedNaadfGpuConfig>,
    adapter_info: Option<Res<RenderAdapterInfo>>,
    render_device: Res<RenderDevice>,
    mut buffers: ResMut<NaadfGpuBuffers>,
) {
    let plan = NaadfGpuBufferPlan::for_chunk_capacity(config.max_chunks);

    if !config.enabled {
        buffers.clear_with_status(plan, "NAADF GPU buffers disabled by config");
        return;
    }
    if config.max_chunks == 0 {
        buffers.clear_with_status(plan, "NAADF GPU chunk capacity is zero");
        return;
    }
    if matches!(
        adapter_info.as_deref().map(|info| info.device_type),
        Some(DeviceType::IntegratedGpu)
    ) && !config.allow_integrated_gpu
    {
        buffers.clear_with_status(plan, "NAADF GPU buffers blocked on integrated GPU");
        return;
    }
    if !plan.fits_memory_cap(config.max_gpu_memory_mb) {
        let fallback_reason = format!(
            "NAADF GPU buffer estimate {} bytes exceeds {} MiB cap",
            plan.estimated_bytes, config.max_gpu_memory_mb
        );
        buffers.clear_with_status(plan, fallback_reason);
        return;
    }
    if buffers.allocation.as_ref().is_some_and(|allocation| {
        allocation.plan == plan && allocation.debug_readback == config.debug_readback
    }) {
        return;
    }

    buffers.allocation = Some(create_naadf_gpu_allocation(
        &render_device,
        plan.clone(),
        config.debug_readback,
    ));
    buffers.status = NaadfGpuBufferStatus {
        allocated: true,
        max_chunks: plan.max_chunks,
        estimated_bytes: plan.estimated_bytes,
        fallback_reason: None,
    };
}

pub fn prepare_naadf_entity_gpu_buffers(
    uploads: Res<ExtractedNaadfEntityGpuUploads>,
    render_device: Res<RenderDevice>,
    mut buffers: ResMut<NaadfEntityGpuBuffers>,
) {
    let entity_capacity = (uploads.entity_records.len() as u64).max(1);
    let material_capacity = (uploads.material_records.len() as u64).max(1);
    if buffers.allocation.as_ref().is_some_and(|allocation| {
        allocation.entity_capacity >= entity_capacity
            && allocation.material_capacity >= material_capacity
    }) {
        return;
    }

    buffers.allocation = Some(create_naadf_entity_gpu_allocation(
        &render_device,
        entity_capacity,
        material_capacity,
    ));
}

pub fn sync_naadf_gpu_status_to_main(
    buffers: Res<NaadfGpuBuffers>,
    uploads: Res<NaadfGpuUploadStats>,
    bridge: Res<NaadfRenderStatsBridge>,
) {
    bridge.publish_gpu_status(
        if buffers.status.allocated {
            buffers.status.estimated_bytes
        } else {
            0
        },
        buffers.status.max_chunks,
        uploads.uploaded_chunks_last_frame,
        uploads.uploaded_bytes_last_frame,
    );
}

pub fn sync_gpu_chunk_table_from_cache(
    config: Res<NaadfConfig>,
    cache: Res<NaadfCache>,
    mut table: ResMut<NaadfGpuChunkTable>,
    mut upload_queue: ResMut<NaadfGpuUploadQueue>,
    streaming_state: Res<NaadfStreamingState>,
    mut stats: ResMut<NaadfStats>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    let _timer = timing.as_deref_mut().map(|timing| {
        area_timer(
            timing,
            frame.as_deref().map_or(0, |frame| frame.0),
            "NAADF Chunk Table Sync",
        )
    });

    table.set_capacity(config.chunk_cache.max_chunks);

    if !config.enabled {
        table.clear_allocations();
        sync_chunk_table_stats(&table, &mut stats);
        return;
    }

    let stale_chunks: Vec<_> = table
        .assigned_chunks()
        .filter(|chunk_pos| !cache.contains_chunk(*chunk_pos))
        .collect();
    for chunk_pos in stale_chunks {
        table.release_chunk(chunk_pos);
    }

    let mut chunk_positions = cache
        .iter()
        .map(|(chunk_pos, _)| *chunk_pos)
        .collect::<Vec<_>>();
    prioritize_chunk_positions(&mut chunk_positions, &streaming_state);

    let selected_chunks = chunk_positions
        .iter()
        .take(config.chunk_cache.max_chunks as usize)
        .copied()
        .collect::<HashSet<_>>();
    let evicted_chunks = table
        .assigned_chunks()
        .filter(|chunk_pos| !selected_chunks.contains(chunk_pos))
        .collect::<Vec<_>>();
    for chunk_pos in evicted_chunks {
        table.release_chunk(chunk_pos);
    }

    for chunk_pos in chunk_positions {
        if !selected_chunks.contains(&chunk_pos) {
            break;
        }
        let already_assigned = table.slot(chunk_pos).is_some();
        if table.slot_for_chunk(chunk_pos).is_none() {
            break;
        }
        if !already_assigned {
            upload_queue.queue(chunk_pos);
        }
    }

    sync_chunk_table_stats(&table, &mut stats);
}

fn prioritize_chunk_positions(
    chunk_positions: &mut [IVec3],
    streaming_state: &NaadfStreamingState,
) {
    let Some(center_chunk) = streaming_state.center_chunk() else {
        chunk_positions.sort_by_key(|chunk_pos| (chunk_pos.x, chunk_pos.y, chunk_pos.z));
        return;
    };
    let visible_chunks = streaming_state.visible_chunks();
    chunk_positions.sort_by_cached_key(|chunk_pos| {
        let delta = *chunk_pos - center_chunk;
        (
            if visible_chunks.contains(chunk_pos) {
                0u8
            } else {
                1u8
            },
            delta.x * delta.x + delta.y * delta.y + delta.z * delta.z,
            chunk_pos.x,
            chunk_pos.y,
            chunk_pos.z,
        )
    });
}

fn sync_chunk_table_stats(table: &NaadfGpuChunkTable, stats: &mut NaadfStats) {
    let table_stats = table.stats();
    stats.gpu_max_chunks = table_stats.max_slots;
    stats.gpu_slots_used = table_stats.allocated_chunks;
    stats.gpu_slots_available = table_stats.available_slots;
    stats.gpu_slots_reserved = table_stats.reserved_slots;
    stats.gpu_slots_free_list = table_stats.free_slots;
    stats.gpu_slot_fragmentation = table_stats.free_slot_fragmentation;
}

pub fn upload_naadf_chunks_to_gpu(
    uploads: Res<ExtractedNaadfGpuUploads>,
    buffers: Res<NaadfGpuBuffers>,
    render_queue: Res<RenderQueue>,
    mut upload_stats: ResMut<NaadfGpuUploadStats>,
    timing: Option<Res<RenderTimingSink>>,
    mut last_lookup_upload: Local<Option<(u32, u64)>>,
) {
    let _timer = render_timing_guard(timing.as_deref(), "NAADF GPU Upload CPU");
    upload_stats.uploaded_chunks_last_frame = 0;
    upload_stats.uploaded_bytes_last_frame = 0;

    let Some(allocation) = buffers.allocation() else {
        return;
    };

    for upload in &uploads.uploads {
        let slot = upload.slot as u64;
        render_queue.write_buffer(
            &allocation.chunk_buffer,
            slot * NAADF_CHUNK_RECORD_BYTES,
            bytemuck::cast_slice(&[upload.chunk_record]),
        );
        render_queue.write_buffer(
            &allocation.block_buffer,
            slot * BLOCKS_PER_CHUNK as u64 * NAADF_BLOCK_RECORD_BYTES,
            bytemuck::cast_slice(upload.block_records.as_slice()),
        );
        render_queue.write_buffer(
            &allocation.voxel_buffer,
            slot * crate::constants::CHUNK_VOLUME as u64 * NAADF_VOXEL_RECORD_BYTES,
            bytemuck::cast_slice(upload.voxel_records.as_slice()),
        );
        render_queue.write_buffer(
            &allocation.raw_voxel_buffer,
            slot * crate::constants::CHUNK_VOLUME as u64 * NAADF_RAW_VOXEL_RECORD_BYTES,
            bytemuck::cast_slice(upload.raw_voxel_records.as_slice()),
        );
        render_queue.write_buffer(
            &allocation.material_buffer,
            slot * crate::constants::CHUNK_VOLUME as u64 * NAADF_MATERIAL_RECORD_BYTES,
            bytemuck::cast_slice(upload.material_records.as_slice()),
        );
        upload_stats.uploaded_chunks_last_frame =
            upload_stats.uploaded_chunks_last_frame.saturating_add(1);
        upload_stats.uploaded_bytes_last_frame = upload_stats
            .uploaded_bytes_last_frame
            .saturating_add(upload.estimated_bytes);
    }

    let lookup_upload_key = (
        allocation.plan.max_chunks,
        uploads.lookup_records_generation,
    );
    if *last_lookup_upload != Some(lookup_upload_key) {
        render_queue.write_buffer(
            &allocation.chunk_lookup_buffer,
            0,
            bytemuck::cast_slice(uploads.lookup_records.as_slice()),
        );
        *last_lookup_upload = Some(lookup_upload_key);
    }
}

pub fn upload_naadf_entity_volumes_to_gpu(
    uploads: Res<ExtractedNaadfEntityGpuUploads>,
    buffers: Res<NaadfEntityGpuBuffers>,
    render_queue: Res<RenderQueue>,
) {
    let Some(allocation) = buffers.allocation() else {
        return;
    };

    if !uploads.entity_records.is_empty() {
        render_queue.write_buffer(
            &allocation.entity_record_buffer,
            0,
            bytemuck::cast_slice(uploads.entity_records.as_slice()),
        );
    }
    if !uploads.material_records.is_empty() {
        render_queue.write_buffer(
            &allocation.entity_material_buffer,
            0,
            bytemuck::cast_slice(uploads.material_records.as_slice()),
        );
    }
}

pub fn readback_naadf_gpu_stats(
    buffers: Res<NaadfGpuBuffers>,
    preview_settings: Option<Res<crate::rendering::naadf::pipeline::ExtractedNaadfPreviewSettings>>,
    render_device: Res<RenderDevice>,
    bridge: Res<NaadfRenderStatsBridge>,
) {
    let Some(allocation) = buffers.allocation() else {
        bridge.publish_ray_steps(0.0, 0, 0, [0; 6]);
        return;
    };
    let path_b_counters_enabled = preview_settings.as_deref().is_some_and(|settings| {
        settings.path_b_mode.is_path_b()
            && settings.path_b_runtime_available
            && settings.path_b_counters_enabled
    });
    if !allocation.debug_readback && !path_b_counters_enabled {
        bridge.publish_ray_steps(0.0, 0, 0, [0; 6]);
        return;
    }

    let slice = allocation.stats_readback_buffer.slice(..);
    let (sender, receiver) = std::sync::mpsc::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    let _ = render_device.poll(wgpu::PollType::wait_indefinitely());
    if !matches!(receiver.recv(), Ok(Ok(()))) {
        return;
    }

    let data = slice.get_mapped_range();
    let words: Vec<u32> = bytemuck::cast_slice(&data).to_vec();
    drop(data);
    allocation.stats_readback_buffer.unmap();

    bridge.publish_ray_telemetry_words(&words);
}

impl NaadfEntityGpuBuffers {
    pub fn allocation(&self) -> Option<&NaadfEntityGpuBufferAllocation> {
        self.allocation.as_ref()
    }
}

pub fn pack_naadf_chunk_upload(chunk: &NaadfChunk, slot: u32) -> NaadfChunkUpload {
    let block_records = chunk
        .blocks
        .iter()
        .map(pack_block_record)
        .collect::<Vec<_>>();
    let voxel_records = chunk
        .occupancy
        .iter()
        .zip(chunk.voxel_skip.iter())
        .map(|(occupied, skip)| pack_voxel_record(*occupied, skip.0))
        .collect::<Vec<_>>();
    let material_records = chunk
        .material_ids
        .iter()
        .map(|material_id| *material_id as u32)
        .collect::<Vec<_>>();
    let raw_voxel_records = chunk
        .occupancy
        .iter()
        .zip(chunk.material_ids.iter())
        .map(|(occupied, material_id)| pack_raw_voxel_record(*occupied, *material_id))
        .collect::<Vec<_>>();
    let estimated_bytes = (NAADF_CHUNK_RECORD_BYTES
        + block_records.len() as u64 * NAADF_BLOCK_RECORD_BYTES
        + voxel_records.len() as u64 * NAADF_VOXEL_RECORD_BYTES
        + raw_voxel_records.len() as u64 * NAADF_RAW_VOXEL_RECORD_BYTES
        + material_records.len() as u64 * NAADF_MATERIAL_RECORD_BYTES)
        as u32;

    NaadfChunkUpload {
        chunk_pos: chunk.position,
        slot,
        chunk_record: [
            chunk.node.0,
            i32_to_u32_bits(chunk.position.x),
            i32_to_u32_bits(chunk.position.y),
            i32_to_u32_bits(chunk.position.z),
            BLOCKS_PER_CHUNK,
            crate::constants::CHUNK_VOLUME as u32,
            chunk.chunk_skip.0,
            0,
        ],
        block_records,
        voxel_records,
        raw_voxel_records,
        material_records,
        estimated_bytes,
    }
}

pub fn pack_entity_volume_record(
    record: &NaadfEntityVolumeRecord,
    material_base: u32,
) -> NaadfEntityGpuRecord {
    let local_from_world = record.world_from_local.to_matrix().inverse();
    let world_from_local = record.world_from_local.to_matrix();
    let previous_world_from_local = record.previous_world_from_local.to_matrix();
    [
        [
            record.world_aabb_min.x,
            record.world_aabb_min.y,
            record.world_aabb_min.z,
            material_base as f32,
        ],
        [
            record.world_aabb_max.x,
            record.world_aabb_max.y,
            record.world_aabb_max.z,
            record.material_ids.len() as f32,
        ],
        local_from_world.x_axis.to_array(),
        local_from_world.y_axis.to_array(),
        local_from_world.z_axis.to_array(),
        local_from_world.w_axis.to_array(),
        world_from_local.x_axis.to_array(),
        world_from_local.y_axis.to_array(),
        world_from_local.z_axis.to_array(),
        world_from_local.w_axis.to_array(),
        previous_world_from_local.x_axis.to_array(),
        previous_world_from_local.y_axis.to_array(),
        previous_world_from_local.z_axis.to_array(),
        previous_world_from_local.w_axis.to_array(),
        [
            record.dimensions.x as f32,
            record.dimensions.y as f32,
            record.dimensions.z as f32,
            record.occupied_voxels as f32,
        ],
        [
            record.voxel_size.x,
            record.voxel_size.y,
            record.voxel_size.z,
            record.local_origin.x,
        ],
        [record.local_origin.y, record.local_origin.z, 0.0, 0.0],
    ]
}

pub fn pack_raw_voxel_record(occupied: bool, material_id: u16) -> u32 {
    (u32::from(occupied) << 31) | material_id as u32
}

pub fn pack_voxel_record(occupied: bool, directional_skip: u16) -> u32 {
    (u32::from(occupied) << 31) | directional_skip as u32
}

fn pack_block_record(block: &NaadfBlock) -> [u32; NAADF_PACKED_BLOCK_WORDS] {
    [
        block.node.0,
        pack_bounds(block.bounds),
        (block.occupancy_mask & u32::MAX as u64) as u32,
        (block.occupancy_mask >> 32) as u32,
        ((block.bounds.neg_z as u32) | ((block.bounds.pos_z as u32) << 8)),
        block.directional_skip_blocks.0 as u32,
        0,
        0,
    ]
}

fn pack_bounds(bounds: DirectionalBounds) -> u32 {
    bounds.neg_x as u32
        | ((bounds.pos_x as u32) << 8)
        | ((bounds.neg_y as u32) << 16)
        | ((bounds.pos_y as u32) << 24)
}

fn i32_to_u32_bits(value: i32) -> u32 {
    u32::from_ne_bytes(value.to_ne_bytes())
}

fn create_naadf_gpu_allocation(
    render_device: &RenderDevice,
    plan: NaadfGpuBufferPlan,
    debug_readback: bool,
) -> NaadfGpuBufferAllocation {
    let storage_usage = BufferUsages::STORAGE | BufferUsages::COPY_DST;
    let readback_usage = if debug_readback {
        BufferUsages::COPY_SRC
    } else {
        BufferUsages::empty()
    };

    NaadfGpuBufferAllocation {
        voxel_buffer: create_buffer(
            render_device,
            "naadf_voxel_records",
            plan.voxel_buffer_bytes,
            storage_usage,
        ),
        raw_voxel_buffer: create_buffer(
            render_device,
            "naadf_raw_voxel_records",
            plan.raw_voxel_buffer_bytes,
            storage_usage,
        ),
        material_buffer: create_buffer(
            render_device,
            "naadf_material_records",
            plan.material_buffer_bytes,
            storage_usage,
        ),
        mip_traversal_buffer: create_buffer(
            render_device,
            "naadf_mip_traversal_records",
            plan.mip_traversal_buffer_bytes,
            storage_usage,
        ),
        mip_payload_buffer: create_buffer(
            render_device,
            "naadf_mip_payload_records",
            plan.mip_payload_buffer_bytes,
            storage_usage,
        ),
        mip_bounds_buffer: create_buffer(
            render_device,
            "naadf_mip_bounds_records",
            plan.mip_bounds_buffer_bytes,
            storage_usage,
        ),
        block_buffer: create_buffer(
            render_device,
            "naadf_block_records",
            plan.block_buffer_bytes,
            storage_usage,
        ),
        chunk_buffer: create_buffer(
            render_device,
            "naadf_chunk_records",
            plan.chunk_buffer_bytes,
            storage_usage,
        ),
        chunk_lookup_buffer: create_buffer(
            render_device,
            "naadf_chunk_lookup_records",
            plan.chunk_lookup_buffer_bytes,
            storage_usage,
        ),
        upload_buffer: create_buffer(
            render_device,
            "naadf_upload_scratch",
            plan.upload_buffer_bytes,
            BufferUsages::STORAGE | BufferUsages::COPY_SRC | BufferUsages::COPY_DST,
        ),
        debug_ray_buffer: create_buffer(
            render_device,
            "naadf_debug_rays",
            plan.debug_ray_buffer_bytes,
            storage_usage | readback_usage,
        ),
        stats_buffer: create_buffer(
            render_device,
            "naadf_stats",
            plan.stats_buffer_bytes,
            storage_usage | readback_usage,
        ),
        stats_readback_buffer: create_buffer(
            render_device,
            "naadf_stats_readback",
            plan.stats_buffer_bytes,
            BufferUsages::COPY_DST | BufferUsages::MAP_READ,
        ),
        plan,
        debug_readback,
    }
}

fn create_naadf_entity_gpu_allocation(
    render_device: &RenderDevice,
    entity_capacity: u64,
    material_capacity: u64,
) -> NaadfEntityGpuBufferAllocation {
    let storage_usage = BufferUsages::STORAGE | BufferUsages::COPY_DST;
    NaadfEntityGpuBufferAllocation {
        entity_record_buffer: create_buffer(
            render_device,
            "naadf_entity_volume_records",
            entity_capacity * NAADF_ENTITY_VOLUME_RECORD_BYTES,
            storage_usage,
        ),
        entity_material_buffer: create_buffer(
            render_device,
            "naadf_entity_material_records",
            material_capacity * NAADF_ENTITY_MATERIAL_RECORD_BYTES,
            storage_usage,
        ),
        entity_capacity,
        material_capacity,
    }
}

fn create_buffer(
    render_device: &RenderDevice,
    label: &'static str,
    size: u64,
    usage: BufferUsages,
) -> Buffer {
    render_device.create_buffer(&BufferDescriptor {
        label: Some(label),
        size,
        usage,
        mapped_at_creation: false,
    })
}

#[derive(Resource, Clone, Debug, Default)]
pub struct NaadfGpuChunkTable {
    chunk_to_slot: HashMap<IVec3, u32>,
    free_slots: Vec<u32>,
    next_slot: u32,
    max_slots: u32,
    generation: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct NaadfGpuChunkTableStats {
    pub allocated_chunks: u32,
    pub reserved_slots: u32,
    pub free_slots: u32,
    pub available_slots: u32,
    pub max_slots: u32,
    pub free_slot_fragmentation: f32,
}

impl NaadfGpuChunkTable {
    pub fn with_capacity(max_slots: u32) -> Self {
        Self {
            max_slots,
            ..default()
        }
    }

    pub fn set_capacity(&mut self, max_slots: u32) {
        if self.max_slots != max_slots {
            let generation = self.generation.saturating_add(1);
            *self = Self {
                generation,
                ..Self::with_capacity(max_slots)
            };
        }
    }

    pub fn clear_allocations(&mut self) {
        if self.chunk_to_slot.is_empty() && self.free_slots.is_empty() && self.next_slot == 0 {
            return;
        }
        let max_slots = self.max_slots;
        let generation = self.generation.saturating_add(1);
        *self = Self {
            generation,
            ..Self::with_capacity(max_slots)
        };
    }

    pub fn slot_for_chunk(&mut self, chunk_pos: IVec3) -> Option<u32> {
        if let Some(slot) = self.chunk_to_slot.get(&chunk_pos).copied() {
            return Some(slot);
        }
        let slot = self.free_slots.pop().or_else(|| {
            if self.next_slot < self.max_slots {
                let slot = self.next_slot;
                self.next_slot += 1;
                Some(slot)
            } else {
                None
            }
        })?;
        self.chunk_to_slot.insert(chunk_pos, slot);
        self.generation = self.generation.saturating_add(1);
        Some(slot)
    }

    pub fn release_chunk(&mut self, chunk_pos: IVec3) -> Option<u32> {
        let slot = self.chunk_to_slot.remove(&chunk_pos)?;
        self.free_slots.push(slot);
        self.generation = self.generation.saturating_add(1);
        Some(slot)
    }

    pub fn slot(&self, chunk_pos: IVec3) -> Option<u32> {
        self.chunk_to_slot.get(&chunk_pos).copied()
    }

    pub fn assigned_chunks(&self) -> impl Iterator<Item = IVec3> + '_ {
        self.chunk_to_slot.keys().copied()
    }

    pub fn lookup_records(&self) -> Vec<[u32; 4]> {
        self.lookup_records_excluding(&HashSet::new())
    }

    pub fn lookup_records_excluding(&self, excluded_chunks: &HashSet<IVec3>) -> Vec<[u32; 4]> {
        let mut records = self
            .chunk_to_slot
            .iter()
            .filter(|(chunk_pos, _)| !excluded_chunks.contains(chunk_pos))
            .map(|(chunk_pos, slot)| {
                [
                    i32_to_u32_bits(chunk_pos.x),
                    i32_to_u32_bits(chunk_pos.y),
                    i32_to_u32_bits(chunk_pos.z),
                    *slot,
                ]
            })
            .collect::<Vec<_>>();
        records.sort_by_key(|record| {
            (
                i32::from_ne_bytes(record[0].to_ne_bytes()),
                i32::from_ne_bytes(record[1].to_ne_bytes()),
                i32::from_ne_bytes(record[2].to_ne_bytes()),
            )
        });
        records
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn stats(&self) -> NaadfGpuChunkTableStats {
        let free_slots = self.free_slots.len() as u32;
        let reserved_slots = self.next_slot;
        let free_slot_fragmentation = if reserved_slots == 0 {
            0.0
        } else {
            free_slots as f32 / reserved_slots as f32
        };

        NaadfGpuChunkTableStats {
            allocated_chunks: self.chunk_to_slot.len() as u32,
            reserved_slots,
            free_slots,
            available_slots: self
                .max_slots
                .saturating_sub(self.chunk_to_slot.len() as u32),
            max_slots: self.max_slots,
            free_slot_fragmentation,
        }
    }

    pub fn len(&self) -> usize {
        self.chunk_to_slot.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunk_to_slot.is_empty()
    }
}

fn lookup_generation_for_pending_uploads(
    table_generation: u64,
    pending_chunks: &HashSet<IVec3>,
) -> u64 {
    let mut positions = pending_chunks.iter().copied().collect::<Vec<_>>();
    positions.sort_by_key(|chunk_pos| (chunk_pos.x, chunk_pos.y, chunk_pos.z));
    let mut generation = table_generation ^ ((positions.len() as u64) << 32);
    for chunk_pos in positions {
        generation = generation
            .wrapping_mul(0x9e37_79b9_7f4a_7c15)
            .wrapping_add(chunk_pos.x as i64 as u64)
            .wrapping_mul(0xbf58_476d_1ce4_e5b9)
            .wrapping_add(chunk_pos.y as i64 as u64)
            .wrapping_mul(0x94d0_49bb_1331_11eb)
            .wrapping_add(chunk_pos.z as i64 as u64);
    }
    generation
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
    use crate::rendering::naadf::layout::{MIP_CELLS_PER_CHUNK, voxel_index_in_chunk};
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

    #[test]
    fn chunk_table_reuses_released_slots() {
        let mut table = NaadfGpuChunkTable::with_capacity(1);
        assert_eq!(table.slot_for_chunk(IVec3::ZERO), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::X), None);
        assert_eq!(table.release_chunk(IVec3::ZERO), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::X), Some(0));
    }

    #[test]
    fn chunk_table_reports_free_slot_fragmentation() {
        let mut table = NaadfGpuChunkTable::with_capacity(4);
        assert_eq!(table.slot_for_chunk(IVec3::ZERO), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::X), Some(1));
        assert_eq!(table.release_chunk(IVec3::ZERO), Some(0));

        let stats = table.stats();

        assert_eq!(stats.allocated_chunks, 1);
        assert_eq!(stats.reserved_slots, 2);
        assert_eq!(stats.free_slots, 1);
        assert_eq!(stats.available_slots, 3);
        assert_eq!(stats.free_slot_fragmentation, 0.5);
    }

    #[test]
    fn chunk_table_capacity_change_clears_stale_slots() {
        let mut table = NaadfGpuChunkTable::with_capacity(4);
        assert_eq!(table.slot_for_chunk(IVec3::ZERO), Some(0));

        table.set_capacity(2);
        let stats = table.stats();

        assert_eq!(stats.allocated_chunks, 0);
        assert_eq!(stats.reserved_slots, 0);
        assert_eq!(stats.available_slots, 2);
        assert_eq!(stats.max_slots, 2);
    }

    #[test]
    fn chunk_table_lookup_records_are_sorted_for_gpu_binary_search() {
        let mut table = NaadfGpuChunkTable::with_capacity(4);
        assert_eq!(table.slot_for_chunk(IVec3::new(2, 0, 0)), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::new(-1, 5, 0)), Some(1));
        assert_eq!(table.slot_for_chunk(IVec3::new(-1, 4, 9)), Some(2));

        let records = table.lookup_records();
        let positions = records
            .iter()
            .map(|record| {
                IVec3::new(
                    i32::from_ne_bytes(record[0].to_ne_bytes()),
                    i32::from_ne_bytes(record[1].to_ne_bytes()),
                    i32::from_ne_bytes(record[2].to_ne_bytes()),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            positions,
            vec![
                IVec3::new(-1, 4, 9),
                IVec3::new(-1, 5, 0),
                IVec3::new(2, 0, 0),
            ]
        );
    }

    #[test]
    fn chunk_table_lookup_records_can_exclude_pending_uploads() {
        let mut table = NaadfGpuChunkTable::with_capacity(4);
        assert_eq!(table.slot_for_chunk(IVec3::ZERO), Some(0));
        assert_eq!(table.slot_for_chunk(IVec3::X), Some(1));
        let excluded = HashSet::from([IVec3::X]);

        let records = table.lookup_records_excluding(&excluded);

        assert_eq!(records.len(), 1);
        assert_eq!(i32::from_ne_bytes(records[0][0].to_ne_bytes()), 0);
        assert_eq!(records[0][3], 0);
    }

    #[test]
    fn pending_uploads_change_lookup_generation() {
        let none = HashSet::new();
        let pending = HashSet::from([IVec3::new(1, 2, 3)]);

        assert_ne!(
            lookup_generation_for_pending_uploads(7, &none),
            lookup_generation_for_pending_uploads(7, &pending)
        );
    }

    #[test]
    fn chunk_priority_puts_visible_near_chunks_before_retained_cache_chunks() {
        let mut streaming_state = NaadfStreamingState::default();
        streaming_state
            .set_visible_for_test(IVec3::ZERO, [IVec3::new(3, 0, 0), IVec3::new(1, 0, 0)]);
        let mut chunk_positions = vec![
            IVec3::new(0, 0, 1),
            IVec3::new(3, 0, 0),
            IVec3::new(1, 0, 0),
            IVec3::new(0, 0, 2),
        ];

        prioritize_chunk_positions(&mut chunk_positions, &streaming_state);

        assert_eq!(
            &chunk_positions[..2],
            &[IVec3::new(1, 0, 0), IVec3::new(3, 0, 0)]
        );
    }

    #[test]
    fn buffer_plan_includes_required_gpu_buffers() {
        let plan = NaadfGpuBufferPlan::for_chunk_capacity(2);

        assert_eq!(plan.voxel_records, 8192);
        assert_eq!(plan.raw_voxel_records, 8192);
        assert_eq!(plan.material_records, 8192);
        assert_eq!(plan.mip_traversal_records, 2 * MIP_CELLS_PER_CHUNK as u64);
        assert_eq!(plan.mip_payload_records, plan.mip_traversal_records);
        assert_eq!(plan.mip_bounds_records, plan.mip_traversal_records);
        assert_eq!(plan.block_records, 128);
        assert_eq!(plan.chunk_records, 2);
        assert_eq!(plan.chunk_lookup_records, 2);
        assert!(plan.voxel_buffer_bytes > 0);
        assert!(plan.raw_voxel_buffer_bytes > 0);
        assert!(plan.material_buffer_bytes > 0);
        assert!(plan.mip_traversal_buffer_bytes > 0);
        assert!(plan.mip_payload_buffer_bytes > 0);
        assert!(plan.mip_bounds_buffer_bytes > 0);
        assert!(plan.block_buffer_bytes > 0);
        assert!(plan.chunk_buffer_bytes > 0);
        assert!(plan.chunk_lookup_buffer_bytes > 0);
        assert!(plan.upload_buffer_bytes > 0);
        assert!(plan.debug_ray_buffer_bytes > 0);
        assert!(plan.stats_buffer_bytes > 0);
    }

    #[test]
    fn buffer_plan_enforces_memory_cap() {
        let plan = NaadfGpuBufferPlan::for_chunk_capacity(4096);

        assert!(plan.fits_memory_cap(512));
        assert!(!plan.fits_memory_cap(1));
    }

    #[test]
    fn chunk_upload_packs_cpu_chunk_for_gpu_slot() {
        let mut chunk = Chunk::new(IVec3::new(-1, 2, 3));
        chunk.set(UVec3::new(1, 2, 3), VoxelType::Rock);
        let naadf = build_naadf_chunk(&chunk, NaadfBuildOptions::default());

        let upload = pack_naadf_chunk_upload(&naadf, 7);

        assert_eq!(upload.chunk_pos, IVec3::new(-1, 2, 3));
        assert_eq!(upload.slot, 7);
        assert_eq!(upload.chunk_record[6], naadf.chunk_skip.0);
        assert_eq!(upload.block_records.len(), BLOCKS_PER_CHUNK as usize);
        assert_eq!(upload.voxel_records.len(), crate::constants::CHUNK_VOLUME);
        assert_eq!(
            upload.raw_voxel_records.len(),
            crate::constants::CHUNK_VOLUME
        );
        assert_eq!(
            upload.material_records.len(),
            crate::constants::CHUNK_VOLUME
        );
        let voxel_index = voxel_index_in_chunk(UVec3::new(1, 2, 3));
        assert_eq!(
            upload.voxel_records[voxel_index],
            pack_voxel_record(true, naadf.voxel_skip[voxel_index].0)
        );
        assert_eq!(upload.material_records[voxel_index], VoxelType::Rock as u32);
        assert_eq!(
            upload.raw_voxel_records[voxel_index],
            pack_raw_voxel_record(true, VoxelType::Rock as u16)
        );
        assert!(upload.estimated_bytes > 0);
    }

    #[test]
    fn entity_volume_record_packs_transform_and_material_metadata() {
        let transform = GlobalTransform::from(Transform::from_xyz(4.0, 5.0, 6.0));
        let record = NaadfEntityVolumeRecord {
            entity: Entity::from_raw_u32(42).unwrap(),
            dimensions: UVec3::new(2, 3, 4),
            voxel_size: Vec3::new(0.5, 1.0, 2.0),
            local_origin: Vec3::new(-1.0, -2.0, -3.0),
            world_from_local: transform,
            previous_world_from_local: GlobalTransform::from(Transform::from_xyz(1.0, 2.0, 3.0)),
            world_aabb_min: Vec3::new(3.0, 3.0, 3.0),
            world_aabb_max: Vec3::new(5.0, 8.0, 14.0),
            material_ids: vec![0; 24],
            occupied_voxels: 7,
            revision: 3,
        };

        let packed = pack_entity_volume_record(&record, 11);

        assert_eq!(packed[0], [3.0, 3.0, 3.0, 11.0]);
        assert_eq!(packed[1], [5.0, 8.0, 14.0, 24.0]);
        assert_eq!(packed[13], [1.0, 2.0, 3.0, 1.0]);
        assert_eq!(packed[14], [2.0, 3.0, 4.0, 7.0]);
        assert_eq!(packed[15], [0.5, 1.0, 2.0, -1.0]);
        assert_eq!(packed[16], [-2.0, -3.0, 0.0, 0.0]);
    }

    #[test]
    fn raw_voxel_record_packs_occupancy_and_material() {
        assert_eq!(pack_raw_voxel_record(false, 7), 7);
        assert_eq!(pack_raw_voxel_record(true, 7), 0x8000_0007);
    }

    #[test]
    fn voxel_record_packs_occupancy_and_directional_skip() {
        assert_eq!(pack_voxel_record(false, 0x0abc), 0x0abc);
        assert_eq!(pack_voxel_record(true, 0x0abc), 0x8000_0abc);
    }
}
