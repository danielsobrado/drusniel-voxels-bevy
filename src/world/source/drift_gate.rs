use serde::{Deserialize, Serialize};

use super::{BiomeId, MaterialLayerId, WorldSource, sample_biome_splat};

pub const WORLD_SOURCE_DRIFT_HEIGHT_TOLERANCE_M: f32 = 0.75;
pub const WORLD_SOURCE_DRIFT_OCEAN_MASK_TOLERANCE: f32 = 0.01;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WorldSourceDriftGateConfig {
    pub height_tolerance_m: f32,
    pub ocean_mask_tolerance: f32,
}

impl Default for WorldSourceDriftGateConfig {
    fn default() -> Self {
        Self {
            height_tolerance_m: WORLD_SOURCE_DRIFT_HEIGHT_TOLERANCE_M,
            ocean_mask_tolerance: WORLD_SOURCE_DRIFT_OCEAN_MASK_TOLERANCE,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WorldSourceDriftSamplePoint {
    pub x: f32,
    pub z: f32,
    pub slope: f32,
}

impl WorldSourceDriftSamplePoint {
    pub fn new(x: f32, z: f32) -> Self {
        Self { x, z, slope: 0.0 }
    }

    pub fn with_slope(mut self, slope: f32) -> Self {
        self.slope = slope;
        self
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WorldSourceDriftSample {
    pub x: f32,
    pub z: f32,
    pub height: f32,
    pub ocean_mask: f32,
    pub biome: BiomeId,
    pub dominant_layer: MaterialLayerId,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorldSourceDriftGateStatus {
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorldSourceDriftFailureKind {
    Height,
    OceanMask,
    Biome,
    DominantLayer,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldSourceDriftFailure {
    pub sample_index: usize,
    pub kind: WorldSourceDriftFailureKind,
    pub cpu: WorldSourceDriftSample,
    pub gpu: WorldSourceDriftSample,
    pub delta: f32,
    pub tolerance: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorldSourceDriftGateReport {
    pub status: WorldSourceDriftGateStatus,
    pub sample_count: usize,
    pub compared_count: usize,
    pub skipped_reason: Option<String>,
    pub failures: Vec<WorldSourceDriftFailure>,
}

impl WorldSourceDriftGateReport {
    pub fn is_acceptance_pass(&self) -> bool {
        self.status == WorldSourceDriftGateStatus::Passed
    }
}

pub fn sample_cpu_world_source<S: WorldSource>(
    source: &S,
    point: WorldSourceDriftSamplePoint,
) -> WorldSourceDriftSample {
    let height = source.sample_height(point.x, point.z);
    let biome = source.sample_biome(point.x, point.z);
    let dominant_layer =
        sample_biome_splat(biome, height, source.metadata().sea_level, point.slope)
            .dominant_layer();

    WorldSourceDriftSample {
        x: point.x,
        z: point.z,
        height,
        ocean_mask: source.ocean_mask(point.x, point.z),
        biome,
        dominant_layer,
    }
}

pub fn evaluate_world_source_drift_gate(
    cpu_samples: &[WorldSourceDriftSample],
    gpu_samples: Option<&[WorldSourceDriftSample]>,
    config: WorldSourceDriftGateConfig,
) -> WorldSourceDriftGateReport {
    let Some(gpu_samples) = gpu_samples else {
        return WorldSourceDriftGateReport {
            status: WorldSourceDriftGateStatus::Skipped,
            sample_count: cpu_samples.len(),
            compared_count: 0,
            skipped_reason: Some("gpu_readback_unavailable".to_string()),
            failures: Vec::new(),
        };
    };

    if gpu_samples.len() != cpu_samples.len() {
        return WorldSourceDriftGateReport {
            status: WorldSourceDriftGateStatus::Failed,
            sample_count: cpu_samples.len(),
            compared_count: gpu_samples.len().min(cpu_samples.len()),
            skipped_reason: None,
            failures: vec![WorldSourceDriftFailure {
                sample_index: gpu_samples.len().min(cpu_samples.len()),
                kind: WorldSourceDriftFailureKind::Height,
                cpu: cpu_samples
                    .first()
                    .copied()
                    .unwrap_or(WorldSourceDriftSample {
                        x: 0.0,
                        z: 0.0,
                        height: 0.0,
                        ocean_mask: 0.0,
                        biome: BiomeId::Meadows,
                        dominant_layer: MaterialLayerId::Grass,
                    }),
                gpu: gpu_samples
                    .first()
                    .copied()
                    .unwrap_or(WorldSourceDriftSample {
                        x: 0.0,
                        z: 0.0,
                        height: 0.0,
                        ocean_mask: 0.0,
                        biome: BiomeId::Meadows,
                        dominant_layer: MaterialLayerId::Grass,
                    }),
                delta: (gpu_samples.len() as i64 - cpu_samples.len() as i64).unsigned_abs() as f32,
                tolerance: 0.0,
            }],
        };
    }

    let mut failures = Vec::new();
    for (index, (&cpu, &gpu)) in cpu_samples.iter().zip(gpu_samples.iter()).enumerate() {
        let height_delta = (cpu.height - gpu.height).abs();
        if height_delta > config.height_tolerance_m {
            failures.push(WorldSourceDriftFailure {
                sample_index: index,
                kind: WorldSourceDriftFailureKind::Height,
                cpu,
                gpu,
                delta: height_delta,
                tolerance: config.height_tolerance_m,
            });
        }

        let ocean_mask_delta = (cpu.ocean_mask - gpu.ocean_mask).abs();
        if ocean_mask_delta > config.ocean_mask_tolerance {
            failures.push(WorldSourceDriftFailure {
                sample_index: index,
                kind: WorldSourceDriftFailureKind::OceanMask,
                cpu,
                gpu,
                delta: ocean_mask_delta,
                tolerance: config.ocean_mask_tolerance,
            });
        }

        if cpu.biome != gpu.biome {
            failures.push(WorldSourceDriftFailure {
                sample_index: index,
                kind: WorldSourceDriftFailureKind::Biome,
                cpu,
                gpu,
                delta: 1.0,
                tolerance: 0.0,
            });
        }

        if cpu.dominant_layer != gpu.dominant_layer {
            failures.push(WorldSourceDriftFailure {
                sample_index: index,
                kind: WorldSourceDriftFailureKind::DominantLayer,
                cpu,
                gpu,
                delta: 1.0,
                tolerance: 0.0,
            });
        }
    }

    WorldSourceDriftGateReport {
        status: if failures.is_empty() {
            WorldSourceDriftGateStatus::Passed
        } else {
            WorldSourceDriftGateStatus::Failed
        },
        sample_count: cpu_samples.len(),
        compared_count: gpu_samples.len(),
        skipped_reason: None,
        failures,
    }
}

pub fn evaluate_world_source_cpu_gpu_drift<S: WorldSource>(
    source: &S,
    points: &[WorldSourceDriftSamplePoint],
    gpu_samples: Option<&[WorldSourceDriftSample]>,
    config: WorldSourceDriftGateConfig,
) -> WorldSourceDriftGateReport {
    let cpu_samples: Vec<_> = points
        .iter()
        .copied()
        .map(|point| sample_cpu_world_source(source, point))
        .collect();
    evaluate_world_source_drift_gate(&cpu_samples, gpu_samples, config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{IslandShapeConfig, ProceduralWorldSource, TerrainFieldConfig};

    fn source() -> ProceduralWorldSource {
        ProceduralWorldSource::new(TerrainFieldConfig::new(
            7,
            18.0,
            IslandShapeConfig::default(),
        ))
    }

    fn points() -> [WorldSourceDriftSamplePoint; 4] {
        [
            WorldSourceDriftSamplePoint::new(0.0, 0.0),
            WorldSourceDriftSamplePoint::new(420.0, 0.0),
            WorldSourceDriftSamplePoint::new(-840.0, 420.0).with_slope(0.7),
            WorldSourceDriftSamplePoint::new(1260.0, -420.0),
        ]
    }

    #[test]
    fn missing_gpu_readback_is_skipped_not_passed() {
        let report = evaluate_world_source_cpu_gpu_drift(
            &source(),
            &points(),
            None,
            WorldSourceDriftGateConfig::default(),
        );

        assert_eq!(report.status, WorldSourceDriftGateStatus::Skipped);
        assert!(!report.is_acceptance_pass());
        assert_eq!(
            report.skipped_reason.as_deref(),
            Some("gpu_readback_unavailable")
        );
    }

    #[test]
    fn identical_gpu_readback_passes() {
        let source = source();
        let points = points();
        let gpu_samples: Vec<_> = points
            .iter()
            .copied()
            .map(|point| sample_cpu_world_source(&source, point))
            .collect();

        let report = evaluate_world_source_cpu_gpu_drift(
            &source,
            &points,
            Some(&gpu_samples),
            WorldSourceDriftGateConfig::default(),
        );

        assert_eq!(report.status, WorldSourceDriftGateStatus::Passed);
        assert!(report.is_acceptance_pass());
        assert!(report.failures.is_empty());
    }

    #[test]
    fn biome_and_dominant_layer_mismatches_fail_exactly() {
        let source = source();
        let points = points();
        let mut gpu_samples: Vec<_> = points
            .iter()
            .copied()
            .map(|point| sample_cpu_world_source(&source, point))
            .collect();
        gpu_samples[0].biome = BiomeId::Ocean;
        gpu_samples[0].dominant_layer = MaterialLayerId::OceanBed;

        let report = evaluate_world_source_cpu_gpu_drift(
            &source,
            &points,
            Some(&gpu_samples),
            WorldSourceDriftGateConfig::default(),
        );

        assert_eq!(report.status, WorldSourceDriftGateStatus::Failed);
        assert!(
            report
                .failures
                .iter()
                .any(|failure| failure.kind == WorldSourceDriftFailureKind::Biome)
        );
        assert!(
            report
                .failures
                .iter()
                .any(|failure| failure.kind == WorldSourceDriftFailureKind::DominantLayer)
        );
    }

    #[test]
    fn numeric_tolerance_failures_are_explicit() {
        let source = source();
        let points = points();
        let mut gpu_samples: Vec<_> = points
            .iter()
            .copied()
            .map(|point| sample_cpu_world_source(&source, point))
            .collect();
        gpu_samples[0].height += WORLD_SOURCE_DRIFT_HEIGHT_TOLERANCE_M + 0.1;
        gpu_samples[1].ocean_mask += WORLD_SOURCE_DRIFT_OCEAN_MASK_TOLERANCE + 0.01;

        let report = evaluate_world_source_cpu_gpu_drift(
            &source,
            &points,
            Some(&gpu_samples),
            WorldSourceDriftGateConfig::default(),
        );

        assert_eq!(report.status, WorldSourceDriftGateStatus::Failed);
        assert!(
            report
                .failures
                .iter()
                .any(|failure| failure.kind == WorldSourceDriftFailureKind::Height)
        );
        assert!(
            report
                .failures
                .iter()
                .any(|failure| failure.kind == WorldSourceDriftFailureKind::OceanMask)
        );
    }
}
