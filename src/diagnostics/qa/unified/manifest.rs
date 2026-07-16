use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use thiserror::Error;

use super::schema::{PerformanceManifestFile, Scene, Target, VisualManifestFile};

#[derive(Clone, Debug)]
pub struct Registry {
    pub baseline_version: u32,
    pub output_root: PathBuf,
    pub scenes: Vec<Scene>,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("failed to read manifest {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("failed to parse manifest {path}: {source}")]
    Parse { path: PathBuf, source: serde_yaml::Error },
    #[error("manifest {path} has unsupported schema version {version}")]
    SchemaVersion { path: PathBuf, version: u32 },
    #[error("duplicate unified QA scene id '{0}'")]
    DuplicateScene(String),
    #[error("scene '{scene}' has invalid {field} path '{path}'")]
    InvalidPath { scene: String, field: &'static str, path: PathBuf },
    #[error("scene '{scene}' has duplicate {kind} id '{id}'")]
    DuplicateNestedId { scene: String, kind: &'static str, id: String },
    #[error("scene '{scene}' informational metric '{id}' must set required: false")]
    InformationalRequired { scene: String, id: String },
    #[error("scene '{scene}' counter gate '{id}' has an invalid operator payload")]
    CounterPayload { scene: String, id: String },
}

pub fn load_registry(visual_path: &Path, performance_path: &Path) -> Result<Registry, ManifestError> {
    let visual: VisualManifestFile = read_yaml(visual_path)?;
    let performance: PerformanceManifestFile = read_yaml(performance_path)?;
    if visual.visual_regression.schema_version != 1 {
        return Err(ManifestError::SchemaVersion {
            path: visual_path.to_path_buf(),
            version: visual.visual_regression.schema_version,
        });
    }
    if performance.performance_regression.schema_version != 1 {
        return Err(ManifestError::SchemaVersion {
            path: performance_path.to_path_buf(),
            version: performance.performance_regression.schema_version,
        });
    }
    let mut scenes = visual.visual_regression.scenes;
    scenes.extend(performance.performance_regression.scenes);
    validate_scenes(&scenes)?;
    Ok(Registry {
        baseline_version: visual.visual_regression.baseline_version,
        output_root: visual.visual_regression.output_root,
        scenes,
    })
}

impl Registry {
    pub fn select<'a>(
        &'a self,
        tags: &[String],
        ids: &[String],
        target: Option<Target>,
    ) -> Vec<&'a Scene> {
        self.scenes
            .iter()
            .filter(|scene| scene.enabled)
            .filter(|scene| target.is_none_or(|candidate| scene.target == candidate))
            .filter(|scene| ids.is_empty() || ids.iter().any(|id| id == &scene.id))
            .filter(|scene| {
                tags.iter()
                    .all(|tag| scene.tags.iter().any(|candidate| candidate == tag))
            })
            .collect()
    }
}

fn read_yaml<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, ManifestError> {
    let text = fs::read_to_string(path).map_err(|source| ManifestError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_yaml::from_str(&text).map_err(|source| ManifestError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn validate_scenes(scenes: &[Scene]) -> Result<(), ManifestError> {
    let mut scene_ids = HashSet::new();
    for scene in scenes {
        if !scene_ids.insert(scene.id.as_str()) {
            return Err(ManifestError::DuplicateScene(scene.id.clone()));
        }
        validate_path(scene, "image", &scene.baseline.image)?;
        validate_path(scene, "stats", &scene.baseline.stats)?;
        validate_path(scene, "metrics", &scene.baseline.metrics)?;
        if let Some(mask) = &scene.baseline.mask {
            validate_path(scene, "mask", mask)?;
        }
        unique(
            scene,
            "region probe",
            scene.region_probes.iter().map(|value| value.id.as_str()),
        )?;
        unique(
            scene,
            "timing gate",
            scene.timing_gates.iter().map(|value| value.id.as_str()),
        )?;
        unique(
            scene,
            "counter gate",
            scene.counter_gates.iter().map(|value| value.id.as_str()),
        )?;
        for metric in &scene.informational_metrics {
            if metric.required {
                return Err(ManifestError::InformationalRequired {
                    scene: scene.id.clone(),
                    id: metric.id.clone(),
                });
            }
        }
        for gate in &scene.counter_gates {
            let valid = match gate.operator {
                super::schema::CounterOperator::Between => {
                    gate.range.is_some() && gate.value.is_none()
                }
                _ => gate.value.is_some() && gate.range.is_none(),
            };
            if !valid
                || matches!(gate.operator, super::schema::CounterOperator::Min)
                    && gate.value == Some(0.0)
            {
                return Err(ManifestError::CounterPayload {
                    scene: scene.id.clone(),
                    id: gate.id.clone(),
                });
            }
        }
    }
    Ok(())
}

fn validate_path(scene: &Scene, field: &'static str, path: &Path) -> Result<(), ManifestError> {
    let expected = if field == "mask" {
        Path::new("validation/masks")
    } else {
        match scene.target {
            Target::ClodPoc => Path::new("validation/baselines/clod-poc"),
            Target::Bevy => Path::new("validation/baselines/bevy"),
        }
    };
    let invalid_component = path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    if invalid_component || !path.starts_with(expected) {
        return Err(ManifestError::InvalidPath {
            scene: scene.id.clone(),
            field,
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

fn unique<'a>(
    scene: &Scene,
    kind: &'static str,
    ids: impl Iterator<Item = &'a str>,
) -> Result<(), ManifestError> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(ManifestError::DuplicateNestedId {
                scene: scene.id.clone(),
                kind,
                id: id.to_string(),
            });
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_paths() {
        assert!(Path::new("validation/baselines/clod-poc/../escape")
            .components()
            .any(|component| matches!(component, Component::ParentDir)));
    }
}
