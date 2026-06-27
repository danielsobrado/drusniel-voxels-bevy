//! File-based CLOD parity tracker for the `tools/clod-poc` port.
//!
//! This tool intentionally uses only `std` and a tiny TOML subset parser so it
//! can run as a lightweight CI/report command without adding dependencies.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;

#[derive(Debug, Clone, Default)]
struct Item {
    id: String,
    category: String,
    priority: String,
    status: String,
    title: String,
    poc_refs: Vec<String>,
    bevy_paths: Vec<String>,
    notes: String,
}

#[derive(Debug, Clone)]
struct EvaluatedItem {
    item: Item,
    missing_paths: Vec<String>,
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut config_path = PathBuf::from("assets/config/clod_parity_tracker.toml");
    let mut output_path: Option<PathBuf> = None;
    let mut fail_on_missing = false;
    let mut fail_on_planned = false;

    let mut positional = Vec::new();
    for arg in args {
        match arg.as_str() {
            "--fail-on-missing" => fail_on_missing = true,
            "--fail-on-planned" => fail_on_planned = true,
            "--help" | "-h" => {
                print_help();
                return;
            }
            _ => positional.push(arg),
        }
    }

    if let Some(path) = positional.get(0) {
        config_path = PathBuf::from(path);
    }
    if let Some(path) = positional.get(1) {
        output_path = Some(PathBuf::from(path));
    }

    let root = find_repo_root().unwrap_or_else(|| PathBuf::from("."));
    let config_abs = if config_path.is_absolute() {
        config_path.clone()
    } else {
        root.join(&config_path)
    };

    let content = match fs::read_to_string(&config_abs) {
        Ok(content) => content,
        Err(err) => {
            eprintln!(
                "failed to read CLOD parity tracker config {}: {err}",
                config_abs.display()
            );
            process::exit(2);
        }
    };

    let items = match parse_items(&content) {
        Ok(items) => items,
        Err(err) => {
            eprintln!("failed to parse {}: {err}", config_abs.display());
            process::exit(2);
        }
    };

    let evaluated = evaluate_items(&root, items);
    let markdown = render_markdown(&config_path, &evaluated);

    if let Some(path) = output_path {
        let output_abs = if path.is_absolute() { path } else { root.join(path) };
        if let Some(parent) = output_abs.parent() {
            if let Err(err) = fs::create_dir_all(parent) {
                eprintln!("failed to create {}: {err}", parent.display());
                process::exit(2);
            }
        }
        if let Err(err) = fs::write(&output_abs, markdown.as_bytes()) {
            eprintln!("failed to write {}: {err}", output_abs.display());
            process::exit(2);
        }
        println!("wrote {}", output_abs.display());
    } else {
        print!("{markdown}");
    }

    let missing_count = evaluated.iter().map(|entry| entry.missing_paths.len()).sum::<usize>();
    let planned_count = evaluated
        .iter()
        .filter(|entry| entry.item.status == "planned")
        .count();

    if fail_on_missing && missing_count > 0 {
        eprintln!("CLOD parity tracker found {missing_count} missing required paths");
        process::exit(1);
    }
    if fail_on_planned && planned_count > 0 {
        eprintln!("CLOD parity tracker found {planned_count} planned items");
        process::exit(1);
    }
}

fn print_help() {
    println!(
        "Usage: cargo run --bin clod_parity_tracker -- [config.toml] [output.md] [--fail-on-missing] [--fail-on-planned]\n\n\
         Defaults:\n  config: assets/config/clod_parity_tracker.toml\n  output: stdout"
    );
}

fn find_repo_root() -> Option<PathBuf> {
    let mut dir = env::current_dir().ok()?;
    loop {
        if dir.join("Cargo.toml").exists() || dir.join(".git").exists() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

fn evaluate_items(root: &Path, items: Vec<Item>) -> Vec<EvaluatedItem> {
    items
        .into_iter()
        .map(|item| {
            let missing_paths = if item.status == "intentional_skip" {
                Vec::new()
            } else {
                item.bevy_paths
                    .iter()
                    .filter(|path| !root.join(path).exists())
                    .cloned()
                    .collect()
            };
            EvaluatedItem { item, missing_paths }
        })
        .collect()
}

fn render_markdown(config_path: &Path, entries: &[EvaluatedItem]) -> String {
    let mut out = String::new();
    let missing_paths = entries.iter().map(|entry| entry.missing_paths.len()).sum::<usize>();
    let planned = entries.iter().filter(|entry| entry.item.status == "planned").count();
    let ported = entries.iter().filter(|entry| entry.item.status == "ported").count();
    let qa = entries.iter().filter(|entry| entry.item.status == "qa").count();
    let skipped = entries
        .iter()
        .filter(|entry| entry.item.status == "intentional_skip")
        .count();

    out.push_str("# CLOD parity tracker report\n\n");
    out.push_str(&format!("Config: `{}`\n\n", config_path.display()));
    out.push_str("## Summary\n\n");
    out.push_str(&format!("- Items: {}\n", entries.len()));
    out.push_str(&format!("- Ported: {ported}\n"));
    out.push_str(&format!("- QA-covered: {qa}\n"));
    out.push_str(&format!("- Planned: {planned}\n"));
    out.push_str(&format!("- Intentional skips: {skipped}\n"));
    out.push_str(&format!("- Missing required paths: {missing_paths}\n\n"));

    out.push_str("## Items\n\n");
    out.push_str("| ID | Category | Priority | Status | Path check | Title |\n");
    out.push_str("|---|---|---:|---|---|---|\n");
    for entry in entries {
        let path_check = if entry.missing_paths.is_empty() {
            "ok".to_string()
        } else {
            format!("missing {}", entry.missing_paths.len())
        };
        out.push_str(&format!(
            "| `{}` | {} | {} | {} | {} | {} |\n",
            escape_md(&entry.item.id),
            escape_md(&entry.item.category),
            escape_md(&entry.item.priority),
            escape_md(&entry.item.status),
            escape_md(&path_check),
            escape_md(&entry.item.title)
        ));
    }

    out.push_str("\n## Details\n\n");
    for entry in entries {
        out.push_str(&format!("### `{}` — {}\n\n", entry.item.id, entry.item.title));
        out.push_str(&format!("- Category: `{}`\n", entry.item.category));
        out.push_str(&format!("- Priority: `{}`\n", entry.item.priority));
        out.push_str(&format!("- Status: `{}`\n", entry.item.status));
        if !entry.item.poc_refs.is_empty() {
            out.push_str("- PoC refs:\n");
            for path in &entry.item.poc_refs {
                out.push_str(&format!("  - `{}`\n", path));
            }
        }
        if !entry.item.bevy_paths.is_empty() {
            out.push_str("- Bevy paths:\n");
            for path in &entry.item.bevy_paths {
                let marker = if entry.missing_paths.iter().any(|missing| missing == path) {
                    "missing"
                } else {
                    "ok"
                };
                out.push_str(&format!("  - `{}` ({marker})\n", path));
            }
        }
        if !entry.missing_paths.is_empty() {
            out.push_str("- Missing paths:\n");
            for path in &entry.missing_paths {
                out.push_str(&format!("  - `{}`\n", path));
            }
        }
        if !entry.item.notes.is_empty() {
            out.push_str(&format!("- Notes: {}\n", entry.item.notes));
        }
        out.push('\n');
    }

    out
}

fn parse_items(content: &str) -> Result<Vec<Item>, String> {
    let mut items = Vec::new();
    let mut current: Option<Item> = None;

    for (line_no, raw_line) in content.lines().enumerate() {
        let line = strip_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        if line == "[[item]]" || line == "[[items]]" {
            if let Some(item) = current.take() {
                items.push(validate_item(item, line_no)?);
            }
            current = Some(Item::default());
            continue;
        }

        let Some((key, value)) = line.split_once('=') else {
            return Err(format!("line {}: expected key = value", line_no + 1));
        };
        let item = current
            .as_mut()
            .ok_or_else(|| format!("line {}: key before [[item]]", line_no + 1))?;
        let key = key.trim();
        let value = value.trim();
        match key {
            "id" => item.id = parse_string(value, line_no)?,
            "category" => item.category = parse_string(value, line_no)?,
            "priority" => item.priority = parse_string(value, line_no)?,
            "status" => item.status = parse_string(value, line_no)?,
            "title" => item.title = parse_string(value, line_no)?,
            "poc_refs" => item.poc_refs = parse_string_array(value, line_no)?,
            "bevy_paths" => item.bevy_paths = parse_string_array(value, line_no)?,
            "notes" => item.notes = parse_string(value, line_no)?,
            _ => return Err(format!("line {}: unknown key `{key}`", line_no + 1)),
        }
    }

    if let Some(item) = current.take() {
        items.push(validate_item(item, content.lines().count())?);
    }

    if items.is_empty() {
        return Err("no [[item]] entries found".to_string());
    }
    Ok(items)
}

fn validate_item(item: Item, line_no: usize) -> Result<Item, String> {
    if item.id.is_empty() {
        return Err(format!("item ending near line {line_no}: missing id"));
    }
    if item.status.is_empty() {
        return Err(format!("item `{}` missing status", item.id));
    }
    if item.title.is_empty() {
        return Err(format!("item `{}` missing title", item.id));
    }
    Ok(item)
}

fn strip_comment(line: &str) -> &str {
    let mut in_string = false;
    let mut escaped = false;
    for (idx, ch) in line.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_string => escaped = true,
            '"' => in_string = !in_string,
            '#' if !in_string => return &line[..idx],
            _ => {}
        }
    }
    line
}

fn parse_string(value: &str, line_no: usize) -> Result<String, String> {
    let value = value.trim();
    if !(value.starts_with('"') && value.ends_with('"')) {
        return Err(format!("line {}: expected quoted string", line_no + 1));
    }
    Ok(unescape_basic_string(&value[1..value.len() - 1]))
}

fn parse_string_array(value: &str, line_no: usize) -> Result<Vec<String>, String> {
    let value = value.trim();
    if !(value.starts_with('[') && value.ends_with(']')) {
        return Err(format!("line {}: expected string array", line_no + 1));
    }
    let mut result = Vec::new();
    let inner = &value[1..value.len() - 1];
    for part in split_array_items(inner) {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        result.push(parse_string(part, line_no)?);
    }
    Ok(result)
}

fn split_array_items(inner: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0usize;
    let mut in_string = false;
    let mut escaped = false;
    for (idx, ch) in inner.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match ch {
            '\\' if in_string => escaped = true,
            '"' => in_string = !in_string,
            ',' if !in_string => {
                parts.push(&inner[start..idx]);
                start = idx + 1;
            }
            _ => {}
        }
    }
    parts.push(&inner[start..]);
    parts
}

fn unescape_basic_string(value: &str) -> String {
    let mut out = String::new();
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('r') => out.push('\r'),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn escape_md(value: &str) -> String {
    value.replace('|', "\\|")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_tracker_config() {
        let content = r#"
[[item]]
id = "selection"
category = "runtime"
priority = "high"
status = "ported"
title = "Selection"
poc_refs = ["tools/clod-poc/src/clod/selection.ts"]
bevy_paths = ["src/voxel/pages/selection.rs"]
notes = "ok"
"#;
        let items = parse_items(content).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, "selection");
        assert_eq!(items[0].poc_refs[0], "tools/clod-poc/src/clod/selection.ts");
    }

    #[test]
    fn ignores_comments_outside_strings() {
        let line = r#"title = "A # value" # comment"#;
        assert_eq!(strip_comment(line).trim(), r#"title = "A # value""#);
    }
}
