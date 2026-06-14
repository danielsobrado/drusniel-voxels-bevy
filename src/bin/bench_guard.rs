use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;
use serde::Deserialize;

#[derive(Parser, Debug)]
#[command(
    about = "Validate bench summary.json files against render performance guardrails",
    version
)]
struct Args {
    /// One or more bench summary.json files.
    #[arg(required = true)]
    summaries: Vec<PathBuf>,

    /// Guard configuration TOML.
    #[arg(long, default_value = "assets/config/bench_guard.toml")]
    config: PathBuf,

    /// Treat warnings as process failures.
    #[arg(long)]
    fail_on_warning: bool,
}

#[derive(Debug, Deserialize)]
struct GuardConfig {
    #[serde(rename = "check")]
    #[serde(default)]
    checks: Vec<GuardCheck>,
    #[serde(default)]
    naadf: Option<NaadfGuardConfig>,
    #[serde(default)]
    lod_seam_audit: Option<LodSeamAuditConfig>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(default)]
struct LodSeamAuditConfig {
    max_active_seam_faces_with_open_edges: u32,
    max_active_seam_faces_with_transition_coverage_gaps: u32,
    max_samples_without_render_coverage: u32,
    max_possible_terrace_samples: u32,
    max_partial_morph_uncovered_faces: u32,
    max_stale_strip_faces_after_stable_frames: u32,
    max_lod_delta_gt_one_faces: u32,
    max_lip_height_voxels: f32,
    max_face_offset_voxels: f32,
    max_longest_unmatched_edge_voxels: f32,
    max_unmatched_transition_edges: u32,
    max_unmatched_regular_edges_on_delta1_seams: u32,
    max_strip_incompatible_faces: u32,
    max_strip_missing_faces_after_stable_frames: u32,
    max_strip_topology_unsupported_stitched_faces: u32,
    max_stitch_safe_bad_component_faces: u32,
    max_strip_fine_to_coarse_distance_voxels: f32,
    max_strip_coarse_to_fine_distance_voxels: f32,
    max_strip_endpoint_distance_voxels: f32,
    min_strip_span_overlap_ratio: f32,
    max_strip_crossing_count: u32,
}

impl Default for LodSeamAuditConfig {
    fn default() -> Self {
        Self {
            max_active_seam_faces_with_open_edges: 0,
            max_active_seam_faces_with_transition_coverage_gaps: 0,
            max_samples_without_render_coverage: 0,
            max_possible_terrace_samples: 0,
            max_partial_morph_uncovered_faces: 0,
            max_stale_strip_faces_after_stable_frames: 0,
            max_lod_delta_gt_one_faces: 0,
            max_lip_height_voxels: 0.20,
            max_face_offset_voxels: 0.10,
            max_longest_unmatched_edge_voxels: 0.05,
            max_unmatched_transition_edges: 0,
            max_unmatched_regular_edges_on_delta1_seams: 0,
            max_strip_incompatible_faces: 0,
            max_strip_missing_faces_after_stable_frames: 0,
            max_strip_topology_unsupported_stitched_faces: 0,
            max_stitch_safe_bad_component_faces: 0,
            max_strip_fine_to_coarse_distance_voxels: 0.35,
            max_strip_coarse_to_fine_distance_voxels: 0.35,
            max_strip_endpoint_distance_voxels: 0.50,
            min_strip_span_overlap_ratio: 0.95,
            max_strip_crossing_count: 0,
        }
    }
}

#[derive(Debug, Deserialize)]
struct SeamAuditDump {
    #[serde(default)]
    schema_version: u32,
    summary: SeamAuditSummary,
    faces: Vec<SeamAuditFaceRecord>,
}

#[derive(Debug, Deserialize, Default)]
#[allow(dead_code)] // Retains compatibility with historical seam-audit dumps.
struct SeamAuditSummary {
    active_seam_faces: u32,
    partial_morph_uncovered_faces: u32,
    open_edge_faces: u32,
    samples_without_render_coverage: u32,
    possible_terrace_samples: u32,
    stale_strip_faces: u32,
    lod_delta_gt_one_faces: u32,
    max_lip_height_voxels: f32,
    max_face_offset_voxels: f32,
    max_longest_unmatched_edge_voxels: f32,
    strip_incompatible_faces: u32,
    strip_missing_faces: u32,
    strip_topology_unsupported_faces: u32,
    max_strip_fine_to_coarse_distance: f32,
    max_strip_coarse_to_fine_distance: f32,
    max_strip_endpoint_distance: f32,
    #[serde(default)]
    max_strip_fine_to_coarse_distance_stitch_safe: f32,
    #[serde(default)]
    max_strip_coarse_to_fine_distance_stitch_safe: f32,
    #[serde(default)]
    max_strip_endpoint_distance_stitch_safe: f32,
    min_strip_span_overlap_ratio: f32,
}

#[derive(Debug, Deserialize)]
struct SeamAuditFaceRecord {
    final_mode: String,
    #[serde(default)]
    fine_components: u8,
    #[serde(default)]
    coarse_components: u8,
    strip_overlap_status: String,
    strip_compatible: bool,
    strip_max_fine_to_coarse_distance: f32,
    strip_max_coarse_to_fine_distance: f32,
    strip_max_endpoint_distance: f32,
    strip_span_overlap_ratio: f32,
    unmatched_transition_edges: u16,
    unmatched_regular_edges: u16,
    samples_without_render_coverage: u16,
    strip_crossing_count: u16,
}

fn claims_stitch_safe_seam(final_mode: &str) -> bool {
    final_mode == "StitchGeometry" || final_mode == "GpuMorphOnly"
}

fn strip_span_overlap_ratio_is_meaningful(status: &str) -> bool {
    matches!(
        status,
        "Compatible"
            | "SpanMismatch"
            | "DirectedDistanceExceeded"
            | "EndpointDistanceExceeded"
            | "CrossingOrFoldDetected"
    )
}

fn max_strip_distance_from_stitch_safe_faces(
    faces: &[SeamAuditFaceRecord],
    pick: impl Fn(&SeamAuditFaceRecord) -> f32,
) -> f64 {
    faces
        .iter()
        .filter(|face| claims_stitch_safe_seam(&face.final_mode))
        .map(|face| pick(face) as f64)
        .fold(0.0, f64::max)
}

#[derive(Debug, Deserialize, Clone)]
struct GuardCheck {
    name: String,
    scene: String,
    checkpoint: String,
    area: String,
    field: String,
    #[serde(default)]
    unit: String,
    warn_gt: Option<f64>,
    fail_gt: Option<f64>,
    warn_lt: Option<f64>,
    fail_lt: Option<f64>,
    #[serde(default)]
    exists: bool,
    #[serde(default = "default_required")]
    required: bool,
    skip_if: Option<SkipCondition>,
}

#[derive(Debug, Deserialize, Clone)]
struct SkipCondition {
    area: String,
    field: String,
    gt: Option<f64>,
    gte: Option<f64>,
    lt: Option<f64>,
    lte: Option<f64>,
    eq: Option<f64>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(default)]
struct NaadfGuardConfig {
    max_gpu_memory_mb: f64,
    max_dirty_chunks_pending: f64,
    max_oldest_dirty_chunk_age_frames: f64,
    max_avg_ray_steps: f64,
    max_ray_steps: f64,
    max_uploaded_chunks_per_frame: f64,
    max_stage_invocations_per_frame: f64,
    max_gi_rays_per_frame: f64,
    max_sun_visibility_rays_per_pixel: f64,
    max_contact_shadow_rays_per_pixel: f64,
    max_terrain_ao_rays_per_pixel: f64,
    max_short_range_rays_per_pixel: f64,
    max_froxel_sun_rays_per_frame: f64,
    max_cache_rebuild_ms: f64,
    max_gpu_upload_ms: f64,
    max_frame_time_regression_percent: f64,
    targets: Vec<NaadfGuardTarget>,
}

#[derive(Debug, Deserialize, Clone)]
struct NaadfGuardTarget {
    label: String,
    scene: String,
    checkpoint: String,
    baseline_scene: Option<String>,
    baseline_checkpoint: Option<String>,
}

#[derive(Debug, Clone)]
struct NaadfFrameRegressionCheck {
    name: String,
    scene: String,
    checkpoint: String,
    baseline_scene: String,
    baseline_checkpoint: String,
    field: String,
    max_regression_percent: f64,
    required: bool,
}

#[derive(Debug, Deserialize)]
struct BenchSummary {
    scene: String,
    checkpoints: Vec<CheckpointSummary>,
}

#[derive(Debug, Deserialize)]
struct CheckpointSummary {
    name: String,
    median_frame_ms: f64,
    p99_frame_ms: f64,
    areas: HashMap<String, AreaSummary>,
}

#[derive(Debug, Deserialize)]
struct AreaSummary {
    median_ms: f64,
    p99_ms: f64,
    calls_per_frame: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
    Pass,
    Warn,
    Fail,
    Missing,
    Skipped,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Warn => "WARN",
            Self::Fail => "FAIL",
            Self::Missing => "MISSING",
            Self::Skipped => "SKIP",
        }
    }
}

#[derive(Debug)]
struct CheckResult {
    checkpoint: String,
    metric: String,
    value: Option<f64>,
    threshold: String,
    status: Status,
}

impl Default for NaadfGuardConfig {
    fn default() -> Self {
        Self {
            max_gpu_memory_mb: 512.0,
            max_dirty_chunks_pending: 256.0,
            max_oldest_dirty_chunk_age_frames: 120.0,
            max_avg_ray_steps: 90.0,
            max_ray_steps: 256.0,
            max_uploaded_chunks_per_frame: 8.0,
            max_stage_invocations_per_frame: 4.0,
            max_gi_rays_per_frame: 8_388_608.0,
            max_sun_visibility_rays_per_pixel: 1.0,
            max_contact_shadow_rays_per_pixel: 1.0,
            max_terrain_ao_rays_per_pixel: 4.0,
            max_short_range_rays_per_pixel: 5.0,
            max_froxel_sun_rays_per_frame: 65_536.0,
            max_cache_rebuild_ms: 5.0,
            max_gpu_upload_ms: 5.0,
            max_frame_time_regression_percent: 10.0,
            targets: default_naadf_targets(),
        }
    }
}

impl GuardConfig {
    fn expanded_checks(&self) -> Vec<GuardCheck> {
        let mut checks = self.checks.clone();
        if let Some(naadf) = &self.naadf {
            checks.extend(naadf.metric_checks());
        }
        checks
    }

    fn expanded_naadf_frame_regression_checks(&self) -> Vec<NaadfFrameRegressionCheck> {
        self.naadf
            .as_ref()
            .map(NaadfGuardConfig::frame_regression_checks)
            .unwrap_or_default()
    }
}

impl NaadfGuardConfig {
    fn metric_checks(&self) -> Vec<GuardCheck> {
        let mut checks = Vec::with_capacity(self.targets.len() * 20);
        for target in &self.targets {
            checks.push(naadf_area_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "cache_rebuild",
                "NAADF Cache Rebuild",
                warning_threshold(self.max_cache_rebuild_ms),
                self.max_cache_rebuild_ms,
                "ms",
            ));
            checks.push(naadf_area_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "gpu_upload_cpu",
                "NAADF GPU Upload CPU",
                warning_threshold(self.max_gpu_upload_ms),
                self.max_gpu_upload_ms,
                "ms",
            ));
            checks.push(naadf_metric_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "gpu_memory_bytes",
                "naadf.gpu_memory_bytes",
                warning_threshold(self.max_gpu_memory_mb * 1024.0 * 1024.0),
                self.max_gpu_memory_mb * 1024.0 * 1024.0,
                "bytes",
            ));
            checks.push(naadf_metric_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "dirty_chunks_pending",
                "naadf.dirty_chunks_pending",
                warning_threshold(self.max_dirty_chunks_pending),
                self.max_dirty_chunks_pending,
                "count",
            ));
            checks.push(naadf_metric_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "oldest_dirty_chunk_age_frames",
                "naadf.gpu_build_queue_oldest_age_frames",
                warning_threshold(self.max_oldest_dirty_chunk_age_frames),
                self.max_oldest_dirty_chunk_age_frames,
                "frames",
            ));
            checks.push(naadf_metric_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "avg_ray_steps",
                "naadf.avg_ray_steps_last_frame",
                warning_threshold(self.max_avg_ray_steps),
                self.max_avg_ray_steps,
                "steps",
            ));
            checks.push(naadf_metric_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "max_ray_steps",
                "naadf.max_ray_steps_last_frame",
                warning_threshold(self.max_ray_steps),
                self.max_ray_steps,
                "steps",
            ));
            checks.push(naadf_metric_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "uploaded_chunks_per_frame",
                "naadf.uploaded_chunks_last_frame",
                warning_threshold(self.max_uploaded_chunks_per_frame),
                self.max_uploaded_chunks_per_frame,
                "count",
            ));
            for (metric_name, area) in [
                (
                    "first_hit_dispatches",
                    "naadf.preview_first_hit_dispatches_last_frame",
                ),
                ("gi_dispatches", "naadf.preview_gi_dispatches_last_frame"),
                (
                    "spatial_dispatches",
                    "naadf.preview_spatial_dispatches_last_frame",
                ),
                (
                    "temporal_dispatches",
                    "naadf.preview_temporal_dispatches_last_frame",
                ),
                (
                    "composite_passes",
                    "naadf.preview_composite_passes_last_frame",
                ),
            ] {
                checks.push(naadf_metric_check(
                    &target.label,
                    &target.scene,
                    &target.checkpoint,
                    metric_name,
                    area,
                    warning_threshold(self.max_stage_invocations_per_frame),
                    self.max_stage_invocations_per_frame,
                    "count",
                ));
            }
            checks.push(naadf_metric_check(
                &target.label,
                &target.scene,
                &target.checkpoint,
                "gi_rays",
                "naadf.gi_rays_last_frame",
                warning_threshold(self.max_gi_rays_per_frame),
                self.max_gi_rays_per_frame,
                "rays",
            ));
            for (metric_name, area, limit, unit) in [
                (
                    "sun_visibility_rays_per_pixel",
                    "naadf.radiance_sun_visibility_rays_per_pixel",
                    self.max_sun_visibility_rays_per_pixel,
                    "rays/pixel",
                ),
                (
                    "contact_shadow_rays_per_pixel",
                    "naadf.radiance_contact_shadow_rays_per_pixel",
                    self.max_contact_shadow_rays_per_pixel,
                    "rays/pixel",
                ),
                (
                    "terrain_ao_rays_per_pixel",
                    "naadf.radiance_terrain_ao_rays_per_pixel",
                    self.max_terrain_ao_rays_per_pixel,
                    "rays/pixel",
                ),
                (
                    "short_range_rays_per_pixel",
                    "naadf.radiance_short_range_rays_per_pixel",
                    self.max_short_range_rays_per_pixel,
                    "rays/pixel",
                ),
                (
                    "froxel_sun_rays_per_frame",
                    "naadf.froxel_sun_mask_max_rays_per_frame",
                    self.max_froxel_sun_rays_per_frame,
                    "rays",
                ),
            ] {
                checks.push(naadf_metric_check(
                    &target.label,
                    &target.scene,
                    &target.checkpoint,
                    metric_name,
                    area,
                    warning_threshold(limit),
                    limit,
                    unit,
                ));
            }
        }
        checks
    }

    fn frame_regression_checks(&self) -> Vec<NaadfFrameRegressionCheck> {
        let mut checks = Vec::new();
        for target in &self.targets {
            let (Some(baseline_scene), Some(baseline_checkpoint)) =
                (&target.baseline_scene, &target.baseline_checkpoint)
            else {
                continue;
            };
            for field in ["avg_ms", "p99_ms"] {
                checks.push(NaadfFrameRegressionCheck {
                    name: format!("naadf_{}_frame_{}_regression", target.label, field),
                    scene: target.scene.clone(),
                    checkpoint: target.checkpoint.clone(),
                    baseline_scene: baseline_scene.clone(),
                    baseline_checkpoint: baseline_checkpoint.clone(),
                    field: field.to_string(),
                    max_regression_percent: self.max_frame_time_regression_percent,
                    required: false,
                });
            }
        }
        checks
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<bool, String> {
    let args = Args::parse();
    let config: GuardConfig = read_toml(&args.config)?;
    if config.checks.is_empty() {
        return Err(format!("{} contains no checks", args.config.display()));
    }

    let mut summaries = Vec::with_capacity(args.summaries.len());
    for path in &args.summaries {
        let summary: BenchSummary = read_json(path)?;
        summaries.push((path.clone(), summary));
    }

    let checks = config.expanded_checks();
    let regression_checks = config.expanded_naadf_frame_regression_checks();
    let mut results = Vec::with_capacity(checks.len() + regression_checks.len());
    for check in &checks {
        results.push(evaluate_check(check, &summaries));
    }
    for check in &regression_checks {
        results.push(evaluate_naadf_frame_regression(check, &summaries));
    }
    if let Some(lod_audit) = config.lod_seam_audit.as_ref() {
        for (path, summary) in &summaries {
            results.extend(evaluate_lod_seam_audit(lod_audit, path, summary));
        }
    }

    println!("Config: {}", args.config.display());
    println!(
        "Summaries: {}",
        args.summaries
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    print_table(&results);

    let failures = results
        .iter()
        .filter(|result| matches!(result.status, Status::Fail | Status::Missing))
        .count();
    let warnings = results
        .iter()
        .filter(|result| result.status == Status::Warn)
        .count();

    println!();
    if failures > 0 {
        println!("FAILED: {failures} failure(s), {warnings} warning(s).");
        return Ok(false);
    }
    if args.fail_on_warning && warnings > 0 {
        println!("FAILED: {warnings} warning(s) treated as failures.");
        return Ok(false);
    }
    println!("PASS: {} check(s), {warnings} warning(s).", results.len());
    Ok(true)
}

fn evaluate_check(check: &GuardCheck, summaries: &[(PathBuf, BenchSummary)]) -> CheckResult {
    let metric = format!("{} ({})", check.name, format_metric(check));
    let threshold = threshold_text(check);
    let Some(summary) = summaries
        .iter()
        .map(|(_, summary)| summary)
        .find(|summary| summary.scene == check.scene)
    else {
        return CheckResult {
            checkpoint: format!("{}/{}", check.scene, check.checkpoint),
            metric,
            value: None,
            threshold,
            status: Status::Skipped,
        };
    };

    if let Some(skip_if) = &check.skip_if {
        if condition_matches(summary, &check.checkpoint, skip_if) {
            return CheckResult {
                checkpoint: format!("{}/{}", check.scene, check.checkpoint),
                metric,
                value: None,
                threshold: format!("skipped when {}", condition_text(skip_if)),
                status: Status::Skipped,
            };
        }
    }

    let value = metric_value(summary, &check.checkpoint, &check.area, &check.field);
    let status = match value {
        Some(_) if check.exists => Status::Pass,
        Some(value) if is_fail(value, check) => Status::Fail,
        Some(value) if is_warn(value, check) => Status::Warn,
        Some(_) => Status::Pass,
        None if check.required => Status::Missing,
        None => Status::Skipped,
    };

    CheckResult {
        checkpoint: format!("{}/{}", check.scene, check.checkpoint),
        metric,
        value,
        threshold,
        status,
    }
}

fn evaluate_naadf_frame_regression(
    check: &NaadfFrameRegressionCheck,
    summaries: &[(PathBuf, BenchSummary)],
) -> CheckResult {
    let metric = format!(
        "{} (__frame_total:{} vs {}/{})",
        check.name, check.field, check.baseline_scene, check.baseline_checkpoint
    );
    let threshold = format!(
        "fail > {}% frame regression",
        format_number(Some(check.max_regression_percent))
    );
    let checkpoint = format!("{}/{}", check.scene, check.checkpoint);
    let target = summaries
        .iter()
        .map(|(_, summary)| summary)
        .find(|summary| summary.scene == check.scene)
        .and_then(|summary| {
            metric_value(summary, &check.checkpoint, "__frame_total", &check.field)
        });
    let baseline = summaries
        .iter()
        .map(|(_, summary)| summary)
        .find(|summary| summary.scene == check.baseline_scene)
        .and_then(|summary| {
            metric_value(
                summary,
                &check.baseline_checkpoint,
                "__frame_total",
                &check.field,
            )
        });

    let (Some(target), Some(baseline)) = (target, baseline) else {
        return CheckResult {
            checkpoint,
            metric,
            value: None,
            threshold,
            status: if check.required {
                Status::Missing
            } else {
                Status::Skipped
            },
        };
    };

    if baseline <= f64::EPSILON {
        return CheckResult {
            checkpoint,
            metric,
            value: None,
            threshold: format!("{threshold}; skipped because baseline <= 0"),
            status: if check.required {
                Status::Missing
            } else {
                Status::Skipped
            },
        };
    }

    let regression_percent = ((target - baseline) / baseline) * 100.0;
    let status = if regression_percent > check.max_regression_percent {
        Status::Fail
    } else {
        Status::Pass
    };

    CheckResult {
        checkpoint,
        metric,
        value: Some(regression_percent),
        threshold,
        status,
    }
}

fn evaluate_lod_seam_audit(
    config: &LodSeamAuditConfig,
    summary_path: &Path,
    summary: &BenchSummary,
) -> Vec<CheckResult> {
    let audit_path = summary_path.parent().map(|dir| dir.join("seam-audit.json"));
    let Some(audit_path) = audit_path else {
        return vec![CheckResult {
            checkpoint: summary.scene.clone(),
            metric: "lod_seam_audit (seam-audit.json)".to_string(),
            value: None,
            threshold: "file must exist".to_string(),
            status: Status::Missing,
        }];
    };
    let Ok(dump) = read_json::<SeamAuditDump>(&audit_path) else {
        return vec![CheckResult {
            checkpoint: summary.scene.clone(),
            metric: "lod_seam_audit (seam-audit.json)".to_string(),
            value: None,
            threshold: format!("read {}", audit_path.display()),
            status: Status::Missing,
        }];
    };

    let s = dump.summary;
    let coverage_gaps = dump
        .faces
        .iter()
        .filter(|face| {
            face.samples_without_render_coverage > 0
                && face.final_mode != "DeltaTooLarge"
                && face.final_mode != "SameLod"
        })
        .count() as u32;
    let max_transition_edges = dump
        .faces
        .iter()
        .map(|face| face.unmatched_transition_edges as u32)
        .max()
        .unwrap_or(0);
    let max_regular_edges = dump
        .faces
        .iter()
        .filter(|face| {
            face.final_mode == "InvalidUnsafeTopology" || face.final_mode == "SkirtFallback"
        })
        .map(|face| face.unmatched_regular_edges as u32)
        .max()
        .unwrap_or(0);
    let max_strip_crossings = dump
        .faces
        .iter()
        .filter(|face| claims_stitch_safe_seam(&face.final_mode))
        .map(|face| face.strip_crossing_count as u32)
        .max()
        .unwrap_or(0);
    let min_strip_span_overlap_ratio = dump
        .faces
        .iter()
        .filter(|face| {
            claims_stitch_safe_seam(&face.final_mode)
                && strip_span_overlap_ratio_is_meaningful(&face.strip_overlap_status)
        })
        .map(|face| face.strip_span_overlap_ratio as f64)
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(1.0);
    let max_strip_fine_to_coarse = if dump.schema_version >= 2 {
        s.max_strip_fine_to_coarse_distance_stitch_safe as f64
    } else {
        max_strip_distance_from_stitch_safe_faces(&dump.faces, |face| {
            face.strip_max_fine_to_coarse_distance
        })
    };
    let max_strip_coarse_to_fine = if dump.schema_version >= 2 {
        s.max_strip_coarse_to_fine_distance_stitch_safe as f64
    } else {
        max_strip_distance_from_stitch_safe_faces(&dump.faces, |face| {
            face.strip_max_coarse_to_fine_distance
        })
    };
    let max_strip_endpoint_distance = if dump.schema_version >= 2 {
        s.max_strip_endpoint_distance_stitch_safe as f64
    } else {
        max_strip_distance_from_stitch_safe_faces(&dump.faces, |face| {
            face.strip_max_endpoint_distance
        })
    };
    let strip_incompatible_stitched = dump
        .faces
        .iter()
        .filter(|face| {
            !face.strip_compatible
                && (face.final_mode == "StitchGeometry" || face.final_mode == "GpuMorphOnly")
        })
        .count() as u32;
    let strip_missing_faces = dump
        .faces
        .iter()
        .filter(|face| {
            (face.strip_overlap_status == "MissingFineStrip"
                || face.strip_overlap_status == "MissingCoarseStrip")
                && face.final_mode != "SkirtFallback"
        })
        .count() as u32;
    let strip_topology_unsupported_stitched = dump
        .faces
        .iter()
        .filter(|face| {
            (face.strip_overlap_status == "UnsupportedTopology"
                || face.strip_overlap_status == "FineMultiComponent"
                || face.strip_overlap_status == "CoarseMultiComponent"
                || face.strip_overlap_status == "ComponentMismatch")
                && (face.final_mode == "StitchGeometry" || face.final_mode == "GpuMorphOnly")
        })
        .count() as u32;
    let stitch_safe_bad_component_faces = dump
        .faces
        .iter()
        .filter(|face| {
            claims_stitch_safe_seam(&face.final_mode)
                && (face.fine_components > 1 || face.coarse_components > 1)
        })
        .count() as u32;

    vec![
        seam_audit_check(
            &summary.scene,
            "open_edge_faces",
            s.open_edge_faces as f64,
            config.max_active_seam_faces_with_open_edges as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "coverage_gaps",
            coverage_gaps as f64,
            config.max_active_seam_faces_with_transition_coverage_gaps as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "samples_without_render_coverage",
            s.samples_without_render_coverage as f64,
            config.max_samples_without_render_coverage as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "possible_terrace_samples",
            s.possible_terrace_samples as f64,
            config.max_possible_terrace_samples as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "partial_morph_uncovered_faces",
            s.partial_morph_uncovered_faces as f64,
            config.max_partial_morph_uncovered_faces as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "stale_strip_faces",
            s.stale_strip_faces as f64,
            config.max_stale_strip_faces_after_stable_frames as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "lod_delta_gt_one_faces",
            s.lod_delta_gt_one_faces as f64,
            config.max_lod_delta_gt_one_faces as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_lip_height_voxels",
            s.max_lip_height_voxels as f64,
            config.max_lip_height_voxels as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_face_offset_voxels",
            s.max_face_offset_voxels as f64,
            config.max_face_offset_voxels as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_longest_unmatched_edge_voxels",
            s.max_longest_unmatched_edge_voxels as f64,
            config.max_longest_unmatched_edge_voxels as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_unmatched_transition_edges",
            max_transition_edges as f64,
            config.max_unmatched_transition_edges as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_unmatched_regular_edges_on_delta1_seams",
            max_regular_edges as f64,
            config.max_unmatched_regular_edges_on_delta1_seams as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "strip_incompatible_faces",
            strip_incompatible_stitched as f64,
            config.max_strip_incompatible_faces as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "strip_missing_faces",
            strip_missing_faces as f64,
            config.max_strip_missing_faces_after_stable_frames as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "strip_topology_unsupported_faces",
            strip_topology_unsupported_stitched as f64,
            config.max_strip_topology_unsupported_stitched_faces as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "stitch_safe_bad_component_faces",
            stitch_safe_bad_component_faces as f64,
            config.max_stitch_safe_bad_component_faces as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_strip_fine_to_coarse_distance",
            max_strip_fine_to_coarse,
            config.max_strip_fine_to_coarse_distance_voxels as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_strip_coarse_to_fine_distance",
            max_strip_coarse_to_fine,
            config.max_strip_coarse_to_fine_distance_voxels as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_strip_endpoint_distance",
            max_strip_endpoint_distance,
            config.max_strip_endpoint_distance_voxels as f64,
        ),
        seam_audit_min_check(
            &summary.scene,
            "min_strip_span_overlap_ratio",
            min_strip_span_overlap_ratio,
            config.min_strip_span_overlap_ratio as f64,
        ),
        seam_audit_check(
            &summary.scene,
            "max_strip_crossing_count",
            max_strip_crossings as f64,
            config.max_strip_crossing_count as f64,
        ),
    ]
}

fn seam_audit_check(scene: &str, metric: &str, value: f64, max: f64) -> CheckResult {
    let status = if value > max {
        Status::Fail
    } else {
        Status::Pass
    };
    CheckResult {
        checkpoint: scene.to_string(),
        metric: format!("lod_seam_audit:{metric}"),
        value: Some(value),
        threshold: format!("<= {max}"),
        status,
    }
}

fn seam_audit_min_check(scene: &str, metric: &str, value: f64, min: f64) -> CheckResult {
    let status = if value < min {
        Status::Fail
    } else {
        Status::Pass
    };
    CheckResult {
        checkpoint: scene.to_string(),
        metric: format!("lod_seam_audit:{metric}"),
        value: Some(value),
        threshold: format!(">= {min}"),
        status,
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    serde_json::from_str(&text).map_err(|err| format!("invalid JSON in {}: {err}", path.display()))
}

fn read_toml<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    toml::from_str(&text).map_err(|err| format!("invalid TOML in {}: {err}", path.display()))
}

fn metric_value(summary: &BenchSummary, checkpoint: &str, area: &str, field: &str) -> Option<f64> {
    let checkpoint = summary
        .checkpoints
        .iter()
        .find(|candidate| candidate.name == checkpoint)?;

    if matches!(area, "__frame" | "__frame_total") {
        return match field {
            "median_ms" | "avg_ms" => Some(checkpoint.median_frame_ms),
            "p99_ms" => Some(checkpoint.p99_frame_ms),
            _ => None,
        };
    }

    let area = checkpoint.areas.get(area)?;
    match field {
        "median_ms" | "avg_ms" => Some(area.median_ms),
        "p99_ms" => Some(area.p99_ms),
        "calls_per_frame" => Some(area.calls_per_frame),
        _ => None,
    }
}

fn condition_matches(summary: &BenchSummary, checkpoint: &str, condition: &SkipCondition) -> bool {
    let Some(value) = metric_value(summary, checkpoint, &condition.area, &condition.field) else {
        return false;
    };
    condition.gt.is_some_and(|limit| value > limit)
        || condition.gte.is_some_and(|limit| value >= limit)
        || condition.lt.is_some_and(|limit| value < limit)
        || condition.lte.is_some_and(|limit| value <= limit)
        || condition
            .eq
            .is_some_and(|limit| (value - limit).abs() <= f64::EPSILON)
}

fn is_fail(value: f64, check: &GuardCheck) -> bool {
    check.fail_gt.is_some_and(|limit| value > limit)
        || check.fail_lt.is_some_and(|limit| value < limit)
}

fn is_warn(value: f64, check: &GuardCheck) -> bool {
    check.warn_gt.is_some_and(|limit| value > limit)
        || check.warn_lt.is_some_and(|limit| value < limit)
}

fn threshold_text(check: &GuardCheck) -> String {
    if check.exists {
        return "must exist".to_string();
    }
    let mut parts = Vec::new();
    if let Some(value) = check.warn_gt {
        parts.push(format!("warn > {}", format_number(Some(value))));
    }
    if let Some(value) = check.fail_gt {
        parts.push(format!("fail > {}", format_number(Some(value))));
    }
    if let Some(value) = check.warn_lt {
        parts.push(format!("warn < {}", format_number(Some(value))));
    }
    if let Some(value) = check.fail_lt {
        parts.push(format!("fail < {}", format_number(Some(value))));
    }
    if parts.is_empty() {
        "-".to_string()
    } else if check.unit.is_empty() {
        parts.join("; ")
    } else {
        format!("{} {}", parts.join("; "), check.unit)
    }
}

fn condition_text(condition: &SkipCondition) -> String {
    let mut parts = Vec::new();
    if let Some(value) = condition.gt {
        parts.push(format!(
            "{}:{} > {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.gte {
        parts.push(format!(
            "{}:{} >= {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.lt {
        parts.push(format!(
            "{}:{} < {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.lte {
        parts.push(format!(
            "{}:{} <= {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.eq {
        parts.push(format!(
            "{}:{} == {}",
            condition.area, condition.field, value
        ));
    }
    parts.join(" or ")
}

fn format_metric(check: &GuardCheck) -> String {
    format!("{}:{}", check.area, check.field)
}

fn print_table(results: &[CheckResult]) {
    let headers = ["checkpoint", "metric", "value", "threshold", "status"];
    let mut rows = Vec::with_capacity(results.len());
    for result in results {
        rows.push([
            result.checkpoint.clone(),
            result.metric.clone(),
            format_number(result.value),
            result.threshold.clone(),
            result.status.as_str().to_string(),
        ]);
    }

    let mut widths = headers.map(str::len);
    for row in &rows {
        for (index, value) in row.iter().enumerate() {
            widths[index] = widths[index].max(value.len());
        }
    }

    println!();
    println!("Bench guard checks:");
    println!("  {}", format_row(&headers, &widths));
    println!(
        "  {}",
        widths
            .iter()
            .map(|width| "-".repeat(*width))
            .collect::<Vec<_>>()
            .join("  ")
    );
    for row in rows {
        println!("  {}", format_row(&row, &widths));
    }
}

fn format_row<const N: usize>(row: &[impl AsRef<str>; N], widths: &[usize; N]) -> String {
    row.iter()
        .zip(widths)
        .map(|(value, width)| format!("{:<width$}", value.as_ref(), width = width))
        .collect::<Vec<_>>()
        .join("  ")
}

fn format_number(value: Option<f64>) -> String {
    let Some(value) = value else {
        return "-".to_string();
    };
    if value.abs() >= 100.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.3}")
    }
}

fn default_required() -> bool {
    true
}

fn default_naadf_targets() -> Vec<NaadfGuardTarget> {
    vec![
        NaadfGuardTarget {
            label: "gi".into(),
            scene: "visual-regression-naadf-gi.toml".into(),
            checkpoint: "naadf-gi-experimental".into(),
            baseline_scene: Some("visual-regression-naadf-current.toml".into()),
            baseline_checkpoint: Some("naadf-current-reference".into()),
        },
        NaadfGuardTarget {
            label: "preview".into(),
            scene: "visual-regression-naadf-preview.toml".into(),
            checkpoint: "naadf-preview-experimental".into(),
            baseline_scene: None,
            baseline_checkpoint: None,
        },
        NaadfGuardTarget {
            label: "preview_only".into(),
            scene: "visual-regression-naadf-preview-only.toml".into(),
            checkpoint: "naadf-preview-only".into(),
            baseline_scene: None,
            baseline_checkpoint: None,
        },
        NaadfGuardTarget {
            label: "live_lod_ridge".into(),
            scene: "visual-regression-naadf-live-lod.toml".into(),
            checkpoint: "naadf-live-lod-ridge-run".into(),
            baseline_scene: None,
            baseline_checkpoint: None,
        },
        NaadfGuardTarget {
            label: "live_lod_jump".into(),
            scene: "visual-regression-naadf-live-lod.toml".into(),
            checkpoint: "naadf-live-lod-jump-water".into(),
            baseline_scene: None,
            baseline_checkpoint: None,
        },
        NaadfGuardTarget {
            label: "live_lod_forest".into(),
            scene: "visual-regression-naadf-live-lod.toml".into(),
            checkpoint: "naadf-live-lod-forest-sweep".into(),
            baseline_scene: None,
            baseline_checkpoint: None,
        },
        NaadfGuardTarget {
            label: "startup_stability".into(),
            scene: "visual-regression-naadf-startup-stability.toml".into(),
            checkpoint: "naadf-startup-stability".into(),
            baseline_scene: None,
            baseline_checkpoint: None,
        },
        NaadfGuardTarget {
            label: "dig_edit".into(),
            scene: "dig-edit-naadf-stability.toml".into(),
            checkpoint: "naadf-heavy-dig-edit".into(),
            baseline_scene: None,
            baseline_checkpoint: None,
        },
    ]
}

fn naadf_metric_check(
    label: &str,
    scene: &str,
    checkpoint: &str,
    metric_name: &str,
    area: &str,
    warn_gt: f64,
    fail_gt: f64,
    unit: &str,
) -> GuardCheck {
    GuardCheck {
        name: format!("naadf_{label}_{metric_name}"),
        scene: scene.into(),
        checkpoint: checkpoint.into(),
        area: format!("Counter {area}"),
        field: "avg_ms".into(),
        unit: unit.into(),
        warn_gt: Some(warn_gt),
        fail_gt: Some(fail_gt),
        warn_lt: None,
        fail_lt: None,
        exists: false,
        required: false,
        skip_if: None,
    }
}

fn naadf_area_check(
    label: &str,
    scene: &str,
    checkpoint: &str,
    metric_name: &str,
    area: &str,
    warn_gt: f64,
    fail_gt: f64,
    unit: &str,
) -> GuardCheck {
    GuardCheck {
        name: format!("naadf_{label}_{metric_name}"),
        scene: scene.into(),
        checkpoint: checkpoint.into(),
        area: area.into(),
        field: "avg_ms".into(),
        unit: unit.into(),
        warn_gt: Some(warn_gt),
        fail_gt: Some(fail_gt),
        warn_lt: None,
        fail_lt: None,
        exists: false,
        required: false,
        skip_if: None,
    }
}

fn warning_threshold(fail_threshold: f64) -> f64 {
    fail_threshold * 0.9
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn naadf_config_expands_optional_metric_checks() {
        let config: GuardConfig = toml::from_str(
            r#"
            [naadf]
            max_gpu_memory_mb = 512
            max_dirty_chunks_pending = 256
            max_oldest_dirty_chunk_age_frames = 120
            max_avg_ray_steps = 90
            max_uploaded_chunks_per_frame = 8
            max_frame_time_regression_percent = 10
            max_sun_visibility_rays_per_pixel = 1
            max_contact_shadow_rays_per_pixel = 1
            max_terrain_ao_rays_per_pixel = 4
            max_short_range_rays_per_pixel = 5
            max_froxel_sun_rays_per_frame = 65536
            "#,
        )
        .expect("NAADF guard config should parse");

        let checks = config.expanded_checks();

        assert!(
            checks
                .iter()
                .any(|check| check.name == "naadf_gi_gpu_memory_bytes")
        );
        assert!(
            checks
                .iter()
                .any(|check| check.name == "naadf_gi_dirty_chunks_pending")
        );
        assert!(
            checks
                .iter()
                .any(|check| check.name == "naadf_gi_avg_ray_steps")
        );
        assert!(checks.iter().any(|check| {
            check.name == "naadf_gi_sun_visibility_rays_per_pixel"
                && check.area == "Counter naadf.radiance_sun_visibility_rays_per_pixel"
        }));
        assert!(checks.iter().any(|check| {
            check.name == "naadf_gi_short_range_rays_per_pixel"
                && check.area == "Counter naadf.radiance_short_range_rays_per_pixel"
        }));
        assert!(checks.iter().any(|check| {
            check.name == "naadf_gi_froxel_sun_rays_per_frame"
                && check.area == "Counter naadf.froxel_sun_mask_max_rays_per_frame"
        }));
        assert!(
            checks
                .iter()
                .filter(|check| check.name.starts_with("naadf_"))
                .all(|check| !check.required)
        );
    }

    #[test]
    fn naadf_frame_regression_fails_against_baseline_summary() {
        let check = NaadfFrameRegressionCheck {
            name: "naadf_gi_frame_avg_regression".into(),
            scene: "visual-regression-naadf-gi.toml".into(),
            checkpoint: "naadf-gi-experimental".into(),
            baseline_scene: "visual-regression-naadf-current.toml".into(),
            baseline_checkpoint: "naadf-current-reference".into(),
            field: "avg_ms".into(),
            max_regression_percent: 10.0,
            required: false,
        };
        let summaries = vec![
            (
                PathBuf::from("baseline.json"),
                summary_with_frame(
                    "visual-regression-naadf-current.toml",
                    "naadf-current-reference",
                    10.0,
                    12.0,
                ),
            ),
            (
                PathBuf::from("target.json"),
                summary_with_frame(
                    "visual-regression-naadf-gi.toml",
                    "naadf-gi-experimental",
                    11.2,
                    13.0,
                ),
            ),
        ];

        let result = evaluate_naadf_frame_regression(&check, &summaries);

        assert_eq!(result.status, Status::Fail);
        assert!((result.value.unwrap() - 12.0).abs() <= 1e-9);
    }

    #[test]
    fn strip_guard_policy_ignores_fallback_faces_for_span_ratio() {
        assert!(!claims_stitch_safe_seam("SkirtFallback"));
        assert!(!strip_span_overlap_ratio_is_meaningful(
            "MissingCoarseStrip"
        ));
        assert!(claims_stitch_safe_seam("StitchGeometry"));
        assert!(strip_span_overlap_ratio_is_meaningful(
            "DirectedDistanceExceeded"
        ));
    }

    fn summary_with_frame(scene: &str, checkpoint: &str, avg_ms: f64, p99_ms: f64) -> BenchSummary {
        BenchSummary {
            scene: scene.into(),
            checkpoints: vec![CheckpointSummary {
                name: checkpoint.into(),
                median_frame_ms: avg_ms,
                p99_frame_ms: p99_ms,
                areas: HashMap::new(),
            }],
        }
    }
}
