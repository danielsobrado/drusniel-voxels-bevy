use crate::camera::controller::PlayerCamera;
use crate::menu::PauseMenuState;
use crate::voxel::world::VoxelWorld;
use bevy::prelude::*;
use bevy::asset::RenderAssetUsages;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::ui::{
    AlignItems, FlexDirection, JustifyContent, PositionType, Val,
};

pub struct MapPlugin;

#[derive(Resource, Default)]
pub struct MapState {
    pub open: bool,
    pub root_entity: Option<Entity>,
    pub map_texture: Option<Handle<Image>>,
}

#[derive(Component)]
struct MapRoot;

#[derive(Component)]
struct MapPlayerMarker;

#[derive(Component)]
struct MapCoordinatesText;

const MAP_SIZE: f32 = 512.0;
const MARKER_SIZE: f32 = 10.0;

impl Plugin for MapPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<MapState>().add_systems(
            Update,
            (
                toggle_map_overlay,
                update_player_marker,
                update_coordinates_text,
            ),
        );
    }
}

fn toggle_map_overlay(
    keys: Res<ButtonInput<KeyCode>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut images: ResMut<Assets<Image>>,
    mut state: ResMut<MapState>,
    world: Res<VoxelWorld>,
    pause_menu: Res<PauseMenuState>,
) {
    if !keys.just_pressed(KeyCode::KeyM) {
        return;
    }

    if keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight) {
        return;
    }

    if state.open {
        if let Some(entity) = state.root_entity.take() {
            commands.entity(entity).despawn();
        }
        state.open = false;
        return;
    }

    if pause_menu.open {
        return;
    }

    let existing_handle = state.map_texture.take();
    let texture = match existing_handle {
        Some(handle) => {
            if update_map_texture(&mut images, &handle, &world) {
                let texture = handle.clone();
                state.map_texture = Some(handle);
                texture
            } else {
                images.remove(&handle);
                let new_handle = create_map_texture(&mut images, &world);
                state.map_texture = Some(new_handle.clone());
                new_handle
            }
        }
        None => {
            let new_handle = create_map_texture(&mut images, &world);
            state.map_texture = Some(new_handle.clone());
            new_handle
        }
    };

    let root_entity = commands
        .spawn((
            Node {
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                position_type: PositionType::Absolute,
                ..default()
            },
            BackgroundColor(Color::srgba(0.02, 0.02, 0.05, 0.85)),
            MapRoot,
        ))
        .with_children(|parent| {
            parent
                .spawn((
                    Node {
                        width: Val::Px(MAP_SIZE + 40.0),
                        padding: UiRect::all(Val::Px(16.0)),
                        flex_direction: FlexDirection::Column,
                        row_gap: Val::Px(12.0),
                        align_items: AlignItems::Center,
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.06, 0.08, 0.12, 0.9)),
                ))
                .with_children(|parent| {
                    parent.spawn((
                        Text::new("World Map (Press M to close)"),
                        TextFont {
                            font: asset_server.load("fonts/FiraSans-Bold.ttf"),
                            font_size: 22.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));

                    parent
                        .spawn((
                            Node {
                                width: Val::Px(MAP_SIZE),
                                height: Val::Px(MAP_SIZE),
                                position_type: PositionType::Relative,
                                ..default()
                            },
                            BackgroundColor(Color::srgb(0.06, 0.1, 0.16)),
                        ))
                        .with_children(|parent| {
                            parent.spawn((
                                Node {
                                    width: Val::Percent(100.0),
                                    height: Val::Percent(100.0),
                                    ..default()
                                },
                                ImageNode::new(texture),
                            ));

                            parent.spawn((
                                Node {
                                    width: Val::Px(MARKER_SIZE),
                                    height: Val::Px(MARKER_SIZE),
                                    position_type: PositionType::Absolute,
                                    left: Val::Px(0.0),
                                    top: Val::Px(0.0),
                                    ..default()
                                },
                                BackgroundColor(Color::srgb(0.9, 0.1, 0.2)),
                                MapPlayerMarker,
                            ));
                        });

                    parent.spawn((
                        Text::new("Position: --"),
                        TextFont {
                            font: asset_server.load("fonts/FiraSans-Bold.ttf"),
                            font_size: 18.0,
                            ..default()
                        },
                        TextColor(Color::srgb(0.9, 0.9, 0.9)),
                        MapCoordinatesText,
                    ));
                });
        })
        .id();

    state.root_entity = Some(root_entity);
    state.open = true;
}

fn update_player_marker(
    state: Res<MapState>,
    world: Res<VoxelWorld>,
    mut marker_query: Query<&mut Node, With<MapPlayerMarker>>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
) {
    if !state.open {
        return;
    }

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let world_size = world.world_size_chunks();
    if world_size.x <= 0 || world_size.z <= 0 {
        return;
    }

    let player_chunk = VoxelWorld::world_to_chunk(camera_transform.translation.as_ivec3());
    let x_ratio = (player_chunk.x as f32 / world_size.x as f32).clamp(0.0, 1.0);
    let z_ratio = (player_chunk.z as f32 / world_size.z as f32).clamp(0.0, 1.0);

    let left = x_ratio * MAP_SIZE - (MARKER_SIZE * 0.5);
    let top = (1.0 - z_ratio) * MAP_SIZE - (MARKER_SIZE * 0.5);

    if let Ok(mut node) = marker_query.single_mut() {
        node.left = Val::Px(left);
        node.top = Val::Px(top);
    }
}

fn update_coordinates_text(
    state: Res<MapState>,
    mut text_query: Query<&mut Text, With<MapCoordinatesText>>,
    camera_query: Query<&Transform, With<PlayerCamera>>,
) {
    if !state.open {
        return;
    }

    let Ok(mut text) = text_query.single_mut() else {
        return;
    };

    let Ok(camera_transform) = camera_query.single() else {
        return;
    };

    let pos = camera_transform.translation;
    text.0 = format!(
        "Position: x: {:.1}, y: {:.1}, z: {:.1}",
        pos.x, pos.y, pos.z
    );
}

fn create_map_texture(images: &mut Assets<Image>, world: &VoxelWorld) -> Handle<Image> {
    let (width, height) = map_dimensions(world);
    let data = build_map_data(world, width, height);

    let mut image = Image::new_fill(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        &data,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD,
    );

    image.sampler = ImageSampler::Descriptor(ImageSamplerDescriptor {
        address_mode_u: ImageAddressMode::ClampToEdge,
        address_mode_v: ImageAddressMode::ClampToEdge,
        address_mode_w: ImageAddressMode::ClampToEdge,
        mag_filter: ImageFilterMode::Nearest,
        min_filter: ImageFilterMode::Nearest,
        mipmap_filter: ImageFilterMode::Nearest,
        ..default()
    });

    images.add(image)
}

fn update_map_texture(
    images: &mut Assets<Image>,
    handle: &Handle<Image>,
    world: &VoxelWorld,
) -> bool {
    let (width, height) = map_dimensions(world);
    let Some(image) = images.get_mut(handle) else {
        return false;
    };

    let size = image.texture_descriptor.size;
    if size.width != width || size.height != height || size.depth_or_array_layers != 1 {
        return false;
    }

    image.data = Some(build_map_data(world, width, height));
    true
}

fn map_dimensions(world: &VoxelWorld) -> (u32, u32) {
    let world_size = world.world_size_chunks();
    let width = world_size.x.max(1) as u32;
    let height = world_size.z.max(1) as u32;
    (width, height)
}

fn build_map_data(world: &VoxelWorld, width: u32, height: u32) -> Vec<u8> {
    let world_size = world.world_size_chunks();
    let mut data = vec![0; (width * height * 4) as usize];
    for z in 0..height {
        for x in 0..width {
            let mut has_chunk = false;
            for y in 0..world_size.y {
                if world.chunk_exists(IVec3::new(x as i32, y, z as i32)) {
                    has_chunk = true;
                    break;
                }
            }

            let idx = ((z * width + x) * 4) as usize;
            let color = if has_chunk {
                [72, 141, 113, 255]
            } else {
                [18, 24, 34, 255]
            };

            data[idx..idx + 4].copy_from_slice(&color);
        }
    }
    data
}
