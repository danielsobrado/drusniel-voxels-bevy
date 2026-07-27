use crate::camera::controller::PlayerCamera;
use crate::constants::{CHUNK_SIZE, CHUNK_SIZE_I32};
use crate::ui::theme::{DR_GOLD, DR_PANEL_BG_STRONG, DR_PANEL_BORDER, DR_SLOT_BG};
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;
use bevy::asset::RenderAssetUsages;
use bevy::image::{ImageAddressMode, ImageFilterMode, ImageSampler, ImageSamplerDescriptor};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat};
use bevy::ui::{Overflow, PositionType, Val};

const MINIMAP_DISPLAY_SIZE: f32 = 172.0;
const MINIMAP_PANEL_PAD: f32 = 8.0;
const MINIMAP_PIXELS: u32 = 96;
const MINIMAP_CELLS: i32 = 192;
const RECENTER_CELLS: i32 = (MINIMAP_CELLS as f32 * 0.2) as i32;
const HEADING_EPSILON: f32 = 0.004;
const NEEDLE_SIZE: f32 = 12.0;

pub struct MinimapPlugin;

#[derive(Resource)]
pub struct MinimapState {
    pub enabled: bool,
    pub root: Option<Entity>,
    pub map_image: Option<Entity>,
    pub texture: Option<Handle<Image>>,
    pub center_x: i32,
    pub center_z: i32,
    pub heading: f32,
    pub dirty: bool,
}

impl Default for MinimapState {
    fn default() -> Self {
        Self {
            enabled: true,
            root: None,
            map_image: None,
            texture: None,
            center_x: 0,
            center_z: 0,
            heading: 0.0,
            dirty: true,
        }
    }
}

#[derive(Component)]
struct MinimapRoot;

#[derive(Component)]
struct MinimapMapImage;

#[derive(Component)]
struct MinimapNeedle;

impl Plugin for MinimapPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<MinimapState>().add_systems(
            Update,
            (
                spawn_minimap_hud,
                update_minimap_center_and_heading,
                redraw_minimap_texture,
                rotate_minimap_image,
            )
                .chain(),
        );
    }
}

fn spawn_minimap_hud(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
    mut state: ResMut<MinimapState>,
) {
    if !state.enabled || state.root.is_some() {
        return;
    }

    let texture = create_blank_minimap_texture(&mut images);
    state.texture = Some(texture.clone());

    let mut map_image_entity = None;
    let root = commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                top: Val::Px(12.0),
                right: Val::Px(12.0),
                width: Val::Px(MINIMAP_DISPLAY_SIZE + MINIMAP_PANEL_PAD * 2.0),
                height: Val::Px(MINIMAP_DISPLAY_SIZE + MINIMAP_PANEL_PAD * 2.0),
                padding: UiRect::all(Val::Px(MINIMAP_PANEL_PAD)),
                border: UiRect::all(Val::Px(1.0)),
                border_radius: BorderRadius::all(Val::Px(12.0)),
                ..default()
            },
            BackgroundColor(DR_PANEL_BG_STRONG),
            BorderColor::all(DR_PANEL_BORDER),
            MinimapRoot,
            ZIndex(4),
        ))
        .with_children(|parent| {
            parent
                .spawn((
                    Node {
                        width: Val::Px(MINIMAP_DISPLAY_SIZE),
                        height: Val::Px(MINIMAP_DISPLAY_SIZE),
                        position_type: PositionType::Relative,
                        overflow: Overflow::clip(),
                        border: UiRect::all(Val::Px(1.0)),
                        border_radius: BorderRadius::all(Val::Percent(50.0)),
                        ..default()
                    },
                    BackgroundColor(DR_SLOT_BG),
                    BorderColor::all(DR_PANEL_BORDER),
                ))
                .with_children(|frame| {
                    map_image_entity = Some(
                        frame
                            .spawn((
                                Node {
                                    width: Val::Percent(100.0),
                                    height: Val::Percent(100.0),
                                    ..default()
                                },
                                ImageNode::new(texture.clone()),
                                Transform::default(),
                                MinimapMapImage,
                            ))
                            .id(),
                    );
                    frame.spawn((
                        Node {
                            position_type: PositionType::Absolute,
                            left: Val::Px(MINIMAP_DISPLAY_SIZE * 0.5 - NEEDLE_SIZE * 0.5),
                            top: Val::Px(MINIMAP_DISPLAY_SIZE * 0.5 - NEEDLE_SIZE - 4.0),
                            width: Val::Px(NEEDLE_SIZE),
                            height: Val::Px(NEEDLE_SIZE),
                            border_radius: BorderRadius::all(Val::Px(2.0)),
                            ..default()
                        },
                        BackgroundColor(DR_GOLD),
                        MinimapNeedle,
                    ));
                });
        })
        .id();

    state.root = Some(root);
    state.map_image = map_image_entity;
    state.dirty = true;
}

fn update_minimap_center_and_heading(
    mut state: ResMut<MinimapState>,
    camera_query: Query<(&Transform, &PlayerCamera), With<PlayerCamera>>,
) {
    if !state.enabled {
        return;
    }
    let Ok((transform, camera)) = camera_query.single() else {
        return;
    };
    let next_x = transform.translation.x.floor() as i32;
    let next_z = transform.translation.z.floor() as i32;
    if (next_x - state.center_x).abs() > RECENTER_CELLS
        || (next_z - state.center_z).abs() > RECENTER_CELLS
        || state.dirty
    {
        state.center_x = next_x;
        state.center_z = next_z;
        state.dirty = true;
    }
    if (camera.yaw - state.heading).abs() > HEADING_EPSILON {
        state.heading = camera.yaw;
    }
}

fn rotate_minimap_image(
    state: Res<MinimapState>,
    mut query: Query<&mut Transform, With<MinimapMapImage>>,
) {
    let Some(entity) = state.map_image else {
        return;
    };
    let Ok(mut transform) = query.get_mut(entity) else {
        return;
    };
    *transform = Transform::from_rotation(Quat::from_rotation_z(-state.heading));
}

fn redraw_minimap_texture(
    mut state: ResMut<MinimapState>,
    mut images: ResMut<Assets<Image>>,
    world: Res<VoxelWorld>,
) {
    if !state.enabled || !state.dirty {
        return;
    }
    let Some(handle) = state.texture.clone() else {
        return;
    };
    let Some(image) = images.get_mut(&handle) else {
        return;
    };
    let data = build_local_minimap_data(&world, state.center_x, state.center_z);
    image.data = Some(data);
    state.dirty = false;
}

fn create_blank_minimap_texture(images: &mut Assets<Image>) -> Handle<Image> {
    let mut image = Image::new_fill(
        Extent3d {
            width: MINIMAP_PIXELS,
            height: MINIMAP_PIXELS,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        &[18, 24, 34, 255],
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
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

fn build_local_minimap_data(world: &VoxelWorld, center_x: i32, center_z: i32) -> Vec<u8> {
    let half = MINIMAP_CELLS / 2;
    let min_x = center_x - half;
    let min_z = center_z - half;
    let mut data = vec![0u8; (MINIMAP_PIXELS * MINIMAP_PIXELS * 4) as usize];
    for py in 0..MINIMAP_PIXELS {
        for px in 0..MINIMAP_PIXELS {
            let world_x = min_x + ((px as i32 * MINIMAP_CELLS) / MINIMAP_PIXELS as i32);
            let world_z = min_z + ((py as i32 * MINIMAP_CELLS) / MINIMAP_PIXELS as i32);
            let color = sample_surface_color(world, world_x, world_z);
            let idx = ((py * MINIMAP_PIXELS + px) * 4) as usize;
            data[idx] = color[0];
            data[idx + 1] = color[1];
            data[idx + 2] = color[2];
            data[idx + 3] = 255;
        }
    }
    let cx = MINIMAP_PIXELS / 2;
    let cy = MINIMAP_PIXELS / 2;
    for dy in 0..4u32 {
        for dx in 0..4u32 {
            let x = cx + dx - 2;
            let y = cy + dy - 2;
            if x < MINIMAP_PIXELS && y < MINIMAP_PIXELS {
                let idx = ((y * MINIMAP_PIXELS + x) * 4) as usize;
                data[idx] = 0xf0;
                data[idx + 1] = 0xcf;
                data[idx + 2] = 0x68;
            }
        }
    }
    data
}

fn sample_surface_color(world: &VoxelWorld, x: i32, z: i32) -> [u8; 3] {
    let world_size = world.world_size_chunks();
    let world_width = world_size.x * CHUNK_SIZE_I32;
    let world_depth = world_size.z * CHUNK_SIZE_I32;
    if x < 0 || z < 0 || x >= world_width || z >= world_depth {
        return [18, 24, 34];
    }
    let cx = x / CHUNK_SIZE_I32;
    let cz = z / CHUNK_SIZE_I32;
    let lx = (x.rem_euclid(CHUNK_SIZE_I32)) as u32;
    let lz = (z.rem_euclid(CHUNK_SIZE_I32)) as u32;
    let mut top = VoxelType::Air;
    'scan: for cy in (0..world_size.y).rev() {
        if let Some(chunk) = world.get_chunk(IVec3::new(cx, cy, cz)) {
            for ly in (0..CHUNK_SIZE).rev() {
                let voxel = chunk.get(UVec3::new(lx, ly as u32, lz));
                if voxel != VoxelType::Air {
                    top = voxel;
                    break 'scan;
                }
            }
        }
    }
    let rgba = voxel_color(top);
    [rgba[0], rgba[1], rgba[2]]
}

fn voxel_color(voxel: VoxelType) -> [u8; 4] {
    match voxel {
        VoxelType::Leaves => [50, 205, 50, 255],
        VoxelType::Wood => [101, 67, 33, 255],
        VoxelType::TopSoil => [34, 139, 34, 255],
        VoxelType::SubSoil => [139, 69, 19, 255],
        VoxelType::Rock => [169, 169, 169, 255],
        VoxelType::Bedrock => [105, 105, 105, 255],
        VoxelType::Sand => [238, 214, 175, 255],
        VoxelType::Clay => [180, 140, 100, 255],
        VoxelType::Water => [30, 144, 255, 255],
        VoxelType::DungeonWall => [70, 70, 80, 255],
        VoxelType::DungeonFloor => [60, 60, 70, 255],
        _ => [18, 24, 34, 255],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_texture_has_expected_dimensions() {
        let mut images = Assets::<Image>::default();
        let handle = create_blank_minimap_texture(&mut images);
        let image = images.get(&handle).expect("texture");
        assert_eq!(image.width(), MINIMAP_PIXELS);
        assert_eq!(image.height(), MINIMAP_PIXELS);
    }
}
