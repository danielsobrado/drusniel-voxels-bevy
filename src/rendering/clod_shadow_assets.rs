//! Asset/snapshot loading for the CLOD shadow runtime bridge.
//!
//! This module is intentionally conservative: it loads the JSON snapshot emitted
//! by `tools/clod-poc/src/bevy_shadow_runtime.ts`, validates it through the PR
//! 0006 runtime contract, then publishes it as `ActiveClodShadowRuntimeSnapshot`
//! for the PR 0007 spawn wiring.
//!
//! It does not depend on Bevy's custom `AssetLoader` API.  That keeps the first
//! integration easy to use from benches, debug builds, and editor/dev flows where
//! the generated snapshot path is known on disk.

use bevy::prelude::*;
use serde_json::Error as SerdeJsonError;
use std::{
    fs, io,
    path::{Path, PathBuf},
    time::SystemTime,
};

use super::{
    clod_shadow_config::ClodShadowRuntimeSettings,
    clod_shadow_runtime::{
        ClodShadowRuntimeError, ClodShadowRuntimeSnapshot, validate_clod_shadow_runtime_snapshot,
    },
    clod_shadow_spawn::ActiveClodShadowRuntimeSnapshot,
};

/// Default asset-relative location for exported CLOD shadow snapshots.
pub const DEFAULT_CLOD_SHADOW_SNAPSHOT_PATH: &str = "assets/generated/clod/shadow_runtime.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClodShadowSnapshotLoadError {
    Io { path: PathBuf, message: String },
    Json { path: PathBuf, message: String },
    InvalidSnapshot(ClodShadowRuntimeError),
    InvalidActiveSnapshot { message: String },
}

impl std::fmt::Display for ClodShadowSnapshotLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClodShadowSnapshotLoadError::Io { path, message } => {
                write!(
                    f,
                    "failed to read CLOD shadow snapshot {}: {message}",
                    path.display()
                )
            }
            ClodShadowSnapshotLoadError::Json { path, message } => {
                write!(
                    f,
                    "failed to parse CLOD shadow snapshot {}: {message}",
                    path.display()
                )
            }
            ClodShadowSnapshotLoadError::InvalidSnapshot(err) => {
                write!(f, "invalid CLOD shadow snapshot: {err:?}")
            }
            ClodShadowSnapshotLoadError::InvalidActiveSnapshot { message } => {
                write!(f, "invalid active CLOD shadow snapshot: {message}")
            }
        }
    }
}

impl std::error::Error for ClodShadowSnapshotLoadError {}

impl ClodShadowSnapshotLoadError {
    fn io(path: &Path, err: io::Error) -> Self {
        Self::Io {
            path: path.to_path_buf(),
            message: err.to_string(),
        }
    }

    fn json(path: &Path, err: SerdeJsonError) -> Self {
        Self::Json {
            path: path.to_path_buf(),
            message: err.to_string(),
        }
    }
}

/// Runtime configuration for loading the generated JSON snapshot.
#[derive(Resource, Debug, Clone)]
pub struct ClodShadowSnapshotPath {
    pub path: PathBuf,
    pub generation: u64,
    pub reload_requested: bool,
    pub auto_reload_when_modified: bool,
    pub last_loaded_modified: Option<SystemTime>,
}

impl Default for ClodShadowSnapshotPath {
    fn default() -> Self {
        Self {
            path: PathBuf::from(DEFAULT_CLOD_SHADOW_SNAPSHOT_PATH),
            generation: 1,
            reload_requested: true,
            auto_reload_when_modified: false,
            last_loaded_modified: None,
        }
    }
}

impl ClodShadowSnapshotPath {
    pub fn request_reload(&mut self) {
        self.reload_requested = true;
        self.generation = self.generation.saturating_add(1).max(1);
    }
}

/// Debug counters for snapshot loading.
#[derive(Resource, Debug, Clone, PartialEq, Default)]
pub struct ClodShadowSnapshotLoadStats {
    pub attempted_loads: u32,
    pub successful_loads: u32,
    pub failed_loads: u32,
    pub active_generation: u64,
    pub loaded_pages: u32,
    pub loaded_proxy_meshes: u32,
    pub loaded_visual_triangles: u32,
    pub loaded_runtime_shadow_triangles: u32,
    pub loaded_saved_triangles: u32,
    pub last_path: Option<PathBuf>,
    pub last_error: Option<String>,
}

pub struct ClodShadowSnapshotLoaderPlugin;

impl Plugin for ClodShadowSnapshotLoaderPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ClodShadowSnapshotPath>()
            .init_resource::<ClodShadowSnapshotLoadStats>()
            .add_systems(Update, load_requested_clod_shadow_snapshot);
    }
}

/// Load and validate a CLOD shadow runtime snapshot from disk.
pub fn read_clod_shadow_runtime_snapshot_from_path(
    path: impl AsRef<Path>,
) -> Result<ClodShadowRuntimeSnapshot, ClodShadowSnapshotLoadError> {
    let path = path.as_ref();
    let text =
        fs::read_to_string(path).map_err(|err| ClodShadowSnapshotLoadError::io(path, err))?;
    let snapshot: ClodShadowRuntimeSnapshot =
        serde_json::from_str(&text).map_err(|err| ClodShadowSnapshotLoadError::json(path, err))?;
    validate_clod_shadow_runtime_snapshot(&snapshot)
        .map_err(ClodShadowSnapshotLoadError::InvalidSnapshot)?;
    Ok(snapshot)
}

/// Convert a loaded snapshot into the active Bevy resource consumed by PR 0007.
pub fn active_clod_shadow_snapshot_from_path(
    generation: u64,
    path: impl AsRef<Path>,
) -> Result<ActiveClodShadowRuntimeSnapshot, ClodShadowSnapshotLoadError> {
    let snapshot = read_clod_shadow_runtime_snapshot_from_path(path)?;
    ActiveClodShadowRuntimeSnapshot::new(generation, snapshot)
        .map_err(|message| ClodShadowSnapshotLoadError::InvalidActiveSnapshot { message })
}

pub fn load_requested_clod_shadow_snapshot(
    mut commands: Commands,
    settings: Option<Res<ClodShadowRuntimeSettings>>,
    mut source: ResMut<ClodShadowSnapshotPath>,
    mut stats: ResMut<ClodShadowSnapshotLoadStats>,
) {
    if let Some(settings) = settings.as_deref() {
        if source.path != settings.snapshot_path {
            source.path = settings.snapshot_path.clone();
            source.request_reload();
        }
        source.auto_reload_when_modified = settings.auto_reload_snapshot;

        if !settings.should_load_snapshot() {
            source.reload_requested = false;
            commands.remove_resource::<ActiveClodShadowRuntimeSnapshot>();
            stats.active_generation = 0;
            stats.loaded_pages = 0;
            stats.loaded_proxy_meshes = 0;
            stats.loaded_visual_triangles = 0;
            stats.loaded_runtime_shadow_triangles = 0;
            stats.loaded_saved_triangles = 0;
            stats.last_error = None;
            return;
        }
    }
    let modified = fs::metadata(&source.path)
        .and_then(|metadata| metadata.modified())
        .ok();
    let changed_on_disk = source.auto_reload_when_modified
        && modified.is_some()
        && modified != source.last_loaded_modified;

    if !source.reload_requested && !changed_on_disk {
        return;
    }

    source.reload_requested = false;
    source.last_loaded_modified = modified;
    stats.attempted_loads = stats.attempted_loads.saturating_add(1);
    stats.last_path = Some(source.path.clone());

    match read_clod_shadow_runtime_snapshot_from_path(&source.path) {
        Ok(snapshot) => {
            let generation = source.generation.max(1);
            stats.successful_loads = stats.successful_loads.saturating_add(1);
            stats.active_generation = generation;
            stats.loaded_pages = snapshot.plans.len() as u32;
            stats.loaded_proxy_meshes = snapshot.proxy_meshes.len() as u32;
            stats.loaded_visual_triangles = snapshot.totals.visual_triangles;
            stats.loaded_runtime_shadow_triangles = snapshot.totals.runtime_shadow_triangles;
            stats.loaded_saved_triangles = snapshot.totals.saved_triangles;
            stats.last_error = None;

            match ActiveClodShadowRuntimeSnapshot::new(generation, snapshot) {
                Ok(active) => commands.insert_resource(active),
                Err(err) => {
                    stats.failed_loads = stats.failed_loads.saturating_add(1);
                    stats.last_error = Some(err);
                }
            }
        }
        Err(err) => {
            stats.failed_loads = stats.failed_loads.saturating_add(1);
            stats.last_error = Some(err.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::clod_shadow_runtime::{
        ClodShadowBounds, ClodShadowMeshBounds, ClodShadowRuntimeAction,
        ClodShadowRuntimeMeshPayload, ClodShadowRuntimePlanEntry, ClodShadowRuntimeSnapshot,
        ClodShadowRuntimeTotals,
    };

    fn valid_snapshot() -> ClodShadowRuntimeSnapshot {
        ClodShadowRuntimeSnapshot {
            version: 1,
            generated_by: "clod-poc-bevy-shadow-runtime".to_owned(),
            plans: vec![ClodShadowRuntimePlanEntry {
                node_id: "L2:0,0".to_owned(),
                level: 2,
                action: ClodShadowRuntimeAction::SpawnProxyShadowCaster,
                visual_mesh_id: "visual:L2:0,0".to_owned(),
                shadow_mesh_id: Some("shadow:L2:0,0".to_owned()),
                reason: "proxy-distance".to_owned(),
                visual_triangles: 100,
                shadow_triangles: 8,
                distance: Some(96.0),
                bounds: ClodShadowBounds {
                    center: [0.0, 0.0, 0.0],
                    radius: 1.0,
                },
            }],
            proxy_meshes: vec![ClodShadowRuntimeMeshPayload {
                shadow_mesh_id: "shadow:L2:0,0".to_owned(),
                node_id: "L2:0,0".to_owned(),
                positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
                indices: vec![0, 1, 2],
                bounds: ClodShadowMeshBounds {
                    min: [0.0, 0.0, 0.0],
                    max: [1.0, 1.0, 1.0],
                },
                source_triangle_count: 100,
                triangle_count: 1,
            }],
            totals: ClodShadowRuntimeTotals {
                total_pages: 1,
                visual_caster_pages: 0,
                proxy_caster_pages: 1,
                no_cast_pages: 0,
                visual_triangles: 100,
                runtime_shadow_triangles: 8,
                saved_triangles: 92,
                savings_ratio: 0.92,
                missing_proxy_meshes: 0,
            },
        }
    }

    #[test]
    fn default_path_points_to_generated_asset() {
        let source = ClodShadowSnapshotPath::default();
        assert_eq!(
            source.path,
            PathBuf::from(DEFAULT_CLOD_SHADOW_SNAPSHOT_PATH)
        );
        assert!(source.reload_requested);
    }

    #[test]
    fn request_reload_increments_generation() {
        let mut source = ClodShadowSnapshotPath::default();
        let generation = source.generation;
        source.request_reload();
        assert!(source.reload_requested);
        assert!(source.generation > generation);
    }

    #[test]
    fn read_snapshot_rejects_missing_file() {
        let err = read_clod_shadow_runtime_snapshot_from_path("/definitely/not/here.json")
            .expect_err("missing file must fail");
        assert!(matches!(err, ClodShadowSnapshotLoadError::Io { .. }));
    }

    #[test]
    fn read_snapshot_accepts_valid_json() {
        let path = std::env::temp_dir().join(format!(
            "drusniel-clod-shadow-valid-{}.json",
            std::process::id()
        ));
        fs::write(&path, serde_json::to_string(&valid_snapshot()).unwrap()).unwrap();
        let loaded = read_clod_shadow_runtime_snapshot_from_path(&path).unwrap();
        fs::remove_file(&path).ok();

        assert_eq!(loaded.version, 1);
        assert_eq!(loaded.plans.len(), 1);
        assert_eq!(loaded.proxy_meshes.len(), 1);
    }

    #[test]
    fn runtime_settings_can_disable_snapshot_loading() {
        let settings = ClodShadowRuntimeSettings {
            mode: crate::rendering::clod_shadow_config::ClodShadowRuntimeMode::Disabled,
            ..Default::default()
        };
        assert!(!settings.should_load_snapshot());
    }
}
