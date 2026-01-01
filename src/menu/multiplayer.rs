//! Multiplayer connection systems and UI.
//!
//! This module handles the multiplayer menu including:
//! - Server hosting
//! - Client connection
//! - Favorite servers management
//! - Input field handling

use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::prelude::*;
use std::net::ToSocketAddrs;
use std::sync::mpsc::{self, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::chat::ChatState;
use crate::network::NetworkSession;

use super::types::*;
use super::ui::{spawn_button, SECTION_BG, INPUT_ACTIVE_BG, INPUT_INACTIVE_BG};

// ============================================================================
// Multiplayer Menu Spawning
// ============================================================================

/// Spawns the multiplayer menu UI.
pub fn spawn_multiplayer_menu(
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
            BackgroundColor(super::ui::MENU_PANEL_BG),
        ))
        .with_children(|menu| {
            super::ui::spawn_menu_title(menu, font, "Multiplayer");
            spawn_host_section(menu, font);
            spawn_join_section(menu, font, form_state);
            spawn_button(menu, font, "Back", PauseMenuButton::BackToMain);
        });
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
            super::ui::spawn_section_title(section, font, "Host Game");
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
            super::ui::spawn_section_title(section, font, "Join Game");
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

/// Spawns a favorite server button.
pub fn spawn_favorite_button(
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
// Connection Handling
// ============================================================================

/// Handles starting a server.
pub fn handle_start_server(
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

/// Handles initiating a connection to a server.
pub fn handle_connect_button(
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

/// Polls for connection task results.
pub fn poll_connect_task_results(
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

/// Handles saving a favorite server.
pub fn handle_save_favorite(
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

// ============================================================================
// Input Field Handling
// ============================================================================

/// Handles clicking on input fields.
pub fn handle_input_interaction(
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

/// Processes keyboard input for the active input field.
pub fn process_input_characters(
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
                    if let Some(ch) = c.chars().next() {
                        if ch.is_ascii_alphanumeric() || ch == '.' || ch == ':' || ch == '-' || ch == '_' {
                            field_value.push(ch);
                        }
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

/// Updates input text displays.
pub fn update_input_texts(
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

/// Updates input field backgrounds based on active state.
pub fn update_input_backgrounds(
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

/// Handles clicking on favorite server buttons.
pub fn handle_favorite_buttons(
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
