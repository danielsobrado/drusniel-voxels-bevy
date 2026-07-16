use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SummaryError {
    #[error("failed to read QA summary {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse QA summary {path}: {source}")]
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct UnifiedSummary {
    #[serde(default)]
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
    #[serde(default)]
    pub checkpoints: Vec<UnifiedCheckpoint>,
    #[serde(default)]
    pub environment: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct UnifiedCheckpoint {
    pub name: String,
    #[serde(default)]
    pub median_frame_ms: Option<f64>,
    #[serde(default)]
    pub p95_frame_ms: Option<f64>,
    #[serde(default)]
    pub p99_frame_ms: Option<f64>,
    #[serde(default)]
    pub max_frame_ms: Option<f64>,
    #[serde(default)]
    pub sample_count: Option<u64>,
    #[serde(default)]
    pub warmup_count: Option<u64>,
    #[serde(default)]
    pub areas: BTreeMap<String, Value>,
    #[serde(default)]
    pub screenshots: Vec<ScreenshotRecord>,
    #[serde(default)]
    pub runs: Vec<RunRecord>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RunRecord {
    #[serde(default)]
    pub screenshots: Vec<ScreenshotRecord>,
    #[serde(default)]
    pub screenshot: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct ScreenshotRecord {
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub frame: u32,
    pub path: String,
}

impl UnifiedSummary {
    pub fn checkpoint(&self, name: &str) -> Option<&UnifiedCheckpoint> {
        self.checkpoints
            .iter()
            .find(|checkpoint| checkpoint.name == name)
    }
}

impl UnifiedCheckpoint {
    pub fn resolve_metric(&self, key: &str) -> Option<f64> {
        match key {
            "frame_ms_p50" => return finite(self.median_frame_ms),
            "frame_ms_p95" => return finite(self.p95_frame_ms),
            "frame_ms_p99" => return finite(self.p99_frame_ms),
            "frame_ms_max" => return finite(self.max_frame_ms),
            "sample_count" => return self.sample_count.map(|value| value as f64),
            "warmup_count" => return self.warmup_count.map(|value| value as f64),
            _ => {}
        }

        let rest = key.strip_prefix("areas.")?;
        let (area, field) = rest.split_once('.')?;
        let value = self.areas.get(area)?;
        resolve_field(value, field)
    }

    pub fn screenshot_path(&self, id_or_name: &str) -> Option<&str> {
        if let Some(record) = self.screenshots.iter().find(|record| {
            record.name == id_or_name || record.id.as_deref() == Some(id_or_name)
        }) {
            return Some(record.path.as_str());
        }
        for run in &self.runs {
            if id_or_name == "default"
                && let Some(path) = run.screenshot.as_deref()
            {
                return Some(path);
            }
            if let Some(record) = run.screenshots.iter().find(|record| {
                record.name == id_or_name || record.id.as_deref() == Some(id_or_name)
            }) {
                return Some(record.path.as_str());
            }
        }
        None
    }
}

pub fn read_summary(path: &Path) -> Result<UnifiedSummary, SummaryError> {
    let text = fs::read_to_string(path).map_err(|source| SummaryError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| SummaryError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn resolve_field(value: &Value, field: &str) -> Option<f64> {
    if let Some(object) = value.as_object()
        && let Some(exact) = object.get(field)
    {
        return exact.as_f64().filter(|value| value.is_finite());
    }
    let mut current = value;
    for segment in field.split('.') {
        current = current.as_object()?.get(segment)?;
    }
    current.as_f64().filter(|value| value.is_finite())
}

fn finite(value: Option<f64>) -> Option<f64> {
    value.filter(|value| value.is_finite())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_exact_dotted_area_fields() {
        let checkpoint: UnifiedCheckpoint = serde_json::from_value(serde_json::json!({
            "name": "main",
            "p95_frame_ms": 12.0,
            "areas": {
                "phases_max": { "selectionSub.views": 7.0 },
                "nested": { "gpu": { "pass": 2.0 } }
            }
        }))
        .unwrap();
        assert_eq!(checkpoint.resolve_metric("frame_ms_p95"), Some(12.0));
        assert_eq!(
            checkpoint.resolve_metric("areas.phases_max.selectionSub.views"),
            Some(7.0)
        );
        assert_eq!(checkpoint.resolve_metric("areas.nested.gpu.pass"), Some(2.0));
    }
}
