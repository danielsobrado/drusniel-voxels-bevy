//! CLOD page mesh topology diagnostics.
//!
//! These checks are intentionally cheap and deterministic. Builder validation
//! still owns hard correctness checks; this module converts page mesh invariants
//! into telemetry rows that benches can guard.

use std::collections::{HashMap, HashSet};

use super::types::PageMesh;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClodTopologyStats {
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub boundary_edges: usize,
    pub non_manifold_edges: usize,
    pub invalid_indices: usize,
    pub repeated_index_triangles: usize,
    pub zero_area_triangles: usize,
    pub duplicate_triangles: usize,
    pub orphan_vertices: usize,
    pub non_finite_positions: usize,
    pub normal_count_mismatch: bool,
    pub material_count_mismatch: bool,
    pub paint_count_mismatch: bool,
}

impl ClodTopologyStats {
    pub fn passed(&self) -> bool {
        self.invalid_indices == 0
            && self.repeated_index_triangles == 0
            && self.zero_area_triangles == 0
            && self.duplicate_triangles == 0
            && self.non_manifold_edges == 0
            && self.non_finite_positions == 0
            && !self.normal_count_mismatch
            && !self.material_count_mismatch
    }

    pub fn csv_header() -> &'static str {
        "frame,revision,level,x,z,vertex_count,triangle_count,boundary_edges,non_manifold_edges,invalid_indices,repeated_index_triangles,zero_area_triangles,duplicate_triangles,orphan_vertices,non_finite_positions,normal_count_mismatch,material_count_mismatch,paint_count_mismatch,passed"
    }

    pub fn to_csv_record(&self, frame: u64, revision: u64, level: u8, x: i32, z: i32) -> String {
        format!(
            "{frame},{revision},{level},{x},{z},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
            self.vertex_count,
            self.triangle_count,
            self.boundary_edges,
            self.non_manifold_edges,
            self.invalid_indices,
            self.repeated_index_triangles,
            self.zero_area_triangles,
            self.duplicate_triangles,
            self.orphan_vertices,
            self.non_finite_positions,
            self.normal_count_mismatch,
            self.material_count_mismatch,
            self.paint_count_mismatch,
            self.passed(),
        )
    }
}

pub fn compute_topology_stats(mesh: &PageMesh) -> ClodTopologyStats {
    let vertex_count = mesh.vertex_count();
    let triangle_count = mesh.indices.len() / 3;
    let mut stats = ClodTopologyStats {
        vertex_count,
        triangle_count,
        normal_count_mismatch: !mesh.normals.is_empty() && mesh.normals.len() != vertex_count,
        material_count_mismatch: !mesh.materials.is_empty() && mesh.materials.len() != vertex_count,
        paint_count_mismatch: !mesh.paint_slots.is_empty() && mesh.paint_slots.len() != vertex_count,
        ..Default::default()
    };

    stats.non_finite_positions = mesh
        .positions
        .iter()
        .filter(|p| !p[0].is_finite() || !p[1].is_finite() || !p[2].is_finite())
        .count();

    let mut used_vertices = vec![false; vertex_count];
    let mut edge_counts: HashMap<u64, usize> = HashMap::new();
    let mut triangle_keys = HashSet::<[u32; 3]>::new();

    let mut t = 0;
    while t + 2 < mesh.indices.len() {
        let a = mesh.indices[t];
        let b = mesh.indices[t + 1];
        let c = mesh.indices[t + 2];

        let valid = (a as usize) < vertex_count
            && (b as usize) < vertex_count
            && (c as usize) < vertex_count;

        if !valid {
            stats.invalid_indices += [a, b, c]
                .iter()
                .filter(|idx| (**idx as usize) >= vertex_count)
                .count();
            t += 3;
            continue;
        }

        used_vertices[a as usize] = true;
        used_vertices[b as usize] = true;
        used_vertices[c as usize] = true;

        if a == b || b == c || a == c {
            stats.repeated_index_triangles += 1;
            t += 3;
            continue;
        }

        if triangle_area_sq(mesh.positions[a as usize], mesh.positions[b as usize], mesh.positions[c as usize]) <= 1.0e-12 {
            stats.zero_area_triangles += 1;
        }

        let mut key = [a, b, c];
        key.sort_unstable();
        if !triangle_keys.insert(key) {
            stats.duplicate_triangles += 1;
        }

        for (u, v) in [(a, b), (b, c), (c, a)] {
            *edge_counts.entry(edge_key(u, v)).or_insert(0) += 1;
        }

        t += 3;
    }

    stats.boundary_edges = edge_counts.values().filter(|count| **count == 1).count();
    stats.non_manifold_edges = edge_counts.values().filter(|count| **count > 2).count();
    stats.orphan_vertices = used_vertices.iter().filter(|used| !**used).count();

    stats
}

fn edge_key(a: u32, b: u32) -> u64 {
    let (lo, hi) = if a < b { (a, b) } else { (b, a) };
    ((lo as u64) << 32) | hi as u64
}

fn triangle_area_sq(pa: [f32; 3], pb: [f32; 3], pc: [f32; 3]) -> f32 {
    let ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    let ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    let n = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
    ];
    (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) * 0.25
}

#[cfg(test)]
mod tests {
    use super::*;

    fn triangle_mesh() -> PageMesh {
        PageMesh {
            positions: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
            normals: vec![[0.0, 1.0, 0.0]; 3],
            materials: vec![[1.0, 0.0, 0.0, 0.0]; 3],
            paint_slots: vec![0.0; 3],
            material_weight_stride: 4,
            indices: vec![0, 1, 2],
        }
    }

    #[test]
    fn valid_triangle_has_boundary_edges() {
        let stats = compute_topology_stats(&triangle_mesh());
        assert_eq!(stats.vertex_count, 3);
        assert_eq!(stats.triangle_count, 1);
        assert_eq!(stats.boundary_edges, 3);
        assert_eq!(stats.non_manifold_edges, 0);
        assert_eq!(stats.invalid_indices, 0);
        assert!(stats.passed());
    }

    #[test]
    fn invalid_index_is_reported() {
        let mut mesh = triangle_mesh();
        mesh.indices = vec![0, 1, 9];
        let stats = compute_topology_stats(&mesh);
        assert_eq!(stats.invalid_indices, 1);
        assert!(!stats.passed());
    }

    #[test]
    fn degenerate_and_duplicate_triangles_are_reported() {
        let mut mesh = triangle_mesh();
        mesh.indices = vec![0, 1, 2, 2, 1, 0, 0, 0, 1];
        let stats = compute_topology_stats(&mesh);
        assert_eq!(stats.duplicate_triangles, 1);
        assert_eq!(stats.repeated_index_triangles, 1);
        assert!(!stats.passed());
    }

    #[test]
    fn csv_schema_stays_stable() {
        let stats = compute_topology_stats(&triangle_mesh());
        let row = stats.to_csv_record(7, 2, 0, 1, 3);
        assert_eq!(ClodTopologyStats::csv_header().split(',').count(), row.split(',').count());
    }
}

