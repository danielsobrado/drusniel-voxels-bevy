use std::{collections::HashSet, env, fs, process};

#[derive(Default)]
struct Config {
    require_non_empty: bool,
    require_unique_request_ids: bool,
    require_dry_run_only: bool,
    allow_missing_refresh_when_dry_run: bool,
    allow_refreshed: bool,
    allow_stale: bool,
    allow_timeout: bool,
    max_refresh_latency_frames: i64,
    max_stale_collider_frames: i64,
    max_dirty_lod0_pages: i64,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    let csv_path = args.get(1).map(String::as_str).unwrap_or("bench-runs/local/clod-collider-refresh.csv");
    let cfg_path = args.get(2).map(String::as_str).unwrap_or("assets/config/clod_collider_refresh_guard.toml");
    let cfg = parse_config(&fs::read_to_string(cfg_path).unwrap_or_default());
    let csv = fs::read_to_string(csv_path).unwrap_or_else(|e| fail(&format!("failed to read {csv_path}: {e}")));
    let mut errors = Vec::new();
    let rows = parse_rows(&csv);
    if cfg.require_non_empty && rows.is_empty() { errors.push("no collider-refresh rows found".to_string()); }

    let mut seen = HashSet::new();
    for row in &rows {
        if cfg.require_unique_request_ids && !seen.insert(row.get("request_id").to_string()) {
            errors.push(format!("duplicate request_id {}", row.get("request_id")));
        }
        let decision = row.get("decision");
        if cfg.require_dry_run_only && decision != "dry_run" {
            errors.push(format!("non-dry-run collider decision for {}: {}", row.get("request_id"), decision));
        }
        if decision == "refreshed" && !cfg.allow_refreshed { errors.push(format!("refreshed row not allowed: {}", row.get("request_id"))); }
        if decision == "stale" && !cfg.allow_stale { errors.push(format!("stale collider row: {}", row.get("request_id"))); }
        if decision == "timeout" && !cfg.allow_timeout { errors.push(format!("collider refresh timeout: {}", row.get("request_id"))); }
        if decision == "pending_authoritative_apply" && !cfg.allow_missing_refresh_when_dry_run {
            errors.push(format!("pending refresh not allowed: {}", row.get("request_id")));
        }
        let dirty = row.get("dirty_lod0_pages").parse::<i64>().unwrap_or(0);
        if dirty > cfg.max_dirty_lod0_pages { errors.push(format!("dirty_lod0_pages too high for {}: {}", row.get("request_id"), dirty)); }
        let latency = row.get("refresh_latency_frames").parse::<i64>().unwrap_or(-1);
        if latency >= 0 && latency > cfg.max_refresh_latency_frames { errors.push(format!("refresh latency too high for {}: {}", row.get("request_id"), latency)); }
        let stale = row.get("stale_collider_frames").parse::<i64>().unwrap_or(0);
        if stale > cfg.max_stale_collider_frames { errors.push(format!("stale collider frames for {}: {}", row.get("request_id"), stale)); }
    }
    if !errors.is_empty() { fail(&errors.join("\n")); }
    println!("[CLOD COLLIDER REFRESH GUARD] OK: {} rows", rows.len());
}

#[derive(Debug)]
struct Row<'a> { headers: &'a [&'a str], fields: Vec<&'a str> }
impl<'a> Row<'a> {
    fn get(&self, name: &str) -> &str {
        self.headers.iter().position(|h| h.trim()==name).and_then(|i| self.fields.get(i).copied()).unwrap_or("").trim()
    }
}
fn parse_rows(csv: &str) -> Vec<Row<'_>> {
    let mut lines = csv.lines();
    let Some(header) = lines.next() else { return Vec::new(); };
    let boxed: Box<[&str]> = header.split(',').collect::<Vec<_>>().into_boxed_slice();
    let headers: &'static [&'static str] = Box::leak(boxed);
    lines.filter(|l| !l.trim().is_empty()).map(|l| Row { headers, fields: l.split(',').collect() }).collect()
}
fn parse_config(toml: &str) -> Config {
    let mut c = Config { require_non_empty:true, require_unique_request_ids:true, require_dry_run_only:true, allow_missing_refresh_when_dry_run:true, max_refresh_latency_frames:180, max_dirty_lod0_pages:512, ..Default::default() };
    for line in toml.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') { continue; }
        let Some((k,v)) = line.split_once('=') else { continue; };
        let k=k.trim(); let v=v.trim(); let b=matches!(v,"true"|"1"); let n=v.parse::<i64>().unwrap_or(0);
        match k {
            "require_non_empty" => c.require_non_empty=b,
            "require_unique_request_ids" => c.require_unique_request_ids=b,
            "require_dry_run_only" => c.require_dry_run_only=b,
            "allow_missing_refresh_when_dry_run" => c.allow_missing_refresh_when_dry_run=b,
            "allow_refreshed" => c.allow_refreshed=b,
            "allow_stale" => c.allow_stale=b,
            "allow_timeout" => c.allow_timeout=b,
            "max_refresh_latency_frames" => c.max_refresh_latency_frames=n,
            "max_stale_collider_frames" => c.max_stale_collider_frames=n,
            "max_dirty_lod0_pages" => c.max_dirty_lod0_pages=n,
            _ => {}
        }
    }
    c
}
fn fail(msg: &str) -> ! { eprintln!("[CLOD COLLIDER REFRESH GUARD] FAILED\n{msg}"); process::exit(1); }
