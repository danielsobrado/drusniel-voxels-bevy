//! Aggregates CLOD parity CSV artifacts into Markdown and JSON reports.
//!
//! This is intentionally std-only so it can run anywhere the main crate builds.
//! The per-metric guards remain the source of truth for pass/fail decisions;
//! this reporter exists to make CLOD bench artifacts easy to review in PRs.

use std::collections::BTreeMap;
use std::env;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

const KNOWN_ARTIFACTS: &[(&str, &str)] = &[
    ("selection", "clod-selection-runtime.csv"),
    ("rebuild", "clod-rebuild-observer.csv"),
    ("crossfade", "clod-crossfade-runtime.csv"),
    ("cut_freeze", "clod-cut-freeze.csv"),
    ("border_locks", "clod-border-locks.csv"),
    ("topology", "clod-topology.csv"),
    ("edit_events", "clod-edit-events.csv"),
    ("edit_dispatch", "clod-edit-dispatch.csv"),
    ("edit_dry_run", "clod-edit-dry-run.csv"),
];

struct Args {
    run_dir: PathBuf,
    out_md: PathBuf,
    out_json: PathBuf,
    allow_empty: bool,
}

#[derive(Debug, Clone)]
struct CsvSummary {
    name: String,
    file_name: String,
    path: PathBuf,
    exists: bool,
    rows: usize,
    columns: Vec<String>,
    max_numeric: BTreeMap<String, f64>,
    min_numeric: BTreeMap<String, f64>,
    last_values: BTreeMap<String, String>,
    warnings: Vec<String>,
}

impl CsvSummary {
    fn missing(name: &str, file_name: &str, path: PathBuf) -> Self {
        Self {
            name: name.to_owned(),
            file_name: file_name.to_owned(),
            path,
            exists: false,
            rows: 0,
            columns: Vec::new(),
            max_numeric: BTreeMap::new(),
            min_numeric: BTreeMap::new(),
            last_values: BTreeMap::new(),
            warnings: vec!["artifact missing".to_owned()],
        }
    }
}

fn main() {
    if let Err(err) = run() {
        eprintln!("clod_qa_report: {err}");
        std::process::exit(2);
    }
}

fn run() -> io::Result<()> {
    let args = parse_args()?;
    fs::create_dir_all(&args.run_dir)?;

    let mut summaries = Vec::new();
    for (name, file_name) in KNOWN_ARTIFACTS {
        let path = args.run_dir.join(file_name);
        if path.exists() {
            summaries.push(read_csv_summary(name, file_name, &path)?);
        } else {
            summaries.push(CsvSummary::missing(name, file_name, path));
        }
    }

    let existing_count = summaries.iter().filter(|summary| summary.exists).count();
    if existing_count == 0 && !args.allow_empty {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "no known CLOD CSV artifacts found in {}; pass --allow-empty to write an empty report",
                args.run_dir.display()
            ),
        ));
    }

    write_markdown(&args, &summaries)?;
    write_json(&args, &summaries)?;

    println!("[CLOD QA] wrote {}", args.out_md.display());
    println!("[CLOD QA] wrote {}", args.out_json.display());
    Ok(())
}

fn parse_args() -> io::Result<Args> {
    let mut run_dir: Option<PathBuf> = None;
    let mut out_md: Option<PathBuf> = None;
    let mut out_json: Option<PathBuf> = None;
    let mut allow_empty = false;

    let mut iter = env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--run-dir" => run_dir = Some(PathBuf::from(next_value(&mut iter, "--run-dir")?)),
            "--out-md" => out_md = Some(PathBuf::from(next_value(&mut iter, "--out-md")?)),
            "--out-json" => out_json = Some(PathBuf::from(next_value(&mut iter, "--out-json")?)),
            "--allow-empty" => allow_empty = true,
            "-h" | "--help" => {
                print_help();
                std::process::exit(0);
            }
            other => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("unknown argument: {other}"),
                ));
            }
        }
    }

    let run_dir = run_dir.unwrap_or_else(|| PathBuf::from("bench-runs/clod-full-parity-latest"));
    let out_md = out_md.unwrap_or_else(|| run_dir.join("clod-qa-report.md"));
    let out_json = out_json.unwrap_or_else(|| run_dir.join("clod-qa-report.json"));

    Ok(Args {
        run_dir,
        out_md,
        out_json,
        allow_empty,
    })
}

fn next_value(iter: &mut impl Iterator<Item = String>, flag: &str) -> io::Result<String> {
    iter.next().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("missing value for {flag}"),
        )
    })
}

fn print_help() {
    println!(
        "Usage: clod_qa_report [--run-dir DIR] [--out-md FILE] [--out-json FILE] [--allow-empty]\n\n\
         Reads known CLOD parity CSVs from DIR and writes Markdown + JSON summaries."
    );
}

fn read_csv_summary(name: &str, file_name: &str, path: &Path) -> io::Result<CsvSummary> {
    let file = File::open(path)?;
    let mut lines = BufReader::new(file).lines();
    let header = match lines.next() {
        Some(line) => line?,
        None => {
            return Ok(CsvSummary {
                name: name.to_owned(),
                file_name: file_name.to_owned(),
                path: path.to_owned(),
                exists: true,
                rows: 0,
                columns: Vec::new(),
                max_numeric: BTreeMap::new(),
                min_numeric: BTreeMap::new(),
                last_values: BTreeMap::new(),
                warnings: vec!["CSV is empty".to_owned()],
            });
        }
    };

    let columns = split_csv_line(&header);
    let mut rows = 0usize;
    let mut max_numeric = BTreeMap::new();
    let mut min_numeric = BTreeMap::new();
    let mut last_values = BTreeMap::new();
    let mut warnings = Vec::new();

    for line in lines {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        rows += 1;
        let values = split_csv_line(&line);
        if values.len() != columns.len() {
            warnings.push(format!(
                "row {rows} has {} fields but header has {}",
                values.len(),
                columns.len()
            ));
        }
        for (idx, column) in columns.iter().enumerate() {
            let value = values.get(idx).cloned().unwrap_or_default();
            last_values.insert(column.clone(), value.clone());
            if let Ok(number) = value.parse::<f64>() {
                max_numeric
                    .entry(column.clone())
                    .and_modify(|current| {
                        if number > *current {
                            *current = number;
                        }
                    })
                    .or_insert(number);
                min_numeric
                    .entry(column.clone())
                    .and_modify(|current| {
                        if number < *current {
                            *current = number;
                        }
                    })
                    .or_insert(number);
            }
        }
    }

    if rows == 0 {
        warnings.push("CSV has a header but no data rows".to_owned());
    }

    Ok(CsvSummary {
        name: name.to_owned(),
        file_name: file_name.to_owned(),
        path: path.to_owned(),
        exists: true,
        rows,
        columns,
        max_numeric,
        min_numeric,
        last_values,
        warnings,
    })
}

fn split_csv_line(line: &str) -> Vec<String> {
    // The CLOD telemetry CSVs are generated by our tools and currently contain
    // only plain scalar fields, so a comma split is enough and avoids pulling a
    // CSV crate into a tiny guard/report binary.
    line.split(',').map(|field| field.trim().to_owned()).collect()
}

fn write_markdown(args: &Args, summaries: &[CsvSummary]) -> io::Result<()> {
    if let Some(parent) = args.out_md.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut out = File::create(&args.out_md)?;

    writeln!(out, "# CLOD QA report")?;
    writeln!(out)?;
    writeln!(out, "Run directory: `{}`", args.run_dir.display())?;
    writeln!(out)?;
    writeln!(out, "## Artifact overview")?;
    writeln!(out)?;
    writeln!(out, "| artifact | file | status | rows | warnings |")?;
    writeln!(out, "|---|---|---:|---:|---:|")?;
    for summary in summaries {
        writeln!(
            out,
            "| {} | `{}` | {} | {} | {} |",
            summary.name,
            summary.file_name,
            if summary.exists { "present" } else { "missing" },
            summary.rows,
            summary.warnings.len()
        )?;
    }

    writeln!(out)?;
    writeln!(out, "## Numeric maxima")?;
    writeln!(out)?;
    for summary in summaries.iter().filter(|summary| summary.exists) {
        writeln!(out, "### {}", summary.name)?;
        writeln!(out)?;
        if summary.max_numeric.is_empty() {
            writeln!(out, "No numeric columns detected.")?;
        } else {
            writeln!(out, "| column | min | max | last |")?;
            writeln!(out, "|---|---:|---:|---:|")?;
            for (column, max_value) in &summary.max_numeric {
                let min_value = summary.min_numeric.get(column).copied().unwrap_or(*max_value);
                let last_value = summary.last_values.get(column).map(String::as_str).unwrap_or("");
                writeln!(
                    out,
                    "| `{}` | {} | {} | `{}` |",
                    column,
                    format_number(min_value),
                    format_number(*max_value),
                    last_value
                )?;
            }
        }
        if !summary.warnings.is_empty() {
            writeln!(out)?;
            writeln!(out, "Warnings:")?;
            for warning in &summary.warnings {
                writeln!(out, "- {warning}")?;
            }
        }
        writeln!(out)?;
    }

    writeln!(out, "## Next checks")?;
    writeln!(out)?;
    writeln!(out, "Run the dedicated guards for pass/fail decisions:")?;
    writeln!(out)?;
    writeln!(out, "```bash")?;
    writeln!(out, "scripts/run-clod-full-parity-suite.sh")?;
    writeln!(out, "```")?;
    Ok(())
}

fn write_json(args: &Args, summaries: &[CsvSummary]) -> io::Result<()> {
    if let Some(parent) = args.out_json.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut out = File::create(&args.out_json)?;
    writeln!(out, "{{")?;
    writeln!(out, "  \"run_dir\": \"{}\",", json_escape(&args.run_dir.display().to_string()))?;
    writeln!(out, "  \"artifacts\": [")?;
    for (index, summary) in summaries.iter().enumerate() {
        writeln!(out, "    {{")?;
        writeln!(out, "      \"name\": \"{}\",", json_escape(&summary.name))?;
        writeln!(out, "      \"file\": \"{}\",", json_escape(&summary.file_name))?;
        writeln!(out, "      \"path\": \"{}\",", json_escape(&summary.path.display().to_string()))?;
        writeln!(out, "      \"exists\": {},", summary.exists)?;
        writeln!(out, "      \"rows\": {},", summary.rows)?;
        write_string_array(&mut out, "columns", &summary.columns, 6)?;
        writeln!(out, ",")?;
        write_number_map(&mut out, "min_numeric", &summary.min_numeric, 6)?;
        writeln!(out, ",")?;
        write_number_map(&mut out, "max_numeric", &summary.max_numeric, 6)?;
        writeln!(out, ",")?;
        write_string_map(&mut out, "last_values", &summary.last_values, 6)?;
        writeln!(out, ",")?;
        write_string_array(&mut out, "warnings", &summary.warnings, 6)?;
        writeln!(out)?;
        write!(out, "    }}")?;
        if index + 1 != summaries.len() {
            writeln!(out, ",")?;
        } else {
            writeln!(out)?;
        }
    }
    writeln!(out, "  ]")?;
    writeln!(out, "}}")?;
    Ok(())
}

fn write_string_array(out: &mut File, name: &str, values: &[String], indent: usize) -> io::Result<()> {
    let pad = " ".repeat(indent);
    write!(out, "{pad}\"{name}\": [")?;
    for (index, value) in values.iter().enumerate() {
        if index > 0 {
            write!(out, ", ")?;
        }
        write!(out, "\"{}\"", json_escape(value))?;
    }
    write!(out, "]")?;
    Ok(())
}

fn write_string_map(out: &mut File, name: &str, values: &BTreeMap<String, String>, indent: usize) -> io::Result<()> {
    let pad = " ".repeat(indent);
    write!(out, "{pad}\"{name}\": {{")?;
    for (index, (key, value)) in values.iter().enumerate() {
        if index > 0 {
            write!(out, ",")?;
        }
        write!(out, "\n{pad}  \"{}\": \"{}\"", json_escape(key), json_escape(value))?;
    }
    if !values.is_empty() {
        write!(out, "\n{pad}")?;
    }
    write!(out, "}}")?;
    Ok(())
}

fn write_number_map(out: &mut File, name: &str, values: &BTreeMap<String, f64>, indent: usize) -> io::Result<()> {
    let pad = " ".repeat(indent);
    write!(out, "{pad}\"{name}\": {{")?;
    for (index, (key, value)) in values.iter().enumerate() {
        if index > 0 {
            write!(out, ",")?;
        }
        write!(out, "\n{pad}  \"{}\": {}", json_escape(key), format_number(*value))?;
    }
    if !values.is_empty() {
        write!(out, "\n{pad}")?;
    }
    write!(out, "}}")?;
    Ok(())
}

fn format_number(value: f64) -> String {
    if value.fract().abs() < f64::EPSILON {
        format!("{value:.0}")
    } else {
        format!("{value:.6}")
    }
}

fn json_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            ch if ch.is_control() => escaped.push_str(&format!("\\u{:04x}", ch as u32)),
            ch => escaped.push(ch),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_plain_csv_line() {
        assert_eq!(
            split_csv_line("frame, rendered_pages, max_alpha"),
            vec!["frame", "rendered_pages", "max_alpha"]
        );
    }

    #[test]
    fn json_escape_handles_basic_chars() {
        assert_eq!(json_escape("a\\b\"c"), "a\\\\b\\\"c");
    }
}
