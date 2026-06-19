//! Runtime integration for stone props: builds the procedural mesh pool, then deterministically
//! spawns/despawns stones per chunk around the player. Stones are standard Bevy mesh entities, so
//! they ride the engine's batching/culling; large stones cast shadows, medium/small do not.
//!
//! v1 uses `StandardMaterial` (the displaced silhouettes already read as rock). The bespoke
//! `vdata` strata/AO shader is a follow-up — `ATTRIBUTE_VDATA` is already on every mesh for it.
//! Placement is deterministic (scatter is a pure function of terrain+seed), so chunks are
//! recomputed on demand rather than persisted to disk; persistence is a later optimisation.
//!
//! Gated on `StoneConfig::enabled` (default false) → zero overhead unless turned on.

use std::collections::HashMap;

use bevy::diagnostic::FrameCount;
use bevy::light::NotShadowCaster;
use bevy::prelude::*;

use crate::bench::BenchRenderToggles;
use crate::camera::controller::PlayerCamera;
use crate::config::loader::load_config;
use crate::performance::AreaTimingRecorder;
use crate::voxel::terrain::{BiomeTable, TerrainGenerator, ValueNoise};
use crate::voxel::world::VoxelWorld;
use crate::world_rules::ProtectedAreaRegistry;

use super::config::{StoneClassId, StoneConfig};
use super::constants::{MAX_STONE_CHUNK_SPAWNS_PER_FRAME, STONE_CHUNK_SIZE};
use super::debug;
use super::material::stone_standard_material;
use super::placement::generate_stones_for_chunk;
use super::rock_mesh::{RockPreset, build_rock};
use super::scatter::StoneInstance;

const STONES_CONFIG_PATH: &str = "assets/config/stones.yaml";

#[derive(Resource, Default)]
struct StoneMeshPool {
    /// (class, preset, variant) → near-LOD mesh handle.
    meshes: HashMap<(StoneClassId, RockPreset, u8), Handle<Mesh>>,
    material: Handle<StandardMaterial>,
    built: bool,
}

#[derive(Resource, Default)]
struct SpawnedStoneChunks {
    chunks: HashMap<IVec2, SpawnedStoneChunk>,
    counts: [usize; 3],
}

struct SpawnedStoneChunk {
    entities: Vec<Entity>,
    counts: [usize; 3],
}

#[derive(Component)]
struct StoneProp;

pub struct StonesPlugin;

impl Plugin for StonesPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<StoneMeshPool>()
            .init_resource::<SpawnedStoneChunks>()
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
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    // Gated by the `stones_pool_pending` run condition (active && !built).
    let Some(config) = config else {
        return;
    };
    if pool.built {
        return;
    }

    pool.material = materials.add(stone_standard_material());

    for class in StoneClassId::ALL {
        let class_cfg = config.class(class);
        let near_detail = class_cfg.lod_details.first().copied().unwrap_or(1);
        for &preset in &class_cfg.presets {
            for variant in 0..class_cfg.variants.max(1) {
                // Stable per-variant seed (same across LODs would keep silhouettes consistent).
                let seed = super::hash_to_seed(preset as i32, variant as i32, "stone_mesh") as u32;
                let (mesh, _tris) = build_rock(preset, seed, near_detail);
                let key = (class, preset, variant.min(u8::MAX as u32) as u8);
                pool.meshes.insert(key, meshes.add(mesh));
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
) {
    let Some(config) = config else {
        return;
    };
    if !stones_active(&config, bench_toggles.as_deref()) || !pool.built {
        if !spawned.chunks.is_empty() {
            despawn_all(&mut commands, &mut spawned);
        }
        return;
    }
    let Ok(player) = player.single() else {
        return;
    };

    let center = player.translation;
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
        if let Some(spawned_chunk) = spawned.chunks.remove(&chunk) {
            subtract_counts(&mut spawned.counts, spawned_chunk.counts);
            for entity in spawned_chunk.entities {
                commands.entity(entity).despawn();
            }
        }
    }

    let generator = TerrainGenerator::with_biome_table(ValueNoise::default(), *biome_table);
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
        let instances = generate_stones_for_chunk(
            chunk,
            &world,
            &generator,
            &biome_table,
            &config,
            protected_areas.as_deref(),
        );
        let remaining = config.max_instances.saturating_sub(active_total);
        let spawned_chunk =
            spawn_chunk(&mut commands, &pool, &config, center, remaining, &instances);
        add_counts(&mut spawned.counts, spawned_chunk.counts);
        active_total += spawned_chunk.counts.iter().sum::<usize>();
        spawned.chunks.insert(chunk, spawned_chunk);
        spawns_this_frame += 1;
    }
}

fn spawn_chunk(
    commands: &mut Commands,
    pool: &StoneMeshPool,
    config: &StoneConfig,
    player_position: Vec3,
    remaining_budget: usize,
    instances: &[StoneInstance],
) -> SpawnedStoneChunk {
    let mut entities = Vec::with_capacity(instances.len());
    let mut counts = [0; 3];
    for instance in instances {
        if entities.len() >= remaining_budget {
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
        let Some(mesh) = pool
            .meshes
            .get(&(instance.class_id, instance.preset, instance.variant))
        else {
            continue;
        };
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
        let mut entity = commands.spawn((
            Mesh3d(mesh.clone()),
            MeshMaterial3d(pool.material.clone()),
            transform,
            StoneProp,
        ));
        // Shadow policy: only the large class casts shadows.
        if !config.class(instance.class_id).shadows {
            entity.insert(NotShadowCaster);
        }
        let class_index = StoneClassId::ALL
            .iter()
            .position(|c| *c == instance.class_id)
            .unwrap();
        counts[class_index] += 1;
        entities.push(entity.id());
    }
    SpawnedStoneChunk { entities, counts }
}

fn max_stone_distance(config: &StoneConfig) -> f32 {
    StoneClassId::ALL
        .iter()
        .map(|class| config.class(*class).max_distance_m)
        .fold(0.0_f32, f32::max)
}

/// World-space horizontal center of a stone chunk, used for both spawn candidacy and despawn.
fn stone_chunk_center(chunk: IVec2) -> Vec2 {
    Vec2::new(
        (chunk.x * STONE_CHUNK_SIZE) as f32 + STONE_CHUNK_SIZE as f32 * 0.5,
        (chunk.y * STONE_CHUNK_SIZE) as f32 + STONE_CHUNK_SIZE as f32 * 0.5,
    )
}

fn despawn_all(commands: &mut Commands, spawned: &mut SpawnedStoneChunks) {
    for (_, spawned_chunk) in spawned.chunks.drain() {
        for entity in spawned_chunk.entities {
            commands.entity(entity).despawn();
        }
    }
    spawned.counts = [0; 3];
}

fn add_counts(total: &mut [usize; 3], delta: [usize; 3]) {
    for (slot, value) in total.iter_mut().zip(delta) {
        *slot += value;
    }
}

fn subtract_counts(total: &mut [usize; 3], delta: [usize; 3]) {
    for (slot, value) in total.iter_mut().zip(delta) {
        *slot = slot.saturating_sub(value);
    }
}

fn record_stone_counters(
    config: Option<Res<StoneConfig>>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    spawned: Res<SpawnedStoneChunks>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let Some(config) = config else {
        return;
    };
    if stones_active(&config, bench_toggles.as_deref()) {
        let total = spawned.counts.iter().sum::<usize>();
        timing.record_count(frame.0, debug::STONES_TOTAL, total as f64);
        timing.record_count(frame.0, debug::STONES_LARGE, spawned.counts[0] as f64);
        timing.record_count(frame.0, debug::STONES_MEDIUM, spawned.counts[1] as f64);
        timing.record_count(frame.0, debug::STONES_SMALL, spawned.counts[2] as f64);
        timing.record_count(frame.0, debug::STONES_VISIBLE, total as f64);
        timing.record_count(frame.0, debug::STONES_LOD0, total as f64);
        timing.record_count(frame.0, debug::STONES_LOD1, 0.0);
        timing.record_count(frame.0, debug::STONES_REJECTED_WATER, 0.0);
        timing.record_count(frame.0, debug::STONES_REJECTED_SLOPE, 0.0);
        timing.record_count(frame.0, debug::STONES_REJECTED_SNOW, 0.0);
        timing.record_count(frame.0, debug::STONES_REJECTED_PROTECTED, 0.0);
        timing.record_count(frame.0, debug::STONES_AVG_SINK, 0.0);
        timing.record_count(frame.0, debug::STONES_MAX_FLOAT_ERROR, 0.0);
        timing.record_count(
            frame.0,
            debug::STONES_CHUNK_REGEN_COUNT,
            spawned.chunks.len() as f64,
        );
        timing.record_count(
            frame.0,
            debug::STONES_CONFIG_HASH,
            config.config_hash() as f64,
        );
        timing.record_count(frame.0, debug::STONES_CHUNKS, spawned.chunks.len() as f64);
    }
}
