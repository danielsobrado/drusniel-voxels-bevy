//! Expand scripted CLOD edit events into deterministic per-frame dispatch CSV.

use std::env;
use std::fs;
use std::path::PathBuf;

use voxel_builder::voxel::pages::scripted_edit_driver::{
    dispatch_csv_header, dispatch_record_to_csv_row, parse_scripted_edit_event_csv, ScriptedEditDriver,
};

fn main() {
    if let Err(error) = run() {
        eprintln!("clod_edit_dispatch_export failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 || args.len() > 4 {
        return Err(
            "usage: clod_edit_dispatch_export <clod-edit-events.csv> <clod-edit-dispatch.csv> [max_frame]"
                .to_string(),
        );
    }

    let input_path = PathBuf::from(&args[1]);
    let output_path = PathBuf::from(&args[2]);
    let input = fs::read_to_string(&input_path)
        .map_err(|error| format!("failed to read {}: {error}", input_path.display()))?;
    let events = parse_scripted_edit_event_csv(&input)?;
    let inferred_max_frame = events.iter().map(|event| event.frame).max().unwrap_or(0);
    let max_frame = if let Some(value) = args.get(3) {
        value
            .parse::<u32>()
            .map_err(|error| format!("invalid max_frame `{value}`: {error}"))?
    } else {
        inferred_max_frame
    };

    let mut driver = ScriptedEditDriver::new(events);
    let records = driver.dispatch_until(max_frame)?;

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }

    let mut output = String::new();
    output.push_str(dispatch_csv_header());
    output.push('\n');
    for record in &records {
        output.push_str(&dispatch_record_to_csv_row(record));
        output.push('\n');
    }

    fs::write(&output_path, output)
        .map_err(|error| format!("failed to write {}: {error}", output_path.display()))?;
    println!(
        "wrote {} dispatch records to {}",
        records.len(),
        output_path.display()
    );
    Ok(())
}
