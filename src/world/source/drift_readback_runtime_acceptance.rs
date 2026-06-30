use std::path::PathBuf;

use bevy::prelude::*;
use serde::Serialize;

use super::drift_gate::WorldSourceDriftGateConfig;
use super::drift_readback_acceptance::{
    WorldSourceGpuReadbackAcceptanceResult, evaluate_world_source_gpu_readback_acceptance,
    world_source_gpu_readback_acceptance_blockers,
};
use super::drift_readback_bridge::GpuWorldSourceDriftReadbackSharedResult;
use super::drift_readback_request::GpuWorldSourceDriftReadbackRequestSettings;
use super::terrain_bridge::ProceduralWorldSourceTerrainBridge;

pub const WORLD_SOURCE_DRIFT_RUNTIME_ACCEPTANCE_OUT_ENV: &str =
    "VOXEL_WORLD_SOURCE_DRIFT_ACCEPTANCE_OUT";
const DEFAULT_WORLD_SOURCE_DRIFT_RUNTIME_ACCEPTANCE_OUT: &str =
    "bench-runs/world-source-runtime-acceptance/summary.json";

#[derive(Resource, Debug, Clone, Default)]
pub struct GpuWorldSourceDriftRuntimeAcceptanceState {
    pub evaluated: bool,
    pub result: Option<WorldSourceGpuReadbackAcceptanceResult>,
    pub output_path: Option<PathBuf>,
}

#[derive(Debug, Serialize)]
struct WorldSourceDriftRuntimeAcceptanceSummary<'a> {
    schema_version: u32,
    acceptance_mode: &'static str,
    acceptance_pass: bool,
    acceptance_blockers: Vec<&'static str>,
    gpu_readback: &'a super::drift_readback::WorldSourceGpuReadbackResult,
    drift_gate: &'a super::drift_gate::WorldSourceDriftGateReport,
    output_path: String,
}

pub fn evaluate_gpu_world_source_drift_runtime_acceptance_once(
    settings: Res<GpuWorldSourceDriftReadbackRequestSettings>,
    shared: Res<GpuWorldSourceDriftReadbackSharedResult>,
    mut state: ResMut<GpuWorldSourceDriftRuntimeAcceptanceState>,
) {
    if state.evaluated || !settings.enabled {
        return;
    }
    if !shared.has_matching_samples(settings.points.len()) {
        return;
    }

    let bridge = ProceduralWorldSourceTerrainBridge::load_or_default();
    let result = evaluate_world_source_gpu_readback_acceptance(
        bridge.source(),
        &*shared,
        &settings.points,
        WorldSourceDriftGateConfig::default(),
    );

    info!(
        "WorldSource GPU readback runtime acceptance: gpu_readback={:?}, drift_gate={:?}, failures={}",
        result.gpu_readback.status,
        result.drift_gate.status,
        result.drift_gate.failures.len()
    );
    println!(
        "WorldSource GPU readback runtime acceptance: gpu_readback={:?}, drift_gate={:?}, failures={}",
        result.gpu_readback.status,
        result.drift_gate.status,
        result.drift_gate.failures.len()
    );
    for failure in result.drift_gate.failures.iter().take(8) {
        println!(
            "WorldSource GPU readback drift failure: sample={} kind={:?} cpu={:?} gpu={:?} delta={} tolerance={}",
            failure.sample_index,
            failure.kind,
            failure.cpu,
            failure.gpu,
            failure.delta,
            failure.tolerance
        );
    }

    match write_runtime_acceptance_summary(&result) {
        Ok(path) => {
            info!(
                "WorldSource GPU readback runtime acceptance summary written to {}",
                path.display()
            );
            println!(
                "WorldSource GPU readback runtime acceptance summary written to {}",
                path.display()
            );
            state.output_path = Some(path);
        }
        Err(err) => {
            warn!("failed to write WorldSource GPU readback runtime acceptance summary: {err}");
            println!("failed to write WorldSource GPU readback runtime acceptance summary: {err}");
        }
    }

    state.evaluated = true;
    state.result = Some(result);
}

fn write_runtime_acceptance_summary(
    result: &WorldSourceGpuReadbackAcceptanceResult,
) -> std::io::Result<PathBuf> {
    let path = runtime_acceptance_output_path();
    write_runtime_acceptance_summary_to_path(result, path)
}

fn write_runtime_acceptance_summary_to_path(
    result: &WorldSourceGpuReadbackAcceptanceResult,
    path: PathBuf,
) -> std::io::Result<PathBuf> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let blockers =
        world_source_gpu_readback_acceptance_blockers(&result.gpu_readback, &result.drift_gate);
    let summary = WorldSourceDriftRuntimeAcceptanceSummary {
        schema_version: 1,
        acceptance_mode: "runtime_gpu_world_source_drift_gate",
        acceptance_pass: blockers.is_empty(),
        acceptance_blockers: blockers,
        gpu_readback: &result.gpu_readback,
        drift_gate: &result.drift_gate,
        output_path: path.display().to_string(),
    };
    let file = std::fs::File::create(&path)?;
    serde_json::to_writer_pretty(file, &summary).map_err(std::io::Error::other)?;
    Ok(path)
}

fn runtime_acceptance_output_path() -> PathBuf {
    runtime_acceptance_output_path_from_value(
        std::env::var(WORLD_SOURCE_DRIFT_RUNTIME_ACCEPTANCE_OUT_ENV).ok(),
    )
}

fn runtime_acceptance_output_path_from_value(value: Option<String>) -> PathBuf {
    value
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(DEFAULT_WORLD_SOURCE_DRIFT_RUNTIME_ACCEPTANCE_OUT))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{
        BiomeId, MaterialLayerId, WorldSourceDriftGateReport, WorldSourceDriftGateStatus,
        WorldSourceDriftSample, WorldSourceGpuReadbackResult,
    };

    #[test]
    fn default_runtime_acceptance_state_is_pending() {
        let state = GpuWorldSourceDriftRuntimeAcceptanceState::default();

        assert!(!state.evaluated);
        assert!(state.result.is_none());
        assert!(state.output_path.is_none());
    }

    #[test]
    fn shared_result_reports_ready_for_runtime_acceptance() {
        let shared = GpuWorldSourceDriftReadbackSharedResult::default();
        let sample = WorldSourceDriftSample {
            x: 0.0,
            z: 0.0,
            height: 18.0,
            ocean_mask: 0.0,
            biome: BiomeId::Meadows,
            dominant_layer: MaterialLayerId::Grass,
        };

        assert!(!shared.has_matching_samples(1));
        shared.store(WorldSourceGpuReadbackResult::available(vec![sample]));
        assert!(shared.has_matching_samples(1));
    }

    #[test]
    fn runtime_acceptance_output_path_defaults_to_bench_runs() {
        assert_eq!(
            runtime_acceptance_output_path_from_value(None),
            PathBuf::from(DEFAULT_WORLD_SOURCE_DRIFT_RUNTIME_ACCEPTANCE_OUT)
        );
    }

    #[test]
    fn writes_runtime_acceptance_summary_json() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("summary.json");
        let result = WorldSourceGpuReadbackAcceptanceResult {
            gpu_readback: WorldSourceGpuReadbackResult::available(vec![WorldSourceDriftSample {
                x: 0.0,
                z: 0.0,
                height: 18.0,
                ocean_mask: 0.0,
                biome: BiomeId::Meadows,
                dominant_layer: MaterialLayerId::Grass,
            }]),
            drift_gate: WorldSourceDriftGateReport {
                status: WorldSourceDriftGateStatus::Passed,
                sample_count: 1,
                compared_count: 1,
                skipped_reason: None,
                failures: Vec::new(),
            },
        };

        let written =
            write_runtime_acceptance_summary_to_path(&result, path.clone()).expect("write summary");
        let json = std::fs::read_to_string(&path).expect("read summary");

        assert_eq!(written, path);
        assert!(json.contains("\"acceptance_pass\": true"));
        assert!(json.contains("\"acceptance_blockers\": []"));
        assert!(json.contains("\"status\": \"available\""));
    }
}
