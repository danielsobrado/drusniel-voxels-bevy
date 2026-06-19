use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use clap::{Parser, ValueEnum};
use voxel_builder::diagnostics::qa::config::QaConfig;
use voxel_builder::diagnostics::qa::config::load_config;
use voxel_builder::diagnostics::qa::runner::{QaRunOptions, run_qa};

#[derive(Parser, Debug)]
#[command(
    about = "Run host-side visual QA checks against a bench summary or spawned bench run",
    version
)]
struct Args {
    /// QA YAML config.
    #[arg(long, default_value = "assets/config/qa_visual.yaml")]
    config: PathBuf,

    /// Existing bench summary.json to check.
    #[arg(long)]
    summary: Option<PathBuf>,

    /// Output directory for qa-report.json, qa-report.md, and diff images.
    #[arg(long)]
    output: Option<PathBuf>,

    /// Run the single configured bench scene before checking its summary.
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

    /// Copy current screenshots into the configured baseline paths before diffing.
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
        Ok(status) if status == "fail" => ExitCode::from(1),
        Ok(_) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("[QA] error: {error}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<String, String> {
    let args = Args::parse();
    let config = load_config(&args.config).map_err(|error| error.to_string())?;
    let output_dir = args
        .output
        .clone()
        .unwrap_or_else(|| config.output_root.join("latest"));
    let summary_path = if args.run_bench {
        let bench_scene = single_configured_bench_scene(&config)?;
        let bench_out = args.bench_out.unwrap_or_else(|| output_dir.join("bench"));
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
        summary_path
    } else {
        args.summary
            .ok_or_else(|| "pass --summary <summary.json> or use --run-bench".to_string())?
    };

    let report = run_qa(
        &config,
        &QaRunOptions {
            config_path: args.config,
            summary_path,
            output_dir,
            update_baselines: args.update_baselines,
        },
    )
    .map_err(|error| error.to_string())?;
    println!("[QA] overall_status={}", report.overall_status);
    Ok(report.overall_status)
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
        "[QA] running bench scene {} -> {}",
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
    use voxel_builder::diagnostics::qa::config::{QaSceneConfig, QaScreenshotConfig};

    #[test]
    fn single_configured_bench_scene_accepts_repeated_scene() {
        let config = QaConfig {
            scenes: vec![
                scene("a", Some("bench/scenes/visual/visual-regression.toml")),
                scene("b", Some("bench/scenes/visual/visual-regression.toml")),
            ],
            ..Default::default()
        };
        assert_eq!(
            single_configured_bench_scene(&config).unwrap(),
            PathBuf::from("bench/scenes/visual/visual-regression.toml")
        );
    }

    #[test]
    fn single_configured_bench_scene_rejects_multiple_scenes() {
        let config = QaConfig {
            scenes: vec![
                scene("a", Some("bench/scenes/visual/visual-regression.toml")),
                scene("b", Some("bench/scenes/collider/collider-walk-log.toml")),
            ],
            ..Default::default()
        };
        let error = single_configured_bench_scene(&config).unwrap_err();
        assert!(error.contains("supports one bench_scene"));
    }

    #[test]
    fn single_configured_bench_scene_requires_a_scene() {
        let config = QaConfig {
            scenes: vec![scene("a", None)],
            ..Default::default()
        };
        let error = single_configured_bench_scene(&config).unwrap_err();
        assert!(error.contains("no QA scene has a bench_scene"));
    }

    fn scene(id: &str, bench_scene: Option<&str>) -> QaSceneConfig {
        QaSceneConfig {
            id: id.to_string(),
            bench_scene: bench_scene.map(str::to_string),
            checkpoint: "checkpoint".to_string(),
            screenshots: vec![QaScreenshotConfig {
                id: "main".to_string(),
                name: "main".to_string(),
                baseline: None,
            }],
            probes: Vec::new(),
            timing: Vec::new(),
        }
    }
}
