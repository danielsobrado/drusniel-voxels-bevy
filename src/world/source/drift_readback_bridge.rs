use std::sync::{Arc, Mutex};

use bevy::prelude::*;

use super::drift_gate::WorldSourceDriftSamplePoint;
use super::drift_readback::{WorldSourceGpuReadbackProvider, WorldSourceGpuReadbackResult};
use super::drift_readback_render::GpuWorldSourceDriftReadbackState;

#[derive(Resource, Debug, Clone)]
pub struct GpuWorldSourceDriftReadbackSharedResult {
    inner: Arc<Mutex<WorldSourceGpuReadbackResult>>,
}

impl Default for GpuWorldSourceDriftReadbackSharedResult {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(WorldSourceGpuReadbackResult::unavailable(
                "gpu_readback_not_dispatched",
            ))),
        }
    }
}

impl GpuWorldSourceDriftReadbackSharedResult {
    pub fn latest(&self) -> WorldSourceGpuReadbackResult {
        self.inner
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| {
                WorldSourceGpuReadbackResult::unavailable("gpu_readback_result_lock_poisoned")
            })
    }

    pub fn store(&self, result: WorldSourceGpuReadbackResult) {
        if let Ok(mut guard) = self.inner.lock() {
            *guard = result;
        }
    }

    pub fn has_matching_samples(&self, expected_count: usize) -> bool {
        self.latest()
            .samples()
            .is_some_and(|samples| samples.len() == expected_count)
    }

    pub fn matching_provider_result(
        &self,
        points: &[WorldSourceDriftSamplePoint],
    ) -> WorldSourceGpuReadbackResult {
        let result = self.latest();
        match result.samples() {
            Some(samples) if samples.len() == points.len() => result,
            Some(_) => {
                WorldSourceGpuReadbackResult::unavailable("gpu_readback_sample_count_mismatch")
            }
            None => result,
        }
    }
}

impl WorldSourceGpuReadbackProvider for GpuWorldSourceDriftReadbackSharedResult {
    fn read_world_source_samples(
        &self,
        points: &[WorldSourceDriftSamplePoint],
    ) -> WorldSourceGpuReadbackResult {
        self.matching_provider_result(points)
    }
}

pub fn publish_gpu_world_source_drift_readback_result(
    state: Res<GpuWorldSourceDriftReadbackState>,
    shared: Res<GpuWorldSourceDriftReadbackSharedResult>,
) {
    if state.is_changed() {
        shared.store(state.latest_result.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{BiomeId, MaterialLayerId, WorldSourceDriftSample};

    #[test]
    fn default_shared_result_is_unavailable() {
        let shared = GpuWorldSourceDriftReadbackSharedResult::default();

        assert_eq!(
            shared.latest().unavailable_reason.as_deref(),
            Some("gpu_readback_not_dispatched")
        );
    }

    #[test]
    fn shared_result_provider_returns_matching_samples() {
        let sample = WorldSourceDriftSample {
            x: 0.0,
            z: 0.0,
            height: 18.0,
            ocean_mask: 0.0,
            biome: BiomeId::Meadows,
            dominant_layer: MaterialLayerId::Grass,
        };
        let shared = GpuWorldSourceDriftReadbackSharedResult::default();
        shared.store(WorldSourceGpuReadbackResult::available(vec![sample]));

        let result =
            shared.read_world_source_samples(&[WorldSourceDriftSamplePoint::new(0.0, 0.0)]);

        assert_eq!(result.samples().expect("samples"), &[sample]);
    }

    #[test]
    fn shared_result_provider_rejects_mismatched_sample_count() {
        let shared = GpuWorldSourceDriftReadbackSharedResult::default();
        shared.store(WorldSourceGpuReadbackResult::available(Vec::new()));

        let result =
            shared.read_world_source_samples(&[WorldSourceDriftSamplePoint::new(0.0, 0.0)]);

        assert_eq!(
            result.unavailable_reason.as_deref(),
            Some("gpu_readback_sample_count_mismatch")
        );
    }

    #[test]
    fn reports_matching_sample_readiness() {
        let sample = WorldSourceDriftSample {
            x: 0.0,
            z: 0.0,
            height: 18.0,
            ocean_mask: 0.0,
            biome: BiomeId::Meadows,
            dominant_layer: MaterialLayerId::Grass,
        };
        let shared = GpuWorldSourceDriftReadbackSharedResult::default();

        assert!(!shared.has_matching_samples(1));
        shared.store(WorldSourceGpuReadbackResult::available(vec![sample]));
        assert!(shared.has_matching_samples(1));
        assert!(!shared.has_matching_samples(2));
    }
}
