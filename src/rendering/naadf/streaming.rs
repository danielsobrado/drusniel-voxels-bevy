use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use std::collections::HashSet;

use super::cache::NaadfCache;
use super::config::NaadfConfig;
use super::dirty::NaadfDirtyChunkQueue;
use super::stats::NaadfStats;
use crate::camera::controller::PlayerCamera;
use crate::performance::{AreaTimingRecorder, area_timer};

pub(crate) const VERTICAL_STREAM_RADIUS_CHUNKS: i32 = 2;

#[derive(Resource, Debug, Default)]
pub struct NaadfStreamingState {
    interested_chunks: HashSet<IVec3>,
}

pub fn update_visible_region_cache(
    config: Res<NaadfConfig>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut state: Local<NaadfStreamingState>,
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
        state.interested_chunks.clear();
        return;
    }

    let Some(camera_transform) = camera_query.iter().next() else {
        return;
    };
    let center_chunk = world_position_to_chunk(camera_transform.translation());
    let radius = config.chunk_cache.radius_chunks.max(0);
    let hysteresis = config.chunk_cache.hysteresis_chunks.max(0);
    let max_chunks = config.chunk_cache.max_chunks as usize;
    let targets = visible_region_targets(
        center_chunk,
        radius,
        VERTICAL_STREAM_RADIUS_CHUNKS,
        max_chunks,
    );

    for chunk_pos in &targets {
        if state.interested_chunks.insert(*chunk_pos) {
            dirty_queue.queue(*chunk_pos);
        }
    }

    let eviction_radius = radius.saturating_add(hysteresis);
    let evicted = state
        .interested_chunks
        .iter()
        .copied()
        .filter(|chunk_pos| {
            should_evict_chunk(
                center_chunk,
                *chunk_pos,
                eviction_radius,
                VERTICAL_STREAM_RADIUS_CHUNKS + hysteresis,
            )
        })
        .collect::<Vec<_>>();
    for chunk_pos in evicted {
        state.interested_chunks.remove(&chunk_pos);
        cache.remove_chunk(chunk_pos);
    }

    stats.streaming_interest_chunks = state.interested_chunks.len() as u32;
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
    let mut targets = Vec::new();
    for y in -vertical_radius..=vertical_radius {
        for z in -radius..=radius {
            for x in -radius..=radius {
                targets.push(center + IVec3::new(x, y, z));
            }
        }
    }
    targets.sort_by_key(|chunk_pos| {
        let delta = *chunk_pos - center;
        delta.x * delta.x + delta.y * delta.y + delta.z * delta.z
    });
    targets.truncate(max_chunks);
    targets
}

pub fn should_evict_chunk(
    center: IVec3,
    chunk_pos: IVec3,
    horizontal_radius: i32,
    vertical_radius: i32,
) -> bool {
    let delta = chunk_pos - center;
    delta.x.abs() > horizontal_radius
        || delta.z.abs() > horizontal_radius
        || delta.y.abs() > vertical_radius
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visible_region_targets_include_center_and_respect_cap() {
        let targets = visible_region_targets(IVec3::new(2, 1, -3), 2, 1, 10);

        assert_eq!(targets.len(), 10);
        assert!(targets.contains(&IVec3::new(2, 1, -3)));
    }

    #[test]
    fn hysteresis_eviction_keeps_nearby_chunks() {
        let center = IVec3::ZERO;

        assert!(!should_evict_chunk(center, IVec3::new(4, 0, 0), 4, 2));
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
