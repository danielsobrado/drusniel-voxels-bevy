use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;
use serde::Deserialize;
use voxel_builder::voxel::pages::scripted_edit::{
    ClodScriptedEditDefaults, ClodScriptedEditEvent, ClodScriptedEditSpec, expand_scripted_edits,
};

#[derive(Parser, Debug)]
#[command(
    about = "Export concrete CLOD scripted edit events from bench scene TOML",
    version
)]
struct Args {
    /// One or more bench scene TOML files containing [[checkpoint.clod_edit]] blocks.
    #[arg(required = true)]
    scenes: Vec<PathBuf>,

    /// Output CSV path.
    #[arg(long, default_value = "perf-dumps/clod-edit-events.csv")]
    out: PathBuf,

    /// Fail when a scene has no CLOD edit operations.
    #[arg(long)]
    require_edits: bool,
}

#[derive(Debug, Deserialize)]
struct BenchScene {
    #[serde(default)]
    checkpoint: Vec<BenchCheckpoint>,

    #[serde(default)]
    clod_edit_defaults: ClodScriptedEditDefaults,
}

#[derive(Debug, Deserialize)]
struct BenchCheckpoint {
    #[serde(default)]
    name: String,

    #[serde(default)]
    clod_edit: Vec<ClodScriptedEditSpec>,
}

#[derive(Debug)]
struct ExportRow {
    scene: String,
    checkpoint: String,
    event: ClodScriptedEditEvent,
}

fn main() -> ExitCode {
    let args = Args::parse();
    match export_events(&args) {
        Ok(summary) => {
            println!(
                "wrote {} scripted CLOD edit events to {}",
                summary.event_count,
                args.out.display()
            );
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("clod_edit_events_export failed: {err}");
            ExitCode::FAILURE
        }
    }
}

#[derive(Debug, Default)]
struct ExportSummary {
    event_count: usize,
}

fn export_events(args: &Args) -> Result<ExportSummary, String> {
    let mut rows = Vec::new();

    for scene_path in &args.scenes {
        let scene = load_scene(scene_path)?;
        let scene_name = scene_path.display().to_string();
        let mut scene_events = 0usize;

        for checkpoint in &scene.checkpoint {
            for spec in &checkpoint.clod_edit {
                let events = expand_scripted_edits(spec, &scene.clod_edit_defaults)
                    .map_err(|err| format!("{}: {}: {err}", scene_path.display(), spec.name))?;
                scene_events += events.len();
                rows.extend(events.into_iter().map(|event| ExportRow {
                    scene: scene_name.clone(),
                    checkpoint: checkpoint.name.clone(),
                    event,
                }));
            }
        }

        if args.require_edits && scene_events == 0 {
            return Err(format!(
                "{} has no [[checkpoint.clod_edit]] operations",
                scene_path.display()
            ));
        }
    }

    rows.sort_by(|a, b| {
        a.event
            .frame
            .cmp(&b.event.frame)
            .then_with(|| a.scene.cmp(&b.scene))
            .then_with(|| a.checkpoint.cmp(&b.checkpoint))
            .then_with(|| a.event.name.cmp(&b.event.name))
            .then_with(|| a.event.occurrence.cmp(&b.event.occurrence))
    });

    write_csv(&args.out, &rows)?;
    Ok(ExportSummary {
        event_count: rows.len(),
    })
}

fn load_scene(path: &Path) -> Result<BenchScene, String> {
    let raw = fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    toml::from_str(&raw).map_err(|err| format!("failed to parse {}: {err}", path.display()))
}

fn write_csv(path: &Path, rows: &[ExportRow]) -> Result<(), String> {
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
    }

    let mut csv = String::new();
    csv.push_str("scene,checkpoint,event_index,occurrence_index,edit,name,occurrence,frame,kind,x,y,z,radius,strength,target_height,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames\n");
    for (event_index, row) in rows.iter().enumerate() {
        let event = &row.event;
        csv.push_str(&csv_escape(&row.scene));
        csv.push(',');
        csv.push_str(&csv_escape(&row.checkpoint));
        csv.push(',');
        csv.push_str(&event_index.to_string());
        csv.push(',');
        csv.push_str(&event.occurrence.to_string());
        csv.push(',');
        csv.push_str(&csv_escape(&event.name));
        csv.push(',');
        csv.push_str(&csv_escape(&event.name));
        csv.push(',');
        csv.push_str(&event.occurrence.to_string());
        csv.push(',');
        csv.push_str(&event.frame.to_string());
        csv.push(',');
        csv.push_str(event.kind.as_str());
        csv.push(',');
        csv.push_str(&fmt_f32(event.position[0]));
        csv.push(',');
        csv.push_str(&fmt_f32(event.position[1]));
        csv.push(',');
        csv.push_str(&fmt_f32(event.position[2]));
        csv.push(',');
        csv.push_str(&fmt_f32(event.radius));
        csv.push(',');
        csv.push_str(&fmt_f32(event.strength));
        csv.push(',');
        csv.push_str(&event.target_height.map(fmt_f32).unwrap_or_default());
        csv.push(',');
        csv.push_str(&opt_u32(event.expected_dirty_pages_min));
        csv.push(',');
        csv.push_str(&opt_u32(event.expected_dirty_pages_max));
        csv.push(',');
        csv.push_str(&opt_u32(event.expected_rebuild_publish_max_frames));
        csv.push(',');
        csv.push_str(&opt_u32(event.expected_collider_refresh_max_frames));
        csv.push('\n');
    }

    fs::write(path, csv).map_err(|err| format!("failed to write {}: {err}", path.display()))
}

fn opt_u32(value: Option<u32>) -> String {
    value.map(|v| v.to_string()).unwrap_or_default()
}

fn fmt_f32(value: f32) -> String {
    if value.is_finite() {
        format!("{value:.6}")
    } else {
        value.to_string()
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use voxel_builder::voxel::pages::scripted_edit::ClodScriptedEditKind;

    #[test]
    fn writes_rows_sorted_by_frame() {
        let rows = vec![ExportRow {
            scene: "scene".into(),
            checkpoint: "b".into(),
            event: ClodScriptedEditEvent {
                name: "later".into(),
                occurrence: 0,
                frame: 20,
                kind: ClodScriptedEditKind::Dig,
                position: [1.0, 2.0, 3.0],
                radius: 2.0,
                strength: 0.5,
                target_height: None,
                expected_dirty_pages_min: None,
                expected_dirty_pages_max: None,
                expected_rebuild_publish_max_frames: None,
                expected_collider_refresh_max_frames: None,
            },
        }];
        let mut csv = String::new();
        csv.push_str(&csv_escape(&rows[0].scene));
        assert_eq!(csv, "scene");
    }
}
