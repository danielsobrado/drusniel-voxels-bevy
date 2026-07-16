use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use voxel_builder::diagnostics::qa::unified::baseline::{BaselineOptions, promote_baselines};
use voxel_builder::diagnostics::qa::unified::manifest::load_registry_with_legacy;

#[derive(Parser, Debug)]
#[command(about = "Promote an authoritative unified QA run to canonical baselines", version)]
struct Args {
    #[arg(long)]
    run_root: PathBuf,
    #[arg(long)]
    scene: Vec<String>,
    #[arg(long)]
    approve: bool,
    #[arg(long)]
    allow_ci: bool,
    #[arg(long, default_value = "validation/manifests/visual-regression.yaml")]
    visual: PathBuf,
    #[arg(long, default_value = "validation/manifests/performance-regression.yaml")]
    performance: PathBuf,
    #[arg(long, default_value = "validation/manifests/legacy-id-map.yaml")]
    legacy_map: PathBuf,
}

fn main() -> ExitCode {
    match run() {
        Ok(count) => { println!("[qa-baseline] promoted {count} canonical baselines"); ExitCode::SUCCESS }
        Err(error) => { eprintln!("[qa-baseline] error: {error}"); ExitCode::from(1) }
    }
}

fn run() -> Result<usize, String> {
    let args = Args::parse();
    let repository_root = std::env::current_dir().map_err(|error| error.to_string())?;
    let registry = load_registry_with_legacy(&args.visual, &args.performance, Some(&args.legacy_map))
        .map_err(|error| error.to_string())?;
    let authorities = promote_baselines(
        &registry,
        &BaselineOptions {
            repository_root,
            run_root: args.run_root,
            visual_manifest: args.visual,
            performance_manifest: args.performance,
            scene_ids: args.scene,
            approve: args.approve,
            allow_ci: args.allow_ci,
        },
    ).map_err(|error| error.to_string())?;
    Ok(authorities.len())
}
