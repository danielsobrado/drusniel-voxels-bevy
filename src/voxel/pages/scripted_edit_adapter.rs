//! Dry-run adapter from scripted CLOD edit dispatches to terrain edit requests.
//!
//! The adapter deliberately does not mutate terrain.  It converts deterministic
//! per-frame dispatch records into typed terrain-edit requests and computes the
//! conservative CLOD dirty-page plan that the real runtime mutator should later
//! invalidate.  This gives benches an auditable bridge before enabling actual
//! terrain edits.

use super::edit_dirtiness::{ClodDirtyPageGrid, plan_dirty_pages_for_sphere};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptedEditMutationMode {
    DryRun,
    Apply,
}

impl ScriptedEditMutationMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::DryRun => "dry_run",
            Self::Apply => "apply",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedEditDispatchRow {
    pub driver_frame: u32,
    pub event_index: u32,
    pub occurrence_index: u32,
    pub source_frame: u32,
    pub name: String,
    pub kind: String,
    pub position: [f32; 3],
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    pub expected_dirty_pages_min: u32,
    pub expected_dirty_pages_max: u32,
    pub expected_rebuild_publish_max_frames: u32,
    pub expected_collider_refresh_max_frames: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedTerrainEditRequest {
    pub request_id: u64,
    pub frame: u32,
    pub event_index: u32,
    pub occurrence_index: u32,
    pub name: String,
    pub kind: ScriptedTerrainEditKind,
    pub position: [f32; 3],
    pub radius: f32,
    pub strength: f32,
    pub target_height: Option<f32>,
    pub mutation_mode: ScriptedEditMutationMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptedTerrainEditKind {
    Dig,
    Raise,
    Level,
    Smooth,
}

impl ScriptedTerrainEditKind {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "dig" => Ok(Self::Dig),
            "raise" => Ok(Self::Raise),
            "level" => Ok(Self::Level),
            "smooth" => Ok(Self::Smooth),
            other => Err(format!("unsupported scripted terrain edit kind `{other}`")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dig => "dig",
            Self::Raise => "raise",
            Self::Level => "level",
            Self::Smooth => "smooth",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScriptedEditDryRunRecord {
    pub request: ScriptedTerrainEditRequest,
    pub dirty_lod0_pages: usize,
    pub dirty_ancestor_nodes: usize,
    pub dirty_total_nodes: usize,
    pub expected_dirty_pages_min: u32,
    pub expected_dirty_pages_max: u32,
    pub expected_rebuild_publish_max_frames: u32,
    pub expected_collider_refresh_max_frames: u32,
    pub within_expected_dirty_pages: bool,
    pub dispatch_status: String,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScriptedEditDryRunConfig {
    pub grid: ClodDirtyPageGrid,
    pub influence_margin: f32,
    pub mutation_mode: ScriptedEditMutationMode,
}

impl ScriptedEditDryRunConfig {
    pub fn try_new(
        grid: ClodDirtyPageGrid,
        influence_margin: f32,
        mutation_mode: ScriptedEditMutationMode,
    ) -> Result<Self, String> {
        if !influence_margin.is_finite() || influence_margin < 0.0 {
            return Err(format!(
                "influence_margin must be finite and >= 0, got {influence_margin}"
            ));
        }
        Ok(Self {
            grid,
            influence_margin,
            mutation_mode,
        })
    }
}

pub fn build_dry_run_records(
    rows: &[ScriptedEditDispatchRow],
    config: ScriptedEditDryRunConfig,
) -> Result<Vec<ScriptedEditDryRunRecord>, String> {
    let mut out = Vec::with_capacity(rows.len());

    for (index, row) in rows.iter().enumerate() {
        if row.radius <= 0.0 || !row.radius.is_finite() {
            return Err(format!(
                "row {} has invalid radius {}",
                index + 2,
                row.radius
            ));
        }
        if row.strength <= 0.0 || !row.strength.is_finite() {
            return Err(format!(
                "row {} has invalid strength {}",
                index + 2,
                row.strength
            ));
        }

        let kind = ScriptedTerrainEditKind::parse(&row.kind)?;
        if kind == ScriptedTerrainEditKind::Level && row.target_height.is_none() {
            return Err(format!(
                "row {} `{}` is a level edit without target_height",
                index + 2,
                row.name
            ));
        }

        let plan = plan_dirty_pages_for_sphere(
            config.grid,
            row.position[0],
            row.position[2],
            row.radius,
            config.influence_margin,
        );
        let dirty_lod0_pages = plan.lod0_page_coords.len();
        let dirty_ancestor_nodes = plan.total_ancestor_count();
        let dirty_total_nodes = plan.total_node_count();
        let within_expected_dirty_pages = dirty_lod0_pages as u32 >= row.expected_dirty_pages_min
            && dirty_lod0_pages as u32 <= row.expected_dirty_pages_max;
        let dispatch_status = if within_expected_dirty_pages {
            "ready".to_string()
        } else {
            "dirty_page_expectation_mismatch".to_string()
        };

        out.push(ScriptedEditDryRunRecord {
            request: ScriptedTerrainEditRequest {
                request_id: index as u64,
                frame: row.driver_frame,
                event_index: row.event_index,
                occurrence_index: row.occurrence_index,
                name: row.name.clone(),
                kind,
                position: row.position,
                radius: row.radius,
                strength: row.strength,
                target_height: row.target_height,
                mutation_mode: config.mutation_mode,
            },
            dirty_lod0_pages,
            dirty_ancestor_nodes,
            dirty_total_nodes,
            expected_dirty_pages_min: row.expected_dirty_pages_min,
            expected_dirty_pages_max: row.expected_dirty_pages_max,
            expected_rebuild_publish_max_frames: row.expected_rebuild_publish_max_frames,
            expected_collider_refresh_max_frames: row.expected_collider_refresh_max_frames,
            within_expected_dirty_pages,
            dispatch_status,
        });
    }

    Ok(out)
}

pub fn dry_run_csv_header() -> &'static str {
    "request_id,frame,event_index,occurrence_index,name,kind,x,y,z,radius,strength,target_height,mutation_mode,dirty_lod0_pages,dirty_ancestor_nodes,dirty_total_nodes,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames,within_expected_dirty_pages,dispatch_status"
}

pub fn dry_run_record_to_csv_row(record: &ScriptedEditDryRunRecord) -> String {
    format!(
        "{},{},{},{},{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{},{},{},{},{},{},{},{},{},{},{}",
        record.request.request_id,
        record.request.frame,
        record.request.event_index,
        record.request.occurrence_index,
        csv_escape(&record.request.name),
        record.request.kind.as_str(),
        record.request.position[0],
        record.request.position[1],
        record.request.position[2],
        record.request.radius,
        record.request.strength,
        record
            .request
            .target_height
            .map(|value| format!("{value:.6}"))
            .unwrap_or_default(),
        record.request.mutation_mode.as_str(),
        record.dirty_lod0_pages,
        record.dirty_ancestor_nodes,
        record.dirty_total_nodes,
        record.expected_dirty_pages_min,
        record.expected_dirty_pages_max,
        record.expected_rebuild_publish_max_frames,
        record.expected_collider_refresh_max_frames,
        record.within_expected_dirty_pages,
        csv_escape(&record.dispatch_status),
    )
}

pub fn parse_scripted_edit_dispatch_csv(
    input: &str,
) -> Result<Vec<ScriptedEditDispatchRow>, String> {
    let mut lines = input.lines().filter(|line| !line.trim().is_empty());
    let header = lines
        .next()
        .ok_or_else(|| "empty scripted edit dispatch CSV".to_string())?;
    let columns: Vec<&str> = header.split(',').map(str::trim).collect();

    let mut rows = Vec::new();
    for (line_index, line) in lines.enumerate() {
        let values: Vec<&str> = line.split(',').map(str::trim).collect();
        let read = |name: &str| -> Result<&str, String> {
            let index = columns
                .iter()
                .position(|column| *column == name)
                .ok_or_else(|| format!("missing CSV column `{name}`"))?;
            values
                .get(index)
                .copied()
                .ok_or_else(|| format!("line {} missing value for `{name}`", line_index + 2))
        };

        rows.push(ScriptedEditDispatchRow {
            driver_frame: parse_u32(read("driver_frame")?, "driver_frame", line_index + 2)?,
            event_index: parse_u32(read("event_index")?, "event_index", line_index + 2)?,
            occurrence_index: parse_u32(
                read("occurrence_index")?,
                "occurrence_index",
                line_index + 2,
            )?,
            source_frame: parse_u32(read("source_frame")?, "source_frame", line_index + 2)?,
            name: read("name")?.to_string(),
            kind: read("kind")?.to_string(),
            position: [
                parse_f32(read("x")?, "x", line_index + 2)?,
                parse_f32(read("y")?, "y", line_index + 2)?,
                parse_f32(read("z")?, "z", line_index + 2)?,
            ],
            radius: parse_f32(read("radius")?, "radius", line_index + 2)?,
            strength: parse_f32(read("strength")?, "strength", line_index + 2)?,
            target_height: parse_optional_f32(
                read("target_height").unwrap_or(""),
                "target_height",
                line_index + 2,
            )?,
            expected_dirty_pages_min: parse_u32(
                read("expected_dirty_pages_min")?,
                "expected_dirty_pages_min",
                line_index + 2,
            )?,
            expected_dirty_pages_max: parse_u32(
                read("expected_dirty_pages_max")?,
                "expected_dirty_pages_max",
                line_index + 2,
            )?,
            expected_rebuild_publish_max_frames: parse_u32(
                read("expected_rebuild_publish_max_frames")?,
                "expected_rebuild_publish_max_frames",
                line_index + 2,
            )?,
            expected_collider_refresh_max_frames: parse_u32(
                read("expected_collider_refresh_max_frames")?,
                "expected_collider_refresh_max_frames",
                line_index + 2,
            )?,
        });
    }

    Ok(rows)
}

fn parse_u32(value: &str, column: &str, line: usize) -> Result<u32, String> {
    value
        .parse::<u32>()
        .map_err(|error| format!("line {line} invalid `{column}` value `{value}`: {error}"))
}

fn parse_f32(value: &str, column: &str, line: usize) -> Result<f32, String> {
    let parsed = value
        .parse::<f32>()
        .map_err(|error| format!("line {line} invalid `{column}` value `{value}`: {error}"))?;
    if !parsed.is_finite() {
        return Err(format!(
            "line {line} invalid non-finite `{column}` value `{value}`"
        ));
    }
    Ok(parsed)
}

fn parse_optional_f32(value: &str, column: &str, line: usize) -> Result<Option<f32>, String> {
    if value.trim().is_empty() {
        return Ok(None);
    }
    parse_f32(value, column, line).map(Some)
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> ClodDirtyPageGrid {
        ClodDirtyPageGrid::try_new(16.0, 0, 0, 8, 8, 4).unwrap()
    }

    #[test]
    fn parses_dispatch_and_builds_dry_run_request() {
        let csv = "driver_frame,event_index,occurrence_index,source_frame,name,kind,x,y,z,radius,strength,target_height,expected_dirty_pages_min,expected_dirty_pages_max,expected_rebuild_publish_max_frames,expected_collider_refresh_max_frames\n\
60,0,0,60,dig-ridge,dig,15,66,15,1,0.5,,1,4,90,120\n";
        let rows = parse_scripted_edit_dispatch_csv(csv).unwrap();
        let config =
            ScriptedEditDryRunConfig::try_new(grid(), 0.0, ScriptedEditMutationMode::DryRun)
                .unwrap();
        let records = build_dry_run_records(&rows, config).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].request.kind, ScriptedTerrainEditKind::Dig);
        assert_eq!(records[0].dirty_lod0_pages, 4);
        assert!(records[0].within_expected_dirty_pages);
    }

    #[test]
    fn level_requires_target_height() {
        let row = ScriptedEditDispatchRow {
            driver_frame: 1,
            event_index: 0,
            occurrence_index: 0,
            source_frame: 1,
            name: "level-no-target".to_string(),
            kind: "level".to_string(),
            position: [1.0, 2.0, 3.0],
            radius: 2.0,
            strength: 0.4,
            target_height: None,
            expected_dirty_pages_min: 1,
            expected_dirty_pages_max: 4,
            expected_rebuild_publish_max_frames: 90,
            expected_collider_refresh_max_frames: 120,
        };
        let config =
            ScriptedEditDryRunConfig::try_new(grid(), 0.0, ScriptedEditMutationMode::DryRun)
                .unwrap();
        assert!(build_dry_run_records(&[row], config).is_err());
    }
}
