use crate::camera::controller::PlayerCamera;
use crate::chat::ChatState;
use crate::menu::PauseMenuState;
use crate::props::{Prop, PropAssets, PropConfig, PropType};
use crate::voxel::types::VoxelType;
use bevy::prelude::*;
use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::ui::{
    AlignItems, FlexDirection, JustifyContent, Overflow,
    PositionType, Val,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::interaction::{DragState, EditMode, TargetedBlock};
use crate::voxel::types::Voxel;
use bevy::ecs::hierarchy::ChildOf;
use crate::voxel::world::VoxelWorld;

#[derive(Clone, PartialEq)]
pub enum PlacementSelection {
    Voxel(VoxelType),
    Prop { id: String, prop_type: PropType },
}

#[derive(Clone)]
pub struct PaletteItem {
    pub label: String,
    pub tags: Vec<String>,
    pub selection: PlacementSelection,
}

#[derive(Resource, Default)]
pub struct PaletteItems(pub Vec<PaletteItem>);

#[derive(Resource, Default)]
pub struct PlacementPaletteState {
    pub open: bool,
    pub search: String,
    pub items_initialized: bool,
    pub needs_redraw: bool,
    pub active_selection: Option<PlacementSelection>,
    pub selected_index: Option<usize>,
    pub root: Option<Entity>,
}

#[derive(Resource, Default)]
pub struct GhostPreviewState {
    pub entity: Option<Entity>,
    pub prop_id: Option<String>,
}

#[derive(Resource)]
pub struct GhostPreviewMaterials {
    pub valid: Handle<StandardMaterial>,
    pub invalid: Handle<StandardMaterial>,
}

#[derive(Component)]
pub struct GhostPreview {
    pub valid: bool,
}

#[derive(Resource)]
pub struct BookmarkStore {
    pub file_path: PathBuf,
    pub bookmarks: Vec<Bookmark>,
    pub dirty: bool,
}

impl Default for BookmarkStore {
    fn default() -> Self {
        Self {
            file_path: PathBuf::from("bookmarks.json"),
            bookmarks: Vec::new(),
            dirty: false,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub name: String,
    pub position: [f32; 3],
    pub yaw: f32,
    pub pitch: f32,
}

#[derive(Component)]
pub struct PaletteRoot;

#[derive(Component)]
pub struct PaletteList;

#[derive(Component)]
pub struct PaletteSearchText;

#[derive(Component)]
pub struct PaletteSelectionText;

#[derive(Component)]
pub struct PaletteItemButton(usize);

#[derive(Component)]
pub struct SaveBookmarkButton;

#[derive(Component)]
pub struct BookmarkList;

#[derive(Component)]
pub struct BookmarkTeleportButton(usize);

#[derive(Component)]
pub struct BookmarkDeleteButton(usize);

pub fn initialize_palette_items(
    mut items: ResMut<PaletteItems>,
    mut palette: ResMut<PlacementPaletteState>,
    config: Res<PropConfig>,
) {
    if palette.items_initialized {
        return;
    }

    let mut all_items = Vec::new();

    for voxel in [
        VoxelType::TopSoil,
        VoxelType::SubSoil,
        VoxelType::Rock,
        VoxelType::Sand,
        VoxelType::Clay,
        VoxelType::Water,
        VoxelType::Wood,
        VoxelType::Leaves,
        VoxelType::DungeonWall,
        VoxelType::DungeonFloor,
    ] {
        all_items.push(PaletteItem {
            label: format!("{:?}", voxel),
            tags: voxel_tags(voxel),
            selection: PlacementSelection::Voxel(voxel),
        });
    }

    for (category, list) in [
        (PropType::Tree, config.props.trees.as_slice()),
        (PropType::Rock, config.props.rocks.as_slice()),
        (PropType::Bush, config.props.bushes.as_slice()),
        (PropType::Flower, config.props.flowers.as_slice()),
    ] {
        for def in list {
            let mut tags = vec![format!("{:?}", category).to_lowercase(), "prop".to_string()];
            for spawn in &def.spawn_on {
                tags.push(spawn.to_lowercase());
            }
            all_items.push(PaletteItem {
                label: def.id.clone(),
                tags,
                selection: PlacementSelection::Prop {
                    id: def.id.clone(),
                    prop_type: category,
                },
            });
        }
    }

    items.0 = all_items;
    palette.items_initialized = true;
    palette.needs_redraw = palette.open;
}

pub fn load_bookmarks(mut store: ResMut<BookmarkStore>) {
    match fs::read_to_string(&store.file_path) {
        Ok(content) => match serde_json::from_str::<Vec<Bookmark>>(&content) {
            Ok(bookmarks) => store.bookmarks = bookmarks,
            Err(err) => warn!("Failed to parse bookmark file: {err}"),
        },
        Err(err) => {
            if err.kind() != std::io::ErrorKind::NotFound {
                warn!("Failed to read bookmark file: {err}");
            }
        }
    }
}

pub fn toggle_palette(
    keys: Res<ButtonInput<KeyCode>>,
    pause_state: Res<PauseMenuState>,
    chat_state: Option<Res<ChatState>>,
    mut palette: ResMut<PlacementPaletteState>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    if pause_state.open || chat_state.as_ref().map(|c| c.active).unwrap_or(false) {
        return;
    }

    if !keys.just_pressed(KeyCode::KeyB) {
        return;
    }

    palette.open = !palette.open;

    if palette.open {
        if palette.selected_index.is_none() {
            palette.selected_index = Some(0);
        }
        spawn_palette_ui(&mut commands, &asset_server, &mut palette);
        palette.needs_redraw = true;
    } else {
        despawn_palette_ui(&mut commands, &mut palette);
    }
}

pub fn handle_palette_input(
    mut palette: ResMut<PlacementPaletteState>,
    pause_state: Res<PauseMenuState>,
    chat_state: Option<Res<ChatState>>,
    keys: Res<ButtonInput<KeyCode>>,
    mut char_evr: MessageReader<KeyboardInput>,
    mut commands: Commands,
    items: Res<PaletteItems>,
    mut held: ResMut<crate::interaction::HeldBlock>,
) {
    if !palette.open || pause_state.open || chat_state.as_ref().map(|c| c.active).unwrap_or(false) {
        return;
    }

    let mut changed = false;

    if keys.just_pressed(KeyCode::Escape) {
        palette.open = false;
        palette.needs_redraw = true;
        despawn_palette_ui(&mut commands, &mut palette);
        return;
    }

    if keys.just_pressed(KeyCode::Backspace) {
        palette.search.pop();
        changed = true;
    }

    for ev in char_evr.read() {
        if !ev.state.is_pressed() {
            continue;
        }
        if let Key::Character(ch) = &ev.logical_key {
            palette.search.push_str(ch);
            changed = true;
        }
    }

    if keys.just_pressed(KeyCode::ArrowUp) || keys.just_pressed(KeyCode::ArrowDown) {
        let filtered = filtered_item_indices(&items, &palette.search);
        if !filtered.is_empty() {
            let current = palette
                .selected_index
                .and_then(|idx| filtered.iter().position(|v| *v == idx))
                .unwrap_or(0);

            let next = if keys.just_pressed(KeyCode::ArrowUp) {
                if current == 0 {
                    filtered.len() - 1
                } else {
                    current - 1
                }
            } else {
                (current + 1) % filtered.len()
            };

            palette.selected_index = Some(filtered[next]);
            changed = true;
        }
    }

    if keys.just_pressed(KeyCode::Enter) || keys.just_pressed(KeyCode::NumpadEnter) {
        if let Some(index) = palette.selected_index {
            if let Some(item) = items.0.get(index).cloned() {
                palette.active_selection = Some(item.selection.clone());
                if let PlacementSelection::Voxel(voxel) = item.selection {
                    held.block_type = voxel;
                }
                changed = true;
            }
        }
    }

    if changed {
        palette.needs_redraw = true;
    }
}

pub fn handle_palette_item_click(
    mut interactions: Query<(&Interaction, &PaletteItemButton), Changed<Interaction>>,
    items: Res<PaletteItems>,
    mut palette: ResMut<PlacementPaletteState>,
    mut held: ResMut<crate::interaction::HeldBlock>,
) {
    if !palette.open {
        return;
    }

    for (interaction, button) in interactions.iter_mut() {
        if *interaction == Interaction::Pressed {
            if let Some(item) = items.0.get(button.0).cloned() {
                palette.active_selection = Some(item.selection.clone());
                palette.selected_index = Some(button.0);
                palette.needs_redraw = true;

                if let PlacementSelection::Voxel(voxel) = item.selection {
                    held.block_type = voxel;
                }
            }
        }
    }
}

pub fn handle_bookmark_buttons(
    mut save_buttons: Query<&Interaction, (Changed<Interaction>, With<SaveBookmarkButton>)>,
    mut teleport_buttons: Query<(&Interaction, &BookmarkTeleportButton), Changed<Interaction>>,
    mut delete_buttons: Query<(&Interaction, &BookmarkDeleteButton), Changed<Interaction>>,
    mut camera_queries: ParamSet<(
        Query<(&Transform, &PlayerCamera)>,
        Query<(&mut Transform, &mut PlayerCamera)>,
    )>,
    mut palette: ResMut<PlacementPaletteState>,
    mut store: ResMut<BookmarkStore>,
) {
    if !palette.open {
        return;
    }

    for interaction in save_buttons.iter_mut() {
        if *interaction == Interaction::Pressed {
            if let Ok((transform, camera)) = camera_queries.p0().single() {
                let name = if palette.search.is_empty() {
                    format!("Bookmark {}", store.bookmarks.len() + 1)
                } else {
                    palette.search.clone()
                };

                store.bookmarks.push(Bookmark {
                    name,
                    position: transform.translation.to_array(),
                    yaw: camera.yaw,
                    pitch: camera.pitch,
                });
                store.dirty = true;
                palette.needs_redraw = true;
            }
        }
    }

    for (interaction, BookmarkTeleportButton(index)) in teleport_buttons.iter_mut() {
        if *interaction == Interaction::Pressed {
            if let Some(bookmark) = store.bookmarks.get(*index).cloned() {
                if let Ok((mut transform, mut camera)) = camera_queries.p1().single_mut() {
                    transform.translation = Vec3::from_array(bookmark.position);
                    transform.rotation =
                        Quat::from_euler(EulerRot::YXZ, bookmark.yaw, bookmark.pitch, 0.0);
                    camera.yaw = bookmark.yaw;
                    camera.pitch = bookmark.pitch;
                    palette.needs_redraw = true;
                }
            }
        }
    }

    let mut removed = false;
    for (interaction, BookmarkDeleteButton(index)) in delete_buttons.iter_mut() {
        if *interaction == Interaction::Pressed {
            if *index < store.bookmarks.len() {
                store.bookmarks.remove(*index);
                removed = true;
            }
        }
    }

    if removed {
        store.dirty = true;
        palette.needs_redraw = true;
    }
}

pub fn refresh_palette_ui(
    items: Res<PaletteItems>,
    mut palette: ResMut<PlacementPaletteState>,
    store: Res<BookmarkStore>,
    mut text_queries: ParamSet<(
        Query<&mut Text, With<PaletteSearchText>>,
        Query<&mut Text, With<PaletteSelectionText>>,
    )>,
    list_query: Query<Entity, With<PaletteList>>,
    bookmark_query: Query<Entity, With<BookmarkList>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    if !palette.open || !palette.needs_redraw {
        return;
    }

    if let Ok(mut search_text) = text_queries.p0().single_mut() {
        search_text.0 = format!("Search: {}", palette.search);
    }

    if let Ok(mut selection_text) = text_queries.p1().single_mut() {
        selection_text.0 = match &palette.active_selection {
            Some(PlacementSelection::Voxel(v)) => format!("Selected: {:?}", v),
            Some(PlacementSelection::Prop { id, prop_type }) => {
                format!("Selected: {} ({:?})", id, prop_type)
            }
            None => "Selected: (none)".to_string(),
        };
    }

    if let Ok(list_entity) = list_query.single() {
        commands.entity(list_entity).despawn_children();

        let visible_indices = filtered_item_indices(&items, &palette.search);
        if palette.selected_index.is_none()
            || !visible_indices.contains(&palette.selected_index.unwrap())
        {
            palette.selected_index = visible_indices.first().copied();
        }

        let font = asset_server.load("fonts/FiraSans-Bold.ttf");

        for index in visible_indices.iter().take(40) {
            let Some(item) = items.0.get(*index) else {
                continue;
            };
            let is_selected = palette
                .active_selection
                .as_ref()
                .map(|sel| sel == &item.selection)
                .unwrap_or(false);
            let is_focused = palette.selected_index == Some(*index);

            commands.entity(list_entity).with_children(|list| {
                list.spawn((
                    Button,
                    Node {
                        width: Val::Percent(100.0),
                        padding: UiRect::axes(Val::Px(10.0), Val::Px(8.0)),
                        margin: UiRect::bottom(Val::Px(6.0)),
                        flex_direction: FlexDirection::Column,
                        row_gap: Val::Px(4.0),
                        ..default()
                    },
                    BackgroundColor(if is_selected {
                        Color::srgba(0.25, 0.4, 0.7, 0.8)
                    } else if is_focused {
                        Color::srgba(0.18, 0.2, 0.26, 0.9)
                    } else {
                        Color::srgba(0.15, 0.15, 0.18, 0.85)
                    }),
                    PaletteItemButton(*index),
                ))
                .with_children(|button| {
                    button.spawn((
                        Text::new(&item.label),
                        TextFont {
                            font: font.clone(),
                            font_size: 16.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));

                    if !item.tags.is_empty() {
                        button.spawn((
                            Text::new(format!("Tags: {}", item.tags.join(", "))),
                            TextFont {
                                font: font.clone(),
                                font_size: 12.0,
                                ..default()
                            },
                            TextColor(Color::srgba(0.8, 0.8, 0.8, 0.9)),
                        ));
                    }
                });
            });
        }
    }

    if let Ok(list_entity) = bookmark_query.single() {
        commands.entity(list_entity).despawn_children();

        let font = asset_server.load("fonts/FiraSans-Bold.ttf");

        for (index, bookmark) in store.bookmarks.iter().enumerate() {
            let name = format!(
                "{} (x: {:.1}, y: {:.1}, z: {:.1})",
                bookmark.name, bookmark.position[0], bookmark.position[1], bookmark.position[2]
            );

            commands.entity(list_entity).with_children(|list| {
                list.spawn((
                    Node {
                        flex_direction: FlexDirection::Row,
                        justify_content: JustifyContent::SpaceBetween,
                        align_items: AlignItems::Center,
                        column_gap: Val::Px(6.0),
                        padding: UiRect::all(Val::Px(4.0)),
                        margin: UiRect::bottom(Val::Px(4.0)),
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.12, 0.12, 0.15, 0.8)),
                ))
                .with_children(|row| {
                    row.spawn((
                        Text::new(name),
                        TextFont {
                            font: font.clone(),
                            font_size: 12.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));

                    row.spawn((
                        Button,
                        Node {
                            padding: UiRect::axes(Val::Px(8.0), Val::Px(6.0)),
                            ..default()
                        },
                        BackgroundColor(Color::srgba(0.2, 0.35, 0.2, 0.85)),
                        BookmarkTeleportButton(index),
                    ))
                    .with_children(|button| {
                        button.spawn((
                            Text::new("Teleport"),
                            TextFont {
                                font: font.clone(),
                                font_size: 12.0,
                                ..default()
                            },
                            TextColor(Color::WHITE),
                        ));
                    });

                    row.spawn((
                        Button,
                        Node {
                            padding: UiRect::axes(Val::Px(8.0), Val::Px(6.0)),
                            ..default()
                        },
                        BackgroundColor(Color::srgba(0.35, 0.15, 0.15, 0.85)),
                        BookmarkDeleteButton(index),
                    ))
                    .with_children(|button| {
                        button.spawn((
                            Text::new("Delete"),
                            TextFont {
                                font: font.clone(),
                                font_size: 12.0,
                                ..default()
                            },
                            TextColor(Color::WHITE),
                        ));
                    });
                });
            });
        }
    }

    palette.needs_redraw = false;
}

pub fn place_prop_from_palette(
    mouse: Res<ButtonInput<MouseButton>>,
    edit_mode: Res<crate::interaction::EditMode>,
    delete_mode: Res<crate::interaction::DeleteMode>,
    drag_state: Res<crate::interaction::DragState>,
    targeted: Res<crate::interaction::TargetedBlock>,
    palette: Res<PlacementPaletteState>,
    prop_assets: Res<PropAssets>,
    mut commands: Commands,
) {
    if !palette.open && palette.active_selection.is_none() {
        return;
    }

    if !edit_mode.enabled || delete_mode.enabled || drag_state.dragged_block.is_some() {
        return;
    }

    if !mouse.just_pressed(MouseButton::Right) {
        return;
    }

    let Some(PlacementSelection::Prop { id, prop_type }) = &palette.active_selection else {
        return;
    };

    let (Some(block_pos), Some(normal)) = (targeted.position, targeted.normal) else {
        return;
    };

    let place_pos = block_pos + normal;
    let translation = Vec3::new(
        place_pos.x as f32 + 0.5,
        place_pos.y as f32 + 0.5,
        place_pos.z as f32 + 0.5,
    );

    let Some(scene) = prop_assets.scenes.get(id) else {
        return;
    };

    let rotation = Quat::from_rotation_y(drag_state.rotation_degrees.to_radians());
    commands.spawn((
        SceneRoot(scene.clone()),
        Transform::from_translation(translation).with_rotation(rotation),
        Prop {
            id: id.clone(),
            prop_type: *prop_type,
        },
    ));
}

pub fn setup_ghost_materials(
    mut commands: Commands,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let valid = materials.add(StandardMaterial {
        base_color: Color::srgba(0.2, 1.0, 0.2, 0.45),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    let invalid = materials.add(StandardMaterial {
        base_color: Color::srgba(1.0, 0.2, 0.2, 0.45),
        unlit: true,
        alpha_mode: AlphaMode::Blend,
        ..default()
    });

    commands.insert_resource(GhostPreviewMaterials { valid, invalid });
}

pub fn update_ghost_preview(
    mut commands: Commands,
    edit_mode: Res<EditMode>,
    palette: Res<PlacementPaletteState>,
    drag_state: Res<DragState>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    prop_assets: Res<PropAssets>,
    mut state: ResMut<GhostPreviewState>,
) {
    if !edit_mode.enabled {
        if let Some(entity) = state.entity.take() {
            commands.entity(entity).despawn();
        }
        state.prop_id = None;
        return;
    }

    let Some(PlacementSelection::Prop { id, .. }) = &palette.active_selection else {
        if let Some(entity) = state.entity.take() {
            commands.entity(entity).despawn();
        }
        state.prop_id = None;
        return;
    };

    let Some(scene) = prop_assets.scenes.get(id) else {
        return;
    };

    let (Some(block_pos), Some(normal)) = (targeted.position, targeted.normal) else {
        if let Some(entity) = state.entity {
            commands.entity(entity).insert(Visibility::Hidden);
        }
        return;
    };

    let place_pos = block_pos + normal;
    let target_voxel = world.get_voxel(block_pos);
    let place_voxel = world.get_voxel(place_pos);
    let valid = target_voxel.map(|v| v.is_solid()).unwrap_or(false)
        && place_voxel
            .map(|v| v == VoxelType::Air || v == VoxelType::Water)
            .unwrap_or(false);

    let translation = Vec3::new(
        place_pos.x as f32 + 0.5,
        place_pos.y as f32 + 0.5,
        place_pos.z as f32 + 0.5,
    );
    let rotation = Quat::from_rotation_y(drag_state.rotation_degrees.to_radians());

    let needs_respawn = state
        .prop_id
        .as_ref()
        .map(|current| current != id)
        .unwrap_or(true);

    if needs_respawn {
        if let Some(entity) = state.entity.take() {
            commands.entity(entity).despawn();
        }

        let entity = commands
            .spawn((
                GhostPreview { valid },
                Transform::from_translation(translation).with_rotation(rotation),
                Visibility::Visible,
            ))
            .with_children(|parent| {
                parent.spawn(SceneRoot(scene.clone()));
            })
            .id();

        state.entity = Some(entity);
        state.prop_id = Some(id.clone());
    } else if let Some(entity) = state.entity {
        commands.entity(entity).insert((
            GhostPreview { valid },
            Transform::from_translation(translation).with_rotation(rotation),
            Visibility::Visible,
        ));
    }
}

pub fn sync_ghost_materials(
    ghost_roots: Query<(Entity, &GhostPreview)>,
    parents: Query<&ChildOf>,
    mut materials_query: Query<(Entity, &mut MeshMaterial3d<StandardMaterial>)>,
    ghost_materials: Res<GhostPreviewMaterials>,
) {
    let mut ghost_iter = ghost_roots.iter();
    let Some((ghost_root, ghost)) = ghost_iter.next() else {
        return;
    };
    if ghost_iter.next().is_some() {
        return;
    }
    let target = if ghost.valid {
        &ghost_materials.valid
    } else {
        &ghost_materials.invalid
    };

    for (entity, mut material) in materials_query.iter_mut() {
        if is_descendant_of(entity, ghost_root, &parents) && material.0 != *target {
            material.0 = target.clone();
        }
    }
}

fn filtered_item_indices(items: &PaletteItems, search: &str) -> Vec<usize> {
    let search_lower = search.to_lowercase();

    let mut matches: Vec<(usize, &PaletteItem)> = items
        .0
        .iter()
        .enumerate()
        .filter(|(_, item)| {
            if search_lower.is_empty() {
                return true;
            }
            let label_match = item.label.to_lowercase().contains(&search_lower);
            let tag_match = item
                .tags
                .iter()
                .any(|t| t.to_lowercase().contains(&search_lower));
            label_match || tag_match
        })
        .collect();

    matches.sort_by(|a, b| a.1.label.cmp(&b.1.label));
    matches.into_iter().map(|(index, _)| index).collect()
}

fn is_descendant_of(mut entity: Entity, root: Entity, parents: &Query<&ChildOf>) -> bool {
    loop {
        if entity == root {
            return true;
        }
        let Ok(parent) = parents.get(entity) else {
            return false;
        };
        entity = parent.parent();
    }
}

fn spawn_palette_ui(
    commands: &mut Commands,
    asset_server: &Res<AssetServer>,
    palette: &mut ResMut<PlacementPaletteState>,
) {
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");

    let root = commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                top: Val::Px(20.0),
                right: Val::Px(20.0),
                width: Val::Px(360.0),
                max_height: Val::Px(640.0),
                padding: UiRect::all(Val::Px(12.0)),
                row_gap: Val::Px(10.0),
                flex_direction: FlexDirection::Column,
                ..default()
            },
            BackgroundColor(Color::srgba(0.05, 0.05, 0.07, 0.9)),
            PaletteRoot,
        ))
        .with_children(|root| {
            root.spawn((
                Text::new("Placement Palette (Esc to close)"),
                TextFont {
                    font: font.clone(),
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));

            root.spawn((
                Text::new("Search:"),
                TextFont {
                    font: font.clone(),
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
                PaletteSearchText,
            ));

            root.spawn((
                Text::new("Selected: (none)"),
                TextFont {
                    font: font.clone(),
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
                PaletteSelectionText,
            ));

            root.spawn((
                Button,
                Node {
                    padding: UiRect::axes(Val::Px(10.0), Val::Px(8.0)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.2, 0.3, 0.2, 0.9)),
                SaveBookmarkButton,
            ))
            .with_children(|button| {
                button.spawn((
                    Text::new("Bookmark current position (uses search text for name)"),
                    TextFont {
                        font: font.clone(),
                        font_size: 14.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
            });

            root.spawn((
                Text::new("Bookmarks:"),
                TextFont {
                    font: font.clone(),
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::srgba(0.85, 0.85, 0.85, 1.0)),
            ));

            root.spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: Val::Px(4.0),
                    max_height: Val::Px(160.0),
                    overflow: Overflow::clip_y(),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.08, 0.08, 0.1, 0.8)),
                BookmarkList,
            ));

            root.spawn((
                Node {
                    flex_direction: FlexDirection::Column,
                    row_gap: Val::Px(4.0),
                    max_height: Val::Px(520.0),
                    overflow: Overflow::clip_y(),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.1, 0.1, 0.12, 0.8)),
                PaletteList,
            ));

            root.spawn((
                Text::new("Right click while editing to place props. Voxels use the held block."),
                TextFont {
                    font: font.clone(),
                    font_size: 12.0,
                    ..default()
                },
                TextColor(Color::srgba(0.8, 0.8, 0.8, 0.8)),
            ));
        })
        .id();

    palette.root = Some(root);
}

fn despawn_palette_ui(commands: &mut Commands, palette: &mut ResMut<PlacementPaletteState>) {
    if let Some(entity) = palette.root.take() {
        commands.entity(entity).despawn();
    }
}

pub fn persist_bookmarks(mut store: ResMut<BookmarkStore>) {
    if !store.dirty {
        return;
    }

    if let Some(parent) = store.file_path.parent() {
        if let Err(err) = fs::create_dir_all(parent) {
            warn!("Failed to create bookmark directory: {err}");
            return;
        }
    }

    match serde_json::to_string_pretty(&store.bookmarks) {
        Ok(serialized) => match fs::write(&store.file_path, serialized) {
            Ok(_) => store.dirty = false,
            Err(err) => warn!("Failed to write bookmarks: {err}"),
        },
        Err(err) => warn!("Failed to serialize bookmarks: {err}"),
    }
}

fn voxel_tags(voxel: VoxelType) -> Vec<String> {
    match voxel {
        VoxelType::TopSoil => vec!["material".into(), "soil".into(), "ground".into()],
        VoxelType::SubSoil => vec!["material".into(), "soil".into()],
        VoxelType::Rock => vec!["material".into(), "stone".into()],
        VoxelType::Sand => vec!["material".into(), "sand".into()],
        VoxelType::Clay => vec!["material".into(), "clay".into()],
        VoxelType::Water => vec!["liquid".into(), "water".into()],
        VoxelType::Wood => vec!["material".into(), "wood".into(), "tree".into()],
        VoxelType::Leaves => vec!["material".into(), "foliage".into()],
        VoxelType::DungeonWall => vec!["material".into(), "dungeon".into()],
        VoxelType::DungeonFloor => vec!["material".into(), "dungeon".into()],
        VoxelType::Air | VoxelType::Bedrock => vec!["hidden".into()],
    }
}
