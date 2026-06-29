//! Export dry-run terrain edit requests from scripted CLOD edit dispatch CSV.

use std::env;
use std::fs;
use std::path::PathBuf;

use voxel_builder::voxel::pages::edit_dirtiness::ClodDirtyPageGrid;
use voxel_builder::voxel::pages::scripted_edit_adapter::{
    ScriptedEditDryRunConfig, ScriptedEditMutationMode, build_dry_run_records, dry_run_csv_header,
    dry_run_record_to_csv_row, parse_scripted_edit_dispatch_csv,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("clod_edit_dry_run_export failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 || args.len() > 4 {
        return Err(
            "usage: clod_edit_dry_run_export <clod-edit-dispatch.csv> <clod-edit-dry-run.csv> [influence_margin]"
                .to_string(),
        );
    }

    let input_path = PathBuf::from(&args[1]);
    let output_path = PathBuf::from(&args[2]);
    let influence_margin = if let Some(value) = args.get(3) {
        value
            .parse::<f32>()
            .map_err(|error| format!("invalid influence_margin `{value}`: {error}"))?
    } else {
        env_f32("VOXEL_CLOD_EDIT_DRY_RUN_INFLUENCE_MARGIN", 0.0)?
    };

    let page_size = env_f32("VOXEL_CLOD_EDIT_DRY_RUN_PAGE_SIZE", 64.0)?;
    let min_page_x = env_i32("VOXEL_CLOD_EDIT_DRY_RUN_MIN_PAGE_X", 0)?;
    let min_page_z = env_i32("VOXEL_CLOD_EDIT_DRY_RUN_MIN_PAGE_Z", 0)?;
    let world_pages_x = env_i32("VOXEL_CLOD_EDIT_DRY_RUN_WORLD_PAGES_X", 8)?;
    let world_pages_z = env_i32("VOXEL_CLOD_EDIT_DRY_RUN_WORLD_PAGES_Z", 8)?;
    let max_levels = env_usize("VOXEL_CLOD_EDIT_DRY_RUN_MAX_LEVELS", 4)?;

    let input = fs::read_to_string(&input_path)
        .map_err(|error| format!("failed to read {}: {error}", input_path.display()))?;
    let rows = parse_scripted_edit_dispatch_csv(&input)?;
    let grid = ClodDirtyPageGrid::try_new(
        page_size,
        min_page_x,
        min_page_z,
        world_pages_x,
        world_pages_z,
        max_levels,
    )?;
    let config = ScriptedEditDryRunConfig::try_new(
        grid,
        influence_margin,
        ScriptedEditMutationMode::DryRun,
    )?;
    let records = build_dry_run_records(&rows, config)?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }

    let mut output = String::new();
    output.push_str(dry_run_csv_header());
    output.push('\n');
    for record in &records {
        output.push_str(&dry_run_record_to_csv_row(record));
        output.push('\n');
    }
    fs::write(&output_path, output)
        .map_err(|error| format!("failed to write {}: {error}", output_path.display()))?;

    println!(
        "wrote {} dry-run edit requests to {}",
        records.len(),
        output_path.display()
    );
    Ok(())
}

fn env_f32(name: &str, default: f32) -> Result<f32, String> {
    match env::var(name) {
        Ok(value) => value
            .parse::<f32>()
            .map_err(|error| format!("invalid {name} value `{value}`: {error}")),
        Err(_) => Ok(default),
    }
}

fn env_i32(name: &str, default: i32) -> Result<i32, String> {
    match env::var(name) {
        Ok(value) => value
            .parse::<i32>()
            .map_err(|error| format!("invalid {name} value `{value}`: {error}")),
        Err(_) => Ok(default),
    }
}

fn env_usize(name: &str, default: usize) -> Result<usize, String> {
    match env::var(name) {
        Ok(value) => value
            .parse::<usize>()
            .map_err(|error| format!("invalid {name} value `{value}`: {error}")),
        Err(_) => Ok(default),
    }
}
