use super::*;
use super::world_source_generation::build_world_source_chunk;
use crate::world::source::{ProceduralWorldSourceTerrainBridge, TerrainSourceConfig, TerrainSourceMode};

mod legacy_chunk;
mod source;
mod state;
mod stats;
mod world_load;

pub(crate) use source::{chunk_terrain_source_for_config, ChunkTerrainSource};
pub use state::ChunkGenerationState;
pub(crate) use state::{
    should_poll_chunk_generation_tasks, ChunkGenerationResult, ChunkGenerationTask,
    PendingWorldGeneration, WorldGenerationQueue, WorldLoadTask,
};
pub(crate) use stats::{collect_chunk_stats_from_chunk, ChunkStats, WorldStats};
pub(crate) use world_load::expected_world_chunk_count;

// =============================================================================
// Async Chunk Generation
// =============================================================================

fn request_world_generation(
    gen_state: &mut ChunkGenerationState,
    pending_generation: &mut PendingWorldGeneration,
) {
    gen_state.total_chunks = 0;
    gen_state.chunks_completed = 0;
    gen_state.is_complete = false;
    gen_state.loading_from_disk = false;
    gen_state.world_stats = WorldStats::default();
    gen_state.start_time = Some(std::time::Instant::now());
    pending_generation.requested = true;
}

pub(crate) fn start_voxel_world_after_overlay_frame(
    mut commands: Commands,
    world: Res<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    persistence_settings: Res<WorldPersistence>,
    mut setup_state: ResMut<WorldStartupSetupState>,
    mut generation_queue: ResMut<WorldGenerationQueue>,
    biome_table: Res<BiomeTable>,
) {
    if setup_state.started {
        return;
    }

    if setup_state.frames_waited < WORLD_STARTUP_SETUP_DELAY_FRAMES {
        setup_state.frames_waited += 1;
        return;
    }

    setup_state.started = true;

    if world_load::should_attempt_saved_world_load(&persistence_settings) {
        gen_state.total_chunks = 0;
        gen_state.chunks_completed = 0;
        gen_state.is_complete = false;
        gen_state.loading_from_disk = true;
        gen_state.world_stats = WorldStats::default();
        gen_state.start_time = Some(std::time::Instant::now());

        let persistence_settings = persistence_settings.clone();
        let task = AsyncComputeTaskPool::get()
            .spawn(async move { world_load::load_saved_world_for_runtime(&persistence_settings) });
        commands.spawn(WorldLoadTask { task });
        return;
    }

    begin_world_generation(&world, &mut gen_state, &mut generation_queue, *biome_table);
}

pub(crate) fn begin_world_generation(
    world: &VoxelWorld,
    gen_state: &mut ChunkGenerationState,
    generation_queue: &mut WorldGenerationQueue,
    biome_table: BiomeTable,
) {
    info!("Generating new world (async)...");

    let chunk_positions: Vec<IVec3> = world.all_chunk_positions().collect();
    let total_chunks = chunk_positions.len() as u32;

    gen_state.total_chunks = total_chunks;
    gen_state.chunks_completed = 0;
    gen_state.is_complete = false;
    gen_state.loading_from_disk = false;
    gen_state.world_stats = WorldStats::default();
    gen_state.start_time = Some(std::time::Instant::now());

    let terrain_source_config = TerrainSourceConfig::load_or_default();
    let source = chunk_terrain_source_for_config(&terrain_source_config, biome_table);
    info!("Terrain source mode: {:?}", source.active_mode());
    generation_queue.begin(chunk_positions, source);
    info!(
        "Queued {} async chunk generation tasks for batched startup spawning",
        total_chunks
    );
}

pub(crate) fn poll_world_load_task(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut pending_generation: ResMut<PendingWorldGeneration>,
    mut tasks: Query<(Entity, &mut WorldLoadTask)>,
    persistence_settings: Res<WorldPersistence>,
) {
    for (entity, mut task) in tasks.iter_mut() {
        let Some(result) = block_on(poll_once(&mut task.task)) else {
            continue;
        };

        commands.entity(entity).despawn();

        match result {
            Ok(loaded_world) => {
                if loaded_world.world_size_chunks() != world.world_size_chunks() {
                    warn!(
                        "Saved world size {:?} does not match configured world size {:?}; regenerating",
                        loaded_world.world_size_chunks(),
                        world.world_size_chunks()
                    );
                    request_world_generation(&mut gen_state, &mut pending_generation);
                    continue;
                }

                let loaded_chunks = loaded_world.chunk_entries().count();
                let expected_chunks = expected_world_chunk_count(loaded_world.world_size_chunks());
                if loaded_chunks != expected_chunks {
                    warn!(
                        "Saved world contains {}/{} chunks; regenerating incomplete save",
                        loaded_chunks, expected_chunks
                    );
                    request_world_generation(&mut gen_state, &mut pending_generation);
                    continue;
                }

                *world = loaded_world;
                assign_initial_lods_for_loaded_world(&mut world);
                gen_state.total_chunks = loaded_chunks as u32;
                gen_state.chunks_completed = gen_state.total_chunks;
                gen_state.is_complete = true;
                gen_state.loading_from_disk = true;
                gen_state.start_time = None;
                gen_state.world_stats = WorldStats::default();

                if world_load::enforce_bedrock_floor(&mut world) {
                    info!("Enforced bedrock floor at y={}", BEDROCK_DEPTH);
                    world_load::try_save_world(&world, &persistence_settings);
                }

                info!("World loaded successfully!");
            }
            Err(err) => {
                warn!(
                    "Failed to load saved world: {}. Generating new world...",
                    err
                );
                request_world_generation(&mut gen_state, &mut pending_generation);
            }
        }
    }
}

pub(crate) fn start_pending_world_generation(
    world: Res<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut pending_generation: ResMut<PendingWorldGeneration>,
    mut generation_queue: ResMut<WorldGenerationQueue>,
    biome_table: Res<BiomeTable>,
) {
    if !pending_generation.requested {
        return;
    }

    pending_generation.requested = false;
    begin_world_generation(&world, &mut gen_state, &mut generation_queue, *biome_table);
}

pub(crate) fn spawn_queued_chunk_generation_tasks(
    mut commands: Commands,
    mut generation_queue: ResMut<WorldGenerationQueue>,
) {
    let Some((chunk_positions, generator, complete)) =
        generation_queue.take_next_batch(WORLD_GENERATION_TASK_SPAWN_BATCH)
    else {
        return;
    };

    let spawned_count = chunk_positions.len();
    let task_pool = AsyncComputeTaskPool::get();
    for chunk_pos in chunk_positions {
        let generator = generator.clone();
        let task = task_pool.spawn(async move {
            let (chunk, stats) = generate_chunk_async(chunk_pos, &generator);
            ChunkGenerationResult { chunk, stats }
        });

        commands.spawn(ChunkGenerationTask { task, chunk_pos });
    }

    if complete {
        info!("Finished spawning queued chunk generation tasks");
    } else {
        debug!(
            "Spawned {} queued chunk generation tasks this frame; {} remaining",
            spawned_count,
            generation_queue.remaining()
        );
    }
}

pub(crate) fn generate_chunk_async(
    chunk_pos: IVec3,
    source: &ChunkTerrainSource,
) -> (Chunk, ChunkStats) {
    match source {
        ChunkTerrainSource::Legacy(generator) => {
            legacy_chunk::generate_legacy_chunk_async(chunk_pos, generator)
        }
        ChunkTerrainSource::WorldSource(bridge, _) => {
            generate_world_source_chunk_async(chunk_pos, bridge)
        }
    }
}

fn generate_world_source_chunk_async(
    chunk_pos: IVec3,
    bridge: &ProceduralWorldSourceTerrainBridge,
) -> (Chunk, ChunkStats) {
    let chunk = build_world_source_chunk(chunk_pos, bridge);
    let stats = collect_chunk_stats_from_chunk(&chunk);
    (chunk, stats)
}

pub(crate) fn poll_chunk_generation_tasks(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut tasks: Query<(Entity, &mut ChunkGenerationTask)>,
    persistence_settings: Res<WorldPersistence>,
    _lod_control: Res<TerrainLodControl>,
) {
    if !should_poll_chunk_generation_tasks(&gen_state) {
        return;
    }

    let mut completed_count = 0u32;
    for (entity, mut task) in tasks.iter_mut() {
        if let Some(result) = block_on(poll_once(&mut task.task)) {
            let ChunkGenerationResult { mut chunk, stats } = result;
            let chunk_pos = task.chunk_pos;
            let uniformity = chunk.uniformity();

            if stats.dungeon_wall > 0 || stats.dungeon_floor > 0 {
                let chunk_world = IVec3::new(
                    chunk_pos.x * CHUNK_SIZE_I32,
                    chunk_pos.y * CHUNK_SIZE_I32,
                    chunk_pos.z * CHUNK_SIZE_I32,
                );
                debug!(
                    "Chunk {:?} (world {:?}): {} dungeon walls, {} floors",
                    chunk_pos, chunk_world, stats.dungeon_wall, stats.dungeon_floor
                );
            }

            gen_state.world_stats.add(&stats, uniformity);

            let initial_lod = initial_lod_for_chunk();
            chunk.set_initial_lod_level(initial_lod);
            world.insert_chunk(chunk);
            mark_surface_nets_halo_dirty(&mut world, chunk_pos);

            commands.entity(entity).despawn();
            completed_count += 1;
        }
    }

    gen_state.chunks_completed += completed_count;

    if completed_count > 0 {
        let progress_pct = (gen_state.progress() * 100.0) as u32;
        let prev_progress_pct = ((gen_state.chunks_completed - completed_count) as f32
            / gen_state.total_chunks as f32
            * 100.0) as u32;

        if progress_pct / 10 > prev_progress_pct / 10 {
            info!(
                "World generation: {}% ({}/{}) chunks",
                progress_pct, gen_state.chunks_completed, gen_state.total_chunks
            );
        }
    }

    if gen_state.chunks_completed >= gen_state.total_chunks {
        gen_state.is_complete = true;
        info!(
            "Terrain mesh build COMPLETE: {} chunks meshed",
            gen_state.chunks_completed
        );

        if let Some(start_time) = gen_state.start_time {
            gen_state.world_stats.log_summary(start_time.elapsed());
        }

        if world_load::enforce_bedrock_floor(&mut world) {
            info!("Enforced bedrock floor at y={}", BEDROCK_DEPTH);
        }

        world_load::try_save_world(&world, &persistence_settings);
    }
}

pub(crate) fn mark_surface_nets_halo_dirty(world: &mut VoxelWorld, chunk_pos: IVec3) {
    world.mark_generation_face_neighbors_dirty(chunk_pos);
}

pub(crate) fn initial_lod_for_chunk() -> LodLevel {
    LodLevel::Lod0
}

pub(crate) fn assign_initial_lods_for_loaded_world(world: &mut VoxelWorld) {
    let positions: Vec<IVec3> = world.chunk_positions().collect();
    for chunk_pos in positions {
        if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
            chunk.set_initial_lod_level(LodLevel::Lod0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::material_biome;

    #[test]
    fn terrain_source_config_selects_legacy_generation() {
        let source = chunk_terrain_source_for_config(
            &TerrainSourceConfig { mode: TerrainSourceMode::Legacy },
            BiomeTable::default(),
        );

        assert!(matches!(source, ChunkTerrainSource::Legacy(_)));
        assert_eq!(source.active_mode(), TerrainSourceMode::Legacy);
    }

    #[test]
    fn terrain_source_config_selects_gpu_world_source_generation() {
        let source = chunk_terrain_source_for_config(
            &TerrainSourceConfig { mode: TerrainSourceMode::GpuWorldSource },
            BiomeTable::default(),
        );

        assert!(matches!(source, ChunkTerrainSource::WorldSource(_, TerrainSourceMode::GpuWorldSource)));
        assert_eq!(source.active_mode(), TerrainSourceMode::GpuWorldSource);
    }

    #[test]
    fn terrain_source_config_selects_explicit_cpu_reference_generation() {
        let source = chunk_terrain_source_for_config(
            &TerrainSourceConfig { mode: TerrainSourceMode::CpuWorldSourceReference },
            BiomeTable::default(),
        );

        assert!(matches!(source, ChunkTerrainSource::WorldSource(_, TerrainSourceMode::CpuWorldSourceReference)));
        assert_eq!(source.active_mode(), TerrainSourceMode::CpuWorldSourceReference);
    }

    #[test]
    fn world_source_generation_preserves_bedrock_and_water_fill() {
        let source = chunk_terrain_source_for_config(
            &TerrainSourceConfig { mode: TerrainSourceMode::GpuWorldSource },
            BiomeTable::default(),
        );
        let (chunk, _stats) = generate_chunk_async(IVec3::ZERO, &source);

        assert_eq!(chunk.get(UVec3::new(0, BEDROCK_DEPTH as u32, 0)), VoxelType::Bedrock);
        let has_water = (0..CHUNK_SIZE).any(|x| {
            (0..CHUNK_SIZE).any(|y| {
                (0..CHUNK_SIZE).any(|z| chunk.get(UVec3::new(x as u32, y as u32, z as u32)) == VoxelType::Water)
            })
        });
        assert!(has_water || chunk.iter_voxels().any(|voxel| *voxel != VoxelType::Air));
    }

    #[test]
    fn world_source_runtime_generation_tags_solid_voxels_with_biome_ids() {
        let source = chunk_terrain_source_for_config(
            &TerrainSourceConfig { mode: TerrainSourceMode::GpuWorldSource },
            BiomeTable::default(),
        );
        let (chunk, _stats) = generate_chunk_async(IVec3::ZERO, &source);

        let tagged_solid = chunk
            .iter_materials()
            .any(|(_, voxel, material)| voxel != VoxelType::Air && voxel != VoxelType::Water && material_biome(material).is_some());
        assert!(tagged_solid);
    }
}
