//! Export explicit scripted CLOD edit mutation requests from dry-run records.
//!
//! This tool is intentionally conservative: by default it converts the dry-run
//! request stream into auditable mutation requests with `mutation_status = dry_run_only`.
//! Set `VOXEL_CLOD_SCRIPTED_EDITS_APPLY=1` only after a real authoritative terrain
//! mutator consumes the generated request stream.

use std::env;
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq)]
struct DryRunRow {
    request_id: u64,
    frame: u32,
    event_index: u32,
    occurrence_index: u32,
    name: String,
    kind: String,
    x: f32,
    y: f32,
    z: f32,
    radius: f32,
    strength: f32,
    target_height: Option<f32>,
    mutation_mode: String,
    dirty_lod0_pages: u32,
    dirty_ancestor_nodes: u32,
    dirty_total_nodes: u32,
    expected_dirty_pages_min: u32,
    expected_dirty_pages_max: u32,
    expected_rebuild_publish_max_frames: u32,
    expected_collider_refresh_max_frames: u32,
    within_expected_dirty_pages: bool,
    dispatch_status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MutationStatus {
    DryRunOnly,
    ReadyToApply,
    BlockedDirtyPageMismatch,
    BlockedDispatchStatus,
    BlockedInvalidRequest,
}

impl MutationStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::DryRunOnly => "dry_run_only",
            Self::ReadyToApply => "ready_to_apply",
            Self::BlockedDirtyPageMismatch => "blocked_dirty_page_mismatch",
            Self::BlockedDispatchStatus => "blocked_dispatch_status",
            Self::BlockedInvalidRequest => "blocked_invalid_request",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
struct MutationRequestRow {
    source: DryRunRow,
    apply_enabled: bool,
    requires_authoritative_world_mutation: bool,
    mutation_status: MutationStatus,
    reason: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("clod_edit_mutation_request_export failed: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() != 3 {
        return Err(
            "usage: clod_edit_mutation_request_export <clod-edit-dry-run.csv> <clod-edit-mutation-requests.csv>"
                .to_string(),
        );
    }

    let input_path = PathBuf::from(&args[1]);
    let output_path = PathBuf::from(&args[2]);
    let apply_enabled = env_flag("VOXEL_CLOD_SCRIPTED_EDITS_APPLY");

    let input = fs::read_to_string(&input_path)
        .map_err(|error| format!("failed to read {}: {error}", input_path.display()))?;
    let dry_run_rows = parse_dry_run_csv(&input)?;
    let requests = build_mutation_requests(&dry_run_rows, apply_enabled);

    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }

    let mut output = String::new();
    output.push_str(mutation_request_csv_header());
    output.push('\n');
    for request in &requests {
        output.push_str(&mutation_request_csv_row(request));
        output.push('\n');
    }

    fs::write(&output_path, output)
        .map_err(|error| format!("failed to write {}: {error}", output_path.display()))?;

    let ready = requests
        .iter()
        .filter(|row| row.mutation_status == MutationStatus::ReadyToApply)
        .count();
    println!(
        "wrote {} scripted edit mutation requests to {} (ready_to_apply={ready}, apply_enabled={apply_enabled})",
        requests.len(),
        output_path.display(),
    );
    Ok(())
}

fn build_mutation_requests(rows: &[DryRunRow], apply_enabled: bool) -> Vec<MutationRequestRow> {
    rows.iter()
        .cloned()
        .map(|source| {
            let (mutation_status, reason) = classify_mutation_request(&source, apply_enabled);
            MutationRequestRow {
                source,
                apply_enabled,
                requires_authoritative_world_mutation: true,
                mutation_status,
                reason,
            }
        })
        .collect()
}

fn classify_mutation_request(row: &DryRunRow, apply_enabled: bool) -> (MutationStatus, String) {
    if !is_supported_kind(&row.kind) || row.radius <= 0.0 || row.strength <= 0.0 {
        return (
            MutationStatus::BlockedInvalidRequest,
            "invalid kind/radius/strength".to_string(),
        );
    }
    if row.kind == "level" && row.target_height.is_none() {
        return (
            MutationStatus::BlockedInvalidRequest,
            "level edit requires target_height".to_string(),
        );
    }
    if !row.within_expected_dirty_pages {
        return (
            MutationStatus::BlockedDirtyPageMismatch,
            "dirty_lod0_pages outside expected range".to_string(),
        );
    }
    if row.dispatch_status != "ready" {
        return (
            MutationStatus::BlockedDispatchStatus,
            format!("dispatch_status={}", row.dispatch_status),
        );
    }
    if !apply_enabled {
        return (
            MutationStatus::DryRunOnly,
            "VOXEL_CLOD_SCRIPTED_EDITS_APPLY is not enabled".to_string(),
        );
    }
    (
        MutationStatus::ReadyToApply,
        "request is ready for an authoritative terrain mutator".to_string(),
    )
}

fn mutation_request_csv_header() -> &'static str {
    "request_id,frame,event_index,occurrence_index,name,kind,x,y,z,radius,strength,target_height,dirty_lod0_pages,dirty_ancestor_nodes,dirty_total_nodes,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames,apply_enabled,requires_authoritative_world_mutation,mutation_status,reason"
}

fn mutation_request_csv_row(row: &MutationRequestRow) -> String {
    format!(
        "{},{},{},{},{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{},{},{},{},{},{},{},{},{},{},{},{}",
        row.source.request_id,
        row.source.frame,
        row.source.event_index,
        row.source.occurrence_index,
        csv_escape(&row.source.name),
        row.source.kind,
        row.source.x,
        row.source.y,
        row.source.z,
        row.source.radius,
        row.source.strength,
        row.source
            .target_height
            .map(|value| format!("{value:.6}"))
            .unwrap_or_default(),
        row.source.dirty_lod0_pages,
        row.source.dirty_ancestor_nodes,
        row.source.dirty_total_nodes,
        row.source.expected_dirty_pages_min,
        row.source.expected_dirty_pages_max,
        row.source.expected_rebuild_publish_max_frames,
        row.source.expected_collider_refresh_max_frames,
        row.apply_enabled,
        row.requires_authoritative_world_mutation,
        row.mutation_status.as_str(),
        csv_escape(&row.reason),
    )
}

fn parse_dry_run_csv(input: &str) -> Result<Vec<DryRunRow>, String> {
    let mut lines = input.lines().filter(|line| !line.trim().is_empty());
    let header = lines
        .next()
        .ok_or_else(|| "empty clod-edit-dry-run CSV".to_string())?;
    let columns: Vec<&str> = header.split(',').map(str::trim).collect();
    let mut rows = Vec::new();

    for (line_index, line) in lines.enumerate() {
        let line_number = line_index + 2;
        let values = split_csv_line(line);
        let read = |name: &str| -> Result<&str, String> {
            let index = columns
                .iter()
                .position(|column| *column == name)
                .ok_or_else(|| format!("missing CSV column `{name}`"))?;
            values
                .get(index)
                .map(String::as_str)
                .ok_or_else(|| format!("line {line_number} missing value for `{name}`"))
        };

        rows.push(DryRunRow {
            request_id: parse_u64(read("request_id")?, "request_id", line_number)?,
            frame: parse_u32(read("frame")?, "frame", line_number)?,
            event_index: parse_u32(read("event_index")?, "event_index", line_number)?,
            occurrence_index: parse_u32(
                read("occurrence_index")?,
                "occurrence_index",
                line_number,
            )?,
            name: read("name")?.to_string(),
            kind: read("kind")?.to_string(),
            x: parse_f32(read("x")?, "x", line_number)?,
            y: parse_f32(read("y")?, "y", line_number)?,
            z: parse_f32(read("z")?, "z", line_number)?,
            radius: parse_f32(read("radius")?, "radius", line_number)?,
            strength: parse_f32(read("strength")?, "strength", line_number)?,
            target_height: parse_optional_f32(
                read("target_height").unwrap_or(""),
                "target_height",
                line_number,
            )?,
            mutation_mode: read("mutation_mode").unwrap_or("dry_run").to_string(),
            dirty_lod0_pages: parse_u32(
                read("dirty_lod0_pages")?,
                "dirty_lod0_pages",
                line_number,
            )?,
            dirty_ancestor_nodes: parse_u32(
                read("dirty_ancestor_nodes")?,
                "dirty_ancestor_nodes",
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
            expected_rebuild_publish_max_frames: parse_u32(
                read("expected_rebuild_publish_max_frames")?,
                "expected_rebuild_publish_max_frames",
                line_number,
            )?,
            expected_collider_refresh_max_frames: parse_u32(
                read("expected_collider_refresh_max_frames")?,
                "expected_collider_refresh_max_frames",
                line_number,
            )?,
            within_expected_dirty_pages: parse_bool(
                read("within_expected_dirty_pages")?,
                "within_expected_dirty_pages",
                line_number,
            )?,
            dispatch_status: read("dispatch_status")?.to_string(),
        });
    }

    Ok(rows)
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
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
                out.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    out.push(current.trim().to_string());
    out
}

fn is_supported_kind(value: &str) -> bool {
    matches!(value, "dig" | "raise" | "level" | "smooth")
}

fn parse_u64(value: &str, column: &str, line: usize) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|error| format!("line {line} invalid `{column}` value `{value}`: {error}"))
}

fn parse_u32(value: &str, column: &str, line: usize) -> Result<u32, String> {
    value
        .parse::<u32>()
        .map_err(|error| format!("line {line} invalid `{column}` value `{value}`: {error}"))
}

fn parse_f32(value: &str, column: &str, line: usize) -> Result<f32, String> {
    let parsed = value
        .parse::<f32>()
        .map_err(|error| format!("line {line} invalid `{column}` value `{value}`: {error}"))?;
    if !parsed.is_finite() {
        return Err(format!(
            "line {line} invalid non-finite `{column}` value `{value}`"
        ));
    }
    Ok(parsed)
}

fn parse_optional_f32(value: &str, column: &str, line: usize) -> Result<Option<f32>, String> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    parse_f32(value, column, line).map(Some)
}

fn parse_bool(value: &str, column: &str, line: usize) -> Result<bool, String> {
    match value.trim() {
        "true" => Ok(true),
        "false" => Ok(false),
        other => Err(format!("line {line} invalid `{column}` value `{other}`")),
    }
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("on")
    )
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DRY_RUN: &str = "request_id,frame,event_index,occurrence_index,name,kind,x,y,z,radius,strength,target_height,mutation_mode,dirty_lod0_pages,dirty_ancestor_nodes,dirty_total_nodes,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames,within_expected_dirty_pages,dispatch_status\n\
0,60,0,0,dig-ridge,dig,278,66,244,5.5,0.55,,dry_run,2,4,6,1,8,90,120,true,ready\n";

    #[test]
    fn dry_run_stays_blocked_without_apply_flag() {
        let rows = parse_dry_run_csv(DRY_RUN).unwrap();
        let requests = build_mutation_requests(&rows, false);
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].mutation_status, MutationStatus::DryRunOnly);
    }

    #[test]
    fn apply_flag_marks_ready_request() {
        let rows = parse_dry_run_csv(DRY_RUN).unwrap();
        let requests = build_mutation_requests(&rows, true);
        assert_eq!(requests[0].mutation_status, MutationStatus::ReadyToApply);
    }

    #[test]
    fn dirty_page_mismatch_blocks_apply() {
        let csv = DRY_RUN.replace(",true,ready", ",false,dirty_page_expectation_mismatch");
        let rows = parse_dry_run_csv(&csv).unwrap();
        let requests = build_mutation_requests(&rows, true);
        assert_eq!(
            requests[0].mutation_status,
            MutationStatus::BlockedDirtyPageMismatch
        );
    }
}
