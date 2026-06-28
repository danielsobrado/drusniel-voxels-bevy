//! Guard that cross-checks the CLOD selection, crossfade, and cut-freeze CSVs.
//!
//! This is intentionally std-only so it can run in CI without adding runtime
//! dependencies. It complements the more focused guards:
//!
//! - `clod_stats_guard`
//! - `clod_crossfade_guard`
//! - `clod_cut_freeze_guard`
//!
//! Those guards validate each stream in isolation. This one verifies that the
//! streams agree with each other.

use std::collections::{BTreeMap, HashMap};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

#[derive(Clone, Debug)]
struct Config {
    rendered_page_delta_max: i64,
    require_crossfade_material_enabled: bool,
    require_selection_freeze_matches_cut_freeze: bool,
    max_transition_changes_while_frozen: u64,
    max_nonzero_fade_out_tail_rows: usize,
    tail_rows: usize,
    frame_tolerance: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            rendered_page_delta_max: 4,
            require_crossfade_material_enabled: true,
            require_selection_freeze_matches_cut_freeze: true,
            max_transition_changes_while_frozen: 0,
            max_nonzero_fade_out_tail_rows: 0,
            tail_rows: 24,
            frame_tolerance: 0,
        }
    }
}

#[derive(Clone, Debug)]
struct SelectionRow {
    frame: u64,
    rendered_pages: i64,
    split_pages: i64,
    forced_splits: i64,
    blocked_splits: i64,
    near_field_forced_splits: i64,
    frozen: bool,
}

#[derive(Clone, Debug)]
struct CrossfadeRow {
    frame: u64,
    transition_id: u64,
    material_enabled: bool,
    stable_pages: i64,
    fade_in_pages: i64,
    fade_out_pages: i64,
    page_entities: i64,
    faded_entities: i64,
    visible_faded_entities: i64,
    stable_entities: i64,
    fade_in_entities: i64,
    fade_out_entities: i64,
    min_alpha: f64,
    max_alpha: f64,
}

#[derive(Clone, Debug)]
struct CutFreezeRow {
    frame: u64,
    freeze_requested: bool,
    frozen_active: bool,
    rendered_pages: i64,
    split_pages: i64,
    forced_splits: i64,
    blocked_splits: i64,
    near_field_forced_splits: i64,
    cut_digest: String,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 || args.len() > 5 {
        eprintln!(
            "usage: clod_visual_parity_guard <selection.csv> <crossfade.csv> <cut-freeze.csv> [config.toml]"
        );
        process::exit(2);
    }

    let config = match args.get(4) {
        Some(path) => read_config(Path::new(path)),
        None => read_config(Path::new("assets/config/clod_visual_parity_guard.toml")),
    };

    let selection_path = PathBuf::from(&args[1]);
    let crossfade_path = PathBuf::from(&args[2]);
    let cut_freeze_path = PathBuf::from(&args[3]);

    let selection = read_selection(&selection_path);
    let crossfade = read_crossfade(&crossfade_path);
    let cut_freeze = read_cut_freeze(&cut_freeze_path);

    let mut failures = Vec::new();
    let mut warnings = Vec::new();

    if selection.is_empty() {
        failures.push(format!("selection CSV has no rows: {}", selection_path.display()));
    }
    if crossfade.is_empty() {
        failures.push(format!("crossfade CSV has no rows: {}", crossfade_path.display()));
    }
    if cut_freeze.is_empty() {
        failures.push(format!("cut-freeze CSV has no rows: {}", cut_freeze_path.display()));
    }

    let selection_by_frame: BTreeMap<u64, SelectionRow> = selection
        .iter()
        .cloned()
        .map(|row| (row.frame, row))
        .collect();
    let crossfade_by_frame: BTreeMap<u64, CrossfadeRow> = crossfade
        .iter()
        .cloned()
        .map(|row| (row.frame, row))
        .collect();

    for cf in &crossfade {
        if config.require_crossfade_material_enabled && !cf.material_enabled {
            failures.push(format!(
                "crossfade material disabled at frame {} while crossfade stats are being exported",
                cf.frame
            ));
        }

        if cf.page_entities <= 0 && cf.faded_entities > 0 {
            failures.push(format!(
                "frame {} has faded_entities={} but page_entities={}",
                cf.frame, cf.faded_entities, cf.page_entities
            ));
        }

        if cf.visible_faded_entities > cf.faded_entities {
            failures.push(format!(
                "frame {} has visible_faded_entities={} greater than faded_entities={}",
                cf.frame, cf.visible_faded_entities, cf.faded_entities
            ));
        }

        if cf.min_alpha < -0.001 || cf.max_alpha > 1.001 || cf.min_alpha > cf.max_alpha {
            failures.push(format!(
                "frame {} has invalid alpha range [{:.3}, {:.3}]",
                cf.frame, cf.min_alpha, cf.max_alpha
            ));
        }

        if cf.fade_in_pages + cf.fade_out_pages > 0 && cf.faded_entities <= 0 {
            failures.push(format!(
                "frame {} runtime reports fading pages but no ECS fade components",
                cf.frame
            ));
        }

        if let Some(sel) = find_nearest_selection(&selection_by_frame, cf.frame, config.frame_tolerance) {
            let delta = (sel.rendered_pages - cf.page_entities).abs();
            if delta > config.rendered_page_delta_max {
                failures.push(format!(
                    "frame {} rendered page mismatch: selection={} crossfade_entities={} delta={} allowed={}",
                    cf.frame,
                    sel.rendered_pages,
                    cf.page_entities,
                    delta,
                    config.rendered_page_delta_max
                ));
            }

            if sel.rendered_pages <= 0 && cf.page_entities > 0 {
                failures.push(format!(
                    "frame {} has crossfade page entities but zero selected rendered pages",
                    cf.frame
                ));
            }
        } else {
            warnings.push(format!(
                "crossfade frame {} has no matching selection frame within tolerance {}",
                cf.frame, config.frame_tolerance
            ));
        }
    }

    let tail_start = crossfade.len().saturating_sub(config.tail_rows);
    let tail_fade_out_rows = crossfade[tail_start..]
        .iter()
        .filter(|row| row.fade_out_entities > 0 || row.fade_out_pages > 0)
        .count();
    if tail_fade_out_rows > config.max_nonzero_fade_out_tail_rows {
        failures.push(format!(
            "crossfade tail has {} rows with non-zero fade-out state; allowed {} across last {} rows",
            tail_fade_out_rows, config.max_nonzero_fade_out_tail_rows, config.tail_rows
        ));
    }

    let mut frozen_transition_changes = 0u64;
    let mut last_frozen_transition: Option<u64> = None;
    let mut last_frozen_digest: Option<&str> = None;

    for cut in &cut_freeze {
        if let Some(sel) = find_nearest_selection(&selection_by_frame, cut.frame, config.frame_tolerance) {
            if config.require_selection_freeze_matches_cut_freeze && sel.frozen != cut.frozen_active {
                failures.push(format!(
                    "frame {} freeze mismatch: selection.frozen={} cut_freeze.frozen_active={}",
                    cut.frame, sel.frozen, cut.frozen_active
                ));
            }

            if sel.rendered_pages != cut.rendered_pages {
                warnings.push(format!(
                    "frame {} rendered page count differs between selection={} and cut-freeze={}",
                    cut.frame, sel.rendered_pages, cut.rendered_pages
                ));
            }

            if sel.blocked_splits != cut.blocked_splits {
                failures.push(format!(
                    "frame {} blocked split counter mismatch: selection={} cut-freeze={}",
                    cut.frame, sel.blocked_splits, cut.blocked_splits
                ));
            }

            if sel.split_pages != cut.split_pages
                || sel.forced_splits != cut.forced_splits
                || sel.near_field_forced_splits != cut.near_field_forced_splits
            {
                warnings.push(format!(
                    "frame {} selection counters differ across CSVs: selection(split={}, forced={}, near={}) cut-freeze(split={}, forced={}, near={})",
                    cut.frame,
                    sel.split_pages,
                    sel.forced_splits,
                    sel.near_field_forced_splits,
                    cut.split_pages,
                    cut.forced_splits,
                    cut.near_field_forced_splits
                ));
            }
        } else {
            warnings.push(format!(
                "cut-freeze frame {} has no matching selection frame within tolerance {}",
                cut.frame, config.frame_tolerance
            ));
        }

        if cut.frozen_active {
            if cut.rendered_pages <= 0 {
                failures.push(format!(
                    "frame {} is frozen with zero rendered pages",
                    cut.frame
                ));
            }

            if let Some(cf) = find_nearest_crossfade(&crossfade_by_frame, cut.frame, config.frame_tolerance) {
                if let Some(prev) = last_frozen_transition {
                    if cf.transition_id != prev {
                        frozen_transition_changes += 1;
                    }
                }
                last_frozen_transition = Some(cf.transition_id);
            }

            if let Some(prev_digest) = last_frozen_digest {
                if cut.cut_digest != prev_digest {
                    failures.push(format!(
                        "cut digest changed while frozen at frame {}: {} -> {}",
                        cut.frame, prev_digest, cut.cut_digest
                    ));
                }
            }
            last_frozen_digest = Some(&cut.cut_digest);
        }
    }

    if frozen_transition_changes > config.max_transition_changes_while_frozen {
        failures.push(format!(
            "crossfade transition changed {} times while cut-freeze was active; allowed {}",
            frozen_transition_changes, config.max_transition_changes_while_frozen
        ));
    }

    if !warnings.is_empty() {
        eprintln!("CLOD visual parity guard warnings:");
        for warning in &warnings {
            eprintln!("  - {warning}");
        }
    }

    if !failures.is_empty() {
        eprintln!("CLOD visual parity guard failed:");
        for failure in &failures {
            eprintln!("  - {failure}");
        }
        process::exit(1);
    }

    println!(
        "CLOD visual parity guard passed: selection_rows={}, crossfade_rows={}, cut_freeze_rows={}",
        selection.len(),
        crossfade.len(),
        cut_freeze.len()
    );
}

fn read_config(path: &Path) -> Config {
    let mut config = Config::default();
    let Ok(text) = fs::read_to_string(path) else {
        return config;
    };

    for raw_line in text.lines() {
        let line = raw_line.split('#').next().unwrap_or("").trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"');
        match key {
            "rendered_page_delta_max" => {
                if let Ok(parsed) = value.parse() {
                    config.rendered_page_delta_max = parsed;
                }
            }
            "require_crossfade_material_enabled" => {
                config.require_crossfade_material_enabled = parse_bool(value);
            }
            "require_selection_freeze_matches_cut_freeze" => {
                config.require_selection_freeze_matches_cut_freeze = parse_bool(value);
            }
            "max_transition_changes_while_frozen" => {
                if let Ok(parsed) = value.parse() {
                    config.max_transition_changes_while_frozen = parsed;
                }
            }
            "max_nonzero_fade_out_tail_rows" => {
                if let Ok(parsed) = value.parse() {
                    config.max_nonzero_fade_out_tail_rows = parsed;
                }
            }
            "tail_rows" => {
                if let Ok(parsed) = value.parse::<usize>() {
                    config.tail_rows = parsed.max(1);
                }
            }
            "frame_tolerance" => {
                if let Ok(parsed) = value.parse() {
                    config.frame_tolerance = parsed;
                }
            }
            _ => {}
        }
    }

    config
}

fn read_selection(path: &Path) -> Vec<SelectionRow> {
    read_csv(path)
        .into_iter()
        .map(|row| SelectionRow {
            frame: get_u64(&row, "frame"),
            rendered_pages: get_i64(&row, "rendered_pages"),
            split_pages: get_i64(&row, "split_pages"),
            forced_splits: get_i64(&row, "forced_splits"),
            blocked_splits: get_i64(&row, "blocked_splits"),
            near_field_forced_splits: get_i64(&row, "near_field_forced_splits"),
            frozen: get_bool(&row, "frozen"),
        })
        .collect()
}

fn read_crossfade(path: &Path) -> Vec<CrossfadeRow> {
    read_csv(path)
        .into_iter()
        .map(|row| CrossfadeRow {
            frame: get_u64(&row, "frame"),
            transition_id: get_u64(&row, "transition_id"),
            material_enabled: get_bool(&row, "material_enabled"),
            stable_pages: get_i64(&row, "stable_pages"),
            fade_in_pages: get_i64(&row, "fade_in_pages"),
            fade_out_pages: get_i64(&row, "fade_out_pages"),
            page_entities: get_i64(&row, "page_entities"),
            faded_entities: get_i64(&row, "faded_entities"),
            visible_faded_entities: get_i64(&row, "visible_faded_entities"),
            stable_entities: get_i64(&row, "stable_entities"),
            fade_in_entities: get_i64(&row, "fade_in_entities"),
            fade_out_entities: get_i64(&row, "fade_out_entities"),
            min_alpha: get_f64(&row, "min_alpha"),
            max_alpha: get_f64(&row, "max_alpha"),
        })
        .collect()
}

fn read_cut_freeze(path: &Path) -> Vec<CutFreezeRow> {
    read_csv(path)
        .into_iter()
        .map(|row| CutFreezeRow {
            frame: get_u64(&row, "frame"),
            freeze_requested: get_bool(&row, "freeze_requested"),
            frozen_active: get_bool(&row, "frozen_active"),
            rendered_pages: get_i64(&row, "rendered_pages"),
            split_pages: get_i64(&row, "split_pages"),
            forced_splits: get_i64(&row, "forced_splits"),
            blocked_splits: get_i64(&row, "blocked_splits"),
            near_field_forced_splits: get_i64(&row, "near_field_forced_splits"),
            cut_digest: get_string(&row, "cut_digest"),
        })
        .collect()
}

fn read_csv(path: &Path) -> Vec<HashMap<String, String>> {
    let text = fs::read_to_string(path).unwrap_or_else(|err| {
        eprintln!("failed to read {}: {err}", path.display());
        process::exit(2);
    });
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header) = lines.next() else {
        return Vec::new();
    };
    let columns: Vec<String> = split_csv_line(header)
        .into_iter()
        .map(|column| column.trim().to_string())
        .collect();

    let mut rows = Vec::new();
    for line in lines {
        let values = split_csv_line(line);
        let mut row = HashMap::new();
        for (index, column) in columns.iter().enumerate() {
            let value = values.get(index).cloned().unwrap_or_default();
            row.insert(column.clone(), value);
        }
        rows.push(row);
    }
    rows
}

fn split_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
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
                out.push(current.trim().trim_matches('"').to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    out.push(current.trim().trim_matches('"').to_string());
    out
}

fn find_nearest_selection(
    rows: &BTreeMap<u64, SelectionRow>,
    frame: u64,
    tolerance: u64,
) -> Option<&SelectionRow> {
    find_nearest(rows, frame, tolerance)
}

fn find_nearest_crossfade(
    rows: &BTreeMap<u64, CrossfadeRow>,
    frame: u64,
    tolerance: u64,
) -> Option<&CrossfadeRow> {
    find_nearest(rows, frame, tolerance)
}

fn find_nearest<T>(rows: &BTreeMap<u64, T>, frame: u64, tolerance: u64) -> Option<&T> {
    if let Some(row) = rows.get(&frame) {
        return Some(row);
    }
    if tolerance == 0 {
        return None;
    }
    let lower = rows.range(frame.saturating_sub(tolerance)..=frame).next_back();
    let upper = rows.range(frame..=frame.saturating_add(tolerance)).next();
    match (lower, upper) {
        (Some((lower_frame, lower_row)), Some((upper_frame, upper_row))) => {
            if frame.saturating_sub(*lower_frame) <= upper_frame.saturating_sub(frame) {
                Some(lower_row)
            } else {
                Some(upper_row)
            }
        }
        (Some((_, row)), None) | (None, Some((_, row))) => Some(row),
        (None, None) => None,
    }
}

fn get_string(row: &HashMap<String, String>, key: &str) -> String {
    row.get(key).cloned().unwrap_or_default()
}

fn get_u64(row: &HashMap<String, String>, key: &str) -> u64 {
    row.get(key)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0)
}

fn get_i64(row: &HashMap<String, String>, key: &str) -> i64 {
    row.get(key)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(0)
}

fn get_f64(row: &HashMap<String, String>, key: &str) -> f64 {
    row.get(key)
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0)
}

fn get_bool(row: &HashMap<String, String>, key: &str) -> bool {
    row.get(key).is_some_and(|value| parse_bool(value))
}

fn parse_bool(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_csv_handles_quotes() {
        assert_eq!(
            split_csv_line("1,\"a,b\",true"),
            vec!["1".to_string(), "a,b".to_string(), "true".to_string()]
        );
    }

    #[test]
    fn default_config_is_strict() {
        let config = Config::default();
        assert!(config.require_crossfade_material_enabled);
        assert_eq!(config.max_transition_changes_while_frozen, 0);
        assert_eq!(config.max_nonzero_fade_out_tail_rows, 0);
    }
}

