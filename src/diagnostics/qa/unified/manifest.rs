use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use thiserror::Error;

use super::schema::{
    CounterOperator, LegacyIdKind, LegacyMapFile, PerformanceManifestFile, Scene, Target,
    VisualManifestFile,
};
use super::sha256::{Sha256Error, digest_bytes, digest_file};

const SCHEMA_VERSION: u32 = 1;
const REGION_GATE_KEYS: [&str; 6] = [
    "luminance_mean",
    "luminance_stddev",
    "chroma_mean",
    "black_pixel_fraction",
    "clipped_pixel_fraction",
    "edge_magnitude",
];

#[derive(Clone, Debug)]
pub struct Registry {
    pub baseline_version: u32,
    pub output_root: PathBuf,
    pub manifest_hash: String,
    pub scenes: Vec<Scene>,
}

#[derive(Debug, Error)]
pub enum ManifestError {
    #[error("failed to read manifest {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse manifest {path}: {source}")]
    Parse {
        path: PathBuf,
        source: serde_yaml::Error,
    },
    #[error("manifest {path} has unsupported schema version {version}")]
    SchemaVersion { path: PathBuf, version: u32 },
    #[error("duplicate unified QA scene id '{0}'")]
    DuplicateScene(String),
    #[error("scene '{scene}' has invalid {field} path '{path}'")]
    InvalidPath {
        scene: String,
        field: &'static str,
        path: PathBuf,
    },
    #[error("scene '{scene}' has invalid identifier for {field}: '{value}'")]
    InvalidIdentifier {
        scene: String,
        field: &'static str,
        value: String,
    },
    #[error("scene '{scene}' has duplicate {kind} id '{id}'")]
    DuplicateNestedId {
        scene: String,
        kind: &'static str,
        id: String,
    },
    #[error("scene '{scene}' informational metric '{id}' must set required: false")]
    InformationalRequired { scene: String, id: String },
    #[error("scene '{scene}' counter gate '{id}' has an invalid operator payload")]
    CounterPayload { scene: String, id: String },
    #[error("scene '{scene}' has invalid {field}: {message}")]
    InvalidValue {
        scene: String,
        field: String,
        message: String,
    },
    #[error("baseline SHA-256 for scene '{scene}' is invalid: {value}")]
    InvalidSha256 { scene: String, value: String },
    #[error("baseline SHA-256 file for scene '{scene}' is missing: {path}")]
    MissingHashedFile { scene: String, path: PathBuf },
    #[error("baseline SHA-256 mismatch for scene '{scene}': expected {expected}, got {actual}")]
    Sha256Mismatch {
        scene: String,
        expected: String,
        actual: String,
    },
    #[error(transparent)]
    Sha256(#[from] Sha256Error),
    #[error("duplicate legacy QA mapping '{kind}:{legacy}'")]
    DuplicateLegacyMapping {
        kind: LegacyIdKind,
        legacy: String,
    },
    #[error("legacy QA mapping targets missing ID '{kind}:{canonical}'")]
    MissingLegacyTarget {
        kind: LegacyIdKind,
        canonical: String,
    },
}

pub fn load_registry(
    visual_path: &Path,
    performance_path: &Path,
) -> Result<Registry, ManifestError> {
    load_registry_with_legacy(visual_path, performance_path, None)
}

pub fn load_registry_with_legacy(
    visual_path: &Path,
    performance_path: &Path,
    legacy_map_path: Option<&Path>,
) -> Result<Registry, ManifestError> {
    let visual_text = read_text(visual_path)?;
    let performance_text = read_text(performance_path)?;
    let visual: VisualManifestFile = parse_yaml(visual_path, &visual_text)?;
    let performance: PerformanceManifestFile = parse_yaml(performance_path, &performance_text)?;

    validate_schema(
        visual_path,
        visual.visual_regression.schema_version,
    )?;
    validate_schema(
        performance_path,
        performance.performance_regression.schema_version,
    )?;

    let mut scenes = visual.visual_regression.scenes;
    scenes.extend(performance.performance_regression.scenes);
    let repository_root = visual_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap_or_else(|| Path::new("."));
    validate_scenes(&scenes, repository_root)?;

    let mut hash_input = Vec::new();
    hash_input.extend_from_slice(visual_text.as_bytes());
    hash_input.push(0);
    hash_input.extend_from_slice(performance_text.as_bytes());

    if let Some(path) = legacy_map_path {
        let text = read_text(path)?;
        let legacy: LegacyMapFile = parse_yaml(path, &text)?;
        validate_legacy_map(&legacy, &scenes)?;
        hash_input.push(0);
        hash_input.extend_from_slice(text.as_bytes());
    }

    Ok(Registry {
        baseline_version: visual.visual_regression.baseline_version,
        output_root: visual.visual_regression.output_root,
        manifest_hash: digest_bytes(&hash_input),
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

fn read_text(path: &Path) -> Result<String, ManifestError> {
    fs::read_to_string(path).map_err(|source| ManifestError::Read {
        path: path.to_path_buf(),
        source,
    })
}

fn parse_yaml<T: serde::de::DeserializeOwned>(
    path: &Path,
    text: &str,
) -> Result<T, ManifestError> {
    serde_yaml::from_str(text).map_err(|source| ManifestError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn validate_schema(path: &Path, version: u32) -> Result<(), ManifestError> {
    if version != SCHEMA_VERSION {
        return Err(ManifestError::SchemaVersion {
            path: path.to_path_buf(),
            version,
        });
    }
    Ok(())
}

fn validate_scenes(scenes: &[Scene], repository_root: &Path) -> Result<(), ManifestError> {
    let mut scene_ids = HashSet::new();
    for scene in scenes {
        validate_identifier(scene, "scene id", &scene.id)?;
        if !scene_ids.insert(scene.id.as_str()) {
            return Err(ManifestError::DuplicateScene(scene.id.clone()));
        }
        validate_scene(scene, repository_root)?;
    }
    Ok(())
}

fn validate_scene(scene: &Scene, repository_root: &Path) -> Result<(), ManifestError> {
    validate_path(scene, "image", &scene.baseline.image)?;
    validate_path(scene, "stats", &scene.baseline.stats)?;
    validate_path(scene, "metrics", &scene.baseline.metrics)?;
    if let Some(mask) = &scene.baseline.mask {
        validate_path(scene, "mask", mask)?;
    }
    verify_optional_hash(scene, repository_root)?;

    if scene.launch.viewport.contains(&0) {
        return invalid_value(scene, "launch.viewport", "dimensions must be positive");
    }
    require_positive(scene, "launch.device_pixel_ratio", scene.launch.device_pixel_ratio)?;
    require_positive(scene, "launch.camera.fov_y_deg", scene.launch.camera.fov_y_deg)?;
    require_finite(scene, "launch.camera.yaw_deg", scene.launch.camera.yaw_deg)?;
    require_finite(scene, "launch.camera.pitch_deg", scene.launch.camera.pitch_deg)?;
    for (index, value) in scene.launch.camera.position.iter().copied().enumerate() {
        require_finite(scene, &format!("launch.camera.position[{index}]"), value)?;
    }
    require_finite(
        scene,
        "launch.lighting.time_of_day_hours",
        scene.launch.lighting.time_of_day_hours,
    )?;
    require_finite(
        scene,
        "launch.lighting.sun_elevation_deg",
        scene.launch.lighting.sun_elevation_deg,
    )?;
    require_finite(
        scene,
        "launch.lighting.sun_azimuth_deg",
        scene.launch.lighting.sun_azimuth_deg,
    )?;
    require_non_negative(scene, "launch.weather.wind_time_s", scene.launch.weather.wind_time_s)?;
    require_non_negative(scene, "launch.weather.cloud_time_s", scene.launch.weather.cloud_time_s)?;
    require_non_negative(
        scene,
        "launch.weather.particle_time_s",
        scene.launch.weather.particle_time_s,
    )?;
    if scene.settle.ready_timeout_ms == 0 {
        return invalid_value(scene, "settle.ready_timeout_ms", "must be positive");
    }

    validate_image_gates(scene)?;
    validate_region_probes(scene)?;
    validate_timing_gates(scene)?;
    validate_counter_gates(scene)?;
    validate_informational_metrics(scene)?;
    Ok(())
}

fn validate_image_gates(scene: &Scene) -> Result<(), ManifestError> {
    unit_interval(
        scene,
        "image_gates.changed_pixel_threshold",
        scene.image_gates.changed_pixel_threshold,
    )?;
    unit_interval(
        scene,
        "image_gates.changed_pixel_fraction_max",
        scene.image_gates.changed_pixel_fraction_max,
    )?;
    for (field, value) in [
        (
            "image_gates.mean_absolute_error_max",
            scene.image_gates.mean_absolute_error_max,
        ),
        (
            "image_gates.p95_absolute_error_max",
            scene.image_gates.p95_absolute_error_max,
        ),
        (
            "image_gates.edge_error_mean_max",
            scene.image_gates.edge_error_mean_max,
        ),
        (
            "image_gates.luminance_mean_delta_max",
            scene.image_gates.luminance_mean_delta_max,
        ),
        (
            "image_gates.luminance_stddev_delta_max",
            scene.image_gates.luminance_stddev_delta_max,
        ),
        (
            "image_gates.chroma_mean_delta_max",
            scene.image_gates.chroma_mean_delta_max,
        ),
    ] {
        require_non_negative(scene, field, value)?;
    }
    Ok(())
}

fn validate_region_probes(scene: &Scene) -> Result<(), ManifestError> {
    unique(
        scene,
        "region probe",
        scene.region_probes.iter().map(|value| value.id.as_str()),
    )?;
    for probe in &scene.region_probes {
        validate_identifier(scene, "region probe id", &probe.id)?;
        let [x, y, width, height] = probe.rect_normalized;
        if ![x, y, width, height].iter().all(|value| value.is_finite())
            || x < 0.0
            || y < 0.0
            || width <= 0.0
            || height <= 0.0
            || x + width > 1.0
            || y + height > 1.0
        {
            return invalid_value(
                scene,
                &format!("region_probes.{}.rect_normalized", probe.id),
                "must be a positive normalized rectangle inside the image",
            );
        }
        if probe.gates.is_empty() {
            return invalid_value(
                scene,
                &format!("region_probes.{}.gates", probe.id),
                "must define at least one gate",
            );
        }
        for (key, range) in &probe.gates {
            if !REGION_GATE_KEYS.contains(&key.as_str()) {
                return invalid_value(
                    scene,
                    &format!("region_probes.{}.gates.{key}", probe.id),
                    "unsupported metric",
                );
            }
            if range.min.is_none() && range.max.is_none() {
                return invalid_value(
                    scene,
                    &format!("region_probes.{}.gates.{key}", probe.id),
                    "must define min or max",
                );
            }
            if let Some(min) = range.min {
                require_finite(scene, &format!("region_probes.{}.gates.{key}.min", probe.id), min)?;
            }
            if let Some(max) = range.max {
                require_finite(scene, &format!("region_probes.{}.gates.{key}.max", probe.id), max)?;
            }
            if let (Some(min), Some(max)) = (range.min, range.max)
                && min > max
            {
                return invalid_value(
                    scene,
                    &format!("region_probes.{}.gates.{key}", probe.id),
                    "min exceeds max",
                );
            }
        }
    }
    Ok(())
}

fn validate_timing_gates(scene: &Scene) -> Result<(), ManifestError> {
    unique(
        scene,
        "timing gate",
        scene.timing_gates.iter().map(|value| value.id.as_str()),
    )?;
    for gate in &scene.timing_gates {
        validate_identifier(scene, "timing gate id", &gate.id)?;
        if gate.metric.trim().is_empty() {
            return invalid_value(
                scene,
                &format!("timing_gates.{}.metric", gate.id),
                "must not be empty",
            );
        }
        require_positive(scene, &format!("timing_gates.{}.max", gate.id), gate.max)?;
    }
    Ok(())
}

fn validate_counter_gates(scene: &Scene) -> Result<(), ManifestError> {
    unique(
        scene,
        "counter gate",
        scene.counter_gates.iter().map(|value| value.id.as_str()),
    )?;
    for gate in &scene.counter_gates {
        validate_identifier(scene, "counter gate id", &gate.id)?;
        if gate.key.trim().is_empty() {
            return invalid_value(
                scene,
                &format!("counter_gates.{}.key", gate.id),
                "must not be empty",
            );
        }
        let valid = match gate.operator {
            CounterOperator::Between => gate.range.is_some() && gate.value.is_none(),
            _ => gate.value.is_some() && gate.range.is_none(),
        };
        if !valid
            || matches!(gate.operator, CounterOperator::Min) && gate.value == Some(0.0)
        {
            return Err(ManifestError::CounterPayload {
                scene: scene.id.clone(),
                id: gate.id.clone(),
            });
        }
        if let Some(value) = gate.value {
            require_finite(scene, &format!("counter_gates.{}.value", gate.id), value)?;
        }
        if let Some([min, max]) = gate.range {
            require_finite(scene, &format!("counter_gates.{}.range[0]", gate.id), min)?;
            require_finite(scene, &format!("counter_gates.{}.range[1]", gate.id), max)?;
            if min > max {
                return invalid_value(
                    scene,
                    &format!("counter_gates.{}.range", gate.id),
                    "minimum exceeds maximum",
                );
            }
        }
    }
    Ok(())
}

fn validate_informational_metrics(scene: &Scene) -> Result<(), ManifestError> {
    unique(
        scene,
        "informational metric",
        scene
            .informational_metrics
            .iter()
            .map(|value| value.id.as_str()),
    )?;
    for metric in &scene.informational_metrics {
        validate_identifier(scene, "informational metric id", &metric.id)?;
        if metric.required {
            return Err(ManifestError::InformationalRequired {
                scene: scene.id.clone(),
                id: metric.id.clone(),
            });
        }
        if metric.key.trim().is_empty() {
            return invalid_value(
                scene,
                &format!("informational_metrics.{}.key", metric.id),
                "must not be empty",
            );
        }
    }
    Ok(())
}

fn validate_legacy_map(map: &LegacyMapFile, scenes: &[Scene]) -> Result<(), ManifestError> {
    let mut seen = HashSet::new();
    let mut canonical: HashMap<LegacyIdKind, HashSet<String>> = HashMap::new();
    for scene in scenes {
        canonical
            .entry(LegacyIdKind::Scene)
            .or_default()
            .insert(scene.id.clone());
        for probe in &scene.region_probes {
            canonical
                .entry(LegacyIdKind::Probe)
                .or_default()
                .insert(probe.id.clone());
        }
        for gate in &scene.timing_gates {
            canonical
                .entry(LegacyIdKind::Timing)
                .or_default()
                .insert(gate.id.clone());
        }
        for gate in &scene.counter_gates {
            canonical
                .entry(LegacyIdKind::Counter)
                .or_default()
                .insert(gate.id.clone());
        }
        for metric in &scene.informational_metrics {
            canonical
                .entry(LegacyIdKind::Informational)
                .or_default()
                .insert(metric.id.clone());
        }
    }

    for entry in &map.legacy_id_map {
        if !seen.insert((entry.kind, entry.legacy.as_str())) {
            return Err(ManifestError::DuplicateLegacyMapping {
                kind: entry.kind,
                legacy: entry.legacy.clone(),
            });
        }
        if !canonical
            .get(&entry.kind)
            .is_some_and(|values| values.contains(&entry.canonical))
        {
            return Err(ManifestError::MissingLegacyTarget {
                kind: entry.kind,
                canonical: entry.canonical.clone(),
            });
        }
    }
    Ok(())
}

fn validate_identifier(
    scene: &Scene,
    field: &'static str,
    value: &str,
) -> Result<(), ManifestError> {
    let valid = !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    if !valid {
        return Err(ManifestError::InvalidIdentifier {
            scene: scene.id.clone(),
            field,
            value: value.to_string(),
        });
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
    let contains_nul = path.to_string_lossy().contains('\0');
    if contains_nul || invalid_component || !path.starts_with(expected) {
        return Err(ManifestError::InvalidPath {
            scene: scene.id.clone(),
            field,
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

fn verify_optional_hash(scene: &Scene, repository_root: &Path) -> Result<(), ManifestError> {
    let Some(expected) = scene.baseline.sha256.as_deref() else {
        return Ok(());
    };
    if expected.len() != 64
        || !expected
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(ManifestError::InvalidSha256 {
            scene: scene.id.clone(),
            value: expected.to_string(),
        });
    }
    let path = repository_root.join(&scene.baseline.image);
    if !path.exists() {
        return Err(ManifestError::MissingHashedFile {
            scene: scene.id.clone(),
            path,
        });
    }
    let actual = digest_file(&path)?;
    if actual != expected {
        return Err(ManifestError::Sha256Mismatch {
            scene: scene.id.clone(),
            expected: expected.to_string(),
            actual,
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

fn require_finite(scene: &Scene, field: &str, value: f64) -> Result<(), ManifestError> {
    if !value.is_finite() {
        return invalid_value(scene, field, "must be finite");
    }
    Ok(())
}

fn require_non_negative(scene: &Scene, field: &str, value: f64) -> Result<(), ManifestError> {
    require_finite(scene, field, value)?;
    if value < 0.0 {
        return invalid_value(scene, field, "must be non-negative");
    }
    Ok(())
}

fn require_positive(scene: &Scene, field: &str, value: f64) -> Result<(), ManifestError> {
    require_finite(scene, field, value)?;
    if value <= 0.0 {
        return invalid_value(scene, field, "must be positive");
    }
    Ok(())
}

fn unit_interval(scene: &Scene, field: &str, value: f64) -> Result<(), ManifestError> {
    require_finite(scene, field, value)?;
    if !(0.0..=1.0).contains(&value) {
        return invalid_value(scene, field, "must be between 0 and 1");
    }
    Ok(())
}

fn invalid_value<T>(
    scene: &Scene,
    field: impl Into<String>,
    message: impl Into<String>,
) -> Result<T, ManifestError> {
    Err(ManifestError::InvalidValue {
        scene: scene.id.clone(),
        field: field.into(),
        message: message.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_paths() {
        assert!(Path::new("validation/baselines/bevy/../escape")
            .components()
            .any(|component| matches!(component, Component::ParentDir)));
    }

    #[test]
    fn identifier_contract_is_strict() {
        let scene = test_scene();
        assert!(validate_identifier(&scene, "id", "valid-id_2").is_ok());
        assert!(validate_identifier(&scene, "id", "bad id").is_err());
    }

    fn test_scene() -> Scene {
        serde_yaml::from_str(
            r#"
id: test
target: bevy
lane: static
enabled: true
tags: []
launch:
  world_seed: 1
  world_mode: bench
  scene: bench.toml
  quality: balanced
  render_resolution_preset: high
  viewport: [1, 1]
  device_pixel_ratio: 1
  camera: { position: [0, 0, 0], yaw_deg: 0, pitch_deg: 0, fov_y_deg: 55 }
  lighting: { time_of_day_hours: 12, sun_elevation_deg: 55, sun_azimuth_deg: 145 }
  weather: { wind_time_s: 0, cloud_time_s: 0, particle_time_s: 0, precipitation: none }
  flags: {}
settle: { ready_timeout_ms: 1, warmup_frames: 0, settle_frames: 0, freeze_after_settle: true }
capture: { checkpoint: main, image: viewport, include_hud: false, include_debug_overlays: false }
baseline:
  image: validation/baselines/bevy/test/baseline.png
  stats: validation/baselines/bevy/test/baseline.stats.json
  metrics: validation/baselines/bevy/test/baseline.metrics.json
  mask: null
  sha256: null
image_gates:
  required: false
  changed_pixel_threshold: 0.05
  mean_absolute_error_max: 0.01
  p95_absolute_error_max: 0.04
  changed_pixel_fraction_max: 0.02
  edge_error_mean_max: 0.02
  luminance_mean_delta_max: 0.02
  luminance_stddev_delta_max: 0.02
  chroma_mean_delta_max: 0.02
region_probes: []
timing_gates: []
counter_gates: []
informational_metrics: []
specialized_commands: []
"#,
        )
        .unwrap()
    }
}
