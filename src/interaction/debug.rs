//! Debug overlay systems for block inspection and game state visualization.
//!
//! This module provides:
//! - F3 toggle for the debug overlay
//! - G key for detailed block logging
//! - Various toggle keys for specific debug information

use bevy::diagnostic::{DiagnosticsStore, FrameTimeDiagnosticsPlugin};
use bevy::ecs::system::SystemParam;
use bevy::prelude::*;
use crate::interaction::editing::{EditMode, DeleteMode, DragState};
use crate::interaction::targeting::TargetedBlock;
use crate::network::NetworkSession;
use crate::props::Prop;
use crate::vegetation::{ProceduralGrassPatch, FloatingParticle};
use crate::voxel::meshing::ChunkMesh;
use crate::voxel::plugin::{ChunkGenerationState, RuntimeChunkStats};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;

/// System parameter bundling entity breakdown queries for debug overlay.
#[derive(SystemParam)]
pub struct EntityBreakdownQuery<'w, 's> {
    chunk_meshes: Query<'w, 's, Entity, With<ChunkMesh>>,
    grass_patches: Query<'w, 's, Entity, With<ProceduralGrassPatch>>,
    props: Query<'w, 's, Entity, With<Prop>>,
    particles: Query<'w, 's, Entity, With<FloatingParticle>>,
    ui_nodes: Query<'w, 's, Entity, With<Node>>,
}

impl EntityBreakdownQuery<'_, '_> {
    /// Get counts for each entity category.
    pub fn counts(&self) -> EntityCounts {
        EntityCounts {
            chunk_meshes: self.chunk_meshes.iter().count(),
            grass_patches: self.grass_patches.iter().count(),
            props: self.props.iter().count(),
            particles: self.particles.iter().count(),
            ui_nodes: self.ui_nodes.iter().count(),
        }
    }
}

/// Entity counts by category.
pub struct EntityCounts {
    pub chunk_meshes: usize,
    pub grass_patches: usize,
    pub props: usize,
    pub particles: usize,
    pub ui_nodes: usize,
}

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
    pub show_chunk_stats: bool,
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

/// Toggle optional debug detail sections (all use Alt+ prefix).
pub fn toggle_debug_details(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut toggles: ResMut<DebugDetailToggles>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);

    if alt_held && keyboard.just_pressed(KeyCode::KeyV) {
        toggles.show_vertex_corners = !toggles.show_vertex_corners;
    }

    if alt_held && keyboard.just_pressed(KeyCode::KeyT) {
        toggles.show_texture_details = !toggles.show_texture_details;
    }

    if alt_held && keyboard.just_pressed(KeyCode::KeyN) {
        toggles.show_multiplayer = !toggles.show_multiplayer;
    }

    if alt_held && keyboard.just_pressed(KeyCode::KeyC) {
        toggles.show_chunk_stats = !toggles.show_chunk_stats;
    }
}

/// Update debug overlay text with real-time info.
#[allow(clippy::too_many_arguments)]
pub fn update_debug_overlay(
    state: Res<DebugOverlayState>,
    targeted: Res<TargetedBlock>,
    world: Res<VoxelWorld>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    drag_state: Res<DragState>,
    network: Res<NetworkSession>,
    chunk_stats: Res<RuntimeChunkStats>,
    gen_state: Res<ChunkGenerationState>,
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
    all_entities: Query<Entity>,
    diagnostics: Res<DiagnosticsStore>,
    toggles: Res<DebugDetailToggles>,
    mut query: Query<&mut Text, With<DebugOverlay>>,
    // Entity breakdown - use combined query to avoid param limit
    entity_breakdown: EntityBreakdownQuery,
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

    // Entity count with breakdown
    let entity_count = all_entities.iter().count();
    let counts = entity_breakdown.counts();
    let tracked = counts.chunk_meshes + counts.grass_patches + counts.props + counts.particles + counts.ui_nodes;
    let other_count = entity_count.saturating_sub(tracked);

    text_content.push_str(&format!("Entities: {} (mesh:{} grass:{} prop:{} ui:{} other:{})\n",
        entity_count, counts.chunk_meshes, counts.grass_patches, counts.props, counts.ui_nodes, other_count));

    // Chunk stats summary (always show basic info with LOD breakdown)
    text_content.push_str(&format!(
        "Chunks: {} (hi:{} lo:{} cull:{}) meshes:{}\n",
        chunk_stats.total_chunks,
        chunk_stats.high_lod_chunks,
        chunk_stats.low_lod_chunks,
        chunk_stats.culled_chunks,
        chunk_stats.mesh_entities
    ));

    // Show generation progress if generating
    if gen_state.is_generating() {
        let progress = (gen_state.progress() * 100.0) as u32;
        text_content.push_str(&format!(
            "Generating: {}% ({}/{})\n",
            progress, gen_state.chunks_completed, gen_state.total_chunks
        ));
    }

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

    if toggles.show_chunk_stats {
        append_chunk_stats_debug(&mut text_content, &chunk_stats);
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

/// Append chunk statistics debug info to text content.
fn append_chunk_stats_debug(text_content: &mut String, stats: &RuntimeChunkStats) {
    text_content.push_str("\n[Chunk Statistics]\n");

    // Uniformity breakdown
    let empty_pct = if stats.total_chunks > 0 {
        (stats.empty_chunks as f32 / stats.total_chunks as f32) * 100.0
    } else {
        0.0
    };
    let solid_pct = if stats.total_chunks > 0 {
        (stats.solid_chunks as f32 / stats.total_chunks as f32) * 100.0
    } else {
        0.0
    };
    let mixed_pct = if stats.total_chunks > 0 {
        (stats.mixed_chunks as f32 / stats.total_chunks as f32) * 100.0
    } else {
        0.0
    };

    text_content.push_str(&format!(
        "Empty (air): {} ({:.1}%)\n",
        stats.empty_chunks, empty_pct
    ));
    text_content.push_str(&format!(
        "Solid: {} ({:.1}%)\n",
        stats.solid_chunks, solid_pct
    ));
    text_content.push_str(&format!(
        "Mixed (surfaces): {} ({:.1}%)\n",
        stats.mixed_chunks, mixed_pct
    ));

    // LOD breakdown
    text_content.push_str(&format!(
        "LOD: High={} Low={} Culled={}\n",
        stats.high_lod_chunks, stats.low_lod_chunks, stats.culled_chunks
    ));

    // Mesh counts
    text_content.push_str(&format!(
        "Meshes: {} solid, {} water\n",
        stats.mesh_entities, stats.water_mesh_entities
    ));

    // Vertex count statistics (key LOD effectiveness metric)
    if stats.total_vertices > 0 {
        let hi_pct = (stats.high_lod_vertices as f64 / stats.total_vertices as f64) * 100.0;
        let lo_pct = (stats.low_lod_vertices as f64 / stats.total_vertices as f64) * 100.0;
        text_content.push_str(&format!(
            "Vertices: {}K total (hi:{}K lo:{}K)\n",
            stats.total_vertices / 1000,
            stats.high_lod_vertices / 1000,
            stats.low_lod_vertices / 1000,
        ));
        text_content.push_str(&format!(
            "  Hi LOD: {:.1}%, Lo LOD: {:.1}%\n",
            hi_pct, lo_pct
        ));
    }

    // Per-frame stats
    if stats.chunks_meshed_this_frame > 0 || stats.chunks_skipped_this_frame > 0 {
        let mesh_time_ms = stats.meshing_time_us as f64 / 1000.0;
        text_content.push_str(&format!(
            "This frame: {} meshed, {} skipped ({:.1}ms)\n",
            stats.chunks_meshed_this_frame, stats.chunks_skipped_this_frame, mesh_time_ms
        ));
    }
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
        "\n[Alt+V] Vertex corners: {}",
        if toggles.show_vertex_corners {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[Alt+T] Texture debug: {}",
        if toggles.show_texture_details {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[Alt+N] Multiplayer debug: {}",
        if toggles.show_multiplayer {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[Alt+C] Chunk stats: {}",
        if toggles.show_chunk_stats {
            "ON"
        } else {
            "OFF"
        }
    ));
}
