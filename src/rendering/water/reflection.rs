use bevy::camera::ClearColorConfig;
use bevy::camera::RenderTarget;
use bevy::camera::visibility::RenderLayers;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::render_resource::{
    Extent3d, TextureDescriptor, TextureDimension, TextureFormat, TextureUsages,
};
use bevy::render::view::{Hdr, NoIndirectDrawing};
use bevy::window::PrimaryWindow;
use serde::{Deserialize, Serialize};

use crate::bench::BenchRenderToggles;
use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE_I32, WATER_FANCY_MIN_TRIANGLES, WATER_LEVEL};
use crate::performance::{AreaTimingRecorder, area_timer};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::water::WaterConfig;
use crate::voxel::meshing::{
    WaterBodyId, WaterBodyKind, WaterBodyMaterialMode, WaterMesh, WaterMeshDetail,
};
use crate::voxel::octree::OctreeAabb;
use crate::voxel::plugin::{WaterBodyInfo, WaterBodyRegistry};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld};

const NEAR_VISIBLE_WATER_DISTANCE: f32 = 24.0;

/// Debug override read once and cached: this sits on a per-frame system, and
/// `std::env::var_os` takes the process env lock on every call.
fn force_reflection_active() -> bool {
    static CACHE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *CACHE.get_or_init(|| std::env::var_os("VOXEL_FORCE_WATER_REFLECTION_ACTIVE").is_some())
}

/// The render layer used exclusively by the reflection camera.
/// Terrain chunks above the water line are added to BOTH layer 0 and this layer.
/// Below-water chunks are only in layer 0, so they won't appear in reflections.
pub const REFLECTION_RENDER_LAYER: usize = 1;

/// The render layer used by the binary-ish water mask camera.
/// White mask proxy meshes are rendered only on this layer.
pub const WATER_MASK_RENDER_LAYER: usize = 2;

/// Marker component for the water reflection camera
#[derive(Component)]
pub struct WaterReflectionCamera;

/// Marker component for the water mask camera.
#[derive(Component)]
pub struct WaterMaskCamera;

/// Resource holding the reflection render target texture
#[derive(Resource)]
pub struct WaterReflectionTexture {
    pub image: Handle<Image>,
    width: u32,
    height: u32,
    scale: f32,
}

/// Resource holding the mask render target. The mask is generated from actual
/// water mesh geometry so transparent water/depth-prepass behavior does not
/// decide where planar reflections appear.
#[derive(Resource)]
pub struct WaterReflectionMaskTexture {
    pub image: Handle<Image>,
    width: u32,
    height: u32,
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
    TooSmall,
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
            Self::TooSmall => "too-small",
            Self::Throttled => "throttled",
            Self::Active => "active",
            Self::NoWater => "no-water",
        }
    }
}

#[derive(Resource, Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum WaterReflectionDebugViewMode {
    #[default]
    Off,
    Mask,
    ReflectionOnly,
    BlendFactor,
}

impl WaterReflectionDebugViewMode {
    pub fn as_u32(self) -> u32 {
        match self {
            Self::Off => 0,
            Self::Mask => 1,
            Self::ReflectionOnly => 2,
            Self::BlendFactor => 3,
        }
    }

    fn next(self) -> Self {
        match self {
            Self::Off => Self::Mask,
            Self::Mask => Self::ReflectionOnly,
            Self::ReflectionOnly => Self::BlendFactor,
            Self::BlendFactor => Self::Off,
        }
    }

    fn from_env() -> Option<Self> {
        let value = std::env::var("VOXEL_WATER_REFLECTION_DEBUG_VIEW").ok()?;
        match value.trim().to_ascii_lowercase().as_str() {
            "mask" => Some(Self::Mask),
            "reflection" | "reflection_only" | "reflection-only" => Some(Self::ReflectionOnly),
            "blend" | "blend_factor" | "blend-factor" => Some(Self::BlendFactor),
            "off" | "0" => Some(Self::Off),
            _ => None,
        }
    }
}

#[derive(Resource, Clone, Copy, Debug)]
pub struct WaterReflectionBodyParams {
    pub reflection_strength: f32,
    pub fresnel_power: f32,
    pub distortion_strength: f32,
    pub surface_y: f32,
    pub kind: WaterBodyKind,
}

impl Default for WaterReflectionBodyParams {
    fn default() -> Self {
        Self {
            reflection_strength: 0.85,
            fresnel_power: 5.0,
            distortion_strength: 0.006,
            surface_y: WATER_LEVEL as f32,
            kind: WaterBodyKind::Unknown,
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

#[derive(Resource, Default, Clone, Copy, Debug)]
pub struct WaterReflectionMaskStats {
    pub estimated_mask_pixels: u32,
    pub mask_bodies: u32,
    pub estimated_applied_pixels: u32,
    pub estimated_skipped_no_mask_pixels: u32,
    pub estimated_skipped_disabled_pixels: u32,
    pub estimated_skipped_too_far_pixels: u32,
}

#[derive(Resource, Default, Clone, Copy)]
pub struct WaterPresence {
    pub aabb: Option<OctreeAabb>,
    pub water_meshes: u32,
    pub visible_meshes: u32,
    pub eligible_meshes: u32,
    pub view_visible_meshes: u32,
    pub nearest_water_distance: Option<f32>,
    pub nearest_visible_distance: Option<f32>,
    pub using_startup_fallback: bool,
    pub invalid_candidates_suppressed: u32,
    scan_timer: f32,
    age_secs: f32,
}

impl WaterPresence {
    fn reset_mesh_summary(&mut self) {
        self.aabb = None;
        self.water_meshes = 0;
        self.visible_meshes = 0;
        self.eligible_meshes = 0;
        self.view_visible_meshes = 0;
        self.nearest_water_distance = None;
        self.nearest_visible_distance = None;
        self.using_startup_fallback = false;
        self.invalid_candidates_suppressed = 0;
    }
}

pub struct WaterReflectionPlugin;

impl Plugin for WaterReflectionPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<WaterReflectionConfig>()
            .init_resource::<WaterReflectionStatus>()
            .init_resource::<WaterPresence>()
            .init_resource::<WaterReflectionMaskStats>()
            .init_resource::<WaterReflectionBodyParams>()
            .init_resource::<WaterReflectionDebugViewMode>()
            .add_systems(Startup, setup_reflection_camera)
            .add_systems(
                Update,
                (
                    apply_integrated_gpu_reflection_defaults,
                    resize_reflection_target,
                    resize_water_mask_target,
                    sync_water_reflection_debug_view,
                    update_water_presence,
                    update_reflection_camera.after(update_water_presence),
                    update_water_mask_camera.after(update_reflection_camera),
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

fn create_water_mask_image(images: &mut Assets<Image>, width: u32, height: u32) -> Handle<Image> {
    let size = Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };

    let mut image = Image {
        texture_descriptor: TextureDescriptor {
            label: Some("water_reflection_mask_texture"),
            size,
            dimension: TextureDimension::D2,
            format: TextureFormat::Rgba8Unorm,
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
    let (mask_width, mask_height) = water_mask_target_size(window_query.single().ok());
    let mask_handle = create_water_mask_image(&mut images, mask_width, mask_height);

    commands.insert_resource(WaterReflectionTexture {
        image: image_handle.clone(),
        width,
        height,
        scale: config.resolution_scale,
    });
    commands.insert_resource(WaterReflectionMaskTexture {
        image: mask_handle.clone(),
        width: mask_width,
        height: mask_height,
    });

    // Spawn the reflection camera
    // It renders the scene mirrored across the water plane at Y = WATER_LEVEL.
    // Only renders entities in REFLECTION_RENDER_LAYER (layer 1) — below-water
    // terrain chunks are not added to that layer, so they're skipped here.
    let water_y = WATER_LEVEL as f32;
    let mut reflection_camera = commands.spawn((
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
    if cfg!(debug_assertions) {
        reflection_camera.insert(NoIndirectDrawing);
    }

    let mut mask_camera = commands.spawn((
        WaterMaskCamera,
        Camera3d::default(),
        Camera {
            order: -2,
            clear_color: ClearColorConfig::Custom(Color::BLACK),
            is_active: true,
            ..default()
        },
        RenderTarget::Image(mask_handle.into()),
        Projection::Perspective(PerspectiveProjection {
            near: 0.1,
            far: config.auto_disable_distance.max(150.0),
            ..default()
        }),
        Transform::from_translation(Vec3::new(0.0, water_y + 4.0, 0.0))
            .looking_to(Vec3::Z, Vec3::Y),
        RenderLayers::layer(WATER_MASK_RENDER_LAYER),
        Msaa::Off,
    ));
    if cfg!(debug_assertions) {
        mask_camera.insert(NoIndirectDrawing);
    }

    info!(
        "Water reflection camera created at {}x{} (scale: {}), mask {}x{}",
        width, height, config.resolution_scale, mask_width, mask_height
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

fn water_mask_target_size(window: Option<&Window>) -> (u32, u32) {
    window
        .map(|window| {
            (
                window.resolution.width().round().max(1.0) as u32,
                window.resolution.height().round().max(1.0) as u32,
            )
        })
        .unwrap_or((1920, 1080))
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

fn resize_water_mask_target(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    texture: Option<ResMut<WaterReflectionMaskTexture>>,
    window_query: Query<&Window, With<PrimaryWindow>>,
    mut mask_camera: Query<&mut RenderTarget, With<WaterMaskCamera>>,
) {
    let Some(mut texture) = texture else { return };
    let (width, height) = water_mask_target_size(window_query.single().ok());
    if texture.width == width && texture.height == height {
        return;
    }

    let image_handle = create_water_mask_image(&mut images, width, height);
    texture.image = image_handle.clone();
    texture.width = width;
    texture.height = height;

    for mut target in mask_camera.iter_mut() {
        *target = RenderTarget::Image(image_handle.clone().into());
    }

    commands.insert_resource(WaterReflectionMaskTexture {
        image: image_handle,
        width,
        height,
    });
}

fn sync_water_reflection_debug_view(
    keys: Res<ButtonInput<KeyCode>>,
    mut mode: ResMut<WaterReflectionDebugViewMode>,
) {
    if let Some(env_mode) = WaterReflectionDebugViewMode::from_env() {
        *mode = env_mode;
        return;
    }

    let shift_held = keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight);
    let alt_held = keys.pressed(KeyCode::AltLeft) || keys.pressed(KeyCode::AltRight);
    if shift_held && alt_held && keys.just_pressed(KeyCode::F9) {
        *mode = mode.next();
        info!("Water reflection debug view: {:?}", *mode);
    }
}

fn update_water_presence(
    time: Res<Time>,
    world: Res<VoxelWorld>,
    config: Res<WaterReflectionConfig>,
    mut timing: ResMut<AreaTimingRecorder>,
    frame: Res<FrameCount>,
    window_query: Query<&Window, With<PrimaryWindow>>,
    water_bodies: Option<Res<WaterBodyRegistry>>,
    main_camera: Query<
        (&Transform, &Projection),
        (
            With<PlayerCamera>,
            Without<WaterReflectionCamera>,
            Without<WaterMaskCamera>,
        ),
    >,
    water_meshes: Query<
        (
            &Transform,
            Option<&ViewVisibility>,
            Option<&WaterMeshDetail>,
            Option<&WaterBodyId>,
        ),
        With<WaterMesh>,
    >,
    mut presence: ResMut<WaterPresence>,
    mut mask_stats: ResMut<WaterReflectionMaskStats>,
    mut body_params: ResMut<WaterReflectionBodyParams>,
    water_config: Option<Res<WaterConfig>>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Water Reflection Presence CPU");
    presence.age_secs += time.delta_secs();
    presence.reset_mesh_summary();
    *mask_stats = WaterReflectionMaskStats::default();

    let Ok((main_transform, projection)) = main_camera.single() else {
        return;
    };
    let window_size = window_query
        .single()
        .ok()
        .map(|window| Vec2::new(window.resolution.width(), window.resolution.height()))
        .unwrap_or(Vec2::new(1920.0, 1080.0));
    let screen_pixels = (window_size.x * window_size.y).round().max(0.0) as u32;
    let mut eligible_min = Vec3::splat(f32::INFINITY);
    let mut eligible_max = Vec3::splat(f32::NEG_INFINITY);
    let mut found_eligible = false;
    let mut visible_body_ids = std::collections::HashSet::new();
    let mut best_params_distance = f32::INFINITY;

    for (transform, view_visibility, detail, body_id) in water_meshes.iter() {
        presence.water_meshes += 1;
        let body_info = body_id.and_then(|id| water_bodies.as_deref()?.bodies.get(id));
        if !water_body_allows_reflection_sampling(body_info)
            || !is_valid_water_reflection_candidate(&world, transform)
        {
            presence.invalid_candidates_suppressed += 1;
            continue;
        }
        if view_visibility.is_some_and(|visibility| visibility.get()) {
            presence.view_visible_meshes += 1;
        }

        let water_aabb = water_mesh_aabb(transform);
        let distance = distance_to_aabb_xz(main_transform.translation, water_aabb);
        let body_distance = body_info
            .map(|body| body.nearest_distance)
            .unwrap_or(distance);
        presence.nearest_water_distance = Some(
            presence
                .nearest_water_distance
                .map(|nearest| nearest.min(body_distance))
                .unwrap_or(body_distance),
        );
        if config.require_water_in_frustum
            && !aabb_in_camera_view(main_transform, projection, water_aabb)
            && distance > NEAR_VISIBLE_WATER_DISTANCE
        {
            continue;
        }

        presence.visible_meshes += 1;
        if let Some(body_id) = body_id {
            visible_body_ids.insert(body_id.0);
        }
        presence.nearest_visible_distance = Some(
            presence
                .nearest_visible_distance
                .map(|nearest| nearest.min(body_distance))
                .unwrap_or(body_distance),
        );

        mask_stats.estimated_mask_pixels =
            mask_stats
                .estimated_mask_pixels
                .saturating_add(estimate_aabb_screen_pixels(
                    main_transform,
                    projection,
                    water_aabb,
                    window_size,
                ));
        if body_distance < best_params_distance {
            best_params_distance = body_distance;
            *body_params = body_id
                .and_then(|id| water_bodies.as_deref()?.bodies.get(id))
                .map(|body| WaterReflectionBodyParams {
                    reflection_strength: body.reflection_strength,
                    fresnel_power: body.fresnel_power,
                    distortion_strength: body.distortion_strength,
                    surface_y: body.surface_y,
                    kind: body.kind,
                })
                .unwrap_or_else(|| {
                    reflection_params_for_water(
                        detail,
                        transform.translation.y,
                        water_config.as_deref(),
                    )
                });
        }

        let enough_screen_coverage = water_reflection_has_enough_coverage(
            mask_stats.estimated_mask_pixels,
            detail,
            body_info,
            body_id.is_some(),
        );
        if !enough_screen_coverage {
            continue;
        }

        presence.eligible_meshes += 1;
        eligible_min = eligible_min.min(water_aabb.min);
        eligible_max = eligible_max.max(water_aabb.max);
        found_eligible = true;
    }

    if found_eligible {
        presence.aabb = Some(OctreeAabb::new(eligible_min, eligible_max));
    }
    mask_stats.mask_bodies = visible_body_ids.len() as u32;
    let sample_enabled = config.enabled && found_eligible;
    mask_stats.estimated_mask_pixels = mask_stats.estimated_mask_pixels.min(screen_pixels);
    mask_stats.estimated_applied_pixels = if sample_enabled {
        mask_stats.estimated_mask_pixels
    } else {
        0
    };
    mask_stats.estimated_skipped_no_mask_pixels =
        screen_pixels.saturating_sub(mask_stats.estimated_mask_pixels);
    mask_stats.estimated_skipped_disabled_pixels = if config.enabled {
        0
    } else {
        mask_stats.estimated_mask_pixels
    };
    let disable_distance = effective_water_reflection_disable_distance(&config);
    mask_stats.estimated_skipped_too_far_pixels = if disable_distance > 0.0
        && presence
            .nearest_visible_distance
            .is_some_and(|distance| distance > disable_distance)
    {
        mask_stats.estimated_mask_pixels
    } else {
        0
    };

    if found_eligible {
        return;
    }

    if presence.water_meshes > 0 || presence.age_secs > 8.0 {
        return;
    }

    update_startup_fallback_water_presence(
        &world,
        world.is_changed(),
        time.delta_secs(),
        &config,
        main_transform,
        projection,
        &mut presence,
    );
}

fn water_reflection_has_enough_coverage(
    estimated_mask_pixels: u32,
    detail: Option<&WaterMeshDetail>,
    body_info: Option<&WaterBodyInfo>,
    has_body_id: bool,
) -> bool {
    estimated_mask_pixels > 24
        || has_body_id
        || body_info
            .map(|body| body.surface_area >= WATER_FANCY_MIN_TRIANGLES as f32)
            .unwrap_or(false)
        || detail
            .map(|detail| detail.triangle_count >= WATER_FANCY_MIN_TRIANGLES)
            .unwrap_or(true)
}

fn update_startup_fallback_water_presence(
    world: &VoxelWorld,
    world_changed: bool,
    delta_secs: f32,
    config: &WaterReflectionConfig,
    main_transform: &Transform,
    projection: &Projection,
    presence: &mut WaterPresence,
) {
    presence.scan_timer += delta_secs;
    if presence.aabb.is_some() && presence.scan_timer < 1.0 && !world_changed {
        return;
    }
    presence.scan_timer = 0.0;

    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    let mut found = false;

    for (chunk_pos, chunk) in world.chunk_entries() {
        let mut has_water = false;
        let mut water_min_y = f32::INFINITY;
        let mut water_max_y = f32::NEG_INFINITY;
        'scan: for x in 0..CHUNK_SIZE_I32 {
            for y in 0..CHUNK_SIZE_I32 {
                for z in 0..CHUNK_SIZE_I32 {
                    let local = UVec3::new(x as u32, y as u32, z as u32);
                    let world_pos = VoxelWorld::chunk_to_world(*chunk_pos) + IVec3::new(x, y, z);
                    if chunk.get(local).is_liquid()
                        && water_voxel_has_valid_reflection_surface(world, world_pos)
                    {
                        has_water = true;
                        water_min_y = water_min_y.min(world_pos.y as f32);
                        water_max_y = water_max_y.max(world_pos.y as f32 + 1.0);
                        break 'scan;
                    }
                }
            }
        }

        if has_water {
            let origin = VoxelWorld::chunk_to_world(*chunk_pos).as_vec3();
            min = min.min(Vec3::new(origin.x, water_min_y - 0.75, origin.z));
            max = max.max(Vec3::new(
                origin.x + CHUNK_SIZE_I32 as f32,
                water_max_y + 0.75,
                origin.z + CHUNK_SIZE_I32 as f32,
            ));
            found = true;
        }
    }

    let Some(water_aabb) = found.then_some(OctreeAabb::new(min, max)) else {
        return;
    };

    if config.require_water_in_frustum
        && !aabb_in_camera_view(main_transform, projection, water_aabb)
    {
        return;
    }
    let distance = distance_to_aabb_xz(main_transform.translation, water_aabb);
    if config.auto_disable_distance > 0.0 && distance > config.auto_disable_distance {
        return;
    }

    presence.visible_meshes = 1;
    presence.eligible_meshes = 1;
    presence.nearest_visible_distance = Some(distance);
    presence.using_startup_fallback = true;
    presence.aabb = Some(water_aabb);
}

fn reflection_params_for_water(
    detail: Option<&WaterMeshDetail>,
    surface_y: f32,
    water_config: Option<&WaterConfig>,
) -> WaterReflectionBodyParams {
    let max_depth = detail.map(|detail| detail.max_depth).unwrap_or(0);
    let kind = if max_depth >= 8 {
        WaterBodyKind::Ocean
    } else if max_depth <= 1 {
        WaterBodyKind::ShallowFlood
    } else if max_depth <= 2 {
        WaterBodyKind::Pond
    } else {
        WaterBodyKind::Lake
    };
    if let Some(config) = water_config {
        let preset = config.body_preset(kind);
        return WaterReflectionBodyParams {
            reflection_strength: preset.reflection_strength,
            fresnel_power: preset.fresnel_power,
            distortion_strength: preset.distortion_strength,
            surface_y,
            kind,
        };
    }
    if kind == WaterBodyKind::Ocean {
        WaterReflectionBodyParams {
            reflection_strength: 0.85,
            fresnel_power: 5.0,
            distortion_strength: 0.006,
            surface_y,
            kind: WaterBodyKind::Ocean,
        }
    } else if kind == WaterBodyKind::ShallowFlood {
        WaterReflectionBodyParams {
            reflection_strength: 0.12,
            fresnel_power: 3.0,
            distortion_strength: 0.001,
            surface_y,
            kind: WaterBodyKind::ShallowFlood,
        }
    } else if kind == WaterBodyKind::Pond {
        WaterReflectionBodyParams {
            reflection_strength: 0.62,
            fresnel_power: 4.0,
            distortion_strength: 0.0035,
            surface_y,
            kind: WaterBodyKind::Pond,
        }
    } else {
        WaterReflectionBodyParams {
            reflection_strength: 0.74,
            fresnel_power: 4.5,
            distortion_strength: 0.0045,
            surface_y,
            kind: WaterBodyKind::Lake,
        }
    }
}

/// Mirror the main camera's position and rotation across the water plane each frame
fn update_reflection_camera(
    config: Res<WaterReflectionConfig>,
    presence: Res<WaterPresence>,
    bench_toggles: Option<Res<BenchRenderToggles>>,
    time: Res<Time>,
    main_camera: Query<
        &Transform,
        (
            With<PlayerCamera>,
            Without<WaterReflectionCamera>,
            Without<WaterMaskCamera>,
        ),
    >,
    mut reflection_camera: Query<
        (&mut Transform, &mut Camera, &mut ReflectionUpdateTimer),
        (With<WaterReflectionCamera>, Without<PlayerCamera>),
    >,
    mut status: ResMut<WaterReflectionStatus>,
    mut mask_stats: ResMut<WaterReflectionMaskStats>,
    body_params: Res<WaterReflectionBodyParams>,
    frame: Res<FrameCount>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    let _timer = area_timer(&mut timing, frame.0, "Water Reflection Update CPU");
    let Ok(main_transform) = main_camera.single() else {
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

    if bench_toggles.is_some_and(|toggles| toggles.disable_reflection_cameras) {
        active = false;
        sample_reflection = false;
        reason = WaterReflectionReason::Disabled;
    } else if !config.enabled {
        active = false;
        sample_reflection = false;
        reason = WaterReflectionReason::Disabled;
    } else if presence.visible_meshes == 0 {
        active = false;
        sample_reflection = false;
        reason = if presence.water_meshes == 0 && !presence.using_startup_fallback {
            WaterReflectionReason::NoWater
        } else {
            WaterReflectionReason::NoWaterInView
        };
    } else if reflection_presence_out_of_range(&presence, &config) {
        active = false;
        sample_reflection = false;
        reason = WaterReflectionReason::OutOfRange;
    } else if presence.eligible_meshes == 0 {
        active = false;
        sample_reflection = false;
        reason = WaterReflectionReason::TooSmall;
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

    if force_reflection_active() {
        active = true;
        sample_reflection = true;
        reason = WaterReflectionReason::Active;
        update_timer.accum = 0.0;
    }

    refl_camera.is_active = active;
    status.active = active;
    status.sample_reflection = sample_reflection;
    status.reason = reason;
    status.resolution_scale = config.resolution_scale;
    status.effective_hz = config.effective_hz();

    mask_stats.estimated_applied_pixels = if sample_reflection {
        mask_stats.estimated_mask_pixels
    } else {
        0
    };
    mask_stats.estimated_skipped_disabled_pixels = if reason == WaterReflectionReason::Disabled {
        mask_stats.estimated_mask_pixels
    } else {
        0
    };
    mask_stats.estimated_skipped_too_far_pixels = if reason == WaterReflectionReason::OutOfRange {
        mask_stats.estimated_mask_pixels
    } else {
        0
    };

    if active {
        *refl_transform = mirrored_reflection_transform(main_transform, body_params.surface_y);
    }
    drop(_timer);
    timing.record_count(
        frame.0,
        "Water Meshes Visible In Frustum",
        presence.visible_meshes as f64,
    );
    timing.record_count(frame.0, "Water Meshes Total", presence.water_meshes as f64);
    timing.record_count(
        frame.0,
        "Water Meshes View Visible",
        presence.view_visible_meshes as f64,
    );
    timing.record_count(
        frame.0,
        "Water Meshes Nearest Distance",
        presence.nearest_water_distance.unwrap_or(0.0) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Meshes Eligible For Reflection",
        presence.eligible_meshes as f64,
    );
    timing.record_count(
        frame.0,
        "Invalid Water Reflection Candidates Suppressed",
        presence.invalid_candidates_suppressed as f64,
    );
    timing.record_count(frame.0, "Water Reflection Active", u8::from(active) as f64);
    timing.record_count(
        frame.0,
        "Water Reflection Sampled",
        u8::from(sample_reflection) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Reflection Disabled No Visible Water",
        u8::from(matches!(
            reason,
            WaterReflectionReason::NoWater | WaterReflectionReason::NoWaterInView
        )) as f64,
    );
    timing.record_count(
        frame.0,
        "Water Reflection Disabled Too Small",
        u8::from(reason == WaterReflectionReason::TooSmall) as f64,
    );
    timing.record_count(
        frame.0,
        "Estimated Water Reflection Mask Pixels",
        mask_stats.estimated_mask_pixels as f64,
    );
    timing.record_count(
        frame.0,
        "Estimated Water Reflection Mask Bodies",
        mask_stats.mask_bodies as f64,
    );
    timing.record_count(
        frame.0,
        "Estimated Water Reflection Compositor Applied Pixels",
        mask_stats.estimated_applied_pixels as f64,
    );
    timing.record_count(
        frame.0,
        "Estimated Water Reflection Compositor Skipped No Mask",
        mask_stats.estimated_skipped_no_mask_pixels as f64,
    );
    timing.record_count(
        frame.0,
        "Estimated Water Reflection Compositor Skipped Disabled",
        mask_stats.estimated_skipped_disabled_pixels as f64,
    );
    timing.record_count(
        frame.0,
        "Estimated Water Reflection Compositor Skipped Too Far",
        mask_stats.estimated_skipped_too_far_pixels as f64,
    );
}

fn effective_water_reflection_disable_distance(config: &WaterReflectionConfig) -> f32 {
    if config.auto_disable_distance > 0.0 {
        config.auto_disable_distance + CHUNK_SIZE_I32 as f32
    } else {
        0.0
    }
}

fn reflection_presence_out_of_range(
    presence: &WaterPresence,
    config: &WaterReflectionConfig,
) -> bool {
    let disable_distance = effective_water_reflection_disable_distance(config);
    if disable_distance <= 0.0 {
        return false;
    }
    let nearest = match (
        presence.nearest_visible_distance,
        presence.nearest_water_distance,
    ) {
        (Some(visible), Some(any_water)) => visible.min(any_water),
        (Some(visible), None) => visible,
        (None, Some(any_water)) => any_water,
        (None, None) => return false,
    };
    nearest > disable_distance
}

fn mirrored_reflection_transform(main_transform: &Transform, water_y: f32) -> Transform {
    let mirrored_pos = Vec3::new(
        main_transform.translation.x,
        2.0 * water_y - main_transform.translation.y,
        main_transform.translation.z,
    );
    let main_forward = main_transform.forward().as_vec3();
    let mirrored_forward = Vec3::new(main_forward.x, -main_forward.y, main_forward.z);
    let main_up = main_transform.up().as_vec3();
    let mirrored_up = Vec3::new(main_up.x, -main_up.y, main_up.z);

    Transform::from_translation(mirrored_pos).looking_to(mirrored_forward, mirrored_up)
}

fn is_valid_water_reflection_candidate(world: &VoxelWorld, transform: &Transform) -> bool {
    let origin = IVec3::new(
        transform.translation.x.floor() as i32,
        transform.translation.y.floor() as i32,
        transform.translation.z.floor() as i32,
    );
    let bounds = world.bounds();
    if origin.y > bounds.max_world_y || origin.y + CHUNK_SIZE_I32 - 1 < bounds.min_world_y {
        return false;
    }
    if !bounds.contains_horizontal(origin)
        || !bounds
            .contains_horizontal(origin + IVec3::new(CHUNK_SIZE_I32 - 1, 0, CHUNK_SIZE_I32 - 1))
    {
        return false;
    }
    world.chunk_exists(VoxelWorld::world_to_chunk(origin))
}

fn water_voxel_has_valid_reflection_surface(world: &VoxelWorld, water_pos: IVec3) -> bool {
    let bounds = world.bounds();
    if !bounds.contains_world_pos(water_pos) || water_pos.y < bounds.min_world_y {
        return false;
    }
    if !matches!(
        world.sample_voxel_for_water_meshing(water_pos),
        VoxelSample::InBounds(VoxelType::Water)
    ) {
        return false;
    }
    let air_pos = water_pos + IVec3::Y;
    match world.sample_voxel_for_water_meshing(air_pos) {
        VoxelSample::OutsideAboveWorld => true,
        VoxelSample::InBounds(VoxelType::Air) => water_air_open_to_sky(world, air_pos),
        VoxelSample::OutsideBelowWorld
        | VoxelSample::OutsideHorizontalWorld
        | VoxelSample::MissingChunkInsideBounds
        | VoxelSample::InBounds(_) => false,
    }
}

fn water_air_open_to_sky(world: &VoxelWorld, air_pos: IVec3) -> bool {
    for y in air_pos.y..=world.bounds().max_world_y {
        match world.sample_voxel_for_water_meshing(IVec3::new(air_pos.x, y, air_pos.z)) {
            VoxelSample::InBounds(voxel) if voxel.is_solid() => return false,
            VoxelSample::InBounds(_) => {}
            VoxelSample::OutsideAboveWorld => return true,
            VoxelSample::OutsideBelowWorld
            | VoxelSample::OutsideHorizontalWorld
            | VoxelSample::MissingChunkInsideBounds => return false,
        }
    }
    true
}

fn water_body_allows_reflection_sampling(body_info: Option<&WaterBodyInfo>) -> bool {
    !body_info.is_some_and(|body| body.material_mode == WaterBodyMaterialMode::Hidden)
}

fn update_water_mask_camera(
    presence: Res<WaterPresence>,
    status: Res<WaterReflectionStatus>,
    main_camera: Query<
        (&Transform, &Projection),
        (
            With<PlayerCamera>,
            Without<WaterReflectionCamera>,
            Without<WaterMaskCamera>,
        ),
    >,
    mut mask_camera: Query<
        (&mut Transform, &mut Projection, &mut Camera),
        (With<WaterMaskCamera>, Without<PlayerCamera>),
    >,
) {
    let Ok((main_transform, main_projection)) = main_camera.single() else {
        return;
    };
    for (mut mask_transform, mut mask_projection, mut camera) in &mut mask_camera {
        *mask_transform = *main_transform;
        *mask_projection = main_projection.clone();
        camera.is_active = water_mask_camera_should_render(&presence, &status);
    }
}

fn water_mask_camera_should_render(
    presence: &WaterPresence,
    status: &WaterReflectionStatus,
) -> bool {
    status.sample_reflection && presence.visible_meshes > 0
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

fn water_mesh_aabb(transform: &Transform) -> OctreeAabb {
    let origin = transform.translation;
    OctreeAabb::new(
        origin,
        Vec3::new(
            origin.x + CHUNK_SIZE_I32 as f32,
            origin.y + CHUNK_SIZE_I32 as f32,
            origin.z + CHUNK_SIZE_I32 as f32,
        ),
    )
}

fn aabb_in_camera_view(
    camera_transform: &Transform,
    projection: &Projection,
    aabb: OctreeAabb,
) -> bool {
    let camera_pos = camera_transform.translation;
    if point_in_aabb(camera_pos, aabb) {
        return true;
    }

    let forward = camera_transform.forward().as_vec3();
    let min_dot = match projection {
        Projection::Perspective(_) => -0.05,
        Projection::Orthographic(_) => -0.25,
        Projection::Custom(_) => -0.05,
    };

    for point in aabb_sample_points(aabb) {
        let to_point = point - camera_pos;
        if to_point.length_squared() < 1.0 {
            return true;
        }
        if forward.dot(to_point.normalize()) >= min_dot {
            return true;
        }
    }

    false
}

fn point_in_aabb(point: Vec3, aabb: OctreeAabb) -> bool {
    point.x >= aabb.min.x
        && point.x <= aabb.max.x
        && point.y >= aabb.min.y
        && point.y <= aabb.max.y
        && point.z >= aabb.min.z
        && point.z <= aabb.max.z
}

fn aabb_sample_points(aabb: OctreeAabb) -> [Vec3; 9] {
    let min = aabb.min;
    let max = aabb.max;
    let center = aabb.center();
    [
        center,
        Vec3::new(min.x, min.y, min.z),
        Vec3::new(min.x, min.y, max.z),
        Vec3::new(min.x, max.y, min.z),
        Vec3::new(min.x, max.y, max.z),
        Vec3::new(max.x, min.y, min.z),
        Vec3::new(max.x, min.y, max.z),
        Vec3::new(max.x, max.y, min.z),
        Vec3::new(max.x, max.y, max.z),
    ]
}

fn estimate_aabb_screen_pixels(
    camera_transform: &Transform,
    projection: &Projection,
    aabb: OctreeAabb,
    window_size: Vec2,
) -> u32 {
    let clip_from_world = projection.get_clip_from_view() * camera_transform.to_matrix().inverse();
    let mut min = Vec2::splat(f32::INFINITY);
    let mut max = Vec2::splat(f32::NEG_INFINITY);
    let mut any = false;

    for point in aabb_sample_points(aabb) {
        let clip = clip_from_world * point.extend(1.0);
        if clip.w.abs() <= f32::EPSILON {
            continue;
        }
        let ndc = clip.xyz() / clip.w;
        if ndc.z < 0.0 || ndc.z > 1.0 {
            continue;
        }
        let uv = Vec2::new(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
        min = min.min(uv);
        max = max.max(uv);
        any = true;
    }

    if !any {
        return 0;
    }

    min = min.clamp(Vec2::ZERO, Vec2::ONE);
    max = max.clamp(Vec2::ZERO, Vec2::ONE);
    let extent = (max - min).max(Vec2::ZERO);
    (extent.x * window_size.x * extent.y * window_size.y)
        .round()
        .max(0.0) as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::MIN_BREAKABLE_Y;
    use crate::voxel::chunk::Chunk;

    fn loaded_world() -> VoxelWorld {
        let mut world = VoxelWorld::new(IVec3::new(1, 2, 1));
        for chunk_pos in world.all_chunk_positions().collect::<Vec<_>>() {
            world.insert_chunk(Chunk::new(chunk_pos));
        }
        world
    }

    #[test]
    fn reflection_presence_rejects_sealed_underground_water() {
        let mut world = loaded_world();
        let water_pos = IVec3::new(8, MIN_BREAKABLE_Y + 2, 8);
        world.set_voxel(water_pos, VoxelType::Water);
        world.set_voxel(water_pos + IVec3::Y, VoxelType::Rock);

        assert!(!water_voxel_has_valid_reflection_surface(&world, water_pos));
    }

    #[test]
    fn reflection_presence_accepts_open_surface_water() {
        let mut world = loaded_world();
        let water_pos = IVec3::new(8, MIN_BREAKABLE_Y + 2, 8);
        world.set_voxel(water_pos, VoxelType::Water);

        assert!(water_voxel_has_valid_reflection_surface(&world, water_pos));
    }

    #[test]
    fn reflection_transform_uses_selected_water_surface_y() {
        let main_transform = Transform::from_translation(Vec3::new(10.0, 20.0, -4.0))
            .looking_to(Vec3::new(0.25, -0.5, 1.0).normalize(), Vec3::Y);

        let reflected = mirrored_reflection_transform(&main_transform, 7.0);

        assert!((reflected.translation.y - -6.0).abs() < 0.001);
        assert!((reflected.translation.x - 10.0).abs() < 0.001);
        assert!((reflected.translation.z - -4.0).abs() < 0.001);
        assert!(reflected.forward().y > 0.0);
    }

    #[test]
    fn reflection_coverage_accepts_registered_visible_body_area() {
        let body = WaterBodyInfo {
            id: WaterBodyId(1),
            kind: WaterBodyKind::Lake,
            aabb_min: Vec3::ZERO,
            aabb_max: Vec3::splat(16.0),
            surface_y: WATER_LEVEL as f32,
            surface_area: WATER_FANCY_MIN_TRIANGLES as f32,
            max_depth: 1,
            average_depth: 1.0,
            nearest_distance: 32.0,
            visible_chunks: 1,
            chunk_count: 1,
            material_mode: WaterBodyMaterialMode::Cheap,
            reflection_strength: 0.5,
            fresnel_power: 4.0,
            distortion_strength: 0.004,
        };

        assert!(water_reflection_has_enough_coverage(
            0,
            None,
            Some(&body),
            false
        ));
        assert!(water_reflection_has_enough_coverage(0, None, None, true));
    }

    #[test]
    fn reflection_sampling_skips_hidden_water_bodies_only() {
        let mut body = WaterBodyInfo {
            id: WaterBodyId(1),
            kind: WaterBodyKind::Ocean,
            aabb_min: Vec3::ZERO,
            aabb_max: Vec3::splat(16.0),
            surface_y: WATER_LEVEL as f32,
            surface_area: 256.0,
            max_depth: 8,
            average_depth: 8.0,
            nearest_distance: 96.0,
            visible_chunks: 1,
            chunk_count: 1,
            material_mode: WaterBodyMaterialMode::Fancy,
            reflection_strength: 0.85,
            fresnel_power: 5.0,
            distortion_strength: 0.006,
        };

        assert!(water_body_allows_reflection_sampling(Some(&body)));
        body.material_mode = WaterBodyMaterialMode::Cheap;
        assert!(water_body_allows_reflection_sampling(Some(&body)));
        body.material_mode = WaterBodyMaterialMode::Hidden;
        assert!(!water_body_allows_reflection_sampling(Some(&body)));
        assert!(water_body_allows_reflection_sampling(None));
    }

    #[test]
    fn reflection_auto_disable_distance_has_chunk_grace() {
        let config = WaterReflectionConfig {
            auto_disable_distance: 120.0,
            ..default()
        };

        assert_eq!(effective_water_reflection_disable_distance(&config), 136.0);
    }

    #[test]
    fn reflection_range_uses_nearest_water_when_visible_chunk_is_farther() {
        let config = WaterReflectionConfig {
            auto_disable_distance: 120.0,
            ..default()
        };
        let presence = WaterPresence {
            nearest_visible_distance: Some(148.0),
            nearest_water_distance: Some(116.0),
            ..default()
        };

        assert!(!reflection_presence_out_of_range(&presence, &config));
    }

    #[test]
    fn water_mask_camera_follows_reflection_sampling_status() {
        let presence = WaterPresence {
            visible_meshes: 1,
            eligible_meshes: 1,
            ..default()
        };
        let mut status = WaterReflectionStatus {
            active: false,
            sample_reflection: true,
            reason: WaterReflectionReason::Throttled,
            ..default()
        };

        assert!(water_mask_camera_should_render(&presence, &status));

        status.sample_reflection = false;
        status.reason = WaterReflectionReason::TooSmall;

        assert!(!water_mask_camera_should_render(&presence, &status));
        assert!(!water_mask_camera_should_render(
            &WaterPresence::default(),
            &status
        ));
    }
}
