use super::*;

#[derive(SystemSet, Debug, Hash, PartialEq, Eq, Clone)]
pub enum VoxelTerrainSet {
    GeneratedChunks,
    NaadfDirtyQueue,
    MeshDirty,
}

#[derive(Resource, Default, Debug)]
pub struct TerrainLodControl {
    pub freeze_lod: bool,
}

#[derive(Resource, Default)]
pub(crate) struct TerrainLodTransitionState {
    pub(crate) last_change_frame: HashMap<IVec3, u32>,
    pub(crate) change_count: HashMap<IVec3, u32>,
    pub(crate) last_change_second: f32,
    pub(crate) changes_this_second: u32,
    pub(crate) changes_per_second: f32,
    pub(crate) repeated_chunks_this_frame: u32,
}

#[derive(Resource)]
pub struct WorldConfig {
    pub size_chunks: IVec3,
    pub chunk_size: i32,
    pub greedy_meshing: bool,
}
