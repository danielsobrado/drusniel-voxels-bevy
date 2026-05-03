use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use bevy::app::ScheduleRunnerPlugin;
use bevy::asset::{LoadState, RenderAssetUsages};
use bevy::camera::{RenderTarget, ScalingMode};
use bevy::core_pipeline::tonemapping::Tonemapping;
use bevy::log::LogPlugin;
use bevy::pbr::MaterialPlugin;
use bevy::prelude::*;
use bevy::render::gpu_readback::{Readback, ReadbackComplete};
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};
use bevy::window::{ExitCondition, WindowPlugin};
use bevy::winit::WinitPlugin;
use clap::Parser;
use image as image_crate;
use image_crate::{ImageBuffer, Rgba};
use voxel_builder::config::loader::load_config;
use voxel_builder::constants::BILLBOARD_ALPHA_CUTOFF;
use voxel_builder::props::billboard::{
    BillboardAlphaCoverage, BillboardMetadata, BillboardMode, BillboardSourceBounds,
};
use voxel_builder::props::instancing::{self, CachedPropMesh, PropMeshCache};
use voxel_builder::props::{PropAssets, PropConfig, PropDefinition};
use voxel_builder::rendering::props_material::PropsMaterial;

const PROPS_CONFIG_PATH: &str = "config/props.yaml";
const OUTPUT_DIR: &str = "assets/textures/billboards/generated";

#[derive(Parser, Debug, Clone)]
#[command(about = "Bake transparent tree impostor billboard textures from prop GLTF assets")]
struct BakeCli {
    #[arg(long, default_value_t = 512)]
    size: u32,
    #[arg(long, default_value_t = 8)]
    directions: usize,
    #[arg(long, default_value_t = 12)]
    padding: u32,
    #[arg(long, default_value_t = 2)]
    dilate: u32,
    #[arg(long, default_value_t = 30)]
    preroll_frames: u32,
    #[arg(long)]
    prop_id: Option<String>,
    #[arg(long)]
    allow_fallback_bounds: bool,
    #[arg(long, default_value_t = 0.002)]
    min_alpha_coverage: f32,
    #[arg(long, default_value_t = 0.85)]
    max_alpha_coverage: f32,
}

#[derive(Resource)]
struct BakeSettings(BakeCli);

#[derive(Resource)]
struct BakeState {
    props: Vec<PropDefinition>,
    prop_index: usize,
    direction_index: usize,
    phase: BakePhase,
    target: Handle<Image>,
    camera: Entity,
    scene_root: Option<Entity>,
    current_prop: Option<CurrentProp>,
}

#[derive(Clone, Copy, Debug)]
enum BakePhase {
    WaitingForMeshes,
    StartDirection,
    Rendering { frames_left: u32 },
    WaitingReadback,
    Done,
}

#[derive(Clone)]
struct CurrentProp {
    prop_id: String,
    width: f32,
    height: f32,
    y_offset: f32,
    bounds: Bounds,
    texture_paths: Vec<String>,
    coverages: Vec<f32>,
}

#[derive(Clone, Copy, Debug)]
struct Bounds {
    min: Vec3,
    max: Vec3,
}

impl Bounds {
    fn center(self) -> Vec3 {
        (self.min + self.max) * 0.5
    }

    fn height(self) -> f32 {
        (self.max.y - self.min.y).max(0.001)
    }

    fn xz_diameter(self) -> f32 {
        (self.max.x - self.min.x)
            .abs()
            .max((self.max.z - self.min.z).abs())
            .max(0.001)
    }
}

fn main() {
    let settings = BakeCli::parse();
    if !matches!(settings.directions, 1 | 4 | 8) {
        eprintln!("--directions must be 1, 4, or 8");
        std::process::exit(2);
    }

    App::new()
        .insert_resource(BakeSettings(settings))
        .add_plugins(
            DefaultPlugins
                .set(LogPlugin::default())
                .set(ImagePlugin::default_nearest())
                .set(WindowPlugin {
                    primary_window: None,
                    exit_condition: ExitCondition::DontExit,
                    ..default()
                })
                .disable::<WinitPlugin>(),
        )
        .add_plugins(ScheduleRunnerPlugin::run_loop(Duration::from_secs_f64(
            1.0 / 60.0,
        )))
        .add_plugins(MaterialPlugin::<PropsMaterial>::default())
        .init_resource::<PropAssets>()
        .init_resource::<PropMeshCache>()
        .add_systems(Startup, setup)
        .add_systems(
            Update,
            (
                track_asset_loading,
                instancing::extract_prop_meshes,
                drive_baker.after(instancing::extract_prop_meshes),
            )
                .chain(),
        )
        .run();
}

fn setup(
    mut commands: Commands,
    settings: Res<BakeSettings>,
    asset_server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
    mut prop_assets: ResMut<PropAssets>,
) {
    fs::create_dir_all(OUTPUT_DIR).expect("failed to create billboard output directory");

    let config: PropConfig = load_config(PROPS_CONFIG_PATH)
        .unwrap_or_else(|err| panic!("failed to load {PROPS_CONFIG_PATH}: {err}"));
    let mut props = config.props.trees.clone();
    if let Some(prop_id) = settings.0.prop_id.as_deref() {
        props.retain(|prop| prop.id == prop_id);
    }
    if props.is_empty() {
        panic!("no tree props matched the bake request");
    }

    for prop in &props {
        let scene_path = format!("{}#Scene0", prop.path);
        prop_assets
            .scenes
            .insert(prop.id.clone(), asset_server.load(scene_path));
    }

    let target = create_render_target(settings.0.size, &mut images);
    let camera = commands
        .spawn((
            Camera3d::default(),
            Camera {
                clear_color: ClearColorConfig::Custom(Color::srgba(0.0, 0.0, 0.0, 0.0)),
                ..default()
            },
            RenderTarget::Image(target.clone().into()),
            Projection::Orthographic(OrthographicProjection {
                scaling_mode: ScalingMode::FixedVertical {
                    viewport_height: 10.0,
                },
                near: 0.0,
                far: 1000.0,
                ..OrthographicProjection::default_3d()
            }),
            Tonemapping::None,
            Transform::from_xyz(0.0, 0.0, 20.0).looking_at(Vec3::ZERO, Vec3::Y),
        ))
        .id();

    commands.spawn((
        DirectionalLight {
            illuminance: 12_000.0,
            shadows_enabled: false,
            ..default()
        },
        Transform::from_rotation(Quat::from_euler(EulerRot::XYZ, -0.9, -0.6, 0.0)),
    ));
    commands.insert_resource(GlobalAmbientLight {
        color: Color::srgb(0.75, 0.78, 0.82),
        brightness: 350.0,
        ..default()
    });
    commands.insert_resource(config);
    commands.insert_resource(BakeState {
        props,
        prop_index: 0,
        direction_index: 0,
        phase: BakePhase::WaitingForMeshes,
        target,
        camera,
        scene_root: None,
        current_prop: None,
    });
}

fn create_render_target(size: u32, images: &mut Assets<Image>) -> Handle<Image> {
    let extent = Extent3d {
        width: size,
        height: size,
        depth_or_array_layers: 1,
    };
    let mut image = Image::new_fill(
        extent,
        TextureDimension::D2,
        &[0, 0, 0, 0],
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    );
    image.texture_descriptor.usage = TextureUsages::TEXTURE_BINDING
        | TextureUsages::COPY_DST
        | TextureUsages::COPY_SRC
        | TextureUsages::RENDER_ATTACHMENT;
    images.add(image)
}

fn track_asset_loading(asset_server: Res<AssetServer>, mut prop_assets: ResMut<PropAssets>) {
    if prop_assets.loaded || prop_assets.scenes.is_empty() {
        return;
    }
    let total = prop_assets.scenes.len();
    let mut loaded = 0usize;
    let mut failed = 0usize;
    for (id, handle) in &prop_assets.scenes {
        match asset_server.get_load_state(handle.id()) {
            Some(LoadState::Loaded) => loaded += 1,
            Some(LoadState::Failed(_)) => {
                error!("Failed to load prop scene {id}");
                failed += 1;
            }
            _ => {}
        }
    }
    if loaded + failed == total {
        prop_assets.loaded = true;
    }
}

fn drive_baker(
    mut commands: Commands,
    settings: Res<BakeSettings>,
    mut state: ResMut<BakeState>,
    cache: Res<PropMeshCache>,
    mut camera_query: Query<(&mut Transform, &mut Projection)>,
    mut exit: MessageWriter<AppExit>,
) {
    match state.phase {
        BakePhase::WaitingForMeshes => {
            if cache.is_ready() {
                state.phase = BakePhase::StartDirection;
            }
        }
        BakePhase::StartDirection => {
            if state.prop_index >= state.props.len() {
                info!("Impostor bake complete");
                state.phase = BakePhase::Done;
                exit.write(AppExit::Success);
                return;
            }
            start_direction(
                &mut commands,
                &settings.0,
                &mut state,
                &cache,
                &mut camera_query,
            );
        }
        BakePhase::Rendering { frames_left } => {
            if frames_left == 0 {
                commands
                    .spawn(Readback::texture(state.target.clone()))
                    .observe(handle_readback);
                state.phase = BakePhase::WaitingReadback;
            } else {
                state.phase = BakePhase::Rendering {
                    frames_left: frames_left - 1,
                };
            }
        }
        BakePhase::WaitingReadback | BakePhase::Done => {}
    }
}

fn start_direction(
    commands: &mut Commands,
    settings: &BakeCli,
    state: &mut BakeState,
    cache: &PropMeshCache,
    camera_query: &mut Query<(&mut Transform, &mut Projection)>,
) {
    if let Some(root) = state.scene_root.take() {
        commands.entity(root).despawn();
    }

    let prop = &state.props[state.prop_index];
    let Some(meshes) = cache.get_cached(&prop.id) else {
        warn!(
            "Skipping '{}' because no cached meshes were extracted",
            prop.id
        );
        state.prop_index += 1;
        state.direction_index = 0;
        state.current_prop = None;
        state.phase = BakePhase::StartDirection;
        return;
    };
    let Some(bounds) = combined_bounds(meshes, settings.allow_fallback_bounds) else {
        warn!(
            "Skipping '{}' because one or more mesh bounds were missing",
            prop.id
        );
        state.prop_index += 1;
        state.direction_index = 0;
        state.current_prop = None;
        state.phase = BakePhase::StartDirection;
        return;
    };

    if state.current_prop.is_none() {
        state.current_prop = Some(CurrentProp {
            prop_id: prop.id.clone(),
            width: bounds.xz_diameter(),
            height: bounds.height(),
            y_offset: bounds.min.y,
            bounds,
            texture_paths: Vec::with_capacity(settings.directions),
            coverages: Vec::with_capacity(settings.directions),
        });
        info!(
            "Baking '{}' ({}/{})",
            prop.id,
            state.prop_index + 1,
            state.props.len()
        );
    }

    let root = spawn_prop_meshes(commands, meshes, bounds.center());
    state.scene_root = Some(root);

    let fit = bounds.height().max(bounds.xz_diameter()) * 1.16;
    let radius = bounds.xz_diameter().max(bounds.height()) * 2.0 + 10.0;
    let angle = state.direction_index as f32 * std::f32::consts::TAU / settings.directions as f32;
    let camera_pos = Vec3::new(angle.sin() * radius, 0.0, angle.cos() * radius);
    if let Ok((mut transform, mut projection)) = camera_query.get_mut(state.camera) {
        *transform = Transform::from_translation(camera_pos).looking_at(Vec3::ZERO, Vec3::Y);
        *projection = Projection::Orthographic(OrthographicProjection {
            scaling_mode: ScalingMode::FixedVertical {
                viewport_height: fit,
            },
            near: 0.0,
            far: radius * 3.0,
            ..OrthographicProjection::default_3d()
        });
    }

    state.phase = BakePhase::Rendering {
        frames_left: settings.preroll_frames,
    };
}

fn spawn_prop_meshes(
    commands: &mut Commands,
    meshes: &[CachedPropMesh],
    bounds_center: Vec3,
) -> Entity {
    let root = commands
        .spawn((
            Transform::from_translation(-bounds_center),
            GlobalTransform::default(),
            Visibility::Inherited,
        ))
        .id();
    for cached in meshes {
        let child = commands
            .spawn((
                Mesh3d(cached.mesh.clone()),
                MeshMaterial3d(cached.material.clone()),
                cached.local_transform,
                Visibility::Inherited,
            ))
            .id();
        commands.entity(root).add_child(child);
    }
    root
}

fn handle_readback(
    event: On<ReadbackComplete>,
    mut commands: Commands,
    settings: Res<BakeSettings>,
    mut state: ResMut<BakeState>,
) {
    commands.entity(event.entity).despawn();

    let Some(mut current) = state.current_prop.take() else {
        state.phase = BakePhase::StartDirection;
        return;
    };

    match cleanup_and_save_direction(
        &settings.0,
        &current.prop_id,
        state.direction_index,
        &event.data,
    ) {
        Ok((texture_path, coverage)) => {
            current.texture_paths.push(texture_path);
            current.coverages.push(coverage);
            state.direction_index += 1;
            if state.direction_index >= settings.0.directions {
                if let Err(err) = write_metadata(&settings.0, &current) {
                    error!("Failed to write metadata for '{}': {err}", current.prop_id);
                }
                state.prop_index += 1;
                state.direction_index = 0;
                state.current_prop = None;
            } else {
                state.current_prop = Some(current);
            }
        }
        Err(err) => {
            error!(
                "Rejected '{}' direction {}: {err}",
                current.prop_id, state.direction_index
            );
            state.prop_index += 1;
            state.direction_index = 0;
            state.current_prop = None;
        }
    }
    state.phase = BakePhase::StartDirection;
}

fn cleanup_and_save_direction(
    settings: &BakeCli,
    prop_id: &str,
    direction: usize,
    readback: &[u8],
) -> Result<(String, f32), String> {
    let raw = strip_aligned_rows(readback, settings.size, settings.size);
    let mut image: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(settings.size, settings.size, raw)
            .ok_or_else(|| "readback size did not match target dimensions".to_string())?;

    let coverage = alpha_coverage(&image, BILLBOARD_ALPHA_CUTOFF);
    if coverage < settings.min_alpha_coverage {
        return Err(format!("alpha coverage too low ({coverage:.4})"));
    }
    if coverage > settings.max_alpha_coverage {
        return Err(format!("alpha coverage too high ({coverage:.4})"));
    }

    image = crop_alpha(&image, settings.padding)?;
    dilate_transparent_rgb(&mut image, settings.dilate);

    let relative_path = format!("textures/billboards/generated/{prop_id}_dir{direction}.png");
    let disk_path = Path::new("assets").join(&relative_path);
    image
        .save(&disk_path)
        .map_err(|err| format!("failed to save {:?}: {err}", disk_path))?;
    Ok((format!("assets/{relative_path}"), coverage))
}

fn strip_aligned_rows(readback: &[u8], width: u32, height: u32) -> Vec<u8> {
    let row_bytes = width as usize * 4;
    let aligned_row_bytes = row_bytes.div_ceil(256) * 256;
    if row_bytes == aligned_row_bytes {
        return readback.to_vec();
    }
    readback
        .chunks(aligned_row_bytes)
        .take(height as usize)
        .flat_map(|row| row[..row_bytes.min(row.len())].iter().copied())
        .collect()
}

fn alpha_coverage(image: &ImageBuffer<Rgba<u8>, Vec<u8>>, cutoff: f32) -> f32 {
    let cutoff = (cutoff.clamp(0.0, 1.0) * 255.0).round() as u8;
    let covered = image.pixels().filter(|pixel| pixel[3] >= cutoff).count();
    covered as f32 / (image.width() * image.height()) as f32
}

fn crop_alpha(
    image: &ImageBuffer<Rgba<u8>, Vec<u8>>,
    padding: u32,
) -> Result<ImageBuffer<Rgba<u8>, Vec<u8>>, String> {
    let mut min_x = image.width();
    let mut min_y = image.height();
    let mut max_x = 0_u32;
    let mut max_y = 0_u32;
    for (x, y, pixel) in image.enumerate_pixels() {
        if pixel[3] > 0 {
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            max_x = max_x.max(x);
            max_y = max_y.max(y);
        }
    }
    if min_x > max_x || min_y > max_y {
        return Err("image is fully transparent".to_string());
    }

    min_x = min_x.saturating_sub(padding);
    min_y = min_y.saturating_sub(padding);
    max_x = (max_x + padding).min(image.width() - 1);
    max_y = (max_y + padding).min(image.height() - 1);

    let width = max_x - min_x + 1;
    let height = max_y - min_y + 1;
    let mut cropped = ImageBuffer::from_pixel(width, height, Rgba([0, 0, 0, 0]));
    for y in 0..height {
        for x in 0..width {
            *cropped.get_pixel_mut(x, y) = *image.get_pixel(min_x + x, min_y + y);
        }
    }
    Ok(cropped)
}

fn dilate_transparent_rgb(image: &mut ImageBuffer<Rgba<u8>, Vec<u8>>, iterations: u32) {
    for _ in 0..iterations {
        let source = image.clone();
        for y in 0..image.height() {
            for x in 0..image.width() {
                if source.get_pixel(x, y)[3] != 0 {
                    continue;
                }
                let mut rgb = [0_u32; 3];
                let mut count = 0_u32;
                for ny in y.saturating_sub(1)..=(y + 1).min(image.height() - 1) {
                    for nx in x.saturating_sub(1)..=(x + 1).min(image.width() - 1) {
                        let pixel = source.get_pixel(nx, ny);
                        if pixel[3] > 0 {
                            rgb[0] += pixel[0] as u32;
                            rgb[1] += pixel[1] as u32;
                            rgb[2] += pixel[2] as u32;
                            count += 1;
                        }
                    }
                }
                if count > 0 {
                    *image.get_pixel_mut(x, y) = Rgba([
                        (rgb[0] / count) as u8,
                        (rgb[1] / count) as u8,
                        (rgb[2] / count) as u8,
                        0,
                    ]);
                }
            }
        }
    }
}

fn write_metadata(settings: &BakeCli, current: &CurrentProp) -> Result<(), String> {
    let min = current
        .coverages
        .iter()
        .copied()
        .fold(f32::INFINITY, f32::min);
    let max = current.coverages.iter().copied().fold(0.0_f32, f32::max);
    let mean = current.coverages.iter().sum::<f32>() / current.coverages.len().max(1) as f32;
    let mode = match settings.directions {
        1 => BillboardMode::SingleAxial,
        4 => BillboardMode::Directional4,
        8 => BillboardMode::Directional8,
        _ => unreachable!(),
    };
    let metadata = BillboardMetadata {
        prop_id: current.prop_id.clone(),
        mode,
        texture_paths: current.texture_paths.clone(),
        width: current.width,
        height: current.height,
        y_offset: current.y_offset,
        alpha_cutoff: BILLBOARD_ALPHA_CUTOFF,
        source_bounds: BillboardSourceBounds {
            min: current.bounds.min.to_array(),
            max: current.bounds.max.to_array(),
        },
        generated_image_resolution: [settings.size, settings.size],
        alpha_coverage: BillboardAlphaCoverage { min, max, mean },
    };
    let ron = ron::ser::to_string_pretty(&metadata, ron::ser::PrettyConfig::default())
        .map_err(|err| err.to_string())?;
    let path = PathBuf::from(OUTPUT_DIR).join(format!("{}.billboard.ron", current.prop_id));
    fs::write(&path, ron).map_err(|err| format!("failed to write {:?}: {err}", path))?;
    info!(
        "Wrote {} textures and metadata for '{}'",
        current.texture_paths.len(),
        current.prop_id
    );
    Ok(())
}

fn combined_bounds(meshes: &[CachedPropMesh], allow_fallback: bool) -> Option<Bounds> {
    let mut min = Vec3::splat(f32::INFINITY);
    let mut max = Vec3::splat(f32::NEG_INFINITY);
    let mut any = false;
    for mesh in meshes {
        if !mesh.bounds_from_mesh && !allow_fallback {
            return None;
        }
        let matrix = mesh.local_transform.to_matrix();
        for corner in aabb_corners(mesh.local_aabb_min, mesh.local_aabb_max) {
            let transformed = matrix.transform_point3(corner);
            min = min.min(transformed);
            max = max.max(transformed);
            any = true;
        }
    }
    any.then_some(Bounds { min, max })
}

fn aabb_corners(min: Vec3, max: Vec3) -> [Vec3; 8] {
    [
        Vec3::new(min.x, min.y, min.z),
        Vec3::new(max.x, min.y, min.z),
        Vec3::new(min.x, max.y, min.z),
        Vec3::new(max.x, max.y, min.z),
        Vec3::new(min.x, min.y, max.z),
        Vec3::new(max.x, min.y, max.z),
        Vec3::new(min.x, max.y, max.z),
        Vec3::new(max.x, max.y, max.z),
    ]
}
