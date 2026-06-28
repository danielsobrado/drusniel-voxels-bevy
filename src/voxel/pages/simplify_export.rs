//! Runtime CSV export for CLOD simplification diagnostics.
//!
//! `simplify_stats` is pure and cheap enough to run when a new page tree is
//! published. This module observes the published tree revision and writes one
//! row per page node so simplification regressions become CI-visible.

use std::fs::{File, OpenOptions, create_dir_all};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::quadtree::ClodPageNode;
use super::simplify_stats::{ClodSimplifyNodeStats, collect_simplify_stats};

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodSimplifyExportSettings {
    pub enabled: bool,
    pub path: PathBuf,
}

impl Default for ClodSimplifyExportSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_SIMPLIFY_CSV"),
            path: std::env::var("VOXEL_CLOD_SIMPLIFY_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-simplify.csv")),
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodSimplifyExportState {
    writer: Option<BufWriter<File>>,
    exported_revision: Option<u64>,
    disabled_after_error: bool,
}

pub(crate) fn clod_simplify_export_system(
    settings: Res<ClodSimplifyExportSettings>,
    mut state: ResMut<ClodSimplifyExportState>,
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

    let rows = simplify_csv_rows(tree.revision, &tree.nodes_by_level);
    match state.writer(&settings.path).and_then(|writer| {
        writer.write_all(rows.as_bytes())?;
        writer.flush()
    }) {
        Ok(()) => state.exported_revision = Some(tree.revision),
        Err(error) => {
            state.disabled_after_error = true;
            warn!(
                "failed to write CLOD simplify CSV {}: {error}",
                settings.path.display()
            );
        }
    }
}

pub(crate) fn simplify_csv_rows(revision: u64, nodes_by_level: &[Vec<ClodPageNode>]) -> String {
    let mut out = String::new();
    let stats = collect_simplify_stats(nodes_by_level);
    for node in stats.nodes {
        out.push_str(&node.csv_row(revision));
        out.push('\n');
    }
    out
}

impl ClodSimplifyExportState {
    fn writer(&mut self, path: &Path) -> std::io::Result<&mut BufWriter<File>> {
        if self.writer.is_none() {
            if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
                create_dir_all(parent)?;
            }
            let file = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(path)?;
            let mut writer = BufWriter::new(file);
            writer.write_all(ClodSimplifyNodeStats::csv_header().as_bytes())?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::pages::diagonal_polish::DiagonalPolishStats;
    use crate::voxel::pages::types::{PageFootprint, PageMesh};

    fn mesh(vertices: usize, triangles: usize) -> PageMesh {
        let mut m = PageMesh::default();
        m.positions = (0..vertices).map(|i| [i as f32, 0.0, 0.0]).collect();
        m.normals = vec![[0.0, 1.0, 0.0]; vertices];
        m.materials = vec![[1.0, 0.0, 0.0, 0.0]; vertices];
        m.paint_slots = vec![0.0; vertices];
        m.indices = (0..triangles * 3).map(|i| (i % vertices) as u32).collect();
        m
    }

    fn node(level: usize, coord: (i32, i32), vertices: usize, triangles: usize) -> ClodPageNode {
        ClodPageNode {
            level,
            coord,
            footprint: PageFootprint {
                min_x: 0.0,
                min_z: 0.0,
                max_x: 1.0,
                max_z: 1.0,
            },
            mesh: mesh(vertices, triangles),
            error_world: level as f32,
            low_benefit: false,
            polish: DiagonalPolishStats::default(),
        }
    }

    #[test]
    fn simplify_csv_rows_include_ratios() {
        let rows = simplify_csv_rows(
            7,
            &[
                vec![
                    node(0, (0, 0), 10, 12),
                    node(0, (1, 0), 10, 12),
                    node(0, (0, 1), 10, 12),
                    node(0, (1, 1), 10, 12),
                ],
                vec![node(1, (0, 0), 20, 24)],
            ],
        );

        let lines: Vec<_> = rows.lines().collect();
        assert_eq!(lines.len(), 5);
        assert_eq!(lines[0], "7,0,0,0,10,12,0,0,1.000000,1.000000,0.000000,false");
        assert_eq!(lines[4], "7,1,0,0,20,24,40,48,0.500000,0.500000,1.000000,false");
    }

    #[test]
    fn env_flag_accepts_common_truthy_values() {
        std::env::set_var("VOXEL_CLOD_SIMPLIFY_TEST_FLAG", "true");
        assert!(env_flag("VOXEL_CLOD_SIMPLIFY_TEST_FLAG"));
        std::env::remove_var("VOXEL_CLOD_SIMPLIFY_TEST_FLAG");
    }
}
