//! Debug overlay systems for block inspection and game state visualization.
//!
//! This module provides:
//! - F3 toggle for the debug overlay
//! - G key for detailed block logging
//! - Various toggle keys for specific debug information

use super::editing::{DeleteMode, DragState, EditMode};
use super::targeting::TargetedBlock;
use crate::atmosphere::{FogQuality, VolumetricFogRuntimeState};
use crate::audio::events::{AudioEventId, GameAudioEvent};
use crate::interaction::TargetedProp;
use crate::network::NetworkSession;
use crate::performance::{
    AreaTimingCapture, AreaTimingRecorder, dump_area_timing_csv, start_area_trace, stop_area_trace,
};
use crate::player::{Player, classify_player_world_validity};
use crate::props::billboard::BillboardStats;
use crate::props::foliage::{FoliageFade, FoliageFadeSettings, GrassPropWind};
use crate::props::instanced_render::PropBoundsDebugSettings;
use crate::props::{Prop, PropChunkCullState};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::rendering::shadow_budget::ShadowCullingStats;
use crate::rendering::water_reflection::{WaterReflectionMaskStats, WaterReflectionStatus};
use crate::rendering::water_visual_probe::WaterVisualDebugState;
use crate::runtime_commands::RuntimeViewportDebugState;
use crate::vegetation::{FloatingParticle, ProceduralGrassPatch};
use crate::voxel::chunk::{LodLevel, MeshDirtyReason};
use crate::voxel::enclosure::{EnclosureMode, EnclosureOcclusionStats, EnclosureState};
use crate::voxel::mc_transvoxel::McTransvoxelSettings;
#[cfg(feature = "mc_transvoxel")]
use crate::voxel::meshing::MeshMode;
use crate::voxel::meshing::{ChunkMesh, Face, MeshSettings, get_blocky_material_index};
use crate::voxel::occlusion::{OcclusionConfig, VisibleChunks};
use crate::voxel::plugin::{
    ChunkGenerationState, LodSettings, RuntimeChunkStats, WaterBodyRegistry,
};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelSample, VoxelWorld};
use bevy::diagnostic::{
    DiagnosticsStore, EntityCountDiagnosticsPlugin, FrameTimeDiagnosticsPlugin,
    SystemInformationDiagnosticsPlugin,
};
use bevy::ecs::system::SystemParam;
use bevy::prelude::*;
use std::time::Instant;
use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

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

#[derive(SystemParam)]
pub struct DebugOverlayParams<'w> {
    pub state: Res<'w, DebugOverlayState>,
    pub toggles: Res<'w, DebugDetailToggles>,
    pub perf_metrics: ResMut<'w, PerformanceMetrics>,
    pub prop_cull_state: Res<'w, PropChunkCullState>,
    pub system_monitor: Res<'w, SystemPerformanceMonitor>,
    pub graphics: Option<Res<'w, GraphicsCapabilities>>,
    pub timing_recorder: Res<'w, AreaTimingRecorder>,
    pub timing_capture: Res<'w, AreaTimingCapture>,
    pub fog_quality: Option<Res<'w, FogQuality>>,
    pub fog_runtime: Option<Res<'w, VolumetricFogRuntimeState>>,
    pub shadow_stats: Res<'w, ShadowCullingStats>,
    pub reflection_status: Option<Res<'w, WaterReflectionStatus>>,
    pub reflection_mask_stats: Option<Res<'w, WaterReflectionMaskStats>>,
    pub water_visual_debug: Option<Res<'w, WaterVisualDebugState>>,
    pub water_bodies: Option<Res<'w, WaterBodyRegistry>>,
    pub lod_control: Res<'w, crate::voxel::plugin::TerrainLodControl>,
    pub enclosure: Res<'w, EnclosureState>,
    pub occlusion_config: Res<'w, OcclusionConfig>,
    pub visible_chunks: Res<'w, VisibleChunks>,
    pub enclosure_stats: Res<'w, EnclosureOcclusionStats>,
    pub billboard_stats: Res<'w, BillboardStats>,
    pub prop_bounds_debug: Res<'w, PropBoundsDebugSettings>,
}

#[derive(SystemParam)]
pub struct PropDebugQuery<'w, 's> {
    pub fade_settings: Option<Res<'w, FoliageFadeSettings>>,
    pub props: Query<'w, 's, (&'static Prop, Option<&'static GrassPropWind>)>,
    pub children: Query<'w, 's, &'static Children>,
    pub fades: Query<'w, 's, &'static FoliageFade>,
}

#[derive(SystemParam)]
pub struct PositionDebugQuery<'w, 's> {
    pub camera: Query<'w, 's, &'static Transform, With<crate::camera::controller::PlayerCamera>>,
    pub player: Query<'w, 's, &'static Transform, With<Player>>,
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
    pub show_prop_details: bool,
    pub show_performance: bool,
    pub show_timing_breakdown: bool,
    pub show_chunk_borders: bool,
    pub volumetric_fog_enabled: bool,
}

impl DebugDetailToggles {
    pub fn new(volumetric_enabled: bool) -> Self {
        Self {
            volumetric_fog_enabled: volumetric_enabled,
            ..default()
        }
    }
}

/// Resource tracking performance metrics for debug display.
#[derive(Resource)]
pub struct PerformanceMetrics {
    /// Frame time history for min/max calculation (last N frames)
    pub frame_times_ms: Vec<f64>,
    /// Current index in circular buffer
    frame_time_index: usize,
    /// Physics step timing (updated by wrapper system)
    pub physics_time_us: u64,
    /// Visibility/culling timing
    pub visibility_time_us: u64,
    /// Transform propagation timing
    pub transform_time_us: u64,
    /// Prop update timing
    pub prop_update_time_us: u64,
    /// Last frame's total tracked time
    pub total_tracked_time_us: u64,
    /// Timestamp for measuring frame sections
    #[allow(dead_code)]
    pub section_start: Option<Instant>,
}

impl Default for PerformanceMetrics {
    fn default() -> Self {
        Self {
            frame_times_ms: vec![0.0; 120], // 2 seconds at 60fps
            frame_time_index: 0,
            physics_time_us: 0,
            visibility_time_us: 0,
            transform_time_us: 0,
            prop_update_time_us: 0,
            total_tracked_time_us: 0,
            section_start: None,
        }
    }
}

impl PerformanceMetrics {
    /// Record a frame time sample
    pub fn record_frame_time(&mut self, time_ms: f64) {
        self.frame_times_ms[self.frame_time_index] = time_ms;
        self.frame_time_index = (self.frame_time_index + 1) % self.frame_times_ms.len();
    }

    /// Get min frame time from history
    pub fn min_frame_time(&self) -> f64 {
        self.frame_times_ms
            .iter()
            .filter(|&&t| t > 0.0)
            .copied()
            .fold(f64::MAX, f64::min)
    }

    /// Get max frame time from history
    pub fn max_frame_time(&self) -> f64 {
        self.frame_times_ms.iter().copied().fold(0.0, f64::max)
    }

    /// Get average frame time from history
    pub fn avg_frame_time(&self) -> f64 {
        let valid: Vec<_> = self.frame_times_ms.iter().filter(|&&t| t > 0.0).collect();
        if valid.is_empty() {
            return 0.0;
        }
        valid.iter().copied().sum::<f64>() / valid.len() as f64
    }

    /// Reset per-frame timings
    #[allow(dead_code)]
    pub fn reset_frame_timings(&mut self) {
        self.total_tracked_time_us = self.physics_time_us
            + self.visibility_time_us
            + self.transform_time_us
            + self.prop_update_time_us;
        self.physics_time_us = 0;
        self.visibility_time_us = 0;
        self.transform_time_us = 0;
        self.prop_update_time_us = 0;
    }
}

/// Local system stats to show CPU/RAM when diagnostics are unavailable.
#[derive(Resource)]
pub struct SystemPerformanceMonitor {
    system: System,
    last_refresh: f64,
    cpu_usage: Option<f32>,
    cpu_cores: usize,
    cpu_core_usages: Vec<f32>,
    mem_used_mb: Option<u64>,
}

impl Default for SystemPerformanceMonitor {
    fn default() -> Self {
        let refresh = RefreshKind::everything()
            .with_cpu(CpuRefreshKind::everything())
            .with_memory(MemoryRefreshKind::everything());
        let mut system = System::new_with_specifics(refresh);
        system.refresh_cpu_all();
        system.refresh_memory();
        Self {
            system,
            last_refresh: 0.0,
            cpu_usage: None,
            cpu_cores: 0,
            cpu_core_usages: Vec::new(),
            mem_used_mb: None,
        }
    }
}

/// Periodically refresh CPU/RAM stats for debug overlay fallback.
/// Gated behind overlay visibility to avoid 1-5ms sysinfo syscalls when F3 is off.
pub fn update_system_monitor(
    mut monitor: ResMut<SystemPerformanceMonitor>,
    time: Res<Time>,
    overlay_state: Res<DebugOverlayState>,
) {
    // Skip expensive sysinfo refresh when overlay is hidden
    if !overlay_state.visible {
        return;
    }

    let now = time.elapsed_secs_f64();
    if now - monitor.last_refresh < 0.5 {
        return;
    }

    monitor.last_refresh = now;
    monitor.system.refresh_cpu_all();
    monitor.system.refresh_memory();
    monitor.cpu_usage = Some(monitor.system.global_cpu_usage());
    monitor.cpu_cores = monitor.system.cpus().len();
    monitor.cpu_core_usages = monitor
        .system
        .cpus()
        .iter()
        .map(|cpu| cpu.cpu_usage())
        .collect();
    monitor.mem_used_mb = Some((monitor.system.used_memory() / 1024) as u64);
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
    toggles: Res<DebugDetailToggles>,
    timing_capture: Res<AreaTimingCapture>,
    mut timing_recorder: ResMut<AreaTimingRecorder>,
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
        timing_recorder
            .set_enabled(state.visible || toggles.show_timing_breakdown || timing_capture.active);
    }
}

/// Toggle optional debug detail sections (all use Alt+ prefix).
pub fn toggle_debug_details(
    keyboard: Res<ButtonInput<KeyCode>>,
    overlay_state: Res<DebugOverlayState>,
    mut toggles: ResMut<DebugDetailToggles>,
    mut timing_recorder: ResMut<AreaTimingRecorder>,
    mut timing_capture: ResMut<AreaTimingCapture>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    let shift_held = keyboard.pressed(KeyCode::ShiftLeft) || keyboard.pressed(KeyCode::ShiftRight);

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

    if alt_held && keyboard.just_pressed(KeyCode::KeyP) {
        toggles.show_prop_details = !toggles.show_prop_details;
    }

    if alt_held && keyboard.just_pressed(KeyCode::KeyF) {
        toggles.show_performance = !toggles.show_performance;
    }

    if alt_held && shift_held && keyboard.just_pressed(KeyCode::KeyT) {
        toggles.show_timing_breakdown = !toggles.show_timing_breakdown;
        timing_recorder.set_enabled(
            overlay_state.visible || toggles.show_timing_breakdown || timing_capture.active,
        );
    }

    if alt_held && shift_held && keyboard.just_pressed(KeyCode::KeyR) {
        if timing_capture.active {
            let _ = stop_area_trace(&mut timing_capture);
        } else {
            start_area_trace(&mut timing_capture);
        }
        timing_recorder.set_enabled(
            overlay_state.visible || toggles.show_timing_breakdown || timing_capture.active,
        );
    }

    if !shift_held && keyboard.just_pressed(KeyCode::F4) {
        match dump_area_timing_csv(&timing_recorder) {
            Ok(path) => {
                println!("Performance timing CSV written to {}", path.display());
                info!("Performance timing CSV written to {}", path.display());
            }
            Err(err) => warn!("Failed to write performance timing CSV: {}", err),
        }
    }

    // Volumetric fog toggle (Alt+L "Light")
    if alt_held && keyboard.just_pressed(KeyCode::KeyL) {
        toggles.volumetric_fog_enabled = !toggles.volumetric_fog_enabled;
        info!(
            "Debug toggle: Volumetric Fog = {}",
            if toggles.volumetric_fog_enabled {
                "ON"
            } else {
                "OFF"
            }
        );
    }

    // Chunk-border overlay toggle (Alt+K). Moved off Alt+B because KeyB also
    // drives building mode and the prop-bounds debug toggle, so Alt+B fired all
    // three at once and locked out movement/aiming.
    if alt_held && keyboard.just_pressed(KeyCode::KeyK) {
        toggles.show_chunk_borders = !toggles.show_chunk_borders;
        info!(
            "Debug toggle: Chunk Borders = {}",
            if toggles.show_chunk_borders {
                "ON"
            } else {
                "OFF"
            }
        );
    }
}

/// Toggle legacy MC+Transvoxel spike at runtime with **Alt+F5**.
#[cfg(not(feature = "mc_transvoxel"))]
pub fn toggle_mc_transvoxel_spike(
    keyboard: Res<ButtonInput<KeyCode>>,
    _mesh_settings: Res<MeshSettings>,
    _mc_settings: ResMut<McTransvoxelSettings>,
    _world: ResMut<crate::voxel::world::VoxelWorld>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    if !alt_held || !keyboard.just_pressed(KeyCode::F5) {
        return;
    }

    log::warn!("MC+Transvoxel runtime toggle ignored: rebuild with --features mc_transvoxel");
}

/// Toggle legacy MC+Transvoxel spike at runtime with **Alt+F5** (Surface Nets terrain only).
#[cfg(feature = "mc_transvoxel")]
pub fn toggle_mc_transvoxel_spike(
    keyboard: Res<ButtonInput<KeyCode>>,
    mesh_settings: Res<MeshSettings>,
    mut mc_settings: ResMut<McTransvoxelSettings>,
    mut world: ResMut<crate::voxel::world::VoxelWorld>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    if !alt_held || !keyboard.just_pressed(KeyCode::F5) {
        return;
    }

    if mesh_settings.mode != MeshMode::SurfaceNets {
        log::warn!(
            "MC+Transvoxel spike applies only when terrain mesh mode is SurfaceNets (current: {:?}). Press F5 to switch.",
            mesh_settings.mode
        );
        return;
    }

    mc_settings.enabled = !mc_settings.enabled;
    world.mark_all_loaded_chunks_dirty_with_reason(MeshDirtyReason::Lod);
    info!(
        "MC+Transvoxel spike: {} (mode={:?}, Alt+F5 to toggle). Remeshing...",
        if mc_settings.enabled { "ON" } else { "OFF" },
        mc_settings.mode,
    );
}

/// Toggle mesh mode with F5 key (Blocky <-> SurfaceNets).
///
/// Marks all chunks dirty to trigger re-meshing with the new mode.
/// Also updates the low_detail_mode in LodSettings so ALL LOD levels
/// use the toggled mode consistently.
pub fn toggle_mesh_mode(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut mesh_settings: ResMut<MeshSettings>,
    mut lod_settings: ResMut<LodSettings>,
    mut world: ResMut<crate::voxel::world::VoxelWorld>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    if alt_held {
        return;
    }
    if keyboard.just_pressed(KeyCode::F5) {
        mesh_settings.mode.toggle();
        // Also toggle the low_detail_mode so ALL LOD levels use the same mode
        // This ensures blocky terrain applies to distant chunks too, not just LOD0
        lod_settings.low_detail_mode = mesh_settings.mode;
        // Mark all chunks dirty to trigger re-meshing
        world.mark_all_loaded_chunks_dirty_with_reason(MeshDirtyReason::WaterMaterial);
        info!(
            "Mesh mode: {:?} (all LODs) (F5 to toggle)",
            mesh_settings.mode
        );
    }
}

/// Freeze terrain LOD updates with Alt+F6 (debug): stops the distance-based LOD
/// reassignment so the current LOD layout holds while you fly to a seam/hole and
/// inspect it up close, without LODs shifting under the camera. Press again to
/// resume live LOD. Meshing/edits still work; only LOD *level* changes are paused.
pub fn toggle_freeze_terrain_lod(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut lod_control: ResMut<crate::voxel::plugin::TerrainLodControl>,
    mut audio_events: MessageWriter<GameAudioEvent>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    if !alt_held || !keyboard.just_pressed(KeyCode::F6) {
        return;
    }
    lod_control.freeze_lod = !lod_control.freeze_lod;
    audio_events.write(GameAudioEvent::ui(AudioEventId::LodToggle));
    info!(
        "Terrain LOD updates: {} (Alt+F6). {}",
        if lod_control.freeze_lod {
            "FROZEN"
        } else {
            "LIVE"
        },
        if lod_control.freeze_lod {
            "Fly to the seam and inspect; LODs will not shift."
        } else {
            "Resumed distance-based LOD."
        }
    );
}

/// Toggle terrain LOD with Alt+0 (debug): forces every loaded chunk to Lod0 so
/// LOD-boundary artifacts can be told apart from genuine geometry. Press again
/// to restore the previous LOD distances.
pub fn toggle_terrain_lod(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut world: ResMut<crate::voxel::world::VoxelWorld>,
    mut saved: Local<Option<std::collections::HashMap<IVec3, LodLevel>>>,
) {
    let alt_held = keyboard.pressed(KeyCode::AltLeft) || keyboard.pressed(KeyCode::AltRight);
    if !alt_held || !keyboard.just_pressed(KeyCode::Digit0) {
        return;
    }

    // Set each chunk's LOD directly: the distance-based LOD system only runs
    // when the camera moves, so mutating LodSettings alone does nothing while
    // standing still. The forced Lod0 therefore holds only while the camera is
    // stationary — run this diagnostic without moving.
    match saved.take() {
        Some(previous) => {
            for (chunk_pos, lod) in previous {
                if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                    chunk.set_lod_level(lod);
                }
            }
            info!("Terrain LOD: restored distance-based LODs (Alt+0 to toggle)");
        }
        None => {
            let positions: Vec<IVec3> = world.chunk_entries().map(|(pos, _)| *pos).collect();
            let mut snapshot = std::collections::HashMap::new();
            for chunk_pos in positions {
                if let Some(mut chunk) = world.get_chunk_mut(chunk_pos) {
                    snapshot.insert(chunk_pos, chunk.lod_level());
                    chunk.set_lod_level(LodLevel::Lod0);
                }
            }
            info!(
                "Terrain LOD: forced {} chunks to Lod0 and queued remeshes - stand still and wait for redraw (Alt+0 to toggle)",
                snapshot.len()
            );
            *saved = Some(snapshot);
        }
    }
    world.mark_all_loaded_chunks_dirty_with_reason(MeshDirtyReason::Lod);
}

/// Draws a wireframe box per loaded chunk, coloured by LOD level (Alt+K).
///
/// Lets LOD-boundary artifacts be matched to the chunk grid: the colours of the
/// two boxes meeting at a crack reveal which LOD levels border there, and which
/// axis the boundary is on. Lod0 green, Lod1 yellow, Lod2 orange, Lod3 red,
/// Culled grey.
pub fn draw_chunk_borders(
    toggles: Res<DebugDetailToggles>,
    world: Res<VoxelWorld>,
    mut gizmos: Gizmos,
    mut was_enabled: Local<bool>,
) {
    if !toggles.show_chunk_borders {
        *was_enabled = false;
        return;
    }

    // Log a numeric LOD histogram each time the overlay is switched on, so the
    // LOD distribution can be read as data rather than guessed from box colours.
    if !*was_enabled {
        *was_enabled = true;
        let mut counts = [0u32; 5];
        for (_, chunk) in world.chunk_entries() {
            if chunk.is_empty() {
                continue;
            }
            let index = match chunk.lod_level() {
                LodLevel::Lod0 => 0,
                LodLevel::Lod1 => 1,
                LodLevel::Lod2 => 2,
                LodLevel::Lod3 => 3,
                LodLevel::Culled => 4,
            };
            counts[index] += 1;
        }
        info!(
            "Terrain chunk LOD distribution (non-empty): Lod0={} Lod1={} Lod2={} Lod3={} Culled={} (total {})",
            counts[0],
            counts[1],
            counts[2],
            counts[3],
            counts[4],
            counts.iter().sum::<u32>(),
        );
    }

    let chunk_size = crate::constants::CHUNK_SIZE as f32;
    for (_, chunk) in world.chunk_entries() {
        // Skip pure-air chunks so the overlay only boxes actual terrain.
        if chunk.is_empty() {
            continue;
        }
        let origin = chunk.position().as_vec3() * chunk_size;
        let center = origin + Vec3::splat(chunk_size * 0.5);
        let color = match chunk.lod_level() {
            LodLevel::Lod0 => Color::srgb(0.2, 0.9, 0.2),
            LodLevel::Lod1 => Color::srgb(0.9, 0.9, 0.2),
            LodLevel::Lod2 => Color::srgb(0.95, 0.55, 0.1),
            LodLevel::Lod3 => Color::srgb(0.95, 0.2, 0.2),
            LodLevel::Culled => Color::srgb(0.5, 0.5, 0.5),
        };
        gizmos.primitive_3d(
            &Cuboid::new(chunk_size, chunk_size, chunk_size),
            Isometry3d::from_translation(center),
            color,
        );
    }
}

/// Update debug overlay text with real-time info.
#[allow(clippy::too_many_arguments)]
pub fn update_debug_overlay(
    mut debug: DebugOverlayParams,
    targeted: Res<TargetedBlock>,
    targeted_prop: Res<TargetedProp>,
    world: Res<VoxelWorld>,
    edit_mode: Res<EditMode>,
    delete_mode: Res<DeleteMode>,
    drag_state: Res<DragState>,
    network: Res<NetworkSession>,
    chunk_stats: Res<RuntimeChunkStats>,
    gen_state: Res<ChunkGenerationState>,
    positions: PositionDebugQuery,
    all_entities: Query<Entity>,
    diagnostics: Res<DiagnosticsStore>,
    mut query: Query<&mut Text, With<DebugOverlay>>,
    // Entity breakdown - use combined query to avoid param limit
    entity_breakdown: EntityBreakdownQuery,
    prop_debug: PropDebugQuery,
) {
    if !debug.state.visible {
        return;
    }

    // Record frame time for history (use smoothed for stable values)
    if let Some(frame_time) = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FRAME_TIME)
        .and_then(|d| d.smoothed())
    {
        debug.perf_metrics.record_frame_time(frame_time);
    }

    let mut text_content = String::new();

    // Camera position
    if let Ok(camera) = positions.camera.single() {
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
        let local_pos = VoxelWorld::world_to_local(block_pos);
        text_content.push_str(&format!("Chunk: {:?} Local: {:?}\n", chunk_pos, local_pos));
    }

    append_world_bounds_debug(
        &mut text_content,
        &world,
        positions.player.single().ok(),
        &targeted,
    );

    // Player validity counters are recorded by the player plugin; show the live state here.
    if let Ok(player_transform) = positions.player.single() {
        let player_block = IVec3::new(
            player_transform.translation.x.floor() as i32,
            player_transform.translation.y.floor() as i32,
            player_transform.translation.z.floor() as i32,
        );
        let chunk_pos = VoxelWorld::world_to_chunk(player_block);
        let local_pos = VoxelWorld::world_to_local(player_block);
        text_content.push_str(&format!(
            "Player chunk: {:?} local {:?}\n",
            chunk_pos, local_pos
        ));
    }

    // Performance
    let fps = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FPS)
        .and_then(|fps_diag| fps_diag.average())
        .map(|value| format!("{value:.1}"))
        .unwrap_or_else(|| "N/A".to_string());
    text_content.push_str(&format!("FPS: {}\n", fps));
    append_area_timing_table(&mut text_content, &diagnostics, &debug.timing_recorder);
    append_reflection_status(&mut text_content, debug.reflection_status.as_deref());
    append_reflection_mask_status(&mut text_content, debug.reflection_mask_stats.as_deref());
    append_water_visual_debug(&mut text_content, debug.water_visual_debug.as_deref());
    append_water_body_status(&mut text_content, debug.water_bodies.as_deref());
    append_enclosure_status(
        &mut text_content,
        &debug.enclosure,
        &debug.occlusion_config,
        &debug.visible_chunks,
        &debug.enclosure_stats,
    );

    // Entity count with breakdown
    let entity_count = all_entities.iter().count();
    let counts = entity_breakdown.counts();
    let tracked = counts.chunk_meshes
        + counts.grass_patches
        + counts.props
        + counts.particles
        + counts.ui_nodes;
    let other_count = entity_count.saturating_sub(tracked);

    text_content.push_str(&format!(
        "Entities: {} (mesh:{} grass:{} prop:{} ui:{} other:{})\n",
        entity_count,
        counts.chunk_meshes,
        counts.grass_patches,
        counts.props,
        counts.ui_nodes,
        other_count
    ));

    // Chunk stats summary (always show basic info with LOD breakdown)
    text_content.push_str(&format!(
        "Chunks: {} (hi:{} lo:{} cull:{}) meshes:{}\n",
        chunk_stats.total_chunks,
        chunk_stats.high_lod_chunks,
        chunk_stats.low_lod_chunks,
        chunk_stats.culled_chunks,
        chunk_stats.mesh_entities
    ));

    // Shadow budget
    text_content.push_str(&format!(
        "Shadows: terrain {}/{} lights {}/{}\n",
        debug.shadow_stats.terrain_with_shadows,
        debug.shadow_stats.terrain_with_shadows + debug.shadow_stats.terrain_without_shadows,
        debug.shadow_stats.point_lights_with_shadows,
        debug.shadow_stats.point_lights_total,
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

        if debug.toggles.show_texture_details {
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
                // Show blocky texture layer for this face
                let face = normal_to_face(normal);
                let blocky_layer = get_blocky_material_index(voxel_type, face);
                let layer_name = match blocky_layer {
                    0 => "grass (atlas 3)",
                    1 => "dirt (atlas 0)",
                    2 => "rock (atlas 1)",
                    3 => "sand (atlas 4)",
                    4 => "grass_side (atlas 7)",
                    _ => "unknown",
                };
                text_content.push_str(&format!(
                    "Blocky layer: {} = {}\n",
                    blocky_layer, layer_name
                ));
            }
        }

        if debug.toggles.show_vertex_corners {
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

    if debug.toggles.show_prop_details {
        text_content.push_str("\n[Prop debug]\n");
        text_content.push_str(&format!(
            "Billboards: loaded {} missing {} dir8 {} active {} blocked {}\n",
            debug.billboard_stats.generated_assets_loaded,
            debug.billboard_stats.missing_generated_assets,
            debug.billboard_stats.directional8_count,
            debug.billboard_stats.currently_billboarded,
            debug.billboard_stats.placeholder_blocked
        ));
        text_content.push_str(&format!(
            "Billboard alpha: min {:.3} max {:.3} switches {}\n",
            debug.billboard_stats.alpha_coverage_min,
            debug.billboard_stats.alpha_coverage_max,
            debug.billboard_stats.texture_direction_switches
        ));
        if let Some(entity) = targeted_prop.entity {
            if let Ok((prop, wind)) = prop_debug.props.get(entity) {
                text_content.push_str(&format!("Prop: {} ({:?})\n", prop.id, prop.prop_type));
                text_content.push_str(&format!("Distance: {:.2}\n", targeted_prop.distance));
                text_content.push_str(&format!(
                    "Grass-like: {}\n",
                    if is_grass_like_prop(&prop.id) {
                        "YES"
                    } else {
                        "NO"
                    }
                ));
                text_content.push_str(&format!(
                    "Wind: {}\n",
                    if wind.is_some() { "YES" } else { "NO" }
                ));

                if let Some(fade_info) =
                    collect_prop_fade_info(entity, &prop_debug.children, &prop_debug.fades)
                {
                    text_content.push_str(&format!("Fade meshes: {}\n", fade_info.count));
                    text_content.push_str(&format!(
                        "Alpha: base {:.2} current {:.2}\n",
                        fade_info.base_alpha, fade_info.current_alpha
                    ));
                    text_content.push_str(&format!(
                        "Fade scales: min {:.2} dist {:.2}\n",
                        fade_info.min_alpha_scale, fade_info.distance_scale
                    ));
                } else {
                    text_content.push_str("Fade: NONE\n");
                }

                if let Some(settings) = prop_debug.fade_settings.as_ref() {
                    text_content.push_str(&format!(
                        "Fade settings: start {:.2} end {:.2} min {:.2} max {:.1}\n",
                        settings.near_fade_start,
                        settings.near_fade_end,
                        settings.near_fade_min_alpha,
                        settings.max_update_distance
                    ));
                }
            } else {
                text_content.push_str("Prop: Not found\n");
            }
        } else {
            text_content.push_str("Prop: None\n");
        }
    }

    if debug.toggles.show_multiplayer {
        append_multiplayer_debug(&mut text_content, &network);
    }

    if debug.toggles.show_chunk_stats {
        append_chunk_stats_debug(
            &mut text_content,
            &chunk_stats,
            debug.lod_control.freeze_lod,
        );
    }

    if debug.toggles.show_performance {
        append_performance_debug(
            &mut text_content,
            &diagnostics,
            &debug.perf_metrics,
            &chunk_stats,
            &debug.prop_cull_state,
            &debug.system_monitor,
            debug.graphics.as_deref(),
            debug.toggles.show_timing_breakdown,
            &debug.timing_recorder,
            &debug.timing_capture,
            debug.fog_quality.as_deref(),
            debug.fog_runtime.as_deref(),
        );
    }

    append_control_hints(
        &mut text_content,
        &edit_mode,
        &delete_mode,
        &drag_state,
        &debug.toggles,
        &debug.timing_capture,
        debug.prop_bounds_debug.enabled,
    );

    for mut text in query.iter_mut() {
        **text = text_content.clone();
    }
}

pub fn render_world_bounds_debug_planes(
    runtime_debug: Option<Res<RuntimeViewportDebugState>>,
    world: Res<VoxelWorld>,
    mut gizmos: Gizmos,
) {
    if !should_render_world_bounds_debug_planes(runtime_debug.as_deref()) {
        return;
    }

    let bounds = world.bounds();
    let min_x = bounds.horizontal_min.x as f32;
    let max_x = bounds.horizontal_max.x as f32 + 1.0;
    let min_z = bounds.horizontal_min.y as f32;
    let max_z = bounds.horizontal_max.y as f32 + 1.0;

    draw_debug_plane(
        &mut gizmos,
        min_x,
        max_x,
        min_z,
        max_z,
        bounds.min_world_y as f32,
        Color::srgba(0.1, 0.6, 1.0, 0.45),
    );
    draw_debug_plane(
        &mut gizmos,
        min_x,
        max_x,
        min_z,
        max_z,
        bounds.bedrock_floor_y as f32 + 0.03,
        Color::srgba(0.9, 0.9, 0.9, 0.5),
    );
    draw_debug_plane(
        &mut gizmos,
        min_x,
        max_x,
        min_z,
        max_z,
        bounds.kill_y as f32,
        Color::srgba(1.0, 0.05, 0.05, 0.65),
    );
}

fn should_render_world_bounds_debug_planes(
    runtime_debug: Option<&RuntimeViewportDebugState>,
) -> bool {
    runtime_debug.is_some_and(|debug| debug.editor_controlled && debug.chunk_bounds)
}

fn draw_debug_plane(
    gizmos: &mut Gizmos,
    min_x: f32,
    max_x: f32,
    min_z: f32,
    max_z: f32,
    y: f32,
    color: Color,
) {
    let corners = [
        Vec3::new(min_x, y, min_z),
        Vec3::new(max_x, y, min_z),
        Vec3::new(max_x, y, max_z),
        Vec3::new(min_x, y, max_z),
    ];
    for i in 0..4 {
        gizmos.line(corners[i], corners[(i + 1) % 4], color);
    }

    let grid_lines = 8;
    for step in 1..grid_lines {
        let t = step as f32 / grid_lines as f32;
        let x = min_x.lerp(max_x, t);
        let z = min_z.lerp(max_z, t);
        gizmos.line(Vec3::new(x, y, min_z), Vec3::new(x, y, max_z), color);
        gizmos.line(Vec3::new(min_x, y, z), Vec3::new(max_x, y, z), color);
    }
}

fn append_world_bounds_debug(
    text_content: &mut String,
    world: &VoxelWorld,
    player_transform: Option<&Transform>,
    targeted: &TargetedBlock,
) {
    let bounds = world.bounds();
    text_content.push_str(&format!(
        "World Y: min {} bedrock {} breakable {} kill {} max {}\n",
        bounds.min_world_y,
        bounds.bedrock_floor_y,
        bounds.min_breakable_y,
        bounds.kill_y,
        bounds.max_world_y
    ));
    text_content.push_str(&format!(
        "World XZ: x {}..{} z {}..{}\n",
        bounds.horizontal_min.x,
        bounds.horizontal_max.x,
        bounds.horizontal_min.y,
        bounds.horizontal_max.y
    ));

    if let Some(player_transform) = player_transform {
        let validity = classify_player_world_validity(world, player_transform.translation);
        text_content.push_str(&format!("Player validity: {}\n", validity.label()));
        if let Some(reason) = validity.invalid_reason() {
            text_content.push_str(&format!("Player invalid: {}\n", reason));
        }
        let block = IVec3::new(
            player_transform.translation.x.floor() as i32,
            player_transform.translation.y.floor() as i32,
            player_transform.translation.z.floor() as i32,
        );
        text_content.push_str(&format!(
            "Player sample: {}\n",
            describe_voxel_sample(world.sample_voxel_for_interaction(block))
        ));
    }

    if let Some(target_pos) = targeted.position {
        text_content.push_str(&format!(
            "Target sample: {}\n",
            describe_voxel_sample(world.sample_voxel_for_interaction(target_pos))
        ));
    }
}

fn describe_voxel_sample(sample: VoxelSample) -> String {
    match sample {
        VoxelSample::InBounds(voxel) => format!("InBounds({voxel:?})"),
        VoxelSample::OutsideBelowWorld => "OutsideBelowWorld".to_string(),
        VoxelSample::OutsideAboveWorld => "OutsideAboveWorld".to_string(),
        VoxelSample::OutsideHorizontalWorld => "OutsideHorizontalWorld".to_string(),
        VoxelSample::MissingChunkInsideBounds => "MissingChunkInsideBounds".to_string(),
    }
}

/// Convert a block face normal (IVec3) to a Face enum.
fn normal_to_face(normal: IVec3) -> Face {
    if normal.y > 0 {
        Face::Top
    } else if normal.y < 0 {
        Face::Bottom
    } else if normal.z > 0 {
        Face::South
    } else if normal.z < 0 {
        Face::North
    } else if normal.x > 0 {
        Face::East
    } else {
        Face::West
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

struct PropFadeInfo {
    count: usize,
    base_alpha: f32,
    current_alpha: f32,
    min_alpha_scale: f32,
    distance_scale: f32,
}

fn collect_prop_fade_info(
    root: Entity,
    children_query: &Query<&Children>,
    fade_query: &Query<&FoliageFade>,
) -> Option<PropFadeInfo> {
    let mut stack = vec![root];
    let mut count = 0usize;
    let mut sample: Option<PropFadeInfo> = None;

    while let Some(entity) = stack.pop() {
        if let Ok(fade) = fade_query.get(entity) {
            count += 1;
            if sample.is_none() {
                sample = Some(PropFadeInfo {
                    count: 0,
                    base_alpha: fade.base_alpha,
                    current_alpha: fade.current_alpha,
                    min_alpha_scale: fade.min_alpha_scale,
                    distance_scale: fade.distance_scale,
                });
            }
        }

        if let Ok(children) = children_query.get(entity) {
            stack.extend(children.iter());
        }
    }

    sample.map(|mut info| {
        info.count = count;
        info
    })
}

fn is_grass_like_prop(prop_id: &str) -> bool {
    let id = prop_id.to_lowercase();
    id.contains("grass") || id.contains("fern") || id.contains("shrub")
}

/// Append chunk statistics debug info to text content.
fn append_chunk_stats_debug(
    text_content: &mut String,
    stats: &RuntimeChunkStats,
    lod_frozen: bool,
) {
    text_content.push_str("\n[Chunk Statistics]\n");
    if lod_frozen {
        text_content.push_str("LOD: FROZEN (Alt+F6) - move freely to inspect; LODs held\n");
    }

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
        text_content.push_str(&format!(
            "Vertices: {}K total (hi:{}K lo:{}K)\n",
            stats.total_vertices / 1000,
            stats.high_lod_vertices / 1000,
            stats.low_lod_vertices / 1000,
        ));

        // Show per-chunk averages to verify LOD reduction
        let hi_avg = stats.avg_high_lod_vertices();
        let lo_avg = stats.avg_low_lod_vertices();
        let reduction = (1.0 - stats.lod_reduction_ratio()) * 100.0;
        text_content.push_str(&format!(
            "  Avg/chunk: hi={} lo={} ({:.0}% reduction)\n",
            hi_avg, lo_avg, reduction
        ));
    }

    // Per-frame stats
    if stats.chunks_meshed_this_frame > 0
        || stats.chunks_skipped_this_frame > 0
        || stats.chunks_skipped_page_owned > 0
    {
        let mesh_time_ms = stats.meshing_time_us as f64 / 1000.0;
        text_content.push_str(&format!(
            "This frame: {} meshed, {} skipped, {} page-owned ({:.1}ms)\n",
            stats.chunks_meshed_this_frame,
            stats.chunks_skipped_this_frame,
            stats.chunks_skipped_page_owned,
            mesh_time_ms
        ));
    }
}

/// Append performance debug info to text content.
fn append_performance_debug(
    text_content: &mut String,
    diagnostics: &DiagnosticsStore,
    perf: &PerformanceMetrics,
    chunk_stats: &RuntimeChunkStats,
    prop_cull: &PropChunkCullState,
    system_monitor: &SystemPerformanceMonitor,
    graphics: Option<&GraphicsCapabilities>,
    show_timing_breakdown: bool,
    timing_recorder: &AreaTimingRecorder,
    timing_capture: &AreaTimingCapture,
    fog_quality: Option<&FogQuality>,
    fog_runtime: Option<&VolumetricFogRuntimeState>,
) {
    text_content.push_str("\n[Performance]\n");

    // Frame timing - use smoothed() for stable display, value() for instant
    let frame_time = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FRAME_TIME)
        .and_then(|d| d.smoothed())
        .unwrap_or(0.0);

    let fps = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FPS)
        .and_then(|d| d.smoothed())
        .unwrap_or(0.0);

    text_content.push_str(&format!("Frame: {:.2}ms ({:.0} FPS)\n", frame_time, fps));

    // Frame time range from history
    let min_time = perf.min_frame_time();
    let max_time = perf.max_frame_time();
    let avg_time = perf.avg_frame_time();
    if min_time < f64::MAX && max_time > 0.0 {
        text_content.push_str(&format!(
            "  Range: {:.1}ms - {:.1}ms (avg: {:.1}ms)\n",
            min_time, max_time, avg_time
        ));
    }

    // Frame budget analysis
    let target_60fps = 16.67;
    let target_30fps = 33.33;
    let budget_used = (frame_time / target_60fps) * 100.0;
    let budget_indicator = if frame_time < target_60fps {
        "OK"
    } else if frame_time < target_30fps {
        "WARN"
    } else {
        "SLOW"
    };
    text_content.push_str(&format!(
        "  Budget: {:.0}% of 16.7ms [{}]\n",
        budget_used, budget_indicator
    ));

    // CPU/Memory from SystemInformationDiagnosticsPlugin
    let cpu_usage = diagnostics
        .get(&SystemInformationDiagnosticsPlugin::SYSTEM_CPU_USAGE)
        .and_then(|d| d.value())
        .map(|v| format!("{:.1}%", v))
        .or_else(|| system_monitor.cpu_usage.map(|v| format!("{:.1}%", v)))
        .unwrap_or_else(|| "N/A".to_string());

    let mem_usage = diagnostics
        .get(&SystemInformationDiagnosticsPlugin::SYSTEM_MEM_USAGE)
        .and_then(|d| d.value())
        .map(|v| format!("{:.1} GB", v / (1024.0 * 1024.0 * 1024.0)))
        .or_else(|| {
            system_monitor
                .mem_used_mb
                .map(|v| format!("{:.1} GB", v as f64 / 1024.0))
        })
        .unwrap_or_else(|| "N/A".to_string());

    let cpu_label = if system_monitor.cpu_cores > 0 {
        format!("{} ({} cores)", cpu_usage, system_monitor.cpu_cores)
    } else {
        cpu_usage
    };
    text_content.push_str(&format!("CPU: {}  RAM: {}\n", cpu_label, mem_usage));
    if !system_monitor.cpu_core_usages.is_empty() {
        let cores: Vec<String> = system_monitor
            .cpu_core_usages
            .iter()
            .map(|v| format!("{:.0}%", v))
            .collect();
        text_content.push_str(&format!("CPU Cores: {}\n", cores.join(", ")));
    }
    let gpu_name = graphics
        .and_then(|capabilities| capabilities.adapter_name.as_deref())
        .unwrap_or("N/A");
    let gpu_type = graphics
        .map(|capabilities| {
            if capabilities.integrated_gpu {
                "Integrated"
            } else {
                "Discrete"
            }
        })
        .unwrap_or("Unknown");
    text_content.push_str(&format!("GPU: {} ({})\n", gpu_name, gpu_type));
    let trace_status = if timing_capture.active { "REC" } else { "OFF" };
    text_content.push_str(&format!("Trace: {}\n", trace_status));
    if let Some(path) = timing_capture.last_output.as_deref() {
        text_content.push_str(&format!("Trace file: {}\n", path));
    }
    if let Some(quality) = fog_quality {
        let mode = if quality.user_override {
            "user"
        } else {
            "auto"
        };
        text_content.push_str(&format!("Fog tier: {} ({})\n", quality.tier.label(), mode));
    }
    if let Some(runtime) = fog_runtime {
        text_content.push_str(&format!(
            "VolumetricFog: {} ({})\n",
            if runtime.active { "ON" } else { "OFF" },
            runtime.reason.label()
        ));
    }

    // Entity count from diagnostic
    let entity_count = diagnostics
        .get(&EntityCountDiagnosticsPlugin::ENTITY_COUNT)
        .and_then(|d| d.value())
        .map(|v| format!("{:.0}", v))
        .unwrap_or_else(|| "N/A".to_string());
    text_content.push_str(&format!("Entities: {}\n", entity_count));

    // Prop culling stats
    let total_props = prop_cull.visible_count + prop_cull.culled_count;
    if total_props > 0 {
        let cull_percent = (prop_cull.culled_count as f32 / total_props as f32) * 100.0;
        text_content.push_str(&format!(
            "Props: {} visible, {} culled ({:.0}% culled)\n",
            prop_cull.visible_count, prop_cull.culled_count, cull_percent
        ));
        text_content.push_str(&format!(
            "Prop Chunks: {} visible\n",
            prop_cull.visible_chunks.len()
        ));
    }

    // Estimated draw calls (mesh entities are roughly 1 draw call each)
    let estimated_draws = chunk_stats.mesh_entities + chunk_stats.water_mesh_entities;
    let prop_draws = prop_cull.visible_count; // Each visible prop is ~1 draw call
    text_content.push_str(&format!(
        "Est. Draw Calls: ~{} (chunks) + ~{} (props)\n",
        estimated_draws, prop_draws
    ));

    // Meshing time from chunk stats
    if chunk_stats.meshing_time_us > 0 {
        let mesh_time_ms = chunk_stats.meshing_time_us as f64 / 1000.0;
        text_content.push_str(&format!("Meshing: {:.2}ms\n", mesh_time_ms));
    }

    // Custom tracked timings (if instrumented)
    if perf.total_tracked_time_us > 0 {
        text_content.push_str("\n[System Timing]\n");
        if perf.physics_time_us > 0 {
            text_content.push_str(&format!(
                "  Physics: {:.2}ms\n",
                perf.physics_time_us as f64 / 1000.0
            ));
        }
        if perf.visibility_time_us > 0 {
            text_content.push_str(&format!(
                "  Visibility: {:.2}ms\n",
                perf.visibility_time_us as f64 / 1000.0
            ));
        }
        if perf.transform_time_us > 0 {
            text_content.push_str(&format!(
                "  Transforms: {:.2}ms\n",
                perf.transform_time_us as f64 / 1000.0
            ));
        }
        if perf.prop_update_time_us > 0 {
            text_content.push_str(&format!(
                "  Props: {:.2}ms\n",
                perf.prop_update_time_us as f64 / 1000.0
            ));
        }
    }

    if show_timing_breakdown {
        text_content.push_str("\n[Area Timings]\n");
        let summaries = timing_recorder.rolling_summaries();
        if summaries.is_empty() {
            text_content.push_str("  (no data)\n");
        } else {
            for summary in summaries.iter().take(12) {
                let unit = if summary.unit == "count" { "ct" } else { "ms" };
                text_content.push_str(&format!(
                    "  {}: avg {:.2}{} max {:.2}{} calls {:.1}\n",
                    summary.area,
                    summary.avg_ms,
                    unit,
                    summary.max_ms,
                    unit,
                    summary.calls_per_frame,
                ));
            }
        }
    }

    // Bottleneck analysis hint
    text_content.push_str("\n[Bottleneck Hints]\n");
    if estimated_draws > 1000 {
        text_content.push_str("  ! High draw calls - consider instancing\n");
    }
    if frame_time > target_60fps && budget_used > 100.0 {
        let gpu_bound_hint = if chunk_stats.total_vertices > 500_000 {
            "  ! High vertex count - may be GPU bound\n"
        } else {
            "  ! Likely CPU bound (ECS/draw calls)\n"
        };
        text_content.push_str(gpu_bound_hint);
    }
}

fn append_area_timing_table(
    text_content: &mut String,
    diagnostics: &DiagnosticsStore,
    timing_recorder: &AreaTimingRecorder,
) {
    let cpu_frame_ms = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FRAME_TIME)
        .and_then(|d| d.smoothed())
        .unwrap_or(0.0);

    text_content.push_str(&format!("CPU frame: {:.2}ms\n", cpu_frame_ms));
    text_content.push_str("\n[Frame Areas - 60f avg]\n");
    text_content.push_str("Area                 Avg     Max     p99    Calls Unit\n");

    let summaries = timing_recorder.rolling_summaries();
    if summaries.is_empty() {
        text_content.push_str("(collecting)\n");
        return;
    }

    for summary in summaries.iter().take(12) {
        let unit = if summary.unit == "count" { "ct" } else { "ms" };
        text_content.push_str(&format!(
            "{:<20} {:>6.2} {:>7.2} {:>7.2} {:>6.1} {}\n",
            summary.area,
            summary.avg_ms,
            summary.max_ms,
            summary.p99_ms,
            summary.calls_per_frame,
            unit,
        ));
    }

    let mut append_summary_row = |label: &str, summary: &crate::performance::AreaTimingSummary| {
        text_content.push_str(&format!(
            "{:<20} {:>6.2} {:>7.2} {:>7.2} {:>6.1}\n",
            label, summary.avg_ms, summary.max_ms, summary.p99_ms, summary.calls_per_frame,
        ));
    };

    if let Some(frame_total) = timing_recorder.frame_total_summary() {
        append_summary_row("Frame wall", &frame_total);
    }
    if let Some(tracked_total) = timing_recorder.tracked_area_total_summary() {
        append_summary_row("Tracked areas", &tracked_total);
    }
    if let Some(untracked_wall) = timing_recorder.untracked_wall_time_summary() {
        append_summary_row("Untracked wall", &untracked_wall);
    }
}

fn append_reflection_status(text_content: &mut String, status: Option<&WaterReflectionStatus>) {
    let Some(status) = status else {
        text_content.push_str("Reflection: OFF (disabled) scale 0.00 hz 0\n");
        return;
    };
    text_content.push_str(&format!(
        "Reflection: {} ({}) scale {:.2} hz {:.0}\n",
        if status.active { "ON" } else { "OFF" },
        status.reason.as_str(),
        status.resolution_scale,
        status.effective_hz,
    ));
}

fn append_reflection_mask_status(
    text_content: &mut String,
    stats: Option<&WaterReflectionMaskStats>,
) {
    let Some(stats) = stats else {
        return;
    };
    text_content.push_str(&format!(
        "Reflection Mask Estimate: px {} bodies {} applied {}\n",
        stats.estimated_mask_pixels, stats.mask_bodies, stats.estimated_applied_pixels,
    ));
    text_content.push_str(&format!(
        "Reflection Skip: no_mask {} disabled {} far {}\n",
        stats.estimated_skipped_no_mask_pixels,
        stats.estimated_skipped_disabled_pixels,
        stats.estimated_skipped_too_far_pixels,
    ));
}

fn append_water_visual_debug(text_content: &mut String, state: Option<&WaterVisualDebugState>) {
    let Some(state) = state else {
        return;
    };
    text_content.push_str(&format!(
        "Water Debug: mat near {} far {} depth {} tris {}\n",
        u8::from(state.nearest_material_near),
        u8::from(state.nearest_material_far),
        state.nearest_max_depth,
        state.nearest_triangles,
    ));
    text_content.push_str(&format!(
        "Water Debug: refl eligible {} active {} compositor {} body_unknown {}\n",
        u8::from(state.reflection_eligible),
        u8::from(state.reflection_active),
        u8::from(state.compositor_pixel_matched),
        u8::from(state.body_unknown),
    ));
}

fn append_water_body_status(text_content: &mut String, registry: Option<&WaterBodyRegistry>) {
    let Some(registry) = registry else {
        return;
    };
    text_content.push_str(&format!(
        "Water Bodies: {} ocean {} lake {} river {} pond {} shallow_flood {}\n",
        registry.total,
        registry.ocean,
        registry.lake,
        registry.river,
        registry.pond,
        registry.shallow_flood,
    ));
    text_content.push_str(&format!(
        "Water Body LOD: fancy {} cheap {} switches {} forced {}\n",
        registry.fancy_count,
        registry.cheap_count,
        registry.material_switches,
        registry.chunks_forced_consistent,
    ));
    let mut bodies: Vec<_> = registry.bodies.values().collect();
    bodies.sort_by(|a, b| a.nearest_distance.total_cmp(&b.nearest_distance));
    for body in bodies
        .into_iter()
        .filter(|body| body.visible_chunks > 0)
        .take(5)
    {
        text_content.push_str(&format!(
            "Water Body {}: {} {} area {:.0} depth {}/avg {:.1} chunks {} dist {:.1} refl {:.2}\n",
            body.id.0,
            body.kind.as_str(),
            body.material_mode.as_str(),
            body.surface_area,
            body.max_depth,
            body.average_depth,
            body.chunk_count,
            body.nearest_distance,
            body.reflection_strength,
        ));
    }
}

fn append_enclosure_status(
    text_content: &mut String,
    enclosure: &EnclosureState,
    config: &OcclusionConfig,
    visible_chunks: &VisibleChunks,
    stats: &EnclosureOcclusionStats,
) {
    let mode = match enclosure.mode {
        EnclosureMode::Open => "Open",
        EnclosureMode::Enclosed => "Enclosed",
    };
    let suffix = if config.force_disabled {
        " force-off"
    } else {
        ""
    };
    text_content.push_str(&format!(
        "Enclosure: {} ({:.1}s{})\n",
        mode, enclosure.held_secs, suffix
    ));
    text_content.push_str(&format!(
        "Culled chunks: {} / {}\n",
        stats.hidden_chunks, stats.total_chunks
    ));
    text_content.push_str(&format!(
        "Occlusion BFS: {} visited, {} us, depth {}, overflow {}\n",
        visible_chunks.last_visited_count,
        visible_chunks.last_bfs_duration_micros,
        visible_chunks.last_depth_budget,
        if visible_chunks.last_overflow {
            "YES"
        } else {
            "NO"
        }
    ));
    text_content.push_str(&format!(
        "Culled props: {} / {}\n",
        stats.hidden_props, stats.total_props
    ));
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
    timing_capture: &AreaTimingCapture,
    prop_bounds_debug_enabled: bool,
) {
    text_content.push_str("\n[Alt+F7] Terrain wireframe debug");
    text_content.push_str("\n[Alt+F8] Terrain normal debug");
    text_content.push_str("\n[Alt+F9] Terrain iso-band debug");
    text_content.push_str("\n[Alt+F10] Terrain flat-unlit debug");
    text_content.push_str("\n[Alt+Shift+F7] Capture terrain debug frame");
    text_content.push_str("\n[F3] Toggle overlay");
    text_content.push_str("\n[F4] Dump performance CSV");
    text_content.push_str("\n[Shift+F4] Game Tweaks");
    text_content.push_str("\n[F11] Cycle voxel ray backend");
    text_content.push_str("\n[Shift+F11] Toggle enclosure culling");
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
    text_content.push_str(&format!(
        "\n[Alt+P] Prop debug: {}",
        if toggles.show_prop_details {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[Alt+B] Prop bounds debug: {}",
        if prop_bounds_debug_enabled {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[Alt+F] Performance: {}",
        if toggles.show_performance {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[Alt+Shift+T] Area timings: {}",
        if toggles.show_timing_breakdown {
            "ON"
        } else {
            "OFF"
        }
    ));
    text_content.push_str(&format!(
        "\n[Alt+Shift+R] Timing trace: {}",
        if timing_capture.active { "REC" } else { "OFF" }
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_bounds_debug_planes_are_hidden_in_normal_play_mode() {
        assert!(!should_render_world_bounds_debug_planes(None));
        assert!(!should_render_world_bounds_debug_planes(Some(
            &RuntimeViewportDebugState::default()
        )));
    }

    #[test]
    fn world_bounds_debug_planes_follow_editor_chunk_bounds_toggle() {
        let mut debug_state = RuntimeViewportDebugState {
            editor_controlled: true,
            ..default()
        };
        assert!(should_render_world_bounds_debug_planes(Some(&debug_state)));

        debug_state.chunk_bounds = false;
        assert!(!should_render_world_bounds_debug_planes(Some(&debug_state)));
    }
}
