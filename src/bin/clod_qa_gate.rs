use std::{env, fs, path::Path, process};

fn main() {
    let args: Vec<String> = env::args().collect();
    let run_dir = Path::new(args.get(1).map(String::as_str).unwrap_or("bench-runs/local"));
    let cfg_path = args.get(2).map(String::as_str).unwrap_or("assets/config/clod_qa_gate.toml");
    let config = fs::read_to_string(cfg_path).unwrap_or_else(|e| fail(&format!("failed to read {cfg_path}: {e}")));
    let files = parse_required_files(&config);
    let mut errors = Vec::new();
    for file in files {
        let path = run_dir.join(&file);
        match fs::metadata(&path) {
            Ok(meta) if meta.len() > 0 => {}
            Ok(_) => errors.push(format!("empty required artifact: {}", path.display())),
            Err(_) => errors.push(format!("missing required artifact: {}", path.display())),
        }
    }
    if config.contains("require_report_markdown = true") {
        let path = run_dir.join("clod-qa-report.md");
        if !path.exists() { errors.push(format!("missing report markdown: {}", path.display())); }
    }
    if config.contains("require_report_json = true") {
        let path = run_dir.join("clod-qa-report.json");
        if !path.exists() { errors.push(format!("missing report json: {}", path.display())); }
    }
    for report in ["clod-qa-report.md", "clod-qa-report.json"] {
        let path = run_dir.join(report);
        if let Ok(text) = fs::read_to_string(&path) {
            let lower = text.to_ascii_lowercase();
            if lower.contains("\"status\":\"failed\"") || lower.contains("status: failed") || lower.contains("failed guard") {
                errors.push(format!("aggregate report contains failure marker: {}", path.display()));
            }
        }
    }
    if !errors.is_empty() { fail(&errors.join("\n")); }
    println!("[CLOD QA GATE] OK: {}", run_dir.display());
}

fn parse_required_files(config: &str) -> Vec<String> {
    let Some(start) = config.find("require_files") else { return Vec::new(); };
    let rest = &config[start..];
    let Some(open) = rest.find('[') else { return Vec::new(); };
    let Some(close) = rest[open..].find(']') else { return Vec::new(); };
    rest[open+1..open+close]
        .split(',')
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}
fn fail(msg: &str) -> ! { eprintln!("[CLOD QA GATE] FAILED\n{msg}"); process::exit(1); }
