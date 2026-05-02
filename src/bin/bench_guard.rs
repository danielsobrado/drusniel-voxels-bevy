use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;
use serde::Deserialize;

#[derive(Parser, Debug)]
#[command(
    about = "Validate bench summary.json files against render performance guardrails",
    version
)]
struct Args {
    /// One or more bench summary.json files.
    #[arg(required = true)]
    summaries: Vec<PathBuf>,

    /// Guard configuration TOML.
    #[arg(long, default_value = "assets/config/bench_guard.toml")]
    config: PathBuf,

    /// Treat warnings as process failures.
    #[arg(long)]
    fail_on_warning: bool,
}

#[derive(Debug, Deserialize)]
struct GuardConfig {
    #[serde(rename = "check")]
    checks: Vec<GuardCheck>,
}

#[derive(Debug, Deserialize)]
struct GuardCheck {
    name: String,
    scene: String,
    checkpoint: String,
    area: String,
    field: String,
    #[serde(default)]
    unit: String,
    warn_gt: Option<f64>,
    fail_gt: Option<f64>,
    warn_lt: Option<f64>,
    fail_lt: Option<f64>,
    #[serde(default)]
    exists: bool,
    #[serde(default = "default_required")]
    required: bool,
    skip_if: Option<SkipCondition>,
}

#[derive(Debug, Deserialize)]
struct SkipCondition {
    area: String,
    field: String,
    gt: Option<f64>,
    gte: Option<f64>,
    lt: Option<f64>,
    lte: Option<f64>,
    eq: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct BenchSummary {
    scene: String,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
    Pass,
    Warn,
    Fail,
    Missing,
    Skipped,
}

impl Status {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pass => "PASS",
            Self::Warn => "WARN",
            Self::Fail => "FAIL",
            Self::Missing => "MISSING",
            Self::Skipped => "SKIP",
        }
    }
}

#[derive(Debug)]
struct CheckResult {
    checkpoint: String,
    metric: String,
    value: Option<f64>,
    threshold: String,
    status: Status,
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
    let config: GuardConfig = read_toml(&args.config)?;
    if config.checks.is_empty() {
        return Err(format!("{} contains no checks", args.config.display()));
    }

    let mut summaries = Vec::with_capacity(args.summaries.len());
    for path in &args.summaries {
        let summary: BenchSummary = read_json(path)?;
        summaries.push((path.clone(), summary));
    }

    let mut results = Vec::with_capacity(config.checks.len());
    for check in &config.checks {
        results.push(evaluate_check(check, &summaries));
    }

    println!("Config: {}", args.config.display());
    println!(
        "Summaries: {}",
        args.summaries
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    print_table(&results);

    let failures = results
        .iter()
        .filter(|result| matches!(result.status, Status::Fail | Status::Missing))
        .count();
    let warnings = results
        .iter()
        .filter(|result| result.status == Status::Warn)
        .count();

    println!();
    if failures > 0 {
        println!("FAILED: {failures} failure(s), {warnings} warning(s).");
        return Ok(false);
    }
    if args.fail_on_warning && warnings > 0 {
        println!("FAILED: {warnings} warning(s) treated as failures.");
        return Ok(false);
    }
    println!("PASS: {} check(s), {warnings} warning(s).", results.len());
    Ok(true)
}

fn evaluate_check(check: &GuardCheck, summaries: &[(PathBuf, BenchSummary)]) -> CheckResult {
    let metric = format!("{} ({})", check.name, format_metric(check));
    let threshold = threshold_text(check);
    let Some(summary) = summaries
        .iter()
        .map(|(_, summary)| summary)
        .find(|summary| summary.scene == check.scene)
    else {
        return CheckResult {
            checkpoint: format!("{}/{}", check.scene, check.checkpoint),
            metric,
            value: None,
            threshold,
            status: Status::Skipped,
        };
    };

    if let Some(skip_if) = &check.skip_if {
        if condition_matches(summary, &check.checkpoint, skip_if) {
            return CheckResult {
                checkpoint: format!("{}/{}", check.scene, check.checkpoint),
                metric,
                value: None,
                threshold: format!("skipped when {}", condition_text(skip_if)),
                status: Status::Skipped,
            };
        }
    }

    let value = metric_value(summary, &check.checkpoint, &check.area, &check.field);
    let status = match value {
        Some(_) if check.exists => Status::Pass,
        Some(value) if is_fail(value, check) => Status::Fail,
        Some(value) if is_warn(value, check) => Status::Warn,
        Some(_) => Status::Pass,
        None if check.required => Status::Missing,
        None => Status::Skipped,
    };

    CheckResult {
        checkpoint: format!("{}/{}", check.scene, check.checkpoint),
        metric,
        value,
        threshold,
        status,
    }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    serde_json::from_str(&text).map_err(|err| format!("invalid JSON in {}: {err}", path.display()))
}

fn read_toml<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    toml::from_str(&text).map_err(|err| format!("invalid TOML in {}: {err}", path.display()))
}

fn metric_value(summary: &BenchSummary, checkpoint: &str, area: &str, field: &str) -> Option<f64> {
    let checkpoint = summary
        .checkpoints
        .iter()
        .find(|candidate| candidate.name == checkpoint)?;

    if matches!(area, "__frame" | "__frame_total") {
        return match field {
            "median_ms" | "avg_ms" => Some(checkpoint.median_frame_ms),
            "p99_ms" => Some(checkpoint.p99_frame_ms),
            _ => None,
        };
    }

    let area = checkpoint.areas.get(area)?;
    match field {
        "median_ms" | "avg_ms" => Some(area.median_ms),
        "p99_ms" => Some(area.p99_ms),
        "calls_per_frame" => Some(area.calls_per_frame),
        _ => None,
    }
}

fn condition_matches(summary: &BenchSummary, checkpoint: &str, condition: &SkipCondition) -> bool {
    let Some(value) = metric_value(summary, checkpoint, &condition.area, &condition.field) else {
        return false;
    };
    condition.gt.is_some_and(|limit| value > limit)
        || condition.gte.is_some_and(|limit| value >= limit)
        || condition.lt.is_some_and(|limit| value < limit)
        || condition.lte.is_some_and(|limit| value <= limit)
        || condition
            .eq
            .is_some_and(|limit| (value - limit).abs() <= f64::EPSILON)
}

fn is_fail(value: f64, check: &GuardCheck) -> bool {
    check.fail_gt.is_some_and(|limit| value > limit)
        || check.fail_lt.is_some_and(|limit| value < limit)
}

fn is_warn(value: f64, check: &GuardCheck) -> bool {
    check.warn_gt.is_some_and(|limit| value > limit)
        || check.warn_lt.is_some_and(|limit| value < limit)
}

fn threshold_text(check: &GuardCheck) -> String {
    if check.exists {
        return "must exist".to_string();
    }
    let mut parts = Vec::new();
    if let Some(value) = check.warn_gt {
        parts.push(format!("warn > {}", format_number(Some(value))));
    }
    if let Some(value) = check.fail_gt {
        parts.push(format!("fail > {}", format_number(Some(value))));
    }
    if let Some(value) = check.warn_lt {
        parts.push(format!("warn < {}", format_number(Some(value))));
    }
    if let Some(value) = check.fail_lt {
        parts.push(format!("fail < {}", format_number(Some(value))));
    }
    if parts.is_empty() {
        "-".to_string()
    } else if check.unit.is_empty() {
        parts.join("; ")
    } else {
        format!("{} {}", parts.join("; "), check.unit)
    }
}

fn condition_text(condition: &SkipCondition) -> String {
    let mut parts = Vec::new();
    if let Some(value) = condition.gt {
        parts.push(format!(
            "{}:{} > {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.gte {
        parts.push(format!(
            "{}:{} >= {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.lt {
        parts.push(format!(
            "{}:{} < {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.lte {
        parts.push(format!(
            "{}:{} <= {}",
            condition.area, condition.field, value
        ));
    }
    if let Some(value) = condition.eq {
        parts.push(format!(
            "{}:{} == {}",
            condition.area, condition.field, value
        ));
    }
    parts.join(" or ")
}

fn format_metric(check: &GuardCheck) -> String {
    format!("{}:{}", check.area, check.field)
}

fn print_table(results: &[CheckResult]) {
    let headers = ["checkpoint", "metric", "value", "threshold", "status"];
    let mut rows = Vec::with_capacity(results.len());
    for result in results {
        rows.push([
            result.checkpoint.clone(),
            result.metric.clone(),
            format_number(result.value),
            result.threshold.clone(),
            result.status.as_str().to_string(),
        ]);
    }

    let mut widths = headers.map(str::len);
    for row in &rows {
        for (index, value) in row.iter().enumerate() {
            widths[index] = widths[index].max(value.len());
        }
    }

    println!();
    println!("Bench guard checks:");
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

fn default_required() -> bool {
    true
}
