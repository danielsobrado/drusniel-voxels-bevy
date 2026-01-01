//! Menu system for pause menu, settings, and multiplayer.
//!
//! This module provides:
//! - Pause menu with save/load, settings, and multiplayer access
//! - Settings dialog with graphics, gameplay, and atmosphere options
//! - Multiplayer connectivity with server hosting and client connection

mod multiplayer;
mod settings;
mod types;
mod ui;

// Re-export public types
pub use types::{
    AntiAliasing, DayLengthOption, DisplayMode, ExposureOption, FavoriteServer,
    FloatHeightPreset, FogPresetOption, GraphicsQuality, JumpHeightPreset, MenuScreen,
    MieDirectionOption, MieOption, MultiplayerField, MultiplayerFormState,
    NightBrightnessOption, PauseMenuState, RayleighOption, SettingsState,
    SettingsTab, ShadowFiltering, TimeScaleOption, TwilightBandOption, WalkSpeedPreset,
    RunSpeedPreset,
};

use types::{
    ConnectTaskState, FavoritesList, PauseMenuButton, PauseMenuRoot,
};

use crate::chat::ChatState;
use crate::network::NetworkSession;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::voxel::{meshing::ChunkMesh, persistence, world::VoxelWorld};
use bevy::prelude::*;

// ============================================================================
// Plugin
// ============================================================================

/// Plugin for the pause menu system.
pub struct PauseMenuPlugin;

impl Plugin for PauseMenuPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<PauseMenuState>()
            .init_resource::<SettingsState>()
            .init_resource::<MultiplayerFormState>()
            .init_resource::<ConnectTaskState>()
            .init_resource::<ChatState>()
            .init_resource::<NetworkSession>()
            // Core menu systems
            .add_systems(Update, toggle_pause_menu)
            .add_systems(Update, handle_menu_buttons)
            .add_systems(Update, multiplayer::poll_connect_task_results)
            // Settings systems
            .add_systems(
                Update,
                (
                    settings::handle_settings_tabs,
                    settings::handle_graphics_settings,
                    settings::handle_gameplay_settings,
                    settings::handle_atmosphere_settings,
                    settings::handle_close_settings,
                ),
            )
            // Input systems
            .add_systems(Update, multiplayer::handle_input_interaction)
            .add_systems(Update, multiplayer::process_input_characters)
            .add_systems(Update, (multiplayer::update_input_texts, multiplayer::update_input_backgrounds))
            // Settings UI updates
            .add_systems(
                Update,
                (
                    settings::update_settings_tab_backgrounds,
                    settings::update_settings_content_visibility,
                    settings::update_settings_graphics_backgrounds,
                    settings::update_settings_aa_backgrounds,
                    settings::update_settings_walk_speed_backgrounds,
                    settings::update_settings_run_speed_backgrounds,
                ),
            )
            .add_systems(
                Update,
                (
                    settings::update_settings_ray_tracing_backgrounds,
                    settings::update_settings_display_mode_backgrounds,
                    settings::update_settings_resolution_backgrounds,
                    settings::update_settings_shadow_filtering_backgrounds,
                    settings::update_day_length_backgrounds,
                    settings::update_settings_jump_height_backgrounds,
                    settings::update_settings_float_height_backgrounds,
                ),
            )
            .add_systems(
                Update,
                (
                    settings::update_time_scale_backgrounds,
                    settings::update_rayleigh_backgrounds,
                    settings::update_mie_backgrounds,
                    settings::update_mie_direction_backgrounds,
                ),
            )
            .add_systems(
                Update,
                (
                    settings::update_exposure_backgrounds,
                    settings::update_twilight_backgrounds,
                    settings::update_night_backgrounds,
                    settings::update_fog_backgrounds,
                    settings::update_cycle_backgrounds,
                    multiplayer::handle_favorite_buttons,
                ),
            );
    }
}

// ============================================================================
// Core Menu Systems
// ============================================================================

/// Toggles the pause menu when Escape is pressed.
fn toggle_pause_menu(
    keys: Res<ButtonInput<KeyCode>>,
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut state: ResMut<PauseMenuState>,
    mut form_state: ResMut<MultiplayerFormState>,
    mut settings_state: ResMut<SettingsState>,
) {
    if !keys.just_pressed(KeyCode::Escape) {
        return;
    }

    if state.open {
        close_menu(&mut commands, &mut state, &mut form_state, &mut settings_state);
    } else {
        open_menu(&mut commands, &asset_server, &mut state, &form_state);
    }
}

fn open_menu(
    commands: &mut Commands,
    asset_server: &Res<AssetServer>,
    state: &mut PauseMenuState,
    form_state: &MultiplayerFormState,
) {
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");

    let root = commands
        .spawn((
            Node {
                width: Val::Percent(100.0),
                height: Val::Percent(100.0),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(ui::MENU_OVERLAY_BG),
            PauseMenuRoot,
        ))
        .with_children(|parent| match state.current_screen {
            MenuScreen::Main => ui::spawn_main_menu(parent, &font),
            MenuScreen::Multiplayer => multiplayer::spawn_multiplayer_menu(parent, &font, form_state),
        })
        .id();

    state.root_entity = Some(root);
    state.open = true;
}

fn close_menu(
    commands: &mut Commands,
    state: &mut PauseMenuState,
    form_state: &mut MultiplayerFormState,
    settings_state: &mut SettingsState,
) {
    if let Some(root) = state.root_entity.take() {
        commands.entity(root).despawn();
    }
    settings::close_settings_dialog(commands, settings_state);
    form_state.active_field = None;
    state.open = false;
    state.current_screen = MenuScreen::Main;
}

// ============================================================================
// Menu Button Handling
// ============================================================================

/// Handles menu button clicks.
fn handle_menu_buttons(
    mut interaction_query: Query<
        (&Interaction, &PauseMenuButton),
        (Changed<Interaction>, With<Button>),
    >,
    mut world: ResMut<VoxelWorld>,
    chunk_meshes: Query<Entity, With<ChunkMesh>>,
    mut state: ResMut<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    mut form_state: ResMut<MultiplayerFormState>,
    mut connect_tasks: ResMut<ConnectTaskState>,
    mut network: ResMut<NetworkSession>,
    mut chat: ResMut<ChatState>,
    favorites_list: Query<Entity, With<FavoritesList>>,
    asset_server: Res<AssetServer>,
    mut commands: Commands,
    capabilities: Res<GraphicsCapabilities>,
) {
    for (interaction, action) in interaction_query.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        match action {
            PauseMenuButton::Save => {
                handle_save_button(&world);
            }
            PauseMenuButton::Load => {
                handle_load_button(&mut commands, &chunk_meshes, &mut world);
            }
            PauseMenuButton::StartServer => {
                multiplayer::handle_start_server(&form_state, &mut network, &mut chat);
            }
            PauseMenuButton::Connect => {
                multiplayer::handle_connect_button(
                    &form_state,
                    &mut connect_tasks,
                    &network,
                    &mut chat,
                );
            }
            PauseMenuButton::Settings => {
                handle_settings_button(
                    &mut commands,
                    &asset_server,
                    &state,
                    &mut settings_state,
                    &capabilities,
                );
            }
            PauseMenuButton::Multiplayer => {
                handle_multiplayer_button(&mut commands, &asset_server, &mut state, &form_state);
            }
            PauseMenuButton::BackToMain => {
                handle_back_to_main(&mut commands, &asset_server, &mut state);
            }
            PauseMenuButton::SaveFavorite => {
                multiplayer::handle_save_favorite(
                    &mut commands,
                    &asset_server,
                    &mut form_state,
                    &favorites_list,
                );
            }
            PauseMenuButton::Resume => {
                close_menu(&mut commands, &mut state, &mut form_state, &mut settings_state);
            }
        }

        if !matches!(action, PauseMenuButton::Resume) {
            state.open = true;
        }
    }
}

fn handle_save_button(world: &VoxelWorld) {
    match persistence::save_world(world) {
        Ok(()) => info!("World saved via pause menu"),
        Err(err) => warn!("Failed to save world: {}", err),
    }
}

fn handle_load_button(
    commands: &mut Commands,
    chunk_meshes: &Query<Entity, With<ChunkMesh>>,
    world: &mut VoxelWorld,
) {
    for entity in chunk_meshes.iter() {
        commands.entity(entity).despawn();
    }
    match persistence::load_world() {
        Ok(loaded_world) => {
            *world = loaded_world;
            info!("World loaded from disk via pause menu");
        }
        Err(err) => warn!("Failed to load world: {}", err),
    }
}

fn handle_settings_button(
    commands: &mut Commands,
    asset_server: &AssetServer,
    state: &PauseMenuState,
    settings_state: &mut SettingsState,
    capabilities: &GraphicsCapabilities,
) {
    if settings_state.dialog_root.is_none() {
        let font = asset_server.load("fonts/FiraSans-Bold.ttf");
        settings_state.active_tab = SettingsTab::Graphics;
        settings_state.dialog_root = Some(settings::spawn_settings_dialog(
            commands,
            state.root_entity,
            &font,
            settings_state.clone(),
            capabilities.ray_tracing_supported,
        ));
    }
}

fn handle_multiplayer_button(
    commands: &mut Commands,
    asset_server: &AssetServer,
    state: &mut PauseMenuState,
    form_state: &MultiplayerFormState,
) {
    state.current_screen = MenuScreen::Multiplayer;
    if let Some(root) = state.root_entity {
        commands.entity(root).despawn();
    }
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");
    let root = ui::spawn_menu_root(commands, &font, |parent| {
        multiplayer::spawn_multiplayer_menu(parent, &font, form_state);
    });
    state.root_entity = Some(root);
}

fn handle_back_to_main(
    commands: &mut Commands,
    asset_server: &AssetServer,
    state: &mut PauseMenuState,
) {
    state.current_screen = MenuScreen::Main;
    if let Some(root) = state.root_entity {
        commands.entity(root).despawn();
    }
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");
    let root = ui::spawn_menu_root(commands, &font, |parent| {
        ui::spawn_main_menu(parent, &font);
    });
    state.root_entity = Some(root);
}
