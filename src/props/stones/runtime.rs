//! Runtime integration for stone props: builds the procedural mesh pool, then deterministically
//! spawns/despawns stones per chunk around the player. Stones are submitted to the shared
//! instanced prop renderer in chunk-local batches; large stones cast shadows, medium/small do not.
//!
//! Procedural rock `vdata` is mapped into vertex color for the stone material path.
//! Placement is deterministic and persisted per chunk with config/terrain invalidation.
//!
//! Gated on `StoneConfig::enabled` (default false) → zero overhead unless turned on.

use std::collections::HashMap;

use bevy::diagnostic::FrameCount;
use bevy::prelude::*;

use crate::bench::BenchRenderToggles;
use crate::camera::controller::PlayerCamera;
use crate::config::loader::load_config;
use crate::performance::AreaTimingRecorder;
use crate::props::PropType;
use crate::props::instanced_render::{
    PropInstanceGroups, PropLocalBounds, RawPropInstance, spawn_raw_instanced_prop_batch,
};
use crate::rendering::props_material::PropsMaterial;
use crate::terrain::generation::config::terrain_config_fingerprint;
use crate::voxel::chunk::MeshDirtyReason;
use crate::voxel::terrain::{BiomeTable, TerrainGenerator, ValueNoise};
use crate::voxel::world::VoxelWorld;
use crate::world_rules::ProtectedAreaRegistry;

use super::config::{StoneClassId, StoneConfig};
use super::constants::{MAX_STONE_CHUNK_SPAWNS_PER_FRAME, STONE_CHUNK_SIZE};
use super::debug;
use super::material::{prepare_stone_instancing_mesh, stone_props_material};
use super::placement::generate_stones_for_chunk;
use super::persistence;
use super::rock_mesh::{RockPreset, build_rock};
use super::scatter::StoneInstance;
use super::stats::StoneRuntimeStats;

const STONES_CONFIG_PATH: &str = "assets/config/stones.yaml";

#[derive(Resource, Default)]
struct StoneMeshPool {
    /// (class, preset, variant, lod index) → mesh handle + local bounds.
    meshes: HashMap<(StoneClassId, RockPreset, u8, usize), StoneMeshEntry>,
    material: Handle<PropsMaterial>,
    built: bool,
}

#[derive(Clone)]
struct StoneMeshEntry {
    mesh: Handle<Mesh>,
    local_bounds: PropLocalBounds,
}

#[derive(Resource, Default)]
struct SpawnedStoneChunks {
    chunks: HashMap<IVec2, SpawnedStoneChunk>,
    counts: [usize; 3],
    lod_counts: [usize; 2],
    chunk_regen_count: usize,
}

struct SpawnedStoneChunk {
    group_entities: Vec<Entity>,
    counts: [usize; 3],
    lod_counts: [usize; 2],
}

pub struct StonesPlugin;

impl Plugin for StonesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<StoneMeshPool>()
            .init_resource::<SpawnedStoneChunks>()
            .init_resource::<StoneRuntimeStats>()
            .add_systems(Startup, load_stone_config)
            .add_systems(
                Update,
                (
                    // Run conditions keep these from claiming hot resources (Assets<Mesh>,
                    // the timing recorder) every frame when stones are disabled — otherwise they
                    // would serialize against world-gen meshing/chunk-apply.
                    build_stone_mesh_pool.run_if(stones_pool_pending),
                    update_stone_chunks.run_if(stones_should_tick),
                    record_stone_counters.run_if(stones_currently_active),
                )
                    .chain(),
            );
    }
}

/// True while stones are on (config or bench override) and not A/B-disabled.
fn stones_currently_active(
    config: Option<Res<StoneConfig>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
) -> bool {
    config.is_some_and(|c| stones_active(&c, bench_toggles.as_deref()))
}

/// Build the mesh pool only while stones are active and not yet built.
fn stones_pool_pending(
    config: Option<Res<StoneConfig>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    pool: Res<StoneMeshPool>,
) -> bool {
    !pool.built && config.is_some_and(|c| stones_active(&c, bench_toggles.as_deref()))
}

/// Tick spawn/despawn while stones are active, or once more to clean up after a runtime disable.
fn stones_should_tick(
    config: Option<Res<StoneConfig>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    spawned: Res<SpawnedStoneChunks>,
) -> bool {
    config.is_some_and(|c| stones_active(&c, bench_toggles.as_deref()))
        || !spawned.chunks.is_empty()
}

/// Stones render when enabled (config or a bench baseline override) and not disabled by the
/// bench A/B switch.
fn stones_active(config: &StoneConfig, bench_toggles: Option<&BenchRenderToggles>) -> bool {
    let enabled = config.enabled || bench_toggles.is_some_and(|t| t.enable_stones);
    enabled && !bench_toggles.is_some_and(|t| t.disable_stones)
}

fn load_stone_config(mut commands: Commands) {
    let config: StoneConfig = match load_config(STONES_CONFIG_PATH) {
        Ok(c) => {
            info!("Loaded stones config from {STONES_CONFIG_PATH}");
            c
        }
        Err(e) => {
            warn!("Failed to load stones config: {e}. Using defaults.");
            StoneConfig::default()
        }
    };
    commands.insert_resource(config);
}

/// Build the per-(class, preset, variant) mesh pool + shared material once stones are enabled.
fn build_stone_mesh_pool(
    config: Option<Res<StoneConfig>>,
    mut pool: ResMut<StoneMeshPool>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<PropsMaterial>>,
) {
    // Gated by the `stones_pool_pending` run condition (active && !built).
    let Some(config) = config else {
        return;
    };
    if pool.built {
        return;
    }

    pool.material = materials.add(stone_props_material());

    for class in StoneClassId::ALL {
        let class_cfg = config.class(class);
        let lod_details = if class_cfg.lod_details.is_empty() {
            vec![1]
        } else {
            class_cfg.lod_details.clone()
        };
        for &preset in &class_cfg.presets {
            for variant in 0..class_cfg.variants.max(1) {
                // Stable per-variant seed (same across LODs would keep silhouettes consistent).
                let seed = super::hash_to_seed(preset as i32, variant as i32, "stone_mesh") as u32;
                for (lod_index, detail) in lod_details.iter().copied().enumerate() {
                    let (mesh, _tris) = build_rock(preset, seed, detail);
                    let (mesh, local_bounds) = prepare_stone_instancing_mesh(mesh);
                    let key = (
                        class,
                        preset,
                        variant.min(u8::MAX as u32) as u8,
                        lod_index,
                    );
                    pool.meshes.insert(
                        key,
                        StoneMeshEntry {
                            mesh: meshes.add(mesh),
                            local_bounds,
                        },
                    );
                }
            }
        }
    }

    pool.built = true;
    info!("Built {} stone mesh variants", pool.meshes.len());
}

/// Spawn/despawn stone chunks around the player.
#[allow(clippy::too_many_arguments)]
fn update_stone_chunks(
    mut commands: Commands,
    config: Option<Res<StoneConfig>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    pool: Res<StoneMeshPool>,
    world: Res<VoxelWorld>,
    biome_table: Res<BiomeTable>,
    protected_areas: Option<Res<ProtectedAreaRegistry>>,
    player: Query<&Transform, With<PlayerCamera>>,
    mut spawned: ResMut<SpawnedStoneChunks>,
    mut prop_groups: ResMut<PropInstanceGroups>,
) {
    let Some(config) = config else {
        return;
    };
    if !stones_active(&config, bench_toggles.as_deref()) || !pool.built {
        if !spawned.chunks.is_empty() {
            despawn_all(&mut commands, &mut spawned, &mut prop_groups);
        }
        return;
    }
    let Ok(player) = player.single() else {
        return;
    };

    let center = player.translation;
    invalidate_dirty_stone_chunks(
        &mut commands,
        &config,
        &world,
        &mut spawned,
        &mut prop_groups,
    );

    let center_cx = (center.x / STONE_CHUNK_SIZE as f32).floor() as i32;
    let center_cz = (center.z / STONE_CHUNK_SIZE as f32).floor() as i32;

    // Spawn and despawn share one radius so edge chunks are not regenerated and dropped on
    // alternating frames (a square spawn region vs a round despawn region thrashes the corners).
    let player_xz = Vec2::new(center.x, center.z);
    let keep_radius =
        max_stone_distance(&config) + STONE_CHUNK_SIZE as f32 * std::f32::consts::SQRT_2;

    // Despawn chunks that left the keep radius.
    let out_of_range: Vec<IVec2> = spawned
        .chunks
        .keys()
        .filter(|c| stone_chunk_center(**c).distance(player_xz) > keep_radius)
        .copied()
        .collect();
    for chunk in out_of_range {
        despawn_chunk(&mut commands, &mut spawned, &mut prop_groups, chunk);
    }

    let generator = TerrainGenerator::with_biome_table(ValueNoise::default(), *biome_table);
    let config_hash = config.config_hash();
    let terrain_fingerprint = terrain_config_fingerprint();
    let mut spawns_this_frame = 0;
    let mut active_total = spawned.counts.iter().sum::<usize>();
    let mut pending_chunks = Vec::new();
    let view_chunks = (keep_radius / STONE_CHUNK_SIZE as f32).ceil() as i32;
    for dz in -view_chunks..=view_chunks {
        for dx in -view_chunks..=view_chunks {
            let chunk = IVec2::new(center_cx + dx, center_cz + dz);
            if stone_chunk_center(chunk).distance(player_xz) <= keep_radius
                && !spawned.chunks.contains_key(&chunk)
            {
                pending_chunks.push(chunk);
            }
        }
    }
    pending_chunks.sort_by_key(|chunk| {
        let dx = chunk.x - center_cx;
        let dz = chunk.y - center_cz;
        (dx * dx + dz * dz, dz.abs().max(dx.abs()), chunk.y, chunk.x)
    });

    for chunk in pending_chunks {
        if spawns_this_frame >= MAX_STONE_CHUNK_SPAWNS_PER_FRAME
            || active_total >= config.max_instances
        {
            break;
        }
        let instances = load_or_generate_chunk(
            chunk,
            &world,
            &generator,
            &biome_table,
            &config,
            protected_areas.as_deref(),
            config_hash,
            terrain_fingerprint,
        );
        let remaining = config.max_instances.saturating_sub(active_total);
        let spawned_chunk = spawn_chunk(
            &mut commands,
            &mut prop_groups,
            &pool,
            &config,
            chunk,
            center,
            remaining,
            &instances,
        );
        add_counts(&mut spawned.counts, spawned_chunk.counts);
        add_counts(&mut spawned.lod_counts, spawned_chunk.lod_counts);
        active_total += spawned_chunk.counts.iter().sum::<usize>();
        spawned.chunks.insert(chunk, spawned_chunk);
        spawned.chunk_regen_count += 1;
        spawns_this_frame += 1;
    }
}

fn spawn_chunk(
    commands: &mut Commands,
    prop_groups: &mut PropInstanceGroups,
    pool: &StoneMeshPool,
    config: &StoneConfig,
    chunk: IVec2,
    player_position: Vec3,
    remaining_budget: usize,
    instances: &[StoneInstance],
) -> SpawnedStoneChunk {
    let mut counts = [0; 3];
    let mut lod_counts = [0; 2];
    let mut batches: HashMap<(StoneClassId, RockPreset, u8, usize), Vec<RawPropInstance>> =
        HashMap::new();

    for instance in instances {
        let active_count = counts.iter().sum::<usize>();
        if active_count >= remaining_budget {
            break;
        }
        let max_distance = config.class(instance.class_id).max_distance_m;
        let horizontal_distance = Vec2::new(
            instance.position.x - player_position.x,
            instance.position.z - player_position.z,
        )
        .length();
        if horizontal_distance > max_distance {
            continue;
        }
        let lod_index = stone_lod_index(config, instance.class_id, horizontal_distance);
        if !pool
            .meshes
            .contains_key(&(instance.class_id, instance.preset, instance.variant, lod_index))
        {
            continue;
        }
        let rotation = Quat::from_euler(
            EulerRot::YXZ,
            instance.yaw,
            instance.lean.x,
            instance.lean.y,
        );
        let transform = Transform {
            translation: instance.position,
            rotation,
            scale: Vec3::splat(instance.scale),
        };
        let tint = stone_tint(instance);
        batches
            .entry((instance.class_id, instance.preset, instance.variant, lod_index))
            .or_default()
            .push(RawPropInstance {
                transform,
                tint,
                shadow_culled: !config.class(instance.class_id).shadows,
            });
        let class_index = StoneClassId::ALL
            .iter()
            .position(|c| *c == instance.class_id)
            .unwrap();
        counts[class_index] += 1;
        lod_counts[lod_index.min(1)] += 1;
    }

    let mut group_entities = Vec::with_capacity(batches.len());
    let render_chunk = stone_instancing_chunk(chunk);
    for (key, batch) in batches {
        let Some(entry) = pool.meshes.get(&key) else {
            continue;
        };
        for entity in spawn_raw_instanced_prop_batch(
            commands,
            prop_groups,
            entry.mesh.clone(),
            pool.material.clone(),
            entry.local_bounds,
            0.75,
            "stone",
            PropType::Rock,
            render_chunk,
            &batch,
        ) {
            if !group_entities.contains(&entity) {
                group_entities.push(entity);
            }
        }
    }

    SpawnedStoneChunk {
        group_entities,
        counts,
        lod_counts,
    }
}

fn max_stone_distance(config: &StoneConfig) -> f32 {
    StoneClassId::ALL
        .iter()
        .map(|class| config.class(*class).max_distance_m)
        .fold(0.0_f32, f32::max)
}

#[allow(clippy::too_many_arguments)]
fn load_or_generate_chunk(
    chunk: IVec2,
    world: &VoxelWorld,
    generator: &TerrainGenerator<ValueNoise>,
    biome_table: &BiomeTable,
    config: &StoneConfig,
    protected_areas: Option<&ProtectedAreaRegistry>,
    config_hash: u64,
    terrain_fingerprint: u64,
) -> Vec<StoneInstance> {
    if let Some(instances) =
        persistence::load_chunk(config, chunk, config_hash, terrain_fingerprint)
    {
        return instances;
    }

    let instances = generate_stones_for_chunk(
        chunk,
        world,
        generator,
        biome_table,
        config,
        protected_areas,
    );
    if let Err(error) =
        persistence::save_chunk(config, chunk, config_hash, terrain_fingerprint, &instances)
    {
        warn!("Failed to persist stone chunk {chunk:?}: {error}");
    }
    instances
}

fn invalidate_dirty_stone_chunks(
    commands: &mut Commands,
    config: &StoneConfig,
    world: &VoxelWorld,
    spawned: &mut SpawnedStoneChunks,
    prop_groups: &mut PropInstanceGroups,
) {
    let dirty_stone_chunks: Vec<IVec2> = world
        .dirty_chunks()
        .filter_map(|chunk_pos| {
            let chunk = world.get_chunk(chunk_pos)?;
            chunk
                .has_dirty_reason(MeshDirtyReason::TerrainMutation)
                .then_some(terrain_chunk_to_stone_chunk(chunk_pos))
        })
        .collect();

    for chunk in dirty_stone_chunks {
        persistence::delete_chunk(config, chunk);
        if spawned.chunks.contains_key(&chunk) {
            despawn_chunk(commands, spawned, prop_groups, chunk);
        }
    }
}

fn terrain_chunk_to_stone_chunk(chunk_pos: IVec3) -> IVec2 {
    let min_x = chunk_pos.x * crate::constants::CHUNK_SIZE_I32;
    let min_z = chunk_pos.z * crate::constants::CHUNK_SIZE_I32;
    IVec2::new(
        min_x.div_euclid(STONE_CHUNK_SIZE),
        min_z.div_euclid(STONE_CHUNK_SIZE),
    )
}

fn stone_lod_index(config: &StoneConfig, class: StoneClassId, distance: f32) -> usize {
    let class_cfg = config.class(class);
    let lod_count = class_cfg.lod_details.len().max(1);
    if lod_count == 1 {
        return 0;
    }
    let max_distance = class_cfg.max_distance_m.max(1.0);
    let band = (distance / max_distance * lod_count as f32).floor() as usize;
    band.min(lod_count - 1)
}

fn stone_tint(instance: &StoneInstance) -> Vec4 {
    let bits = instance.seed ^ ((instance.variant as u64) << 32);
    let warm = ((bits & 0xff) as f32) / 255.0;
    let value = (((bits >> 8) & 0xff) as f32) / 255.0;
    let class_bias = match instance.class_id {
        StoneClassId::Large => Vec3::new(1.02, 1.0, 0.94),
        StoneClassId::Medium => Vec3::new(0.98, 1.0, 1.02),
        StoneClassId::Small => Vec3::new(1.04, 1.03, 0.98),
    };
    let tint = Vec3::splat(0.88 + value * 0.2) * class_bias.lerp(Vec3::ONE, warm * 0.35);
    tint.extend(1.0)
}

fn stone_instancing_chunk(chunk: IVec2) -> IVec2 {
    // The shared prop renderer groups by 2x2 prop chunks. Stones need independently removable
    // stone chunks, so feed an expanded coordinate whose computed region remains one stone chunk.
    chunk * 2
}

/// World-space horizontal center of a stone chunk, used for both spawn candidacy and despawn.
fn stone_chunk_center(chunk: IVec2) -> Vec2 {
    Vec2::new(
        (chunk.x * STONE_CHUNK_SIZE) as f32 + STONE_CHUNK_SIZE as f32 * 0.5,
        (chunk.y * STONE_CHUNK_SIZE) as f32 + STONE_CHUNK_SIZE as f32 * 0.5,
    )
}

fn despawn_all(
    commands: &mut Commands,
    spawned: &mut SpawnedStoneChunks,
    prop_groups: &mut PropInstanceGroups,
) {
    let chunks: Vec<IVec2> = spawned.chunks.keys().copied().collect();
    for chunk in chunks {
        despawn_chunk(commands, spawned, prop_groups, chunk);
    }
    spawned.counts = [0; 3];
    spawned.lod_counts = [0; 2];
}

fn despawn_chunk(
    commands: &mut Commands,
    spawned: &mut SpawnedStoneChunks,
    prop_groups: &mut PropInstanceGroups,
    chunk: IVec2,
) {
    if let Some(spawned_chunk) = spawned.chunks.remove(&chunk) {
        subtract_counts(&mut spawned.counts, spawned_chunk.counts);
        subtract_counts(&mut spawned.lod_counts, spawned_chunk.lod_counts);
        let mut entities = prop_groups.remove_chunk(stone_instancing_chunk(chunk));
        for entity in spawned_chunk.group_entities {
            if !entities.contains(&entity) {
                entities.push(entity);
            }
        }
        for entity in entities {
            commands.entity(entity).despawn();
        }
    }
}

fn add_counts<const N: usize>(total: &mut [usize; N], delta: [usize; N]) {
    for (slot, value) in total.iter_mut().zip(delta) {
        *slot += value;
    }
}

fn subtract_counts<const N: usize>(total: &mut [usize; N], delta: [usize; N]) {
    for (slot, value) in total.iter_mut().zip(delta) {
        *slot = slot.saturating_sub(value);
    }
}

fn record_stone_counters(
    config: Option<Res<StoneConfig>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    spawned: Res<SpawnedStoneChunks>,
    frame: Res<FrameCount>,
    mut stats: ResMut<StoneRuntimeStats>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let Some(config) = config else {
        return;
    };
    if stones_active(&config, bench_toggles.as_deref()) {
        let total = spawned.counts.iter().sum::<usize>();
        stats.total = total;
        stats.large = spawned.counts[0];
        stats.medium = spawned.counts[1];
        stats.small = spawned.counts[2];
        stats.visible = total;
        stats.lod0 = spawned.lod_counts[0];
        stats.lod1 = spawned.lod_counts[1];
        stats.chunk_regen_count = spawned.chunk_regen_count;
        stats.config_hash = config.config_hash();
        timing.record_count(frame.0, debug::STONES_TOTAL, total as f64);
        timing.record_count(frame.0, debug::STONES_LARGE, spawned.counts[0] as f64);
        timing.record_count(frame.0, debug::STONES_MEDIUM, spawned.counts[1] as f64);
        timing.record_count(frame.0, debug::STONES_SMALL, spawned.counts[2] as f64);
        timing.record_count(frame.0, debug::STONES_VISIBLE, total as f64);
        timing.record_count(frame.0, debug::STONES_LOD0, spawned.lod_counts[0] as f64);
        timing.record_count(frame.0, debug::STONES_LOD1, spawned.lod_counts[1] as f64);
        timing.record_count(frame.0, debug::STONES_REJECTED_WATER, stats.rejected_water as f64);
        timing.record_count(frame.0, debug::STONES_REJECTED_SLOPE, stats.rejected_slope as f64);
        timing.record_count(frame.0, debug::STONES_REJECTED_SNOW, stats.rejected_snow as f64);
        timing.record_count(
            frame.0,
            debug::STONES_REJECTED_PROTECTED,
            stats.rejected_protected as f64,
        );
        timing.record_count(frame.0, debug::STONES_AVG_SINK, stats.avg_sink as f64);
        timing.record_count(
            frame.0,
            debug::STONES_MAX_FLOAT_ERROR,
            stats.max_float_error as f64,
        );
        timing.record_count(
            frame.0,
            debug::STONES_CHUNK_REGEN_COUNT,
            spawned.chunk_regen_count as f64,
        );
        timing.record_count(
            frame.0,
            debug::STONES_CONFIG_HASH,
            config.config_hash() as f64,
        );
        timing.record_count(frame.0, debug::STONES_CHUNKS, spawned.chunks.len() as f64);
    }
}
