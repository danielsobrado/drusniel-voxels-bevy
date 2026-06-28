//! Runtime CSV export for CLOD topology diagnostics.
//!
//! `topology_stats` is pure and cheap enough to run when a new page tree is
//! published. This module observes the published tree revision and writes one
//! row per page node so topology regressions become CI-visible.

use std::fs::{File, OpenOptions, create_dir_all};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::quadtree::ClodPageNode;
use super::topology_stats::{ClodTopologyStats, compute_topology_stats};

#[derive(Resource, Clone, Debug)]
pub(crate) struct ClodTopologyExportSettings {
    pub enabled: bool,
    pub path: PathBuf,
}

impl Default for ClodTopologyExportSettings {
    fn default() -> Self {
        Self {
            enabled: env_flag("VOXEL_CLOD_TOPOLOGY_CSV"),
            path: std::env::var("VOXEL_CLOD_TOPOLOGY_CSV_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("perf-dumps/clod-topology.csv")),
        }
    }
}

#[derive(Resource, Debug, Default)]
pub(crate) struct ClodTopologyExportState {
    writer: Option<BufWriter<File>>,
    exported_revision: Option<u64>,
    frame: u64,
    disabled_after_error: bool,
}

pub(crate) fn clod_topology_export_system(
    settings: Res<ClodTopologyExportSettings>,
    mut state: ResMut<ClodTopologyExportState>,
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

    let rows = topology_csv_rows(state.frame, tree.revision, &tree.nodes_by_level);
    match state.writer(&settings.path).and_then(|writer| {
        writer.write_all(rows.as_bytes())?;
        writer.flush()
    }) {
        Ok(()) => state.exported_revision = Some(tree.revision),
        Err(error) => {
            state.disabled_after_error = true;
            warn!(
                "failed to write CLOD topology CSV {}: {error}",
                settings.path.display()
            );
        }
    }
}

pub(crate) fn topology_csv_rows(
    frame: u64,
    revision: u64,
    nodes_by_level: &[Vec<ClodPageNode>],
) -> String {
    let mut out = String::new();
    for nodes in nodes_by_level {
        for node in nodes {
            let stats = compute_topology_stats(&node.mesh);
            out.push_str(&stats.to_csv_record(
                frame,
                revision,
                node.level as u8,
                node.coord.0,
                node.coord.1,
            ));
            out.push('\n');
        }
    }
    out
}

impl ClodTopologyExportState {
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
            writer.write_all(ClodTopologyStats::csv_header().as_bytes())?;
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

    fn square_mesh() -> PageMesh {
        let mut mesh = PageMesh::default();
        mesh.positions = vec![
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 0.0, 1.0],
            [0.0, 0.0, 1.0],
        ];
        mesh.normals = vec![[0.0, 1.0, 0.0]; 4];
        mesh.materials = vec![[1.0, 0.0, 0.0, 0.0]; 4];
        mesh.paint_slots = vec![0.0; 4];
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
    fn topology_csv_rows_include_every_node() {
        let rows = topology_csv_rows(42, 7, &[vec![node(0, (0, 0))], vec![node(1, (0, 0))]]);
        let lines: Vec<_> = rows.lines().collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(
            lines[0],
            "42,7,0,0,0,4,2,4,0,0,0,0,0,0,0,false,false,false,true"
        );
        assert_eq!(
            lines[1],
            "42,7,1,0,0,4,2,4,0,0,0,0,0,0,0,false,false,false,true"
        );
    }

    #[test]
    fn env_flag_accepts_common_truthy_values() {
        std::env::set_var("VOXEL_CLOD_TOPOLOGY_TEST_FLAG", "on");
        assert!(env_flag("VOXEL_CLOD_TOPOLOGY_TEST_FLAG"));
        std::env::remove_var("VOXEL_CLOD_TOPOLOGY_TEST_FLAG");
    }
}
