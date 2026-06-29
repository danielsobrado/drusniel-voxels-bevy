use bytemuck::{Pod, Zeroable};
use serde::{Deserialize, Serialize};

use super::{BiomeId, MaterialLayerId, WorldSourceDriftSample, WorldSourceDriftSamplePoint};

pub const WORLD_SOURCE_DRIFT_READBACK_SHADER_PATH: &str = "shaders/world_source/drift_readback.wgsl";
pub const WORLD_SOURCE_DRIFT_READBACK_WORKGROUP_SIZE: u32 = 64;

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct GpuWorldSourceDriftReadbackParams {
    pub sample_count: u32,
    pub _pad0: u32,
    pub _pad1: u32,
    pub _pad2: u32,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct GpuWorldSourceDriftInputSample {
    pub x: f32,
    pub z: f32,
    pub slope: f32,
    pub sea_level: f32,
    pub height: f32,
    pub ocean_mask: f32,
    pub biome: u32,
    pub _pad0: u32,
}

impl GpuWorldSourceDriftInputSample {
    pub fn from_cpu_sample(sample: WorldSourceDriftSample, slope: f32, sea_level: f32) -> Self {
        Self {
            x: sample.x,
            z: sample.z,
            slope,
            sea_level,
            height: sample.height,
            ocean_mask: sample.ocean_mask,
            biome: sample.biome.layer_index(),
            _pad0: 0,
        }
    }
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct GpuWorldSourceDriftOutputSample {
    pub x: f32,
    pub z: f32,
    pub height: f32,
    pub ocean_mask: f32,
    pub biome: u32,
    pub dominant_layer: u32,
    pub _pad0: u32,
    pub _pad1: u32,
}

impl GpuWorldSourceDriftOutputSample {
    pub fn to_drift_sample(self) -> Option<WorldSourceDriftSample> {
        Some(WorldSourceDriftSample {
            x: self.x,
            z: self.z,
            height: self.height,
            ocean_mask: self.ocean_mask,
            biome: biome_from_u32(self.biome)?,
            dominant_layer: material_layer_from_u32(self.dominant_layer)?,
        })
    }
}

fn biome_from_u32(value: u32) -> Option<BiomeId> {
    match value {
        0 => Some(BiomeId::Meadows),
        1 => Some(BiomeId::Forest),
        2 => Some(BiomeId::Swamp),
        3 => Some(BiomeId::Mountain),
        4 => Some(BiomeId::Plains),
        5 => Some(BiomeId::Coast),
        6 => Some(BiomeId::Ocean),
        _ => None,
    }
}

fn material_layer_from_u32(value: u32) -> Option<MaterialLayerId> {
    match value {
        0 => Some(MaterialLayerId::Grass),
        1 => Some(MaterialLayerId::ForestFloor),
        2 => Some(MaterialLayerId::Mud),
        3 => Some(MaterialLayerId::Rock),
        4 => Some(MaterialLayerId::DryGrass),
        5 => Some(MaterialLayerId::Sand),
        6 => Some(MaterialLayerId::OceanBed),
        _ => None,
    }
}

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
    use std::mem::size_of;

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

    #[test]
    fn gpu_wire_struct_sizes_match_wgsl_contract() {
        assert_eq!(size_of::<GpuWorldSourceDriftReadbackParams>(), 16);
        assert_eq!(size_of::<GpuWorldSourceDriftInputSample>(), 32);
        assert_eq!(size_of::<GpuWorldSourceDriftOutputSample>(), 32);
    }

    #[test]
    fn gpu_output_decodes_to_drift_sample() {
        let sample = GpuWorldSourceDriftOutputSample {
            x: 1.0,
            z: 2.0,
            height: 18.0,
            ocean_mask: 0.5,
            biome: 6,
            dominant_layer: 6,
            _pad0: 0,
            _pad1: 0,
        }
        .to_drift_sample()
        .expect("valid gpu output");

        assert_eq!(sample.biome, BiomeId::Ocean);
        assert_eq!(sample.dominant_layer, MaterialLayerId::OceanBed);
    }

    #[test]
    fn invalid_gpu_output_is_rejected() {
        let output = GpuWorldSourceDriftOutputSample {
            biome: 99,
            dominant_layer: 0,
            ..GpuWorldSourceDriftOutputSample::zeroed()
        };

        assert!(output.to_drift_sample().is_none());
    }
}
