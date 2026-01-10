use bevy::prelude::*;
use bevy::ui::{AlignItems, FlexDirection, JustifyContent, PositionType, Val};

use crate::camera::controller::PlayerCamera;
use crate::chat::ChatState;
use crate::entity::{EquippedItem, Inventory, ItemType};
use crate::menu::PauseMenuState;

pub struct InventoryUiPlugin;

#[derive(Resource, Default)]
pub struct InventoryUiState {
    pub open: bool,
    pub root_entity: Option<Entity>,
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

impl Plugin for InventoryUiPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<InventoryUiState>().add_systems(
            Update,
            (
                toggle_inventory_ui,
                handle_inventory_item_buttons,
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
        return;
    }

    if pause_menu.open || chat_state.as_ref().map(|c| c.active).unwrap_or(false) {
        return;
    }

    let root = spawn_inventory_ui(&mut commands, &asset_server, &inventory, &equipped);
    state.root_entity = Some(root);
    state.open = true;
}

fn handle_inventory_item_buttons(
    mut interactions: Query<(&Interaction, &InventoryItemButton), Changed<Interaction>>,
    inventory: Res<Inventory>,
    mut equipped: ResMut<EquippedItem>,
) {
    for (interaction, button) in interactions.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        if inventory.get_count(button.0) == 0 {
            continue;
        }

        if equipped.item == Some(button.0) {
            equipped.item = None;
        } else {
            equipped.item = Some(button.0);
        }
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
                        width: Val::Px(320.0),
                        padding: UiRect::all(Val::Px(18.0)),
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
                                flex_direction: FlexDirection::Column,
                                row_gap: Val::Px(6.0),
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

    if items.is_empty() {
        list.spawn((
            Text::new("Empty"),
            TextFont {
                font: font.clone(),
                font_size: 14.0,
                ..default()
            },
            TextColor(Color::srgba(0.8, 0.8, 0.8, 0.9)),
        ));
        return;
    }

    for (item, count) in items {
        let is_selected = selected == Some(item);
        list.spawn((
            Button,
            Node {
                width: Val::Percent(100.0),
                padding: UiRect::axes(Val::Px(10.0), Val::Px(8.0)),
                ..default()
            },
            BackgroundColor(if is_selected {
                Color::srgba(0.25, 0.4, 0.7, 0.8)
            } else {
                Color::srgba(0.15, 0.15, 0.18, 0.85)
            }),
            InventoryItemButton(item),
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(format!("{} x{}", item.display_name(), count)),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
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

        let handle_mesh = meshes.add(Cuboid::new(0.05, 0.05, 0.35));
        let flame_mesh = meshes.add(Cuboid::new(0.06, 0.06, 0.08));

        let handle_material = materials.add(StandardMaterial {
            base_color: Color::srgb(0.35, 0.2, 0.1),
            perceptual_roughness: 0.8,
            ..default()
        });

        let flame_material = materials.add(StandardMaterial {
            base_color: Color::srgb(1.0, 0.6, 0.2),
            emissive: LinearRgba::new(6.0, 3.0, 1.2, 1.0),
            perceptual_roughness: 0.4,
            ..default()
        });

        commands.entity(camera_entity).with_children(|parent| {
            parent
                .spawn((
                    TorchAttachment,
                    Transform::from_xyz(0.45, -0.35, -0.7).with_rotation(
                        Quat::from_euler(EulerRot::XYZ, 0.2, -0.5, 0.1),
                    ),
                    Visibility::default(),
                ))
                .with_children(|torch| {
                    torch.spawn((
                        Mesh3d(handle_mesh),
                        MeshMaterial3d(handle_material),
                        Transform::from_xyz(0.0, 0.0, 0.0),
                    ));

                    torch.spawn((
                        Mesh3d(flame_mesh),
                        MeshMaterial3d(flame_material),
                        Transform::from_xyz(0.0, 0.06, -0.18),
                    ));

                    torch.spawn((
                        PointLight {
                            color: Color::srgb(1.0, 0.8, 0.6),
                            intensity: 2200.0,
                            range: 16.0,
                            shadows_enabled: false,
                            ..default()
                        },
                        Transform::from_xyz(0.0, 0.06, -0.2),
                    ));
                });
        });
    } else {
        for entity in torch_entities {
            commands.entity(entity).despawn();
        }
    }
}
