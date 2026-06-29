use super::*;

#[derive(Clone)]
pub(crate) enum ChunkTerrainSource {
    Legacy(Arc<TerrainGenerator>),
    WorldSource(Arc<ProceduralWorldSourceTerrainBridge>, TerrainSourceMode),
}

impl ChunkTerrainSource {
    pub(crate) fn active_mode(&self) -> TerrainSourceMode {
        match self {
            ChunkTerrainSource::Legacy(_) => TerrainSourceMode::Legacy,
            ChunkTerrainSource::WorldSource(_, mode) => *mode,
        }
    }
}

pub(crate) fn chunk_terrain_source_for_config(
    config: &TerrainSourceConfig,
    biome_table: BiomeTable,
) -> ChunkTerrainSource {
    match config.mode {
        TerrainSourceMode::Legacy => ChunkTerrainSource::Legacy(Arc::new(
            TerrainGenerator::with_biome_table(ValueNoise::default(), biome_table),
        )),
        TerrainSourceMode::GpuWorldSource | TerrainSourceMode::CpuWorldSourceReference => {
            ChunkTerrainSource::WorldSource(
                Arc::new(ProceduralWorldSourceTerrainBridge::load_or_default()),
                config.mode,
            )
        }
    }
}
