use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use avian3d::prelude::{Collider, RigidBody, SpatialQuery, SpatialQueryFilter};
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::window::PrimaryWindow;
use bevy_mesh::{Indices, VertexAttributeValues};
use serde::{Deserialize, Serialize};

use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE_I32, VOXEL_SIZE};
use crate::interaction::TargetedBlock;
use crate::performance::AreaTimingRecorder;
use crate::physics::{ChunkCollider, NeedsCollider, PhysicsLayer};
use crate::player::{Player, classify_player_world_validity};
use crate::voxel::chunk::{ChunkUniformity, LodLevel, MeshDirtyReason};
use crate::voxel::mc_transvoxel::McTransvoxelStats;
use crate::voxel::meshing::{
    ChunkMesh, LodTransitionSnapStats, McTriangleSource, McTriangleSources, MeshMode, MeshSettings,
    TerrainMeshDebug, TerrainMeshSectionStats, WaterMesh,
    empty_chunk_has_surface_nets_boundary_surface,
};
use crate::voxel::plugin::{
    LodSettings, WATER_SHORE_TERRAIN_LOD_GUARD_EXTRA, calculate_target_lod_with_hysteresis,
    collect_water_shore_lod_guard_chunks, effective_terrain_mesh_lod_for_chunk,
    terrain_lod_distance_xz, terrain_lod_hysteresis, water_shore_guarded_lod,
};
use crate::voxel::skirt::{ChunkFace, NeighborLods};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample as BoundaryVoxelSample, VoxelWorld, WorldBounds};

pub struct TerrainHoleProbePlugin;

const TERRAIN_HOLE_PROBE_SCHEMA_VERSION: u32 = 15;

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
    pub screenshot_path: Option<PathBuf>,
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
    normalized_summary: TerrainHoleProbeSummary,
    active_seam_faces: Vec<SeamFaceProbe>,
    render_entity_checklist: Vec<RenderEntityChecklistProbe>,
    screenshot_overlay_points: Vec<ScreenshotOverlayPointProbe>,
    chunks: Vec<ChunkProbe>,
}

#[derive(Serialize, Default)]
struct TerrainHoleProbeSummary {
    gap_classification_counts: Vec<NamedCountProbe>,
    seam_terrace_counts: Vec<NamedCountProbe>,
    gaps_by_lod_pair: Vec<NamedCountProbe>,
    gaps_by_nearest_face: Vec<NamedCountProbe>,
    max_gap_seam_delta_voxels: Option<f32>,
    max_active_seam_delta_voxels: Option<f32>,
    active_seam_face_count: u32,
    active_seam_faces_with_possible_terrace: u32,
    active_seam_faces_with_open_edges: u32,
    active_seam_faces_with_transition_coverage_gaps: u32,
    chunks_with_skipped_lod_delta_gt_one: Vec<IVec3Dump>,
    stale_or_pending_mesh_chunks: Vec<IVec3Dump>,
    top_suspect_chunks: Vec<ChunkSuspectProbe>,
}

#[derive(Serialize, Clone)]
struct NamedCountProbe {
    name: String,
    count: u32,
}

#[derive(Serialize)]
struct ChunkSuspectProbe {
    chunk_position: IVec3Dump,
    score: u32,
    reasons: Vec<String>,
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
    /// Nearest render-mesh triangle hit, ignoring triangle orientation.
    first_any_render_hit: Option<CameraRayHit>,
    /// Nearest front-facing render-mesh triangle hit.
    first_front_render_hit: Option<CameraRayHit>,
    /// Nearest back-facing render-mesh triangle hit.
    first_backface_render_hit: Option<CameraRayHit>,
    /// First trilinear iso crossing from the exact MC SDF grid for the source chunk.
    first_mesher_iso_distance: Option<f32>,
    first_mesher_iso_point: Option<Vec3Dump>,
    /// Difference between the nearest render hit and mesher iso distance.
    first_any_distance_from_mesher_iso: Option<f32>,
    first_front_distance_from_mesher_iso: Option<f32>,
    mc_cell: Option<McCellOracleProbe>,
    raw_surface_mc_cell: Option<McCellOracleProbe>,
    mesher_iso_mc_cell: Option<McCellOracleProbe>,
    first_render_hit_source: Option<McTriangleSourceProbe>,
    cell_agreement: Option<McCellAgreementProbe>,
    seam_terrace: Option<SeamTerraceProbe>,
    visual_samples: CameraRayVisualSamples,
    gap_classification: GapClassification,
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
    geometric_normal: Vec3Dump,
    normal_dot_ray: f32,
    vertex_normal: Option<Vec3Dump>,
    material_weights: Option<[f32; 4]>,
    chunk_position: Option<IVec3Dump>,
    entity: String,
    mesh_section: MeshTriangleSectionProbe,
    triangle_start_index: u32,
    vertices: Option<[Vec3Dump; 3]>,
    source: Option<McTriangleSourceProbe>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum GapClassification {
    RawOccupancyVsMesherIsoFalsePositive,
    GeometryPresentButShadingOrNormalDarkening,
    SeamTerraceOrLodSurfaceDisplacement,
    BackfaceOrWinding,
    MissingRegularMcGeometry,
    MissingTransitionGeometryOrFaceFrame,
    VertexPositionOrTableDecodeError,
    MissingMeshEntityOrRenderLayer,
    Unknown,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
enum McTriangleSourceProbe {
    Regular {
        chunk_position: IVec3Dump,
        lod: String,
        cell: UVec3Dump,
        case_index: u16,
        class_index: u8,
    },
    Transition {
        chunk_position: IVec3Dump,
        lod: String,
        face: String,
        cell_u: u16,
        cell_v: u16,
        case_index: u16,
        class_index: u8,
        invert: bool,
    },
}

#[derive(Serialize, Clone)]
struct McCellOracleProbe {
    chunk_position: IVec3Dump,
    effective_lod_at_mesh: String,
    neighbor_lods_at_mesh: NeighborLodsProbe,
    cell: UVec3Dump,
    case_index: u16,
    class_index: u8,
    expected_regular_triangle_count: u8,
    actual_regular_triangle_count: Option<u32>,
    boundary_faces: Vec<String>,
    skipped_regular_faces: Vec<String>,
    transition_owner_faces: Vec<String>,
    transition_cells: Vec<McTransitionCellOracleProbe>,
    emitted_regular_triangles: Vec<McEmittedTriangleProbe>,
    emitted_regular_triangles_ray_hit_count: u32,
    nearest_emitted_regular_triangle_ray_hit_distance: Option<f32>,
    closest_emitted_regular_triangle_ray_distance: Option<f32>,
    source_chunk_skipped_lod_delta_gt_one: Option<u32>,
}

#[derive(Serialize, Clone)]
struct McTransitionCellOracleProbe {
    face: String,
    cell_u: u16,
    cell_v: u16,
    case_index: u16,
    class_index: u8,
    expected_triangle_count: u8,
    actual_triangle_count: Option<u32>,
    invert: bool,
    emitted_triangles: Vec<McEmittedTriangleProbe>,
    emitted_triangles_ray_hit_count: u32,
    nearest_emitted_triangle_ray_hit_distance: Option<f32>,
    closest_emitted_triangle_ray_distance: Option<f32>,
}

#[derive(Serialize, Clone)]
struct McEmittedTriangleProbe {
    triangle_start_index: u32,
    vertices: [Vec3Dump; 3],
    ray_hit_distance: Option<f32>,
    front_face: Option<bool>,
    closest_ray_distance: f32,
}

#[derive(Serialize, Clone)]
struct McCellAgreementProbe {
    raw_surface_cell_matches_mesher_iso_cell: Option<bool>,
    mesher_iso_cell_matches_first_render_hit_source: Option<bool>,
    raw_surface_cell_matches_first_render_hit_source: Option<bool>,
    note: String,
}

#[derive(Serialize, Clone)]
struct SeamTerraceProbe {
    sample_point: Vec3Dump,
    threshold_voxels: f32,
    threshold_world: f32,
    pairs: Vec<SeamTerracePairProbe>,
    worst_abs_height_delta: Option<f32>,
    classification: SeamTerraceClassification,
    note: String,
}

#[derive(Serialize, Clone)]
struct SeamTerracePairProbe {
    face: String,
    source_chunk: IVec3Dump,
    neighbor_chunk: IVec3Dump,
    source_lod: String,
    neighbor_lod: String,
    fine_chunk: IVec3Dump,
    coarse_chunk: IVec3Dump,
    fine_lod: String,
    coarse_lod: String,
    fine_sample_point: Vec3Dump,
    coarse_sample_point: Vec3Dump,
    fine_iso_height: Option<f32>,
    coarse_iso_height: Option<f32>,
    signed_height_delta_coarse_minus_fine: Option<f32>,
    abs_height_delta: Option<f32>,
    source_chunk_skipped_lod_delta_gt_one: Option<u32>,
    neighbor_chunk_skipped_lod_delta_gt_one: Option<u32>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
#[serde(rename_all = "snake_case")]
enum SeamTerraceClassification {
    NotNearLodSeam,
    InsufficientData,
    NoTerrace,
    PossibleTerrace,
}

#[derive(Serialize, Clone, Default)]
struct CameraRayVisualSamples {
    raw_surface: Option<VisualPointProbe>,
    mesher_iso: Option<VisualPointProbe>,
    first_any_render_hit: Option<VisualPointProbe>,
    first_front_render_hit: Option<VisualPointProbe>,
}

#[derive(Serialize, Clone)]
struct VisualPointProbe {
    world_point: Vec3Dump,
    screen_position: Option<Vec2Dump>,
    screenshot_path: Option<String>,
    pixel: Option<RgbaProbe>,
    pixel_window: Option<VisualPixelWindowProbe>,
    nearby_pixel_window: Option<VisualPixelWindowProbe>,
    classification: VisualPixelClassification,
    note: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum VisualPixelClassification {
    LitOrNonDark,
    DarkOrMissing,
    SkyOrBackground,
    Offscreen,
    ScreenshotUnavailable,
    ProjectionUnavailable,
}

#[derive(Serialize, Clone, Copy)]
struct RgbaProbe {
    r: u8,
    g: u8,
    b: u8,
    a: u8,
    luminance: f32,
}

#[derive(Serialize, Clone, Copy)]
struct VisualPixelWindowProbe {
    radius_px: u32,
    sampled_pixels: u32,
    dark_or_missing_pixels: u32,
    sky_or_background_pixels: u32,
    bright_pixels: u32,
    lit_or_non_dark_pixels: u32,
    min_luminance: f32,
    max_luminance: f32,
    luminance_range: f32,
    mean_luminance: f32,
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
    first_any_render_hit_distance: Option<f32>,
    first_backface_render_hit_distance: Option<f32>,
    first_mesher_iso_distance: Option<f32>,
    first_mesher_iso_point: Option<Vec3Dump>,
    first_any_distance_from_mesher_iso: Option<f32>,
    first_front_distance_from_mesher_iso: Option<f32>,
    gap_classification: GapClassification,
    mc_cell: Option<McCellOracleProbe>,
    raw_surface_mc_cell: Option<McCellOracleProbe>,
    mesher_iso_mc_cell: Option<McCellOracleProbe>,
    first_render_hit_source: Option<McTriangleSourceProbe>,
    cell_agreement: Option<McCellAgreementProbe>,
    seam_terrace: Option<SeamTerraceProbe>,
    visual_samples: CameraRayVisualSamples,
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
struct SeamFaceProbe {
    source_chunk: IVec3Dump,
    neighbor_chunk: IVec3Dump,
    face: String,
    source_lod: String,
    neighbor_lod: String,
    fine_chunk: IVec3Dump,
    coarse_chunk: IVec3Dump,
    fine_lod: String,
    coarse_lod: String,
    source_mesh_status: LodMeshStatus,
    neighbor_mesh_status: LodMeshStatus,
    source_generated_frame: Option<u32>,
    neighbor_generated_frame: Option<u32>,
    same_generated_frame_as_neighbor: Option<bool>,
    source_dirty_reasons: Vec<String>,
    neighbor_dirty_reasons: Vec<String>,
    source_render_entity: Option<RenderEntityChecklistProbe>,
    neighbor_render_entity: Option<RenderEntityChecklistProbe>,
    transition_owner: bool,
    skipped_regular_boundary_row: bool,
    lod_delta_gt_one: bool,
    source_chunk_skipped_lod_delta_gt_one: Option<u32>,
    neighbor_chunk_skipped_lod_delta_gt_one: Option<u32>,
    samples: Vec<SeamFaceSampleProbe>,
    sample_grid_u: u32,
    sample_grid_v: u32,
    sample_count: u32,
    possible_terrace_sample_count: u32,
    missing_render_coverage_sample_count: u32,
    max_abs_height_delta: Option<f32>,
    median_abs_height_delta: Option<f32>,
    max_abs_face_offset_delta: Option<f32>,
    median_abs_face_offset_delta: Option<f32>,
    transition_coverage: TransitionCoverageProbe,
    boundary_edges: BoundaryEdgeLeakProbe,
}

#[derive(Serialize)]
struct SeamFaceSampleProbe {
    sample_index: u32,
    face_u: f32,
    face_v: f32,
    seam_point: Vec3Dump,
    screen_position: Option<Vec2Dump>,
    fine_iso_height: Option<f32>,
    coarse_iso_height: Option<f32>,
    signed_height_delta_coarse_minus_fine: Option<f32>,
    abs_height_delta: Option<f32>,
    fine_face_iso_offset: Option<f32>,
    coarse_face_iso_offset: Option<f32>,
    signed_face_offset_delta_coarse_minus_fine: Option<f32>,
    abs_face_offset_delta: Option<f32>,
    render_hit_y: Option<f32>,
    render_hit_chunk: Option<IVec3Dump>,
    render_hit_entity: Option<String>,
    render_hit_mesh_section: Option<MeshTriangleSectionProbe>,
    render_distance_from_fine_iso: Option<f32>,
    render_distance_from_coarse_iso: Option<f32>,
    render_face_offset: Option<f32>,
    render_face_hit_point: Option<Vec3Dump>,
    render_face_hit_chunk: Option<IVec3Dump>,
    render_face_hit_entity: Option<String>,
    render_face_hit_mesh_section: Option<MeshTriangleSectionProbe>,
    render_distance_from_fine_face_iso: Option<f32>,
    render_distance_from_coarse_face_iso: Option<f32>,
    has_render_coverage_near_either_iso: bool,
    visual: VisualPointProbe,
}

#[derive(Serialize)]
struct TransitionCoverageProbe {
    skipped_regular_face: bool,
    transition_owner: bool,
    actual_transition_triangle_count: Option<u32>,
    actual_transition_cell_count: Option<u32>,
    sample_count: u32,
    samples_without_render_coverage: u32,
    samples_without_transition_render_coverage: u32,
    coverage_note: String,
}

#[derive(Serialize)]
struct BoundaryEdgeLeakProbe {
    inspected_triangle_count: u32,
    seam_edge_count: u32,
    unmatched_seam_edge_count: u32,
    unmatched_transition_edge_count: u32,
    unmatched_regular_edge_count: u32,
    longest_unmatched_edge: Option<f32>,
    examples: Vec<BoundaryEdgeExampleProbe>,
}

#[derive(Serialize)]
struct BoundaryEdgeExampleProbe {
    start: Vec3Dump,
    end: Vec3Dump,
    length: f32,
    source: Option<McTriangleSourceProbe>,
}

#[derive(Serialize, Clone)]
struct RenderEntityChecklistProbe {
    chunk_position: IVec3Dump,
    mesh_entity_from_world: Option<String>,
    entity_query_found: bool,
    mesh_handle_present: bool,
    mesh_asset_loaded: bool,
    position_attribute_present: bool,
    normal_attribute_present: bool,
    index_buffer_present: bool,
    vertex_count: Option<u32>,
    triangle_count: Option<u32>,
    chunk_mesh_component_present: bool,
    terrain_debug_present: bool,
    visibility: Option<String>,
    inherited_visibility: Option<bool>,
    view_visibility: Option<bool>,
    visible_to_render: Option<bool>,
    mesh_mode_at_component: Option<String>,
    target_mode_at_mesh: Option<String>,
    current_lod: Option<String>,
    logical_lod_at_mesh: Option<String>,
    effective_lod_at_mesh: Option<String>,
    generated_frame: Option<u32>,
    dirty: Option<bool>,
    dirty_reasons: Vec<String>,
    mesh_status: LodMeshStatus,
}

#[derive(Serialize)]
struct ScreenshotOverlayPointProbe {
    label: String,
    world_point: Vec3Dump,
    screen_position: Option<Vec2Dump>,
    classification: VisualPixelClassification,
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

#[derive(Serialize, Clone)]
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

#[derive(Serialize, Clone, Copy)]
struct Vec2Dump {
    x: f32,
    y: f32,
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

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
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
        Option<&'static McTriangleSources>,
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

struct VisualProbeContext<'a> {
    camera_pos: Vec3,
    camera_forward: Vec3,
    camera_right: Vec3,
    camera_up: Vec3,
    projection: &'a Projection,
    window_size: Option<Vec2>,
    image: Option<&'a ProbeImage>,
    screenshot_path: Option<&'a PathBuf>,
}

struct ProbeImage {
    path: PathBuf,
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[derive(Deserialize)]
struct TerrainDebugCaptureSidecarProbe {
    camera_pos: [f32; 3],
    camera_rot: Option<[f32; 4]>,
}

const TERRAIN_DEBUG_CAPTURE_MAX_AGE_SECS: u64 = 10 * 60;
const TERRAIN_DEBUG_CAPTURE_CAMERA_EPSILON: f32 = 0.75;
const TERRAIN_DEBUG_CAPTURE_CAMERA_FORWARD_DOT_MIN: f32 = 0.999;

#[allow(clippy::too_many_arguments)]
fn dump_terrain_hole_probe(
    keys: Res<ButtonInput<KeyCode>>,
    mut requests: ResMut<TerrainHoleProbeRequests>,
    world: Res<VoxelWorld>,
    targeted: Res<TargetedBlock>,
    player_query: Query<&GlobalTransform, With<Player>>,
    camera_query: Query<(&GlobalTransform, &Projection), (With<PlayerCamera>, Without<Player>)>,
    window_query: Query<&Window, With<PrimaryWindow>>,
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
                .map(|(transform, _)| transform.translation())
        })
        .unwrap_or(Vec3::ZERO);
    let player_pos = request
        .and_then(|request| request.player_world_position)
        .unwrap_or(player_pos);
    let camera_transform = camera_query.single().ok();
    let camera_pos = request
        .and_then(|request| request.camera_world_position)
        .or_else(|| camera_transform.map(|(transform, _)| transform.translation()));
    let camera_dir = request
        .and_then(|request| request.camera_direction)
        .map(Vec3::normalize_or_zero)
        .or_else(|| camera_transform.map(|(transform, _)| transform.forward().as_vec3()));
    let (scripted_right, scripted_up) = camera_dir
        .filter(|_| request.is_some())
        .map(camera_basis_from_forward)
        .unwrap_or((Vec3::ZERO, Vec3::ZERO));
    let camera_right = if request.is_some() {
        Some(scripted_right)
    } else {
        camera_transform.map(|(transform, _)| transform.right().as_vec3())
    };
    let camera_up = if request.is_some() {
        Some(scripted_up)
    } else {
        camera_transform.map(|(transform, _)| transform.up().as_vec3())
    };
    let explicit_visual_image_path = request.and_then(|request| request.screenshot_path.clone());
    let visual_image_path = explicit_visual_image_path
        .clone()
        .or_else(|| latest_matching_terrain_debug_screenshot(camera_pos, camera_dir));
    if explicit_visual_image_path.is_none() {
        if let Some(path) = visual_image_path.as_ref() {
            info!(
                "Terrain hole probe using latest matching terrain debug screenshot {}",
                path.display()
            );
        }
    }
    let visual_image = visual_image_path
        .as_deref()
        .and_then(load_probe_image)
        .inspect(|image| {
            debug!(
                "Terrain hole probe loaded screenshot {} ({}x{}) for visual samples",
                image.path.display(),
                image.width,
                image.height
            );
        });
    let window_size = window_query
        .single()
        .ok()
        .map(|window| Vec2::new(window.resolution.width(), window.resolution.height()));
    let visual_context = camera_pos
        .zip(camera_dir)
        .zip(camera_right)
        .zip(camera_up)
        .and_then(|(((pos, forward), right), up)| {
            let projection = camera_transform.map(|(_, projection)| projection)?;
            Some(VisualProbeContext {
                camera_pos: pos,
                camera_forward: forward.normalize_or_zero(),
                camera_right: right.normalize_or_zero(),
                camera_up: up.normalize_or_zero(),
                projection,
                window_size,
                image: visual_image.as_ref(),
                screenshot_path: visual_image_path.as_ref(),
            })
        });
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
            visual_context.as_ref(),
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
            visual_context.as_ref(),
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
            let terrace_gaps: Vec<&FanGap> = fan
                .gaps
                .iter()
                .filter(|gap| {
                    gap.seam_terrace.as_ref().is_some_and(|terrace| {
                        terrace.classification == SeamTerraceClassification::PossibleTerrace
                    })
                })
                .collect();
            if !terrace_gaps.is_empty() {
                let max_delta = terrace_gaps
                    .iter()
                    .filter_map(|gap| {
                        gap.seam_terrace
                            .as_ref()
                            .and_then(|terrace| terrace.worst_abs_height_delta)
                    })
                    .fold(0.0_f32, f32::max);
                info!(
                    "Camera-ray fan: {} gap rays report possible seam terraces; max paired fine/coarse iso height delta {:.2} voxels",
                    terrace_gaps.len(),
                    max_delta,
                );
            }
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
    let active_seam_faces = sample_active_seam_faces(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        camera_ray_fan.as_ref(),
        visual_context.as_ref(),
        camera_pos,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
    let render_entity_checklist = render_entity_checklist_for_probe(
        &world,
        &terrain_entities,
        &meshes,
        target_chunk,
        camera_ray_fan.as_ref(),
        &active_seam_faces,
        camera_pos,
        &mesh_settings,
        &lod_settings,
        &water_lod_guard_chunks,
    );
    let normalized_summary = normalized_probe_summary(
        camera_ray_fan.as_ref(),
        &active_seam_faces,
        &render_entity_checklist,
    );
    let screenshot_overlay_points = screenshot_overlay_points(
        camera_ray.as_ref(),
        camera_ray_fan.as_ref(),
        &active_seam_faces,
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
        normalized_summary,
        active_seam_faces,
        render_entity_checklist,
        screenshot_overlay_points,
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
fn nearest_render_mesh_hit_along_ray(
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
struct VerticalMeshHit {
    y: f32,
    mesh_section: MeshTriangleSectionProbe,
}

#[cfg(feature = "mc_transvoxel")]
struct CompactMeshRayHit {
    distance: f32,
    point: Vec3,
    chunk: IVec3Dump,
    entity: String,
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
fn collect_camera_ray_mesh_hits(
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

fn average_mesh_normal(mesh: &Mesh, indices: [usize; 3]) -> Option<Vec3> {
    let Some(VertexAttributeValues::Float32x3(normals)) = mesh.attribute(Mesh::ATTRIBUTE_NORMAL)
    else {
        return None;
    };
    let n0 = Vec3::from_array(*normals.get(indices[0])?);
    let n1 = Vec3::from_array(*normals.get(indices[1])?);
    let n2 = Vec3::from_array(*normals.get(indices[2])?);
    Some((n0 + n1 + n2).normalize_or_zero())
}

fn average_mesh_material_weights(mesh: &Mesh, indices: [usize; 3]) -> Option<[f32; 4]> {
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

fn mc_triangle_source_probe(source: &McTriangleSource) -> McTriangleSourceProbe {
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

struct McGapForensics {
    first_mesher_iso_distance: Option<f32>,
    first_mesher_iso_point: Option<Vec3>,
    mc_cell: Option<McCellOracleProbe>,
    raw_surface_mc_cell: Option<McCellOracleProbe>,
    mesher_iso_mc_cell: Option<McCellOracleProbe>,
    first_render_hit_source: Option<McTriangleSourceProbe>,
    cell_agreement: Option<McCellAgreementProbe>,
    seam_terrace: Option<SeamTerraceProbe>,
}

#[cfg(feature = "mc_transvoxel")]
fn mc_forensics_for_gap(
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
fn mc_forensics_for_gap(
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
struct McSdfGridProbe {
    chunk_position: IVec3,
    lod: LodLevel,
    neighbor_lods: NeighborLods,
    padded: usize,
    values: Vec<f32>,
    step: i32,
    source_chunk_skipped_lod_delta_gt_one: Option<u32>,
}

#[cfg(feature = "mc_transvoxel")]
#[derive(Clone, Copy)]
struct McSdfRaySample {
    distance: f32,
    value: f32,
    chunk_position: IVec3,
}

#[cfg(feature = "mc_transvoxel")]
struct MesherIsoHit {
    distance: f32,
    point: Vec3,
    chunk_position: IVec3,
}

#[cfg(feature = "mc_transvoxel")]
fn build_mc_sdf_grid_probe(
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
fn mc_sdf_sample_multi_chunk(
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
fn first_mesher_iso_multi_chunk(
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
fn seam_terrace_probe_for_point(
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
fn distance_to_chunk_face(local: Vec3, face: ChunkFace) -> f32 {
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
fn project_point_to_chunk_face(point: Vec3, chunk_origin: Vec3, face: ChunkFace) -> Vec3 {
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
fn neighbor_lod_for_probe_face(neighbor_lods: &NeighborLods, face: ChunkFace) -> Option<LodLevel> {
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
fn highest_vertical_iso_height_in_grid(
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
fn sample_active_seam_faces(
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
fn sample_active_seam_faces(
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
fn probe_candidate_chunks(
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
fn seam_face_samples(
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
fn normalized_grid_coord(index: u32, count: u32) -> f32 {
    if count <= 1 {
        0.5
    } else {
        index as f32 / (count - 1) as f32
    }
}

#[cfg(feature = "mc_transvoxel")]
fn seam_face_sample_point(chunk_origin: Vec3, face: ChunkFace, face_u: f32, face_v: f32) -> Vec3 {
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
fn nearest_face_normal_iso_offset_in_grid(
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
fn seam_sample_displacement_delta(sample: &SeamFaceSampleProbe) -> Option<f32> {
    sample.abs_face_offset_delta.or(sample.abs_height_delta)
}

#[cfg(feature = "mc_transvoxel")]
fn transition_coverage_probe(
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
fn boundary_edge_leak_probe(
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
fn collect_boundary_edges_for_chunk(
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
struct BoundaryEdgeAccum {
    source: Option<McTriangleSourceProbe>,
    start: Vec3,
    end: Vec3,
    length: f32,
    transition: bool,
}

#[cfg(feature = "mc_transvoxel")]
fn edge_has_opposite_side_coverage(edge: &BoundaryEdgeAccum, edges: &[BoundaryEdgeAccum]) -> bool {
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
fn edge_overlap_interval(
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
fn point_line_distance(point: Vec3, line_origin: Vec3, line_dir: Vec3) -> f32 {
    let to_point = point - line_origin;
    (to_point - line_dir * to_point.dot(line_dir)).length()
}

#[cfg(feature = "mc_transvoxel")]
fn source_touches_face(source: &McTriangleSource, chunk_pos: IVec3, face: ChunkFace) -> bool {
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
fn edge_lies_on_chunk_face(a: Vec3, b: Vec3, chunk_pos: IVec3, face: ChunkFace) -> bool {
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
fn terrain_mesh_and_sources_for_chunk<'a>(
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
fn terrain_triangle_sources_for_chunk<'a>(
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
fn median_sorted(values: &[f32]) -> Option<f32> {
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

#[cfg(feature = "mc_transvoxel")]
fn mc_cell_oracle_for_point(
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
fn source_matches_regular_cell(source: &McTriangleSource, chunk_pos: IVec3, cell: UVec3) -> bool {
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
fn source_matches_transition_cell(
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
fn collect_emitted_triangle_evidence(
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
fn mesh_triangle_vertices(
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
fn emitted_triangle_probe(
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
fn nearest_triangle_hit_distance(triangles: &[McEmittedTriangleProbe]) -> Option<f32> {
    triangles
        .iter()
        .filter_map(|triangle| triangle.ray_hit_distance)
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
}

#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
fn closest_triangle_ray_distance(triangles: &[McEmittedTriangleProbe]) -> Option<f32> {
    triangles
        .iter()
        .map(|triangle| triangle.closest_ray_distance)
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
}

#[cfg_attr(not(any(feature = "mc_transvoxel", test)), allow(dead_code))]
fn closest_sampled_triangle_ray_distance(origin: Vec3, dir: Vec3, vertices: [Vec3; 3]) -> f32 {
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
fn point_to_ray_distance(point: Vec3, origin: Vec3, dir: Vec3) -> f32 {
    let dir = dir.normalize_or_zero();
    if dir == Vec3::ZERO {
        return f32::INFINITY;
    }
    let to_point = point - origin;
    let along = to_point.dot(dir).max(0.0);
    (to_point - dir * along).length()
}

#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
fn mc_cell_agreement(
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
fn mc_cells_same(a: &McCellOracleProbe, b: &McCellOracleProbe) -> bool {
    a.chunk_position == b.chunk_position && a.cell == b.cell
}

#[cfg_attr(not(any(feature = "mc_transvoxel", test)), allow(dead_code))]
fn mc_source_matches_cell_probe(source: &McTriangleSourceProbe, cell: &McCellOracleProbe) -> bool {
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

fn load_probe_image(path: &Path) -> Option<ProbeImage> {
    let image = image::ImageReader::open(path)
        .ok()?
        .decode()
        .ok()?
        .to_rgba8();
    let (width, height) = image.dimensions();
    Some(ProbeImage {
        path: path.to_path_buf(),
        width,
        height,
        pixels: image.into_raw(),
    })
}

fn latest_matching_terrain_debug_screenshot(
    camera_pos: Option<Vec3>,
    camera_forward: Option<Vec3>,
) -> Option<PathBuf> {
    latest_matching_terrain_debug_screenshot_in_dir(Path::new("debug"), camera_pos, camera_forward)
}

fn latest_matching_terrain_debug_screenshot_in_dir(
    output_dir: &Path,
    camera_pos: Option<Vec3>,
    camera_forward: Option<Vec3>,
) -> Option<PathBuf> {
    let camera_pos = camera_pos?;
    let camera_forward = camera_forward?.normalize_or_zero();
    if camera_forward == Vec3::ZERO {
        return None;
    }
    let mut candidates = fs::read_dir(output_dir)
        .ok()?
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            let file_name = path.file_name()?.to_str()?;
            if !file_name.starts_with("wireframe-") || path.extension()?.to_str()? != "json" {
                return None;
            }
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((path, modified))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|a, b| b.1.cmp(&a.1));

    let now = SystemTime::now();
    for (sidecar_path, modified) in candidates.into_iter().take(20) {
        if let Ok(age) = now.duration_since(modified) {
            if age.as_secs() > TERRAIN_DEBUG_CAPTURE_MAX_AGE_SECS {
                continue;
            }
        }
        let Some(sidecar) = read_terrain_debug_capture_sidecar(&sidecar_path) else {
            continue;
        };
        let capture_camera_pos = Vec3::from_array(sidecar.camera_pos);
        if capture_camera_pos.distance(camera_pos) > TERRAIN_DEBUG_CAPTURE_CAMERA_EPSILON {
            continue;
        }
        if !terrain_debug_capture_matches_camera_forward(&sidecar, camera_forward) {
            continue;
        }
        let png_path = sidecar_path.with_extension("png");
        if png_path.is_file() {
            return Some(png_path);
        }
    }
    None
}

fn read_terrain_debug_capture_sidecar(path: &Path) -> Option<TerrainDebugCaptureSidecarProbe> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn terrain_debug_capture_matches_camera_forward(
    sidecar: &TerrainDebugCaptureSidecarProbe,
    camera_forward: Vec3,
) -> bool {
    let Some(capture_forward) = terrain_debug_capture_forward(sidecar) else {
        return false;
    };
    capture_forward.dot(camera_forward) >= TERRAIN_DEBUG_CAPTURE_CAMERA_FORWARD_DOT_MIN
}

fn terrain_debug_capture_forward(sidecar: &TerrainDebugCaptureSidecarProbe) -> Option<Vec3> {
    let [x, y, z, w] = sidecar.camera_rot?;
    let len_sq = x * x + y * y + z * z + w * w;
    if !len_sq.is_finite() || len_sq <= f32::EPSILON {
        return None;
    }
    let inv_len = len_sq.sqrt().recip();
    let rotation = Quat::from_xyzw(x * inv_len, y * inv_len, z * inv_len, w * inv_len);
    let forward = (rotation * Vec3::NEG_Z).normalize_or_zero();
    (forward != Vec3::ZERO).then_some(forward)
}

fn visual_samples_for_camera_ray(
    context: Option<&VisualProbeContext>,
    raw_surface_point: Option<Vec3>,
    mesher_iso_point: Option<Vec3>,
    first_any: Option<&CameraRayHit>,
    first_front: Option<&CameraRayHit>,
) -> CameraRayVisualSamples {
    CameraRayVisualSamples {
        raw_surface: raw_surface_point.map(|point| visual_point_probe(context, point)),
        mesher_iso: mesher_iso_point.map(|point| visual_point_probe(context, point)),
        first_any_render_hit: first_any
            .map(|hit| visual_point_probe(context, vec3_from_dump(hit.point))),
        first_front_render_hit: first_front
            .map(|hit| visual_point_probe(context, vec3_from_dump(hit.point))),
    }
}

fn visual_point_probe(context: Option<&VisualProbeContext>, point: Vec3) -> VisualPointProbe {
    const VISUAL_PIXEL_WINDOW_RADIUS_PX: u32 = 4;
    const VISUAL_NEARBY_PIXEL_WINDOW_RADIUS_PX: u32 = 18;
    let Some(context) = context else {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: None,
            screenshot_path: None,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::ProjectionUnavailable,
            note: "camera projection context was unavailable".to_string(),
        };
    };
    let screenshot_path = context
        .screenshot_path
        .map(|path| path.display().to_string());
    let Some((screen_position, target_size)) = project_world_point_to_screen(context, point) else {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: None,
            screenshot_path,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::ProjectionUnavailable,
            note: "point could not be projected with the active camera projection".to_string(),
        };
    };
    let screen_dump = Vec2Dump {
        x: screen_position.x,
        y: screen_position.y,
    };
    if screen_position.x < 0.0
        || screen_position.y < 0.0
        || screen_position.x >= target_size.x
        || screen_position.y >= target_size.y
    {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: Some(screen_dump),
            screenshot_path,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::Offscreen,
            note: "projected point is outside the screenshot".to_string(),
        };
    }
    let Some(image) = context.image else {
        return VisualPointProbe {
            world_point: point.into(),
            screen_position: Some(screen_dump),
            screenshot_path,
            pixel: None,
            pixel_window: None,
            nearby_pixel_window: None,
            classification: VisualPixelClassification::ScreenshotUnavailable,
            note: "screenshot was not available when the probe ran".to_string(),
        };
    };
    let pixel = sample_probe_image(image, screen_position);
    let pixel_window =
        sample_probe_image_window(image, screen_position, VISUAL_PIXEL_WINDOW_RADIUS_PX);
    let nearby_pixel_window =
        sample_probe_image_window(image, screen_position, VISUAL_NEARBY_PIXEL_WINDOW_RADIUS_PX);
    let classification = pixel
        .map(classify_visual_pixel)
        .unwrap_or(VisualPixelClassification::Offscreen);
    VisualPointProbe {
        world_point: point.into(),
        screen_position: Some(screen_dump),
        screenshot_path,
        pixel,
        pixel_window,
        nearby_pixel_window,
        classification,
        note: "sampled screenshot pixel plus local and nearby pixel windows at the projected probe point"
            .to_string(),
    }
}

fn project_world_point_to_screen(
    context: &VisualProbeContext,
    point: Vec3,
) -> Option<(Vec2, Vec2)> {
    let target_size = context
        .image
        .map(|image| Vec2::new(image.width as f32, image.height as f32))
        .or(context.window_size)?;
    if target_size.x <= 0.0 || target_size.y <= 0.0 {
        return None;
    }
    match context.projection {
        Projection::Perspective(perspective) => {
            let to_point = point - context.camera_pos;
            let depth = to_point.dot(context.camera_forward);
            if depth <= 1.0e-4 {
                return None;
            }
            let aspect = target_size.x / target_size.y;
            let half_height = depth * (perspective.fov * 0.5).tan();
            let half_width = half_height * aspect;
            if half_height <= f32::EPSILON || half_width <= f32::EPSILON {
                return None;
            }
            let ndc_x = to_point.dot(context.camera_right) / half_width;
            let ndc_y = to_point.dot(context.camera_up) / half_height;
            Some((
                Vec2::new(
                    (ndc_x + 1.0) * 0.5 * target_size.x,
                    (1.0 - ndc_y) * 0.5 * target_size.y,
                ),
                target_size,
            ))
        }
        Projection::Orthographic(orthographic) => {
            let area = orthographic.area;
            let to_point = point - context.camera_pos;
            let x = to_point.dot(context.camera_right);
            let y = to_point.dot(context.camera_up);
            let ndc_x = ((x - area.min.x) / (area.max.x - area.min.x)) * 2.0 - 1.0;
            let ndc_y = ((y - area.min.y) / (area.max.y - area.min.y)) * 2.0 - 1.0;
            Some((
                Vec2::new(
                    (ndc_x + 1.0) * 0.5 * target_size.x,
                    (1.0 - ndc_y) * 0.5 * target_size.y,
                ),
                target_size,
            ))
        }
        Projection::Custom(_) => None,
    }
}

fn sample_probe_image(image: &ProbeImage, screen_position: Vec2) -> Option<RgbaProbe> {
    let x = screen_position.x.floor() as i32;
    let y = screen_position.y.floor() as i32;
    if x < 0 || y < 0 || x >= image.width as i32 || y >= image.height as i32 {
        return None;
    }
    let index = ((y as u32 * image.width + x as u32) * 4) as usize;
    let r = *image.pixels.get(index)?;
    let g = *image.pixels.get(index + 1)?;
    let b = *image.pixels.get(index + 2)?;
    let a = *image.pixels.get(index + 3)?;
    Some(RgbaProbe {
        r,
        g,
        b,
        a,
        luminance: pixel_luminance(r, g, b),
    })
}

fn sample_probe_image_window(
    image: &ProbeImage,
    screen_position: Vec2,
    radius_px: u32,
) -> Option<VisualPixelWindowProbe> {
    let center_x = screen_position.x.floor() as i32;
    let center_y = screen_position.y.floor() as i32;
    if center_x < 0
        || center_y < 0
        || center_x >= image.width as i32
        || center_y >= image.height as i32
    {
        return None;
    }

    let radius = radius_px as i32;
    let mut sampled_pixels = 0u32;
    let mut dark_or_missing_pixels = 0u32;
    let mut sky_or_background_pixels = 0u32;
    let mut bright_pixels = 0u32;
    let mut lit_or_non_dark_pixels = 0u32;
    let mut min_luminance = f32::INFINITY;
    let mut max_luminance = f32::NEG_INFINITY;
    let mut luminance_sum = 0.0f32;

    for y in (center_y - radius)..=(center_y + radius) {
        for x in (center_x - radius)..=(center_x + radius) {
            if x < 0 || y < 0 || x >= image.width as i32 || y >= image.height as i32 {
                continue;
            }
            let Some(pixel) = sample_probe_image(image, Vec2::new(x as f32, y as f32)) else {
                continue;
            };
            sampled_pixels = sampled_pixels.saturating_add(1);
            min_luminance = min_luminance.min(pixel.luminance);
            max_luminance = max_luminance.max(pixel.luminance);
            luminance_sum += pixel.luminance;
            if pixel.luminance >= 0.80 {
                bright_pixels = bright_pixels.saturating_add(1);
            }
            match classify_visual_pixel(pixel) {
                VisualPixelClassification::DarkOrMissing => {
                    dark_or_missing_pixels = dark_or_missing_pixels.saturating_add(1);
                }
                VisualPixelClassification::SkyOrBackground => {
                    sky_or_background_pixels = sky_or_background_pixels.saturating_add(1);
                }
                VisualPixelClassification::LitOrNonDark => {
                    lit_or_non_dark_pixels = lit_or_non_dark_pixels.saturating_add(1);
                }
                VisualPixelClassification::Offscreen
                | VisualPixelClassification::ScreenshotUnavailable
                | VisualPixelClassification::ProjectionUnavailable => {}
            }
        }
    }

    if sampled_pixels == 0 {
        return None;
    }

    Some(VisualPixelWindowProbe {
        radius_px,
        sampled_pixels,
        dark_or_missing_pixels,
        sky_or_background_pixels,
        bright_pixels,
        lit_or_non_dark_pixels,
        min_luminance,
        max_luminance,
        luminance_range: max_luminance - min_luminance,
        mean_luminance: luminance_sum / sampled_pixels as f32,
    })
}

fn pixel_luminance(r: u8, g: u8, b: u8) -> f32 {
    (0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32) / 255.0
}

fn classify_visual_pixel(pixel: RgbaProbe) -> VisualPixelClassification {
    if pixel.a < 8 || pixel.luminance < 0.08 {
        VisualPixelClassification::DarkOrMissing
    } else if pixel.b > pixel.r.saturating_add(24)
        && pixel.b > pixel.g.saturating_add(8)
        && pixel.luminance > 0.35
    {
        VisualPixelClassification::SkyOrBackground
    } else {
        VisualPixelClassification::LitOrNonDark
    }
}

fn visual_samples_have_dark_geometry(samples: &CameraRayVisualSamples) -> bool {
    [
        samples.mesher_iso.as_ref(),
        samples.first_any_render_hit.as_ref(),
        samples.first_front_render_hit.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|sample| sample.classification == VisualPixelClassification::DarkOrMissing)
}

fn visual_samples_confirm_non_dark(samples: &CameraRayVisualSamples) -> bool {
    [
        samples.mesher_iso.as_ref(),
        samples.first_any_render_hit.as_ref(),
        samples.first_front_render_hit.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|sample| sample.classification == VisualPixelClassification::LitOrNonDark)
}

fn visual_samples_show_background(samples: &CameraRayVisualSamples) -> bool {
    [
        samples.mesher_iso.as_ref(),
        samples.first_any_render_hit.as_ref(),
        samples.first_front_render_hit.as_ref(),
    ]
    .into_iter()
    .flatten()
    .any(|sample| {
        sample.classification == VisualPixelClassification::SkyOrBackground
            || sample.pixel_window.is_some_and(|window| {
                window.sky_or_background_pixels > 0
                    || window.bright_pixels > 0
                    || window.luminance_range > 0.45
            })
            || sample.nearby_pixel_window.is_some_and(|window| {
                window.sky_or_background_pixels > 0
                    || window.bright_pixels > 0
                    || window.luminance_range > 0.50
            })
    })
}

fn classify_camera_gap(
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

fn hit_has_shading_or_normal_anomaly(hit: &CameraRayHit) -> bool {
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

#[cfg(feature = "mc_transvoxel")]
fn mesher_iso_crossing_between_samples(
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
fn first_mesher_iso_in_sdf_grid(
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
fn sample_mc_sdf_trilinear(
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
fn mc_cell_for_point(
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
fn regular_case_index(values: &[f32], padded: usize, cell: [usize; 3]) -> usize {
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
fn boundary_faces_for_cell(cell: [usize; 3], subdivisions: usize) -> Vec<ChunkFace> {
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
fn transition_cell_for_regular_cell(
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
fn transition_case_index(
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
struct ProbeHighResDelta {
    u: isize,
    v: isize,
}

#[cfg(feature = "mc_transvoxel")]
const PROBE_HIGH_RES_FACE_GRID: [ProbeHighResDelta; 9] = [
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
const PROBE_HIGH_RES_CASE_BITS: [usize; 9] =
    [0x01, 0x02, 0x04, 0x80, 0x100, 0x08, 0x40, 0x20, 0x10];

#[cfg(feature = "mc_transvoxel")]
struct ProbeFaceFrame {
    w_axis: u8,
    w_sign: i32,
    u_axis: u8,
    u_sign: i32,
    v_axis: u8,
    v_sign: i32,
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

fn chunk_face_name(face: ChunkFace) -> &'static str {
    match face {
        ChunkFace::NegX => "neg_x",
        ChunkFace::PosX => "pos_x",
        ChunkFace::NegY => "neg_y",
        ChunkFace::PosY => "pos_y",
        ChunkFace::NegZ => "neg_z",
        ChunkFace::PosZ => "pos_z",
    }
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
fn render_entity_checklist_for_probe(
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

fn normalized_probe_summary(
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
        .filter(|check| check.mesh_status != LodMeshStatus::Current)
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
        top_suspect_chunks,
    }
}

fn screenshot_overlay_points(
    camera_ray: Option<&CameraRayProbe>,
    camera_ray_fan: Option<&CameraRayFan>,
    active_seam_faces: &[SeamFaceProbe],
) -> Vec<ScreenshotOverlayPointProbe> {
    let mut points = Vec::new();
    if let Some(ray) = camera_ray {
        push_visual_overlay_point(
            &mut points,
            "center.raw_surface",
            ray.visual_samples.raw_surface.as_ref(),
        );
        push_visual_overlay_point(
            &mut points,
            "center.mesher_iso",
            ray.visual_samples.mesher_iso.as_ref(),
        );
        push_visual_overlay_point(
            &mut points,
            "center.first_any_hit",
            ray.visual_samples.first_any_render_hit.as_ref(),
        );
        push_visual_overlay_point(
            &mut points,
            "center.first_front_hit",
            ray.visual_samples.first_front_render_hit.as_ref(),
        );
    }
    if let Some(fan) = camera_ray_fan {
        for gap in &fan.gaps {
            let prefix = format!("fan.{}.{}", gap.grid_x, gap.grid_y);
            push_visual_overlay_point(
                &mut points,
                format!("{prefix}.raw_surface"),
                gap.visual_samples.raw_surface.as_ref(),
            );
            push_visual_overlay_point(
                &mut points,
                format!("{prefix}.mesher_iso"),
                gap.visual_samples.mesher_iso.as_ref(),
            );
        }
    }
    for seam in active_seam_faces {
        for sample in &seam.samples {
            push_visual_overlay_point(
                &mut points,
                format!(
                    "seam.{}.{}.sample_{}_{:.2}_{:.2}",
                    format_ivec3_dump(seam.source_chunk),
                    seam.face,
                    sample.sample_index,
                    sample.face_u,
                    sample.face_v
                ),
                Some(&sample.visual),
            );
        }
    }
    points
}

fn push_visual_overlay_point(
    points: &mut Vec<ScreenshotOverlayPointProbe>,
    label: impl Into<String>,
    visual: Option<&VisualPointProbe>,
) {
    let Some(visual) = visual else {
        return;
    };
    points.push(ScreenshotOverlayPointProbe {
        label: label.into(),
        world_point: visual.world_point,
        screen_position: visual.screen_position,
        classification: visual.classification,
    });
}

fn increment_count(counts: &mut BTreeMap<String, u32>, name: String) {
    *counts.entry(name).or_default() += 1;
}

fn counts_to_vec(counts: BTreeMap<String, u32>) -> Vec<NamedCountProbe> {
    counts
        .into_iter()
        .map(|(name, count)| NamedCountProbe { name, count })
        .collect()
}

fn add_suspect_reason(
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

fn gap_lod_pair_name(gap: &FanGap) -> String {
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

fn mc_source_probe_chunk(source: &McTriangleSourceProbe) -> Option<IVec3> {
    match source {
        McTriangleSourceProbe::Regular { chunk_position, .. }
        | McTriangleSourceProbe::Transition { chunk_position, .. } => {
            Some(ivec3_from_dump(*chunk_position))
        }
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
fn render_entity_checklist_for_chunk(
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

fn terrain_mesh_debug_for_chunk(
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

fn mesh_status_for_chunk(
    world: &VoxelWorld,
    chunk_pos: IVec3,
    camera_pos: Option<Vec3>,
    mesh_settings: &MeshSettings,
    lod_settings: &LodSettings,
    water_lod_guard_chunks: &HashSet<IVec3>,
    terrain_debug: Option<&TerrainMeshDebug>,
) -> LodMeshStatus {
    let chunk = world.get_chunk(chunk_pos);
    let current_lod = chunk.map(|chunk| chunk.lod_level());
    let remesh_pending = chunk.is_some_and(|chunk| chunk.is_dirty());
    let effective_mesh_lod_now =
        effective_terrain_mesh_lod_for_chunk(world, chunk_pos, mesh_settings, lod_settings);
    let _water_shore_guarded = water_lod_guard_chunks.contains(&chunk_pos);
    let mesh_lod_mismatch = terrain_debug.map(|debug| {
        current_lod != Some(debug.logical_lod_at_mesh)
            || effective_mesh_lod_now != Some(debug.effective_lod_at_mesh)
            || camera_pos
                .and_then(|camera_pos| {
                    let distance = terrain_lod_distance_xz(chunk_pos, camera_pos);
                    current_lod.map(|current_lod| {
                        water_shore_guarded_lod(
                            calculate_target_lod_with_hysteresis(
                                distance,
                                current_lod,
                                lod_settings,
                            ),
                            distance,
                            lod_settings,
                            water_lod_guard_chunks.contains(&chunk_pos),
                        )
                    })
                })
                .is_some_and(|target_lod| current_lod != Some(target_lod))
    });
    lod_mesh_status(mesh_lod_mismatch, remesh_pending)
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

#[cfg(feature = "mc_transvoxel")]
fn face_mask_bit(face: ChunkFace) -> u8 {
    match face {
        ChunkFace::NegX => 0,
        ChunkFace::PosX => 1,
        ChunkFace::NegY => 2,
        ChunkFace::PosY => 3,
        ChunkFace::NegZ => 4,
        ChunkFace::PosZ => 5,
    }
}

fn compare_chunk_pos_lex(a: IVec3, b: IVec3) -> std::cmp::Ordering {
    a.x.cmp(&b.x)
        .then_with(|| a.y.cmp(&b.y))
        .then_with(|| a.z.cmp(&b.z))
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

    #[test]
    fn ray_triangle_hit_reports_front_and_backface_hits() {
        let origin = Vec3::new(0.25, 0.25, 1.0);
        let dir = Vec3::NEG_Z;
        let p0 = Vec3::new(0.0, 0.0, 0.0);
        let p1 = Vec3::new(1.0, 0.0, 0.0);
        let p2 = Vec3::new(0.0, 1.0, 0.0);

        let front = ray_triangle_hit(origin, dir, p0, p1, p2).unwrap();
        let back = ray_triangle_hit(origin, dir, p0, p2, p1).unwrap();

        assert!((front.0 - 1.0).abs() < 1.0e-5);
        assert!(front.1);
        assert!((back.0 - 1.0).abs() < 1.0e-5);
        assert!(!back.1);
    }

    #[test]
    fn camera_gap_classifies_backface_when_front_hit_is_late() {
        let gap = Some(SeeThroughGap {
            voxel_surface_distance: 10.0,
            first_front_render_hit_distance: None,
            gap_length: 10.0,
            note: "test".to_string(),
        });
        let backface = CameraRayHit {
            distance: 10.25,
            point: Vec3::ZERO.into(),
            front_face: false,
            geometric_normal: Vec3::Z.into(),
            normal_dot_ray: 1.0,
            vertex_normal: Some(Vec3::Z.into()),
            material_weights: Some([1.0, 0.0, 0.0, 0.0]),
            chunk_position: None,
            entity: "Entity(0)".to_string(),
            mesh_section: MeshTriangleSectionProbe::MainSurface,
            triangle_start_index: 0,
            vertices: None,
            source: None,
        };

        assert_eq!(
            classify_camera_gap(
                &gap,
                &Some(backface.clone()),
                &None,
                &Some(backface),
                None,
                None,
                None,
                &CameraRayVisualSamples::default()
            ),
            GapClassification::BackfaceOrWinding
        );
    }

    #[test]
    fn camera_gap_does_not_classify_far_backface_as_winding() {
        let gap = Some(SeeThroughGap {
            voxel_surface_distance: 227.25,
            first_front_render_hit_distance: None,
            gap_length: 284.75,
            note: "test".to_string(),
        });
        let far_backface = CameraRayHit {
            distance: 265.58856,
            point: Vec3::ZERO.into(),
            front_face: false,
            geometric_normal: Vec3::Y.into(),
            normal_dot_ray: 0.27,
            vertex_normal: Some(Vec3::Y.into()),
            material_weights: Some([0.0, 0.0, 0.78, 0.22]),
            chunk_position: Some(IVec3::new(4, 3, 4).into()),
            entity: "Entity(0)".to_string(),
            mesh_section: MeshTriangleSectionProbe::Unknown,
            triangle_start_index: 51,
            vertices: None,
            source: None,
        };

        assert_eq!(
            classify_camera_gap(
                &gap,
                &Some(far_backface.clone()),
                &None,
                &Some(far_backface),
                Some(228.0654),
                None,
                None,
                &CameraRayVisualSamples::default(),
            ),
            GapClassification::Unknown
        );
    }

    #[test]
    fn screenshot_pixel_classifier_detects_dark_and_lit_pixels() {
        assert_eq!(
            classify_visual_pixel(RgbaProbe {
                r: 2,
                g: 2,
                b: 2,
                a: 255,
                luminance: pixel_luminance(2, 2, 2),
            }),
            VisualPixelClassification::DarkOrMissing
        );
        assert_eq!(
            classify_visual_pixel(RgbaProbe {
                r: 180,
                g: 160,
                b: 120,
                a: 255,
                luminance: pixel_luminance(180, 160, 120),
            }),
            VisualPixelClassification::LitOrNonDark
        );
    }

    #[test]
    fn screenshot_pixel_sampler_reads_synthetic_fixture() {
        let image = ProbeImage {
            path: PathBuf::from("synthetic.png"),
            width: 2,
            height: 1,
            pixels: vec![0, 0, 0, 255, 200, 180, 120, 255],
        };

        let dark = sample_probe_image(&image, Vec2::new(0.0, 0.0)).unwrap();
        let lit = sample_probe_image(&image, Vec2::new(1.0, 0.0)).unwrap();

        assert_eq!(
            classify_visual_pixel(dark),
            VisualPixelClassification::DarkOrMissing
        );
        assert_eq!(
            classify_visual_pixel(lit),
            VisualPixelClassification::LitOrNonDark
        );
    }

    #[test]
    fn screenshot_pixel_window_reports_nearby_bright_pixels() {
        let image = ProbeImage {
            path: PathBuf::from("synthetic.png"),
            width: 3,
            height: 3,
            pixels: vec![
                180, 180, 180, 255, 180, 180, 180, 255, 180, 180, 180, 255, 180, 180, 180, 255,
                180, 180, 180, 255, 255, 255, 255, 255, 180, 180, 180, 255, 180, 180, 180, 255,
                180, 180, 180, 255,
            ],
        };

        let window = sample_probe_image_window(&image, Vec2::new(1.0, 1.0), 1).unwrap();

        assert_eq!(window.sampled_pixels, 9);
        assert_eq!(window.bright_pixels, 1);
        assert_eq!(window.lit_or_non_dark_pixels, 9);
        assert!(window.max_luminance > 0.99);
    }

    #[test]
    fn latest_matching_terrain_debug_screenshot_uses_recent_camera_match() {
        let temp = tempfile::tempdir().unwrap();
        let sidecar_path = temp.path().join("wireframe-test.json");
        let png_path = temp.path().join("wireframe-test.png");
        fs::write(
            &sidecar_path,
            r#"{"camera_pos":[1.0,2.0,3.0],"camera_rot":[0.0,0.0,0.0,1.0]}"#,
        )
        .unwrap();
        fs::write(&png_path, [0_u8]).unwrap();

        assert_eq!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(1.2, 2.0, 3.0)),
                Some(Vec3::NEG_Z),
            ),
            Some(png_path)
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(10.0, 2.0, 3.0)),
                Some(Vec3::NEG_Z),
            )
            .is_none()
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(1.2, 2.0, 3.0)),
                Some(Vec3::Z),
            )
            .is_none()
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(temp.path(), None, Some(Vec3::NEG_Z))
                .is_none()
        );
        assert!(
            latest_matching_terrain_debug_screenshot_in_dir(
                temp.path(),
                Some(Vec3::new(1.2, 2.0, 3.0)),
                None
            )
            .is_none()
        );
    }

    #[test]
    fn ray_to_emitted_triangle_residual_reports_hit_and_miss() {
        let vertices = [
            Vec3::new(0.0, 0.0, 5.0),
            Vec3::new(1.0, 0.0, 5.0),
            Vec3::new(0.0, 1.0, 5.0),
        ];

        let hit = emitted_triangle_probe(0, Vec3::new(0.25, 0.25, 0.0), Vec3::Z, vertices);
        let miss = emitted_triangle_probe(0, Vec3::new(3.0, 3.0, 0.0), Vec3::Z, vertices);

        assert!((hit.ray_hit_distance.unwrap() - 5.0).abs() < 1.0e-5);
        assert!(hit.closest_ray_distance < 0.75);
        assert!(miss.ray_hit_distance.is_none());
        assert!(miss.closest_ray_distance > 2.0);
    }

    #[test]
    fn render_hit_source_cell_matches_expected_mc_cell() {
        let cell = McCellOracleProbe {
            chunk_position: IVec3::new(1, 2, 3).into(),
            effective_lod_at_mesh: "Lod1".to_string(),
            neighbor_lods_at_mesh: NeighborLodsProbe {
                neg_x: None,
                pos_x: None,
                neg_y: None,
                pos_y: None,
                neg_z: None,
                pos_z: None,
            },
            cell: UVec3::new(4, 5, 6).into(),
            case_index: 23,
            class_index: 3,
            expected_regular_triangle_count: 2,
            actual_regular_triangle_count: Some(2),
            boundary_faces: Vec::new(),
            skipped_regular_faces: Vec::new(),
            transition_owner_faces: Vec::new(),
            transition_cells: Vec::new(),
            emitted_regular_triangles: Vec::new(),
            emitted_regular_triangles_ray_hit_count: 0,
            nearest_emitted_regular_triangle_ray_hit_distance: None,
            closest_emitted_regular_triangle_ray_distance: None,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };
        let source = McTriangleSourceProbe::Regular {
            chunk_position: IVec3::new(1, 2, 3).into(),
            lod: "Lod1".to_string(),
            cell: UVec3::new(4, 5, 6).into(),
            case_index: 23,
            class_index: 3,
        };

        assert!(mc_source_matches_cell_probe(&source, &cell));
    }

    fn classification_test_hit(distance: f32) -> CameraRayHit {
        CameraRayHit {
            distance,
            point: Vec3::new(0.0, 0.0, distance).into(),
            front_face: true,
            geometric_normal: Vec3::Y.into(),
            normal_dot_ray: 0.0,
            vertex_normal: Some(Vec3::Y.into()),
            material_weights: Some([1.0, 0.0, 0.0, 0.0]),
            chunk_position: Some(IVec3::ZERO.into()),
            entity: "test".to_string(),
            mesh_section: MeshTriangleSectionProbe::Unknown,
            triangle_start_index: 0,
            vertices: None,
            source: None,
        }
    }

    fn classification_test_cell() -> McCellOracleProbe {
        McCellOracleProbe {
            chunk_position: IVec3::new(11, 1, 8).into(),
            effective_lod_at_mesh: "Lod0".to_string(),
            neighbor_lods_at_mesh: NeighborLodsProbe {
                neg_x: Some("Lod0".to_string()),
                pos_x: Some("Lod0".to_string()),
                neg_y: Some("Lod0".to_string()),
                pos_y: Some("Lod0".to_string()),
                neg_z: Some("Lod0".to_string()),
                pos_z: Some("Lod0".to_string()),
            },
            cell: UVec3::new(15, 4, 5).into(),
            case_index: 3,
            class_index: 3,
            expected_regular_triangle_count: 2,
            actual_regular_triangle_count: Some(2),
            boundary_faces: vec!["pos_x".to_string()],
            skipped_regular_faces: Vec::new(),
            transition_owner_faces: Vec::new(),
            transition_cells: Vec::new(),
            emitted_regular_triangles: Vec::new(),
            emitted_regular_triangles_ray_hit_count: 0,
            nearest_emitted_regular_triangle_ray_hit_distance: None,
            closest_emitted_regular_triangle_ray_distance: Some(0.13819484),
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        }
    }

    fn visual_samples_with_mesher_iso(
        classification: VisualPixelClassification,
    ) -> CameraRayVisualSamples {
        CameraRayVisualSamples {
            mesher_iso: Some(VisualPointProbe {
                world_point: Vec3::new(190.2826, 19.445261, 132.31314).into(),
                screen_position: Some(Vec2Dump {
                    x: 845.9431,
                    y: 769.8731,
                }),
                screenshot_path: Some("synthetic.png".to_string()),
                pixel: Some(RgbaProbe {
                    r: 52,
                    g: 69,
                    b: 14,
                    a: 255,
                    luminance: pixel_luminance(52, 69, 14),
                }),
                pixel_window: None,
                nearby_pixel_window: None,
                classification,
                note: "test visual sample".to_string(),
            }),
            ..Default::default()
        }
    }

    fn possible_seam_terrace_probe() -> SeamTerraceProbe {
        SeamTerraceProbe {
            sample_point: Vec3::new(96.0, 32.0, 96.0).into(),
            threshold_voxels: 0.5,
            threshold_world: 0.5,
            pairs: vec![SeamTerracePairProbe {
                face: "pos_x".to_string(),
                source_chunk: IVec3::new(5, 2, 6).into(),
                neighbor_chunk: IVec3::new(6, 2, 6).into(),
                source_lod: "Lod0".to_string(),
                neighbor_lod: "Lod1".to_string(),
                fine_chunk: IVec3::new(5, 2, 6).into(),
                coarse_chunk: IVec3::new(6, 2, 6).into(),
                fine_lod: "Lod0".to_string(),
                coarse_lod: "Lod1".to_string(),
                fine_sample_point: Vec3::new(95.75, 32.0, 96.0).into(),
                coarse_sample_point: Vec3::new(96.25, 32.0, 96.0).into(),
                fine_iso_height: Some(31.0),
                coarse_iso_height: Some(32.25),
                signed_height_delta_coarse_minus_fine: Some(1.25),
                abs_height_delta: Some(1.25),
                source_chunk_skipped_lod_delta_gt_one: Some(0),
                neighbor_chunk_skipped_lod_delta_gt_one: Some(0),
            }],
            worst_abs_height_delta: Some(1.25),
            classification: SeamTerraceClassification::PossibleTerrace,
            note: "test seam terrace".to_string(),
        }
    }

    #[test]
    fn lit_mesher_iso_visual_overrides_case3_triangle_miss_classification() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: Some(102.165565),
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let hit = classification_test_hit(102.165565);
        let cell = classification_test_cell();
        let visual_samples =
            visual_samples_with_mesher_iso(VisualPixelClassification::LitOrNonDark);

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &Some(hit.clone()),
                &Some(hit),
                &None,
                Some(98.228195),
                Some(&cell),
                None,
                &visual_samples,
            ),
            GapClassification::RawOccupancyVsMesherIsoFalsePositive
        );
    }

    #[test]
    fn possible_seam_terrace_is_distinct_from_raw_occupancy_false_positive() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: Some(98.25),
            gap_length: 2.75,
            note: "test".to_string(),
        };
        let hit = classification_test_hit(98.25);
        let cell = classification_test_cell();
        let visual_samples =
            visual_samples_with_mesher_iso(VisualPixelClassification::LitOrNonDark);
        let terrace = possible_seam_terrace_probe();

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &Some(hit.clone()),
                &Some(hit),
                &None,
                Some(98.0),
                Some(&cell),
                Some(&terrace),
                &visual_samples,
            ),
            GapClassification::SeamTerraceOrLodSurfaceDisplacement
        );
    }

    #[test]
    fn dark_mesher_iso_keeps_case3_triangle_miss_as_vertex_decode_suspect() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: Some(102.165565),
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let hit = classification_test_hit(102.165565);
        let cell = classification_test_cell();
        let visual_samples =
            visual_samples_with_mesher_iso(VisualPixelClassification::DarkOrMissing);

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &Some(hit.clone()),
                &Some(hit),
                &None,
                Some(98.228195),
                Some(&cell),
                None,
                &visual_samples,
            ),
            GapClassification::VertexPositionOrTableDecodeError
        );
    }

    #[test]
    fn missing_regular_geometry_requires_known_zero_source_count() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: None,
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let mut cell = classification_test_cell();
        cell.actual_regular_triangle_count = None;

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &None,
                &None,
                &None,
                None,
                Some(&cell),
                None,
                &CameraRayVisualSamples::default(),
            ),
            GapClassification::Unknown
        );
    }

    #[test]
    fn known_zero_regular_source_count_classifies_missing_geometry() {
        let gap = SeeThroughGap {
            voxel_surface_distance: 95.5,
            first_front_render_hit_distance: None,
            gap_length: 6.6655655,
            note: "test".to_string(),
        };
        let mut cell = classification_test_cell();
        cell.actual_regular_triangle_count = Some(0);

        assert_eq!(
            classify_camera_gap(
                &Some(gap),
                &None,
                &None,
                &None,
                None,
                Some(&cell),
                None,
                &CameraRayVisualSamples::default(),
            ),
            GapClassification::MissingRegularMcGeometry
        );
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn mesher_iso_oracle_matches_flat_plane_sdf() {
        let padded = 4usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = z as f32 - 2.0;
                }
            }
        }

        let (distance, point) = first_mesher_iso_in_sdf_grid(
            Vec3::new(0.5, 0.5, -0.5),
            Vec3::Z,
            4.0,
            Vec3::ZERO,
            padded,
            &values,
            1,
        )
        .expect("ray should cross the flat SDF plane");

        assert!((distance - 1.5).abs() < 1.0e-5);
        assert!((point.z - 1.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn seam_terrace_vertical_iso_height_matches_flat_plane_sdf() {
        let padded = 4usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = y as f32 - 2.0;
                }
            }
        }
        let grid = McSdfGridProbe {
            chunk_position: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            padded,
            values,
            step: 1,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };

        let height = highest_vertical_iso_height_in_grid(&grid, 0.5, 0.5)
            .expect("vertical probe should cross the flat SDF plane");

        assert!((height - 1.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn seam_terrace_vertical_iso_height_samples_upper_padded_boundary() {
        let padded = 4usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = y as f32 - 2.0;
                }
            }
        }
        let grid = McSdfGridProbe {
            chunk_position: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            padded,
            values,
            step: 1,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };

        let height = highest_vertical_iso_height_in_grid(&grid, 2.0, 0.5)
            .expect("vertical probe should sample the upper padded X boundary");

        assert!((height - 1.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn seam_face_sample_point_covers_y_face_as_2d_grid() {
        let point = seam_face_sample_point(Vec3::ZERO, ChunkFace::PosY, 0.25, 0.75);

        assert!((point.x - CHUNK_SIZE_I32 as f32 * 0.25).abs() < 1.0e-5);
        assert!((point.y - CHUNK_SIZE_I32 as f32).abs() < 1.0e-5);
        assert!((point.z - CHUNK_SIZE_I32 as f32 * 0.75).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn face_normal_iso_offset_matches_flat_x_plane_sdf() {
        let padded = 6usize;
        let mut values = vec![0.0_f32; padded * padded * padded];
        for z in 0..padded {
            for y in 0..padded {
                for x in 0..padded {
                    values[x + y * padded + z * padded * padded] = x as f32 - 3.0;
                }
            }
        }
        let grid = McSdfGridProbe {
            chunk_position: IVec3::ZERO,
            lod: LodLevel::Lod0,
            neighbor_lods: NeighborLods::default(),
            padded,
            values,
            step: 1,
            source_chunk_skipped_lod_delta_gt_one: Some(0),
        };

        let offset =
            nearest_face_normal_iso_offset_in_grid(&grid, Vec3::new(2.0, 1.0, 1.0), Vec3::X)
                .expect("face-normal probe should cross the flat SDF plane");

        assert!((offset - 0.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn split_boundary_edges_cover_long_opposite_edge() {
        let edges = vec![
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(2.0, 0.0, 0.0),
                length: 2.0,
                transition: false,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(1.0, 0.0, 0.0),
                length: 1.0,
                transition: true,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::new(1.0, 0.0, 0.0),
                end: Vec3::new(2.0, 0.0, 0.0),
                length: 1.0,
                transition: true,
            },
        ];

        assert!(edge_has_opposite_side_coverage(&edges[0], &edges));
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn same_chunk_duplicate_boundary_edge_counts_as_covered() {
        let edges = vec![
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(1.0, 0.0, 0.0),
                length: 1.0,
                transition: false,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::new(1.0, 0.0, 0.0),
                end: Vec3::ZERO,
                length: 1.0,
                transition: true,
            },
        ];

        assert!(edge_has_opposite_side_coverage(&edges[0], &edges));
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn missing_split_boundary_edge_half_remains_unmatched() {
        let edges = vec![
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(2.0, 0.0, 0.0),
                length: 2.0,
                transition: false,
            },
            BoundaryEdgeAccum {
                source: None,
                start: Vec3::ZERO,
                end: Vec3::new(1.0, 0.0, 0.0),
                length: 1.0,
                transition: true,
            },
        ];

        assert!(!edge_has_opposite_side_coverage(&edges[0], &edges));
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn mesher_iso_crossing_interpolates_across_chunk_sample_boundary() {
        let (distance, point) =
            mesher_iso_crossing_between_samples(Vec3::ZERO, Vec3::X, 15.5, -1.0, 16.5, 1.0)
                .expect("opposite signs should produce an iso crossing");

        assert!((distance - 16.0).abs() < 1.0e-5);
        assert!((point.x - 16.0).abs() < 1.0e-5);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn oracle_cell_selection_uses_mesher_iso_point() {
        let cell = mc_cell_for_point(Vec3::new(14.9, 4.1, 7.0), Vec3::ZERO, 16, 1);

        assert_eq!(cell, [14, 4, 7]);
    }

    #[cfg(feature = "mc_transvoxel")]
    #[test]
    fn oracle_cell_selection_keeps_lod1_positive_boundary_band() {
        let chunk_origin = Vec3::new(96.0, 32.0, 96.0);
        let cell = mc_cell_for_point(Vec3::new(96.60327, 46.26485, 96.79657), chunk_origin, 8, 2);

        assert_eq!(cell, [0, 7, 0]);
    }
}
