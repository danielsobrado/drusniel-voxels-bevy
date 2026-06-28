use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
struct Args {
    csv: PathBuf,
    config: PathBuf,
}

#[derive(Debug, Clone)]
struct Config {
    allow_empty: bool,
    require_sorted_frames: bool,
    require_contiguous_occurrences: bool,
    require_strictly_increasing_group_frames: bool,
    require_consistent_repeat_delta: bool,
    max_frame: u32,
    max_radius: f32,
    min_strength: f32,
    max_strength: f32,
    max_dirty_pages: u32,
    max_expected_publish_frames: u32,
    max_expected_collider_refresh_frames: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            allow_empty: false,
            require_sorted_frames: true,
            require_contiguous_occurrences: true,
            require_strictly_increasing_group_frames: true,
            require_consistent_repeat_delta: true,
            max_frame: 1_000_000,
            max_radius: 128.0,
            min_strength: 0.0,
            max_strength: 16.0,
            max_dirty_pages: 1024,
            max_expected_publish_frames: 600,
            max_expected_collider_refresh_frames: 900,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct EditGroupKey {
    scene: String,
    checkpoint: String,
    edit: String,
}

#[derive(Debug, Clone)]
struct EditEventRow {
    line: usize,
    scene: String,
    checkpoint: String,
    edit: String,
    occurrence: u32,
    frame: u32,
    kind: String,
    x: f32,
    y: f32,
    z: f32,
    radius: f32,
    strength: f32,
    target_height: Option<f32>,
    expected_dirty_pages_min: Option<u32>,
    expected_dirty_pages_max: Option<u32>,
    expected_rebuild_publish_max_frames: Option<u32>,
    expected_collider_refresh_max_frames: Option<u32>,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("clod_edit_events_guard failed: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let config = Config::load(&args.config)?;
    let rows = read_events_csv(&args.csv)?;
    validate_events(&rows, &config)?;
    println!(
        "clod_edit_events_guard ok: {} rows from {}",
        rows.len(),
        args.csv.display()
    );
    Ok(())
}

fn parse_args() -> Result<Args, String> {
    let mut positional = Vec::new();
    let mut config = PathBuf::from("assets/config/clod_edit_events_guard.toml");
    let mut iter = env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--config" => {
                let value = iter
                    .next()
                    .ok_or_else(|| "--config requires a path".to_string())?;
                config = PathBuf::from(value);
            }
            "-h" | "--help" => {
                println!(
                    "usage: clod_edit_events_guard <clod-edit-events.csv> [--config assets/config/clod_edit_events_guard.toml]"
                );
                std::process::exit(0);
            }
            _ if arg.starts_with('-') => return Err(format!("unknown flag: {arg}")),
            _ => positional.push(PathBuf::from(arg)),
        }
    }

    let csv = positional
        .into_iter()
        .next()
        .ok_or_else(|| "missing clod-edit-events.csv path".to_string())?;
    Ok(Args { csv, config })
}

impl Config {
    fn load(path: &Path) -> Result<Self, String> {
        let mut config = Config::default();
        if !path.exists() {
            return Ok(config);
        }
        let text = fs::read_to_string(path)
            .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
        for (line_no, raw_line) in text.lines().enumerate() {
            let line = raw_line.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                return Err(format!(
                    "{}:{} expected key = value",
                    path.display(),
                    line_no + 1
                ));
            };
            config.set_value(key.trim(), value.trim(), path, line_no + 1)?;
        }
        Ok(config)
    }

    fn set_value(
        &mut self,
        key: &str,
        value: &str,
        path: &Path,
        line_no: usize,
    ) -> Result<(), String> {
        match key {
            "allow_empty" => self.allow_empty = parse_bool(value, path, line_no)?,
            "require_sorted_frames" => {
                self.require_sorted_frames = parse_bool(value, path, line_no)?
            }
            "require_contiguous_occurrences" => {
                self.require_contiguous_occurrences = parse_bool(value, path, line_no)?
            }
            "require_strictly_increasing_group_frames" => {
                self.require_strictly_increasing_group_frames = parse_bool(value, path, line_no)?
            }
            "require_consistent_repeat_delta" => {
                self.require_consistent_repeat_delta = parse_bool(value, path, line_no)?
            }
            "max_frame" => self.max_frame = parse_u32(value, path, line_no)?,
            "max_radius" => self.max_radius = parse_f32(value, path, line_no)?,
            "min_strength" => self.min_strength = parse_f32(value, path, line_no)?,
            "max_strength" => self.max_strength = parse_f32(value, path, line_no)?,
            "max_dirty_pages" => self.max_dirty_pages = parse_u32(value, path, line_no)?,
            "max_expected_publish_frames" => {
                self.max_expected_publish_frames = parse_u32(value, path, line_no)?
            }
            "max_expected_collider_refresh_frames" => {
                self.max_expected_collider_refresh_frames = parse_u32(value, path, line_no)?
            }
            _ => {
                return Err(format!(
                    "{}:{} unknown config key '{key}'",
                    path.display(),
                    line_no
                ))
            }
        }
        Ok(())
    }
}

fn parse_bool(value: &str, path: &Path, line_no: usize) -> Result<bool, String> {
    match trim_quotes(value) {
        "true" => Ok(true),
        "false" => Ok(false),
        other => Err(format!(
            "{}:{} expected boolean, got '{other}'",
            path.display(),
            line_no
        )),
    }
}

fn parse_u32(value: &str, path: &Path, line_no: usize) -> Result<u32, String> {
    trim_quotes(value).parse::<u32>().map_err(|err| {
        format!(
            "{}:{} expected u32, got '{}': {err}",
            path.display(),
            line_no,
            value
        )
    })
}

fn parse_f32(value: &str, path: &Path, line_no: usize) -> Result<f32, String> {
    let parsed = trim_quotes(value).parse::<f32>().map_err(|err| {
        format!(
            "{}:{} expected f32, got '{}': {err}",
            path.display(),
            line_no,
            value
        )
    })?;
    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(format!(
            "{}:{} expected finite f32, got '{}'",
            path.display(),
            line_no,
            value
        ))
    }
}

fn trim_quotes(value: &str) -> &str {
    value.trim().trim_matches('"')
}

fn read_events_csv(path: &Path) -> Result<Vec<EditEventRow>, String> {
    let text = fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    let mut lines = text.lines();
    let header_line = lines
        .next()
        .ok_or_else(|| format!("{} is empty", path.display()))?;
    let header = parse_csv_line(header_line);
    require_columns(path, &header, REQUIRED_COLUMNS)?;
    let mut index = HashMap::new();
    for (i, column) in header.iter().enumerate() {
        index.insert(column.as_str(), i);
    }

    let mut rows = Vec::new();
    for (zero_based, line) in lines.enumerate() {
        let line_no = zero_based + 2;
        if line.trim().is_empty() {
            continue;
        }
        let fields = parse_csv_line(line);
        rows.push(parse_row(path, line_no, &index, &fields)?);
    }
    Ok(rows)
}

const REQUIRED_COLUMNS: &[&str] = &[
    "scene",
    "checkpoint",
    "edit",
    "occurrence",
    "frame",
    "kind",
    "x",
    "y",
    "z",
    "radius",
    "strength",
    "target_height",
    "expected_dirty_pages_min",
    "expected_dirty_pages_max",
    "expected_rebuild_publish_max_frames",
    "expected_collider_refresh_max_frames",
];

fn require_columns(path: &Path, header: &[String], required: &[&str]) -> Result<(), String> {
    for column in required {
        if !header.iter().any(|found| found == column) {
            return Err(format!("{} missing required column '{column}'", path.display()));
        }
    }
    Ok(())
}

fn parse_row(
    path: &Path,
    line: usize,
    index: &HashMap<&str, usize>,
    fields: &[String],
) -> Result<EditEventRow, String> {
    let scene = required_string(path, line, index, fields, "scene")?;
    let checkpoint = required_string(path, line, index, fields, "checkpoint")?;
    let edit = required_string(path, line, index, fields, "edit")?;
    Ok(EditEventRow {
        line,
        scene,
        checkpoint,
        edit,
        occurrence: required_u32(path, line, index, fields, "occurrence")?,
        frame: required_u32(path, line, index, fields, "frame")?,
        kind: required_string(path, line, index, fields, "kind")?,
        x: required_f32(path, line, index, fields, "x")?,
        y: required_f32(path, line, index, fields, "y")?,
        z: required_f32(path, line, index, fields, "z")?,
        radius: required_f32(path, line, index, fields, "radius")?,
        strength: required_f32(path, line, index, fields, "strength")?,
        target_height: optional_f32(path, line, index, fields, "target_height")?,
        expected_dirty_pages_min: optional_u32(path, line, index, fields, "expected_dirty_pages_min")?,
        expected_dirty_pages_max: optional_u32(path, line, index, fields, "expected_dirty_pages_max")?,
        expected_rebuild_publish_max_frames: optional_u32(
            path,
            line,
            index,
            fields,
            "expected_rebuild_publish_max_frames",
        )?,
        expected_collider_refresh_max_frames: optional_u32(
            path,
            line,
            index,
            fields,
            "expected_collider_refresh_max_frames",
        )?,
    })
}

fn get_field<'a>(
    path: &Path,
    line: usize,
    index: &HashMap<&str, usize>,
    fields: &'a [String],
    column: &str,
) -> Result<&'a str, String> {
    let Some(&idx) = index.get(column) else {
        return Err(format!("{}:{line} missing column '{column}'", path.display()));
    };
    fields
        .get(idx)
        .map(|value| value.trim())
        .ok_or_else(|| format!("{}:{line} row has no field for '{column}'", path.display()))
}

fn required_string(
    path: &Path,
    line: usize,
    index: &HashMap<&str, usize>,
    fields: &[String],
    column: &str,
) -> Result<String, String> {
    let value = get_field(path, line, index, fields, column)?;
    if value.is_empty() {
        Err(format!("{}:{line} '{column}' must not be empty", path.display()))
    } else {
        Ok(value.to_string())
    }
}

fn required_u32(
    path: &Path,
    line: usize,
    index: &HashMap<&str, usize>,
    fields: &[String],
    column: &str,
) -> Result<u32, String> {
    let value = get_field(path, line, index, fields, column)?;
    parse_cell_u32(path, line, column, value)
}

fn optional_u32(
    path: &Path,
    line: usize,
    index: &HashMap<&str, usize>,
    fields: &[String],
    column: &str,
) -> Result<Option<u32>, String> {
    let value = get_field(path, line, index, fields, column)?;
    if value.is_empty() {
        Ok(None)
    } else {
        parse_cell_u32(path, line, column, value).map(Some)
    }
}

fn required_f32(
    path: &Path,
    line: usize,
    index: &HashMap<&str, usize>,
    fields: &[String],
    column: &str,
) -> Result<f32, String> {
    let value = get_field(path, line, index, fields, column)?;
    parse_cell_f32(path, line, column, value)
}

fn optional_f32(
    path: &Path,
    line: usize,
    index: &HashMap<&str, usize>,
    fields: &[String],
    column: &str,
) -> Result<Option<f32>, String> {
    let value = get_field(path, line, index, fields, column)?;
    if value.is_empty() {
        Ok(None)
    } else {
        parse_cell_f32(path, line, column, value).map(Some)
    }
}

fn parse_cell_u32(path: &Path, line: usize, column: &str, value: &str) -> Result<u32, String> {
    value.parse::<u32>().map_err(|err| {
        format!(
            "{}:{line} '{column}' expected u32, got '{}': {err}",
            path.display(),
            value
        )
    })
}

fn parse_cell_f32(path: &Path, line: usize, column: &str, value: &str) -> Result<f32, String> {
    let parsed = value.parse::<f32>().map_err(|err| {
        format!(
            "{}:{line} '{column}' expected f32, got '{}': {err}",
            path.display(),
            value
        )
    })?;
    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(format!(
            "{}:{line} '{column}' expected finite value, got '{}':",
            path.display(),
            value
        ))
    }
}

fn validate_events(rows: &[EditEventRow], config: &Config) -> Result<(), String> {
    if rows.is_empty() && !config.allow_empty {
        return Err("event CSV has no edit events".to_string());
    }

    let mut seen_events = BTreeSet::new();
    let mut groups: BTreeMap<EditGroupKey, Vec<&EditEventRow>> = BTreeMap::new();
    let mut previous_frame = None;

    for row in rows {
        validate_row(row, config)?;
        let unique_key = (
            row.scene.as_str(),
            row.checkpoint.as_str(),
            row.edit.as_str(),
            row.occurrence,
        );
        if !seen_events.insert(unique_key) {
            return Err(format!(
                "duplicate event occurrence at line {}: {}/{}/{} #{}",
                row.line, row.scene, row.checkpoint, row.edit, row.occurrence
            ));
        }
        if config.require_sorted_frames {
            if let Some(prev) = previous_frame {
                if row.frame < prev {
                    return Err(format!(
                        "frames are not globally sorted: line {} frame {} follows {}",
                        row.line, row.frame, prev
                    ));
                }
            }
            previous_frame = Some(row.frame);
        }
        groups
            .entry(EditGroupKey {
                scene: row.scene.clone(),
                checkpoint: row.checkpoint.clone(),
                edit: row.edit.clone(),
            })
            .or_default()
            .push(row);
    }

    for (group, rows) in groups {
        validate_group(&group, &rows, config)?;
    }

    Ok(())
}

fn validate_row(row: &EditEventRow, config: &Config) -> Result<(), String> {
    match row.kind.as_str() {
        "dig" | "raise" | "level" | "smooth" => {}
        _ => {
            return Err(format!(
                "line {} unsupported edit kind '{}'; expected dig, raise, level or smooth",
                row.line, row.kind
            ))
        }
    }

    if row.frame > config.max_frame {
        return Err(format!(
            "line {} frame {} exceeds max_frame {}",
            row.line, row.frame, config.max_frame
        ));
    }
    for (name, value) in [("x", row.x), ("y", row.y), ("z", row.z)] {
        if !value.is_finite() {
            return Err(format!("line {} {name} is not finite", row.line));
        }
    }
    if !(row.radius.is_finite() && row.radius > 0.0 && row.radius <= config.max_radius) {
        return Err(format!(
            "line {} radius {} outside (0, {}]",
            row.line, row.radius, config.max_radius
        ));
    }
    if !(row.strength.is_finite()
        && row.strength >= config.min_strength
        && row.strength <= config.max_strength)
    {
        return Err(format!(
            "line {} strength {} outside [{}, {}]",
            row.line, row.strength, config.min_strength, config.max_strength
        ));
    }
    if row.kind == "level" && row.target_height.is_none() {
        return Err(format!("line {} level edit requires target_height", row.line));
    }
    if let Some(target_height) = row.target_height {
        if !target_height.is_finite() {
            return Err(format!("line {} target_height is not finite", row.line));
        }
    }

    if let (Some(min), Some(max)) = (row.expected_dirty_pages_min, row.expected_dirty_pages_max) {
        if min > max {
            return Err(format!(
                "line {} expected_dirty_pages_min {} exceeds max {}",
                row.line, min, max
            ));
        }
    }
    for (name, value) in [
        ("expected_dirty_pages_min", row.expected_dirty_pages_min),
        ("expected_dirty_pages_max", row.expected_dirty_pages_max),
    ] {
        if let Some(value) = value {
            if value > config.max_dirty_pages {
                return Err(format!(
                    "line {} {name} {} exceeds max_dirty_pages {}",
                    row.line, value, config.max_dirty_pages
                ));
            }
        }
    }
    if let Some(value) = row.expected_rebuild_publish_max_frames {
        if value == 0 || value > config.max_expected_publish_frames {
            return Err(format!(
                "line {} expected_rebuild_publish_max_frames {} outside [1, {}]",
                row.line, value, config.max_expected_publish_frames
            ));
        }
    }
    if let Some(value) = row.expected_collider_refresh_max_frames {
        if value == 0 || value > config.max_expected_collider_refresh_frames {
            return Err(format!(
                "line {} expected_collider_refresh_max_frames {} outside [1, {}]",
                row.line, value, config.max_expected_collider_refresh_frames
            ));
        }
    }
    Ok(())
}

fn validate_group(
    group: &EditGroupKey,
    rows: &[&EditEventRow],
    config: &Config,
) -> Result<(), String> {
    let mut by_occurrence = rows.to_vec();
    by_occurrence.sort_by_key(|row| row.occurrence);

    if config.require_contiguous_occurrences {
        for (expected, row) in by_occurrence.iter().enumerate() {
            if row.occurrence != expected as u32 {
                return Err(format!(
                    "edit group {}/{}/{} has non-contiguous occurrence: expected {}, got {} at line {}",
                    group.scene,
                    group.checkpoint,
                    group.edit,
                    expected,
                    row.occurrence,
                    row.line
                ));
            }
        }
    }

    if config.require_strictly_increasing_group_frames {
        for pair in by_occurrence.windows(2) {
            let prev = pair[0];
            let next = pair[1];
            if next.frame <= prev.frame {
                return Err(format!(
                    "edit group {}/{}/{} occurrence {} frame {} does not follow occurrence {} frame {}",
                    group.scene,
                    group.checkpoint,
                    group.edit,
                    next.occurrence,
                    next.frame,
                    prev.occurrence,
                    prev.frame
                ));
            }
        }
    }

    if config.require_consistent_repeat_delta && by_occurrence.len() >= 3 {
        let expected_delta = by_occurrence[1].frame - by_occurrence[0].frame;
        if expected_delta == 0 {
            return Err(format!(
                "edit group {}/{}/{} has zero repeat delta",
                group.scene, group.checkpoint, group.edit
            ));
        }
        for pair in by_occurrence.windows(2).skip(1) {
            let delta = pair[1].frame - pair[0].frame;
            if delta != expected_delta {
                return Err(format!(
                    "edit group {}/{}/{} inconsistent repeat delta: expected {}, got {} between occurrences {} and {}",
                    group.scene,
                    group.checkpoint,
                    group.edit,
                    expected_delta,
                    delta,
                    pair[0].occurrence,
                    pair[1].occurrence
                ));
            }
        }
    }

    Ok(())
}

fn parse_csv_line(line: &str) -> Vec<String> {
    let mut values = Vec::new();
    let mut value = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                value.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => {
                values.push(value.trim().to_string());
                value.clear();
            }
            _ => value.push(ch),
        }
    }
    values.push(value.trim().to_string());
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(edit: &str, occurrence: u32, frame: u32) -> EditEventRow {
        EditEventRow {
            line: occurrence as usize + 2,
            scene: "scene".to_string(),
            checkpoint: "checkpoint".to_string(),
            edit: edit.to_string(),
            occurrence,
            frame,
            kind: "dig".to_string(),
            x: 1.0,
            y: 2.0,
            z: 3.0,
            radius: 4.0,
            strength: 0.5,
            target_height: None,
            expected_dirty_pages_min: Some(1),
            expected_dirty_pages_max: Some(8),
            expected_rebuild_publish_max_frames: Some(90),
            expected_collider_refresh_max_frames: Some(120),
        }
    }

    #[test]
    fn parses_quoted_csv_cells() {
        let cells = parse_csv_line("scene,\"check,point\",\"edit \"\"a\"\"\",0");
        assert_eq!(cells, vec!["scene", "check,point", "edit \"a\"", "0"]);
    }

    #[test]
    fn accepts_contiguous_repeated_events() {
        let rows = vec![row("dig-a", 0, 10), row("dig-a", 1, 20), row("dig-a", 2, 30)];
        validate_events(&rows, &Config::default()).unwrap();
    }

    #[test]
    fn rejects_non_contiguous_occurrence() {
        let rows = vec![row("dig-a", 0, 10), row("dig-a", 2, 20)];
        let err = validate_events(&rows, &Config::default()).unwrap_err();
        assert!(err.contains("non-contiguous occurrence"));
    }

    #[test]
    fn rejects_level_without_target_height() {
        let mut event = row("level-a", 0, 10);
        event.kind = "level".to_string();
        let err = validate_events(&[event], &Config::default()).unwrap_err();
        assert!(err.contains("requires target_height"));
    }
}

