use serde::Deserialize;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
struct Config {
    max_triangle_ratio: f32,
    max_vertex_ratio: f32,
    min_triangle_ratio: f32,
    min_vertex_ratio: f32,
    max_error_world: f32,
    max_low_benefit_fraction: f32,
    min_parent_triangles: usize,
    min_parent_vertices: usize,
    require_parent_rows: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            max_triangle_ratio: 1.05,
            max_vertex_ratio: 1.05,
            min_triangle_ratio: 0.02,
            min_vertex_ratio: 0.02,
            max_error_world: 256.0,
            max_low_benefit_fraction: 0.35,
            min_parent_triangles: 1,
            min_parent_vertices: 3,
            require_parent_rows: true,
        }
    }
}

#[derive(Debug, Clone)]
struct Row {
    revision: u64,
    level: usize,
    x: i32,
    z: i32,
    vertices: usize,
    triangles: usize,
    child_vertices: usize,
    child_triangles: usize,
    vertex_ratio: f32,
    triangle_ratio: f32,
    error_world: f32,
    low_benefit: bool,
}

#[derive(Debug, Default)]
struct LevelSummary {
    rows: usize,
    vertices: usize,
    triangles: usize,
    low_benefit: usize,
    max_error_world: f32,
    max_triangle_ratio: f32,
    max_vertex_ratio: f32,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("clod_simplify_guard: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args = Args::parse(env::args().skip(1).collect())?;
    let config = load_config(args.config.as_deref())?;
    let rows = read_csv(&args.csv)?;
    let summary = validate(&rows, &config)?;

    println!(
        "CLOD simplify guard passed: rows={}, parent_rows={}, revisions={}",
        rows.len(),
        rows.iter().filter(|r| r.level > 0).count(),
        count_revisions(&rows)
    );
    for (level, s) in summary {
        println!(
            "  L{level}: rows={}, vertices={}, triangles={}, low_benefit={}, max_error_world={:.4}, max_triangle_ratio={:.4}, max_vertex_ratio={:.4}",
            s.rows,
            s.vertices,
            s.triangles,
            s.low_benefit,
            s.max_error_world,
            s.max_triangle_ratio,
            s.max_vertex_ratio,
        );
    }

    Ok(())
}

#[derive(Debug)]
struct Args {
    csv: PathBuf,
    config: Option<PathBuf>,
}

impl Args {
    fn parse(args: Vec<String>) -> Result<Self, String> {
        let mut csv: Option<PathBuf> = None;
        let mut config: Option<PathBuf> = None;
        let mut i = 0;
        while i < args.len() {
            match args[i].as_str() {
                "--config" => {
                    i += 1;
                    let Some(path) = args.get(i) else {
                        return Err("--config requires a path".to_string());
                    };
                    config = Some(PathBuf::from(path));
                }
                "-h" | "--help" => {
                    print_help();
                    std::process::exit(0);
                }
                other if other.starts_with('-') => {
                    return Err(format!("unknown argument: {other}"));
                }
                path => {
                    if csv.is_some() {
                        return Err(format!("unexpected extra path: {path}"));
                    }
                    csv = Some(PathBuf::from(path));
                }
            }
            i += 1;
        }

        let Some(csv) = csv else {
            return Err("usage: clod_simplify_guard [--config config.toml] <clod-simplify.csv>".to_string());
        };

        Ok(Self { csv, config })
    }
}

fn print_help() {
    println!("usage: clod_simplify_guard [--config config.toml] <clod-simplify.csv>");
}

fn load_config(path: Option<&Path>) -> Result<Config, String> {
    let Some(path) = path else {
        return Ok(Config::default());
    };
    let text = fs::read_to_string(path)
        .map_err(|err| format!("failed to read config {}: {err}", path.display()))?;
    toml::from_str::<Config>(&text)
        .map_err(|err| format!("failed to parse config {}: {err}", path.display()))
}

fn read_csv(path: &Path) -> Result<Vec<Row>, String> {
    let text = fs::read_to_string(path)
        .map_err(|err| format!("failed to read CSV {}: {err}", path.display()))?;
    let mut rows = Vec::new();
    for (line_idx, raw) in text.lines().enumerate() {
        let line_no = line_idx + 1;
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line_no == 1 && line.starts_with("revision,") {
            continue;
        }
        rows.push(parse_row(line, line_no)?);
    }
    if rows.is_empty() {
        return Err(format!("CSV {} contains no rows", path.display()));
    }
    Ok(rows)
}

fn parse_row(line: &str, line_no: usize) -> Result<Row, String> {
    let cols: Vec<&str> = line.split(',').map(str::trim).collect();
    if cols.len() != 12 {
        return Err(format!(
            "line {line_no}: expected 12 columns, got {}",
            cols.len()
        ));
    }
    Ok(Row {
        revision: parse(cols[0], line_no, "revision")?,
        level: parse(cols[1], line_no, "level")?,
        x: parse(cols[2], line_no, "x")?,
        z: parse(cols[3], line_no, "z")?,
        vertices: parse(cols[4], line_no, "vertices")?,
        triangles: parse(cols[5], line_no, "triangles")?,
        child_vertices: parse(cols[6], line_no, "child_vertices")?,
        child_triangles: parse(cols[7], line_no, "child_triangles")?,
        vertex_ratio: parse(cols[8], line_no, "vertex_ratio")?,
        triangle_ratio: parse(cols[9], line_no, "triangle_ratio")?,
        error_world: parse(cols[10], line_no, "error_world")?,
        low_benefit: parse_bool(cols[11], line_no, "low_benefit")?,
    })
}

fn parse<T: std::str::FromStr>(value: &str, line_no: usize, name: &str) -> Result<T, String> {
    value
        .parse::<T>()
        .map_err(|_| format!("line {line_no}: invalid {name}: {value:?}"))
}

fn parse_bool(value: &str, line_no: usize, name: &str) -> Result<bool, String> {
    match value {
        "true" | "1" | "yes" => Ok(true),
        "false" | "0" | "no" => Ok(false),
        _ => Err(format!("line {line_no}: invalid {name}: {value:?}")),
    }
}

fn validate(rows: &[Row], cfg: &Config) -> Result<BTreeMap<usize, LevelSummary>, String> {
    if rows.is_empty() {
        return Err("no rows".to_string());
    }

    let mut parent_rows = 0usize;
    let mut low_benefit = 0usize;
    let mut by_level: BTreeMap<usize, LevelSummary> = BTreeMap::new();

    for row in rows {
        if row.vertices == 0 {
            return Err(describe(row, "node has zero vertices"));
        }
        if row.triangles == 0 {
            return Err(describe(row, "node has zero triangles"));
        }
        if !row.error_world.is_finite() || row.error_world < 0.0 {
            return Err(describe(row, "invalid error_world"));
        }
        if row.error_world > cfg.max_error_world {
            return Err(describe(
                row,
                &format!(
                    "error_world {:.4} exceeds max {:.4}",
                    row.error_world, cfg.max_error_world
                ),
            ));
        }
        if row.low_benefit {
            low_benefit += 1;
        }

        if row.level == 0 {
            if row.child_vertices != 0 || row.child_triangles != 0 {
                return Err(describe(row, "LOD0 row must not report child counts"));
            }
        } else {
            parent_rows += 1;
            if row.vertices < cfg.min_parent_vertices {
                return Err(describe(
                    row,
                    &format!(
                        "parent vertices {} below minimum {}",
                        row.vertices, cfg.min_parent_vertices
                    ),
                ));
            }
            if row.triangles < cfg.min_parent_triangles {
                return Err(describe(
                    row,
                    &format!(
                        "parent triangles {} below minimum {}",
                        row.triangles, cfg.min_parent_triangles
                    ),
                ));
            }
            validate_ratio(row, "vertex_ratio", row.vertex_ratio, cfg.min_vertex_ratio, cfg.max_vertex_ratio)?;
            validate_ratio(row, "triangle_ratio", row.triangle_ratio, cfg.min_triangle_ratio, cfg.max_triangle_ratio)?;
        }

        let s = by_level.entry(row.level).or_default();
        s.rows += 1;
        s.vertices += row.vertices;
        s.triangles += row.triangles;
        if row.low_benefit {
            s.low_benefit += 1;
        }
        s.max_error_world = s.max_error_world.max(row.error_world);
        s.max_triangle_ratio = s.max_triangle_ratio.max(row.triangle_ratio);
        s.max_vertex_ratio = s.max_vertex_ratio.max(row.vertex_ratio);
    }

    if cfg.require_parent_rows && parent_rows == 0 {
        return Err("no parent simplification rows found".to_string());
    }

    let low_fraction = low_benefit as f32 / rows.len() as f32;
    if low_fraction > cfg.max_low_benefit_fraction {
        return Err(format!(
            "low-benefit fraction {:.3} exceeds max {:.3} ({}/{})",
            low_fraction,
            cfg.max_low_benefit_fraction,
            low_benefit,
            rows.len()
        ));
    }

    Ok(by_level)
}

fn validate_ratio(row: &Row, name: &str, value: f32, min: f32, max: f32) -> Result<(), String> {
    if !value.is_finite() {
        return Err(describe(row, &format!("{name} is not finite")));
    }
    if value < min {
        return Err(describe(
            row,
            &format!("{name} {:.4} below min {:.4}", value, min),
        ));
    }
    if value > max {
        return Err(describe(
            row,
            &format!("{name} {:.4} above max {:.4}", value, max),
        ));
    }
    Ok(())
}

fn describe(row: &Row, msg: &str) -> String {
    format!(
        "rev={} L{}:({},{}) {}",
        row.revision, row.level, row.x, row.z, msg
    )
}

fn count_revisions(rows: &[Row]) -> usize {
    rows.iter()
        .map(|r| r.revision)
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_basic_simplify_rows() {
        let rows = vec![
            Row { revision: 1, level: 0, x: 0, z: 0, vertices: 10, triangles: 12, child_vertices: 0, child_triangles: 0, vertex_ratio: 1.0, triangle_ratio: 1.0, error_world: 0.0, low_benefit: false },
            Row { revision: 1, level: 1, x: 0, z: 0, vertices: 20, triangles: 24, child_vertices: 40, child_triangles: 48, vertex_ratio: 0.5, triangle_ratio: 0.5, error_world: 0.1, low_benefit: false },
        ];
        validate(&rows, &Config::default()).unwrap();
    }

    #[test]
    fn rejects_bad_ratio() {
        let rows = vec![Row { revision: 1, level: 1, x: 0, z: 0, vertices: 40, triangles: 96, child_vertices: 40, child_triangles: 48, vertex_ratio: 1.0, triangle_ratio: 2.0, error_world: 0.1, low_benefit: false }];
        assert!(validate(&rows, &Config::default()).is_err());
    }
}
