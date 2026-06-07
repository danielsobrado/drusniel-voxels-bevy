//! Terrain LOD policy and effective mesh LOD resolution.

pub mod boundary_strip;
pub mod skirt;

use std::collections::{HashMap, HashSet};

use bevy::prelude::*;

use crate::bench::{
    BenchForensicsConfig, BenchForensicsTerrainLod, BenchForensicsTerrainMesher, BenchRenderToggles,
};
use crate::constants::{
    CHUNK_SIZE, CHUNK_SIZE_F32, CHUNK_SIZE_I32, DEFAULT_CULL_DISTANCE,
    DEFAULT_HIGH_DETAIL_DISTANCE, LOD_HYSTERESIS, WATER_LEVEL,
};
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::voxel::chunk::{Chunk, ChunkUniformity, LodLevel};
use crate::voxel::mc_transvoxel::McTransvoxelSettings;
use crate::voxel::meshing::{
    MeshMode, MeshSettings, empty_chunk_has_surface_nets_boundary_surface,
};
use crate::voxel::skirt::NeighborLods;
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

const TERRAIN_LOD_HYSTERESIS: f32 = LOD_HYSTERESIS * 2.0;
const HORIZON_PROXY_BAND_DISTANCE: f32 = 256.0;
pub(crate) const WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA: f32 = 80.0;

#[derive(Resource, Clone, Copy, Debug)]
pub struct LodSettings {
    /// Distance in world units for high detail meshing (Surface Nets by default).
    pub high_detail_distance: f32,
    /// Distance in world units at which chunks are culled entirely.
    pub cull_distance: f32,
    /// Mesh mode to use for far chunks that are still visible.
    pub low_detail_mode: MeshMode,
}

impl Default for LodSettings {
    fn default() -> Self {
        Self {
            high_detail_distance: DEFAULT_HIGH_DETAIL_DISTANCE,
            cull_distance: DEFAULT_CULL_DISTANCE,
            // Use Surface Nets for low LOD too - eliminates harsh visual transition
            // between smooth terrain and blocky chunks at LOD boundaries
            low_detail_mode: MeshMode::SurfaceNets,
        }
    }
}

impl LodSettings {
    fn minimum_valid_cull_distance(high_detail_distance: f32) -> f32 {
        high_detail_distance + terrain_lod_hysteresis_for(high_detail_distance) * 4.0 + 1.0
    }

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

fn visual_surface_nets_lod(lod_level: LodLevel) -> LodLevel {
    match lod_level {
        LodLevel::Lod3 => LodLevel::Lod2,
        other => other,
    }
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

pub(crate) fn forensics_forced_lod(forensics: Option<&BenchForensicsConfig>) -> Option<LodLevel> {
    let forensics = forensics.filter(|config| config.enabled)?;
    match forensics.terrain_lod {
        BenchForensicsTerrainLod::Auto => None,
        BenchForensicsTerrainLod::AllLod0 => Some(LodLevel::Lod0),
        BenchForensicsTerrainLod::AllLod1 => Some(LodLevel::Lod1),
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

fn lod_level_from_index(index: u8) -> LodLevel {
    match index {
        0 => LodLevel::Lod0,
        1 => LodLevel::Lod1,
        2 => LodLevel::Lod2,
        _ => LodLevel::Lod3,
    }
}

/// Enforce that no two face-adjacent chunks have LOD indices differing by
/// more than 1 by refining the coarser side of violating boundaries. Returns
/// the set of chunks whose `desired` LOD was modified by this pass; pass-3
/// uses it to bypass the LOD-change cooldown for these coherence-mandated
/// changes (otherwise forced refinements sit blocked for 30 frames during
/// camera motion, leaving transient LOD deltas of 2+ that MC+Transvoxel
/// cannot bridge).
pub(crate) fn enforce_lod_delta_max_one(desired: &mut HashMap<IVec3, LodLevel>) -> HashSet<IVec3> {
    const FACE_OFFSETS: [IVec3; 6] = [
        IVec3::new(1, 0, 0),
        IVec3::new(-1, 0, 0),
        IVec3::new(0, 1, 0),
        IVec3::new(0, -1, 0),
        IVec3::new(0, 0, 1),
        IVec3::new(0, 0, -1),
    ];
    let mut forced: HashSet<IVec3> = HashSet::new();
    for _ in 0..6 {
        let mut updates: HashMap<IVec3, LodLevel> = HashMap::new();
        for (chunk_pos, &lod) in desired.iter() {
            let Some(my_idx) = lod.lod_index() else {
                continue;
            };
            for offset in FACE_OFFSETS {
                let Some(&neighbor_lod) = desired.get(&(*chunk_pos + offset)) else {
                    continue;
                };
                let Some(neighbor_idx) = neighbor_lod.lod_index() else {
                    continue;
                };
                if my_idx <= neighbor_idx + 1 {
                    continue;
                }
                let target = lod_level_from_index(neighbor_idx + 1);
                updates
                    .entry(*chunk_pos)
                    .and_modify(|existing| {
                        if target.is_higher_detail_than(*existing) {
                            *existing = target;
                        }
                    })
                    .or_insert(target);
            }
        }
        if updates.is_empty() {
            break;
        }
        for (pos, lod) in updates {
            desired.insert(pos, lod);
            forced.insert(pos);
        }
    }
    forced
}

pub(crate) fn target_terrain_mesh_mode_for_lod(
    lod_level: LodLevel,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> MeshMode {
    match lod_level {
        LodLevel::Lod0 => mesh_settings.mode,
        LodLevel::Lod1 | LodLevel::Lod2 | LodLevel::Lod3 | LodLevel::Culled => {
            lod_settings.low_detail_mode
        }
    }
}

pub(crate) fn mesh_lod_level_for_surface_nets_cap(
    target_mode: MeshMode,
    uniformity: ChunkUniformity,
    empty_surface_neighbor: bool,
    lod_level: LodLevel,
) -> LodLevel {
    let mesh_lod_level = if matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
        && uniformity == ChunkUniformity::Empty
        && empty_surface_neighbor
    {
        LodLevel::Lod0
    } else {
        lod_level
    };

    if matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel) {
        visual_surface_nets_lod(mesh_lod_level)
    } else {
        mesh_lod_level
    }
}

pub(crate) fn transition_refined_surface_nets_lod(
    target_mode: MeshMode,
    mesh_lod_level: LodLevel,
    neighbor_lods: NeighborLods,
) -> LodLevel {
    if target_mode != MeshMode::SurfaceNets || mesh_lod_level != LodLevel::Lod1 {
        return mesh_lod_level;
    }

    let touches_lod0_neighbor = [
        neighbor_lods.neg_x,
        neighbor_lods.pos_x,
        neighbor_lods.neg_y,
        neighbor_lods.pos_y,
        neighbor_lods.neg_z,
        neighbor_lods.pos_z,
    ]
    .into_iter()
    .flatten()
    .any(|lod| lod == LodLevel::Lod0);

    if touches_lod0_neighbor {
        LodLevel::Lod0
    } else {
        mesh_lod_level
    }
}

fn base_effective_terrain_mesh_lod_for_chunk(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> Option<LodLevel> {
    let chunk = world.get_chunk(chunk_pos)?;
    let lod_level = chunk.lod_level();

    if lod_level == LodLevel::Culled {
        return Some(LodLevel::Culled);
    }

    let target_mode = target_terrain_mesh_mode_for_lod(lod_level, mesh_settings, lod_settings);
    let empty_surface_neighbor = chunk.uniformity() == ChunkUniformity::Empty
        && matches!(target_mode, MeshMode::SurfaceNets)
        && empty_chunk_has_surface_nets_boundary_surface(world, chunk_pos);

    Some(mesh_lod_level_for_surface_nets_cap(
        target_mode,
        chunk.uniformity(),
        empty_surface_neighbor,
        lod_level,
    ))
}

pub(crate) fn effective_terrain_mesh_lod_for_chunk(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> Option<LodLevel> {
    let chunk = world.get_chunk(chunk_pos)?;
    let lod_level = chunk.lod_level();
    let base_lod =
        base_effective_terrain_mesh_lod_for_chunk(world, chunk_pos, mesh_settings, lod_settings)?;
    if base_lod == LodLevel::Culled {
        return Some(base_lod);
    }

    let target_mode = target_terrain_mesh_mode_for_lod(lod_level, mesh_settings, lod_settings);
    let base_neighbor_lods =
        build_base_terrain_neighbor_lods(world, chunk_pos, mesh_settings, lod_settings);
    Some(transition_refined_surface_nets_lod(
        target_mode,
        base_lod,
        base_neighbor_lods,
    ))
}

pub(crate) fn build_base_terrain_neighbor_lods(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> NeighborLods {
    NeighborLods {
        neg_x: base_effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(-1, 0, 0),
            mesh_settings,
            lod_settings,
        ),
        pos_x: base_effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(1, 0, 0),
            mesh_settings,
            lod_settings,
        ),
        neg_y: base_effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, -1, 0),
            mesh_settings,
            lod_settings,
        ),
        pos_y: base_effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 1, 0),
            mesh_settings,
            lod_settings,
        ),
        neg_z: base_effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 0, -1),
            mesh_settings,
            lod_settings,
        ),
        pos_z: base_effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 0, 1),
            mesh_settings,
            lod_settings,
        ),
    }
}

pub(crate) fn build_terrain_neighbor_lods(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
) -> NeighborLods {
    NeighborLods {
        neg_x: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(-1, 0, 0),
            mesh_settings,
            lod_settings,
        ),
        pos_x: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(1, 0, 0),
            mesh_settings,
            lod_settings,
        ),
        neg_y: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, -1, 0),
            mesh_settings,
            lod_settings,
        ),
        pos_y: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 1, 0),
            mesh_settings,
            lod_settings,
        ),
        neg_z: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 0, -1),
            mesh_settings,
            lod_settings,
        ),
        pos_z: effective_terrain_mesh_lod_for_chunk(
            world,
            chunk_pos + IVec3::new(0, 0, 1),
            mesh_settings,
            lod_settings,
        ),
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
        LodLevel::Lod0 => TerrainMaterialQuality::FullTriplanar,
        LodLevel::Lod1 | LodLevel::Lod2 => TerrainMaterialQuality::CheapTriplanar,
        LodLevel::Lod3 | LodLevel::Culled => TerrainMaterialQuality::HorizonProxy,
    }
}

/// Runtime hysteresis for terrain LOD switching. Scales down with
/// `high_detail_distance` so a small near-band doesn't trap chunks at low LOD,
/// and is hard-capped at 8 voxels so transitions can never stretch beyond half
/// a chunk's worth of distance.
pub(crate) fn terrain_lod_hysteresis(settings: &LodSettings) -> f32 {
    terrain_lod_hysteresis_for(settings.high_detail_distance)
}

pub(crate) fn terrain_lod_hysteresis_for(high_detail_distance: f32) -> f32 {
    TERRAIN_LOD_HYSTERESIS
        .min(high_detail_distance * 0.25)
        .min(8.0)
}

/// Calculates the target LOD level with hysteresis to prevent rapid switching.
///
/// The target is the distance band directly â€” a chunk that loads far away
/// reaches Lod2/Lod3 in a single update instead of climbing one rung per
/// update. The old one-rung state machine, combined with the per-update change
/// cap, left distant chunks stuck at Lod0/Lod1.
///
/// Hysteresis is asymmetric: upgrades to higher detail fire eagerly (no `-h`
/// buffer) so a chunk that crosses a near threshold sharpens immediately.
/// Coarsening still needs to exceed `threshold + h` to prevent flip-flopping.
pub(crate) fn calculate_target_lod_with_hysteresis(
    distance: f32,
    current_lod: LodLevel,
    settings: &LodSettings,
) -> LodLevel {
    debug_assert!(
        settings.has_valid_distance_bands(),
        "LOD settings require cull_distance ({}) > high_detail_distance ({}) + 4 * TERRAIN_LOD_HYSTERESIS ({})",
        settings.cull_distance,
        settings.high_detail_distance,
        TERRAIN_LOD_HYSTERESIS
    );

    let h = terrain_lod_hysteresis(settings);

    // Distance thresholds for LOD transitions.
    // Lod0: 0 to high_detail_distance
    // Lod1: high_detail_distance to lod1_distance (midpoint to normal cull)
    // Lod2: lod1_distance to lod2_distance
    // Lod3: lod2_distance through the horizon proxy band
    // Culled: beyond the horizon proxy band
    let lod1_distance = (settings.high_detail_distance + settings.cull_distance) * 0.5;
    let lod2_distance = lod1_distance + (settings.cull_distance - lod1_distance) * 0.5;
    let horizon_cull_distance = horizon_proxy_cull_distance(settings);

    // Coarsening thresholds: Lod0|1 at high_detail_distance, Lod1|2 at
    // lod1_distance, Lod2|3 at lod2_distance, Lod3|Culled after the horizon
    // proxy band. `settings.cull_distance` is now the start of the cheap
    // horizon band, not the first distance where terrain disappears.
    let thresholds = [
        settings.high_detail_distance,
        lod1_distance,
        lod2_distance,
        horizon_cull_distance,
    ];

    // Rank 0..=4 == Lod0..=Culled: how many coarsening thresholds `distance`
    // has cleared. `offset` shifts every threshold outward.
    let band = |offset: f32| -> u8 {
        thresholds
            .iter()
            .filter(|threshold| distance >= **threshold + offset)
            .count() as u8
    };

    // Asymmetric hysteresis: a chunk may sharpen eagerly (plain thresholds) but
    // only coarsens once it clears `threshold + h`. While the current LOD is
    // inside `[lazy, eager]` it is kept; outside it the chunk jumps straight to
    // the correct band â€” so a freshly loaded distant chunk reaches Lod2/Lod3 in
    // one update instead of one rung per update.
    let eager = band(0.0);
    let lazy = band(h);
    let current_rank = 4 - current_lod.detail_value();
    let target_rank = current_rank.clamp(lazy, eager);

    match target_rank {
        0 => LodLevel::Lod0,
        1 => LodLevel::Lod1,
        2 => LodLevel::Lod2,
        3 => LodLevel::Lod3,
        _ => LodLevel::Culled,
    }
}

fn horizon_proxy_cull_distance(settings: &LodSettings) -> f32 {
    settings.cull_distance + HORIZON_PROXY_BAND_DISTANCE
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
        // Softer ring: a diamond of L1 radius 2 in XZ around each water chunk, plus
        // one Y layer above/below. Prevents isolated lower-LOD islands at the
        // shoreline where SDF averaging diverges most.
        for dy in -1..=1 {
            for dz in -2i32..=2 {
                for dx in -2i32..=2 {
                    if dx.abs() + dz.abs() > 2 {
                        continue;
                    }
                    chunks.insert(*chunk_pos + IVec3::new(dx, dy, dz));
                }
            }
        }
    }
    // Any chunk whose Y range straddles the waterline is fragile even without
    // liquid voxels inside it; guard those too.
    for (chunk_pos, _) in world.chunk_entries() {
        if chunk_layer_intersects_waterline(*chunk_pos) {
            chunks.insert(*chunk_pos);
        }
    }
    chunks
}

pub(crate) fn max_lod_for_face_neighbor(neighbor_lod: LodLevel) -> LodLevel {
    match neighbor_lod {
        LodLevel::Lod0 => LodLevel::Lod1,
        LodLevel::Lod1 => LodLevel::Lod2,
        LodLevel::Lod2 => LodLevel::Lod3,
        LodLevel::Lod3 | LodLevel::Culled => LodLevel::Culled,
    }
}

pub(crate) fn lod_upgrade_for_face_neighbor_coherence(
    lod: LodLevel,
    neighbor_lod: LodLevel,
) -> Option<LodLevel> {
    let max_lod = max_lod_for_face_neighbor(neighbor_lod);
    lod.is_lower_detail_than(max_lod).then_some(max_lod)
}

pub(crate) fn chunk_layer_intersects_waterline(chunk_pos: IVec3) -> bool {
    let min_y = chunk_pos.y * CHUNK_SIZE_I32;
    let max_y = min_y + CHUNK_SIZE_I32 - 1;
    WATER_LEVEL >= min_y - 2 && WATER_LEVEL <= max_y + 2
}

pub(crate) fn chunk_contains_liquid(chunk: &Chunk) -> bool {
    for z in 0..CHUNK_SIZE {
        for y in 0..CHUNK_SIZE {
            for x in 0..CHUNK_SIZE {
                if chunk
                    .get(UVec3::new(x as u32, y as u32, z as u32))
                    .is_liquid()
                {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn water_shore_guarded_lod(
    target_lod: LodLevel,
    distance: f32,
    settings: &LodSettings,
    water_shore_guarded: bool,
) -> LodLevel {
    if !water_shore_guarded || target_lod == LodLevel::Culled {
        return target_lod;
    }

    let guard_distance = settings.high_detail_distance + WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA;
    if distance <= guard_distance {
        LodLevel::Lod0
    } else {
        target_lod
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{
        CHUNK_VOLUME, INTEGRATED_GPU_CULL_DISTANCE, INTEGRATED_GPU_HIGH_DETAIL_DISTANCE,
    };
    use crate::voxel::types::VoxelType;

    fn assert_face_lod_deltas_le_one(desired: &HashMap<IVec3, LodLevel>) {
        const FACE_OFFSETS: [IVec3; 3] = [
            IVec3::new(1, 0, 0),
            IVec3::new(0, 1, 0),
            IVec3::new(0, 0, 1),
        ];

        for (pos, lod) in desired {
            let Some(lod_idx) = lod.lod_index() else {
                continue;
            };
            for offset in FACE_OFFSETS {
                let Some(neighbor) = desired.get(&(*pos + offset)) else {
                    continue;
                };
                let Some(neighbor_idx) = neighbor.lod_index() else {
                    continue;
                };
                assert!(
                    lod_idx.abs_diff(neighbor_idx) <= 1,
                    "expected face-adjacent delta <= 1 for {pos:?} and {:?}, got {lod_idx} vs {neighbor_idx}",
                    *pos + offset
                );
            }
        }
    }

    #[test]
    fn surface_nets_transition_mesh_lod_refines_to_finer_neighbor() {
        let neighbor_lods = NeighborLods {
            pos_x: Some(LodLevel::Lod0),
            neg_z: Some(LodLevel::Lod2),
            ..Default::default()
        };

        assert_eq!(
            transition_refined_surface_nets_lod(
                MeshMode::SurfaceNets,
                LodLevel::Lod1,
                neighbor_lods,
            ),
            LodLevel::Lod0
        );
        assert_eq!(
            transition_refined_surface_nets_lod(MeshMode::Blocky, LodLevel::Lod1, neighbor_lods),
            LodLevel::Lod1
        );
        assert_eq!(
            transition_refined_surface_nets_lod(
                MeshMode::SurfaceNets,
                LodLevel::Lod2,
                NeighborLods {
                    pos_x: Some(LodLevel::Lod1),
                    ..Default::default()
                },
            ),
            LodLevel::Lod2
        );
        assert_eq!(
            transition_refined_surface_nets_lod(
                MeshMode::SurfaceNets,
                LodLevel::Lod1,
                NeighborLods {
                    pos_x: Some(LodLevel::Culled),
                    ..Default::default()
                },
            ),
            LodLevel::Lod1
        );
    }

    /// `enforce_lod_delta_max_one` must (a) clamp deltas to 1 and (b) return
    /// the chunks it touched so pass-3 can bypass the LOD-change cooldown for
    /// those coherence-forced refinements. Without (b), the bumps sit blocked
    /// for 30 frames while the user walks, leaving the LOD0-LOD2 deltas the
    /// MC+Transvoxel apron can't bridge.
    #[test]
    fn enforce_lod_delta_max_one_returns_modified_chunks() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        desired.insert(IVec3::ZERO, LodLevel::Lod0);
        desired.insert(IVec3::new(1, 0, 0), LodLevel::Lod2);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert_face_lod_deltas_le_one(&desired);

        assert!(
            !forced.is_empty(),
            "enforce_lod_delta_max_one must report which chunks it modified"
        );
        // The modified chunk's desired LOD must differ from its starting LOD.
        let initial: HashMap<IVec3, LodLevel> = [
            (IVec3::ZERO, LodLevel::Lod0),
            (IVec3::new(1, 0, 0), LodLevel::Lod2),
        ]
        .into_iter()
        .collect();
        for pos in &forced {
            assert_ne!(
                desired[pos], initial[pos],
                "chunk reported as forced ({pos:?}) but its LOD is unchanged"
            );
        }
    }

    #[test]
    fn enforce_lod_delta_max_one_refines_coarser_side_only() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        let fine = IVec3::ZERO;
        let coarse = IVec3::new(1, 0, 0);
        desired.insert(fine, LodLevel::Lod0);
        desired.insert(coarse, LodLevel::Lod2);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert_eq!(
            desired[&fine],
            LodLevel::Lod0,
            "max-one enforcement must not coarsen the high-detail side"
        );
        assert_eq!(
            desired[&coarse],
            LodLevel::Lod1,
            "coarser neighbor should refine to the only bridgeable LOD"
        );
        assert_eq!(
            forced,
            HashSet::from([coarse]),
            "only the refined coarse chunk should bypass the cooldown"
        );
        assert_face_lod_deltas_le_one(&desired);
    }

    #[test]
    fn enforce_lod_delta_max_one_propagates_refinements_across_chain() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        let lod0 = IVec3::ZERO;
        let lod3_a = IVec3::new(1, 0, 0);
        let lod3_b = IVec3::new(2, 0, 0);
        desired.insert(lod0, LodLevel::Lod0);
        desired.insert(lod3_a, LodLevel::Lod3);
        desired.insert(lod3_b, LodLevel::Lod3);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert_eq!(desired[&lod0], LodLevel::Lod0);
        assert_eq!(desired[&lod3_a], LodLevel::Lod1);
        assert_eq!(desired[&lod3_b], LodLevel::Lod2);
        assert_eq!(forced, HashSet::from([lod3_a, lod3_b]));
        assert_face_lod_deltas_le_one(&desired);
    }

    #[test]
    fn enforce_lod_delta_max_one_no_modifications_returns_empty_set() {
        let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
        desired.insert(IVec3::ZERO, LodLevel::Lod0);
        desired.insert(IVec3::new(1, 0, 0), LodLevel::Lod1);

        let forced = enforce_lod_delta_max_one(&mut desired);

        assert!(
            forced.is_empty(),
            "delta=1 fixture must not trigger any modifications"
        );
    }

    #[test]
    fn terrain_lod_hysteresis_caps_at_eight_voxels() {
        // At any practical high_detail_distance the runtime hysteresis is capped
        // at 8 voxels so a single LOD band can never exceed half a chunk.
        assert_eq!(terrain_lod_hysteresis_for(176.0), 8.0);
        assert_eq!(terrain_lod_hysteresis_for(1_000.0), 8.0);
    }

    #[test]
    fn terrain_lod_hysteresis_scales_down_for_small_distances() {
        // Below ~32 voxels the cap shrinks: hd * 0.25 dominates so the cap
        // never overruns the high-detail band itself.
        assert_eq!(terrain_lod_hysteresis_for(16.0), 4.0);
        assert_eq!(terrain_lod_hysteresis_for(8.0), 2.0);
        assert_eq!(terrain_lod_hysteresis_for(0.0), 0.0);
    }

    #[test]
    fn lod1_upgrades_eagerly_without_hysteresis_buffer() {
        // Asymmetric thresholds: Lod0 -> Lod1 still needs the buffer, but
        // Lod1 -> Lod0 snaps back the instant the chunk enters the high-detail
        // band. This prevents isolated lower-LOD islands near the camera.
        let settings = LodSettings::default();
        let h = terrain_lod_hysteresis(&settings);

        assert!(h > 0.0, "test pre-condition: hysteresis must be > 0");

        // Just outside hd-h: previously this kept Lod1, now upgrades.
        let just_inside = settings.high_detail_distance - 0.1;
        assert_eq!(
            calculate_target_lod_with_hysteresis(just_inside, LodLevel::Lod1, &settings),
            LodLevel::Lod0
        );

        // Exactly at hd: also upgrades (strict-less compare against hd).
        let at_threshold = settings.high_detail_distance;
        assert_eq!(
            calculate_target_lod_with_hysteresis(at_threshold, LodLevel::Lod1, &settings),
            LodLevel::Lod1
        );

        // Lod0 -> Lod1 downgrade still requires the full hysteresis buffer.
        let just_past_with_buffer = settings.high_detail_distance + h + 0.1;
        assert_eq!(
            calculate_target_lod_with_hysteresis(just_past_with_buffer, LodLevel::Lod0, &settings),
            LodLevel::Lod1
        );
        let in_buffer = settings.high_detail_distance + h - 0.1;
        assert_eq!(
            calculate_target_lod_with_hysteresis(in_buffer, LodLevel::Lod0, &settings),
            LodLevel::Lod0
        );
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

        // `has_valid_distance_bands` is a strict-greater check, so the
        // exact threshold value is rejected.
        assert!(!settings.has_valid_distance_bands());

        settings.clamp_distance_bands();

        assert!(settings.has_valid_distance_bands());
        assert!(
            settings.cull_distance
                > settings.high_detail_distance
                    + terrain_lod_hysteresis_for(settings.high_detail_distance) * 4.0
        );
    }

    #[test]
    fn water_shore_lod_guard_keeps_water_chunk_and_neighbors_high_detail() {
        let settings = LodSettings::default();

        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Lod2,
                settings.high_detail_distance + WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA - 1.0,
                &settings,
                true,
            ),
            LodLevel::Lod0
        );
        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Lod2,
                settings.high_detail_distance + WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA + 1.0,
                &settings,
                true,
            ),
            LodLevel::Lod2
        );
        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Lod2,
                settings.high_detail_distance,
                &settings,
                false
            ),
            LodLevel::Lod2
        );
        assert_eq!(
            water_shore_guarded_lod(
                LodLevel::Culled,
                settings.high_detail_distance,
                &settings,
                true
            ),
            LodLevel::Culled
        );
    }

    #[test]
    fn lod_coherence_rejects_multi_step_face_jumps() {
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod2, LodLevel::Lod0),
            Some(LodLevel::Lod1)
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod3, LodLevel::Lod1),
            Some(LodLevel::Lod2)
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Culled, LodLevel::Lod2),
            Some(LodLevel::Lod3)
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod1, LodLevel::Lod0),
            None
        );
        assert_eq!(
            lod_upgrade_for_face_neighbor_coherence(LodLevel::Lod0, LodLevel::Lod2),
            None
        );
    }

    #[test]
    fn water_shore_lod_guard_marks_diamond_ring_with_y_neighbors() {
        let center = IVec3::new(2, 1, 2);
        let mut world = VoxelWorld::new(IVec3::new(5, 3, 5));
        let mut chunk = Chunk::new(center);
        chunk.set(UVec3::new(8, 8, 8), VoxelType::Water);
        world.insert_chunk(chunk);

        let guarded = collect_water_shore_lod_guard_chunks(&world);

        // Radius-0 and radius-1 cross.
        assert!(guarded.contains(&center));
        assert!(guarded.contains(&(center + IVec3::X)));
        assert!(guarded.contains(&(center + IVec3::NEG_X)));
        assert!(guarded.contains(&(center + IVec3::Z)));
        assert!(guarded.contains(&(center + IVec3::NEG_Z)));
        // Diagonal neighbours (|dx|+|dz|=2) are inside the L1 diamond.
        assert!(guarded.contains(&(center + IVec3::new(1, 0, 1))));
        assert!(guarded.contains(&(center + IVec3::new(-1, 0, -1))));
        // Radius-2 cross is inside the diamond.
        assert!(guarded.contains(&(center + IVec3::new(2, 0, 0))));
        assert!(guarded.contains(&(center + IVec3::new(0, 0, -2))));
        // Outside the diamond (|dx|+|dz|=3) is NOT guarded.
        assert!(!guarded.contains(&(center + IVec3::new(2, 0, 1))));
        // One Y layer above/below IS guarded â€” softens vertical transitions
        // where shoreline geometry straddles a chunk Y boundary.
        assert!(guarded.contains(&(center + IVec3::Y)));
        assert!(guarded.contains(&(center + IVec3::NEG_Y)));
        // Two Y layers away is NOT guarded.
        assert!(!guarded.contains(&(center + IVec3::new(0, 2, 0))));
    }

    #[test]
    fn waterline_chunk_layer_is_guarded_without_liquid_voxels() {
        // Chunk at y=1 spans world Y=16..31; WATER_LEVEL=18 sits in that range.
        let chunk_pos = IVec3::new(0, 1, 0);
        assert!(chunk_layer_intersects_waterline(chunk_pos));

        let mut world = VoxelWorld::new(IVec3::new(1, 3, 1));
        let chunk = Chunk::new(chunk_pos);
        // No liquid voxels.
        world.insert_chunk(chunk);

        let guarded = collect_water_shore_lod_guard_chunks(&world);
        assert!(guarded.contains(&chunk_pos));
    }

    #[test]
    fn surface_nets_mesh_defers_when_in_bounds_halo_is_missing() {
        assert!(should_defer_surface_nets_mesh(MeshMode::SurfaceNets, 1));
        assert!(!should_defer_surface_nets_mesh(MeshMode::SurfaceNets, 0));
        assert!(!should_defer_surface_nets_mesh(MeshMode::Blocky, 1));
    }

    #[test]
    fn empty_surface_nets_cap_forces_lod0_sampling() {
        assert_eq!(
            mesh_lod_level_for_surface_nets_cap(
                MeshMode::SurfaceNets,
                ChunkUniformity::Empty,
                true,
                LodLevel::Lod3
            ),
            LodLevel::Lod0
        );
        assert_eq!(
            mesh_lod_level_for_surface_nets_cap(
                MeshMode::SurfaceNets,
                ChunkUniformity::Mixed,
                true,
                LodLevel::Lod3
            ),
            LodLevel::Lod2
        );
        assert_eq!(
            mesh_lod_level_for_surface_nets_cap(
                MeshMode::Blocky,
                ChunkUniformity::Empty,
                true,
                LodLevel::Lod3
            ),
            LodLevel::Lod3
        );
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
    fn neighbor_lods_use_effective_lod_for_empty_surface_nets_caps() {
        let mut world = VoxelWorld::new(IVec3::new(1, 2, 1));
        world.insert_chunk(Chunk::with_voxels(
            IVec3::ZERO,
            [VoxelType::Rock; CHUNK_VOLUME],
        ));
        world.insert_chunk(Chunk::new(IVec3::Y));
        world
            .get_chunk_mut(IVec3::Y)
            .unwrap()
            .set_lod_level(LodLevel::Lod3);

        let mesh_settings = MeshSettings {
            mode: MeshMode::SurfaceNets,
            ..Default::default()
        };
        let lod_settings = LodSettings::default();

        assert_eq!(
            world.get_chunk(IVec3::Y).unwrap().lod_level(),
            LodLevel::Lod3
        );
        assert_eq!(
            build_terrain_neighbor_lods(&world, IVec3::ZERO, &mesh_settings, &lod_settings).pos_y,
            Some(LodLevel::Lod0)
        );
    }

}
