use avian3d::prelude::LinearVelocity;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy_tnua::builtins::{TnuaBuiltinJumpConfig, TnuaBuiltinWalkConfig};

use super::{PlayerBundle, PlayerConfig, PlayerMovementSchemeConfig};
use crate::constants::{DEFAULT_WORLD_CHUNKS_X, DEFAULT_WORLD_CHUNKS_Y, DEFAULT_WORLD_CHUNKS_Z};
use crate::performance::AreaTimingRecorder;
use crate::physics::{ChunkCollider, NeedsCollider, TerrainCollisionCache};
use crate::rendering::water_displacement::WaterImpulseSource;
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld, WorldBounds};

const SPAWN_HEADROOM_BLOCKS: i32 = 3;
const SPAWN_RING_STEP: i32 = 4;
const SPAWN_MAX_RADIUS: i32 = 160;
const INITIAL_SPAWN_WAIT_LOG_FRAMES: u32 = 300;
const LAST_SAFE_VERTICAL_TOLERANCE: f32 = 1.75;
const GROUND_GUARD_HEIGHT_TOLERANCE: f32 = 2.75;
const GROUND_GUARD_LOG_INTERVAL_FRAMES: u32 = 60;
const GROUND_GUARD_RECOVERY_DELAY_FRAMES: u32 = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ValidSpawnLocation {
    pub position: Vec3,
    pub surface_block: IVec3,
    pub player_block: IVec3,
    pub chunk_pos: IVec3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpawnRejectReason {
    OutsideHorizontalWorld,
    BelowWorldFloor,
    MissingChunk,
    Underground,
    Water,
    NoHeadroom,
    NoSurface,
    ColliderNotReady,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlayerWorldValidity {
    InValidWorld,
    BelowFloor,
    OutsideHorizontalBounds,
    InsideMissingChunk,
    UndergroundInvalidSpawn,
}

impl PlayerWorldValidity {
    pub fn label(self) -> &'static str {
        match self {
            Self::InValidWorld => "In Valid World",
            Self::BelowFloor => "Below Floor",
            Self::OutsideHorizontalBounds => "Outside Horizontal Bounds",
            Self::InsideMissingChunk => "Inside Missing Chunk",
            Self::UndergroundInvalidSpawn => "Underground Invalid Spawn",
        }
    }

    pub fn invalid_reason(self) -> Option<&'static str> {
        match self {
            Self::InValidWorld => None,
            Self::BelowFloor => Some("position is below the valid world floor"),
            Self::OutsideHorizontalBounds => Some("x/z are outside horizontal world bounds"),
            Self::InsideMissingChunk => Some("position samples a missing chunk inside bounds"),
            Self::UndergroundInvalidSpawn => {
                Some("position is not on a valid playable surface or is below terrain crust")
            }
        }
    }

    pub fn is_valid(self) -> bool {
        matches!(self, Self::InValidWorld)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SpawnValidationReport {
    pub candidates_tested: u64,
    pub rejected_underground: u64,
    pub rejected_water: u64,
    pub rejected_missing_chunk: u64,
    pub rejected_no_headroom: u64,
    pub rejected_collider_not_ready: u64,
    pub rejected_other: u64,
    pub accepted: u64,
}

impl SpawnValidationReport {
    pub fn record(&mut self, result: Result<ValidSpawnLocation, SpawnRejectReason>) {
        self.candidates_tested += 1;
        match result {
            Ok(_) => self.accepted += 1,
            Err(SpawnRejectReason::Underground) => self.rejected_underground += 1,
            Err(SpawnRejectReason::Water) => self.rejected_water += 1,
            Err(SpawnRejectReason::MissingChunk) => self.rejected_missing_chunk += 1,
            Err(SpawnRejectReason::NoHeadroom) => self.rejected_no_headroom += 1,
            Err(SpawnRejectReason::ColliderNotReady) => self.rejected_collider_not_ready += 1,
            Err(_) => self.rejected_other += 1,
        }
    }
}

#[derive(Resource, Debug)]
pub struct PlayerSpawnState {
    pub initial_spawn_pending: bool,
    pub initial_spawn_wait_frames: u32,
    pub last_safe_grounded_position: Option<Vec3>,
    pub last_safe_ground_valid: bool,
    pub stats: SpawnValidationReport,
    pub void_recovery_terrain_fallbacks: u64,
    pub void_recoveries: u64,
    pub ground_guard_recoveries: u64,
    pub source_query_ground_fallbacks: u64,
    pub blocked_unknown_ground_frames: u64,
    pub last_ground_guard_log_frame: u32,
    pub invalid_ground_frames: u32,
}

impl Default for PlayerSpawnState {
    fn default() -> Self {
        Self {
            initial_spawn_pending: true,
            initial_spawn_wait_frames: 0,
            last_safe_grounded_position: None,
            last_safe_ground_valid: false,
            stats: SpawnValidationReport::default(),
            void_recovery_terrain_fallbacks: 0,
            void_recoveries: 0,
            ground_guard_recoveries: 0,
            source_query_ground_fallbacks: 0,
            blocked_unknown_ground_frames: 0,
            last_ground_guard_log_frame: 0,
            invalid_ground_frames: 0,
        }
    }
}

#[derive(Default)]
pub struct SpawnColliderReadiness {
    ready_chunks: std::collections::HashSet<IVec3>,
    pending_chunks: std::collections::HashSet<IVec3>,
    source_ready_chunks: std::collections::HashSet<IVec3>,
}

impl SpawnColliderReadiness {
    pub fn from_chunk_meshes<'a>(
        chunks: impl Iterator<
            Item = (
                &'a ChunkMesh,
                Option<&'a ChunkCollider>,
                Option<&'a NeedsCollider>,
            ),
        >,
    ) -> Self {
        let mut readiness = Self::default();
        for (chunk_mesh, collider, needs_collider) in chunks {
            if collider.is_some() && needs_collider.is_none() {
                readiness.ready_chunks.insert(chunk_mesh.chunk_position);
            } else if needs_collider.is_some() {
                readiness.pending_chunks.insert(chunk_mesh.chunk_position);
            }
        }
        readiness
    }

    pub fn from_chunk_meshes_with_cache<'a>(
        chunks: impl Iterator<
            Item = (
                &'a ChunkMesh,
                Option<&'a ChunkCollider>,
                Option<&'a NeedsCollider>,
            ),
        >,
        cache: &TerrainCollisionCache,
    ) -> Self {
        let mut readiness = Self::from_chunk_meshes(chunks);
        let observed_chunks: Vec<IVec3> = readiness
            .ready_chunks
            .iter()
            .chain(readiness.pending_chunks.iter())
            .copied()
            .collect();
        for chunk in observed_chunks {
            if cache.get(chunk).is_some() {
                readiness.source_ready_chunks.insert(chunk);
            }
        }
        readiness
    }

    fn is_chunk_ready(&self, chunk_pos: IVec3) -> bool {
        self.ready_chunks.contains(&chunk_pos) && !self.pending_chunks.contains(&chunk_pos)
    }

    fn is_chunk_source_ready(&self, chunk_pos: IVec3) -> bool {
        self.is_chunk_ready(chunk_pos) || self.source_ready_chunks.contains(&chunk_pos)
    }
}

/// Spawn the player at game start.
pub fn spawn_player(
    mut commands: Commands,
    config: Res<PlayerConfig>,
    mut movement_configs: ResMut<Assets<PlayerMovementSchemeConfig>>,
) {
    // Spawn at the center of the world map
    let bounds = WorldBounds::from_size_chunks(IVec3::new(
        DEFAULT_WORLD_CHUNKS_X,
        DEFAULT_WORLD_CHUNKS_Y,
        DEFAULT_WORLD_CHUNKS_Z,
    ));
    let world_center_x = (bounds.horizontal_min.x + bounds.horizontal_max.x) as f32 * 0.5;
    let world_center_z = (bounds.horizontal_min.y + bounds.horizontal_max.y) as f32 * 0.5;
    let spawn_position = Vec3::new(
        world_center_x,
        bounds.max_world_y as f32 + 4.0,
        world_center_z,
    );
    let movement_config = movement_configs.add(PlayerMovementSchemeConfig {
        basis: TnuaBuiltinWalkConfig {
            // Feed speed directly through desired_motion each frame.
            speed: 1.0,
            float_height: config.float_height,
            cling_distance: 1.0,
            max_slope: std::f32::consts::FRAC_PI_3,
            ..default()
        },
        jump: TnuaBuiltinJumpConfig {
            height: config.jump_height,
            ..default()
        },
    });
    commands.spawn((
        PlayerBundle::new(spawn_position, config.clone(), movement_config),
        // Player creates water ripples when moving through water
        WaterImpulseSource::new(1.5, 0.3),
    ));
}

pub fn resolve_initial_player_spawn(
    world: Res<VoxelWorld>,
    cache: Res<TerrainCollisionCache>,
    mut state: ResMut<PlayerSpawnState>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    mut player_query: Query<(&mut Transform, Option<&mut LinearVelocity>), With<super::Player>>,
) {
    if !state.initial_spawn_pending {
        return;
    }

    let Ok((mut transform, velocity)) = player_query.single_mut() else {
        return;
    };

    let readiness =
        SpawnColliderReadiness::from_chunk_meshes_with_cache(collider_query.iter(), &cache);
    let center = world_center_xz(&world);
    freeze_player_at_standby(&world, &readiness, &mut transform, velocity);
    state.initial_spawn_wait_frames = state.initial_spawn_wait_frames.saturating_add(1);

    match find_nearest_valid_spawn(&world, center, &readiness, true, &mut state.stats) {
        Some(spawn) => {
            transform.translation = spawn.position;
            state.last_safe_grounded_position = Some(spawn.position);
            state.last_safe_ground_valid = true;
            state.initial_spawn_pending = false;
            state.initial_spawn_wait_frames = 0;
            info!(
                "Initial player spawn resolved at {:?} on surface {:?}",
                spawn.position, spawn.surface_block
            );
        }
        None => {
            state.last_safe_ground_valid = false;
            if state.initial_spawn_wait_frames % INITIAL_SPAWN_WAIT_LOG_FRAMES == 0 {
                warn!(
                    "Initial player spawn is waiting for terrain colliders near {:?} ({} frames, collider rejections={})",
                    center,
                    state.initial_spawn_wait_frames,
                    state.stats.rejected_collider_not_ready
                );
            }
        }
    }
}

pub fn recover_player_from_void(
    world: Res<VoxelWorld>,
    cache: Res<TerrainCollisionCache>,
    mut state: ResMut<PlayerSpawnState>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    mut player_query: Query<(&mut Transform, Option<&mut LinearVelocity>), With<super::Player>>,
) {
    if state.initial_spawn_pending {
        return;
    }

    let Ok((mut transform, velocity)) = player_query.single_mut() else {
        return;
    };

    let bounds = world.bounds();
    let player_block = vec3_to_block(transform.translation);
    let outside_horizontal = !bounds.contains_horizontal(player_block);
    let below_kill_y = transform.translation.y < bounds.kill_y as f32;
    if !outside_horizontal && !below_kill_y {
        return;
    }

    let readiness =
        SpawnColliderReadiness::from_chunk_meshes_with_cache(collider_query.iter(), &cache);
    let collider_ready_recovery_target = find_collider_ready_recovery_target(
        &world,
        transform.translation.xz(),
        &readiness,
        state.last_safe_grounded_position,
        &mut state.stats,
    );

    let (recovery_target, used_terrain_only_fallback) =
        if let Some(spawn) = collider_ready_recovery_target {
            (Some(spawn), false)
        } else {
            let fallback_target = state
                .last_safe_grounded_position
                .and_then(|position| {
                    validate_existing_spawn_position(&world, position, &readiness, false).ok()
                })
                .or_else(|| {
                    find_nearest_valid_spawn(
                        &world,
                        transform.translation.xz(),
                        &readiness,
                        false,
                        &mut state.stats,
                    )
                })
                .or_else(|| {
                    find_nearest_valid_spawn(
                        &world,
                        world_center_xz(&world),
                        &readiness,
                        false,
                        &mut state.stats,
                    )
                });
            (fallback_target, fallback_target.is_some())
        };

    if let Some(spawn) = recovery_target {
        let reason = if below_kill_y {
            "below kill_y"
        } else {
            "outside horizontal world bounds"
        };
        teleport_player(&mut transform, velocity, spawn.position);
        state.void_recoveries += 1;
        if used_terrain_only_fallback {
            state.void_recovery_terrain_fallbacks += 1;
        }
        state.last_safe_grounded_position = Some(spawn.position);
        state.last_safe_ground_valid = true;
        warn!(
            "Void recovery ({reason}): moved player to {:?} on surface {:?}{}",
            spawn.position,
            spawn.surface_block,
            if used_terrain_only_fallback {
                " using terrain-only fallback"
            } else {
                ""
            }
        );
    } else {
        state.last_safe_ground_valid = false;
        warn!(
            "Void recovery needed at {:?}, but no valid spawn with ready collider was found",
            transform.translation
        );
    }
}

pub fn recover_player_from_invalid_ground(
    world: Res<VoxelWorld>,
    cache: Res<TerrainCollisionCache>,
    frame: Res<FrameCount>,
    mut state: ResMut<PlayerSpawnState>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    mut player_query: Query<(&mut Transform, Option<&mut LinearVelocity>), With<super::Player>>,
) {
    if state.initial_spawn_pending {
        return;
    }

    let Ok((mut transform, velocity)) = player_query.single_mut() else {
        return;
    };

    let readiness =
        SpawnColliderReadiness::from_chunk_meshes_with_cache(collider_query.iter(), &cache);
    let validity = classify_player_world_validity(&world, transform.translation);
    let surface_without_collider =
        validate_existing_spawn_position(&world, transform.translation, &readiness, false).ok();
    let falling_or_grounded = velocity.as_ref().map(|v| v.y <= 0.5).unwrap_or(true);
    let near_pending_ground = surface_without_collider.is_some_and(|surface| {
        !spawn_collider_ready(&readiness, surface.chunk_pos)
            && transform.translation.y <= surface.position.y + GROUND_GUARD_HEIGHT_TOLERANCE
            && falling_or_grounded
    });

    if validity.is_valid() {
        state.invalid_ground_frames = 0;
        if !near_pending_ground {
            return;
        }

        if let Some(surface) = surface_without_collider {
            clamp_player_to_source_support(&mut transform, velocity, surface.position);
            state.source_query_ground_fallbacks =
                state.source_query_ground_fallbacks.saturating_add(1);
            state.last_safe_grounded_position = Some(transform.translation);
            state.last_safe_ground_valid = true;
            return;
        }

        state.blocked_unknown_ground_frames = state.blocked_unknown_ground_frames.saturating_add(1);
    }

    if matches!(validity, PlayerWorldValidity::UndergroundInvalidSpawn) {
        state.invalid_ground_frames = state.invalid_ground_frames.saturating_add(1);
        if state.invalid_ground_frames < GROUND_GUARD_RECOVERY_DELAY_FRAMES {
            return;
        }
    } else {
        state.invalid_ground_frames = 0;
    }

    let recovery_target = find_collider_ready_recovery_target(
        &world,
        transform.translation.xz(),
        &readiness,
        state.last_safe_grounded_position,
        &mut state.stats,
    );

    if let Some(spawn) = recovery_target {
        let reason = if validity.is_valid() {
            "current ground collider is still pending"
        } else {
            validity.label()
        };
        let previous_position = transform.translation;
        teleport_player(&mut transform, velocity, spawn.position);
        state.ground_guard_recoveries += 1;
        state.invalid_ground_frames = 0;
        state.last_safe_grounded_position = Some(spawn.position);
        state.last_safe_ground_valid = true;

        let should_log = state.ground_guard_recoveries == 1
            || frame.0.saturating_sub(state.last_ground_guard_log_frame)
                >= GROUND_GUARD_LOG_INTERVAL_FRAMES;
        if should_log {
            state.last_ground_guard_log_frame = frame.0;
            warn!(
                "Ground guard recovery ({reason}): moved player from {:?} to {:?} on surface {:?}",
                previous_position, spawn.position, spawn.surface_block
            );
        }
    } else {
        state.last_safe_ground_valid = false;
        let should_log = frame.0.saturating_sub(state.last_ground_guard_log_frame)
            >= GROUND_GUARD_LOG_INTERVAL_FRAMES;
        if should_log {
            state.last_ground_guard_log_frame = frame.0;
            warn!(
                "Ground guard needed at {:?} ({:?}), but no collider-ready recovery target was found",
                transform.translation, validity
            );
        }
    }
}

pub fn track_last_safe_grounded_position(
    world: Res<VoxelWorld>,
    cache: Res<TerrainCollisionCache>,
    mut state: ResMut<PlayerSpawnState>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    player_query: Query<(&Transform, Option<&LinearVelocity>), With<super::Player>>,
) {
    if state.initial_spawn_pending {
        return;
    }

    let Ok((transform, velocity)) = player_query.single() else {
        state.last_safe_ground_valid = false;
        return;
    };

    if velocity.is_some_and(|v| v.y < -0.5) {
        state.last_safe_ground_valid = false;
        return;
    }

    let readiness =
        SpawnColliderReadiness::from_chunk_meshes_with_cache(collider_query.iter(), &cache);
    match validate_existing_spawn_position(&world, transform.translation, &readiness, false) {
        Ok(spawn)
            if (transform.translation.y - spawn.position.y).abs()
                <= LAST_SAFE_VERTICAL_TOLERANCE =>
        {
            state.last_safe_grounded_position = Some(transform.translation);
            state.last_safe_ground_valid = true;
        }
        _ => {
            state.last_safe_ground_valid = false;
        }
    }
}

pub fn record_spawn_diagnostics(
    world: Res<VoxelWorld>,
    state: Res<PlayerSpawnState>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    player_query: Query<&Transform, With<super::Player>>,
) {
    let validity = player_query
        .single()
        .ok()
        .map(|transform| classify_player_world_validity(&world, transform.translation));
    timing.record_count(
        frame.0,
        "Spawn Candidates Tested",
        state.stats.candidates_tested as f64,
    );
    timing.record_count(
        frame.0,
        "Spawn Candidates Rejected Underground",
        state.stats.rejected_underground as f64,
    );
    timing.record_count(
        frame.0,
        "Spawn Candidates Rejected Water",
        state.stats.rejected_water as f64,
    );
    timing.record_count(
        frame.0,
        "Spawn Candidates Rejected Missing Chunk",
        state.stats.rejected_missing_chunk as f64,
    );
    timing.record_count(
        frame.0,
        "Spawn Candidates Rejected No Headroom",
        state.stats.rejected_no_headroom as f64,
    );
    timing.record_count(
        frame.0,
        "Spawn Candidates Rejected Collider Not Ready",
        state.stats.rejected_collider_not_ready as f64,
    );
    timing.record_count(
        frame.0,
        "Initial Spawn Wait Frames",
        state.initial_spawn_wait_frames as f64,
    );
    timing.record_count(
        frame.0,
        "Void Recovery Terrain Fallbacks",
        state.void_recovery_terrain_fallbacks as f64,
    );
    timing.record_count(frame.0, "Void Recoveries", state.void_recoveries as f64);
    timing.record_count(
        frame.0,
        "Ground Guard Recoveries",
        state.ground_guard_recoveries as f64,
    );
    timing.record_count(
        frame.0,
        "Source Query Ground Fallbacks",
        state.source_query_ground_fallbacks as f64,
    );
    timing.record_count(
        frame.0,
        "Blocked Unknown Ground Frames",
        state.blocked_unknown_ground_frames as f64,
    );
    timing.record_count(
        frame.0,
        "Player Recovered From Void",
        state.void_recoveries as f64,
    );
    timing.record_count(
        frame.0,
        "Player In Invalid World Space",
        validity.is_some_and(|v| !v.is_valid()) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Player Below World Floor",
        validity.is_some_and(|v| v == PlayerWorldValidity::BelowFloor) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Player Outside World Bounds",
        validity.is_some_and(|v| v == PlayerWorldValidity::OutsideHorizontalBounds) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Player In Missing Chunk",
        validity.is_some_and(|v| v == PlayerWorldValidity::InsideMissingChunk) as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Last Safe Ground Valid",
        state.last_safe_ground_valid as u8 as f64,
    );
}

pub fn find_surface_spawn(
    world: &VoxelWorld,
    x: i32,
    z: i32,
    collider_readiness: &SpawnColliderReadiness,
    require_collider: bool,
) -> Result<ValidSpawnLocation, SpawnRejectReason> {
    let bounds = world.bounds();
    let column_pos = IVec3::new(x, bounds.min_breakable_y, z);
    if !bounds.contains_horizontal(column_pos) {
        return Err(SpawnRejectReason::OutsideHorizontalWorld);
    }

    let mut saw_air = false;
    for y in (bounds.min_breakable_y..=bounds.max_world_y).rev() {
        let pos = IVec3::new(x, y, z);
        match world.sample_voxel_for_interaction(pos) {
            VoxelSample::MissingChunkInsideBounds => return Err(SpawnRejectReason::MissingChunk),
            VoxelSample::OutsideBelowWorld => return Err(SpawnRejectReason::BelowWorldFloor),
            VoxelSample::OutsideHorizontalWorld => {
                return Err(SpawnRejectReason::OutsideHorizontalWorld);
            }
            VoxelSample::OutsideAboveWorld => continue,
            VoxelSample::InBounds(VoxelType::Water) => {
                if saw_air {
                    return Err(SpawnRejectReason::Water);
                }
            }
            VoxelSample::InBounds(VoxelType::Air) => {
                saw_air = true;
            }
            VoxelSample::InBounds(voxel) if voxel.is_solid() => {
                if !is_spawn_surface_voxel(voxel) {
                    continue;
                }
                if !saw_air {
                    return Err(SpawnRejectReason::Underground);
                }
                return validate_surface_spawn(world, pos, collider_readiness, require_collider);
            }
            VoxelSample::InBounds(_) => {}
        }
    }

    Err(SpawnRejectReason::NoSurface)
}

pub fn find_nearest_valid_spawn(
    world: &VoxelWorld,
    origin: Vec2,
    collider_readiness: &SpawnColliderReadiness,
    require_collider: bool,
    stats: &mut SpawnValidationReport,
) -> Option<ValidSpawnLocation> {
    let bounds = world.bounds();
    let origin_x = origin.x.round() as i32;
    let origin_z = origin.y.round() as i32;

    for radius in (0..=SPAWN_MAX_RADIUS).step_by(SPAWN_RING_STEP as usize) {
        let mut best: Option<(i64, ValidSpawnLocation)> = None;
        for (x, z) in ring_samples(origin_x, origin_z, radius) {
            if x < bounds.horizontal_min.x
                || x > bounds.horizontal_max.x
                || z < bounds.horizontal_min.y
                || z > bounds.horizontal_max.y
            {
                continue;
            }

            let result = find_surface_spawn(world, x, z, collider_readiness, require_collider);
            stats.record(result);
            if let Ok(spawn) = result {
                let dx = x - origin_x;
                let dz = z - origin_z;
                let distance_sq = (dx as i64 * dx as i64) + (dz as i64 * dz as i64);
                if best
                    .as_ref()
                    .map(|(best_distance, _)| distance_sq < *best_distance)
                    .unwrap_or(true)
                {
                    best = Some((distance_sq, spawn));
                }
            }
        }

        if let Some((_, spawn)) = best {
            return Some(spawn);
        }
    }

    None
}

pub fn run_random_spawn_test(world: &VoxelWorld, sample_count: usize) -> SpawnValidationReport {
    let mut report = SpawnValidationReport::default();
    let readiness = SpawnColliderReadiness::default();
    let bounds = world.bounds();
    if bounds.horizontal_min.x > bounds.horizontal_max.x
        || bounds.horizontal_min.y > bounds.horizontal_max.y
    {
        return report;
    }

    let x_span = (bounds.horizontal_max.x - bounds.horizontal_min.x + 1) as u32;
    let z_span = (bounds.horizontal_max.y - bounds.horizontal_min.y + 1) as u32;
    let mut seed = 0xA5A5_5A5A_D3C0_1E57u64 ^ sample_count as u64;
    for _ in 0..sample_count {
        let x = bounds.horizontal_min.x + (next_lcg(&mut seed) as u32 % x_span) as i32;
        let z = bounds.horizontal_min.y + (next_lcg(&mut seed) as u32 % z_span) as i32;
        let result = find_surface_spawn(world, x, z, &readiness, false);
        report.record(result);
    }
    report
}

pub fn classify_player_world_validity(world: &VoxelWorld, position: Vec3) -> PlayerWorldValidity {
    let block_pos = vec3_to_block(position);
    let bounds = world.bounds();
    if !bounds.contains_horizontal(block_pos) {
        return PlayerWorldValidity::OutsideHorizontalBounds;
    }
    if block_pos.y < bounds.min_world_y || position.y < bounds.min_world_y as f32 {
        return PlayerWorldValidity::BelowFloor;
    }

    match world.sample_voxel_for_interaction(block_pos) {
        VoxelSample::MissingChunkInsideBounds => return PlayerWorldValidity::InsideMissingChunk,
        VoxelSample::OutsideBelowWorld => return PlayerWorldValidity::BelowFloor,
        VoxelSample::OutsideHorizontalWorld => {
            return PlayerWorldValidity::OutsideHorizontalBounds;
        }
        VoxelSample::InBounds(VoxelType::Water) => {
            return PlayerWorldValidity::UndergroundInvalidSpawn;
        }
        VoxelSample::InBounds(voxel) if voxel.is_solid() => {
            if let Ok(surface) = find_surface_spawn(
                world,
                block_pos.x,
                block_pos.z,
                &SpawnColliderReadiness::default(),
                false,
            ) {
                if position.y + LAST_SAFE_VERTICAL_TOLERANCE >= surface.position.y {
                    return PlayerWorldValidity::InValidWorld;
                }
            }
            return PlayerWorldValidity::UndergroundInvalidSpawn;
        }
        VoxelSample::InBounds(_) | VoxelSample::OutsideAboveWorld => {}
    }

    match find_surface_spawn(
        world,
        block_pos.x,
        block_pos.z,
        &SpawnColliderReadiness::default(),
        false,
    ) {
        Ok(surface) => {
            if position.y + LAST_SAFE_VERTICAL_TOLERANCE >= surface.position.y {
                PlayerWorldValidity::InValidWorld
            } else {
                PlayerWorldValidity::UndergroundInvalidSpawn
            }
        }
        Err(SpawnRejectReason::MissingChunk) => PlayerWorldValidity::InsideMissingChunk,
        Err(SpawnRejectReason::BelowWorldFloor) => PlayerWorldValidity::BelowFloor,
        Err(SpawnRejectReason::OutsideHorizontalWorld) => {
            PlayerWorldValidity::OutsideHorizontalBounds
        }
        Err(_) => PlayerWorldValidity::UndergroundInvalidSpawn,
    }
}

pub fn can_player_enter_ground_column(
    world: &VoxelWorld,
    position: Vec3,
    collider_readiness: &SpawnColliderReadiness,
) -> bool {
    if !classify_player_world_validity(world, position).is_valid() {
        return false;
    }

    let Ok(surface) = validate_existing_spawn_position(world, position, collider_readiness, false)
    else {
        return false;
    };

    position.y > surface.position.y + GROUND_GUARD_HEIGHT_TOLERANCE
        || spawn_source_ready(collider_readiness, surface.chunk_pos)
        || !spawn_collider_ready(collider_readiness, surface.chunk_pos)
}

fn validate_surface_spawn(
    world: &VoxelWorld,
    surface_block: IVec3,
    collider_readiness: &SpawnColliderReadiness,
    require_collider: bool,
) -> Result<ValidSpawnLocation, SpawnRejectReason> {
    let bounds = world.bounds();
    if surface_block.y < bounds.min_breakable_y {
        return Err(SpawnRejectReason::BelowWorldFloor);
    }
    match world.sample_voxel_for_interaction(surface_block) {
        VoxelSample::InBounds(voxel) if is_spawn_surface_voxel(voxel) => {}
        VoxelSample::MissingChunkInsideBounds => return Err(SpawnRejectReason::MissingChunk),
        VoxelSample::OutsideBelowWorld => return Err(SpawnRejectReason::BelowWorldFloor),
        VoxelSample::OutsideHorizontalWorld => {
            return Err(SpawnRejectReason::OutsideHorizontalWorld);
        }
        VoxelSample::InBounds(VoxelType::Water) => return Err(SpawnRejectReason::Water),
        _ => return Err(SpawnRejectReason::NoSurface),
    }

    let player_block = surface_block + IVec3::Y;
    if !bounds.contains_horizontal(player_block) {
        return Err(SpawnRejectReason::OutsideHorizontalWorld);
    }

    for head_y in player_block.y..player_block.y + SPAWN_HEADROOM_BLOCKS {
        let head_pos = IVec3::new(player_block.x, head_y, player_block.z);
        match world.sample_voxel_for_interaction(head_pos) {
            VoxelSample::InBounds(VoxelType::Air) | VoxelSample::OutsideAboveWorld => {}
            VoxelSample::InBounds(VoxelType::Water) => return Err(SpawnRejectReason::Water),
            VoxelSample::MissingChunkInsideBounds => return Err(SpawnRejectReason::MissingChunk),
            VoxelSample::OutsideBelowWorld => return Err(SpawnRejectReason::BelowWorldFloor),
            VoxelSample::OutsideHorizontalWorld => {
                return Err(SpawnRejectReason::OutsideHorizontalWorld);
            }
            VoxelSample::InBounds(_) => return Err(SpawnRejectReason::NoHeadroom),
        }
    }

    let surface_chunk = VoxelWorld::world_to_chunk(surface_block);
    if require_collider && !spawn_source_ready(collider_readiness, surface_chunk) {
        return Err(SpawnRejectReason::ColliderNotReady);
    }

    Ok(ValidSpawnLocation {
        position: Vec3::new(
            player_block.x as f32 + 0.5,
            surface_block.y as f32 + 1.0,
            player_block.z as f32 + 0.5,
        ),
        surface_block,
        player_block,
        chunk_pos: surface_chunk,
    })
}

fn is_spawn_surface_voxel(voxel: VoxelType) -> bool {
    matches!(
        voxel,
        VoxelType::TopSoil
            | VoxelType::SubSoil
            | VoxelType::Rock
            | VoxelType::Sand
            | VoxelType::Clay
    )
}

fn validate_existing_spawn_position(
    world: &VoxelWorld,
    position: Vec3,
    collider_readiness: &SpawnColliderReadiness,
    require_collider: bool,
) -> Result<ValidSpawnLocation, SpawnRejectReason> {
    let x = position.x.floor() as i32;
    let z = position.z.floor() as i32;
    find_surface_spawn(world, x, z, collider_readiness, require_collider)
}

fn find_collider_ready_recovery_target(
    world: &VoxelWorld,
    origin: Vec2,
    readiness: &SpawnColliderReadiness,
    last_safe_grounded_position: Option<Vec3>,
    stats: &mut SpawnValidationReport,
) -> Option<ValidSpawnLocation> {
    last_safe_grounded_position
        .and_then(|position| {
            validate_existing_spawn_position(world, position, readiness, true).ok()
        })
        .or_else(|| find_nearest_valid_spawn(world, origin, readiness, true, stats))
        .or_else(|| find_nearest_valid_spawn(world, world_center_xz(world), readiness, true, stats))
}

fn spawn_collider_ready(readiness: &SpawnColliderReadiness, surface_chunk: IVec3) -> bool {
    const OFFSETS: [IVec3; 5] = [IVec3::ZERO, IVec3::X, IVec3::NEG_X, IVec3::Z, IVec3::NEG_Z];
    OFFSETS
        .iter()
        .all(|offset| readiness.is_chunk_ready(surface_chunk + *offset))
}

fn spawn_source_ready(readiness: &SpawnColliderReadiness, surface_chunk: IVec3) -> bool {
    const OFFSETS: [IVec3; 5] = [IVec3::ZERO, IVec3::X, IVec3::NEG_X, IVec3::Z, IVec3::NEG_Z];
    OFFSETS
        .iter()
        .all(|offset| readiness.is_chunk_source_ready(surface_chunk + *offset))
}

fn ring_samples(origin_x: i32, origin_z: i32, radius: i32) -> Vec<(i32, i32)> {
    if radius == 0 {
        return vec![(origin_x, origin_z)];
    }

    let mut samples = Vec::new();
    let step = SPAWN_RING_STEP.max(1);
    for dx in (-radius..=radius).step_by(step as usize) {
        samples.push((origin_x + dx, origin_z - radius));
        samples.push((origin_x + dx, origin_z + radius));
    }
    for dz in ((-radius + step)..=(radius - step)).step_by(step as usize) {
        samples.push((origin_x - radius, origin_z + dz));
        samples.push((origin_x + radius, origin_z + dz));
    }
    samples
}

fn world_center_xz(world: &VoxelWorld) -> Vec2 {
    let bounds = world.bounds();
    Vec2::new(
        (bounds.horizontal_min.x + bounds.horizontal_max.x) as f32 * 0.5,
        (bounds.horizontal_min.y + bounds.horizontal_max.y) as f32 * 0.5,
    )
}

fn freeze_player_at_standby(
    world: &VoxelWorld,
    collider_readiness: &SpawnColliderReadiness,
    transform: &mut Transform,
    velocity: Option<Mut<LinearVelocity>>,
) {
    transform.translation = initial_standby_position(world, collider_readiness);
    if let Some(mut velocity) = velocity {
        velocity.0 = Vec3::ZERO;
    }
}

fn initial_standby_position(
    world: &VoxelWorld,
    collider_readiness: &SpawnColliderReadiness,
) -> Vec3 {
    let center = world_center_xz(world);
    let mut ignored_stats = SpawnValidationReport::default();
    find_nearest_valid_spawn(world, center, collider_readiness, false, &mut ignored_stats)
        .map(|spawn| spawn.position)
        .unwrap_or_else(|| Vec3::new(center.x, world.bounds().max_world_y as f32 + 4.0, center.y))
}

fn teleport_player(
    transform: &mut Transform,
    velocity: Option<Mut<LinearVelocity>>,
    position: Vec3,
) {
    transform.translation = position;
    if let Some(mut velocity) = velocity {
        velocity.0 = Vec3::ZERO;
    }
}

fn clamp_player_to_source_support(
    transform: &mut Transform,
    velocity: Option<Mut<LinearVelocity>>,
    support_position: Vec3,
) {
    transform.translation.y = transform.translation.y.max(support_position.y);
    if let Some(mut velocity) = velocity {
        if velocity.y < 0.0 {
            velocity.y = 0.0;
        }
    }
}

fn vec3_to_block(position: Vec3) -> IVec3 {
    IVec3::new(
        position.x.floor() as i32,
        position.y.floor() as i32,
        position.z.floor() as i32,
    )
}

fn next_lcg(seed: &mut u64) -> u64 {
    *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
    *seed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::MIN_BREAKABLE_Y;
    use crate::rendering::triplanar_material::TerrainMaterialQuality;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::meshing::MeshMode;

    fn world_with_surface(surface_y: i32, surface: VoxelType) -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(1, 2, 1));
        for chunk_pos in world.all_chunk_positions().collect::<Vec<_>>() {
            world.insert_chunk(Chunk::new(chunk_pos));
        }
        for y in MIN_BREAKABLE_Y..=surface_y {
            let voxel = if y == surface_y {
                surface
            } else {
                VoxelType::Rock
            };
            assert!(world.set_voxel(IVec3::new(4, y, 4), voxel).applied());
        }
        world
    }

    #[test]
    fn surface_spawn_uses_first_solid_top_surface() {
        let world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        let spawn = find_surface_spawn(&world, 4, 4, &SpawnColliderReadiness::default(), false)
            .expect("surface spawn");

        assert_eq!(spawn.surface_block, IVec3::new(4, MIN_BREAKABLE_Y + 4, 4));
        assert_eq!(spawn.player_block, IVec3::new(4, MIN_BREAKABLE_Y + 5, 4));
    }

    #[test]
    fn surface_spawn_rejects_water_columns() {
        let mut world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        assert!(
            world
                .set_voxel(IVec3::new(4, MIN_BREAKABLE_Y + 5, 4), VoxelType::Water)
                .applied()
        );

        assert_eq!(
            find_surface_spawn(&world, 4, 4, &SpawnColliderReadiness::default(), false),
            Err(SpawnRejectReason::Water)
        );
    }

    #[test]
    fn surface_spawn_rejects_missing_chunks() {
        let world = VoxelWorld::new(IVec3::new(1, 2, 1));

        assert_eq!(
            find_surface_spawn(&world, 4, 4, &SpawnColliderReadiness::default(), false),
            Err(SpawnRejectReason::MissingChunk)
        );
    }

    #[test]
    fn surface_spawn_rejects_no_headroom() {
        let mut world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        assert!(
            world
                .set_voxel(IVec3::new(4, MIN_BREAKABLE_Y + 5, 4), VoxelType::Rock)
                .applied()
        );

        assert_eq!(
            validate_surface_spawn(
                &world,
                IVec3::new(4, MIN_BREAKABLE_Y + 4, 4),
                &SpawnColliderReadiness::default(),
                false,
            ),
            Err(SpawnRejectReason::NoHeadroom)
        );
    }

    #[test]
    fn world_validity_tolerates_small_surface_penetration() {
        let world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        let surface_y = (MIN_BREAKABLE_Y + 5) as f32;
        let position = Vec3::new(4.5, surface_y - 0.05, 4.5);

        assert_eq!(
            classify_player_world_validity(&world, position),
            PlayerWorldValidity::InValidWorld
        );
    }

    #[test]
    fn world_validity_tolerates_settled_player_center_in_surface_block() {
        let world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        let surface_y = (MIN_BREAKABLE_Y + 5) as f32;
        let position = Vec3::new(4.5, surface_y - 0.8, 4.5);

        assert_eq!(
            classify_player_world_validity(&world, position),
            PlayerWorldValidity::InValidWorld
        );
    }

    #[test]
    fn nearest_spawn_requires_colliders_when_requested() {
        let world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        let origin = Vec2::new(4.0, 4.0);
        let readiness = SpawnColliderReadiness::default();
        let mut stats = SpawnValidationReport::default();

        assert!(find_nearest_valid_spawn(&world, origin, &readiness, true, &mut stats).is_none());
        assert!(stats.rejected_collider_not_ready > 0);

        let spawn =
            find_nearest_valid_spawn(&world, origin, &readiness, false, &mut stats).expect("spawn");
        assert_eq!(spawn.surface_block, IVec3::new(4, MIN_BREAKABLE_Y + 4, 4));
    }

    #[test]
    fn initial_standby_position_uses_terrain_before_colliders() {
        let world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        let readiness = SpawnColliderReadiness::default();

        let position = initial_standby_position(&world, &readiness);

        assert_eq!(position, Vec3::new(4.5, (MIN_BREAKABLE_Y + 5) as f32, 4.5));
    }

    #[test]
    fn surface_spawn_skips_tree_voxels_above_ground() {
        let mut world = world_with_surface(MIN_BREAKABLE_Y + 4, VoxelType::TopSoil);
        assert!(
            world
                .set_voxel(IVec3::new(4, MIN_BREAKABLE_Y + 8, 4), VoxelType::Wood)
                .applied()
        );

        let spawn = find_surface_spawn(&world, 4, 4, &SpawnColliderReadiness::default(), false)
            .expect("surface spawn");

        assert_eq!(spawn.surface_block, IVec3::new(4, MIN_BREAKABLE_Y + 4, 4));
    }

    #[test]
    fn random_spawn_test_counts_all_candidates() {
        let mut world = VoxelWorld::new(IVec3::new(2, 1, 2));
        for chunk_pos in world.all_chunk_positions().collect::<Vec<_>>() {
            world.insert_chunk(Chunk::new(chunk_pos));
        }

        let bounds = world.bounds();
        let surface_y = MIN_BREAKABLE_Y + 4;
        for x in bounds.horizontal_min.x..=bounds.horizontal_max.x {
            for z in bounds.horizontal_min.y..=bounds.horizontal_max.y {
                for y in MIN_BREAKABLE_Y..surface_y {
                    assert!(
                        world
                            .set_voxel(IVec3::new(x, y, z), VoxelType::Rock)
                            .applied()
                    );
                }
                assert!(
                    world
                        .set_voxel(IVec3::new(x, surface_y, z), VoxelType::TopSoil)
                        .applied()
                );
            }
        }

        let report = run_random_spawn_test(&world, 1000);

        assert_eq!(report.candidates_tested, 1000);
        assert_eq!(report.accepted, 1000);
        assert_eq!(report.rejected_missing_chunk, 0);
        assert_eq!(report.rejected_water, 0);
        assert_eq!(report.rejected_underground, 0);
    }

    #[test]
    fn collider_readiness_ignores_passive_chunk_meshes() {
        let chunk_position = IVec3::new(1, 0, 1);
        let ready_mesh = ChunkMesh {
            chunk_position,
            vertex_count: 12,
            triangle_count: 4,
            mesh_mode: MeshMode::Blocky,
            material_quality: TerrainMaterialQuality::FullTriplanar,
        };
        let passive_mesh = ready_mesh;
        let collider = ChunkCollider;

        let readiness = SpawnColliderReadiness::from_chunk_meshes(
            [
                (&ready_mesh, Some(&collider), None),
                (&passive_mesh, None, None),
            ]
            .into_iter(),
        );

        assert!(readiness.is_chunk_ready(chunk_position));
    }

    #[test]
    fn source_ready_support_ring_accepts_pending_collider_chunks() {
        let center = IVec3::new(2, 0, 2);
        let mut readiness = SpawnColliderReadiness::default();
        for offset in [IVec3::ZERO, IVec3::X, IVec3::NEG_X, IVec3::Z, IVec3::NEG_Z] {
            readiness.pending_chunks.insert(center + offset);
            readiness.source_ready_chunks.insert(center + offset);
        }

        assert!(!spawn_collider_ready(&readiness, center));
        assert!(spawn_source_ready(&readiness, center));
    }
}
