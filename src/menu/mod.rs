//! Menu system for pause menu, settings, and multiplayer.
//!
//! This module provides:
//! - Pause menu with save/load, settings, and multiplayer access
//! - Settings dialog with graphics, gameplay, and atmosphere options
//! - Multiplayer connectivity with server hosting and client connection

mod multiplayer;
mod preview_3d;
mod settings;
mod settings_persistence;
mod types;
mod ui;

// Re-export public types
pub use types::{
    AntiAliasing, DayLengthOption, DisplayMode, ExposureOption, FavoriteServer,
    FloatHeightPreset, FogPresetOption, GraphicsQuality, JumpHeightPreset, MenuScreen,
    MieDirectionOption, MieOption, MultiplayerField, MultiplayerFormState,
    NightBrightnessOption, PauseMenuState, RayleighOption, SettingsDialogDrag, SettingsState,
    SettingsTab, ShadowFiltering, TimeScaleOption, TwilightBandOption, WalkSpeedPreset,
    RunSpeedPreset, VisualSettings, VisualSlider, SliderValueText, SliderTrack, SliderFill,
};
pub use preview_3d::{BlockPreviewImage, BlockPreviewPlugin};

use types::{
    ConnectTaskState, FavoritesList, PauseMenuButton, PauseMenuRoot, SettingsInputState,
};

use crate::atmosphere::FogConfig;
use crate::chat::ChatState;
use crate::environment::AtmosphereSettings;
use crate::network::NetworkSession;
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::voxel::{meshing::ChunkMesh, persistence, plugin::WorldConfig, world::VoxelWorld};
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
            .init_resource::<types::VisualSettings>()
            .init_resource::<SettingsInputState>()
            .add_plugins(BlockPreviewPlugin)

            .init_resource::<types::RebindState>()
            .init_resource::<types::SettingsDialogDrag>()
            .init_resource::<types::ActiveTextureLayer>()
            // Core menu systems
            .add_systems(Update, toggle_pause_menu)
            .add_systems(Update, handle_menu_buttons)
            .add_systems(Update, multiplayer::poll_connect_task_results)
            .add_systems(Startup, settings_persistence::load_settings_on_startup)
            // Settings systems - split into groups due to parameter limits
            .add_systems(
                Update,
                (
                    settings::handle_settings_tabs,
                    settings::handle_graphics_settings,
                    settings::handle_meshing_settings,
                    settings::handle_gameplay_settings,
                    settings::handle_atmosphere_settings,
                ),
            )
            .add_systems(
                Update,
                (
                    settings::handle_bevy_atmosphere_settings,
                    settings::handle_fog_settings,
                    settings::handle_fog_sliders,
                    settings::handle_close_settings,
                    settings::handle_visual_sliders,
                ),
            )
            // Input systems
            .add_systems(Update, multiplayer::handle_input_interaction)
            .add_systems(Update, multiplayer::process_input_characters)
            .add_systems(Update, (multiplayer::update_input_texts, multiplayer::update_input_backgrounds))
            .add_systems(Update, settings::handle_settings_input_interaction)
            .add_systems(Update, settings::handle_settings_drag)
            .add_systems(Update, settings::update_settings_drag_hover)
            .add_systems(Update, settings::process_settings_input_characters)
            .add_systems(Update, settings::process_rebind_input)
            .add_systems(Update, settings::update_settings_input_backgrounds)
            .add_systems(Update, settings::handle_save_controls_interaction)
            .add_systems(Update, settings::handle_save_settings_interaction)
            .add_systems(Update, settings::clear_settings_input_on_close)
            // Settings UI updates
            .add_systems(
                Update,
                (
                    settings::update_settings_tab_backgrounds,
                    settings::update_settings_content_visibility,
                    settings::update_settings_graphics_backgrounds,
                    settings::update_settings_aa_backgrounds,
                    settings::update_settings_greedy_meshing_backgrounds,
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
                    settings::update_fog_toggle_backgrounds,
                    settings::update_cycle_backgrounds,
                    multiplayer::handle_favorite_buttons,
                    settings::update_visual_slider_display,
                    settings::update_fog_slider_display,
                    settings::update_atmosphere_time_display,
                    settings::handle_settings_rebind_interaction,
                    settings::update_controls_tab_display,
                ),
            )
            // Atlas texture mapping systems
            .add_systems(
                Update,
                (
                    settings::handle_texture_layer_buttons,
                    settings::handle_atlas_tile_clicks,
                    settings::update_texture_layer_backgrounds,
                    settings::update_layer_tile_previews,
                    settings::update_cube_preview_faces,
                    settings::handle_save_atlas_mapping,
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
    mut drag_state: ResMut<SettingsDialogDrag>,
) {
    if !keys.just_pressed(KeyCode::Escape) {
        return;
    }

    if state.open {
        close_menu(&mut commands, &mut state, &mut form_state, &mut settings_state, &mut drag_state);
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
    drag_state: &mut SettingsDialogDrag,
) {
    if let Some(root) = state.root_entity.take() {
        commands.entity(root).despawn();
    }
    settings::close_settings_dialog(commands, settings_state, drag_state);
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
    mut drag_state: ResMut<SettingsDialogDrag>,
    mut form_state: ResMut<MultiplayerFormState>,
    mut connect_tasks: ResMut<ConnectTaskState>,
    mut network: ResMut<NetworkSession>,
    mut chat: ResMut<ChatState>,
    favorites_list: Query<Entity, With<FavoritesList>>,
    asset_server: Res<AssetServer>,
    mut commands: Commands,
    capabilities: Res<GraphicsCapabilities>,
    world_config: Res<WorldConfig>,
    visual_settings: Res<VisualSettings>,
    fog_config: Res<FogConfig>,
    atmosphere: Res<AtmosphereSettings>,
    block_preview_image: Res<BlockPreviewImage>,
    blocky_material_handle: Res<crate::rendering::blocky_material::BlockyMaterialHandle>,
    atlas_mapping: Res<crate::rendering::array_loader::AtlasMapping>,
    mut meshes: ResMut<Assets<Mesh>>,
) {
    for (interaction, action) in interaction_query.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        match action {
            PauseMenuButton::Save => {
                handle_save_button(&world, &settings_state, &visual_settings, &fog_config, &atmosphere);
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
                    &drag_state,
                    &world_config,
                    &block_preview_image,
                    &blocky_material_handle,
                    &atlas_mapping,
                    &mut meshes,
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
                close_menu(&mut commands, &mut state, &mut form_state, &mut settings_state, &mut drag_state);
            }
        }

        if !matches!(action, PauseMenuButton::Resume) {
            state.open = true;
        }
    }
}

fn handle_save_button(
    world: &VoxelWorld,
    settings_state: &SettingsState,
    visual_settings: &VisualSettings,
    fog_config: &FogConfig,
    atmosphere: &AtmosphereSettings,
) {
    match persistence::save_world(world) {
        Ok(()) => info!("World saved via pause menu"),
        Err(err) => warn!("Failed to save world: {}", err),
    }
    match settings_persistence::save_settings_to_disk(
        settings_state,
        visual_settings,
        fog_config,
        atmosphere,
    ) {
        Ok(()) => info!("Settings saved via pause menu"),
        Err(err) => warn!("Failed to save settings: {}", err),
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
    drag_state: &SettingsDialogDrag,
    world_config: &WorldConfig,
    block_preview_image: &Res<BlockPreviewImage>,
    blocky_material: &Res<crate::rendering::blocky_material::BlockyMaterialHandle>,
    atlas_mapping: &Res<crate::rendering::array_loader::AtlasMapping>,
    meshes: &mut ResMut<Assets<Mesh>>,
) {
    if settings_state.dialog_root.is_none() {
        let font = asset_server.load("fonts/FiraSans-Bold.ttf");
        settings_state.active_tab = SettingsTab::Graphics;
        settings_state.greedy_meshing = world_config.greedy_meshing;
        
        let dialog = settings::spawn_settings_dialog(
            commands,
            state.root_entity,
            &font,
            settings_state.clone(),
            capabilities.ray_tracing_supported,
            drag_state.position,
            asset_server,
            block_preview_image,
        );
        settings_state.dialog_root = Some(dialog);
        
        // Spawn the 3D preview scene separately (it's not part of the UI node tree directly)
        // But we want it to be managed by the dialog lifecycle?
        // Actually, let's pass the resources to spawn_settings_dialog and let it decide or call spawn_preview_scene there.
        // Wait, spawn_settings_dialog needs to call spawn_preview_scene.
        // Let's modify spawn_settings_dialog to take these args.
        
        preview_3d::spawn_preview_scene(
            commands,
            block_preview_image,
            meshes,
            blocky_material,
            atlas_mapping,
        );
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
