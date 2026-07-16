use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use thiserror::Error;

use super::environment::capture_environment;
use super::gates::{
    GateStatus, evaluate_counter_gates, evaluate_timing_gates, read_informational_metrics,
};
use super::image_linear::{LinearImageError, load_linear_image, load_mask};
use super::image_metrics::{
    ImageArtifactPaths, ImageMetricsError, compare_images, write_image_artifacts,
};
use super::manifest::{ManifestError, Registry, load_registry_with_legacy};
use super::region_probes::{RegionStatus, evaluate_region_probe};
use super::report::{
    ImageArtifactReport, UnifiedQaReport, UnifiedReportError, UnifiedSceneReport, UnifiedStatus,
    write_unified_reports,
};
use super::schema::{Scene, Target};
use super::summary::{SummaryError, UnifiedCheckpoint, UnifiedSummary, read_summary};

#[derive(Clone, Debug)]
pub struct UnifiedRunOptions {
    pub visual_manifest: PathBuf,
    pub performance_manifest: PathBuf,
    pub legacy_map: Option<PathBuf>,
    pub summary_path: PathBuf,
    pub output_dir: PathBuf,
    pub tags: Vec<String>,
    pub scene_ids: Vec<String>,
    pub target: Target,
    pub actual_root: Option<PathBuf>,
}

#[derive(Debug, Error)]
pub enum UnifiedRunnerError {
    #[error(transparent)]
    Manifest(#[from] ManifestError),
    #[error(transparent)]
    Summary(#[from] SummaryError),
    #[error(transparent)]
    LinearImage(#[from] LinearImageError),
    #[error(transparent)]
    ImageMetrics(#[from] ImageMetricsError),
    #[error(transparent)]
    Report(#[from] UnifiedReportError),
    #[error("no enabled {target} QA scenes matched tags=[{tags}] scenes=[{scenes}]")]
    NoScenes {
        target: String,
        tags: String,
        scenes: String,
    },
    #[error("failed to create QA artifact directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to copy QA image {source_path} to {destination}: {source}")]
    CopyImage {
        source_path: PathBuf,
        destination: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to serialize QA artifact: {0}")]
    SerializeJson(serde_json::Error),
    #[error("failed to serialize manifest snapshot: {0}")]
    SerializeYaml(serde_yaml::Error),
    #[error("failed to write QA artifact {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

pub fn run_unified_qa(options: &UnifiedRunOptions) -> Result<UnifiedQaReport, UnifiedRunnerError> {
    let registry = load_registry_with_legacy(
        &options.visual_manifest,
        &options.performance_manifest,
        options.legacy_map.as_deref(),
    )?;
    let scenes = registry.select(&options.tags, &options.scene_ids, Some(options.target));
    if scenes.is_empty() {
        return Err(UnifiedRunnerError::NoScenes {
            target: options.target.as_str().to_string(),
            tags: options.tags.join(","),
            scenes: options.scene_ids.join(","),
        });
    }

    let summary = read_summary(&options.summary_path)?;
    let repository_root = repository_root(&options.visual_manifest);
    create_dir(&options.output_dir)?;
    write_manifest_snapshot(&registry, &scenes, &options.output_dir)?;

    let environment = capture_environment(&summary, &registry, scenes[0]);
    let environment_path = options.output_dir.join("environment.json");
    write_json(&environment_path, &environment)?;

    let mut scene_reports = Vec::with_capacity(scenes.len());
    for scene in scenes {
        scene_reports.push(evaluate_scene(
            scene,
            &summary,
            options,
            &repository_root,
            environment.authoritative,
        )?);
    }

    let failures = scene_reports
        .iter()
        .flat_map(|scene| {
            scene
                .failures
                .iter()
                .map(move |failure| format!("{}: {failure}", scene.id))
        })
        .collect::<Vec<_>>();
    let mut status = if failures.is_empty() {
        if scene_reports
            .iter()
            .any(|scene| scene.status == UnifiedStatus::BaselineMissing)
        {
            UnifiedStatus::BaselineMissing
        } else if scene_reports
            .iter()
            .all(|scene| scene.status == UnifiedStatus::NotApplicable)
        {
            UnifiedStatus::NotApplicable
        } else {
            UnifiedStatus::Pass
        }
    } else {
        UnifiedStatus::Fail
    };
    if !environment.authoritative && status == UnifiedStatus::Pass {
        status = UnifiedStatus::NonAuthoritative;
    }

    let report = UnifiedQaReport {
        schema_version: 1,
        status,
        generated_utc: generated_timestamp(&summary),
        authoritative: environment.authoritative,
        manifest_paths: vec![
            options.visual_manifest.display().to_string(),
            options.performance_manifest.display().to_string(),
        ],
        summary_path: options.summary_path.display().to_string(),
        environment_path: environment_path.display().to_string(),
        scenes: scene_reports,
        failures,
    };
    write_unified_reports(&report, &options.output_dir)?;
    Ok(report)
}

fn evaluate_scene(
    scene: &Scene,
    summary: &UnifiedSummary,
    options: &UnifiedRunOptions,
    repository_root: &Path,
    authoritative: bool,
) -> Result<UnifiedSceneReport, UnifiedRunnerError> {
    let Some(checkpoint) = summary.checkpoint(&scene.capture.checkpoint) else {
        return Ok(missing_checkpoint(scene));
    };

    let timing = evaluate_timing_gates(checkpoint, &scene.timing_gates);
    let counters = evaluate_counter_gates(checkpoint, &scene.counter_gates);
    let informational = read_informational_metrics(checkpoint, &scene.informational_metrics);
    let mut failures = timing
        .iter()
        .filter_map(|result| result.failure.clone())
        .chain(counters.iter().filter_map(|result| result.failure.clone()))
        .collect::<Vec<_>>();

    let scene_dir = options
        .output_dir
        .join("scenes")
        .join(scene.target.as_str())
        .join(&scene.id);
    create_dir(&scene_dir)?;
    write_json(&scene_dir.join("actual.stats.json"), checkpoint)?;

    let actual_source = find_actual_image(checkpoint, scene, options);
    let baseline_path = repository_root.join(&scene.baseline.image);
    let mask_path = scene
        .baseline
        .mask
        .as_ref()
        .map(|path| repository_root.join(path));
    let mut regions = Vec::new();
    let mut image_report = None;
    let mut baseline_missing = false;

    if let Some(actual_source) = actual_source.filter(|path| path.exists()) {
        let actual_path = scene_dir.join("actual.png");
        copy_image(&actual_source, &actual_path)?;
        let actual = load_linear_image(&actual_path)?;
        for probe in &scene.region_probes {
            let result = evaluate_region_probe(&actual, probe);
            failures.extend(
                result
                    .failures
                    .iter()
                    .map(|failure| format!("{}: {failure}", probe.id)),
            );
            regions.push(result);
        }
        write_json(&scene_dir.join("regions.json"), &regions)?;

        if baseline_path.exists() {
            let baseline = load_linear_image(&baseline_path)?;
            let weights = mask_path
                .as_deref()
                .map(|path| load_mask(path, actual.width, actual.height))
                .transpose()?;
            let comparison = compare_images(
                &baseline,
                &actual,
                scene.image_gates.changed_pixel_threshold,
                weights.as_deref(),
            )?;
            let metrics = comparison.gated_metrics().clone();
            if scene.image_gates.required {
                gate_image(
                    "mean absolute error",
                    metrics.mean_absolute_error,
                    scene.image_gates.mean_absolute_error_max,
                    &mut failures,
                );
                gate_image(
                    "p95 absolute error",
                    metrics.p95_absolute_error,
                    scene.image_gates.p95_absolute_error_max,
                    &mut failures,
                );
                gate_image(
                    "changed pixel fraction",
                    metrics.changed_pixel_fraction,
                    scene.image_gates.changed_pixel_fraction_max,
                    &mut failures,
                );
                gate_image(
                    "edge error mean",
                    metrics.edge_error_mean,
                    scene.image_gates.edge_error_mean_max,
                    &mut failures,
                );
                gate_image(
                    "luminance mean delta",
                    (metrics.luminance_mean_actual - metrics.luminance_mean_baseline).abs(),
                    scene.image_gates.luminance_mean_delta_max,
                    &mut failures,
                );
                gate_image(
                    "luminance stddev delta",
                    (metrics.luminance_stddev_actual - metrics.luminance_stddev_baseline).abs(),
                    scene.image_gates.luminance_stddev_delta_max,
                    &mut failures,
                );
                gate_image(
                    "chroma mean delta",
                    (metrics.chroma_mean_actual - metrics.chroma_mean_baseline).abs(),
                    scene.image_gates.chroma_mean_delta_max,
                    &mut failures,
                );
            }

            let diff_path = scene_dir.join("diff.png");
            let heatmap_path = scene_dir.join("heatmap.png");
            let changed_mask_path = scene_dir.join("changed-mask.png");
            write_image_artifacts(
                &baseline,
                &actual,
                &comparison,
                &ImageArtifactPaths {
                    diff: &diff_path,
                    heatmap: &heatmap_path,
                    changed_mask: &changed_mask_path,
                },
            )?;
            write_json(&scene_dir.join("actual.metrics.json"), &comparison)?;
            image_report = Some(ImageArtifactReport {
                baseline: baseline_path.display().to_string(),
                actual: actual_path.display().to_string(),
                mask: mask_path.map(|path| path.display().to_string()),
                baseline_missing: false,
                gated_metrics: Some(metrics),
                comparison: Some(comparison),
                diff: Some(diff_path.display().to_string()),
                heatmap: Some(heatmap_path.display().to_string()),
                changed_mask: Some(changed_mask_path.display().to_string()),
            });
        } else {
            baseline_missing = true;
            if scene.image_gates.required {
                failures.push(format!(
                    "baseline image missing: {}",
                    baseline_path.display()
                ));
            }
            image_report = Some(ImageArtifactReport {
                baseline: baseline_path.display().to_string(),
                actual: actual_path.display().to_string(),
                mask: mask_path.map(|path| path.display().to_string()),
                baseline_missing: true,
                gated_metrics: None,
                comparison: None,
                diff: None,
                heatmap: None,
                changed_mask: None,
            });
        }
    } else if scene.image_gates.required || !scene.region_probes.is_empty() {
        failures.push(format!(
            "actual image missing for checkpoint '{}' image '{}'",
            scene.capture.checkpoint, scene.capture.image
        ));
    }

    write_json(&scene_dir.join("timing.json"), &timing)?;
    let mut status = if !failures.is_empty()
        || timing.iter().any(|result| result.status == GateStatus::Fail)
        || counters.iter().any(|result| result.status == GateStatus::Fail)
        || regions.iter().any(|result| result.status == RegionStatus::Fail)
    {
        UnifiedStatus::Fail
    } else if baseline_missing {
        UnifiedStatus::BaselineMissing
    } else {
        UnifiedStatus::Pass
    };
    if !authoritative && status == UnifiedStatus::Pass {
        status = UnifiedStatus::NonAuthoritative;
    }

    Ok(UnifiedSceneReport {
        id: scene.id.clone(),
        target: scene.target.as_str().to_string(),
        status,
        reproduction_command: scene.reproduction_command(),
        failures,
        timing,
        counters,
        informational,
        regions,
        image: image_report,
    })
}

fn find_actual_image(
    checkpoint: &UnifiedCheckpoint,
    scene: &Scene,
    options: &UnifiedRunOptions,
) -> Option<PathBuf> {
    let relative = checkpoint.screenshot_path(&scene.capture.image)?;
    let root = options.actual_root.as_deref().unwrap_or_else(|| {
        options
            .summary_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
    });
    Some(root.join(relative))
}

fn missing_checkpoint(scene: &Scene) -> UnifiedSceneReport {
    let failure = format!(
        "missing required checkpoint {}",
        scene.capture.checkpoint
    );
    UnifiedSceneReport {
        id: scene.id.clone(),
        target: scene.target.as_str().to_string(),
        status: UnifiedStatus::Fail,
        reproduction_command: scene.reproduction_command(),
        failures: vec![failure],
        timing: Vec::new(),
        counters: Vec::new(),
        informational: Vec::new(),
        regions: Vec::new(),
        image: None,
    }
}

fn gate_image(label: &str, observed: f64, maximum: f64, failures: &mut Vec<String>) {
    if observed > maximum {
        failures.push(format!("{label} {observed} > {maximum}"));
    }
}

fn repository_root(visual_manifest: &Path) -> PathBuf {
    visual_manifest
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

fn create_dir(path: &Path) -> Result<(), UnifiedRunnerError> {
    fs::create_dir_all(path).map_err(|source| UnifiedRunnerError::CreateDir {
        path: path.to_path_buf(),
        source,
    })
}

fn copy_image(source_path: &Path, destination: &Path) -> Result<(), UnifiedRunnerError> {
    fs::copy(source_path, destination).map_err(|source| UnifiedRunnerError::CopyImage {
        source_path: source_path.to_path_buf(),
        destination: destination.to_path_buf(),
        source,
    })?;
    Ok(())
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), UnifiedRunnerError> {
    let json = serde_json::to_string_pretty(value).map_err(UnifiedRunnerError::SerializeJson)?;
    fs::write(path, format!("{json}\n")).map_err(|source| UnifiedRunnerError::Write {
        path: path.to_path_buf(),
        source,
    })
}

fn write_manifest_snapshot(
    registry: &Registry,
    scenes: &[&Scene],
    output_dir: &Path,
) -> Result<(), UnifiedRunnerError> {
    #[derive(Serialize)]
    struct Snapshot<'a> {
        schema_version: u32,
        baseline_version: u32,
        manifest_hash: &'a str,
        scenes: &'a [&'a Scene],
    }
    let snapshot = Snapshot {
        schema_version: 1,
        baseline_version: registry.baseline_version,
        manifest_hash: &registry.manifest_hash,
        scenes,
    };
    let yaml = serde_yaml::to_string(&snapshot).map_err(UnifiedRunnerError::SerializeYaml)?;
    let path = output_dir.join("manifest.snapshot.yaml");
    fs::write(&path, yaml).map_err(|source| UnifiedRunnerError::Write { path, source })
}

fn generated_timestamp(summary: &UnifiedSummary) -> String {
    if !summary.run_started_utc.trim().is_empty() {
        return summary.run_started_utc.clone();
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs());
    format!("unix:{seconds}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repository_root_is_two_levels_above_manifest_directory() {
        assert_eq!(
            repository_root(Path::new("validation/manifests/visual-regression.yaml")),
            PathBuf::from("")
        );
    }
}
