use super::*;

pub(super) struct McGapForensics {
    pub(super) first_mesher_iso_distance: Option<f32>,
    pub(super) first_mesher_iso_point: Option<Vec3>,
    pub(super) mc_cell: Option<McCellOracleProbe>,
    pub(super) raw_surface_mc_cell: Option<McCellOracleProbe>,
    pub(super) mesher_iso_mc_cell: Option<McCellOracleProbe>,
    pub(super) first_render_hit_source: Option<McTriangleSourceProbe>,
    pub(super) cell_agreement: Option<McCellAgreementProbe>,
    pub(super) seam_terrace: Option<SeamTerraceProbe>,
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn mc_forensics_for_gap(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    ray_origin: Vec3,
    ray_dir: Vec3,
    max_distance: f32,
    surface_point: Vec3,
    first_render_hit: Option<&CameraRayHit>,
) -> Option<McGapForensics> {
    let surface_voxel = IVec3::new(
        surface_point.x.floor() as i32,
        surface_point.y.floor() as i32,
        surface_point.z.floor() as i32,
    );
    let raw_chunk_pos = VoxelWorld::world_to_chunk(surface_voxel);
    let raw_surface_mc_cell = mc_cell_oracle_for_point(
        world,
        terrain_entities,
        meshes,
        ray_origin,
        ray_dir,
        raw_chunk_pos,
        surface_point,
    );
    let first_mesher_iso =
        first_mesher_iso_multi_chunk(world, terrain_entities, ray_origin, ray_dir, max_distance);
    let first_mesher_iso_distance = first_mesher_iso.as_ref().map(|hit| hit.distance);
    let first_mesher_iso_point = first_mesher_iso.as_ref().map(|hit| hit.point);
    let mesher_iso_mc_cell = first_mesher_iso.as_ref().and_then(|hit| {
        mc_cell_oracle_for_point(
            world,
            terrain_entities,
            meshes,
            ray_origin,
            ray_dir,
            hit.chunk_position,
            hit.point,
        )
    });
    let first_render_hit_source = first_render_hit.and_then(|hit| hit.source.clone());
    let mc_cell = mesher_iso_mc_cell
        .clone()
        .or_else(|| raw_surface_mc_cell.clone());
    let cell_agreement = Some(mc_cell_agreement(
        raw_surface_mc_cell.as_ref(),
        mesher_iso_mc_cell.as_ref(),
        first_render_hit_source.as_ref(),
    ));
    let seam_terrace_point = first_mesher_iso_point.unwrap_or(surface_point);
    let seam_terrace = seam_terrace_probe_for_point(world, terrain_entities, seam_terrace_point);

    Some(McGapForensics {
        first_mesher_iso_distance,
        first_mesher_iso_point,
        mc_cell,
        raw_surface_mc_cell,
        mesher_iso_mc_cell,
        first_render_hit_source,
        cell_agreement,
        seam_terrace,
    })
}

#[cfg(not(feature = "mc_transvoxel"))]
pub(super) fn mc_forensics_for_gap(
    _world: &VoxelWorld,
    _terrain_entities: &TerrainEntityQuery,
    _meshes: &Assets<Mesh>,
    _ray_origin: Vec3,
    _ray_dir: Vec3,
    _max_distance: f32,
    _surface_point: Vec3,
    _first_render_hit: Option<&CameraRayHit>,
) -> Option<McGapForensics> {
    None
}

#[cfg(feature = "mc_transvoxel")]
pub(super) struct McSdfGridProbe {
    pub(super) chunk_position: IVec3,
    pub(super) lod: LodLevel,
    pub(super) neighbor_lods: NeighborLods,
    pub(super) padded: usize,
    pub(super) values: Vec<f32>,
    pub(super) step: i32,
    pub(super) source_chunk_skipped_lod_delta_gt_one: Option<u32>,
}

#[cfg(feature = "mc_transvoxel")]
#[derive(Clone, Copy)]
pub(super) struct McSdfRaySample {
    pub(super) distance: f32,
    pub(super) value: f32,
    pub(super) chunk_position: IVec3,
}

#[cfg(feature = "mc_transvoxel")]
pub(super) struct MesherIsoHit {
    pub(super) distance: f32,
    pub(super) point: Vec3,
    pub(super) chunk_position: IVec3,
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn build_mc_sdf_grid_probe(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    chunk_pos: IVec3,
) -> Option<McSdfGridProbe> {
    use crate::voxel::meshing::mc_support::build_mc_sdf_values;

    let chunk = world.get_chunk(chunk_pos)?;
    let mesh_entity = chunk.mesh_entity()?;
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
    )) = terrain_entities.get(mesh_entity)
    else {
        return None;
    };
    let debug = terrain_debug?;
    if debug.target_mode_at_mesh != MeshMode::McTransvoxel {
        return None;
    }

    let lod = debug.effective_lod_at_mesh;
    let neighbor_lods = debug.neighbor_lods_at_mesh;
    let (padded, values, step) = build_mc_sdf_values(chunk, world, lod, &neighbor_lods);
    if padded < 2 || values.is_empty() || step <= 0 {
        return None;
    }

    Some(McSdfGridProbe {
        chunk_position: chunk_pos,
        lod,
        neighbor_lods,
        padded,
        values,
        step,
        source_chunk_skipped_lod_delta_gt_one: debug
            .mc_transvoxel_stats
            .map(|stats| stats.skipped_lod_delta_gt_one),
    })
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn mc_sdf_sample_multi_chunk(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    cache: &mut HashMap<IVec3, Option<McSdfGridProbe>>,
    point: Vec3,
    distance: f32,
) -> Option<McSdfRaySample> {
    let voxel = IVec3::new(
        point.x.floor() as i32,
        point.y.floor() as i32,
        point.z.floor() as i32,
    );
    let chunk_pos = VoxelWorld::world_to_chunk(voxel);
    if !cache.contains_key(&chunk_pos) {
        let grid = build_mc_sdf_grid_probe(world, terrain_entities, chunk_pos);
        cache.insert(chunk_pos, grid);
    }
    let grid = cache.get(&chunk_pos)?.as_ref()?;
    let chunk_origin = VoxelWorld::chunk_to_world(grid.chunk_position).as_vec3();
    let value = sample_mc_sdf_trilinear(point, chunk_origin, grid.padded, &grid.values, grid.step)?;
    Some(McSdfRaySample {
        distance,
        value,
        chunk_position: grid.chunk_position,
    })
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn first_mesher_iso_multi_chunk(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    origin: Vec3,
    dir: Vec3,
    max_distance: f32,
) -> Option<MesherIsoHit> {
    let mut cache: HashMap<IVec3, Option<McSdfGridProbe>> = HashMap::new();
    let mut previous: Option<McSdfRaySample> = None;
    let mut distance = 0.0_f32;
    while distance <= max_distance {
        let point = origin + dir * distance;
        if let Some(sample) =
            mc_sdf_sample_multi_chunk(world, terrain_entities, &mut cache, point, distance)
        {
            if sample.value.abs() <= f32::EPSILON {
                return Some(MesherIsoHit {
                    distance,
                    point,
                    chunk_position: sample.chunk_position,
                });
            }
            if let Some(previous_sample) = previous {
                if let Some((iso_distance, iso_point)) = mesher_iso_crossing_between_samples(
                    origin,
                    dir,
                    previous_sample.distance,
                    previous_sample.value,
                    sample.distance,
                    sample.value,
                ) {
                    let iso_voxel = IVec3::new(
                        iso_point.x.floor() as i32,
                        iso_point.y.floor() as i32,
                        iso_point.z.floor() as i32,
                    );
                    return Some(MesherIsoHit {
                        distance: iso_distance,
                        point: iso_point,
                        chunk_position: VoxelWorld::world_to_chunk(iso_voxel),
                    });
                }
            }
            previous = Some(sample);
        } else {
            previous = None;
        }
        distance += 0.25;
    }
    None
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn seam_terrace_probe_for_point(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    point: Vec3,
) -> Option<SeamTerraceProbe> {
    const TERRACE_THRESHOLD_VOXELS: f32 = 0.5;

    let source_voxel = IVec3::new(
        point.x.floor() as i32,
        point.y.floor() as i32,
        point.z.floor() as i32,
    );
    let source_chunk = VoxelWorld::world_to_chunk(source_voxel);
    let source_grid = build_mc_sdf_grid_probe(world, terrain_entities, source_chunk)?;
    let source_origin = VoxelWorld::chunk_to_world(source_chunk).as_vec3();
    let local = point - source_origin;
    let near_face_threshold = (source_grid.step as f32 * 1.5).max(2.0);
    let mut pairs = Vec::new();

    for face in ChunkFace::ALL {
        if distance_to_chunk_face(local, face) > near_face_threshold {
            continue;
        }
        let Some(neighbor_lod_at_source_mesh) =
            neighbor_lod_for_probe_face(&source_grid.neighbor_lods, face)
        else {
            continue;
        };
        if neighbor_lod_at_source_mesh == source_grid.lod {
            continue;
        }

        let neighbor_chunk = source_chunk + face.direction();
        let Some(neighbor_grid) = build_mc_sdf_grid_probe(world, terrain_entities, neighbor_chunk)
        else {
            continue;
        };
        if neighbor_grid.lod == source_grid.lod {
            continue;
        }

        let seam_sample_point = project_point_to_chunk_face(point, source_origin, face);
        let source_sample_point = seam_sample_point;
        let neighbor_sample_point = seam_sample_point;
        let source_height = highest_vertical_iso_height_in_grid(
            &source_grid,
            source_sample_point.x,
            source_sample_point.z,
        );
        let neighbor_height = highest_vertical_iso_height_in_grid(
            &neighbor_grid,
            neighbor_sample_point.x,
            neighbor_sample_point.z,
        );

        let source_is_coarser = source_grid.lod.is_lower_detail_than(neighbor_grid.lod);
        let (fine_chunk, fine_lod, fine_sample_point, fine_height) = if source_is_coarser {
            (
                neighbor_chunk,
                neighbor_grid.lod,
                neighbor_sample_point,
                neighbor_height,
            )
        } else {
            (
                source_chunk,
                source_grid.lod,
                source_sample_point,
                source_height,
            )
        };
        let (coarse_chunk, coarse_lod, coarse_sample_point, coarse_height) = if source_is_coarser {
            (
                source_chunk,
                source_grid.lod,
                source_sample_point,
                source_height,
            )
        } else {
            (
                neighbor_chunk,
                neighbor_grid.lod,
                neighbor_sample_point,
                neighbor_height,
            )
        };
        let signed_delta = fine_height
            .zip(coarse_height)
            .map(|(fine, coarse)| coarse - fine);

        pairs.push(SeamTerracePairProbe {
            face: chunk_face_name(face).to_string(),
            source_chunk: source_chunk.into(),
            neighbor_chunk: neighbor_chunk.into(),
            source_lod: lod_string(source_grid.lod),
            neighbor_lod: lod_string(neighbor_grid.lod),
            fine_chunk: fine_chunk.into(),
            coarse_chunk: coarse_chunk.into(),
            fine_lod: lod_string(fine_lod),
            coarse_lod: lod_string(coarse_lod),
            fine_sample_point: fine_sample_point.into(),
            coarse_sample_point: coarse_sample_point.into(),
            fine_iso_height: fine_height,
            coarse_iso_height: coarse_height,
            signed_height_delta_coarse_minus_fine: signed_delta,
            abs_height_delta: signed_delta.map(f32::abs),
            source_chunk_skipped_lod_delta_gt_one: source_grid
                .source_chunk_skipped_lod_delta_gt_one,
            neighbor_chunk_skipped_lod_delta_gt_one: neighbor_grid
                .source_chunk_skipped_lod_delta_gt_one,
        });
    }

    let worst_abs_height_delta = pairs
        .iter()
        .filter_map(|pair| pair.abs_height_delta)
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let classification = if pairs.is_empty() {
        SeamTerraceClassification::NotNearLodSeam
    } else if worst_abs_height_delta.is_none() {
        SeamTerraceClassification::InsufficientData
    } else if worst_abs_height_delta.is_some_and(|delta| delta > TERRACE_THRESHOLD_VOXELS) {
        SeamTerraceClassification::PossibleTerrace
    } else {
        SeamTerraceClassification::NoTerrace
    };
    let note = match classification {
        SeamTerraceClassification::NotNearLodSeam => {
            "sample was not close to an active LOD-mismatched chunk face".to_string()
        }
        SeamTerraceClassification::InsufficientData => {
            "nearby LOD seam exists, but one or both paired SDF grids had no vertical iso crossing"
                .to_string()
        }
        SeamTerraceClassification::NoTerrace => {
            "paired fine/coarse seam iso heights agree within tolerance".to_string()
        }
        SeamTerraceClassification::PossibleTerrace => {
            "paired fine/coarse seam iso heights differ beyond tolerance".to_string()
        }
    };

    Some(SeamTerraceProbe {
        sample_point: point.into(),
        threshold_voxels: TERRACE_THRESHOLD_VOXELS,
        threshold_world: TERRACE_THRESHOLD_VOXELS * VOXEL_SIZE,
        pairs,
        worst_abs_height_delta,
        classification,
        note,
    })
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn distance_to_chunk_face(local: Vec3, face: ChunkFace) -> f32 {
    let chunk_size = CHUNK_SIZE_I32 as f32;
    match face {
        ChunkFace::NegX => local.x,
        ChunkFace::PosX => chunk_size - local.x,
        ChunkFace::NegY => local.y,
        ChunkFace::PosY => chunk_size - local.y,
        ChunkFace::NegZ => local.z,
        ChunkFace::PosZ => chunk_size - local.z,
    }
    .abs()
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn project_point_to_chunk_face(
    point: Vec3,
    chunk_origin: Vec3,
    face: ChunkFace,
) -> Vec3 {
    let chunk_size = CHUNK_SIZE_I32 as f32;
    match face {
        ChunkFace::NegX => Vec3::new(chunk_origin.x, point.y, point.z),
        ChunkFace::PosX => Vec3::new(chunk_origin.x + chunk_size, point.y, point.z),
        ChunkFace::NegY => Vec3::new(point.x, chunk_origin.y, point.z),
        ChunkFace::PosY => Vec3::new(point.x, chunk_origin.y + chunk_size, point.z),
        ChunkFace::NegZ => Vec3::new(point.x, point.y, chunk_origin.z),
        ChunkFace::PosZ => Vec3::new(point.x, point.y, chunk_origin.z + chunk_size),
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn neighbor_lod_for_probe_face(
    neighbor_lods: &NeighborLods,
    face: ChunkFace,
) -> Option<LodLevel> {
    match face {
        ChunkFace::NegX => neighbor_lods.neg_x,
        ChunkFace::PosX => neighbor_lods.pos_x,
        ChunkFace::NegY => neighbor_lods.neg_y,
        ChunkFace::PosY => neighbor_lods.pos_y,
        ChunkFace::NegZ => neighbor_lods.neg_z,
        ChunkFace::PosZ => neighbor_lods.pos_z,
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn highest_vertical_iso_height_in_grid(
    grid: &McSdfGridProbe,
    world_x: f32,
    world_z: f32,
) -> Option<f32> {
    let chunk_origin = VoxelWorld::chunk_to_world(grid.chunk_position).as_vec3();
    let step = (grid.step as f32 * 0.25).clamp(0.25, 1.0);
    let mut y = chunk_origin.y + CHUNK_SIZE_I32 as f32 + grid.step as f32;
    let min_y = chunk_origin.y - grid.step as f32;
    let mut previous: Option<(f32, f32)> = None;

    while y >= min_y {
        let point = Vec3::new(world_x, y, world_z);
        if let Some(value) =
            sample_mc_sdf_trilinear(point, chunk_origin, grid.padded, &grid.values, grid.step)
        {
            if value.abs() <= f32::EPSILON {
                return Some(y);
            }
            if let Some((previous_y, previous_value)) = previous {
                if (previous_value < 0.0) != (value < 0.0) {
                    let t = previous_value / (previous_value - value);
                    return Some(previous_y + (y - previous_y) * t.clamp(0.0, 1.0));
                }
            }
            previous = Some((y, value));
        } else {
            previous = None;
        }
        y -= step;
    }

    None
}

#[cfg(feature = "mc_transvoxel")]
#[allow(clippy::too_many_arguments)]

pub(super) fn mc_cell_oracle_for_point(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    ray_origin: Vec3,
    ray_dir: Vec3,
    chunk_pos: IVec3,
    point: Vec3,
) -> Option<McCellOracleProbe> {
    use crate::voxel::mc_transvoxel::compute_transvoxel_face_mask;
    use crate::voxel::mc_transvoxel::tables::{
        REGULAR_CELL_CLASS, REGULAR_CELL_DATA, TRANSITION_CELL_CLASS, TRANSITION_CELL_DATA,
    };

    let grid = build_mc_sdf_grid_probe(world, terrain_entities, chunk_pos)?;
    let chunk = world.get_chunk(chunk_pos)?;
    let mesh_entity = chunk.mesh_entity()?;
    let Ok((
        _entity,
        mesh3d,
        transform,
        _chunk_mesh,
        _terrain_debug,
        mc_triangle_sources,
        _water_mesh,
        _visibility,
        _inherited_visibility,
        _view_visibility,
        _needs_collider,
        _chunk_collider,
        _collider,
        _rigid_body,
    )) = terrain_entities.get(mesh_entity)
    else {
        return None;
    };
    let mesh = mesh3d.and_then(|mesh3d| meshes.get(&mesh3d.0));
    let translation = transform
        .map(|transform| transform.translation)
        .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
    let chunk_origin = VoxelWorld::chunk_to_world(chunk_pos).as_vec3();
    let subdivisions = (CHUNK_SIZE_I32 / grid.step) as usize;
    let cell = mc_cell_for_point(point, chunk_origin, subdivisions, grid.step);
    let cell_uvec = UVec3::new(cell[0] as u32, cell[1] as u32, cell[2] as u32);
    let case_index = regular_case_index(&grid.values, grid.padded, cell);
    let class_index = REGULAR_CELL_CLASS[case_index as usize];
    let expected_regular_triangle_count = if case_index == 0 || case_index == 255 {
        0
    } else {
        REGULAR_CELL_DATA[class_index as usize].get_triangle_count()
    };
    let actual_regular_triangle_count = mc_triangle_sources.map(|sources| {
        sources
            .sources
            .iter()
            .filter(|source| source_matches_regular_cell(source, chunk_pos, cell_uvec))
            .count() as u32
    });
    let emitted_regular_triangles = collect_emitted_triangle_evidence(
        mesh,
        translation,
        mc_triangle_sources,
        ray_origin,
        ray_dir,
        |source| source_matches_regular_cell(source, chunk_pos, cell_uvec),
    );

    let (transition_mask, _) = compute_transvoxel_face_mask(grid.lod, &grid.neighbor_lods);
    let boundary_faces = boundary_faces_for_cell(cell, subdivisions);
    let transition_owner_faces: Vec<ChunkFace> = boundary_faces
        .iter()
        .copied()
        .filter(|face| transition_mask.get(*face))
        .collect();
    let transition_cells: Vec<McTransitionCellOracleProbe> = transition_owner_faces
        .iter()
        .map(|face| {
            let (cell_u, cell_v) = transition_cell_for_regular_cell(*face, cell, subdivisions);
            let transition_case = transition_case_index(
                &grid.values,
                grid.padded,
                subdivisions,
                *face,
                cell_u,
                cell_v,
            );
            let raw_class = TRANSITION_CELL_CLASS[transition_case as usize];
            let class = raw_class & 0x7F;
            let expected_triangle_count = if transition_case == 0 || transition_case == 0x1FF {
                0
            } else {
                TRANSITION_CELL_DATA[class as usize].get_triangle_count()
            };
            let actual_triangle_count = mc_triangle_sources.map(|sources| {
                sources
                    .sources
                    .iter()
                    .filter(|source| {
                        source_matches_transition_cell(
                            source,
                            chunk_pos,
                            *face,
                            cell_u as u16,
                            cell_v as u16,
                        )
                    })
                    .count() as u32
            });
            let emitted_triangles = collect_emitted_triangle_evidence(
                mesh,
                translation,
                mc_triangle_sources,
                ray_origin,
                ray_dir,
                |source| {
                    source_matches_transition_cell(
                        source,
                        chunk_pos,
                        *face,
                        cell_u as u16,
                        cell_v as u16,
                    )
                },
            );
            McTransitionCellOracleProbe {
                face: chunk_face_name(*face).to_string(),
                cell_u: cell_u as u16,
                cell_v: cell_v as u16,
                case_index: transition_case as u16,
                class_index: class,
                expected_triangle_count,
                actual_triangle_count,
                invert: (raw_class & 0x80) != 0,
                emitted_triangles_ray_hit_count: emitted_triangles
                    .iter()
                    .filter(|triangle| triangle.ray_hit_distance.is_some())
                    .count() as u32,
                nearest_emitted_triangle_ray_hit_distance: nearest_triangle_hit_distance(
                    &emitted_triangles,
                ),
                closest_emitted_triangle_ray_distance: closest_triangle_ray_distance(
                    &emitted_triangles,
                ),
                emitted_triangles,
            }
        })
        .collect();
    // MC+Transvoxel currently keeps regular boundary rows under transition
    // aprons. Transition faces are still reported as owners, but they no longer
    // destructively skip regular cells until the transition replacement path is
    // proven watertight in the live seam repros.
    let skipped_regular_faces: Vec<ChunkFace> = Vec::new();

    Some(McCellOracleProbe {
        chunk_position: chunk_pos.into(),
        effective_lod_at_mesh: lod_string(grid.lod),
        neighbor_lods_at_mesh: neighbor_lods_probe(grid.neighbor_lods),
        cell: cell_uvec.into(),
        case_index: case_index as u16,
        class_index,
        expected_regular_triangle_count,
        actual_regular_triangle_count,
        boundary_faces: boundary_faces
            .iter()
            .map(|face| chunk_face_name(*face).to_string())
            .collect(),
        skipped_regular_faces: skipped_regular_faces
            .iter()
            .map(|face| chunk_face_name(*face).to_string())
            .collect(),
        transition_owner_faces: transition_owner_faces
            .iter()
            .map(|face| chunk_face_name(*face).to_string())
            .collect(),
        transition_cells,
        emitted_regular_triangles_ray_hit_count: emitted_regular_triangles
            .iter()
            .filter(|triangle| triangle.ray_hit_distance.is_some())
            .count() as u32,
        nearest_emitted_regular_triangle_ray_hit_distance: nearest_triangle_hit_distance(
            &emitted_regular_triangles,
        ),
        closest_emitted_regular_triangle_ray_distance: closest_triangle_ray_distance(
            &emitted_regular_triangles,
        ),
        emitted_regular_triangles,
        source_chunk_skipped_lod_delta_gt_one: grid.source_chunk_skipped_lod_delta_gt_one,
    })
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn source_matches_regular_cell(
    source: &McTriangleSource,
    chunk_pos: IVec3,
    cell: UVec3,
) -> bool {
    matches!(
        source,
        McTriangleSource::Regular {
            chunk_pos: source_chunk,
            cell: source_cell,
            ..
        } if *source_chunk == chunk_pos && *source_cell == cell
    )
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn source_matches_transition_cell(
    source: &McTriangleSource,
    chunk_pos: IVec3,
    face: ChunkFace,
    cell_u: u16,
    cell_v: u16,
) -> bool {
    matches!(
        source,
        McTriangleSource::Transition {
            chunk_pos: source_chunk,
            face: source_face,
            cell_u: source_u,
            cell_v: source_v,
            ..
        } if *source_chunk == chunk_pos
            && *source_face == face
            && *source_u == cell_u
            && *source_v == cell_v
    )
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn collect_emitted_triangle_evidence(
    mesh: Option<&Mesh>,
    translation: Vec3,
    sources: Option<&McTriangleSources>,
    ray_origin: Vec3,
    ray_dir: Vec3,
    matches_source: impl Fn(&McTriangleSource) -> bool,
) -> Vec<McEmittedTriangleProbe> {
    let (Some(mesh), Some(sources)) = (mesh, sources) else {
        return Vec::new();
    };
    sources
        .sources
        .iter()
        .enumerate()
        .filter_map(|(triangle_index, source)| {
            if !matches_source(source) {
                return None;
            }
            let triangle_start = triangle_index * 3;
            let vertices = mesh_triangle_vertices(mesh, translation, triangle_start)?;
            Some(emitted_triangle_probe(
                triangle_start,
                ray_origin,
                ray_dir,
                vertices,
            ))
        })
        .collect()
}

#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
pub(super) fn mesh_triangle_vertices(
    mesh: &Mesh,
    translation: Vec3,
    triangle_start: usize,
) -> Option<[Vec3; 3]> {
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return None;
    };
    let indices = mesh_indices(mesh)?;
    Some([
        Vec3::from_array(*positions.get(indices.get(triangle_start))?) + translation,
        Vec3::from_array(*positions.get(indices.get(triangle_start + 1))?) + translation,
        Vec3::from_array(*positions.get(indices.get(triangle_start + 2))?) + translation,
    ])
}

#[cfg_attr(not(any(feature = "mc_transvoxel", test)), allow(dead_code))]
pub(super) fn emitted_triangle_probe(
    triangle_start: usize,
    ray_origin: Vec3,
    ray_dir: Vec3,
    vertices: [Vec3; 3],
) -> McEmittedTriangleProbe {
    let hit = ray_triangle_hit(ray_origin, ray_dir, vertices[0], vertices[1], vertices[2]);
    McEmittedTriangleProbe {
        triangle_start_index: triangle_start as u32,
        vertices: [vertices[0].into(), vertices[1].into(), vertices[2].into()],
        ray_hit_distance: hit.map(|(distance, _)| distance),
        front_face: hit.map(|(_, front_face)| front_face),
        closest_ray_distance: closest_sampled_triangle_ray_distance(ray_origin, ray_dir, vertices),
    }
}

#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
pub(super) fn nearest_triangle_hit_distance(triangles: &[McEmittedTriangleProbe]) -> Option<f32> {
    triangles
        .iter()
        .filter_map(|triangle| triangle.ray_hit_distance)
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
}

#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
pub(super) fn closest_triangle_ray_distance(triangles: &[McEmittedTriangleProbe]) -> Option<f32> {
    triangles
        .iter()
        .map(|triangle| triangle.closest_ray_distance)
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
}

#[cfg_attr(not(any(feature = "mc_transvoxel", test)), allow(dead_code))]
pub(super) fn closest_sampled_triangle_ray_distance(
    origin: Vec3,
    dir: Vec3,
    vertices: [Vec3; 3],
) -> f32 {
    let points = [
        vertices[0],
        vertices[1],
        vertices[2],
        (vertices[0] + vertices[1]) * 0.5,
        (vertices[1] + vertices[2]) * 0.5,
        (vertices[2] + vertices[0]) * 0.5,
        (vertices[0] + vertices[1] + vertices[2]) / 3.0,
    ];
    points
        .iter()
        .map(|point| point_to_ray_distance(*point, origin, dir))
        .fold(f32::INFINITY, f32::min)
}

#[cfg_attr(not(any(feature = "mc_transvoxel", test)), allow(dead_code))]
pub(super) fn point_to_ray_distance(point: Vec3, origin: Vec3, dir: Vec3) -> f32 {
    let dir = dir.normalize_or_zero();
    if dir == Vec3::ZERO {
        return f32::INFINITY;
    }
    let to_point = point - origin;
    let along = to_point.dot(dir).max(0.0);
    (to_point - dir * along).length()
}

#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
pub(super) fn mc_cell_agreement(
    raw_cell: Option<&McCellOracleProbe>,
    iso_cell: Option<&McCellOracleProbe>,
    render_source: Option<&McTriangleSourceProbe>,
) -> McCellAgreementProbe {
    let raw_matches_iso = raw_cell
        .zip(iso_cell)
        .map(|(raw, iso)| mc_cells_same(raw, iso));
    let iso_matches_render = iso_cell.map(|cell| {
        render_source
            .map(|source| mc_source_matches_cell_probe(source, cell))
            .unwrap_or(false)
    });
    let raw_matches_render = raw_cell.map(|cell| {
        render_source
            .map(|source| mc_source_matches_cell_probe(source, cell))
            .unwrap_or(false)
    });
    let note = if raw_matches_iso == Some(true) && iso_matches_render == Some(true) {
        "raw surface, mesher iso, and first render hit resolve to the same MC cell".to_string()
    } else {
        "cell ownership differs or one ownership source is unavailable".to_string()
    };
    McCellAgreementProbe {
        raw_surface_cell_matches_mesher_iso_cell: raw_matches_iso,
        mesher_iso_cell_matches_first_render_hit_source: iso_matches_render,
        raw_surface_cell_matches_first_render_hit_source: raw_matches_render,
        note,
    }
}

#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
pub(super) fn mc_cells_same(a: &McCellOracleProbe, b: &McCellOracleProbe) -> bool {
    a.chunk_position == b.chunk_position && a.cell == b.cell
}

#[cfg_attr(not(any(feature = "mc_transvoxel", test)), allow(dead_code))]
pub(super) fn mc_source_matches_cell_probe(
    source: &McTriangleSourceProbe,
    cell: &McCellOracleProbe,
) -> bool {
    match source {
        McTriangleSourceProbe::Regular {
            chunk_position,
            cell: source_cell,
            ..
        } => *chunk_position == cell.chunk_position && *source_cell == cell.cell,
        McTriangleSourceProbe::Transition {
            chunk_position,
            face,
            cell_u,
            cell_v,
            ..
        } => {
            *chunk_position == cell.chunk_position
                && cell.transition_cells.iter().any(|transition| {
                    transition.face == *face
                        && transition.cell_u == *cell_u
                        && transition.cell_v == *cell_v
                })
        }
    }
}

#[cfg(any(feature = "mc_transvoxel", test))]
pub(super) fn mesher_iso_crossing_between_samples(
    origin: Vec3,
    dir: Vec3,
    previous_distance: f32,
    previous_value: f32,
    distance: f32,
    value: f32,
) -> Option<(f32, Vec3)> {
    if previous_value.signum() != value.signum() {
        let t = previous_value / (previous_value - value);
        let iso_distance = previous_distance + (distance - previous_distance) * t.clamp(0.0, 1.0);
        Some((iso_distance, origin + dir * iso_distance))
    } else {
        None
    }
}

#[cfg(feature = "mc_transvoxel")]
#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn first_mesher_iso_in_sdf_grid(
    origin: Vec3,
    dir: Vec3,
    max_distance: f32,
    chunk_origin: Vec3,
    padded: usize,
    values: &[f32],
    step: i32,
) -> Option<(f32, Vec3)> {
    let mut previous: Option<(f32, f32)> = None;
    let mut distance = 0.0_f32;
    while distance <= max_distance {
        let point = origin + dir * distance;
        if let Some(value) = sample_mc_sdf_trilinear(point, chunk_origin, padded, values, step) {
            if value.abs() <= f32::EPSILON {
                return Some((distance, point));
            }
            if let Some((previous_distance, previous_value)) = previous {
                if let Some(crossing) = mesher_iso_crossing_between_samples(
                    origin,
                    dir,
                    previous_distance,
                    previous_value,
                    distance,
                    value,
                ) {
                    return Some(crossing);
                }
            }
            previous = Some((distance, value));
        } else {
            previous = None;
        }
        distance += 0.25;
    }
    None
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn sample_mc_sdf_trilinear(
    point: Vec3,
    chunk_origin: Vec3,
    padded: usize,
    values: &[f32],
    step: i32,
) -> Option<f32> {
    if padded < 2 || step <= 0 || values.len() < padded * padded * padded {
        return None;
    }
    let grid = (point - chunk_origin) / step as f32 + Vec3::ONE;
    if grid.x < 0.0
        || grid.y < 0.0
        || grid.z < 0.0
        || grid.x > (padded - 1) as f32
        || grid.y > (padded - 1) as f32
        || grid.z > (padded - 1) as f32
    {
        return None;
    }
    let x0 = grid.x.floor() as usize;
    let y0 = grid.y.floor() as usize;
    let z0 = grid.z.floor() as usize;
    let x1 = (x0 + 1).min(padded - 1);
    let y1 = (y0 + 1).min(padded - 1);
    let z1 = (z0 + 1).min(padded - 1);
    let tx = grid.x - x0 as f32;
    let ty = grid.y - y0 as f32;
    let tz = grid.z - z0 as f32;
    let sample = |x: usize, y: usize, z: usize| values[x + y * padded + z * padded * padded];
    let c000 = sample(x0, y0, z0);
    let c100 = sample(x1, y0, z0);
    let c010 = sample(x0, y1, z0);
    let c110 = sample(x1, y1, z0);
    let c001 = sample(x0, y0, z1);
    let c101 = sample(x1, y0, z1);
    let c011 = sample(x0, y1, z1);
    let c111 = sample(x1, y1, z1);
    let c00 = c000.lerp(c100, tx);
    let c10 = c010.lerp(c110, tx);
    let c01 = c001.lerp(c101, tx);
    let c11 = c011.lerp(c111, tx);
    let c0 = c00.lerp(c10, ty);
    let c1 = c01.lerp(c11, ty);
    Some(c0.lerp(c1, tz))
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn mc_cell_for_point(
    point: Vec3,
    chunk_origin: Vec3,
    subdivisions: usize,
    step: i32,
) -> [usize; 3] {
    let local = point - chunk_origin;
    let max_cell = subdivisions.saturating_sub(1) as i32;
    [
        ((local.x / step as f32).floor() as i32).clamp(0, max_cell) as usize,
        ((local.y / step as f32).floor() as i32).clamp(0, max_cell) as usize,
        ((local.z / step as f32).floor() as i32).clamp(0, max_cell) as usize,
    ]
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn regular_case_index(values: &[f32], padded: usize, cell: [usize; 3]) -> usize {
    use crate::voxel::mc_transvoxel::tables::CUBE_CORNERS;
    let grid_base = 1usize;
    let mut case = 0usize;
    for (index, corner) in CUBE_CORNERS.iter().enumerate() {
        let x = cell[0] + grid_base + corner[0] as usize;
        let y = cell[1] + grid_base + corner[1] as usize;
        let z = cell[2] + grid_base + corner[2] as usize;
        if values[x + y * padded + z * padded * padded] < 0.0 {
            case |= 1 << index;
        }
    }
    case
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn boundary_faces_for_cell(cell: [usize; 3], subdivisions: usize) -> Vec<ChunkFace> {
    let max_cell = subdivisions.saturating_sub(1);
    let mut faces = Vec::new();
    if cell[0] == 0 {
        faces.push(ChunkFace::NegX);
    }
    if cell[0] >= max_cell {
        faces.push(ChunkFace::PosX);
    }
    if cell[1] == 0 {
        faces.push(ChunkFace::NegY);
    }
    if cell[1] >= max_cell {
        faces.push(ChunkFace::PosY);
    }
    if cell[2] == 0 {
        faces.push(ChunkFace::NegZ);
    }
    if cell[2] >= max_cell {
        faces.push(ChunkFace::PosZ);
    }
    faces
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn transition_cell_for_regular_cell(
    face: ChunkFace,
    cell: [usize; 3],
    subdivisions: usize,
) -> (usize, usize) {
    let frame = ProbeFaceFrame::for_face(face);
    (
        ProbeFaceFrame::transition_cell_for_regular_axis(
            subdivisions,
            cell[frame.u_axis as usize],
            frame.u_sign,
        ),
        ProbeFaceFrame::transition_cell_for_regular_axis(
            subdivisions,
            cell[frame.v_axis as usize],
            frame.v_sign,
        ),
    )
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn transition_case_index(
    values: &[f32],
    padded: usize,
    subdivisions: usize,
    face: ChunkFace,
    cell_u: usize,
    cell_v: usize,
) -> usize {
    let frame = ProbeFaceFrame::for_face(face);
    let mut case = 0usize;
    for (index, delta) in PROBE_HIGH_RES_FACE_GRID.iter().enumerate() {
        let coords = frame.grid_coords(subdivisions, cell_u, cell_v, *delta);
        if values[coords[0] + coords[1] * padded + coords[2] * padded * padded] < 0.0 {
            case |= PROBE_HIGH_RES_CASE_BITS[index];
        }
    }
    case
}

#[cfg(feature = "mc_transvoxel")]
#[derive(Clone, Copy)]
pub(super) struct ProbeHighResDelta {
    pub(super) u: isize,
    pub(super) v: isize,
}

#[cfg(feature = "mc_transvoxel")]
pub(super) const PROBE_HIGH_RES_FACE_GRID: [ProbeHighResDelta; 9] = [
    ProbeHighResDelta { u: 0, v: 0 },
    ProbeHighResDelta { u: 1, v: 0 },
    ProbeHighResDelta { u: 2, v: 0 },
    ProbeHighResDelta { u: 0, v: 1 },
    ProbeHighResDelta { u: 1, v: 1 },
    ProbeHighResDelta { u: 2, v: 1 },
    ProbeHighResDelta { u: 0, v: 2 },
    ProbeHighResDelta { u: 1, v: 2 },
    ProbeHighResDelta { u: 2, v: 2 },
];

#[cfg(feature = "mc_transvoxel")]
pub(super) const PROBE_HIGH_RES_CASE_BITS: [usize; 9] =
    [0x01, 0x02, 0x04, 0x80, 0x100, 0x08, 0x40, 0x20, 0x10];

#[cfg(feature = "mc_transvoxel")]
pub(super) struct ProbeFaceFrame {
    pub(super) w_axis: u8,
    pub(super) w_sign: i32,
    pub(super) u_axis: u8,
    pub(super) u_sign: i32,
    pub(super) v_axis: u8,
    pub(super) v_sign: i32,
}

#[cfg(feature = "mc_transvoxel")]
impl ProbeFaceFrame {
    fn for_face(face: ChunkFace) -> Self {
        match face {
            ChunkFace::NegX => Self {
                w_axis: 0,
                w_sign: 1,
                u_axis: 2,
                u_sign: -1,
                v_axis: 1,
                v_sign: 1,
            },
            ChunkFace::PosX => Self {
                w_axis: 0,
                w_sign: -1,
                u_axis: 2,
                u_sign: 1,
                v_axis: 1,
                v_sign: 1,
            },
            ChunkFace::NegY => Self {
                w_axis: 1,
                w_sign: 1,
                u_axis: 0,
                u_sign: 1,
                v_axis: 2,
                v_sign: -1,
            },
            ChunkFace::PosY => Self {
                w_axis: 1,
                w_sign: -1,
                u_axis: 0,
                u_sign: 1,
                v_axis: 2,
                v_sign: 1,
            },
            ChunkFace::NegZ => Self {
                w_axis: 2,
                w_sign: 1,
                u_axis: 0,
                u_sign: 1,
                v_axis: 1,
                v_sign: 1,
            },
            ChunkFace::PosZ => Self {
                w_axis: 2,
                w_sign: -1,
                u_axis: 0,
                u_sign: -1,
                v_axis: 1,
                v_sign: 1,
            },
        }
    }

    fn tangent_grid_coord(subdivisions: usize, cell: usize, delta: usize, sign: i32) -> usize {
        if sign >= 0 {
            1 + cell * 2 + delta
        } else {
            subdivisions + 1 - (cell * 2 + delta)
        }
    }

    fn transition_cell_for_regular_axis(
        subdivisions: usize,
        regular_axis_cell: usize,
        sign: i32,
    ) -> usize {
        let transition_cells = subdivisions / 2;
        if transition_cells == 0 {
            return 0;
        }
        if sign >= 0 {
            (regular_axis_cell / 2).min(transition_cells - 1)
        } else {
            (subdivisions
                .saturating_sub(1)
                .saturating_sub(regular_axis_cell)
                / 2)
            .min(transition_cells - 1)
        }
    }

    fn grid_coords(
        &self,
        subdivisions: usize,
        cell_u: usize,
        cell_v: usize,
        delta: ProbeHighResDelta,
    ) -> [usize; 3] {
        let high_w = if self.w_sign > 0 {
            2usize
        } else {
            subdivisions
        };
        let mut coords = [0usize; 3];
        coords[self.w_axis as usize] = high_w;
        coords[self.u_axis as usize] =
            Self::tangent_grid_coord(subdivisions, cell_u, delta.u as usize, self.u_sign);
        coords[self.v_axis as usize] =
            Self::tangent_grid_coord(subdivisions, cell_v, delta.v as usize, self.v_sign);
        coords
    }
}
