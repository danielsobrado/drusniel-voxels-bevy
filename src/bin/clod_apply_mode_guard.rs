use std::{collections::HashMap, env, fs, path::Path, process};

#[derive(Default)]
struct Config {
    require_dry_run_only: bool,
    require_authoritative_acceptance: bool,
    require_collider_refresh: bool,
    require_rebuild_after_apply: bool,
    allow_pending_authoritative_apply: bool,
    max_apply_to_rebuild_latency_frames: i64,
    max_apply_to_collider_latency_frames: i64,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let run_dir = Path::new(args.get(1).map(String::as_str).unwrap_or("bench-runs/local"));
    let cfg_path = args.get(2).map(String::as_str).unwrap_or("assets/config/clod_apply_mode_guard.toml");
    let cfg = parse_config(&fs::read_to_string(cfg_path).unwrap_or_default());
    let requests = read_csv(&run_dir.join("clod-edit-mutation-requests.csv"));
    let hooks = read_csv(&run_dir.join("clod-edit-authoritative-hook.csv"));
    let colliders = read_csv(&run_dir.join("clod-collider-refresh.csv"));
    let rebuilds = read_csv(&run_dir.join("clod-rebuild-observer.csv"));

    let hook_by_id = by_request_id(&hooks);
    let collider_by_id = by_request_id(&colliders);
    let mut errors = Vec::new();
    if requests.is_empty() { errors.push("no mutation requests found".to_string()); }

    for req in &requests {
        let id = get(req,"request_id");
        let status = get(req,"mutation_status");
        if cfg.require_dry_run_only && status != "dry_run_only" {
            errors.push(format!("non-dry-run mutation request {id}: {status}"));
        }
        let hook = hook_by_id.get(id);
        if cfg.require_authoritative_acceptance {
            match hook.map(|r| get(r,"decision")) {
                Some("accepted_for_authoritative_mutation") => {}
                other => errors.push(format!("request {id} not accepted by authoritative hook: {:?}", other)),
            }
        }
        if !cfg.allow_pending_authoritative_apply {
            if let Some(h) = hook { if get(h,"decision") == "hook_unavailable" { errors.push(format!("hook unavailable for {id}")); } }
        }
        if cfg.require_collider_refresh {
            match collider_by_id.get(id).map(|r| get(r,"decision")) {
                Some("refreshed") => {}
                other => errors.push(format!("request {id} lacks collider refresh: {:?}", other)),
            }
        }
    }
    if cfg.require_rebuild_after_apply && !rebuilds.iter().any(|r| get(r,"phase") == "published" || get(r,"stage") == "published") {
        errors.push("no published CLOD rebuild rows found after apply".to_string());
    }
    let _ = cfg.max_apply_to_rebuild_latency_frames;
    let _ = cfg.max_apply_to_collider_latency_frames;
    if !errors.is_empty() { fail(&errors.join("\n")); }
    println!("[CLOD APPLY MODE GUARD] OK");
}

type Row = HashMap<String,String>;
fn read_csv(path: &Path) -> Vec<Row> {
    let Ok(csv) = fs::read_to_string(path) else { return Vec::new(); };
    let mut lines = csv.lines();
    let Some(header) = lines.next() else { return Vec::new(); };
    let headers: Vec<String> = header.split(',').map(|s| s.trim().to_string()).collect();
    lines.filter(|l| !l.trim().is_empty()).map(|line| {
        headers.iter().cloned().zip(line.split(',').map(|s| s.trim().to_string())).collect()
    }).collect()
}
fn by_request_id(rows: &[Row]) -> HashMap<&str, &Row> {
    rows.iter().filter_map(|r| r.get("request_id").map(|id| (id.as_str(), r))).collect()
}
fn get<'a>(row: &'a Row, key: &str) -> &'a str { row.get(key).map(String::as_str).unwrap_or("") }
fn parse_config(toml: &str) -> Config {
    let mut c = Config { require_dry_run_only: true, max_apply_to_rebuild_latency_frames:180, max_apply_to_collider_latency_frames:180, ..Default::default() };
    for line in toml.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') { continue; }
        let Some((k,v)) = line.split_once('=') else { continue; };
        let b = matches!(v.trim(), "true"|"1"); let n = v.trim().parse().unwrap_or(0);
        match k.trim() {
            "require_dry_run_only" => c.require_dry_run_only=b,
            "require_authoritative_acceptance" => c.require_authoritative_acceptance=b,
            "require_collider_refresh" => c.require_collider_refresh=b,
            "require_rebuild_after_apply" => c.require_rebuild_after_apply=b,
            "allow_pending_authoritative_apply" => c.allow_pending_authoritative_apply=b,
            "max_apply_to_rebuild_latency_frames" => c.max_apply_to_rebuild_latency_frames=n,
            "max_apply_to_collider_latency_frames" => c.max_apply_to_collider_latency_frames=n,
            _ => {}
        }
    }
    c
}
fn fail(msg: &str) -> ! { eprintln!("[CLOD APPLY MODE GUARD] FAILED\n{msg}"); process::exit(1); }
