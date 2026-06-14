use super::*;

/// Adjusts LOD settings for integrated GPUs to maintain performance.
///
/// This system runs once at startup and reduces view distances when an
/// integrated GPU is detected.
pub(crate) fn adjust_lod_for_integrated_gpu(
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut lod_settings: ResMut<LodSettings>,
    _mesh_settings: ResMut<MeshSettings>,
    mut applied: Local<bool>,
) {
    if *applied {
        return;
    }

    let Some(capabilities) = capabilities else {
        return;
    };

    if capabilities.adapter_name.is_none() {
        return;
    }

    if capabilities.integrated_gpu {
        lod_settings.high_detail_distance = INTEGRATED_GPU_HIGH_DETAIL_DISTANCE;
        lod_settings.cull_distance = INTEGRATED_GPU_CULL_DISTANCE;
        lod_settings.clamp_distance_bands();
        lod_settings.low_detail_mode = MeshMode::Blocky;
        // Keep mesh_settings.mode as SurfaceNets for nearby chunks (V0.3 triplanar PBR look)
        // Only distant LOD chunks use Blocky mode for performance
        info!(
            "Integrated GPU detected; using more aggressive LOD distances, keeping SurfaceNets for nearby terrain."
        );
    }

    *applied = true;
}

// =============================================================================
// Visibility Optimization Systems
// =============================================================================

/// Updates face visibility for chunks that have been modified.
///
/// This computes the 15-bit connectivity mask indicating which chunk faces
/// can see each other through air voxels. Used by the BFS occlusion system.
pub(crate) fn update_chunk_face_visibility_system(
    mut world: ResMut<VoxelWorld>,
    config: Res<OcclusionConfig>,
    time: Res<Time>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut scan_accum: Local<f32>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Face Visibility");
    // Skip only when the master switch is disabled; enclosure detection consumes these masks.
    if !config.enabled {
        return;
    }

    // The masks are only consumed by the throttled enclosure/BFS systems, so
    // scan for dirty chunks at the same cadence instead of every frame.
    *scan_accum += time.delta_secs();
    if *scan_accum < config.update_interval {
        return;
    }
    *scan_accum = 0.0;

    // Collect positions of chunks needing visibility update
    let dirty_positions: Vec<IVec3> = world
        .chunk_entries()
        .filter(|(_, chunk)| chunk.is_visibility_dirty())
        .map(|(pos, _)| *pos)
        .collect();

    for pos in dirty_positions {
        if let Some(mut chunk) = world.get_chunk_mut(pos) {
            // Ensure uniformity is computed first (needed by visibility algorithm)
            chunk.compute_uniformity();
            let visibility = compute_face_visibility(&chunk);
            chunk.set_face_visibility(visibility);
            chunk.clear_visibility_dirty();
        }
    }
}

/// Applies enclosure-only visibility culling to terrain chunk meshes.
pub fn apply_visibility_culling_system(
    config: Res<OcclusionConfig>,
    enclosure: Res<EnclosureState>,
    visible_chunks: Res<VisibleChunks>,
    mut stats: ResMut<EnclosureOcclusionStats>,
    mut chunk_meshes: Query<(&ChunkMesh, &mut Visibility)>,
    mut was_enabled: Local<bool>,
) {
    if !config.is_active(enclosure.mode) {
        if *was_enabled {
            for (_, mut visibility) in &mut chunk_meshes {
                if *visibility == Visibility::Hidden {
                    *visibility = Visibility::Inherited;
                }
            }
            stats.hidden_chunks = 0;
            stats.total_chunks = 0;
            *was_enabled = false;
        }
        return;
    }

    *was_enabled = true;
    stats.hidden_chunks = 0;
    stats.total_chunks = 0;

    for (chunk_mesh, mut visibility) in &mut chunk_meshes {
        let is_visible = visible_chunks.is_visible(chunk_mesh.chunk_position);
        let target = if is_visible {
            Visibility::Inherited
        } else {
            Visibility::Hidden
        };
        if *visibility != target {
            *visibility = target;
        }
        stats.total_chunks += 1;
        if !is_visible {
            stats.hidden_chunks += 1;
        }
    }
}

// =============================================================================
// LOD System
// =============================================================================

/// Updates the LOD level of each chunk based on distance from the camera.
///
/// Chunks are assigned to one of three LOD levels:
/// - `High`: Close to camera, uses full detail meshing
/// - `Low`: Medium distance, uses simplified meshing
/// - `Culled`: Far away, not rendered at all
///
/// Uses hysteresis to prevent rapid LOD switching when camera is near thresholds.
/// Throttled to every 0.25s. Stationary scans run only while new chunks arrive
/// or prior LOD work is still draining, so chunks can converge after loading
/// without paying a permanent full-world scan cost.
pub(crate) fn update_chunk_lod_system(
    mut world: ResMut<VoxelWorld>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    page_mesh_gate: Option<Res<crate::voxel::pages::ClodPageMeshGate>>,
    lod_control: Res<TerrainLodControl>,
    lod_transaction: Res<LodMeshTransactionState>,
    mut lod_transitions: ResMut<TerrainLodTransitionState>,
    time: Res<Time>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut last_update: Local<f32>,
    mut last_camera_pos: Local<Option<Vec3>>,
    mut last_chunk_count: Local<Option<usize>>,
    mut stationary_lod_scans_remaining: Local<u8>,
) {
    let timing_enabled = timing.enabled;
    let mut lod_desired_us = 0u64;
    let mut lod_candidates_us = 0u64;
    let mut lod_commit_us = 0u64;
    let _timer = area_timer(&mut timing, frame.0, "LOD Update");
    lod_transitions.repeated_chunks_this_frame = 0;
    if lod_control.freeze_lod {
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    }
    if lod_transaction.active.is_some() {
        refresh_lod_change_rate(time.elapsed_secs(), &mut lod_transitions);
        drop(_timer);
        timing.record_count(
            frame.0,
            "Terrain LOD Update Paused For Mesh Transaction",
            1.0,
        );
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    }

    // Throttle to ~4Hz (every 0.25s)
    let now = time.elapsed_secs();
    if now - *last_update < 0.25 {
        refresh_lod_change_rate(now, &mut lod_transitions);
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        refresh_lod_change_rate(now, &mut lod_transitions);
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    };

    let camera_pos = camera_transform.translation;
    let chunk_count = world.chunk_entries().count();
    let camera_moved = last_camera_pos
        .map(|prev| camera_pos.distance_squared(prev) >= 4.0)
        .unwrap_or(true);
    let chunk_count_changed = last_chunk_count
        .map(|previous| previous != chunk_count)
        .unwrap_or(true);
    if !camera_moved && !chunk_count_changed && *stationary_lod_scans_remaining == 0 {
        *last_update = now;
        refresh_lod_change_rate(now, &mut lod_transitions);
        drop(_timer);
        record_lod_counters(
            &mut timing,
            frame.0,
            0,
            lod_transitions.changes_per_second,
            0,
        );
        return;
    }

    *last_update = now;
    *last_camera_pos = Some(camera_pos);
    *last_chunk_count = Some(chunk_count);

    // Live terrain is now the near-field LOD0 fallback. Pages own far-field
    // detail, so this updater only restores stale/forced live chunks to LOD0.
    let start = timing_enabled.then(Instant::now);
    let mut desired: HashMap<IVec3, LodLevel> = HashMap::new();
    let mut chunk_state: HashMap<IVec3, LodLevel> = HashMap::new();
    for (chunk_pos, chunk) in world.chunk_entries() {
        if page_mesh_gate
            .as_deref()
            .is_some_and(|gate| gate.owns_chunk(*chunk_pos))
            && !chunk.has_dirty_reason(MeshDirtyReason::TerrainMutation)
        {
            continue;
        }
        let current_lod = chunk.lod_level();
        let target_lod = LodLevel::Lod0;
        desired.insert(*chunk_pos, target_lod);
        chunk_state.insert(*chunk_pos, current_lod);
    }
    lod_desired_us += elapsed_us(start);

    let start = timing_enabled.then(Instant::now);
    let mut lod_candidates: Vec<(IVec3, LodLevel, LodLevel, f32)> = Vec::new();
    for (chunk_pos, &target_lod) in &desired {
        let Some(&current_lod) = chunk_state.get(chunk_pos) else {
            continue;
        };
        if target_lod == current_lod {
            continue;
        }
        let cooldown_elapsed = lod_transitions
            .last_change_frame
            .get(chunk_pos)
            .map(|last_frame| frame.0.saturating_sub(*last_frame) >= LOD_CHANGE_COOLDOWN_FRAMES)
            .unwrap_or(true);
        // Cooldown only throttles downgrades; upgrades to higher detail must
        // not be punished or stale LOD states can persist during movement.
        let is_upgrade = target_lod.is_higher_detail_than(current_lod);
        if !is_upgrade && !cooldown_elapsed {
            continue;
        }
        lod_candidates.push((*chunk_pos, current_lod, target_lod, 0.0));
    }

    lod_candidates.sort_by(|a, b| {
        let a_upgrade = a.2.is_higher_detail_than(a.1);
        let b_upgrade = b.2.is_higher_detail_than(b.1);
        b_upgrade
            .cmp(&a_upgrade)
            .then_with(|| a.3.partial_cmp(&b.3).unwrap_or(std::cmp::Ordering::Equal))
    });
    lod_candidates_us += elapsed_us(start);

    let lod_candidate_count = lod_candidates.len();
    let mut lod_changed: Vec<IVec3> = Vec::new();
    let mut voluntary_count = 0usize;
    let start = timing_enabled.then(Instant::now);
    for (chunk_pos, _current_lod, target_lod, _distance) in lod_candidates {
        if voluntary_count >= MAX_LOD_CHANGES_PER_UPDATE {
            continue;
        }
        voluntary_count += 1;
        let Some(mut chunk) = world.get_chunk_mut(chunk_pos) else {
            continue;
        };
        if !chunk.set_lod_level(target_lod) {
            continue;
        }
        lod_transitions.last_change_frame.insert(chunk_pos, frame.0);
        let change_count = lod_transitions.change_count.entry(chunk_pos).or_insert(0);
        *change_count += 1;
        if *change_count > 1 {
            lod_transitions.repeated_chunks_this_frame += 1;
        }
        lod_changed.push(chunk_pos);
    }
    lod_commit_us += elapsed_us(start);

    lod_transitions.changes_this_second += lod_changed.len() as u32;
    refresh_lod_change_rate(now, &mut lod_transitions);

    let lod_changed_count = lod_changed.len() as u32;
    if lod_candidate_count > lod_changed.len() || !lod_changed.is_empty() {
        *stationary_lod_scans_remaining = 1;
    } else {
        *stationary_lod_scans_remaining = 0;
    }

    if !lod_transitions.last_change_frame.is_empty() && frame.0 % 600 == 0 {
        lod_transitions
            .last_change_frame
            .retain(|_, last_frame| frame.0.saturating_sub(*last_frame) < 3_600);
        let active_change_frames = lod_transitions.last_change_frame.clone();
        lod_transitions
            .change_count
            .retain(|chunk_pos, _| active_change_frames.contains_key(chunk_pos));
    }
    let repeated_chunks_this_frame = lod_transitions.repeated_chunks_this_frame;
    let changes_per_second = lod_transitions.changes_per_second;
    drop(_timer);
    timing.record_area(frame.0, "LOD Desired CPU", lod_desired_us);
    timing.record_area(frame.0, "LOD Candidates CPU", lod_candidates_us);
    timing.record_area(frame.0, "LOD Commit CPU", lod_commit_us);
    record_lod_counters(
        &mut timing,
        frame.0,
        lod_changed_count,
        changes_per_second,
        repeated_chunks_this_frame,
    );
}

fn record_lod_counters(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    changes: u32,
    changes_per_second: f32,
    repeated_chunks: u32,
) {
    timing.record_count(frame, "Terrain LOD Changes", changes as f64);
    timing.record_count(
        frame,
        "Terrain LOD Changes Per Second",
        changes_per_second as f64,
    );
    timing.record_count(frame, "Terrain LOD Repeated Chunks", repeated_chunks as f64);
}

fn elapsed_us(start: Option<Instant>) -> u64 {
    start
        .map(|start| start.elapsed().as_micros() as u64)
        .unwrap_or(0)
}

fn refresh_lod_change_rate(now: f32, lod_transitions: &mut TerrainLodTransitionState) {
    if lod_transitions.last_change_second == 0.0 {
        lod_transitions.last_change_second = now;
        return;
    }
    if now - lod_transitions.last_change_second < 1.0 {
        return;
    }
    let elapsed = (now - lod_transitions.last_change_second).max(0.001);
    lod_transitions.changes_per_second = lod_transitions.changes_this_second as f32 / elapsed;
    lod_transitions.changes_this_second = 0;
    lod_transitions.last_change_second = now;
}
