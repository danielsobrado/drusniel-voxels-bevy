use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use thiserror::Error;

use super::image_diff::ImageDiffMetrics;
use super::probes::ProbeResult;
use super::summary::BenchSummary;
use super::timing::TimingResult;

pub use super::constants::QA_REPORT_SCHEMA_VERSION;

#[derive(Debug, Error)]
pub enum QaReportError {
    #[error("failed to create report directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to serialize QA report: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write report {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

#[derive(Clone, Debug, Serialize)]
pub struct QaReport {
    pub schema_version: u32,
    pub overall_status: String,
    pub config_path: String,
    pub summary_path: String,
    pub output_dir: String,
    pub bench: BenchReportMetadata,
    pub scenes: Vec<QaSceneReport>,
    pub failures: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BenchReportMetadata {
    pub scene: String,
    pub git_sha: Option<String>,
    pub git_dirty: Option<bool>,
    pub build_profile: String,
    pub platform: String,
    pub bevy_version: String,
    pub run_started_utc: String,
    pub duration_secs: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct QaSceneReport {
    pub id: String,
    pub checkpoint: String,
    pub status: String,
    pub screenshots: Vec<QaScreenshotReport>,
    pub probes: Vec<ProbeResult>,
    pub timing: Vec<TimingResult>,
    pub failures: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct QaScreenshotReport {
    pub id: String,
    pub name: String,
    pub path: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<ImageDiffMetrics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

impl QaReport {
    pub fn new(
        config_path: &Path,
        summary_path: &Path,
        output_dir: &Path,
        summary: &BenchSummary,
        scenes: Vec<QaSceneReport>,
    ) -> Self {
        let mut failures = Vec::new();
        let mut baseline_missing = false;
        for scene in &scenes {
            for failure in &scene.failures {
                failures.push(format!("{}: {failure}", scene.id));
            }
            baseline_missing |= scene.status == "baseline_missing";
        }
        let overall_status = if failures.is_empty() {
            if baseline_missing {
                "baseline_missing"
            } else {
                "pass"
            }
        } else {
            "fail"
        };

        Self {
            schema_version: QA_REPORT_SCHEMA_VERSION,
            overall_status: overall_status.to_string(),
            config_path: config_path.display().to_string(),
            summary_path: summary_path.display().to_string(),
            output_dir: output_dir.display().to_string(),
            bench: BenchReportMetadata {
                scene: summary.scene.clone(),
                git_sha: summary.git_sha.clone(),
                git_dirty: summary.git_dirty,
                build_profile: summary.build_profile.clone(),
                platform: summary.platform.clone(),
                bevy_version: summary.bevy_version.clone(),
                run_started_utc: summary.run_started_utc.clone(),
                duration_secs: summary.duration_secs,
            },
            scenes,
            failures,
        }
    }

    pub fn write(
        &self,
        output_dir: &Path,
        json_name: &str,
        markdown_name: &str,
    ) -> Result<(), QaReportError> {
        fs::create_dir_all(output_dir).map_err(|source| QaReportError::CreateDir {
            path: output_dir.to_path_buf(),
            source,
        })?;
        let json_path = output_dir.join(json_name);
        let markdown_path = output_dir.join(markdown_name);
        let json = serde_json::to_string_pretty(self).map_err(QaReportError::Serialize)?;
        fs::write(&json_path, json).map_err(|source| QaReportError::Write {
            path: json_path,
            source,
        })?;
        fs::write(&markdown_path, self.to_markdown()).map_err(|source| QaReportError::Write {
            path: markdown_path,
            source,
        })?;
        Ok(())
    }

    pub fn to_markdown(&self) -> String {
        let mut out = String::new();
        out.push_str("# QA Report\n\n");
        out.push_str(&format!("Overall status: **{}**\n\n", self.overall_status));
        out.push_str(&format!(
            "- Summary: `{}`\n- Bench scene: `{}`\n- Git: `{}` dirty `{}`\n- Profile: `{}` platform `{}` Bevy `{}`\n\n",
            self.summary_path,
            self.bench.scene,
            self.bench.git_sha.as_deref().unwrap_or("-"),
            self.bench
                .git_dirty
                .map(|value| value.to_string())
                .unwrap_or_else(|| "-".to_string()),
            self.bench.build_profile,
            self.bench.platform,
            self.bench.bevy_version,
        ));
        out.push_str("## Reproduce\n\n");
        out.push_str(&format!(
            "```\ncargo run --bin qa -- --config {} --summary {} --output {}\n```\n\n",
            self.config_path, self.summary_path, self.output_dir,
        ));
        out.push_str("## Scenes\n\n");
        out.push_str("| scene | checkpoint | status | screenshots | probes | timing |\n");
        out.push_str("|---|---|---|---:|---:|---:|\n");
        for scene in &self.scenes {
            out.push_str(&format!(
                "| {} | {} | {} | {} | {} | {} |\n",
                scene.id,
                scene.checkpoint,
                scene.status,
                scene.screenshots.len(),
                scene.probes.len(),
                scene.timing.len(),
            ));
        }
        for scene in &self.scenes {
            out.push_str(&format!("\n### {}\n\n", scene.id));
            out.push_str("Screenshots:\n\n");
            out.push_str("| id | name | status | path | baseline | diff |\n");
            out.push_str("|---|---|---|---|---|---|\n");
            for screenshot in &scene.screenshots {
                out.push_str(&format!(
                    "| {} | {} | {} | `{}` | `{}` | {} |\n",
                    screenshot.id,
                    screenshot.name,
                    screenshot.status,
                    screenshot.path,
                    screenshot.baseline_path.as_deref().unwrap_or("-"),
                    screenshot
                        .diff
                        .as_ref()
                        .and_then(|diff| diff.diff_path.as_deref())
                        .unwrap_or("-"),
                ));
            }
            if !scene.probes.is_empty() {
                out.push_str("\nProbes:\n\n");
                out.push_str("| id | type | screenshot | status | observed | expected |\n");
                out.push_str("|---|---|---|---|---:|---|\n");
                for probe in &scene.probes {
                    out.push_str(&format!(
                        "| {} | {} | {} | {} | {} | {} |\n",
                        probe.id,
                        probe.probe_type,
                        probe.screenshot,
                        probe.status,
                        probe
                            .observed
                            .map(|value| format!("{value:.4}"))
                            .unwrap_or_else(|| "-".to_string()),
                        probe.expected,
                    ));
                }
            }
            if !scene.timing.is_empty() {
                out.push_str("\nTiming:\n\n");
                out.push_str("| id | metric | status | observed | max |\n");
                out.push_str("|---|---|---|---:|---:|\n");
                for timing in &scene.timing {
                    out.push_str(&format!(
                        "| {} | {}.{} | {} | {} | {:.3}ms |\n",
                        timing.id,
                        timing.area,
                        timing.field,
                        timing.status,
                        timing
                            .observed_ms
                            .map(|value| format!("{value:.3}ms"))
                            .unwrap_or_else(|| "-".to_string()),
                        timing.max_ms,
                    ));
                }
            }
        }
        if !self.failures.is_empty() {
            out.push_str("\n## Failures\n\n");
            for failure in &self.failures {
                out.push_str(&format!("- {failure}\n"));
            }
        }
        out.push_str("\n## Next actions\n\n");
        match self.overall_status.as_str() {
            "fail" => {
                out.push_str(
                    "- Investigate each failure above; the diff images under the `diffs/` output dir show where pixels moved.\n",
                );
                out.push_str(
                    "- If the new output is correct, refresh baselines with `--update-baselines` and record why in `docs/qa/STATUS.md`. Never relax a threshold to hide a real regression.\n",
                );
            }
            "baseline_missing" => {
                out.push_str(
                    "- No committed baseline yet: capture one from this known-good run with `--update-baselines`, then commit it per the baseline policy in `docs/qa/STATUS.md`.\n",
                );
            }
            _ => out.push_str("- No action needed; all checks passed.\n"),
        }
        out
    }
}

impl QaSceneReport {
    pub fn finalize_status(&mut self) {
        let screenshot_missing = self
            .screenshots
            .iter()
            .any(|screenshot| screenshot.status == "baseline_missing");
        let failed = !self.failures.is_empty()
            || self
                .screenshots
                .iter()
                .any(|screenshot| screenshot.status == "fail")
            || self.probes.iter().any(|probe| probe.status == "fail")
            || self.timing.iter().any(|timing| timing.status == "fail");
        self.status = if failed {
            "fail".to_string()
        } else if screenshot_missing {
            "baseline_missing".to_string()
        } else {
            "pass".to_string()
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_round_trips_json() {
        let report = QaReport {
            schema_version: QA_REPORT_SCHEMA_VERSION,
            overall_status: "pass".into(),
            config_path: "assets/config/qa_visual.yaml".into(),
            summary_path: "summary.json".into(),
            output_dir: "bench-runs/qa/latest".into(),
            bench: BenchReportMetadata {
                scene: "scene.toml".into(),
                git_sha: None,
                git_dirty: None,
                build_profile: "debug".into(),
                platform: "linux".into(),
                bevy_version: "0.18.1".into(),
                run_started_utc: "now".into(),
                duration_secs: 1.0,
            },
            scenes: Vec::new(),
            failures: Vec::new(),
        };
        let json = serde_json::to_string(&report).unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["schema_version"], QA_REPORT_SCHEMA_VERSION);
    }
}
