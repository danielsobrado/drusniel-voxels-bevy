use bevy::prelude::*;
use bevy::camera::{ClearColorConfig, RenderTarget};
use bevy::asset::RenderAssetUsages;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};
use bevy::ui::{AlignItems, FlexDirection, FlexWrap, JustifyContent, PositionType, Val};
use std::collections::HashMap;

use crate::chat::ChatState;
use crate::entity::{EquippedItem, Inventory, ItemType};
use crate::menu::PauseMenuState;
use crate::terrain::tools::{TerrainTool, TerrainToolState};

pub struct InventoryUiPlugin;

const INVENTORY_COLUMNS: usize = 4;
const INVENTORY_ROWS: usize = 3;
const INVENTORY_SLOTS: usize = INVENTORY_COLUMNS * INVENTORY_ROWS;
const SLOT_SIZE: f32 = 80.0;
const SLOT_GAP: f32 = 8.0;
const PANEL_PADDING: f32 = 18.0;
const GRID_WIDTH: f32 =
    SLOT_SIZE * INVENTORY_COLUMNS as f32 + SLOT_GAP * (INVENTORY_COLUMNS as f32 - 1.0);
const PANEL_WIDTH: f32 = GRID_WIDTH + PANEL_PADDING * 2.0;
const HOTBAR_ICON_SIZE: u32 = 96;
const HOTBAR_ICON_UI_SIZE: f32 = 40.0;
const HOTBAR_ICON_SCENE_ORIGIN: Vec3 = Vec3::new(10000.0, 10000.0, 10000.0);
const HOTBAR_ICON_SPACING: f32 = 6.0;

#[derive(Resource, Default)]
pub struct InventoryUiState {
    pub open: bool,
    pub root_entity: Option<Entity>,
}

#[derive(Resource, Debug)]
pub struct HotbarState {
    pub slots: [Option<ItemType>; INVENTORY_COLUMNS * 2],
    pub selected: usize,
}

impl Default for HotbarState {
    fn default() -> Self {
        let mut slots = [None; INVENTORY_COLUMNS * 2];
        slots[0] = Some(ItemType::Pickaxe);
        slots[1] = Some(ItemType::Torch);
        slots[2] = Some(ItemType::Axe);
        // Terrain tools in slots 5-8 (keys 5-8)
        slots[4] = Some(ItemType::TerrainRaise);
        slots[5] = Some(ItemType::TerrainLower);
        slots[6] = Some(ItemType::TerrainLevel);
        slots[7] = Some(ItemType::TerrainSmooth);
        Self { slots, selected: 0 }
    }
}

#[derive(Resource, Default)]
pub struct HotbarUiState {
    pub root_entity: Option<Entity>,
}

#[derive(Resource, Default)]
pub struct HotbarIconAssets {
    pub images: HashMap<ItemType, Handle<Image>>,
}

#[derive(Resource, Default)]
pub struct DraggedItem {
    pub item: Option<ItemType>,
}

#[derive(Component)]
struct InventoryRoot;

#[derive(Component)]
struct InventoryList;

#[derive(Component)]
struct InventoryHeldText;

#[derive(Component)]
struct InventoryItemButton(ItemType);

#[derive(Component)]
struct HotbarRoot;

#[derive(Component)]
struct HotbarSlot(usize);

#[derive(Component)]
struct HotbarDragText;

#[derive(Component)]
struct HotbarSlotList;

impl Plugin for InventoryUiPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<InventoryUiState>()
            .init_resource::<HotbarState>()
            .init_resource::<HotbarUiState>()
            .init_resource::<HotbarIconAssets>()
            .init_resource::<DraggedItem>()
            .add_systems(Startup, (setup_hotbar_icons, spawn_hotbar_ui).chain())
            .add_systems(
                Update,
                (
                    handle_hotbar_input,
                    handle_inventory_item_buttons,
                    handle_hotbar_slot_buttons,
                    sync_equipped_from_hotbar,
                    refresh_hotbar_ui,
                    toggle_inventory_ui,
                    refresh_inventory_ui,
                )
                    .chain(),
            );
    }
}

fn toggle_inventory_ui(
    keys: Res<ButtonInput<KeyCode>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    inventory: Res<Inventory>,
    equipped: Res<EquippedItem>,
    mut state: ResMut<InventoryUiState>,
    mut dragged: ResMut<DraggedItem>,
    pause_menu: Res<PauseMenuState>,
    chat_state: Option<Res<ChatState>>,
) {
    let open_pressed = keys.just_pressed(KeyCode::KeyI);
    let close_pressed = keys.just_pressed(KeyCode::Escape);

    if state.open {
        if !(open_pressed || close_pressed) {
            return;
        }
        if let Some(root) = state.root_entity.take() {
            commands.entity(root).despawn();
        }
        state.open = false;
        dragged.item = None;
        return;
    }

    if !open_pressed {
        return;
    }

    if pause_menu.open || chat_state.as_ref().map(|c| c.active).unwrap_or(false) {
        return;
    }

    let root = spawn_inventory_ui(&mut commands, &asset_server, &inventory, &equipped);
    state.root_entity = Some(root);
    state.open = true;
}

fn spawn_hotbar_ui(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    hotbar: Res<HotbarState>,
    dragged: Res<DraggedItem>,
    icons: Res<HotbarIconAssets>,
    mut ui_state: ResMut<HotbarUiState>,
) {
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");

    let root = commands
        .spawn((
            Node {
                width: Val::Percent(100.0),
                position_type: PositionType::Absolute,
                bottom: Val::Px(14.0),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                ..default()
            },
            HotbarRoot,
        ))
        .with_children(|parent| {
            parent
                .spawn((
                    Node {
                        padding: UiRect::all(Val::Px(10.0)),
                        row_gap: Val::Px(6.0),
                        flex_direction: FlexDirection::Column,
                        align_items: AlignItems::Center,
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.04, 0.04, 0.06, 0.7)),
                ))
                .with_children(|panel| {
                    panel.spawn((
                        Text::new("Hotbar (1-8)"),
                        TextFont {
                            font: font.clone(),
                            font_size: 12.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.85, 0.85, 0.85, 0.9)),
                    ));

                    panel.spawn((
                        Text::new(drag_label(&dragged)),
                        TextFont {
                            font: font.clone(),
                            font_size: 12.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.95, 0.85, 0.6, 0.95)),
                        HotbarDragText,
                    ));

                    panel
                        .spawn((
                            Node {
                                flex_direction: FlexDirection::Row,
                                column_gap: Val::Px(6.0),
                                align_items: AlignItems::Center,
                                ..default()
                            },
                            HotbarSlotList,
                        ))
                        .with_children(|list| {
                            spawn_hotbar_slots(list, &hotbar, &font, &icons);
                        });
                });
        })
        .id();

    ui_state.root_entity = Some(root);
}

fn handle_inventory_item_buttons(
    mut interactions: Query<(&Interaction, &InventoryItemButton), Changed<Interaction>>,
    inventory: Res<Inventory>,
    mut dragged: ResMut<DraggedItem>,
) {
    for (interaction, button) in interactions.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        if inventory.get_count(button.0) == 0 {
            continue;
        }

        dragged.item = Some(button.0);
    }
}

fn handle_hotbar_input(
    keys: Res<ButtonInput<KeyCode>>,
    mut hotbar: ResMut<HotbarState>,
    pause_menu: Res<PauseMenuState>,
    chat_state: Option<Res<ChatState>>,
) {
    if pause_menu.open || chat_state.as_ref().map(|c| c.active).unwrap_or(false) {
        return;
    }

    let digit_keys = [
        KeyCode::Digit1,
        KeyCode::Digit2,
        KeyCode::Digit3,
        KeyCode::Digit4,
        KeyCode::Digit5,
        KeyCode::Digit6,
        KeyCode::Digit7,
        KeyCode::Digit8,
    ];

    for (index, key) in digit_keys.iter().enumerate() {
        if keys.just_pressed(*key) {
            hotbar.selected = index;
            return;
        }
    }
}

fn handle_hotbar_slot_buttons(
    mut interactions: Query<(&Interaction, &HotbarSlot), Changed<Interaction>>,
    mut hotbar: ResMut<HotbarState>,
    mut dragged: ResMut<DraggedItem>,
) {
    for (interaction, slot) in interactions.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        if let Some(item) = dragged.item.take() {
            hotbar.slots[slot.0] = Some(item);
            hotbar.selected = slot.0;
        } else {
            hotbar.selected = slot.0;
        }
    }
}

fn sync_equipped_from_hotbar(
    hotbar: Res<HotbarState>,
    mut equipped: ResMut<EquippedItem>,
    mut terrain_state: ResMut<TerrainToolState>,
) {
    if !hotbar.is_changed() {
        return;
    }

    let selected_item = hotbar.slots.get(hotbar.selected).copied().flatten();
    
    // Sync terrain tool state
    terrain_state.active_tool = match selected_item {
        Some(ItemType::TerrainRaise) => TerrainTool::Raise,
        Some(ItemType::TerrainLower) => TerrainTool::Lower,
        Some(ItemType::TerrainLevel) => TerrainTool::Level,
        Some(ItemType::TerrainSmooth) => TerrainTool::Smooth,
        _ => TerrainTool::None,
    };
    
    // Sync equipped item (only for non-terrain tools)
    let equip_item = if selected_item.map(|i| i.is_terrain_tool()).unwrap_or(false) {
        None
    } else {
        selected_item
    };
    
    if equipped.item != equip_item {
        equipped.item = equip_item;
    }
}

fn refresh_inventory_ui(
    inventory: Res<Inventory>,
    equipped: Res<EquippedItem>,
    state: Res<InventoryUiState>,
    list_query: Query<Entity, With<InventoryList>>,
    mut held_query: Query<&mut Text, With<InventoryHeldText>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    if !state.open || (!inventory.is_changed() && !equipped.is_changed()) {
        return;
    }

    if let Ok(mut text) = held_query.single_mut() {
        text.0 = held_label(&equipped);
    }

    let Ok(list_entity) = list_query.single() else {
        return;
    };

    commands.entity(list_entity).despawn_children();

    let font = asset_server.load("fonts/FiraSans-Bold.ttf");
    commands.entity(list_entity).with_children(|list| {
        spawn_inventory_items(list, &inventory, equipped.item, &font);
    });
}

fn refresh_hotbar_ui(
    hotbar: Res<HotbarState>,
    dragged: Res<DraggedItem>,
    list_query: Query<Entity, With<HotbarSlotList>>,
    mut drag_query: Query<&mut Text, With<HotbarDragText>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    icons: Res<HotbarIconAssets>,
) {
    if !hotbar.is_changed() && !dragged.is_changed() {
        return;
    }

    if let Ok(mut text) = drag_query.single_mut() {
        text.0 = drag_label(&dragged);
    }

    let Ok(list_entity) = list_query.single() else {
        return;
    };

    commands.entity(list_entity).despawn_children();

    let font = asset_server.load("fonts/FiraSans-Bold.ttf");
    commands.entity(list_entity).with_children(|list| {
        spawn_hotbar_slots(list, &hotbar, &font, &icons);
    });
}

fn spawn_inventory_ui(
    commands: &mut Commands,
    asset_server: &Res<AssetServer>,
    inventory: &Inventory,
    equipped: &EquippedItem,
) -> Entity {
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");

    commands
        .spawn((
            Node {
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                position_type: PositionType::Absolute,
                ..default()
            },
            BackgroundColor(Color::srgba(0.02, 0.02, 0.05, 0.75)),
            InventoryRoot,
        ))
        .with_children(|parent| {
            parent
                .spawn((
                    Node {
                        width: Val::Px(PANEL_WIDTH),
                        padding: UiRect::all(Val::Px(PANEL_PADDING)),
                        row_gap: Val::Px(10.0),
                        flex_direction: FlexDirection::Column,
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.08, 0.1, 0.14, 0.92)),
                ))
                .with_children(|panel| {
                    panel.spawn((
                        Text::new("Inventory (Press I or Esc to close)"),
                        TextFont {
                            font: font.clone(),
                            font_size: 20.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));

                    panel.spawn((
                        Text::new(held_label(equipped)),
                        TextFont {
                            font: font.clone(),
                            font_size: 14.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
                        InventoryHeldText,
                    ));

                    panel
                        .spawn((
                            Node {
                                width: Val::Px(GRID_WIDTH),
                                flex_direction: FlexDirection::Row,
                                flex_wrap: FlexWrap::Wrap,
                                column_gap: Val::Px(SLOT_GAP),
                                row_gap: Val::Px(SLOT_GAP),
                                align_items: AlignItems::FlexStart,
                                justify_content: JustifyContent::FlexStart,
                                ..default()
                            },
                            BackgroundColor(Color::srgba(0.1, 0.1, 0.12, 0.85)),
                            InventoryList,
                        ))
                        .with_children(|list| {
                            spawn_inventory_items(
                                list,
                                inventory,
                                equipped.item,
                                &font,
                            );
                        });
                });
        })
        .id()
}

fn held_label(equipped: &EquippedItem) -> String {
    match equipped.item {
        Some(item) => format!("Held: {}", item.display_name()),
        None => "Held: (none)".to_string(),
    }
}

fn spawn_inventory_items(
    list: &mut ChildSpawnerCommands,
    inventory: &Inventory,
    selected: Option<ItemType>,
    font: &Handle<Font>,
) {
    let mut items: Vec<_> = inventory
        .items
        .iter()
        .map(|(item, count)| (*item, *count))
        .filter(|(_, count)| *count > 0)
        .collect();
    items.sort_by_key(|(item, _)| item.sort_key());

    let mut iter = items.into_iter();
    for _ in 0..INVENTORY_SLOTS {
        if let Some((item, count)) = iter.next() {
            let is_selected = selected == Some(item);
            list.spawn((
                Button,
                Node {
                    width: Val::Px(SLOT_SIZE),
                    height: Val::Px(SLOT_SIZE),
                    flex_direction: FlexDirection::Column,
                    align_items: AlignItems::Center,
                    justify_content: JustifyContent::Center,
                    row_gap: Val::Px(4.0),
                    ..default()
                },
                BackgroundColor(if is_selected {
                    Color::srgba(0.25, 0.4, 0.7, 0.85)
                } else {
                    Color::srgba(0.15, 0.15, 0.18, 0.85)
                }),
                InventoryItemButton(item),
            ))
            .with_children(|button| {
                button.spawn((
                    Text::new(item.display_name()),
                    TextFont {
                        font: font.clone(),
                        font_size: 14.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
                button.spawn((
                    Text::new(format!("x{}", count)),
                    TextFont {
                        font: font.clone(),
                        font_size: 12.0,
                        ..default()
                    },
                    TextColor(Color::srgba(0.85, 0.85, 0.85, 0.9)),
                ));
            });
        } else {
            list.spawn((
                Node {
                    width: Val::Px(SLOT_SIZE),
                    height: Val::Px(SLOT_SIZE),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.1, 0.1, 0.12, 0.75)),
            ));
        }
    }
}

fn spawn_hotbar_slots(
    list: &mut ChildSpawnerCommands,
    hotbar: &HotbarState,
    font: &Handle<Font>,
    icons: &HotbarIconAssets,
) {
    for (index, slot) in hotbar.slots.iter().enumerate() {
        let is_selected = hotbar.selected == index;
        let label = slot.map(|item| item.display_name()).unwrap_or("Empty");
        let icon_handle = slot.and_then(|item| icons.images.get(&item).cloned());

        list.spawn((
            Button,
            Node {
                width: Val::Px(64.0),
                height: Val::Px(64.0),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                justify_content: JustifyContent::Center,
                row_gap: Val::Px(2.0),
                ..default()
            },
            BackgroundColor(if is_selected {
                Color::srgba(0.35, 0.45, 0.2, 0.9)
            } else {
                Color::srgba(0.12, 0.12, 0.15, 0.85)
            }),
            HotbarSlot(index),
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(format!("{}", index + 1)),
                TextFont {
                    font: font.clone(),
                    font_size: 12.0,
                    ..default()
                },
                TextColor(Color::srgba(0.9, 0.9, 0.9, 0.9)),
            ));
            if let Some(icon) = icon_handle {
                button.spawn((
                    Node {
                        width: Val::Px(HOTBAR_ICON_UI_SIZE),
                        height: Val::Px(HOTBAR_ICON_UI_SIZE),
                        ..default()
                    },
                    ImageNode::new(icon),
                ));
            } else {
                button.spawn((
                    Text::new(label),
                    TextFont {
                        font: font.clone(),
                        font_size: 13.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
            }
        });
    }
}

#[derive(Clone)]
struct HotbarIconSpec {
    item: ItemType,
    scene_path: &'static str,
    transform: Transform,
}

fn setup_hotbar_icons(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut icons: ResMut<HotbarIconAssets>,
    mut images: ResMut<Assets<Image>>,
) {
    if !icons.images.is_empty() {
        return;
    }

    let specs = hotbar_icon_specs();
    for (index, spec) in specs.iter().enumerate() {
        let image_handle = create_hotbar_icon_image(&mut images);
        icons.images.insert(spec.item, image_handle.clone());

        let scene_handle: Handle<Scene> = asset_server.load(spec.scene_path);
        let icon_origin =
            HOTBAR_ICON_SCENE_ORIGIN + Vec3::new(index as f32 * HOTBAR_ICON_SPACING, 0.0, 0.0);

        commands.spawn((
            Camera3d::default(),
            Camera {
                target: RenderTarget::Image(image_handle.clone().into()),
                order: -10,
                clear_color: ClearColorConfig::Custom(Color::srgba(0.0, 0.0, 0.0, 0.0)),
                ..default()
            },
            Projection::Perspective(PerspectiveProjection {
                fov: std::f32::consts::FRAC_PI_4,
                near: 0.1,
                far: 10.0,
                ..default()
            }),
            Transform::from_translation(icon_origin + Vec3::new(0.0, 0.4, 2.2))
                .looking_at(icon_origin, Vec3::Y),
        ));

        commands.spawn((
            SceneRoot(scene_handle),
            Transform::from_translation(icon_origin) * spec.transform,
        ));

        commands.spawn((
            PointLight {
                intensity: 2000.0,
                range: 10.0,
                shadows_enabled: false,
                ..default()
            },
            Transform::from_translation(icon_origin + Vec3::new(2.2, 2.4, 2.2)),
        ));
    }
}

fn create_hotbar_icon_image(images: &mut Assets<Image>) -> Handle<Image> {
    let size = Extent3d {
        width: HOTBAR_ICON_SIZE,
        height: HOTBAR_ICON_SIZE,
        depth_or_array_layers: 1,
    };

    let mut image = Image::new_fill(
        size,
        TextureDimension::D2,
        &[0, 0, 0, 0],
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    );

    image.texture_descriptor.usage =
        TextureUsages::TEXTURE_BINDING | TextureUsages::COPY_DST | TextureUsages::RENDER_ATTACHMENT;

    images.add(image)
}

fn hotbar_icon_specs() -> Vec<HotbarIconSpec> {
    let base_rotation = Quat::from_euler(EulerRot::XYZ, -0.35, 0.7, 0.0);
    let base_scale = Vec3::splat(0.9);

    vec![
        HotbarIconSpec {
            item: ItemType::Pickaxe,
            scene_path: "models/Models/GLB format/Pickaxe.glb#Scene0",
            transform: Transform::from_scale(base_scale).with_rotation(base_rotation),
        },
        HotbarIconSpec {
            item: ItemType::Axe,
            scene_path: "models/Models/GLB format/Axe.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(0.9))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.1, 0.8, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::Torch,
            scene_path: "models/Models/GLB format/Torch 1.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(0.85))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.2, 0.8, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainRaise,
            scene_path: "models/Models/GLB format/Arrow.glb#Scene0",
            transform: Transform::from_scale(base_scale)
                .with_rotation(Quat::from_euler(EulerRot::XYZ, -0.2, 0.9, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainLower,
            scene_path: "models/Models/GLB format/Arrow.glb#Scene0",
            transform: Transform::from_scale(base_scale)
                .with_rotation(Quat::from_euler(EulerRot::XYZ, std::f32::consts::PI + 0.2, 0.9, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainLevel,
            scene_path: "models/Models/GLB format/Sword.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(0.8))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.4, 0.6, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainSmooth,
            scene_path: "models/Models/GLB format/Bow.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(0.9))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.2, 1.1, 0.0)),
        },
    ]
}

fn drag_label(dragged: &DraggedItem) -> String {
    match dragged.item {
        Some(item) => format!("Dragging: {}", item.display_name()),
        None => "Drag an item from the inventory".to_string(),
    }
}
