pub mod cli;
pub mod config;
pub mod plugin;
pub mod scene;

use crate::atmosphere::{FogQuality, FogQualityTier};
use crate::camera::controller::{CameraMode, PlayerCamera};
use crate::environment::AtmosphereSettings;
use crate::input::config::GameAction;
use crate::input::manager::ActionState;
use crate::interaction::{DebugDetailToggles, TargetedBlock, palette::PlacementPaletteState};
use crate::inventory_ui::{InventoryCategory, InventoryUiBenchControl, InventoryUiState};
use crate::map::MapState;
use crate::menu::{PauseMenuState, SettingsState, VisualSettings};
use crate::performance::{AreaTimingRecorder, write_area_timing_csv};
use crate::physics::{ChunkCollider, NeedsCollider, TerrainCollisionCache};
use crate::player::{
    Player, SpawnColliderReadiness, can_player_enter_ground_column, classify_player_world_validity,
    find_surface_spawn,
};
use crate::props::instanced_render::{InstancedPropGroup, PropInstanceGroups};
use crate::props::instancing::PropMeshCache;
use crate::props::persistence::PropPersistenceState;
use crate::props::{Prop, PropAssets};
use crate::rendering::building_material::BuildingMesh;
use crate::rendering::cinematic_config::CinematicConfig;
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::ray_tracing::{
    ExperimentalRenderMode, RayTracingSettings, VoxelRayBackendMode,
};
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::rendering::water_reflection::WaterReflectionConfig;
use crate::runtime_commands::{FrontendRenderFeatureFlag, set_render_feature_flag};
use crate::voxel::diagnostics::seam_audit_pass::{
    TerrainSeamAuditRequest, TerrainSeamAuditRequests,
};
use crate::voxel::hole_probe::{TerrainHoleProbeRequest, TerrainHoleProbeRequests};
use crate::voxel::meshing::{ChunkMesh, WaterMesh};
use crate::voxel::persistence::{self, WorldPersistence};
use crate::voxel::plugin::{RuntimeChunkStats, TerrainLodControl, WorldConfig};
use crate::voxel::types::{Voxel, VoxelType};
use crate::voxel::world::{VoxelEditResult, VoxelSample, VoxelWorld, WorldBounds};
use avian3d::prelude::{LinearVelocity, Position};
use bevy::app::AppExit;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::RenderApp;
use bevy::render::view::screenshot::{Screenshot, save_to_disk};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const SETTLE_FRAMES: u32 = 60;
const READY_STABLE_FRAMES: u32 = 90;
const READY_MIN_SECS: f32 = 10.0;
const READY_TIMEOUT_SECS: f32 = 75.0;
const RENDER_READY_STABLE_FRAMES: u32 = 45;
const RENDER_READY_MIN_FRAMES: u32 = 90;
const RENDER_READY_TIMEOUT_SECS: f32 = 30.0;
const GAMEPLAY_FALL_FAILURE_FRAMES: u32 = 6;
const SCREENSHOT_WAIT_FRAMES: u32 = 240;
const SCREENSHOT_WAIT_MIN_SECS: f32 = 5.0;
const SCREENSHOT_WAIT_MAX_SECS: f32 = 120.0;
const INVENTORY_SCREENSHOT_CATEGORY_LEAD_FRAMES: u32 = 4;
const BENCH_BORDER_TURN_MIN_DIRECTION: f32 = 0.05;
const BENCH_PATH_SAMPLE_DISTANCES: [f32; 4] = [3.0, 6.0, 12.0, 20.0];
const BENCH_PATH_SAMPLE_ANGLES_DEGREES: [f32; 7] = [0.0, 35.0, -35.0, 70.0, -70.0, 90.0, -90.0];
const BENCH_PATH_MAX_STEP_UP: f32 = 2.25;
const BENCH_PATH_MAX_DROP: f32 = 5.0;
const BENCH_PATH_COLLIDER_PENALTY: f32 = 25.0;
const BENCH_PATH_HEIGHT_PENALTY: f32 = 3.0;
const BENCH_RAY_PROBE_MAX_DISTANCE: f32 = 512.0;
const BENCH_RAY_PROBE_STEP: f32 = 0.1;

#[derive(Parser, Debug, Clone)]
#[command(author, version, about)]
pub struct BenchCli {
    #[arg(long)]
    pub bench: Option<PathBuf>,
    #[arg(long)]
    pub bench_out: Option<PathBuf>,
    #[arg(long)]
    pub bench_headless: bool,
    #[arg(long)]
    pub editor_runtime: bool,
    #[arg(long)]
    pub editor_native_viewport: bool,
}

#[derive(Resource, Clone)]
pub struct BenchConfig {
    pub scene_path: PathBuf,
    pub output_dir: PathBuf,
    pub headless: bool,
}

impl BenchConfig {
    pub fn from_cli(cli: &BenchCli) -> Option<Self> {
        let scene_path = resolve_bench_scene_path(cli.bench.as_ref()?);
        let output_dir = cli.bench_out.clone().unwrap_or_else(default_output_dir);
        Some(Self {
            scene_path,
            output_dir,
            headless: cli.bench_headless,
        })
    }
}

fn resolve_bench_scene_path(requested: &Path) -> PathBuf {
    if requested.exists() {
        return requested.to_path_buf();
    }

    let Some(file_name) = requested.file_name() else {
        return requested.to_path_buf();
    };

    let scenes_root = Path::new("bench").join("scenes");

    let direct = scenes_root.join(file_name);
    if direct.exists() {
        return direct;
    }

    let mut dirs = vec![scenes_root];
    while let Some(dir) = dirs.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                dirs.push(path);
                continue;
            }

            if path.file_name() == Some(file_name) {
                return path;
            }
        }
    }

    requested.to_path_buf()
}

#[derive(Resource)]
struct BenchSceneResource(BenchScene);

#[derive(Resource, Clone, Debug, Default, Deserialize, Serialize)]
pub struct BenchRenderToggles {
    #[serde(default)]
    pub disable_instanced_props: bool,
    #[serde(default)]
    pub disable_terrain_meshes: bool,
    #[serde(default)]
    pub disable_water_meshes: bool,
    #[serde(default)]
    pub disable_buildings: bool,
    #[serde(default)]
    pub disable_shadows: bool,
    #[serde(default)]
    pub disable_reflection_cameras: bool,
    #[serde(default)]
    pub force_instanced_props_transparent: bool,
    #[serde(default)]
    pub force_cutout_props_alpha_mask: bool,
    #[serde(default)]
    pub force_instanced_props_opaque: bool,
    #[serde(default)]
    pub disable_prop_lod_hiding: bool,
    #[serde(default)]
    pub disable_prop_shadow_lod: bool,
    #[serde(default)]
    pub terrain_material_quality: BenchTerrainMaterialQuality,
    #[serde(default)]
    pub terrain_hex_tiling: Option<bool>,
    #[serde(default)]
    pub terrain_hex_tiling_normal: Option<bool>,
    #[serde(default)]
    pub disable_terrain_material_lod: bool,
    #[serde(default)]
    pub prop_subcluster_grid: u8,
    #[serde(default)]
    pub quality_preset: Option<RenderQualityPreset>,
    #[serde(default)]
    pub voxel_ray_backend: Option<String>,
    #[serde(default)]
    pub experimental_render_mode: Option<String>,
    #[serde(default)]
    pub naadf_force_cpu_builder: Option<bool>,
    #[serde(default)]
    pub naadf_force_gpu_builder: Option<bool>,
    #[serde(default)]
    pub naadf_max_chunk_updates_per_frame: Option<u32>,
    #[serde(default)]
    pub naadf_radius_chunks: Option<i32>,
    #[serde(default)]
    pub naadf_max_chunks: Option<u32>,
    #[serde(default)]
    pub naadf_max_gpu_memory_mb: Option<u32>,
    #[serde(default)]
    pub naadf_max_upload_bytes_per_frame: Option<u32>,
    #[serde(default)]
    pub naadf_history_resolution_scale: Option<f32>,
    #[serde(default)]
    pub naadf_preview_max_ray_steps: Option<u32>,
    #[serde(default)]
    pub naadf_preview_bounce_count: Option<u32>,
    #[serde(default)]
    pub naadf_preview_spatial_radius: Option<u32>,
    #[serde(default)]
    pub naadf_preview_composite_mode: Option<String>,
    #[serde(default)]
    pub naadf_preview_show_miss_sky: Option<bool>,
    #[serde(default)]
    pub naadf_path_b_compositor_mode: Option<String>,
    #[serde(default)]
    pub naadf_path_b_foundation_200_210_verified: Option<bool>,
    #[serde(default)]
    pub naadf_path_b_depth_epsilon: Option<f32>,
    #[serde(default)]
    pub naadf_path_b_enable_temporal: Option<bool>,
    #[serde(default)]
    pub naadf_path_b_counters_enabled: Option<bool>,
    #[serde(default)]
    pub naadf_preview_local_lights_enabled: Option<bool>,
    #[serde(default)]
    pub naadf_preview_local_light_limit: Option<u32>,
    #[serde(default)]
    pub naadf_preview_local_light_shadows_enabled: Option<bool>,
    #[serde(default)]
    pub naadf_spawn_demo_lights: bool,
    #[serde(default)]
    pub naadf_use_for_gi_secondary: Option<bool>,
    #[serde(default)]
    pub naadf_use_for_sun_visibility: Option<bool>,
    #[serde(default)]
    pub naadf_froxel_sun_mask_enabled: Option<bool>,
    #[serde(default)]
    pub naadf_use_for_terrain_ao: Option<bool>,
    #[serde(default)]
    pub naadf_use_for_contact_shadows: Option<bool>,
}

#[derive(Resource, Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct BenchForensicsConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub terrain_mesher: BenchForensicsTerrainMesher,
    #[serde(default)]
    pub mc_transitions: BenchForensicsMcTransitions,
}

impl Default for BenchForensicsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            terrain_mesher: BenchForensicsTerrainMesher::Auto,
            mc_transitions: BenchForensicsMcTransitions::Enabled,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BenchForensicsTerrainMesher {
    #[default]
    Auto,
    SurfaceNets,
    McTransvoxel,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BenchForensicsMcTransitions {
    #[default]
    Enabled,
    DisabledKeepBoundaryRows,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
struct StartupTraceConfig {
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_true")]
    capture_csv: bool,
    #[serde(default = "default_startup_trace_max_phase_frames")]
    max_phase_frames: u32,
}

impl Default for StartupTraceConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            capture_csv: true,
            max_phase_frames: default_startup_trace_max_phase_frames(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BenchTerrainMaterialQuality {
    #[default]
    Auto,
    FullTriplanar,
    CheapTriplanar,
    SingleProjectionFar,
    AtlasOnlyDebug,
    WireframeDebug,
}

impl BenchTerrainMaterialQuality {
    pub fn forced_quality(self) -> Option<TerrainMaterialQuality> {
        match self {
            BenchTerrainMaterialQuality::Auto => None,
            BenchTerrainMaterialQuality::FullTriplanar => {
                Some(TerrainMaterialQuality::FullTriplanar)
            }
            BenchTerrainMaterialQuality::CheapTriplanar => {
                Some(TerrainMaterialQuality::CheapTriplanar)
            }
            BenchTerrainMaterialQuality::SingleProjectionFar => {
                Some(TerrainMaterialQuality::SingleProjectionFar)
            }
            BenchTerrainMaterialQuality::AtlasOnlyDebug => {
                Some(TerrainMaterialQuality::AtlasOnlyDebug)
            }
            BenchTerrainMaterialQuality::WireframeDebug => {
                Some(TerrainMaterialQuality::WireframeDebug)
            }
        }
    }
}

#[derive(Resource)]
struct BenchState {
    phase: BenchPhase,
    checkpoint_index: usize,
    run_index: u32,
    warmup_started: Option<Instant>,
    ready_started: Option<Instant>,
    ready_stable_frames: u32,
    ready_wait_frames: u32,
    ready_last_signature: Option<BenchReadySignature>,
    render_ready_started: Option<Instant>,
    render_ready_wait_frames: u32,
    render_ready_stable_frames: u32,
    render_ready_last_signature: Option<BenchRenderReadySignature>,
    last_ready_wait_frames: u32,
    last_ready_wait_secs: f32,
    last_ready_stable_frames: u32,
    last_ready_snapshot: BenchReadySnapshot,
    last_ready_timed_out: bool,
    last_render_ready_wait_frames: u32,
    last_render_ready_secs: f32,
    last_render_ready_stable_frames: u32,
    last_render_ready_signature: Option<BenchRenderReadySignature>,
    last_render_ready_timed_out: bool,
    settle_frames_left: u32,
    hold_frames_left: u32,
    screenshot_wait_left: u32,
    screenshot_wait_started: Option<Instant>,
    hold_elapsed_frames: u32,
    next_screenshot_point: usize,
    current_screenshots: Vec<ScreenshotRecord>,
    current_run: Option<RunRecord>,
    startup_trace: Option<StartupTraceRunBuilder>,
    gameplay_stall_frames: u32,
    gameplay_stall_events: u32,
    gameplay_min_horizontal_speed: f32,
    gameplay_min_y: f32,
    gameplay_fall_events: u32,
    gameplay_fall_through_frames: u32,
    gameplay_was_falling_through: bool,
    gameplay_dig_attempts: u32,
    gameplay_dig_applied: u32,
    gameplay_dig_rejected_crust: u32,
    gameplay_dig_failed: bool,
    hole_probe_requested: bool,
    seam_audit_requested: bool,
    seam_audit_drain_frames_left: u32,
    gameplay_trace: Vec<GameplayTraceSample>,
    gameplay_failed: bool,
    checkpoints: Vec<CheckpointSummary>,
    started: Instant,
    run_started_utc: String,
    git_sha: Option<String>,
    git_dirty: Option<bool>,
    warned_missing_fog_quality: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum BenchPhase {
    Warmup,
    SetupCheckpoint,
    WaitReady,
    WaitRenderReady,
    Settle,
    Hold,
    Screenshot,
    FinishRun,
    Done,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
struct BenchReadySignature {
    missing_chunks: u32,
    dirty_chunks: u32,
    mesh_entities: u32,
    water_mesh_entities: u32,
    collider_ready_entities: u32,
    collider_pending_entities: u32,
    high_lod_chunks: u32,
    low_lod_chunks: u32,
    culled_chunks: u32,
}

#[derive(Clone, Copy, Debug, Default)]
struct BenchReadySnapshot {
    signature: BenchReadySignature,
    chunks_meshed_this_frame: u32,
    chunks_skipped_this_frame: u32,
    chunks_skipped_page_owned: u32,
    require_collider_ready: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
struct BenchRenderReadySignature {
    opaque_items: u32,
    alpha_mask_items: u32,
    transparent_items: u32,
    shadow_items: u32,
    terrain_items: u32,
    water_items: u32,
    instanced_prop_items: u32,
    queued_instanced_draws: u32,
    queued_instanced_instances: u32,
    water_reflection_sampled: u32,
    terrain_full_triplanar_meshes: u32,
    terrain_cheap_triplanar_meshes: u32,
    terrain_triplanar_textures_configured: u32,
    naadf_preview_active: u32,
    naadf_preview_first_hit_dispatches: u32,
    naadf_preview_composite_passes: u32,
    naadf_preview_pixels: u32,
}

#[derive(Clone, Serialize)]
struct GameplayTraceSample {
    frame: u32,
    run_index: u32,
    checkpoint: String,
    position_x: f32,
    position_y: f32,
    position_z: f32,
    velocity_x: f32,
    velocity_y: f32,
    velocity_z: f32,
    horizontal_speed: f32,
    chunk_x: i32,
    chunk_y: i32,
    chunk_z: i32,
    expected_surface_y: Option<f32>,
    surface_delta: Option<f32>,
    validity: String,
    falling_through: bool,
    collider_ready: bool,
    collider_pending: bool,
}

impl BenchReadySnapshot {
    fn is_ready_candidate(self) -> bool {
        if self.signature.missing_chunks != 0 {
            return false;
        }

        let has_visible_mesh =
            self.signature.mesh_entities + self.signature.water_mesh_entities > 0;
        if self.require_collider_ready {
            return has_visible_mesh && self.signature.collider_ready_entities > 0;
        }

        has_visible_mesh
    }

    fn stability_signature(self) -> BenchReadySignature {
        if !self.require_collider_ready {
            return BenchReadySignature {
                missing_chunks: self.signature.missing_chunks,
                dirty_chunks: 0,
                mesh_entities: (self.signature.mesh_entities > 0) as u32,
                water_mesh_entities: (self.signature.water_mesh_entities > 0) as u32,
                ..Default::default()
            };
        }

        BenchReadySignature {
            missing_chunks: self.signature.missing_chunks,
            dirty_chunks: 0,
            collider_ready_entities: (self.signature.collider_ready_entities > 0) as u32,
            collider_pending_entities: 0,
            ..Default::default()
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct BenchColliderReadyStats {
    ready_entities: u32,
    pending_entities: u32,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchScene {
    seed: u64,
    duration_warmup_secs: f32,
    median_runs: u32,
    chunk_load_radius: i32,
    #[serde(default)]
    world_size_chunks: Option<[i32; 3]>,
    #[serde(default)]
    world_cache_path: Option<PathBuf>,
    #[serde(default)]
    world_cache_regenerate: bool,
    /// When true, apply deterministic LOD seam hard-case voxel sculpts after world load.
    #[serde(default)]
    lod_seam_hard_case_fixture: bool,
    #[serde(default)]
    skip_props: bool,
    #[serde(default = "default_freeze_terrain_lod_after_ready")]
    freeze_terrain_lod_after_ready: bool,
    #[serde(default)]
    startup_trace: StartupTraceConfig,
    #[serde(default)]
    render_toggles: BenchRenderToggles,
    #[serde(default)]
    forensics: Option<BenchForensicsConfig>,
    #[serde(rename = "checkpoint")]
    checkpoints: Vec<BenchCheckpoint>,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchCheckpoint {
    name: String,
    position: [f32; 3],
    look_at: [f32; 3],
    time_of_day: f32,
    hold_frames: u32,
    #[serde(default)]
    screenshot: bool,
    #[serde(default)]
    screenshot_points: Vec<ScreenshotPoint>,
    fog_tier: Option<String>,
    #[serde(default)]
    render_features: Option<BenchCheckpointRenderFeatures>,
    motion: Option<BenchMotion>,
    gameplay: Option<BenchGameplay>,
    inventory_ui: Option<BenchInventoryUi>,
    hole_probe: Option<BenchHoleProbe>,
    #[serde(default)]
    seam_audit: Option<BenchSeamAudit>,
    /// Diagnostic: force terrain debug overlays (Alt+F7 wireframe / Alt+F8
    /// normals) on for this checkpoint so seam artifacts can be classified
    /// deterministically from a bench screenshot.
    terrain_debug: Option<BenchTerrainDebug>,
}

#[derive(Debug, Default, Deserialize, Clone)]
struct BenchTerrainDebug {
    #[serde(default)]
    wireframe: bool,
    #[serde(default)]
    normals: bool,
    #[serde(default)]
    iso_band: bool,
    #[serde(default)]
    flat_unlit: bool,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchInventoryUi {
    #[serde(default = "default_true")]
    open: bool,
    #[serde(default)]
    category: InventoryCategory,
}

#[derive(Debug, Default, Deserialize, Serialize, Clone)]
struct BenchCheckpointRenderFeatures {
    #[serde(default)]
    gtao: Option<bool>,
    #[serde(default)]
    ssao: Option<bool>,
    #[serde(default)]
    baked_ao_strength: Option<f32>,
    #[serde(default)]
    fog: Option<bool>,
    #[serde(default)]
    god_rays: Option<bool>,
    #[serde(default)]
    god_ray_intensity: Option<f32>,
    #[serde(default)]
    motion_blur: Option<bool>,
    #[serde(default)]
    shadow_budget: Option<bool>,
    #[serde(default)]
    ray_tracing: Option<bool>,
    #[serde(default)]
    photo_mode: Option<bool>,
    #[serde(default)]
    cinematic_mode: Option<bool>,
}

#[derive(Debug, Deserialize, Clone)]
struct ScreenshotPoint {
    name: String,
    frame: u32,
    #[serde(default)]
    inventory_category: Option<InventoryCategory>,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchSeamAudit {
    #[serde(default)]
    frame: u32,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchHoleProbe {
    #[serde(default)]
    frame: u32,
    target_voxel: [i32; 3],
    player_position: Option<[f32; 3]>,
    camera_position: Option<[f32; 3]>,
    camera_direction: Option<[f32; 3]>,
    label: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchMotion {
    #[serde(default = "default_motion_kind")]
    kind: String,
    end_position: Option<[f32; 3]>,
    end_look_at: Option<[f32; 3]>,
    jump_height: Option<f32>,
    bob_amplitude: Option<f32>,
    look_sway_degrees: Option<f32>,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchGameplay {
    start_position: Option<[f32; 3]>,
    start_look_at: Option<[f32; 3]>,
    #[serde(default = "default_gameplay_movement")]
    movement: [f32; 2],
    #[serde(default = "default_true")]
    turn_at_world_border: bool,
    #[serde(default = "default_gameplay_border_turn_margin")]
    border_turn_margin: f32,
    #[serde(default = "default_true")]
    pathfind_around_blockers: bool,
    #[serde(default)]
    sprint: bool,
    #[serde(default)]
    jump_every_frames: Option<u32>,
    #[serde(default = "default_gameplay_min_horizontal_speed")]
    min_horizontal_speed: f32,
    #[serde(default = "default_gameplay_stall_after_frames")]
    stall_after_frames: u32,
    #[serde(default)]
    max_stall_events: u32,
    #[serde(default = "default_true")]
    fail_on_stall: bool,
    #[serde(default)]
    dig_probe: Option<BenchDigProbe>,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchDigProbe {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default = "default_dig_probe_start_frame")]
    start_frame: u32,
    #[serde(default = "default_dig_probe_interval_frames")]
    interval_frames: u32,
    #[serde(default = "default_dig_probe_radius")]
    radius: i32,
    #[serde(default = "default_true")]
    require_crust_rejection: bool,
}

#[derive(Serialize)]
struct BenchSummary {
    schema_version: u32,
    scene: String,
    seed: u64,
    git_sha: Option<String>,
    git_dirty: Option<bool>,
    build_profile: String,
    platform: String,
    bevy_version: String,
    run_started_utc: String,
    duration_secs: f64,
    render_toggles: BenchRenderToggles,
    checkpoints: Vec<CheckpointSummary>,
}

#[derive(Serialize)]
struct CheckpointSummary {
    name: String,
    fog_tier: Option<String>,
    render_features: Option<BenchCheckpointRenderFeatures>,
    median_frame_ms: f64,
    p99_frame_ms: f64,
    areas: BTreeMap<String, AreaSummary>,
    runs: Vec<RunRecord>,
}

#[derive(Serialize, Clone)]
struct RunRecord {
    frame_ms_median: f64,
    csv: String,
    screenshot: Option<String>,
    screenshots: Vec<ScreenshotRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ray_probe: Option<BenchRayProbeRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    startup_trace: Option<StartupTraceRecord>,
    ready_wait_frames: u32,
    ready_wait_secs: f32,
    ready_stable_frames: u32,
    ready_timed_out: bool,
    render_ready_wait_frames: u32,
    render_ready_secs: f32,
    render_ready_stable_frames: u32,
    render_ready_timed_out: bool,
    gameplay_stall_events: u32,
    gameplay_failed: bool,
    gameplay_min_horizontal_speed: f32,
    gameplay_min_y: f32,
    gameplay_fall_events: u32,
    gameplay_dig_attempts: u32,
    gameplay_dig_applied: u32,
    gameplay_dig_rejected_crust: u32,
    gameplay_dig_failed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    gameplay_trace_csv: Option<String>,
    ready_mesh_entities: u32,
    ready_water_mesh_entities: u32,
}

#[derive(Serialize, Clone)]
struct StartupTraceRecord {
    total_startup_secs: f64,
    total_startup_frames: u32,
    events: Vec<StartupTraceEvent>,
    phases: Vec<StartupPhaseRecord>,
    final_ready_signature: BenchReadySignature,
    final_render_ready_signature: Option<BenchRenderReadySignature>,
    counters: StartupTraceCounters,
}

#[derive(Serialize, Clone)]
struct StartupTraceEvent {
    name: String,
    frame: u32,
    elapsed_secs: f64,
    delta_secs: f64,
}

#[derive(Serialize, Clone)]
struct StartupPhaseRecord {
    name: String,
    start_frame: u32,
    end_frame: u32,
    frames: u32,
    elapsed_secs: f64,
    timed_out: bool,
    csv: Option<String>,
    areas: BTreeMap<String, AreaSummary>,
}

#[derive(Serialize, Clone, Default)]
struct StartupTraceCounters {
    prop_assets_ready: bool,
    prop_mesh_cache_ready: bool,
    prop_chunks_loaded: usize,
    persisted_props_loaded: usize,
    instanced_prop_groups: usize,
    pending_instanced_prop_groups: usize,
    visible_props: usize,
    hidden_props: usize,
    visible_instanced_prop_groups: usize,
    visible_instanced_prop_instances: usize,
    queued_instanced_prop_draws: u32,
    queued_instanced_prop_instances: u32,
    global_water_tiles: usize,
    voxel_water_meshes: u32,
    missing_chunks: u32,
    dirty_chunks: u32,
    first_nonzero_render_phase_items: Option<u32>,
}

struct StartupTraceRunBuilder {
    config: StartupTraceConfig,
    bench_started: Instant,
    run_started_frame: u32,
    events: Vec<StartupTraceEvent>,
    phases: Vec<StartupPhaseRecord>,
    current_phase: Option<StartupTracePhaseBuilder>,
    seen: StartupTraceSeen,
    counters: StartupTraceCounters,
}

struct StartupTracePhaseBuilder {
    name: String,
    start: Instant,
    start_frame: u32,
}

#[derive(Default)]
struct StartupTraceSeen {
    bench_environment_ready: bool,
    checkpoint_setup: bool,
    first_update: bool,
    prop_assets_ready: bool,
    prop_mesh_cache_ready: bool,
    props_spawned: bool,
    first_terrain_mesh: bool,
    first_water_mesh: bool,
    first_render_signature: bool,
    first_nonzero_render_phase_items: bool,
    terrain_ready: bool,
    render_ready: bool,
    settle_start: bool,
    settle_end: bool,
    hold_start: bool,
    max_phase_frames: bool,
}

#[derive(Serialize, Clone)]
struct ScreenshotRecord {
    name: String,
    frame: u32,
    elapsed_secs: f64,
    path: String,
}

#[derive(Serialize, Clone)]
struct BenchRayProbeRecord {
    origin: [f32; 3],
    direction: [f32; 3],
    max_distance: f32,
    voxel_backend: String,
    experimental_mode: String,
    high_lod_chunks: u32,
    low_lod_chunks: u32,
    hit: Option<BenchRayProbeHitRecord>,
    terminal_sample: Option<String>,
}

#[derive(Serialize, Clone)]
struct BenchRayProbeHitRecord {
    distance: f32,
    world_voxel: [i32; 3],
    chunk: [i32; 3],
    local: [u32; 3],
    voxel_type: String,
    voxel_type_id: u8,
    solid: bool,
    chunk_loaded: bool,
    chunk_lod: Option<String>,
    chunk_lod_step: Option<u32>,
    chunk_dirty: Option<bool>,
    chunk_dirty_reason_flags: Option<u8>,
    mesh_entity_present: Option<bool>,
    water_mesh_entity_present: Option<bool>,
}

#[derive(Serialize, Clone)]
struct AreaSummary {
    median_ms: f64,
    p99_ms: f64,
    calls_per_frame: f64,
    unit: &'static str,
}

impl StartupTraceRunBuilder {
    fn new(config: StartupTraceConfig, bench_started: Instant, frame: u32) -> Self {
        let mut trace = Self {
            config,
            bench_started,
            run_started_frame: frame,
            events: Vec::new(),
            phases: Vec::new(),
            current_phase: None,
            seen: StartupTraceSeen::default(),
            counters: StartupTraceCounters::default(),
        };
        trace.event("process_start", frame);
        trace
    }

    fn event(&mut self, name: &str, frame: u32) {
        let elapsed_secs = self.bench_started.elapsed().as_secs_f64();
        let delta_secs = self
            .events
            .last()
            .map(|event| elapsed_secs - event.elapsed_secs)
            .unwrap_or(elapsed_secs);
        self.events.push(StartupTraceEvent {
            name: name.to_string(),
            frame,
            elapsed_secs,
            delta_secs: delta_secs.max(0.0),
        });
    }

    fn start_phase(&mut self, name: &str, frame: u32) {
        self.current_phase = Some(StartupTracePhaseBuilder {
            name: name.to_string(),
            start: Instant::now(),
            start_frame: frame,
        });
    }

    fn finish_phase(
        &mut self,
        config: &BenchConfig,
        checkpoint: &BenchCheckpoint,
        run_index: u32,
        frame: u32,
        timed_out: bool,
        timing: &AreaTimingRecorder,
    ) {
        let Some(phase) = self.current_phase.take() else {
            return;
        };
        let csv = if self.config.capture_csv {
            let marker = format!("startup-{}", phase.name);
            let csv_name = run_file_name(
                &config.scene_path,
                checkpoint,
                Some(&marker),
                run_index,
                "csv",
            );
            let csv_path = config.output_dir.join(&csv_name);
            match write_area_timing_csv(timing, &csv_path) {
                Ok(_) => Some(csv_name),
                Err(err) => {
                    warn!(
                        "failed to write startup phase CSV {}: {}",
                        csv_path.display(),
                        err
                    );
                    None
                }
            }
        } else {
            None
        };
        self.phases.push(StartupPhaseRecord {
            name: phase.name,
            start_frame: phase.start_frame,
            end_frame: frame,
            frames: frame.saturating_sub(phase.start_frame),
            elapsed_secs: phase.start.elapsed().as_secs_f64(),
            timed_out,
            csv,
            areas: timing_area_summaries(timing),
        });
    }

    fn record(
        self,
        frame: u32,
        ready: BenchReadySignature,
        render_ready: Option<BenchRenderReadySignature>,
    ) -> StartupTraceRecord {
        StartupTraceRecord {
            total_startup_secs: self.bench_started.elapsed().as_secs_f64(),
            total_startup_frames: frame.saturating_sub(self.run_started_frame),
            events: self.events,
            phases: self.phases,
            final_ready_signature: ready,
            final_render_ready_signature: render_ready,
            counters: self.counters,
        }
    }
}

fn record_startup_event_once(
    state: &mut BenchState,
    seen_field: impl for<'a> FnOnce(&'a mut StartupTraceSeen) -> &'a mut bool,
    name: &str,
    frame: u32,
) {
    let Some(trace) = state.startup_trace.as_mut() else {
        return;
    };
    let seen = seen_field(&mut trace.seen);
    if *seen {
        return;
    }
    *seen = true;
    trace.event(name, frame);
}

pub struct BenchPlugin;

impl Plugin for BenchPlugin {
    fn build(&self, app: &mut App) {
        let config = app
            .world()
            .get_resource::<BenchConfig>()
            .expect("BenchConfig must be inserted before BenchPlugin")
            .clone();

        let scene = load_scene(&config.scene_path).unwrap_or_else(|err| {
            panic!(
                "failed to load bench scene {}: {}",
                config.scene_path.display(),
                err
            )
        });
        let (git_sha, git_dirty) = git_info();
        let started = Instant::now();

        if config.headless {
            warn!("--bench-headless requested; falling back to windowed rendering on this backend");
        }

        let render_toggles = scene.render_toggles.clone();
        let forensics = scene.forensics.unwrap_or_default();
        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app.insert_resource(render_toggles.clone());
        }

        if let Some(size_chunks) = scene.world_size_chunks {
            let size_chunks = IVec3::new(
                size_chunks[0].max(1),
                size_chunks[1].max(1),
                size_chunks[2].max(1),
            );
            app.insert_resource(WorldConfig {
                size_chunks,
                chunk_size: crate::constants::CHUNK_SIZE_I32,
                greedy_meshing: true,
            })
            .insert_resource(WorldBounds::from_size_chunks(size_chunks))
            .insert_resource(VoxelWorld::new(size_chunks));
        }

        app.insert_resource(BenchSceneResource(scene.clone()))
            .insert_resource(bench_world_persistence(&scene))
            .insert_resource(render_toggles)
            .insert_resource(forensics)
            .insert_resource(BenchState {
                phase: BenchPhase::Warmup,
                checkpoint_index: 0,
                run_index: 0,
                warmup_started: None,
                ready_started: None,
                ready_stable_frames: 0,
                ready_wait_frames: 0,
                ready_last_signature: None,
                render_ready_started: None,
                render_ready_wait_frames: 0,
                render_ready_stable_frames: 0,
                render_ready_last_signature: None,
                last_ready_wait_frames: 0,
                last_ready_wait_secs: 0.0,
                last_ready_stable_frames: 0,
                last_ready_snapshot: BenchReadySnapshot::default(),
                last_ready_timed_out: false,
                last_render_ready_wait_frames: 0,
                last_render_ready_secs: 0.0,
                last_render_ready_stable_frames: 0,
                last_render_ready_signature: None,
                last_render_ready_timed_out: false,
                settle_frames_left: 0,
                hold_frames_left: 0,
                screenshot_wait_left: 0,
                screenshot_wait_started: None,
                hold_elapsed_frames: 0,
                next_screenshot_point: 0,
                current_screenshots: Vec::new(),
                current_run: None,
                startup_trace: scene
                    .startup_trace
                    .enabled
                    .then(|| StartupTraceRunBuilder::new(scene.startup_trace, started, 0)),
                gameplay_stall_frames: 0,
                gameplay_stall_events: 0,
                gameplay_min_horizontal_speed: 0.0,
                gameplay_min_y: f32::MAX,
                gameplay_fall_events: 0,
                gameplay_fall_through_frames: 0,
                gameplay_was_falling_through: false,
                gameplay_dig_attempts: 0,
                gameplay_dig_applied: 0,
                gameplay_dig_rejected_crust: 0,
                gameplay_dig_failed: false,
                hole_probe_requested: false,
                seam_audit_requested: false,
                seam_audit_drain_frames_left: 0,
                gameplay_trace: Vec::new(),
                gameplay_failed: false,
                checkpoints: Vec::new(),
                started,
                run_started_utc: utc_timestamp(SystemTime::now()),
                git_sha,
                git_dirty,
                warned_missing_fog_quality: false,
            })
            .init_resource::<AreaTimingRecorder>()
            .init_resource::<PauseMenuState>()
            .init_resource::<SettingsState>()
            .init_resource::<VisualSettings>()
            .init_resource::<DebugDetailToggles>()
            .init_resource::<PlacementPaletteState>()
            .init_resource::<MapState>()
            .init_resource::<InventoryUiState>()
            .init_resource::<ActionState>()
            .init_resource::<TargetedBlock>()
            .init_resource::<LodSeamHardCaseFixtureApplied>()
            .add_systems(Startup, setup_bench_environment)
            .add_systems(Update, apply_lod_seam_hard_case_fixture_once)
            .add_systems(
                PreUpdate,
                (
                    crate::performance::reset_area_timing_frame,
                    apply_bench_gameplay_input,
                    apply_bench_gameplay_dig_probe.after(apply_bench_gameplay_input),
                ),
            )
            .add_systems(
                Update,
                (
                    apply_bench_render_toggles,
                    sync_bench_naadf_demo_lights,
                    record_startup_trace_observations_system,
                    run_bench_state_machine,
                )
                    .chain(),
            );
    }
}

#[derive(Resource, Default)]
struct LodSeamHardCaseFixtureApplied(bool);

fn apply_lod_seam_hard_case_fixture_once(
    scene: Res<BenchSceneResource>,
    mut world: ResMut<VoxelWorld>,
    mut applied: ResMut<LodSeamHardCaseFixtureApplied>,
) {
    if applied.0 || !scene.0.lod_seam_hard_case_fixture {
        return;
    }
    if world.chunk_positions().next().is_none() {
        return;
    }
    crate::voxel::diagnostics::lod_seam_hard_case_fixture::apply_lod_seam_hard_case_fixture(
        &mut world,
    );
    applied.0 = true;
    info!("Applied LOD seam hard-case voxel fixture");
}

fn setup_bench_environment(
    mut time: ResMut<Time<Virtual>>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut state: ResMut<BenchState>,
    scene: Res<BenchSceneResource>,
    persistence: Res<WorldPersistence>,
    frame: Res<FrameCount>,
) {
    time.set_max_delta(std::time::Duration::from_millis(100));
    atmosphere.cycle_enabled = false;
    timing.set_enabled(true);
    info!(
        "Bench environment configured; world persistence path {}, force_regenerate={}, auto_save={}, skip_props={}",
        persistence.path.display(),
        persistence.force_regenerate,
        persistence.auto_save,
        scene.0.skip_props
    );
    record_startup_event_once(
        &mut state,
        |seen| &mut seen.bench_environment_ready,
        "bench_environment_ready",
        frame.0,
    );
}

fn bench_world_persistence(scene: &BenchScene) -> WorldPersistence {
    let mut persistence = WorldPersistence {
        force_regenerate: false,
        auto_save: false,
        ..default()
    };

    if let Some(path) = scene.world_cache_path.clone() {
        persistence.path = path;
        persistence.force_regenerate = scene.world_cache_regenerate;
        persistence.auto_save = false;
        persistence.allow_terrain_fingerprint_mismatch = true;
    }

    persistence
}

fn apply_bench_render_toggles(
    toggles: Res<BenchRenderToggles>,
    mut visibility_queries: ParamSet<(
        Query<&mut Visibility, (With<ChunkMesh>, Without<WaterMesh>)>,
        Query<&mut Visibility, With<WaterMesh>>,
        Query<&mut Visibility, With<BuildingMesh>>,
    )>,
    mut directional_lights: Query<&mut DirectionalLight>,
    mut point_lights: Query<&mut PointLight>,
    mut spot_lights: Query<&mut SpotLight>,
    mut reflection_config: Option<ResMut<WaterReflectionConfig>>,
    ray_tracing: Option<ResMut<RayTracingSettings>>,
    capabilities: Option<Res<crate::rendering::capabilities::GraphicsCapabilities>>,
    #[cfg(feature = "naadf")] mut naadf_config: Option<
        ResMut<crate::rendering::naadf::NaadfConfig>,
    >,
) {
    if toggles.disable_terrain_meshes {
        for mut visibility in &mut visibility_queries.p0() {
            *visibility = Visibility::Hidden;
        }
    }
    if toggles.disable_water_meshes {
        for mut visibility in &mut visibility_queries.p1() {
            *visibility = Visibility::Hidden;
        }
    }
    if toggles.disable_buildings {
        for mut visibility in &mut visibility_queries.p2() {
            *visibility = Visibility::Hidden;
        }
    }
    if toggles.disable_shadows {
        for mut light in &mut directional_lights {
            light.shadows_enabled = false;
        }
        for mut light in &mut point_lights {
            light.shadows_enabled = false;
        }
        for mut light in &mut spot_lights {
            light.shadows_enabled = false;
        }
    }
    if toggles.disable_reflection_cameras {
        if let Some(config) = reflection_config.as_deref_mut() {
            config.enabled = false;
        }
    }
    if let Some(mut ray_tracing) = ray_tracing {
        if let Some(mode) = toggles
            .voxel_ray_backend
            .as_deref()
            .and_then(VoxelRayBackendMode::parse)
        {
            if ray_tracing.voxel_backend != mode {
                ray_tracing.set_voxel_backend(mode, capabilities.as_deref());
            }
        }
        if let Some(mode) = toggles
            .experimental_render_mode
            .as_deref()
            .and_then(ExperimentalRenderMode::parse)
        {
            if ray_tracing.experimental_mode != mode {
                ray_tracing.experimental_mode = mode;
            }
        }
    }
    #[cfg(feature = "naadf")]
    if let Some(config) = naadf_config.as_deref_mut() {
        let wants_naadf_backend = toggles
            .voxel_ray_backend
            .as_deref()
            .and_then(VoxelRayBackendMode::parse)
            .is_some_and(|mode| mode == VoxelRayBackendMode::Naadf);
        let wants_naadf_preview = toggles
            .experimental_render_mode
            .as_deref()
            .and_then(ExperimentalRenderMode::parse)
            == Some(ExperimentalRenderMode::NaadfPreview);
        let wants_naadf_path_b = toggles
            .naadf_path_b_compositor_mode
            .as_deref()
            .is_some_and(|mode| !matches!(mode.trim().to_ascii_lowercase().as_str(), "off" | ""));
        let wants_naadf_gi = toggles
            .experimental_render_mode
            .as_deref()
            .and_then(ExperimentalRenderMode::parse)
            == Some(ExperimentalRenderMode::CurrentWithNaadfGi);
        let enabled =
            wants_naadf_preview || wants_naadf_path_b || (wants_naadf_backend && wants_naadf_gi);
        if config.enabled != enabled {
            config.enabled = enabled;
        }
        if wants_naadf_gi {
            config.debug.allow_unverified_post_205 = true;
        }
        if let Some(force_cpu) = toggles.naadf_force_cpu_builder {
            if config.debug.force_cpu_builder != force_cpu {
                config.debug.force_cpu_builder = force_cpu;
            }
        }
        if let Some(force_gpu) = toggles.naadf_force_gpu_builder {
            if config.debug.force_gpu_builder != force_gpu {
                config.debug.force_gpu_builder = force_gpu;
            }
        }
        if let Some(max_updates) = toggles.naadf_max_chunk_updates_per_frame {
            if config.chunk_cache.max_chunk_updates_per_frame != max_updates {
                config.chunk_cache.max_chunk_updates_per_frame = max_updates;
            }
        }
        if let Some(radius_chunks) = toggles.naadf_radius_chunks {
            if config.chunk_cache.radius_chunks != radius_chunks {
                config.chunk_cache.radius_chunks = radius_chunks;
            }
        }
        if let Some(max_chunks) = toggles.naadf_max_chunks {
            if config.chunk_cache.max_chunks != max_chunks {
                config.chunk_cache.max_chunks = max_chunks;
            }
        }
        if let Some(max_gpu_memory_mb) = toggles.naadf_max_gpu_memory_mb {
            if config.chunk_cache.max_gpu_memory_mb != max_gpu_memory_mb {
                config.chunk_cache.max_gpu_memory_mb = max_gpu_memory_mb;
            }
        }
        if let Some(max_upload_bytes) = toggles.naadf_max_upload_bytes_per_frame {
            if config.chunk_cache.max_upload_bytes_per_frame != max_upload_bytes {
                config.chunk_cache.max_upload_bytes_per_frame = max_upload_bytes;
            }
        }
        if let Some(history_resolution_scale) = toggles.naadf_history_resolution_scale {
            if config.preview.history_resolution_scale != history_resolution_scale {
                config.preview.history_resolution_scale = history_resolution_scale;
            }
        }
        if let Some(max_ray_steps) = toggles.naadf_preview_max_ray_steps {
            if config.preview.max_ray_steps != max_ray_steps {
                config.preview.max_ray_steps = max_ray_steps;
            }
        }
        if let Some(bounce_count) = toggles.naadf_preview_bounce_count {
            if config.preview.bounce_count != bounce_count {
                config.preview.bounce_count = bounce_count;
            }
        }
        if let Some(spatial_radius) = toggles.naadf_preview_spatial_radius {
            if config.preview.spatial_radius != spatial_radius {
                config.preview.spatial_radius = spatial_radius;
            }
        }
        if let Some(show_miss_sky) = toggles.naadf_preview_show_miss_sky {
            if config.preview.show_miss_sky != show_miss_sky {
                config.preview.show_miss_sky = show_miss_sky;
            }
        }
        if let Some(compositor_mode) = toggles.naadf_path_b_compositor_mode.as_deref() {
            let compositor_mode = match compositor_mode {
                "debug_preview" => {
                    crate::rendering::naadf::NaadfPathBCompositorModeConfig::DebugPreview
                }
                "hybrid_far_terrain" => {
                    crate::rendering::naadf::NaadfPathBCompositorModeConfig::HybridFarTerrain
                }
                "depth_audit" => {
                    crate::rendering::naadf::NaadfPathBCompositorModeConfig::DepthAudit
                }
                "off" => crate::rendering::naadf::NaadfPathBCompositorModeConfig::Off,
                _ => config.path_b.compositor_mode,
            };
            if config.path_b.compositor_mode != compositor_mode {
                config.path_b.compositor_mode = compositor_mode;
            }
        }
        if let Some(verified) = toggles.naadf_path_b_foundation_200_210_verified {
            if config.path_b.foundation_200_210_verified != verified {
                config.path_b.foundation_200_210_verified = verified;
            }
        }
        if let Some(depth_epsilon) = toggles.naadf_path_b_depth_epsilon {
            if config.path_b.depth_epsilon != depth_epsilon {
                config.path_b.depth_epsilon = depth_epsilon;
            }
        }
        if let Some(enable_temporal) = toggles.naadf_path_b_enable_temporal {
            if config.path_b.enable_temporal != enable_temporal {
                config.path_b.enable_temporal = enable_temporal;
            }
        }
        if let Some(counters_enabled) = toggles.naadf_path_b_counters_enabled {
            if config.path_b.counters_enabled != counters_enabled {
                config.path_b.counters_enabled = counters_enabled;
            }
        }
        if let Some(local_lights_enabled) = toggles.naadf_preview_local_lights_enabled {
            if config.preview.local_lights_enabled != local_lights_enabled {
                config.preview.local_lights_enabled = local_lights_enabled;
            }
        }
        if let Some(local_light_limit) = toggles.naadf_preview_local_light_limit {
            if config.preview.local_light_limit != local_light_limit {
                config.preview.local_light_limit = local_light_limit;
            }
        }
        if let Some(local_light_shadows_enabled) = toggles.naadf_preview_local_light_shadows_enabled
        {
            if config.preview.local_light_shadows_enabled != local_light_shadows_enabled {
                config.preview.local_light_shadows_enabled = local_light_shadows_enabled;
            }
        }
        if let Some(use_for_gi_secondary) = toggles.naadf_use_for_gi_secondary {
            if config.use_for_gi_secondary != use_for_gi_secondary {
                config.use_for_gi_secondary = use_for_gi_secondary;
            }
        }
        if let Some(use_for_sun_visibility) = toggles.naadf_use_for_sun_visibility {
            if config.use_for_sun_visibility != use_for_sun_visibility {
                config.use_for_sun_visibility = use_for_sun_visibility;
            }
        }
        if let Some(froxel_sun_mask_enabled) = toggles.naadf_froxel_sun_mask_enabled {
            if config.froxel_sun_mask.enabled != froxel_sun_mask_enabled {
                config.froxel_sun_mask.enabled = froxel_sun_mask_enabled;
            }
        }
        if let Some(use_for_terrain_ao) = toggles.naadf_use_for_terrain_ao {
            if config.use_for_terrain_ao != use_for_terrain_ao {
                config.use_for_terrain_ao = use_for_terrain_ao;
            }
        }
        if let Some(use_for_contact_shadows) = toggles.naadf_use_for_contact_shadows {
            if config.use_for_contact_shadows != use_for_contact_shadows {
                config.use_for_contact_shadows = use_for_contact_shadows;
            }
        }
        if let Some(composite_mode) = toggles.naadf_preview_composite_mode.as_deref() {
            let composite_mode = match composite_mode {
                "fullscreen" => {
                    crate::rendering::naadf::NaadfPreviewCompositeModeConfig::Fullscreen
                }
                "split_view" => crate::rendering::naadf::NaadfPreviewCompositeModeConfig::SplitView,
                "picture_in_picture" => {
                    crate::rendering::naadf::NaadfPreviewCompositeModeConfig::PictureInPicture
                }
                _ => config.preview.composite_mode,
            };
            if config.preview.composite_mode != composite_mode {
                config.preview.composite_mode = composite_mode;
            }
        }
    }
}

#[derive(Component)]
struct BenchNaadfDemoLight;

fn sync_bench_naadf_demo_lights(
    mut commands: Commands,
    toggles: Res<BenchRenderToggles>,
    lights: Query<Entity, With<BenchNaadfDemoLight>>,
) {
    if !toggles.naadf_spawn_demo_lights {
        for entity in &lights {
            commands.entity(entity).despawn();
        }
        return;
    }

    if !lights.is_empty() {
        return;
    }

    for (position, color, intensity, range) in [
        (
            Vec3::new(170.0, 66.0, 300.0),
            Color::srgb(1.0, 0.34, 0.12),
            92_000.0,
            115.0,
        ),
        (
            Vec3::new(246.0, 66.0, 259.0),
            Color::srgb(1.0, 0.66, 0.20),
            104_000.0,
            88.0,
        ),
        (
            Vec3::new(330.0, 66.0, 314.0),
            Color::srgb(0.90, 0.46, 0.18),
            96_000.0,
            112.0,
        ),
        (
            Vec3::new(206.0, 68.0, 238.0),
            Color::srgb(1.0, 0.78, 0.34),
            66_000.0,
            62.0,
        ),
        (
            Vec3::new(286.0, 66.0, 296.0),
            Color::srgb(1.0, 0.44, 0.10),
            70_000.0,
            64.0,
        ),
        (
            Vec3::new(318.0, 67.0, 258.0),
            Color::srgb(0.82, 0.58, 0.24),
            62_000.0,
            60.0,
        ),
    ] {
        commands.spawn((
            PointLight {
                color,
                intensity,
                range,
                shadows_enabled: true,
                ..default()
            },
            Transform::from_translation(position),
            BenchNaadfDemoLight,
        ));
    }
}

fn apply_checkpoint_render_features(world: &mut World, features: &BenchCheckpointRenderFeatures) {
    apply_checkpoint_bool_render_feature(world, FrontendRenderFeatureFlag::Gtao, features.gtao);
    apply_checkpoint_bool_render_feature(world, FrontendRenderFeatureFlag::Ssao, features.ssao);
    if let Some(strength) = features.baked_ao_strength {
        if let Err(err) = set_render_feature_flag(
            world,
            FrontendRenderFeatureFlag::BakedAo,
            strength > 0.0,
            Some(strength),
        ) {
            warn!(
                "failed to apply bench baked AO strength {}: {}",
                strength, err
            );
        }
    }
    apply_checkpoint_bool_render_feature(world, FrontendRenderFeatureFlag::Fog, features.fog);
    if let Some(enabled) = features.god_rays {
        if let Err(err) = set_render_feature_flag(
            world,
            FrontendRenderFeatureFlag::GodRays,
            enabled,
            features.god_ray_intensity,
        ) {
            warn!("failed to apply bench god rays={}: {}", enabled, err);
        }
    }
    if features.motion_blur.is_some()
        || features.photo_mode == Some(true)
        || features.cinematic_mode == Some(true)
    {
        let enabled = features.motion_blur.unwrap_or(true);
        if let Some(mut config) = world.get_resource_mut::<CinematicConfig>() {
            config.motion_blur.enabled = enabled;
        } else {
            warn!(
                "failed to apply bench motion blur={}: missing CinematicConfig",
                enabled
            );
        }
    }
    apply_checkpoint_bool_render_feature(
        world,
        FrontendRenderFeatureFlag::ShadowBudget,
        features.shadow_budget,
    );
    apply_checkpoint_bool_render_feature(
        world,
        FrontendRenderFeatureFlag::RayTracing,
        features.ray_tracing,
    );
    apply_checkpoint_bool_render_feature(
        world,
        FrontendRenderFeatureFlag::PhotoMode,
        features.photo_mode,
    );
    apply_checkpoint_bool_render_feature(
        world,
        FrontendRenderFeatureFlag::CinematicMode,
        features.cinematic_mode,
    );
}

fn apply_checkpoint_bool_render_feature(
    world: &mut World,
    feature: FrontendRenderFeatureFlag,
    enabled: Option<bool>,
) {
    if let Some(enabled) = enabled {
        if let Err(err) = set_render_feature_flag(world, feature, enabled, None) {
            warn!(
                "failed to apply bench render feature {}={}: {}",
                feature.as_frontend_str(),
                enabled,
                err
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn record_startup_observations(
    scene: &BenchScene,
    state: &mut BenchState,
    world: &VoxelWorld,
    chunk_stats: &RuntimeChunkStats,
    timing: &AreaTimingRecorder,
    frame: u32,
    prop_assets: Option<&PropAssets>,
    prop_mesh_cache: Option<&PropMeshCache>,
    prop_persistence: Option<&PropPersistenceState>,
    prop_groups: Option<&PropInstanceGroups>,
    prop_visibility: &Query<&Visibility, With<Prop>>,
    instanced_prop_groups: &Query<(&InstancedPropGroup, &Visibility)>,
    water_tiles: &Query<Entity, With<bevy_water::WaterTiles>>,
) {
    let Some(trace) = state.startup_trace.as_mut() else {
        return;
    };

    if prop_assets.is_some_and(|assets| assets.loaded) {
        trace.counters.prop_assets_ready = true;
        if !trace.seen.prop_assets_ready {
            trace.seen.prop_assets_ready = true;
            trace.event("prop_assets_ready", frame);
        }
    }
    if prop_mesh_cache.is_some_and(|cache| cache.is_ready()) {
        trace.counters.prop_mesh_cache_ready = true;
        if !trace.seen.prop_mesh_cache_ready {
            trace.seen.prop_mesh_cache_ready = true;
            trace.event("prop_mesh_cache_ready", frame);
        }
    }
    if let Some(persistence) = prop_persistence {
        trace.counters.prop_chunks_loaded = persistence.loaded_chunks.len();
        trace.counters.persisted_props_loaded =
            persistence.chunk_prop_data.values().map(Vec::len).sum();
        if trace.counters.prop_chunks_loaded > 0 && !trace.seen.props_spawned {
            trace.seen.props_spawned = true;
            trace.event("props_spawned", frame);
        }
    }
    if let Some(groups) = prop_groups {
        trace.counters.instanced_prop_groups = groups.group_count();
        trace.counters.pending_instanced_prop_groups = groups.pending_group_count();
    }

    let mut visible_props = 0usize;
    let mut hidden_props = 0usize;
    for visibility in prop_visibility.iter() {
        if *visibility == Visibility::Hidden {
            hidden_props += 1;
        } else {
            visible_props += 1;
        }
    }
    trace.counters.visible_props = visible_props;
    trace.counters.hidden_props = hidden_props;

    let mut visible_groups = 0usize;
    let mut visible_group_instances = 0usize;
    for (group, visibility) in instanced_prop_groups.iter() {
        if *visibility != Visibility::Hidden {
            visible_groups += 1;
            visible_group_instances += group.instances.len();
        }
    }
    trace.counters.visible_instanced_prop_groups = visible_groups;
    trace.counters.visible_instanced_prop_instances = visible_group_instances;

    trace.counters.global_water_tiles = water_tiles.iter().count();
    trace.counters.voxel_water_meshes = chunk_stats.water_mesh_entities;
    if chunk_stats.mesh_entities > 0 && !trace.seen.first_terrain_mesh {
        trace.seen.first_terrain_mesh = true;
        trace.event("first_terrain_mesh", frame);
    }
    if chunk_stats.water_mesh_entities > 0 && !trace.seen.first_water_mesh {
        trace.seen.first_water_mesh = true;
        trace.event("first_water_mesh", frame);
    }

    if let Some(checkpoint) = scene.checkpoints.get(state.checkpoint_index) {
        let snapshot = bench_ready_snapshot(
            world,
            chunk_stats,
            vec3(checkpoint.position),
            scene.chunk_load_radius,
            BenchColliderReadyStats::default(),
            false,
        );
        trace.counters.missing_chunks = snapshot.signature.missing_chunks;
        trace.counters.dirty_chunks = snapshot.signature.dirty_chunks;
    }

    trace.counters.queued_instanced_prop_draws =
        latest_counter_u32(timing, "Render Instancing Queue Draws").unwrap_or_default();
    trace.counters.queued_instanced_prop_instances =
        latest_counter_u32(timing, "Render Instancing Queue Instances").unwrap_or_default();

    if let Some(signature) = bench_render_ready_signature(timing) {
        if !trace.seen.first_render_signature {
            trace.seen.first_render_signature = true;
            trace.event("first_render_signature", frame);
        }
        let phase_items = signature.opaque_items
            + signature.alpha_mask_items
            + signature.transparent_items
            + signature.shadow_items;
        if phase_items > 0 && !trace.seen.first_nonzero_render_phase_items {
            trace.seen.first_nonzero_render_phase_items = true;
            trace.counters.first_nonzero_render_phase_items = Some(phase_items);
            trace.event("first_nonzero_render_phase_items", frame);
        }
    }

    if let Some(phase) = trace.current_phase.as_ref() {
        let frames = frame.saturating_sub(phase.start_frame);
        if frames >= trace.config.max_phase_frames && !trace.seen.max_phase_frames {
            trace.seen.max_phase_frames = true;
            trace.event("startup_trace_max_phase_frames", frame);
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn record_startup_trace_observations_system(
    scene: Res<BenchSceneResource>,
    mut state: ResMut<BenchState>,
    world: Res<VoxelWorld>,
    chunk_stats: Res<RuntimeChunkStats>,
    timing: Res<AreaTimingRecorder>,
    frame: Res<FrameCount>,
    prop_assets: Option<Res<PropAssets>>,
    prop_mesh_cache: Option<Res<PropMeshCache>>,
    prop_persistence: Option<Res<PropPersistenceState>>,
    prop_groups: Option<Res<PropInstanceGroups>>,
    prop_visibility: Query<&Visibility, With<Prop>>,
    instanced_prop_groups: Query<(&InstancedPropGroup, &Visibility)>,
    water_tiles: Query<Entity, With<bevy_water::WaterTiles>>,
) {
    record_startup_event_once(
        &mut state,
        |seen| &mut seen.first_update,
        "first_update",
        frame.0,
    );
    record_startup_observations(
        &scene.0,
        &mut state,
        &world,
        &chunk_stats,
        &timing,
        frame.0,
        prop_assets.as_deref(),
        prop_mesh_cache.as_deref(),
        prop_persistence.as_deref(),
        prop_groups.as_deref(),
        &prop_visibility,
        &instanced_prop_groups,
        &water_tiles,
    );
}

fn apply_bench_gameplay_input(
    scene: Option<Res<BenchSceneResource>>,
    state: Option<Res<BenchState>>,
    mut actions: ResMut<ActionState>,
    world: Option<Res<VoxelWorld>>,
    cache: Option<Res<TerrainCollisionCache>>,
    mut camera: Query<&mut Transform, (With<PlayerCamera>, Without<Player>)>,
    player: Query<&Transform, (With<Player>, Without<PlayerCamera>)>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
) {
    let Some(scene) = scene else {
        actions.release_all();
        return;
    };
    let Some(state) = state else {
        actions.release_all();
        return;
    };
    let Some(checkpoint) = scene.0.checkpoints.get(state.checkpoint_index) else {
        actions.release_all();
        return;
    };
    let Some(gameplay) = checkpoint.gameplay.as_ref() else {
        actions.release_all();
        return;
    };
    if state.phase != BenchPhase::Hold {
        actions.release_all();
        return;
    }

    let movement = Vec2::new(gameplay.movement[0], gameplay.movement[1]).normalize_or_zero();
    if let (Some(world), Ok(mut camera_transform), Ok(player_transform)) =
        (world.as_deref(), camera.single_mut(), player.single())
    {
        let collider_readiness = cache
            .as_deref()
            .map(|cache| {
                SpawnColliderReadiness::from_chunk_meshes_with_cache(collider_query.iter(), cache)
            })
            .unwrap_or_else(|| SpawnColliderReadiness::from_chunk_meshes(collider_query.iter()));
        if maybe_steer_bench_camera(
            gameplay,
            &world,
            &collider_readiness,
            player_transform.translation,
            &mut camera_transform,
            movement,
        ) {
            debug!(
                "Bench gameplay path steer: checkpoint='{}' run={} frame={} pos=({:.2},{:.2},{:.2})",
                checkpoint.name,
                state.run_index,
                state.hold_elapsed_frames,
                player_transform.translation.x,
                player_transform.translation.y,
                player_transform.translation.z,
            );
        }
    }
    actions.set_pressed(GameAction::MoveLeft, movement.x < -0.25);
    actions.set_pressed(GameAction::MoveRight, movement.x > 0.25);
    actions.set_pressed(GameAction::MoveBackward, movement.y < -0.25);
    actions.set_pressed(GameAction::MoveForward, movement.y > 0.25);
    actions.set_pressed(GameAction::Sprint, gameplay.sprint);

    let jump_pressed = gameplay
        .jump_every_frames
        .filter(|frames| *frames > 0)
        .map(|frames| state.hold_elapsed_frames % frames < 2)
        .unwrap_or(false);
    actions.set_pressed(GameAction::Jump, jump_pressed);
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct BenchDigProbeResult {
    attempts: u32,
    applied: u32,
    rejected_crust: u32,
}

fn apply_bench_gameplay_dig_probe(
    scene: Option<Res<BenchSceneResource>>,
    mut state: Option<ResMut<BenchState>>,
    world: Option<ResMut<VoxelWorld>>,
    player: Query<&Transform, With<Player>>,
) {
    let (Some(scene), Some(state), Some(mut world)) = (scene, state.as_deref_mut(), world) else {
        return;
    };
    if state.phase != BenchPhase::Hold {
        return;
    }
    let Some(checkpoint) = scene.0.checkpoints.get(state.checkpoint_index) else {
        return;
    };
    let Some(dig_probe) = checkpoint
        .gameplay
        .as_ref()
        .and_then(|gameplay| gameplay.dig_probe.as_ref().filter(|probe| probe.enabled))
    else {
        return;
    };
    if state.hold_elapsed_frames < dig_probe.start_frame {
        return;
    }
    let elapsed = state.hold_elapsed_frames - dig_probe.start_frame;
    if dig_probe.interval_frames == 0 {
        if elapsed != 0 {
            return;
        }
    } else if elapsed % dig_probe.interval_frames != 0 {
        return;
    }
    let Ok(player_transform) = player.single() else {
        return;
    };

    let result = apply_bench_dig_probe(&mut world, player_transform.translation, dig_probe);
    state.gameplay_dig_attempts += result.attempts;
    state.gameplay_dig_applied += result.applied;
    state.gameplay_dig_rejected_crust += result.rejected_crust;
    if dig_probe.require_crust_rejection && result.rejected_crust == 0 {
        state.gameplay_dig_failed = true;
        state.gameplay_failed = true;
        warn!(
            "Bench dig probe failed: checkpoint='{}' run={} frame={} pos=({:.2},{:.2},{:.2}) attempts={} applied={} rejected_crust={}",
            checkpoint.name,
            state.run_index,
            state.hold_elapsed_frames,
            player_transform.translation.x,
            player_transform.translation.y,
            player_transform.translation.z,
            result.attempts,
            result.applied,
            result.rejected_crust,
        );
    }
}

fn apply_bench_dig_probe(
    world: &mut VoxelWorld,
    player_position: Vec3,
    dig_probe: &BenchDigProbe,
) -> BenchDigProbeResult {
    let bounds = world.bounds();
    let radius = dig_probe.radius.max(0);
    let center = player_position.floor().as_ivec3();
    let start_y = (center.y - 1).clamp(bounds.min_breakable_y, bounds.max_world_y);
    let mut result = BenchDigProbeResult::default();

    for dz in -radius..=radius {
        for dx in -radius..=radius {
            let x = center.x + dx;
            let z = center.z + dz;
            for y in (bounds.min_breakable_y..=start_y).rev() {
                result.attempts += 1;
                match world.set_voxel(IVec3::new(x, y, z), VoxelType::Air) {
                    VoxelEditResult::Applied => result.applied += 1,
                    VoxelEditResult::RejectedUnbreakable
                    | VoxelEditResult::RejectedBelowWorldFloor => result.rejected_crust += 1,
                    _ => {}
                }
            }

            for y in [bounds.min_breakable_y - 1, bounds.bedrock_floor_y] {
                result.attempts += 1;
                match world.set_voxel(IVec3::new(x, y, z), VoxelType::Air) {
                    VoxelEditResult::Applied => result.applied += 1,
                    VoxelEditResult::RejectedUnbreakable
                    | VoxelEditResult::RejectedBelowWorldFloor => result.rejected_crust += 1,
                    _ => {}
                }
            }
        }
    }

    result
}

fn maybe_steer_bench_camera(
    gameplay: &BenchGameplay,
    world: &VoxelWorld,
    collider_readiness: &SpawnColliderReadiness,
    player_position: Vec3,
    camera_transform: &mut Transform,
    movement: Vec2,
) -> bool {
    if !gameplay.turn_at_world_border && !gameplay.pathfind_around_blockers {
        return false;
    }

    let current_direction = bench_world_movement_direction(camera_transform, movement);
    let turn_direction = if gameplay.turn_at_world_border {
        bench_border_turn_direction(
            world.bounds(),
            player_position,
            current_direction,
            gameplay.border_turn_margin,
        )
    } else {
        None
    };
    let path_direction = gameplay
        .pathfind_around_blockers
        .then(|| {
            bench_best_walk_direction(
                world,
                collider_readiness,
                player_position,
                current_direction,
                gameplay.border_turn_margin,
            )
        })
        .flatten();
    let Some(steer_direction) = turn_direction.or(path_direction) else {
        return false;
    };
    let Some(new_camera_forward) =
        bench_camera_forward_for_world_movement(steer_direction, movement)
    else {
        return false;
    };

    let current_forward = camera_transform.forward().as_vec3();
    let vertical = current_forward.y.clamp(-0.95, 0.95);
    let horizontal_scale = (1.0 - vertical * vertical).sqrt();
    let new_look_direction =
        (new_camera_forward * horizontal_scale + Vec3::Y * vertical).normalize_or_zero();
    if new_look_direction.length_squared() == 0.0 {
        return false;
    }

    *camera_transform = Transform::from_translation(camera_transform.translation)
        .looking_at(camera_transform.translation + new_look_direction, Vec3::Y);
    true
}

fn bench_best_walk_direction(
    world: &VoxelWorld,
    collider_readiness: &SpawnColliderReadiness,
    position: Vec3,
    direction: Vec3,
    border_margin: f32,
) -> Option<Vec3> {
    let direction = Vec3::new(direction.x, 0.0, direction.z).normalize_or_zero();
    if direction.length_squared() == 0.0 {
        return None;
    }

    let current_surface_y = find_surface_spawn(
        world,
        position.x.floor() as i32,
        position.z.floor() as i32,
        collider_readiness,
        false,
    )
    .ok()
    .map(|spawn| spawn.position.y)
    .unwrap_or(position.y);
    let forward_score = bench_walk_direction_score(
        world,
        collider_readiness,
        position,
        current_surface_y,
        direction,
        border_margin,
        0.0,
    );
    if forward_score.is_some_and(|score| score <= 0.25) {
        return None;
    }

    BENCH_PATH_SAMPLE_ANGLES_DEGREES
        .into_iter()
        .filter_map(|angle_degrees| {
            let candidate = rotate_horizontal(direction, angle_degrees.to_radians());
            let score = bench_walk_direction_score(
                world,
                collider_readiness,
                position,
                current_surface_y,
                candidate,
                border_margin,
                angle_degrees.abs(),
            )?;
            Some((score, angle_degrees.abs(), candidate))
        })
        .min_by(|(score_a, angle_a, _), (score_b, angle_b, _)| {
            score_a
                .total_cmp(score_b)
                .then_with(|| angle_a.total_cmp(angle_b))
        })
        .and_then(|(score, _, candidate)| {
            let should_steer = match forward_score {
                Some(forward) => score + 1.0 < forward,
                None => true,
            };
            should_steer.then_some(candidate)
        })
}

fn bench_walk_direction_score(
    world: &VoxelWorld,
    collider_readiness: &SpawnColliderReadiness,
    position: Vec3,
    current_surface_y: f32,
    direction: Vec3,
    border_margin: f32,
    angle_penalty_degrees: f32,
) -> Option<f32> {
    if bench_direction_leaves_world_bounds(world.bounds(), position, direction, border_margin) {
        return None;
    }

    let mut score = angle_penalty_degrees / 90.0;
    let mut previous_surface_y = current_surface_y;
    for distance in BENCH_PATH_SAMPLE_DISTANCES {
        let sample_position = position + direction * distance;
        if bench_direction_leaves_world_bounds(world.bounds(), sample_position, direction, 1.0) {
            return None;
        }
        let surface = find_surface_spawn(
            world,
            sample_position.x.floor() as i32,
            sample_position.z.floor() as i32,
            collider_readiness,
            false,
        )
        .ok()?;
        let height_delta = surface.position.y - previous_surface_y;
        if height_delta > BENCH_PATH_MAX_STEP_UP || height_delta < -BENCH_PATH_MAX_DROP {
            return None;
        }
        let player_sample = Vec3::new(
            sample_position.x,
            surface.position.y + 0.25,
            sample_position.z,
        );
        if !can_player_enter_ground_column(world, player_sample, collider_readiness) {
            score += BENCH_PATH_COLLIDER_PENALTY;
        }
        score += height_delta.abs() * BENCH_PATH_HEIGHT_PENALTY;
        previous_surface_y = surface.position.y;
    }
    Some(score)
}

fn rotate_horizontal(direction: Vec3, radians: f32) -> Vec3 {
    let (sin, cos) = radians.sin_cos();
    Vec3::new(
        direction.x * cos - direction.z * sin,
        0.0,
        direction.x * sin + direction.z * cos,
    )
    .normalize_or_zero()
}

fn bench_world_movement_direction(camera_transform: &Transform, movement: Vec2) -> Vec3 {
    let forward = camera_transform.forward().as_vec3();
    let forward = Vec3::new(forward.x, 0.0, forward.z).normalize_or_zero();
    let right = Vec3::new(-forward.z, 0.0, forward.x);
    (forward * movement.y + right * movement.x).normalize_or_zero()
}

fn bench_camera_forward_for_world_movement(direction: Vec3, movement: Vec2) -> Option<Vec3> {
    if direction.length_squared() == 0.0 || movement.length_squared() == 0.0 {
        return None;
    }

    let direction = Vec3::new(direction.x, 0.0, direction.z).normalize_or_zero();
    let movement = movement.normalize_or_zero();
    let forward = Vec3::new(
        movement.y * direction.x + movement.x * direction.z,
        0.0,
        -movement.x * direction.x + movement.y * direction.z,
    )
    .normalize_or_zero();
    (forward.length_squared() > 0.0).then_some(forward)
}

fn bench_border_turn_direction(
    bounds: WorldBounds,
    position: Vec3,
    direction: Vec3,
    requested_margin: f32,
) -> Option<Vec3> {
    let direction = Vec3::new(direction.x, 0.0, direction.z).normalize_or_zero();
    if direction.length_squared() == 0.0 {
        return None;
    }

    let margin = requested_margin.max(1.0);
    if !bench_direction_leaves_world_bounds(bounds, position, direction, margin) {
        return None;
    }

    let right_turn = Vec3::new(direction.z, 0.0, -direction.x).normalize_or_zero();
    let left_turn = Vec3::new(-direction.z, 0.0, direction.x).normalize_or_zero();
    [right_turn, left_turn].into_iter().find(|candidate| {
        !bench_direction_leaves_world_bounds(bounds, position, *candidate, margin)
    })
}

fn bench_direction_leaves_world_bounds(
    bounds: WorldBounds,
    position: Vec3,
    direction: Vec3,
    margin: f32,
) -> bool {
    let min_x = bounds.horizontal_min.x as f32 + margin;
    let max_x = bounds.horizontal_max.x as f32 + 1.0 - margin;
    let min_z = bounds.horizontal_min.y as f32 + margin;
    let max_z = bounds.horizontal_max.y as f32 + 1.0 - margin;
    let next_x = position.x + direction.x * margin;
    let next_z = position.z + direction.z * margin;

    (direction.x < -BENCH_BORDER_TURN_MIN_DIRECTION && next_x <= min_x)
        || (direction.x > BENCH_BORDER_TURN_MIN_DIRECTION && next_x >= max_x)
        || (direction.z < -BENCH_BORDER_TURN_MIN_DIRECTION && next_z <= min_z)
        || (direction.z > BENCH_BORDER_TURN_MIN_DIRECTION && next_z >= max_z)
}

fn bench_center_ray_probe(
    transform: &Transform,
    world: &VoxelWorld,
    chunk_stats: &RuntimeChunkStats,
    toggles: &BenchRenderToggles,
) -> BenchRayProbeRecord {
    let origin = transform.translation;
    let direction = transform.forward().as_vec3().normalize_or_zero();
    let mut terminal_sample = None;
    let mut hit = None;
    let steps = (BENCH_RAY_PROBE_MAX_DISTANCE / BENCH_RAY_PROBE_STEP).ceil() as u32;

    if direction.length_squared() > 0.0 {
        for step in 0..=steps {
            let distance = step as f32 * BENCH_RAY_PROBE_STEP;
            let world_position = origin + direction * distance;
            let world_voxel = world_position.floor().as_ivec3();
            let sample = world.sample_voxel_for_interaction(world_voxel);
            terminal_sample = Some(format!("{sample:?}"));
            if let VoxelSample::InBounds(voxel_type) = sample {
                if voxel_type != VoxelType::Air {
                    hit = Some(bench_ray_probe_hit(
                        world,
                        distance,
                        world_voxel,
                        voxel_type,
                    ));
                    break;
                }
            }
        }
    }

    BenchRayProbeRecord {
        origin: origin.to_array(),
        direction: direction.to_array(),
        max_distance: BENCH_RAY_PROBE_MAX_DISTANCE,
        voxel_backend: toggles
            .voxel_ray_backend
            .clone()
            .unwrap_or_else(|| "current_sdf".to_string()),
        experimental_mode: toggles
            .experimental_render_mode
            .clone()
            .unwrap_or_else(|| "current".to_string()),
        high_lod_chunks: chunk_stats.high_lod_chunks,
        low_lod_chunks: chunk_stats.low_lod_chunks,
        hit,
        terminal_sample,
    }
}

fn bench_ray_probe_hit(
    world: &VoxelWorld,
    distance: f32,
    world_voxel: IVec3,
    voxel_type: VoxelType,
) -> BenchRayProbeHitRecord {
    let chunk_pos = VoxelWorld::world_to_chunk(world_voxel);
    let local = VoxelWorld::world_to_local(world_voxel);
    let chunk = world.get_chunk(chunk_pos);
    let chunk_lod = chunk.map(|chunk| chunk.lod_level());

    BenchRayProbeHitRecord {
        distance,
        world_voxel: world_voxel.to_array(),
        chunk: chunk_pos.to_array(),
        local: local.to_array(),
        voxel_type: format!("{voxel_type:?}"),
        voxel_type_id: voxel_type as u8,
        solid: voxel_type.is_solid(),
        chunk_loaded: chunk.is_some(),
        chunk_lod: chunk_lod.map(|lod| format!("{lod:?}")),
        chunk_lod_step: chunk_lod.map(|lod| lod.step_size()),
        chunk_dirty: chunk.map(|chunk| chunk.is_dirty()),
        chunk_dirty_reason_flags: chunk.map(|chunk| chunk.dirty_reason_flags()),
        mesh_entity_present: chunk.map(|chunk| chunk.mesh_entity().is_some()),
        water_mesh_entity_present: chunk.map(|chunk| chunk.water_mesh_entity().is_some()),
    }
}

fn record_bench_ray_probe_counts(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    ray_probe: &BenchRayProbeRecord,
) {
    timing.record_count(
        frame,
        "Bench Ray Probe Hit",
        ray_probe.hit.is_some() as u8 as f64,
    );
    timing.record_count(
        frame,
        "Bench Ray Probe High LOD Chunks",
        ray_probe.high_lod_chunks as f64,
    );
    timing.record_count(
        frame,
        "Bench Ray Probe Low LOD Chunks",
        ray_probe.low_lod_chunks as f64,
    );
    if let Some(hit) = ray_probe.hit.as_ref() {
        timing.record_count(frame, "Bench Ray Probe Distance", hit.distance as f64);
        timing.record_count(
            frame,
            "Bench Ray Probe Voxel Type Id",
            hit.voxel_type_id as f64,
        );
        timing.record_count(frame, "Bench Ray Probe Solid", hit.solid as u8 as f64);
        timing.record_count(
            frame,
            "Bench Ray Probe Chunk Loaded",
            hit.chunk_loaded as u8 as f64,
        );
        if let Some(step) = hit.chunk_lod_step {
            timing.record_count(frame, "Bench Ray Probe Chunk LOD Step", step as f64);
        }
        if let Some(dirty) = hit.chunk_dirty {
            timing.record_count(frame, "Bench Ray Probe Chunk Dirty", dirty as u8 as f64);
        }
        if let Some(mesh_entity_present) = hit.mesh_entity_present {
            timing.record_count(
                frame,
                "Bench Ray Probe Mesh Entity Present",
                mesh_entity_present as u8 as f64,
            );
        }
    }
}

fn run_bench_state_machine(
    mut commands: Commands,
    config: Res<BenchConfig>,
    scene: Res<BenchSceneResource>,
    mut state: ResMut<BenchState>,
    mut camera: Query<(&mut Transform, &mut PlayerCamera), With<PlayerCamera>>,
    mut player: Query<
        (
            &mut Transform,
            Option<&mut Position>,
            Option<&mut LinearVelocity>,
        ),
        (With<Player>, Without<PlayerCamera>),
    >,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut fog_quality: Option<ResMut<FogQuality>>,
    world: Res<VoxelWorld>,
    chunk_stats: Res<RuntimeChunkStats>,
    mut terrain_lod_control: Option<ResMut<TerrainLodControl>>,
    mut inventory_control: Option<ResMut<InventoryUiBenchControl>>,
    mut timing: ResMut<AreaTimingRecorder>,
    frame: Res<FrameCount>,
    collider_query: Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
    mut exit: MessageWriter<AppExit>,
) {
    if state.phase == BenchPhase::Done {
        return;
    }

    let scene = &scene.0;
    if scene.checkpoints.is_empty() {
        finish_bench(&config, &scene, &mut state, &mut exit, frame.0);
        return;
    }

    match state.phase {
        BenchPhase::Warmup => {
            let started = *state.warmup_started.get_or_insert_with(Instant::now);
            if started.elapsed().as_secs_f32() >= scene.duration_warmup_secs {
                state.phase = BenchPhase::SetupCheckpoint;
            }
        }
        BenchPhase::SetupCheckpoint => {
            let checkpoint = &scene.checkpoints[state.checkpoint_index];
            if let Some(control) = terrain_lod_control.as_deref_mut() {
                control.freeze_lod = false;
            }
            let gameplay = checkpoint.gameplay.as_ref();
            if let Ok((mut transform, mut player_camera)) = camera.single_mut() {
                if let Some(gameplay) = gameplay {
                    player_camera.mode = CameraMode::Walk;
                    let start_position = gameplay.start_position.map(vec3).unwrap_or_else(|| {
                        Transform::from_translation(vec3(checkpoint.position))
                            .looking_at(vec3(checkpoint.look_at), Vec3::Y)
                            .translation
                    });
                    let start_look_at = gameplay
                        .start_look_at
                        .map(vec3)
                        .unwrap_or(vec3(checkpoint.look_at));
                    *transform = Transform::from_translation(start_position + Vec3::Y * 1.7)
                        .looking_at(start_look_at, Vec3::Y);
                    if let Ok((mut player_transform, position, velocity)) = player.single_mut() {
                        player_transform.translation = start_position;
                        if let Some(mut position) = position {
                            position.0 = start_position;
                        }
                        if let Some(mut velocity) = velocity {
                            velocity.x = 0.0;
                            velocity.y = 0.0;
                            velocity.z = 0.0;
                        }
                    }
                } else {
                    player_camera.mode = CameraMode::Fly;
                    *transform = Transform::from_translation(vec3(checkpoint.position))
                        .looking_at(vec3(checkpoint.look_at), Vec3::Y);
                }
            }
            atmosphere.time = checkpoint.time_of_day * atmosphere.day_length;
            apply_fog_tier_if_supported(
                checkpoint,
                fog_quality.as_deref_mut(),
                &mut state.warned_missing_fog_quality,
            );
            if let Some(render_features) = checkpoint.render_features.clone() {
                commands.queue(move |world: &mut World| {
                    apply_checkpoint_render_features(world, &render_features);
                });
            }
            {
                let debug = checkpoint.terrain_debug.clone().unwrap_or_default();
                commands.queue(move |world: &mut World| {
                    if let Some(mut view) =
                        world.get_resource_mut::<crate::voxel::terrain_debug::TerrainDebugView>()
                    {
                        view.wireframe = debug.wireframe;
                        view.normals = debug.normals;
                        view.iso_band = debug.iso_band;
                        view.flat_unlit = debug.flat_unlit;
                    }
                });
            }
            apply_checkpoint_inventory_ui(checkpoint, inventory_control.as_deref_mut());
            state.settle_frames_left = SETTLE_FRAMES;
            state.hold_frames_left = checkpoint.hold_frames;
            state.hold_elapsed_frames = 0;
            state.next_screenshot_point = 0;
            state.current_screenshots.clear();
            state.current_run = None;
            state.gameplay_stall_frames = 0;
            state.gameplay_stall_events = 0;
            state.gameplay_min_horizontal_speed = f32::MAX;
            state.gameplay_min_y = f32::MAX;
            state.gameplay_fall_events = 0;
            state.gameplay_fall_through_frames = 0;
            state.gameplay_was_falling_through = false;
            state.gameplay_dig_attempts = 0;
            state.gameplay_dig_applied = 0;
            state.gameplay_dig_rejected_crust = 0;
            state.gameplay_dig_failed = false;
            state.hole_probe_requested = false;
            state.seam_audit_requested = false;
            state.seam_audit_drain_frames_left = 0;
            state.gameplay_trace.clear();
            state.gameplay_failed = false;
            state.ready_started = Some(Instant::now());
            state.ready_stable_frames = 0;
            state.ready_wait_frames = 0;
            state.ready_last_signature = None;
            state.render_ready_started = None;
            state.render_ready_wait_frames = 0;
            state.render_ready_stable_frames = 0;
            state.render_ready_last_signature = None;
            state.last_ready_wait_frames = 0;
            state.last_ready_wait_secs = 0.0;
            state.last_ready_stable_frames = 0;
            state.last_ready_snapshot = BenchReadySnapshot::default();
            state.last_ready_timed_out = false;
            state.last_render_ready_wait_frames = 0;
            state.last_render_ready_secs = 0.0;
            state.last_render_ready_stable_frames = 0;
            state.last_render_ready_signature = None;
            state.last_render_ready_timed_out = false;
            if scene.startup_trace.enabled && state.startup_trace.is_none() {
                state.startup_trace = Some(StartupTraceRunBuilder::new(
                    scene.startup_trace,
                    state.started,
                    frame.0,
                ));
            }
            record_startup_event_once(
                &mut state,
                |seen| &mut seen.checkpoint_setup,
                "checkpoint_setup",
                frame.0,
            );
            if let Some(trace) = state.startup_trace.as_mut() {
                trace.start_phase("wait-ready", frame.0);
            }
            state.phase = BenchPhase::WaitReady;
        }
        BenchPhase::WaitReady => {
            let checkpoint = &scene.checkpoints[state.checkpoint_index];
            let readiness_position = gameplay_start_or_checkpoint_position(checkpoint);
            let snapshot = bench_ready_snapshot(
                &world,
                &chunk_stats,
                readiness_position,
                scene.chunk_load_radius,
                bench_collider_ready_stats(
                    collider_query.iter(),
                    readiness_position,
                    scene.chunk_load_radius,
                ),
                checkpoint.gameplay.is_some(),
            );
            let stability_signature = snapshot.stability_signature();
            let signature_stable = state.ready_last_signature == Some(stability_signature);
            if snapshot.is_ready_candidate() && signature_stable {
                state.ready_stable_frames += 1;
            } else {
                state.ready_stable_frames = 0;
            }
            state.ready_wait_frames += 1;
            state.ready_last_signature = Some(stability_signature);
            let wait_secs = state
                .ready_started
                .map(|started| started.elapsed().as_secs_f32())
                .unwrap_or_default();
            let min_wait_satisfied = wait_secs >= READY_MIN_SECS;
            record_bench_ready_counts(
                &mut timing,
                frame.0,
                snapshot,
                state.ready_wait_frames,
                state.ready_stable_frames,
                min_wait_satisfied,
                false,
            );

            let ready = state.ready_stable_frames >= READY_STABLE_FRAMES && min_wait_satisfied;
            let trace_frame_limit = scene.startup_trace.enabled
                && state.ready_wait_frames >= scene.startup_trace.max_phase_frames;
            let timed_out = wait_secs >= READY_TIMEOUT_SECS || trace_frame_limit;
            if ready || timed_out {
                if scene.freeze_terrain_lod_after_ready {
                    if let Some(control) = terrain_lod_control.as_deref_mut() {
                        control.freeze_lod = true;
                    }
                }
                state.last_ready_wait_frames = state.ready_wait_frames;
                state.last_ready_wait_secs = wait_secs;
                state.last_ready_stable_frames = state.ready_stable_frames;
                state.last_ready_snapshot = snapshot;
                state.last_ready_timed_out = timed_out && !ready;
                if state.last_ready_timed_out {
                    warn!(
                        "Bench checkpoint '{}' run {} starting after readiness timeout ({:.1}s, stable {}/{} frames, missing {}, dirty {}, meshed this frame {})",
                        checkpoint.name,
                        state.run_index,
                        wait_secs,
                        state.ready_stable_frames,
                        READY_STABLE_FRAMES,
                        snapshot.signature.missing_chunks,
                        snapshot.signature.dirty_chunks,
                        snapshot.chunks_meshed_this_frame,
                    );
                    println!(
                        "[BENCH READY TIMEOUT] checkpoint={} run={} wait_frames={} wait_secs={:.1} stable_frames={} min_wait_secs={:.1} missing_chunks={} dirty_chunks={} mesh_entities={} water_mesh_entities={} collider_ready={} collider_pending={}",
                        checkpoint.name,
                        state.run_index,
                        state.ready_wait_frames,
                        wait_secs,
                        state.ready_stable_frames,
                        READY_MIN_SECS,
                        snapshot.signature.missing_chunks,
                        snapshot.signature.dirty_chunks,
                        snapshot.signature.mesh_entities,
                        snapshot.signature.water_mesh_entities,
                        snapshot.signature.collider_ready_entities,
                        snapshot.signature.collider_pending_entities,
                    );
                } else {
                    info!(
                        "Bench checkpoint '{}' run {} ready after {} frames ({:.1}s): meshes {}, water {}, high LOD {}, low LOD {}",
                        checkpoint.name,
                        state.run_index,
                        state.ready_wait_frames,
                        wait_secs,
                        snapshot.signature.mesh_entities,
                        snapshot.signature.water_mesh_entities,
                        snapshot.signature.high_lod_chunks,
                        snapshot.signature.low_lod_chunks,
                    );
                    println!(
                        "[BENCH READY] checkpoint={} run={} wait_frames={} wait_secs={:.1} stable_frames={} min_wait_secs={:.1} mesh_entities={} water_mesh_entities={} collider_ready={} collider_pending={} high_lod_chunks={} low_lod_chunks={}",
                        checkpoint.name,
                        state.run_index,
                        state.ready_wait_frames,
                        wait_secs,
                        state.ready_stable_frames,
                        READY_MIN_SECS,
                        snapshot.signature.mesh_entities,
                        snapshot.signature.water_mesh_entities,
                        snapshot.signature.collider_ready_entities,
                        snapshot.signature.collider_pending_entities,
                        snapshot.signature.high_lod_chunks,
                        snapshot.signature.low_lod_chunks,
                    );
                }
                let run_index = state.run_index;
                let ready_timed_out = state.last_ready_timed_out;
                if let Some(trace) = state.startup_trace.as_mut() {
                    trace.finish_phase(
                        &config,
                        checkpoint,
                        run_index,
                        frame.0,
                        ready_timed_out,
                        &timing,
                    );
                }
                record_startup_event_once(
                    &mut state,
                    |seen| &mut seen.terrain_ready,
                    "terrain_ready",
                    frame.0,
                );
                if !checkpoint_requires_render_ready(checkpoint) {
                    state.last_render_ready_signature = bench_render_ready_signature(&timing);
                    state.last_render_ready_wait_frames = 0;
                    state.last_render_ready_secs = 0.0;
                    state.last_render_ready_stable_frames = 0;
                    state.last_render_ready_timed_out = false;
                    record_bench_render_ready_counts(
                        &mut timing,
                        frame.0,
                        state.last_render_ready_signature,
                        state.last_render_ready_wait_frames,
                        state.last_render_ready_stable_frames,
                        true,
                        false,
                    );
                    record_startup_event_once(
                        &mut state,
                        |seen| &mut seen.render_ready,
                        "render_ready",
                        frame.0,
                    );
                    record_startup_event_once(
                        &mut state,
                        |seen| &mut seen.settle_start,
                        "settle_start",
                        frame.0,
                    );
                    if let Some(trace) = state.startup_trace.as_mut() {
                        trace.start_phase("settle", frame.0);
                    }
                    state.phase = BenchPhase::Settle;
                } else {
                    state.render_ready_started = Some(Instant::now());
                    state.render_ready_wait_frames = 0;
                    state.render_ready_stable_frames = 0;
                    state.render_ready_last_signature = None;
                    if let Some(trace) = state.startup_trace.as_mut() {
                        trace.start_phase("render-ready", frame.0);
                    }
                    state.phase = BenchPhase::WaitRenderReady;
                }
            }
        }
        BenchPhase::WaitRenderReady => {
            let checkpoint = &scene.checkpoints[state.checkpoint_index];
            record_bench_ready_counts(
                &mut timing,
                frame.0,
                state.last_ready_snapshot,
                state.last_ready_wait_frames,
                state.last_ready_stable_frames,
                state.last_ready_wait_secs >= READY_MIN_SECS,
                state.last_ready_timed_out,
            );

            let signature = bench_render_ready_signature(&timing);
            let signature_stable = signature.is_some()
                && state.render_ready_last_signature.is_some()
                && signature == state.render_ready_last_signature;
            if signature_stable {
                state.render_ready_stable_frames += 1;
            } else {
                state.render_ready_stable_frames = 0;
            }
            state.render_ready_wait_frames += 1;
            state.render_ready_last_signature = signature;

            let wait_secs = state
                .render_ready_started
                .map(|started| started.elapsed().as_secs_f32())
                .unwrap_or_default();
            let min_frames_satisfied = state.render_ready_wait_frames >= RENDER_READY_MIN_FRAMES;
            record_bench_render_ready_counts(
                &mut timing,
                frame.0,
                signature,
                state.render_ready_wait_frames,
                state.render_ready_stable_frames,
                min_frames_satisfied,
                false,
            );

            let ready = signature.is_some()
                && state.render_ready_stable_frames >= RENDER_READY_STABLE_FRAMES
                && min_frames_satisfied;
            let trace_frame_limit = scene.startup_trace.enabled
                && state.render_ready_wait_frames >= scene.startup_trace.max_phase_frames;
            let timed_out = wait_secs >= RENDER_READY_TIMEOUT_SECS || trace_frame_limit;
            if ready || timed_out {
                state.last_render_ready_wait_frames = state.render_ready_wait_frames;
                state.last_render_ready_secs = wait_secs;
                state.last_render_ready_stable_frames = state.render_ready_stable_frames;
                state.last_render_ready_signature = signature;
                state.last_render_ready_timed_out = timed_out && !ready;
                if state.last_render_ready_timed_out {
                    warn!(
                        "Bench checkpoint '{}' run {} render-ready timeout after {:.1}s, stable {}/{} frames, signature {:?}",
                        checkpoint.name,
                        state.run_index,
                        wait_secs,
                        state.render_ready_stable_frames,
                        RENDER_READY_STABLE_FRAMES,
                        signature,
                    );
                    println!(
                        "[BENCH RENDER READY TIMEOUT] checkpoint={} run={} wait_frames={} wait_secs={:.1} stable_frames={} min_frames={} signature={:?}",
                        checkpoint.name,
                        state.run_index,
                        state.render_ready_wait_frames,
                        wait_secs,
                        state.render_ready_stable_frames,
                        RENDER_READY_MIN_FRAMES,
                        signature,
                    );
                } else {
                    info!(
                        "Bench checkpoint '{}' run {} render-ready after {} frames ({:.1}s): {:?}",
                        checkpoint.name,
                        state.run_index,
                        state.render_ready_wait_frames,
                        wait_secs,
                        signature,
                    );
                    println!(
                        "[BENCH RENDER READY] checkpoint={} run={} wait_frames={} wait_secs={:.1} stable_frames={} min_frames={} signature={:?}",
                        checkpoint.name,
                        state.run_index,
                        state.render_ready_wait_frames,
                        wait_secs,
                        state.render_ready_stable_frames,
                        RENDER_READY_MIN_FRAMES,
                        signature,
                    );
                }
                let run_index = state.run_index;
                let render_ready_timed_out = state.last_render_ready_timed_out;
                if let Some(trace) = state.startup_trace.as_mut() {
                    trace.finish_phase(
                        &config,
                        checkpoint,
                        run_index,
                        frame.0,
                        render_ready_timed_out,
                        &timing,
                    );
                }
                record_startup_event_once(
                    &mut state,
                    |seen| &mut seen.render_ready,
                    "render_ready",
                    frame.0,
                );
                record_startup_event_once(
                    &mut state,
                    |seen| &mut seen.settle_start,
                    "settle_start",
                    frame.0,
                );
                if let Some(trace) = state.startup_trace.as_mut() {
                    trace.start_phase("settle", frame.0);
                }
                state.phase = BenchPhase::Settle;
            }
        }
        BenchPhase::Settle => {
            if state.settle_frames_left == 0 {
                let checkpoint = &scene.checkpoints[state.checkpoint_index];
                let run_index = state.run_index;
                if let Some(trace) = state.startup_trace.as_mut() {
                    trace.finish_phase(&config, checkpoint, run_index, frame.0, false, &timing);
                }
                record_startup_event_once(
                    &mut state,
                    |seen| &mut seen.settle_end,
                    "settle_end",
                    frame.0,
                );
                record_startup_event_once(
                    &mut state,
                    |seen| &mut seen.hold_start,
                    "hold_start",
                    frame.0,
                );
                timing.clear_window();
                state.phase = BenchPhase::Hold;
            } else {
                state.settle_frames_left -= 1;
            }
        }
        BenchPhase::Hold => {
            if state.hold_frames_left == 0 {
                if state.seam_audit_requested && state.seam_audit_drain_frames_left == 0 {
                    state.seam_audit_drain_frames_left = 2;
                }
                if state.seam_audit_drain_frames_left > 0 {
                    state.seam_audit_drain_frames_left -= 1;
                    return;
                }
                let checkpoint = &scene.checkpoints[state.checkpoint_index];
                let ray_probe = camera.single().ok().map(|(transform, _)| {
                    bench_center_ray_probe(transform, &world, &chunk_stats, &scene.render_toggles)
                });
                if let Some(ray_probe) = ray_probe.as_ref() {
                    record_bench_ray_probe_counts(&mut timing, frame.0, ray_probe);
                }
                let csv_name =
                    run_file_name(&config.scene_path, checkpoint, None, state.run_index, "csv");
                let csv_path = config.output_dir.join(&csv_name);
                if let Err(err) = write_area_timing_csv(&timing, &csv_path) {
                    warn!("failed to write bench CSV {}: {}", csv_path.display(), err);
                }
                save_bench_world_cache_if_ready(scene, &world);
                let gameplay_trace_csv = if checkpoint.gameplay.is_some() {
                    let trace_name = run_file_name(
                        &config.scene_path,
                        checkpoint,
                        Some("gameplay-path"),
                        state.run_index,
                        "csv",
                    );
                    let trace_path = config.output_dir.join(&trace_name);
                    if let Err(err) = write_gameplay_trace_csv(&state.gameplay_trace, &trace_path) {
                        warn!(
                            "failed to write gameplay trace CSV {}: {}",
                            trace_path.display(),
                            err
                        );
                    }
                    Some(trace_name)
                } else {
                    None
                };
                let frame_ms = timing
                    .frame_total_summary()
                    .map(|s| s.avg_ms)
                    .unwrap_or_default();
                let screenshot = if checkpoint.screenshot && checkpoint.screenshot_points.is_empty()
                {
                    let elapsed_secs = state.started.elapsed().as_secs_f64();
                    let png_name = capture_bench_screenshot(
                        &mut commands,
                        &config,
                        checkpoint,
                        "end",
                        state.run_index,
                    );
                    state.current_screenshots.push(ScreenshotRecord {
                        name: "end".to_string(),
                        frame: checkpoint.hold_frames,
                        elapsed_secs,
                        path: png_name.clone(),
                    });
                    Some(png_name)
                } else {
                    state
                        .current_screenshots
                        .last()
                        .map(|screenshot| screenshot.path.clone())
                };
                state.screenshot_wait_left = if state.current_screenshots.is_empty() {
                    state.screenshot_wait_started = None;
                    0
                } else {
                    state.screenshot_wait_started = Some(Instant::now());
                    SCREENSHOT_WAIT_FRAMES
                };
                state.current_run = Some(RunRecord {
                    frame_ms_median: frame_ms,
                    csv: csv_name,
                    screenshot,
                    screenshots: state.current_screenshots.clone(),
                    ray_probe,
                    startup_trace: state.startup_trace.take().map(|trace| {
                        trace.record(
                            frame.0,
                            state.last_ready_snapshot.signature,
                            state.last_render_ready_signature,
                        )
                    }),
                    ready_wait_frames: state.last_ready_wait_frames,
                    ready_wait_secs: state.last_ready_wait_secs,
                    ready_stable_frames: state.last_ready_stable_frames,
                    ready_timed_out: state.last_ready_timed_out,
                    render_ready_wait_frames: state.last_render_ready_wait_frames,
                    render_ready_secs: state.last_render_ready_secs,
                    render_ready_stable_frames: state.last_render_ready_stable_frames,
                    render_ready_timed_out: state.last_render_ready_timed_out,
                    gameplay_stall_events: state.gameplay_stall_events,
                    gameplay_failed: state.gameplay_failed,
                    gameplay_min_horizontal_speed: if state
                        .gameplay_min_horizontal_speed
                        .is_finite()
                    {
                        state.gameplay_min_horizontal_speed
                    } else {
                        0.0
                    },
                    gameplay_min_y: if state.gameplay_min_y.is_finite() {
                        state.gameplay_min_y
                    } else {
                        0.0
                    },
                    gameplay_fall_events: state.gameplay_fall_events,
                    gameplay_dig_attempts: state.gameplay_dig_attempts,
                    gameplay_dig_applied: state.gameplay_dig_applied,
                    gameplay_dig_rejected_crust: state.gameplay_dig_rejected_crust,
                    gameplay_dig_failed: state.gameplay_dig_failed,
                    gameplay_trace_csv,
                    ready_mesh_entities: state.last_ready_snapshot.signature.mesh_entities,
                    ready_water_mesh_entities: state
                        .last_ready_snapshot
                        .signature
                        .water_mesh_entities,
                });
                state.phase = BenchPhase::Screenshot;
            } else {
                record_bench_ready_counts(
                    &mut timing,
                    frame.0,
                    state.last_ready_snapshot,
                    state.last_ready_wait_frames,
                    state.last_ready_stable_frames,
                    state.last_ready_wait_secs >= READY_MIN_SECS,
                    state.last_ready_timed_out,
                );
                record_bench_render_ready_counts(
                    &mut timing,
                    frame.0,
                    state.last_render_ready_signature,
                    state.last_render_ready_wait_frames,
                    state.last_render_ready_stable_frames,
                    state.last_render_ready_wait_frames >= RENDER_READY_MIN_FRAMES,
                    state.last_render_ready_timed_out,
                );
                let checkpoint = &scene.checkpoints[state.checkpoint_index];
                record_bench_gameplay_counts(
                    &mut timing,
                    frame.0,
                    checkpoint,
                    &mut state,
                    &mut player,
                    &world,
                    &collider_query,
                );
                if checkpoint.gameplay.is_none()
                    && let Ok((mut transform, _player_camera)) = camera.single_mut()
                {
                    *transform = transform_for_checkpoint(checkpoint, state.hold_elapsed_frames);
                }
                if let Some(request) = checkpoint_hole_probe_request(
                    &config,
                    checkpoint,
                    state.hold_elapsed_frames,
                    state.run_index,
                    &mut state.hole_probe_requested,
                ) {
                    commands.queue(move |world: &mut World| {
                        world
                            .resource_mut::<TerrainHoleProbeRequests>()
                            .push(request);
                    });
                }
                if let Some(request) = checkpoint_seam_audit_request(
                    &config,
                    checkpoint,
                    state.hold_elapsed_frames,
                    state.run_index,
                    &mut state.seam_audit_requested,
                ) {
                    commands.queue(move |world: &mut World| {
                        world
                            .resource_mut::<TerrainSeamAuditRequests>()
                            .push(request);
                    });
                }
                apply_inventory_ui_screenshot_category(
                    checkpoint,
                    state.hold_elapsed_frames,
                    inventory_control.as_deref_mut(),
                );
                capture_due_screenshots(&mut commands, &config, checkpoint, &mut state);
                state.hold_elapsed_frames += 1;
                state.hold_frames_left -= 1;
            }
        }
        BenchPhase::Screenshot => {
            let wait_elapsed = state
                .screenshot_wait_started
                .map(|started| started.elapsed().as_secs_f32())
                .unwrap_or(SCREENSHOT_WAIT_MAX_SECS);
            let waited_long_enough = wait_elapsed >= SCREENSHOT_WAIT_MIN_SECS;
            let wait_timed_out = wait_elapsed >= SCREENSHOT_WAIT_MAX_SECS;
            let screenshots_ready = screenshots_exist(&config, &state.current_screenshots);
            if screenshots_ready && !state.hole_probe_requested {
                let checkpoint = &scene.checkpoints[state.checkpoint_index];
                if let Some(request) = checkpoint_hole_probe_request(
                    &config,
                    checkpoint,
                    checkpoint.hold_frames,
                    state.run_index,
                    &mut state.hole_probe_requested,
                ) {
                    commands.queue(move |world: &mut World| {
                        world
                            .resource_mut::<TerrainHoleProbeRequests>()
                            .push(request);
                    });
                    state.screenshot_wait_left = state.screenshot_wait_left.max(1);
                    return;
                }
            }
            if screenshots_ready && !state.seam_audit_requested {
                let checkpoint = &scene.checkpoints[state.checkpoint_index];
                if let Some(request) = checkpoint_seam_audit_request(
                    &config,
                    checkpoint,
                    checkpoint.hold_frames,
                    state.run_index,
                    &mut state.seam_audit_requested,
                ) {
                    commands.queue(move |world: &mut World| {
                        world
                            .resource_mut::<TerrainSeamAuditRequests>()
                            .push(request);
                    });
                    state.seam_audit_drain_frames_left = state.seam_audit_drain_frames_left.max(2);
                    state.screenshot_wait_left = state.screenshot_wait_left.max(2);
                    return;
                }
            }
            if state.screenshot_wait_left == 0
                && waited_long_enough
                && (screenshots_ready || wait_timed_out)
            {
                state.screenshot_wait_started = None;
                state.phase = BenchPhase::FinishRun;
            } else {
                state.screenshot_wait_left = state.screenshot_wait_left.saturating_sub(1);
            }
        }
        BenchPhase::FinishRun => {
            let tier = fog_quality.as_deref().map(|quality| quality.tier);
            finish_run(&config, &scene, &mut state, &timing, tier);
            if state.checkpoint_index >= scene.checkpoints.len() {
                finish_bench(&config, &scene, &mut state, &mut exit, frame.0);
            } else {
                state.phase = BenchPhase::SetupCheckpoint;
            }
        }
        BenchPhase::Done => {}
    }

    let _ = frame;
}

fn screenshots_exist(config: &BenchConfig, screenshots: &[ScreenshotRecord]) -> bool {
    screenshots
        .iter()
        .all(|screenshot| config.output_dir.join(&screenshot.path).exists())
}

fn checkpoint_requires_render_ready(checkpoint: &BenchCheckpoint) -> bool {
    checkpoint.screenshot || !checkpoint.screenshot_points.is_empty()
}

fn apply_checkpoint_inventory_ui(
    checkpoint: &BenchCheckpoint,
    control: Option<&mut InventoryUiBenchControl>,
) {
    let Some(control) = control else {
        return;
    };

    if let Some(inventory_ui) = checkpoint.inventory_ui.as_ref() {
        control.open = inventory_ui.open;
        control.category = inventory_ui.category;
    } else {
        control.open = false;
    }
}

fn apply_inventory_ui_screenshot_category(
    checkpoint: &BenchCheckpoint,
    hold_frame: u32,
    control: Option<&mut InventoryUiBenchControl>,
) {
    let Some(control) = control else {
        return;
    };
    let Some(inventory_ui) = checkpoint.inventory_ui.as_ref() else {
        return;
    };
    if !inventory_ui.open {
        control.open = false;
        return;
    }

    let mut category = inventory_ui.category;
    for point in &checkpoint.screenshot_points {
        if point.frame <= hold_frame + INVENTORY_SCREENSHOT_CATEGORY_LEAD_FRAMES
            && let Some(point_category) = point.inventory_category
        {
            category = point_category;
        }
    }

    control.open = true;
    control.category = category;
}

fn checkpoint_seam_audit_request(
    config: &BenchConfig,
    checkpoint: &BenchCheckpoint,
    hold_elapsed_frames: u32,
    run_index: u32,
    requested: &mut bool,
) -> Option<TerrainSeamAuditRequest> {
    let Some(audit) = checkpoint.seam_audit.as_ref() else {
        return None;
    };
    let trigger_frame = if audit.frame == 0 {
        checkpoint.hold_frames.saturating_sub(1)
    } else {
        audit.frame
    };
    if *requested || hold_elapsed_frames < trigger_frame {
        return None;
    }
    *requested = true;
    Some(TerrainSeamAuditRequest {
        trigger: format!(
            "bench:{}:run{}:frame{}",
            checkpoint.name, run_index, hold_elapsed_frames
        ),
        output_dir: config.output_dir.clone(),
        checkpoint_name: checkpoint.name.clone(),
        run_index,
    })
}

fn checkpoint_hole_probe_request(
    config: &BenchConfig,
    checkpoint: &BenchCheckpoint,
    hold_elapsed_frames: u32,
    run_index: u32,
    requested: &mut bool,
) -> Option<TerrainHoleProbeRequest> {
    let Some(probe) = checkpoint.hole_probe.as_ref() else {
        return None;
    };
    if *requested || hold_elapsed_frames < probe.frame {
        return None;
    }

    let label = probe
        .label
        .clone()
        .unwrap_or_else(|| format!("{}-run{run_index}", checkpoint.name));
    let screenshot_path = checkpoint
        .screenshot_points
        .iter()
        .filter(|point| point.frame <= probe.frame)
        .find(|point| point.name == "probe")
        .or_else(|| {
            checkpoint
                .screenshot_points
                .iter()
                .filter(|point| point.frame <= probe.frame)
                .max_by_key(|point| point.frame)
        })
        .map(|point| {
            config.output_dir.join(run_file_name(
                &config.scene_path,
                checkpoint,
                Some(&point.name),
                run_index,
                "png",
            ))
        });
    if screenshot_path.as_ref().is_some_and(|path| !path.exists()) {
        return None;
    }
    *requested = true;
    Some(TerrainHoleProbeRequest {
        trigger: format!(
            "bench:{}:run{}:frame{}",
            checkpoint.name, run_index, hold_elapsed_frames
        ),
        output_label: Some(label),
        target_voxel_position: IVec3::new(
            probe.target_voxel[0],
            probe.target_voxel[1],
            probe.target_voxel[2],
        ),
        player_world_position: probe.player_position.map(vec3),
        camera_world_position: probe.camera_position.map(vec3),
        camera_direction: probe.camera_direction.map(vec3),
        screenshot_path,
    })
}

fn save_bench_world_cache_if_ready(scene: &BenchScene, world: &VoxelWorld) {
    let Some(path) = scene.world_cache_path.as_ref() else {
        return;
    };

    if path.exists() && !scene.world_cache_regenerate {
        return;
    }

    let expected_chunks = expected_bench_world_chunks(world.world_size_chunks());
    let loaded_chunks = world.chunk_entries().count();
    if loaded_chunks != expected_chunks {
        warn!(
            "Skipping bench world cache save to {}; loaded {}/{} chunks",
            path.display(),
            loaded_chunks,
            expected_chunks
        );
        return;
    }

    if let Err(err) = persistence::save_world_to_path(world, path) {
        warn!(
            "Failed to save bench world cache {}: {}",
            path.display(),
            err
        );
    }
}

fn expected_bench_world_chunks(size_chunks: IVec3) -> usize {
    if size_chunks.x <= 0 || size_chunks.y <= 0 || size_chunks.z <= 0 {
        return 0;
    }

    size_chunks.x as usize * size_chunks.y as usize * size_chunks.z as usize
}

fn write_gameplay_trace_csv(
    samples: &[GameplayTraceSample],
    path: &Path,
) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut csv = String::from(
        "frame,run_index,checkpoint,position_x,position_y,position_z,velocity_x,velocity_y,velocity_z,horizontal_speed,chunk_x,chunk_y,chunk_z,expected_surface_y,surface_delta,validity,falling_through,collider_ready,collider_pending\n",
    );
    for sample in samples {
        csv.push_str(&format!(
            "{},{},{},{:.4},{:.4},{:.4},{:.4},{:.4},{:.4},{:.4},{},{},{},{},{},{},{},{},{}\n",
            sample.frame,
            sample.run_index,
            csv_escape(&sample.checkpoint),
            sample.position_x,
            sample.position_y,
            sample.position_z,
            sample.velocity_x,
            sample.velocity_y,
            sample.velocity_z,
            sample.horizontal_speed,
            sample.chunk_x,
            sample.chunk_y,
            sample.chunk_z,
            csv_optional_f32(sample.expected_surface_y),
            csv_optional_f32(sample.surface_delta),
            csv_escape(&sample.validity),
            sample.falling_through as u8,
            sample.collider_ready as u8,
            sample.collider_pending as u8,
        ));
    }
    std::fs::write(path, csv)
}

fn csv_optional_f32(value: Option<f32>) -> String {
    value.map(|value| format!("{value:.4}")).unwrap_or_default()
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn finish_run(
    config: &BenchConfig,
    scene: &BenchScene,
    state: &mut BenchState,
    timing: &AreaTimingRecorder,
    fog_tier: Option<FogQualityTier>,
) {
    let checkpoint = &scene.checkpoints[state.checkpoint_index];
    let mut run = state.current_run.take().unwrap_or_else(|| RunRecord {
        frame_ms_median: 0.0,
        csv: String::new(),
        screenshot: None,
        screenshots: Vec::new(),
        ray_probe: None,
        startup_trace: None,
        ready_wait_frames: 0,
        ready_wait_secs: 0.0,
        ready_stable_frames: 0,
        ready_timed_out: false,
        render_ready_wait_frames: 0,
        render_ready_secs: 0.0,
        render_ready_stable_frames: 0,
        render_ready_timed_out: false,
        gameplay_stall_events: 0,
        gameplay_failed: false,
        gameplay_min_horizontal_speed: 0.0,
        gameplay_min_y: 0.0,
        gameplay_fall_events: 0,
        gameplay_dig_attempts: 0,
        gameplay_dig_applied: 0,
        gameplay_dig_rejected_crust: 0,
        gameplay_dig_failed: false,
        gameplay_trace_csv: None,
        ready_mesh_entities: 0,
        ready_water_mesh_entities: 0,
    });
    if let Some(screenshot) = run.screenshot.as_deref() {
        if !config.output_dir.join(screenshot).exists() {
            warn!(
                "screenshot {} was not written before bench timeout; recording null",
                screenshot
            );
            run.screenshot = None;
        }
    }

    let frame = timing.frame_total_summary();
    let mut summary = if state.run_index == 0 {
        CheckpointSummary {
            name: checkpoint.name.clone(),
            fog_tier: checkpoint.fog_tier.clone(),
            render_features: checkpoint.render_features.clone(),
            median_frame_ms: frame.as_ref().map(|s| s.avg_ms).unwrap_or_default(),
            p99_frame_ms: frame.as_ref().map(|s| s.p99_ms).unwrap_or_default(),
            areas: BTreeMap::new(),
            runs: Vec::new(),
        }
    } else {
        state.checkpoints.pop().unwrap()
    };

    summary.runs.push(run);
    summary.median_frame_ms = median(
        summary
            .runs
            .iter()
            .map(|run| run.frame_ms_median)
            .collect::<Vec<_>>(),
    );
    summary.p99_frame_ms = frame.as_ref().map(|s| s.p99_ms).unwrap_or_default();
    for area in timing.rolling_summaries() {
        summary.areas.insert(
            area.area.to_string(),
            AreaSummary {
                median_ms: area.avg_ms,
                p99_ms: area.p99_ms,
                calls_per_frame: area.calls_per_frame,
                unit: area.unit,
            },
        );
    }
    if let Some(tier) = fog_tier {
        summary.areas.insert(
            "Volumetric Fog".to_string(),
            AreaSummary {
                median_ms: volumetric_fog_tier_cost_ms(tier),
                p99_ms: volumetric_fog_tier_cost_ms(tier),
                calls_per_frame: if tier.is_enabled() { 1.0 } else { 0.0 },
                unit: "ms",
            },
        );
    }

    state.run_index += 1;
    if state.run_index >= scene.median_runs {
        state.checkpoint_index += 1;
        state.run_index = 0;
    }
    state.checkpoints.push(summary);
}

fn timing_area_summaries(timing: &AreaTimingRecorder) -> BTreeMap<String, AreaSummary> {
    let mut areas = BTreeMap::new();
    if let Some(frame) = timing.frame_total_summary() {
        areas.insert(
            frame.area.to_string(),
            AreaSummary {
                median_ms: frame.avg_ms,
                p99_ms: frame.p99_ms,
                calls_per_frame: frame.calls_per_frame,
                unit: frame.unit,
            },
        );
    }
    for area in timing.rolling_summaries() {
        areas.insert(
            area.area.to_string(),
            AreaSummary {
                median_ms: area.avg_ms,
                p99_ms: area.p99_ms,
                calls_per_frame: area.calls_per_frame,
                unit: area.unit,
            },
        );
    }
    areas
}

fn append_summary_write_startup_events(state: &mut BenchState, frame: u32) {
    let elapsed_secs = state.started.elapsed().as_secs_f64();
    for checkpoint in &mut state.checkpoints {
        for run in &mut checkpoint.runs {
            let Some(trace) = run.startup_trace.as_mut() else {
                continue;
            };
            if trace
                .events
                .iter()
                .any(|event| event.name == "summary_write")
            {
                continue;
            }
            let delta_secs = trace
                .events
                .last()
                .map(|event| elapsed_secs - event.elapsed_secs)
                .unwrap_or(elapsed_secs)
                .max(0.0);
            trace.events.push(StartupTraceEvent {
                name: "summary_write".to_string(),
                frame,
                elapsed_secs,
                delta_secs,
            });
        }
    }
}

fn finish_bench(
    config: &BenchConfig,
    scene: &BenchScene,
    state: &mut BenchState,
    exit: &mut MessageWriter<AppExit>,
    frame: u32,
) {
    append_summary_write_startup_events(state, frame);
    let gameplay_failed = state
        .checkpoints
        .iter()
        .flat_map(|checkpoint| checkpoint.runs.iter())
        .any(|run| run.gameplay_failed);
    let summary = BenchSummary {
        schema_version: 3,
        scene: config
            .scene_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| config.scene_path.display().to_string()),
        seed: scene.seed,
        git_sha: state.git_sha.clone(),
        git_dirty: state.git_dirty,
        build_profile: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },
        platform: std::env::consts::OS.to_string(),
        bevy_version: "0.18.1".to_string(),
        run_started_utc: state.run_started_utc.clone(),
        duration_secs: state.started.elapsed().as_secs_f64(),
        render_toggles: scene.render_toggles.clone(),
        checkpoints: std::mem::take(&mut state.checkpoints),
    };

    if let Err(err) = std::fs::create_dir_all(&config.output_dir) {
        warn!(
            "failed to create bench output directory {}: {}",
            config.output_dir.display(),
            err
        );
    }
    let path = config.output_dir.join("summary.json");
    match std::fs::File::create(&path).and_then(|file| {
        serde_json::to_writer_pretty(file, &summary).map_err(std::io::Error::other)
    }) {
        Ok(()) => println!("Benchmark summary written to {}", path.display()),
        Err(err) => warn!("failed to write bench summary {}: {}", path.display(), err),
    }
    state.phase = BenchPhase::Done;
    if gameplay_failed {
        eprintln!(
            "Benchmark gameplay validation failed; see summary.json for gameplay_stall_events"
        );
        std::process::exit(1);
    }
    exit.write(AppExit::Success);
}

fn capture_due_screenshots(
    commands: &mut Commands,
    config: &BenchConfig,
    checkpoint: &BenchCheckpoint,
    state: &mut BenchState,
) {
    while let Some(point) = checkpoint
        .screenshot_points
        .get(state.next_screenshot_point)
        .filter(|point| point.frame <= state.hold_elapsed_frames)
    {
        let elapsed_secs = state.started.elapsed().as_secs_f64();
        let path =
            capture_bench_screenshot(commands, config, checkpoint, &point.name, state.run_index);
        state.current_screenshots.push(ScreenshotRecord {
            name: point.name.clone(),
            frame: point.frame,
            elapsed_secs,
            path,
        });
        state.next_screenshot_point += 1;
        state.screenshot_wait_left = SCREENSHOT_WAIT_FRAMES;
        state.screenshot_wait_started = Some(Instant::now());
    }
}

fn capture_bench_screenshot(
    commands: &mut Commands,
    config: &BenchConfig,
    checkpoint: &BenchCheckpoint,
    marker: &str,
    run_index: u32,
) -> String {
    let png_name = run_file_name(
        &config.scene_path,
        checkpoint,
        Some(marker),
        run_index,
        "png",
    );
    let png_path = config.output_dir.join(&png_name);
    if let Err(err) = std::fs::create_dir_all(&config.output_dir) {
        warn!(
            "failed to create bench output directory {}: {}",
            config.output_dir.display(),
            err
        );
    }
    commands
        .spawn(Screenshot::primary_window())
        .observe(save_to_disk(png_path));
    png_name
}

fn transform_for_checkpoint(checkpoint: &BenchCheckpoint, frame: u32) -> Transform {
    let hold_frames = checkpoint.hold_frames.max(1);
    let progress = if hold_frames <= 1 {
        1.0
    } else {
        (frame.min(hold_frames - 1) as f32) / ((hold_frames - 1) as f32)
    };
    let start_position = vec3(checkpoint.position);
    let end_position = checkpoint
        .motion
        .as_ref()
        .and_then(|motion| motion.end_position)
        .map(vec3)
        .unwrap_or(start_position);
    let start_look_at = vec3(checkpoint.look_at);
    let end_look_at = checkpoint
        .motion
        .as_ref()
        .and_then(|motion| motion.end_look_at)
        .map(vec3)
        .unwrap_or(start_look_at);

    let motion = checkpoint.motion.as_ref();
    let kind = motion
        .map(|motion| motion.kind.as_str())
        .unwrap_or("static")
        .to_ascii_lowercase();
    let moves = matches!(
        kind.as_str(),
        "run" | "run_jump" | "run_jump_look" | "run_look_sweep"
    );

    let mut position = if moves {
        start_position.lerp(end_position, smoothstep(progress))
    } else {
        start_position
    };
    if matches!(kind.as_str(), "run_jump" | "run_jump_look") {
        let jump_height = motion.and_then(|motion| motion.jump_height).unwrap_or(3.0);
        let bob_amplitude = motion
            .and_then(|motion| motion.bob_amplitude)
            .unwrap_or(0.08);
        position.y += (std::f32::consts::PI * progress).sin() * jump_height;
        position.y += (std::f32::consts::TAU * progress * 8.0).sin() * bob_amplitude;
    }

    let mut look_at = if matches!(
        kind.as_str(),
        "look_sweep" | "run_jump_look" | "run_look_sweep"
    ) {
        start_look_at.lerp(end_look_at, smoothstep(progress))
    } else if moves {
        end_look_at
    } else {
        start_look_at
    };

    let sway_degrees = motion
        .and_then(|motion| motion.look_sway_degrees)
        .unwrap_or(0.0);
    if sway_degrees.abs() > f32::EPSILON {
        let direction = (look_at - position).normalize_or_zero();
        if direction.length_squared() > 0.0 {
            let yaw = sway_degrees.to_radians() * (std::f32::consts::TAU * progress).sin();
            let distance = position.distance(look_at).max(1.0);
            look_at = position + Quat::from_rotation_y(yaw) * direction * distance;
        }
    }

    Transform::from_translation(position).looking_at(look_at, Vec3::Y)
}

fn smoothstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn bench_ready_snapshot(
    world: &VoxelWorld,
    chunk_stats: &RuntimeChunkStats,
    position: Vec3,
    radius: i32,
    collider_stats: BenchColliderReadyStats,
    require_collider_ready: bool,
) -> BenchReadySnapshot {
    let (missing_chunks, dirty_chunks) = chunks_pending_counts(world, position, radius);
    BenchReadySnapshot {
        signature: BenchReadySignature {
            missing_chunks,
            dirty_chunks,
            mesh_entities: chunk_stats.mesh_entities,
            water_mesh_entities: chunk_stats.water_mesh_entities,
            collider_ready_entities: collider_stats.ready_entities,
            collider_pending_entities: collider_stats.pending_entities,
            high_lod_chunks: chunk_stats.high_lod_chunks,
            low_lod_chunks: chunk_stats.low_lod_chunks,
            culled_chunks: chunk_stats.culled_chunks,
        },
        chunks_meshed_this_frame: chunk_stats.chunks_meshed_this_frame,
        chunks_skipped_this_frame: chunk_stats.chunks_skipped_this_frame,
        chunks_skipped_page_owned: chunk_stats.chunks_skipped_page_owned,
        require_collider_ready,
    }
}

fn bench_collider_ready_stats<'a>(
    colliders: impl Iterator<
        Item = (
            &'a ChunkMesh,
            Option<&'a ChunkCollider>,
            Option<&'a NeedsCollider>,
        ),
    >,
    center: Vec3,
    radius: i32,
) -> BenchColliderReadyStats {
    let center_chunk = VoxelWorld::world_to_chunk(center.floor().as_ivec3());
    let radius = radius.max(0);
    let mut stats = BenchColliderReadyStats::default();
    for (chunk_mesh, collider, needs_collider) in colliders {
        let delta = chunk_mesh.chunk_position - center_chunk;
        if delta.x.abs() > radius || delta.z.abs() > radius {
            continue;
        }
        if collider.is_some() && needs_collider.is_none() {
            stats.ready_entities += 1;
        }
        if needs_collider.is_some() {
            stats.pending_entities += 1;
        }
    }
    stats
}

fn gameplay_start_or_checkpoint_position(checkpoint: &BenchCheckpoint) -> Vec3 {
    checkpoint
        .gameplay
        .as_ref()
        .and_then(|gameplay| gameplay.start_position)
        .map(vec3)
        .unwrap_or_else(|| vec3(checkpoint.position))
}

fn chunks_pending_counts(world: &VoxelWorld, position: Vec3, radius: i32) -> (u32, u32) {
    let center = VoxelWorld::world_to_chunk(position.floor().as_ivec3());
    let world_size = world.world_size_chunks();
    let mut missing_chunks = 0;
    let mut dirty_chunks = 0;
    for x in center.x - radius..=center.x + radius {
        for z in center.z - radius..=center.z + radius {
            for y in 0..world_size.y {
                let pos = IVec3::new(x, y, z);
                if !world.chunk_in_bounds(pos) {
                    continue;
                }
                let Some(chunk) = world.get_chunk(pos) else {
                    missing_chunks += 1;
                    continue;
                };
                if chunk.is_dirty() {
                    dirty_chunks += 1;
                }
            }
        }
    }
    (missing_chunks, dirty_chunks)
}

fn record_bench_ready_counts(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    snapshot: BenchReadySnapshot,
    wait_frames: u32,
    stable_frames: u32,
    min_wait_satisfied: bool,
    timed_out: bool,
) {
    timing.record_count(
        frame,
        "Bench Ready Indicator",
        (min_wait_satisfied && !timed_out) as u8 as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Min Wait Satisfied",
        min_wait_satisfied as u8 as f64,
    );
    timing.record_count(frame, "Bench Ready Timed Out", timed_out as u8 as f64);
    timing.record_count(frame, "Bench Ready Wait Frames", wait_frames as f64);
    timing.record_count(frame, "Bench Ready Stable Frames", stable_frames as f64);
    timing.record_count(
        frame,
        "Bench Ready Missing Chunks",
        snapshot.signature.missing_chunks as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Dirty Chunks",
        snapshot.signature.dirty_chunks as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Mesh Entities",
        snapshot.signature.mesh_entities as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Water Mesh Entities",
        snapshot.signature.water_mesh_entities as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Collider Ready Entities",
        snapshot.signature.collider_ready_entities as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Collider Pending Entities",
        snapshot.signature.collider_pending_entities as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready High LOD Chunks",
        snapshot.signature.high_lod_chunks as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Low LOD Chunks",
        snapshot.signature.low_lod_chunks as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Culled Chunks",
        snapshot.signature.culled_chunks as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Chunks Meshed This Frame",
        snapshot.chunks_meshed_this_frame as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Chunks Skipped This Frame",
        snapshot.chunks_skipped_this_frame as f64,
    );
    timing.record_count(
        frame,
        "Bench Ready Chunks Skipped Page Owned",
        snapshot.chunks_skipped_page_owned as f64,
    );
}

fn bench_render_ready_signature(timing: &AreaTimingRecorder) -> Option<BenchRenderReadySignature> {
    let naadf_preview_active = latest_counter_u32(timing, "naadf.preview_active").unwrap_or(0);
    if naadf_preview_active > 0 {
        return Some(BenchRenderReadySignature {
            naadf_preview_active,
            naadf_preview_first_hit_dispatches: latest_counter_u32(
                timing,
                "naadf.preview_first_hit_dispatches_last_frame",
            )?,
            naadf_preview_composite_passes: latest_counter_u32(
                timing,
                "naadf.preview_composite_passes_last_frame",
            )?,
            naadf_preview_pixels: latest_counter_u32(timing, "naadf.preview_pixels_last_frame")?,
            ..Default::default()
        });
    }

    Some(BenchRenderReadySignature {
        opaque_items: latest_counter_u32(timing, "Render Phase Items Opaque3d Total")?,
        alpha_mask_items: latest_counter_u32(timing, "Render Phase Items AlphaMask3d Total")?,
        transparent_items: latest_counter_u32(timing, "Render Phase Items Transparent3d Total")?,
        shadow_items: latest_counter_u32(timing, "Render Phase Items Shadow Total")?,
        terrain_items: latest_counter_u32(timing, "Render Phase Items Terrain")?,
        water_items: latest_counter_u32(timing, "Render Phase Items Water")?,
        instanced_prop_items: latest_counter_u32(timing, "Render Phase Items Instanced Props")?,
        queued_instanced_draws: latest_counter_u32(timing, "Render Instancing Props Queued Total")?,
        queued_instanced_instances: latest_counter_u32(
            timing,
            "Render Instancing Queue Instances",
        )?,
        water_reflection_sampled: latest_counter_u32(timing, "Water Reflection Sampled")?,
        terrain_full_triplanar_meshes: latest_counter_u32(
            timing,
            "Terrain Material Quality FullTriplanar Meshes",
        )?,
        terrain_cheap_triplanar_meshes: latest_counter_u32(
            timing,
            "Terrain Material Quality CheapTriplanar Meshes",
        )?,
        terrain_triplanar_textures_configured: latest_counter_u32(
            timing,
            "Terrain Triplanar Textures Configured",
        )?,
        naadf_preview_active: 0,
        naadf_preview_first_hit_dispatches: 0,
        naadf_preview_composite_passes: 0,
        naadf_preview_pixels: 0,
    })
}

fn latest_counter_u32(timing: &AreaTimingRecorder, area: &str) -> Option<u32> {
    timing
        .latest_counter_value(area)
        .map(|value| value.round().max(0.0) as u32)
}

fn record_bench_render_ready_counts(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    signature: Option<BenchRenderReadySignature>,
    wait_frames: u32,
    stable_frames: u32,
    min_frames_satisfied: bool,
    timed_out: bool,
) {
    let ready = signature.is_some()
        && min_frames_satisfied
        && !timed_out
        && stable_frames >= RENDER_READY_STABLE_FRAMES;
    timing.record_count(frame, "Bench Render Ready Indicator", ready as u8 as f64);
    timing.record_count(
        frame,
        "Bench Render Ready Min Frames Satisfied",
        min_frames_satisfied as u8 as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Timed Out",
        timed_out as u8 as f64,
    );
    timing.record_count(frame, "Bench Render Ready Wait Frames", wait_frames as f64);
    timing.record_count(
        frame,
        "Bench Render Ready Stable Frames",
        stable_frames as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Signature Available",
        signature.is_some() as u8 as f64,
    );

    let Some(signature) = signature else {
        return;
    };
    timing.record_count(
        frame,
        "Bench Render Ready Opaque Items",
        signature.opaque_items as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready AlphaMask Items",
        signature.alpha_mask_items as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Transparent Items",
        signature.transparent_items as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Shadow Items",
        signature.shadow_items as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Terrain Items",
        signature.terrain_items as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Water Items",
        signature.water_items as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Instanced Prop Items",
        signature.instanced_prop_items as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Instanced Draws",
        signature.queued_instanced_draws as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Instanced Instances",
        signature.queued_instanced_instances as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Water Reflection Sampled",
        signature.water_reflection_sampled as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Terrain FullTriplanar Meshes",
        signature.terrain_full_triplanar_meshes as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Terrain CheapTriplanar Meshes",
        signature.terrain_cheap_triplanar_meshes as f64,
    );
    timing.record_count(
        frame,
        "Bench Render Ready Terrain Triplanar Textures Configured",
        signature.terrain_triplanar_textures_configured as f64,
    );
}

fn record_bench_gameplay_counts(
    timing: &mut AreaTimingRecorder,
    frame: u32,
    checkpoint: &BenchCheckpoint,
    state: &mut BenchState,
    player: &mut Query<
        (
            &mut Transform,
            Option<&mut Position>,
            Option<&mut LinearVelocity>,
        ),
        (With<Player>, Without<PlayerCamera>),
    >,
    world: &VoxelWorld,
    collider_query: &Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
) {
    let Some(gameplay) = checkpoint.gameplay.as_ref() else {
        return;
    };

    let Ok((transform, _position, velocity)) = player.single_mut() else {
        return;
    };
    let velocity = velocity
        .as_deref()
        .map(|velocity| velocity.0)
        .unwrap_or(Vec3::ZERO);
    let horizontal_speed = Vec2::new(velocity.x, velocity.z).length();
    state.gameplay_min_horizontal_speed = state.gameplay_min_horizontal_speed.min(horizontal_speed);
    state.gameplay_min_y = state.gameplay_min_y.min(transform.translation.y);

    let input_active =
        Vec2::new(gameplay.movement[0], gameplay.movement[1]).length_squared() > 0.25;
    let stalled = input_active && horizontal_speed < gameplay.min_horizontal_speed;
    if stalled {
        state.gameplay_stall_frames += 1;
    } else {
        state.gameplay_stall_frames = 0;
    }

    if state.gameplay_stall_frames == gameplay.stall_after_frames {
        state.gameplay_stall_events += 1;
        warn!(
            "Bench gameplay stall: checkpoint='{}' run={} frame={} speed={:.2} min={:.2} stall_events={}",
            checkpoint.name,
            state.run_index,
            state.hold_elapsed_frames,
            horizontal_speed,
            gameplay.min_horizontal_speed,
            state.gameplay_stall_events,
        );
    }
    if gameplay.fail_on_stall && state.gameplay_stall_events > gameplay.max_stall_events {
        state.gameplay_failed = true;
    }

    let sample = gameplay_trace_sample(
        checkpoint,
        state.run_index,
        state.hold_elapsed_frames,
        transform.translation,
        velocity,
        horizontal_speed,
        world,
        collider_query,
    );
    if sample.falling_through && !state.gameplay_was_falling_through {
        state.gameplay_fall_events += 1;
        warn!(
            "Bench gameplay fall-through: checkpoint='{}' run={} frame={} pos=({:.2},{:.2},{:.2}) vel=({:.2},{:.2},{:.2}) validity={} surface_delta={:?} collider_ready={} collider_pending={}",
            checkpoint.name,
            state.run_index,
            state.hold_elapsed_frames,
            sample.position_x,
            sample.position_y,
            sample.position_z,
            sample.velocity_x,
            sample.velocity_y,
            sample.velocity_z,
            sample.validity,
            sample.surface_delta,
            sample.collider_ready,
            sample.collider_pending,
        );
    }
    if sample.falling_through {
        state.gameplay_fall_through_frames += 1;
        if state.gameplay_fall_through_frames >= GAMEPLAY_FALL_FAILURE_FRAMES {
            state.gameplay_failed = true;
        }
    } else {
        state.gameplay_fall_through_frames = 0;
    }
    state.gameplay_was_falling_through = sample.falling_through;
    state.gameplay_trace.push(sample);

    timing.record_count(
        frame,
        "Bench Gameplay Input Active",
        input_active as u8 as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Horizontal Speed",
        horizontal_speed as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Stall Frames",
        state.gameplay_stall_frames as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Stall Events",
        state.gameplay_stall_events as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Failed",
        state.gameplay_failed as u8 as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Fall Events",
        state.gameplay_fall_events as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Fall Through Frames",
        state.gameplay_fall_through_frames as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Dig Attempts",
        state.gameplay_dig_attempts as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Dig Applied",
        state.gameplay_dig_applied as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Dig Rejected Crust",
        state.gameplay_dig_rejected_crust as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Dig Failed",
        state.gameplay_dig_failed as u8 as f64,
    );
    timing.record_count(
        frame,
        "Bench Gameplay Player Y",
        transform.translation.y as f64,
    );
    timing.record_count(frame, "Bench Gameplay Min Y", state.gameplay_min_y as f64);
}

fn gameplay_trace_sample(
    checkpoint: &BenchCheckpoint,
    run_index: u32,
    frame: u32,
    position: Vec3,
    velocity: Vec3,
    horizontal_speed: f32,
    world: &VoxelWorld,
    collider_query: &Query<(&ChunkMesh, Option<&ChunkCollider>, Option<&NeedsCollider>)>,
) -> GameplayTraceSample {
    let block = position.floor().as_ivec3();
    let chunk = VoxelWorld::world_to_chunk(block);
    let expected_surface_y = find_surface_spawn(
        world,
        block.x,
        block.z,
        &SpawnColliderReadiness::default(),
        false,
    )
    .ok()
    .map(|spawn| spawn.position.y);
    let surface_delta = expected_surface_y.map(|surface_y| position.y - surface_y);
    let validity = classify_player_world_validity(world, position);
    let falling_through = !validity.is_valid()
        || position.y < world.bounds().min_breakable_y as f32
        || surface_delta.is_some_and(|delta| delta < -2.0);
    let mut collider_ready = false;
    let mut collider_pending = false;
    for (chunk_mesh, collider, needs_collider) in collider_query.iter() {
        if chunk_mesh.chunk_position == chunk {
            collider_ready |= collider.is_some() && needs_collider.is_none();
            collider_pending |= needs_collider.is_some();
        }
    }

    GameplayTraceSample {
        frame,
        run_index,
        checkpoint: checkpoint.name.clone(),
        position_x: position.x,
        position_y: position.y,
        position_z: position.z,
        velocity_x: velocity.x,
        velocity_y: velocity.y,
        velocity_z: velocity.z,
        horizontal_speed,
        chunk_x: chunk.x,
        chunk_y: chunk.y,
        chunk_z: chunk.z,
        expected_surface_y,
        surface_delta,
        validity: validity.label().to_string(),
        falling_through,
        collider_ready,
        collider_pending,
    }
}

fn apply_fog_tier_if_supported(
    checkpoint: &BenchCheckpoint,
    fog_quality: Option<&mut FogQuality>,
    warned_missing_fog_quality: &mut bool,
) {
    let Some(tier) = checkpoint.fog_tier.as_deref() else {
        return;
    };

    let Some(fog_quality) = fog_quality else {
        if !*warned_missing_fog_quality {
            warn!("bench scene requested fog_tier, but FogQuality resource is unavailable");
            *warned_missing_fog_quality = true;
        }
        return;
    };

    match fog_quality_tier_from_str(tier) {
        Some(tier) => {
            fog_quality.tier = tier;
            fog_quality.user_override = true;
        }
        None => warn!("unknown fog_tier '{}' in bench scene", tier),
    }
}

fn fog_quality_tier_from_str(value: &str) -> Option<FogQualityTier> {
    match value.to_ascii_lowercase().as_str() {
        "off" => Some(FogQualityTier::Off),
        "low" => Some(FogQualityTier::Low),
        "medium" => Some(FogQualityTier::Medium),
        "high" => Some(FogQualityTier::High),
        _ => None,
    }
}

fn volumetric_fog_tier_cost_ms(tier: FogQualityTier) -> f64 {
    match tier {
        FogQualityTier::High => 6.0,
        FogQualityTier::Medium => 3.0,
        FogQualityTier::Low => 1.5,
        FogQualityTier::Off => 0.0,
    }
}

fn load_scene(path: &Path) -> Result<BenchScene, Box<dyn std::error::Error>> {
    let text = std::fs::read_to_string(path)?;
    let scene: BenchScene = toml::from_str(&text)?;
    Ok(scene)
}

pub fn bench_scene_requires_gameplay(path: &Path) -> bool {
    #[derive(Deserialize)]
    struct ProbeScene {
        #[serde(rename = "checkpoint", default)]
        checkpoints: Vec<ProbeCheckpoint>,
    }

    #[derive(Deserialize)]
    struct ProbeCheckpoint {
        gameplay: Option<toml::Value>,
    }

    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| toml::from_str::<ProbeScene>(&text).ok())
        .map(|scene| {
            scene
                .checkpoints
                .iter()
                .any(|checkpoint| checkpoint.gameplay.is_some())
        })
        .unwrap_or(false)
}

pub fn bench_scene_requires_inventory_ui(path: &Path) -> bool {
    #[derive(Deserialize)]
    struct ProbeScene {
        #[serde(rename = "checkpoint", default)]
        checkpoints: Vec<ProbeCheckpoint>,
    }

    #[derive(Deserialize)]
    struct ProbeCheckpoint {
        inventory_ui: Option<toml::Value>,
        #[serde(default)]
        screenshot_points: Vec<ProbeScreenshotPoint>,
    }

    #[derive(Deserialize)]
    struct ProbeScreenshotPoint {
        inventory_category: Option<toml::Value>,
    }

    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| toml::from_str::<ProbeScene>(&text).ok())
        .map(|scene| {
            scene.checkpoints.iter().any(|checkpoint| {
                checkpoint.inventory_ui.is_some()
                    || checkpoint
                        .screenshot_points
                        .iter()
                        .any(|point| point.inventory_category.is_some())
            })
        })
        .unwrap_or(false)
}

pub fn bench_scene_skips_props(path: &Path) -> bool {
    #[derive(Deserialize)]
    struct ProbeScene {
        #[serde(default)]
        skip_props: bool,
    }

    std::fs::read_to_string(path)
        .ok()
        .and_then(|text| toml::from_str::<ProbeScene>(&text).ok())
        .map(|scene| scene.skip_props)
        .unwrap_or(false)
}

fn run_file_name(
    scene_path: &Path,
    checkpoint: &BenchCheckpoint,
    marker: Option<&str>,
    run_index: u32,
    ext: &str,
) -> String {
    let scene = scene_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "scene".to_string());
    match marker {
        Some(marker) => format!(
            "{}-{}-{}-run{}.{}",
            sanitize(&scene),
            sanitize(&checkpoint.name),
            sanitize(marker),
            run_index,
            ext
        ),
        None => format!(
            "{}-{}-run{}.{}",
            sanitize(&scene),
            sanitize(&checkpoint.name),
            run_index,
            ext
        ),
    }
}

fn sanitize(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn vec3(value: [f32; 3]) -> Vec3 {
    Vec3::new(value[0], value[1], value[2])
}

fn default_motion_kind() -> String {
    "static".to_string()
}

fn default_freeze_terrain_lod_after_ready() -> bool {
    true
}

fn default_gameplay_movement() -> [f32; 2] {
    [0.0, 1.0]
}

fn default_gameplay_border_turn_margin() -> f32 {
    8.0
}

fn default_gameplay_min_horizontal_speed() -> f32 {
    2.0
}

fn default_gameplay_stall_after_frames() -> u32 {
    18
}

fn default_dig_probe_start_frame() -> u32 {
    60
}

fn default_dig_probe_interval_frames() -> u32 {
    0
}

fn default_dig_probe_radius() -> i32 {
    1
}

fn default_true() -> bool {
    true
}

fn default_startup_trace_max_phase_frames() -> u32 {
    12_000
}

fn median(mut values: Vec<f64>) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    values[values.len() / 2]
}

fn default_output_dir() -> PathBuf {
    PathBuf::from("bench-runs").join(utc_timestamp_for_path(SystemTime::now()))
}

fn git_info() -> (Option<String>, Option<bool>) {
    let sha = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string());
    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| !output.stdout.is_empty());
    (sha, dirty)
}

fn utc_timestamp_for_path(time: SystemTime) -> String {
    utc_timestamp(time).replace(':', "-")
}

fn utc_timestamp(time: SystemTime) -> String {
    let secs = time
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let second_of_day = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = second_of_day / 3_600;
    let minute = (second_of_day % 3_600) / 60;
    let second = second_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

fn civil_from_days(days_since_unix_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_unix_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + if month <= 2 { 1 } else { 0 };
    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::chunk::Chunk;
    use crate::voxel::types::VoxelType;
    use crate::voxel::world::VoxelSample;

    #[test]
    fn startup_trace_scene_config_deserializes() {
        let scene: BenchScene = toml::from_str(
            r#"
seed = 1
duration_warmup_secs = 0.0
median_runs = 1
chunk_load_radius = 6

[startup_trace]
enabled = true
capture_csv = true
max_phase_frames = 12000

[[checkpoint]]
name = "startup"
position = [0.0, 1.0, 2.0]
look_at = [3.0, 4.0, 5.0]
time_of_day = 0.25
hold_frames = 30
"#,
        )
        .expect("startup trace scene should deserialize");

        assert!(scene.startup_trace.enabled);
        assert!(scene.startup_trace.capture_csv);
        assert_eq!(scene.startup_trace.max_phase_frames, 12_000);
        assert_eq!(scene.checkpoints.len(), 1);
    }

    #[test]
    fn hole_probe_checkpoint_config_deserializes() {
        let scene: BenchScene = toml::from_str(
            r#"
seed = 1
duration_warmup_secs = 0.0
median_runs = 1
chunk_load_radius = 6

[[checkpoint]]
name = "mctx-static"
position = [285.84256, 38.747417, 144.33394]
look_at = [188.1263, 36.347652, 123.22059]
time_of_day = 0.42
hold_frames = 90
hole_probe = { frame = 30, label = "mctx-static-mountain-hole", target_voxel = [108, 34, 106], player_position = [285.84256, 37.047417, 144.33394], camera_position = [285.84256, 38.747417, 144.33394], camera_direction = [-0.97716266, -0.02399765, -0.21113348] }
"#,
        )
        .expect("hole-probe bench scene should deserialize");

        let probe = scene.checkpoints[0]
            .hole_probe
            .as_ref()
            .expect("checkpoint should have a hole probe");
        assert_eq!(probe.frame, 30);
        assert_eq!(probe.target_voxel, [108, 34, 106]);
        assert_eq!(probe.label.as_deref(), Some("mctx-static-mountain-hole"));
    }

    #[test]
    fn forensics_scene_config_deserializes() {
        let scene: BenchScene = toml::from_str(
            r#"
seed = 1
duration_warmup_secs = 0.0
median_runs = 1
chunk_load_radius = 6

[forensics]
terrain_mesher = "mc_transvoxel"
mc_transitions = "disabled_keep_boundary_rows"

[[checkpoint]]
name = "mctx-static"
position = [285.84256, 38.747417, 144.33394]
look_at = [188.1263, 36.347652, 123.22059]
time_of_day = 0.42
hold_frames = 90
"#,
        )
        .expect("forensics bench scene should deserialize");

        let forensics = scene
            .forensics
            .expect("forensics section should produce a config");
        assert!(forensics.enabled);
        assert_eq!(
            forensics.terrain_mesher,
            BenchForensicsTerrainMesher::McTransvoxel
        );
        assert_eq!(
            forensics.mc_transitions,
            BenchForensicsMcTransitions::DisabledKeepBoundaryRows
        );
    }

    #[test]
    fn naadf_bench_cache_toggles_deserialize() {
        let scene: BenchScene = toml::from_str(
            r#"
seed = 1
duration_warmup_secs = 0.0
median_runs = 1
chunk_load_radius = 6

[render_toggles]
voxel_ray_backend = "naadf"
experimental_render_mode = "naadf_preview"
disable_terrain_meshes = true
naadf_force_cpu_builder = true
naadf_radius_chunks = 3
naadf_max_chunks = 384
naadf_max_gpu_memory_mb = 768
naadf_max_chunk_updates_per_frame = 384
naadf_max_upload_bytes_per_frame = 67108864
naadf_history_resolution_scale = 0.125
naadf_preview_max_ray_steps = 128
naadf_preview_bounce_count = 0
naadf_preview_spatial_radius = 0
naadf_preview_composite_mode = "picture_in_picture"
naadf_preview_show_miss_sky = true
naadf_path_b_compositor_mode = "depth_audit"
naadf_path_b_foundation_200_210_verified = true
naadf_path_b_depth_epsilon = 0.5
naadf_path_b_enable_temporal = false
naadf_path_b_counters_enabled = true
naadf_preview_local_lights_enabled = true
naadf_preview_local_light_limit = 12
naadf_preview_local_light_shadows_enabled = true
naadf_spawn_demo_lights = true
naadf_use_for_gi_secondary = true
naadf_use_for_sun_visibility = true
naadf_froxel_sun_mask_enabled = true
naadf_use_for_terrain_ao = true
naadf_use_for_contact_shadows = true

[[checkpoint]]
name = "startup"
position = [0.0, 1.0, 2.0]
look_at = [3.0, 4.0, 5.0]
time_of_day = 0.25
hold_frames = 30
"#,
        )
        .expect("NAADF bench cache toggles should deserialize");

        let toggles = scene.render_toggles;
        assert_eq!(toggles.voxel_ray_backend.as_deref(), Some("naadf"));
        assert_eq!(
            toggles.experimental_render_mode.as_deref(),
            Some("naadf_preview")
        );
        assert!(toggles.disable_terrain_meshes);
        assert_eq!(toggles.naadf_radius_chunks, Some(3));
        assert_eq!(toggles.naadf_max_chunks, Some(384));
        assert_eq!(toggles.naadf_max_gpu_memory_mb, Some(768));
        assert_eq!(toggles.naadf_max_chunk_updates_per_frame, Some(384));
        assert_eq!(toggles.naadf_max_upload_bytes_per_frame, Some(67_108_864));
        assert_eq!(toggles.naadf_history_resolution_scale, Some(0.125));
        assert_eq!(toggles.naadf_preview_max_ray_steps, Some(128));
        assert_eq!(toggles.naadf_preview_bounce_count, Some(0));
        assert_eq!(toggles.naadf_preview_spatial_radius, Some(0));
        assert_eq!(
            toggles.naadf_preview_composite_mode.as_deref(),
            Some("picture_in_picture")
        );
        assert_eq!(toggles.naadf_preview_show_miss_sky, Some(true));
        assert_eq!(
            toggles.naadf_path_b_compositor_mode.as_deref(),
            Some("depth_audit")
        );
        assert_eq!(toggles.naadf_path_b_foundation_200_210_verified, Some(true));
        assert_eq!(toggles.naadf_path_b_depth_epsilon, Some(0.5));
        assert_eq!(toggles.naadf_path_b_enable_temporal, Some(false));
        assert_eq!(toggles.naadf_path_b_counters_enabled, Some(true));
        assert_eq!(toggles.naadf_preview_local_lights_enabled, Some(true));
        assert_eq!(toggles.naadf_preview_local_light_limit, Some(12));
        assert_eq!(
            toggles.naadf_preview_local_light_shadows_enabled,
            Some(true)
        );
        assert!(toggles.naadf_spawn_demo_lights);
        assert_eq!(toggles.naadf_use_for_gi_secondary, Some(true));
        assert_eq!(toggles.naadf_use_for_sun_visibility, Some(true));
        assert_eq!(toggles.naadf_froxel_sun_mask_enabled, Some(true));
        assert_eq!(toggles.naadf_use_for_terrain_ao, Some(true));
        assert_eq!(toggles.naadf_use_for_contact_shadows, Some(true));
    }

    #[test]
    fn bench_world_cache_uses_shared_permissive_load() {
        let scene: BenchScene = toml::from_str(
            r#"
seed = 1
duration_warmup_secs = 0.0
median_runs = 1
chunk_load_radius = 6
world_cache_path = "bench-runs/cache/shared.bin"

[[checkpoint]]
name = "startup"
position = [0.0, 1.0, 2.0]
look_at = [3.0, 4.0, 5.0]
time_of_day = 0.25
hold_frames = 30
"#,
        )
        .expect("bench scene should deserialize");

        let persistence = bench_world_persistence(&scene);

        assert_eq!(
            persistence.path,
            PathBuf::from("bench-runs/cache/shared.bin")
        );
        assert!(!persistence.force_regenerate);
        assert!(!persistence.auto_save);
        assert!(persistence.allow_terrain_fingerprint_mismatch);
    }

    #[test]
    fn existing_bench_world_cache_is_not_rewritten_by_default() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let path = temp_dir.path().join("world.bin");
        std::fs::write(&path, b"keep me").expect("seed cache file");
        let scene = BenchScene {
            seed: 1,
            duration_warmup_secs: 0.0,
            median_runs: 1,
            chunk_load_radius: 1,
            world_size_chunks: Some([1, 1, 1]),
            world_cache_path: Some(path.clone()),
            world_cache_regenerate: false,
            skip_props: false,
            freeze_terrain_lod_after_ready: true,
            startup_trace: StartupTraceConfig::default(),
            render_toggles: BenchRenderToggles::default(),
            forensics: None,
            lod_seam_hard_case_fixture: false,
            checkpoints: Vec::new(),
        };
        let mut world = VoxelWorld::new(IVec3::ONE);
        world.insert_chunk(Chunk::new(IVec3::ZERO));

        save_bench_world_cache_if_ready(&scene, &world);

        assert_eq!(
            std::fs::read(&path).expect("cache should remain readable"),
            b"keep me"
        );
    }

    #[test]
    fn startup_trace_events_are_ordered_with_deltas() {
        let mut trace =
            StartupTraceRunBuilder::new(StartupTraceConfig::default(), Instant::now(), 7);
        trace.event("checkpoint_setup", 8);
        trace.event("hold_start", 10);
        let record = trace.record(10, BenchReadySignature::default(), None);

        assert_eq!(record.total_startup_frames, 3);
        assert_eq!(
            record
                .events
                .iter()
                .map(|event| event.name.as_str())
                .collect::<Vec<_>>(),
            vec!["process_start", "checkpoint_setup", "hold_start"]
        );
        assert!(record.events.iter().all(|event| event.delta_secs >= 0.0));
    }

    #[test]
    fn run_look_sweep_moves_position_and_look_target() {
        let checkpoint: BenchCheckpoint = toml::from_str(
            r#"
name = "forward-sweep"
position = [0.0, 10.0, 0.0]
look_at = [0.0, 10.0, 10.0]
time_of_day = 0.5
hold_frames = 11
motion = { kind = "run_look_sweep", end_position = [0.0, 10.0, 10.0], end_look_at = [10.0, 10.0, 10.0] }
"#,
        )
        .expect("checkpoint should deserialize");

        let start = transform_for_checkpoint(&checkpoint, 0);
        let end = transform_for_checkpoint(&checkpoint, 10);

        assert!(start.translation.z < end.translation.z);
        assert_eq!(end.translation, Vec3::new(0.0, 10.0, 10.0));
        assert_ne!(start.forward(), end.forward());
    }

    #[test]
    fn gameplay_dig_probe_config_deserializes() {
        let checkpoint: BenchCheckpoint = toml::from_str(
            r#"
name = "dig-crust"
position = [0.0, 10.0, 0.0]
look_at = [0.0, 8.0, 1.0]
time_of_day = 0.5
hold_frames = 120

[gameplay]
movement = [0.0, 0.0]

[gameplay.dig_probe]
enabled = true
start_frame = 12
radius = 2
"#,
        )
        .expect("checkpoint should deserialize");

        let dig_probe = checkpoint
            .gameplay
            .and_then(|gameplay| gameplay.dig_probe)
            .expect("dig probe");
        assert!(dig_probe.enabled);
        assert_eq!(dig_probe.start_frame, 12);
        assert_eq!(dig_probe.radius, 2);
        assert_eq!(dig_probe.interval_frames, 0);
        assert!(dig_probe.require_crust_rejection);
    }

    #[test]
    fn gameplay_only_checkpoint_does_not_require_render_ready() {
        let checkpoint: BenchCheckpoint = toml::from_str(
            r#"
name = "walk"
position = [0.0, 10.0, 0.0]
look_at = [0.0, 8.0, 1.0]
time_of_day = 0.5
hold_frames = 120
screenshot = false

[gameplay]
movement = [0.0, 1.0]
"#,
        )
        .expect("checkpoint should deserialize");

        assert!(!checkpoint_requires_render_ready(&checkpoint));
    }

    #[test]
    fn screenshot_checkpoint_requires_render_ready() {
        let checkpoint: BenchCheckpoint = toml::from_str(
            r#"
name = "visual"
position = [0.0, 10.0, 0.0]
look_at = [0.0, 8.0, 1.0]
time_of_day = 0.5
hold_frames = 120

[[screenshot_points]]
name = "final"
frame = 1
"#,
        )
        .expect("checkpoint should deserialize");

        assert!(checkpoint_requires_render_ready(&checkpoint));
    }

    #[test]
    fn gameplay_ready_snapshot_waits_for_colliders() {
        let mut snapshot = BenchReadySnapshot {
            signature: BenchReadySignature {
                mesh_entities: 1,
                collider_pending_entities: 1,
                ..Default::default()
            },
            require_collider_ready: true,
            ..Default::default()
        };

        assert!(!snapshot.is_ready_candidate());

        snapshot.signature.collider_ready_entities = 1;
        assert!(snapshot.is_ready_candidate());
    }

    #[test]
    fn visual_ready_snapshot_does_not_require_colliders() {
        let snapshot = BenchReadySnapshot {
            signature: BenchReadySignature {
                mesh_entities: 1,
                collider_pending_entities: 4,
                ..Default::default()
            },
            require_collider_ready: false,
            ..Default::default()
        };

        assert!(snapshot.is_ready_candidate());
    }

    #[test]
    fn gameplay_ready_snapshot_ignores_global_visual_mesh_work() {
        let snapshot = BenchReadySnapshot {
            signature: BenchReadySignature {
                mesh_entities: 1,
                collider_ready_entities: 4,
                high_lod_chunks: 128,
                low_lod_chunks: 32,
                ..Default::default()
            },
            chunks_meshed_this_frame: 4,
            chunks_skipped_this_frame: 2,
            chunks_skipped_page_owned: 0,
            require_collider_ready: true,
        };

        assert!(snapshot.is_ready_candidate());
    }

    #[test]
    fn visual_ready_snapshot_ignores_background_mesh_work() {
        let snapshot = BenchReadySnapshot {
            signature: BenchReadySignature {
                mesh_entities: 1,
                ..Default::default()
            },
            chunks_meshed_this_frame: 1,
            require_collider_ready: false,
            ..Default::default()
        };

        assert!(snapshot.is_ready_candidate());
    }

    #[test]
    fn gameplay_stability_signature_ignores_global_visual_counts() {
        let snapshot = BenchReadySnapshot {
            signature: BenchReadySignature {
                missing_chunks: 0,
                dirty_chunks: 0,
                mesh_entities: 12,
                water_mesh_entities: 4,
                collider_ready_entities: 7,
                collider_pending_entities: 0,
                high_lod_chunks: 80,
                low_lod_chunks: 20,
                culled_chunks: 3,
            },
            require_collider_ready: true,
            ..Default::default()
        };

        assert_eq!(
            snapshot.stability_signature(),
            BenchReadySignature {
                collider_ready_entities: 1,
                ..Default::default()
            }
        );
    }

    #[test]
    fn gameplay_stability_signature_treats_ready_count_as_boolean() {
        let mut first = BenchReadySnapshot {
            signature: BenchReadySignature {
                collider_ready_entities: 1,
                ..Default::default()
            },
            require_collider_ready: true,
            ..Default::default()
        };
        let second = BenchReadySnapshot {
            signature: BenchReadySignature {
                collider_ready_entities: 400,
                ..Default::default()
            },
            require_collider_ready: true,
            ..Default::default()
        };

        assert_eq!(first.stability_signature(), second.stability_signature());

        first.signature.collider_pending_entities = 1;
        assert_eq!(first.stability_signature(), second.stability_signature());
    }

    #[test]
    fn gameplay_start_position_prefers_explicit_gameplay_start() {
        let checkpoint: BenchCheckpoint = toml::from_str(
            r#"
name = "walk"
position = [10.0, 20.0, 30.0]
look_at = [0.0, 8.0, 1.0]
time_of_day = 0.5
hold_frames = 120

[gameplay]
start_position = [40.0, 50.0, 60.0]
movement = [0.0, 1.0]
"#,
        )
        .expect("checkpoint should deserialize");

        assert_eq!(
            gameplay_start_or_checkpoint_position(&checkpoint),
            Vec3::new(40.0, 50.0, 60.0)
        );
    }

    #[test]
    fn bench_border_turn_rotates_clockwise_when_edge_is_ahead() {
        let bounds = WorldBounds::from_size_chunks(IVec3::new(32, 4, 32));
        let turn = bench_border_turn_direction(
            bounds,
            Vec3::new(256.5, 32.0, bounds.horizontal_max.y as f32 - 2.0),
            Vec3::Z,
            8.0,
        )
        .expect("north edge should request a turn");

        assert!(turn.x > 0.99);
        assert!(turn.z.abs() < 0.01);
    }

    #[test]
    fn bench_border_turn_uses_open_side_at_corner() {
        let bounds = WorldBounds::from_size_chunks(IVec3::new(32, 4, 32));
        let turn = bench_border_turn_direction(
            bounds,
            Vec3::new(
                bounds.horizontal_max.x as f32 - 2.0,
                32.0,
                bounds.horizontal_max.y as f32 - 2.0,
            ),
            Vec3::Z,
            8.0,
        )
        .expect("corner edge should request a turn");

        assert!(turn.x < -0.99);
        assert!(turn.z.abs() < 0.01);
    }

    #[test]
    fn bench_border_turn_ignores_safe_mid_world_direction() {
        let bounds = WorldBounds::from_size_chunks(IVec3::new(32, 4, 32));

        assert!(
            bench_border_turn_direction(bounds, Vec3::new(256.5, 32.0, 256.5), Vec3::Z, 8.0)
                .is_none()
        );
    }

    #[test]
    fn bench_pathfinder_steers_around_missing_ground_ahead() {
        let mut world = flat_test_world(IVec3::new(4, 2, 4), 8);
        for x in 0..64 {
            for z in 22..64 {
                clear_test_column(&mut world, x, z, 8);
            }
        }

        let direction = bench_best_walk_direction(
            &world,
            &SpawnColliderReadiness::default(),
            Vec3::new(32.5, 9.5, 12.5),
            Vec3::Z,
            8.0,
        )
        .expect("missing ground ahead should produce a side route");

        assert!(direction.x.abs() > 0.75);
        assert!(direction.z < 0.5);
    }

    #[test]
    fn bench_pathfinder_keeps_forward_route_when_height_is_safe() {
        let world = flat_test_world(IVec3::new(4, 2, 4), 8);

        assert!(
            bench_best_walk_direction(
                &world,
                &SpawnColliderReadiness::default(),
                Vec3::new(32.5, 9.5, 12.5),
                Vec3::Z,
                8.0,
            )
            .is_none()
        );
    }

    #[test]
    fn bench_dig_probe_removes_breakable_column_but_rejects_crust() {
        let mut world = flat_test_world(IVec3::new(2, 2, 2), 8);
        let probe = BenchDigProbe {
            enabled: true,
            start_frame: 0,
            interval_frames: 0,
            radius: 0,
            require_crust_rejection: true,
        };

        let result = apply_bench_dig_probe(&mut world, Vec3::new(8.5, 9.5, 8.5), &probe);

        assert!(result.applied > 0);
        assert!(result.rejected_crust >= 2);
        assert_eq!(
            world.sample_voxel(IVec3::new(8, world.bounds().min_breakable_y - 1, 8)),
            VoxelSample::InBounds(VoxelType::Bedrock)
        );
        assert_eq!(
            world.sample_voxel(IVec3::new(8, world.bounds().bedrock_floor_y, 8)),
            VoxelSample::InBounds(VoxelType::Bedrock)
        );
    }

    fn flat_test_world(size_chunks: IVec3, floor_y: i32) -> VoxelWorld {
        let mut world = VoxelWorld::new(size_chunks);
        for chunk_x in 0..size_chunks.x {
            for chunk_y in 0..size_chunks.y {
                for chunk_z in 0..size_chunks.z {
                    world.insert_chunk(Chunk::new(IVec3::new(chunk_x, chunk_y, chunk_z)));
                }
            }
        }
        for x in world.bounds().horizontal_min.x..=world.bounds().horizontal_max.x {
            for z in world.bounds().horizontal_min.y..=world.bounds().horizontal_max.y {
                for y in world.bounds().min_breakable_y..=floor_y {
                    world.set_voxel(IVec3::new(x, y, z), VoxelType::TopSoil);
                }
            }
        }
        world
    }

    fn clear_test_column(world: &mut VoxelWorld, x: i32, z: i32, floor_y: i32) {
        for y in world.bounds().min_breakable_y..=floor_y {
            world.set_voxel(IVec3::new(x, y, z), VoxelType::Air);
        }
    }
}
