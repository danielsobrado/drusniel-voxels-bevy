use super::*;

pub(crate) fn should_attempt_saved_world_load(persistence_settings: &WorldPersistence) -> bool {
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

pub(crate) fn load_saved_world_for_runtime(
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

pub(crate) fn enforce_bedrock_floor(world: &mut VoxelWorld) -> bool {
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

pub(crate) fn try_save_world(world: &VoxelWorld, persistence_settings: &WorldPersistence) {
    if !persistence_settings.auto_save {
        return;
    }

    info!("Saving world to disk...");
    match persistence::save_world_to_path(world, &persistence_settings.path) {
        Ok(()) => info!("World saved successfully!"),
        Err(e) => warn!("Failed to save world: {}", e),
    }
}
