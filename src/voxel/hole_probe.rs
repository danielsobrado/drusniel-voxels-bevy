use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use avian3d::prelude::{Collider, RigidBody, SpatialQuery, SpatialQueryFilter};
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy_mesh::{Indices, VertexAttributeValues};
use serde::Serialize;

use crate::camera::controller::PlayerCamera;
use crate::constants::CHUNK_SIZE_I32;
use crate::interaction::TargetedBlock;
use crate::performance::AreaTimingRecorder;
use crate::physics::{ChunkCollider, NeedsCollider, PhysicsLayer};
use crate::player::{Player, classify_player_world_validity};
use crate::voxel::chunk::{ChunkUniformity, LodLevel, MeshDirtyReason};
use crate::voxel::meshing::{ChunkMesh, WaterMesh};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample as BoundaryVoxelSample, VoxelWorld, WorldBounds};

pub struct TerrainHoleProbePlugin;

impl Plugin for TerrainHoleProbePlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Update, dump_terrain_hole_probe);
    }
}

#[derive(Serialize)]
struct TerrainHoleProbeDump {
    schema_version: u32,
    timestamp_utc: String,
    trigger: String,
    player_world_position: Vec3Dump,
    camera_world_position: Option<Vec3Dump>,
    target_voxel_position: IVec3Dump,
    target_voxel_type: Option<String>,
    target_chunk_position: IVec3Dump,
    target_local_voxel_position: UVec3Dump,
    world_bounds: WorldBoundsProbe,
    player_validity: PlayableValidityProbe,
    target_validity: PlayableValidityProbe,
    player_boundary_sample: BoundarySampleProbe,
    target_boundary_sample: BoundarySampleProbe,
    classification: TerrainHoleClassification,
    columns: Vec<ColumnProbe>,
    physics: PhysicsProbe,
    render_mesh_ray_hits: Vec<RenderMeshRayProbe>,
    chunks: Vec<ChunkProbe>,
}

#[derive(Serialize, Default)]
struct TerrainHoleClassification {
    world_data_hole: bool,
    mesh_missing: bool,
    collider_missing: bool,
    collider_pending: bool,
    collider_failed: bool,
    visibility_hidden: bool,
    mesh_surface_mismatch: bool,
    collider_surface_mismatch: bool,
    vertical_chunk_boundary_surface: bool,
    expected_surface_y: Option<f32>,
    physics_hit_y: Option<f32>,
    physics_surface_error: Option<f32>,
    render_mesh_ray_hit_y: Option<f32>,
    notes: Vec<String>,
}

#[derive(Serialize)]
struct WorldBoundsProbe {
    min_chunk: IVec3Dump,
    max_chunk: IVec3Dump,
    min_world_y: i32,
    max_world_y: i32,
    min_breakable_y: i32,
    kill_y: i32,
    bedrock_floor_y: i32,
    horizontal_min: IVec2Dump,
    horizontal_max: IVec2Dump,
}

#[derive(Serialize)]
struct PlayableValidityProbe {
    valid: bool,
    classification: String,
    invalid_reason: Option<String>,
}

#[derive(Serialize)]
struct BoundarySampleProbe {
    world_position: IVec3Dump,
    chunk_position: IVec3Dump,
    local_position: UVec3Dump,
    classification: String,
    voxel_type: Option<String>,
}

#[derive(Serialize)]
struct ColumnProbe {
    offset_x: i32,
    offset_z: i32,
    world_x: i32,
    world_z: i32,
    y_top: i32,
    y_bottom: i32,
    first_solid_from_above: Option<VoxelSample>,
    first_air_gap_below_top_solid: Option<VoxelSample>,
    first_water_below_top_solid: Option<VoxelSample>,
    samples: Vec<VoxelSample>,
}

#[derive(Serialize, Clone)]
struct VoxelSample {
    world_position: IVec3Dump,
    chunk_position: IVec3Dump,
    local_position: UVec3Dump,
    chunk_exists: bool,
    boundary: Option<String>,
    voxel_type: Option<String>,
    solid: bool,
    liquid: bool,
    open_vertical_path_to_sky: Option<bool>,
}

#[derive(Serialize)]
struct PhysicsProbe {
    player_down_ray: RayProbe,
    target_down_ray: RayProbe,
}

#[derive(Serialize)]
struct RayProbe {
    origin: Vec3Dump,
    direction: Vec3Dump,
    max_distance: f32,
    hit: Option<RayHitProbe>,
}

#[derive(Serialize)]
struct RayHitProbe {
    entity: String,
    distance: f32,
    hit_y: f32,
    normal: Vec3Dump,
    chunk_position: Option<IVec3Dump>,
    has_chunk_mesh: bool,
    has_chunk_collider: bool,
    has_collider: bool,
    has_static_rigid_body: bool,
}

#[derive(Serialize)]
struct RenderMeshRayProbe {
    entity: String,
    chunk_position: Option<IVec3Dump>,
    hit_y: Option<f32>,
    surface_error: Option<f32>,
    vertex_count: Option<usize>,
    triangle_count: Option<usize>,
    mesh_available: bool,
}

#[derive(Serialize)]
struct ChunkProbe {
    chunk_position: IVec3Dump,
    exists_in_world: bool,
    lod_level: Option<String>,
    dirty: Option<bool>,
    dirty_reason_flags: Option<u8>,
    dirty_reasons: Vec<String>,
    visibility_dirty: Option<bool>,
    uniformity: Option<String>,
    mesh_entity_from_world: Option<String>,
    water_mesh_entity_from_world: Option<String>,
    target_local_y_is_boundary: bool,
    terrain_entity: Option<EntityProbe>,
    water_entity: Option<EntityProbe>,
}

#[derive(Serialize)]
struct EntityProbe {
    entity: String,
    chunk_mesh: Option<ChunkMeshProbe>,
    visibility: Option<String>,
    inherited_visibility: Option<bool>,
    view_visibility: Option<bool>,
    has_chunk_mesh: bool,
    has_water_mesh: bool,
    has_needs_collider: bool,
    has_chunk_collider: bool,
    has_collider: bool,
    has_static_rigid_body: bool,
}

#[derive(Serialize)]
struct ChunkMeshProbe {
    chunk_position: IVec3Dump,
    vertex_count: u32,
    triangle_count: u32,
    mesh_mode: String,
    material_quality: String,
}

#[derive(Serialize, Clone, Copy)]
struct Vec3Dump {
    x: f32,
    y: f32,
    z: f32,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
struct IVec3Dump {
    x: i32,
    y: i32,
    z: i32,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
struct IVec2Dump {
    x: i32,
    y: i32,
}

#[derive(Serialize, Clone, Copy)]
struct UVec3Dump {
    x: u32,
    y: u32,
    z: u32,
}

type TerrainEntityQuery<'w, 's> = Query<
    'w,
    's,
    (
        Entity,
        Option<&'static Mesh3d>,
        Option<&'static Transform>,
        Option<&'static ChunkMesh>,
        Option<&'static WaterMesh>,
        Option<&'static Visibility>,
        Option<&'static InheritedVisibility>,
        Option<&'static ViewVisibility>,
        Option<&'static NeedsCollider>,
        Option<&'static ChunkCollider>,
        Option<&'static Collider>,
        Option<&'static RigidBody>,
    ),
>;

#[allow(clippy::too_many_arguments)]
fn dump_terrain_hole_probe(
    keys: Res<ButtonInput<KeyCode>>,
    world: Res<VoxelWorld>,
    targeted: Res<TargetedBlock>,
    player_query: Query<&GlobalTransform, With<Player>>,
    camera_query: Query<&GlobalTransform, (With<PlayerCamera>, Without<Player>)>,
    terrain_entities: TerrainEntityQuery,
    meshes: Res<Assets<Mesh>>,
    spatial_query: Option<SpatialQuery>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    if !shift_held || !keys.just_pressed(KeyCode::F9) {
        return;
    }

    let Some(mut spatial_query) = spatial_query else {
        warn!("Terrain hole probe skipped: physics SpatialQuery resource is not available");
        return;
    };
    spatial_query.update_pipeline();

    let player_pos = player_query
        .single()
        .map(|transform| transform.translation())
        .or_else(|_| {
            camera_query
                .single()
                .map(|transform| transform.translation())
        })
        .unwrap_or(Vec3::ZERO);
    let camera_pos = camera_query
        .single()
        .ok()
        .map(|transform| transform.translation());
    let target_pos = targeted.position.unwrap_or_else(|| {
        IVec3::new(
            player_pos.x.floor() as i32,
            (player_pos.y - 1.0).floor() as i32,
            player_pos.z.floor() as i32,
        )
    });
    let target_chunk = VoxelWorld::world_to_chunk(target_pos);
    let target_local = VoxelWorld::world_to_local(target_pos);
    let target_voxel = world.sample_voxel_for_collision(target_pos).voxel();

    let columns = sample_columns(&world, target_pos, 2);
    let physics = PhysicsProbe {
        player_down_ray: cast_down_ray(
            &spatial_query,
            &terrain_entities,
            player_pos + Vec3::Y * 4.0,
            160.0,
        ),
        target_down_ray: cast_down_ray(
            &spatial_query,
            &terrain_entities,
            target_pos.as_vec3() + Vec3::new(0.5, 8.0, 0.5),
            160.0,
        ),
    };
    let expected_surface_y = expected_surface_y(&columns);
    let render_mesh_ray_hits = sample_render_mesh_rays(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        target_pos,
        expected_surface_y,
    );
    let chunks = sample_neighbor_chunks(&world, target_chunk, target_local, &terrain_entities);
    let classification = classify_probe(
        target_pos,
        target_local,
        target_voxel,
        &columns,
        &physics,
        &render_mesh_ray_hits,
        &chunks,
        &world,
    );

    timing.record_count(
        frame.0,
        "Terrain Hole Probe: World Data Hole",
        classification.world_data_hole as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Mesh Missing",
        classification.mesh_missing as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Collider Missing",
        classification.collider_missing as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Collider Pending",
        classification.collider_pending as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Collider Failed",
        classification.collider_failed as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Hole Probe: Visibility Hidden",
        classification.visibility_hidden as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Surface Coverage Mismatch",
        (classification.mesh_surface_mismatch || classification.collider_surface_mismatch) as u8
            as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Collider Surface Mismatch",
        classification.collider_surface_mismatch as u8 as f64,
    );
    timing.record_count(
        frame.0,
        "Terrain Mesh Surface Mismatch",
        classification.mesh_surface_mismatch as u8 as f64,
    );

    let timestamp = timestamp_utc_compact();
    let dump = TerrainHoleProbeDump {
        schema_version: 1,
        timestamp_utc: timestamp.clone(),
        trigger: "Shift+F9".to_string(),
        player_world_position: player_pos.into(),
        camera_world_position: camera_pos.map(Into::into),
        target_voxel_position: target_pos.into(),
        target_voxel_type: target_voxel.map(voxel_name),
        target_chunk_position: target_chunk.into(),
        target_local_voxel_position: target_local.into(),
        world_bounds: world_bounds_probe(world.bounds()),
        player_validity: playable_validity_probe(&world, player_pos),
        target_validity: playable_validity_probe(
            &world,
            Vec3::new(
                target_pos.x as f32 + 0.5,
                target_pos.y as f32 + 1.0,
                target_pos.z as f32 + 0.5,
            ),
        ),
        player_boundary_sample: boundary_sample_probe(
            &world,
            IVec3::new(
                player_pos.x.floor() as i32,
                player_pos.y.floor() as i32,
                player_pos.z.floor() as i32,
            ),
        ),
        target_boundary_sample: boundary_sample_probe(&world, target_pos),
        classification,
        columns,
        physics,
        render_mesh_ray_hits,
        chunks,
    };

    match write_probe_dump(&dump, &timestamp) {
        Ok(path) => info!("Terrain hole probe written to {}", path.display()),
        Err(err) => error!("Failed to write terrain hole probe: {err}"),
    }
}

fn sample_columns(world: &VoxelWorld, target_pos: IVec3, radius: i32) -> Vec<ColumnProbe> {
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

fn sample_voxel(world: &VoxelWorld, pos: IVec3) -> VoxelSample {
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

fn world_bounds_probe(bounds: WorldBounds) -> WorldBoundsProbe {
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

fn playable_validity_probe(world: &VoxelWorld, position: Vec3) -> PlayableValidityProbe {
    let validity = classify_player_world_validity(world, position);
    PlayableValidityProbe {
        valid: validity.is_valid(),
        classification: validity.label().to_string(),
        invalid_reason: validity.invalid_reason().map(str::to_string),
    }
}

fn boundary_sample_probe(world: &VoxelWorld, pos: IVec3) -> BoundarySampleProbe {
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

fn open_vertical_path_to_sky(world: &VoxelWorld, pos: IVec3) -> bool {
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

fn cast_down_ray(
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
                .and_then(|(_, _, _, chunk_mesh, _, _, _, _, _, _, _, _)| chunk_mesh)
                .map(|chunk_mesh| chunk_mesh.chunk_position.into());
            let has_chunk_mesh = entity_probe
                .is_some_and(|(_, _, _, chunk_mesh, _, _, _, _, _, _, _, _)| chunk_mesh.is_some());
            let has_chunk_collider =
                entity_probe.is_some_and(|(_, _, _, _, _, _, _, _, _, chunk_collider, _, _)| {
                    chunk_collider.is_some()
                });
            let has_collider = entity_probe
                .is_some_and(|(_, _, _, _, _, _, _, _, _, _, collider, _)| collider.is_some());
            let has_static_rigid_body =
                entity_probe.is_some_and(|(_, _, _, _, _, _, _, _, _, _, _, body)| {
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

fn expected_surface_y(columns: &[ColumnProbe]) -> Option<f32> {
    columns
        .iter()
        .find(|column| column.offset_x == 0 && column.offset_z == 0)
        .and_then(|column| column.first_solid_from_above.as_ref())
        .map(|sample| sample.world_position.y as f32 + 1.0)
}

fn sample_render_mesh_rays(
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
                let Ok((entity, mesh3d, transform, chunk_mesh, _, _, _, _, _, _, _, _)) =
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

fn cpu_mesh_vertical_ray_hit(
    mesh: &Mesh,
    translation: Vec3,
    world_x: f32,
    world_z: f32,
    origin_y: f32,
) -> Option<f32> {
    let Some(VertexAttributeValues::Float32x3(positions)) =
        mesh.attribute(Mesh::ATTRIBUTE_POSITION)
    else {
        return None;
    };
    let indices = mesh_indices(mesh)?;
    let mut best_hit = None;
    for tri in indices.chunks_exact(3) {
        let p0 = Vec3::from_array(positions[tri[0] as usize]) + translation;
        let p1 = Vec3::from_array(positions[tri[1] as usize]) + translation;
        let p2 = Vec3::from_array(positions[tri[2] as usize]) + translation;
        if let Some(hit_y) = vertical_ray_triangle_hit_y(world_x, world_z, origin_y, p0, p1, p2) {
            if best_hit.map_or(true, |best| hit_y > best) {
                best_hit = Some(hit_y);
            }
        }
    }
    best_hit
}

fn mesh_indices(mesh: &Mesh) -> Option<Vec<u32>> {
    match mesh.indices()? {
        Indices::U16(indices) => Some(indices.iter().map(|index| *index as u32).collect()),
        Indices::U32(indices) => Some(indices.clone()),
    }
}

fn vertical_ray_triangle_hit_y(
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

fn sample_neighbor_chunks(
    world: &VoxelWorld,
    center_chunk: IVec3,
    target_local: UVec3,
    terrain_entities: &TerrainEntityQuery,
) -> Vec<ChunkProbe> {
    let mut chunks = Vec::new();
    for dz in -1..=1 {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let chunk_pos = center_chunk + IVec3::new(dx, dy, dz);
                let chunk = world.get_chunk(chunk_pos);
                let mesh_entity = chunk.and_then(|chunk| chunk.mesh_entity());
                let water_entity = chunk.and_then(|chunk| chunk.water_mesh_entity());

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

fn entity_probe(entity: Entity, terrain_entities: &TerrainEntityQuery) -> Option<EntityProbe> {
    let (
        entity,
        _mesh3d,
        _transform,
        chunk_mesh,
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

fn classify_probe(
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

fn write_probe_dump(dump: &TerrainHoleProbeDump, timestamp: &str) -> std::io::Result<PathBuf> {
    let dir = PathBuf::from("debug");
    fs::create_dir_all(&dir)?;
    let path = dir.join(format!("terrain-hole-probe-{timestamp}.json"));
    let json = serde_json::to_string_pretty(dump)?;
    fs::write(&path, json)?;
    Ok(path)
}

fn dirty_reason_names(flags: u8) -> Vec<String> {
    [
        (MeshDirtyReason::Lod, "LOD"),
        (MeshDirtyReason::NeighborLod, "NeighborLOD"),
        (MeshDirtyReason::Visibility, "Visibility"),
        (MeshDirtyReason::Generation, "Generation"),
        (MeshDirtyReason::WaterMaterial, "WaterMaterial"),
        (MeshDirtyReason::TerrainMutation, "TerrainMutation"),
    ]
    .into_iter()
    .filter_map(|(reason, name)| ((flags & reason.bit()) != 0).then_some(name.to_string()))
    .collect()
}

fn lod_name(lod: LodLevel) -> &'static str {
    match lod {
        LodLevel::Lod0 => "Lod0",
        LodLevel::Lod1 => "Lod1",
        LodLevel::Lod2 => "Lod2",
        LodLevel::Lod3 => "Lod3",
        LodLevel::Culled => "Culled",
    }
}

fn uniformity_name(uniformity: ChunkUniformity) -> &'static str {
    match uniformity {
        ChunkUniformity::Unknown => "Unknown",
        ChunkUniformity::Empty => "Empty",
        ChunkUniformity::Solid => "Solid",
        ChunkUniformity::Mixed => "Mixed",
    }
}

fn voxel_name(voxel: VoxelType) -> String {
    format!("{voxel:?}")
}

fn boundary_sample_name(sample: BoundaryVoxelSample) -> Option<&'static str> {
    match sample {
        BoundaryVoxelSample::InBounds(_) => None,
        BoundaryVoxelSample::OutsideBelowWorld => Some("OutsideBelowWorld"),
        BoundaryVoxelSample::OutsideAboveWorld => Some("OutsideAboveWorld"),
        BoundaryVoxelSample::OutsideHorizontalWorld => Some("OutsideHorizontalWorld"),
        BoundaryVoxelSample::MissingChunkInsideBounds => Some("MissingChunkInsideBounds"),
    }
}

fn timestamp_utc_compact() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default();
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}{month:02}{day:02}-{hour:02}{minute:02}{second:02}")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if m <= 2 { 1 } else { 0 };
    (year as i32, m as u32, d as u32)
}

impl From<Vec3> for Vec3Dump {
    fn from(value: Vec3) -> Self {
        Self {
            x: value.x,
            y: value.y,
            z: value.z,
        }
    }
}

impl From<IVec3> for IVec3Dump {
    fn from(value: IVec3) -> Self {
        Self {
            x: value.x,
            y: value.y,
            z: value.z,
        }
    }
}

impl From<IVec2> for IVec2Dump {
    fn from(value: IVec2) -> Self {
        Self {
            x: value.x,
            y: value.y,
        }
    }
}

impl From<UVec3> for UVec3Dump {
    fn from(value: UVec3) -> Self {
        Self {
            x: value.x,
            y: value.y,
            z: value.z,
        }
    }
}
