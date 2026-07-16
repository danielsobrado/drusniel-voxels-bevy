use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use bevy::prelude::Resource;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use super::state::{FreezeState, ReadinessSnapshot};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct QaPose {
    pub position: [f64; 3],
    pub yaw_deg: f64,
    pub pitch_deg: f64,
    pub fov_y_deg: f64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct QaWorldState {
    pub time_of_day_hours: f64,
    pub sun_elevation_deg: f64,
    pub sun_azimuth_deg: f64,
    pub wind_time_s: f64,
    pub cloud_time_s: f64,
    pub particle_time_s: f64,
    pub precipitation: String,
    pub random_epoch: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct QaStats {
    pub frame: u64,
    pub frame_ms: Option<f64>,
    pub frame_ms_p95: Option<f64>,
    pub counters: BTreeMap<String, f64>,
    pub gpu_passes: BTreeMap<String, f64>,
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct QaScreenshot {
    pub id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct QaCaptureResult {
    pub schema_version: u32,
    pub scene_id: String,
    pub checkpoint: String,
    pub pose: QaPose,
    pub world_state: QaWorldState,
    pub readiness: ReadinessSnapshot,
    pub freeze: FreezeState,
    pub stats: QaStats,
    pub screenshots: Vec<QaScreenshot>,
}

#[derive(Clone, Debug, Default, Resource)]
pub struct QaCaptureState {
    scene_id: String,
    checkpoint: String,
    pose: QaPose,
    world_state: QaWorldState,
    readiness: ReadinessSnapshot,
    freeze: FreezeState,
    stats: QaStats,
    screenshots: Vec<QaScreenshot>,
}

#[derive(Debug, Error)]
pub enum QaCaptureError {
    #[error("capture cannot freeze before readiness: {0}")]
    NotReady(String),
    #[error("failed to create capture directory {path}: {source}")]
    CreateDir {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to serialize capture result: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write capture result {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

impl QaCaptureState {
    pub fn begin_scene(&mut self, scene_id: impl Into<String>) {
        *self = Self {
            scene_id: scene_id.into(),
            ..Default::default()
        };
    }

    pub fn set_pose(&mut self, pose: QaPose) {
        self.pose = pose;
    }

    pub fn set_world_state(&mut self, world_state: QaWorldState) {
        self.world_state = world_state;
    }

    pub fn set_readiness(&mut self, readiness: ReadinessSnapshot) {
        self.readiness = readiness;
    }

    pub fn set_stats(&mut self, stats: QaStats) {
        self.stats = stats;
    }

    pub fn run_checkpoint(&mut self, checkpoint: impl Into<String>) {
        self.checkpoint = checkpoint.into();
    }

    pub fn record_screenshot(&mut self, id: impl Into<String>, path: impl Into<String>) {
        self.screenshots.push(QaScreenshot {
            id: id.into(),
            path: path.into(),
        });
    }

    pub fn freeze(&mut self) -> Result<(), QaCaptureError> {
        self.freeze
            .freeze_after_readiness(&self.readiness)
            .map_err(|blockers| QaCaptureError::NotReady(blockers.join(", ")))
    }

    pub fn unfreeze(&mut self) {
        self.freeze.unfreeze();
    }

    pub fn snapshot(&self) -> QaCaptureResult {
        QaCaptureResult {
            schema_version: 1,
            scene_id: self.scene_id.clone(),
            checkpoint: self.checkpoint.clone(),
            pose: self.pose.clone(),
            world_state: self.world_state.clone(),
            readiness: self.readiness.clone(),
            freeze: self.freeze.clone(),
            stats: self.stats.clone(),
            screenshots: self.screenshots.clone(),
        }
    }

    pub fn write_result(&self, path: &Path) -> Result<(), QaCaptureError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|source| QaCaptureError::CreateDir {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        let json = serde_json::to_string_pretty(&self.snapshot())
            .map_err(QaCaptureError::Serialize)?;
        fs::write(path, format!("{json}\n")).map_err(|source| QaCaptureError::Write {
            path: path.to_path_buf(),
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_refuses_early_freeze() {
        let mut capture = QaCaptureState::default();
        capture.begin_scene("scene");
        assert!(capture.freeze().is_err());
        capture.set_readiness(ReadinessSnapshot {
            runtime_ready: true,
            ..Default::default()
        });
        assert!(capture.freeze().is_ok());
        assert!(capture.snapshot().freeze.is_fully_frozen());
    }
}
