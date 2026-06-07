use bevy::prelude::*;
use bevy::render::{
    MainWorld,
    render_resource::{Buffer, BufferDescriptor, BufferUsages},
    renderer::{RenderDevice, RenderQueue},
};

use crate::rendering::naadf::preview::NaadfPreviewSettings;
use crate::rendering::naadf::stats::NaadfRenderStatsBridge;

pub const NAADF_LOCAL_LIGHT_MAX_RECORDS: usize = 64;
pub const NAADF_LOCAL_LIGHT_RECORD_BYTES: u64 = 48;
pub const NAADF_LOCAL_LIGHT_FLAG_CASTS_SHADOW: u32 = 1;

#[derive(Clone, Copy, Debug, Default, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
pub struct NaadfLocalLightRecord {
    pub position_radius: [f32; 4],
    pub color_intensity: [f32; 4],
    pub flags_shadow_pad: [u32; 4],
}

#[derive(Resource, Clone, Debug, Default, PartialEq)]
pub struct ExtractedNaadfLocalLights {
    pub records: Vec<NaadfLocalLightRecord>,
    pub visible: u32,
    pub uploaded: u32,
    pub culled: u32,
    pub shadows_enabled: bool,
}

#[derive(Resource, Default)]
pub struct NaadfLocalLightGpuBuffers {
    allocation: Option<NaadfLocalLightGpuAllocation>,
}

pub struct NaadfLocalLightGpuAllocation {
    pub buffer: Buffer,
    pub capacity: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct LocalLightCandidate {
    record: NaadfLocalLightRecord,
    distance_sq: f32,
    intensity: f32,
}

impl NaadfLocalLightGpuBuffers {
    pub fn allocation(&self) -> Option<&NaadfLocalLightGpuAllocation> {
        self.allocation.as_ref()
    }
}

pub fn extract_naadf_local_lights(mut commands: Commands, mut main_world: ResMut<MainWorld>) {
    let settings = main_world
        .get_resource::<NaadfPreviewSettings>()
        .copied()
        .unwrap_or_default();
    if !settings.local_lights_enabled {
        commands.insert_resource(ExtractedNaadfLocalLights::default());
        return;
    }

    let camera_position = active_camera_position(&mut main_world).unwrap_or(Vec3::ZERO);
    let limit = settings
        .local_light_limit
        .clamp(1, NAADF_LOCAL_LIGHT_MAX_RECORDS as u32) as usize;
    let mut point_lights = main_world.query::<(&PointLight, &GlobalTransform)>();
    let mut candidates = Vec::new();

    for (light, transform) in point_lights.iter(&main_world) {
        if light.intensity <= 0.0 || light.range <= 0.0 {
            continue;
        }
        let position = transform.translation();
        let color = light.color.to_linear();
        let flags = if settings.local_light_shadows_enabled && light.shadows_enabled {
            NAADF_LOCAL_LIGHT_FLAG_CASTS_SHADOW
        } else {
            0
        };
        candidates.push(LocalLightCandidate {
            record: NaadfLocalLightRecord {
                position_radius: [position.x, position.y, position.z, light.range],
                color_intensity: [
                    color.red,
                    color.green,
                    color.blue,
                    preview_scaled_intensity(light.intensity),
                ],
                flags_shadow_pad: [flags, 0, 0, 0],
            },
            distance_sq: position.distance_squared(camera_position),
            intensity: light.intensity,
        });
    }

    let visible = candidates.len() as u32;
    candidates.sort_by(|a, b| {
        a.distance_sq
            .total_cmp(&b.distance_sq)
            .then_with(|| b.intensity.total_cmp(&a.intensity))
    });
    let records: Vec<_> = candidates
        .into_iter()
        .take(limit)
        .map(|candidate| candidate.record)
        .collect();
    let uploaded = records.len() as u32;
    commands.insert_resource(ExtractedNaadfLocalLights {
        records,
        visible,
        uploaded,
        culled: visible.saturating_sub(uploaded),
        shadows_enabled: settings.local_light_shadows_enabled,
    });
}

pub fn prepare_naadf_local_light_gpu_buffer(
    render_device: Res<RenderDevice>,
    mut buffers: ResMut<NaadfLocalLightGpuBuffers>,
) {
    if buffers
        .allocation
        .as_ref()
        .is_some_and(|allocation| allocation.capacity >= NAADF_LOCAL_LIGHT_MAX_RECORDS as u32)
    {
        return;
    }

    buffers.allocation = Some(NaadfLocalLightGpuAllocation {
        buffer: render_device.create_buffer(&BufferDescriptor {
            label: Some("naadf_local_light_records"),
            size: NAADF_LOCAL_LIGHT_RECORD_BYTES * NAADF_LOCAL_LIGHT_MAX_RECORDS as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        }),
        capacity: NAADF_LOCAL_LIGHT_MAX_RECORDS as u32,
    });
}

pub fn upload_naadf_local_lights(
    uploads: Res<ExtractedNaadfLocalLights>,
    render_queue: Res<RenderQueue>,
    buffers: Res<NaadfLocalLightGpuBuffers>,
    bridge: Res<NaadfRenderStatsBridge>,
) {
    let uploaded = uploads
        .uploaded
        .min(NAADF_LOCAL_LIGHT_MAX_RECORDS as u32)
        .min(uploads.records.len() as u32);
    if let Some(allocation) = buffers.allocation() {
        if uploaded > 0 {
            render_queue.write_buffer(
                &allocation.buffer,
                0,
                bytemuck::cast_slice(&uploads.records[..uploaded as usize]),
            );
        }
    }
    bridge.publish_local_lights(uploads.visible, uploaded, uploads.culled, 0);
}

fn active_camera_position(world: &mut World) -> Option<Vec3> {
    let mut cameras = world.query::<(&Camera, &GlobalTransform)>();
    cameras
        .iter(world)
        .find_map(|(camera, transform)| camera.is_active.then_some(transform.translation()))
}

fn preview_scaled_intensity(intensity: f32) -> f32 {
    (intensity.max(0.0) * 0.0008).min(64.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_light_record_matches_wgsl_layout() {
        assert_eq!(
            std::mem::size_of::<NaadfLocalLightRecord>() as u64,
            NAADF_LOCAL_LIGHT_RECORD_BYTES
        );
        assert_eq!(std::mem::align_of::<NaadfLocalLightRecord>(), 4);
    }

    #[test]
    fn intensity_is_scaled_and_capped_for_preview() {
        assert_eq!(preview_scaled_intensity(-1.0), 0.0);
        assert!((preview_scaled_intensity(120_000.0) - 64.0).abs() < f32::EPSILON);
        assert!((preview_scaled_intensity(2_000.0) - 1.6).abs() < 0.000001);
    }
}
