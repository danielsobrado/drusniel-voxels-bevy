//! Per-face LOD seam contract and deterministic audit assembly.
//!
//! Classifies every X/Z chunk face at mesh/geometry level before render probes confirm
//! what the player would see.

use super::{LodTransitionSnapStats, neighbor_lod_for_face, transition_target_lod};
use crate::voxel::chunk::LodLevel;
use crate::voxel::lod_boundary_strip::{
    LodBoundaryStrip, LodBoundaryStripCache, NeighborBoundaryStrips, StripOverlapStatus,
};
use crate::voxel::skirt::ChunkFace;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::IVec3;

pub const XZ_FACE_COUNT: usize = 4;

pub const XZ_FACES: [ChunkFace; 4] = [
    ChunkFace::NegX,
    ChunkFace::PosX,
    ChunkFace::NegZ,
    ChunkFace::PosZ,
];

#[inline]
pub fn xz_face_index(face: ChunkFace) -> Option<usize> {
    match face {
        ChunkFace::NegX => Some(0),
        ChunkFace::PosX => Some(1),
        ChunkFace::NegZ => Some(2),
        ChunkFace::PosZ => Some(3),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SeamFaceMode {
    #[default]
    NoTransition,
    SameLod,
    DeltaTooLarge,
    MissingNeighbor,
    StaleStripFallback,
    SkirtFallback,
    GpuMorphOnly,
    StitchGeometry,
    InvalidUnsafeTopology,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SeamStripRejectReason {
    #[default]
    None,
    MissingStrip,
    StaleStrip,
    MultiComponentStrip,
    SpanMismatch,
    DirectedDistanceExceeded,
    EndpointDistanceExceeded,
    CrossingOrFoldDetected,
    UnsupportedTopology,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SeamStripOverlapSource {
    #[default]
    NotEvaluated,
    MeshTime,
    RuntimeReextract,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SeamStripStatus {
    #[default]
    NotNeeded,
    MissingNeighborChunk,
    MissingStrip,
    StaleRevision,
    HitCurrentRevision,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct MorphFaceCounts {
    pub candidate: [u16; XZ_FACE_COUNT],
    pub welded: [u16; XZ_FACE_COUNT],
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SeamStitchResult {
    pub stitched_face_mask: u8,
    pub triangle_counts: [u16; XZ_FACE_COUNT],
}

#[derive(Clone, Copy, Debug, Default)]
pub struct SkirtFaceCounts {
    pub triangle_counts: [u16; XZ_FACE_COUNT],
}

#[derive(Clone, Copy, Debug)]
pub struct SeamFaceAudit {
    pub face: ChunkFace,
    pub neighbor_present: bool,
    pub fine_lod: LodLevel,
    pub coarse_lod: LodLevel,
    pub final_mode: SeamFaceMode,
    pub strip_status: SeamStripStatus,
    pub morph_candidate_count: u16,
    pub morph_welded_count: u16,
    pub morph_missing_count: u16,
    pub stitch_triangle_count: u16,
    pub skirt_triangle_count: u16,
    pub fine_components: u8,
    pub coarse_components: u8,
    pub sealed_by_mask: bool,
    pub samples_total: u16,
    pub samples_without_render_coverage: u16,
    pub max_lip_height_voxels: f32,
    pub max_face_offset_voxels: f32,
    pub longest_unmatched_edge_voxels: f32,
    pub unmatched_transition_edges: u16,
    pub unmatched_regular_edges: u16,
    pub possible_terrace_samples: u16,
    pub strip_overlap_status: StripOverlapStatus,
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
    pub strip_reject_reason: SeamStripRejectReason,
    pub strip_overlap_source: SeamStripOverlapSource,
}

impl Default for SeamFaceAudit {
    fn default() -> Self {
        Self {
            face: ChunkFace::NegX,
            neighbor_present: false,
            fine_lod: LodLevel::Culled,
            coarse_lod: LodLevel::Culled,
            final_mode: SeamFaceMode::NoTransition,
            strip_status: SeamStripStatus::NotNeeded,
            morph_candidate_count: 0,
            morph_welded_count: 0,
            morph_missing_count: 0,
            stitch_triangle_count: 0,
            skirt_triangle_count: 0,
            fine_components: 0,
            coarse_components: 0,
            sealed_by_mask: false,
            samples_total: 0,
            samples_without_render_coverage: 0,
            max_lip_height_voxels: 0.0,
            max_face_offset_voxels: 0.0,
            longest_unmatched_edge_voxels: 0.0,
            unmatched_transition_edges: 0,
            unmatched_regular_edges: 0,
            possible_terrace_samples: 0,
            strip_overlap_status: StripOverlapStatus::NotEvaluated,
            strip_compatible: false,
            strip_max_fine_to_coarse_distance: 0.0,
            strip_max_coarse_to_fine_distance: 0.0,
            strip_max_endpoint_distance: 0.0,
            strip_span_overlap_ratio: 0.0,
            strip_fine_span_min: 0.0,
            strip_fine_span_max: 0.0,
            strip_coarse_span_min: 0.0,
            strip_coarse_span_max: 0.0,
            strip_unmatched_fine_segments: 0,
            strip_unmatched_coarse_segments: 0,
            strip_crossing_count: 0,
            strip_reject_reason: SeamStripRejectReason::None,
            strip_overlap_source: SeamStripOverlapSource::NotEvaluated,
        }
    }
}

impl SeamFaceAudit {
    pub fn default_for_face(face: ChunkFace, fine_lod: LodLevel) -> Self {
        Self {
            face,
            fine_lod,
            ..Default::default()
        }
    }

    pub fn is_partial_morph_uncovered(self) -> bool {
        self.morph_welded_count > 0
            && self.morph_welded_count < self.morph_candidate_count
            && self.stitch_triangle_count == 0
            && self.skirt_triangle_count == 0
    }

    pub fn has_open_seam_edges(self) -> bool {
        self.unmatched_transition_edges > 0
            || (self.unmatched_regular_edges > 0
                && matches!(
                    self.final_mode,
                    SeamFaceMode::InvalidUnsafeTopology
                        | SeamFaceMode::SkirtFallback
                        | SeamFaceMode::StaleStripFallback
                        | SeamFaceMode::GpuMorphOnly
                ))
    }
}

impl SeamFaceMode {
    pub fn claims_stitch_safe_seam(self) -> bool {
        matches!(
            self,
            SeamFaceMode::StitchGeometry | SeamFaceMode::GpuMorphOnly
        )
    }
}

pub struct SeamFaceModeInput {
    pub face: ChunkFace,
    pub fine_lod: LodLevel,
    pub neighbor_lod: Option<LodLevel>,
    pub lod_delta_gt_one: bool,
    pub strip_status: SeamStripStatus,
    pub morph_candidate_count: u16,
    pub morph_welded_count: u16,
    pub stitch_triangle_count: u16,
    pub skirt_triangle_count: u16,
    pub sealed_by_mask: bool,
    pub stitched: bool,
    pub vertical_skirt_on_face: bool,
    pub fine_components: u8,
    pub coarse_components: u8,
}

pub fn classify_final_mode(input: SeamFaceModeInput) -> SeamFaceMode {
    let Some(neighbor_lod) = input.neighbor_lod else {
        return SeamFaceMode::NoTransition;
    };

    if neighbor_lod == LodLevel::Culled {
        return SeamFaceMode::MissingNeighbor;
    }

    if !neighbor_lod.is_lower_detail_than(input.fine_lod) {
        return SeamFaceMode::SameLod;
    }

    if input.lod_delta_gt_one {
        return SeamFaceMode::DeltaTooLarge;
    }

    let transition = transition_target_lod(input.fine_lod, neighbor_lod).is_some();
    if !transition {
        return SeamFaceMode::DeltaTooLarge;
    }

    let has_full_morph =
        input.morph_candidate_count > 0 && input.morph_welded_count >= input.morph_candidate_count;
    let has_partial_morph =
        input.morph_welded_count > 0 && input.morph_welded_count < input.morph_candidate_count;
    let has_stitch = input.stitch_triangle_count > 0;
    let has_skirt = input.skirt_triangle_count > 0;

    if has_partial_morph && !has_stitch && !has_skirt {
        return SeamFaceMode::InvalidUnsafeTopology;
    }

    if has_stitch && input.vertical_skirt_on_face {
        return SeamFaceMode::InvalidUnsafeTopology;
    }

    if transition && !has_stitch && !has_skirt && !has_full_morph && input.morph_welded_count == 0 {
        if input.fine_components > 0 || input.coarse_components > 0 {
            return SeamFaceMode::InvalidUnsafeTopology;
        }
        return SeamFaceMode::NoTransition;
    }

    let needs_strip_topology_check = transition
        && (input.fine_components > 0
            || input.coarse_components > 0
            || has_stitch
            || has_full_morph
            || has_partial_morph);
    if needs_strip_topology_check && (input.fine_components != 1 || input.coarse_components != 1) {
        if input.strip_status == SeamStripStatus::StaleRevision {
            return SeamFaceMode::StaleStripFallback;
        }
        if has_skirt {
            return SeamFaceMode::SkirtFallback;
        }
        return SeamFaceMode::InvalidUnsafeTopology;
    }

    if has_stitch {
        return SeamFaceMode::StitchGeometry;
    }

    if input.strip_status == SeamStripStatus::StaleRevision {
        return SeamFaceMode::StaleStripFallback;
    }

    if matches!(
        input.strip_status,
        SeamStripStatus::MissingStrip | SeamStripStatus::MissingNeighborChunk
    ) && has_skirt
    {
        return SeamFaceMode::SkirtFallback;
    }

    if has_full_morph && input.sealed_by_mask {
        return SeamFaceMode::GpuMorphOnly;
    }

    if has_skirt {
        return SeamFaceMode::SkirtFallback;
    }

    if input.morph_welded_count > 0 && input.sealed_by_mask {
        return SeamFaceMode::GpuMorphOnly;
    }

    SeamFaceMode::NoTransition
}

pub fn boundary_component_count_for_strip(strip: &LodBoundaryStrip) -> u8 {
    strip.component_count().min(255) as u8
}

pub fn terrain_seam_strip_debug_from_own_strips(
    strips: &[LodBoundaryStrip],
) -> crate::voxel::meshing::TerrainSeamStripDebug {
    use crate::voxel::lod_boundary_strip::CompactProjectedStrip;
    let mut debug = crate::voxel::meshing::TerrainSeamStripDebug::default();
    for strip in strips {
        let Some(idx) = xz_face_index(strip.face) else {
            continue;
        };
        debug.strips[idx] = Some(CompactProjectedStrip::from_lod_boundary_strip(strip));
    }
    debug
}

pub fn resolve_strip_status_per_face(
    strip_cache: &LodBoundaryStripCache,
    world: &VoxelWorld,
    chunk_pos: IVec3,
    my_lod: LodLevel,
    neighbor_lods: &crate::voxel::skirt::NeighborLods,
) -> [SeamStripStatus; XZ_FACE_COUNT] {
    use crate::voxel::lod_boundary_strip::{face_neighbor_offset, opposite_face};

    let mut status = [SeamStripStatus::NotNeeded; XZ_FACE_COUNT];
    if my_lod.step_size() == 0 {
        return status;
    }

    for (idx, face) in XZ_FACES.iter().enumerate() {
        let Some(neighbor_lod) = neighbor_lod_for_face(neighbor_lods, *face) else {
            status[idx] = SeamStripStatus::NotNeeded;
            continue;
        };
        if neighbor_lod.step_size() != my_lod.step_size().saturating_mul(2) {
            status[idx] = SeamStripStatus::NotNeeded;
            continue;
        }
        let neighbor_pos = chunk_pos + face_neighbor_offset(*face);
        let Some(neighbor_chunk) = world.get_chunk(neighbor_pos) else {
            status[idx] = SeamStripStatus::MissingNeighborChunk;
            continue;
        };
        let expected_revision = neighbor_chunk.last_terrain_mesh_key();
        let cached_revision = strip_cache.revision_for(neighbor_pos);
        let opposite = opposite_face(*face);
        if cached_revision.is_none() {
            status[idx] = SeamStripStatus::MissingStrip;
            continue;
        }
        if let (Some(expected), Some(cached)) = (expected_revision, cached_revision) {
            if expected != cached {
                status[idx] = SeamStripStatus::StaleRevision;
                continue;
            }
        }
        if strip_cache
            .strip_for_face(neighbor_pos, opposite, expected_revision)
            .is_some()
        {
            status[idx] = SeamStripStatus::HitCurrentRevision;
        } else {
            status[idx] = SeamStripStatus::MissingStrip;
        }
    }
    status
}

#[allow(clippy::too_many_arguments)]
pub fn assemble_seam_face_audit(
    chunk_pos: IVec3,
    my_lod: LodLevel,
    neighbor_lods: &crate::voxel::skirt::NeighborLods,
    snap_stats: &LodTransitionSnapStats,
    morph_counts: &MorphFaceCounts,
    stitch: &SeamStitchResult,
    skirt_counts: &SkirtFaceCounts,
    strip_status: &[SeamStripStatus; XZ_FACE_COUNT],
    neighbor_strips: Option<&NeighborBoundaryStrips>,
    fine_strips: &[LodBoundaryStrip],
    lod_delta_gt_one_face_mask: u8,
) -> [SeamFaceAudit; XZ_FACE_COUNT] {
    let _ = chunk_pos;
    let mut audits = [SeamFaceAudit::default(); XZ_FACE_COUNT];

    for (idx, face) in XZ_FACES.iter().enumerate() {
        let neighbor_lod = neighbor_lod_for_face(neighbor_lods, *face);
        let sealed = {
            let snapped =
                snap_stats.snapped_face_mask & LodTransitionSnapStats::face_mask(*face) != 0;
            let fallback =
                snap_stats.fallback_face_mask & LodTransitionSnapStats::face_mask(*face) != 0;
            let stitched =
                stitch.stitched_face_mask & LodTransitionSnapStats::face_mask(*face) != 0;
            (snapped && !fallback) || stitched
        };
        let fine_strip = fine_strips.iter().find(|s| s.face == *face);
        let coarse_strip = neighbor_strips.and_then(|strips| strips.for_face(*face));
        let vertical_skirt = skirt_counts.triangle_counts[idx] > 0
            && snap_stats.face_snapped(*face)
            && !snap_stats.face_fallback(*face);

        let candidate = morph_counts.candidate[idx];
        let welded = morph_counts.welded[idx];
        let fine_components = fine_strip
            .map(boundary_component_count_for_strip)
            .unwrap_or(0);
        let coarse_components = coarse_strip
            .map(boundary_component_count_for_strip)
            .unwrap_or(0);
        let stitch_triangles = stitch.triangle_counts[idx];
        let skirt_triangles = skirt_counts.triangle_counts[idx];
        let transition =
            transition_target_lod(my_lod, neighbor_lod.unwrap_or(LodLevel::Culled)).is_some();
        let needs_strip_topology_check = transition
            && (fine_components > 0
                || coarse_components > 0
                || stitch_triangles > 0
                || candidate > 0
                || welded > 0);

        let mut strip_reject_reason = SeamStripRejectReason::None;
        if needs_strip_topology_check {
            if matches!(
                strip_status[idx],
                SeamStripStatus::MissingStrip | SeamStripStatus::MissingNeighborChunk
            ) {
                strip_reject_reason = SeamStripRejectReason::MissingStrip;
            } else if strip_status[idx] == SeamStripStatus::StaleRevision {
                strip_reject_reason = SeamStripRejectReason::StaleStrip;
            } else if fine_components != 1 || coarse_components != 1 {
                strip_reject_reason = SeamStripRejectReason::MultiComponentStrip;
            }
        }

        let mut mode = classify_final_mode(SeamFaceModeInput {
            face: *face,
            fine_lod: my_lod,
            neighbor_lod,
            lod_delta_gt_one: lod_delta_gt_one_face_mask & LodTransitionSnapStats::face_mask(*face)
                != 0,
            strip_status: strip_status[idx],
            morph_candidate_count: candidate,
            morph_welded_count: welded,
            stitch_triangle_count: stitch_triangles,
            skirt_triangle_count: skirt_triangles,
            sealed_by_mask: sealed,
            stitched: stitch.stitched_face_mask & LodTransitionSnapStats::face_mask(*face) != 0,
            vertical_skirt_on_face: vertical_skirt && stitch_triangles > 0,
            fine_components,
            coarse_components,
        });

        if mode.claims_stitch_safe_seam() && strip_reject_reason != SeamStripRejectReason::None {
            mode = if skirt_triangles > 0 {
                SeamFaceMode::SkirtFallback
            } else if strip_status[idx] == SeamStripStatus::StaleRevision {
                SeamFaceMode::StaleStripFallback
            } else {
                SeamFaceMode::InvalidUnsafeTopology
            };
        }

        audits[idx] = SeamFaceAudit {
            face: *face,
            neighbor_present: neighbor_lod.is_some_and(|lod| lod != LodLevel::Culled),
            fine_lod: my_lod,
            coarse_lod: neighbor_lod.unwrap_or(LodLevel::Culled),
            final_mode: mode,
            strip_status: strip_status[idx],
            morph_candidate_count: candidate,
            morph_welded_count: welded,
            morph_missing_count: candidate.saturating_sub(welded),
            stitch_triangle_count: stitch_triangles,
            skirt_triangle_count: skirt_triangles,
            fine_components,
            coarse_components,
            sealed_by_mask: sealed,
            samples_total: 0,
            samples_without_render_coverage: 0,
            max_lip_height_voxels: 0.0,
            max_face_offset_voxels: 0.0,
            longest_unmatched_edge_voxels: 0.0,
            unmatched_transition_edges: 0,
            unmatched_regular_edges: 0,
            possible_terrace_samples: 0,
            strip_overlap_status: StripOverlapStatus::NotEvaluated,
            strip_compatible: false,
            strip_max_fine_to_coarse_distance: 0.0,
            strip_max_coarse_to_fine_distance: 0.0,
            strip_max_endpoint_distance: 0.0,
            strip_span_overlap_ratio: 0.0,
            strip_fine_span_min: 0.0,
            strip_fine_span_max: 0.0,
            strip_coarse_span_min: 0.0,
            strip_coarse_span_max: 0.0,
            strip_unmatched_fine_segments: 0,
            strip_unmatched_coarse_segments: 0,
            strip_crossing_count: 0,
            strip_reject_reason,
            strip_overlap_source: SeamStripOverlapSource::NotEvaluated,
        };
    }

    audits
}

pub fn strip_reject_reason_from_overlap_status(
    status: StripOverlapStatus,
) -> SeamStripRejectReason {
    match status {
        StripOverlapStatus::SpanMismatch => SeamStripRejectReason::SpanMismatch,
        StripOverlapStatus::DirectedDistanceExceeded => {
            SeamStripRejectReason::DirectedDistanceExceeded
        }
        StripOverlapStatus::EndpointDistanceExceeded => {
            SeamStripRejectReason::EndpointDistanceExceeded
        }
        StripOverlapStatus::CrossingOrFoldDetected => SeamStripRejectReason::CrossingOrFoldDetected,
        StripOverlapStatus::UnsupportedTopology
        | StripOverlapStatus::FineMultiComponent
        | StripOverlapStatus::CoarseMultiComponent
        | StripOverlapStatus::ComponentMismatch => SeamStripRejectReason::UnsupportedTopology,
        StripOverlapStatus::MissingFineStrip | StripOverlapStatus::MissingCoarseStrip => {
            SeamStripRejectReason::MissingStrip
        }
        _ => SeamStripRejectReason::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::LodLevel;
    use crate::voxel::skirt::ChunkFace;

    #[test]
    fn classify_final_mode_rejects_stitch_safe_on_multi_component_strip() {
        let mode = classify_final_mode(SeamFaceModeInput {
            face: ChunkFace::PosX,
            fine_lod: LodLevel::Lod0,
            neighbor_lod: Some(LodLevel::Lod1),
            lod_delta_gt_one: false,
            strip_status: SeamStripStatus::HitCurrentRevision,
            morph_candidate_count: 4,
            morph_welded_count: 4,
            stitch_triangle_count: 0,
            skirt_triangle_count: 6,
            sealed_by_mask: true,
            stitched: false,
            vertical_skirt_on_face: false,
            fine_components: 2,
            coarse_components: 1,
        });
        assert_eq!(mode, SeamFaceMode::SkirtFallback);
        assert!(!mode.claims_stitch_safe_seam());
    }

    #[test]
    fn classify_final_mode_ignores_empty_component_counts_without_strip_need() {
        let mode = classify_final_mode(SeamFaceModeInput {
            face: ChunkFace::PosX,
            fine_lod: LodLevel::Lod0,
            neighbor_lod: Some(LodLevel::Lod1),
            lod_delta_gt_one: false,
            strip_status: SeamStripStatus::NotNeeded,
            morph_candidate_count: 0,
            morph_welded_count: 0,
            stitch_triangle_count: 0,
            skirt_triangle_count: 0,
            sealed_by_mask: false,
            stitched: false,
            vertical_skirt_on_face: false,
            fine_components: 0,
            coarse_components: 0,
        });
        assert_ne!(mode, SeamFaceMode::InvalidUnsafeTopology);
    }
}
