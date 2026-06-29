//! Guard scripted CLOD edit mutation request CSVs.
//!
//! This validates the request stream produced by `clod_edit_mutation_request_export`.
//! It is intentionally conservative because real terrain mutation must be owned
//! by the authoritative world edit path, not by CLOD derived-cache code.

use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone)]
struct GuardConfig {
    allow_ready_to_apply: bool,
    allow_blocked_requests: bool,
    require_authoritative_world_mutation: bool,
    require_apply_enabled_consistency: bool,
    require_unique_request_ids: bool,
    max_radius: f32,
    max_strength: f32,
    max_dirty_lod0_pages: u32,
    max_dirty_total_nodes: u32,
}

impl Default for GuardConfig {
    fn default() -> Self {
        Self {
            allow_ready_to_apply: false,
            allow_blocked_requests: false,
            require_authoritative_world_mutation: true,
            require_apply_enabled_consistency: true,
            require_unique_request_ids: true,
            max_radius: 256.0,
            max_strength: 8.0,
            max_dirty_lod0_pages: 512,
            max_dirty_total_nodes: 4096,
        }
    }
}

#[derive(Debug, Clone)]
struct MutationRequestRow {
    line_number: usize,
    request_id: u64,
    frame: u32,
    kind: String,
    radius: f32,
    strength: f32,
    target_height: Option<f32>,
    dirty_lod0_pages: u32,
    dirty_total_nodes: u32,
    expected_dirty_pages_min: u32,
    expected_dirty_pages_max: u32,
    apply_enabled: bool,
    requires_authoritative_world_mutation: bool,
    mutation_status: String,
    reason: String,
}

#[derive(Debug, Default)]
struct GuardSummary {
    total: usize,
    dry_run_only: usize,
    ready_to_apply: usize,
    blocked: usize,
    min_frame: Option<u32>,
    max_frame: Option<u32>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("clod_edit_mutation_request_guard failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 || args.len() > 3 {
        return Err(
            "usage: clod_edit_mutation_request_guard <clod-edit-mutation-requests.csv> [config.toml]"
                .to_string(),
        );
    }

    let csv_path = PathBuf::from(&args[1]);
    let config_path = args.get(2).map(PathBuf::from);
    let config = match config_path {
        Some(path) if path.exists() => parse_config(
            &fs::read_to_string(&path)
                .map_err(|error| format!("failed to read config {}: {error}", path.display()))?,
        )?,
        _ => GuardConfig::default(),
    };

    let csv = fs::read_to_string(&csv_path)
        .map_err(|error| format!("failed to read {}: {error}", csv_path.display()))?;
    let rows = parse_mutation_request_csv(&csv)?;
    let summary = validate_rows(&rows, &config)?;

    println!(
        "CLOD mutation request guard passed: rows={}, dry_run_only={}, ready_to_apply={}, blocked={}, frames={:?}..{:?}",
        summary.total,
        summary.dry_run_only,
        summary.ready_to_apply,
        summary.blocked,
        summary.min_frame,
        summary.max_frame,
    );
    Ok(())
}

fn validate_rows(
    rows: &[MutationRequestRow],
    config: &GuardConfig,
) -> Result<GuardSummary, String> {
    if rows.is_empty() {
        return Err("mutation request CSV has no rows".to_string());
    }

    let mut summary = GuardSummary::default();
    let mut seen_request_ids = HashSet::new();
    let mut errors = Vec::new();

    for row in rows {
        summary.total += 1;
        summary.min_frame = Some(
            summary
                .min_frame
                .map_or(row.frame, |value| value.min(row.frame)),
        );
        summary.max_frame = Some(
            summary
                .max_frame
                .map_or(row.frame, |value| value.max(row.frame)),
        );

        if config.require_unique_request_ids && !seen_request_ids.insert(row.request_id) {
            errors.push(format!(
                "line {} request_id={} is duplicated",
                row.line_number, row.request_id
            ));
        }

        if !is_supported_kind(&row.kind) {
            errors.push(format!(
                "line {} request_id={} unsupported kind `{}`",
                row.line_number, row.request_id, row.kind
            ));
        }

        if row.kind == "level" && row.target_height.is_none() {
            errors.push(format!(
                "line {} request_id={} level edit missing target_height",
                row.line_number, row.request_id
            ));
        }

        if !(row.radius.is_finite() && row.radius > 0.0 && row.radius <= config.max_radius) {
            errors.push(format!(
                "line {} request_id={} invalid radius {}",
                row.line_number, row.request_id, row.radius
            ));
        }
        if !(row.strength.is_finite() && row.strength > 0.0 && row.strength <= config.max_strength)
        {
            errors.push(format!(
                "line {} request_id={} invalid strength {}",
                row.line_number, row.request_id, row.strength
            ));
        }
        if row.dirty_lod0_pages == 0 || row.dirty_lod0_pages > config.max_dirty_lod0_pages {
            errors.push(format!(
                "line {} request_id={} dirty_lod0_pages={} outside 1..={}",
                row.line_number, row.request_id, row.dirty_lod0_pages, config.max_dirty_lod0_pages
            ));
        }
        if row.dirty_total_nodes < row.dirty_lod0_pages
            || row.dirty_total_nodes > config.max_dirty_total_nodes
        {
            errors.push(format!(
                "line {} request_id={} dirty_total_nodes={} inconsistent with dirty_lod0_pages={} or max={}",
                row.line_number,
                row.request_id,
                row.dirty_total_nodes,
                row.dirty_lod0_pages,
                config.max_dirty_total_nodes
            ));
        }
        if row.expected_dirty_pages_min > row.expected_dirty_pages_max {
            errors.push(format!(
                "line {} request_id={} expected dirty min {} > max {}",
                row.line_number,
                row.request_id,
                row.expected_dirty_pages_min,
                row.expected_dirty_pages_max
            ));
        }
        if row.dirty_lod0_pages < row.expected_dirty_pages_min
            || row.dirty_lod0_pages > row.expected_dirty_pages_max
        {
            errors.push(format!(
                "line {} request_id={} dirty_lod0_pages={} outside expected {}..{}",
                row.line_number,
                row.request_id,
                row.dirty_lod0_pages,
                row.expected_dirty_pages_min,
                row.expected_dirty_pages_max
            ));
        }

        if config.require_authoritative_world_mutation && !row.requires_authoritative_world_mutation
        {
            errors.push(format!(
                "line {} request_id={} does not require authoritative world mutation",
                row.line_number, row.request_id
            ));
        }

        match row.mutation_status.as_str() {
            "dry_run_only" => {
                summary.dry_run_only += 1;
                if config.require_apply_enabled_consistency && row.apply_enabled {
                    errors.push(format!(
                        "line {} request_id={} apply_enabled=true but status is dry_run_only",
                        row.line_number, row.request_id
                    ));
                }
            }
            "ready_to_apply" => {
                summary.ready_to_apply += 1;
                if !config.allow_ready_to_apply {
                    errors.push(format!(
                        "line {} request_id={} ready_to_apply is not allowed by guard config",
                        row.line_number, row.request_id
                    ));
                }
                if config.require_apply_enabled_consistency && !row.apply_enabled {
                    errors.push(format!(
                        "line {} request_id={} ready_to_apply but apply_enabled=false",
                        row.line_number, row.request_id
                    ));
                }
            }
            status if status.starts_with("blocked_") => {
                summary.blocked += 1;
                if !config.allow_blocked_requests {
                    errors.push(format!(
                        "line {} request_id={} blocked status `{}` is not allowed: {}",
                        row.line_number, row.request_id, status, row.reason
                    ));
                }
                if row.reason.trim().is_empty() {
                    errors.push(format!(
                        "line {} request_id={} blocked status has empty reason",
                        row.line_number, row.request_id
                    ));
                }
            }
            other => errors.push(format!(
                "line {} request_id={} unknown mutation_status `{}`",
                row.line_number, row.request_id, other
            )),
        }
    }

    if errors.is_empty() {
        Ok(summary)
    } else {
        let mut message = format!("{} mutation request guard error(s):", errors.len());
        for error in errors.iter().take(32) {
            message.push_str("\n - ");
            message.push_str(error);
        }
        if errors.len() > 32 {
            message.push_str(&format!("\n - ... {} more", errors.len() - 32));
        }
        Err(message)
    }
}

fn parse_mutation_request_csv(input: &str) -> Result<Vec<MutationRequestRow>, String> {
    let mut lines = input.lines().filter(|line| !line.trim().is_empty());
    let header = lines
        .next()
        .ok_or_else(|| "empty clod-edit-mutation-requests CSV".to_string())?;
    let columns: Vec<String> = split_csv_line(header)
        .into_iter()
        .map(|column| column.trim().to_string())
        .collect();
    let mut rows = Vec::new();

    for (line_index, line) in lines.enumerate() {
        let line_number = line_index + 2;
        let values = split_csv_line(line);
        let read = |name: &str| -> Result<&str, String> {
            let index = columns
                .iter()
                .position(|column| column == name)
                .ok_or_else(|| format!("missing CSV column `{name}`"))?;
            values
                .get(index)
                .map(String::as_str)
                .ok_or_else(|| format!("line {line_number} missing value for `{name}`"))
        };

        rows.push(MutationRequestRow {
            line_number,
            request_id: parse_u64(read("request_id")?, "request_id", line_number)?,
            frame: parse_u32(read("frame")?, "frame", line_number)?,
            kind: read("kind")?.to_string(),
            radius: parse_f32(read("radius")?, "radius", line_number)?,
            strength: parse_f32(read("strength")?, "strength", line_number)?,
            target_height: parse_optional_f32(
                read("target_height").unwrap_or(""),
                "target_height",
                line_number,
            )?,
            dirty_lod0_pages: parse_u32(
                read("dirty_lod0_pages")?,
                "dirty_lod0_pages",
                line_number,
            )?,
            dirty_total_nodes: parse_u32(
                read("dirty_total_nodes")?,
                "dirty_total_nodes",
                line_number,
            )?,
            expected_dirty_pages_min: parse_u32(
                read("expected_dirty_pages_min")?,
                "expected_dirty_pages_min",
                line_number,
            )?,
            expected_dirty_pages_max: parse_u32(
                read("expected_dirty_pages_max")?,
                "expected_dirty_pages_max",
                line_number,
            )?,
            apply_enabled: parse_bool(read("apply_enabled")?, "apply_enabled", line_number)?,
            requires_authoritative_world_mutation: parse_bool(
                read("requires_authoritative_world_mutation")?,
                "requires_authoritative_world_mutation",
                line_number,
            )?,
            mutation_status: read("mutation_status")?.to_string(),
            reason: read("reason").unwrap_or("").to_string(),
        });
    }

    Ok(rows)
}

fn parse_config(input: &str) -> Result<GuardConfig, String> {
    let mut config = GuardConfig::default();
    let mut values = HashMap::new();

    for raw_line in input.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        values.insert(
            key.trim().to_string(),
            value.trim().trim_matches('"').to_string(),
        );
    }

    if let Some(value) = values.get("allow_ready_to_apply") {
        config.allow_ready_to_apply = parse_config_bool(value, "allow_ready_to_apply")?;
    }
    if let Some(value) = values.get("allow_blocked_requests") {
        config.allow_blocked_requests = parse_config_bool(value, "allow_blocked_requests")?;
    }
    if let Some(value) = values.get("require_authoritative_world_mutation") {
        config.require_authoritative_world_mutation =
            parse_config_bool(value, "require_authoritative_world_mutation")?;
    }
    if let Some(value) = values.get("require_apply_enabled_consistency") {
        config.require_apply_enabled_consistency =
            parse_config_bool(value, "require_apply_enabled_consistency")?;
    }
    if let Some(value) = values.get("require_unique_request_ids") {
        config.require_unique_request_ids = parse_config_bool(value, "require_unique_request_ids")?;
    }
    if let Some(value) = values.get("max_radius") {
        config.max_radius = value
            .parse::<f32>()
            .map_err(|error| format!("invalid max_radius `{value}`: {error}"))?;
    }
    if let Some(value) = values.get("max_strength") {
        config.max_strength = value
            .parse::<f32>()
            .map_err(|error| format!("invalid max_strength `{value}`: {error}"))?;
    }
    if let Some(value) = values.get("max_dirty_lod0_pages") {
        config.max_dirty_lod0_pages = value
            .parse::<u32>()
            .map_err(|error| format!("invalid max_dirty_lod0_pages `{value}`: {error}"))?;
    }
    if let Some(value) = values.get("max_dirty_total_nodes") {
        config.max_dirty_total_nodes = value
            .parse::<u32>()
            .map_err(|error| format!("invalid max_dirty_total_nodes `{value}`: {error}"))?;
    }

    Ok(config)
}

fn is_supported_kind(kind: &str) -> bool {
    matches!(kind, "dig" | "raise" | "level" | "smooth")
}

fn parse_u64(value: &str, field: &str, line: usize) -> Result<u64, String> {
    value
        .trim()
        .parse::<u64>()
        .map_err(|error| format!("line {line} invalid {field} `{value}`: {error}"))
}

fn parse_u32(value: &str, field: &str, line: usize) -> Result<u32, String> {
    value
        .trim()
        .parse::<u32>()
        .map_err(|error| format!("line {line} invalid {field} `{value}`: {error}"))
}

fn parse_f32(value: &str, field: &str, line: usize) -> Result<f32, String> {
    value
        .trim()
        .parse::<f32>()
        .map_err(|error| format!("line {line} invalid {field} `{value}`: {error}"))
}

fn parse_optional_f32(value: &str, field: &str, line: usize) -> Result<Option<f32>, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    parse_f32(trimmed, field, line).map(Some)
}

fn parse_bool(value: &str, field: &str, line: usize) -> Result<bool, String> {
    match value.trim() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        other => Err(format!("line {line} invalid bool {field} `{other}`")),
    }
}

fn parse_config_bool(value: &str, field: &str) -> Result<bool, String> {
    match value.trim() {
        "true" | "1" | "yes" | "on" => Ok(true),
        "false" | "0" | "no" | "off" => Ok(false),
        other => Err(format!("invalid bool {field} `{other}`")),
    }
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut cells = Vec::new();
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
                cells.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    cells.push(current.trim().to_string());
    cells
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_csv(status: &str, apply_enabled: bool) -> String {
        format!(
            "request_id,frame,event_index,occurrence_index,name,kind,x,y,z,radius,strength,target_height,dirty_lod0_pages,dirty_ancestor_nodes,dirty_total_nodes,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames,apply_enabled,requires_authoritative_world_mutation,mutation_status,reason\n1,60,0,0,dig-a,dig,10,20,30,4,0.5,,2,3,5,1,8,90,120,{apply_enabled},true,{status},ok\n"
        )
    }

    #[test]
    fn accepts_default_dry_run_only() {
        let rows = parse_mutation_request_csv(&sample_csv("dry_run_only", false)).unwrap();
        let summary = validate_rows(&rows, &GuardConfig::default()).unwrap();
        assert_eq!(summary.dry_run_only, 1);
    }

    #[test]
    fn rejects_ready_by_default() {
        let rows = parse_mutation_request_csv(&sample_csv("ready_to_apply", true)).unwrap();
        let error = validate_rows(&rows, &GuardConfig::default()).unwrap_err();
        assert!(error.contains("ready_to_apply is not allowed"));
    }

    #[test]
    fn can_allow_ready_to_apply() {
        let mut config = GuardConfig::default();
        config.allow_ready_to_apply = true;
        let rows = parse_mutation_request_csv(&sample_csv("ready_to_apply", true)).unwrap();
        let summary = validate_rows(&rows, &config).unwrap();
        assert_eq!(summary.ready_to_apply, 1);
    }
}
