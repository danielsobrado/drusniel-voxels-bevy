//! Shared menu UI components and constants.
//!
//! This module provides common UI elements used across the menu system.

use bevy::prelude::*;
use super::types::*;

// ============================================================================
// Constants
// ============================================================================

/// Background color for active/selected buttons.
pub const ACTIVE_BG: Color = Color::srgba(0.32, 0.42, 0.35, 0.95);

/// Background color for inactive buttons.
pub const INACTIVE_BG: Color = Color::srgba(0.2, 0.2, 0.2, 0.9);

/// Background color for active input fields.
pub const INPUT_ACTIVE_BG: Color = Color::srgba(0.3, 0.35, 0.45, 0.95);

/// Background color for inactive input fields.
pub const INPUT_INACTIVE_BG: Color = Color::srgba(0.2, 0.2, 0.2, 0.95);

/// Background color for the menu overlay.
pub const MENU_OVERLAY_BG: Color = Color::srgba(0.0, 0.0, 0.0, 0.5);

/// Background color for menu panels.
pub const MENU_PANEL_BG: Color = Color::srgba(0.1, 0.1, 0.1, 0.9);

/// Background color for standard buttons.
pub const BUTTON_BG: Color = Color::srgba(0.25, 0.25, 0.25, 0.9);

/// Background color for section containers.
pub const SECTION_BG: Color = Color::srgba(0.15, 0.15, 0.15, 0.8);

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
            font_size: 32.0,
            ..default()
        },
        TextColor(Color::WHITE),
    ));
}

/// Spawns a section title text element.
pub fn spawn_section_title(parent: &mut ChildSpawnerCommands, font: &Handle<Font>, text: &str) {
    parent.spawn((
        Text::new(text),
        TextFont {
            font: font.clone(),
            font_size: 22.0,
            ..default()
        },
        TextColor(Color::WHITE),
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
            Node {
                width: Val::Px(160.0),
                padding: UiRect::all(Val::Px(12.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(BUTTON_BG),
            action,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 20.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

/// Spawns the main menu content.
pub fn spawn_main_menu(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Center,
                row_gap: Val::Px(16.0),
                padding: UiRect::all(Val::Px(30.0)),
                ..default()
            },
            BackgroundColor(MENU_PANEL_BG),
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
