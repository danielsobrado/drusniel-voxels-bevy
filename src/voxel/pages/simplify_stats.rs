//! CLOD simplification diagnostics.
//!
//! This module is behavior-neutral: it reads a published quadtree and produces
//! guardable per-node simplification metrics. Runtime CSV wiring is kept in a
//! separate export module so the stats can be unit-tested without Bevy systems.

use super::quadtree::ClodPageNode;
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub struct ClodSimplifyNodeStats {
    pub level: usize,
    pub coord: (i32, i32),
    pub vertices: usize,
    pub triangles: usize,
    pub child_vertices: usize,
    pub child_triangles: usize,
    pub vertex_ratio: f32,
    pub triangle_ratio: f32,
    pub error_world: f32,
    pub low_benefit: bool,
}

impl ClodSimplifyNodeStats {
    pub fn csv_header() -> &'static str {
        "revision,level,x,z,vertices,triangles,child_vertices,child_triangles,vertex_ratio,triangle_ratio,error_world,low_benefit"
    }

    pub fn csv_row(&self, revision: u64) -> String {
        format!(
            "{revision},{},{},{},{},{},{},{},{:.6},{:.6},{:.6},{}",
            self.level,
            self.coord.0,
            self.coord.1,
            self.vertices,
            self.triangles,
            self.child_vertices,
            self.child_triangles,
            self.vertex_ratio,
            self.triangle_ratio,
            self.error_world,
            self.low_benefit,
        )
    }

    pub fn is_parent(&self) -> bool {
        self.level > 0
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClodSimplifyLevelStats {
    pub level: usize,
    pub nodes: usize,
    pub vertices: usize,
    pub triangles: usize,
    pub child_vertices: usize,
    pub child_triangles: usize,
    pub low_benefit_nodes: usize,
    pub max_error_world: f32,
    pub max_vertex_ratio: f32,
    pub max_triangle_ratio: f32,
}

impl ClodSimplifyLevelStats {
    pub fn low_benefit_fraction(&self) -> f32 {
        if self.nodes == 0 {
            0.0
        } else {
            self.low_benefit_nodes as f32 / self.nodes as f32
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ClodSimplifyTreeStats {
    pub nodes: Vec<ClodSimplifyNodeStats>,
    pub levels: Vec<ClodSimplifyLevelStats>,
}

impl ClodSimplifyTreeStats {
    pub fn parent_nodes(&self) -> impl Iterator<Item = &ClodSimplifyNodeStats> {
        self.nodes.iter().filter(|n| n.is_parent())
    }
}

/// Computes simplification stats for a published CLOD tree.
///
/// For level 0, ratios are reported as 1.0 because the page is the unsimplified
/// source cache. For parent nodes, ratios compare the parent mesh against the
/// sum of its 2x2 children at the previous level.
pub fn collect_simplify_stats(nodes_by_level: &[Vec<ClodPageNode>]) -> ClodSimplifyTreeStats {
    let mut nodes = Vec::new();
    let mut levels = Vec::new();

    let mut previous_index: HashMap<(i32, i32), (usize, usize)> = HashMap::new();

    for (level, level_nodes) in nodes_by_level.iter().enumerate() {
        let mut current_level = ClodSimplifyLevelStats {
            level,
            ..Default::default()
        };

        for node in level_nodes {
            let vertices = node.mesh.vertex_count();
            let triangles = node.mesh.triangle_count();

            let (child_vertices, child_triangles) = if level == 0 {
                (0, 0)
            } else {
                child_totals(node.coord, &previous_index)
            };

            let vertex_ratio = if child_vertices == 0 {
                1.0
            } else {
                vertices as f32 / child_vertices as f32
            };
            let triangle_ratio = if child_triangles == 0 {
                1.0
            } else {
                triangles as f32 / child_triangles as f32
            };

            let row = ClodSimplifyNodeStats {
                level,
                coord: node.coord,
                vertices,
                triangles,
                child_vertices,
                child_triangles,
                vertex_ratio,
                triangle_ratio,
                error_world: node.error_world,
                low_benefit: node.low_benefit,
            };

            current_level.nodes += 1;
            current_level.vertices += vertices;
            current_level.triangles += triangles;
            current_level.child_vertices += child_vertices;
            current_level.child_triangles += child_triangles;
            if row.low_benefit {
                current_level.low_benefit_nodes += 1;
            }
            current_level.max_error_world = current_level.max_error_world.max(row.error_world);
            current_level.max_vertex_ratio = current_level.max_vertex_ratio.max(row.vertex_ratio);
            current_level.max_triangle_ratio = current_level.max_triangle_ratio.max(row.triangle_ratio);

            nodes.push(row);
        }

        let mut next_index = HashMap::with_capacity(level_nodes.len());
        for node in level_nodes {
            next_index.insert(
                node.coord,
                (node.mesh.vertex_count(), node.mesh.triangle_count()),
            );
        }
        previous_index = next_index;
        levels.push(current_level);
    }

    ClodSimplifyTreeStats { nodes, levels }
}

fn child_totals(parent_coord: (i32, i32), previous_index: &HashMap<(i32, i32), (usize, usize)>) -> (usize, usize) {
    let child_coords = [
        (parent_coord.0 * 2, parent_coord.1 * 2),
        (parent_coord.0 * 2 + 1, parent_coord.1 * 2),
        (parent_coord.0 * 2, parent_coord.1 * 2 + 1),
        (parent_coord.0 * 2 + 1, parent_coord.1 * 2 + 1),
    ];

    let mut vertices = 0usize;
    let mut triangles = 0usize;
    for coord in child_coords {
        if let Some((v, t)) = previous_index.get(&coord).copied() {
            vertices += v;
            triangles += t;
        }
    }
    (vertices, triangles)
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
        m.indices = (0..triangles * 3).map(|i| (i % vertices) as u32).collect();
        m
    }

    fn node(level: usize, coord: (i32, i32), vertices: usize, triangles: usize) -> ClodPageNode {
        ClodPageNode {
            level,
            coord,
            footprint: PageFootprint { min_x: 0.0, min_z: 0.0, max_x: 1.0, max_z: 1.0 },
            mesh: mesh(vertices, triangles),
            error_world: level as f32,
            low_benefit: false,
            polish: DiagonalPolishStats::default(),
        }
    }

    #[test]
    fn computes_parent_ratios_from_children() {
        let tree = vec![
            vec![
                node(0, (0, 0), 10, 12),
                node(0, (1, 0), 10, 12),
                node(0, (0, 1), 10, 12),
                node(0, (1, 1), 10, 12),
            ],
            vec![node(1, (0, 0), 20, 24)],
        ];

        let stats = collect_simplify_stats(&tree);
        let parent = stats.parent_nodes().next().unwrap();
        assert_eq!(parent.child_vertices, 40);
        assert_eq!(parent.child_triangles, 48);
        assert!((parent.vertex_ratio - 0.5).abs() < 1e-6);
        assert!((parent.triangle_ratio - 0.5).abs() < 1e-6);
    }
}

