//! Border-lock statistics for CLOD page meshes.
//!
//! The CLOD builder locks topological open-boundary vertices before
//! simplification so page outer borders remain stable across LODs. This helper
//! turns that lock mask into deterministic counters that can be exported by
//! benches and guarded in CI.

use super::lock::{build_outer_border_locks, count_locks};
use super::types::PageMesh;
use super::validate::border_edges;

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ClodBorderLockStats {
    pub level: usize,
    pub coord: (i32, i32),
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub border_edges: usize,
    pub locked_vertices: usize,
    pub lock_ratio: f32,
    pub boundary_vertex_ratio: f32,
}

impl ClodBorderLockStats {
    pub(crate) fn csv_header() -> &'static str {
        "frame,level,x,z,vertex_count,triangle_count,border_edges,locked_vertices,lock_ratio,boundary_vertex_ratio\n"
    }

    pub(crate) fn to_csv_record(&self, frame: u64) -> String {
        format!(
            "{frame},{level},{x},{z},{vertex_count},{triangle_count},{border_edges},{locked_vertices},{lock_ratio:.6},{boundary_vertex_ratio:.6}\n",
            frame = frame,
            level = self.level,
            x = self.coord.0,
            z = self.coord.1,
            vertex_count = self.vertex_count,
            triangle_count = self.triangle_count,
            border_edges = self.border_edges,
            locked_vertices = self.locked_vertices,
            lock_ratio = self.lock_ratio,
            boundary_vertex_ratio = self.boundary_vertex_ratio,
        )
    }
}

pub(crate) fn border_lock_stats(
    level: usize,
    coord: (i32, i32),
    mesh: &PageMesh,
) -> ClodBorderLockStats {
    let vertex_count = mesh.vertex_count();
    let triangle_count = mesh.triangle_count();
    let border_edges = border_edges(mesh).len();
    let locks = build_outer_border_locks(mesh);
    let locked_vertices = count_locks(&locks);
    let lock_ratio = ratio(locked_vertices, vertex_count);
    let boundary_vertex_ratio = if border_edges == 0 {
        0.0
    } else {
        ratio(locked_vertices, border_edges.saturating_mul(2))
    };

    ClodBorderLockStats {
        level,
        coord,
        vertex_count,
        triangle_count,
        border_edges,
        locked_vertices,
        lock_ratio,
        boundary_vertex_ratio,
    }
}

fn ratio(num: usize, den: usize) -> f32 {
    if den == 0 { 0.0 } else { num as f32 / den as f32 }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square_page_mesh() -> PageMesh {
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

    #[test]
    fn square_mesh_locks_all_boundary_vertices() {
        let stats = border_lock_stats(0, (3, 7), &square_page_mesh());
        assert_eq!(stats.level, 0);
        assert_eq!(stats.coord, (3, 7));
        assert_eq!(stats.vertex_count, 4);
        assert_eq!(stats.triangle_count, 2);
        assert_eq!(stats.border_edges, 4);
        assert_eq!(stats.locked_vertices, 4);
        assert_eq!(stats.lock_ratio, 1.0);
        assert_eq!(stats.boundary_vertex_ratio, 0.5);
    }

    #[test]
    fn csv_record_is_stable() {
        let stats = border_lock_stats(2, (-1, 4), &square_page_mesh());
        assert_eq!(
            stats.to_csv_record(9),
            "9,2,-1,4,4,2,4,4,1.000000,0.500000\n"
        );
    }
}
