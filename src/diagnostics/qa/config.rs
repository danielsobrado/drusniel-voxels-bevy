use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use thiserror::Error;

use super::constants::{
    DEFAULT_CHANGED_PIXEL_THRESHOLD, DEFAULT_MAX_CHANGED_RATIO, DEFAULT_MAX_MEAN_ABS_ERROR,
    DEFAULT_MAX_RMSE,
};

#[derive(Debug, Error)]
pub enum QaConfigError {
    #[error("failed to read QA config {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse QA config {path}: {source}")]
    Parse {
        path: PathBuf,
        source: serde_yaml::Error,
    },
    #[error("duplicate QA scene id '{id}'")]
    DuplicateSceneId { id: String },
    #[error("duplicate screenshot id '{id}' in scene '{scene_id}'")]
    DuplicateScreenshotId { scene_id: String, id: String },
    #[error("duplicate probe id '{id}' in scene '{scene_id}'")]
    DuplicateProbeId { scene_id: String, id: String },
    #[error("duplicate timing id '{id}' in scene '{scene_id}'")]
    DuplicateTimingId { scene_id: String, id: String },
    #[error("scene '{scene_id}' must name a checkpoint")]
    MissingCheckpoint { scene_id: String },
    #[error("scene '{scene_id}' has no screenshots")]
    MissingScreenshots { scene_id: String },
    #[error(
        "probe '{probe_id}' in scene '{scene_id}' references unknown screenshot '{screenshot_id}'"
    )]
    UnknownProbeScreenshot {
        scene_id: String,
        probe_id: String,
        screenshot_id: String,
    },
    #[error("probe '{probe_id}' in scene '{scene_id}' has invalid region {region:?}")]
    InvalidRegion {
        scene_id: String,
        probe_id: String,
        region: [f32; 4],
    },
    #[error("probe '{probe_id}' in scene '{scene_id}' has invalid pixel {pixel:?}")]
    InvalidPixel {
        scene_id: String,
        probe_id: String,
        pixel: [f32; 2],
    },
    #[error("timing '{timing_id}' in scene '{scene_id}' has invalid max {max_ms}")]
    InvalidTimingThreshold {
        scene_id: String,
        timing_id: String,
        max_ms: f64,
    },
    #[error("failed to read bench scene '{path}' for scene '{scene_id}': {source}")]
    ReadBenchScene {
        scene_id: String,
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("failed to parse bench scene '{path}' for scene '{scene_id}': {source}")]
    ParseBenchScene {
        scene_id: String,
        path: PathBuf,
        source: toml::de::Error,
    },
    #[error(
        "scene '{scene_id}' references checkpoint '{checkpoint}' not present in bench scene '{bench_scene}'"
    )]
    UnknownCheckpoint {
        scene_id: String,
        bench_scene: String,
        checkpoint: String,
    },
    #[error(
        "scene '{scene_id}' references screenshot '{screenshot}' not defined for checkpoint '{checkpoint}' in bench scene '{bench_scene}'"
    )]
    UnknownScreenshotPoint {
        scene_id: String,
        bench_scene: String,
        checkpoint: String,
        screenshot: String,
    },
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QaConfigFile {
    pub qa: QaConfig,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct QaConfig {
    pub output_root: PathBuf,
    pub baseline_root: PathBuf,
    pub report_json_name: String,
    pub report_markdown_name: String,
    pub image_diff: ImageDiffConfig,
    pub timing: TimingConfig,
    pub scenes: Vec<QaSceneConfig>,
}

impl Default for QaConfig {
    fn default() -> Self {
        Self {
            output_root: PathBuf::from("bench-runs/qa"),
            baseline_root: PathBuf::from("bench-baselines"),
            report_json_name: "qa-report.json".to_string(),
            report_markdown_name: "qa-report.md".to_string(),
            image_diff: ImageDiffConfig::default(),
            timing: TimingConfig::default(),
            scenes: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ImageDiffConfig {
    pub enabled: bool,
    pub fail_when_baseline_missing: bool,
    pub changed_pixel_threshold: f32,
    pub max_changed_ratio: f64,
    pub max_rmse: f64,
    pub max_mean_abs_error: f64,
    pub write_diff_images: bool,
}

impl Default for ImageDiffConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            fail_when_baseline_missing: false,
            changed_pixel_threshold: DEFAULT_CHANGED_PIXEL_THRESHOLD,
            max_changed_ratio: DEFAULT_MAX_CHANGED_RATIO,
            max_rmse: DEFAULT_MAX_RMSE,
            max_mean_abs_error: DEFAULT_MAX_MEAN_ABS_ERROR,
            write_diff_images: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct TimingConfig {
    pub enabled: bool,
    pub fail_on_threshold: bool,
}

impl Default for TimingConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            fail_on_threshold: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QaSceneConfig {
    pub id: String,
    #[serde(default)]
    pub bench_scene: Option<String>,
    pub checkpoint: String,
    #[serde(default)]
    pub screenshots: Vec<QaScreenshotConfig>,
    #[serde(default)]
    pub probes: Vec<QaProbeConfig>,
    #[serde(default)]
    pub timing: Vec<QaTimingThreshold>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QaScreenshotConfig {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub baseline: Option<PathBuf>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum QaProbeConfig {
    RegionLuminance {
        id: String,
        screenshot: String,
        region: [f32; 4],
        min: f64,
        max: f64,
    },
    RegionVariance {
        id: String,
        screenshot: String,
        region: [f32; 4],
        min_luminance_stddev: f64,
    },
    PixelLuminance {
        id: String,
        screenshot: String,
        pixel: [f32; 2],
        min: f64,
        max: f64,
    },
}

impl QaProbeConfig {
    pub fn id(&self) -> &str {
        match self {
            Self::RegionLuminance { id, .. }
            | Self::RegionVariance { id, .. }
            | Self::PixelLuminance { id, .. } => id,
        }
    }

    pub fn probe_type(&self) -> &str {
        match self {
            Self::RegionLuminance { .. } => "region_luminance",
            Self::RegionVariance { .. } => "region_variance",
            Self::PixelLuminance { .. } => "pixel_luminance",
        }
    }

    pub fn screenshot(&self) -> &str {
        match self {
            Self::RegionLuminance { screenshot, .. }
            | Self::RegionVariance { screenshot, .. }
            | Self::PixelLuminance { screenshot, .. } => screenshot,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QaTimingThreshold {
    pub id: String,
    pub area: String,
    pub field: String,
    pub max_ms: f64,
    #[serde(default)]
    pub optional: bool,
}

pub fn load_config(path: &Path) -> Result<QaConfig, QaConfigError> {
    let text = fs::read_to_string(path).map_err(|source| QaConfigError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    let file: QaConfigFile =
        serde_yaml::from_str(&text).map_err(|source| QaConfigError::Parse {
            path: path.to_path_buf(),
            source,
        })?;
    validate_config(&file.qa)?;
    validate_scenes_against_benches(&file.qa, Path::new("."))?;
    Ok(file.qa)
}

pub fn validate_config(config: &QaConfig) -> Result<(), QaConfigError> {
    let mut scene_ids = HashSet::new();
    for scene in &config.scenes {
        if !scene_ids.insert(scene.id.as_str()) {
            return Err(QaConfigError::DuplicateSceneId {
                id: scene.id.clone(),
            });
        }
        if scene.checkpoint.trim().is_empty() {
            return Err(QaConfigError::MissingCheckpoint {
                scene_id: scene.id.clone(),
            });
        }
        if scene.screenshots.is_empty() {
            return Err(QaConfigError::MissingScreenshots {
                scene_id: scene.id.clone(),
            });
        }

        let mut screenshot_ids = HashSet::new();
        for screenshot in &scene.screenshots {
            if !screenshot_ids.insert(screenshot.id.as_str()) {
                return Err(QaConfigError::DuplicateScreenshotId {
                    scene_id: scene.id.clone(),
                    id: screenshot.id.clone(),
                });
            }
        }

        let mut probe_ids = HashSet::new();
        for probe in &scene.probes {
            if !probe_ids.insert(probe.id()) {
                return Err(QaConfigError::DuplicateProbeId {
                    scene_id: scene.id.clone(),
                    id: probe.id().to_string(),
                });
            }
            if !screenshot_ids.contains(probe.screenshot()) {
                return Err(QaConfigError::UnknownProbeScreenshot {
                    scene_id: scene.id.clone(),
                    probe_id: probe.id().to_string(),
                    screenshot_id: probe.screenshot().to_string(),
                });
            }
            match probe {
                QaProbeConfig::RegionLuminance { id, region, .. }
                | QaProbeConfig::RegionVariance { id, region, .. } => {
                    if !valid_region(*region) {
                        return Err(QaConfigError::InvalidRegion {
                            scene_id: scene.id.clone(),
                            probe_id: id.clone(),
                            region: *region,
                        });
                    }
                }
                QaProbeConfig::PixelLuminance { id, pixel, .. } => {
                    if !valid_pixel(*pixel) {
                        return Err(QaConfigError::InvalidPixel {
                            scene_id: scene.id.clone(),
                            probe_id: id.clone(),
                            pixel: *pixel,
                        });
                    }
                }
            }
        }

        let mut timing_ids = HashSet::new();
        for timing in &scene.timing {
            if !timing_ids.insert(timing.id.as_str()) {
                return Err(QaConfigError::DuplicateTimingId {
                    scene_id: scene.id.clone(),
                    id: timing.id.clone(),
                });
            }
            if !timing.max_ms.is_finite() || timing.max_ms < 0.0 {
                return Err(QaConfigError::InvalidTimingThreshold {
                    scene_id: scene.id.clone(),
                    timing_id: timing.id.clone(),
                    max_ms: timing.max_ms,
                });
            }
        }
    }
    Ok(())
}

/// Resolve each scene's `bench_scene` against the real bench TOML and confirm
/// the configured checkpoint and screenshot names actually exist there, so a
/// typo fails at load instead of producing a confusing empty run. Scenes
/// without a `bench_scene` (e.g. ad-hoc summaries) are skipped.
pub fn validate_scenes_against_benches(
    config: &QaConfig,
    base_dir: &Path,
) -> Result<(), QaConfigError> {
    for scene in &config.scenes {
        let Some(bench_scene) = scene.bench_scene.as_deref() else {
            continue;
        };
        let scene_path = base_dir.join(bench_scene);
        let text =
            fs::read_to_string(&scene_path).map_err(|source| QaConfigError::ReadBenchScene {
                scene_id: scene.id.clone(),
                path: scene_path.clone(),
                source,
            })?;
        let parsed: BenchSceneToml =
            toml::from_str(&text).map_err(|source| QaConfigError::ParseBenchScene {
                scene_id: scene.id.clone(),
                path: scene_path.clone(),
                source,
            })?;

        let checkpoint = parsed
            .checkpoint
            .iter()
            .find(|candidate| candidate.name == scene.checkpoint)
            .ok_or_else(|| QaConfigError::UnknownCheckpoint {
                scene_id: scene.id.clone(),
                bench_scene: bench_scene.to_string(),
                checkpoint: scene.checkpoint.clone(),
            })?;

        for screenshot in &scene.screenshots {
            let known = checkpoint
                .screenshot_points
                .iter()
                .any(|point| point.name == screenshot.name);
            if !known {
                return Err(QaConfigError::UnknownScreenshotPoint {
                    scene_id: scene.id.clone(),
                    bench_scene: bench_scene.to_string(),
                    checkpoint: scene.checkpoint.clone(),
                    screenshot: screenshot.name.clone(),
                });
            }
        }
    }
    Ok(())
}

/// Minimal view of a bench scene TOML: only the names QA must cross-check.
/// Unknown fields are ignored so the full bench schema can evolve freely.
#[derive(Deserialize)]
struct BenchSceneToml {
    #[serde(default)]
    checkpoint: Vec<BenchCheckpointToml>,
}

#[derive(Deserialize)]
struct BenchCheckpointToml {
    name: String,
    #[serde(default)]
    screenshot_points: Vec<BenchScreenshotPointToml>,
}

#[derive(Deserialize)]
struct BenchScreenshotPointToml {
    name: String,
}

fn valid_region(region: [f32; 4]) -> bool {
    let [x0, y0, x1, y1] = region;
    [x0, y0, x1, y1]
        .into_iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
        && x0 < x1
        && y0 < y1
}

fn valid_pixel(pixel: [f32; 2]) -> bool {
    pixel
        .into_iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(&value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_duplicate_scene_ids() {
        let config = QaConfig {
            scenes: vec![scene("a"), scene("a")],
            ..Default::default()
        };
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::DuplicateSceneId { .. })
        ));
    }

    #[test]
    fn rejects_unknown_probe_screenshot() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0].probes.push(QaProbeConfig::PixelLuminance {
            id: "probe".into(),
            screenshot: "missing".into(),
            pixel: [0.5, 0.5],
            min: 0.0,
            max: 1.0,
        });
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::UnknownProbeScreenshot { .. })
        ));
    }

    #[test]
    fn rejects_invalid_region() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0]
            .probes
            .push(QaProbeConfig::RegionLuminance {
                id: "probe".into(),
                screenshot: "main".into(),
                region: [0.9, 0.1, 0.2, 0.3],
                min: 0.0,
                max: 1.0,
            });
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::InvalidRegion { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_screenshot_ids() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0].screenshots.push(QaScreenshotConfig {
            id: "main".into(),
            name: "other".into(),
            baseline: None,
        });
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::DuplicateScreenshotId { .. })
        ));
    }

    #[test]
    fn rejects_duplicate_probe_ids() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        for _ in 0..2 {
            config.scenes[0].probes.push(QaProbeConfig::PixelLuminance {
                id: "dup".into(),
                screenshot: "main".into(),
                pixel: [0.5, 0.5],
                min: 0.0,
                max: 1.0,
            });
        }
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::DuplicateProbeId { .. })
        ));
    }

    #[test]
    fn rejects_invalid_pixel() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0].probes.push(QaProbeConfig::PixelLuminance {
            id: "p".into(),
            screenshot: "main".into(),
            pixel: [1.5, 0.5],
            min: 0.0,
            max: 1.0,
        });
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::InvalidPixel { .. })
        ));
    }

    #[test]
    fn rejects_invalid_timing_threshold() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0].timing.push(QaTimingThreshold {
            id: "t".into(),
            area: "__frame".into(),
            field: "p99_ms".into(),
            max_ms: -1.0,
            optional: false,
        });
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::InvalidTimingThreshold { .. })
        ));
    }

    #[test]
    fn rejects_empty_checkpoint() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0].checkpoint = "  ".into();
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::MissingCheckpoint { .. })
        ));
    }

    #[test]
    fn rejects_missing_screenshots() {
        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0].screenshots.clear();
        assert!(matches!(
            validate_config(&config),
            Err(QaConfigError::MissingScreenshots { .. })
        ));
    }

    #[test]
    fn validates_checkpoint_and_screenshot_against_real_toml() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(
            dir.path().join("scene.toml"),
            "[[checkpoint]]\nname = \"ridge-run-noon\"\nscreenshot_points = [ { name = \"start\", frame = 0 } ]\n",
        )
        .unwrap();

        let mut config = QaConfig {
            scenes: vec![scene("a")],
            ..Default::default()
        };
        config.scenes[0].bench_scene = Some("scene.toml".into());
        config.scenes[0].checkpoint = "ridge-run-noon".into();
        config.scenes[0].screenshots[0].name = "start".into();
        assert!(validate_scenes_against_benches(&config, dir.path()).is_ok());

        config.scenes[0].checkpoint = "missing".into();
        assert!(matches!(
            validate_scenes_against_benches(&config, dir.path()),
            Err(QaConfigError::UnknownCheckpoint { .. })
        ));

        config.scenes[0].checkpoint = "ridge-run-noon".into();
        config.scenes[0].screenshots[0].name = "nope".into();
        assert!(matches!(
            validate_scenes_against_benches(&config, dir.path()),
            Err(QaConfigError::UnknownScreenshotPoint { .. })
        ));
    }

    fn scene(id: &str) -> QaSceneConfig {
        QaSceneConfig {
            id: id.into(),
            bench_scene: None,
            checkpoint: "checkpoint".into(),
            screenshots: vec![QaScreenshotConfig {
                id: "main".into(),
                name: "main".into(),
                baseline: None,
            }],
            probes: Vec::new(),
            timing: Vec::new(),
        }
    }
}
