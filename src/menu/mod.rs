//! Menu system for pause menu, settings, and multiplayer

mod types;

// Re-export public types
pub use types::{
    AntiAliasing, DayLengthOption, DisplayMode, ExposureOption, FavoriteServer,
    FloatHeightPreset, FogPresetOption, GraphicsQuality, JumpHeightPreset, MenuScreen,
    MieDirectionOption, MieOption, MultiplayerField, MultiplayerFormState,
    NightBrightnessOption, PauseMenuState, RayleighOption, RunSpeedPreset, SettingsState,
    SettingsTab, ShadowFiltering, TimeScaleOption, TwilightBandOption, WalkSpeedPreset,
};

// Internal type imports
use types::{
    AntiAliasingOption, AtmosphereTabContent, CloseSettingsButton, ConnectOutcome,
    ConnectTaskState, DayNightCycleOption, DisplayModeOption, FavoriteButton, FavoritesList,
    GameplayTabContent, GraphicsQualityOption, GraphicsTabContent, InputField, InputText,
    PauseMenuButton, PauseMenuRoot, PlayerFloatHeightOption, PlayerJumpHeightOption,
    PlayerRunSpeedOption, PlayerWalkSpeedOption, RayTracingOption, ResolutionOption,
    SettingsDialogRoot, SettingsTabButton, ShadowFilteringOption,
};

use crate::atmosphere::FogConfig;
use crate::chat::ChatState;
use crate::environment::AtmosphereSettings;
use crate::network::NetworkSession;
use crate::player::PlayerConfig;
use crate::rendering::{capabilities::GraphicsCapabilities, ray_tracing::RayTracingSettings};
use crate::voxel::{meshing::ChunkMesh, persistence, world::VoxelWorld};
use bevy::{
    input::keyboard::{Key, KeyboardInput},
    prelude::*,
    window::{MonitorSelection, PrimaryWindow, VideoModeSelection, WindowMode, WindowResolution},
};
use bevy::ui::{AlignItems, AlignSelf, FlexDirection, JustifyContent, UiRect, Val};

use std::net::ToSocketAddrs;
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

// ============================================================================
// Constants
// ============================================================================

const ACTIVE_BG: Color = Color::srgba(0.32, 0.42, 0.35, 0.95);
const INACTIVE_BG: Color = Color::srgba(0.2, 0.2, 0.2, 0.9);
const INPUT_ACTIVE_BG: Color = Color::srgba(0.3, 0.35, 0.45, 0.95);
const INPUT_INACTIVE_BG: Color = Color::srgba(0.2, 0.2, 0.2, 0.95);
const MENU_OVERLAY_BG: Color = Color::srgba(0.0, 0.0, 0.0, 0.5);
const MENU_PANEL_BG: Color = Color::srgba(0.1, 0.1, 0.1, 0.9);
const BUTTON_BG: Color = Color::srgba(0.25, 0.25, 0.25, 0.9);
const SECTION_BG: Color = Color::srgba(0.15, 0.15, 0.15, 0.8);

// ============================================================================
// Plugin
// ============================================================================

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
            .add_systems(Update, poll_connect_task_results)
            // Settings systems
            .add_systems(
                Update,
                (
                    handle_settings_tabs,
                    handle_graphics_settings,
                    handle_gameplay_settings,
                    handle_atmosphere_settings,
                    handle_close_settings,
                ),
            )
            // Input systems
            .add_systems(Update, handle_input_interaction)
            .add_systems(Update, process_input_characters)
            .add_systems(Update, (update_input_texts, update_input_backgrounds))
            // Settings UI updates
            .add_systems(
                Update,
                (
                    update_settings_tab_backgrounds,
                    update_settings_content_visibility,
                    update_settings_graphics_backgrounds,
                    update_settings_aa_backgrounds,
                    update_settings_walk_speed_backgrounds,
                    update_settings_run_speed_backgrounds,
                ),
            )
            .add_systems(
                Update,
                (
                    update_settings_ray_tracing_backgrounds,
                    update_settings_display_mode_backgrounds,
                    update_settings_resolution_backgrounds,
                    update_settings_shadow_filtering_backgrounds,
                    update_day_length_backgrounds,
                    update_settings_jump_height_backgrounds,
                    update_settings_float_height_backgrounds,
                ),
            )
            .add_systems(
                Update,
                (
                    update_time_scale_backgrounds,
                    update_rayleigh_backgrounds,
                    update_mie_backgrounds,
                    update_mie_direction_backgrounds,
                ),
            )
            .add_systems(
                Update,
                (
                    update_exposure_backgrounds,
                    update_twilight_backgrounds,
                    update_night_backgrounds,
                    update_fog_backgrounds,
                    update_cycle_backgrounds,
                    handle_favorite_buttons,
                ),
            );
    }
}

// ============================================================================
// Core Menu Systems
// ============================================================================

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
            BackgroundColor(MENU_OVERLAY_BG),
            PauseMenuRoot,
        ))
        .with_children(|parent| match state.current_screen {
            MenuScreen::Main => spawn_main_menu(parent, &font),
            MenuScreen::Multiplayer => spawn_multiplayer_menu(parent, &font, form_state),
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
    close_settings_dialog(commands, settings_state);
    form_state.active_field = None;
    state.open = false;
    state.current_screen = MenuScreen::Main;
}

// ============================================================================
// Menu Button Handling
// ============================================================================

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
                handle_start_server(&form_state, &mut network, &mut chat);
            }
            PauseMenuButton::Connect => {
                handle_connect_button(
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
                handle_save_favorite(
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

fn handle_start_server(
    form_state: &MultiplayerFormState,
    network: &mut NetworkSession,
    chat: &mut ChatState,
) {
    info!("Starting server with password '{}'", form_state.host_password);
    network.server_running = true;
    network.host_password = form_state.host_password.clone();
    network.reset_client();
    chat.push_system("Server started");
}

fn handle_connect_button(
    form_state: &MultiplayerFormState,
    connect_tasks: &mut ConnectTaskState,
    network: &NetworkSession,
    chat: &mut ChatState,
) {
    if connect_tasks.receiver.is_some() {
        warn!("Connection attempt already in progress");
        chat.push_system("Connection already in progress");
        return;
    }

    if form_state.join_ip.is_empty() || form_state.join_port.is_empty() {
        warn!("Cannot connect: IP or port missing");
        chat.push_system("Cannot connect: IP or port missing");
        return;
    }

    if network.server_running
        && !network.host_password.is_empty()
        && form_state.join_password != network.host_password
    {
        warn!("Cannot connect: password mismatch");
        chat.push_system("Connection rejected: incorrect password");
        return;
    }

    let port = match form_state.join_port.parse::<u16>() {
        Ok(port) => port,
        Err(err) => {
            warn!("Cannot connect: invalid port - {}", err);
            chat.push_system("Cannot connect: invalid port");
            return;
        }
    };

    let address = format!("{}:{}", form_state.join_ip, port);
    let join_ip = form_state.join_ip.clone();
    let join_port = form_state.join_port.clone();
    let (tx, rx) = mpsc::channel();

    connect_tasks.receiver = Some(Arc::new(Mutex::new(rx)));
    chat.push_system(format!("Connecting to {}...", address));

    thread::spawn(move || {
        let result = attempt_connection(&address, join_ip, join_port);
        let _ = tx.send(result);
    });
}

fn attempt_connection(address: &str, join_ip: String, join_port: String) -> ConnectOutcome {
    let socket_result = address.to_socket_addrs();
    let mut socket_addrs = match socket_result {
        Ok(addrs) => addrs,
        Err(err) => {
            return ConnectOutcome::Failure {
                message: format!("Cannot connect: invalid address - {}", err),
            }
        }
    };

    let Some(target_addr) = socket_addrs.next() else {
        return ConnectOutcome::Failure {
            message: format!("Cannot connect: no resolved addresses for {}", address),
        };
    };

    let start = Instant::now();
    if let Err(err) =
        std::net::TcpStream::connect_timeout(&target_addr, Duration::from_secs(3))
    {
        return ConnectOutcome::Failure {
            message: format!("Cannot connect: ping/health check failed - {}", err),
        };
    }

    let latency_ms = start.elapsed().as_millis();
    ConnectOutcome::Success {
        ip: join_ip,
        port: join_port,
        address: address.to_string(),
        latency_ms,
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
        settings_state.dialog_root = Some(spawn_settings_dialog(
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
    let root = spawn_menu_root(commands, &font, |parent| {
        spawn_multiplayer_menu(parent, &font, form_state);
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
    let root = spawn_menu_root(commands, &font, |parent| {
        spawn_main_menu(parent, &font);
    });
    state.root_entity = Some(root);
}

fn handle_save_favorite(
    commands: &mut Commands,
    asset_server: &AssetServer,
    form_state: &mut MultiplayerFormState,
    favorites_list: &Query<Entity, With<FavoritesList>>,
) {
    if form_state.join_ip.is_empty() || form_state.join_port.is_empty() {
        warn!("Cannot save favorite: IP or port missing");
        return;
    }

    let duplicate = form_state
        .favorites
        .iter()
        .any(|fav| fav.ip == form_state.join_ip && fav.port == form_state.join_port);
    if duplicate {
        warn!("Favorite already exists for this address");
        return;
    }

    let new_favorite = FavoriteServer {
        ip: form_state.join_ip.clone(),
        port: form_state.join_port.clone(),
        password: form_state.join_password.clone(),
    };
    let index = form_state.favorites.len();
    form_state.favorites.push(new_favorite.clone());

    if let Ok(container) = favorites_list.single() {
        let font = asset_server.load("fonts/FiraSans-Bold.ttf");
        commands.entity(container).with_children(|parent| {
            spawn_favorite_button(parent, &font, index, &new_favorite);
        });
    }

    info!("Saved favorite server {}:{}", new_favorite.ip, new_favorite.port);
}

fn poll_connect_task_results(
    mut connect_tasks: ResMut<ConnectTaskState>,
    mut network: ResMut<NetworkSession>,
    mut chat: ResMut<ChatState>,
) {
    let Some(receiver) = connect_tasks.receiver.as_ref() else {
        return;
    };

    let result = receiver
        .lock()
        .map(|receiver| receiver.try_recv())
        .unwrap_or_else(|err| {
            warn!("Failed to check connection result: {}", err);
            Err(TryRecvError::Disconnected)
        });

    match result {
        Ok(ConnectOutcome::Success {
            ip,
            port,
            address,
            latency_ms,
        }) => {
            network.client_connected = true;
            network.connection_ip = Some(ip);
            network.connection_port = Some(port);
            network.last_latency_ms = Some(latency_ms);
            network.last_health_ok = true;

            info!("Connected to {} (latency: {} ms)", address, latency_ms);
            let username = chat.username.clone();
            chat.push_message(crate::chat::ChatMessage {
                user: username,
                content: format!("Connected to {} ({} ms latency)", address, latency_ms),
            });
            connect_tasks.receiver = None;
        }
        Ok(ConnectOutcome::Failure { message }) => {
            warn!("{}", message);
            chat.push_system(message);
            network.reset_client();
            connect_tasks.receiver = None;
        }
        Err(TryRecvError::Disconnected) => {
            warn!("Connection attempt ended unexpectedly");
            chat.push_system("Connection failed: internal error");
            network.reset_client();
            connect_tasks.receiver = None;
        }
        Err(TryRecvError::Empty) => {
            // Still waiting
        }
    }
}

// ============================================================================
// Menu UI Spawning
// ============================================================================

fn spawn_menu_root<F>(commands: &mut Commands, _font: &Handle<Font>, children: F) -> Entity
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

fn spawn_main_menu(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
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

fn spawn_multiplayer_menu(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    form_state: &MultiplayerFormState,
) {
    parent
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                align_items: AlignItems::Stretch,
                row_gap: Val::Px(16.0),
                padding: UiRect::all(Val::Px(30.0)),
                max_width: Val::Px(500.0),
                ..default()
            },
            BackgroundColor(MENU_PANEL_BG),
        ))
        .with_children(|menu| {
            spawn_menu_title(menu, font, "Multiplayer");
            spawn_host_section(menu, font);
            spawn_join_section(menu, font, form_state);
            spawn_button(menu, font, "Back", PauseMenuButton::BackToMain);
        });
}

fn spawn_menu_title(parent: &mut ChildSpawnerCommands, font: &Handle<Font>, text: &str) {
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

fn spawn_section_title(parent: &mut ChildSpawnerCommands, font: &Handle<Font>, text: &str) {
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

fn spawn_host_section(parent: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    parent
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(16.0)),
                ..default()
            },
            BackgroundColor(SECTION_BG),
        ))
        .with_children(|section| {
            spawn_section_title(section, font, "Host Game");
            spawn_labeled_input(
                section,
                font,
                "Session Password",
                "Required for clients",
                MultiplayerField::HostPassword,
            );
            spawn_button(section, font, "Start Server", PauseMenuButton::StartServer);
        });
}

fn spawn_join_section(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    form_state: &MultiplayerFormState,
) {
    parent
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(16.0)),
                ..default()
            },
            BackgroundColor(SECTION_BG),
        ))
        .with_children(|section| {
            spawn_section_title(section, font, "Join Game");
            spawn_labeled_input(section, font, "Host IP", "Enter IPv4 or IPv6", MultiplayerField::JoinIp);
            spawn_labeled_input(section, font, "Port", "e.g. 7777", MultiplayerField::JoinPort);
            spawn_labeled_input(section, font, "Password", "Session password", MultiplayerField::JoinPassword);

            section
                .spawn(Node {
                    flex_direction: FlexDirection::Row,
                    column_gap: Val::Px(10.0),
                    ..default()
                })
                .with_children(|row| {
                    spawn_button(row, font, "Connect", PauseMenuButton::Connect);
                    spawn_button(row, font, "Save Favorite", PauseMenuButton::SaveFavorite);
                });

            spawn_favorites_list(section, font, form_state);
        });
}

fn spawn_favorites_list(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    form_state: &MultiplayerFormState,
) {
    parent
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(6.0),
                padding: UiRect::all(Val::Px(8.0)),
                ..default()
            },
            BackgroundColor(Color::srgba(0.05, 0.05, 0.05, 0.8)),
            FavoritesList,
        ))
        .with_children(|favorites| {
            favorites.spawn((
                Text::new("Favorite Servers"),
                TextFont {
                    font: font.clone(),
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));

            for (index, favorite) in form_state.favorites.iter().enumerate() {
                spawn_favorite_button(favorites, font, index, favorite);
            }
        });
}

fn spawn_labeled_input(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    placeholder: &str,
    field: MultiplayerField,
) {
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(4.0),
            ..default()
        })
        .with_children(|column| {
            column.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));

            column
                .spawn((
                    Button,
                    Node {
                        width: Val::Px(320.0),
                        padding: UiRect::all(Val::Px(10.0)),
                        justify_content: JustifyContent::FlexStart,
                        align_items: AlignItems::Center,
                        ..default()
                    },
                    BackgroundColor(INPUT_INACTIVE_BG),
                    InputField { field },
                ))
                .with_children(|input| {
                    input.spawn((
                        Text::new(placeholder),
                        TextFont {
                            font: font.clone(),
                            font_size: 16.0,
                            ..default()
                        },
                        TextColor(Color::srgba(0.8, 0.8, 0.8, 0.9)),
                        InputText { field },
                    ));
                });
        });
}

fn spawn_button(
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

fn spawn_favorite_button(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    index: usize,
    favorite: &FavoriteServer,
) {
    let label = format!("{}:{}", favorite.ip, favorite.port);
    parent
        .spawn((
            Button,
            Node {
                width: Val::Percent(100.0),
                padding: UiRect::all(Val::Px(8.0)),
                justify_content: JustifyContent::FlexStart,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(Color::srgba(0.18, 0.18, 0.18, 0.9)),
            FavoriteButton(index),
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

// ============================================================================
// Settings Dialog
// ============================================================================

fn spawn_settings_dialog(
    commands: &mut Commands,
    root_entity: Option<Entity>,
    font: &Handle<Font>,
    settings_state: SettingsState,
    ray_tracing_supported: bool,
) -> Entity {
    let mut dialog_entity = commands.spawn((
        Node {
            width: Val::Percent(70.0),
            height: Val::Percent(70.0),
            padding: UiRect::all(Val::Px(20.0)),
            flex_direction: FlexDirection::Column,
            row_gap: Val::Px(12.0),
            align_self: AlignSelf::Center,
            justify_content: JustifyContent::FlexStart,
            ..default()
        },
        BackgroundColor(Color::srgba(0.08, 0.08, 0.08, 0.95)),
        SettingsDialogRoot,
    ));

    dialog_entity.with_children(|dialog| {
        spawn_settings_header(dialog, font);
        spawn_settings_tabs(dialog, font);
        spawn_settings_content(dialog, font, &settings_state, ray_tracing_supported);
        spawn_settings_close_button(dialog, font);
    });

    let dialog_id = dialog_entity.id();
    if let Some(root) = root_entity {
        commands.entity(root).add_child(dialog_id);
    }

    dialog_id
}

fn spawn_settings_header(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog.spawn((
        Text::new("Settings"),
        TextFont {
            font: font.clone(),
            font_size: 28.0,
            ..default()
        },
        TextColor(Color::WHITE),
    ));
}

fn spawn_settings_tabs(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            column_gap: Val::Px(10.0),
            ..default()
        })
        .with_children(|tabs| {
            spawn_settings_tab_button(tabs, font, "Graphics", SettingsTabButton::Graphics);
            spawn_settings_tab_button(tabs, font, "Gameplay", SettingsTabButton::Gameplay);
            spawn_settings_tab_button(tabs, font, "Atmosphere", SettingsTabButton::Atmosphere);
        });
}

fn spawn_settings_content(
    dialog: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    settings_state: &SettingsState,
    ray_tracing_supported: bool,
) {
    // Graphics tab content
    spawn_graphics_tab(dialog, font, settings_state, ray_tracing_supported);
    // Gameplay tab content
    spawn_gameplay_tab(dialog, font);
    // Atmosphere tab content
    spawn_atmosphere_tab(dialog, font);
}

fn spawn_settings_close_button(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Button,
            Node {
                width: Val::Px(120.0),
                padding: UiRect::all(Val::Px(10.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(BUTTON_BG),
            CloseSettingsButton,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new("Close"),
                TextFont {
                    font: font.clone(),
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

fn spawn_settings_tab_button(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    tab: SettingsTabButton,
) {
    parent
        .spawn((
            Button,
            Node {
                padding: UiRect::axes(Val::Px(14.0), Val::Px(10.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(Color::srgba(0.18, 0.18, 0.18, 0.9)),
            tab,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 18.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

fn spawn_graphics_option<T: Component + Copy + Send + Sync + 'static>(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    tag: T,
) {
    parent
        .spawn((
            Button,
            Node {
                padding: UiRect::axes(Val::Px(12.0), Val::Px(8.0)),
                justify_content: JustifyContent::Center,
                align_items: AlignItems::Center,
                ..default()
            },
            BackgroundColor(INACTIVE_BG),
            tag,
        ))
        .with_children(|button| {
            button.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::WHITE),
            ));
        });
}

fn spawn_option_row<F>(
    parent: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    label: &str,
    spawn_options: F,
) where
    F: FnOnce(&mut ChildSpawnerCommands, &Handle<Font>),
{
    parent
        .spawn(Node {
            flex_direction: FlexDirection::Row,
            align_items: AlignItems::Center,
            column_gap: Val::Px(12.0),
            ..default()
        })
        .with_children(|row| {
            row.spawn((
                Text::new(label),
                TextFont {
                    font: font.clone(),
                    font_size: 16.0,
                    ..default()
                },
                TextColor(Color::WHITE),
                Node {
                    width: Val::Px(140.0),
                    ..default()
                },
            ));
            row.spawn(Node {
                flex_direction: FlexDirection::Row,
                column_gap: Val::Px(8.0),
                ..default()
            })
            .with_children(|options| {
                spawn_options(options, font);
            });
        });
}

fn spawn_graphics_tab(
    dialog: &mut ChildSpawnerCommands,
    font: &Handle<Font>,
    _settings_state: &SettingsState,
    ray_tracing_supported: bool,
) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::Flex,
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            GraphicsTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Quality", |options, font| {
                spawn_graphics_option(options, font, "Low", GraphicsQualityOption(GraphicsQuality::Low));
                spawn_graphics_option(options, font, "Medium", GraphicsQualityOption(GraphicsQuality::Medium));
                spawn_graphics_option(options, font, "High", GraphicsQualityOption(GraphicsQuality::High));
            });

            spawn_option_row(content, font, "Anti-Aliasing", |options, font| {
                spawn_graphics_option(options, font, "None", AntiAliasingOption(AntiAliasing::None));
                spawn_graphics_option(options, font, "FXAA", AntiAliasingOption(AntiAliasing::Fxaa));
                spawn_graphics_option(options, font, "MSAA 4x", AntiAliasingOption(AntiAliasing::Msaa4x));
            });

            if ray_tracing_supported {
                spawn_option_row(content, font, "Ray Tracing", |options, font| {
                    spawn_graphics_option(options, font, "Off", RayTracingOption(false));
                    spawn_graphics_option(options, font, "On", RayTracingOption(true));
                });
            }

            spawn_option_row(content, font, "Shadow Filter", |options, font| {
                spawn_graphics_option(options, font, "Gaussian", ShadowFilteringOption(ShadowFiltering::Gaussian));
                spawn_graphics_option(options, font, "Hardware", ShadowFilteringOption(ShadowFiltering::Hardware2x2));
                spawn_graphics_option(options, font, "Temporal", ShadowFilteringOption(ShadowFiltering::Temporal));
            });

            spawn_option_row(content, font, "Display Mode", |options, font| {
                spawn_graphics_option(options, font, "Bordered", DisplayModeOption::Bordered);
                spawn_graphics_option(options, font, "Borderless", DisplayModeOption::Borderless);
                spawn_graphics_option(options, font, "Fullscreen", DisplayModeOption::Fullscreen);
            });

            spawn_option_row(content, font, "Resolution", |options, font| {
                spawn_graphics_option(options, font, "1280x720", ResolutionOption(UVec2::new(1280, 720)));
                spawn_graphics_option(options, font, "1920x1080", ResolutionOption(UVec2::new(1920, 1080)));
                spawn_graphics_option(options, font, "2560x1440", ResolutionOption(UVec2::new(2560, 1440)));
            });
        });
}

fn spawn_gameplay_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            GameplayTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Walk Speed", |options, font| {
                spawn_graphics_option(options, font, "Slow", PlayerWalkSpeedOption(WalkSpeedPreset::Slow));
                spawn_graphics_option(options, font, "Standard", PlayerWalkSpeedOption(WalkSpeedPreset::Standard));
                spawn_graphics_option(options, font, "Fast", PlayerWalkSpeedOption(WalkSpeedPreset::Fast));
            });

            spawn_option_row(content, font, "Run Speed", |options, font| {
                spawn_graphics_option(options, font, "Slow", PlayerRunSpeedOption(RunSpeedPreset::Slow));
                spawn_graphics_option(options, font, "Standard", PlayerRunSpeedOption(RunSpeedPreset::Standard));
                spawn_graphics_option(options, font, "Fast", PlayerRunSpeedOption(RunSpeedPreset::Fast));
            });

            spawn_option_row(content, font, "Jump Height", |options, font| {
                spawn_graphics_option(options, font, "Low", PlayerJumpHeightOption(JumpHeightPreset::Low));
                spawn_graphics_option(options, font, "Standard", PlayerJumpHeightOption(JumpHeightPreset::Standard));
                spawn_graphics_option(options, font, "High", PlayerJumpHeightOption(JumpHeightPreset::High));
            });

            spawn_option_row(content, font, "Float Height", |options, font| {
                spawn_graphics_option(options, font, "Low", PlayerFloatHeightOption(FloatHeightPreset::Low));
                spawn_graphics_option(options, font, "Standard", PlayerFloatHeightOption(FloatHeightPreset::Standard));
                spawn_graphics_option(options, font, "High", PlayerFloatHeightOption(FloatHeightPreset::High));
            });
        });
}

fn spawn_atmosphere_tab(dialog: &mut ChildSpawnerCommands, font: &Handle<Font>) {
    dialog
        .spawn((
            Node {
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(10.0),
                padding: UiRect::all(Val::Px(10.0)),
                display: Display::None,
                ..default()
            },
            BackgroundColor(Color::srgba(0.12, 0.12, 0.12, 0.9)),
            AtmosphereTabContent,
        ))
        .with_children(|content| {
            spawn_option_row(content, font, "Day/Night", |options, font| {
                spawn_graphics_option(options, font, "Off", DayNightCycleOption(false));
                spawn_graphics_option(options, font, "On", DayNightCycleOption(true));
            });

            spawn_option_row(content, font, "Day Length", |options, font| {
                spawn_graphics_option(options, font, "Short", DayLengthOption::Short);
                spawn_graphics_option(options, font, "Standard", DayLengthOption::Standard);
                spawn_graphics_option(options, font, "Long", DayLengthOption::Long);
            });

            spawn_option_row(content, font, "Time Scale", |options, font| {
                spawn_graphics_option(options, font, "Slow", TimeScaleOption::Slow);
                spawn_graphics_option(options, font, "Real", TimeScaleOption::RealTime);
                spawn_graphics_option(options, font, "Fast", TimeScaleOption::Fast);
            });

            spawn_option_row(content, font, "Rayleigh", |options, font| {
                spawn_graphics_option(options, font, "Gentle", RayleighOption::Gentle);
                spawn_graphics_option(options, font, "Balanced", RayleighOption::Balanced);
                spawn_graphics_option(options, font, "Vivid", RayleighOption::Vivid);
            });

            spawn_option_row(content, font, "Mie", |options, font| {
                spawn_graphics_option(options, font, "Soft", MieOption::Soft);
                spawn_graphics_option(options, font, "Standard", MieOption::Standard);
                spawn_graphics_option(options, font, "Dense", MieOption::Dense);
            });

            spawn_option_row(content, font, "Mie Direction", |options, font| {
                spawn_graphics_option(options, font, "Broad", MieDirectionOption::Broad);
                spawn_graphics_option(options, font, "Standard", MieDirectionOption::Standard);
                spawn_graphics_option(options, font, "Forward", MieDirectionOption::Forward);
            });

            spawn_option_row(content, font, "Exposure", |options, font| {
                spawn_graphics_option(options, font, "Low", ExposureOption::Low);
                spawn_graphics_option(options, font, "Neutral", ExposureOption::Neutral);
                spawn_graphics_option(options, font, "High", ExposureOption::High);
            });

            spawn_option_row(content, font, "Twilight Band", |options, font| {
                spawn_graphics_option(options, font, "Narrow", TwilightBandOption::Narrow);
                spawn_graphics_option(options, font, "Medium", TwilightBandOption::Medium);
                spawn_graphics_option(options, font, "Wide", TwilightBandOption::Wide);
            });

            spawn_option_row(content, font, "Night", |options, font| {
                spawn_graphics_option(options, font, "Dim", NightBrightnessOption::Dim);
                spawn_graphics_option(options, font, "Balanced", NightBrightnessOption::Balanced);
                spawn_graphics_option(options, font, "Bright", NightBrightnessOption::Bright);
            });

            spawn_option_row(content, font, "Fog", |options, font| {
                spawn_graphics_option(options, font, "Clear", FogPresetOption::Clear);
                spawn_graphics_option(options, font, "Balanced", FogPresetOption::Balanced);
                spawn_graphics_option(options, font, "Misty", FogPresetOption::Misty);
            });
        });
}

fn close_settings_dialog(commands: &mut Commands, settings_state: &mut SettingsState) {
    if let Some(dialog) = settings_state.dialog_root.take() {
        commands.entity(dialog).despawn();
    }
}

// ============================================================================
// Settings Tab Handling
// ============================================================================

fn handle_settings_tabs(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    mut tab_query: Query<(&Interaction, &SettingsTabButton), (Changed<Interaction>, With<Button>)>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, tab) in tab_query.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        settings_state.active_tab = match tab {
            SettingsTabButton::Graphics => SettingsTab::Graphics,
            SettingsTabButton::Gameplay => SettingsTab::Gameplay,
            SettingsTabButton::Atmosphere => SettingsTab::Atmosphere,
        };
    }
}

fn handle_graphics_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    quality_query: Query<(&Interaction, &GraphicsQualityOption), (Changed<Interaction>, With<Button>)>,
    aa_query: Query<(&Interaction, &AntiAliasingOption), (Changed<Interaction>, With<Button>)>,
    rt_query: Query<(&Interaction, &RayTracingOption), (Changed<Interaction>, With<Button>)>,
    display_query: Query<(&Interaction, &DisplayModeOption), (Changed<Interaction>, With<Button>)>,
    resolution_query: Query<(&Interaction, &ResolutionOption), (Changed<Interaction>, With<Button>)>,
    shadow_query: Query<(&Interaction, &ShadowFilteringOption), (Changed<Interaction>, With<Button>)>,
    mut rt_settings: ResMut<RayTracingSettings>,
    mut window_query: Query<&mut Window, With<PrimaryWindow>>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in quality_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.graphics_quality = option.0;
        }
    }

    for (interaction, option) in aa_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.anti_aliasing = option.0;
        }
    }

    for (interaction, option) in rt_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.ray_tracing = option.0;
            rt_settings.enabled = option.0;
        }
    }

    for (interaction, option) in display_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.display_mode = match option {
                DisplayModeOption::Bordered => DisplayMode::Bordered,
                DisplayModeOption::Borderless => DisplayMode::Borderless,
                DisplayModeOption::Fullscreen => DisplayMode::Fullscreen,
            };
            apply_window_settings(&settings_state, &mut window_query);
        }
    }

    for (interaction, option) in resolution_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.resolution = option.0;
            apply_window_settings(&settings_state, &mut window_query);
        }
    }

    for (interaction, option) in shadow_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.shadow_filtering = option.0;
        }
    }
}

fn handle_gameplay_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    walk_query: Query<(&Interaction, &PlayerWalkSpeedOption), (Changed<Interaction>, With<Button>)>,
    run_query: Query<(&Interaction, &PlayerRunSpeedOption), (Changed<Interaction>, With<Button>)>,
    jump_query: Query<(&Interaction, &PlayerJumpHeightOption), (Changed<Interaction>, With<Button>)>,
    float_query: Query<(&Interaction, &PlayerFloatHeightOption), (Changed<Interaction>, With<Button>)>,
    mut player_config: ResMut<PlayerConfig>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in walk_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.walk_speed = option.0;
            player_config.walk_speed = option.0.value();
        }
    }

    for (interaction, option) in run_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.run_speed = option.0;
            player_config.run_speed = option.0.value();
        }
    }

    for (interaction, option) in jump_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.jump_height = option.0;
            player_config.jump_height = option.0.value();
        }
    }

    for (interaction, option) in float_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.float_height = option.0;
            player_config.float_height = option.0.value();
        }
    }
}

fn handle_atmosphere_settings(
    state: Res<PauseMenuState>,
    mut settings_state: ResMut<SettingsState>,
    cycle_query: Query<(&Interaction, &DayNightCycleOption), (Changed<Interaction>, With<Button>)>,
    day_length_query: Query<(&Interaction, &DayLengthOption), (Changed<Interaction>, With<Button>)>,
    time_scale_query: Query<(&Interaction, &TimeScaleOption), (Changed<Interaction>, With<Button>)>,
    rayleigh_query: Query<(&Interaction, &RayleighOption), (Changed<Interaction>, With<Button>)>,
    mie_query: Query<(&Interaction, &MieOption), (Changed<Interaction>, With<Button>)>,
    mie_dir_query: Query<(&Interaction, &MieDirectionOption), (Changed<Interaction>, With<Button>)>,
    exposure_query: Query<(&Interaction, &ExposureOption), (Changed<Interaction>, With<Button>)>,
    twilight_query: Query<(&Interaction, &TwilightBandOption), (Changed<Interaction>, With<Button>)>,
    night_query: Query<(&Interaction, &NightBrightnessOption), (Changed<Interaction>, With<Button>)>,
    fog_query: Query<(&Interaction, &FogPresetOption), (Changed<Interaction>, With<Button>)>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut fog_config: ResMut<FogConfig>,
) {
    if !state.open || settings_state.dialog_root.is_none() {
        return;
    }

    for (interaction, option) in cycle_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.cycle_enabled = option.0;
            atmosphere.cycle_enabled = option.0;
        }
    }

    for (interaction, option) in day_length_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.day_length = *option;
            atmosphere.day_length = match option {
                DayLengthOption::Short => 600.0,
                DayLengthOption::Standard => 1800.0,
                DayLengthOption::Long => 3600.0,
            };
        }
    }

    for (interaction, option) in time_scale_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.time_scale = *option;
            atmosphere.time_scale = match option {
                TimeScaleOption::Slow => 0.5,
                TimeScaleOption::RealTime => 1.0,
                TimeScaleOption::Fast => 2.0,
            };
        }
    }

    let base_rayleigh = Vec3::new(5.5, 13.0, 22.4) * 0.0012;
    let base_mie = Vec3::splat(0.005);

    for (interaction, option) in rayleigh_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.rayleigh = *option;
            atmosphere.rayleigh = match option {
                RayleighOption::Gentle => base_rayleigh * 0.7,
                RayleighOption::Balanced => base_rayleigh,
                RayleighOption::Vivid => base_rayleigh * 1.4,
            };
        }
    }

    for (interaction, option) in mie_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.mie = *option;
            atmosphere.mie = match option {
                MieOption::Soft => Vec3::splat(0.0035),
                MieOption::Standard => base_mie,
                MieOption::Dense => Vec3::splat(0.0075),
            };
        }
    }

    for (interaction, option) in mie_dir_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.mie_direction = *option;
            atmosphere.mie_direction = match option {
                MieDirectionOption::Broad => 0.5,
                MieDirectionOption::Standard => 0.7,
                MieDirectionOption::Forward => 0.85,
            };
        }
    }

    for (interaction, option) in exposure_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.exposure = *option;
            atmosphere.exposure = match option {
                ExposureOption::Low => 0.9,
                ExposureOption::Neutral => 1.2,
                ExposureOption::High => 1.6,
            };
        }
    }

    for (interaction, option) in twilight_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.twilight_band = *option;
            atmosphere.twilight_band = match option {
                TwilightBandOption::Narrow => 0.35,
                TwilightBandOption::Medium => 0.6,
                TwilightBandOption::Wide => 0.9,
            };
        }
    }

    for (interaction, option) in night_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.night_brightness = *option;
            atmosphere.night_floor = match option {
                NightBrightnessOption::Dim => 0.04,
                NightBrightnessOption::Balanced => 0.08,
                NightBrightnessOption::Bright => 0.12,
            };
        }
    }

    for (interaction, option) in fog_query.iter() {
        if *interaction == Interaction::Pressed {
            settings_state.fog_preset = *option;
            atmosphere.fog_density = match option {
                FogPresetOption::Clear => Vec2::new(0.0006, 0.0014),
                FogPresetOption::Balanced => Vec2::new(0.0009, 0.0022),
                FogPresetOption::Misty => Vec2::new(0.0012, 0.003),
            };
            fog_config.volume.density = match option {
                FogPresetOption::Clear => 0.015,
                FogPresetOption::Balanced => 0.04,
                FogPresetOption::Misty => 0.08,
            };
        }
    }
}

fn handle_close_settings(
    mut commands: Commands,
    mut settings_state: ResMut<SettingsState>,
    query: Query<&Interaction, (Changed<Interaction>, With<CloseSettingsButton>)>,
) {
    for interaction in query.iter() {
        if *interaction == Interaction::Pressed {
            close_settings_dialog(&mut commands, &mut settings_state);
        }
    }
}

fn apply_window_settings(
    settings_state: &SettingsState,
    window_query: &mut Query<&mut Window, With<PrimaryWindow>>,
) {
    let Ok(mut window) = window_query.single_mut() else {
        return;
    };

    window.mode = match settings_state.display_mode {
        DisplayMode::Bordered | DisplayMode::Borderless => WindowMode::Windowed,
        DisplayMode::Fullscreen => WindowMode::Fullscreen(MonitorSelection::Primary, VideoModeSelection::Current),
    };
    window.decorations = matches!(settings_state.display_mode, DisplayMode::Bordered);
    window.resolution = WindowResolution::new(
        settings_state.resolution.x,
        settings_state.resolution.y,
    );
}

// ============================================================================
// Settings Background Updates
// ============================================================================

fn update_settings_tab_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&SettingsTabButton, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for (tab, mut background) in query.iter_mut() {
        let active = match tab {
            SettingsTabButton::Graphics => settings_state.active_tab == SettingsTab::Graphics,
            SettingsTabButton::Gameplay => settings_state.active_tab == SettingsTab::Gameplay,
            SettingsTabButton::Atmosphere => settings_state.active_tab == SettingsTab::Atmosphere,
        };
        *background = if active { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_content_visibility(
    settings_state: Res<SettingsState>,
    mut graphics_query: Query<&mut Node, (With<GraphicsTabContent>, Without<GameplayTabContent>, Without<AtmosphereTabContent>)>,
    mut gameplay_query: Query<&mut Node, (With<GameplayTabContent>, Without<GraphicsTabContent>, Without<AtmosphereTabContent>)>,
    mut atmosphere_query: Query<&mut Node, (With<AtmosphereTabContent>, Without<GraphicsTabContent>, Without<GameplayTabContent>)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }

    for mut node in graphics_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Graphics {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in gameplay_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Gameplay {
            Display::Flex
        } else {
            Display::None
        };
    }

    for mut node in atmosphere_query.iter_mut() {
        node.display = if settings_state.active_tab == SettingsTab::Atmosphere {
            Display::Flex
        } else {
            Display::None
        };
    }
}

fn update_settings_graphics_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&GraphicsQualityOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.graphics_quality == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_aa_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&AntiAliasingOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.anti_aliasing == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_walk_speed_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerWalkSpeedOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.walk_speed == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_run_speed_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerRunSpeedOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.run_speed == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_jump_height_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerJumpHeightOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.jump_height == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_float_height_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&PlayerFloatHeightOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.float_height == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_ray_tracing_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&RayTracingOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.ray_tracing == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_display_mode_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&DisplayModeOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        let active = match option {
            DisplayModeOption::Bordered => settings_state.display_mode == DisplayMode::Bordered,
            DisplayModeOption::Borderless => settings_state.display_mode == DisplayMode::Borderless,
            DisplayModeOption::Fullscreen => settings_state.display_mode == DisplayMode::Fullscreen,
        };
        *background = if active { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_shadow_filtering_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&ShadowFilteringOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.shadow_filtering == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_settings_resolution_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&ResolutionOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.resolution == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_cycle_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&DayNightCycleOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.cycle_enabled == option.0 { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_day_length_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&DayLengthOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.day_length == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_time_scale_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&TimeScaleOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.time_scale == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_rayleigh_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&RayleighOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.rayleigh == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_mie_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&MieOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.mie == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_mie_direction_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&MieDirectionOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.mie_direction == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_exposure_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&ExposureOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.exposure == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_twilight_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&TwilightBandOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.twilight_band == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_night_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&NightBrightnessOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.night_brightness == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

fn update_fog_backgrounds(
    settings_state: Res<SettingsState>,
    mut query: Query<(&FogPresetOption, &mut BackgroundColor)>,
) {
    if settings_state.dialog_root.is_none() {
        return;
    }
    for (option, mut background) in query.iter_mut() {
        *background = if settings_state.fog_preset == *option { ACTIVE_BG } else { INACTIVE_BG }.into();
    }
}

// ============================================================================
// Input Field Handling
// ============================================================================

fn handle_input_interaction(
    mut form_state: ResMut<MultiplayerFormState>,
    state: Res<PauseMenuState>,
    query: Query<(&Interaction, &InputField), (Changed<Interaction>, With<Button>)>,
) {
    if !state.open {
        return;
    }

    for (interaction, input) in query.iter() {
        if *interaction == Interaction::Pressed {
            form_state.active_field = Some(input.field);
        }
    }
}

fn process_input_characters(
    mut form_state: ResMut<MultiplayerFormState>,
    state: Res<PauseMenuState>,
    mut keyboard_events: MessageReader<KeyboardInput>,
) {
    if !state.open {
        return;
    }

    let Some(active_field) = form_state.active_field else {
        return;
    };

    for event in keyboard_events.read() {
        if !event.state.is_pressed() {
            continue;
        }

        let field_value = get_field_value_mut(&mut form_state, active_field);

        match &event.logical_key {
            Key::Backspace => {
                field_value.pop();
            }
            Key::Character(c) => {
                if c.len() == 1 {
                    let ch = c.chars().next().unwrap();
                    if ch.is_ascii_alphanumeric() || ch == '.' || ch == ':' || ch == '-' || ch == '_' {
                        field_value.push(ch);
                    }
                }
            }
            _ => {}
        }
    }
}

fn get_field_value_mut<'a>(
    form_state: &'a mut MultiplayerFormState,
    field: MultiplayerField,
) -> &'a mut String {
    match field {
        MultiplayerField::HostPassword => &mut form_state.host_password,
        MultiplayerField::JoinIp => &mut form_state.join_ip,
        MultiplayerField::JoinPort => &mut form_state.join_port,
        MultiplayerField::JoinPassword => &mut form_state.join_password,
    }
}

fn update_input_texts(
    form_state: Res<MultiplayerFormState>,
    state: Res<PauseMenuState>,
    mut query: Query<(&InputText, &mut Text)>,
) {
    if !state.open {
        return;
    }

    for (field, mut text) in query.iter_mut() {
        let value = match field.field {
            MultiplayerField::HostPassword => &form_state.host_password,
            MultiplayerField::JoinIp => &form_state.join_ip,
            MultiplayerField::JoinPort => &form_state.join_port,
            MultiplayerField::JoinPassword => &form_state.join_password,
        };

        let display_value = if value.is_empty() {
            match field.field {
                MultiplayerField::HostPassword => "Required for clients",
                MultiplayerField::JoinIp => "Enter IPv4 or IPv6",
                MultiplayerField::JoinPort => "e.g. 7777",
                MultiplayerField::JoinPassword => "Session password",
            }
        } else {
            value
        };

        text.0 = display_value.to_string();
    }
}

fn update_input_backgrounds(
    form_state: Res<MultiplayerFormState>,
    state: Res<PauseMenuState>,
    mut query: Query<(&InputField, &mut BackgroundColor)>,
) {
    if !state.open {
        return;
    }

    for (field, mut background) in query.iter_mut() {
        let is_active = form_state.active_field == Some(field.field);
        *background = if is_active { INPUT_ACTIVE_BG } else { INPUT_INACTIVE_BG }.into();
    }
}

fn handle_favorite_buttons(
    mut form_state: ResMut<MultiplayerFormState>,
    state: Res<PauseMenuState>,
    mut query: Query<(&Interaction, &FavoriteButton), (Changed<Interaction>, With<Button>)>,
) {
    if !state.open {
        return;
    }

    for (interaction, favorite) in query.iter_mut() {
        if *interaction != Interaction::Pressed {
            continue;
        }

        if let Some(entry) = form_state.favorites.get(favorite.0).cloned() {
            form_state.join_ip = entry.ip;
            form_state.join_port = entry.port;
            form_state.join_password = entry.password;
            form_state.active_field = None;
            info!("Loaded favorite server {}:{}", form_state.join_ip, form_state.join_port);
        }
    }
}
