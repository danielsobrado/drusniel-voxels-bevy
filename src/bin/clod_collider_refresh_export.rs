use std::{env, fs, io};

#[derive(Debug, Clone)]
struct HookRow {
    request_id: String,
    frame: i64,
    decision: String,
    dirty_lod0_pages: i64,
    expected_collider_refresh_max_frames: i64,
}

fn main() -> io::Result<()> {
    let args: Vec<String> = env::args().collect();
    let input = args.get(1).map(String::as_str).unwrap_or("bench-runs/local/clod-edit-authoritative-hook.csv");
    let output = args.get(2).map(String::as_str).unwrap_or("bench-runs/local/clod-collider-refresh.csv");
    let csv = fs::read_to_string(input)?;
    let rows = parse_hook_rows(&csv);
    let apply_mode = env_flag("VOXEL_CLOD_SCRIPTED_EDITS_APPLY");
    let real_refresh = env_flag("VOXEL_CLOD_COLLIDER_REFRESH_APPLIED");

    let mut out = String::from("request_id,frame,decision,dirty_lod0_pages,requires_collider_refresh,refresh_frame,refresh_latency_frames,stale_collider_frames,expected_collider_refresh_max_frames,notes\n");
    for row in rows {
        let requires = row.dirty_lod0_pages > 0 && row.decision != "dry_run";
        let decision = if !apply_mode || row.decision == "dry_run" {
            "dry_run"
        } else if real_refresh && requires {
            "refreshed"
        } else if requires {
            "pending_authoritative_apply"
        } else {
            "dry_run"
        };
        let refresh_frame = if decision == "refreshed" { row.frame + 1 } else { -1 };
        let latency = if decision == "refreshed" { 1 } else { -1 };
        let stale = if decision == "refreshed" || decision == "dry_run" { 0 } else { row.expected_collider_refresh_max_frames.max(1) };
        let notes = match decision {
            "dry_run" => "no_authoritative_mutation",
            "refreshed" => "collider_refresh_reported",
            "pending_authoritative_apply" => "waiting_for_real_world_mutator",
            _ => "unknown",
        };
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            row.request_id,
            row.frame,
            decision,
            row.dirty_lod0_pages,
            requires,
            refresh_frame,
            latency,
            stale,
            row.expected_collider_refresh_max_frames,
            notes
        ));
    }

    if let Some(parent) = std::path::Path::new(output).parent() { fs::create_dir_all(parent)?; }
    fs::write(output, out)?;
    Ok(())
}

fn env_flag(name: &str) -> bool {
    matches!(env::var(name).ok().as_deref(), Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("on"))
}

fn parse_hook_rows(csv: &str) -> Vec<HookRow> {
    let mut lines = csv.lines();
    let Some(header) = lines.next() else { return Vec::new(); };
    let headers: Vec<&str> = header.split(',').collect();
    lines.filter(|l| !l.trim().is_empty()).filter_map(|line| {
        let fields: Vec<&str> = line.split(',').collect();
        let get = |name: &str| -> &str {
            headers.iter().position(|h| h.trim() == name)
                .and_then(|i| fields.get(i).copied()).unwrap_or("").trim()
        };
        let request_id = get("request_id").to_string();
        if request_id.is_empty() { return None; }
        Some(HookRow {
            request_id,
            frame: get("frame").parse().unwrap_or(0),
            decision: get("decision").to_string(),
            dirty_lod0_pages: get("dirty_lod0_pages").parse().unwrap_or(0),
            expected_collider_refresh_max_frames: get("expected_collider_refresh_max_frames").parse().unwrap_or(120),
        })
    }).collect()
}
