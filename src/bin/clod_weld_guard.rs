//! Guard for CLOD weld diagnostics CSV.

use std::{env, fs, process};

fn main() {
    let Some(path) = env::args().nth(1) else {
        eprintln!("usage: clod_weld_guard <clod-weld.csv>");
        process::exit(2);
    };
    let text = fs::read_to_string(&path).unwrap_or_else(|e| {
        eprintln!("failed to read {path}: {e}");
        process::exit(2);
    });
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let Some(header_line) = lines.next() else {
        eprintln!("{path}: empty CSV");
        process::exit(1);
    };
    let header: Vec<&str> = header_line.split(',').map(str::trim).collect();
    let idx = |name: &str| -> usize {
        header.iter().position(|h| *h == name).unwrap_or_else(|| {
            eprintln!("missing column {name}");
            process::exit(2);
        })
    };
    let dup_groups_col = idx("duplicate_position_groups");
    let dup_vertices_col = idx("duplicate_vertices");
    let normal_col = idx("max_normal_delta");
    let material_col = idx("max_material_delta");
    let paint_col = idx("max_paint_delta");

    let mut rows = 0usize;
    let mut failures = Vec::new();
    for (line_no, line) in lines.enumerate() {
        rows += 1;
        let cols: Vec<&str> = line.split(',').map(str::trim).collect();
        let label = format!("line {}", line_no + 2);
        let parse_usize = |col: usize, name: &str| -> usize {
            cols.get(col).and_then(|v| v.parse().ok()).unwrap_or_else(|| {
                eprintln!("{label}: invalid {name}");
                process::exit(2);
            })
        };
        let parse_f32 = |col: usize, name: &str| -> f32 {
            cols.get(col).and_then(|v| v.parse().ok()).unwrap_or_else(|| {
                eprintln!("{label}: invalid {name}");
                process::exit(2);
            })
        };
        let dup_groups = parse_usize(dup_groups_col, "duplicate_position_groups");
        let dup_vertices = parse_usize(dup_vertices_col, "duplicate_vertices");
        let normal = parse_f32(normal_col, "max_normal_delta");
        let material = parse_f32(material_col, "max_material_delta");
        let paint = parse_f32(paint_col, "max_paint_delta");
        if dup_groups != 0 { failures.push(format!("{label}: duplicate_position_groups {dup_groups} != 0")); }
        if dup_vertices != 0 { failures.push(format!("{label}: duplicate_vertices {dup_vertices} != 0")); }
        if normal > 1.0e-4 { failures.push(format!("{label}: max_normal_delta {normal:.8} > 0.0001")); }
        if material > 1.0e-4 { failures.push(format!("{label}: max_material_delta {material:.8} > 0.0001")); }
        if paint > 1.0e-4 { failures.push(format!("{label}: max_paint_delta {paint:.8} > 0.0001")); }
    }
    if rows == 0 { failures.push("no weld diagnostic rows found".to_string()); }
    if failures.is_empty() {
        println!("CLOD weld guard passed: {rows} rows checked");
    } else {
        eprintln!("CLOD weld guard failed: {} issue(s)", failures.len());
        for failure in failures.iter().take(50) { eprintln!("- {failure}"); }
        process::exit(1);
    }
}
