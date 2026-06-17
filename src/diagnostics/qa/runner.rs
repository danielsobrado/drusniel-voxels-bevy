use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;

use super::config::{QaConfig, QaSceneConfig, QaTimingThreshold};
use super::image_diff::{QaImageError, compare_images};
use super::probes::{ProbeResult, QaProbeError, evaluate_probe};
use super::report::{QaReport, QaReportError, QaSceneReport, QaScreenshotReport};
use super::summary::{BenchSummaryError, read_summary};
use super::timing::{QaTimingError, TimingResult, evaluate_timing};

#[derive(Debug, Error)]
pub enum QaRunnerError {
    #[error(transparent)]
    Summary(#[from] BenchSummaryError),
    #[error(transparent)]
    Image(#[from] QaImageError),
    #[error(transparent)]
    Probe(#[from] QaProbeError),
    #[error(transparent)]
    Timing(#[from] QaTimingError),
    #[error(transparent)]
    Report(#[from] QaReportError),
    #[error("failed to copy baseline {source_path} -> {destination}: {error}")]
    CopyBaseline {
        source_path: PathBuf,
        destination: PathBuf,
        error: std::io::Error,
    },
}

#[derive(Clone, Debug)]
pub struct QaRunOptions {
    pub config_path: PathBuf,
    pub summary_path: PathBuf,
    pub output_dir: PathBuf,
    pub update_baselines: bool,
}

pub fn run_qa(config: &QaConfig, options: &QaRunOptions) -> Result<QaReport, QaRunnerError> {
    let summary = read_summary(&options.summary_path)?;
    let summary_dir = options
        .summary_path
        .parent()
        .unwrap_or_else(|| Path::new("."));
    let mut scene_reports = Vec::new();

    for scene in &config.scenes {
        let mut scene_report = empty_scene_report(scene);
        if let Some(bench_scene) = scene.bench_scene.as_deref()
            && !summary_scene_matches(&summary.scene, bench_scene)
        {
            scene_report.failures.push(format!(
                "configured bench_scene '{bench_scene}' does not match summary scene '{}'; likely wrong summary.json",
                summary.scene
            ));
            scene_report.finalize_status();
            scene_reports.push(scene_report);
            continue;
        }

        let Some(checkpoint) = summary.checkpoint(&scene.checkpoint) else {
            scene_report.failures.push(format!(
                "configured checkpoint '{}' is missing from summary scene '{}'. Likely: a wrong checkpoint name in the QA config, or a summary.json from a different bench scene.",
                scene.checkpoint, summary.scene
            ));
            scene_report.finalize_status();
            scene_reports.push(scene_report);
            continue;
        };
        let mut screenshots_by_id = HashMap::new();

        for screenshot in &scene.screenshots {
            let Some(relative_path) = checkpoint.screenshot_path(&screenshot.name) else {
                let failure = format!(
                    "screenshot '{}' was not captured in checkpoint '{}'. Likely: the bench scene does not define that screenshot point, or the run never reached render-ready.",
                    screenshot.name, scene.checkpoint
                );
                scene_report
                    .failures
                    .push(format!("screenshot '{}': {failure}", screenshot.id));
                scene_report.screenshots.push(QaScreenshotReport {
                    id: screenshot.id.clone(),
                    name: screenshot.name.clone(),
                    path: screenshot.name.clone(),
                    status: "fail".to_string(),
                    baseline_path: None,
                    diff: None,
                    failure: Some(failure),
                });
                continue;
            };
            let actual_path = summary_dir.join(relative_path);
            screenshots_by_id.insert(screenshot.id.clone(), actual_path.clone());

            let baseline_path = screenshot.baseline.clone().unwrap_or_else(|| {
                config
                    .baseline_root
                    .join(&scene.id)
                    .join(format!("{}.png", screenshot.id))
            });
            if options.update_baselines {
                if let Some(parent) = baseline_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| QaRunnerError::CopyBaseline {
                        source_path: actual_path.clone(),
                        destination: baseline_path.clone(),
                        error,
                    })?;
                }
                fs::copy(&actual_path, &baseline_path).map_err(|error| {
                    QaRunnerError::CopyBaseline {
                        source_path: actual_path.clone(),
                        destination: baseline_path.clone(),
                        error,
                    }
                })?;
            }

            let mut screenshot_report = QaScreenshotReport {
                id: screenshot.id.clone(),
                name: screenshot.name.clone(),
                path: actual_path.display().to_string(),
                status: "pass".to_string(),
                baseline_path: Some(baseline_path.display().to_string()),
                diff: None,
                failure: None,
            };

            if config.image_diff.enabled {
                let diff_path = config.image_diff.write_diff_images.then(|| {
                    options
                        .output_dir
                        .join("diffs")
                        .join(&scene.id)
                        .join(format!("{}.png", screenshot.id))
                });
                match compare_images(
                    &actual_path,
                    &baseline_path,
                    diff_path.as_deref(),
                    config.image_diff.changed_pixel_threshold,
                ) {
                    Ok(metrics) => {
                        let failed = metrics.changed_ratio > config.image_diff.max_changed_ratio
                            || metrics.rmse > config.image_diff.max_rmse
                            || metrics.mean_abs_error > config.image_diff.max_mean_abs_error;
                        if failed {
                            screenshot_report.status = "fail".to_string();
                            screenshot_report.failure = Some(format!(
                                "diff exceeded thresholds: changed_ratio {:.4}, rmse {:.3}, mean_abs_error {:.3}",
                                metrics.changed_ratio, metrics.rmse, metrics.mean_abs_error
                            ));
                        }
                        screenshot_report.diff = Some(metrics);
                    }
                    Err(QaImageError::MissingBaseline { path }) => {
                        if config.image_diff.fail_when_baseline_missing {
                            screenshot_report.status = "fail".to_string();
                            screenshot_report.failure =
                                Some(format!("baseline missing: {}", path.display()));
                        } else {
                            screenshot_report.status = "baseline_missing".to_string();
                        }
                    }
                    Err(error) => {
                        screenshot_report.status = "fail".to_string();
                        screenshot_report.failure = Some(format!("image diff failed: {error}"));
                    }
                }
            }

            if let Some(failure) = &screenshot_report.failure {
                scene_report
                    .failures
                    .push(format!("screenshot '{}': {failure}", screenshot.id));
            }
            scene_report.screenshots.push(screenshot_report);
        }

        for probe in &scene.probes {
            let screenshot_id = probe.screenshot().to_string();
            let Some(path) = screenshots_by_id.get(&screenshot_id) else {
                let result = failed_probe_result(
                    probe.id(),
                    probe.probe_type(),
                    &screenshot_id,
                    "screenshot captured",
                    &QaProbeError::MissingScreenshot {
                        probe_id: probe.id().to_string(),
                        screenshot_id: screenshot_id.clone(),
                    }
                    .to_string(),
                );
                if let Some(failure) = &result.failure {
                    scene_report
                        .failures
                        .push(format!("probe '{}': {failure}", result.id));
                }
                scene_report.probes.push(result);
                continue;
            };
            let result = match evaluate_probe(probe, path) {
                Ok(result) => result,
                Err(error) => failed_probe_result(
                    probe.id(),
                    probe.probe_type(),
                    probe.screenshot(),
                    "probe image readable",
                    &error.to_string(),
                ),
            };
            if let Some(failure) = &result.failure {
                scene_report
                    .failures
                    .push(format!("probe '{}': {failure}", result.id));
            }
            scene_report.probes.push(result);
        }

        if config.timing.enabled {
            for threshold in &scene.timing {
                let result =
                    evaluate_timing(checkpoint, threshold, config.timing.fail_on_threshold)
                        .unwrap_or_else(|error| {
                            failed_timing_result(threshold, &error.to_string())
                        });
                if let Some(failure) = &result.failure {
                    scene_report
                        .failures
                        .push(format!("timing '{}': {failure}", result.id));
                }
                scene_report.timing.push(result);
            }
        }

        scene_report.finalize_status();
        scene_reports.push(scene_report);
    }

    let report = QaReport::new(
        &options.config_path,
        &options.summary_path,
        &options.output_dir,
        &summary,
        scene_reports,
    );
    report.write(
        &options.output_dir,
        &config.report_json_name,
        &config.report_markdown_name,
    )?;
    Ok(report)
}

fn empty_scene_report(scene: &QaSceneConfig) -> QaSceneReport {
    QaSceneReport {
        id: scene.id.clone(),
        checkpoint: scene.checkpoint.clone(),
        status: "pass".to_string(),
        screenshots: Vec::new(),
        probes: Vec::new(),
        timing: Vec::new(),
        failures: Vec::new(),
    }
}

fn summary_scene_matches(summary_scene: &str, configured_bench_scene: &str) -> bool {
    let summary = normalize_path(summary_scene);
    let configured = normalize_path(configured_bench_scene);
    summary == configured
        || Path::new(&configured)
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|file_name| summary == file_name)
}

fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn failed_probe_result(
    id: &str,
    probe_type: &str,
    screenshot: &str,
    expected: &str,
    failure: &str,
) -> ProbeResult {
    ProbeResult {
        id: id.to_string(),
        probe_type: probe_type.to_string(),
        screenshot: screenshot.to_string(),
        status: "fail".to_string(),
        observed: None,
        expected: expected.to_string(),
        failure: Some(failure.to_string()),
    }
}

fn failed_timing_result(threshold: &QaTimingThreshold, failure: &str) -> TimingResult {
    TimingResult {
        id: threshold.id.clone(),
        area: threshold.area.clone(),
        field: threshold.field.clone(),
        status: "fail".to_string(),
        observed_ms: None,
        max_ms: threshold.max_ms,
        failure: Some(failure.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use tempfile::tempdir;

    use super::*;
    use crate::diagnostics::qa::config::{
        QaConfig, QaSceneConfig, QaScreenshotConfig, QaTimingThreshold,
    };

    #[test]
    fn wrong_summary_scene_fails_in_report() {
        let dir = tempdir().unwrap();
        let summary_path = dir.path().join("summary.json");
        fs::write(
            &summary_path,
            json!({
                "scene": "visual-regression-high.toml",
                "checkpoints": []
            })
            .to_string(),
        )
        .unwrap();
        let output_dir = dir.path().join("out");
        let config = QaConfig {
            scenes: vec![QaSceneConfig {
                id: "ridge".into(),
                bench_scene: Some("bench/scenes/visual/visual-regression.toml".into()),
                checkpoint: "ridge-run-noon".into(),
                screenshots: vec![QaScreenshotConfig {
                    id: "start".into(),
                    name: "start".into(),
                    baseline: None,
                }],
                probes: Vec::new(),
                timing: Vec::new(),
            }],
            ..Default::default()
        };

        let report = run_qa(
            &config,
            &QaRunOptions {
                config_path: PathBuf::from("assets/config/qa_visual.yaml"),
                summary_path,
                output_dir: output_dir.clone(),
                update_baselines: false,
            },
        )
        .unwrap();

        assert_eq!(report.overall_status, "fail");
        assert!(report.failures[0].contains("bench_scene"));
        assert!(output_dir.join("qa-report.json").exists());
    }

    #[test]
    fn missing_required_timing_metric_fails_in_report() {
        let dir = tempdir().unwrap();
        let summary_path = dir.path().join("summary.json");
        fs::write(
            &summary_path,
            json!({
                "scene": "visual-regression.toml",
                "checkpoints": [{
                    "name": "ridge-run-noon",
                    "median_frame_ms": 4.0,
                    "p99_frame_ms": 7.0,
                    "areas": {},
                    "runs": []
                }]
            })
            .to_string(),
        )
        .unwrap();
        let output_dir = dir.path().join("out");
        let config = QaConfig {
            scenes: vec![QaSceneConfig {
                id: "ridge".into(),
                bench_scene: Some("bench/scenes/visual/visual-regression.toml".into()),
                checkpoint: "ridge-run-noon".into(),
                screenshots: Vec::new(),
                probes: Vec::new(),
                timing: vec![QaTimingThreshold {
                    id: "render".into(),
                    area: "Render".into(),
                    field: "p99_ms".into(),
                    max_ms: 10.0,
                    optional: false,
                }],
            }],
            ..Default::default()
        };

        let report = run_qa(
            &config,
            &QaRunOptions {
                config_path: PathBuf::from("assets/config/qa_visual.yaml"),
                summary_path,
                output_dir: output_dir.clone(),
                update_baselines: false,
            },
        )
        .unwrap();

        assert_eq!(report.overall_status, "fail");
        assert_eq!(report.scenes[0].timing[0].status, "fail");
        assert_eq!(report.scenes[0].timing[0].observed_ms, None);
        assert!(output_dir.join("qa-report.md").exists());
    }

    #[test]
    fn missing_checkpoint_is_reported_without_aborting() {
        let dir = tempdir().unwrap();
        let summary_path = dir.path().join("summary.json");
        fs::write(
            &summary_path,
            json!({
                "scene": "visual-regression.toml",
                "checkpoints": [{
                    "name": "some-other-checkpoint",
                    "median_frame_ms": 4.0,
                    "p99_frame_ms": 7.0,
                    "areas": {},
                    "runs": []
                }]
            })
            .to_string(),
        )
        .unwrap();
        let output_dir = dir.path().join("out");
        let config = QaConfig {
            scenes: vec![QaSceneConfig {
                id: "ridge".into(),
                bench_scene: Some("bench/scenes/visual/visual-regression.toml".into()),
                checkpoint: "ridge-run-noon".into(),
                screenshots: vec![QaScreenshotConfig {
                    id: "start".into(),
                    name: "start".into(),
                    baseline: None,
                }],
                probes: Vec::new(),
                timing: Vec::new(),
            }],
            ..Default::default()
        };

        let report = run_qa(
            &config,
            &QaRunOptions {
                config_path: PathBuf::from("assets/config/qa_visual.yaml"),
                summary_path,
                output_dir: output_dir.clone(),
                update_baselines: false,
            },
        )
        .unwrap();

        assert_eq!(report.overall_status, "fail");
        assert!(report.failures[0].contains("checkpoint"));
        assert!(output_dir.join("qa-report.json").exists());
    }
}
