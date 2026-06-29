use bevy::prelude::*;

use super::drift_gate::WorldSourceDriftSamplePoint;
use super::drift_readback::{
    GpuWorldSourceDriftInputSample, build_gpu_world_source_drift_input_samples,
};
use super::drift_readback_render::GpuWorldSourceDriftReadbackRequest;
use super::terrain_bridge::ProceduralWorldSourceTerrainBridge;

pub const WORLD_SOURCE_DRIFT_READBACK_ENABLE_ENV: &str = "VOXEL_WORLD_SOURCE_DRIFT_READBACK";

#[derive(Resource, Debug, Clone)]
pub struct GpuWorldSourceDriftReadbackRequestSettings {
    pub enabled: bool,
    pub points: Vec<WorldSourceDriftSamplePoint>,
}

impl Default for GpuWorldSourceDriftReadbackRequestSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag(WORLD_SOURCE_DRIFT_READBACK_ENABLE_ENV),
            points: default_world_source_drift_readback_points().to_vec(),
        }
    }
}

pub fn default_world_source_drift_readback_points() -> [WorldSourceDriftSamplePoint; 5] {
    [
        WorldSourceDriftSamplePoint::new(0.0, 0.0),
        WorldSourceDriftSamplePoint::new(64.0, 64.0),
        WorldSourceDriftSamplePoint::new(128.0, 32.0).with_slope(0.35),
        WorldSourceDriftSamplePoint::new(192.0, 160.0).with_slope(0.7),
        WorldSourceDriftSamplePoint::new(240.0, 24.0),
    ]
}

pub fn build_world_source_drift_readback_inputs(
    bridge: &ProceduralWorldSourceTerrainBridge,
    points: &[WorldSourceDriftSamplePoint],
) -> Vec<GpuWorldSourceDriftInputSample> {
    build_gpu_world_source_drift_input_samples(bridge.source(), points)
}

pub fn populate_gpu_world_source_drift_readback_request_once(
    settings: Res<GpuWorldSourceDriftReadbackRequestSettings>,
    mut request: ResMut<GpuWorldSourceDriftReadbackRequest>,
    mut populated: Local<bool>,
) {
    if *populated || !settings.enabled {
        return;
    }

    let bridge = ProceduralWorldSourceTerrainBridge::load_or_default();
    request.inputs = build_world_source_drift_readback_inputs(&bridge, &settings.points);
    *populated = true;

    info!(
        "WorldSource drift readback request populated with {} samples",
        request.inputs.len()
    );
    println!(
        "WorldSource drift readback request populated with {} samples",
        request.inputs.len()
    );
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).is_ok_and(|value| value == "1" || value.eq_ignore_ascii_case("true"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_points_match_acceptance_sample_count() {
        assert_eq!(default_world_source_drift_readback_points().len(), 5);
    }

    #[test]
    fn builds_inputs_for_default_points() {
        let bridge = ProceduralWorldSourceTerrainBridge::load_or_default();
        let points = default_world_source_drift_readback_points();
        let inputs = build_world_source_drift_readback_inputs(&bridge, &points);

        assert_eq!(inputs.len(), points.len());
        assert!(inputs.iter().all(|input| input.height.is_finite()));
        assert!(inputs.iter().all(|input| input.biome <= 6));
    }
}
