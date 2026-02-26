//! Radial menu system for building piece selection.
//!
//! Provides a wheel-based UI for quickly selecting building pieces by category.

use bevy::prelude::*;
use bevy::ui::{AlignItems, FlexDirection, JustifyContent, PositionType, Val};
use std::f32::consts::PI;

use crate::building::types::{BuildingPieceRegistry, PieceCategory};

use super::palette::{PaletteItems, PlacementPaletteState, PlacementSelection};

/// Display mode for the palette.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub enum PaletteDisplayMode {
    /// Traditional linear list palette.
    #[default]
    Linear,
    /// Radial wheel menu.
    Radial,
}

/// State for the radial menu.
#[derive(Resource, Default)]
pub struct RadialMenuState {
    /// Currently hovered segment index.
    pub hovered_segment: Option<usize>,
    /// Currently selected category.
    pub selected_category: Option<PieceCategory>,
    /// Items in the current view (categories or pieces).
    pub current_items: Vec<RadialMenuItem>,
    /// Whether we're showing categories or pieces within a category.
    pub showing_pieces: bool,
    /// Screen center for the radial menu.
    pub center: Vec2,
    /// Radius of the radial menu.
    pub radius: f32,
}

/// An item in the radial menu.
#[derive(Clone, Debug)]
pub struct RadialMenuItem {
    /// Display label.
    pub label: String,
    /// Associated selection (if a piece).
    pub selection: Option<PlacementSelection>,
    /// Category (if a category button).
    pub category: Option<PieceCategory>,
}

/// Marker for the radial menu root entity.
#[derive(Component)]
pub struct RadialMenuRoot;

/// Marker for a radial menu segment.
#[derive(Component)]
pub struct RadialSegment {
    /// Index of this segment.
    pub index: usize,
    /// Angle of center of this segment (radians).
    pub angle: f32,
}

/// Marker for the center indicator.
#[derive(Component)]
pub struct RadialCenter;

/// Spawn the radial menu UI.
pub fn spawn_radial_menu(
    commands: &mut Commands,
    radial_state: &mut RadialMenuState,
    registry: &BuildingPieceRegistry,
    windows: &Query<&Window>,
) {
    // Get window center
    let Ok(window) = windows.single() else {
        return;
    };
    let center = Vec2::new(window.width() / 2.0, window.height() / 2.0);
    radial_state.center = center;
    radial_state.radius = 160.0;

    // Build category list
    let categories: Vec<PieceCategory> = registry
        .by_category
        .keys()
        .copied()
        .collect();

    radial_state.current_items = categories
        .iter()
        .map(|cat| RadialMenuItem {
            label: format!("{:?}", cat),
            selection: None,
            category: Some(*cat),
        })
        .collect();
    radial_state.showing_pieces = false;

    let segment_count = radial_state.current_items.len();
    if segment_count == 0 {
        return;
    }

    let segment_angle = 2.0 * PI / segment_count as f32;

    // Spawn root container
    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.3)),
            RadialMenuRoot,
            // Allow pointer events through the background
            Visibility::Visible,
        ))
        .with_children(|parent| {
            // Center indicator
            parent.spawn((
                Node {
                    position_type: PositionType::Absolute,
                    left: Val::Px(center.x - 30.0),
                    top: Val::Px(center.y - 30.0),
                    width: Val::Px(60.0),
                    height: Val::Px(60.0),
                    justify_content: JustifyContent::Center,
                    align_items: AlignItems::Center,
                    border_radius: BorderRadius::all(Val::Px(30.0)),
                    ..default()
                },
                BackgroundColor(Color::srgba(0.2, 0.2, 0.25, 0.95)),
                RadialCenter,
            ))
            .with_children(|center_node| {
                center_node.spawn((
                    Text::new("Build"),
                    TextFont {
                        font_size: 12.0,
                        ..default()
                    },
                    TextColor(Color::WHITE),
                ));
            });

            // Spawn segment buttons
            for (i, item) in radial_state.current_items.iter().enumerate() {
                let angle = (i as f32) * segment_angle - PI / 2.0; // Start from top
                let x = center.x + radial_state.radius * angle.cos();
                let y = center.y + radial_state.radius * angle.sin();

                let button_width = 90.0;
                let button_height = 36.0;

                parent
                    .spawn((
                        Button,
                        Node {
                            position_type: PositionType::Absolute,
                            left: Val::Px(x - button_width / 2.0),
                            top: Val::Px(y - button_height / 2.0),
                            width: Val::Px(button_width),
                            height: Val::Px(button_height),
                            justify_content: JustifyContent::Center,
                            align_items: AlignItems::Center,
                            border_radius: BorderRadius::all(Val::Px(6.0)),
                            ..default()
                        },
                        BackgroundColor(Color::srgba(0.15, 0.15, 0.2, 0.95)),
                        RadialSegment { index: i, angle },
                    ))
                    .with_children(|btn| {
                        btn.spawn((
                            Text::new(&item.label),
                            TextFont {
                                font_size: 13.0,
                                ..default()
                            },
                            TextColor(Color::WHITE),
                        ));
                    });
            }
        });
}

/// Despawn the radial menu.
pub fn despawn_radial_menu(commands: &mut Commands, query: &Query<Entity, With<RadialMenuRoot>>) {
    for entity in query.iter() {
        commands.entity(entity).despawn();
    }
}

/// Handle radial menu interaction.
pub fn handle_radial_menu_interaction(
    mut commands: Commands,
    mut radial_state: ResMut<RadialMenuState>,
    mut palette: ResMut<PlacementPaletteState>,
    registry: Res<BuildingPieceRegistry>,
    windows: Query<&Window>,
    mut segment_query: Query<
        (&RadialSegment, &Interaction, &mut BackgroundColor),
        Changed<Interaction>,
    >,
    radial_root: Query<Entity, With<RadialMenuRoot>>,
    items: Res<PaletteItems>,
) {
    for (segment, interaction, mut bg) in segment_query.iter_mut() {
        match *interaction {
            Interaction::Hovered => {
                radial_state.hovered_segment = Some(segment.index);
                *bg = BackgroundColor(Color::srgba(0.3, 0.4, 0.6, 0.95));
            }
            Interaction::Pressed => {
                // Handle selection
                if let Some(item) = radial_state.current_items.get(segment.index) {
                    if let Some(category) = item.category {
                        // Show pieces for this category
                        radial_state.selected_category = Some(category);
                        radial_state.showing_pieces = true;

                        // Build piece list for this category
                        if let Some(piece_ids) = registry.by_category.get(&category) {
                            radial_state.current_items = piece_ids
                                .iter()
                                .filter_map(|id| {
                                    registry.get(*id).map(|def| RadialMenuItem {
                                        label: def.name.clone(),
                                        selection: Some(PlacementSelection::BuildingPiece {
                                            piece_id: *id,
                                            name: def.name.clone(),
                                        }),
                                        category: None,
                                    })
                                })
                                .collect();
                        }

                        // Rebuild the menu
                        despawn_radial_menu(&mut commands, &radial_root);
                        spawn_radial_pieces_menu(
                            &mut commands,
                            &radial_state,
                            &windows,
                        );
                    } else if let Some(ref selection) = item.selection {
                        // Select this piece
                        palette.active_selection = Some(selection.clone());

                        // Find index in palette items for compatibility
                        if let Some(idx) = items.0.iter().position(|p| {
                            match (&p.selection, selection) {
                                (
                                    PlacementSelection::BuildingPiece { piece_id: a, .. },
                                    PlacementSelection::BuildingPiece { piece_id: b, .. },
                                ) => a == b,
                                _ => false,
                            }
                        }) {
                            palette.selected_index = Some(idx);
                        }

                        // Close the radial menu
                        palette.open = false;
                        despawn_radial_menu(&mut commands, &radial_root);
                    }
                }
            }
            Interaction::None => {
                if radial_state.hovered_segment == Some(segment.index) {
                    radial_state.hovered_segment = None;
                }
                *bg = BackgroundColor(Color::srgba(0.15, 0.15, 0.2, 0.95));
            }
        }
    }
}

/// Spawn the pieces submenu for a category.
fn spawn_radial_pieces_menu(
    commands: &mut Commands,
    radial_state: &RadialMenuState,
    windows: &Query<&Window>,
) {
    let Ok(window) = windows.single() else {
        return;
    };
    let center = Vec2::new(window.width() / 2.0, window.height() / 2.0);

    let segment_count = radial_state.current_items.len();
    if segment_count == 0 {
        return;
    }

    let segment_angle = 2.0 * PI / segment_count as f32;

    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.3)),
            RadialMenuRoot,
        ))
        .with_children(|parent| {
            // Center with category name
            let category_name = radial_state
                .selected_category
                .map(|c| format!("{:?}", c))
                .unwrap_or_else(|| "Pieces".to_string());

            parent
                .spawn((
                    Node {
                        position_type: PositionType::Absolute,
                        left: Val::Px(center.x - 40.0),
                        top: Val::Px(center.y - 20.0),
                        width: Val::Px(80.0),
                        height: Val::Px(40.0),
                        justify_content: JustifyContent::Center,
                        align_items: AlignItems::Center,
                        flex_direction: FlexDirection::Column,
                        border_radius: BorderRadius::all(Val::Px(8.0)),
                        ..default()
                    },
                    BackgroundColor(Color::srgba(0.2, 0.2, 0.25, 0.95)),
                    RadialCenter,
                ))
                .with_children(|center_node| {
                    center_node.spawn((
                        Text::new(category_name),
                        TextFont {
                            font_size: 11.0,
                            ..default()
                        },
                        TextColor(Color::WHITE),
                    ));
                });

            // Spawn piece buttons
            for (i, item) in radial_state.current_items.iter().enumerate() {
                let angle = (i as f32) * segment_angle - PI / 2.0;
                let x = center.x + radial_state.radius * angle.cos();
                let y = center.y + radial_state.radius * angle.sin();

                let button_width = 100.0;
                let button_height = 32.0;

                parent
                    .spawn((
                        Button,
                        Node {
                            position_type: PositionType::Absolute,
                            left: Val::Px(x - button_width / 2.0),
                            top: Val::Px(y - button_height / 2.0),
                            width: Val::Px(button_width),
                            height: Val::Px(button_height),
                            justify_content: JustifyContent::Center,
                            align_items: AlignItems::Center,
                            border_radius: BorderRadius::all(Val::Px(6.0)),
                            ..default()
                        },
                        BackgroundColor(Color::srgba(0.15, 0.15, 0.2, 0.95)),
                        RadialSegment { index: i, angle },
                    ))
                    .with_children(|btn| {
                        btn.spawn((
                            Text::new(&item.label),
                            TextFont {
                                font_size: 12.0,
                                ..default()
                            },
                            TextColor(Color::WHITE),
                        ));
                    });
            }
        });
}

/// Handle escape to go back or close.
pub fn handle_radial_escape(
    mut commands: Commands,
    keys: Res<ButtonInput<KeyCode>>,
    mut radial_state: ResMut<RadialMenuState>,
    mut palette: ResMut<PlacementPaletteState>,
    registry: Res<BuildingPieceRegistry>,
    windows: Query<&Window>,
    radial_root: Query<Entity, With<RadialMenuRoot>>,
) {
    if !palette.open {
        return;
    }

    if keys.just_pressed(KeyCode::Escape) {
        if radial_state.showing_pieces {
            // Go back to categories
            radial_state.showing_pieces = false;
            radial_state.selected_category = None;

            despawn_radial_menu(&mut commands, &radial_root);
            spawn_radial_menu(&mut commands, &mut radial_state, &registry, &windows);
        } else {
            // Close entirely
            palette.open = false;
            despawn_radial_menu(&mut commands, &radial_root);
        }
    }
}
