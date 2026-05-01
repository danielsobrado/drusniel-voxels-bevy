use crate::atmosphere::FogConfig;
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
    fog_tier: Option<String>,
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
}

#[derive(Serialize, Clone)]
struct AreaSummary {
    median_ms: f64,
    p99_ms: f64,
    calls_per_frame: f64,
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
    fog_config: Option<ResMut<FogConfig>>,
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
                fog_config,
                &mut state.warned_missing_fog_quality,
            );
            state.settle_frames_left = SETTLE_FRAMES;
            state.hold_frames_left = checkpoint.hold_frames;
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
                    run_file_name(&config.scene_path, checkpoint, state.run_index, "csv");
                let csv_path = config.output_dir.join(&csv_name);
                if let Err(err) = write_area_timing_csv(&timing, &csv_path) {
                    warn!("failed to write bench CSV {}: {}", csv_path.display(), err);
                }
                let frame_ms = timing
                    .frame_total_summary()
                    .map(|s| s.avg_ms)
                    .unwrap_or_default();
                let screenshot = if checkpoint.screenshot {
                    let png_name =
                        run_file_name(&config.scene_path, checkpoint, state.run_index, "png");
                    let png_path = config.output_dir.join(&png_name);
                    commands
                        .spawn(Screenshot::primary_window())
                        .observe(save_to_disk(png_path.clone()));
                    state.screenshot_wait_left = 60;
                    Some(png_name)
                } else {
                    state.screenshot_wait_left = 0;
                    None
                };
                state.current_run = Some(RunRecord {
                    frame_ms_median: frame_ms,
                    csv: csv_name,
                    screenshot,
                });
                state.phase = BenchPhase::Screenshot;
            } else {
                state.hold_frames_left -= 1;
            }
        }
        BenchPhase::Screenshot => {
            if state.screenshot_wait_left == 0 {
                state.phase = BenchPhase::FinishRun;
            } else {
                state.screenshot_wait_left -= 1;
            }
        }
        BenchPhase::FinishRun => {
            finish_run(&config, &scene, &mut state, &timing);
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

fn finish_run(
    config: &BenchConfig,
    scene: &BenchScene,
    state: &mut BenchState,
    timing: &AreaTimingRecorder,
) {
    let checkpoint = &scene.checkpoints[state.checkpoint_index];
    let mut run = state.current_run.take().unwrap_or_else(|| RunRecord {
        frame_ms_median: 0.0,
        csv: String::new(),
        screenshot: None,
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
        bevy_version: "0.18.x".to_string(),
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
    fog_config: Option<ResMut<FogConfig>>,
    warned_missing_fog_quality: &mut bool,
) {
    let Some(tier) = checkpoint.fog_tier.as_deref() else {
        return;
    };

    let Some(mut fog_config) = fog_config else {
        if !*warned_missing_fog_quality {
            warn!("bench scene requested fog_tier, but fog config resource is unavailable");
            *warned_missing_fog_quality = true;
        }
        return;
    };

    match tier.to_ascii_lowercase().as_str() {
        "off" => fog_config.volumetric.enabled = false,
        "low" => {
            fog_config.volumetric.enabled = true;
            fog_config.volumetric.step_count = 8;
            fog_config.volume.size = 256.0;
            fog_config.volume.dust_animation.enabled = false;
        }
        "medium" => {
            fog_config.volumetric.enabled = true;
            fog_config.volumetric.step_count = 16;
            fog_config.volume.size = 384.0;
            fog_config.volume.dust_animation.enabled = false;
        }
        "high" => {
            fog_config.volumetric.enabled = true;
            fog_config.volumetric.step_count = 32;
            fog_config.volume.size = 512.0;
            fog_config.volume.dust_animation.enabled = true;
        }
        other => warn!("unknown fog_tier '{}' in bench scene", other),
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
    run_index: u32,
    ext: &str,
) -> String {
    let scene = scene_path
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| "scene".to_string());
    format!(
        "{}-{}-run{}.{}",
        sanitize(&scene),
        sanitize(&checkpoint.name),
        run_index,
        ext
    )
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
