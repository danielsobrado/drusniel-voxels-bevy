use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::Path;

use voxel_builder::voxel::pages::scripted_edit_mutation_sink::{
    MutationRequestRow, MutationSinkMode, decide_mutation_requests,
};

fn bool_env(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
    )
}

fn parse_bool(value: &str) -> bool {
    matches!(value.trim(), "1" | "true" | "TRUE" | "yes" | "YES")
}

fn parse_optional_f32(value: &str) -> Option<f32> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("none")
        || trimmed.eq_ignore_ascii_case("null")
    {
        None
    } else {
        trimmed.parse().ok()
    }
}

fn split_csv_line(line: &str) -> Vec<String> {
    // The generated QA CSVs intentionally avoid embedded commas/quotes. Keep the
    // parser small and dependency-free so this guard can run in minimal CI jobs.
    line.split(',')
        .map(|part| part.trim().to_string())
        .collect()
}

fn col(header: &[String], name: &str) -> io::Result<usize> {
    header.iter().position(|h| h == name).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("missing column `{name}`"),
        )
    })
}

fn opt_col(header: &[String], name: &str) -> Option<usize> {
    header.iter().position(|h| h == name)
}

fn col_alias(header: &[String], primary: &str, fallback: &str) -> io::Result<usize> {
    opt_col(header, primary)
        .or_else(|| opt_col(header, fallback))
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("missing column `{primary}` or `{fallback}`"),
            )
        })
}

fn load_requests(path: &Path) -> io::Result<Vec<MutationRequestRow>> {
    let text = fs::read_to_string(path)?;
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return Ok(Vec::new());
    };
    let header = split_csv_line(header_line);
    let request_id = col(&header, "request_id")?;
    let frame = col(&header, "frame")?;
    let event_id = opt_col(&header, "event_id");
    let event_index = opt_col(&header, "event_index");
    let occurrence_index = opt_col(&header, "occurrence_index");
    let kind = col(&header, "kind")?;
    let position_x = col_alias(&header, "position_x", "x")?;
    let position_y = col_alias(&header, "position_y", "y")?;
    let position_z = col_alias(&header, "position_z", "z")?;
    let radius = col(&header, "radius")?;
    let strength = col(&header, "strength")?;
    let target_height = col(&header, "target_height")?;
    let dirty_lod0_pages = col(&header, "dirty_lod0_pages")?;
    let dirty_parent_nodes = col_alias(&header, "dirty_parent_nodes", "dirty_ancestor_nodes")?;
    let mutation_status = col(&header, "mutation_status")?;
    let requires_authoritative_world_mutation =
        col(&header, "requires_authoritative_world_mutation")?;

    let mut rows = Vec::new();
    for (line_no, line) in lines.enumerate() {
        let values = split_csv_line(line);
        let at = |idx: usize| values.get(idx).map(String::as_str).unwrap_or("");
        let parse_err = |field: &str| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                format!("invalid {field} at data line {}", line_no + 2),
            )
        };
        let fallback_event_id = match (event_index, occurrence_index) {
            (Some(event_index), Some(occurrence_index)) => {
                format!("{}:{}", at(event_index), at(occurrence_index))
            }
            _ => at(request_id).to_string(),
        };
        let event_id = event_id
            .map(|idx| at(idx).to_string())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(fallback_event_id);
        rows.push(MutationRequestRow {
            request_id: at(request_id).to_string(),
            frame: at(frame).parse().map_err(|_| parse_err("frame"))?,
            event_id,
            kind: at(kind).to_string(),
            position_x: at(position_x)
                .parse()
                .map_err(|_| parse_err("position_x"))?,
            position_y: at(position_y)
                .parse()
                .map_err(|_| parse_err("position_y"))?,
            position_z: at(position_z)
                .parse()
                .map_err(|_| parse_err("position_z"))?,
            radius: at(radius).parse().map_err(|_| parse_err("radius"))?,
            strength: at(strength).parse().map_err(|_| parse_err("strength"))?,
            target_height: parse_optional_f32(at(target_height)),
            dirty_lod0_pages: at(dirty_lod0_pages)
                .parse()
                .map_err(|_| parse_err("dirty_lod0_pages"))?,
            dirty_parent_nodes: at(dirty_parent_nodes)
                .parse()
                .map_err(|_| parse_err("dirty_parent_nodes"))?,
            mutation_status: at(mutation_status).to_string(),
            requires_authoritative_world_mutation: parse_bool(at(
                requires_authoritative_world_mutation,
            )),
        });
    }
    Ok(rows)
}

fn main() -> io::Result<()> {
    let mut args = env::args().skip(1);
    let input = args
        .next()
        .unwrap_or_else(|| "bench-runs/local/clod-edit-mutation-requests.csv".to_string());
    let output = args
        .next()
        .unwrap_or_else(|| "bench-runs/local/clod-edit-mutation-sink.csv".to_string());

    let apply_requested = bool_env("VOXEL_CLOD_SCRIPTED_EDITS_APPLY");
    let hook_available = bool_env("VOXEL_CLOD_SCRIPTED_EDITS_AUTHORITATIVE_HOOK");
    let mode = MutationSinkMode::from_flags(apply_requested, hook_available);

    let rows = load_requests(Path::new(&input))?;
    let (decisions, summary) = decide_mutation_requests(&rows, mode);

    if let Some(parent) = Path::new(&output).parent() {
        fs::create_dir_all(parent)?;
    }
    let mut out = fs::File::create(&output)?;
    writeln!(
        out,
        "request_id,frame,event_id,decision,reason,dirty_lod0_pages,dirty_parent_nodes"
    )?;
    for decision in decisions {
        writeln!(
            out,
            "{},{},{},{},{},{},{}",
            decision.request_id,
            decision.frame,
            decision.event_id,
            decision.decision.as_str(),
            decision.reason,
            decision.dirty_lod0_pages,
            decision.dirty_parent_nodes
        )?;
    }

    eprintln!(
        "clod_edit_mutation_sink_export: total={} dry_run={} blocked={} ready={} applied_placeholder={} duplicate_ids={}",
        summary.total,
        summary.dry_run,
        summary.blocked,
        summary.ready,
        summary.applied_placeholder,
        summary.duplicate_ids
    );
    Ok(())
}
