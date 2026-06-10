use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use std::collections::{HashSet, VecDeque};

use crate::camera::controller::PlayerCamera;
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::naadf::config::NaadfConfig;
use crate::rendering::naadf::streaming::{
    vertical_stream_radius_chunks, visible_loaded_region_targets, world_position_to_chunk,
};
use crate::voxel::world::VoxelWorld;

#[derive(Resource, Default, Debug)]
pub struct NaadfDirtyChunkQueue {
    pending: VecDeque<IVec3>,
    pending_set: HashSet<IVec3>,
    in_flight: HashSet<IVec3>,
    queued_total: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfDirtyQueueStats {
    pub pending: usize,
    pub in_flight: usize,
    pub queued_total: u64,
}

impl NaadfDirtyChunkQueue {
    pub fn queue(&mut self, chunk_pos: IVec3) -> bool {
        if self.pending_set.contains(&chunk_pos) || self.in_flight.contains(&chunk_pos) {
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
        self.in_flight.insert(chunk_pos);
        Some(chunk_pos)
    }

    pub fn finish(&mut self, chunk_pos: IVec3) {
        self.in_flight.remove(&chunk_pos);
    }

    pub fn pending_len(&self) -> usize {
        self.pending.len()
    }

    pub fn pending_chunks(&self) -> impl Iterator<Item = IVec3> + '_ {
        self.pending.iter().copied()
    }

    pub fn in_flight_chunks(&self) -> impl Iterator<Item = IVec3> + '_ {
        self.in_flight.iter().copied()
    }

    pub fn stats(&self) -> NaadfDirtyQueueStats {
        NaadfDirtyQueueStats {
            pending: self.pending.len(),
            in_flight: self.in_flight.len(),
            queued_total: self.queued_total,
        }
    }
}

pub fn queue_existing_dirty_chunks(
    config: Res<NaadfConfig>,
    camera_query: Query<&GlobalTransform, With<PlayerCamera>>,
    mut world: ResMut<VoxelWorld>,
    mut queue: ResMut<NaadfDirtyChunkQueue>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    let _timer = timing.as_deref_mut().map(|timing| {
        area_timer(
            timing,
            frame.as_deref().map_or(0, |frame| frame.0),
            "NAADF Dirty Queue",
        )
    });

    if !config.enabled {
        return;
    }

    let visible_targets = if config.build_visible_chunks_only {
        Some(
            camera_query
                .iter()
                .next()
                .map(|camera_transform| {
                    visible_loaded_region_targets(
                        &world,
                        world_position_to_chunk(camera_transform.translation()),
                        config.chunk_cache.radius_chunks.max(0),
                        vertical_stream_radius_chunks(config.chunk_cache.radius_chunks.max(0)),
                        config.chunk_cache.max_chunks as usize,
                    )
                    .into_iter()
                    .collect::<HashSet<_>>()
                })
                .unwrap_or_default(),
        )
    } else {
        None
    };

    let dirty_chunks = world.take_derived_dirty_chunks();
    for chunk_pos in dirty_chunks {
        if visible_targets
            .as_ref()
            .is_some_and(|targets| !targets.contains(&chunk_pos))
        {
            continue;
        }
        queue.queue(chunk_pos);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;

    #[test]
    fn dirty_queue_deduplicates_positions() {
        let mut queue = NaadfDirtyChunkQueue::default();
        assert!(queue.queue(IVec3::new(1, 2, 3)));
        assert!(!queue.queue(IVec3::new(1, 2, 3)));
        assert_eq!(queue.pending_len(), 1);
    }

    #[test]
    fn dirty_queue_exposes_pending_and_in_flight_chunks_for_debug() {
        let mut queue = NaadfDirtyChunkQueue::default();
        queue.queue(IVec3::X);
        queue.queue(IVec3::Y);
        assert_eq!(
            queue.pending_chunks().collect::<Vec<_>>(),
            vec![IVec3::X, IVec3::Y]
        );

        assert_eq!(queue.pop_pending(), Some(IVec3::X));

        assert_eq!(queue.pending_chunks().collect::<Vec<_>>(), vec![IVec3::Y]);
        assert_eq!(queue.in_flight_chunks().collect::<Vec<_>>(), vec![IVec3::X]);
    }

    #[test]
    fn disabled_naadf_does_not_drain_derived_dirty_chunks() {
        let mut app = App::new();
        let mut world = VoxelWorld::new(IVec3::ONE);
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        assert_eq!(world.derived_dirty_chunks().count(), 1);

        app.insert_resource(NaadfConfig::default())
            .insert_resource(world)
            .init_resource::<NaadfDirtyChunkQueue>()
            .add_systems(Update, queue_existing_dirty_chunks);

        app.update();

        let world = app.world().resource::<VoxelWorld>();
        let queue = app.world().resource::<NaadfDirtyChunkQueue>();
        assert_eq!(
            world.derived_dirty_chunks().collect::<Vec<_>>(),
            vec![IVec3::ZERO]
        );
        assert_eq!(queue.pending_len(), 0);
    }
}
