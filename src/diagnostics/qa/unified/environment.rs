use std::collections::BTreeMap;
use std::process::Command;

use serde::Serialize;
use serde_json::Value;
use sysinfo::System;

use super::manifest::Registry;
use super::schema::{Scene, Target};
use super::summary::UnifiedSummary;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct QaEnvironment {
    pub repository_commit_sha: Option<String>,
    pub working_tree_dirty: Option<bool>,
    pub authoritative: bool,
    pub target: String,
    pub build_profile: String,
    pub os: String,
    pub platform: String,
    pub gpu_adapter: Option<String>,
    pub gpu_vendor: Option<String>,
    pub gpu_device: Option<String>,
    pub gpu_backend: Option<String>,
    pub driver_version: Option<String>,
    pub viewport: [u32; 2],
    pub device_pixel_ratio: f64,
    pub rust_version: Option<String>,
    pub cargo_version: Option<String>,
    pub bevy_version: String,
    pub manifest_hash: String,
    pub baseline_version: u32,
    pub world_source_hash: Option<String>,
    pub terrain_source_version: Option<String>,
    pub shader_bundle_hashes: BTreeMap<String, String>,
    pub quality: String,
    pub render_resolution_preset: String,
    pub source_environment: BTreeMap<String, Value>,
}

pub fn capture_environment(
    summary: &UnifiedSummary,
    registry: &Registry,
    scene: &Scene,
) -> QaEnvironment {
    let git_sha = summary
        .git_sha
        .clone()
        .or_else(|| command_output("git", &["rev-parse", "HEAD"]));
    let git_dirty = summary.git_dirty.or_else(read_git_dirty);
    let adapter = string_value(&summary.environment, "gpu_adapter")
        .or_else(|| string_value(&summary.environment, "adapter_name"));
    let authoritative_override = summary
        .environment
        .get("authoritative")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    QaEnvironment {
        repository_commit_sha: git_sha,
        working_tree_dirty: git_dirty,
        authoritative: git_dirty != Some(true) && authoritative_override,
        target: scene.target.as_str().to_string(),
        build_profile: non_empty(&summary.build_profile).unwrap_or_else(|| "unknown".into()),
        os: System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string()),
        platform: non_empty(&summary.platform).unwrap_or_else(|| {
            format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
        }),
        gpu_adapter: adapter,
        gpu_vendor: string_value(&summary.environment, "gpu_vendor"),
        gpu_device: string_value(&summary.environment, "gpu_device"),
        gpu_backend: string_value(&summary.environment, "gpu_backend"),
        driver_version: string_value(&summary.environment, "driver_version"),
        viewport: scene.launch.viewport,
        device_pixel_ratio: scene.launch.device_pixel_ratio,
        rust_version: command_output("rustc", &["--version"]),
        cargo_version: command_output("cargo", &["--version"]),
        bevy_version: non_empty(&summary.bevy_version).unwrap_or_else(|| "0.18.1".into()),
        manifest_hash: registry.manifest_hash.clone(),
        baseline_version: registry.baseline_version,
        world_source_hash: string_value(&summary.environment, "world_source_hash"),
        terrain_source_version: string_value(
            &summary.environment,
            "terrain_source_version",
        ),
        shader_bundle_hashes: string_map(
            summary.environment.get("shader_bundle_hashes"),
        ),
        quality: scene.launch.quality.clone(),
        render_resolution_preset: scene.launch.render_resolution_preset.clone(),
        source_environment: summary.environment.clone(),
    }
}

pub fn target_name(target: Target) -> &'static str {
    target.as_str()
}

fn command_output(executable: &str, arguments: &[&str]) -> Option<String> {
    let output = Command::new(executable).args(arguments).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?;
    non_empty(value.trim())
}

fn read_git_dirty() -> Option<bool> {
    let output = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| !output.stdout.is_empty())
}

fn string_value(values: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    values
        .get(key)
        .and_then(Value::as_str)
        .and_then(|value| non_empty(value))
}

fn string_map(value: Option<&Value>) -> BTreeMap<String, String> {
    value
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|value| (key.clone(), value.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn non_empty(value: impl AsRef<str>) -> Option<String> {
    let value = value.as_ref().trim();
    (!value.is_empty()).then(|| value.to_string())
}
