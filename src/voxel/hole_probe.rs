use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use avian3d::prelude::{Collider, RigidBody, SpatialQuery, SpatialQueryFilter};
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy_mesh::{Indices, VertexAttributeValues};
use serde::Serialize;

use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE_I32, VOXEL_SIZE};
use crate::interaction::TargetedBlock;
use crate::performance::AreaTimingRecorder;
use crate::physics::{ChunkCollider, NeedsCollider, PhysicsLayer};
use crate::player::{Player, classify_player_world_validity};
use crate::voxel::chunk::{ChunkUniformity, LodLevel, MeshDirtyReason};
use crate::voxel::mc_transvoxel::McTransvoxelStats;
use crate::voxel::meshing::{
    ChunkMesh, LodTransitionSnapStats, MeshMode, MeshSettings, TerrainMeshDebug,
    TerrainMeshSectionStats, WaterMesh, empty_chunk_has_surface_nets_boundary_surface,
};
use crate::voxel::plugin::{
    LodSettings, WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA, calculate_target_lod_with_hysteresis,
    collect_water_shore_lod_guard_chunks, effective_terrain_mesh_lod_for_chunk,
    terrain_lod_distance_xz, terrain_lod_hysteresis, water_shore_guarded_lod,
};
use crate::voxel::skirt::NeighborLods;
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample as BoundaryVoxelSample, VoxelWorld, WorldBounds};

pub struct TerrainHoleProbePlugin;

const TERRAIN_HOLE_PROBE_SCHEMA_VERSION: u32 = 8;

impl Plugin for TerrainHoleProbePlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TerrainHoleProbeRequests>()
            .add_systems(Update, dump_terrain_hole_probe);
    }
}

#[derive(Clone, Debug)]
pub struct TerrainHoleProbeRequest {
    pub trigger: String,
    pub output_label: Option<String>,
    pub target_voxel_position: IVec3,
    pub player_world_position: Option<Vec3>,
    pub camera_world_position: Option<Vec3>,
    pub camera_direction: Option<Vec3>,
}

#[derive(Resource, Default)]
pub struct TerrainHoleProbeRequests {
    pending: Vec<TerrainHoleProbeRequest>,
}

impl TerrainHoleProbeRequests {
    pub fn push(&mut self, request: TerrainHoleProbeRequest) {
        self.pending.push(request);
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
    render_mesh_ray_grid: Vec<RenderMeshRayGridProbe>,
    camera_ray: Option<CameraRayProbe>,
    camera_ray_fan: Option<CameraRayFan>,
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
struct RenderMeshRayGridProbe {
    sample_kind: RenderMeshRayGridSampleKind,
    offset_x: i32,
    offset_z: i32,
    world_x: f32,
    world_z: f32,
    ray_origin: Vec3Dump,
    ray_origin_y: f32,
    ray_direction: Vec3Dump,
    expected_surface_y: Option<f32>,
    highest_render_hit_y: Option<f32>,
    render_hit_point: Option<Vec3Dump>,
    render_hit_chunk: Option<IVec3Dump>,
    render_hit_local_point: Option<Vec3Dump>,
    signed_surface_error: Option<f32>,
    abs_surface_error: Option<f32>,
    surface_error: Option<f32>,
    render_hit_mesh_section: Option<MeshTriangleSectionProbe>,
    nearest_chunk_faces: Vec<BoundaryDistanceProbe>,
    hit_chunk: Option<IVec3Dump>,
    hit_entity: Option<String>,
    chunk_state: Option<FanGapChunkState>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum RenderMeshRayGridSampleKind {
    TargetVertical,
    CameraHeightFan,
}

/// Camera look-ray cast against the terrain *render meshes*, used to catch
/// see-through LOD cracks: the targeting voxel-raycast passes straight through
/// such a gap and locks onto solid terrain behind it, so it can never land on
/// the crack. This ray instead reports where the ray enters solid voxel data
/// versus where it first meets a front-facing render triangle.
#[derive(Serialize)]
struct CameraRayProbe {
    origin: Vec3Dump,
    direction: Vec3Dump,
    max_distance: f32,
    /// Distance at which the ray first enters solid voxel data.
    first_voxel_solid_distance: Option<f32>,
    /// Distance at which the ray last leaves solid voxel data.
    last_voxel_solid_distance: Option<f32>,
    /// Nearest front-facing render-mesh triangle hit.
    first_front_render_hit: Option<CameraRayHit>,
    /// All render-mesh hits along the ray, sorted by distance (capped).
    render_hits: Vec<CameraRayHit>,
    /// Set when the ray enters solid voxel data with no render surface there.
    see_through_gap: Option<SeeThroughGap>,
}

#[derive(Serialize, Clone)]
struct CameraRayHit {
    distance: f32,
    point: Vec3Dump,
    /// True if the triangle faces the ray origin (a visible surface front).
    front_face: bool,
    chunk_position: Option<IVec3Dump>,
    entity: String,
    mesh_section: MeshTriangleSectionProbe,
    triangle_start_index: u32,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MeshTriangleSectionProbe {
    MainSurface,
    TransitionApron,
    VerticalSkirt,
    TransitionGeometry,
    Unknown,
}

#[derive(Serialize)]
struct SeeThroughGap {
    voxel_surface_distance: f32,
    first_front_render_hit_distance: Option<f32>,
    gap_length: f32,
    note: String,
}

/// A cone of camera rays around the crosshair. A single ray needs pixel-perfect
/// aim to land on a small crack at distance; the fan lets a rough aim at the
/// crack cluster catch any solid-before-render candidate inside the cone.
#[derive(Serialize)]
struct CameraRayFan {
    half_angle_degrees: f32,
    grid_size: u32,
    rays_total: u32,
    rays_with_gap: u32,
    gaps: Vec<FanGap>,
}

#[derive(Serialize)]
struct FanGap {
    grid_x: u32,
    grid_y: u32,
    direction: Vec3Dump,
    voxel_surface_distance: f32,
    first_front_render_hit_distance: Option<f32>,
    first_front_render_mesh_section: Option<MeshTriangleSectionProbe>,
    gap_length: f32,
    surface_point: Vec3Dump,
    surface_chunk: IVec3Dump,
    surface_local_point: Vec3Dump,
    nearest_chunk_faces: Vec<BoundaryDistanceProbe>,
    surface_chunk_state: FanGapChunkState,
}

#[derive(Serialize)]
struct BoundaryDistanceProbe {
    face: String,
    distance_voxels: f32,
}

#[derive(Serialize)]
struct FanGapChunkState {
    exists_in_world: bool,
    lod_level: Option<String>,
    dirty: Option<bool>,
    dirty_reason_flags: Option<u8>,
    dirty_reasons: Vec<String>,
    uniformity: Option<String>,
    mesh_entity_from_world: Option<String>,
    lod_eval: Option<LodEvalProbe>,
    neighbor_lods_at_mesh: Option<NeighborLodsProbe>,
    lod_transition_snap_at_mesh: Option<LodTransitionSnapStatsProbe>,
    mc_transvoxel_at_mesh: Option<McTransvoxelStatsProbe>,
    mesh_sections_at_mesh: Option<TerrainMeshSectionStatsProbe>,
    empty_surface_cap_at_mesh: Option<bool>,
    empty_cap: EmptyCapProbe,
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
    lod_eval: Option<LodEvalProbe>,
    empty_cap: EmptyCapProbe,
    terrain_entity: Option<EntityProbe>,
    water_entity: Option<EntityProbe>,
}

#[derive(Serialize)]
struct LodEvalProbe {
    distance_xz: Option<f32>,
    high_detail_distance: f32,
    cull_distance: f32,
    hysteresis: f32,
    current_lod: Option<String>,
    computed_target_lod: Option<String>,
    water_shore_guarded: bool,
    water_guard_distance: f32,
    effective_mesh_lod_now: Option<String>,
    last_logical_lod_at_mesh: Option<String>,
    last_meshed_lod: Option<String>,
    mesh_lod_mismatch: Option<bool>,
    mesh_status: LodMeshStatus,
    remesh_pending: bool,
    remesh_reason_flags: u8,
    remesh_reasons: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum LodMeshStatus {
    Current,
    RemeshPending,
    Stale,
    DebugUnavailable,
}

#[derive(Serialize)]
struct EmptyCapProbe {
    is_empty: bool,
    empty_surface_cap_candidate: bool,
    below_chunk_uniformity: Option<String>,
    above_chunk_uniformity: Option<String>,
    below_plane_solid_count: u32,
    above_plane_solid_count: u32,
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
    logical_lod_at_mesh: Option<String>,
    effective_lod_at_mesh: Option<String>,
    target_mode_at_mesh: Option<String>,
    neighbor_lods_at_mesh: Option<NeighborLodsProbe>,
    lod_delta_gt_one_faces_at_mesh: Option<Vec<String>>,
    missing_boundary_neighbors_at_mesh: Option<u32>,
    empty_surface_cap_at_mesh: Option<bool>,
    generated_frame: Option<u32>,
    lod_transition_snap: Option<LodTransitionSnapStatsProbe>,
    mc_transvoxel: Option<McTransvoxelStatsProbe>,
    mesh_sections: Option<TerrainMeshSectionStatsProbe>,
}

#[derive(Serialize, Clone, Copy)]
struct TerrainMeshSectionStatsProbe {
    main_surface_vertex_count: u32,
    main_surface_index_count: u32,
    transition_apron_index_count: u32,
    vertical_skirt_index_count: u32,
}

#[derive(Serialize)]
struct NeighborLodsProbe {
    neg_x: Option<String>,
    pos_x: Option<String>,
    neg_y: Option<String>,
    pos_y: Option<String>,
    neg_z: Option<String>,
    pos_z: Option<String>,
}

#[derive(Serialize, Clone)]
struct LodTransitionSnapStatsProbe {
    snapped_face_mask: u8,
    fallback_face_mask: u8,
    snapped_faces: Vec<String>,
    fallback_faces: Vec<String>,
    snapped_vertex_count: u32,
    skipped_vertex_count: u32,
    conflicting_vertex_count: u32,
}

#[derive(Serialize, Clone, Copy)]
struct McTransvoxelStatsProbe {
    regular_chunks_meshed: u32,
    transition_faces_meshed: [u32; 6],
    transition_triangles_total: u32,
    skipped_lod_delta_gt_one: u32,
    skipped_missing_neighbor: u32,
    mesh_generation_ms_total: f32,
    triangle_count_regular: u32,
    triangle_count_transition: u32,
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
        Option<&'static TerrainMeshDebug>,
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
    mut requests: ResMut<TerrainHoleProbeRequests>,
    world: Res<VoxelWorld>,
    targeted: Res<TargetedBlock>,
    player_query: Query<&GlobalTransform, With<Player>>,
    camera_query: Query<&GlobalTransform, (With<PlayerCamera>, Without<Player>)>,
    terrain_entities: TerrainEntityQuery,
    meshes: Res<Assets<Mesh>>,
    spatial_query: Option<SpatialQuery>,
    mesh_settings: Res<MeshSettings>,
    lod_settings: Res<LodSettings>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let keyboard_requested = shift_held && keys.just_pressed(KeyCode::F9);
    let scripted_request = (!keyboard_requested)
        .then(|| requests.pending.pop())
        .flatten();
    if !keyboard_requested && scripted_request.is_none() {
        return;
    }
    let request = scripted_request.as_ref();

    let mut spatial_query = spatial_query;
    if let Some(spatial_query) = spatial_query.as_mut() {
        spatial_query.update_pipeline();
    } else if keyboard_requested {
        warn!("Terrain hole probe skipped: physics SpatialQuery resource is not available");
        return;
    } else {
        warn!(
            "Terrain hole probe continuing without physics SpatialQuery; down-ray hits will be absent"
        );
    }

    let player_pos = player_query
        .single()
        .map(|transform| transform.translation())
        .or_else(|_| {
            camera_query
                .single()
                .map(|transform| transform.translation())
        })
        .unwrap_or(Vec3::ZERO);
    let player_pos = request
        .and_then(|request| request.player_world_position)
        .unwrap_or(player_pos);
    let camera_transform = camera_query.single().ok();
    let camera_pos = request
        .and_then(|request| request.camera_world_position)
        .or_else(|| camera_transform.map(|transform| transform.translation()));
    let camera_dir = request
        .and_then(|request| request.camera_direction)
        .map(Vec3::normalize_or_zero)
        .or_else(|| camera_transform.map(|transform| transform.forward().as_vec3()));
    let (scripted_right, scripted_up) = camera_dir
        .filter(|_| request.is_some())
        .map(camera_basis_from_forward)
        .unwrap_or((Vec3::ZERO, Vec3::ZERO));
    let camera_right = if request.is_some() {
        Some(scripted_right)
    } else {
        camera_transform.map(|transform| transform.right().as_vec3())
    };
    let camera_up = if request.is_some() {
        Some(scripted_up)
    } else {
        camera_transform.map(|transform| transform.up().as_vec3())
    };
    let target_pos = request
        .map(|request| request.target_voxel_position)
        .or(targeted.position)
        .unwrap_or_else(|| {
            IVec3::new(
                player_pos.x.floor() as i32,
                (player_pos.y - 1.0).floor() as i32,
                player_pos.z.floor() as i32,
            )
        });
    let target_chunk = VoxelWorld::world_to_chunk(target_pos);
    let target_local = VoxelWorld::world_to_local(target_pos);
    let target_voxel = world.sample_voxel_for_collision(target_pos).voxel();
    let water_lod_guard_chunks = collect_water_shore_lod_guard_chunks(&world);

    let columns = sample_columns(&world, target_pos, 2);
    let player_down_ray_origin = player_pos + Vec3::Y * 4.0;
    let target_down_ray_origin = target_pos.as_vec3() + Vec3::new(0.5, 8.0, 0.5);
    let physics = if let Some(spatial_query) = spatial_query.as_ref() {
        PhysicsProbe {
            player_down_ray: cast_down_ray(
                spatial_query,
                &terrain_entities,
                player_down_ray_origin,
                160.0,
            ),
            target_down_ray: cast_down_ray(
                spatial_query,
                &terrain_entities,
                target_down_ray_origin,
                160.0,
            ),
        }
    } else {
        PhysicsProbe {
            player_down_ray: missing_down_ray_probe(player_down_ray_origin, 160.0),
            target_down_ray: missing_down_ray_probe(target_down_ray_origin, 160.0),
        }
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
    let render_mesh_ray_grid = sample_render_mesh_ray_grid(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        target_pos,
        camera_pos,
        camera_dir,
        camera_right,
        camera_up,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
    log_camera_height_grid_summary(&render_mesh_ray_grid);
    let camera_ray = match (camera_pos, camera_dir) {
        (Some(camera_pos), Some(camera_dir)) => Some(sample_camera_ray(
            &world,
            &terrain_entities,
            &meshes,
            camera_pos,
            camera_dir,
            512.0,
        )),
        _ => None,
    };
    if let Some(gap) = camera_ray
        .as_ref()
        .and_then(|ray| ray.see_through_gap.as_ref())
    {
        warn!(
            "Camera-ray probe: solid-before-render candidate at {:.1}m; \
             nearest front render surface at {:?}, distance delta {:.1}m \
             (may be hole or depressed surface)",
            gap.voxel_surface_distance, gap.first_front_render_hit_distance, gap.gap_length,
        );
    }
    let camera_ray_fan = match (camera_pos, camera_dir, camera_right, camera_up) {
        (Some(pos), Some(forward), Some(right), Some(up)) => Some(sample_camera_ray_fan(
            &world,
            &terrain_entities,
            &meshes,
            pos,
            forward,
            right,
            up,
            512.0,
            &mesh_settings,
            &lod_settings,
            &water_lod_guard_chunks,
        )),
        _ => None,
    };
    if let Some(fan) = &camera_ray_fan {
        if fan.rays_with_gap > 0 {
            warn!(
                "Camera-ray fan: {} of {} rays found solid-before-render candidates in the {} degree cone \
                 (may be hole or depressed surface)",
                fan.rays_with_gap, fan.rays_total, fan.half_angle_degrees,
            );
        } else {
            info!(
                "Camera-ray fan: 0 of {} rays found solid-before-render candidates in the {} degree cone \
                 around the crosshair.",
                fan.rays_total, fan.half_angle_degrees,
            );
        }
    }
    let chunks = sample_neighbor_chunks(
        &world,
        target_chunk,
        target_local,
        &terrain_entities,
        camera_pos,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
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
    let trigger = request
        .map(|request| request.trigger.clone())
        .unwrap_or_else(|| "Shift+F9".to_string());
    let dump = TerrainHoleProbeDump {
        schema_version: TERRAIN_HOLE_PROBE_SCHEMA_VERSION,
        timestamp_utc: timestamp.clone(),
        trigger,
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
        render_mesh_ray_grid,
        camera_ray,
        camera_ray_fan,
        chunks,
    };

    let output_label = request.and_then(|request| request.output_label.as_deref());
    match write_probe_dump(&dump, &timestamp, output_label) {
        Ok(path) => info!("Terrain hole probe written to {}", path.display()),
        Err(err) => error!("Failed to write terrain hole probe: {err}"),
    }
}

fn camera_basis_from_forward(forward: Vec3) -> (Vec3, Vec3) {
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
                .and_then(|(_, _, _, chunk_mesh, _, _, _, _, _, _, _, _, _)| chunk_mesh)
                .map(|chunk_mesh| chunk_mesh.chunk_position.into());
            let has_chunk_mesh =
                entity_probe.is_some_and(|(_, _, _, chunk_mesh, _, _, _, _, _, _, _, _, _)| {
                    chunk_mesh.is_some()
                });
            let has_chunk_collider =
                entity_probe.is_some_and(|(_, _, _, _, _, _, _, _, _, _, chunk_collider, _, _)| {
                    chunk_collider.is_some()
                });
            let has_collider = entity_probe
                .is_some_and(|(_, _, _, _, _, _, _, _, _, _, _, collider, _)| collider.is_some());
            let has_static_rigid_body =
                entity_probe.is_some_and(|(_, _, _, _, _, _, _, _, _, _, _, _, body)| {
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

fn missing_down_ray_probe(origin: Vec3, max_distance: f32) -> RayProbe {
    RayProbe {
        origin: origin.into(),
        direction: Vec3::NEG_Y.into(),
        max_distance,
        hit: None,
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
                let Ok((entity, mesh3d, transform, chunk_mesh, _, _, _, _, _, _, _, _, _)) =
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
fn sample_render_mesh_ray_grid(
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
fn append_camera_height_fan_samples(
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
fn render_mesh_ray_grid_hit_metadata(
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

fn log_camera_height_grid_summary(samples: &[RenderMeshRayGridProbe]) {
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

fn mesh_section_label(section: Option<MeshTriangleSectionProbe>) -> &'static str {
    match section {
        Some(MeshTriangleSectionProbe::MainSurface) => "main_surface",
        Some(MeshTriangleSectionProbe::TransitionApron) => "transition_apron",
        Some(MeshTriangleSectionProbe::VerticalSkirt) => "vertical_skirt",
        Some(MeshTriangleSectionProbe::TransitionGeometry) => "transition_geometry",
        Some(MeshTriangleSectionProbe::Unknown) | None => "unknown",
    }
}

fn current_lod_label_for_height_sample(sample: &RenderMeshRayGridProbe) -> String {
    sample
        .chunk_state
        .as_ref()
        .and_then(|state| state.lod_level.as_deref())
        .unwrap_or("unknown")
        .to_string()
}

fn rendered_lod_label_for_height_sample(sample: &RenderMeshRayGridProbe) -> String {
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

fn mesh_status_label_for_height_sample(sample: &RenderMeshRayGridProbe) -> String {
    sample
        .chunk_state
        .as_ref()
        .and_then(|state| state.lod_eval.as_ref())
        .map(|eval| format!("{:?}", eval.mesh_status))
        .unwrap_or_else(|| "unknown".to_string())
}

fn height_sample_mesh_pending_or_stale(sample: &RenderMeshRayGridProbe) -> bool {
    sample
        .chunk_state
        .as_ref()
        .and_then(|state| {
            state.lod_eval.as_ref().map(|eval| {
                eval.remesh_pending
                    || eval.mesh_status != LodMeshStatus::Current
                    || (eval.last_meshed_lod.is_some()
                        && state.lod_level.is_some()
                        && eval.last_meshed_lod != state.lod_level)
            })
        })
        .unwrap_or(false)
}

fn format_mesh_status_counts(counts: &BTreeMap<String, u32>) -> String {
    counts
        .iter()
        .map(|(status, count)| format!("{status}:{count}"))
        .collect::<Vec<_>>()
        .join(",")
}

fn median_for_camera_height_group(
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

fn signed_error_min_median_max(values: &[f32]) -> Option<(f32, f32, f32)> {
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

fn format_nearest_faces(faces: &[BoundaryDistanceProbe]) -> String {
    if faces.is_empty() {
        return "none".to_string();
    }
    faces
        .iter()
        .map(|face| format!("{}:{:.1}", face.face, face.distance_voxels))
        .collect::<Vec<_>>()
        .join(",")
}

fn format_vec3_dump(value: Vec3Dump) -> String {
    format!("{:.2},{:.2},{:.2}", value.x, value.y, value.z)
}

fn format_ivec3_dump(value: IVec3Dump) -> String {
    format!("{},{},{}", value.x, value.y, value.z)
}

fn vec3_from_dump(value: Vec3Dump) -> Vec3 {
    Vec3::new(value.x, value.y, value.z)
}

fn ivec3_from_dump(value: IVec3Dump) -> IVec3 {
    IVec3::new(value.x, value.y, value.z)
}

fn expected_surface_y_at(world: &VoxelWorld, x: i32, z: i32, bounds: WorldBounds) -> Option<f32> {
    for y in (bounds.min_world_y..=bounds.max_world_y).rev() {
        let sample = world.sample_voxel_for_collision(IVec3::new(x, y, z));
        if matches!(sample, BoundaryVoxelSample::InBounds(voxel) if voxel.is_solid()) {
            return Some(y as f32 + 1.0);
        }
    }
    None
}

fn highest_render_mesh_hit_at(
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

#[derive(Clone, Copy)]
struct VerticalMeshHit {
    y: f32,
    mesh_section: MeshTriangleSectionProbe,
}

fn cpu_mesh_vertical_ray_hit(
    mesh: &Mesh,
    translation: Vec3,
    world_x: f32,
    world_z: f32,
    origin_y: f32,
) -> Option<f32> {
    cpu_mesh_vertical_ray_hit_with_debug(mesh, translation, world_x, world_z, origin_y, None)
        .map(|hit| hit.y)
}

fn cpu_mesh_vertical_ray_hit_with_debug(
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

enum MeshIndexSlice<'a> {
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

    fn get(&self, index: usize) -> usize {
        match self {
            MeshIndexSlice::U16(indices) => indices[index] as usize,
            MeshIndexSlice::U32(indices) => indices[index] as usize,
        }
    }
}

fn mesh_indices(mesh: &Mesh) -> Option<MeshIndexSlice<'_>> {
    match mesh.indices()? {
        Indices::U16(indices) => Some(MeshIndexSlice::U16(indices)),
        Indices::U32(indices) => Some(MeshIndexSlice::U32(indices)),
    }
}

fn for_each_mesh_triangle_with_indices(
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

fn classify_mesh_triangle_section(
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

fn sample_camera_ray(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    camera_pos: Vec3,
    camera_dir: Vec3,
    max_distance: f32,
) -> CameraRayProbe {
    let dir = camera_dir.normalize_or_zero();
    let mut render_hits: Vec<CameraRayHit> = Vec::new();

    if dir != Vec3::ZERO {
        for (entity, mesh3d, transform, chunk_mesh, terrain_debug, _, _, _, _, _, _, _, _) in
            terrain_entities.iter()
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
                &mut render_hits,
            );
        }
    }

    render_hits.sort_by(|a, b| {
        a.distance
            .partial_cmp(&b.distance)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let first_front_render_hit = render_hits.iter().find(|hit| hit.front_face).cloned();

    let mut first_voxel_solid_distance = None;
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
                last_voxel_solid_distance = Some(traveled);
            }
            traveled += step;
        }
    }

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

    render_hits.truncate(32);

    CameraRayProbe {
        origin: camera_pos.into(),
        direction: dir.into(),
        max_distance,
        first_voxel_solid_distance,
        last_voxel_solid_distance,
        first_front_render_hit,
        render_hits,
        see_through_gap,
    }
}

#[allow(clippy::too_many_arguments)]
fn collect_camera_ray_mesh_hits(
    mesh: &Mesh,
    translation: Vec3,
    origin: Vec3,
    dir: Vec3,
    max_distance: f32,
    entity: Entity,
    chunk_position: IVec3,
    terrain_debug: Option<&TerrainMeshDebug>,
    hits: &mut Vec<CameraRayHit>,
) {
    let _ = for_each_mesh_triangle_with_indices(
        mesh,
        translation,
        |triangle_start_index, indices, p0, p1, p2| {
            if let Some((distance, front_face)) = ray_triangle_hit(origin, dir, p0, p1, p2) {
                if distance <= max_distance {
                    hits.push(CameraRayHit {
                        distance,
                        point: (origin + dir * distance).into(),
                        front_face,
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
                    });
                }
            }
        },
    );
}

fn ray_intersects_chunk_bounds(
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
fn ray_triangle_hit(origin: Vec3, dir: Vec3, p0: Vec3, p1: Vec3, p2: Vec3) -> Option<(f32, bool)> {
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

#[allow(clippy::too_many_arguments)]
fn sample_camera_ray_fan(
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
) -> CameraRayFan {
    const HALF_ANGLE_DEGREES: f32 = 10.0;
    const GRID_SIZE: u32 = 9;

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

fn nearest_chunk_faces(local_point: Vec3) -> Vec<BoundaryDistanceProbe> {
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

fn fan_gap_chunk_state(
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
        .and_then(|(_, _, _, _, terrain_debug, _, _, _, _, _, _, _, _)| terrain_debug);

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

fn sample_neighbor_chunks(
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
                    .and_then(|(_, _, _, _, terrain_debug, _, _, _, _, _, _, _, _)| terrain_debug);

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

fn lod_eval_probe(
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
    let computed_target_lod = current_lod.zip(distance_xz).map(|(current_lod, distance)| {
        water_shore_guarded_lod(
            calculate_target_lod_with_hysteresis(distance, current_lod, lod_settings),
            distance,
            lod_settings,
            water_shore_guarded,
        )
    });
    let effective_mesh_lod_now =
        effective_terrain_mesh_lod_for_chunk(world, chunk_pos, mesh_settings, lod_settings);
    let mesh_lod_mismatch = terrain_debug.map(|debug| {
        current_lod != Some(debug.logical_lod_at_mesh)
            || effective_mesh_lod_now != Some(debug.effective_lod_at_mesh)
    });
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
        water_guard_distance: lod_settings.high_detail_distance
            + WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA,
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

fn lod_mesh_status(mesh_lod_mismatch: Option<bool>, remesh_pending: bool) -> LodMeshStatus {
    match mesh_lod_mismatch {
        Some(false) => LodMeshStatus::Current,
        Some(true) if remesh_pending => LodMeshStatus::RemeshPending,
        Some(true) => LodMeshStatus::Stale,
        None => LodMeshStatus::DebugUnavailable,
    }
}

fn empty_cap_probe(world: &VoxelWorld, chunk_pos: IVec3) -> EmptyCapProbe {
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

fn cap_plane_solid_count(world: &VoxelWorld, chunk_pos: IVec3, local_y: i32) -> u32 {
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

fn entity_probe(entity: Entity, terrain_entities: &TerrainEntityQuery) -> Option<EntityProbe> {
    let (
        entity,
        _mesh3d,
        _transform,
        chunk_mesh,
        terrain_debug,
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

fn write_probe_dump(
    dump: &TerrainHoleProbeDump,
    timestamp: &str,
    output_label: Option<&str>,
) -> std::io::Result<PathBuf> {
    let dir = PathBuf::from("debug");
    fs::create_dir_all(&dir)?;
    let path = match output_label
        .map(sanitize_probe_label)
        .filter(|label| !label.is_empty())
    {
        Some(label) => dir.join(format!("terrain-hole-probe-{label}-{timestamp}.json")),
        None => dir.join(format!("terrain-hole-probe-{timestamp}.json")),
    };
    let json = serde_json::to_string_pretty(dump)?;
    fs::write(&path, json)?;
    Ok(path)
}

fn sanitize_probe_label(label: &str) -> String {
    label
        .chars()
        .filter_map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                Some(ch)
            } else if ch.is_ascii_whitespace() {
                Some('-')
            } else {
                None
            }
        })
        .take(64)
        .collect()
}

fn dirty_reason_names(flags: u8) -> Vec<String> {
    [
        (MeshDirtyReason::Lod, "LOD"),
        (MeshDirtyReason::NeighborLod, "NeighborLOD"),
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

fn lod_string(lod: LodLevel) -> String {
    lod_name(lod).to_string()
}

fn mesh_mode_string(mode: MeshMode) -> String {
    format!("{mode:?}")
}

fn neighbor_lods_probe(neighbor_lods: NeighborLods) -> NeighborLodsProbe {
    NeighborLodsProbe {
        neg_x: neighbor_lods.neg_x.map(lod_string),
        pos_x: neighbor_lods.pos_x.map(lod_string),
        neg_y: neighbor_lods.neg_y.map(lod_string),
        pos_y: neighbor_lods.pos_y.map(lod_string),
        neg_z: neighbor_lods.neg_z.map(lod_string),
        pos_z: neighbor_lods.pos_z.map(lod_string),
    }
}

fn lod_transition_snap_stats_probe(stats: LodTransitionSnapStats) -> LodTransitionSnapStatsProbe {
    LodTransitionSnapStatsProbe {
        snapped_face_mask: stats.snapped_face_mask,
        fallback_face_mask: stats.fallback_face_mask,
        snapped_faces: face_mask_names(stats.snapped_face_mask),
        fallback_faces: face_mask_names(stats.fallback_face_mask),
        snapped_vertex_count: stats.snapped_vertex_count,
        skipped_vertex_count: stats.skipped_vertex_count,
        conflicting_vertex_count: stats.conflicting_vertex_count,
    }
}

fn mc_transvoxel_stats_probe(stats: McTransvoxelStats) -> McTransvoxelStatsProbe {
    McTransvoxelStatsProbe {
        regular_chunks_meshed: stats.regular_chunks_meshed,
        transition_faces_meshed: stats.transition_faces_meshed,
        transition_triangles_total: stats.transition_triangles_total,
        skipped_lod_delta_gt_one: stats.skipped_lod_delta_gt_one,
        skipped_missing_neighbor: stats.skipped_missing_neighbor,
        mesh_generation_ms_total: stats.mesh_generation_ms_total,
        triangle_count_regular: stats.triangle_count_regular,
        triangle_count_transition: stats.triangle_count_transition,
    }
}

fn mesh_section_stats_probe(stats: TerrainMeshSectionStats) -> TerrainMeshSectionStatsProbe {
    TerrainMeshSectionStatsProbe {
        main_surface_vertex_count: stats.main_surface_vertex_count,
        main_surface_index_count: stats.main_surface_index_count,
        transition_apron_index_count: stats.transition_apron_index_count,
        vertical_skirt_index_count: stats.vertical_skirt_index_count,
    }
}

fn face_mask_names(mask: u8) -> Vec<String> {
    [
        (0, "neg_x"),
        (1, "pos_x"),
        (2, "neg_y"),
        (3, "pos_y"),
        (4, "neg_z"),
        (5, "pos_z"),
    ]
    .into_iter()
    .filter_map(|(bit, name)| ((mask & (1 << bit)) != 0).then_some(name.to_string()))
    .collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lod_mesh_status_reports_current_when_lod_tags_match() {
        assert_eq!(lod_mesh_status(Some(false), false), LodMeshStatus::Current);
        assert_eq!(lod_mesh_status(Some(false), true), LodMeshStatus::Current);
    }

    #[test]
    fn lod_mesh_status_separates_pending_remesh_from_stale_mesh() {
        assert_eq!(
            lod_mesh_status(Some(true), true),
            LodMeshStatus::RemeshPending
        );
        assert_eq!(lod_mesh_status(Some(true), false), LodMeshStatus::Stale);
    }

    #[test]
    fn lod_mesh_status_reports_missing_debug_provenance() {
        assert_eq!(
            lod_mesh_status(None, false),
            LodMeshStatus::DebugUnavailable
        );
        assert_eq!(lod_mesh_status(None, true), LodMeshStatus::DebugUnavailable);
    }

    #[test]
    fn scripted_camera_basis_is_orthonormal() {
        let forward = Vec3::new(-0.97716266, -0.02399765, -0.21113348);

        let (right, up) = camera_basis_from_forward(forward);

        assert!((right.length() - 1.0).abs() < 1.0e-5);
        assert!((up.length() - 1.0).abs() < 1.0e-5);
        assert!(right.dot(forward).abs() < 1.0e-5);
        assert!(up.dot(forward).abs() < 1.0e-5);
        assert!(right.dot(up).abs() < 1.0e-5);
    }

    #[test]
    fn probe_output_label_is_filename_safe() {
        assert_eq!(
            sanitize_probe_label("mctx static/mountain hole!"),
            "mctx-staticmountain-hole"
        );
    }
}
