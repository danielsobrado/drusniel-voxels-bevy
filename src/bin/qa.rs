use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use voxel_builder::diagnostics::qa::config::load_config;
use voxel_builder::diagnostics::qa::runner::{QaRunOptions, run_qa};

#[derive(Parser, Debug)]
#[command(
    about = "Run host-side visual QA checks against an existing bench summary",
    version
)]
struct Args {
    /// QA YAML config.
    #[arg(long, default_value = "assets/config/qa_visual.yaml")]
    config: PathBuf,

    /// Existing bench summary.json to check.
    #[arg(long)]
    summary: PathBuf,

    /// Output directory for qa-report.json, qa-report.md, and diff images.
    #[arg(long)]
    output: Option<PathBuf>,

    /// Copy current screenshots into the configured baseline paths before diffing.
    #[arg(long)]
    update_baselines: bool,
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
        .unwrap_or_else(|| config.output_root.join("latest"));
    let report = run_qa(
        &config,
        &QaRunOptions {
            config_path: args.config,
            summary_path: args.summary,
            output_dir,
            update_baselines: args.update_baselines,
        },
    )
    .map_err(|error| error.to_string())?;
    println!("[QA] overall_status={}", report.overall_status);
    Ok(report.overall_status)
}
