//! Deterministic LOD seam audit pass for bench mode and debug dumps.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy_mesh::VertexAttributeValues;
use serde::Serialize;

use crate::constants::{CHUNK_SIZE_I32, VOXEL_SIZE};
use crate::performance::AreaTimingRecorder;
use crate::voxel::chunk::LodLevel;
use crate::voxel::hole_probe::TerrainEntityQuery;
use crate::voxel::meshing::{
    SeamFaceAudit, SeamFaceMode, SeamStripOverlapSource, SeamStripRejectReason, SeamStripStatus,
    XZ_FACES, barycentric_section, coarse_lod_iso_height_for_column,
    neighbor_lod_for_face, strip_reject_reason_from_overlap_status, transition_target_lod,
    xz_face_index,
};
use crate::voxel::lod_boundary_strip::{
    LodBoundaryStrip, StripOverlapConfig, StripOverlapStatus, StripVertex,
    audit_projected_strip_overlap, lod_boundary_strip_from_compact, project_to_seam_frame,
};
use crate::voxel::skirt::ChunkFace;
use crate::voxel::world::VoxelWorld;

pub const SEAM_AUDIT_SCHEMA_VERSION: u32 = 4;
pub const SEAM_COVERAGE_GRID_U: u32 = 17;
pub const SEAM_COVERAGE_GRID_V: u32 = 17;
const LIP_HEIGHT_FAIL_VOXELS: f32 = 0.20;
const COVERAGE_TOLERANCE_VOXELS: f32 = 1.0;
const EDGE_QUANTIZE_SCALE: f32 = 10000.0;

#[derive(Clone, Debug)]
pub struct TerrainSeamAuditRequest {
    pub trigger: String,
    pub output_dir: PathBuf,
    pub checkpoint_name: String,
    pub run_index: u32,
}

#[derive(Resource, Default)]
pub struct TerrainSeamAuditRequests {
    pub pending: Vec<TerrainSeamAuditRequest>,
}

impl TerrainSeamAuditRequests {
    pub fn push(&mut self, request: TerrainSeamAuditRequest) {
        self.pending.push(request);
    }
}

#[derive(Serialize)]
pub struct SeamAuditFaceRecord {
    pub source_chunk: [i32; 3],
    pub neighbor_chunk: [i32; 3],
    pub face: String,
    pub fine_lod: String,
    pub coarse_lod: String,
    pub final_mode: String,
    pub strip_status: String,
    pub fine_components: u8,
    pub coarse_components: u8,
    pub morph_candidate_count: u16,
    pub morph_welded_count: u16,
    pub morph_missing_count: u16,
    pub stitch_triangle_count: u16,
    pub skirt_triangle_count: u16,
    pub sealed_by_mask: bool,
    pub samples_total: u16,
    pub samples_without_render_coverage: u16,
    pub max_lip_height_voxels: f32,
    pub max_face_offset_voxels: f32,
    pub longest_unmatched_edge_voxels: f32,
    pub unmatched_transition_edges: u16,
    pub unmatched_regular_edges: u16,
    pub possible_terrace_samples: u16,
    pub strip_overlap_status: String,
    pub strip_compatible: bool,
    pub strip_max_fine_to_coarse_distance: f32,
    pub strip_max_coarse_to_fine_distance: f32,
    pub strip_max_endpoint_distance: f32,
    pub strip_span_overlap_ratio: f32,
    pub strip_fine_span_min: f32,
    pub strip_fine_span_max: f32,
    pub strip_coarse_span_min: f32,
    pub strip_coarse_span_max: f32,
    pub strip_unmatched_fine_segments: u16,
    pub strip_unmatched_coarse_segments: u16,
    pub strip_crossing_count: u16,
    pub strip_reject_reason: String,
    pub strip_overlap_source: String,
}

#[derive(Serialize, Default)]
pub struct SeamAuditSummary {
    pub active_seam_faces: u32,
    pub partial_morph_uncovered_faces: u32,
    pub open_edge_faces: u32,
    pub samples_without_render_coverage: u32,
    pub possible_terrace_samples: u32,
    pub stale_strip_faces: u32,
    pub lod_delta_gt_one_faces: u32,
    pub max_lip_height_voxels: f32,
    pub max_face_offset_voxels: f32,
    pub max_longest_unmatched_edge_voxels: f32,
    pub strip_incompatible_faces: u32,
    pub strip_missing_faces: u32,
    pub strip_topology_unsupported_faces: u32,
    /// Raw observed maximum across all active seam faces (includes fallback faces).
    pub max_strip_fine_to_coarse_distance: f32,
    /// Raw observed maximum across all active seam faces (includes fallback faces).
    pub max_strip_coarse_to_fine_distance: f32,
    /// Raw observed maximum across all active seam faces (includes fallback faces).
    pub max_strip_endpoint_distance: f32,
    /// Maximum directed fine→coarse distance on stitch-safe faces only.
    pub max_strip_fine_to_coarse_distance_stitch_safe: f32,
    /// Maximum directed coarse→fine distance on stitch-safe faces only.
    pub max_strip_coarse_to_fine_distance_stitch_safe: f32,
    /// Maximum endpoint distance on stitch-safe faces only.
    pub max_strip_endpoint_distance_stitch_safe: f32,
    /// Minimum span overlap ratio where the oracle status is geometrically meaningful.
    pub min_strip_span_overlap_ratio: f32,
}

#[derive(Serialize)]
pub struct SeamAuditDump {
    pub schema_version: u32,
    pub trigger: String,
    pub checkpoint: String,
    pub run_index: u32,
    pub summary: SeamAuditSummary,
    pub faces: Vec<SeamAuditFaceRecord>,
}

#[derive(Resource, Clone, Copy, Debug)]
pub struct StripOverlapSettings(pub StripOverlapConfig);

impl Default for StripOverlapSettings {
    fn default() -> Self {
        Self(StripOverlapConfig::load_or_default())
    }
}

pub struct SeamAuditPassPlugin;

impl Plugin for SeamAuditPassPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TerrainSeamAuditRequests>()
            .init_resource::<StripOverlapSettings>()
            .add_systems(Update, run_pending_seam_audit_pass);
    }
}

fn run_pending_seam_audit_pass(
    mut requests: ResMut<TerrainSeamAuditRequests>,
    world: Res<VoxelWorld>,
    terrain_entities: TerrainEntityQuery,
    meshes: Res<Assets<Mesh>>,
    strip_overlap: Res<StripOverlapSettings>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let Some(request) = requests.pending.pop() else {
        return;
    };
    let dump = build_seam_audit_dump(
        &request.trigger,
        &request.checkpoint_name,
        request.run_index,
        &world,
        &terrain_entities,
        &meshes,
        strip_overlap.0,
    );
    record_seam_audit_counters(frame.0, &mut timing, &dump.summary);
    if let Err(err) = write_seam_audit_dump(&request.output_dir, &dump) {
        warn!("failed to write seam audit dump: {err}");
    }
}

pub fn build_seam_audit_dump(
    trigger: &str,
    checkpoint: &str,
    run_index: u32,
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    strip_overlap_config: StripOverlapConfig,
) -> SeamAuditDump {
    let mut faces = Vec::new();
    let mut summary = SeamAuditSummary::default();
    summary.min_strip_span_overlap_ratio = 1.0;

    for chunk_pos in world.chunk_positions().collect::<Vec<_>>() {
        let Some(entity) = world.get_chunk(chunk_pos).and_then(|c| c.mesh_entity()) else {
            continue;
        };
        let Ok((_, _, _, _, Some(debug), ..)) = terrain_entities.get(entity) else {
            continue;
        };

        for (face_idx, face) in XZ_FACES.iter().enumerate() {
            let Some(neighbor_lod) = neighbor_lod_for_face(&debug.neighbor_lods_at_mesh, *face) else {
                continue;
            };
            if !neighbor_lod.is_lower_detail_than(debug.effective_lod_at_mesh) {
                continue;
            }
            if transition_target_lod(debug.effective_lod_at_mesh, neighbor_lod).is_none() {
                if debug.lod_delta_gt_one_face_mask & (1 << *face as u8) != 0 {
                    summary.lod_delta_gt_one_faces += 1;
                }
                continue;
            }

            let mut audit = debug.seam_face_audit[face_idx];
            let neighbor_chunk = chunk_pos + face.direction();
            enhance_audit_with_coverage(
                world,
                terrain_entities,
                meshes,
                chunk_pos,
                *face,
                debug.effective_lod_at_mesh,
                neighbor_lod,
                &mut audit,
            );
            enhance_audit_with_edge_leak(
                world,
                terrain_entities,
                meshes,
                chunk_pos,
                *face,
                &mut audit,
            );
            enhance_audit_with_strip_overlap(
                world,
                terrain_entities,
                meshes,
                chunk_pos,
                *face,
                debug.effective_lod_at_mesh,
                neighbor_lod,
                strip_overlap_config,
                &mut audit,
            );

            summary.active_seam_faces += 1;
            if audit.is_partial_morph_uncovered() {
                summary.partial_morph_uncovered_faces += 1;
            }
            if audit.has_open_seam_edges() {
                summary.open_edge_faces += 1;
            }
            summary.samples_without_render_coverage += audit.samples_without_render_coverage as u32;
            summary.possible_terrace_samples += audit.possible_terrace_samples as u32;
            if audit.strip_status == SeamStripStatus::StaleRevision {
                summary.stale_strip_faces += 1;
            }
            summary.max_lip_height_voxels = summary
                .max_lip_height_voxels
                .max(audit.max_lip_height_voxels);
            summary.max_face_offset_voxels = summary
                .max_face_offset_voxels
                .max(audit.max_face_offset_voxels);
            summary.max_longest_unmatched_edge_voxels = summary
                .max_longest_unmatched_edge_voxels
                .max(audit.longest_unmatched_edge_voxels);
            update_strip_distance_summary(&mut summary, &audit);
            if strip_span_overlap_ratio_counts_for_summary(audit.strip_overlap_status) {
                summary.min_strip_span_overlap_ratio = summary
                    .min_strip_span_overlap_ratio
                    .min(audit.strip_span_overlap_ratio);
            }
            if !audit.strip_compatible {
                summary.strip_incompatible_faces += 1;
            }
            if matches!(
                audit.strip_overlap_status,
                StripOverlapStatus::MissingFineStrip | StripOverlapStatus::MissingCoarseStrip
            ) {
                summary.strip_missing_faces += 1;
            }
            if matches!(
                audit.strip_overlap_status,
                StripOverlapStatus::UnsupportedTopology
                    | StripOverlapStatus::FineMultiComponent
                    | StripOverlapStatus::CoarseMultiComponent
                    | StripOverlapStatus::ComponentMismatch
            ) {
                summary.strip_topology_unsupported_faces += 1;
            }

            faces.push(face_record(
                chunk_pos,
                neighbor_chunk,
                *face,
                debug.effective_lod_at_mesh,
                neighbor_lod,
                audit,
            ));
        }
    }

    faces.sort_by(|a, b| {
        a.source_chunk
            .cmp(&b.source_chunk)
            .then(a.face.cmp(&b.face))
    });

    SeamAuditDump {
        schema_version: SEAM_AUDIT_SCHEMA_VERSION,
        trigger: trigger.to_string(),
        checkpoint: checkpoint.to_string(),
        run_index,
        summary,
        faces,
    }
}

fn enhance_audit_with_coverage(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    source_chunk: IVec3,
    face: ChunkFace,
    fine_lod: LodLevel,
    coarse_lod: LodLevel,
    audit: &mut SeamFaceAudit,
) {
    let source_origin = VoxelWorld::chunk_to_world(source_chunk).as_vec3();
    let mut samples_total = 0u16;
    let mut missing = 0u16;
    let mut terrace = 0u16;
    let mut max_lip = 0.0f32;
    let mut max_offset = 0.0f32;

    for v in 0..SEAM_COVERAGE_GRID_V {
        for u in 0..SEAM_COVERAGE_GRID_U {
            let face_u = normalized_grid_coord(u, SEAM_COVERAGE_GRID_U);
            let face_v = normalized_grid_coord(v, SEAM_COVERAGE_GRID_V);
            let seam_point = seam_face_sample_point(source_origin, face, face_u, face_v);
            let expected_y = expected_iso_y(world, seam_point.x, seam_point.z, fine_lod, coarse_lod);
            let (render_hit_y, render_hit_pos, _, _, section) = highest_render_mesh_hit_at(
                world,
                terrain_entities,
                meshes,
                source_chunk,
                seam_point.x,
                seam_point.z,
                seam_point.y + CHUNK_SIZE_I32 as f32,
            );
            samples_total = samples_total.saturating_add(1);
            let Some(expected) = expected_y else {
                missing = missing.saturating_add(1);
                continue;
            };
            let Some(hit_y) = render_hit_y else {
                missing = missing.saturating_add(1);
                continue;
            };
            let lip = ((hit_y - expected) / VOXEL_SIZE).abs();
            max_lip = max_lip.max(lip);
            if lip > LIP_HEIGHT_FAIL_VOXELS {
                terrace = terrace.saturating_add(1);
            }
            if let Some(hit_pos) = render_hit_pos {
                let face_offset = face_offset_delta(seam_point, face, hit_pos);
                max_offset = max_offset.max(face_offset);
            }
            if lip > COVERAGE_TOLERANCE_VOXELS
                && matches!(
                    section,
                    Some(MeshSectionClass::VerticalSkirt) | Some(MeshSectionClass::Unknown)
                )
            {
                missing = missing.saturating_add(1);
            }
        }
    }

    audit.samples_total = samples_total;
    audit.samples_without_render_coverage = missing;
    audit.possible_terrace_samples = terrace;
    audit.max_lip_height_voxels = max_lip;
    audit.max_face_offset_voxels = max_offset;
}

fn enhance_audit_with_edge_leak(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    chunk_pos: IVec3,
    face: ChunkFace,
    audit: &mut SeamFaceAudit,
) {
    let leak = edge_leak_probe_for_face(world, terrain_entities, meshes, chunk_pos, face);
    audit.longest_unmatched_edge_voxels = leak.longest_unmatched_edge_voxels;
    audit.unmatched_transition_edges = leak.unmatched_transition_edges;
    audit.unmatched_regular_edges = leak.unmatched_regular_edges;
}

fn enhance_audit_with_strip_overlap(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    chunk_pos: IVec3,
    face: ChunkFace,
    fine_lod: LodLevel,
    coarse_lod: LodLevel,
    strip_overlap_config: StripOverlapConfig,
    audit: &mut SeamFaceAudit,
) {
    let (fine_strip, coarse_strip, overlap_source) =
        mesh_time_strips_for_overlap(world, terrain_entities, chunk_pos, face).map_or_else(
            || {
                let fine = extract_main_surface_strip_for_face(
                    world,
                    terrain_entities,
                    meshes,
                    chunk_pos,
                    face,
                    fine_lod,
                );
                let neighbor_pos = chunk_pos + face.direction();
                let coarse = extract_main_surface_strip_for_face(
                    world,
                    terrain_entities,
                    meshes,
                    neighbor_pos,
                    opposite_face(face),
                    coarse_lod,
                );
                (fine, coarse, SeamStripOverlapSource::RuntimeReextract)
            },
            |(fine, coarse)| (Some(fine), Some(coarse), SeamStripOverlapSource::MeshTime),
        );

    let result = audit_projected_strip_overlap(
        fine_strip.as_ref(),
        coarse_strip.as_ref(),
        strip_overlap_config,
    );
    audit.strip_overlap_status = result.status;
    audit.strip_compatible = result.compatible;
    audit.strip_max_fine_to_coarse_distance = result.max_fine_to_coarse_distance;
    audit.strip_max_coarse_to_fine_distance = result.max_coarse_to_fine_distance;
    audit.strip_max_endpoint_distance = result.max_endpoint_distance;
    audit.strip_span_overlap_ratio = result.span_overlap_ratio;
    audit.strip_fine_span_min = result.fine_span_min;
    audit.strip_fine_span_max = result.fine_span_max;
    audit.strip_coarse_span_min = result.coarse_span_min;
    audit.strip_coarse_span_max = result.coarse_span_max;
    audit.strip_unmatched_fine_segments = result.unmatched_fine_segments;
    audit.strip_unmatched_coarse_segments = result.unmatched_coarse_segments;
    audit.strip_crossing_count = result.crossing_count;
    audit.strip_overlap_source = overlap_source;
    let overlap_reason = strip_reject_reason_from_overlap_status(result.status);
    if audit.strip_reject_reason == SeamStripRejectReason::None {
        audit.strip_reject_reason = overlap_reason;
    } else if overlap_reason != SeamStripRejectReason::None
        && !matches!(
            audit.strip_reject_reason,
            SeamStripRejectReason::MissingStrip
                | SeamStripRejectReason::StaleStrip
                | SeamStripRejectReason::MultiComponentStrip
        )
    {
        audit.strip_reject_reason = overlap_reason;
    }
}

fn mesh_time_strips_for_overlap(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    chunk_pos: IVec3,
    face: ChunkFace,
) -> Option<(LodBoundaryStrip, LodBoundaryStrip)> {
    let face_idx = xz_face_index(face)?;
    let fine_entity = world.get_chunk(chunk_pos)?.mesh_entity()?;
    let neighbor_pos = chunk_pos + face.direction();
    let coarse_entity = world.get_chunk(neighbor_pos)?.mesh_entity()?;
    let Ok((_, _, _, _, _, _, _, _, _, _, _, _, _, _, fine_debug)) =
        terrain_entities.get(fine_entity)
    else {
        return None;
    };
    let Ok((_, _, _, _, _, _, _, _, _, _, _, _, _, _, coarse_debug)) =
        terrain_entities.get(coarse_entity)
    else {
        return None;
    };
    let fine_compact = fine_debug.as_ref()?.strips[face_idx].as_ref()?;
    let coarse_face_idx = xz_face_index(opposite_face(face))?;
    let coarse_compact = coarse_debug.as_ref()?.strips[coarse_face_idx].as_ref()?;
    Some((
        lod_boundary_strip_from_compact(fine_compact),
        lod_boundary_strip_from_compact(coarse_compact),
    ))
}

struct EdgeLeakResult {
    longest_unmatched_edge_voxels: f32,
    unmatched_transition_edges: u16,
    unmatched_regular_edges: u16,
}

fn edge_leak_probe_for_face(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    chunk_pos: IVec3,
    face: ChunkFace,
) -> EdgeLeakResult {
    let mut result = EdgeLeakResult {
        longest_unmatched_edge_voxels: 0.0,
        unmatched_transition_edges: 0,
        unmatched_regular_edges: 0,
    };
    let Some(entity) = world.get_chunk(chunk_pos).and_then(|c| c.mesh_entity()) else {
        return result;
    };
    let Ok((_, mesh3d, transform, _, terrain_debug, ..)) = terrain_entities.get(entity) else {
        return result;
    };
    let Some(mesh3d) = mesh3d else {
        return result;
    };
    let Some(mesh) = meshes.get(&mesh3d.0) else {
        return result;
    };
    let translation = transform
        .map(|t| t.translation)
        .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
    let open_edges = open_seam_edges_on_face(mesh, translation, chunk_pos, face);
    for edge in open_edges {
        let length_voxels = edge.length / VOXEL_SIZE;
        result.longest_unmatched_edge_voxels = result.longest_unmatched_edge_voxels.max(length_voxels);
        match edge.section {
            MeshSectionClass::MainSurface => {
                result.unmatched_regular_edges = result.unmatched_regular_edges.saturating_add(1);
            }
            MeshSectionClass::TransitionGeometry | MeshSectionClass::HorizontalSkirt => {
                result.unmatched_transition_edges = result.unmatched_transition_edges.saturating_add(1);
            }
            MeshSectionClass::VerticalSkirt => {
                result.unmatched_transition_edges = result.unmatched_transition_edges.saturating_add(1);
            }
            MeshSectionClass::Unknown => {
                result.unmatched_regular_edges = result.unmatched_regular_edges.saturating_add(1);
            }
        }
        let _ = terrain_debug;
    }
    result
}

struct OpenSeamEdge {
    length: f32,
    section: MeshSectionClass,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MeshSectionClass {
    MainSurface,
    HorizontalSkirt,
    VerticalSkirt,
    TransitionGeometry,
    Unknown,
}

fn open_seam_edges_on_face(
    mesh: &Mesh,
    translation: Vec3,
    chunk_pos: IVec3,
    face: ChunkFace,
) -> Vec<OpenSeamEdge> {
    let positions = mesh_attribute_positions(mesh);
    let indices = mesh_triangle_indices(mesh);
    let barycentrics = mesh_attribute_uv1(mesh);
    if positions.is_empty() || indices.len() < 3 {
        return Vec::new();
    }

    let mut edge_counts: HashMap<WorldEdgeKey, (u8, MeshSectionClass, f32)> = HashMap::new();
    for tri_start in (0..indices.len()).step_by(3) {
        let i0 = indices[tri_start] as usize;
        let section = triangle_section(&barycentrics, i0);
        let tri_edges = [
            (indices[tri_start], indices[tri_start + 1]),
            (indices[tri_start + 1], indices[tri_start + 2]),
            (indices[tri_start + 2], indices[tri_start]),
        ];
        for (a, b) in tri_edges {
            let p0 = positions[a as usize] + translation;
            let p1 = positions[b as usize] + translation;
            if !edge_on_chunk_face(p0, p1, chunk_pos, face) {
                continue;
            }
            let length = p0.distance(p1);
            let key = world_edge_key(p0, p1, face);
            let entry = edge_counts.entry(key).or_insert((0, section, length));
            entry.0 = entry.0.saturating_add(1);
            entry.2 = entry.2.max(length);
        }
    }

    edge_counts
        .into_values()
        .filter(|(count, _, _)| *count == 1)
        .map(|(_, section, length)| OpenSeamEdge { length, section })
        .collect()
}

fn mesh_attribute_positions(mesh: &Mesh) -> Vec<Vec3> {
    match mesh.attribute(Mesh::ATTRIBUTE_POSITION) {
        Some(VertexAttributeValues::Float32x3(values)) => values
            .iter()
            .map(|p| Vec3::from_array(*p))
            .collect(),
        _ => Vec::new(),
    }
}

fn mesh_attribute_uv1(mesh: &Mesh) -> Vec<[f32; 2]> {
    match mesh.attribute(Mesh::ATTRIBUTE_UV_1) {
        Some(VertexAttributeValues::Float32x2(values)) => values.clone(),
        _ => Vec::new(),
    }
}

fn mesh_triangle_indices(mesh: &Mesh) -> Vec<u32> {
    match mesh.indices() {
        Some(bevy_mesh::Indices::U32(values)) => values.clone(),
        _ => Vec::new(),
    }
}

fn triangle_section(barycentrics: &[[f32; 2]], vertex_index: usize) -> MeshSectionClass {
    let Some(uv) = barycentrics.get(vertex_index) else {
        return MeshSectionClass::Unknown;
    };
    match barycentric_section(*uv) {
        0 => MeshSectionClass::MainSurface,
        1 => MeshSectionClass::HorizontalSkirt,
        2 => MeshSectionClass::VerticalSkirt,
        3 => MeshSectionClass::TransitionGeometry,
        _ => MeshSectionClass::Unknown,
    }
}

fn edge_on_chunk_face(a: Vec3, b: Vec3, chunk_pos: IVec3, face: ChunkFace) -> bool {
    const EPS: f32 = 0.05;
    let origin = VoxelWorld::chunk_to_world(chunk_pos).as_vec3();
    let face_coord = match face {
        ChunkFace::NegX => origin.x,
        ChunkFace::PosX => origin.x + CHUNK_SIZE_I32 as f32,
        ChunkFace::NegZ => origin.z,
        ChunkFace::PosZ => origin.z + CHUNK_SIZE_I32 as f32,
        _ => return false,
    };
    let (a_coord, b_coord) = match face {
        ChunkFace::NegX | ChunkFace::PosX => (a.x, b.x),
        ChunkFace::NegZ | ChunkFace::PosZ => (a.z, b.z),
        _ => return false,
    };
    (a_coord - face_coord).abs() <= EPS && (b_coord - face_coord).abs() <= EPS
}

fn normalized_grid_coord(index: u32, count: u32) -> f32 {
    if count <= 1 {
        0.5
    } else {
        index as f32 / (count - 1) as f32
    }
}

fn seam_face_sample_point(chunk_origin: Vec3, face: ChunkFace, face_u: f32, face_v: f32) -> Vec3 {
    let size = CHUNK_SIZE_I32 as f32;
    let u = face_u.clamp(0.0, 1.0);
    let v = face_v.clamp(0.0, 1.0);
    match face {
        ChunkFace::NegX => Vec3::new(
            chunk_origin.x,
            chunk_origin.y + size * v,
            chunk_origin.z + size * u,
        ),
        ChunkFace::PosX => Vec3::new(
            chunk_origin.x + size,
            chunk_origin.y + size * v,
            chunk_origin.z + size * u,
        ),
        ChunkFace::NegZ => Vec3::new(
            chunk_origin.x + size * u,
            chunk_origin.y + size * v,
            chunk_origin.z,
        ),
        ChunkFace::PosZ => Vec3::new(
            chunk_origin.x + size * u,
            chunk_origin.y + size * v,
            chunk_origin.z + size,
        ),
        _ => chunk_origin,
    }
}

fn expected_iso_y(
    world: &VoxelWorld,
    world_x: f32,
    world_z: f32,
    fine_lod: LodLevel,
    coarse_lod: LodLevel,
) -> Option<f32> {
    let world_x = world_x.floor() as i32;
    let world_z = world_z.floor() as i32;
    let fine = coarse_lod_iso_height_for_column(world, world_x, world_z, fine_lod);
    let coarse = coarse_lod_iso_height_for_column(world, world_x, world_z, coarse_lod);
    fine.zip(coarse)
        .map(|(f, c)| (f + c) * 0.5)
        .or(fine)
        .or(coarse)
}

fn face_offset_delta(seam_point: Vec3, face: ChunkFace, hit_pos: Vec3) -> f32 {
    let plane_coord = seam_plane_coordinate(seam_point, face);
    let hit_coord = seam_plane_coordinate(hit_pos, face);
    (hit_coord - plane_coord).abs() / VOXEL_SIZE
}

fn seam_plane_coordinate(point: Vec3, face: ChunkFace) -> f32 {
    match face {
        ChunkFace::NegX | ChunkFace::PosX => point.x,
        ChunkFace::NegZ | ChunkFace::PosZ => point.z,
        _ => 0.0,
    }
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct QuantizedWorldPos {
    x: i32,
    y: i32,
    z: i32,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct WorldEdgeKey {
    a: QuantizedWorldPos,
    b: QuantizedWorldPos,
    face: ChunkFace,
}

fn quantize_world_pos(pos: Vec3) -> QuantizedWorldPos {
    QuantizedWorldPos {
        x: (pos.x * EDGE_QUANTIZE_SCALE).round() as i32,
        y: (pos.y * EDGE_QUANTIZE_SCALE).round() as i32,
        z: (pos.z * EDGE_QUANTIZE_SCALE).round() as i32,
    }
}

fn ordered_world_edge(a: QuantizedWorldPos, b: QuantizedWorldPos) -> (QuantizedWorldPos, QuantizedWorldPos) {
    if (a.x, a.y, a.z) <= (b.x, b.y, b.z) {
        (a, b)
    } else {
        (b, a)
    }
}

fn world_edge_key(p0: Vec3, p1: Vec3, face: ChunkFace) -> WorldEdgeKey {
    let (a, b) = ordered_world_edge(quantize_world_pos(p0), quantize_world_pos(p1));
    WorldEdgeKey { a, b, face }
}

fn update_strip_distance_summary(summary: &mut SeamAuditSummary, audit: &SeamFaceAudit) {
    summary.max_strip_fine_to_coarse_distance = summary
        .max_strip_fine_to_coarse_distance
        .max(audit.strip_max_fine_to_coarse_distance);
    summary.max_strip_coarse_to_fine_distance = summary
        .max_strip_coarse_to_fine_distance
        .max(audit.strip_max_coarse_to_fine_distance);
    summary.max_strip_endpoint_distance = summary
        .max_strip_endpoint_distance
        .max(audit.strip_max_endpoint_distance);
    if audit.final_mode.claims_stitch_safe_seam() {
        summary.max_strip_fine_to_coarse_distance_stitch_safe = summary
            .max_strip_fine_to_coarse_distance_stitch_safe
            .max(audit.strip_max_fine_to_coarse_distance);
        summary.max_strip_coarse_to_fine_distance_stitch_safe = summary
            .max_strip_coarse_to_fine_distance_stitch_safe
            .max(audit.strip_max_coarse_to_fine_distance);
        summary.max_strip_endpoint_distance_stitch_safe = summary
            .max_strip_endpoint_distance_stitch_safe
            .max(audit.strip_max_endpoint_distance);
    }
}

fn strip_span_overlap_ratio_counts_for_summary(status: StripOverlapStatus) -> bool {
    matches!(
        status,
        StripOverlapStatus::Compatible
            | StripOverlapStatus::SpanMismatch
            | StripOverlapStatus::DirectedDistanceExceeded
            | StripOverlapStatus::EndpointDistanceExceeded
            | StripOverlapStatus::CrossingOrFoldDetected
    )
}

fn world_pos_in_face_band(world_pos: Vec3, chunk_pos: IVec3, face: ChunkFace, lod: LodLevel) -> bool {
    let origin = VoxelWorld::chunk_to_world(chunk_pos).as_vec3();
    let local = world_pos - origin;
    let band = lod.step_size().max(1) as f32;
    let size = CHUNK_SIZE_I32 as f32;
    match face {
        ChunkFace::NegX => local.x <= band,
        ChunkFace::PosX => local.x >= size - band,
        ChunkFace::NegZ => local.z <= band,
        ChunkFace::PosZ => local.z >= size - band,
        _ => false,
    }
}

fn opposite_face(face: ChunkFace) -> ChunkFace {
    match face {
        ChunkFace::NegX => ChunkFace::PosX,
        ChunkFace::PosX => ChunkFace::NegX,
        ChunkFace::NegZ => ChunkFace::PosZ,
        ChunkFace::PosZ => ChunkFace::NegZ,
        ChunkFace::NegY => ChunkFace::PosY,
        ChunkFace::PosY => ChunkFace::NegY,
    }
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct StripQuantizedPos {
    x: i32,
    y: i32,
    z: i32,
}

#[derive(Clone, Copy, Hash, PartialEq, Eq)]
struct StripEdgeKey {
    a: StripQuantizedPos,
    b: StripQuantizedPos,
}

fn extract_main_surface_strip_for_face(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    chunk_pos: IVec3,
    face: ChunkFace,
    lod: LodLevel,
) -> Option<LodBoundaryStrip> {
    let entity = world.get_chunk(chunk_pos).and_then(|chunk| chunk.mesh_entity())?;
    let Ok((_, mesh3d, transform, _, _, ..)) = terrain_entities.get(entity) else {
        return None;
    };
    let mesh3d = mesh3d?;
    let mesh = meshes.get(&mesh3d.0)?;
    let positions = mesh_attribute_positions(mesh);
    let indices = mesh_triangle_indices(mesh);
    let barycentrics = mesh_attribute_uv1(mesh);
    if positions.is_empty() || indices.is_empty() {
        return None;
    }
    let translation = transform
        .map(|t| t.translation)
        .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());

    let mut vertex_index: HashMap<StripQuantizedPos, u32> = HashMap::new();
    let mut vertices: Vec<StripVertex> = Vec::new();
    let mut edge_counts: HashMap<StripEdgeKey, u32> = HashMap::new();

    for tri_start in (0..indices.len()).step_by(3) {
        let i0 = indices[tri_start] as usize;
        if triangle_section(&barycentrics, i0) != MeshSectionClass::MainSurface {
            continue;
        }
        for (a, b) in [
            (indices[tri_start], indices[tri_start + 1]),
            (indices[tri_start + 1], indices[tri_start + 2]),
            (indices[tri_start + 2], indices[tri_start]),
        ] {
            let pa = positions[a as usize] + translation;
            let pb = positions[b as usize] + translation;
            if !world_pos_in_face_band(pa, chunk_pos, face, lod)
                || !world_pos_in_face_band(pb, chunk_pos, face, lod)
            {
                continue;
            }
            let qa = StripQuantizedPos {
                x: (pa.x * EDGE_QUANTIZE_SCALE).round() as i32,
                y: (pa.y * EDGE_QUANTIZE_SCALE).round() as i32,
                z: (pa.z * EDGE_QUANTIZE_SCALE).round() as i32,
            };
            let qb = StripQuantizedPos {
                x: (pb.x * EDGE_QUANTIZE_SCALE).round() as i32,
                y: (pb.y * EDGE_QUANTIZE_SCALE).round() as i32,
                z: (pb.z * EDGE_QUANTIZE_SCALE).round() as i32,
            };
            let ia = *vertex_index.entry(qa).or_insert_with(|| {
                let idx = vertices.len() as u32;
                vertices.push(StripVertex {
                    local: pa - translation,
                    world: pa,
                    normal: Vec3::ZERO,
                    proj: project_to_seam_frame(face, pa),
                });
                idx
            });
            let ib = *vertex_index.entry(qb).or_insert_with(|| {
                let idx = vertices.len() as u32;
                vertices.push(StripVertex {
                    local: pb - translation,
                    world: pb,
                    normal: Vec3::ZERO,
                    proj: project_to_seam_frame(face, pb),
                });
                idx
            });
            if ia == ib {
                continue;
            }
            let (ea, eb) = if (qa.x, qa.y, qa.z) <= (qb.x, qb.y, qb.z) {
                (qa, qb)
            } else {
                (qb, qa)
            };
            *edge_counts.entry(StripEdgeKey { a: ea, b: eb }).or_insert(0) += 1;
        }
    }

    let mut segments = Vec::new();
    for (key, count) in edge_counts {
        if count != 1 {
            continue;
        }
        let ia = vertex_index.get(&key.a).copied();
        let ib = vertex_index.get(&key.b).copied();
        if let (Some(a), Some(b)) = (ia, ib) {
            segments.push([a, b]);
        }
    }
    if segments.is_empty() {
        return None;
    }
    Some(LodBoundaryStrip {
        face,
        lod,
        chunk_pos,
        revision: 0,
        vertices,
        segments,
    })
}

fn highest_render_mesh_hit_at(
    world: &VoxelWorld,
    terrain_entities: &TerrainEntityQuery,
    meshes: &Assets<Mesh>,
    center_chunk: IVec3,
    world_x: f32,
    world_z: f32,
    origin_y: f32,
) -> (Option<f32>, Option<Vec3>, Option<IVec3>, Option<Entity>, Option<MeshSectionClass>) {
    let mut best: Option<(f32, Vec3, IVec3, Entity, MeshSectionClass)> = None;
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
                let Ok((entity_id, mesh3d, transform, chunk_mesh, _, ..)) =
                    terrain_entities.get(entity)
                else {
                    continue;
                };
                let Some(mesh3d) = mesh3d else {
                    continue;
                };
                let Some(mesh) = meshes.get(&mesh3d.0) else {
                    continue;
                };
                let translation = transform
                    .map(|t| t.translation)
                    .unwrap_or_else(|| VoxelWorld::chunk_to_world(chunk_pos).as_vec3());
                let Some((hit_y, hit_pos, section)) =
                    vertical_mesh_hit(mesh, translation, world_x, world_z, origin_y)
                else {
                    continue;
                };
                if best.as_ref().map_or(true, |(best_y, _, _, _, _)| hit_y > *best_y) {
                    let hit_chunk = chunk_mesh
                        .map(|c| c.chunk_position)
                        .unwrap_or(chunk_pos);
                    best = Some((hit_y, hit_pos, hit_chunk, entity_id, section));
                }
            }
        }
    }
    match best {
        Some((y, hit_pos, chunk, entity, section)) => {
            (Some(y), Some(hit_pos), Some(chunk), Some(entity), Some(section))
        }
        None => (None, None, None, None, None),
    }
}

fn vertical_mesh_hit(
    mesh: &Mesh,
    translation: Vec3,
    world_x: f32,
    world_z: f32,
    origin_y: f32,
) -> Option<(f32, Vec3, MeshSectionClass)> {
    let positions = mesh_attribute_positions(mesh);
    let indices = mesh_triangle_indices(mesh);
    let barycentrics = mesh_attribute_uv1(mesh);
    let mut best_y: Option<f32> = None;
    let mut best_pos: Option<Vec3> = None;
    let mut best_section = MeshSectionClass::Unknown;
    for tri_start in (0..indices.len()).step_by(3) {
        let verts = [
            positions[indices[tri_start] as usize] + translation,
            positions[indices[tri_start + 1] as usize] + translation,
            positions[indices[tri_start + 2] as usize] + translation,
        ];
        if let Some((y, hit_pos)) =
            vertical_ray_triangle_hit(world_x, world_z, origin_y, verts[0], verts[1], verts[2])
        {
            if best_y.map_or(true, |best| y > best) {
                best_y = Some(y);
                best_section = triangle_section(
                    &barycentrics,
                    indices[tri_start] as usize,
                );
                best_pos = Some(hit_pos);
            }
        }
    }
    best_y.map(|y| (y, best_pos.unwrap_or(Vec3::new(world_x, y, world_z)), best_section))
}

fn vertical_ray_triangle_hit(
    x: f32,
    z: f32,
    origin_y: f32,
    p0: Vec3,
    p1: Vec3,
    p2: Vec3,
) -> Option<(f32, Vec3)> {
    let denom = (p1.z - p2.z) * (p0.x - p2.x) + (p2.x - p1.x) * (p0.z - p2.z);
    if denom.abs() < 1e-5 {
        return None;
    }
    let a = ((p1.z - p2.z) * (x - p2.x) + (p2.x - p1.x) * (z - p2.z)) / denom;
    let b = ((p2.z - p0.z) * (x - p2.x) + (p0.x - p2.x) * (z - p2.z)) / denom;
    let c = 1.0 - a - b;
    if a >= -1e-4 && b >= -1e-4 && c >= -1e-4 {
        let hit = Vec3::new(
            a * p0.x + b * p1.x + c * p2.x,
            a * p0.y + b * p1.y + c * p2.y,
            a * p0.z + b * p1.z + c * p2.z,
        );
        (hit.y <= origin_y).then_some((hit.y, hit))
    } else {
        None
    }
}

fn face_record(
    source_chunk: IVec3,
    neighbor_chunk: IVec3,
    face: ChunkFace,
    fine_lod: LodLevel,
    coarse_lod: LodLevel,
    audit: SeamFaceAudit,
) -> SeamAuditFaceRecord {
    SeamAuditFaceRecord {
        source_chunk: source_chunk.to_array(),
        neighbor_chunk: neighbor_chunk.to_array(),
        face: face_name(face),
        fine_lod: lod_name(fine_lod),
        coarse_lod: lod_name(coarse_lod),
        final_mode: mode_name(audit.final_mode),
        strip_status: strip_status_name(audit.strip_status),
        fine_components: audit.fine_components,
        coarse_components: audit.coarse_components,
        morph_candidate_count: audit.morph_candidate_count,
        morph_welded_count: audit.morph_welded_count,
        morph_missing_count: audit.morph_missing_count,
        stitch_triangle_count: audit.stitch_triangle_count,
        skirt_triangle_count: audit.skirt_triangle_count,
        sealed_by_mask: audit.sealed_by_mask,
        samples_total: audit.samples_total,
        samples_without_render_coverage: audit.samples_without_render_coverage,
        max_lip_height_voxels: audit.max_lip_height_voxels,
        max_face_offset_voxels: audit.max_face_offset_voxels,
        longest_unmatched_edge_voxels: audit.longest_unmatched_edge_voxels,
        unmatched_transition_edges: audit.unmatched_transition_edges,
        unmatched_regular_edges: audit.unmatched_regular_edges,
        possible_terrace_samples: audit.possible_terrace_samples,
        strip_overlap_status: strip_overlap_status_name(audit.strip_overlap_status),
        strip_compatible: audit.strip_compatible,
        strip_max_fine_to_coarse_distance: audit.strip_max_fine_to_coarse_distance,
        strip_max_coarse_to_fine_distance: audit.strip_max_coarse_to_fine_distance,
        strip_max_endpoint_distance: audit.strip_max_endpoint_distance,
        strip_span_overlap_ratio: audit.strip_span_overlap_ratio,
        strip_fine_span_min: audit.strip_fine_span_min,
        strip_fine_span_max: audit.strip_fine_span_max,
        strip_coarse_span_min: audit.strip_coarse_span_min,
        strip_coarse_span_max: audit.strip_coarse_span_max,
        strip_unmatched_fine_segments: audit.strip_unmatched_fine_segments,
        strip_unmatched_coarse_segments: audit.strip_unmatched_coarse_segments,
        strip_crossing_count: audit.strip_crossing_count,
        strip_reject_reason: strip_reject_reason_name(audit.strip_reject_reason),
        strip_overlap_source: strip_overlap_source_name(audit.strip_overlap_source),
    }
}

pub fn write_seam_audit_dump(output_dir: &Path, dump: &SeamAuditDump) -> std::io::Result<()> {
    fs::create_dir_all(output_dir)?;
    let path = output_dir.join("seam-audit.json");
    let json = serde_json::to_string_pretty(dump)?;
    fs::write(path, json)
}

pub fn record_seam_audit_counters(
    frame: u32,
    timing: &mut AreaTimingRecorder,
    summary: &SeamAuditSummary,
) {
    timing.record_count(
        frame,
        "Counter Seam Audit: Partial Morph Uncovered Faces",
        summary.partial_morph_uncovered_faces as f64,
    );
    timing.record_count(
        frame,
        "Counter Seam Audit: Open Edge Faces",
        summary.open_edge_faces as f64,
    );
    timing.record_count(
        frame,
        "Counter Seam Audit: Samples Without Render Coverage",
        summary.samples_without_render_coverage as f64,
    );
    timing.record_count(
        frame,
        "Counter Seam Audit: Possible Terrace Samples",
        summary.possible_terrace_samples as f64,
    );
    timing.record_count(
        frame,
        "Counter Seam Audit: Stale Strip Faces",
        summary.stale_strip_faces as f64,
    );
    timing.record_count(
        frame,
        "Counter Seam Audit: LOD Delta GT One Faces",
        summary.lod_delta_gt_one_faces as f64,
    );
    timing.record_count(
        frame,
        "Counter Seam Audit: Strip Incompatible Faces",
        summary.strip_incompatible_faces as f64,
    );
    timing.record_count(
        frame,
        "Counter Seam Audit: Strip Missing Faces",
        summary.strip_missing_faces as f64,
    );
}

fn face_name(face: ChunkFace) -> String {
    match face {
        ChunkFace::NegX => "neg_x".to_string(),
        ChunkFace::PosX => "pos_x".to_string(),
        ChunkFace::NegZ => "neg_z".to_string(),
        ChunkFace::PosZ => "pos_z".to_string(),
        ChunkFace::NegY => "neg_y".to_string(),
        ChunkFace::PosY => "pos_y".to_string(),
    }
}

fn lod_name(lod: LodLevel) -> String {
    match lod {
        LodLevel::Lod0 => "Lod0".to_string(),
        LodLevel::Lod1 => "Lod1".to_string(),
        LodLevel::Lod2 => "Lod2".to_string(),
        LodLevel::Lod3 => "Lod3".to_string(),
        LodLevel::Culled => "Culled".to_string(),
    }
}

fn mode_name(mode: SeamFaceMode) -> String {
    match mode {
        SeamFaceMode::NoTransition => "NoTransition".to_string(),
        SeamFaceMode::SameLod => "SameLod".to_string(),
        SeamFaceMode::DeltaTooLarge => "DeltaTooLarge".to_string(),
        SeamFaceMode::MissingNeighbor => "MissingNeighbor".to_string(),
        SeamFaceMode::StaleStripFallback => "StaleStripFallback".to_string(),
        SeamFaceMode::SkirtFallback => "SkirtFallback".to_string(),
        SeamFaceMode::GpuMorphOnly => "GpuMorphOnly".to_string(),
        SeamFaceMode::StitchGeometry => "StitchGeometry".to_string(),
        SeamFaceMode::InvalidUnsafeTopology => "InvalidUnsafeTopology".to_string(),
    }
}

fn strip_status_name(status: SeamStripStatus) -> String {
    match status {
        SeamStripStatus::NotNeeded => "NotNeeded".to_string(),
        SeamStripStatus::MissingNeighborChunk => "MissingNeighborChunk".to_string(),
        SeamStripStatus::MissingStrip => "MissingStrip".to_string(),
        SeamStripStatus::StaleRevision => "StaleRevision".to_string(),
        SeamStripStatus::HitCurrentRevision => "HitCurrentRevision".to_string(),
    }
}

fn strip_reject_reason_name(reason: SeamStripRejectReason) -> String {
    match reason {
        SeamStripRejectReason::None => "None".to_string(),
        SeamStripRejectReason::MissingStrip => "MissingStrip".to_string(),
        SeamStripRejectReason::StaleStrip => "StaleStrip".to_string(),
        SeamStripRejectReason::MultiComponentStrip => "MultiComponentStrip".to_string(),
        SeamStripRejectReason::SpanMismatch => "SpanMismatch".to_string(),
        SeamStripRejectReason::DirectedDistanceExceeded => {
            "DirectedDistanceExceeded".to_string()
        }
        SeamStripRejectReason::EndpointDistanceExceeded => "EndpointDistanceExceeded".to_string(),
        SeamStripRejectReason::CrossingOrFoldDetected => "CrossingOrFoldDetected".to_string(),
        SeamStripRejectReason::UnsupportedTopology => "UnsupportedTopology".to_string(),
    }
}

fn strip_overlap_source_name(source: SeamStripOverlapSource) -> String {
    match source {
        SeamStripOverlapSource::NotEvaluated => "not_evaluated".to_string(),
        SeamStripOverlapSource::MeshTime => "mesh_time".to_string(),
        SeamStripOverlapSource::RuntimeReextract => "runtime_reextract".to_string(),
    }
}

fn strip_overlap_status_name(status: StripOverlapStatus) -> String {
    match status {
        StripOverlapStatus::NotEvaluated => "NotEvaluated",
        StripOverlapStatus::Compatible => "Compatible",
        StripOverlapStatus::MissingFineStrip => "MissingFineStrip",
        StripOverlapStatus::MissingCoarseStrip => "MissingCoarseStrip",
        StripOverlapStatus::EmptyFineStrip => "EmptyFineStrip",
        StripOverlapStatus::EmptyCoarseStrip => "EmptyCoarseStrip",
        StripOverlapStatus::ComponentMismatch => "ComponentMismatch",
        StripOverlapStatus::FineMultiComponent => "FineMultiComponent",
        StripOverlapStatus::CoarseMultiComponent => "CoarseMultiComponent",
        StripOverlapStatus::SpanMismatch => "SpanMismatch",
        StripOverlapStatus::DirectedDistanceExceeded => "DirectedDistanceExceeded",
        StripOverlapStatus::EndpointDistanceExceeded => "EndpointDistanceExceeded",
        StripOverlapStatus::CrossingOrFoldDetected => "CrossingOrFoldDetected",
        StripOverlapStatus::DegenerateSegment => "DegenerateSegment",
        StripOverlapStatus::UnsupportedTopology => "UnsupportedTopology",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use bevy_mesh::PrimitiveTopology;
    use crate::voxel::world::VoxelWorld;

    fn chunk_pos_for_pos_x_face() -> IVec3 {
        IVec3::new(16, 0, 0)
    }

    fn pos_x_face_mesh_with_shared_world_edge() -> (Mesh, Vec3) {
        let translation = VoxelWorld::chunk_to_world(chunk_pos_for_pos_x_face()).as_vec3();
        let face_x = translation.x + CHUNK_SIZE_I32 as f32;
        let mut mesh = Mesh::new(
            PrimitiveTopology::TriangleList,
            bevy::asset::RenderAssetUsages::default(),
        );
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_POSITION,
            vec![
                [face_x, 0.0, 0.0],
                [face_x, 0.0, 1.0],
                [face_x, 1.0, 0.0],
                [face_x, 1.0, 0.0],
                [face_x, 0.0, 1.0],
                [face_x, 1.0, 1.0],
            ],
        );
        mesh.insert_indices(bevy_mesh::Indices::U32(vec![0, 1, 2, 3, 4, 5]));
        (mesh, translation)
    }

    #[test]
    fn duplicated_world_position_edges_cancel_for_edge_leak_probe() {
        let (mesh, translation) = pos_x_face_mesh_with_shared_world_edge();
        let open = open_seam_edges_on_face(
            &mesh,
            translation,
            chunk_pos_for_pos_x_face(),
            ChunkFace::PosX,
        );
        assert!(
            open.is_empty(),
            "shared geometric edges must cancel even with per-triangle vertex indices"
        );
    }

    #[test]
    fn face_offset_is_zero_on_aligned_pos_x_seam_at_nonzero_world_x() {
        let seam_point = Vec3::new(272.0, 48.0, 128.0);
        let hit_pos = Vec3::new(272.0, 49.5, 128.0);
        let offset = face_offset_delta(seam_point, ChunkFace::PosX, hit_pos);
        assert!(
            offset < 1e-4,
            "face offset should measure seam-plane distance, got {offset}"
        );
    }

    #[test]
    fn world_pos_in_face_band_accepts_vertices_inside_lod_band_not_on_face_plane() {
        let chunk_pos = IVec3::new(16, 0, 0);
        let origin = VoxelWorld::chunk_to_world(chunk_pos).as_vec3();
        let band = LodLevel::Lod0.step_size().max(1) as f32;
        let in_band = origin + Vec3::new(CHUNK_SIZE_I32 as f32 - band + 0.25, 4.0, 8.0);
        let on_plane = origin + Vec3::new(CHUNK_SIZE_I32 as f32, 4.0, 8.0);
        assert!(world_pos_in_face_band(
            in_band,
            chunk_pos,
            ChunkFace::PosX,
            LodLevel::Lod0
        ));
        assert!(!edge_on_chunk_face(in_band, in_band, chunk_pos, ChunkFace::PosX));
        assert!(edge_on_chunk_face(on_plane, on_plane, chunk_pos, ChunkFace::PosX));
    }

    #[test]
    fn strip_distance_summary_tracks_raw_and_stitch_safe_extrema_separately() {
        let mut summary = SeamAuditSummary::default();
        let mut fallback = SeamFaceAudit::default();
        fallback.final_mode = SeamFaceMode::SkirtFallback;
        fallback.strip_max_fine_to_coarse_distance = 2.5;
        fallback.strip_max_coarse_to_fine_distance = 1.5;
        fallback.strip_max_endpoint_distance = 3.0;
        update_strip_distance_summary(&mut summary, &fallback);

        let mut stitched = SeamFaceAudit::default();
        stitched.final_mode = SeamFaceMode::StitchGeometry;
        stitched.strip_max_fine_to_coarse_distance = 0.2;
        stitched.strip_max_coarse_to_fine_distance = 0.1;
        stitched.strip_max_endpoint_distance = 0.3;
        update_strip_distance_summary(&mut summary, &stitched);

        assert_eq!(summary.max_strip_fine_to_coarse_distance, 2.5);
        assert_eq!(summary.max_strip_coarse_to_fine_distance, 1.5);
        assert_eq!(summary.max_strip_endpoint_distance, 3.0);
        assert_eq!(summary.max_strip_fine_to_coarse_distance_stitch_safe, 0.2);
        assert_eq!(summary.max_strip_coarse_to_fine_distance_stitch_safe, 0.1);
        assert_eq!(summary.max_strip_endpoint_distance_stitch_safe, 0.3);
    }

    #[test]
    fn strip_span_ratio_summary_ignores_missing_strip_status() {
        assert!(!strip_span_overlap_ratio_counts_for_summary(
            StripOverlapStatus::MissingCoarseStrip
        ));
        assert!(strip_span_overlap_ratio_counts_for_summary(
            StripOverlapStatus::SpanMismatch
        ));
    }

    #[test]
    fn face_offset_does_not_inflate_with_large_world_coordinates() {
        let seam_point = Vec3::new(512.0, 40.0, 300.0);
        let hit_pos = Vec3::new(512.0, 41.0, 300.0);
        let offset = face_offset_delta(seam_point, ChunkFace::PosZ, hit_pos);
        assert!(offset < 1e-4, "expected near-zero offset, got {offset}");
    }
}
