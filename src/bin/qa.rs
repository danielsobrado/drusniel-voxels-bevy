use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use clap::{Parser, ValueEnum};
use voxel_builder::diagnostics::qa::config::{QaConfig, load_config};
use voxel_builder::diagnostics::qa::runner::{QaRunOptions, run_qa};
use voxel_builder::diagnostics::qa::unified::manifest::{
    Registry, load_registry_with_legacy,
};
use voxel_builder::diagnostics::qa::unified::report::UnifiedStatus;
use voxel_builder::diagnostics::qa::unified::runner::{UnifiedRunOptions, run_unified_qa};
use voxel_builder::diagnostics::qa::unified::schema::{Scene, Target};

const DEFAULT_VISUAL_MANIFEST: &str = "validation/manifests/visual-regression.yaml";
const DEFAULT_PERFORMANCE_MANIFEST: &str = "validation/manifests/performance-regression.yaml";
const DEFAULT_LEGACY_MAP: &str = "validation/manifests/legacy-id-map.yaml";

#[derive(Parser, Debug)]
#[command(
    about = "Run deterministic Bevy visual and performance QA from the canonical manifests",
    version
)]
struct Args {
    /// Canonical unified visual manifest.
    #[arg(long, default_value = DEFAULT_VISUAL_MANIFEST)]
    manifest_visual: PathBuf,

    /// Canonical unified performance manifest.
    #[arg(long, default_value = DEFAULT_PERFORMANCE_MANIFEST)]
    manifest_performance: PathBuf,

    /// Legacy-to-canonical ID mapping validated with the manifests.
    #[arg(long, default_value = DEFAULT_LEGACY_MAP)]
    legacy_map: PathBuf,

    /// Validate canonical manifests without evaluating a capture summary.
    #[arg(long)]
    manifest_validate_only: bool,

    /// Select canonical Bevy scenes containing every supplied tag.
    #[arg(long)]
    tag: Vec<String>,

    /// Select canonical Bevy scene IDs.
    #[arg(long)]
    scene: Vec<String>,

    /// Existing Bevy bench or capture summary JSON.
    #[arg(long)]
    summary: Option<PathBuf>,

    /// Root used to resolve screenshot paths from the summary.
    #[arg(long)]
    actual_root: Option<PathBuf>,

    /// Output directory for environment, scene artifacts, and four report formats.
    #[arg(long)]
    output: Option<PathBuf>,

    /// Launch the selected Bevy bench before evaluating its summary.
    #[arg(long)]
    run_bench: bool,

    /// Output directory for the spawned bench run. Defaults to <output>/bench.
    #[arg(long)]
    bench_out: Option<PathBuf>,

    /// Cargo profile used for the spawned bench run.
    #[arg(long, value_enum, default_value_t = BenchProfile::Release)]
    bench_profile: BenchProfile,

    /// Forward --bench-headless to the spawned bench run.
    #[arg(long)]
    bench_headless: bool,

    /// Use the pre-unified assets/config/qa_visual.yaml compatibility path.
    #[arg(long)]
    legacy: bool,

    /// Legacy Bevy QA config, used only with --legacy.
    #[arg(long, default_value = "assets/config/qa_visual.yaml")]
    config: PathBuf,

    /// Legacy-only baseline copy behavior.
    #[arg(long)]
    update_baselines: bool,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
enum BenchProfile {
    Dev,
    Release,
}

fn main() -> ExitCode {
    match run() {
        Ok(status) if status.is_failure() => ExitCode::from(1),
        Ok(_) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("[QA] error: {error}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<UnifiedStatus, String> {
    let args = Args::parse();
    if args.legacy {
        return run_legacy(&args);
    }
    if args.update_baselines {
        return Err("--update-baselines is only available with --legacy; canonical baseline authority is QA-U7".into());
    }

    let registry = load_registry_with_legacy(
        &args.manifest_visual,
        &args.manifest_performance,
        Some(&args.legacy_map),
    )
    .map_err(|error| error.to_string())?;
    let selected = selected_bevy_scenes(&registry, &args)?;
    println!(
        "[QA] canonical manifests valid: scenes={} bevy_selected={} baseline_version={} hash={}",
        registry.scenes.len(),
        selected.len(),
        registry.baseline_version,
        registry.manifest_hash
    );
    for scene in &selected {
        println!("[QA] reproduce {}: {}", scene.id, scene.reproduction_command());
    }
    if args.manifest_validate_only {
        return Ok(UnifiedStatus::Pass);
    }

    let output_dir = args
        .output
        .clone()
        .unwrap_or_else(|| registry.output_root.join("bevy").join("latest"));
    let summary_path = resolve_summary_path(&args, &selected, &output_dir)?;
    let report = run_unified_qa(&UnifiedRunOptions {
        visual_manifest: args.manifest_visual.clone(),
        performance_manifest: args.manifest_performance.clone(),
        legacy_map: Some(args.legacy_map.clone()),
        summary_path,
        output_dir,
        tags: args.tag.clone(),
        scene_ids: args.scene.clone(),
        target: Target::Bevy,
        actual_root: args.actual_root.clone(),
    })
    .map_err(|error| error.to_string())?;
    println!("[QA] overall_status={}", report.status.as_str());
    Ok(report.status)
}

fn selected_bevy_scenes<'a>(
    registry: &'a Registry,
    args: &Args,
) -> Result<Vec<&'a Scene>, String> {
    let selected = registry.select(&args.tag, &args.scene, Some(Target::Bevy));
    if selected.is_empty() {
        return Err(format!(
            "no enabled Bevy QA scenes matched tags=[{}] scenes=[{}]",
            args.tag.join(","),
            args.scene.join(",")
        ));
    }
    Ok(selected)
}

fn resolve_summary_path(
    args: &Args,
    selected: &[&Scene],
    output_dir: &Path,
) -> Result<PathBuf, String> {
    if args.run_bench {
        let bench_scene = single_manifest_bench_scene(selected)?;
        let bench_out = args
            .bench_out
            .clone()
            .unwrap_or_else(|| output_dir.join("bench"));
        run_bench_scene(
            &bench_scene,
            &bench_out,
            args.bench_profile,
            args.bench_headless,
        )?;
        let summary_path = bench_out.join("summary.json");
        if !summary_path.exists() {
            return Err(format!(
                "spawned bench completed but did not write {}",
                summary_path.display()
            ));
        }
        Ok(summary_path)
    } else {
        args.summary.clone().ok_or_else(|| {
            "pass --summary <summary.json>, use --run-bench, or use --manifest-validate-only"
                .to_string()
        })
    }
}

fn single_manifest_bench_scene(scenes: &[&Scene]) -> Result<PathBuf, String> {
    let paths = scenes
        .iter()
        .map(|scene| scene.launch.scene.as_str())
        .collect::<BTreeSet<_>>();
    match paths.len() {
        0 => Err("no selected Bevy scene defines launch.scene".into()),
        1 => Ok(PathBuf::from(paths.first().expect("one bench scene"))),
        _ => Err(format!(
            "selected Bevy scenes require multiple bench manifests; run them separately: {}",
            paths.into_iter().collect::<Vec<_>>().join(", ")
        )),
    }
}

fn run_legacy(args: &Args) -> Result<UnifiedStatus, String> {
    let config = load_config(&args.config).map_err(|error| error.to_string())?;
    let output_dir = args
        .output
        .clone()
        .unwrap_or_else(|| config.output_root.join("latest"));
    let summary_path = if args.run_bench {
        let bench_scene = single_configured_bench_scene(&config)?;
        let bench_out = args
            .bench_out
            .clone()
            .unwrap_or_else(|| output_dir.join("bench"));
        run_bench_scene(
            &bench_scene,
            &bench_out,
            args.bench_profile,
            args.bench_headless,
        )?;
        bench_out.join("summary.json")
    } else {
        args.summary
            .clone()
            .ok_or_else(|| "legacy QA requires --summary or --run-bench".to_string())?
    };
    let report = run_qa(
        &config,
        &QaRunOptions {
            config_path: args.config.clone(),
            summary_path,
            output_dir,
            update_baselines: args.update_baselines,
        },
    )
    .map_err(|error| error.to_string())?;
    Ok(if report.overall_status == "fail" {
        UnifiedStatus::Fail
    } else if report.overall_status == "baseline_missing" {
        UnifiedStatus::BaselineMissing
    } else {
        UnifiedStatus::Pass
    })
}

fn single_configured_bench_scene(config: &QaConfig) -> Result<PathBuf, String> {
    let scenes = config
        .scenes
        .iter()
        .filter_map(|scene| scene.bench_scene.as_deref())
        .collect::<BTreeSet<_>>();
    match scenes.len() {
        0 => Err("no QA scene has a bench_scene; --run-bench needs one".to_string()),
        1 => Ok(PathBuf::from(scenes.first().expect("one scene"))),
        _ => Err(format!(
            "--run-bench currently supports one bench_scene per invocation; found {}: {}",
            scenes.len(),
            scenes.into_iter().collect::<Vec<_>>().join(", ")
        )),
    }
}

fn run_bench_scene(
    bench_scene: &Path,
    bench_out: &Path,
    profile: BenchProfile,
    bench_headless: bool,
) -> Result<(), String> {
    let mut command = Command::new("cargo");
    command.args(["run", "--bin", "voxel_builder"]);
    if profile == BenchProfile::Release {
        command.arg("--release");
    }
    command.args([
        "--",
        "--bench",
        &bench_scene.display().to_string(),
        "--bench-out",
        &bench_out.display().to_string(),
    ]);
    if bench_headless {
        command.arg("--bench-headless");
    }

    println!(
        "[QA] running Bevy bench {} -> {}",
        bench_scene.display(),
        bench_out.display()
    );
    let status = command
        .status()
        .map_err(|error| format!("failed to spawn cargo bench run: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "bench run failed with status {}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "terminated by signal".to_string())
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_scenes_must_share_a_bench_manifest() {
        let scene_a = manifest_scene("a", "bench/a.toml");
        let scene_b = manifest_scene("b", "bench/b.toml");
        assert!(single_manifest_bench_scene(&[&scene_a, &scene_b]).is_err());
    }

    fn manifest_scene(id: &str, path: &str) -> Scene {
        let yaml = format!(
            r#"
id: {id}
target: bevy
lane: gpu
enabled: true
tags: []
launch:
  world_seed: 1
  world_mode: bench
  scene: {path}
  quality: balanced
  render_resolution_preset: high
  viewport: [1, 1]
  device_pixel_ratio: 1
  camera: {{ position: [0, 0, 0], yaw_deg: 0, pitch_deg: 0, fov_y_deg: 55 }}
  lighting: {{ time_of_day_hours: 12, sun_elevation_deg: 55, sun_azimuth_deg: 145 }}
  weather: {{ wind_time_s: 0, cloud_time_s: 0, particle_time_s: 0, precipitation: none }}
  flags: {{}}
settle: {{ ready_timeout_ms: 1, warmup_frames: 0, settle_frames: 0, freeze_after_settle: true }}
capture: {{ checkpoint: main, image: viewport, include_hud: false, include_debug_overlays: false }}
baseline:
  image: validation/baselines/bevy/{id}/baseline.png
  stats: validation/baselines/bevy/{id}/baseline.stats.json
  metrics: validation/baselines/bevy/{id}/baseline.metrics.json
  mask: null
  sha256: null
image_gates:
  required: false
  changed_pixel_threshold: 0.05
  mean_absolute_error_max: 0.01
  p95_absolute_error_max: 0.04
  changed_pixel_fraction_max: 0.02
  edge_error_mean_max: 0.02
  luminance_mean_delta_max: 0.02
  luminance_stddev_delta_max: 0.02
  chroma_mean_delta_max: 0.02
region_probes: []
timing_gates: []
counter_gates: []
informational_metrics: []
specialized_commands: []
"#
        );
        serde_yaml::from_str(&yaml).unwrap()
    }
}
