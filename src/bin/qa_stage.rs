use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use voxel_builder::diagnostics::qa::unified::manifest::load_registry_with_legacy;
use voxel_builder::diagnostics::qa::unified::staging::stage_bevy_run;

#[derive(Parser, Debug)]
#[command(about = "Stage a native Bevy QA run into the unified artifact contract", version)]
struct Args {
    #[arg(long)]
    summary: PathBuf,
    #[arg(long)]
    qa_report: PathBuf,
    #[arg(long)]
    output: PathBuf,
    #[arg(long)]
    scene: Vec<String>,
    #[arg(long, default_value = "validation/manifests/visual-regression.yaml")]
    visual: PathBuf,
    #[arg(long, default_value = "validation/manifests/performance-regression.yaml")]
    performance: PathBuf,
    #[arg(long, default_value = "validation/manifests/legacy-id-map.yaml")]
    legacy_map: PathBuf,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let result = load_registry_with_legacy(&args.visual, &args.performance, Some(&args.legacy_map))
        .map_err(|error| error.to_string())
        .and_then(|registry| {
            stage_bevy_run(
                &registry,
                &args.summary,
                &args.qa_report,
                &args.output,
                &args.scene,
            )
            .map_err(|error| error.to_string())
        });
    match result {
        Ok(()) => {
            println!("[qa-stage] staged Bevy artifacts at {}", args.output.display());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("[qa-stage] error: {error}");
            ExitCode::from(1)
        }
    }
}
