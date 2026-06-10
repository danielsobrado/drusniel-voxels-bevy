use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use std::collections::HashMap;

use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::naadf::config::NaadfConfig;
use crate::rendering::naadf::cpu_builder::NaadfBuildOptions;
use crate::rendering::naadf::dirty::NaadfDirtyChunkQueue;
use crate::rendering::naadf::extractor::{NaadfChunkExtractor, NaadfExtractionError};
use crate::rendering::naadf::layout::{
    CHUNK_BOUND_FIELD_MAX, CHUNK_BOUND_OFFSET_NEG_X, CHUNK_BOUND_OFFSET_NEG_Y,
    CHUNK_BOUND_OFFSET_NEG_Z, CHUNK_BOUND_OFFSET_POS_X, CHUNK_BOUND_OFFSET_POS_Y,
    CHUNK_BOUND_OFFSET_POS_Z, NaadfChunk, NaadfNodeState, PackedDirectionalBounds5Bit,
};
use crate::rendering::naadf::stats::{NaadfCacheState, NaadfStats};
use crate::voxel::world::VoxelWorld;

#[derive(Resource, Default, Debug)]
pub struct NaadfCache {
    chunks: HashMap<IVec3, NaadfChunk>,
    last_report: NaadfCacheBuildReport,
    needs_propagation: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NaadfCacheBuildReport {
    pub rebuilt: u32,
    pub removed_missing: u32,
    pub deferred: u32,
    pub missing: Vec<IVec3>,
    pub rebuilt_chunks: Vec<IVec3>,
    pub propagation: NaadfChunkPropagationReport,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfChunkPropagationReport {
    pub passes: u32,
    pub updated_bounds: u32,
    pub skipped_unknown_neighbors: u32,
    pub saturated_fields: u32,
}

impl NaadfCache {
    pub fn insert_chunk(&mut self, chunk: NaadfChunk) {
        self.chunks.insert(chunk.position, chunk);
        propagate_chunk_skips(&mut self.chunks);
        self.needs_propagation = false;
    }

    pub fn get(&self, chunk_pos: IVec3) -> Option<&NaadfChunk> {
        self.chunks.get(&chunk_pos)
    }

    pub fn contains_chunk(&self, chunk_pos: IVec3) -> bool {
        self.chunks.contains_key(&chunk_pos)
    }

    pub fn remove_chunk(&mut self, chunk_pos: IVec3) -> Option<NaadfChunk> {
        let removed = self.chunks.remove(&chunk_pos);
        if removed.is_some() {
            propagate_chunk_skips(&mut self.chunks);
            self.needs_propagation = false;
        }
        removed
    }

    pub fn remove_chunk_deferred(&mut self, chunk_pos: IVec3) -> Option<NaadfChunk> {
        let removed = self.chunks.remove(&chunk_pos);
        if removed.is_some() {
            self.needs_propagation = true;
        }
        removed
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
        self.needs_propagation = false;
    }
}

pub fn rebuild_naadf_cache_from_dirty_queue(
    config: Res<NaadfConfig>,
    world: Res<VoxelWorld>,
    mut queue: ResMut<NaadfDirtyChunkQueue>,
    mut cache: ResMut<NaadfCache>,
    mut stats: ResMut<NaadfStats>,
    mut state: ResMut<NaadfCacheState>,
    mut timing: Option<ResMut<AreaTimingRecorder>>,
    frame: Option<Res<FrameCount>>,
) {
    let _timer = timing.as_deref_mut().map(|timing| {
        area_timer(
            timing,
            frame.as_deref().map_or(0, |frame| frame.0),
            "NAADF Cache Rebuild",
        )
    });

    if !config.enabled {
        state.ready = false;
        state.warming = false;
        state.fallback_reason = Some("NAADF disabled by config".to_string());
        stats.chunk_bound_updates_last_frame = 0;
        stats.chunk_bound_skipped_unknown_neighbors_last_frame = 0;
        stats.chunk_bound_saturated_fields_last_frame = 0;
        stats.chunk_bound_propagation_passes_last_frame = 0;
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
                cache.needs_propagation = true;
                report.rebuilt += 1;
                report.rebuilt_chunks.push(chunk_pos);
            }
            Err(NaadfExtractionError::MissingChunk(pos)) => {
                if cache.chunks.remove(&pos).is_some() {
                    cache.needs_propagation = true;
                    report.removed_missing += 1;
                }
                report.missing.push(pos);
            }
        }
        queue.finish(chunk_pos);
    }

    report.deferred = queue.pending_len() as u32;
    if cache.needs_propagation && report.deferred == 0 {
        report.propagation = propagate_chunk_skips_with_report(&mut cache.chunks);
        cache.needs_propagation = false;
        if report.propagation.updated_bounds > 0 {
            let mut rebuild_set = report
                .rebuilt_chunks
                .iter()
                .copied()
                .collect::<std::collections::HashSet<_>>();
            for chunk_pos in cache.chunks.keys().copied().collect::<Vec<_>>() {
                if rebuild_set.insert(chunk_pos) {
                    report.rebuilt_chunks.push(chunk_pos);
                }
            }
        }
    }

    let propagation = report.propagation;
    cache.last_report = report;
    stats.loaded_chunks = cache.len() as u32;
    stats.chunk_bound_updates_last_frame = propagation.updated_bounds;
    stats.chunk_bound_skipped_unknown_neighbors_last_frame = propagation.skipped_unknown_neighbors;
    stats.chunk_bound_saturated_fields_last_frame = propagation.saturated_fields;
    stats.chunk_bound_propagation_passes_last_frame = propagation.passes;
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

pub fn propagate_chunk_skips(chunks: &mut HashMap<IVec3, NaadfChunk>) {
    propagate_chunk_skips_with_report(chunks);
}

pub fn propagate_chunk_skips_with_report(
    chunks: &mut HashMap<IVec3, NaadfChunk>,
) -> NaadfChunkPropagationReport {
    for chunk in chunks.values_mut() {
        chunk.chunk_skip = PackedDirectionalBounds5Bit::zero();
    }

    let mut report = NaadfChunkPropagationReport::default();
    for _ in 0..CHUNK_BOUND_FIELD_MAX {
        report.passes = report.passes.saturating_add(1);
        let mut changed = false;
        changed |= propagate_chunk_axis_phase(
            chunks,
            [
                ChunkAxisExtension {
                    direction: IVec3::NEG_X,
                    bound_offset: CHUNK_BOUND_OFFSET_NEG_X,
                    check_offsets: CHECK_AXES_FOR_NEG_X,
                },
                ChunkAxisExtension {
                    direction: IVec3::X,
                    bound_offset: CHUNK_BOUND_OFFSET_POS_X,
                    check_offsets: CHECK_AXES_FOR_POS_X,
                },
            ],
            &mut report,
        );
        changed |= propagate_chunk_axis_phase(
            chunks,
            [
                ChunkAxisExtension {
                    direction: IVec3::NEG_Y,
                    bound_offset: CHUNK_BOUND_OFFSET_NEG_Y,
                    check_offsets: CHECK_AXES_FOR_NEG_Y,
                },
                ChunkAxisExtension {
                    direction: IVec3::Y,
                    bound_offset: CHUNK_BOUND_OFFSET_POS_Y,
                    check_offsets: CHECK_AXES_FOR_POS_Y,
                },
            ],
            &mut report,
        );
        changed |= propagate_chunk_axis_phase(
            chunks,
            [
                ChunkAxisExtension {
                    direction: IVec3::NEG_Z,
                    bound_offset: CHUNK_BOUND_OFFSET_NEG_Z,
                    check_offsets: CHECK_AXES_FOR_NEG_Z,
                },
                ChunkAxisExtension {
                    direction: IVec3::Z,
                    bound_offset: CHUNK_BOUND_OFFSET_POS_Z,
                    check_offsets: CHECK_AXES_FOR_POS_Z,
                },
            ],
            &mut report,
        );
        if !changed {
            break;
        }
    }
    report.saturated_fields = count_saturated_chunk_bound_fields(chunks);
    report
}

#[derive(Clone, Copy)]
struct ChunkAxisExtension {
    direction: IVec3,
    bound_offset: u32,
    check_offsets: [u32; 5],
}

const CHECK_AXES_FOR_NEG_X: [u32; 5] = [
    CHUNK_BOUND_OFFSET_NEG_X,
    CHUNK_BOUND_OFFSET_NEG_Y,
    CHUNK_BOUND_OFFSET_POS_Y,
    CHUNK_BOUND_OFFSET_NEG_Z,
    CHUNK_BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_POS_X: [u32; 5] = [
    CHUNK_BOUND_OFFSET_POS_X,
    CHUNK_BOUND_OFFSET_NEG_Y,
    CHUNK_BOUND_OFFSET_POS_Y,
    CHUNK_BOUND_OFFSET_NEG_Z,
    CHUNK_BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_NEG_Y: [u32; 5] = [
    CHUNK_BOUND_OFFSET_NEG_X,
    CHUNK_BOUND_OFFSET_POS_X,
    CHUNK_BOUND_OFFSET_NEG_Y,
    CHUNK_BOUND_OFFSET_NEG_Z,
    CHUNK_BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_POS_Y: [u32; 5] = [
    CHUNK_BOUND_OFFSET_NEG_X,
    CHUNK_BOUND_OFFSET_POS_X,
    CHUNK_BOUND_OFFSET_POS_Y,
    CHUNK_BOUND_OFFSET_NEG_Z,
    CHUNK_BOUND_OFFSET_POS_Z,
];
const CHECK_AXES_FOR_NEG_Z: [u32; 5] = [
    CHUNK_BOUND_OFFSET_NEG_X,
    CHUNK_BOUND_OFFSET_POS_X,
    CHUNK_BOUND_OFFSET_NEG_Y,
    CHUNK_BOUND_OFFSET_POS_Y,
    CHUNK_BOUND_OFFSET_NEG_Z,
];
const CHECK_AXES_FOR_POS_Z: [u32; 5] = [
    CHUNK_BOUND_OFFSET_NEG_X,
    CHUNK_BOUND_OFFSET_POS_X,
    CHUNK_BOUND_OFFSET_NEG_Y,
    CHUNK_BOUND_OFFSET_POS_Y,
    CHUNK_BOUND_OFFSET_POS_Z,
];

fn propagate_chunk_axis_phase(
    chunks: &mut HashMap<IVec3, NaadfChunk>,
    extensions: [ChunkAxisExtension; 2],
    report: &mut NaadfChunkPropagationReport,
) -> bool {
    let snapshot = chunks
        .iter()
        .map(|(pos, chunk)| (*pos, chunk.chunk_skip))
        .collect::<HashMap<_, _>>();
    let mut updates = Vec::new();

    for (pos, chunk) in chunks.iter() {
        if chunk.node.state() != NaadfNodeState::UniformEmpty {
            continue;
        }

        let mut updated = snapshot[pos];
        for extension in extensions {
            let neighbor_pos = *pos + extension.direction;
            let Some(neighbor) = chunks.get(&neighbor_pos) else {
                report.skipped_unknown_neighbors =
                    report.skipped_unknown_neighbors.saturating_add(1);
                continue;
            };
            if neighbor.node.state() != NaadfNodeState::UniformEmpty {
                continue;
            }
            let neighbor_skip = snapshot[&neighbor_pos];
            if extension
                .check_offsets
                .iter()
                .any(|offset| neighbor_skip.get_at_offset(*offset) < updated.get_at_offset(*offset))
            {
                continue;
            }
            if updated.get_at_offset(extension.bound_offset) >= CHUNK_BOUND_FIELD_MAX {
                continue;
            }
            updated.add_one(extension.bound_offset);
            report.updated_bounds = report.updated_bounds.saturating_add(1);
        }
        if updated != snapshot[pos] {
            updates.push((*pos, updated));
        }
    }

    let changed = !updates.is_empty();
    for (pos, skip) in updates {
        if let Some(chunk) = chunks.get_mut(&pos) {
            chunk.chunk_skip = skip;
        }
    }
    changed
}

fn count_saturated_chunk_bound_fields(chunks: &HashMap<IVec3, NaadfChunk>) -> u32 {
    const OFFSETS: [u32; 6] = [
        CHUNK_BOUND_OFFSET_NEG_X,
        CHUNK_BOUND_OFFSET_POS_X,
        CHUNK_BOUND_OFFSET_NEG_Y,
        CHUNK_BOUND_OFFSET_POS_Y,
        CHUNK_BOUND_OFFSET_NEG_Z,
        CHUNK_BOUND_OFFSET_POS_Z,
    ];

    chunks
        .values()
        .map(|chunk| {
            OFFSETS
                .iter()
                .filter(|offset| chunk.chunk_skip.get_at_offset(**offset) >= CHUNK_BOUND_FIELD_MAX)
                .count() as u32
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::layout::{CHUNK_BOUND_FIELD_MAX, CHUNK_BOUND_OFFSET_POS_X};
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

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

        cache.insert_chunk(chunk);

        assert!(cache.contains_chunk(IVec3::ZERO));
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn chunk_skip_extends_across_loaded_empty_chunks_only() {
        let mut cache = NaadfCache::default();
        for x in 0..3 {
            let mut chunk = Chunk::new(IVec3::new(x, 0, 0));
            if x == 2 {
                chunk.set(UVec3::ZERO, VoxelType::Rock);
            }
            cache.insert_chunk(crate::rendering::naadf::cpu_builder::build_naadf_chunk(
                &chunk,
                Default::default(),
            ));
        }

        let first = cache.get(IVec3::ZERO).unwrap();
        let second = cache.get(IVec3::X).unwrap();

        assert_eq!(
            first.chunk_skip.get_at_offset(CHUNK_BOUND_OFFSET_POS_X),
            1,
            "first empty chunk should skip over the second loaded empty chunk"
        );
        assert_eq!(
            second.chunk_skip.get_at_offset(CHUNK_BOUND_OFFSET_POS_X),
            0,
            "second empty chunk is adjacent to an occupied chunk"
        );
    }

    #[test]
    fn chunk_skip_does_not_cross_unloaded_neighbors() {
        let mut cache = NaadfCache::default();
        cache.insert_chunk(crate::rendering::naadf::cpu_builder::build_naadf_chunk(
            &Chunk::new(IVec3::ZERO),
            Default::default(),
        ));
        cache.insert_chunk(crate::rendering::naadf::cpu_builder::build_naadf_chunk(
            &Chunk::new(IVec3::new(2, 0, 0)),
            Default::default(),
        ));

        let first = cache.get(IVec3::ZERO).unwrap();

        assert_eq!(
            first.chunk_skip.get_at_offset(CHUNK_BOUND_OFFSET_POS_X),
            0,
            "missing chunk at +X must terminate chunk-level propagation"
        );
    }

    #[test]
    fn chunk_propagation_report_counts_updates_and_unknown_neighbors() {
        let mut chunks = HashMap::new();
        for x in [0, 1, 3] {
            let chunk = Chunk::new(IVec3::new(x, 0, 0));
            let naadf =
                crate::rendering::naadf::cpu_builder::build_naadf_chunk(&chunk, Default::default());
            chunks.insert(naadf.position, naadf);
        }

        let report = propagate_chunk_skips_with_report(&mut chunks);

        assert!(report.passes > 0);
        assert!(report.updated_bounds > 0);
        assert!(report.skipped_unknown_neighbors > 0);
    }

    #[test]
    fn chunk_propagation_report_counts_saturated_fields() {
        let mut chunks = HashMap::new();
        for x in 0..=32 {
            let chunk = Chunk::new(IVec3::new(x, 0, 0));
            let naadf =
                crate::rendering::naadf::cpu_builder::build_naadf_chunk(&chunk, Default::default());
            chunks.insert(naadf.position, naadf);
        }

        let report = propagate_chunk_skips_with_report(&mut chunks);

        assert_eq!(
            chunks
                .get(&IVec3::ZERO)
                .unwrap()
                .chunk_skip
                .get_at_offset(CHUNK_BOUND_OFFSET_POS_X),
            CHUNK_BOUND_FIELD_MAX
        );
        assert!(report.saturated_fields > 0);
    }
}
