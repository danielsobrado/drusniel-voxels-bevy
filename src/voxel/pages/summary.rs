//! Shared coarse terrain summary (LV-1b) for far shell, shadow proxy, and canopy.

use bevy::prelude::*;
use bevy::tasks::{AsyncComputeTaskPool, Task, block_on, poll_once};

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::config::TerrainSummaryCfg;
use super::selection::{ClodPageNodeKey, ClodPageSelectionIndex};
use super::types::PageFootprint;
use crate::voxel::terrain::TerrainGenerator;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SummaryCell {
    pub height: f32,
    pub coverage: f32,
    pub normal: [f32; 3],
    pub from_page: bool,
}

#[derive(Clone, Debug)]
struct SummaryNodeSnapshot {
    level: usize,
    footprint: PageFootprint,
    surface_y: f32,
}

#[derive(Resource, Debug)]
pub struct TerrainSummaryField {
    pub grid: usize,
    pub cell_size_m: f32,
    pub origin_x: f32,
    pub origin_z: f32,
    cells: Vec<SummaryCell>,
    pub revision: Option<u64>,
}

impl Default for TerrainSummaryField {
    fn default() -> Self {
        Self {
            grid: 0,
            cell_size_m: 1.0,
            origin_x: 0.0,
            origin_z: 0.0,
            cells: Vec::new(),
            revision: None,
        }
    }
}

fn procedural_macro_height(world_x: f32, world_z: f32) -> f32 {
    TerrainGenerator::default().get_height(world_x.floor() as i32, world_z.floor() as i32) as f32
}

impl TerrainSummaryField {
    pub fn cell(&self, x: usize, z: usize) -> Option<SummaryCell> {
        if self.grid == 0 || x >= self.grid || z >= self.grid {
            return None;
        }
        self.cells.get(z * self.grid + x).copied()
    }

    pub fn sample_height(&self, world_x: f32, world_z: f32) -> f32 {
        self.sample_cell(world_x, world_z).height
    }

    pub fn sample_normal(&self, world_x: f32, world_z: f32) -> [f32; 3] {
        self.sample_cell(world_x, world_z).normal
    }

    pub fn sample_coverage(&self, world_x: f32, world_z: f32) -> f32 {
        self.sample_cell(world_x, world_z).coverage
    }

    fn sample_cell(&self, world_x: f32, world_z: f32) -> SummaryCell {
        if self.grid == 0 || self.cells.is_empty() {
            return procedural_summary_cell(world_x, world_z);
        }
        let fx = (world_x - self.origin_x) / self.cell_size_m;
        let fz = (world_z - self.origin_z) / self.cell_size_m;
        if fx < 0.0 || fz < 0.0 {
            return procedural_summary_cell(world_x, world_z);
        }
        let x = fx.floor() as usize;
        let z = fz.floor() as usize;
        self.cell(x, z)
            .unwrap_or_else(|| procedural_summary_cell(world_x, world_z))
    }
}

fn procedural_summary_cell(world_x: f32, world_z: f32) -> SummaryCell {
    SummaryCell {
        height: procedural_macro_height(world_x, world_z),
        coverage: 0.0,
        normal: [0.0, 1.0, 0.0],
        from_page: false,
    }
}

#[derive(Resource, Default)]
pub(crate) struct TerrainSummaryRebuildState {
    pending_revision: Option<u64>,
    debounce_frames: u32,
    task: Option<Task<TerrainSummaryField>>,
}

fn snapshot_nodes(index: &ClodPageSelectionIndex) -> Vec<SummaryNodeSnapshot> {
    index
        .nodes()
        .map(|node| SummaryNodeSnapshot {
            level: node.key.level,
            footprint: node.footprint,
            surface_y: node.mesh_bounds.max_y,
        })
        .collect()
}

fn finest_surface_at(nodes: &[SummaryNodeSnapshot], world_x: f32, world_z: f32) -> Option<f32> {
    let mut best: Option<(usize, f32)> = None;
    for node in nodes {
        if !node.footprint.contains_point(world_x, world_z) {
            continue;
        }
        match best {
            None => best = Some((node.level, node.surface_y)),
            Some((best_level, _)) if node.level < best_level => {
                best = Some((node.level, node.surface_y));
            }
            _ => {}
        }
    }
    best.map(|(_, surface_y)| surface_y)
}

fn finite_difference_normal(
    heights: &[SummaryCell],
    grid: usize,
    x: usize,
    z: usize,
    cell_size_m: f32,
) -> [f32; 3] {
    let west_x = x.saturating_sub(1);
    let east_x = (x + 1).min(grid - 1);
    let north_z = z.saturating_sub(1);
    let south_z = (z + 1).min(grid - 1);
    let center = heights[z * grid + x].height;
    let west = heights[z * grid + west_x].height;
    let east = heights[z * grid + east_x].height;
    let north = heights[north_z * grid + x].height;
    let south = heights[south_z * grid + x].height;
    let dx = if x == 0 {
        (east - center) / cell_size_m
    } else if x + 1 == grid {
        (center - west) / cell_size_m
    } else {
        (east - west) / (2.0 * cell_size_m)
    };
    let dz = if z == 0 {
        (south - center) / cell_size_m
    } else if z + 1 == grid {
        (center - north) / cell_size_m
    } else {
        (south - north) / (2.0 * cell_size_m)
    };
    let normal = Vec3::new(-dx, 1.0, -dz).normalize_or_zero();
    [normal.x, normal.y, normal.z]
}

pub fn build_terrain_summary_field(
    nodes: &[SummaryNodeSnapshot],
    cfg: &TerrainSummaryCfg,
    revision: u64,
) -> TerrainSummaryField {
    let cell_size_m = cfg.cell_size_m.max(1.0);
    let max_grid = cfg.grid.max(1);
    if nodes.is_empty() {
        return TerrainSummaryField {
            cell_size_m,
            revision: Some(revision),
            ..Default::default()
        };
    }

    let min_x = nodes
        .iter()
        .map(|node| node.footprint.min_x)
        .fold(f32::INFINITY, f32::min);
    let min_z = nodes
        .iter()
        .map(|node| node.footprint.min_z)
        .fold(f32::INFINITY, f32::min);
    let max_x = nodes
        .iter()
        .map(|node| node.footprint.max_x)
        .fold(f32::NEG_INFINITY, f32::max);
    let max_z = nodes
        .iter()
        .map(|node| node.footprint.max_z)
        .fold(f32::NEG_INFINITY, f32::max);

    let span_x = (max_x - min_x).max(cell_size_m);
    let span_z = (max_z - min_z).max(cell_size_m);
    let grid_x = ((span_x / cell_size_m).ceil() as usize).max(1);
    let grid_z = ((span_z / cell_size_m).ceil() as usize).max(1);
    let grid = grid_x.max(grid_z).min(max_grid);
    let origin_x = min_x;
    let origin_z = min_z;

    let mut cells = Vec::with_capacity(grid * grid);
    for z in 0..grid {
        for x in 0..grid {
            let world_x = origin_x + (x as f32 + 0.5) * cell_size_m;
            let world_z = origin_z + (z as f32 + 0.5) * cell_size_m;
            let cell = if let Some(height) = finest_surface_at(nodes, world_x, world_z) {
                SummaryCell {
                    height,
                    coverage: 0.0,
                    normal: [0.0, 1.0, 0.0],
                    from_page: true,
                }
            } else {
                procedural_summary_cell(world_x, world_z)
            };
            cells.push(cell);
        }
    }

    for z in 0..grid {
        for x in 0..grid {
            let idx = z * grid + x;
            if cells[idx].from_page {
                cells[idx].normal = finite_difference_normal(&cells, grid, x, z, cell_size_m);
            }
        }
    }

    TerrainSummaryField {
        grid,
        cell_size_m,
        origin_x,
        origin_z,
        cells,
        revision: Some(revision),
    }
}

pub(crate) fn terrain_summary_rebuild_system(
    runtime: Res<super::runtime::ClodPagesRuntime>,
    tree: Res<ClodPageTree>,
    index: Res<ClodPageSelectionIndex>,
    mut field: ResMut<TerrainSummaryField>,
    mut state: ResMut<TerrainSummaryRebuildState>,
) {
    if !runtime.enabled {
        return;
    }

    if let Some(mut task) = state.task.take() {
        match block_on(poll_once(&mut task)) {
            Some(built) => {
                *field = built;
                state.pending_revision = None;
            }
            None => state.task = Some(task),
        }
        return;
    }

    if !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready)) {
        state.pending_revision = None;
        state.debounce_frames = 0;
        return;
    }

    if field.revision == Some(tree.revision) {
        return;
    }

    if state.pending_revision != Some(tree.revision) {
        state.pending_revision = Some(tree.revision);
        state.debounce_frames = runtime.cfg.terrain_summary.rebuild_debounce_frames;
    }
    if state.debounce_frames > 0 {
        state.debounce_frames -= 1;
        return;
    }

    let nodes = snapshot_nodes(&index);
    let cfg = runtime.cfg.terrain_summary.clone();
    let revision = tree.revision;
    state.task = Some(AsyncComputeTaskPool::get().spawn(async move {
        build_terrain_summary_field(&nodes, &cfg, revision)
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::pages::build_queue::ClodPageTree;
    use crate::voxel::pages::config::ClodPagesConfig;
    use crate::voxel::pages::quadtree::build_quadtree;
    use crate::voxel::pages::render::ClodPageMeshBounds;
    use crate::voxel::pages::selection::ClodPageSelectionIndex;
    use crate::voxel::pages::source_mesh::PageSource;
    use crate::voxel::pages::synthetic::build_lod0_world;
    use std::collections::HashMap;

    fn tree_from_lod0(lod0: Vec<((i32, i32), PageSource)>, cfg: &ClodPagesConfig) -> ClodPageTree {
        let result = build_quadtree(lod0, cfg).expect("quadtree build");
        ClodPageTree {
            nodes_by_level: result.nodes_by_level,
            polish: result.polish,
            revision: 1,
            page_coords: vec![],
            build_page_coords: vec![],
            status: Some(ClodPageBuildStatus::Ready),
        }
    }

    fn index_for_tree(tree: &ClodPageTree) -> ClodPageSelectionIndex {
        let mut bounds_by_node = HashMap::new();
        for level_nodes in &tree.nodes_by_level {
            for node in level_nodes {
                let key = ClodPageNodeKey::new(node.level, node.coord);
                let max_y = node
                    .mesh
                    .positions
                    .iter()
                    .map(|position| position[1])
                    .fold(f32::NEG_INFINITY, f32::max);
                let min_y = node
                    .mesh
                    .positions
                    .iter()
                    .map(|position| position[1])
                    .fold(f32::INFINITY, f32::min);
                bounds_by_node.insert(
                    key,
                    ClodPageMeshBounds {
                        min_y,
                        max_y,
                    },
                );
            }
        }
        let mut index = ClodPageSelectionIndex::default();
        index.rebuild(tree, &bounds_by_node);
        index
    }

    #[test]
    fn summary_height_matches_page_surface_over_covered_cells() {
        let cfg = ClodPagesConfig::load();
        let lod0 = build_lod0_world(2, 2, &cfg).expect("lod0");
        let tree = tree_from_lod0(lod0, &cfg);
        let index = index_for_tree(&tree);
        let nodes = snapshot_nodes(&index);
        let field = build_terrain_summary_field(&nodes, &cfg.terrain_summary, tree.revision);

        let sample_x = 32.0;
        let sample_z = 32.0;
        let expected = finest_surface_at(&nodes, sample_x, sample_z).expect("covered cell");
        let sampled = field.sample_height(sample_x, sample_z);
        assert!(
            (sampled - expected).abs() < 1.0,
            "sampled {sampled} expected ~{expected}"
        );
    }

    #[test]
    fn finest_node_wins_over_coarser_parent() {
        let fine = SummaryNodeSnapshot {
            level: 0,
            footprint: PageFootprint {
                min_x: 0.0,
                min_z: 0.0,
                max_x: 64.0,
                max_z: 64.0,
            },
            surface_y: 12.0,
        };
        let coarse = SummaryNodeSnapshot {
            level: 1,
            footprint: PageFootprint {
                min_x: 0.0,
                min_z: 0.0,
                max_x: 128.0,
                max_z: 128.0,
            },
            surface_y: 40.0,
        };
        assert_eq!(finest_surface_at(&[coarse, fine], 32.0, 32.0), Some(12.0));
    }

    #[test]
    fn procedural_fallback_is_finite_outside_page_coverage() {
        let field = TerrainSummaryField::default();
        let height = field.sample_height(12_345.0, 67_890.0);
        assert!(height.is_finite());
        assert!(!height.is_nan());
    }

    #[test]
    fn rebuild_tracks_tree_revision() {
        let cfg = ClodPagesConfig::load();
        let lod0 = build_lod0_world(2, 2, &cfg).expect("lod0");
        let tree = tree_from_lod0(lod0, &cfg);
        let index = index_for_tree(&tree);
        let field = build_terrain_summary_field(
            &snapshot_nodes(&index),
            &cfg.terrain_summary,
            tree.revision,
        );
        assert_eq!(field.revision, Some(1));
    }
}
