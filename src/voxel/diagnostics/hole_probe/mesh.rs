use super::*;

#[cfg(feature = "mc_transvoxel")]
pub(super) fn sample_active_seam_faces(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    target_chunk: IVec3,
    camera_ray_fan: Option<&CameraRayFan>,
    visual_context: Option<&VisualProbeContext>,
    camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) -> Vec<SeamFaceProbe> {
    use crate::voxel::mc_transvoxel::compute_transvoxel_face_mask;

    const MAX_SEAM_FACES: usize = 32;
    const SEAM_SAMPLE_GRID_U: u32 = 5;
    const SEAM_SAMPLE_GRID_V: u32 = 5;

    let mut probes = Vec::new();
    let mut visited = HashSet::new();
    let candidate_chunks = probe_candidate_chunks(world, target_chunk, camera_ray_fan);

    for source_chunk in candidate_chunks {
        if probes.len() >= MAX_SEAM_FACES {
            break;
        }
        let Some(source_grid) = build_mc_sdf_grid_probe(world, terrain_entities, source_chunk)
        else {
            continue;
        };
        for face in ChunkFace::ALL {
            if probes.len() >= MAX_SEAM_FACES {
                break;
            }
            let neighbor_chunk = source_chunk + face.direction();
            let Some(neighbor_grid) =
                build_mc_sdf_grid_probe(world, terrain_entities, neighbor_chunk)
            else {
                continue;
            };
            if source_grid.lod == neighbor_grid.lod
                || !source_grid.lod.is_higher_detail_than(neighbor_grid.lod)
            {
                continue;
            }
            let key = (source_chunk, neighbor_chunk, face_mask_bit(face));
            if !visited.insert(key) {
                continue;
            }

            let source_chunk_data = world.get_chunk(source_chunk);
            let neighbor_chunk_data = world.get_chunk(neighbor_chunk);
            let source_debug = terrain_mesh_debug_for_chunk(world, terrain_entities, source_chunk);
            let neighbor_debug =
                terrain_mesh_debug_for_chunk(world, terrain_entities, neighbor_chunk);
            let (transition_mask, _) =
                compute_transvoxel_face_mask(source_grid.lod, &source_grid.neighbor_lods);
            let transition_owner = transition_mask.get(face);
            let skipped_regular_boundary_row = false;
            let lod_delta_gt_one = source_debug
                .map(|debug| (debug.lod_delta_gt_one_face_mask & (1u8 << face_mask_bit(face))) != 0)
                .unwrap_or(false);

            let samples = seam_face_samples(
                world,
                terrain_entities,
                meshes,
                &source_grid,
                &neighbor_grid,
                face,
                SEAM_SAMPLE_GRID_U,
                SEAM_SAMPLE_GRID_V,
                visual_context,
            );
            let mut height_deltas: Vec<f32> = samples
                .iter()
                .filter_map(|sample| sample.abs_height_delta)
                .collect();
            height_deltas.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let max_abs_height_delta = height_deltas.last().copied();
            let median_abs_height_delta = median_sorted(&height_deltas);
            let mut face_offset_deltas: Vec<f32> = samples
                .iter()
                .filter_map(|sample| sample.abs_face_offset_delta)
                .collect();
            face_offset_deltas
                .sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let max_abs_face_offset_delta = face_offset_deltas.last().copied();
            let median_abs_face_offset_delta = median_sorted(&face_offset_deltas);
            let possible_terrace_sample_count = samples
                .iter()
                .filter(|sample| {
                    seam_sample_displacement_delta(sample).is_some_and(|delta| delta > 0.5)
                })
                .count() as u32;
            let missing_render_coverage_sample_count = samples
                .iter()
                .filter(|sample| !sample.has_render_coverage_near_either_iso)
                .count() as u32;

            let transition_coverage = transition_coverage_probe(
                world,
                terrain_entities,
                source_chunk,
                face,
                skipped_regular_boundary_row,
                transition_owner,
                &samples,
            );
            let boundary_edges =
                boundary_edge_leak_probe(world, terrain_entities, meshes, source_chunk, face);

            probes.push(SeamFaceProbe {
                source_chunk: source_chunk.into(),
                neighbor_chunk: neighbor_chunk.into(),
                face: chunk_face_name(face).to_string(),
                source_lod: lod_string(source_grid.lod),
                neighbor_lod: lod_string(neighbor_grid.lod),
                fine_chunk: source_chunk.into(),
                coarse_chunk: neighbor_chunk.into(),
                fine_lod: lod_string(source_grid.lod),
                coarse_lod: lod_string(neighbor_grid.lod),
                source_mesh_status: mesh_status_for_chunk(
                    world,
                    source_chunk,
                    camera_pos,
                    mesh_settings,
                    lod_settings,
                    water_lod_guard_chunks,
                    source_debug.as_ref(),
                ),
                neighbor_mesh_status: mesh_status_for_chunk(
                    world,
                    neighbor_chunk,
                    camera_pos,
                    mesh_settings,
                    lod_settings,
                    water_lod_guard_chunks,
                    neighbor_debug.as_ref(),
                ),
                source_generated_frame: source_debug.map(|debug| debug.generated_frame),
                neighbor_generated_frame: neighbor_debug.map(|debug| debug.generated_frame),
                same_generated_frame_as_neighbor: source_debug
                    .zip(neighbor_debug)
                    .map(|(source, neighbor)| source.generated_frame == neighbor.generated_frame),
                source_dirty_reasons: source_chunk_data
                    .map(|chunk| dirty_reason_names(chunk.dirty_reason_flags()))
                    .unwrap_or_default(),
                neighbor_dirty_reasons: neighbor_chunk_data
                    .map(|chunk| dirty_reason_names(chunk.dirty_reason_flags()))
                    .unwrap_or_default(),
                source_render_entity: render_entity_checklist_for_chunk(
                    world,
                    terrain_entities,
                    meshes,
                    source_chunk,
                    camera_pos,
                    mesh_settings,
                    lod_settings,
                    water_lod_guard_chunks,
                ),
                neighbor_render_entity: render_entity_checklist_for_chunk(
                    world,
                    terrain_entities,
                    meshes,
                    neighbor_chunk,
                    camera_pos,
                    mesh_settings,
                    lod_settings,
                    water_lod_guard_chunks,
                ),
                transition_owner,
                skipped_regular_boundary_row,
                lod_delta_gt_one,
                source_chunk_skipped_lod_delta_gt_one: source_grid
                    .source_chunk_skipped_lod_delta_gt_one,
                neighbor_chunk_skipped_lod_delta_gt_one: neighbor_grid
                    .source_chunk_skipped_lod_delta_gt_one,
                sample_count: samples.len() as u32,
                sample_grid_u: SEAM_SAMPLE_GRID_U,
                sample_grid_v: SEAM_SAMPLE_GRID_V,
                possible_terrace_sample_count,
                missing_render_coverage_sample_count,
                max_abs_height_delta,
                median_abs_height_delta,
                max_abs_face_offset_delta,
                median_abs_face_offset_delta,
                samples,
                transition_coverage,
                boundary_edges,
            });
        }
    }

    probes
}

#[cfg(not(feature = "mc_transvoxel"))]
#[allow(clippy::too_many_arguments)]
pub(super) fn sample_active_seam_faces(
    _world: &VoxelWorld,
    _terrain_entities: &TerrainEntityQuery,
    _meshes: &Assets<Mesh>,
    _target_chunk: IVec3,
    _camera_ray_fan: Option<&CameraRayFan>,
    _visual_context: Option<&VisualProbeContext>,
    _camera_pos: Option<Vec3>,
    _mesh_settings: &MeshSettings,
    _lod_settings: &LodSettings,
    _water_lod_guard_chunks: &HashSet<IVec3>,
) -> Vec<SeamFaceProbe> {
    Vec::new()
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn probe_candidate_chunks(
    world: &VoxelWorld,
    target_chunk: IVec3,
    camera_ray_fan: Option<&CameraRayFan>,
) -> Vec<IVec3> {
    let mut anchors = HashSet::from([target_chunk]);
    if let Some(fan) = camera_ray_fan {
        for gap in &fan.gaps {
            anchors.insert(ivec3_from_dump(gap.surface_chunk));
            if let Some(cell) = &gap.mc_cell {
                anchors.insert(ivec3_from_dump(cell.chunk_position));
            }
            if let Some(cell) = &gap.mesher_iso_mc_cell {
                anchors.insert(ivec3_from_dump(cell.chunk_position));
            }
        }
    }

    let mut chunks: Vec<IVec3> = world
        .chunk_positions()
        .filter(|chunk| {
            anchors.iter().any(|anchor| {
                let delta = (*chunk - *anchor).abs();
                delta.x <= 2 && delta.y <= 1 && delta.z <= 2
            })
        })
        .collect();
    chunks.sort_by(|a, b| {
        let da = (*a - target_chunk).abs().max_element();
        let db = (*b - target_chunk).abs().max_element();
        da.cmp(&db).then_with(|| compare_chunk_pos_lex(*a, *b))
    });
    chunks.truncate(96);
    chunks
}

#[cfg(feature = "mc_transvoxel")]
#[allow(clippy::too_many_arguments)]
pub(super) fn seam_face_samples(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    source_grid: &McSdfGridProbe,
    neighbor_grid: &McSdfGridProbe,
    face: ChunkFace,
    sample_grid_u: u32,
    sample_grid_v: u32,
    visual_context: Option<&VisualProbeContext>,
) -> Vec<SeamFaceSampleProbe> {
    let source_origin = VoxelWorld::chunk_to_world(source_grid.chunk_position).as_vec3();
    let normal = face.direction().as_vec3();
    let mut samples = Vec::new();

    for sample_v_index in 0..sample_grid_v {
        let face_v = normalized_grid_coord(sample_v_index, sample_grid_v);
        for sample_u_index in 0..sample_grid_u {
            let face_u = normalized_grid_coord(sample_u_index, sample_grid_u);
            let sample_index = sample_v_index * sample_grid_u + sample_u_index;
            let seam_point_base = seam_face_sample_point(source_origin, face, face_u, face_v);
            let fine_iso_height = highest_vertical_iso_height_in_grid(
                source_grid,
                seam_point_base.x,
                seam_point_base.z,
            );
            let coarse_iso_height = highest_vertical_iso_height_in_grid(
                neighbor_grid,
                seam_point_base.x,
                seam_point_base.z,
            );
            let signed_delta = fine_iso_height
                .zip(coarse_iso_height)
                .map(|(fine, coarse)| coarse - fine);
            let seam_y = fine_iso_height
                .zip(coarse_iso_height)
                .map(|(fine, coarse)| (fine + coarse) * 0.5)
                .or(fine_iso_height)
                .or(coarse_iso_height)
                .unwrap_or(seam_point_base.y);
            let seam_point = if matches!(face, ChunkFace::NegY | ChunkFace::PosY) {
                seam_point_base
            } else {
                Vec3::new(seam_point_base.x, seam_y, seam_point_base.z)
            };
            let fine_face_iso_offset =
                nearest_face_normal_iso_offset_in_grid(source_grid, seam_point, normal);
            let coarse_face_iso_offset =
                nearest_face_normal_iso_offset_in_grid(neighbor_grid, seam_point, normal);
            let signed_face_offset_delta = fine_face_iso_offset
                .zip(coarse_face_iso_offset)
                .map(|(fine, coarse)| coarse - fine);
            let (render_hit_y, render_hit_chunk, render_hit_entity, render_hit_mesh_section) =
                highest_render_mesh_hit_at(
                    world,
                    terrain_entities,
                    meshes,
                    source_grid.chunk_position,
                    seam_point_base.x,
                    seam_point_base.z,
                    seam_y + CHUNK_SIZE_I32 as f32,
                );
            let render_distance_from_fine_iso = render_hit_y
                .zip(fine_iso_height)
                .map(|(render, iso)| render - iso);
            let render_distance_from_coarse_iso = render_hit_y
                .zip(coarse_iso_height)
                .map(|(render, iso)| render - iso);
            let face_render_radius =
                (source_grid.step.max(neighbor_grid.step) as f32 * 2.5).max(2.0);
            let preferred_face_render_distances = [fine_face_iso_offset, coarse_face_iso_offset]
                .into_iter()
                .flatten()
                .map(|offset| face_render_radius + offset)
                .collect::<Vec<_>>();
            let face_render_hit = (!matches!(face, ChunkFace::NegY | ChunkFace::PosY))
                .then(|| {
                    nearest_render_mesh_hit_along_ray(
                        world,
                        terrain_entities,
                        meshes,
                        source_grid.chunk_position,
                        seam_point - normal * face_render_radius,
                        normal,
                        face_render_radius * 2.0,
                        &preferred_face_render_distances,
                    )
                })
                .flatten();
            let render_face_offset = face_render_hit
                .as_ref()
                .map(|hit| hit.distance - face_render_radius);
            let render_distance_from_fine_face_iso = render_face_offset
                .zip(fine_face_iso_offset)
                .map(|(render, iso)| render - iso);
            let render_distance_from_coarse_face_iso = render_face_offset
                .zip(coarse_face_iso_offset)
                .map(|(render, iso)| render - iso);
            let vertical_render_coverage = render_distance_from_fine_iso
                .is_some_and(|delta| delta.abs() <= 1.0)
                || render_distance_from_coarse_iso.is_some_and(|delta| delta.abs() <= 1.0);
            let face_render_coverage = render_distance_from_fine_face_iso
                .is_some_and(|delta| delta.abs() <= 1.0)
                || render_distance_from_coarse_face_iso.is_some_and(|delta| delta.abs() <= 1.0);
            let has_render_coverage_near_either_iso =
                if matches!(face, ChunkFace::NegY | ChunkFace::PosY) {
                    vertical_render_coverage
                } else {
                    face_render_coverage
                };
            let visual = visual_point_probe(visual_context, seam_point);
            samples.push(SeamFaceSampleProbe {
                sample_index,
                face_u,
                face_v,
                seam_point: seam_point.into(),
                screen_position: visual.screen_position,
                fine_iso_height,
                coarse_iso_height,
                signed_height_delta_coarse_minus_fine: signed_delta,
                abs_height_delta: signed_delta.map(f32::abs),
                fine_face_iso_offset,
                coarse_face_iso_offset,
                signed_face_offset_delta_coarse_minus_fine: signed_face_offset_delta,
                abs_face_offset_delta: signed_face_offset_delta.map(f32::abs),
                render_hit_y,
                render_hit_chunk,
                render_hit_entity,
                render_hit_mesh_section,
                render_distance_from_fine_iso,
                render_distance_from_coarse_iso,
                render_face_offset,
                render_face_hit_point: face_render_hit.as_ref().map(|hit| hit.point.into()),
                render_face_hit_chunk: face_render_hit.as_ref().map(|hit| hit.chunk),
                render_face_hit_entity: face_render_hit.as_ref().map(|hit| hit.entity.clone()),
                render_face_hit_mesh_section: face_render_hit.as_ref().map(|hit| hit.mesh_section),
                render_distance_from_fine_face_iso,
                render_distance_from_coarse_face_iso,
                has_render_coverage_near_either_iso,
                visual,
            });
        }
    }

    samples
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn normalized_grid_coord(index: u32, count: u32) -> f32 {
    if count <= 1 {
        0.5
    } else {
        index as f32 / (count - 1) as f32
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn seam_face_sample_point(
    chunk_origin: Vec3,
    face: ChunkFace,
    face_u: f32,
    face_v: f32,
) -> Vec3 {
    let size = CHUNK_SIZE_I32 as f32;
    let min_x = chunk_origin.x;
    let min_y = chunk_origin.y;
    let min_z = chunk_origin.z;
    let max_x = chunk_origin.x + size;
    let max_y = chunk_origin.y + size;
    let max_z = chunk_origin.z + size;
    let u = face_u.clamp(0.0, 1.0);
    let v = face_v.clamp(0.0, 1.0);
    match face {
        ChunkFace::NegX => Vec3::new(min_x, min_y + size * v, min_z + size * u),
        ChunkFace::PosX => Vec3::new(max_x, min_y + size * v, min_z + size * u),
        ChunkFace::NegY => Vec3::new(min_x + size * u, min_y, min_z + size * v),
        ChunkFace::PosY => Vec3::new(min_x + size * u, max_y, min_z + size * v),
        ChunkFace::NegZ => Vec3::new(min_x + size * u, min_y + size * v, min_z),
        ChunkFace::PosZ => Vec3::new(min_x + size * u, min_y + size * v, max_z),
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn nearest_face_normal_iso_offset_in_grid(
    grid: &McSdfGridProbe,
    seam_point: Vec3,
    normal: Vec3,
) -> Option<f32> {
    let normal = normal.normalize_or_zero();
    if normal == Vec3::ZERO {
        return None;
    }
    let chunk_origin = VoxelWorld::chunk_to_world(grid.chunk_position).as_vec3();
    let radius = (grid.step as f32 * 2.5).max(2.0);
    let origin = seam_point - normal * radius;
    first_mesher_iso_in_sdf_grid(
        origin,
        normal,
        radius * 2.0,
        chunk_origin,
        grid.padded,
        &grid.values,
        grid.step,
    )
    .map(|(distance, _)| distance - radius)
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn seam_sample_displacement_delta(sample: &SeamFaceSampleProbe) -> Option<f32> {
    sample.abs_face_offset_delta.or(sample.abs_height_delta)
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn transition_coverage_probe(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    source_chunk: IVec3,
    face: ChunkFace,
    skipped_regular_face: bool,
    transition_owner: bool,
    samples: &[SeamFaceSampleProbe],
) -> TransitionCoverageProbe {
    let sources = terrain_triangle_sources_for_chunk(world, terrain_entities, source_chunk);
    let actual_transition_triangle_count = sources.map(|sources| {
        sources
            .sources
            .iter()
            .filter(|source| {
                matches!(
                    source,
                    McTriangleSource::Transition {
                        chunk_pos,
                        face: source_face,
                        ..
                    } if *chunk_pos == source_chunk && *source_face == face
                )
            })
            .count() as u32
    });
    let actual_transition_cell_count = sources.map(|sources| {
        let mut cells = HashSet::new();
        for source in &sources.sources {
            if let McTriangleSource::Transition {
                chunk_pos,
                face: source_face,
                cell_u,
                cell_v,
                ..
            } = source
            {
                if *chunk_pos == source_chunk && *source_face == face {
                    cells.insert((*cell_u, *cell_v));
                }
            }
        }
        cells.len() as u32
    });
    let samples_without_render_coverage = samples
        .iter()
        .filter(|sample| !sample.has_render_coverage_near_either_iso)
        .count() as u32;
    let samples_without_transition_render_coverage = if skipped_regular_face && transition_owner {
        samples
            .iter()
            .filter(|sample| {
                let render_section = sample
                    .render_face_hit_mesh_section
                    .or(sample.render_hit_mesh_section);
                !matches!(
                    render_section,
                    Some(MeshTriangleSectionProbe::TransitionApron)
                        | Some(MeshTriangleSectionProbe::TransitionGeometry)
                )
            })
            .count() as u32
    } else {
        0
    };
    let coverage_note = if !skipped_regular_face {
        "regular boundary row is kept for this face; transition geometry is supplemental"
            .to_string()
    } else if actual_transition_triangle_count == Some(0) {
        "regular boundary row is skipped, but no transition triangles were recorded for this face"
            .to_string()
    } else if samples_without_render_coverage > 0 {
        "regular boundary row is skipped and at least one seam sample lacks render coverage near either iso"
            .to_string()
    } else if samples_without_transition_render_coverage > 0 {
        "regular boundary row is skipped; render coverage exists, but some samples did not hit transition-tagged geometry first"
            .to_string()
    } else {
        "transition-tagged geometry covers the sampled skipped boundary row".to_string()
    };

    TransitionCoverageProbe {
        skipped_regular_face,
        transition_owner,
        actual_transition_triangle_count,
        actual_transition_cell_count,
        sample_count: samples.len() as u32,
        samples_without_render_coverage,
        samples_without_transition_render_coverage,
        coverage_note,
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn boundary_edge_leak_probe(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    chunk_pos: IVec3,
    face: ChunkFace,
) -> BoundaryEdgeLeakProbe {
    let mut inspected_triangle_count = 0u32;
    let mut edges = Vec::new();
    collect_boundary_edges_for_chunk(
        world,
        terrain_entities,
        meshes,
        chunk_pos,
        face,
        &mut inspected_triangle_count,
        &mut edges,
    );
    collect_boundary_edges_for_chunk(
        world,
        terrain_entities,
        meshes,
        chunk_pos + face.direction(),
        face.opposite(),
        &mut inspected_triangle_count,
        &mut edges,
    );

    let mut unmatched: Vec<&BoundaryEdgeAccum> = edges
        .iter()
        .filter(|edge| !edge_has_opposite_side_coverage(edge, &edges))
        .collect();
    unmatched.sort_by(|a, b| {
        b.length
            .partial_cmp(&a.length)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let unmatched_transition_edge_count =
        unmatched.iter().filter(|edge| edge.transition).count() as u32;
    let unmatched_regular_edge_count =
        unmatched.iter().filter(|edge| !edge.transition).count() as u32;
    let longest_unmatched_edge = unmatched.first().map(|edge| edge.length);
    let examples = unmatched
        .iter()
        .take(8)
        .map(|edge| BoundaryEdgeExampleProbe {
            start: edge.start.into(),
            end: edge.end.into(),
            length: edge.length,
            source: edge.source.clone(),
        })
        .collect();

    BoundaryEdgeLeakProbe {
        inspected_triangle_count,
        seam_edge_count: edges.len() as u32,
        unmatched_seam_edge_count: unmatched.len() as u32,
        unmatched_transition_edge_count,
        unmatched_regular_edge_count,
        longest_unmatched_edge,
        examples,
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn collect_boundary_edges_for_chunk(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    chunk_pos: IVec3,
    face: ChunkFace,
    inspected_triangle_count: &mut u32,
    edges: &mut Vec<BoundaryEdgeAccum>,
) {
    let Some((mesh, translation, sources)) =
        terrain_mesh_and_sources_for_chunk(world, terrain_entities, meshes, chunk_pos)
    else {
        return;
    };

    for (triangle_index, source) in sources.sources.iter().enumerate() {
        if !source_touches_face(source, chunk_pos, face) {
            continue;
        }
        let triangle_start = triangle_index * 3;
        let Some(vertices) = mesh_triangle_vertices(mesh, translation, triangle_start) else {
            continue;
        };
        *inspected_triangle_count += 1;
        for (a, b) in [
            (vertices[0], vertices[1]),
            (vertices[1], vertices[2]),
            (vertices[2], vertices[0]),
        ] {
            if !edge_lies_on_chunk_face(a, b, chunk_pos, face) {
                continue;
            }
            edges.push(BoundaryEdgeAccum {
                source: Some(mc_triangle_source_probe(source)),
                start: a,
                end: b,
                length: a.distance(b),
                transition: matches!(source, McTriangleSource::Transition { .. }),
            });
        }
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) struct BoundaryEdgeAccum {
    pub(super) source: Option<McTriangleSourceProbe>,
    pub(super) start: Vec3,
    pub(super) end: Vec3,
    pub(super) length: f32,
    pub(super) transition: bool,
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn edge_has_opposite_side_coverage(
    edge: &BoundaryEdgeAccum,
    edges: &[BoundaryEdgeAccum],
) -> bool {
    const EPSILON: f32 = 0.05;
    if edge.length <= EPSILON {
        return true;
    }

    let mut intervals = edges
        .iter()
        .filter(|candidate| !std::ptr::eq(*candidate, edge))
        .filter_map(|candidate| edge_overlap_interval(edge, candidate, EPSILON))
        .collect::<Vec<_>>();
    if intervals.is_empty() {
        return false;
    }
    intervals.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

    let mut covered_until = 0.0_f32;
    for (start, end) in intervals {
        if end <= covered_until + EPSILON {
            covered_until = covered_until.max(end);
            continue;
        }
        if start > covered_until + EPSILON {
            return false;
        }
        covered_until = covered_until.max(end);
        if covered_until >= edge.length - EPSILON {
            return true;
        }
    }

    covered_until >= edge.length - EPSILON
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn edge_overlap_interval(
    edge: &BoundaryEdgeAccum,
    candidate: &BoundaryEdgeAccum,
    epsilon: f32,
) -> Option<(f32, f32)> {
    if candidate.length <= epsilon {
        return None;
    }
    let dir = (edge.end - edge.start).normalize_or_zero();
    if dir == Vec3::ZERO {
        return None;
    }
    if point_line_distance(candidate.start, edge.start, dir) > epsilon
        || point_line_distance(candidate.end, edge.start, dir) > epsilon
    {
        return None;
    }
    let a = (candidate.start - edge.start).dot(dir);
    let b = (candidate.end - edge.start).dot(dir);
    let start = a.min(b).max(0.0);
    let end = a.max(b).min(edge.length);
    (end - start > epsilon).then_some((start, end))
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn point_line_distance(point: Vec3, line_origin: Vec3, line_dir: Vec3) -> f32 {
    let to_point = point - line_origin;
    (to_point - line_dir * to_point.dot(line_dir)).length()
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn source_touches_face(
    source: &McTriangleSource,
    chunk_pos: IVec3,
    face: ChunkFace,
) -> bool {
    match source {
        McTriangleSource::Transition {
            chunk_pos: source_chunk,
            face: source_face,
            ..
        } => *source_chunk == chunk_pos && *source_face == face,
        McTriangleSource::Regular {
            chunk_pos: source_chunk,
            lod,
            cell,
            ..
        } => {
            if *source_chunk != chunk_pos {
                return false;
            }
            let subdivisions = CHUNK_SIZE_I32 as u32 / lod.step_size().max(1);
            let max_cell = subdivisions.saturating_sub(1);
            match face {
                ChunkFace::NegX => cell.x == 0,
                ChunkFace::PosX => cell.x >= max_cell,
                ChunkFace::NegY => cell.y == 0,
                ChunkFace::PosY => cell.y >= max_cell,
                ChunkFace::NegZ => cell.z == 0,
                ChunkFace::PosZ => cell.z >= max_cell,
            }
        }
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn edge_lies_on_chunk_face(a: Vec3, b: Vec3, chunk_pos: IVec3, face: ChunkFace) -> bool {
    const EPSILON: f32 = 0.05;
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos).as_vec3();
    let face_coord = match face {
        ChunkFace::NegX => chunk_origin.x,
        ChunkFace::PosX => chunk_origin.x + CHUNK_SIZE_I32 as f32,
        ChunkFace::NegY => chunk_origin.y,
        ChunkFace::PosY => chunk_origin.y + CHUNK_SIZE_I32 as f32,
        ChunkFace::NegZ => chunk_origin.z,
        ChunkFace::PosZ => chunk_origin.z + CHUNK_SIZE_I32 as f32,
    };
    let (a_coord, b_coord) = match face {
        ChunkFace::NegX | ChunkFace::PosX => (a.x, b.x),
        ChunkFace::NegY | ChunkFace::PosY => (a.y, b.y),
        ChunkFace::NegZ | ChunkFace::PosZ => (a.z, b.z),
    };
    (a_coord - face_coord).abs() <= EPSILON && (b_coord - face_coord).abs() <= EPSILON
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn terrain_mesh_and_sources_for_chunk<'a>(
    world: &VoxelWorld,
    terrain_entities: &'a TerrainEntityQuery,
    meshes: &'a Assets<Mesh>,
    chunk_pos: IVec3,
) -> Option<(&'a Mesh, Vec3, &'a McTriangleSources)> {
    let entity = world.get_chunk(chunk_pos)?.mesh_entity()?;
    let Ok((
        _entity,
        mesh3d,
        transform,
        _chunk_mesh,
        _terrain_debug,
        sources,
        _water_mesh,
        _visibility,
        _inherited_visibility,
        _view_visibility,
        _needs_collider,
        _chunk_collider,
        _collider,
        _rigid_body,
    )) = terrain_entities.get(entity)
    else {
        return None;
    };
    let mesh = meshes.get(&mesh3d?.0)?;
    let translation = transform
        .map(|transform| transform.translation)
        .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
    Some((mesh, translation, sources?))
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn terrain_triangle_sources_for_chunk<'a>(
    world: &VoxelWorld,
    terrain_entities: &'a TerrainEntityQuery,
    chunk_pos: IVec3,
) -> Option<&'a McTriangleSources> {
    let entity = world.get_chunk(chunk_pos)?.mesh_entity()?;
    let Ok((
        _entity,
        _mesh3d,
        _transform,
        _chunk_mesh,
        _terrain_debug,
        sources,
        _water_mesh,
        _visibility,
        _inherited_visibility,
        _view_visibility,
        _needs_collider,
        _chunk_collider,
        _collider,
        _rigid_body,
    )) = terrain_entities.get(entity)
    else {
        return None;
    };
    sources
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn median_sorted(values: &[f32]) -> Option<f32> {
    if values.is_empty() {
        return None;
    }
    let mid = values.len() / 2;
    if values.len() % 2 == 0 {
        Some((values[mid - 1] + values[mid]) * 0.5)
    } else {
        Some(values[mid])
    }
}

pub(super) fn entity_probe(
    entity: Entity,
    terrain_entities: &TerrainEntityQuery,
) -> Option<EntityProbe> {
    let (
        entity,
        _mesh3d,
        _transform,
        chunk_mesh,
        terrain_debug,
        _mc_triangle_sources,
        water_mesh,
        visibility,
        inherited_visibility,
        view_visibility,
        needs_collider,
        chunk_collider,
        collider,
        body,
    ) = terrain_entities.get(entity).ok()?;

    Some(EntityProbe {
        entity: format!("{entity:?}"),
        chunk_mesh: chunk_mesh.map(|chunk_mesh| ChunkMeshProbe {
            chunk_position: chunk_mesh.chunk_position.into(),
            vertex_count: chunk_mesh.vertex_count,
            triangle_count: chunk_mesh.triangle_count,
            mesh_mode: format!("{:?}", chunk_mesh.mesh_mode),
            material_quality: format!("{:?}", chunk_mesh.material_quality),
            logical_lod_at_mesh: terrain_debug.map(|debug| lod_string(debug.logical_lod_at_mesh)),
            effective_lod_at_mesh: terrain_debug
                .map(|debug| lod_string(debug.effective_lod_at_mesh)),
            target_mode_at_mesh: terrain_debug
                .map(|debug| mesh_mode_string(debug.target_mode_at_mesh)),
            neighbor_lods_at_mesh: terrain_debug
                .map(|debug| neighbor_lods_probe(debug.neighbor_lods_at_mesh)),
            lod_delta_gt_one_faces_at_mesh: terrain_debug
                .map(|debug| face_mask_names(debug.lod_delta_gt_one_face_mask)),
            missing_boundary_neighbors_at_mesh: terrain_debug
                .map(|debug| debug.missing_boundary_neighbors_at_mesh),
            empty_surface_cap_at_mesh: terrain_debug.map(|debug| debug.empty_surface_cap_at_mesh),
            generated_frame: terrain_debug.map(|debug| debug.generated_frame),
            lod_transition_snap: terrain_debug
                .map(|debug| lod_transition_snap_stats_probe(debug.lod_transition_snap_stats)),
            mc_transvoxel: terrain_debug
                .and_then(|debug| debug.mc_transvoxel_stats.map(mc_transvoxel_stats_probe)),
            mesh_sections: terrain_debug
                .map(|debug| mesh_section_stats_probe(debug.mesh_section_stats)),
        }),
        visibility: visibility.map(|visibility| format!("{visibility:?}")),
        inherited_visibility: inherited_visibility.map(|visibility| visibility.get()),
        view_visibility: view_visibility.map(|visibility| visibility.get()),
        has_chunk_mesh: chunk_mesh.is_some(),
        has_water_mesh: water_mesh.is_some(),
        has_needs_collider: needs_collider.is_some(),
        has_chunk_collider: chunk_collider.is_some(),
        has_collider: collider.is_some(),
        has_static_rigid_body: matches!(body, Some(RigidBody::Static)),
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn render_entity_checklist_for_chunk(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    chunk_pos: IVec3,
    camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) -> Option<RenderEntityChecklistProbe> {
    let chunk = world.get_chunk(chunk_pos);
    let mesh_entity = chunk.and_then(|chunk| chunk.mesh_entity());
    let (
        entity_query_found,
        mesh_handle_present,
        mesh_asset_loaded,
        position_attribute_present,
        normal_attribute_present,
        index_buffer_present,
        chunk_mesh_component_present,
        terrain_debug_present,
        visibility,
        inherited_visibility,
        view_visibility,
        mesh_mode_at_component,
        target_mode_at_mesh,
        logical_lod_at_mesh,
        effective_lod_at_mesh,
        generated_frame,
        component_vertex_count,
        component_triangle_count,
    ) = if let Some(entity) = mesh_entity {
        match terrain_entities.get(entity) {
            Ok((
                _entity,
                mesh3d,
                _transform,
                chunk_mesh,
                terrain_debug,
                _mc_triangle_sources,
                _water_mesh,
                visibility,
                inherited_visibility,
                view_visibility,
                _needs_collider,
                _chunk_collider,
                _collider,
                _rigid_body,
            )) => {
                let mesh = mesh3d.and_then(|mesh3d| meshes.get(&mesh3d.0));
                (
                    true,
                    mesh3d.is_some(),
                    mesh.is_some(),
                    mesh.is_some_and(|mesh| mesh.attribute(Mesh::ATTRIBUTE_POSITION).is_some()),
                    mesh.is_some_and(|mesh| mesh.attribute(Mesh::ATTRIBUTE_NORMAL).is_some()),
                    mesh.is_some_and(|mesh| mesh.indices().is_some()),
                    chunk_mesh.is_some(),
                    terrain_debug.is_some(),
                    visibility.map(|visibility| format!("{visibility:?}")),
                    inherited_visibility.map(|visibility| visibility.get()),
                    view_visibility.map(|visibility| visibility.get()),
                    chunk_mesh.map(|chunk_mesh| format!("{:?}", chunk_mesh.mesh_mode)),
                    terrain_debug.map(|debug| mesh_mode_string(debug.target_mode_at_mesh)),
                    terrain_debug.map(|debug| lod_string(debug.logical_lod_at_mesh)),
                    terrain_debug.map(|debug| lod_string(debug.effective_lod_at_mesh)),
                    terrain_debug.map(|debug| debug.generated_frame),
                    chunk_mesh.map(|chunk_mesh| chunk_mesh.vertex_count),
                    chunk_mesh.map(|chunk_mesh| chunk_mesh.triangle_count),
                )
            }
            Err(_) => (
                false, false, false, false, false, false, false, false, None, None, None, None,
                None, None, None, None, None, None,
            ),
        }
    } else {
        (
            false, false, false, false, false, false, false, false, None, None, None, None, None,
            None, None, None, None, None,
        )
    };

    let terrain_debug = terrain_mesh_debug_for_chunk(world, terrain_entities, chunk_pos);
    let current_lod = chunk.map(|chunk| chunk.lod_level());
    let dirty = chunk.map(|chunk| chunk.is_dirty());
    let mesh_status = mesh_status_for_chunk(
        world,
        chunk_pos,
        camera_pos,
        mesh_settings,
        lod_settings,
        water_lod_guard_chunks,
        terrain_debug.as_ref(),
    );
    Some(RenderEntityChecklistProbe {
        chunk_position: chunk_pos.into(),
        mesh_entity_from_world: mesh_entity.map(|entity| format!("{entity:?}")),
        entity_query_found,
        mesh_handle_present,
        mesh_asset_loaded,
        position_attribute_present,
        normal_attribute_present,
        index_buffer_present,
        vertex_count: component_vertex_count,
        triangle_count: component_triangle_count,
        chunk_mesh_component_present,
        terrain_debug_present,
        visibility,
        inherited_visibility,
        view_visibility,
        visible_to_render: inherited_visibility
            .zip(view_visibility)
            .map(|(a, b)| a && b),
        mesh_mode_at_component,
        target_mode_at_mesh,
        current_lod: current_lod.map(lod_string),
        logical_lod_at_mesh,
        effective_lod_at_mesh,
        generated_frame,
        dirty,
        dirty_reasons: chunk
            .map(|chunk| dirty_reason_names(chunk.dirty_reason_flags()))
            .unwrap_or_default(),
        mesh_status,
    })
}

pub(super) fn terrain_mesh_debug_for_chunk(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    chunk_pos: IVec3,
) -> Option<TerrainMeshDebug> {
    let entity = world.get_chunk(chunk_pos)?.mesh_entity()?;
    let Ok((
        _entity,
        _mesh3d,
        _transform,
        _chunk_mesh,
        terrain_debug,
        _mc_triangle_sources,
        _water_mesh,
        _visibility,
        _inherited_visibility,
        _view_visibility,
        _needs_collider,
        _chunk_collider,
        _collider,
        _rigid_body,
    )) = terrain_entities.get(entity)
    else {
        return None;
    };
    terrain_debug.copied()
}

pub(super) fn mesh_status_for_chunk(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    _camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    _water_lod_guard_chunks: &HashSet<IVec3>,
    terrain_debug: Option<&TerrainMeshDebug>,
) -> LodMeshStatus {
    let chunk = world.get_chunk(chunk_pos);
    let current_lod = chunk.map(|chunk| chunk.lod_level());
    let remesh_pending = chunk.is_some_and(|chunk| chunk.is_dirty());
    let effective_mesh_lod_now =
        effective_terrain_mesh_lod_for_chunk(world, chunk_pos, mesh_settings, lod_settings);
    let mesh_lod_mismatch =
        mesh_lod_mismatch_from_debug(current_lod, effective_mesh_lod_now, terrain_debug);
    lod_mesh_status(mesh_lod_mismatch, remesh_pending)
}
