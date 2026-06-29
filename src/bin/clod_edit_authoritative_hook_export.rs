use std::env;
use std::fs;
use std::io;

use voxel_builder::voxel::pages::scripted_edit_authoritative_hook::{
    AuthoritativeEditHookMode, AuthoritativeEditRequest, audit_authoritative_edit_requests,
    audit_rows_to_csv,
};

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    let input = args
        .get(1)
        .map(String::as_str)
        .unwrap_or("bench-runs/local/clod-edit-mutation-requests.csv");
    let output = args
        .get(2)
        .map(String::as_str)
        .unwrap_or("bench-runs/local/clod-edit-authoritative-hook.csv");

    let apply_requested = env_flag("VOXEL_CLOD_SCRIPTED_EDITS_APPLY");
    let hook_available = env_flag("VOXEL_CLOD_SCRIPTED_EDITS_AUTHORITATIVE_HOOK");
    let mode = AuthoritativeEditHookMode::from_flags(apply_requested, hook_available);

    let csv = fs::read_to_string(input)?;
    let requests = parse_requests(&csv);
    let rows = audit_authoritative_edit_requests(requests, mode);
    if let Some(parent) = std::path::Path::new(output).parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output, audit_rows_to_csv(&rows))?;
    println!(
        "[CLOD EDIT AUTHORITATIVE HOOK] wrote {} rows to {}",
        rows.len(),
        output
    );
    Ok(())
}

fn env_flag(name: &str) -> bool {
    matches!(
        env::var(name).ok().as_deref(),
        Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("on")
    )
}

fn parse_requests(csv: &str) -> Vec<AuthoritativeEditRequest> {
    let mut lines = csv.lines();
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let headers: Vec<&str> = header.split(',').collect();
    lines
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| parse_request_line(&headers, line))
        .collect()
}

fn parse_request_line(headers: &[&str], line: &str) -> Option<AuthoritativeEditRequest> {
    let fields: Vec<&str> = line.split(',').collect();
    let get = |name: &str| -> Option<&str> {
        headers
            .iter()
            .position(|h| h.trim() == name)
            .and_then(|idx| fields.get(idx).copied())
            .map(str::trim)
    };

    let request_id = get("request_id")?.to_string();
    let frame = get("frame").and_then(|v| v.parse().ok()).unwrap_or(0);
    let checkpoint = get("checkpoint").unwrap_or("").to_string();
    let kind = get("kind").unwrap_or("").to_string();
    let x = get("x").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let y = get("y").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let z = get("z").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let radius = get("radius").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let strength = get("strength").and_then(|v| v.parse().ok()).unwrap_or(0.0);
    let target_height = get("target_height").and_then(|v| {
        if v.is_empty() || v.eq_ignore_ascii_case("none") {
            None
        } else {
            v.parse().ok()
        }
    });
    let dirty_lod0_pages = get("dirty_lod0_pages")
        .or_else(|| get("expected_dirty_lod0_pages"))
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let dirty_nodes = get("dirty_nodes")
        .or_else(|| get("expected_dirty_nodes"))
        .and_then(|v| v.parse().ok())
        .unwrap_or(dirty_lod0_pages);

    Some(AuthoritativeEditRequest {
        request_id,
        frame,
        checkpoint,
        kind,
        x,
        y,
        z,
        radius,
        strength,
        target_height,
        dirty_lod0_pages,
        dirty_nodes,
    })
}
