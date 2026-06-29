use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

const DEFAULT_MAX_PUBLISH_FRAMES: u64 = 120;

#[derive(Debug, Clone)]
struct Args {
    plan: PathBuf,
    rebuild: PathBuf,
    default_max_publish_frames: u64,
    require_distinct_rebuilds: bool,
    max_unmatched_edits: usize,
    min_matched_ratio: f64,
    min_dirty_pages: u64,
    allow_empty_plan: bool,
}

impl Default for Args {
    fn default() -> Self {
        Self {
            plan: PathBuf::from("perf-dumps/clod-edit-plan.csv"),
            rebuild: PathBuf::from("perf-dumps/clod-rebuild-observer.csv"),
            default_max_publish_frames: DEFAULT_MAX_PUBLISH_FRAMES,
            require_distinct_rebuilds: false,
            max_unmatched_edits: 0,
            min_matched_ratio: 1.0,
            min_dirty_pages: 1,
            allow_empty_plan: false,
        }
    }
}

#[derive(Debug, Clone)]
struct PlanEdit {
    row_number: usize,
    scene: String,
    checkpoint: String,
    edit: String,
    iteration: u64,
    frame: u64,
    dirty_lod0_pages: u64,
    expected_dirty_pages_min: Option<u64>,
    expected_dirty_pages_max: Option<u64>,
    expected_rebuild_publish_max_frames: Option<u64>,
}

impl PlanEdit {
    fn label(&self) -> String {
        format!(
            "{}::{}::{}#{}@{}",
            self.scene, self.checkpoint, self.edit, self.iteration, self.frame
        )
    }

    fn deadline(&self, default_max_publish_frames: u64) -> u64 {
        self.frame.saturating_add(
            self.expected_rebuild_publish_max_frames
                .unwrap_or(default_max_publish_frames),
        )
    }
}

#[derive(Debug, Clone)]
struct RebuildRow {
    row_number: usize,
    sequence: u64,
    input_revision: u64,
    tree_revision_start: u64,
    tree_revision_published: u64,
    input_frame: u64,
    source_complete_frame: Option<u64>,
    build_started_frame: Option<u64>,
    published_frame: u64,
    complete_pages: u64,
    nodes: u64,
    triangles: u64,
    total_ms: Option<f64>,
}

impl RebuildRow {
    fn is_complete_publication(&self) -> bool {
        self.tree_revision_published > self.tree_revision_start
            && self.published_frame >= self.input_frame
            && self.complete_pages > 0
            && self.nodes > 0
            && self.triangles > 0
    }
}

#[derive(Debug)]
struct MatchResult {
    plan: PlanEdit,
    matched_rebuild: Option<usize>,
}

fn main() -> ExitCode {
    match run(parse_args(std::env::args().skip(1).collect())) {
        Ok(report) => {
            println!("{report}");
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("CLOD edit rebuild guard failed:\n{err}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Args) -> Result<String, String> {
    let plan_rows = read_plan_csv(&args.plan)?;
    let rebuild_rows = read_rebuild_csv(&args.rebuild)?;

    if plan_rows.is_empty() && !args.allow_empty_plan {
        return Err(format!(
            "{} contains no planned CLOD edit rows; pass --allow-empty-plan for smoke runs",
            args.plan.display()
        ));
    }
    if !plan_rows.is_empty() && rebuild_rows.is_empty() {
        return Err(format!(
            "{} contains planned edits but {} contains no rebuild publications",
            args.plan.display(),
            args.rebuild.display()
        ));
    }

    let dirty_plan_rows: Vec<PlanEdit> = plan_rows
        .into_iter()
        .filter(|row| row.dirty_lod0_pages >= args.min_dirty_pages)
        .collect();

    let mut failures = Vec::new();
    for plan in &dirty_plan_rows {
        if let Some(min) = plan.expected_dirty_pages_min {
            if plan.dirty_lod0_pages < min {
                failures.push(format!(
                    "plan row {} {} dirties {} LOD0 pages, below expected minimum {}",
                    plan.row_number,
                    plan.label(),
                    plan.dirty_lod0_pages,
                    min
                ));
            }
        }
        if let Some(max) = plan.expected_dirty_pages_max {
            if plan.dirty_lod0_pages > max {
                failures.push(format!(
                    "plan row {} {} dirties {} LOD0 pages, above expected maximum {}",
                    plan.row_number,
                    plan.label(),
                    plan.dirty_lod0_pages,
                    max
                ));
            }
        }
    }

    for rebuild in &rebuild_rows {
        if rebuild.published_frame < rebuild.input_frame {
            failures.push(format!(
                "rebuild row {} sequence {} published before input frame: {} < {}",
                rebuild.row_number, rebuild.sequence, rebuild.published_frame, rebuild.input_frame
            ));
        }
        if rebuild.source_complete_frame.is_none() {
            failures.push(format!(
                "rebuild row {} sequence {} has no source_complete_frame",
                rebuild.row_number, rebuild.sequence
            ));
        }
        if rebuild.build_started_frame.is_none() {
            failures.push(format!(
                "rebuild row {} sequence {} has no build_started_frame",
                rebuild.row_number, rebuild.sequence
            ));
        }
        if rebuild.tree_revision_published <= rebuild.tree_revision_start {
            failures.push(format!(
                "rebuild row {} sequence {} did not advance the tree revision: {} -> {}",
                rebuild.row_number,
                rebuild.sequence,
                rebuild.tree_revision_start,
                rebuild.tree_revision_published
            ));
        }
        if rebuild.complete_pages == 0 || rebuild.nodes == 0 || rebuild.triangles == 0 {
            failures.push(format!(
                "rebuild row {} sequence {} published incomplete tree: complete_pages={}, nodes={}, triangles={}",
                rebuild.row_number,
                rebuild.sequence,
                rebuild.complete_pages,
                rebuild.nodes,
                rebuild.triangles
            ));
        }
    }

    let matches = match_edits_to_rebuilds(
        &dirty_plan_rows,
        &rebuild_rows,
        args.default_max_publish_frames,
        args.require_distinct_rebuilds,
    );

    let unmatched: Vec<&MatchResult> = matches
        .iter()
        .filter(|result| result.matched_rebuild.is_none())
        .collect();
    let matched_count = matches.len().saturating_sub(unmatched.len());
    let matched_ratio = if matches.is_empty() {
        1.0
    } else {
        matched_count as f64 / matches.len() as f64
    };

    if unmatched.len() > args.max_unmatched_edits {
        for result in &unmatched {
            failures.push(format!(
                "planned edit {} has no complete rebuild publication in frame window [{}..={}]",
                result.plan.label(),
                result.plan.frame,
                result.plan.deadline(args.default_max_publish_frames)
            ));
        }
    }
    if matched_ratio + f64::EPSILON < args.min_matched_ratio {
        failures.push(format!(
            "matched edit ratio {:.3} is below required {:.3} (matched {}/{})",
            matched_ratio,
            args.min_matched_ratio,
            matched_count,
            matches.len()
        ));
    }

    if !failures.is_empty() {
        let mut out = String::new();
        for failure in failures {
            out.push_str("- ");
            out.push_str(&failure);
            out.push('\n');
        }
        return Err(out);
    }

    let complete_rebuilds = rebuild_rows
        .iter()
        .filter(|row| row.is_complete_publication())
        .count();
    let max_publish_latency = rebuild_rows
        .iter()
        .filter(|row| row.is_complete_publication())
        .map(|row| row.published_frame.saturating_sub(row.input_frame))
        .max()
        .unwrap_or(0);
    let max_total_ms = rebuild_rows
        .iter()
        .filter_map(|row| row.total_ms)
        .fold(0.0_f64, f64::max);

    Ok(format!(
        "CLOD edit rebuild guard passed: planned_dirty_edits={}, matched_edits={}, complete_rebuilds={}, max_publish_latency_frames={}, max_total_ms={:.3}",
        matches.len(),
        matched_count,
        complete_rebuilds,
        max_publish_latency,
        max_total_ms
    ))
}

fn match_edits_to_rebuilds(
    plans: &[PlanEdit],
    rebuilds: &[RebuildRow],
    default_max_publish_frames: u64,
    require_distinct_rebuilds: bool,
) -> Vec<MatchResult> {
    let mut used_rebuilds = HashSet::new();
    let mut results = Vec::with_capacity(plans.len());

    for plan in plans {
        let deadline = plan.deadline(default_max_publish_frames);
        let mut matched = None;

        for (idx, rebuild) in rebuilds.iter().enumerate() {
            if require_distinct_rebuilds && used_rebuilds.contains(&idx) {
                continue;
            }
            if !rebuild.is_complete_publication() {
                continue;
            }
            if rebuild.input_frame < plan.frame {
                continue;
            }
            if rebuild.published_frame > deadline {
                continue;
            }
            matched = Some(idx);
            used_rebuilds.insert(idx);
            break;
        }

        results.push(MatchResult {
            plan: plan.clone(),
            matched_rebuild: matched,
        });
    }

    results
}

fn parse_args(raw: Vec<String>) -> Args {
    let mut args = Args::default();
    let mut i = 0;
    while i < raw.len() {
        match raw[i].as_str() {
            "--plan" => {
                i += 1;
                args.plan = expect_path(&raw, i, "--plan");
            }
            "--rebuild" => {
                i += 1;
                args.rebuild = expect_path(&raw, i, "--rebuild");
            }
            "--default-max-publish-frames" => {
                i += 1;
                args.default_max_publish_frames =
                    expect_parse(&raw, i, "--default-max-publish-frames");
            }
            "--require-distinct-rebuilds" => {
                args.require_distinct_rebuilds = true;
            }
            "--max-unmatched-edits" => {
                i += 1;
                args.max_unmatched_edits = expect_parse(&raw, i, "--max-unmatched-edits");
            }
            "--min-matched-ratio" => {
                i += 1;
                args.min_matched_ratio = expect_parse(&raw, i, "--min-matched-ratio");
            }
            "--min-dirty-pages" => {
                i += 1;
                args.min_dirty_pages = expect_parse(&raw, i, "--min-dirty-pages");
            }
            "--allow-empty-plan" => {
                args.allow_empty_plan = true;
            }
            "-h" | "--help" => {
                print_help_and_exit();
            }
            unknown => {
                eprintln!("unknown argument: {unknown}");
                print_help_and_exit();
            }
        }
        i += 1;
    }
    args
}

fn expect_path(raw: &[String], index: usize, flag: &str) -> PathBuf {
    raw.get(index)
        .map(PathBuf::from)
        .unwrap_or_else(|| panic!("{flag} requires a path"))
}

fn expect_parse<T: std::str::FromStr>(raw: &[String], index: usize, flag: &str) -> T {
    raw.get(index)
        .unwrap_or_else(|| panic!("{flag} requires a value"))
        .parse()
        .unwrap_or_else(|_| panic!("{flag} has an invalid value"))
}

fn print_help_and_exit() -> ! {
    println!(
        "Usage: clod_edit_rebuild_guard --plan <clod-edit-plan.csv> --rebuild <clod-rebuild-observer.csv> [options]\n\
\nOptions:\n\
  --default-max-publish-frames <frames>  Fallback edit->publish window when the plan row has no expectation. Default: {DEFAULT_MAX_PUBLISH_FRAMES}\n\
  --require-distinct-rebuilds            Require each planned edit to match a different rebuild row. Default allows batched rebuilds.\n\
  --max-unmatched-edits <count>          Allowed unmatched planned dirty edits. Default: 0\n\
  --min-matched-ratio <ratio>            Minimum matched dirty edit ratio. Default: 1.0\n\
  --min-dirty-pages <count>              Ignore plan rows below this dirty LOD0 page count. Default: 1\n\
  --allow-empty-plan                     Treat an empty plan CSV as success."
    );
    std::process::exit(0)
}

fn read_plan_csv(path: &Path) -> Result<Vec<PlanEdit>, String> {
    let (headers, records) = read_csv(path)?;
    let index = header_index(&headers);
    let mut rows = Vec::new();

    for (record_index, record) in records.iter().enumerate() {
        let row_number = record_index + 2;
        rows.push(PlanEdit {
            row_number,
            scene: field(record, &index, "scene", row_number)?.to_string(),
            checkpoint: field(record, &index, "checkpoint", row_number)?.to_string(),
            edit: field(record, &index, "edit", row_number)?.to_string(),
            iteration: parse_field(record, &index, "iteration", row_number)?,
            frame: parse_field(record, &index, "frame", row_number)?,
            dirty_lod0_pages: parse_field(record, &index, "dirty_lod0_pages", row_number)?,
            expected_dirty_pages_min: parse_opt_field(
                record,
                &index,
                "expected_dirty_pages_min",
                row_number,
            )?,
            expected_dirty_pages_max: parse_opt_field(
                record,
                &index,
                "expected_dirty_pages_max",
                row_number,
            )?,
            expected_rebuild_publish_max_frames: parse_opt_field(
                record,
                &index,
                "expected_rebuild_publish_max_frames",
                row_number,
            )?,
        });
    }

    Ok(rows)
}

fn read_rebuild_csv(path: &Path) -> Result<Vec<RebuildRow>, String> {
    let (headers, records) = read_csv(path)?;
    let index = header_index(&headers);
    let mut rows = Vec::new();

    for (record_index, record) in records.iter().enumerate() {
        let row_number = record_index + 2;
        rows.push(RebuildRow {
            row_number,
            sequence: parse_field(record, &index, "sequence", row_number)?,
            input_revision: parse_field(record, &index, "input_revision", row_number)?,
            tree_revision_start: parse_field(record, &index, "tree_revision_start", row_number)?,
            tree_revision_published: parse_field(
                record,
                &index,
                "tree_revision_published",
                row_number,
            )?,
            input_frame: parse_field(record, &index, "input_frame", row_number)?,
            source_complete_frame: parse_opt_field(
                record,
                &index,
                "source_complete_frame",
                row_number,
            )?,
            build_started_frame: parse_opt_field(
                record,
                &index,
                "build_started_frame",
                row_number,
            )?,
            published_frame: parse_field(record, &index, "published_frame", row_number)?,
            complete_pages: parse_field(record, &index, "complete_pages", row_number)?,
            nodes: parse_field(record, &index, "nodes", row_number)?,
            triangles: parse_field(record, &index, "triangles", row_number)?,
            total_ms: parse_opt_field(record, &index, "total_ms", row_number)?,
        });
    }

    Ok(rows)
}

fn read_csv(path: &Path) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
    let text = fs::read_to_string(path)
        .map_err(|err| format!("failed to read {}: {err}", path.display()))?;
    let mut lines = text.lines().filter(|line| !line.trim().is_empty());
    let header_line = lines
        .next()
        .ok_or_else(|| format!("{} is empty", path.display()))?;
    let headers =
        parse_csv_line(header_line).map_err(|err| format!("{} header: {err}", path.display()))?;
    let mut records = Vec::new();
    for (idx, line) in lines.enumerate() {
        records.push(
            parse_csv_line(line)
                .map_err(|err| format!("{} row {}: {err}", path.display(), idx + 2))?,
        );
    }
    Ok((headers, records))
}

fn parse_csv_line(line: &str) -> Result<Vec<String>, String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => {
                in_quotes = !in_quotes;
            }
            ',' if !in_quotes => {
                fields.push(current);
                current = String::new();
            }
            _ => current.push(ch),
        }
    }

    if in_quotes {
        return Err("unterminated quoted field".to_string());
    }

    fields.push(current);
    Ok(fields)
}

fn header_index(headers: &[String]) -> HashMap<String, usize> {
    headers
        .iter()
        .enumerate()
        .map(|(idx, header)| (header.trim().to_string(), idx))
        .collect()
}

fn field<'a>(
    record: &'a [String],
    index: &HashMap<String, usize>,
    name: &str,
    row_number: usize,
) -> Result<&'a str, String> {
    let idx = index
        .get(name)
        .ok_or_else(|| format!("missing CSV column '{name}'"))?;
    record
        .get(*idx)
        .map(|value| value.trim())
        .ok_or_else(|| format!("row {row_number} missing field '{name}'"))
}

fn parse_field<T: std::str::FromStr>(
    record: &[String],
    index: &HashMap<String, usize>,
    name: &str,
    row_number: usize,
) -> Result<T, String> {
    let value = field(record, index, name, row_number)?;
    if value.is_empty() {
        return Err(format!("row {row_number} field '{name}' is empty"));
    }
    value
        .parse()
        .map_err(|_| format!("row {row_number} field '{name}' has invalid value '{value}'"))
}

fn parse_opt_field<T: std::str::FromStr>(
    record: &[String],
    index: &HashMap<String, usize>,
    name: &str,
    row_number: usize,
) -> Result<Option<T>, String> {
    let value = field(record, index, name, row_number)?;
    if value.is_empty() {
        Ok(None)
    } else {
        value
            .parse()
            .map(Some)
            .map_err(|_| format!("row {row_number} field '{name}' has invalid value '{value}'"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan(frame: u64, max_frames: u64) -> PlanEdit {
        PlanEdit {
            row_number: 2,
            scene: "scene".to_string(),
            checkpoint: "cp".to_string(),
            edit: "dig".to_string(),
            iteration: 0,
            frame,
            dirty_lod0_pages: 1,
            expected_dirty_pages_min: None,
            expected_dirty_pages_max: None,
            expected_rebuild_publish_max_frames: Some(max_frames),
        }
    }

    fn rebuild(input_frame: u64, published_frame: u64) -> RebuildRow {
        RebuildRow {
            row_number: 2,
            sequence: 1,
            input_revision: 2,
            tree_revision_start: 1,
            tree_revision_published: 2,
            input_frame,
            source_complete_frame: Some(input_frame),
            build_started_frame: Some(input_frame + 1),
            published_frame,
            complete_pages: 64,
            nodes: 85,
            triangles: 1024,
            total_ms: Some(8.0),
        }
    }

    #[test]
    fn csv_parser_handles_quoted_coordinate_lists() {
        let fields = parse_csv_line("a,\"0:0,1:0\",\"L1:0:0\"").unwrap();
        assert_eq!(fields, vec!["a", "0:0,1:0", "L1:0:0"]);
    }

    #[test]
    fn edit_matches_complete_rebuild_in_deadline() {
        let results = match_edits_to_rebuilds(&[plan(10, 30)], &[rebuild(15, 25)], 120, false);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].matched_rebuild, Some(0));
    }

    #[test]
    fn edit_does_not_match_late_rebuild() {
        let results = match_edits_to_rebuilds(&[plan(10, 30)], &[rebuild(15, 45)], 120, false);
        assert_eq!(results[0].matched_rebuild, None);
    }

    #[test]
    fn distinct_mode_does_not_reuse_rebuilds() {
        let plans = vec![plan(10, 30), plan(11, 30)];
        let rebuilds = vec![rebuild(12, 20)];
        let results = match_edits_to_rebuilds(&plans, &rebuilds, 120, true);
        assert_eq!(results[0].matched_rebuild, Some(0));
        assert_eq!(results[1].matched_rebuild, None);
    }

    #[test]
    fn default_mode_allows_batched_rebuilds() {
        let plans = vec![plan(10, 30), plan(11, 30)];
        let rebuilds = vec![rebuild(12, 20)];
        let results = match_edits_to_rebuilds(&plans, &rebuilds, 120, false);
        assert_eq!(results[0].matched_rebuild, Some(0));
        assert_eq!(results[1].matched_rebuild, Some(0));
    }
}
