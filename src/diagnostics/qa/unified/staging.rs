use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{Value, json};
use thiserror::Error;

use super::manifest::Registry;
use super::schema::Target;

#[derive(Debug, Error)]
pub enum StagingError {
    #[error("failed to create staged QA directory {path}: {source}")]
    CreateDir { path: PathBuf, source: std::io::Error },
    #[error("failed to read QA JSON {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("failed to parse QA JSON {path}: {source}")]
    Parse { path: PathBuf, source: serde_json::Error },
    #[error("missing staged QA data: {0}")]
    Missing(String),
    #[error("failed to copy staged QA artifact {source_path} -> {destination}: {source}")]
    Copy { source_path: PathBuf, destination: PathBuf, source: std::io::Error },
    #[error("failed to serialize staged QA artifact: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write staged QA artifact {path}: {source}")]
    Write { path: PathBuf, source: std::io::Error },
}

pub fn stage_bevy_run(
    registry: &Registry,
    summary_path: &Path,
    report_path: &Path,
    output_dir: &Path,
    scene_ids: &[String],
) -> Result<(), StagingError> {
    create_dir(output_dir)?;
    let summary = read_json(summary_path)?;
    let report = read_json(report_path)?;
    let summary_dir = summary_path.parent().unwrap_or_else(|| Path::new("."));
    let checkpoints = summary
        .get("checkpoints")
        .and_then(Value::as_array)
        .ok_or_else(|| StagingError::Missing("summary.checkpoints".to_string()))?;
    let report_scenes = report
        .get("scenes")
        .and_then(Value::as_array)
        .map(|values| values.as_slice())
        .unwrap_or(&[]);
    let bevy_scenes = registry
        .scenes
        .iter()
        .filter(|scene| scene.enabled && scene.target == Target::Bevy)
        .filter(|scene| scene_ids.is_empty() || scene_ids.contains(&scene.id))
        .collect::<Vec<_>>();
    if bevy_scenes.is_empty() {
        return Err(StagingError::Missing("canonical Bevy scenes".to_string()));
    }
    let missing_scene_ids = scene_ids
        .iter()
        .filter(|scene_id| !bevy_scenes.iter().any(|scene| &scene.id == *scene_id))
        .cloned()
        .collect::<Vec<_>>();
    if !missing_scene_ids.is_empty() {
        return Err(StagingError::Missing(format!(
            "canonical Bevy scenes: {}",
            missing_scene_ids.join(", ")
        )));
    }
    let mut deterministic_scenes = Vec::new();

    for scene in bevy_scenes {
        let checkpoint = checkpoints
            .iter()
            .find(|value| value.get("name").and_then(Value::as_str) == Some(scene.capture.checkpoint.as_str()))
            .ok_or_else(|| StagingError::Missing(format!("checkpoint {}", scene.capture.checkpoint)))?;
        let relative_image = screenshot_path(checkpoint, &scene.capture.image).ok_or_else(|| {
            StagingError::Missing(format!(
                "screenshot {} in checkpoint {}",
                scene.capture.image, scene.capture.checkpoint
            ))
        })?;
        let source_image = {
            let raw = PathBuf::from(relative_image);
            if raw.is_absolute() { raw } else { summary_dir.join(raw) }
        };
        if !source_image.is_file() {
            return Err(StagingError::Missing(format!(
                "screenshot for {} at {}",
                scene.id,
                source_image.display()
            )));
        }
        let scene_report = report_scenes.iter().find(|candidate| {
            candidate.get("id").and_then(Value::as_str) == Some(scene.id.as_str())
        });
        let metrics = scene_report.cloned().unwrap_or_else(|| {
            json!({
                "id": scene.id,
                "checkpoint": scene.capture.checkpoint,
                "status": "NOT_EVALUATED",
                "probes": [],
                "timing": [],
                "failures": [],
            })
        });
        let scene_dir = output_dir.join("scenes").join("bevy").join(&scene.id);
        create_dir(&scene_dir)?;
        copy(&source_image, &scene_dir.join("actual.png"))?;
        write_json(&scene_dir.join("actual.stats.json"), checkpoint)?;
        write_json(&scene_dir.join("actual.metrics.json"), &metrics)?;
        let determinism = json!({
            "scene_id": scene.id,
            "checkpoint": scene.capture.checkpoint,
            "image": scene.capture.image,
            "probes": metrics.get("probes").cloned().unwrap_or(Value::Array(Vec::new())),
            "status": metrics.get("status").cloned().unwrap_or(Value::String("NOT_EVALUATED".to_string())),
        });
        write_json(&scene_dir.join("determinism.json"), &determinism)?;
        deterministic_scenes.push(determinism);
    }

    write_json(
        &output_dir.join("determinism.json"),
        &json!({ "target": "bevy", "scenes": deterministic_scenes }),
    )?;
    write_json(&output_dir.join("environment.json"), &environment(&summary))?;
    Ok(())
}

fn screenshot_path(checkpoint: &Value, name: &str) -> Option<String> {
    let runs = checkpoint.get("runs")?.as_array()?;
    for run in runs {
        if name == "default"
            && let Some(path) = run.get("screenshot").and_then(Value::as_str)
        {
            return Some(path.to_string());
        }
        if let Some(record) = run
            .get("screenshots")
            .and_then(Value::as_array)
            .and_then(|screenshots| {
                screenshots
                    .iter()
                    .find(|record| record.get("name").and_then(Value::as_str) == Some(name))
            })
            && let Some(path) = record.get("path").and_then(Value::as_str)
        {
            return Some(path.to_string());
        }
    }
    None
}

fn environment(summary: &Value) -> Value {
    let head = summary
        .get("git_sha")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| git(["rev-parse", "HEAD"]));
    let dirty = summary
        .get("git_dirty")
        .and_then(Value::as_bool)
        .or_else(|| git(["status", "--porcelain", "--untracked-files=normal"]).map(|value| !value.is_empty()));
    let branch = git(["branch", "--show-current"]);
    let gpu_adapter = find_string(summary, &["gpu_adapter", "gpuAdapter", "adapter_name", "adapterName"])
        .or_else(|| std::env::var("DRUSNIEL_QA_GPU_ADAPTER").ok());
    let gpu_backend = find_string(summary, &["gpu_backend", "gpuBackend", "backend"])
        .or_else(|| std::env::var("DRUSNIEL_QA_GPU_BACKEND").ok());
    let gpu_text = gpu_adapter.as_deref().unwrap_or_default().to_ascii_lowercase();
    let authoritative = cfg!(windows)
        && branch.as_deref() == Some("main")
        && dirty == Some(false)
        && head.is_some()
        && gpu_adapter.is_some()
        && gpu_backend.is_some()
        && !["software", "llvmpipe", "swiftshader", "warp"]
            .iter()
            .any(|marker| gpu_text.contains(marker));
    json!({
        "schema_version": 1,
        "target": "bevy",
        "authoritative": authoritative,
        "repository_commit_sha": head,
        "branch": branch,
        "working_tree_dirty": dirty,
        "os_version": summary.get("platform").cloned().unwrap_or(Value::Null),
        "browser_version": Value::Null,
        "gpu_adapter": gpu_adapter,
        "gpu_backend": gpu_backend,
        "build_profile": summary.get("build_profile").cloned().unwrap_or(Value::Null),
        "bevy_version": summary.get("bevy_version").cloned().unwrap_or(Value::Null),
        "captured_utc": summary.get("run_started_utc").cloned().unwrap_or(Value::Null),
    })
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(value) = map.get(*key).and_then(Value::as_str)
                    && !value.is_empty()
                {
                    return Some(value.to_string());
                }
            }
            map.values().find_map(|value| find_string(value, keys))
        }
        Value::Array(values) => values.iter().find_map(|value| find_string(value, keys)),
        _ => None,
    }
}

fn git<const N: usize>(args: [&str; N]) -> Option<String> {
    let output = Command::new("git").args(args).output().ok()?;
    if !output.status.success() { return None; }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn read_json(path: &Path) -> Result<Value, StagingError> {
    let text = fs::read_to_string(path).map_err(|source| StagingError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| StagingError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn create_dir(path: &Path) -> Result<(), StagingError> {
    fs::create_dir_all(path).map_err(|source| StagingError::CreateDir {
        path: path.to_path_buf(),
        source,
    })
}

fn copy(source_path: &Path, destination: &Path) -> Result<(), StagingError> {
    fs::copy(source_path, destination).map_err(|source| StagingError::Copy {
        source_path: source_path.to_path_buf(),
        destination: destination.to_path_buf(),
        source,
    })?;
    Ok(())
}

fn write_json(path: &Path, value: &Value) -> Result<(), StagingError> {
    let text = serde_json::to_string_pretty(value).map_err(StagingError::Serialize)?;
    fs::write(path, format!("{text}\n")).map_err(|source| StagingError::Write {
        path: path.to_path_buf(),
        source,
    })
}
