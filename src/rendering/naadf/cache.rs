use bevy::prelude::*;
use std::collections::HashMap;

use super::config::NaadfConfig;
use super::cpu_builder::NaadfBuildOptions;
use super::dirty::NaadfDirtyChunkQueue;
use super::extractor::{NaadfChunkExtractor, NaadfExtractionError};
use super::layout::NaadfChunk;
use super::stats::{NaadfCacheState, NaadfStats};
use crate::voxel::world::VoxelWorld;

#[derive(Resource, Default, Debug)]
pub struct NaadfCache {
    chunks: HashMap<IVec3, NaadfChunk>,
    last_report: NaadfCacheBuildReport,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NaadfCacheBuildReport {
    pub rebuilt: u32,
    pub removed_missing: u32,
    pub deferred: u32,
    pub missing: Vec<IVec3>,
}

impl NaadfCache {
    pub fn get(&self, chunk_pos: IVec3) -> Option<&NaadfChunk> {
        self.chunks.get(&chunk_pos)
    }

    pub fn contains_chunk(&self, chunk_pos: IVec3) -> bool {
        self.chunks.contains_key(&chunk_pos)
    }

    pub fn iter(&self) -> impl Iterator<Item = (&IVec3, &NaadfChunk)> {
        self.chunks.iter()
    }

    pub fn len(&self) -> usize {
        self.chunks.len()
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty()
    }

    pub fn last_report(&self) -> &NaadfCacheBuildReport {
        &self.last_report
    }

    pub fn clear(&mut self) {
        self.chunks.clear();
        self.last_report = NaadfCacheBuildReport::default();
    }
}

pub fn rebuild_naadf_cache_from_dirty_queue(
    config: Res<NaadfConfig>,
    world: Res<VoxelWorld>,
    mut queue: ResMut<NaadfDirtyChunkQueue>,
    mut cache: ResMut<NaadfCache>,
    mut stats: ResMut<NaadfStats>,
    mut state: ResMut<NaadfCacheState>,
) {
    if !config.enabled {
        state.ready = false;
        state.warming = false;
        state.fallback_reason = Some("NAADF disabled by config".to_string());
        return;
    }

    let extractor = NaadfChunkExtractor::new(NaadfBuildOptions::default());
    let max_updates = config.chunk_cache.max_chunk_updates_per_frame.max(1);
    let mut report = NaadfCacheBuildReport::default();

    for _ in 0..max_updates {
        let Some(chunk_pos) = queue.pop_pending() else {
            break;
        };

        match extractor.extract_chunk(&world, chunk_pos) {
            Ok(chunk) => {
                cache.chunks.insert(chunk_pos, chunk);
                report.rebuilt += 1;
            }
            Err(NaadfExtractionError::MissingChunk(pos)) => {
                if cache.chunks.remove(&pos).is_some() {
                    report.removed_missing += 1;
                }
                report.missing.push(pos);
            }
        }
        queue.finish(chunk_pos);
    }

    report.deferred = queue.pending_len() as u32;
    cache.last_report = report;
    stats.loaded_chunks = cache.len() as u32;
    state.ready = !cache.is_empty() && queue.pending_len() == 0;
    state.warming = queue.pending_len() > 0;
    state.fallback_reason = if state.ready {
        None
    } else if cache.is_empty() {
        Some("NAADF cache has no loaded chunks yet".to_string())
    } else {
        Some("NAADF cache is warming".to_string())
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;

    #[test]
    fn extractor_reports_missing_chunks_without_creating_empty_chunks() {
        let world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let extractor = NaadfChunkExtractor::default();

        assert_eq!(
            extractor.extract_chunk(&world, IVec3::ZERO),
            Err(NaadfExtractionError::MissingChunk(IVec3::ZERO))
        );
    }

    #[test]
    fn cache_stores_loaded_chunk() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        world.insert_chunk(Chunk::new(IVec3::ZERO));
        let extractor = NaadfChunkExtractor::default();
        let chunk = extractor.extract_chunk(&world, IVec3::ZERO).unwrap();
        let mut cache = NaadfCache::default();

        cache.chunks.insert(IVec3::ZERO, chunk);

        assert!(cache.contains_chunk(IVec3::ZERO));
        assert_eq!(cache.len(), 1);
    }
}
