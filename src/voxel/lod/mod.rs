//! Terrain LOD policy and effective mesh LOD resolution.

pub mod skirt;

use std::collections::HashSet;

use bevy::prelude::*;

use crate::bench::{BenchForensicsConfig, BenchForensicsTerrainMesher, BenchRenderToggles};
use crate::constants::{
    CHUNK_SIZE_F32, CHUNK_SIZE_I32, DEFAULT_CULL_DISTANCE, DEFAULT_HIGH_DETAIL_DISTANCE,
    LOD_HYSTERESIS, WATER_LEVEL,
};
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::voxel::chunk::{Chunk, LodLevel};
use crate::voxel::mc_transvoxel::McTransvoxelSettings;
use crate::voxel::meshing::{MeshMode, MeshSettings};
use crate::voxel::skirt::NeighborLods;
use crate::voxel::world::VoxelWorld;

const TERRAIN_LOD_HYSTERESIS: f32 = LOD_HYSTERESIS * 2.0;
pub const HORIZON_PROXY_BAND_DISTANCE: f32 = 256.0;

#[derive(Resource, Clone, Copy, Debug)]
pub struct LodSettings {
    pub high_detail_distance: f32,
    pub cull_distance: f32,
    /// Retained for configuration compatibility; live terrain meshes at LOD0.
    pub low_detail_mode: MeshMode,
}

impl Default for LodSettings {
    fn default() -> Self {
        Self {
            high_detail_distance: DEFAULT_HIGH_DETAIL_DISTANCE,
            cull_distance: DEFAULT_CULL_DISTANCE,
            low_detail_mode: MeshMode::SurfaceNets,
        }
    }
}

impl LodSettings {
    fn minimum_valid_cull_distance(high_detail_distance: f32) -> f32 {
        high_detail_distance + terrain_lod_hysteresis_for(high_detail_distance) * 4.0 + 1.0
    }

    #[cfg(test)]
    pub(crate) fn has_valid_distance_bands(&self) -> bool {
        self.cull_distance
            > self.high_detail_distance
                + terrain_lod_hysteresis_for(self.high_detail_distance) * 4.0
    }

    pub fn clamp_distance_bands(&mut self) {
        let min_cull_distance = Self::minimum_valid_cull_distance(self.high_detail_distance);
        self.cull_distance = self.cull_distance.max(min_cull_distance);
    }
}

pub(crate) fn should_defer_surface_nets_mesh(
    target_mode: MeshMode,
    missing_boundary_neighbors: u32,
) -> bool {
    matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
        && missing_boundary_neighbors > 0
}

pub(crate) fn resolve_terrain_mesh_mode(
    base_mode: MeshMode,
    chunk_pos: IVec3,
    logical_lod: LodLevel,
    mc_settings: &McTransvoxelSettings,
    camera_pos: Option<Vec3>,
) -> MeshMode {
    if base_mode != MeshMode::SurfaceNets || !mc_settings.enabled {
        return base_mode;
    }
    let camera_chunk = camera_pos.map(|pos| {
        VoxelWorld::world_to_chunk(IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        ))
    });
    if mc_settings.should_mesh_chunk(chunk_pos, camera_chunk, logical_lod) {
        MeshMode::McTransvoxel
    } else {
        base_mode
    }
}

pub(crate) fn forensics_mesh_mode_override(
    base_mode: MeshMode,
    forensics: Option<&BenchForensicsConfig>,
) -> MeshMode {
    let Some(forensics) = forensics.filter(|config| config.enabled) else {
        return base_mode;
    };
    match forensics.terrain_mesher {
        BenchForensicsTerrainMesher::Auto => base_mode,
        BenchForensicsTerrainMesher::SurfaceNets => MeshMode::SurfaceNets,
        BenchForensicsTerrainMesher::McTransvoxel => MeshMode::McTransvoxel,
    }
}

pub(crate) fn target_terrain_mesh_mode_for_lod(
    lod_level: LodLevel,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> MeshMode {
    if lod_level == LodLevel::Culled {
        lod_settings.low_detail_mode
    } else {
        mesh_settings.mode
    }
}

pub(crate) fn effective_terrain_mesh_lod_for_chunk(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    _mesh_settings: &MeshSettings,
    _lod_settings: &LodSettings,
) -> Option<LodLevel> {
    let chunk = world.get_chunk(chunk_pos)?;
    Some(if chunk.lod_level() == LodLevel::Culled {
        LodLevel::Culled
    } else {
        LodLevel::Lod0
    })
}

pub(crate) fn build_terrain_neighbor_lods(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> NeighborLods {
    let effective_lod = |offset| {
        effective_terrain_mesh_lod_for_chunk(world, chunk_pos + offset, mesh_settings, lod_settings)
    };
    NeighborLods {
        neg_x: effective_lod(IVec3::NEG_X),
        pos_x: effective_lod(IVec3::X),
        neg_y: effective_lod(IVec3::NEG_Y),
        pos_y: effective_lod(IVec3::Y),
        neg_z: effective_lod(IVec3::NEG_Z),
        pos_z: effective_lod(IVec3::Z),
    }
}

pub(crate) fn terrain_material_quality_for_lod(
    lod_level: LodLevel,
    bench_toggles: Option<&BenchRenderToggles>,
) -> TerrainMaterialQuality {
    if let Some(forced) =
        bench_toggles.and_then(|toggles| toggles.terrain_material_quality.forced_quality())
    {
        return forced;
    }
    if bench_toggles.is_some_and(|toggles| toggles.disable_terrain_material_lod) {
        return TerrainMaterialQuality::FullTriplanar;
    }
    match lod_level {
        LodLevel::Lod0 | LodLevel::Lod1 | LodLevel::Lod2 => TerrainMaterialQuality::FullTriplanar,
        LodLevel::Lod3 | LodLevel::Culled => TerrainMaterialQuality::HorizonProxy,
    }
}

/// Retained with the LOD transaction scaffolding that still gates commit batching.
pub(crate) fn terrain_lod_hysteresis(settings: &LodSettings) -> f32 {
    terrain_lod_hysteresis_for(settings.high_detail_distance)
}

pub(crate) fn terrain_lod_hysteresis_for(high_detail_distance: f32) -> f32 {
    TERRAIN_LOD_HYSTERESIS
        .min(high_detail_distance * 0.25)
        .min(8.0)
}

pub(crate) fn is_horizon_proxy_lod(lod_level: LodLevel) -> bool {
    lod_level == LodLevel::Lod3
}

pub(crate) fn terrain_lod_requires_collider(lod_level: LodLevel) -> bool {
    matches!(lod_level, LodLevel::Lod0 | LodLevel::Lod1)
}

pub(crate) fn terrain_lod_distance_xz(chunk_pos: IVec3, camera_pos: Vec3) -> f32 {
    let world_pos = VoxelWorld::chunk_to_world(chunk_pos);
    let chunk_center = Vec2::new(
        world_pos.x as f32 + CHUNK_SIZE_F32 * 0.5,
        world_pos.z as f32 + CHUNK_SIZE_F32 * 0.5,
    );

    chunk_center.distance(Vec2::new(camera_pos.x, camera_pos.z))
}

pub(crate) fn collect_water_shore_lod_guard_chunks(world: &VoxelWorld) -> HashSet<IVec3> {
    let mut chunks = HashSet::new();
    for (chunk_pos, chunk) in world.chunk_entries() {
        if !chunk_contains_liquid(chunk) {
            continue;
        }
        for dy in -1..=1 {
            for dz in -2i32..=2 {
                for dx in -2i32..=2 {
                    if dx.abs() + dz.abs() <= 2 {
                        chunks.insert(*chunk_pos + IVec3::new(dx, dy, dz));
                    }
                }
            }
        }
    }
    for (chunk_pos, _) in world.chunk_entries() {
        if chunk_layer_intersects_waterline(*chunk_pos) {
            chunks.insert(*chunk_pos);
        }
    }
    chunks
}

pub(crate) fn chunk_layer_intersects_waterline(chunk_pos: IVec3) -> bool {
    let min_y = chunk_pos.y * CHUNK_SIZE_I32;
    let max_y = min_y + CHUNK_SIZE_I32 - 1;
    WATER_LEVEL >= min_y - 2 && WATER_LEVEL <= max_y + 2
}

pub(crate) fn chunk_contains_liquid(chunk: &Chunk) -> bool {
    chunk.contains_liquid()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{INTEGRATED_GPU_CULL_DISTANCE, INTEGRATED_GPU_HIGH_DETAIL_DISTANCE};
    use crate::voxel::types::VoxelType;

    #[test]
    fn terrain_lod_hysteresis_caps_at_eight_voxels() {
        assert_eq!(terrain_lod_hysteresis_for(176.0), 8.0);
        assert_eq!(terrain_lod_hysteresis_for(1_000.0), 8.0);
    }

    #[test]
    fn terrain_lod_hysteresis_scales_down_for_small_distances() {
        assert_eq!(terrain_lod_hysteresis_for(16.0), 4.0);
        assert_eq!(terrain_lod_hysteresis_for(8.0), 2.0);
        assert_eq!(terrain_lod_hysteresis_for(0.0), 0.0);
    }

    #[test]
    fn default_lod_distances_keep_required_hysteresis_bands() {
        assert!(LodSettings::default().has_valid_distance_bands());

        let integrated_gpu_settings = LodSettings {
            high_detail_distance: INTEGRATED_GPU_HIGH_DETAIL_DISTANCE,
            cull_distance: INTEGRATED_GPU_CULL_DISTANCE,
            low_detail_mode: MeshMode::Blocky,
        };
        assert!(integrated_gpu_settings.has_valid_distance_bands());
    }

    #[test]
    fn lod_distance_clamp_preserves_four_hysteresis_bands() {
        let hd = 120.0_f32;
        let mut settings = LodSettings {
            high_detail_distance: hd,
            cull_distance: hd + terrain_lod_hysteresis_for(hd) * 4.0,
            low_detail_mode: MeshMode::SurfaceNets,
        };

        assert!(!settings.has_valid_distance_bands());
        settings.clamp_distance_bands();
        assert!(settings.has_valid_distance_bands());
    }

    #[test]
    fn water_shore_lod_guard_marks_diamond_ring_with_y_neighbors() {
        let center = IVec3::new(2, 1, 2);
        let mut world = VoxelWorld::new(IVec3::new(5, 3, 5));
        let mut chunk = Chunk::new(center);
        chunk.set(UVec3::new(8, 8, 8), VoxelType::Water);
        world.insert_chunk(chunk);

        let guarded = collect_water_shore_lod_guard_chunks(&world);
        assert!(guarded.contains(&center));
        assert!(guarded.contains(&(center + IVec3::new(1, 0, 1))));
        assert!(guarded.contains(&(center + IVec3::new(2, 0, 0))));
        assert!(!guarded.contains(&(center + IVec3::new(2, 0, 1))));
        assert!(guarded.contains(&(center + IVec3::Y)));
        assert!(guarded.contains(&(center + IVec3::NEG_Y)));
        assert!(!guarded.contains(&(center + IVec3::new(0, 2, 0))));
    }

    #[test]
    fn waterline_chunk_layer_is_guarded_without_liquid_voxels() {
        let chunk_pos = IVec3::new(0, 1, 0);
        assert!(chunk_layer_intersects_waterline(chunk_pos));

        let mut world = VoxelWorld::new(IVec3::new(1, 3, 1));
        world.insert_chunk(Chunk::new(chunk_pos));
        assert!(collect_water_shore_lod_guard_chunks(&world).contains(&chunk_pos));
    }

    #[test]
    fn surface_nets_mesh_defers_when_in_bounds_halo_is_missing() {
        assert!(should_defer_surface_nets_mesh(MeshMode::SurfaceNets, 1));
        assert!(!should_defer_surface_nets_mesh(MeshMode::SurfaceNets, 0));
        assert!(!should_defer_surface_nets_mesh(MeshMode::Blocky, 1));
    }

    #[test]
    fn terrain_lod_distance_ignores_chunk_height() {
        let camera_pos = Vec3::new(24.0, 128.0, 24.0);
        assert_eq!(
            terrain_lod_distance_xz(IVec3::new(1, 0, 1), camera_pos),
            terrain_lod_distance_xz(IVec3::new(1, 6, 1), camera_pos)
        );
    }

    #[test]
    fn effective_live_mesh_lod_is_lod0() {
        let mut world = VoxelWorld::new(IVec3::ONE);
        let mut chunk = Chunk::new(IVec3::ZERO);
        chunk.set_lod_level(LodLevel::Lod3);
        world.insert_chunk(chunk);

        assert_eq!(
            effective_terrain_mesh_lod_for_chunk(
                &world,
                IVec3::ZERO,
                &MeshSettings::default(),
                &LodSettings::default(),
            ),
            Some(LodLevel::Lod0)
        );
    }
}
