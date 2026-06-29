use bevy::prelude::*;

use super::drift_gate::WorldSourceDriftGateConfig;
use super::drift_readback_acceptance::{
    WorldSourceGpuReadbackAcceptanceResult, evaluate_world_source_gpu_readback_acceptance,
};
use super::drift_readback_bridge::GpuWorldSourceDriftReadbackSharedResult;
use super::drift_readback_request::GpuWorldSourceDriftReadbackRequestSettings;
use super::terrain_bridge::ProceduralWorldSourceTerrainBridge;

#[derive(Resource, Debug, Clone, Default)]
pub struct GpuWorldSourceDriftRuntimeAcceptanceState {
    pub evaluated: bool,
    pub result: Option<WorldSourceGpuReadbackAcceptanceResult>,
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

    state.evaluated = true;
    state.result = Some(result);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{
        BiomeId, MaterialLayerId, WorldSourceDriftSample, WorldSourceGpuReadbackResult,
    };

    #[test]
    fn default_runtime_acceptance_state_is_pending() {
        let state = GpuWorldSourceDriftRuntimeAcceptanceState::default();

        assert!(!state.evaluated);
        assert!(state.result.is_none());
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
}
