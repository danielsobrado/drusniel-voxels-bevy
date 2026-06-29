//! Runtime CSV export for CLOD weld/seam diagnostics.
//!
//! `weld_stats` is pure and cheap enough to run when a new page tree is
//! published. This module observes the published tree revision and writes one
//! row per page node so weld/seam regressions become CI-visible.

use std::fs::{File, OpenOptions, create_dir_all};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::weld_stats::{ClodWeldStatsRow, WeldStatsConfig, collect_tree_weld_stats};

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodWeldExportSettings {
    pub enabled: bool,
    pub path: PathBuf,
    pub stats_config: WeldStatsConfig,
}

impl Default for ClodWeldExportSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_WELD_CSV"),
            path: std::env::var("VOXEL_CLOD_WELD_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-weld.csv")),
            stats_config: WeldStatsConfig {
                position_epsilon: env_f32("VOXEL_CLOD_WELD_POSITION_EPSILON").unwrap_or(1.0e-5),
                border_epsilon: env_f32("VOXEL_CLOD_WELD_BORDER_EPSILON").unwrap_or(1.0e-4),
            },
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodWeldExportState {
    writer: Option<BufWriter<File>>,
    exported_revision: Option<u64>,
    disabled_after_error: bool,
}

pub(crate) fn clod_weld_export_system(
    settings: Res<ClodWeldExportSettings>,
    mut state: ResMut<ClodWeldExportState>,
    tree: Res<ClodPageTree>,
) {
    if !settings.enabled || state.disabled_after_error {
        return;
    }
    if !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready)) {
        return;
    }
    if state.exported_revision == Some(tree.revision) {
        return;
    }

    let rows = weld_csv_rows(&tree, settings.stats_config);
    match state.writer(&settings.path).and_then(|writer| {
        writer.write_all(rows.as_bytes())?;
        writer.flush()
    }) {
        Ok(()) => state.exported_revision = Some(tree.revision),
        Err(error) => {
            state.disabled_after_error = true;
            warn!(
                "failed to write CLOD weld CSV {}: {error}",
                settings.path.display()
            );
        }
    }
}

pub(crate) fn weld_csv_rows(tree: &ClodPageTree, cfg: WeldStatsConfig) -> String {
    let mut out = String::new();
    for row in collect_tree_weld_stats(tree, cfg) {
        out.push_str(&row.to_csv_line());
        out.push('\n');
    }
    out
}

impl ClodWeldExportState {
    fn writer(&mut self, path: &Path) -> std::io::Result<&mut BufWriter<File>> {
        if self.writer.is_none() {
            if let Some(parent) = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
            {
                create_dir_all(parent)?;
            }
            let file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(path)?;
            let mut writer = BufWriter::new(file);
            writer.write_all(ClodWeldStatsRow::CSV_HEADER.as_bytes())?;
            writer.write_all(b"\n")?;
            self.writer = Some(writer);
        }

        Ok(self.writer.as_mut().expect("writer initialized"))
    }
}

fn env_flag(name: &str) -> bool {
    std::env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim(),
            "1" | "true" | "TRUE" | "yes" | "YES" | "on" | "ON"
        )
    })
}

fn env_f32(name: &str) -> Option<f32> {
    std::env::var(name).ok()?.trim().parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::pages::diagonal_polish::DiagonalPolishStats;
    use crate::voxel::pages::quadtree::ClodPageNode;
    use crate::voxel::pages::types::{PageFootprint, PageMesh};

    fn square_mesh() -> PageMesh {
        PageMesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [1.0, 0.0, 1.0],
                [0.0, 0.0, 1.0],
            ],
            normals: vec![[0.0, 1.0, 0.0]; 4],
            materials: vec![[1.0, 0.0, 0.0, 0.0]; 4],
            paint_slots: vec![0.0; 4],
            material_weight_stride: 4,
            indices: vec![0, 1, 2, 0, 2, 3],
        }
    }

    fn node(level: usize, coord: (i32, i32)) -> ClodPageNode {
        ClodPageNode {
            level,
            coord,
            footprint: PageFootprint {
                min_x: 0.0,
                min_z: 0.0,
                max_x: 1.0,
                max_z: 1.0,
            },
            mesh: square_mesh(),
            error_world: 0.0,
            low_benefit: false,
            polish: DiagonalPolishStats::default(),
        }
    }

    #[test]
    fn weld_csv_rows_include_every_node() {
        let tree = ClodPageTree {
            nodes_by_level: vec![vec![node(0, (0, 0))], vec![node(1, (0, 0))]],
            polish: DiagonalPolishStats::default(),
            revision: 7,
            page_coords: vec![(0, 0)],
            build_page_coords: vec![(0, 0)],
            status: Some(ClodPageBuildStatus::Ready),
        };

        let rows = weld_csv_rows(&tree, WeldStatsConfig::default());
        let lines: Vec<_> = rows.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("7,0,0,0,4,2,"));
        assert!(lines[1].starts_with("7,1,0,0,4,2,"));
    }

    #[test]
    fn env_flag_accepts_common_truthy_values() {
        unsafe {
            std::env::set_var("VOXEL_CLOD_WELD_TEST_FLAG", "yes");
        }
        assert!(env_flag("VOXEL_CLOD_WELD_TEST_FLAG"));
        unsafe {
            std::env::remove_var("VOXEL_CLOD_WELD_TEST_FLAG");
        }
    }
}
