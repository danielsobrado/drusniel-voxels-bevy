use bevy::asset::RenderAssetUsages;
use bevy::camera::{ClearColorConfig, RenderTarget};
use bevy::prelude::*;
use bevy::render::render_resource::{Extent3d, TextureDimension, TextureFormat, TextureUsages};
use bevy::ui::{AlignItems, FlexDirection, FlexWrap, JustifyContent, PositionType, Val};
use std::collections::HashMap;

use crate::chat::ChatState;
use crate::entity::{
    EquippedItem, Inventory, InventorySlot, ItemType, INVENTORY_COLUMNS, INVENTORY_SLOTS,
};
use crate::menu::PauseMenuState;
use crate::terrain::tools::{TerrainTool, TerrainToolState};

pub struct InventoryUiPlugin;

// Inventory UI constants (6x4 grid)
const SLOT_SIZE: f32 = 64.0;
const SLOT_GAP: f32 = 4.0;
const PANEL_PADDING: f32 = 12.0;
const GRID_WIDTH: f32 =
    SLOT_SIZE * INVENTORY_COLUMNS as f32 + SLOT_GAP * (INVENTORY_COLUMNS as f32 - 1.0);
const PANEL_WIDTH: f32 = GRID_WIDTH + PANEL_PADDING * 2.0;

// Hotbar constants (keep 3D rendered icons)
const HOTBAR_SLOTS: usize = 8;
const HOTBAR_ICON_SIZE: u32 = 96;
const HOTBAR_ICON_UI_SIZE: f32 = 40.0;
const HOTBAR_ICON_SCENE_ORIGIN: Vec3 = Vec3::new(10000.0, 10000.0, 10000.0);
const HOTBAR_ICON_SPACING: f32 = 6.0;

#[derive(Resource, Default)]
pub struct InventoryUiState {
    pub open: bool,
    pub root_entity: Option<Entity>,
    pub selected_slot: Option<usize>,
}

#[derive(Resource, Debug)]
pub struct HotbarState {
    pub slots: [Option<ItemType>; HOTBAR_SLOTS],
    pub selected: usize,
}

impl Default for HotbarState {
    fn default() -> Self {
        let mut slots = [None; HOTBAR_SLOTS];
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
    pub slot_index: Option<usize>,
    pub item: Option<ItemType>,
    pub quantity: u32,
}

#[derive(Component)]
struct InventoryRoot;

#[derive(Component)]
struct InventoryGrid;

#[derive(Component)]
struct InventoryHeldText;

#[derive(Component)]
struct InventorySlotButton(usize);

#[derive(Component)]
struct InventorySlotIcon(usize);

#[derive(Component)]
struct InventorySlotQuantity(usize);

#[derive(Component)]
struct HotbarRoot;

#[derive(Component)]
struct HotbarSlot(usize);

#[derive(Component)]
struct HotbarDragText;

#[derive(Component)]
struct HotbarSlotList;

#[derive(Component)]
struct HotbarTitleText;

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
                    handle_inventory_slot_click,
                    handle_inventory_slot_right_click,
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
        state.selected_slot = None;
        dragged.item = None;
        dragged.slot_index = None;
        dragged.quantity = 0;
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
    terrain_state: Res<TerrainToolState>,
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
                        HotbarTitleText,
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
                            spawn_hotbar_slots(list, &hotbar, &terrain_state, &font, &icons);
                        });
                });
        })
        .id();

    ui_state.root_entity = Some(root);
}

fn handle_inventory_slot_click(
    mut interactions: Query<(&Interaction, &InventorySlotButton), Changed<Interaction>>,
    mut inventory: ResMut<Inventory>,
    mut dragged: ResMut<DraggedItem>,
    mut state: ResMut<InventoryUiState>,
    mouse: Res<ButtonInput<MouseButton>>,
) {
    // Only handle left click
    if !mouse.pressed(MouseButton::Left) {
        return;
    }

    for (interaction, button) in interactions.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        let slot_idx = button.0;
        let slot = inventory.slots[slot_idx];

        if let Some(dragged_item) = dragged.item {
            // Placing item
            if slot.item.is_none() {
                // Place in empty slot
                inventory.slots[slot_idx] = InventorySlot {
                    item: Some(dragged_item),
                    quantity: dragged.quantity,
                };
                dragged.item = None;
                dragged.slot_index = None;
                dragged.quantity = 0;
            } else if slot.item == Some(dragged_item) && dragged_item.is_stackable() {
                // Stack with same item type
                let max_stack = dragged_item.max_stack();
                let can_add = (max_stack - slot.quantity).min(dragged.quantity);
                inventory.slots[slot_idx].quantity += can_add;
                dragged.quantity -= can_add;
                if dragged.quantity == 0 {
                    dragged.item = None;
                    dragged.slot_index = None;
                }
            } else {
                // Swap items
                let old_slot = inventory.slots[slot_idx];
                inventory.slots[slot_idx] = InventorySlot {
                    item: Some(dragged_item),
                    quantity: dragged.quantity,
                };
                dragged.item = old_slot.item;
                dragged.quantity = old_slot.quantity;
            }
        } else if slot.item.is_some() {
            // Pick up item
            dragged.item = slot.item;
            dragged.quantity = slot.quantity;
            dragged.slot_index = Some(slot_idx);
            inventory.slots[slot_idx] = InventorySlot::default();
        }

        state.selected_slot = Some(slot_idx);
    }
}

fn handle_inventory_slot_right_click(
    interactions: Query<(&Interaction, &InventorySlotButton)>,
    mut inventory: ResMut<Inventory>,
    mut dragged: ResMut<DraggedItem>,
    mouse: Res<ButtonInput<MouseButton>>,
) {
    // Only handle right click for stack splitting
    if !mouse.just_pressed(MouseButton::Right) {
        return;
    }

    for (interaction, button) in interactions.iter() {
        if *interaction != Interaction::Hovered && *interaction != Interaction::Pressed {
            continue;
        }

        let slot_idx = button.0;
        let slot = &inventory.slots[slot_idx];

        // Can only split if we're not already dragging and slot has stackable items > 1
        if dragged.item.is_some() {
            continue;
        }

        if let Some(item) = slot.item {
            if item.is_stackable() && slot.quantity > 1 {
                let split_amount = slot.quantity / 2;
                inventory.slots[slot_idx].quantity -= split_amount;
                dragged.item = Some(item);
                dragged.quantity = split_amount;
                dragged.slot_index = None;
            }
        }
    }
}

fn handle_hotbar_input(
    keys: Res<ButtonInput<KeyCode>>,
    mut hotbar: ResMut<HotbarState>,
    pause_menu: Res<PauseMenuState>,
    chat_state: Option<Res<ChatState>>,
    terrain_state: Res<TerrainToolState>,
) {
    if pause_menu.open
        || chat_state.as_ref().map(|c| c.active).unwrap_or(false)
        || terrain_state.terraforming_mode
    {
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
            dragged.quantity = 0;
            dragged.slot_index = None;
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
    if !hotbar.is_changed() || terrain_state.terraforming_mode {
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
    dragged: Res<DraggedItem>,
    grid_query: Query<Entity, With<InventoryGrid>>,
    mut held_query: Query<&mut Text, With<InventoryHeldText>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    if !state.open
        || (!inventory.is_changed() && !equipped.is_changed() && !dragged.is_changed())
    {
        return;
    }

    if let Ok(mut text) = held_query.single_mut() {
        text.0 = held_label(&equipped, &dragged);
    }

    let Ok(grid_entity) = grid_query.single() else {
        return;
    };

    commands.entity(grid_entity).despawn_children();

    let font = asset_server.load("fonts/FiraSans-Bold.ttf");
    commands.entity(grid_entity).with_children(|grid| {
        spawn_inventory_slots(grid, &inventory, &state, &asset_server, &font);
    });
}

fn refresh_hotbar_ui(
    hotbar: Res<HotbarState>,
    dragged: Res<DraggedItem>,
    terrain_state: Res<TerrainToolState>,
    list_query: Query<Entity, With<HotbarSlotList>>,
    mut drag_query: Query<&mut Text, (With<HotbarDragText>, Without<HotbarTitleText>)>,
    mut title_query: Query<&mut Text, (With<HotbarTitleText>, Without<HotbarDragText>)>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    icons: Res<HotbarIconAssets>,
) {
    if !hotbar.is_changed() && !dragged.is_changed() && !terrain_state.is_changed() {
        return;
    }

    if let Ok(mut text) = drag_query.single_mut() {
        text.0 = drag_label(&dragged);
    }

    if let Ok(mut text) = title_query.single_mut() {
        text.0 = if terrain_state.terraforming_mode {
            "Terraforming Tools (1-4)".to_string()
        } else {
            "Hotbar (1-8)".to_string()
        };
    }

    let Ok(list_entity) = list_query.single() else {
        return;
    };

    commands.entity(list_entity).despawn_children();

    let font = asset_server.load("fonts/FiraSans-Bold.ttf");
    commands.entity(list_entity).with_children(|list| {
        spawn_hotbar_slots(list, &hotbar, &terrain_state, &font, &icons);
    });
}

fn spawn_inventory_ui(
    commands: &mut Commands,
    asset_server: &Res<AssetServer>,
    inventory: &Inventory,
    equipped: &EquippedItem,
) -> Entity {
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");
    let dragged = DraggedItem::default();

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
                    BackgroundColor(Color::srgba(0.1, 0.1, 0.1, 0.85)),
                ))
                .with_children(|panel| {
                    // Title bar with close hint
                    panel
                        .spawn(Node {
                            flex_direction: FlexDirection::Row,
                            justify_content: JustifyContent::SpaceBetween,
                            align_items: AlignItems::Center,
                            width: Val::Percent(100.0),
                            ..default()
                        })
                        .with_children(|title_bar| {
                            title_bar.spawn((
                                Text::new("INVENTORY"),
                                TextFont {
                                    font: font.clone(),
                                    font_size: 18.0,
                                    ..default()
                                },
                                TextColor(Color::WHITE),
                            ));

                            title_bar.spawn((
                                Text::new("X"),
                                TextFont {
                                    font: font.clone(),
                                    font_size: 16.0,
                                    ..default()
                                },
                                TextColor(Color::srgba(0.8, 0.3, 0.3, 1.0)),
                            ));
                        });

                    // Held/dragging status
                    panel.spawn((
                        Text::new(held_label(equipped, &dragged)),
                        TextFont {
                            font: font.clone(),
                            font_size: 12.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
                        InventoryHeldText,
                    ));

                    // Inventory grid (6x4)
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
                            InventoryGrid,
                        ))
                        .with_children(|grid| {
                            let state = InventoryUiState::default();
                            spawn_inventory_slots(grid, inventory, &state, asset_server, &font);
                        });

                    // Instructions
                    panel.spawn((
                        Text::new("Left-click: pick up/place | Right-click: split stack"),
                        TextFont {
                            font: font.clone(),
                            font_size: 10.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.6, 0.6, 0.6, 1.0)),
                    ));
                });
        })
        .id()
}

fn held_label(equipped: &EquippedItem, dragged: &DraggedItem) -> String {
    if let Some(item) = dragged.item {
        if dragged.quantity > 1 {
            format!("Dragging: {} x{}", item.display_name(), dragged.quantity)
        } else {
            format!("Dragging: {}", item.display_name())
        }
    } else {
        match equipped.item {
            Some(item) => format!("Equipped: {}", item.display_name()),
            None => "Equipped: (none)".to_string(),
        }
    }
}

fn spawn_inventory_slots(
    grid: &mut ChildSpawnerCommands,
    inventory: &Inventory,
    state: &InventoryUiState,
    asset_server: &AssetServer,
    font: &Handle<Font>,
) {
    for slot_idx in 0..INVENTORY_SLOTS {
        let slot = &inventory.slots[slot_idx];
        let is_selected = state.selected_slot == Some(slot_idx);

        // Slot container (button)
        grid.spawn((
            Button,
            Node {
                width: Val::Px(SLOT_SIZE),
                height: Val::Px(SLOT_SIZE),
                position_type: PositionType::Relative,
                ..default()
            },
            BackgroundColor(if is_selected {
                Color::srgba(0.32, 0.42, 0.35, 0.95) // Green highlight
            } else {
                Color::srgba(0.2, 0.2, 0.2, 0.9)
            }),
            InventorySlotButton(slot_idx),
        ))
        .with_children(|slot_node| {
            if let Some(item) = slot.item {
                // Item icon (2D image)
                slot_node.spawn((
                    Node {
                        width: Val::Percent(100.0),
                        height: Val::Percent(100.0),
                        position_type: PositionType::Absolute,
                        left: Val::Px(0.0),
                        top: Val::Px(0.0),
                        ..default()
                    },
                    ImageNode::new(asset_server.load(item.icon_path())),
                    InventorySlotIcon(slot_idx),
                ));

                // Quantity text (bottom-right corner, only if > 1)
                if slot.quantity > 1 {
                    slot_node
                        .spawn(Node {
                            width: Val::Percent(100.0),
                            height: Val::Percent(100.0),
                            position_type: PositionType::Absolute,
                            left: Val::Px(0.0),
                            top: Val::Px(0.0),
                            justify_content: JustifyContent::FlexEnd,
                            align_items: AlignItems::FlexEnd,
                            padding: UiRect::all(Val::Px(2.0)),
                            ..default()
                        })
                        .with_children(|qty_container| {
                            // Shadow text
                            qty_container.spawn((
                                Text::new(format!("{}", slot.quantity)),
                                TextFont {
                                    font: font.clone(),
                                    font_size: 14.0,
                                    ..default()
                                },
                                TextColor(Color::srgba(0.0, 0.0, 0.0, 0.8)),
                                Node {
                                    position_type: PositionType::Absolute,
                                    right: Val::Px(1.0),
                                    bottom: Val::Px(1.0),
                                    ..default()
                                },
                            ));
                            // Main text
                            qty_container.spawn((
                                Text::new(format!("{}", slot.quantity)),
                                TextFont {
                                    font: font.clone(),
                                    font_size: 14.0,
                                    ..default()
                                },
                                TextColor(Color::WHITE),
                                InventorySlotQuantity(slot_idx),
                            ));
                        });
                }
            }
        });
    }
}

fn spawn_hotbar_slots(
    list: &mut ChildSpawnerCommands,
    hotbar: &HotbarState,
    terrain_state: &TerrainToolState,
    font: &Handle<Font>,
    icons: &HotbarIconAssets,
) {
    if terrain_state.terraforming_mode {
        // Render terrain tools (only 4 slots)
        let tools = TerrainTool::all_tools();
        for (index, tool) in tools.iter().enumerate() {
            let is_selected = terrain_state.active_tool == *tool;
            let label = tool.display_name();
            // Map terrain tool to item type for icon lookup
            let item_type = match tool {
                TerrainTool::Raise => ItemType::TerrainRaise,
                TerrainTool::Lower => ItemType::TerrainLower,
                TerrainTool::Level => ItemType::TerrainLevel,
                TerrainTool::Smooth => ItemType::TerrainSmooth,
                TerrainTool::None => ItemType::Pickaxe, // Should not happen in loop
            };
            let icon_handle = icons.images.get(&item_type).cloned();

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
                // Use a dummy index for hotbar slot component since we don't want these to be clickable/swappable like normal inventory
                HotbarSlot(100 + index),
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
                    button.spawn((
                        Text::new(label),
                        TextFont {
                            font: font.clone(),
                            font_size: 10.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.8, 0.8, 0.8, 0.8)),
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
    } else {
        // Render normal hotbar slots
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
                order: -10,
                clear_color: ClearColorConfig::Custom(Color::srgba(0.0, 0.0, 0.0, 0.0)),
                ..default()
            },
            RenderTarget::Image(image_handle.clone().into()),
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
            scene_path: "models/Models/GLB format/MedievalAxe.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(0.9))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.1, 0.8, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::Torch,
            scene_path: "models/Models/GLB format/MedievalTorch.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(0.85))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.2, 0.8, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainRaise,
            scene_path: "models/Models/GLB format/Shovel.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(1.1))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, 0.0, -0.4)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainLower,
            scene_path: "models/Models/GLB format/Pickaxe.glb#Scene0",
            transform: Transform::from_scale(base_scale)
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, 3.14, -0.4)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainLevel,
            scene_path: "models/Models/GLB format/Hand Rake.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(1.2))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.5, 1.5, 0.0)),
        },
        HotbarIconSpec {
            item: ItemType::TerrainSmooth,
            scene_path: "models/Models/GLB format/Hand Rake.glb#Scene0",
            transform: Transform::from_scale(Vec3::splat(1.2))
                .with_rotation(Quat::from_euler(EulerRot::XYZ, 0.0, 0.0, -0.4)),
        },
    ]
}

fn drag_label(dragged: &DraggedItem) -> String {
    match dragged.item {
        Some(item) => {
            if dragged.quantity > 1 {
                format!("Dragging: {} x{}", item.display_name(), dragged.quantity)
            } else {
                format!("Dragging: {}", item.display_name())
            }
        }
        None => "Drag an item from the inventory".to_string(),
    }
}
