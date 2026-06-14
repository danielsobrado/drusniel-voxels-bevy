use super::*;

#[derive(Serialize)]
pub(super) struct TerrainHoleProbeDump {
    pub(super) schema_version: u32,
    pub(super) timestamp_utc: String,
    pub(super) trigger: String,
    pub(super) player_world_position: Vec3Dump,
    pub(super) camera_world_position: Option<Vec3Dump>,
    pub(super) target_voxel_position: IVec3Dump,
    pub(super) target_voxel_type: Option<String>,
    pub(super) target_chunk_position: IVec3Dump,
    pub(super) target_local_voxel_position: UVec3Dump,
    pub(super) world_bounds: WorldBoundsProbe,
    pub(super) player_validity: PlayableValidityProbe,
    pub(super) target_validity: PlayableValidityProbe,
    pub(super) player_boundary_sample: BoundarySampleProbe,
    pub(super) target_boundary_sample: BoundarySampleProbe,
    pub(super) classification: TerrainHoleClassification,
    pub(super) columns: Vec<ColumnProbe>,
    pub(super) physics: PhysicsProbe,
    pub(super) render_mesh_ray_hits: Vec<RenderMeshRayProbe>,
    pub(super) render_mesh_ray_grid: Vec<RenderMeshRayGridProbe>,
    pub(super) camera_ray: Option<CameraRayProbe>,
    pub(super) camera_ray_fan: Option<CameraRayFan>,
    pub(super) normalized_summary: TerrainHoleProbeSummary,
    pub(super) active_seam_faces: Vec<SeamFaceProbe>,
    pub(super) render_entity_checklist: Vec<RenderEntityChecklistProbe>,
    pub(super) screenshot_overlay_points: Vec<ScreenshotOverlayPointProbe>,
    pub(super) chunks: Vec<ChunkProbe>,
}

#[derive(Serialize, Default)]
pub(super) struct TerrainHoleProbeSummary {
    pub(super) gap_classification_counts: Vec<NamedCountProbe>,
    pub(super) seam_terrace_counts: Vec<NamedCountProbe>,
    pub(super) gaps_by_lod_pair: Vec<NamedCountProbe>,
    pub(super) gaps_by_nearest_face: Vec<NamedCountProbe>,
    pub(super) max_gap_seam_delta_voxels: Option<f32>,
    pub(super) max_active_seam_delta_voxels: Option<f32>,
    pub(super) active_seam_face_count: u32,
    pub(super) active_seam_faces_with_possible_terrace: u32,
    pub(super) active_seam_faces_with_open_edges: u32,
    pub(super) active_seam_faces_with_transition_coverage_gaps: u32,
    pub(super) chunks_with_skipped_lod_delta_gt_one: Vec<IVec3Dump>,
    pub(super) stale_or_pending_mesh_chunks: Vec<IVec3Dump>,
    pub(super) debug_unavailable_mesh_chunks: Vec<IVec3Dump>,
    pub(super) top_suspect_chunks: Vec<ChunkSuspectProbe>,
}

#[derive(Serialize, Clone)]
pub(super) struct NamedCountProbe {
    pub(super) name: String,
    pub(super) count: u32,
}

#[derive(Serialize)]
pub(super) struct ChunkSuspectProbe {
    pub(super) chunk_position: IVec3Dump,
    pub(super) score: u32,
    pub(super) reasons: Vec<String>,
}

#[derive(Serialize, Default)]
pub(super) struct TerrainHoleClassification {
    pub(super) world_data_hole: bool,
    pub(super) mesh_missing: bool,
    pub(super) collider_missing: bool,
    pub(super) collider_pending: bool,
    pub(super) collider_failed: bool,
    pub(super) visibility_hidden: bool,
    pub(super) mesh_surface_mismatch: bool,
    pub(super) collider_surface_mismatch: bool,
    pub(super) vertical_chunk_boundary_surface: bool,
    pub(super) expected_surface_y: Option<f32>,
    pub(super) physics_hit_y: Option<f32>,
    pub(super) physics_surface_error: Option<f32>,
    pub(super) render_mesh_ray_hit_y: Option<f32>,
    pub(super) notes: Vec<String>,
}

#[derive(Serialize)]
pub(super) struct WorldBoundsProbe {
    pub(super) min_chunk: IVec3Dump,
    pub(super) max_chunk: IVec3Dump,
    pub(super) min_world_y: i32,
    pub(super) max_world_y: i32,
    pub(super) min_breakable_y: i32,
    pub(super) kill_y: i32,
    pub(super) bedrock_floor_y: i32,
    pub(super) horizontal_min: IVec2Dump,
    pub(super) horizontal_max: IVec2Dump,
}

#[derive(Serialize)]
pub(super) struct PlayableValidityProbe {
    pub(super) valid: bool,
    pub(super) classification: String,
    pub(super) invalid_reason: Option<String>,
}

#[derive(Serialize)]
pub(super) struct BoundarySampleProbe {
    pub(super) world_position: IVec3Dump,
    pub(super) chunk_position: IVec3Dump,
    pub(super) local_position: UVec3Dump,
    pub(super) classification: String,
    pub(super) voxel_type: Option<String>,
}

#[derive(Serialize)]
pub(super) struct ColumnProbe {
    pub(super) offset_x: i32,
    pub(super) offset_z: i32,
    pub(super) world_x: i32,
    pub(super) world_z: i32,
    pub(super) y_top: i32,
    pub(super) y_bottom: i32,
    pub(super) first_solid_from_above: Option<VoxelSample>,
    pub(super) first_air_gap_below_top_solid: Option<VoxelSample>,
    pub(super) first_water_below_top_solid: Option<VoxelSample>,
    pub(super) samples: Vec<VoxelSample>,
}

#[derive(Serialize, Clone)]
pub(super) struct VoxelSample {
    pub(super) world_position: IVec3Dump,
    pub(super) chunk_position: IVec3Dump,
    pub(super) local_position: UVec3Dump,
    pub(super) chunk_exists: bool,
    pub(super) boundary: Option<String>,
    pub(super) voxel_type: Option<String>,
    pub(super) solid: bool,
    pub(super) liquid: bool,
    pub(super) open_vertical_path_to_sky: Option<bool>,
}

#[derive(Serialize)]
pub(super) struct PhysicsProbe {
    pub(super) player_down_ray: RayProbe,
    pub(super) target_down_ray: RayProbe,
}

#[derive(Serialize)]
pub(super) struct RayProbe {
    pub(super) origin: Vec3Dump,
    pub(super) direction: Vec3Dump,
    pub(super) max_distance: f32,
    pub(super) hit: Option<RayHitProbe>,
}

#[derive(Serialize)]
pub(super) struct RayHitProbe {
    pub(super) entity: String,
    pub(super) distance: f32,
    pub(super) hit_y: f32,
    pub(super) normal: Vec3Dump,
    pub(super) chunk_position: Option<IVec3Dump>,
    pub(super) has_chunk_mesh: bool,
    pub(super) has_chunk_collider: bool,
    pub(super) has_collider: bool,
    pub(super) has_static_rigid_body: bool,
}

#[derive(Serialize)]
pub(super) struct RenderMeshRayProbe {
    pub(super) entity: String,
    pub(super) chunk_position: Option<IVec3Dump>,
    pub(super) hit_y: Option<f32>,
    pub(super) surface_error: Option<f32>,
    pub(super) vertex_count: Option<usize>,
    pub(super) triangle_count: Option<usize>,
    pub(super) mesh_available: bool,
}

#[derive(Serialize)]
pub(super) struct RenderMeshRayGridProbe {
    pub(super) sample_kind: RenderMeshRayGridSampleKind,
    pub(super) offset_x: i32,
    pub(super) offset_z: i32,
    pub(super) world_x: f32,
    pub(super) world_z: f32,
    pub(super) ray_origin: Vec3Dump,
    pub(super) ray_origin_y: f32,
    pub(super) ray_direction: Vec3Dump,
    pub(super) expected_surface_y: Option<f32>,
    pub(super) highest_render_hit_y: Option<f32>,
    pub(super) render_hit_point: Option<Vec3Dump>,
    pub(super) render_hit_chunk: Option<IVec3Dump>,
    pub(super) render_hit_local_point: Option<Vec3Dump>,
    pub(super) signed_surface_error: Option<f32>,
    pub(super) abs_surface_error: Option<f32>,
    pub(super) surface_error: Option<f32>,
    pub(super) render_hit_mesh_section: Option<MeshTriangleSectionProbe>,
    pub(super) nearest_chunk_faces: Vec<BoundaryDistanceProbe>,
    pub(super) hit_chunk: Option<IVec3Dump>,
    pub(super) hit_entity: Option<String>,
    pub(super) chunk_state: Option<FanGapChunkState>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum RenderMeshRayGridSampleKind {
    TargetVertical,
    CameraHeightFan,
}

/// Camera look-ray cast against the terrain *render meshes*, used to catch
/// see-through LOD cracks: the targeting voxel-raycast passes straight through
/// such a gap and locks onto solid terrain behind it, so it can never land on
/// the crack. This ray instead reports where the ray enters solid voxel data
/// versus where it first meets a front-facing render triangle.
#[derive(Serialize)]
pub(super) struct CameraRayProbe {
    pub(super) origin: Vec3Dump,
    pub(super) direction: Vec3Dump,
    pub(super) max_distance: f32,
    /// Distance at which the ray first enters solid voxel data.
    pub(super) first_voxel_solid_distance: Option<f32>,
    /// Distance at which the ray last leaves solid voxel data.
    pub(super) last_voxel_solid_distance: Option<f32>,
    /// Nearest render-mesh triangle hit, ignoring triangle orientation.
    pub(super) first_any_render_hit: Option<CameraRayHit>,
    /// Nearest front-facing render-mesh triangle hit.
    pub(super) first_front_render_hit: Option<CameraRayHit>,
    /// Nearest back-facing render-mesh triangle hit.
    pub(super) first_backface_render_hit: Option<CameraRayHit>,
    /// First trilinear iso crossing from the exact MC SDF grid for the source chunk.
    pub(super) first_mesher_iso_distance: Option<f32>,
    pub(super) first_mesher_iso_point: Option<Vec3Dump>,
    /// Difference between the nearest render hit and mesher iso distance.
    pub(super) first_any_distance_from_mesher_iso: Option<f32>,
    pub(super) first_front_distance_from_mesher_iso: Option<f32>,
    pub(super) mc_cell: Option<McCellOracleProbe>,
    pub(super) raw_surface_mc_cell: Option<McCellOracleProbe>,
    pub(super) mesher_iso_mc_cell: Option<McCellOracleProbe>,
    pub(super) first_render_hit_source: Option<McTriangleSourceProbe>,
    pub(super) cell_agreement: Option<McCellAgreementProbe>,
    pub(super) seam_terrace: Option<SeamTerraceProbe>,
    pub(super) visual_samples: CameraRayVisualSamples,
    pub(super) gap_classification: GapClassification,
    /// All render-mesh hits along the ray, sorted by distance (capped).
    pub(super) render_hits: Vec<CameraRayHit>,
    /// Set when the ray enters solid voxel data with no render surface there.
    pub(super) see_through_gap: Option<SeeThroughGap>,
}

#[derive(Serialize, Clone)]
pub(super) struct CameraRayHit {
    pub(super) distance: f32,
    pub(super) point: Vec3Dump,
    /// True if the triangle faces the ray origin (a visible surface front).
    pub(super) front_face: bool,
    pub(super) geometric_normal: Vec3Dump,
    pub(super) normal_dot_ray: f32,
    pub(super) vertex_normal: Option<Vec3Dump>,
    pub(super) material_weights: Option<[f32; 4]>,
    pub(super) chunk_position: Option<IVec3Dump>,
    pub(super) entity: String,
    pub(super) mesh_section: MeshTriangleSectionProbe,
    pub(super) triangle_start_index: u32,
    pub(super) vertices: Option<[Vec3Dump; 3]>,
    pub(super) source: Option<McTriangleSourceProbe>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum GapClassification {
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
pub(super) enum McTriangleSourceProbe {
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
pub(super) struct McCellOracleProbe {
    pub(super) chunk_position: IVec3Dump,
    pub(super) effective_lod_at_mesh: String,
    pub(super) neighbor_lods_at_mesh: NeighborLodsProbe,
    pub(super) cell: UVec3Dump,
    pub(super) case_index: u16,
    pub(super) class_index: u8,
    pub(super) expected_regular_triangle_count: u8,
    pub(super) actual_regular_triangle_count: Option<u32>,
    pub(super) boundary_faces: Vec<String>,
    pub(super) skipped_regular_faces: Vec<String>,
    pub(super) transition_owner_faces: Vec<String>,
    pub(super) transition_cells: Vec<McTransitionCellOracleProbe>,
    pub(super) emitted_regular_triangles: Vec<McEmittedTriangleProbe>,
    pub(super) emitted_regular_triangles_ray_hit_count: u32,
    pub(super) nearest_emitted_regular_triangle_ray_hit_distance: Option<f32>,
    pub(super) closest_emitted_regular_triangle_ray_distance: Option<f32>,
    pub(super) source_chunk_skipped_lod_delta_gt_one: Option<u32>,
}

#[derive(Serialize, Clone)]
pub(super) struct McTransitionCellOracleProbe {
    pub(super) face: String,
    pub(super) cell_u: u16,
    pub(super) cell_v: u16,
    pub(super) case_index: u16,
    pub(super) class_index: u8,
    pub(super) expected_triangle_count: u8,
    pub(super) actual_triangle_count: Option<u32>,
    pub(super) invert: bool,
    pub(super) emitted_triangles: Vec<McEmittedTriangleProbe>,
    pub(super) emitted_triangles_ray_hit_count: u32,
    pub(super) nearest_emitted_triangle_ray_hit_distance: Option<f32>,
    pub(super) closest_emitted_triangle_ray_distance: Option<f32>,
}

#[derive(Serialize, Clone)]
pub(super) struct McEmittedTriangleProbe {
    pub(super) triangle_start_index: u32,
    pub(super) vertices: [Vec3Dump; 3],
    pub(super) ray_hit_distance: Option<f32>,
    pub(super) front_face: Option<bool>,
    pub(super) closest_ray_distance: f32,
}

#[derive(Serialize, Clone)]
pub(super) struct McCellAgreementProbe {
    pub(super) raw_surface_cell_matches_mesher_iso_cell: Option<bool>,
    pub(super) mesher_iso_cell_matches_first_render_hit_source: Option<bool>,
    pub(super) raw_surface_cell_matches_first_render_hit_source: Option<bool>,
    pub(super) note: String,
}

#[derive(Serialize, Clone)]
pub(super) struct SeamTerraceProbe {
    pub(super) sample_point: Vec3Dump,
    pub(super) threshold_voxels: f32,
    pub(super) threshold_world: f32,
    pub(super) pairs: Vec<SeamTerracePairProbe>,
    pub(super) worst_abs_height_delta: Option<f32>,
    pub(super) classification: SeamTerraceClassification,
    pub(super) note: String,
}

#[derive(Serialize, Clone)]
pub(super) struct SeamTerracePairProbe {
    pub(super) face: String,
    pub(super) source_chunk: IVec3Dump,
    pub(super) neighbor_chunk: IVec3Dump,
    pub(super) source_lod: String,
    pub(super) neighbor_lod: String,
    pub(super) fine_chunk: IVec3Dump,
    pub(super) coarse_chunk: IVec3Dump,
    pub(super) fine_lod: String,
    pub(super) coarse_lod: String,
    pub(super) fine_sample_point: Vec3Dump,
    pub(super) coarse_sample_point: Vec3Dump,
    pub(super) fine_iso_height: Option<f32>,
    pub(super) coarse_iso_height: Option<f32>,
    pub(super) signed_height_delta_coarse_minus_fine: Option<f32>,
    pub(super) abs_height_delta: Option<f32>,
    pub(super) source_chunk_skipped_lod_delta_gt_one: Option<u32>,
    pub(super) neighbor_chunk_skipped_lod_delta_gt_one: Option<u32>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "mc_transvoxel"), allow(dead_code))]
#[serde(rename_all = "snake_case")]
pub(super) enum SeamTerraceClassification {
    NotNearLodSeam,
    InsufficientData,
    NoTerrace,
    PossibleTerrace,
}

#[derive(Serialize, Clone, Default)]
pub(super) struct CameraRayVisualSamples {
    pub(super) raw_surface: Option<VisualPointProbe>,
    pub(super) mesher_iso: Option<VisualPointProbe>,
    pub(super) first_any_render_hit: Option<VisualPointProbe>,
    pub(super) first_front_render_hit: Option<VisualPointProbe>,
}

#[derive(Serialize, Clone)]
pub(super) struct VisualPointProbe {
    pub(super) world_point: Vec3Dump,
    pub(super) screen_position: Option<Vec2Dump>,
    pub(super) screenshot_path: Option<String>,
    pub(super) pixel: Option<RgbaProbe>,
    pub(super) pixel_window: Option<VisualPixelWindowProbe>,
    pub(super) nearby_pixel_window: Option<VisualPixelWindowProbe>,
    pub(super) classification: VisualPixelClassification,
    pub(super) note: String,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum VisualPixelClassification {
    LitOrNonDark,
    DarkOrMissing,
    SkyOrBackground,
    Offscreen,
    ScreenshotUnavailable,
    ProjectionUnavailable,
}

#[derive(Serialize, Clone, Copy)]
pub(super) struct RgbaProbe {
    pub(super) r: u8,
    pub(super) g: u8,
    pub(super) b: u8,
    pub(super) a: u8,
    pub(super) luminance: f32,
}

#[derive(Serialize, Clone, Copy)]
pub(super) struct VisualPixelWindowProbe {
    pub(super) radius_px: u32,
    pub(super) sampled_pixels: u32,
    pub(super) dark_or_missing_pixels: u32,
    pub(super) sky_or_background_pixels: u32,
    pub(super) bright_pixels: u32,
    pub(super) lit_or_non_dark_pixels: u32,
    pub(super) min_luminance: f32,
    pub(super) max_luminance: f32,
    pub(super) luminance_range: f32,
    pub(super) mean_luminance: f32,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum MeshTriangleSectionProbe {
    MainSurface,
    TransitionApron,
    VerticalSkirt,
    TransitionGeometry,
    Unknown,
}

#[derive(Serialize)]
pub(super) struct SeeThroughGap {
    pub(super) voxel_surface_distance: f32,
    pub(super) first_front_render_hit_distance: Option<f32>,
    pub(super) gap_length: f32,
    pub(super) note: String,
}

/// A cone of camera rays around the crosshair. A single ray needs pixel-perfect
/// aim to land on a small crack at distance; the fan lets a rough aim at the
/// crack cluster catch any solid-before-render candidate inside the cone.
#[derive(Serialize)]
pub(super) struct CameraRayFan {
    pub(super) half_angle_degrees: f32,
    pub(super) grid_size: u32,
    pub(super) rays_total: u32,
    pub(super) rays_with_gap: u32,
    pub(super) gaps: Vec<FanGap>,
}

#[derive(Serialize)]
pub(super) struct FanGap {
    pub(super) grid_x: u32,
    pub(super) grid_y: u32,
    pub(super) direction: Vec3Dump,
    pub(super) voxel_surface_distance: f32,
    pub(super) first_front_render_hit_distance: Option<f32>,
    pub(super) first_front_render_mesh_section: Option<MeshTriangleSectionProbe>,
    pub(super) first_any_render_hit_distance: Option<f32>,
    pub(super) first_backface_render_hit_distance: Option<f32>,
    pub(super) first_mesher_iso_distance: Option<f32>,
    pub(super) first_mesher_iso_point: Option<Vec3Dump>,
    pub(super) first_any_distance_from_mesher_iso: Option<f32>,
    pub(super) first_front_distance_from_mesher_iso: Option<f32>,
    pub(super) gap_classification: GapClassification,
    pub(super) mc_cell: Option<McCellOracleProbe>,
    pub(super) raw_surface_mc_cell: Option<McCellOracleProbe>,
    pub(super) mesher_iso_mc_cell: Option<McCellOracleProbe>,
    pub(super) first_render_hit_source: Option<McTriangleSourceProbe>,
    pub(super) cell_agreement: Option<McCellAgreementProbe>,
    pub(super) seam_terrace: Option<SeamTerraceProbe>,
    pub(super) visual_samples: CameraRayVisualSamples,
    pub(super) gap_length: f32,
    pub(super) surface_point: Vec3Dump,
    pub(super) surface_chunk: IVec3Dump,
    pub(super) surface_local_point: Vec3Dump,
    pub(super) nearest_chunk_faces: Vec<BoundaryDistanceProbe>,
    pub(super) surface_chunk_state: FanGapChunkState,
}

#[derive(Serialize)]
pub(super) struct BoundaryDistanceProbe {
    pub(super) face: String,
    pub(super) distance_voxels: f32,
}

#[derive(Serialize)]
pub(super) struct FanGapChunkState {
    pub(super) exists_in_world: bool,
    pub(super) lod_level: Option<String>,
    pub(super) dirty: Option<bool>,
    pub(super) dirty_reason_flags: Option<u8>,
    pub(super) dirty_reasons: Vec<String>,
    pub(super) uniformity: Option<String>,
    pub(super) mesh_entity_from_world: Option<String>,
    pub(super) lod_eval: Option<LodEvalProbe>,
    pub(super) neighbor_lods_at_mesh: Option<NeighborLodsProbe>,
    pub(super) lod_transition_snap_at_mesh: Option<LodTransitionSnapStatsProbe>,
    pub(super) mc_transvoxel_at_mesh: Option<McTransvoxelStatsProbe>,
    pub(super) mesh_sections_at_mesh: Option<TerrainMeshSectionStatsProbe>,
    pub(super) empty_surface_cap_at_mesh: Option<bool>,
    pub(super) empty_cap: EmptyCapProbe,
}

#[derive(Serialize)]
pub(super) struct SeamFaceProbe {
    pub(super) source_chunk: IVec3Dump,
    pub(super) neighbor_chunk: IVec3Dump,
    pub(super) face: String,
    pub(super) source_lod: String,
    pub(super) neighbor_lod: String,
    pub(super) fine_chunk: IVec3Dump,
    pub(super) coarse_chunk: IVec3Dump,
    pub(super) fine_lod: String,
    pub(super) coarse_lod: String,
    pub(super) source_mesh_status: LodMeshStatus,
    pub(super) neighbor_mesh_status: LodMeshStatus,
    pub(super) source_generated_frame: Option<u32>,
    pub(super) neighbor_generated_frame: Option<u32>,
    pub(super) same_generated_frame_as_neighbor: Option<bool>,
    pub(super) source_dirty_reasons: Vec<String>,
    pub(super) neighbor_dirty_reasons: Vec<String>,
    pub(super) source_render_entity: Option<RenderEntityChecklistProbe>,
    pub(super) neighbor_render_entity: Option<RenderEntityChecklistProbe>,
    pub(super) transition_owner: bool,
    pub(super) skipped_regular_boundary_row: bool,
    pub(super) lod_delta_gt_one: bool,
    pub(super) source_chunk_skipped_lod_delta_gt_one: Option<u32>,
    pub(super) neighbor_chunk_skipped_lod_delta_gt_one: Option<u32>,
    pub(super) samples: Vec<SeamFaceSampleProbe>,
    pub(super) sample_grid_u: u32,
    pub(super) sample_grid_v: u32,
    pub(super) sample_count: u32,
    pub(super) possible_terrace_sample_count: u32,
    pub(super) missing_render_coverage_sample_count: u32,
    pub(super) max_abs_height_delta: Option<f32>,
    pub(super) median_abs_height_delta: Option<f32>,
    pub(super) max_abs_face_offset_delta: Option<f32>,
    pub(super) median_abs_face_offset_delta: Option<f32>,
    pub(super) transition_coverage: TransitionCoverageProbe,
    pub(super) boundary_edges: BoundaryEdgeLeakProbe,
}

#[derive(Serialize)]
pub(super) struct SeamFaceSampleProbe {
    pub(super) sample_index: u32,
    pub(super) face_u: f32,
    pub(super) face_v: f32,
    pub(super) seam_point: Vec3Dump,
    pub(super) screen_position: Option<Vec2Dump>,
    pub(super) fine_iso_height: Option<f32>,
    pub(super) coarse_iso_height: Option<f32>,
    pub(super) signed_height_delta_coarse_minus_fine: Option<f32>,
    pub(super) abs_height_delta: Option<f32>,
    pub(super) fine_face_iso_offset: Option<f32>,
    pub(super) coarse_face_iso_offset: Option<f32>,
    pub(super) signed_face_offset_delta_coarse_minus_fine: Option<f32>,
    pub(super) abs_face_offset_delta: Option<f32>,
    pub(super) render_hit_y: Option<f32>,
    pub(super) render_hit_chunk: Option<IVec3Dump>,
    pub(super) render_hit_entity: Option<String>,
    pub(super) render_hit_mesh_section: Option<MeshTriangleSectionProbe>,
    pub(super) render_distance_from_fine_iso: Option<f32>,
    pub(super) render_distance_from_coarse_iso: Option<f32>,
    pub(super) render_face_offset: Option<f32>,
    pub(super) render_face_hit_point: Option<Vec3Dump>,
    pub(super) render_face_hit_chunk: Option<IVec3Dump>,
    pub(super) render_face_hit_entity: Option<String>,
    pub(super) render_face_hit_mesh_section: Option<MeshTriangleSectionProbe>,
    pub(super) render_distance_from_fine_face_iso: Option<f32>,
    pub(super) render_distance_from_coarse_face_iso: Option<f32>,
    pub(super) has_render_coverage_near_either_iso: bool,
    pub(super) visual: VisualPointProbe,
}

#[derive(Serialize)]
pub(super) struct TransitionCoverageProbe {
    pub(super) skipped_regular_face: bool,
    pub(super) transition_owner: bool,
    pub(super) actual_transition_triangle_count: Option<u32>,
    pub(super) actual_transition_cell_count: Option<u32>,
    pub(super) sample_count: u32,
    pub(super) samples_without_render_coverage: u32,
    pub(super) samples_without_transition_render_coverage: u32,
    pub(super) coverage_note: String,
}

#[derive(Serialize)]
pub(super) struct BoundaryEdgeLeakProbe {
    pub(super) inspected_triangle_count: u32,
    pub(super) seam_edge_count: u32,
    pub(super) unmatched_seam_edge_count: u32,
    pub(super) unmatched_transition_edge_count: u32,
    pub(super) unmatched_regular_edge_count: u32,
    pub(super) longest_unmatched_edge: Option<f32>,
    pub(super) examples: Vec<BoundaryEdgeExampleProbe>,
}

#[derive(Serialize)]
pub(super) struct BoundaryEdgeExampleProbe {
    pub(super) start: Vec3Dump,
    pub(super) end: Vec3Dump,
    pub(super) length: f32,
    pub(super) source: Option<McTriangleSourceProbe>,
}

#[derive(Serialize, Clone)]
pub(super) struct RenderEntityChecklistProbe {
    pub(super) chunk_position: IVec3Dump,
    pub(super) mesh_entity_from_world: Option<String>,
    pub(super) entity_query_found: bool,
    pub(super) mesh_handle_present: bool,
    pub(super) mesh_asset_loaded: bool,
    pub(super) position_attribute_present: bool,
    pub(super) normal_attribute_present: bool,
    pub(super) index_buffer_present: bool,
    pub(super) vertex_count: Option<u32>,
    pub(super) triangle_count: Option<u32>,
    pub(super) chunk_mesh_component_present: bool,
    pub(super) terrain_debug_present: bool,
    pub(super) visibility: Option<String>,
    pub(super) inherited_visibility: Option<bool>,
    pub(super) view_visibility: Option<bool>,
    pub(super) visible_to_render: Option<bool>,
    pub(super) mesh_mode_at_component: Option<String>,
    pub(super) target_mode_at_mesh: Option<String>,
    pub(super) current_lod: Option<String>,
    pub(super) logical_lod_at_mesh: Option<String>,
    pub(super) effective_lod_at_mesh: Option<String>,
    pub(super) generated_frame: Option<u32>,
    pub(super) dirty: Option<bool>,
    pub(super) dirty_reasons: Vec<String>,
    pub(super) mesh_status: LodMeshStatus,
}

#[derive(Serialize)]
pub(super) struct ScreenshotOverlayPointProbe {
    pub(super) label: String,
    pub(super) world_point: Vec3Dump,
    pub(super) screen_position: Option<Vec2Dump>,
    pub(super) classification: VisualPixelClassification,
}

#[derive(Serialize)]
pub(super) struct ChunkProbe {
    pub(super) chunk_position: IVec3Dump,
    pub(super) exists_in_world: bool,
    pub(super) lod_level: Option<String>,
    pub(super) dirty: Option<bool>,
    pub(super) dirty_reason_flags: Option<u8>,
    pub(super) dirty_reasons: Vec<String>,
    pub(super) visibility_dirty: Option<bool>,
    pub(super) uniformity: Option<String>,
    pub(super) mesh_entity_from_world: Option<String>,
    pub(super) water_mesh_entity_from_world: Option<String>,
    pub(super) target_local_y_is_boundary: bool,
    pub(super) lod_eval: Option<LodEvalProbe>,
    pub(super) empty_cap: EmptyCapProbe,
    pub(super) terrain_entity: Option<EntityProbe>,
    pub(super) water_entity: Option<EntityProbe>,
}

#[derive(Serialize)]
pub(super) struct LodEvalProbe {
    pub(super) distance_xz: Option<f32>,
    pub(super) high_detail_distance: f32,
    pub(super) cull_distance: f32,
    pub(super) hysteresis: f32,
    pub(super) current_lod: Option<String>,
    pub(super) computed_target_lod: Option<String>,
    pub(super) water_shore_guarded: bool,
    pub(super) water_guard_distance: f32,
    pub(super) effective_mesh_lod_now: Option<String>,
    pub(super) last_logical_lod_at_mesh: Option<String>,
    pub(super) last_meshed_lod: Option<String>,
    pub(super) mesh_lod_mismatch: Option<bool>,
    pub(super) mesh_status: LodMeshStatus,
    pub(super) remesh_pending: bool,
    pub(super) remesh_reason_flags: u8,
    pub(super) remesh_reasons: Vec<String>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum LodMeshStatus {
    Current,
    RemeshPending,
    Stale,
    DebugUnavailable,
}

#[derive(Serialize)]
pub(super) struct EmptyCapProbe {
    pub(super) is_empty: bool,
    pub(super) empty_surface_cap_candidate: bool,
    pub(super) below_chunk_uniformity: Option<String>,
    pub(super) above_chunk_uniformity: Option<String>,
    pub(super) below_plane_solid_count: u32,
    pub(super) above_plane_solid_count: u32,
}

#[derive(Serialize)]
pub(super) struct EntityProbe {
    pub(super) entity: String,
    pub(super) chunk_mesh: Option<ChunkMeshProbe>,
    pub(super) visibility: Option<String>,
    pub(super) inherited_visibility: Option<bool>,
    pub(super) view_visibility: Option<bool>,
    pub(super) has_chunk_mesh: bool,
    pub(super) has_water_mesh: bool,
    pub(super) has_needs_collider: bool,
    pub(super) has_chunk_collider: bool,
    pub(super) has_collider: bool,
    pub(super) has_static_rigid_body: bool,
}

#[derive(Serialize)]
pub(super) struct ChunkMeshProbe {
    pub(super) chunk_position: IVec3Dump,
    pub(super) vertex_count: u32,
    pub(super) triangle_count: u32,
    pub(super) mesh_mode: String,
    pub(super) material_quality: String,
    pub(super) logical_lod_at_mesh: Option<String>,
    pub(super) effective_lod_at_mesh: Option<String>,
    pub(super) target_mode_at_mesh: Option<String>,
    pub(super) neighbor_lods_at_mesh: Option<NeighborLodsProbe>,
    pub(super) lod_delta_gt_one_faces_at_mesh: Option<Vec<String>>,
    pub(super) missing_boundary_neighbors_at_mesh: Option<u32>,
    pub(super) empty_surface_cap_at_mesh: Option<bool>,
    pub(super) generated_frame: Option<u32>,
    pub(super) lod_transition_snap: Option<LodTransitionSnapStatsProbe>,
    pub(super) mc_transvoxel: Option<McTransvoxelStatsProbe>,
    pub(super) mesh_sections: Option<TerrainMeshSectionStatsProbe>,
}

#[derive(Serialize, Clone, Copy)]
pub(super) struct TerrainMeshSectionStatsProbe {
    pub(super) main_surface_vertex_count: u32,
    pub(super) main_surface_index_count: u32,
    pub(super) transition_apron_index_count: u32,
    pub(super) vertical_skirt_index_count: u32,
}

#[derive(Serialize, Clone)]
pub(super) struct NeighborLodsProbe {
    pub(super) neg_x: Option<String>,
    pub(super) pos_x: Option<String>,
    pub(super) neg_y: Option<String>,
    pub(super) pos_y: Option<String>,
    pub(super) neg_z: Option<String>,
    pub(super) pos_z: Option<String>,
}

#[derive(Serialize, Clone)]
pub(super) struct LodTransitionSnapStatsProbe {
    pub(super) snapped_face_mask: u8,
    pub(super) fallback_face_mask: u8,
    pub(super) snapped_faces: Vec<String>,
    pub(super) fallback_faces: Vec<String>,
    pub(super) boundary_candidate_vertex_count: u32,
    pub(super) morph_target_vertex_count: u32,
    pub(super) morph_missing_target_vertex_count: u32,
    pub(super) snapped_vertex_count: u32,
    pub(super) skipped_vertex_count: u32,
    pub(super) conflicting_vertex_count: u32,
}

#[derive(Serialize, Clone, Copy)]
pub(super) struct McTransvoxelStatsProbe {
    pub(super) regular_chunks_meshed: u32,
    pub(super) transition_faces_meshed: [u32; 6],
    pub(super) transition_triangles_total: u32,
    pub(super) skipped_lod_delta_gt_one: u32,
    pub(super) skipped_missing_neighbor: u32,
    pub(super) mesh_generation_ms_total: f32,
    pub(super) triangle_count_regular: u32,
    pub(super) triangle_count_transition: u32,
}

#[derive(Serialize, Clone, Copy)]
pub(super) struct Vec3Dump {
    pub(super) x: f32,
    pub(super) y: f32,
    pub(super) z: f32,
}

#[derive(Serialize, Clone, Copy)]
pub(super) struct Vec2Dump {
    pub(super) x: f32,
    pub(super) y: f32,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
pub(super) struct IVec3Dump {
    pub(super) x: i32,
    pub(super) y: i32,
    pub(super) z: i32,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
pub(super) struct IVec2Dump {
    pub(super) x: i32,
    pub(super) y: i32,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
pub(super) struct UVec3Dump {
    pub(super) x: u32,
    pub(super) y: u32,
    pub(super) z: u32,
}

pub type TerrainEntityQuery<'w, 's> = Query<
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

pub(super) struct VisualProbeContext<'a> {
    pub(super) camera_pos: Vec3,
    pub(super) camera_forward: Vec3,
    pub(super) camera_right: Vec3,
    pub(super) camera_up: Vec3,
    pub(super) projection: &'a Projection,
    pub(super) window_size: Option<Vec2>,
    pub(super) image: Option<&'a ProbeImage>,
    pub(super) screenshot_path: Option<&'a PathBuf>,
}

pub(super) struct ProbeImage {
    pub(super) path: PathBuf,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) pixels: Vec<u8>,
}

#[derive(Deserialize)]
pub(super) struct TerrainDebugCaptureSidecarProbe {
    pub(super) camera_pos: [f32; 3],
    pub(super) camera_rot: Option<[f32; 4]>,
}

pub(super) const TERRAIN_DEBUG_CAPTURE_MAX_AGE_SECS: u64 = 10 * 60;
pub(super) const TERRAIN_DEBUG_CAPTURE_CAMERA_EPSILON: f32 = 0.75;
pub(super) const TERRAIN_DEBUG_CAPTURE_CAMERA_FORWARD_DOT_MIN: f32 = 0.999;

pub(super) fn chunk_face_name(face: ChunkFace) -> &'static str {
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
