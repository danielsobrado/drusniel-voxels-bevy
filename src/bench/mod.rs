use crate::atmosphere::{FogQuality, FogQualityTier};
use crate::camera::controller::{CameraMode, PlayerCamera};
use crate::environment::AtmosphereSettings;
use crate::interaction::{DebugDetailToggles, palette::PlacementPaletteState};
use crate::inventory_ui::InventoryUiState;
use crate::map::MapState;
use crate::menu::{PauseMenuState, SettingsState, VisualSettings};
use crate::performance::{AreaTimingRecorder, write_area_timing_csv};
use crate::voxel::world::VoxelWorld;
use bevy::app::AppExit;
use bevy::diagnostic::FrameCount;
use bevy::prelude::*;
use bevy::render::view::screenshot::{Screenshot, save_to_disk};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const SETTLE_FRAMES: u32 = 30;
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

#[derive(Resource)]
struct BenchState {
    phase: BenchPhase,
    checkpoint_index: usize,
    run_index: u32,
    warmup_started: Option<Instant>,
    settle_frames_left: u32,
    hold_frames_left: u32,
    screenshot_wait_left: u32,
    screenshot_wait_started: Option<Instant>,
    hold_elapsed_frames: u32,
    next_screenshot_point: usize,
    current_screenshots: Vec<ScreenshotRecord>,
    current_run: Option<RunRecord>,
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
    WaitChunks,
    Settle,
    Hold,
    Screenshot,
    FinishRun,
    Done,
}

#[derive(Debug, Deserialize, Clone)]
struct BenchScene {
    seed: u64,
    duration_warmup_secs: f32,
    median_runs: u32,
    chunk_load_radius: i32,
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

        if config.headless {
            warn!("--bench-headless requested; falling back to windowed rendering on this backend");
        }

        app.insert_resource(BenchSceneResource(scene.clone()))
            .insert_resource(BenchState {
                phase: BenchPhase::Warmup,
                checkpoint_index: 0,
                run_index: 0,
                warmup_started: None,
                settle_frames_left: 0,
                hold_frames_left: 0,
                screenshot_wait_left: 0,
                screenshot_wait_started: None,
                hold_elapsed_frames: 0,
                next_screenshot_point: 0,
                current_screenshots: Vec::new(),
                current_run: None,
                checkpoints: Vec::new(),
                started: Instant::now(),
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
            .add_systems(Startup, setup_bench_environment)
            .add_systems(PreUpdate, crate::performance::reset_area_timing_frame)
            .add_systems(Update, run_bench_state_machine);
    }
}

fn setup_bench_environment(
    mut time: ResMut<Time<Virtual>>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut timing: ResMut<AreaTimingRecorder>,
) {
    time.set_max_delta(std::time::Duration::from_millis(100));
    atmosphere.cycle_enabled = false;
    timing.set_enabled(true);
}

fn run_bench_state_machine(
    mut commands: Commands,
    config: Res<BenchConfig>,
    scene: Res<BenchSceneResource>,
    mut state: ResMut<BenchState>,
    mut camera: Query<(&mut Transform, &mut PlayerCamera), With<PlayerCamera>>,
    mut atmosphere: ResMut<AtmosphereSettings>,
    mut fog_quality: Option<ResMut<FogQuality>>,
    world: Res<VoxelWorld>,
    mut timing: ResMut<AreaTimingRecorder>,
    frame: Res<FrameCount>,
    mut exit: MessageWriter<AppExit>,
) {
    if state.phase == BenchPhase::Done {
        return;
    }

    let scene = &scene.0;
    if scene.checkpoints.is_empty() {
        finish_bench(&config, &scene, &mut state, &mut exit);
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
            if let Ok((mut transform, mut player_camera)) = camera.single_mut() {
                player_camera.mode = CameraMode::Fly;
                *transform = Transform::from_translation(vec3(checkpoint.position))
                    .looking_at(vec3(checkpoint.look_at), Vec3::Y);
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
            state.phase = BenchPhase::WaitChunks;
        }
        BenchPhase::WaitChunks => {
            let checkpoint = &scene.checkpoints[state.checkpoint_index];
            if chunks_ready(&world, vec3(checkpoint.position), scene.chunk_load_radius) {
                state.phase = BenchPhase::Settle;
            }
        }
        BenchPhase::Settle => {
            if state.settle_frames_left == 0 {
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
                });
                state.phase = BenchPhase::Screenshot;
            } else {
                let checkpoint = &scene.checkpoints[state.checkpoint_index];
                if let Ok((mut transform, _player_camera)) = camera.single_mut() {
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
                finish_bench(&config, &scene, &mut state, &mut exit);
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

fn finish_bench(
    config: &BenchConfig,
    scene: &BenchScene,
    state: &mut BenchState,
    exit: &mut MessageWriter<AppExit>,
) {
    let summary = BenchSummary {
        schema_version: 1,
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

fn chunks_ready(world: &VoxelWorld, position: Vec3, radius: i32) -> bool {
    let center = VoxelWorld::world_to_chunk(position.floor().as_ivec3());
    let world_size = world.world_size_chunks();
    for x in center.x - radius..=center.x + radius {
        for z in center.z - radius..=center.z + radius {
            for y in 0..world_size.y {
                let pos = IVec3::new(x, y, z);
                if !world.chunk_in_bounds(pos) {
                    continue;
                }
                let Some(chunk) = world.get_chunk(pos) else {
                    return false;
                };
                if chunk.is_dirty() {
                    return false;
                }
            }
        }
    }
    true
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
