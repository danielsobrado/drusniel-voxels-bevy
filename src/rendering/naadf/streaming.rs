use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use std::collections::HashSet;

use super::cache::NaadfCache;
use super::config::NaadfConfig;
use super::dirty::NaadfDirtyChunkQueue;
use super::gpu_buffers::NaadfGpuChunkTable;
use super::stats::NaadfStats;
use crate::camera::controller::PlayerCamera;
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::voxel::world::VoxelWorld;

pub(crate) const MIN_VERTICAL_STREAM_RADIUS_CHUNKS: i32 = 2;

#[derive(Resource, Debug, Default)]
pub struct NaadfStreamingState {
    visible_chunks: HashSet<IVec3>,
    retained_chunks: HashSet<IVec3>,
    center_chunk: Option<IVec3>,
}

impl NaadfStreamingState {
    pub fn visible_chunks(&self) -> &HashSet<IVec3> {
        &self.visible_chunks
    }

    pub fn center_chunk(&self) -> Option<IVec3> {
        self.center_chunk
    }

    pub fn has_visible_chunks(&self) -> bool {
        !self.visible_chunks.is_empty()
    }

    #[cfg(test)]
    pub(crate) fn set_visible_for_test(
        &mut self,
        center_chunk: IVec3,
        visible_chunks: impl IntoIterator<Item = IVec3>,
    ) {
        self.center_chunk = Some(center_chunk);
        self.visible_chunks = visible_chunks.into_iter().collect();
    }
}

pub fn update_visible_region_cache(
    config: Res<NaadfConfig>,
    world: Res<VoxelWorld>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut state: ResMut<NaadfStreamingState>,
    mut cache: ResMut<NaadfCache>,
    mut dirty_queue: ResMut<NaadfDirtyChunkQueue>,
    mut stats: ResMut<NaadfStats>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    let _timer = timing.as_deref_mut().map(|timing| {
        area_timer(
            timing,
            frame.as_deref().map_or(0, |frame| frame.0),
            "NAADF Streaming",
        )
    });

    if !config.enabled || !config.build_visible_chunks_only {
        state.visible_chunks.clear();
        state.retained_chunks.clear();
        state.center_chunk = None;
        stats.streaming_interest_chunks = 0;
        stats.streaming_interest_missing_gpu_slots = 0;
        stats.streaming_interest_missing_gpu_slots_far_ring = 0;
        return;
    }

    let Some(camera_transform) = camera_query.iter().next() else {
        stats.streaming_interest_chunks = 0;
        stats.streaming_interest_missing_gpu_slots = 0;
        stats.streaming_interest_missing_gpu_slots_far_ring = 0;
        return;
    };
    let center_chunk = world_position_to_chunk(camera_transform.translation());
    state.center_chunk = Some(center_chunk);
    let radius = config.chunk_cache.radius_chunks.max(0);
    let hysteresis = config.chunk_cache.hysteresis_chunks.max(0);
    let max_chunks = config.chunk_cache.max_chunks as usize;
    let vertical_radius = vertical_stream_radius_chunks(radius);
    let targets =
        visible_loaded_region_targets(&world, center_chunk, radius, vertical_radius, max_chunks);
    state.visible_chunks.clear();
    state.visible_chunks.extend(targets.iter().copied());

    for chunk_pos in &targets {
        if state.retained_chunks.insert(*chunk_pos) {
            dirty_queue.queue(*chunk_pos);
        }
    }

    let eviction_radius = radius.saturating_add(hysteresis);
    let evicted = state
        .retained_chunks
        .iter()
        .copied()
        .filter(|chunk_pos| {
            should_evict_chunk(
                center_chunk,
                *chunk_pos,
                eviction_radius,
                vertical_radius + hysteresis,
            )
        })
        .collect::<Vec<_>>();
    for chunk_pos in evicted {
        state.retained_chunks.remove(&chunk_pos);
        cache.remove_chunk(chunk_pos);
    }

    stats.streaming_interest_chunks = state.visible_chunks.len() as u32;
}

pub fn sync_streaming_gpu_slot_stats(
    config: Res<NaadfConfig>,
    state: Res<NaadfStreamingState>,
    gpu_chunk_table: Res<NaadfGpuChunkTable>,
    mut stats: ResMut<NaadfStats>,
) {
    if !config.enabled || !config.build_visible_chunks_only || !state.has_visible_chunks() {
        stats.streaming_interest_missing_gpu_slots = 0;
        stats.streaming_interest_missing_gpu_slots_far_ring = 0;
        return;
    }

    let center_chunk = state.center_chunk().unwrap_or(IVec3::ZERO);
    let far_ring_threshold = config.chunk_cache.radius_chunks.max(0).saturating_sub(1);
    let mut missing_gpu_slots = 0u32;
    let mut missing_gpu_slots_far_ring = 0u32;
    for chunk_pos in state.visible_chunks() {
        if gpu_chunk_table.slot(*chunk_pos).is_some() {
            continue;
        }
        missing_gpu_slots = missing_gpu_slots.saturating_add(1);
        let delta = *chunk_pos - center_chunk;
        let horizontal_ring = delta.x.abs().max(delta.z.abs());
        if horizontal_ring >= far_ring_threshold {
            missing_gpu_slots_far_ring = missing_gpu_slots_far_ring.saturating_add(1);
        }
    }
    stats.streaming_interest_missing_gpu_slots = missing_gpu_slots;
    stats.streaming_interest_missing_gpu_slots_far_ring = missing_gpu_slots_far_ring;
}

pub fn world_position_to_chunk(position: Vec3) -> IVec3 {
    (position / crate::constants::CHUNK_SIZE as f32)
        .floor()
        .as_ivec3()
}

pub fn visible_region_targets(
    center: IVec3,
    radius: i32,
    vertical_radius: i32,
    max_chunks: usize,
) -> Vec<IVec3> {
    let mut horizontal_offsets = Vec::new();
    for z in -radius..=radius {
        for x in -radius..=radius {
            if !within_horizontal_radius(x, z, radius) {
                continue;
            }
            horizontal_offsets.push(IVec2::new(x, z));
        }
    }
    horizontal_offsets.sort_by_key(|offset| {
        (
            offset.x * offset.x + offset.y * offset.y,
            offset.x,
            offset.y,
        )
    });

    let baseline_vertical_radius = vertical_radius.min(MIN_VERTICAL_STREAM_RADIUS_CHUNKS);
    let mut baseline_y_offsets = vertical_offsets_by_priority(baseline_vertical_radius);
    let mut targets = Vec::with_capacity(max_chunks);
    for y in baseline_y_offsets.drain(..) {
        for offset in &horizontal_offsets {
            if targets.len() == max_chunks {
                return targets;
            }
            targets.push(center + IVec3::new(offset.x, y, offset.y));
        }
    }

    let mut extra_offsets = Vec::new();
    for y in vertical_offsets_by_priority(vertical_radius) {
        if y.abs() <= MIN_VERTICAL_STREAM_RADIUS_CHUNKS {
            continue;
        }
        for offset in &horizontal_offsets {
            extra_offsets.push(IVec3::new(offset.x, y, offset.y));
        }
    }
    extra_offsets.sort_by_key(|offset| {
        let horizontal_distance = offset.x * offset.x + offset.z * offset.z;
        (
            horizontal_distance * 4 + offset.y * offset.y,
            offset.y.abs(),
            offset.y < 0,
            horizontal_distance,
            offset.x,
            offset.z,
        )
    });
    for offset in extra_offsets {
        if targets.len() == max_chunks {
            break;
        }
        targets.push(center + offset);
    }

    targets
}

pub fn visible_loaded_region_targets(
    world: &VoxelWorld,
    center: IVec3,
    radius: i32,
    vertical_radius: i32,
    max_chunks: usize,
) -> Vec<IVec3> {
    let mut targets = world
        .chunk_positions()
        .filter(|chunk_pos| chunk_in_stream_region(center, *chunk_pos, radius, vertical_radius))
        .collect::<Vec<_>>();
    targets.sort_by_cached_key(|chunk_pos| chunk_priority_key(center, *chunk_pos));
    targets.truncate(max_chunks);
    targets
}

pub(crate) fn vertical_stream_radius_chunks(horizontal_radius: i32) -> i32 {
    horizontal_radius.max(MIN_VERTICAL_STREAM_RADIUS_CHUNKS)
}

fn vertical_offsets_by_priority(radius: i32) -> Vec<i32> {
    let mut offsets = Vec::with_capacity((radius.max(0) * 2 + 1) as usize);
    offsets.push(0);
    for distance in 1..=radius.max(0) {
        offsets.push(distance);
        offsets.push(-distance);
    }
    offsets
}

fn chunk_in_stream_region(
    center: IVec3,
    chunk_pos: IVec3,
    horizontal_radius: i32,
    vertical_radius: i32,
) -> bool {
    let delta = chunk_pos - center;
    delta.y.abs() <= vertical_radius
        && within_horizontal_radius(delta.x, delta.z, horizontal_radius)
}

fn within_horizontal_radius(x: i32, z: i32, radius: i32) -> bool {
    let radius = radius.max(0) as i64;
    let x = x as i64;
    let z = z as i64;
    x * x + z * z <= radius * radius
}

fn chunk_priority_key(center: IVec3, chunk_pos: IVec3) -> (i64, i32, bool, i32, i32, i32) {
    let delta = chunk_pos - center;
    let horizontal_distance = delta.x as i64 * delta.x as i64 + delta.z as i64 * delta.z as i64;
    (
        horizontal_distance,
        delta.y.abs(),
        delta.y < 0,
        chunk_pos.x,
        chunk_pos.y,
        chunk_pos.z,
    )
}

pub fn should_evict_chunk(
    center: IVec3,
    chunk_pos: IVec3,
    horizontal_radius: i32,
    vertical_radius: i32,
) -> bool {
    !chunk_in_stream_region(center, chunk_pos, horizontal_radius, vertical_radius)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;

    #[test]
    fn visible_region_targets_include_center_and_respect_cap() {
        let targets = visible_region_targets(IVec3::new(2, 1, -3), 2, 1, 10);

        assert_eq!(targets.len(), 10);
        assert!(targets.contains(&IVec3::new(2, 1, -3)));
    }

    #[test]
    fn visible_region_targets_include_nearby_high_mountain_chunks() {
        let center = IVec3::new(16, 1, 16);
        let targets = visible_region_targets(center, 12, vertical_stream_radius_chunks(12), 4096);

        assert!(targets.contains(&(center + IVec3::new(0, 8, 0))));
        assert!(targets.contains(&(center + IVec3::new(3, 7, 3))));
    }

    #[test]
    fn visible_region_targets_keep_far_baseline_columns_when_vertical_radius_is_large() {
        let center = IVec3::new(16, 1, 16);
        let targets = visible_region_targets(center, 12, vertical_stream_radius_chunks(12), 4096);

        assert!(targets.contains(&(center + IVec3::new(12, 0, 0))));
        assert!(targets.contains(&(center + IVec3::new(-12, 2, 0))));
        assert!(targets.contains(&(center + IVec3::new(12, -2, 0))));
        assert!(!targets.contains(&(center + IVec3::new(12, 0, 12))));
    }

    #[test]
    fn visible_region_targets_cover_legacy_cull_radius_baseline() {
        let center = IVec3::new(16, 1, 16);
        let targets = visible_region_targets(center, 20, vertical_stream_radius_chunks(20), 8192);

        assert!(targets.contains(&(center + IVec3::new(20, 0, 0))));
        assert!(targets.contains(&(center + IVec3::new(0, 2, 20))));
        assert!(!targets.contains(&(center + IVec3::new(20, 0, 20))));
    }

    #[test]
    fn visible_loaded_region_targets_keep_loaded_high_and_far_chunks() {
        let center = IVec3::new(16, 1, 16);
        let mut world = VoxelWorld::new(IVec3::new(64, 32, 64));
        let loaded_chunks = [
            center,
            center + IVec3::new(20, 8, 0),
            center + IVec3::new(0, 8, 20),
            center + IVec3::new(20, 21, 0),
            center + IVec3::new(20, 8, 20),
        ];
        for chunk_pos in loaded_chunks {
            world.insert_chunk(Chunk::new(chunk_pos));
        }

        let targets = visible_loaded_region_targets(
            &world,
            center,
            20,
            vertical_stream_radius_chunks(20),
            8192,
        );

        assert!(targets.contains(&(center + IVec3::new(20, 8, 0))));
        assert!(targets.contains(&(center + IVec3::new(0, 8, 20))));
        assert!(!targets.contains(&(center + IVec3::new(20, 21, 0))));
        assert!(!targets.contains(&(center + IVec3::new(20, 8, 20))));
    }

    #[test]
    fn vertical_stream_radius_tracks_horizontal_radius_with_floor() {
        assert_eq!(
            vertical_stream_radius_chunks(0),
            MIN_VERTICAL_STREAM_RADIUS_CHUNKS
        );
        assert_eq!(vertical_stream_radius_chunks(12), 12);
        assert_eq!(vertical_stream_radius_chunks(20), 20);
    }

    #[test]
    fn hysteresis_eviction_keeps_nearby_chunks() {
        let center = IVec3::ZERO;

        assert!(!should_evict_chunk(center, IVec3::new(4, 0, 0), 4, 2));
        assert!(should_evict_chunk(center, IVec3::new(4, 0, 4), 4, 2));
        assert!(should_evict_chunk(center, IVec3::new(5, 0, 0), 4, 2));
        assert!(should_evict_chunk(center, IVec3::new(0, 3, 0), 4, 2));
    }

    #[test]
    fn world_position_maps_to_chunk_floor() {
        assert_eq!(
            world_position_to_chunk(Vec3::new(31.9, 0.0, -0.1)),
            IVec3::new(1, 0, -1)
        );
    }
}
