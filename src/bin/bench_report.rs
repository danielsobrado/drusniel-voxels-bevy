use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;
use serde::Deserialize;

#[derive(Parser, Debug)]
#[command(
    about = "Write a markdown latest-known-good report from bench summary.json files",
    version
)]
struct Args {
    /// One or more bench summary.json files.
    #[arg(required = true)]
    summaries: Vec<PathBuf>,

    /// Markdown report output path.
    #[arg(long, default_value = "bench-runs/latest-known-good.md")]
    output: PathBuf,
}

#[derive(Debug, Deserialize)]
struct BenchSummary {
    scene: String,
    git_sha: Option<String>,
    git_dirty: Option<bool>,
    build_profile: String,
    run_started_utc: String,
    duration_secs: f64,
    checkpoints: Vec<CheckpointSummary>,
}

#[derive(Debug, Deserialize)]
struct CheckpointSummary {
    name: String,
    median_frame_ms: f64,
    p99_frame_ms: f64,
    areas: HashMap<String, AreaSummary>,
    runs: Vec<RunRecord>,
}

#[derive(Debug, Deserialize)]
struct RunRecord {
    #[serde(default)]
    ready_timed_out: bool,
    #[serde(default)]
    render_ready_timed_out: bool,
    #[serde(default)]
    ready_wait_secs: f64,
    #[serde(default)]
    render_ready_secs: f64,
    #[serde(default)]
    screenshots: Vec<ScreenshotRecord>,
    #[serde(default)]
    screenshot: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ScreenshotRecord {
    name: String,
    frame: u32,
    path: String,
}

#[derive(Debug, Deserialize)]
struct AreaSummary {
    median_ms: f64,
    p99_ms: f64,
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<(), String> {
    let args = Args::parse();
    let mut summaries = Vec::with_capacity(args.summaries.len());
    for path in &args.summaries {
        summaries.push((path.clone(), read_summary(path)?));
    }

    let mut report = String::new();
    report.push_str("# Latest Known Good Performance\n\n");
    report.push_str("This report is generated from bench `summary.json` files. Broad render rows can overlap, so treat them as separate symptoms rather than additive costs.\n\n");
    report.push_str("## Inputs\n\n");
    report.push_str("| scene | summary | git | dirty | profile | started UTC | duration |\n");
    report.push_str("|---|---|---:|---:|---|---|---:|\n");
    for (path, summary) in &summaries {
        report.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {}s |\n",
            summary.scene,
            path.display(),
            summary.git_sha.as_deref().unwrap_or("-"),
            summary
                .git_dirty
                .map(|dirty| dirty.to_string())
                .unwrap_or_else(|| "-".to_string()),
            summary.build_profile,
            summary.run_started_utc,
            format_number(summary.duration_secs),
        ));
    }

    report.push_str("\n## Checkpoints\n\n");
    for (_, summary) in &summaries {
        report.push_str(&format!("### {}\n\n", summary.scene));
        report.push_str("| checkpoint | avg frame | p99 frame | graph avg/p99 | prepare avg/p99 | queue avg/p99 | phase avg/p99 | mesh dirty p99 | inst prep avg/p99 | gpu opaque avg/p99 | draws | instances | water active/sampled |\n");
        report.push_str("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n");
        for checkpoint in &summary.checkpoints {
            report.push_str(&format!(
                "| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {} | {}/{} |\n",
                checkpoint.name,
                ms(checkpoint.median_frame_ms),
                ms(checkpoint.p99_frame_ms),
                area_pair(checkpoint, "Render Graph CPU"),
                area_pair(checkpoint, "Render Prepare CPU"),
                area_pair(checkpoint, "Render QueueMeshes CPU"),
                area_pair(checkpoint, "Render PhaseSort CPU"),
                area_p99(checkpoint, "Mesh Dirty"),
                area_pair(checkpoint, "Render Instancing Prepare Buffers"),
                area_pair(checkpoint, "GPU main_opaque_pass_3d"),
                area_avg(checkpoint, "Counter Render Instancing Queue Draws"),
                area_avg(checkpoint, "Counter Render Instancing Queue Instances"),
                area_avg(checkpoint, "Counter Water Reflection Active"),
                area_avg(checkpoint, "Counter Water Reflection Sampled"),
            ));
        }
        report.push('\n');
    }

    report.push_str("## Guard Counters\n\n");
    report.push_str("| scene | checkpoint | water visible/eligible | water sealed | water triangles removed | LOD full/mid/hidden | shadows disabled | render-ready |\n");
    report.push_str("|---|---|---:|---:|---:|---:|---:|---|\n");
    for (_, summary) in &summaries {
        for checkpoint in &summary.checkpoints {
            report.push_str(&format!(
                "| {} | {} | {}/{} | {} | {} | {}/{}/{} | {} | {} |\n",
                summary.scene,
                checkpoint.name,
                area_avg(checkpoint, "Counter Water Meshes Visible In Frustum"),
                area_avg(checkpoint, "Counter Water Meshes Eligible For Reflection"),
                area_avg(checkpoint, "Counter Water Air Boundaries Sealed"),
                area_avg(checkpoint, "Counter Water Triangles Removed Sealed"),
                area_avg(checkpoint, "Counter Prop LOD Full Instances"),
                area_avg(checkpoint, "Counter Prop LOD Mid Instances"),
                area_avg(checkpoint, "Counter Prop LOD Hidden Instances"),
                area_avg(checkpoint, "Counter Prop Shadows Disabled By LOD"),
                ready_status(checkpoint),
            ));
        }
    }

    let caveats = collect_caveats(&summaries);
    report.push_str("\n## Caveats\n\n");
    if caveats.is_empty() {
        report.push_str("- No ready-state caveats were recorded in the supplied summaries.\n");
    } else {
        for caveat in caveats {
            report.push_str(&format!("- {caveat}\n"));
        }
    }

    if let Some(parent) = args.output.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
    }
    std::fs::write(&args.output, report)
        .map_err(|err| format!("failed to write {}: {err}", args.output.display()))?;
    println!("Wrote {}", args.output.display());
    Ok(())
}

fn read_summary(path: &Path) -> Result<BenchSummary, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    serde_json::from_str(&text).map_err(|err| format!("invalid JSON in {}: {err}", path.display()))
}

fn area<'a>(checkpoint: &'a CheckpointSummary, name: &str) -> Option<&'a AreaSummary> {
    checkpoint.areas.get(name)
}

fn area_pair(checkpoint: &CheckpointSummary, name: &str) -> String {
    area(checkpoint, name)
        .map(|area| format!("{}/{}", ms(area.median_ms), ms(area.p99_ms)))
        .unwrap_or_else(|| "-".to_string())
}

fn area_avg(checkpoint: &CheckpointSummary, name: &str) -> String {
    area(checkpoint, name)
        .map(|area| format_number(area.median_ms))
        .unwrap_or_else(|| "-".to_string())
}

fn area_p99(checkpoint: &CheckpointSummary, name: &str) -> String {
    area(checkpoint, name)
        .map(|area| ms(area.p99_ms))
        .unwrap_or_else(|| "-".to_string())
}

fn ready_status(checkpoint: &CheckpointSummary) -> String {
    let mut parts = Vec::new();
    for run in &checkpoint.runs {
        if run.ready_timed_out {
            parts.push(format!(
                "terrain timeout after {}s",
                format_number(run.ready_wait_secs)
            ));
        }
        if run.render_ready_timed_out {
            parts.push(format!(
                "render timeout after {}s",
                format_number(run.render_ready_secs)
            ));
        }
    }
    if parts.is_empty() {
        "ready".to_string()
    } else {
        parts.join(", ")
    }
}

fn collect_caveats(summaries: &[(PathBuf, BenchSummary)]) -> Vec<String> {
    let mut caveats = Vec::new();
    for (path, summary) in summaries {
        for checkpoint in &summary.checkpoints {
            for run in &checkpoint.runs {
                if run.ready_timed_out || run.render_ready_timed_out {
                    caveats.push(format!(
                        "{} / {} from {} had ready-state timeout: {}",
                        summary.scene,
                        checkpoint.name,
                        path.display(),
                        ready_status(checkpoint)
                    ));
                    break;
                }
                if run.screenshot.is_none() && run.screenshots.is_empty() {
                    caveats.push(format!(
                        "{} / {} from {} did not record screenshots",
                        summary.scene,
                        checkpoint.name,
                        path.display()
                    ));
                    break;
                }
                for screenshot in &run.screenshots {
                    if screenshot.path.is_empty() {
                        caveats.push(format!(
                            "{} / {} screenshot '{}' at frame {} has empty path",
                            summary.scene, checkpoint.name, screenshot.name, screenshot.frame
                        ));
                    }
                }
            }
        }
    }
    caveats
}

fn ms(value: f64) -> String {
    format!("{} ms", format_number(value))
}

fn format_number(value: f64) -> String {
    if value.abs() >= 100.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.3}")
    }
}
