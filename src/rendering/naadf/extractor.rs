use bevy::prelude::*;

use crate::rendering::naadf::cpu_builder::{NaadfBuildOptions, build_naadf_chunk};
use crate::rendering::naadf::layout::NaadfChunk;
use crate::voxel::world::VoxelWorld;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NaadfExtractionError {
    MissingChunk(IVec3),
}

#[derive(Clone, Copy, Debug)]
pub struct NaadfChunkExtractor {
    options: NaadfBuildOptions,
}

impl Default for NaadfChunkExtractor {
    fn default() -> Self {
        Self {
            options: NaadfBuildOptions::default(),
        }
    }
}

impl NaadfChunkExtractor {
    pub fn new(options: NaadfBuildOptions) -> Self {
        Self { options }
    }

    pub fn extract_chunk(
        &self,
        world: &VoxelWorld,
        chunk_pos: IVec3,
    ) -> Result<NaadfChunk, NaadfExtractionError> {
        let chunk = world
            .get_chunk(chunk_pos)
            .ok_or(NaadfExtractionError::MissingChunk(chunk_pos))?;
        Ok(build_naadf_chunk(chunk, self.options))
    }

    pub fn extract_loaded(&self, world: &VoxelWorld) -> Vec<NaadfChunk> {
        world
            .chunk_entries()
            .map(|(_, chunk)| build_naadf_chunk(chunk, self.options))
            .collect()
    }
}
