//! Guard scripted CLOD edit mutation sink CSVs.
//!
//! The sink is the final pre-mutation gate in the scripted edit QA pipeline.
//! This guard keeps complete QA conservative: by default every valid request
//! must remain a dry-run decision and no placeholder apply rows are accepted.

use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone)]
struct GuardConfig {
    require_non_empty: bool,
    require_dry_run_only: bool,
    require_unique_request_ids: bool,
    allow_blocked: bool,
    allow_ready: bool,
    allow_applied_placeholder: bool,
    max_dirty_lod0_pages: u32,
    max_dirty_parent_nodes: u32,
}

impl Default for GuardConfig {
    fn default() -> Self {
        Self {
            require_non_empty: true,
            require_dry_run_only: true,
            require_unique_request_ids: true,
            allow_blocked: false,
            allow_ready: false,
            allow_applied_placeholder: false,
            max_dirty_lod0_pages: 512,
            max_dirty_parent_nodes: 4096,
        }
    }
}

impl GuardConfig {
    fn load(path: Option<PathBuf>) -> Result<Self, String> {
        let mut cfg = Self::default();
        let Some(path) = path else { return Ok(cfg); };
        let text = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read config {}: {err}", path.display()))?;
        for raw in text.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() { continue; }
            let Some((key, value)) = line.split_once('=') else { continue; };
            let key = key.trim();
            let value = value.trim().trim_matches('"');
            match key {
                "require_non_empty" => cfg.require_non_empty = parse_bool(value)?,
                "require_dry_run_only" => cfg.require_dry_run_only = parse_bool(value)?,
                "require_unique_request_ids" => cfg.require_unique_request_ids = parse_bool(value)?,
                "allow_blocked" => cfg.allow_blocked = parse_bool(value)?,
                "allow_ready" => cfg.allow_ready = parse_bool(value)?,
                "allow_applied_placeholder" => cfg.allow_applied_placeholder = parse_bool(value)?,
                "max_dirty_lod0_pages" => cfg.max_dirty_lod0_pages = parse_u32(value, key)?,
                "max_dirty_parent_nodes" => cfg.max_dirty_parent_nodes = parse_u32(value, key)?,
                _ => {}
            }
        }
        Ok(cfg)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SinkRow {
    request_id: String,
    frame: u64,
    event_id: String,
    decision: String,
    reason: String,
    dirty_lod0_pages: u32,
    dirty_parent_nodes: u32,
}

#[derive(Debug, Default)]
struct Summary {
    total: usize,
    dry_run: usize,
    blocked: usize,
    ready: usize,
    applied_placeholder: usize,
}

fn parse_bool(value: &str) -> Result<bool, String> {
    match value.trim() {
        "true" | "TRUE" | "1" | "yes" | "YES" => Ok(true),
        "false" | "FALSE" | "0" | "no" | "NO" => Ok(false),
        other => Err(format!("invalid boolean `{other}`")),
    }
}

fn parse_u32(value: &str, name: &str) -> Result<u32, String> {
    value.parse::<u32>().map_err(|_| format!("invalid u32 for `{name}`: `{value}`"))
}

fn split_csv_line(line: &str) -> Vec<String> {
    // These QA CSVs are generated without quoted commas. Keep the guard small
    // and dependency-free so it can run in minimal CI jobs.
    line.split(',').map(|part| part.trim().to_string()).collect()
}

fn col(header: &[String], name: &str) -> Result<usize, String> {
    header
        .iter()
        .position(|h| h == name)
        .ok_or_else(|| format!("missing column `{name}`"))
}

fn load_rows(path: &PathBuf) -> Result<Vec<SinkRow>, String> {
    let text = fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else { return Ok(Vec::new()); };
    let header = split_csv_line(header_line);
    let request_id = col(&header, "request_id")?;
    let frame = col(&header, "frame")?;
    let event_id = col(&header, "event_id")?;
    let decision = col(&header, "decision")?;
    let reason = col(&header, "reason")?;
    let dirty_lod0_pages = col(&header, "dirty_lod0_pages")?;
    let dirty_parent_nodes = col(&header, "dirty_parent_nodes")?;

    let mut rows = Vec::new();
    for (line_no, line) in lines.enumerate() {
        let values = split_csv_line(line);
        let at = |idx: usize| values.get(idx).map(String::as_str).unwrap_or("");
        let parse_at = |idx: usize, name: &str| -> Result<u32, String> {
            at(idx)
                .parse::<u32>()
                .map_err(|_| format!("invalid `{name}` at data line {}", line_no + 2))
        };
        rows.push(SinkRow {
            request_id: at(request_id).to_string(),
            frame: at(frame)
                .parse::<u64>()
                .map_err(|_| format!("invalid `frame` at data line {}", line_no + 2))?,
            event_id: at(event_id).to_string(),
            decision: at(decision).to_string(),
            reason: at(reason).to_string(),
            dirty_lod0_pages: parse_at(dirty_lod0_pages, "dirty_lod0_pages")?,
            dirty_parent_nodes: parse_at(dirty_parent_nodes, "dirty_parent_nodes")?,
        });
    }
    Ok(rows)
}

fn validate(rows: &[SinkRow], cfg: &GuardConfig) -> Result<Summary, Vec<String>> {
    let mut errors = Vec::new();
    let mut summary = Summary::default();
    let mut seen = HashSet::new();
    let mut last_frame = None::<u64>;

    if cfg.require_non_empty && rows.is_empty() {
        errors.push("sink CSV has no data rows".to_string());
    }

    for (idx, row) in rows.iter().enumerate() {
        summary.total += 1;
        match row.decision.as_str() {
            "dry_run" => summary.dry_run += 1,
            "blocked" => {
                summary.blocked += 1;
                if !cfg.allow_blocked {
                    errors.push(format!("row {} is blocked: {}", idx + 2, row.reason));
                }
            }
            "ready" => {
                summary.ready += 1;
                if !cfg.allow_ready {
                    errors.push(format!("row {} is ready but ready decisions are not allowed", idx + 2));
                }
            }
            "applied_placeholder" => {
                summary.applied_placeholder += 1;
                if !cfg.allow_applied_placeholder {
                    errors.push(format!("row {} is applied_placeholder but placeholder apply is not allowed", idx + 2));
                }
            }
            other => errors.push(format!("row {} has unknown decision `{other}`", idx + 2)),
        }

        if cfg.require_dry_run_only && row.decision != "dry_run" {
            errors.push(format!(
                "row {} decision `{}` violates require_dry_run_only",
                idx + 2,
                row.decision
            ));
        }

        if cfg.require_unique_request_ids && !seen.insert(row.request_id.clone()) {
            errors.push(format!("duplicate request_id `{}`", row.request_id));
        }
        if row.request_id.trim().is_empty() {
            errors.push(format!("row {} has empty request_id", idx + 2));
        }
        if row.event_id.trim().is_empty() {
            errors.push(format!("row {} has empty event_id", idx + 2));
        }
        if row.dirty_lod0_pages == 0 && row.decision != "blocked" {
            errors.push(format!("row {} has zero dirty_lod0_pages for non-blocked decision", idx + 2));
        }
        if row.dirty_lod0_pages > cfg.max_dirty_lod0_pages {
            errors.push(format!(
                "row {} dirty_lod0_pages {} exceeds {}",
                idx + 2,
                row.dirty_lod0_pages,
                cfg.max_dirty_lod0_pages
            ));
        }
        if row.dirty_parent_nodes > cfg.max_dirty_parent_nodes {
            errors.push(format!(
                "row {} dirty_parent_nodes {} exceeds {}",
                idx + 2,
                row.dirty_parent_nodes,
                cfg.max_dirty_parent_nodes
            ));
        }
        if let Some(prev) = last_frame {
            if row.frame < prev {
                errors.push(format!("row {} frame {} is before previous frame {}", idx + 2, row.frame, prev));
            }
        }
        last_frame = Some(row.frame);
    }

    if errors.is_empty() { Ok(summary) } else { Err(errors) }
}

fn main() {
    let mut args = env::args().skip(1);
    let csv = PathBuf::from(args.next().unwrap_or_else(|| "perf-dumps/clod-edit-mutation-sink.csv".to_string()));
    let config_path = args.next().map(PathBuf::from);
    let cfg = match GuardConfig::load(config_path) {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("clod_edit_mutation_sink_guard: {err}");
            std::process::exit(2);
        }
    };
    let rows = match load_rows(&csv) {
        Ok(rows) => rows,
        Err(err) => {
            eprintln!("clod_edit_mutation_sink_guard: {err}");
            std::process::exit(2);
        }
    };
    match validate(&rows, &cfg) {
        Ok(summary) => {
            eprintln!(
                "clod_edit_mutation_sink_guard: ok total={} dry_run={} blocked={} ready={} applied_placeholder={}",
                summary.total,
                summary.dry_run,
                summary.blocked,
                summary.ready,
                summary.applied_placeholder
            );
        }
        Err(errors) => {
            eprintln!("clod_edit_mutation_sink_guard: failed with {} error(s)", errors.len());
            for err in errors {
                eprintln!("  - {err}");
            }
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(decision: &str) -> SinkRow {
        SinkRow {
            request_id: "req-1".to_string(),
            frame: 10,
            event_id: "event-1".to_string(),
            decision: decision.to_string(),
            reason: "test".to_string(),
            dirty_lod0_pages: 2,
            dirty_parent_nodes: 3,
        }
    }

    #[test]
    fn default_accepts_dry_run() {
        let summary = validate(&[row("dry_run")], &GuardConfig::default()).unwrap();
        assert_eq!(summary.dry_run, 1);
    }

    #[test]
    fn default_rejects_ready() {
        let err = validate(&[row("ready")], &GuardConfig::default()).unwrap_err();
        assert!(err.iter().any(|msg| msg.contains("require_dry_run_only")));
    }

    #[test]
    fn duplicate_ids_fail() {
        let err = validate(&[row("dry_run"), row("dry_run")], &GuardConfig::default()).unwrap_err();
        assert!(err.iter().any(|msg| msg.contains("duplicate request_id")));
    }
}
