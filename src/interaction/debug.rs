//! Debug overlay systems for block inspection and game state visualization.
//!
//! This module provides:
//! - F3 toggle for the debug overlay
//! - G key for detailed block logging
//! - Various toggle keys for specific debug information

use bevy::diagnostic::{
    DiagnosticsStore, EntityCountDiagnosticsPlugin, FrameTimeDiagnosticsPlugin,
    SystemInformationDiagnosticsPlugin,
};
use std::time::Instant;
use bevy::ecs::system::SystemParam;
use bevy::prelude::*;
use crate::interaction::editing::{EditMode, DeleteMode, DragState};
use crate::interaction::targeting::TargetedBlock;
use crate::interaction::TargetedProp;
use crate::network::NetworkSession;
use crate::props::{Prop, PropChunkCullState};
use crate::props::foliage::{FoliageFade, FoliageFadeSettings, GrassPropWind};
use crate::performance::{AreaTimingCapture, AreaTimingRecorder, start_area_trace, stop_area_trace};
use crate::rendering::capabilities::GraphicsCapabilities;
use crate::vegetation::{ProceduralGrassPatch, FloatingParticle};
use crate::voxel::meshing::{ChunkMesh, MeshSettings};
use crate::voxel::plugin::{ChunkGenerationState, RuntimeChunkStats};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::VoxelWorld;
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
}

#[derive(SystemParam)]
pub struct PropDebugQuery<'w, 's> {
    pub fade_settings: Option<Res<'w, FoliageFadeSettings>>,
    pub props: Query<'w, 's, (&'static Prop, Option<&'static GrassPropWind>)>,
    pub children: Query<'w, 's, &'static Children>,
    pub fades: Query<'w, 's, &'static FoliageFade>,
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
        self.frame_times_ms
            .iter()
            .copied()
            .fold(0.0, f64::max)
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
pub fn update_system_monitor(mut monitor: ResMut<SystemPerformanceMonitor>, time: Res<Time>) {
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
        timing_recorder.set_enabled(toggles.show_timing_breakdown || timing_capture.active);
    }

    if alt_held && shift_held && keyboard.just_pressed(KeyCode::KeyR) {
        if timing_capture.active {
            let _ = stop_area_trace(&mut timing_capture);
        } else {
            start_area_trace(&mut timing_capture);
        }
        timing_recorder.set_enabled(toggles.show_timing_breakdown || timing_capture.active);
    }

    
    // Volumetric fog toggle (Alt+L "Light")
    if alt_held && keyboard.just_pressed(KeyCode::KeyL) {
        toggles.volumetric_fog_enabled = !toggles.volumetric_fog_enabled;
        info!("Debug toggle: Volumetric Fog = {}", if toggles.volumetric_fog_enabled { "ON" } else { "OFF" });
    }
}

/// Toggle mesh mode with F5 key (Blocky <-> SurfaceNets).
///
/// Marks all chunks dirty to trigger re-meshing with the new mode.
pub fn toggle_mesh_mode(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut mesh_settings: ResMut<MeshSettings>,
    mut world: ResMut<crate::voxel::world::VoxelWorld>,
) {
    if keyboard.just_pressed(KeyCode::F5) {
        mesh_settings.mode.toggle();
        // Mark all chunks dirty to trigger re-meshing
        for chunk_pos in world.all_chunk_positions().collect::<Vec<_>>() {
            if let Some(chunk) = world.get_chunk_mut(chunk_pos) {
                chunk.mark_dirty();
            }
        }
        info!("Mesh mode: {:?} (F5 to toggle)", mesh_settings.mode);
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
    camera_query: Query<&Transform, With<crate::camera::controller::PlayerCamera>>,
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
        debug.perf_metrics.record_frame_time(frame_time * 1000.0); // Convert to ms
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
        if let Some(entity) = targeted_prop.entity {
            if let Ok((prop, wind)) = prop_debug.props.get(entity) {
                text_content.push_str(&format!("Prop: {} ({:?})\n", prop.id, prop.prop_type));
                text_content.push_str(&format!("Distance: {:.2}\n", targeted_prop.distance));
                text_content.push_str(&format!(
                    "Grass-like: {}\n",
                    if is_grass_like_prop(&prop.id) { "YES" } else { "NO" }
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
        append_chunk_stats_debug(&mut text_content, &chunk_stats);
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
        );
    }

    append_control_hints(
        &mut text_content,
        &edit_mode,
        &delete_mode,
        &drag_state,
        &debug.toggles,
        &debug.timing_capture,
    );

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
    if stats.chunks_meshed_this_frame > 0 || stats.chunks_skipped_this_frame > 0 {
        let mesh_time_ms = stats.meshing_time_us as f64 / 1000.0;
        text_content.push_str(&format!(
            "This frame: {} meshed, {} skipped ({:.1}ms)\n",
            stats.chunks_meshed_this_frame, stats.chunks_skipped_this_frame, mesh_time_ms
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
) {
    text_content.push_str("\n[Performance]\n");

    // Frame timing - use smoothed() for stable display, value() for instant
    let frame_time = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FRAME_TIME)
        .and_then(|d| d.smoothed())
        .map(|v| v * 1000.0) // Convert to ms
        .unwrap_or(0.0);

    let fps = diagnostics
        .get(&FrameTimeDiagnosticsPlugin::FPS)
        .and_then(|d| d.smoothed())
        .unwrap_or(0.0);

    text_content.push_str(&format!(
        "Frame: {:.2}ms ({:.0} FPS)\n",
        frame_time, fps
    ));

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
        .or_else(|| {
            system_monitor
                .cpu_usage
                .map(|v| format!("{:.1}%", v))
        })
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
        if timing_recorder.areas().is_empty() {
            text_content.push_str("  (no data)\n");
        } else {
            for (area, us) in timing_recorder.areas() {
                text_content.push_str(&format!("  {}: {:.2}ms\n", area, *us as f64 / 1000.0));
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
    text_content.push_str(&format!(
        "\n[Alt+P] Prop debug: {}",
        if toggles.show_prop_details {
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
