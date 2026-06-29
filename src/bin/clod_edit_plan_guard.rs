use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;
use serde::Deserialize;

#[derive(Parser, Debug)]
#[command(
    about = "Validate CLOD scripted edit-operation blocks in bench scene TOML files",
    version
)]
struct Args {
    /// One or more bench scene TOML files to validate.
    #[arg(required = true)]
    scenes: Vec<PathBuf>,

    /// Fail when a scene has no [[checkpoint.clod_edit]] blocks.
    #[arg(long)]
    require_edits: bool,

    /// Treat warnings as process failures.
    #[arg(long)]
    fail_on_warning: bool,
}

#[derive(Debug, Deserialize)]
struct BenchScene {
    #[serde(default)]
    checkpoint: Vec<BenchCheckpoint>,

    #[serde(default)]
    clod_edit_defaults: ClodEditDefaults,
}

#[derive(Debug, Deserialize)]
struct BenchCheckpoint {
    #[serde(default)]
    name: String,

    #[serde(default)]
    hold_frames: Option<u32>,

    #[serde(default)]
    clod_edit: Vec<ClodEditOperation>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ClodEditDefaults {
    radius: Option<f32>,
    strength: Option<f32>,
    expected_dirty_pages_min: Option<u32>,
    expected_rebuild_publish_max_frames: Option<u32>,
    expected_collider_refresh_max_frames: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ClodEditKind {
    Dig,
    Raise,
    Level,
    Smooth,
}

#[derive(Debug, Deserialize)]
struct ClodEditOperation {
    name: String,
    frame: u32,
    kind: ClodEditKind,
    position: [f32; 3],

    #[serde(default)]
    radius: Option<f32>,

    #[serde(default)]
    strength: Option<f32>,

    #[serde(default)]
    target_height: Option<f32>,

    #[serde(default)]
    repeat_every_frames: Option<u32>,

    #[serde(default)]
    repeat_count: Option<u32>,

    #[serde(default)]
    expected_dirty_pages_min: Option<u32>,

    #[serde(default)]
    expected_dirty_pages_max: Option<u32>,

    #[serde(default)]
    expected_rebuild_publish_max_frames: Option<u32>,

    #[serde(default)]
    expected_collider_refresh_max_frames: Option<u32>,
}

#[derive(Debug, Default)]
struct ValidationReport {
    edit_count: usize,
    errors: Vec<String>,
    warnings: Vec<String>,
}

fn main() -> ExitCode {
    let args = Args::parse();
    let mut total_errors = 0usize;
    let mut total_warnings = 0usize;

    for scene_path in &args.scenes {
        match validate_scene_file(scene_path, args.require_edits) {
            Ok(report) => {
                total_errors += report.errors.len();
                total_warnings += report.warnings.len();
                print_report(scene_path, &report);
            }
            Err(err) => {
                total_errors += 1;
                eprintln!("{}: {err}", scene_path.display());
            }
        }
    }

    if total_errors > 0 || (args.fail_on_warning && total_warnings > 0) {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

fn validate_scene_file(path: &Path, require_edits: bool) -> Result<ValidationReport, String> {
    let text = fs::read_to_string(path).map_err(|err| format!("failed to read scene: {err}"))?;
    let scene: BenchScene =
        toml::from_str(&text).map_err(|err| format!("invalid TOML/schema: {err}"))?;
    Ok(validate_scene(&scene, require_edits))
}

fn validate_scene(scene: &BenchScene, require_edits: bool) -> ValidationReport {
    let mut report = ValidationReport::default();
    let mut names = BTreeSet::new();
    let mut ops_by_checkpoint = BTreeMap::<String, Vec<u32>>::new();

    for (checkpoint_index, checkpoint) in scene.checkpoint.iter().enumerate() {
        let checkpoint_name = checkpoint_name(checkpoint, checkpoint_index);
        let hold_frames = checkpoint.hold_frames.unwrap_or(0);

        for op in &checkpoint.clod_edit {
            report.edit_count += 1;
            let op_key = format!("{checkpoint_name}/{}", op.name);

            if op.name.trim().is_empty() {
                report.errors.push(format!(
                    "{checkpoint_name}: edit operation has an empty name"
                ));
            } else if !names.insert(op_key.clone()) {
                report
                    .errors
                    .push(format!("duplicate edit operation name: {op_key}"));
            }

            if hold_frames > 0 && op.frame >= hold_frames {
                report.errors.push(format!(
                    "{op_key}: frame {} is outside checkpoint hold_frames {}",
                    op.frame, hold_frames
                ));
            }

            if !op.position.iter().all(|value| value.is_finite()) {
                report
                    .errors
                    .push(format!("{op_key}: position contains a non-finite value"));
            }

            validate_radius(&scene.clod_edit_defaults, op, &op_key, &mut report);
            validate_strength(&scene.clod_edit_defaults, op, &op_key, &mut report);
            validate_kind_specific_fields(op, &op_key, &mut report);
            validate_repeat_window(hold_frames, op, &op_key, &mut report);
            validate_expected_dirty_pages(&scene.clod_edit_defaults, op, &op_key, &mut report);
            validate_expected_latencies(&scene.clod_edit_defaults, op, &op_key, &mut report);

            ops_by_checkpoint
                .entry(checkpoint_name.clone())
                .or_default()
                .push(op.frame);
        }
    }

    for (checkpoint_name, frames) in ops_by_checkpoint {
        if !frames.windows(2).all(|pair| pair[0] <= pair[1]) {
            report.warnings.push(format!(
                "{checkpoint_name}: clod_edit operations are not sorted by frame"
            ));
        }
    }

    if require_edits && report.edit_count == 0 {
        report
            .errors
            .push("scene has no [[checkpoint.clod_edit]] operations".to_string());
    }

    report
}

fn checkpoint_name(checkpoint: &BenchCheckpoint, index: usize) -> String {
    if checkpoint.name.trim().is_empty() {
        format!("checkpoint[{index}]")
    } else {
        checkpoint.name.clone()
    }
}

fn validate_radius(
    defaults: &ClodEditDefaults,
    op: &ClodEditOperation,
    op_key: &str,
    report: &mut ValidationReport,
) {
    let radius = op.radius.or(defaults.radius);
    match radius {
        Some(value) if value.is_finite() && value > 0.0 => {
            if value > 64.0 {
                report.warnings.push(format!(
                    "{op_key}: radius {value:.2} is unusually high for deterministic CLOD benches"
                ));
            }
        }
        Some(value) => report
            .errors
            .push(format!("{op_key}: invalid radius {value}")),
        None => report
            .errors
            .push(format!("{op_key}: missing radius and no default radius")),
    }
}

fn validate_strength(
    defaults: &ClodEditDefaults,
    op: &ClodEditOperation,
    op_key: &str,
    report: &mut ValidationReport,
) {
    let strength = op.strength.or(defaults.strength);
    match strength {
        Some(value) if value.is_finite() && value > 0.0 => {
            if value > 10.0 {
                report.warnings.push(format!(
                    "{op_key}: strength {value:.2} is unusually high for deterministic CLOD benches"
                ));
            }
        }
        Some(value) => report
            .errors
            .push(format!("{op_key}: invalid strength {value}")),
        None => report.errors.push(format!(
            "{op_key}: missing strength and no default strength"
        )),
    }
}

fn validate_kind_specific_fields(
    op: &ClodEditOperation,
    op_key: &str,
    report: &mut ValidationReport,
) {
    match op.kind {
        ClodEditKind::Level => {
            if op.target_height.is_none() {
                report
                    .errors
                    .push(format!("{op_key}: level edit requires target_height"));
            }
        }
        ClodEditKind::Dig | ClodEditKind::Raise | ClodEditKind::Smooth => {
            if op.target_height.is_some() {
                report.warnings.push(format!(
                    "{op_key}: target_height is ignored by {:?} edits",
                    op.kind
                ));
            }
        }
    }
}

fn validate_repeat_window(
    hold_frames: u32,
    op: &ClodEditOperation,
    op_key: &str,
    report: &mut ValidationReport,
) {
    match (op.repeat_every_frames, op.repeat_count) {
        (Some(every), Some(count)) => {
            if every == 0 {
                report.errors.push(format!(
                    "{op_key}: repeat_every_frames must be greater than zero"
                ));
            }
            if count == 0 {
                report
                    .errors
                    .push(format!("{op_key}: repeat_count must be greater than zero"));
            }
            if every > 0 && count > 0 && hold_frames > 0 {
                let last_frame = op
                    .frame
                    .saturating_add(every.saturating_mul(count.saturating_sub(1)));
                if last_frame >= hold_frames {
                    report.errors.push(format!(
                        "{op_key}: repeated edit reaches frame {last_frame}, outside hold_frames {hold_frames}"
                    ));
                }
            }
        }
        (Some(_), None) => report.errors.push(format!(
            "{op_key}: repeat_every_frames requires repeat_count"
        )),
        (None, Some(_)) => report.errors.push(format!(
            "{op_key}: repeat_count requires repeat_every_frames"
        )),
        (None, None) => {}
    }
}

fn validate_expected_dirty_pages(
    defaults: &ClodEditDefaults,
    op: &ClodEditOperation,
    op_key: &str,
    report: &mut ValidationReport,
) {
    let min_pages = op
        .expected_dirty_pages_min
        .or(defaults.expected_dirty_pages_min);
    if let Some(0) = min_pages {
        report.warnings.push(format!(
            "{op_key}: expected_dirty_pages_min is zero; this will not prove CLOD rebuild coverage"
        ));
    }

    if let (Some(min_pages), Some(max_pages)) = (min_pages, op.expected_dirty_pages_max) {
        if min_pages > max_pages {
            report.errors.push(format!(
                "{op_key}: expected_dirty_pages_min {min_pages} exceeds expected_dirty_pages_max {max_pages}"
            ));
        }
    }
}

fn validate_expected_latencies(
    defaults: &ClodEditDefaults,
    op: &ClodEditOperation,
    op_key: &str,
    report: &mut ValidationReport,
) {
    let rebuild_frames = op
        .expected_rebuild_publish_max_frames
        .or(defaults.expected_rebuild_publish_max_frames);
    let collider_frames = op
        .expected_collider_refresh_max_frames
        .or(defaults.expected_collider_refresh_max_frames);

    if matches!(rebuild_frames, Some(0)) {
        report.errors.push(format!(
            "{op_key}: expected_rebuild_publish_max_frames must be greater than zero"
        ));
    }
    if matches!(collider_frames, Some(0)) {
        report.errors.push(format!(
            "{op_key}: expected_collider_refresh_max_frames must be greater than zero"
        ));
    }
}

fn print_report(path: &Path, report: &ValidationReport) {
    println!(
        "{}: {} edit operation(s), {} error(s), {} warning(s)",
        path.display(),
        report.edit_count,
        report.errors.len(),
        report.warnings.len()
    );

    for error in &report.errors {
        eprintln!("  error: {error}");
    }
    for warning in &report.warnings {
        eprintln!("  warning: {warning}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_scene(text: &str) -> BenchScene {
        toml::from_str(text).expect("test scene should parse")
    }

    #[test]
    fn accepts_valid_edit_plan() {
        let scene = parse_scene(
            r#"
            [clod_edit_defaults]
            radius = 4.0
            strength = 0.5
            expected_dirty_pages_min = 1
            expected_rebuild_publish_max_frames = 90
            expected_collider_refresh_max_frames = 120

            [[checkpoint]]
            name = "edit-stress"
            hold_frames = 240

            [[checkpoint.clod_edit]]
            name = "dig-entrance"
            frame = 30
            kind = "dig"
            position = [256.0, 64.0, 256.0]

            [[checkpoint.clod_edit]]
            name = "level-floor"
            frame = 120
            kind = "level"
            position = [260.0, 64.0, 260.0]
            target_height = 61.5
            repeat_every_frames = 30
            repeat_count = 2
            "#,
        );

        let report = validate_scene(&scene, true);
        assert!(report.errors.is_empty(), "{:#?}", report.errors);
        assert!(report.warnings.is_empty(), "{:#?}", report.warnings);
        assert_eq!(report.edit_count, 2);
    }

    #[test]
    fn rejects_level_without_target_height() {
        let scene = parse_scene(
            r#"
            [[checkpoint]]
            name = "bad-edit"
            hold_frames = 60

            [[checkpoint.clod_edit]]
            name = "bad-level"
            frame = 10
            kind = "level"
            position = [0.0, 1.0, 2.0]
            radius = 3.0
            strength = 1.0
            "#,
        );

        let report = validate_scene(&scene, true);
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("level edit requires target_height"))
        );
    }

    #[test]
    fn rejects_repeated_operation_outside_hold_window() {
        let scene = parse_scene(
            r#"
            [[checkpoint]]
            name = "bad-repeat"
            hold_frames = 50

            [[checkpoint.clod_edit]]
            name = "too-long"
            frame = 30
            kind = "dig"
            position = [0.0, 1.0, 2.0]
            radius = 3.0
            strength = 1.0
            repeat_every_frames = 15
            repeat_count = 3
            "#,
        );

        let report = validate_scene(&scene, true);
        assert!(
            report
                .errors
                .iter()
                .any(|error| error.contains("outside hold_frames"))
        );
    }
}
