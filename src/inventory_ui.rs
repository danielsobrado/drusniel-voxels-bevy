use bevy::prelude::*;
use bevy::ui::{AlignItems, FlexDirection, FlexWrap, JustifyContent, PositionType, Val};

use crate::camera::controller::PlayerCamera;
use crate::chat::ChatState;
use crate::entity::{EquippedItem, Inventory, ItemType};
use crate::menu::PauseMenuState;

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
        Self { slots, selected: 0 }
    }
}

#[derive(Resource, Default)]
pub struct HotbarUiState {
    pub root_entity: Option<Entity>,
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
struct TorchAttachment;

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
            .init_resource::<DraggedItem>()
            .add_systems(Startup, spawn_hotbar_ui)
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
                    update_torch_attachment,
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
    if !keys.just_pressed(KeyCode::KeyI) {
        return;
    }

    if state.open {
        if let Some(root) = state.root_entity.take() {
            commands.entity(root).despawn();
        }
        state.open = false;
        dragged.item = None;
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
                            spawn_hotbar_slots(list, &hotbar, &font);
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
) {
    if !hotbar.is_changed() {
        return;
    }

    let selected_item = hotbar.slots.get(hotbar.selected).copied().flatten();
    if equipped.item != selected_item {
        equipped.item = selected_item;
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
        spawn_hotbar_slots(list, &hotbar, &font);
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
                        Text::new("Inventory (Press I to close)"),
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
) {
    for (index, slot) in hotbar.slots.iter().enumerate() {
        let is_selected = hotbar.selected == index;
        let label = slot.map(|item| item.display_name()).unwrap_or("Empty");

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
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 13.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
    }
}

fn drag_label(dragged: &DraggedItem) -> String {
    match dragged.item {
        Some(item) => format!("Dragging: {}", item.display_name()),
        None => "Drag an item from the inventory".to_string(),
    }
}

fn update_torch_attachment(
    equipped: Res<EquippedItem>,
    mut commands: Commands,
    camera_query: Query<Entity, With<PlayerCamera>>,
    torch_query: Query<Entity, With<TorchAttachment>>,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    if !equipped.is_changed() {
        return;
    }

    let torch_entities: Vec<Entity> = torch_query.iter().collect();
    let wants_torch = matches!(equipped.item, Some(ItemType::Torch));

    if wants_torch {
        if !torch_entities.is_empty() {
            return;
        }

        let Ok(camera_entity) = camera_query.single() else {
            return;
        };

        // Torch handle - wooden stick
        let handle_mesh = meshes.add(Cylinder::new(0.025, 0.45));
        // Torch head wrap - cloth/pitch soaked wrap
        let head_mesh = meshes.add(Cylinder::new(0.04, 0.12));
        // Flame - elongated sphere for fire shape
        let flame_mesh = meshes.add(Sphere::new(0.06).mesh().uv(12, 8));
        let flame_inner_mesh = meshes.add(Sphere::new(0.035).mesh().uv(8, 6));

        let handle_material = materials.add(StandardMaterial {
            base_color: Color::srgb(0.3, 0.18, 0.08),
            perceptual_roughness: 0.9,
            ..default()
        });

        let head_material = materials.add(StandardMaterial {
            base_color: Color::srgb(0.15, 0.1, 0.05),
            perceptual_roughness: 1.0,
            ..default()
        });

        let flame_material = materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.5, 0.1),
            emissive: LinearRgba::new(15.0, 6.0, 1.5, 1.0),
            perceptual_roughness: 0.3,
            unlit: true,
            ..default()
        });

        let flame_inner_material = materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.9, 0.5),
            emissive: LinearRgba::new(20.0, 15.0, 5.0, 1.0),
            perceptual_roughness: 0.2,
            unlit: true,
            ..default()
        });

        commands.entity(camera_entity).with_children(|parent| {
            parent
                .spawn((
                    TorchAttachment,
                    Transform::from_xyz(0.45, -0.35, -0.7).with_rotation(
                        Quat::from_euler(EulerRot::XYZ, 0.3, -0.5, 0.15),
                    ),
                    Visibility::default(),
                ))
                .with_children(|torch| {
                    // Wooden handle
                    torch.spawn((
                        TorchAttachment,
                        Mesh3d(handle_mesh),
                        MeshMaterial3d(handle_material),
                        Transform::from_xyz(0.0, 0.0, 0.0)
                            .with_rotation(Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)),
                    ));

                    // Wrapped head (pitch-soaked cloth)
                    torch.spawn((
                        TorchAttachment,
                        Mesh3d(head_mesh),
                        MeshMaterial3d(head_material),
                        Transform::from_xyz(0.0, 0.0, -0.22)
                            .with_rotation(Quat::from_rotation_x(std::f32::consts::FRAC_PI_2)),
                    ));

                    // Outer flame glow
                    torch.spawn((
                        TorchAttachment,
                        Mesh3d(flame_mesh),
                        MeshMaterial3d(flame_material),
                        Transform::from_xyz(0.0, 0.02, -0.30)
                            .with_scale(Vec3::new(1.0, 1.4, 1.0)),
                    ));

                    // Inner bright core
                    torch.spawn((
                        TorchAttachment,
                        Mesh3d(flame_inner_mesh),
                        MeshMaterial3d(flame_inner_material),
                        Transform::from_xyz(0.0, 0.01, -0.28)
                            .with_scale(Vec3::new(1.0, 1.6, 1.0)),
                    ));

                    // Bright point light
                    torch.spawn((
                        TorchAttachment,
                        PointLight {
                            color: Color::srgb(1.0, 0.7, 0.4),
                            intensity: 80000.0,
                            range: 40.0,
                            shadows_enabled: true,
                            ..default()
                        },
                        Transform::from_xyz(0.0, 0.0, -0.28),
                    ));
                });
        });
    } else {
        for entity in torch_entities {
            commands.entity(entity).despawn();
        }
    }
}
