use bevy::prelude::*;

use crate::voxel::materials::MaterialId;
use crate::voxel::types::Voxel;
use crate::voxel::world::{VoxelSample, VoxelWorld};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoxelRayPurpose {
    Debug,
    SunVisibility,
    GiSecondary,
    TerrainAo,
    ContactShadow,
    PreviewPrimary,
}

impl VoxelRayPurpose {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::SunVisibility => "sun_visibility",
            Self::GiSecondary => "gi_secondary",
            Self::TerrainAo => "terrain_ao",
            Self::ContactShadow => "contact_shadow",
            Self::PreviewPrimary => "preview_primary",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "debug" => Some(Self::Debug),
            "sun_visibility" | "sun-visibility" | "sun" => Some(Self::SunVisibility),
            "gi_secondary" | "gi-secondary" | "gi" => Some(Self::GiSecondary),
            "terrain_ao" | "terrain-ao" | "ao" => Some(Self::TerrainAo),
            "contact_shadow" | "contact-shadow" | "contact" => Some(Self::ContactShadow),
            "preview_primary" | "preview-primary" | "preview" => Some(Self::PreviewPrimary),
            _ => None,
        }
    }
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

pub struct CurrentSdfRayBackend<'a> {
    world: Option<&'a VoxelWorld>,
    stats: VoxelRayBackendStats,
}

impl<'a> CurrentSdfRayBackend<'a> {
    pub fn from_world(world: &'a VoxelWorld) -> Self {
        Self {
            world: Some(world),
            stats: VoxelRayBackendStats {
                ready: true,
                chunk_count: world.chunk_count() as u32,
                dirty_chunks: world.dirty_chunks().count() as u32,
                ..default()
            },
        }
    }
}

impl Default for CurrentSdfRayBackend<'_> {
    fn default() -> Self {
        Self {
            world: None,
            stats: VoxelRayBackendStats::default(),
        }
    }
}

impl VoxelRayBackend for CurrentSdfRayBackend<'_> {
    fn name(&self) -> &'static str {
        "current_sdf"
    }

    fn trace(
        &self,
        origin: Vec3,
        dir: Vec3,
        max_distance: f32,
        purpose: VoxelRayPurpose,
    ) -> Option<VoxelRayHit> {
        let world = self.world?;
        trace_voxel_world_cpu(world, origin, dir, max_distance, purpose).0
    }

    fn is_ready(&self) -> bool {
        self.world.is_some()
    }

    fn stats(&self) -> VoxelRayBackendStats {
        VoxelRayBackendStats {
            ready: self.is_ready(),
            ..self.stats
        }
    }
}

pub fn trace_voxel_world_cpu(
    world: &VoxelWorld,
    origin: Vec3,
    dir: Vec3,
    max_distance: f32,
    purpose: VoxelRayPurpose,
) -> (Option<VoxelRayHit>, u32) {
    let Some(dir) = dir.try_normalize() else {
        return (None, 0);
    };
    if max_distance <= 0.0 {
        return (None, 0);
    }

    let mut voxel = origin.floor().as_ivec3();
    let step = IVec3::new(
        if dir.x >= 0.0 { 1 } else { -1 },
        if dir.y >= 0.0 { 1 } else { -1 },
        if dir.z >= 0.0 { 1 } else { -1 },
    );
    let inv_dir = Vec3::new(
        reciprocal_or_infinity(dir.x),
        reciprocal_or_infinity(dir.y),
        reciprocal_or_infinity(dir.z),
    );
    let mut t_max = Vec3::new(
        axis_t_max(origin.x, voxel.x, step.x, inv_dir.x),
        axis_t_max(origin.y, voxel.y, step.y, inv_dir.y),
        axis_t_max(origin.z, voxel.z, step.z, inv_dir.z),
    );
    let t_delta = Vec3::new(inv_dir.x.abs(), inv_dir.y.abs(), inv_dir.z.abs());
    let mut distance = 0.0f32;
    let mut normal = Vec3::ZERO;
    let mut steps = 0u32;

    while distance <= max_distance {
        steps = steps.saturating_add(1);
        if let Some(hit) = current_world_hit(world, origin, dir, voxel, distance, normal, steps) {
            let _ = purpose;
            return (Some(hit), steps);
        }

        if t_max.x <= t_max.y && t_max.x <= t_max.z {
            voxel.x += step.x;
            distance = t_max.x;
            t_max.x += t_delta.x;
            normal = Vec3::new(-(step.x as f32), 0.0, 0.0);
        } else if t_max.y <= t_max.z {
            voxel.y += step.y;
            distance = t_max.y;
            t_max.y += t_delta.y;
            normal = Vec3::new(0.0, -(step.y as f32), 0.0);
        } else {
            voxel.z += step.z;
            distance = t_max.z;
            t_max.z += t_delta.z;
            normal = Vec3::new(0.0, 0.0, -(step.z as f32));
        }
    }

    (None, steps)
}

fn current_world_hit(
    world: &VoxelWorld,
    origin: Vec3,
    dir: Vec3,
    world_voxel: IVec3,
    distance: f32,
    normal: Vec3,
    steps: u32,
) -> Option<VoxelRayHit> {
    let voxel = match world.sample_voxel(world_voxel) {
        VoxelSample::InBounds(voxel) if voxel.is_solid() => voxel,
        _ => return None,
    };
    let chunk = VoxelWorld::world_to_chunk(world_voxel);
    let local = VoxelWorld::world_to_local(world_voxel);
    let material_id = world
        .get_material_id(world_voxel)
        .unwrap_or_else(|| MaterialId::from_voxel(voxel));

    Some(VoxelRayHit {
        chunk,
        local,
        world_voxel,
        position: origin + dir * distance,
        normal,
        distance,
        material_id: material_id.0,
        steps,
    })
}

fn reciprocal_or_infinity(value: f32) -> f32 {
    if value.abs() <= f32::EPSILON {
        f32::INFINITY
    } else {
        1.0 / value
    }
}

fn axis_t_max(origin_axis: f32, voxel_axis: i32, step_axis: i32, inv_dir_axis: f32) -> f32 {
    if inv_dir_axis.is_infinite() {
        return f32::INFINITY;
    }
    let boundary = if step_axis > 0 {
        voxel_axis as f32 + 1.0
    } else {
        voxel_axis as f32
    };
    (boundary - origin_axis) * inv_dir_axis
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;

    #[test]
    fn current_backend_hits_solid_world_voxel() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(4, 4, 4), VoxelType::Rock);
        world.insert_chunk(chunk);

        let backend = CurrentSdfRayBackend::from_world(&world);
        let hit = backend.trace(
            Vec3::new(0.5, 4.5, 4.5),
            Vec3::X,
            16.0,
            VoxelRayPurpose::Debug,
        );

        assert_eq!(hit.map(|hit| hit.local), Some(UVec3::new(4, 4, 4)));
    }

    #[test]
    fn current_backend_reports_assigned_material_id() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut chunk = Chunk::new(IVec3::ZERO);
        let local = UVec3::new(4, 4, 4);
        chunk.set(local, VoxelType::Rock);
        chunk.set_material_id(local, MaterialId(6));
        world.insert_chunk(chunk);

        let backend = CurrentSdfRayBackend::from_world(&world);
        let hit = backend.trace(
            Vec3::new(0.5, 4.5, 4.5),
            Vec3::X,
            16.0,
            VoxelRayPurpose::Debug,
        );

        assert_eq!(hit.map(|hit| hit.material_id), Some(6));
    }

    #[test]
    fn current_backend_misses_air_and_water() {
        let mut world = VoxelWorld::new(IVec3::new(1, 1, 1));
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set(UVec3::new(4, 4, 4), VoxelType::Water);
        world.insert_chunk(chunk);

        let backend = CurrentSdfRayBackend::from_world(&world);

        assert!(
            backend
                .trace(
                    Vec3::new(0.5, 4.5, 4.5),
                    Vec3::X,
                    16.0,
                    VoxelRayPurpose::Debug
                )
                .is_none()
        );
    }

    #[test]
    fn current_backend_without_world_is_not_ready() {
        let backend = CurrentSdfRayBackend::default();

        assert!(!backend.is_ready());
        assert!(!backend.stats().ready);
    }
}
