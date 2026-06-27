use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Parser;
use serde::Deserialize;
use voxel_builder::voxel::pages::config::ClodPagesConfig;
use voxel_builder::voxel::pages::edit_dirtiness::{
    ClodDirtyPageGrid, ClodDirtyPagePlan, plan_dirty_pages_for_sphere,
};

#[derive(Parser, Debug)]
#[command(
    about = "Export planned CLOD dirty pages for scripted bench edit operations",
    version
)]
struct Args {
    /// One or more bench scene TOML files containing [[checkpoint.clod_edit]] blocks.
    #[arg(required = true)]
    scenes: Vec<PathBuf>,

    /// Output CSV path.
    #[arg(long, default_value = "perf-dumps/clod-edit-plan.csv")]
    out: PathBuf,

    /// Override LOD0 page size in world/cell units. Defaults to clod_pages.yaml page.chunks_per_page * page.chunk_size.
    #[arg(long)]
    lod0_page_size_cells: Option<f32>,

    /// Override minimum LOD0 page X coord. Defaults to 0.
    #[arg(long, default_value_t = 0)]
    origin_min_page_x: i32,

    /// Override minimum LOD0 page Z coord. Defaults to 0.
    #[arg(long, default_value_t = 0)]
    origin_min_page_z: i32,

    /// Override world LOD0 page count along X. Defaults to clod_pages.yaml poc_gate.lod0_pages_x or 2^(levels-1).
    #[arg(long)]
    world_pages_x: Option<i32>,

    /// Override world LOD0 page count along Z. Defaults to clod_pages.yaml poc_gate.lod0_pages_z or 2^(levels-1).
    #[arg(long)]
    world_pages_z: Option<i32>,

    /// Override number of CLOD levels. Defaults to clod_pages.yaml page.quadtree_levels.
    #[arg(long)]
    max_levels: Option<usize>,

    /// Extra conservative X/Z brush margin in world/cell units.
    #[arg(long, default_value_t = 0.0)]
    influence_margin: f32,

    /// Fail when a scene has no edit operations.
    #[arg(long)]
    require_edits: bool,
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
    clod_edit: Vec<ClodEditOperation>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ClodEditDefaults {
    radius: Option<f32>,
    strength: Option<f32>,
    expected_dirty_pages_min: Option<u32>,
    expected_dirty_pages_max: Option<u32>,
    expected_rebuild_publish_max_frames: Option<u32>,
    expected_collider_refresh_max_frames: Option<u32>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ClodEditKind {
    Dig,
    Raise,
    Level,
    Smooth,
}

impl ClodEditKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Dig => "dig",
            Self::Raise => "raise",
            Self::Level => "level",
            Self::Smooth => "smooth",
        }
    }
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

#[derive(Clone, Copy, Debug)]
struct ExportGridConfig {
    lod0_page_size_cells: f32,
    origin_min_page_x: i32,
    origin_min_page_z: i32,
    world_pages_x: i32,
    world_pages_z: i32,
    max_levels: usize,
}

#[derive(Debug)]
struct PlanRow {
    scene: String,
    checkpoint: String,
    edit: String,
    iteration: u32,
    frame: u32,
    kind: ClodEditKind,
    position: [f32; 3],
    radius: f32,
    strength: f32,
    target_height: Option<f32>,
    expected_dirty_pages_min: Option<u32>,
    expected_dirty_pages_max: Option<u32>,
    expected_rebuild_publish_max_frames: Option<u32>,
    expected_collider_refresh_max_frames: Option<u32>,
    plan: ClodDirtyPagePlan,
}

fn main() -> ExitCode {
    let args = Args::parse();

    match run(&args) {
        Ok(count) => {
            println!(
                "wrote {count} CLOD edit-plan rows to {}",
                args.out.display()
            );
            ExitCode::SUCCESS
        }
        Err(err) => {
            eprintln!("clod_edit_plan_export: {err}");
            ExitCode::from(1)
        }
    }
}

fn run(args: &Args) -> Result<usize, String> {
    let grid_cfg = resolve_grid_config(args)?;
    let grid = ClodDirtyPageGrid::try_new(
        grid_cfg.lod0_page_size_cells,
        grid_cfg.origin_min_page_x,
        grid_cfg.origin_min_page_z,
        grid_cfg.world_pages_x,
        grid_cfg.world_pages_z,
        grid_cfg.max_levels,
    )?;

    let mut rows = Vec::new();
    for scene_path in &args.scenes {
        let text = fs::read_to_string(scene_path)
            .map_err(|err| format!("{}: failed to read scene: {err}", scene_path.display()))?;
        let scene: BenchScene = toml::from_str(&text)
            .map_err(|err| format!("{}: invalid scene TOML: {err}", scene_path.display()))?;
        rows.extend(materialize_scene(scene_path, &scene, grid, args.influence_margin)?);
    }

    if args.require_edits && rows.is_empty() {
        return Err("no [[checkpoint.clod_edit]] operations found".to_string());
    }

    write_csv(&args.out, &rows)?;
    Ok(rows.len())
}

fn resolve_grid_config(args: &Args) -> Result<ExportGridConfig, String> {
    let cfg = ClodPagesConfig::load();
    let default_lod0_size = (cfg.page.chunks_per_page * cfg.page.chunk_size) as f32;
    let max_levels = args.max_levels.unwrap_or(cfg.page.quadtree_levels);
    let fallback_pages = 1_i32.checked_shl(max_levels.saturating_sub(1) as u32).unwrap_or(1);
    let default_pages_x = cfg
        .poc_gate
        .as_ref()
        .map(|gate| gate.lod0_pages_x as i32)
        .unwrap_or(fallback_pages);
    let default_pages_z = cfg
        .poc_gate
        .as_ref()
        .map(|gate| gate.lod0_pages_z as i32)
        .unwrap_or(fallback_pages);

    let lod0_page_size_cells = args.lod0_page_size_cells.unwrap_or(default_lod0_size);
    let world_pages_x = args.world_pages_x.unwrap_or(default_pages_x);
    let world_pages_z = args.world_pages_z.unwrap_or(default_pages_z);

    if !lod0_page_size_cells.is_finite() || lod0_page_size_cells <= 0.0 {
        return Err(format!(
            "lod0 page size must be finite and > 0, got {lod0_page_size_cells}"
        ));
    }
    if world_pages_x <= 0 || world_pages_z <= 0 {
        return Err(format!(
            "world page counts must be positive, got {world_pages_x}x{world_pages_z}"
        ));
    }
    if max_levels == 0 {
        return Err("max_levels must be at least 1".to_string());
    }
    if !args.influence_margin.is_finite() || args.influence_margin < 0.0 {
        return Err(format!(
            "influence margin must be finite and >= 0, got {}",
            args.influence_margin
        ));
    }

    Ok(ExportGridConfig {
        lod0_page_size_cells,
        origin_min_page_x: args.origin_min_page_x,
        origin_min_page_z: args.origin_min_page_z,
        world_pages_x,
        world_pages_z,
        max_levels,
    })
}

fn materialize_scene(
    scene_path: &Path,
    scene: &BenchScene,
    grid: ClodDirtyPageGrid,
    influence_margin: f32,
) -> Result<Vec<PlanRow>, String> {
    let mut rows = Vec::new();
    let scene_name = scene_path.display().to_string();

    for (checkpoint_index, checkpoint) in scene.checkpoint.iter().enumerate() {
        let checkpoint_name = if checkpoint.name.trim().is_empty() {
            format!("checkpoint-{checkpoint_index}")
        } else {
            checkpoint.name.clone()
        };

        for op in &checkpoint.clod_edit {
            let radius = resolve_positive_f32(op.radius.or(scene.clod_edit_defaults.radius), "radius", &op.name)?;
            let strength = resolve_positive_f32(
                op.strength.or(scene.clod_edit_defaults.strength),
                "strength",
                &op.name,
            )?;
            if op.kind == ClodEditKind::Level && op.target_height.is_none() {
                return Err(format!(
                    "{} / {} / {}: level edits require target_height",
                    scene_path.display(),
                    checkpoint_name,
                    op.name
                ));
            }

            let repeat_count = op.repeat_count.unwrap_or(1);
            if repeat_count == 0 {
                return Err(format!(
                    "{} / {} / {}: repeat_count must be >= 1",
                    scene_path.display(),
                    checkpoint_name,
                    op.name
                ));
            }
            if repeat_count > 1 && op.repeat_every_frames.unwrap_or(0) == 0 {
                return Err(format!(
                    "{} / {} / {}: repeated edits require repeat_every_frames > 0",
                    scene_path.display(),
                    checkpoint_name,
                    op.name
                ));
            }

            for iteration in 0..repeat_count {
                let frame = op.frame + iteration * op.repeat_every_frames.unwrap_or(0);
                let plan = plan_dirty_pages_for_sphere(
                    grid,
                    op.position[0],
                    op.position[2],
                    radius,
                    influence_margin,
                );

                rows.push(PlanRow {
                    scene: scene_name.clone(),
                    checkpoint: checkpoint_name.clone(),
                    edit: op.name.clone(),
                    iteration,
                    frame,
                    kind: op.kind,
                    position: op.position,
                    radius,
                    strength,
                    target_height: op.target_height,
                    expected_dirty_pages_min: op
                        .expected_dirty_pages_min
                        .or(scene.clod_edit_defaults.expected_dirty_pages_min),
                    expected_dirty_pages_max: op
                        .expected_dirty_pages_max
                        .or(scene.clod_edit_defaults.expected_dirty_pages_max),
                    expected_rebuild_publish_max_frames: op.expected_rebuild_publish_max_frames.or(
                        scene
                            .clod_edit_defaults
                            .expected_rebuild_publish_max_frames,
                    ),
                    expected_collider_refresh_max_frames: op.expected_collider_refresh_max_frames.or(
                        scene
                            .clod_edit_defaults
                            .expected_collider_refresh_max_frames,
                    ),
                    plan,
                });
            }
        }
    }

    Ok(rows)
}

fn resolve_positive_f32(value: Option<f32>, field: &str, edit_name: &str) -> Result<f32, String> {
    let Some(value) = value else {
        return Err(format!("{edit_name}: missing required {field}"));
    };
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("{edit_name}: {field} must be finite and > 0, got {value}"));
    }
    Ok(value)
}

fn write_csv(path: &Path, rows: &[PlanRow]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|err| format!("failed to create {}: {err}", parent.display()))?;
        }
    }

    let mut out = String::new();
    out.push_str(
        "scene,checkpoint,edit,iteration,frame,kind,world_x,world_y,world_z,radius,strength,target_height,dirty_lod0_pages,dirty_ancestor_nodes,dirty_total_nodes,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames,lod0_page_coords,ancestor_node_coords\n",
    );
    for row in rows {
        out.push_str(&row_to_csv(row));
        out.push('\n');
    }

    fs::write(path, out).map_err(|err| format!("failed to write {}: {err}", path.display()))
}

fn row_to_csv(row: &PlanRow) -> String {
    [
        csv_field(&row.scene),
        csv_field(&row.checkpoint),
        csv_field(&row.edit),
        row.iteration.to_string(),
        row.frame.to_string(),
        row.kind.as_str().to_string(),
        format_float(row.position[0]),
        format_float(row.position[1]),
        format_float(row.position[2]),
        format_float(row.radius),
        format_float(row.strength),
        row.target_height.map(format_float).unwrap_or_default(),
        row.plan.lod0_page_coords.len().to_string(),
        row.plan.total_ancestor_count().to_string(),
        row.plan.total_node_count().to_string(),
        row.expected_dirty_pages_min.map(|v| v.to_string()).unwrap_or_default(),
        row.expected_dirty_pages_max.map(|v| v.to_string()).unwrap_or_default(),
        row.expected_rebuild_publish_max_frames
            .map(|v| v.to_string())
            .unwrap_or_default(),
        row.expected_collider_refresh_max_frames
            .map(|v| v.to_string())
            .unwrap_or_default(),
        csv_field(&format_lod0_coords(&row.plan)),
        csv_field(&format_ancestor_coords(&row.plan)),
    ]
    .join(",")
}

fn format_lod0_coords(plan: &ClodDirtyPagePlan) -> String {
    plan.lod0_page_coords
        .iter()
        .map(|(x, z)| format!("{x}:{z}"))
        .collect::<Vec<_>>()
        .join("|")
}

fn format_ancestor_coords(plan: &ClodDirtyPagePlan) -> String {
    plan.ancestor_node_coords_by_level
        .iter()
        .enumerate()
        .skip(1)
        .flat_map(|(level, coords)| {
            coords
                .iter()
                .map(move |(x, z)| format!("L{level}:{x}:{z}"))
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn csv_field(value: &str) -> String {
    let escaped = value.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

fn format_float(value: f32) -> String {
    if value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        format!("{value:.6}")
            .trim_end_matches('0')
            .trim_end_matches('.')
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> ClodDirtyPageGrid {
        ClodDirtyPageGrid::try_new(64.0, 0, 0, 8, 8, 4).unwrap()
    }

    #[test]
    fn materializes_repeated_edit_rows() {
        let scene: BenchScene = toml::from_str(
            r#"
            [clod_edit_defaults]
            radius = 4.0
            strength = 0.5
            expected_dirty_pages_min = 1

            [[checkpoint]]
            name = "ridge"
            hold_frames = 100

            [[checkpoint.clod_edit]]
            name = "dig-a"
            frame = 10
            kind = "dig"
            position = [63.0, 10.0, 64.0]
            repeat_every_frames = 15
            repeat_count = 2
            "#,
        )
        .unwrap();

        let rows = materialize_scene(Path::new("scene.toml"), &scene, grid(), 0.0).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].frame, 10);
        assert_eq!(rows[1].frame, 25);
        assert_eq!(rows[0].plan.lod0_page_coords.len(), 4);
        assert_eq!(rows[0].expected_dirty_pages_min, Some(1));
    }

    #[test]
    fn level_edits_require_target_height() {
        let scene: BenchScene = toml::from_str(
            r#"
            [clod_edit_defaults]
            radius = 4.0
            strength = 0.5

            [[checkpoint]]
            name = "level"

            [[checkpoint.clod_edit]]
            name = "bad-level"
            frame = 0
            kind = "level"
            position = [10.0, 10.0, 10.0]
            "#,
        )
        .unwrap();

        let err = materialize_scene(Path::new("scene.toml"), &scene, grid(), 0.0)
            .expect_err("missing target height must fail");
        assert!(err.contains("target_height"));
    }

    #[test]
    fn csv_row_quotes_coordinate_lists() {
        let scene: BenchScene = toml::from_str(
            r#"
            [clod_edit_defaults]
            radius = 4.0
            strength = 0.5

            [[checkpoint]]
            name = "ridge"

            [[checkpoint.clod_edit]]
            name = "dig-a"
            frame = 1
            kind = "dig"
            position = [10.0, 5.0, 10.0]
            "#,
        )
        .unwrap();
        let rows = materialize_scene(Path::new("scene.toml"), &scene, grid(), 0.0).unwrap();
        let csv = row_to_csv(&rows[0]);
        assert!(csv.contains("\"scene.toml\""));
        assert!(csv.contains("\"0:0\""));
        assert!(csv.contains("L1:0:0"));
    }
}
