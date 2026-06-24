use super::*;

#[derive(Resource, Default, Debug)]
pub(crate) struct MeshDirtyQueueWarningState {
    last_warn_secs: Option<f32>,
}

impl MeshDirtyQueueWarningState {
    pub(crate) fn should_warn(&mut self, now_secs: f32) -> bool {
        let should_warn = self
            .last_warn_secs
            .map(|last| now_secs - last >= MESH_DIRTY_QUEUE_WARN_INTERVAL_SECS)
            .unwrap_or(true);
        if should_warn {
            self.last_warn_secs = Some(now_secs);
        }
        should_warn
    }
}
#[derive(Default)]
pub(crate) struct MeshDirtyReasonCounts {
    pub(crate) lod: u32,
    pub(crate) neighbor_lod: u32,
    pub(crate) generation: u32,
    pub(crate) water_material: u32,
    pub(crate) terrain_mutation: u32,
}

impl MeshDirtyReasonCounts {
    fn add_flags(&mut self, flags: u8) {
        if flags & MeshDirtyReason::Lod.bit() != 0 {
            self.lod += 1;
        }
        if flags & MeshDirtyReason::NeighborLod.bit() != 0 {
            self.neighbor_lod += 1;
        }
        if flags & MeshDirtyReason::Generation.bit() != 0 {
            self.generation += 1;
        }
        if flags & MeshDirtyReason::WaterMaterial.bit() != 0 {
            self.water_material += 1;
        }
        if flags & MeshDirtyReason::TerrainMutation.bit() != 0 {
            self.terrain_mutation += 1;
        }
    }
}

pub(crate) fn chunks_per_frame_limit_for_dirty_meshes(
    reason_counts: &MeshDirtyReasonCounts,
    lod_churn_only: bool,
    generation_complete: bool,
) -> usize {
    if lod_churn_only {
        return MAX_LOD_TRANSACTION_CHUNKS_PER_FRAME;
    }

    if generation_complete && reason_counts.generation > 0 && reason_counts.terrain_mutation == 0 {
        return MAX_STARTUP_CHUNKS_PER_FRAME;
    }

    MAX_CHUNKS_PER_FRAME
}

#[derive(SystemParam)]
pub(crate) struct MeshDirtyTimingParams<'w> {
    frame: Res<'w, FrameCount>,
    time: Res<'w, Time>,
    timing: ResMut<'w, AreaTimingRecorder>,
    gen_state: Res<'w, ChunkGenerationState>,
    lod_transaction: ResMut<'w, LodMeshTransactionState>,
    queue_warning: ResMut<'w, MeshDirtyQueueWarningState>,
    page_runtime: Option<Res<'w, crate::voxel::pages::runtime::ClodPagesRuntime>>,
    page_cache: Option<ResMut<'w, crate::voxel::pages::runtime::PageExportCache>>,
    page_mesh_gate: Option<Res<'w, crate::voxel::pages::ClodPageMeshGate>>,
}

#[derive(SystemParam)]
pub(crate) struct McSpikeMeshParams<'w> {
    pub(crate) settings: Res<'w, McTransvoxelSettings>,
    pub(crate) stats: ResMut<'w, McTransvoxelRuntimeStats>,
}

#[derive(SystemParam)]
pub(crate) struct BenchMeshForensicsParams<'w> {
    toggles: Option<Res<'w, BenchRenderToggles>>,
    forensics: Option<Res<'w, BenchForensicsConfig>>,
}

pub(crate) fn mesh_dirty_chunks_system(
    mut commands: Commands,
    mut world: ResMut<VoxelWorld>,
    mut meshes: ResMut<Assets<Mesh>>,
    blocky_material: Option<Res<VoxelMaterial>>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    water_material: Res<WaterMaterial>,
    bench_params: BenchMeshForensicsParams,
    mesh_settings: Res<MeshSettings>,
    lod_settings: Res<LodSettings>,
    mut mc_spike: McSpikeMeshParams,
    ao_config: Res<AmbientOcclusionConfig>,
    mut chunk_stats: ResMut<RuntimeChunkStats>,
    mut material_logged: Local<bool>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
    mut timing_params: MeshDirtyTimingParams,
) {
    let frame = &timing_params.frame;
    let timing = &mut timing_params.timing;
    let generation_complete = timing_params.gen_state.is_complete;
    let mesh_dirty_total_start = timing.enabled.then(Instant::now);
    // Reset per-frame counters
    chunk_stats.reset_frame_counters();
    mc_spike.stats.chunks_meshed_this_frame = 0;

    // Wait for blocky material to be loaded before processing chunks.
    let blocky_material = if let Some(mat) = blocky_material {
        if !*material_logged {
            debug!("Blocky material loaded, mesh processing enabled");
            *material_logged = true;
        }
        Some(mat)
    } else {
        None
    };

    if matches!(mesh_settings.mode, MeshMode::Blocky) && blocky_material.is_none() {
        // Material not yet loaded - this is expected during startup
        return;
    }

    // Collect dirty chunks and sort by distance from camera (nearest first)
    // This prioritizes meshing chunks close to the player for better visual quality
    let mut dirty_chunks: Vec<IVec3> = world.dirty_chunks().collect();
    let dirty_chunks_seen = dirty_chunks.len();
    let mut chunks_skipped_page_owned = 0u32;
    if let Some(gate) = timing_params.page_mesh_gate.as_deref() {
        if gate.pages_ready {
            let mut live_dirty_chunks = Vec::with_capacity(dirty_chunks.len());
            for chunk_pos in dirty_chunks {
                let terrain_mutation = world
                    .get_chunk(chunk_pos)
                    .is_some_and(|chunk| chunk.has_dirty_reason(MeshDirtyReason::TerrainMutation));
                if gate.owns_chunk(chunk_pos) && !terrain_mutation {
                    if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                        chunk.clear_dirty();
                    }
                    chunks_skipped_page_owned += 1;
                } else {
                    live_dirty_chunks.push(chunk_pos);
                }
            }
            dirty_chunks = live_dirty_chunks;
        }
    }
    let dirty_chunks_queued = dirty_chunks.len();
    if generation_complete
        && dirty_chunks_queued >= MESH_DIRTY_QUEUE_WARN_THRESHOLD
        && timing_params
            .queue_warning
            .should_warn(timing_params.time.elapsed_secs())
    {
        debug!(
            "mesh dirty queue backed up: {} queued (per-frame visit cap {})",
            dirty_chunks_queued, MAX_DIRTY_CHUNKS_VISITED_PER_FRAME,
        );
    }
    let had_dirty_chunks = !dirty_chunks.is_empty();
    let mut reason_counts = MeshDirtyReasonCounts::default();
    for chunk_pos in &dirty_chunks {
        if let Some(chunk) = world.get_chunk(*chunk_pos) {
            reason_counts.add_flags(chunk.dirty_reason_flags());
        }
    }
    let camera_pos = camera_query
        .single()
        .ok()
        .map(|transform| transform.translation);
    let sort_start = timing.enabled.then(Instant::now);
    let mesh_dirty_sort_window = prioritize_dirty_chunks_for_camera(
        &mut dirty_chunks,
        camera_pos,
        MAX_DIRTY_CHUNKS_VISITED_PER_FRAME,
    );
    let mesh_dirty_sort_us = sort_start
        .map(|start| start.elapsed().as_micros() as u64)
        .unwrap_or(0);
    let mut chunks_meshed = 0u32;
    let mut chunks_skipped = 0u32;
    let mut chunks_processed = 0usize;
    let mut mesh_dirty_generate_us = 0u64;
    let mut mesh_dirty_apply_us = 0u64;
    let mut mesh_generation_timing = MeshGenerationTimingStats::default();
    let lod_churn_only = reason_counts.generation == 0
        && reason_counts.terrain_mutation == 0
        && (reason_counts.lod > 0
            || reason_counts.neighbor_lod > 0
            || reason_counts.water_material > 0);
    let mut chunks_per_frame_limit = chunks_per_frame_limit_for_dirty_meshes(
        &reason_counts,
        lod_churn_only,
        generation_complete,
    );
    let mut lod_transaction_frame_stats = LodMeshTransactionFrameStats::default();
    if lod_churn_only {
        lod_transaction_frame_stats = process_lod_mesh_transaction(
            &mut timing_params.lod_transaction,
            &dirty_chunks,
            camera_pos,
            &mut commands,
            &mut world,
            &mut meshes,
            blocky_material.as_deref(),
            &triplanar_material,
            &water_material,
            bench_params.toggles.as_deref(),
            bench_params.forensics.as_deref(),
            &mesh_settings,
            &lod_settings,
            &mc_spike.settings,
            &ao_config,
            &mut mc_spike.stats,
            &mut chunk_stats,
            frame.0,
            timing.enabled,
        );
        chunks_per_frame_limit = MAX_LOD_TRANSACTION_PREPARE_CHUNKS_PER_FRAME;
        chunks_processed = lod_transaction_frame_stats.chunks_processed;
        chunks_meshed = lod_transaction_frame_stats.chunks_meshed;
        chunks_skipped = lod_transaction_frame_stats.chunks_skipped;
        mesh_dirty_generate_us = lod_transaction_frame_stats.mesh_dirty_generate_us;
        mesh_dirty_apply_us = lod_transaction_frame_stats.mesh_dirty_apply_us;
        mesh_generation_timing = lod_transaction_frame_stats.mesh_generation_timing;
        dirty_chunks.clear();
    } else if timing_params.lod_transaction.active.is_some() {
        if let Some(transaction) = timing_params.lod_transaction.active.take() {
            discard_lod_mesh_transaction(transaction, &mut meshes);
        }
        lod_transaction_frame_stats.aborted_transactions = 1;
        lod_transaction_frame_stats.abort_reason = Some(LodMeshTransactionAbortReason::NonLodDirty);
    }
    let mut terrain_mesh_empty_but_solid_voxels = 0u32;
    let mut terrain_mesh_boundary_missing_neighbor = 0u32;
    let mut surface_nets_chunks_deferred_for_halo = 0u32;
    let terrain_mesh_degenerate_triangles_removed = 0u32;
    let mut terrain_mesh_lod_seam_repairs = 0u32;
    if lod_churn_only {
        terrain_mesh_empty_but_solid_voxels =
            lod_transaction_frame_stats.terrain_mesh_empty_but_solid_voxels;
        terrain_mesh_boundary_missing_neighbor =
            lod_transaction_frame_stats.terrain_mesh_boundary_missing_neighbor;
        surface_nets_chunks_deferred_for_halo =
            lod_transaction_frame_stats.surface_nets_chunks_deferred_for_halo;
        terrain_mesh_lod_seam_repairs = lod_transaction_frame_stats.terrain_mesh_lod_seam_repairs;
    }

    for chunk_pos in dirty_chunks {
        // Throttle expensive mesh generation, but let cheap empty/culled clears
        // drain faster so dirty queues do not stay backed up for hundreds of frames.
        let dirty_visit_limit = if lod_churn_only {
            chunks_per_frame_limit
        } else if surface_nets_chunks_deferred_for_halo > 0
            && chunks_meshed as usize <= chunks_per_frame_limit
        {
            MAX_DIRTY_CHUNKS_VISITED_WITH_DEFERRED_PER_FRAME
        } else {
            MAX_DIRTY_CHUNKS_VISITED_PER_FRAME
        };
        if chunks_processed >= dirty_visit_limit || chunks_meshed as usize >= chunks_per_frame_limit
        {
            break;
        }
        chunks_processed += 1;
        // Compute uniformity if unknown (lazy evaluation)
        if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
            if chunk.uniformity() == ChunkUniformity::Unknown {
                chunk.compute_uniformity();
            }
        }

        let (target_mode, lod_level, uniformity) = if let Some(chunk) = world.get_chunk(chunk_pos) {
            let base_mode =
                target_terrain_mesh_mode_for_lod(chunk.lod_level(), &mesh_settings, &lod_settings);
            let target_mode = resolve_terrain_mesh_mode(
                base_mode,
                chunk_pos,
                chunk.lod_level(),
                &mc_spike.settings,
                camera_pos,
            );
            let target_mode =
                forensics_mesh_mode_override(target_mode, bench_params.forensics.as_deref());

            (target_mode, chunk.lod_level(), chunk.uniformity())
        } else {
            continue;
        };

        // Skip meshing for culled chunks
        if lod_level == LodLevel::Culled {
            if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                if let Some(entity) = chunk.mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_mesh_entity();
                }
                if let Some(entity) = chunk.water_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mesh_entity();
                }
                if let Some(entity) = chunk.water_mask_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mask_mesh_entity();
                }
                chunk.clear_dirty();
            }
            chunks_skipped += 1;
            continue;
        }

        let empty_surface_neighbor = uniformity == ChunkUniformity::Empty
            && matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
            && empty_chunk_has_surface_nets_boundary_surface(&world, chunk_pos);
        let mesh_lod_level = LodLevel::Lod0;

        // Skip meshing for empty chunks unless Surface Nets needs this all-air
        // chunk to own a terrain boundary surface from the one-voxel halo.
        if uniformity == ChunkUniformity::Empty {
            if empty_surface_neighbor {
                terrain_mesh_lod_seam_repairs += 1;
            } else {
                if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                    if let Some(entity) = chunk.mesh_entity() {
                        commands.entity(entity).despawn();
                        chunk.clear_mesh_entity();
                    }
                    if let Some(entity) = chunk.water_mesh_entity() {
                        commands.entity(entity).despawn();
                        chunk.clear_water_mesh_entity();
                    }
                    if let Some(entity) = chunk.water_mask_mesh_entity() {
                        commands.entity(entity).despawn();
                        chunk.clear_water_mask_mesh_entity();
                    }
                    chunk.clear_dirty();
                }
                chunks_skipped += 1;
                continue;
            }
        }

        let missing_boundary_neighbors =
            count_missing_in_bounds_boundary_neighbors(&world, chunk_pos);
        if missing_boundary_neighbors > 0 {
            terrain_mesh_boundary_missing_neighbor += 1;
            if should_defer_surface_nets_mesh(target_mode, missing_boundary_neighbors) {
                surface_nets_chunks_deferred_for_halo += 1;
                chunks_skipped += 1;
                continue;
            }
        }

        if matches!(target_mode, MeshMode::Blocky) && blocky_material.is_none() {
            chunks_skipped += 1;
            continue;
        }

        let neighbor_lods =
            build_terrain_neighbor_lods(&world, chunk_pos, &mesh_settings, &lod_settings);

        // Step 1: Generate mesh data using immutable borrow (with timing).
        let mesh_start = Instant::now();
        let mesh_result = if let Some(chunk) = world.get_chunk(chunk_pos) {
            generate_chunk_mesh_for_request(MeshRequest {
                chunk,
                world: &world,
                mode: target_mode,
                logical_lod: lod_level,
                mesh_lod: mesh_lod_level,
                neighbor_lods,
                ao_config: &ao_config.baked,
                water_exposure_mode: mesh_settings.water_air_exposure_mode,
                forensics: mesh_forensics_options(
                    bench_params.forensics.as_deref(),
                    &mc_spike.settings,
                ),
                mc_settings: Some(&*mc_spike.settings),
                timing_enabled: timing.enabled,
            })
        } else {
            continue;
        };
        let mesh_elapsed = mesh_start.elapsed();
        mesh_dirty_generate_us += mesh_elapsed.as_micros() as u64;
        mesh_generation_timing.add(mesh_result.generation_timing);

        // Track mesh pressure before buffers are consumed.
        let vertex_count = mesh_result.solid.positions.len() as u32;
        let triangle_count = (mesh_result.solid.indices.len() / 3) as u32;
        if uniformity == ChunkUniformity::Mixed && triangle_count == 0 {
            terrain_mesh_empty_but_solid_voxels += 1;
        }
        chunk_stats.water_air_boundaries_total +=
            mesh_result.water_stats.air_boundaries_total as u64;
        chunk_stats.water_air_boundaries_exposed +=
            mesh_result.water_stats.air_boundaries_exposed as u64;
        chunk_stats.water_air_boundaries_sealed +=
            mesh_result.water_stats.air_boundaries_sealed as u64;
        chunk_stats.water_triangles_removed_sealed +=
            mesh_result.water_stats.triangles_removed_sealed as u64;
        chunk_stats.invalid_water_meshes_suppressed +=
            mesh_result.water_stats.invalid_meshes_suppressed as u64;
        chunk_stats.edge_water_faces_suppressed +=
            mesh_result.water_stats.edge_water_faces_suppressed as u64;
        chunk_stats.water_flood_fill_boundary_hits +=
            mesh_result.water_stats.flood_fill_boundary_hits as u64;
        chunk_stats.water_exposure_outside_world_rejected +=
            mesh_result.water_stats.exposure_outside_world_rejected as u64;

        if let (Some(page_runtime), Some(page_cache)) = (
            timing_params.page_runtime.as_deref(),
            timing_params.page_cache.as_deref_mut(),
        ) {
            let in_page_source_band = camera_pos
                .map(|camera_pos| {
                    let cam_chunk = VoxelWorld::world_to_chunk(camera_pos.as_ivec3());
                    let radius = (chunk_pos.x - cam_chunk.x)
                        .abs()
                        .max((chunk_pos.z - cam_chunk.z).abs());
                    radius > page_runtime.cfg.near_field.radius_chunks
                        && radius <= page_runtime.source_radius_chunks
                })
                .unwrap_or(false);
            if generation_complete
                && in_page_source_band
                && mesh_lod_level == LodLevel::Lod0
                && matches!(target_mode, MeshMode::SurfaceNets | MeshMode::McTransvoxel)
            {
                match crate::voxel::pages::extract_main_surface_for_clod(
                    &mesh_result.solid,
                    chunk_pos,
                    LodLevel::Lod0,
                    0,
                ) {
                    Ok(export) => page_cache.insert_from_live_lod0(export),
                    Err(error) => {
                        page_cache.remove_export(chunk_pos);
                        debug!("CLOD page export skipped for {:?}: {}", chunk_pos, error);
                    }
                }
            }
        }

        if let Some(mc_stats) = mesh_result.mc_transvoxel_stats {
            mc_spike.stats.chunks_meshed_this_frame += 1;
            mc_spike.stats.aggregated.regular_chunks_meshed = mc_spike
                .stats
                .aggregated
                .regular_chunks_meshed
                .saturating_add(mc_stats.regular_chunks_meshed);
            for (dst, src) in mc_spike
                .stats
                .aggregated
                .transition_faces_meshed
                .iter_mut()
                .zip(mc_stats.transition_faces_meshed)
            {
                *dst = dst.saturating_add(src);
            }
            mc_spike.stats.aggregated.transition_triangles_total = mc_spike
                .stats
                .aggregated
                .transition_triangles_total
                .saturating_add(mc_stats.transition_triangles_total);
            mc_spike.stats.aggregated.skipped_lod_delta_gt_one = mc_spike
                .stats
                .aggregated
                .skipped_lod_delta_gt_one
                .saturating_add(mc_stats.skipped_lod_delta_gt_one);
            mc_spike.stats.aggregated.skipped_missing_neighbor = mc_spike
                .stats
                .aggregated
                .skipped_missing_neighbor
                .saturating_add(mc_stats.skipped_missing_neighbor);
            mc_spike.stats.aggregated.mesh_generation_ms_total += mc_stats.mesh_generation_ms_total;
            mc_spike.stats.aggregated.triangle_count_regular = mc_spike
                .stats
                .aggregated
                .triangle_count_regular
                .saturating_add(mc_stats.triangle_count_regular);
            mc_spike.stats.aggregated.triangle_count_transition = mc_spike
                .stats
                .aggregated
                .triangle_count_transition
                .saturating_add(mc_stats.triangle_count_transition);
        }

        let water_depth_detail = if mesh_result.water.is_empty() {
            WaterChunkDepthDetail::default()
        } else {
            compute_water_chunk_depth_detail(&world, chunk_pos)
        };

        // Step 2: Update chunk state using mutable borrow
        let apply_start = timing.enabled.then(Instant::now);
        if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
            // Clear dirty flag
            chunk.clear_dirty();

            let world_pos = VoxelWorld::chunk_to_world(chunk_pos);
            let horizon_proxy = is_horizon_proxy_lod(lod_level);
            let terrain_quality =
                terrain_material_quality_for_lod(lod_level, bench_params.toggles.as_deref());
            let triplanar_handle = triplanar_material.handle_for_quality(terrain_quality);
            let chunk_mesh = crate::voxel::meshing::ChunkMesh {
                chunk_position: chunk_pos,
                vertex_count,
                triangle_count,
                mesh_mode: target_mode,
                material_quality: terrain_quality,
            };
            let terrain_mesh_debug = TerrainMeshDebug {
                logical_lod_at_mesh: lod_level,
                effective_lod_at_mesh: mesh_lod_level,
                target_mode_at_mesh: target_mode,
                neighbor_lods_at_mesh: neighbor_lods,
                lod_delta_gt_one_face_mask: lod_delta_gt_one_face_mask(lod_level, &neighbor_lods),
                missing_boundary_neighbors_at_mesh: missing_boundary_neighbors,
                empty_surface_cap_at_mesh: empty_surface_neighbor,
                generated_frame: frame.0,
                lod_transition_snap_stats: mesh_result.lod_transition_snap_stats,
                mesh_section_stats: mesh_result.mesh_section_stats,
                mc_transvoxel_stats: mesh_result.mc_transvoxel_stats,
            };
            let mc_triangle_sources = mesh_result.mc_triangle_sources.clone();

            // Track meshing statistics
            chunk_stats.meshing_time_us += mesh_elapsed.as_micros() as u64;
            chunk_stats.add_mesh_vertices(vertex_count, lod_level);

            // Handle solid mesh
            if mesh_result.solid.is_empty() {
                if let Some(entity) = chunk.mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_mesh_entity();
                }
            } else {
                let mesh = mesh_result.solid.into_mesh();
                let mesh_handle = meshes.add(mesh);
                let needs_collider = terrain_lod_requires_collider(lod_level);
                // Chunks whose top Y exceeds the water line are visible from above
                // (or straddle the surface) and must appear in the reflection pass.
                // Horizon proxy terrain is intentionally excluded from reflection
                // rendering because it is only a fog-muted silhouette band.
                let chunk_top_y = (chunk_pos.y + 1) * CHUNK_SIZE_I32;
                let terrain_layers = if !horizon_proxy && chunk_top_y > WATER_LEVEL {
                    RenderLayers::default().with(REFLECTION_RENDER_LAYER)
                } else {
                    RenderLayers::default()
                };

                if let Some(entity) = chunk.mesh_entity() {
                    // Update existing entity with new mesh AND correct material for current mode
                    match target_mode {
                        MeshMode::Blocky => {
                            if let Some(blocky_mat) = blocky_material.as_ref() {
                                commands
                                    .entity(entity)
                                    .insert((
                                        Mesh3d(mesh_handle),
                                        MeshMaterial3d(blocky_mat.handle.clone()),
                                        chunk_mesh,
                                        terrain_mesh_debug,
                                    ))
                                    .remove::<MeshMaterial3d<
                                        crate::rendering::triplanar_material::TriplanarMaterial,
                                    >>();
                            }
                        }
                        MeshMode::SurfaceNets | MeshMode::McTransvoxel => {
                            commands
                                .entity(entity)
                                .insert((
                                    Mesh3d(mesh_handle),
                                    MeshMaterial3d(triplanar_handle),
                                    chunk_mesh,
                                    terrain_mesh_debug,
                                ))
                                .remove::<MeshMaterial3d<crate::rendering::blocky_material::BlockyMaterial>>();
                        }
                    }
                    let mut entity_cmd = commands.entity(entity);
                    if needs_collider {
                        entity_cmd
                            .insert((NeedsCollider, terrain_layers))
                            .remove::<NotShadowCaster>();
                    } else if horizon_proxy {
                        entity_cmd
                            .remove::<NeedsCollider>()
                            .remove::<TerrainColliderBakeTask>()
                            .remove::<TerrainCollisionChunk>()
                            .remove::<TerrainCollisionState>()
                            .remove::<RigidBody>()
                            .remove::<Collider>()
                            .remove::<CollisionMargin>()
                            .remove::<CollisionLayers>()
                            .remove::<ChunkCollider>()
                            .insert((NotShadowCaster, terrain_layers));
                    } else {
                        entity_cmd
                            .remove::<NeedsCollider>()
                            .remove::<TerrainColliderBakeTask>()
                            .remove::<TerrainCollisionChunk>()
                            .remove::<TerrainCollisionState>()
                            .remove::<RigidBody>()
                            .remove::<Collider>()
                            .remove::<CollisionMargin>()
                            .remove::<CollisionLayers>()
                            .remove::<ChunkCollider>()
                            .insert(terrain_layers);
                        // Do NOT remove NotShadowCaster here — the shadow budget system
                        // is the sole authority on terrain shadow state.
                    }
                    if let Some(sources) = mc_triangle_sources.clone() {
                        entity_cmd.insert(sources);
                    } else {
                        entity_cmd.remove::<McTriangleSources>();
                    }
                } else {
                    // Spawn with appropriate material based on mesh mode
                    let entity = match target_mode {
                        MeshMode::Blocky => {
                            let Some(blocky_material) = blocky_material.as_ref() else {
                                continue;
                            };
                            commands
                                .spawn((
                                    Mesh3d(mesh_handle),
                                    MeshMaterial3d(blocky_material.handle.clone()),
                                    Transform::from_xyz(
                                        world_pos.x as f32,
                                        world_pos.y as f32,
                                        world_pos.z as f32,
                                    ),
                                    chunk_mesh,
                                    terrain_mesh_debug,
                                    terrain_layers,
                                ))
                                .id()
                        }
                        MeshMode::SurfaceNets | MeshMode::McTransvoxel => commands
                            .spawn((
                                Mesh3d(mesh_handle),
                                MeshMaterial3d(triplanar_handle),
                                Transform::from_xyz(
                                    world_pos.x as f32,
                                    world_pos.y as f32,
                                    world_pos.z as f32,
                                ),
                                chunk_mesh,
                                terrain_mesh_debug,
                                terrain_layers,
                            ))
                            .id(),
                    };
                    let mut entity_cmd = commands.entity(entity);
                    if needs_collider {
                        entity_cmd.insert(NeedsCollider);
                    } else if horizon_proxy {
                        entity_cmd.insert(NotShadowCaster);
                    }
                    if let Some(sources) = mc_triangle_sources {
                        entity_cmd.insert(sources);
                    } else {
                        entity_cmd.remove::<McTriangleSources>();
                    }
                    chunk.set_mesh_entity(entity);
                }
            }

            // Handle water mesh
            if horizon_proxy || mesh_result.water.is_empty() {
                if let Some(entity) = chunk.water_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mesh_entity();
                }
                if let Some(entity) = chunk.water_mask_mesh_entity() {
                    commands.entity(entity).despawn();
                    chunk.clear_water_mask_mesh_entity();
                }
            } else {
                let water_vertex_count = mesh_result.water.positions.len() as u32;
                let water_triangle_count = mesh_result.water.indices.len() / 3;
                let water_mesh = mesh_result.water.into_mesh();
                let water_mesh_handle = meshes.add(water_mesh);
                let force_fancy = env_flag("VOXEL_FORCE_ALL_WATER_FANCY");
                let force_cheap = env_flag("VOXEL_FORCE_ALL_WATER_CHEAP");
                let use_fancy_water = force_fancy && !force_cheap;

                if let Some(entity) = chunk.water_mesh_entity() {
                    let mut entity_cmd = commands.entity(entity);
                    entity_cmd.insert((
                        Mesh3d(water_mesh_handle.clone()),
                        crate::voxel::meshing::ChunkMesh {
                            chunk_position: chunk_pos,
                            vertex_count: water_vertex_count,
                            triangle_count: water_triangle_count as u32,
                            mesh_mode: MeshMode::Blocky,
                            material_quality: TerrainMaterialQuality::FullTriplanar,
                        },
                        WaterMesh,
                        WaterMeshDetail {
                            triangle_count: water_triangle_count,
                            max_depth: water_depth_detail.max_depth,
                            average_depth: water_depth_detail.average_depth,
                            surface_area: water_depth_detail.surface_area,
                        },
                        RenderLayers::default(),
                        NotShadowCaster, // Water is translucent â€” never cast opaque shadows
                    ));
                    if use_fancy_water {
                        entity_cmd
                            .insert(MeshMaterial3d(
                                water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                            ))
                            .remove::<MeshMaterial3d<StandardMaterial>>();
                    } else {
                        entity_cmd
                            .insert(MeshMaterial3d(
                                water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                            ))
                            .remove::<MeshMaterial3d<StandardWaterMaterial>>();
                    }
                } else {
                    let mut entity_cmd = commands.spawn((
                        Mesh3d(water_mesh_handle.clone()),
                        Transform::from_xyz(
                            world_pos.x as f32,
                            world_pos.y as f32,
                            world_pos.z as f32,
                        ),
                        crate::voxel::meshing::ChunkMesh {
                            chunk_position: chunk_pos,
                            vertex_count: water_vertex_count,
                            triangle_count: water_triangle_count as u32,
                            mesh_mode: MeshMode::Blocky,
                            material_quality: TerrainMaterialQuality::FullTriplanar,
                        },
                        WaterMesh,
                        WaterMeshDetail {
                            triangle_count: water_triangle_count,
                            max_depth: water_depth_detail.max_depth,
                            average_depth: water_depth_detail.average_depth,
                            surface_area: water_depth_detail.surface_area,
                        },
                        RenderLayers::default(),
                        NotShadowCaster, // Water is translucent â€” never cast opaque shadows
                    ));
                    if use_fancy_water {
                        entity_cmd.insert(MeshMaterial3d(
                            water_material.near_handle_for_kind(WaterBodyKind::Unknown),
                        ));
                    } else {
                        entity_cmd.insert(MeshMaterial3d(
                            water_material.far_handle_for_kind(WaterBodyKind::Unknown),
                        ));
                    }
                    let entity = entity_cmd.id();
                    chunk.set_water_mesh_entity(entity);
                }

                let mask_transform =
                    Transform::from_xyz(world_pos.x as f32, world_pos.y as f32, world_pos.z as f32);
                if let Some(mask_entity) = chunk.water_mask_mesh_entity() {
                    commands.entity(mask_entity).insert((
                        Mesh3d(water_mesh_handle.clone()),
                        MeshMaterial3d(water_material.mask_handle.clone()),
                        mask_transform,
                        WaterMaskProxy,
                        RenderLayers::layer(WATER_MASK_RENDER_LAYER),
                        NotShadowCaster,
                    ));
                } else {
                    let mask_entity = commands
                        .spawn((
                            Mesh3d(water_mesh_handle.clone()),
                            MeshMaterial3d(water_material.mask_handle.clone()),
                            mask_transform,
                            WaterMaskProxy,
                            RenderLayers::layer(WATER_MASK_RENDER_LAYER),
                            NotShadowCaster,
                        ))
                        .id();
                    chunk.set_water_mask_mesh_entity(mask_entity);
                }
            }

            chunks_meshed += 1;
        }
        mesh_dirty_apply_us += apply_start
            .map(|start| start.elapsed().as_micros() as u64)
            .unwrap_or(0);
    }

    // Update runtime statistics
    chunk_stats.chunks_meshed_this_frame = chunks_meshed;
    chunk_stats.chunks_skipped_this_frame = chunks_skipped;
    chunk_stats.chunks_skipped_page_owned = chunks_skipped_page_owned;
    chunk_stats.dirty_chunks_queued = dirty_chunks_queued as u32;
    chunk_stats.generation_dirty_chunks_queued = reason_counts.generation;
    chunk_stats.surface_nets_chunks_deferred_for_halo = surface_nets_chunks_deferred_for_halo;
    log_transition_stats_if_due(&mc_spike.settings, &mc_spike.stats, frame.0);

    // Keep the O(N) debug/stat snapshot off hot dirty-mesh frames while the
    // terrain queue is backed up. Per-frame mesh counters above stay current.
    let stats_recompute_due = should_recompute_runtime_chunk_stats(frame.0);
    let initial_stats_required =
        should_force_initial_runtime_chunk_stats(chunk_stats.total_chunks, world.chunk_count());
    let stats_recompute_blocked = !initial_stats_required
        && stats_recompute_due
        && should_defer_runtime_chunk_stats_recompute(
            had_dirty_chunks,
            dirty_chunks_queued,
            chunks_per_frame_limit,
        );
    let should_recompute_stats =
        initial_stats_required || (stats_recompute_due && !stats_recompute_blocked);
    let stats_recompute_start = timing.enabled.then(Instant::now);
    if should_recompute_stats {
        chunk_stats.recompute_from_world(&world);
    }
    let mesh_dirty_stats_us = stats_recompute_start
        .map(|start| start.elapsed().as_micros() as u64)
        .unwrap_or(0);

    if let Some(start) = mesh_dirty_total_start {
        timing.record_area(frame.0, "Mesh Dirty", start.elapsed().as_micros() as u64);
    }
    timing.record_area(frame.0, "Mesh Dirty Sort CPU", mesh_dirty_sort_us);
    timing.record_area(frame.0, "Mesh Dirty Generate CPU", mesh_dirty_generate_us);
    timing.record_area(frame.0, "Mesh Dirty Apply CPU", mesh_dirty_apply_us);
    timing.record_area(frame.0, "Mesh Dirty Stats CPU", mesh_dirty_stats_us);
    timing.record_area(frame.0, "SN SDF CPU", mesh_generation_timing.sdf_us);
    timing.record_area(
        frame.0,
        "SN Extract CPU",
        mesh_generation_timing.surface_nets_us,
    );
    timing.record_area(
        frame.0,
        "SN Emit CPU",
        mesh_generation_timing.emit_surface_us,
    );
    timing.record_area(frame.0, "LOD Seam CPU", mesh_generation_timing.lod_seam_us);
    timing.record_area(
        frame.0,
        "Terrain Water Mesh CPU",
        mesh_generation_timing.water_us,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Queued",
        dirty_chunks_queued as f64,
    );
    timing.record_count(frame.0, "Mesh Dirty Chunks Seen", dirty_chunks_seen as f64);
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Skipped Page Owned",
        chunks_skipped_page_owned as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Processed",
        chunks_processed as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Deferred",
        dirty_chunks_queued.saturating_sub(chunks_processed) as f64,
    );
    timing.record_count(
        frame.0,
        "MAX_CHUNKS_PER_FRAME Hit",
        u8::from(dirty_chunks_queued > chunks_processed) as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Frame Limit",
        chunks_per_frame_limit as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Chunks Visit Limit",
        if lod_churn_only {
            chunks_per_frame_limit
        } else if surface_nets_chunks_deferred_for_halo > 0 {
            MAX_DIRTY_CHUNKS_VISITED_WITH_DEFERRED_PER_FRAME
        } else {
            MAX_DIRTY_CHUNKS_VISITED_PER_FRAME
        } as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Sort Window",
        mesh_dirty_sort_window as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty LOD Churn Only",
        lod_churn_only as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transactions Selected",
        lod_transaction_frame_stats.selected_transactions as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Chunks Selected",
        lod_transaction_frame_stats.selected_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Chunks Deferred",
        lod_transaction_frame_stats.deferred_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Oversize Chunks",
        lod_transaction_frame_stats.oversize_component_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Active",
        timing_params.lod_transaction.active.is_some() as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Pending Chunks",
        lod_transaction_frame_stats.pending_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Prepared Chunks",
        lod_transaction_frame_stats.prepared_chunks_total as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Build Chunks This Frame",
        lod_transaction_frame_stats.prepared_chunks_this_frame as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Commit Chunks",
        lod_transaction_frame_stats.committed_chunks as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Aborted",
        lod_transaction_frame_stats.aborted_transactions as f64,
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Prepare Deferred For Halo",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::PrepareDeferredForHalo,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Prepare Skipped",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::PrepareSkipped,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Prepare Stale",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::PrepareStale,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation Missing Chunk",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationMissingChunk,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation Dirty",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationGenerationOrMutationDirty,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation LOD Changed",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationLodChanged,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation Target Mode Changed",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationTargetModeChanged,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation Mesh LOD Changed",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationMeshLodChanged,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation No Visible Mesh Mismatch",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationNoVisibleMeshMismatch,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation Neighbor LODs Changed",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationNeighborLodsChanged,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation Missing Boundary Changed",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationMissingBoundaryNeighborsChanged,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Validation Empty Surface Cap Changed",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::ValidationEmptySurfaceCapChanged,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Missing Prepared Commit",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::MissingPreparedCommit,
        ),
    );
    timing.record_count(
        frame.0,
        "LOD Mesh Transaction Abort Non LOD Dirty",
        lod_transaction_abort_reason_count(
            &lod_transaction_frame_stats,
            LodMeshTransactionAbortReason::NonLodDirty,
        ),
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Stats Recompute Blocked",
        stats_recompute_blocked as u8 as f64,
    );
    timing.record_count(frame.0, "Mesh Dirty Reason LOD", reason_counts.lod as f64);
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Neighbor LOD",
        reason_counts.neighbor_lod as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Generation",
        reason_counts.generation as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Water Material",
        reason_counts.water_material as f64,
    );
    timing.record_count(
        frame.0,
        "Mesh Dirty Reason Terrain Mutation",
        reason_counts.terrain_mutation as f64,
    );
    timing.record_count(
        frame.0,
        "Water Air Boundaries Total",
        chunk_stats.water_air_boundaries_total as f64,
    );
    timing.record_count(
        frame.0,
        "Water Air Boundaries Exposed",
        chunk_stats.water_air_boundaries_exposed as f64,
    );
    timing.record_count(
        frame.0,
        "Water Air Boundaries Sealed",
        chunk_stats.water_air_boundaries_sealed as f64,
    );
    timing.record_count(
        frame.0,
        "Water Triangles Removed Sealed",
        chunk_stats.water_triangles_removed_sealed as f64,
    );
    timing.record_count(
        frame.0,
        "Invalid Water Meshes Suppressed",
        chunk_stats.invalid_water_meshes_suppressed as f64,
    );
    timing.record_count(
        frame.0,
        "Edge Water Faces Suppressed",
        chunk_stats.edge_water_faces_suppressed as f64,
    );
    timing.record_count(
        frame.0,
        "Water Flood Fill Boundary Hits",
        chunk_stats.water_flood_fill_boundary_hits as f64,
    );
    timing.record_count(
        frame.0,
        "Water Exposure Outside World Rejected",
        chunk_stats.water_exposure_outside_world_rejected as f64,
    );
    timing.record_count(
        frame.0,
        "Water Mesh Entities",
        chunk_stats.water_mesh_entities as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Empty But Solid Voxels",
        terrain_mesh_empty_but_solid_voxels as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Boundary Missing Neighbor",
        terrain_mesh_boundary_missing_neighbor as f64,
    );
    timing.record_count(
        frame.0,
        "Surface Nets Chunks Deferred For Halo",
        surface_nets_chunks_deferred_for_halo as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Degenerate Triangles Removed",
        terrain_mesh_degenerate_triangles_removed as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh LOD Seam Repairs",
        terrain_mesh_lod_seam_repairs as f64,
    );
}

pub(crate) fn prioritize_dirty_chunks_for_camera(
    dirty_chunks: &mut [IVec3],
    camera_pos: Option<Vec3>,
    visit_limit: usize,
) -> usize {
    let Some(camera_pos) = camera_pos else {
        return 0;
    };
    if dirty_chunks.is_empty() || visit_limit == 0 {
        return 0;
    }

    let sort_window = dirty_chunks.len().min(visit_limit);
    if sort_window < dirty_chunks.len() {
        dirty_chunks.select_nth_unstable_by(sort_window, |a, b| {
            compare_dirty_chunk_distance(a, b, camera_pos)
        });
        dirty_chunks[..sort_window].sort_by(|a, b| compare_dirty_chunk_distance(a, b, camera_pos));
    } else {
        dirty_chunks.sort_by(|a, b| compare_dirty_chunk_distance(a, b, camera_pos));
    }
    sort_window
}

pub(crate) fn should_recompute_runtime_chunk_stats(frame: u32) -> bool {
    frame % 30 == 0
}

pub(crate) fn should_force_initial_runtime_chunk_stats(
    stats_total_chunks: u32,
    world_chunk_count: usize,
) -> bool {
    stats_total_chunks == 0 && world_chunk_count > 0
}

pub(crate) fn should_defer_runtime_chunk_stats_recompute(
    had_dirty_chunks: bool,
    dirty_chunks_queued: usize,
    chunks_per_frame_limit: usize,
) -> bool {
    had_dirty_chunks && dirty_chunks_queued > chunks_per_frame_limit
}

fn compare_dirty_chunk_distance(a: &IVec3, b: &IVec3, camera_pos: Vec3) -> std::cmp::Ordering {
    let world_a = VoxelWorld::chunk_to_world(*a).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
    let world_b = VoxelWorld::chunk_to_world(*b).as_vec3() + Vec3::splat(CHUNK_SIZE_F32 * 0.5);
    let dist_a = world_a.distance_squared(camera_pos);
    let dist_b = world_b.distance_squared(camera_pos);
    dist_a
        .partial_cmp(&dist_b)
        .unwrap_or(std::cmp::Ordering::Equal)
}

pub(crate) fn terrain_material_quality_for_distance(
    _distance: f32,
    current: TerrainMaterialQuality,
    bench_toggles: Option<&BenchRenderToggles>,
    _quality_preset: RenderQualityPreset,
) -> TerrainMaterialQuality {
    if let Some(forced) =
        bench_toggles.and_then(|toggles| toggles.terrain_material_quality.forced_quality())
    {
        return forced;
    }
    if bench_toggles.is_some_and(|toggles| toggles.disable_terrain_material_lod) {
        return TerrainMaterialQuality::FullTriplanar;
    }

    match current {
        TerrainMaterialQuality::CheapTriplanar
        | TerrainMaterialQuality::SingleProjectionFar
        | TerrainMaterialQuality::HorizonProxy => TerrainMaterialQuality::FullTriplanar,
        TerrainMaterialQuality::AtlasOnlyDebug
        | TerrainMaterialQuality::WireframeDebug
        | TerrainMaterialQuality::NormalsDebug
        | TerrainMaterialQuality::WireframeNormalsDebug
        | TerrainMaterialQuality::FlatUnlitDebug
        | TerrainMaterialQuality::WireframeFlatUnlitDebug => current,
        _ => current,
    }
}

pub(crate) fn update_terrain_material_lod(
    time: Res<Time>,
    triplanar_material: Res<TriplanarMaterialHandle>,
    terrain_debug_handles: Option<Res<crate::voxel::terrain_debug::TerrainDebugMaterialHandles>>,
    terrain_debug: Res<crate::voxel::terrain_debug::TerrainDebugView>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    quality_preset: Res<RenderQualityPreset>,
    runtime_debug: Option<Res<crate::runtime_commands::RuntimeViewportDebugState>>,
    mut terrain_meshes: Query<
        (
            &Transform,
            &mut ChunkMesh,
            &mut MeshMaterial3d<TriplanarMaterial>,
            Option<&TerrainMeshDebug>,
        ),
        Without<WaterMesh>,
    >,
    mut last_update: Local<f32>,
) {
    let now = time.elapsed_secs();
    if now - *last_update < TERRAIN_MATERIAL_UPDATE_INTERVAL {
        return;
    }
    *last_update = now;

    let bench_toggles = bench_toggles.as_deref();
    let forced_quality =
        bench_toggles.and_then(|toggles| toggles.terrain_material_quality.forced_quality());
    let editor_wireframe = runtime_debug.is_some_and(|debug| debug.wireframe);
    let debug_mode = crate::voxel::terrain_debug::terrain_debug_material_mode(
        &terrain_debug,
        editor_wireframe,
        forced_quality,
    );

    for (_transform, mut chunk_mesh, mut material, mesh_debug) in &mut terrain_meshes {
        // Both Surface Nets and MC+Transvoxel chunks render with TriplanarMaterial
        // and need the debug-overlay material swap (Alt+F7 / Alt+F8). Without MC
        // here the indicator flips "WIRE ON" but the wireframe never appears on
        // MC chunks because their material handle is never updated.
        if !matches!(
            chunk_mesh.mesh_mode,
            MeshMode::SurfaceNets | MeshMode::McTransvoxel
        ) {
            continue;
        }
        if debug_mode != crate::voxel::terrain_debug::TerrainDebugMaterialMode::None {
            let Some(handles) = terrain_debug_handles.as_ref() else {
                continue;
            };
            let lod = mesh_debug
                .map(|debug| debug.logical_lod_at_mesh)
                .unwrap_or(LodLevel::Lod0);
            if let Some(handle) = handles.handle_for(debug_mode, lod) {
                **material = handle;
            }
            continue;
        }
        let target_quality = terrain_material_quality_for_distance(
            0.0,
            chunk_mesh.material_quality,
            bench_toggles,
            *quality_preset,
        );
        // Make the live handle match the target quality whenever it differs, not only
        // when the quality *value* changes. Live terrain is now uniformly FullTriplanar,
        // so quality never changes after commit; without this, a chunk committed with a
        // stale/default handle (or left on a debug handle after toggling Alt+F7 off)
        // would never be corrected and would keep rendering the flat HorizonProxy
        // fallback even though its quality already reads FullTriplanar.
        let desired_handle = triplanar_material.handle_for_quality(target_quality);
        if **material != desired_handle {
            **material = desired_handle;
        }
        chunk_mesh.material_quality = target_quality;
    }
}
