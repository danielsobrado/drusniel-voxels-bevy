//! Guard for CLOD topology diagnostics CSVs.
//!
//! This binary is std-only on purpose. It can run in CI after a bench without
//! launching Bevy or depending on renderer state.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

#[derive(Clone, Debug)]
struct Config {
    min_rows: usize,
    allow_empty_mesh_rows: bool,
    max_invalid_indices: usize,
    max_repeated_index_triangles: usize,
    max_zero_area_triangles: usize,
    max_duplicate_triangles: usize,
    max_non_manifold_edges: usize,
    max_non_finite_positions: usize,
    max_orphan_vertices: usize,
    require_matching_normals: bool,
    require_matching_materials: bool,
    require_matching_paint_slots: bool,
    warn_on_zero_boundary_edges: bool,
    require_all_levels_present: bool,
    expected_max_level: Option<usize>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            min_rows: 1,
            allow_empty_mesh_rows: false,
            max_invalid_indices: 0,
            max_repeated_index_triangles: 0,
            max_zero_area_triangles: 0,
            max_duplicate_triangles: 0,
            max_non_manifold_edges: 0,
            max_non_finite_positions: 0,
            max_orphan_vertices: 0,
            require_matching_normals: true,
            require_matching_materials: true,
            require_matching_paint_slots: false,
            warn_on_zero_boundary_edges: true,
            require_all_levels_present: false,
            expected_max_level: None,
        }
    }
}

#[derive(Clone, Debug)]
struct Row {
    frame: u64,
    revision: u64,
    level: usize,
    x: i32,
    z: i32,
    vertex_count: usize,
    triangle_count: usize,
    boundary_edges: usize,
    non_manifold_edges: usize,
    invalid_indices: usize,
    repeated_index_triangles: usize,
    zero_area_triangles: usize,
    duplicate_triangles: usize,
    orphan_vertices: usize,
    non_finite_positions: usize,
    normal_count_mismatch: bool,
    material_count_mismatch: bool,
    paint_count_mismatch: bool,
    passed: bool,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 || args.len() > 3 {
        eprintln!("usage: clod_topology_guard <clod-topology.csv> [config.toml]");
        process::exit(2);
    }

    let csv_path = PathBuf::from(&args[1]);
    let config = if args.len() == 3 {
        load_config(Path::new(&args[2]))
    } else {
        load_config(Path::new("assets/config/clod_topology_guard.toml"))
    };

    let rows = match read_rows(&csv_path) {
        Ok(rows) => rows,
        Err(err) => {
            eprintln!("CLOD topology guard failed to read {}: {err}", csv_path.display());
            process::exit(2);
        }
    };

    let mut failures = Vec::new();
    let mut warnings = Vec::new();
    let mut levels_seen = HashMap::<usize, usize>::new();
    let mut revisions_seen = HashMap::<u64, usize>::new();
    let mut empty_rows = 0usize;

    if rows.len() < config.min_rows {
        failures.push(format!("expected at least {} rows, got {}", config.min_rows, rows.len()));
    }

    for row in &rows {
        *levels_seen.entry(row.level).or_insert(0) += 1;
        *revisions_seen.entry(row.revision).or_insert(0) += 1;

        let page = format!("frame {} rev {} L{}:({},{})", row.frame, row.revision, row.level, row.x, row.z);

        if row.vertex_count == 0 || row.triangle_count == 0 {
            empty_rows += 1;
        }
        if !row.passed {
            failures.push(format!("{page} exported passed=false"));
        }
        if row.invalid_indices > config.max_invalid_indices {
            failures.push(format!(
                "{page} invalid_indices {} > {}",
                row.invalid_indices, config.max_invalid_indices
            ));
        }
        if row.repeated_index_triangles > config.max_repeated_index_triangles {
            failures.push(format!(
                "{page} repeated_index_triangles {} > {}",
                row.repeated_index_triangles, config.max_repeated_index_triangles
            ));
        }
        if row.zero_area_triangles > config.max_zero_area_triangles {
            failures.push(format!(
                "{page} zero_area_triangles {} > {}",
                row.zero_area_triangles, config.max_zero_area_triangles
            ));
        }
        if row.duplicate_triangles > config.max_duplicate_triangles {
            failures.push(format!(
                "{page} duplicate_triangles {} > {}",
                row.duplicate_triangles, config.max_duplicate_triangles
            ));
        }
        if row.non_manifold_edges > config.max_non_manifold_edges {
            failures.push(format!(
                "{page} non_manifold_edges {} > {}",
                row.non_manifold_edges, config.max_non_manifold_edges
            ));
        }
        if row.non_finite_positions > config.max_non_finite_positions {
            failures.push(format!(
                "{page} non_finite_positions {} > {}",
                row.non_finite_positions, config.max_non_finite_positions
            ));
        }
        if row.orphan_vertices > config.max_orphan_vertices {
            failures.push(format!(
                "{page} orphan_vertices {} > {}",
                row.orphan_vertices, config.max_orphan_vertices
            ));
        }
        if config.require_matching_normals && row.normal_count_mismatch {
            failures.push(format!("{page} normal_count_mismatch=true"));
        }
        if config.require_matching_materials && row.material_count_mismatch {
            failures.push(format!("{page} material_count_mismatch=true"));
        }
        if config.require_matching_paint_slots && row.paint_count_mismatch {
            failures.push(format!("{page} paint_count_mismatch=true"));
        }
        if config.warn_on_zero_boundary_edges && row.boundary_edges == 0 && row.triangle_count > 0 {
            warnings.push(format!("{page} has zero boundary edges; ok for closed fixtures, suspicious for terrain pages"));
        }
    }

    if !config.allow_empty_mesh_rows && empty_rows > 0 {
        failures.push(format!("empty mesh rows found: {empty_rows}"));
    }

    if config.require_all_levels_present {
        let Some(max_level) = config.expected_max_level else {
            failures.push("require_all_levels_present=true but expected_max_level is not set".to_string());
            report(&rows, &levels_seen, &revisions_seen, warnings, failures);
            return;
        };
        for level in 0..=max_level {
            if !levels_seen.contains_key(&level) {
                failures.push(format!("missing topology rows for level {level}"));
            }
        }
    }

    report(&rows, &levels_seen, &revisions_seen, warnings, failures);
}

fn report(
    rows: &[Row],
    levels_seen: &HashMap<usize, usize>,
    revisions_seen: &HashMap<u64, usize>,
    warnings: Vec<String>,
    failures: Vec<String>,
) {
    println!("CLOD topology rows: {}", rows.len());
    println!("CLOD topology revisions: {}", revisions_seen.len());

    let mut levels: Vec<_> = levels_seen.iter().collect();
    levels.sort_by_key(|(level, _)| **level);
    for (level, count) in levels {
        println!("  L{level}: {count} rows");
    }

    for warning in &warnings {
        eprintln!("warning: {warning}");
    }

    if failures.is_empty() {
        println!("CLOD topology guard passed");
        return;
    }

    eprintln!("CLOD topology guard failed with {} issue(s):", failures.len());
    for failure in failures {
        eprintln!("  - {failure}");
    }
    process::exit(1);
}

fn read_rows(path: &Path) -> Result<Vec<Row>, String> {
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let header = lines.next().ok_or_else(|| "empty CSV".to_string())?;
    let columns: Vec<&str> = header.split(',').map(str::trim).collect();
    let index = |name: &str| -> Result<usize, String> {
        columns
            .iter()
            .position(|col| *col == name)
            .ok_or_else(|| format!("missing CSV column `{name}`"))
    };

    let i_frame = index("frame")?;
    let i_revision = index("revision")?;
    let i_level = index("level")?;
    let i_x = index("x")?;
    let i_z = index("z")?;
    let i_vertex_count = index("vertex_count")?;
    let i_triangle_count = index("triangle_count")?;
    let i_boundary_edges = index("boundary_edges")?;
    let i_non_manifold_edges = index("non_manifold_edges")?;
    let i_invalid_indices = index("invalid_indices")?;
    let i_repeated_index_triangles = index("repeated_index_triangles")?;
    let i_zero_area_triangles = index("zero_area_triangles")?;
    let i_duplicate_triangles = index("duplicate_triangles")?;
    let i_orphan_vertices = index("orphan_vertices")?;
    let i_non_finite_positions = index("non_finite_positions")?;
    let i_normal_count_mismatch = index("normal_count_mismatch")?;
    let i_material_count_mismatch = index("material_count_mismatch")?;
    let i_paint_count_mismatch = index("paint_count_mismatch")?;
    let i_passed = index("passed")?;

    let mut rows = Vec::new();
    for (line_no, line) in lines.enumerate() {
        let fields: Vec<&str> = line.split(',').map(str::trim).collect();
        let get = |idx: usize| -> Result<&str, String> {
            fields
                .get(idx)
                .copied()
                .ok_or_else(|| format!("line {} has too few fields", line_no + 2))
        };
        rows.push(Row {
            frame: parse(get(i_frame)?, line_no, "frame")?,
            revision: parse(get(i_revision)?, line_no, "revision")?,
            level: parse(get(i_level)?, line_no, "level")?,
            x: parse(get(i_x)?, line_no, "x")?,
            z: parse(get(i_z)?, line_no, "z")?,
            vertex_count: parse(get(i_vertex_count)?, line_no, "vertex_count")?,
            triangle_count: parse(get(i_triangle_count)?, line_no, "triangle_count")?,
            boundary_edges: parse(get(i_boundary_edges)?, line_no, "boundary_edges")?,
            non_manifold_edges: parse(get(i_non_manifold_edges)?, line_no, "non_manifold_edges")?,
            invalid_indices: parse(get(i_invalid_indices)?, line_no, "invalid_indices")?,
            repeated_index_triangles: parse(get(i_repeated_index_triangles)?, line_no, "repeated_index_triangles")?,
            zero_area_triangles: parse(get(i_zero_area_triangles)?, line_no, "zero_area_triangles")?,
            duplicate_triangles: parse(get(i_duplicate_triangles)?, line_no, "duplicate_triangles")?,
            orphan_vertices: parse(get(i_orphan_vertices)?, line_no, "orphan_vertices")?,
            non_finite_positions: parse(get(i_non_finite_positions)?, line_no, "non_finite_positions")?,
            normal_count_mismatch: parse_bool(get(i_normal_count_mismatch)?, line_no, "normal_count_mismatch")?,
            material_count_mismatch: parse_bool(get(i_material_count_mismatch)?, line_no, "material_count_mismatch")?,
            paint_count_mismatch: parse_bool(get(i_paint_count_mismatch)?, line_no, "paint_count_mismatch")?,
            passed: parse_bool(get(i_passed)?, line_no, "passed")?,
        });
    }

    Ok(rows)
}

fn parse<T: std::str::FromStr>(value: &str, line_no: usize, name: &str) -> Result<T, String> {
    value
        .parse::<T>()
        .map_err(|_| format!("line {} invalid {name}: `{value}`", line_no + 2))
}

fn parse_bool(value: &str, line_no: usize, name: &str) -> Result<bool, String> {
    match value {
        "true" | "1" => Ok(true),
        "false" | "0" => Ok(false),
        _ => Err(format!("line {} invalid {name}: `{value}`", line_no + 2)),
    }
}

fn load_config(path: &Path) -> Config {
    let mut cfg = Config::default();
    let Ok(text) = fs::read_to_string(path) else {
        return cfg;
    };

    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"');
        match key {
            "min_rows" => cfg.min_rows = value.parse().unwrap_or(cfg.min_rows),
            "allow_empty_mesh_rows" => cfg.allow_empty_mesh_rows = parse_config_bool(value, cfg.allow_empty_mesh_rows),
            "max_invalid_indices" => cfg.max_invalid_indices = value.parse().unwrap_or(cfg.max_invalid_indices),
            "max_repeated_index_triangles" => cfg.max_repeated_index_triangles = value.parse().unwrap_or(cfg.max_repeated_index_triangles),
            "max_zero_area_triangles" => cfg.max_zero_area_triangles = value.parse().unwrap_or(cfg.max_zero_area_triangles),
            "max_duplicate_triangles" => cfg.max_duplicate_triangles = value.parse().unwrap_or(cfg.max_duplicate_triangles),
            "max_non_manifold_edges" => cfg.max_non_manifold_edges = value.parse().unwrap_or(cfg.max_non_manifold_edges),
            "max_non_finite_positions" => cfg.max_non_finite_positions = value.parse().unwrap_or(cfg.max_non_finite_positions),
            "max_orphan_vertices" => cfg.max_orphan_vertices = value.parse().unwrap_or(cfg.max_orphan_vertices),
            "require_matching_normals" => cfg.require_matching_normals = parse_config_bool(value, cfg.require_matching_normals),
            "require_matching_materials" => cfg.require_matching_materials = parse_config_bool(value, cfg.require_matching_materials),
            "require_matching_paint_slots" => cfg.require_matching_paint_slots = parse_config_bool(value, cfg.require_matching_paint_slots),
            "warn_on_zero_boundary_edges" => cfg.warn_on_zero_boundary_edges = parse_config_bool(value, cfg.warn_on_zero_boundary_edges),
            "require_all_levels_present" => cfg.require_all_levels_present = parse_config_bool(value, cfg.require_all_levels_present),
            "expected_max_level" => cfg.expected_max_level = value.parse().ok(),
            _ => {}
        }
    }

    cfg
}

fn parse_config_bool(value: &str, fallback: bool) -> bool {
    match value {
        "true" | "1" => true,
        "false" | "0" => false,
        _ => fallback,
    }
}
