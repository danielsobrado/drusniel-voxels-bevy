use super::*;

pub(crate) struct ChunkGenerationResult {
    pub(crate) chunk: Chunk,
    pub(crate) stats: ChunkStats,
}

/// Tracks the state of async world generation.
#[derive(Resource)]
pub struct ChunkGenerationState {
    /// Total number of chunks to generate.
    pub total_chunks: u32,
    /// Number of chunks that have completed generation.
    pub chunks_completed: u32,
    /// Whether generation is complete.
    pub is_complete: bool,
    /// Whether we're loading from disk (not generating).
    pub loading_from_disk: bool,
    /// Accumulated world stats during generation.
    pub(crate) world_stats: WorldStats,
    /// Time when generation started.
    pub(crate) start_time: Option<std::time::Instant>,
}

impl Default for ChunkGenerationState {
    fn default() -> Self {
        Self {
            total_chunks: 0,
            chunks_completed: 0,
            is_complete: true,
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: None,
        }
    }
}

impl ChunkGenerationState {
    pub fn progress(&self) -> f32 {
        if self.total_chunks == 0 {
            return 1.0;
        }
        self.chunks_completed as f32 / self.total_chunks as f32
    }

    pub fn is_generating(&self) -> bool {
        !self.is_complete && !self.loading_from_disk
    }
}

pub(crate) fn should_poll_chunk_generation_tasks(gen_state: &ChunkGenerationState) -> bool {
    !gen_state.is_complete && !gen_state.loading_from_disk && gen_state.total_chunks > 0
}

#[derive(Component)]
pub(crate) struct ChunkGenerationTask {
    pub(crate) task: Task<ChunkGenerationResult>,
    pub(crate) chunk_pos: IVec3,
}

#[derive(Component)]
pub(crate) struct WorldLoadTask {
    pub(crate) task: Task<Result<VoxelWorld, String>>,
}

#[derive(Resource, Default, Debug)]
pub(crate) struct PendingWorldGeneration {
    pub(crate) requested: bool,
}

#[derive(Resource, Default)]
pub(crate) struct WorldGenerationQueue {
    positions: Vec<IVec3>,
    next_index: usize,
    generator: Option<ChunkTerrainSource>,
}

impl WorldGenerationQueue {
    pub(crate) fn begin(&mut self, positions: Vec<IVec3>, generator: ChunkTerrainSource) {
        self.positions = positions;
        self.next_index = 0;
        self.generator = Some(generator);
    }

    pub(crate) fn remaining(&self) -> usize {
        self.positions.len().saturating_sub(self.next_index)
    }

    pub(crate) fn take_next_batch(
        &mut self,
        max_batch_size: usize,
    ) -> Option<(Vec<IVec3>, ChunkTerrainSource, bool)> {
        if self.remaining() == 0 {
            self.positions.clear();
            self.next_index = 0;
            self.generator = None;
            return None;
        }

        let generator = self.generator.as_ref()?.clone();
        let batch_size = max_batch_size.max(1);
        let end_index = (self.next_index + batch_size).min(self.positions.len());
        let batch = self.positions[self.next_index..end_index].to_vec();
        self.next_index = end_index;
        let complete = self.remaining() == 0;

        if complete {
            self.positions.clear();
            self.next_index = 0;
            self.generator = None;
        }

        Some((batch, generator, complete))
    }
}
