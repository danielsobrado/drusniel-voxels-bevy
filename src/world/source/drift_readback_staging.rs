use super::drift_readback::{
    GpuWorldSourceDriftOutputSample, GpuWorldSourceDriftReadbackDispatchPlan,
    WorldSourceGpuReadbackResult, decode_gpu_world_source_drift_outputs,
};

pub fn decode_staged_gpu_world_source_drift_bytes(
    plan: GpuWorldSourceDriftReadbackDispatchPlan,
    bytes: &[u8],
) -> WorldSourceGpuReadbackResult {
    if plan.output_bytes == 0 {
        return WorldSourceGpuReadbackResult::available(Vec::new());
    }
    if bytes.len() < plan.output_bytes {
        return WorldSourceGpuReadbackResult::unavailable(format!(
            "gpu_readback_staging_too_small:{}<{}",
            bytes.len(),
            plan.output_bytes,
        ));
    }

    let raw_outputs = &bytes[..plan.output_bytes];
    let outputs = match bytemuck::try_cast_slice::<u8, GpuWorldSourceDriftOutputSample>(raw_outputs)
    {
        Ok(outputs) => outputs,
        Err(_) => {
            return WorldSourceGpuReadbackResult::unavailable(
                "gpu_readback_staging_layout_mismatch",
            );
        }
    };

    match decode_gpu_world_source_drift_outputs(outputs) {
        Ok(samples) => WorldSourceGpuReadbackResult::available(samples),
        Err(error) => WorldSourceGpuReadbackResult::unavailable(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::source::{BiomeId, MaterialLayerId, WorldSourceGpuReadbackStatus};
    use bytemuck::bytes_of;

    #[test]
    fn zero_sample_plan_decodes_to_available_empty_result() {
        let plan = GpuWorldSourceDriftReadbackDispatchPlan::for_sample_count(0).expect("plan");
        let result = decode_staged_gpu_world_source_drift_bytes(plan, &[]);

        assert_eq!(result.status, WorldSourceGpuReadbackStatus::Available);
        assert_eq!(result.samples().expect("samples"), &[]);
    }

    #[test]
    fn rejects_too_small_staging_data() {
        let plan = GpuWorldSourceDriftReadbackDispatchPlan::for_sample_count(1).expect("plan");
        let result = decode_staged_gpu_world_source_drift_bytes(plan, &[0_u8; 4]);

        assert_eq!(result.status, WorldSourceGpuReadbackStatus::Unavailable);
        assert!(
            result
                .unavailable_reason
                .as_deref()
                .expect("reason")
                .starts_with("gpu_readback_staging_too_small")
        );
    }

    #[test]
    fn decodes_valid_staging_data() {
        let plan = GpuWorldSourceDriftReadbackDispatchPlan::for_sample_count(1).expect("plan");
        let output = GpuWorldSourceDriftOutputSample {
            x: 12.0,
            z: 24.0,
            height: 36.0,
            ocean_mask: 0.5,
            biome: BiomeId::Forest.layer_index(),
            dominant_layer: MaterialLayerId::ForestFloor as u32,
            _pad0: 0,
            _pad1: 0,
        };
        let result = decode_staged_gpu_world_source_drift_bytes(plan, bytes_of(&output));
        let sample = &result.samples().expect("samples")[0];

        assert_eq!(result.status, WorldSourceGpuReadbackStatus::Available);
        assert_eq!(sample.biome, BiomeId::Forest);
        assert_eq!(sample.dominant_layer, MaterialLayerId::ForestFloor);
    }
}
