use super::*;

pub(super) fn classify_camera_gap(
    gap: &Option<SeeThroughGap>,
    first_any: &Option<CameraRayHit>,
    first_front: &Option<CameraRayHit>,
    first_backface: &Option<CameraRayHit>,
    first_mesher_iso_distance: Option<f32>,
    mc_cell: Option<&McCellOracleProbe>,
    seam_terrace: Option<&SeamTerraceProbe>,
    visual_samples: &CameraRayVisualSamples,
) -> GapClassification {
    let Some(gap) = gap else {
        return GapClassification::Unknown;
    };
    let raw_distance = gap.voxel_surface_distance;
    let front_late = first_front
        .as_ref()
        .map_or(true, |hit| hit.distance > raw_distance + 1.0);

    if front_late
        && first_backface.as_ref().is_some_and(|hit| {
            hit.distance <= raw_distance + 1.0
                || first_mesher_iso_distance.is_some_and(|iso| (hit.distance - iso).abs() <= 1.0)
        })
    {
        return GapClassification::BackfaceOrWinding;
    }

    if let Some(hit) = first_any {
        let near_raw = hit.distance <= raw_distance + 1.0;
        let near_iso =
            first_mesher_iso_distance.is_some_and(|iso| (hit.distance - iso).abs() <= 1.0);
        if (near_raw || near_iso)
            && seam_terrace.is_some_and(|terrace| {
                terrace.classification == SeamTerraceClassification::PossibleTerrace
            })
            && !visual_samples_show_background(visual_samples)
        {
            return GapClassification::SeamTerraceOrLodSurfaceDisplacement;
        }
        if (near_raw || near_iso)
            && (hit_has_shading_or_normal_anomaly(hit)
                || visual_samples_have_dark_geometry(visual_samples))
        {
            return GapClassification::GeometryPresentButShadingOrNormalDarkening;
        }
        if (near_raw || near_iso) && visual_samples_show_background(visual_samples) {
            return GapClassification::MissingMeshEntityOrRenderLayer;
        }
        if near_iso
            && first_mesher_iso_distance.is_some_and(|iso| iso > raw_distance + 0.75)
            && visual_samples_confirm_non_dark(visual_samples)
        {
            return GapClassification::RawOccupancyVsMesherIsoFalsePositive;
        }
        if front_late && !hit.front_face && (near_raw || near_iso) {
            return GapClassification::BackfaceOrWinding;
        }
    }

    if first_mesher_iso_distance.is_some_and(|iso| iso > raw_distance + 0.75)
        && visual_samples_confirm_non_dark(visual_samples)
    {
        if seam_terrace.is_some_and(|terrace| {
            terrace.classification == SeamTerraceClassification::PossibleTerrace
        }) {
            return GapClassification::SeamTerraceOrLodSurfaceDisplacement;
        }
        return GapClassification::RawOccupancyVsMesherIsoFalsePositive;
    }

    if let Some(cell) = mc_cell {
        let actual_regular = cell.actual_regular_triangle_count;
        let expected_transition: u32 = cell
            .transition_cells
            .iter()
            .map(|transition| transition.expected_triangle_count as u32)
            .sum();
        let actual_transition = cell
            .transition_cells
            .iter()
            .try_fold(0u32, |total, transition| {
                transition
                    .actual_triangle_count
                    .map(|actual| total.saturating_add(actual))
            });

        if !cell.skipped_regular_faces.is_empty()
            && expected_transition > 0
            && actual_transition == Some(0)
        {
            return GapClassification::MissingTransitionGeometryOrFaceFrame;
        }
        if cell.expected_regular_triangle_count > 0 && actual_regular == Some(0) {
            if !cell.skipped_regular_faces.is_empty() {
                return GapClassification::MissingTransitionGeometryOrFaceFrame;
            }
            return GapClassification::MissingRegularMcGeometry;
        }
        if expected_transition > 0 && actual_transition == Some(0) {
            return GapClassification::MissingTransitionGeometryOrFaceFrame;
        }
        if cell.expected_regular_triangle_count > 0
            && actual_regular.is_some_and(|actual| actual > 0)
            && first_any
                .as_ref()
                .map_or(true, |hit| hit.distance > raw_distance + 1.0)
            && cell.emitted_regular_triangles_ray_hit_count == 0
        {
            return GapClassification::VertexPositionOrTableDecodeError;
        }
    }

    if first_any.is_none() && mc_cell.is_none() {
        return GapClassification::MissingMeshEntityOrRenderLayer;
    }

    GapClassification::Unknown
}

pub(super) fn hit_has_shading_or_normal_anomaly(hit: &CameraRayHit) -> bool {
    let normal_flip = hit.vertex_normal.is_some_and(|normal| {
        let vertex = vec3_from_dump(normal).normalize_or_zero();
        let geometric = vec3_from_dump(hit.geometric_normal).normalize_or_zero();
        vertex != Vec3::ZERO && geometric != Vec3::ZERO && vertex.dot(geometric) < -0.25
    });
    let bad_material = hit.material_weights.is_some_and(|weights| {
        weights.iter().any(|weight| !weight.is_finite())
            || weights.iter().all(|weight| weight.abs() < 1.0e-4)
    });
    normal_flip || bad_material
}

pub(super) fn normalized_probe_summary(
    camera_ray_fan: Option<&CameraRayFan>,
    active_seam_faces: &[SeamFaceProbe],
    render_entity_checklist: &[RenderEntityChecklistProbe],
) -> TerrainHoleProbeSummary {
    let mut gap_classification_counts = BTreeMap::new();
    let mut seam_terrace_counts = BTreeMap::new();
    let mut gaps_by_lod_pair = BTreeMap::new();
    let mut gaps_by_nearest_face = BTreeMap::new();
    let mut max_gap_seam_delta_voxels: Option<f32> = None;
    let mut skipped_lod_chunks = HashSet::new();
    let mut suspect_scores: HashMap<IVec3, ChunkSuspectProbe> = HashMap::new();

    if let Some(fan) = camera_ray_fan {
        for gap in &fan.gaps {
            increment_count(
                &mut gap_classification_counts,
                format!("{:?}", gap.gap_classification),
            );
            if let Some(face) = gap.nearest_chunk_faces.first() {
                increment_count(&mut gaps_by_nearest_face, face.face.clone());
            }
            increment_count(&mut gaps_by_lod_pair, gap_lod_pair_name(gap));
            if let Some(terrace) = &gap.seam_terrace {
                increment_count(
                    &mut seam_terrace_counts,
                    format!("{:?}", terrace.classification),
                );
                if let Some(delta) = terrace.worst_abs_height_delta {
                    max_gap_seam_delta_voxels =
                        Some(max_gap_seam_delta_voxels.map_or(delta, |max| max.max(delta)));
                }
            }
            if gap
                .surface_chunk_state
                .mc_transvoxel_at_mesh
                .is_some_and(|stats| stats.skipped_lod_delta_gt_one > 0)
            {
                skipped_lod_chunks.insert(ivec3_from_dump(gap.surface_chunk));
            }
            add_suspect_reason(
                &mut suspect_scores,
                ivec3_from_dump(gap.surface_chunk),
                format!("fan gap classified {:?}", gap.gap_classification),
            );
        }
    }

    let mut max_active_seam_delta_voxels: Option<f32> = None;
    for seam in active_seam_faces {
        if let Some(delta) = seam.max_abs_face_offset_delta.or(seam.max_abs_height_delta) {
            max_active_seam_delta_voxels =
                Some(max_active_seam_delta_voxels.map_or(delta, |max| max.max(delta)));
        }
        if seam
            .source_chunk_skipped_lod_delta_gt_one
            .is_some_and(|count| count > 0)
        {
            skipped_lod_chunks.insert(ivec3_from_dump(seam.source_chunk));
        }
        if seam
            .neighbor_chunk_skipped_lod_delta_gt_one
            .is_some_and(|count| count > 0)
        {
            skipped_lod_chunks.insert(ivec3_from_dump(seam.neighbor_chunk));
        }
        if seam.possible_terrace_sample_count > 0 {
            add_suspect_reason(
                &mut suspect_scores,
                ivec3_from_dump(seam.source_chunk),
                format!(
                    "{} seam possible terrace max_delta={:.2}",
                    seam.face,
                    seam.max_abs_face_offset_delta
                        .or(seam.max_abs_height_delta)
                        .unwrap_or_default()
                ),
            );
        }
        if seam.boundary_edges.unmatched_seam_edge_count > 0 {
            add_suspect_reason(
                &mut suspect_scores,
                ivec3_from_dump(seam.source_chunk),
                format!(
                    "{} seam has {} unmatched boundary edges",
                    seam.face, seam.boundary_edges.unmatched_seam_edge_count
                ),
            );
        }
        if seam.transition_coverage.samples_without_render_coverage > 0 {
            add_suspect_reason(
                &mut suspect_scores,
                ivec3_from_dump(seam.source_chunk),
                format!(
                    "{} seam has {} uncovered transition samples",
                    seam.face, seam.transition_coverage.samples_without_render_coverage
                ),
            );
        }
    }

    let stale_or_pending_mesh_chunks = render_entity_checklist
        .iter()
        .filter(|check| is_stale_or_pending_mesh_status(check.mesh_status))
        .map(|check| check.chunk_position)
        .collect();
    let debug_unavailable_mesh_chunks = render_entity_checklist
        .iter()
        .filter(|check| check.mesh_status == LodMeshStatus::DebugUnavailable)
        .map(|check| check.chunk_position)
        .collect();
    for check in render_entity_checklist {
        if check.mesh_status != LodMeshStatus::Current {
            add_suspect_reason(
                &mut suspect_scores,
                ivec3_from_dump(check.chunk_position),
                format!("render checklist mesh_status={:?}", check.mesh_status),
            );
        }
        if !check.mesh_asset_loaded && check.mesh_handle_present {
            add_suspect_reason(
                &mut suspect_scores,
                ivec3_from_dump(check.chunk_position),
                "mesh handle exists but mesh asset is not loaded".to_string(),
            );
        }
    }

    let mut top_suspect_chunks: Vec<_> = suspect_scores.into_values().collect();
    top_suspect_chunks.sort_by(|a, b| {
        b.score.cmp(&a.score).then_with(|| {
            compare_chunk_pos_lex(
                ivec3_from_dump(a.chunk_position),
                ivec3_from_dump(b.chunk_position),
            )
        })
    });
    top_suspect_chunks.truncate(12);

    let mut chunks_with_skipped_lod_delta_gt_one: Vec<_> =
        skipped_lod_chunks.into_iter().map(Into::into).collect();
    chunks_with_skipped_lod_delta_gt_one
        .sort_by(|a, b| compare_chunk_pos_lex(ivec3_from_dump(*a), ivec3_from_dump(*b)));

    TerrainHoleProbeSummary {
        gap_classification_counts: counts_to_vec(gap_classification_counts),
        seam_terrace_counts: counts_to_vec(seam_terrace_counts),
        gaps_by_lod_pair: counts_to_vec(gaps_by_lod_pair),
        gaps_by_nearest_face: counts_to_vec(gaps_by_nearest_face),
        max_gap_seam_delta_voxels,
        max_active_seam_delta_voxels,
        active_seam_face_count: active_seam_faces.len() as u32,
        active_seam_faces_with_possible_terrace: active_seam_faces
            .iter()
            .filter(|seam| seam.possible_terrace_sample_count > 0)
            .count() as u32,
        active_seam_faces_with_open_edges: active_seam_faces
            .iter()
            .filter(|seam| seam.boundary_edges.unmatched_seam_edge_count > 0)
            .count() as u32,
        active_seam_faces_with_transition_coverage_gaps: active_seam_faces
            .iter()
            .filter(|seam| seam.transition_coverage.samples_without_render_coverage > 0)
            .count() as u32,
        chunks_with_skipped_lod_delta_gt_one,
        stale_or_pending_mesh_chunks,
        debug_unavailable_mesh_chunks,
        top_suspect_chunks,
    }
}

pub(super) fn increment_count(counts: &mut BTreeMap<String, u32>, name: String) {
    *counts.entry(name).or_default() += 1;
}

pub(super) fn counts_to_vec(counts: BTreeMap<String, u32>) -> Vec<NamedCountProbe> {
    counts
        .into_iter()
        .map(|(name, count)| NamedCountProbe { name, count })
        .collect()
}

pub(super) fn add_suspect_reason(
    scores: &mut HashMap<IVec3, ChunkSuspectProbe>,
    chunk_position: IVec3,
    reason: String,
) {
    let entry = scores
        .entry(chunk_position)
        .or_insert_with(|| ChunkSuspectProbe {
            chunk_position: chunk_position.into(),
            score: 0,
            reasons: Vec::new(),
        });
    entry.score = entry.score.saturating_add(1);
    if !entry.reasons.iter().any(|existing| existing == &reason) {
        entry.reasons.push(reason);
    }
}

pub(super) fn gap_lod_pair_name(gap: &FanGap) -> String {
    if let Some(terrace) = &gap.seam_terrace {
        if let Some(pair) = terrace.pairs.first() {
            return format!("{}->{}", pair.fine_lod, pair.coarse_lod);
        }
    }
    let mesh_lod = gap
        .mc_cell
        .as_ref()
        .map(|cell| cell.effective_lod_at_mesh.clone())
        .or_else(|| gap.surface_chunk_state.lod_level.clone())
        .unwrap_or_else(|| "unknown".to_string());
    let surface_lod = gap
        .surface_chunk_state
        .lod_level
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    format!("{mesh_lod}->{surface_lod}")
}

pub(super) fn mc_source_probe_chunk(source: &McTriangleSourceProbe) -> Option<IVec3> {
    match source {
        McTriangleSourceProbe::Regular { chunk_position, .. }
        | McTriangleSourceProbe::Transition { chunk_position, .. } => {
            Some(ivec3_from_dump(*chunk_position))
        }
    }
}

pub(super) fn nearest_chunk_faces(local_point: Vec3) -> Vec<BoundaryDistanceProbe> {
    let chunk_size = CHUNK_SIZE_I32 as f32;
    let mut distances = vec![
        BoundaryDistanceProbe {
            face: "neg_x".to_string(),
            distance_voxels: local_point.x,
        },
        BoundaryDistanceProbe {
            face: "pos_x".to_string(),
            distance_voxels: chunk_size - local_point.x,
        },
        BoundaryDistanceProbe {
            face: "neg_y".to_string(),
            distance_voxels: local_point.y,
        },
        BoundaryDistanceProbe {
            face: "pos_y".to_string(),
            distance_voxels: chunk_size - local_point.y,
        },
        BoundaryDistanceProbe {
            face: "neg_z".to_string(),
            distance_voxels: local_point.z,
        },
        BoundaryDistanceProbe {
            face: "pos_z".to_string(),
            distance_voxels: chunk_size - local_point.z,
        },
    ];
    distances.sort_by(|a, b| {
        a.distance_voxels
            .partial_cmp(&b.distance_voxels)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    distances.truncate(3);
    distances
}

pub(super) fn fan_gap_chunk_state(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    terrain_entities: &TerrainEntityQuery,
    camera_pos: Vec3,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) -> FanGapChunkState {
    let chunk = world.get_chunk(chunk_pos);
    let mesh_entity = chunk.and_then(|chunk| chunk.mesh_entity());
    let terrain_debug = mesh_entity
        .and_then(|entity| terrain_entities.get(entity).ok())
        .and_then(|(_, _, _, _, terrain_debug, _, _, _, _, _, _, _, _, _)| terrain_debug);

    FanGapChunkState {
        exists_in_world: chunk.is_some(),
        lod_level: chunk.map(|chunk| lod_name(chunk.lod_level()).to_string()),
        dirty: chunk.map(|chunk| chunk.is_dirty()),
        dirty_reason_flags: chunk.map(|chunk| chunk.dirty_reason_flags()),
        dirty_reasons: chunk
            .map(|chunk| dirty_reason_names(chunk.dirty_reason_flags()))
            .unwrap_or_default(),
        uniformity: chunk.map(|chunk| uniformity_name(chunk.uniformity()).to_string()),
        mesh_entity_from_world: mesh_entity.map(|entity| format!("{entity:?}")),
        lod_eval: lod_eval_probe(
            world,
            chunk_pos,
            Some(camera_pos),
            mesh_settings,
            lod_settings,
            water_lod_guard_chunks,
            terrain_debug,
        ),
        neighbor_lods_at_mesh: terrain_debug
            .map(|debug| neighbor_lods_probe(debug.neighbor_lods_at_mesh)),
        lod_transition_snap_at_mesh: terrain_debug
            .map(|debug| lod_transition_snap_stats_probe(debug.lod_transition_snap_stats)),
        mc_transvoxel_at_mesh: terrain_debug
            .and_then(|debug| debug.mc_transvoxel_stats.map(mc_transvoxel_stats_probe)),
        mesh_sections_at_mesh: terrain_debug
            .map(|debug| mesh_section_stats_probe(debug.mesh_section_stats)),
        empty_surface_cap_at_mesh: terrain_debug.map(|debug| debug.empty_surface_cap_at_mesh),
        empty_cap: empty_cap_probe(world, chunk_pos),
    }
}

pub(super) fn sample_neighbor_chunks(
    world: &VoxelWorld,
    center_chunk: IVec3,
    target_local: UVec3,
    terrain_entities: &TerrainEntityQuery,
    camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) -> Vec<ChunkProbe> {
    let mut chunks = Vec::new();
    for dz in -1..=1 {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let chunk_pos = center_chunk + IVec3::new(dx, dy, dz);
                let chunk = world.get_chunk(chunk_pos);
                let mesh_entity = chunk.and_then(|chunk| chunk.mesh_entity());
                let water_entity = chunk.and_then(|chunk| chunk.water_mesh_entity());
                let terrain_debug = mesh_entity
                    .and_then(|entity| terrain_entities.get(entity).ok())
                    .and_then(|(_, _, _, _, terrain_debug, _, _, _, _, _, _, _, _, _)| {
                        terrain_debug
                    });

                chunks.push(ChunkProbe {
                    chunk_position: chunk_pos.into(),
                    exists_in_world: chunk.is_some(),
                    lod_level: chunk.map(|chunk| lod_name(chunk.lod_level()).to_string()),
                    dirty: chunk.map(|chunk| chunk.is_dirty()),
                    dirty_reason_flags: chunk.map(|chunk| chunk.dirty_reason_flags()),
                    dirty_reasons: chunk
                        .map(|chunk| dirty_reason_names(chunk.dirty_reason_flags()))
                        .unwrap_or_default(),
                    visibility_dirty: chunk.map(|chunk| chunk.is_visibility_dirty()),
                    uniformity: chunk.map(|chunk| uniformity_name(chunk.uniformity()).to_string()),
                    mesh_entity_from_world: mesh_entity.map(|entity| format!("{entity:?}")),
                    water_mesh_entity_from_world: water_entity.map(|entity| format!("{entity:?}")),
                    target_local_y_is_boundary: target_local.y == 0 || target_local.y == 15,
                    lod_eval: lod_eval_probe(
                        world,
                        chunk_pos,
                        camera_pos,
                        mesh_settings,
                        lod_settings,
                        water_lod_guard_chunks,
                        terrain_debug,
                    ),
                    empty_cap: empty_cap_probe(world, chunk_pos),
                    terrain_entity: mesh_entity
                        .and_then(|entity| entity_probe(entity, terrain_entities)),
                    water_entity: water_entity
                        .and_then(|entity| entity_probe(entity, terrain_entities)),
                });
            }
        }
    }
    chunks
}

pub(super) fn lod_eval_probe(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
    terrain_debug: Option<&TerrainMeshDebug>,
) -> Option<LodEvalProbe> {
    let chunk = world.get_chunk(chunk_pos);
    let current_lod = chunk.map(|chunk| chunk.lod_level());
    let remesh_pending = chunk.is_some_and(|chunk| chunk.is_dirty());
    let remesh_reason_flags = chunk
        .map(|chunk| chunk.dirty_reason_flags())
        .unwrap_or_default();
    let distance_xz = camera_pos.map(|camera_pos| terrain_lod_distance_xz(chunk_pos, camera_pos));
    let water_shore_guarded = water_lod_guard_chunks.contains(&chunk_pos);
    let computed_target_lod = current_lod.map(|current_lod| {
        if current_lod == LodLevel::Culled {
            LodLevel::Culled
        } else {
            LodLevel::Lod0
        }
    });
    let effective_mesh_lod_now =
        effective_terrain_mesh_lod_for_chunk(world, chunk_pos, mesh_settings, lod_settings);
    let mesh_lod_mismatch =
        mesh_lod_mismatch_from_debug(current_lod, effective_mesh_lod_now, terrain_debug);
    let mesh_status = lod_mesh_status(mesh_lod_mismatch, remesh_pending);

    chunk?;
    Some(LodEvalProbe {
        distance_xz,
        high_detail_distance: lod_settings.high_detail_distance,
        cull_distance: lod_settings.cull_distance,
        hysteresis: terrain_lod_hysteresis(lod_settings),
        current_lod: current_lod.map(lod_string),
        computed_target_lod: computed_target_lod.map(lod_string),
        water_shore_guarded,
        water_guard_distance: 0.0,
        effective_mesh_lod_now: effective_mesh_lod_now.map(lod_string),
        last_logical_lod_at_mesh: terrain_debug.map(|debug| lod_string(debug.logical_lod_at_mesh)),
        last_meshed_lod: terrain_debug.map(|debug| lod_string(debug.effective_lod_at_mesh)),
        mesh_lod_mismatch,
        mesh_status,
        remesh_pending,
        remesh_reason_flags,
        remesh_reasons: dirty_reason_names(remesh_reason_flags),
    })
}

pub(super) fn lod_mesh_status(
    mesh_lod_mismatch: Option<bool>,
    remesh_pending: bool,
) -> LodMeshStatus {
    match mesh_lod_mismatch {
        Some(false) => LodMeshStatus::Current,
        Some(true) if remesh_pending => LodMeshStatus::RemeshPending,
        Some(true) => LodMeshStatus::Stale,
        None => LodMeshStatus::DebugUnavailable,
    }
}

pub(super) fn is_stale_or_pending_mesh_status(status: LodMeshStatus) -> bool {
    matches!(status, LodMeshStatus::Stale | LodMeshStatus::RemeshPending)
}

pub(super) fn mesh_lod_mismatch_from_debug(
    current_lod: Option<LodLevel>,
    effective_mesh_lod_now: Option<LodLevel>,
    terrain_debug: Option<&TerrainMeshDebug>,
) -> Option<bool> {
    terrain_debug.map(|debug| {
        current_lod != Some(debug.logical_lod_at_mesh)
            || effective_mesh_lod_now != Some(debug.effective_lod_at_mesh)
    })
}

pub(super) fn empty_cap_probe(world: &VoxelWorld, chunk_pos: IVec3) -> EmptyCapProbe {
    let is_empty = world
        .get_chunk(chunk_pos)
        .is_some_and(|chunk| chunk.uniformity() == ChunkUniformity::Empty);
    let below_pos = chunk_pos + IVec3::NEG_Y;
    let above_pos = chunk_pos + IVec3::Y;

    EmptyCapProbe {
        is_empty,
        empty_surface_cap_candidate: is_empty
            && empty_chunk_has_surface_nets_boundary_surface(world, chunk_pos),
        below_chunk_uniformity: world
            .get_chunk(below_pos)
            .map(|chunk| uniformity_name(chunk.uniformity()).to_string()),
        above_chunk_uniformity: world
            .get_chunk(above_pos)
            .map(|chunk| uniformity_name(chunk.uniformity()).to_string()),
        below_plane_solid_count: cap_plane_solid_count(world, chunk_pos, -1),
        above_plane_solid_count: cap_plane_solid_count(world, chunk_pos, CHUNK_SIZE_I32),
    }
}

pub(super) fn cap_plane_solid_count(world: &VoxelWorld, chunk_pos: IVec3, local_y: i32) -> u32 {
    let origin = VoxelWorld::chunk_to_world(chunk_pos);
    let y = origin.y + local_y;
    let mut count = 0;
    for x in 0..CHUNK_SIZE_I32 {
        for z in 0..CHUNK_SIZE_I32 {
            if world
                .sample_voxel_for_terrain_meshing(IVec3::new(origin.x + x, y, origin.z + z))
                .voxel()
                .is_some_and(|voxel| voxel.is_solid())
            {
                count += 1;
            }
        }
    }
    count
}

pub(super) fn classify_probe(
    target_pos: IVec3,
    target_local: UVec3,
    target_voxel: Option<VoxelType>,
    columns: &[ColumnProbe],
    physics: &PhysicsProbe,
    render_mesh_ray_hits: &[RenderMeshRayProbe],
    chunks: &[ChunkProbe],
    world: &VoxelWorld,
) -> TerrainHoleClassification {
    let mut classification = TerrainHoleClassification::default();
    let mut notes = Vec::new();
    let target_chunk = VoxelWorld::world_to_chunk(target_pos);
    classification.vertical_chunk_boundary_surface = target_local.y == 0 || target_local.y == 15;
    classification.expected_surface_y = expected_surface_y(columns);
    classification.physics_hit_y = physics.target_down_ray.hit.as_ref().map(|hit| hit.hit_y);
    classification.render_mesh_ray_hit_y = render_mesh_ray_hits
        .iter()
        .filter_map(|hit| hit.hit_y)
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    if let (Some(expected), Some(hit_y)) = (
        classification.expected_surface_y,
        classification.physics_hit_y,
    ) {
        let error = (hit_y - expected).abs();
        classification.physics_surface_error = Some(error);
        if error > 2.0 {
            classification.collider_surface_mismatch = true;
            notes.push(format!(
                "Target physics ray hit y={hit_y:.2}, expected terrain surface near y={expected:.2}."
            ));
        }
    } else if classification.expected_surface_y.is_some() {
        classification.collider_surface_mismatch = true;
        notes.push("Target physics ray did not hit an expected terrain surface.".to_string());
    }

    if let Some(expected) = classification.expected_surface_y {
        let render_error = classification
            .render_mesh_ray_hit_y
            .map(|hit_y| (hit_y - expected).abs());
        if render_error.map_or(true, |error| error > 2.0) {
            classification.mesh_surface_mismatch = true;
            notes.push(format!(
                "CPU render mesh ray missed expected terrain surface near y={expected:.2}."
            ));
        }
    }

    if target_voxel.is_none() {
        classification.world_data_hole = true;
        notes.push("Target voxel is outside loaded world data.".to_string());
    } else if target_voxel.is_some_and(|voxel| !voxel.is_solid()) {
        classification.world_data_hole = true;
        notes.push("Target voxel is not solid in VoxelWorld.".to_string());
    }

    if let Some(center_column) = columns
        .iter()
        .find(|column| column.offset_x == 0 && column.offset_z == 0)
    {
        if let Some(top_solid) = &center_column.first_solid_from_above {
            let top_y = top_solid.world_position.y;
            if top_y < target_pos.y - 1 {
                classification.world_data_hole = true;
                notes.push(format!(
                    "Center column first solid from above is y={top_y}, below target y={}.",
                    target_pos.y
                ));
            }
        } else {
            classification.world_data_hole = true;
            notes.push("Center column has no solid voxel in sampled range.".to_string());
        }
    }

    if let Some(chunk_probe) = chunks
        .iter()
        .find(|chunk| chunk.chunk_position == IVec3Dump::from(target_chunk))
    {
        let world_chunk = world.get_chunk(target_chunk);
        let needs_terrain_mesh = world_chunk.is_some_and(|chunk| {
            chunk.lod_level() != LodLevel::Culled && chunk.uniformity() != ChunkUniformity::Empty
        });

        classification.mesh_missing = needs_terrain_mesh && chunk_probe.terrain_entity.is_none();
        if classification.mesh_missing {
            notes.push(
                "Target chunk needs terrain mesh but has no terrain mesh entity.".to_string(),
            );
        }

        if let Some(entity) = &chunk_probe.terrain_entity {
            classification.collider_pending = entity.has_needs_collider;
            classification.collider_missing = !entity.has_collider && !entity.has_needs_collider;
            classification.collider_failed =
                !entity.has_collider && !entity.has_needs_collider && entity.has_chunk_mesh;
            classification.visibility_hidden = entity.visibility.as_deref() == Some("Hidden")
                || entity.inherited_visibility == Some(false)
                || entity.view_visibility == Some(false);

            if classification.collider_pending {
                notes.push(
                    "Target chunk mesh has NeedsCollider; collider generation is pending."
                        .to_string(),
                );
            }
            if classification.collider_missing {
                notes.push("Target chunk mesh has no Collider component.".to_string());
            }
            if classification.visibility_hidden {
                notes.push(
                    "Target chunk mesh is hidden by Visibility/InheritedVisibility/ViewVisibility."
                        .to_string(),
                );
            }
        } else if needs_terrain_mesh {
            classification.collider_missing = true;
        }
    }

    if physics.player_down_ray.hit.is_none() {
        notes.push("Player downward physics ray did not hit terrain.".to_string());
    }
    if physics.target_down_ray.hit.is_none() {
        notes.push("Target downward physics ray did not hit terrain.".to_string());
    }

    classification.notes = notes;
    classification
}
