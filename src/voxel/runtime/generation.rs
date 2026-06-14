use super::*;

// =============================================================================
// Async Chunk Generation
// =============================================================================

/// Result of async chunk generation task.
struct ChunkGenerationResult {
    chunk: Chunk,
    stats: ChunkStats,
}

/// Tracks the state of async world generation.
#[derive(Resource)]
pub struct ChunkGenerationState {
    /// Total number of chunks to generate.
    pub total_chunks: u32,
    /// Number of chunks that have completed generation.
    pub chunks_completed: u32,
    /// Whether generation is complete.
    pub is_complete: bool,
    /// Whether we're loading from disk (not generating).
    pub loading_from_disk: bool,
    /// Accumulated world stats during generation.
    pub(crate) world_stats: WorldStats,
    /// Time when generation started.
    pub(crate) start_time: Option<std::time::Instant>,
}

impl Default for ChunkGenerationState {
    fn default() -> Self {
        Self {
            total_chunks: 0,
            chunks_completed: 0,
            is_complete: true, // Default to complete (no generation needed)
            loading_from_disk: false,
            world_stats: WorldStats::default(),
            start_time: None,
        }
    }
}

impl ChunkGenerationState {
    /// Returns the generation progress as a percentage (0.0 to 1.0).
    pub fn progress(&self) -> f32 {
        if self.total_chunks == 0 {
            return 1.0;
        }
        self.chunks_completed as f32 / self.total_chunks as f32
    }

    /// Returns true if generation is in progress.
    pub fn is_generating(&self) -> bool {
        !self.is_complete && !self.loading_from_disk
    }
}

pub(crate) fn should_poll_chunk_generation_tasks(gen_state: &ChunkGenerationState) -> bool {
    !gen_state.is_complete && !gen_state.loading_from_disk && gen_state.total_chunks > 0
}

/// Component to hold a pending chunk generation task.
#[derive(Component)]
pub(crate) struct ChunkGenerationTask {
    task: Task<ChunkGenerationResult>,
    chunk_pos: IVec3,
}

/// Component to hold an asynchronous saved-world load task.
#[derive(Component)]
pub(crate) struct WorldLoadTask {
    task: Task<Result<VoxelWorld, String>>,
}

#[derive(Resource, Default, Debug)]
pub(crate) struct PendingWorldGeneration {
    pub(crate) requested: bool,
}

#[derive(Resource, Default)]
pub(crate) struct WorldGenerationQueue {
    positions: Vec<IVec3>,
    next_index: usize,
    generator: Option<Arc<TerrainGenerator>>,
}

impl WorldGenerationQueue {
    pub(crate) fn begin(&mut self, positions: Vec<IVec3>, generator: Arc<TerrainGenerator>) {
        self.positions = positions;
        self.next_index = 0;
        self.generator = Some(generator);
    }

    pub(crate) fn remaining(&self) -> usize {
        self.positions.len().saturating_sub(self.next_index)
    }

    pub(crate) fn take_next_batch(
        &mut self,
        max_batch_size: usize,
    ) -> Option<(Vec<IVec3>, Arc<TerrainGenerator>, bool)> {
        if self.remaining() == 0 {
            self.positions.clear();
            self.next_index = 0;
            self.generator = None;
            return None;
        }

        let generator = Arc::clone(self.generator.as_ref()?);
        let batch_size = max_batch_size.max(1);
        let end_index = (self.next_index + batch_size).min(self.positions.len());
        let batch = self.positions[self.next_index..end_index].to_vec();
        self.next_index = end_index;
        let complete = self.remaining() == 0;

        if complete {
            self.positions.clear();
            self.next_index = 0;
            self.generator = None;
        }

        Some((batch, generator, complete))
    }
}
// =============================================================================
// World Setup
// =============================================================================

/// Debug flag to generate a flat world for testing. Disabled by default.
const DEBUG_FLAT_WORLD: bool = false;

fn should_attempt_saved_world_load(persistence_settings: &WorldPersistence) -> bool {
    if env_flag("VOXEL_REGENERATE_WATER_BODIES")
        || env_flag("VOXEL_FORCE_REGENERATE_WORLD")
        || env_flag("VOXEL_FORCE_REGENERATE_WATER")
    {
        match persistence::delete_saved_world_at_path(&persistence_settings.path) {
            Ok(()) => info!(
                "Water body regeneration requested; deleted saved world so terrain can regenerate"
            ),
            Err(e) => warn!("Failed to delete saved world for water regeneration: {}", e),
        }
        return false;
    }

    if persistence_settings.force_regenerate {
        return false;
    }

    if !persistence::saved_world_exists_at_path(&persistence_settings.path) {
        return false;
    }

    true
}

fn load_saved_world_for_runtime(
    persistence_settings: &WorldPersistence,
) -> Result<VoxelWorld, String> {
    if env_flag("DRUSNIEL_EDITOR_NATIVE_VIEWPORT")
        || persistence_settings.allow_terrain_fingerprint_mismatch
    {
        info!("Loading saved world data without terrain fingerprint validation...");
        return persistence::read_world_data_from_path(&persistence_settings.path)
            .map(VoxelWorld::from_data)
            .map_err(|err| err.to_string());
    }

    info!(
        "Loading saved world from {}...",
        persistence_settings.path.display()
    );
    persistence::load_world_from_path(&persistence_settings.path).map_err(|err| err.to_string())
}

pub(crate) fn expected_world_chunk_count(size_chunks: IVec3) -> usize {
    if size_chunks.x <= 0 || size_chunks.y <= 0 || size_chunks.z <= 0 {
        return 0;
    }

    size_chunks.x as usize * size_chunks.y as usize * size_chunks.z as usize
}

fn enforce_bedrock_floor(world: &mut VoxelWorld) -> bool {
    let mut changed = false;

    let chunk_positions: Vec<IVec3> = world.chunk_positions().collect();
    for chunk_pos in chunk_positions {
        let chunk_min_y = chunk_pos.y * CHUNK_SIZE_I32;
        let chunk_max_y = chunk_min_y + CHUNK_SIZE_I32 - 1;

        if BEDROCK_DEPTH < chunk_min_y {
            continue;
        }

        let max_local_y = if BEDROCK_DEPTH >= chunk_max_y {
            CHUNK_SIZE_I32 - 1
        } else {
            BEDROCK_DEPTH - chunk_min_y
        };

        if max_local_y < 0 {
            continue;
        }

        let mut chunk_changed = false;
        let Some(mut chunk) = world.get_chunk_mut(chunk_pos) else {
            continue;
        };
        for x in 0..CHUNK_SIZE {
            for z in 0..CHUNK_SIZE {
                for y in 0..=max_local_y as u32 {
                    let local = UVec3::new(x as u32, y, z as u32);
                    if chunk.get(local) != VoxelType::Bedrock {
                        chunk.set(local, VoxelType::Bedrock);
                        chunk_changed = true;
                    }
                }
            }
        }

        if chunk_changed {
            chunk.mark_dirty_with_reason(MeshDirtyReason::Generation);
            changed = true;
        }
    }

    changed
}

/// Statistics for a generated chunk.
#[derive(Default)]
pub(crate) struct ChunkStats {
    sand: u32,
    dungeon_wall: u32,
    dungeon_floor: u32,
    wood: u32,
    leaves: u32,
}

/// Aggregate statistics for world generation.
#[derive(Default)]
pub(crate) struct WorldStats {
    total_sand: u32,
    total_dungeon_wall: u32,
    total_dungeon_floor: u32,
    total_wood: u32,
    total_leaves: u32,
    // Uniformity statistics
    empty_chunks: u32,
    solid_chunks: u32,
    mixed_chunks: u32,
}

impl WorldStats {
    fn add(&mut self, chunk_stats: &ChunkStats, uniformity: ChunkUniformity) {
        self.total_sand += chunk_stats.sand;
        self.total_dungeon_wall += chunk_stats.dungeon_wall;
        self.total_dungeon_floor += chunk_stats.dungeon_floor;
        self.total_wood += chunk_stats.wood;
        self.total_leaves += chunk_stats.leaves;

        match uniformity {
            ChunkUniformity::Empty => self.empty_chunks += 1,
            ChunkUniformity::Solid => self.solid_chunks += 1,
            ChunkUniformity::Mixed => self.mixed_chunks += 1,
            ChunkUniformity::Unknown => {} // Shouldn't happen after compute_uniformity
        }
    }

    fn log_summary(&self, generation_time: std::time::Duration) {
        let total_chunks = self.empty_chunks + self.solid_chunks + self.mixed_chunks;
        let skippable = self.empty_chunks + self.solid_chunks;
        let skip_percent = if total_chunks > 0 {
            (skippable as f32 / total_chunks as f32) * 100.0
        } else {
            0.0
        };

        info!("=== WORLD GENERATION SUMMARY ===");
        info!("Generation time: {:.2}s", generation_time.as_secs_f32());
        info!("--- Chunk Uniformity (mesh optimization) ---");
        info!(
            "  Empty chunks (all air): {} ({:.1}% of total)",
            self.empty_chunks,
            (self.empty_chunks as f32 / total_chunks as f32) * 100.0
        );
        info!(
            "  Solid chunks (no internal surfaces): {} ({:.1}% of total)",
            self.solid_chunks,
            (self.solid_chunks as f32 / total_chunks as f32) * 100.0
        );
        info!(
            "  Mixed chunks (need full meshing): {} ({:.1}% of total)",
            self.mixed_chunks,
            (self.mixed_chunks as f32 / total_chunks as f32) * 100.0
        );
        info!(
            "  Skippable chunks: {}/{} ({:.1}%)",
            skippable, total_chunks, skip_percent
        );
        info!("--- Block Statistics ---");
        info!("  Sand blocks: {}", self.total_sand);
        info!("  Dungeon wall blocks: {}", self.total_dungeon_wall);
        info!("  Dungeon floor blocks: {}", self.total_dungeon_floor);
        info!("  Wood blocks: {}", self.total_wood);
        info!("  Leaves blocks: {}", self.total_leaves);
    }
}

/// Saves the world if auto_save is enabled.
fn try_save_world(world: &VoxelWorld, persistence_settings: &WorldPersistence) {
    if !persistence_settings.auto_save {
        return;
    }

    info!("Saving world to disk...");
    match persistence::save_world_to_path(world, &persistence_settings.path) {
        Ok(()) => info!("World saved successfully!"),
        Err(e) => warn!("Failed to save world: {}", e),
    }
}

/// Main world setup system - spawns async chunk generation tasks.
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

    if should_attempt_saved_world_load(&persistence_settings) {
        gen_state.total_chunks = 0;
        gen_state.chunks_completed = 0;
        gen_state.is_complete = false;
        gen_state.loading_from_disk = true;
        gen_state.world_stats = WorldStats::default();
        gen_state.start_time = Some(std::time::Instant::now());

        let persistence_settings = persistence_settings.clone();
        let task = AsyncComputeTaskPool::get()
            .spawn(async move { load_saved_world_for_runtime(&persistence_settings) });
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

    let generator = Arc::new(TerrainGenerator::with_biome_table(
        ValueNoise::default(),
        biome_table,
    ));
    generation_queue.begin(chunk_positions, generator);
    info!(
        "Queued {} async chunk generation tasks for batched startup spawning",
        total_chunks
    );
}

/// Polls the asynchronous saved-world load before starting generation fallback.
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

                if enforce_bedrock_floor(&mut world) {
                    info!("Enforced bedrock floor at y={}", BEDROCK_DEPTH);
                    try_save_world(&world, &persistence_settings);
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
        let generator = Arc::clone(&generator);
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
/// Generates a single chunk using the terrain generator (for async execution).
#[derive(Clone, Copy)]
struct TerrainColumn {
    terrain_height: i32,
    biome: Biome,
    water: WaterGenerationMetadata,
    tree: Option<GeneratedTree>,
}

#[derive(Clone, Copy)]
struct GeneratedTree {
    world_x: i32,
    world_z: i32,
    trunk_top: i32,
    leaf_center_y: i32,
}

pub(crate) fn generate_chunk_async(
    chunk_pos: IVec3,
    generator: &TerrainGenerator,
) -> (Chunk, ChunkStats) {
    let chunk_world_x = chunk_pos.x * CHUNK_SIZE_I32;
    let chunk_world_z = chunk_pos.z * CHUNK_SIZE_I32;
    let chunk_world_y = chunk_pos.y * CHUNK_SIZE_I32;

    let mut voxels = [VoxelType::Air; CHUNK_VOLUME];

    if DEBUG_FLAT_WORLD {
        for z in 0..CHUNK_SIZE {
            for y in 0..CHUNK_SIZE {
                let world_y = chunk_world_y + y as i32;
                let voxel = if world_y <= 12 {
                    VoxelType::TopSoil
                } else {
                    VoxelType::Air
                };
                for x in 0..CHUNK_SIZE {
                    voxels[Chunk::index(x, y, z)] = voxel;
                }
            }
        }
    } else {
        let columns = precompute_terrain_columns(chunk_world_x, chunk_world_z, generator);
        fill_chunk_voxels(
            &mut voxels,
            &columns,
            chunk_world_x,
            chunk_world_y,
            chunk_world_z,
            generator,
        );
        let trees = precompute_overlapping_trees(chunk_world_x, chunk_world_z, &columns, generator);
        paint_tree_leaves(
            &mut voxels,
            &columns,
            &trees,
            chunk_world_x,
            chunk_world_y,
            chunk_world_z,
        );
    }

    let stats = collect_chunk_stats(&voxels);
    let chunk = Chunk::with_voxels(chunk_pos, voxels);
    (chunk, stats)
}

fn precompute_terrain_columns(
    chunk_world_x: i32,
    chunk_world_z: i32,
    generator: &TerrainGenerator,
) -> [TerrainColumn; CHUNK_SIZE * CHUNK_SIZE] {
    std::array::from_fn(|index| {
        let x = index % CHUNK_SIZE;
        let z = index / CHUNK_SIZE;
        let world_x = chunk_world_x + x as i32;
        let world_z = chunk_world_z + z as i32;
        let (terrain_height, water) =
            generator.get_height_and_water_generation_metadata(world_x, world_z);
        let biome = generator.get_biome(world_x, world_z);
        let tree = tree_at(generator, world_x, world_z, terrain_height);
        TerrainColumn {
            terrain_height,
            biome,
            water,
            tree,
        }
    })
}

fn precompute_overlapping_trees(
    chunk_world_x: i32,
    chunk_world_z: i32,
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    generator: &TerrainGenerator,
) -> Vec<GeneratedTree> {
    let min_x = chunk_world_x - TREE_LEAF_CHECK_RADIUS;
    let max_x = chunk_world_x + CHUNK_SIZE_I32 - 1 + TREE_LEAF_CHECK_RADIUS;
    let min_z = chunk_world_z - TREE_LEAF_CHECK_RADIUS;
    let max_z = chunk_world_z + CHUNK_SIZE_I32 - 1 + TREE_LEAF_CHECK_RADIUS;
    let mut trees = Vec::new();

    for world_z in min_z..=max_z {
        for world_x in min_x..=max_x {
            let terrain_height = tree_scan_terrain_height(
                chunk_world_x,
                chunk_world_z,
                columns,
                generator,
                world_x,
                world_z,
            );
            if let Some(tree) = tree_at(generator, world_x, world_z, terrain_height) {
                trees.push(tree);
            }
        }
    }

    trees
}

fn tree_scan_terrain_height(
    chunk_world_x: i32,
    chunk_world_z: i32,
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    generator: &TerrainGenerator,
    world_x: i32,
    world_z: i32,
) -> i32 {
    let local_x = world_x - chunk_world_x;
    let local_z = world_z - chunk_world_z;
    if (0..CHUNK_SIZE_I32).contains(&local_x) && (0..CHUNK_SIZE_I32).contains(&local_z) {
        columns[column_index(local_x as usize, local_z as usize)].terrain_height
    } else {
        generator
            .get_height_and_water_generation_metadata(world_x, world_z)
            .0
    }
}

fn tree_at(
    generator: &TerrainGenerator,
    world_x: i32,
    world_z: i32,
    terrain_height: i32,
) -> Option<GeneratedTree> {
    if !generator.should_spawn_tree(world_x, world_z, terrain_height) {
        return None;
    }

    let trunk_height = generator.get_tree_height(world_x, world_z);
    let trunk_top = terrain_height + 1 + trunk_height;
    Some(GeneratedTree {
        world_x,
        world_z,
        trunk_top,
        leaf_center_y: trunk_top - 1,
    })
}

fn fill_chunk_voxels(
    voxels: &mut [VoxelType; CHUNK_VOLUME],
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    chunk_world_x: i32,
    chunk_world_y: i32,
    chunk_world_z: i32,
    generator: &TerrainGenerator,
) {
    for x in 0..CHUNK_SIZE {
        for z in 0..CHUNK_SIZE {
            let world_x = chunk_world_x + x as i32;
            let world_z = chunk_world_z + z as i32;
            let column = columns[column_index(x, z)];

            for y in 0..CHUNK_SIZE {
                let world_y = chunk_world_y + y as i32;
                voxels[Chunk::index(x, y, z)] =
                    voxel_from_column(generator, column, world_x, world_y, world_z);
            }
        }
    }
}

fn voxel_from_column(
    generator: &TerrainGenerator,
    column: TerrainColumn,
    world_x: i32,
    world_y: i32,
    world_z: i32,
) -> VoxelType {
    if world_y <= BEDROCK_DEPTH {
        return VoxelType::Bedrock;
    }

    if generator.is_cave(world_x, world_y, world_z, column.terrain_height) {
        return if generator.is_cave_aquifer(world_x, world_y, world_z) {
            VoxelType::Water
        } else {
            VoxelType::Air
        };
    }

    if column
        .tree
        .is_some_and(|tree| world_y >= column.terrain_height + 1 && world_y < tree.trunk_top)
    {
        return VoxelType::Wood;
    }

    if world_y > column.terrain_height {
        return if column.water.is_surface_water() && world_y <= column.water.surface_y {
            VoxelType::Water
        } else {
            VoxelType::Air
        };
    }

    let depth = column.terrain_height - world_y;
    let near_water = column.terrain_height <= WATER_LEVEL + BEACH_HEIGHT_OFFSET;
    generator.get_biome_voxel(column.biome, depth, near_water)
}

fn paint_tree_leaves(
    voxels: &mut [VoxelType; CHUNK_VOLUME],
    columns: &[TerrainColumn; CHUNK_SIZE * CHUNK_SIZE],
    trees: &[GeneratedTree],
    chunk_world_x: i32,
    chunk_world_y: i32,
    chunk_world_z: i32,
) {
    let chunk_max_x = chunk_world_x + CHUNK_SIZE_I32 - 1;
    let chunk_max_y = chunk_world_y + CHUNK_SIZE_I32 - 1;
    let chunk_max_z = chunk_world_z + CHUNK_SIZE_I32 - 1;
    let leaf_radius_sq = TREE_LEAF_RADIUS * TREE_LEAF_RADIUS;

    for tree in trees {
        let min_x = (tree.world_x - TREE_LEAF_CHECK_RADIUS).max(chunk_world_x);
        let max_x = (tree.world_x + TREE_LEAF_CHECK_RADIUS).min(chunk_max_x);
        let min_z = (tree.world_z - TREE_LEAF_CHECK_RADIUS).max(chunk_world_z);
        let max_z = (tree.world_z + TREE_LEAF_CHECK_RADIUS).min(chunk_max_z);

        for world_z in min_z..=max_z {
            for world_x in min_x..=max_x {
                let local_x = (world_x - chunk_world_x) as usize;
                let local_z = (world_z - chunk_world_z) as usize;
                let column = columns[column_index(local_x, local_z)];
                let dx = tree.world_x - world_x;
                let dz = tree.world_z - world_z;
                let xz_dist_sq = (dx * dx + dz * dz) as f32;
                if xz_dist_sq >= leaf_radius_sq {
                    continue;
                }

                for world_y in chunk_world_y..=chunk_max_y {
                    if world_y <= column.terrain_height {
                        continue;
                    }

                    let dy = world_y - tree.leaf_center_y;
                    let dist_sq = xz_dist_sq + (dy * dy) as f32 * 1.5;
                    if dist_sq >= leaf_radius_sq {
                        continue;
                    }
                    if dx == 0 && dz == 0 && world_y < tree.trunk_top {
                        continue;
                    }

                    let local_y = (world_y - chunk_world_y) as usize;
                    let index = Chunk::index(local_x, local_y, local_z);
                    if voxels[index] != VoxelType::Wood {
                        voxels[index] = VoxelType::Leaves;
                    }
                }
            }
        }
    }
}

#[inline]
fn column_index(x: usize, z: usize) -> usize {
    x + z * CHUNK_SIZE
}

fn collect_chunk_stats(voxels: &[VoxelType; CHUNK_VOLUME]) -> ChunkStats {
    let mut stats = ChunkStats::default();
    for &voxel in voxels {
        match voxel {
            VoxelType::Sand => stats.sand += 1,
            VoxelType::DungeonWall => stats.dungeon_wall += 1,
            VoxelType::DungeonFloor => stats.dungeon_floor += 1,
            VoxelType::Wood => stats.wood += 1,
            VoxelType::Leaves => stats.leaves += 1,
            _ => {}
        }
    }
    stats
}

/// Polls completed chunk generation tasks and inserts chunks into the world.
pub(crate) fn poll_chunk_generation_tasks(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut gen_state: ResMut<ChunkGenerationState>,
    mut tasks: Query<(Entity, &mut ChunkGenerationTask)>,
    persistence_settings: Res<WorldPersistence>,
    _lod_control: Res<TerrainLodControl>,
) {
    // NOTE: LOD freeze (Alt+F6) does NOT halt chunk insertion. Freeze only pauses LOD
    // *reassignment* (enforced via `freeze_lod` in the LOD-update system), so already
    // loaded chunks keep their LOD while you inspect, while newly generated chunks still
    // pop in. Halting insertion here made freeze look like loading was permanently stuck
    // (the "always frozen" symptom), especially in bench mode where LOD auto-freezes.
    // Skip until actual generation work has been queued.
    if !should_poll_chunk_generation_tasks(&gen_state) {
        return;
    }

    // Poll all pending tasks
    let mut completed_count = 0u32;
    for (entity, mut task) in tasks.iter_mut() {
        if let Some(result) = block_on(poll_once(&mut task.task)) {
            let ChunkGenerationResult { mut chunk, stats } = result;
            // Task completed - insert chunk into world
            let chunk_pos = task.chunk_pos;
            let uniformity = chunk.uniformity();

            // Log chunks with dungeon content
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

            // Update stats
            gen_state.world_stats.add(&stats, uniformity);

            // Insert chunk into world
            let initial_lod = initial_lod_for_chunk();
            chunk.set_initial_lod_level(initial_lod);
            world.insert_chunk(chunk);
            mark_surface_nets_halo_dirty(&mut world, chunk_pos);

            // Despawn the task entity
            commands.entity(entity).despawn();

            completed_count += 1;
        }
    }

    gen_state.chunks_completed += completed_count;

    // Log progress periodically (every 10%)
    if completed_count > 0 {
        let progress_pct = (gen_state.progress() * 100.0) as u32;
        let prev_progress_pct = ((gen_state.chunks_completed - completed_count) as f32
            / gen_state.total_chunks as f32
            * 100.0) as u32;

        // Log at 10% intervals
        if progress_pct / 10 > prev_progress_pct / 10 {
            info!(
                "World generation: {}% ({}/{} chunks)",
                progress_pct, gen_state.chunks_completed, gen_state.total_chunks
            );
        }
    }

    // Check if generation is complete
    if gen_state.chunks_completed >= gen_state.total_chunks {
        gen_state.is_complete = true;
        info!(
            "Terrain mesh build COMPLETE: {} chunks meshed",
            gen_state.chunks_completed
        );

        if let Some(start_time) = gen_state.start_time {
            gen_state.world_stats.log_summary(start_time.elapsed());
        }

        // Apply bedrock floor
        if enforce_bedrock_floor(&mut world) {
            info!("Enforced bedrock floor at y={}", BEDROCK_DEPTH);
        }

        // Save world
        try_save_world(&world, &persistence_settings);
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
