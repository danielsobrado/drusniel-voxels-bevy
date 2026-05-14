use bevy::prelude::*;

pub const NAADF_DEBUG_TRACE_RAYS_SHADER_PATH: &str = "shaders/naadf/debug_trace_rays.wgsl";
pub const NAADF_DEBUG_TRACE_WORKGROUP_SIZE: u32 = 64;

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct NaadfGpuRayTestPipelineState {
    pub queued_batches: u64,
    pub last_dispatched_rays: u32,
    pub last_readback_rays: u32,
}
