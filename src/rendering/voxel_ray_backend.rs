use bevy::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoxelRayPurpose {
    Debug,
    SunVisibility,
    GiSecondary,
    TerrainAo,
    ContactShadow,
    PreviewPrimary,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct VoxelRayHit {
    pub chunk: IVec3,
    pub local: UVec3,
    pub world_voxel: IVec3,
    pub position: Vec3,
    pub normal: Vec3,
    pub distance: f32,
    pub material_id: u16,
    pub steps: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct VoxelRayBackendStats {
    pub ready: bool,
    pub chunk_count: u32,
    pub dirty_chunks: u32,
    pub rays_traced: u64,
    pub hits: u64,
    pub misses: u64,
    pub total_steps: u64,
    pub fallback_count: u64,
}

impl VoxelRayBackendStats {
    pub fn average_steps(self) -> f32 {
        if self.rays_traced == 0 {
            0.0
        } else {
            self.total_steps as f32 / self.rays_traced as f32
        }
    }
}

pub trait VoxelRayBackend {
    fn name(&self) -> &'static str;

    fn trace(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
        purpose: VoxelRayPurpose,
    ) -> Option<VoxelRayHit>;

    fn is_ready(&self) -> bool;
    fn stats(&self) -> VoxelRayBackendStats;
}

#[derive(Default)]
pub struct CurrentSdfRayBackend {
    stats: VoxelRayBackendStats,
}

impl VoxelRayBackend for CurrentSdfRayBackend {
    fn name(&self) -> &'static str {
        "current_sdf"
    }

    fn trace(
        &self,
        _origin: Vec3,
        _dir: Vec3,
        _max_distance: f32,
        _purpose: VoxelRayPurpose,
    ) -> Option<VoxelRayHit> {
        None
    }

    fn is_ready(&self) -> bool {
        true
    }

    fn stats(&self) -> VoxelRayBackendStats {
        VoxelRayBackendStats {
            ready: true,
            ..self.stats
        }
    }
}
