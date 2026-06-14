//! Compatibility seam-audit output for the LOD0-live plus CLOD-pages renderer.

use std::fs;
use std::path::{Path, PathBuf};

use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use serde::Serialize;

use crate::performance::AreaTimingRecorder;

pub const SEAM_AUDIT_SCHEMA_VERSION: u32 = 4;

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
    pub max_strip_fine_to_coarse_distance: f32,
    pub max_strip_coarse_to_fine_distance: f32,
    pub max_strip_endpoint_distance: f32,
    pub max_strip_fine_to_coarse_distance_stitch_safe: f32,
    pub max_strip_coarse_to_fine_distance_stitch_safe: f32,
    pub max_strip_endpoint_distance_stitch_safe: f32,
    pub min_strip_span_overlap_ratio: f32,
}

#[derive(Serialize)]
pub struct SeamAuditDump {
    pub schema_version: u32,
    pub trigger: String,
    pub checkpoint: String,
    pub run_index: u32,
    pub summary: SeamAuditSummary,
    pub faces: Vec<serde_json::Value>,
}

pub struct SeamAuditPassPlugin;

impl Plugin for SeamAuditPassPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<TerrainSeamAuditRequests>()
            .add_systems(Update, run_pending_seam_audit_pass);
    }
}

fn run_pending_seam_audit_pass(
    mut requests: ResMut<TerrainSeamAuditRequests>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let Some(request) = requests.pending.pop() else {
        return;
    };
    let dump = SeamAuditDump {
        schema_version: SEAM_AUDIT_SCHEMA_VERSION,
        trigger: request.trigger,
        checkpoint: request.checkpoint_name,
        run_index: request.run_index,
        summary: SeamAuditSummary::default(),
        faces: Vec::new(),
    };
    timing.record_count(frame.0, "LOD Seam Audit Active Faces", 0.0);
    if let Err(error) = write_seam_audit_dump(&request.output_dir, &dump) {
        warn!("failed to write seam audit dump: {error}");
    }
}

pub fn write_seam_audit_dump(output_dir: &Path, dump: &SeamAuditDump) -> std::io::Result<()> {
    fs::create_dir_all(output_dir)?;
    let path = output_dir.join("seam-audit.json");
    let bytes = serde_json::to_vec_pretty(dump).map_err(std::io::Error::other)?;
    fs::write(path, bytes)
}
