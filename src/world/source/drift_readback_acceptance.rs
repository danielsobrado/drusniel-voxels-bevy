use super::drift_gate::{
    WorldSourceDriftGateConfig, WorldSourceDriftGateReport, WorldSourceDriftSamplePoint,
    evaluate_world_source_cpu_gpu_drift,
};
use super::drift_readback::WorldSourceGpuReadbackStatus;
use super::drift_readback::{WorldSourceGpuReadbackProvider, WorldSourceGpuReadbackResult};
use super::world_source::WorldSource;

#[derive(Debug, Clone)]
pub struct WorldSourceGpuReadbackAcceptanceResult {
    pub gpu_readback: WorldSourceGpuReadbackResult,
    pub drift_gate: WorldSourceDriftGateReport,
}

pub fn evaluate_world_source_gpu_readback_acceptance<S, P>(
    source: &S,
    provider: &P,
    points: &[WorldSourceDriftSamplePoint],
    config: WorldSourceDriftGateConfig,
) -> WorldSourceGpuReadbackAcceptanceResult
where
    S: WorldSource,
    P: WorldSourceGpuReadbackProvider,
{
    let gpu_readback = provider.read_world_source_samples(points);
    let drift_gate =
        evaluate_world_source_cpu_gpu_drift(source, points, gpu_readback.samples(), config);

    WorldSourceGpuReadbackAcceptanceResult {
        gpu_readback,
        drift_gate,
    }
}

pub fn world_source_gpu_readback_acceptance_blockers(
    gpu_readback: &WorldSourceGpuReadbackResult,
    drift_gate: &WorldSourceDriftGateReport,
) -> Vec<&'static str> {
    let mut blockers = Vec::new();
    if gpu_readback.status == WorldSourceGpuReadbackStatus::Unavailable {
        blockers.push("gpu_readback_unavailable");
    }
    if !drift_gate.is_acceptance_pass() {
        blockers.push("drift_gate_not_passed");
    }
    blockers
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{
        GpuWorldSourceDriftReadbackSharedResult, IslandShapeConfig, ProceduralWorldSource,
        StaticWorldSourceGpuReadback, TerrainFieldConfig, WorldSourceDriftGateStatus,
        WorldSourceGpuReadbackStatus, sample_cpu_world_source,
    };

    fn source() -> ProceduralWorldSource {
        ProceduralWorldSource::new(TerrainFieldConfig::new(
            7,
            18.0,
            IslandShapeConfig::default(),
        ))
    }

    #[test]
    fn static_provider_can_pass_drift_gate_with_cpu_matching_samples() {
        let source = source();
        let points = [WorldSourceDriftSamplePoint::new(64.0, 32.0).with_slope(0.7)];
        let samples = points
            .iter()
            .copied()
            .map(|point| sample_cpu_world_source(&source, point))
            .collect();
        let provider = StaticWorldSourceGpuReadback::new(samples);

        let result = evaluate_world_source_gpu_readback_acceptance(
            &source,
            &provider,
            &points,
            WorldSourceDriftGateConfig::default(),
        );

        assert_eq!(
            result.gpu_readback.status,
            WorldSourceGpuReadbackStatus::Available
        );
        assert_eq!(result.drift_gate.status, WorldSourceDriftGateStatus::Passed);
    }

    #[test]
    fn shared_provider_reports_skipped_until_samples_are_available() {
        let source = source();
        let points = [WorldSourceDriftSamplePoint::new(64.0, 32.0).with_slope(0.7)];
        let provider = GpuWorldSourceDriftReadbackSharedResult::default();

        let result = evaluate_world_source_gpu_readback_acceptance(
            &source,
            &provider,
            &points,
            WorldSourceDriftGateConfig::default(),
        );

        assert_eq!(
            result.gpu_readback.status,
            WorldSourceGpuReadbackStatus::Unavailable
        );
        assert_eq!(
            result.drift_gate.status,
            WorldSourceDriftGateStatus::Skipped
        );
    }

    #[test]
    fn unavailable_readback_blocks_acceptance() {
        let source = source();
        let points = [WorldSourceDriftSamplePoint::new(64.0, 32.0).with_slope(0.7)];
        let provider = GpuWorldSourceDriftReadbackSharedResult::default();

        let result = evaluate_world_source_gpu_readback_acceptance(
            &source,
            &provider,
            &points,
            WorldSourceDriftGateConfig::default(),
        );

        assert_eq!(
            world_source_gpu_readback_acceptance_blockers(&result.gpu_readback, &result.drift_gate),
            vec!["gpu_readback_unavailable", "drift_gate_not_passed"]
        );
    }
}
