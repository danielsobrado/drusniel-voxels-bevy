use std::borrow::Cow;

use bevy::prelude::*;
use bevy::render::render_graph::{NodeRunError, RenderGraphContext, ViewNode};
use bevy::render::render_resource::*;
use bevy::render::renderer::{RenderContext, RenderDevice, RenderQueue};

use super::drift_readback::{
    GpuWorldSourceDriftInputSample, GpuWorldSourceDriftOutputSample,
    GpuWorldSourceDriftReadbackDispatchPlan, GpuWorldSourceDriftReadbackParams,
    WorldSourceGpuReadbackResult, WORLD_SOURCE_DRIFT_READBACK_SHADER_PATH,
};

#[derive(Resource, Debug, Clone, Default)]
pub struct GpuWorldSourceDriftReadbackRequest {
    pub inputs: Vec<GpuWorldSourceDriftInputSample>,
}

impl GpuWorldSourceDriftReadbackRequest {
    pub fn new(inputs: Vec<GpuWorldSourceDriftInputSample>) -> Self {
        Self { inputs }
    }

    pub fn is_empty(&self) -> bool {
        self.inputs.is_empty()
    }
}

#[derive(Resource, Debug, Clone)]
pub struct GpuWorldSourceDriftReadbackState {
    pub latest_result: WorldSourceGpuReadbackResult,
    pub latest_plan: Option<GpuWorldSourceDriftReadbackDispatchPlan>,
}

impl Default for GpuWorldSourceDriftReadbackState {
    fn default() -> Self {
        Self {
            latest_result: WorldSourceGpuReadbackResult::unavailable("gpu_readback_not_dispatched"),
            latest_plan: None,
        }
    }
}

#[derive(Resource)]
pub struct GpuWorldSourceDriftReadbackPipeline {
    pub pipeline_id: CachedComputePipelineId,
    pub bind_group_layout: BindGroupLayout,
}

#[derive(Resource, Default)]
pub struct GpuWorldSourceDriftReadbackBuffers {
    pub params_buffer: Option<Buffer>,
    pub input_buffer: Option<Buffer>,
    pub output_buffer: Option<Buffer>,
    pub staging_buffer: Option<Buffer>,
    pub bind_group: Option<BindGroup>,
    pub plan: Option<GpuWorldSourceDriftReadbackDispatchPlan>,
    pub ready: bool,
}

impl GpuWorldSourceDriftReadbackBuffers {
    fn clear(&mut self) {
        self.bind_group = None;
        self.plan = None;
        self.ready = false;
    }
}

pub fn prepare_gpu_world_source_drift_readback_dispatch(
    request: Option<Res<GpuWorldSourceDriftReadbackRequest>>,
    pipeline: Option<Res<GpuWorldSourceDriftReadbackPipeline>>,
    mut buffers: ResMut<GpuWorldSourceDriftReadbackBuffers>,
    mut state: ResMut<GpuWorldSourceDriftReadbackState>,
    render_device: Res<RenderDevice>,
    render_queue: Res<RenderQueue>,
) {
    let Some(request) = request else {
        buffers.clear();
        state.latest_result = WorldSourceGpuReadbackResult::unavailable("gpu_readback_no_request");
        return;
    };
    let Some(pipeline) = pipeline else {
        buffers.clear();
        state.latest_result = WorldSourceGpuReadbackResult::unavailable("gpu_readback_pipeline_unavailable");
        return;
    };
    if request.is_empty() {
        buffers.clear();
        state.latest_result = WorldSourceGpuReadbackResult::available(Vec::new());
        return;
    }

    let Ok(plan) = GpuWorldSourceDriftReadbackDispatchPlan::for_sample_count(request.inputs.len()) else {
        buffers.clear();
        state.latest_result = WorldSourceGpuReadbackResult::unavailable("gpu_readback_plan_failed");
        return;
    };

    ensure_readback_buffers(&render_device, &mut buffers, plan);

    let Some(params_buffer) = buffers.params_buffer.clone() else { return };
    let Some(input_buffer) = buffers.input_buffer.clone() else { return };
    let Some(output_buffer) = buffers.output_buffer.clone() else { return };

    let params = GpuWorldSourceDriftReadbackParams {
        sample_count: plan.sample_count,
        _pad0: 0,
        _pad1: 0,
        _pad2: 0,
    };
    render_queue.write_buffer(&params_buffer, 0, bytemuck::bytes_of(&params));
    render_queue.write_buffer(&input_buffer, 0, bytemuck::cast_slice(&request.inputs));

    buffers.bind_group = Some(render_device.create_bind_group(
        Some("world_source_drift_readback_bg0"),
        &pipeline.bind_group_layout,
        &BindGroupEntries::sequential((
            params_buffer.as_entire_binding(),
            input_buffer.as_entire_binding(),
            output_buffer.as_entire_binding(),
        )),
    ));
    buffers.plan = Some(plan);
    buffers.ready = true;
    state.latest_plan = Some(plan);
    state.latest_result = WorldSourceGpuReadbackResult::unavailable("gpu_readback_dispatch_pending_map");
}

fn ensure_readback_buffers(
    render_device: &RenderDevice,
    buffers: &mut GpuWorldSourceDriftReadbackBuffers,
    plan: GpuWorldSourceDriftReadbackDispatchPlan,
) {
    let params_size = plan.params_bytes as u64;
    if buffers.params_buffer.as_ref().is_none_or(|buffer| buffer.size() < params_size) {
        buffers.params_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("world_source_drift_readback_params"),
            size: params_size,
            usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
    }

    let input_size = plan.input_bytes as u64;
    if buffers.input_buffer.as_ref().is_none_or(|buffer| buffer.size() < input_size) {
        buffers.input_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("world_source_drift_readback_input"),
            size: input_size,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
    }

    let output_size = plan.output_bytes as u64;
    if buffers.output_buffer.as_ref().is_none_or(|buffer| buffer.size() < output_size) {
        buffers.output_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("world_source_drift_readback_output"),
            size: output_size,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        }));
    }
    if buffers.staging_buffer.as_ref().is_none_or(|buffer| buffer.size() < output_size) {
        buffers.staging_buffer = Some(render_device.create_buffer(&BufferDescriptor {
            label: Some("world_source_drift_readback_staging"),
            size: output_size,
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }));
    }
}

#[derive(Default)]
pub struct GpuWorldSourceDriftReadbackNode;

impl ViewNode for GpuWorldSourceDriftReadbackNode {
    type ViewQuery = ();

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        _view: (),
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        let pipeline_res = world.resource::<GpuWorldSourceDriftReadbackPipeline>();
        let buffers = world.resource::<GpuWorldSourceDriftReadbackBuffers>();
        let pipeline_cache = world.resource::<PipelineCache>();

        if !buffers.ready {
            return Ok(());
        }
        let Some(plan) = buffers.plan else {
            return Ok(());
        };
        if plan.workgroup_count == 0 {
            return Ok(());
        }
        let Some(pipeline) = pipeline_cache.get_compute_pipeline(pipeline_res.pipeline_id) else {
            return Ok(());
        };
        let Some(bind_group) = buffers.bind_group.as_ref() else {
            return Ok(());
        };
        let Some(output_buffer) = buffers.output_buffer.as_ref() else {
            return Ok(());
        };
        let Some(staging_buffer) = buffers.staging_buffer.as_ref() else {
            return Ok(());
        };

        let mut pass = render_context
            .command_encoder()
            .begin_compute_pass(&ComputePassDescriptor {
                label: Some("world_source_drift_readback_pass"),
                timestamp_writes: None,
            });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, bind_group, &[]);
        pass.dispatch_workgroups(plan.workgroup_count, 1, 1);
        drop(pass);

        render_context.command_encoder().copy_buffer_to_buffer(
            output_buffer,
            0,
            staging_buffer,
            0,
            plan.output_bytes as u64,
        );
        Ok(())
    }
}

pub fn init_gpu_world_source_drift_readback_pipeline(
    mut commands: Commands,
    render_device: Res<RenderDevice>,
    pipeline_cache: Res<PipelineCache>,
    asset_server: Res<AssetServer>,
) {
    let shader: Handle<Shader> = asset_server.load(WORLD_SOURCE_DRIFT_READBACK_SHADER_PATH);
    let bg_entries: Vec<BindGroupLayoutEntry> = BindGroupLayoutEntries::sequential(
        ShaderStages::COMPUTE,
        (
            binding_types::uniform_buffer::<GpuWorldSourceDriftReadbackParams>(false),
            binding_types::storage_buffer_sized(false, None),
            binding_types::storage_buffer_sized(false, None),
        ),
    )
    .to_vec();
    let bind_group_layout = render_device.create_bind_group_layout(
        Some("world_source_drift_readback_bg_layout_0"),
        &bg_entries,
    );
    let pipeline_id = pipeline_cache.queue_compute_pipeline(ComputePipelineDescriptor {
        label: Some(Cow::Borrowed("world_source_drift_readback_pipeline")),
        layout: vec![BindGroupLayoutDescriptor {
            label: Cow::Borrowed("world_source_drift_readback_bg_layout_0"),
            entries: bg_entries,
        }],
        push_constant_ranges: vec![],
        shader,
        shader_defs: vec![],
        entry_point: Some(Cow::Borrowed("main")),
        zero_initialize_workgroup_memory: false,
    });

    commands.insert_resource(GpuWorldSourceDriftReadbackPipeline {
        pipeline_id,
        bind_group_layout,
    });
    commands.insert_resource(GpuWorldSourceDriftReadbackBuffers::default());
    commands.insert_resource(GpuWorldSourceDriftReadbackState::default());
}

pub fn decode_staged_gpu_world_source_drift_readback(
    _buffers: Res<GpuWorldSourceDriftReadbackBuffers>,
    mut state: ResMut<GpuWorldSourceDriftReadbackState>,
) {
    if state.latest_result.status == super::drift_readback::WorldSourceGpuReadbackStatus::Unavailable
        && state.latest_result.unavailable_reason.as_deref() == Some("gpu_readback_dispatch_pending_map")
    {
        state.latest_result = WorldSourceGpuReadbackResult::unavailable("gpu_readback_map_not_implemented");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_empty_when_no_inputs() {
        assert!(GpuWorldSourceDriftReadbackRequest::default().is_empty());
    }

    #[test]
    fn default_state_is_explicitly_unavailable() {
        let state = GpuWorldSourceDriftReadbackState::default();

        assert_eq!(
            state.latest_result.unavailable_reason.as_deref(),
            Some("gpu_readback_not_dispatched")
        );
    }
}
