use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;
use thiserror::Error;

use super::manifest::Registry as SceneRegistry;
use super::orchestration::{
    ArtifactKind, BatteryReport, BatteryRunOptions, OrchestrationError, OrchestrationRegistry,
    deterministic_artifacts, run_battery,
};
use super::schema::Target;
use super::sha256::{Sha256Error, digest_bytes, digest_file};

#[derive(Clone, Debug)]
pub struct DeterminismOptions {
    pub repository_root: PathBuf,
    pub output_dir: PathBuf,
    pub battery_id: String,
    pub target: Option<Target>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ArtifactResult {
    pub command_id: String,
    pub scene_id: String,
    pub artifact: String,
    pub status: String,
    pub left_hash: Option<String>,
    pub right_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DeterminismReport {
    pub schema_version: u32,
    pub battery_id: String,
    pub status: String,
    pub run_a: BatteryReport,
    pub run_b: BatteryReport,
    pub artifacts: Vec<ArtifactResult>,
    pub failures: Vec<String>,
}

#[derive(Debug, Error)]
pub enum DeterminismError {
    #[error(transparent)]
    Orchestration(#[from] OrchestrationError),
    #[error(transparent)]
    Sha256(#[from] Sha256Error),
    #[error("failed to read determinism artifact {path}: {source}")]
    Read { path: PathBuf, source: std::io::Error },
    #[error("failed to parse determinism artifact {path}: {source}")]
    Parse { path: PathBuf, source: serde_json::Error },
    #[error("failed to serialize determinism report: {0}")]
    Serialize(serde_json::Error),
    #[error("failed to write determinism report {path}: {source}")]
    Write { path: PathBuf, source: std::io::Error },
}

pub fn run_determinism(
    orchestration: &OrchestrationRegistry,
    scenes: &SceneRegistry,
    options: &DeterminismOptions,
) -> Result<DeterminismReport, DeterminismError> {
    let run_a_dir = options.output_dir.join("run-a");
    let run_b_dir = options.output_dir.join("run-b");
    let run_a = run_battery(
        orchestration,
        scenes,
        &BatteryRunOptions {
            repository_root: options.repository_root.clone(),
            output_dir: run_a_dir.clone(),
            run_index: 1,
            battery_id: options.battery_id.clone(),
            target: options.target,
        },
    )?;
    let run_b = run_battery(
        orchestration,
        scenes,
        &BatteryRunOptions {
            repository_root: options.repository_root.clone(),
            output_dir: run_b_dir.clone(),
            run_index: 2,
            battery_id: options.battery_id.clone(),
            target: options.target,
        },
    )?;

    let artifacts = compare_declared_artifacts(
        orchestration,
        &run_a,
        &run_b,
        &options.repository_root,
        &run_a_dir,
        &run_b_dir,
    )?;
    let mut failures = Vec::new();
    if run_a.status != "PASS" {
        failures.push("run-a failed".to_string());
    }
    if run_b.status != "PASS" {
        failures.push("run-b failed".to_string());
    }
    if command_outcomes(&run_a) != command_outcomes(&run_b) {
        failures.push("fresh-process command outcomes differ".to_string());
    }
    failures.extend(
        artifacts
            .iter()
            .filter(|artifact| artifact.status != "PASS")
            .map(|artifact| {
                format!(
                    "{}/{}/{}: {}",
                    artifact.command_id, artifact.scene_id, artifact.artifact, artifact.status
                )
            }),
    );
    let report = DeterminismReport {
        schema_version: 1,
        battery_id: options.battery_id.clone(),
        status: if failures.is_empty() { "PASS" } else { "FAIL" }.to_string(),
        run_a,
        run_b,
        artifacts,
        failures,
    };
    write_report(&report, &options.output_dir)?;
    Ok(report)
}

fn compare_declared_artifacts(
    orchestration: &OrchestrationRegistry,
    run_a: &BatteryReport,
    run_b: &BatteryReport,
    repository_root: &Path,
    run_a_dir: &Path,
    run_b_dir: &Path,
) -> Result<Vec<ArtifactResult>, DeterminismError> {
    let right = run_b
        .commands
        .iter()
        .map(|result| (command_key(result), result))
        .collect::<BTreeMap<_, _>>();
    let mut results = Vec::new();
    for left_result in &run_a.commands {
        if !right.contains_key(&command_key(left_result)) {
            continue;
        }
        let Some(command) = orchestration.commands.get(&left_result.command_id) else {
            continue;
        };
        let target = parse_target(&left_result.target);
        let left_artifacts = deterministic_artifacts(
            command,
            repository_root,
            run_a_dir,
            1,
            &left_result.scene_id,
            target,
        )?;
        let right_artifacts = deterministic_artifacts(
            command,
            repository_root,
            run_b_dir,
            2,
            &left_result.scene_id,
            target,
        )?;
        for (left, right) in left_artifacts.iter().zip(right_artifacts.iter()) {
            results.push(compare_artifact(
                &left_result.command_id,
                &left_result.scene_id,
                left,
                right,
            )?);
        }
    }
    Ok(results)
}

fn compare_artifact(
    command_id: &str,
    scene_id: &str,
    left: &super::orchestration::ArtifactPath,
    right: &super::orchestration::ArtifactPath,
) -> Result<ArtifactResult, DeterminismError> {
    let artifact = left
        .path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("artifact")
        .to_string();
    if !left.path.exists() || !right.path.exists() {
        return Ok(ArtifactResult {
            command_id: command_id.to_string(),
            scene_id: scene_id.to_string(),
            artifact,
            status: "MISSING".to_string(),
            left_hash: None,
            right_hash: None,
            message: None,
        });
    }

    if left.kind == ArtifactKind::Json {
        let left_value = read_json(&left.path)?;
        let right_value = read_json(&right.path)?;
        let ignored = left.ignore_json_keys.iter().cloned().collect::<BTreeSet<_>>();
        let mut differences = Vec::new();
        compare_json(
            &left_value,
            &right_value,
            &ignored,
            left.numeric_tolerance,
            "$",
            &mut differences,
        );
        return Ok(ArtifactResult {
            command_id: command_id.to_string(),
            scene_id: scene_id.to_string(),
            artifact,
            status: if differences.is_empty() { "PASS" } else { "FAIL" }.to_string(),
            left_hash: Some(hash_json(&left_value, &ignored)?),
            right_hash: Some(hash_json(&right_value, &ignored)?),
            message: (!differences.is_empty()).then(|| {
                differences.into_iter().take(8).collect::<Vec<_>>().join("; ")
            }),
        });
    }

    let left_hash = hash_path(&left.path)?;
    let right_hash = hash_path(&right.path)?;
    Ok(ArtifactResult {
        command_id: command_id.to_string(),
        scene_id: scene_id.to_string(),
        artifact,
        status: if left_hash == right_hash { "PASS" } else { "FAIL" }.to_string(),
        left_hash: Some(left_hash),
        right_hash: Some(right_hash),
        message: None,
    })
}

pub fn compare_json(
    left: &Value,
    right: &Value,
    ignored: &BTreeSet<String>,
    tolerance: f64,
    path: &str,
    differences: &mut Vec<String>,
) {
    let key = path.rsplit('.').next().unwrap_or(path);
    if ignored.contains(key) || ignored.contains(path) {
        return;
    }
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => {
            let left = left.as_f64();
            let right = right.as_f64();
            if left.zip(right).is_none_or(|(left, right)| (left - right).abs() > tolerance) {
                differences.push(format!("{path}: {left:?} != {right:?}"));
            }
        }
        (Value::Array(left), Value::Array(right)) => {
            if left.len() != right.len() {
                differences.push(format!("{path}.length: {} != {}", left.len(), right.len()));
            }
            for index in 0..left.len().min(right.len()) {
                compare_json(
                    &left[index],
                    &right[index],
                    ignored,
                    tolerance,
                    &format!("{path}[{index}]"),
                    differences,
                );
            }
        }
        (Value::Object(left), Value::Object(right)) => {
            let keys = left.keys().chain(right.keys()).cloned().collect::<BTreeSet<_>>();
            for key in keys {
                match (left.get(&key), right.get(&key)) {
                    (Some(left), Some(right)) => compare_json(
                        left,
                        right,
                        ignored,
                        tolerance,
                        &format!("{path}.{key}"),
                        differences,
                    ),
                    _ => differences.push(format!("{path}.{key}: key presence differs")),
                }
            }
        }
        _ if left == right => {}
        _ => differences.push(format!("{path}: {left} != {right}")),
    }
}

fn hash_json(value: &Value, ignored: &BTreeSet<String>) -> Result<String, DeterminismError> {
    let normalized = normalize_json(value, ignored);
    let bytes = serde_json::to_vec(&normalized).map_err(DeterminismError::Serialize)?;
    Ok(digest_bytes(&bytes))
}

fn normalize_json(value: &Value, ignored: &BTreeSet<String>) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(|value| normalize_json(value, ignored)).collect()),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .filter(|(key, _)| !ignored.contains(*key))
                .map(|(key, value)| (key.clone(), normalize_json(value, ignored)))
                .collect(),
        ),
        _ => value.clone(),
    }
}

fn hash_path(path: &Path) -> Result<String, DeterminismError> {
    if path.is_file() {
        return Ok(digest_file(path)?);
    }
    let mut bytes = Vec::new();
    for file in walk(path)? {
        let relative = file.strip_prefix(path).unwrap_or(&file).to_string_lossy();
        bytes.extend_from_slice(relative.as_bytes());
        bytes.push(0);
        bytes.extend_from_slice(&fs::read(&file).map_err(|source| DeterminismError::Read {
            path: file.clone(),
            source,
        })?);
        bytes.push(0);
    }
    Ok(digest_bytes(&bytes))
}

fn walk(root: &Path) -> Result<Vec<PathBuf>, DeterminismError> {
    let mut files = Vec::new();
    walk_into(root, &mut files)?;
    files.sort();
    Ok(files)
}

fn walk_into(path: &Path, output: &mut Vec<PathBuf>) -> Result<(), DeterminismError> {
    let entries = fs::read_dir(path).map_err(|source| DeterminismError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    for entry in entries {
        let entry = entry.map_err(|source| DeterminismError::Read {
            path: path.to_path_buf(),
            source,
        })?;
        let candidate = entry.path();
        if candidate.is_dir() {
            walk_into(&candidate, output)?;
        } else {
            output.push(candidate);
        }
    }
    Ok(())
}

fn read_json(path: &Path) -> Result<Value, DeterminismError> {
    let text = fs::read_to_string(path).map_err(|source| DeterminismError::Read {
        path: path.to_path_buf(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| DeterminismError::Parse {
        path: path.to_path_buf(),
        source,
    })
}

fn command_key(result: &super::orchestration::CommandResult) -> String {
    format!("{}:{}:{}", result.command_id, result.scene_id, result.target)
}

fn command_outcomes(report: &BatteryReport) -> Vec<String> {
    let mut values = report
        .commands
        .iter()
        .map(|command| {
            format!(
                "{}:{}:{}:{}:{:?}",
                command.command_id,
                command.scene_id,
                command.target,
                command.status,
                command.exit_code
            )
        })
        .collect::<Vec<_>>();
    values.sort();
    values
}

fn parse_target(value: &str) -> Target {
    if value == "bevy" { Target::Bevy } else { Target::ClodPoc }
}

fn write_report(report: &DeterminismReport, output_dir: &Path) -> Result<(), DeterminismError> {
    fs::create_dir_all(output_dir).map_err(|source| DeterminismError::Write {
        path: output_dir.to_path_buf(),
        source,
    })?;
    let json_path = output_dir.join("determinism-report.json");
    let markdown_path = output_dir.join("determinism-report.md");
    let json = serde_json::to_string_pretty(report).map_err(DeterminismError::Serialize)?;
    fs::write(&json_path, format!("{json}\n")).map_err(|source| DeterminismError::Write {
        path: json_path,
        source,
    })?;
    let mut markdown = format!(
        "# Unified QA determinism\n\nBattery: `{}`\n\nStatus: **{}**\n",
        report.battery_id, report.status
    );
    if !report.failures.is_empty() {
        markdown.push_str("\n## Failures\n\n");
        for failure in &report.failures {
            markdown.push_str(&format!("- {failure}\n"));
        }
    }
    fs::write(&markdown_path, markdown).map_err(|source| DeterminismError::Write {
        path: markdown_path,
        source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_comparison_honors_tolerance_and_ignored_keys() {
        let left = json!({"captured_utc": "a", "value": 1.0});
        let right = json!({"captured_utc": "b", "value": 1.004});
        let ignored = BTreeSet::from(["captured_utc".to_string()]);
        let mut differences = Vec::new();
        compare_json(&left, &right, &ignored, 0.005, "$", &mut differences);
        assert!(differences.is_empty());
    }
}
