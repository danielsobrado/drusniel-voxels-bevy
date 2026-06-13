//! Shared menu UI components and constants.
//!
//! This module provides common UI elements used across the menu system.

use super::types::*;
use crate::ui::theme::{
    BODY_TEXT_SIZE, DR_BUTTON_ACTIVE_BG, DR_BUTTON_BG, DR_BUTTON_BORDER, DR_BUTTON_HOVER_BG,
    DR_GOLD, DR_GOLD_DIM, DR_OVERLAY_BG, DR_PANEL_BG, DR_PANEL_BG_STRONG, DR_PANEL_BORDER_STRONG,
    DR_SLOT_BG, DR_TEXT, PANEL_GAP, PANEL_PADDING, WINDOW_TITLE_SIZE,
};
use crate::ui::widgets::fantasy_button_node;
use bevy::prelude::*;

// ============================================================================
// Constants
// ============================================================================

/// Background color for active/selected buttons.
pub const ACTIVE_BG: Color = DR_BUTTON_ACTIVE_BG;

/// Background color for inactive buttons.
pub const INACTIVE_BG: Color = DR_BUTTON_BG;

/// Background color for active input fields.
pub const INPUT_ACTIVE_BG: Color = DR_BUTTON_HOVER_BG;

/// Background color for inactive input fields.
pub const INPUT_INACTIVE_BG: Color = DR_SLOT_BG;

/// Background color for the menu overlay.
pub const MENU_OVERLAY_BG: Color = DR_OVERLAY_BG;

/// Background color for menu panels.
pub const MENU_PANEL_BG: Color = DR_PANEL_BG_STRONG;

/// Background color for standard buttons.
pub const BUTTON_BG: Color = DR_BUTTON_BG;

/// Background color for section containers.
pub const SECTION_BG: Color = DR_PANEL_BG;

// ============================================================================
// Menu Root
// ============================================================================

/// Spawns the menu root container with an overlay background.
pub fn spawn_menu_root<F>(commands: &mut Commands, _font: &Handle<Font>, children: F) -> Entity
where
    F: FnOnce(&mut ChildSpawnerCommands),
{
    commands
        .spawn((
            Node {
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(MENU_OVERLAY_BG),
            PauseMenuRoot,
        ))
        .with_children(children)
        .id()
}

// ============================================================================
// Common UI Elements
// ============================================================================

/// Spawns a menu title text element.
pub fn spawn_menu_title(parent: &mut ChildSpawnerCommands, font: &Handle<Font>, text: &str) {
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

/// Spawns a section title text element.
pub fn spawn_section_title(parent: &mut ChildSpawnerCommands, font: &Handle<Font>, text: &str) {
    parent.spawn((
        Text::new(text),
        TextFont {
            font: font.clone(),
            font_size: BODY_TEXT_SIZE,
            ..default()
        },
        TextColor(DR_GOLD_DIM),
    ));
}

/// Spawns a standard menu button.
pub fn spawn_button(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    action: PauseMenuButton,
) {
    parent
        .spawn((
            Button,
            fantasy_button_node(Some(180.0)),
            BackgroundColor(BUTTON_BG),
            BorderColor::all(DR_BUTTON_BORDER),
            action,
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
        });
}

/// Spawns the main menu content.
pub fn spawn_main_menu(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
        .spawn((
            Node {
                width: Val::Px(260.0),
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                row_gap: Val::Px(PANEL_GAP),
                padding: UiRect::all(Val::Px(PANEL_PADDING)),
                border: UiRect::all(Val::Px(2.0)),
                border_radius: BorderRadius::all(Val::Px(8.0)),
                ..default()
            },
            BackgroundColor(MENU_PANEL_BG),
            BorderColor::all(DR_PANEL_BORDER_STRONG),
        ))
        .with_children(|menu| {
            spawn_menu_title(menu, font, "Game Menu");
            spawn_button(menu, font, "Load", PauseMenuButton::Load);
            spawn_button(menu, font, "Save", PauseMenuButton::Save);
            spawn_button(menu, font, "Multiplayer", PauseMenuButton::Multiplayer);
            spawn_button(menu, font, "Settings", PauseMenuButton::Settings);
            spawn_button(menu, font, "Resume", PauseMenuButton::Resume);
        });
}
