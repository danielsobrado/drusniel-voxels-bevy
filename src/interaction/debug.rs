//! Debug overlay systems for block inspection and game state visualization.
//!
//! This module provides:
//! - F3 toggle for the debug overlay
//! - G key for detailed block logging
//! - Various toggle keys for specific debug information

use bevy::diagnostic::{DiagnosticsStore, FrameTimeDiagnosticsPlugin};
use bevy::prelude::*;
use crate::interaction::editing::{EditMode, DeleteMode, DragState};
use crate::interaction::targeting::TargetedBlock;
use crate::network::NetworkSession;
use crate::voxel::types::VoxelType;
use crate::voxel::world::VoxelWorld;

/// Component to mark the debug overlay text.
#[derive(Component)]
pub struct DebugOverlay;

/// Resource to track debug overlay visibility.
#[derive(Resource)]
pub struct DebugOverlayState {
    pub visible: bool,
}

impl Default for DebugOverlayState {
    fn default() -> Self {
        Self { visible: false }
    }
}

/// Toggles for optional debug details to keep the overlay decluttered.
#[derive(Resource, Default)]
pub struct DebugDetailToggles {
    pub show_vertex_corners: bool,
    pub show_texture_details: bool,
    pub show_multiplayer: bool,
}

/// Setup debug overlay UI.
pub fn setup_debug_overlay(mut commands: Commands) {
    commands.spawn((
        Text::new(""),
        TextFont {
            font_size: 14.0,
            ..default()
        },
        TextColor(Color::srgba(1.0, 1.0, 0.0, 0.9)),
        Node {
            position_type: PositionType::Absolute,
            top: Val::Px(10.0),
            left: Val::Px(10.0),
            ..default()
        },
        Visibility::Hidden,
        DebugOverlay,
    ));
}

/// Toggle debug overlay with F3 key.
pub fn toggle_debug_overlay(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut state: ResMut<DebugOverlayState>,
    mut query: Query<&mut Visibility, With<DebugOverlay>>,
) {
    if keyboard.just_pressed(KeyCode::F3) {
        state.visible = !state.visible;
        for mut vis in query.iter_mut() {
            *vis = if state.visible {
                Visibility::Visible
            } else {
                Visibility::Hidden
            };
        }
    }
}

/// Toggle optional debug detail sections.
pub fn toggle_debug_details(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut toggles: ResMut<DebugDetailToggles>,
) {
    if keyboard.just_pressed(KeyCode::KeyV) {
        toggles.show_vertex_corners = !toggles.show_vertex_corners;
    }

    if keyboard.just_pressed(KeyCode::KeyT) {
        toggles.show_texture_details = !toggles.show_texture_details;
    }

    if keyboard.just_pressed(KeyCode::KeyN) {
        toggles.show_multiplayer = !toggles.show_multiplayer;
    }
}

/// Update debug overlay text with real-time info.
pub fn update_debug_overlay(
    state: Res<DebugOverlayState>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    drag_state: Res<DragState>,
    network: Res<NetworkSession>,
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    diagnostics: Res<DiagnosticsStore>,
    toggles: Res<DebugDetailToggles>,
    mut query: Query<&mut Text, With<DebugOverlay>>,
) {
    if !state.visible {
        return;
    }

    let mut text_content = String::new();

    // Camera position
    if let Ok(camera) = camera_query.single() {
        let pos = camera.translation;
        text_content.push_str(&format!(
            "Pos: ({:.1}, {:.1}, {:.1})\n",
            pos.x, pos.y, pos.z
        ));

        let block_pos = IVec3::new(
            pos.x.floor() as i32,
            pos.y.floor() as i32,
            pos.z.floor() as i32,
        );
        let chunk_pos = VoxelWorld::world_to_chunk(block_pos);
        text_content.push_str(&format!("Chunk: {:?}\n", chunk_pos));
    }

    // Performance
    let fps = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FPS)
        .and_then(|fps_diag| fps_diag.average())
        .map(|value| format!("{value:.1}"))
        .unwrap_or_else(|| "N/A".to_string());
    text_content.push_str(&format!("FPS: {}\n", fps));

    text_content.push('\n');

    // Targeted block info
    if let (Some(pos), Some(voxel_type)) = (targeted.position, targeted.voxel_type) {
        text_content.push_str(&format!("Target: {:?}\n", pos));
        text_content.push_str(&format!("Type: {:?}\n", voxel_type));

        // Water scan in 5x5x5 area
        let (water_count, water_with_air) = count_nearby_water(&world, pos);

        text_content.push_str(&format!("\nWater (5x5x5): {}\n", water_count));
        text_content.push_str(&format!("Water+Air adj: {}\n", water_with_air));

        if toggles.show_texture_details {
            text_content.push_str("\n[Texture debug]\n");
            text_content.push_str(&format!("Atlas index: {}\n", voxel_type.atlas_index()));
            text_content.push_str(&format!(
                "Solid: {}  Transparent: {}  Liquid: {}\n",
                voxel_type.is_solid(),
                voxel_type.is_transparent(),
                voxel_type.is_liquid()
            ));
            if let Some(normal) = targeted.normal {
                text_content.push_str(&format!("Target face normal: {:?}\n", normal));
            }
        }

        if toggles.show_vertex_corners {
            text_content.push_str("\n[Vertex corners]\n");
            let base = pos.as_vec3();
            let corners = [
                base,
                base + Vec3::X,
                base + Vec3::Y,
                base + Vec3::Z,
                base + Vec3::X + Vec3::Y,
                base + Vec3::X + Vec3::Z,
                base + Vec3::Y + Vec3::Z,
                base + Vec3::X + Vec3::Y + Vec3::Z,
            ];

            for (i, corner) in corners.iter().enumerate() {
                text_content.push_str(&format!(
                    "C{}: ({:.1}, {:.1}, {:.1})\n",
                    i + 1,
                    corner.x,
                    corner.y,
                    corner.z
                ));
            }
        }
    } else {
        text_content.push_str("Target: None\n");
    }

    if toggles.show_multiplayer {
        append_multiplayer_debug(&mut text_content, &network);
    }

    append_control_hints(&mut text_content, &edit_mode, &delete_mode, &drag_state, &toggles);

    for mut text in query.iter_mut() {
        **text = text_content.clone();
    }
}

/// Count nearby water blocks for debug display.
fn count_nearby_water(world: &VoxelWorld, center: IVec3) -> (u32, u32) {
    let mut water_count = 0;
    let mut water_with_air = 0;

    for dx in -2..=2 {
        for dy in -2..=2 {
            for dz in -2..=2 {
                let scan_pos = center + IVec3::new(dx, dy, dz);
                if let Some(voxel) = world.get_voxel(scan_pos) {
                    if voxel.is_liquid() {
                        water_count += 1;
                        // Check if this water is adjacent to air
                        for offset in [
                            IVec3::X,
                            IVec3::NEG_X,
                            IVec3::Y,
                            IVec3::NEG_Y,
                            IVec3::Z,
                            IVec3::NEG_Z,
                        ] {
                            if let Some(adj) = world.get_voxel(scan_pos + offset) {
                                if adj == VoxelType::Air {
                                    water_with_air += 1;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    (water_count, water_with_air)
}

/// Append multiplayer debug info to text content.
fn append_multiplayer_debug(text_content: &mut String, network: &NetworkSession) {
    text_content.push_str("\n[Multiplayer]\n");
    text_content.push_str(&format!(
        "Hosting: {}\n",
        if network.server_running { "YES" } else { "NO" }
    ));
    text_content.push_str(&format!(
        "Client connected: {}\n",
        if network.client_connected {
            "YES"
        } else {
            "NO"
        }
    ));

    if let (Some(ip), Some(port)) = (&network.connection_ip, &network.connection_port) {
        text_content.push_str(&format!("Peer: {}:{}\n", ip, port));
    }

    let latency = network
        .last_latency_ms
        .map(|ms| format!("{ms} ms"))
        .unwrap_or_else(|| "N/A".to_string());
    text_content.push_str(&format!("Latency: {}\n", latency));

    text_content.push_str(&format!(
        "Health: {}\n",
        if network.last_health_ok {
            "OK"
        } else {
            "Unhealthy"
        }
    ));
}

/// Append control hints to text content.
fn append_control_hints(
    text_content: &mut String,
    edit_mode: &EditMode,
    delete_mode: &DeleteMode,
    drag_state: &DragState,
    toggles: &DebugDetailToggles,
) {
    text_content.push_str("\n[F3] Toggle overlay");
    text_content.push_str("\n[G] Detailed log");
    text_content.push_str(&format!(
        "\n[Shift+M] Edit mode: {}",
        if edit_mode.enabled { "ON" } else { "OFF" }
    ));
    if edit_mode.enabled {
        text_content.push_str(&format!(
            "\n    Dragging: {}",
            if drag_state.dragged_block.is_some() {
                "YES"
            } else {
                "NO"
            }
        ));
        text_content.push_str(&format!(
            "\n    Delete mode: {} (Del)",
            if delete_mode.enabled { "ON" } else { "OFF" }
        ));
        if drag_state.dragged_block.is_some() {
            text_content.push_str(&format!(
                "\n    Rotation: {:.0}° (scroll/Q/E)",
                drag_state.rotation_degrees
            ));
        }
    }
    text_content.push_str(&format!(
        "\n[V] Vertex corners: {}",
        if toggles.show_vertex_corners {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[T] Texture debug: {}",
        if toggles.show_texture_details {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[N] Multiplayer debug: {}",
        if toggles.show_multiplayer {
            "ON"
        } else {
            "OFF"
        }
    ));
}
