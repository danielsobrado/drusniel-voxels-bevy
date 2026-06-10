use bevy::prelude::*;
use bevy::render::MainWorld;
use bevy::render::render_graph::{NodeRunError, RenderGraphContext, RenderLabel, ViewNode};
use bevy::render::render_resource::{
    BindGroupEntries, BindGroupLayoutDescriptor, BindGroupLayoutEntry, BindingType, Buffer,
    BufferBindingType, BufferInitDescriptor, BufferUsages, CachedComputePipelineId,
    ComputePassDescriptor, ComputePipelineDescriptor, PipelineCache, ShaderStages,
};
use bevy::render::renderer::{RenderContext, RenderDevice, RenderQueue};
use bevy::render::view::ExtractedView;
use std::borrow::Cow;

use crate::environment::Sun;
use crate::rendering::god_rays::GodRayFroxelParams;
use crate::rendering::naadf::config::NaadfConfig;
use crate::rendering::naadf::gpu_buffers::{ExtractedNaadfGpuUploads, NaadfGpuBuffers};
use crate::rendering::naadf::pipeline::NAADF_FROXEL_SUN_MASK_SHADER_HANDLE;
use crate::rendering::naadf::stats::NaadfStats;

pub const NAADF_FROXEL_SUN_MASK_WORKGROUP_SIZE: u32 = 64;

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq)]
pub struct NaadfFroxelSunMaskState {
    pub active: bool,
    pub resolution: UVec3,
    pub rays_per_full_update: u64,
    pub max_rays_per_frame: u32,
    pub frames_per_full_update: u32,
    pub max_distance: f32,
    pub max_ray_steps: u32,
    pub sun_direction: Vec3,
}

pub fn sync_naadf_froxel_sun_mask_state(
    config: Res<NaadfConfig>,
    mut state: ResMut<NaadfFroxelSunMaskState>,
    mut stats: ResMut<NaadfStats>,
    sun_query: Query<&Transform, With<Sun>>,
) {
    let resolution = config.froxel_sun_mask.resolution_uvec3();
    let rays_per_full_update = froxel_ray_count(resolution);
    let max_rays_per_frame = config.froxel_sun_mask.max_rays_per_frame.max(1);
    let frames_per_full_update = rays_per_full_update
        .div_ceil(max_rays_per_frame as u64)
        .min(u32::MAX as u64) as u32;
    let active = config.enabled
        && config.use_for_sun_visibility
        && config.froxel_sun_mask.enabled
        && config.debug.allow_unverified_post_205
        && rays_per_full_update > 0;
    let light_direction = sun_query
        .iter()
        .next()
        .map(|transform| -transform.forward().as_vec3())
        .unwrap_or(Vec3::new(0.3, 1.0, 0.2).normalize());

    *state = NaadfFroxelSunMaskState {
        active,
        resolution,
        rays_per_full_update,
        max_rays_per_frame,
        frames_per_full_update,
        max_distance: config.froxel_sun_mask.max_distance.max(1.0),
        max_ray_steps: config.preview.max_ray_steps.max(1),
        sun_direction: normalize_or_y(light_direction),
    };
    stats.froxel_sun_mask_active = active as u32;
    stats.froxel_sun_mask_rays_per_full_update = rays_per_full_update;
    stats.froxel_sun_mask_max_rays_per_frame = if active { max_rays_per_frame } else { 0 };
    stats.froxel_sun_mask_frames_per_full_update = if active { frames_per_full_update } else { 0 };
}

pub fn froxel_ray_count(resolution: UVec3) -> u64 {
    resolution.x as u64 * resolution.y as u64 * resolution.z as u64
}

#[derive(Resource, Clone, Copy, Debug, Default, PartialEq)]
pub struct ExtractedNaadfFroxelSunMaskState {
    pub active: bool,
    pub resolution: UVec3,
    pub rays_per_full_update: u64,
    pub max_rays_per_frame: u32,
    pub max_distance: f32,
    pub max_ray_steps: u32,
    pub sun_direction: Vec3,
}

impl From<NaadfFroxelSunMaskState> for ExtractedNaadfFroxelSunMaskState {
    fn from(state: NaadfFroxelSunMaskState) -> Self {
        Self {
            active: state.active,
            resolution: state.resolution,
            rays_per_full_update: state.rays_per_full_update,
            max_rays_per_frame: state.max_rays_per_frame,
            max_distance: state.max_distance,
            max_ray_steps: state.max_ray_steps,
            sun_direction: state.sun_direction,
        }
    }
}

pub fn extract_naadf_froxel_sun_mask_state(mut commands: Commands, main_world: Res<MainWorld>) {
    commands.insert_resource(
        main_world
            .get_resource::<NaadfFroxelSunMaskState>()
            .copied()
            .map(ExtractedNaadfFroxelSunMaskState::from)
            .unwrap_or_default(),
    );
}

#[derive(Resource, Default)]
pub struct NaadfFroxelSunMaskGpuState {
    allocation: Option<NaadfFroxelSunMaskGpuAllocation>,
    active: bool,
    dispatch_rays: u32,
    next_ray_offset: u32,
}

pub struct NaadfFroxelSunMaskGpuAllocation {
    resolution: UVec3,
    pub params_buffer: Buffer,
    pub mask_buffer: Buffer,
}

impl NaadfFroxelSunMaskGpuState {
    pub fn ready_for_god_rays(&self) -> bool {
        self.active && self.allocation.is_some()
    }

    pub fn params_buffer(&self) -> Option<&Buffer> {
        self.allocation
            .as_ref()
            .map(|allocation| &allocation.params_buffer)
    }

    pub fn mask_buffer(&self) -> Option<&Buffer> {
        self.allocation
            .as_ref()
            .map(|allocation| &allocation.mask_buffer)
    }

    fn active_dispatch(&self) -> Option<(&NaadfFroxelSunMaskGpuAllocation, u32)> {
        self.allocation
            .as_ref()
            .filter(|_| self.active && self.dispatch_rays > 0)
            .map(|allocation| (allocation, self.dispatch_rays))
    }

    fn reset_dispatch(&mut self) {
        self.active = false;
        self.dispatch_rays = 0;
        self.next_ray_offset = 0;
    }
}

#[derive(Resource)]
pub struct NaadfFroxelSunMaskPipeline {
    empty_group_layout: BindGroupLayoutDescriptor,
    layout: BindGroupLayoutDescriptor,
    pipeline: CachedComputePipelineId,
}

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct NaadfFroxelSunMaskLabel;

pub fn init_naadf_froxel_sun_mask_pipeline(
    mut commands: Commands,
    pipeline_cache: Res<PipelineCache>,
) {
    let empty_group_layout = BindGroupLayoutDescriptor::new("naadf_froxel_empty_group_layout", &[]);
    let layout = BindGroupLayoutDescriptor::new(
        "naadf_froxel_sun_mask_layout",
        &[
            storage_buffer_entry(0, true),
            storage_buffer_entry(1, true),
            storage_buffer_entry(5, true),
            storage_buffer_entry(6, true),
            storage_buffer_entry(7, true),
            storage_buffer_entry(8, true),
            storage_buffer_entry(11, true),
            storage_buffer_entry(20, true),
            uniform_buffer_entry(40),
            storage_buffer_entry(41, false),
        ],
    );
    let pipeline = pipeline_cache.queue_compute_pipeline(ComputePipelineDescriptor {
        label: Some(Cow::from("naadf_froxel_sun_mask_pipeline")),
        layout: vec![
            empty_group_layout.clone(),
            empty_group_layout.clone(),
            empty_group_layout.clone(),
            layout.clone(),
        ],
        shader: NAADF_FROXEL_SUN_MASK_SHADER_HANDLE,
        entry_point: Some(Cow::from("build_naadf_froxel_sun_mask")),
        ..default()
    });
    commands.insert_resource(NaadfFroxelSunMaskPipeline {
        empty_group_layout,
        layout,
        pipeline,
    });
}

pub fn prepare_naadf_froxel_sun_mask_gpu(
    state: Res<ExtractedNaadfFroxelSunMaskState>,
    gpu_buffers: Res<NaadfGpuBuffers>,
    uploads: Res<ExtractedNaadfGpuUploads>,
    views: Query<&ExtractedView>,
    render_device: Res<RenderDevice>,
    render_queue: Res<RenderQueue>,
    mut gpu_state: ResMut<NaadfFroxelSunMaskGpuState>,
) {
    let Some(view) = views.iter().next() else {
        gpu_state.reset_dispatch();
        return;
    };
    let Some(allocation) = gpu_buffers.allocation() else {
        gpu_state.reset_dispatch();
        return;
    };
    let active =
        state.active && state.rays_per_full_update > 0 && !uploads.lookup_records.is_empty();
    if !active {
        gpu_state.reset_dispatch();
        return;
    }

    if gpu_state
        .allocation
        .as_ref()
        .is_none_or(|allocation| allocation.resolution != state.resolution)
    {
        gpu_state.allocation = Some(create_froxel_sun_mask_allocation(
            &render_device,
            state.resolution,
        ));
        gpu_state.next_ray_offset = 0;
    }

    let total_rays = state.rays_per_full_update.min(u32::MAX as u64) as u32;
    let dispatch_rays = state.max_rays_per_frame.min(total_rays).max(1);
    let ray_offset = gpu_state.next_ray_offset.min(total_rays.saturating_sub(1));
    let params = froxel_params_for_view(
        view,
        &state,
        allocation.plan.chunk_records as u32,
        uploads.lookup_records.len() as u32,
        ray_offset,
    );
    if let Some(allocation) = gpu_state.allocation.as_ref() {
        write_uniform_buffer(&render_queue, &allocation.params_buffer, &params);
    }
    gpu_state.active = true;
    gpu_state.dispatch_rays = dispatch_rays;
    gpu_state.next_ray_offset = (ray_offset + dispatch_rays) % total_rays.max(1);
}

#[derive(Default)]
pub struct NaadfFroxelSunMaskNode;

impl ViewNode for NaadfFroxelSunMaskNode {
    type ViewQuery = ();

    fn run<'w>(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext<'w>,
        _view: bevy::ecs::query::QueryItem<'w, '_, Self::ViewQuery>,
        world: &'w World,
    ) -> Result<(), NodeRunError> {
        let Some(pipeline_res) = world.get_resource::<NaadfFroxelSunMaskPipeline>() else {
            return Ok(());
        };
        let Some((froxel_allocation, dispatch_rays)) = world
            .get_resource::<NaadfFroxelSunMaskGpuState>()
            .and_then(NaadfFroxelSunMaskGpuState::active_dispatch)
        else {
            return Ok(());
        };
        let Some(naadf_allocation) = world
            .get_resource::<NaadfGpuBuffers>()
            .and_then(NaadfGpuBuffers::allocation)
        else {
            return Ok(());
        };
        let pipeline_cache = world.resource::<PipelineCache>();
        let Some(pipeline) = pipeline_cache.get_compute_pipeline(pipeline_res.pipeline) else {
            return Ok(());
        };
        let render_device = render_context.render_device();
        let empty_group = render_device.create_bind_group(
            "naadf_froxel_empty_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.empty_group_layout),
            &[],
        );
        let bind_group = render_device.create_bind_group(
            "naadf_froxel_sun_mask_bind_group",
            &pipeline_cache.get_bind_group_layout(&pipeline_res.layout),
            &BindGroupEntries::with_indices((
                (0, naadf_allocation.voxel_buffer.as_entire_binding()),
                (1, naadf_allocation.material_buffer.as_entire_binding()),
                (5, naadf_allocation.block_buffer.as_entire_binding()),
                (6, naadf_allocation.mip_traversal_buffer.as_entire_binding()),
                (7, naadf_allocation.mip_payload_buffer.as_entire_binding()),
                (8, naadf_allocation.mip_bounds_buffer.as_entire_binding()),
                (11, naadf_allocation.chunk_buffer.as_entire_binding()),
                (20, naadf_allocation.chunk_lookup_buffer.as_entire_binding()),
                (40, froxel_allocation.params_buffer.as_entire_binding()),
                (41, froxel_allocation.mask_buffer.as_entire_binding()),
            )),
        );
        let mut pass =
            render_context
                .command_encoder()
                .begin_compute_pass(&ComputePassDescriptor {
                    label: Some("naadf_froxel_sun_mask_pass"),
                    timestamp_writes: None,
                });
        pass.set_pipeline(pipeline);
        pass.set_bind_group(0, &empty_group, &[]);
        pass.set_bind_group(1, &empty_group, &[]);
        pass.set_bind_group(2, &empty_group, &[]);
        pass.set_bind_group(3, &bind_group, &[]);
        pass.dispatch_workgroups(
            dispatch_rays.div_ceil(NAADF_FROXEL_SUN_MASK_WORKGROUP_SIZE),
            1,
            1,
        );
        Ok(())
    }
}

fn create_froxel_sun_mask_allocation(
    render_device: &RenderDevice,
    resolution: UVec3,
) -> NaadfFroxelSunMaskGpuAllocation {
    let cells = froxel_ray_count(resolution).max(1) as usize;
    let visible = vec![1u32; cells];
    let params = GodRayFroxelParams::default();
    NaadfFroxelSunMaskGpuAllocation {
        resolution,
        params_buffer: create_uniform_buffer(render_device, &params),
        mask_buffer: render_device.create_buffer_with_data(&BufferInitDescriptor {
            label: Some("naadf_froxel_sun_mask_buffer"),
            contents: bytemuck::cast_slice(&visible),
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
        }),
    }
}

fn froxel_params_for_view(
    view: &ExtractedView,
    state: &ExtractedNaadfFroxelSunMaskState,
    chunk_count: u32,
    chunk_lookup_count: u32,
    ray_offset: u32,
) -> GodRayFroxelParams {
    let world_from_view = view.world_from_view.to_matrix();
    let origin = world_from_view.w_axis.truncate();
    let right = world_from_view.x_axis.truncate().normalize_or_zero();
    let up = world_from_view.y_axis.truncate().normalize_or_zero();
    let forward = (-world_from_view.z_axis.truncate()).normalize_or_zero();
    let y_scale = view.clip_from_view.y_axis.y.abs().max(0.0001);
    let x_scale = view.clip_from_view.x_axis.x.abs().max(0.0001);
    let fov_y = 2.0 * (1.0 / y_scale).atan();
    let aspect = y_scale / x_scale;
    GodRayFroxelParams {
        grid: state.resolution.extend(u32::from(state.active)),
        camera_origin_max_distance: origin.extend(state.max_distance.max(1.0)),
        camera_forward_fov_y: forward.extend(fov_y),
        camera_right_aspect: right.extend(aspect),
        camera_up_pad: up.extend(0.0),
        sun_direction_pad: normalize_or_y(state.sun_direction).extend(0.0),
        config: UVec4::new(
            state.max_ray_steps.max(1),
            chunk_count,
            chunk_lookup_count,
            ray_offset,
        ),
    }
}

fn create_uniform_buffer(render_device: &RenderDevice, params: &GodRayFroxelParams) -> Buffer {
    let mut uniform_buffer = bevy::render::render_resource::encase::UniformBuffer::new(Vec::new());
    uniform_buffer.write(params).unwrap();
    render_device.create_buffer_with_data(&BufferInitDescriptor {
        label: Some("naadf_froxel_sun_mask_params"),
        contents: uniform_buffer.as_ref(),
        usage: BufferUsages::UNIFORM | BufferUsages::COPY_DST,
    })
}

fn write_uniform_buffer(render_queue: &RenderQueue, buffer: &Buffer, params: &GodRayFroxelParams) {
    let mut uniform_buffer = bevy::render::render_resource::encase::UniformBuffer::new(Vec::new());
    uniform_buffer.write(params).unwrap();
    render_queue.write_buffer(buffer, 0, uniform_buffer.as_ref());
}

fn normalize_or_y(value: Vec3) -> Vec3 {
    let normalized = value.normalize_or_zero();
    if normalized == Vec3::ZERO {
        Vec3::Y
    } else {
        normalized
    }
}

fn storage_buffer_entry(binding: u32, read_only: bool) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn uniform_buffer_entry(binding: u32) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rendering::naadf::config::{NaadfDebugConfig, NaadfFroxelSunMaskConfig};

    #[test]
    fn froxel_ray_count_is_one_ray_per_cell() {
        assert_eq!(froxel_ray_count(UVec3::new(160, 90, 64)), 921_600);
    }

    #[test]
    fn froxel_state_requires_naadf_sun_visibility_toggle() {
        let mut app = App::new();
        app.insert_resource(NaadfConfig {
            enabled: true,
            use_for_sun_visibility: true,
            debug: NaadfDebugConfig {
                allow_unverified_post_205: true,
                ..default()
            },
            froxel_sun_mask: NaadfFroxelSunMaskConfig {
                enabled: true,
                resolution: [16, 9, 8],
                max_rays_per_frame: 128,
                ..default()
            },
            ..default()
        })
        .init_resource::<NaadfStats>()
        .init_resource::<NaadfFroxelSunMaskState>()
        .add_systems(Update, sync_naadf_froxel_sun_mask_state);

        app.update();

        let state = app.world().resource::<NaadfFroxelSunMaskState>();
        assert!(state.active);
        assert_eq!(state.rays_per_full_update, 1_152);
        assert_eq!(state.frames_per_full_update, 9);
        let stats = app.world().resource::<NaadfStats>();
        assert_eq!(stats.froxel_sun_mask_active, 1);
        assert_eq!(stats.froxel_sun_mask_rays_per_full_update, 1_152);
    }
}
