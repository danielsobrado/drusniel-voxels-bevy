use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum BenchSummaryError {
    #[error("failed to read bench summary {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse bench summary {path}: {source}")]
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
}

#[derive(Debug, Deserialize)]
pub struct BenchSummary {
    pub scene: String,
    #[serde(default)]
    pub git_sha: Option<String>,
    #[serde(default)]
    pub git_dirty: Option<bool>,
    #[serde(default)]
    pub build_profile: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub bevy_version: String,
    #[serde(default)]
    pub run_started_utc: String,
    #[serde(default)]
    pub duration_secs: f64,
    pub checkpoints: Vec<CheckpointSummary>,
}

#[derive(Debug, Deserialize)]
pub struct CheckpointSummary {
    pub name: String,
    pub median_frame_ms: f64,
    pub p99_frame_ms: f64,
    #[serde(default)]
    pub areas: HashMap<String, AreaSummary>,
    #[serde(default)]
    pub runs: Vec<RunRecord>,
}

#[derive(Debug, Deserialize)]
pub struct AreaSummary {
    pub median_ms: f64,
    pub p99_ms: f64,
    #[serde(default)]
    pub calls_per_frame: f64,
}

#[derive(Debug, Deserialize)]
pub struct RunRecord {
    #[serde(default)]
    pub screenshots: Vec<ScreenshotRecord>,
    #[serde(default)]
    pub screenshot: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ScreenshotRecord {
    pub name: String,
    #[serde(default)]
    pub frame: u32,
    pub path: String,
}

impl BenchSummary {
    pub fn checkpoint(&self, name: &str) -> Option<&CheckpointSummary> {
        self.checkpoints
            .iter()
            .find(|candidate| candidate.name == name)
    }
}

impl CheckpointSummary {
    pub fn screenshot_path(&self, name: &str) -> Option<&str> {
        for run in &self.runs {
            if let Some(path) = run.screenshot.as_deref()
                && name == "default"
            {
                return Some(path);
            }
            if let Some(record) = run
                .screenshots
                .iter()
                .find(|candidate| candidate.name == name)
            {
                let _ = record.frame;
                return Some(record.path.as_str());
            }
        }
        None
    }
}

pub fn read_summary(path: &Path) -> Result<BenchSummary, BenchSummaryError> {
    let text = fs::read_to_string(path).map_err(|source| BenchSummaryError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| BenchSummaryError::Parse {
        path: path.to_path_buf(),
        source,
    })
}
