//! Guard for CLOD border-lock statistics CSVs.
//!
//! The CSV can be produced from `ClodBorderLockStats::to_csv_record`. The guard
//! is intentionally std-only so it can run in CI without bringing Bevy up.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

#[derive(Clone, Debug)]
struct Config {
    min_rows: usize,
    require_locked_when_border_edges_present: bool,
    min_lock_ratio_when_bordered: f64,
    max_lock_ratio: f64,
    max_boundary_vertex_ratio: f64,
    max_empty_mesh_rows: usize,
    require_all_levels_present: bool,
    expected_max_level: Option<usize>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            min_rows: 1,
            require_locked_when_border_edges_present: true,
            min_lock_ratio_when_bordered: 0.001,
            max_lock_ratio: 1.0,
            max_boundary_vertex_ratio: 1.0,
            max_empty_mesh_rows: 0,
            require_all_levels_present: false,
            expected_max_level: None,
        }
    }
}

#[derive(Clone, Debug)]
struct Row {
    frame: u64,
    level: usize,
    x: i32,
    z: i32,
    vertex_count: usize,
    triangle_count: usize,
    border_edges: usize,
    locked_vertices: usize,
    lock_ratio: f64,
    boundary_vertex_ratio: f64,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 || args.len() > 3 {
        eprintln!("usage: clod_border_lock_guard <clod-border-lock.csv> [config.toml]");
        process::exit(2);
    }

    let csv_path = PathBuf::from(&args[1]);
    let config = if args.len() == 3 {
        load_config(Path::new(&args[2]))
    } else {
        load_config(Path::new("assets/config/clod_border_lock_guard.toml"))
    };

    let rows = match read_rows(&csv_path) {
        Ok(rows) => rows,
        Err(err) => {
            eprintln!(
                "CLOD border-lock guard failed to read {}: {err}",
                csv_path.display()
            );
            process::exit(2);
        }
    };

    let mut failures = Vec::new();
    if rows.len() < config.min_rows {
        failures.push(format!(
            "expected at least {} rows, got {}",
            config.min_rows,
            rows.len()
        ));
    }

    let mut empty_mesh_rows = 0usize;
    let mut levels_seen = HashMap::<usize, usize>::new();
    for row in &rows {
        *levels_seen.entry(row.level).or_insert(0) += 1;

        if row.vertex_count == 0 || row.triangle_count == 0 {
            empty_mesh_rows += 1;
        }
        if row.lock_ratio < 0.0 || row.lock_ratio > config.max_lock_ratio {
            failures.push(format!(
                "frame {} L{}:({},{}) lock_ratio {:.6} outside [0,{:.6}]",
                row.frame, row.level, row.x, row.z, row.lock_ratio, config.max_lock_ratio
            ));
        }
        if row.boundary_vertex_ratio < 0.0
            || row.boundary_vertex_ratio > config.max_boundary_vertex_ratio
        {
            failures.push(format!(
                "frame {} L{}:({},{}) boundary_vertex_ratio {:.6} outside [0,{:.6}]",
                row.frame,
                row.level,
                row.x,
                row.z,
                row.boundary_vertex_ratio,
                config.max_boundary_vertex_ratio
            ));
        }
        if config.require_locked_when_border_edges_present
            && row.border_edges > 0
            && row.locked_vertices == 0
        {
            failures.push(format!(
                "frame {} L{}:({},{}) has {} border edges but zero locked vertices",
                row.frame, row.level, row.x, row.z, row.border_edges
            ));
        }
        if row.border_edges > 0 && row.lock_ratio < config.min_lock_ratio_when_bordered {
            failures.push(format!(
                "frame {} L{}:({},{}) lock_ratio {:.6} below minimum {:.6}",
                row.frame,
                row.level,
                row.x,
                row.z,
                row.lock_ratio,
                config.min_lock_ratio_when_bordered
            ));
        }
        if row.locked_vertices > row.vertex_count {
            failures.push(format!(
                "frame {} L{}:({},{}) locked_vertices {} > vertex_count {}",
                row.frame, row.level, row.x, row.z, row.locked_vertices, row.vertex_count
            ));
        }
    }

    if empty_mesh_rows > config.max_empty_mesh_rows {
        failures.push(format!(
            "empty mesh rows {} exceeds max {}",
            empty_mesh_rows, config.max_empty_mesh_rows
        ));
    }

    if config.require_all_levels_present {
        let Some(max_level) = config.expected_max_level else {
            failures.push(
                "require_all_levels_present=true but expected_max_level is not set".to_string(),
            );
            report(&rows, &levels_seen, failures);
            return;
        };
        for level in 0..=max_level {
            if !levels_seen.contains_key(&level) {
                failures.push(format!("missing border-lock rows for level {level}"));
            }
        }
    }

    report(&rows, &levels_seen, failures);
}

fn report(rows: &[Row], levels_seen: &HashMap<usize, usize>, failures: Vec<String>) {
    println!("CLOD border-lock rows: {}", rows.len());
    let mut levels: Vec<_> = levels_seen.iter().collect();
    levels.sort_by_key(|(level, _)| **level);
    for (level, count) in levels {
        println!("  L{level}: {count} rows");
    }

    if failures.is_empty() {
        println!("CLOD border-lock guard passed");
        return;
    }

    eprintln!(
        "CLOD border-lock guard failed with {} issue(s):",
        failures.len()
    );
    for failure in failures {
        eprintln!("- {failure}");
    }
    process::exit(1);
}

fn read_rows(path: &Path) -> Result<Vec<Row>, String> {
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut lines = text.lines();
    let header = lines.next().ok_or_else(|| "CSV is empty".to_string())?;
    let columns: Vec<&str> = header.split(',').collect();
    let index = column_index(&columns);

    let mut rows = Vec::new();
    for (line_no, line) in lines.enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let cells: Vec<&str> = line.split(',').collect();
        rows.push(Row {
            frame: parse_cell(&cells, &index, "frame", line_no + 2)?,
            level: parse_cell(&cells, &index, "level", line_no + 2)?,
            x: parse_cell(&cells, &index, "x", line_no + 2)?,
            z: parse_cell(&cells, &index, "z", line_no + 2)?,
            vertex_count: parse_cell(&cells, &index, "vertex_count", line_no + 2)?,
            triangle_count: parse_cell(&cells, &index, "triangle_count", line_no + 2)?,
            border_edges: parse_cell(&cells, &index, "border_edges", line_no + 2)?,
            locked_vertices: parse_cell(&cells, &index, "locked_vertices", line_no + 2)?,
            lock_ratio: parse_cell(&cells, &index, "lock_ratio", line_no + 2)?,
            boundary_vertex_ratio: parse_cell(
                &cells,
                &index,
                "boundary_vertex_ratio",
                line_no + 2,
            )?,
        });
    }
    Ok(rows)
}

fn column_index(columns: &[&str]) -> HashMap<String, usize> {
    columns
        .iter()
        .enumerate()
        .map(|(i, name)| (name.trim().to_string(), i))
        .collect()
}

fn parse_cell<T: std::str::FromStr>(
    cells: &[&str],
    index: &HashMap<String, usize>,
    name: &str,
    line_no: usize,
) -> Result<T, String> {
    let idx = *index
        .get(name)
        .ok_or_else(|| format!("missing column {name}"))?;
    cells
        .get(idx)
        .ok_or_else(|| format!("line {line_no}: missing cell for {name}"))?
        .trim()
        .parse::<T>()
        .map_err(|_| format!("line {line_no}: invalid {name}"))
}

fn load_config(path: &Path) -> Config {
    let mut cfg = Config::default();
    let Ok(text) = fs::read_to_string(path) else {
        return cfg;
    };
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or_default().trim();
        if line.is_empty() || line.starts_with('[') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"');
        match key {
            "min_rows" => cfg.min_rows = value.parse().unwrap_or(cfg.min_rows),
            "require_locked_when_border_edges_present" => {
                cfg.require_locked_when_border_edges_present =
                    parse_bool(value, cfg.require_locked_when_border_edges_present)
            }
            "min_lock_ratio_when_bordered" => {
                cfg.min_lock_ratio_when_bordered =
                    value.parse().unwrap_or(cfg.min_lock_ratio_when_bordered)
            }
            "max_lock_ratio" => cfg.max_lock_ratio = value.parse().unwrap_or(cfg.max_lock_ratio),
            "max_boundary_vertex_ratio" => {
                cfg.max_boundary_vertex_ratio =
                    value.parse().unwrap_or(cfg.max_boundary_vertex_ratio)
            }
            "max_empty_mesh_rows" => {
                cfg.max_empty_mesh_rows = value.parse().unwrap_or(cfg.max_empty_mesh_rows)
            }
            "require_all_levels_present" => {
                cfg.require_all_levels_present = parse_bool(value, cfg.require_all_levels_present)
            }
            "expected_max_level" => cfg.expected_max_level = value.parse().ok(),
            _ => {}
        }
    }
    cfg
}

fn parse_bool(value: &str, default: bool) -> bool {
    match value.trim() {
        "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON" => true,
        "0" | "false" | "FALSE" | "no" | "NO" | "off" | "OFF" => false,
        _ => default,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_minimal_csv() {
        let path = std::env::temp_dir().join("clod-border-lock-test.csv");
        fs::write(
            &path,
            "frame,level,x,z,vertex_count,triangle_count,border_edges,locked_vertices,lock_ratio,boundary_vertex_ratio\n0,0,1,2,4,2,4,4,1.0,0.5\n",
        )
        .unwrap();
        let rows = read_rows(&path).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].level, 0);
        assert_eq!(rows[0].locked_vertices, 4);
        let _ = fs::remove_file(path);
    }
}
