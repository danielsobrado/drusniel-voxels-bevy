use bevy::camera::ClearColorConfig;
use bevy::camera::RenderTarget;
use bevy::camera::visibility::RenderLayers;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::render_resource::{
    Extent3d, TextureDescriptor, TextureDimension, TextureFormat, TextureUsages,
};
use bevy::render::view::Hdr;
use bevy::window::PrimaryWindow;
use serde::{Deserialize, Serialize};

use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE_I32, WATER_LEVEL};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::voxel::octree::{OctreeAabb, ViewFrustum};
use crate::voxel::types::Voxel;
use crate::voxel::world::VoxelWorld;

/// The render layer used exclusively by the reflection camera.
/// Terrain chunks above the water line are added to BOTH layer 0 and this layer.
/// Below-water chunks are only in layer 0, so they won't appear in reflections.
pub const REFLECTION_RENDER_LAYER: usize = 1;

/// Marker component for the water reflection camera
#[derive(Component)]
pub struct WaterReflectionCamera;

/// Resource holding the reflection render target texture
#[derive(Resource)]
pub struct WaterReflectionTexture {
    pub image: Handle<Image>,
    width: u32,
    height: u32,
    scale: f32,
}

#[derive(Resource, Clone, Serialize, Deserialize)]
pub struct WaterReflectionConfig {
    pub enabled: bool,
    pub resolution_scale: f32,
    pub update_interval: f32,
    pub auto_disable_distance: f32,
    pub require_water_in_frustum: bool,
}

impl Default for WaterReflectionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            resolution_scale: 0.5,
            update_interval: 0.0,
            auto_disable_distance: 120.0,
            require_water_in_frustum: true,
        }
    }
}

impl WaterReflectionConfig {
    pub fn clamp_runtime(&mut self) {
        self.resolution_scale = self.resolution_scale.clamp(0.25, 1.0);
        self.update_interval = self.update_interval.max(0.0);
        self.auto_disable_distance = self.auto_disable_distance.max(0.0);
    }

    pub fn effective_hz(&self) -> f32 {
        if self.update_interval <= f32::EPSILON {
            60.0
        } else {
            1.0 / self.update_interval
        }
    }
}

#[derive(Component, Default)]
pub struct ReflectionUpdateTimer {
    accum: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WaterReflectionReason {
    Disabled,
    OutOfRange,
    NoWaterInView,
    Throttled,
    Active,
    NoWater,
}

impl WaterReflectionReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::OutOfRange => "out-of-range",
            Self::NoWaterInView => "no-water-in-view",
            Self::Throttled => "throttled",
            Self::Active => "active",
            Self::NoWater => "no-water",
        }
    }
}

#[derive(Resource, Clone, Copy, Debug)]
pub struct WaterReflectionStatus {
    pub active: bool,
    pub sample_reflection: bool,
    pub reason: WaterReflectionReason,
    pub resolution_scale: f32,
    pub effective_hz: f32,
}

impl Default for WaterReflectionStatus {
    fn default() -> Self {
        let config = WaterReflectionConfig::default();
        Self {
            active: false,
            sample_reflection: false,
            reason: WaterReflectionReason::Disabled,
            resolution_scale: config.resolution_scale,
            effective_hz: config.effective_hz(),
        }
    }
}

#[derive(Resource, Default, Clone, Copy)]
pub struct WaterPresence {
    pub aabb: Option<OctreeAabb>,
    scan_timer: f32,
}

pub struct WaterReflectionPlugin;

impl Plugin for WaterReflectionPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<WaterReflectionConfig>()
            .init_resource::<WaterReflectionStatus>()
            .init_resource::<WaterPresence>()
            .add_systems(Startup, setup_reflection_camera)
            .add_systems(
                Update,
                (
                    apply_integrated_gpu_reflection_defaults,
                    update_water_presence,
                    resize_reflection_target,
                    update_reflection_camera,
                ),
            );
    }
}

/// Create the reflection render target image
fn create_reflection_image(images: &mut Assets<Image>, width: u32, height: u32) -> Handle<Image> {
    let size = Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };

    let mut image = Image {
        texture_descriptor: TextureDescriptor {
            label: Some("water_reflection_texture"),
            size,
            dimension: TextureDimension::D2,
            format: TextureFormat::Rgba16Float,
            mip_level_count: 1,
            sample_count: 1,
            usage: TextureUsages::TEXTURE_BINDING
                | TextureUsages::COPY_DST
                | TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        },
        ..default()
    };
    image.resize(size);
    images.add(image)
}

/// Spawn the reflection camera that renders the scene from below the water plane
fn setup_reflection_camera(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    mut config: ResMut<WaterReflectionConfig>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    window_query: Query<&Window, With<PrimaryWindow>>,
) {
    config.clamp_runtime();
    let integrated = capabilities
        .as_ref()
        .map(|c| c.integrated_gpu)
        .unwrap_or(false);
    if integrated {
        config.resolution_scale = 0.25;
        config.update_interval = 1.0 / 30.0;
    }

    let (width, height) =
        reflection_target_size(window_query.single().ok(), config.resolution_scale);
    let image_handle = create_reflection_image(&mut images, width, height);

    commands.insert_resource(WaterReflectionTexture {
        image: image_handle.clone(),
        width,
        height,
        scale: config.resolution_scale,
    });

    // Spawn the reflection camera
    // It renders the scene mirrored across the water plane at Y = WATER_LEVEL.
    // Only renders entities in REFLECTION_RENDER_LAYER (layer 1) — below-water
    // terrain chunks are not added to that layer, so they're skipped here.
    let water_y = WATER_LEVEL as f32;
    commands.spawn((
        WaterReflectionCamera,
        Camera3d::default(),
        Camera {
            order: -1, // Render before main camera
            clear_color: ClearColorConfig::Custom(Color::srgba(0.1, 0.2, 0.4, 1.0)),
            is_active: false,
            ..default()
        },
        RenderTarget::Image(image_handle.into()),
        Projection::Perspective(PerspectiveProjection {
            near: 0.1,
            far: config.auto_disable_distance.max(150.0),
            ..default()
        }),
        // Initial transform — updated each frame to mirror main camera
        Transform::from_xyz(0.0, water_y, 0.0)
            .looking_at(Vec3::new(0.0, water_y + 1.0, -1.0), Vec3::Y),
        RenderLayers::layer(REFLECTION_RENDER_LAYER),
        Hdr,
        Tonemapping::AcesFitted,
        Msaa::Off,
        ReflectionUpdateTimer::default(),
    ));

    info!(
        "Water reflection camera created at {}x{} (scale: {})",
        width, height, config.resolution_scale
    );
}

fn reflection_target_size(window: Option<&Window>, scale: f32) -> (u32, u32) {
    let (base_width, base_height) = window
        .map(|window| (window.resolution.width(), window.resolution.height()))
        .unwrap_or((1920.0, 1080.0));
    (
        (base_width * scale).round().max(1.0) as u32,
        (base_height * scale).round().max(1.0) as u32,
    )
}

fn apply_integrated_gpu_reflection_defaults(
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut config: ResMut<WaterReflectionConfig>,
    mut applied: Local<bool>,
) {
    if *applied {
        return;
    }
    let Some(capabilities) = capabilities else {
        return;
    };
    if capabilities.adapter_name.is_none() {
        return;
    }
    if capabilities.integrated_gpu {
        config.resolution_scale = 0.25;
        config.update_interval = 1.0 / 30.0;
    }
    config.clamp_runtime();
    *applied = true;
}

fn resize_reflection_target(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    texture: Option<ResMut<WaterReflectionTexture>>,
    mut config: ResMut<WaterReflectionConfig>,
    window_query: Query<&Window, With<PrimaryWindow>>,
    mut reflection_camera: Query<&mut RenderTarget, With<WaterReflectionCamera>>,
) {
    config.clamp_runtime();
    let Some(mut texture) = texture else { return };
    let (width, height) =
        reflection_target_size(window_query.single().ok(), config.resolution_scale);
    let scale_changed = (texture.scale - config.resolution_scale).abs() > f32::EPSILON;
    if !scale_changed && texture.width == width && texture.height == height {
        return;
    }

    let image_handle = create_reflection_image(&mut images, width, height);
    texture.image = image_handle.clone();
    texture.width = width;
    texture.height = height;
    texture.scale = config.resolution_scale;

    for mut target in reflection_camera.iter_mut() {
        *target = RenderTarget::Image(image_handle.clone().into());
    }

    commands.insert_resource(WaterReflectionTexture {
        image: image_handle,
        width,
        height,
        scale: config.resolution_scale,
    });
}

fn update_water_presence(
    time: Res<Time>,
    world: Res<VoxelWorld>,
    mut presence: ResMut<WaterPresence>,
) {
    presence.scan_timer += time.delta_secs();
    if presence.aabb.is_some() && presence.scan_timer < 1.0 && !world.is_changed() {
        return;
    }
    presence.scan_timer = 0.0;

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    let mut found = false;

    for (chunk_pos, chunk) in world.chunk_entries() {
        let mut has_water = false;
        'scan: for x in 0..CHUNK_SIZE_I32 {
            for y in 0..CHUNK_SIZE_I32 {
                for z in 0..CHUNK_SIZE_I32 {
                    let local = UVec3::new(x as u32, y as u32, z as u32);
                    if chunk.get(local).is_liquid() {
                        has_water = true;
                        break 'scan;
                    }
                }
            }
        }

        if has_water {
            let origin = VoxelWorld::chunk_to_world(*chunk_pos).as_vec3();
            min = min.min(origin);
            max = max.max(origin + Vec3::splat(CHUNK_SIZE_I32 as f32));
            found = true;
        }
    }

    presence.aabb = found.then_some(OctreeAabb::new(
        Vec3::new(min.x, WATER_LEVEL as f32 - 0.75, min.z),
        Vec3::new(max.x, WATER_LEVEL as f32 + 0.75, max.z),
    ));
}

/// Mirror the main camera's position and rotation across the water plane each frame
fn update_reflection_camera(
    config: Res<WaterReflectionConfig>,
    presence: Res<WaterPresence>,
    time: Res<Time>,
    main_camera: Query<
        (&Transform, &GlobalTransform, &Projection),
        (With<PlayerCamera>, Without<WaterReflectionCamera>),
    >,
    mut reflection_camera: Query<
        (&mut Transform, &mut Camera, &mut ReflectionUpdateTimer),
        (With<WaterReflectionCamera>, Without<PlayerCamera>),
    >,
    mut status: ResMut<WaterReflectionStatus>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Reflection Render");
    let Ok((main_transform, main_global, projection)) = main_camera.single() else {
        return;
    };
    let Ok((mut refl_transform, mut refl_camera, mut update_timer)) =
        reflection_camera.single_mut()
    else {
        return;
    };

    let mut reason = WaterReflectionReason::Active;
    let mut active = config.enabled;
    let mut sample_reflection = active;

    if !config.enabled {
        active = false;
        sample_reflection = false;
        reason = WaterReflectionReason::Disabled;
    } else if let Some(water_aabb) = presence.aabb {
        if config.auto_disable_distance > 0.0 {
            let dist = distance_to_aabb_xz(main_transform.translation, water_aabb);
            if dist > config.auto_disable_distance {
                active = false;
                sample_reflection = false;
                reason = WaterReflectionReason::OutOfRange;
            }
        }

        if active
            && config.require_water_in_frustum
            && !water_in_camera_frustum(main_global, projection, water_aabb)
        {
            active = false;
            sample_reflection = false;
            reason = WaterReflectionReason::NoWaterInView;
        }
    } else {
        active = false;
        sample_reflection = false;
        reason = WaterReflectionReason::NoWater;
    }

    if active && config.update_interval > f32::EPSILON {
        update_timer.accum += time.delta_secs();
        if update_timer.accum < config.update_interval {
            active = false;
            sample_reflection = true;
            reason = WaterReflectionReason::Throttled;
        } else {
            update_timer.accum = 0.0;
        }
    }

    refl_camera.is_active = active;
    status.active = active;
    status.sample_reflection = sample_reflection;
    status.reason = reason;
    status.resolution_scale = config.resolution_scale;
    status.effective_hz = config.effective_hz();

    let water_y = WATER_LEVEL as f32;

    // Mirror position: reflect Y across water plane
    let mirrored_pos = Vec3::new(
        main_transform.translation.x,
        2.0 * water_y - main_transform.translation.y,
        main_transform.translation.z,
    );

    // Mirror rotation: flip the pitch (look direction reflected across Y)
    let main_forward = main_transform.forward().as_vec3();
    let mirrored_forward = Vec3::new(main_forward.x, -main_forward.y, main_forward.z);

    // Compute the mirrored up direction
    let main_up = main_transform.up().as_vec3();
    let mirrored_up = Vec3::new(main_up.x, -main_up.y, main_up.z);

    *refl_transform =
        Transform::from_translation(mirrored_pos).looking_to(mirrored_forward, mirrored_up);
    drop(_timer);
    timing.record_count(frame.0, "Water Reflection Active", u8::from(active) as f64);
    timing.record_count(
        frame.0,
        "Water Reflection Sampled",
        u8::from(sample_reflection) as f64,
    );
}

fn distance_to_aabb_xz(position: Vec3, aabb: OctreeAabb) -> f32 {
    let dx = if position.x < aabb.min.x {
        aabb.min.x - position.x
    } else if position.x > aabb.max.x {
        position.x - aabb.max.x
    } else {
        0.0
    };
    let dz = if position.z < aabb.min.z {
        aabb.min.z - position.z
    } else if position.z > aabb.max.z {
        position.z - aabb.max.z
    } else {
        0.0
    };
    Vec2::new(dx, dz).length()
}

fn water_in_camera_frustum(
    camera_transform: &GlobalTransform,
    projection: &Projection,
    water_aabb: OctreeAabb,
) -> bool {
    let view_matrix = camera_transform.to_matrix().inverse();
    let proj_matrix = projection.get_clip_from_view();
    let view_proj = proj_matrix * view_matrix;
    let frustum = ViewFrustum::from_view_projection(&view_proj);
    !water_aabb.outside_frustum(&frustum)
}
