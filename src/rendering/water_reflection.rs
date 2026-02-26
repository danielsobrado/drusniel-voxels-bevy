use bevy::camera::ClearColorConfig;
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::prelude::*;
use bevy::camera::RenderTarget;
use bevy::render::render_resource::{
    Extent3d, TextureDescriptor, TextureDimension, TextureFormat, TextureUsages,
};
use bevy::camera::visibility::RenderLayers;
use bevy::render::view::Hdr;

use crate::camera::controller::PlayerCamera;
use crate::constants::WATER_LEVEL;
use crate::rendering::capabilities::GraphicsCapabilities;

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
}

/// Resource tracking frame counter for temporal amortization
#[derive(Resource, Default)]
struct ReflectionFrameCounter {
    frame: u32,
}

pub struct WaterReflectionPlugin;

impl Plugin for WaterReflectionPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ReflectionFrameCounter>()
            .add_systems(Startup, setup_reflection_camera)
            .add_systems(
                Update,
                (
                    update_reflection_camera,
                    toggle_reflection_camera,
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
    capabilities: Option<Res<GraphicsCapabilities>>,
    water_config: Option<Res<crate::rendering::water::WaterConfig>>,
) {
    let integrated = capabilities
        .as_ref()
        .map(|c| c.integrated_gpu)
        .unwrap_or(false);

    let config = water_config
        .as_ref()
        .map(|c| c.reflections.clone())
        .unwrap_or_default();

    // Skip reflection setup on integrated GPUs
    if integrated || !config.enabled {
        info!("Water reflections disabled (integrated GPU or config)");
        return;
    }

    // Create half-resolution render target
    let width = (1920.0 * config.resolution_scale) as u32;
    let height = (1080.0 * config.resolution_scale) as u32;
    let image_handle = create_reflection_image(&mut images, width, height);

    commands.insert_resource(WaterReflectionTexture {
        image: image_handle.clone(),
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
            is_active: config.enabled,
            ..default()
        },
        RenderTarget::Image(image_handle.into()),
        Projection::Perspective(PerspectiveProjection {
            near: 0.1,
            far: config.max_render_distance,
            ..default()
        }),
        // Initial transform — updated each frame to mirror main camera
        Transform::from_xyz(0.0, water_y, 0.0).looking_at(Vec3::new(0.0, water_y + 1.0, -1.0), Vec3::Y),
        RenderLayers::layer(REFLECTION_RENDER_LAYER),
        Hdr,
        Tonemapping::AcesFitted,
        Msaa::Off,
    ));

    info!(
        "Water reflection camera created at {}x{} (scale: {})",
        width, height, config.resolution_scale
    );
}

/// Mirror the main camera's position and rotation across the water plane each frame
fn update_reflection_camera(
    water_config: Option<Res<crate::rendering::water::WaterConfig>>,
    mut frame_counter: ResMut<ReflectionFrameCounter>,
    main_camera: Query<&Transform, (With<PlayerCamera>, Without<WaterReflectionCamera>)>,
    mut reflection_camera: Query<
        (&mut Transform, &mut Camera),
        (With<WaterReflectionCamera>, Without<PlayerCamera>),
    >,
) {
    let Ok(main_transform) = main_camera.single() else {
        return;
    };
    let Ok((mut refl_transform, mut refl_camera)) = reflection_camera.single_mut() else {
        return;
    };

    let config = water_config
        .as_ref()
        .map(|c| c.reflections.clone())
        .unwrap_or_default();

    // Temporal amortization: skip rendering on some frames
    frame_counter.frame += 1;
    if config.update_every_n_frames > 1 {
        refl_camera.is_active = frame_counter.frame % config.update_every_n_frames == 0;
    }

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
}

/// Toggle reflection camera based on config/capabilities changes
fn toggle_reflection_camera(
    water_config: Option<Res<crate::rendering::water::WaterConfig>>,
    capabilities: Option<Res<GraphicsCapabilities>>,
    mut reflection_camera: Query<&mut Camera, With<WaterReflectionCamera>>,
) {
    let Some(config) = water_config else { return };
    if !config.is_changed() {
        return;
    }

    let integrated = capabilities
        .as_ref()
        .map(|c| c.integrated_gpu)
        .unwrap_or(false);

    for mut camera in reflection_camera.iter_mut() {
        camera.is_active = config.reflections.enabled && !integrated;
    }
}
