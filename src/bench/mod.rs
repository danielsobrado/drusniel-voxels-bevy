use crate::atmosphere::{FogQuality, FogQualityTier};
use crate::camera::controller::{CameraMode, PlayerCamera};
use crate::environment::AtmosphereSettings;
use crate::input::config::GameAction;
use crate::input::manager::ActionState;
use crate::interaction::{DebugDetailToggles, TargetedBlock, palette::PlacementPaletteState};
use crate::inventory_ui::InventoryUiState;
use crate::map::MapState;
use crate::menu::{PauseMenuState, SettingsState, VisualSettings};
use crate::performance::{AreaTimingRecorder, write_area_timing_csv};
use crate::player::Player;
use crate::props::instanced_render::{InstancedPropGroup, PropInstanceGroups};
use crate::props::instancing::PropMeshCache;
use crate::props::persistence::PropPersistenceState;
use crate::props::{Prop, PropAssets};
use crate::rendering::building_material::BuildingMesh;
use crate::rendering::quality::RenderQualityPreset;
use crate::rendering::triplanar_material::TerrainMaterialQuality;
use crate::rendering::water_reflection::WaterReflectionConfig;
use crate::voxel::meshing::WaterMesh;
use crate::voxel::plugin::{RuntimeChunkStats, TerrainLodControl};
use crate::voxel::world::VoxelWorld;
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
const SCREENSHOT_WAIT_FRAMES: u32 = 60;
const SCREENSHOT_WAIT_MIN_SECS: f32 = 3.0;
const SCREENSHOT_WAIT_MAX_SECS: f32 = 30.0;

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
        let scene_path = cli.bench.clone()?;
        let output_dir = cli.bench_out.clone().unwrap_or_else(default_output_dir);
        Some(Self {
            scene_path,
            output_dir,
            headless: cli.bench_headless,
        })
    }
}

#[derive(Resource)]
struct BenchSceneResource(BenchScene);

#[derive(Resource, Clone, Copy, Debug, Default, Deserialize)]
pub struct BenchRenderToggles {
    #[serde(default)]
    pub disable_instanced_props: bool,
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
    pub disable_terrain_material_lod: bool,
    #[serde(default)]
    pub prop_subcluster_grid: u8,
    #[serde(default)]
    pub quality_preset: Option<RenderQualityPreset>,
}

#[derive(Debug, Deserialize, Clone, Copy)]
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

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BenchTerrainMaterialQuality {
    #[default]
    Auto,
    FullTriplanar,
    CheapTriplanar,
    SingleProjectionFar,
    AtlasOnlyDebug,
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
    high_lod_chunks: u32,
    low_lod_chunks: u32,
    culled_chunks: u32,
}

#[derive(Clone, Copy, Debug, Default)]
struct BenchReadySnapshot {
    signature: BenchReadySignature,
    chunks_meshed_this_frame: u32,
    chunks_skipped_this_frame: u32,
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
}

impl BenchReadySnapshot {
    fn is_ready_candidate(self) -> bool {
        self.signature.missing_chunks == 0
            && self.signature.dirty_chunks == 0
            && self.chunks_meshed_this_frame == 0
            && self.chunks_skipped_this_frame == 0
            && self.signature.mesh_entities + self.signature.water_mesh_entities > 0
    }
}

#[derive(Debug, Deserialize, Clone)]
struct BenchScene {
    seed: u64,
    duration_warmup_secs: f32,
    median_runs: u32,
    chunk_load_radius: i32,
    #[serde(default = "default_freeze_terrain_lod_after_ready")]
    freeze_terrain_lod_after_ready: bool,
    #[serde(default)]
    startup_trace: StartupTraceConfig,
    #[serde(default)]
    render_toggles: BenchRenderToggles,
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
    motion: Option<BenchMotion>,
    gameplay: Option<BenchGameplay>,
}

#[derive(Debug, Deserialize, Clone)]
struct ScreenshotPoint {
    name: String,
    frame: u32,
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
    checkpoints: Vec<CheckpointSummary>,
}

#[derive(Serialize)]
struct CheckpointSummary {
    name: String,
    fog_tier: Option<String>,
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
    path: String,
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

        let render_toggles = scene.render_toggles;
        if let Some(render_app) = app.get_sub_app_mut(RenderApp) {
            render_app.insert_resource(render_toggles);
        }

        app.insert_resource(BenchSceneResource(scene.clone()))
            .insert_resource(render_toggles)
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
            .add_systems(Startup, setup_bench_environment)
            .add_systems(
                PreUpdate,
                (
                    crate::performance::reset_area_timing_frame,
                    apply_bench_gameplay_input,
                ),
            )
            .add_systems(
                Update,
                (
                    apply_bench_render_toggles,
                    record_startup_trace_observations_system,
                    run_bench_state_machine,
                )
                    .chain(),
            );
    }
}

fn setup_bench_environment(
    mut time: ResMut<Time<Virtual>>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut timing: ResMut<AreaTimingRecorder>,
    mut state: ResMut<BenchState>,
    frame: Res<FrameCount>,
) {
    time.set_max_delta(std::time::Duration::from_millis(100));
    atmosphere.cycle_enabled = false;
    timing.set_enabled(true);
    record_startup_event_once(
        &mut state,
        |seen| &mut seen.bench_environment_ready,
        "bench_environment_ready",
        frame.0,
    );
}

fn apply_bench_render_toggles(
    toggles: Res<BenchRenderToggles>,
    mut visibility_queries: ParamSet<(
        Query<&mut Visibility, With<WaterMesh>>,
        Query<&mut Visibility, With<BuildingMesh>>,
    )>,
    mut directional_lights: Query<&mut DirectionalLight>,
    mut point_lights: Query<&mut PointLight>,
    mut spot_lights: Query<&mut SpotLight>,
    mut reflection_config: Option<ResMut<WaterReflectionConfig>>,
) {
    if toggles.disable_water_meshes {
        for mut visibility in &mut visibility_queries.p0() {
            *visibility = Visibility::Hidden;
        }
    }
    if toggles.disable_buildings {
        for mut visibility in &mut visibility_queries.p1() {
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
    mut timing: ResMut<AreaTimingRecorder>,
    frame: Res<FrameCount>,
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
            state.settle_frames_left = SETTLE_FRAMES;
            state.hold_frames_left = checkpoint.hold_frames;
            state.hold_elapsed_frames = 0;
            state.next_screenshot_point = 0;
            state.current_screenshots.clear();
            state.current_run = None;
            state.gameplay_stall_frames = 0;
            state.gameplay_stall_events = 0;
            state.gameplay_min_horizontal_speed = f32::MAX;
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
            let snapshot = bench_ready_snapshot(
                &world,
                &chunk_stats,
                vec3(checkpoint.position),
                scene.chunk_load_radius,
            );
            let signature_stable = state.ready_last_signature == Some(snapshot.signature);
            if snapshot.is_ready_candidate() && signature_stable {
                state.ready_stable_frames += 1;
            } else {
                state.ready_stable_frames = 0;
            }
            state.ready_wait_frames += 1;
            state.ready_last_signature = Some(snapshot.signature);
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
                        "[BENCH READY TIMEOUT] checkpoint={} run={} wait_frames={} wait_secs={:.1} stable_frames={} min_wait_secs={:.1} missing_chunks={} dirty_chunks={} mesh_entities={} water_mesh_entities={}",
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
                        "[BENCH READY] checkpoint={} run={} wait_frames={} wait_secs={:.1} stable_frames={} min_wait_secs={:.1} mesh_entities={} water_mesh_entities={} high_lod_chunks={} low_lod_chunks={}",
                        checkpoint.name,
                        state.run_index,
                        state.ready_wait_frames,
                        wait_secs,
                        state.ready_stable_frames,
                        READY_MIN_SECS,
                        snapshot.signature.mesh_entities,
                        snapshot.signature.water_mesh_entities,
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
                let checkpoint = &scene.checkpoints[state.checkpoint_index];
                let csv_name =
                    run_file_name(&config.scene_path, checkpoint, None, state.run_index, "csv");
                let csv_path = config.output_dir.join(&csv_name);
                if let Err(err) = write_area_timing_csv(&timing, &csv_path) {
                    warn!("failed to write bench CSV {}: {}", csv_path.display(), err);
                }
                let frame_ms = timing
                    .frame_total_summary()
                    .map(|s| s.avg_ms)
                    .unwrap_or_default();
                let screenshot = if checkpoint.screenshot && checkpoint.screenshot_points.is_empty()
                {
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
                );
                if checkpoint.gameplay.is_none()
                    && let Ok((mut transform, _player_camera)) = camera.single_mut()
                {
                    *transform = transform_for_checkpoint(checkpoint, state.hold_elapsed_frames);
                }
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
        let path =
            capture_bench_screenshot(commands, config, checkpoint, &point.name, state.run_index);
        state.current_screenshots.push(ScreenshotRecord {
            name: point.name.clone(),
            frame: point.frame,
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
    let moves = matches!(kind.as_str(), "run" | "run_jump" | "run_jump_look");

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

    let mut look_at = if matches!(kind.as_str(), "look_sweep" | "run_jump_look") {
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
) -> BenchReadySnapshot {
    let (missing_chunks, dirty_chunks) = chunks_pending_counts(world, position, radius);
    BenchReadySnapshot {
        signature: BenchReadySignature {
            missing_chunks,
            dirty_chunks,
            mesh_entities: chunk_stats.mesh_entities,
            water_mesh_entities: chunk_stats.water_mesh_entities,
            high_lod_chunks: chunk_stats.high_lod_chunks,
            low_lod_chunks: chunk_stats.low_lod_chunks,
            culled_chunks: chunk_stats.culled_chunks,
        },
        chunks_meshed_this_frame: chunk_stats.chunks_meshed_this_frame,
        chunks_skipped_this_frame: chunk_stats.chunks_skipped_this_frame,
    }
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
}

fn bench_render_ready_signature(timing: &AreaTimingRecorder) -> Option<BenchRenderReadySignature> {
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
) {
    let Some(gameplay) = checkpoint.gameplay.as_ref() else {
        return;
    };

    let horizontal_speed = player
        .single_mut()
        .ok()
        .and_then(|(_transform, _position, velocity)| {
            velocity.map(|velocity| Vec2::new(velocity.x, velocity.z).length())
        })
        .unwrap_or(0.0);
    state.gameplay_min_horizontal_speed = state.gameplay_min_horizontal_speed.min(horizontal_speed);

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

fn default_gameplay_min_horizontal_speed() -> f32 {
    2.0
}

fn default_gameplay_stall_after_frames() -> u32 {
    18
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
}
