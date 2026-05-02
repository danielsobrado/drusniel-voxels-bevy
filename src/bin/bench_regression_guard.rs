use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use clap::Parser;
use serde::Deserialize;

#[derive(Parser, Debug)]
#[command(
    about = "Validate bench summary.json against render performance thresholds",
    version
)]
struct Args {
    /// Path to an existing bench summary.json. Required unless --run-visual-bench is used.
    #[arg(long)]
    summary: Option<PathBuf>,

    /// Threshold configuration JSON.
    #[arg(long, default_value = "bench/regression-thresholds.json")]
    thresholds: PathBuf,

    /// Optional previous summary.json to show before/current deltas.
    #[arg(long)]
    baseline: Option<PathBuf>,

    /// Run the release visual-regression bench before checking it.
    #[arg(long)]
    run_visual_bench: bool,

    /// Scene used with --run-visual-bench.
    #[arg(long, default_value = "bench/scenes/visual-regression.toml")]
    bench_scene: PathBuf,

    /// Output directory used with --run-visual-bench.
    #[arg(long, default_value = "bench-runs/regression-guard")]
    bench_out: PathBuf,
}

#[derive(Debug, Deserialize)]
struct ThresholdFile {
    checks: Vec<ThresholdCheck>,
}

#[derive(Debug, Deserialize)]
struct ThresholdCheck {
    name: String,
    checkpoint: String,
    area: String,
    field: String,
    max: f64,
    #[serde(default)]
    unit: String,
}

#[derive(Debug, Deserialize)]
struct BenchSummary {
    checkpoints: Vec<CheckpointSummary>,
}

#[derive(Debug, Deserialize)]
struct CheckpointSummary {
    name: String,
    median_frame_ms: f64,
    p99_frame_ms: f64,
    areas: HashMap<String, AreaSummary>,
}

#[derive(Debug, Deserialize)]
struct AreaSummary {
    median_ms: f64,
    p99_ms: f64,
    calls_per_frame: f64,
}

#[derive(Debug)]
struct CheckResult {
    status: CheckStatus,
    name: String,
    checkpoint: String,
    metric: String,
    before: Option<f64>,
    current: Option<f64>,
    limit: f64,
    unit: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CheckStatus {
    Pass,
    Fail,
    Missing,
}

impl CheckStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Fail => "FAIL",
            Self::Missing => "MISSING",
        }
    }
}

fn main() -> ExitCode {
    match run() {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(err) => {
            eprintln!("error: {err}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<bool, String> {
    let args = Args::parse();
    let summary_path = if args.run_visual_bench {
        run_visual_bench(&args.bench_scene, &args.bench_out)?
    } else {
        args.summary
            .clone()
            .ok_or_else(|| "--summary is required unless --run-visual-bench is used".to_string())?
    };

    let thresholds: ThresholdFile = read_json(&args.thresholds)?;
    if thresholds.checks.is_empty() {
        return Err(format!(
            "{} must contain at least one check",
            args.thresholds.display()
        ));
    }

    let summary: BenchSummary = read_json(&summary_path)?;
    let baseline = args
        .baseline
        .as_ref()
        .map(|path| read_json::<BenchSummary>(path))
        .transpose()?;

    let mut results = Vec::with_capacity(thresholds.checks.len());
    for check in &thresholds.checks {
        let current = metric_value(&summary, check);
        let before = baseline
            .as_ref()
            .and_then(|baseline| metric_value(baseline, check));
        let status = match current {
            Some(value) if value <= check.max => CheckStatus::Pass,
            Some(_) => CheckStatus::Fail,
            None => CheckStatus::Missing,
        };
        results.push(CheckResult {
            status,
            name: check.name.clone(),
            checkpoint: check.checkpoint.clone(),
            metric: format!("{}:{}", check.area, check.field),
            before,
            current,
            limit: check.max,
            unit: check.unit.clone(),
        });
    }

    println!("Summary: {}", summary_path.display());
    println!("Thresholds: {}", args.thresholds.display());
    print_table(&results, args.baseline.as_deref());

    let failures = results
        .iter()
        .filter(|result| result.status != CheckStatus::Pass)
        .count();
    if failures > 0 {
        println!();
        println!("FAILED: {failures} regression check(s) did not pass.");
        Ok(false)
    } else {
        println!();
        println!("PASS: {} regression check(s) passed.", results.len());
        Ok(true)
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    serde_json::from_str(&text).map_err(|err| format!("invalid JSON in {}: {err}", path.display()))
}

fn run_visual_bench(scene: &Path, out_dir: &Path) -> Result<PathBuf, String> {
    let mut command = Command::new("cargo");
    command
        .arg("run")
        .arg("--release")
        .arg("--")
        .arg("--bench")
        .arg(scene)
        .arg("--bench-out")
        .arg(out_dir);

    println!("Running visual bench:");
    println!("  {:?}", command);
    let status = command
        .status()
        .map_err(|err| format!("failed to run visual bench: {err}"))?;
    if !status.success() {
        return Err(format!("visual bench exited with {status}"));
    }

    Ok(out_dir.join("summary.json"))
}

fn metric_value(summary: &BenchSummary, check: &ThresholdCheck) -> Option<f64> {
    let checkpoint = summary
        .checkpoints
        .iter()
        .find(|checkpoint| checkpoint.name == check.checkpoint)?;

    if check.area == "__frame_total" {
        return match check.field.as_str() {
            "median_ms" => Some(checkpoint.median_frame_ms),
            "p99_ms" => Some(checkpoint.p99_frame_ms),
            _ => None,
        };
    }

    let area = checkpoint.areas.get(&check.area)?;
    match check.field.as_str() {
        "median_ms" => Some(area.median_ms),
        "p99_ms" => Some(area.p99_ms),
        "calls_per_frame" => Some(area.calls_per_frame),
        _ => None,
    }
}

fn print_table(results: &[CheckResult], baseline_path: Option<&Path>) {
    if let Some(path) = baseline_path {
        println!("Baseline: {}", path.display());
    }

    let before_header = if baseline_path.is_some() {
        "before"
    } else {
        "baseline"
    };
    let headers = [
        "status",
        "check",
        "checkpoint",
        "metric",
        before_header,
        "current",
        "limit",
    ];
    let mut rows = Vec::with_capacity(results.len());
    for result in results {
        rows.push([
            result.status.as_str().to_string(),
            result.name.clone(),
            result.checkpoint.clone(),
            result.metric.clone(),
            format_number(result.before),
            format_number(result.current),
            format!("<= {} {}", format_number(Some(result.limit)), result.unit),
        ]);
    }

    let mut widths = headers.map(str::len);
    for row in &rows {
        for (index, value) in row.iter().enumerate() {
            widths[index] = widths[index].max(value.len());
        }
    }

    println!();
    println!("Bench regression checks:");
    println!("  {}", format_row(&headers, &widths));
    println!(
        "  {}",
        widths
            .iter()
            .map(|width| "-".repeat(*width))
            .collect::<Vec<_>>()
            .join("  ")
    );
    for row in rows {
        println!("  {}", format_row(&row, &widths));
    }
}

fn format_row<const N: usize>(row: &[impl AsRef<str>; N], widths: &[usize; N]) -> String {
    row.iter()
        .zip(widths)
        .map(|(value, width)| format!("{:<width$}", value.as_ref(), width = width))
        .collect::<Vec<_>>()
        .join("  ")
}

fn format_number(value: Option<f64>) -> String {
    let Some(value) = value else {
        return "-".to_string();
    };
    if value.abs() >= 100.0 {
        format!("{value:.0}")
    } else {
        format!("{value:.3}")
    }
}
