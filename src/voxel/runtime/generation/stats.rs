use super::*;

#[derive(Default)]
pub(crate) struct ChunkStats {
    pub(crate) sand: u32,
    pub(crate) dungeon_wall: u32,
    pub(crate) dungeon_floor: u32,
    pub(crate) wood: u32,
    pub(crate) leaves: u32,
}

#[derive(Default)]
pub(crate) struct WorldStats {
    total_sand: u32,
    total_dungeon_wall: u32,
    total_dungeon_floor: u32,
    total_wood: u32,
    total_leaves: u32,
    empty_chunks: u32,
    solid_chunks: u32,
    mixed_chunks: u32,
}

impl WorldStats {
    pub(crate) fn add(&mut self, chunk_stats: &ChunkStats, uniformity: ChunkUniformity) {
        self.total_sand += chunk_stats.sand;
        self.total_dungeon_wall += chunk_stats.dungeon_wall;
        self.total_dungeon_floor += chunk_stats.dungeon_floor;
        self.total_wood += chunk_stats.wood;
        self.total_leaves += chunk_stats.leaves;

        match uniformity {
            ChunkUniformity::Empty => self.empty_chunks += 1,
            ChunkUniformity::Solid => self.solid_chunks += 1,
            ChunkUniformity::Mixed => self.mixed_chunks += 1,
            ChunkUniformity::Unknown => {}
        }
    }

    pub(crate) fn log_summary(&self, generation_time: std::time::Duration) {
        let total_chunks = self.empty_chunks + self.solid_chunks + self.mixed_chunks;
        let skippable = self.empty_chunks + self.solid_chunks;
        let skip_percent = if total_chunks > 0 {
            (skippable as f32 / total_chunks as f32) * 100.0
        } else {
            0.0
        };

        info!("=== WORLD GENERATION SUMMARY ===");
        info!("Generation time: {:.2}s", generation_time.as_secs_f32());
        info!("--- Chunk Uniformity (mesh optimization) ---");
        if total_chunks > 0 {
            info!(
                "  Empty chunks (all air): {} ({:.1}% of total)",
                self.empty_chunks,
                (self.empty_chunks as f32 / total_chunks as f32) * 100.0
            );
            info!(
                "  Solid chunks (no internal surfaces): {} ({:.1}% of total)",
                self.solid_chunks,
                (self.solid_chunks as f32 / total_chunks as f32) * 100.0
            );
            info!(
                "  Mixed chunks (need full meshing): {} ({:.1}% of total)",
                self.mixed_chunks,
                (self.mixed_chunks as f32 / total_chunks as f32) * 100.0
            );
        }
        info!(
            "  Skippable chunks: {}/{} ({:.1}%)",
            skippable, total_chunks, skip_percent
        );
        info!("--- Block Statistics ---");
        info!("  Sand blocks: {}", self.total_sand);
        info!("  Dungeon wall blocks: {}", self.total_dungeon_wall);
        info!("  Dungeon floor blocks: {}", self.total_dungeon_floor);
        info!("  Wood blocks: {}", self.total_wood);
        info!("  Leaves blocks: {}", self.total_leaves);
    }
}

pub(crate) fn collect_chunk_stats(voxels: &[VoxelType; CHUNK_VOLUME]) -> ChunkStats {
    collect_chunk_stats_from_iter(voxels.iter().copied())
}

pub(crate) fn collect_chunk_stats_from_chunk(chunk: &Chunk) -> ChunkStats {
    collect_chunk_stats_from_iter(chunk.iter().map(|(_, voxel)| voxel))
}

fn collect_chunk_stats_from_iter(voxels: impl IntoIterator<Item = VoxelType>) -> ChunkStats {
    let mut stats = ChunkStats::default();
    for voxel in voxels {
        match voxel {
            VoxelType::Sand => stats.sand += 1,
            VoxelType::DungeonWall => stats.dungeon_wall += 1,
            VoxelType::DungeonFloor => stats.dungeon_floor += 1,
            VoxelType::Wood => stats.wood += 1,
            VoxelType::Leaves => stats.leaves += 1,
            _ => {}
        }
    }
    stats
}
