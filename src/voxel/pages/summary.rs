//! Shared coarse terrain summary (LV-1b) for far shell, shadow proxy, and canopy.

use bevy::prelude::*;

use super::build_queue::{ClodPageBuildStatus, ClodPageTree};
use super::config::TerrainSummaryCfg;
use super::quadtree::ClodPageNode;
use super::types::PageFootprint;
use crate::voxel::terrain::TerrainGenerator;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SummaryCell {
    pub height: f32,
    pub coverage: f32,
    pub normal: [f32; 3],
}

#[derive(Resource, Clone, Debug)]
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

#[derive(Resource, Default)]
pub(crate) struct TerrainSummaryRebuildState {
    pending_revision: Option<u64>,
    debounce_frames: u32,
}

fn footprint_contains_point(footprint: PageFootprint, world_x: f32, world_z: f32) -> bool {
    world_x >= footprint.min_x
        && world_x < footprint.max_x
        && world_z >= footprint.min_z
        && world_z < footprint.max_z
}

fn node_surface_height(node: &ClodPageNode) -> f32 {
    node.mesh
        .positions
        .iter()
        .map(|position| position[1])
        .fold(f32::NEG_INFINITY, f32::max)
}

fn procedural_macro_height(world_x: f32, world_z: f32) -> f32 {
    TerrainGenerator::default().get_height(world_x.floor() as i32, world_z.floor() as i32) as f32
}

fn procedural_summary_cell(world_x: f32, world_z: f32) -> SummaryCell {
    SummaryCell {
        height: procedural_macro_height(world_x, world_z),
        coverage: 0.0,
        normal: [0.0, 1.0, 0.0],
    }
}

pub fn build_terrain_summary_field(
    tree: &ClodPageTree,
    cfg: &TerrainSummaryCfg,
) -> TerrainSummaryField {
    let grid = cfg.grid.max(1);
    let cell_size_m = cfg.cell_size_m.max(1.0);
    let nodes: Vec<&ClodPageNode> = tree.nodes_by_level.iter().flatten().collect();
    if nodes.is_empty() {
        return TerrainSummaryField {
            grid,
            cell_size_m,
            revision: Some(tree.revision),
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
    let origin_x = min_x;
    let origin_z = min_z;
    let extent_x = ((span_x / cell_size_m).ceil() as usize).max(grid);
    let extent_z = ((span_z / cell_size_m).ceil() as usize).max(grid);
    let grid = extent_x.max(extent_z).max(grid);

    let mut cells = Vec::with_capacity(grid * grid);
    for z in 0..grid {
        for x in 0..grid {
            let world_x = origin_x + (x as f32 + 0.5) * cell_size_m;
            let world_z = origin_z + (z as f32 + 0.5) * cell_size_m;
            let mut covered = false;
            let mut height = f32::NEG_INFINITY;
            for node in &nodes {
                if footprint_contains_point(node.footprint, world_x, world_z) {
                    covered = true;
                    height = height.max(node_surface_height(node));
                }
            }
            let cell = if covered && height.is_finite() {
                SummaryCell {
                    height,
                    coverage: 0.0,
                    normal: [0.0, 1.0, 0.0],
                }
            } else {
                procedural_summary_cell(world_x, world_z)
            };
            cells.push(cell);
        }
    }

    TerrainSummaryField {
        grid,
        cell_size_m,
        origin_x,
        origin_z,
        cells,
        revision: Some(tree.revision),
    }
}

pub(crate) fn terrain_summary_rebuild_system(
    runtime: Res<super::runtime::ClodPagesRuntime>,
    tree: Res<ClodPageTree>,
    mut field: ResMut<TerrainSummaryField>,
    mut state: ResMut<TerrainSummaryRebuildState>,
) {
    if !runtime.enabled {
        return;
    }
    if !matches!(tree.status.as_ref(), Some(ClodPageBuildStatus::Ready)) {
        state.pending_revision = None;
        state.debounce_frames = 0;
        return;
    }

    if field.revision != Some(tree.revision) {
        if state.pending_revision != Some(tree.revision) {
            state.pending_revision = Some(tree.revision);
            state.debounce_frames = runtime.cfg.terrain_summary.rebuild_debounce_frames;
        }
        if state.debounce_frames > 0 {
            state.debounce_frames -= 1;
            return;
        }
        *field = build_terrain_summary_field(&tree, &runtime.cfg.terrain_summary);
        state.pending_revision = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::voxel::pages::config::ClodPagesConfig;
    use crate::voxel::pages::diagonal_polish::DiagonalPolishStats;
    use crate::voxel::pages::quadtree::build_quadtree;
    use crate::voxel::pages::source_mesh::PageSource;
    use crate::voxel::pages::synthetic::build_lod0_world;

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

    #[test]
    fn summary_height_matches_page_surface_over_covered_cells() {
        let cfg = ClodPagesConfig::load();
        let lod0 = build_lod0_world(2, 2, &cfg).expect("lod0");
        let tree = tree_from_lod0(lod0, &cfg);
        let field = build_terrain_summary_field(&tree, &cfg.terrain_summary);

        let sample_x = 32.0;
        let sample_z = 32.0;
        let expected = tree.nodes_by_level[0]
            .iter()
            .filter(|node| footprint_contains_point(node.footprint, sample_x, sample_z))
            .map(node_surface_height)
            .fold(f32::NEG_INFINITY, f32::max);
        assert!(expected.is_finite());
        let sampled = field.sample_height(sample_x, sample_z);
        assert!(
            (sampled - expected).abs() < 8.0,
            "sampled {sampled} expected ~{expected}"
        );
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
        let field = build_terrain_summary_field(&tree, &cfg.terrain_summary);
        assert_eq!(field.revision, Some(1));
    }
}
