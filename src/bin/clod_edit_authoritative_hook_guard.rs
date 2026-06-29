//! Guard scripted CLOD edit authoritative-hook audit CSVs.
//!
//! Complete QA must keep this stream in dry-run mode until the authoritative
//! terrain mutator and collider-refresh telemetry are wired.

use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone)]
struct GuardConfig {
    require_non_empty: bool,
    require_unique_request_ids: bool,
    require_dry_run_only: bool,
    require_requires_authoritative_world_mutation: bool,
    allow_hook_unavailable: bool,
    allow_rejected_invalid_request: bool,
    allow_accepted_for_authoritative_mutation: bool,
    max_dirty_lod0_pages: u32,
    max_dirty_nodes: u32,
}

impl Default for GuardConfig {
    fn default() -> Self {
        Self {
            require_non_empty: true,
            require_unique_request_ids: true,
            require_dry_run_only: true,
            require_requires_authoritative_world_mutation: true,
            allow_hook_unavailable: false,
            allow_rejected_invalid_request: false,
            allow_accepted_for_authoritative_mutation: false,
            max_dirty_lod0_pages: 512,
            max_dirty_nodes: 4096,
        }
    }
}

impl GuardConfig {
    fn load(path: Option<PathBuf>) -> Result<Self, String> {
        let mut cfg = Self::default();
        let Some(path) = path else {
            return Ok(cfg);
        };
        let text = fs::read_to_string(&path)
            .map_err(|err| format!("failed to read config {}: {err}", path.display()))?;
        for raw in text.lines() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim().trim_matches('"');
            match key {
                "require_non_empty" => cfg.require_non_empty = parse_bool(value)?,
                "require_unique_request_ids" => cfg.require_unique_request_ids = parse_bool(value)?,
                "require_dry_run_only" => cfg.require_dry_run_only = parse_bool(value)?,
                "require_requires_authoritative_world_mutation" => {
                    cfg.require_requires_authoritative_world_mutation = parse_bool(value)?
                }
                "allow_hook_unavailable" => cfg.allow_hook_unavailable = parse_bool(value)?,
                "allow_rejected_invalid_request" => {
                    cfg.allow_rejected_invalid_request = parse_bool(value)?
                }
                "allow_accepted_for_authoritative_mutation" => {
                    cfg.allow_accepted_for_authoritative_mutation = parse_bool(value)?
                }
                "max_dirty_lod0_pages" => cfg.max_dirty_lod0_pages = parse_u32(value, key)?,
                "max_dirty_nodes" => cfg.max_dirty_nodes = parse_u32(value, key)?,
                _ => {}
            }
        }
        Ok(cfg)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HookRow {
    request_id: String,
    frame: u64,
    checkpoint: String,
    decision: String,
    requires_authoritative_world_mutation: bool,
    hook_available: bool,
    apply_requested: bool,
    dirty_lod0_pages: u32,
    dirty_nodes: u32,
    note: String,
}

#[derive(Debug, Default)]
struct Summary {
    total: usize,
    dry_run: usize,
    hook_unavailable: usize,
    rejected_invalid_request: usize,
    accepted_for_authoritative_mutation: usize,
    hook_available_rows: usize,
    apply_requested_rows: usize,
}

fn main() {
    let mut args = env::args().skip(1);
    let csv = PathBuf::from(
        args.next()
            .unwrap_or_else(|| "perf-dumps/clod-edit-authoritative-hook.csv".to_string()),
    );
    let cfg_path = args.next().map(PathBuf::from);
    let cfg = match GuardConfig::load(cfg_path) {
        Ok(cfg) => cfg,
        Err(err) => fail(&err),
    };
    let text = match fs::read_to_string(&csv) {
        Ok(text) => text,
        Err(err) => fail(&format!("failed to read {}: {err}", csv.display())),
    };
    let rows = match parse_rows(&text) {
        Ok(rows) => rows,
        Err(err) => fail(&err),
    };
    let summary = match validate_rows(&rows, &cfg) {
        Ok(summary) => summary,
        Err(errs) => fail(&errs.join("\n")),
    };
    println!(
        "[CLOD EDIT AUTHORITATIVE HOOK GUARD] ok rows={} dry_run={} hook_unavailable={} rejected_invalid={} accepted={} hook_available_rows={} apply_requested_rows={}",
        summary.total,
        summary.dry_run,
        summary.hook_unavailable,
        summary.rejected_invalid_request,
        summary.accepted_for_authoritative_mutation,
        summary.hook_available_rows,
        summary.apply_requested_rows,
    );
}

fn validate_rows(rows: &[HookRow], cfg: &GuardConfig) -> Result<Summary, Vec<String>> {
    let mut errors = Vec::new();
    let mut seen = HashSet::new();
    let mut summary = Summary::default();
    if cfg.require_non_empty && rows.is_empty() {
        errors.push("authoritative hook CSV is empty".to_string());
    }
    for row in rows {
        summary.total += 1;
        if cfg.require_unique_request_ids && !seen.insert(row.request_id.clone()) {
            errors.push(format!("duplicate request_id {}", row.request_id));
        }
        if row.request_id.trim().is_empty() {
            errors.push(format!("row at frame {} has empty request_id", row.frame));
        }
        if cfg.require_requires_authoritative_world_mutation
            && !row.requires_authoritative_world_mutation
        {
            errors.push(format!(
                "request {} does not require authoritative world mutation",
                row.request_id
            ));
        }
        if row.hook_available {
            summary.hook_available_rows += 1;
        }
        if row.apply_requested {
            summary.apply_requested_rows += 1;
        }
        if row.dirty_lod0_pages == 0 {
            errors.push(format!(
                "request {} has zero dirty_lod0_pages",
                row.request_id
            ));
        }
        if row.dirty_nodes < row.dirty_lod0_pages {
            errors.push(format!(
                "request {} dirty_nodes {} < dirty_lod0_pages {}",
                row.request_id, row.dirty_nodes, row.dirty_lod0_pages
            ));
        }
        if row.dirty_lod0_pages > cfg.max_dirty_lod0_pages {
            errors.push(format!(
                "request {} dirty_lod0_pages {} exceeds {}",
                row.request_id, row.dirty_lod0_pages, cfg.max_dirty_lod0_pages
            ));
        }
        if row.dirty_nodes > cfg.max_dirty_nodes {
            errors.push(format!(
                "request {} dirty_nodes {} exceeds {}",
                row.request_id, row.dirty_nodes, cfg.max_dirty_nodes
            ));
        }
        match row.decision.as_str() {
            "dry_run" => summary.dry_run += 1,
            "hook_unavailable" => {
                summary.hook_unavailable += 1;
                if !cfg.allow_hook_unavailable {
                    errors.push(format!(
                        "request {} reached hook_unavailable",
                        row.request_id
                    ));
                }
            }
            "rejected_invalid_request" => {
                summary.rejected_invalid_request += 1;
                if !cfg.allow_rejected_invalid_request {
                    errors.push(format!(
                        "request {} reached rejected_invalid_request",
                        row.request_id
                    ));
                }
            }
            "accepted_for_authoritative_mutation" => {
                summary.accepted_for_authoritative_mutation += 1;
                if !cfg.allow_accepted_for_authoritative_mutation {
                    errors.push(format!(
                        "request {} reached accepted_for_authoritative_mutation",
                        row.request_id
                    ));
                }
            }
            other => errors.push(format!(
                "request {} has unknown decision {}",
                row.request_id, other
            )),
        }
    }
    if cfg.require_dry_run_only {
        let non_dry = summary.total.saturating_sub(summary.dry_run);
        if non_dry > 0 {
            errors.push(format!(
                "require_dry_run_only=true but {non_dry} rows were not dry_run"
            ));
        }
        if summary.hook_available_rows > 0 {
            errors.push(format!(
                "require_dry_run_only=true but {} rows reported hook_available=true",
                summary.hook_available_rows
            ));
        }
        if summary.apply_requested_rows > 0 {
            errors.push(format!(
                "require_dry_run_only=true but {} rows reported apply_requested=true",
                summary.apply_requested_rows
            ));
        }
    }
    if errors.is_empty() {
        Ok(summary)
    } else {
        Err(errors)
    }
}

fn parse_rows(text: &str) -> Result<Vec<HookRow>, String> {
    let mut lines = text.lines();
    let Some(header_line) = lines.next() else {
        return Ok(Vec::new());
    };
    let headers = split_csv_line(header_line);
    lines
        .filter(|line| !line.trim().is_empty())
        .map(|line| parse_row(&headers, line))
        .collect()
}

fn parse_row(headers: &[String], line: &str) -> Result<HookRow, String> {
    let fields = split_csv_line(line);
    let get = |name: &str| -> Result<&str, String> {
        headers
            .iter()
            .position(|h| h == name)
            .and_then(|idx| fields.get(idx))
            .map(String::as_str)
            .ok_or_else(|| format!("missing column {name}"))
    };
    Ok(HookRow {
        request_id: get("request_id")?.to_string(),
        frame: parse_u64(get("frame")?, "frame")?,
        checkpoint: get("checkpoint")?.to_string(),
        decision: get("decision")?.to_string(),
        requires_authoritative_world_mutation: parse_bool(get(
            "requires_authoritative_world_mutation",
        )?)?,
        hook_available: parse_bool(get("hook_available")?)?,
        apply_requested: parse_bool(get("apply_requested")?)?,
        dirty_lod0_pages: parse_u32(get("dirty_lod0_pages")?, "dirty_lod0_pages")?,
        dirty_nodes: parse_u32(get("dirty_nodes")?, "dirty_nodes")?,
        note: get("note").unwrap_or("").to_string(),
    })
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;
    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                fields.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    fields.push(current.trim().to_string());
    fields
}

fn parse_bool(value: &str) -> Result<bool, String> {
    match value.trim() {
        "true" | "TRUE" | "1" | "yes" | "on" => Ok(true),
        "false" | "FALSE" | "0" | "no" | "off" => Ok(false),
        other => Err(format!("invalid bool {other}")),
    }
}

fn parse_u32(value: &str, name: &str) -> Result<u32, String> {
    value
        .trim()
        .parse()
        .map_err(|_| format!("invalid u32 for {name}: {value}"))
}

fn parse_u64(value: &str, name: &str) -> Result<u64, String> {
    value
        .trim()
        .parse()
        .map_err(|_| format!("invalid u64 for {name}: {value}"))
}

fn fail(message: &str) -> ! {
    eprintln!("[CLOD EDIT AUTHORITATIVE HOOK GUARD] failed:\n{message}");
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(decision: &str) -> HookRow {
        HookRow {
            request_id: "r0".to_string(),
            frame: 10,
            checkpoint: "dig".to_string(),
            decision: decision.to_string(),
            requires_authoritative_world_mutation: true,
            hook_available: false,
            apply_requested: false,
            dirty_lod0_pages: 1,
            dirty_nodes: 4,
            note: "dry_run_only".to_string(),
        }
    }

    #[test]
    fn default_policy_accepts_dry_run() {
        assert!(validate_rows(&[row("dry_run")], &GuardConfig::default()).is_ok());
    }

    #[test]
    fn default_policy_rejects_authoritative_acceptance() {
        assert!(
            validate_rows(
                &[row("accepted_for_authoritative_mutation")],
                &GuardConfig::default(),
            )
            .is_err()
        );
    }

    #[test]
    fn duplicate_ids_are_rejected() {
        let a = row("dry_run");
        let mut b = row("dry_run");
        b.frame = 11;
        assert!(validate_rows(&[a, b], &GuardConfig::default()).is_err());
    }
}
