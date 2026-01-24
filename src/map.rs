use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32};
use crate::menu::PauseMenuState;
use crate::props::LandmarkLocations;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::ui::{AlignItems, FlexDirection, JustifyContent, PositionType, Val};

pub struct MapPlugin;

#[derive(Resource, Default)]
pub struct MapState {
    pub open: bool,
    pub root_entity: Option<Entity>,
    pub map_texture: Option<Handle<Image>>,
    pub map_container: Option<Entity>,
}

#[derive(Component)]
struct MapRoot;

#[derive(Component)]
struct MapPlayerMarker;

#[derive(Component)]
struct MapLandmarkMarker {
    world_pos: Vec3,
}

#[derive(Component)]
struct MapCoordinatesText;

const MAP_SIZE: f32 = 512.0;
const MARKER_SIZE: f32 = 10.0;
const LANDMARK_MARKER_SIZE: f32 = 8.0;

impl Plugin for MapPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<MapState>().add_systems(
            Update,
            (
                toggle_map_overlay,
                update_player_marker,
                update_landmark_markers,
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
    landmarks: Res<LandmarkLocations>,
) {
    // ESC closes the map
    if state.open && keys.just_pressed(KeyCode::Escape) {
        if let Some(entity) = state.root_entity.take() {
            commands.entity(entity).despawn();
        }
        state.map_container = None;
        state.open = false;
        return;
    }

    // M opens the map (only when not already open)
    if !keys.just_pressed(KeyCode::KeyM) {
        return;
    }

    if keys.pressed(KeyCode::ShiftLeft) || keys.pressed(KeyCode::ShiftRight) {
        return;
    }

    if state.open {
        return; // Already open, use ESC to close
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
                        Text::new("World Map (Press ESC to close)"),
                        TextFont {
                            font: asset_server.load("fonts/FiraSans-Bold.ttf"),
                            font_size: 22.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));

                    let map_container = parent
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

                            for landmark in landmarks.positions.iter() {
                                spawn_landmark_marker(parent, &world, *landmark);
                            }
                        })
                        .id();

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

                    state.map_container = Some(map_container);
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

    let pos = camera_transform.translation;
    let Some((left, top)) = world_to_map_pos(&world, pos, MARKER_SIZE) else {
        return;
    };

    if let Ok(mut node) = marker_query.single_mut() {
        node.left = Val::Px(left);
        node.top = Val::Px(top);
    }
}

fn update_landmark_markers(
    mut commands: Commands,
    state: Res<MapState>,
    world: Res<VoxelWorld>,
    landmarks: Res<LandmarkLocations>,
    marker_query: Query<Entity, With<MapLandmarkMarker>>,
) {
    if !state.open {
        return;
    }

    let Some(container) = state.map_container else {
        return;
    };

    if landmarks.positions.is_empty() {
        return;
    }

    if marker_query.iter().count() == landmarks.positions.len() {
        return;
    }

    for entity in marker_query.iter() {
        commands.entity(entity).despawn();
    }

    commands.entity(container).with_children(|parent| {
        for landmark in landmarks.positions.iter() {
            spawn_landmark_marker(parent, &world, *landmark);
        }
    });
}

fn spawn_landmark_marker(parent: &mut ChildSpawnerCommands, world: &VoxelWorld, position: Vec3) {
    let Some((left, top)) = world_to_map_pos(world, position, LANDMARK_MARKER_SIZE) else {
        return;
    };

    parent.spawn((
        Node {
            width: Val::Px(LANDMARK_MARKER_SIZE),
            height: Val::Px(LANDMARK_MARKER_SIZE),
            position_type: PositionType::Absolute,
            left: Val::Px(left),
            top: Val::Px(top),
            ..default()
        },
        BackgroundColor(Color::srgb(0.98, 0.82, 0.24)),
        MapLandmarkMarker { world_pos: position },
    ));
}

fn world_to_map_pos(world: &VoxelWorld, pos: Vec3, marker_size: f32) -> Option<(f32, f32)> {
    let world_size_chunks = world.world_size_chunks();
    let world_width = (world_size_chunks.x * CHUNK_SIZE_I32) as f32;
    let world_depth = (world_size_chunks.z * CHUNK_SIZE_I32) as f32;

    if world_width <= 0.0 || world_depth <= 0.0 {
        return None;
    }

    let x_ratio = (pos.x / world_width).clamp(0.0, 1.0);
    let z_ratio = (pos.z / world_depth).clamp(0.0, 1.0);

    let left = x_ratio * MAP_SIZE - (marker_size * 0.5);
    let top = (1.0 - z_ratio) * MAP_SIZE - (marker_size * 0.5);
    Some((left, top))
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
    // 16 pixels per chunk (1 pixel per block column)
    let width = (world_size.x * CHUNK_SIZE_I32).max(1) as u32;
    let height = (world_size.z * CHUNK_SIZE_I32).max(1) as u32;
    (width, height)
}

fn build_map_data(world: &VoxelWorld, width: u32, height: u32) -> Vec<u8> {
    let world_size_chunks = world.world_size_chunks();
    // Initialize with dark background (Deep Ocean/Void)
    let mut data = Vec::with_capacity((width * height * 4) as usize);
    for _ in 0..(width * height) {
        data.extend_from_slice(&[18, 24, 34, 255]);
    }
    
    // Not strictly needed, we scan chunks.

    for cx in 0..world_size_chunks.x {
        for cz in 0..world_size_chunks.z {
            // Get all chunks in this column
            let mut column_chunks = Vec::with_capacity(world_size_chunks.y as usize);
            for cy in 0..world_size_chunks.y {
                column_chunks.push(world.get_chunk(IVec3::new(cx, cy, cz)));
            }

            for lz in 0..CHUNK_SIZE {
                for lx in 0..CHUNK_SIZE {
                    // Start scanning from top chunk down
                    let mut top_voxel = VoxelType::Air;

                    'scan: for cy in (0..world_size_chunks.y).rev() {
                        if let Some(chunk) = column_chunks[cy as usize] {
                            for ly in (0..CHUNK_SIZE).rev() {
                                let voxel = chunk.get(UVec3::new(lx as u32, ly as u32, lz as u32));
                                if voxel != VoxelType::Air {
                                    top_voxel = voxel;
                                    break 'scan;
                                }
                            }
                        }
                    }

                    if top_voxel != VoxelType::Air {
                        let color = get_voxel_color(top_voxel);
                        let r = color[0];
                        let g = color[1];
                        let b = color[2];
                        let a = color[3];

                        // Calculate texture coordinates
                        // map_x is standard Left-to-Right
                        let map_x = (cx as usize * CHUNK_SIZE) + lx;
                        
                        let world_z = (cz as usize * CHUNK_SIZE) + lz;
                        if world_z < height as usize {
                             let map_y = (height as usize - 1) - world_z;
                             
                             if map_x < width as usize && map_y < height as usize {
                                let idx = (map_y * width as usize + map_x) * 4;
                                data[idx] = r;
                                data[idx+1] = g;
                                data[idx+2] = b;
                                data[idx+3] = a;
                             }
                        }
                    }
                }
            }
        }
    }
    data
}

fn get_voxel_color(voxel: VoxelType) -> [u8; 4] {
    match voxel {
        VoxelType::Leaves => [50, 205, 50, 255],     // Lime Green / Bright Green for Trees 
        VoxelType::Wood => [101, 67, 33, 255],       // Dark Brown (if visible)
        VoxelType::TopSoil => [34, 139, 34, 255],    // Forest Green (Grass)
        VoxelType::SubSoil => [139, 69, 19, 255],    // Saddle Brown
        VoxelType::Rock => [169, 169, 169, 255],     // Dark Gray
        VoxelType::Bedrock => [105, 105, 105, 255],  // Dim Gray
        VoxelType::Sand => [238, 214, 175, 255],     // Sand
        VoxelType::Clay => [180, 140, 100, 255],     // Clay color
        VoxelType::Water => [30, 144, 255, 255],     // Dodger Blue
        VoxelType::DungeonWall => [70, 70, 80, 255], // Dark Blue-Gray
        VoxelType::DungeonFloor => [60, 60, 70, 255],
        _ => [0, 0, 0, 0], // Transparent/Air
    }
}
