//! CLOD weld/seam diagnostics.

use std::collections::HashMap;

use super::build_queue::ClodPageTree;
use super::types::PageMesh;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ClodWeldStatsRow {
    pub revision: u64,
    pub level: usize,
    pub page_x: i32,
    pub page_z: i32,
    pub vertices: usize,
    pub triangles: usize,
    pub unique_position_buckets: usize,
    pub duplicate_position_groups: usize,
    pub duplicate_vertices: usize,
    pub border_vertices: usize,
    pub open_boundary_edges: usize,
    pub max_normal_delta: f32,
    pub max_material_delta: f32,
    pub max_paint_delta: f32,
}

impl ClodWeldStatsRow {
    pub const CSV_HEADER: &'static str = "revision,level,page_x,page_z,vertices,triangles,unique_position_buckets,duplicate_position_groups,duplicate_vertices,border_vertices,open_boundary_edges,max_normal_delta,max_material_delta,max_paint_delta";

    pub fn to_csv_line(self) -> String {
        format!(
            "{},{},{},{},{},{},{},{},{},{},{},{:.8},{:.8},{:.8}",
            self.revision,
            self.level,
            self.page_x,
            self.page_z,
            self.vertices,
            self.triangles,
            self.unique_position_buckets,
            self.duplicate_position_groups,
            self.duplicate_vertices,
            self.border_vertices,
            self.open_boundary_edges,
            self.max_normal_delta,
            self.max_material_delta,
            self.max_paint_delta,
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WeldStatsConfig {
    pub position_epsilon: f32,
    pub border_epsilon: f32,
}

impl Default for WeldStatsConfig {
    fn default() -> Self {
        Self {
            position_epsilon: 1.0e-5,
            border_epsilon: 1.0e-4,
        }
    }
}

fn quant_key(p: [f32; 3], epsilon: f32) -> (i64, i64, i64) {
    let inv = if epsilon > 0.0 { epsilon.recip() } else { 1.0 };
    (
        (p[0] * inv).round() as i64,
        (p[1] * inv).round() as i64,
        (p[2] * inv).round() as i64,
    )
}

fn edge_key(a: u32, b: u32) -> (u32, u32) {
    if a <= b { (a, b) } else { (b, a) }
}

fn open_boundary_edges(mesh: &PageMesh) -> usize {
    let mut counts: HashMap<(u32, u32), u32> = HashMap::new();
    for tri in mesh.indices.chunks_exact(3) {
        *counts.entry(edge_key(tri[0], tri[1])).or_default() += 1;
        *counts.entry(edge_key(tri[1], tri[2])).or_default() += 1;
        *counts.entry(edge_key(tri[2], tri[0])).or_default() += 1;
    }
    counts.values().filter(|&&count| count == 1).count()
}

fn is_border_vertex(p: [f32; 3], min_x: f32, max_x: f32, min_z: f32, max_z: f32, eps: f32) -> bool {
    (p[0] - min_x).abs() <= eps
        || (p[0] - max_x).abs() <= eps
        || (p[2] - min_z).abs() <= eps
        || (p[2] - max_z).abs() <= eps
}

pub fn analyze_page_weld_stats(
    revision: u64,
    level: usize,
    coord: (i32, i32),
    mesh: &PageMesh,
    footprint_min_x: f32,
    footprint_max_x: f32,
    footprint_min_z: f32,
    footprint_max_z: f32,
    cfg: WeldStatsConfig,
) -> ClodWeldStatsRow {
    let mut buckets: HashMap<(i64, i64, i64), Vec<usize>> = HashMap::new();
    for (i, &p) in mesh.positions.iter().enumerate() {
        buckets
            .entry(quant_key(p, cfg.position_epsilon))
            .or_default()
            .push(i);
    }

    let mut duplicate_position_groups = 0usize;
    let mut duplicate_vertices = 0usize;
    let mut max_normal_delta = 0.0f32;
    let mut max_material_delta = 0.0f32;
    let mut max_paint_delta = 0.0f32;
    let material_weights = mesh.material_weights();
    let stride = mesh.material_weight_stride();

    for indices in buckets.values() {
        if indices.len() <= 1 {
            continue;
        }
        duplicate_position_groups += 1;
        duplicate_vertices += indices.len() - 1;
        let base = indices[0];
        for &idx in indices.iter().skip(1) {
            if base < mesh.normals.len() && idx < mesh.normals.len() {
                let a = mesh.normals[base];
                let b = mesh.normals[idx];
                let dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).clamp(-1.0, 1.0);
                max_normal_delta = max_normal_delta.max(1.0 - dot);
            }
            if base < mesh.paint_slots.len() && idx < mesh.paint_slots.len() {
                max_paint_delta =
                    max_paint_delta.max((mesh.paint_slots[base] - mesh.paint_slots[idx]).abs());
            }
            for channel in 0..stride {
                let a = base * stride + channel;
                let b = idx * stride + channel;
                if a < material_weights.len() && b < material_weights.len() {
                    max_material_delta =
                        max_material_delta.max((material_weights[a] - material_weights[b]).abs());
                }
            }
        }
    }

    let border_vertices = mesh
        .positions
        .iter()
        .filter(|&&p| {
            is_border_vertex(
                p,
                footprint_min_x,
                footprint_max_x,
                footprint_min_z,
                footprint_max_z,
                cfg.border_epsilon,
            )
        })
        .count();

    ClodWeldStatsRow {
        revision,
        level,
        page_x: coord.0,
        page_z: coord.1,
        vertices: mesh.vertex_count(),
        triangles: mesh.triangle_count(),
        unique_position_buckets: buckets.len(),
        duplicate_position_groups,
        duplicate_vertices,
        border_vertices,
        open_boundary_edges: open_boundary_edges(mesh),
        max_normal_delta,
        max_material_delta,
        max_paint_delta,
    }
}

pub fn collect_tree_weld_stats(tree: &ClodPageTree, cfg: WeldStatsConfig) -> Vec<ClodWeldStatsRow> {
    let mut rows = Vec::new();
    for (level, nodes) in tree.nodes_by_level.iter().enumerate() {
        for node in nodes {
            rows.push(analyze_page_weld_stats(
                tree.revision,
                level,
                node.coord,
                &node.mesh,
                node.footprint.min_x,
                node.footprint.max_x,
                node.footprint.min_z,
                node.footprint.max_z,
                cfg,
            ));
        }
    }
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny_mesh() -> PageMesh {
        PageMesh {
            positions: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0],
                [0.0, 0.0, 0.0],
            ],
            normals: vec![
                [0.0, 1.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 1.0, 0.0],
                [0.0, 0.5, 0.5],
            ],
            materials: vec![[1.0, 0.0, 0.0, 0.0]; 4],
            paint_slots: vec![0.0, 0.0, 0.0, 1.0],
            material_weight_stride: 4,
            indices: vec![0, 1, 2],
        }
    }

    #[test]
    fn duplicate_bucket_reports_conflict_deltas() {
        let row = analyze_page_weld_stats(
            7,
            0,
            (1, 2),
            &tiny_mesh(),
            0.0,
            1.0,
            0.0,
            1.0,
            WeldStatsConfig::default(),
        );
        assert_eq!(row.duplicate_position_groups, 1);
        assert_eq!(row.duplicate_vertices, 1);
        assert!(row.max_normal_delta > 0.0);
        assert_eq!(row.max_paint_delta, 1.0);
    }
}
