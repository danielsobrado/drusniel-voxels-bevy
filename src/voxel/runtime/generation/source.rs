use super::*;

#[derive(Clone)]
pub(crate) enum ChunkTerrainSource {
    WorldSource(Arc<ProceduralWorldSourceTerrainBridge>, TerrainSourceMode),
}

impl ChunkTerrainSource {
    pub(crate) fn active_mode(&self) -> TerrainSourceMode {
        match self {
            ChunkTerrainSource::WorldSource(_, mode) => *mode,
        }
    }
}

pub(crate) fn chunk_terrain_source_for_config(
    config: &TerrainSourceConfig,
    _biome_table: BiomeTable,
) -> ChunkTerrainSource {
    match config.mode {
        TerrainSourceMode::GpuWorldSource | TerrainSourceMode::CpuWorldSourceReference => {
            ChunkTerrainSource::WorldSource(
                Arc::new(ProceduralWorldSourceTerrainBridge::load_or_default()),
                config.mode,
            )
        }
    }
}
