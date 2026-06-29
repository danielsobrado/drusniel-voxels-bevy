use std::{collections::HashSet, env, fs, path::PathBuf, process};

#[derive(Debug, Clone)]
struct Config {
    min_rows: usize,
    require_dry_run_mode: bool,
    require_ready_status: bool,
    require_expected_dirty_page_match: bool,
    max_dirty_lod0_pages_per_request: u64,
    max_dirty_total_nodes_per_request: u64,
    require_monotonic_frames: bool,
    min_radius: f64,
    max_radius: f64,
    min_strength: f64,
    max_strength: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            min_rows: 1,
            require_dry_run_mode: true,
            require_ready_status: true,
            require_expected_dirty_page_match: true,
            max_dirty_lod0_pages_per_request: 64,
            max_dirty_total_nodes_per_request: 128,
            require_monotonic_frames: true,
            min_radius: 0.01,
            max_radius: 256.0,
            min_strength: 0.0001,
            max_strength: 10.0,
        }
    }
}

#[derive(Debug, Clone)]
struct Row {
    line: usize,
    request_id: u64,
    frame: u64,
    event_index: u64,
    occurrence_index: u64,
    name: String,
    kind: String,
    radius: f64,
    strength: f64,
    target_height: Option<f64>,
    mutation_mode: String,
    dirty_lod0_pages: u64,
    dirty_ancestor_nodes: u64,
    dirty_total_nodes: u64,
    expected_dirty_pages_min: u64,
    expected_dirty_pages_max: u64,
    expected_rebuild_publish_max_frames: u64,
    expected_collider_refresh_max_frames: u64,
    within_expected_dirty_pages: bool,
    dispatch_status: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("clod_edit_dry_run_guard failed: {error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    let csv_path = args
        .first()
        .ok_or_else(|| "usage: clod_edit_dry_run_guard <clod-edit-dry-run.csv> [--config assets/config/clod_edit_dry_run_guard.toml]".to_string())?;

    let config_path = parse_config_path(&args)
        .unwrap_or_else(|| PathBuf::from("assets/config/clod_edit_dry_run_guard.toml"));
    let config = load_config(&config_path)?;

    let input = fs::read_to_string(csv_path)
        .map_err(|error| format!("failed to read {csv_path}: {error}"))?;
    let rows = parse_rows(&input)?;
    let report = validate_rows(&rows, &config);

    if report.errors.is_empty() {
        println!(
            "CLOD edit dry-run guard passed: rows={} warnings={}",
            rows.len(),
            report.warnings.len()
        );
        for warning in &report.warnings {
            println!("warning: {warning}");
        }
        Ok(())
    } else {
        for error in &report.errors {
            eprintln!("error: {error}");
        }
        for warning in &report.warnings {
            eprintln!("warning: {warning}");
        }
        Err(format!("{} dry-run guard error(s)", report.errors.len()))
    }
}

fn parse_config_path(args: &[String]) -> Option<PathBuf> {
    args.windows(2)
        .find(|pair| pair[0] == "--config")
        .map(|pair| PathBuf::from(&pair[1]))
}

fn load_config(path: &PathBuf) -> Result<Config, String> {
    let mut config = Config::default();
    let Ok(input) = fs::read_to_string(path) else {
        return Ok(config);
    };

    for (line_index, raw_line) in input.lines().enumerate() {
        let line = raw_line.split('#').next().unwrap_or_default().trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return Err(format!(
                "{}:{} expected key = value",
                path.display(),
                line_index + 1
            ));
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"');
        match key {
            "min_rows" => config.min_rows = parse_value(path, line_index, key, value)?,
            "require_dry_run_mode" => {
                config.require_dry_run_mode = parse_value(path, line_index, key, value)?
            }
            "require_ready_status" => {
                config.require_ready_status = parse_value(path, line_index, key, value)?
            }
            "require_expected_dirty_page_match" => {
                config.require_expected_dirty_page_match =
                    parse_value(path, line_index, key, value)?
            }
            "max_dirty_lod0_pages_per_request" => {
                config.max_dirty_lod0_pages_per_request = parse_value(path, line_index, key, value)?
            }
            "max_dirty_total_nodes_per_request" => {
                config.max_dirty_total_nodes_per_request =
                    parse_value(path, line_index, key, value)?
            }
            "require_monotonic_frames" => {
                config.require_monotonic_frames = parse_value(path, line_index, key, value)?
            }
            "min_radius" => config.min_radius = parse_value(path, line_index, key, value)?,
            "max_radius" => config.max_radius = parse_value(path, line_index, key, value)?,
            "min_strength" => config.min_strength = parse_value(path, line_index, key, value)?,
            "max_strength" => config.max_strength = parse_value(path, line_index, key, value)?,
            _ => {}
        }
    }

    if config.min_radius <= 0.0 || config.max_radius < config.min_radius {
        return Err("invalid radius guard range".to_string());
    }
    if config.min_strength <= 0.0 || config.max_strength < config.min_strength {
        return Err("invalid strength guard range".to_string());
    }

    Ok(config)
}

fn parse_value<T: std::str::FromStr>(
    path: &PathBuf,
    line_index: usize,
    key: &str,
    value: &str,
) -> Result<T, String> {
    value.parse::<T>().map_err(|_| {
        format!(
            "{}:{} invalid value `{}` for `{}`",
            path.display(),
            line_index + 1,
            value,
            key
        )
    })
}

#[derive(Debug, Default)]
struct Report {
    errors: Vec<String>,
    warnings: Vec<String>,
}

fn validate_rows(rows: &[Row], config: &Config) -> Report {
    let mut report = Report::default();
    if rows.len() < config.min_rows {
        report.errors.push(format!(
            "expected at least {} dry-run rows, got {}",
            config.min_rows,
            rows.len()
        ));
    }

    let mut seen_request_ids = HashSet::new();
    let mut previous_frame = None::<u64>;
    let mut previous_request_id = None::<u64>;

    for row in rows {
        if !seen_request_ids.insert(row.request_id) {
            report.errors.push(format!(
                "line {} duplicate request_id {}",
                row.line, row.request_id
            ));
        }
        if let Some(previous) = previous_request_id {
            if row.request_id <= previous {
                report.errors.push(format!(
                    "line {} request_id {} is not strictly increasing after {}",
                    row.line, row.request_id, previous
                ));
            }
        }
        previous_request_id = Some(row.request_id);

        if config.require_monotonic_frames {
            if let Some(previous) = previous_frame {
                if row.frame < previous {
                    report.errors.push(format!(
                        "line {} frame {} is before previous frame {}",
                        row.line, row.frame, previous
                    ));
                }
            }
            previous_frame = Some(row.frame);
        }

        if row.name.trim().is_empty() {
            report
                .errors
                .push(format!("line {} has empty edit name", row.line));
        }
        if !matches!(row.kind.as_str(), "dig" | "raise" | "level" | "smooth") {
            report.errors.push(format!(
                "line {} has unsupported edit kind `{}`",
                row.line, row.kind
            ));
        }
        if row.kind == "level" && row.target_height.is_none() {
            report.errors.push(format!(
                "line {} level edit `{}` is missing target_height",
                row.line, row.name
            ));
        }
        if !row.radius.is_finite()
            || row.radius < config.min_radius
            || row.radius > config.max_radius
        {
            report.errors.push(format!(
                "line {} radius {} outside [{}, {}]",
                row.line, row.radius, config.min_radius, config.max_radius
            ));
        }
        if !row.strength.is_finite()
            || row.strength < config.min_strength
            || row.strength > config.max_strength
        {
            report.errors.push(format!(
                "line {} strength {} outside [{}, {}]",
                row.line, row.strength, config.min_strength, config.max_strength
            ));
        }
        if config.require_dry_run_mode && row.mutation_mode != "dry_run" {
            report.errors.push(format!(
                "line {} mutation_mode `{}` is not dry_run",
                row.line, row.mutation_mode
            ));
        }
        if row.expected_dirty_pages_min > row.expected_dirty_pages_max {
            report.errors.push(format!(
                "line {} dirty page expectation min {} exceeds max {}",
                row.line, row.expected_dirty_pages_min, row.expected_dirty_pages_max
            ));
        }
        if row.dirty_lod0_pages == 0 {
            report
                .errors
                .push(format!("line {} produced zero dirty_lod0_pages", row.line));
        }
        if row.dirty_lod0_pages > config.max_dirty_lod0_pages_per_request {
            report.errors.push(format!(
                "line {} dirty_lod0_pages {} exceeds max {}",
                row.line, row.dirty_lod0_pages, config.max_dirty_lod0_pages_per_request
            ));
        }
        if row.dirty_total_nodes > config.max_dirty_total_nodes_per_request {
            report.errors.push(format!(
                "line {} dirty_total_nodes {} exceeds max {}",
                row.line, row.dirty_total_nodes, config.max_dirty_total_nodes_per_request
            ));
        }
        if row.dirty_total_nodes < row.dirty_lod0_pages + row.dirty_ancestor_nodes {
            report.errors.push(format!(
                "line {} dirty_total_nodes {} is less than lod0+ancestor {}",
                row.line,
                row.dirty_total_nodes,
                row.dirty_lod0_pages + row.dirty_ancestor_nodes
            ));
        }
        if config.require_expected_dirty_page_match && !row.within_expected_dirty_pages {
            report.errors.push(format!(
                "line {} dirty page expectation mismatch: dirty_lod0_pages={}, expected=[{}, {}]",
                row.line,
                row.dirty_lod0_pages,
                row.expected_dirty_pages_min,
                row.expected_dirty_pages_max
            ));
        }
        if row.dirty_lod0_pages < row.expected_dirty_pages_min
            || row.dirty_lod0_pages > row.expected_dirty_pages_max
        {
            report.errors.push(format!(
                "line {} dirty_lod0_pages {} outside expected [{}, {}]",
                row.line,
                row.dirty_lod0_pages,
                row.expected_dirty_pages_min,
                row.expected_dirty_pages_max
            ));
        }
        if config.require_ready_status && row.dispatch_status != "ready" {
            report.errors.push(format!(
                "line {} dispatch_status `{}` is not ready",
                row.line, row.dispatch_status
            ));
        }
        if row.expected_rebuild_publish_max_frames == 0 {
            report.warnings.push(format!(
                "line {} has zero expected_rebuild_publish_max_frames",
                row.line
            ));
        }
        if row.expected_collider_refresh_max_frames == 0 {
            report.warnings.push(format!(
                "line {} has zero expected_collider_refresh_max_frames",
                row.line
            ));
        }
        if row.occurrence_index > 0 && row.event_index == 0 {
            report.warnings.push(format!(
                "line {} repeat occurrence {} belongs to event_index 0; verify this is intentional",
                row.line, row.occurrence_index
            ));
        }
    }

    report
}

fn parse_rows(input: &str) -> Result<Vec<Row>, String> {
    let mut lines = input.lines().filter(|line| !line.trim().is_empty());
    let header_line = lines
        .next()
        .ok_or_else(|| "empty clod-edit-dry-run CSV".to_string())?;
    let header = split_csv_line(header_line);
    let mut rows = Vec::new();

    for (index, line) in lines.enumerate() {
        let line_number = index + 2;
        let values = split_csv_line(line);
        let get = |name: &str| -> Result<&str, String> {
            let column = header
                .iter()
                .position(|candidate| candidate == name)
                .ok_or_else(|| format!("missing CSV column `{name}`"))?;
            values
                .get(column)
                .map(String::as_str)
                .ok_or_else(|| format!("line {line_number} missing value for `{name}`"))
        };

        rows.push(Row {
            line: line_number,
            request_id: parse_field(get("request_id")?, line_number, "request_id")?,
            frame: parse_field(get("frame")?, line_number, "frame")?,
            event_index: parse_field(get("event_index")?, line_number, "event_index")?,
            occurrence_index: parse_field(
                get("occurrence_index")?,
                line_number,
                "occurrence_index",
            )?,
            name: get("name")?.to_string(),
            kind: get("kind")?.to_string(),
            radius: parse_field(get("radius")?, line_number, "radius")?,
            strength: parse_field(get("strength")?, line_number, "strength")?,
            target_height: parse_optional_field(
                get("target_height")?,
                line_number,
                "target_height",
            )?,
            mutation_mode: get("mutation_mode")?.to_string(),
            dirty_lod0_pages: parse_field(
                get("dirty_lod0_pages")?,
                line_number,
                "dirty_lod0_pages",
            )?,
            dirty_ancestor_nodes: parse_field(
                get("dirty_ancestor_nodes")?,
                line_number,
                "dirty_ancestor_nodes",
            )?,
            dirty_total_nodes: parse_field(
                get("dirty_total_nodes")?,
                line_number,
                "dirty_total_nodes",
            )?,
            expected_dirty_pages_min: parse_field(
                get("expected_dirty_pages_min")?,
                line_number,
                "expected_dirty_pages_min",
            )?,
            expected_dirty_pages_max: parse_field(
                get("expected_dirty_pages_max")?,
                line_number,
                "expected_dirty_pages_max",
            )?,
            expected_rebuild_publish_max_frames: parse_field(
                get("expected_rebuild_publish_max_frames")?,
                line_number,
                "expected_rebuild_publish_max_frames",
            )?,
            expected_collider_refresh_max_frames: parse_field(
                get("expected_collider_refresh_max_frames")?,
                line_number,
                "expected_collider_refresh_max_frames",
            )?,
            within_expected_dirty_pages: parse_field(
                get("within_expected_dirty_pages")?,
                line_number,
                "within_expected_dirty_pages",
            )?,
            dispatch_status: get("dispatch_status")?.to_string(),
        });
    }

    Ok(rows)
}

fn parse_field<T: std::str::FromStr>(value: &str, line: usize, name: &str) -> Result<T, String> {
    value
        .trim()
        .parse::<T>()
        .map_err(|_| format!("line {line} invalid `{name}` value `{value}`"))
}

fn parse_optional_field<T: std::str::FromStr>(
    value: &str,
    line: usize,
    name: &str,
) -> Result<Option<T>, String> {
    if value.trim().is_empty() {
        Ok(None)
    } else {
        parse_field(value, line, name).map(Some)
    }
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

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

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "request_id,frame,event_index,occurrence_index,name,kind,x,y,z,radius,strength,target_height,mutation_mode,dirty_lod0_pages,dirty_ancestor_nodes,dirty_total_nodes,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames,within_expected_dirty_pages,dispatch_status";

    #[test]
    fn accepts_valid_dry_run() {
        let csv = format!(
            "{HEADER}\n0,60,0,0,dig-a,dig,10.0,65.0,10.0,5.0,0.5,,dry_run,2,3,5,1,8,90,120,true,ready\n"
        );
        let rows = parse_rows(&csv).unwrap();
        let report = validate_rows(&rows, &Config::default());
        assert!(report.errors.is_empty(), "{:?}", report.errors);
    }

    #[test]
    fn rejects_mutation_mode_before_real_hook() {
        let csv = format!(
            "{HEADER}\n0,60,0,0,dig-a,dig,10.0,65.0,10.0,5.0,0.5,,mutate,2,3,5,1,8,90,120,true,ready\n"
        );
        let rows = parse_rows(&csv).unwrap();
        let report = validate_rows(&rows, &Config::default());
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("not dry_run"))
        );
    }

    #[test]
    fn rejects_dirty_page_mismatch() {
        let csv = format!(
            "{HEADER}\n0,60,0,0,dig-a,dig,10.0,65.0,10.0,5.0,0.5,,dry_run,12,3,15,1,8,90,120,false,dirty_page_expectation_mismatch\n"
        );
        let rows = parse_rows(&csv).unwrap();
        let report = validate_rows(&rows, &Config::default());
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("expectation mismatch"))
        );
    }

    #[test]
    fn parses_quoted_names() {
        let csv = format!(
            "{HEADER}\n0,60,0,0,\"dig, ridge\",dig,10.0,65.0,10.0,5.0,0.5,,dry_run,2,3,5,1,8,90,120,true,ready\n"
        );
        let rows = parse_rows(&csv).unwrap();
        assert_eq!(rows[0].name, "dig, ridge");
    }
}
