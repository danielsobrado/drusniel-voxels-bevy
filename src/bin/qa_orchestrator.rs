use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, ValueEnum};
use voxel_builder::diagnostics::qa::unified::determinism::{DeterminismOptions, run_determinism};
use voxel_builder::diagnostics::qa::unified::manifest::load_registry_with_legacy;
use voxel_builder::diagnostics::qa::unified::orchestration::{
    BatteryRunOptions, load_orchestration, run_battery,
};
use voxel_builder::diagnostics::qa::unified::schema::Target;

#[derive(Clone, Copy, Debug, ValueEnum)]
enum Mode { Validate, Run, Determinism }

#[derive(Clone, Copy, Debug, ValueEnum)]
enum TargetArg { ClodPoc, Bevy }

impl From<TargetArg> for Target {
    fn from(value: TargetArg) -> Self {
        match value { TargetArg::ClodPoc => Target::ClodPoc, TargetArg::Bevy => Target::Bevy }
    }
}

#[derive(Parser, Debug)]
#[command(about = "Run unified QA-U5 through QA-U8 orchestration", version)]
struct Args {
    #[arg(long, value_enum, default_value_t = Mode::Validate)]
    mode: Mode,
    #[arg(long, default_value = "combined-smoke")]
    battery: String,
    #[arg(long, value_enum)]
    target: Option<TargetArg>,
    #[arg(long, default_value = "validation-runs/orchestrated/latest")]
    output: PathBuf,
    #[arg(long, default_value = "validation/manifests/visual-regression.yaml")]
    visual: PathBuf,
    #[arg(long, default_value = "validation/manifests/performance-regression.yaml")]
    performance: PathBuf,
    #[arg(long, default_value = "validation/manifests/legacy-id-map.yaml")]
    legacy_map: PathBuf,
    #[arg(long, default_value = "validation/manifests/command-allowlist.yaml")]
    commands: PathBuf,
    #[arg(long, default_value = "validation/manifests/batteries.yaml")]
    batteries: PathBuf,
}

fn main() -> ExitCode {
    match run() {
        Ok(status) if status == "PASS" => ExitCode::SUCCESS,
        Ok(status) => { eprintln!("[qa-orchestrator] status={status}"); ExitCode::from(1) }
        Err(error) => { eprintln!("[qa-orchestrator] error: {error}"); ExitCode::from(1) }
    }
}

fn run() -> Result<String, String> {
    let args = Args::parse();
    let repository_root = std::env::current_dir().map_err(|error| error.to_string())?;
    let scenes = load_registry_with_legacy(&args.visual, &args.performance, Some(&args.legacy_map))
        .map_err(|error| error.to_string())?;
    let orchestration = load_orchestration(&args.commands, &args.batteries, Some(&scenes))
        .map_err(|error| error.to_string())?;
    println!(
        "[qa-orchestrator] validated scenes={} commands={} batteries={}",
        scenes.scenes.len(), orchestration.commands.len(), orchestration.batteries.len()
    );
    match args.mode {
        Mode::Validate => Ok("PASS".to_string()),
        Mode::Run => {
            let report = run_battery(
                &orchestration,
                &scenes,
                &BatteryRunOptions {
                    repository_root,
                    output_dir: args.output,
                    run_index: 1,
                    battery_id: args.battery,
                    target: args.target.map(Into::into),
                },
            ).map_err(|error| error.to_string())?;
            Ok(report.status)
        }
        Mode::Determinism => {
            let report = run_determinism(
                &orchestration,
                &scenes,
                &DeterminismOptions {
                    repository_root,
                    output_dir: args.output,
                    battery_id: args.battery,
                    target: args.target.map(Into::into),
                },
            ).map_err(|error| error.to_string())?;
            Ok(report.status)
        }
    }
}
