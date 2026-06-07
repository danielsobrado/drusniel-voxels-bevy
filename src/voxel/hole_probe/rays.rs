use super::*;

pub(super) fn camera_basis_from_forward(forward: Vec3) -> (Vec3, Vec3) {
    let forward = forward.normalize_or_zero();
    if forward == Vec3::ZERO {
        return (Vec3::X, Vec3::Y);
    }
    let reference_up = if forward.y.abs() > 0.98 {
        Vec3::Z
    } else {
        Vec3::Y
    };
    let right = forward.cross(reference_up).normalize_or_zero();
    let up = right.cross(forward).normalize_or_zero();
    (right, up)
}

pub(super) fn sample_columns(
    world: &VoxelWorld,
    target_pos: IVec3,
    radius: i32,
) -> Vec<ColumnProbe> {
    let mut columns = Vec::new();
    let y_top = target_pos.y + 16;
    let y_bottom = target_pos.y - 64;

    for dz in -radius..=radius {
        for dx in -radius..=radius {
            let x = target_pos.x + dx;
            let z = target_pos.z + dz;
            let mut samples = Vec::new();
            let mut first_solid = None;
            let mut first_air_gap = None;
            let mut first_water = None;

            for y in (y_bottom..=y_top).rev() {
                let pos = IVec3::new(x, y, z);
                let sample = sample_voxel(world, pos);

                if first_solid.is_none() && sample.solid {
                    first_solid = Some(sample.clone());
                } else if first_solid.is_some() && first_air_gap.is_none() && !sample.solid {
                    first_air_gap = Some(sample.clone());
                }

                if first_solid.is_some() && first_water.is_none() && sample.liquid {
                    first_water = Some(sample.clone());
                }

                samples.push(sample);
            }

            columns.push(ColumnProbe {
                offset_x: dx,
                offset_z: dz,
                world_x: x,
                world_z: z,
                y_top,
                y_bottom,
                first_solid_from_above: first_solid,
                first_air_gap_below_top_solid: first_air_gap,
                first_water_below_top_solid: first_water,
                samples,
            });
        }
    }

    columns
}

pub(super) fn sample_voxel(world: &VoxelWorld, pos: IVec3) -> VoxelSample {
    let chunk_pos = VoxelWorld::world_to_chunk(pos);
    let local_pos = VoxelWorld::world_to_local(pos);
    let sample = world.sample_voxel_for_collision(pos);
    let voxel = sample.voxel();
    let is_air_or_liquid =
        matches!(sample, BoundaryVoxelSample::InBounds(voxel) if !voxel.is_solid());

    VoxelSample {
        world_position: pos.into(),
        chunk_position: chunk_pos.into(),
        local_position: local_pos.into(),
        chunk_exists: world.chunk_exists(chunk_pos),
        boundary: boundary_sample_name(sample).map(str::to_string),
        voxel_type: voxel.map(voxel_name),
        solid: match sample {
            BoundaryVoxelSample::InBounds(voxel) => voxel.is_solid(),
            BoundaryVoxelSample::OutsideAboveWorld => false,
            BoundaryVoxelSample::OutsideBelowWorld
            | BoundaryVoxelSample::OutsideHorizontalWorld
            | BoundaryVoxelSample::MissingChunkInsideBounds => true,
        },
        liquid: matches!(sample, BoundaryVoxelSample::InBounds(voxel) if voxel.is_liquid()),
        open_vertical_path_to_sky: is_air_or_liquid.then(|| open_vertical_path_to_sky(world, pos)),
    }
}

pub(super) fn world_bounds_probe(bounds: WorldBounds) -> WorldBoundsProbe {
    WorldBoundsProbe {
        min_chunk: bounds.min_chunk.into(),
        max_chunk: bounds.max_chunk.into(),
        min_world_y: bounds.min_world_y,
        max_world_y: bounds.max_world_y,
        min_breakable_y: bounds.min_breakable_y,
        kill_y: bounds.kill_y,
        bedrock_floor_y: bounds.bedrock_floor_y,
        horizontal_min: bounds.horizontal_min.into(),
        horizontal_max: bounds.horizontal_max.into(),
    }
}

pub(super) fn playable_validity_probe(world: &VoxelWorld, position: Vec3) -> PlayableValidityProbe {
    let validity = classify_player_world_validity(world, position);
    PlayableValidityProbe {
        valid: validity.is_valid(),
        classification: validity.label().to_string(),
        invalid_reason: validity.invalid_reason().map(str::to_string),
    }
}

pub(super) fn boundary_sample_probe(world: &VoxelWorld, pos: IVec3) -> BoundarySampleProbe {
    let sample = world.sample_voxel_for_collision(pos);
    BoundarySampleProbe {
        world_position: pos.into(),
        chunk_position: VoxelWorld::world_to_chunk(pos).into(),
        local_position: VoxelWorld::world_to_local(pos).into(),
        classification: boundary_sample_name(sample)
            .unwrap_or("InBounds")
            .to_string(),
        voxel_type: sample.voxel().map(voxel_name),
    }
}

pub(super) fn open_vertical_path_to_sky(world: &VoxelWorld, pos: IVec3) -> bool {
    let top_y = world.world_size_chunks().y * CHUNK_SIZE_I32 - 1;
    for y in (pos.y + 1)..=top_y {
        match world.sample_voxel_for_collision(IVec3::new(pos.x, y, pos.z)) {
            BoundaryVoxelSample::InBounds(voxel) if voxel.is_solid() => return false,
            BoundaryVoxelSample::InBounds(_) | BoundaryVoxelSample::OutsideAboveWorld => {}
            BoundaryVoxelSample::OutsideBelowWorld
            | BoundaryVoxelSample::OutsideHorizontalWorld
            | BoundaryVoxelSample::MissingChunkInsideBounds => return false,
        }
    }
    true
}

pub(super) fn cast_down_ray(
    spatial_query: &SpatialQuery,
    terrain_entities: &TerrainEntityQuery,
    origin: Vec3,
    max_distance: f32,
) -> RayProbe {
    let filter =
        SpatialQueryFilter::from_mask(avian3d::prelude::LayerMask::from([PhysicsLayer::Terrain]));
    let hit = spatial_query
        .cast_ray(origin, Dir3::NEG_Y, max_distance, true, &filter)
        .map(|hit| {
            let hit_y = origin.y - hit.distance;
            let entity_probe = terrain_entities.get(hit.entity).ok();
            let chunk_position = entity_probe
                .and_then(|(_, _, _, chunk_mesh, _, _, _, _, _, _, _, _, _, _)| chunk_mesh)
                .map(|chunk_mesh| chunk_mesh.chunk_position.into());
            let has_chunk_mesh =
                entity_probe.is_some_and(|(_, _, _, chunk_mesh, _, _, _, _, _, _, _, _, _, _)| {
                    chunk_mesh.is_some()
                });
            let has_chunk_collider = entity_probe.is_some_and(
                |(_, _, _, _, _, _, _, _, _, _, _, chunk_collider, _, _)| chunk_collider.is_some(),
            );
            let has_collider =
                entity_probe.is_some_and(|(_, _, _, _, _, _, _, _, _, _, _, _, collider, _)| {
                    collider.is_some()
                });
            let has_static_rigid_body =
                entity_probe.is_some_and(|(_, _, _, _, _, _, _, _, _, _, _, _, _, body)| {
                    matches!(body, Some(RigidBody::Static))
                });

            RayHitProbe {
                entity: format!("{:?}", hit.entity),
                distance: hit.distance,
                hit_y,
                normal: hit.normal.into(),
                chunk_position,
                has_chunk_mesh,
                has_chunk_collider,
                has_collider,
                has_static_rigid_body,
            }
        });

    RayProbe {
        origin: origin.into(),
        direction: Vec3::NEG_Y.into(),
        max_distance,
        hit,
    }
}

pub(super) fn missing_down_ray_probe(origin: Vec3, max_distance: f32) -> RayProbe {
    RayProbe {
        origin: origin.into(),
        direction: Vec3::NEG_Y.into(),
        max_distance,
        hit: None,
    }
}

pub(super) fn expected_surface_y(columns: &[ColumnProbe]) -> Option<f32> {
    columns
        .iter()
        .find(|column| column.offset_x == 0 && column.offset_z == 0)
        .and_then(|column| column.first_solid_from_above.as_ref())
        .map(|sample| sample.world_position.y as f32 + 1.0)
}

pub(super) fn sample_render_mesh_rays(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    center_chunk: IVec3,
    target_pos: IVec3,
    expected_surface_y: Option<f32>,
) -> Vec<RenderMeshRayProbe> {
    let ray_x = target_pos.x as f32 + 0.5;
    let ray_z = target_pos.z as f32 + 0.5;
    let origin_y = target_pos.y as f32 + 32.0;
    let mut hits = Vec::new();

    for dz in -1..=1 {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let chunk_pos = center_chunk + IVec3::new(dx, dy, dz);
                let Some(entity) = world
                    .get_chunk(chunk_pos)
                    .and_then(|chunk| chunk.mesh_entity())
                else {
                    continue;
                };
                let Ok((entity, mesh3d, transform, chunk_mesh, _, _, _, _, _, _, _, _, _, _)) =
                    terrain_entities.get(entity)
                else {
                    continue;
                };
                let Some(mesh3d) = mesh3d else {
                    hits.push(RenderMeshRayProbe {
                        entity: format!("{entity:?}"),
                        chunk_position: chunk_mesh.map(|chunk| chunk.chunk_position.into()),
                        hit_y: None,
                        surface_error: None,
                        vertex_count: None,
                        triangle_count: None,
                        mesh_available: false,
                    });
                    continue;
                };
                let Some(mesh) = meshes.get(&mesh3d.0) else {
                    hits.push(RenderMeshRayProbe {
                        entity: format!("{entity:?}"),
                        chunk_position: chunk_mesh.map(|chunk| chunk.chunk_position.into()),
                        hit_y: None,
                        surface_error: None,
                        vertex_count: None,
                        triangle_count: None,
                        mesh_available: false,
                    });
                    continue;
                };
                let transform = transform
                    .map(|transform| transform.translation)
                    .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
                let hit_y = cpu_mesh_vertical_ray_hit(mesh, transform, ray_x, ray_z, origin_y);
                let surface_error = hit_y
                    .zip(expected_surface_y)
                    .map(|(hit_y, expected)| (hit_y - expected).abs());
                let vertex_count = mesh.count_vertices();
                let triangle_count = mesh_indices(mesh).map(|indices| indices.len() / 3);
                hits.push(RenderMeshRayProbe {
                    entity: format!("{entity:?}"),
                    chunk_position: chunk_mesh.map(|chunk| chunk.chunk_position.into()),
                    hit_y,
                    surface_error,
                    vertex_count: Some(vertex_count),
                    triangle_count,
                    mesh_available: true,
                });
            }
        }
    }

    hits
}

#[allow(clippy::too_many_arguments)]
pub(super) fn sample_render_mesh_ray_grid(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    center_chunk: IVec3,
    target_pos: IVec3,
    camera_pos: Option<Vec3>,
    camera_forward: Option<Vec3>,
    camera_right: Option<Vec3>,
    camera_up: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) -> Vec<RenderMeshRayGridProbe> {
    let mut probes = Vec::new();
    let bounds = world.bounds();
    let origin_y = bounds.max_world_y as f32 + 2.0;

    for offset_z in -2..=2 {
        for offset_x in -2..=2 {
            let world_x = target_pos.x as f32 + 0.5 + offset_x as f32 * 0.5;
            let world_z = target_pos.z as f32 + 0.5 + offset_z as f32 * 0.5;
            let expected_surface_y = expected_surface_y_at(
                world,
                world_x.floor() as i32,
                world_z.floor() as i32,
                bounds,
            );
            let (highest_render_hit_y, hit_chunk, hit_entity, render_hit_mesh_section) =
                highest_render_mesh_hit_at(
                    world,
                    terrain_entities,
                    meshes,
                    center_chunk,
                    world_x,
                    world_z,
                    origin_y,
                );
            let surface_error = highest_render_hit_y
                .zip(expected_surface_y)
                .map(|(hit_y, expected)| (hit_y - expected).abs());
            let signed_surface_error = highest_render_hit_y
                .zip(expected_surface_y)
                .map(|(hit_y, expected)| hit_y - expected);
            let render_hit_point =
                highest_render_hit_y.map(|hit_y| Vec3::new(world_x, hit_y, world_z));
            let (render_hit_local_point, nearest_chunk_faces, chunk_state) =
                render_mesh_ray_grid_hit_metadata(
                    world,
                    terrain_entities,
                    hit_chunk,
                    render_hit_point,
                    camera_pos,
                    mesh_settings,
                    lod_settings,
                    water_lod_guard_chunks,
                );

            probes.push(RenderMeshRayGridProbe {
                sample_kind: RenderMeshRayGridSampleKind::TargetVertical,
                offset_x,
                offset_z,
                world_x,
                world_z,
                ray_origin: Vec3::new(world_x, origin_y, world_z).into(),
                ray_origin_y: origin_y,
                ray_direction: Vec3::NEG_Y.into(),
                expected_surface_y,
                highest_render_hit_y,
                render_hit_point: render_hit_point.map(Into::into),
                render_hit_chunk: hit_chunk,
                render_hit_local_point,
                signed_surface_error,
                abs_surface_error: surface_error,
                surface_error,
                render_hit_mesh_section,
                nearest_chunk_faces,
                hit_chunk,
                hit_entity,
                chunk_state,
            });
        }
    }

    append_camera_height_fan_samples(
        &mut probes,
        world,
        terrain_entities,
        meshes,
        camera_pos,
        camera_forward,
        camera_right,
        camera_up,
        bounds,
        mesh_settings,
        lod_settings,
        water_lod_guard_chunks,
    );

    probes
}

#[allow(clippy::too_many_arguments)]
pub(super) fn append_camera_height_fan_samples(
    probes: &mut Vec<RenderMeshRayGridProbe>,
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    camera_pos: Option<Vec3>,
    camera_forward: Option<Vec3>,
    camera_right: Option<Vec3>,
    camera_up: Option<Vec3>,
    bounds: WorldBounds,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) {
    const HALF_ANGLE_DEGREES: f32 = 6.0;
    const GRID_SIZE: i32 = 7;
    const MAX_DISTANCE: f32 = 512.0;

    let (Some(camera_pos), Some(camera_forward), Some(camera_right), Some(camera_up)) =
        (camera_pos, camera_forward, camera_right, camera_up)
    else {
        return;
    };

    let half_angle = HALF_ANGLE_DEGREES.to_radians();
    let half_grid = GRID_SIZE / 2;
    for grid_y in 0..GRID_SIZE {
        for grid_x in 0..GRID_SIZE {
            let fx = (grid_x as f32 / (GRID_SIZE - 1) as f32) * 2.0 - 1.0;
            let fy = (grid_y as f32 / (GRID_SIZE - 1) as f32) * 2.0 - 1.0;
            let ray_direction = (camera_forward + camera_right * (fx * half_angle).tan()
                - camera_up * (fy * half_angle).tan())
            .normalize_or_zero();
            if ray_direction == Vec3::ZERO {
                continue;
            }

            let ray_probe = sample_camera_ray(
                world,
                terrain_entities,
                meshes,
                camera_pos,
                ray_direction,
                MAX_DISTANCE,
                None,
            );
            let render_hit = ray_probe.first_front_render_hit.as_ref();
            let render_hit_point = render_hit.map(|hit| vec3_from_dump(hit.point));
            let reference_point = render_hit_point.or_else(|| {
                ray_probe
                    .first_voxel_solid_distance
                    .map(|distance| camera_pos + ray_direction * distance)
            });
            let world_x = reference_point.map_or(camera_pos.x, |point| point.x);
            let world_z = reference_point.map_or(camera_pos.z, |point| point.z);
            let expected_surface_y = reference_point.and_then(|point| {
                expected_surface_y_at(
                    world,
                    point.x.floor() as i32,
                    point.z.floor() as i32,
                    bounds,
                )
            });
            let highest_render_hit_y = render_hit_point.map(|point| point.y);
            let render_hit_mesh_section = render_hit.map(|hit| hit.mesh_section);
            let signed_surface_error = highest_render_hit_y
                .zip(expected_surface_y)
                .map(|(hit_y, expected)| hit_y - expected);
            let abs_surface_error = signed_surface_error.map(f32::abs);
            let render_hit_chunk = render_hit.and_then(|hit| hit.chunk_position);
            let hit_entity = render_hit.map(|hit| hit.entity.clone());
            let (render_hit_local_point, nearest_chunk_faces, chunk_state) =
                render_mesh_ray_grid_hit_metadata(
                    world,
                    terrain_entities,
                    render_hit_chunk,
                    render_hit_point,
                    Some(camera_pos),
                    mesh_settings,
                    lod_settings,
                    water_lod_guard_chunks,
                );

            probes.push(RenderMeshRayGridProbe {
                sample_kind: RenderMeshRayGridSampleKind::CameraHeightFan,
                offset_x: grid_x - half_grid,
                offset_z: grid_y - half_grid,
                world_x,
                world_z,
                ray_origin: camera_pos.into(),
                ray_origin_y: camera_pos.y,
                ray_direction: ray_direction.into(),
                expected_surface_y,
                highest_render_hit_y,
                render_hit_point: render_hit_point.map(Into::into),
                render_hit_chunk,
                render_hit_local_point,
                signed_surface_error,
                abs_surface_error,
                surface_error: abs_surface_error,
                render_hit_mesh_section,
                nearest_chunk_faces,
                hit_chunk: render_hit_chunk,
                hit_entity,
                chunk_state,
            });
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn render_mesh_ray_grid_hit_metadata(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    hit_chunk: Option<IVec3Dump>,
    hit_point: Option<Vec3>,
    camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) -> (
    Option<Vec3Dump>,
    Vec<BoundaryDistanceProbe>,
    Option<FanGapChunkState>,
) {
    let Some(hit_chunk) = hit_chunk else {
        return (None, Vec::new(), None);
    };
    let chunk_pos = ivec3_from_dump(hit_chunk);
    let render_hit_local_point =
        hit_point.map(|point| point - VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
    let nearest_faces = render_hit_local_point
        .map(nearest_chunk_faces)
        .unwrap_or_default();
    let chunk_state = camera_pos.map(|camera_pos| {
        fan_gap_chunk_state(
            world,
            chunk_pos,
            terrain_entities,
            camera_pos,
            mesh_settings,
            lod_settings,
            water_lod_guard_chunks,
        )
    });

    (
        render_hit_local_point.map(Into::into),
        nearest_faces,
        chunk_state,
    )
}

pub(super) fn log_camera_height_grid_summary(samples: &[RenderMeshRayGridProbe]) {
    const NEAR_FACE_THRESHOLD_VOXELS: f32 = 2.0;

    let camera_samples = samples
        .iter()
        .filter(|sample| sample.sample_kind == RenderMeshRayGridSampleKind::CameraHeightFan);
    let mut camera_sample_count = 0;
    let mut signed_sample_count = 0;
    let mut groups: BTreeMap<(String, String, String), Vec<f32>> = BTreeMap::new();
    let mut section_groups: BTreeMap<String, Vec<f32>> = BTreeMap::new();
    let mut mesh_status_counts: BTreeMap<String, u32> = BTreeMap::new();
    let mut pending_or_stale_count = 0u32;
    let mut worst_negative_sample: Option<&RenderMeshRayGridProbe> = None;

    for sample in camera_samples {
        camera_sample_count += 1;
        let mesh_status = mesh_status_label_for_height_sample(sample);
        *mesh_status_counts.entry(mesh_status.clone()).or_default() += 1;
        if height_sample_mesh_pending_or_stale(sample) {
            pending_or_stale_count += 1;
        }
        let Some(signed_error) = sample.signed_surface_error else {
            continue;
        };
        signed_sample_count += 1;

        let lod = rendered_lod_label_for_height_sample(sample);
        let region = if sample
            .nearest_chunk_faces
            .iter()
            .any(|face| face.distance_voxels <= NEAR_FACE_THRESHOLD_VOXELS)
        {
            "near_face"
        } else {
            "interior"
        }
        .to_string();

        groups
            .entry((lod, mesh_status.clone(), region))
            .or_default()
            .push(signed_error);
        section_groups
            .entry(mesh_section_label(sample.render_hit_mesh_section).to_string())
            .or_default()
            .push(signed_error);

        if signed_error < 0.0
            && worst_negative_sample.map_or(true, |worst| {
                signed_error < worst.signed_surface_error.unwrap_or(f32::INFINITY)
            })
        {
            worst_negative_sample = Some(sample);
        }
    }

    if camera_sample_count == 0 {
        info!("Camera height fan: skipped because no camera transform was available");
        return;
    }
    if signed_sample_count == 0 {
        info!(
            "Camera height fan: 0 of {} samples had both a front render hit and voxel surface",
            camera_sample_count,
        );
        return;
    }

    info!(
        "Camera height fan: {} of {} samples have signed render-vs-voxel height errors",
        signed_sample_count, camera_sample_count,
    );
    if pending_or_stale_count > 0 {
        warn!(
            "Camera height fan: {} of {} samples are pending/stale; rendered mesh LOD may not match the overlay/current chunk LOD yet",
            pending_or_stale_count, camera_sample_count,
        );
    }
    if !mesh_status_counts.is_empty() {
        info!(
            "Camera height fan: mesh_status counts {}",
            format_mesh_status_counts(&mesh_status_counts),
        );
    }
    for ((lod, mesh_status, region), values) in &groups {
        if let Some((min, median, max)) = signed_error_min_median_max(values) {
            info!(
                "Camera height fan: rendered_lod={} mesh_status={} region={} count={} signed_error min/median/max={:.2}/{:.2}/{:.2}",
                lod,
                mesh_status,
                region,
                values.len(),
                min,
                median,
                max,
            );
        }
    }
    for (section, values) in &section_groups {
        if let Some((min, median, max)) = signed_error_min_median_max(values) {
            info!(
                "Camera height fan: mesh_section={} count={} signed_error min/median/max={:.2}/{:.2}/{:.2}",
                section,
                values.len(),
                min,
                median,
                max,
            );
        }
    }

    let lod0_interior_median =
        median_for_camera_height_group(&groups, "Lod0", "Current", "interior");
    let lod1_interior_median =
        median_for_camera_height_group(&groups, "Lod1", "Current", "interior");
    if let (Some(lod0), Some(lod1)) = (lod0_interior_median, lod1_interior_median) {
        info!(
            "Camera height fan: Current rendered Lod1 interior median minus Current rendered Lod0 interior median = {:.2}",
            lod1 - lod0,
        );
    } else if pending_or_stale_count > 0 {
        info!(
            "Camera height fan: skipped Lod1-minus-Lod0 interior delta because one or both Current rendered-LOD groups were absent"
        );
    }

    if let Some(sample) = worst_negative_sample {
        let chunk = sample
            .render_hit_chunk
            .map(format_ivec3_dump)
            .unwrap_or_else(|| "none".to_string());
        let local = sample
            .render_hit_local_point
            .map(format_vec3_dump)
            .unwrap_or_else(|| "none".to_string());
        let nearest_faces = format_nearest_faces(&sample.nearest_chunk_faces);
        info!(
            "Camera height fan: worst negative sample error={:.2} chunk={} local={} mesh_section={} current_lod={} rendered_lod={} mesh_status={} nearest_faces={}",
            sample.signed_surface_error.unwrap_or_default(),
            chunk,
            local,
            mesh_section_label(sample.render_hit_mesh_section),
            current_lod_label_for_height_sample(sample),
            rendered_lod_label_for_height_sample(sample),
            mesh_status_label_for_height_sample(sample),
            nearest_faces,
        );
    }
}

pub(super) fn mesh_section_label(section: Option<MeshTriangleSectionProbe>) -> &'static str {
    match section {
        Some(MeshTriangleSectionProbe::MainSurface) => "main_surface",
        Some(MeshTriangleSectionProbe::TransitionApron) => "transition_apron",
        Some(MeshTriangleSectionProbe::VerticalSkirt) => "vertical_skirt",
        Some(MeshTriangleSectionProbe::TransitionGeometry) => "transition_geometry",
        Some(MeshTriangleSectionProbe::Unknown) | None => "unknown",
    }
}

pub(super) fn current_lod_label_for_height_sample(sample: &RenderMeshRayGridProbe) -> String {
    sample
        .chunk_state
        .as_ref()
        .and_then(|state| state.lod_level.as_deref())
        .unwrap_or("unknown")
        .to_string()
}

pub(super) fn rendered_lod_label_for_height_sample(sample: &RenderMeshRayGridProbe) -> String {
    sample
        .chunk_state
        .as_ref()
        .and_then(|state| state.lod_eval.as_ref())
        .and_then(|eval| {
            eval.last_meshed_lod
                .as_deref()
                .or(eval.last_logical_lod_at_mesh.as_deref())
                .or(eval.effective_mesh_lod_now.as_deref())
        })
        .map(str::to_string)
        .unwrap_or_else(|| current_lod_label_for_height_sample(sample))
}

pub(super) fn mesh_status_label_for_height_sample(sample: &RenderMeshRayGridProbe) -> String {
    sample
        .chunk_state
        .as_ref()
        .and_then(|state| state.lod_eval.as_ref())
        .map(|eval| format!("{:?}", eval.mesh_status))
        .unwrap_or_else(|| "unknown".to_string())
}

pub(super) fn height_sample_mesh_pending_or_stale(sample: &RenderMeshRayGridProbe) -> bool {
    // Use the authoritative `mesh_status`, which already folds in `remesh_pending`
    // and an **effective-vs-effective** LOD comparison (`effective_mesh_lod_now`
    // vs `effective_lod_at_mesh`; see `lod_eval_probe`). The previous extra check
    // compared the last *effective* meshed LOD against the chunk's *logical*
    // `lod_level`, which is always different for a promoted chunk (logical Lod1
    // meshed as Lod0) and falsely reported settled, Current meshes as stale.
    sample
        .chunk_state
        .as_ref()
        .and_then(|state| {
            state
                .lod_eval
                .as_ref()
                .map(|eval| eval.mesh_status != LodMeshStatus::Current)
        })
        .unwrap_or(false)
}

pub(super) fn format_mesh_status_counts(counts: &BTreeMap<String, u32>) -> String {
    counts
        .iter()
        .map(|(status, count)| format!("{status}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

pub(super) fn median_for_camera_height_group(
    groups: &BTreeMap<(String, String, String), Vec<f32>>,
    lod: &str,
    mesh_status: &str,
    region: &str,
) -> Option<f32> {
    groups
        .get(&(lod.to_string(), mesh_status.to_string(), region.to_string()))
        .and_then(|values| signed_error_min_median_max(values))
        .map(|(_, median, _)| median)
}

pub(super) fn signed_error_min_median_max(values: &[f32]) -> Option<(f32, f32, f32)> {
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let min = *sorted.first()?;
    let max = *sorted.last()?;
    let mid = sorted.len() / 2;
    let median = if sorted.len() % 2 == 0 {
        (sorted[mid - 1] + sorted[mid]) * 0.5
    } else {
        sorted[mid]
    };
    Some((min, median, max))
}

pub(super) fn format_nearest_faces(faces: &[BoundaryDistanceProbe]) -> String {
    if faces.is_empty() {
        return "none".to_string();
    }
    faces
        .iter()
        .map(|face| format!("{}:{:.1}", face.face, face.distance_voxels))
        .collect::<Vec<_>>()
        .join(",")
}

pub(super) fn format_vec3_dump(value: Vec3Dump) -> String {
    format!("{:.2},{:.2},{:.2}", value.x, value.y, value.z)
}

pub(super) fn format_ivec3_dump(value: IVec3Dump) -> String {
    format!("{},{},{}", value.x, value.y, value.z)
}

pub(super) fn vec3_from_dump(value: Vec3Dump) -> Vec3 {
    Vec3::new(value.x, value.y, value.z)
}

pub(super) fn ivec3_from_dump(value: IVec3Dump) -> IVec3 {
    IVec3::new(value.x, value.y, value.z)
}

pub(super) fn expected_surface_y_at(
    world: &VoxelWorld,
    x: i32,
    z: i32,
    bounds: WorldBounds,
) -> Option<f32> {
    for y in (bounds.min_world_y..=bounds.max_world_y).rev() {
        let sample = world.sample_voxel_for_collision(IVec3::new(x, y, z));
        if matches!(sample, BoundaryVoxelSample::InBounds(voxel) if voxel.is_solid()) {
            return Some(y as f32 + 1.0);
        }
    }
    None
}

pub(super) fn highest_render_mesh_hit_at(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    center_chunk: IVec3,
    world_x: f32,
    world_z: f32,
    origin_y: f32,
) -> (
    Option<f32>,
    Option<IVec3Dump>,
    Option<String>,
    Option<MeshTriangleSectionProbe>,
) {
    let mut best: Option<(f32, IVec3Dump, String, MeshTriangleSectionProbe)> = None;

    for dz in -1..=1 {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let chunk_pos = center_chunk + IVec3::new(dx, dy, dz);
                let Some(entity) = world
                    .get_chunk(chunk_pos)
                    .and_then(|chunk| chunk.mesh_entity())
                else {
                    continue;
                };
                let Ok((
                    entity,
                    mesh3d,
                    transform,
                    chunk_mesh,
                    terrain_debug,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                )) = terrain_entities.get(entity)
                else {
                    continue;
                };
                let Some(mesh3d) = mesh3d else {
                    continue;
                };
                let Some(mesh) = meshes.get(&mesh3d.0) else {
                    continue;
                };
                let transform = transform
                    .map(|transform| transform.translation)
                    .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
                let Some(hit) = cpu_mesh_vertical_ray_hit_with_debug(
                    mesh,
                    transform,
                    world_x,
                    world_z,
                    origin_y,
                    terrain_debug,
                ) else {
                    continue;
                };
                if best
                    .as_ref()
                    .map_or(true, |(best_y, _, _, _)| hit.y > *best_y)
                {
                    let hit_chunk = chunk_mesh
                        .map(|chunk| chunk.chunk_position)
                        .unwrap_or(chunk_pos)
                        .into();
                    best = Some((hit.y, hit_chunk, format!("{entity:?}"), hit.mesh_section));
                }
            }
        }
    }

    match best {
        Some((hit_y, hit_chunk, entity, mesh_section)) => (
            Some(hit_y),
            Some(hit_chunk),
            Some(entity),
            Some(mesh_section),
        ),
        None => (None, None, None, None),
    }
}

#[cfg(feature = "mc_transvoxel")]
pub(super) fn nearest_render_mesh_hit_along_ray(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    center_chunk: IVec3,
    origin: Vec3,
    dir: Vec3,
    max_distance: f32,
    preferred_distances: &[f32],
) -> Option<CompactMeshRayHit> {
    let dir = dir.normalize_or_zero();
    if dir == Vec3::ZERO {
        return None;
    }

    let mut best: Option<(f32, CompactMeshRayHit)> = None;
    for dz in -1..=1 {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let chunk_pos = center_chunk + IVec3::new(dx, dy, dz);
                let Some(entity) = world
                    .get_chunk(chunk_pos)
                    .and_then(|chunk| chunk.mesh_entity())
                else {
                    continue;
                };
                let Ok((
                    entity,
                    mesh3d,
                    transform,
                    chunk_mesh,
                    terrain_debug,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                    _,
                )) = terrain_entities.get(entity)
                else {
                    continue;
                };
                let Some(mesh3d) = mesh3d else {
                    continue;
                };
                let Some(mesh) = meshes.get(&mesh3d.0) else {
                    continue;
                };
                let transform = transform
                    .map(|transform| transform.translation)
                    .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
                if !ray_intersects_chunk_bounds(origin, dir, transform, max_distance) {
                    continue;
                }

                let _ = for_each_mesh_triangle_with_indices(
                    mesh,
                    transform,
                    |triangle_start_index, indices, p0, p1, p2| {
                        let Some((distance, _front_face)) =
                            ray_triangle_hit(origin, dir, p0, p1, p2)
                        else {
                            return;
                        };
                        if distance > max_distance {
                            return;
                        }

                        let score = if preferred_distances.is_empty() {
                            distance
                        } else {
                            preferred_distances
                                .iter()
                                .map(|preferred| (distance - *preferred).abs())
                                .fold(f32::INFINITY, f32::min)
                        };
                        let replace = best.as_ref().map_or(true, |(best_score, best_hit)| {
                            score < *best_score - 1.0e-4
                                || ((score - *best_score).abs() <= 1.0e-4
                                    && distance < best_hit.distance)
                        });
                        if replace {
                            let hit_chunk = chunk_mesh
                                .map(|chunk| chunk.chunk_position)
                                .unwrap_or(chunk_pos)
                                .into();
                            best = Some((
                                score,
                                CompactMeshRayHit {
                                    distance,
                                    point: origin + dir * distance,
                                    chunk: hit_chunk,
                                    entity: format!("{entity:?}"),
                                    mesh_section: classify_mesh_triangle_section(
                                        terrain_debug,
                                        triangle_start_index,
                                        indices,
                                        p0,
                                        p1,
                                        p2,
                                    ),
                                },
                            ));
                        }
                    },
                );
            }
        }
    }

    best.map(|(_, hit)| hit)
}

#[derive(Clone, Copy)]
pub(super) struct VerticalMeshHit {
    pub(super) y: f32,
    pub(super) mesh_section: MeshTriangleSectionProbe,
}

#[cfg(feature = "mc_transvoxel")]
pub(super) struct CompactMeshRayHit {
    pub(super) distance: f32,
    pub(super) point: Vec3,
    pub(super) chunk: IVec3Dump,
    pub(super) entity: String,
    pub(super) mesh_section: MeshTriangleSectionProbe,
}

pub(super) fn cpu_mesh_vertical_ray_hit(
    mesh: &Mesh,
    translation: Vec3,
    world_x: f32,
    world_z: f32,
    origin_y: f32,
) -> Option<f32> {
    cpu_mesh_vertical_ray_hit_with_debug(mesh, translation, world_x, world_z, origin_y, None)
        .map(|hit| hit.y)
}

pub(super) fn cpu_mesh_vertical_ray_hit_with_debug(
    mesh: &Mesh,
    translation: Vec3,
    world_x: f32,
    world_z: f32,
    origin_y: f32,
    terrain_debug: Option<&TerrainMeshDebug>,
) -> Option<VerticalMeshHit> {
    let mut best_hit = None;
    for_each_mesh_triangle_with_indices(
        mesh,
        translation,
        |triangle_start_index, indices, p0, p1, p2| {
            if let Some(hit_y) = vertical_ray_triangle_hit_y(world_x, world_z, origin_y, p0, p1, p2)
            {
                if best_hit.map_or(true, |best: VerticalMeshHit| hit_y > best.y) {
                    best_hit = Some(VerticalMeshHit {
                        y: hit_y,
                        mesh_section: classify_mesh_triangle_section(
                            terrain_debug,
                            triangle_start_index,
                            indices,
                            p0,
                            p1,
                            p2,
                        ),
                    });
                }
            }
        },
    )?;
    best_hit
}

pub(super) enum MeshIndexSlice<'a> {
    U16(&'a [u16]),
    U32(&'a [u32]),
}

impl MeshIndexSlice<'_> {
    fn len(&self) -> usize {
        match self {
            MeshIndexSlice::U16(indices) => indices.len(),
            MeshIndexSlice::U32(indices) => indices.len(),
        }
    }

    pub(super) fn get(&self, index: usize) -> usize {
        match self {
            MeshIndexSlice::U16(indices) => indices[index] as usize,
            MeshIndexSlice::U32(indices) => indices[index] as usize,
        }
    }
}

pub(super) fn mesh_indices(mesh: &Mesh) -> Option<MeshIndexSlice<'_>> {
    match mesh.indices()? {
        Indices::U16(indices) => Some(MeshIndexSlice::U16(indices)),
        Indices::U32(indices) => Some(MeshIndexSlice::U32(indices)),
    }
}

pub(super) fn for_each_mesh_triangle_with_indices(
    mesh: &Mesh,
    translation: Vec3,
    mut visit: impl FnMut(usize, [usize; 3], Vec3, Vec3, Vec3),
) -> Option<()> {
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return None;
    };
    let indices = mesh_indices(mesh)?;
    let index_count = indices.len() - indices.len() % 3;
    let mut tri = 0;
    while tri < index_count {
        let p0 = Vec3::from_array(positions[indices.get(tri)]) + translation;
        let p1 = Vec3::from_array(positions[indices.get(tri + 1)]) + translation;
        let p2 = Vec3::from_array(positions[indices.get(tri + 2)]) + translation;
        visit(
            tri,
            [indices.get(tri), indices.get(tri + 1), indices.get(tri + 2)],
            p0,
            p1,
            p2,
        );
        tri += 3;
    }
    Some(())
}

pub(super) fn classify_mesh_triangle_section(
    terrain_debug: Option<&TerrainMeshDebug>,
    triangle_start_index: usize,
    vertex_indices: [usize; 3],
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
) -> MeshTriangleSectionProbe {
    let Some(debug) = terrain_debug else {
        return MeshTriangleSectionProbe::Unknown;
    };
    let stats = debug.mesh_section_stats;
    if triangle_start_index < stats.main_surface_index_count as usize
        || vertex_indices
            .iter()
            .all(|index| *index < stats.main_surface_vertex_count as usize)
    {
        return MeshTriangleSectionProbe::MainSurface;
    }

    let transition_index_count =
        stats.transition_apron_index_count + stats.vertical_skirt_index_count;
    if transition_index_count == 0 {
        return MeshTriangleSectionProbe::Unknown;
    }
    if stats.vertical_skirt_index_count == 0 {
        return MeshTriangleSectionProbe::TransitionApron;
    }
    if stats.transition_apron_index_count == 0 {
        return MeshTriangleSectionProbe::VerticalSkirt;
    }

    let min_y = p0.y.min(p1.y).min(p2.y);
    let max_y = p0.y.max(p1.y).max(p2.y);
    let y_span = max_y - min_y;
    if y_span >= VOXEL_SIZE * 1.25 {
        MeshTriangleSectionProbe::VerticalSkirt
    } else if stats.transition_apron_index_count > 0 {
        MeshTriangleSectionProbe::TransitionApron
    } else {
        MeshTriangleSectionProbe::TransitionGeometry
    }
}

pub(super) fn vertical_ray_triangle_hit_y(
    x: f32,
    z: f32,
    origin_y: f32,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
) -> Option<f32> {
    let denom = (p1.z - p2.z) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.z - p2.z);
    if denom.abs() < 1e-5 {
        return None;
    }
    let a = ((p1.z - p2.z) * (x - p2.x) + (p2.x - p1.x) * (z - p2.z)) / denom;
    let b = ((p2.z - p0.z) * (x - p2.x) + (p0.x - p2.x) * (z - p2.z)) / denom;
    let c = 1.0 - a - b;
    if a >= -1e-4 && b >= -1e-4 && c >= -1e-4 {
        let y = a * p0.y + b * p1.y + c * p2.y;
        (y <= origin_y).then_some(y)
    } else {
        None
    }
}

pub(super) fn sample_camera_ray(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    camera_pos: Vec3,
    camera_dir: Vec3,
    max_distance: f32,
    visual_context: Option<&VisualProbeContext>,
) -> CameraRayProbe {
    let dir = camera_dir.normalize_or_zero();
    let mut render_hits: Vec<CameraRayHit> = Vec::new();

    if dir != Vec3::ZERO {
        for (
            entity,
            mesh3d,
            transform,
            chunk_mesh,
            terrain_debug,
            mc_triangle_sources,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
            _,
        ) in terrain_entities.iter()
        {
            let Some(chunk_mesh) = chunk_mesh else {
                continue;
            };
            let Some(mesh3d) = mesh3d else {
                continue;
            };
            let Some(mesh) = meshes.get(&mesh3d.0) else {
                continue;
            };
            let translation = transform
                .map(|transform| transform.translation)
                .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_mesh.chunk_position).as_vec3());
            if !ray_intersects_chunk_bounds(camera_pos, dir, translation, max_distance) {
                continue;
            }
            collect_camera_ray_mesh_hits(
                mesh,
                translation,
                camera_pos,
                dir,
                max_distance,
                entity,
                chunk_mesh.chunk_position,
                terrain_debug,
                mc_triangle_sources,
                &mut render_hits,
            );
        }
    }

    render_hits.sort_by(|a, b| {
        a.distance
            .partial_cmp(&b.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let first_any_render_hit = render_hits.first().cloned();
    let first_front_render_hit = render_hits.iter().find(|hit| hit.front_face).cloned();
    let first_backface_render_hit = render_hits.iter().find(|hit| !hit.front_face).cloned();

    let mut first_voxel_solid_distance = None;
    let mut first_voxel_solid_point = None;
    let mut last_voxel_solid_distance = None;
    if dir != Vec3::ZERO {
        let step = 0.25_f32;
        let mut traveled = 0.0_f32;
        while traveled <= max_distance {
            let point = camera_pos + dir * traveled;
            let voxel = IVec3::new(
                point.x.floor() as i32,
                point.y.floor() as i32,
                point.z.floor() as i32,
            );
            if matches!(
                world.sample_voxel_for_terrain_meshing(voxel),
                BoundaryVoxelSample::InBounds(voxel) if voxel.is_solid()
            ) {
                first_voxel_solid_distance.get_or_insert(traveled);
                first_voxel_solid_point.get_or_insert(point);
                last_voxel_solid_distance = Some(traveled);
            }
            traveled += step;
        }
    }

    let mc_forensics = first_voxel_solid_point.and_then(|surface_point| {
        mc_forensics_for_gap(
            world,
            terrain_entities,
            meshes,
            camera_pos,
            dir,
            max_distance,
            surface_point,
            first_any_render_hit.as_ref(),
        )
    });
    let first_mesher_iso_distance = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.first_mesher_iso_distance);
    let first_mesher_iso_point = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.first_mesher_iso_point);
    let first_any_distance_from_mesher_iso = first_any_render_hit
        .as_ref()
        .zip(first_mesher_iso_distance)
        .map(|(hit, iso)| hit.distance - iso);
    let first_front_distance_from_mesher_iso = first_front_render_hit
        .as_ref()
        .zip(first_mesher_iso_distance)
        .map(|(hit, iso)| hit.distance - iso);
    let raw_surface_mc_cell = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.raw_surface_mc_cell.clone());
    let mesher_iso_mc_cell = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.mesher_iso_mc_cell.clone());
    let first_render_hit_source = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.first_render_hit_source.clone());
    let cell_agreement = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.cell_agreement.clone());
    let seam_terrace = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.seam_terrace.clone());
    let mc_cell = mc_forensics
        .as_ref()
        .and_then(|forensics| forensics.mc_cell.clone());

    let see_through_gap = match (first_voxel_solid_distance, &first_front_render_hit) {
        (Some(voxel_distance), Some(render_hit)) if render_hit.distance > voxel_distance + 1.0 => {
            Some(SeeThroughGap {
                voxel_surface_distance: voxel_distance,
                first_front_render_hit_distance: Some(render_hit.distance),
                gap_length: render_hit.distance - voxel_distance,
                note: "Camera ray entered solid voxel data before the nearest front-facing \
                       render surface; this may be a true hole or an intact depressed surface."
                    .to_string(),
            })
        }
        (Some(voxel_distance), None) => Some(SeeThroughGap {
            voxel_surface_distance: voxel_distance,
            first_front_render_hit_distance: None,
            gap_length: max_distance - voxel_distance,
            note: "Camera ray entered solid voxel data but never hit a front-facing render \
                   surface within range; this is a solid-before-render candidate."
                .to_string(),
        }),
        _ => None,
    };
    let visual_samples = visual_samples_for_camera_ray(
        visual_context,
        first_voxel_solid_point,
        first_mesher_iso_point,
        first_any_render_hit.as_ref(),
        first_front_render_hit.as_ref(),
    );
    let gap_classification = classify_camera_gap(
        &see_through_gap,
        &first_any_render_hit,
        &first_front_render_hit,
        &first_backface_render_hit,
        first_mesher_iso_distance,
        mc_cell.as_ref(),
        seam_terrace.as_ref(),
        &visual_samples,
    );

    render_hits.truncate(32);

    CameraRayProbe {
        origin: camera_pos.into(),
        direction: dir.into(),
        max_distance,
        first_voxel_solid_distance,
        last_voxel_solid_distance,
        first_any_render_hit,
        first_front_render_hit,
        first_backface_render_hit,
        first_mesher_iso_distance,
        first_mesher_iso_point: first_mesher_iso_point.map(Into::into),
        first_any_distance_from_mesher_iso,
        first_front_distance_from_mesher_iso,
        mc_cell,
        raw_surface_mc_cell,
        mesher_iso_mc_cell,
        first_render_hit_source,
        cell_agreement,
        seam_terrace,
        visual_samples,
        gap_classification,
        render_hits,
        see_through_gap,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn collect_camera_ray_mesh_hits(
    mesh: &Mesh,
    translation: Vec3,
    origin: Vec3,
    dir: Vec3,
    max_distance: f32,
    entity: Entity,
    chunk_position: IVec3,
    terrain_debug: Option<&TerrainMeshDebug>,
    mc_triangle_sources: Option<&McTriangleSources>,
    hits: &mut Vec<CameraRayHit>,
) {
    let _ = for_each_mesh_triangle_with_indices(
        mesh,
        translation,
        |triangle_start_index, indices, p0, p1, p2| {
            if let Some((distance, front_face)) = ray_triangle_hit(origin, dir, p0, p1, p2) {
                if distance <= max_distance {
                    let geometric_normal = (p1 - p0).cross(p2 - p0).normalize_or_zero();
                    hits.push(CameraRayHit {
                        distance,
                        point: (origin + dir * distance).into(),
                        front_face,
                        geometric_normal: geometric_normal.into(),
                        normal_dot_ray: geometric_normal.dot(dir),
                        vertex_normal: average_mesh_normal(mesh, indices).map(Into::into),
                        material_weights: average_mesh_material_weights(mesh, indices),
                        chunk_position: Some(chunk_position.into()),
                        entity: format!("{entity:?}"),
                        mesh_section: classify_mesh_triangle_section(
                            terrain_debug,
                            triangle_start_index,
                            indices,
                            p0,
                            p1,
                            p2,
                        ),
                        triangle_start_index: triangle_start_index as u32,
                        vertices: Some([p0.into(), p1.into(), p2.into()]),
                        source: mc_triangle_sources
                            .and_then(|sources| {
                                sources.source_for_triangle_start(triangle_start_index)
                            })
                            .map(mc_triangle_source_probe),
                    });
                }
            }
        },
    );
}

pub(super) fn average_mesh_normal(mesh: &Mesh, indices: [usize; 3]) -> Option<Vec3> {
    let Some(VertexAttributeValues::Float32x3(normals)) = mesh.attribute(Mesh::ATTRIBUTE_NORMAL)
    else {
        return None;
    };
    let n0 = Vec3::from_array(*normals.get(indices[0])?);
    let n1 = Vec3::from_array(*normals.get(indices[1])?);
    let n2 = Vec3::from_array(*normals.get(indices[2])?);
    Some((n0 + n1 + n2).normalize_or_zero())
}

pub(super) fn average_mesh_material_weights(mesh: &Mesh, indices: [usize; 3]) -> Option<[f32; 4]> {
    let Some(VertexAttributeValues::Float32x4(colors)) = mesh.attribute(Mesh::ATTRIBUTE_COLOR)
    else {
        return None;
    };
    let c0 = *colors.get(indices[0])?;
    let c1 = *colors.get(indices[1])?;
    let c2 = *colors.get(indices[2])?;
    Some([
        (c0[0] + c1[0] + c2[0]) / 3.0,
        (c0[1] + c1[1] + c2[1]) / 3.0,
        (c0[2] + c1[2] + c2[2]) / 3.0,
        (c0[3] + c1[3] + c2[3]) / 3.0,
    ])
}

pub(super) fn mc_triangle_source_probe(source: &McTriangleSource) -> McTriangleSourceProbe {
    match source {
        McTriangleSource::Regular {
            chunk_pos,
            lod,
            cell,
            case_index,
            class_index,
        } => McTriangleSourceProbe::Regular {
            chunk_position: (*chunk_pos).into(),
            lod: lod_string(*lod),
            cell: (*cell).into(),
            case_index: *case_index,
            class_index: *class_index,
        },
        McTriangleSource::Transition {
            chunk_pos,
            lod,
            face,
            cell_u,
            cell_v,
            case_index,
            class_index,
            invert,
        } => McTriangleSourceProbe::Transition {
            chunk_position: (*chunk_pos).into(),
            lod: lod_string(*lod),
            face: chunk_face_name(*face).to_string(),
            cell_u: *cell_u,
            cell_v: *cell_v,
            case_index: *case_index,
            class_index: *class_index,
            invert: *invert,
        },
    }
}

pub(super) fn ray_intersects_chunk_bounds(
    origin: Vec3,
    dir: Vec3,
    chunk_origin: Vec3,
    max_distance: f32,
) -> bool {
    let pad = 4.0;
    let min = chunk_origin - Vec3::splat(pad);
    let max = chunk_origin + Vec3::splat(CHUNK_SIZE_I32 as f32 + pad);
    let mut near = 0.0_f32;
    let mut far = max_distance;

    for axis in 0..3 {
        let origin_axis = origin[axis];
        let dir_axis = dir[axis];
        if dir_axis.abs() < 1e-6 {
            if origin_axis < min[axis] || origin_axis > max[axis] {
                return false;
            }
            continue;
        }

        let inv_dir = 1.0 / dir_axis;
        let mut t0 = (min[axis] - origin_axis) * inv_dir;
        let mut t1 = (max[axis] - origin_axis) * inv_dir;
        if t0 > t1 {
            std::mem::swap(&mut t0, &mut t1);
        }
        near = near.max(t0);
        far = far.min(t1);
        if near > far {
            return false;
        }
    }

    far >= 0.0 && near <= max_distance
}

/// Möller–Trumbore ray/triangle test. Returns `(distance, front_face)` where
/// `front_face` is true when the triangle normal faces the ray origin.
pub(super) fn ray_triangle_hit(
    origin: Vec3,
    dir: Vec3,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
) -> Option<(f32, bool)> {
    let edge1 = p1 - p0;
    let edge2 = p2 - p0;
    let pvec = dir.cross(edge2);
    let det = edge1.dot(pvec);
    if det.abs() < 1e-7 {
        return None;
    }
    let inv_det = 1.0 / det;
    let tvec = origin - p0;
    let u = tvec.dot(pvec) * inv_det;
    if !(-1e-4..=1.0 + 1e-4).contains(&u) {
        return None;
    }
    let qvec = tvec.cross(edge1);
    let v = dir.dot(qvec) * inv_det;
    if v < -1e-4 || u + v > 1.0 + 1e-4 {
        return None;
    }
    let distance = edge2.dot(qvec) * inv_det;
    if distance < 0.0 {
        return None;
    }
    let front_face = dir.dot(edge1.cross(edge2)) < 0.0;
    Some((distance, front_face))
}

pub(super) fn sample_camera_ray_fan(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    camera_pos: Vec3,
    camera_forward: Vec3,
    camera_right: Vec3,
    camera_up: Vec3,
    max_distance: f32,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
    visual_context: Option<&VisualProbeContext>,
) -> CameraRayFan {
    // Use a wide fan for visual seam diagnosis. The previous 10-degree cone
    // sampled only the center of a 45-degree, 16:9 screenshot and missed
    // off-center LOD seam holes visible near the left/right thirds.
    const HALF_ANGLE_DEGREES: f32 = 35.0;
    const GRID_SIZE: u32 = 13;

    let half_angle = HALF_ANGLE_DEGREES.to_radians();
    let mut gaps: Vec<FanGap> = Vec::new();
    let mut rays_total = 0;

    for grid_y in 0..GRID_SIZE {
        for grid_x in 0..GRID_SIZE {
            let fx = (grid_x as f32 / (GRID_SIZE - 1) as f32) * 2.0 - 1.0;
            let fy = (grid_y as f32 / (GRID_SIZE - 1) as f32) * 2.0 - 1.0;
            let dir = (camera_forward + camera_right * (fx * half_angle).tan()
                - camera_up * (fy * half_angle).tan())
            .normalize_or_zero();
            if dir == Vec3::ZERO {
                continue;
            }
            rays_total += 1;

            let probe = sample_camera_ray(
                world,
                terrain_entities,
                meshes,
                camera_pos,
                dir,
                max_distance,
                visual_context,
            );
            if let Some(gap) = &probe.see_through_gap {
                let surface_point = camera_pos + dir * gap.voxel_surface_distance;
                let surface_chunk = VoxelWorld::world_to_chunk(IVec3::new(
                    surface_point.x.floor() as i32,
                    surface_point.y.floor() as i32,
                    surface_point.z.floor() as i32,
                ));
                let chunk_origin = VoxelWorld::chunk_to_world(surface_chunk).as_vec3();
                let surface_local_point = surface_point - chunk_origin;
                gaps.push(FanGap {
                    grid_x,
                    grid_y,
                    direction: dir.into(),
                    voxel_surface_distance: gap.voxel_surface_distance,
                    first_front_render_hit_distance: gap.first_front_render_hit_distance,
                    first_front_render_mesh_section: probe
                        .first_front_render_hit
                        .as_ref()
                        .map(|hit| hit.mesh_section),
                    first_any_render_hit_distance: probe
                        .first_any_render_hit
                        .as_ref()
                        .map(|hit| hit.distance),
                    first_backface_render_hit_distance: probe
                        .first_backface_render_hit
                        .as_ref()
                        .map(|hit| hit.distance),
                    first_mesher_iso_distance: probe.first_mesher_iso_distance,
                    first_mesher_iso_point: probe.first_mesher_iso_point,
                    first_any_distance_from_mesher_iso: probe.first_any_distance_from_mesher_iso,
                    first_front_distance_from_mesher_iso: probe
                        .first_front_distance_from_mesher_iso,
                    gap_classification: probe.gap_classification,
                    mc_cell: probe.mc_cell,
                    raw_surface_mc_cell: probe.raw_surface_mc_cell,
                    mesher_iso_mc_cell: probe.mesher_iso_mc_cell,
                    first_render_hit_source: probe.first_render_hit_source,
                    cell_agreement: probe.cell_agreement,
                    seam_terrace: probe.seam_terrace,
                    visual_samples: probe.visual_samples,
                    gap_length: gap.gap_length,
                    surface_point: surface_point.into(),
                    surface_chunk: surface_chunk.into(),
                    surface_local_point: surface_local_point.into(),
                    nearest_chunk_faces: nearest_chunk_faces(surface_local_point),
                    surface_chunk_state: fan_gap_chunk_state(
                        world,
                        surface_chunk,
                        terrain_entities,
                        camera_pos,
                        mesh_settings,
                        lod_settings,
                        water_lod_guard_chunks,
                    ),
                });
            }
        }
    }

    CameraRayFan {
        half_angle_degrees: HALF_ANGLE_DEGREES,
        grid_size: GRID_SIZE,
        rays_total,
        rays_with_gap: gaps.len() as u32,
        gaps,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn render_entity_checklist_for_probe(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    target_chunk: IVec3,
    camera_ray_fan: Option<&CameraRayFan>,
    active_seam_faces: &[SeamFaceProbe],
    camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
) -> Vec<RenderEntityChecklistProbe> {
    let mut chunks = HashSet::from([target_chunk]);
    if let Some(fan) = camera_ray_fan {
        for gap in &fan.gaps {
            chunks.insert(ivec3_from_dump(gap.surface_chunk));
            if let Some(cell) = &gap.mc_cell {
                chunks.insert(ivec3_from_dump(cell.chunk_position));
            }
            if let Some(cell) = &gap.mesher_iso_mc_cell {
                chunks.insert(ivec3_from_dump(cell.chunk_position));
            }
            if let Some(source) = &gap.first_render_hit_source {
                if let Some(chunk) = mc_source_probe_chunk(source) {
                    chunks.insert(chunk);
                }
            }
        }
    }
    for seam in active_seam_faces {
        chunks.insert(ivec3_from_dump(seam.source_chunk));
        chunks.insert(ivec3_from_dump(seam.neighbor_chunk));
    }

    let mut chunks: Vec<_> = chunks.into_iter().collect();
    chunks.sort_by(|a, b| compare_chunk_pos_lex(*a, *b));
    chunks
        .into_iter()
        .filter_map(|chunk| {
            render_entity_checklist_for_chunk(
                world,
                terrain_entities,
                meshes,
                chunk,
                camera_pos,
                mesh_settings,
                lod_settings,
                water_lod_guard_chunks,
            )
        })
        .collect()
}
