use serde::{Deserialize, Serialize};

use super::{WorldSourceDriftSample, WorldSourceDriftSamplePoint};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorldSourceGpuReadbackStatus {
    Available,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldSourceGpuReadbackResult {
    pub status: WorldSourceGpuReadbackStatus,
    pub unavailable_reason: Option<String>,
    pub samples: Option<Vec<WorldSourceDriftSample>>,
}

impl WorldSourceGpuReadbackResult {
    pub fn available(samples: Vec<WorldSourceDriftSample>) -> Self {
        Self {
            status: WorldSourceGpuReadbackStatus::Available,
            unavailable_reason: None,
            samples: Some(samples),
        }
    }

    pub fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            status: WorldSourceGpuReadbackStatus::Unavailable,
            unavailable_reason: Some(reason.into()),
            samples: None,
        }
    }

    pub fn samples(&self) -> Option<&[WorldSourceDriftSample]> {
        self.samples.as_deref()
    }
}

pub trait WorldSourceGpuReadbackProvider {
    fn read_world_source_samples(
        &self,
        points: &[WorldSourceDriftSamplePoint],
    ) -> WorldSourceGpuReadbackResult;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct UnavailableWorldSourceGpuReadback;

impl WorldSourceGpuReadbackProvider for UnavailableWorldSourceGpuReadback {
    fn read_world_source_samples(
        &self,
        _points: &[WorldSourceDriftSamplePoint],
    ) -> WorldSourceGpuReadbackResult {
        WorldSourceGpuReadbackResult::unavailable("gpu_readback_unavailable")
    }
}

#[derive(Debug, Clone)]
pub struct StaticWorldSourceGpuReadback {
    samples: Vec<WorldSourceDriftSample>,
}

impl StaticWorldSourceGpuReadback {
    pub fn new(samples: Vec<WorldSourceDriftSample>) -> Self {
        Self { samples }
    }
}

impl WorldSourceGpuReadbackProvider for StaticWorldSourceGpuReadback {
    fn read_world_source_samples(
        &self,
        _points: &[WorldSourceDriftSamplePoint],
    ) -> WorldSourceGpuReadbackResult {
        WorldSourceGpuReadbackResult::available(self.samples.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{BiomeId, MaterialLayerId};

    #[test]
    fn unavailable_provider_returns_no_samples() {
        let result = UnavailableWorldSourceGpuReadback
            .read_world_source_samples(&[WorldSourceDriftSamplePoint::new(0.0, 0.0)]);

        assert_eq!(result.status, WorldSourceGpuReadbackStatus::Unavailable);
        assert_eq!(result.unavailable_reason.as_deref(), Some("gpu_readback_unavailable"));
        assert!(result.samples().is_none());
    }

    #[test]
    fn static_provider_returns_samples_for_gate_tests() {
        let sample = WorldSourceDriftSample {
            x: 0.0,
            z: 0.0,
            height: 18.0,
            ocean_mask: 0.0,
            biome: BiomeId::Meadows,
            dominant_layer: MaterialLayerId::Grass,
        };
        let result = StaticWorldSourceGpuReadback::new(vec![sample])
            .read_world_source_samples(&[WorldSourceDriftSamplePoint::new(0.0, 0.0)]);

        assert_eq!(result.status, WorldSourceGpuReadbackStatus::Available);
        assert_eq!(result.samples(), Some([sample].as_slice()));
    }
}
