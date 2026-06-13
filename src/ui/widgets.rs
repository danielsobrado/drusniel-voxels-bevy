//! Small Bevy UI helpers built on the shared fantasy theme.

use bevy::prelude::*;

use super::theme::{
    BODY_TEXT_SIZE, BUTTON_PADDING_X, BUTTON_PADDING_Y, DR_BUTTON_BG, DR_BUTTON_BORDER, DR_GOLD,
    DR_PANEL_BG, DR_PANEL_BORDER, DR_SLOT_BG, DR_TEXT, DR_TEXT_MUTED, PANEL_GAP, PANEL_PADDING,
    SLOT_SIZE, WINDOW_TITLE_SIZE,
};

pub fn fantasy_panel_node() -> Node {
    Node {
        padding: UiRect::all(Val::Px(PANEL_PADDING)),
        flex_direction: FlexDirection::Column,
        row_gap: Val::Px(PANEL_GAP),
        border: UiRect::all(Val::Px(1.0)),
        border_radius: BorderRadius::all(Val::Px(6.0)),
        ..default()
    }
}

pub fn fantasy_button_node(width: Option<f32>) -> Node {
    Node {
        width: width.map_or(Val::Auto, Val::Px),
        padding: UiRect::axes(Val::Px(BUTTON_PADDING_X), Val::Px(BUTTON_PADDING_Y)),
        justify_content: JustifyContent::Center,
        align_items: AlignItems::Center,
        border: UiRect::all(Val::Px(1.0)),
        border_radius: BorderRadius::all(Val::Px(4.0)),
        ..default()
    }
}

pub fn fantasy_slot_node(size: f32) -> Node {
    Node {
        width: Val::Px(size),
        height: Val::Px(size),
        justify_content: JustifyContent::Center,
        align_items: AlignItems::Center,
        border: UiRect::all(Val::Px(1.0)),
        border_radius: BorderRadius::all(Val::Px(4.0)),
        ..default()
    }
}

pub fn spawn_fantasy_title(parent: &mut ChildSpawnerCommands, font: &Handle<Font>, text: &str) {
    parent.spawn((
        Text::new(text),
        TextFont {
            font: font.clone(),
            font_size: WINDOW_TITLE_SIZE,
            ..default()
        },
        TextColor(DR_GOLD),
    ));
}

pub fn spawn_fantasy_section_title(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    text: &str,
) {
    parent.spawn((
        Text::new(text),
        TextFont {
            font: font.clone(),
            font_size: BODY_TEXT_SIZE,
            ..default()
        },
        TextColor(DR_TEXT_MUTED),
    ));
}

pub fn spawn_fantasy_button<M>(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    marker_component: M,
) -> Entity
where
    M: Bundle,
{
    parent
        .spawn((
            Button,
            fantasy_button_node(None),
            BackgroundColor(DR_BUTTON_BG),
            BorderColor::all(DR_BUTTON_BORDER),
            marker_component,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: BODY_TEXT_SIZE,
                    ..default()
                },
                TextColor(DR_TEXT),
            ));
        })
        .id()
}

pub fn fantasy_panel_bundle() -> (Node, BackgroundColor, BorderColor) {
    (
        fantasy_panel_node(),
        BackgroundColor(DR_PANEL_BG),
        BorderColor::all(DR_PANEL_BORDER),
    )
}

pub fn fantasy_slot_bundle(size: Option<f32>) -> (Node, BackgroundColor, BorderColor) {
    (
        fantasy_slot_node(size.unwrap_or(SLOT_SIZE)),
        BackgroundColor(DR_SLOT_BG),
        BorderColor::all(DR_PANEL_BORDER),
    )
}
