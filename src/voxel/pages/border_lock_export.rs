//! Runtime CSV export for CLOD border-lock diagnostics.
//!
//! `border_lock_stats` is pure and cheap enough to run when a new page tree is
//! published. This module observes the published tree revision and writes one
//! row per page node so seam-related regressions become CI-visible.

use std::fs::{File, OpenOptions, create_dir_all};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use bevy::prelude::*;

use super::border_lock_stats::{ClodBorderLockStats, border_lock_stats};
use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::quadtree::ClodPageNode;

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodBorderLockExportSettings {
    pub enabled: bool,
    pub path: PathBuf,
}

impl Default for ClodBorderLockExportSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_BORDER_LOCK_CSV"),
            path: std::env::var("VOXEL_CLOD_BORDER_LOCK_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-border-locks.csv")),
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodBorderLockExportState {
    writer: Option<BufWriter<File>>,
    exported_revision: Option<u64>,
    frame: u64,
    disabled_after_error: bool,
}

pub(crate) fn clod_border_lock_export_system(
    settings: Res<ClodBorderLockExportSettings>,
    mut state: ResMut<ClodBorderLockExportState>,
    tree: Res<ClodPageTree>,
) {
    state.frame = state.frame.wrapping_add(1);

    if !settings.enabled || state.disabled_after_error {
        return;
    }
    if !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready)) {
        return;
    }
    if state.exported_revision == Some(tree.revision) {
        return;
    }

    let rows = border_lock_csv_rows(state.frame, &tree.nodes_by_level);
    match state.writer(&settings.path).and_then(|writer| {
        writer.write_all(rows.as_bytes())?;
        writer.flush()
    }) {
        Ok(()) => state.exported_revision = Some(tree.revision),
        Err(error) => {
            state.disabled_after_error = true;
            warn!(
                "failed to write CLOD border-lock CSV {}: {error}",
                settings.path.display()
            );
        }
    }
}

pub(crate) fn border_lock_csv_rows(frame: u64, nodes_by_level: &[Vec<ClodPageNode>]) -> String {
    let mut out = String::new();
    for nodes in nodes_by_level {
        for node in nodes {
            let stats = border_lock_stats(node.level, node.coord, &node.mesh);
            out.push_str(&stats.to_csv_record(frame));
        }
    }
    out
}

impl ClodBorderLockExportState {
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
            writer.write_all(ClodBorderLockStats::csv_header().as_bytes())?;
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

    fn square_mesh() -> PageMesh {
        let mut mesh = PageMesh::default();
        mesh.positions = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
        ];
        mesh.indices = vec![0, 1, 2, 0, 2, 3];
        mesh
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
    fn border_lock_csv_rows_include_every_node() {
        let rows = border_lock_csv_rows(42, &[vec![node(0, (0, 0))], vec![node(1, (0, 0))]]);
        let lines: Vec<_> = rows.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0], "42,0,0,0,4,2,4,4,1.000000,0.500000");
        assert_eq!(lines[1], "42,1,0,0,4,2,4,4,1.000000,0.500000");
    }

    #[test]
    fn env_flag_accepts_common_truthy_values() {
        unsafe { std::env::set_var("VOXEL_CLOD_BORDER_LOCK_TEST_FLAG", "yes"); }
        assert!(env_flag("VOXEL_CLOD_BORDER_LOCK_TEST_FLAG"));
        unsafe { std::env::remove_var("VOXEL_CLOD_BORDER_LOCK_TEST_FLAG"); }
    }
}
