use crate::audio::events::{AudioEventId, GameAudioEvent};
use avian3d::prelude::LinearVelocity;
use bevy::input::keyboard::{Key, KeyboardInput};
use bevy::prelude::*;

use crate::menu::PauseMenuState;
use crate::network::NetworkSession;
use crate::physics::{ChunkCollider, NeedsCollider};
use crate::player::{
    Player, PlayerSpawnState, SpawnColliderReadiness, find_nearest_valid_spawn,
    run_random_spawn_test,
};
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::world::VoxelWorld;

const MAX_CHAT_MESSAGES: usize = 10;

fn editor_native_viewport_enabled() -> bool {
    std::env::var_os("DRUSNIEL_EDITOR_NATIVE_VIEWPORT").is_some()
}

#[derive(Resource, Debug)]
pub struct ChatState {
    pub active: bool,
    pub buffer: String,
    pub messages: Vec<ChatMessage>,
    pub username: String,
}

impl Default for ChatState {
    fn default() -> Self {
        Self {
            active: false,
            buffer: String::new(),
            messages: Vec::new(),
            username: "Player".to_string(),
        }
    }
}

impl ChatState {
    pub fn push_message(&mut self, message: ChatMessage) {
        self.messages.push(message);
        if self.messages.len() > MAX_CHAT_MESSAGES {
            let overflow = self.messages.len() - MAX_CHAT_MESSAGES;
            self.messages.drain(0..overflow);
        }
    }

    pub fn push_system(&mut self, content: impl Into<String>) {
        self.push_message(ChatMessage::system(content));
    }
}

#[derive(Clone, Debug)]
pub struct ChatMessage {
    pub user: String,
    pub content: String,
}

#[derive(Component)]
struct ChatOverlayRoot;

#[derive(Component)]
struct ChatLogText;

#[derive(Component)]
struct ChatInputText;

pub struct ChatPlugin;

impl Plugin for ChatPlugin {
    fn build(&self, app: &mut App) {
        app.init_resource::<ChatState>();

        if editor_native_viewport_enabled() {
            return;
        }

        app.add_systems(Startup, spawn_chat_overlay).add_systems(
            Update,
            (
                toggle_chat_input,
                process_chat_characters,
                submit_chat_message,
                update_chat_log,
                update_chat_prompt,
            ),
        );
    }
}

fn spawn_chat_overlay(mut commands: Commands, asset_server: Res<AssetServer>) {
    let font = asset_server.load("fonts/FiraSans-Bold.ttf");

    commands
        .spawn((
            Node {
                position_type: PositionType::Absolute,
                bottom: Val::Px(12.0),
                right: Val::Px(12.0),
                flex_direction: FlexDirection::Column,
                row_gap: Val::Px(6.0),
                padding: UiRect::axes(Val::Px(8.0), Val::Px(6.0)),
                min_width: Val::Px(280.0),
                max_width: Val::Px(420.0),
                ..default()
            },
            BackgroundColor(Color::srgba(0.0, 0.0, 0.0, 0.45)),
            ChatOverlayRoot,
        ))
        .with_children(|overlay| {
            overlay.spawn((
                Text::new(""),
                TextFont {
                    font: font.clone(),
                    font_size: 14.0,
                    ..default()
                },
                TextColor(Color::WHITE),
                ChatLogText,
            ));

            overlay.spawn((
                Text::new("Press Ctrl+A to chat"),
                TextFont {
                    font: font.clone(),
                    font_size: 13.0,
                    ..default()
                },
                TextColor(Color::srgba(0.9, 0.9, 0.9, 0.9)),
                ChatInputText,
            ));
        });
}

fn toggle_chat_input(
    keys: Res<ButtonInput<KeyCode>>,
    mut chat_state: ResMut<ChatState>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    if keys.any_pressed([KeyCode::ControlLeft, KeyCode::ControlRight])
        && keys.just_pressed(KeyCode::KeyA)
    {
        chat_state.active = true;
        chat_state.buffer.clear();
        audio_events.write(GameAudioEvent::ui(AudioEventId::ChatOpen));
    }

    if chat_state.active && keys.just_pressed(KeyCode::Escape) {
        chat_state.active = false;
        chat_state.buffer.clear();
        audio_events.write(GameAudioEvent::ui(AudioEventId::ChatClose));
    }
}

fn process_chat_characters(
    mut chat_state: ResMut<ChatState>,
    mut char_evr: MessageReader<KeyboardInput>,
    keys: Res<ButtonInput<KeyCode>>,
    pause_state: Option<Res<PauseMenuState>>,
) {
    if !chat_state.active || pause_state.as_ref().map(|p| p.open).unwrap_or(false) {
        return;
    }

    if keys.just_pressed(KeyCode::Backspace) {
        chat_state.buffer.pop();
    }

    for ev in char_evr.read() {
        if !ev.state.is_pressed() {
            continue;
        }
        if let Key::Character(ch) = &ev.logical_key {
            chat_state.buffer.push_str(ch);
        }
    }
}

fn submit_chat_message(
    keys: Res<ButtonInput<KeyCode>>,
    mut chat_state: ResMut<ChatState>,
    network: Res<NetworkSession>,
    world: Option<Res<VoxelWorld>>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    mut player_query: Query<(&mut Transform, Option<&mut LinearVelocity>), With<Player>>,
    mut spawn_state: Option<ResMut<PlayerSpawnState>>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    if !chat_state.active || !keys.just_pressed(KeyCode::Enter) {
        return;
    }

    if chat_state.buffer.is_empty() {
        chat_state.active = false;
        audio_events.write(GameAudioEvent::ui(AudioEventId::ChatClose));
        return;
    }

    let submitted = chat_state.buffer.trim().to_string();
    if process_debug_command(
        &submitted,
        &mut chat_state,
        world.as_deref(),
        &collider_query,
        &mut player_query,
        spawn_state.as_deref_mut(),
    ) {
        chat_state.buffer.clear();
        chat_state.active = false;
        audio_events.write(GameAudioEvent::ui(AudioEventId::ChatSubmit));
        return;
    }

    if !network.is_connected() {
        chat_state.push_system("Cannot send chat: not connected");
        audio_events.write(GameAudioEvent::ui(AudioEventId::ChatError));
    } else {
        let user = chat_state.username.clone();
        let content = submitted;
        chat_state.push_message(ChatMessage { user, content });
        audio_events.write(GameAudioEvent::ui(AudioEventId::ChatSubmit));
    }

    chat_state.buffer.clear();
    chat_state.active = false;
}

fn update_chat_log(chat_state: Res<ChatState>, mut query: Query<&mut Text, With<ChatLogText>>) {
    if !chat_state.is_changed() {
        return;
    }

    if let Ok(mut text) = query.single_mut() {
        let body = chat_state
            .messages
            .iter()
            .map(|msg| format!("{}: {}", msg.user, msg.content))
            .collect::<Vec<_>>()
            .join("\n");

        text.0 = body;
    }
}

fn update_chat_prompt(
    chat_state: Res<ChatState>,
    mut query: Query<&mut Text, With<ChatInputText>>,
) {
    if !chat_state.is_changed() {
        return;
    }

    if let Ok(mut text) = query.single_mut() {
        if chat_state.active {
            text.0 = format!("{}: {}", chat_state.username, chat_state.buffer);
        } else {
            text.0 = "Press Ctrl+A to chat".to_string();
        }
    }
}

impl ChatMessage {
    fn system(content: impl Into<String>) -> Self {
        Self {
            user: "System".to_string(),
            content: content.into(),
        }
    }
}

fn process_debug_command(
    submitted: &str,
    chat_state: &mut ChatState,
    world: Option<&VoxelWorld>,
    collider_query: &Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    player_query: &mut Query<(&mut Transform, Option<&mut LinearVelocity>), With<Player>>,
    spawn_state: Option<&mut PlayerSpawnState>,
) -> bool {
    let command = submitted.strip_prefix('/').unwrap_or(submitted);
    let mut parts = command.split_whitespace();
    let Some(name) = parts.next() else {
        return false;
    };
    match name {
        "random-spawn-test" => {
            let sample_count = parts
                .next()
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(100);
            let Some(world) = world else {
                chat_state.push_system("random-spawn-test failed: voxel world is unavailable");
                return true;
            };

            let report = run_random_spawn_test(world, sample_count);
            chat_state.push_system(format!(
                "random-spawn-test {}: accepted={} rejected underground={} water={} missing={} no_headroom={} collider={} other={}",
                report.candidates_tested,
                report.accepted,
                report.rejected_underground,
                report.rejected_water,
                report.rejected_missing_chunk,
                report.rejected_no_headroom,
                report.rejected_collider_not_ready,
                report.rejected_other,
            ));
            info!(
                "random-spawn-test {}: accepted={} rejected_underground={} rejected_water={} rejected_missing_chunk={} rejected_no_headroom={} rejected_collider={} rejected_other={}",
                report.candidates_tested,
                report.accepted,
                report.rejected_underground,
                report.rejected_water,
                report.rejected_missing_chunk,
                report.rejected_no_headroom,
                report.rejected_collider_not_ready,
                report.rejected_other,
            );
            true
        }
        "teleport-to-valid-surface" => {
            teleport_player_to_valid_surface(
                chat_state,
                world,
                collider_query,
                player_query,
                spawn_state,
                TeleportSurfaceMode::Nearest,
            );
            true
        }
        "teleport-random-valid-surface" => {
            teleport_player_to_valid_surface(
                chat_state,
                world,
                collider_query,
                player_query,
                spawn_state,
                TeleportSurfaceMode::Random,
            );
            true
        }
        "teleport-world-center-surface" => {
            teleport_player_to_valid_surface(
                chat_state,
                world,
                collider_query,
                player_query,
                spawn_state,
                TeleportSurfaceMode::WorldCenter,
            );
            true
        }
        _ => false,
    }
}

#[derive(Clone, Copy)]
enum TeleportSurfaceMode {
    Nearest,
    Random,
    WorldCenter,
}

fn teleport_player_to_valid_surface(
    chat_state: &mut ChatState,
    world: Option<&VoxelWorld>,
    collider_query: &Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    player_query: &mut Query<(&mut Transform, Option<&mut LinearVelocity>), With<Player>>,
    spawn_state: Option<&mut PlayerSpawnState>,
    mode: TeleportSurfaceMode,
) {
    let Some(world) = world else {
        chat_state.push_system("teleport failed: voxel world is unavailable");
        return;
    };
    let Ok((mut transform, velocity)) = player_query.single_mut() else {
        chat_state.push_system("teleport failed: player entity is unavailable");
        return;
    };

    let bounds = world.bounds();
    let origin = match mode {
        TeleportSurfaceMode::Nearest => transform.translation.xz(),
        TeleportSurfaceMode::WorldCenter => Vec2::new(
            (bounds.horizontal_min.x + bounds.horizontal_max.x) as f32 * 0.5,
            (bounds.horizontal_min.y + bounds.horizontal_max.y) as f32 * 0.5,
        ),
        TeleportSurfaceMode::Random => random_world_xz(world),
    };
    let readiness = SpawnColliderReadiness::from_chunk_meshes(collider_query.iter());
    let mut report = default();
    let Some(spawn) = find_nearest_valid_spawn(world, origin, &readiness, false, &mut report)
    else {
        chat_state.push_system(format!(
            "teleport failed: no valid surface near ({:.1}, {:.1}) after {} candidates",
            origin.x, origin.y, report.candidates_tested
        ));
        return;
    };

    transform.translation = spawn.position;
    if let Some(mut velocity) = velocity {
        velocity.0 = Vec3::ZERO;
    }
    if let Some(state) = spawn_state {
        state.last_safe_grounded_position = Some(spawn.position);
        state.last_safe_ground_valid = true;
    }
    chat_state.push_system(format!(
        "teleported to valid surface at ({:.1}, {:.1}, {:.1})",
        spawn.position.x, spawn.position.y, spawn.position.z
    ));
    info!(
        "Debug teleport to valid surface: position={:?} surface={:?} candidates={}",
        spawn.position, spawn.surface_block, report.candidates_tested
    );
}

fn random_world_xz(world: &VoxelWorld) -> Vec2 {
    let bounds = world.bounds();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(0xD06D_F00D);
    let mut seed = nanos ^ 0xA5A5_5A5A_1234_5678;
    let x_span = (bounds.horizontal_max.x - bounds.horizontal_min.x + 1).max(1) as u64;
    let z_span = (bounds.horizontal_max.y - bounds.horizontal_min.y + 1).max(1) as u64;
    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
    let x = bounds.horizontal_min.x + (seed % x_span) as i32;
    seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
    let z = bounds.horizontal_min.y + (seed % z_span) as i32;
    Vec2::new(x as f32, z as f32)
}
