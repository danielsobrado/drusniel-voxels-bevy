use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

use super::gates::{CounterGateResult, InformationalMetricResult, TimingGateResult};
use super::image_metrics::{ImageComparison, ImageMetrics};
use super::region_probes::RegionProbeResult;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UnifiedStatus {
    Pass,
    Fail,
    BaselineMissing,
    NotApplicable,
    NonAuthoritative,
    Error,
}

impl UnifiedStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::BaselineMissing => "BASELINE_MISSING",
            Self::NotApplicable => "NOT_APPLICABLE",
            Self::NonAuthoritative => "NON_AUTHORITATIVE",
            Self::Error => "ERROR",
        }
    }

    pub const fn is_failure(self) -> bool {
        matches!(self, Self::Fail | Self::Error)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ImageArtifactReport {
    pub baseline: String,
    pub actual: String,
    pub mask: Option<String>,
    pub baseline_missing: bool,
    pub gated_metrics: Option<ImageMetrics>,
    pub comparison: Option<ImageComparison>,
    pub diff: Option<String>,
    pub heatmap: Option<String>,
    pub changed_mask: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UnifiedSceneReport {
    pub id: String,
    pub target: String,
    pub status: UnifiedStatus,
    pub reproduction_command: String,
    pub failures: Vec<String>,
    pub timing: Vec<TimingGateResult>,
    pub counters: Vec<CounterGateResult>,
    pub informational: Vec<InformationalMetricResult>,
    pub regions: Vec<RegionProbeResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageArtifactReport>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct UnifiedQaReport {
    pub schema_version: u32,
    pub status: UnifiedStatus,
    pub generated_utc: String,
    pub authoritative: bool,
    pub manifest_paths: Vec<String>,
    pub summary_path: String,
    pub environment_path: String,
    pub scenes: Vec<UnifiedSceneReport>,
    pub failures: Vec<String>,
}

#[derive(Debug, Error)]
pub enum UnifiedReportError {
    #[error("failed to create report directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to serialize unified QA report: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write unified QA report {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

pub fn write_unified_reports(
    report: &UnifiedQaReport,
    output_dir: &Path,
) -> Result<(), UnifiedReportError> {
    fs::create_dir_all(output_dir).map_err(|source| UnifiedReportError::CreateDir {
        path: output_dir.to_path_buf(),
        source,
    })?;
    write(
        &output_dir.join("report.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(report).map_err(UnifiedReportError::Serialize)?
        ),
    )?;
    write(&output_dir.join("report.md"), markdown(report))?;
    write(&output_dir.join("report.html"), html(report))?;
    write(&output_dir.join("junit.xml"), junit(report))?;
    Ok(())
}

fn write(path: &Path, content: String) -> Result<(), UnifiedReportError> {
    fs::write(path, content).map_err(|source| UnifiedReportError::Write {
        path: path.to_path_buf(),
        source,
    })
}

fn markdown(report: &UnifiedQaReport) -> String {
    let mut lines = vec![
        "# Unified QA Report".to_string(),
        String::new(),
        format!("Status: **{}**", report.status.as_str()),
        format!("Authoritative: **{}**", report.authoritative),
        format!("Summary: `{}`", report.summary_path),
        format!("Environment: `{}`", report.environment_path),
        String::new(),
    ];
    if !report.failures.is_empty() {
        lines.push("## Failures".to_string());
        lines.push(String::new());
        lines.extend(report.failures.iter().map(|failure| format!("- {failure}")));
        lines.push(String::new());
    }
    lines.extend([
        "## Scenes".to_string(),
        String::new(),
        "| Scene | Target | Status | Failures |".to_string(),
        "|---|---|---|---|".to_string(),
    ]);
    lines.extend(report.scenes.iter().map(|scene| {
        format!(
            "| {} | {} | {} | {} |",
            scene.id,
            scene.target,
            scene.status.as_str(),
            escape_markdown(&scene.failures.join("; "))
        )
    }));

    for scene in &report.scenes {
        lines.extend([
            String::new(),
            format!("## {}", scene.id),
            String::new(),
            format!("Reproduce: `{}`", scene.reproduction_command),
            String::new(),
        ]);
        if let Some(image) = &scene.image {
            lines.extend([
                "### Image".to_string(),
                String::new(),
                format!("- Baseline: `{}`", image.baseline),
                format!("- Actual: `{}`", image.actual),
                format!("- Diff: `{}`", image.diff.as_deref().unwrap_or("-")),
                format!("- Heatmap: `{}`", image.heatmap.as_deref().unwrap_or("-")),
                format!(
                    "- Changed mask: `{}`",
                    image.changed_mask.as_deref().unwrap_or("-")
                ),
                String::new(),
            ]);
        }
        if !scene.timing.is_empty() {
            lines.extend([
                "### Timing".to_string(),
                String::new(),
                "| Gate | Metric | Status | Observed | Maximum |".to_string(),
                "|---|---|---|---:|---:|".to_string(),
            ]);
            lines.extend(scene.timing.iter().map(|gate| {
                format!(
                    "| {} | {} | {} | {} | {:.4} |",
                    gate.id,
                    gate.metric,
                    gate.status.as_str(),
                    gate.observed
                        .map(|value| format!("{value:.4}"))
                        .unwrap_or_else(|| "-".to_string()),
                    gate.max
                )
            }));
            lines.push(String::new());
        }
        if !scene.counters.is_empty() {
            lines.extend([
                "### Counters".to_string(),
                String::new(),
                "| Gate | Counter | Status | Observed | Expected |".to_string(),
                "|---|---|---|---:|---|".to_string(),
            ]);
            lines.extend(scene.counters.iter().map(|gate| {
                format!(
                    "| {} | {} | {} | {} | {} |",
                    gate.id,
                    gate.key,
                    gate.status.as_str(),
                    gate.observed
                        .map(|value| format!("{value:.4}"))
                        .unwrap_or_else(|| "-".to_string()),
                    gate.expected
                )
            }));
            lines.push(String::new());
        }
        if !scene.regions.is_empty() {
            lines.extend([
                "### Regions".to_string(),
                String::new(),
                "| Region | Status | Luminance | Stddev | Chroma | Black | Clipped |".to_string(),
                "|---|---|---:|---:|---:|---:|---:|".to_string(),
            ]);
            lines.extend(scene.regions.iter().map(|region| {
                format!(
                    "| {} | {} | {:.4} | {:.4} | {:.4} | {:.4} | {:.4} |",
                    region.id,
                    region.status.as_str(),
                    region.metrics.luminance_mean,
                    region.metrics.luminance_stddev,
                    region.metrics.chroma_mean,
                    region.metrics.black_pixel_fraction,
                    region.metrics.clipped_pixel_fraction,
                )
            }));
        }
    }
    format!("{}\n", lines.join("\n"))
}

fn html(report: &UnifiedQaReport) -> String {
    let rows = report
        .scenes
        .iter()
        .map(|scene| {
            format!(
                "<tr><td>{}</td><td>{}</td><td class=\"{}\">{}</td><td>{}</td></tr>",
                escape_html(&scene.id),
                escape_html(&scene.target),
                scene.status.as_str(),
                scene.status.as_str(),
                escape_html(&scene.failures.join("; "))
            )
        })
        .collect::<String>();
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Unified QA</title><style>body{{font:14px system-ui;margin:2rem}}table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #bbb;padding:.5rem;text-align:left}}.FAIL,.ERROR{{font-weight:700}}</style></head><body><h1>Unified QA Report</h1><p>Status: <strong class=\"{}\">{}</strong></p><p>Authoritative: {}</p><table><thead><tr><th>Scene</th><th>Target</th><th>Status</th><th>Failures</th></tr></thead><tbody>{}</tbody></table></body></html>\n",
        report.status.as_str(),
        report.status.as_str(),
        report.authoritative,
        rows
    )
}

fn junit(report: &UnifiedQaReport) -> String {
    let failures = report
        .scenes
        .iter()
        .filter(|scene| scene.status.is_failure())
        .count();
    let cases = report
        .scenes
        .iter()
        .map(|scene| {
            let failure = if scene.status.is_failure() {
                format!(
                    "<failure message=\"{}\"/>",
                    escape_xml(&scene.failures.join("; "))
                )
            } else {
                String::new()
            };
            let skipped = if matches!(
                scene.status,
                UnifiedStatus::NotApplicable
                    | UnifiedStatus::BaselineMissing
                    | UnifiedStatus::NonAuthoritative
            ) {
                format!("<skipped message=\"{}\"/>", scene.status.as_str())
            } else {
                String::new()
            };
            format!(
                "<testcase classname=\"unified-qa\" name=\"{}\">{}{}</testcase>",
                escape_xml(&scene.id),
                failure,
                skipped
            )
        })
        .collect::<String>();
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><testsuite name=\"unified-qa\" tests=\"{}\" failures=\"{}\">{}</testsuite>\n",
        report.scenes.len(),
        failures,
        cases
    )
}

fn escape_markdown(value: &str) -> String {
    value.replace('|', "\\|").replace('\n', " ")
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_xml(value: &str) -> String {
    escape_html(value).replace('\'', "&apos;")
}
